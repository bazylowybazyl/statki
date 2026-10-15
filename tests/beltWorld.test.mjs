// Świat pasa po stronie gry (RW-25, src/game/beltWorld.js): pole-replika obrazu daje te same skały,
// cień pól liczony raz (sektory dla renderu), zegar skał, olbrzymy budowane przy punktach uwagi
// niezależnie od kadru, wydobycie po zdarzeniu bankRadius, zerowanie zmian siatek ciał po stronie gry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BeltWorld } from '../src/game/beltWorld.js';
import { FieldSunOcclusion, nightKnee } from '../src/game/asteroidFieldLight.js';
import { BELT_BAND } from '../src/game/asteroidBeltField.js';
import { shapeRadiusAt, octEncodeCpu } from '../src/game/asteroidShapeRadius.js';
import { beltPlayZ, MINERAL_ROCK_TYPE_IDS } from '../src/game/beltPlayZ.js';
import { ROCK_TYPE_INDEX } from '../src/game/asteroidRockKinds.js';
import { sharedTypedArray } from '../src/game/sharedTyped.js';
import { GiantRock, buildGiantPlan } from '../src/game/asteroidGiants.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { buildSystemMap } from '../src/data/systemMap.js';

const SUN = { x: 6_000_000, y: 6_000_000 };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function planetsAt() {
  const { planets, auInWorldUnits } = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
    planetScale: 3,
    sunRadius: 823,
    angleFor: (def) => ({ jupiter: 250 }[def.id] ?? 0) * Math.PI / 180
  });
  for (const p of planets) {
    p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
    p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
  }
  return { planets, au: auInWorldUnits };
}

// Budowa SDF zastępcza: zlicza zlecenia, siatka nigdy nie gotowa (bez workerów i ~3 s liczenia).
function stubBuilder(log) {
  return () => ({
    build(id, seed, x, y) {
      log.push(id);
      const giant = new GiantRock(buildGiantPlan(id, seed), x, y);
      return { giant, promise: new Promise(() => {}) };
    }
  });
}

let _world = null;
let _builds = null;
function world() {
  if (!_world) {
    const { planets, au } = planetsAt();
    _builds = [];
    _world = new BeltWorld({ planets, sun: SUN, auToWorld: au, createBuilder: stubBuilder(_builds) });
    _world.setExclusions([..._world.giants.exclusions(), { x: SUN.x + 39 * au, y: SUN.y, rx: 9000, ry: 9000 }]);
    _world.setSmallBodyAnchors([{ id: 'vesta', x: SUN.x - 36.9 * au, y: SUN.y + 1000, extra: 'pomijane' }]);
    _world.familyPeaks();
  }
  return _world;
}

function rocksIn(field, x0, y0, x1, y1) {
  const out = [];
  field.forEachRockInRect(BELT_BAND.PLAY, x0, y0, x1, y1, 0, (r) => {
    out.push(`${r.id}|${r.x.toFixed(3)}|${r.y.toFixed(3)}|${r.r.toFixed(3)}|${r.type}|${r.moon ? r.moon.id : '-'}`);
  });
  return out.sort();
}

test('pole-replika obrazu: te same skały co pole gry (konfiguracja w kolejności, także później dodana)', () => {
  const w = world();
  const replica = w.createFieldReplica();
  assert.notEqual(replica, w.field);
  assert.deepEqual(replica.exclusions, w.field.exclusions);
  let probes = 0;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rAu = 37 + (i % 6);
    const x = SUN.x + Math.cos(a) * rAu * w.au;
    const y = SUN.y + Math.sin(a) * rAu * w.au;
    const A = rocksIn(w.field, x - 30000, y - 30000, x + 30000, y + 30000);
    const B = rocksIn(replica, x - 30000, y - 30000, x + 30000, y + 30000);
    assert.deepEqual(B, A, `skały w punkcie ${i}`);
    probes += A.length;
  }
  assert.ok(probes > 200, `za mało skał w próbkach: ${probes}`);
  // rodziny i skład: te same
  const x = SUN.x - 36.9 * w.au;
  const y = SUN.y;
  assert.equal(replica.familyAt(x, y)?.id ?? null, w.field.familyAt(x, y)?.id ?? null);
  // koło budzenia dochodzi do obu pól (radar gry i obraz); obiekt gry ten sam
  const wake = { x: SUN.x, y: SUN.y + 100, r: 5000, active: true };
  w.addWakeSpot(wake);
  w.addWakeSpot(wake);
  assert.deepEqual(w.field.wakeSpots, [wake]);
  assert.deepEqual(replica.wakeSpots, [wake]);
  assert.ok(replica.rectTouchesBelt(SUN.x - 10, SUN.y - 10, SUN.x + 10, SUN.y + 10));
});

test('cień pól: render przejmuje sektory gry (bez drugiego liczenia), te same wartości', async () => {
  const w = world();
  const occ = new FieldSunOcclusion(w.createFieldReplica());
  let got = null;
  w.onOcclusion((sectors) => { got = sectors; occ.adoptSectors(sectors); });
  assert.equal(got, null, 'przed precompute — bez zdarzenia');
  await w.precompute();
  assert.ok(got && got.length === w.occlusion.sectorCount, 'wszystkie sektory');
  assert.equal(occ.precomputed, true);
  const built0 = occ.stats.sectorsBuilt;
  for (let i = 0; i < 200; i++) {
    const a = i * 0.731;
    const r = (35 + (i % 12)) * w.au;
    const x = SUN.x + Math.cos(a) * r;
    const y = SUN.y + Math.sin(a) * r;
    assert.equal(occ.transmittance(x, y), w.occlusion.transmittance(x, y));
    assert.equal(w.sunT(x, y), nightKnee(w.occlusion.transmittance(x, y)));
  }
  assert.equal(occ.stats.sectorsBuilt, built0, 'render nic nie liczył');
  assert.ok(got[0].data.buffer instanceof SharedArrayBuffer, 'sektory w SharedArrayBuffer (Node: zawsze)');
  // późny słuchacz dostaje gotową siatkę od razu
  let late = null;
  w.onOcclusion((s) => { late = s; });
  assert.equal(late.length, got.length);
});

test('zegar skał: dt klatki, 0 w pauzie, krok ≤ 0,1 s; czas bezwzględny', () => {
  const { planets, au } = planetsAt();
  const w = new BeltWorld({ planets, sun: SUN, auToWorld: au, createBuilder: stubBuilder([]) });
  let ref = 0;
  for (const [dt, paused] of [[1 / 60, false], [0.25, false], [1 / 60, true], [-1, false], [NaN, false], [1 / 144, false]]) {
    w.frame(dt, paused, null);
    const step = paused ? 0 : Math.max(0, Math.min(0.1, Number(dt) || 0));
    ref += step;
    assert.equal(w.frameDt, step);
    assert.equal(w.time, ref);
  }
});

test('olbrzymy: budowa przy punktach uwagi (kamera, statek) co klatkę, bez kadru renderu', () => {
  const { planets, au } = planetsAt();
  const log = [];
  const w = new BeltWorld({ planets, sun: SUN, auToWorld: au, createBuilder: stubBuilder(log) });
  const e = w.giants.entries[0];
  w.frame(1 / 60, false, [{ x: SUN.x, y: SUN.y }]);
  assert.equal(log.length, 0, 'daleko od olbrzymów — bez budowy');
  // statek 300 tys. j. od olbrzyma (dawniej: dopiero, gdy kadr dotknął pasa)
  w.frame(1 / 60, false, [null, { x: e.x + 300000, y: e.y }]);
  assert.deepEqual(log, [e.id]);
  w.frame(1 / 60, false, [{ x: e.x, y: e.y }]);
  assert.equal(log.length, 1, 'raz na olbrzyma');
  assert.equal(w.giants.readyCount, 0, 'siatka w budowie — bez kolizji');
  assert.equal(w.pointBlocked(e.x, e.y), false);
});

test('olbrzym: siatka SDF w SharedArrayBuffer, gdy dostępny', () => {
  const g = new GiantRock(buildGiantPlan('arch', 1), 0, 0);
  assert.ok(g.grid.buffer instanceof SharedArrayBuffer);
  const f = sharedTypedArray(Float32Array, 8).fill(1);
  assert.equal(f[7], 1);
});

test('wydobycie po zdarzeniu bankRadius: promień kształtów jak w banku, zegar platformy = zegar świata', () => {
  const { planets, au } = planetsAt();
  const w = new BeltWorld({ planets, sun: SUN, auToWorld: au, createBuilder: stubBuilder([]) });
  assert.equal(w.rig, null);
  let notified = null;
  w.onMining((rig) => { notified = rig; });
  const R = 8;
  const maps = [];
  for (let k = 0; k < 3; k++) {
    const m = new Float32Array(R * R);
    for (let i = 0; i < m.length; i++) m[i] = 0.6 + ((i * 7 + k * 13) % 11) * 0.05;
    maps.push(m);
  }
  const rig = w.attachShapeRadius({ maps, size: R });
  assert.ok(rig && w.mining && notified === rig);
  assert.equal(w.attachShapeRadius({ maps, size: R }), rig, 'raz');
  // radiusAt fizyki skał = arytmetyka banku (rockBank.radiusAt woła shapeRadiusAt)
  for (const [s, x, y, z] of [[0, 1, 0, 0], [1, 0.3, -0.5, 0.8], [2, -0.2, 0.1, -0.9], [7, 0, 0, 1]]) {
    assert.equal(w.shapes.radiusAt(s, x, y, z), shapeRadiusAt(maps, R, s, x, y, z));
  }
  assert.equal(shapeRadiusAt(maps, R, 9, 1, 0, 0), 1, 'brak mapy');
  assert.ok(octEncodeCpu(0, 0, -1).u >= 0);
  w.frame(0.05, false, null);
  w.frame(0.05, false, null);
  assert.equal(rig._rockTime(), w.time);
  assert.equal(rig.field, w.field);
  // pole zmian siatki ciała zeruje gra po potwierdzeniu renderu
  const body = { dirtyBox: [0, 0, 0, 1, 1, 1] };
  w.ackMinedUpload(body);
  assert.equal(body.dirtyBox, null);
});

test('głębokość skał PLAY: typy z minerałami = klucze receptur minerałów renderu', () => {
  const src = read('src/3d/asteroids/minerals.js');
  const block = src.slice(src.indexOf('const MINERAL_RECIPES = Object.freeze({'));
  const keys = [];
  const re = /^ {2}([a-z_]+): /gm;
  const body = block.slice(0, block.indexOf('\n});'));
  let m;
  while ((m = re.exec(body))) keys.push(m[1]);
  assert.deepEqual([...MINERAL_ROCK_TYPE_IDS].sort(), keys.sort());
  const rock = { r: 100, sx: 1, sy: 1.2, sz: 0.9, type: ROCK_TYPE_INDEX.crystal };
  assert.equal(beltPlayZ(rock), -100 * 1.62 * 1.2);
  assert.equal(beltPlayZ({ ...rock, type: ROCK_TYPE_INDEX.rock }), -100 * 1.45 * 1.2);
});

test('obraz pasa bez rozgrywki: brak fizyki skał, platformy, budowy olbrzymów i stanu obrazu w obiektach gry', () => {
  const src = read('src/3d/asteroids/asteroidBelt.js');
  for (const mod of ['asteroidMining.js', 'asteroidMiningRig.js', 'asteroidBeltGiants.js', 'asteroidGiantBuilder.js']) {
    assert.ok(!src.includes(`/game/${mod}'`), `import ${mod}`);
  }
  assert.doesNotMatch(src, /requestNear\(/);
  assert.doesNotMatch(src, /new AsteroidBeltField\(/);
  assert.doesNotMatch(src, /\be\.view\b/);
  assert.doesNotMatch(src, /this\.time \+=/);
  assert.match(src, /this\.world\.attachShapeRadius\(/);
  const mined = read('src/3d/asteroids/minedRocks.js');
  assert.match(mined, /if \(this\.onUploaded\) this\.onUploaded\(body\); else body\.dirtyBox = null;/);
  const html = read('index.html');
  assert.doesNotMatch(html, /asteroidBelt\??\.(field|giants|rig|pointBlocked|collideShip)\b/);
  assert.match(html, /asteroidBelt\.prepareFrame\(beltWorld\.time, beltWorld\.frameDt,/);
});
