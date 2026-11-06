// Partia obrazu ciągników kosmicznych: bez Core3D, dwa rysunki, WGSL buduje się w Node, liczniki instancji, układ sceny,
// początek przy kamerze, emitery HDR, daleki zoom, brak alokacji, atlas w płótnie PNG.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { SPACE_TRUCKS_SHARED, SPACE_TRUCKS_TUNE, SpaceTrucks3D, truckCargoPaints } from '../src/3d/spaceTrucks3D.js';
import { TRUCK_ATLAS, TRUCK_SPRITE_PNG, TRUCK_TRACTORS, TRUCK_TRAILER } from '../src/data/spaceTrucks.js';
import { createTruckTrain, placeTruckTrain, stepTruckTrain } from '../src/game/spaceTruckTrain.js';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

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

const VIEW = { x: 8_640_000, y: -3_910_000, ppu: 1, viewW: 1600, viewH: 900, time: 1.2 };

function make(rigs = 8) {
  const scene = new THREE.Scene();
  return { scene, trucks: new SpaceTrucks3D({ scene, rigs, loadTextures: false }) };
}

function placed(id, n, x = VIEW.x, y = VIEW.y, a = 0) {
  return placeTruckTrain(createTruckTrain(id, n), x, y, a);
}

test('moduł nie zna Core3D ani gry: importy tylko three, dane i pomocniki bez stanu', () => {
  const src = readFileSync(new URL('../src/3d/spaceTrucks3D.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['../data/spaceTrucks.js', './canvas2d.js', './zakresyWysylki.js', 'three/tsl', 'three/webgpu'].sort());
  assert.ok(!/window\.|document\.|Math\.random/.test(src), 'bez window, DOM i Math.random');
});

test('dwa rysunki na wszystkie zestawy, WGSL buduje się w Node, jeden graf', () => {
  const { scene, trucks } = make();
  const meshes = trucks.warmupMeshes();
  assert.equal(meshes.length, 2);
  assert.equal(scene.children.length, 2);
  for (const m of meshes) {
    const { vertex, fragment } = buildWGSL(m);
    assert.ok(vertex.length > 100 && fragment.length > 100);
    assert.ok(!/\bpow\(/.test(fragment), 'bez pow w shaderze efektu');
    // Atrybuty przeplecione: pozycja, uv + jeden bufor instancji.
    assert.equal(new Set(Object.values(m.geometry.attributes).map((a) => a.data || a)).size, 3);
    assert.equal(m.material.depthWrite, false);
  }
  const other = make().trucks;
  assert.equal(other.spriteMesh.material, trucks.spriteMesh.material, 'wspólny materiał sprite');
  assert.equal(other.emitMesh.material, trucks.emitMesh.material, 'wspólny materiał emiterów');
});

test('liczniki: ciągnik + rama + ładunek; pusta rama bez ładunku; koniec miejsca nie psuje bufora', () => {
  const { trucks } = make(2);
  const a = trucks.add(placed('heavy', 5), { livery: 0, trailers: Array(5).fill({ cargo: 'standard' }) });
  const b = trucks.add(placed('light', 1, VIEW.x + 200), { livery: 2, trailers: [{ cargo: null }] });
  assert.ok(a && b);
  assert.equal(a.cellCount, 11);
  assert.equal(b.cellCount, 2);
  assert.equal(trucks.add(placed('light', 1)), null, 'pojemność');
  trucks.update(VIEW);
  assert.equal(trucks.spriteMesh.geometry.instanceCount, 13);
  assert.ok(trucks.emitMesh.geometry.instanceCount <= SPACE_TRUCKS_TUNE.emittersPerRig * 2);
  assert.equal(trucks.spriteMesh.visible, true);
  trucks.remove(a);
  trucks.update(VIEW);
  assert.equal(trucks.spriteMesh.geometry.instanceCount, 2);
});

test('układ: y sceny = −y gry, dane względem początku przy kamerze, duży offset w mesh.position', () => {
  const { trucks } = make();
  const x = VIEW.x + 300;
  const y = VIEW.y + 120;
  trucks.add(placed('standard', 0, x, y, 0.5), { livery: 1 });
  trucks.update(VIEW);
  assert.equal(trucks.spriteMesh.position.x, VIEW.x);
  assert.equal(trucks.spriteMesh.position.y, -VIEW.y);
  const d = trucks.spriteBuffer.array;
  const b = TRUCK_TRACTORS.standard.bounds;
  const lx = (b[0] + b[1]) * 0.5;
  const ly = (b[2] + b[3]) * 0.5;
  const wx = x + lx * Math.cos(0.5) - ly * Math.sin(0.5);
  const wy = y + lx * Math.sin(0.5) + ly * Math.cos(0.5);
  assert.ok(Math.abs(d[0] - (wx - VIEW.x)) < 1e-2, 'x względem kamery');
  assert.ok(Math.abs(d[1] - (-(wy) + VIEW.y)) < 1e-2, 'y sceny odbite');
  assert.ok(Math.abs(d[2] - Math.cos(0.5)) < 1e-5);
  assert.ok(Math.abs(d[3] - Math.sin(0.5)) < 1e-5);
});

test('emitery: HDR > 1, płomień i moc rosną z ciągiem, światła wyłączone = same płomienie', () => {
  const { trucks } = make();
  const rig = trucks.add(placed('standard', 1), { livery: 0, trailers: [{ cargo: 'tank' }] });
  rig.throttle = 1;
  trucks.update(VIEW);
  const e = trucks.emitBuffer.array;
  const n = trucks.emitMesh.geometry.instanceCount;
  let lampHdr = 0;
  let flames = 0;
  let flameLen = 0;
  for (let i = 0; i < n; i++) {
    const q = i * 12;
    const kind = e[q + 6];
    const peak = Math.max(e[q + 8], e[q + 9], e[q + 10]);
    if (kind === 0) lampHdr = Math.max(lampHdr, peak);
    if (kind === 1) { flames++; flameLen = e[q + 4]; assert.ok(peak > 1, 'płomień HDR'); }
  }
  assert.equal(flames, TRUCK_TRACTORS.standard.nozzles.length);
  assert.ok(lampHdr > 1, 'lampa HDR');
  rig.throttle = 0;
  trucks.update(VIEW);
  assert.ok(e[4] < flameLen, 'płomień krótszy bez ciągu');
  rig.lights = false;
  trucks.update(VIEW);
  assert.equal(trucks.emitMesh.geometry.instanceCount, flames);
});

test('daleki zoom: naczepa nie znika (najmniejsza szerokość w px), lampy z najmniejszym promieniem, cull poza kadrem', () => {
  const { trucks } = make();
  trucks.add(placed('heavy', 3), { livery: 3, trailers: [{}, {}, {}] });
  trucks.update({ ...VIEW, ppu: 0.1 });
  const d = trucks.spriteBuffer.array;
  const bodyH = (TRUCK_TRAILER.bounds[3] - TRUCK_TRAILER.bounds[2]);
  assert.ok(d[5 + 20] > bodyH, 'poszerzona rama');
  assert.ok(d[5 + 20] * 0.1 >= 2.4, 'co najmniej 2,4 px');
  trucks.update({ ...VIEW, ppu: 1 });
  assert.equal(d[5 + 20], bodyH, 'z bliska bez zmian');
  trucks.update({ ...VIEW, x: VIEW.x + 1e6 });
  assert.equal(trucks.stats.drawn, 0);
  assert.equal(trucks.spriteMesh.visible, false);
});

test('farby rodzin: hazmat stały, zbiornik z płaszczem, zsyp z materiałem', () => {
  const hz = truckCargoPaints('hazmat', 3);
  assert.equal(hz, truckCargoPaints('hazmat', 5), 'ta sama farba hazmat');
  assert.notDeepEqual(truckCargoPaints('hopper', 0, 0, 'ice').accent, truckCargoPaints('hopper', 0, 0, 'ore').accent);
  assert.notDeepEqual(truckCargoPaints('standard', 0).paint, truckCargoPaints('standard', 1).paint);
});

test('update bez alokacji w stanie ustalonym', async () => {
  const { trucks } = make(16);
  const train = placed('heavy', 5);
  const rig = trucks.add(train, { livery: 1, trailers: Array(5).fill({ cargo: 'standard' }) });
  rig.throttle = 0.5;
  const v = { ...VIEW };
  let t = 0;
  const step = () => {
    t += 1 / 60;
    v.time = t;
    trucks.update(v);
  };
  const warm = () => { for (let i = 0; i < 1500; i++) step(); };
  warm();
  const bytes = await untilSteady(() => allocatedBytes(step, 500), (b) => b < 500 * 96, { warm });
  assert.ok(bytes < 500 * 96, `alokacje ${bytes} B na 500 klatek`);
  stepTruckTrain(train, VIEW.x, VIEW.y, 0, 1 / 60);
  assert.ok(SPACE_TRUCKS_SHARED.uPpu.value > 0);
});

test('PNG atlasu: wymiary z danych, pojedyncze płótna istnieją', () => {
  const size = (url) => {
    const b = readFileSync(new URL(url));
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  for (const u of Object.values(TRUCK_ATLAS.urls)) assert.deepEqual(size(u), [...TRUCK_ATLAS.size]);
  for (const u of Object.values(TRUCK_SPRITE_PNG)) assert.ok(size(u)[0] > 200);
});
