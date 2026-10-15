// Render CIAŁ ŚWIATA (docs/PLAN-zniszczenia-swiata-3d.md § 6; logika: src/game/worldBodies.js): kawałek budowli, który
// stał się ciałem silnika belek (płaskie, zakotwiczone — obrażenia liczy warstwa 2D), rysuje SKÓRA — bryły kawałka
// wypieczone do układu ciała (dostawca miejsca, np. suchy dok: portBuildingSkin3D.js) jadą po polu przesunięć
// węzłów (hullSkin3D, slot na ciało) na CAŁEJ wysokości, martwe komórki znikają z poszarpanym brzegiem, rany z mapy
// ran rodu. Cieniowanie = cieniowanie brył budowli (wariant „skin” grafu), w tych samych passach (BG pod statkami,
// FG nad nimi, kamera perspektywy) — przejście statyka → ciało nie zmienia obrazu.
//  - Nietknięty kawałek (ciało śpi w bańce gracza) zostaje statyką: skóra schowana, grupa budowli widoczna.
//  - Ruszony (wgniecenie, zerwana belka, odłam) — skóra pokazana, statyczna grupa schowana (dostawca: skinned).
//  - Wyspy po rozpadzie i odłamy-wraki (hull.world) — zawsze skórą, każdy swoim slotem pola (widać tylko własne
//    komórki pierwotnej konstrukcji).
// Bez dymu, ognia i wybuchów (decyzja użytkownika 2026-10-05).
//
// WYPIEK SKÓRY NIGDY W KLATCE (2026-10-15, optymalizacja przestojów — kawałek bazy piratów pękający z progu punktów
// albo w rozpadzie habitatu piekł się w klatce dotknięcia: 40–210 ms na kawałek): skórę liczy worker
// (portBuildingSkin3D.requestBuildingSkinBake); kawałek, którego skóra jeszcze się piecze, dostaje zadanie PILNE (przed
// wypiekiem z wyprzedzeniem), a do jego końca:
//  - ruszony kawałek na miejscu — rysuje go dalej statyka (jak przed wypiekiem w tle),
//  - kawałek STRACONY (rozpadł się, odłamy czekają na skórę) — statyka TRZYMANA na miejscu (dostawca: setHold), aż skóra
//    przyjdzie, najwyżej HOLD_MAX_MS; odłamy pojawiają się w klatce, w której znika statyka.
// Bez workerów (Node, brak Worker) — wypiek w wątku głównym w krokach: pilne w budżecie klatki (URGENT_BAKE_MS), reszta
// w requestIdleCallback.
//
// Dostawca miejsca (site.render): { building (PortBuilding3D: skinMaterial(set), scene), root (Object3D budowli —
// macierz układ → scena), layers: { bg, fg }, hidden() → bool (mgła wojny), setSkinned(piece, on), groupOf(piece),
// rasterCenter(piece) → { x, z }, setHold?(piece, on) — statyka kawałka widoczna mimo straty (tylko obraz) }.
import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { HullBodies } from '../game/hullBodies.js';
import { worldBodies } from '../game/worldBodies.js';
import { hullSkinLattice, hullSkinLattice3D, ensureHullSkinSlot, writeHullSkinField, releaseHullSkinSlot } from './ships3d/hullSkin3D.js';
import { HullDamageMap } from './hullDamageMap.js';
import { SolidWounds } from './solidWounds.js';
import { bakeBuildingChunkSkinSteps, requestBuildingSkinBake, buildingSkinGeometries, SKIN_BAKE_STATS } from './portBuildings/portBuildingSkin3D.js';

const _inst = new Map();     // encja → egzemplarz
const _list = [];
let _frame = 0;
const _inv = new THREE.Matrix4();
let _invRoot = null, _invFrame = -1;   // _inv = odwrotność macierzy świata korzenia budowli _invRoot w klatce _invFrame
// bakePeakId — kawałek najdłuższego jednorazowego kroku wypieku W WĄTKU GŁÓWNYM (zapas bez workerów; „!” — krok pilny
// w klatce). urgent — zadania pilne (kawałek ruszony bez skóry), held — klatki z trzymaną statyką kawałka straconego,
// worker — liczniki workerów (SKIN_BAKE_STATS).
export const WORLD_SKIN_STATS = { shown: 0, instances: 0, triangles: 0, bakes: 0, prebaked: 0, bakeMs: 0, bakePeakMs: 0, bakePeakId: '',
  syncBakes: 0, subsets: 0, subsetPeakMs: 0, urgent: 0, held: 0, holdTimeouts: 0, worker: SKIN_BAKE_STATS };
if (typeof window !== 'undefined') window.__worldSkinStats = WORLD_SKIN_STATS;

function providerOf(hull) {
  return hull?.world?.site?.render || null;
}

// Klucz skóry kawałka: obraz ciała płaskiego albo konstrukcja bryły 3D (ten sam szablon dla kawałka i jego odłamów).
const skinKeyOf = (hull) => (hull.solid3D ? hull.structure : hull.image);

// Zadanie wypieku skóry kawałka: { piece, key, lat, solid, handle (worker) | it (generator — wątek główny), ms }.
// Wynik zadania, które nie jest już zadaniem kawałka (nowy klucz, reset), przepada.
const _jobs = new Set();      // zadania w toku (reset misji anuluje wszystkie — także kawałków usuniętych miejsc)
function makeSkinJob(piece, key, lat, solid, prov, c, urgent) {
  const opts = { cx: c.x, cz: c.z, lattice: lat, maxEdgeCells: piece.skinEdgeCells || 4 };
  const job = { piece, key, lat, solid, handle: null, it: null, ms: 0, urgent: !!urgent };
  job.handle = requestBuildingSkinBake(prov.building, prov.groupOf(piece), opts, (res) => finishWorkerJob(job, res), urgent);
  if (!job.handle) job.it = bakeBuildingChunkSkinSteps(prov.building, prov.groupOf(piece), opts);
  _jobs.add(job);
  return job;
}

// Wypiek skóry kawałka (ciało płaskie albo bryła 3D z żywego ciała).
function startSkinBake(piece, hull, prov, urgent) {
  const structure = hull.solid3D ? hull.structure : HullBodies.structureFor(hull.image, hull.scale, hull.cellPx);
  if (!structure) return null;
  // bryła 3D: kratownica wielowarstwowa, początek układu bryły względem latticeMin także w z
  const lat = hull.solid3D ? hullSkinLattice3D(structure, hull.anchorDX, hull.anchorDY, hull.anchorDZ)
    : hullSkinLattice(structure, hull.anchorDX, hull.anchorDY);
  const c = prov.rasterCenter(piece);
  if (!c) return null;
  return makeSkinJob(piece, skinKeyOf(hull), lat, !!hull.solid3D, prov, c, urgent);
}
// Bryła 3D: klucz skóry = konstrukcja SZABLONU (ta sama dla kawałka, jego ciała i odłamów — createSolid), dostępna
// bez żywego ciała (piece.solidFrame).
const solidKeyOf = (piece) => piece.solidFrame?.()?.structure || null;
// Wypiek skóry bryły 3D z SZABLONU (bez żywego ciała): kratownica i kotwica jak w createSolid (początek układu F
// w układzie ciała = −latticeMin − środek masy).
function startSolidTemplateBake(piece, prov, urgent) {
  const structure = solidKeyOf(piece);
  if (!structure) return null;
  const com = structure.com || { x: 0, y: 0, z: 0 };
  const lat = hullSkinLattice3D(structure, -structure.latticeMin.x - com.x, -structure.latticeMin.y - com.y, -structure.latticeMin.z - com.z);
  const c = prov.rasterCenter(piece);
  if (!c) return null;
  return makeSkinJob(piece, structure, lat, true, prov, c, urgent);
}

function installSkin(job, geo) {
  const piece = job.piece;
  _jobs.delete(job);
  WORLD_SKIN_STATS.bakes++;
  WORLD_SKIN_STATS.bakeMs = job.ms;
  if (piece.__skin) disposeSkinAssets(piece);
  piece.__skin = { key: job.key, lat: job.lat, bg: geo.bg, fg: geo.fg, triangles: geo.triangles, solid: !!job.solid };
  _baked.add(piece);
  if (piece.__skinJob === job) piece.__skinJob = null;
}

// Wynik workera (wątek główny, poza klatką): geometrie three tylko dla zadania, które jest nadal zadaniem kawałka.
function finishWorkerJob(job, res) {
  const piece = job.piece;
  _jobs.delete(job);
  if (piece.__skinJob !== job) return;
  if (!res) { piece.__skinJob = null; return; }   // wypiek nieudany / worker padł — następna prośba zaczyna od nowa
  if (job.prebake) WORLD_SKIN_STATS.prebaked++;
  installSkin(job, buildingSkinGeometries(res));
}

function cancelSkinJob(job) {
  if (!job) return;
  if (job.handle) job.handle.cancel();
  _jobs.delete(job);
  if (job.piece.__skinJob === job) job.piece.__skinJob = null;
}

// Krok wypieku W WĄTKU GŁÓWNYM (zapas bez workerów) do `budgetMs`. true = gotowe (piece.__skin). Zadanie workera — true,
// gdy skóra już jest.
function stepSkinBake(job, budgetMs, urgent = false) {
  if (!job.it) return !!(job.piece.__skin && job.piece.__skin.key === job.key);
  const t0 = performance.now();
  let r = job.it.next();
  while (!r.done && performance.now() - t0 < budgetMs) r = job.it.next();
  const ms = performance.now() - t0;
  job.ms += ms;
  if (ms > WORLD_SKIN_STATS.bakePeakMs) {
    WORLD_SKIN_STATS.bakePeakMs = ms;
    WORLD_SKIN_STATS.bakePeakId = (job.piece?.id || '?') + (urgent ? '!' : '');
  }
  if (!r.done) return false;
  installSkin(job, r.value);
  return true;
}

// Pilne wypieki w wątku głównym (bez workerów): wspólny budżet klatki — klatka nigdy nie czeka na cały wypiek.
const URGENT_BAKE_MS = 6;
let _urgentFrame = -1, _urgentLeft = 0;

// Geometria skóry kawałka (raz na kawałek i obraz ciała): zestawy bg / fg + kratownica do slotu pola, albo null, gdy
// skóra jeszcze się piecze (zadanie pilne — wynik w kolejnych klatkach).
function skinAssets(piece, hull, prov) {
  const key = skinKeyOf(hull);
  if (piece.__skin && piece.__skin.key === key) return piece.__skin;
  let job = piece.__skinJob && piece.__skinJob.key === key ? piece.__skinJob : null;
  if (!job) {
    cancelSkinJob(piece.__skinJob);
    job = startSkinBake(piece, hull, prov, true);
    if (!job) return null;
    piece.__skinJob = job;
    WORLD_SKIN_STATS.urgent++;
  } else if (!job.urgent) {
    job.urgent = true;
    if (job.handle) job.handle.promote();
    WORLD_SKIN_STATS.urgent++;
  }
  if (job.it) {
    if (_urgentFrame !== _frame) { _urgentFrame = _frame; _urgentLeft = URGENT_BAKE_MS; }
    if (_urgentLeft > 0) {
      const t0 = performance.now();
      stepSkinBake(job, _urgentLeft, true);
      _urgentLeft -= performance.now() - t0;
    }
  }
  return piece.__skin && piece.__skin.key === key ? piece.__skin : null;
}

// Wypiek W TLE: skóra żywego kawałka gotowa, zanim ktoś go ruszy. Z workerami — zadania z wyprzedzeniem w kolejce
// workerów (za pilnymi), bez nich — kroki w requestIdleCallback (najwyżej BAKE_SLICE_MS na wywołanie).
const BAKE_SLICE_MS = 4;
const _bakeQueue = [];
let _bakeScheduled = false;
function scheduleBake() {
  if (_bakeScheduled || !_bakeQueue.length) return;
  _bakeScheduled = true;
  const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(() => fn(null), 16);
  ric(runBake, { timeout: 250 });
}
function runBake(deadline) {
  _bakeScheduled = false;
  const budget = deadline && !deadline.didTimeout ? Math.max(1, Math.min(BAKE_SLICE_MS, deadline.timeRemaining() - 1)) : BAKE_SLICE_MS;
  const t0 = performance.now();
  while (_bakeQueue.length && performance.now() - t0 < budget) {
    const piece = _bakeQueue[0];
    // bryła 3D — z szablonu, w dowolnym stanie kawałka (poza straconym)
    const solid = !!piece.solid3D;
    const hull = !solid && piece.state === 'live' ? piece.entity?.beamHull : null;
    const prov = solid ? (piece.state !== 'lost' ? piece.site?.render || null : null) : (hull ? providerOf(hull) : null);
    const key = solid ? solidKeyOf(piece) : (hull ? skinKeyOf(hull) : null);
    if (!prov || !key || (piece.__skin && piece.__skin.key === key)) {
      _bakeQueue.shift();
      piece.__skinQueued = false;
      if (!prov || !key) cancelSkinJob(piece.__skinJob);
      continue;
    }
    let job = piece.__skinJob && piece.__skinJob.key === key ? piece.__skinJob : null;
    if (!job) {
      cancelSkinJob(piece.__skinJob);
      job = piece.__skinJob = solid ? startSolidTemplateBake(piece, prov, false) : startSkinBake(piece, hull, prov, false);
      if (job) job.prebake = true;
    }
    // zadanie workera — w kolejce workerów (wynik przyjdzie sam); wątek główny — krok w budżecie bezczynności
    if (!job || job.handle || stepSkinBake(job, budget - (performance.now() - t0))) {
      _bakeQueue.shift();
      piece.__skinQueued = false;
      if (job && !job.handle) WORLD_SKIN_STATS.prebaked++;
    }
  }
  scheduleBake();
}
// Wypiekamy z wyprzedzeniem tylko kawałki blisko gracza (taran, ostrzał z bliska) — cały dok to ~110 MB geometrii.
const PREBAKE_RADIUS = 3000;
// Bryły 3D (wieża habitatu: ~200 ms wypieku) — z wyprzedzeniem już z bańki ciał świata: zerwanie szyi pokazuje skórę
// w tej samej klatce, a dojazd do bazy daje dziesiątki klatek na wypiek w tle.
const PREBAKE_RADIUS_SOLID = 9000;
function nearFocus(b, focus, radius = PREBAKE_RADIUS) {
  for (let k = 0; k < focus.length; k++) {
    const f = focus[k];
    if (!f) continue;
    const dx = f.x < b.x0 ? b.x0 - f.x : f.x > b.x1 ? f.x - b.x1 : 0;
    const dy = f.y < b.y0 ? b.y0 - f.y : f.y > b.y1 ? f.y - b.y1 : 0;
    if (dx * dx + dy * dy <= radius * radius) return true;
  }
  return false;
}
const _baked = new Set();   // kawałki z wypieczoną skórą (zwolnienie geometrii przy resecie)
function disposeSkinAssets(p) {
  const s = p.__skin;
  if (!s) return;
  // podzbiory odłamów dzielą atrybuty z geometrią kawałka (dispose w three kasuje bufory atrybutów — razem)
  for (const g of s.subsets || []) g.dispose();
  s.bg?.dispose();
  s.fg?.dispose();
  p.__skin = null;
  _baked.delete(p);
}

// ODŁAM rysuje PODZBIÓR trójkątów skóry kawałka: geometria kawałka jest wspólna, a odłam (wyspa, wrak) widzi tylko
// swoje komórki — bez podzbioru każdy odłam rysował całą geometrię kawałka i odrzucał resztę w shaderze (łańcuch
// rozpadu doku: 137 odłamów → 3,35 mln trójkątów na klatkę, 2026-10-07). Trójkąt zostaje, gdy jego pudło w
// kratownicy (aLat, + 1 komórka na rogi FFD) zawiera komórkę odłamu (tablica sum prefiksowych maski) albo komórka-
// kotwica (aOwn) któregoś wierzchołka jest komórką odłamu. Odłam nie zyskuje komórek — podzbiór zostaje nadzbiorem.
// Indeks na WSPÓLNYCH atrybutach (te same bufory GPU); geometria podzbioru żyje do zwolnienia skóry kawałka.
// Liczone w budżecie klatki (SUBSET_MS) W KROKACH (generator — kawałek o setkach tysięcy trójkątów nie zajmuje całej
// klatki, 2026-10-15) — do tego czasu odłam rysuje pełną geometrię.
const SUBSET_MS = 3;
const SUBSET_TRIS_PER_STEP = 8192;
const _subsetQueue = [];
export function fragmentSkinSubset(geo, body, lat) {
  const it = fragmentSkinSubsetSteps(geo, body, lat);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
export function* fragmentSkinSubsetSteps(geo, body, lat) {
  const nx = lat.dims.x, ny = lat.dims.y, s = body.nodeStore;
  const mask = new Uint8Array(nx * ny);
  let any = false;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const x = s.ix[i], y = s.iy[i];
    if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
    mask[x + y * nx] = 1;
    any = true;
  }
  if (!any) return null;
  const W = nx + 1;
  const sat = new Int32Array(W * (ny + 1));
  for (let y = 0; y < ny; y++) {
    let row = 0;
    for (let x = 0; x < nx; x++) {
      row += mask[x + y * nx];
      sat[(x + 1) + (y + 1) * W] = sat[(x + 1) + y * W] + row;
    }
  }
  const lat3 = geo.attributes.aLat, own3 = geo.attributes.aOwn;
  const A = lat3.data.array, stride = lat3.data.stride, oL = lat3.offset, oO = own3.offset;
  // geometria kawałka z indeksem (wypiek 2026-10-15) albo bez (każdy trójkąt — 3 kolejne wierzchołki)
  const I = geo.index ? geo.index.array : null;
  const nV = I ? geo.index.count : geo.attributes.position.count;
  const idx = new Uint32Array(nV);
  let n = 0;
  for (let v = 0; v + 2 < nV; v += 3) {
    if (v > 0 && (v % (3 * SUBSET_TRIS_PER_STEP)) === 0) yield;
    let keep = false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const o = (I ? I[v + k] : v + k) * stride;
      const fx = A[o + oL], fy = A[o + oL + 1];
      if (fx < x0) x0 = fx; if (fx > x1) x1 = fx;
      if (fy < y0) y0 = fy; if (fy > y1) y1 = fy;
      const ox = A[o + oO] | 0, oy = A[o + oO + 1] | 0;
      if (ox >= 0 && oy >= 0 && ox < nx && oy < ny && mask[ox + oy * nx]) keep = true;
    }
    if (!keep) {
      const cx0 = Math.max(0, Math.floor(x0)), cy0 = Math.max(0, Math.floor(y0));
      const cx1 = Math.min(nx - 1, Math.floor(x1) + 1), cy1 = Math.min(ny - 1, Math.floor(y1) + 1);
      if (cx1 >= cx0 && cy1 >= cy0) {
        keep = sat[(cx1 + 1) + (cy1 + 1) * W] - sat[cx0 + (cy1 + 1) * W] - sat[(cx1 + 1) + cy0 * W] + sat[cx0 + cy0 * W] > 0;
      }
    }
    if (keep) {
      if (I) { idx[n++] = I[v]; idx[n++] = I[v + 1]; idx[n++] = I[v + 2]; }
      else { idx[n++] = v; idx[n++] = v + 1; idx[n++] = v + 2; }
    }
  }
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) g.setAttribute(name, geo.attributes[name]);
  g.setIndex(new THREE.BufferAttribute(idx.slice(0, Math.max(3, n)), 1));
  if (n === 0) g.setDrawRange(0, 0);
  g.boundingSphere = geo.boundingSphere;
  return g;
}
// To samo dla BRYŁY 3D (kratownica wielowarstwowa): maska komórek odłamu w 3D, pudło trójkąta w 3D (+ 1 komórka),
// test pudła przez tablicę sum prefiksowych 3D.
export function fragmentSkinSubset3D(geo, body, lat) {
  const it = fragmentSkinSubset3DSteps(geo, body, lat);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
export function* fragmentSkinSubset3DSteps(geo, body, lat) {
  const nx = lat.dims.x, ny = lat.dims.y, nz = lat.dims.z, s = body.nodeStore;
  const sxy = nx * ny;
  const mask = new Uint8Array(sxy * nz);
  let any = false;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const x = s.ix[i], y = s.iy[i], z = s.iz[i];
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
    mask[x + y * nx + z * sxy] = 1;
    any = true;
  }
  if (!any) return null;
  const W = nx + 1, WH = (nx + 1) * (ny + 1);
  const sat = new Int32Array(WH * (nz + 1));
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const v = mask[x + y * nx + z * sxy];
        const i = (x + 1) + (y + 1) * W + (z + 1) * WH;
        sat[i] = v + sat[i - 1] + sat[i - W] + sat[i - WH] - sat[i - 1 - W] - sat[i - 1 - WH] - sat[i - W - WH] + sat[i - 1 - W - WH];
      }
    }
  }
  yield;
  const boxSum = (x0, y0, z0, x1, y1, z1) => {
    const a = (x, y, z) => sat[x + y * W + z * WH];
    return a(x1 + 1, y1 + 1, z1 + 1) - a(x0, y1 + 1, z1 + 1) - a(x1 + 1, y0, z1 + 1) - a(x1 + 1, y1 + 1, z0) +
      a(x0, y0, z1 + 1) + a(x0, y1 + 1, z0) + a(x1 + 1, y0, z0) - a(x0, y0, z0);
  };
  const lat3 = geo.attributes.aLat, own3 = geo.attributes.aOwn;
  const A = lat3.data.array, stride = lat3.data.stride, oL = lat3.offset, oO = own3.offset;
  const I = geo.index ? geo.index.array : null;
  const nV = I ? geo.index.count : geo.attributes.position.count;
  const idx = new Uint32Array(nV);
  let n = 0;
  for (let v = 0; v + 2 < nV; v += 3) {
    if (v > 0 && (v % (3 * SUBSET_TRIS_PER_STEP)) === 0) yield;
    let keep = false;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const o = (I ? I[v + k] : v + k) * stride;
      const fx = A[o + oL], fy = A[o + oL + 1], fz = A[o + oL + 2];
      if (fx < x0) x0 = fx; if (fx > x1) x1 = fx;
      if (fy < y0) y0 = fy; if (fy > y1) y1 = fy;
      if (fz < z0) z0 = fz; if (fz > z1) z1 = fz;
      const ox = A[o + oO] | 0, oy = A[o + oO + 1] | 0, oz = A[o + oO + 2] | 0;
      if (ox >= 0 && oy >= 0 && oz >= 0 && ox < nx && oy < ny && oz < nz && mask[ox + oy * nx + oz * sxy]) keep = true;
    }
    if (!keep) {
      const cx0 = Math.max(0, Math.floor(x0)), cy0 = Math.max(0, Math.floor(y0)), cz0 = Math.max(0, Math.floor(z0));
      const cx1 = Math.min(nx - 1, Math.floor(x1) + 1), cy1 = Math.min(ny - 1, Math.floor(y1) + 1), cz1 = Math.min(nz - 1, Math.floor(z1) + 1);
      if (cx1 >= cx0 && cy1 >= cy0 && cz1 >= cz0) keep = boxSum(cx0, cy0, cz0, cx1, cy1, cz1) > 0;
    }
    if (keep) {
      if (I) { idx[n++] = I[v]; idx[n++] = I[v + 1]; idx[n++] = I[v + 2]; }
      else { idx[n++] = v; idx[n++] = v + 1; idx[n++] = v + 2; }
    }
  }
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) g.setAttribute(name, geo.attributes[name]);
  g.setIndex(new THREE.BufferAttribute(idx.slice(0, Math.max(3, n)), 1));
  if (n === 0) g.setDrawRange(0, 0);
  g.boundingSphere = geo.boundingSphere;
  return g;
}

// Podzbiory odłamów w budżecie klatki: egzemplarz z kolejki dostaje generator na każdą DOSTĘPNĄ geometrię (bryła 3D
// ma dwie siatki na zestaw — pod / nad płaszczyzną gry — podzbiór liczony raz na geometrię); krok po kroku, aż do
// końca budżetu, następna klatka kontynuuje.
function runSubsets() {
  const t0 = performance.now();
  while (_subsetQueue.length && performance.now() - t0 < SUBSET_MS) {
    const inst = _subsetQueue[0];
    const hull = inst.entity?.beamHull;
    const skin = inst.piece?.__skin;
    if (!_inst.has(inst.entity) || !hull || !hull.body || hull.body.dead || !skin || skin !== inst.assetsKey) {
      _subsetQueue.shift();
      inst.subsetQueued = false;
      inst.subsetWork = null;
      continue;
    }
    if (!inst.subsetWork) {
      inst.subsetWork = [];
      const seen = new Set();
      for (const mesh of inst.meshes) {
        const geo = mesh.userData.fullGeometry;
        if (!geo || mesh.geometry !== geo || seen.has(geo)) continue;
        seen.add(geo);
        inst.subsetWork.push({ geo, it: skin.solid ? fragmentSkinSubset3DSteps(geo, hull.body, skin.lat) : fragmentSkinSubsetSteps(geo, hull.body, skin.lat) });
      }
    }
    const w = inst.subsetWork[0];
    if (!w) { _subsetQueue.shift(); inst.subsetQueued = false; inst.subsetWork = null; continue; }
    const s0 = performance.now();
    let r = w.it.next();
    while (!r.done && performance.now() - t0 < SUBSET_MS) r = w.it.next();
    const ms = performance.now() - s0;
    if (ms > WORLD_SKIN_STATS.subsetPeakMs) WORLD_SKIN_STATS.subsetPeakMs = ms;
    if (!r.done) break;
    inst.subsetWork.shift();
    const sub = r.value;
    if (sub) {
      (skin.subsets || (skin.subsets = [])).push(sub);
      WORLD_SKIN_STATS.subsets++;
      for (const mesh of inst.meshes) if (mesh.userData.fullGeometry === w.geo && mesh.geometry === w.geo) mesh.geometry = sub;
    }
  }
}
function queueBakes() {
  const focus = worldBodies.focus || [];
  for (const site of worldBodies.sites) {
    if (!site.render) continue;
    for (const p of site.pieces) {
      // Bryły 3D (kilka na budowlę, wypiek wieży habitatu ~200 ms): z szablonu, z wyprzedzeniem BEZ progu odległości
      // i bez zwalniania w statyce — zerwanie szyi pokazuje skórę wieży w tej samej klatce (dawniej wypiek w klatce
      // zerwania, 220–290 ms, gdy gracz doleciał szybciej, niż wypiek w tle zdążył).
      if (p.solid3D) {
        if (p.state === 'lost') { if (p.__skin && !p.__skinUsers) disposeSkinAssets(p); continue; }
        if (p.__skinQueued || (p.__skin && p.__skin.key === solidKeyOf(p))) continue;
        p.__skinQueued = true;
        _bakeQueue.push(p);
        continue;
      }
      // kawałek wrócił do statyki (nietknięty, daleko) — geometria skóry zwolniona
      if (p.state === 'static') { if (p.__skin) disposeSkinAssets(p); cancelSkinJob(p.__skinJob); continue; }
      // kawałek stracony, a jego odłamy zniknęły (wraki zwolnione) — też
      if (p.state === 'lost') { if (p.__skin && !p.__skinUsers) disposeSkinAssets(p); continue; }
      if (p.state !== 'live' || p.__skinQueued || !p.entity?.beamHull) continue;
      if (p.__skin && p.__skin.key === skinKeyOf(p.entity.beamHull)) continue;
      // budowla przed rozpadem (setAllLive) — wszystkie kawałki, finał nie piecze w klatce
      if (!site.allLive && !nearFocus(p.bounds, focus, p.solid3D ? PREBAKE_RADIUS_SOLID : PREBAKE_RADIUS)) continue;
      p.__skinQueued = true;
      _bakeQueue.push(p);
    }
  }
  scheduleBake();
}

function createInstance(entity, assets, prov, piece) {
  const root = new THREE.Group();
  root.name = 'ciało świata';
  root.matrixAutoUpdate = true;
  const inst = { entity, root, meshes: [], frame: 0, assetsKey: assets, dmgU: null, piece, subsetQueued: false, subsetWork: null };
  piece.__skinUsers = (piece.__skinUsers || 0) + 1;
  const bgLayer = prov.layers?.bg ?? 1, fgLayer = prov.layers?.fg ?? 2;
  for (const set of ['bg', 'fg']) {
    const geo = assets[set];
    if (!geo) continue;
    // Bryła 3D: każdy zestaw dwiema siatkami — pod płaszczyzną gry w passie tła, nad nią w FG (cięcie po z świata
    // w shaderze: userData.clipZ); ciało płaskie — jedna siatka w warstwie swojego zestawu.
    const halves = assets.solid ? [[bgLayer, -1], [fgLayer, 1]] : [[set === 'bg' ? bgLayer : fgLayer, 0]];
    for (const [layer, clip] of halves) {
      const mesh = new THREE.Mesh(geo, prov.building.skinMaterial(set, !!assets.solid));
      mesh.name = `ciało świata (${set}${clip < 0 ? ' pod' : clip > 0 ? ' nad' : ''})`;
      // Przycinanie do kadru sferą EGZEMPLARZA (three: Frustum.intersectsObject bierze object.boundingSphere przed
      // sferą geometrii): geometria jest wspólna dla odłamów kawałka, a położenie spoczynkowe siatki przesuwa w
      // shaderze uOff ciała (sOffV) — sfera = sfera geometrii + uOff, promień + odkształcenie (co klatkę).
      mesh.boundingSphere = new THREE.Sphere();
      mesh.frustumCulled = true;
      mesh.layers.set(layer);
      mesh.userData.bodyToHub = new THREE.Matrix4();
      mesh.userData.fullGeometry = geo;
      if (clip !== 0) mesh.userData.clipZ = new THREE.Vector2(clip, 0);
      root.add(mesh);
      inst.meshes.push(mesh);
    }
  }
  root.visible = false;
  Core3D.scene.add(root);
  _inst.set(entity, inst);
  // odłam (wyspa albo wrak kawałka) — podzbiór trójkątów w budżecie klatki
  if (piece.entity !== entity) { inst.subsetQueued = true; _subsetQueue.push(inst); }
  return inst;
}

function disposeInstance(inst) {
  if (inst.root.parent) inst.root.parent.remove(inst.root);
  _inst.delete(inst.entity);
  if (inst.piece) inst.piece.__skinUsers = Math.max(0, (inst.piece.__skinUsers || 0) - 1);
}

function collect() {
  _list.length = 0;
  for (const e of worldBodies.renderEntities()) _list.push(e);
  const wrecks = typeof window !== 'undefined' && Array.isArray(window.wrecks) ? window.wrecks : null;
  if (wrecks) {
    for (let i = 0; i < wrecks.length; i++) {
      const w = wrecks[i];
      if (w && !w.dead && w.worldDebris && w.beamHull?.world) _list.push(w);
    }
  }
  return _list;
}

// Statyka kawałka STRACONEGO trzymana na ekranie, dopóki skóra jego odłamów się piecze — najwyżej tyle [ms czasu
// rzeczywistego]; potem znika (odłamy bez skóry do końca wypieku).
const HOLD_MAX_MS = 1500;

/**
 * Klatka renderu (po updateHexShips3D, przed Core3D.render): skóry ciał świata — poza z ciała, pole przesunięć,
 * mapa ran, przełączenie statyka ↔ skóra. Zwraca liczbę pokazanych skór.
 */
export function syncWorldBodies3D() {
  _frame++;
  let shown = 0, triangles = 0;
  const list = collect();
  // kawałki ruszone w tej klatce (statyka schowana) — dostawca dostaje stan raz na kawałek
  for (const site of worldBodies.sites) {
    for (const p of site.pieces) { p.__skinShown = false; p.__skinPending = false; }
  }
  for (let k = 0; k < list.length; k++) {
    const e = list[k];
    const hull = e.beamHull;
    if (!hull || hull.entity !== e || !hull.body || hull.body.dead || hull.body.activeNodes <= 0) continue;
    const piece = hull.world;
    const prov = providerOf(hull);
    if (!piece || !prov || !prov.building || !prov.root) continue;
    if (prov.hidden && prov.hidden()) continue;
    const isMain = piece.entity === e;
    // nietknięty kawałek — statyka (bez kosztu skóry)
    if (isMain && !piece.touched) continue;
    const assets = skinAssets(piece, hull, prov);
    if (!assets) { piece.__skinPending = true; continue; }
    if (!assets.bg && !assets.fg) continue;
    let inst = _inst.get(e);
    if (!inst) inst = createInstance(e, assets, prov, piece);
    inst.frame = _frame;
    if (hull.solid3D) {
      // BRYŁA 3D: poza ciała silnika wprost (świat silnika = scena: x gry, −y gry, z; kwaternion — pełny obrót)
      const b = hull.body;
      inst.root.position.set(b.pos.x, b.pos.y, b.pos.z);
      inst.root.quaternion.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    } else {
      // poza: początek ciała i kąt jak skóra sprite'a (hexShips3D.updateBeamSkinMesh / modele 3D okrętów)
      const theta = -((Number(e.angle) || 0));
      const c = Math.cos(theta), s = Math.sin(theta);
      const ax = HullBodies.anchorLocalX(hull), ay = HullBodies.anchorLocalY(hull);
      const ex = e.pos ? e.pos.x : e.x, ey = e.pos ? e.pos.y : e.y;
      // __fallZ — poza w z sceny (ciało płaskie spoza płaszczyzny gry; dawny scenariusz szyi)
      inst.root.position.set(ex - (c * ax - s * ay), -ey - (s * ax + c * ay), Number(e.__fallZ) || 0);
      inst.root.rotation.set(0, 0, theta);
    }
    inst.root.updateMatrixWorld(true);
    // stan skóry przy CIELE (przeżywa przejście kawałka w wrak — convertToWreck)
    const body = hull.body;
    if (body.__skin3DHull !== hull) {
      if (body.__skin3D) hull.__skin3D = body.__skin3D;
      body.__skin3DHull = hull;
    }
    let st = hull.__skin3D;
    if (!st || st.body !== body) {
      st = ensureHullSkinSlot(hull, assets.lat.occ);
      body.__skin3D = st;
    }
    if (!st) { inst.root.visible = false; continue; }
    writeHullSkinField(hull);
    // mapa ran rodu (ten sam slot i uv co skóra sprite'a)
    const du = inst.dmgU || (inst.dmgU = {
      uDmgSlot: { value: new THREE.Vector4(0, 1, 1, 0) },
      uDmgWorld: { value: new THREE.Vector2(1, 1) },
      uv: new THREE.Vector4(),
      // bryła 3D: slot pola ran 3D (solidWounds.js) — (offset, bloki x, bloki y, wł.), (wymiary kratownicy, —)
      woundSlot: new THREE.Vector4(0, 1, 1, 0),
      woundDim: new THREE.Vector4(1, 1, 1, 0)
    });
    if (hull.solid3D) {
      // bryła 3D: mapa ran sprite'a zna tylko uv ciał płaskich — rany w komórkach kratownicy (solidWounds.js)
      du.uDmgSlot.value.set(0, 1, 1, 0);
      du.uv.set(1, 1, 0, 0);
      SolidWounds.bind(hull, du);
    } else {
      HullDamageMap.bind(hull.dmgKey, du);
      du.uv.set(hull.pixelPitch / hull.srcWidth, hull.pixelPitch / hull.srcHeight, hull.ny, 0);
    }
    // ciało → układ budowli (lampy, normalne układu); macierz budowli raz na klatkę (dawniej przeliczana z całym
    // drzewem budowli dla KAŻDEGO odłamu — rozpad habitatu: setki odłamów)
    if (_invRoot !== prov.root || _invFrame !== _frame) {
      prov.root.updateMatrixWorld();
      _inv.copy(prov.root.matrixWorld).invert();
      _invRoot = prov.root;
      _invFrame = _frame;
    }
    const margin = (Number(body._maxDisp) || 0) + 2 * body.cellSize;
    for (const mesh of inst.meshes) {
      mesh.userData.skin3D = st;
      mesh.userData.dmgSlot = du.uDmgSlot.value;
      mesh.userData.dmgUv = du.uv;
      mesh.userData.dmgWorld = du.uDmgWorld.value;
      mesh.userData.woundSlot = du.woundSlot;
      mesh.userData.woundDim = du.woundDim;
      mesh.userData.bodyToHub.multiplyMatrices(_inv, mesh.matrixWorld);
      const gs = mesh.geometry.boundingSphere;
      if (gs) {
        mesh.boundingSphere.center.set(gs.center.x + st.off.x, gs.center.y + st.off.y, gs.center.z + st.off.z);
        mesh.boundingSphere.radius = gs.radius + margin;
      } else {
        mesh.frustumCulled = false;
      }
    }
    inst.root.visible = true;
    piece.__skinShown = true;
    shown++;
    for (const mesh of inst.meshes) {
      const g = mesh.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  }
  // statyka kawałków: schowana, gdy kawałek ma skórę (ruszony) albo nie istnieje w miejscu; kawałek stracony, którego
  // odłamy czekają na skórę — statyka trzymana (tylko obraz: stan gry kawałka bez zmian)
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  for (const site of worldBodies.sites) {
    const prov = site.render;
    if (!prov?.setSkinned) continue;
    for (const p of site.pieces) {
      const want = p.state === 'live' ? (p.touched && p.__skinShown) : p.state === 'lost';
      if (p.__staticHidden !== want) {
        p.__staticHidden = want;
        prov.setSkinned(p, want);
      }
      let hold = false;
      if (p.state === 'lost' && p.__skinPending && typeof prov.setHold === 'function') {
        if (!(p.__holdSince > 0)) p.__holdSince = now;
        hold = now - p.__holdSince <= HOLD_MAX_MS;
        if (!hold && !p.__holdTimedOut) { p.__holdTimedOut = true; WORLD_SKIN_STATS.holdTimeouts++; }
      }
      if (hold) WORLD_SKIN_STATS.held++;
      if (!!p.__staticHold !== hold) {
        p.__staticHold = hold;
        prov.setHold?.(p, hold);
      }
    }
  }
  // egzemplarze bez ciała w tej klatce: schowane, martwe zwolnione
  for (const inst of _inst.values()) {
    if (inst.frame === _frame) continue;
    if (inst.root.visible) inst.root.visible = false;
    const h = inst.entity?.beamHull;
    const dead = inst.entity?.dead || !h || h.body?.dead;
    if (dead || _frame - inst.frame > 600) {
      if (h?.__skin3D && (dead || h.body?.dead)) { releaseHullSkinSlot(h); if (h.body) h.body.__skin3D = null; }
      disposeInstance(inst);
    }
  }
  WORLD_SKIN_STATS.shown = shown;
  WORLD_SKIN_STATS.instances = _inst.size;
  WORLD_SKIN_STATS.triangles = triangles;
  // rany brył 3D: czas pola (stygnięcie w shaderze) i wysyłka zmienionych bloków komórek
  SolidWounds.flush();
  if ((_frame & 15) === 0) queueBakes();
  if (_subsetQueue.length) runSubsets();
  return shown;
}

/** Wszystko schowane i zwolnione (koniec misji, nowa gra). */
export function resetWorldBodies3D() {
  for (const inst of [..._inst.values()]) {
    const h = inst.entity?.beamHull;
    if (h?.__skin3D) { releaseHullSkinSlot(h); if (h.body) h.body.__skin3D = null; }
    disposeInstance(inst);
  }
  for (const p of [..._baked]) disposeSkinAssets(p);
  for (const p of _bakeQueue) p.__skinQueued = false;
  _bakeQueue.length = 0;
  _subsetQueue.length = 0;
  for (const job of [..._jobs]) cancelSkinJob(job);
  for (const site of worldBodies.sites) for (const p of site.pieces) { p.__holdSince = 0; p.__holdTimedOut = false; }
}
