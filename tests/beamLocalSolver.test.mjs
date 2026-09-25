import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSpriteBeamStructure } from '../src/game/beamSprite2D.js';
import { BeamShips3D as R } from '../src/3d/beamShips3D.js';
import { buildSpriteSkinTopology, writeSpriteSkinGeometry } from '../src/3d/beamSpriteSkin2D.js';
import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure, BEAM_TYPE } from '../src/game/beamBody3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { cloneBeamStructure } from '../src/game/beamCrashScene3D.js';
import { activeRegion } from '../src/game/beamActiveRegion3D.js';
import { setPlanarHeading } from '../src/game/beamFlightControls2D.js';

// Pełna płyta 2D ze sprite'a (prostokąt), komórka = world / cells.
function plate(cells = 40, rows = 16, world = 400) {
  const w = cells * 4, h = rows * 4, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 150; data[i * 4 + 3] = 255; }
  return buildSpriteBeamStructure({ width: w, height: h, data }, { worldLength: world, cellsAlong: cells, bulkheadEvery: 0 });
}

function config(cs, local, extra = {}) {
  const cfg = createBeamConfig(cs);
  Object.assign(cfg, { planar: true, localSolver: local, crushStrength: 300000, globalBreakMul: 0.6, maxContacts: 384 }, extra);
  D.init(cfg);
  D.onDebris = null;
  return cfg;
}

function step(bodies, count) {
  for (let i = 0; i < count; i++) {
    D.integrate(1 / 120, bodies);
    D.update(1 / 120, bodies);
    for (let j = bodies.length - 1; j >= 0; j--) if (bodies[j].dead) bodies.splice(j, 1);
  }
}

const at = (body, ix, iy) => body.nodes.find(n => n.ix === ix && n.iy === iy);

function worldOf(body, n) {
  const m = D._refreshRot(body);
  return { x: body.pos.x + m[0] * n.x + m[1] * n.y, y: body.pos.y + m[3] * n.x + m[4] * n.y };
}

function maxDent(body) {
  let peak = 0;
  for (const n of body.nodes) if (n.active) peak = Math.max(peak, Math.hypot(n.x - n.ox, n.y - n.oy));
  return peak;
}

test('solver lokalny: kadłub bez trafień nic nie liczy i nie zmienia kształtu', () => {
  const s = plate(40, 16, 400);
  config(s.cellSize, true);
  const body = D.createBody(cloneBeamStructure(s), { velocity: { x: 50, y: 0, z: 0 } });
  step([body], 60);
  assert.equal(activeRegion(body).list.length, 0);
  assert.equal(body.isSleeping, true);
  assert.equal(D.perf.solvedBeams, 0, 'śpiący kadłub nie rzutuje belek');
  for (const n of body.nodes) assert.ok(n.x === n.ox && n.y === n.oy, 'węzeł ruszył się bez przyczyny');
  assert.ok(body.pos.x > 20, 'lot sztywny nie zależy od solvera');
});

test('solver lokalny: trafienie budzi okolicę, która zasypia, reszta kadłuba stoi', () => {
  const s = plate(60, 24, 600);
  config(s.cellSize, true);
  const body = D.createBody(cloneBeamStructure(s), {});
  const hit = at(body, 30, 12), farA = at(body, 2, 2), farB = at(body, 5, 20);
  const restGap = [farA.ox - farB.ox, farA.oy - farB.oy];
  // 400: węzły przeżywają, blacha gnie się trwale (450+ wybija dziurę, a brzegi wracają).
  D.applyImpact(body, hit.x, hit.y, 0, 400, { x: 1, y: 0, z: 0 }, { radius: s.cellSize * 3, breakRadius: s.cellSize * 1.2 });
  const region = activeRegion(body);
  assert.ok(region.list.length > 0 && region.list.length < 60, `po trafieniu obszar ${region.list.length}`);
  let peak = region.list.length, steps = 0;
  while (activeRegion(body).list.length > 0 && steps < 600) {
    step([body], 1);
    peak = Math.max(peak, activeRegion(body).list.length);
    steps++;
  }
  assert.equal(activeRegion(body).list.length, 0, 'obszar musi się uspokoić');
  assert.ok(peak < body.nodes.length * 0.5, `obszar rozlał się na kadłub: ${peak}/${body.nodes.length}`);
  assert.equal(body.isSleeping, true);
  assert.ok(maxDent(body) > s.cellSize * 0.05, `trafienie zostawia wgniecenie: ${maxDent(body).toFixed(2)}`);
  assert.ok(Math.hypot(body.vel.x, body.vel.y) < 0.02, 'samo wgniecenie nie rozpędza kadłuba');
  // Daleko od trafienia kształt nietknięty (środek masy przesuwa wszystkie węzły tak samo).
  assert.ok(Math.abs(farA.x - farB.x - restGap[0]) < 1e-9 && Math.abs(farA.y - farB.y - restGap[1]) < 1e-9);
});

test('trafienie z okna siatki uszkadza dokładnie to samo co pełny przegląd kadłuba', () => {
  const s = plate(50, 20, 500);
  const cs = s.cellSize;
  const results = [];
  for (const local of [false, true]) {
    config(cs, local);
    const body = D.createBody(cloneBeamStructure(s), { position: { x: 300, y: -40, z: 0 } });
    setPlanarHeading(body, 0.7);
    D._refreshRot(body);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 60; i++) {
      const n = body.nodes[(rnd() * body.nodes.length) | 0];
      const p = worldOf(body, n);
      const missile = i % 5 === 0;
      D.applyImpact(body, p.x + (rnd() - 0.5) * cs, p.y + (rnd() - 0.5) * cs, 0, missile ? 900 : 135,
        { x: Math.cos(i), y: Math.sin(i), z: 0 },
        { radius: cs * (missile ? 3 : 1.15), breakRadius: cs * (missile ? 2.1 : 0.52), impulseTime: missile ? 0.12 : 0 });
    }
    results.push({
      hp: body.nodes.map(n => n.hp), alive: body.nodes.map(n => n.active),
      broken: body.beams.map(b => b.broken), pos: body.nodes.map(n => [n.x, n.y]), liveBeams: body.liveBeams
    });
  }
  const [full, local] = results;
  assert.deepEqual(local.alive, full.alive);
  assert.deepEqual(local.broken, full.broken);
  assert.deepEqual(local.hp, full.hp);
  assert.deepEqual(local.pos, full.pos);
  assert.equal(local.liveBeams, full.liveBeams, 'licznik belek bez pełnego przeliczenia');
});

// Trafienie w krawędź nieruchomej płyty: kopnięcie ciśnieniem (rakieta) albo pchnięcie pozycji.
function hitPlate(local, damage, impulseTime) {
  const s = plate(40, 16, 400);
  config(s.cellSize, local);
  const body = D.createBody(cloneBeamStructure(s), {});
  const hit = at(body, 20, 15);
  const broken0 = D.perf.beamsBroken;
  D.applyImpact(body, hit.x, hit.y, 0, damage, { x: 0, y: -1, z: 0 },
    { radius: s.cellSize * 3, breakRadius: s.cellSize * 2.1, impulseTime });
  const brokenByHit = D.perf.beamsBroken - broken0;
  step([body], 360);
  return { dent: maxDent(body), vy: body.vel.y, brokenByHit };
}

test('solver lokalny: rakieta pcha kadłub jak pełny solver, samo wgniecenie go nie rozpędza', () => {
  const full = hitPlate(false, 250, 0.12), local = hitPlate(true, 250, 0.12);
  assert.equal(local.brokenByHit, full.brokenByHit);
  assert.ok(full.vy < 0 && local.vy < 0, 'kopnięcie w −Y pcha kadłub w −Y');
  const ratio = local.vy / full.vy;
  assert.ok(ratio > 0.8 && ratio < 1.25, `pęd z kopnięcia: lokalny ${local.vy.toFixed(3)} vs pełny ${full.vy.toFixed(3)}`);
  // Pchnięcie pozycji (laser): wgniecenie jak w pełnym solverze, bez pędu z tłumienia.
  const fullDent = hitPlate(false, 400, 0), localDent = hitPlate(true, 400, 0);
  const dentRatio = localDent.dent / fullDent.dent;
  assert.ok(dentRatio > 0.7 && dentRatio < 1.4, `wgniecenie: lokalny ${localDent.dent.toFixed(2)} vs pełny ${fullDent.dent.toFixed(2)}`);
  assert.ok(Math.abs(localDent.vy) < 0.02, `pęd z samego wgniecenia: ${localDent.vy.toFixed(3)}`);
});

function ram(local) {
  const s = plate(40, 16, 400);
  config(s.cellSize, local);
  const a = D.createBody(cloneBeamStructure(s), {});
  const b = D.createBody(cloneBeamStructure(s), { position: { x: 360, y: 0, z: 0 } });
  setPlanarHeading(b, Math.PI / 2);
  a.vel.x = 1500;
  const bodies = [a, b];
  const p0 = a.mass * a.vel.x;
  step(bodies, 360);
  let p = 0;
  for (const x of bodies) p += x.mass * x.vel.x;
  for (const x of bodies) {
    assert.equal(x.pos.z, 0);
    assert.equal(x.quat.x, 0);
    assert.equal(x.quat.y, 0);
    for (const n of x.nodes) if (n.active) assert.equal(n.z, 0);
  }
  return { broken: D.perf.beamsBroken, rel: a.vel.x - b.vel.x, momentum: p / p0, bodies: bodies.length };
}

test('solver lokalny: taran niszczy jak pełny solver i kończy się wspólnym ruchem', () => {
  const full = ram(false), local = ram(true);
  assert.ok(local.broken > 0);
  const ratio = local.broken / full.broken;
  assert.ok(ratio > 0.6 && ratio < 1.6, `zerwania: lokalny ${local.broken} vs pełny ${full.broken}`);
  assert.ok(Math.abs(local.rel) < 40, `po taranie kadłuby jadą razem: ${local.rel.toFixed(1)}`);
  assert.ok(local.momentum > 0.7 && local.momentum <= 1.02, `pęd po taranie: ${local.momentum.toFixed(3)}`);
});

test('solver lokalny: odprysk nie przebudowuje kadłuba, oderwana sekcja tak', () => {
  const s = plate(40, 16, 400);
  config(s.cellSize, true);
  const body = D.createBody(cloneBeamStructure(s), {});
  const bodies = [body];
  // Odprysk: dwa węzły w rogu odcięte od reszty.
  const chip = new Set([at(body, 0, 0), at(body, 1, 0)]);
  for (const beam of body.beams) {
    if (chip.has(body.nodes[beam.a]) !== chip.has(body.nodes[beam.b])) beam.broken = true;
  }
  body.liveBeams = body.beams.filter(b => !b.broken).length;
  body.structureDirty = true;
  const nodesBefore = body.nodes;
  D.splitQueue.push(body);
  D.processSplits(bodies);
  assert.equal(bodies.length, 1);
  assert.equal(body.nodes, nodesBefore, 'odprysk przebudował cały kadłub');
  for (const n of chip) assert.equal(n.active, false);
  // Przecięcie w połowie: wrak i przebudowa.
  for (const beam of body.beams) {
    if ((body.nodes[beam.a].ox > 0) !== (body.nodes[beam.b].ox > 0)) beam.broken = true;
  }
  body.liveBeams = body.beams.filter(b => !b.broken).length;
  body.structureDirty = true;
  D.splitQueue.push(body);
  D.processSplits(bodies);
  assert.equal(bodies.length, 2);
  assert.notEqual(body.nodes, nodesBefore);
});

test('skóra przyrostowa: po trafieniach i krokach solvera identyczna z pełnym przepisaniem', () => {
  const s = plate(30, 12, 300);
  config(s.cellSize, true);
  const body = D.createBody(cloneBeamStructure(s), {});
  const scene = new THREE.Scene();
  R.init(scene);
  const camera = new THREE.OrthographicCamera();
  let partial = 0;
  try {
    R.sync([body], camera, 0);
    for (let round = 0; round < 8; round++) {
      const n = body.nodes[(round * 97 + 13) % body.nodes.length];
      D.applyImpact(body, n.x + body.pos.x, n.y + body.pos.y, 0, 300, { x: 0, y: 1, z: 0 },
        { radius: s.cellSize * 2, breakRadius: s.cellSize });
      step([body], 3 + round);
      R.sync([body], camera, 0);
      const sprite = R.bodyData.get(body).sprite;
      const ranges = sprite.mesh.geometry.attributes.position.updateRanges;
      if (ranges.length && ranges[0].count < sprite.positions.length) partial++;
      const topo = buildSpriteSkinTopology(body);
      const positions = new Float32Array(sprite.positions.length), colors = new Float32Array(sprite.colors.length);
      writeSpriteSkinGeometry(body, topo, positions, colors);
      assert.deepEqual(Array.from(sprite.positions), Array.from(positions), `runda ${round}: pozycje skóry`);
      assert.deepEqual(Array.from(sprite.colors), Array.from(colors), `runda ${round}: cieniowanie skóry`);
    }
    assert.ok(partial > 0, 'renderer nie użył ani razu przepisania przyrostowego');
  } finally {
    R.sync([], camera, 0);
    R.disposeSpriteSkin(s.spriteSkin);
    R.debris.dispose(R.scene);
    R.debris = null;
  }
});

test('solver lokalny: wyrwane mocowanie puszcza wręg, naprawa je przywraca', () => {
  const cfg = createBeamConfig(0.5);
  Object.assign(cfg, { localSolver: true });
  D.init(cfg);
  D.onDebris = null;
  const vox = voxelizeTriangles(makeBoxTriangles(8, 3, 3, 0.05, 0.05, 0.05), null, { cellSize: 0.5, shellLayers: 2 });
  const body = D.createBody(cloneBeamStructure(buildBeamStructure(vox, { cellMassBase: 10, frameStride: 1, bulkheadEvery: 4 })), {});
  const frame = body.beams.find(b => b.type >= BEAM_TYPE.FRAME && body.nodes[b.a].localBeamCount >= 4);
  const mount = body.nodes[frame.a];
  for (const i of mount.beams.filter(i => body.beams[i].type < BEAM_TYPE.FRAME).slice(1)) body.beams[i].broken = true;
  body.liveBeams = body.beams.filter(b => !b.broken).length;
  D.activate(body, mount);
  D.solveSoftBody(1 / 120, [body]);
  assert.equal(frame.broken, true, 'wręg nie może wisieć na wyrwanym mocowaniu');
  D.repair([body], 0.1);
  assert.equal(body.liveBeams, body.beams.length);
  D.solveSoftBody(1 / 120, [body]);
  assert.equal(frame.broken, false, 'naprawione mocowanie użyło nieaktualnego podparcia');
});
