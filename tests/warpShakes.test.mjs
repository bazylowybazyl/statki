// Wstrząsy skoku gracza i wyrzutów NPC po stronie GRY (src/game/warpShakes.js — nowy warp, etap W, DECYZJE W1; wzór
// RW-30). Dawniej zgłaszał je moduł renderu hakiem onShake podpiętym tylko na stronie — w workerze renderu (tryb gracza)
// ginęły: kop 18 / 0,3, wyjście 8 / 0,4, hamowanie 22 / 0,3 i wyrzuty NPC. Te same chwile i wartości liczy teraz gra.
// node --test tests/warpShakes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WARP_SHAKE, createWarpShakeState, stepWarpShakes, warpBurstShake, stepWarpBurstShakes } from '../src/game/warpShakes.js';
import { createWarpExitRamp, WARP_EXIT } from '../src/game/warpDrive.js';
import { HYPER_FLOW } from '../src/3d/warp/player.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DT = 1 / 60;

function runner() {
  const s = createWarpShakeState();
  const input = { alive: true, jumping: false, hyper: false, charging: false, ramp: null };
  const out = [];
  let t = 0;
  const step = () => { t += DT; stepWarpShakes(s, input, DT, (m, d) => out.push({ t, m, d })); };
  return { s, input, out, step, now: () => t };
}

test('skok z rampą: kop 18 / 0,3 raz, wyjście 8 / 0,4 raz, hamowanie 22 / 0,3 w chwili tBrake rampy — raz', () => {
  const r = runner();
  r.input.charging = true;
  for (let i = 0; i < 48; i++) r.step();
  assert.equal(r.out.length, 0, 'ładowanie bez wstrząsu (drżenie ładowania liczy rig)');
  r.input.charging = false; r.input.jumping = true;
  for (let i = 0; i < 120; i++) r.step();
  assert.deepEqual(r.out.map((e) => [e.m, e.d]), [[18, 0.3]]);
  // wyjście (exitWarp): rampa gry, wiek rośnie krokiem fizyki
  const ramp = createWarpExitRamp({ v0: 150000, hullLength: 1800, dirX: 1, dirY: 0, vEnd: 1521 });
  r.input.jumping = false; r.input.ramp = ramp;
  const tExit = r.now() + DT;
  let brakeAt = NaN;
  for (let i = 0; i < 200; i++) {
    ramp.age += DT;
    if (ramp.age >= ramp.tHalt) ramp.active = false;
    const n = r.out.length;
    r.step();
    if (r.out.length > n && r.out[r.out.length - 1].m === 22) brakeAt = ramp.age;
  }
  assert.deepEqual(r.out.map((e) => [e.m, e.d]), [[18, 0.3], [8, 0.4], [22, 0.3]]);
  assert.ok(Math.abs(r.out[1].t - tExit) < 1e-9, 'wyjście w kroku przejścia');
  assert.ok(brakeAt >= ramp.tBrake && brakeAt < ramp.tBrake + DT + 1e-9, `hamowanie w kroku przejścia rampy przez tBrake (${brakeAt})`);
  assert.deepEqual(WARP_SHAKE.kick, [18, 0.3]);
  assert.deepEqual(WARP_SHAKE.exit, [8, 0.4]);
  assert.deepEqual(WARP_SHAKE.brake, [22, 0.3]);
});

test('hamowanie grawitacyjne (bez rampy) i hipercruise: hamowanie po WARP_EXIT.slow + coast od wyjścia; kop hipercruise’u × 0,5', () => {
  const r = runner();
  r.input.jumping = true; r.input.hyper = true;
  r.step();
  assert.deepEqual([r.out[0].m, r.out[0].d], [18 * HYPER_FLOW.shake, 0.3]);
  assert.equal(WARP_SHAKE.hyperKickMul, HYPER_FLOW.shake);
  r.input.jumping = false; r.input.hyper = false;
  r.step();
  const tExit = r.now();
  for (let i = 0; i < 120; i++) r.step();
  assert.deepEqual(r.out.map((e) => e.m), [9, 8, 22]);
  const dt = r.out[2].t - tExit;
  assert.ok(dt >= WARP_EXIT.slow + WARP_EXIT.coast - 1e-9 && dt < WARP_EXIT.slow + WARP_EXIT.coast + DT + 1e-9, `hamowanie po ${dt} s`);
  // warp bez rampy (exitWarp({ abrupt })) — ta sama oś
  const q = runner();
  q.input.jumping = true; q.step();
  q.input.jumping = false; q.input.ramp = null; q.step();
  for (let i = 0; i < 80; i++) q.step();
  assert.deepEqual(q.out.map((e) => e.m), [18, 8, 22]);
});

test('nowe ładowanie przed hamowaniem kasuje czekające hamowanie; śmierć statku zeruje automat; lot trwający — jeden kop', () => {
  const r = runner();
  r.input.jumping = true; r.step(); r.step(); r.step();
  r.input.jumping = false; r.step();
  for (let i = 0; i < 20; i++) r.step();
  r.input.charging = true; r.step();
  for (let i = 0; i < 120; i++) r.step();
  assert.deepEqual(r.out.map((e) => e.m), [18, 8]);
  const d = runner();
  d.input.jumping = true; d.step();
  d.input.alive = false; d.step();
  d.input.alive = true; d.input.jumping = false;
  for (let i = 0; i < 120; i++) d.step();
  assert.deepEqual(d.out.map((e) => e.m), [18], 'martwy statek: bez wyjścia i hamowania');
});

test('lot prosto w ładowanie (hipercruise active → spool w jednym kroku): bez wyjścia i hamowania, kolejny lot — znowu kop', () => {
  // Dawny WarpPlayerFx: 'warp' → 'charging' wprost (bez _beginExit) — bez wstrząsu wyjścia i hamowania.
  const r = runner();
  r.input.jumping = true; r.input.hyper = true; r.step(); r.step();
  r.input.jumping = false; r.input.charging = true; r.step();
  for (let i = 0; i < 60; i++) r.step();
  assert.deepEqual(r.out.map((e) => e.m), [9], 'lot → ładowanie: sam kop');
  r.input.charging = false; r.input.jumping = true; r.step();
  r.input.jumping = false; r.input.hyper = false; r.step();
  for (let i = 0; i < 120; i++) r.step();
  assert.deepEqual(r.out.map((e) => e.m), [9, 9, 8, 22], 'następny lot: kop, potem zwykłe wyjście i hamowanie');
});

test('wyrzut NPC z tunelu: raz na oś po chwili hamowania, siła 12 · (0,4 + 0,8 · skala) · bliskość', () => {
  const fx = { x: 1000, y: 0, hullLength: 1500, sizeScale: 0.9, tBrake: 5 };
  assert.equal(warpBurstShake(fx, 1000, 0), 12 * (0.4 + 0.8 * 0.9));
  const reach = Math.max(4000, 1500 * 6);
  assert.ok(Math.abs(warpBurstShake(fx, 1000 + reach / 2, 0) - 12 * (0.4 + 0.8 * 0.9) * 0.5) < 1e-9);
  assert.equal(warpBurstShake(fx, 1000 + reach + 1, 0), 0);
  const recs = [{ kind: 'arrival', fx }, { kind: 'departure', fx: { x: 0, y: 0, tBrake: 0 } }, { kind: 'arrival', fx: { ...fx, tBrake: Infinity } }];
  const seen = new WeakSet();
  const out = [];
  const emit = (m, d) => out.push([m, d]);
  assert.equal(stepWarpBurstShakes(recs, 4.9, seen, 1000, 0, emit), 0, 'przed hamowaniem');
  assert.equal(stepWarpBurstShakes(recs, 5.0, seen, 1000, 0, emit), 1);
  assert.equal(stepWarpBurstShakes(recs, 6.0, seen, 1000, 0, emit), 0, 'raz na oś');
  assert.deepEqual(out, [[12 * (0.4 + 0.8 * 0.9), 0.35]]);
});

test('render nie wstrząsa (player.js, warpNurt.js bez onShake); gra zgłasza wstrząsy w kroku fizyki i po kroku rejestru warpa', () => {
  const player = read('src/3d/warp/player.js');
  const nurt = read('src/3d/warp/warpNurt.js');
  assert.doesNotMatch(player, /onShake\s*\(|this\.onShake\s*=/);
  assert.doesNotMatch(nurt, /this\.onShake\s*\(|_burstShake|player\.onShake/);
  const html = read('index.html');
  assert.doesNotMatch(html, /WarpNurt\.onShake\s*=/, 'bez podwójnego wstrząsu w trybie off');
  assert.match(html, /if \(ship\) ship\.noHullCollisions = updatePlayerWarpGhost\(\);[\s\S]{0,200}stepPlayerWarpShakes\(dt\);/);
  assert.match(html, /warpTraffic\.step\(dt\);[\s\S]{0,200}stepWarpBurstShakes\(warpTraffic\.records, warpTraffic\.time, _warpBurstSeen, camera\.x, camera\.y, _requestWarpShake\);/);
  assert.match(html, /const _requestWarpShake = \(mag, dur\) => \{ requestCameraShake\(camera, mag, dur\); \};/);
  // demo „Pęd” — ten sam automat (strona dema nie ma gry, więc woła go w swoim kroku fizyki)
  assert.match(read('dema/warp-ped.js'), /stepWarpShakes\(_warpShakes, _warpShakeIn, dt, addShake\);/);
});
