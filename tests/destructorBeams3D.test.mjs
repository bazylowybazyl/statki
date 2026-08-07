import test from 'node:test';
import assert from 'node:assert/strict';

import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure, BEAM_TYPE } from '../src/game/beamBody3D.js';
import { DestructorBeams3D, createBeamConfig } from '../src/game/destructorBeams3D.js';

const CS = 0.5;

function structure({ w = 3, h = 3, d = 3, shell = 0, frameStride = 1, bulkheadEvery = 8 } = {}) {
  const vox = voxelizeTriangles(
    makeBoxTriangles(w, h, d, 0.05, 0.05, 0.05),
    null,
    { cellSize: CS, shellLayers: shell }
  );
  return buildBeamStructure(vox, { cellMassBase: 10, frameStride, bulkheadEvery });
}

function clone(src) {
  return {
    ...src,
    nodes: src.nodes.map((n) => ({ ...n, beams: n.beams.slice() })),
    beams: src.beams.map((b) => ({ ...b })),
    invInertia: src.invInertia.slice()
  };
}

function fresh(overrides = {}) {
  const cfg = createBeamConfig(CS);
  Object.assign(cfg, overrides);
  DestructorBeams3D.init(cfg);
  DestructorBeams3D.onDebris = null;
  return cfg;
}

function makeBody(opts = {}, structOpts = {}) {
  return DestructorBeams3D.createBody(clone(structure(structOpts)), opts);
}

function maxNodeDisplacement(body) {
  let peak = 0;
  for (const n of body.nodes) {
    if (!n.active) continue;
    const d = Math.abs(n.x - n.ox) + Math.abs(n.y - n.oy) + Math.abs(n.z - n.oz);
    if (d > peak) peak = d;
  }
  return peak;
}

test('createBody: masa, promień, aktywne węzły i belki', () => {
  fresh();
  const body = makeBody();
  assert.ok(body.mass > 0);
  assert.ok(body.radius > 1);
  assert.equal(body.activeNodes, body.nodes.length);
  assert.equal(body.liveBeams, body.beams.length);
  for (const v of body.invInertiaLocal) assert.ok(Number.isFinite(v));
});

test('solver zachowuje kształt spoczynkowy w spokoju', () => {
  fresh();
  const body = makeBody();
  for (let i = 0; i < 240; i++) DestructorBeams3D.solveSoftBody(1 / 120, [body]);
  assert.ok(maxNodeDisplacement(body) < 1e-6, 'konstrukcja dryfuje bez żadnego obciążenia');
});

test('konstrukcja stawia opór ścinaniu (przekątne działają)', () => {
  // Regresja na wadę starej kratownicy: sprężyny liczone z RZUTU na kierunek
  // spoczynkowy dawały zerową siłę przy czystym ścinaniu, więc bryła składała
  // się w romb za darmo. Z przekątnymi przesunięcie musi być cofane.
  fresh({ solverIterations: 6, nodeDamping: 0 });
  const body = makeBody({}, { w: 3, h: 3, d: 3 });
  const top = body.nodes.filter((n) => n.oy > 0.6);
  assert.ok(top.length > 3, 'brak górnej warstwy do ścinania');

  const shear = CS * 0.6;
  for (const n of top) n.x += shear;
  const before = top.reduce((s, n) => s + (n.x - n.ox), 0) / top.length;

  for (let i = 0; i < 60; i++) DestructorBeams3D.solveSoftBody(1 / 120, [body]);
  const after = top.reduce((s, n) => s + (n.x - n.ox), 0) / top.length;

  assert.ok(Math.abs(after) < Math.abs(before) * 0.75,
    `ścinanie nie zostało cofnięte: ${before.toFixed(4)} → ${after.toFixed(4)}`);
});

test('odkształcenie plastyczne zostaje po ustaniu obciążenia', () => {
  fresh({ solverIterations: 4, plasticRate: 0.9 });
  const body = makeBody();
  const beam = body.beams[0];
  const restBefore = beam.rest;
  const a = body.nodes[beam.a];
  const c = body.nodes[beam.b];

  // rozciągnij mocno ponad próg plastyczności, ale poniżej progu zerwania
  const dx = (c.x - a.x), dy = (c.y - a.y), dz = (c.z - a.z);
  const len = Math.hypot(dx, dy, dz);
  const stretch = beam.deform * 3;
  c.x += (dx / len) * beam.rest * stretch;
  c.y += (dy / len) * beam.rest * stretch;
  c.z += (dz / len) * beam.rest * stretch;

  DestructorBeams3D.solveSoftBody(1 / 120, [body]);
  assert.ok(beam.rest > restBefore, `długość spoczynkowa nie urosła: ${restBefore} → ${beam.rest}`);
  assert.ok(!beam.broken, 'belka pękła zamiast odkształcić się plastycznie');
});

test('belka pęka po przekroczeniu progu zerwania', () => {
  fresh({ solverIterations: 1 });
  const body = makeBody();
  const beam = body.beams[0];
  const a = body.nodes[beam.a];
  const c = body.nodes[beam.b];
  const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  const over = beam.break * 4;
  c.x += (dx / len) * beam.rest * over;
  c.y += (dy / len) * beam.rest * over;
  c.z += (dz / len) * beam.rest * over;

  DestructorBeams3D.solveSoftBody(1 / 120, [body]);
  assert.equal(beam.broken, true, 'belka nie pękła mimo przekroczenia progu');
  assert.ok(body.structureDirty, 'zerwanie nie oznaczyło konstrukcji do sprawdzenia rozpadów');
});

test('breakEnabled=0 wyłącza zrywanie (materiał tylko się gnie)', () => {
  fresh({ solverIterations: 1, breakEnabled: 0 });
  const body = makeBody();
  const beam = body.beams[0];
  const c = body.nodes[beam.b];
  c.x += beam.rest * beam.break * 5;
  DestructorBeams3D.solveSoftBody(1 / 120, [body]);
  assert.equal(beam.broken, false);
});

test('zderzenie: kontakty, wytracenie prędkości, brak przenikania', () => {
  const cfg = fresh();
  const A = makeBody({ name: 'A', position: { x: -3, y: 0, z: 0 }, velocity: { x: cfg.crushSpeedThreshold * 3, y: 0, z: 0 } });
  const B = makeBody({ name: 'B', position: { x: 3, y: 0, z: 0 }, velocity: { x: -cfg.crushSpeedThreshold * 3, y: 0, z: 0 } });
  const bodies = [A, B];

  let sawContacts = false;
  for (let i = 0; i < 400; i++) {
    DestructorBeams3D.integrate(1 / 120, bodies);
    DestructorBeams3D.update(1 / 120, bodies);
    if (DestructorBeams3D.perf.contacts > 0) sawContacts = true;
  }
  assert.ok(sawContacts, 'brak kontaktów w zderzeniu czołowym');
  assert.ok(A.pos.x < B.pos.x, 'ciała się przeniknęły');
  assert.ok(A.vel.x < cfg.crushSpeedThreshold * 3, 'A nie wytraciło prędkości');
});

test('zderzenie wgniata konstrukcję TRWALE (plastyczność belek)', () => {
  const cfg = fresh();
  const A = makeBody({ name: 'A', position: { x: -3, y: 0, z: 0 }, velocity: { x: cfg.crushSpeedThreshold * 6, y: 0, z: 0 } });
  const B = makeBody({ name: 'B', position: { x: 3, y: 0, z: 0 }, velocity: { x: -cfg.crushSpeedThreshold * 6, y: 0, z: 0 } });
  const bodies = [A, B];

  // Chwilowe ugięcie w trakcie kontaktu jest sprężyste i po nim wraca. Miarą
  // zgniotu jest to, co ZOSTAJE: zmienione długości spoczynkowe belek.
  let peakDuringImpact = 0;
  for (let i = 0; i < 400; i++) {
    DestructorBeams3D.integrate(1 / 120, bodies);
    DestructorBeams3D.update(1 / 120, bodies);
    const p = Math.max(maxNodeDisplacement(A), maxNodeDisplacement(B));
    if (p > peakDuringImpact) peakDuringImpact = p;
  }

  const plastic = (b) => b.beams.filter((x) => Math.abs(x.rest - x.restBase) > 1e-6).length;
  assert.ok(peakDuringImpact > CS * 0.1, `konstrukcja się nie ugięła (peak=${peakDuringImpact})`);
  assert.ok(plastic(A) > 0 || plastic(B) > 0, 'żadna belka nie odkształciła się trwale');
  assert.ok(A.vel.x < cfg.crushSpeedThreshold, 'energia nie została pochłonięta przez zgniot');
});

test('applyImpact: uszkadza węzły i zrywa belki w rdzeniu trafienia', () => {
  fresh();
  const body = makeBody({ position: { x: 5, y: 0, z: 0 } });
  const liveBefore = body.beams.filter((b) => !b.broken).length;

  const hit = DestructorBeams3D.raycastBody(body, 40, 0, 0, -1, 0, 0, 200);
  assert.ok(hit, 'raycast nie trafił w konstrukcję');
  assert.ok(hit.x > body.pos.x, 'trafienie powinno być po stronie +X');

  DestructorBeams3D.applyImpact(body, hit.x, hit.y, hit.z, 900, { x: -20, y: 0, z: 0 }, { radius: CS * 3 });
  const liveAfter = body.beams.filter((b) => !b.broken).length;
  assert.ok(liveAfter < liveBefore, 'trafienie nie zerwało żadnej belki');
});

test('gródź wytrzymuje trafienie, które przecina poszycie', () => {
  fresh();
  const body = makeBody({}, { w: 8, h: 3, d: 3, shell: 2, bulkheadEvery: 4 });
  const bulkheads = body.beams.filter((b) => b.type === BEAM_TYPE.BULKHEAD);
  assert.ok(bulkheads.length > 0, 'brak grodzi w konstrukcji');

  // Trafienie o sile wystarczającej na poszycie (90), za słabe na gródź (380).
  // Celujemy DOKŁADNIE w gródź i trzymamy trafienie lokalne — inaczej zniknięcie
  // całego poszycia i tak zabrałoby konstrukcję kaskadą osamotnionych węzłów.
  for (const n of body.nodes) { n.hp = 1e9; n.maxHp = 1e9; }
  const anchor = body.nodes[bulkheads[0].a];
  const radius = CS * 2.5;
  DestructorBeams3D.applyImpact(body, anchor.x + body.pos.x, anchor.y + body.pos.y, anchor.z + body.pos.z,
    120, null, { radius, breakRadius: radius });

  const inRadius = (beam) => {
    const a = body.nodes[beam.a], c = body.nodes[beam.b];
    const mx = (a.x + c.x) * 0.5 - anchor.x;
    const my = (a.y + c.y) * 0.5 - anchor.y;
    const mz = (a.z + c.z) * 0.5 - anchor.z;
    return (mx * mx + my * my + mz * mz) <= radius * radius;
  };

  const platingBroken = body.beams.filter((b) => b.type === BEAM_TYPE.PLATING && b.broken).length;
  const bulkheadHitAndBroken = bulkheads.filter((b) => inRadius(b) && b.broken).length;
  assert.ok(platingBroken > 0, 'poszycie nie ucierpiało');
  assert.equal(bulkheadHitAndBroken, 0, 'gródź pękła od trafienia, które powinna wytrzymać');
});

test('przecięcie: zerwanie belek w płaszczyźnie dzieli ciało na dwa wraki', () => {
  fresh();
  const body = makeBody({ position: { x: 2, y: 1, z: -1 } }, { w: 8, h: 3, d: 3, shell: 2, bulkheadEvery: 0 });
  const bodies = [body];
  const nodesBefore = body.activeNodes;
  const massBefore = body.mass;

  // Przetnij wszystkie belki przechodzące przez płaszczyznę x = 0.
  let cut = 0;
  for (const beam of body.beams) {
    const a = body.nodes[beam.a];
    const c = body.nodes[beam.b];
    if ((a.ox <= 0) !== (c.ox <= 0)) { beam.broken = true; cut++; }
  }
  assert.ok(cut > 0, 'nie przecięto żadnej belki');
  body.structureDirty = true;

  const islands = DestructorBeams3D.findIslands(body);
  assert.equal(islands.length, 2, `oczekiwano 2 sekcji, jest ${islands.length}`);

  DestructorBeams3D.splitQueue.push(body);
  DestructorBeams3D.processSplits(bodies);

  assert.equal(bodies.length, 2, 'nie powstał wrak');
  const wreck = bodies.find((b) => b !== body);
  assert.ok(wreck.isWreck);
  assert.equal(body.activeNodes + wreck.activeNodes, nodesBefore, 'zgubione węzły przy rozłamie');
  assert.ok(Math.abs((body.mass + wreck.mass) - massBefore) < 1e-6, 'masa się nie sumuje');

  // Obie sekcje muszą mieć własny środek masy i spójne numery belek.
  for (const b of bodies) {
    let mx = 0, m = 0;
    for (const n of b.nodes) { mx += n.ox * n.mass; m += n.mass; }
    assert.ok(Math.abs(mx / m) < 1e-6, `sekcja nie wyśrodkowana: ${mx / m}`);
    for (const beam of b.beams) {
      assert.ok(b.nodes[beam.a] && b.nodes[beam.b], 'belka wskazuje nieistniejący węzeł');
    }
    for (let i = 0; i < b.nodes.length; i++) assert.equal(b.nodes[i].id, i, 'id węzła rozjechane z indeksem');
    assert.deepEqual(b.skinLatticeMin, bodies[0].skinLatticeMin, 'układ kratownicy skóry przesunięty');
  }
});

test('węzeł bez oparcia w belkach znika (dziura w kadłubie)', () => {
  fresh();
  const body = makeBody();
  const node = body.nodes.find((n) => n.surface);
  assert.ok(node);
  for (const bi of node.beams) body.beams[bi].broken = true;
  DestructorBeams3D._refreshNodeIntegrity(body);
  assert.equal(node.active, false, 'osamotniony węzeł nadal istnieje');
});

test('repair przywraca długości spoczynkowe i zrasta belki', () => {
  fresh();
  const body = makeBody();
  const beam = body.beams[0];
  beam.rest = beam.restBase * 1.4;
  body.beams[1].broken = true;
  for (let i = 0; i < 200; i++) DestructorBeams3D.repair([body], 0.1);
  assert.ok(Math.abs(beam.rest - beam.restBase) < 1e-3, `długość nie wróciła: ${beam.rest}`);
  assert.equal(body.beams[1].broken, false, 'belka się nie zrosła');
});

test('ciało zasypia po ustaniu ruchu', () => {
  fresh();
  const body = makeBody();
  for (let i = 0; i < 400; i++) DestructorBeams3D.solveSoftBody(1 / 120, [body]);
  assert.ok(body.isSleeping, 'konstrukcja nie zasnęła mimo bezruchu');
});
