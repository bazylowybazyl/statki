// ============================================================
// Tarcza encji: most między shieldSystem.js (stan, obrys, trafienia — jak w grze)
// a renderem WebGPU (czasza, pole w compute, efekty). Encja w konwencji gry:
// { x, y, angle, visual: { spriteScale }, hexGrid: { shards }, shield: { val, max } },
// y w dół; render w klatce lokalnej 3D grupy (pozycja (x, −y), obrót −kąt).
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, texture, attribute, positionGeometry, fract, abs, fwidth, max,
  smoothstep, length, mix, saturate
} from 'three/tsl';
import {
  getEntityShieldProfile, sampleShieldProfileRadius, shieldGridAngleTowards, getShieldHullAngle,
  registerShieldImpact, isShieldSuppressed, getEntityShieldBlockingProgress
} from '../../shieldSystem.js';
import {
  buildDomeGeometry, createShieldUniforms, createReferenceMaterial, MAX_HITS, sstepDown
} from './czasza.js';
import { createField, createFieldShared } from './pole.js';
import { clamp } from './wspolne.js';

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

// Widok kontrolny: siatka pola (izolinie t z tekstury), czasza (izolinie t z geometrii),
// plamka pola w znaczniku i pierścień znacznika liczony z pozycji lokalnej.
function createDebugMaterial(F, U) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  const aEdge = attribute('aEdge', 'float');
  m.fragmentNode = Fn(() => {
    const obj = positionGeometry.toVar();
    const uvf = obj.xy.sub(F.uOrigin).div(F.uSize);
    const f = F.texNode.sample(uvf).toVar();
    const iso = (x, k) => {
      const v = x.mul(k);
      return sstepDown(1.2, 0.0, abs(fract(v.add(0.5)).sub(0.5)).div(max(fwidth(v), 1e-4)));
    };
    const tGrid = f.a;
    const lineGrid = iso(tGrid, 8.0);
    const lineDome = iso(aEdge, 8.0);
    const d = length(obj.xy.sub(F.uMarker.xy));
    const ring = sstepDown(1.6, 0.0, abs(d.sub(F.uMarker.z)).div(max(fwidth(d), 1e-4)));
    const col = vec3(0.03, 0.04, 0.07)
      .add(vec3(0.9, 0.9, 0.9).mul(lineGrid))
      .add(vec3(0.9, 0.1, 0.8).mul(lineDome).mul(0.8))
      .add(vec3(0.1, 1.4, 0.3).mul(saturate(f.g)))
      .add(vec3(1.6, 1.3, 0.1).mul(ring))
      .add(vec3(0.0, 0.4, 1.2).mul(saturate(f.b)))
      .add(vec3(1.2, 0.3, 0.1).mul(saturate(abs(f.r).mul(0.05))));
    return vec4(col, 0.6);
  })();
  return m;
}

export class Tarcza {
  constructor({ renderer, entity, group, gridCells = 512, debugMarker = null, name = 'tarcza' }) {
    this.renderer = renderer;
    this.entity = entity;
    this.group = group;
    this.name = name;
    this.profile = getEntityShieldProfile(entity);
    if (!this.profile) throw new Error(`${name}: brak profilu tarczy (hexGrid.shards?)`);
    const { geometry, height } = buildDomeGeometry(this.profile);
    this.domeHeight = height;
    this.U = createShieldUniforms(this.profile);
    this.debugMarker = debugMarker;
    this.F = createFieldShared();
    if (debugMarker) this.F.uMarker.value.copy(debugMarker);
    this.gridCells = gridCells;
    this.field = createField(renderer, this.profile, gridCells, this.F);
    this.materials = {
      ref: createReferenceMaterial(this.U),
      debug: createDebugMaterial(this.F, this.U)
    };
    this.mode = debugMarker ? 'debug' : 'ref';
    this.mesh = new THREE.Mesh(geometry, this.materials[this.mode]);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    group.add(this.mesh);

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
    this._c = new THREE.Color();
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

  // ── Stan klatki ───────────────────────────────────────────────────────────
  update(dt, time, pxPerUnit) {
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

    // Jak updateShields3D: stan off (albo stłumiona bez gaszenia) = brak kopuły;
    // nic się nie dzieje = zero draw calli.
    const shown = up && (!isShieldSuppressed(this.entity) || sh.state === 'deactivating');
    const domePx = Math.max(1, this.profile.maxR) * pxPerUnit;
    this.visible = this.mode === 'debug' || (shown && domePx >= SHIELD_DOME_MIN_PX && (
      U.fieldVisibility.value > 0.002 || U.lowPower.value > 0.004 || liveHits > 0 || (sh.energyShotTimer || 0) > 0));
    this.mesh.visible = this.visible;
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

  // resolveHullFieldPhase z gry: rozruch/gaszenie = czoło fali, dopalenie po rozruchu.
  resolvePhase(time) {
    const sh = this.shield;
    const st = sh.state;
    const ap = clamp(Number(sh.activationProgress) || 0, 0, 1);
    if (this.prevState !== st) {
      if (st === 'active' && this.prevState === 'activating') this.bootAt = time;
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

  computeStep(dt) {
    this.field.step(dt);
  }

  // Suwak jakości: nowa siatka, te same materiały (texNode.value podmienione).
  setGridCells(n) {
    if (n === this.gridCells) return;
    const old = this.field;
    this.gridCells = n;
    this.field = createField(this.renderer, this.profile, n, this.F);
    old.dispose();
  }

  describeGrid() { return this.field.describe(); }
}
