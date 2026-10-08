import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WARP_REF_HULL_LENGTH,
  warpSizeScale,
  createWarpArrival,
  sampleWarpArrival,
  planWarpFleetArrival,
  warpFlybySlowdown,
  WARP_FLYBY_DEFAULTS,
  WARP_TRIP,
  warpTripTime,
  planWarpCruise,
  simulateWarpLeg,
  warpFlybyFactor
} from '../src/game/warpDrive.js';

test('przylot: fazy po kolei, większy kadłub zapowiada się dłużej', () => {
  const big = createWarpArrival({ hullLength: WARP_REF_HULL_LENGTH });
  const small = createWarpArrival({ hullLength: 192 });
  for (const a of [big, small]) {
    assert.ok(a.t0 < a.tTear && a.tTear < a.tBurst && a.tBurst < a.tSettled && a.tSettled < a.tEnd);
    assert.ok(a.tClose > a.tBurst && a.tClose < a.tSettled, 'szew zaczyna się zamykać w trakcie wyrzutu');
  }
  assert.ok(big.herald > small.herald * 1.5, 'zwiastun kapitału ma być wyraźnie dłuższy');
  assert.ok(big.seamLength > small.seamLength * 5);
  assert.equal(warpSizeScale(WARP_REF_HULL_LENGTH), 1);
  assert.ok(warpSizeScale(10) >= 0.45 && warpSizeScale(1e6) <= 1.25);
});

test('próbka: przed startem nic, zwiastun rośnie, wyrzut stawia okręt za pozycją końcową', () => {
  const a = createWarpArrival({ hullLength: 1800, startTime: 10, x: 5, y: 7, angle: 1 });
  const s = {};
  sampleWarpArrival(a, 9, s);
  assert.equal(s.phase, 'wait');
  assert.equal(s.herald, 0);
  assert.equal(s.seamOpen, 0);
  assert.equal(s.shipVisible, false);

  sampleWarpArrival(a, 10 + a.herald * 0.3, s);
  assert.equal(s.phase, 'herald');
  const early = s.herald;
  assert.ok(early > 0 && early < 1);
  assert.equal(s.seamLen, 0, 'w pierwszej części zwiastuna nie ma jeszcze szwu');
  sampleWarpArrival(a, a.tTear - 0.01, s);
  assert.ok(s.herald > early);
  assert.ok(s.seamLen > 0 && s.seamLen <= 0.22 + 1e-9, 'pod koniec zwiastuna punkt wydłuża się w kreskę');

  sampleWarpArrival(a, a.tBurst, s);
  assert.equal(s.phase, 'emerge');
  assert.equal(s.shipVisible, true);
  assert.ok(Math.abs(s.flash - 1) < 1e-9);
  assert.ok(Math.abs(s.shipOffset + a.emergeDist) < 1e-9, 'okręt wyłania się emergeDist za pozycją końcową');
  assert.ok(s.shipSpeed > 0);
  assert.ok(s.seamOpen > 0.9, 'szew otwarty w chwili wyrzutu');

  sampleWarpArrival(a, a.tSettled + 0.01, s);
  assert.equal(s.phase, 'cool');
  assert.ok(Math.abs(s.shipOffset) < 1e-9);
  assert.equal(s.shipSpeed, 0);
  sampleWarpArrival(a, a.tClose + a.close + 0.01, s);
  assert.ok(s.seamOpen < 1e-6, 'szew zamknięty po wyrzucie');

  sampleWarpArrival(a, a.tEnd + 0.1, s);
  assert.equal(s.phase, 'done');
});

test('próbka: wartości skończone przy byle jakich danych wejściowych', () => {
  const a = createWarpArrival({ hullLength: 0, hullWidth: NaN, angle: undefined });
  const s = {};
  for (let t = -1; t < a.tEnd + 1; t += 0.037) {
    sampleWarpArrival(a, t, s);
    for (const k of ['herald', 'seamLen', 'seamOpen', 'shipOffset', 'shipSpeed', 'smear', 'flash', 'shake']) {
      assert.ok(Number.isFinite(s[k]), `${k} = ${s[k]} przy t = ${t}`);
    }
    assert.ok(s.seamOpen >= 0 && s.seamOpen < 1.2);
  }
});

test('flota: zwiastuny razem, wyrzuty od najmniejszego, okręt flagowy ostatni z pauzą', () => {
  const ships = [
    { hullLength: 1560 }, { hullLength: 192 }, { hullLength: 624 },
    { hullLength: 288 }, { hullLength: 624 }, { hullLength: 192 }
  ];
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const plan = planWarpFleetArrival(ships, { startTime: 2, gap: 0.18, flagshipPause: 0.45, jitter: 0.25, rng });
  assert.equal(plan.length, ships.length);
  for (const p of plan) {
    assert.ok(p.startTime >= 2 && p.startTime <= 2.25, 'zwiastuny startują prawie razem');
    assert.ok(p.heraldExtra >= 0);
    const a = createWarpArrival({ hullLength: ships[p.index].hullLength, startTime: p.startTime, heraldExtra: p.heraldExtra });
    assert.ok(Math.abs(a.tBurst - p.burstTime) < 1e-9, 'heraldExtra przesuwa wyrzut dokładnie na plan');
  }
  const byBurst = plan.slice().sort((a, b) => a.burstTime - b.burstTime);
  for (let i = 1; i < byBurst.length; i++) {
    assert.ok(byBurst[i].burstTime - byBurst[i - 1].burstTime >= 0.18 - 1e-9, 'odstęp między wyrzutami');
    assert.ok(ships[byBurst[i].index].hullLength >= ships[byBurst[i - 1].index].hullLength, 'od najmniejszego');
  }
  const last = byBurst[byBurst.length - 1];
  assert.equal(ships[last.index].hullLength, 1560, 'okręt flagowy wychodzi ostatni');
  assert.ok(last.burstTime - byBurst[byBurst.length - 2].burstTime >= 0.18 + 0.45 - 1e-9);
  assert.deepEqual(planWarpFleetArrival([]), []);
});

test('zwolnienie przy mijanym ciele: daleko pełna prędkość, przy mijaniu z bliska mocno, mały daleki księżyc wcale', () => {
  // Mars 70 tys. j. od kursu (promień 30 tys.): pełne zwolnienie przy mijaniu.
  assert.ok(Math.abs(warpFlybySlowdown(0, 70000, 30000) - (1 - WARP_FLYBY_DEFAULTS.depth)) < 1e-9);
  assert.ok(warpFlybySlowdown(2e6, 70000, 30000) > 0.999, 'daleko przed nim — bez zwolnienia');
  // Płynnie i symetrycznie: zwalnia z wyprzedzeniem, przyspiesza za rufą.
  let prev = 0;
  for (let a = 0; a <= 800000; a += 10000) {
    const f = warpFlybySlowdown(a, 70000, 30000);
    assert.equal(warpFlybySlowdown(-a, 70000, 30000), f);
    assert.ok(f >= prev - 1e-12 && f <= 1, 'dalej wzdłuż kursu — szybciej');
    prev = f;
  }
  assert.ok(warpFlybySlowdown(150000, 70000, 30000) < 0.6, 'zwalnia już 150 tys. j. przed planetą');
  // Bliżej kursu albo większe ciało — mocniej; mały księżyc daleko — wcale.
  assert.ok(warpFlybySlowdown(0, 40000, 9000) > warpFlybySlowdown(0, 20000, 9000));
  assert.ok(warpFlybySlowdown(0, 60000, 1200) > 0.999);
  // Nad ciałem (kurs przez tarczę) — pełne zwolnienie.
  assert.ok(Math.abs(warpFlybySlowdown(0, 5000, 9000) - (1 - WARP_FLYBY_DEFAULTS.depth)) < 1e-9);
});

// ── podróż skokiem: czas jak w demie „Nurt” (2026-10-07), zwolnienie przy ciałach ─────────────

test('czas podróży: prawo dema (4 + d / 260 tys., 8–17 s), krótkie skoki krócej (√d), rośnie z odległością', () => {
  assert.ok(Math.abs(warpTripTime(1650000) - (4 + 1650000 / 260000)) < 1e-9, 'Ziemia → Jowisz dema ~10,3 s');
  assert.equal(warpTripTime(3400000), WARP_TRIP.max);
  assert.equal(warpTripTime(9e6), WARP_TRIP.max);
  assert.equal(warpTripTime(520000), WARP_TRIP.min);
  assert.equal(warpTripTime(1000000), WARP_TRIP.min, 'dolna granica dema do ~1 mln j.');
  assert.ok(warpTripTime(40000) < 4.5 && warpTripTime(40000) >= WARP_TRIP.shortMin, 'skok 40 tys. j. nie trwa 8 s');
  let prev = 0;
  for (let d = 0; d <= 6e6; d += 20000) {
    const t = warpTripTime(d);
    assert.ok(t >= prev - 1e-9, 'czas nie maleje z odległością: ' + d);
    prev = t;
  }
});

test('plan prędkości: od skoku do wyjścia mija czas podróży; ciało przy kursie — szybszy przelot poza nim', () => {
  const base = { dist: 1650000, v0: 0, hullLength: 1800, bodies: [] };
  const free = planWarpCruise(base);
  assert.ok(Math.abs(free.time - free.target) < 0.05, 'czas planu ' + free.time + ' vs ' + free.target);
  assert.ok(Math.abs(free.target - (warpTripTime(1650000) - WARP_TRIP.decel)) < 1e-9);
  const mars = planWarpCruise({ ...base, bodies: [{ along: 800000, lateral: 70000, r: 30000 }] });
  assert.ok(Math.abs(mars.time - mars.target) < 0.05);
  assert.ok(mars.speed > free.speed * 1.2, 'zwolnienie przy Marsie nadrobione prędkością przelotową (demo ~290 tys. j/s)');
  // Strefa (pas asteroid × 0,8 w połowie drogi) — plan liczy z nią.
  const belt = planWarpCruise({ ...base, zone: (s) => (s > 600000 && s < 1000000 ? 0.8 : 1) });
  assert.ok(Math.abs(belt.time - belt.target) < 0.05 && belt.speed > free.speed);
  // Granice: bardzo daleko — sufit prędkości; czas symulacji maleje z prędkością.
  assert.equal(planWarpCruise({ ...base, dist: 4e7 }).speed, WARP_TRIP.vMax);
  assert.ok(simulateWarpLeg(100000, base) > simulateWarpLeg(200000, base));
});

test('zwolnienie skoku od kilku ciał: iloczyn warpFlybySlowdown w układzie kursu', () => {
  assert.equal(warpFlybyFactor(0, 0, 1, 0, []), 1);
  const bodies = [{ x: 0, y: 70000, r: 30000 }, { x: 900000, y: -40000, r: 9000 }];
  const f = warpFlybyFactor(0, 0, 1, 0, bodies);
  assert.ok(Math.abs(f - warpFlybySlowdown(0, 70000, 30000) * warpFlybySlowdown(900000, -40000, 9000)) < 1e-12);
  // Kurs po skosie: ta sama geometria względem kursu = to samo zwolnienie.
  const c = Math.cos(2.1);
  const s = Math.sin(2.1);
  const rot = bodies.map((b) => ({ x: b.x * c - b.y * s, y: b.x * s + b.y * c, r: b.r }));
  assert.ok(Math.abs(warpFlybyFactor(0, 0, c, s, rot) - f) < 1e-9);
  assert.ok(warpFlybyFactor(0, 0, 1, 0, bodies, 1) < 0.2, 'n — tylko pierwsze ciała (Mars z bliska: 15%)');
});
