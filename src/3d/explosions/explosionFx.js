// src/3d/explosions/explosionFx.js
//
// WYBUCHY WebGPU gry — reżyser jako KROK klatki efektów Core3D (`Core3D.addFxStep`). Zastępuje dawny wybuch
// reaktora src/effects3d/reactorblow.js (port overlaya WebGL: płaskie cząstki, kolce i błysk wybielający kadr —
// użytkownik 2026-10-07: „tragiczne, do usunięcia”). Wejście jak dawniej: `window.makeReactorBlow({ x, y, size,
// profile })` (świat gry) — próg punktów i łańcuch rozpadu suchego doku (misja 1), rozpad stacji (Destruction3D,
// `reactorFactory`), śmierć gracza bez rdzenia (`triggerReactorBlow3D`), skrypty.
//
// Obraz (receptury: explosionRecipes.js):
//   • KULA OGNIA I DYM Z GAZU (src/3d/gas/ — siatka 3D w compute jak Niagara Fluids): rdzeń paliwa i kłęby wokół
//     niego (nieregularna kula), płonące odłamki ciągnące smugi ognia i dymu („pająk”), dogasające ogniska; gaz
//     spala się, rozpręża, kłębi wirami i stygnie w dym, który się rozchodzi i znika. Domeny PŁASKIE (gra z góry),
//     bryły domen w passie ortho (warstwa 0): część za płaszczyzną gry przed kadłubami, przed nią — po nich.
//   • ŻAR porywany polem prędkości gazu (gasEmbers.js) i łby płonących odłamków; BŁYSK (rdzeń + poświata, kwady
//     zwrócone do kamery);
//   • pule gry: ISKRY (SparkSystem3D — te same co trafień i rakiet), rozżarzone ODŁAMKI konstrukcji (WeaponFx
//     DEBRIS — oświetlane siatką świateł), smugi DYMU płonących odłamków poza domeną gazu (dym rakiet — compute
//     z samocieniem); wersja bez gazu (LOD): kula ognia rakiet, ogień ADD broni i kłęby sadzy;
//   • Core3D: ŚWIATŁA w siatce (błysk, ogień, żar — oświetlają kadłuby obok), FALA uderzeniowa jako SAMA
//     refrakcja (bez świecącego okręgu — decyzja użytkownika) i GORĄCE POWIETRZE nad kulą (fxDistortion);
//   • wybuchy WTÓRNE (mniejsze, z opóźnieniem, w tej samej domenie gazu).
//
// LOD: gaz tylko w kadrze i od GAS_MIN_PX promienia kuli na ekranie (domen jest `EXPLOSION_GRID.slots`; brak
// wolnej — wersja z cząstek, żywej domeny się nie zabiera). Wybuchy blisko siebie (łańcuch doku) dokładają się do
// jednej domeny. Poza kadrem — samo światło. Zegar: SimClock.sim (pauza = wybuch stoi; demo podaje własny zegar).
// Pozycje: świat gry (double) → scena (x, −y) względem `Core3D.fx.origin`; losowanie wizualne tylko fxRandom.
// Rozgrzewka: puste dispatche kerneli gazu i żaru + pipeline'y siatek w passie ortho (kamera z góry i kamery 3D).

import { GasGrid } from '../gas/gasGrid.js';
import { GasVolume } from '../gas/gasVolume.js';
import { GasExplosions } from '../gas/gasExplosions.js';
import { GasEmbers, GasFlashes, EMBER_CAP } from '../gas/gasEmbers.js';
import { createShiftKernel } from '../fx/gpuPoolOrigin.js';
import { gasBlackbodyCpu } from '../gas/gasCommon.js';
import { fxNoise } from '../fx/noise.js';
import { fxRandom } from '../fx/fxRandom.js';
import { sunVisibility } from '../sunShadowMask.js';
import { K } from '../weapons/gpuFx.js';
import { SparkSystem3D } from '../sparkSystem3D.js';
import { SMOKE_KIND } from '../rockets/palette.js';
import { GlowSprites } from '../rockets/glow.js';
import {
  SPARK_HOT, SPARK_GOLD, SPARK_WARM, CHUNK_HOT, CHUNK_STEEL, FIRE_COOL, FIRE_DIM
} from '../reactorBlast/palette.js';
import { SimClock, CLOCK_SIM } from '../../game/simClock.js';
import { ActiveCarrier, writeCarrierVelocity } from '../../game/carrierVelocity.js';
import {
  explosionProfile, countScale, fireRadius, explosionLod, explosionInView, rollRange,
  GAS_MIN_PX, LOD_GAS, LOD_PARTICLES, LOD_OFF
} from './explosionRecipes.js';

const TAU = Math.PI * 2;

/** Siatka gazu wybuchów: płaskie domeny (gra z góry), `slots` naraz. */
export const EXPLOSION_GRID = Object.freeze({ N: 96, NZ: 36, slots: 6, jacobi: 15, maxSources: 224, maxObstacles: 8 });

/** Przełączniki i strojenie (konsola: window.__explosions.tune; harness A/B). */
export const EXPLOSION_TUNE = {
  enabled: true,
  gas: true,          // kula ognia i dym z gazu (wyłączone = wszystko z cząstek)
  embers: true,       // żar porywany przez gaz i łby odłamków
  sparks: true,       // iskry gry
  chunks: true,       // rozżarzone odłamki konstrukcji (WeaponFx DEBRIS)
  trails: true,       // smugi dymu płonących odłamków (dym rakiet)
  flash: true,
  lights: true,
  shock: true,        // fala uderzeniowa (sama refrakcja)
  haze: true,         // gorące powietrze
  secondaries: true,
  gasMinPx: GAS_MIN_PX,
  domainScale: 5.4,   // bok domeny gazu / promień kuli ognia
  domainLife: 3.0,    // życie domeny po ostatnim wybuchu w niej [s] (potem wygaszanie 1,6 s — obłok znika do ~4,6 s)
  sparkGain: 1,
  lightGain: 1,
  shockGain: 1,
  hazeGain: 1,
  flashGain: 1
};

const BLAST_CAP = 96;       // żywe rekordy wybuchów (światła, fala, gorące powietrze)
const DELAY_CAP = 64;       // wybuchy wtórne w kolejce
const FRAG_CAP = 160;       // płonące odłamki ze smugą dymu (CPU, dym rakiet)
const BLAST_LIFE = 4.0;     // rekord żyje [s]
const BF = 12;              // float na rekord: R, size, lod, slot, cx, cy, flash, light, shock, haze, seed, power
const FG = 10;              // float na odłamek: vx, vy, cx, cy, life, drag, acc, heat, size, skręt [rad/s]

// Barwy świateł wybuchu (liniowo): błysk (biel lekko ciepła), ogień, żar.
const LIGHT_FLASH = [1.0, 0.86, 0.66];
const LIGHT_FIRE = [1.0, 0.56, 0.24];
const LIGHT_EMBER = [1.0, 0.42, 0.14];

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

export class ExplosionFx {
  /**
   * @param {object} core Core3D (po init: scena, fx, warmup)
   * @param {object} [o]
   * @param {object} [o.rocketFx] createRocketFx(Core3D) — dym rakiet (smugi odłamków, kłęby LOD), kule ognia LOD
   * @param {object} [o.weaponFx] WeaponFx — pule ADD (ogień) i DEBRIS (odłamki)
   * @param {() => number} [o.clock] zegar wybuchów [s] (domyślnie SimClock.sim — pauza gry = wybuch stoi)
   * @param {object} [o.grid] nadpisanie EXPLOSION_GRID (testy)
   */
  constructor(core, { rocketFx = null, weaponFx = null, clock = null, grid = null } = {}) {
    this.core = core;
    this.rocketFx = rocketFx;
    this.weaponFx = weaponFx;
    this.clock = typeof clock === 'function' ? clock : () => Number(SimClock.sim) || 0;
    this.tune = EXPLOSION_TUNE;
    const scene = core.scene;
    const noise3D = fxNoise.noise3D();
    const cfg = { ...EXPLOSION_GRID, ...(grid || {}) };
    this.grid = new GasGrid({ ...cfg, noise3D, rng: fxRandom });
    tuneGasForSpace(this.grid.tune);
    this.volume = new GasVolume({ grid: this.grid, noise3D, curl3D: fxNoise.curl3D() });
    tuneLookForGame(this.volume.look);
    // Część za płaszczyzną gry: pass ortho przed kadłubami (kadłub ją zasłania). Część przed płaszczyzną: pass FG
    // (warstwa 2) po bryłach FG — dach i maszty doku, górne ściany hal nie chowają kuli ognia i dymu nad nimi.
    this.meshes = this.volume.createMeshes({ layer: 0, renderOrderBack: 1, renderOrderFront: 900, sunVisibility, name: 'Wybuch' });
    this.meshes.front.layers.set(FG_LAYER);
    scene.add(this.meshes.back, this.meshes.front);
    this.director = new GasExplosions({ grid: this.grid, rng: fxRandom, hooks: {}, emitterCap: 384 });
    this.embers = new GasEmbers({ scene, grid: this.grid, rng: fxRandom, renderOrder: 910 });
    this.embers.mesh.name = 'WybuchŻar';
    this.embers.mesh.layers.set(FG_LAYER);
    this.embers.U.fadeIn.value = 0.12;
    this.flashes = new GasFlashes({ scene, grid: this.grid, renderOrder: 920 });
    this.flashes.mesh.name = 'WybuchBłysk';
    this.flashes.mesh.layers.set(FG_LAYER);
    // Błysk gry: mały biały rdzeń nad progiem bloomu, krótko; poświata pod progiem (dema: rdzeń 26 HDR — w grze
    // bloom robił z niego tarczę na pół kadru).
    Object.assign(this.flashes.look, { core: [9, 8, 6.5], glow: [0.75, 0.36, 0.1], coreTau: 0.035, glowLife: 0.28, size0: 0.22, sizeGrow: 0.22 });
    // Łby płonących odłamków (duszki blasku jak w rakietach; własna instancja — pula rakiet przepisuje swoje co klatkę).
    this.glow = new GlowSprites({ scene, capacity: 512, renderOrder: 915 });
    this.glow.mesh.name = 'WybuchOdłamki';
    this.glow.mesh.layers.set(FG_LAYER);
    this.warmMeshes = [this.meshes.back, this.meshes.front, this.embers.mesh, this.flashes.mesh, this.glow.mesh];
    // Żar trzyma pozycje WZGLĘDEM początku pul Core3D (gasEmbers: P.xyz) — przeskok początku przesuwa żywe dane
    // kernelem (rejestracja przed addFxStep: rozgrzewka kroku kompiluje też kernel przesunięcia).
    const origin = core.fx?.origin;
    if (origin && typeof origin.register === 'function') {
      const embers = this.embers;
      this._originEntry = origin.register({
        shiftNode: createShiftKernel(origin, { buffer: embers.P, capacity: EMBER_CAP, pos: [[0, 'xy']], name: 'wybuchŻarShift' }),
        isLive: () => embers.highWater > 0
      });
    }

    // Zegar.
    this.time = 0;
    this._lastClock = null;
    this.dt = 0;
    // Rekordy wybuchów (SoA): pozycja świata w double, reszta float32.
    this.bN = 0;
    this.bX = new Float64Array(BLAST_CAP);
    this.bY = new Float64Array(BLAST_CAP);
    this.bT0 = new Float64Array(BLAST_CAP);
    this.bD = new Float32Array(BLAST_CAP * BF);
    // Wybuchy wtórne (kolejka).
    this.qN = 0;
    this.qT = new Float64Array(DELAY_CAP);
    this.qX = new Float64Array(DELAY_CAP);
    this.qY = new Float64Array(DELAY_CAP);
    this.qS = new Float32Array(DELAY_CAP * 4);   // size, slot, cx, cy
    // Płonące odłamki (CPU): smuga dymu rakiet i iskry po drodze.
    this.fN = 0;
    this.fX = new Float64Array(FRAG_CAP);
    this.fY = new Float64Array(FRAG_CAP);
    this.fT0 = new Float64Array(FRAG_CAP);
    this.fD = new Float32Array(FRAG_CAP * FG);
    // Robocze (bez alokacji przy wybuchu): opcje prymitywów reżysera gazu, kierunki, nośnik, barwy.
    this._puffOpts = { temp: 0, smoke: 0, grow: 1.4, velBlend: 40, noise: 0.55, tau: 0, dir: [0, 0, 0] };
    this._trailOpts = { delay: 0, drag: 1.1, gravity: 0, fuel: 30, temp: 28, smoke: 16, shrink: 0.45, velBlend: 14, tau: 0 };
    this._fireOpts = { delay: 0, fuel: 3, temp: 3, smoke: 1.5, radial: 0, up: [0, 0, 1], lift: 0, velBlend: 6, flicker: 0.55, keep: 1.0 };
    this._jetOpts = { delay: 0, fuel: 0, temp: 0, smoke: 6, radial: 0, velBlend: 30, noise: 0.35, tau: 0.5, flicker: 0.3, grow: 1.3, rampIn: 0.04, rampOut: 0.25 };
    this._acqOpts = { size: 1, life: 6, carrier: [0, 0, 0], tint: null, now: 0, reuse: false, tag: 0, priority: 0 };
    this._carrier = { x: 0, y: 0, z: 0, vx: 0, vy: 0, clock: CLOCK_SIM, t0: 0 };
    this._bb = [0, 0, 0];
    // cpuMs — krok update (gaz, żar, błyski, duszki), simMs — w tym grid.simulate (CPU: pakowanie i zlecenie compute),
    // advMs — krok spawn (wtórne, odłamki), spawnMs — ostatni wybuch (receptury na CPU).
    this.stats = { spawned: 0, gas: 0, particles: 0, off: 0, merged: 0, noSlot: 0, secondaries: 0, live: 0, cpuMs: 0, simMs: 0, advMs: 0, spawnMs: 0, lights: 0, domains: 0 };
    const self = this;
    this.step = {
      name: 'wybuchy',
      spawn: (ctx) => self._advance(ctx),
      lights: (ctx) => self._lights(ctx),
      update: (ctx) => self._update(ctx),
      warm: (ctx) => self._warm(ctx)
    };
    core.addFxStep(this.step);
  }

  // ------------------------------------------------------------------ wejście

  /**
   * Wybuch w punkcie (x, y) świata gry: size — rozmiar [j.] (Atlas ≈ 280), profile — klucz EXPLOSION_PROFILES,
   * (vx, vy) — prędkość nośnika [j./s] (wybuch leci z rozpadającym się okrętem; dok i stacje stoją). Zwraca true,
   * gdy wybuch ruszył (także jako samo światło poza kadrem).
   */
  spawn(x, y, size = 300, profile = 'capital', vx = 0, vy = 0) {
    if (!this.tune.enabled) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(size > 0)) return false;
    const t0 = performance.now();
    const prof = explosionProfile(profile);
    const ok = this._spawn(x, y, size, prof, Number(vx) || 0, Number(vy) || 0, -1, 1);
    this.stats.spawnMs = performance.now() - t0;
    return ok;
  }

  _spawn(x, y, size, prof, cx, cy, forceSlot, power) {
    const R = fireRadius(size, prof);
    const T = this.tune;
    // Kadr i skala na ekranie w miejscu wybuchu (ostatnia klatka efektów).
    const core = this.core;
    const view = core.fx?.view || null;
    const reach = R * 2.6;
    const inView = explosionInView(view && view.x1 > view.x0 ? view : null, x, y, reach);
    const ppu = this._pxPerUnit(x, y);
    const gasAllowed = T.gas && prof.gas && this.grid.S > 0;
    let lod = explosionLod(R, ppu, inView, gasAllowed);
    if (lod === LOD_GAS && R * ppu < T.gasMinPx) lod = LOD_PARTICLES;
    let slot = -1;
    if (lod === LOD_GAS) {
      slot = forceSlot >= 0 && this.grid.slots[forceSlot]?.active ? this._extendSlot(forceSlot) : this._slotFor(x, y, R, cx, cy);
      if (slot < 0) { lod = LOD_PARTICLES; this.stats.noSlot++; }
    }
    this.stats.spawned++;
    if (lod === LOD_GAS) this.stats.gas++;
    else if (lod === LOD_PARTICLES) this.stats.particles++;
    else this.stats.off++;
    const seed = fxRandom.next();
    const b = this._record(x, y, R, size, lod, slot, cx, cy, prof, seed, power);
    if (lod === LOD_OFF) return true;
    this._setCarrier(cx, cy);
    try {
      if (T.flash) this._flash(x, y, R, prof, power);
      if (lod === LOD_GAS) this._gasRecipe(slot, x, y, R, prof, power, cx, cy);
      else this._particleRecipe(x, y, R, size, prof, power, cx, cy);
      if (T.sparks) this._sparks(x, y, R, size, prof, power, cx, cy);
      if (T.chunks) this._chunks(x, y, R, size, prof, power);
      if (T.trails) this._frags(x, y, R, size, prof, power, cx, cy);
    } finally {
      ActiveCarrier.clear();
    }
    if (T.secondaries && power >= 0.99) this._secondaries(x, y, R, size, prof, slot, cx, cy);
    return b >= 0;
  }

  // Px ekranu na j. świata w punkcie (x, y): kamera z góry — zoom; kamera 3D — rzut z odległości.
  _pxPerUnit(x, y) {
    const core = this.core;
    const H = Number(core.composerTarget?.height) || 1080;
    if (typeof core.isFreePerspectiveCamera === 'function' && core.isFreePerspectiveCamera()) {
      const cam = core.cameraPersp;
      if (cam) {
        const p = cam.position;
        const dx = p.x - x, dy = p.y + y, dz = p.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const tanH = Math.tan(((Number(cam.fov) || 50) * Math.PI / 180) * 0.5);
        return (H * 0.5) / (d * tanH);
      }
    }
    return Math.max(1e-4, Number(core.activeCam1?.zoom) || 1);
  }

  _record(x, y, R, size, lod, slot, cx, cy, prof, seed, power) {
    let i = this.bN;
    if (i >= BLAST_CAP) {
      let oldest = 0;
      for (let k = 1; k < this.bN; k++) if (this.bT0[k] < this.bT0[oldest]) oldest = k;
      i = oldest;
    } else this.bN++;
    this.bX[i] = x; this.bY[i] = y; this.bT0[i] = this.time;
    const o = i * BF, D = this.bD;
    D[o] = R; D[o + 1] = size; D[o + 2] = lod; D[o + 3] = slot; D[o + 4] = cx; D[o + 5] = cy;
    D[o + 6] = prof.flash * power; D[o + 7] = prof.light * power; D[o + 8] = prof.shock * power; D[o + 9] = prof.haze * power;
    D[o + 10] = seed; D[o + 11] = power;
    return i;
  }

  _setCarrier(cx, cy) {
    ActiveCarrier.set(writeCarrierVelocity(cx, cy, CLOCK_SIM, Number(SimClock.sim) || 0, this._carrier));
  }

  // ------------------------------------------------------------------ domeny gazu

  /**
   * Domena gazu dla wybuchu (x, y) świata o promieniu kuli R: dokłada się do żywej, młodej domeny, która go
   * mieści (łańcuch doku — jeden płyn), inaczej wolna domena. Bez wolnej: domeny po fazie ognia skracają życie
   * (wygasają same), a ten wybuch idzie cząstkami — żywego obłoku się nie zabiera (znikałby w jednej klatce).
   */
  _slotFor(x, y, R, cx, cy) {
    const g = this.grid;
    const T = this.tune;
    const sx = x, sy = -y;
    const now = g.time;
    for (let i = 0; i < g.S; i++) {
      const s = g.slots[i];
      if (!s.active || s.until < now) continue;
      const half = s.h * g.N * 0.5;
      const m = half * 0.5 - R;
      if (m <= 0) continue;
      if (Math.abs(sx - s.cx) > m || Math.abs(sy - s.cy) > m) continue;
      const dvx = s.vx - cx, dvy = s.vy + cy;
      if (dvx * dvx + dvy * dvy > 3600) continue;
      s.until = Math.max(s.until, now + T.domainLife);
      this.stats.merged++;
      return i;
    }
    let pick = -1;
    for (let i = 0; i < g.S; i++) if (!g.slots[i].active) { pick = i; break; }
    if (pick < 0) {
      // Presja: domeny starsze niż 2,2 s (ogień już zgasł) wygasają szybciej — zwolnią się za ~1,6 s.
      for (let i = 0; i < g.S; i++) {
        const s = g.slots[i];
        if (s.active && now - s.born > 2.2 && s.until > now + 0.4) s.until = now + 0.4;
      }
      return -1;
    }
    const A = this._acqOpts;
    A.size = R * T.domainScale;
    A.life = T.domainLife;
    A.carrier[0] = cx; A.carrier[1] = -cy; A.carrier[2] = 0;
    A.now = now;
    const slot = g.acquire(sx, sy, 0, R, A);
    return slot;
  }

  _extendSlot(slot) {
    const s = this.grid.slots[slot];
    s.until = Math.max(s.until, this.grid.time + this.tune.domainLife * 0.6);
    return slot;
  }

  // ------------------------------------------------------------------ receptury

  /**
   * Kula ognia z gazu: rdzeń paliwa, kłęby wokół (głównie w płaszczyźnie gry — z góry nieregularny kwiat),
   * płonące odłamki („pająk”) i dogasające ogniska. Układ sceny: (x, −y), z ku kamerze.
   */
  _gasRecipe(slot, x, y, R, prof, P, cx, cy) {
    const d = this.director;
    const X = x, Y = -y;
    const po = this._puffOpts;
    const dir = po.dir;
    // Rdzeń: krótki wyrzut paliwa w kuli 0,4 R, rozpychany promieniowo.
    po.temp = 7; po.smoke = 0.9 * prof.smoke; po.grow = 1.5; po.velBlend = 40; po.noise = 0.6; po.tau = 0;
    dir[0] = 0; dir[1] = 0; dir[2] = 0;
    d.puff(slot, X, Y, 0, R * 0.4, 0, 0.13, 13 * P, R * 3.2, po);
    // Kłęby: drobne, blisko rdzenia, prawie w płaszczyźnie (|z| ≤ 0,3) — poszarpany brzeg kuli zamiast kilku balonów.
    const nL = rollRange(prof.lobes, fxRandom) + 2;
    const a0 = fxRandom.next() * TAU;
    for (let i = 0; i < nL; i++) {
      const a = a0 + (i + (fxRandom.next() - 0.5) * 0.9) / nL * TAU;
      let ux = Math.cos(a), uy = Math.sin(a), uz = (fxRandom.next() - 0.5) * 0.6;
      const l = Math.sqrt(ux * ux + uy * uy + uz * uz);
      ux /= l; uy /= l; uz /= l;
      const dist = R * (0.18 + fxRandom.next() * 0.42);
      po.temp = 6.5; po.smoke = 1.0 * prof.smoke; po.grow = 1.4; po.velBlend = 40; po.noise = 0.6;
      dir[0] = ux * R * 2.2; dir[1] = uy * R * 2.2; dir[2] = uz * R * 1.0;
      d.puff(slot, X + ux * dist, Y + uy * dist, uz * dist, R * (0.12 + fxRandom.next() * 0.12), 0.01 + fxRandom.next() * 0.16,
        0.06 + fxRandom.next() * 0.06, (8 + fxRandom.next() * 5) * P, R * (1.4 + fxRandom.next() * 1.2), po);
    }
    // Strumienie gazu z miejsca wybuchu (rozerwane rury, wyrwy — użytkownik 2026-10-07: gaz ma wychodzić z miejsc
    // wybuchu): wąski strumień bije z punktu w płaszczyźnie gry i leci dalej własnym pędem, rozchyla się i kłębi.
    // Część z paliwem (jęzor ognia przechodzący w dym), część sam ciemny gaz.
    const jo = this._jetOpts;
    const nJ = rollRange(prof.jets, fxRandom);
    const aj = fxRandom.next() * TAU;
    for (let i = 0; i < nJ; i++) {
      const a = aj + (i + (fxRandom.next() - 0.5) * 0.8) / Math.max(1, nJ) * TAU;
      const ux = Math.cos(a), uy = Math.sin(a), uz = (fxRandom.next() - 0.5) * 0.2;
      const fire = fxRandom.next() < 0.5;
      jo.delay = fxRandom.next() * 0.12;
      jo.fuel = fire ? (7 + fxRandom.next() * 4) * P : 0;
      jo.temp = fire ? 5 : 0.3;
      jo.smoke = (fire ? 3 : 8 + fxRandom.next() * 4) * prof.smoke;
      jo.radial = R * 0.14;
      jo.velBlend = 36; jo.noise = 0.3; jo.tau = 0.55 + fxRandom.next() * 0.35; jo.flicker = 0.3; jo.grow = 1.25;
      jo.rampIn = 0.04; jo.rampOut = 0.3;
      const r = R * (0.055 + fxRandom.next() * 0.035);
      const dur = 0.6 + fxRandom.next() * 0.9;
      d.jet(slot, X + ux * R * 0.15, Y + uy * R * 0.15, 0, ux, uy, uz, r, r * 3, R * (5 + fxRandom.next() * 3), dur, jo);
    }
    // Płonące odłamki w gazie: smugi ognia przechodzące w dym (w płaszczyźnie, krótsze niż domena).
    const to = this._trailOpts;
    const nT = rollRange(prof.trails, fxRandom);
    for (let i = 0; i < nT; i++) {
      const a = fxRandom.next() * TAU;
      const uz = (fxRandom.next() - 0.5) * 0.3;
      const sp = R * (1.9 + fxRandom.next() * 1.3);
      const life = 0.7 + fxRandom.next() * 0.7;
      to.delay = 0; to.drag = 1.1; to.fuel = (28 + fxRandom.next() * 14) * P; to.temp = 30; to.smoke = (10 + fxRandom.next() * 6) * prof.smoke;
      to.shrink = 0.45; to.velBlend = 14; to.tau = life * 0.7;
      d.trail(slot, X, Y, 0, Math.cos(a) * sp, Math.sin(a) * sp, uz * sp, R * (0.085 + fxRandom.next() * 0.045), life, to);
      // Łeb odłamka (żar bez porwania — leci balistycznie z oporem jak emiter smugi).
      if (this.tune.embers) {
        this.embers.burst(X, Y, 0, Math.cos(a), Math.sin(a), uz, 0, 1, sp, sp, life + 0.8 + fxRandom.next() * 1.4,
          life + 1.0, R * (0.03 + fxRandom.next() * 0.025), 2.1, -1);
      }
    }
    // Dogasające ogniska (płomień w bok, w płaszczyźnie gry) — wybuchy okrętów i konstrukcji.
    if (prof.afterburn > 0) {
      const fo = this._fireOpts;
      const nF = 1 + Math.floor(fxRandom.next() * 2.2);
      for (let i = 0; i < nF; i++) {
        const a = fxRandom.next() * TAU;
        const dist = R * (0.08 + fxRandom.next() * 0.35);
        fo.delay = 0.3 + fxRandom.next() * 0.4;
        fo.fuel = (2.4 + fxRandom.next() * 1.2) * P; fo.temp = 2.6 + fxRandom.next() * 0.6; fo.smoke = 1.6 + fxRandom.next() * 0.8;
        fo.radial = R * 0.08; fo.lift = R * 0.5; fo.velBlend = 6; fo.flicker = 0.55; fo.keep = 1.0;
        fo.up[0] = Math.cos(a); fo.up[1] = Math.sin(a); fo.up[2] = -0.25;
        d.fire(slot, X + Math.cos(a) * dist, Y + Math.sin(a) * dist, 0, R * (0.1 + fxRandom.next() * 0.06),
          prof.afterburn * (0.6 + fxRandom.next() * 0.6), fo);
      }
    }
    // Żar porywany przez gaz: wolne iskry wirujące w kuli ognia, stygnące w dymie.
    if (this.tune.embers && prof.embers > 0) {
      // Start rozrzucony w kuli ognia (0,4 R) i narastanie 0,12 s (embers.U.fadeIn): setki iskier z jednego punktu
      // dawały w bloomie tarczę na pół kadru (A/B 2026-10-07).
      const n = Math.round(prof.embers * 0.28 * countScale(R / prof.fire) * P);
      this.embers.burst(X, Y, 0, 0, 0, 1, 1.0, Math.round(n * 0.5), R * 0.6, R * 3.0, 0.5, 1.5, R * 0.016, 2.1, slot, 0.18, R * 0.4);
      this.embers.burst(X, Y, 0, 0, 0, 1, 1.0, Math.round(n * 0.5), R * 0.15, R * 1.1, 1.4, 3.4, R * 0.022, 1.6, slot, 0.25, R * 0.5);
    }
  }

  /**
   * Wybuch bez gazu (mały na ekranie, brak wolnej domeny, profil drobny): kula ognia rakiet, ogień ADD broni
   * (kłęby stygnące z bieli w czerwień), kłęby sadzy w dymie rakiet.
   */
  _particleRecipe(x, y, R, size, prof, P, cx, cy) {
    const rf = this.rocketFx;
    const fb = rf?.fireballs;
    const rt = rf?.director ? rf.director.time : 0;
    if (fb) {
      fb.add(rt, x, y, 30, R * 0.95, 1.1 * prof.life + 0.25, 1.0, 0.9, cx, cy, Math.min(1.2, P));
      const nL = Math.max(1, rollRange(prof.lobes, fxRandom) - 1);
      const a0 = fxRandom.next() * TAU;
      for (let i = 0; i < nL; i++) {
        const a = a0 + (i + fxRandom.next() * 0.6) / nL * TAU;
        const dd = R * (0.35 + fxRandom.next() * 0.3);
        fb.add(rt + 0.03 + fxRandom.next() * 0.12, x + Math.cos(a) * dd, y + Math.sin(a) * dd, 29, R * (0.45 + fxRandom.next() * 0.2),
          0.8 * prof.life + 0.2, 0.9, 0.85, cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3, Math.min(1.1, P * 0.9));
      }
    }
    const gpu = this._gpu();
    if (gpu) {
      const sk = Math.sqrt(R / 400);
      gpu.add.begin(K.FIRE, fxRandom.round(8 + 10 * P)).at(x, -y).dir(1, 0).cone(Math.PI, 0.18).speed(120 * sk, 520 * sk)
        .life(0.45, 1.0).drag(2.6, 2.6).s0(R * 0.08, R * 0.14).s1(R * 0.2, R * 0.38).colors(FIRE_DIM, FIRE_COOL)
        .mix(2.4).alpha(0.45, 0.8).fade(0.08, 1.3).grow(0.4).spin(1.2).emit();
    }
    const smoke = rf?.smoke;
    if (smoke) {
      const n = Math.round((10 + 16 * prof.smoke) * Math.min(1.6, countScale(size) * 1.2));
      const S = smoke.s;
      for (let i = 0; i < n; i++) {
        const a = fxRandom.next() * TAU;
        const r0 = R * 0.3 * Math.sqrt(fxRandom.next());
        const sp = R * (0.25 + fxRandom.next() * 1.1);
        S.x = x + Math.cos(a) * r0; S.y = y + Math.sin(a) * r0; S.z = 18 + fxRandom.next() * 10;
        S.vx = Math.cos(a) * sp; S.vy = Math.sin(a) * sp; S.cx = cx; S.cy = cy;
        S.size0 = R * (0.12 + fxRandom.next() * 0.12); S.growth = R * (0.35 + fxRandom.next() * 0.3);
        S.life = (2.6 + fxRandom.next() * 2.6) * prof.life; S.temp = 0.3 + fxRandom.next() * 0.25;
        S.pal = SMOKE_KIND.SOOT; S.opacity = 0.18 + fxRandom.next() * 0.12; S.age = 0; S.angle = NaN;
        smoke.push();
      }
    }
  }

  // Błysk (rdzeń + poświata) — kwady zwrócone do kamery; jasność w paśmie HDR: mały biały rdzeń nad progiem,
  // krótko, poświata pod progiem (inaczej bloom zalewa kadr).
  _flash(x, y, R, prof, P) {
    const k = prof.flash * P * this.tune.flashGain;
    if (!(k > 0)) return;
    this.flashes.add(x, -y, 60, R * 0.95, Math.min(1.25, k), 0.24 + 0.08 * k);
  }

  _sparks(x, y, R, size, prof, P, cx, cy) {
    const n = Math.round(prof.sparks * countScale(size) * P * this.tune.sparkGain);
    if (n <= 0) return;
    const sk = Math.sqrt(R / 400);
    const S = SparkSystem3D.stage();
    if (!S) return;
    const t0 = Number(SimClock.sim) || 0;
    for (let s = 0; s < n; s++) {
      const a = fxRandom.next() * TAU;
      const r1 = fxRandom.next();
      const sp = (600 + r1 * fxRandom.next() * 4200) * sk;
      const r = fxRandom.next();
      const c = r < 0.3 ? SPARK_HOT : (r < 0.7 ? SPARK_GOLD : SPARK_WARM);
      const st = SparkSystem3D.stage();
      st.x = x; st.y = y; st.vx = Math.cos(a) * sp; st.vy = Math.sin(a) * sp;
      st.life = 0.4 + fxRandom.next() * 1.3; st.size = 0.25 + fxRandom.next() * fxRandom.next() * 0.75;
      st.drag = 0.9 + fxRandom.next() * 1.6; st.r = c[0]; st.g = c[1]; st.b = c[2]; st.gain = r < 0.3 ? 0.7 : 0.6;
      st.cvx = cx; st.cvy = cy; st.t0 = t0; st.clock = CLOCK_SIM;
      SparkSystem3D.pushStaged();
    }
  }

  _chunks(x, y, R, size, prof, P) {
    const gpu = this._gpu();
    if (!gpu || !(prof.chunks > 0)) return;
    const sk = Math.sqrt(R / 400);
    const n = prof.chunks * countScale(size) * P;
    gpu.debris.begin(K.CHUNK, fxRandom.round(n)).at(x, -y).dir(1, 0).cone(Math.PI, 0.2)
      .speed(260 * sk, 1500 * sk).life(1.8, 3.8).drag(0.25, 0.5)
      .s0(4 * sk, 11 * sk).s1(4 * sk, 11 * sk).colors(CHUNK_HOT, CHUNK_STEEL).alpha(1, 1).spin(9).x01(0.9, 0).emit();
  }

  // Płonące odłamki dalekiego zasięgu: CPU (ruch z oporem), smuga dymu rakiet i iskry po drodze, łeb — żar gazu
  // bez porwania (ten sam opór 1,1/s co ruch tutaj).
  _frags(x, y, R, size, prof, P, cx, cy) {
    if (!this.rocketFx?.smoke) return;
    const n = Math.round((prof.trails[0] + prof.trails[1]) * 0.5 * Math.min(1.4, countScale(size)) * P);
    for (let f = 0; f < n; f++) {
      if (this.fN >= FRAG_CAP) break;
      const a = fxRandom.next() * TAU;
      const sp = R * (2.4 + fxRandom.next() * fxRandom.next() * 4.2);
      const g = this.fN++;
      this.fX[g] = x; this.fY[g] = y; this.fT0[g] = this.time;
      const o = g * FG, D = this.fD;
      D[o] = Math.cos(a) * sp; D[o + 1] = Math.sin(a) * sp; D[o + 2] = cx; D[o + 3] = cy;
      D[o + 4] = 0.8 + fxRandom.next() * 1.6; D[o + 5] = 0.9 + fxRandom.next() * 0.6; D[o + 6] = 0;
      D[o + 7] = 0.7 + fxRandom.next() * 0.5; D[o + 8] = (R / 200) * (0.55 + fxRandom.next() * 0.7);
      // Skręt toru: odłamek koziołkuje — smuga lekko się wygina (proste rury wyglądały jak smugi rakiet).
      D[o + 9] = (fxRandom.next() - 0.5) * 1.6;
    }
  }

  _secondaries(x, y, R, size, prof, slot, cx, cy) {
    const n = rollRange(prof.secondaries, fxRandom);
    for (let i = 0; i < n; i++) {
      if (this.qN >= DELAY_CAP) break;
      const q = this.qN++;
      const a = fxRandom.next() * TAU;
      const dist = R * (0.45 + fxRandom.next() * 0.55);
      this.qT[q] = this.time + 0.3 + fxRandom.next() * 1.3;
      this.qX[q] = x + Math.cos(a) * dist;
      this.qY[q] = y + Math.sin(a) * dist;
      const o = q * 4;
      this.qS[o] = size * (0.3 + fxRandom.next() * 0.22); this.qS[o + 1] = slot; this.qS[o + 2] = cx; this.qS[o + 3] = cy;
    }
  }

  _gpu() {
    const W = this.weaponFx;
    if (!W) return null;
    if (!W.gpu && typeof W.ensure === 'function') W.ensure();
    return W.gpu || null;
  }

  // ------------------------------------------------------------------ klatka

  // spawn (pierwszy krok klatki efektów): zegar, wybuchy wtórne, ruch odłamków (smugi dymu, iskry).
  _advance(ctx) {
    const tA = performance.now();
    const t = this.clock();
    const dt = this._lastClock === null ? 0 : clamp(t - this._lastClock, 0, 0.1);
    this._lastClock = t;
    this.dt = dt;
    if (dt > 0) this.time += dt;
    const now = this.time;
    // Wtórne: kolejka po czasie (zamiana z ostatnim).
    for (let q = this.qN - 1; q >= 0; q--) {
      if (this.qT[q] > now) continue;
      const o = q * 4;
      const x = this.qX[q] + this.qS[o + 2] * (now - this.qT[q]);
      const y = this.qY[q] + this.qS[o + 3] * (now - this.qT[q]);
      const size = this.qS[o], slot = this.qS[o + 1] | 0, cx = this.qS[o + 2], cy = this.qS[o + 3];
      const last = --this.qN;
      if (q !== last) {
        this.qT[q] = this.qT[last]; this.qX[q] = this.qX[last]; this.qY[q] = this.qY[last];
        for (let k = 0; k < 4; k++) this.qS[o + k] = this.qS[last * 4 + k];
      }
      this.stats.secondaries++;
      this._spawn(x, y, size, SECONDARY_PROFILE, cx, cy, slot, 0.75);
    }
    this._stepFrags(dt);
    this.stats.advMs = performance.now() - tA;
  }

  _stepFrags(dt) {
    if (!(dt > 0) || this.fN === 0) return;
    const smoke = this.rocketFx?.smoke;
    const D = this.fD;
    const time = this.time;
    for (let g = this.fN - 1; g >= 0; g--) {
      const o = g * FG;
      const a = time - this.fT0[g];
      const life = D[o + 4];
      if (a > life || !smoke) {
        const last = --this.fN;
        if (g !== last) {
          this.fX[g] = this.fX[last]; this.fY[g] = this.fY[last]; this.fT0[g] = this.fT0[last];
          for (let k = 0; k < FG; k++) D[o + k] = D[last * FG + k];
        }
        continue;
      }
      const drag = D[o + 5];
      const e = Math.exp(-drag * dt);
      const x0 = this.fX[g], y0 = this.fY[g];
      // Skręt: obrót prędkości własnej o ω·dt.
      const w = D[o + 9] * dt;
      const cw = Math.cos(w), sw = Math.sin(w);
      const vx = D[o] * cw - D[o + 1] * sw, vy = D[o] * sw + D[o + 1] * cw;
      this.fX[g] = x0 + vx * (1 - e) / drag + D[o + 2] * dt;
      this.fY[g] = y0 + vy * (1 - e) / drag + D[o + 3] * dt;
      D[o] = vx * e; D[o + 1] = vy * e;
      const ddx = this.fX[g] - x0, ddy = this.fY[g] - y0;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      D[o + 6] += d;
      const u = a / life;
      const heat = D[o + 7] * (1 - u);
      const size = D[o + 8];
      const spacing = 4 * size;
      const S = smoke.s;
      let guard = 0;
      while (D[o + 6] > spacing && guard++ < 64) {
        D[o + 6] -= spacing;
        const k = d > 1e-6 ? clamp(1 - D[o + 6] / d, 0, 1) : 1;
        S.x = x0 + ddx * k; S.y = y0 + ddy * k; S.z = 18;
        S.vx = D[o] * 0.05; S.vy = D[o + 1] * 0.05; S.cx = D[o + 2]; S.cy = D[o + 3];
        // Smuga cieńsza i rzadsza ku końcowi lotu (odłamek dogasa).
        S.size0 = 2.6 * size * (1 - 0.4 * u); S.growth = 18 * size; S.life = 0.9 + fxRandom.next() * 1.5; S.temp = heat * 0.5;
        S.pal = SMOKE_KIND.DEBRIS; S.opacity = 0.17 * (1 - 0.5 * u); S.age = 0; S.angle = NaN;
        smoke.push();
      }
      if (fxRandom.next() < dt * 18 * heat) {
        const aa = fxRandom.next() * TAU;
        const st = SparkSystem3D.stage();
        if (st) {
          st.x = this.fX[g]; st.y = this.fY[g]; st.vx = D[o] * 0.3 + Math.cos(aa) * 160; st.vy = D[o + 1] * 0.3 + Math.sin(aa) * 160;
          st.life = 0.25 + fxRandom.next() * 0.3; st.size = 0.2 + fxRandom.next() * 0.2; st.drag = 3;
          st.r = SPARK_WARM[0]; st.g = SPARK_WARM[1]; st.b = SPARK_WARM[2]; st.gain = 0.8;
          st.cvx = D[o + 2]; st.cvy = D[o + 3]; st.t0 = Number(SimClock.sim) || 0; st.clock = CLOCK_SIM;
          SparkSystem3D.pushStaged();
        }
      }
    }
  }

  // Łby płonących odłamków: duszek blasku (żar stygnie z wiekiem odłamka).
  _fragHeads(ox, oy) {
    const G = this.glow;
    G.begin();
    const D = this.fD;
    const time = this.time;
    for (let g = 0; g < this.fN; g++) {
      const o = g * FG;
      const u = (time - this.fT0[g]) / D[o + 4];
      const heat = D[o + 7] * (1 - u);
      if (heat <= 0.03) continue;
      const S = G.s;
      S.x = this.fX[g] - ox; S.y = -this.fY[g] - oy; S.z = 40;
      S.size = 9 * D[o + 8] * (0.6 + 0.4 * heat);
      S.r = 2.4 * heat; S.g = 1.25 * heat * heat; S.b = 0.45 * heat * heat;
      G.push();
    }
    G.commit(ox, oy);
  }

  // Światła w siatce (świat gry): błysk (biel, ~0,15 s), ogień kuli (pomarańcz, migocze, ~1,4 s), żar (~3,5 s).
  _lights(ctx) {
    const grid = ctx.grid;
    let n = 0;
    if (!this.tune.lights || !grid || this.bN === 0) { this.stats.lights = 0; return; }
    const now = this.time;
    const gain = this.tune.lightGain;
    const D = this.bD;
    for (let i = 0; i < this.bN; i++) {
      const o = i * BF;
      const a = now - this.bT0[i];
      if (a < 0 || a > BLAST_LIFE) continue;
      const R = D[o];
      const L = D[o + 7] * gain;
      if (!(L > 0)) continue;
      const x = this.bX[i] + D[o + 4] * a;
      const y = this.bY[i] + D[o + 5] * a;
      const fl = Math.exp(-a / 0.05);
      const fire = Math.max(0, 1 - a / 1.4);
      const flick = 0.82 + 0.18 * Math.sin((D[o + 10] * 50 + now) * 31) * Math.sin((D[o + 10] * 17 + now) * 13.7);
      const ember = Math.max(0, 1 - a / 3.5);
      // Jedno światło na wybuch: barwa i moc z sumy faz (siatka ma budżet — bez trzech wpisów na wybuch).
      const pF = 7 * fl * L, pR = 1.6 * fire * fire * flick * L, pE = 0.45 * ember * ember * L;
      const p = pF + pR + pE;
      if (p < 0.02) continue;
      const r = (LIGHT_FLASH[0] * pF + LIGHT_FIRE[0] * pR + LIGHT_EMBER[0] * pE);
      const g = (LIGHT_FLASH[1] * pF + LIGHT_FIRE[1] * pR + LIGHT_EMBER[1] * pE);
      const b = (LIGHT_FLASH[2] * pF + LIGHT_FIRE[2] * pR + LIGHT_EMBER[2] * pE);
      const range = R * (2.2 + 3.2 * fl + 1.0 * fire);
      if (grid.addWorld(x, y, 70 + R * 0.25, range, r, g, b, 0.25) >= 0) n++;
    }
    this.stats.lights = n;
  }

  _update(ctx) {
    const t0 = performance.now();
    const dt = this.dt;
    const origin = ctx.origin;
    const g = this.grid;
    // Rekordy: wygasłe out; fala (sama refrakcja) i gorące powietrze nad kulą.
    const field = (this.tune.shock || this.tune.haze) ? ctx.core?.fxDistortion?.() : null;
    const now = this.time;
    const D = this.bD;
    for (let i = this.bN - 1; i >= 0; i--) {
      const o = i * BF;
      const a = now - this.bT0[i];
      if (a > BLAST_LIFE) {
        const last = --this.bN;
        if (i !== last) {
          this.bX[i] = this.bX[last]; this.bY[i] = this.bY[last]; this.bT0[i] = this.bT0[last];
          for (let k = 0; k < BF; k++) D[o + k] = D[last * BF + k];
        }
        continue;
      }
      if (!field || D[o + 2] === LOD_OFF) continue;
      const R = D[o];
      const x = this.bX[i] + D[o + 4] * a;
      const y = this.bY[i] + D[o + 5] * a;
      const shock = D[o + 8] * this.tune.shockGain;
      if (this.tune.shock && shock > 0 && a < 0.75) {
        // Front hamuje (fala Sedova): promień ~ (1 − e^(−t/τ)); siła gaśnie z wiekiem; grubość rośnie.
        const fr = R * 6.0 * (1 - Math.exp(-a / 0.22));
        const fade = 1 - a / 0.75;
        field.shock(x, y, fr, R * (0.22 + 0.5 * a), 9 * shock * fade * fade, 0.3);
      }
      const haze = D[o + 9] * this.tune.hazeGain;
      if (this.tune.haze && haze > 0 && a < 2.4) {
        field.heat(x, y, R * (1.1 + 0.6 * a), 3.2 * haze * (1 - a / 2.4), 0, 0, 1, 0, D[o + 10] * 10, 0.6);
      }
    }
    // Gaz: początek sceny → domeny, reżyser, symulacja, bryły.
    g.origin.x = origin.x; g.origin.y = origin.y; g.origin.z = 0;
    this._sun(ctx);
    this.director.update(dt);
    const tS = performance.now();
    g.simulate(ctx.renderer, dt);
    this.stats.simMs = performance.now() - tS;
    this.volume.syncLook();
    this.volume.updateMeshes(origin.x, origin.y, 0);
    const cam = this._camera(ctx);
    this.embers.update(ctx.renderer, dt, cam);
    this.flashes.update(dt, cam);
    this._fragHeads(origin.x, origin.y);
    // Przełączniki warstw działają też na żywe wybuchy (A/B tej samej klatki).
    const T = this.tune;
    if (!T.gas) { this.meshes.back.visible = false; this.meshes.front.visible = false; }
    if (!T.embers) this.embers.mesh.visible = false;
    if (!T.flash) this.flashes.mesh.visible = false;
    // Siatki poza obchodem grafu (Core3D liczy macierze przed klatką efektów).
    syncMeshMatrix(this.embers.mesh, origin.x, origin.y);
    syncMeshMatrix(this.flashes.mesh, origin.x, origin.y);
    this.stats.live = this.bN;
    this.stats.domains = g.stats.active;
    this.stats.cpuMs = performance.now() - t0;
  }

  _camera(ctx) {
    const core = ctx.core || this.core;
    if (typeof core.isFreePerspectiveCamera === 'function' && core.isFreePerspectiveCamera()) return core.cameraPersp;
    return core.cameraOrtho || core.cameraPersp;
  }

  // Słońce: kierunek z pozycji słońca względem kamery, 30° nad płaszczyzną (jak dym rakiet).
  _sun(ctx) {
    const sunDir = this.rocketFx?.sunDir;
    if (sunDir) { this.grid.sunDir.copy(sunDir); return; }
    const cam = ctx.core?.activeCam1;
    const sun = typeof window !== 'undefined' ? window.SUN : null;
    if (sun && cam) {
      const dx = sun.x - (Number(cam.x) || 0);
      const dy = -(sun.y - (Number(cam.y) || 0));
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      const ce = Math.cos(SUN_ELEV);
      this.grid.sunDir.set(dx / l * ce, dy / l * ce, Math.sin(SUN_ELEV)).normalize();
    }
  }

  /**
   * Rozgrzewka (raz przy gotowym urządzeniu): puste dispatche kerneli gazu i żaru, pipeline'y siatek w passie
   * ortho z licznikiem instancji jak w prawdziwym rysowaniu — z kamerą z góry i kamerą 3D (typ kamery wchodzi do
   * klucza pipeline'u). Pierwszy wybuch bez kompilacji w swojej klatce.
   */
  _warm(ctx) {
    const core = ctx.core || this.core;
    this.grid.warm(ctx.renderer);
    this.embers.warm(ctx.renderer);
    const M = this.meshes;
    const saved = [M.geometry.instanceCount, this.embers.mesh.count, this.flashes.geo.instanceCount, this.glow.geo.instanceCount];
    const vis = this.warmMeshes.map((m) => m.visible);
    M.geometry.instanceCount = Math.max(2, saved[0]);
    this.embers.mesh.count = Math.max(2, saved[1]);
    this.flashes.geo.instanceCount = Math.max(2, saved[2]);
    this.glow.geo.instanceCount = Math.max(2, saved[3]);
    for (const m of this.warmMeshes) m.visible = true;
    try {
      for (const m of this.warmMeshes) {
        const layer = m.layers.isEnabled(FG_LAYER) ? FG_LAYER : 0;
        core.prewarmPass?.(m, layer);
        core.prewarmPass?.(m, layer, { ortho: false });
      }
    } finally {
      M.geometry.instanceCount = saved[0];
      this.embers.mesh.count = saved[1];
      this.flashes.geo.instanceCount = saved[2];
      this.glow.geo.instanceCount = saved[3];
      this.warmMeshes.forEach((m, i) => { m.visible = vis[i]; });
    }
  }

  clear() {
    this.bN = 0; this.qN = 0; this.fN = 0;
    this.director.clear();
    this.grid.clear();
    this.embers.clear();
    this.flashes.clear();
    this.glow.begin();
    this.glow.mesh.visible = false;
    this.meshes.back.visible = false;
    this.meshes.front.visible = false;
  }

  dispose() {
    this.core?.fx?.removeStep?.(this.step);
    if (this._originEntry) this.core?.fx?.origin?.unregister?.(this._originEntry);
    this.core?.scene?.remove(this.meshes.back, this.meshes.front, this.embers.mesh, this.flashes.mesh, this.glow.mesh);
    this.grid.dispose();
  }
}

const SUN_ELEV = 30 * Math.PI / 180;
/** Warstwa passa FG Core3D (perspektywa nad płaszczyzną gry, po passie ortho). */
const FG_LAYER = 2;

// Wybuch wtórny: mały, w tej samej domenie gazu, bez własnych wtórnych.
const SECONDARY_PROFILE = Object.freeze({
  fire: 1.0, gas: true, power: 0.8, lobes: [2, 3], trails: [1, 2], jets: [0, 1], sparks: 160, embers: 300, chunks: 5, smoke: 0.7,
  flash: 0.55, light: 0.5, shock: 0, haze: 0.5, secondaries: [0, 0], afterburn: 0, life: 0.7
});

/** Fizyka gazu dla wybuchu w próżni (bez wyporu), dym rozchodzi się i znika. */
export function tuneGasForSpace(T) {
  T.buoyancy = 0;
  T.buoyDir = [0, 0, 1];
  T.radialLift = 1.6;      // gorący gaz rozpycha się od środka wybuchu
  T.smokeDecay = 0.42;     // połowa dymu po ~1,7 s — obłok ma wyraźnie zniknąć po kilku sekundach (zrzuty z gry 2026-10-07)
  T.disperse = 0.16;       // zimny dym rozpręża się w próżni — obłok rośnie i rzednie
  // Opór zależny od prędkości (użytkownik 2026-10-07: dym „wisiał w miejscu”, nie wychodził z miejsca wybuchu):
  // szybki front kuli i strumieni hamuje (przy 50 kom./s ~1,7/s), wolny dym dalej odpływa (~0,35/s).
  T.drag = 0.2;
  T.dragQuad = 0.03;
  T.soot = 0.42;           // mniej sadzy na jednostkę paliwa (obłok nie chowa pola walki na długo)
  T.vorticity = 3.5;       // drobne wiry — kłęby i jęzory zamiast gładkich balonów
  // Pole pozycji spoczynkowych wraca szybko (detal niesiony z gazem, ale bez rozciągania przez rozprężanie wybuchu —
  // przy 0,05/s detal z rozciągniętych pozycji rysował słoje i marmur; A/B 2026-10-07).
  T.restRelax = 1.5;
  T.fireBurn = 0.03;       // czysty płomień frontu spalania (sumuje się bez pochłaniania — przy 0,05 biel)
  return T;
}

/** Obraz gazu w grze z góry: dym nie chowa rozgrywki na długo, ogień przykrywa na chwilę. */
export function tuneLookForGame(L) {
  L.stepCells = 0.8;
  L.maxSteps = 80;
  L.density = 0.45;
  L.frontDensity = 0.5;
  L.albedo = [0.15, 0.135, 0.12];   // sadza jaśniejsza niż w demie (z góry czarny obłok czytał się jak dziura w kadrze)
  // Ogień: ciało w paśmie 0,4–1,3 (barwa zostaje barwą po ACES), biel tylko w gorącym jądrze — przy emisji 1
  // kula ognia gry świeciła bielą i bloom robił z niej tarczę.
  L.emission = 0.62;
  // Detal: przesunięcie odczytu polem wirowym i szum z pozycji spoczynkowych (restRelax 1,5/s), lekki szum startu
  // marszu (emisja całkowana po odcinku — gasVolume.js — więc bez słojów), mocniejsze języki ognia.
  L.jitter = 0.4;
  L.warpAmp = 1.4;
  L.detailScale = 0.09;
  L.detail = 0.7;
  L.erosion = 0.9;
  L.flameNoise = 0.9;
  return L;
}

function syncMeshMatrix(mesh, ox, oy) {
  if (!mesh || !mesh.visible) return;
  mesh.position.set(ox, oy, 0);
  mesh.updateMatrix();
  mesh.matrixWorld.copy(mesh.matrix);
}

/** Wybuchy w Core3D (wymaga Core3D.init — scena i klatka efektów). */
export function createExplosionFx(core, opts = {}) {
  if (!core?.scene || !core?.fx) return null;
  const fx = new ExplosionFx(core, opts);
  if (typeof window !== 'undefined') window.__explosions = fx;
  return fx;
}

/**
 * Fabryka o sygnaturze dawnego reactorblow.js: `spawn({ x, y, size, profile, vx, vy })` (świat gry) → true, gdy
 * wybuch ruszył. `spawn.system` — reżyser (statystyki, strojenie). Dla `window.makeReactorBlow` i
 * `Destruction3D.init({ reactorFactory })`.
 */
export function createExplosionFactory(core, opts = {}) {
  const system = createExplosionFx(core, opts);
  if (!system) return null;
  const spawn = ({ x = 0, y = 0, size = 300, profile = 'capital', vx = 0, vy = 0 } = {}) => system.spawn(x, y, size, profile, vx, vy);
  spawn.system = system;
  return spawn;
}
