import test from 'node:test';
import assert from 'node:assert/strict';

import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure, BEAM_TYPE } from '../src/game/beamBody3D.js';
import { DestructorBeams3D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { markOriginalBeamBridges } from '../src/game/beamConnectivity3D.js';

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

test('przycięte zapytania kontaktów zgadzają się z pełnym przeglądem, także na granicach hasha', () => {
  class CountingMap extends Map {
    reads = 0;
    get(key) { this.reads++; return super.get(key); }
  }
  for (const shift of [-0.501, -0.249, 0, 0.249, 0.501, 1.001]) {
    fresh({ maxContacts: 10000, separationPercent: 0 });
    const A = makeBody({ position: { x: shift, y: -shift * 0.4, z: shift * 0.7 },
      quaternion: { x: 0, y: Math.sin(0.3), z: 0, w: Math.cos(0.3) } }, { w: 1, h: 1, d: 1 });
    const B = makeBody({}, { w: 2, h: 2, d: 2 });
    B._hash = new CountingMap();
    const m = DestructorBeams3D._refreshRot(A);
    const world = n => ({ x: m[0] * n.x + m[1] * n.y + m[2] * n.z + A.pos.x,
      y: m[3] * n.x + m[4] * n.y + m[5] * n.z + A.pos.y,
      z: m[6] * n.x + m[7] * n.y + m[8] * n.z + A.pos.z });
    const expected = new Map();
    const limit = (CS * 1.1) ** 2;
    for (const a of A.nodes) {
      const p = world(a);
      let closest = limit;
      for (const b of B.nodes) closest = Math.min(closest, (p.x - b.x) ** 2 + (p.y - b.y) ** 2 + (p.z - b.z) ** 2);
      if (closest < limit) expected.set(a, closest);
    }
    const contactsBefore = DestructorBeams3D.perf.contacts;
    DestructorBeams3D.collideBodies(A, B, 1 / 120, false);
    assert.equal(DestructorBeams3D.perf.contacts - contactsBefore, expected.size);
    for (let i = 0; i < A._contacts.length; i++) {
      const a = A._contacts[i], b = B._contacts[i], p = world(a);
      const d2 = (p.x - b.x) ** 2 + (p.y - b.y) ** 2 + (p.z - b.z) ** 2;
      assert.ok(Math.abs(d2 - expected.get(a)) < 1e-10, 'najbliższy kontakt nie może zniknąć przez pruning');
    }
    assert.ok(B._hash.reads < A.nodes.length * 60 + B.nodes.length,
      `zapytania nadal skanują 125 kubików: ${B._hash.reads}`);
  }
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

test('przecięcie podpory rozdziela dwa pokłady bez belek przez otwartą szczelinę', () => {
  for (const bulkheadEvery of [0, 2]) {
    fresh();
    // Przekrój U: dwa cienkie pokłady, połączone wyłącznie na lewym końcu.
    const cells = [];
    for (let ix = 1; ix <= 10; ix++) {
      for (let iy = 2; iy <= 9; iy++) {
        if (ix > 2 && iy > 3 && iy < 8) continue;
        cells.push({ ix, iy, iz: 2, x: ix * CS, y: iy * CS, z: 2 * CS,
          coverage: 1, surface: true, depth: 1, r: 0.5, g: 0.5, b: 0.5 });
      }
    }
    const s = buildBeamStructure({ cells, nx: 13, ny: 12, nz: 5, cellSize: CS,
      origin: { x: -CS / 2, y: -CS / 2, z: -CS / 2 } }, { frameStride: 1, bulkheadEvery });
    const body = DestructorBeams3D.createBody(s);
    assert.equal(DestructorBeams3D.findIslands(body).length, 1);
    for (const node of body.nodes) if (node.ix <= 2) DestructorBeams3D.destroyNode(body, node);
    const islands = DestructorBeams3D.findIslands(body);
    assert.deepEqual(islands.map(g => g.length), [16, 16], `niewidoczna belka trzyma pokłady (grodzie: ${bulkheadEvery})`);
    const bodies = [body];
    DestructorBeams3D.splitQueue.push(body);
    DestructorBeams3D.processSplits(bodies);
    assert.equal(bodies.length, 2, 'każdy pokład powinien dostać niezależne ciało');
    assert.equal(bodies.reduce((sum, b) => sum + b.activeNodes, 0), 32);
  }
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

test('wyrwane mocowanie puszcza wręg nawet bez rozciągnięcia, a naprawa przywraca podparcie', () => {
  for (const breakEnabled of [0, 1]) {
    fresh({ breakEnabled });
    const body = makeBody({}, { w: 8, h: 3, d: 3, shell: 2, bulkheadEvery: 4 });
    const frame = body.beams.find(b => b.type >= BEAM_TYPE.FRAME && body.nodes[b.a].localBeamCount >= 4);
    assert.ok(frame, 'brak wręgu z mocowaniem do poszycia');
    const mount = body.nodes[frame.a];
    const support = mount.beams.filter(i => body.beams[i].type < BEAM_TYPE.FRAME);
    for (const i of support.slice(1)) body.beams[i].broken = true;
    body.liveBeams = body.beams.filter(b => !b.broken).length;
    DestructorBeams3D.solveSoftBody(1 / 120, [body]);
    assert.equal(frame.broken, !!breakEnabled, 'wręg nie może wisieć na wyrwanym mocowaniu');
    DestructorBeams3D.repair([body], 0.1);
    assert.equal(body.liveBeams, body.beams.length, 'naprawa musi odświeżyć topologię mocowań i skóry');
    DestructorBeams3D.solveSoftBody(1 / 120, [body]);
    assert.equal(frame.broken, false, 'naprawione mocowanie użyło nieaktualnego podparcia');
  }
});

test('ostatnia belka po rozdarciu usztywnionego kadłuba puszcza sekcję z zachowaniem ruchu', () => {
  for (const originalStrut of [false, true]) {
    fresh({ wreckOutwardKick: 0, wreckSpinResponse: 0 });
    const body = makeBody({ velocity: { x: 12, y: 1, z: 0 } }, { w: 8, h: 3, d: 3, shell: 2, bulkheadEvery: 0 });
    const bodies = [body];
    const baselines = new Map(body.nodes.map(n => [`${n.ix},${n.iy},${n.iz}`, n.localBeamCount]));
    const crossing = body.beams.filter(b => (body.nodes[b.a].ox > 0) !== (body.nodes[b.b].ox > 0));
    assert.ok(crossing.length > 1);
    const last = crossing[0];
    for (const b of crossing.slice(1)) b.broken = true;
    if (originalStrut) markOriginalBeamBridges(body.nodes, body.beams);
    for (const n of body.nodes) if (n.ox > 0) n.vz = 4;
    body.liveBeams = body.beams.filter(b => !b.broken).length;
    body.structureDirty = true;
    DestructorBeams3D.splitQueue.push(body);
    DestructorBeams3D.processSplits(bodies);
    assert.equal(last.broken, !originalStrut);
    assert.equal(bodies.length, originalStrut ? 1 : 2, 'rozdarty kadłub nadal wisi na pojedynczej belce');
    for (const b of bodies) for (const n of b.nodes) {
      assert.equal(n.localBeamCount, baselines.get(`${n.ix},${n.iy},${n.iz}`), 'podział zresetował stan pierwotnego mocowania');
    }
    if (!originalStrut) {
      assert.deepEqual(bodies.map(b => b.vel.z).sort((a, b) => a - b), [0, 4]);
      for (const b of bodies) {
        assert.equal(b.vel.x, 12); assert.equal(b.vel.y, 1);
        assert.equal(DestructorBeams3D.findIslands(b).length, 1);
      }
    }
  }
});

test('ciało zasypia po ustaniu ruchu', () => {
  fresh();
  const body = makeBody();
  for (let i = 0; i < 400; i++) DestructorBeams3D.solveSoftBody(1 / 120, [body]);
  assert.ok(body.isSleeping, 'konstrukcja nie zasnęła mimo bezruchu');
});

test('zgniot cofa dziób w głąb własnego kadłuba, a druga iteracja nie zgniata ponownie', () => {
  fresh();
  const ship = makeBody({ position: { x: -3.1 }, velocity: { x: 30 } });
  const wall = makeBody({ static: true, massMultiplier: 100000 });
  const front = ship.nodes.filter(n => n.ox > 1);
  const before = front.reduce((sum, n) => sum + n.x, 0);
  DestructorBeams3D.collideBodies(ship, wall, 1 / 120, true);
  const after = front.reduce((sum, n) => sum + n.x, 0);
  assert.ok(after < before, `dziób ma zgiąć się do tyłu: ${before} -> ${after}`);
  const positions = ship.nodes.map(n => [n.x, n.y, n.z]);
  DestructorBeams3D.collideBodies(ship, wall, 1 / 120, false);
  assert.deepEqual(ship.nodes.map(n => [n.x, n.y, n.z]), positions);
  assert.deepEqual(wall.pos, { x: 0, y: 0, z: 0 });
  assert.equal(DestructorBeams3D.applyImpact(wall, 0, 0, 0, 10000), false);
});

test('hash obejmuje odsłonięte wnętrze i odświeża się po zgniocie w tym samym kroku', () => {
  fresh();
  const body = makeBody();
  const interior = body.nodes.find(n => !n.surface);
  assert.ok(interior);
  for (const n of body.nodes) if (n !== interior) n.active = false;
  const includes = hash => {
    for (let node of hash.values()) for (; node; node = node._hashNext) if (node === interior) return true;
    return false;
  };
  assert.ok(includes(DestructorBeams3D._refreshHash(body)));
  interior.x += 50;
  body._hashTick = -1;
  DestructorBeams3D._updateRadius(body);
  assert.ok(body.radius >= Math.hypot(interior.x, interior.y, interior.z));
  assert.ok(includes(DestructorBeams3D._refreshHash(body)));
});

test('przeniesienie lokalnego ruchu fragmentu zachowuje prędkości świata i nadaje obrót', () => {
  fresh();
  const body = makeBody();
  for (const n of body.nodes) { n.vx = 2 - n.y; n.vy = 3 + n.x; n.vz = 4; }
  const before = body.nodes.map(n => [n.vx, n.vy, n.vz]);
  DestructorBeams3D._transferFragmentMotion(body);
  assert.ok(body.angVel.z > 0.5);
  for (let i = 0; i < body.nodes.length; i++) {
    const n = body.nodes[i], w = body.angVel, v = body.vel;
    const after = [v.x + n.vx + w.y * n.z - w.z * n.y,
      v.y + n.vy + w.z * n.x - w.x * n.z, v.z + n.vz + w.x * n.y - w.y * n.x];
    after.forEach((value, axis) => assert.ok(Math.abs(value - before[i][axis]) < 1e-8));
  }
});

test('wiele odciętych płyt przestrzega limitu fragmentów i poprawnie aktualizuje masę', () => {
  fresh({ splitMaxFragments: 2, maxWrecks: 2, wreckOutwardKick: 0, wreckSpinResponse: 0 });
  const body = makeBody({}, { w: 8, h: 3, d: 3, shell: 2, bulkheadEvery: 0 });
  const bodies = [body];
  for (const beam of body.beams) {
    if (body.nodes[beam.a].ix !== body.nodes[beam.b].ix) beam.broken = true;
  }
  body.structureDirty = true;
  DestructorBeams3D.splitQueue.push(body);
  DestructorBeams3D.processSplits(bodies);
  assert.equal(bodies.filter(b => b.isWreck).length, 2);
  for (const b of bodies) {
    assert.ok(Math.abs(b.mass - b.nodes.reduce((sum, n) => sum + n.mass, 0)) < 1e-8);
    assert.equal(b.activeNodes, b.nodes.length);
    assert.equal(DestructorBeams3D.findIslands(b).length, 1);
  }
});
