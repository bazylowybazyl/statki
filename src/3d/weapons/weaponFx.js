// src/3d/weapons/weaponFx.js
//
// FASADA EFEKTÓW BRONI (zadanie 17, PROJEKT-BRONI §1): przyjmuje zdarzenia gry — strzał
// (WeaponShotBus), pocisk w locie (tablica `bullets` co klatkę), trafienie
// (`spawnBulletImpactEffect`), wiązki (ciągła, impuls, laser PD), obrona punktowa gracza,
// pęknięcie flaku, Hexlance — i woła receptury dema `bronie-webgpu` (recipes.js) przez
// adapter `ctx`. Rozgrywki nie dotyka: strzał, lot, trafienie i obrażenia liczy gra.
//
// Klatka (Core3D.fx, fxFrame.js):
//   • WeaponFx.sync(bullets) — z updateHexShips3D przed Core3D.render (po Turret2D.sync):
//     stan pocisków (styl, smuga, lot), światła pocisków, pociski do bufora rysunku,
//     wstrząs strzałów, bank Fx3D (błyski dysz, mostki — raz na klatkę renderu);
//   • krok `spawn` (stara rama początku pul): zdarzenia opóźnione, płonące wyrwy, wiązki tej
//     klatki (emisja przy trafieniu, impulsy i ich trafienia), wysyłka smug i paczek GPU;
//   • krok `update`: ruch cząstek (compute), światło dymu, siatki na początku pul, warstwa
//     DIST (Core3D.setDistortLayerActive).
//
// Nośnik (agents.md § Nośnik prędkości): wylot — kadłub strzelca (Turret2D.triggerShot),
// trafienie — trafiony kadłub (ActiveCarrier od wołającego), lot pocisku i smuga — prędkość
// odziedziczona przez pocisk (ivx/ivy) na zegarze pocisku. Receptury czytają ActiveCarrier
// przy każdej paczce (gpuFx) i błysku (FxLights).
//
// Zero alokacji na strzał i na klatkę: stany pocisków, zdarzenia opóźnione, wiązki, impulsy,
// wyrwy i rykoszety w pulach o stałej pojemności.

import { Core3D } from '../core3d.js';
import { GpuFx } from './gpuFx.js';
import { ProjectileSystem, PSTYLE } from './projectiles.js';
import { TrailSystem } from './trails.js';
import { BeamSystem, BEAM, PULSE_SPEED } from './beams.js';
import { RECIPES, runAfter, burnStep, droneBlast, cheapMuzzle, cheapImpact, createChargeState } from './recipes.js';
import { WEAPON_FX, projectileFamilyFor, hexHdr, SIZE_POWER } from './weaponFxTable.js';
import { fxNoise } from '../fx/noise.js';
import { FX_DISTORT_LAYER } from '../fx/fxFrame.js';
import { fxRandom } from '../fx/fxRandom.js';
import { Fx3D } from '../fxParticles3D.js';
import { Turret2D, normalizeWeaponFxKey } from '../../vfx/turret2D.js';
import { WeaponShotBus } from '../../game/weaponShotBus.js';
import { ActiveCarrier, createCarrier, writeCarrier, writeCarrierVelocity } from '../../game/carrierVelocity.js';
import { SimClock, CLOCK_RENDER, CLOCK_SIM } from '../../game/simClock.js';
import { MASTER_WEAPONS } from '../../data/weapons.js';
import { getEntityWeaponTier, WEAPON_TIER_SCALE } from '../../data/ships.js';

// ---------------------------------------------------------------------------
// Budżety i progi

/** Poniżej tylu px promienia wieżyczki pełna receptura wylotu nie ma czego pokazać (jak dawny MuzzleFX3D). */
export const MUZZLE_RICH_PX = 9;
/** Poniżej tylu px — bez błysku. */
export const MUZZLE_MIN_PX = 1.2;
/** Pełnych receptur wylotu na klatkę (ponad — tani błysk). Receptura to paczki GPU (kilkadziesiąt B). */
export const MUZZLE_PER_FRAME = 48;
/** Pełnych receptur trafienia na klatkę (bramki kadru i cooldownu są w index.html). */
export const IMPACT_PER_FRAME = 48;
/** Stanów pocisków (pocisk w tablicy `bullets` ↔ efekt). */
export const BULLET_STATE_CAP = 4096;
/** Zdarzeń opóźnionych naraz. */
export const AFTER_CAP = 512;
/** Płonących wyrw naraz (demo: 24). */
export const BURN_CAP = 24;
/** Wiązek ciągłych naraz (dawny MAX_CONTINUOUS_BEAM_VISUALS). */
export const CONT_BEAM_CAP = 56;
/** Impulsów (wiązka pulsacyjna, laser PD) naraz — pierścień, nadpisywany najstarszy. */
export const PULSE_CAP = 1024;
/** Kosmetycznych rykoszetów naraz. */
export const RICOCHET_CAP = 256;
/** Pocisków spoza tablicy `bullets` (Hexlance) naraz. */
export const EXTERNAL_CAP = 16;
/** Sufit wstrząsu strzałów (window.__weapon3dCameraShake.mag, jak dawny weapon3DSystem). */
export const WEAPON_SHAKE_CAP = 18;
/** Zapas kadru dla efektów pocisków (ułamek kadru siatki Core3D.fx.view). */
const VIEW_PAD = 600;

// Skala wieżyczki (turret2D.js) — dla strzału bez rekordu wieżyczki.
const HDR_FALLBACK = [1, 1, 1];

// ---------------------------------------------------------------------------
// Opisy broni dla receptur (raz na id — receptury czytają `w.size`, `w.def`)

const _weaponCtx = new Map();
function weaponCtx(id) {
  let w = _weaponCtx.get(id);
  if (!w) {
    const def = MASTER_WEAPONS[id] || null;
    const entry = WEAPON_FX[id] || null;
    w = Object.freeze({ id, def, size: def?.size || 'M', fx: entry?.fx || null, entry });
    _weaponCtx.set(id, w);
  }
  return w;
}

// Konfiguracja pocisku (styl, barwa, smuga, światło) — raz na rodzinę i rozmiar.
const _confCache = new Map();
function projectileConf(family, size) {
  const key = family + '|' + size;
  let c = _confCache.get(key);
  if (!c) {
    const r = RECIPES[family];
    c = r?.projectile ? r.projectile(size) : RECIPES.vulcan.projectile(size);
    _confCache.set(key, c);
  }
  return c;
}
// Pociski bez receptury (torpedy, rakiety w tablicy bullets): prosty styl z barwą broni.
const _torpedoConf = { style: PSTYLE.SHELL, color: [2.2, 0.35, 0.3], width: 10, len: 24, streak: 0.004, trail: -1, light: [1.0, 0.3, 0.2, 0.6, 120] };
const _rocketConf = { style: PSTYLE.TRACER, color: [2.4, 1.3, 0.8], width: 6, len: 14, streak: 0.005, trail: -1, light: null };

// Barwa HDR wiązki z danych broni (raz na id).
const _beamColor = new Map();
function beamColor(id, k) {
  let c = _beamColor.get(id);
  if (!c) {
    c = hexHdr(MASTER_WEAPONS[id]?.vfxColor || '#ffffff', k, [0, 0, 0]);
    _beamColor.set(id, c);
  }
  return c;
}

// Barwa taniego błysku (raz na id).
const _muzzleColor = new Map();
function muzzleColor(id) {
  let c = _muzzleColor.get(id);
  if (!c) {
    c = hexHdr(MASTER_WEAPONS[id]?.vfxColor || '#ffe0a0', 3.0, [0, 0, 0]);
    _muzzleColor.set(id, c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Pule stanów

function createBulletState() {
  return {
    bullet: null, active: false, frame: -1, family: null, recipe: null, conf: null, trail: null,
    flyAcc: 0, lastX: 0, lastY: 0, drawX: 0, drawY: 0, rvx: 0, rvy: 0, power: 1, seed: 0,
    wScale: 1, endX: 0, endY: 0, endSet: false, clock: CLOCK_SIM, ivx: 0, ivy: 0, visible: false
  };
}
function createAfter() {
  return { t: 0, kind: 0, a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, ref: null, cvx: 0, cvy: 0, ct0: 0, cclock: CLOCK_SIM };
}
function createBurner() {
  return { active: false, entity: null, lx: 0, ly: 0, lnx: 0, lny: 0, x: 0, y: 0, nx: 0, ny: 0, age: 0, dur: 1, power: 1, pal: 'armata', seed: 0 };
}
function createContBeam() {
  return {
    active: false, uid: null, weaponId: null, lastEvent: -1, charge: 0,
    sx: 0, sy: 0, ex: 0, ey: 0, tsx: 0, tsy: 0, tex: 0, tey: 0, width: 8, tWidth: 8,
    key: null, muzzle: 0, hasKey: false, hit: false, hnx: 0, hny: 0, hitEntity: null, shooter: null,
    col: HDR_FALLBACK, seed: 0
  };
}
function createPulse() {
  return {
    active: false, style: BEAM.PULSE, family: null, x0: 0, y0: 0, x1: 0, y1: 0, cvx: 0, cvy: 0, ct0: 0, cclock: CLOCK_SIM,
    width: 7, col: HDR_FALLBACK, life: 0.15, age: 0, hitAt: 0, hitDone: false, hit: false, hnx: 0, hny: 0,
    hitEntity: null, seed: 0
  };
}
function createRicochet() {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, cvx: 0, cvy: 0, t0: 0, clock: CLOCK_SIM, ft0: 0, life: 0.3, style: 0, r: 1, g: 1, b: 1, width: 4, len: 10, seed: 0 };
}
function createExternal() {
  return {
    active: false, family: null, recipe: null, conf: null, trail: null, flyAcc: 0, x: 0, y: 0, lastX: 0, lastY: 0,
    vx: 0, vy: 0, rvx: 0, rvy: 0, ivx: 0, ivy: 0, seed: 0
  };
}

// Obiekty robocze (bez alokacji na zdarzenie)
const _m = { x: 0, y: 0, angle: 0, scale: 1, density: 1 };
const _hit = { x: 0, y: 0, nx: 0, ny: -1 };
const _imp = { x: 0, y: 0, vx: 0, vy: 0, rvx: 0, rvy: 0, power: 1, flakR: 0, style: 0, r: 1, g: 1, b: 1, width: 6, len: 16, flyAcc: 0 };
const _carrier = createCarrier();
const _carrier2 = createCarrier();
const _slot = { key: null, muzzle: 0 };
const _mz = { x: 0, y: 0, angle: 0, scale: 1 };

// ---------------------------------------------------------------------------

export const WeaponFx = {
  gpu: null,
  projectiles: null,
  trails: null,
  beams: null,
  ctx: null,
  step: null,
  enabled: true,
  _ready: false,
  _busBound: false,
  _frame: 0,
  _lastSyncMs: 0,
  _muzzleBudget: MUZZLE_PER_FRAME,
  _impactBudget: IMPACT_PER_FRAME,
  _weaponShake: 0,
  _states: [],
  _free: [],
  _active: [],
  _after: [],
  _afterCount: 0,
  _burners: [],
  _cont: [],
  _contByUid: new Map(),
  _pulses: [],
  _pulseHead: 0,
  _ricochets: [],
  _ricHead: 0,
  _external: [],
  _hexCharge: [],
  _prjOriginX: 0,
  _prjOriginY: 0,
  _beamOriginX: 0,
  _beamOriginY: 0,
  stats: { shots: 0, muzzles: 0, cheapMuzzles: 0, impacts: 0, cheapImpacts: 0, bullets: 0, beams: 0, pulses: 0, after: 0, droppedAfter: 0 },

  /** Czy moduł działa (urządzenie i scena gotowe). */
  get available() {
    return this.enabled === true && this._ready === true;
  },

  /**
   * Tworzy pule i rejestruje krok efektów w Core3D.fx (raz; wołane z rozgrzewki kadłubów i z
   * sync). Bez Core3D (testy w Node bez sceny) — nic.
   */
  ensure() {
    if (this._ready) return true;
    if (!Core3D.isInitialized || !Core3D.scene || !Core3D.fx) return false;
    const fx = Core3D.fx;
    const noise = fxNoise.tile2D();
    const origin = fx.origin;
    this.gpu = new GpuFx({ origin, noise, grid: fx.grid, distLayer: FX_DISTORT_LAYER }).build(Core3D.scene);
    this.projectiles = new ProjectileSystem({ noise, origin }).build(Core3D.scene);
    this.trails = new TrailSystem({ noise, origin }).build(Core3D.scene);
    this.beams = new BeamSystem({ noise, origin }).build(Core3D.scene);
    for (let i = 0; i < BULLET_STATE_CAP; i++) { const s = createBulletState(); this._states.push(s); this._free.push(s); }
    for (let i = 0; i < AFTER_CAP; i++) this._after.push(createAfter());
    for (let i = 0; i < BURN_CAP; i++) this._burners.push(createBurner());
    for (let i = 0; i < CONT_BEAM_CAP; i++) this._cont.push(createContBeam());
    for (let i = 0; i < PULSE_CAP; i++) this._pulses.push(createPulse());
    for (let i = 0; i < RICOCHET_CAP; i++) this._ricochets.push(createRicochet());
    for (let i = 0; i < EXTERNAL_CAP; i++) this._external.push(createExternal());
    for (let i = 0; i < 8; i++) this._hexCharge.push(createChargeState());
    this.ctx = this._createCtx();
    const self = this;
    this.step = Core3D.addFxStep({
      name: 'weapons',
      spawn(c) { self._stepSpawn(c); },
      update(c) { self._stepUpdate(c); },
      warm(c) { self.gpu.warm(c.renderer, c.core); self._warmSystems(c); }
    });
    this._bindBus();
    this._ready = true;
    return true;
  },

  _warmSystems(c) {
    const core = c.core;
    if (!core?.prewarmPass) return;
    for (const mesh of [this.projectiles.mesh, this.trails.mesh, this.beams.mesh]) {
      const prev = mesh.visible;
      mesh.visible = true;
      core.prewarmPass(mesh, 0);
      mesh.visible = prev;
    }
  },

  _bindBus() {
    if (this._busBound) return;
    this._busListener = (detail) => this._onShot(detail);
    WeaponShotBus.on(this._busListener);
    this._busBound = true;
  },

  // -------------------------------------------------------------------------
  // Adapter ctx dla receptur (PROJEKT-BRONI §1.1)

  _createCtx() {
    const self = this;
    const lights = Core3D.fx.lights;
    return {
      fx: this.gpu,
      lights,
      get time() { return Core3D.fx.time; },
      /** Zdarzenie opóźnione: rodzaj i liczby (bez domknięć), nośnik z ActiveCarrier. */
      after(delay, kind, a0, a1, a2, a3, a4, a5, ref) { self._scheduleAfter(delay, kind, a0, a1, a2, a3, a4, a5, ref); },
      /** Wstrząs kamery: camera.addShake porównany z tym, co zostało (addShake nadpisuje). */
      shake(mag, dur) { self._shake(mag, dur); },
      /** Mapa ran na kadłubie — zadanie 18-C (tu pusto; wywołania receptur zostają). */
      stamp() {},
      /** Płonąca wyrwa w układzie trafionego kadłuba. */
      burn(hull, x, y, nx, ny, dur, power, pal) { self._burn(hull, x, y, nx, ny, dur, power, pal); },
      /** Czy punkt leży na poszyciu (łuki Tempesta) — tylko odczyt kadłuba. */
      hullInside(hull, x, y) { return self._hullInside(hull, x, y); },
      /** Kosmetyczny rykoszet (nigdy w window.bullets). */
      ricochet(x, y, vx, vy, style, r, g, b, width, len, life) { self._ricochet(x, y, vx, vy, style, r, g, b, width, len, life); }
    };
  },

  _shakeAllowed: true,

  _shake(mag, dur) {
    if (!this._shakeAllowed || !(mag > 0)) return;
    const cam = typeof window !== 'undefined' ? window.camera : null;
    if (!cam || typeof cam.addShake !== 'function') return;
    const left = cam.shakeDur > 0 ? cam.shakeMag * Math.max(0, cam.shakeTime / cam.shakeDur) : 0;
    if (mag > left) cam.addShake(mag, dur);
  },

  _hullInside(hull, x, y) {
    if (!hull) return true;
    const HB = typeof window !== 'undefined' ? window.HullBodies : null;
    if (hull.beamHull && HB?.probe) return HB.probe(hull, x, y);
    return true;
  },

  _scheduleAfter(delay, kind, a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, ref = null) {
    if (this._afterCount >= AFTER_CAP) { this.stats.droppedAfter++; return; }
    const e = this._after[this._afterCount++];
    e.t = Core3D.fx.time + Math.max(0, delay);
    e.kind = kind;
    e.a0 = a0; e.a1 = a1; e.a2 = a2; e.a3 = a3; e.a4 = a4; e.a5 = a5;
    e.ref = ref || null;
    e.cvx = ActiveCarrier.vx; e.cvy = ActiveCarrier.vy; e.ct0 = ActiveCarrier.t0; e.cclock = ActiveCarrier.clock;
  },

  _runAfterQueue(time) {
    let n = this._afterCount;
    if (n === 0) return;
    const A = this._after;
    for (let i = n - 1; i >= 0; i--) {
      const e = A[i];
      if (e.t > time) continue;
      _carrier.vx = e.cvx; _carrier.vy = e.cvy; _carrier.t0 = e.ct0; _carrier.clock = e.cclock;
      ActiveCarrier.set(_carrier);
      try { runAfter(this.ctx, e); } finally { ActiveCarrier.clear(); }
      e.ref = null;
      // zamiana z ostatnim (kolejność zdarzeń bez znaczenia)
      n--;
      if (i !== n) { A[i] = A[n]; A[n] = e; }
      this.stats.after++;
    }
    this._afterCount = n;
  },

  _burn(hull, x, y, nx, ny, dur, power, pal) {
    if (!hull) return;
    const B = this._burners;
    let slot = null;
    let oldest = null;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (!b.active) { slot = b; break; }
      if (!oldest || b.age / b.dur > oldest.age / oldest.dur) oldest = b;
    }
    if (!slot) slot = oldest;
    const cx = Number(hull.pos?.x ?? hull.x);
    const cy = Number(hull.pos?.y ?? hull.y);
    const a = Number(hull.angle) || 0;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    const c = Math.cos(a); const s = Math.sin(a);
    const dx = x - cx; const dy = y - cy;
    slot.active = true;
    slot.entity = hull;
    slot.lx = dx * c + dy * s; slot.ly = -dx * s + dy * c;
    slot.lnx = nx * c + ny * s; slot.lny = -nx * s + ny * c;
    slot.age = 0; slot.dur = dur; slot.power = power; slot.pal = pal;
    slot.seed = fxRandom.next() * 100;
  },

  _stepBurners(dt) {
    if (!(dt > 0)) return;
    const B = this._burners;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (!b.active) continue;
      b.age += dt;
      const e = b.entity;
      const cx = Number(e?.pos?.x ?? e?.x);
      const cy = Number(e?.pos?.y ?? e?.y);
      if (b.age >= b.dur || !e || e.removed || !Number.isFinite(cx) || !Number.isFinite(cy)) {
        b.active = false; b.entity = null;
        continue;
      }
      const a = Number(e.angle) || 0;
      const c = Math.cos(a); const s = Math.sin(a);
      b.x = cx + b.lx * c - b.ly * s;
      b.y = cy + b.lx * s + b.ly * c;
      b.nx = b.lnx * c - b.lny * s;
      b.ny = b.lnx * s + b.lny * c;
      if (!this._inView(b.x, b.y, 400)) continue;
      ActiveCarrier.set(writeCarrier(e, b.x, b.y, false, _carrier));
      try { burnStep(this.ctx, b, dt); } finally { ActiveCarrier.clear(); }
    }
  },

  _ricochet(x, y, vx, vy, style, r, g, b, width, len, life) {
    const R = this._ricochets[this._ricHead];
    this._ricHead = (this._ricHead + 1) % RICOCHET_CAP;
    R.active = true;
    R.x = x; R.y = y; R.vx = vx; R.vy = vy;
    R.cvx = ActiveCarrier.vx; R.cvy = ActiveCarrier.vy; R.t0 = ActiveCarrier.t0; R.clock = ActiveCarrier.clock;
    R.ft0 = Core3D.fx.time;
    R.life = life; R.style = style; R.r = r; R.g = g; R.b = b; R.width = width; R.len = len;
    R.seed = fxRandom.next();
  },

  // -------------------------------------------------------------------------
  // Kadr

  _inView(x, y, pad = VIEW_PAD) {
    const v = Core3D.fx?.view;
    if (!v || !(v.x1 > v.x0)) return true;
    return x >= v.x0 - pad && x <= v.x1 + pad && y >= v.y0 - pad && y <= v.y1 + pad;
  },

  _zoom() {
    const z = Number(Core3D.activeCam1?.zoom ?? (typeof window !== 'undefined' ? window.camera?.zoom : 1));
    return z > 0 ? z : 1;
  },

  // -------------------------------------------------------------------------
  // Strzał (szyna) — zdarzenia A–E

  _onShot(detail) {
    if (!this.available || !detail) return;
    const id = detail.weaponId;
    const entry = WEAPON_FX[id];
    if (!entry) return;
    this.stats.shots++;
    const x = Number(detail.x); const y = Number(detail.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const w = weaponCtx(id);
    if (detail.isBeam && detail.beam) {
      const kind = detail.beam.kind || detail.beamMode || detail.beam.mode;
      if (kind === 'continuous') { this._beamContinuousEvent(detail, w); return; }
      this._pulseBeamEvent(detail, w, kind === 'pd' ? BEAM.PD : BEAM.PULSE);
      return;
    }
    this._muzzle(w, x, y, detail.shooter || null, detail.dirX, detail.dirY);
  },

  /**
   * Wylot broni w punkcie (x, y): lufa i kąt z wieżyczki strzelca (Turret2D — odrzut), a bez
   * wieżyczki (myśliwiec) z kierunku strzału. Zwraca true, gdy powstał efekt.
   */
  _muzzle(w, x, y, shooter, dirX, dirY) {
    const recipe = RECIPES[w.fx];
    if (!recipe) return false;
    const key = normalizeWeaponFxKey(w.id);
    const shot = Turret2D.triggerShot(key, x, y, shooter);
    const m = _m;
    if (shot) {
      m.x = shot.x; m.y = shot.y; m.angle = shot.angle; m.scale = shot.scale;
      writeCarrier(shot.entity || shooter, shot.x, shot.y, true, _carrier);
      // Wstrząs strzałów z profilu wieżyczki (jak dawny weapon3DSystem) — 18-D przełączy na dane.
      this._weaponShake = Math.min(WEAPON_SHAKE_CAP, this._weaponShake + (Number(shot.shake) || 0));
      shot.entity = null;
    } else {
      if (!this._inView(x, y, 200)) return false;
      const dl = Math.sqrt(dirX * dirX + dirY * dirY);
      m.x = x; m.y = y;
      m.angle = dl > 1e-6 ? Math.atan2(dirY, dirX) : Number(shooter?.angle) || 0;
      m.scale = Turret2D.turretScaleFor(w.def, shooter);
      writeCarrier(shooter, x, y, false, _carrier);
    }
    return this._emitMuzzle(recipe, w, m, _carrier);
  },

  /** Receptura wylotu z LOD i budżetem klatki (m, nośnik gotowe). */
  _emitMuzzle(recipe, w, m, carrier) {
    const screenPx = 45 * m.scale * this._zoom();
    if (screenPx < MUZZLE_MIN_PX) return false;
    ActiveCarrier.set(carrier);
    try {
      if (screenPx < MUZZLE_RICH_PX || this._muzzleBudget <= 0 || !recipe.muzzle) {
        const c = muzzleColor(w.id);
        cheapMuzzle(this.ctx, m, c[0], c[1], c[2]);
        this.stats.cheapMuzzles++;
        return true;
      }
      this._muzzleBudget--;
      // Gęstość sypkiego materiału schodzi na małych wieżyczkach (rozbłysk zostaje w całości).
      m.density = Math.max(0.35, Math.min(1, 0.35 + 0.65 * Math.min(1, screenPx / 40)));
      if (recipe.preFire) recipe.preFire(this.ctx, m, w);
      recipe.muzzle(this.ctx, m, w);
      this.stats.muzzles++;
    } finally {
      ActiveCarrier.clear();
    }
    return true;
  },

  /**
   * Strzał obrony punktowej gracza (ciwsStep — nie idzie przez szynę): CIWS, flak. Lufa z
   * rekordu wieżyczki p_aux (Turret2D), inaczej z pozycji i kąta działka.
   */
  pdShot(weaponId, x, y, angle, shooter) {
    if (!this.available) return false;
    const w = weaponCtx(weaponId);
    if (!w.fx) return false;
    this.stats.shots++;
    return this._muzzle(w, x, y, shooter, Math.cos(angle), Math.sin(angle));
  },

  /**
   * Wylot receptury broni w punkcie — bez wieżyczki (bez odrzutu i szukania lufy) i bez sekwencji
   * przed strzałem (cewki Tempesta leżą na lufie). Warsztat rdzeni (coreFx3D): wybuch wtórny =
   * wystrzał armaty, kula plazmy = wyładowanie Tempesta (dawniej MuzzleFX3D.fire). Ten sam LOD
   * i budżet klatki co wylot broni; poniżej progu bogatej receptury — nic (jak dawniej).
   */
  muzzleAt(weaponId, x, y, angle, scale = 1, carrier = null) {
    if (!this.available) return false;
    const w = weaponCtx(weaponId);
    const recipe = RECIPES[w.fx];
    if (!recipe?.muzzle || !this._inView(x, y, 400)) return false;
    const m = _m;
    m.x = x; m.y = y; m.angle = angle; m.scale = scale > 0 ? scale : 1;
    const screenPx = 45 * m.scale * this._zoom();
    if (screenPx < MUZZLE_RICH_PX || this._muzzleBudget <= 0) return false;
    this._muzzleBudget--;
    m.density = Math.max(0.35, Math.min(1, 0.35 + 0.65 * Math.min(1, screenPx / 40)));
    ActiveCarrier.set(carrier);
    try {
      recipe.muzzle(this.ctx, m, w);
      this.stats.muzzles++;
    } finally {
      ActiveCarrier.clear();
    }
    return true;
  },

  // -------------------------------------------------------------------------
  // Wiązki (zdarzenia B–E)

  _beamContinuousEvent(detail, w) {
    const beam = detail.beam;
    const uid = beam.emitterUid != null ? beam.emitterUid : null;
    const now = Core3D.fx.time;
    let st = uid !== null ? this._contByUid.get(uid) : null;
    if (!st) {
      st = this._acquireCont();
      st.uid = uid;
      if (uid !== null) this._contByUid.set(uid, st);
      st.charge = 0;
      st.hasKey = false;
      st.seed = fxRandom.next() * 10;
      st.sx = st.tsx = beam.startX; st.sy = st.tsy = beam.startY;
      st.ex = st.tex = beam.endX; st.ey = st.tey = beam.endY;
      st.width = st.tWidth = Math.max(2.5, Number(beam.width) || 5);
    }
    st.active = true;
    st.weaponId = w.id;
    st.tsx = beam.startX; st.tsy = beam.startY;
    st.tex = beam.endX; st.tey = beam.endY;
    st.tWidth = Math.max(2.5, Number(beam.width) || 5);
    st.lastEvent = now;
    st.shooter = detail.shooter || null;
    st.col = beamColor(w.id, RECIPES.beamC.beam.hdr);
    st.hit = !!beam.hitEntity;
    st.hitEntity = beam.hitEntity || null;
    st.hnx = Number.isFinite(beam.nx) ? beam.nx : 0;
    st.hny = Number.isFinite(beam.ny) ? beam.ny : 0;
    if (!st.hasKey && Turret2D.findTurretSlot(beam.startX, beam.startY, normalizeWeaponFxKey(w.id), detail.shooter || null, _slot)) {
      st.key = _slot.key;
      st.muzzle = _slot.muzzle;
      st.hasKey = true;
    }
    this.stats.beams++;
  },

  _acquireCont() {
    const C = this._cont;
    let oldest = null;
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      if (!c.active) return c;
      if (!oldest || c.lastEvent < oldest.lastEvent) oldest = c;
    }
    // pełna pula: przejmij najstarszą
    if (oldest.uid !== null) this._contByUid.delete(oldest.uid);
    oldest.active = false;
    return oldest;
  },

  _pulseBeamEvent(detail, w, style) {
    const beam = detail.beam;
    const recipe = RECIPES[w.fx];
    const shooter = detail.shooter || null;
    const sx = Number(beam.startX); const sy = Number(beam.startY);
    const ex = Number(beam.endX); const ey = Number(beam.endY);
    if (!Number.isFinite(sx + sy + ex + ey)) return;
    this._firePulse(w, recipe, style, sx, sy, ex, ey, shooter, beam.hitEntity || null, beam.nx, beam.ny, Number(beam.width) || 5);
  },

  /**
   * Impuls (wiązka pulsacyjna, laser PD): wylot z wieżyczki, front biegnie do celu
   * (PULSE_SPEED), trafienie po dojściu — sam obraz (obrażenia liczy gra). Pierścień o stałej
   * pojemności — najstarszy nadpisywany.
   */
  _firePulse(w, recipe, style, sx, sy, ex, ey, shooter, hitEntity, nx, ny, gameWidth) {
    const inView = this._inView(sx, sy) || this._inView(ex, ey);
    // wylot (błysk, odrzut wieżyczki) — też poza kadrem: odrzut prowadzi Turret2D
    const dx = ex - sx; const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this._muzzle(w, sx, sy, shooter, dist > 1e-6 ? dx / dist : 1, dist > 1e-6 ? dy / dist : 0);
    if (!inView) return;
    const P = this._pulses[this._pulseHead];
    this._pulseHead = (this._pulseHead + 1) % PULSE_CAP;
    if (P.active && P.hit && !P.hitDone) P.hitEntity = null;
    const cfg = recipe?.beam || RECIPES.beamP.beam;
    P.active = true;
    P.style = style;
    P.family = w.fx;
    P.x0 = sx; P.y0 = sy; P.x1 = ex; P.y1 = ey;
    writeCarrier(shooter, sx, sy, false, _carrier2);
    P.cvx = _carrier2.vx; P.cvy = _carrier2.vy; P.ct0 = _carrier2.t0; P.cclock = _carrier2.clock;
    P.width = cfg.width * (style === BEAM.PULSE ? Math.max(0.6, gameWidth / 5) : 1);
    P.col = beamColor(w.id, cfg.hdr);
    P.life = cfg.life;
    P.age = 0;
    P.hitAt = style === BEAM.PULSE ? dist / PULSE_SPEED : 0.01;
    P.hitDone = false;
    P.hit = !!hitEntity;
    P.hitEntity = hitEntity || null;
    const nl = Math.sqrt(nx * nx + ny * ny);
    if (nl > 1e-6) { P.hnx = nx / nl; P.hny = ny / nl; } else { P.hnx = dist > 1e-6 ? -dx / dist : 0; P.hny = dist > 1e-6 ? -dy / dist : -1; }
    P.seed = fxRandom.next() * 10;
    this.stats.pulses++;
  },

  /**
   * Laser obrony punktowej gracza (ciwsStep): wylot z wieżyczki p_aux, impuls do celu, trafienie.
   * Rakietę zestrzeloną laserem obsługuje dodatkowo spawnBulletImpactEffect (wybuch).
   */
  pdLaser(weaponId, x0, y0, x1, y1, shooter, target) {
    if (!this.available) return false;
    const w = weaponCtx(weaponId);
    const recipe = RECIPES[w.fx] || RECIPES.laserPD;
    this.stats.shots++;
    this._firePulse(w, recipe, BEAM.PD, x0, y0, x1, y1, shooter, target || null, x0 - x1, y0 - y1, 5);
    return true;
  },

  // Wiązki tej klatki (krok spawn): ciągłe — rampa, początek z lufy, emisja przy trafieniu;
  // impulsy — wiek, trafienie po dojściu frontu, rysunek z nośnikiem.
  _stepBeams(c) {
    const beams = this.beams;
    beams.begin();
    const o = Core3D.fx.origin;
    const ox = o.x; const oy = o.y;
    this._beamOriginX = ox; this._beamOriginY = oy;
    const time = c.time;
    const dt = c.dt;
    const cfgC = RECIPES.beamC.beam;
    const C = this._cont;
    for (let i = 0; i < C.length; i++) {
      const b = C[i];
      if (!b.active) continue;
      const since = time - b.lastEvent;
      const recent = since <= 0.18;
      b.charge = recent ? Math.min(1, b.charge + dt * cfgC.rampUp) : Math.max(0, b.charge - dt * cfgC.rampDown);
      if (since > 0.55 && b.charge <= 0.002) {
        b.active = false;
        if (b.uid !== null && this._contByUid.get(b.uid) === b) this._contByUid.delete(b.uid);
        b.hitEntity = null; b.shooter = null;
        continue;
      }
      if (b.charge <= 0.001) continue;
      // początek z lufy tej klatki (Turret2D), koniec goni cel (jak dawny wizual)
      let angle;
      if (b.hasKey && Turret2D.resolveMuzzleSlot(b.key, b.muzzle, _mz)) {
        const shx = _mz.x - b.tsx; const shy = _mz.y - b.tsy;
        if (since > 0.001 && recent) { b.tex += shx; b.tey += shy; }
        b.tsx = _mz.x; b.tsy = _mz.y;
      }
      b.sx = b.tsx; b.sy = b.tsy;
      const jx = b.tex - b.ex; const jy = b.tey - b.ey;
      if (jx * jx + jy * jy > 600 * 600) { b.ex = b.tex; b.ey = b.tey; }
      else {
        const f = Math.min(1, dt * (recent ? 30 : 16));
        b.ex += jx * f; b.ey += jy * f;
      }
      b.width += (b.tWidth - b.width) * Math.min(1, dt * 14);
      const dx = b.ex - b.sx; const dy = b.ey - b.sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1e-3) continue;
      angle = Math.atan2(dy, dx);
      if (!this._inView(b.sx, b.sy) && !this._inView(b.ex, b.ey)) continue;
      const width = cfgC.width * (b.tWidth / 5) * (0.3 + 0.7 * Math.sqrt(b.charge));
      beams.addRgb(b.sx - ox, -b.sy - oy, b.ex - ox, -b.ey - oy, BEAM.CONT, width, b.col[0], b.col[1], b.col[2], b.charge, b.seed, time);
      // emisja: soczewka i punkt trafienia (iskry jadą z trafionym kadłubem)
      _mz.x = b.sx; _mz.y = b.sy; _mz.angle = angle; _mz.scale = 1;
      let hitObj = null;
      if (b.hit && recent) {
        _hit.x = b.ex; _hit.y = b.ey;
        const nl = Math.sqrt(b.hnx * b.hnx + b.hny * b.hny);
        if (nl > 1e-6) { _hit.nx = b.hnx / nl; _hit.ny = b.hny / nl; } else { _hit.nx = -dx / dist; _hit.ny = -dy / dist; }
        hitObj = _hit;
        ActiveCarrier.set(writeCarrier(b.hitEntity, b.ex, b.ey, false, _carrier));
      } else {
        ActiveCarrier.set(writeCarrier(b.shooter, b.sx, b.sy, false, _carrier));
      }
      try { RECIPES.beamC.emit(this.ctx, _mz, hitObj, b.charge, dt, hitObj ? b.hitEntity : null); } finally { ActiveCarrier.clear(); }
    }
    // impulsy
    const P = this._pulses;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (!p.active) continue;
      p.age += dt;
      if (!p.hitDone && p.age >= p.hitAt) {
        p.hitDone = true;
        if (p.hit) {
          const recipe = RECIPES[p.family];
          const T = SimClock.now(p.cclock) - p.ct0;
          _hit.x = p.x1 + p.cvx * T; _hit.y = p.y1 + p.cvy * T;
          _hit.nx = p.hnx; _hit.ny = p.hny;
          if (recipe?.impact && this._inView(_hit.x, _hit.y, 200)) {
            ActiveCarrier.set(writeCarrier(p.hitEntity, _hit.x, _hit.y, false, _carrier));
            try { recipe.impact(this.ctx, p.hitEntity, _hit); } finally { ActiveCarrier.clear(); }
          }
          p.hitEntity = null;
        }
      }
      if (p.age >= p.life) { p.active = false; p.hitEntity = null; continue; }
      const u = p.age / p.life;
      const power = Math.pow(1 - u, 1.2);
      const wdt = p.width * (0.45 + 0.75 * (1 - u));
      const T = SimClock.now(p.cclock) - p.ct0;
      const ax = p.x0 + p.cvx * T; const ay = p.y0 + p.cvy * T;
      const bx = p.x1 + p.cvx * T; const by = p.y1 + p.cvy * T;
      beams.addRgb(ax - ox, -ay - oy, bx - ox, -by - oy, p.style, wdt, p.col[0], p.col[1], p.col[2], power, p.seed, p.age);
      if (p.hit && p.style === BEAM.PULSE && p.age >= p.hitAt) this.ctx.lights.point(bx, by, 1.0, 0.3, 0.3, 2 * power, 180, 30);
    }
  },

  // -------------------------------------------------------------------------
  // Trafienie (zdarzenia G–I) — z spawnBulletImpactEffect, po bramkach kadru i cooldownu

  /**
   * Trafienie pocisku `b` w (x, y). hit = { nx, ny, entity, relVx, relVy, kind } z
   * writeImpactHit (index.html) albo null. ActiveCarrier ustawia wołający (trafiony kadłub).
   */
  impact(b, x, y, scale = 1, hit = null) {
    if (!this.available || !b) return false;
    this.stats.impacts++;
    // koniec smugi pocisku w punkcie trafienia
    const st = b.__fx;
    if (st && st.bullet === b) { st.endX = x; st.endY = y; st.endSet = true; }
    let family = projectileFamilyFor(b);
    const hx = hit ? hit.nx : 0; const hy = hit ? hit.ny : 0;
    const relVx = hit ? hit.relVx : (Number(b.vx) || 0) - (Number(b.ivx) || 0);
    const relVy = hit ? hit.relVy : (Number(b.vy) || 0) - (Number(b.ivy) || 0);
    _hit.x = x; _hit.y = y;
    const nl = Math.sqrt(hx * hx + hy * hy);
    if (nl > 1e-6) { _hit.nx = hx / nl; _hit.ny = hy / nl; }
    else {
      const vl = Math.sqrt(relVx * relVx + relVy * relVy);
      _hit.nx = vl > 1e-6 ? -relVx / vl : 0; _hit.ny = vl > 1e-6 ? -relVy / vl : -1;
    }
    // wstrząs z trafień tylko dla gracza (strzelał albo oberwał) — bitwa NPC nie trzęsie kamerą
    const player = typeof window !== 'undefined' ? window.ship : null;
    const p2 = typeof window !== 'undefined' ? window.player2Ship : null;
    const ent = hit?.entity || null;
    this._shakeAllowed = b.owner === 'player' || b.owner === 'player2' || (ent && (ent === player || ent === p2));
    try {
      if (!family) {
        // rakieta / torpeda w tablicy bullets: zestrzelona rakieta — mały wybuch (do 19),
        // torpeda w kadłub — wybuch armatni
        if (b.type === 'torpedo' && ent) family = 'armata';
        else { droneBlast(this.ctx, x, y, 42 * Math.max(0.6, Math.min(1.6, scale))); return true; }
      }
      const recipe = RECIPES[family];
      if (!recipe?.impact) return false;
      if (this._impactBudget <= 0) {
        const conf = projectileConf(family, b.weaponSize || 'M');
        cheapImpact(this.ctx, x, y, conf.color[0], conf.color[1], conf.color[2], 26 * scale);
        this.stats.cheapImpacts++;
        return true;
      }
      this._impactBudget--;
      const conf = family === 'armata' && b.type === 'torpedo' ? _torpedoConf : projectileConf(family, b.weaponSize || 'M');
      const p = _imp;
      p.x = x; p.y = y;
      p.vx = relVx; p.vy = relVy; p.rvx = relVx; p.rvy = relVy;
      p.power = SIZE_POWER[b.weaponSize] || 1;
      p.flakR = Number(b.flakBurstRadius) || 0;
      p.style = conf.style; p.r = conf.color[0]; p.g = conf.color[1]; p.b = conf.color[2];
      p.width = conf.width; p.len = conf.len;
      const hull = hit && hit.kind === 'hull' ? ent : null;
      recipe.impact(this.ctx, p, hull, _hit);
    } finally {
      this._shakeAllowed = true;
    }
    return true;
  },

  /** Pęknięcie pocisku flaku (detonateFlakShell) — ActiveCarrier ustawia wołający (pęd pocisku). */
  flakBurst(b, x, y, radius) {
    if (!this.available) return false;
    if (!this._inView(x, y, radius * 2)) return false;
    const st = b?.__fx;
    if (st && st.bullet === b) { st.endX = x; st.endY = y; st.endSet = true; }
    this._shakeAllowed = b?.owner === 'player' || b?.owner === 'player2';
    try { RECIPES.flak.burst(this.ctx, x, y, radius); } finally { this._shakeAllowed = true; }
    return true;
  },

  /**
   * Wybuch drona z dema (promień `size`, jak zestrzelona rakieta): śmierć NPC i platformy
   * (CanvasVFX.spawnExplosionPlasma / spawnDefaultHit — dawniej fabryka trafienia działka
   * w overlayu). Liczy się do budżetu trafień klatki; ActiveCarrier ustawia wołający.
   */
  droneBlast(x, y, size = 42) {
    if (!this.available || !(size > 0) || !this._inView(x, y, size * 4)) return false;
    if (this._impactBudget <= 0) return false;
    this._impactBudget--;
    droneBlast(this.ctx, x, y, size);
    return true;
  },

  // -------------------------------------------------------------------------
  // Hexlance (zdarzenie K) — superweapon.js woła wprost

  /** Ładowanie działa `index` (stan na działo): u — postęp 0..1. */
  hexlanceCharge(x, y, dirX, dirY, dt, u, carrier, index = 0) {
    if (!this.available || !(dt > 0)) return;
    if (!this._inView(x, y, 1500)) return;
    const cs = this._hexCharge[Math.max(0, Math.min(this._hexCharge.length - 1, index | 0))];
    _mz.x = x; _mz.y = y; _mz.angle = Math.atan2(dirY, dirX); _mz.scale = 1;
    if (carrier) ActiveCarrier.set(carrier);
    try { RECIPES.hexlance.charge(this.ctx, _mz, Math.max(0, Math.min(1, u)), dt, cs); } finally { ActiveCarrier.clear(); }
  },

  hexlanceFire(x, y, dirX, dirY, carrier) {
    if (!this.available) return;
    _mz.x = x; _mz.y = y; _mz.angle = Math.atan2(dirY, dirX); _mz.scale = 1;
    if (carrier) ActiveCarrier.set(carrier);
    try { RECIPES.hexlance.muzzle(this.ctx, _mz, weaponCtx('hexlance_siege')); } finally { ActiveCarrier.clear(); }
  },

  /**
   * Pocisk Hexlance'a (spoza tablicy bullets): smuga i igła. vx, vy — prędkość (świat),
   * ivx, ivy — odziedziczona po okręcie (nośnik smugi). Zwraca uchwyt albo null.
   */
  hexlanceBegin(x, y, vx, vy, ivx = 0, ivy = 0) {
    if (!this.available) return null;
    const E = this._external;
    let h = null;
    for (let i = 0; i < E.length; i++) if (!E[i].active) { h = E[i]; break; }
    if (!h) return null;
    const recipe = RECIPES.hexlance;
    const conf = projectileConf('hexlance', 'Capital');
    h.active = true;
    h.family = 'hexlance'; h.recipe = recipe; h.conf = conf;
    h.x = h.lastX = x; h.y = h.lastY = y;
    h.vx = vx; h.vy = vy; h.ivx = ivx; h.ivy = ivy; h.rvx = vx - ivx; h.rvy = vy - ivy;
    h.flyAcc = 0;
    h.seed = fxRandom.next();
    h.trail = this.trails.begin(conf.trail, x, y, h.rvx, h.rvy, conf.trailWidth, conf.trailSpacing, conf.trailPathUnit, ivx, ivy, SimClock.sim, CLOCK_SIM);
    return h;
  },

  hexlanceStep(h, x0, y0, x1, y1, vx, vy) {
    if (!h || !h.active) return;
    h.lastX = x0; h.lastY = y0; h.x = x1; h.y = y1;
    h.vx = vx; h.vy = vy; h.rvx = vx - h.ivx; h.rvy = vy - h.ivy;
    if (h.trail) this.trails.advance(h.trail, x1, y1, SimClock.sim);
    if (this._inView(x1, y1)) {
      ActiveCarrier.set(writeCarrierVelocity(h.ivx, h.ivy, CLOCK_SIM, SimClock.sim, _carrier));
      try { h.recipe.fly(this.ctx, h, x0, y0, x1, y1); } finally { ActiveCarrier.clear(); }
      const L = h.conf.light;
      if (L) Core3D.fx.lights.point(x1, y1, L[0], L[1], L[2], L[3], L[4], 30);
    }
  },

  hexlanceEnd(h, x, y) {
    if (!h || !h.active) return;
    if (h.trail) this.trails.end(h.trail, x, y, SimClock.sim);
    h.trail = null;
    h.active = false;
  },

  /**
   * Wejście w kadłub: rozbłysk (raz na cel). relV — prędkość pocisku względem celu (albo sam
   * kierunek). power — moc receptury (strumień reaktora: moc klasy rdzenia), shake — czy wolno
   * trząść kamerą (strumień reaktora: nie, jak dawny RailgunFX3D).
   */
  hexlanceImpact(x, y, relVx, relVy, carrier = null, power = 1, shake = true) {
    if (!this.available || !this._inView(x, y, 1200)) return;
    const p = _imp;
    p.x = x; p.y = y; p.vx = relVx; p.vy = relVy;
    _hit.x = x; _hit.y = y;
    const l = Math.sqrt(relVx * relVx + relVy * relVy) || 1;
    _hit.nx = -relVx / l; _hit.ny = -relVy / l;
    if (carrier) ActiveCarrier.set(carrier);
    this._shakeAllowed = shake;
    try { RECIPES.hexlance.impact(this.ctx, p, null, _hit, power); } finally { ActiveCarrier.clear(); this._shakeAllowed = true; }
  },

  /** Rzaz w kadłubie (co odstęp cięcia). power — jak w hexlanceImpact. */
  hexlanceKerf(x, y, relVx, relVy, carrier = null, power = 1) {
    if (!this.available || !this._inView(x, y, 800)) return;
    const p = _imp;
    p.x = x; p.y = y; p.vx = relVx; p.vy = relVy;
    if (carrier) ActiveCarrier.set(carrier);
    try { RECIPES.hexlance.kerf(this.ctx, p, null, power); } finally { ActiveCarrier.clear(); }
  },

  /** Wyjście z kadłuba: stożek stopionego metalu za burtą. */
  hexlanceExit(x, y, relVx, relVy, carrier) {
    if (!this.available || !this._inView(x, y, 1200)) return;
    const p = _imp;
    p.x = x; p.y = y; p.vx = relVx; p.vy = relVy;
    if (carrier) ActiveCarrier.set(carrier);
    try { RECIPES.hexlance.exit(this.ctx, p, null); } finally { ActiveCarrier.clear(); }
  },

  /**
   * Ładowanie działa z czasem ładowania (Mjolnir, Valkyrie — mechanikę wpina 18-B):
   * state z createChargeState() na działo.
   */
  charge(weaponId, x, y, angle, scale, u, dt, state, carrier = null) {
    if (!this.available || !(dt > 0) || !state) return;
    const recipe = RECIPES[WEAPON_FX[weaponId]?.fx];
    if (!recipe?.charge || !this._inView(x, y, 1200)) return;
    _mz.x = x; _mz.y = y; _mz.angle = angle; _mz.scale = scale || 1;
    if (carrier) ActiveCarrier.set(carrier);
    try { recipe.charge(this.ctx, _mz, Math.max(0, Math.min(1, u)), dt, state); } finally { ActiveCarrier.clear(); }
  },

  createChargeState,

  // -------------------------------------------------------------------------
  // Pociski w locie (zdarzenie F) — raz na klatkę renderu

  /**
   * Co klatkę renderu (updateHexShips3D, po Turret2D.sync): stan pocisków (styl, smuga,
   * lot, światło), bufor rysunku pocisków, wstrząs strzałów, bank Fx3D.
   */
  sync(bullets) {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = this._lastSyncMs > 0 ? Math.max(0.001, Math.min(0.05, (nowMs - this._lastSyncMs) * 0.001)) : 1 / 60;
    this._lastSyncMs = nowMs;
    // Bank cząstek Fx3D (iskry dysz MAIN, mostki, rdzenie) — dokładnie raz na klatkę renderu
    // (dawniej Weapon3DSystem.syncProjectiles).
    Fx3D.update(dt);
    this._updateWeaponShake(dt);
    if (!this.ensure()) return;
    this._frame++;
    this._muzzleBudget = MUZZLE_PER_FRAME;
    this._impactBudget = IMPACT_PER_FRAME;
    const frame = this._frame;
    const list = Array.isArray(bullets) ? bullets : [];
    const renderLag = Math.max(0, SimClock.sim - SimClock.render);
    const trails = this.trails;
    trails.time = Core3D.fx.time;
    const proj = this.projectiles;
    proj.begin();
    const o = Core3D.fx.origin;
    const ox = o.x; const oy = o.y;
    this._prjOriginX = ox; this._prjOriginY = oy;
    const lights = Core3D.fx.lights;
    let live = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || !(b.life > 0)) continue;
      const bx = Number(b.x); const by = Number(b.y);
      if (!Number.isFinite(bx) || !Number.isFinite(by)) continue;
      if (b.forceCanvas) { b.__renderedByThree = false; continue; }
      b.__renderedByThree = true;
      let st = b.__fx;
      const vx = Number(b.vx) || 0; const vy = Number(b.vy) || 0;
      const lag = b.clock === CLOCK_RENDER ? renderLag : 0;
      const x = bx - vx * lag;
      const y = by - vy * lag;
      if (!st || st.bullet !== b) {
        st = this._free.pop() || null;
        if (!st) continue;
        this._initBulletState(st, b, x, y, vx, vy);
        b.__fx = st;
        this._active.push(st);
      }
      st.frame = frame;
      live++;
      const ivx = st.ivx; const ivy = st.ivy;
      st.rvx = vx - ivx; st.rvy = vy - ivy;
      const ct = b.clock === CLOCK_RENDER ? SimClock.render : SimClock.sim;
      const inView = this._inView(x, y);
      if (st.trail) trails.advance(st.trail, x, y, ct);
      if (inView) {
        if (st.recipe?.fly) {
          ActiveCarrier.set(writeCarrierVelocity(ivx, ivy, st.clock, ct, _carrier));
          try { st.recipe.fly(this.ctx, st, st.lastX, st.lastY, x, y); } finally { ActiveCarrier.clear(); }
        }
        const L = st.conf.light;
        if (L) lights.point(x, y, L[0], L[1], L[2], L[3], L[4], 30);
        this._addProjectile(st.conf, x, y, st.rvx, st.rvy, Number(b.age) || 0, st.wScale, st.seed, ox, oy);
      }
      st.lastX = x; st.lastY = y;
    }
    this.stats.bullets = live;
    // pociski, których już nie ma w tablicy: smuga domknięta w punkcie trafienia albo ostatniej pozie
    const A = this._active;
    for (let i = A.length - 1; i >= 0; i--) {
      const st = A[i];
      if (st.frame === frame) continue;
      if (st.trail) {
        trails.end(st.trail, st.endSet ? st.endX : st.lastX, st.endSet ? st.endY : st.lastY, st.clock === CLOCK_RENDER ? SimClock.render : SimClock.sim);
        st.trail = null;
      }
      if (st.bullet && st.bullet.__fx === st) st.bullet.__fx = null;
      st.bullet = null;
      st.active = false;
      const last = A.pop();
      if (i < A.length) A[i] = last;
      this._free.push(st);
    }
    // kosmetyczne rykoszety i pociski spoza tablicy (Hexlance)
    this._syncRicochets(ox, oy);
    this._syncExternal(ox, oy);
  },

  _initBulletState(st, b, x, y, vx, vy) {
    st.bullet = b;
    st.active = true;
    let family = projectileFamilyFor(b);
    let conf;
    if (family) conf = projectileConf(family, b.weaponSize || 'M');
    else if (b.type === 'torpedo') conf = _torpedoConf;
    else conf = _rocketConf;
    st.family = family;
    st.recipe = family ? RECIPES[family] : null;
    st.conf = conf;
    st.flyAcc = 0;
    st.seed = fxRandom.next();
    st.ivx = Number(b.ivx) || 0; st.ivy = Number(b.ivy) || 0;
    st.clock = b.clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
    st.power = SIZE_POWER[b.weaponSize] || 1;
    st.endSet = false;
    // grubość pocisku wg klasy okrętu strzelca (dawny weapon3DSystem: WEAPON_TIER_SCALE.bullet)
    const tier = b.source ? getEntityWeaponTier(b.source) : 'Capital';
    st.wScale = (WEAPON_TIER_SCALE[tier] || WEAPON_TIER_SCALE.Capital).bullet;
    // początek smugi: wylot (pocisk mógł już przelecieć kawałek — x − v·wiek)
    const age = Math.max(0, Number(b.age) || 0);
    const rvx = vx - st.ivx; const rvy = vy - st.ivy;
    const sx = x - vx * age; const sy = y - vy * age;
    st.lastX = x - rvx * Math.min(age, 1 / 60) ; st.lastY = y - rvy * Math.min(age, 1 / 60);
    st.trail = null;
    if (conf.trail >= 0 && this._inView(x, y, 2000)) {
      const ct = (st.clock === CLOCK_RENDER ? SimClock.render : SimClock.sim) - age;
      st.trail = this.trails.begin(conf.trail, sx, sy, rvx, rvy, conf.trailWidth * st.wScale, conf.trailSpacing, conf.trailPathUnit, st.ivx, st.ivy, ct, st.clock);
    }
  },

  /** Pocisk do bufora rysunku: kierunek i długość z ruchu względem strzelca (rvx, rvy). */
  _addProjectile(conf, x, y, rvx, rvy, age, wScale, seed, ox, oy) {
    const spd = Math.sqrt(rvx * rvx + rvy * rvy);
    let dxs = 1; let dys = 0;
    if (spd > 1e-3) { dxs = rvx / spd; dys = -rvy / spd; }
    const grow = Math.min(1, age * 40 + 0.15);
    const len = (conf.len * wScale + spd * conf.streak) * grow;
    const c = conf.color;
    this.projectiles.add(x - ox, -y - oy, 14, conf.style, dxs, dys, len, conf.width * wScale, c[0], c[1], c[2], seed);
  },

  _syncRicochets(ox, oy) {
    const R = this._ricochets;
    const t = Core3D.fx.time;
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r.active) continue;
      const age = t - r.ft0;
      if (age >= r.life) { r.active = false; continue; }
      const T = SimClock.now(r.clock) - r.t0;
      const x = r.x + r.vx * age + r.cvx * T;
      const y = r.y + r.vy * age + r.cvy * T;
      if (!this._inView(x, y)) continue;
      const k = 1 - age / r.life;
      const spd = Math.sqrt(r.vx * r.vx + r.vy * r.vy) || 1;
      this.projectiles.add(x - ox, -y - oy, 14, r.style, r.vx / spd, -r.vy / spd, r.len, r.width, r.r * k, r.g * k, r.b * k, r.seed);
    }
  },

  _syncExternal(ox, oy) {
    const E = this._external;
    for (let i = 0; i < E.length; i++) {
      const h = E[i];
      if (!h.active || !this._inView(h.x, h.y)) continue;
      this._addProjectile(h.conf, h.x, h.y, h.rvx, h.rvy, 1, 1, h.seed, ox, oy);
    }
  },

  // Wstrząs strzałów z profilu wieżyczek (window.__weapon3dCameraShake — czyta render() w
  // index.html przez cameraShakeAmplitudePx). Bez losowania (dawniej Math.random w x/y).
  _updateWeaponShake(dt) {
    if (typeof window === 'undefined') return;
    const out = window.__weapon3dCameraShake || (window.__weapon3dCameraShake = { x: 0, y: 0, mag: 0 });
    this._weaponShake *= Math.exp(-8.0 * dt);
    if (this._weaponShake < 0.01) this._weaponShake = 0;
    out.mag = this._weaponShake;
    out.x = 0;
    out.y = 0;
  },

  /** Dokłada wstrząs strzałów (np. rakieta Supernowa — 19). */
  addWeaponShake(mag) {
    this._weaponShake = Math.min(WEAPON_SHAKE_CAP, this._weaponShake + (Number(mag) || 0));
  },

  get weaponShake() { return this._weaponShake; },
  set weaponShake(v) { this._weaponShake = Math.max(0, Math.min(WEAPON_SHAKE_CAP, Number(v) || 0)); },

  // -------------------------------------------------------------------------
  // Kroki klatki efektów (Core3D.fx)

  _stepSpawn(c) {
    const dt = c.dt;
    this._runAfterQueue(c.time);
    this._stepBurners(dt);
    this._stepBeams(c);
    this.trails.upload();
    this.gpu.spawn(c.renderer, c.time);
  },

  _stepUpdate(c) {
    const zoom = this._zoom();
    this.gpu.update(c.renderer, c.dt, zoom);
    const o = c.origin;
    this.trails.place(o.x, o.y);
    this.projectiles.commit(zoom);
    this.projectiles.place(this._prjOriginX, this._prjOriginY);
    this.beams.commit(zoom, this._beamOriginX, this._beamOriginY);
    Core3D.setDistortLayerActive(this.gpu.distLive);
  },

  /** Rozgrzewka (ekran ładowania): pule i krok efektów przed pierwszym strzałem. */
  prewarm() {
    return this.ensure();
  },

  /** Nowa gra / sprzątanie sceny: stany, kolejki i pule od zera (bez zwalniania GPU). */
  reset() {
    this._weaponShake = 0;
    if (typeof window !== 'undefined' && window.__weapon3dCameraShake) {
      window.__weapon3dCameraShake.mag = 0;
      window.__weapon3dCameraShake.x = 0;
      window.__weapon3dCameraShake.y = 0;
    }
    if (!this._ready) return;
    const A = this._active;
    for (let i = 0; i < A.length; i++) {
      const st = A[i];
      if (st.trail) this.trails.drop(st.trail);
      st.trail = null;
      if (st.bullet && st.bullet.__fx === st) st.bullet.__fx = null;
      st.bullet = null;
      st.active = false;
      this._free.push(st);
    }
    A.length = 0;
    for (const e of this._after) e.ref = null;
    this._afterCount = 0;
    for (const b of this._burners) { b.active = false; b.entity = null; }
    for (const b of this._cont) { b.active = false; b.hitEntity = null; b.shooter = null; }
    this._contByUid.clear();
    for (const p of this._pulses) { p.active = false; p.hitEntity = null; }
    for (const r of this._ricochets) r.active = false;
    for (const h of this._external) { if (h.trail) this.trails.drop(h.trail); h.trail = null; h.active = false; }
    this.gpu.reset();
    this.trails.reset();
    this.projectiles.begin();
    this.projectiles.commit(1);
    this.beams.begin();
    this.beams.commit(1, 0, 0);
  }
};

if (typeof window !== 'undefined') window.WeaponFx = WeaponFx;
