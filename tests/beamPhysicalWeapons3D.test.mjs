// Fizyczne bronie (docs/PLAN-zniszczenia-swiata-3d.md § 3) i ciała zakotwiczone (§ 4.2):
// broń oddaje pęd / ciśnienie / ciepło, niszczy solver — bez kasowania węzłów w kroku trafienia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorBeams3D as D, createBeamConfig, pinBeamNodes } from '../src/game/destructorBeams3D.js';
import { makeBoxTriangles, voxelizeTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure, BEAM_PRESETS } from '../src/game/beamBody3D.js';
import { PhysicalWeapons3D, PW } from '../src/game/beamPhysicalWeapons3D.js';

const DT = 1 / 120;

function structure(x = 6, y = 6, z = 6, cellSize = 1) {
  return buildBeamStructure(voxelizeTriangles(makeBoxTriangles(x, y, z), null, { cellSize, shellLayers: 0 }));
}

function setup() {
  D.init(createBeamConfig(1));
  D.onDebris = null;
  const owner = D.createBody(structure(4, 2, 2));
  const weapons = new PhysicalWeapons3D(D, { convergence: 1e6 });
  weapons.reset();
  return { owner, weapons };
}

// Pęd liniowy ciała w świecie: ruch sztywny + własne prędkości węzłów (układ ciała → świat).
function bodyMomentum(b) {
  const s = b.nodeStore, m = D._refreshRot(b);
  let px = 0, py = 0, pz = 0, mass = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const vx = m[0] * s.vx[i] + m[1] * s.vy[i] + m[2] * s.vz[i];
    const vy = m[3] * s.vx[i] + m[4] * s.vy[i] + m[5] * s.vz[i];
    const vz = m[6] * s.vx[i] + m[7] * s.vy[i] + m[8] * s.vz[i];
    px += s.mass[i] * vx; py += s.mass[i] * vy; pz += s.mass[i] * vz;
    mass += s.mass[i];
  }
  return { x: px + b.vel.x * mass, y: py + b.vel.y * mass, z: pz + b.vel.z * mass };
}

function step(weapons, bodies, n = 1) {
  for (let k = 0; k < n; k++) {
    D.integrate(DT, bodies);
    weapons.update(DT, bodies);
    D.update(DT, bodies);
  }
}

test('ciało zakotwiczone: stoi, kotwice trzymają, ściana gnie się pod taranem', () => {
  D.init(createBeamConfig(1)); D.onDebris = null;
  const wall = D.createBody(structure(2, 10, 10), { position: { x: 20 }, anchored: true });
  const pins = pinBeamNodes(wall, (x, y) => y < -4);
  assert.ok(pins > 0);
  const s = wall.nodeStore;
  const pinned = [];
  for (let i = 0; i < s.count; i++) if (s.invMass[i] === 0) pinned.push([i, s.x[i], s.y[i], s.z[i]]);
  const ram = D.createBody(structure(3, 3, 3), { position: { x: 12 }, velocity: { x: 60 } });
  const bodies = [wall, ram];
  for (let k = 0; k < 120; k++) { D.integrate(DT, bodies); D.update(DT, bodies); }
  assert.deepEqual([wall.pos.x, wall.pos.y, wall.pos.z], [20, 0, 0], 'ciało zakotwiczone nie przesuwa się jako całość');
  assert.deepEqual([wall.vel.x, wall.vel.y, wall.vel.z], [0, 0, 0]);
  for (const [i, x, y, z] of pinned) {
    if (!s.active[i]) continue;
    assert.deepEqual([s.x[i], s.y[i], s.z[i]], [x, y, z], 'kotwica nie ustępuje');
  }
  let maxDisp = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    maxDisp = Math.max(maxDisp, Math.hypot(s.x[i] - s.ox[i], s.y[i] - s.oy[i], s.z[i] - s.oz[i]));
  }
  assert.ok(maxDisp > 0.05, `ściana ma się wgnieść (maks. przemieszczenie ${maxDisp})`);
  assert.ok(ram.vel.x < 60, 'taranujący traci prędkość');
});

test('ciało zakotwiczone: wyspa bez kotwicy odpada jako swobodny wrak, zakotwiczona zostaje', () => {
  D.init(createBeamConfig(1)); D.onDebris = null;
  const wall = D.createBody(structure(2, 10, 10), { position: { x: 20 }, anchored: true });
  pinBeamNodes(wall, (x, y) => y < -4);
  const s = wall.nodeStore, e = wall.beamStore;
  let cut = 0;
  for (let bi = 0; bi < e.count; bi++) {
    if ((s.oy[e.a[bi]] > 0) !== (s.oy[e.b[bi]] > 0) && !e.broken[bi]) { e.broken[bi] = 1; cut++; }
  }
  wall.liveBeams -= cut;
  wall.structureDirty = true;
  const bodies = [wall];
  D.splitQueue = [wall];
  D.processSplits(bodies);
  assert.equal(bodies.length, 2);
  const wreck = bodies[1];
  assert.equal(wall.anchored, true, 'dolna (z kotwicami) część zostaje zakotwiczona');
  assert.equal(wreck.anchored, false);
  assert.ok(wreck.invMass > 0, 'górna część jest swobodna');
  let pinnedInWreck = 0;
  for (let i = 0; i < wreck.nodeStore.count; i++) if (wreck.nodeStore.invMass[i] === 0) pinnedInWreck++;
  assert.equal(pinnedInWreck, 0);
  wreck.vel.x = 5;
  for (let k = 0; k < 30; k++) { D.integrate(DT, bodies); D.update(DT, bodies); }
  assert.ok(wreck.pos.x > 20.5, 'odłam leci');
  assert.equal(wall.pos.x, 20);
});

test('ciało zakotwiczone bez kotwic (zniszczona kotwica) staje się swobodne', () => {
  D.init(createBeamConfig(1)); D.onDebris = null;
  const wall = D.createBody(structure(2, 4, 4), { position: { x: 20 }, anchored: true });
  pinBeamNodes(wall, (x, y) => y < -1);
  const s = wall.nodeStore;
  for (let i = 0; i < s.count; i++) if (s.invMass[i] === 0) D.destroyNode(wall, i);
  D.splitQueue = [wall];
  D.processSplits([wall]);
  assert.equal(wall.anchored, false);
  assert.ok(wall.invMass > 0);
});

test('działo (pęd): w kroku trafienia żaden węzeł nie ginie, pęd pocisku przechodzi na konstrukcję', () => {
  const { owner, weapons } = setup();
  weapons.tune.recoil = 0;
  const target = D.createBody(structure(6, 6, 6), { position: { x: 30 } });
  const bodies = [owner, target];
  const nodes = target.activeNodes;
  weapons.fire(PW.CANNON, owner, bodies);
  const shell = weapons.shells.find(p => p.active);
  assert.ok(shell);
  let hitStep = -1;
  for (let k = 0; k < 200 && hitStep < 0; k++) {
    const before = { x: shell.mass * shell.vx, y: shell.mass * shell.vy, z: shell.mass * shell.vz };
    const tb = bodyMomentum(target);
    weapons.update(DT, bodies);
    if (weapons.stats.hits[PW.CANNON] > 0) {
      hitStep = k;
      const ta = bodyMomentum(target);
      const after = { x: shell.mass * shell.vx, y: shell.mass * shell.vy, z: shell.mass * shell.vz };
      for (const ax of ['x', 'y', 'z']) {
        const total0 = before[ax] + tb[ax], total1 = after[ax] + ta[ax];
        assert.ok(Math.abs(total1 - total0) <= 1e-6 * Math.max(1, Math.abs(total0)), `pęd ${ax}: ${total0} → ${total1}`);
      }
      assert.ok(ta.x > 1, 'konstrukcja dostała pęd wzdłuż strzału');
    }
  }
  assert.ok(hitStep >= 0, 'pocisk trafił');
  assert.equal(target.activeNodes, nodes, 'trafienie zmienia prędkości, nie kasuje węzłów');
  // Dalej rwie solver — w kolejnych krokach, nie w kroku trafienia.
  const v0 = target.vel.x;
  for (let k = 0; k < 6; k++) { D.integrate(DT, bodies); D.update(DT, bodies); }
  assert.ok(target.vel.x > v0, 'ruch węzłów przechodzi na ruch ciała');
});

test('pręt Hexlance: ciało z CCD nie przelatuje przez cienką płytę, hamuje na niej i oddaje pęd', () => {
  const { owner, weapons } = setup();
  weapons.tune.recoil = 0;
  weapons.tune.lanceSpeed = 2400;            // 20 j. na krok przy płycie grubości 1
  weapons.setLanceStructure(structure(6, 1, 1, 0.5));
  const plate = D.createBody(structure(1, 12, 12), { position: { x: 45 }, noSplit: true });
  const bodies = [owner, plate];
  assert.equal(weapons.fire(PW.LANCE, owner, bodies), true);
  assert.equal(bodies.length, 3);
  const rod = bodies[2];
  assert.equal(rod._rodFast, true, 'szybki pręt omija kontakty silnika');
  assert.equal(D.pairFilter(rod, plate), false);
  const v0 = Math.hypot(rod.vel.x, rod.vel.y, rod.vel.z);
  const nodes = plate.activeNodes;
  let moved = 0;
  for (let k = 0; k < 6; k++) {
    D.integrate(DT, bodies);
    weapons.update(DT, bodies);
    if (weapons.stats.hits[PW.LANCE] > 0 && !moved) {
      const s = plate.nodeStore;
      for (let i = 0; i < s.count; i++) if (Math.hypot(s.vx[i], s.vy[i], s.vz[i]) > 1) moved++;
      assert.equal(plate.activeNodes, nodes, 'w kroku trafienia płyta nie traci węzłów');
    }
    D.update(DT, bodies);
  }
  assert.ok(weapons.stats.hits[PW.LANCE] > 0, 'grot trafił płytę mimo 20 j. drogi na krok');
  assert.ok(moved > 0, 'węzły płyty dostały prędkość');
  const v1 = Math.hypot(rod.vel.x, rod.vel.y, rod.vel.z);
  assert.ok(v1 < v0, `pręt zwolnił (${v0.toFixed(1)} → ${v1.toFixed(1)})`);
});

test('pręt wbity w grubą bryłę jedzie z nią i nie zderza się z gospodarzem', () => {
  const { owner, weapons } = setup();
  weapons.tune.recoil = 0;
  weapons.tune.lanceSpeed = 300;
  weapons.tune.lanceMass = 40;               // lekki: utknie
  weapons.setLanceStructure(structure(4, 1, 1, 0.5));
  const block = D.createBody(structure(10, 10, 10), { position: { x: 30 }, noSplit: true });
  const bodies = [owner, block];
  weapons.fire(PW.LANCE, owner, bodies);
  const rod = bodies[2];
  const record = weapons.rods[0];
  for (let k = 0; k < 120 && !record.host; k++) step(weapons, bodies);
  // Porównanie tożsamości bez assert.equal na ciałach (komunikat porażki drukowałby całe ciało).
  assert.ok(record.host === block, 'pręt utknął w bryle');
  assert.equal(rod._rodFast, false);
  assert.equal(D.pairFilter(rod, block), false, 'wbity pręt nie zderza się z gospodarzem');
  block.vel.y = 10;
  const y0 = rod.pos.y;
  step(weapons, bodies, 12);
  assert.ok(rod.pos.y > y0 + 0.5, 'pręt jedzie z bryłą');
});

test('rakieta (ciśnienie): front fali dochodzi do dalszych węzłów później, bez kasowania węzłów', () => {
  const { owner, weapons } = setup();
  weapons.tune.recoil = 0;
  weapons.tune.blastTime = 0.1;
  weapons.tune.blastRadius = 4;
  const target = D.createBody(structure(8, 8, 8), { position: { x: 30 }, noSplit: true });
  const bodies = [owner, target];
  const nodes = target.activeNodes;
  weapons.fire(PW.ROCKET, owner, bodies);
  for (let k = 0; k < 400 && weapons.stats.hits[PW.ROCKET] === 0; k++) weapons.update(DT, bodies);
  assert.equal(weapons.stats.hits[PW.ROCKET], 1);
  const blast = weapons.blasts.find(b => b.active);
  assert.ok(blast, 'wybuch to fala w czasie, nie jedno trafienie');
  const s = target.nodeStore, m = D._refreshRot(target);
  const lx = m[0] * (blast.x - target.pos.x) + m[3] * (blast.y - target.pos.y) + m[6] * (blast.z - target.pos.z);
  const ly = m[1] * (blast.x - target.pos.x) + m[4] * (blast.y - target.pos.y) + m[7] * (blast.z - target.pos.z);
  const lz = m[2] * (blast.x - target.pos.x) + m[5] * (blast.y - target.pos.y) + m[8] * (blast.z - target.pos.z);
  const firstKick = new Array(s.count).fill(-1);
  for (let k = 0; k < 20; k++) {
    weapons.update(DT, bodies);
    for (let i = 0; i < s.count; i++) {
      if (firstKick[i] < 0 && Math.hypot(s.vx[i], s.vy[i], s.vz[i]) > 1e-9) firstKick[i] = k;
    }
  }
  assert.equal(target.activeNodes, nodes, 'fala zmienia prędkości, nie kasuje węzłów');
  const near = [], far = [];
  for (let i = 0; i < s.count; i++) {
    if (firstKick[i] < 0) continue;
    const d = Math.hypot(s.x[i] - lx, s.y[i] - ly, s.z[i] - lz);
    (d < 1.5 ? near : d > 3 ? far : []).push(firstKick[i]);
  }
  assert.ok(near.length > 0 && far.length > 0);
  assert.ok(Math.max(...near) < Math.min(...far), 'bliskie węzły dostają falę wcześniej niż dalekie');
});

test('wiązka (ciepło): grzeje, osłabia belki, topi węzły z czasem; po ostygnięciu belki wracają do presetu', () => {
  const { owner, weapons } = setup();
  weapons.tune.recoil = 0;
  const target = D.createBody(structure(6, 6, 6), { position: { x: 30 }, noSplit: true });
  const bodies = [owner, target];
  const nodes = target.activeNodes;
  weapons.selected = PW.BEAM;
  for (let k = 0; k < 12; k++) { weapons.hold(DT, owner, bodies, true, false); weapons.update(DT, bodies); }
  assert.equal(target.activeNodes, nodes, '0,1 s wiązki nie topi węzłów');
  const s = target.nodeStore, e = target.beamStore;
  let maxT = 0;
  for (let i = 0; i < s.count; i++) maxT = Math.max(maxT, s.temp[i]);
  assert.ok(maxT > 0.2, `węzły się grzeją (maks. ${maxT.toFixed(2)})`);
  for (let k = 0; k < 240; k++) { weapons.hold(DT, owner, bodies, true, false); weapons.update(DT, bodies); D.update(DT, bodies); }
  assert.ok(target.activeNodes < nodes, 'po 2 s wiązka przetapia węzły');
  assert.ok(weapons.stats.ablated > 0);
  let weakened = 0;
  for (let bi = 0; bi < e.count; bi++) if (!e.broken[bi] && e.brk[bi] < BEAM_PRESETS[e.type[bi]].break - 1e-9) weakened++;
  assert.ok(weakened > 0, 'gorące belki są słabsze');
  for (let k = 0; k < 120 * 40; k++) { weapons.hold(DT, owner, bodies, false, false); weapons.update(DT, bodies); }
  let still = 0;
  for (let bi = 0; bi < e.count; bi++) {
    if (e.broken[bi] || !s.active[e.a[bi]] || !s.active[e.b[bi]]) continue;
    if (e.brk[bi] !== BEAM_PRESETS[e.type[bi]].break) still++;
  }
  assert.equal(still, 0, 'po ostygnięciu belki wracają do presetu');
  assert.equal(weapons.hot.has(target), false);
});

test('A/B: stare trafienia kasują pas od razu (rzaz Hexlance), fizyczny pręt — nie', () => {
  const { owner, weapons } = setup();
  weapons.tune.recoil = 0;
  weapons.setLanceStructure(structure(6, 1, 1, 0.5));
  weapons.legacy = true;
  const plate = D.createBody(structure(2, 10, 10), { position: { x: 30 }, noSplit: true });
  const bodies = [owner, plate];
  const nodes = plate.activeNodes;
  weapons.fire(PW.LANCE, owner, bodies);
  assert.equal(bodies.length, 2, 'stary Hexlance to punkt, nie ciało');
  for (let k = 0; k < 120 && plate.activeNodes === nodes; k++) weapons.update(DT, bodies);
  assert.ok(plate.activeNodes < nodes, 'rzaz kasuje węzły w kroku przejścia');
});
