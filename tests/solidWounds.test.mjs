// Rany BRYŁ 3D (src/3d/solidWounds.js — pole ran w komórkach kratownicy szablonu, skin3 w portBuildings3D.tsl.js):
// indeks komórek (bloki 4×4×4), stempel (lustro CPU wzoru kernela mapy ran, stygnięcie wzorem zamkniętym), slot na ród
// (bryła, wrak, odłamy), stemple z trafień (hak HullBodies.onImpact → HullDamageMap), rozdarcia, wysyłka blokami, WGSL
// skóry 3D w Node (pole ran zamiast mapy sprite'a, limity WebGPU).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
await import('../src/3d/core3d.js');
const { SolidWounds, woundCellIndex, woundStampCellCpu, WOUND_BRICK } = await import('../src/3d/solidWounds.js');
const { HullDamageMap } = await import('../src/3d/hullDamageMap.js');
const { damageCoolHeatCpu, DMG_HEAT_MAX } = await import('../src/3d/hullDamageMap.tsl.js');
const { stampEntry } = await import('../src/3d/hullDamageStamps.js');
const { HullBodies, hullImpactResult } = await import('../src/game/hullBodies.js');
const { voxelizeTriangles, makeBoxTriangles } = await import('../src/game/voxelBody3D.js');
const { buildBeamStructure } = await import('../src/game/beamBody3D.js');

HullBodies.init();
function solidLog(zc) {
  const vox = voxelizeTriangles(makeBoxTriangles(900, 180, 180, 0, 0, 0), null, { cellSize: 45, interiorMode: 'full', shellLayers: 1, ribStep: 3 });
  const st = buildBeamStructure(vox, { bulkheadEvery: 0 });
  const e = { x: 0, y: 0, name: 'kłoda', solid3D: true };
  HullBodies.createSolid(e, st, { position: { x: 1000, y: 0, z: zc }, anchored: true, pins: () => true, hexPerNode: 4 });
  return e;
}

test('indeks komórek: bloki 4×4×4 ciągiem, każda komórka slotu raz, w zakresie slotu', () => {
  const dx = 9, dy = 6, dz = 5, nbx = Math.ceil(dx / 4), nby = Math.ceil(dy / 4), nbz = Math.ceil(dz / 4);
  const cells = nbx * nby * nbz * 64, off = 1000;
  const seen = new Set();
  for (let z = 0; z < dz; z++) for (let y = 0; y < dy; y++) for (let x = 0; x < dx; x++) {
    const i = woundCellIndex(off, nbx, nby, x, y, z);
    assert.ok(i >= off && i < off + cells, `indeks w slocie: ${i}`);
    assert.ok(!seen.has(i), 'unikalny');
    seen.add(i);
  }
  // blok = 64 komórki ciągiem
  const a = woundCellIndex(0, nbx, nby, 0, 0, 0), b = woundCellIndex(0, nbx, nby, 3, 3, 3);
  assert.equal(b - a, 63);
  assert.equal(WOUND_BRICK, 4);
});

test('stempel komórki: rdzeń w środku, poświata, stygnięcie wzorem zamkniętym, osmalenie z sufitem', () => {
  const T = [0, 0, 0];
  woundStampCellCpu(T, 0, 60, 3, 0.8, 1, 10);
  assert.ok(Math.abs(T[0] - (3 + 3 * 0.12)) < 1e-9, `żar środka ${T[0]}`);
  assert.equal(T[1], 10);
  assert.ok(Math.abs(T[2] - 0.8) < 1e-9);
  // drugi stempel 2 s później: żar sprzed stempla ostygł wzorem zamkniętym
  const before = damageCoolHeatCpu(T[0], 2);
  woundStampCellCpu(T, 200, 60, 3, 0.8, 1, 12);   // daleko: ρ = 3,3 ≥ 1,6 — bez zmian
  assert.equal(T[1], 10, 'poza zasięgiem stempla komórka bez zmian');
  woundStampCellCpu(T, 50, 60, 3, 0.8, 1, 12);
  assert.ok(T[0] >= before && T[0] <= DMG_HEAT_MAX, `żar ${T[0]} ≥ ostygły ${before}`);
  assert.ok(T[2] <= 1, 'osmalenie z sufitem');
  // stempel mniejszy niż komórka: waga pola
  const S = [0, 0, 0];
  woundStampCellCpu(S, 0, 5, 3, 0.8, (5 / 45) ** 2, 0);
  assert.ok(S[0] < 0.05 && S[2] < 0.01, `drobny kaliber osmala powoli: żar ${S[0]}, osmalenie ${S[2]}`);
});

test('drobny stempel (laser 14 j. przy komórce 45 j.) zawsze trafia w najbliższą komórkę — siła z wagą pola', () => {
  HullDamageMap.reset();
  const e = solidLog(30);
  const hull = e.beamHull;
  let n = 0;
  for (let k = 0; k < 64; k++) {
    // punkty między węzłami kratownicy, także najgorszy przypadek — pół komórki od węzłów w każdej osi
    const lx = 3 + (k & 3) * 0.25, ly = 2 + ((k >> 2) & 1) * 0.5, lz = 1 + ((k >> 3) & 1) * 0.5 + ((k >> 4) & 3) * 0.125;
    if (SolidWounds.stamp(hull, lx, ly, lz, 14, 3, 0.4)) n++;
    if ((k & 15) === 15) SolidWounds.flush();
  }
  assert.equal(n, 64, `każdy drobny stempel zapisuje komórkę (${n}/64)`);
  SolidWounds.flush();
  // osobny węzeł: jeden stempel w środku komórki — żar słaby (waga pola), nie plama pełnej mocy
  const c0 = SolidWounds._cellAt(hull.dmgKey, 10, 2, 2);
  assert.equal(c0[0], 0);
  assert.ok(SolidWounds.stamp(hull, 10, 2, 2, 14, 3, 0.4));
  const c = SolidWounds._cellAt(hull.dmgKey, 10, 2, 2);
  assert.ok(c[0] > 0.05 && c[0] < 0.6, `żar drobnego kalibru z wagą pola: ${c[0].toFixed(3)}`);
  HullBodies.release(e);
});

test('trafienie bryły zostawia ranę w polu 3D (hak HullBodies.onImpact → HullDamageMap → SolidWounds), wysyłka blokami', () => {
  HullDamageMap.reset();
  const prev = HullBodies.onImpact;
  HullBodies.onImpact = HullDamageMap.onHullImpact;
  try {
    const e = solidLog(30);
    const hull = e.beamHull;
    const sw = HullBodies.sweep(e, 1000, -600, 1000, 600, 2);
    HullDamageMap.setSource('special_yamato_cannon', 'impact');
    HullBodies.impact(e, sw.worldX, sw.worldY, 850, { x: 0, y: 3000 }, { craterRadius: 60 });
    HullDamageMap.clearSource();
    const r = hullImpactResult;
    const slot = SolidWounds.slotOf(hull.dmgKey);
    assert.ok(slot, 'slot rodu bryły');
    const d = hull.structure.dims;
    assert.equal(slot.dx, d.x); assert.equal(slot.dy, d.y); assert.equal(slot.dz, d.z);
    const cx = Math.round(r.latX), cy = Math.round(r.latY), cz = Math.round(r.latZ);
    const c = SolidWounds._cellAt(hull.dmgKey, cx, cy, cz);
    assert.ok(c[0] > 1 && c[2] > 0.3, `żar i osmalenie w komórce trafienia: ${c[0].toFixed(2)}, ${c[2].toFixed(2)}`);
    const far = SolidWounds._cellAt(hull.dmgKey, 0, 0, 0);
    assert.equal(far[0], 0, 'daleka komórka bez rany');
    // wysyłka: zakresy bloków, potem pusto
    assert.ok(slot.dirtyList.length > 0, 'bloki do wysłania');
    SolidWounds.flush();
    assert.equal(slot.dirtyList.length, 0);
    assert.ok(SolidWounds.stats.uploadBricks > 0);
    // wrak / odłam rodu — ten sam slot (klucz rodu)
    const w = HullBodies.convertToWreck(e);
    assert.equal(w.beamHull.dmgKey, hull.dmgKey);
    assert.equal(SolidWounds.slotOf(w.beamHull.dmgKey), slot, 'wrak w slocie rodu');
    HullBodies.release(w);
  } finally {
    HullBodies.onImpact = prev;
  }
});

test('rozdarcia: sąsiednie węzły tej klatki łączą się; limit na klatkę', () => {
  HullDamageMap.reset();
  const e = solidLog(30);
  const hull = e.beamHull;
  const tear = stampEntry('tear');
  assert.ok(SolidWounds.tear(hull, 5, 2, 1, tear, 1.1));
  assert.equal(SolidWounds.tear(hull, 5.5, 2, 1, tear, 1.1), false, 'połączone z poprzednim');
  assert.ok(SolidWounds.tear(hull, 9, 2, 1, tear, 1.1), 'dalej — nowe');
  SolidWounds.flush();
  assert.ok(SolidWounds.tear(hull, 5, 2, 1, tear, 1.1), 'następna klatka — od nowa');
  HullBodies.release(e);
});

test('WGSL skóry 3D (Node): pole ran 3D i stygnięcie zamiast mapy sprite\'a, w limitach WebGPU; skóra płaska bez zmian', async () => {
  const { PirateDryDock3D } = await import('../src/3d/portBuildings/pirateDryDock3D.js');
  const { createPirateDryDockLayout } = await import('../src/3d/portBuildings/pirateDryDockLayout.js');
  const { portModuleFrame } = await import('../src/3d/portBuildings/portModuleTraffic.js');
  const { buildingSkinWarmGeometry } = await import('../src/3d/portBuildings/portBuildingSkin3D.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const build = (material, geometry) => {
    const mesh = new THREE.Mesh(geometry, material);
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = material; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = material;
    b.build();
    return { vertex: b.vertexShader, fragment: b.fragmentShader };
  };
  const dock = new PirateDryDock3D({ layout: createPirateDryDockLayout(), frame: portModuleFrame(0, 0, 0), name: 'test' });
  const geo = buildingSkinWarmGeometry();
  const flat = build(dock.skinMaterial('bg'), geo);
  const solid = build(dock.skinMaterial('bg', true), geo);
  const ub = (w) => (w.match(/var<uniform>/g) || []).length;
  const sb = (w) => (w.match(/var<storage/g) || []).length;
  for (const w of [flat, solid]) {
    assert.ok(ub(w.vertex) <= 12 && ub(w.fragment) <= 12, 'bufory uniformów');
    assert.ok(sb(w.vertex) <= 8 && sb(w.fragment) <= 8, 'bufory storage');
  }
  assert.match(solid.fragment, /solidWoundField/, 'skin3 czyta pole ran 3D');
  assert.match(solid.fragment, /hullDamageCool/, 'stygnięcie wzorem zamkniętym');
  assert.doesNotMatch(solid.fragment, /hullDamagePool/, 'skin3 bez mapy ran sprite\'a');
  assert.match(flat.fragment, /hullDamagePool/, 'skóra płaska — mapa ran sprite\'a');
  assert.doesNotMatch(flat.fragment, /solidWoundField/, 'skóra płaska bez pola ran 3D');
});
