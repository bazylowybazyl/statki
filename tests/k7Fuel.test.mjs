// Obsługa paliwowa stanowisk capital K-7 (2026-10-07, src/3d/haloRing/haloPortK7Fuel.js): ramię SCARA niesie złączkę
// nad wlew, przewód to lina Verleta z bębnem (fizyka zamiast dawnej krzywej Béziera przesuwanej po prostej), suwnic
// nie ma; wspólne sekwencje podpinania i odpinania (haloPortK7Layout.js). Czysta logika, bez GPU.
// Demo: dema/dok-k7-webgpu.html. node --test tests/k7Fuel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  K7_ATLAS, K7_ATLAS_COLLISION, K7_FUEL_STATION, K7_HEIGHTS, K7_SERVICE_DOCK, K7_SERVICE_KEYS, K7_SERVICE_RELEASE,
  K7_SERVICE_UNDOCK, K7_STOWED_POSE, buildK7Collision, createK7Layout, k7BoxPoly, k7ConvexOverlap, k7MakeHullBuffer,
  k7ServiceConnectPose, k7ServiceDisconnectPose, k7ServiceStep, k7TransformHull
} from '../src/3d/haloRing/haloPortK7Layout.js';
import {
  K7_FUEL_TUNE, K7_HOSE_NODES, K7_HOSE_SEG, createK7FuelRig, k7FuelCouplerAt, k7FuelGeometry, k7FuelJoints, k7ScaraTip,
  stepK7FuelRig
} from '../src/3d/haloRing/haloPortK7Fuel.js';

const DT = 1 / 60;
const L = createK7Layout();
const C01 = L.berths[0];
const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function rigWorld() {
  const rig = createK7FuelRig(L);
  const poses = new Map(L.berths.filter((b) => b.size === 'CAPITAL').map((b) => [b.id, { ...K7_STOWED_POSE }]));
  const hull = k7TransformHull(K7_ATLAS_COLLISION, K7_ATLAS.w, K7_ATLAS.h, C01.x, C01.z, C01.angle, k7MakeHullBuffer());
  return { rig, poses, hull, pose: poses.get('C-01') };
}

function hoseStats(h) {
  const P = h.pos;
  let poly = 0;
  let minY = Infinity;
  let finite = true;
  for (let i = h.k0; i < K7_HOSE_NODES; i++) {
    const o = i * 3;
    if (!Number.isFinite(P[o]) || !Number.isFinite(P[o + 1]) || !Number.isFinite(P[o + 2])) finite = false;
    minY = Math.min(minY, P[o + 1]);
    if (i + 1 < K7_HOSE_NODES) poly += Math.hypot(P[o + 3] - P[o], P[o + 4] - P[o + 1], P[o + 5] - P[o + 2]);
  }
  const c = (K7_HOSE_NODES - 1) * 3;
  return { poly, minY, finite, cx: P[c], cy: P[c + 1], cz: P[c + 2] };
}

test('sekwencje obsługi: kolejność podpinania i odpinania, upust przed odryglowaniem, napęd po zwolnieniu zamków', () => {
  assert.deepEqual([...K7_SERVICE_KEYS], ['clamp', 'extension', 'seat', 'lock', 'flow', 'vent']);
  const D = K7_SERVICE_DOCK;
  assert.ok(D.clamp[1] <= D.extension[1] && D.extension[1] <= D.seat[0] && D.seat[1] <= D.lock[0] && D.lock[1] <= D.flow[0], 'zamki → ramię → złączka → rygle → przepływ');
  const pose = {};
  let prev = { ...K7_STOWED_POSE };
  let jump = 0;
  for (let t = 0; t <= D.end + 0.2; t += 0.01) {
    k7ServiceConnectPose(D, t, null, pose);
    for (const k of K7_SERVICE_KEYS) jump = Math.max(jump, Math.abs(pose[k] - prev[k]));
    prev = { ...pose };
    if (pose.seat > 1e-3) assert.ok(pose.extension > 0.999, 'złączka schodzi dopiero nad wlewem');
    if (pose.lock > 1e-3) assert.ok(pose.seat > 0.999, 'rygle na osadzonej złączce');
    assert.equal(pose.vent, 0);
  }
  assert.ok(jump < 0.05, `płynnie (${jump})`);
  for (const k of K7_SERVICE_KEYS) if (k !== 'vent') assert.equal(pose[k], 1, k);
  const U = K7_SERVICE_UNDOCK;
  let ventPeak = 0;
  let lockAtPeak = 0;
  for (let t = 0; t <= U.end + 0.2; t += 0.01) {
    k7ServiceDisconnectPose(U, t, null, pose);
    if (pose.vent > ventPeak) { ventPeak = pose.vent; lockAtPeak = pose.lock; }
    if (pose.flow > 1e-3) assert.ok(pose.lock > 0.999, 'przepływ odcięty przed odryglowaniem');
    if (pose.lock < 0.999) assert.ok(pose.flow === 0, 'odryglowanie bez przepływu');
    if (pose.seat < 0.999) assert.ok(pose.lock < 0.5, 'złączka w górę po odryglowaniu');
    if (pose.extension < 0.999) assert.ok(pose.seat < 0.6, 'ramię składa się z podniesioną złączką');
    if (t >= U.driveAt) assert.ok(pose.clamp === 0 && pose.seat === 0 && pose.lock === 0, 'napęd: zamki puściły, złączki w górze');
  }
  assert.ok(ventPeak > 0.99 && lockAtPeak > 0.99, 'upust z zaryglowanych złączy');
  for (const k of K7_SERVICE_KEYS) assert.equal(pose[k], 0, k);
  // odpinanie od przerwanej pozy — bez skoku na starcie
  const from = { clamp: 1, extension: 0.6, seat: 0, lock: 0, flow: 0, vent: 0 };
  k7ServiceDisconnectPose(K7_SERVICE_RELEASE, 0, from, pose);
  assert.equal(pose.extension, 0.6);
  assert.equal(pose.vent, 0, 'bez upustu z odryglowanych');
  assert.equal(k7ServiceStep(U, 0.2), 'ODCIĘCIE PRZEPŁYWU');
  assert.equal(k7ServiceStep(U, U.end + 1), 'NAPĘD ODBLOKOWANY');
});

test('ramię SCARA: sięga każdego wlewu, łokieć ku bramie, złożone przy słupku, tor końcówki nad pasem stanowiska', () => {
  const F = K7_FUEL_STATION;
  const t = { x: 0, z: 0, ex: 0, ez: 0 };
  const j = { q1: 0, q2: 0 };
  for (const b of L.berths.filter((v) => v.size === 'CAPITAL')) {
    for (const a of b.serviceAnchors) {
      const g = k7FuelGeometry(b, a);
      assert.ok(g.reach, `${b.id}/${a.side}: wlew w zasięgu ramienia`);
      k7FuelJoints(g, 1, j);
      k7ScaraTip(g, j.q1, j.q2, t);
      assert.ok(Math.hypot(t.x - g.port.x, t.z - g.port.z) < 1e-6, 'końcówka nad wlewem');
      assert.ok(t.ez > Math.min(g.sz, g.port.z), 'łokieć ku bramie (+z)');
      k7FuelJoints(g, 0, j);
      k7ScaraTip(g, j.q1, j.q2, t);
      assert.ok(Math.hypot(t.x - g.stowTip.x, t.z - g.stowTip.z) < 1e-6, 'złożone: końcówka przy słupku');
      // tor końcówki w pasie słupek ↔ wlew (nie przez sąsiednie stanowisko), człony nad płaszczyzną lotu
      for (let e = 0; e <= 1; e += 0.05) {
        k7FuelJoints(g, e, j);
        k7ScaraTip(g, j.q1, j.q2, t);
        assert.ok(Math.abs(t.x - b.x) < b.width * 0.5 + 120, `${b.id}: końcówka nad swoim stanowiskiem (e = ${e.toFixed(2)})`);
        assert.ok(Math.abs(t.ex - b.x) < b.width * 0.5 + 200, `${b.id}: łokieć nad swoim stanowiskiem`);
      }
      const c = k7FuelCouplerAt(g, 1, 1, {});
      assert.ok(Math.abs(c.y - g.port.y) < 1e-9, 'osadzona złączka na wysokości wlewu');
      assert.ok(k7FuelCouplerAt(g, 1, 0, {}).y > K7_HEIGHTS.hullTop + 80, 'podniesiona złączka wysoko nad kadłubem');
    }
  }
  assert.ok(F.link2.y + F.link2.h * 0.5 < F.link1.y - F.link1.h * 0.5 + 1, 'człony SCARA jeden pod drugim (składają się)');
  assert.ok(F.link2.y - F.link2.h * 0.5 > K7_HEIGHTS.hullTop + 100, 'ramię nad płaszczyzną lotu (nie koliduje z kadłubem)');
});

test('przewód: cykl dokowania — ramię nad wlewem, złączka zaryglowana na wlewie, długość zachowana, nad pokładem i kadłubem', () => {
  const { rig, poses, hull, pose } = rigWorld();
  const hs = rig.hoses.filter((h) => h.berthId === 'C-01');
  assert.equal(rig.hoses.length, 8);
  assert.equal(hs.length, 2);
  const L0 = hs[0].length;
  let worst = 0;
  let below = 0;
  const cell = { x: 0, z: 0 };
  const box = [];
  for (let t = 0; t < K7_SERVICE_DOCK.end + 1.5; t += DT) {
    k7ServiceConnectPose(K7_SERVICE_DOCK, t, null, pose);
    stepK7FuelRig(rig, DT, poses, hull);
    for (const h of hs) {
      const s = hoseStats(h);
      assert.ok(s.finite, 'bez NaN');
      worst = Math.max(worst, Math.abs(s.poly - h.length) / h.length);
      if (s.minY < K7_FUEL_STATION.hoseR - 0.5) below++;
      // przewód nie wchodzi w kadłub (płyta spód … szczyt w obrysie)
      for (let i = h.k0 + 1; i < K7_HOSE_NODES - 1; i++) {
        const o = i * 3;
        const y = h.pos[o + 1];
        if (y < K7_HEIGHTS.hullTop - 2 && y > K7_HEIGHTS.hullBottom + 2) {
          cell.x = h.pos[o]; cell.z = h.pos[o + 2];
          box.length = 0;
          for (const p of k7BoxPoly(cell.x, cell.z, 2, 2)) box.push(p);
          assert.ok(!k7ConvexOverlap(box, hull), `węzeł ${i} w kadłubie (y = ${y.toFixed(0)})`);
        }
      }
    }
  }
  assert.equal(below, 0, 'przewód nad pokładem');
  assert.ok(worst < 0.03, `długość ogniw zachowana (${(worst * 100).toFixed(2)}%)`);
  for (const h of hs) {
    const s = hoseStats(h);
    const g = h.g;
    assert.ok(h.latched, 'złączka zaryglowana');
    assert.ok(Math.hypot(s.cx - g.port.x, s.cy - g.port.y, s.cz - g.port.z) < 1e-6, 'złączka na wlewie');
    assert.ok(h.length > L0 + 150, `bęben wydał przewód (${L0.toFixed(0)} → ${h.length.toFixed(0)})`);
    assert.ok(h.length < (K7_HOSE_NODES - 2) * K7_HOSE_SEG, 'w pojemności bębna');
    assert.ok(Math.hypot(h.wrist.x - g.port.x, h.wrist.z - g.port.z) < 3, 'wysięgnik nad wlewem');
    assert.equal(h.latches, 1);
  }
  // przewód zwisa (ciężki) — najniższy punkt wyraźnie pod wylotem bębna
  assert.ok(hoseStats(hs[0]).minY < K7_FUEL_STATION.exit.y - 40, 'zwis przewodu');
});

test('przewód: odryglowanie — odrzut złączki, ramię się składa, bęben zwija, przewody usypiają; pauza stoi', () => {
  const { rig, poses, hull, pose } = rigWorld();
  for (let t = 0; t < K7_SERVICE_DOCK.end + 1; t += DT) { k7ServiceConnectPose(K7_SERVICE_DOCK, t, null, pose); stepK7FuelRig(rig, DT, poses, hull); }
  const hs = rig.hoses.filter((h) => h.berthId === 'C-01');
  const Ld = hs[0].length;
  let unlatchedAt = -1;
  let peakUp = 0;
  const yAtUnlatch = [];
  for (let t = 0; t < K7_SERVICE_UNDOCK.end + 0.5; t += DT) {
    k7ServiceDisconnectPose(K7_SERVICE_UNDOCK, t, null, pose);
    stepK7FuelRig(rig, DT, poses, hull);
    if (unlatchedAt < 0 && !hs[0].latched) { unlatchedAt = t; for (const h of hs) yAtUnlatch.push(hoseStats(h).cy); }
    if (unlatchedAt >= 0 && t < unlatchedAt + 0.2) peakUp = Math.max(peakUp, hoseStats(hs[0]).cy - yAtUnlatch[0]);
  }
  assert.ok(unlatchedAt > K7_SERVICE_UNDOCK.lock[0] && unlatchedAt < K7_SERVICE_UNDOCK.lock[1] + 0.05, `odryglowanie w oknie rygli (${unlatchedAt.toFixed(2)} s)`);
  assert.ok(peakUp > 3, `odrzut złączki w górę (${peakUp.toFixed(1)} j.)`);
  for (const h of hs) assert.equal(h.unlatches, 1);
  // ramię złożone, przewód zwinięty do pętli przy bębnie
  for (let i = 0; i < 240; i++) stepK7FuelRig(rig, DT, poses, hull);
  for (const h of hs) {
    const g = h.g;
    assert.ok(!h.latched);
    assert.ok(Math.hypot(h.wrist.x - g.stowTip.x, h.wrist.z - g.stowTip.z) < 4, 'ramię złożone');
    assert.ok(h.length < Ld - 150, `bęben zwinął przewód (${Ld.toFixed(0)} → ${h.length.toFixed(0)})`);
    assert.ok(hoseStats(h).finite);
  }
  // spoczynek: przewody usypiają (zero pracy), pauza nic nie zmienia
  // ciężki przewód wybrzmiewa kilka sekund (kołysanie po odrzucie), potem zasypia
  for (let i = 0; i < 1500 && !rig.hoses.every((h) => h.asleep); i++) stepK7FuelRig(rig, DT, poses, hull);
  assert.ok(rig.hoses.every((h) => h.asleep), 'wszystkie przewody uśpione w spoczynku');
  const snap = hs[0].pos.slice();
  const ver = hs[0].version;
  stepK7FuelRig(rig, 0, poses, hull);
  pose.extension = 0.5;
  stepK7FuelRig(rig, 0, poses, hull);
  assert.deepEqual([...hs[0].pos], [...snap], 'pauza (dt = 0): przewód stoi');
  assert.equal(hs[0].version, ver);
  stepK7FuelRig(rig, DT, poses, hull);
  assert.ok(!hs[0].asleep && hs[0].version > ver, 'zmiana pozy budzi przewód');
});

test('przewód: odlatujący kadłub ciągnie przewód leżący na grzbiecie; determinizm; czysty moduł', () => {
  const run = () => {
    const { rig, poses, hull, pose } = rigWorld();
    for (let t = 0; t < K7_SERVICE_DOCK.end + 1; t += DT) { k7ServiceConnectPose(K7_SERVICE_DOCK, t, null, pose); stepK7FuelRig(rig, DT, poses, hull); }
    // awaryjne odpięcie, kadłub odjeżdża ku bramie (kurs stanowiska −π/2: tył ku +z) 120 j/s
    let dz = 0;
    for (let t = 0; t < K7_SERVICE_RELEASE.end + 1; t += DT) {
      k7ServiceDisconnectPose(K7_SERVICE_RELEASE, t, null, pose);
      dz += 120 * DT;
      const moved = k7TransformHull(K7_ATLAS_COLLISION, K7_ATLAS.w, K7_ATLAS.h, C01.x, C01.z + dz, C01.angle, k7MakeHullBuffer());
      stepK7FuelRig(rig, DT, poses, moved);
    }
    return rig;
  };
  const a = run();
  const b = run();
  for (let k = 0; k < a.hoses.length; k++) assert.deepEqual([...a.hoses[k].pos], [...b.hoses[k].pos], `przewód ${k} deterministyczny`);
  for (const h of a.hoses) assert.ok(hoseStats(h).finite, 'bez NaN po ciągnięciu');
  const code = strip(readFileSync(new URL('../src/3d/haloRing/haloPortK7Fuel.js', import.meta.url), 'utf8'));
  for (const bad of ['window', 'document', "from 'three'", 'Core3D', 'Math.random']) assert.ok(!code.includes(bad), `bez ${bad}`);
  // krok bez alokacji
  const step = code.slice(code.indexOf('function stepHose'), code.indexOf('export function stepK7FuelRig'));
  assert.ok(!/new |\[\]|=\s*\{/.test(step), 'krok przewodu bez alokacji');
  assert.ok(K7_FUEL_TUNE.substep > 0 && K7_FUEL_TUNE.maxSubsteps >= 4);
});

test('kolizje hali: słupki paliwowe zamiast nóg suwnic, zbiorniki magazynu przy ścianie tylnej poza pasami', () => {
  const col = buildK7Collision(L);
  assert.ok(!col.items.some((it) => /CRANE/.test(it.id)), 'bez nóg suwnic');
  const pedestals = col.items.filter((it) => /^FUEL PEDESTAL/.test(it.id));
  assert.equal(pedestals.length, 8);
  const tanks = col.items.filter((it) => /^FUEL TANK/.test(it.id));
  assert.equal(tanks.length, 8);
  for (const t of tanks) {
    assert.ok(t.bounds.maxZ < 710, `${t.id}: za polami stanowisk`);
    assert.ok(t.y1 < K7_HEIGHTS.hullTop && t.y1 > K7_HEIGHTS.hullBottom, `${t.id}: pod płaszczyzną lotu, przeszkoda dla kadłuba`);
  }
  // Atlas na każdym stanowisku capital: pole bez kolizji ze słupkami
  for (const b of L.berths.filter((v) => v.size === 'CAPITAL')) {
    for (const ang of [b.angle, b.angle + Math.PI]) {
      const poly = k7TransformHull(K7_ATLAS_COLLISION, K7_ATLAS.w, K7_ATLAS.h, b.x, b.z, ang, k7MakeHullBuffer());
      assert.equal(col.test(poly), null, `${b.id}: Atlas mieści się między słupkami`);
    }
  }
});
