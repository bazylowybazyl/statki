// Skóra ciał świata (src/3d/worldBodies3D.js, wariant „skin” grafu budowli — portBuildings3D.tsl.js, wypiek —
// portBuildingSkin3D.js): WGSL budowany w Node przez WGSLNodeBuilder (WebGPURenderer bez init, atrapa kanwy — wzór
// tests/cargoTsl.test.mjs), limity WebGPU, jeden program na BG i FG, wypiek brył kawałka (wszystkie rodzaje, także
// stożki i lampy) w układzie ciała. Obraz (statyka ↔ skóra bez różnicy) sprawdza scripts/webgpu/zniszczenia-gra.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
await import('../src/3d/core3d.js');
const { PirateDryDock3D } = await import('../src/3d/portBuildings/pirateDryDock3D.js');
const { createPirateDryDockLayout } = await import('../src/3d/portBuildings/pirateDryDockLayout.js');
const { portModuleFrame } = await import('../src/3d/portBuildings/portModuleTraffic.js');
const { PB_STRIDE } = await import('../src/3d/portBuildings/portBuildingScene.js');
const { bakeBuildingChunkSkin, buildingSkinWarmGeometry } = await import('../src/3d/portBuildings/portBuildingSkin3D.js');
const { hullSkinLattice } = await import('../src/3d/ships3d/hullSkin3D.js');
const { HullBodies } = await import('../src/game/hullBodies.js');
const { WORLD_BODY_TUNE } = await import('../src/game/worldBodies.js');
const { dryDockChunkRaster } = await import('../src/game/story/pirateDryDockBodies.js');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;

function buildWGSL(material, geometry) {
  const mesh = new THREE.Mesh(geometry, material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
function vertexBuffers(geometry) {
  const set = new Set();
  for (const a of Object.values(geometry.attributes)) set.add(a.isInterleavedBufferAttribute ? a.data : a);
  return set.size;
}

const layout = createPirateDryDockLayout();
const dock = new PirateDryDock3D({ layout, frame: portModuleFrame(0, 0, 0), name: 'test' });

test('wariant „skin”: graf budowli buduje się w BG i FG, w limitach WebGPU, jeden program na oba zestawy', () => {
  const geo = buildingSkinWarmGeometry();
  assert.ok(vertexBuffers(geo) <= 8, `bufory wierzchołków: ${vertexBuffers(geo)}`);
  const bg = buildWGSL(dock.skinMaterial('bg'), geo);
  const fg = buildWGSL(dock.skinMaterial('fg'), geo);
  for (const w of [bg, fg]) {
    assert.ok(uniformBuffers(w.vertex) <= 12, `uniformy wierzchołków: ${uniformBuffers(w.vertex)}`);
    assert.ok(uniformBuffers(w.fragment) <= 12, `uniformy fragmentów: ${uniformBuffers(w.fragment)}`);
    assert.match(w.vertex, /aLat/);
    assert.match(w.vertex, /aOwn/);
  }
  assert.equal(bg.vertex, fg.vertex, 'ten sam graf — ten sam program wierzchołków');
  assert.equal(bg.fragment, fg.fragment, 'ten sam graf — ten sam program fragmentów');
  assert.equal(dock.skinMaterial('fg'), dock.skinMaterial('fg'), 'materiał raz na zestaw');
});

test('wypiek: wszystkie bryły grupy kawałka (pudła, walce, stożki, lampy), komórki właściciela w kratownicy, podział wg rodzaju', () => {
  const r = dryDockChunkRaster(layout, dock.scene, 'Q-W');
  assert.ok(r, 'raster pylonu');
  // ciało jak w worldBodies._buildPiece (kotwica środka obrazu — z prawdziwego kadłuba)
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, radius: 0, mass: 0, visual: { spriteScale: r.upp, spriteScaleX: r.upp, spriteScaleY: r.upp, spriteRotation: 0 } };
  const hull = HullBodies.createHull(e, r.image, { cellPx: WORLD_BODY_TUNE.cellSize / r.upp, anchored: true });
  const structure = HullBodies.structureFor(r.image, r.upp, WORLD_BODY_TUNE.cellSize / r.upp);
  const lat = hullSkinLattice(structure, hull.anchorDX, hull.anchorDY);
  HullBodies.release(e);
  const group = layout.chunkById.get('Q-W').group;
  // bryły grupy w scenie: stożki (kolce) i lampy (materiał świecący) też mają być w skórze
  let cones = 0, lamps = 0;
  for (const set of ['bg', 'fg']) {
    const S = dock.scene.sets[set];
    for (const kind of Object.keys(S)) {
      const a = S[kind];
      for (let i = 0; i < a.length; i += PB_STRIDE) {
        if (a[i + 12] !== group) continue;
        if (kind === 'cone') cones++;
        const m = a[i + 7];
        if (m > 13.5 && m < 19.5) lamps++;
      }
    }
  }
  assert.ok(cones > 0 && lamps > 0, `kolce ${cones}, lampy ${lamps}`);
  const fine = bakeBuildingChunkSkin(dock, group, { cx: r.cx, cz: r.cz, lattice: lat, maxEdgeCells: 2 });
  const coarse = bakeBuildingChunkSkin(dock, group, { cx: r.cx, cz: r.cz, lattice: lat, maxEdgeCells: 6 });
  assert.ok(fine.fg && fine.triangles > 0, 'zestaw FG');
  assert.ok(coarse.triangles < fine.triangles, `rzadszy podział: ${coarse.triangles} < ${fine.triangles}`);
  // materiał świecący w atrybucie aPbA.w (lampy dotarły do skóry), właściciel w obrębie kratownicy
  const A = fine.fg.attributes.aPbA, O = fine.fg.attributes.aOwn;
  let lit = 0;
  for (let i = 0; i < A.count; i++) {
    const m = A.getW(i);
    if (m > 13.5 && m < 19.5) lit++;
    const ox = O.getX(i), oy = O.getY(i);
    assert.ok(ox >= 0 && oy >= 0 && ox < lat.dims.x && oy < lat.dims.y, `właściciel w kratownicy: ${ox}, ${oy}`);
    assert.equal(lat.occ[ox + oy * lat.dims.x], 1, 'właściciel to komórka konstrukcji');
  }
  assert.ok(lit > 0, 'wierzchołki lamp w skórze');
});

test('odłam rysuje PODZBIÓR trójkątów skóry kawałka (indeks na wspólnych atrybutach), bez dziur', async () => {
  const { fragmentSkinSubset } = await import('../src/3d/worldBodies3D.js');
  const r = dryDockChunkRaster(layout, dock.scene, 'H-W1');
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, radius: 0, mass: 0, visual: { spriteScale: r.upp, spriteScaleX: r.upp, spriteScaleY: r.upp, spriteRotation: 0 } };
  const hull = HullBodies.createHull(e, r.image, { cellPx: WORLD_BODY_TUNE.cellSize / r.upp });
  const structure = HullBodies.structureFor(r.image, r.upp, WORLD_BODY_TUNE.cellSize / r.upp);
  const lat = hullSkinLattice(structure, hull.anchorDX, hull.anchorDY);
  const skin = bakeBuildingChunkSkin(dock, layout.chunkById.get('H-W1').group, { cx: r.cx, cz: r.cz, lattice: lat, maxEdgeCells: 4 });
  const triCount = (g) => (g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);
  const geo = triCount(skin.fg) >= triCount(skin.bg) ? skin.fg : skin.bg;
  // skóra kawałka z indeksem (wypiek 2026-10-15: wierzchołki wspólne trójkątów podziału); trójkąt t = wierzchołki I[3t..3t+2]
  const I = geo.index ? geo.index.array : null;
  const vtx = (t, v) => (I ? I[3 * t + v] : 3 * t + v);
  const full = triCount(geo);
  window.wrecks.length = 0;
  const res = HullBodies.shatter(e, 0, 0, 0.5, { cells: 6, crackDebris: 0.3, debrisFrac: 0.05, debrisSpeed: [60, 120], cuts: 0, chords: 0, minFragmentNodes: 20 });
  const frags = [res.wreck, ...window.wrecks.filter((w) => w !== res.wreck)].filter((w) => w?.beamHull?.body?.activeNodes > 0);
  assert.ok(frags.length >= 3, `odłamy: ${frags.length}`);
  const own = geo.attributes.aOwn, nx = lat.dims.x;
  const covered = new Uint8Array(full);
  let sum = 0;
  for (const w of frags) {
    const body = w.beamHull.body, s = body.nodeStore;
    const sub = fragmentSkinSubset(geo, body, lat);
    assert.ok(sub && sub.index, 'geometria z indeksem');
    assert.equal(sub.attributes.aLat, geo.attributes.aLat, 'atrybuty wspólne (te same bufory GPU)');
    const n = sub.index.count / 3;
    assert.ok(n < full, `podzbiór ${n} < ${full}`);
    sum += n;
    // każdy trójkąt, którego kotwica (aOwn) jest żywą komórką odłamu, jest w podzbiorze
    const alive = new Set();
    for (let i = 0; i < s.count; i++) if (s.active[i]) alive.add(s.ix[i] + s.iy[i] * nx);
    // trójkąty podzbioru po trzech wierzchołkach (podzbiór kopiuje trójki indeksu kawałka)
    const subTris = new Set();
    for (let k = 0; k < sub.index.count; k += 3) subTris.add(`${sub.index.array[k]},${sub.index.array[k + 1]},${sub.index.array[k + 2]}`);
    for (let t = 0; t < full; t++) {
      for (let v = 0; v < 3; v++) {
        const j = vtx(t, v);
        if (alive.has(own.getX(j) + own.getY(j) * nx)) {
          assert.ok(subTris.has(`${vtx(t, 0)},${vtx(t, 1)},${vtx(t, 2)}`), `trójkąt ${t} odłamu poza podzbiorem`);
          covered[t] = 1;
        }
      }
    }
  }
  assert.ok(sum < full * 1.8, `suma podzbiorów ${sum} przy ${full} trójkątach kawałka (${frags.length} odłamów)`);
  for (const w of frags) HullBodies.release(w);
});

test('połówka bryły 3D bez rysunku, gdy sfera egzemplarza leży cała po drugiej stronie płaszczyzny gry', async () => {
  const { halfReachesPlane } = await import('../src/3d/worldBodies3D.js');
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  root.add(mesh);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(30, -20, 40), 100);
  // poza ciała jak w syncWorldBodies3D (korzeń egzemplarza: pozycja w świecie, kwaternion) → [rysuje „nad”, rysuje „pod”]
  const at = (z, quat = null) => {
    root.position.set(5.2e6, -3.1e6, z);
    if (quat) root.quaternion.copy(quat); else root.quaternion.identity();
    root.updateMatrixWorld(true);
    mesh.userData.clipZ = new THREE.Vector2(1, 0);
    const nad = halfReachesPlane(mesh);
    mesh.userData.clipZ = new THREE.Vector2(-1, 0);
    return [nad, halfReachesPlane(mesh)];
  };
  assert.deepEqual(at(-24000), [false, true], 'odłam na planetoidzie: połówka FG bez fragmentu');
  assert.deepEqual(at(5000), [true, false], 'nad płaszczyzną: połówka BG bez fragmentu');
  assert.deepEqual(at(-100), [true, true], 'sfera przecina płaszczyznę');
  // styk (z środka + r = 0): fragment przy z = 0 przechodzi cięcie (≥), więc połówka zostaje
  assert.deepEqual(at(-140), [true, true]);
  assert.deepEqual(at(-140.5), [false, true]);
  // obrót ciała przenosi środek sfery: (30, −20, 40) po 180° wokół x → z −40
  const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  assert.deepEqual(at(-61, flip), [false, true]);
  assert.deepEqual(at(-59, flip), [true, true]);
});

test('skóra sprite\'a kadłubów pomija ciała świata, a worker zna kawałek lustra przed kadłubami', () => {
  // Odłamy bazy piratów dostawały w pudle rozgrzania skórę sprite'a z rastrem kawałka zamiast obrazu: tekstura,
  // partia, slot i wypiek mapy powierzchni (HullSurface — createImageBitmap / drawImage rastra) — ostrzeżenie na każdy
  // kawałek; w workerze dodatkowo w pierwszej klatce lustra (hull.world dopisywała replika dopiero po kadłubach).
  const hex = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
  const create = hex.slice(hex.indexOf('function createBeamSkinMesh('), hex.indexOf('function rebuildBeamSkinGeometry('));
  assert.match(create, /if \(hull\.world\) return null;/, 'createBeamSkinMesh: ciało świata bez skóry sprite\'a');
  const wk = readFileSync(new URL('../src/render/render.worker.js', import.meta.url), 'utf8');
  const page = wk.indexOf('function renderPage(');
  const sync = wk.indexOf('syncWorldBodiesReplica(v, rm, L)', page);
  const hulls = wk.indexOf('hex.updateHexShips3D(', page);
  assert.ok(page > 0 && sync > 0 && hulls > 0 && sync < hulls, 'renderPage: replika ciał świata (hull.world luster) przed updateHexShips3D');
});

// ── Odłamy w workerze i ukryty dostawca (2026-10-28, zgłoszenie „upadek bazy i wyjście z warpa dławią GPU”) ─────────
function shatteredPiece(chunkId = 'H-W1') {
  const r = dryDockChunkRaster(layout, dock.scene, chunkId);
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0.3, angVel: 0, radius: 0, mass: 0, visual: { spriteScale: r.upp, spriteScaleX: r.upp, spriteScaleY: r.upp, spriteRotation: 0 } };
  const hull = HullBodies.createHull(e, r.image, { cellPx: WORLD_BODY_TUNE.cellSize / r.upp });
  const structure = HullBodies.structureFor(r.image, r.upp, WORLD_BODY_TUNE.cellSize / r.upp);
  const lat = hullSkinLattice(structure, hull.anchorDX, hull.anchorDY);
  const group = layout.chunkById.get(chunkId).group;
  const skin = bakeBuildingChunkSkin(dock, group, { cx: r.cx, cz: r.cz, lattice: lat, maxEdgeCells: 4 });
  window.wrecks.length = 0;
  const res = HullBodies.shatter(e, 0, 0, 0.5, { cells: 6, crackDebris: 0.3, debrisFrac: 0.05, debrisSpeed: [60, 120], cuts: 0, chords: 0, minFragmentNodes: 20 });
  const frags = [res.wreck, ...window.wrecks.filter((w) => w !== res.wreck)].filter((w) => w?.beamHull?.body?.activeNodes > 0);
  return { r, lat, skin, group, frags };
}

// Miejsce z kawałkiem straconym (gotowa skóra) na sztucznym źródle ciał świata; odłamy-wraki dziedziczą rekord kawałka
// (hull.world). `state.hidden` — ukrycie dostawcy (soczewka skoku gracza, mgła wojny).
function lostPieceSource(W3, chunkId, state = { hidden: false }) {
  const { r, lat, skin, group, frags } = shatteredPiece(chunkId);
  const prov = {
    building: dock, root: dock.root, layers: { bg: 1, fg: 2 }, hidden: () => state.hidden,
    setSkinned() {}, setHold() {}, groupOf: () => group, rasterCenter: () => ({ x: r.cx, z: r.cz })
  };
  const site = { render: prov, pieces: [] };
  const piece = { id: chunkId, site, state: 'lost', touched: true, entity: null, solid3D: false,
    __skin: { key: r.image, lat, bg: skin.bg, fg: skin.fg, triangles: skin.triangles, solid: false } };
  site.pieces.push(piece);
  for (const w of frags) w.beamHull.world = piece;
  W3.setWorldBodiesSource({ sites: [site], focus: [], renderEntities: () => frags });
  return { skin, frags };
}

test('worker: odłam bez stanu węzłów lustra jest schowany i czeka na węzły (nie rysuje pełnej skóry kawałka na stałe)', async () => {
  const W3 = await import('../src/3d/worldBodies3D.js');
  const { Core3D } = await import('../src/3d/core3d.js');
  if (!Core3D.scene) Core3D.scene = new THREE.Scene();
  const { frags } = lostPieceSource(W3, 'Q-W');
  assert.ok(frags.length >= 3, `odłamy: ${frags.length}`);
  // frags[0] — lustro w workerze, którego węzły jeszcze nie doszły (ciało spoza pudła rozgrzania: topologia
  // i `activeNodes`, `active` puste)
  const late = frags[0].beamHull.body;
  const lateActive = late.nodeStore.active.slice();
  late.nodeStore.active.fill(0);
  late.nodesReceived = false;
  const S = W3.WORLD_SKIN_STATS;
  const waits0 = S.subsetWaits;
  try {
    for (let i = 0; i < 400 && S.subsetWait < 1; i++) W3.syncWorldBodies3D();
    W3.syncWorldBodies3D();
    assert.equal(S.subsetWait, 1, 'odłam bez węzłów lustra czeka');
    assert.equal(S.subsetWaits - waits0, 1);
    assert.equal(S.noNodes, 1, 'schowany (pole skóry miałoby wszystkie komórki martwe)');
    assert.equal(S.shown, frags.length - 1, 'reszta odłamów rysowana');
    const subs0 = S.subsets;
    for (let i = 0; i < 5; i++) W3.syncWorldBodies3D();
    assert.equal(S.subsetWaits - waits0, 1, 'bez prób przed dojściem węzłów');
    assert.equal(S.subsets, subs0, 'podzbiór nie liczy się od nowa w każdej klatce');
    // węzły doszły (strona migawki z węzłami ciała): podzbiór od nowa, odłam rysowany
    late.nodeStore.active.set(lateActive);
    late.nodesReceived = true;
    for (let i = 0; i < 400 && (S.subsetWait > 0 || S.subsets === subs0); i++) W3.syncWorldBodies3D();
    W3.syncWorldBodies3D();
    assert.equal(S.subsetWait, 0, 'nikt nie czeka');
    assert.ok(S.subsets > subs0, 'podzbiór odłamu policzony po dojściu węzłów');
    assert.equal(S.noNodes, 0);
    assert.equal(S.shown, frags.length, 'odłam z węzłami rysowany');
  } finally {
    late.nodeStore.active.set(lateActive);
    delete late.nodesReceived;
    W3.resetWorldBodies3D();
    W3.setWorldBodiesSource(null);
    for (const w of frags) HullBodies.release(w);
  }
  assert.equal(S.subsetWait, 0);
});

test('ukryty dostawca (soczewka skoku, mgła) utrzymuje egzemplarze dłużej niż 600 klatek — po skoku bez ponownych podzbiorów', async () => {
  const W3 = await import('../src/3d/worldBodies3D.js');
  const { Core3D } = await import('../src/3d/core3d.js');
  if (!Core3D.scene) Core3D.scene = new THREE.Scene();
  const state = { hidden: false };
  const { frags } = lostPieceSource(W3, 'Q-W', state);
  const S = W3.WORLD_SKIN_STATS, O = W3.WORLD_SKIN_OPTIONS;
  try {
    for (let i = 0; i < 400 && (S.shown < frags.length || S.subsets === 0); i++) W3.syncWorldBodies3D();
    for (let i = 0; i < 200; i++) W3.syncWorldBodies3D();   // kolejka podzbiorów do końca
    assert.equal(S.shown, frags.length);
    const subs0 = S.subsets;
    // skok gracza: 700 klatek workera (2,9 s przy 240 Hz) ukrycia — egzemplarze zostają, schowane
    state.hidden = true;
    for (let i = 0; i < 700; i++) W3.syncWorldBodies3D();
    assert.equal(S.shown, 0, 'nic nie rysuje się w ukryciu');
    assert.equal(S.hiddenKept, frags.length, 'egzemplarze utrzymane');
    assert.equal(S.instances, frags.length);
    // wyjście ze skoku: od razu rysowane, bez ponownych podzbiorów (dawniej: egzemplarze, wypieki i podzbiory od nowa)
    state.hidden = false;
    W3.syncWorldBodies3D();
    assert.equal(S.shown, frags.length, 'od razu po wyjściu');
    assert.equal(S.subsets, subs0, 'bez ponownych podzbiorów');
    // A/B dawnego zachowania: hiddenKeep = false — po 600 klatkach ukrycia egzemplarze zwolnione
    O.hiddenKeep = false;
    state.hidden = true;
    for (let i = 0; i < 700; i++) W3.syncWorldBodies3D();
    assert.equal(S.instances, 0, 'dawniej: zwolnione w skoku');
  } finally {
    O.hiddenKeep = true;
    W3.resetWorldBodies3D();
    W3.setWorldBodiesSource(null);
    for (const w of frags) HullBodies.release(w);
  }
});
