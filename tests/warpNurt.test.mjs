// Warp „Nurt” w grze (zadanie 22, src/3d/warp/): czyste moduły osi (odlot w warpDrive.js, skok
// gracza, przyloty / odloty NPC), kolano bloomu, zgięcie tła (lustro CPU), przyrost pudła ośrodka,
// pule klatki bez wzrostu, WGSL ośrodka i duszków zbudowany w Node (bez GPU, jak haloRingTSL).
// node --test tests/warpNurt.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  WARP_DEPARTURE_BASE, WARP_ARRIVAL_SHAPE, WARP_RUSH, WARP_EXIT, createWarpDeparture, sampleWarpDeparture, warpSizeScale,
  createWarpArrival, planWarpRush, sampleWarpRush, warpArrivalSpeed, warpBrakeTime,
  createWarpExitRamp, sampleWarpExitRamp, warpExitRampDistance, warpRulonBend
} from '../src/game/warpDrive.js';
import { WarpPlayerFx, WARP_FLOW, WARP_BUBBLE } from '../src/3d/warp/player.js';
import { WarpFrame, WARP_FRAME_CAPS, newWarpSlot } from '../src/3d/warp/frame.js';
import {
  planWarpArrivalFx, warpArrivalFxState, planWarpDepartureFx, departFxPose, warpDepartureFxState, HERALD_REACH,
  arrivalFxPose, setMovingBrake
} from '../src/3d/warp/arrivals.js';
import { writeWarpSkyBend, clearWarpSkyBend, warpSkyBendCount, warpSkyBendOffsetCpu } from '../src/3d/warp/skyBend.js';
import { WarpMedium, growShare } from '../src/3d/warp/medium.js';
import { RiftSprites, GlowSprites, SmearPool } from '../src/3d/warp/sprites.js';
import { warpPalette, entityWarpPaletteId } from '../src/3d/warp/palette.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── odlot: czysta oś w warpDrive.js (1:1 z planDeparture / departureState dema, iteracja 3) ────

test('odlot: oś dema — ładowanie 1,6 + 0,8·s, rozpęd ∝ t³ do punktu skoku 4 L przed dziobem, bez szczeliny', () => {
  for (const L of [1800, 1560, 420, 120]) {
    const s = warpSizeScale(L);
    const d = createWarpDeparture({ hullLength: L, startTime: 5, x: 100, y: -50, angle: 0.7 });
    assert.ok(near(d.charge, WARP_DEPARTURE_BASE.charge + WARP_DEPARTURE_BASE.chargePerSize * s));
    assert.ok(near(d.tDive, 5 + d.charge));
    assert.ok(near(d.rushDist, L * WARP_RUSH.departDist));
    assert.ok(near(d.accel, WARP_RUSH.accel + WARP_RUSH.accelPerSize * s));
    assert.ok(near(d.vEnd, 3 * d.rushDist / d.accel));
    assert.ok(near(d.tIn, d.tDive + d.accel));
    assert.ok(near(d.tGone, d.tIn + L * 1.1 / d.vEnd));
    assert.ok(near(d.tEnd, d.tGone + 0.45 + 0.2));
    const ahead = L * 0.5 + d.rushDist;
    assert.ok(near(d.cx, 100 + Math.cos(0.7) * ahead, 1e-6) && near(d.cy, -50 + Math.sin(0.7) * ahead, 1e-6));
    assert.ok(near(d.mouth, ahead));
    assert.equal(d.seamLength, undefined, 'bez szczeliny');
  }
});

test('odlot: próbka — fazy po kolei, droga ∝ t³ (pochodna = prędkość), kadłub znika za punktem skoku', () => {
  const d = createWarpDeparture({ hullLength: 1000, startTime: 1 });
  const s = {};
  assert.equal(sampleWarpDeparture(d, 0.5, s).phase, 'wait');
  assert.equal(s.build, 0);
  sampleWarpDeparture(d, d.tDive - 0.01, s);
  assert.equal(s.phase, 'charge');
  assert.ok(s.build > 0.9 && s.build < 1);
  assert.equal(s.dist, 0);
  sampleWarpDeparture(d, d.tDive + d.accel * 0.5, s);
  assert.equal(s.phase, 'dive');
  assert.ok(near(s.dist, d.rushDist * 0.125, 1e-6));
  assert.ok(near(s.speed, d.vEnd * 0.25, 1e-6));
  assert.ok(near(s.revealLine, d.mouth - s.dist, 1e-6));
  assert.ok(s.shake > 0 && s.heat > 0.25);
  sampleWarpDeparture(d, d.tIn, s);
  assert.ok(near(s.dist, d.rushDist, 1e-6) && near(s.speed, d.vEnd, 1e-6), 'w punkcie skoku pełna prędkość');
  sampleWarpDeparture(d, d.tGone - 1e-6, s);
  assert.equal(s.shipVisible, false, 'rufa za punktem skoku');
  assert.equal(sampleWarpDeparture(d, d.tGone + 0.1, s).phase, 'close');
  assert.equal(sampleWarpDeparture(d, d.tEnd + 0.01, s).phase, 'done');
  const bad = createWarpDeparture({ hullLength: NaN, x: undefined, angle: 'x', startTime: null });
  for (const t of [-1, 0, 1, 2.5, 100]) {
    sampleWarpDeparture(bad, t, s);
    for (const k of ['build', 'dist', 'speed', 'revealLine', 'heat', 'shake']) assert.ok(Number.isFinite(s[k]), `${k} skończone`);
  }
});

// ── przylot: rozpęd i hamowanie (warpDrive.js: planWarpRush) ─────────────────────────────────

test('przylot: wlot z prędkością 9 L/s z daleka, hamowanie na 0,9 L od chwili dawnego wyrzutu, staje w punkcie zwiastuna', () => {
  for (const L of [1800, 1000, 300]) {
    const a = planWarpRush(createWarpArrival({ x: 500, y: 700, angle: 0.3, hullLength: L, startTime: 2 }));
    assert.ok(near(a.v0, warpArrivalSpeed(L)));
    assert.ok(a.v0 >= WARP_RUSH.arriveSpeedMin && a.v0 <= WARP_RUSH.arriveSpeedMax);
    assert.ok(near(a.tBrake, a.tBurst), 'hamowanie = dawny wyrzut (oś zwiastuna bez zmian)');
    assert.ok(a.rushDist >= WARP_RUSH.arriveMin && a.coast >= WARP_RUSH.arriveCoast - 1e-9);
    assert.ok(near(a.brake, warpBrakeTime(L, a.v0)));
    const s = {};
    sampleWarpRush(a, a.tAppear - 0.01, s);
    assert.equal(s.appeared, false);
    sampleWarpRush(a, a.tAppear + 0.1, s);
    assert.ok(near(s.speed, a.v0) && near(s.along, a.v0 * 0.1, 1e-6));
    sampleWarpRush(a, a.tBrake + a.brake * 0.5, s);
    assert.ok(near(s.speed, a.v0 * 0.5, 1e-6));
    sampleWarpRush(a, a.tStop + 0.01, s);
    assert.ok(near(s.off, 0, 1e-6) && s.speed === 0, 'stoi w miejscu zatrzymania');
    // Droga hamowania = 0,9 L (stałe opóźnienie).
    const before = sampleWarpRush(a, a.tBrake, {}).along;
    assert.ok(near(a.rushDist - before, L * WARP_RUSH.brakeDist, 1e-6));
  }
});

test('wyjście gracza: rampa — zwolnienie do prędkości wlotu, wlot, hamowanie; droga zgodna z próbką', () => {
  const L = 1800;
  const r = createWarpExitRamp({ v0: 60000, hullLength: L, dirX: 0, dirY: 2 });
  assert.ok(near(r.dirY, 1) && near(r.dirX, 0));
  assert.ok(near(r.vArr, warpArrivalSpeed(L)));
  assert.ok(near(r.tSlowEnd, WARP_EXIT.slow) && near(r.tBrake, WARP_EXIT.slow + WARP_EXIT.coast));
  const s = {};
  assert.ok(near(sampleWarpExitRamp(r, 0, s).speed, 60000));
  assert.equal(sampleWarpExitRamp(r, r.tSlowEnd + 0.01, s).phase, 'coast');
  assert.ok(near(s.speed, r.vArr));
  assert.equal(sampleWarpExitRamp(r, r.tBrake + 1e-3, s).phase, 'brake');
  assert.equal(sampleWarpExitRamp(r, r.tHalt + 1e-3, s).phase, 'done');
  // Całka prędkości = warpExitRampDistance (travel to zaczyna wyjście z tej drogi).
  let dist = 0;
  const h = 1 / 4000;
  for (let t = 0; t < r.tHalt; t += h) dist += sampleWarpExitRamp(r, t + h * 0.5, s).speed * h;
  assert.ok(Math.abs(dist - warpExitRampDistance(60000, L)) < 30, `droga ${dist} vs ${warpExitRampDistance(60000, L)}`);
  assert.ok(near(r.dist, warpExitRampDistance(60000, L)));
  // Wolny warp nie przyspiesza przy wyjściu.
  const slow = createWarpExitRamp({ v0: 8000, hullLength: L });
  assert.ok(near(slow.vArr, 8000));
});

test('rulon: ładowanie zwija (0 → 1), skok nabrzmiewa miękko ponad 1, wyjście rozwija płynnie przez zwolnienie i wlot; poza skokiem 0', () => {
  assert.equal(warpRulonBend('charging', 0, 0, 0), 0);
  assert.ok(near(warpRulonBend('charging', 1, 0, 0), 1));
  let prev = -1;
  for (let c = 0; c <= 1; c += 0.05) { const b = warpRulonBend('charging', c, 0, 0); assert.ok(b >= prev - 1e-12); prev = b; }
  // Płynność (user 2026-10-08): bez szarpnięć — nachylenie na krańcach ładowania ~0, szczyt ≤ 1,5 / ładowanie.
  const h = 1e-3;
  assert.ok((warpRulonBend('charging', h, 0, 0) - 0) / h < 0.01, 'zwijanie rusza od zera');
  assert.ok((1 - warpRulonBend('charging', 1 - h, 0, 0)) / h < 0.01, 'zwijanie dochodzi do skoku bez szarpnięcia');
  for (let c = 0; c < 1; c += 0.01) assert.ok(warpRulonBend('charging', c + 0.01, 0, 0) - warpRulonBend('charging', c, 0, 0) <= 0.0151);
  // Skok: nabrzmienie zaczyna się od nachylenia ~0 (dawniej +16% w 0,03 s), szczyt ~+7%, potem gaśnie.
  assert.ok(warpRulonBend('active', 1, 0.01, 0) - 1 < 0.002, 'skok bez szarpnięcia');
  assert.ok(warpRulonBend('active', 1, 0.15, 0) > 1.05, 'nabrzmienie przy skoku');
  for (let k = 0; k < 3; k += 0.01) assert.ok(warpRulonBend('active', 1, k, 0) < 1.1);
  assert.ok(near(warpRulonBend('active', 1, 30, 0), 1, 1e-9));
  // Wyjście: rozwijanie rusza od zera i trwa zwolnienie + wlot rampy (domyślny czas).
  const dur = WARP_EXIT.slow + WARP_EXIT.coast;
  assert.ok(warpRulonBend('exit', 1, 30, 0.02) > 0.995, 'rozwijanie rusza płynnie');
  assert.ok(warpRulonBend('exit', 1, 30, WARP_EXIT.slow) > 0.2, 'po zwolnieniu część rulonu jeszcze zwinięta');
  assert.ok(near(warpRulonBend('exit', 1, 30, dur), 0, 1e-9));
  assert.equal(warpRulonBend('idle', 1, 0, 0), 0);
});

// ── skok gracza (automat gry → fazy efektu) ─────────────────────────────────────────────────

function playerRig() {
  const fx = new WarpPlayerFx();
  fx.bubble = newWarpSlot();
  fx.push = newWarpSlot();
  const shakes = [];
  fx.onShake = (m, d) => shakes.push([m, d]);
  const frame = new WarpFrame();
  const game = { state: 'idle', charge: 0, chargeTime: 0.8, gear: 1, speed: 0, angle: 0.3, x: 1000, y: 2000, length: 1800, width: 800, palette: 'magenta', vRelX: 0, vRelY: 0, exitRamp: null };
  const map = { camX: 900, camY: 1900 };
  const med = { camMX: 0, camMY: 0, flow: 0, flowX: 0, flowY: 0 };
  const step = (t, dt) => {
    frame.reset();
    fx.advance(t, dt, game, map, med);
    const v = fx.visibleFlow(t);
    med.flow = v === null ? 0 : v;
    med.flowX = Math.cos(fx.angle) * med.flow;
    med.flowY = Math.sin(fx.angle) * med.flow;
    med.camMX += med.flowX * dt;
    med.camMY += med.flowY * dt;
    fx.fill(t, game, frame, map, med);
  };
  return { fx, frame, game, map, med, step, shakes };
}

test('skok gracza: ładowanie ściśnięte do 0,8 s (naprężenie ×3,75, wzbudzenie ×3,75^0,6), bańka rośnie, rulon się zwija', () => {
  const { fx, frame, game, step } = playerRig();
  const dt = 1 / 60;
  let t = 0;
  game.state = 'charging';
  const A = [];
  for (let i = 1; i <= 48; i++) {
    t += dt;
    game.charge = Math.min(1, i / 48);
    step(t, dt);
    A.push(fx.bubble.A);
  }
  assert.equal(fx.mode, 'charging');
  assert.ok(near(fx.chargeK, 3 / 0.8, 1e-12));
  assert.ok(near(fx.chargeBoost, Math.pow(3 / 0.8, 0.6), 1e-12));
  for (let i = 1; i < A.length; i++) assert.ok(A[i] >= A[i - 1] - 1e-12, 'amplituda bańki nie maleje w ładowaniu');
  assert.ok(near(A[A.length - 1], 1, 1e-9));
  assert.equal(frame.bubbles.length, 1);
  assert.ok(frame.bubbles[0].excite > 1.6 * 2, 'wzbudzenie wzmocnione (krótkie ładowanie gry)');
  assert.ok(frame.lens.count === 1, 'soczewka bańki na mgławicy');
  assert.ok(frame.stars.stretch > 0.3 && frame.stars.stretch < 0.33, 'gwiazdy płasko 0,32·ładowanie²');
  assert.ok(near(fx.rulonBend, 1, 1e-9) && near(fx.rulonField, 1, 1e-9), 'rulon i lejek zwinięte na końcu ładowania');
  assert.ok(near(frame.bubbles[0].R, 1800 * WARP_BUBBLE.radiusK) && near(frame.bubbles[0].asp, WARP_BUBBLE.asp));
});

test('skok gracza: kop — przepływ widoczny 900 → prędkość warpa (jedna); wyjście z rampy rozgrywki — zwolnienie, hamowanie (błysk, fala, żar, iskry), ośrodek gaśnie', () => {
  const { fx, frame, game, med, step, shakes } = playerRig();
  const dt = 1 / 60;
  let t = 1;
  game.state = 'charging'; game.charge = 1;
  step(t, dt);
  game.state = 'active';
  t += dt; step(t, dt);
  assert.equal(fx.mode, 'warp');
  assert.equal(shakes.length, 1, 'jeden wstrząs przy kopnięciu');
  assert.ok(near(fx.visibleFlow(fx.kickT), 900));
  assert.ok(near(fx.visibleFlow(fx.kickT + 0.45), WARP_FLOW.travel, 1e-6));
  assert.equal(frame.waves.count, 1);
  for (let i = 0; i < 30; i++) { t += dt; step(t, dt); }
  const w = frame.waves.items[0];
  assert.ok(w.x * Math.cos(fx.angle) + w.y * Math.sin(fx.angle) < -1000, 'fala skoku za statkiem (przestrzeń widoczna)');
  assert.ok(frame.stars.stretch > 0.9 && frame.warpVis > 0.99);
  assert.ok(fx.rulonBend >= 1 - 1e-9, 'rulon w locie');
  // Wyjście: rampa z gry (wiek rośnie zegarem gry).
  const ramp = createWarpExitRamp({ v0: 40000, hullLength: 1800, dirX: Math.cos(0.3), dirY: Math.sin(0.3) });
  game.exitRamp = ramp;
  game.state = 'idle';
  t += dt; step(t, dt);
  assert.equal(fx.mode, 'exit');
  assert.equal(frame.stars.frontOn, 1);
  assert.equal(shakes.length, 2, 'lekki wstrząs na początku wyjścia');
  assert.ok(fx.visibleFlow(t) > 1000, 'zwolnienie z prędkości widocznej');
  assert.ok(fx.visibleFlow(fx.exitT + ramp.slow + 0.01) === null, 'po zwolnieniu ośrodek idzie za prawdziwą kamerą');
  const tEx = fx.exitT;
  while (t < tEx + ramp.tBrake + 0.05) { t += dt; ramp.age = t - tEx; step(t, dt); }
  assert.ok(near(fx.rulonBend, 0, 1e-9), 'rulon rozwinięty po zwolnieniu');
  assert.ok(frame.glares.count === 1 && frame.flashes.count >= 1, 'błysk i blask na dziobie przy hamowaniu');
  assert.ok(frame.bubbles.includes(fx.push), 'iskry ośrodka przed dziobem');
  assert.ok(fx.bubble.front < 1.3, 'bańka zapada się od dziobu');
  assert.equal(shakes.length, 3, 'wstrząs hamowania');
  for (let i = 0; i < 6; i++) { t += dt; ramp.age = t - tEx; step(t, dt); }
  assert.ok(fx.hull.on && fx.hull.heat > 0.8, 'żar kadłuba po hamowaniu');
  while (t < tEx + ramp.tHalt + 1.0) { t += dt; step(t, dt); }
  assert.equal(frame.mediumFade, 4, 'ośrodek gaśnie po zatrzymaniu');
  for (let i = 0; i < 200; i++) { t += dt; step(t, dt); }
  assert.equal(fx.mode, 'idle');
  assert.equal(fx.rulonBend, 0);
  assert.ok(med.camMX !== 0, 'kamera ośrodka jechała w skoku');
});

test('soczewka świata (2026-10-07): β 0 → 1 w 0,5 s po skoku, do końca zwolnienia 1, przy zatrzymaniu 0; przepływ zwalnia przy mijanym ciele', () => {
  const { fx, game, step } = playerRig();
  const dt = 1 / 60;
  let t = 1;
  game.state = 'charging'; game.charge = 0.6;
  step(t, dt);
  assert.equal(fx.lensBeta(t), 0, 'w ładowaniu planety na swoich miejscach');
  game.state = 'active'; game.charge = 1;
  t += dt; step(t, dt);
  assert.equal(fx.lensBeta(fx.kickT), 0);
  assert.ok(fx.lensBeta(fx.kickT + 0.25) > 0.3 && fx.lensBeta(fx.kickT + 0.25) < 0.7);
  assert.ok(near(fx.lensBeta(fx.kickT + 0.5), 1));
  // Przy mijanym ciele (zwolnienie fizyki gry: flyby) przepływ widoczny zwalnia jak w demie: max(2500, bieg · f^0,6).
  game.flyby = 0.2;
  for (let i = 0; i < 40; i++) { t += dt; step(t, dt); }
  assert.ok(near(fx.visibleFlow(t), Math.max(WARP_FLOW.slowMin, WARP_FLOW.travel * Math.pow(0.2, 0.6)), 1e-6));
  game.flyby = 0.001;
  t += dt; step(t, dt);
  assert.ok(near(fx.visibleFlow(t), WARP_FLOW.slowMin, 1e-6), 'dolna granica przepływu');
  game.flyby = 1;
  t += dt; step(t, dt);
  // Wyjście: β trzyma się przez zwolnienie, spada do zera w locie hamującym (cel „wlatuje”).
  const ramp = createWarpExitRamp({ v0: 200000, hullLength: 1800, dirX: Math.cos(0.3), dirY: Math.sin(0.3) });
  game.exitRamp = ramp;
  game.state = 'idle';
  t += dt; step(t, dt);
  assert.equal(fx.mode, 'exit');
  assert.ok(near(fx.lensBeta(fx.exitT + ramp.slow * 0.9), 1));
  const mid = fx.lensBeta(fx.exitT + (ramp.slow + ramp.tHalt) * 0.5);
  assert.ok(mid > 0.2 && mid < 0.8);
  assert.equal(fx.lensBeta(fx.exitT + ramp.tHalt), 0);
  // Krótki skok (wyjście przed końcem narastania): β z chwili wyjścia, bez skoku w górę.
  const r2 = playerRig();
  let t2 = 1;
  r2.game.state = 'active'; r2.game.charge = 1;
  r2.step(t2, dt);
  for (let i = 0; i < 12; i++) { t2 += dt; r2.step(t2, dt); }
  const beforeExit = r2.fx.lensBeta(t2);
  r2.game.exitRamp = createWarpExitRamp({ v0: 30000, hullLength: 1800 });
  r2.game.state = 'idle';
  t2 += dt; r2.step(t2, dt);
  assert.ok(beforeExit < 0.9 && r2.fx.lensBeta(t2) <= beforeExit + 0.05);
});

// ── przyloty i odloty NPC ────────────────────────────────────────────────────────────────────

test('przylot (plan z wyprzedzeniem): zwiastun do miejsca zatrzymania → okręt wpada z daleka → hamowanie z błyskiem, blaskiem, iskrami', () => {
  const a = planWarpArrivalFx({ x: 0, y: 0, angle: -0.5, hullLength: 1560, hullWidth: 620, palette: 'magenta', burstTime: 10 });
  assert.ok(near(a.tBrake, 10, 1e-9), 'hamowanie w zadanej chwili');
  assert.ok(near(a.tSpawn, a.tAppear) && a.tAppear < 10, 'okręt pojawia się przed hamowaniem');
  assert.ok(near(a.pushSlot.releaseT, 10.02, 1e-9));
  assert.ok(a.drive && !a.moving, 'wezwanie prowadzi efekt');
  const frame = new WarpFrame();
  frame.reset();
  warpArrivalFxState(a, a.t0 + a.herald * 0.6, frame, 0, 0, null);
  assert.equal(frame.bubbles.length, 1, 'nić zwiastuna');
  assert.equal(frame.bubbles[0].heraldLen, HERALD_REACH);
  assert.ok(frame.flashes.count >= 1, 'punkt zbierania');
  assert.equal(frame.rifts.count, 0, 'bez szczeliny');
  // Wlot: pozycja z osi — daleko za celem, kadłub odsłania się od dziobu.
  const pose = { x: 0, y: 0, vx: 0, vy: 0 };
  arrivalFxPose(a, a.tAppear + 0.02, pose);
  const back = pose.x * Math.cos(-0.5) + pose.y * Math.sin(-0.5);
  assert.ok(back < -a.rushDist * 0.9, 'okręt za miejscem zatrzymania');
  frame.reset();
  warpArrivalFxState(a, a.tAppear + 0.02, frame, 0, 0, { ...pose, angle: -0.5, visible: true });
  assert.ok(a.hull.on && a.hull.revealMode === 1, 'odsłanianie od dziobu');
  assert.equal(a.plasmaMode, 'active');
  assert.equal(frame.smears.count, 0, 'bez smugi sylwetki');
  // Hamowanie.
  arrivalFxPose(a, 10.05, pose);
  frame.reset();
  warpArrivalFxState(a, 10.05, frame, 0, 0, { ...pose, angle: -0.5, visible: true });
  assert.ok(frame.bubbles.includes(a.pushSlot), 'iskry ośrodka przed dziobem');
  assert.ok(frame.glares.count === 1, 'blask poprzeczny');
  assert.equal(a.hull.revealMode, 0, 'kadłub cały');
  assert.ok(a.hull.heat > 0.3, 'żar hamowania');
  arrivalFxPose(a, a.tStop + 0.01, pose);
  assert.ok(near(pose.x, 0, 1e-6) && near(pose.y, 0, 1e-6) && pose.vx === 0, 'stoi w miejscu zwiastuna');
});

test('przylot prowadzony przez grę (warp-in): odsłanianie od miejsca pojawienia się, hamowanie od wyjścia z warp-in', () => {
  const a = planWarpArrivalFx({ x: 100, y: 0, angle: 0, hullLength: 900, hullWidth: 400, palette: 'crimson', pirate: true, moving: true, appearTime: 3, speed: 4000 });
  a.x0 = 100; a.y0 = 0;
  assert.equal(a.tBrake, Infinity);
  const frame = new WarpFrame();
  frame.reset();
  warpArrivalFxState(a, 3.05, frame, 0, 0, { x: 300, y: 0, angle: 0, vx: 4000, vy: 0, visible: true });
  assert.ok(near(a.hull.revealLine, 900 * 0.56 - 200, 1e-6));
  assert.ok(!frame.bubbles.includes(a.heraldSlot), 'bez zwiastuna (gra zna okręt dopiero teraz)');
  setMovingBrake(a, 3.5, 4000);
  assert.ok(near(a.tStop, 3.5 + warpBrakeTime(900, 4000)) && Number.isFinite(a.tEnd));
  frame.reset();
  warpArrivalFxState(a, 3.55, frame, 0, 0, { x: 1600, y: 0, angle: 0, vx: 400, vy: 0, visible: true });
  assert.ok(frame.glares.count === 1);
});

test('odlot (drive): punkt skoku przed dziobem, kop od rufy, okręt prowadzony drogą z osi, kadłub znika za punktem skoku', () => {
  const d = planWarpDepartureFx({ x: 100, y: 200, angle: 0.4, hullLength: 1200, hullWidth: 500, palette: 'crimson', pirate: true, drive: true, startTime: 3 });
  const frame = new WarpFrame();
  const pose = { x: 0, y: 0, vx: 0, vy: 0 };
  frame.reset();
  departFxPose(d, d.t0 + 0.5, pose);
  assert.ok(near(pose.x, 100) && near(pose.y, 200), 'w ładowaniu okręt stoi');
  warpDepartureFxState(d, d.t0 + 0.5, frame, 0, 0, { x: pose.x, y: pose.y, angle: 0.4 });
  assert.equal(frame.bubbles.length, 1, 'punkt skoku zbiera ośrodek');
  assert.equal(frame.rifts.count, 0, 'bez szczeliny');
  assert.equal(d.hull.revealMode, 0);
  const t = d.tDive + d.accel * 0.8;
  departFxPose(d, t, pose);
  frame.reset();
  warpDepartureFxState(d, t, frame, 0, 0, { x: pose.x, y: pose.y, angle: 0.4 });
  const dist = Math.hypot(pose.x - 100, pose.y - 200);
  assert.ok(near(dist, d.rushDist * 0.512, 1e-6));
  assert.equal(d.hull.revealMode, -1, 'widać tylko część za punktem skoku');
  assert.ok(near(d.hull.revealLine, d.mouth - dist, 1e-6));
  assert.ok(frame.waves.count >= 1, 'fala kopu za rufą');
  assert.ok(frame.bubbles.includes(d.bubbleSlot), 'bańka w rozpędzie');
  assert.equal(frame.smears.count, 0);
  assert.equal(d.plasmaMode, 'active');
});

// ── bloom jak w demie, zgięcie tła, pudło ośrodka, pule ─────────────────────────────────────

// Zadanie 25b (decyzja użytkownika 2026-09-28: „do poziomu dem”): bloom gry = bloom dema (bez ×3 dawnego passu
// WebGL), więc szczeliny, błyski, smugi i szew / żar kadłuba mają barwy HDR 1:1 z dema — kolano z zadania 22
// (warp/bloomKnee.js, nadmiar ponad próg × 1/3) usunięte.
test('bloom jak w demie: duszki „Nurtu” i szew / żar kadłuba bez kolana (barwy HDR z dema 1:1)', () => {
  const sprites = read('src/3d/warp/sprites.js');
  const hull = read('src/3d/hexShips3D.tsl.js');
  assert.doesNotMatch(sprites + hull, /BloomKnee|bloomKnee/);
  assert.match(sprites, /return vec4\(max\(col, vec3\(0\.0\)\), 0\.0\);/);
  assert.match(sprites, /return vec4\(gB\.rgb\.mul\(shape\), 0\.0\);/);
  assert.match(hull, /\.add\(B\.xyz\.mul\(seamK\)\)/);
});

test('zgięcie tła (lustro CPU): bez zgłoszeń zero; bańka ściska przed i rozciąga za; szczelina wciąga ku osi', () => {
  clearWarpSkyBend();
  assert.equal(warpSkyBendCount(), 0);
  const o = warpSkyBendOffsetCpu(500, 400);
  assert.equal(o.x, 0); assert.equal(o.y, 0);
  const lens = [{ x: 1000, y: 500, ax: 1, ay: 0, a: 200, b: 150, amp: 26, front: 3 }];
  const seams = [{ x: 0, y: 0, ax: 1, ay: 0, halfLen: 300, band: 40, amp: 14 }];
  writeWarpSkyBend(lens, 1, seams, 1);
  assert.equal(warpSkyBendCount(), 2);
  // W kieszeni (wewnątrz bańki) płasko.
  const inside = warpSkyBendOffsetCpu(1050, 500, { x: 0, y: 0 });
  assert.equal(inside.x, 0);
  // Wzór dema: k = siła·(−n.x·ściana + 0,35·ściana) wzdłuż promienia — przed bańką (n.x = 1) próbka
  // ku środkowi (−0,65), za nią (n.x = −1) od środka i mocniej (+1,35).
  const front = warpSkyBendOffsetCpu(1000 + 200 * 1.15, 500, { x: 0, y: 0 });
  const back = warpSkyBendOffsetCpu(1000 - 200 * 1.15, 500, { x: 0, y: 0 });
  assert.ok(front.x < 0, 'przed bańką: próbka ku środkowi');
  assert.ok(back.x < 0, 'za bańką: próbka od środka');
  assert.ok(near(back.x / front.x, 1.35 / 0.65, 1e-6));
  // Front zapadania wyłącza soczewkę od czoła.
  writeWarpSkyBend([{ ...lens[0], front: -2 }], 1, seams, 0);
  assert.equal(warpSkyBendOffsetCpu(1000 + 200 * 1.15, 500, { x: 0, y: 0 }).x, 0);
  // Szczelina: przesunięcie w poprzek osi, od osi (tło wciągane ku niej), zero daleko za końcami.
  writeWarpSkyBend(lens, 0, seams, 1);
  const up = warpSkyBendOffsetCpu(0, 30, { x: 0, y: 0 });
  const down = warpSkyBendOffsetCpu(0, -30, { x: 0, y: 0 });
  assert.ok(up.y > 0 && down.y < 0);
  assert.equal(warpSkyBendOffsetCpu(600, 30, { x: 0, y: 0 }).y, 0);
  clearWarpSkyBend();
  // Mgławica czyta blok tylko przy zgłoszeniach (bez nich materiał jak przed zadaniem 22).
  assert.match(read('src/3d/planet3d.assets.tsl.js'), /warpSkyBendOffset\(screenCoordinate\.xy\)/);
});

test('pudło ośrodka: przy oddaleniu część drobin przenosi się w nowy pas (gęstość na ekranie równa)', () => {
  assert.equal(growShare(1), 0);
  assert.equal(growShare(0.5), 0, 'przybliżenie — drobiny zawijają się w mniejsze pudło');
  const r = 2;
  const f = 1 - 1 / r;
  assert.ok(near(growShare(r), f / (1 - Math.pow(r, -4))));
  // Oczekiwany udział przeniesionych = f (wybór × szansa trafienia w pas w 4 losowaniach).
  for (const rr of [1.01, 1.3, 2, 4]) {
    const moved = growShare(rr) * (1 - Math.pow(rr, -4));
    assert.ok(near(moved, Math.min(1 - 1 / rr, 1 - Math.pow(rr, -4)), 1e-12));
  }
});

test('klatka warpa: pule o stałej pojemności (bez wzrostu i alokacji na klatkę)', () => {
  const frame = new WarpFrame();
  const pal = warpPalette('magenta');
  const lens0 = frame.flashes.items;
  for (let i = 0; i < WARP_FRAME_CAPS.flashes + 20; i++) frame.addFlash(i, 0, 10, 1, pal, false);
  for (let i = 0; i < WARP_FRAME_CAPS.rifts + 5; i++) frame.addRift(0, 0, 0, 10, 5, 1, pal, 0, 1, 1);
  for (let i = 0; i < WARP_FRAME_CAPS.bubbles + 5; i++) frame.pushBubble(newWarpSlot());
  assert.equal(frame.flashes.count, WARP_FRAME_CAPS.flashes);
  assert.equal(frame.rifts.count, WARP_FRAME_CAPS.rifts);
  assert.equal(frame.bubbles.length, WARP_FRAME_CAPS.bubbles);
  assert.equal(frame.flashes.items, lens0);
  assert.equal(frame.flashes.items.length, WARP_FRAME_CAPS.flashes);
  frame.reset();
  assert.equal(frame.busy, false);
  // Palety: te same co plazma WARP gry; piraci karmazyn, reszta magenta.
  assert.equal(entityWarpPaletteId({ isPirate: true }), 'crimson');
  assert.equal(entityWarpPaletteId({}), 'magenta');
  assert.equal(entityWarpPaletteId({ visual: { engineFx: { warpPalette: 'ion_blue' } } }), 'ion_blue');
  assert.equal(warpPalette('magenta'), pal, 'paleta z pamięci podręcznej (bez alokacji)');
});

test('klatka warpa: daleki przylot nie budzi ośrodka — przegródki i szczeliny poza pudłem wypadają', async () => {
  const { cullWarpFrameToView } = await import('../src/3d/warp/frame.js');
  const frame = new WarpFrame();
  const mk = (x, y, R, extra = {}) => Object.assign(newWarpSlot(), { x, y, R, asp: 1.35 }, extra);
  const nearB = mk(3000, -2000, 900);
  const farB = mk(400000, 0, 900);
  // Nić zwiastuna: początek daleko (60 tys. j. za punktem wyjścia), ale przechodzi przez kadr.
  const thread = mk(-60000, 500, 900, { heraldLen: 60000, angle: 0, pullR: 700 });
  const farThread = mk(-60000, 90000, 900, { heraldLen: 60000, angle: 0, pullR: 700 });
  for (const b of [nearB, farB, thread, farThread]) frame.pushBubble(b);
  frame.addSeam(2000, 1000, 0.3, 1000, 50, 900, 2600);
  frame.addSeam(-300000, 0, 0.3, 1000, 50, 900, 2600);
  frame.addSeam(-1000, 500, 0.3, 1000, 50, 900, 2600);
  // Kadr 1920×1080, ogniskowa ~1712 px, zoom 0,1 (kamera perspektywy 17 tys. j. nad płaszczyzną).
  const focal = 540 / Math.tan((35 / 2) * Math.PI / 180);
  cullWarpFrameToView(frame, 960, 540, focal, focal / 0.1);
  assert.deepEqual(frame.bubbles, [nearB, thread]);
  assert.equal(frame.seams.count, 2);
  assert.equal(frame.seams.items[0].x, 2000);
  assert.equal(frame.seams.items[1].x, -1000, 'kompakcja w miejscu (bez nowych obiektów)');
  assert.equal(frame.seams.items.length, WARP_FRAME_CAPS.seams);
});

// ── WGSL w Node (bez GPU) ────────────────────────────────────────────────────────────────────

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildMesh(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
function buildCompute(node) {
  const b = renderer.backend.createNodeBuilder(node, renderer);
  b.build();
  return b.computeShader;
}
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
const vertexInputs = (wgsl) => (wgsl.match(/@location\( ?\d+ ?\) [A-Za-z_]+ : /g) || []).length;
// smoothstep ze STAŁYMI krawędziami low ≥ high to błąd tworzenia shadera WGSL (PLAN §3, pułapka 6).
function assertNoReversedSmoothstep(wgsl) {
  const re = /smoothstep\(\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,/g;
  let m;
  while ((m = re.exec(wgsl))) assert.ok(Number(m[1]) < Number(m[2]), `odwrócone krawędzie: ${m[0]}`);
}

test('ośrodek: kernele i materiał budują się do WGSL w limitach (≤ 12 buforów uniformów, 4 bufory storage)', () => {
  const m = new WarpMedium({ count: 1024 });
  for (const node of [m.initNode, m.stepNode]) {
    const w = buildCompute(node);
    assert.ok(uniformBuffers(w) <= 12);
    assert.equal((w.match(/var<storage/g) || []).length, 4);
    assertNoReversedSmoothstep(w);
  }
  const r = buildMesh(m.mesh);
  assert.ok(uniformBuffers(r.vertex) <= 12 && uniformBuffers(r.fragment) <= 12);
  assert.equal(m.mesh.layers.mask, 1 << 8, 'warstwa ośrodka 8');
  // Liczba instancji stała ≥ 2 (przejście 1 ↔ > 1 przebudowuje potok).
  assert.ok(m.mesh.count >= 2);
});

test('duszki warpa: szczeliny, błyski, smugi — WGSL w limicie buforów wierzchołków, addytywne w jednym przejściu', () => {
  const rift = new RiftSprites();
  const glow = new GlowSprites();
  const sm = new SmearPool(2);
  for (const mesh of [rift.mesh, glow.mesh, sm.items[0].mesh]) {
    const w = buildMesh(mesh);
    assert.ok(vertexInputs(w.vertex) <= 8, `${mesh.name}: najwyżej 8 buforów wierzchołków`);
    assert.ok(uniformBuffers(w.vertex) <= 12 && uniformBuffers(w.fragment) <= 12);
    assert.equal(mesh.material.forceSinglePass, true);
    assert.equal(mesh.material.depthWrite, false);
  }
  // Wspólny graf smug (bez NodeBuildera na smugę).
  assert.equal(sm.items[0].material.fragmentNode, sm.items[1].material.fragmentNode);
});

test('Core3D: pass ośrodka po ring-planetach, bez treści pomijany; brak dawnego API soczewki', () => {
  const core = read('src/3d/core3d.js');
  assert.match(core, /makeScenePass\('warp', 'warp', WARP_MEDIUM_RENDER_LAYER/);
  assert.match(core, /setWarpLayerActive\(/);
  assert.doesNotMatch(core, /setWarpLensWorld\(|clearWarpLens\(|pushWarpSpaceWorld\(|setWarpStarsObject\(/);
  const nurt = read('src/3d/warp/warpNurt.js');
  assert.match(nurt, /Core3D\.setWarpLayerActive\(drawMedium\)/);
  // Ośrodek od nowa po przebudzeniu i po skoku kamery (ślad skoku nie zostaje w nowym miejscu).
  assert.match(nurt, /_wake\(\) \{\n {4}this\.awake = true;[\s\S]*?this\._reseed = true;/);
  assert.match(nurt, /if \(this\._reseed\) \{[\s\S]*?medium\.reset\(renderer\);/);
});

test('ośrodek w skoku: kamera ośrodka = widoczna droga statku + zmiana offsetu kamery gry (kop warpa, 22-B)', async () => {
  // Demo: kamera = statek + kurs · (wyprzedzenie − cofnięcie), ośrodek zakotwiczony w kamerze — przy
  // kopie statek odskakuje od drobin, kamera go dogania. Sterownik bez GPU (Core3D zaślepiony).
  const { Core3D } = await import('../src/3d/core3d.js');
  const { WarpNurt } = await import('../src/3d/warp/warpNurt.js');
  Core3D.isInitialized = true;
  Core3D.scene = new THREE.Scene();
  Core3D.addFxStep = () => {};
  WarpNurt.init({ count: 4096 });
  assert.equal(WarpNurt.initialized, true);
  const ship = { pos: { x: 5000, y: 0 }, x: 5000, y: 0, vel: { x: 0, y: 0 }, angle: 0, w: 1800, h: 800 };
  const warp = { state: 'active', charge: 0.8, chargeTime: 0.8, gear: 1, dir: { x: 1, y: 0 } };
  const cam = { x: 5000, y: 0, zoom: 0.2 };
  const o = { dt: 1 / 60, cam, camShake: cam, camFollow: true, ship, warp, npcs: [] };
  // 0,6 s lotu: przepływ widoczny ustalony (bieg I — 16 tys. j/s).
  for (let i = 0; i < 36; i++) WarpNurt.update(o);
  const step = () => { const m = WarpNurt.camMX; WarpNurt.update(o); return WarpNurt.camMX - m; };
  const flowStep = WARP_FLOW.travel / 60;
  const bub = WarpNurt.player.bubble;
  assert.ok(near(step(), flowStep, 1e-6), 'kamera przy statku: sam przepływ');
  cam.x += 50;   // kamera cofa się / wysuwa względem statku (kop, wyprzedzenie riga, zoom)
  assert.ok(near(step(), flowStep + 50, 1e-6), 'zmiana offsetu kamery idzie do ośrodka');
  // Smugi drobin biorą prędkość kamery ośrodka, bańka — prędkość widoczną statku (demo: ship.vx).
  assert.ok(near(WarpNurt.flowX, WARP_FLOW.travel + 50 * 60, 1e-6));
  assert.ok(near(bub.vx, WARP_FLOW.travel, 1e-6) && near(bub.vy, 0, 1e-9), `bańka ${bub.vx}`);
  o.camFollow = false;   // RTS / przejście kamery: offset nie jest kamerą statku
  cam.x += 50;
  assert.ok(near(step(), flowStep, 1e-6), 'poza kamerą statku sam przepływ');
  o.camFollow = true;
  assert.ok(near(step(), flowStep, 1e-6), 'powrót bez skoku (offset z poprzedniej klatki)');
  // Pauza: przepływu brak, ale ruch kamery względem statku (zoom w pauzie) dalej w ośrodku.
  o.dt = 0;
  cam.x -= 20;
  assert.ok(near(step(), -20, 1e-6));
  // Skok kamery (inne miejsce świata): ośrodek od nowa, bez przeniesienia offsetu.
  o.dt = 1 / 60;
  cam.x += 100000;
  assert.ok(near(step(), flowStep, 1e-6), 'skok kamery nie przesuwa ośrodka o offset');
  assert.ok(near(bub.vx, WARP_FLOW.travel, 1e-6));
  const html = read('index.html');
  assert.match(html, /o\.camFollow = camera\.mode === 'ship' && !camera\.transition;/);
});

test('ośrodek: krok 240 Hz cofa przegródki (pakowane raz na klatkę) do swojej chwili — warkocz bez kłębów', async () => {
  // Przylot wpada z 12–30 tys. j/s: bańka stojąca całą klatkę w miejscu z jej końca skakała o v·Δt
  // (200–500 j.), a zapłon talii zostawiał warkocz kłębami co klatkę (demo ustawiało bańki co krok).
  const { Core3D } = await import('../src/3d/core3d.js');
  const { WarpNurt, WARP_STEP } = await import('../src/3d/warp/warpNurt.js');
  Core3D.isInitialized = true;
  Core3D.scene = Core3D.scene || new THREE.Scene();
  Core3D.addFxStep = () => {};
  if (!WarpNurt.initialized) WarpNurt.init({ count: 4096 });
  const frame = { bubbles: [], seams: { count: 0, items: [] } };
  WarpNurt.stepAcc = 0.0011;
  WarpNurt.flowX = 1200;
  WarpNurt.flowY = -300;
  const t = 20;
  const dt = 1 / 60;
  WarpNurt._planSteps(t, dt, frame);
  const n = WarpNurt._stepCount;
  assert.ok(n >= 3 && n <= 5, `kroków w klatce: ${n}`);
  for (let i = 0; i < n; i++) {
    const st = WarpNurt._steps[i];
    const ts = st.t + WarpNurt.wakeT;
    assert.ok(near(st.back, t - ts, 1e-9), `krok ${i}: cofnięcie ${st.back}`);
    if (i > 0) assert.ok(near(WarpNurt._steps[i - 1].back - st.back, WARP_STEP, 1e-9));
  }
  assert.ok(near(WarpNurt._steps[n - 1].back, WarpNurt.stepAcc, 1e-9), 'ostatni krok: reszta do klatki');
  const flow = WarpNurt.medium.U.bubbleFlow.value;
  assert.ok(flow.x === 1200 && flow.y === 300, 'przepływ kamery ośrodka w scenie (y w górę)');
  WarpNurt._stepCount = 0;
  // Kernel kroku liczy środek przegródki z cofnięciem (pozycja − (v − przepływ) · czas).
  const m = new WarpMedium({ count: 1024 });
  const w = buildCompute(m.stepNode);
  assert.match(w, /warpMedBubbleBack/);
  assert.match(w, /warpMedBubbleFlow/);
  assert.match(read('src/3d/warp/warpNurt.js'), /medium\.step\(renderer, WARP_STEP, st\.t, st\.sx, st\.sy, st\.back\);/);
});

// ── Rulon: cała gra (hak w każdym materiale, src/3d/warp/rulon.js) ─────────────────────────────

test('rulon całej gry: hak w wierzchołkach każdego materiału, bez passa cienia i bez rulonBend = false; czyste funkcje', async () => {
  const { installRulonGlobal, RULON_STATE } = await import('../src/3d/warp/rulon.js');
  installRulonGlobal();
  // Punkt zaczepienia w three: setup() woła setupHardwareClipping tuż po wyjściu etapu wierzchołków.
  const src = readFileSync(new URL('../node_modules/three/src/materials/nodes/NodeMaterial.js', import.meta.url), 'utf8');
  assert.match(src, /builder\.stack\.outputNode = vertexNode;\s*this\.setupHardwareClipping\( builder \);/);
  const plain = new THREE.NodeMaterial();
  const v = buildMesh(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), plain)).vertex;
  assert.match(v, /fn rulonForward \(/, 'przekształcenie jako czysta funkcja (budowane raz)');
  assert.match(v, /rulonForward\( /);
  assertNoReversedSmoothstep(v);
  const flat = new THREE.NodeMaterial();
  flat.rulonBend = false;
  assert.doesNotMatch(buildMesh(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flat)).vertex, /rulonForward/);
  const shadow = new THREE.NodeMaterial();
  shadow.isShadowPassMaterial = true;
  assert.doesNotMatch(buildMesh(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadow)).vertex, /rulonForward/);
  // Culling: płaszczyzny boczne odsunięte tylko przy zwiniętym rulonie.
  const cam = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 1000);
  cam.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const far = new THREE.Sphere(new THREE.Vector3(400, 0, -10), 1);
  assert.equal(new THREE.Frustum().setFromProjectionMatrix(m).intersectsSphere(far), false);
  RULON_STATE.cullMargin = 500;
  assert.equal(new THREE.Frustum().setFromProjectionMatrix(m).intersectsSphere(far), true);
  RULON_STATE.cullMargin = 0;
  // Gwiazdy i ośrodek nie zginają się drugi raz; mgławica liczy odwrotność sama.
  assert.doesNotMatch(read('src/3d/warp/medium.js'), /rulonForward\(/);
  assert.match(read('src/3d/planet3d.assets.tsl.js'), /material\.rulonBend = false;/);
  const core = read('src/3d/core3d.js');
  assert.match(core, /RULON\.pass\.value = 1;\s*renderer\.render\(this\.scene, camera\);\s*RULON\.pass\.value = 0;/);
});
