// src/3d/hallGas3d/hallGas3d.js
//
// GAZ I PYŁ HALI K-7 v2 — strona RENDERU (docs/BRIEF-gaz-hali-3d.md, plan docs/PLAN-3d-gaz.md): krok efektów Core3D,
// który czyta TYLKO tablicę wejścia klatki (HALL_GAS3D_IN — nadzbiór HALL_DUST_IN z blokiem dachu; pakuje gra:
// src/game/hallGas3dInput.js), dysze MAIN tej klatki (EngineFrame — KAŻDA dysza osobno, lista płaska) i dysze SIDE
// (SideNozzleFrame). Bez window / DOM / requestIdleCallback — render w workerze = przekazanie tablicy.
//
// Klatka: wejście → rekordy strumieni (dysze MAIN per dysza na wysokości lotu 76, SIDE, źródła pary hali z harmonogramu
// hallGasSources.js — złączki na wysokości z pozy ramienia, szpule, zawory, nawiewy) i kadłubów (płyta 48–116 × maska obrysu
// z żywych węzłów belek) → bufor rekordów (wysyłka tylko użytego wycinka) → krok solvera (hallGas3dGrid.js, jeden
// renderer.compute) → bryły obrazu (hallGas3dVolume.js). Światła hali (lampy, reflektory, soczewki) — siatka świateł Core3D.
// Jedna symulacja na grę: hala przy kamerze (zmiana hali = czyszczenie stanu).

import { Core3D } from '../core3d.js';
import { EngineFrame } from '../engineFrame.js';
import { SideNozzleFrame, SIDE_NOZZLE_MOUTH } from '../sideNozzleFrame.js';
import { engineSmokeFlow } from '../../game/engineIgnition.js';
import { fxNoise } from '../fx/noise.js';
import { zbierzZakres } from '../zakresyWysylki.js';
import { createK7Layout, k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { K7_BEACON, K7_BEACON_GRID, K7_BEACON_LOOK, k7BeaconLevel, k7LightRig } from '../haloRing/haloPortK7Lights.js';
import { HALL_DUST_MASK, HALL_DUST_SERVICE, HALL_DUST_SHIP, hallBodyUniforms, hallDomainDistance } from '../gasField/hallDustLayout.js';
import { HALL_GAS_MAX, HALL_GAS_TUNE, createHallGasSources, resetHallGasSources, writeHallGasSources } from '../gasField/hallGasSources.js';
import {
  HALL_GAS3D_GRID, HALL_GAS3D_HULL, HALL_GAS3D_IN, HALL_GAS3D_JET_K, HALL_GAS3D_SOURCE_Y, createHallGas3dTune, hallGas3dDeckStart,
  hallGas3dDomain, hallGas3dGapSourceCpu, hallGas3dMaskPerimeterRatio, hallGas3dWriteCone, hallGas3dWriteRadial, rasterizeHallGas3d
} from './hallGas3dLayout.js';
import { HallGas3dGrid, HALL_GAS3D_JET_VEC4 } from './hallGas3dGrid.js';
import { HallGas3dVolume } from './hallGas3dVolume.js';

const I = HALL_GAS3D_IN;
const SH = HALL_DUST_SHIP;
const SRC_DOM = Object.freeze({ x0: 0, z0: 0, h: 1 });   // rekordy źródeł hali w jednostkach hali (j., j/s)
const smoothstep01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Strojenie klatki (poza fizyką solvera — ta w `HallGas3D.tune`). */
export const HALL_GAS3D_FRAME_TUNE = {
  hallLights: true,
  lampGain: 1.1,
  lampBase: 0.4,
  lampScatter: 0.12,
  spotGain: 1.0,
  beaconGain: 1.0,
  fadeView: [26000, 52000],   // zanik obrazu przy oddaleniu: pół przekątnej kadru [j.]
  idleClear: 45,              // tyle sekund bez hali — stan od nowa
  sleepAfter: 40,             // tyle sekund czasu gry bez strumieni i ruchu kadłubów — krok nie liczy (obraz zostaje)
  movingSpeed: 30,            // kadłub szybszy [j/s] budzi symulację
  side: true,                 // dysze SIDE
  sources: true,              // źródła gazu hali (złączki, szpule, zawory, nawiewy)
  gas: { ...HALL_GAS_TUNE }   // harmonogram źródeł (hallGasSources.js)
};

class HallGas3DSystem {
  constructor() {
    this.input = new Float64Array(I.size);
    this.tune = createHallGas3dTune();
    this.frame = HALL_GAS3D_FRAME_TUNE;
    this.grid = null;
    this.volume = null;
    this.domain = null;
    this.layout = null;
    this.step = null;
    this._hall = 0;
    this._serial = -1;
    this._idle = 1e9;
    this._quiet = 0;
    this._aff = { p0x: NaN, p0y: NaN, ax: NaN, ay: NaN, bx: NaN, by: NaN };
    this._affPlaced = { p0x: NaN, p0y: NaN, ax: NaN, ay: NaN, bx: NaN, by: NaN };
    this._cone = {
      x: 0, z: 0, y: 0, dx: 0, dz: 0, dy: 0, len: 0, w0: 0, minW0: 0.75, widen: 0, widenLat: 0, speed: 0, rate: 0, flow: 0, srcLen: 0,
      occlude: false, core: 0, dust: 0, vapor: 0, exhaust: 0, temp: 0
    };
    this._radial = { x: 0, z: 0, y: 0, ox: 0, oz: 0, reach: 0, ring: 0, speed: 0, rate: 0, flow: 0, vapor: 0, dust: 0 };
    this._srcJ = new Float32Array(HALL_GAS_MAX * 12);
    this._cand = new Float64Array(64 * 3);
    this._nc = 0;
    this._rect = null;
    this.stats = {
      active: false, hall: 0, main: 0, side: 0, sources: 0, bodies: 0, steps: 0, dispatches: 0, sleeping: false, cpuMs: 0,
      lights: 0, memMB: 0
    };
  }

  /** Budowa (leniwie — po Core3D.init): układ, wokselizacja, solver, bryły, krok efektów. */
  _ensure() {
    if (this.grid) return true;
    if (!Core3D.isInitialized || !Core3D.scene || !Core3D.fx) return false;
    const layout = this.layout = createK7Layout();
    const dom = this.domain = hallGas3dDomain(layout, HALL_GAS3D_GRID.cell);
    const raster = rasterizeHallGas3d(layout, dom);
    const deck = hallGas3dDeckStart(layout, dom, raster);
    this.raster = { solid: raster.solid, air: raster.air };
    this.rig = k7LightRig(layout);
    this.gasSrc = createHallGasSources(layout, this.rig);
    const capIds = layout.berths.filter((b) => b.size === 'CAPITAL').map((b) => b.id);
    this._beaconBerth = this.rig.beacons.map((b) => (b.berthId ? capIds.indexOf(b.berthId) : -1));
    this.grid = new HallGas3dGrid({ domain: dom, stat: raster.data, deckStart: deck, noise3D: fxNoise.noise3D(), tune: this.tune });
    this.volume = new HallGas3dVolume({ grid: this.grid });
    this._maskWords = new Float64Array(this.grid.maxBodies * HALL_DUST_MASK.words).fill(NaN);
    this._perRatio = new Float64Array(this.grid.maxBodies);   // obwód / pole obrysu na slot (źródło szczeliny)
    this._rect = this.volume.U.roofRect.value.clone();
    Core3D.scene.add(this.volume.meshes.group);
    this.stats.memMB = +(this.grid.memoryBytes / 1048576).toFixed(1);
    this.step = Core3D.addFxStep({
      name: 'gaz hali 3D',
      lights: (ctx) => this._lights(ctx),
      update: (ctx) => this._update(ctx),
      warm: (ctx) => this.grid.warm(ctx.renderer)
    });
    return true;
  }

  /** Wejście klatki od gry (Float64Array, układ HALL_GAS3D_IN). */
  submit(input) {
    if (input && input !== this.input) this.input.set(input.length > I.size ? input.subarray(0, I.size) : input);
    this._ensure();
  }

  /** Siatki obrazu do rozgrzewki (Core3D.warmup, ekran ładowania). */
  warmupMeshes() {
    return this._ensure() ? this.volume.warmupMeshes() : [];
  }

  /** Strojenie fizyki → uniformy (po zmianie `tune`). */
  syncTune() {
    if (this.grid) this.grid.syncTune(this.tune);
  }

  /** Wygląd → uniformy (po zmianie `look`). */
  syncLook() {
    if (this.volume) this.volume.syncLook();
  }

  get look() {
    return this.volume ? this.volume.look : null;
  }

  /** Następna klatka zaczyna od czystego stanu (reset dema / sondy). */
  requestClear() {
    if (this.grid) this.grid.requestClear();
    if (this.gasSrc) resetHallGasSources(this.gasSrc);
    this._quiet = 0;
  }

  _update(ctx) {
    const t0 = performance.now();
    const IN = this.input;
    const grid = this.grid;
    const st = this.stats;
    const F = this.frame;
    const T = this.tune;
    const fresh = IN[I.serial] !== this._serial;
    this._serial = IN[I.serial];
    const on = !!(T.enabled && grid && IN[I.active] > 0.5);
    st.active = on;
    if (!on) {
      if (this.volume) this.volume.setVisible(false);
      this._idle += ctx.dt;
      st.steps = 0;
      st.dispatches = 0;
      return;
    }
    if (IN[I.hall] !== this._hall || this._idle > F.idleClear) {
      grid.requestClear();
      resetHallGasSources(this.gasSrc);
      this._hall = IN[I.hall];
      this._quiet = 0;
    }
    this._idle = 0;
    st.hall = this._hall;
    const aff = this._aff;
    aff.p0x = IN[I.p0x]; aff.p0y = IN[I.p0y];
    aff.ax = IN[I.ax]; aff.ay = IN[I.ay];
    aff.bx = IN[I.bx]; aff.by = IN[I.by];
    const det = aff.ax * aff.by - aff.bx * aff.ay;
    const dom = this.domain;
    const dt = fresh ? IN[I.dt] : 0;

    // --- strumienie: dysze MAIN (każda dysza), SIDE, źródła hali
    const J = grid.jets;
    const cap = grid.jetCap;
    let nj = 0;
    const C = this._cone;
    const flightY = HALL_GAS3D_HULL.flightY;
    for (let k = 0; k < EngineFrame.count && nj < cap; k++) {
      const eng = EngineFrame.entity[k];
      const power = EngineFrame.power[k];
      let p = power;
      // zimny gaz zapłonu / gaszenia (src/game/engineIgnition.js): pęd bez temperatury
      if (eng && eng.engineIgn) { const f = engineSmokeFlow(eng); if (f > p) p = f; }
      if (!(p >= T.minPower)) continue;
      p = Math.min(p, 1.5);
      const hot = power >= T.minPower ? T.jetTemp * Math.min(1, power) : 0;
      const len = T.jetLength * (0.6 + 0.4 * p);
      const from = EngineFrame.nzFrom[k];
      const cnt = EngineFrame.nzCount[k];
      for (let j = from; j < from + cnt && nj < cap; j++) {
        // scena (y w górę) → gra → hala
        const dx = EngineFrame.nzX[j] - aff.p0x;
        const dy = -EngineFrame.nzY[j] - aff.p0y;
        const hx = (aff.by * dx - aff.bx * dy) / det;
        const hz = (aff.ax * dy - aff.ay * dx) / det;
        if (hallDomainDistance(dom, hx, hz) > len) continue;
        const vx = EngineFrame.nzDX[j];
        const vy = -EngineFrame.nzDY[j];
        const r = EngineFrame.nzR[j];
        C.x = hx; C.z = hz; C.y = flightY;
        C.dx = (aff.by * vx - aff.bx * vy) / det;
        C.dz = (aff.ax * vy - aff.ay * vx) / det;
        C.dy = 0;
        C.len = len; C.w0 = Math.max(r, T.jetMinW * dom.h); C.widen = T.jetWiden; C.widenLat = T.jetWidenLat; C.core = T.jetCore * r;
        C.speed = T.jetSpeed * p; C.rate = T.jetRate;
        // wydatek = jetFlow × strumień rozdzielonego stożka u wylotu (v · π w0² / k) × moc
        C.flow = T.jetFlow * p * T.jetSpeed * Math.PI * C.w0 * C.w0 / HALL_GAS3D_JET_K; C.srcLen = T.jetSourceLen;
        C.occlude = true; C.dust = 0; C.vapor = 0; C.exhaust = 1; C.temp = hot;
        nj = hallGas3dWriteCone(J, nj, dom, C);
      }
    }
    st.main = nj;
    // dysze SIDE: impulsy manewrowe (ciąg ≥ sideMin) — krótkie stożki z wylotu dzwonu
    if (F.side) {
      for (let i = 0; i < SideNozzleFrame.count && nj < cap; i++) {
        const thr = SideNozzleFrame.throttle[i];
        if (!(thr >= T.sideMin)) continue;
        const r = SideNozzleFrame.radius[i];
        const sdx = SideNozzleFrame.dirX[i];
        const sdy = SideNozzleFrame.dirY[i];
        const mx = SideNozzleFrame.x[i] + sdx * SIDE_NOZZLE_MOUTH * r;
        const my = SideNozzleFrame.y[i] + sdy * SIDE_NOZZLE_MOUTH * r;
        const dx = mx - aff.p0x;
        const dy = -my - aff.p0y;
        const hx = (aff.by * dx - aff.bx * dy) / det;
        const hz = (aff.ax * dy - aff.ay * dx) / det;
        if (hallDomainDistance(dom, hx, hz) > T.sideLength) continue;
        const vy = -sdy;
        C.x = hx; C.z = hz; C.y = flightY;
        C.dx = (aff.by * sdx - aff.bx * vy) / det;
        C.dz = (aff.ax * vy - aff.ay * sdx) / det;
        C.dy = 0;
        C.len = T.sideLength; C.w0 = Math.max(r, dom.h); C.widen = T.sideWiden; C.widenLat = T.sideWidenLat; C.core = T.jetCore * r;
        C.speed = T.sideSpeed * thr; C.rate = T.sideRate;
        C.flow = T.sideFlow * thr * T.sideSpeed * Math.PI * C.w0 * C.w0 / HALL_GAS3D_JET_K; C.srcLen = T.sideLength * 0.5;
        C.occlude = true; C.dust = 0; C.vapor = 0; C.exhaust = 1; C.temp = 0;
        nj = hallGas3dWriteCone(J, nj, dom, C);
      }
    }
    st.side = nj - st.main;
    const engines = nj;
    if (F.sources && nj < cap) nj = this._sources(J, nj, cap, dt);
    st.sources = nj - engines;
    grid.jetCount = nj;

    // --- kadłuby: kotwica, macierz → teksle maski, prędkość + ω; maski obrysu do tekstury tylko przy zmianie
    const ns = Math.min(IN[I.ships] | 0, grid.maxBodies);
    this._syncMasks(ns);
    for (let s = 0; s < ns; s++) {
      hallBodyUniforms(IN, s, dom, grid.bodies, s * 12);
      const o = I.header + s * I.stride;
      grid.bodies[s * 12 + 11] = hallGas3dGapSourceCpu(this._perRatio[s], IN[o + SH.vx], IN[o + SH.vz], T);
    }
    grid.bodyCount = ns;
    st.bodies = ns;
    zbierzZakres(grid.recs.value, 0, (grid.jetBase + nj * HALL_GAS3D_JET_VEC4) * 4);

    // --- dach (fizyczny otwór) i oświetlenie
    const h = dom.h;
    const open = IN[I.version] > 0 ? Math.min(1, Math.max(0, IN[I.roofOpen])) : 0;
    const rect = this._rect;
    rect.set((IN[I.roofX0] - dom.x0) / h, (IN[I.roofZ0] - dom.z0) / h, (IN[I.roofX1] - dom.x0) / h, (IN[I.roofZ1] - dom.z0) / h);
    grid.U.roofOpen.value = open;
    grid.U.roofRect.value.copy(rect);

    // --- usypianie: bez strumieni i ruchu kadłubów po sleepAfter s krok nie liczy (źródła hali trzymają halę obudzoną)
    let moving = nj > 0;
    for (let s = 0; s < ns && !moving; s++) {
      const o = I.header + s * I.stride;
      const v = Math.sqrt(IN[o + SH.vx] * IN[o + SH.vx] + IN[o + SH.vz] * IN[o + SH.vz]) + Math.abs(IN[o + SH.w]) * IN[o + SH.reach];
      moving = v > F.movingSpeed;
    }
    this._quiet = moving ? 0 : this._quiet + dt;
    st.sleeping = this._quiet > F.sleepAfter && !grid._clear;
    if (st.sleeping) {
      st.steps = 0;
      st.dispatches = 0;
    } else {
      grid.step(ctx.renderer, dt);
      st.steps = grid.stats.steps;
      st.dispatches = grid.stats.dispatches;
    }

    // --- obraz
    const vol = this.volume;
    const pl = this._affPlaced;
    if (pl.p0x !== aff.p0x || pl.p0y !== aff.p0y || pl.ax !== aff.ax || pl.ay !== aff.ay || pl.bx !== aff.bx || pl.by !== aff.by) {
      vol.place(aff);
      Object.assign(pl, aff);
    }
    const lamps = Number(IN[I.lamps]) || 0;
    const roofView = IN[I.version] > 0 ? Math.min(1, Math.max(0, IN[I.roofView])) : 0;
    vol.setLighting(lamps, 1, open, rect, roofView);
    const fade = 1 - smoothstep01(F.fadeView[0], F.fadeView[1], IN[I.viewHalf]);
    vol.U.fade.value = fade * vol.look.fade;
    vol.setVisible(fade > 0.004);
    st.cpuMs = performance.now() - t0;
  }

  /**
   * Źródła gazu hali (hallGasSources.js — harmonogram, zdarzenia buchów): rekordy 2D w jednostkach hali → stożki 3D na
   * wysokości źródła (złączka — z pozy ramienia, szpula, zawór magazynu, nawiew; dopasowanie po położeniu) albo buchy
   * promieniowe dookoła złączki. Para wnosi objętość (vaporFlow · tempo) — upust pcha, nie zasysa.
   */
  _sources(J, nj, cap, dt) {
    const src = this.gasSrc;
    const T = this.tune;
    const S2 = this._srcJ;
    const n = writeHallGasSources(src, S2, 0, HALL_GAS_MAX, this.input, SRC_DOM, dt, this.frame.gas);
    // kandydaci wysokości: złączki (z pozy), szpule, zawory, nawiewy
    const cand = this._cand;
    this._nc = 0;
    for (const H of src.hoses) {
      this._putCand(H.cx, H.cz, H.cy);
      if (H.vent) this._putCand(H.anchor.x + H.vent.dirX * 40, H.anchor.z + H.vent.dirZ * 40, HALL_GAS3D_SOURCE_Y.reel);
    }
    for (const w of src.walls) this._putCand(w.x, w.z, HALL_GAS3D_SOURCE_Y.wall);
    for (const f of src.fans) this._putCand(f.x, f.z, HALL_GAS3D_SOURCE_Y.fan);
    const nc = this._nc;
    const C = this._cone;
    const R = this._radial;
    const dom = this.domain;
    for (let r = 0; r < n && nj < cap; r++) {
      const o = r * 12;
      const x = S2[o], z = S2[o + 1];
      let best = 1e18, y = HALL_GAS3D_SOURCE_Y.wall;
      for (let c = 0; c < nc; c++) {
        const dx = cand[c * 3] - x, dz = cand[c * 3 + 1] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; y = cand[c * 3 + 2]; }
      }
      const vaporRate = S2[o + 9];
      const vapor = vaporRate * T.vaporGain;
      const dust = S2[o + 10] * T.vaporGain;
      if (S2[o + 11] > 0.5) {
        R.x = x; R.z = z; R.y = y; R.ox = S2[o + 2]; R.oz = S2[o + 3];
        R.reach = S2[o + 4]; R.ring = S2[o + 5]; R.speed = S2[o + 7]; R.rate = S2[o + 8] * T.sourceRate;
        R.flow = T.vaporFlow * vaporRate; R.vapor = vapor; R.dust = dust;
        nj = hallGas3dWriteRadial(J, nj, dom, R);
      } else {
        C.x = x; C.z = z; C.y = y; C.dx = S2[o + 2]; C.dz = S2[o + 3]; C.dy = 0;
        C.len = S2[o + 4]; C.w0 = S2[o + 5]; C.widen = S2[o + 6]; C.widenLat = 0; C.speed = S2[o + 7]; C.rate = S2[o + 8] * T.sourceRate; C.core = 0;
        C.flow = T.vaporFlow * vaporRate; C.srcLen = S2[o + 4] * 0.5;
        C.occlude = true; C.dust = dust; C.vapor = vapor; C.exhaust = 0; C.temp = 0;
        nj = hallGas3dWriteCone(J, nj, dom, C);
      }
    }
    return nj;
  }

  _putCand(x, z, y) {
    const n = this._nc;
    if (n >= 64) return;
    const c = this._cand;
    c[n * 3] = x; c[n * 3 + 1] = z; c[n * 3 + 2] = y;
    this._nc = n + 1;
  }

  /** Maski obrysu kadłubów (słowa 32-bitowe w rekordach wejścia) → pasy tekstury masek; wysyłka tylko przy zmianie. */
  _syncMasks(ns) {
    const IN = this.input;
    const M = HALL_DUST_MASK;
    const words = this._maskWords;
    const data = this.grid.maskData;
    const area = M.w * M.h;
    let dirty = false;
    for (let s = 0; s < ns; s++) {
      const o = I.header + s * I.stride + SH.mask;
      const wo = s * M.words;
      let same = true;
      for (let k = 0; k < M.words; k++) {
        if (words[wo + k] !== IN[o + k]) { same = false; break; }
      }
      if (same) continue;
      dirty = true;
      for (let k = 0; k < M.words; k++) words[wo + k] = IN[o + k];
      this._perRatio[s] = hallGas3dMaskPerimeterRatio(IN, s, this.domain.h);
      const base = s * area;
      for (let b = 0; b < area; b++) data[base + b] = ((IN[o + (b >>> 5)] >>> (b & 31)) & 1) ? 255 : 0;
    }
    if (dirty) this.grid.markMasks();
  }

  /**
   * Poziom światła WNĘTRZA aktywnej hali w punkcie (x, y) świata gry (kontrakt HallDust.interiorLightAt — otoczenie
   * domen gazu wybuchów pod dachem): 0 poza halą, wewnątrz lampBase + poziom lamp (znormalizowany do 1).
   */
  interiorLightAt(x, y) {
    const IN = this.input;
    const F = this.frame;
    const dom = this.domain;
    if (!this.tune.enabled || !dom || !(IN[I.active] > 0.5)) return 0;
    const ax = IN[I.ax], ay = IN[I.ay], bx = IN[I.bx], by = IN[I.by];
    const det = ax * by - bx * ay;
    if (!(Math.abs(det) > 1e-12)) return 0;
    const dx = x - IN[I.p0x], dy = y - IN[I.p0y];
    const hx = (by * dx - bx * dy) / det;
    const hz = (ax * dy - ay * dx) / det;
    if (hallDomainDistance(dom, hx, hz) > 0) return 0;
    return (F.lampBase + (Number(IN[I.lamps]) || 0)) / (F.lampBase + 1);
  }

  /** Światła hali w siatce świateł (lampy, reflektory, soczewki — jak HallDust._lights; oświetlają kadłuby i efekty). */
  _lights(ctx) {
    const IN = this.input;
    const F = this.frame;
    const st = this.stats;
    st.lights = 0;
    if (!this.tune.enabled || !F.hallLights || !this.rig || !(IN[I.active] > 0.5)) return;
    if (IN[I.viewHalf] > F.fadeView[1]) return;
    const grid = ctx.grid;
    if (!grid) return;
    const p0x = IN[I.p0x], p0y = IN[I.p0y], ax = IN[I.ax], ay = IN[I.ay], bx = IN[I.bx], by = IN[I.by];
    const t = IN[I.clock];
    const n0 = grid.count;
    const lampK = F.lampGain * (F.lampBase + (Number(IN[I.lamps]) || 0));
    for (const L of this.rig.lamps) {
      const k = L.intensity * lampK;
      grid.addWorld(p0x + L.x * ax + L.z * bx, p0y + L.x * ay + L.z * by, k7HeightToZ(L.y), L.range,
        L.color[0] * k, L.color[1] * k, L.color[2] * k, F.lampScatter);
    }
    const spotK = F.spotGain * (0.6 + (Number(IN[I.lamps]) || 0));
    for (const s of this.rig.spots) {
      const k = s.intensity * spotK;
      const dx = s.dir[0], dz = s.dir[2];
      const gx = dx * ax + dz * bx;
      const gy = dx * ay + dz * by;
      grid.addWorld(p0x + s.x * ax + s.z * bx, p0y + s.x * ay + s.z * by, k7HeightToZ(s.y), s.range,
        s.color[0] * k, s.color[1] * k, s.color[2] * k, 0.9, gx, -gy, s.dir[1], s.cosOuter, s.cosInner);
    }
    const S = HALL_DUST_SERVICE;
    const beacons = this.rig.beacons;
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i];
      let kind = b.kind;
      const bi = this._beaconBerth[i];
      if (bi >= 0) kind = IN[I.service + bi * S.stride + S.occupied] > 0.5 ? K7_BEACON.HOLD : K7_BEACON.CLEAR;
      const G = K7_BEACON_GRID[kind];
      if (!G) continue;
      const lvl = k7BeaconLevel(kind, t, b.phase, b.period) * G.gain * F.beaconGain;
      if (!(lvl > 0.03)) continue;
      const c = K7_BEACON_LOOK[kind].color;
      grid.addWorld(p0x + b.x * ax + b.z * bx, p0y + b.x * ay + b.z * by, k7HeightToZ(b.y) + 6, G.range,
        c[0] * lvl, c[1] * lvl, c[2] * lvl, G.scatter);
    }
    st.lights = grid.count - n0;
  }
}

export const HallGas3D = new HallGas3DSystem();

// Rozgrzewka: bryły obrazu na ekranie ładowania (Core3D gotowy) — wpis czeka na urządzenie; kernele: `warm` kroku efektów.
Core3D.warmup.add({ name: 'gaz hali 3D', objects: () => HallGas3D.warmupMeshes(), phase: 'loading' });
