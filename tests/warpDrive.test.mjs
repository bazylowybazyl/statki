import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WARP_REF_HULL_LENGTH,
  warpSizeScale,
  createWarpArrival,
  sampleWarpArrival,
  planWarpFleetArrival
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
