// Ruch warpa „Nurt” po stronie gry (RW-28, src/game/warpTraffic.js): zegar w czasie gry, pula 24, warp-in zdarzeniem,
// prowadzenie okrętów w tunelu i rekordy WARP_* dla renderu; obraz (warpNurt.js) bez rozgrywki.
// node --test tests/warpTraffic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWarpTraffic, WARP_TRAFFIC_CAP } from '../src/game/warpTraffic.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function fakeWriter() {
  const log = [];
  return {
    log,
    warpBegin: (rec) => log.push(['begin', rec.id, rec.kind]),
    warpAttach: (rec) => log.push(['attach', rec.id]),
    warpEnd: (rec) => log.push(['end', rec.id]),
    warpClear: () => log.push(['clear'])
  };
}

test('zegar: suma dt gry z sufitem 0,1 s; dt 0 (pauza, zamrożony świat fabuły) — stoi', () => {
  const t = createWarpTraffic();
  t.step(1 / 60);
  t.step(0.5);
  assert.equal(t.time, 1 / 60 + 0.1);
  const before = t.time;
  t.step(0);
  t.step(NaN);
  assert.equal(t.time, before);
});

test('pula 24 rekordów: pełna pula = null (wołający spawnuje od razu), wolne miejsca dla fabuły', () => {
  const t = createWarpTraffic();
  assert.equal(t.free, WARP_TRAFFIC_CAP);
  for (let i = 0; i < WARP_TRAFFIC_CAP; i++) assert.ok(t.planArrival({ x: i * 1000, y: 0, hullLength: 400, hullWidth: 160 }));
  assert.equal(t.free, 0);
  assert.equal(t.planArrival({ x: 0, y: 0, hullLength: 400 }), null);
  assert.equal(t.depart({ x: 0, y: 0, angle: 0 }), null);
  assert.equal(t.stats.full, 2);
  const ids = new Set(t.records.map((r) => r.id));
  assert.equal(ids.size, WARP_TRAFFIC_CAP, 'sloty puli bez powtórzeń');
});

test('rekordy WARP_*: początek, podpięcie, koniec i czyszczenie idą do pisarza; slot wraca do puli', () => {
  const w = fakeWriter();
  const t = createWarpTraffic({ commands: w });
  const rec = t.planArrival({ x: 0, y: 0, angle: 0, hullLength: 400, hullWidth: 160, burstIn: 0.5 });
  const e = { x: -5000, y: 0, vx: 0, vy: 0, angle: 0 };
  t.attach(rec, e);
  assert.deepEqual(w.log, [['begin', rec.id, 'arrival'], ['attach', rec.id]]);
  assert.equal(t.recordAt(rec.id), rec);
  for (let i = 0; i < 2000 && t.records.length; i++) t.step(1 / 60);
  assert.deepEqual(w.log.at(-1), ['end', rec.id]);
  assert.equal(t.recordAt(rec.id), null);
  assert.equal(e.isCollidable, true, 'po zatrzymaniu okręt znów zderza się');
  t.planArrival({ x: 0, y: 0, hullLength: 400 });
  t.clear();
  assert.deepEqual(w.log.at(-1), ['clear']);
  assert.equal(t.records.length, 0);
  assert.equal(t.free, WARP_TRAFFIC_CAP);
});

test('warp-in piratów zdarzeniem: przylot w kroku gry, hamowanie po wyjściu z warping_in, pozę prowadzi gra', () => {
  const t = createWarpTraffic();
  const npc = { x: 100, y: 0, vx: 4000, vy: 0, angle: 0, state: 'warping_in', warpData: { speed: 4000 }, isCollidable: false };
  t.noteWarpIn(npc);
  t.noteWarpIn(npc);
  assert.equal(t.records.length, 0, 'przylot powstaje w kroku gry');
  t.step(1 / 60);
  assert.equal(t.records.length, 1, 'zdarzenie raz na okręt');
  const rec = t.records[0];
  assert.equal(rec.fx.moving, true);
  assert.equal(rec.fx.tBrake, Infinity);
  npc.x = 900;
  t.step(1 / 60);
  assert.equal(npc.x, 900, 'okręt warp-in prowadzi gra (nie oś)');
  npc.state = 'engage_formation';
  t.step(1 / 60);
  assert.equal(rec.fx.tBrake, t.time, 'hamowanie od chwili wyjścia z warping_in');
  assert.ok(Number.isFinite(rec.fx.tEnd));
  assert.equal(rec.fx.pushReleaseT, rec.fx.tBrake + 0.02);
  // Okręt, który wyszedł z warping_in przed krokiem, nie dostaje przylotu.
  const late = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, state: 'engage_formation' };
  t.noteWarpIn(late);
  t.step(1 / 60);
  assert.equal(t.records.length, 1);
});

test('obraz bez rozgrywki: warpNurt.js nie pisze pozy, ducha ani onGone i nie skanuje npcs; gra kroczy rejestr przed render()', () => {
  const src = read('src/3d/warp/warpNurt.js');
  for (const bad of ['isCollidable =', '_writePose', '.onGone', 'onGone:', "'warping_in'", 'o.npcs', 'planArrival(', 'depart(entity', 'setMovingBrake', 'arrivalFxPose', 'departFxPose']) {
    assert.ok(!src.includes(bad), `warpNurt.js: ${bad}`);
  }
  assert.match(src, /o\.trafficTime/);
  const html = read('index.html');
  assert.match(html, /const warpTraffic = createWarpTraffic\(\{ commands: RenderCommands\.writer \}\);/);
  assert.match(html, /installWarpTrafficCommands\(RenderCommands\.reader, WarpNurt, \(slot\) => warpTraffic\.recordAt\(slot\)\);/);
  assert.match(html, /warpTraffic\.noteWarpIn\(npc\);/);
  assert.match(html, /warpArrivalsFree: \(\) => warpTraffic\.free,/);
  assert.ok(!/WarpNurt\.(time|arrive|arriveAll|planArrival|attach|depart|arrivals)\b/.test(html), 'gra nie pyta efektu o harmonogram');
  // Kody rekordów w zakresie toru świata (74–127).
  const rc = read('src/render/renderCommands.js');
  for (const [k, v] of [['WARP_BEGIN', 74], ['WARP_ATTACH', 75], ['WARP_END', 76], ['WARP_CLEAR', 77]]) {
    assert.match(rc, new RegExp(`${k}: ${v}`));
  }
});
