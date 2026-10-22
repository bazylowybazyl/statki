// Przeładunek w portach (E12): plan przy stanowisku (src/game/swarm/berthTransfer.js), blok migawki `cargoOps`,
// mapa kadłubów proxy ruchu → ładownie i materiały partii (WGSL w Node: ładownie floty, taśmy, drony z bufora).
// node --test tests/portCargo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { instancedArray } from 'three/tsl';

import {
  BERTH_TRANSFER_TUNE, berthTransferCounts, berthTransferDoor, berthTransferState, berthYardGeometry, planBerthTransfer,
  shipInBerth
} from '../src/game/swarm/berthTransfer.js';
import { TRAFFIC_CARGO_BAY_HULLS, cargoBayHull, cargoHullBays } from '../src/data/cargoBays.js';
import { TRAFFIC_HULLS, trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { SWARM_DRONE_CLASSES, SWARM_LOADED_SPEED } from '../src/data/swarmDrones.js';
import { applyCargoOpsBlock, cargoOpsBlockSize, packCargoOpsBlock } from '../src/render/blocks/cargoOpsBlock.js';
import { CargoBayBatch } from '../src/3d/cargo/bayBatch.tsl.js';
import { PortConveyors } from '../src/3d/cargo/conveyor.tsl.js';
import { SwarmDroneMeshes } from '../src/3d/swarm/swarmDrones.tsl.js';
import { buildSwarmDroneGeometries } from '../src/3d/swarm/swarmDroneModel.js';

const PADS = { S: [400, 250], M: [620, 380], L: [1000, 660], MEGA: [2900, 1150] };
const berth = (size) => ({ size, padLength: PADS[size][0], padBeam: PADS[size][1], portalGap: size === 'MEGA' ? 150 : 0 });
const plan = (hull, size, mode, fill, extra = {}) => planBerthTransfer({
  seed: 37, hull, mode, fill, resourceId: 'copper_ore', dwell: mode === 'load' ? 90 : 120, berth: berth(size), ...extra
});

test('mapa proxy ruchu → ładownia: ten sam obrazek (sprite proxy = pusty pokład Z11) i długość rysunku', () => {
  for (const [proxy, key] of Object.entries(TRAFFIC_CARGO_BAY_HULLS)) {
    const H = cargoBayHull(key);
    assert.ok(H, `${proxy}: kadłub ładowni ${key}`);
    const spr = TRAFFIC_HULLS[proxy].sprite.split('/').pop().replace(/\.png$/, '');
    const bay = H.sprite.split('/').pop().replace(/_empty\.png$/, '');
    assert.equal(bay, spr, `${proxy}: sprite proxy ${spr} ↔ ładownia ${bay}`);
    assert.deepEqual([H.png.w, H.png.h], TRAFFIC_HULLS[proxy].png, `${proxy}: płótno`);
    assert.ok(Math.abs(trafficHullRenderSize(proxy).length - H.renderLength) < 1e-6, `${proxy}: długość rysunku`);
  }
});

test('UNLOAD: ładownia pełna na starcie, pusta po oknie; wrota zamknięte poza oknem; bez skali tempa', () => {
  const p = plan('container_ship', 'M', 'unload', 1);
  assert.equal(p.containers, 56);
  assert.equal(p.speedScale, 1);
  const c0 = berthTransferCounts(p, 0);
  assert.equal(c0.containersBay, 56);
  assert.equal(c0.door, 0);
  const mid = berthTransferCounts(p, p.swarmStart + 12);
  assert.ok(mid.drones > 0 && mid.door > 0, 'drony w locie, wrota otwarte');
  const end = berthTransferCounts(p, p.window.end + 1);
  assert.equal(end.containersBay + end.carried + end.table + end.belt, 0, 'wszystko w porcie');
  assert.equal(end.door, 0);
});

test('LOAD: ładownia pusta na starcie, wypełnienie = ładunek kursu po oknie', () => {
  const p = plan('long_haul_freighter', 'L', 'load', 0.5);
  assert.equal(p.containers, Math.ceil(108 * 0.5));
  assert.equal(berthTransferCounts(p, 0).containersBay, 0);
  const end = berthTransferCounts(p, p.window.end + 1);
  assert.equal(end.containersBay, p.containers);
  assert.equal(end.carried + end.table + end.belt, 0);
});

test('zegar roju = czas gry × 4 i ruch klasy z dema (prędkość przelotu ≤ vMax klasy, z ładunkiem × 0,85)', () => {
  assert.equal(BERTH_TRANSFER_TUNE.clock, 4);
  const p = plan('container_ship', 'M', 'unload', 1);
  const cls = SWARM_DRONE_CLASSES.M;
  for (const d of p.drones) {
    for (const s of d.segs) {
      if (s.D > 1e-6 && s.vmax > 0) {
        const lim = s.carry >= 0 ? cls.flight.vMax * SWARM_LOADED_SPEED : cls.flight.vMax;
        assert.ok(s.vmax <= Math.max(lim, cls.flight.vVert) + 1e-9, `faza ${s.phase}: ${s.vmax} > ${lim}`);
      }
    }
  }
});

test('stół trzyma jedną warstwę naraz, komórka taśmy — jedną warstwę; LIFO ładowni (górna warstwa przed dolną)', () => {
  for (const mode of ['unload', 'load']) {
    const p = plan('long_haul_freighter', 'L', mode, 1);
    const bySide = new Map();
    for (const ly of p.layers) {
      // Okres zajęcia stołu: UNLOAD od odłożenia do końca zsuwu, LOAD od zsuwu z taśmy do chwytu.
      const a = mode === 'unload' ? ly.tRel : ly.tSlide0;
      const b = mode === 'unload' ? ly.tSlide1 : ly.tGrip;
      const key = `${ly.side}:${ly.table}`;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push([a, b]);
    }
    for (const [key, list] of bySide) {
      list.sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < list.length; i++) assert.ok(list[i][0] >= list[i - 1][1] - 1e-6, `${mode} stół ${key} zajęty podwójnie`);
    }
    // LIFO w slocie: przy rozładunku wyższe piętro wychodzi wcześniej, przy załadunku — później.
    const bySlot = new Map();
    for (const ly of p.layers) { if (!bySlot.has(ly.slot)) bySlot.set(ly.slot, []); bySlot.get(ly.slot).push(ly); }
    for (const list of bySlot.values()) {
      list.sort((x, y) => x.tier - y.tier);
      for (let i = 1; i < list.length; i++) {
        if (mode === 'unload') assert.ok(list[i].tGrip < list[i - 1].tGrip, 'rozładunek: piętro przed dnem');
        else assert.ok(list[i].tRel > list[i - 1].tRel, 'załadunek: dno przed piętrem');
      }
    }
  }
});

test('materializacja w połowie postoju: stan to funkcja zegara (dwa wywołania w tej samej chwili dają to samo)', () => {
  const p = plan('container_ship', 'M', 'unload', 0.8);
  const t = p.swarmStart + 20;
  const a = []; const b = [];
  berthTransferState(p, t, { drone(i, d, r) { a.push(r.x, r.y, r.z, r.e, r.g); }, layer(ly, x, y, z) { a.push(x, y, z); } });
  berthTransferState(p, t, { drone(i, d, r) { b.push(r.x, r.y, r.z, r.e, r.g); }, layer(ly, x, y, z) { b.push(x, y, z); } });
  assert.deepEqual(a, b);
  assert.ok(berthTransferDoor(p, t) > 0);
});

test('plac pola: stoły po obu burtach poza obrysem statku, taśma dalej od burty niż stoły', () => {
  for (const size of ['S', 'M', 'L', 'MEGA']) {
    const g = berthYardGeometry({ ...berth(size), halfBeam: PADS[size][1] * 0.3 });
    assert.equal(g.sides.length, 2);
    for (const S of g.sides) {
      assert.ok(Math.abs(S.vTable) > PADS[size][1] * 0.3, `${size}: stół poza burtą`);
      assert.ok(Math.abs(S.vBelt) > Math.abs(S.vTable), `${size}: taśma za stołami`);
      assert.ok(Math.abs(S.vBelt) + S.belt.width / 2 <= PADS[size][1] / 2 + 1e-6, `${size}: taśma na polu`);
      assert.ok(S.tables.length >= 2);
    }
  }
});

test('statek w układzie stanowiska: shipInBerth', () => {
  const r = shipInBerth({ x: 100, y: 50, angle: Math.PI / 2 }, { x: 100, y: 80, angle: Math.PI / 2 + 0.1 });
  assert.ok(Math.abs(r.u - 30) < 1e-9 && Math.abs(r.v) < 1e-9 && Math.abs(r.angle - 0.1) < 1e-9);
});

test('blok cargoOps: pakowanie i odczyt (pola, przeładunki, gracz)', () => {
  const F = new Float64Array(cargoOpsBlockSize());
  const frame = {
    yards: [{ x: 6.7e6, y: 5.2e6, angle: 1.2, size: 'MEGA', padLength: 2900, padBeam: 1150, portalGap: 150, halfBeam: 550, seed: 3 }],
    yardCount: 1,
    ops: [{ seed: 1234, yard: 0, hull: 'container_ship', x: 6.7e6 + 1, y: 5.2e6 - 2, angle: 1.21, mode: 'unload', fill: 0.75,
      resourceId: 'copper_ore', dwell: 120, move: 6, dockTime: 33.5, halfBeam: 65 }],
    opCount: 1,
    player: { x: 1, y: 2, angle: 0.3, door: 0.5, fill: 0.4, hull: 'atlas', frigate: true, res: [['steel', 0.6], ['copper_ore', 0.4]] }
  };
  packCargoOpsBlock(F, frame);
  const out = applyCargoOpsBlock({ f64: F }, {});
  assert.equal(out.yardCount, 1);
  assert.equal(out.yards[0].size, 'MEGA');
  assert.equal(out.yards[0].x, 6.7e6);
  assert.equal(out.opCount, 1);
  const op = out.ops[0];
  assert.equal(op.hull, 'container_ship');
  assert.equal(op.mode, 'unload');
  assert.equal(op.resourceId, 'copper_ore');
  assert.equal(op.dockTime, 33.5);
  assert.equal(out.player.hull, 'atlas');
  assert.equal(out.player.frigate, true);
  assert.deepEqual(out.player.res.map((r) => r[0]), ['steel', 'copper_ore']);
});

// ---------------------------------------------------------------------------
// WGSL w Node (wzór tests/cargoTsl.test.mjs)
// ---------------------------------------------------------------------------

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
function vertexBuffers(geometry) {
  const set = new Set();
  for (const a of Object.values(geometry.attributes)) set.add(a.isInterleavedBufferAttribute ? a.data : a);
  return set.size;
}

test('partie (ładownie floty, taśmy, drony z bufora CPU): WGSL się buduje, limity WebGPU, jeden program na rodzaje', () => {
  const scene = new THREE.Scene();
  const bays = new CargoBayBatch(scene, 8);
  const meshes = bays.warmupMeshes(['container_ship', 'long_haul_freighter']);
  assert.equal(meshes.length, 4);
  const codes = new Map();
  for (const m of meshes) {
    const w = buildWGSL(m);
    assert.ok(w.vertex.length > 0 && w.fragment.length > 0, m.name);
    assert.ok(vertexBuffers(m.geometry) <= 8, `${m.name}: bufory wierzchołków`);
    const kind = m.name.includes('wnetrze') ? 'wnetrze' : 'wrota';
    if (codes.has(kind)) assert.equal(w.fragment, codes.get(kind), `${kind}: ten sam program dla rodzajów`);
    codes.set(kind, w.fragment);
  }
  const conv = new PortConveyors(scene, 8);
  const wc = buildWGSL(conv.mesh);
  assert.ok(wc.fragment.length > 0);
  assert.ok(vertexBuffers(conv.mesh.geometry) <= 8);
  const node = instancedArray(4 * 8 * 11, 'vec4').setName('portCargoDrones');
  const drones = new SwarmDroneMeshes(scene, node, buildSwarmDroneGeometries(THREE));
  const wd = buildWGSL(drones.warmupMeshes()[0]);
  assert.ok(wd.vertex.includes('portCargoDrones'));
  // Rekordy ładowni floty w tablicy świateł: ładownia rodzaju jest geometrią kadłuba.
  assert.ok(cargoHullBays('heavy_freighter_proxy')[0].module.nx === 2);
});
