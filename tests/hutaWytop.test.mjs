// HUTA — wytop (element 2 huty), CYKL v2: kupa rudy w nieważkości → docisk i topienie w małą kulę → dokarmianie → żużel
// w czapę na biegunie, ssawa, czysta kula → zrzut grawitacyjny do leja. Testy symulacji (czyste moduły, bez three) i budowy obrazu w Node (WGSL bez GPU).
// Demo: dema/huta-wytop.html; specyfikacja i raporty: .tmp/huta/wytop/ (poza repo).
// Testy nie mierzą czasu ściany (próg czasu kroku — osobny test z opcją WYDAJNOSC).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAIN } from '../dema/ring-dzielnice/huta/ruda/rudy.js';
import { CHEVRON, KOMORA, VORTEX, chevronAt, createMeltTrack, funnelContactY, funnelFloorAt, funnelLevelOf, funnelRadiusAt, funnelSlope, funnelVolumeTo, slagAngle } from '../dema/ring-dzielnice/huta/wytop/geometria.js';
import { BALL, HMAX, MODES, MODE_L, harmonics, harmonicsGrad, modeEnergy, modeGamma, modeOmega, radiusOfTons, stepModes, surfaceOffset } from '../dema/ring-dzielnice/huta/wytop/kula.js';
import { DSP, DSP_NAMES, FLOE_STRIDE, GRAIN_STRIDE, GRAIN_UNITS, GRANULE_STRIDE, LICZNIK, PHASE, PHASE_NAMES, POOL, PROCES, SLAG_EQ_PER_TON, STAN, STAN_N, UNITS_PER_TON, createMeltChamber } from '../dema/ring-dzielnice/huta/wytop/komora.js';
import { MASA, MASA_CELLS, MASA_STRIDE, MASS_EDGE, MP, createFunnelField } from '../dema/ring-dzielnice/huta/wytop/masa.js';
import { METALE, metalOf } from '../dema/ring-dzielnice/huta/wytop/metale.js';
import { WYDAJNOSC } from './helpers/wydajnosc.mjs';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

const DT = 1 / 60;
const HEAP_GRAINS = PROCES.heapTons * GRAIN.perTon;
const CHARGE_GRAINS = PROCES.chargeTons * GRAIN.perTon;
/** Receptura 3 rudy → 2 metalu: metal gotowej kuli i żużel jednego obiegu [t]. */
const METAL_TONS = PROCES.chargeTons * 2 / 3;
const SLAG_TONS = PROCES.chargeTons / 3;
/** Największa kula obiegu: cały wsad stopiony, żużel jeszcze na kuli. */
const R_MAX = radiusOfTons(PROCES.chargeTons);
const R_CLEAN = radiusOfTons(METAL_TONS);
/** Kolejność faz obiegu: po każdej następuje dokładnie ta następna. */
const NEXT = { [PHASE.EMPTY]: PHASE.GATHER, [PHASE.GATHER]: PHASE.PRESS, [PHASE.PRESS]: PHASE.MELT, [PHASE.MELT]: PHASE.FEED, [PHASE.FEED]: PHASE.REFINE, [PHASE.REFINE]: PHASE.CLEAR, [PHASE.CLEAR]: PHASE.DROP, [PHASE.DROP]: PHASE.EMPTY };
/** Krokuje komorę do fazy `p` (najwyżej `max` s). */
function runTo(c, p, max = 170) {
  for (let k = 0; k < max * 60 && c.phase !== p; k++) c.step(DT);
  assert.equal(c.phase, p, `komora doszła do fazy ${PHASE_NAMES[p]}`);
}

test('wytop: harmoniki powierzchni — unormowane i ortogonalne na sferze, gradient zgodny z różnicą skończoną', () => {
  // kwadratura: siatka Fibonacciego
  const N = 20000;
  const G = new Float64Array(MODES * MODES);
  const h = new Float64Array(MODES);
  let hmax = 0;
  for (let k = 0; k < N; k++) {
    const y = 1 - (2 * k + 1) / N;
    const r = Math.sqrt(1 - y * y);
    const a = k * 2.399963229728653;
    harmonics(Math.cos(a) * r, y, Math.sin(a) * r, h);
    for (let i = 0; i < MODES; i++) {
      if (Math.abs(h[i]) > hmax) hmax = Math.abs(h[i]);
      for (let j = 0; j < MODES; j++) G[i * MODES + j] += h[i] * h[j] / N;
    }
  }
  for (let i = 0; i < MODES; i++) for (let j = 0; j < MODES; j++) {
    assert.ok(Math.abs(G[i * MODES + j] - (i === j ? 1 : 0)) < 0.01, `⟨H${i} H${j}⟩ = ${G[i * MODES + j].toFixed(4)}`);
  }
  assert.ok(hmax <= HMAX, `największa |H| = ${hmax.toFixed(3)} mieści się w HMAX`);
  // gradient wielomianów
  const g = new Float64Array(MODES * 3);
  const a0 = new Float64Array(MODES);
  const a1 = new Float64Array(MODES);
  const P = [[0.31, 0.74, -0.59], [-0.8, 0.1, 0.59], [0.2, -0.95, 0.24]];
  for (const [x, y, z] of P) {
    harmonicsGrad(x, y, z, g);
    const e = 1e-5;
    for (let ax = 0; ax < 3; ax++) {
      const d = [0, 0, 0];
      d[ax] = e;
      harmonics(x + d[0], y + d[1], z + d[2], a1);
      harmonics(x - d[0], y - d[1], z - d[2], a0);
      for (let i = 0; i < MODES; i++) assert.ok(Math.abs((a1[i] - a0[i]) / (2 * e) - g[i * 3 + ax]) < 1e-5, `mod ${i}, oś ${ax}`);
    }
  }
  assert.deepEqual(MODE_L.filter((l) => l === 2).length, 5);
  assert.deepEqual(MODE_L.filter((l) => l === 3).length, 7);
});

test('wytop: mody drgań są tłumione — bez pobudzeń energia spada do zera; okres i tłumienie z promienia', () => {
  const a = new Float64Array(MODES);
  const v = new Float64Array(MODES);
  const eq = new Float64Array(MODES);
  for (let i = 0; i < MODES; i++) { a[i] = 0.002 * (i % 2 ? 1 : -1); v[i] = 0.004; }
  const R = 177;
  const e0 = modeEnergy(a, v, eq, R);
  let prev = e0;
  let grew = 0;
  for (let k = 0; k < 60 * 30; k++) {
    stepModes(a, v, eq, R, DT);
    const e = modeEnergy(a, v, eq, R);
    if (e > prev * 1.0000001) grew++;
    prev = e;
  }
  assert.ok(prev < e0 * 1e-9, `energia po 30 s: ${prev.toExponential(2)} z ${e0.toExponential(2)}`);
  assert.equal(grew, 0, 'energia nie rośnie w żadnym kroku');
  // pełna kula: okres l = 2 ok. 1,8 s, l = 3 ok. 0,93 s; mała kula drga szybciej
  assert.ok(Math.abs(2 * Math.PI / modeOmega(2, 177) - 1.8) < 0.05);
  assert.ok(Math.abs(2 * Math.PI / modeOmega(3, 177) - 0.93) < 0.05);
  assert.ok(modeOmega(2, 87) / modeOmega(2, 177) > 2.8);
  assert.ok(Math.abs(modeGamma(2, 177) - 0.45) < 1e-9 && modeGamma(3, 177) > modeGamma(2, 177));
  // krok dokładny: jeden długi krok = wiele krótkich
  const a1 = Float64Array.from({ length: MODES }, (_, i) => 0.001 + i * 1e-4);
  const v1 = Float64Array.from({ length: MODES }, () => 0.003);
  const a2 = Float64Array.from(a1);
  const v2 = Float64Array.from(v1);
  stepModes(a1, v1, eq, R, 0.5);
  for (let k = 0; k < 50; k++) stepModes(a2, v2, eq, R, 0.01);
  for (let i = 0; i < MODES; i++) assert.ok(Math.abs(a1[i] - a2[i]) < 1e-9 && Math.abs(v1[i] - v2[i]) < 1e-9);
  // ogranicznik: odchylenie powierzchni nie przekracza limitu
  const big = Float64Array.from({ length: MODES }, () => 0.2);
  const vb = new Float64Array(MODES);
  stepModes(big, vb, big, R, DT);
  let worst = 0;
  for (let k = 0; k < 4000; k++) {
    const y = 1 - (2 * k + 1) / 4000;
    const r = Math.sqrt(1 - y * y);
    const an = k * 2.399963229728653;
    worst = Math.max(worst, Math.abs(surfaceOffset(big, Math.cos(an) * r, y, Math.sin(an) * r)));
  }
  assert.ok(worst <= BALL.limit + 1e-9, `największe odchylenie ${worst.toFixed(3)} ≤ ${BALL.limit}`);
  // w komorze: po uderzeniu kuli w lej drgania gasną (kałuża), w pustej komorze modów nie ma
  const c = createMeltChamber({ seed: 3 });
  runTo(c, PHASE.DROP);
  const S = c.view.stan;
  while (S[STAN.impactT] < 0.8) c.step(DT);
  assert.ok(S[STAN.energy] < 1e-6, `energia drgań 0,8 s po uderzeniu: ${S[STAN.energy].toExponential(2)}`);
  runTo(c, PHASE.EMPTY);
  for (let i = 0; i < MODES; i++) assert.equal(c.modes.a[i], 0);
});

test('wytop: geometria — LEJ NA CAŁE DNO (bez płaskiej posadzki, objętość ≥ kula), zetknięcie kuli, nic się nie przenika przy największej kuli', () => {
  const F = KOMORA.funnel;
  const K = KOMORA;
  assert.ok(Math.abs(funnelRadiusAt(F.rimY) - F.rimR) < 1e-9 && Math.abs(funnelRadiusAt(F.throatY) - F.throatR) < 1e-9);
  // poziom z objętości jest odwrotnością objętości do poziomu; rośnie z objętością
  let prev = F.throatY;
  for (let y = F.throatY + 5; y <= F.rimY + 40; y += 12.5) {
    const lv = funnelLevelOf(funnelVolumeTo(y));
    assert.ok(Math.abs(lv - y) < 1e-6, `poziom ${lv.toFixed(3)} dla y = ${y}`);
    assert.ok(lv > prev);
    prev = lv;
  }
  assert.equal(funnelLevelOf(0), F.throatY);
  // LEJ = CAŁE DNO: stożek zaczyna się na ścianie studni, na dole ściany; dno opada na KAŻDYM promieniu między
  // gardzielą a ścianą (żadnej płaskiej posadzki), nachylenie co najmniej 30° do poziomu
  assert.ok(F.rimR >= K.pitR && F.rimY === K.floorY, 'obrzeże leja = dół ściany studni');
  assert.equal(funnelFloorAt(F.throatR), F.throatY);
  assert.ok(Math.abs(funnelFloorAt(F.rimR) - F.rimY) < 1e-9);
  const tan30 = Math.tan(30 * Math.PI / 180);
  for (let r = F.throatR; r < K.pitR; r += 5) {
    const rise = (funnelFloorAt(r + 5) - funnelFloorAt(r)) / 5;
    assert.ok(rise >= tan30, `dno na promieniu ${r} wznosi się ${rise.toFixed(3)} na jednostkę (≥ tg 30°)`);
    assert.ok(funnelFloorAt(r) < K.floorY, 'całe dno leży poniżej dołu ściany');
  }
  assert.ok(Math.abs(1 / funnelSlope() - (F.rimY - F.throatY) / (F.rimR - F.throatR)) < 1e-12);
  // lej mieści całą kulę gotowego metalu poniżej obrzeża — z zapasem (objętość ≥ 1,5 × kula)
  const ballVol = 4 / 3 * Math.PI * R_CLEAN ** 3;
  assert.ok(funnelVolumeTo(F.rimY) > 1.5 * ballVol, `objętość leja ${(funnelVolumeTo(F.rimY) / ballVol).toFixed(2)} × kula ${METAL_TONS} t`);
  assert.ok(funnelLevelOf(ballVol) < F.rimY - 50, `poziom po wlaniu całej kuli ${funnelLevelOf(ballVol).toFixed(0)} (obrzeże ${F.rimY})`);
  // zetknięcie: kula w osi dotyka stożka, gdy jej środek jest na tej wysokości (odległość środka od tworzącej = R)
  const R = R_CLEAN;
  const yc = funnelContactY(R);
  const m = (F.rimR - F.throatR) / (F.rimY - F.throatY);
  assert.ok(Math.abs((F.throatR + m * (yc - F.throatY)) / Math.sqrt(1 + m * m) - R) < 1e-6);
  assert.ok(yc < F.rimY && yc > F.throatY, `środek kuli przy zetknięciu y = ${yc.toFixed(0)}`);
  // KULA RUNDY 4: gotowa (z żużlem) ok. 250–270 j. — średnica ≈ połowa średnicy studni; mała kula po stopieniu kupy
  // proporcjonalnie większa; wisząca kula nie dotyka stożka (spada z wyraźnej wysokości)
  assert.ok(R_MAX > 250 && R_MAX < 275 && R_CLEAN > 225, `kula: największa ${R_MAX.toFixed(1)} j., czysta ${R_CLEAN.toFixed(1)} j.`);
  assert.ok(Math.abs(2 * R_MAX / (2 * K.pitR) - 0.5) < 0.04, 'średnica kuli ≈ połowa średnicy studni');
  assert.ok(funnelContactY(R_MAX) < -300 && yc < -350, `spadek kuli do zetknięcia: ${(-yc).toFixed(0)} j.`);
  // segmenty cewek: przy najmniejszym promieniu pierścienia końce sąsiednich łuków jednego pierścienia się nie stykają
  const M = K.mach;
  const DEG = Math.PI / 180;
  const end = (deg, side, r) => {
    const a = deg * DEG;
    const f = a + side * M.arcHalf * DEG;
    return [Math.cos(a) * (r - M.arcR) + Math.cos(f) * M.arcR, Math.sin(a) * (r - M.arcR) + Math.sin(f) * M.arcR];
  };
  for (const list of [M.upper, M.lower]) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      for (const [sa, sb] of [[1, -1], [-1, 1], [1, 1], [-1, -1]]) {
        const p = end(list[i], sa, M.rMin);
        const q = end(list[j], sb, M.rMin);
        assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) > 2 * K.coilTube, `końce łuków ${list[i]}° i ${list[j]}° przy rMin`);
      }
    }
  }
  // okno robocze ssawy (azymut 0°) i odbieralnika wolne w górnym pierścieniu; segment nie sięga pasa strugi
  for (const deg of M.upper) assert.ok(deg > 70 && deg < 320, `górny segment ${deg}° poza oknem ssawy i odbieralnika`);
  assert.ok(M.padY - 2 * K.coilTube > 130 && M.rOut + 60 < K.pitR, 'segmenty odsunięte stoją pod ścianą, poza pasem strugi');
  // NIC SIĘ NIE PRZENIKA przy największej kuli (R_MAX) i przy spadku czystej (R_CLEAN):
  //   cewki ↔ bryła (uwaga użytkownika: „chwytaczki łapią ją u góry, za bardzo dociskają”): klatka współśrodkowa
  //   z bryłą — oś segmentu na promieniu ze środka bryły pod stałym kątem `lat` nad / pod równikiem, w odległości
  //   promień + `gap` + `reach`; najbliższy bryle element segmentu stoi `gap` od powierzchni przy KAŻDYM promieniu
  const lat = M.lat * DEG;
  assert.ok(M.lat > 30 && M.lat < 42 && M.gap >= 30 && M.reach > 15, `segmenty na szerokości ${M.lat}° (nie nad biegunem), odstęp ${M.gap} j.`);
  const nearest = (R) => {
    // odległość środek bryły → najbliższy punkt przekroju segmentu (środek łuku), górny pierścień; dolny jest lustrzany
    const d = R + M.gap + M.reach;
    let y = d * Math.sin(lat);
    let r = d * Math.cos(lat);
    if (y > M.padY) { y = M.padY; r = Math.sqrt(d * d - y * y); }
    let best = Infinity;
    for (const [dr, dy] of M.profile) best = Math.min(best, Math.hypot(r - dr, y - dy));
    return { gap: best - R, r, y };
  };
  for (let R = radiusOfTons(PROCES.heapTons * 2 / 3) - 10; R <= R_MAX + 0.5; R += 4) {
    const q = nearest(R);
    assert.ok(Math.abs(q.gap - M.gap) < 2.5, `odstęp segmentu od bryły o promieniu ${R.toFixed(0)}: ${q.gap.toFixed(1)} j. (stały ${M.gap})`);
    assert.ok(Math.abs(Math.atan2(q.y, q.r) / DEG - M.lat) < 0.6 && q.y <= M.padY && q.r >= M.rMin && q.r < M.rOut - 60, `segment na stałej szerokości kątowej przy R = ${R.toFixed(0)}`);
  }
  const big = nearest(R_MAX);
  assert.ok(big.y > M.padY - 6, `przy największej kuli segment stoi na wysokości wysięgnika (${big.y.toFixed(0)} z ${M.padY})`);
  assert.ok(M.padY - nearest(radiusOfTons(PROCES.heapTons * 2 / 3)).y > 30, 'przy małej kuli segment zjeżdża prowadnicą ku równikowi');
  assert.ok(M.arcR > R_MAX && M.arcR < R_MAX + 60, 'krzywizna segmentu = największa kula z odstępem');
  //   spadająca kula przechodzi przez odsunięty dolny pierścień (z falowaniem bryły)
  assert.ok(M.rOut - K.coilTube > R_CLEAN * 1.15 + 60, 'odsunięte segmenty nie stoją na drodze spadającej kuli');
  //   dolne segmenty i ich wsporniki wiszą nad stożkiem leja
  assert.ok(funnelFloorAt(M.rOut) < -M.padY - 100, 'dolne segmenty nad stożkiem');
  //   ssawa ↔ kula: kolano i dzwon nad największą kulą z czapą i stożkiem; wysięgnik pod pokładem
  const SS = K.ssawa;
  const capTop = R_MAX * (1 + K.slag.lift) + SS.coneH;
  assert.ok(SS.boomY - SS.kneeDrop - 2 > capTop + 10, `wylot dzwonu (${SS.boomY - SS.kneeDrop - 2}) nad wierzchołkiem stożka czapy (${capTop.toFixed(0)})`);
  assert.ok(SS.boomY + 30 < K.deckY, 'wysięgnik ssawy pod pokładem');
  assert.ok(Math.hypot(SS.workX, SS.boomY - SS.kneeDrop) - 12 > R_MAX * 1.08 + 20, 'kolano ssawy poza kulą');
  assert.ok(Math.hypot(SS.threadDx, SS.boomY - SS.kneeDrop - 2) - SS.mouthR - 8 > R_MAX * (1 + K.slag.lift), 'dzwon nie wchodzi w czapę');
  //   odbieralnik ↔ kula, cewki i ssawa: koryto przy ścianie, poza największą kulą, poza łukiem górnych segmentów, pod wysięgnikiem
  const T = K.tray;
  assert.ok(T.rIn - 12 > Math.sqrt(Math.max(0, R_MAX ** 2 - T.floorY ** 2)) + 80 && T.rOut < K.pitR, 'koryto poza kulą');
  assert.ok(T.az1 / DEG + 6 < M.upper[0] - M.arcHalf && T.az0 / DEG > 8, 'koryto poza łukiem górnych segmentów i gniazdem ssawy');
  assert.ok(T.pipeY < SS.boomY - SS.kneeDrop && T.floorY - 70 > K.display.y + K.display.half + 12, 'koryto między wyświetlaczem a rurociągiem ssawy');
  //   taśma ↔ kula i kupa: koniec taśmy ponad 100 j. od największej kuli; pierścień bramy w studni, nad dnem zatoki
  const B = K.belt;
  const endPt = B.pts[B.pts.length - 1];
  assert.ok(Math.hypot(endPt[0], endPt[1], endPt[2]) - R_MAX > 100, `koniec taśmy ${(Math.hypot(endPt[0], endPt[1], endPt[2]) - R_MAX).toFixed(0)} j. od największej kuli`);
  assert.ok(Math.hypot(B.boundaryX, endPt[2] + B.ringR + 9) < K.pitR - 1 && B.ringY - B.ringR - 9 > K.bay.floorY, 'pierścień bramy 0 g mieści się w studni');
  assert.ok(B.boundaryX < endPt[0] - 40, 'brama 0 g przed końcem taśmy');
  // WYŚWIETLACZ GRAWITACJI: pas na środku wysokości ściany, lico pochylone ku górze, poza polem ziaren, przerwa na zatokę
  const D = K.display;
  assert.ok(Math.abs(D.y - (K.floorY + K.deckY) / 2) < 1, 'pas wyświetlacza na środku wysokości ściany');
  assert.ok(D.rOut <= K.pitR && D.rIn > K.fieldWall + 15 && D.rOut - D.rIn > 40, 'lico pochylone: dół pasa wysunięty ku osi, poza polem ziaren');
  const tilt = Math.atan2(D.rOut - 5 - D.rIn, 2 * D.half) / DEG;
  assert.ok(tilt > 28 && tilt < 50, `pochylenie lica ${tilt.toFixed(1)}° od pionu`);
  for (const k of K.bay.sides) assert.ok(k * 360 / K.sides >= D.gap0 && (k + 1) * 360 / K.sides <= D.gap1, 'przerwa pasa obejmuje zatokę taśmy');
  assert.ok(D.y + D.half + 12 < M.padY - 36 * M.thick - 62 * M.thick + 100 && D.y - D.half - 42 > -M.padY + 36 * M.thick, 'pas między stopami wysięgników cewek');
  for (const st of K.strips) assert.ok(st.y - st.half - 8 > D.y + D.half + 12 && st.y + st.half + 8 < K.deckY, 'lampy robocze nad pasem wyświetlacza');
  // dawne linie okien: dwie nieruchome listwy na ścianie (poza pasem); stare znaki w dnie nie istnieją
  assert.ok(K.grav.lines.length === 2 && K.grav.lines.every((y) => y < K.deckY && y > K.floorY && Math.abs(y - D.y) > D.half + 60));
  assert.equal(K.grav.floorR, undefined, 'pierścień okien w dnie usunięty');
  assert.equal(K.grav.arrows, undefined, 'strzałki w dnie usunięte');
  assert.equal(K.port, undefined, 'port spustowy usunięty');
  // pokład: środek pola `deckY` pod płaszczyzną gry (największa kula z czapą pod pokładem)
  assert.ok(K.deckY > capTop + 40 && K.k7(K.deckY) === 116);
});

test('wytop: cykl v2 — kolejność faz; kupa rośnie przed grzaniem; kula powstaje dopiero po docisku; zrzut tylko przy grawitacji', () => {
  const c = createMeltChamber({ seed: 7 });
  const S = c.view.stan;
  const C = c.counters;
  assert.equal(c.phase, PHASE.EMPTY);
  assert.equal(c.radius, 0, 'na początku nie ma kuli');
  const M = KOMORA.mach;
  const seen = [];
  const cycles = [];
  const at = {};                      // chwile zdarzeń bieżącego obiegu
  let prev = c.phase;
  let prevHeap = 0;
  let prevR = 0;
  let prevDelivered = 0;
  let prevSpin = 0;
  let prevGrav = 0;
  let prevDsp = DSP.RUN;
  let gravOn = -1;
  let gravOff = -1;
  const dspSeq = [];
  let heapAtPress = 0;
  let rAfterMelt = 0;
  let rFull = 0;
  let impacts = 0;
  let steps = 0;
  while (C[LICZNIK.cycles] < 3 && steps++ < 480 * 60) {
    c.step(DT);
    const p = S[STAN.phase];
    const t = S[STAN.time];
    const R = S[STAN.radius];
    const heap = C[LICZNIK.heap];
    const grav = S[STAN.grav];
    if (p !== prev) {
      assert.equal(p, NEXT[prev], `po fazie ${PHASE_NAMES[prev]} następuje ${PHASE_NAMES[NEXT[prev]]}, nie ${PHASE_NAMES[p]}`);
      seen.push(p);
      at[p] = t;
      if (p === PHASE.PRESS) heapAtPress = heap;
      if (p === PHASE.FEED) rAfterMelt = R;
      if (p === PHASE.CLEAR) rFull = Math.max(rFull, R);
      if (p === PHASE.EMPTY) cycles.push(S[STAN.cycleTime]);
    }
    // --- pusta, zbieranie, docisk: kuli nie ma, cewki zimne (docisk: rozruch dopiero pod koniec) ---
    if (p === PHASE.EMPTY || p === PHASE.GATHER || p === PHASE.PRESS) {
      assert.equal(R, 0, `faza ${PHASE_NAMES[p]}: kuli jeszcze nie ma`);
      assert.equal(C[LICZNIK.metal] + C[LICZNIK.slagFloes], 0);
    }
    // odsuw maszynerii i zrzut — dopiero przy CZYSTEJ kuli: żadnej wyspy żużla (także gasnącej), ssawa w postoju
    if (p === PHASE.CLEAR || p === PHASE.DROP) {
      assert.equal(C[LICZNIK.slagFloes], 0, `faza ${PHASE_NAMES[p]}: na kuli nie ma żużla`);
      assert.equal(c.view.nKry, 0, `faza ${PHASE_NAMES[p]}: żadnej wyspy żużla`);
      assert.equal(S[STAN.suck], 0, `faza ${PHASE_NAMES[p]}: ssawa odjechała`);
    }
    if (p === PHASE.EMPTY) { assert.equal(heap, 0, 'pusta komora'); assert.equal(S[STAN.mach], M.rOut, 'maszyneria odsunięta'); }
    if (p === PHASE.GATHER) {
      // kupa tylko rośnie, maszyneria stoi odsunięta i nie grzeje
      assert.ok(heap >= prevHeap, 'kupa rośnie');
      assert.equal(S[STAN.mach], M.rOut, 'zbieranie: maszyneria odsunięta');
      assert.ok(S[STAN.coilGlow] < 0.02 && S[STAN.heapHeat] === 0, 'zbieranie: kupa zimna');
    }
    if (p === PHASE.PRESS) {
      assert.ok(S[STAN.mach] <= M.rOut && S[STAN.mach] >= M.rMin);
      assert.ok(S[STAN.heapScale] <= 1 && S[STAN.heapScale] >= PROCES.pressScale - 1e-9, 'docisk ściska kupę');
    }
    // --- topienie: jądro rośnie, kupa maleje; maszyneria dociśnięta ---
    if (p === PHASE.MELT) {
      assert.ok(heap <= prevHeap || prev !== PHASE.MELT, 'topienie: kupa tylko maleje');
      assert.ok(R >= prevR - 1e-9, 'topienie: jądro tylko rośnie');
      if (R > 0) assert.ok(S[STAN.mach] < M.rOut - 120, `kula powstaje przy dociśniętej maszynerii (promień pierścienia ${S[STAN.mach].toFixed(0)})`);
      assert.ok(S[STAN.heapScale] <= PROCES.pressScale + 1e-9);
    }
    if (p > PHASE.MELT) assert.equal(heap, 0, `faza ${PHASE_NAMES[p]}: kupy już nie ma`);
    // --- grawitacja: włączona wyłącznie w fazie zrzutu i dopiero, gdy wyświetlacz pokazuje „w dół”; bez niej nic nie spada ---
    const dsp = S[STAN.dsp];
    if (dsp !== prevDsp) dspSeq.push(dsp);
    if (p !== PHASE.DROP) assert.equal(grav, 0, 'grawitacja tylko przy zrzucie');
    assert.equal(grav, dsp === DSP.DOWN ? 1 : 0, `grawitacja włączona dokładnie wtedy, gdy szewrony płyną w dół (wyświetlacz: ${DSP_NAMES[dsp]})`);
    if (!grav) {
      assert.equal(S[STAN.fallT], -1);
      assert.equal(S[STAN.impactT], -1);
      assert.equal(S[STAN.fallV], 0, '0 g: nic nie spada');
      assert.ok(Math.abs(S[STAN.offY]) < 81, `0 g: bryła wisi w polu (y = ${S[STAN.offY].toFixed(1)})`);
      if (R > 0 && p !== PHASE.MELT) assert.ok(Math.hypot(S[STAN.offX], S[STAN.offY], S[STAN.offZ]) <= PROCES.swayMax + 1e-9, 'kula kołysze się najwyżej o swayMax');
      assert.equal(C[LICZNIK.funnel], 0, '0 g: w leju nie ma metalu');
      assert.equal(C[LICZNIK.delivered], prevDelivered, '0 g: gardziel nie oddaje metalu');
      if (dsp === DSP.RUN && S[STAN.dspT] > 2 * DT) assert.ok(S[STAN.spin] > prevSpin && S[STAN.dspSpeed] > 0, 'obieg szewronów: zegar generatora idzie');
      else if (dsp !== DSP.RUN) assert.equal(S[STAN.gate], 0, 'wyświetlacz poza obiegiem: brama 0 g zamknięta');
    } else {
      // (w kroku, w którym grawitacja się włącza, zegar staje w połowie kroku)
      if (prevGrav) assert.equal(S[STAN.spin], prevSpin, 'grawitacja: zegar generatora stoi (szewrony nie krążą)');
      assert.equal(S[STAN.gate], 0, 'grawitacja: brama 0 g zamknięta');
      assert.equal(C[LICZNIK.flight], 0, 'grawitacja: żadne ziarno nie jest w locie');
      assert.equal(S[STAN.mach], M.rOut, 'zrzut: maszyneria odsunięta na bok');
    }
    if (grav && gravOn < 0) { gravOn = t; gravOff = -1; }
    if (!grav && gravOn >= 0) { gravOff = t; gravOn = -1; }
    // sygnalizacja = wyświetlacz: przy grawitacji groty w dół i spływ, obieg stoi; po zrzucie wraca obieg po obwodzie
    if (gravOn >= 0 && t - gravOn > 0.6) assert.ok(S[STAN.dspTurn] === 1 && S[STAN.dspSpeed] === 0 && S[STAN.dspFlow] > 0.95, 'grawitacja: szewrony grotem w dół, płyną w dół');
    if (gravOff >= 0 && t - gravOff > 3.2 && p < PHASE.DROP) assert.ok(dsp === DSP.RUN && S[STAN.dspTurn] === 0 && S[STAN.dspSpeed] === 1, '0 g: szewrony znów krążą po obwodzie');
    if (gravOn < 0 && gravOff < 0 && p < PHASE.DROP) assert.ok(dsp === DSP.RUN && S[STAN.dspTurn] === 0 && S[STAN.dspSpeed] === 1, 'pierwszy obieg przed zrzutem: 0 g, obieg szewronów');
    // --- zrzut: kula wisi do zwolnienia, spada, uderza; potem metal w leju ---
    if (p === PHASE.DROP) {
      if (S[STAN.fallT] < 0) assert.ok(Math.abs(S[STAN.offY]) < PROCES.swayMax + 1e-9 && S[STAN.phaseT] < KOMORA.display.stop + KOMORA.display.hold + KOMORA.display.turn + PROCES.dropDelay + 3 * DT, 'przed zwolnieniem kula jeszcze wisi');
      else assert.ok(dsp === DSP.DOWN || S[STAN.impactT] >= 0, 'kula spada dopiero przy szewronach „w dół”');
      if (S[STAN.impactT] < 0) assert.equal(C[LICZNIK.funnel], 0, 'przed uderzeniem lej pusty');
      else assert.equal(C[LICZNIK.metal], 0, 'od zetknięcia cały metal jest w leju (w jednej masie), w kroplach albo oddany');
    }
    if (C[LICZNIK.impacts] > impacts) {
      impacts = C[LICZNIK.impacts];
      // spadek swobodny: droga z prawa s = g·t²/2 (do zetknięcia ze stożkiem leja; kula zniesiona z osi dotyka go wyżej)
      const yc = funnelContactY(R) + Math.hypot(S[STAN.offX], S[STAN.offZ]) * funnelSlope();
      const tFall = Math.sqrt(2 * -yc / PROCES.gravity);
      assert.ok(Math.abs(S[STAN.fallT] - tFall) < 0.05, `czas spadku ${S[STAN.fallT].toFixed(3)} s, z prawa ${tFall.toFixed(3)} s`);
      assert.ok(Math.abs(S[STAN.fallV] + PROCES.gravity * tFall) < 26, `prędkość uderzenia ${S[STAN.fallV].toFixed(0)}`);
    }
    prev = p;
    prevHeap = heap;
    prevR = R;
    prevDelivered = C[LICZNIK.delivered];
    prevSpin = S[STAN.spin];
    prevGrav = grav;
    prevDsp = dsp;
  }
  assert.equal(C[LICZNIK.cycles], 3);
  // wyświetlacz: w każdym obiegu ta sama kolejność — hamowanie, postój, obrót w dół, w dół, wyhamowanie, obrót powrotny, obieg
  // (trzeci obieg kończy się w chwili wyhamowania spływu)
  const order = [DSP.STOP, DSP.HOLD, DSP.TURN, DSP.DOWN, DSP.SETTLE, DSP.BACK, DSP.RUN];
  assert.deepEqual(dspSeq, Array.from({ length: 19 }, (_, k) => order[k % 7]));
  assert.equal(seen.length, 24, 'trzy pełne obiegi po osiem faz');
  // kupa „duża”: 1/3 wsadu; po stopieniu mała kula; po dokarmieniu duża
  assert.equal(heapAtPress, HEAP_GRAINS, `docisk rusza przy kupie ${heapAtPress} ziaren`);
  assert.ok(Math.abs(rAfterMelt - radiusOfTons(PROCES.heapTons)) < 6, `mała kula po stopieniu kupy: R = ${rAfterMelt.toFixed(0)}`);
  assert.ok(Math.abs(rFull - R_CLEAN) < 0.5, `gotowa kula (${METAL_TONS} t metalu): R = ${rFull.toFixed(1)}`);
  assert.ok(rAfterMelt < 0.85 * rFull, `mała kula wyraźnie mniejsza od gotowej (${rAfterMelt.toFixed(1)} wobec ${rFull.toFixed(1)})`);
  // obieg do ok. 100 s; każde 360 t rudy = 240 t metalu oddanego gardzielą + 120 t żużla w odbieralniku (granulki + wywiezione)
  for (const ct of cycles) assert.ok(ct >= 70 && ct <= 100, `obieg ${ct.toFixed(1)} s`);
  assert.equal(C[LICZNIK.delivered], 3 * METAL_TONS * UNITS_PER_TON);
  assert.equal(C[LICZNIK.slagCatcher] + C[LICZNIK.slagOut], 3 * SLAG_TONS * SLAG_EQ_PER_TON);
  assert.equal(C[LICZNIK.sucks], 3, 'jedno ściąganie żużla na obieg');
  assert.equal(C[LICZNIK.fed], 3 * CHARGE_GRAINS + C[LICZNIK.belt] + C[LICZNIK.flight] + C[LICZNIK.heap], 'podane = trzy wsady + kupa następnego obiegu w drodze');
  assert.equal(impacts, 3);
});

test('wytop: kupa ziaren — bryła z ziaren (stykają się, nie przenikają), nieregularna, większa w planie od małej kuli; topienie od środka', () => {
  const c = createMeltChamber({ seed: 5 });
  const S = c.view.stan;
  const C = c.counters;
  // wzrost: stopniowy (nie skokiem), ziarna przylegają, gdy płynie struga
  runTo(c, PHASE.GATHER);
  const growth = [];
  let lastN = 0;
  while (c.phase === PHASE.GATHER) {
    for (let k = 0; k < 60 && c.phase === PHASE.GATHER; k++) c.step(DT);
    growth.push(C[LICZNIK.heap] - lastN);
    lastN = C[LICZNIK.heap];
  }
  assert.ok(growth.length >= 12 && growth.length <= 24, `zbieranie trwa ${growth.length} s`);
  assert.ok(Math.max(...growth) < 0.3 * HEAP_GRAINS, `najszybszy przyrost kupy w sekundę: ${Math.max(...growth)} ziaren (bez skoku)`);
  assert.ok(growth.filter((g) => g > 300).length >= 9, 'kupa rośnie przez co najmniej 9 s');
  const h = c.heapStats();
  assert.equal(h.n, HEAP_GRAINS);
  // ziarna są twarde: żadne dwa bliżej niż odległość styku (z zapasem liczbowym); prawie każde dotyka sąsiada
  assert.ok(h.minGap >= PROCES.heapStick * PROCES.heapMin - 1e-3, `najmniejsza odległość ziaren ${h.minGap.toFixed(2)} j.`);
  assert.ok(h.touching > 0.93, `ziarna ze stykiem: ${(h.touching * 100).toFixed(1)} %`);
  // bryła: spłaszczona (w planie szersza niż w pionie), nieregularna (półosie w planie różne od koła), zwarta
  assert.ok(h.ext[1] < 0.85 * Math.max(h.ext[0], h.ext[2]), `półosie obrysu ${h.ext.map((v) => v.toFixed(0)).join(' / ')}`);
  assert.ok(h.max / h.rms > 1.45, 'obrys nieregularny (garby wystają ponad średni promień)');
  assert.ok(h.rms > 125 && h.rms < 215, `promień średniokwadratowy kupy ${h.rms.toFixed(0)} j.`);
  // „duża kupa → mała kula”: kupa w planie wyraźnie większa od kuli, w którą się stopi
  const small = radiusOfTons(PROCES.heapTons);
  assert.ok(Math.min(h.ext[0], h.ext[2]) > 1.08 * small && Math.max(h.ext[0], h.ext[2]) > 1.2 * small, `kupa ${h.ext[0].toFixed(0)} × ${h.ext[2].toFixed(0)} j. w planie, kula R = ${small.toFixed(0)} j.`);
  assert.ok(Math.abs(h.centerY) < 30, 'kupa wisi w środku komory');
  // kupa rozruchowa mieści się między odsuniętymi segmentami cewek (w planie pod pierścieniem, w pionie między pierścieniami)
  assert.ok(Math.max(h.ext[0], h.ext[2]) < KOMORA.mach.rOut - 40 && h.ext[1] < KOMORA.mach.padY - 2 * KOMORA.coilTube, `kupa ${h.ext.map((v) => v.toFixed(0)).join(' / ')} między segmentami (rOut ${KOMORA.mach.rOut}, oś ±${KOMORA.mach.padY})`);
  const beltEnd = KOMORA.belt.pts[KOMORA.belt.pts.length - 1];
  assert.ok(Math.max(h.ext[0], h.ext[2]) < Math.hypot(beltEnd[0], beltEnd[2]) - 60, 'kupa nie sięga końca taśmy');
  // bryła PEŁNA OD ŚRODKA (bez pustego jądra i pierścienia): w kuli o promieniu 70 j. wokół środka masy leży tyle ziaren,
  // ile daje gęste upakowanie (0,6–1,1 ziarna na 1000 j.³), a w planie środek nie jest rzadszy od pasa wokół niego
  {
    const Gq = c.view.ziarna;
    const o0 = (c.view.nTasma + c.view.nLot) * GRAIN_STRIDE;
    let mx = 0; let my = 0; let mz = 0;
    for (let i = 0; i < HEAP_GRAINS; i++) { const o = o0 + i * GRAIN_STRIDE; mx += Gq[o] / HEAP_GRAINS; my += Gq[o + 1] / HEAP_GRAINS; mz += Gq[o + 2] / HEAP_GRAINS; }
    let core = 0; let inner = 0; let ring = 0;
    for (let i = 0; i < HEAP_GRAINS; i++) {
      const o = o0 + i * GRAIN_STRIDE;
      const dx = Gq[o] - mx; const dy = Gq[o + 1] - my; const dz = Gq[o + 2] - mz;
      if (dx * dx + dy * dy + dz * dz < 70 * 70) core++;
      const rp = Math.hypot(dx, dz);
      if (rp < 60) inner++; else if (rp < 120) ring++;
    }
    const dens = core / (4 / 3 * Math.PI * 70 ** 3) * 1000;
    assert.ok(dens > 0.6 && dens < 1.15, `gęstość jądra kupy ${dens.toFixed(2)} ziarna na 1000 j.³`);
    assert.ok(inner / (Math.PI * 3600) > 0.8 * ring / (Math.PI * 10800), `środek kupy w planie: ${inner} ziaren w kole 60 j., ${ring} w pasie 60–120 j.`);
  }
  // rekordy obrazu: ziarna kupy mają rodzaj 2, są zimne, głębokość 0…1, leżą w komorze
  const G = c.view.ziarna;
  assert.equal(c.view.nKupa, HEAP_GRAINS);
  assert.equal(c.view.nZiarna, c.view.nTasma + c.view.nLot + c.view.nKupa);
  let deep = 0;
  let surface = 0;
  for (let i = c.view.nTasma + c.view.nLot; i < c.view.nZiarna; i++) {
    const o = i * GRAIN_STRIDE;
    assert.equal(G[o + 9], 2);
    assert.equal(G[o + 8], 0, 'kupa zimna przed grzaniem');
    assert.ok(Number.isFinite(G[o] + G[o + 1] + G[o + 2] + G[o + 3] + G[o + 4] + G[o + 5]) && Math.hypot(G[o], G[o + 1], G[o + 2]) < 400);
    assert.ok(G[o + 11] >= 0 && G[o + 11] <= 1);
    if (G[o + 11] > 0.9) deep++; else if (G[o + 11] < 0.3) surface++;
  }
  assert.ok(deep > 1600 && surface > 1100, `głębokość w kupie: ${deep} ziaren w głębi, ${surface} na wierzchu`);
  // docisk: maszyneria dojeżdża do kupy (nie w nią), kupa ściśnięta
  runTo(c, PHASE.MELT);
  const hp = c.heapStats();
  assert.ok(hp.sorted && Math.abs(hp.scale - PROCES.pressScale) < 1e-9);
  const padD = Math.hypot(S[STAN.mach], KOMORA.mach.padY);
  assert.ok(padD >= Math.min(hp.max + KOMORA.mach.gap, Math.hypot(KOMORA.mach.rMin, KOMORA.mach.padY)) - 1, `segment cewki ${padD.toFixed(0)} j. od środka, kupa sięga ${hp.max.toFixed(0)} j.`);
  // topienie: najpierw sam żar (jądra jeszcze nie ma), potem jądro wchłania ziarna od najbliższych środka
  let heatBefore = 0;
  let firstCoreT = -1;
  let minLive = Infinity;
  let hotSeen = 0;
  let stepsMelt = 0;
  while (c.phase === PHASE.MELT) {
    c.step(DT);
    if (c.radius === 0) heatBefore = S[STAN.heapHeat];
    else if (firstCoreT < 0) firstCoreT = S[STAN.phaseT];
    if (c.radius > 50 && C[LICZNIK.heap] > 800 && (stepsMelt++ % 6) === 0) {
      // żywe ziarna leżą na jądrze albo nad nim (z dokładnością do wchłanianych właśnie): najbliższe przy powierzchni
      const st = c.heapStats();
      minLive = Math.min(minLive, st.max - c.radius);
      // żar idzie przez bryłę: ziarna gorące i jeszcze chłodne jednocześnie
      const o0 = (c.view.nTasma + c.view.nLot) * GRAIN_STRIDE;
      let hot = 0;
      let cool = 0;
      for (let i = 0; i < c.view.nKupa; i++) { const q = G[o0 + i * GRAIN_STRIDE + 8]; if (q > 0.8) hot++; else if (q < 0.5) cool++; }
      if (hot > 200 && cool > 200) hotSeen++;
    }
  }
  assert.ok(firstCoreT > PROCES.meltTime * PROCES.meltPre - 0.05 && firstCoreT < PROCES.meltTime * 0.3, `jądro rusza po ${firstCoreT.toFixed(2)} s grzania`);
  assert.ok(heatBefore > 0.02, 'kupa nagrzewa się, zanim powstanie jądro');
  assert.ok(minLive > -1, 'kupa leży na jądrze (obrys ziaren nie mniejszy od kuli)');
  assert.ok(hotSeen > 12, `żar idzie przez bryłę (gorące i chłodne ziarna naraz w ${hotSeen} próbkach co 0,1 s)`);
  assert.equal(C[LICZNIK.absorbed], HEAP_GRAINS, 'jądro wchłonęło całą kupę');
  assert.equal(C[LICZNIK.heap], 0);
  assert.equal(c.audit().balance, 0);
});

test('wytop: bilans mas = 0 po każdym kroku przez 10 minut pracy; receptura 3 rudy → 2 metalu; pule z zapasem', () => {
  const c = createMeltChamber({ seed: 7 });
  const S = c.view.stan;
  const C = c.counters;
  let ready = 0;
  c.onReady = (tons) => { ready++; assert.equal(tons, METAL_TONS); };
  const max = { flight: 0, belt: 0, heap: 0, granules: 0, floes: 0, drops: 0, sparks: 0, dropDrops: 0 };
  let tempLow = 9;
  let tempHigh = 0;
  for (let k = 0; k < 600 * 60; k++) {
    c.step(DT);
    const a = c.audit();
    if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`krok ${k} (t = ${S[STAN.time].toFixed(2)} s, ${PHASE_NAMES[S[STAN.phase]]}): bilans ${a.balance}, niezgodność liczników ${a.mismatch}`);
    if (k % 30 === 0) for (let i = 0; i < STAN_N; i++) if (!Number.isFinite(S[i])) assert.fail(`stan ${i} nieskończony w kroku ${k}`);
    if (C[LICZNIK.flight] > max.flight) max.flight = C[LICZNIK.flight];
    if (C[LICZNIK.belt] > max.belt) max.belt = C[LICZNIK.belt];
    if (C[LICZNIK.heap] > max.heap) max.heap = C[LICZNIK.heap];
    if (c.view.nGranulki > max.granules) max.granules = c.view.nGranulki;
    // żużel: każde wtopione ziarno zostawiło 1 porcję (wyspy + nitka + granulki + wywiezione) — masa porcji z `split[1]`
    if (C[LICZNIK.slagFloes] + C[LICZNIK.slagThread] + C[LICZNIK.slagCatcher] + C[LICZNIK.slagOut] !== C[LICZNIK.melts] + C[LICZNIK.absorbed]) assert.fail(`krok ${k}: żużel ≠ 1/3 stopionej rudy`);
    if (c.view.nKry > max.floes) max.floes = c.view.nKry;
    if (c.view.nKrople > max.drops) max.drops = c.view.nKrople;
    if (c.view.nIskry > max.sparks) max.sparks = c.view.nIskry;
    if (S[STAN.impactT] >= 0 && c.view.nKrople > max.dropDrops) max.dropDrops = c.view.nKrople;
    if (S[STAN.radius] > 0 && S[STAN.phase] !== PHASE.DROP) {
      if (S[STAN.temp] < tempLow) tempLow = S[STAN.temp];
      if (S[STAN.temp] > tempHigh) tempHigh = S[STAN.temp];
    }
  }
  const cycles = C[LICZNIK.cycles];
  assert.ok(cycles >= 6 && cycles <= 8, `pełnych obiegów w 10 minut: ${cycles}`);
  // gotowość do zrzutu: jedno zdarzenie na obieg
  assert.equal(ready, C[LICZNIK.ready]);
  assert.ok(ready >= cycles && ready <= cycles + 1, `zdarzenia gotowości ${ready} na ${cycles} obiegów`);
  // receptura: każde 360 t rudy = 240 t metalu oddanego gardzielą + 120 t żużla w odbieralniku
  const delivered = C[LICZNIK.delivered] / UNITS_PER_TON;
  assert.ok(delivered >= METAL_TONS * cycles && delivered <= METAL_TONS * (cycles + 1), `oddane ${delivered.toFixed(1)} t w ${cycles} obiegach`);
  assert.ok((C[LICZNIK.slagCatcher] + C[LICZNIK.slagOut]) / SLAG_EQ_PER_TON >= SLAG_TONS * cycles);
  assert.ok(C[LICZNIK.slagOut] / SLAG_EQ_PER_TON >= SLAG_TONS * (cycles - 1), 'koryto odbieralnika opróżnia się co obieg');
  // pule z zapasem
  assert.ok(max.flight < POOL.flight * 0.7, `ziarna w locie: szczyt ${max.flight} z ${POOL.flight}`);
  assert.ok(max.belt < POOL.belt, `ziarna na taśmie: szczyt ${max.belt} z ${POOL.belt}`);
  assert.equal(max.heap, HEAP_GRAINS);
  assert.ok(max.heap < POOL.heap);
  assert.ok(max.granules > 300 && max.granules < POOL.granules, `granulki: szczyt ${max.granules} z ${POOL.granules}`);
  assert.ok(max.floes <= POOL.floes && max.floes > 12, `wyspy żużla: szczyt ${max.floes} z ${POOL.floes}`);
  assert.ok(max.drops > 40 && max.drops < POOL.drops, `krople: szczyt ${max.drops} z ${POOL.drops}`);
  assert.ok(max.sparks > 100 && max.sparks < POOL.sparks, `iskry: szczyt ${max.sparks} z ${POOL.sparks}`);
  // zrzut = jedna masa: żadnych odbitych brył (pula i licznik usunięte); drobny rozprysk najwyżej jak przed rundą 4
  assert.equal(POOL.blobs, undefined);
  assert.equal(LICZNIK.blobs, undefined);
  assert.equal(c.blobStats, undefined);
  assert.ok(max.dropDrops <= 76, `krople przy zrzucie: najwięcej ${max.dropDrops} naraz (przed rundą 4: 76)`);
  // temperatura kuli: rodzi się gorąca (jądro w grzanej kupie), dokarmianie jej nie studzi do wiśni, rafinacja grzeje do zrzutu
  assert.ok(tempLow > 0.75 && tempLow < 0.95, `najniższa temperatura kuli ${tempLow.toFixed(2)}`);
  assert.ok(tempHigh >= PROCES.tempTap && tempHigh < 1.12, `najwyższa temperatura ${tempHigh.toFixed(2)}`);
  assert.equal(GRAIN_UNITS * GRAIN.perTon, UNITS_PER_TON);
});

test('wytop: dwa przebiegi z jednego ziarna losowości są identyczne; inne ziarno — inny przebieg; metal nie zmienia liczb', () => {
  // (metal zmienia gaz, masę żużla i barwy — skrót bez gazu `hash(false)` jest wspólny; pełny skrót gaz obejmuje)
  const run = (o, gas = true) => {
    const c = createMeltChamber(o);
    const out = [];
    for (let k = 0; k < 100 * 60; k++) { c.step(DT); if (k % 300 === 299) out.push(c.hash(gas)); }
    return out;
  };
  const a = run({ seed: 11 });
  const b = run({ seed: 11 });
  const d = run({ seed: 12 });
  const m = run({ seed: 11, metal: 1 }, false);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, d);
  assert.deepEqual(run({ seed: 11 }, false), m, 'miedź: te same liczby procesu (poza gazem)');
  // krok 1/30 s dzieli się na podkroki — wynik bilansu ten sam
  const c = createMeltChamber({ seed: 5 });
  for (let k = 0; k < 110 * 30; k++) { c.step(1 / 30); assert.equal(c.audit().balance, 0); }
  assert.ok(c.counters[LICZNIK.cycles] >= 1, 'krok 1/30 s: pełny obieg');
});

test('wytop: ziarno nie przelatuje przez kulę (wtapia się przy styku) i nie ucieka z komory; brama 0 g i taśma', () => {
  const c = createMeltChamber({ seed: 9 });
  const S = c.view.stan;
  const C = c.counters;
  let worst = -Infinity;
  let rMax = 0;
  let yMax = 0;
  let stopped = 0;
  let crossedClosed = 0;
  let prevFlightIn = 0;
  let bandMax = 0;
  const DD = KOMORA.display;
  while (C[LICZNIK.cycles] < 1) {
    const before = C[LICZNIK.flight] + C[LICZNIK.melts] + C[LICZNIK.lodged];
    c.step(DT);
    // przepływ przez bramę = przyrost (lot + wtopione + przyległe); przy zamkniętej bramie nic nie przechodzi
    const crossed = C[LICZNIK.flight] + C[LICZNIK.melts] + C[LICZNIK.lodged] - before;
    if (S[STAN.gate] === 0 && c.view.stanPrev[STAN.gate] === 0 && crossed > 0) crossedClosed += crossed;
    prevFlightIn += crossed;
    if (C[LICZNIK.flight] > 0) {
      // ziarna na wysokości pasa wyświetlacza (poza przerwą zatoki): promień w planie
      const Gq = c.view.ziarna;
      for (let j = c.view.nTasma; j < c.view.nTasma + c.view.nLot; j++) {
        const o = j * GRAIN_STRIDE;
        if (Math.abs(Gq[o + 1] - DD.y) > DD.half + 8) continue;
        const az = (Math.atan2(Gq[o + 2], Gq[o]) * 180 / Math.PI + 360) % 360;
        if (az > DD.gap0 && az < DD.gap1) continue;
        const r = Math.hypot(Gq[o], Gq[o + 2]);
        if (r > bandMax) bandMax = r;
      }
      const pen = c.flightPenetration();
      if (pen > worst) worst = pen;
      const e = c.flightExtent();
      if (e.r > rMax) rMax = e.r;
      if (e.y > yMax) yMax = e.y;
    }
    // taśma z wsadem stoi przed zamkniętą bramą (czoło czeka)
    if (C[LICZNIK.belt] > 0 && !S[STAN.beltRun]) { stopped++; assert.equal(S[STAN.gate], 0, 'taśma staje tylko przed zamkniętą bramą'); }
  }
  assert.equal(crossedClosed, 0, 'przez zamkniętą bramę 0 g nie przechodzi żadne ziarno');
  assert.equal(prevFlightIn, CHARGE_GRAINS + C[LICZNIK.flight] + C[LICZNIK.heap], 'przez bramę przeszedł cały wsad (i początek następnego)');
  assert.equal(C[LICZNIK.lodged], HEAP_GRAINS + C[LICZNIK.heap], 'kupa: 1/3 wsadu');
  assert.equal(C[LICZNIK.melts], CHARGE_GRAINS - HEAP_GRAINS, 'reszta wsadu wtopiona w kulę ziarno po ziarnie');
  assert.ok(stopped > 60, 'kupa następnego obiegu czekała na taśmie przed bramą na koniec zrzutu');
  // środek ziarna nigdy nie leży pod powierzchnią kuli głębiej niż na krok ruchu (ziarno ma promień 3 j.)
  assert.ok(worst < 0.5, `największe zagłębienie ${worst.toFixed(2)} j.`);
  assert.ok(rMax < KOMORA.pitR - 20 && rMax > 300, `największy promień lotu ${rMax.toFixed(0)}`);
  assert.ok(bandMax < KOMORA.display.rIn - 20, `ziarna nie wchodzą w pas wyświetlacza (największy promień na jego wysokości ${bandMax.toFixed(0)}, lico od ${KOMORA.display.rIn})`);
  assert.ok(yMax < KOMORA.fieldCeil + 31, `największa wysokość lotu ${yMax.toFixed(0)}`);
  // ziarna w locie do KULI rozgrzewają się po drodze; do KUPY lecą zimne; na taśmie zimne
  const heatOf = (phase, tIn) => {
    const q = createMeltChamber({ seed: 9 });
    runTo(q, phase);
    for (let k = 0; k < tIn * 60; k++) q.step(DT);
    const G = q.view.ziarna;
    let hot = 0;
    let coldFlight = 0;
    let belt = 0;
    for (let i = 0; i < q.view.nTasma + q.view.nLot; i++) {
      const o = i * GRAIN_STRIDE;
      assert.ok(Number.isFinite(G[o]) && Number.isFinite(G[o + 3]));
      if (G[o + 9] === 1) { if (G[o + 8] > 0.2) hot++; else coldFlight++; } else { assert.equal(G[o + 8], 0); belt++; }
    }
    return { hot, coldFlight, belt };
  };
  const feed = heatOf(PHASE.FEED, 3);
  assert.ok(feed.hot > 300 && feed.belt > 3000, `dokarmianie: gorące w locie ${feed.hot}, zimne na taśmie ${feed.belt}`);
  const gather = heatOf(PHASE.GATHER, 4);
  assert.ok(gather.hot === 0 && gather.coldFlight > 1500, `zbieranie: ziarna lecą zimne (${gather.coldFlight})`);
  // granica 0 g leży na torze taśmy, przed jej końcem
  const { track, sBoundary } = createMeltTrack();
  assert.ok(sBoundary > 0 && sBoundary < track.length);
});

test('wytop: struga przy dużej kuli — rozgrzewające się ziarna owijają kulę co najmniej ćwierć obwodu przez całe dokarmianie', () => {
  const c = createMeltChamber({ seed: 7 });
  const V = c.view;
  runTo(c, PHASE.FEED);
  const B = KOMORA.belt;
  const gateAz = Math.atan2(B.pts[B.pts.length - 1][2], B.boundaryX);
  assert.ok(PROCES.flowTime >= 2 && PROCES.flowTime <= 3.2);
  const wraps = [];
  let t = 0;
  let maxFlight = 0;
  while (c.phase === PHASE.FEED) {
    c.step(DT);
    t += DT;
    maxFlight = Math.max(maxFlight, V.nLot);
    if (!(t > 3 && t < 21) || Math.round(t * 60) % 120 !== 0 || V.nLot < 800) continue;
    // kąt od bramy 0 g zgodnie z wirem pola (azymut maleje), dla ziaren w locie
    const G = V.ziarna;
    const w0 = V.nTasma * GRAIN_STRIDE;
    const angs = [];
    let hot = 0;
    for (let j = 0; j < V.nLot; j++) {
      const o = w0 + j * GRAIN_STRIDE;
      let d = gateAz - Math.atan2(G[o + 2], G[o]);
      while (d < -Math.PI) d += 2 * Math.PI;
      while (d > 1.5 * Math.PI) d -= 2 * Math.PI;
      angs.push(d);
      if (G[o + 8] > 0.5) hot++;
    }
    angs.sort((x, y) => x - y);
    wraps.push({ t, R: c.radius, q90: angs[Math.floor(0.9 * angs.length)], hot: hot / V.nLot });
  }
  assert.ok(wraps.length >= 6, `próbek ${wraps.length}`);
  for (const w of wraps) {
    assert.ok(w.q90 > 0.5 * Math.PI, `dokarmianie +${w.t.toFixed(0)} s (R = ${w.R.toFixed(0)}): 10 % ziaren w locie jest dalej niż ${(w.q90 * 180 / Math.PI).toFixed(0)}° od bramy`);
    assert.ok(w.hot > 0.3, `rozgrzanych ziaren w locie ${(w.hot * 100).toFixed(0)} %`);
  }
  assert.ok(maxFlight < POOL.flight * 0.5, `ziaren w locie najwyżej ${maxFlight} z ${POOL.flight}`);
});

test('wytop: żużel — JEDEN system: drobiny tylko przy wtopieniach, wyspy bez skoków, łączą się i spływają na górny biegun, ssawa ściąga czapę do zera', () => {
  const c = createMeltChamber({ seed: 4 });
  const S = c.view.stan;
  const C = c.counters;
  const K = c.view.kry;
  const seen = new Map();             // numer wyspy → [x, y, z, promień rysowany, masa]
  const worst = { dRad: 0, dDir: 0, born: 0, bornMass: 0, died: 0, diedMass: 0 };
  const sucks = [];
  let prevSuck = 0;
  let prevOn = 0;
  let prevMade = 0;
  let prevMelts = 0;
  let suckOutside = 0;
  let maxCapShare = 0;
  let maxRad = 0;
  let minMouth = Infinity;
  let yAtRefine = -2;
  let yAtSuck = -2;
  let capAtFlow = 0;
  let capGrew = 0;
  let prevCap = 0;
  let flowSteps = 0;
  let cleanAtClear = -1;
  let prevPhase = c.phase;
  while (C[LICZNIK.cycles] < 1) {
    c.step(DT);
    const p = S[STAN.phase];
    const n = c.view.nKry;
    const on = C[LICZNIK.slagFloes];
    const melts = C[LICZNIK.melts] + C[LICZNIK.absorbed];
    // --- żużel pojawia się TYLKO z wtopień: masa na kuli rośnie najwyżej o ziarna wtopione w tym kroku; drobiny
    // zarodkują tylko w krokach z wtopieniami; ubywa wyłącznie nitką ssawy (najwyżej tempo ściągania) ---
    assert.ok(on - prevOn <= melts - prevMelts, 'żużel na kuli przybywa tylko z wtopień');
    assert.ok(C[LICZNIK.floesMade] - prevMade <= melts - prevMelts, 'drobina powstaje tylko w miejscu wtopienia');
    if (on < prevOn) {
      assert.equal(S[STAN.suck] === 2 || prevSuck === 2, true, 'żużel schodzi z kuli tylko nitką ssawy');
      assert.ok(prevOn - on <= PROCES.suckRate * SLAG_EQ_PER_TON * DT + 2, `ściąganie najwyżej ${PROCES.suckRate} t/s`);
    }
    // żużel = 1/3 masy stopionej rudy w sumie (wyspy + nitka i rurociąg + granulki + wywiezione)
    assert.equal(on + C[LICZNIK.slagThread] + C[LICZNIK.slagCatcher] + C[LICZNIK.slagOut], melts);
    // --- ciągłość wysp między krokami (także przy zmianie fazy, dojeździe ssawy i ściąganiu) ---
    let sum = 0;
    let ySum = 0;
    let zone = 0;
    const now = new Map();
    for (let i = 0; i < n; i++) {
      const o = i * FLOE_STRIDE;
      const id = K[o + 4];
      const rec = [K[o], K[o + 1], K[o + 2], K[o + 3], Math.round(K[o + 6] * SLAG_EQ_PER_TON)];
      assert.ok(Math.abs(Math.hypot(rec[0], rec[1], rec[2]) - 1) < 1e-4, 'wyspa leży na sferze jednostkowej');
      assert.ok(rec[3] >= 0 && rec[3] <= KOMORA.slag.maxAngle + 1e-6 && K[o + 5] > 0.15 && K[o + 5] <= 1, 'promień i żar wyspy w zakresie');
      assert.ok(!now.has(id), 'numer wyspy jest jednoznaczny');
      now.set(id, rec);
      sum += rec[4];
      ySum += rec[4] * rec[1];
      if (rec[1] > Math.cos(0.5)) zone += rec[4];
      if (rec[3] > maxRad) maxRad = rec[3];
      const q = seen.get(id);
      if (!q) { worst.born = Math.max(worst.born, rec[3]); worst.bornMass = Math.max(worst.bornMass, rec[4]); continue; }
      worst.dRad = Math.max(worst.dRad, Math.abs(rec[3] - q[3]));
      worst.dDir = Math.max(worst.dDir, Math.hypot(rec[0] - q[0], rec[1] - q[1], rec[2] - q[2]));
    }
    for (const [id, q] of seen) if (!now.has(id)) { worst.died = Math.max(worst.died, q[3]); worst.diedMass = Math.max(worst.diedMass, q[4]); }
    seen.clear();
    for (const [id, r] of now) seen.set(id, r);
    assert.equal(sum, on, 'masa wysp w widoku = licznik żużla na kuli');
    if (on > 0 && zone / on > maxCapShare) maxCapShare = zone / on;
    // --- ssawa: tylko w rafinacji; stany po kolei; dzwon nad kulą ---
    const st = S[STAN.suck];
    if (st !== 0 && p !== PHASE.REFINE) suckOutside++;
    if (st !== prevSuck) {
      sucks.push(st);
      if (st === 2) yAtSuck = on > 0 ? ySum / on : 1;
    }
    if (p === PHASE.REFINE && prevPhase !== PHASE.REFINE) yAtRefine = on > 0 ? ySum / on : 1;
    if (st !== 0) minMouth = Math.min(minMouth, Math.hypot(S[STAN.mouthX] - S[STAN.offX], S[STAN.mouthY] - S[STAN.offY]) - c.radius);
    if (st === 2 && S[STAN.suckFlow] > 1) {
      // czapa kurczy się w miarę ściągania (promień rysowany nie rośnie)
      flowSteps++;
      if (capAtFlow === 0) capAtFlow = S[STAN.capAlpha];
      else if (S[STAN.capAlpha] > prevCap + 1e-4) capGrew++;
      prevCap = S[STAN.capAlpha];
    }
    if (p === PHASE.CLEAR && prevPhase === PHASE.REFINE) cleanAtClear = on + n + st;
    prevSuck = st;
    prevOn = on;
    prevMade = C[LICZNIK.floesMade];
    prevMelts = melts;
    prevPhase = p;
  }
  // bez skoków: wyspa rodzi się z promieniem ~0 i znika z promieniem ~0 i masą 0; między krokami promień i położenie
  // zmieniają się o ułamek stopnia
  assert.ok(worst.born < 0.01 && worst.bornMass <= 40, `wyspa rodzi się jako punkt (promień ${worst.born.toFixed(4)} rad, masa ${worst.bornMass} jedn.)`);
  assert.ok(worst.died < 0.004 && worst.diedMass === 0, `wyspa znika dopiero po zaniku do zera (promień ${worst.died.toFixed(4)} rad, masa ${worst.diedMass})`);
  assert.ok(worst.dRad < 0.02, `promień rysowany wyspy zmienia się płynnie (najwięcej ${worst.dRad.toFixed(4)} rad na krok)`);
  assert.ok(worst.dDir < 0.04, `wyspa płynie, nie przeskakuje (najwięcej ${worst.dDir.toFixed(4)} rad na krok)`);
  // wyspy łączą się (drobin powstało dużo więcej, niż było wysp na końcu) i dochodzą do bieguna w jedną czapę
  assert.ok(C[LICZNIK.floesMade] > 100 && C[LICZNIK.merges] > 80 && C[LICZNIK.merges] <= C[LICZNIK.floesMade] - 1 && C[LICZNIK.merges] >= C[LICZNIK.floesMade] - 6, `drobin ${C[LICZNIK.floesMade]}, zlań ${C[LICZNIK.merges]} (prawie wszystkie zlały się w czapę)`);
  assert.ok(maxCapShare > 0.97, `udział żużla w strefie górnego bieguna dochodzi do ${(maxCapShare * 100).toFixed(0)} %`);
  assert.ok(yAtSuck > yAtRefine + 0.15 && yAtSuck > 0.9, `wirowanie spycha wyspy ku górze: średnia wysokość ${yAtRefine.toFixed(2)} → ${yAtSuck.toFixed(2)}`);
  assert.ok(maxRad > 0.5 && maxRad < 0.75, `czapa: promień ${(maxRad * 180 / Math.PI).toFixed(0)}°`);
  // ssawa: jeden dojazd, ściąganie i powrót na obieg, tylko w rafinacji; po ściąganiu na kuli zostaje 0 żużla
  assert.deepEqual(sucks, [1, 2, 3, 0]);
  assert.equal(suckOutside, 0, 'ssawa pracuje tylko w rafinacji i wraca przed odsuwem');
  assert.equal(C[LICZNIK.sucks], 1);
  assert.equal(cleanAtClear, 0, 'odsuw zaczyna się przy czystej kuli i ssawie w postoju');
  assert.ok(flowSteps > 300 && capGrew <= 10 && capAtFlow > 0.5 && prevCap < 0.2, `czapa kurczy się przez całe ściąganie (${(capAtFlow * 57.3).toFixed(0)}° → ${(prevCap * 57.3).toFixed(0)}°, wzrostów ${capGrew})`);
  assert.ok(minMouth > KOMORA.ssawa.mouthR, `dzwon ssawy nad powierzchnią kuli (najmniej ${minMouth.toFixed(1)} j.)`);
  // po obiegu cały żużel (1/3 masy rudy) jest w odbieralniku, nic nie zostało na kuli ani w rurociągu
  assert.equal(C[LICZNIK.slagCatcher] + C[LICZNIK.slagOut], SLAG_TONS * SLAG_EQ_PER_TON);
  assert.equal(C[LICZNIK.slagFloes] + C[LICZNIK.slagThread], 0);
  // prawo promienia wyspy: rośnie wolniej niż masa (soczewka grubieje), większy kąt na mniejszej kuli; biegun = góra
  assert.ok(slagAngle(5, 170) > slagAngle(1, 170) && slagAngle(5, 150) > slagAngle(5, 177) && slagAngle(0, 170) === 0);
  assert.ok(Math.abs(slagAngle(30, KOMORA.slag.refR) - KOMORA.slag.angle * Math.pow(30, KOMORA.slag.power)) < 1e-9 && slagAngle(8, 170) < 2 * slagAngle(1, 170) * 1.2);
  // runda 4: żużel wygląda jak przedtem, tylko większy — czapa całego żużla na największej kuli zajmuje ten sam kąt,
  // co czapa 30 t na kuli 90 t sprzed rundy (prawo sprzed rundy: kąt · masa^0,4 · 170 / R)
  assert.ok(Math.abs(slagAngle(SLAG_TONS, R_MAX) - KOMORA.slag.angle * Math.pow(30, KOMORA.slag.power) * 170 / radiusOfTons(90)) < 0.01, `czapa ${(slagAngle(SLAG_TONS, R_MAX) * 57.3).toFixed(1)}°`);
  assert.deepEqual([...KOMORA.slagPole], [0, 1, 0]);
  assert.equal(KOMORA.arm, undefined, 'ramię zgarniające usunięte');
  assert.equal(KOMORA.catcher, undefined, 'stary łapacz usunięty');
});

test('wytop: odbieralnik — żużel z nitki po drodze rurociągiem wypada jako granulki, stygnie w korycie, przed następnym ściąganiem koryto się opróżnia', () => {
  const c = createMeltChamber({ seed: 6 });
  const S = c.view.stan;
  const C = c.counters;
  const G = c.view.granulki;
  const T = KOMORA.tray;
  runTo(c, PHASE.REFINE);
  const pos = new Map();
  let firstFlow = -1;
  let firstGranule = -1;
  let maxFly = 0;
  let maxStep = 0;
  let outside = 0;
  let hotLanded = 0;
  let pipeGlow = 0;
  while (c.phase === PHASE.REFINE || c.phase === PHASE.CLEAR || c.phase === PHASE.DROP) {
    c.step(DT);
    if (firstFlow < 0 && C[LICZNIK.slagThread] > 0) firstFlow = S[STAN.time];
    if (firstGranule < 0 && c.view.nGranulki > 0) firstGranule = S[STAN.time];
    if (S[STAN.pipeGlow] > pipeGlow) pipeGlow = S[STAN.pipeGlow];
    let fly = 0;
    for (let i = 0; i < c.view.nGranulki; i++) {
      const o = i * GRANULE_STRIDE;
      const id = G[o + 8];
      const x = G[o];
      const y = G[o + 1];
      const z = G[o + 2];
      assert.ok(Number.isFinite(x + y + z) && G[o + 3] > 1.4 && G[o + 3] <= PROCES.granuleR + 1e-6 && G[o + 7] >= 0 && G[o + 7] <= 1);
      // granulka nie wychodzi poza koryto (łuk, promienie) i nie spada pod dno
      const az = Math.atan2(z, x);
      const r = Math.hypot(x, z);
      if (az < T.az0 - 0.01 || az > T.az1 + 0.01 || r < T.rIn || r > T.rOut || y < T.floorY || y > T.spoutY) outside++;
      if (G[o + 9]) fly++; else if (G[o + 7] > 0.95) hotLanded++;
      const q = pos.get(id);
      if (q) maxStep = Math.max(maxStep, Math.hypot(x - q[0], y - q[1], z - q[2]));
      // poprzednie położenie w rekordzie = położenie z poprzedniego kroku (obraz miesza je bez skoku)
      if (q) assert.ok(Math.hypot(G[o + 4] - q[0], G[o + 5] - q[1], G[o + 6] - q[2]) < 1e-3);
      pos.set(id, [x, y, z]);
    }
    if (fly > maxFly) maxFly = fly;
  }
  assert.ok(firstFlow > 0 && firstGranule - firstFlow > PROCES.slagTransit - 0.03 && firstGranule - firstFlow < PROCES.slagTransit + 0.4, `droga żużla do odbieralnika: ${(firstGranule - firstFlow).toFixed(2)} s`);
  assert.ok(pipeGlow > 0.95, 'wzierniki rurociągu świecą, gdy płynie żużel');
  assert.equal(outside, 0, 'granulki zostają w korycie');
  assert.ok(maxFly > 8 && maxFly < 60, `granulek w locie naraz: ${maxFly}`);
  assert.ok(maxStep < 12, `granulka spada płynnie (najwięcej ${maxStep.toFixed(1)} j. na krok)`);
  assert.equal(hotLanded, 0, 'granulka stygnie już w locie');
  // po obiegu: cały żużel obiegu leży w korycie jako ostygłe granulki
  assert.equal(C[LICZNIK.slagCatcher], SLAG_TONS * SLAG_EQ_PER_TON);
  assert.equal(c.view.nGranulki, SLAG_TONS * SLAG_EQ_PER_TON / PROCES.granuleUnits);
  assert.equal(C[LICZNIK.slagOut] + C[LICZNIK.slagThread], 0);
  let hottest = 0;
  for (let i = 0; i < c.view.nGranulki; i++) hottest = Math.max(hottest, G[i * GRANULE_STRIDE + 7]);
  assert.ok(hottest < 0.12, `granulki ostygły (najgorętsza ${hottest.toFixed(2)})`);
  // następny obieg: przy zbieraniu rudy żaluzje dna otwierają się, granulki zsuwają się, koryto puste przed ssaniem
  let dumpSteps = 0;
  let maxDump = 0;
  while (!(c.phase === PHASE.PRESS)) {
    c.step(DT);
    if (S[STAN.trayDump] > 0) { dumpSteps++; maxDump = Math.max(maxDump, S[STAN.trayDump]); assert.equal(c.phase, PHASE.GATHER); }
    assert.equal(c.audit().balance, 0);
  }
  assert.ok(dumpSteps > 100 && dumpSteps < 200 && maxDump > 0.95, `zsyp koryta: ${dumpSteps} kroków`);
  assert.equal(c.view.nGranulki, 0);
  assert.equal(C[LICZNIK.slagCatcher], 0);
  assert.equal(C[LICZNIK.slagOut], SLAG_TONS * SLAG_EQ_PER_TON);
});

/** Liczba osobnych płatów komórek pola z warstwą grubszą niż `thr` (sąsiedztwo na siatce biegunowej + komórka środkowa). */
function massParts(f, thr, minVol = 0) {
  const NA = f.na;
  const NC = f.center;
  const seen = new Uint8Array(NC + 1);
  const stack = [];
  let n = 0;
  for (let s0 = 0; s0 <= NC; s0++) {
    if (seen[s0] || !(f.h[s0] > thr)) continue;
    let vol = 0;
    stack.push(s0);
    seen[s0] = 1;
    while (stack.length) {
      const c = stack.pop();
      vol += f.h[c] * f.area[c];
      const nb = [];
      if (c === NC) { for (let i = 0; i < NA; i++) nb.push(i); } else {
        const j = Math.floor(c / NA);
        const i = c - j * NA;
        nb.push(j * NA + (i + 1) % NA, j * NA + (i + NA - 1) % NA, j > 0 ? c - NA : NC);
        if (j + 1 < f.nr) nb.push(c + NA);
      }
      for (const q of nb) if (!seen[q] && f.h[q] > thr) { seen[q] = 1; stack.push(q); }
    }
    // (płat mniejszy niż `minVol` to nierówność cienkiego filmu na wykładzinie, nie ciało cieczy)
    if (vol >= minVol) n++;
  }
  return n;
}

test('wytop: zrzut — kula faluje w locie, uderza w lej i zostaje JEDNĄ masą: fałda wjeżdża po ścianie i wraca, garb w środku, uspokojenie, całość spływa gardzielą', () => {
  const runDrop = (seed, full) => {
    const c = createMeltChamber({ seed });
    const S = c.view.stan;
    const C = c.counters;
    const F = KOMORA.funnel;
    const f = c.field;
    runTo(c, PHASE.CLEAR);
    const metal = C[LICZNIK.metal];
    const R = c.radius;
    assert.equal(metal, METAL_TONS * UNITS_PER_TON, `do zrzutu idzie ${METAL_TONS} t czystego metalu`);
    assert.equal(C[LICZNIK.slagFloes] + C[LICZNIK.drops] + c.view.nKry, 0);
    // odsuw: maszyneria odjeżdża pod ściany PRZED sekwencją wyświetlacza; grawitację włącza dopiero tryb „w dół”
    while (c.phase === PHASE.CLEAR) { assert.equal(S[STAN.grav], 0); c.step(DT); }
    assert.equal(S[STAN.mach], KOMORA.mach.rOut);
    assert.equal(S[STAN.machY], KOMORA.mach.padY);
    assert.equal(S[STAN.grav], 0);
    assert.equal(S[STAN.dsp], DSP.STOP, 'zrzut zaczyna się od zatrzymania szewronów');
    assert.equal(c.view.masaOn, 0, 'przed zetknięciem pola masy nie ma');
    const dirs = [];
    for (let k = 0; k < 300; k++) { const y = 1 - (2 * k + 1) / 300; const r = Math.sqrt(1 - y * y); const an = k * 2.399963229728653; dirs.push([Math.cos(an) * r, y, Math.sin(an) * r]); }
    const rest = funnelLevelOf(4 / 3 * Math.PI * R ** 3);          // lustro w spoczynku (cała kula w leju)
    const o = {
      wobble: 0, stretchMax: 0, stretchMin: Infinity, maxDrops: 0, maxSparks: 0, dropTons: 0, throatMax: 0, funMax: 0, dropsOutside: 0, lastDropAt: 0, maxDropY: -Infinity,
      emptyAt: -1, gap0: 0, mergedAt: -1, wallAt: -1, wallLeftAt: -1, foldMax: -Infinity, foldAt: 0, midMin: Infinity, midMinAt: 0, humpMax: -Infinity, humpAt: 0,
      partsMin: Infinity, com0: null, comBack: Infinity, frontSpread: 0, humpStep: 0, lakePrev: -1, lakeGrows: 0, lakeAtThird: -1, lakeAtTenth: -1,
      partsMax: 0, jumpEarly: 0, jumpLate: 0, l1Max: 0, topDrop: 0, topRise: 0, levelPeak: -Infinity, levelRises: 0, drainAt: -1, wetMax: -Infinity, fold: [], mid: [], impactOff: 0, impactV: 0
    };
    let prevY = Infinity;
    let impactSeen = false;
    let prevBall = Infinity;
    let prevLevel = Infinity;
    let prevTop = Infinity;
    let prevDelivered = 0;
    let prevMasa = null;
    let top0 = 0;
    while (c.phase === PHASE.DROP) {
      c.step(DT);
      if (c.phase !== PHASE.DROP) break;
      if (S[STAN.fallT] >= 0 && S[STAN.impactT] < 0) {
        // w locie: kula tylko spada (coraz szybciej), wydłuża się w osi spadku (objętość zachowana) i faluje
        assert.ok(S[STAN.offY] < prevY + 1e-9, 'kula spada');
        prevY = S[STAN.offY];
        let m = 0;
        for (const d of dirs) m = Math.max(m, Math.abs(surfaceOffset(c.modes.a, d[0], d[1], d[2])));
        o.wobble = Math.max(o.wobble, m);
        assert.equal(c.radius, R, 'w locie kula ma stały promień');
        assert.ok(Math.abs(S[STAN.squash] * S[STAN.wide] * S[STAN.wide] - 1) < 1e-9, 'wydłużona bryła zachowuje objętość');
        if (S[STAN.fallT] > 0.5) { o.stretchMax = Math.max(o.stretchMax, S[STAN.squash]); o.stretchMin = Math.min(o.stretchMin, S[STAN.squash]); }
        assert.ok(S[STAN.tail] >= 0 && S[STAN.tail] <= 1);
        assert.equal(C[LICZNIK.funnel], 0);
        // pole puszcza kulę nierówno: znos w planie najwyżej `dropDrift`
        assert.ok(Math.hypot(S[STAN.offX], S[STAN.offZ]) <= PROCES.swayMax + PROCES.dropDrift * (S[STAN.fallT] + DT) + 1e-6, 'znos kuli w locie w granicach');
      }
      if (S[STAN.impactT] >= 0) {
        const ti = S[STAN.impactT];
        if (!impactSeen) {
          impactSeen = true;
          // w chwili zetknięcia: środek bryły na wysokości styku ze stożkiem (zniesiona z osi dotyka go wyżej)
          o.impactOff = Math.hypot(S[STAN.offX], S[STAN.offZ]);
          o.impactV = -S[STAN.fallV];
          assert.ok(Math.abs(S[STAN.offY] - (funnelContactY(R) + o.impactOff * funnelSlope())) < 40, `środek kuli przy zetknięciu y = ${S[STAN.offY].toFixed(0)}`);
          assert.ok(S[STAN.squash] > 1.05, 'bryła dotyka leja wydłużona');
          assert.equal(c.view.masaOn, 1, 'od zetknięcia metal rysuje pole masy');
          // CAŁA kula jest od zetknięcia polem (jedną masą): metal kuli = 0, w leju cały; pod nawisem kuli prześwit
          assert.equal(C[LICZNIK.metal], 0, 'od zetknięcia nie ma osobnej kuli');
          assert.equal(C[LICZNIK.funnel], metal, 'cały metal jest masą w leju');
          let cols = 0;
          let colVol = 0;
          for (let k = 0; k < MASA_CELLS; k++) if (f.chord[k] > 0) { cols++; colVol += f.chord[k] * f.area[k]; }
          assert.ok(cols > 300 && Math.abs(colVol - 4 / 3 * Math.PI * R ** 3) < 1e-6 * colVol, `kula rozpisana na ${cols} słupów o objętości kuli`);
          assert.ok(S[STAN.ballCols] > 50, `kopuła kuli wystaje nad pole w ${S[STAN.ballCols]} komórkach`);
          o.gap0 = S[STAN.ballCols];
        }
        // metal: kula + lej (pole masy) + krople + oddane = całość, w każdym kroku; ŻADNYCH innych ciał cieczy
        assert.equal(C[LICZNIK.metal] + C[LICZNIK.funnel] + C[LICZNIK.drops] + C[LICZNIK.delivered], metal);
        // kopuła kuli tonie w polu; gdy zanurzy się cała, nie wraca
        assert.equal(C[LICZNIK.metal], 0);
        if (prevBall === 0) assert.equal(S[STAN.ballCols], 0, 'zanurzona kopuła nie wraca');
        prevBall = S[STAN.ballCols];
        if (S[STAN.ballCols] === 0 && o.mergedAt < 0) o.mergedAt = ti;
        let liftMax = 0;
        for (let k = 0; k < MASA_CELLS; k++) if (f.lift[k] > liftMax) liftMax = f.lift[k];
        // (kula zniesiona z osi dotyka stożka jedną stroną: po przeciwnej jej obrzeże wisi nad wykładziną najwyżej —
        // prześwit rzędu promienia kuli; kopuła opadając rozszerza się, więc obejmuje też komórki tuż za obrysem kuli)
        assert.ok(liftMax <= 1.3 * R && (S[STAN.ballCols] > 0) === (liftMax > 0));
        // pole = masa autorytatywna (normalizacja po każdym podkroku)
        const vol = C[LICZNIK.funnel] / UNITS_PER_TON * (4 / 3 * Math.PI * BALL.rPerCbrtTon ** 3);
        let fv = 0;
        for (let k = 0; k < MASA_CELLS; k++) { fv += f.h[k] * f.area[k]; if (!(f.h[k] >= 0)) assert.fail(`grubość ujemna albo NaN w komórce ${k}`); }
        assert.ok(Math.abs(fv - vol) <= 1e-6 * Math.max(vol, 1) + 1e-3, `objętość pola ${fv.toFixed(0)} = masa w leju ${vol.toFixed(0)}`);
        // (krople wracające do masy w tym samym kroku dolewają metal już po policzeniu poziomu — stąd zapas)
        assert.ok(Math.abs(S[STAN.level] - funnelLevelOf(vol)) < 4, 'poziom w leju (lustro w spoczynku) z masy metalu');
        // JEDNA MASA: komórki z warstwą tworzą jeden spójny płat (żadnych oderwanych brył ani kałuż) — przy trzech progach
        // (próg od 3 j.: cieńsza warstewka to film na wykładzinie, w obrazie schowany pod wargą brzegu)
        // (ciało cieczy = płat o objętości co najmniej 0,1 % kuli; mniejsze płaty przy progu to nierówności cienkiego
        // filmu ściekającego po stożku pod koniec spływu — mokra wykładzina, w obrazie rysowana jako żar leja; dopóki
        // w leju jest więcej niż 4 % metalu, taki płat musi być dokładnie jeden — 1 j. filmu na całym stożku to 1,5 % metalu)
        {
          const minVol = 1e-3 * 4 / 3 * Math.PI * R ** 3;
          for (const thr of [3, 6, 12]) {
            const n = massParts(f, thr, minVol);
            o.partsMax = Math.max(o.partsMax, n);
            if (C[LICZNIK.funnel] > 0.04 * metal && thr === 3) o.partsMin = Math.min(o.partsMin, n);
          }
        }
        // NIESYMETRIA z symulacji (runda 4, poprawki): środek ciężkości masy w planie, rozrzut czoła po kącie,
        // stromość garbu odbicia (spadek lustra na 4 pierścieniach siatki), promień jeziora rysowanego jako ciecz
        {
          let mx = 0;
          let mz = 0;
          let mm = 0;
          for (let j = 0; j < f.nr; j++) for (let i = 0; i < f.na; i++) { const q = j * f.na + i; const v = f.h[q] * f.area[q]; mx += v * f.rc[j] * f.cosC[i]; mz += v * f.rc[j] * f.sinC[i]; mm += v; }
          if (mm > 0) { mx /= mm; mz /= mm; }
          if (!o.com0 && ti > 0.3) o.com0 = [mx, mz];
          if (o.com0 && ti > 1.5 && ti < 4) o.comBack = Math.min(o.comBack, (mx * o.com0[0] + mz * o.com0[1]) / Math.hypot(o.com0[0], o.com0[1]));
          if (ti > 0.6 && ti < 0.9) {
            let rMin = Infinity;
            let rMax = 0;
            for (let i = 0; i < f.na; i++) { let rr = 0; for (let j = f.nr - 1; j >= 0; j--) if (f.h[j * f.na + i] > 8) { rr = f.rc[j]; break; } rMin = Math.min(rMin, rr); rMax = Math.max(rMax, rr); }
            o.frontSpread = Math.max(o.frontSpread, rMax - rMin);
          }
          if (ti > 2.0 && ti < 3.0) {
            for (let j = 0; j + 4 < f.nr && f.rc[j] < 300; j++) for (let i = 0; i < f.na; i++) {
              const a = j * f.na + i;
              const b = a + 4 * f.na;
              if (f.h[a] > 6 && f.h[b] > 6) o.humpStep = Math.max(o.humpStep, Math.abs(f.zb[a] + f.h[a] - f.zb[b] - f.h[b]));
            }
          }
          // jezioro rysowane jako ciecz: warstwa grubsza niż próg brzegu (`MASS_EDGE.h`) — średni promień po kącie
          const tons = C[LICZNIK.funnel] / UNITS_PER_TON;
          if (ti > PROCES.drainDelay + 2) {
            let lake = 0;
            for (let i = 0; i < f.na; i++) { let rr = 0; for (let j = f.nr - 1; j >= 0; j--) if (f.h[j * f.na + i] > MASS_EDGE.h) { rr = f.rc[j]; break; } lake += rr / f.na; }
            if (o.lakePrev >= 0 && lake > o.lakePrev + 1.5 * f.dr) o.lakeGrows++;
            o.lakePrev = lake;
            if (tons < 0.36 * METAL_TONS && o.lakeAtThird < 0) o.lakeAtThird = lake;
            if (tons < 0.1 * METAL_TONS && o.lakeAtTenth < 0) o.lakeAtTenth = lake;
          }
        }
        // ciągłość: grubość rysowana (z wierzchem jeszcze niewlanych słupów kuli) zmienia się między krokami bez skoków
        const M = c.view.masa;
        let top = -Infinity;
        for (let k = 0; k < MASA_CELLS; k++) { const hr = M[k * MASA_STRIDE]; if (hr > 0.5 && f.zb[k] + hr > top) top = f.zb[k] + hr; }
        if (prevMasa) {
          let l1 = 0;
          let tot = 0;
          let jump = 0;
          for (let k = 0; k < MASA_CELLS; k++) {
            const d = Math.abs(M[k * MASA_STRIDE] - prevMasa[k * MASA_STRIDE]);
            if (d > jump) jump = d;
            l1 += d * f.area[k];
            tot += M[k * MASA_STRIDE] * f.area[k];
          }
          if (ti < 0.6) o.jumpEarly = Math.max(o.jumpEarly, jump); else o.jumpLate = Math.max(o.jumpLate, jump);
          if (tot > 0.02 * 4 / 3 * Math.PI * R ** 3) o.l1Max = Math.max(o.l1Max, l1 / tot);
          // wierzch masy opada od pierwszej klatki z prędkością rzędu prędkości spadku (bez „zatrzymania” kuli i bez
          // skoku); przy samym wlewaniu słupów lokalny grzbiet może stanąć o kilka procent promienia ponad kopułą
          if (ti < 0.3) { o.topDrop = Math.max(o.topDrop, prevTop - top); o.topRise = Math.max(o.topRise, top - prevTop); assert.ok(top < top0 + 0.05 * R, `wierzch masy (${top.toFixed(0)}) nie wyskakuje ponad wierzch kuli z chwili zetknięcia (${top0.toFixed(0)})`); }
        } else {
          prevMasa = new Float32Array(M.length);
          top0 = top;
          // pierwsza klatka pola: jego wierzch = wierzch kuli (kula i pole to w kadrze jedna bryła)
          assert.ok(Math.abs(top - (S[STAN.offY] + R * S[STAN.squash])) < 0.12 * R, `wierzch pola ${top.toFixed(0)} = wierzch kuli ${(S[STAN.offY] + R * S[STAN.squash]).toFixed(0)}`);
        }
        prevMasa.set(M);
        prevTop = top;
        // przebieg: czoło, fałda na ścianie, lustro nad gardzielą
        if (o.wallAt < 0 && S[STAN.frontR] > 505) o.wallAt = ti;
        if (o.wallAt >= 0 && o.wallLeftAt < 0 && S[STAN.foldY] <= F.rimY + 1e-9 && ti > o.wallAt + 0.3) o.wallLeftAt = ti;
        if (S[STAN.foldY] > o.foldMax) { o.foldMax = S[STAN.foldY]; o.foldAt = ti; }
        if (S[STAN.ballCols] === 0 && ti < PROCES.drainDelay && S[STAN.humpY] < o.midMin) { o.midMin = S[STAN.humpY]; o.midMinAt = ti; }
        if (o.midMinAt > 0 && ti > o.midMinAt && ti < PROCES.drainDelay + 0.8 && S[STAN.humpY] > o.humpMax) { o.humpMax = S[STAN.humpY]; o.humpAt = ti; }
        if (Math.abs(ti * 10 - Math.round(ti * 10)) < 0.09 && ti < 4.05) { o.fold.push(S[STAN.foldY]); o.mid.push(S[STAN.humpY]); }
        o.wetMax = Math.max(o.wetMax, S[STAN.levelMax]);
        assert.ok(S[STAN.massTop] < -KOMORA.mach.padY - 36 * KOMORA.mach.thick + 60 || ti < 0.35, 'masa nie sięga wysięgników dolnych cewek');
        // poziom (lustro w spoczynku) rośnie przy wlewaniu, potem tylko opada (dolewają go wracające krople)
        if (ti > 0.4 && S[STAN.level] > prevLevel + 1e-9) o.levelRises++;
        prevLevel = S[STAN.level];
        o.levelPeak = Math.max(o.levelPeak, S[STAN.level]);
        if (o.drainAt < 0 && C[LICZNIK.delivered] > 0) o.drainAt = ti;
        assert.ok(C[LICZNIK.delivered] - prevDelivered <= PROCES.drainRate * UNITS_PER_TON * DT + 2, 'gardziel oddaje najwyżej swoją wydajność');
        prevDelivered = C[LICZNIK.delivered];
        o.throatMax = Math.max(o.throatMax, S[STAN.throat]);
        o.funMax = Math.max(o.funMax, S[STAN.funHeat]);
        if (C[LICZNIK.funnel] === 0 && C[LICZNIK.metal] === 0 && o.emptyAt < 0) o.emptyAt = ti;
        o.dropTons = Math.max(o.dropTons, C[LICZNIK.drops] / UNITS_PER_TON);
        // drobny rozprysk: krople lecą balistycznie i wracają do masy (żadna nie wychodzi poza ścianę studni ani pod dno)
        const Dr = c.view.krople;
        for (let i = 0; i < c.view.nKrople; i++) {
          const q = i * 8;
          if (Dr[q + 7] < 0) continue;
          if (Math.hypot(Dr[q], Dr[q + 2]) > KOMORA.pitR - 4) o.dropsOutside++;
          if (Dr[q + 1] > o.maxDropY) o.maxDropY = Dr[q + 1];
          assert.ok(Dr[q + 1] > F.throatY - 60 && Number.isFinite(Dr[q + 3]) && Dr[q + 3] < 9, 'kropla drobna (promień < 9 j.)');
        }
        if (c.view.nKrople > 0) o.lastDropAt = ti;
      }
      if (c.view.nKrople > o.maxDrops) o.maxDrops = c.view.nKrople;
      if (c.view.nIskry > o.maxSparks) o.maxSparks = c.view.nIskry;
      assert.equal(c.audit().balance, 0);
      if (!full && S[STAN.impactT] > 4.1) break;
    }
    assert.ok(impactSeen);
    return { c, S, C, o, R, metal, rest, F };
  };

  const { c, S, C, o, R, metal, rest, F } = runDrop(7, true);
  assert.ok(o.stretchMin > 1.07 && o.stretchMax < 1.16, `wydłużenie w osi spadku ${((o.stretchMin - 1) * 100).toFixed(1)}–${((o.stretchMax - 1) * 100).toFixed(1)} %`);
  assert.ok(o.wobble > 0.015 && o.wobble <= BALL.limit + 1e-9, `falowanie w locie: odchylenie powierzchni do ${(o.wobble * 100).toFixed(1)} % promienia`);
  assert.ok(o.impactOff > 4 && o.impactOff < PROCES.swayMax + PROCES.dropDrift * 1.6, `uderzenie niesymetryczne: kula ${o.impactOff.toFixed(0)} j. od osi`);
  // KULA → POLE: cała kula jest polem od zetknięcia; jej kopuła (opadająca dalej jak ciało) tonie w polu w ułamku sekundy
  assert.ok(o.mergedAt > 0.08 && o.mergedAt < 0.7, `kopuła kuli (nad ${o.gap0} komórkami) zanurzona w polu po ${o.mergedAt.toFixed(2)} s`);
  // JEDNA MASA w każdym kroku
  assert.equal(o.partsMax, 1, 'masa w leju to w każdym kroku jeden spójny płat cieczy');
  assert.equal(o.partsMin, 1, 'dopóki w leju jest metal, płat cieczy istnieje (nie znika i nie rwie się)');
  // NIESYMETRIA I PRZELEWANIE (z symulacji, nie z zadanego kształtu): kula zniesiona z osi uderza bokiem — czoło masy
  // dochodzi do ściany po jednej stronie, gdy po przeciwnej jest jeszcze daleko; środek ciężkości masy przechodzi
  // potem na drugą stronę osi (masa przelewa się z boku na bok)
  assert.ok(o.impactOff > 30, `kula uderza ${o.impactOff.toFixed(0)} j. od osi leja`);
  assert.ok(o.frontSpread > 70, `czoło masy po kącie różni się o ${o.frontSpread.toFixed(0)} j. (jedna strona wyżej na ścianie)`);
  assert.ok(o.comBack < -6, `środek ciężkości masy przechodzi na przeciwną stronę osi o ${(-o.comBack).toFixed(0)} j.`);
  // GARB ODBICIA to szeroki wał, nie soczewka z rantem: lustro spada najwyżej o 60 j. na 4 pierścieniach siatki (56 j.)
  assert.ok(o.humpStep > 10 && o.humpStep < 60, `zbocze garbu: do ${o.humpStep.toFixed(0)} j. na 4 pierścieniach siatki`);
  // JEZIORO MA BRZEG I MALEJE: promień warstwy rysowanej jako ciecz kurczy się ze spływem (nie stoi przy ścianie do końca)
  assert.ok(MASS_EDGE.h >= 3 && MASS_EDGE.h <= 10 && MASS_EDGE.hThroat < MASS_EDGE.h);
  assert.ok(o.lakeAtThird > 0.4 * KOMORA.pitR && o.lakeAtThird < 0.66 * KOMORA.pitR, `jezioro przy 1/3 metalu: promień ${o.lakeAtThird.toFixed(0)} j. (${(o.lakeAtThird / KOMORA.pitR * 100).toFixed(0)} % studni)`);
  assert.ok(o.lakeAtTenth < o.lakeAtThird - 40 && o.lakeAtTenth < 0.52 * KOMORA.pitR, `jezioro przy 1/10 metalu: promień ${o.lakeAtTenth.toFixed(0)} j.`);
  assert.equal(o.lakeGrows, 0, 'przy spływie jezioro tylko maleje');
  // CIĄGŁOŚĆ: przesuwające się czoło masy zmienia grubość komórki najwyżej o wysokość czoła (ułamek promienia kuli),
  // po rozpłynięciu — o kilka jednostek; cała powierzchnia zmienia się między krokami o kilka procent
  // (uderzenie bokiem: po stronie styku czoło jest najwyższe, a nad świeżo zalaną komórką narasta jeszcze brzeg
  // rozszerzającej się kopuły — stąd 0,65 promienia)
  assert.ok(o.jumpEarly < 0.65 * R && o.jumpLate < 14, `grubość rysowana bez skoków: do ${o.jumpEarly.toFixed(0)} j. na krok w pierwszych 0,6 s, potem do ${o.jumpLate.toFixed(1)} j.`);
  assert.ok(o.l1Max < 0.1, `pole zmienia się między krokami najwyżej o ${(o.l1Max * 100).toFixed(1)} % objętości`);
  assert.ok(o.topDrop > 0.5 * o.impactV * DT && o.topDrop < 5 * o.impactV * DT && o.topRise < 0.12 * R, `wierzch masy opada do ${o.topDrop.toFixed(1)} j. na krok (prędkość spadku ${(o.impactV * DT).toFixed(1)} j. na krok), lokalny grzbiet do +${o.topRise.toFixed(1)} j.`);
  // FAŁDA: brzeg masy dojeżdża po stożku do ściany studni i wjeżdża po niej WYŻEJ niż lustro w spoczynku, potem wraca
  assert.ok(o.wallAt > 0.4 && o.wallAt < 1.2, `czoło masy przy ścianie po ${o.wallAt.toFixed(2)} s`);
  assert.ok(o.foldMax > rest + 100 && o.foldMax > F.rimY + 30, `fałda na ścianie do y = ${o.foldMax.toFixed(0)} (lustro w spoczynku ${rest.toFixed(0)}, obrzeże leja ${F.rimY})`);
  assert.ok(o.foldMax < -KOMORA.mach.padY - 36 * KOMORA.mach.thick, `fałda zostaje pod stopami dolnych wysięgników (${(-KOMORA.mach.padY - 36 * KOMORA.mach.thick).toFixed(0)})`);
  assert.ok(o.wallLeftAt > o.foldAt && o.wallLeftAt < 3.2, `fałda wraca: ściana wolna po ${o.wallLeftAt.toFixed(2)} s`);
  assert.ok(o.wetMax > F.rimY - 10, 'wykładzina zwilżona do samego obrzeża');
  // GARB ODBICIA: lustro nad gardzielą opada głęboko pod poziom spoczynkowy (masa poszła na ściany), po czym wraca
  // i odbija WYŻEJ niż poziom spoczynkowy — gruby garb w środku
  assert.ok(o.midMin < rest - 70 && o.midMinAt > 0.7 && o.midMinAt < 1.8, `środek najniżej ${(o.midMin - rest).toFixed(0)} j. pod poziomem po ${o.midMinAt.toFixed(2)} s`);
  assert.ok(o.humpMax > rest + 35 && o.humpAt > o.midMinAt + 0.8 && o.humpAt < 3.4, `garb odbicia ${(o.humpMax - rest).toFixed(0)} j. nad poziomem po ${o.humpAt.toFixed(2)} s`);
  // lej na całe dno: lustro w spoczynku stoi wyraźnie poniżej obrzeża (ściany studni), ale wypełnia większość stożka
  assert.ok(o.levelPeak > F.rimY - 150 && o.levelPeak < F.rimY - 60, `jezioro po wlaniu: poziom ${o.levelPeak.toFixed(0)} (obrzeże ${F.rimY})`);
  assert.ok(funnelRadiusAt(o.levelPeak) > 1.4 * R, `jezioro szersze od kuli: promień ${funnelRadiusAt(o.levelPeak).toFixed(0)} j.`);
  assert.ok(o.levelRises < 120, `poziom w leju opada (dolewają go tylko wracające krople; wzrostów ${o.levelRises})`);
  // DROBNY ROZPRYSK: nie więcej niż przed rundą 4 (76 kropel, 90 iskier), łącznie mała masa; z widoku z góry dodatek
  assert.ok(o.maxDrops >= 20 && o.maxDrops <= 76 && o.maxSparks >= 40 && o.maxSparks <= 96, `rozprysk: ${o.maxDrops} kropel, ${o.maxSparks} iskier naraz`);
  assert.ok(o.dropTons > 0.5 && o.dropTons < 0.03 * METAL_TONS, `w kroplach najwyżej ${o.dropTons.toFixed(1)} t (${(o.dropTons / METAL_TONS * 100).toFixed(1)} % masy)`);
  assert.ok(o.lastDropAt < 3.5, `ostatnia kropla wraca do masy ${o.lastDropAt.toFixed(2)} s po zetknięciu`);
  assert.equal(o.dropsOutside, 0, 'krople zostają w studni');
  assert.ok(o.throatMax > 0.95 && o.funMax > 0.95, 'gardziel i ściany leja rozżarzone przy spływie');
  // SPŁYW: gardziel otwiera się po odbiciu garbu; CAŁOŚĆ spływa gardzielą w skończonym czasie
  assert.ok(Math.abs(o.drainAt - PROCES.drainDelay) < 0.25, `gardziel otwarta ${o.drainAt.toFixed(2)} s po zetknięciu`);
  assert.ok(o.emptyAt > PROCES.drainDelay + METAL_TONS / PROCES.drainRate && o.emptyAt < PROCES.drainDelay + METAL_TONS / PROCES.drainRate + 4.5, `metal spływa gardzielą do ${o.emptyAt.toFixed(1)} s po zetknięciu`);
  // po zrzucie: wszystko oddane, komora pusta, grawitacja wyłączona, pole wyzerowane, lej stygnie jeszcze przez następną fazę
  assert.equal(c.phase, PHASE.EMPTY);
  assert.equal(C[LICZNIK.delivered], metal);
  assert.equal(C[LICZNIK.funnel] + C[LICZNIK.drops] + C[LICZNIK.metal], 0);
  assert.equal(c.radius, 0);
  assert.equal(S[STAN.grav], 0);
  assert.equal(c.view.masaOn, 0);
  for (let k = 0; k < MASA_CELLS; k++) assert.equal(c.field.h[k], 0);
  assert.ok(S[STAN.offX] === 0 && S[STAN.offY] === 0 && S[STAN.offZ] === 0 && S[STAN.pool] === 0 && S[STAN.squash] === 1);
  const throat0 = S[STAN.throat];
  const fun0 = S[STAN.funHeat];
  assert.ok(throat0 > 0.4 && fun0 > 0.3, 'po zrzucie gardziel jeszcze świeci');
  for (let k = 0; k < 8 * 60; k++) c.step(DT);
  assert.ok(S[STAN.throat] < throat0 * 0.4 && S[STAN.funHeat] < fun0 * 0.2, 'lej stygnie');

  // RÓŻNE ZIARNA — RÓŻNY PRZEBIEG (uderzenie niesymetryczne, kula faluje w locie): inna fałda, inne lustro nad gardzielą
  const b = runDrop(19, false).o;
  assert.equal(b.partsMax, 1);
  let dFold = 0;
  let dMid = 0;
  for (let k = 0; k < Math.min(o.fold.length, b.fold.length); k++) { dFold = Math.max(dFold, Math.abs(o.fold[k] - b.fold[k])); dMid = Math.max(dMid, Math.abs(o.mid[k] - b.mid[k])); }
  assert.ok(dFold > 8 && dMid > 1.5, `przebieg zależy od ziarna: fałda różni się do ${dFold.toFixed(0)} j., lustro nad gardzielą do ${dMid.toFixed(1)} j.`);
  assert.ok(Math.abs(b.foldMax - o.foldMax) > 1 || Math.abs(b.wallAt - o.wallAt) > 0.01);
});

test('wytop: MASA W LEJU — pole grubości: masa zachowana, grubość nieujemna, bez osi wyróżnionej kula rozlewa się symetrycznie, kołysanie gaśnie w skończonym czasie', () => {
  assert.ok(MASA_CELLS === MASA.nr * MASA.na + 1 && MASA.nr >= 24 && MASA.na >= 32 && MASA.na % 2 === 0, `siatka ${MASA.nr} × ${MASA.na}`);
  const F = KOMORA.funnel;
  const R = R_CLEAN;
  const vol = 4 / 3 * Math.PI * R ** 3;
  const rest = funnelLevelOf(vol);
  const drop = (off, drift, modes) => {
    const modeA = new Float64Array(MODES);
    if (modes) { modeA[2] = 0.02; modeA[0] = 0.015; }
    const f = createFunnelField(modeA);
    const P = f.P;
    // dno pola = stożek leja (komórki pierścieni) i krąg nad gardzielą
    for (let j = 0; j < f.nr; j++) assert.ok(Math.abs(f.zb[j * f.na] - funnelFloorAt(f.rc[j])) < 1e-9);
    assert.equal(f.zb[f.center], F.throatY);
    let area = 0;
    for (let k = 0; k < MASA_CELLS; k++) area += f.area[k];
    assert.ok(Math.abs(area - Math.PI * KOMORA.pitR ** 2) < 1e-6 * area, 'komórki pokrywają całe dno komory');
    let by = funnelContactY(R) + off / funnelSlope() * 0 + off * funnelSlope();
    let v = Math.sqrt(2 * PROCES.gravity * -by);
    P[MP.g] = PROCES.gravity; P[MP.bx] = off; P[MP.bz] = 0; P[MP.vbx] = drift; P[MP.vbz] = 0;
    P[MP.R] = R; P[MP.sy] = 1; P[MP.sxz] = 1; P[MP.tail] = 0; P[MP.ballVol] = vol; P[MP.by] = by; P[MP.vFall] = v;
    f.loadBall();
    assert.ok(f.ballLeft > 300, `kula rozpisana na ${f.ballLeft} słupów`);
    let sum = 0;
    for (let k = 0; k < MASA_CELLS; k++) sum += f.chord[k] * f.area[k];
    assert.ok(Math.abs(sum - vol) < 1e-6 * vol, 'objętość słupów = objętość kuli');
    const h = 1 / 120;
    const out = { rough: [], edgeMax: -Infinity, asym: 0, negative: 0, volErr: 0, jump: 0 };
    let bx = off;
    for (let k = 0; k < 120 * 7; k++) {
      const t = (k + 1) * h;
      if (f.ballLeft > 0) { v += PROCES.gravity * h; by -= v * h; bx += drift * h; }
      P[MP.dt] = h / MASA.steps; P[MP.bx] = bx; P[MP.by] = by; P[MP.vFall] = v; P[MP.swirl] = 0;
      let q = (t - PROCES.thickFrom) / (PROCES.thickTo - PROCES.thickFrom);
      q = q <= 0 ? 0 : q >= 1 ? 1 : q * q * (3 - 2 * q);
      P[MP.thick] = q;
      for (let s2 = 0; s2 < MASA.steps; s2++) {
        f.step();
        if (t > 0.6 && P[MP.jump] > out.jump) out.jump = P[MP.jump];
      }
      // masa zachowana przez sam krok pola (bez normalizacji): objętość pola = objętość wlana
      let fv = 0;
      for (let c2 = 0; c2 < MASA_CELLS; c2++) { fv += f.h[c2] * f.area[c2]; if (!(f.h[c2] >= 0)) out.negative++; }
      out.volErr = Math.max(out.volErr, Math.abs(fv - P[MP.moved]) / vol);
      P[MP.target] = P[MP.moved];
      f.normalize();
      if (P[MP.edge] > out.edgeMax) out.edgeMax = P[MP.edge];
      // niesymetria: różnica lustra po przeciwnych stronach (pierścień w 2/3 promienia)
      const j = Math.round(f.nr * 0.6);
      for (let i = 0; i < f.na / 2; i++) out.asym = Math.max(out.asym, Math.abs(f.h[j * f.na + i] - f.h[j * f.na + i + f.na / 2]));
      if (k % 12 === 11) out.rough.push(P[MP.rough]);
    }
    assert.equal(f.ballLeft, 0);
    return out;
  };
  // kula w osi, bez znosu i bez falowania: masa rozlewa się symetrycznie (pole nie wyróżnia żadnego kierunku)
  const sym = drop(0, 0, false);
  assert.equal(sym.negative, 0, 'grubość warstwy nigdy ujemna');
  assert.ok(sym.volErr < 1e-9, `krok pola zachowuje objętość (błąd względny ${sym.volErr.toExponential(1)})`);
  assert.ok(sym.asym < 1e-6, `uderzenie w osi daje przebieg symetryczny (różnica stron ${sym.asym.toExponential(1)} j.)`);
  assert.ok(sym.edgeMax > rest + 80, `fałda wjeżdża po ścianie do y = ${sym.edgeMax.toFixed(0)} (spoczynek ${rest.toFixed(0)})`);
  assert.ok(sym.jump < 6, `po rozpłynięciu grubość komórki zmienia się najwyżej o ${sym.jump.toFixed(2)} j. na krok pola`);
  // kołysanie GAŚNIE: nierówność lustra (odchylenie od płaskiego jeziora) maleje do małego ułamka szczytu w 4 s i zostaje mała
  const peak = Math.max(...sym.rough.slice(0, 30));
  const at = (sec) => sym.rough[Math.round(sec * 10) - 1];
  assert.ok(peak > 35, `nierówność lustra po uderzeniu do ${peak.toFixed(0)} j.`);
  assert.ok(at(4) < 0.25 * peak && Math.max(...sym.rough.slice(45)) < 0.2 * peak && at(7) < 0.08 * peak, `uspokojenie: nierówność ${at(1).toFixed(0)} → ${at(2).toFixed(0)} → ${at(3).toFixed(0)} → ${at(4).toFixed(0)} → ${at(7).toFixed(1)} j. (po 1, 2, 3, 4, 7 s)`);
  // kula zniesiona z osi, ze znosem i falowaniem: masa przelewa się z boku na bok (wyraźna różnica stron), też gaśnie
  const skew = drop(30, 36, true);
  assert.equal(skew.negative, 0);
  assert.ok(skew.asym > 20, `uderzenie niesymetryczne: różnica lustra po przeciwnych stronach do ${skew.asym.toFixed(0)} j.`);
  assert.ok(skew.rough[69] < 0.1 * Math.max(...skew.rough.slice(0, 30)), 'przelewanie z boku na bok gaśnie');
  assert.ok(skew.volErr < 1e-9);
});

test('wytop: WYŚWIETLACZ GRAWITACJI — szewrony krążą → stają → obracają się w dół → płyną w dół → wracają; kula nie spada przed stanem „w dół”', () => {
  const D = KOMORA.display;
  // wzór szewronu (ten sam liczy shader): przy obiegu grot wskazuje kierunek obiegu (+cu), po obrocie — dół lica (+cv)
  const centroid = (turn) => {
    let sx = 0; let sy = 0; let n = 0;
    for (let i = -60; i <= 60; i++) for (let j = -60; j <= 60; j++) {
      const m = chevronAt(i / 120, j / 120, turn);
      if (m > 0) { sx += m * i / 120; sy += m * j / 120; n += m; }
    }
    return { x: sx / n, y: sy / n, n };
  };
  const tip = (turn) => {
    // najdalszy świecący punkt wzdłuż osi grota
    let best = -1; let bx = 0; let by = 0;
    const a = turn * Math.PI / 2;
    for (let i = -60; i <= 60; i++) for (let j = -60; j <= 60; j++) {
      if (chevronAt(i / 120, j / 120, turn) < 0.5) continue;
      const along = i / 120 * Math.cos(a) + j / 120 * Math.sin(a);
      if (along > best) { best = along; bx = i / 120; by = j / 120; }
    }
    return [bx, by];
  };
  const t0 = tip(0);
  const t1 = tip(1);
  assert.ok(t0[0] > 0.3 && Math.abs(t0[1]) < 0.06, `obieg: grot ku kierunkowi obiegu (${t0.map((v) => v.toFixed(2))})`);
  assert.ok(t1[1] > 0.3 && Math.abs(t1[0]) < 0.06, `grawitacja: grot w dół lica (${t1.map((v) => v.toFixed(2))})`);
  // szewron mieści się w komórce i w obrocie nie wychodzi poza koło o promieniu 0,5 (obrót w miejscu, bez przycięcia)
  for (const turn of [0, 0.25, 0.5, 0.75, 1]) {
    for (let k = 0; k < 360; k += 3) { const an = k * Math.PI / 180; assert.equal(chevronAt(0.5 * Math.cos(an), 0.5 * Math.sin(an), turn), 0, 'brzeg koła komórki ciemny'); }
    const cc = centroid(turn);
    assert.ok(cc.n > 300 && Math.hypot(cc.x, cc.y) < 0.12, 'szewron pośrodku komórki');
  }
  assert.ok(CHEVRON.arm < 0.5 && CHEVRON.off.length === 2);
  // symulacja: kolejność trybów, ciągłość (bez skoków), grawitacja i spadek dopiero w trybie „w dół”
  const c = createMeltChamber({ seed: 13 });
  const S = c.view.stan;
  assert.equal(S[STAN.dsp], DSP.RUN);
  runTo(c, PHASE.CLEAR);
  const seq = [];
  const at = {};
  let prev = S[STAN.dsp];
  let prevU = S[STAN.dspU];
  let prevV = S[STAN.dspV];
  let prevTurn = S[STAN.dspTurn];
  let prevSpeed = S[STAN.dspSpeed];
  let maxDTurn = 0;
  let maxDSpeed = 0;
  let uInStop = 0;
  let vBeforeDown = 0;
  let releasedIn = -1;
  let gravIn = -1;
  let gateInDrop = 0;
  let vAtSettleEnd = NaN;
  let steps = 0;
  const cells = D.cells * D.speed;                    // komórek na sekundę przy pełnym obiegu
  while (!(c.phase === PHASE.GATHER && S[STAN.dsp] === DSP.RUN && S[STAN.dspSpeed] === 1) && steps++ < 60 * 60) {
    c.step(DT);
    const md = S[STAN.dsp];
    const t = S[STAN.time];
    if (md !== prev) { seq.push(md); at[md] = t; if (prev === DSP.SETTLE) vAtSettleEnd = S[STAN.dspV]; }
    // fazy tylko rosną; obieg idzie z prędkością `speed`, spływ tylko w trybie „w dół” i przy wyhamowaniu
    const du = S[STAN.dspU] - prevU;
    const dv = S[STAN.dspV] - prevV;
    assert.ok(du >= -1e-12 && du <= cells * DT + 1e-9, 'faza obiegu rośnie najwyżej z pełną prędkością');
    assert.ok(dv >= -1e-12 && dv <= D.flow * DT + 1e-9, 'faza spływu rośnie najwyżej z pełną prędkością');
    if (md === DSP.HOLD || md === DSP.TURN || md === DSP.DOWN || md === DSP.BACK) { if (prev === md) assert.equal(du, 0, `tryb ${DSP_NAMES[md]}: szewrony nie krążą`); }
    if (md === DSP.STOP) uInStop += du;
    if (md === DSP.RUN || md === DSP.STOP || md === DSP.HOLD || md === DSP.TURN) vBeforeDown += Math.abs(dv);
    // przejścia animowane: obrót i prędkość zmieniają się małymi krokami
    maxDTurn = Math.max(maxDTurn, Math.abs(S[STAN.dspTurn] - prevTurn));
    maxDSpeed = Math.max(maxDSpeed, Math.abs(S[STAN.dspSpeed] - prevSpeed));
    assert.ok(S[STAN.dspTurn] >= 0 && S[STAN.dspTurn] <= 1 && S[STAN.dspSpeed] >= 0 && S[STAN.dspSpeed] <= 1 && S[STAN.dspFlow] >= 0 && S[STAN.dspFlow] <= 1);
    // grawitacja = tryb „w dół”; kula zwalniana dopiero w nim (po `dropDelay`)
    assert.equal(S[STAN.grav], md === DSP.DOWN ? 1 : 0);
    if (S[STAN.grav] && gravIn < 0) gravIn = t;
    if (S[STAN.fallT] >= 0 && releasedIn < 0) { releasedIn = t; assert.equal(md, DSP.DOWN, 'kula spada dopiero, gdy szewrony płyną w dół'); assert.equal(S[STAN.dspTurn], 1); assert.ok(S[STAN.dspFlow] > 0.5, 'szewrony już płyną w dół'); }
    if (md !== DSP.DOWN && c.phase === PHASE.DROP) { assert.equal(S[STAN.fallT], -1, 'przed trybem „w dół” kula wisi'); assert.ok(Math.abs(S[STAN.offY]) < PROCES.swayMax + 1e-9); }
    if (c.phase === PHASE.DROP && S[STAN.gate]) gateInDrop++;
    if (md !== DSP.RUN) assert.equal(S[STAN.gate], 0, 'brama 0 g zamknięta, gdy szewrony nie krążą');
    prev = md;
    prevU = S[STAN.dspU];
    prevV = S[STAN.dspV];
    prevTurn = S[STAN.dspTurn];
    prevSpeed = S[STAN.dspSpeed];
  }
  assert.deepEqual(seq, [DSP.STOP, DSP.HOLD, DSP.TURN, DSP.DOWN, DSP.SETTLE, DSP.BACK, DSP.RUN], 'krążą → stają → postój → obrót w dół → w dół → wyhamowanie → obrót powrotny → krążą');
  assert.ok(Math.abs(at[DSP.HOLD] - at[DSP.STOP] - D.stop) < 2 * DT && Math.abs(at[DSP.TURN] - at[DSP.HOLD] - D.hold) < 2 * DT && Math.abs(at[DSP.DOWN] - at[DSP.TURN] - D.turn) < 2 * DT, 'czasy przejść z tabeli wyświetlacza');
  assert.ok(Math.abs(gravIn - at[DSP.DOWN]) < 2 * DT && Math.abs(releasedIn - gravIn - PROCES.dropDelay) < 2 * DT, `grawitacja z trybem „w dół”, kula zwolniona ${(releasedIn - gravIn).toFixed(2)} s później`);
  assert.ok(maxDTurn < 0.06 && maxDSpeed < 0.07, `przejścia płynne: obrót najwyżej ${maxDTurn.toFixed(3)} na krok, prędkość ${maxDSpeed.toFixed(3)}`);
  assert.ok(uInStop > 0.2 && uInStop < cells * D.stop, `przy hamowaniu szewrony dojeżdżają jeszcze ${uInStop.toFixed(2)} komórki`);
  assert.equal(vBeforeDown, 0, 'przed trybem „w dół” szewrony nie spływają');
  assert.equal(gateInDrop, 0);
  // po zrzucie spływ staje dokładnie w środku komórki (faza całkowita): obrót powrotny bez uciętego szewronu
  assert.ok(Math.abs(vAtSettleEnd - Math.round(vAtSettleEnd)) < 1e-9 && vAtSettleEnd > 3, `spływ stanął na fazie ${vAtSettleEnd}`);
  assert.ok(at[DSP.RUN] - at[DSP.SETTLE] < 2.3, `powrót do obiegu po ${(at[DSP.RUN] - at[DSP.SETTLE]).toFixed(2)} s`);
  assert.equal(S[STAN.dspTurn], 0);
  assert.equal(c.audit().balance, 0);
});

test('wytop: ZASYSANIE — gardziel ciągnie przez cały spływ: obrót pola przy gardzieli, wgłębienie rośnie z opadaniem poziomu', () => {
  assert.ok(VORTEX.floor > 0.2 && VORTEX.floor < 0.6 && VORTEX.radius > 1 && MASA.swirlV > 100);
  const c = createMeltChamber({ seed: 7 });
  const S = c.view.stan;
  const C = c.counters;
  const F = KOMORA.funnel;
  const f = c.field;
  runTo(c, PHASE.DROP);
  let drainSteps = 0;
  let weak = 0;
  let prevTwist = 0;
  let twistBack = 0;
  let peak = 0;
  let before = 0;
  let beforeDimple = 0;
  let swirlMin = Infinity;
  const early = [];
  const late = [];
  const fullOpen = PROCES.drainDelay + PROCES.drainRamp;
  while (c.phase === PHASE.DROP) {
    c.step(DT);
    if (c.phase !== PHASE.DROP) break;
    const ti = S[STAN.impactT];
    const k = S[STAN.vortex];
    assert.ok(k >= 0 && k <= 1 && S[STAN.dimple] >= 0 && S[STAN.dimple] <= VORTEX.dimpleMax + 1e-9 && Number.isFinite(S[STAN.twist]));
    if (ti < 0) { before = Math.max(before, k); continue; }
    peak = Math.max(peak, C[LICZNIK.funnel]);
    assert.ok(Math.abs(S[STAN.lakeR] - Math.max(F.throatR, funnelRadiusAt(S[STAN.level]))) < 1e-6 || C[LICZNIK.funnel] === 0);
    if (ti < PROCES.drainDelay - 2 * DT) { before = Math.max(before, k); beforeDimple = Math.max(beforeDimple, S[STAN.dimple]); assert.equal(C[LICZNIK.delivered], 0, 'przed otwarciem gardzieli nic nie spływa'); }
    if (S[STAN.twist] < prevTwist - 1e-12) twistBack++;
    prevTwist = S[STAN.twist];
    // CAŁY spływ: od pełnego otwarcia gardzieli (+ 0,4 s rozbiegu wiru) do ostatnich 3 t metalu w leju
    if (ti > fullOpen + 0.4 && C[LICZNIK.funnel] > 3 * UNITS_PER_TON) {
      drainSteps++;
      if (k < VORTEX.floor - 1e-9) weak++;
      // obrót pola: ciecz przy gardzieli naprawdę wiruje w jedną stronę (kręt = średnia prędkość obwodowa × promień,
      // największy z pierścieni przy gardzieli; odniesiony do promienia gardzieli)
      let circ = 0;
      for (let j = 0; j < 8; j++) { let ut = 0; for (let i = 0; i < f.na; i++) ut += f.ut[j * f.na + i]; circ = Math.max(circ, ut / f.na * f.rc[j]); }
      if (C[LICZNIK.funnel] > 30 * UNITS_PER_TON) swirlMin = Math.min(swirlMin, circ / f.r0);
      // wgłębienie = lustro wokół gardzieli − lustro nad gardzielą (z pola)
      const tons = C[LICZNIK.funnel] / UNITS_PER_TON;
      if (tons > 0.72 * METAL_TONS && tons < 0.9 * METAL_TONS) early.push(S[STAN.dimple]);
      if (tons > 0.2 * METAL_TONS && tons < 0.38 * METAL_TONS) late.push(S[STAN.dimple]);
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.equal(before, 0, 'przed otwarciem gardzieli wiru nie ma');
  assert.equal(beforeDimple, 0);
  assert.ok(peak > 0.9 * METAL_TONS * UNITS_PER_TON);
  assert.ok(drainSteps > 300, `spływ trwa ${(drainSteps / 60).toFixed(1)} s`);
  assert.equal(weak, 0, `zasysanie aktywne przez cały spływ (siła wiru ≥ ${VORTEX.floor})`);
  assert.ok(swirlMin > 0.25 * MASA.swirlV, `ciecz przy gardzieli wiruje (najwolniej ${swirlMin.toFixed(0)} j./s)`);
  assert.equal(twistBack, 0, 'skręcenie powierzchni tylko narasta');
  assert.ok(prevTwist > 6.5, `powierzchnia przy gardzieli obróciła się o ${prevTwist.toFixed(1)} rad (ponad obrót)`);
  assert.ok(early.length > 30 && late.length > 30 && mean(early) > 25 && mean(late) > 1.2 * mean(early), `wgłębienie rośnie z opadaniem poziomu: ${mean(early).toFixed(0)} → ${mean(late).toFixed(0)} j.`);
  // po zrzucie wir gaśnie
  assert.equal(S[STAN.vortex], 0);
  assert.equal(S[STAN.dimple], 0);
});

test('wytop: CEWKI — klatka współśrodkowa z bryłą: segmenty na stałej szerokości kątowej, odstęp od powierzchni dodatni w całym obiegu (górny i dolny pierścień)', () => {
  const M = KOMORA.mach;
  for (const seed of [7, 3]) {
    const c = createMeltChamber({ seed });
    const S = c.view.stan;
    const min = {};
    let latErr = 0;
    let engaged = 0;
    let cageErr = 0;
    let smallY = Infinity;
    let prevR = S[STAN.mach];
    let prevY = S[STAN.machY];
    let maxStep = 0;
    while (c.counters[LICZNIK.cycles] < 1) {
      c.step(DT);
      const p = S[STAN.phase];
      const g = c.coilGap();
      const name = PHASE_NAMES[p];
      const o = min[name] || (min[name] = { upper: Infinity, lower: Infinity });
      if (g.upper < o.upper) o.upper = g.upper;
      if (g.lower < o.lower) o.lower = g.lower;
      assert.ok(S[STAN.mach] >= M.rMin - 1e-9 && S[STAN.mach] <= M.rOut + 1e-9 && S[STAN.machY] > 60 && S[STAN.machY] <= M.padY + 1e-9, 'segmenty w zakresie ruchu wysięgnika i prowadnicy');
      maxStep = Math.max(maxStep, Math.abs(S[STAN.mach] - prevR), Math.abs(S[STAN.machY] - prevY));
      prevR = S[STAN.mach];
      prevY = S[STAN.machY];
      // klatka idzie za środkiem bryły, gdy ją trzyma; przy odsuwie i zrzucie stoi na osi komory (nie spada z kulą)
      if (p === PHASE.FEED || p === PHASE.REFINE) cageErr = Math.max(cageErr, Math.hypot(S[STAN.cageX] - S[STAN.offX], S[STAN.cageY] - S[STAN.offY], S[STAN.cageZ] - S[STAN.offZ]));
      if (p === PHASE.DROP) assert.ok(Math.hypot(S[STAN.cageX], S[STAN.cageY], S[STAN.cageZ]) < PROCES.swayMax + 1e-6, 'przy zrzucie klatka nie idzie za spadającą kulą');
      // dokarmianie i rafinacja (segmenty dojechały do kuli): oś segmentu na stałej szerokości kątowej nad i pod równikiem,
      // w odległości promień + odstęp + wysięg osprzętu
      if ((p === PHASE.FEED && S[STAN.phaseT] > 4) || p === PHASE.REFINE) {
        engaged++;
        const d = Math.hypot(S[STAN.mach], S[STAN.machY]);
        const want = c.radius + M.gap + M.reach;
        if (d < want + 6) latErr = Math.max(latErr, Math.abs(Math.atan2(S[STAN.machY], S[STAN.mach]) * 180 / Math.PI - M.lat));
        assert.ok(d > want - 22, `segment nie bliżej niż odstęp (oś ${d.toFixed(0)} j. od środka, kula ${c.radius.toFixed(0)})`);
        if (p === PHASE.FEED && S[STAN.phaseT] < 6) smallY = Math.min(smallY, S[STAN.machY]);
      }
    }
    assert.ok(engaged > 1500);
    assert.ok(latErr < 2.5, `segmenty na szerokości ${M.lat}° ± ${latErr.toFixed(2)}° (nad i pod równikiem jednakowo)`);
    assert.ok(smallY < M.padY - 25, `przy małej kuli segmenty zjechały prowadnicą ku równikowi (oś na ${smallY.toFixed(0)} z ${M.padY})`);
    assert.ok(cageErr < 6, `środek klatki idzie za środkiem kuli (odchyłka do ${cageErr.toFixed(1)} j.)`);
    assert.ok(maxStep < 3.2, `segmenty jadą płynnie (najwięcej ${maxStep.toFixed(2)} j. na krok)`);
    // odstęp segment ↔ powierzchnia (z falowaniem kuli, największym uniesieniem żużla i kołysaniem w polu) > 0 w każdej fazie
    for (const [name, o] of Object.entries(min)) {
      if (!Number.isFinite(o.upper)) continue;
      assert.ok(o.upper > 4 && o.lower > 4, `faza ${name}: najmniejszy odstęp cewki ↔ bryła: górny pierścień ${o.upper.toFixed(1)} j., dolny ${o.lower.toFixed(1)} j.`);
    }
    for (const name of ['dokarmianie', 'rafinacja']) assert.ok(min[name].upper < M.gap + 1 && Math.abs(min[name].upper - min[name].lower) < 8, `faza ${name}: pierścienie symetryczne (${min[name].upper.toFixed(1)} / ${min[name].lower.toFixed(1)} j.)`);
  }
});

test('wytop: krople odrywają się przy dokarmianiu i wracają do kuli; tryb ręczny czeka na zgodę na zrzut (kula wisi w 0 g)', () => {
  const c = createMeltChamber({ seed: 21, auto: false });
  const S = c.view.stan;
  const C = c.counters;
  let maxDrops = 0;
  let maxSparks = 0;
  runTo(c, PHASE.FEED);
  const made0 = C[LICZNIK.dropsMade];
  while (c.phase === PHASE.FEED) {
    c.step(DT);
    if (C[LICZNIK.drops] > maxDrops) maxDrops = C[LICZNIK.drops];
    if (c.view.nIskry > maxSparks) maxSparks = c.view.nIskry;
  }
  assert.ok(C[LICZNIK.dropsMade] - made0 > 40, `kropli przy dokarmianiu: ${C[LICZNIK.dropsMade] - made0}`);
  assert.ok(maxDrops > 0 && maxSparks > 0 && maxSparks < POOL.sparks);
  // tryb ręczny: po rafinacji gotowość, ale bez `tap()` komora nie zrzuca — kula wisi w 0 g, maszyneria przy niej
  let ready = 0;
  c.onReady = (tons) => { ready++; assert.equal(tons, METAL_TONS); };
  for (let k = 0; k < 60 * 60; k++) c.step(DT);
  assert.equal(ready, 1);
  assert.equal(S[STAN.phase], PHASE.REFINE);
  assert.equal(S[STAN.waiting], 1);
  assert.equal(S[STAN.grav], 0);
  assert.equal(C[LICZNIK.drops], 0);
  assert.equal(c.view.nKrople, 0);
  assert.equal(c.view.nIskry, 0);
  assert.ok(S[STAN.mach] < KOMORA.mach.rOut - 100 && Math.abs(c.radius - R_CLEAN) < 0.5);
  assert.equal(S[STAN.dsp], DSP.RUN, 'bez zgody na zrzut szewrony dalej krążą');
  c.tap();
  for (let k = 0; k < 2 * 60; k++) c.step(DT);
  assert.equal(S[STAN.phase], PHASE.CLEAR, 'po zgodzie maszyneria odjeżdża');
  runTo(c, PHASE.EMPTY, 40);
  assert.equal(C[LICZNIK.delivered], METAL_TONS * UNITS_PER_TON);
  assert.equal(c.audit().balance, 0);
});

test('wytop: styk — wsad przez feed() bez wbudowanego podajnika (acceptsFeed); rozbieg strony zostawia cykl w toku', () => {
  const c = createMeltChamber({ seed: 2, feeder: false });
  const C = c.counters;
  for (let k = 0; k < 5 * 60; k++) c.step(DT);
  assert.equal(C[LICZNIK.fed], 0);
  assert.equal(c.phase, PHASE.EMPTY);
  assert.ok(c.acceptsFeed);
  // 30 t rudy w paczkach co krok (podajnik pyta komorę, czy taśma jedzie)
  let left = 30 * GRAIN.perTon;
  const traits = new Uint8Array(64).fill(37);
  let guard = 0;
  while (left > 0 && guard++ < 60 * 120) {
    if (c.acceptsFeed) {
      const n = Math.min(16, left);
      assert.equal(c.feed(n, traits), n);
      left -= n;
    }
    c.step(DT);
    assert.equal(c.audit().balance, 0);
  }
  assert.equal(left, 0);
  runTo(c, PHASE.DROP, 120);
  runTo(c, PHASE.EMPTY, 40);
  assert.equal(C[LICZNIK.fed], 30 * GRAIN.perTon);
  assert.equal(C[LICZNIK.lodged], 30 * GRAIN.perTon, 'cały wsad zewnętrzny zebrał się w kupę');
  assert.equal(C[LICZNIK.delivered], 20 * UNITS_PER_TON, '30 t rudy → 20 t metalu');
  assert.equal(C[LICZNIK.slagCatcher] + C[LICZNIK.slagOut] + C[LICZNIK.slagThread], 10 * SLAG_EQ_PER_TON);
  assert.equal(c.audit().balance, 0);
  // wsad większy niż kupa: nadwyżka czeka na taśmie przed zamkniętą bramą i wtapia się w kulę przy dokarmianiu
  const e = createMeltChamber({ seed: 3, feeder: false });
  let rest = 180 * GRAIN.perTon;
  let waited = 0;
  guard = 0;
  let first = HEAP_GRAINS;
  while ((rest > 0 || e.counters[LICZNIK.cycles] < 1) && guard++ < 60 * 400) {
    // najpierw porcja na kupę; nadwyżka przychodzi powoli, gdy komora już dociska kupę (brama 0 g zamknięta —
    // czoło nadwyżki staje przed bramą, podajnik czeka)
    if (first > 0) { if (e.acceptsFeed) { const n = e.feed(Math.min(18, first)); first -= n; rest -= n; } } else if (rest > 0 && e.phase >= PHASE.PRESS) { if (e.acceptsFeed) rest -= e.feed(Math.min(8, rest)); else waited++; }
    e.step(DT);
  }
  assert.ok(waited > 60, 'podajnik czekał, gdy taśma stała przed bramą');
  assert.equal(e.counters[LICZNIK.delivered], 120 * UNITS_PER_TON, '180 t rudy → 120 t metalu');
  assert.equal(e.counters[LICZNIK.melts], 60 * GRAIN.perTon, 'nadwyżka ponad kupę wtopiona w kulę');
  assert.equal(e.audit().balance, 0);
  // rozbieg: strona startuje z cyklem w toku — kupa w 2/3 usypana, struga płynie (od razu coś się dzieje)
  const p = createMeltChamber({ seed: 7, prewarm: true });
  assert.equal(p.phase, PHASE.GATHER);
  assert.ok(p.counters[LICZNIK.heap] >= 0.62 * HEAP_GRAINS && p.counters[LICZNIK.heap] < 0.75 * HEAP_GRAINS, `kupa po rozbiegu: ${p.counters[LICZNIK.heap]} ziaren`);
  assert.ok(p.counters[LICZNIK.flight] > 1500 && p.view.stan[STAN.grav] === 0 && p.view.stan[STAN.spin] > 5 && p.view.stan[STAN.dsp] === DSP.RUN);
  assert.equal(p.audit().balance, 0);
});

test('wytop: dwa metale gotowe (stal, miedź) — inna barwa żaru, żużla i światła; tabela pod pięć', () => {
  assert.equal(METALE.length, 5);
  const ready = METALE.filter((m) => m.gotowy);
  assert.deepEqual(ready.map((m) => m.id), ['stal', 'miedz']);
  const [a, b] = ready;
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  assert.ok(dist(a.ramp[2], b.ramp[2]) > 0.08 && dist(a.slag, b.slag) > 0.05 && dist(a.light, b.light) > 0.1);
  for (const m of METALE) {
    assert.equal(m.ramp.length, 4);
    // kanał zielony żaru trzymany nisko (po ACES wyższy daje żółto-białą plamę)
    for (const c of m.ramp) assert.ok(c[1] <= 0.5 && c[0] >= c[1]);
    assert.equal(metalOf(m.id), m);
  }
  assert.equal(metalOf(1).id, 'miedz');
});

test('wytop: kula żyje — kołysanie niskich modów przy dokarmianiu 3–8 % promienia, przesunięcie w polu wraca; promień z masy', () => {
  const c = createMeltChamber({ seed: 7 });
  const S = c.view.stan;
  const dirs = [];
  for (let k = 0; k < 300; k++) { const y = 1 - (2 * k + 1) / 300; const r = Math.sqrt(1 - y * y); const an = k * 2.399963229728653; dirs.push([Math.cos(an) * r, y, Math.sin(an) * r]); }
  const acc = { feed: 0, feedN: 0, offFeed: 0, offRefineLate: 0, chillFeed: 0, chillRefine: 9, l2: 0, l3: 0, heapOff: 0, heapOm: 0, heapOmN: 0 };
  while (c.counters[LICZNIK.cycles] < 2) {
    c.step(DT);
    const p = S[STAN.phase];
    const off = Math.hypot(S[STAN.offX], S[STAN.offY], S[STAN.offZ]);
    assert.ok(Number.isFinite(off));
    // promień kuli = promień z masy (metal + żużel pływający na niej)
    if (c.radius > 0 && p !== PHASE.DROP) {
      const t = c.tons();
      // promień z objętości: metal + żużel w tonach-ekwiwalencie (porcje / 384 — żużel lżejszy od metalu)
      assert.ok(Math.abs(c.radius - radiusOfTons(t.metal + c.counters[LICZNIK.slagFloes] / SLAG_EQ_PER_TON)) < 1e-6);
    }
    if (p === PHASE.FEED && S[STAN.phaseT] > 1.5 && S[STAN.phaseT] < 6.5) {
      let m = 0;
      for (const d of dirs) m = Math.max(m, Math.abs(surfaceOffset(c.modes.a, d[0], d[1], d[2])));
      acc.feed += m; acc.feedN++;
      acc.offFeed = Math.max(acc.offFeed, off);
      acc.chillFeed = Math.max(acc.chillFeed, S[STAN.chill]);
      for (let i = 0; i < 5; i++) acc.l2 += c.modes.a[i] * c.modes.a[i];
      for (let i = 5; i < MODES; i++) acc.l3 += c.modes.a[i] * c.modes.a[i];
    }
    if (p === PHASE.REFINE && S[STAN.phaseT] > 10) { acc.offRefineLate = Math.max(acc.offRefineLate, off); acc.chillRefine = Math.min(acc.chillRefine, S[STAN.chill]); }
    // kupa: ciało sztywne — obraca się wolno z wirem pola (struga ją rozkręca), kołysze pod naporem ziaren
    if (p === PHASE.GATHER && c.counters[LICZNIK.heap] > 200) {
      acc.heapOff = Math.max(acc.heapOff, off);
      assert.ok(Math.abs(S[STAN.heapOm]) <= PROCES.heapOmegaMax + 1e-9);
      if (S[STAN.heapOm] > 0.2) acc.heapOm++;
      acc.heapOmN++;
    }
  }
  const mean = acc.feed / acc.feedN;
  assert.ok(mean > 0.03 && mean < 0.08, `odchylenie powierzchni przy dokarmianiu: średnio ${(mean * 100).toFixed(1)} % promienia`);
  assert.ok(acc.l2 > acc.l3 * 2, 'kołyszą niskie mody (l = 2), nie drga galareta (l = 3)');
  assert.ok(acc.offFeed > 1.5, `struga przesuwa kulę w polu (najwięcej ${acc.offFeed.toFixed(1)} j.)`);
  assert.ok(acc.offRefineLate < 1, `po wsadzie kula wraca na oś pola (${acc.offRefineLate.toFixed(2)} j.)`);
  assert.ok(acc.chillFeed > 0.9 && acc.chillRefine < 0.1, 'chłód strefy wsadu narasta przy dokarmianiu i znika w rafinacji');
  assert.ok(acc.heapOff > 0.3 && acc.heapOff < 30, `kupa kołysze się pod naporem strugi (do ${acc.heapOff.toFixed(1)} j.)`);
  assert.ok(acc.heapOm / acc.heapOmN > 0.9, 'kupa obraca się z wirem pola');
  assert.ok(Math.abs(radiusOfTons(12) - 87) < 0.5 && Math.abs(radiusOfTons(8 * 12) / radiusOfTons(12) - 2) < 1e-9);
});

test('wytop: krok nie alokuje (zbieranie z tysiącami ziaren w locie i w kupie, topienie, wyspy żużla, ssawa i granulki, masa w leju)', async () => {
  const c = createMeltChamber({ seed: 7 });
  const C = c.counters;
  // rozgrzewka: pełny obieg (każda gałąź kroku wykonana)
  for (let k = 0; k < 100 * 60; k++) c.step(DT);
  const warm = () => { for (let k = 0; k < 20; k++) c.step(DT); };
  let windows = 0;
  const measure = () => {
    const before = C[LICZNIK.flight] + C[LICZNIK.heap] + c.view.nKry;
    const p0 = c.phase;
    const bytes = allocatedBytes(() => c.step(DT), 60);
    // okno liczy się, gdy w komorze jest ruch (ziarna, kupa, kry) i nie trafiło na zrzut (uderzenie kuli w lej wybija
    // krople raz na obieg — kod rzadki, liczony bez optymalizacji)
    if ((before < 10 && C[LICZNIK.flight] + C[LICZNIK.heap] + c.view.nKry < 10) || p0 === PHASE.DROP || c.phase === PHASE.DROP) return Infinity;
    windows++;
    return bytes;
  };
  const per60 = await untilSteady(measure, (b) => b < 8192, { warm, rounds: 80, pauseMs: 50 });
  assert.ok(windows > 0, 'pomiar trafił w czas zbierania, topienia, dokarmiania albo rafinacji');
  assert.ok(per60 < 8192, `alokacje ${per60} B na 60 kroków`);
  // pole masy w leju (spływ po uspokojeniu kropel): krok pola, upust, normalizacja i zapis widoku bez alokacji
  // (rozgrzewka kodu pola na osobnym egzemplarzu — kod zoptymalizowany jest wspólny; potem dwa zrzuty w komorze)
  {
    const wf = createFunnelField(new Float64Array(MODES));
    const WP = wf.P;
    WP[MP.g] = PROCES.gravity; WP[MP.R] = R_CLEAN; WP[MP.sy] = 1; WP[MP.sxz] = 1; WP[MP.ballVol] = 4 / 3 * Math.PI * R_CLEAN ** 3; WP[MP.by] = funnelContactY(R_CLEAN); WP[MP.vFall] = 640; WP[MP.dt] = 1 / 240;
    wf.loadBall();
    for (let k = 0; k < 9000; k++) { if (wf.ballLeft > 0) WP[MP.by] -= 2.7; WP[MP.swirl] = k > 3000 ? 1 : 0; wf.step(); WP[MP.want] = k > 3000 ? 2000 : 0; wf.drain(); WP[MP.target] = WP[MP.moved]; wf.normalize(); }
  }
  const c2 = createMeltChamber({ seed: 7 });
  const S2 = c2.view.stan;
  const toDrain = () => { while (!(c2.phase === PHASE.DROP && S2[STAN.impactT] > 4)) c2.step(DT); };
  toDrain();
  while (c2.phase === PHASE.DROP) c2.step(DT);
  toDrain();
  let dropWindows = 0;
  const measureDrop = () => {
    if (!(c2.phase === PHASE.DROP && S2[STAN.impactT] > 4 && c2.counters[LICZNIK.funnel] > 12 * UNITS_PER_TON)) { while (c2.phase === PHASE.DROP) c2.step(DT); toDrain(); }
    const bytes = allocatedBytes(() => c2.step(DT), 20);
    if (c2.phase !== PHASE.DROP) return Infinity;
    dropWindows++;
    return bytes;
  };
  // (kod pola wchodzi w stan ustalony po dwóch–trzech zrzutach: każda nowa gałąź — wlewanie słupów, upust, wir —
  // raz cofa optymalizację; rundy sięgają kilku obiegów)
  const perDrop = await untilSteady(measureDrop, (b) => b < 4096, { warm: () => {}, rounds: 110, pauseMs: 20 });
  assert.ok(dropWindows > 0 && perDrop < 4096, `spływ masy: alokacje ${perDrop} B na 20 kroków (okien ${dropWindows})`);
});

test('wytop: czas kroku 1/60 s — średnio < 1 ms przez dwa obiegi', WYDAJNOSC, () => {
  const c = createMeltChamber({ seed: 7 });
  for (let k = 0; k < 95 * 60; k++) c.step(DT);
  const t0 = performance.now();
  const n = 180 * 60;
  for (let k = 0; k < n; k++) c.step(DT);
  const ms = (performance.now() - t0) / n;
  assert.ok(ms < 1, `krok ${ms.toFixed(3)} ms`);
});

test('wytop: obraz — WGSL wszystkich materiałów buduje się w Node; bryły komory, maszyneria, lej, wyświetlacz, pokład i uniformy bez NaN', async () => {
  const THREE = await import('three/webgpu');
  const { WytopObraz, GRAIN_K, threadGeometry } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { Budowniczy, RODZAJ, buildChamberDynamic, buildChamberStatic, wallStripAngles } = await import('../dema/ring-dzielnice/huta/wytop/wyposazenie.js');
  const { padTiers } = await import('../dema/ring-dzielnice/huta/wytop/kulaTSL.js');
  const { buildDisplayArrays, displayProfile } = await import('../dema/ring-dzielnice/huta/wytop/wyswietlacz.js');
  const { buildMeltDeckScene, deckPieces, flangePolygon } = await import('../dema/ring-dzielnice/huta/wytop/scena.js');
  const { resolvePortBuildingStyle } = await import('../src/3d/portBuildings/portBuildingStyle.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const build = (mesh) => {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera();
    b.context.material = mesh.material;
    b.build();
    return { vertex: b.vertexShader, fragment: b.fragmentShader };
  };
  const sim = createMeltChamber({ seed: 7 });
  // chwila topienia: kupa z jądrem w środku
  while (!(sim.phase === PHASE.MELT && sim.radius > 60)) sim.step(DT);
  const obraz = new WytopObraz({ root: new THREE.Group(), sim });
  obraz.setSun(-0.6, 0.5, -0.4, new THREE.Vector3(-0.6, 0.4, 0.5));
  const names = new Set();
  const wgsl = {};
  for (const m of obraz.meshes) {
    if (names.has(m.material.name)) continue;
    names.add(m.material.name);
    const w = build(m);
    assert.ok(w.vertex.length > 500 && w.fragment.length > 500, m.material.name);
    assert.ok(!/NaN|undefined/.test(w.vertex + w.fragment), `${m.material.name}: WGSL bez NaN / undefined`);
    if (m.material.name === 'WytopKula') {
      // tablice uniformów ze stałą nazwą (wspólny kod między egzemplarzami grafu); kula nie używa pochodnych ekranu
      for (const n of ['WytopMody', 'WytopZmarszczki', 'WytopKry']) assert.ok((w.vertex + w.fragment).includes(n), `bufor ${n}`);
      assert.ok(!(w.vertex + w.fragment).includes('WytopMasa'), 'kula nie czyta pola masy');
      assert.ok(!/dpdx|dpdy|fwidth/.test(w.fragment), 'materiał kuli bez pochodnych ekranu');
      wgsl.ball = w;
    }
    if (m.material.name === 'WytopMasa') {
      // masa w leju: pole grubości z tablicy uniformów w etapie wierzchołków (4 × 4 komórki z wagami B-sklejanymi,
      // trzy odczyty powierzchni — punkt i dwie różnice na normalną); fragment TEN SAM co kuli
      assert.ok(w.vertex.includes('WytopMasa'), 'siatka masy czyta pole grubości');
      assert.ok(!w.vertex.includes('WytopMody') && !w.vertex.includes('WytopKry'), 'siatka masy nie liczy modów kuli ani żużla w wierzchołku');
      assert.ok(!/dpdx|dpdy|fwidth/.test(w.fragment));
      wgsl.mass = w;
    }
  }
  // kula i masa w leju to ten sam metal: wspólny węzeł fragmentu (te same uniformy żaru, lustra komory i żużla)
  assert.equal(obraz.ball.material.fragmentNode, obraz.mass.material.fragmentNode, 'kula i masa: jeden fragment');
  assert.ok(wgsl.ball && wgsl.mass);
  for (const n of ['WytopKula', 'WytopMasa', 'WytopWyposazenie', 'WytopWyswietlacz', 'WytopTlen', 'Tasmociag', 'WytopZiarno', 'WytopNitka', 'WytopGranulka', 'WytopKropla', 'WytopIskra', 'WytopBlysk', 'WytopBlona']) assert.ok(names.has(n), `materiał ${n}`);
  // wyświetlacz grawitacji: JEDNA bryła i JEDEN materiał (wzór szewronów liczy shader, nie osobne bryły)
  assert.equal(obraz.meshes.filter((q) => q.material.name === 'WytopWyswietlacz').length, 1);
  assert.equal(obraz.meshes.filter((q) => q.material.name === 'WytopMasa').length, 1);
  assert.equal(obraz.meshes.filter((q) => q.material.name === 'WytopBryla').length, 0, 'partia odbitych brył usunięta');
  {
    // siatka masy: krąg nad całym dnem komory, gładki (dużo więcej odcinków niż komórek pola), ściany zwrócone w górę
    const g = obraz.mass.geometry;
    const pos = g.getAttribute('position').array;
    const rt = g.getAttribute('aRT').array;
    const idx = g.getIndex().array;
    let rMax = 0;
    for (let i = 0; i < pos.length / 3; i++) {
      const r = Math.hypot(pos[i * 3], pos[i * 3 + 2]);
      rMax = Math.max(rMax, r);
      assert.ok(Math.abs(r - rt[i * 2]) < 1e-3 && pos[i * 3 + 1] === 0 && rt[i * 2 + 1] >= 0 && rt[i * 2 + 1] <= MASA.na + 1e-6);
    }
    assert.ok(rMax >= KOMORA.pitR && rMax < KOMORA.pitR + 6, `siatka masy sięga ściany studni (${rMax.toFixed(0)})`);
    assert.ok(pos.length / 3 > 4 * MASA_CELLS, 'siatka gęstsza od pola (powierzchnia gładka)');
    let down = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3; const b = idx[t + 1] * 3; const c3 = idx[t + 2] * 3;
      const ny = (pos[b + 2] - pos[a + 2]) * (pos[c3] - pos[a]) - (pos[b] - pos[a]) * (pos[c3 + 2] - pos[a + 2]);
      if (ny < -1e-9) down++;
    }
    assert.equal(down, 0, 'ściany siatki masy zwrócone w górę');
  }
  // rozgrzewka: każda siatka jest na liście zwykłych albo partii instancji
  const wm = obraz.warmupMeshes();
  assert.equal(wm.plain.length + wm.instanced.length, obraz.meshes.length);
  assert.equal(wm.instanced.length, 5);
  // klatka obrazu w każdej fazie obiegu: uniformy skończone; kula widoczna tylko, gdy istnieje
  const U = obraz.U;
  const frame = { alpha: 0.4, cam: [300, 480, -400], pxK: 1200, ppuBall: 1.6, minPx: 1.5, viewW: 1600, viewH: 900 };
  const seenPhase = new Set();
  let seenMass = 0;
  const checkFrame = () => {
    obraz.apply(sim.view);
    obraz.frame(frame);
    for (const k of ['ball', 'ball2', 'cam', 'frame', 'glow', 'light', 'grain', 'mach', 'cage', 'mass', 'grav', 'disp', 'dcol', 'vor', 'fun', 'fall', 'heap', 'off', 'port', 'slag2', 'thr0', 'thr1', 'thr2', 'work']) for (const v of U[k].value.toArray()) assert.ok(Number.isFinite(v), `uniform ${k} w fazie ${PHASE_NAMES[sim.phase]}`);
    assert.ok(U.ball.value.x >= 0.5 && U.heap.value.z >= 1 && U.light.value.w >= 0);
    const S = sim.view.stan;
    const funnel = sim.counters[LICZNIK.funnel] + sim.counters[LICZNIK.metal];
    // kula widoczna do zetknięcia z lejem; od zetknięcia metal rysuje siatka masy (nigdy obie naraz)
    const expect = S[STAN.radius] > 0.5 && !(S[STAN.impactT] >= 0);
    assert.equal(obraz.ball.visible, expect, `kula ${expect ? 'widoczna' : 'ukryta'} w fazie ${PHASE_NAMES[sim.phase]}`);
    assert.equal(obraz.mass.visible, S[STAN.impactT] >= 0 && funnel > 0, `masa w leju ${S[STAN.impactT] >= 0 ? 'widoczna' : 'ukryta'}`);
    assert.ok(!(obraz.ball.visible && obraz.mass.visible), 'kula i masa nigdy obie naraz');
    let massMax = 0;
    for (const v of U.masa.array) { assert.ok(Number.isFinite(v.x + v.y) && v.x >= 0 && v.y >= 0 && v.y <= 1 + 1e-6); if (v.x > massMax) massMax = v.x; }
    if (obraz.mass.visible) { assert.ok(massMax > 0 && U.mass.value.x > 50 && U.mass.value.y >= 0 && U.mass.value.y <= 1); seenMass++; } else assert.equal(massMax, 0, 'bez masy pole w uniformach wyzerowane');
    assert.ok(Math.abs(U.mach.value.x - (KOMORA.mach.rOut - U.mach.value.y)) < 1e-3 && U.mach.value.x >= -1e-3);
    assert.ok(Math.abs(U.mach.value.z - (KOMORA.mach.padY - U.mach.value.w)) < 1e-3 && U.mach.value.z >= -1e-3 && U.mach.value.w > 60, 'zjazd segmentów prowadnicą');
    assert.ok(U.grav.value.x >= 0 && U.grav.value.x < 1);
    // wyświetlacz: fazy jako ułamki komórki, obrót 0…1; przy grawitacji groty w dół i barwa ciepła, przy 0 g chłodna
    assert.ok(U.disp.value.x >= 0 && U.disp.value.x < 1 && U.disp.value.z >= 0 && U.disp.value.z < 1 && U.disp.value.y >= 0 && U.disp.value.y <= 1 && U.disp.value.w > 0);
    if (S[STAN.grav]) { assert.ok(U.grav.value.z > 0.5 && U.disp.value.y > 0.5, 'grawitacja: szewrony grotem w dół'); if (S[STAN.dspT] > 0.2) assert.ok(U.dcol.value.x > U.dcol.value.z, 'grawitacja: barwa ciepła'); }
    if (S[STAN.dsp] === DSP.RUN) assert.ok(U.disp.value.y === 0 && U.dcol.value.z > U.dcol.value.x, '0 g: szewrony po obwodzie, barwa chłodna');
    assert.equal(obraz.counts.grains, sim.view.nZiarna);
    assert.equal(obraz.counts.granules, sim.view.nGranulki);
    // pole wysp żużla: pętla shadera idzie po liczbie wysp; bez kuli — zero; stożek pod nitką ograniczony
    assert.equal(U.slag2.value.x, obraz.ball.visible ? sim.view.nKry : 0);
    assert.ok(U.ball2.value.z >= 0 && U.ball2.value.z < 0.2 && U.ball2.value.w > 0.01);
    assert.equal(obraz.thread.visible, U.thr1.value.w > U.thr0.value.w, 'nitka widoczna tylko z narysowanym odcinkiem');
    seenPhase.add(sim.phase);
  };
  checkFrame();
  assert.ok(U.ball.value.x > 60 && U.ball.value.z > 0.9 && U.heap.value.x > 120 && U.light.value.w > 0);
  let floes = 0;
  let steps = 0;
  let threadSeen = 0;
  while (!(sim.counters[LICZNIK.cycles] >= 1 && sim.phase === PHASE.MELT)) {
    sim.step(DT);
    if (steps++ % 11 === 0) checkFrame();
    const S = sim.view.stan;
    if (sim.phase === PHASE.REFINE && S[STAN.suck] === 0 && sim.view.nKry > 3 && floes === 0) {
      // wyspy żużla w tablicy uniformów: kierunki jednostkowe, promień jako cięciwa, reszta tablicy wyzerowana
      checkFrame();
      for (let i = 0; i < POOL.floes; i++) {
        const a = U.floes.array[i * 2];
        const b = U.floes.array[i * 2 + 1];
        assert.ok(Number.isFinite(a.x + a.y + a.z + a.w + b.x + b.y + b.z + b.w));
        if (i < sim.view.nKry) { floes++; assert.ok(Math.abs(Math.hypot(a.x, a.y, a.z) - 1) < 1e-3 && a.w >= 0 && a.w < 1.25 && b.x > 0.1 && b.x <= 1); } else assert.equal(a.w, 0);
      }
    }
    if (S[STAN.suck] === 2 && S[STAN.thrHi] >= 1 && threadSeen < 3) {
      // nitka: od wierzchołka stożka czapy (nad kulą, w osi) do dzwonu ssawy (z boku, wyżej); punkt kontrolny nad korzeniem
      checkFrame();
      threadSeen++;
      const r0 = U.thr0.value;
      const r1 = U.thr1.value;
      const r2 = U.thr2.value;
      assert.ok(obraz.thread.visible && r0.w === 0 && r1.w > 0.95 && r2.w >= 0 && r2.w <= 1);
      assert.ok(Math.hypot(r0.x, r0.z) < 16 && r0.y > S[STAN.radius] * 0.9 && r1.x > 40 && r1.y > r0.y && r2.y > r0.y && Math.abs(r2.x - r0.x) < 6, 'łuk nitki: pionowo z czapy, potem ku dzwonowi');
    }
  }
  assert.ok(floes > 3 && threadSeen === 3);
  assert.equal(seenPhase.size, 8, 'klatka obrazu policzona w każdej fazie obiegu');
  assert.ok(seenMass > 20, `klatki z masą w leju: ${seenMass}`);
  for (const v of U.modes.array) assert.ok(Number.isFinite(v.x + v.y + v.z + v.w));
  for (const v of U.ripples.array) assert.ok(Number.isFinite(v.x + v.y + v.z + v.w) && v.w >= 0);
  assert.ok(GRAIN_K >= 1 && GRAIN_K <= 1.5);
  // bryły komory: część stała (z maszynerią, lejem i sygnalizacją) i ruchoma bez NaN, w obrębie komory
  const finite = (B, label) => {
    assert.equal(B.over, 0, `${label}: pojemność`);
    for (let i = 0; i < B.n * 3; i++) if (!Number.isFinite(B.pos[i]) || !Number.isFinite(B.nor[i]) || Math.abs(B.pos[i]) > 1600) assert.fail(`${label}: wierzchołek ${Math.floor(i / 3)}`);
    for (let i = 0; i < B.n * 3; i++) if (!Number.isFinite(B.mov[i]) || Math.abs(B.mov[i]) > 1 + 1e-6) assert.fail(`${label}: wektor ruchu wierzchołka ${Math.floor(i / 3)}`);
  };
  const st = new Budowniczy(170000);
  assert.ok(buildChamberStatic(st) > 20000);
  finite(st, 'stała');
  // maszyneria: wierzchołki z wektorem ruchu ku osi; przy pełnym dosunięciu żaden segment nie przechodzi przez oś
  // ani nie wchodzi w pas strugi; rodzaje sygnalizacji i leja obecne
  const kinds = new Map();
  let moving = 0;
  const slide = KOMORA.mach.rOut - KOMORA.mach.rMin;
  // największy zjazd segmentu prowadnicą: mała kula po stopieniu kupy
  const travel = KOMORA.mach.padY - (radiusOfTons(PROCES.heapTons * 2 / 3) + KOMORA.mach.gap + KOMORA.mach.reach) * Math.sin(KOMORA.mach.lat * Math.PI / 180);
  let sliding = 0;
  let railReach = 0;
  for (let i = 0; i < st.n; i++) {
    const kind = st.aux[i * 2];
    kinds.set(kind, (kinds.get(kind) || 0) + 1);
    const mx = st.mov[i * 3];
    const mz = st.mov[i * 3 + 1];
    const my = st.mov[i * 3 + 2];
    if (mx === 0 && mz === 0) { assert.equal(my, 0, 'co nie jedzie po promieniu, nie zjeżdża też prowadnicą'); continue; }
    moving++;
    const w = Math.hypot(mx, mz);
    const x = st.pos[i * 3] - mx * slide;
    const z = st.pos[i * 3 + 2] - mz * slide;
    const y0 = st.pos[i * 3 + 1];
    // po dosunięciu wierzchołek zostaje po swojej stronie osi (iloczyn skalarny z kierunkiem wysięgnika dodatni)
    assert.ok((x * mx + z * mz) / w > 40, 'segment cewki nie przechodzi przez oś komory');
    assert.ok(Math.abs(y0) > 100, 'maszyneria poza pasem strugi ziaren');
    if (kind === RODZAJ.cewka) { assert.ok(Math.abs(w - 1) < 1e-6, 'zwoje cewki jadą w całości'); assert.equal(my, Math.sign(y0), 'zwoje zjeżdżają prowadnicą ku równikowi'); }
    if (my !== 0) {
      sliding++;
      // segment z listwą prowadnicy zjeżdża ku równikowi (górny w dół, dolny w górę) i po największym zjeździe zostaje
      // po swojej stronie równika; listwa sięga wtedy jeszcze głowicy wysięgnika (jej koniec ponad osią wysięgnika)
      assert.ok(Math.abs(my) === 1 && my === Math.sign(y0) && Math.abs(w - 1) < 1e-6);
      assert.ok((y0 - my * travel) * my > 60, 'po zjeździe segment zostaje po swojej stronie równika');
      railReach = Math.max(railReach, (y0 - my * travel) * my);
    }
  }
  assert.ok(moving > 15000 && sliding > 12000, `wierzchołki maszynerii: ${moving}, zjeżdżające prowadnicą: ${sliding}`);
  assert.ok(railReach > KOMORA.mach.padY + 8, `listwa prowadnicy po największym zjeździe sięga ponad oś wysięgnika (${railReach.toFixed(0)} z ${KOMORA.mach.padY})`);
  for (const k of [RODZAJ.cewka, RODZAJ.grawLinia, RODZAJ.lej, RODZAJ.gardziel, RODZAJ.lampa, RODZAJ.sciana, RODZAJ.dno]) assert.ok(kinds.get(k) > 5, `rodzaj powierzchni ${k}`);
  assert.equal(kinds.get(RODZAJ.okno) || 0, 0, 'okna portu spustowego usunięte');
  assert.equal(RODZAJ.grawDno, undefined, 'światło grawitacji w dnie usunięte (pierścień okien i strzałki)');
  // listwy dawnych linii okien (dwie, nieruchome) + pierścień bramy 0 g (linia 3); LEJ = CAŁE DNO: stożek sięga od
  // gardzieli do ściany studni, a pod pokładem w obrębie studni nie ma żadnej płaskiej posadzki (dno ma tylko zatoka taśmy)
  const lines = new Set();
  let funMin = Infinity;
  let funMax = 0;
  const F2 = KOMORA.funnel;
  const slope = (F2.rimY - F2.throatY) / (F2.rimR - F2.throatR);
  for (let i = 0; i < st.n; i++) {
    const kind = st.aux[i * 2];
    const par = st.aux[i * 2 + 1];
    const x = st.pos[i * 3]; const y = st.pos[i * 3 + 1]; const z = st.pos[i * 3 + 2];
    const rr = Math.hypot(x, z);
    if (kind === RODZAJ.grawLinia) { lines.add(Math.floor(par / 10 + 0.01)); assert.ok(par - 10 * Math.floor(par / 10 + 0.01) < Math.PI * 2 + 1e-6); }
    if (kind === RODZAJ.lej) {
      funMin = Math.min(funMin, rr); funMax = Math.max(funMax, rr);
      assert.ok(Math.abs(y - (F2.throatY + (rr - F2.throatR) * slope)) < 1e-2, 'wierzchołek leja leży na stożku');
      // gładka bryła obrotowa: normalna stożka (do wnętrza i w górę), ta sama na całej tworzącej
      const nx = st.nor[i * 3]; const ny = st.nor[i * 3 + 1]; const nz = st.nor[i * 3 + 2];
      assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-4 && ny > 0.5 && nx * x + nz * z < 0);
    }
    if (kind === RODZAJ.dno) assert.ok(x < KOMORA.bay.xb + 3 && Math.abs(y - KOMORA.bay.floorY) < 1e-6, 'płaskie dno ma tylko zatoka taśmy');
    // żadnej poziomej płyty na wysokości dołu ściany (dawna posadzka)
    if (kind === RODZAJ.sciana) assert.ok(rr > KOMORA.pitR - 30 || x < KOMORA.bay.xb + 1, 'ściana to ściana, nie posadzka');
  }
  assert.deepEqual([...lines].sort(), [0, 1, 3]);
  assert.ok(Math.abs(funMin - F2.throatR) < 1e-3 && funMax >= KOMORA.pitR, `stożek leja od gardzieli (${funMin.toFixed(0)}) do ściany (${funMax.toFixed(0)})`);
  assert.ok(kinds.get(RODZAJ.lej) >= 128 * 6, 'lej z co najmniej 128 odcinków po obwodzie (gładki, nie 32-kąt)');
  // WYŚWIETLACZ: jedna siatka — lico (rodzaj 1) pochylone ku górze i do wnętrza, obudowa; poza przerwą zatoki; gładki
  const P = displayProfile();
  const da = buildDisplayArrays();
  const DSPL = KOMORA.display;
  let faceN = 0;
  let azMin = Infinity;
  let azMax = -Infinity;
  const azSet = new Set();
  for (let i = 0; i < da.count; i++) {
    const x = da.pos[i * 3]; const y = da.pos[i * 3 + 1]; const z = da.pos[i * 3 + 2];
    assert.ok(Number.isFinite(x + y + z + da.nor[i * 3] + da.nor[i * 3 + 1] + da.nor[i * 3 + 2]));
    const rr = Math.hypot(x, z);
    assert.ok(rr > DSPL.rIn - 8 && rr < KOMORA.pitR + 3 && y > DSPL.y - DSPL.half - 44 && y < DSPL.y + DSPL.half + 14, 'pas wyświetlacza przy ścianie, na swojej wysokości');
    const az = da.uv[i * 2];
    azMin = Math.min(azMin, az); azMax = Math.max(azMax, az);
    if (da.kind[i] > 0.5) {
      faceN++;
      azSet.add(Math.round(az * 1e4));
      // lico: normalna do wnętrza komory i W GÓRĘ (czytelne z kamery z góry), współrzędna w dół lica 0…1
      const nr = (da.nor[i * 3] * x + da.nor[i * 3 + 2] * z) / rr;
      assert.ok(da.nor[i * 3 + 1] > 0.45 && nr < -0.5 && da.uv[i * 2 + 1] >= 0 && da.uv[i * 2 + 1] <= 1);
      assert.ok(Math.abs(nr - P.nr) < 1e-4 && Math.abs(da.nor[i * 3 + 1] - P.ny) < 1e-4);
    }
  }
  assert.ok(faceN > 1000 && azSet.size > 200, `lico z ${azSet.size} odcinków po obwodzie (gładkie)`);
  assert.ok(Math.abs(azMin - DSPL.gap1 * Math.PI / 180) < 1e-6 && Math.abs(azMax - (DSPL.gap0 + 360) * Math.PI / 180) < 1e-6, 'pas omija zatokę taśmy');
  assert.ok(P.slant > 80 && P.cellW > 60 && P.slant / P.cellW > 1 && P.slant / P.cellW < 1.7, `komórka szewronu ${P.cellW.toFixed(0)} × ${P.slant.toFixed(0)} j.`);
  // część ruchoma (ssawa żużla, żaluzje odbieralnika): w postoju, przy pracy i przy zsypie koryta
  const dyn = new Budowniczy(20000);
  const c2 = createMeltChamber({ seed: 3 });
  let seenSuck = 0;
  let seenDump = 0;
  let minMouth = Infinity;
  let minPad = Infinity;
  assert.ok(buildChamberDynamic(dyn, c2.view.stan) > 1500, 'ssawa w postoju');
  finite(dyn, 'ruchoma (postój)');
  const kneeY = KOMORA.ssawa.boomY - KOMORA.ssawa.kneeDrop;
  while (!(c2.counters[LICZNIK.cycles] >= 1 && c2.phase === PHASE.PRESS)) {
    c2.step(DT);
    const S = c2.view.stan;
    if (S[STAN.suck] > 0) {
      seenSuck++;
      if (seenSuck % 7 === 0) { assert.ok(buildChamberDynamic(dyn, S) > 1500); finite(dyn, 'ruchoma (ssawa)'); }
      // dzwon ssawy nie wchodzi w kulę i nie wychodzi ponad kolano; wózek między postojem a stanowiskiem pracy
      const d = Math.hypot(S[STAN.mouthX] - S[STAN.offX], S[STAN.mouthY] - S[STAN.offY]);
      if (d - c2.radius < minMouth) minMouth = d - c2.radius;
      assert.ok(S[STAN.mouthY] <= kneeY && S[STAN.headX] <= KOMORA.ssawa.parkX + 1e-9 && S[STAN.headX] >= KOMORA.ssawa.workX - 1e-9);
    }
    if (S[STAN.trayDump] > 0) { seenDump++; if (seenDump % 9 === 0) { buildChamberDynamic(dyn, S); finite(dyn, 'ruchoma (zsyp)'); } }
    // segmenty cewek nie wchodzą w kulę (oś segmentu: promień pierścienia, wysokość ze stanu)
    if (c2.radius > 0 && S[STAN.phase] !== PHASE.DROP) minPad = Math.min(minPad, Math.hypot(S[STAN.mach], S[STAN.machY]) - c2.radius);
  }
  assert.ok(seenSuck > 300 && seenDump > 60);
  assert.ok(minMouth > KOMORA.ssawa.mouthR, `dzwon ssawy nad powierzchnią kuli (najmniej ${minMouth.toFixed(1)} j.)`);
  assert.ok(minPad > KOMORA.coilTube, `segment cewki nad powierzchnią kuli (najmniej ${minPad.toFixed(1)} j.)`);
  // rodzaje powierzchni żużla: wzierniki rurociągu i wnętrze wylotu odbieralnika w części stałej, wzierniki i wnętrze dzwonu w ruchomej
  assert.ok(kinds.get(RODZAJ.zar) > 30 && kinds.get(RODZAJ.wylot) > 20);
  let dynHot = 0;
  for (let i = 0; i < dyn.n; i++) if (dyn.aux[i * 2] === RODZAJ.zar) dynHot++;
  assert.ok(dynHot > 40);
  // geometria odbić = geometria brył: segmenty cewek i lampy ścian
  const tiers = padTiers();
  assert.equal(tiers.length, 2);
  assert.deepEqual([tiers[0][1].length, tiers[1][1].length], [KOMORA.mach.upper.length, KOMORA.mach.lower.length]);
  assert.equal(wallStripAngles().length, 14);
  const lit = KOMORA.strips.filter((s) => s.gain > 0);
  assert.ok(lit.length >= 5 && lit.length <= 11 && new Set(KOMORA.strips.map((s) => s.half)).size > 6);
  // siatka nitki żużla: rura parametryczna (u wzdłuż 0…1, okrąg jednostkowy w poprzek)
  const tg = threadGeometry(24, 8);
  const tp = tg.getAttribute('position').array;
  assert.equal(tp.length, 25 * 8 * 3);
  for (let i = 0; i < tp.length; i += 3) assert.ok(tp[i] >= 0 && tp[i] <= 1 && Math.abs(Math.hypot(tp[i + 1], tp[i + 2]) - 1) < 1e-6);
  assert.equal(tg.getIndex().count, 24 * 8 * 6);
  // POMOST GÓRNY (runda 6 — reszta dawnego pokładu przy płaszczyźnie gry): wypukłe czworokąty, pole = prostokąt pomostu
  // − otwór (kołnierz naczynia ∪ zatoka taśmy), nic nie leży w otworze ani na kołnierzu
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
  const pieces = deckPieces();
  const D = KOMORA.deck;
  const bay = KOMORA.bay;
  const fl = flangePolygon();
  const inPoly = (poly, x, z) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]; const b = poly[j];
      if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const bayPoly = [[bay.x0, bay.z0], [bay.xa, bay.z0], [bay.xb, bay.z1], [bay.x0, bay.z1]];
  let sum = 0;
  for (const p of pieces) {
    assert.equal(p.length, 4);
    const a = area(p);
    assert.ok(a > 0, 'czworokąt pomostu zwrócony zgodnie');
    sum += a;
    for (let i = 0; i < 4; i++) {
      const a0 = p[i]; const a1 = p[(i + 1) % 4]; const a2 = p[(i + 2) % 4];
      assert.ok((a1[0] - a0[0]) * (a2[1] - a1[1]) - (a1[1] - a0[1]) * (a2[0] - a1[0]) >= -1e-6, 'czworokąt wypukły');
      assert.ok(a0[0] >= D.x0 - 1e-6 && a0[0] <= D.x1 + 1e-6 && a0[1] >= D.z0 - 1e-6 && a0[1] <= D.z1 + 1e-6, 'wierzchołek na pomoście');
    }
    const cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4;
    const cz = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
    assert.ok(!inPoly(fl, cx, cz) && !inPoly(bayPoly, cx, cz), 'płyta pomostu poza kołnierzem i zatoką');
  }
  // pole z próbkowania (krok 2 j.): prostokąt pomostu bez kołnierza i zatoki
  let cells = 0;
  for (let x = D.x0 + 1; x < D.x1; x += 2) for (let z = D.z0 + 1; z < D.z1; z += 2) if (!inPoly(fl, x, z) && !inPoly(bayPoly, x, z)) cells++;
  assert.ok(Math.abs(sum - cells * 4) / sum < 0.004, `pole pomostu ${sum.toFixed(0)} (próbkowanie ${cells * 4})`);
  const scene = buildMeltDeckScene(resolvePortBuildingStyle('earth'));
  assert.ok(scene.instances > 60 && scene.plates.length === pieces.length && scene.lamps.length <= 8 && scene.labels.length === 2);
  assert.equal(scene.rig.chan.zeroG, 3, 'kanał lamp obrzeża: generator 0 g');
  for (const set of Object.values(scene.sets)) for (const arr of Object.values(set)) for (const v of arr) assert.ok(Number.isFinite(v));
});
