// HUTA — wytop, RUNDA 5: GAZ KOMORY — etapy 1–2 (bilans i zdarzenia, odciąg w kadrze). Trzeci strumień bilansu:
// ruda = metal + żużel + gaz (jednostka 1/1536 t, ziarno 12 jednostek; podział `metale.js`: `split`). Źródła gazu
// w fazach cyklu (rekordy `view.gaz`, `takeGas`), kąpiel, odciąg, rura zbiorcza, zbiorniki tlenu; bryły i wskaźniki
// odciągu. Pole gazu na GPU — następne etapy (projekt `.tmp/huta/wytop/PROJEKT-gaz.md`, poza repo).
// Testy nie mierzą czasu ściany.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAIN } from '../dema/ring-dzielnice/huta/ruda/rudy.js';
import { KOMORA, funnelFloorAt, gasPipeRoute, pathSample } from '../dema/ring-dzielnice/huta/wytop/geometria.js';
import { GAZ_FIZ, GAZ_HOOD_LIGHT, GAZ_IN, GAZ_PROCES, GAZ_REC, GAZ_RODZAJ, GAZ_RODZAJE, GAZ_SLOT, GAZ_SLOTS, GAZ_STRIDE, gazPulseOf, gazPulsePhase, gazVentCpu } from '../dema/ring-dzielnice/huta/wytop/gaz.js';
import { GRAIN_UNITS, LICZNIK, PHASE, PHASE_NAMES, PROCES, SLAG_EQ_PER_TON, SLAG_VOL, STAN, STAN_N, UNITS_PER_TON, createMeltChamber } from '../dema/ring-dzielnice/huta/wytop/komora.js';
import { METALE } from '../dema/ring-dzielnice/huta/wytop/metale.js';
import { createGasInput, createGasPacker } from '../dema/ring-dzielnice/huta/wytop/gazWejscie.js';
import { surfaceOffset } from '../dema/ring-dzielnice/huta/wytop/kula.js';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

const DT = 1 / 60;
const CHARGE_GRAINS = PROCES.chargeTons * GRAIN.perTon;
const HEAP_GRAINS = PROCES.heapTons * GRAIN.perTon;
const DEG = Math.PI / 180;

test('wytop/gaz: jednostki i podział ziarna — 1/1536 t, ziarno 12 = metal + żużel + gaz; metal zawsze 2/3 (receptura 3 → 2)', () => {
  assert.equal(UNITS_PER_TON, 1536);
  assert.equal(GRAIN_UNITS, 12);
  assert.equal(GRAIN_UNITS * GRAIN.perTon, UNITS_PER_TON, 'ziarno 1/128 t');
  for (const m of METALE) {
    assert.equal(m.split.length, 3);
    assert.equal(m.split[0] + m.split[1] + m.split[2], GRAIN_UNITS, `${m.id}: podział sumuje się do 12`);
    assert.equal(m.split[0], 8, `${m.id}: metal 2/3 rudy`);
    assert.ok(m.split.every((v) => Number.isInteger(v) && v >= 0));
    assert.ok(Array.isArray(m.gasSmoke) && Array.isArray(m.gasFume) && m.gasSmoke.length === 3 && m.gasFume.length === 3);
  }
  assert.deepEqual([...METALE[0].split], [8, 2, 2], 'stal 8 / 2 / 2');
  assert.deepEqual([...METALE[1].split], [8, 3, 1], 'miedź 8 / 3 / 1 (miedź dymi mniej)');
  // objętość kuli: metal ziarna + porcja żużla = 12 jednostek objętości (promień kuli jak przed rundą 5)
  assert.equal(8 + SLAG_VOL, GRAIN_UNITS);
  assert.equal(SLAG_EQ_PER_TON * SLAG_VOL, UNITS_PER_TON);
  // układ rekordu źródła i sloty
  assert.equal(GAZ_STRIDE, 12);
  assert.equal(GAZ_SLOTS, 32);
  assert.equal(Object.keys(GAZ_REC).length, GAZ_STRIDE);
  const slots = [[GAZ_SLOT.heap, GAZ_SLOT.heapN], [GAZ_SLOT.burst, GAZ_SLOT.burstN], [GAZ_SLOT.melt, GAZ_SLOT.meltN], [GAZ_SLOT.bubble, GAZ_SLOT.bubbleN], [GAZ_SLOT.suck, GAZ_SLOT.suckN], [GAZ_SLOT.impact, GAZ_SLOT.impactN]];
  let next = 0;
  for (const [a, n] of slots) { assert.equal(a, next, 'sloty ciągłe, bez nakładania'); next += n; }
  assert.equal(next, GAZ_SLOTS);
  assert.equal(GAZ_RODZAJE.length, 6);
  // indeksy stanu gazu w zakresie STAN_N i bez kolizji z innymi polami
  const idx = Object.values(STAN);
  assert.equal(new Set(idx).size, idx.length, 'indeksy STAN bez powtórzeń');
  assert.ok(idx.every((i) => i < STAN_N));
  for (const k of ['gasBath', 'gasAir', 'gasDuct', 'gasTank', 'gasOut', 'gasAdvance', 'bubbles', 'bursts']) assert.ok(Number.isInteger(LICZNIK[k]));
});

/** Rodzaj źródła ze slotu. */
function kindOfSlot(s) {
  if (s < GAZ_SLOT.burst) return GAZ_RODZAJ.DYM_KUPY;
  if (s < GAZ_SLOT.melt) return GAZ_RODZAJ.WYRZUT;
  if (s < GAZ_SLOT.bubble) return GAZ_RODZAJ.WTOPIENIE;
  if (s < GAZ_SLOT.suck) return GAZ_RODZAJ.BABEL;
  if (s < GAZ_SLOT.impact) return GAZ_RODZAJ.SSAWA;
  return GAZ_RODZAJ.UDERZENIE;
}

/**
 * Bieg komory z pełnym sprawdzaniem gazu po każdym kroku. Zwraca pomiary do asercji metalu.
 */
function runGas(metal, seconds) {
  const c = createMeltChamber({ seed: 7, metal });
  const S = c.view.stan;
  const Sp = c.view.stanPrev;
  const C = c.counters;
  const GU = c.split[2];
  const out = new Float32Array(GAZ_SLOTS * GAZ_STRIDE);
  const tank0 = new Float64Array(3);
  const R = {
    taken: 0, byKind: new Float64Array(6), cycles: [], peakAir: 0, impactAirs: [], drains: 0, gravOffT: 99, gravOnT: 0,
    bubbleTop: 0, bubbleMax: 0, minBurstPhase: 9, wentylBad: 0, bathAfterImpact: 0, maxTank: 0, pipeStill: 0
  };
  let impacts = 0;
  let cyc = { bubbles: C[LICZNIK.bubbles], bursts: C[LICZNIK.bursts], kinds: new Float64Array(6) };
  let pipeU = S[STAN.pipeU];
  for (let k = 0; k < seconds * 60; k++) {
    c.step(DT);
    const a = c.audit();
    if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`${metal ? 'miedź' : 'stal'}, krok ${k} (${PHASE_NAMES[S[STAN.phase]]}): bilans ${a.balance}, niezgodność ${a.mismatch}`);
    // --- rekordy źródeł ---
    let pending = 0;
    for (let s = 0; s < GAZ_SLOTS; s++) pending += c.view.gaz[s * GAZ_STRIDE + 3];
    const got = c.takeGas(out);
    assert.equal(got, pending, 'takeGas zabiera wszystkie jednostki rekordów');
    for (let s = 0; s < GAZ_SLOTS; s++) assert.equal(c.view.gaz[s * GAZ_STRIDE + 3], 0, 'po takeGas rekordy wyzerowane');
    R.taken += got;
    for (let s = 0; s < GAZ_SLOTS; s++) {
      const o = s * GAZ_STRIDE;
      const u = out[o + GAZ_REC.units];
      if (!(u > 0)) continue;
      for (let i = 0; i < GAZ_STRIDE; i++) if (!Number.isFinite(out[o + i])) assert.fail(`rekord ${s}: pole ${i} nieskończone`);
      const kind = out[o + GAZ_REC.kind];
      const T = GAZ_RODZAJE[kind];
      assert.equal(kind, kindOfSlot(s), `slot ${s}: rodzaj ${kind}`);
      R.byKind[kind] += u;
      cyc.kinds[kind] += u;
      const p = S[STAN.phase];
      const p0 = Sp[STAN.phase];
      if (!T.fazy.includes(p) && !T.fazy.includes(p0)) assert.fail(`rodzaj ${T.nazwa} w fazie ${PHASE_NAMES[p]}`);
      const dl = Math.hypot(out[o + 4], out[o + 5], out[o + 6]);
      assert.ok(Math.abs(dl - 1) < 1e-4, `rekord ${s}: kierunek jednostkowy (${dl})`);
      const sp = out[o + GAZ_REC.speed];
      if (sp < T.speed[0] - 1e-3 || sp > T.speed[1] + 1e-3) assert.fail(`${T.nazwa}: prędkość ${sp.toFixed(1)} poza ${T.speed}`);
      const tt = out[o + GAZ_REC.temp];
      if (tt < T.temp[0] - 1e-4 || tt > T.temp[1] + 1e-4) assert.fail(`${T.nazwa}: temperatura ${tt}`);
      const rad = out[o + GAZ_REC.radius];
      if (rad < T.radius[0] - 1e-3 || rad > T.radius[1] + 1e-3) assert.fail(`${T.nazwa}: promień plamy ${rad}`);
      assert.ok(Math.abs(out[o + GAZ_REC.dym] - T.dym) < 1e-5, `${T.nazwa}: udział dymu`);
      // punkt wewnątrz komory: w studni, nad lejem, pod pokładem; poza kulą
      const x = out[o];
      const y = out[o + 1];
      const z = out[o + 2];
      const rho = Math.hypot(x, z);
      if (!(rho < KOMORA.pitR - 2 && y < KOMORA.deckY && y > funnelFloorAt(rho))) assert.fail(`${T.nazwa}: punkt (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}) poza komorą`);
      if ((kind === GAZ_RODZAJ.WTOPIENIE || kind === GAZ_RODZAJ.BABEL || kind === GAZ_RODZAJ.SSAWA) && S[STAN.radius] > 1) {
        // powierzchnia kuli z modami drgań (kula faluje o kilka procent promienia)
        const d = Math.hypot(x - S[STAN.offX], y - S[STAN.offY], z - S[STAN.offZ]);
        const surf = S[STAN.radius] * (1 + surfaceOffset(c.modes.a, (x - S[STAN.offX]) / d, (y - S[STAN.offY]) / d, (z - S[STAN.offZ]) / d));
        if (d < surf - 1) assert.fail(`${T.nazwa}: punkt pod powierzchnią kuli (${d.toFixed(1)} < ${surf.toFixed(1)})`);
      }
      if (kind === GAZ_RODZAJ.BABEL) {
        R.bubbleMax = Math.max(R.bubbleMax, u);
        // górna półkula (poza pasem ±40°): tylko małe bąble i poza czapą żużla
        const ny = (y - S[STAN.offY]) / Math.hypot(x - S[STAN.offX], y - S[STAN.offY], z - S[STAN.offZ]);
        if (ny > Math.sin(GAZ_PROCES.bandLat * DEG) + 0.02) {
          R.bubbleTop++;
          assert.ok(u <= GAZ_PROCES.bubbleTopT * UNITS_PER_TON + 1, `bąbel górnej półkuli ${u} jedn. ≤ 0,125 t`);
          assert.ok(Math.acos(Math.min(1, ny)) > S[STAN.capAlpha] - 0.02, 'bąbel poza czapą żużla');
        }
      }
    }
    // jednostki zabrane + czekające w rekordach = wszystko, co źródła wydały do komory
    assert.equal(R.taken, C[LICZNIK.gasAir] + C[LICZNIK.gasDuct] + C[LICZNIK.gasTank] + C[LICZNIK.gasOut], 'źródła: zabrane = wydane do komory');
    // --- kąpiel, komora, wentylacja ---
    R.peakAir = Math.max(R.peakAir, C[LICZNIK.gasAir]);
    if (C[LICZNIK.impacts] > impacts) {
      impacts = C[LICZNIK.impacts];
      R.impactAirs.push(C[LICZNIK.gasAir] / R.peakAir);
    }
    if (S[STAN.impactT] >= GAZ_PROCES.impactTime + 0.1 && S[STAN.phase] === PHASE.DROP && C[LICZNIK.gasBath] !== 0) R.bathAfterImpact++;
    if (S[STAN.grav]) { R.gravOnT += DT; R.gravOffT = 0; } else { R.gravOffT += DT; R.gravOnT = 0; }
    const w = S[STAN.wentyl];
    if (w < 0 && !S[STAN.grav] && R.gravOffT > GAZ_PROCES.ventRamp + 0.02) R.wentylBad++;
    if (w > 0 && S[STAN.grav] && R.gravOnT > GAZ_PROCES.ventRamp + 0.02) R.wentylBad++;
    if (R.gravOffT > GAZ_PROCES.ventRamp + 0.02 && w !== 1) R.wentylBad++;
    if (R.gravOnT > GAZ_PROCES.ventRamp + 0.02 && w !== -1) R.wentylBad++;
    // --- zbiorniki: napełnienie monotoniczne poza opróżnianiem; tlen do sieci skokami pojemności ---
    const drainNow = S[STAN.tankDrain] >= 0 ? Math.floor(S[STAN.tankDrain]) : -1;
    const drainPrev = Sp[STAN.tankDrain] >= 0 ? Math.floor(Sp[STAN.tankDrain]) : -1;
    for (let t = 0; t < 3; t++) {
      const f = S[STAN.tank0 + t];
      assert.ok(f >= 0 && f <= 1 + 1e-12, `zbiornik ${t}: napełnienie ${f}`);
      R.maxTank = Math.max(R.maxTank, f);
      if (t !== drainNow && t !== drainPrev) assert.ok(f >= tank0[t] - 1e-12, `zbiornik ${t} opada bez opróżniania`);
      tank0[t] = f;
    }
    if (drainPrev >= 0 && drainNow < 0) {
      R.drains++;
      assert.equal(C[LICZNIK.gasOut] % c.tankCap, 0, 'tlen oddany do sieci w całych zbiornikach');
    }
    // impulsy w rurze stoją, gdy w rurze nie ma gazu
    if (C[LICZNIK.gasDuct] === 0 && Sp[STAN.ductT] === 0) { if (S[STAN.pipeU] !== pipeU) assert.fail('impulsy jadą bez gazu w rurze'); R.pipeStill++; }
    pipeU = S[STAN.pipeU];
    // koniec obiegu: liczby obiegu
    if (S[STAN.cycle] > Sp[STAN.cycle]) {
      R.cycles.push({ bubbles: C[LICZNIK.bubbles] - cyc.bubbles, bursts: C[LICZNIK.bursts] - cyc.bursts, kinds: Array.from(cyc.kinds, (v) => v / UNITS_PER_TON) });
      cyc = { bubbles: C[LICZNIK.bubbles], bursts: C[LICZNIK.bursts], kinds: new Float64Array(6) };
    }
  }
  return { c, R, GU };
}

test('wytop/gaz: STAL — bilans 0 po każdym kroku przez 10 minut; źródła w swoich fazach i zakresach; kąpiel, odciąg, zbiorniki', () => {
  const { c, R, GU } = runGas(0, 600);
  const C = c.counters;
  const gasCycleT = CHARGE_GRAINS * GU / UNITS_PER_TON;
  assert.equal(gasCycleT, 60, 'stal: 60 t gazu na obieg');
  assert.ok(R.cycles.length >= 5, `pełnych obiegów ${R.cycles.length}`);
  // każdy pełny obieg (od pierwszego zbierania do pustej komory): rodzaje w proporcjach z projektu
  for (const q of R.cycles.slice(1)) {
    const [dym, wyrzut, wtop, babel, ssawa, uderzenie] = q.kinds;
    const heapGas = HEAP_GRAINS * GU / UNITS_PER_TON;                    // 20 t
    const feedGas = (CHARGE_GRAINS - HEAP_GRAINS) * GU / UNITS_PER_TON;   // 40 t
    assert.ok(dym > 0.4 * heapGas && dym <= 0.5 * heapGas + 0.01, `dym kupy ${dym.toFixed(1)} t`);
    assert.ok(wyrzut > 0.4 * heapGas && wyrzut <= 0.5 * heapGas + 0.01, `wyrzuty ${wyrzut.toFixed(1)} t`);
    assert.ok(Math.abs(wtop - 0.6 * feedGas) < 0.6, `wtopienia ${wtop.toFixed(1)} t (60 % gazu dokarmiania)`);
    assert.ok(babel > 5 && babel < 0.4 * feedGas, `bąble ${babel.toFixed(1)} t`);
    assert.ok(Math.abs(ssawa - GAZ_PROCES.suckShare * gasCycleT) < 0.2, `opary ssawy ${ssawa.toFixed(2)} t`);
    assert.ok(uderzenie >= GAZ_PROCES.impactShare * gasCycleT - 0.05 && uderzenie < 0.15 * gasCycleT, `kłąb uderzenia ${uderzenie.toFixed(2)} t`);
    assert.ok(Math.abs(dym + wyrzut + wtop + babel + ssawa + uderzenie - gasCycleT) < 0.05, 'cały gaz obiegu wyszedł do komory');
    assert.ok(q.bubbles >= 25 && q.bubbles <= 80, `bąbli na obieg ${q.bubbles} (~2 na sekundę dokarmiania)`);
    assert.ok(q.bursts >= 30 && q.bursts <= 42, `wyrzutów z kupy na obieg ${q.bursts}`);
  }
  assert.ok(R.bubbleTop > 0, 'bąble pękają także na górnej półkuli (małe)');
  assert.ok(R.bubbleMax <= GAZ_PROCES.bubbleT[1] * UNITS_PER_TON + 1);
  // komora przedmuchana przed zrzutem: w chwili uderzenia gazu w komorze ≤ 15 % szczytu
  // przed zrzutem żaluzje okapów przymknięte, kąpiel oddaje rezerwę odsuwu (gorąca mgiełka przy ścianach — drugi znak
  // grawitacji, runda 5 poprawki): w komorze zostaje 10–30 % szczytu, a nie komora przedmuchana do ≤ 15 %
  assert.ok(R.impactAirs.length >= 5 && R.impactAirs.every((v) => v >= 0.08 && v <= 0.3), `gaz w komorze przy uderzeniu / szczyt: ${R.impactAirs.map((v) => v.toFixed(3))}`);
  assert.equal(R.bathAfterImpact, 0, 'po kłębie uderzenia kąpiel pusta');
  assert.equal(R.wentylBad, 0, 'wentylacja zmienia znak tylko razem z grawitacją (rampa 0,3 s) i wraca po zrzucie');
  assert.ok(R.drains >= 6, `opróżnień zbiorników ${R.drains}`);
  assert.ok(R.maxTank > 0.999, 'zbiornik napełnia się do pełna');
  assert.ok(R.pipeStill > 100, 'impulsy w rurze stoją przy pustej rurze (początek pracy)');
  // gaz wydany do komory = gaz rozdzielony z ziaren minus kąpiel; wszystko poza kąpielą przeszło przez źródła
  assert.equal(C[LICZNIK.gasAdvance] >= 0, true);
  assert.ok(C[LICZNIK.gasOut] >= 6 * c.tankCap);
});

test('wytop/gaz: MIEDŹ — bilans 0 przez 5 minut; gazu o połowę mniej niż stali; żużel cięższy, kula i obieg te same', () => {
  const { c, R, GU } = runGas(1, 300);
  assert.equal(GU, 1);
  assert.ok(R.cycles.length >= 2);
  for (const q of R.cycles.slice(1)) {
    const total = q.kinds.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 30) < 0.05, `miedź: 30 t gazu na obieg (${total.toFixed(2)})`);
  }
  assert.ok(R.impactAirs.every((v) => v <= 0.3), `miedź: gaz przy uderzeniu / szczyt ${R.impactAirs.map((v) => v.toFixed(3))}`);
  assert.equal(R.bathAfterImpact, 0);
  assert.equal(R.wentylBad, 0);
  // żużel miedzi: porcja 3 jednostki — 90 t na obieg (stali 60 t), liczony w porcjach
  const t = c.tons();
  assert.ok(Math.abs((t.odbieralnik + t.wywiezione + t.nitka + t.zuzelNaKuli) / (c.counters[LICZNIK.melts] + c.counters[LICZNIK.absorbed]) * GRAIN.perTon - 3 / 12) < 1e-9, 'żużel miedzi = 1/4 rudy');
});

/**
 * Bieg przez pierwsze dokarmianie: liczby cyklu odciągu (runda 6, „zasysanie gazu”). Zwraca szczyty narastania, gaz
 * w komorze na końcu ciągu, przepływy i naruszenia (bilans, siła ciągu poza dokarmianiem, żaluzje).
 */
function runPulse(metal) {
  const P = GAZ_PROCES;
  const c = createMeltChamber({ seed: 7, metal });
  const S = c.view.stan;
  const C = c.counters;
  const out = new Float32Array(GAZ_SLOTS * GAZ_STRIDE);
  const R = { start: -1, peaks: [0, 0], ends: [0, 0], flowNar: 0, flowCiag: 0, hoodNar: 1, drawBad: 0, feedT: 0, sawRefine: false };
  let sinceFeed = 99;
  for (let k = 0; k < 120 * 60 && !(R.sawRefine && sinceFeed > 6); k++) {
    c.step(DT);
    c.takeGas(out);
    const a = c.audit();
    if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`krok ${k}: bilans ${a.balance}, niezgodność ${a.mismatch}`);
    const air = C[LICZNIK.gasAir] / UNITS_PER_TON;
    if (S[STAN.phase] === PHASE.FEED) {
      sinceFeed = 0;
      const t = S[STAN.phaseT];
      R.feedT = t;
      if (R.start < 0) R.start = air;
      const j = Math.floor(t / P.pulsePeriod);
      const tc = t % P.pulsePeriod;
      if (j < 2) {
        if (tc < P.pulseHold) {
          R.peaks[j] = Math.max(R.peaks[j], air);
          if (tc > 3) {
            R.flowNar = Math.max(R.flowNar, S[STAN.gasFlow]);
            R.hoodNar = Math.min(R.hoodNar, S[STAN.hood]);
            if (Math.abs(S[STAN.draw] - P.pulseIdle) > 0.02) R.drawBad++;
          }
        } else {
          R.flowCiag = Math.max(R.flowCiag, S[STAN.gasFlow]);
          if (tc > P.pulseHold + 2.5 && Math.abs(S[STAN.draw] - P.pulseDraw) > 0.05) R.drawBad++;
          if (tc > P.pulsePeriod - 0.1) R.ends[j] = air;
        }
      }
    } else {
      sinceFeed += DT;
      if (S[STAN.phase] === PHASE.REFINE) R.sawRefine = true;
      // poza dokarmianiem odciąg jak w rundzie 5 (siła ciągu wraca do 1 w kilka sekund po końcu dokarmiania)
      if (sinceFeed > 5 && Math.abs(S[STAN.draw] - 1) > 1e-3) R.drawBad++;
      if (S[STAN.pulseT] !== -1) R.drawBad++;
    }
  }
  return R;
}

test('wytop/gaz: CYKL ODCIĄGU w dokarmianiu (runda 6) — narastanie → ciąg dwa razy, komora wyraźnie się przeczyszcza; bilans 0; poza dokarmianiem odciąg bez zmian (oba metale)', () => {
  const P = GAZ_PROCES;
  assert.ok(P.pulseHold < P.pulsePeriod && 2 * P.pulsePeriod <= PROCES.feedTime, 'dwa pełne okresy mieszczą się w dokarmianiu');
  for (const metal of [0, 1]) {
    const R = runPulse(metal);
    const name = metal ? 'miedź' : 'stal';
    assert.ok(R.feedT >= 2 * P.pulsePeriod - 0.5, `${name}: dokarmianie ${R.feedT.toFixed(1)} s obejmuje dwa okresy`);
    assert.equal(R.drawBad, 0, `${name}: siła ciągu w narastaniu = pulseIdle, w ciągu = pulseDraw, poza dokarmianiem 1`);
    assert.ok(R.hoodNar <= P.pulseHood + 0.02, `${name}: żaluzje w narastaniu przymknięte (${R.hoodNar.toFixed(3)})`);
    // narastanie: gazu w komorze wyraźnie przybywa (stal ≥ 12 t, miedź ≥ 5,5 t — dawniej ~8 / ~4 t przez całe dokarmianie)
    const minPeak = metal ? 5.5 : 12;
    assert.ok(R.peaks[0] >= 1.3 * R.start && R.peaks[0] >= minPeak, `${name}: szczyt pierwszego narastania ${R.peaks[0].toFixed(2)} t (start ${R.start.toFixed(2)} t)`);
    assert.ok(R.peaks[1] >= 0.7 * minPeak, `${name}: szczyt drugiego narastania ${R.peaks[1].toFixed(2)} t`);
    // ciąg: komora przeczyszczona do ≤ 35 % szczytu narastania (dwa razy)
    for (let j = 0; j < 2; j++) assert.ok(R.ends[j] > 0 && R.ends[j] <= 0.35 * R.peaks[j], `${name}: po ciągu ${j + 1} w komorze ${R.ends[j].toFixed(2)} t ≤ 35 % z ${R.peaks[j].toFixed(2)} t`);
    assert.ok(R.flowCiag >= 4 * R.flowNar, `${name}: przepływ przez okapy w ciągu ${R.flowCiag.toFixed(2)} t/s ≫ w narastaniu ${R.flowNar.toFixed(2)} t/s`);
  }
  // lustra pola: siła ciągu → narastanie / ciąg 0…1, faza z czasu, wentylacja z ciągiem sumuje się do zera
  const q = new Float64Array(2);
  gazPulseOf(P.pulseIdle, q); assert.deepEqual([...q], [1, 0]);
  gazPulseOf(1, q); assert.deepEqual([...q], [0, 0]);
  gazPulseOf(P.pulseDraw, q); assert.deepEqual([...q], [0, 1]);
  gazPulseOf(0, q); assert.deepEqual([...q], [0, 0], 'zero = wejście bez cyklu (testy pola): jak siła 1');
  assert.equal(gazPulsePhase(-1), 0);
  assert.equal(gazPulsePhase(0.5), 1);
  assert.equal(gazPulsePhase(P.pulseHold + 0.5), 2);
  assert.equal(gazPulsePhase(P.pulsePeriod + 0.5), 1);
  for (const d of [P.pulseIdle, 1, P.pulseDraw]) {
    const v = gazVentCpu(1, 4e6, [0, 0], d);
    assert.ok(Math.abs(v[0] + v[1] + 4e6) < 1e-3, 'nawiew + odciąg + źródła = 0');
    assert.ok(Math.abs(v[0] - GAZ_FIZ.q0 * d) < 1e-3, 'nawiew × siła ciągu');
  }
  // wejście kroku pola: siła ciągu i jasność pasów okapów (światło na gazie) z symulacji — w narastaniu ciemne, w ciągu pełne
  {
    const c = createMeltChamber({ seed: 7 });
    const packer = createGasPacker();
    const inp = createGasInput();
    const rec = new Float32Array(GAZ_SLOTS * GAZ_STRIDE);
    const at = (t) => { while (!(c.view.stan[STAN.phase] === PHASE.FEED && c.view.stan[STAN.phaseT] >= t)) { c.step(DT); c.takeGas(rec); packer.pack(c, rec, inp); } };
    at(5);
    assert.ok(Math.abs(inp[GAZ_IN.draw] - P.pulseIdle) < 0.02, `narastanie: siła ciągu ${inp[GAZ_IN.draw]}`);
    assert.ok(inp[GAZ_IN.hoodGlow] < 0.2, `narastanie: pasy okapów przygaszone (${inp[GAZ_IN.hoodGlow].toFixed(3)})`);
    const qN = inp[GAZ_IN.qHood];
    at(P.pulseHold + 2.5);
    assert.ok(Math.abs(inp[GAZ_IN.draw] - P.pulseDraw) < 0.05, `ciąg: siła ciągu ${inp[GAZ_IN.draw]}`);
    assert.ok(inp[GAZ_IN.hoodGlow] > 0.8 && inp[GAZ_IN.hoodGlow] <= 1, `ciąg: pasy okapów jasne (${inp[GAZ_IN.hoodGlow].toFixed(3)})`);
    assert.ok(inp[GAZ_IN.qHood] < 10 * qN, 'ciąg: okapy ssą ~40 × mocniej niż w narastaniu (wydatek ujemny)');
  }
  // barwa światła pasów okapów na gazie = barwa pasów (`odciag.js`)
  assert.deepEqual([...GAZ_HOOD_LIGHT], [0.55, 0.78, 1.0]);
});

test('wytop/gaz: ŻUŻEL I KULA BEZ ZMIAN — kąt wysp i czapy, promienie kuli i obieg równe wartościom z rundy 4 (oba metale)', () => {
  // wartości policzone kodem rundy 4 (jednostka 1/384 t) dla ziarna 7: rafinacja + 3 s pierwszego obiegu
  const REF = { capAlpha: 0.5404611015286329, islands: 40, sumAngle: 2.805443989112973, sumTons: 120.00000314926729, n: 40, rMax: 270.32389114124476, rClean: 236.14967045249324, cycle: 96.2166666666893 };
  for (const metal of [0, 1]) {
    const c = createMeltChamber({ seed: 7, metal });
    const S = c.view.stan;
    let rMax = 0;
    let rClean = 0;
    let got = null;
    while (c.counters[LICZNIK.cycles] < 1) {
      c.step(DT);
      if (S[STAN.radius] > rMax && !(S[STAN.impactT] >= 0)) rMax = S[STAN.radius];
      if (S[STAN.phase] === PHASE.CLEAR && !rClean) rClean = S[STAN.radius];
      if (!got && S[STAN.phase] === PHASE.REFINE && S[STAN.phaseT] >= 3) {
        let a = 0;
        let m = 0;
        const K = c.view.kry;
        for (let i = 0; i < c.view.nKry; i++) { a += K[i * 8 + 3]; m += K[i * 8 + 6]; }
        got = { capAlpha: S[STAN.capAlpha], islands: S[STAN.islands], sumAngle: a, sumTons: m, n: c.view.nKry };
      }
    }
    assert.equal(got.capAlpha, REF.capAlpha, 'kąt czapy bit w bit');
    assert.equal(got.islands, REF.islands);
    assert.equal(got.n, REF.n);
    assert.equal(got.sumAngle, REF.sumAngle, 'kąty wysp bit w bit');
    assert.equal(got.sumTons, REF.sumTons, 'masy wysp w tonach-ekwiwalencie (rysunek) bit w bit');
    assert.equal(rMax, REF.rMax, `promień kuli z żużlem ${rMax.toFixed(2)} (≈ 270 j.)`);
    assert.equal(rClean, REF.rClean, `promień czystej kuli przy zrzucie ${rClean.toFixed(2)} (≈ 236 j.)`);
    assert.ok(Math.abs(S[STAN.cycleTime] - REF.cycle) < 0.05, `obieg ${S[STAN.cycleTime].toFixed(2)} s`);
  }
});

test('wytop/gaz: powtarzalność (skrót z gazem) i krok z takeGas bez alokacji (bąble, wyrzuty, kłąb uderzenia, zbiorniki)', async () => {
  const run = () => {
    const c = createMeltChamber({ seed: 3 });
    const out = new Float32Array(GAZ_SLOTS * GAZ_STRIDE);
    const h = [];
    for (let k = 0; k < 100 * 60; k++) { c.step(DT); c.takeGas(out); if (k % 600 === 599) h.push(c.hash()); }
    return h;
  };
  assert.deepEqual(run(), run());
  const c = createMeltChamber({ seed: 7 });
  const out = new Float32Array(GAZ_SLOTS * GAZ_STRIDE);
  for (let k = 0; k < 100 * 60; k++) { c.step(DT); c.takeGas(out); }
  const warm = () => { for (let k = 0; k < 20; k++) { c.step(DT); c.takeGas(out); } };
  const phases = new Set();
  const measure = () => {
    const p0 = c.phase;
    const bytes = allocatedBytes(() => { c.step(DT); c.takeGas(out); }, 60);
    // (zrzut ma rzadki kod pola masy — mierzony w teście kroku `hutaWytop`; tu fazy gazu kupy i kąpieli)
    if (p0 === PHASE.DROP || c.phase === PHASE.DROP) return Infinity;
    phases.add(p0);
    return bytes;
  };
  const per60 = await untilSteady(measure, (b) => b < 8192, { warm, rounds: 80, pauseMs: 50 });
  assert.ok(per60 < 8192, `alokacje ${per60} B na 60 kroków (fazy: ${[...phases].map((p) => PHASE_NAMES[p])})`);
});

test('wytop/gaz: ODCIĄG — okapy widoczne z góry (co najmniej trzy w pełni), pierścień górny, rura z kołnierza do zbiorników w hali', async () => {
  const G = KOMORA.gaz;
  const H = G.hoods;
  const DSPK = KOMORA.display;
  // lico okapu w rzucie z góry: warga i wlot bliżej osi niż wewnętrzna krawędź wyświetlacza
  const minR = Math.min(...H.profile.map((p) => p[0]));
  assert.ok(minR > 380 && minR < DSPK.rIn - 30, `okap sięga do ρ ${minR}`);
  assert.ok(H.throat[0] < DSPK.rIn, 'gardło z kreską światła widoczne z góry (przed licem wyświetlacza)');
  // przeszkody w rzucie z góry nad okapami: koryto odbieralnika, wysięgnik ssawy, zatoka i wysięgnik taśmy, wysięgniki górnych cewek
  const T = KOMORA.tray;
  const bay = KOMORA.bay;
  const zb = KOMORA.belt.pts[KOMORA.belt.pts.length - 1][2];
  const blocked = (x, z) => {
    const r = Math.hypot(x, z);
    let a = Math.atan2(z, x);
    if (a < 0) a += 2 * Math.PI;
    if (a > T.az0 - 0.02 && a < T.az1 + 0.02 && r > T.rIn - 6) return 'odbieralnik';
    if (x > KOMORA.ssawa.workX - 30 && Math.abs(z) < 24) return 'ssawa';
    if (x < bay.xb && z > bay.z0 && z < bay.z1) return 'zatoka';
    if (x < KOMORA.belt.pts[KOMORA.belt.pts.length - 1][0] + 30 && Math.abs(z - zb) < 80) return 'taśma';
    for (const deg of KOMORA.mach.upper) {
      const d = Math.abs(((a / DEG - deg + 540) % 360) - 180);
      if (d < 2.2 && r > KOMORA.mach.rMin) return 'wysięgnik cewki';
    }
    return null;
  };
  let full = 0;
  for (const azd of H.az) {
    let hit = null;
    for (let q = 0; q <= 40; q++) {
      const a = (azd - H.half + 2 * H.half * q / 40) * DEG;
      for (const r of [minR + 2, (minR + DSPK.rIn) / 2, DSPK.rIn - 2]) { hit = hit || blocked(Math.cos(a) * r, Math.sin(a) * r); }
    }
    if (!hit) full++;
  }
  assert.ok(full >= 3, `okapów w pełni widocznych z góry: ${full}`);
  assert.equal(H.az.length, 4);
  // okapy pod pasem wyświetlacza, nad dolnym pierścieniem cewek, nad obrzeżem leja; poza strugą ziaren (y > 27 przy ścianie)
  const ys = H.profile.map((p) => p[1]);
  assert.ok(Math.max(...ys) < DSPK.y - DSPK.half - 20, 'okapy pod pasem wyświetlacza');
  assert.ok(Math.min(...ys) > -KOMORA.mach.padY + 30 && Math.min(...ys) > KOMORA.funnel.rimY + 100, 'okapy nad dolnymi cewkami i lejem');
  assert.ok(Math.max(...ys) < 0, 'okapy pod strugą ziaren');
  // pierścień górny pod obrzeżem, nad lampami ścian i rurociągiem żużla
  assert.ok(G.ring.y1 < KOMORA.deckY && G.ring.y0 > Math.max(...KOMORA.strips.map((s) => s.y + s.half + 8)));
  assert.ok(G.ring.y0 - G.ring.lipH > KOMORA.ssawa.boomY - KOMORA.ssawa.kneeDrop + 8);
  // rura i zbiorniki (runda 6 — komora nad pokładem hali): rura wychodzi z wierzchu kołnierza naczynia poza krawężnikiem
  // i lampami obrzeża, schodzi pionem poza kołnierzem do hali, biegnie po pokładzie hali do rozdzielacza; zbiorniki
  // leżą na pokładzie hali (oś nad pokładem, dolna część w kołysce), nie stykają się; wymiary bez zmian
  const P = G.pipe;
  const TK = G.tanks;
  assert.ok(P.r0 > KOMORA.pitR + 30 && P.r0 < KOMORA.deck.flangeR - P.r - 4, 'wyjście rury na kołnierzu, poza krawężnikiem i lampami obrzeża');
  assert.ok(P.r1 > KOMORA.deck.flangeR + P.r + 20, 'pion rury poza kołnierzem naczynia');
  const route = gasPipeRoute(0);
  assert.ok(Math.abs(route.deck - (KOMORA.hallY + P.bend)) < 1e-9, 'rura na pokładzie hali');
  const pts = route.main.pieces;
  assert.ok(pts.some((q) => q.type === 'seg' && Math.abs(q.a[1] - q.b[1]) > 1500), 'pion rury schodzi do hali');
  const endP = pts[pts.length - 1].b;
  assert.ok(Math.abs(endP[0] - P.x) < 1e-6 && endP[1] === route.deck && endP[2] > P.z0 && endP[2] < P.z1, 'rura wchodzi w rozdzielacz');
  for (let k = 1; k < TK.z.length; k++) assert.ok(Math.abs(TK.z[k] - TK.z[k - 1]) > 2 * TK.r + 10, 'zbiorniki nie stykają się');
  for (const z of TK.z) assert.ok(z > P.z0 + P.rh && z < P.z1 - P.rh, 'odgałęzienie zbiornika z rozdzielacza');
  assert.ok(TK.y - TK.r < KOMORA.hallY && TK.y > KOMORA.hallY, 'zbiorniki w kołysce pokładu hali (oś nad pokładem)');
  assert.ok(route.len > 2000, `droga gazu z kołnierza do zbiornika ${route.len.toFixed(0)} j.`);
  // bryły i pasy wskaźników: bez NaN, pasy na bryłach (nad ich powierzchnią)
  const { Budowniczy, buildChamberStatic, buildChamberDynamic } = await import('../dema/ring-dzielnice/huta/wytop/wyposazenie.js');
  const { buildOxygenArrays, PAS, branchR, oxyRouteLength } = await import('../dema/ring-dzielnice/huta/wytop/odciag.js');
  const B = new Budowniczy(300000);
  buildChamberStatic(B);
  assert.equal(B.over, 0);
  for (let i = 0; i < B.n * 3; i++) if (!Number.isFinite(B.pos[i]) || !Number.isFinite(B.nor[i])) assert.fail('bryła stała: NaN');
  const c = createMeltChamber({ seed: 7 });
  const Bd = new Budowniczy(24000);
  for (const hood of [0, 0.5, 1]) {
    c.view.stan[STAN.hood] = hood;
    buildChamberDynamic(Bd, c.view.stan);
    assert.equal(Bd.over, 0, 'część ruchoma (z żaluzjami) mieści się w siatce');
    for (let i = 0; i < Bd.n * 3; i++) if (!Number.isFinite(Bd.pos[i])) assert.fail('żaluzje: NaN');
  }
  const A = buildOxygenArrays();
  assert.ok(A.count > 1000 && A.count % 3 === 0);
  const axis = [];
  for (let sAt = 0; sAt <= route.main.len; sAt += 0.5) axis.push(Array.from(pathSample(route.main, sAt)));
  const kinds = new Set();
  for (let i = 0; i < A.count; i++) {
    for (let j = 0; j < 3; j++) if (!Number.isFinite(A.position[i * 3 + j])) assert.fail('pasy: NaN');
    const kind = A.aI[i * 4];
    kinds.add(kind);
    const x = A.position[i * 3];
    const y = A.position[i * 3 + 1];
    const z = A.position[i * 3 + 2];
    if (kind === PAS.rura) {
      // pas na grzbiecie rury: odległość od osi drogi ≈ promień rury (+0,6 nad powierzchnią, ±1,9 w poprzek)
      let dmin = Infinity;
      for (const q of axis) dmin = Math.min(dmin, Math.hypot(x - q[0], y - q[1], z - q[2]));
      assert.ok(Math.abs(dmin - Math.hypot(P.r + 0.6, 1.9)) < 1.2, `pas rury na rurze (odległość od osi ${dmin.toFixed(2)})`);
    }
    if (kind === PAS.listwa) {
      const k = A.aI[i * 4 + 2];
      assert.ok(Math.abs(Math.hypot(y - TK.y, z - TK.z[k]) - TK.r - 0.6) < 1e-3, 'listwa na grzbiecie zbiornika');
      assert.ok(x > TK.x0 + TK.head && x < TK.x1 - TK.head);
    }
    if (kind === PAS.odgalezienie) assert.ok(Math.abs(y - (route.deck + branchR())) < 1);
  }
  assert.deepEqual([...kinds].sort(), [0, 1, 2, 3, 4, 5]);
  for (let k = 0; k < 3; k++) assert.ok(oxyRouteLength(k) > route.len - 40 && oxyRouteLength(k) < route.len + 300);
});

test('wytop/gaz: obraz — materiał wskaźników tlenu buduje się w Node (WGSL bez NaN, ten sam graf = ten sam kod), jedna siatka', async () => {
  const THREE = await import('three/webgpu');
  const { createOxygenMesh } = await import('../dema/ring-dzielnice/huta/wytop/odciag.js');
  const { createWytopUniforms } = await import('../dema/ring-dzielnice/huta/wytop/wspolneTSL.js');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
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
    return b.vertexShader + '\n' + b.fragmentShader;
  };
  const a = build(createOxygenMesh(createWytopUniforms()));
  const b = build(createOxygenMesh(createWytopUniforms()));
  assert.ok(!/NaN|undefined/.test(a));
  assert.ok(a.includes('WytopRura'), 'gaz w przedziałach rury z tablicy uniformów o stałej nazwie');
  assert.equal(a, b, 'ten sam graf = ten sam kod');
  assert.ok(!/\bpow\s*\(/.test(a), 'bez pow');
  // obraz komory: jedna siatka wskaźników, w rozgrzewce (zwykłe siatki obrazu)
  const sim = createMeltChamber({ seed: 7 });
  const obraz = new WytopObraz({ root: new THREE.Group(), sim });
  const ox = obraz.meshes.filter((m) => m.material.name === 'WytopTlen');
  assert.equal(ox.length, 1);
  assert.ok(obraz.warmupMeshes().plain.includes(ox[0]));
  // klatka obrazu w trakcie dokarmiania: uniformy wskaźników skończone (runda 6: w CIĄGU cyklu odciągu — w narastaniu
  // żaluzje są przymknięte i przez okapy płynie mało)
  while (!(sim.phase === PHASE.FEED && sim.view.stan[STAN.phaseT] > GAZ_PROCES.pulseHold + 1.5)) sim.step(DT);
  obraz.apply(sim.view);
  obraz.frame({ alpha: 0.5, cam: [0, 2000, 0], pxK: 1000, ppuBall: 1, minPx: 1.5, viewW: 1600, viewH: 900 });
  for (const k of ['oxy', 'oxy2', 'oxy3']) for (const v of obraz.U[k].value.toArray()) assert.ok(Number.isFinite(v), `${k} skończony`);
  assert.ok(obraz.U.oxy.value.z > 0.3, 'przepływ odciągu przy dokarmianiu');
  assert.ok(obraz.U.duct.array.some((v) => v.x > 0), 'gaz w rurze');
});

// ===========================================================================
// POLE GAZU (etapy 3–6): lustra CPU kerneli, fizyka na małej siatce, wejście kroku, WGSL kerneli i obrazu.

const POLE = await import('../dema/ring-dzielnice/huta/wytop/gaz.js');
const WEJ = await import('../dema/ring-dzielnice/huta/wytop/gazWejscie.js');
const GI = POLE.GAZ_IN;
const gasInput = () => { const a = new Float32Array(POLE.GAZ_IN_N); a[GI.dt] = DT; return a; };

test('wytop/gaz pole: lustra — plama źródła całkuje się do 1, wentylacja sumuje się do zera ze źródłami, wir ma zwrot ziaren, presety × 64', () => {
  // kształt plamy: całka po objętości = 1 (masa wstrzyknięta = jednostki rekordu)
  for (const r of [26.4, 45, 90]) {
    const n = 48;
    const h = 2 * r / n;
    let sum = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const x = -r + (i + 0.5) * h;
      const y = -r + (j + 0.5) * h;
      const z = -r + (k + 0.5) * h;
      sum += POLE.gazSourceShapeCpu(Math.sqrt(x * x + y * y + z * z), r) * h * h * h;
    }
    assert.ok(Math.abs(sum - 1) < 0.01, `całka plamy r = ${r}: ${sum}`);
  }
  assert.equal(POLE.gazSourceShapeCpu(50, 45), 0);
  // plama wydłużona wzdłuż wypływu (smuga po normalnej): całka = 1 dla każdego wydłużenia i kierunku
  for (const [r, st, u] of [[20, 2.8, [1, 0, 0]], [30, 1.8, [0.6, 0.8, 0]], [15, 2.2, [0, -0.6, 0.8]]]) {
    const n = 40;
    const ext = r * st;
    const h = 2 * ext / n;
    let sum = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      sum += POLE.gazSourceStreakCpu(-ext + (i + 0.5) * h, -ext + (j + 0.5) * h, -ext + (k + 0.5) * h, u[0], u[1], u[2], r, st) * h * h * h;
    }
    assert.ok(Math.abs(sum - 1) < 0.02, `całka smugi r = ${r}, s = ${st}: ${sum}`);
  }
  assert.ok(POLE.gazSourceStreakCpu(0, 50, 0, 0, 1, 0, 20, 2.8) > 0 && POLE.gazSourceStreakCpu(50, 0, 0, 0, 1, 0, 20, 2.8) === 0, 'smuga dłuższa wzdłuż wypływu niż w poprzek');
  // wentylacja: nawiew + odciąg + objętość źródeł = 0 w każdym trybie; 0 g — okapy ssą, grawitacja — pierścień ssie
  const v = [0, 0];
  for (const w of [1, 0.6, 0.2, 0, -0.3, -1]) for (const q of [0, 2e6, 3e7]) {
    POLE.gazVentCpu(w, q, v);
    assert.ok(Math.abs(v[0] + v[1] + q) < 1, `bilans objętości przy wentyl ${w}`);
    if (w > 0) assert.ok(v[0] > 0 && v[1] < 0, '0 g: pierścień górny nawiewa, okapy ssą');
    if (w < 0) assert.ok(v[1] > 0 && v[0] < 0, 'grawitacja: okapy dmuchają, pierścień górny ssie');
  }
  POLE.gazVentCpu(-1, 0, v);
  assert.equal(v[1], POLE.GAZ_FIZ.gravQ * POLE.GAZ_FIZ.q0);
  // wir pola: styczna (z, −x) / ρ, prędkość dodatnia — moment pędu względem osi pionowej ujemny, jak u ziaren w locie
  const sw = [0, 0, 0];
  for (const [x, z] of [[250, 0], [0, 300], [-120, 80], [400, -200]]) {
    POLE.gazSwirlCpu(x, z, sw);
    assert.ok(sw[2] > 0);
    assert.ok(x * sw[1] - z * sw[0] < 0, 'zwrot wiru gazu');
    assert.ok(Math.abs(sw[0] * x + sw[1] * z) < 1e-9, 'styczna prostopadła do promienia');
  }
  assert.ok(Math.abs(POLE.gazSwirlCpu(300, 0, sw) - POLE.GAZ_FIZ.swirlV) < 1e-9, 'profil ciągły na promieniu przejścia');
  assert.ok(POLE.gazSwirlCpu(150, 0, sw) < POLE.gazSwirlCpu(300, 0, sw) && POLE.gazSwirlCpu(500, 0, sw) < POLE.gazSwirlCpu(300, 0, sw));
  // ziarna w locie (rekord: pozycja bieżąca [0…2], poprzednia [3…5]) krążą w tę samą stronę
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  while (!(sim.phase === PHASE.FEED && sim.view.stan[STAN.phaseT] > 4)) sim.step(DT);
  let L = 0;
  const Z = sim.view.ziarna;
  const stride = 12;
  let flying = 0;
  for (let i = 0; i < sim.view.nZiarna; i++) {
    const o = i * stride;
    const x = Z[o];
    const z = Z[o + 2];
    if (x * x + z * z > 480 * 480 || x * x + z * z < 250 * 250) continue;       // ziarna w spirali pola (nie na taśmie)
    L += x * (z - Z[o + 5]) - z * (x - Z[o + 3]);
    flying++;
  }
  assert.ok(flying > 50 && L < 0, 'ziarna w locie krążą w tę samą stronę co wir gazu (przeciwnie do wskazówek zegara na ekranie)');
  // wypór tylko przy grawitacji; dryf odśrodkowy ograniczony
  assert.equal(POLE.gazBuoyancyCpu(0.9, 0.1, 0), 0);
  assert.ok(POLE.gazBuoyancyCpu(0.9, 0.1, 1) > 0 && POLE.gazBuoyancyCpu(0, 0.5, 1) < 0);
  assert.ok(POLE.gazDriftCpu(90, 300, 1) > 20 && POLE.gazDriftCpu(600, 100, 1) === POLE.GAZ_FIZ.driftMax);
  // presety: liczby komórek i kolumn podzielne przez 64, komórka × liczba = bok domeny, nieparzysta liczba iteracji Jacobiego
  for (const P of POLE.GAZ.presets) {
    assert.equal((P.nx * P.ny * P.nz) % 64, 0);
    assert.equal((P.nx * P.nz) % 64, 0);
    assert.equal(P.nx * P.cell, POLE.GAZ.size);
    assert.ok(POLE.GAZ.y0 + P.ny * P.cell >= POLE.GAZ.ceilY);
    // skalary na siatce gęstszej: ta sama domena (te same współrzędne tekstur), wielokrotności 64
    assert.equal((P.snx * P.sny * P.snz) % 64, 0);
    assert.equal((P.snx * P.snz) % 64, 0);
    assert.ok(Math.abs(P.snx * P.scell - POLE.GAZ.size) < 1e-9);
    assert.ok(Math.abs(P.sny * P.scell - P.ny * P.cell) < 1e-9, 'siatka skalarów pokrywa tę samą wysokość co siatka prędkości');
    assert.ok(P.scell <= P.cell);
    assert.equal(P.jacobi % 2, 1, 'wynik Jacobiego w prsB');
    const zc = POLE.gazZoneCells(P);
    assert.ok(zc.ring > 50 && zc.hood > 100, `${P.nazwa}: strefy wentylacji mają komórki gazu`);
  }
});

test('wytop/gaz pole: bryły stałe i strefy (lustra) — ściana, błona, lej, wyświetlacz, okapy, kula z obrotem, masa w leju; strefy leżą w gazie', () => {
  const inp = gasInput();
  const vel = [0, 0, 0];
  const S = (x, y, z) => POLE.gazSolidCpu(x, y, z, inp, vel);
  assert.equal(S(0, 0, 0), 0, 'pusta komora: środek jest gazem');
  assert.equal(S(520, 0, 0), 1, 'ściana');
  assert.equal(S(0, 402, 0), 1, 'błona nad studnią');
  assert.equal(S(0, -700, 0), 1, 'pod gardzielą');
  assert.equal(S(300, funnelFloorAt(300) - 5, 0), 1, 'pod stożkiem leja');
  assert.equal(S(300, funnelFloorAt(300) + 20, 0), 0, 'nad stożkiem leja');
  assert.ok(Math.abs(POLE.gazFloorCpu(300) - funnelFloorAt(300)) < 1e-9 && POLE.gazFloorCpu(20) === KOMORA.funnel.throatY);
  // wyświetlacz: klin pod pochylonym licem
  const Dp = KOMORA.display;
  assert.equal(S(Dp.rOut - 4, Dp.y + Dp.half - 10, 0), 1);
  assert.equal(S(Dp.rIn - 6, Dp.y, 0), 0, 'przed licem wyświetlacza gaz');
  assert.equal(S(Dp.rIn + 10, Dp.y - Dp.half - 8, 0), 0, 'pod wyświetlaczem gaz');
  // okapy: bryła na azymucie okapu, poza łukiem gaz; środek strefy wlotu na krawędzi wlotu
  const H = KOMORA.gaz.hoods;
  const W = POLE.GAZ_WENT.hood;
  for (const azd of H.az) {
    const a = azd * DEG;
    assert.equal(S(480 * Math.cos(a), -100, 480 * Math.sin(a)), 1, `okap ${azd}°`);
    assert.equal(S(380 * Math.cos(a), -100, 380 * Math.sin(a)), 0);
    const b = (azd + H.half + 6) * DEG;
    assert.equal(S(480 * Math.cos(b), -100, 480 * Math.sin(b)), 0, 'poza łukiem okapu');
    assert.equal(S((W.rho + W.nr * 12) * Math.cos(a), W.y + W.ny * 12, (W.rho + W.nr * 12) * Math.sin(a)), 0, 'nad wlotem gaz');
    assert.equal(S((W.rho - W.nr * 12) * Math.cos(a), W.y - W.ny * 12, (W.rho - W.nr * 12) * Math.sin(a)), 1, 'pod wlotem bryła okapu');
  }
  assert.ok(Math.abs(POLE.gazHoodRhoCpu(-36) - 516) < 1e-9 && Math.abs(POLE.gazHoodRhoCpu(-50) - 470) < 1e-9 && Math.abs(POLE.gazHoodRhoCpu(-80) - 405) < 1e-9 && Math.abs(POLE.gazHoodRhoCpu(-153) - 516) < 1e-9);
  // bryła w środku: elipsoida ze środkiem, półosiami, prędkością i obrotem (powierzchnia ω · (z, 0, −x))
  inp[GI.bodyX] = 10; inp[GI.bodyY] = -20; inp[GI.bodyZ] = 5; inp[GI.bodyRx] = 200; inp[GI.bodyRy] = 120;
  inp[GI.bodyVy] = -300; inp[GI.bodyOm] = 0.5;
  assert.equal(S(10 + 150, -20, 5), 1);
  assert.deepEqual(vel.map((q) => +q.toFixed(6)), [0, -300, -75], 'prędkość bryły: spadek + obrót');
  assert.equal(S(10, -20 + 130, 5), 0, 'nad spłaszczoną bryłą gaz');
  assert.equal(S(10, -20 + 110, 5), 1);
  // obmywanie: nad biegunem spływ w dół, na boku styczny i szybszy niż strumień, pod bryłą waga 0; kąpiel grzeje gaz przy powierzchni
  const w = [0, 0, 0];
  inp[GI.bodyRy] = 200; inp[GI.bodyT] = 0.9;
  assert.ok(POLE.gazWashCpu(10, -20 + 320, 5, inp, w) > 0.9 && w[1] < -10 && Math.abs(w[0]) < 1e-6);
  assert.ok(POLE.gazWashCpu(10 + 230, -20 + 60, 5, inp, w) > 0.5 && w[1] < -POLE.GAZ_FIZ.washU, 'opływ: na boku szybciej niż strumień');
  assert.equal(POLE.gazWashCpu(10 + 230, -20 - 120, 5, inp, w), 0, 'pod bryłą nie ma obmywania');
  assert.ok(Math.abs(POLE.gazBodyHeatCpu(10 + 201, -20, 5, inp) - 0.9) < 0.01 && POLE.gazBodyHeatCpu(10 + 290, -20, 5, inp) === 0);
  // masa w leju: lustro z pierścieni (grubość nad wykładziną), prędkość lustra
  const lake = gasInput();
  for (let j = 0; j < POLE.GAZ_LAKE_N; j++) { lake[GI.lake + j * 2] = j < 12 ? 150 : 0; lake[GI.lake + j * 2 + 1] = j < 12 ? 400 : 0; }
  assert.equal(POLE.gazSolidCpu(100, funnelFloorAt(100) + 100, 0, lake, vel), 1);
  assert.equal(vel[1], 400, 'rosnące lustro wypycha gaz');
  assert.equal(POLE.gazSolidCpu(100, funnelFloorAt(100) + 170, 0, lake, vel), 0);
  assert.equal(POLE.gazSolidCpu(400, funnelFloorAt(400) + 20, 0, lake, vel), 0, 'poza jeziorem gaz');
  // strefy wentylacji leżą w gazie pustej komory, pas pierścienia na wysokości szczeliny
  const zero = gasInput();
  const P1 = POLE.GAZ.presets[1];
  let ring = 0;
  let hood = 0;
  for (let k = 0; k < P1.nz; k++) for (let j = 0; j < P1.ny; j++) for (let i = 0; i < P1.nx; i++) {
    const x = POLE.GAZ.x0 + (i + 0.5) * P1.cell;
    const y = POLE.GAZ.y0 + (j + 0.5) * P1.cell;
    const z = POLE.GAZ.z0 + (k + 0.5) * P1.cell;
    if (POLE.gazSolidCpu(x, y, z, zero, null, POLE.GAZ.y0 + (P1.ny - 1) * P1.cell)) continue;
    if (POLE.gazRingZoneCpu(x, y, z, P1.cell)) {
      ring++;
      assert.ok(y > KOMORA.gaz.ring.y0 - P1.cell && y < KOMORA.gaz.ring.y1 + P1.cell, 'pas pierścienia na wysokości szczeliny');
    } else if (POLE.gazHoodZoneCpu(x, y, z, P1.cell) >= 0) hood++;
  }
  assert.deepEqual({ ring, hood }, POLE.gazZoneCells(P1));
});

test('wytop/gaz pole: fizyka na małej siatce CPU (16 × 17 × 16) — 0 g: gorący kłąb wisi i obraca się z wirem; grawitacja: wznosi się ≥ 5 komórek; bez NaN', () => {
  // 0 g: wir pola pracuje, grawitacji nie ma — środek masy kłębu nie zmienia wysokości o więcej niż komórkę w 2 s
  {
    const inp = gasInput();
    inp[GI.pole] = 1;
    const g = POLE.createGazCpu();
    g.puff(250, 0, 0, 140, 0.2, 0.2, 0.9);
    const s0 = g.stats();
    for (let i = 0; i < 120; i++) g.step(inp);
    const s = g.stats();
    assert.equal(s.nan, 0);
    assert.ok(Math.abs(s.cy - s0.cy) < g.cell, `0 g: kłąb wisi (Δy ${(s.cy - s0.cy).toFixed(1)} j.)`);
    assert.ok(s.cz - s0.cz < -10, `obrót w kierunku wiru: w punkcie (ρ, 0) styczna to −z (Δz ${(s.cz - s0.cz).toFixed(1)} j.)`);
    assert.ok(s.mass > 0.8 * s0.mass && s.mass <= s0.mass * 1.02, 'masa bez upustów: ubywa tylko zanikiem');
  }
  // grawitacja: wypór — gorący kłąb wznosi się o co najmniej 5 komórek w 2 s
  {
    const inp = gasInput();
    inp[GI.grav] = 1;
    const g = POLE.createGazCpu();
    g.puff(300, -250, 0, 140, 0.2, 0.2, 0.9);
    const s0 = g.stats();
    for (let i = 0; i < 120; i++) g.step(inp);
    const s = g.stats();
    assert.equal(s.nan, 0);
    assert.ok(s.cy - s0.cy >= 5 * g.cell, `grawitacja: kłąb wznosi się (${((s.cy - s0.cy) / g.cell).toFixed(2)} komórki)`);
    assert.ok(s.energy > 0);
  }
  // zimny, ciężki dym przy grawitacji opada
  {
    const inp = gasInput();
    inp[GI.grav] = 1;
    const g = POLE.createGazCpu();
    g.puff(250, 150, 0, 140, 1.5, 0, 0);
    const s0 = g.stats();
    for (let i = 0; i < 90; i++) g.step(inp);
    assert.ok(g.stats().cy < s0.cy - 5, 'ciężki dym opada');
    assert.equal(g.stats().nan, 0);
  }
});

test('wytop/gaz pole: upust i źródło (CPU 24 × 26 × 24) — masa wychodzi tylko przez okapy, nawiew jest czysty, źródło wstrzykuje masę rekordu', () => {
  const az = KOMORA.gaz.hoods.az[0] * DEG;
  const run = (wentyl) => {
    const inp = gasInput();
    inp[GI.wentyl] = wentyl;
    const v = POLE.gazVentCpu(wentyl, 0, [0, 0]);
    inp[GI.qRing] = v[0];
    inp[GI.qHood] = v[1];
    const g = POLE.createGazCpu({ nx: 24, ny: 26, nz: 24, decay: 0 });
    assert.ok(g.zones.ring > 0 && g.zones.hood > 0);
    g.puff(330 * Math.cos(az), -40, 330 * Math.sin(az), 120, 0.15, 0.15, 0.3);
    const m0 = g.stats().mass;
    for (let i = 0; i < 150; i++) g.step(inp);
    return { m0, s: g.stats(), removed: g.removed };
  };
  // 0 g: okapy ssą — masa ubywa przez okap; pierścień nawiewa czysty gaz (nic przez niego nie wychodzi)
  const a = run(1);
  assert.equal(a.s.nan, 0);
  assert.ok(a.removed.hood > 0.4 * a.m0, `okap zabrał ${(a.removed.hood / a.m0 * 100).toFixed(0)} % kłębu`);
  assert.ok(a.removed.ring < 0.02 * a.removed.hood, 'przez pierścień górny (nawiew) gaz nie wychodzi');
  assert.equal(a.removed.decay, 0);
  const lost = a.m0 - a.s.mass;
  assert.ok(Math.abs(lost - (a.removed.hood + a.removed.ring + a.removed.solid)) < 0.06 * a.m0, 'ubytek masy = to, co zabrał okap (bilans)');
  // bez wentylacji masa zostaje
  const b = run(0);
  assert.ok(Math.abs(b.m0 - b.s.mass - b.removed.solid) < 0.03 * b.m0, 'bez upustów masa nie ubywa');
  assert.equal(b.removed.hood, 0);
  // źródło: jeden rekord 0,1 t (dym 30 %) — masa pola po kroku = masa rekordu
  const inp = gasInput();
  const o = GI.src;
  const R = POLE.GAZ_SRC;
  inp[o + R.x] = 0; inp[o + R.y] = 0; inp[o + R.z] = 250; inp[o + R.radius] = 90; inp[o + R.dz] = 1; inp[o + R.speed] = 0;
  inp[o + R.dym] = 0.03; inp[o + R.opar] = 0.07; inp[o + R.temp] = 0.8;
  const g = POLE.createGazCpu({ nx: 24, ny: 26, nz: 24, decay: 0 });
  const emit = g.step(inp);
  const s = g.stats();
  assert.ok(Math.abs(emit - 0.1) < 0.003 && Math.abs(s.mass - 0.1) < 0.003, `masa wstrzyknięta ${s.mass}`);
  assert.ok(Math.abs(s.dym - 0.03) < 0.002);
  assert.ok(s.temp > 0.5, 'gaz ze źródła jest gorący');
});

test('wytop/gaz pole: wejście kroku z symulacji — pełny obieg stali: skończone, bryła i światło w fazach, masa źródeł = jednostki, wentylacja z trybu; scalanie kroków; sonda', async () => {
  const { mergeGasInput, analyseColumns } = await import('../dema/ring-dzielnice/huta/wytop/gazKrok.js');
  const { DISPLAY_COOL, DISPLAY_WARM } = await import('../dema/ring-dzielnice/huta/wytop/wyswietlacz.js');
  const { heatPowerJs } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  assert.deepEqual([...WEJ.GAZ_DISPLAY_COOL], DISPLAY_COOL);
  assert.deepEqual([...WEJ.GAZ_DISPLAY_WARM], DISPLAY_WARM);
  for (const T of [0, 0.2, 0.5, 0.9, 1.1, 1.4]) assert.ok(Math.abs(POLE.gazHeatPower(T) - heatPowerJs(T)) < 1e-12, 'moc żaru jak w obrazie komory');
  assert.equal(GI.src + GAZ_SLOTS * GAZ_STRIDE, POLE.GAZ_IN_N);
  assert.ok(GI.lake + POLE.GAZ_LAKE_N * 2 === GI.src && GI.bodyT < GI.lake);
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const S = sim.view.stan;
  const rec = new Float32Array(GAZ_SLOTS * GAZ_STRIDE);
  const inp = WEJ.createGasInput();
  const packer = WEJ.createGasPacker();
  const seen = { heap: 0, ball: 0, none: 0, lake: 0, grav: 0, bell: 0, fall: 0 };
  let units = 0;
  let tons = 0;
  let cycles = 0;
  let prevPhase = sim.phase;
  const body = [0, 0, 0, 0, 0];
  const SR = POLE.GAZ_SRC;
  for (let i = 0; i < 200 * 60 && cycles < 1; i++) {
    sim.step(DT);
    const took = sim.takeGas(rec);
    packer.pack(sim, rec, inp);
    for (let k = 0; k < POLE.GAZ_IN_N; k++) if (!Number.isFinite(inp[k])) assert.fail(`wejście [${k}] nieskończone w fazie ${PHASE_NAMES[sim.phase]}`);
    units += took;
    tons += inp[GI.emitT];
    // masa źródeł w wejściu = jednostki zabrane w tym kroku
    let t = 0;
    for (let q = 0; q < GAZ_SLOTS; q++) t += inp[GI.src + q * GAZ_STRIDE + SR.dym] + inp[GI.src + q * GAZ_STRIDE + SR.opar];
    assert.ok(Math.abs(t - took / UNITS_PER_TON) < 1e-5);
    // (wejście jest w float32: przy wydatkach rzędu 10⁷ j.³/s odstęp liczb to kilka j.³/s)
    assert.ok(Math.abs(inp[GI.qRing] + inp[GI.qHood] + inp[GI.qSrc]) < 2e-6 * (Math.abs(inp[GI.qRing]) + Math.abs(inp[GI.qHood]) + 1), 'bilans objętości wentylacji');
    assert.ok(S[STAN.wentyl] === 0 || Math.sign(inp[GI.qRing]) === Math.sign(S[STAN.wentyl]));
    // bryła
    WEJ.gasBodyOf(S, body);
    assert.ok(Math.abs(inp[GI.bodyRx] - body[3] * WEJ.GAZ_BODY_SHRINK) < 1e-3);
    if (inp[GI.bodyRx] > 0) {
      assert.ok(inp[GI.bodyRx] < 300 && inp[GI.bodyRy] > 0 && inp[GI.bodyRy] < 420);
      if (S[STAN.heapN] > 0 && S[STAN.heapR] > 1) seen.heap++; else seen.ball++;
      assert.ok(inp[GI.lightR] >= 1 && inp[GI.bodyT] >= 0 && inp[GI.bodyT] <= 1);
    } else seen.none++;
    if (inp[GI.bodyVy] < -200) seen.fall++;
    if (inp[GI.grav] > 0.99) seen.grav++;
    if (inp[GI.bellOn] > 0) { seen.bell++; assert.equal(S[STAN.suck], 2); }
    let lakeMax = 0;
    for (let j = 0; j < POLE.GAZ_LAKE_N; j++) lakeMax = Math.max(lakeMax, inp[GI.lake + j * 2]);
    if (lakeMax > 1) { seen.lake++; assert.ok(S[STAN.impactT] >= 0 && inp[GI.bodyRx] === 0, 'masa w leju zamiast kuli'); }
    assert.ok(inp[GI.grav] >= 0 && inp[GI.grav] <= 1 && inp[GI.pole] >= 0 && inp[GI.pole] <= 1);
    for (const k of [GI.lightCr, GI.lightCg, GI.lightCb, GI.dispR, GI.dispG, GI.dispB]) assert.ok(inp[k] >= 0);
    // środek plamy źródła w polu (wysunięty wzdłuż wypływu, wypchnięty z bryły) leży w gazie — bąble, wtopienia, opary ssawy
    for (let q = 0; q < GAZ_SLOTS; q++) {
      const o = GI.src + q * GAZ_STRIDE;
      if (!(inp[o + SR.radius] > 0)) continue;
      const kind = inp[o + SR.kind];
      if (kind !== GAZ_RODZAJ.BABEL && kind !== GAZ_RODZAJ.WTOPIENIE && kind !== GAZ_RODZAJ.SSAWA) continue;
      const r = POLE.gazSourceCenterCpu(inp, o, POLE.GAZ.presets[1].cell, body);
      assert.ok(r >= POLE.GAZ_FIZ.srcMinCells * POLE.GAZ.presets[1].cell - 1e-9);
      assert.equal(POLE.gazSolidCpu(body[0], body[1], body[2], inp), 0, `środek plamy źródła rodzaju ${kind} leży w gazie`);
    }
    if (sim.phase !== prevPhase) { if (sim.phase === PHASE.EMPTY) cycles++; prevPhase = sim.phase; }
  }
  assert.ok(cycles >= 1);
  assert.ok(Math.abs(tons - units / UNITS_PER_TON) < 0.01, 'cały gaz obiegu przeszedł przez wejście pola');
  for (const [k, n] of Object.entries(seen)) assert.ok(n > 10, `w obiegu wystąpiło: ${k}`);
  // scalanie zaległych kroków: stan z nowszego, masy źródeł zsumowane (gaz nie ginie)
  const A = WEJ.createGasInput();
  const B = WEJ.createGasInput();
  const o = GI.src + 3 * GAZ_STRIDE;
  A[o + SR.dym] = 0.02; A[o + SR.opar] = 0.01; A[o + SR.radius] = 40; A[GI.emitT] = 0.03; A[GI.wentyl] = 1;
  B[o + SR.dym] = 0.01; B[o + SR.opar] = 0.04; B[o + SR.radius] = 30; B[GI.emitT] = 0.05; B[GI.wentyl] = -1;
  const o2 = GI.src + 9 * GAZ_STRIDE;
  A[o2 + SR.opar] = 0.5; A[o2 + SR.radius] = 20; A[GI.emitT] += 0.5;
  mergeGasInput(A, B);
  assert.ok(Math.abs(A[o + SR.dym] - 0.03) < 1e-7 && Math.abs(A[o + SR.opar] - 0.05) < 1e-7 && A[o + SR.radius] === 30);
  assert.ok(Math.abs(A[o2 + SR.opar] - 0.5) < 1e-7, 'rekord tylko ze starszego kroku zostaje');
  assert.ok(Math.abs(A[GI.emitT] - 0.58) < 1e-6 && A[GI.wentyl] === -1);
  // sonda kolumn: strefy kryteriów na mapie syntetycznej (gaz tylko w pierścieniu)
  const nx = 64;
  const data = new Float32Array(nx * nx * 4);
  for (let k = 0; k < nx; k++) for (let i = 0; i < nx; i++) {
    const rho = Math.hypot(POLE.GAZ.x0 + (i + 0.5) * 16.5, POLE.GAZ.z0 + (k + 0.5) * 16.5);
    if (rho > 262 && rho < 448) { data[(k * nx + i) * 4 + 1] = 0.5; data[(k * nx + i) * 4 + 2] = 1; }
  }
  const an = analyseColumns({ nx, nz: nx, cell: 16.5, data }, 240, 0, 0);
  assert.ok(an.kula.srednia === 0 && an.kula.n > 400, 'tarcza kuli czysta');
  assert.ok(Math.abs(an.pierscien.srednia - (1 - Math.exp(-0.5))) < 0.02 && an.pierscien.p95 > 0.39);
  assert.equal(an.wyswietlacz.srednia, 0);
  assert.ok(an.masa.dym > 0 && an.masa.opar === 0);
});

test('wytop/gaz: bąbel kąpieli zostawia zmarszczkę na kuli (tylko obraz: bez licznika i bez modów — przebieg symulacji bez zmian)', () => {
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const C = sim.counters;
  while (!(sim.phase === PHASE.FEED && sim.view.stan[STAN.phaseT] > 3)) sim.step(DT);
  const b0 = C[LICZNIK.bubbles];
  let weak = 0;
  const seenAt = new Set();
  const Rp = sim.view.zmarszczki;
  const stride = Rp.length / 32;
  for (let i = 0; i < 40 * 60 && sim.phase === PHASE.FEED; i++) {
    sim.step(DT);
    for (let k = 0; k < 32; k++) {
      const amp = Rp[k * stride + 4];
      // zmarszczka bąbla: siła 0,18…0,3 (0,3 siły zmarszczki ziarna 0,6…1)
      if (amp > 0.17 && amp < 0.31 && !seenAt.has(Rp[k * stride + 3])) { seenAt.add(Rp[k * stride + 3]); weak++; }
    }
  }
  const bubbles = C[LICZNIK.bubbles] - b0;
  assert.ok(bubbles > 4, 'w dokarmianiu pękają bąble');
  assert.ok(weak >= 4, `zmarszczki bąbli w puli: ${weak} przy ${bubbles} bąblach`);
});

// --- WGSL ---------------------------------------------------------------------

/** Ciało funkcji `main` shadera. */
const mainOfWgsl = (src) => src.slice(src.indexOf('fn main'));
/** Zmienne WGSL z `main` przypisane PRZED pierwszym odczytem (pułapki 36 / 39 three r183). */
function gasUseBeforeAssign(src) {
  const main = mainOfWgsl(src);
  const body = main.slice(main.indexOf('// code'));
  const assigned = new Set();
  const bad = [];
  for (const line of body.split('\n')) {
    const plain = line.match(/^\s*(nodeVar\d+) = /);
    const rhs = plain ? line.slice(line.indexOf('=') + 1) : line;
    for (const m of rhs.matchAll(/\bnodeVar\d+\b/g)) if (!assigned.has(m[0])) bad.push(`${m[0]}: ${line.trim().slice(0, 90)}`);
    if (plain) assigned.add(plain[1]);
  }
  return bad;
}

test('wytop/gaz pole: WGSL kerneli buduje się w Node — jedna tekstura pisana, pisanej nie czyta, najwyżej trzy czytane, wątki × 64, zmienne przed użyciem, ten sam graf = ten sam kod', async () => {
  const THREE = await import('three/webgpu');
  const { GazSiatka, GAZ_LOOK } = await import('../dema/ring-dzielnice/huta/wytop/gazSiatka.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const cs = (node) => { const b = renderer.backend.createNodeBuilder(node, renderer); b.build(); return b.computeShader; };
  const codeOf = {};
  for (const preset of [0, 1, 2]) {
    const g = new GazSiatka({ preset });
    const P = POLE.GAZ.presets[preset];
    assert.equal(g.cells, P.nx * P.ny * P.nz);
    assert.deepEqual(g.zones, POLE.gazZoneCells(P));
    const names = new Set();
    for (const k of g.kernels) {
      const name = k.node.name;
      assert.ok(name && !names.has(name), `kernel ma własną nazwę: ${name}`);
      names.add(name);
      assert.equal(k.node.count % 64, 0, `${name}: liczba wątków podzielna przez 64`);
      // opis kernela: pisze jedną teksturę (sonda — bufor), nie czyta pisanej, czyta najwyżej trzy
      assert.ok(!k.reads.includes(k.writes), `${name}: nie czyta tekstury, którą pisze`);
      assert.ok(k.reads.length <= 3, `${name}: najwyżej trzy tekstury czytane`);
      if (preset !== 1 && !/Predkosc|Korekta|Obraz/.test(name)) continue;       // pełna budowa WGSL: preset zwykły + kernele o treści zależnej od presetu
      const code = cs(k.node);
      if (preset === 1) codeOf[name] = code;
      assert.ok(!/NaN|undefined/.test(code), `${name}: bez NaN`);
      const stores = (code.match(/texture_storage_[23]d<rgba16float, write>/g) || []).length;
      const sampled = (code.match(/: texture_[23]d<f32>/g) || []).length;
      assert.equal(stores, k.writes ? 1 : 0, `${name}: zapis do jednej tekstury RGBA16F`);
      assert.equal(sampled, k.reads.length, `${name}: tekstury czytane w WGSL = opis`);
      assert.ok((code.match(/var<uniform>/g) || []).length <= 12, `${name}: bufory uniformów`);
      assert.deepEqual(gasUseBeforeAssign(code), [], `${name}: zmienne przypisane przed użyciem`);
      assert.ok(!/\bdiscard\b/.test(code));
    }
    // krok: kolejność — Jacobi nieparzystą liczbę razy (wynik w prsB), obraz i mapa kolumn na końcu
    const list = g._list.map((n) => n.name);
    assert.deepEqual(list.slice(0, 5), ['gazWiry', 'gazPredkosc', 'gazSkalaryPrzod', 'gazSkalaryKorekta', 'gazDywergencja']);
    assert.equal(list.filter((n) => n.startsWith('gazJacobi')).length, P.jacobi);
    assert.equal(list[5 + P.jacobi - 1], 'gazJacobiAB');
    assert.deepEqual(list.slice(5 + P.jacobi), ['gazRzut', 'gazPrzepisz', 'gazObrazA', 'gazKolumny']);
    assert.equal(!!g.obrB, P.blend);
    // pamięć: siatka prędkości + gęstsza siatka skalarów i obrazu (oszczędny / zwykły / wysoki)
    assert.ok(g.bytes < [32, 112, 176][preset] * 1048576, `pamięć presetu ${preset}: ${(g.bytes / 1048576).toFixed(1)} MB`);
    assert.equal(g.scells, P.snx * P.sny * P.snz);
    g.dispose();
  }
  // treść kerneli (preset zwykły)
  assert.match(codeOf.gazPredkosc, /GazMasa/, 'lustro masy w leju z tablicy o stałej nazwie');
  assert.match(codeOf.gazPredkosc, /GazZrodlaA/);
  assert.match(codeOf.gazSkalaryKorekta, /GazZrodlaC/);
  for (const k of ['gazPredkosc', 'gazSkalaryPrzod', 'gazSkalaryKorekta', 'gazRzut']) assert.match(codeOf[k], /f16RoundBias/, `${k}: zapis z zaokrągleniem stochastycznym`);
  assert.ok(!/f16RoundBias/.test(codeOf.gazJacobiAB), 'ciśnienie bez zaokrąglenia stochastycznego');
  assert.match(codeOf.gazObrazA, /while|for \(|loop/, 'cień własny: pętla ku światłu');
  // ten sam graf = ten sam kod (druga siatka tego samego presetu)
  const g2 = new GazSiatka({ preset: 1 });
  for (const k of g2.kernels) assert.equal(cs(k.node), codeOf[k.node.name], `${k.node.name}: ten sam graf = ten sam kod`);
  // wejście → uniformy: źródła upakowane od początku, plama nie mniejsza niż 1,6 komórki, masa unormowana
  const inp = gasInput();
  const o = GI.src + 20 * GAZ_STRIDE;
  const R = POLE.GAZ_SRC;
  inp[o + R.x] = 100; inp[o + R.y] = 50; inp[o + R.z] = -30; inp[o + R.radius] = 18; inp[o + R.dx] = 1; inp[o + R.speed] = 200; inp[o + R.dym] = 0.01; inp[o + R.opar] = 0.02; inp[o + R.temp] = 0.95;
  inp[GI.pole] = 1; inp[GI.wentyl] = 1; inp[GI.qRing] = POLE.GAZ_FIZ.q0; inp[GI.qHood] = -POLE.GAZ_FIZ.q0; inp[GI.bodyRx] = 200; inp[GI.bodyRy] = 200;
  g2.setInput(inp);
  assert.equal(g2.U.k.value.w, 1, 'jedno czynne źródło');
  const rr = Math.max(18, POLE.GAZ_FIZ.srcMinCells * g2.srcCell);
  const st0 = POLE.gazSourceStretch(inp[o + R.kind]);
  inp[GI.bodyRx] = 0;
  g2.setInput(inp);
  assert.ok(Math.abs(g2.U.srcA.array[0].w - rr) < 1e-4 && Math.abs(g2.U.srcA.array[0].x - (100 + 0.55 * rr * st0)) < 1e-3, 'plama wysunięta wzdłuż wypływu');
  assert.ok(Math.abs(Math.hypot(g2.U.srcB.array[0].x, g2.U.srcB.array[0].y, g2.U.srcB.array[0].z) - st0) < 1e-5, 'kierunek × wydłużenie plamy');
  inp[GI.bodyRx] = 200;
  g2.setInput(inp);
  assert.ok(Math.hypot(g2.U.srcA.array[0].x, g2.U.srcA.array[0].y, g2.U.srcA.array[0].z) >= 200 * 1.05, 'plama wypchnięta z bryły środkowej');
  const norm = 1e6 * 105 / (32 * Math.PI * rr * rr * rr) / st0;
  assert.ok(Math.abs(g2.U.srcC.array[0].x - 0.01 * norm) < 1e-3 * norm && Math.abs(g2.U.srcC.array[0].y - 0.02 * norm) < 1e-3 * norm);
  assert.ok(g2.U.vent.value.x > 0 && g2.U.vent.value.y < 0 && g2.U.vent.value.z < 0, 'pierścień nawiewa ku osi, okapy ssą');
  assert.ok(g2.U.vent2.value.x > 0 && g2.U.vent2.value.y === 0 && g2.U.k2.value.x > 0);
  inp[GI.wentyl] = -1; inp[GI.qRing] = -2 * POLE.GAZ_FIZ.q0; inp[GI.qHood] = 2 * POLE.GAZ_FIZ.q0;
  g2.setInput(inp);
  assert.ok(g2.U.vent.value.x < 0 && g2.U.vent.value.y > 0 && g2.U.vent2.value.y > 0 && g2.U.vent2.value.x === 0 && g2.U.k2.value.x === 0, 'grawitacja: role odwrócone, bez obmywania');
  // regulator masy: dodatkowy zanik w mnożniku kroku; przymknięcie zaniku podstawowego
  const base = g2.U.k2.value.z;
  g2.extraDecay = 2;
  g2.setInput(inp);
  assert.ok(g2.U.k2.value.z < base && Math.abs(g2.U.k2.value.z - Math.exp(-(POLE.GAZ_FIZ.decay + 2) * DT)) < 1e-6);
  g2.extraDecay = 0;
  g2.removalK = 0.05;
  g2.setInput(inp);
  assert.ok(g2.U.k2.value.z > base);
  assert.ok(GAZ_LOOK.knee < 0.9, 'kolano jasności pod progiem bloomu');
  g2.dispose();
});

test('wytop/gaz obraz: materiały marszu (PRZÓD, TYŁ) i tarczy drgania budują się w Node — pętla za flagą, bez discard, zmienne przed użyciem, ten sam kod; wybór bryły po kamerze, przenikanie stanów', async () => {
  const THREE = await import('three/webgpu');
  const { GazSiatka } = await import('../dema/ring-dzielnice/huta/wytop/gazSiatka.js');
  const { GazObraz, GAZ_RENDER_ORDER } = await import('../dema/ring-dzielnice/huta/wytop/gazObraz.js');
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
    return { v: b.vertexShader, f: b.fragmentShader };
  };
  const grid = new GazSiatka({ preset: 1 });
  const ob = new GazObraz({ grid });
  const front = build(ob.front);
  const back = build(ob.back);
  const heat = build(ob.heat);
  for (const s of [front, back, heat]) {
    assert.ok(!/NaN|undefined/.test(s.f + s.v));
    assert.ok(!/\bdiscard\b/.test(s.f), 'bez discard (pułapka 13)');
    assert.deepEqual(gasUseBeforeAssign(s.f), [], 'zmienne przypisane przed użyciem');
  }
  assert.equal(front.f, back.f, 'PRZÓD i TYŁ: ten sam graf marszu');
  // pętla marszu za flagą: `if (…) { … pętla … }`, w pętli dwa odczyty obrazu (stan poprzedni i bieżący)
  const main = mainOfWgsl(front.f);
  const loopAt = main.search(/\bwhile\b|\bfor\s*\(|\bloop\b/);
  const ifAt = main.lastIndexOf('if (', loopAt);
  assert.ok(loopAt > 0 && ifAt > 0 && !main.slice(ifAt, loopAt).includes('}'), 'pętla marszu wewnątrz warunku (piksele bez odcinka w gazie jej nie liczą)');
  assert.equal((main.slice(loopAt).match(/textureSampleLevel/g) || []).length, 2, 'dwa stany obrazu w kroku marszu');
  assert.equal((front.f.match(/: texture_3d<f32>/g) || []).length, 2);
  assert.match(heat.f, /: texture_2d<f32>/, 'tarcza drgania czyta mapę kolumn');
  // ten sam graf = ten sam kod
  const ob2 = new GazObraz({ grid: new GazSiatka({ preset: 1 }) });
  assert.equal(build(ob2.front).f, front.f);
  assert.equal(build(ob2.heat).f, heat.f);
  // preset oszczędny: jeden odczyt w kroku (bez przenikania)
  const ob0 = new GazObraz({ grid: new GazSiatka({ preset: 0 }) });
  const f0 = mainOfWgsl(build(ob0.front).f);
  assert.equal((f0.slice(f0.search(/\bwhile\b|\bfor\s*\(|\bloop\b/)).match(/textureSampleLevel/g) || []).length, 1);
  // stan materiałów: premultiplied, bez zapisu głębi; PRZÓD z testem głębi (pokład zasłania), TYŁ bez; kolejność przed błoną i iskrami
  for (const m of [ob.front, ob.back]) {
    assert.equal(m.material.depthWrite, false);
    assert.equal(m.material.blendSrc, THREE.OneFactor);
    assert.equal(m.material.blendDst, THREE.OneMinusSrcAlphaFactor);
    assert.equal(m.renderOrder, GAZ_RENDER_ORDER);
    assert.equal(m.visible, false);
  }
  assert.ok(GAZ_RENDER_ORDER < 28, 'gaz przed błoną bramy, kroplami, błyskami i iskrami');
  assert.equal(ob.front.material.depthTest, true);
  assert.equal(ob.front.material.side, THREE.FrontSide);
  assert.equal(ob.back.material.depthTest, false);
  assert.equal(ob.back.material.side, THREE.BackSide);
  assert.equal(ob.heat.material.blendDst, THREE.OneFactor);
  // klatka: kamera z góry → PRZÓD, kamera w studni → TYŁ; wagi stanów z ułamka kroku i z tego, który stan jest bieżący
  ob.frame({ cam: [84, 2460, 0], alpha: 0.25, frame: 3, body: [0, 0, 0, 240, 240], on: true });
  assert.ok(ob.front.visible && !ob.back.visible);
  assert.deepEqual([ob.U.mixAB.value.x, ob.U.mixAB.value.y], [0.25, 0.75], 'bieżący obrA: waga = ułamek kroku');
  assert.ok(Math.abs(ob.U.body.value.w - 240 * 1.02) < 1e-4);
  grid.flip = 1;
  ob.frame({ cam: [100, 0, 50], alpha: 0.25, frame: 4, body: [0, 0, 0, 0, 0], on: true });
  assert.ok(!ob.front.visible && ob.back.visible);
  assert.deepEqual([ob.U.mixAB.value.x, ob.U.mixAB.value.y], [0.75, 0.25], 'bieżący obrB');
  assert.ok(ob.U.body.value.y < -1e5, 'bez bryły: elipsoida poza komorą');
  ob.frame({ cam: [84, 2460, 0], alpha: 1, frame: 5, body: null, on: false });
  assert.ok(!ob.front.visible && !ob.back.visible, 'gaz wyłączony / uśpiony — bryły ukryte');
  assert.equal(ob.placeHeat(10, 20, 900, 5, 0), false);
  assert.ok(ob.placeHeat(10, 20, 900, 5, 1) && ob.heat.visible && ob.heat.matrixWorld.elements[12] === 10 && ob.heat.matrixWorld.elements[0] === 900);
});
