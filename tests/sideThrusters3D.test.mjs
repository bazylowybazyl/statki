// Dysze SIDE 3D (2026-10-07): model dyszy (src/3d/ships3d/thrusters/sideThruster3D.js), partia (thrusterBatch3D.js),
// lista klatki (sideNozzleFrame.js), nowy efekt WebGPU (sideJets3D.js) i wpięcie w EngineVfxSystem / shipModels3DGame.
// node --test tests/sideThrusters3D.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  SIDE_THRUSTER_PART, SIDE_THRUSTER_PALETTES, SIDE_THRUSTER_PALETTE, SIDE_THRUSTER_PALETTE_KEYS, SIDE_THRUSTER_AXIS_Z,
  buildSideThruster3D, buildSideThrusterArrays, sideThrusterPaletteFor, sideThrusterVertexCpu
} from '../src/3d/ships3d/thrusters/sideThruster3D.js';
import {
  SIDE_THRUSTER_INST_STRIDE, SIDE_THRUSTER_INST_ATTRS, writeSideThrusterInstance, sideThrusterInstanceScratch,
  createThrusterBatchGeometry, createThrusterBatchMaterial, ThrusterBatch, ThrusterBatchNodeMaterial, thrusterBatchWarmHolder
} from '../src/3d/ships3d/thrusterBatch3D.js';
import { SideNozzleFrame, SIDE_NOZZLE_MOUTH, SIDE_NOZZLE_RADIUS, setSideNozzles3D } from '../src/3d/sideNozzleFrame.js';
import { SIDE_JET_TUNE, SIDE_JET_PALETTES, SideJetInternals, createSideJetState, stepSideJet } from '../src/3d/sideJets3D.js';
import { SHIP3D_MAT as M } from '../src/3d/ships3d/meshBuilder3D.js';
import { createShipMaterial } from '../src/3d/ships3d/shipMaterials3D.tsl.js';
import { applySunShadowToBuiltinMaterial } from '../src/3d/sunShadowMask.js';
import { MAIN_EXHAUST_PALETTES } from '../src/data/engineFx.js';
import { createNpcHardpointRuntime } from '../src/game/npcHardpointRuntime.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { buildShip3D } from '../src/3d/ships3d/ships/ships3D.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lum = (hex) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

test('model dyszy: sponson (BASE) i obrotowa dysza (SWIVEL), wylot dzwonu w SIDE_NOZZLE_MOUTH, poprawne normalne', () => {
  const m = buildSideThruster3D();
  assert.equal(m.mouth, SIDE_NOZZLE_MOUTH);
  const a = buildSideThrusterArrays();
  assert.deepEqual(a.pieces.map((p) => p.part), [SIDE_THRUSTER_PART.BASE, SIDE_THRUSTER_PART.SWIVEL]);
  assert.ok(a.index.every((i) => i < a.vertexCount), 'indeksy w zakresie');
  assert.ok(a.index.length / 3 < 2500, `trójkątów ${a.index.length / 3} — dysza jest mała, partia rysuje setki`);
  for (let i = 0; i < a.vertexCount; i++) {
    const n = Math.hypot(a.normal[i * 3], a.normal[i * 3 + 1], a.normal[i * 3 + 2]);
    assert.ok(Math.abs(n - 1) < 1e-4, `normalna ${i}`);
  }
  const ext = (p) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = p.first; i < p.first + p.count; i++) for (let k = 0; k < 3; k++) {
      const v = a.position[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
    }
    return { mn, mx };
  };
  const base = ext(a.pieces[0]);
  const sw = ext(a.pieces[1]);
  assert.ok(Math.abs(sw.mx[0] - SIDE_NOZZLE_MOUTH) < 1e-4, `warga dzwonu w x = ${sw.mx[0]} (wylot ${SIDE_NOZZLE_MOUTH})`);
  assert.ok(sw.mx[1] <= 1.06 && sw.mn[1] >= -1.06, 'dzwon ma promień wylotu ~1 (j. lokalne)');
  assert.ok(base.mn[2] >= -1e-6 && base.mx[2] <= 0.6, 'sponson płaski, na płaszczyźnie');
  assert.ok(sw.mn[2] > 0.25, 'część obrotowa nad sponsonem (dzwon nie wchodzi w płytę)');
  assert.ok(SIDE_THRUSTER_AXIS_Z > 0.9 && SIDE_THRUSTER_AXIS_Z < a.height, 'oś dzwonu w bryle');
  // waga żaru tylko na metalu dzwonu (część obrotowa, x ≥ 0,32), malejąca ku wylotowi
  for (let i = 0; i < a.vertexCount; i++) {
    const w = a.part[i * 2 + 1];
    assert.ok(w >= 0 && w <= 1, 'waga żaru 0..1');
    if (w > 0) {
      assert.equal(a.part[i * 2], SIDE_THRUSTER_PART.SWIVEL, 'żar tylko na dyszy obrotowej');
      assert.ok(a.position[i * 3] >= 0.32, 'żar tylko na dzwonie i kołnierzu');
    }
  }
});

test('farba dyszy: Terra Nova biel, Atlas i frachtowce szary, piraci rdza — z profilu kadłuba', () => {
  assert.deepEqual(SIDE_THRUSTER_PALETTE_KEYS, ['terran', 'atlas', 'civil', 'pirate']);
  assert.equal(SIDE_THRUSTER_PALETTES.length, 4);
  const P = SIDE_THRUSTER_PALETTE;
  for (const id of ['terran_frigate', 'terran_destroyer', 'terran_battleship', 'terran_carrier', 'terran_supercapital', 'supercapital', 'corvus', 'capital_carrier']) {
    assert.equal(sideThrusterPaletteFor(id), P.TERRAN, id);
  }
  for (const id of ['atlas', 'player', '']) assert.equal(sideThrusterPaletteFor(id), P.ATLAS, id || '(brak)');
  for (const id of ['pirate_frigate', 'pirate_destroyer', 'pirate_battleship', 'pirate_supercapital', 'smuggler']) {
    assert.equal(sideThrusterPaletteFor(id), P.PIRATE, id);
  }
  for (const id of ['inter_station_shuttle', 'container_ship', 'long_haul_freighter', 'heavy_freighter', 'megafreighter', 'tanker']) {
    assert.equal(sideThrusterPaletteFor(id), P.CIVIL, id);
  }
  const paint = (k) => SIDE_THRUSTER_PALETTES[k][M.PAINT].color;
  assert.ok(lum(paint(P.TERRAN)) > 2.5 * lum(paint(P.ATLAS)), 'Terra Nova wyraźnie jaśniejsza (biel) niż Atlas');
  assert.ok(lum(paint(P.TERRAN)) > 2.5 * lum(paint(P.CIVIL)), 'Terra Nova jaśniejsza niż frachtowce');
  const grey = (hex) => { const c = new THREE.Color(hex); return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); };
  assert.ok(grey(paint(P.ATLAS)) < 0.06 && grey(paint(P.CIVIL)) < 0.03, 'Atlas i frachtowce — szarości');
  const rust = new THREE.Color(paint(P.PIRATE));
  assert.ok(rust.r > rust.g && rust.g > rust.b, 'piraci — rdza');
});

// Dawne drzewo (odniesienie): oś dyszy w (x, y, z), skala K, część obrócona wokół Z o kąt kierunku.
function treeVertex(rec, part, v) {
  const o = new THREE.Object3D();
  o.position.set(rec[0], rec[1], rec[2]);
  o.scale.setScalar(rec[3]);
  const c = part === SIDE_THRUSTER_PART.SWIVEL ? rec[6] : rec[4];
  const s = part === SIDE_THRUSTER_PART.SWIVEL ? rec[7] : rec[5];
  o.rotation.z = Math.atan2(s, c);
  o.updateMatrixWorld(true);
  return new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(o.matrixWorld);
}

test('rekord instancji (16 liczb) i poza części: podstawa za kierunkiem podstawy, dysza za kierunkiem wydechu', () => {
  assert.equal(SIDE_THRUSTER_INST_STRIDE, 16);
  assert.deepEqual(SIDE_THRUSTER_INST_ATTRS.map((x) => [x.name, x.offset]), [['iThrPos', 0], ['iThrRot', 4], ['iThrState', 8], ['iThrSlab', 12]]);
  const t = sideThrusterInstanceScratch();
  Object.assign(t, { x: 1, y: 2, z: 3, scale: 4, baseCos: 5, baseSin: 6, dirCos: 7, dirSin: 8, throttle: 9, heat: 10, palette: 11, zb: 13, zt: 14, lo: 15, hi: 16 });
  const d = new Float32Array(32);
  writeSideThrusterInstance(d, 16, t);
  assert.deepEqual([...d.subarray(16)], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 13, 14, 15, 16]);
  assert.ok(d.subarray(0, 16).every((v) => v === 0));
  const a = buildSideThrusterArrays();
  const out = {};
  const ab = Math.PI * 0.3, ad = -Math.PI * 0.7;
  const rec = [120.5, -77.25, 4, 15, Math.cos(ab), Math.sin(ab), Math.cos(ad), Math.sin(ad), 0, 0, 0, 0, 0, 1, 0, 1];
  for (const p of a.pieces) {
    for (const i of [p.first, p.first + (p.count >> 1), p.first + p.count - 1]) {
      const v = a.position.subarray(i * 3, i * 3 + 3);
      sideThrusterVertexCpu(rec, 0, p.part, v, a.normal.subarray(i * 3, i * 3 + 3), out);
      const ref = treeVertex(rec, p.part, v);
      assert.ok(Math.hypot(out.x - ref.x, out.y - ref.y, out.z - ref.z) < 1e-6, `część ${p.part}, wierzchołek ${i}`);
      assert.ok(Math.abs(Math.hypot(out.nx, out.ny, out.nz) - 1) < 1e-5, 'normalna obrócona, nie skalowana');
    }
  }
});

test('partia: jedna siatka, ≤ 8 buforów wierzchołków, wysyłka zakresem, wzrost pojemności bez utraty rekordów', () => {
  const { geometry, buffer } = createThrusterBatchGeometry(4);
  const buffers = new Set();
  for (const at of Object.values(geometry.attributes)) buffers.add(at.isInterleavedBufferAttribute ? at.data : at);
  assert.equal(buffers.size, 6, 'position, normal, uv, aMat, aThrPart + bufor instancji');
  assert.notEqual(buffer.usage, THREE.DynamicDrawUsage);
  const scene = new THREE.Scene();
  const batch = new ThrusterBatch(scene, new THREE.MeshBasicNodeMaterial());
  assert.equal(scene.children.length, 1, 'jedna siatka na wszystkie dysze i frakcje');
  const t = sideThrusterInstanceScratch();
  batch.begin(10, -20);
  for (let i = 0; i < 150; i++) { t.x = i; batch.push(t); }
  batch.end();
  assert.equal(batch.mesh.geometry.instanceCount, 150);
  assert.ok(batch.capacity >= 150);
  for (let i = 0; i < 150; i++) assert.equal(batch.data[i * SIDE_THRUSTER_INST_STRIDE], i);
  assert.deepEqual({ ...batch.buffer.updateRanges[0] }, { start: 0, count: 150 * SIDE_THRUSTER_INST_STRIDE });
  assert.equal(batch.draws, 1);
  assert.equal(batch.mesh.receiveShadow, true);
  assert.deepEqual([batch.mesh.position.x, batch.mesh.position.y], [10, -20]);
  batch.begin(0, 0);
  batch.end();
  assert.equal(batch.mesh.visible, false, 'bez dysz w kadrze — bez rysunku');
  assert.equal(batch.draws, 0);
});

// WGSL bez GPU (wzór tests/turretBatch3D.test.mjs).
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

test('materiał partii dysz: palety frakcji w jednym materiale (indeks z rekordu), flat, w limitach', () => {
  const mat = applySunShadowToBuiltinMaterial(createThrusterBatchMaterial());
  assert.ok(mat instanceof ThrusterBatchNodeMaterial);
  const holder = thrusterBatchWarmHolder(mat);
  assert.equal(holder.receiveShadow, true, 'rozgrzewka w stanie siatki partii');
  assert.equal(holder.geometry.instanceCount, 1);
  const w = buildWGSL(holder);
  for (const name of ['iThrPos', 'iThrRot', 'iThrState', 'iThrSlab', 'aThrPart', 'aMat']) assert.ok(w.vertex.includes(name), name);
  assert.match(w.fragment, /\*\s*20\s*\)/, 'wpis palety: materiał + paleta × SHIP3D_MAT_COUNT');
  assert.ok(/@interpolate\(\s*flat/.test(w.vertex + w.fragment), 'stan instancji (paleta, ciąg, żar) płaski');
  const ubo = Math.max((w.vertex.match(/var<uniform>/g) || []).length, (w.fragment.match(/var<uniform>/g) || []).length);
  assert.ok(ubo <= 12, `${ubo} buforów uniformów`);
  // materiał okrętu bez palet — jedna paleta (graf jak dawniej)
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  const plain = buildWGSL(new THREE.Mesh(g, createShipMaterial({ name: 'x' })));
  assert.doesNotMatch(plain.fragment, /\*\s*20\s*\)/, 'materiał okrętu bez palet nie dostaje indeksu palety');
  assert.match(plain.fragment, /array<\s*vec4<f32>\s*,\s*20\s*>/);
  assert.match(w.fragment, /array<\s*vec4<f32>\s*,\s*80\s*>/, 'cztery palety po 20 materiałów');
});

test('lista klatki: początek, dysze, zdublowane markery (near), pojemność', () => {
  const F = SideNozzleFrame;
  assert.equal(F.enabled, true, 'modele dysz domyślnie włączone');
  F.begin();
  const e = {}; const src = {};
  assert.equal(F.push(e, src, 1e6, -2e6, 10, 20, 1, 0, 0, 1, 15, 0.5, 2), 0);
  assert.equal(F.count, 1);
  assert.equal(F.heat[0], 1, 'żar przycięty do 1');
  assert.equal(F.x[0], 1e6, 'pozycje w double');
  assert.equal(F.near(0, 1e6 + 3, -2e6, 7.5), true);
  assert.equal(F.near(0, 1e6 + 30, -2e6, 7.5), false);
  assert.equal(F.push(e, src, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0), -1, 'bez promienia — bez dyszy');
  const serial = F.serial;
  F.begin();
  assert.equal(F.count, 0);
  assert.equal(F.serial, serial + 1);
  assert.equal(F.entity[0], null, 'bez trzymania encji do następnej klatki');
  assert.equal(setSideNozzles3D(false), false);
  assert.equal(setSideNozzles3D(true), true);
  assert.ok(SIDE_NOZZLE_RADIUS > 10 && SIDE_NOZZLE_RADIUS < 20);
});

test('dysze SIDE WebGPU: praca impulsowa przy niepełnym ciągu, ciągła przy pełnym, zapłon i obłok po wyłączeniu', () => {
  const dt = 1 / 60;
  // 30%: impulsy z okresem ~0,16 s, wypełnienie rośnie z ciągiem
  const duty = (fire) => {
    const s = createSideJetState();
    let on = 0, starts = 0;
    for (let i = 0; i < 240; i++) { const ev = stepSideJet(s, fire, dt); if (ev & 1) starts++; if (s.on) on++; }
    return { on: on / 240, starts };
  };
  const lo = duty(0.15), mid = duty(0.4);
  assert.ok(lo.on > 0.15 && lo.on < mid.on && mid.on < 0.85, `wypełnienie ${lo.on} < ${mid.on}`);
  const perSec = mid.starts / 4;
  assert.ok(Math.abs(perSec - 1 / SIDE_JET_TUNE.period) < 1.2, `impulsów na sekundę ${perSec}`);
  // pełny ciąg: jeden zimny zapłon, potem ciągła struga
  const s = createSideJetState();
  let events = 0, on = 0;
  for (let i = 0; i < 120; i++) { events |= stepSideJet(s, 1, dt); if (s.on) on++; }
  assert.equal(on, 120);
  assert.equal(events & 3, 3, 'początek impulsu i zimny zapłon');
  assert.ok(s.power > 0.97 && s.heat > 0.6);
  // wyłączenie: obłok resztkowy, moc do zera, żar stygnie wolniej
  let off = 0;
  for (let i = 0; i < 30; i++) off |= stepSideJet(s, 0, dt);
  assert.equal(off & 4, 4, 'obłok po wyłączeniu');
  assert.equal(s.power, 0);
  assert.ok(s.heat > 0.3, 'żar stygnie wolniej niż gaśnie struga');
  // impuls po krótkiej przerwie (< coldOff) — bez zimnego zapłonu; po długiej — zimny zapłon
  const s2 = createSideJetState();
  for (let i = 0; i < 60; i++) stepSideJet(s2, 1, dt);
  for (let i = 0; i < 12; i++) stepSideJet(s2, 0, dt);
  const ev = stepSideJet(s2, 1, dt);
  assert.equal(ev & 1, 1);
  assert.equal(ev & 2, 0, 'krótka przerwa — dysza jeszcze ciepła');
  for (let i = 0; i < Math.ceil(SIDE_JET_TUNE.coldOff / dt) + 20; i++) stepSideJet(s2, 0, dt);
  assert.equal(stepSideJet(s2, 1, dt) & 2, 2, 'długa przerwa — zimny zapłon');
});

test('dysze SIDE WebGPU: barwy z palet strug MAIN, rdzeń nad progiem bloomu, WGSL bez ujemnych podstaw pow', () => {
  assert.equal(SIDE_JET_PALETTES.length, MAIN_EXHAUST_PALETTES.length);
  for (const p of SIDE_JET_PALETTES) {
    assert.ok(Math.max(...p.core) > 0.9, 'rdzeń świeci w bloomie');
    assert.ok(Math.max(...p.body) < Math.max(...p.core), 'ciało ciemniejsze niż rdzeń');
    assert.ok(Math.max(...p.edge) < Math.max(...p.body) + 1e-6, 'brzeg najciemniejszy');
  }
  const tex = new THREE.DataTexture(new Uint8Array(16 * 4), 4, 4);
  const mat = SideJetInternals.makeJetMaterial(tex);
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(base.index);
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('uv', base.getAttribute('uv'));
  const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(SideJetInternals.STRIDE), SideJetInternals.STRIDE, 1);
  for (const [name, off] of SideJetInternals.ATTRS) g.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, 4, off));
  g.instanceCount = 1;
  const w = buildWGSL(new THREE.Mesh(g, mat));
  const buffers = new Set(Object.values(g.attributes).map((at) => (at.isInterleavedBufferAttribute ? at.data : at)));
  assert.equal(buffers.size, 3, 'pozycja, uv + jeden przepleciony bufor instancji');
  // jedyne pow: rozprężanie stożka z odległości przyciętej do ≥ 0 (podstawa = max(s, 0))
  const pows = [...w.fragment.matchAll(/pow\(\s*(\w+)/g)];
  assert.equal(pows.length, 1);
  const baseVar = pows[0][1];
  assert.match(w.fragment, new RegExp(`${baseVar}\\s*=\\s*max\\(`), `podstawa pow (${baseVar}) przycięta do ≥ 0`);
  assert.equal(mat.depthWrite, false);
  assert.equal(mat.forceSinglePass, true);
});

test('NPC: baza kąta dysz SIDE z kąta edytora (wydech na zewnątrz burty), bez kąta — na zewnątrz swojej burty', () => {
  const runtime = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS.ships });
  runtime.refreshCache(true);
  for (const type of ['destroyer', 'frigate_pd']) {
    const npc = { type, visual: {}, engines: {} };
    assert.equal(runtime.applyLayoutToNpc(npc), true);
    const side = npc.visual.torqueThrusters;
    assert.ok(side.length >= 2, type);
    for (const t of side) {
      const left = String(t.mount).endsWith('_left');
      assert.equal(t.baseDeg, left ? 180 : 0, `${type} ${t.mount}: baza ${t.baseDeg}`);
      // wydech (−forward) na zewnątrz burty: lewa burta = −y obrazka
      const exhaustY = -t.forward.y;
      assert.ok(left ? exhaustY < -0.99 : exhaustY > 0.99, `${type} ${t.mount}: wydech y ${exhaustY}`);
    }
  }
  const src = read('src/game/npcHardpointRuntime.js');
  assert.match(src, /kind === 'side' && !Number\.isFinite\(Number\(marker\?\.deg\)\)/, 'marker bez kąta — na zewnątrz burty');
});

test('modele kadłubów w grze: bez skrzynek RCS w bryle (rcs: false), dane dysz bez zmian', () => {
  for (const id of ['atlas', 'terran_destroyer']) {
    const a = buildShip3D(id).builder.build().triangleCount;
    const b = buildShip3D(id, { rcs: false });
    assert.ok(b.builder.build().triangleCount < a, `${id}: mniej trójkątów bez skrzynek`);
    assert.ok(b.rcs.length > 0, `${id}: miejsca dysz zostają w danych`);
  }
  assert.match(read('src/3d/ships3d/shipModels3DGame.js'), /buildShip3D\(id, \{ rcs: false \}\)/);
});

test('wpięcie: EngineVfxSystem pisze listę dysz i nowe strugi z wylotu dzwonu; shipModels3DGame rysuje partię', () => {
  const src = read('src/3d/engineVfxSystem.js');
  assert.match(src, /flameX \+= dirX \* SIDE_NOZZLE_MOUTH \* sideNozzleR;/, 'struga z wylotu dzwonu');
  assert.match(src, /SideJets3D\.push\(item\.jet, jp\);/, 'nowe dysze SIDE');
  assert.match(src, /SideNozzleFrame\.push\(entity, src \|\| slot, nozzleWorldX, nozzleWorldY/, 'model dyszy w osi obrotu (marker)');
  assert.match(src, /SideNozzleFrame\.begin\(\);/);
  assert.match(src, /SideJets3D\.begin\(frameOrigin\.x, frameOrigin\.y, dt, frameCtx\.zoom\);/);
  assert.match(src, /SideJets3D\.flush\(\);/);
  const glue = read('src/3d/ships3d/shipModels3DGame.js');
  assert.match(glue, /syncSideNozzles\(p\);/);
  assert.match(glue, /out\.push\(thrusterBatchWarmHolder\(nozzleMaterial\(\)\)\);/, 'rozgrzewka partii dysz');
  assert.match(read('src/3d/sideJets3D.js'), /Core3D\.warmup\?\.add\(\{ name: 'dysze SIDE \(WebGPU\)'/);
  assert.doesNotMatch(read('src/3d/sideJets3D.js') + read('src/3d/ships3d/thrusters/sideThruster3D.js'), /Math\.random/, 'wizualia z fxRandom');
});
