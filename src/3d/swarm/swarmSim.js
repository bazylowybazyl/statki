// src/3d/swarm/swarmSim.js
//
// SYMULACJA ROJU NA GPU (compute TSL) — lot, unikanie i praca dronów przeładunkowych (demo
// dema/roj-webgpu.html, opis docs/webgpu/DEMO-ROJ.md). Planista (src/game/swarm/swarmPlanner.js)
// wpisuje zadania do pierścienia 2 zadań na drona (CPU → GPU, zakresy bufora), dron wykonuje je
// sam (maszyna stanów — SWARM_PHASE), a stan wraca do planisty odczytem (status, 16 B na drona).
// Ładunek: kontenery standardowe; dron niesie warstwę płasko (chwyt klasy — do 8 kontenerów, lista
// w rekordzie zadania), licznik kolumny = kontenery w niej (zamki i kolejność operacji).
// Lustro CPU maszyny stanów (bez unikania): src/game/swarm/swarmExecCpu.js.
//
// KROK (stały dt, jedno renderer.compute(lista) na klatkę z kilkoma krokami):
//   kClear — zerowanie liczników siatki (i statystyk na początku klatki),
//   kBin — drony do komórek siatki mieszającej xy (atomicAdd, komórka ≤ GRID_K),
//   kSteer — maszyna stanów, nawigacja i UNIKANIE (czyta pozycje i prędkości sąsiadów z kroku
//            poprzedniego — piszą je dopiero w kIntegrate, więc bez wyścigu), zamki kolumn,
//   kIntegrate — całkowanie, stan widoczny dla sąsiadów (NBR), niesiony kontener, status.
//
// UNIKANIE (wolny lot): ORCA (van den Berg i in., RVO2) na PROSTOKĄTACH obrysów z kursem — sąsiad,
// którego pas wysokości (dron z kontenerem pod hakiem) nakłada się z moim teraz albo w horyzoncie
// τ, daje półpłaszczyznę dozwolonych prędkości poziomych (przeszkoda prędkości = stożek styczny do
// sumy Minkowskiego obu prostokątów, ucięty horyzontem τ); dron bierze
// prędkość najbliższą zamierzonej w kole prędkości OSIĄGALNYCH w orcaReach s (program liniowy 2D,
// w tłoku — najmniejsze naruszenie) i śledzi ją szybko (kVfree) przy przyspieszeniu klasy. Udział
// w unikaniu wg pierwszeństwa: prowadzony / wyrównany nad kolumną nie ustępuje w poziomie, cięższe
// klasy i drony z ładunkiem mniej (wj / (wi + wj)). W pionie: hamowanie zbliżania do sąsiada nad /
// pod dronem, wyjście z nakładania krótszą drogą, mapa przeszkód (wierzch kadłubów, placu, wież).
// Lustro CPU linii i programu liniowego: src/game/swarm/swarmOrca.js.
//
// UKŁAD: świat sceny (x, y = −y gry, z w górę). W grze: współrzędne względem początku portu
// (float32 przy 5–10 mln j. — początek przy porcie, jak sceneOrigin.js).
import * as THREE from 'three/webgpu';
import {
  Break, Continue, Fn, If, Loop, Return, abs, array, atan, atomicAdd, atomicLoad, atomicMin, atomicStore, atomicSub, clamp,
  cos, dot, float, floor, fract, instanceIndex, instancedArray, int, length, max, min, mix, normalize, select, sign, sin,
  smoothstep, sqrt, uint, uniform, vec2, vec3, vec4
} from 'three/tsl';
import {
  SWARM_DRONE, SWARM_DRONE_VEC4, SWARM_PHASE, SWARM_STATUS_CODE, SWARM_TASK, SWARM_TASK_FLOATS, SWARM_TASK_RING,
  SWARM_TASK_VEC4, SWARM_UNIT, SWARM_UNIT_VEC4
} from '../../game/swarm/swarmPort.js';
import { SWARM_CELL_PITCH, SWARM_LOADED_ACCEL, SWARM_LOADED_SPEED, SWARM_MAX_PACK } from '../../data/swarmDrones.js';
import { SWARM_CLASS_ROW, SWARM_CLASS_ROWS, swarmClassTable } from './swarmClassTable.js';
import { SWARM_OP_TIMES } from '../../game/swarm/swarmExecCpu.js';
import { SWARM_ORCA_LINES } from '../../game/swarm/swarmOrca.js';

export const SWARM_GRID_BITS = 16;
export const SWARM_GRID_CELLS = 1 << SWARM_GRID_BITS;
export const SWARM_GRID_K = 40;
export const SWARM_STATS = Object.freeze({
  MIN_SEP: 0, COLLISIONS: 1, NEAR: 2, GUIDED: 3, WAITING: 4, FREE: 5, ACTIVE: 6, OVERFLOW: 7,
  /** Najbliższa para kroku: (stosunek × 100) << 16 | faza i << 8 | faza j (j: z kroku poprzedniego). */
  MIN_PAIR: 8,
  /** (stosunek × 100) << 16 | ładunek i << 9 | ładunek j << 8 | klasa i << 4 | klasa j. */
  MIN_PAIR_KIND: 9,
  /** Pary poniżej 0,6 obrysu (głębokie naruszenie). */
  DEEP: 10,
  /** Najmniejsza PRAWDZIWA przerwa między dronami (obrysy z kursem — SAT, pas pionowy): (gap + 100) × 100. */
  MIN_GAP: 11,
  /** Drony w tłoku (program liniowy ORCA bez rozwiązania — najmniejsze naruszenie). */
  DENSE: 12,
  /** Suma półpłaszczyzn ORCA w kroku. */
  LINES: 13
});
export const SWARM_STATS_SLOTS = 16;

/** Strojenie lotu i unikania (uniformy — zmiana w biegu bez przebudowy). */
export const SWARM_SIM_TUNE = {
  dt: 1 / 60,
  cell: 64,              // komórka siatki sąsiadów [j.]
  avoidOn: 1,            // 0 — bez unikania (porównanie w demie)
  orcaTau: 1.5,          // horyzont ORCA [s]
  orcaReach: 1.0,        // koło prędkości osiągalnych programu liniowego: przyspieszenie klasy × [s]
  orcaEsc: 0.35,         // wyjście z nakładania obrysów w [s]
  margin: 1.4,           // zapas poziomy między obrysami (prostokąty z kursem) [j.]
  marginZ: 1.4,          // zapas pionowy [j.]
  vertPref: 1.6,         // wyjście z nakładania w pionie tańsze niż w poziomie
  kV: 3.6,               // śledzenie prędkości zadanej na torze prowadzonym [1/s]
  kVfree: 20,            // śledzenie prędkości w wolnym locie (ORCA) [1/s]
  lag: 0.28,             // kompensacja opóźnienia regulatora w profilu hamowania [s]
  levelClear: 2.5,       // zapas pasma podejścia nad wejściem (ponad wysokość drona z kontenerem)
  kP: 1.15,              // wzmocnienie dolotu do punktu [1/s]
  glide: 2.6,            // długość wznoszenia / zejścia z warstwy / wysokość (≈ vPoz / vPion klasy)
  arrive: 2.4,           // promień przylotu do wejścia [j.] (+ 4% rh)
  clear: 3.0,            // zapas nad mapą przeszkód
  look: 0.6,             // wyprzedzenie próbki mapy [s]
  brake: 0.7,            // hamowanie przed sąsiadem: ułamek przyspieszenia klasy
  shortHop: 260,         // odcinek krótszy — lot bez warstwy przelotu
  alignPos: 0.35,        // tolerancja pozycji przed zejściem [j.]
  alignYaw: 0.05,        // tolerancja kursu [rad]
  layersOn: 1            // 0 — wszyscy na jednej warstwie (porównanie w demie)
};

const P = SWARM_PHASE;
const DV = SWARM_DRONE_VEC4;
const DR = SWARM_DRONE;
const TV = SWARM_TASK_VEC4;
const TK = SWARM_TASK;
const UV = SWARM_UNIT_VEC4;
const CR = SWARM_CLASS_ROW;
const TWO_PI = Math.PI * 2;

const wrapAngle = (a) => a.sub(floor(a.add(Math.PI).div(TWO_PI)).mul(TWO_PI));
const det2 = (a, b) => a.x.mul(b.y).sub(a.y.mul(b.x));

/**
 * Środek kontenera k chwytu nx × ny (węzły klasy) względem haka w układzie drona — lustro
 * swarmPackSlotOffset (src/data/swarmDrones.js): ((k mod nx − (nx − 1) / 2) · 16,25; (⌊k / nx⌋ − (ny − 1) / 2) · 8,25).
 */
function packSlotOffset(k, nx, ny) {
  const py = floor(float(k).div(nx));
  const px = float(k).sub(py.mul(nx));
  return vec2(px.sub(nx.sub(1.0).mul(0.5)).mul(SWARM_CELL_PITCH.a), py.sub(ny.sub(1.0).mul(0.5)).mul(SWARM_CELL_PITCH.b));
}

/** Kontenery chwytu z rekordu zadania (UNITS_A: miejsca 0…3, UNITS_B: 4…7; −1 — puste): fn(u, k). */
function forPackUnits(tUA, tUB, fn) {
  const comp = ['x', 'y', 'z', 'w'];
  for (let k = 0; k < SWARM_MAX_PACK; k++) {
    const u = (k < 4 ? tUA : tUB)[comp[k & 3]];
    If(u.greaterThan(-0.5), () => { fn(u, k); });
  }
}

// Program liniowy ORCA (RVO2 linearProgram1 / 2 / 3; lustro CPU: src/game/swarm/swarmOrca.js).
// Linie w tablicy lokalnej vec4 (punkt xy, kierunek zw; dozwolona lewa strona kierunku).

/** linearProgram1: najlepszy punkt na linii `no` przy liniach 0 … no − 1 (wynik w `res`); 1 — jest. */
function orcaLp1(L, no, radius, opt, dirOpt, res, tag) {
  const ok = int(1).toVar();
  const Ln = L.element(no).toVar();
  const dotP = dot(Ln.xy, Ln.zw);
  const disc = dotP.mul(dotP).add(radius.mul(radius)).sub(dot(Ln.xy, Ln.xy));
  If(disc.lessThan(0.0), () => { ok.assign(0); }).Else(() => {
    const sq = sqrt(disc);
    const tL = dotP.negate().sub(sq).toVar();
    const tR = dotP.negate().add(sq).toVar();
    const nm = `o1${tag}`;
    Loop({ start: int(0), end: no, type: 'int', condition: '<', name: nm }, (a) => {
      const K = L.element(a[nm]).toVar();
      const den = det2(Ln.zw, K.zw);
      const num = det2(K.zw, Ln.xy.sub(K.xy));
      If(abs(den).lessThanEqual(1e-5), () => {
        If(num.lessThan(0.0), () => { ok.assign(0); Break(); });
      }).Else(() => {
        const t = num.div(den);
        If(den.greaterThanEqual(0.0), () => { tR.assign(min(tR, t)); }).Else(() => { tL.assign(max(tL, t)); });
        If(tL.greaterThan(tR), () => { ok.assign(0); Break(); });
      });
    });
    If(ok.equal(int(1)), () => {
      if (dirOpt) {
        res.assign(select(dot(opt, Ln.zw).greaterThan(0.0), Ln.xy.add(Ln.zw.mul(tR)), Ln.xy.add(Ln.zw.mul(tL))));
      } else {
        res.assign(Ln.xy.add(Ln.zw.mul(clamp(dot(Ln.zw, opt.sub(Ln.xy)), tL, tR))));
      }
    });
  });
  return ok;
}

/** linearProgram2: prędkość najbliższa `opt` (dirOpt: kierunek) w kole `radius`; zwraca numer linii bez rozwiązania (n — sukces). */
function orcaLp2(L, n, radius, opt, dirOpt, res, tag) {
  const fail = int(n).toVar();
  if (dirOpt) res.assign(opt.mul(radius));
  else res.assign(select(dot(opt, opt).greaterThan(radius.mul(radius)), normalize(opt).mul(radius), opt));
  const nm = `o2${tag}`;
  Loop({ start: int(0), end: n, type: 'int', condition: '<', name: nm }, (a) => {
    const li = a[nm];
    const Li = L.element(li).toVar();
    If(det2(Li.zw, Li.xy.sub(res)).greaterThan(0.0), () => {
      const keep = res.toVar();
      const ok = orcaLp1(L, li, radius, opt, dirOpt, res, tag);
      If(ok.equal(int(0)), () => { res.assign(keep); fail.assign(li); Break(); });
    });
  });
  return fail;
}

/**
 * linearProgram3: tłok — prędkość o najmniejszym największym naruszeniu linii miękkich; linie
 * twarde [0, nHard) zostają bez zmian (jak linie przeszkód RVO2).
 */
function orcaLp3(L, Pj, n, nHard, begin, radius, res) {
  const dist = float(0.0).toVar();
  Loop({ start: begin, end: n, type: 'int', condition: '<', name: 'o3i' }, ({ o3i }) => {
    const Li = L.element(o3i).toVar();
    If(det2(Li.zw, Li.xy.sub(res)).greaterThan(dist), () => {
      const np = int(0).toVar();
      Loop({ start: int(0), end: nHard, type: 'int', condition: '<', name: 'o3h' }, ({ o3h }) => {
        Pj.element(np).assign(L.element(o3h));
        np.addAssign(1);
      });
      Loop({ start: nHard, end: o3i, type: 'int', condition: '<', name: 'o3j' }, ({ o3j }) => {
        const Lj = L.element(o3j).toVar();
        const dd = det2(Li.zw, Lj.zw);
        const pt = vec2(0.0).toVar();
        const use = int(1).toVar();
        If(abs(dd).lessThanEqual(1e-5), () => {
          If(dot(Li.zw, Lj.zw).greaterThan(0.0), () => { use.assign(0); }).Else(() => { pt.assign(Li.xy.add(Lj.xy).mul(0.5)); });
        }).Else(() => {
          pt.assign(Li.xy.add(Li.zw.mul(det2(Lj.zw, Li.xy.sub(Lj.xy)).div(dd))));
        });
        If(use.equal(int(1)), () => {
          Pj.element(np).assign(vec4(pt, normalize(Lj.zw.sub(Li.zw))));
          np.addAssign(1);
        });
      });
      const keep = res.toVar();
      const f = orcaLp2(Pj, np, radius, vec2(Li.w.negate(), Li.z), true, res, 'p');
      If(f.lessThan(np), () => { res.assign(keep); });
      dist.assign(det2(Li.zw, Li.xy.sub(res)));
    });
  });
}

/**
 * Trwały odczyt bufora storage na CPU (pierścień buforów MAP_READ — bez tworzenia buforu co
 * klatkę jak getArrayBufferAsync three). request(bajty) — kopia na końcu kolejki; latest —
 * ostatnie gotowe dane (Float32Array widok kopii) albo null.
 */
export class SwarmReadback {
  constructor(renderer, node, floats, slots = 3) {
    this.renderer = renderer;
    this.node = node;
    this.floats = floats;
    this.slots = [];
    for (let k = 0; k < slots; k++) this.slots.push({ buf: null, busy: false });
    this.latest = new Float32Array(floats);
    this.frame = -1;
    this.requested = 0;
    this.completed = 0;
    this.epoch = 0;
  }

  /** Nowa scena: wyzeruj dane i odrzucaj odczyty zlecone wcześniej (jeszcze w locie). */
  reset() {
    this.epoch++;
    this.latest.fill(0);
    this.frame = -1;
  }

  /** Kopia `floats` liczb od `offsetFloats` (liczby 4-bajtowe) bufora źródłowego. */
  request(floats = this.floats, offsetFloats = 0) {
    const backend = this.renderer?.backend;
    const device = backend?.device;
    const src = backend?.get?.(this.node.value)?.buffer;
    if (!device || !src) return false;
    const slot = this.slots.find((s) => !s.busy);
    if (!slot) return false;
    const offset = Math.max(0, Math.floor(offsetFloats)) * 4;
    const bytes = Math.min(src.size - offset, Math.max(16, Math.ceil(floats * 4 / 16) * 16));
    if (bytes <= 0) return false;
    if (!slot.buf || slot.buf.size < bytes) {
      slot.buf?.destroy?.();
      slot.buf = device.createBuffer({ label: 'swarmReadback', size: Math.max(bytes, this.floats * 4), usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    }
    slot.busy = true;
    const enc = device.createCommandEncoder({ label: 'swarmReadback' });
    enc.copyBufferToBuffer(src, offset, slot.buf, 0, bytes);
    device.queue.submit([enc.finish()]);
    const frame = ++this.requested;
    const epoch = this.epoch;
    slot.buf.mapAsync(GPUMapMode.READ, 0, bytes).then(() => {
      if (frame > this.frame && epoch === this.epoch) {
        this.latest.set(new Float32Array(slot.buf.getMappedRange(0, bytes)).subarray(0, Math.min(this.floats, bytes / 4)));
        this.frame = frame;
      }
      slot.buf.unmap();
      slot.busy = false;
      this.completed++;
    }).catch(() => { slot.busy = false; });
    return true;
  }

  dispose() {
    for (const s of this.slots) s.buf?.destroy?.();
    this.slots.length = 0;
  }
}

export class SwarmSim {
  /**
   * @param {{ maxDrones: number, maxUnits: number, maxColumns: number, hfCells: number }} o
   */
  constructor(o) {
    this.maxDrones = Math.max(1, o.maxDrones | 0);
    this.maxUnits = Math.max(1, o.maxUnits | 0);
    this.maxColumns = Math.max(1, o.maxColumns | 0);
    this.hfCells = Math.max(1, o.hfCells | 0);
    this.tune = { ...SWARM_SIM_TUNE, ...(o.tune || {}) };
    this.drones = instancedArray(this.maxDrones * DV, 'vec4').setName('swarmDrones');
    this.tasks = instancedArray(this.maxDrones * SWARM_TASK_RING * TV, 'vec4').setName('swarmTasks');
    this.units = instancedArray(this.maxUnits * UV, 'vec4').setName('swarmUnits');
    this.cols = instancedArray(this.maxColumns * 2, 'uint').setName('swarmCols').toAtomic();
    this.gridCount = instancedArray(SWARM_GRID_CELLS, 'uint').setName('swarmGridCount').toAtomic();
    this.gridItems = instancedArray(SWARM_GRID_CELLS * SWARM_GRID_K, 'uint').setName('swarmGridItems');
    this.height = instancedArray(this.hfCells, 'float').setName('swarmHeight');
    this.status = instancedArray(this.maxDrones, 'vec4').setName('swarmStatus');
    this.statsBuf = instancedArray(SWARM_STATS_SLOTS, 'uint').setName('swarmStats').toAtomic();
    this.classTable = swarmClassTable();
    const t = this.tune;
    this.U = {
      dt: uniform(t.dt),
      time: uniform(0),
      nDrones: uniform(0, 'uint'),
      cell: uniform(t.cell),
      avoidOn: uniform(t.avoidOn),
      orcaTau: uniform(t.orcaTau),
      orcaReach: uniform(t.orcaReach),
      orcaEsc: uniform(t.orcaEsc),
      kVfree: uniform(t.kVfree),
      margin: uniform(t.margin),
      marginZ: uniform(t.marginZ),
      vertPref: uniform(t.vertPref),
      kV: uniform(t.kV),
      lag: uniform(t.lag),
      levelClear: uniform(t.levelClear),
      kP: uniform(t.kP),
      glide: uniform(t.glide),
      arrive: uniform(t.arrive),
      clear: uniform(t.clear),
      look: uniform(t.look),
      brake: uniform(t.brake),
      shortHop: uniform(t.shortHop),
      alignPos: uniform(t.alignPos),
      alignYaw: uniform(t.alignYaw),
      layersOn: uniform(t.layersOn),
      debug: uniform(0),
      layer0: uniform(120),
      layerDZ: uniform(30),
      layerCount: uniform(4),
      hf: uniform(new THREE.Vector4(0, 0, 8, 1)),    // x0, y0, komórka, W
      hfH: uniform(1)
    };
    this.kClear = this._buildClear();
    this.kBin = this._buildBin();
    this.kSteer = this._buildSteer();
    this.kIntegrate = this._buildIntegrate();
    this.count = 0;
    this.time = 0;
    this.acc = 0;
    this.steps = 0;
    this.readback = null;
    this.statsReadback = null;
    this.stats = new Float64Array(SWARM_STATS_SLOTS); // u32 spakowane (MIN_PAIR) — Float32 zgubiłby młodsze bity
    this._taskDirty = [];
  }

  // -------------------------------------------------------------------------
  // CPU: stan początkowy, zadania, strojenie
  // -------------------------------------------------------------------------

  /**
   * Stan początkowy sceny (pełna wysyłka buforów): drony [{ classId (indeks klasy), x, y, z (hak
   * w gnieździe), entryZ (wejście gniazda), seed }], kontenery [{ x, y, z, yaw, bay }] (środek
   * podstawy), liczniki kontenerów w kolumnach (Int32Array — swarmColumnCounts), mapa przeszkód
   * { data, W, H, x0, y0, cell }, warstwy { z0, dz, count }.
   */
  init({ drones, units, heights, hf, layers }) {
    // Pełna wysyłka: zakresy z poprzedniej sceny (galeria, zadania) zostałyby wysłane zamiast
    // całego bufora (three r183 przy niepustych updateRanges wysyła tylko je).
    for (const n of [this.drones, this.tasks, this.units, this.cols, this.height]) n.value.clearUpdateRanges();
    const nD = Math.min(drones.length, this.maxDrones);
    const D = this.drones.value.array;
    D.fill(0);
    for (let i = 0; i < nD; i++) {
      const d = drones[i];
      const o = i * DV * 4;
      const set = (k, a, b, c, e) => { const q = o + k * 4; D[q] = a; D[q + 1] = b; D[q + 2] = c; D[q + 3] = e; };
      set(DR.POSE, d.x, d.y, d.z, d.yaw || 0);
      set(DR.VEL, 0, 0, 0, 0);
      set(DR.VNEW, 0, 0, 0, 0);
      set(DR.CTL, P.PARKED, 0, 0, 0);
      set(DR.LOOK, 0, 0, 0, SWARM_STATUS_CODE.PARKED);
      set(DR.MOTION, 0, 0, 0, 0);
      set(DR.INFO, d.classIndex, d.seed ?? (i * 0.6180339887) % 1, -1, 1);
      set(DR.NBR, 1, 1, 0, 1);
      set(DR.NEST, d.x, d.y, d.z, d.entryZ);
      set(DR.LEG, d.x, d.y, d.z, d.entryZ);
      set(DR.AUX, -1, -1, d.yaw || 0, -1);
    }
    this.drones.value.needsUpdate = true;
    const Tk = this.tasks.value.array;
    Tk.fill(0);
    // Numery zadań −1: pierścień pusty.
    for (let i = 0; i < this.maxDrones * SWARM_TASK_RING; i++) Tk[(i * TV + TK.IDS) * 4 + 1] = -1;
    this.tasks.value.needsUpdate = true;
    // Pierwsza wysyłka zadań po init — pełna: zakresy dopisane przez planistę w tej samej klatce
    // (three r183 przy niepustych updateRanges wysyła tylko je) zostawiały na GPU rekordy zadań
    // z poprzedniej sceny, a dron z pasującym numerem zadania wykonywał cudze (zastoje, zamki < 0).
    this._tasksFull = true;
    const U = this.units.value.array;
    U.fill(0);
    const nU = Math.min(units.length, this.maxUnits);
    for (let k = 0; k < nU; k++) {
      const u = units[k];
      const o = k * UV * 4;
      U[o] = u.x; U[o + 1] = u.y; U[o + 2] = u.z; U[o + 3] = u.yaw;
      U[o + 4] = u.bay; U[o + 5] = 1; U[o + 6] = -1; U[o + 7] = 0;
    }
    this.units.value.needsUpdate = true;
    const C = this.cols.value.array;
    C.fill(0);
    for (let c = 0; c < Math.min(heights.length, this.maxColumns); c++) C[c * 2] = heights[c];
    this.cols.value.needsUpdate = true;
    const Hh = this.height.value.array;
    Hh.fill(-1e4);
    if (hf) Hh.set(hf.data.subarray(0, Math.min(hf.data.length, Hh.length)));
    this.height.value.needsUpdate = true;
    if (hf) { this.U.hf.value.set(hf.x0, hf.y0, hf.cell, hf.W); this.U.hfH.value = hf.H; }
    if (layers) { this.U.layer0.value = layers.z0; this.U.layerDZ.value = layers.dz; this.U.layerCount.value = layers.count; }
    this.count = nD;
    this.unitCount = nU;
    this.U.nDrones.value = nD;
    this.readback?.reset();
    this.statsReadback?.reset();
    this.stats.fill(0);
    this.time = 0;
    this.acc = 0;
    this.steps = 0;
    this._taskDirty.length = 0;
  }

  /** Zadanie planisty → slot pierścienia (serial % 2) drona; wysyłka zakresem w następnym kroku. */
  writeTask(drone, serial, rec) {
    const o = (drone * SWARM_TASK_RING + (serial % SWARM_TASK_RING)) * TV * 4;
    this.tasks.value.array.set(rec, o);
    this._taskDirty.push(o);
  }

  _flushTasks() {
    const list = this._taskDirty;
    if (this._tasksFull) {
      this._tasksFull = false;
      this.tasks.value.clearUpdateRanges();
      this.tasks.value.needsUpdate = true;
      list.length = 0;
      return;
    }
    if (!list.length) return;
    list.sort((a, b) => a - b);
    const attr = this.tasks.value;
    let s = list[0];
    let e = s + SWARM_TASK_FLOATS;
    for (let k = 1; k < list.length; k++) {
      const o = list[k];
      if (o <= e) { e = Math.max(e, o + SWARM_TASK_FLOATS); continue; }
      attr.addUpdateRange(s, e - s);
      s = o; e = o + SWARM_TASK_FLOATS;
    }
    attr.addUpdateRange(s, e - s);
    attr.needsUpdate = true;
    list.length = 0;
  }

  setTune(key, v) {
    if (key in this.U && typeof v === 'number') { this.U[key].value = v; this.tune[key] = v; }
  }

  /**
   * Krok symulacji: frameDt × tempo, krok stały (dt), najwyżej maxSteps na klatkę — jedno
   * renderer.compute(lista). Zwraca liczbę kroków.
   */
  step(renderer, frameDt, speed = 1, maxSteps = 8) {
    if (!this.count) return 0;
    this._flushTasks();
    const dt = this.tune.dt;
    this.acc = Math.min(this.acc + frameDt * speed, dt * maxSteps);
    let n = Math.floor(this.acc / dt + 1e-6);
    if (n <= 0) return 0;
    this.acc -= n * dt;
    const list = [];
    for (let k = 0; k < n; k++) list.push(this.kClear, this.kBin, this.kSteer, this.kIntegrate);
    this.U.time.value = this.time;
    renderer.compute(list);
    this.time += n * dt;
    this.steps += n;
    return n;
  }

  /** Odczyt stanu dronów (planista) i statystyk — co klatkę, z opóźnieniem 1–3 klatek. */
  requestReadback(renderer) {
    if (!this.readback) this.readback = new SwarmReadback(renderer, this.status, this.maxDrones * 4, 3);
    if (!this.statsReadback) this.statsReadback = new SwarmReadback(renderer, this.statsBuf, SWARM_STATS_SLOTS, 2);
    this.readback.request(this.count * 4);
    this.statsReadback.request(SWARM_STATS_SLOTS);
    const raw = this.statsReadback.latest;
    // Bufor atomowy u32 → liczby (widok Float32 kopii — przepisz bity); przed pierwszym odczytem
    // sceny — „brak danych” (minima na maksimum).
    if (this.statsReadback.frame < 0) {
      this.stats.fill(0);
      for (const k of [SWARM_STATS.MIN_SEP, SWARM_STATS.MIN_PAIR, SWARM_STATS.MIN_PAIR_KIND, SWARM_STATS.MIN_GAP]) this.stats[k] = 0xffffffff;
      return;
    }
    const u = new Uint32Array(raw.buffer, raw.byteOffset, SWARM_STATS_SLOTS);
    for (let k = 0; k < SWARM_STATS_SLOTS; k++) this.stats[k] = u[k];
  }

  /** Ostatni odczyt stanu dronów tej sceny (null — jeszcze żaden nie wrócił po init()). */
  get statusData() { return this.readback && this.readback.frame >= 0 ? this.readback.latest : null; }

  dispose() {
    this.readback?.dispose();
    this.statsReadback?.dispose();
  }

  // -------------------------------------------------------------------------
  // Kernele
  // -------------------------------------------------------------------------

  _buildClear() {
    const cnt = this.gridCount;
    const st = this.statsBuf;
    return Fn(() => {
      const i = instanceIndex;
      atomicStore(cnt.element(i), uint(0));
      // Statystyki chwilowe (każdy krok od nowa; odczyt widzi ostatni krok klatki).
      If(i.lessThan(uint(SWARM_STATS_SLOTS)), () => {
        const big = i.equal(uint(0)).or(i.equal(uint(SWARM_STATS.MIN_PAIR))).or(i.equal(uint(SWARM_STATS.MIN_PAIR_KIND)))
          .or(i.equal(uint(SWARM_STATS.MIN_GAP)));
        atomicStore(st.element(i), select(big, uint(0xffffffff), uint(0)));
      });
    })().compute(SWARM_GRID_CELLS).setName('swarmClear');
  }

  _cellHash(cx, cy) {
    // Komórki dodatnie (przesunięcie 2^15) — mnożenia na u32 bez zależności od znaku.
    const ux = uint(cx.add(32768));
    const uy = uint(cy.add(32768));
    return ux.mul(uint(73856093)).bitXor(uy.mul(uint(19349663))).bitAnd(uint(SWARM_GRID_CELLS - 1));
  }

  _buildBin() {
    const U = this.U;
    const D = this.drones;
    const cnt = this.gridCount;
    const items = this.gridItems;
    const st = this.statsBuf;
    return Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(U.nDrones), () => { Return(); });
      const base = i.mul(uint(DV));
      const ctl = D.element(base.add(uint(DR.CTL)));
      // Drony w gniazdach nie biorą udziału w unikaniu (stoją na pokładzie pod wejściami gniazd).
      If(int(ctl.x).equal(int(P.PARKED)), () => { Return(); });
      const p = D.element(base.add(uint(DR.POSE)));
      const cx = int(floor(p.x.div(U.cell)));
      const cy = int(floor(p.y.div(U.cell)));
      const h = this._cellHash(cx, cy);
      const k = atomicAdd(cnt.element(h), uint(1)).toVar();
      If(k.lessThan(uint(SWARM_GRID_K)), () => {
        items.element(h.mul(uint(SWARM_GRID_K)).add(k)).assign(i);
      }).Else(() => {
        atomicAdd(st.element(uint(SWARM_STATS.OVERFLOW)), uint(1));
      });
    })().compute(this.maxDrones).setName('swarmBin');
  }

  _buildSteer() {
    const U = this.U;
    const D = this.drones;
    const Tq = this.tasks;
    const Un = this.units;
    const Cl = this.cols;
    const cnt = this.gridCount;
    const items = this.gridItems;
    const Hf = this.height;
    const st = this.statsBuf;
    const CT = this.classTable;

    const hfAt = (x, y) => {
      const i = int(floor(x.sub(U.hf.x).div(U.hf.z)));
      const j = int(floor(y.sub(U.hf.y).div(U.hf.z)));
      const W = int(U.hf.w);
      const H = int(U.hfH);
      const inside = i.greaterThanEqual(int(0)).and(j.greaterThanEqual(int(0))).and(i.lessThan(W)).and(j.lessThan(H));
      const k = uint(clamp(j, int(0), H.sub(1)).mul(W).add(clamp(i, int(0), W.sub(1))));
      return select(inside, Hf.element(k), float(-1e4));
    };

    return Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(U.nDrones), () => { Return(); });
      const dt = U.dt;
      const base = i.mul(uint(DV));
      const pose = D.element(base.add(uint(DR.POSE))).toVar();
      const vel = D.element(base.add(uint(DR.VEL))).toVar();
      const ctl = D.element(base.add(uint(DR.CTL))).toVar();
      const look = D.element(base.add(uint(DR.LOOK))).toVar();
      const motion = D.element(base.add(uint(DR.MOTION))).toVar();
      const info = D.element(base.add(uint(DR.INFO))).toVar();
      const nbrSelf = D.element(base.add(uint(DR.NBR))).toVar();
      const nest = D.element(base.add(uint(DR.NEST))).toVar();
      const leg = D.element(base.add(uint(DR.LEG))).toVar();
      const aux = D.element(base.add(uint(DR.AUX))).toVar();

      const cb = int(info.x).mul(SWARM_CLASS_ROWS);
      const rFlight = CT.element(cb.add(CR.FLIGHT));
      const rYaw = CT.element(cb.add(CR.YAW));
      const rPay = CT.element(cb.add(CR.PAYLOAD));
      const rExtE = CT.element(cb.add(CR.EXT_EMPTY));
      const rExtL = CT.element(cb.add(CR.EXT_LOADED));
      const rFoot = CT.element(cb.add(CR.FOOT_EMPTY));

      const phase = int(ctl.x).toVar();
      const timer = ctl.y.add(dt).toVar();
      const serial = ctl.z.toVar();
      const layer = ctl.w.toVar();
      const p = pose.xyz.toVar();
      const v = vel.xyz.toVar();
      const carried = aux.x.greaterThan(-0.5);
      const loadedF = select(carried, float(1.0), float(0.0)).toVar();
      const vMax = rFlight.x.mul(mix(float(1.0), float(SWARM_LOADED_SPEED), loadedF)).toVar();
      const aMax = rFlight.y.mul(mix(float(1.0), float(SWARM_LOADED_ACCEL), loadedF)).toVar();
      const vV = rFlight.z.toVar();
      const aV = rFlight.w.toVar();
      const H = rPay.z;
      const payW = rPay.y;

      // Zadanie bieżące (slot serial % 2) i następne.
      const sInt = int(serial);
      const slotCur = uint(sInt.bitAnd(int(1)));
      const tb = i.mul(uint(SWARM_TASK_RING)).add(slotCur).mul(uint(TV));
      const tPick = Tq.element(tb.add(uint(TK.PICK))).toVar();
      const tDrop = Tq.element(tb.add(uint(TK.DROP))).toVar();
      const tAlt = Tq.element(tb.add(uint(TK.ALT))).toVar();
      const tIds = Tq.element(tb.add(uint(TK.IDS))).toVar();
      const tLev = Tq.element(tb.add(uint(TK.LEVELS))).toVar();
      const tCeil = Tq.element(tb.add(uint(TK.CEIL))).toVar();
      const tUA = Tq.element(tb.add(uint(TK.UNITS_A))).toVar();
      const tUB = Tq.element(tb.add(uint(TK.UNITS_B))).toVar();
      const taskValid = abs(tIds.y.sub(serial)).lessThan(0.25);
      const tbNext = i.mul(uint(SWARM_TASK_RING)).add(uint(sInt.add(1).bitAnd(int(1)))).mul(uint(TV));
      const nextSerial = Tq.element(tbNext.add(uint(TK.IDS))).y;
      const nextValid = abs(nextSerial.sub(serial.add(1.0))).lessThan(0.25);

      // Wyjścia kroku.
      const nPhase = phase.toVar();
      const nTimer = timer.toVar();
      const nSerial = serial.toVar();
      const nLayer = layer.toVar();
      const vDes = vec3(0.0).toVar();
      const guided = float(1.0).toVar();       // 1 — tor prowadzony (bez unikania), 0 — wolny lot
      const yawDes = aux.z.toVar();
      const freeYaw = float(0.0).toVar();      // 1 — kurs za prędkością (wolny lot daleko od celu)
      const eArm = look.x.toVar();
      const gArm = look.y.toVar();
      const code = float(SWARM_STATUS_CODE.EMPTY).toVar();
      const waitT = motion.w.toVar();
      const nAux = aux.toVar();
      const nLeg = leg.toVar();
      const bayLight = float(-1.0).toVar();
      const freeTarget = vec3(0.0).toVar();    // cel wolnego lotu (wejście)
      const isFree = float(0.0).toVar();

      // Prowadzony ruch do punktu: profil hamowania √(2 · 0,6 a · d) z kompensacją opóźnienia
      // regulatora (droga liczona do punktu minus |v| · τ — bez tego dron dolatywał z ~100 j/s
      // i przelatywał punkt wejścia o 20 j., nad sąsiednią kolumnę).
      const guidedVel = (T, vh, vv, ah, av) => {
        const d = T.sub(p);
        const dh = length(d.xy);
        const lagH = length(v.xy).mul(U.lag);
        const spH = min(min(vh, sqrt(ah.mul(1.2).mul(max(dh.sub(lagH), 0.0)))), dh.mul(U.kP).mul(2.0));
        const dirH = select(dh.greaterThan(1e-4), d.xy.div(max(dh, 1e-4)), vec2(0.0));
        const adz = abs(d.z);
        const lagV = abs(v.z).mul(U.lag);
        const spV = min(min(vv, sqrt(av.mul(1.2).mul(max(adz.sub(lagV), 0.0)))), adz.mul(U.kP).mul(2.4)).mul(select(d.z.greaterThan(0.0), float(1.0), float(-1.0)));
        return vec3(dirH.mul(spH), spV);
      };

      // Początek odcinka wolnego lotu: punkt startu, wysokość przelotu (warstwa wg kursu albo hop).
      const startLeg = (tx, ty, tz, zHi) => {
        const dx = tx.sub(p.x);
        const dy = ty.sub(p.y);
        const dist = length(vec2(dx, dy));
        const ang = atan(dy, dx);
        const q = floor(ang.add(Math.PI / 4).div(Math.PI / 2).add(4.0));
        const sector = q.sub(floor(q.div(4.0)).mul(4.0));
        const lay = select(U.layersOn.greaterThan(0.5), sector.sub(floor(sector.div(U.layerCount)).mul(U.layerCount)), float(0.0));
        const cruise = U.layer0.add(lay.mul(U.layerDZ));
        const hop = max(p.z, tz).add(U.layerDZ.mul(0.5));
        const zc = select(dist.lessThan(U.shortHop), min(hop, cruise), cruise);
        // LEG.z = pasmo wyjścia (dron najpierw pionowo do niego, dopiero potem w bok).
        nLeg.assign(vec4(p.x, p.y, max(zHi, p.z), max(zc, zHi)));
        nLayer.assign(lay);
      };

      const P_ = (x) => int(x);
      // Zwolnienie zamka poprzedniej kolumny (przed zejściem do innej albo przed nowym zwolnieniem
      // — przy podwójnym cyklu następny stos bywa obok, a jedno pole na zamek nadpisałoby stary).
      // Zwolnienie zamka bez przejścia przez zero (licznik u32 — podwójne zwolnienie dawało 2³² − 1
      // i kolumna zostawała zamknięta na zawsze).
      const unlockCol = (col) => {
        const old = atomicSub(Cl.element(col.mul(uint(2)).add(uint(1))), uint(1)).toVar();
        If(old.equal(uint(0)), () => { atomicAdd(Cl.element(col.mul(uint(2)).add(uint(1))), uint(1)); });
      };
      const releasePending = () => {
        If(nAux.y.greaterThan(-0.5), () => {
          unlockCol(uint(int(nAux.y)));
          nAux.y.assign(-1.0);
        });
      };
      // -----------------------------------------------------------------
      // Maszyna stanów
      // -----------------------------------------------------------------
      If(phase.equal(P_(P.PARKED)), () => {
        code.assign(float(SWARM_STATUS_CODE.PARKED));
        eArm.assign(0.0); gArm.assign(0.0);
        vDes.assign(vec3(0.0));
        If(taskValid, () => { nPhase.assign(P_(P.LAUNCH)); nTimer.assign(0.0); });
      }).ElseIf(phase.equal(P_(P.LAUNCH)), () => {
        code.assign(float(SWARM_STATUS_CODE.DOCKING));
        const T = vec3(nest.x, nest.y, nest.w);
        vDes.assign(guidedVel(T, vMax.mul(0.3), vV, aMax, aV));
        If(abs(p.z.sub(nest.w)).lessThan(0.6), () => {
          nPhase.assign(P_(P.TO_PICK));
          nTimer.assign(0.0);
          startLeg(tPick.x, tPick.y, tAlt.x, p.z);
        });
      }).ElseIf(phase.equal(P_(P.TO_PICK)).or(phase.equal(P_(P.TO_DROP))).or(phase.equal(P_(P.RETURN))), () => {
        isFree.assign(1.0);
        guided.assign(0.0);
        const toPick = phase.equal(P_(P.TO_PICK));
        const toDrop = phase.equal(P_(P.TO_DROP));
        const tx = select(toPick, tPick.x, select(toDrop, tDrop.x, nest.x));
        const ty = select(toPick, tPick.y, select(toDrop, tDrop.y, nest.y));
        const tz = select(toPick, tAlt.x, select(toDrop, tAlt.y, nest.w));
        freeTarget.assign(vec3(tx, ty, tz));
        code.assign(select(carried, float(SWARM_STATUS_CODE.LOADED), float(SWARM_STATUS_CODE.EMPTY)));
        // Ramiona: z ładunkiem rozłożone, bez — złożone.
        eArm.assign(mix(eArm, loadedF, min(dt.mul(3.0), 1.0)));
        // Pasma ruchu nad siatką: WEJŚCIE (tz, dwa poziomy w szachownicę) — tylko pion dokładnie nad
        // własną kolumną; PODEJŚCIE (ceil siatki z zadania, nad obydwoma poziomami) — tu ruch w bok
        // nad siatką; wyżej warstwy przelotu. Wychodzący dron wznosi się pionowo do pasma (LEG.z),
        // dolatujący opada z pasma dopiero nad swoją kolumną (dh < 3,5 j.).
        const dh = length(vec2(tx, ty).sub(p.xy)).toVar();
        const ds = length(p.xy.sub(nLeg.xy)).toVar();
        const dA = rExtL.z.sub(rExtL.y).add(U.levelClear);
        const zStartHi = nLeg.z;
        const zBand = max(select(toPick, tCeil.x, select(toDrop, tCeil.y, nest.w.add(dA))), tz);
        // Kolumna celu zajęta (zamek trzyma dron, który w niej pracuje albo z niej wychodzi): blisko
        // celu czekaj pasmo WYŻEJ — wychodzący wznosi się w pasmo podejścia pod czekającym i odlatuje
        // w bok (czekający w paśmie podejścia nad kolumną zamykał mu wyjście — zastój).
        const colT = select(toPick, tIds.z, select(toDrop, tIds.w, float(-1.0)));
        const lockN = atomicLoad(Cl.element(uint(int(max(colT, 0.0))).mul(uint(2)).add(uint(1)))).toVar();
        const mine = select(abs(nAux.y.sub(colT)).lessThan(0.25), uint(1), uint(0));
        const colBusy = colT.greaterThan(-0.5).and(lockN.greaterThan(mine));
        const holdHi = colBusy.and(dh.lessThan(rExtL.x.mul(3.0).add(24.0)));
        const zTargetHi = zBand.add(select(holdHi, dA, float(0.0)));
        const zC = max(nLeg.w, max(zStartHi, zTargetHi));
        const glideUp = max(float(40.0), zC.sub(zStartHi).mul(U.glide));
        const glideDn = max(float(40.0), zC.sub(zTargetHi).mul(U.glide));
        const up = smoothstep(4.0, glideUp.add(4.0), ds);
        const down = smoothstep(glideDn.mul(0.2).add(6.0), glideDn.add(6.0), dh);
        const slotYawT = select(toPick, tPick.w, select(toDrop, tDrop.w, float(0.0)));
        // Kurs w chwycie / przy odłożeniu wybiera planista (kurs kolumny albo +π — wie, który kontener
        // trafi w którą komórkę), więc liczy się dokładny kurs zadania, nie „kontener symetryczny”.
        const yawErrT = abs(wrapAngle(slotYawT.sub(pose.w)));
        // Zejście czeka na kurs slotu tylko przy kolumnie (kontener w obrysie kolumny); gniazdo kursu
        // nie wymaga — powrót z obróconego placu (kurs 90°) wisiał nad gniazdem bez końca.
        const yawWait = yawErrT.greaterThan(0.1).and(toPick.or(toDrop));
        const zNear = mix(tz, zTargetHi, max(smoothstep(1.2, 3.5, dh), select(yawWait.or(holdHi), float(1.0), float(0.0))));
        // Przy kolumnie wyjścia profil nie schodzi poniżej pasma wyjścia: bliski cel (powrót do
        // gniazda o 150 j.) dawał zejście już nad kolumną, a wychodzący trzyma środek kolumny —
        // opadał w miejscu na stos pod sobą i wisiał na strażniku podłogi (zastój).
        const zDes = max(mix(zNear, mix(zStartHi, zC, up), down), select(ds.lessThan(6.0).and(dh.greaterThan(6.0)), zStartHi, float(-1e6)));
        // Wolny lot: pion do 1,4 × vPion klasy (szybowanie przy pełnej prędkości poziomej).
        vDes.assign(guidedVel(vec3(tx, ty, zDes), vMax, vV.mul(1.4), aMax, aV.mul(1.3)));
        // Wyjście z kolumny: bez ruchu w bok, dopóki dron nie wzniesie się w pasmo podejścia;
        // zejście z pasma: w bok tylko poprawka nad kolumną; dalej — pod profilem najpierw w górę.
        // Cel tuż obok początku odcinka (zadanie dostane w powrocie, nad kolumną źródła) to dolot, nie
        // wyjście — trzymanie początku odcinka zostawiało drona 3 j. od celu na zawsze.
        const departing = ds.lessThan(4.0).and(p.z.lessThan(zStartHi.sub(1.5))).and(dh.greaterThan(6.0));
        // Nad własną kolumną (4 j.) w paśmie podejścia albo niżej — wyrównany już przed zejściem:
        // z pełnym zapasem 1,4 j. szyby sąsiednich kolumn S (szczelina 0,76 j.) „nakładały się”,
        // a dron czekający w paśmie i wznoszący się obok hamowali się nawzajem (zastój).
        const descending = dh.lessThan(4.0).and(p.z.lessThan(zTargetHi.add(1.0)));
        const hGate = float(1.0).sub(smoothstep(10.0, 34.0, zDes.sub(p.z)).mul(0.6));
        vDes.x.mulAssign(hGate);
        vDes.y.mulAssign(hGate);
        // Wyjście: w poziomie trzyma środek kolumny (początek odcinka) — dryf w bok przy wznoszeniu
        // wjeżdżał w szyby sąsiednich kolumn, gdzie pracują drony na torze prowadzonym.
        If(departing, () => {
          const hold = nLeg.xy.sub(p.xy).mul(U.kP.mul(2.0));
          const hl = length(hold);
          const hv = select(hl.greaterThan(6.0), hold.mul(float(6.0).div(max(hl, 1e-4))), hold);
          vDes.x.assign(hv.x);
          vDes.y.assign(hv.y);
        });
        // Obrót zabroniony tylko w szybie kolumny wyjścia (blisko początku odcinka i pod jej pasmem):
        // dawne „poza kolumną I ponad jej pasmem” blokowało obrót nad celem z pasmem niższym niż
        // pasmo startu (statek / plac w innej orientacji) — dron czekał na kurs bez końca.
        freeYaw.assign(select(ds.greaterThan(6.0).or(p.z.greaterThan(zStartHi.sub(1.0))), float(1.0), float(0.0)));
        // Wyrównany nad własną kolumną (wyjście / zejście) — luźniejszy zapas w unikaniu.
        nAux.w.assign(select(departing.or(descending), float(1.0), float(0.0)));
        // Kurs przy celu: kurs z zadania (planista wybrał kurs kolumny albo +π — krótszy obrót od
        // kursu, z którym dron kończy poprzednie zadanie; od niego zależy, która komórka celu).
        const slotYaw = select(toPick, tPick.w, select(toDrop, tDrop.w, nest.w.mul(0.0)));
        // Wyjście z kolumny bez obrotu (obrys w obrysie kolumny), powrót do gniazda — kurs bez zmian.
        yawDes.assign(select(phase.equal(P_(P.RETURN)).or(departing), pose.w, wrapAngle(slotYaw)));
        nAux.z.assign(yawDes);
        // Nowe zadanie podczas powrotu do gniazda.
        If(phase.equal(P_(P.RETURN)).and(taskValid), () => {
          nPhase.assign(P_(P.TO_PICK));
          startLeg(tPick.x, tPick.y, tAlt.x, p.z);
        });
        // Zwolnienie zamka kolumny po wyjściu z jej obrysu w poziomie.
        If(aux.y.greaterThan(-0.5), () => {
          If(length(p.xy.sub(leg.xy)).greaterThan(rExtL.x.mul(1.2).add(1.0)), () => {
            unlockCol(uint(int(aux.y)));
            nAux.y.assign(-1.0);
          });
        });
        // Przylot do wejścia: blisko i WOLNO (tor prowadzony nie unika — nie może zaczynać się w rozpędzie).
        const slow = length(v).lessThan(vMax.mul(0.12).add(4.0));
        If(dh.lessThan(U.arrive.add(rExtL.x.mul(0.04))).and(abs(p.z.sub(tz)).lessThan(1.6)).and(slow), () => {
          If(toPick, () => { nPhase.assign(P_(P.ALIGN_PICK)); }).ElseIf(toDrop, () => { nPhase.assign(P_(P.ALIGN_DROP)); })
            .Else(() => { nPhase.assign(P_(P.LAND)); });
          nTimer.assign(0.0);
        });
      }).ElseIf(phase.equal(P_(P.ALIGN_PICK)).or(phase.equal(P_(P.ALIGN_DROP))), () => {
        const pick = phase.equal(P_(P.ALIGN_PICK));
        const A = select(pick, vec3(tPick.x, tPick.y, tAlt.x), vec3(tDrop.x, tDrop.y, tAlt.y));
        code.assign(float(SWARM_STATUS_CODE.DOCKING));
        vDes.assign(guidedVel(A, vMax.mul(0.4), vV.mul(0.5), aMax, aV));
        eArm.assign(mix(eArm, loadedF, min(dt.mul(3.0), 1.0)));
        const d = A.sub(p);
        const yawErr = abs(wrapAngle(aux.z.sub(pose.w)));
        const ok = length(d.xy).lessThan(U.alignPos).and(abs(d.z).lessThan(0.5)).and(yawErr.lessThan(U.alignYaw))
          .and(length(v).lessThan(1.5)).and(timer.greaterThan(float(SWARM_OP_TIMES.alignMin)));
        If(ok, () => {
          const col = uint(int(select(pick, tIds.z, tIds.w)));
          // Licznik kolumny = kontenery PRZED tym zadaniem (poprzednie operacje na kolumnie skończone).
          const need = select(pick, tLev.x, tLev.y);
          const h = atomicLoad(Cl.element(col.mul(uint(2)))).toVar();
          If(abs(float(h).sub(need)).lessThan(0.25), () => {
            // Własny zamek tej kolumny (odłożył tu poprzedni kontener i bierze następny — bufor na
            // placu): zamek przechodzi na nowe zadanie; inaczej czekał na siebie (zastój).
            If(abs(nAux.y.sub(float(col))).lessThan(0.25), () => {
              nAux.y.assign(-1.0);
              nPhase.assign(select(pick, P_(P.DESC_PICK), P_(P.DESC_DROP)));
              nTimer.assign(0.0);
            }).Else(() => {
              const old = atomicAdd(Cl.element(col.mul(uint(2)).add(uint(1))), uint(1)).toVar();
              If(old.equal(uint(0)), () => {
                releasePending();
                nPhase.assign(select(pick, P_(P.DESC_PICK), P_(P.DESC_DROP)));
                nTimer.assign(0.0);
              }).Else(() => {
                unlockCol(col);
                waitT.addAssign(dt);
                code.assign(float(SWARM_STATUS_CODE.WAITING));
              });
            });
          }).Else(() => {
            waitT.addAssign(dt);
            code.assign(float(SWARM_STATUS_CODE.WAITING));
          });
        });
      }).ElseIf(phase.equal(P_(P.DESC_PICK)).or(phase.equal(P_(P.DESC_DROP))), () => {
        const pick = phase.equal(P_(P.DESC_PICK));
        const T = select(pick, tPick.xyz, tDrop.xyz);
        code.assign(float(SWARM_STATUS_CODE.DOCKING));
        bayLight.assign(select(pick, tAlt.z, tAlt.w));
        vDes.assign(guidedVel(T, vMax.mul(0.3), vV, aMax, aV));
        // Ramiona rozkładają się przed dotknięciem (przy odkładaniu są już rozłożone).
        const rem = p.z.sub(T.z);
        eArm.assign(select(pick, float(1.0).sub(smoothstep(payW.mul(0.15), payW.mul(1.3), rem)), float(1.0)));
        If(abs(rem).lessThan(0.06).and(length(v).lessThan(0.8)), () => {
          nPhase.assign(select(pick, P_(P.GRIP), P_(P.RELEASE)));
          nTimer.assign(0.0);
        });
      }).ElseIf(phase.equal(P_(P.GRIP)), () => {
        code.assign(float(SWARM_STATUS_CODE.GRIP));
        bayLight.assign(tAlt.z);
        vDes.assign(guidedVel(tPick.xyz, vMax.mul(0.2), vV.mul(0.3), aMax, aV));
        eArm.assign(1.0);
        gArm.assign(clamp(timer.div(SWARM_OP_TIMES.grip), 0.0, 1.0));
        If(timer.greaterThanEqual(float(SWARM_OP_TIMES.grip)), () => {
          atomicSub(Cl.element(uint(int(tIds.z)).mul(uint(2))), uint(int(tIds.x)));
          nAux.x.assign(tIds.x);
          // Kontenery chwytu przejęte: przewoźnik = ten dron, miejsce k w chwycie.
          forPackUnits(tUA, tUB, (u, k) => {
            const ub = uint(int(u)).mul(uint(UV));
            const ui = Un.element(ub.add(uint(SWARM_UNIT.INFO)));
            Un.element(ub.add(uint(SWARM_UNIT.INFO))).assign(vec4(ui.x, 1.0, float(i), float(k)));
          });
          nPhase.assign(P_(P.ASC_PICK));
          nTimer.assign(0.0);
        });
      }).ElseIf(phase.equal(P_(P.ASC_PICK)), () => {
        code.assign(float(SWARM_STATUS_CODE.DOCKING));
        const A = vec3(tPick.x, tPick.y, tAlt.x);
        bayLight.assign(select(p.z.lessThan(0.5), tAlt.z, float(-1.0)));
        vDes.assign(guidedVel(A, vMax.mul(0.3), vV, aMax, aV));
        gArm.assign(1.0); eArm.assign(1.0);
        If(abs(p.z.sub(tAlt.x)).lessThan(0.6), () => {
          releasePending();
          nAux.y.assign(tIds.z);
          nPhase.assign(P_(P.TO_DROP));
          nTimer.assign(0.0);
          startLeg(tDrop.x, tDrop.y, tAlt.y, tCeil.x);
        });
      }).ElseIf(phase.equal(P_(P.RELEASE)), () => {
        code.assign(float(SWARM_STATUS_CODE.GRIP));
        bayLight.assign(tAlt.w);
        vDes.assign(guidedVel(tDrop.xyz, vMax.mul(0.2), vV.mul(0.3), aMax, aV));
        eArm.assign(1.0);
        gArm.assign(float(1.0).sub(clamp(timer.div(SWARM_OP_TIMES.release), 0.0, 1.0)));
        If(timer.greaterThanEqual(float(SWARM_OP_TIMES.release)), () => {
          atomicAdd(Cl.element(uint(int(tIds.w)).mul(uint(2))), uint(int(tIds.x)));
          // Kontenery stoją dokładnie w komórkach celu: punkt odłożenia + obrót kursem zadania × miejsce
          // k w chwycie (lustro: wykonawca CPU — komórka z pozy, planista — księga).
          const cD = cos(tDrop.w);
          const sD = sin(tDrop.w);
          forPackUnits(tUA, tUB, (u, k) => {
            const off = packSlotOffset(k, rFoot.z, rFoot.w);
            const ub = uint(int(u)).mul(uint(UV));
            Un.element(ub.add(uint(SWARM_UNIT.POSE))).assign(vec4(
              tDrop.x.add(off.x.mul(cD)).sub(off.y.mul(sD)), tDrop.y.add(off.x.mul(sD)).add(off.y.mul(cD)), tDrop.z.sub(tLev.z), tDrop.w));
            Un.element(ub.add(uint(SWARM_UNIT.INFO))).assign(vec4(tAlt.w, 1.0, -1.0, float(k)));
          });
          nAux.x.assign(-1.0);
          nPhase.assign(P_(P.ASC_DROP));
          nTimer.assign(0.0);
        });
      }).ElseIf(phase.equal(P_(P.ASC_DROP)), () => {
        code.assign(float(SWARM_STATUS_CODE.DOCKING));
        const A = vec3(tDrop.x, tDrop.y, tAlt.y);
        bayLight.assign(select(p.z.lessThan(0.5), tAlt.w, float(-1.0)));
        vDes.assign(guidedVel(A, vMax.mul(0.3), vV, aMax, aV));
        gArm.assign(0.0);
        eArm.assign(float(1.0).sub(smoothstep(payW.mul(0.3), payW.mul(1.6), p.z.sub(tDrop.z))));
        If(abs(p.z.sub(tAlt.y)).lessThan(0.6), () => {
          releasePending();
          nAux.y.assign(tIds.w);
          nSerial.assign(serial.add(1.0));
          nTimer.assign(0.0);
          If(nextValid, () => {
            nPhase.assign(P_(P.TO_PICK));
            const nb = tbNext;
            const np = Tq.element(nb.add(uint(TK.PICK)));
            const na = Tq.element(nb.add(uint(TK.ALT)));
            startLeg(np.x, np.y, na.x, tCeil.y);
          }).Else(() => {
            nPhase.assign(P_(P.RETURN));
            startLeg(nest.x, nest.y, nest.w, tCeil.y);
          });
        });
      }).ElseIf(phase.equal(P_(P.LAND)), () => {
        code.assign(float(SWARM_STATUS_CODE.DOCKING));
        const T = vec3(nest.x, nest.y, nest.z);
        vDes.assign(guidedVel(T, vMax.mul(0.3), vV.mul(0.7), aMax, aV));
        eArm.assign(0.0);
        If(abs(p.z.sub(nest.z)).lessThan(0.08), () => {
          nPhase.assign(select(taskValid, P_(P.LAUNCH), P_(P.PARKED)));
          nTimer.assign(0.0);
        });
      });

      // -----------------------------------------------------------------
      // Wolny lot: unikanie sąsiadów (ORCA na prostokątach, siatka) i mapy przeszkód
      // -----------------------------------------------------------------
      const floorHard = float(0.0).toVar();
      // Najbliższy sąsiad w tym samym paśmie wysokości (odległość środków w poziomie) — obrót
      // długiego kontenera przy sąsiedzie zahacza o niego, więc wtedy kurs stoi.
      const nearH = float(1e6).toVar();
      // Pion: hamowanie zbliżania do sąsiada nad / pod dronem i wyjście z nakładania w pionie.
      const dBrakeZ = float(0.0).toVar();
      const vEscZ = float(0.0).toVar();
      const vDes0 = vDes.toVar();
      const loadedNow = nAux.x.greaterThan(-0.5);
      const myRh = nbrSelf.y;
      const myLo = nbrSelf.z;
      const myHi = nbrSelf.w;
      const myW = floor(nbrSelf.x);
      const myAl = nAux.w.greaterThan(0.5);
      const dbgOrca = float(0.0).toVar();      // podgląd (U.debug): linie + 100 · tłok
      If(isFree.greaterThan(0.5), () => {
        atomicAdd(st.element(uint(SWARM_STATS.FREE)), uint(1));
        // Półpłaszczyzny ORCA: punkt (x, y), kierunek (z, w) — dozwolona lewa strona kierunku
        // (RVO2); luz linii = det(kierunek, punkt − v) (≤ −promień koła osiągalnego: linia bez znaczenia).
        const lines = array('vec4', SWARM_ORCA_LINES).toVar();
        const slack = array('float', SWARM_ORCA_LINES).toVar();
        const nLines = int(0).toVar();
        // Linie TWARDE (sąsiad prowadzony albo wyrównany nad kolumną — ustępuję w całości) na
        // początku listy [0, nHard): w tłoku linearProgram3 rozluźnia tylko miękkie (jak linie
        // przeszkód RVO2) — inaczej dron w ciasnym paśmie wjeżdżał w schodzący obok szyb.
        const nHard = int(0).toVar();
        const rReach = aMax.mul(U.orcaReach);
        const speed = length(v);
        // Zasięg: obrys + droga hamowania v² / (2 a) + ruch sąsiada w horyzoncie.
        const reach = myRh.add(48.0).add(speed.mul(speed).div(max(aMax.mul(U.brake).mul(2.0), 1.0))).add(speed.add(80.0).mul(0.5));
        const r = int(clamp(floor(reach.div(U.cell)).add(1.0), 1.0, 4.0)).toVar();
        const cx0 = int(floor(p.x.div(U.cell)));
        const cy0 = int(floor(p.y.div(U.cell)));
        const myC = p.z.add(myLo.add(myHi).mul(0.5));
        const myHh = myHi.sub(myLo).mul(0.5);
        // Mapa przeszkód (przed sąsiadami): ile miejsca pod dronem — wyjście w dół tylko z zapasem.
        const fx = select(loadedNow, rPay.x.mul(0.5), rFoot.x).mul(0.8);
        const fy = select(loadedNow, rPay.y.mul(0.5), rFoot.y).mul(0.8);
        const lx = p.x.add(v.x.mul(U.look));
        const ly = p.y.add(v.y.mul(U.look));
        const topHere = max(max(hfAt(p.x, p.y), hfAt(p.x.add(fx), p.y.add(fy))), max(hfAt(p.x.sub(fx), p.y.sub(fy)), max(hfAt(p.x.add(fx), p.y.sub(fy)), hfAt(p.x.sub(fx), p.y.add(fy))))).toVar();
        const topAhead = max(max(hfAt(lx, ly), hfAt(lx.add(fx), ly.add(fy))), max(hfAt(lx.sub(fx), ly.sub(fy)), max(hfAt(lx.add(fx), ly.sub(fy)), hfAt(lx.sub(fx), ly.add(fy))))).toVar();
        const floorRoom = p.z.add(myLo).sub(max(topHere, topAhead).add(U.clear)).toVar();
        // Mój obrys z góry: z ładunkiem — kontener, bez — kadłub ze złożonymi ramionami.
        const hxi = select(myLo.lessThan(0.0), rPay.x.mul(0.5).add(0.3), rFoot.x);
        const hyi = select(myLo.lessThan(0.0), rPay.y.mul(0.5).add(0.3), rFoot.y);
        const ui = vec2(cos(pose.w), sin(pose.w));
        const vi = vec2(ui.y.negate(), ui.x);
        Loop({ start: r.negate(), end: r, type: 'int', condition: '<=', name: 'gy' }, ({ gy }) => {
          Loop({ start: r.negate(), end: r, type: 'int', condition: '<=', name: 'gx' }, ({ gx }) => {
            const h = this._cellHash(cx0.add(gx), cy0.add(gy));
            // .toVar(): wartość atomicLoad użyta tylko jako koniec pętli Loop nie liczy się w three
            // jako użycie — bez zmiennej WGSL dostaje pustą instrukcję i pętla ma 0 obiegów.
            const n = min(atomicLoad(cnt.element(h)), uint(SWARM_GRID_K)).toVar();
            Loop({ start: uint(0), end: n, type: 'uint', condition: '<', name: 'gk' }, ({ gk }) => {
              const j = items.element(h.mul(uint(SWARM_GRID_K)).add(gk));
              If(j.equal(i), () => { Continue(); });
              const jb = j.mul(uint(DV));
              const pj = D.element(jb.add(uint(DR.POSE)));
              const vj = D.element(jb.add(uint(DR.VEL)));
              const nb = D.element(jb.add(uint(DR.NBR)));
              const dxy0 = pj.xy.sub(p.xy).toVar();
              // Ruch sąsiada względem mnie — z RZECZYWISTYCH prędkości (bezwładność).
              const vrel = vj.xyz.sub(v).toVar();
              // Wyrównany nad własną kolumną (wyjście / zejście / tor prowadzony): ułamek 0,25 wagi.
              const nbAl = fract(nb.x).greaterThan(0.2);
              const nbGuided = nb.x.greaterThan(5000.0);
              const bothAl = myAl.and(nbAl);
              // Obaj wyrównani (sąsiednie kolumny): zapas do szczeliny modułów.
              const mH = select(bothAl, float(0.1), U.margin);
              const R = myRh.add(nb.y).add(mH);
              const lim = R.add(length(vrel.xy).mul(U.orcaTau)).add(4.0);
              If(dot(dxy0, dxy0).greaterThan(lim.mul(lim)), () => { Continue(); });
              const cj = pj.z.add(nb.z.add(nb.w).mul(0.5));
              const hj = nb.w.sub(nb.z).mul(0.5);
              const dz0 = cj.sub(myC).toVar();
              const Hs = myHh.add(hj).add(U.marginZ);
              // Udział w unikaniu: sąsiad prowadzony albo wyrównany (gdy ja nie) — całość; ja
              // wyrównany, sąsiad wolny — w poziomie nic (on ustępuje), w pionie hamuję sam; obaj
              // wyrównani — po połowie; obaj wolni — wg wag (cięższe klasy i ładunek ustępują mniej).
              const nbW = floor(nb.x);
              const shareW = nbW.div(max(nbW.add(myW), 1e-3));
              const shareH = select(nbGuided, float(1.0), select(bothAl, float(0.5), select(nbAl, float(1.0), select(myAl, float(0.0), shareW))));
              const shareV = select(nbGuided, float(1.0), select(bothAl, float(0.5), select(nbAl.or(myAl), float(1.0), shareW)));
              // --- Prostokąty obrysów z kursem (SAT na 4 osiach).
              const clj = int(D.element(jb.add(uint(DR.INFO))).x);
              const cbj = clj.mul(SWARM_CLASS_ROWS);
              const ldj = nb.z.lessThan(0.0);
              const rPayJ = CT.element(cbj.add(CR.PAYLOAD));
              const rFootJ = CT.element(cbj.add(CR.FOOT_EMPTY));
              const hxj = select(ldj, rPayJ.x.mul(0.5).add(0.3), rFootJ.x);
              const hyj = select(ldj, rPayJ.y.mul(0.5).add(0.3), rFootJ.y);
              const uj = vec2(cos(pj.w), sin(pj.w));
              const vjA = vec2(uj.y.negate(), uj.x);
              const cUU = abs(dot(uj, ui));
              const cUV = abs(dot(vjA, ui));
              const cVU = abs(dot(uj, vi));
              const cVV = abs(dot(vjA, vi));
              const pI0 = abs(dot(dxy0, ui));
              const pI1 = abs(dot(dxy0, vi));
              const pJ0 = abs(dot(dxy0, uj));
              const pJ1 = abs(dot(dxy0, vjA));
              const gxy0 = max(max(pI0.sub(hxi.add(hxj.mul(cUU)).add(hyj.mul(cUV))), pI1.sub(hyi.add(hxj.mul(cVU)).add(hyj.mul(cVV)))),
                max(pJ0.sub(hxj.add(hxi.mul(cUU)).add(hyi.mul(cVU))), pJ1.sub(hyj.add(hxi.mul(cUV)).add(hyi.mul(cVV))))).toVar();
              const gz0 = abs(dz0).sub(myHh.add(hj)).toVar();
              If(gz0.lessThan(U.marginZ), () => { nearH.assign(min(nearH, length(dxy0).sub(hxj))); });
              // Statystyka (raz na parę): prawdziwa przerwa teraz, zderzenia, najbliższa para.
              If(j.greaterThan(i), () => {
                const gap = max(gxy0, gz0);
                const q = uint(clamp(gap.add(100.0).mul(100.0), 0.0, 60000.0));
                atomicMin(st.element(uint(SWARM_STATS.MIN_GAP)), q);
                If(gap.lessThan(0.0), () => { atomicAdd(st.element(uint(SWARM_STATS.COLLISIONS)), uint(1)); });
                If(gap.lessThan(U.margin), () => { atomicAdd(st.element(uint(SWARM_STATS.NEAR)), uint(1)); });
                const qs = q.shiftLeft(uint(16));
                const phj = uint(int(D.element(jb.add(uint(DR.CTL))).x));
                atomicMin(st.element(uint(SWARM_STATS.MIN_PAIR)), qs.bitOr(uint(phase).shiftLeft(uint(8))).bitOr(phj));
                const ldiU = select(myLo.lessThan(0.0), uint(1), uint(0));
                const ldjU = select(ldj, uint(1), uint(0));
                atomicMin(st.element(uint(SWARM_STATS.MIN_PAIR_KIND)), qs.bitOr(ldiU.shiftLeft(uint(9))).bitOr(ldjU.shiftLeft(uint(8)))
                  .bitOr(uint(int(info.x)).shiftLeft(uint(4))).bitOr(uint(clj)));
              });
              // Unikanie wyłączone (porównanie w demie): tylko statystyka.
              If(U.avoidOn.lessThan(0.5), () => { Continue(); });
              // --- Pion: przedział czasu nakładania pasów wysokości (z zapasem).
              const vz = vrel.z;
              const movingV = abs(vz).greaterThan(1e-3);
              const ta = Hs.negate().sub(dz0).div(select(movingV, vz, float(1.0)));
              const tb = Hs.sub(dz0).div(select(movingV, vz, float(1.0)));
              const t3 = select(movingV, min(ta, tb), select(abs(dz0).lessThan(Hs), float(-1e6), float(1e6)));
              const t4 = select(movingV, max(ta, tb), select(abs(dz0).lessThan(Hs), float(1e6), float(-1e6)));
              const vSoon = t3.lessThan(U.orcaTau).and(t4.greaterThan(0.0));
              // --- Obrysy z zapasem (połowa zapasu na każdy) — SAT i oś najmniejszego nakładania.
              const mh = mH.mul(0.5);
              const ax = hxi.add(mh);
              const ay = hyi.add(mh);
              const bx = hxj.add(mh);
              const by = hyj.add(mh);
              const g0 = pI0.sub(ax.add(bx.mul(cUU)).add(by.mul(cUV)));
              const g1 = pI1.sub(ay.add(bx.mul(cVU)).add(by.mul(cVV)));
              const g2 = pJ0.sub(bx.add(ax.mul(cUU)).add(ay.mul(cVU)));
              const g3 = pJ1.sub(by.add(ax.mul(cUV)).add(ay.mul(cVV)));
              const gI = max(max(g0, g1), max(g2, g3)).toVar();
              const dirZ = select(dz0.greaterThan(0.0), float(1.0), float(-1.0));
              // Poziom w ruchu: przedział czasu nakładania obrysów z zapasem przy stałych prędkościach
              // (SAT na 4 osiach: |c·a − (rv·a) t| < Ra, przecięcie przedziałów).
              const rvH = v.xy.sub(vj.xy).toVar();
              const th1 = float(-1e6).toVar();
              const th2 = float(1e6).toVar();
              const axisIv = (axis, Ra) => {
                const p0 = dot(dxy0, axis);
                const w = dot(rvH, axis);
                const still = abs(w).lessThan(1e-4);
                const wS = select(still, float(1.0), w);
                const tA = p0.sub(Ra).div(wS);
                const tB = p0.add(Ra).div(wS);
                const inside = abs(p0).lessThan(Ra);
                th1.assign(max(th1, select(still, select(inside, float(-1e6), float(1e6)), min(tA, tB))));
                th2.assign(min(th2, select(still, select(inside, float(1e6), float(-1e6)), max(tA, tB))));
              };
              axisIv(ui, ax.add(bx.mul(cUU)).add(by.mul(cUV)));
              axisIv(vi, ay.add(bx.mul(cVU)).add(by.mul(cVV)));
              axisIv(uj, bx.add(ax.mul(cUU)).add(ay.mul(cVU)));
              axisIv(vjA, by.add(ax.mul(cUV)).add(ay.mul(cVV)));
              const hSoon = th1.lessThan(th2).and(th1.lessThan(U.orcaTau)).and(th2.greaterThan(0.0));
              // Pion: obrysy nakładają się w poziomie teraz albo w horyzoncie — zbliżanie pasów
              // ≤ √(2 a · przerwa); hamuje ten, kto się zbliża (udział z własnego ruchu w pionie —
              // dron lecący poziomo w swoim paśmie nie zmienia wysokości przez przelatującego pod nim).
              If(hSoon, () => {
                const myCl = max(vDes0.z.mul(dirZ), 0.0);
                const nbCl = max(vj.z.mul(dirZ).negate(), 0.0);
                // Wyrównany nad kolumną (wychodzi / schodzi) ma pierwszeństwo w pionie przed wolnym
                // sąsiadem (ten omija go w poziomie — ORCA z udziałem 1); hamuje dopiero nad samym sobą.
                const yieldNot = myAl.and(nbAl.not()).and(gI.greaterThanEqual(0.0));
                const shareC = select(nbGuided, float(1.0), select(yieldNot, float(0.0), myCl.div(max(myCl.add(nbCl), 1e-3))));
                const closingZ = vDes0.z.sub(vj.z).mul(dirZ);
                const allowedZ = sqrt(max(gz0.sub(U.marginZ), 0.0).mul(aV).mul(U.brake).mul(2.0));
                If(closingZ.greaterThan(allowedZ), () => { dBrakeZ.addAssign(dirZ.mul(closingZ.sub(allowedZ)).mul(shareC)); });
              });
              // Nakładanie w poziomie i w pionie (z zapasem): wyjście krótszą drogą — w pionie, gdy
              // płycej (i w dół jest miejsce nad przeszkodami), inaczej w poziomie (linia kolizji).
              const depthV = U.marginZ.sub(gz0);
              const overlapV = depthV.greaterThan(0.0);
              const downOk = dz0.lessThanEqual(0.0).or(floorRoom.greaterThan(depthV.add(1.0)));
              const escV = gI.lessThan(0.0).and(overlapV).and(depthV.mul(U.vertPref).lessThan(gI.negate())).and(downOk);
              If(escV, () => { vEscZ.subAssign(dirZ.mul(depthV.div(U.orcaEsc)).mul(shareV)); });
              // --- Linia ORCA (poziom): pasy wysokości nakładają się teraz albo w horyzoncie.
              // Obrysy nachodzą na siebie w poziomie, a pasy dopiero się zbliżają: linia wyjścia w poziomie
              // także teraz (bez niej dron wlatywał nad kolumnę, z której wznosił się sąsiad).
              If(vSoon.and(shareH.greaterThan(0.0)).and(escV.not()), () => {
                const rv = v.xy.sub(vj.xy).toVar();
                const line = vec4(0.0).toVar();
                If(gI.lessThan(0.0), () => {
                  // W obrysach z zapasem (w poziomie): wyjście wzdłuż osi najmniejszego nakładania w orcaEsc.
                  const eA = select(g0.greaterThanEqual(max(max(g1, g2), g3)), ui,
                    select(g1.greaterThanEqual(max(g2, g3)), vi, select(g2.greaterThanEqual(g3), uj, vjA)));
                  const nOut = eA.mul(select(dot(dxy0, eA).greaterThan(0.0), float(-1.0), float(1.0)));
                  const k = max(gI.negate().div(U.orcaEsc).sub(dot(rv, nOut)), 0.0);
                  line.assign(vec4(v.xy.add(nOut.mul(k.mul(shareH))), nOut.y, nOut.x.negate()));
                }).Else(() => {
                  // Przeszkoda prędkości prostokątów: suma Minkowskiego M wokół dxy0, styczne
                  // z początku przez wierzchołki podparcia (4 kroki), odcięcie horyzontem τ łamaną
                  // przez wierzchołek M najbliższy początkowi.
                  const supp = (nx, ny) => dxy0
                    .add(ui.mul(ax.mul(sign(nx.mul(ui.x).add(ny.mul(ui.y))))))
                    .add(vi.mul(ay.mul(sign(nx.mul(vi.x).add(ny.mul(vi.y))))))
                    .add(uj.mul(bx.mul(sign(nx.mul(uj.x).add(ny.mul(uj.y))))))
                    .add(vjA.mul(by.mul(sign(nx.mul(vjA.x).add(ny.mul(vjA.y))))));
                  const qL = dxy0.toVar();
                  const qR = dxy0.toVar();
                  for (let it = 0; it < 4; it++) {
                    qL.assign(supp(qL.y.negate(), qL.x));
                    qR.assign(supp(qR.y, qR.x.negate()));
                  }
                  // Odcięcie stałym τ (nie końcem nakładania pasów t4: tempo wznoszenia zmienia
                  // hamowanie w pionie i profil — przy t4 dron doganiający sąsiada hamował za późno).
                  const invT = float(1.0).div(U.orcaTau);
                  const aL = qL.mul(invT).toVar();
                  const aR = qR.mul(invT).toVar();
                  const aN = supp(dxy0.x.negate(), dxy0.y.negate()).mul(invT).toVar();
                  const dL = normalize(qL).toVar();
                  const dR = normalize(qR).toVar();
                  const best = vec2(0.0).toVar();
                  const bestD = float(1e9).toVar();
                  const bestN = vec2(0.0).toVar();
                  const tryPt = (pt, nrm) => {
                    const pv = pt.toVar();
                    const d = length(rv.sub(pv));
                    If(d.lessThan(bestD), () => { bestD.assign(d); best.assign(pv); bestN.assign(nrm); });
                  };
                  tryPt(dL.mul(max(dot(rv, dL), length(aL))), vec2(dL.y.negate(), dL.x));
                  tryPt(dR.mul(max(dot(rv, dR), length(aR))), vec2(dR.y, dR.x.negate()));
                  const seg = (a, b) => {
                    const e = b.sub(a).toVar();
                    const ee = dot(e, e);
                    If(ee.greaterThan(1e-8), () => {
                      const t = clamp(dot(rv.sub(a), e).div(ee), 0.0, 1.0);
                      tryPt(a.add(e.mul(t)), vec2(e.y.negate(), e.x).div(sqrt(ee)));
                    });
                  };
                  seg(aR, aN);
                  seg(aN, aL);
                  const inside = det2(dR, rv).greaterThanEqual(0.0).and(det2(rv, dL).greaterThanEqual(0.0))
                    .and(det2(aN.sub(aR), rv.sub(aR)).lessThanEqual(0.0)).and(det2(aL.sub(aN), rv.sub(aN)).lessThanEqual(0.0));
                  const nO = select(inside.or(bestD.lessThan(1e-4)), bestN, rv.sub(best).div(max(bestD, 1e-4)));
                  line.assign(vec4(v.xy.add(best.sub(rv).mul(shareH)), nO.y, nO.x.negate()));
                });
                // Lista: linie bez znaczenia (całe koło osiągalnych prędkości po dobrej stronie)
                // pomijane; twarde przed miękkimi; przy pełnej — zastępuje najmniej wiążącą miękką.
                const sl = det2(line.zw, line.xy.sub(v.xy));
                const leastSoft = (from) => {
                  const w = int(-1).toVar();
                  const wS = float(1e9).toVar();
                  Loop({ start: from, end: int(SWARM_ORCA_LINES), type: 'int', condition: '<', name: 'oq' }, ({ oq }) => {
                    If(slack.element(oq).lessThan(wS), () => { wS.assign(slack.element(oq)); w.assign(oq); });
                  });
                  return { w, wS };
                };
                If(sl.greaterThan(rReach.negate()), () => {
                  If(shareH.greaterThan(0.999), () => {
                    If(nLines.lessThan(int(SWARM_ORCA_LINES)), () => {
                      If(nHard.lessThan(nLines), () => {
                        lines.element(nLines).assign(lines.element(nHard));
                        slack.element(nLines).assign(slack.element(nHard));
                      });
                      lines.element(nHard).assign(line);
                      slack.element(nHard).assign(sl);
                      nHard.addAssign(1);
                      nLines.addAssign(1);
                    }).ElseIf(nHard.lessThan(int(SWARM_ORCA_LINES)), () => {
                      const q = leastSoft(nHard);
                      lines.element(q.w).assign(lines.element(nHard));
                      slack.element(q.w).assign(slack.element(nHard));
                      lines.element(nHard).assign(line);
                      slack.element(nHard).assign(sl);
                      nHard.addAssign(1);
                    }).Else(() => {
                      const q = leastSoft(int(0));
                      If(sl.greaterThan(q.wS), () => { lines.element(q.w).assign(line); slack.element(q.w).assign(sl); });
                    });
                  }).Else(() => {
                    If(nLines.lessThan(int(SWARM_ORCA_LINES)), () => {
                      lines.element(nLines).assign(line);
                      slack.element(nLines).assign(sl);
                      nLines.addAssign(1);
                    }).ElseIf(nHard.lessThan(int(SWARM_ORCA_LINES)), () => {
                      const q = leastSoft(nHard);
                      If(sl.greaterThan(q.wS), () => { lines.element(q.w).assign(line); slack.element(q.w).assign(sl); });
                    });
                  });
                });
              });
            });
          });
        });
        // Program liniowy 2D (RVO2 linearProgram2, w tłoku linearProgram3) w układzie bieżącej
        // prędkości: koło prędkości osiągalnych w orcaReach s — wybrana prędkość jest do zrobienia
        // przy przyspieszeniu klasy, a w tłoku to najmniejsze naruszenie w zasięgu napędu.
        atomicAdd(st.element(uint(SWARM_STATS.LINES)), uint(nLines));
        Loop({ start: int(0), end: nLines, type: 'int', condition: '<', name: 'os' }, ({ os }) => {
          const Lk = lines.element(os);
          lines.element(os).assign(vec4(Lk.xy.sub(v.xy), Lk.zw));
        });
        const res = vec2(0.0).toVar();
        const opt = vDes0.xy.sub(v.xy).toVar();
        const fail = orcaLp2(lines, nLines, rReach, opt, false, res, 'a');
        dbgOrca.assign(float(nLines).add(select(fail.lessThan(nLines), float(100.0), float(0.0))));
        If(fail.lessThan(nLines), () => {
          atomicAdd(st.element(uint(SWARM_STATS.DENSE)), uint(1));
          const proj = array('vec4', SWARM_ORCA_LINES).toVar();
          // Twarde wzajemnie sprzeczne (dron między dwoma z pierwszeństwem): wszystkie miękkie —
          // inaczej linearProgram3 nic nie zmieniał i zostawała prędkość z połowy programu.
          const probe = vec2(0.0).toVar();
          const hardFail = orcaLp2(lines, nHard, rReach, opt, false, probe, 'h');
          const nH = select(hardFail.lessThan(nHard), int(0), nHard);
          orcaLp3(lines, proj, nLines, nH, fail, rReach, res);
        });
        const vh = res.add(v.xy).toVar();
        const vhl = length(vh);
        vh.assign(select(vhl.greaterThan(vMax), vh.mul(vMax.div(max(vhl, 1e-4))), vh));
        vDes.x.assign(vh.x);
        vDes.y.assign(vh.y);
        vDes.z.assign(vDes0.z.sub(dBrakeZ).add(vEscZ));
        // Mapa przeszkód: dół drona (z ładunkiem — dół kontenera) nad wierzchem przeszkód.
        const bottom = p.z.add(myLo);
        const need = max(topHere, topAhead).add(U.clear);
        If(bottom.lessThan(need), () => {
          // Przeszkoda dopiero przed dronem, a wznoszenie hamuje sąsiad nad nim: stój (nie wlatuj
          // nad przeszkodę, którą trzeba by przeskoczyć w sąsiada) — inaczej wspinaczka nad nią.
          If(dBrakeZ.greaterThan(0.5).and(bottom.greaterThanEqual(topHere.add(U.clear))), () => {
            vDes.x.assign(0.0);
            vDes.y.assign(0.0);
          }).Else(() => {
            vDes.z.assign(max(vDes.z, need.sub(bottom).mul(2.5).add(4.0)));
            If(bottom.lessThan(topAhead.add(U.clear)), () => {
              vDes.x.mulAssign(0.25);
              vDes.y.mulAssign(0.25);
            });
          });
          floorHard.assign(1.0);
        });
      }).Else(() => {
        atomicAdd(st.element(uint(SWARM_STATS.GUIDED)), uint(1));
      });

      // -----------------------------------------------------------------
      // Sterowanie: śledzenie prędkości zadanej + unikanie, ograniczenia klasy
      // -----------------------------------------------------------------
      // Wolny lot: szybkie śledzenie (kVfree) — prędkość z ORCA osiągana przy przyspieszeniu klasy
      // (koło prędkości osiągalnych w programie liniowym); tor prowadzony: łagodniej, z zapasem 1,6 a.
      const kG = select(guided.greaterThan(0.5), float(1.6), float(1.0));
      const acc = vDes.sub(v).mul(select(guided.greaterThan(0.5), U.kV.mul(kG), U.kVfree)).toVar();
      const ah = length(acc.xy);
      const ahMax = aMax.mul(kG);
      acc.x.assign(select(ah.greaterThan(ahMax), acc.x.mul(ahMax.div(max(ah, 1e-4))), acc.x));
      acc.y.assign(select(ah.greaterThan(ahMax), acc.y.mul(ahMax.div(max(ah, 1e-4))), acc.y));
      acc.z.assign(clamp(acc.z, aV.mul(kG).negate(), aV.mul(kG)));
      const vNew = v.add(acc.mul(dt)).toVar();
      const sh = length(vNew.xy);
      const shMax = vMax.mul(1.15);
      vNew.x.assign(select(sh.greaterThan(shMax), vNew.x.mul(shMax.div(max(sh, 1e-4))), vNew.x));
      vNew.y.assign(select(sh.greaterThan(shMax), vNew.y.mul(shMax.div(max(sh, 1e-4))), vNew.y));
      vNew.z.assign(clamp(vNew.z, vV.mul(1.25).negate(), vV.mul(1.25)));
      // Twarda podłoga: pod wierzchem przeszkód wolny lot nigdy nie schodzi niżej (unik ani profil).
      If(floorHard.greaterThan(0.5), () => { vNew.z.assign(max(vNew.z, 0.0)); });
      // Prowadzony w gnieździe: bez dryfu.
      If(phase.equal(P_(P.PARKED)), () => { vNew.assign(vec3(0.0)); });

      // Kurs: za prędkością w wolnym locie daleko od celu, inaczej kurs zadany (slot).
      // Kurs: zawsze kurs slotu celu (dron to platforma z RCS — leci bokiem bez obrotu; siatki portu
      // są zwykle równoległe, więc obrót jest rzadki). Obrót tylko w wolnym locie, ponad pasmem
      // wyjścia i gdy nikt w paśmie wysokości nie stoi w promieniu zamachu obrysu (pół przekątnej
      // kontenera + zapas) — obracający się długi kontener zahaczał o sąsiada.
      const mySweep = select(loadedNow, length(rPay.xy).mul(0.5).add(1.5), length(rFoot.xy).add(1.5));
      const yawHold = isFree.greaterThan(0.5).and(nearH.lessThan(mySweep).or(freeYaw.lessThan(0.5)));
      const yawTarget = select(yawHold, pose.w, yawDes);
      const yErr = wrapAngle(yawTarget.sub(pose.w));
      const yawRateDes = clamp(yErr.mul(2.6), rYaw.x.negate(), rYaw.x);
      const yawRate = vel.w.add(clamp(yawRateDes.sub(vel.w), rYaw.y.mul(dt).negate(), rYaw.y.mul(dt)));

      // Zapis.
      D.element(base.add(uint(DR.VNEW))).assign(vec4(vNew, select(phase.equal(P_(P.PARKED)), float(0.0), yawRate)));
      D.element(base.add(uint(DR.CTL))).assign(vec4(float(nPhase), nTimer, nSerial, nLayer));
      const thrust = clamp(length(acc).div(max(aMax, 1e-3)).mul(0.75).add(sh.div(max(vMax, 1e-3)).mul(0.3)), 0.0, 1.0);
      D.element(base.add(uint(DR.LOOK))).assign(vec4(clamp(eArm, 0.0, 1.0), clamp(gArm, 0.0, 1.0), thrust, code));
      // Podgląd ORCA (U.debug = 1, narzędzia): w MOTION zamiast przyspieszenia — prędkość zamierzona xy i linie.
      D.element(base.add(uint(DR.MOTION))).assign(select(U.debug.greaterThan(1.5), vec4(vDes0.z, dBrakeZ, vEscZ, vDes.z),
        select(U.debug.greaterThan(0.5), vec4(vDes0.x, vDes0.y, dbgOrca, waitT), vec4(acc, waitT))));
      D.element(base.add(uint(DR.INFO))).assign(vec4(info.x, info.y, bayLight, info.w));
      D.element(base.add(uint(DR.LEG))).assign(nLeg);
      D.element(base.add(uint(DR.AUX))).assign(nAux);
      If(code.equal(float(SWARM_STATUS_CODE.WAITING)), () => { atomicAdd(st.element(uint(SWARM_STATS.WAITING)), uint(1)); });
      If(nPhase.notEqual(P_(P.PARKED)), () => { atomicAdd(st.element(uint(SWARM_STATS.ACTIVE)), uint(1)); });
    })().compute(this.maxDrones).setName('swarmSteer');
  }

  _buildIntegrate() {
    const U = this.U;
    const D = this.drones;
    const Tq = this.tasks;
    const Un = this.units;
    const S = this.status;
    const CT = this.classTable;
    return Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(U.nDrones), () => { Return(); });
      const dt = U.dt;
      const base = i.mul(uint(DV));
      const pose = D.element(base.add(uint(DR.POSE)));
      const vn = D.element(base.add(uint(DR.VNEW)));
      const ctl = D.element(base.add(uint(DR.CTL)));
      const info = D.element(base.add(uint(DR.INFO)));
      const aux = D.element(base.add(uint(DR.AUX)));
      const motion = D.element(base.add(uint(DR.MOTION)));
      const cb = int(info.x).mul(SWARM_CLASS_ROWS);
      const rExtE = CT.element(cb.add(CR.EXT_EMPTY));
      const rExtL = CT.element(cb.add(CR.EXT_LOADED));
      const rParts = CT.element(cb.add(CR.PARTS));
      const rPay = CT.element(cb.add(CR.PAYLOAD));
      const p = pose.xyz.add(vn.xyz.mul(dt)).toVar();
      const yaw = wrapAngle(pose.w.add(vn.w.mul(dt))).toVar();
      D.element(base.add(uint(DR.POSE))).assign(vec4(p, yaw));
      D.element(base.add(uint(DR.VEL))).assign(vn);
      const phase = int(ctl.x);
      const loaded = aux.x.greaterThan(-0.5);
      // Faza prowadzona = pierwszeństwo bezwzględne (inni ustępują w całości).
      const guided = phase.equal(int(P.LAUNCH)).or(phase.equal(int(P.LAND))).or(phase.equal(int(P.PARKED)))
        .or(phase.greaterThanEqual(int(P.ALIGN_PICK)).and(phase.lessThanEqual(int(P.ASC_PICK))))
        .or(phase.greaterThanEqual(int(P.ALIGN_DROP)).and(phase.lessThanEqual(int(P.ASC_DROP))));
      // Wagi całkowite (powrót = pół zwykłej, ładunek = podwójna), ułamek 0,25 = „wyrównany nad
      // własną kolumną” (tor prowadzony, zejście, wyjście) — waga 0,5 dawnego powrotu S udawała flagę.
      const w0 = select(guided, float(10000.0), rParts.w.mul(select(loaded, float(4.0), float(2.0))).mul(select(phase.equal(int(P.RETURN)), float(0.5), float(1.0))));
      const w = w0.add(select(guided.or(aux.w.greaterThan(0.5)), float(0.25), float(0.0)));
      const ext = select(loaded, rExtL.xyz, rExtE.xyz);
      D.element(base.add(uint(DR.NBR))).assign(vec4(w, ext.x, ext.y, ext.z));
      // Niesione kontenery jadą pod hakiem — każdy w swoim miejscu chwytu (warstwa płasko).
      If(loaded, () => {
        const ser = int(ctl.z);
        const tb = i.mul(uint(SWARM_TASK_RING)).add(uint(ser.bitAnd(int(1)))).mul(uint(TV));
        const tUA = Tq.element(tb.add(uint(TK.UNITS_A))).toVar();
        const tUB = Tq.element(tb.add(uint(TK.UNITS_B))).toVar();
        const c = cos(yaw);
        const sn = sin(yaw);
        const rFoot = CT.element(cb.add(CR.FOOT_EMPTY));
        forPackUnits(tUA, tUB, (u, k) => {
          const off = packSlotOffset(k, rFoot.z, rFoot.w);
          const ub = uint(int(u)).mul(uint(UV));
          Un.element(ub.add(uint(SWARM_UNIT.POSE))).assign(vec4(p.x.add(off.x.mul(c)).sub(off.y.mul(sn)), p.y.add(off.x.mul(sn)).add(off.y.mul(c)), p.z.sub(rPay.z), yaw));
          Un.element(ub.add(uint(SWARM_UNIT.INFO))).assign(vec4(info.z, 1.0, float(i), float(k)));
        });
      });
      S.element(i).assign(vec4(ctl.x, ctl.z, aux.x, motion.w));
    })().compute(this.maxDrones).setName('swarmIntegrate');
  }
}
