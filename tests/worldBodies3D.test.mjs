// Skóra ciał świata (src/3d/worldBodies3D.js, wariant „skin” grafu budowli — portBuildings3D.tsl.js, wypiek —
// portBuildingSkin3D.js): WGSL budowany w Node przez WGSLNodeBuilder (WebGPURenderer bez init, atrapa kanwy — wzór
// tests/cargoTsl.test.mjs), limity WebGPU, jeden program na BG i FG, wypiek brył kawałka (wszystkie rodzaje, także
// stożki i lampy) w układzie ciała. Obraz (statyka ↔ skóra bez różnicy) sprawdza scripts/webgpu/zniszczenia-gra.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
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
