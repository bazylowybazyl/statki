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

test('partia skór: wariant grafu w limitach WebGPU, slot z aPbN.w, flagi przed gałęzią, połówki jednym programem', async () => {
  const { skinBatchWarmGeometry, WS } = await import('../src/3d/worldSkinBatch.js');
  const geo = skinBatchWarmGeometry();
  assert.equal(vertexBuffers(geo), 1, 'strona partii: jeden bufor wierzchołków z przeplotem');
  const storageBuffers = (wgsl) => (wgsl.match(/var<storage/g) || []).length;
  const flat = buildWGSL(dock.skinBatchMaterial('bg', false, 0), geo);
  const pod = buildWGSL(dock.skinBatchMaterial('bg', true, 0), geo);
  const nad = buildWGSL(dock.skinBatchMaterial('fg', true, 1), geo);
  for (const w of [flat, pod, nad]) {
    assert.ok(uniformBuffers(w.vertex) <= 12 && uniformBuffers(w.fragment) <= 12, 'uniformy na etap');
    assert.ok(storageBuffers(w.vertex) <= 8 && storageBuffers(w.fragment) <= 8, 'bufory storage na etap');
    const v = mainOf(w.vertex);
    assert.match(v, /= aPbN\.w;/, 'slot egzemplarza z aPbN.w');
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
  // ścieżka bez partii (siatka egzemplarza) bez bufora partii
  const own = buildWGSL(dock.skinMaterial('bg'), buildingSkinWarmGeometry(true));
  assert.doesNotMatch(own.vertex + own.fragment, /worldSkinStore/);
  assert.equal(dock.skinBatchMaterial('fg', true, 1), dock.skinBatchMaterial('fg', true, 1), 'materiał raz na stronę');
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
  const res = HullBodies.shatter(e, 0, 0, 0.5, { cells: 6, crackDebris: 0.3, debrisFrac: 0.05, debrisSpeed: [60, 120], cuts: 0, chords: 0, minFragmentNodes: 20 });
  const frags = [res.wreck, ...window.wrecks.filter((w) => w !== res.wreck)].filter((w) => w?.beamHull?.body?.activeNodes > 0);
  return { r, e, hull, lat, skin, group, frags };
}

test('partia skór: kopia podzbioru odłamu — wierzchołki 1:1 ze skórą kawałka, slot w aPbN.w, miejsce po wpisie wraca', async () => {
  const { WorldSkinBatch, SKIN_BATCH_STRIDE, SKIN_BATCH_SLOT, SKIN_BATCH_STATS } = await import('../src/3d/worldSkinBatch.js');
  const { fragmentSkinSubset } = await import('../src/3d/worldBodies3D.js');
  const { skin, lat, frags } = shatteredPiece();
  assert.ok(frags.length >= 3, `odłamy: ${frags.length}`);
  const tris = (g) => (g ? g.index.count / 3 : 0);
  const geo = tris(skin.fg) >= tris(skin.bg) ? skin.fg : skin.bg;
  const batch = new WorldSkinBatch({ set: 'fg', solid: false, halves: [{ material: dock.skinBatchMaterial('fg'), layer: 2 }] });
  const run = (it) => { let r = it.next(); while (!r.done) r = it.next(); return r.value; };
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, IB = geo.attributes.aLat.data;
  const entries = [];
  frags.forEach((w, i) => {
    const sub = fragmentSkinSubset(geo, w.beamHull.body, lat);
    const slot = 10 + i;
    const entry = run(batch.addSteps(slot, sub));
    assert.ok(entry && entry.alive, 'wpis');
    assert.equal(entry.iCount, sub.index.count);
    const page = entry.page, D = page.data;
    for (let k = 0; k < sub.index.count; k++) {
      const v = sub.index.array[k];
      const b = page.idx[entry.iStart + k];
      assert.ok(b >= entry.vStart && b < entry.vStart + entry.vCount, 'indeks w obrębie wpisu');
      const o = b * SKIN_BATCH_STRIDE;
      for (let c = 0; c < 3; c++) {
        assert.equal(D[o + c], P[v * 3 + c], 'pozycja');
        assert.equal(D[o + 3 + c], N[v * 3 + c], 'normalna');
      }
      for (let c = 0; c < 18; c++) {
        if (6 + c === SKIN_BATCH_SLOT) continue;
        assert.equal(D[o + 6 + c], IB.array[v * IB.stride + c], `atrybut skóry ${c}`);
      }
      assert.equal(D[o + SKIN_BATCH_SLOT], slot, 'slot w aPbN.w');
    }
    assert.ok(page.geometry.drawRange.count >= entry.iStart + entry.iCount, 'zakres rysowania obejmuje wpis');
    entries.push(entry);
  });
  assert.equal(batch.pages.length, 1, 'odłamy kawałka w jednej stronie');
  const page = batch.pages[0];
  // usunięty wpis: trójkąty zdegenerowane, miejsce wraca do następnego wpisu (pierwsze dopasowanie)
  const gone = entries[1];
  batch.remove(gone);
  assert.ok(page.idx.subarray(gone.iStart, gone.iStart + gone.iCount).every((x) => x === 0), 'indeks wpisu wyzerowany');
  const again = run(batch.addSteps(99, fragmentSkinSubset(geo, frags[1].beamHull.body, lat)));
  assert.equal(again.iStart, gone.iStart, 'indeks w zwolnionym miejscu');
  assert.equal(again.vStart, gone.vStart, 'wierzchołki w zwolnionym miejscu');
  for (const e of [...entries.filter((x) => x !== gone), again]) batch.remove(e);
  assert.equal(batch.pages.length, 0, 'pusta strona zwolniona');
  assert.equal(SKIN_BATCH_STATS.entries, 0);
  for (const w of frags) HullBodies.release(w);
});

test('partia skór w klatce: odłamy w partii, flagi i macierz model-widok z haka passa, A/B własnymi siatkami', async () => {
  const W3 = await import('../src/3d/worldBodies3D.js');
  const { Core3D } = await import('../src/3d/core3d.js');
  const { WorldSkinStore, WORLD_SKIN_SLOT_VEC4, WS, SKIN_BATCH_STATS } = await import('../src/3d/worldSkinBatch.js');
  if (!Core3D.scene) Core3D.scene = new THREE.Scene();
  const { r, lat, skin, group, frags } = shatteredPiece('Q-W');
  assert.ok(frags.length >= 2, `odłamy: ${frags.length}`);
  // miejsce i kawałek stracony z gotową skórą; odłamy-wraki dziedziczą rekord kawałka (hull.world)
  const prov = {
    building: dock, root: dock.root, layers: { bg: 1, fg: 2 }, hidden: () => false,
    setSkinned() {}, setHold() {}, groupOf: () => group, rasterCenter: () => ({ x: r.cx, z: r.cz })
  };
  const site = { render: prov, pieces: [] };
  const piece = { id: 'Q-W', site, state: 'lost', touched: true, entity: null, solid3D: false,
    __skin: { key: r.image, lat, bg: skin.bg, fg: skin.fg, triangles: skin.triangles, solid: false } };
  site.pieces.push(piece);
  for (const w of frags) w.beamHull.world = piece;
  W3.setWorldBodiesSource({ sites: [site], focus: [], renderEntities: () => frags });
  try {
    const S = W3.WORLD_SKIN_STATS;
    for (let i = 0; i < 400 && S.batchSlots < frags.length; i++) W3.syncWorldBodies3D();
    assert.equal(S.batchSlots, frags.length, 'wszystkie odłamy w partii');
    W3.syncWorldBodies3D();
    assert.equal(S.batched, frags.length, 'odłamy rysowane partią');
    assert.equal(S.shownFrag, frags.length);
    // egzemplarze schowane (nośniki macierzy i sfer), strony w scenie
    const roots = Core3D.scene.children.filter((o) => o.name === 'ciało świata');
    assert.ok(roots.length >= frags.length && roots.every((o) => !o.visible), 'siatki egzemplarzy schowane');
    const pages = Core3D.scene.children.filter((o) => /^ciało świata — partia/.test(o.name));
    assert.ok(pages.length >= 1 && pages.length <= 2, `strony: ${pages.length}`);
    // hak passa: kamera nad odłamami — wszystkie w kadrze, macierz model-widok jak three (double → float32)
    const cam = new THREE.PerspectiveCamera(50, 1.6, 10, 1e7);
    cam.position.set(0, 0, 60000);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const n = W3.commitWorldSkinStore(cam);
    assert.ok(n >= 1, `widoczne strony: ${n}`);
    assert.ok(pages.every((m) => m.visible === m.geometry.drawRange.count > 0), 'strona z wpisem widoczna');
    const A = WorldSkinStore.array();
    const mv = new THREE.Matrix4();
    let checked = 0;
    // slot egzemplarza z wierzchołków jego wpisu (aPbN.w), dane slotu = wartości siatki egzemplarza (odłam ma wpis
    // w stronie każdego swojego zestawu — slot ten sam)
    const seen = new Set();
    for (const p of pages) {
      const D = p.geometry.attributes.aPbN.data.array;
      const I = p.geometry.index.array;
      for (let k = 0; k < p.geometry.drawRange.count; k += 3) {
        const slot = D[I[k] * 24 + 13];
        if (!slot || seen.has(slot)) continue;
        seen.add(slot);
        const o = slot * WORLD_SKIN_SLOT_VEC4 * 4;
        assert.ok(A[o + WS.FLAGS * 4] + A[o + WS.FLAGS * 4 + 2] >= 1, `slot ${slot}: flaga zestawu`);
        const owner = roots.find((root) => root.children.some((m) => m.userData.skin3D && A[o + WS.CMIN * 4 + 3] === m.userData.skin3D.offset));
        assert.ok(owner, `slot ${slot}: egzemplarz o tym slocie pola`);
        const m0 = owner.children[0];
        mv.multiplyMatrices(cam.matrixWorldInverse, m0.matrixWorld);
        for (let q = 0; q < 16; q++) assert.equal(A[o + q], Math.fround(mv.elements[q]), 'macierz model-widok');
        for (let q = 0; q < 16; q++) assert.equal(A[o + WS.HUB * 4 + q], Math.fround(m0.userData.bodyToHub.elements[q]), 'ciało → budowla');
        const st = m0.userData.skin3D;
        assert.deepEqual([...A.subarray(o + WS.CDIM * 4, o + WS.CDIM * 4 + 4)], [st.cdim.x, st.cdim.y, st.cdim.z, 1]);
        checked++;
      }
    }
    assert.equal(checked, frags.length, 'każdy odłam ma slot w partii');
    // poza kadrem: flagi zerowe, strony schowane
    cam.position.set(0, 0, 60000);
    cam.lookAt(1e7, 0, 60000);
    cam.updateMatrixWorld();
    W3.syncWorldBodies3D();
    assert.equal(W3.commitWorldSkinStore(cam), 0, 'kamera obok — bez rysunków partii');
    // A/B: własne siatki egzemplarzy, strony schowane
    W3.WORLD_SKIN_OPTIONS.batch = false;
    W3.syncWorldBodies3D();
    W3.commitWorldSkinStore(cam);
    assert.ok(roots.every((o) => o.visible), 'A/B: siatki egzemplarzy widoczne');
    assert.ok(pages.every((m) => !m.visible), 'A/B: strony schowane');
    assert.equal(W3.WORLD_SKIN_STATS.batched, 0);
  } finally {
    W3.WORLD_SKIN_OPTIONS.batch = true;
    W3.resetWorldBodies3D();
    W3.setWorldBodiesSource(null);
    for (const w of frags) HullBodies.release(w);
  }
  assert.equal(SKIN_BATCH_STATS.entries, 0, 'reset: wpisy zwolnione');
  assert.equal(SKIN_BATCH_STATS.pages, 0, 'reset: strony zwolnione');
});
