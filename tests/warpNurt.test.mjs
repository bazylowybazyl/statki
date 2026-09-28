// Warp „Nurt” w grze (zadanie 22, src/3d/warp/): czyste moduły osi (odlot w warpDrive.js, skok
// gracza, przyloty / odloty NPC), kolano bloomu, zgięcie tła (lustro CPU), przyrost pudła ośrodka,
// pule klatki bez wzrostu, WGSL ośrodka i duszków zbudowany w Node (bez GPU, jak haloRingTSL).
// node --test tests/warpNurt.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  WARP_DEPARTURE_BASE, WARP_ARRIVAL_SHAPE, createWarpDeparture, sampleWarpDeparture, warpSizeScale
} from '../src/game/warpDrive.js';
import { WarpPlayerFx, WARP_FLOW, WARP_BUBBLE } from '../src/3d/warp/player.js';
import { WarpFrame, WARP_FRAME_CAPS, newWarpSlot } from '../src/3d/warp/frame.js';
import {
  planWarpArrivalFx, warpArrivalFxState, planWarpDepartureFx, departFxPose, warpDepartureFxState, HERALD_REACH
} from '../src/3d/warp/arrivals.js';
import { writeWarpSkyBend, clearWarpSkyBend, warpSkyBendCount, warpSkyBendOffsetCpu } from '../src/3d/warp/skyBend.js';
import { WarpMedium, growShare } from '../src/3d/warp/medium.js';
import { RiftSprites, GlowSprites, SmearPool } from '../src/3d/warp/sprites.js';
import { warpPalette, entityWarpPaletteId } from '../src/3d/warp/palette.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── odlot: czysta oś w warpDrive.js (1:1 z planDeparture / departureState dema) ──────────────

test('odlot: oś dema — ładowanie 1,6 + 0,8·s, szczelina 0,45 s przed wejściem, wejście 0,34 + 0,12·s', () => {
  for (const L of [1800, 1560, 420, 120]) {
    const s = warpSizeScale(L);
    const d = createWarpDeparture({ hullLength: L, startTime: 5, x: 100, y: -50, angle: 0.7 });
    assert.ok(near(d.charge, WARP_DEPARTURE_BASE.charge + WARP_DEPARTURE_BASE.chargePerSize * s));
    assert.ok(near(d.tDive, 5 + d.charge));
    assert.ok(near(d.tSplit, d.tDive - 0.45));
    assert.ok(near(d.dive, 0.34 + 0.12 * s));
    assert.ok(near(d.tGone, d.tDive + d.dive));
    assert.ok(near(d.tEnd, d.tGone + 0.45 + 0.2));
    assert.ok(near(d.seamLength, L * WARP_ARRIVAL_SHAPE.seamLength));
    assert.ok(near(d.seamHalfWidth, d.seamLength * WARP_ARRIVAL_SHAPE.seamOpen));
    // Szczelina przed dziobem: jej tylny koniec w dziobie (ujście).
    const ahead = L * 0.5 + d.seamLength * 0.5;
    assert.ok(near(d.cx, 100 + Math.cos(0.7) * ahead, 1e-6) && near(d.cy, -50 + Math.sin(0.7) * ahead, 1e-6));
    assert.ok(near(d.mouth, L * 0.5));
  }
});

test('odlot: próbka — fazy po kolei, droga ∝ w² do 2,6 L, okręt znika za ujściem, szczelina zamyka się', () => {
  const d = createWarpDeparture({ hullLength: 1000, startTime: 1 });
  const s = {};
  assert.equal(sampleWarpDeparture(d, 0.5, s).phase, 'wait');
  assert.equal(s.riftOpen, 0);
  assert.equal(s.build, 0);
  sampleWarpDeparture(d, d.tSplit - 0.01, s);
  assert.equal(s.phase, 'charge');
  assert.equal(s.riftOpen, 0, 'przed otwarciem szczeliny nic');
  assert.ok(s.build > 0.5 && s.build < 1);
  sampleWarpDeparture(d, d.tSplit + 0.01, s);
  assert.ok(s.riftOpen > 0.08 && s.riftLen > 0.25);
  sampleWarpDeparture(d, d.tDive, s);
  assert.equal(s.phase, 'dive');
  assert.ok(near(s.riftOpen, 1) && near(s.riftLen, 1));
  assert.equal(s.dist, 0);
  assert.ok(near(s.flash, 1));
  const mid = d.tDive + d.dive * 0.5;
  sampleWarpDeparture(d, mid, s);
  assert.ok(near(s.dist, 2600 * 0.25, 1e-6));
  assert.ok(near(s.speed, 2 * 2600 * 0.5 / d.dive, 1e-6));
  assert.ok(near(s.revealLine, 500 - s.dist, 1e-6));
  sampleWarpDeparture(d, d.tGone - 1e-6, s);
  assert.equal(s.shipVisible, false, 'na końcu wejścia kadłub cały za ujściem');
  sampleWarpDeparture(d, d.tGone + 0.45, s);
  assert.equal(s.phase, 'close');
  assert.ok(near(s.riftOpen, 0, 1e-9), 'szczelina zamknięta po 0,45 s');
  assert.equal(sampleWarpDeparture(d, d.tEnd + 0.01, s).phase, 'done');
  // Byle jakie dane: wartości skończone.
  const bad = createWarpDeparture({ hullLength: NaN, x: undefined, angle: 'x', startTime: null });
  for (const t of [-1, 0, 1, 2.5, 100]) {
    sampleWarpDeparture(bad, t, s);
    for (const k of ['build', 'riftOpen', 'riftLen', 'dist', 'speed', 'revealLine', 'heat', 'flash', 'shake']) {
      assert.ok(Number.isFinite(s[k]), `${k} skończone`);
    }
  }
});

// ── skok gracza (automat gry → fazy efektu) ─────────────────────────────────────────────────

function playerRig() {
  const fx = new WarpPlayerFx();
  fx.bubble = newWarpSlot();
  const shakes = [];
  fx.onShake = (m, d) => shakes.push([m, d]);
  const frame = new WarpFrame();
  const game = { state: 'idle', charge: 0, chargeTime: 0.8, gear: 1, speed: 0, angle: 0.3, x: 1000, y: 2000, length: 1800, width: 800, palette: 'magenta', vRelX: 0, vRelY: 0 };
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

test('skok gracza: ładowanie ściśnięte do 0,8 s (naprężenie ×3,75, wzbudzenie ×3,75^0,6), bańka rośnie', () => {
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
  // Kształt bańki z dema.
  assert.ok(near(frame.bubbles[0].R, 1800 * WARP_BUBBLE.radiusK) && near(frame.bubbles[0].asp, WARP_BUBBLE.asp));
});

test('skok gracza: kop — przepływ widoczny 900 → bieg I w 0,45 s, fala i błysk w punkcie skoku, wstrząs; wyjście — front, szew, żar, gaszenie ośrodka', () => {
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
  assert.ok(near(fx.visibleFlow(fx.kickT + 0.45), WARP_FLOW.gear1, 1e-6));
  assert.equal(frame.waves.count, 1);
  assert.equal(frame.flashes.count, 1);
  // Punkt skoku zostaje w przestrzeni widocznej: kamera ośrodka odjeżdża, fala zostaje za rufą.
  for (let i = 0; i < 30; i++) { t += dt; step(t, dt); }
  const w = frame.waves.items[0];
  const back = w.x * Math.cos(fx.angle) + w.y * Math.sin(fx.angle);
  assert.ok(back < -1000, 'fala skoku za statkiem (przestrzeń widoczna)');
  assert.ok(frame.stars.stretch > 0.9, 'smugi gwiazd w locie');
  assert.ok(frame.warpVis > 0.99);
  // Wyjście.
  game.state = 'idle';
  t += dt; step(t, dt);
  assert.equal(fx.mode, 'exit');
  assert.equal(frame.stars.frontOn, 1);
  const f0 = fx.visibleFlow(t);
  assert.ok(f0 > 1000);
  assert.equal(fx.hull.seam, 0, 'front startuje przed dziobem (1,3 a)');
  for (let i = 0; i < 3; i++) { t += dt; step(t, dt); }
  assert.ok(fx.hull.on && fx.hull.seam === 1, 'po 0,05 s szew na linii frontu w kadłubie');
  for (let i = 0; i < 6; i++) { t += dt; step(t, dt); }
  assert.ok(fx.hull.heat > 0.9, 'żar brzegu po 0,15 s');
  assert.equal(frame.mediumFade, 6, 'ośrodek gaśnie po wyjściu');
  assert.ok(fx.visibleFlow(fx.exitT + 0.25) < 170, 'statek staje w przestrzeni widocznej w 0,25 s');
  for (let i = 0; i < 120; i++) { t += dt; step(t, dt); }
  assert.equal(fx.mode, 'idle');
  assert.ok(med.camMX !== 0, 'kamera ośrodka jechała w skoku');
});

// ── przyloty i odloty NPC ────────────────────────────────────────────────────────────────────

test('przylot (plan z wyprzedzeniem): zwiastun → szczelina → wyrzut z pchnięciem ośrodka, błysk i linia blasku w ujściu', () => {
  const a = planWarpArrivalFx({ x: 0, y: 0, angle: -0.5, hullLength: 1560, hullWidth: 620, palette: 'magenta', burstTime: 10 });
  assert.ok(near(a.tBurst, 10, 1e-9), 'wyrzut w zadanej chwili');
  assert.ok(near(a.pushSlot.releaseT, 10.02, 1e-9));
  const frame = new WarpFrame();
  const ship = { x: 0, y: 0, angle: -0.5, vx: 0, vy: 0, visible: true };
  frame.reset();
  warpArrivalFxState(a, a.t0 + a.herald * 0.6, frame, 0, 0, null);
  assert.equal(frame.bubbles.length, 1, 'nić zwiastuna');
  assert.equal(frame.bubbles[0].heraldLen, HERALD_REACH);
  assert.ok(frame.flashes.count >= 1, 'punkt zbierania');
  frame.reset();
  warpArrivalFxState(a, a.tTear + a.tear * 0.5, frame, 0, 0, null);
  assert.equal(frame.rifts.count, 1, 'szczelina rozdarcia');
  assert.equal(frame.seams.count, 1);
  assert.equal(frame.seamLens.count, 1, 'wciąganie tła w szczelinę');
  frame.reset();
  warpArrivalFxState(a, 10.05, frame, 0, 0, ship);
  assert.ok(frame.bubbles.includes(a.pushSlot), 'pchnięcie ośrodka przed dziób');
  assert.ok(a.hull.on && a.hull.revealMode === 1, 'kadłub odsłaniany od dziobu');
  assert.ok(a.hull.revealLine < 1560 * 0.56 && a.hull.revealLine > -1560 * 0.56);
  assert.ok(frame.glares.count === 1 && frame.smears.count === 1);
  assert.equal(a.plasmaMode, 'active');
  // Stojący okręt: ujście 0,45 L za dziobem (geometria dema), odsłonięcie w czasie.
  const L = 1560;
  const bowX = Math.cos(-0.5) * L * 0.5;
  assert.ok(near(a.mx, bowX - Math.cos(-0.5) * L * WARP_ARRIVAL_SHAPE.emergeDist, 1e-6));
  frame.reset();
  warpArrivalFxState(a, 10.5, frame, 0, 0, ship);
  assert.equal(a.hull.revealMode, 0, 'po odsłonięciu cały kadłub');
  assert.ok(!frame.bubbles.includes(a.pushSlot), 'pchnięcie jednorazowe (0,5 s)');
});

test('odlot (drive): punkt skoku przed dziobem, okręt prowadzony drogą z osi, kadłub znika za ujściem', () => {
  const d = planWarpDepartureFx({ x: 100, y: 200, angle: 0.4, hullLength: 1200, hullWidth: 500, palette: 'crimson', pirate: true, drive: true, startTime: 3 });
  const frame = new WarpFrame();
  const pose = { x: 0, y: 0, vx: 0, vy: 0 };
  frame.reset();
  departFxPose(d, d.t0 + 0.5, pose);
  assert.ok(near(pose.x, 100) && near(pose.y, 200), 'w ładowaniu okręt stoi');
  warpDepartureFxState(d, d.t0 + 0.5, frame, 0, 0, { x: pose.x, y: pose.y, angle: 0.4 });
  assert.equal(frame.bubbles.length, 1, 'punkt skoku zbiera ośrodek');
  assert.equal(frame.rifts.count, 0);
  assert.equal(d.hull.revealMode, 0);
  const t = d.tDive + d.dive * 0.6;
  departFxPose(d, t, pose);
  frame.reset();
  warpDepartureFxState(d, t, frame, 0, 0, { x: pose.x, y: pose.y, angle: 0.4 });
  const dist = Math.hypot(pose.x - 100, pose.y - 200);
  assert.ok(near(dist, 1200 * 2.6 * 0.36, 1e-6));
  assert.equal(d.hull.revealMode, -1, 'widać tylko część za ujściem');
  assert.ok(near(d.hull.revealLine, 600 - dist, 1e-6));
  assert.equal(frame.rifts.count, 1);
  assert.equal(frame.rifts.items[0].dirty, 1, 'piraci: brudna szczelina');
  assert.equal(frame.smears.count, 1);
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
  const flowStep = WARP_FLOW.gear1 / 60;
  const bub = WarpNurt.player.bubble;
  assert.ok(near(step(), flowStep, 1e-6), 'kamera przy statku: sam przepływ');
  cam.x += 50;   // kamera cofa się / wysuwa względem statku (kop, wyprzedzenie riga, zoom)
  assert.ok(near(step(), flowStep + 50, 1e-6), 'zmiana offsetu kamery idzie do ośrodka');
  // Smugi drobin biorą prędkość kamery ośrodka, bańka — prędkość widoczną statku (demo: ship.vx).
  assert.ok(near(WarpNurt.flowX, WARP_FLOW.gear1 + 50 * 60, 1e-6));
  assert.ok(near(bub.vx, WARP_FLOW.gear1, 1e-6) && near(bub.vy, 0, 1e-9), `bańka ${bub.vx}`);
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
  assert.ok(near(bub.vx, WARP_FLOW.gear1, 1e-6));
  const html = read('index.html');
  assert.match(html, /o\.camFollow = camera\.mode === 'ship' && !camera\.transition;/);
});
