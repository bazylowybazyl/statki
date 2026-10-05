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
// Dostawca miejsca (site.render): { building (PortBuilding3D: skinMaterial(set), scene), root (Object3D budowli —
// macierz układ → scena), layers: { bg, fg }, hidden() → bool (mgła wojny), setSkinned(piece, on), groupOf(piece),
// rasterCenter(piece) → { x, z } }.
import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { HullBodies } from '../game/hullBodies.js';
import { worldBodies } from '../game/worldBodies.js';
import { hullSkinLattice, ensureHullSkinSlot, writeHullSkinField, releaseHullSkinSlot } from './ships3d/hullSkin3D.js';
import { HullDamageMap } from './hullDamageMap.js';
import { bakeBuildingChunkSkinSteps } from './portBuildings/portBuildingSkin3D.js';

const _inst = new Map();     // encja → egzemplarz
const _list = [];
let _frame = 0;
const _inv = new THREE.Matrix4();
export const WORLD_SKIN_STATS = { shown: 0, instances: 0, triangles: 0, bakes: 0, prebaked: 0, bakeMs: 0, bakePeakMs: 0 };
if (typeof window !== 'undefined') window.__worldSkinStats = WORLD_SKIN_STATS;

function providerOf(hull) {
  return hull?.world?.site?.render || null;
}

// Wypiek skóry kawałka W KROKACH (bakeBuildingChunkSkinSteps): { piece, key, lat, it, ms } albo null.
function startSkinBake(piece, hull, prov) {
  const structure = HullBodies.structureFor(hull.image, hull.scale, hull.cellPx);
  if (!structure) return null;
  const lat = hullSkinLattice(structure, hull.anchorDX, hull.anchorDY);
  const c = prov.rasterCenter(piece);
  if (!c) return null;
  const it = bakeBuildingChunkSkinSteps(prov.building, prov.groupOf(piece),
    { cx: c.x, cz: c.z, lattice: lat, maxEdgeCells: piece.skinEdgeCells || 4 });
  return { piece, key: hull.image, lat, it, ms: 0 };
}
// Krok wypieku do `budgetMs` (Infinity = do końca). true = gotowe (piece.__skin).
function stepSkinBake(job, budgetMs) {
  const t0 = performance.now();
  let r = job.it.next();
  while (!r.done && performance.now() - t0 < budgetMs) r = job.it.next();
  const ms = performance.now() - t0;
  job.ms += ms;
  if (ms > WORLD_SKIN_STATS.bakePeakMs) WORLD_SKIN_STATS.bakePeakMs = ms;
  if (!r.done) return false;
  const piece = job.piece, geo = r.value;
  WORLD_SKIN_STATS.bakes++;
  WORLD_SKIN_STATS.bakeMs = job.ms;
  if (piece.__skin) disposeSkinAssets(piece);
  piece.__skin = { key: job.key, lat: job.lat, bg: geo.bg, fg: geo.fg, triangles: geo.triangles };
  _baked.add(piece);
  if (piece.__skinJob === job) piece.__skinJob = null;
  return true;
}

// Geometria skóry kawałka (raz na kawałek i obraz ciała): zestawy bg / fg + kratownica do slotu pola. Kawałek ruszony
// przed wypiekiem w tle piecze się od razu (rozpoczęty wypiek w tle — dokończony).
function skinAssets(piece, hull, prov) {
  const key = hull.image;
  if (piece.__skin && piece.__skin.key === key) return piece.__skin;
  let job = piece.__skinJob && piece.__skinJob.key === key ? piece.__skinJob : null;
  if (!job) job = startSkinBake(piece, hull, prov);
  if (!job) return null;
  piece.__skinJob = job;
  stepSkinBake(job, Infinity);
  return piece.__skin;
}

// Wypiek W TLE (requestIdleCallback, w krokach — najwyżej BAKE_SLICE_MS na wywołanie): skóra żywego kawałka gotowa,
// zanim ktoś go ruszy — wypiek odcinka trzonu to ~20–50 ms, w klatce pierwszego dotknięcia (albo w jednym wywołaniu
// „bezczynności”, które przy grającej pętli przychodzi z limitem czasu) byłby przestojem.
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
    const hull = piece.state === 'live' ? piece.entity?.beamHull : null;
    const prov = hull ? providerOf(hull) : null;
    if (!hull || !prov || (piece.__skin && piece.__skin.key === hull.image)) {
      _bakeQueue.shift();
      piece.__skinQueued = false;
      if (!hull) piece.__skinJob = null;
      continue;
    }
    let job = piece.__skinJob && piece.__skinJob.key === hull.image ? piece.__skinJob : null;
    if (!job) job = piece.__skinJob = startSkinBake(piece, hull, prov);
    if (!job || stepSkinBake(job, budget - (performance.now() - t0))) {
      _bakeQueue.shift();
      piece.__skinQueued = false;
      if (job) WORLD_SKIN_STATS.prebaked++;
    }
  }
  scheduleBake();
}
// Wypiekamy z wyprzedzeniem tylko kawałki blisko gracza (taran, ostrzał z bliska) — cały dok to ~110 MB geometrii.
const PREBAKE_RADIUS = 3000;
function nearFocus(b, focus) {
  for (let k = 0; k < focus.length; k++) {
    const f = focus[k];
    if (!f) continue;
    const dx = f.x < b.x0 ? b.x0 - f.x : f.x > b.x1 ? f.x - b.x1 : 0;
    const dy = f.y < b.y0 ? b.y0 - f.y : f.y > b.y1 ? f.y - b.y1 : 0;
    if (dx * dx + dy * dy <= PREBAKE_RADIUS * PREBAKE_RADIUS) return true;
  }
  return false;
}
const _baked = new Set();   // kawałki z wypieczoną skórą (zwolnienie geometrii przy resecie)
function disposeSkinAssets(p) {
  const s = p.__skin;
  if (!s) return;
  s.bg?.dispose();
  s.fg?.dispose();
  p.__skin = null;
  _baked.delete(p);
}
function queueBakes() {
  const focus = worldBodies.focus || [];
  for (const site of worldBodies.sites) {
    if (!site.render) continue;
    for (const p of site.pieces) {
      // kawałek wrócił do statyki (nietknięty, daleko) — geometria skóry zwolniona
      if (p.state === 'static') { if (p.__skin) disposeSkinAssets(p); p.__skinJob = null; continue; }
      if (p.state !== 'live' || p.__skinQueued || !p.entity?.beamHull) continue;
      if (p.__skin && p.__skin.key === p.entity.beamHull.image) continue;
      if (!nearFocus(p.bounds, focus)) continue;
      p.__skinQueued = true;
      _bakeQueue.push(p);
    }
  }
  scheduleBake();
}

function createInstance(entity, assets, prov) {
  const root = new THREE.Group();
  root.name = 'ciało świata';
  root.matrixAutoUpdate = true;
  const inst = { entity, root, meshes: [], frame: 0, assetsKey: assets, dmgU: null };
  for (const set of ['bg', 'fg']) {
    const geo = assets[set];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, prov.building.skinMaterial(set));
    mesh.name = `ciało świata (${set})`;
    mesh.frustumCulled = false;
    mesh.layers.set(prov.layers?.[set] ?? (set === 'bg' ? 1 : 2));
    mesh.userData.bodyToHub = new THREE.Matrix4();
    root.add(mesh);
    inst.meshes.push(mesh);
  }
  root.visible = false;
  Core3D.scene.add(root);
  _inst.set(entity, inst);
  return inst;
}

function disposeInstance(inst) {
  if (inst.root.parent) inst.root.parent.remove(inst.root);
  _inst.delete(inst.entity);
}

function collect() {
  _list.length = 0;
  for (const e of worldBodies.entities()) _list.push(e);
  const wrecks = typeof window !== 'undefined' && Array.isArray(window.wrecks) ? window.wrecks : null;
  if (wrecks) {
    for (let i = 0; i < wrecks.length; i++) {
      const w = wrecks[i];
      if (w && !w.dead && w.worldDebris && w.beamHull?.world) _list.push(w);
    }
  }
  return _list;
}

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
    for (const p of site.pieces) p.__skinShown = false;
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
    if (!assets || (!assets.bg && !assets.fg)) continue;
    let inst = _inst.get(e);
    if (!inst) inst = createInstance(e, assets, prov);
    inst.frame = _frame;
    // poza: początek ciała i kąt jak skóra sprite'a (hexShips3D.updateBeamSkinMesh / modele 3D okrętów)
    const theta = -((Number(e.angle) || 0));
    const c = Math.cos(theta), s = Math.sin(theta);
    const ax = HullBodies.anchorLocalX(hull), ay = HullBodies.anchorLocalY(hull);
    const ex = e.pos ? e.pos.x : e.x, ey = e.pos ? e.pos.y : e.y;
    inst.root.position.set(ex - (c * ax - s * ay), -ey - (s * ax + c * ay), 0);
    inst.root.rotation.set(0, 0, theta);
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
      uv: new THREE.Vector4()
    });
    HullDamageMap.bind(hull.dmgKey, du);
    du.uv.set(hull.pixelPitch / hull.srcWidth, hull.pixelPitch / hull.srcHeight, hull.ny, 0);
    // ciało → układ budowli (lampy, normalne układu)
    prov.root.updateMatrixWorld();
    _inv.copy(prov.root.matrixWorld).invert();
    for (const mesh of inst.meshes) {
      mesh.userData.skin3D = st;
      mesh.userData.dmgSlot = du.uDmgSlot.value;
      mesh.userData.dmgUv = du.uv;
      mesh.userData.dmgWorld = du.uDmgWorld.value;
      mesh.userData.bodyToHub.multiplyMatrices(_inv, mesh.matrixWorld);
    }
    inst.root.visible = true;
    piece.__skinShown = true;
    shown++;
    triangles += assets.triangles;
  }
  // statyka kawałków: schowana, gdy kawałek ma skórę (ruszony) albo nie istnieje w miejscu
  for (const site of worldBodies.sites) {
    const prov = site.render;
    if (!prov?.setSkinned) continue;
    for (const p of site.pieces) {
      const want = p.state === 'live' ? (p.touched && p.__skinShown) : p.state === 'lost';
      if (p.__staticHidden !== want) {
        p.__staticHidden = want;
        prov.setSkinned(p, want);
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
  if ((_frame & 15) === 0) queueBakes();
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
  for (const p of _bakeQueue) { p.__skinQueued = false; p.__skinJob = null; }
  _bakeQueue.length = 0;
}
