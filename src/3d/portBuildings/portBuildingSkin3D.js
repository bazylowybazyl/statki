// Skóra CIAŁA ŚWIATA z brył budowli Z7 (PortBuilding3D — suchy dok piratów; docs/PLAN-zniszczenia-swiata-3d.md § 6):
// instancje grupy kawałka (zestawy bg / fg — dach w fg, wszystkie rodzaje brył, także lampy) wypieczone do układu CIAŁA —
// środek rastra ciała = 0, x — oś budowli, y — −z układu (obraz ciała w górę), z — wysokość świata — z atrybutami
// wariantu „skin” grafu budowli (portBuildings3D.tsl.js): aPbA (położenie w bryle — płyty, materiał), aPbN (normalna
// bryły — oś płyt), aPbFx (efekt), aLat / aOwn (kratownica ciała: położenie w komórkach i najbliższa komórka
// pierwotnej konstrukcji). Trójkąty dzielone wzdłuż najdłuższej krawędzi W RZUCIE (x, y), aż ≤ maxEdge komórek —
// FFD ugina bryłę po węzłach w płaszczyźnie, wysokość podziału nie potrzebuje (ściana 300 j. wysoka, 700 j. długa
// to ~50 trójkątów, nie 1000). Wierzchołek poza kratownicą (bryły pod i nad płaszczyzną gry wystające poza raster
// ciała — szpony, rękawy) jedzie za NAJBLIŻSZĄ komórką konstrukcji (mapa odległości po siatce), nie znika.
//
// Rdzeń wypieku (bez three) — portBuildingSkinBake.js; w grze liczy go WORKER (requestBuildingSkinBake,
// portBuildingSkinWorker.js — 2026-10-15: wypiek kawałka w klatce gry trwał 40–210 ms), w wątku głównym tylko zapas
// (bez workerów) i testy (bakeBuildingChunkSkin / bakeBuildingChunkSkinSteps — te same geometrie).
import * as THREE from 'three/webgpu';
import { PB_STRIDE } from './portBuildingScene.js';
import { SKIN_KINDS, SKIN_INTER_STRIDE, skinBakeParts, bakeSkinCoreSteps } from './portBuildingSkinBake.js';

let _bases = null;
let _baseArrays = null;

// Te same bryły bazowe co instancje budowli (portBuildings3D.baseGeometries), bez indeksu.
function bases() {
  if (_bases) return _bases;
  const ni = (g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    return n;
  };
  _bases = {
    box: ni(new THREE.BoxGeometry(1, 1, 1)),
    cyl: ni(new THREE.CylinderGeometry(1, 1, 1, 16, 1, false)),
    torus: ni(new THREE.TorusGeometry(1, 0.13, 6, 24)),
    cone: ni(new THREE.ConeGeometry(1, 1, 8, 1))
  };
  return _bases;
}

// Atrybut xyz jako płaska Float32Array (to samo, co czyta getX / getY / getZ).
function xyzArray(attr) {
  if (!attr.isInterleavedBufferAttribute && attr.itemSize === 3 && !attr.normalized && attr.array instanceof Float32Array &&
    attr.array.length === attr.count * 3) return attr.array;
  const a = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) { a[i * 3] = attr.getX(i); a[i * 3 + 1] = attr.getY(i); a[i * 3 + 2] = attr.getZ(i); }
  return a;
}

/** Bryły bazowe dla rdzenia wypieku: { box|cyl|torus|cone: { pos, nor, count } }. */
export function skinBakeBases() {
  if (_baseArrays) return _baseArrays;
  const B = bases();
  const out = {};
  for (const kind of SKIN_KINDS) {
    const g = B[kind];
    out[kind] = { pos: xyzArray(g.attributes.position), nor: xyzArray(g.attributes.normal), count: g.attributes.position.count };
  }
  _baseArrays = out;
  return out;
}

/**
 * Wejście rdzenia wypieku dla grupy kawałka budowli (portBuildingSkinBake.bakeSkinCoreSteps) albo null (budowla bez
 * zestawów brył albo bez kratownicy). building — PortBuilding3D (scene.sets), group — numer grupy kawałka, cx / cz —
 * środek rastra ciała w układzie budowli, lattice — hullSkinLattice(konstrukcja, anchorDX, anchorDY) (cs, dims, occ, ax,
 * ay[, az]).
 */
export function buildingSkinBakeInput(building, group, { cx, cz, lattice, maxEdgeCells = 2 }) {
  const sets = building?.scene?.sets;
  if (!sets || !lattice) return null;
  return { bases: skinBakeBases(), parts: skinBakeParts(sets, group, PB_STRIDE), stride: PB_STRIDE, cx, cz, lattice, maxEdgeCells };
}

/** Geometrie three z wyniku rdzenia: { bg, fg, triangles } (BufferGeometry ze sferą ograniczającą z wypieku). */
export function buildingSkinGeometries(res) {
  const out = { bg: null, fg: null, triangles: res ? res.triangles : 0 };
  if (!res) return out;
  for (const set of ['bg', 'fg']) {
    const r = res[set];
    if (!r) continue;
    const geo = new THREE.BufferGeometry();
    // z indeksem: wierzchołki puli wspólne dla trójkątów podziału (portBuildingSkinBake.js); odłamy rysują podzbiór
    // trójkątów własnym indeksem na tych samych atrybutach (worldBodies3D.fragmentSkinSubset)
    geo.setIndex(new THREE.BufferAttribute(r.index, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
    const ib = new THREE.InterleavedBuffer(r.inter, SKIN_INTER_STRIDE);
    geo.setAttribute('aPbA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    geo.setAttribute('aPbN', new THREE.InterleavedBufferAttribute(ib, 4, 4));
    geo.setAttribute('aPbFx', new THREE.InterleavedBufferAttribute(ib, 4, 8));
    geo.setAttribute('aLat', new THREE.InterleavedBufferAttribute(ib, 3, 12));
    geo.setAttribute('aOwn', new THREE.InterleavedBufferAttribute(ib, 3, 15));
    // sfera z wypieku = BufferGeometry.computeBoundingSphere (ten sam algorytm na tych samych float32)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(r.sphere[0], r.sphere[1], r.sphere[2]), r.sphere[3]);
    out[set] = geo;
  }
  return out;
}

/**
 * Geometrie skóry kawałka: { bg, fg } (BufferGeometry albo null — zestaw bez brył grupy).
 * Kratownica 3D (lattice.dims.z > 1 — bryła budowli, docs/PORT-silnik-belek.md § „Ciała 3D”): aLat z wysokością
 * (az — początek układu bryły względem latticeMin w z), trójkąty dzielone w 3D, kotwica szukana w 3D.
 */
export function bakeBuildingChunkSkin(building, group, opts) {
  const it = bakeBuildingChunkSkinSteps(building, group, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * To samo co bakeBuildingChunkSkin, w KROKACH (generator: yield co porcję pracy ~1 ms, wynik w `value` po `done`) —
 * zapas wypieku w wątku głównym (bez workerów).
 */
export function* bakeBuildingChunkSkinSteps(building, group, opts) {
  const input = buildingSkinBakeInput(building, group, opts);
  if (!input) return { bg: null, fg: null, triangles: 0 };
  const res = yield* bakeSkinCoreSteps(input);
  return buildingSkinGeometries(res);
}

// --- wypiek w WORKERACH -----------------------------------------------------------------------------------------
// Pula workerów (SKIN_BAKE_WORKERS); kolejka zadań w wątku głównym — pilne (kawałek ruszony, odłamy czekają na skórę)
// przed wypiekiem z wyprzedzeniem, w każdej klasie po kolei. Worker liczy jedno zadanie naraz.
const SKIN_BAKE_WORKERS = 2;
const _workers = [];
const _waiting = [];
let _workersBroken = false;
let _seq = 0;
/** Liczniki wypieku w workerach: zadania, czas wypieku w workerze (suma i szczyt), oczekiwanie w kolejce. */
export const SKIN_BAKE_STATS = { requested: 0, done: 0, failed: 0, cancelled: 0, workerMs: 0, workerPeakMs: 0, waitPeakMs: 0, queued: 0 };

function failAll(reason) {
  for (const slot of _workers) {
    const job = slot.job;
    slot.job = null;
    if (job && !job.cancelled) job.cb(null, reason);
  }
  const list = _waiting.splice(0);
  for (const job of list) if (!job.cancelled) job.cb(null, reason);
}

function ensureWorkers() {
  if (_workersBroken) return false;
  if (_workers.length) return true;
  if (typeof Worker === 'undefined' || typeof window === 'undefined') { _workersBroken = true; return false; }
  try {
    const B = skinBakeBases();
    for (let i = 0; i < SKIN_BAKE_WORKERS; i++) {
      const w = new Worker(new URL('./portBuildingSkinWorker.js', import.meta.url), { type: 'module', name: `skin-bake-${i}` });
      const slot = { w, job: null };
      w.onmessage = (ev) => onWorkerMessage(slot, ev.data);
      w.onerror = (err) => {
        console.warn('[skóra budowli] worker wypieku padł — wypiek w wątku gry:', err?.message || err);
        _workersBroken = true;
        failAll('worker');
        for (const s of _workers) { try { s.w.terminate(); } catch { /* już zamknięty */ } }
        _workers.length = 0;
      };
      w.postMessage({ type: 'bases', bases: B });
      _workers.push(slot);
    }
  } catch (err) {
    console.warn('[skóra budowli] bez workerów wypieku:', err?.message || err);
    _workersBroken = true;
    for (const s of _workers) { try { s.w.terminate(); } catch { /* już zamknięty */ } }
    _workers.length = 0;
    return false;
  }
  return true;
}

function takeNext() {
  let best = -1;
  for (let i = 0; i < _waiting.length; i++) {
    const j = _waiting[i];
    if (j.cancelled) { _waiting.splice(i--, 1); continue; }
    if (j.urgent) { best = i; break; }
    if (best < 0) best = i;
  }
  return best < 0 ? null : _waiting.splice(best, 1)[0];
}

function pump() {
  for (const slot of _workers) {
    if (slot.job) continue;
    const job = takeNext();
    if (!job) break;
    slot.job = job;
    const wait = performance.now() - job.t0;
    if (wait > SKIN_BAKE_STATS.waitPeakMs) SKIN_BAKE_STATS.waitPeakMs = wait;
    const inp = job.input;
    const L = inp.lattice;
    // rekordy grupy skopiowane dla tego zadania — przekazane (bez kopii); kratownica i bryły bazowe — kopia
    const transfer = [];
    for (const set of ['bg', 'fg']) for (const p of inp.parts[set]) transfer.push(p.inst.buffer);
    slot.w.postMessage({
      type: 'bake', id: job.id, parts: inp.parts, stride: inp.stride, cx: inp.cx, cz: inp.cz, maxEdgeCells: inp.maxEdgeCells,
      lattice: { cs: L.cs, dims: { x: L.dims.x, y: L.dims.y, z: L.dims.z }, occ: L.occ, ax: L.ax, ay: L.ay, az: L.az }
    }, transfer);
    job.input = null;
  }
  SKIN_BAKE_STATS.queued = _waiting.length;
}

function onWorkerMessage(slot, msg) {
  const job = slot.job;
  slot.job = null;
  if (job && msg && msg.id === job.id) {
    const ms = Number(msg.ms) || 0;
    SKIN_BAKE_STATS.workerMs += ms;
    if (ms > SKIN_BAKE_STATS.workerPeakMs) SKIN_BAKE_STATS.workerPeakMs = ms;
    if (job.cancelled) SKIN_BAKE_STATS.cancelled++;
    else if (msg.err || !msg.res) { SKIN_BAKE_STATS.failed++; console.warn('[skóra budowli] wypiek nieudany:', msg.err); job.cb(null, msg.err || 'brak wyniku'); }
    else { SKIN_BAKE_STATS.done++; job.cb(msg.res, null); }
  }
  pump();
}

/**
 * Wypiek skóry kawałka w WORKERZE (gra): uchwyt { cancel(), promote() } albo null — bez workerów (wołający piecze
 * w wątku głównym: bakeBuildingChunkSkinSteps). cb(res, err) w wątku głównym, res — wynik rdzenia (tablice; geometrie
 * three: buildingSkinGeometries). urgent — przed zadaniami z wyprzedzeniem.
 */
export function requestBuildingSkinBake(building, group, opts, cb, urgent = false) {
  if (!ensureWorkers()) return null;
  const input = buildingSkinBakeInput(building, group, opts);
  const job = { id: ++_seq, input, cb, urgent: !!urgent, cancelled: false, t0: performance.now() };
  const handle = {
    cancel() { job.cancelled = true; },
    promote() { if (!job.urgent) { job.urgent = true; pump(); } }
  };
  SKIN_BAKE_STATS.requested++;
  if (!input) { queueMicrotask(() => { if (!job.cancelled) cb({ bg: null, fg: null, triangles: 0 }, null); }); return handle; }
  _waiting.push(job);
  pump();
  return handle;
}

/** Zadania czekające i liczone (testy, narzędzia). */
export function skinBakeQueueState() {
  return { waiting: _waiting.filter((j) => !j.cancelled).length, busy: _workers.filter((s) => s.job).length, workers: _workers.length, broken: _workersBroken };
}

const _warmGeo = [null, null];
/**
 * Geometria rozgrzewki: jeden trójkąt z układem atrybutów skóry (klucz pipeline'u). indexed — wariant z indeksem
 * (odłamy rysują podzbiór trójkątów kawałka — worldBodies3D.js; three r183 ma `index` w kluczu geometrii).
 */
export function buildingSkinWarmGeometry(indexed = false) {
  const k = indexed ? 1 : 0;
  if (_warmGeo[k]) return _warmGeo[k];
  const g = new THREE.BufferGeometry();
  if (indexed) g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  const ib = new THREE.InterleavedBuffer(new Float32Array(3 * SKIN_INTER_STRIDE), SKIN_INTER_STRIDE);
  g.setAttribute('aPbA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  g.setAttribute('aPbN', new THREE.InterleavedBufferAttribute(ib, 4, 4));
  g.setAttribute('aPbFx', new THREE.InterleavedBufferAttribute(ib, 4, 8));
  g.setAttribute('aLat', new THREE.InterleavedBufferAttribute(ib, 3, 12));
  g.setAttribute('aOwn', new THREE.InterleavedBufferAttribute(ib, 3, 15));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  _warmGeo[k] = g;
  return g;
}
