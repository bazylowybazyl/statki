// Drony roju (dema/roj-webgpu.html, docs/webgpu/DEMO-ROJ.md): klasy S / M / L / Capital, JEDEN
// kontener standardowy, chwyt płaski S 1 / M 2 / L 4 / Capital 8 (decyzja użytkownika 2026-10-06),
// ramiona z chwytakami w gniazdach narożnych (teleskop w większych klasach; IK chwytu — lustro
// shadera), obrysy do unikania, tablica klas GPU, bryła (bez wirników), moduły ładowni = wielokrotność chwytu.
// node --test tests/swarmDrones.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SWARM_CASTING, SWARM_CELL_PITCH, SWARM_CLASS_IDS, SWARM_DRONE_CLASSES, SWARM_DRONE_CLASS_LIST, SWARM_MAX_ARMS, SWARM_MAX_PACK,
  swarmArmPose, swarmClassForFootprint, swarmContainerMass, swarmDroneClass, swarmPackSize, swarmPackSlotOffset, swarmPackTiles, swarmPayload
} from '../src/data/swarmDrones.js';
import { CARGO_BAY_HULLS, CARGO_CONTAINER, cargoHullBays, cargoModuleContainer, cargoModuleSize } from '../src/data/cargoBays.js';
import { SWARM_ARM_ROWS, SWARM_CLASS_ROW, SWARM_CLASS_ROWS, swarmClassTableRows, swarmEmptyFootprint } from '../src/3d/swarm/swarmClassTable.js';
import { SWARM_DRONE_MAT, buildSwarmDroneGeometry } from '../src/3d/swarm/swarmDroneModel.js';

test('jeden kontener, chwyt płaski: S 1, M 2 (burta w burtę), L 4 (2 × 2), Capital 8 (4 × 2)', () => {
  assert.deepEqual(SWARM_CLASS_IDS, ['S', 'M', 'L', 'C']);
  const packs = { S: [1, 1], M: [1, 2], L: [2, 2], C: [4, 2] };
  for (const id of SWARM_CLASS_IDS) {
    const c = SWARM_DRONE_CLASSES[id];
    const [nx, ny] = packs[id];
    assert.deepEqual([c.pack.nx, c.pack.ny], [nx, ny], `${id}: chwyt`);
    assert.equal(c.volume, nx * ny);
    assert.ok(c.volume <= SWARM_MAX_PACK);
    // Warstwa płasko: wysokość chwytu = jeden kontener; długość / szerokość jak moduł ładowni nx × ny × 1.
    const m = cargoModuleSize({ nx, ny, nz: 1 }, {});
    assert.equal(c.payload.H, CARGO_CONTAINER.H, `${id}: płasko (bez piętrowania pod hakiem)`);
    assert.equal(c.payload.L, m.L);
    assert.equal(c.payload.W, m.W);
    assert.deepEqual(swarmPackSize(nx, ny, {}), { nx, ny, L: m.L, W: m.W, H: CARGO_CONTAINER.H, count: nx * ny });
    assert.equal(swarmDroneClass(c.index), c);
    assert.equal(swarmPayload(id), c.payload);
  }
  assert.deepEqual(SWARM_CELL_PITCH, { a: CARGO_CONTAINER.L + CARGO_CONTAINER.gap, b: CARGO_CONTAINER.W + CARGO_CONTAINER.gap });
});

test('chwyty się zagnieżdżają: kolumnę obsługuje każda klasa, której chwyt dzieli obrys', () => {
  assert.equal(swarmClassForFootprint(1, 1), 'S');
  assert.equal(swarmClassForFootprint(1, 2), 'M');
  assert.equal(swarmClassForFootprint(2, 2), 'L');
  assert.equal(swarmClassForFootprint(4, 2), 'C');
  assert.equal(swarmClassForFootprint(4, 4), 'C', 'wagon: dwa chwyty Capital na warstwę');
  assert.equal(swarmClassForFootprint(2, 1), 'S', '2 × 1 — tylko pojedyncze kontenery');
  // Plac C (4 × 2) obsługują wszystkie klasy; Atlas (2 × 2) — wszystkie poza Capital.
  for (const id of SWARM_CLASS_IDS) assert.ok(swarmPackTiles(id, 4, 2), `${id} na placu C`);
  assert.ok(!swarmPackTiles('C', 2, 2) && swarmPackTiles('L', 2, 2) && swarmPackTiles('M', 2, 2) && swarmPackTiles('S', 2, 2));
  // Miejsca w chwycie = komórki modułu (ten sam wzór co cargoModuleContainer).
  for (const c of SWARM_DRONE_CLASS_LIST) {
    const mod = cargoModuleSize({ nx: c.pack.nx, ny: c.pack.ny, nz: 1 }, {});
    for (let k = 0; k < c.volume; k++) {
      const o = swarmPackSlotOffset(c.pack.nx, c.pack.ny, k, {});
      const m = cargoModuleContainer(mod, k, {});
      assert.ok(Math.abs(o.a - m.a) < 1e-9 && Math.abs(o.b - m.b) < 1e-9, `${c.id}: miejsce ${k}`);
    }
  }
});

test('ładownie: obrys modułu = wielokrotność chwytu klasy, która je obsługuje', () => {
  const want = { atlas: 'L', terran_frigate: 'S', terran_battleship: 'M', container_ship: 'M', long_haul_freighter: 'M', heavy_freighter: 'L', megafreighter_wagon: 'C' };
  for (const [id, cls] of Object.entries(want)) {
    for (const g of cargoHullBays(CARGO_BAY_HULLS[id])) assert.equal(swarmClassForFootprint(g.module.nx, g.module.ny), cls, `${id}/${g.id}`);
  }
});

test('większa klasa: większy chwyt, wolniejszy i bardziej bezwładny lot, wyższe pierwszeństwo', () => {
  for (let k = 1; k < SWARM_DRONE_CLASS_LIST.length; k++) {
    const a = SWARM_DRONE_CLASS_LIST[k - 1];
    const b = SWARM_DRONE_CLASS_LIST[k];
    assert.ok(b.volume > a.volume, `${b.id} > ${a.id} kontenerów`);
    assert.ok(b.flight.vMax < a.flight.vMax && b.flight.accel < a.flight.accel, `${b.id} wolniejszy od ${a.id}`);
    assert.ok(b.priority > a.priority, `${b.id} — wyższe pierwszeństwo`);
  }
  // Na burtę nx + 1 ramion (narożniki + styki kontenerów).
  assert.deepEqual(SWARM_DRONE_CLASS_LIST.map((c) => c.armCount), [4, 4, 6, 10]);
  for (const c of SWARM_DRONE_CLASS_LIST) assert.ok(c.armCount <= SWARM_MAX_ARMS);
});

test('masa: kontener standardowy × gęstość ładunku', () => {
  assert.ok(swarmContainerMass('ore') > swarmContainerMass('electronic'));
  assert.equal(swarmContainerMass('nieznana'), 2);
});

test('Capital zabezpiecza 8 kontenerów: każdy za dwa gniazda narożne zewnętrznej krawędzi', () => {
  for (const c of SWARM_DRONE_CLASS_LIST) {
    const { nx, ny } = c.pack;
    const pins = [];
    for (const a of c.arms) {
      const xs = a.twin > 0 ? [a.grip[0] - a.twin / 2, a.grip[0] + a.twin / 2] : [a.grip[0]];
      for (const x of xs) pins.push([x, a.grip[1]]);
    }
    for (let k = 0; k < c.volume; k++) {
      // Środek kontenera k i jego gniazda na krawędzi zewnętrznej (burta chwytu).
      const o = swarmPackSlotOffset(nx, ny, k, {});
      const outer = ny === 1 ? [1, -1] : [Math.sign(o.b)];
      let held = 0;
      for (const side of outer) {
        for (const end of [-1, 1]) {
          const gx = o.a + end * (CARGO_CONTAINER.L / 2 - SWARM_CASTING.a);
          const gy = o.b + side * (CARGO_CONTAINER.W / 2 - SWARM_CASTING.b);
          if (pins.some(([px, py]) => Math.abs(px - gx) < 1e-6 && Math.abs(py - gy) < 1e-6)) held++;
        }
      }
      assert.ok(held >= 2, `${c.id}: kontener ${k} trzymany za ${held} gniazda`);
    }
  }
});

test('ramię: przy e = 1 nadgarstek dokładnie nad gniazdem (IK), łokieć w górę i w obrysie chwytu, teleskop', () => {
  for (const c of SWARM_DRONE_CLASS_LIST) {
    let tele = 0;
    for (const arm of c.arms) {
      const p = swarmArmPose(arm, 1, {});
      const err = Math.hypot(p.wrist[0] - arm.grip[0], p.wrist[1] - arm.grip[1], p.wrist[2] - arm.grip[2]);
      assert.ok(err < 1e-9, `${c.id} ramię ${arm.index}: błąd chwytu ${err}`);
      assert.ok(Math.abs(p.l2 - arm.l2Grip) < 1e-12, `${c.id} ramię ${arm.index}: teleskop wysunięty w chwycie`);
      // Łokieć zgięty w górę (nie wyprostowana tyka): powyżej prostej bark → nadgarstek.
      const gx = arm.grip[0] - arm.shoulder[0];
      const gy = arm.grip[1] - arm.shoulder[1];
      const gh = Math.hypot(gx, gy);
      if (gh > 1e-6) {
        const s = ((p.elbow[0] - arm.shoulder[0]) * gx + (p.elbow[1] - arm.shoulder[1]) * gy) / (gh * gh);
        const zLine = arm.shoulder[2] + (arm.grip[2] - arm.shoulder[2]) * Math.max(0, Math.min(1, s));
        assert.ok(p.elbow[2] > zLine, `${c.id} ramię ${arm.index}: łokieć w górę`);
      }
      // Gniazdo w obrysie chwytu; łokieć nie wystaje poza obrys (sąsiednie szyby kolumn).
      assert.ok(Math.abs(arm.grip[0]) < c.payload.L / 2 && Math.abs(arm.grip[1]) < c.payload.W / 2);
      assert.ok(Math.abs(p.elbow[0]) <= c.payload.L / 2 + 0.5 && Math.abs(p.elbow[1]) <= c.payload.W / 2 + 0.5, `${c.id} ramię ${arm.index}: łokieć w obrysie`);
      // Złożone (e = 0): teleskop schowany, ramię blisko kadłuba (zasięg pustego drona liczy się z tej pozy).
      const f = swarmArmPose(arm, 0, {});
      assert.ok(Math.abs(f.l2 - arm.sleeve) < 1e-12 && f.ext === 0);
      assert.ok(Math.hypot(f.wrist[0], f.wrist[1]) <= c.extents.empty.rh + 1e-6);
      if (arm.ext > 1e-3) tele++;
    }
    // S bez teleskopu; większe klasy — ramiona narożne wysuwane (Capital najdalej).
    if (c.id === 'S') assert.equal(tele, 0);
    else assert.ok(tele >= 4, `${c.id}: ramiona wysuwane ${tele}`);
  }
  const maxExt = (id) => Math.max(...SWARM_DRONE_CLASSES[id].arms.map((a) => a.ext));
  assert.ok(maxExt('C') > maxExt('L') && maxExt('L') > maxExt('M'), 'większy dron — dłuższy wysuw');
});

test('obrysy do unikania: pusty w zasięgu, z ładunkiem — warstwa kontenerów pod hakiem', () => {
  for (const c of SWARM_DRONE_CLASS_LIST) {
    const fp = swarmEmptyFootprint(c);
    assert.ok(fp.hx <= c.extents.empty.rh + 0.5 && fp.hy <= c.extents.empty.rh + 0.5, `${c.id}: obrys pusty w promieniu`);
    assert.ok(c.extents.loaded.rh >= Math.hypot(c.payload.L / 2, c.payload.W / 2));
    assert.ok(c.extents.loaded.zLo <= -c.payload.H, `${c.id}: dół pasma z ładunkiem pod kontenerami`);
    assert.ok(c.extents.empty.zLo > 0, `${c.id}: pusty — szczęki nad hakiem`);
    // Pusty dron mieści się w obrysie swojej warstwy (+ 0,3 j.): schodzi w szyb kolumny 1 j. obok
    // pracującego drona (wagon: dwa chwyty Capital na warstwę slotu) — szerszy blokował się z nim.
    assert.ok(fp.hy <= c.payload.W / 2 + 0.3, `${c.id}: pusty ±${fp.hy.toFixed(2)} j. w poprzek, warstwa ±${(c.payload.W / 2).toFixed(2)}`);
    assert.ok(fp.hx <= c.payload.L / 2 + 0.3, `${c.id}: pusty wzdłuż w obrysie warstwy`);
  }
});

test('tablica klas GPU: wiersze klasy, chwyt nx × ny, chwyt IK i teleskop policzone raz na CPU', () => {
  const rows = swarmClassTableRows();
  assert.equal(rows.length, SWARM_DRONE_CLASS_LIST.length * SWARM_CLASS_ROWS * 4);
  assert.equal(SWARM_CLASS_ROW.LIGHTS, SWARM_CLASS_ROW.ARMS + SWARM_MAX_ARMS * SWARM_ARM_ROWS);
  for (const c of SWARM_DRONE_CLASS_LIST) {
    const at = (row, k) => rows[(c.index * SWARM_CLASS_ROWS + row) * 4 + k];
    assert.equal(at(SWARM_CLASS_ROW.PAYLOAD, 0), Math.fround(c.payload.L));
    assert.equal(at(SWARM_CLASS_ROW.FLIGHT, 0), c.flight.vMax);
    assert.deepEqual([at(SWARM_CLASS_ROW.FOOT_EMPTY, 2), at(SWARM_CLASS_ROW.FOOT_EMPTY, 3)], [c.pack.nx, c.pack.ny]);
    for (const arm of c.arms) {
      const r = SWARM_CLASS_ROW.ARMS + arm.index * SWARM_ARM_ROWS;
      assert.ok(Math.abs(at(r + 3, 0) - arm.gripPhi) < 1e-5 && Math.abs(at(r + 3, 1) - arm.gripTheta1) < 1e-5 && Math.abs(at(r + 3, 2) - arm.gripFore) < 1e-5);
      assert.ok(Math.abs(at(r + 1, 3) - arm.l2Grip) < 1e-5 && Math.abs(at(r + 3, 3) - arm.sleeve) < 1e-5, 'teleskop: l2 w chwycie, tuleja');
      assert.ok(Math.abs(at(r + 4, 0) - arm.twin) < 1e-6, 'chwytak podwójny');
    }
  }
});

test('bryła: kadłub, silniki jonowe, ramiona z teleskopem i chwytakami — bez wirników', () => {
  for (const c of SWARM_DRONE_CLASS_LIST) {
    const g = buildSwarmDroneGeometry(c, 'hi', THREE);
    const mat = g.getAttribute('aMat');
    const rig = g.getAttribute('aRig');
    assert.ok(mat && rig, `${c.id}: atrybuty materiału i szkieletu`);
    const mats = new Set();
    const parts = new Set();
    const arms = new Set();
    for (let k = 0; k < mat.count; k++) { mats.add(mat.getX(k)); if (rig.getY(k) > 0) { parts.add(rig.getY(k)); arms.add(rig.getX(k)); } }
    assert.ok(mats.has(SWARM_DRONE_MAT.E_ENGINE), `${c.id}: dysze jonowe`);
    assert.ok(mats.has(SWARM_DRONE_MAT.E_CLAW) || mats.has(SWARM_DRONE_MAT.STEEL), `${c.id}: chwytaki`);
    assert.equal(arms.size, c.armCount, `${c.id}: liczba ramion w bryle`);
    for (const p of [1, 2, 3, 4, 5]) assert.ok(parts.has(p), `${c.id}: część ramienia ${p}`);
    if (c.tele) for (const p of [6, 7]) assert.ok(parts.has(p), `${c.id}: człon teleskopu ${p}`);
    else assert.ok(!parts.has(6) && !parts.has(7), `${c.id}: bez teleskopu`);
    const lo = buildSwarmDroneGeometry(c, 'lo', THREE);
    assert.ok(lo.getAttribute('position').count < g.getAttribute('position').count, `${c.id}: LOD lżejszy`);
  }
});
