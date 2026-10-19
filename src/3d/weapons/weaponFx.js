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
import { RenderWorld } from '../../render/renderWorld.js';
import { GpuFx } from './gpuFx.js';
import { ProjectileSystem, PSTYLE } from './projectiles.js';
import { TrailSystem } from './trails.js';
import { BeamSystem, BEAM, PULSE_SPEED } from './beams.js';
import { RECIPES, runAfter, burnStep, droneBlast, bombBlast, bombDud, cheapMuzzle, cheapImpact, createChargeState, deathRayPalette } from './recipes.js';
import { WEAPON_FX, projectileFamilyFor, hexHdr, SIZE_POWER, TRAIL_FAMILIES } from './weaponFxTable.js';
import { RAY_HIT, RAY_STATE, RAY_FLAG } from '../../render/renderCommands.js';
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
import { weaponImpactScale } from '../../game/weaponFeel.js';
import { HullDamageMap } from '../hullDamageMap.js';

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
/** Znaków rzazu pocisku przebijającego na jedno wywołanie (po przerzedzeniu jak w demie — niżej). */
export const KERF_PER_CALL = 16;
/** Promieni śmierci naraz (obraz; src/game/deathRay.js — DEATH_RAY_CAP). */
export const RAY_FX_CAP = 16;
/** Trafień zapamiętanych na promień (punkty wejścia / wyjścia / końca — żar w trakcie trwania wiązki). */
export const RAY_HIT_SLOTS = 8;
/** Stanów ładowania promienia naraz (laser naprowadzający, implozja — co klatkę renderu). */
export const RAY_HOLD_CAP = 8;
/** Mnożnik HDR barwy ciała promienia (barwa broni liniowo × k): środek ciała przy progu bloomu, jądro ponad nim. */
export const RAY_HDR = 1.3;
/** Najwięcej świateł punktowych wzdłuż jednej wiązki (poza wylotem i końcem). */
const RAY_LIGHTS = 4;
/** Podkrok symulacji pocisków dema [Hz]: najwyżej jeden znak rzazu na podkrok (odstęp v / 240). */
const KERF_DEMO_HZ = 240;
/** Zapas kadru dla efektów pocisków (ułamek kadru siatki Core3D.fx.view). */
const VIEW_PAD = 600;
/**
 * Wygląd pocisków w locie (2026-10-13, zgłoszenie „feel strzelania”; strojenie na żywo
 * `window.ProjectileLook`, A/B: scripts/webgpu/lot-pocisku-gra.mjs --bron salwa):
 *  - shutter — MIGAWKA: smuga nie krótsza niż droga pocisku względem strzelca w czasie klatki ×
 *    shutter (0 — wył.). Szybki pocisk (7–15 tys. j/s → 120–250 j. na klatkę przy 60 kl/s) bywał
 *    krótszy niż skok między klatkami i migał zamiast lecieć. Nie dłuższa niż droga od wylotu (bez
 *    ogona za lufą); czas klatki wygładzony (_frameDt), sufit 1/30 s.
 *  - minPx — najmniejsza szerokość pocisku na ekranie [px] wg rozmiaru broni (przy domyślnym kadrze
 *    ~0,18 pociski miały 1–3 px), najwyżej × minGrow naturalnej szerokości — przy dalekim zoomie
 *    pocisk nie puchnie w kulę (czytelność daje tam rdzeń pikselowy).
 *  - pixelCore — siła rdzenia pikselowego w shaderze (projectiles.js; 0 — wył.).
 */
export const PROJECTILE_LOOK = {
  shutter: 1.15,
  minPx: { S: 2.5, M: 3.5, L: 4.5, Capital: 6 },
  minGrow: 2.5,
  pixelCore: 1
};

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
    // Smuga gazu tylko rodzinom z TRAIL_FAMILIES (zwykłe pociski bez śladu — weaponFxTable.js).
    if (!TRAIL_FAMILIES.has(family)) c.trail = -1;
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
    wScale: 1, minW: 0, endX: 0, endY: 0, endSet: false, clock: CLOCK_SIM, ivx: 0, ivy: 0, visible: false
  };
}
function createAfter() {
  return { t: 0, kind: 0, a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, ref: null, cvx: 0, cvy: 0, ct0: 0, cclock: CLOCK_SIM };
}
function createBurner() {
  return { active: false, entity: null, lx: 0, ly: 0, lnx: 0, lny: 0, x: 0, y: 0, nx: 0, ny: 0, age: 0, dur: 1, power: 1, pal: 'armata', seed: 0, stampAcc: 0 };
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
// Promień śmierci (obraz): wylot w układzie strzelca (lx, ly — kąt encji) albo stały punkt (x0, y0 + nośnik), kierunek
// świata, długość (skraca ją RAY_STATE), czoło z czasu, barwa i paleta, trafienia (żar przy kadłubie).
function createRayFx() {
  const hits = [];
  for (let i = 0; i < RAY_HIT_SLOTS; i++) hits.push({ active: false, kind: 0, entity: null, lx: 0, ly: 0, x: 0, y: 0, la: 0, t: 0 });
  return {
    active: false, id: 0, weaponId: null, shooter: null, visual: false, player: false, endFlash: false, endDone: false,
    x0: 0, y0: 0, lx: 0, ly: 0, z0: 0, z1: 0, dx: 1, dy: 0, len: 0, speed: 30000, width: 150, sustain: 1, fade: 0.5,
    age: 0, t0: 0, life: 0, front: 0, fadeAt: Infinity, col: [1, 1, 1], pal: null, seed: 0,
    cvx: 0, cvy: 0, ct0: 0, cclock: CLOCK_SIM, sx: 0, sy: 0, hits, hitCount: 0
  };
}
// Ładowanie promienia (stan efektu działa → wpis): laser naprowadzający, implozja i światło co klatkę renderu.
function createRayHold() {
  return { active: false, owner: null, x: 0, y: 0, z: 0, angle: 0, u: 0, scale: 1, len: 0, t: 0, pal: null, col: [1, 1, 1], cvx: 0, cvy: 0, ct0: 0, cclock: CLOCK_SIM, seed: 0 };
}

// Obiekty robocze (bez alokacji na zdarzenie). _hit.ric… — rykoszet rozstrzygnięty przez grę
// (18-B, projectileMechanics.ricochetBounce): kierunek, prędkość i życie smugowca odbitego.
const _m = { x: 0, y: 0, angle: 0, scale: 1, density: 1, smokeK: 1 };   // smokeK — dym cząstkowy wylotu (gaz z lufy)
const _hit = { x: 0, y: 0, nx: 0, ny: -1, ric: false, ricDirX: 0, ricDirY: 0, ricSpeed: 0, ricLife: 0 };
const _imp = { x: 0, y: 0, vx: 0, vy: 0, rvx: 0, rvy: 0, power: 1, flakR: 0, style: 0, r: 1, g: 1, b: 1, width: 6, len: 16, flyAcc: 0 };
const _carrier = createCarrier();
const _carrier2 = createCarrier();
const _slot = { key: null, muzzle: 0 };
const _mz = { x: 0, y: 0, angle: 0, scale: 1 };
// Promień śmierci: poza encji jak w grze (src/game/deathRay.js — x kanoniczne NPC, gracz: x = pos co krok; lustro
// migawki: x, y), czoło rosnącej wiązki (emisja) i widok strzału wizualnego z renderu (deathRayVisual).
const rayEntX = (e) => (Number.isFinite(e?.x) ? e.x : Number(e?.pos?.x));
const rayEntY = (e) => (Number.isFinite(e?.y) ? e.y : Number(e?.pos?.y));
const _rayFront = { x: 0, y: 0 };
const _rayVisual = {
  id: 0, weaponId: 'death_ray', shooter: null, x: 0, y: 0, z0: 0, z1: 0, dx: 1, dy: 0, len: 0, lx: 0, ly: 0,
  width: 150, speed: 30000, sustain: 1.1, fade: 0.5, flags: 0, r: NaN, g: NaN, b: NaN
};

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
  _commands: false,
  _frame: 0,
  _lastSyncMs: 0,
  _frameDt: 1 / 60,   // czas klatki renderu, wygładzony (migawka pocisków)
  _syncZoom: 1,       // zoom kadru tej klatki (najmniejsza szerokość pocisku na ekranie)
  _muzzleBudget: MUZZLE_PER_FRAME,
  _impactBudget: IMPACT_PER_FRAME,
  // Budżety pełnych wylotów i trafień na klatkę (ponad — tani błysk); opcje grafiki („Szczegóły efektów”).
  muzzlePerFrame: MUZZLE_PER_FRAME,
  impactPerFrame: IMPACT_PER_FRAME,
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
  _rays: [],
  _rayHolds: [],
  _prjOriginX: 0,
  _prjOriginY: 0,
  _beamOriginX: 0,
  _beamOriginY: 0,
  stats: {
    shots: 0, muzzles: 0, cheapMuzzles: 0, impacts: 0, cheapImpacts: 0, bullets: 0, beams: 0, pulses: 0, after: 0, droppedAfter: 0,
    kerfs: 0, exits: 0, stuck: 0, ricochets: 0, charges: 0, gasMuzzles: 0,
    rays: 0, rayHits: 0, rayCharges: 0, rayLive: 0
  },

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
    for (let i = 0; i < RAY_FX_CAP; i++) this._rays.push(createRayFx());
    for (let i = 0; i < RAY_HOLD_CAP; i++) this._rayHolds.push(createRayHold());
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

  /**
   * RW-21: wejście efektów broni ze strumienia rozkazów (src/render/renderCommands.js — rekordy SHOT itd., dekoder
   * src/3d/weapons/weaponFxCommands.js). Szyna strzałów przestaje być wejściem (strzał szedłby dwa razy).
   */
  useCommands(on = true) {
    this._commands = !!on;
    if (this._commands && this._busBound) {
      WeaponShotBus.off(this._busListener);
      this._busBound = false;
    }
  },

  _bindBus() {
    // Strumień rozkazów (RW-21): strzały przychodzą rekordami SHOT (src/render/renderCommands.js) — bez szyny.
    if (this._busBound || this._commands) return;
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
      /** Wstrząs kamery: żądanie do gry (hak onShake — RW-30; gra porównuje z bieżącym wstrząsem). */
      shake(mag, dur) { self._shake(mag, dur); },
      /**
       * Mapa ran na kadłubie (zadanie 18-C, HullDamageMap.stampRecipe): stempel w miejscu krateru z haka
       * tej klatki pomija (trafienie już ostemplowane bez bramki LOD), resztę — wtórne Yamato, rzazy
       * przebić, wiązkę między taktami, żar płonącej wyrwy — kładzie z parametrami receptury.
       */
      stamp(hull, x, y, r, heat, scorch, hole, ion, dx, dy, elong) { HullDamageMap.stampRecipe(hull, x, y, r, heat, scorch, hole, ion, dx, dy, elong); },
      /** Płonąca wyrwa w układzie trafionego kadłuba. */
      burn(hull, x, y, nx, ny, dur, power, pal) { self._burn(hull, x, y, nx, ny, dur, power, pal); },
      /** Czy punkt leży na poszyciu (łuki Tempesta) — tylko odczyt kadłuba. */
      hullInside(hull, x, y) { return self._hullInside(hull, x, y); },
      /** Kosmetyczny rykoszet (nigdy w window.bullets). */
      ricochet(x, y, vx, vy, style, r, g, b, width, len, life) { self._ricochet(x, y, vx, vy, style, r, g, b, width, len, life); }
    };
  },

  _shakeAllowed: true,
  // Mnożnik wstrząsu receptury: przy trafieniu (impact, wyjście, zakleszczenie) = impactScale
  // broni (zadanie 18-D, src/game/weaponFeel.js); poza trafieniem 1.
  _shakeScale: 1,

  // Wstrząs kamery z receptury — ŻĄDANIE do gry (RW-30: hak `onShake`, index.html → src/game/cameraShakes.js
  // requestCameraShake: nie słabszy od bieżącego). Kamerą rządzi gra; efekty jej nie piszą.
  _shake(mag, dur) {
    if (!this._shakeAllowed || !(mag > 0)) return;
    if (this.onShake !== null) this.onShake(mag * this._shakeScale, dur);
  },

  _hullInside(hull, x, y) {
    if (!hull) return true;
    const HB = RenderWorld.hullBodies;
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
    slot.age = 0; slot.dur = dur; slot.power = power; slot.pal = pal; slot.stampAcc = 0;
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
      // Maskowanie (src/game/cloakLook.js): ukryty kadłub nie kopci z wyrwy (zdradzałoby okręt).
      const cl = e.__cloakLook;
      if (cl && cl.active && cl.vis < 0.5) continue;
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
    this.stats.ricochets++;
  },

  // -------------------------------------------------------------------------
  // Kadr

  _inView(x, y, pad = VIEW_PAD) {
    const v = Core3D.fx?.view;
    if (!v || !(v.x1 > v.x0)) return true;
    return x >= v.x0 - pad && x <= v.x1 + pad && y >= v.y0 - pad && y <= v.y1 + pad;
  },

  _zoom() {
    const z = Number(Core3D.activeCam1?.zoom ?? RenderWorld.camera?.zoom);
    return z > 0 ? z : 1;
  },

  // -------------------------------------------------------------------------
  // Strzał (szyna) — zdarzenia A–E

  /** pre — lufa rozwiązana w grze (rekord SHOT, RW-21): undefined — szukana tutaj (szyna, dema). */
  _onShot(detail, pre = undefined) {
    if (!this.available || !detail) return;
    const id = detail.weaponId;
    const entry = WEAPON_FX[id];
    if (!entry) return;
    this.stats.shots++;
    const x = Number(detail.x); const y = Number(detail.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const w = weaponCtx(id);
    // Promień śmierci: wylot (zawsze bogaty, bez LOD wieżyczki) i wiązka idą z rekordu RAY_FIRE (deathRayFire) — szyna
    // niesie tylko dźwięk, odrzut wieży i wstrząs strzału (strona gry).
    if (entry.fx === 'deathRay') return;
    if (detail.isBeam && detail.beam) {
      const kind = detail.beam.kind || detail.beamMode || detail.beam.mode;
      if (kind === 'continuous') { this._beamContinuousEvent(detail, w); return; }
      this._pulseBeamEvent(detail, w, kind === 'pd' ? BEAM.PD : BEAM.PULSE, pre);
      return;
    }
    this._muzzle(w, x, y, detail.shooter || null, detail.dirX, detail.dirY, pre);
  },

  /** Kamery 3D: (encja, x, y) → wysokość lufy nad płaszczyzną (błysk wylotu) albo null. */
  muzzleZOf: null,

  /** (siła, czas) → żądanie wstrząsu kamery (hak gry — RW-30; null — bez wstrząsu, np. dema). */
  onShake: null,

  /**
   * GAZ Z LUFY (etap E1, reżyser wybuchów — ExplosionFx.muzzleShot podpina się sam): (rodzina receptury, wylot `m`, moc
   * rozmiaru I, skala wylotu S, nośnik, strzelec) → null (bez gazu) albo { owner, smokeK } — błysk wylotu dostaje
   * właściciela domeny gazu (w swoim dymie świeci tylko daleko), dym cząstkowy receptury × smokeK (bez podwójnego dymu).
   * Tylko wylot bogaty (tani — mały na ekranie albo ponad budżet klatki — bez gazu).
   */
  muzzleGas: null,

  /**
   * Wylot broni w punkcie (x, y): lufa i kąt z wieżyczki strzelca (Turret2D — odrzut), a bez
   * wieżyczki (myśliwiec) z kierunku strzału. Zwraca true, gdy powstał efekt.
   */
  _muzzle(w, x, y, shooter, dirX, dirY, pre = undefined) {
    const recipe = RECIPES[w.fx];
    if (!recipe) return false;
    const key = normalizeWeaponFxKey(w.id);
    // Odrzut zadaje strona gry (RW-26: Turret2D.recoilForShot w słuchaczu szyny, triggerShot przy PD) — tu sam wylot.
    // pre: lufa rozwiązana w grze (rekord SHOT / PD_LASER — ta sama reguła shotMuzzle, RW-21).
    const shot = pre !== undefined ? pre : Turret2D.shotMuzzle(key, x, y, shooter);
    const m = _m;
    let gunner = shooter;
    if (shot) {
      m.x = shot.x; m.y = shot.y; m.angle = shot.angle; m.scale = shot.scale;
      gunner = shot.entity || shooter;
      writeCarrier(gunner, shot.x, shot.y, true, _carrier);
      // Kamery 3D: błysk na wysokości lufy wieży 3D (shipModels3DGame.turretMuzzleZ; w kamerze z góry 0).
      if (this.muzzleZOf !== null) _carrier.z += this.muzzleZOf(shot.entity || shooter, shot.x, shot.y) || 0;
      // Wstrząs strzałów i kopnięcie kadru liczy gra przy zapisie rekordu SHOT (RW-30: src/render/renderCommands.js
      // `onShotFeel` → src/game/cameraShakes.js).
      shot.entity = null;
    } else {
      if (!this._inView(x, y, 200)) return false;
      const dl = Math.sqrt(dirX * dirX + dirY * dirY);
      m.x = x; m.y = y;
      m.angle = dl > 1e-6 ? Math.atan2(dirY, dirX) : Number(shooter?.angle) || 0;
      m.scale = Turret2D.turretScaleFor(w.def, shooter);
      writeCarrier(shooter, x, y, false, _carrier);
    }
    return this._emitMuzzle(recipe, w, m, _carrier, gunner);
  },

  /** Receptura wylotu z LOD i budżetem klatki (m, nośnik gotowe). */
  _emitMuzzle(recipe, w, m, carrier, shooter = null) {
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
      // Gaz z lufy (armata, Yamato): domena wystrzału reżysera wybuchów; dym cząstkowy receptury × smokeK, błysk z właścicielem.
      m.smokeK = 1;
      const gas = this.muzzleGas !== null ? this.muzzleGas(w.fx, m, SIZE_POWER[w.size] || 1, m.scale * (recipe.scale || 1), carrier, shooter) : null;
      if (gas) { m.smokeK = gas.smokeK; this.ctx.lights.owner = gas.owner; this.stats.gasMuzzles++; }
      if (recipe.preFire) recipe.preFire(this.ctx, m, w);
      recipe.muzzle(this.ctx, m, w);
      this.stats.muzzles++;
    } finally {
      ActiveCarrier.clear();
      this.ctx.lights.owner = 0;
      m.smokeK = 1;
    }
    return true;
  },

  /**
   * Strzał obrony punktowej gracza (ciwsStep — nie idzie przez szynę): CIWS, flak. Lufa z
   * rekordu wieżyczki p_aux (Turret2D), inaczej z pozycji i kąta działka.
   */
  pdShot(weaponId, x, y, angle, shooter, pre = undefined) {
    if (!this.available) return false;
    const w = weaponCtx(weaponId);
    if (!w.fx) return false;
    this.stats.shots++;
    return this._muzzle(w, x, y, shooter, Math.cos(angle), Math.sin(angle), pre);
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

  _pulseBeamEvent(detail, w, style, pre = undefined) {
    const beam = detail.beam;
    const recipe = RECIPES[w.fx];
    const shooter = detail.shooter || null;
    const sx = Number(beam.startX); const sy = Number(beam.startY);
    const ex = Number(beam.endX); const ey = Number(beam.endY);
    if (!Number.isFinite(sx + sy + ex + ey)) return;
    this._firePulse(w, recipe, style, sx, sy, ex, ey, shooter, beam.hitEntity || null, beam.nx, beam.ny, Number(beam.width) || 5, pre);
  },

  /**
   * Impuls (wiązka pulsacyjna, laser PD): wylot z wieżyczki, front biegnie do celu
   * (PULSE_SPEED), trafienie po dojściu — sam obraz (obrażenia liczy gra). Pierścień o stałej
   * pojemności — najstarszy nadpisywany.
   */
  _firePulse(w, recipe, style, sx, sy, ex, ey, shooter, hitEntity, nx, ny, gameWidth, pre = undefined) {
    const inView = this._inView(sx, sy) || this._inView(ex, ey);
    // wylot (błysk, odrzut wieżyczki) — też poza kadrem: odrzut prowadzi Turret2D
    const dx = ex - sx; const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this._muzzle(w, sx, sy, shooter, dist > 1e-6 ? dx / dist : 1, dist > 1e-6 ? dy / dist : 0, pre);
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
  pdLaser(weaponId, x0, y0, x1, y1, shooter, target, pre = undefined) {
    if (!this.available) return false;
    const w = weaponCtx(weaponId);
    const recipe = RECIPES[w.fx] || RECIPES.laserPD;
    this.stats.shots++;
    this._firePulse(w, recipe, BEAM.PD, x0, y0, x1, y1, shooter, target || null, x0 - x1, y0 - y1, 5, pre);
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
      // Krótki zapas między taktami 20 Hz: wygaszanie zaczyna się tuż po
      // wyłączeniu emitera, bez dawnego podtrzymania przez 0,18 s.
      const recent = since <= Math.max(0.06, (MASTER_WEAPONS[b.weaponId]?.cooldown || 0.05) * 1.5);
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
    // promienie śmierci i ich ładowanie (ten sam bufor wiązek tej klatki)
    this._stepRays(c);
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
    // koniec smugi pocisku w punkcie trafienia — chyba że pocisk przebija kadłub i leci dalej
    // (hit.through, 18-B: smuga kończy się w punkcie wyjścia / zakleszczenia)
    // b.__ref — pocisk gry, gdy `b` to widok z rekordu IMPACT (RW-21); stan smugi siedzi na nim.
    const ref = b.__ref || b;
    const st = ref.__fx;
    if (st && st.bullet === ref && !hit?.through) { st.endX = x; st.endY = y; st.endZ = Number(b.z) || 0; st.endSet = true; }
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
    // Rykoszet rozstrzyga gra (hash numeru pocisku — decyzja i obraz z tego samego hasha).
    if (hit?.ric) {
      _hit.ric = true;
      _hit.ricDirX = hit.ricDirX; _hit.ricDirY = hit.ricDirY;
      _hit.ricSpeed = hit.ricSpeed; _hit.ricLife = hit.ricLife;
    } else {
      _hit.ric = false;
    }
    // wstrząs z trafień tylko dla gracza (strzelał albo oberwał) — bitwa NPC nie trzęsie kamerą;
    // siła × impactScale broni (18-D — obraz receptury bez zmian)
    const player = RenderWorld.ship;
    const p2 = RenderWorld.player2Ship;
    const ent = hit?.entity || null;
    this._shakeAllowed = b.owner === 'player' || b.owner === 'player2' || (ent && (ent === player || ent === p2));
    this._shakeScale = b.vfxKey ? weaponImpactScale(weaponCtx(b.vfxKey).def) : 1;
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
      this._shakeScale = 1;
      _hit.ric = false;
    }
    return true;
  },

  // -------------------------------------------------------------------------
  // Przebicie (zadanie 18-B — logika: src/game/projectileMechanics.js, wpięcie w
  // bulletsAndCollisionsStep): rzaz w materiale, wyjście za burtą, zakleszczenie. Receptury
  // rodziny broni (`kerf`, `exit`, `stuck` — Mjolnir, Valkyrie). relV — prędkość pocisku
  // względem kadłuba; ActiveCarrier (kadłub) ustawia wołający.

  /**
   * Znaki rzazu pocisku w materiale: `count` znaków od (x, y) co (dx, dy) (drogi 22 j. —
   * PENETRATION_CONFIG.kerfStep); tylko w kadrze. Gęstość obrazu jak w demie: tam rzaz szedł
   * najwyżej raz na podkrok 240 Hz (licznik zerowany po znaku), więc szybki pocisk znaczył co
   * v/240 j. (Mjolnir ~104 j., Valkyrie ~62 j.), nie co 22 j. — efekt bierze co k-ty znak
   * mechaniki (najwyżej KERF_PER_CALL na wywołanie, rozłożone po całym odcinku).
   * Mapa ran: pas rzazu stempluje gra (HullDamageMap.stampKerf w applyBulletHullPass — każdy
   * krok w materiale, bez bramki kadru efektu), więc receptura dostaje kadłub null (`ctx.stamp`
   * bez celu) — bez drugiego stempla w miejscach znaków efektu. `hull` zostaje w podpisie jak
   * w pierceExit / pierceStuck.
   */
  kerf(b, x, y, dx, dy, count, relVx, relVy, hull = null) {
    if (!this.available || !b || !(count > 0)) return false;
    const family = projectileFamilyFor(b);
    const recipe = family ? RECIPES[family] : null;
    if (!recipe?.kerf) return false;
    const spd = Math.sqrt(relVx * relVx + relVy * relVy);
    const markLen = Math.sqrt(dx * dx + dy * dy) || 22;
    const every = Math.max(1, Math.round(spd / KERF_DEMO_HZ / markLen));
    const n = Math.min(KERF_PER_CALL, Math.max(1, Math.round(count / every)));
    const stride = count / n;
    const p = _imp;
    p.vx = relVx; p.vy = relVy; p.rvx = relVx; p.rvy = relVy;
    p.power = SIZE_POWER[b.weaponSize] || 1;
    for (let k = 0; k < n; k++) {
      const s = Math.floor(k * stride);
      p.x = x + dx * s; p.y = y + dy * s;
      if (!this._inView(p.x, p.y, 400)) continue;
      recipe.kerf(this.ctx, p, null);
      this.stats.kerfs++;
    }
    return true;
  },

  /** Wyjście pocisku z kadłuba: stożek stopionego metalu za burtą (receptura `exit`). */
  pierceExit(b, x, y, relVx, relVy, hull = null) {
    return this._pierceEvent(b, x, y, relVx, relVy, hull, false);
  },

  /** Zakleszczenie w materiale: wybuch w kadłubie (receptura `stuck`, bez niej — `impact`). */
  pierceStuck(b, x, y, relVx, relVy, hull = null) {
    return this._pierceEvent(b, x, y, relVx, relVy, hull, true);
  },

  _pierceEvent(b, x, y, relVx, relVy, hull, stuck) {
    if (!this.available || !b) return false;
    const family = projectileFamilyFor(b);
    const recipe = family ? RECIPES[family] : null;
    if (!recipe) return false;
    // pocisk kończy lot w materiale — smuga do punktu zakleszczenia
    if (stuck) {
      const ref = b.__ref || b;
      const st = ref.__fx;
      if (st && st.bullet === ref) { st.endX = x; st.endY = y; st.endZ = Number(b.z) || 0; st.endSet = true; }
    }
    if (!this._inView(x, y, 1200)) return false;
    const p = _imp;
    p.x = x; p.y = y;
    p.vx = relVx; p.vy = relVy; p.rvx = relVx; p.rvy = relVy;
    p.power = SIZE_POWER[b.weaponSize] || 1;
    const player = RenderWorld.ship;
    const p2 = RenderWorld.player2Ship;
    this._shakeAllowed = b.owner === 'player' || b.owner === 'player2' || (hull && (hull === player || hull === p2));
    this._shakeScale = b.vfxKey ? weaponImpactScale(weaponCtx(b.vfxKey).def) : 1;
    try {
      if (!stuck) {
        if (!recipe.exit) return false;
        recipe.exit(this.ctx, p, hull);
        this.stats.exits++;
      } else if (recipe.stuck) {
        recipe.stuck(this.ctx, p, hull);
        this.stats.stuck++;
      } else if (recipe.impact) {
        const vl = Math.sqrt(relVx * relVx + relVy * relVy);
        _hit.x = x; _hit.y = y;
        _hit.nx = vl > 1e-6 ? -relVx / vl : 0; _hit.ny = vl > 1e-6 ? -relVy / vl : -1;
        _hit.ric = false;
        recipe.impact(this.ctx, p, hull, _hit);
        this.stats.stuck++;
      }
    } finally {
      this._shakeAllowed = true;
      this._shakeScale = 1;
    }
    return true;
  },

  /** Pęknięcie pocisku flaku (detonateFlakShell) — ActiveCarrier ustawia wołający (pęd pocisku). */
  flakBurst(b, x, y, radius) {
    if (!this.available) return false;
    if (!this._inView(x, y, radius * 2)) return false;
    const ref = b ? (b.__ref || b) : null;
    const st = ref?.__fx;
    if (st && st.bullet === ref) { st.endX = x; st.endY = y; st.endZ = Number(b.z) || 0; st.endSet = true; }
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

  /**
   * Wybuch bomby lotniczej (fighter_bomb, src/game/fighterBombs.js — env.hitHull gry): cięższy blast na
   * pancerzu i czasem płonąca wyrwa na `hull`. scale 1 ≈ 420 obr. (gra: obrażenia / baseDamage ×
   * impactScale broni). Liczy się do budżetu trafień klatki (ponad — tani błysk); ActiveCarrier
   * (trafiony kadłub) ustawia wołający. Wstrząs kamery tylko, gdy bomba trafiła gracza (P1 / P2).
   */
  bombBlast(x, y, scale = 1, hull = null) {
    if (!this.available || !this._inView(x, y, 600 * Math.max(0.4, scale))) return false;
    if (this._impactBudget <= 0) {
      cheapImpact(this.ctx, x, y, 3.0, 1.55, 0.5, 60 * Math.max(0.4, scale));
      this.stats.cheapImpacts++;
      return true;
    }
    this._impactBudget--;
    this.stats.impacts++;
    const player = RenderWorld.ship;
    const p2 = RenderWorld.player2Ship;
    this._shakeAllowed = !!hull && (hull === player || hull === p2);
    try { bombBlast(this.ctx, x, y, scale, hull); } finally { this._shakeAllowed = true; }
    return true;
  },

  /** Bomba bez poszycia pod sobą (dziura, chybienie): słaby błysk zapalnika. */
  bombDud(x, y, scale = 1) {
    if (!this.available || !this._inView(x, y, 200)) return false;
    bombDud(this.ctx, x, y, scale);
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
   * Ładowanie działa z czasem ładowania (Mjolnir, Valkyrie — logika: src/game/weaponCharge.js,
   * wołają: index.html stepSpecialCharge (gracz), WeaponController (P2), hak NPC
   * window.spawnWeaponChargeFx): state z createChargeState() na działo; u — postęp 0..1.
   */
  charge(weaponId, x, y, angle, scale, u, dt, state, carrier = null) {
    if (!this.available || !(dt > 0) || !state) return;
    const recipe = RECIPES[WEAPON_FX[weaponId]?.fx];
    if (!recipe?.charge) return;
    // Promień śmierci: laser naprowadzający i implozja co klatkę (także poza kadrem — laser sięga 12 km w kadr).
    if (recipe === RECIPES.deathRay) {
      this._noteRayHold(state, x, y, 0, angle, u, scale || 1, Number(MASTER_WEAPONS[weaponId]?.baseRange) || 12000,
        this._rayPalette(weaponId, NaN, NaN, NaN, state.__rayCol || (state.__rayCol = [1, 1, 1])), carrier);
      state.pal = state.__rayPal;
    }
    if (!this._inView(x, y, 1200)) return;
    _mz.x = x; _mz.y = y; _mz.angle = angle; _mz.scale = scale || 1;
    if (carrier) ActiveCarrier.set(carrier);
    try { recipe.charge(this.ctx, _mz, Math.max(0, Math.min(1, u)), dt, state); } finally { ActiveCarrier.clear(); }
    this.stats.charges++;
  },

  createChargeState,

  // -------------------------------------------------------------------------
  // Promień śmierci (src/game/deathRay.js → rekordy RAY_*): wiązka BEAM.RAY co klatkę, wylot, trafienia, ładowanie

  /**
   * Barwa ciała promienia (HDR, do `out`) i paleta cząstek: z rekordu (r, g, b liniowo 0..1 — NaN = z danych broni).
   * Zwraca paletę (pamięć barw w recipes.js — bez alokacji po pierwszym użyciu barwy).
   */
  _rayPalette(weaponId, r, g, b, out) {
    if (r === r && g === g && b === b) {
      out[0] = Math.max(0, r) * RAY_HDR; out[1] = Math.max(0, g) * RAY_HDR; out[2] = Math.max(0, b) * RAY_HDR;
    } else {
      const c = beamColor(weaponId || 'death_ray', RAY_HDR);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    }
    return deathRayPalette(out[0], out[1], out[2]);
  },

  _rayById(id) {
    const R = this._rays;
    for (let i = 0; i < R.length; i++) if (R[i].active && R[i].id === id) return R[i];
    return null;
  },

  /**
   * Strzał promienia (rekord RAY_FIRE — widok `v` z dekodera; wołający z renderu może podać własny obiekt o tych
   * polach): wiązka rośnie z czołem `v.speed`, trwa `v.sustain`, gaśnie `v.fade`. Wylot bogaty zawsze (superbroń).
   */
  deathRayFire(v, carrier = null) {
    if (!this.available || !v) return null;
    const R = this._rays;
    let ray = null;
    for (let i = 0; i < R.length; i++) if (!R[i].active) { ray = R[i]; break; }
    if (!ray) {
      // pełna pula: najstarszy promień ustępuje
      for (let i = 0; i < R.length; i++) if (!ray || R[i].age > ray.age) ray = R[i];
    }
    const len = Math.max(0, Number(v.len) || 0);
    const speed = Math.max(1000, Number(v.speed) || 30000);
    ray.active = true;
    ray.id = v.id;
    ray.weaponId = v.weaponId || 'death_ray';
    ray.shooter = v.shooter || null;
    const flags = Number(v.flags) || 0;
    ray.visual = (flags & RAY_FLAG.VISUAL) !== 0;
    ray.player = (flags & RAY_FLAG.PLAYER) !== 0;
    ray.endFlash = (flags & RAY_FLAG.END_FLASH) !== 0;
    ray.endDone = false;
    ray.x0 = Number(v.x) || 0; ray.y0 = Number(v.y) || 0;
    ray.lx = Number(v.lx) || 0; ray.ly = Number(v.ly) || 0;
    ray.z0 = Number(v.z0) || 0;
    ray.z1 = Number.isFinite(Number(v.z1)) ? Number(v.z1) : ray.z0;
    const dl = Math.sqrt(v.dx * v.dx + v.dy * v.dy) || 1;
    ray.dx = v.dx / dl; ray.dy = v.dy / dl;
    ray.len = len; ray.speed = speed;
    ray.width = Math.max(10, Number(v.width) || 150);
    ray.sustain = Math.max(0, Number(v.sustain) || 0);
    ray.fade = Math.max(0.05, Number(v.fade) || 0.5);
    // Wiek wiązki z zegara gry renderu (SimClock.render — czoło rośnie z czołem gry, w pauzie stoi; płynnie między
    // krokami fizyki), nie z zegara efektów (ten biegnie też w pauzie).
    ray.age = 0; ray.front = 0; ray.t0 = SimClock.render;
    ray.fadeAt = len / speed + ray.sustain;
    ray.life = ray.fadeAt + ray.fade;
    ray.pal = this._rayPalette(ray.weaponId, v.r, v.g, v.b, ray.col);
    ray.seed = fxRandom.next() * 10;
    ray.cvx = Number(carrier?.vx) || 0; ray.cvy = Number(carrier?.vy) || 0;
    ray.ct0 = Number(carrier?.t0) || 0; ray.cclock = carrier?.clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
    ray.sx = ray.x0; ray.sy = ray.y0;
    for (let i = 0; i < ray.hits.length; i++) { ray.hits[i].active = false; ray.hits[i].entity = null; }
    ray.hitCount = 0;
    this.stats.rays++;
    // koniec ładowania przy tym wylocie: laser naprowadzający i implozja gasną od razu (nie czekają 0,12 s)
    const Hs = this._rayHolds;
    for (let i = 0; i < Hs.length; i++) {
      const h = Hs[i];
      if (!h.active) continue;
      const hx = h.x - ray.x0, hy = h.y - ray.y0;
      if (hx * hx + hy * hy < 600 * 600) { h.active = false; h.owner = null; }
    }
    // Wylot: bogaty niezależnie od rozmiaru wieżyczki na ekranie (w kadrze z zapasem — rozbłysk ma ~2 km).
    if (this._inView(ray.x0, ray.y0, 2500)) {
      _m.x = ray.x0; _m.y = ray.y0; _m.angle = Math.atan2(ray.dy, ray.dx); _m.scale = 1; _m.density = 1; _m.smokeK = 1;
      _carrier.vx = ray.cvx; _carrier.vy = ray.cvy; _carrier.t0 = ray.ct0; _carrier.clock = ray.cclock; _carrier.z = ray.z0;
      ActiveCarrier.set(_carrier);
      this._shakeAllowed = ray.player;
      try { RECIPES.deathRay.muzzle(this.ctx, _m, weaponCtx(ray.weaponId), ray.pal); } finally { ActiveCarrier.clear(); this._shakeAllowed = true; }
    }
    return ray;
  },

  /** Trafienie promienia (RAY_HIT): wejście / wyjście / tarcza / koniec / cel bez kadłuba — efekt z nośnikiem celu. */
  deathRayHit(id, kind, x, y, nx, ny, relVx, relVy, entity = null, power = 1, t = 0, carrier = null) {
    if (!this.available) return;
    const ray = this._rayById(id);
    const pal = ray ? ray.pal : RECIPES.deathRay.palette;
    this.stats.rayHits++;
    // żar w miejscu trafienia na czas trwania wiązki (punkt w układzie celu — jedzie z kadłubem i odłamem)
    if (ray && (kind === RAY_HIT.ENTRY || kind === RAY_HIT.EXIT || kind === RAY_HIT.END)) this._rayRememberHit(ray, kind, entity, x, y, t);
    const inView = this._inView(x, y, 2500);
    if (!inView) return;
    const player = RenderWorld.ship;
    const p2 = RenderWorld.player2Ship;
    this._shakeAllowed = !!ray?.player || (!!entity && (entity === player || entity === p2));
    this._shakeScale = 1;
    if (carrier) ActiveCarrier.set(carrier);
    try {
      const D = RECIPES.deathRay;
      if (kind === RAY_HIT.ENTRY) D.entry(this.ctx, x, y, relVx, relVy, entity, pal, power || 1);
      else if (kind === RAY_HIT.EXIT) {
        const p = _imp;
        p.x = x; p.y = y; p.vx = relVx; p.vy = relVy; p.rvx = relVx; p.rvy = relVy; p.power = power || 1;
        D.exit(this.ctx, p, entity, pal);
      } else if (kind === RAY_HIT.SHIELD) D.shield(this.ctx, x, y, relVx, relVy, pal, power || 1);
      else if (kind === RAY_HIT.SMALL) D.end(this.ctx, x, y, relVx, relVy, pal, 0.35);
      else D.end(this.ctx, x, y, relVx, relVy, pal, power || 1);
    } finally {
      ActiveCarrier.clear();
      this._shakeAllowed = true;
    }
  },

  _rayRememberHit(ray, kind, entity, x, y, t) {
    const H = ray.hits;
    let h = null;
    for (let i = 0; i < H.length; i++) if (!H[i].active) { h = H[i]; break; }
    if (!h) return;
    h.active = true;
    h.kind = kind;
    h.entity = entity && typeof entity === 'object' ? entity : null;
    h.t = t;
    h.x = x; h.y = y;
    if (h.entity) {
      const ex = rayEntX(h.entity), ey = rayEntY(h.entity);
      const a = Number(h.entity.angle) || 0;
      if (Number.isFinite(ex) && Number.isFinite(ey)) {
        const c = Math.cos(a), s = Math.sin(a);
        const dx = x - ex, dy = y - ey;
        h.lx = dx * c + dy * s; h.ly = -dx * s + dy * c;
        h.la = a;
      } else {
        h.entity = null;
      }
    }
    ray.hitCount++;
  },

  /** Nowa długość promienia (RAY_STATE): zatrzymanie (czoło staje na celu) albo przerwanie (gaśnie od razu). */
  deathRayState(id, len, code) {
    const ray = this._rayById(id);
    if (!ray) return;
    const L = Math.max(0, Number(len) || 0);
    if (L < ray.len) {
      ray.len = L;
      ray.fadeAt = Math.min(ray.fadeAt, Math.max(ray.age, L / ray.speed) + ray.sustain);
    }
    if (code === RAY_STATE.CANCEL) ray.fadeAt = Math.min(ray.fadeAt, ray.age);
    ray.life = ray.fadeAt + ray.fade;
  },

  /**
   * Ładowanie promienia z rozkazu sceny / strzału wizualnego (RAY_CHARGE): barwa (r, g, b liniowo — null = broń),
   * skala, wysokość z, długość lasera naprowadzającego; stan efektu `state` (createChargeState) na rozkaz.
   */
  deathRayCharge(x, y, z, angle, u, dt, scale = 1, col = null, state = null, carrier = null, len = 0) {
    if (!this.available || !(dt > 0) || !state) return;
    const c = state.__rayCol || (state.__rayCol = [1, 1, 1]);
    const pal = col ? this._rayPalette('death_ray', col[0], col[1], col[2], c) : this._rayPalette('death_ray', NaN, NaN, NaN, c);
    state.pal = pal;
    this._noteRayHold(state, x, y, z, angle, u, scale || 1, len, pal, carrier);
    if (!this._inView(x, y, 1200)) return;
    _mz.x = x; _mz.y = y; _mz.angle = angle; _mz.scale = scale || 1;
    if (carrier) { _carrier.vx = carrier.vx; _carrier.vy = carrier.vy; _carrier.t0 = carrier.t0; _carrier.clock = carrier.clock; _carrier.z = (Number(carrier.z) || 0) + (Number(z) || 0); ActiveCarrier.set(_carrier); }
    try { RECIPES.deathRay.charge(this.ctx, _mz, Math.max(0, Math.min(1, u)), dt, state); } finally { ActiveCarrier.clear(); }
    this.stats.rayCharges++;
  },

  // Wpis ładowania promienia (po stanie efektu działa): odświeżany co rekord ładowania, rysowany co klatkę do 0,12 s.
  _noteRayHold(state, x, y, z, angle, u, scale, len, pal, carrier) {
    const Hs = this._rayHolds;
    let h = state.__rayHold && state.__rayHold.owner === state ? state.__rayHold : null;
    if (!h) {
      let oldest = null;
      for (let i = 0; i < Hs.length; i++) {
        if (!Hs[i].active) { h = Hs[i]; break; }
        if (!oldest || Hs[i].t < oldest.t) oldest = Hs[i];
      }
      if (!h) h = oldest;
      h.owner = state;
      h.seed = fxRandom.next() * 10;
      state.__rayHold = h;
    }
    h.active = true;
    h.x = x; h.y = y; h.z = Number(z) || 0; h.angle = angle; h.u = Math.max(0, Math.min(1, u)); h.scale = scale; h.len = Math.max(0, Number(len) || 0);
    h.t = SimClock.render;
    h.pal = pal;
    const c = state.__rayCol;
    if (c) { h.col[0] = c[0]; h.col[1] = c[1]; h.col[2] = c[2]; }
    state.__rayPal = pal;
    h.cvx = Number(carrier?.vx) || 0; h.cvy = Number(carrier?.vy) || 0;
    h.ct0 = Number(carrier?.t0) || 0; h.cclock = carrier?.clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
  },

  /**
   * Strzał WYŁĄCZNIE obrazowy z renderu (bez rekordu gry): od (x0, y0) do (x1, y1), o: { width, color: [r, g, b]
   * liniowo, z0, z1, speed, sustain, fade, impact }. Moduły renderu (warstwy bitwy w głębi) — gra pisze rekord przez
   * system promieni (`deathRays.visual`).
   */
  deathRayVisual(x0, y0, x1, y1, o = null) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 1)) return null;
    const v = _rayVisual;
    v.id = -(++this._rayVisualSeq);
    v.weaponId = 'death_ray'; v.shooter = null;
    v.x = x0; v.y = y0; v.z0 = Number(o?.z0) || 0; v.z1 = Number.isFinite(Number(o?.z1)) ? Number(o.z1) : v.z0;
    v.dx = dx; v.dy = dy; v.len = len; v.lx = 0; v.ly = 0;
    v.width = Number(o?.width) || 150; v.speed = Number(o?.speed) || 30000;
    v.sustain = Number.isFinite(Number(o?.sustain)) ? Number(o.sustain) : 1.1; v.fade = Number(o?.fade) || 0.5;
    v.flags = RAY_FLAG.VISUAL | (o?.impact === false ? 0 : RAY_FLAG.END_FLASH);
    const col = o?.color;
    v.r = col ? Number(col[0]) : NaN; v.g = col ? Number(col[1]) : NaN; v.b = col ? Number(col[2]) : NaN;
    return this.deathRayFire(v, null);
  },
  _rayVisualSeq: 0,

  // Promienie tej klatki (krok spawn, po wiązkach): wiązka RAY, światła wzdłuż, emisja przy wylocie / czole / osi,
  // żar przy trafieniach, zniekształcenia (fala wylotu, gorące powietrze wzdłuż wiązki, implozja ładowania).
  _stepRays(c) {
    const beams = this.beams;
    const ox = this._beamOriginX, oy = this._beamOriginY;
    const time = c.time;
    const dt = c.dt;
    const field = Core3D.fxDistortion ? Core3D.fxDistortion() : null;
    const lights = this.ctx.lights;
    const D = RECIPES.deathRay;
    let live = 0;
    const R = this._rays;
    for (let i = 0; i < R.length; i++) {
      const ray = R[i];
      if (!ray.active) continue;
      const age = SimClock.render - ray.t0;
      if (age > ray.age) ray.age = age;
      if (ray.age >= ray.life) { this._releaseRay(ray); continue; }
      live++;
      // wylot: z kadłubem strzelca (poza encji × przesunięcie w jej układzie), inaczej punkt strzału + nośnik
      const sh = ray.shooter;
      let sx, sy;
      if (sh && !ray.visual && !sh.removed) {
        const ex = rayEntX(sh), ey = rayEntY(sh);
        const a = Number(sh.angle) || 0;
        if (Number.isFinite(ex) && Number.isFinite(ey)) {
          const cs = Math.cos(a), sn = Math.sin(a);
          sx = ex + ray.lx * cs - ray.ly * sn;
          sy = ey + ray.lx * sn + ray.ly * cs;
        }
      }
      if (sx === undefined) {
        const T = SimClock.now(ray.cclock) - ray.ct0;
        sx = ray.x0 + ray.cvx * T; sy = ray.y0 + ray.cvy * T;
      }
      ray.sx = sx; ray.sy = sy;
      const front = Math.min(ray.len, ray.speed * ray.age);
      ray.front = front;
      const growing = front < ray.len - 1;
      // obwiednia: wejście 0,05 s, trwanie, wygaszanie (wiązka zwęża się)
      let k;
      if (ray.age < ray.fadeAt) k = Math.min(1, ray.age / 0.05);
      else { const u = Math.max(0, 1 - (ray.age - ray.fadeAt) / ray.fade); k = u * u * (3 - 2 * u); }
      const flick = 0.93 + 0.07 * Math.sin(time * 53 + ray.seed) * Math.sin(time * 31.7 + ray.seed * 2.1);
      const power = k * flick;
      const wMul = ray.age < ray.fadeAt ? 1 : 0.35 + 0.65 * k;
      const width = ray.width * wMul * (1 + 0.035 * Math.sin(time * 61 + ray.seed));
      const ex = sx + ray.dx * front, ey = sy + ray.dy * front;
      const zEnd = ray.len > 0 ? ray.z0 + (ray.z1 - ray.z0) * (front / ray.len) : ray.z0;
      if (!(power > 0.002) || !(front > 1)) continue;
      if (!this._segInView(sx, sy, ex, ey, width * 3 + 600)) continue;
      const col = ray.col;
      beams.addRgb(sx - ox, -sy - oy, ex - ox, -ey - oy, BEAM.RAY, width, col[0], col[1], col[2], power, ray.seed, ray.age,
        ray.z0, growing ? 1 : 0, 1, zEnd);
      const pal = ray.pal;
      const L = pal.light;
      // światła: wylot, koniec (czoło albo przeszkoda) i kilka wzdłuż w kadrze
      lights.point(sx, sy, L[0], L[1], L[2], 4 * power, 1300, 40 + ray.z0);
      lights.point(ex, ey, L[0], L[1], L[2], (growing ? 5 : 3) * power, 1100, 40 + zEnd);
      const nL = Math.min(RAY_LIGHTS, Math.floor(front / 1800));
      for (let l = 1; l <= nL; l++) {
        const f = l / (nL + 1);
        const lx = sx + ray.dx * front * f, ly = sy + ray.dy * front * f;
        if (this._inView(lx, ly, 900)) lights.point(lx, ly, L[0], L[1], L[2], 2 * power, 1000, 40 + ray.z0 + (zEnd - ray.z0) * f);
      }
      // emisja: wylot, czoło (gdy rośnie), plazma z losowego miejsca osi w kadrze
      _m.x = sx; _m.y = sy; _m.angle = Math.atan2(ray.dy, ray.dx); _m.scale = 1;
      const fpt = growing ? _rayFront : null;
      if (fpt) { fpt.x = ex; fpt.y = ey; }
      let axX = NaN, axY = NaN;
      const ft = fxRandom.next();
      const px = sx + ray.dx * front * ft, py = sy + ray.dy * front * ft;
      if (this._inView(px, py, 300)) { axX = px; axY = py; }
      _carrier.vx = ray.cvx; _carrier.vy = ray.cvy; _carrier.t0 = ray.ct0; _carrier.clock = ray.cclock; _carrier.z = ray.z0;
      ActiveCarrier.set(_carrier);
      try { D.emit(this.ctx, _m, null, power, dt, null, pal, fpt, axX, axY, 1); } finally { ActiveCarrier.clear(); }
      // koniec strzału wizualnego: rozbłysk, gdy czoło doszło do końca
      if (ray.visual && ray.endFlash && !ray.endDone && !growing) {
        ray.endDone = true;
        if (this._inView(ex, ey, 2500)) {
          _carrier.vx = 0; _carrier.vy = 0; _carrier.t0 = 0; _carrier.clock = CLOCK_SIM; _carrier.z = ray.z1;
          ActiveCarrier.set(_carrier);
          try { D.end(this.ctx, ex, ey, ray.dx, ray.dy, pal, 1); } finally { ActiveCarrier.clear(); }
          this._rayRememberHit(ray, RAY_HIT.END, null, ex, ey, ray.len);
        }
      }
      // żar przy trafieniach: punkt w układzie celu, póki leży w korytarzu wiązki
      for (let h = 0; h < ray.hits.length; h++) {
        const hit = ray.hits[h];
        if (!hit.active) continue;
        let hx = hit.x, hy = hit.y;
        const e = hit.entity;
        if (e) {
          if (e.removed) { hit.active = false; hit.entity = null; continue; }
          const exx = rayEntX(e), eyy = rayEntY(e);
          const a = Number(e.angle) || 0;
          const cs = Math.cos(a), sn = Math.sin(a);
          hx = exx + hit.lx * cs - hit.ly * sn; hy = eyy + hit.lx * sn + hit.ly * cs;
        }
        const rx = hx - sx, ry = hy - sy;
        const along = rx * ray.dx + ry * ray.dy;
        const across = Math.abs(rx * -ray.dy + ry * ray.dx);
        if (along < 0 || along > front + 50 || across > width * 0.9) continue;
        if (!this._inView(hx, hy, 400)) continue;
        _hit.x = hx; _hit.y = hy;
        _hit.nx = hit.kind === RAY_HIT.EXIT ? ray.dx : -ray.dx; _hit.ny = hit.kind === RAY_HIT.EXIT ? ray.dy : -ray.dy;
        ActiveCarrier.set(e ? writeCarrier(e, hx, hy, false, _carrier2) : null);
        try { D.burn(this.ctx, _hit, power, dt, e, pal, 1); } finally { ActiveCarrier.clear(); }
      }
      // zniekształcenia: fala wylotu (0,7 s), gorące powietrze wzdłuż wiązki
      if (field) {
        if (ray.age < 0.7) {
          const u = ray.age / 0.7;
          field.shock(ray.x0, ray.y0, 80 + 2400 * Math.sqrt(u), 160 + 260 * u, 30 * (1 - u) * (1 - u), 0.4);
        }
        for (let q = 1; q <= 2; q++) {
          const f = q / 3;
          const hx = sx + ray.dx * front * f, hy = sy + ray.dy * front * f;
          if (this._inView(hx, hy, width * 2)) field.heat(hx, hy, width * 1.6, 4 * power, ray.dx, -ray.dy, 3, 0, ray.seed + q, 1);
        }
      }
    }
    this.stats.rayLive = live;
    // ładowanie: laser naprowadzający (po połowie ładowania), implozja przy wylocie
    const Hs = this._rayHolds;
    for (let i = 0; i < Hs.length; i++) {
      const h = Hs[i];
      if (!h.active) continue;
      // wpis bez świeżego rekordu ładowania (strzał, przerwanie) gaśnie po 0,12 s czasu gry (w pauzie stoi)
      if (SimClock.render - h.t > 0.12 || SimClock.render < h.t - 1) { h.active = false; h.owner = null; continue; }
      const T = SimClock.now(h.cclock) - h.ct0;
      const hx = h.x + h.cvx * T, hy = h.y + h.cvy * T;
      if (field && this._inView(hx, hy, 1500)) field.implode(hx, hy, (260 + 520 * h.u) * h.scale, 14 * h.u * h.u, 0.35);
      if (h.u > 0.5 && h.len > 10) {
        const g = (h.u - 0.5) / 0.5;
        const gx = hx + Math.cos(h.angle) * h.len, gy = hy + Math.sin(h.angle) * h.len;
        if (this._segInView(hx, hy, gx, gy, 300)) {
          const fl = 0.55 + 0.45 * Math.sin(time * 40 + h.seed) * Math.sin(time * 23 + h.seed * 3);
          beams.addRgb(hx - ox, -hy - oy, gx - ox, -gy - oy, BEAM.PD, (5 + 6 * g) * h.scale, h.col[0], h.col[1], h.col[2],
            (0.2 + 0.6 * g) * fl, h.seed, time, h.z, 1, 1, h.z);
        }
      }
    }
  },

  _releaseRay(ray) {
    ray.active = false;
    ray.shooter = null;
    for (let i = 0; i < ray.hits.length; i++) { ray.hits[i].active = false; ray.hits[i].entity = null; }
    ray.hitCount = 0;
  },

  // Odcinek (świat gry) przecina kadr z zapasem `pad` (pudło odcinka ∩ kadr, potem odległość środka kadru od prostej).
  _segInView(x0, y0, x1, y1, pad = VIEW_PAD) {
    const v = Core3D.fx?.view;
    if (!v || !(v.x1 > v.x0)) return true;
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    if (maxX < v.x0 - pad || minX > v.x1 + pad || maxY < v.y0 - pad || minY > v.y1 + pad) return false;
    const cx = (v.x0 + v.x1) * 0.5, cy = (v.y0 + v.y1) * 0.5;
    const hw = (v.x1 - v.x0) * 0.5 + pad, hh = (v.y1 - v.y0) * 0.5 + pad;
    const dx = x1 - x0, dy = y1 - y0;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (!(l > 1e-6)) return true;
    // odległość środka kadru od prostej odcinka względem promienia kadru
    const dist = Math.abs((cx - x0) * dy - (cy - y0) * dx) / l;
    return dist <= Math.sqrt(hw * hw + hh * hh);
  },

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
    this._frameDt += (Math.min(dt, 1 / 30) - this._frameDt) * 0.25;
    // Bank cząstek Fx3D (iskry dysz MAIN, mostki, rdzenie) — dokładnie raz na klatkę renderu
    // (dawniej Weapon3DSystem.syncProjectiles).
    Fx3D.update(dt);
    if (!this.ensure()) return;
    this._frame++;
    this._syncZoom = this._zoom();
    this._muzzleBudget = this.muzzlePerFrame;
    this._impactBudget = this.impactPerFrame;
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
      // Kto rysuje pocisk (`__renderedByThree`) rozstrzyga gra (RW-21: markThreeRenderedBullets w index.html, ten sam warunek).
      if (b.forceCanvas) continue;
      let st = b.__fx;
      const vx = Number(b.vx) || 0; const vy = Number(b.vy) || 0;
      const lag = b.clock === CLOCK_RENDER ? renderLag : 0;
      const x = bx - vx * lag;
      const y = by - vy * lag;
      // Gra 3D: wysokość pocisku (b.z, b.vz — strzał z wysokości statku w punkt celowania 3D).
      const vz = Number(b.vz) || 0;
      const z = (Number(b.z) || 0) - vz * lag;
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
      st.rvz = vz - st.ivz;
      st.z = z;
      const ct = b.clock === CLOCK_RENDER ? SimClock.render : SimClock.sim;
      const inView = this._inView(x, y);
      if (st.trail) trails.advance(st.trail, x, y, ct, 14 + z);
      if (inView) {
        if (st.recipe?.fly) {
          writeCarrierVelocity(ivx, ivy, st.clock, ct, _carrier);
          _carrier.z = z; // gra 3D: efekty lotu na wysokości pocisku
          ActiveCarrier.set(_carrier);
          try { st.recipe.fly(this.ctx, st, st.lastX, st.lastY, x, y); } finally { ActiveCarrier.clear(); }
        }
        const L = st.conf.light;
        if (L) lights.point(x, y, L[0], L[1], L[2], L[3], L[4], 30);
        this._addProjectile(st.conf, x, y, st.rvx, st.rvy, Number(b.age) || 0, st.wScale, st.seed, ox, oy, st);
      }
      st.lastX = x; st.lastY = y; st.lastZ = z;
    }
    this.stats.bullets = live;
    // pociski, których już nie ma w tablicy: smuga domknięta w punkcie trafienia albo ostatniej pozie
    const A = this._active;
    for (let i = A.length - 1; i >= 0; i--) {
      const st = A[i];
      if (st.frame === frame) continue;
      if (st.trail) {
        trails.end(st.trail, st.endSet ? st.endX : st.lastX, st.endSet ? st.endY : st.lastY, st.clock === CLOCK_RENDER ? SimClock.render : SimClock.sim, 14 + (st.endSet && Number.isFinite(st.endZ) ? st.endZ : (st.lastZ || 0)));
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
    st.ivz = Number(b.ivz) || 0;
    st.z = Number(b.z) || 0; st.rvz = (Number(b.vz) || 0) - st.ivz; st.lastZ = st.z; st.endZ = NaN;
    st.clock = b.clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
    st.power = SIZE_POWER[b.weaponSize] || 1;
    st.minW = PROJECTILE_LOOK.minPx[b.weaponSize] || PROJECTILE_LOOK.minPx.M;
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
      // Gra 3D: początek smugi na wysokości wylotu (z − vz · wiek).
      const sz = st.z - (Number(b.vz) || 0) * age;
      st.trail = this.trails.begin(conf.trail, sx, sy, rvx, rvy, conf.trailWidth * st.wScale, conf.trailSpacing, conf.trailPathUnit, st.ivx, st.ivy, ct, st.clock, 14 + sz);
    }
  },

  /** Pocisk do bufora rysunku: kierunek i długość z ruchu względem strzelca (rvx, rvy). */
  _addProjectile(conf, x, y, rvx, rvy, age, wScale, seed, ox, oy, st) {
    // Gra 3D: kierunek i długość smugi z ruchu 3D (st.rvz), głowa na wysokości pocisku (st.z).
    const rvz = st ? (st.rvz || 0) : 0;
    const spd = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
    let dxs = 1; let dys = 0; let dzs = 0;
    if (spd > 1e-3) { dxs = rvx / spd; dys = -rvy / spd; dzs = rvz / spd; }
    const grow = Math.min(1, age * 40 + 0.15);
    let len = (conf.len * wScale + spd * conf.streak) * grow;
    // migawka: nie krótsza niż skok między klatkami, nie dłuższa niż droga od wylotu
    const shutter = spd * Math.min(this._frameDt * PROJECTILE_LOOK.shutter, age);
    if (shutter > len) len = shutter;
    let width = conf.width * wScale;
    if (st && st.minW > 0) {
      const minW = Math.min(st.minW / this._syncZoom, width * PROJECTILE_LOOK.minGrow);
      if (minW > width) width = minW;
    }
    const c = conf.color;
    this.projectiles.add(x - ox, -y - oy, 14 + (st ? (st.z || 0) : 0), conf.style, dxs, dys, len, width, c[0], c[1], c[2], seed, dzs);
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
    this.projectiles.commit(zoom, PROJECTILE_LOOK.pixelCore);
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
    for (const r of this._rays) this._releaseRay(r);
    for (const h of this._rayHolds) { h.active = false; h.owner = null; }
    this.gpu.reset();
    this.trails.reset();
    this.projectiles.begin();
    this.projectiles.commit(1);
    this.beams.begin();
    this.beams.commit(1, 0, 0);
  }
};

if (typeof window !== 'undefined') { window.WeaponFx = WeaponFx; window.ProjectileLook = PROJECTILE_LOOK; }
