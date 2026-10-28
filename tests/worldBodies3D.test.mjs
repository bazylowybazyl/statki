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

// Rozpad Z ZIARNEM (2026-10-28): liczbę odłamów shatter losuje Math.random (ziarna Voronoi i odpryski szwów —
// voronoiFracture w hullBodies.js, potem kruszenie odłamów < minFragmentNodes). Bez ziarna kawałek Q-W (dwa rozłączne
// bloki 10 × 10 komórek) dawał 1–6 odłamów i warunki „odłamy ≥ 3” padały w ~15% rozbić — niezależnie od obciążenia.
// Ziarno TYLKO na czas rozpadu: ten sam strumień zużywają uuid obiektów three.js, a ich liczba zależy od budżetów ms
// renderu w poprzednich testach. LCG jak withSeededRandom w tests/helpers/beamShotHarness.mjs (tamten moduł ciągnie
// index.html); ziarno 1: H-W1 — 6 odłamów, Q-W — 5.
function withSeededRandom(seed, fn) {
  const saved = Math.random;
  let s = seed >>> 0;
  Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  try { return fn(); } finally { Math.random = saved; }
}
const SHATTER_SEED = 1;

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
  const entity = () => ({ x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, radius: 0, mass: 0, visual: { spriteScale: r.upp, spriteScaleX: r.upp, spriteScaleY: r.upp, spriteRotation: 0 } });
  const structure = HullBodies.structureFor(r.image, r.upp, WORLD_BODY_TUNE.cellSize / r.upp);
  const triCount = (g) => (g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);
  let lat = null, geo = null, I = null, full = 0;
  const vtx = (t, v) => (I ? I[3 * t + v] : 3 * t + v);
  // Kilka STAŁYCH ziaren rozpadu (2026-10-28): odłamy losują ziarna Voronoi — „bez dziur” na 8 różnych podziałach,
  // powtarzalnie (bez ziarna każdy przebieg sprawdzał jeden przypadkowy podział).
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const e = entity();
    const hull = HullBodies.createHull(e, r.image, { cellPx: WORLD_BODY_TUNE.cellSize / r.upp });
    if (!lat) {
      lat = hullSkinLattice(structure, hull.anchorDX, hull.anchorDY);
      const skin = bakeBuildingChunkSkin(dock, layout.chunkById.get('H-W1').group, { cx: r.cx, cz: r.cz, lattice: lat, maxEdgeCells: 4 });
      geo = triCount(skin.fg) >= triCount(skin.bg) ? skin.fg : skin.bg;
      // skóra kawałka z indeksem (wypiek 2026-10-15: wierzchołki wspólne trójkątów podziału); trójkąt t = wierzchołki I[3t..3t+2]
      I = geo.index ? geo.index.array : null;
      full = triCount(geo);
    }
    window.wrecks.length = 0;
    const res = withSeededRandom(seed, () => HullBodies.shatter(e, 0, 0, 0.5, { cells: 6, crackDebris: 0.3, debrisFrac: 0.05, debrisSpeed: [60, 120], cuts: 0, chords: 0, minFragmentNodes: 20 }));
    const frags = [res.wreck, ...window.wrecks.filter((w) => w !== res.wreck)].filter((w) => w?.beamHull?.body?.activeNodes > 0);
    try {
      assert.ok(frags.length >= 3, `ziarno ${seed}: odłamy: ${frags.length}`);
      const own = geo.attributes.aOwn, nx = lat.dims.x;
      let sum = 0;
      for (const w of frags) {
        const body = w.beamHull.body, s = body.nodeStore;
        const sub = fragmentSkinSubset(geo, body, lat);
        assert.ok(sub && sub.index, 'geometria z indeksem');
        assert.equal(sub.attributes.aLat, geo.attributes.aLat, 'atrybuty wspólne (te same bufory GPU)');
        const n = sub.index.count / 3;
        assert.ok(n < full, `ziarno ${seed}: podzbiór ${n} < ${full}`);
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
              assert.ok(subTris.has(`${vtx(t, 0)},${vtx(t, 1)},${vtx(t, 2)}`), `ziarno ${seed}: trójkąt ${t} odłamu poza podzbiorem`);
            }
          }
        }
      }
      assert.ok(sum < full * 1.8, `ziarno ${seed}: suma podzbiorów ${sum} przy ${full} trójkątach kawałka (${frags.length} odłamów)`);
    } finally {
      for (const w of frags) HullBodies.release(w);
    }
  }
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

// ── PARTIE skór ciał świata (src/3d/worldSkinBatch.js, 2026-10-27) ──────────────────────────────────────────────
const mainOf = (src) => src.slice(src.indexOf('fn main('));
// zmienna WGSL czytana, zanim cokolwiek ją przypisało (pułapki 36, 39 — wzór tests/hullCloakTSL.test.mjs)
function useBeforeAssign(src) {
  const main = mainOf(src);
  const body = main.slice(main.indexOf('// code'));
  const assigned = new Set();
  const bad = [];
  for (const line of body.split('\n')) {
    const lhs = line.match(/^\s*(nodeVar\d+) = /);
    const rhs = lhs ? line.slice(line.indexOf('=') + 1) : line;
    for (const m of rhs.matchAll(/\bnodeVar\d+\b/g)) if (!assigned.has(m[0])) bad.push(`${m[0]}: ${line.trim().slice(0, 90)}`);
    if (lhs) assigned.add(lhs[1]);
  }
  return bad;
}

test('partia skór: wariant grafu w limitach WebGPU, slot z instance_index, flagi przed gałęzią, połówki jednym programem', async () => {
  const { WS } = await import('../src/3d/worldSkinBatch.js');
  // partia rysuje na atrybutach skóry kawałka (z indeksem) — ten sam układ co odłam bez partii
  const geo = buildingSkinWarmGeometry(true);
  const storageBuffers = (wgsl) => (wgsl.match(/var<storage/g) || []).length;
  const flat = buildWGSL(dock.skinBatchMaterial('bg', false, 0), geo);
  const pod = buildWGSL(dock.skinBatchMaterial('bg', true, 0), geo);
  const nad = buildWGSL(dock.skinBatchMaterial('fg', true, 1), geo);
  for (const w of [flat, pod, nad]) {
    assert.ok(uniformBuffers(w.vertex) <= 12 && uniformBuffers(w.fragment) <= 12, 'uniformy na etap');
    assert.ok(storageBuffers(w.vertex) <= 8 && storageBuffers(w.fragment) <= 8, 'bufory storage na etap');
    assert.match(w.vertex, /@builtin\( instance_index \) instanceIndex/, 'slot z instance_index (firstInstance rekordu)');
    const v = mainOf(w.vertex);
    assert.match(v, /= instanceIndex;/, 'slot egzemplarza z instance_index');
    // flagi widoczności (WS.FLAGS) czytane PRZED gałęzią widoczności, FFD w gałęzi
    const flags = v.search(new RegExp(`worldSkinStore\\.value\\[ \\( nodeVar\\d+ \\+ ${WS.FLAGS}u \\) \\]`));
    const branch = v.indexOf('if ( ( dot(');
    assert.ok(flags > 0 && branch > flags, 'flagi przed gałęzią');
    assert.ok(v.indexOf('hullSkin3DField', branch) > branch && v.lastIndexOf('hullSkin3DField', branch) < 0, 'FFD tylko w gałęzi');
    assert.deepEqual(useBeforeAssign(w.vertex), [], 'wierzchołki: zmienne przypisane przed użyciem');
    assert.deepEqual(useBeforeAssign(w.fragment), [], 'fragmenty: zmienne przypisane przed użyciem');
    assert.match(mainOf(w.fragment), /round\( vPbSkinSlot \)/, 'fragment: slot z varyingu');
  }
  assert.equal(pod.vertex, nad.vertex, 'połówki bryły i zestawy — jeden program wierzchołków');
  assert.equal(pod.fragment, nad.fragment, 'połówki bryły i zestawy — jeden program fragmentów');
  // ścieżka bez partii (siatka egzemplarza) bez bufora partii i bez instance_index
  const own = buildWGSL(dock.skinMaterial('bg'), geo);
  assert.doesNotMatch(own.vertex + own.fragment, /worldSkinStore|instance_index/);
  assert.equal(dock.skinBatchMaterial('fg', true, 1), dock.skinBatchMaterial('fg', true, 1), 'materiał raz na połówkę');
  assert.deepEqual(dock.skinBatchMaterial('fg', true, 1).uniforms.uSkinFlag.value.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(dock.skinBatchMaterial('bg', true, 0).uniforms.uSkinClip.value.toArray(), [-1, 0]);
  assert.deepEqual(dock.skinBatchMaterial('fg', false, 0).uniforms.uSkinClip.value.toArray(), [0, 0]);
});

// Kawałek doku po rozpadzie: skóra (wypiek w wątku testu), odłamy shatter — wspólne dla testów partii.
function shatteredPiece(chunkId = 'H-W1') {
  const r = dryDockChunkRaster(layout, dock.scene, chunkId);
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0.3, angVel: 0, radius: 0, mass: 0, visual: { spriteScale: r.upp, spriteScaleX: r.upp, spriteScaleY: r.upp, spriteRotation: 0 } };
  const hull = HullBodies.createHull(e, r.image, { cellPx: WORLD_BODY_TUNE.cellSize / r.upp });
  const structure = HullBodies.structureFor(r.image, r.upp, WORLD_BODY_TUNE.cellSize / r.upp);
  const lat = hullSkinLattice(structure, hull.anchorDX, hull.anchorDY);
  const group = layout.chunkById.get(chunkId).group;
  const skin = bakeBuildingChunkSkin(dock, group, { cx: r.cx, cz: r.cz, lattice: lat, maxEdgeCells: 4 });
  window.wrecks.length = 0;
  const res = withSeededRandom(SHATTER_SEED, () => HullBodies.shatter(e, 0, 0, 0.5, { cells: 6, crackDebris: 0.3, debrisFrac: 0.05, debrisSpeed: [60, 120], cuts: 0, chords: 0, minFragmentNodes: 20 }));
  const frags = [res.wreck, ...window.wrecks.filter((w) => w !== res.wreck)].filter((w) => w?.beamHull?.body?.activeNodes > 0);
  return { r, e, hull, lat, skin, group, frags };
}

// Miejsce z kawałkiem straconym (gotowa skóra) na sztucznym źródle ciał świata; odłamy-wraki dziedziczą rekord kawałka
// (hull.world) — testy partii w klatce.
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

// Klatki workera aż do STANU (najwyżej `max`; 2026-10-28): ile klatek trzeba, zależy od budżetu podzbiorów (SUBSET_MS
// czasu rzeczywistego na klatkę — wolna albo zajęta maszyna liczy kolejkę dłużej), więc testy czekają na stan, nie na
// stałą liczbę klatek. Najpierw klatka, potem warunek: liczniki klatki (WORLD_SKIN_STATS) po resecie poprzedniego
// testu są nieaktualne do pierwszej synchronizacji.
// Warunek wstępny testów partii: za mało odłamów (np. inne zużycie Math.random w shatter przy tym samym ziarnie) —
// sprzątnij źródło ciał świata i ciała, zanim asercja przerwie test (podpięte zostałyby dla kolejnych testów).
function requireFrags(W3, frags, n) {
  if (frags.length >= n) return;
  if (W3) { W3.resetWorldBodies3D(); W3.setWorldBodiesSource(null); }
  for (const w of frags) HullBodies.release(w);
  assert.fail(`odłamy: ${frags.length} (potrzeba ≥ ${n})`);
}

function syncUntil(W3, done, max = 400) {
  for (let i = 0; i < max; i++) {
    W3.syncWorldBodies3D();
    if (done()) return;
  }
}

test('partia skór: odłam = indeks podzbioru na atrybutach skóry kawałka + rekord rysunku pośredniego, miejsce po wpisie wraca', async () => {
  const { WorldSkinBatch, SKIN_BATCH_RECORD, SKIN_BATCH_STATS } = await import('../src/3d/worldSkinBatch.js');
  const { fragmentSkinSubset } = await import('../src/3d/worldBodies3D.js');
  const { skin, lat, frags } = shatteredPiece();
  requireFrags(null, frags, 3);
  const tris = (g) => (g ? g.index.count / 3 : 0);
  const geo = tris(skin.fg) >= tris(skin.bg) ? skin.fg : skin.bg;
  const halves = [{ material: dock.skinBatchMaterial('bg', true, 0), layer: 1 }, { material: dock.skinBatchMaterial('bg', true, 1), layer: 2 }];
  const batch = new WorldSkinBatch({ source: geo, set: 'bg', solid: true, halves });
  // siatki połówek na WSPÓLNYCH atrybutach skóry kawałka, wspólny indeks i rekordy, osobne listy rysunków
  for (const p of batch.parts) {
    assert.equal(p.geometry.attributes.aLat, geo.attributes.aLat, 'atrybuty skóry kawałka (bez kopii wierzchołków)');
    assert.equal(p.geometry.index, batch.aIdx);
    assert.equal(p.geometry.indirect, batch.aRec);
    assert.equal(p.geometry.indirectOffset, p.offsets);
  }
  assert.notEqual(batch.parts[0].offsets, batch.parts[1].offsets, 'połówki — osobne listy rysunków');
  const entries = frags.map((w, i) => {
    const sub = fragmentSkinSubset(geo, w.beamHull.body, lat);
    const entry = batch.add(10 + i, sub);
    assert.ok(entry && entry.alive, 'wpis');
    assert.equal(entry.iCount, sub.index.count);
    assert.deepEqual([...batch.idx.subarray(entry.iStart, entry.iStart + entry.iCount)], [...sub.index.array.subarray(0, sub.index.count)],
      'indeks wpisu = indeks podzbioru (numery wierzchołków skóry kawałka)');
    const o = entry.rec * SKIN_BATCH_RECORD;
    assert.deepEqual([...batch.recs.subarray(o, o + SKIN_BATCH_RECORD)], [entry.iCount, 1, entry.iStart, 0, 10 + i],
      'rekord: liczba indeksów, 1 instancja, początek, wierzchołek 0, firstInstance = slot');
    assert.equal(entry.offset, o * 4, 'przesunięcie rekordu w bajtach');
    return entry;
  });
  // rysunki klatki: połówka „pod” — dwa wpisy w podanej kolejności, „nad” — żaden (siatka schowana)
  assert.equal(batch.setDraws(0, [entries[2], entries[0]], 2, null), 1);
  assert.deepEqual(batch.parts[0].offsets, [entries[2].offset, entries[0].offset]);
  assert.ok(batch.parts[0].mesh.visible);
  assert.equal(batch.setDraws(1, [], 0, null), 0);
  assert.ok(!batch.parts[1].mesh.visible);
  // usunięty wpis: znika z list rysunków, miejsce w indeksie i rekord wracają
  const gone = entries[0];
  batch.remove(gone);
  assert.deepEqual(batch.parts[0].offsets, [entries[2].offset], 'usunięty wpis bez rysunku');
  const again = batch.add(99, fragmentSkinSubset(geo, frags[0].beamHull.body, lat));
  assert.equal(again.iStart, gone.iStart, 'indeks w zwolnionym miejscu');
  assert.equal(again.rec, gone.rec, 'zwolniony rekord');
  // wzrost indeksu: siatki połówek dostają nowy bufor indeksu
  const icap0 = batch.icap;
  const keep = [...batch.idx.subarray(entries[2].iStart, entries[2].iStart + entries[2].iCount)];
  const big = { index: { count: icap0, array: new Uint32Array(icap0) }, drawRange: { count: Infinity } };
  const e2 = batch.add(7, big);
  assert.ok(e2 && batch.icap > icap0, `indeks partii urósł: ${icap0} → ${batch.icap}`);
  for (const p of batch.parts) assert.equal(p.geometry.index, batch.aIdx, 'nowy indeks w siatkach połówek');
  assert.deepEqual([...batch.idx.subarray(entries[2].iStart, entries[2].iStart + entries[2].iCount)], keep, 'wpisy przeniesione do większego indeksu');
  const n0 = SKIN_BATCH_STATS.entries, k = batch.entries.length;
  batch.dispose();
  assert.equal(SKIN_BATCH_STATS.entries, n0 - k, 'statystyki wpisów po zwolnieniu partii');
  for (const w of frags) HullBodies.release(w);
});

test('partia skór w klatce: odłamy w partii, rysunki i macierz model-widok z haka passa, A/B własnymi siatkami', async () => {
  const W3 = await import('../src/3d/worldBodies3D.js');
  const { Core3D } = await import('../src/3d/core3d.js');
  const { WorldSkinStore, WORLD_SKIN_SLOT_VEC4, WS, SKIN_BATCH_STATS } = await import('../src/3d/worldSkinBatch.js');
  if (!Core3D.scene) Core3D.scene = new THREE.Scene();
  const { skin, frags } = lostPieceSource(W3, 'Q-W');
  requireFrags(W3, frags, 2);
  const sets = ['bg', 'fg'].filter((s) => skin[s]);
  try {
    const S = W3.WORLD_SKIN_STATS;
    syncUntil(W3, () => S.batchSlots >= frags.length);
    assert.equal(S.batchSlots, frags.length, 'wszystkie odłamy w partii');
    W3.syncWorldBodies3D();
    assert.equal(S.batched, frags.length, 'odłamy rysowane partią');
    assert.equal(S.shownFrag, frags.length);
    assert.equal(SKIN_BATCH_STATS.batches, sets.length, 'partia na zestaw skóry kawałka');
    // egzemplarze schowane (nośniki macierzy i sfer), siatki partii w scenie — na atrybutach skóry kawałka
    const roots = Core3D.scene.children.filter((o) => o.name === 'ciało świata');
    assert.ok(roots.length >= frags.length && roots.every((o) => !o.visible), 'siatki egzemplarzy schowane');
    const parts = Core3D.scene.children.filter((o) => /^ciało świata — partia/.test(o.name));
    assert.equal(parts.length, sets.length, `siatki partii: ${parts.length}`);
    for (const m of parts) assert.ok(m.geometry.indirect && m.geometry.attributes.aLat === skin[m.name.includes('(fg') ? 'fg' : 'bg'].attributes.aLat);
    // hak passa: kamera nad odłamami — wszystkie w kadrze, rysunek na odłam, od najbliższych
    const cam = new THREE.PerspectiveCamera(50, 1.6, 10, 1e7);
    cam.position.set(0, 0, 60000);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const n = W3.commitWorldSkinStore(cam);
    assert.equal(n, sets.length, `obiekty renderu partii: ${n}`);
    for (const m of parts) {
      assert.ok(m.visible);
      assert.equal(m.geometry.indirectOffset.length, frags.length, 'rysunek na odłam');
    }
    const A = WorldSkinStore.array();
    const mv = new THREE.Matrix4();
    // slot egzemplarza z rekordu (firstInstance), dane slotu = wartości siatki egzemplarza
    const m0 = parts[0];
    const R = m0.geometry.indirect.array;
    let prevDepth = -Infinity;
    for (const off of m0.geometry.indirectOffset) {
      const slot = R[off / 4 + 4];
      const o = slot * WORLD_SKIN_SLOT_VEC4 * 4;
      assert.ok(A[o + WS.FLAGS * 4] + A[o + WS.FLAGS * 4 + 2] >= 1, `slot ${slot}: flaga zestawu`);
      const owner = roots.find((root) => root.children.some((m) => m.userData.skin3D && A[o + WS.CMIN * 4 + 3] === m.userData.skin3D.offset));
      assert.ok(owner, `slot ${slot}: egzemplarz o tym slocie pola`);
      const me = owner.children[0];
      mv.multiplyMatrices(cam.matrixWorldInverse, me.matrixWorld);
      for (let q = 0; q < 16; q++) assert.equal(A[o + q], Math.fround(mv.elements[q]), 'macierz model-widok');
      for (let q = 0; q < 16; q++) assert.equal(A[o + WS.HUB * 4 + q], Math.fround(me.userData.bodyToHub.elements[q]), 'ciało → budowla');
      const st = me.userData.skin3D;
      assert.deepEqual([...A.subarray(o + WS.CDIM * 4, o + WS.CDIM * 4 + 4)], [st.cdim.x, st.cdim.y, st.cdim.z, 1]);
      // kolejność od najbliższych: głębokość środka sfery w kamerze rośnie
      const c = new THREE.Vector3().copy(me.boundingSphere.center).applyMatrix4(me.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
      assert.ok(-c.z >= prevDepth - 1e-6, 'rysunki od najbliższych');
      prevDepth = -c.z;
    }
    // poza kadrem: bez rysunków partii
    cam.lookAt(1e7, 0, 60000);
    cam.updateMatrixWorld();
    W3.syncWorldBodies3D();
    assert.equal(W3.commitWorldSkinStore(cam), 0, 'kamera obok — bez rysunków partii');
    assert.ok(parts.every((m) => !m.visible && m.geometry.indirectOffset.length === 0));
    // A/B: własne siatki egzemplarzy, partie bez rysunków
    W3.WORLD_SKIN_OPTIONS.batch = false;
    W3.syncWorldBodies3D();
    W3.commitWorldSkinStore(cam);
    assert.ok(roots.every((o) => o.visible), 'A/B: siatki egzemplarzy widoczne');
    assert.ok(parts.every((m) => !m.visible), 'A/B: partie schowane');
    assert.equal(W3.WORLD_SKIN_STATS.batched, 0);
  } finally {
    W3.WORLD_SKIN_OPTIONS.batch = true;
    W3.resetWorldBodies3D();
    W3.setWorldBodiesSource(null);
    for (const w of frags) HullBodies.release(w);
  }
  assert.equal(SKIN_BATCH_STATS.entries, 0, 'reset: wpisy zwolnione');
  assert.equal(SKIN_BATCH_STATS.batches, 0, 'reset: partie zwolnione');
  assert.ok(!Core3D.scene.children.some((o) => /^ciało świata — partia/.test(o.name)), 'reset: siatki partii poza sceną');
});

test('partia skór w workerze: odłam bez stanu węzłów lustra czeka na węzły i wchodzi do partii (nie zostaje przy pełnej skórze)', async () => {
  const W3 = await import('../src/3d/worldBodies3D.js');
  const { Core3D } = await import('../src/3d/core3d.js');
  const { SKIN_BATCH_STATS } = await import('../src/3d/worldSkinBatch.js');
  if (!Core3D.scene) Core3D.scene = new THREE.Scene();
  const { frags } = lostPieceSource(W3, 'Q-W');
  requireFrags(W3, frags, 3);
  // frags[0] — lustro w workerze, którego węzły jeszcze nie doszły (ciało spoza pudła rozgrzania: topologia i
  // `activeNodes`, `active` puste); frags[1] — ciało gry bez komórek w kratownicy (bez flagi lustra): własne siatki jak dotąd
  const late = frags[0].beamHull.body, empty = frags[1].beamHull.body;
  const lateActive = late.nodeStore.active.slice(), emptyActive = empty.nodeStore.active.slice();
  late.nodeStore.active.fill(0);
  late.nodesReceived = false;
  empty.nodeStore.active.fill(0);
  const S = W3.WORLD_SKIN_STATS;
  const waits0 = S.subsetWaits, noSub0 = S.batchOut.noSubset;
  try {
    // reszta w partii, odłam bez węzłów czeka, ciało gry bez komórek wróciło do własnych siatek, kolejka podzbiorów pusta
    syncUntil(W3, () => S.batchSlots >= frags.length - 2 && S.subsetWait >= 1 && S.batchOut.noSubset !== noSub0 && S.batchQueue === 0);
    W3.syncWorldBodies3D();
    assert.equal(S.subsetWait, 1, 'odłam bez węzłów lustra czeka');
    assert.equal(S.subsetWaits - waits0, 1);
    assert.equal(S.batchQueue, 0, 'podzbiory reszty odłamów policzone');
    assert.equal(S.batchOut.noSubset - noSub0, 1, 'ciało gry bez komórek — własne siatki (jak dotąd)');
    assert.equal(S.batched, frags.length - 2, 'reszta w partii');
    // kolejne klatki bez węzłów: odłam dalej czeka, podzbiór nie liczy się od nowa
    for (let i = 0; i < 5; i++) W3.syncWorldBodies3D();
    assert.equal(S.subsetWait, 1);
    assert.equal(S.subsetWaits - waits0, 1, 'bez prób przed dojściem węzłów');
    // węzły doszły (strona migawki z węzłami ciała): podzbiór od nowa i wpis w partii
    late.nodeStore.active.set(lateActive);
    late.nodesReceived = true;
    syncUntil(W3, () => S.batchSlots >= frags.length - 1);
    W3.syncWorldBodies3D();
    assert.equal(S.subsetWait, 0, 'nikt nie czeka');
    assert.equal(S.batched, frags.length - 1, 'odłam z węzłami w partii');
    assert.equal(S.batchOut.noSubset - noSub0, 1, 'bez nowych powrotów do pełnej skóry');
  } finally {
    late.nodeStore.active.set(lateActive);
    empty.nodeStore.active.set(emptyActive);
    delete late.nodesReceived;
    W3.resetWorldBodies3D();
    W3.setWorldBodiesSource(null);
    for (const w of frags) HullBodies.release(w);
  }
  assert.equal(S.subsetWait, 0);
  assert.equal(SKIN_BATCH_STATS.entries, 0, 'reset: wpisy zwolnione');
});

// ── Odłamy bez węzłów lustra i ukryty dostawca (2026-10-28, zgłoszenie „upadek bazy i wyjście z warpa dławią GPU”) ──
test('worker: odłam bez stanu węzłów lustra jest schowany i czeka na węzły (nie rysuje pełnej skóry kawałka na stałe)', async () => {
  const W3 = await import('../src/3d/worldBodies3D.js');
  const { Core3D } = await import('../src/3d/core3d.js');
  if (!Core3D.scene) Core3D.scene = new THREE.Scene();
  const { skin, frags } = lostPieceSource(W3, 'Q-W');
  requireFrags(W3, frags, 3);
  const sets = ['bg', 'fg'].filter((s) => skin[s]);
  // frags[0] — lustro w workerze, którego węzły jeszcze nie doszły (ciało spoza pudła rozgrzania: topologia
  // i `activeNodes`, `active` puste)
  const late = frags[0].beamHull.body;
  const lateActive = late.nodeStore.active.slice();
  late.nodeStore.active.fill(0);
  late.nodesReceived = false;
  const S = W3.WORLD_SKIN_STATS;
  const waits0 = S.subsetWaits;
  try {
    // Odłam bez węzłów czeka, a podzbiory reszty odłamów policzone: licznik `subsets` jest wspólny dla wszystkich
    // odłamów, więc „bez nowych podzbiorów” mierzy się od pustej kolejki (wolniejsza maszyna liczy ją dłużej niż 2 klatki).
    syncUntil(W3, () => S.subsetWait >= 1 && S.batchQueue === 0);
    W3.syncWorldBodies3D();
    assert.equal(S.subsetWait, 1, 'odłam bez węzłów lustra czeka');
    assert.equal(S.subsetWaits - waits0, 1);
    assert.equal(S.batchQueue, 0, 'podzbiory reszty odłamów policzone');
    assert.equal(S.noNodes, 1, 'schowany (pole skóry miałoby wszystkie komórki martwe)');
    assert.equal(S.shown, frags.length - 1, 'reszta odłamów rysowana');
    const subs0 = S.subsets;
    for (let i = 0; i < 5; i++) W3.syncWorldBodies3D();
    assert.equal(S.subsetWaits - waits0, 1, 'bez prób przed dojściem węzłów');
    // czekający odłam ma podzbiór null (bez licznika `subsets`) — próby pilnuje `subsetWaits` wyżej; tu: kolejka pusta,
    // więc żaden podzbiór nie liczy się w czasie czekania
    assert.equal(S.subsets, subs0, 'bez podzbiorów w czasie czekania na węzły');
    // węzły doszły (strona migawki z węzłami ciała): podzbiór od nowa, odłam rysowany
    late.nodeStore.active.set(lateActive);
    late.nodesReceived = true;
    syncUntil(W3, () => S.subsetWait === 0 && S.batchQueue === 0);
    W3.syncWorldBodies3D();
    assert.equal(S.subsetWait, 0, 'nikt nie czeka');
    // kolejka pusta od subs0 — przybyły tylko podzbiory tego odłamu: jeden na zestaw skóry kawałka
    assert.equal(S.subsets - subs0, sets.length, 'podzbiory odłamu policzone po dojściu węzłów');
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
    // wszystkie rysowane, kolejka podzbiorów do końca (stan, nie stała liczba klatek — budżet SUBSET_MS na klatkę)
    syncUntil(W3, () => S.shown === frags.length && S.batchQueue === 0);
    assert.equal(S.shown, frags.length);
    assert.equal(S.batchQueue, 0, 'podzbiory odłamów policzone');
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
