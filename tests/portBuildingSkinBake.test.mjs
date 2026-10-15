// Wypiek skóry kawałka budowli po optymalizacji 2026-10-15 (rdzeń bez three — src/3d/portBuildings/portBuildingSkinBake.js,
// w grze w workerze): geometrie BIT W BIT jak dawny wypiek (wzorzec tests/helpers/portBuildingSkinReference.mjs) —
// kawałki płaskie bazy piratów (bęben, szyb, pomost, zbiornik, magazyn; różny podział) i bryła 3D (sektor dysku),
// sfera ograniczająca jak BufferGeometry.computeBoundingSphere three; wypiek w krokach = wypiek naraz.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const { createPirateBaseLayout } = await import('../src/3d/portBuildings/pirateBaseLayout.js');
const { buildPirateBaseScene } = await import('../src/3d/portBuildings/pirateBaseScene.js');
const { resolvePortBuildingStyle } = await import('../src/3d/portBuildings/portBuildingStyle.js');
const { pirateBaseChunkRaster, pirateBaseSolidOf } = await import('../src/game/story/pirateBaseBodies.js');
const { HullBodies } = await import('../src/game/hullBodies.js');
const { WORLD_BODY_TUNE } = await import('../src/game/worldBodies.js');
const { hullSkinLattice, hullSkinLattice3D } = await import('../src/3d/ships3d/hullSkin3D.js');
const { bakeBuildingChunkSkin, bakeBuildingChunkSkinSteps, buildingSkinBakeInput, buildingSkinGeometries } =
  await import('../src/3d/portBuildings/portBuildingSkin3D.js');
const { bakeSkinCore } = await import('../src/3d/portBuildings/portBuildingSkinBake.js');
const { bakeBuildingChunkSkinReference } = await import('./helpers/portBuildingSkinReference.mjs');

const L = createPirateBaseLayout();
const style = resolvePortBuildingStyle('pirate');
const SCENE = buildPirateBaseScene(L, style);
const building = { scene: SCENE };

// kratownica kawałka płaskiego jak w worldBodies._buildPiece → worldBodies3D.startSkinBake (kotwica z prawdziwego kadłuba)
function flatCase(id) {
  const r = pirateBaseChunkRaster(L, SCENE, id, { palette: style.palette || null });
  assert.ok(r, `raster ${id}`);
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, radius: 0, mass: 0, visual: { spriteScale: r.upp, spriteScaleX: r.upp, spriteScaleY: r.upp, spriteRotation: 0 } };
  const cellPx = WORLD_BODY_TUNE.cellSize / r.upp;
  const hull = HullBodies.createHull(e, r.image, { cellPx, anchored: true });
  const structure = HullBodies.structureFor(r.image, r.upp, cellPx);
  const lat = hullSkinLattice(structure, hull.anchorDX, hull.anchorDY);
  HullBodies.release(e);
  return { group: L.chunkById.get(id).group, cx: r.cx, cz: r.cz, lat };
}

// bryła 3D jak worldBodies3D.startSolidTemplateBake (kratownica z szablonu, kotwica = −latticeMin − środek masy)
function solidCase(id) {
  const sol = pirateBaseSolidOf(L, SCENE, id, style.palette || null);
  assert.ok(sol, `bryła ${id}`);
  const s = sol.structure, com = s.com || { x: 0, y: 0, z: 0 };
  const lat = hullSkinLattice3D(s, -s.latticeMin.x - com.x, -s.latticeMin.y - com.y, -s.latticeMin.z - com.z);
  return { group: L.chunkById.get(id).group, cx: sol.cx, cz: sol.cz, lat };
}

const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const bits = (a) => new Uint32Array(a.buffer, a.byteOffset, a.length);
// Geometria jako lista wierzchołków TRÓJKĄTÓW (rozwinięcie indeksu): bity pozycji, normalnej i przeplotu na wierzchołek.
function expand(g) {
  const I = g.index ? g.index.array : null;
  const n = I ? g.index.count : g.attributes.position.count;
  const P = bits(g.attributes.position.array), N = bits(g.attributes.normal.array);
  const D = g.attributes.aPbA.data, S = D.stride, X = bits(D.array);
  const pos = new Uint32Array(n * 3), nor = new Uint32Array(n * 3), inter = new Uint32Array(n * S);
  for (let j = 0; j < n; j++) {
    const v = I ? I[j] : j;
    for (let k = 0; k < 3; k++) { pos[j * 3 + k] = P[v * 3 + k]; nor[j * 3 + k] = N[v * 3 + k]; }
    for (let k = 0; k < S; k++) inter[j * S + k] = X[v * S + k];
  }
  return { n, pos, nor, inter, stride: S };
}
// a — bieżący wypiek (z indeksem), b — wzorzec (bez indeksu): te same trójkąty, te same bity atrybutów ich wierzchołków
function sameGeometry(a, b, label) {
  assert.equal(!!a, !!b, `${label}: zestaw`);
  if (!a) return;
  const ea = expand(a), eb = expand(b);
  assert.equal(ea.n, eb.n, `${label}: wierzchołki trójkątów`);
  assert.equal(ea.stride, eb.stride, `${label}: przeplot`);
  assert.ok(bytes(ea.pos).equals(bytes(eb.pos)), `${label}: position bit w bit`);
  assert.ok(bytes(ea.nor).equals(bytes(eb.nor)), `${label}: normal bit w bit`);
  assert.ok(bytes(ea.inter).equals(bytes(eb.inter)), `${label}: aPbA / aPbN / aPbFx / aLat / aOwn bit w bit`);
  for (const name of ['aPbA', 'aPbN', 'aPbFx', 'aLat', 'aOwn']) {
    assert.equal(a.attributes[name].offset, b.attributes[name].offset, `${label}: ${name} offset`);
    assert.equal(a.attributes[name].itemSize, b.attributes[name].itemSize, `${label}: ${name} itemSize`);
  }
  const sa = a.boundingSphere, sb = b.boundingSphere;
  assert.ok(Object.is(sa.radius, sb.radius) && Object.is(sa.center.x, sb.center.x) && Object.is(sa.center.y, sb.center.y) &&
    Object.is(sa.center.z, sb.center.z), `${label}: sfera ${JSON.stringify(sa)} ≠ ${JSON.stringify(sb)}`);
  // indeks nie traci danych: wierzchołków mniej niż wierzchołków trójkątów
  if (a.index) assert.ok(a.attributes.position.count < ea.n, `${label}: wierzchołki wspólne (${a.attributes.position.count} < ${ea.n})`);
}

test('wypiek kawałków płaskich bazy piratów: bit w bit jak dawny wypiek (bęben, szyb, pomosty, zbiornik, magazyn)', () => {
  for (const [id, edge] of [['H-S', 3], ['H-C', 4], ['YA-1', 3], ['MP', 2], ['P-1', 3], ['M-1', 4], ['M-2', 6]]) {
    const c = flatCase(id);
    const opts = { cx: c.cx, cz: c.cz, lattice: c.lat, maxEdgeCells: edge };
    const ref = bakeBuildingChunkSkinReference(building, c.group, opts);
    const now = bakeBuildingChunkSkin(building, c.group, opts);
    assert.ok(ref.triangles > 0, `${id}: trójkąty`);
    assert.equal(now.triangles, ref.triangles, `${id}: liczba trójkątów`);
    sameGeometry(now.bg, ref.bg, `${id} bg`);
    sameGeometry(now.fg, ref.fg, `${id} fg`);
  }
});

test('wypiek bryły 3D (sektor dysku habitatu): bit w bit jak dawny wypiek', () => {
  const c = solidCase('D-3');
  const opts = { cx: c.cx, cz: c.cz, lattice: c.lat, maxEdgeCells: 4 };
  const ref = bakeBuildingChunkSkinReference(building, c.group, opts);
  const now = bakeBuildingChunkSkin(building, c.group, opts);
  assert.ok(ref.triangles > 0);
  assert.equal(now.triangles, ref.triangles);
  sameGeometry(now.bg, ref.bg, 'D-3 bg');
  sameGeometry(now.fg, ref.fg, 'D-3 fg');
});

test('wypiek w krokach (zapas bez workera) i rdzeń naraz (worker) dają ten sam wynik; kroki są krótkie', () => {
  const c = flatCase('H-W');
  const opts = { cx: c.cx, cz: c.cz, lattice: c.lat, maxEdgeCells: 3 };
  const it = bakeBuildingChunkSkinSteps(building, c.group, opts);
  let r = it.next(), steps = 1;
  while (!r.done) { r = it.next(); steps++; }
  const core = buildingSkinGeometries(bakeSkinCore(buildingSkinBakeInput(building, c.group, opts)));
  assert.ok(steps > 3, `kroków: ${steps}`);
  assert.equal(r.value.triangles, core.triangles);
  sameGeometry(r.value.bg, core.bg, 'H-W bg');
  sameGeometry(r.value.fg, core.fg, 'H-W fg');
});
