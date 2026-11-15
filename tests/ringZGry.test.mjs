// Demo dzielnic ringu z prawdziwym ringiem Ziemi (dema/ring-dzielnice/kit/ringGryUklad.js): promień R0 dema = krawędź
// ścian ringu gry, obrót stawia kompleks portu 0 (hala K-7 gracza) w osi wjazdu dema, przeliczenia kątów odwracalne.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RING_ROT, complexesInArc, earthRingLayout, ringCenter, ringFit, ringPortElements, sToTheta, thetaToS } from '../dema/ring-dzielnice/kit/ringGryUklad.js';
import { YARD_R0, yardPoint } from '../dema/ring-dzielnice/kit/uklad.js';
import { HALO_STATION_ANGLE } from '../src/3d/haloRing/haloRingConfig.js';

test('R0 dema = krawędź ścian ringu Ziemi (rząd przy ringu bez szpary)', () => {
  const fit = ringFit(earthRingLayout());
  assert.equal(fit.rim, YARD_R0);
  assert.equal(fit.gap, 0);
  assert.equal(fit.vFloor, -fit.wallHeight);        // pas zastępczy v −1 500…0 = habitat (podłoga … krawędź)
  assert.ok(fit.vBack < fit.vFloor);
});

test('obrót ringu: kompleks 0 w s = 0, kompleksy co 90° i tranzyty w połowie między nimi', () => {
  assert.ok(Math.abs(thetaToS(HALO_STATION_ANGLE)) < 1e-6);
  const el = ringPortElements();
  const halls = el.filter((e) => e.kind === 'hala K-7').sort((a, b) => a.complex - b.complex);
  assert.equal(halls.length, 4);
  assert.ok(Math.abs(halls[0].s) < 1e-6);
  const q = (Math.PI / 2) * YARD_R0;
  assert.ok(Math.abs(Math.abs(halls[1].s) - q) < 1e-6 && Math.abs(Math.abs(halls[3].s) - q) < 1e-6);
  const transits = el.filter((e) => e.kind === 'tranzyt').map((e) => Math.abs(e.s)).sort((a, b) => a - b);
  assert.ok(Math.abs(transits[0] - q / 2) < 1e-6);
  // łuk całości dema (droga −77,8 … +68,5 tys.) obejmuje kompleksy 0 i ±90°
  assert.deepEqual([...complexesInArc(el, -77800, 68500)].sort(), [0, 1, 3]);
});

test('s ↔ θ odwracalne, kierunek: +s w prawo na ekranie (+x)', () => {
  for (const s of [-70000, -1234, 0, 999, 61500]) assert.ok(Math.abs(thetaToS(sToTheta(s)) - s) < 1e-6);
  // punkt ringu pod kątem θ w układzie three po obrocie grupy → świat gry dema → s z yardPoint
  const P0 = { x: 7_080_000, y: 6_290_000 };
  const c = ringCenter(P0);
  const s = 20000;
  const th = sToTheta(s) + RING_ROT;
  const gx = c.x + YARD_R0 * Math.cos(th);
  const gy = c.y - YARD_R0 * Math.sin(th);      // three y = −y gry
  const [x, z] = yardPoint(s, 0);
  assert.ok(Math.abs(gx - (P0.x + x)) < 1e-6 && Math.abs(gy - (P0.y + z)) < 1e-6);
});

test('pylony: rozstaw na łuku, bez pylonu w przelocie tranzytu i w kopule sięgającej płaszczyzny gry', async () => {
  const { pylonPlan, PYLON, buildRingPylonScene } = await import('../dema/ring-dzielnice/kit/pylonyRingu.js');
  const list = pylonPlan({ sMin: -10000, sMax: 10000, step: 3000, skip: [[-1500, 1500]], obstacles: [{ s: 6000, halfS: 500, z: 100, halfZ: 400 }, { s: -6000, halfS: 500, z: -2000, halfZ: 400 }] });
  assert.ok(list.length >= 4);
  for (const s of list) {
    assert.ok(s >= -10000 && s <= 10000);
    assert.ok(Math.abs(s) >= 1500 + (PYLON.width * PYLON.flare) / 2);
    assert.ok(Math.abs(s - 6000) >= 500 + (PYLON.width * PYLON.flare) / 2);
  }
  for (let i = 1; i < list.length; i++) assert.ok(list[i] - list[i - 1] >= 3000 - 1e-6);
  assert.ok(list.some((s) => Math.abs(s + 6000) < 1600));    // kopuła daleko od płaszczyzny gry nie przeszkadza
  assert.ok(buildRingPylonScene(list).instances > 0);
});

test('przejście do tranzytu: rząd przy ringu i pas habitatu wycięte, korytarz wolny dla Atlasa od drogi do strony Ziemi', async () => {
  const { carveSolids, passagePlan, cutPolygonArc, PASSAGE } = await import('../dema/ring-dzielnice/kit/przejscieTranzytu.js');
  const { sector, RING_V, pointInConvex } = await import('../dema/ring-dzielnice/kit/uklad.js');
  const sT = -34363;
  // rząd przy ringu i pas ringu kawałkami po 900 j. jak w złożeniu, plus rząd zewnętrzny (nietknięty)
  const solids = [];
  for (let s = sT - 6000; s < sT + 6000; s += 900) {
    solids.push({ id: 'rząd', zone: 'INNER', points: sector(s, s + 900, RING_V.inner0, RING_V.inner1) });
    solids.push({ id: 'ŚCIANA RINGU', zone: 'RING', points: sector(s, s + 900, -1500, 0) });
    solids.push({ id: 'zewn', zone: 'OUTER', points: sector(s, s + 900, RING_V.outer0, RING_V.outer1) });
  }
  const pl = { ...passagePlan(sT), name: 'T-04' };
  const out = carveSolids(solids, [pl], RING_V);
  assert.equal(out.filter((q) => q.id === 'zewn').length, solids.filter((q) => q.id === 'zewn').length);
  // oś korytarza i burty Atlasa (±420) od drogi do v −2 100: żaden punkt w bryle
  for (let v = RING_V.road; v > -2100; v -= 50) {
    for (const x of [-420, 0, 420]) {
      const p = pl.pt(x, v);
      for (const q of out) assert.ok(!pointInConvex(q.points, p[0], p[1]), `${q.id} zasłania korytarz w v ${v}, x ${x}`);
    }
  }
  // poza wycięciem rząd zostaje
  const far = pl.pt(-PASSAGE.carve - 400, 500);
  assert.ok(out.some((q) => pointInConvex(q.points, far[0], far[1])));
  // przycięcie wielokąta: części tylko po obu stronach
  const pieces = cutPolygonArc(sector(sT - 900, sT + 900, 0, 1000), sT - 200, sT + 200);
  assert.equal(pieces.length, 2);
});
