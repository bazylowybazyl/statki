// ============================================================
// Tarcza encji: most między shieldSystem.js (stan, obrys, trafienia — jak w grze)
// a renderem WebGPU (czasza, pole w compute, efekty). Encja w konwencji gry:
// { x, y, angle, visual: { spriteScale }, hexGrid: { shards }, shield: { val, max } },
// y w dół; render w klatce lokalnej 3D grupy (pozycja (x, −y), obrót −kąt).
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, vec3, vec4, attribute, positionGeometry, fract, abs, fwidth, max, length, saturate
} from 'three/tsl';
import {
  getEntityShieldProfile, sampleShieldProfileRadius, getShieldHullAngle,
  registerShieldImpact, isShieldSuppressed, getEntityShieldBlockingProgress
} from '../../shieldSystem.js';
import {
  buildDomeGeometry, createShieldUniforms, createReferenceMaterial, createFieldLookUniforms,
  createFieldMaterial, MAX_HITS, sstepDown
} from './czasza.js';
import { createField, createFieldShared, MAX_EVENTS, MAX_SOURCES } from './pole.js';
import { clamp, lights as sceneLights } from './wspolne.js';
import { createSparks } from './iskry.js';
import { createShards } from './odlamki.js';

// Liczby z src/3d/shield3D.js (model „niewidzialne pole”).
export const SHIELD_FIELD_TUNING = {
  hitOpacity: 0.90, hitDecay: 3.4, hitRadiusScale: 1.0, fieldOpacity: 0.30, lowPowerGain: 1.0
};
const LOW_POWER_THRESHOLD = 0.35;
const BOOT_AFTERGLOW = 0.42;
const SWEEP_END = 1.2;
const HIT_DURATION = 1.5;
const HIT_FX_LIFE = 1.1;
const SHIELD_DOME_MIN_PX = 9;

// Parametry pola (panel; wspólne dla wszystkich tarcz).
export const FIELD_PARAMS = {
  waveSpeed: 900,      // j./s
  damping: 1.6,        // 1/s
  stiffness: 9,        // 1/s² — sprężystość wracająca czaszę do spoczynku
  coolTime: 2.6,       // s — stygnięcie energii
  threshold: 1.4,      // próg przebicia (energia względem pojedynczego trafienia)
  diffusion: 1000,     // j²/s — rozpływanie energii
  waveTrail: 0.9,      // s — jak długo heksy pamiętają przejście fali
  wavesOn: true,
  energyOn: true,
  sparksOn: true,
  sparkMult: 1.0
};

// Zdarzenie pola na klasę trafienia (klasy gry: pd / main / special / shield).
// Promień w j. (skalowany rozmiarem tarczy), impuls fali [j./s] (w głąb czaszy),
// energia w jednostkach, w których próg przebicia ~1,4.
const HIT_CLASS = {
  pd: { radius: 20, impulse: 140, impulsePerDmg: 3.0, energy: 0.04, energyPerDmg: 0.004 },
  main: { radius: 42, impulse: 120, impulsePerDmg: 2.4, energy: 0.10, energyPerDmg: 0.0024 },
  special: { radius: 115, impulse: 300, impulsePerDmg: 1.0, energy: 0.45, energyPerDmg: 0.0009 },
  shield: { radius: 70, impulse: 80, impulsePerDmg: 0.6, energy: 0.08, energyPerDmg: 0.0012 }
};

// Światło trafienia na klasę: czas życia [s], moc, zasięg i skala spadku [j.].
const HIT_LIGHT = {
  pd: { life: 0.12, power: 2.0, radius: 420, falloff: 95 },
  main: { life: 0.34, power: 4.2, radius: 850, falloff: 170 },
  special: { life: 0.95, power: 8.5, radius: 1700, falloff: 340 },
  shield: { life: 0.5, power: 3.6, radius: 950, falloff: 210 },
  // Pęknięcie: błysk całej czaszy.
  break: { life: 0.7, power: 11.0, radius: 3400, falloff: 760 }
};
const MAX_FLASHES = 64;
const MAX_HOTSPOTS = 32;

// Widok kontrolny: siatka pola (izolinie t z tekstury maski), czasza (izolinie t
// z geometrii), pole (h czerwień/granat, E zieleń, B błękit) i pierścień znacznika.
function createDebugMaterial(P) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  const aEdge = attribute('aEdge', 'float');
  m.fragmentNode = Fn(() => {
    const obj = positionGeometry.toVar();
    const uvf = obj.xy.sub(P.uOrigin).div(P.uSize);
    const f = P.texNode.sample(uvf).toVar();
    const tGrid = P.maskTexNode.sample(uvf).x;
    const iso = (x, k) => {
      const v = x.mul(k);
      return sstepDown(1.2, 0.0, abs(fract(v.add(0.5)).sub(0.5)).div(max(fwidth(v), 1e-4)));
    };
    const d = length(obj.xy.sub(P.uMarker.xy));
    const ring = sstepDown(1.6, 0.0, abs(d.sub(P.uMarker.z)).div(max(fwidth(d), 1e-4)));
    const col = vec3(0.03, 0.04, 0.07)
      .add(vec3(0.9, 0.9, 0.9).mul(iso(tGrid, 8.0)))
      .add(vec3(0.9, 0.1, 0.8).mul(iso(aEdge, 8.0)).mul(0.8))
      .add(vec3(0.1, 1.4, 0.3).mul(saturate(f.y)))
      .add(vec3(1.6, 1.3, 0.1).mul(ring))
      .add(vec3(0.0, 0.4, 1.2).mul(saturate(f.z)))
      .add(vec3(1.3, 0.25, 0.1).mul(saturate(f.x.mul(0.08))))
      .add(vec3(0.1, 0.35, 1.3).mul(saturate(f.x.mul(-0.08))));
    return vec4(col, 0.6);
  })();
  return m;
}

export class Tarcza {
  constructor({ renderer, entity, group, gridCells = 512, debugMarker = null, name = 'tarcza', sparkPool = 65536, shardMax = 6000 }) {
    this.renderer = renderer;
    this.entity = entity;
    this.group = group;
    this.name = name;
    this.profile = getEntityShieldProfile(entity);
    if (!this.profile) throw new Error(`${name}: brak profilu tarczy (hexGrid.shards?)`);
    const { geometry, height } = buildDomeGeometry(this.profile);
    this.domeHeight = height;
    this.sizeK = clamp(this.profile.maxR / 900, 0.35, 1.2);
    this.U = createShieldUniforms(this.profile);
    this.G = createFieldLookUniforms(this.profile);
    this.P = createFieldShared();
    this.P.uHMax.value = height * 0.32;
    this.debugMarker = debugMarker;
    if (debugMarker) this.P.uMarker.value.copy(debugMarker);
    this.gridCells = gridCells;
    this.field = createField(renderer, this.profile, gridCells, this.P);
    this.materials = {
      new: createFieldMaterial(this.U, this.P, this.G),
      ref: createReferenceMaterial(this.U),
      debug: createDebugMaterial(this.P)
    };
    this.mode = debugMarker ? 'debug' : 'new';
    this.mesh = new THREE.Mesh(geometry, this.materials[this.mode]);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    group.add(this.mesh);

    // Iskry na powierzchni i odłamki pęknięcia (compute, pule tworzone raz).
    this.sparks = createSparks({ renderer, group, profile: this.profile, domeHeight: height, U: this.U, pool: sparkPool, name });
    this.shards = createShards({ renderer, group, profile: this.profile, domeHeight: height, maxCount: shardMax });
    this.meanR = (this.profile.maxR + this.profile.minR) * 0.5;
    this.fadeK = 1;
    this.beamAcc = 0;

    // Pierścień trafień (jak syncHitBuffer w grze): sloty z czasem startu.
    this.slotStart = new Float32Array(MAX_HITS).fill(-999);
    this.lastImpactId = 0;
    this.fresh = [];            // świeże trafienia tej klatki (obiekty z puli)
    this._freshPool = Array.from({ length: 64 }, () => ({ x: 0, y: 0, gridAngle: 0, dmg: 0, cls: 'main', beam: false, id: 0 }));
    this.prevState = null;
    this.bootAt = -999;
    this.showField = false;
    this.phase = { field: 0, sweep: -1 };
    this.visible = false;
    this.lastHitLocal = new THREE.Vector2(0, 0);
    this.time = 0;

    // Pole: zdarzenia i źródła tej klatki, czas czuwania (poza nim compute śpi).
    this.evCount = 0;
    this.srcCount = 0;
    this.eventsLastFrame = 0;
    this.awakeUntil = -1;
    this.substeps = 0;
    this.debugPulseAt = 0;
    this.offReset = false;

    // Światła: błyski trafień i gorące punkty energii (pule, bez alokacji w klatce).
    this.flashes = Array.from({ length: MAX_FLASHES }, () => ({ on: false, x: 0, y: 0, z: 0, age: 0, life: 1, power: 1, radius: 1, falloff: 1 }));
    this.hotspots = Array.from({ length: MAX_HOTSPOTS }, () => ({ on: false, x: 0, y: 0, z: 0, e: 0 }));
    this._lv = new THREE.Vector3();
    this._lc = new THREE.Color();
    this._hc = new THREE.Color();
    this._heatWhite = new THREE.Color(1.25, 1.3, 1.4);
    this._heatOrange = new THREE.Color(1.9, 0.62, 0.16);
  }

  get shield() { return this.entity.shield; }

  // ── Współrzędne ───────────────────────────────────────────────────────────
  // Punkt gry (y w dół) → klatka lokalna 3D (x wzdłuż kadłuba, y w górę).
  worldToLocal(x, y, out) {
    const e = this.entity;
    const a = getShieldHullAngle(e);
    const c = Math.cos(a), s = Math.sin(a);
    const dx = x - e.x, dy = y - e.y;
    return out.set(dx * c + dy * s, -(-dx * s + dy * c));
  }
  // Klatka lokalna 3D → punkt gry.
  localToWorld(lx, ly, out) {
    const e = this.entity;
    const a = getShieldHullAngle(e);
    const c = Math.cos(a), s = Math.sin(a);
    const gx = lx, gy = -ly;
    return out.set(e.x + gx * c - gy * s, e.y + gx * s + gy * c);
  }
  // Punkt obrysu (lokalnie 3D) pod kątem siatki a.
  outlineLocal(gridAngle, out) {
    const r = sampleShieldProfileRadius(this.profile, gridAngle);
    return out.set(Math.cos(gridAngle) * r, -Math.sin(gridAngle) * r);
  }
  // Wysokość czaszy nad punktem lokalnym (0 poza obrysem).
  domeZ(lx, ly) {
    const R = sampleShieldProfileRadius(this.profile, Math.atan2(-ly, lx));
    const t = Math.hypot(lx, ly) / Math.max(R, 1e-3);
    return this.domeHeight * Math.pow(Math.max(0, 1 - t * t), 0.62);
  }

  isBlocking() { return getEntityShieldBlockingProgress(this.entity) > 0; }

  // ── Trafienie (gameplay jak w grze): registerShieldImpact + HP po stronie wołającego.
  registerHit(x, y, dmg, cls = 'main', opts = null) {
    const sh = this.shield;
    if (!registerShieldImpact(this.entity, x, y, dmg, cls)) return false;
    const imp = sh.impacts[0];
    imp.dmg = dmg;
    imp.beam = !!(opts && opts.beam);
    if (!(opts && opts.noDamage)) sh.val = Math.max(0, sh.val - dmg);
    return true;
  }

  // ── Zdarzenia pola (klatka lokalna 3D) ────────────────────────────────────
  pushEvent(lx, ly, radius, impulse, energy) {
    if (this.evCount >= MAX_EVENTS) return false;
    this.P.evA[this.evCount].set(lx, ly, radius, impulse);
    this.P.evB[this.evCount].set(energy, 0, 0, 0);
    this.evCount++;
    return true;
  }
  // Źródło ciągłe (wiązka): siła co podkrok + energia co klatkę.
  pushSource(lx, ly, radius, force, energyRate, dt) {
    if (this.srcCount < MAX_SOURCES) {
      this.P.src[this.srcCount].set(lx, ly, radius, force);
      this.srcCount++;
    }
    this.pushEvent(lx, ly, radius, 0, energyRate * dt);
    this.wake(0);
  }
  // Zdarzenie trafienia danej klasy w punkt obrysu (lx, ly) — cofnięte do wnętrza.
  pushHitEvent(lx, ly, dmg, cls, lowPower) {
    const k = HIT_CLASS[cls] || HIT_CLASS.main;
    const radius = k.radius * this.sizeK * (0.85 + 0.15 * Math.min(2, dmg / 150));
    const weak = 1 - 0.5 * lowPower;
    const r = Math.hypot(lx, ly) || 1;
    const inset = Math.min(r * 0.25, radius * 0.6);
    const ix = lx * (1 - inset / r), iy = ly * (1 - inset / r);
    const energy = k.energy + k.energyPerDmg * dmg;
    this.pushEvent(ix, iy, radius, -(k.impulse + k.impulsePerDmg * dmg) * weak, energy);
    this.addFlash(lx, ly, cls, dmg);
    this.addHeat(ix, iy, energy);
    this.emitHitSparks(ix, iy, cls, dmg);
    this.wake(0);
  }
  // Iskry klasy trafienia z punktu na czaszy (skala efektu jak w grze: promień
  // w miejscu trafienia zmieszany ze średnią statku).
  emitHitSparks(lx, ly, cls, dmg) {
    if (!FIELD_PARAMS.sparksOn || FIELD_PARAMS.sparkMult <= 0) return;
    const r = Math.hypot(lx, ly);
    const R = r * 0.7 + this.meanR * 0.3;
    const power = clamp(0.25 + dmg / 260, 0.2, 2.0);
    this.sparks.spawnClass(cls, lx, ly, this.domeZ(lx, ly) + 2, R, power, FIELD_PARAMS.sparkMult, this.time);
  }
  // Wiązka: strumień iskier z gorącego punktu (tempo na sekundę, akumulator).
  beamSparks(lx, ly, dt, rate = 900) {
    if (!FIELD_PARAMS.sparksOn || FIELD_PARAMS.sparkMult <= 0) return;
    this.beamAcc += rate * FIELD_PARAMS.sparkMult * dt;
    if (this.beamAcc < 8) return;
    const n = Math.floor(this.beamAcc);
    this.beamAcc -= n;
    const r = Math.hypot(lx, ly) || 1;
    const R = r * 0.7 + this.meanR * 0.3;
    this.sparks.spawn(lx, ly, this.domeZ(lx, ly) + 2, lx / r, ly / r, 0.4, n,
      0.9 * R, 2.1 * R, 0.35, 0.9, 0.3, 1.2, 3.2, 1.0, this.time);
  }

  // ── Światła trafień i rozgrzanych miejsc pola ─────────────────────────────
  addFlash(lx, ly, cls, dmg) {
    const k = HIT_LIGHT[cls] || HIT_LIGHT.main;
    let f = null, oldest = -1;
    for (let i = 0; i < MAX_FLASHES; i++) {
      const c = this.flashes[i];
      if (!c.on) { f = c; break; }
      if (c.age / c.life > oldest) { oldest = c.age / c.life; f = c; }
    }
    const boost = 0.8 + 0.2 * Math.min(2, dmg / 150);
    f.on = true; f.x = lx; f.y = ly; f.z = 40 + this.domeHeight * 0.25; f.age = 0;
    f.life = k.life; f.power = k.power * boost * this.sizeK; f.radius = k.radius * this.sizeK; f.falloff = k.falloff * this.sizeK;
  }
  // Energia w pobliżu (90 j.) dokłada się do istniejącego punktu — jak hotspoty w demie lasera.
  addHeat(lx, ly, energy) {
    let free = null, weakest = null;
    for (let i = 0; i < MAX_HOTSPOTS; i++) {
      const h = this.hotspots[i];
      if (!h.on) { if (!free) free = h; continue; }
      const dx = h.x - lx, dy = h.y - ly;
      if (dx * dx + dy * dy < 90 * 90) {
        const w = energy / (h.e + energy);
        h.x += (lx - h.x) * w; h.y += (ly - h.y) * w;
        h.e = Math.min(6, h.e + energy);
        return;
      }
      if (!weakest || h.e < weakest.e) weakest = h;
    }
    const h = free || weakest;
    h.on = true; h.x = lx; h.y = ly; h.e = energy; h.z = 20 + this.domeZ(lx, ly);
  }
  // Światła tej klatki do wspólnej listy (świat 3D przez macierz grupy).
  emitLights(dt, gain = 1) {
    const U = this.U;
    const life = U.life.value;
    const base = this._lc.setRGB(1.0, 0.08, 0.04).lerp(U.color.value, life);
    const cool = Math.exp(-dt / Math.max(0.05, FIELD_PARAMS.coolTime));
    const thr = Math.max(0.05, FIELD_PARAMS.threshold);
    const v = this._lv;
    for (let i = 0; i < MAX_FLASHES; i++) {
      const f = this.flashes[i];
      if (!f.on) continue;
      f.age += dt;
      if (f.age >= f.life) { f.on = false; continue; }
      const k = 1 - f.age / f.life;
      const p = f.power * k * k * gain;
      v.set(f.x, f.y, f.z);
      this.group.localToWorld(v);
      // Błysk: barwa tarczy z domieszką bieli.
      sceneLights.push(v.x, v.y, v.z, f.radius, f.falloff,
        (base.r * 0.6 + 0.4) * p, (base.g * 0.6 + 0.4) * p, (base.b * 0.6 + 0.4) * p);
    }
    const hc = this._hc;
    for (let i = 0; i < MAX_HOTSPOTS; i++) {
      const h = this.hotspots[i];
      if (!h.on) continue;
      h.e *= cool;
      const eN = h.e / thr;
      if (eN < 0.04 || !FIELD_PARAMS.energyOn) { h.on = false; continue; }
      // Barwa jak energia na czaszy: błękit → biel → pomarańcz.
      const w = clamp((eN - 0.42) / 0.48, 0, 1);
      const o = clamp((eN - 0.95) / 0.5, 0, 1);
      hc.copy(base).lerp(this._heatWhite, w * w * (3 - 2 * w));
      hc.lerp(this._heatOrange, o * o * (3 - 2 * o));
      const p = Math.min(eN, 2.2) * 2.4 * gain;
      v.set(h.x, h.y, h.z);
      this.group.localToWorld(v);
      sceneLights.push(v.x, v.y, v.z, 700 * this.sizeK, 150 * this.sizeK, hc.r * p, hc.g * p, hc.b * p);
    }
  }
  // Zgaszona tarcza nie ma już rozgrzanych miejsc (błyski dopalają się same).
  clearHeat() {
    for (const h of this.hotspots) h.on = false;
  }
  wake(extra) {
    const until = this.time + FIELD_PARAMS.coolTime * 6 + 2 + extra;
    if (until > this.awakeUntil) this.awakeUntil = until;
  }

  // ── Stan klatki ───────────────────────────────────────────────────────────
  update(dt, time, pxPerUnit) {
    this.time = time;
    const sh = this.shield;
    const U = this.U;
    const life = clamp((sh.val || 0) / (sh.max || 1), 0, 1);
    U.life.value = life;
    U.reveal.value = sh.state === 'breaking' ? 1 - clamp(sh.activationProgress || 0, 0, 1) : 0;
    U.isBreaking.value = sh.state === 'breaking' ? 1 : 0;
    U.energyShot.value = sh.energyShotTimer > 0 ? sh.energyShotTimer / (sh.energyShotDuration || 1) : 0;

    this.syncImpacts(time);

    let liveHits = 0;
    for (let i = 0; i < MAX_HITS; i++) {
      const v = U.hitArr[i];
      if (time - this.slotStart[i] < HIT_DURATION) {
        v.w = this.slotStart[i];
        if (time - this.slotStart[i] < HIT_FX_LIFE) liveHits++;
      } else {
        v.w = -999;
      }
    }

    const phase = this.resolvePhase(time);
    const up = sh.state !== 'off';
    U.fieldVisibility.value = this.showField && up ? Math.max(phase.field, 1) : phase.field;
    U.sweep.value = phase.sweep;
    const lowPower = (sh.state === 'active' || sh.state === 'activating')
      ? clamp((LOW_POWER_THRESHOLD - life) / LOW_POWER_THRESHOLD, 0, 1) : 0;
    const tune = SHIELD_FIELD_TUNING;
    U.lowPower.value = lowPower * tune.lowPowerGain;
    U.hitOpacity.value = tune.hitOpacity;
    U.hitDecay.value = tune.hitDecay;
    U.opacity.value = tune.fieldOpacity;
    U.hitImpactRadius.value = U.baseHitRadius * tune.hitRadiusScale;

    // Zdarzenia pola z trafień tej klatki (wiązka działa jako źródło ciągłe).
    if (this.mode !== 'ref') {
      for (let i = 0; i < this.fresh.length; i++) {
        const f = this.fresh[i];
        if (!f.beam) this.pushHitEvent(f.x, f.y, f.dmg, f.cls, U.lowPower.value);
      }
    }
    // Rozruch / gaszenie: czoło fali pcha pole (rozruch w górę, gaszenie w dół).
    const sweeping = sh.state === 'activating' || sh.state === 'deactivating';
    this.P.uSweep.value = sweeping ? phase.sweep : -1;
    this.P.uSweepAmp.value = sh.state === 'activating' ? 1300 : -1700;
    if (sweeping) this.wake(0);
    if (lowPower > 0 || this.showField) this.wake(0);
    if (this.debugMarker) this.debugSources(dt, time);
    this.G.fade.value = this.fadeK;
    this.sparks.update(time);
    this.sparks.uMinW.value = 1.3 / Math.max(1e-4, pxPerUnit);
    this.sparks.uGroupRot.value = this.group.rotation.z;

    // Jak updateShields3D: stan off (albo stłumiona bez gaszenia) = brak kopuły;
    // nic się nie dzieje = zero draw calli.
    const shown = up && (!isShieldSuppressed(this.entity) || sh.state === 'deactivating');
    const domePx = Math.max(1, this.profile.maxR) * pxPerUnit;
    const busy = this.mode === 'new'
      ? (time < this.awakeUntil || U.fieldVisibility.value > 0.002 || U.lowPower.value > 0.004)
      : (U.fieldVisibility.value > 0.002 || U.lowPower.value > 0.004 || liveHits > 0);
    this.visible = this.mode === 'debug' || (shown && domePx >= SHIELD_DOME_MIN_PX && (busy || (sh.energyShotTimer || 0) > 0));
    this.mesh.visible = this.visible;

    // Wyłączona tarcza: pole od zera przy następnym rozruchu.
    if (sh.state === 'off') {
      if (!this.offReset) { this.field.reset(); this.clearHeat(); this.offReset = true; this.awakeUntil = -1; }
    } else {
      this.offReset = false;
    }
  }

  // Widok kontrolny: energia w znaczniku i co 0,8 s impuls fali (odbicie od obrysu).
  debugSources(dt, time) {
    const m = this.debugMarker;
    this.pushEvent(m.x, m.y, m.z, 0, 1.2 * dt);
    if (time >= this.debugPulseAt) {
      this.pushEvent(m.x, m.y, m.z * 0.8, -900, 0);
      this.debugPulseAt = time + 0.8;
    }
    this.wake(0);
  }

  // Nowe trafienia po id (shield.impacts: najnowsze na początku, max 16).
  syncImpacts(time) {
    const imps = this.shield.impacts || [];
    this.fresh.length = 0;
    for (let i = imps.length - 1; i >= 0; i--) {
      const imp = imps[i];
      if (!(imp.id > this.lastImpactId)) continue;
      this.lastImpactId = imp.id;
      // Slot: wolny albo najstarszy (pickHitSlot z gry).
      let slot = -1, oldest = Infinity, oi = 0;
      for (let k = 0; k < MAX_HITS; k++) {
        if (time - this.slotStart[k] >= HIT_DURATION) { slot = k; break; }
        if (this.slotStart[k] < oldest) { oldest = this.slotStart[k]; oi = k; }
      }
      if (slot < 0) slot = oi;
      const a = Number.isFinite(imp.gridAngle) ? imp.gridAngle : 0;
      const p = this.outlineLocal(a, this.lastHitLocal);
      this.U.hitArr[slot].set(p.x, p.y, 0, time);
      this.slotStart[slot] = time;
      if (this.fresh.length < this._freshPool.length) {
        const f = this._freshPool[this.fresh.length];
        f.x = p.x; f.y = p.y; f.gridAngle = a; f.id = imp.id;
        f.dmg = Number(imp.dmg) || 0; f.cls = imp.fxClass || 'main'; f.beam = !!imp.beam;
        this.fresh.push(f);
      }
    }
  }

  // Pęknięcie (nowy wygląd): heksy lecą od ostatniego trafienia, błysk i światło,
  // snop iskier; czasza gaśnie od razu — odłamki ją zastępują.
  onBreak(time) {
    if (this.mode !== 'new') return;
    const hx = this.lastHitLocal.x, hy = this.lastHitLocal.y;
    this.shards.trigger(hx, hy, 1.0, time);
    this.addFlash(hx, hy, 'break', 400);
    this.addFlash(0, 0, 'break', 200);
    if (FIELD_PARAMS.sparksOn) {
      const r = Math.hypot(hx, hy) || 1;
      this.sparks.spawn(hx, hy, this.domeZ(hx * 0.95, hy * 0.95) + 2, hx / r, hy / r, 0.6,
        1400 * FIELD_PARAMS.sparkMult, 500, 2600, 0.5, 1.4, 0.55, 1.4, 3.6, 1.4, time);
    }
    this.fadeK = 0;
  }

  // resolveHullFieldPhase z gry: rozruch/gaszenie = czoło fali, dopalenie po rozruchu.
  resolvePhase(time) {
    const sh = this.shield;
    const st = sh.state;
    const ap = clamp(Number(sh.activationProgress) || 0, 0, 1);
    if (this.prevState !== st) {
      if (st === 'active' && this.prevState === 'activating') this.bootAt = time;
      if (st === 'breaking') this.onBreak(time);
      if (st === 'activating' || st === 'active') this.fadeK = 1;
      this.prevState = st;
    }
    const ph = this.phase;
    if (st === 'activating' || st === 'deactivating') { ph.field = 1; ph.sweep = ap * SWEEP_END; return ph; }
    if (st === 'breaking') { ph.field = 1; ph.sweep = -1; return ph; }
    const since = time - this.bootAt;
    if (since >= 0 && since < BOOT_AFTERGLOW) {
      const k = 1 - since / BOOT_AFTERGLOW;
      ph.field = k * k; ph.sweep = SWEEP_END + (1 - k) * 0.5;
      return ph;
    }
    ph.field = 0; ph.sweep = -1;
    return ph;
  }

  setMode(mode) {
    if (!this.materials[mode]) return;
    this.mode = mode;
    this.mesh.material = this.materials[mode];
  }

  // Compute pola: parametry z panelu, zdarzenia tej klatki, podkroki z CFL.
  computeStep(dt) {
    const P = this.P, fp = FIELD_PARAMS;
    const awake = this.mode !== 'ref' && this.time < this.awakeUntil && this.shield.state !== 'off';
    this.eventsLastFrame = this.evCount;
    // Iskry i odłamki żyją własnym życiem (także po zgaszeniu tarczy).
    this.sparks.compute(this.time);
    this.shards.compute(this.time);
    if (awake) {
      const c = Math.min(fp.waveSpeed, this.field.maxWaveSpeed(dt));
      const n = this.field.substepsFor(dt, c);
      P.uEvCount.value = this.evCount;
      P.uSrcCount.value = this.srcCount;
      P.uDtSub.value = dt / n;
      P.uC2.value = c * c;
      P.uDamp.value = fp.damping;
      P.uStiff.value = fp.stiffness;
      P.uWavesOn.value = fp.wavesOn ? 1 : 0;
      P.uEnergyOn.value = fp.energyOn ? 1 : 0;
      P.uDtFrame.value = dt;
      P.uCoolK.value = Math.exp(-dt / Math.max(0.05, fp.coolTime));
      const sigma = Math.sqrt(2 * fp.diffusion * dt) / this.field.layout.cell;
      P.uSigma.value = Math.max(0.05, sigma);
      P.uBlurK.value = this.field.blurRadiusFor(sigma);
      P.uThr.value = fp.threshold;
      P.uWDecay.value = Math.exp(-dt / Math.max(0.05, fp.waveTrail));
      this.field.step(dt, n);
      this.substeps = n;
    } else {
      this.substeps = 0;
    }
    this.evCount = 0;
    this.srcCount = 0;
  }

  // Suwak jakości: nowa siatka, te same materiały (texNode.value podmienione).
  setGridCells(n) {
    if (n === this.gridCells) return;
    const old = this.field;
    this.gridCells = n;
    this.field = createField(this.renderer, this.profile, n, this.P);
    old.dispose();
    this.wake(0);
  }

  describeGrid() { return this.field.describe(); }
}
