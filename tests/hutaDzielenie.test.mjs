// HUTA — element 4: DZIELENIE TAŚMY NA ARKUSZE (runda 8: nóż) i (runda 9) LOT, CHWYT, GRZEBIEŃ, KASETY — testy modelu,
// wiarygodności ruchu, brył i materiałów (bez czasu ściany). Projekty: `.tmp/huta/formowanie/PROJEKT-dzielenie.md`,
// `.tmp/huta/formowanie/PROJEKT-chwyt-zwijanie.md` § 8.6. Moduły: `dema/ring-dzielnice/huta/dzielenie/`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KOMORA } from '../dema/ring-dzielnice/huta/wytop/geometria.js';
import { LICZNIK, STAN, UNITS_PER_TON, createMeltChamber } from '../dema/ring-dzielnice/huta/wytop/komora.js';
import { Budowniczy } from '../dema/ring-dzielnice/huta/wytop/wyposazenie.js';
import { HALA, WIDOKI } from '../dema/ring-dzielnice/huta/formowanie/geometria.js';
import { KAW, KAW_N, LIN_STAN, LIN_WEJ, LIN_WEJ_N, PASMO, PL, createFormingLine } from '../dema/ring-dzielnice/huta/formowanie/linia.js';
import { WALC, createRollingMill } from '../dema/ring-dzielnice/huta/formowanie/walcownia.js';
import { ZGORZ, createScaleDebris } from '../dema/ring-dzielnice/huta/formowanie/zgorzelina.js';
import { buildRollingMill } from '../dema/ring-dzielnice/huta/formowanie/walcowniaBryly.js';
import {
  CHWYT, DZIEL, FRONT_MAX, HALF_T, KASETA, PRZETOP, STOJAK, U_FRONT, U_HOME, WOLNE, XB, X_FRONT, camG, camGp, camGpp, camX, slotZ
} from '../dema/ring-dzielnice/huta/dzielenie/geometria.js';
import {
  ARK, ARK_CAP, ARK_N, ARK_ST, LICZ, MARSZ, MV, MV_N, NOZ, NOZ_ST, PED, PROGRAM, PRZYCZYNA, RODZAJ, URZ,
  classifyPiece, createDivider, edgeExcess, edgeWidth
} from '../dema/ring-dzielnice/huta/dzielenie/model.js';
import { KAS, KAS_CAP, KAS_LIST, KAS_N, KAS_ST } from '../dema/ring-dzielnice/huta/dzielenie/stojak.js';
import { brakeRamp, evalQuintic, marchCam, motionX, planFlight, planQuintic } from '../dema/ring-dzielnice/huta/dzielenie/lot.js';
import { DZ_MARK, buildDivider, dividerBoxes } from '../dema/ring-dzielnice/huta/dzielenie/bryly.js';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

const DT = 1 / 60;
const H = 1 / 240;
const UT = UNITS_PER_TON;
const P = DZIEL.P;
const HALF_PI = Math.PI / 2;
/** Ciało powstało w ostatnim podkroku. */
const fresh = (B, o) => B[o + ARK.age] <= 1.5 * H;

/** Linia z walcownią i dzieleniem (rozbieg strony z błoną 250 t albo zimna). */
function rig({ seed = 11, metal = 0, cold = false, odbior = 'auto', chwyt = true, prefillTons = 250 } = {}) {
  const mill = createRollingMill();
  const div = createDivider({ odbior, chwyt });
  const line = createFormingLine({ seed, metal, cold, kin: mill, divider: div, prefillTons });
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.tempT] = 1;
  inp[LIN_WEJ.metal] = metal;
  return { mill, div, line, inp };
}
/** Krok strony podkrokami (sprawdzenie po każdym): `inp.units` oddane w pierwszym podkroku. */
function stepPage(r, check) {
  const u = r.inp[LIN_WEJ.units];
  for (let k = 0; k < 4; k++) {
    if (k === 1) r.inp[LIN_WEJ.units] = 0;
    r.line.step(H, r.inp);
    if (check) check();
  }
  r.inp[LIN_WEJ.units] = u;
}
function feed(sim, inp, last, metal = 0) {
  const S = sim.view.stan;
  const C = sim.counters;
  inp[LIN_WEJ.units] = C[LICZNIK.delivered] - last.v;
  last.v = C[LICZNIK.delivered];
  inp[LIN_WEJ.tempT] = S[STAN.temp];
  inp[LIN_WEJ.head] = S[STAN.level] - KOMORA.funnel.throatY;
  inp[LIN_WEJ.metal] = metal;
  inp[LIN_WEJ.impactT] = S[STAN.impactT];
  inp[LIN_WEJ.funnelUnits] = C[LICZNIK.funnel];
  inp[LIN_WEJ.twist] = S[STAN.twist];
}
/** Spływ syntetyczny (rampa 0,9 s → 36 t/s → ogon 8 t/s), razem `tons`. */
function syntheticDump(tons = 240) {
  const per = 36 * UT / 60;
  let left = Math.round(tons * UT);
  let t = 0;
  return () => {
    if (left <= 0) return 0;
    t += DT;
    let u = Math.round(t < 0.9 ? per * t / 0.9 : left < 8 * UT ? 8 * UT / 60 : per);
    u = Math.max(1, Math.min(u, left));
    left -= u;
    return u;
  };
}
/** Czoło najstarszego pasma i jego prędkość. */
function front(line) {
  const n = line.view.ring[1];
  if (!n) return null;
  const o = line.sliceOffset(0);
  return { x: line.view.slices[o + PL.s], u: line.view.slices[o + PL.u] };
}
const bodies = (div, fn) => { const B = div.view.bodies; for (let i = 0; i < ARK_CAP; i++) if (B[i * ARK_N + ARK.st] !== ARK_ST.WOLNY) fn(i * ARK_N, i); };

/** Przekrój płyty w (z, y): środek grubości od zawiasu wzdłuż szerokości (odcinek) i grubość. */
function plate(B, MVR, i) {
  const o = i * ARK_N;
  const th = B[o + ARK.th];
  const t = 0.5 * (B[o + ARK.tB] + B[o + ARK.tF]);
  const yb = B[o + ARK.y] - HALF_T;
  return { z0: B[o + ARK.z] - 0.5 * t * Math.sin(th), y0: yb + 0.5 * t * Math.cos(th), dz: Math.cos(th), dy: Math.sin(th), W: 2 * MVR[i * MV_N + MV.hw], t, x0: B[o + ARK.x], x1: B[o + ARK.x] + B[o + ARK.len] };
}
/** Odległość dwóch odcinków przekroju (próbkowanie co 5 j. + rzut). */
function segDist(a, b) {
  let d = 1e9;
  for (let i = 0; i <= 40; i++) {
    const pz = a.z0 + a.dz * a.W * i / 40; const py = a.y0 + a.dy * a.W * i / 40;
    let s = (pz - b.z0) * b.dz + (py - b.y0) * b.dy; s = Math.max(0, Math.min(b.W, s));
    d = Math.min(d, Math.hypot(pz - b.z0 - b.dz * s, py - b.y0 - b.dy * s));
  }
  return d;
}

/**
 * PRZEBIEG RUCHU: linia z dzieleniem przy Q stałym albo rampie 0,7 → 1,4 Q w 3 s; po każdym podkroku liczy dla każdego
 * ciała środek masy (z modelu: tył, zawias, θ), jego prędkość, przyspieszenie i zryw RÓŻNICOWO (niezależnie od analityki
 * modelu), znaki prędkości, prześwity (czoło pasma, pasmo pod arkuszem, płyta n ↔ n+1), lot swobodny co do bitu,
 * prędkość względna przy chwycie i w slocie, położenia spoczynku, kolejkę, kasety, bilans masy i pędu.
 */
function motionRun(mode, { metal = 0, sec = 48, seed = 11 } = {}) {
  const r = rig({ seed, metal });
  const B = r.div.view.bodies;
  const MVR = r.div.view.mov;
  const KS = r.div.view.kas;
  const F = r.div.view.flight;
  const st = { mode, axMax: 0, aMax: 0, jMax: 0, azHinge: 0, aKas: 0, gap: 1e9, under: 1e9, pair: 1e9, front: 0, rest: 0, slot: 0, vzPos: 0, vxNeg: 0, freeVar: 0, freeChecked: 0, grabDv: 0, landDv: 0, order: 0, pitch: 1e9, bal: 0, ped: 0, grabbed: 0, scrap: 0, cas: 0, kasOverlap: 0 };
  const hist = new Map();
  const kasPrev = new Float64Array(KAS_CAP * 4).fill(NaN);
  const qAt = (t) => (mode === 'rampa' ? (t < 20 ? 0.7 : Math.min(1.4, 0.7 + 0.7 * (t - 20) / 3)) : mode);
  for (let i = 0; i < sec * 240; i++) {
    const t = i * H;
    if (i > 240) r.line.setQ(qAt(t));
    r.line.step(H, r.inp);
    const la = r.line.audit(); const da = r.div.audit();
    if (la.balance !== 0 || la.mismatch !== 0 || da.balance !== 0 || da.mismatch !== 0 || da.line !== 0) st.bal++;
    st.ped = Math.max(st.ped, da.ped);
    const fr = front(r.line);
    const live = [];
    for (let k = 0; k < ARK_CAP; k++) {
      const o = k * ARK_N;
      const s = B[o + ARK.st];
      if (s === ARK_ST.WOLNY) continue;
      const seq = B[o + ARK.seq];
      let h = hist.get(seq);
      if (!h) { h = { p: null, st: s, vFree: null }; hist.set(seq, h); if (s === ARK_ST.LOT) st.grabbed++; else st.scrap++; }
      const th = B[o + ARK.th];
      const tk = 0.5 * (B[o + ARK.tB] + B[o + ARK.tF]);
      const W = 2 * MVR[k * MV_N + MV.hw];
      const c = [B[o + ARK.x] + 0.5 * B[o + ARK.len], B[o + ARK.y] - HALF_T + 0.5 * W * Math.sin(th) + 0.5 * tk * Math.cos(th), B[o + ARK.z] + 0.5 * W * Math.cos(th) - 0.5 * tk * Math.sin(th)];
      const p = h.p;
      const v = p ? c.map((q, j) => (q - p.c[j]) / H) : null;
      const a = v && p.v ? v.map((q, j) => (q - p.v[j]) / H) : null;
      if (a && p.a && B[o + ARK.age] > 5 * H) {
        const am = Math.hypot(a[0], a[1], a[2]);
        st.aMax = Math.max(st.aMax, am);
        st.jMax = Math.max(st.jMax, Math.hypot((a[0] - p.a[0]) / H, (a[2] - p.a[2]) / H));
        if (s >= ARK_ST.KASETA && s <= ARK_ST.WYJAZD) st.aKas = Math.max(st.aKas, am);
      }
      h.p = { c, v, a };
      st.axMax = Math.max(st.axMax, Math.abs(B[o + ARK.ax0]));
      if (s === ARK_ST.GRZEBIEN) st.azHinge = Math.max(st.azHinge, Math.abs(B[o + ARK.az0]));
      if (B[o + ARK.vz] > 1e-9) st.vzPos++;
      if (B[o + ARK.vx] < -1e-9 && s <= ARK_ST.GRZEBIEN) st.vxNeg++;
      if (s === ARK_ST.LOT) {
        const ts = B[o + ARK.tS];
        st.front = Math.max(st.front, B[o + ARK.x] + B[o + ARK.len]);
        // LOT SWOBODNY: od końca wyrzutu do chwytu prędkość (x, y, z, ω) stała co do bitu, żadne urządzenie
        if (ts > CHWYT.kick.t + 1e-9 && ts < F[k][2]) {
          const key = `${B[o + ARK.vx]}|${B[o + ARK.vy]}|${B[o + ARK.vz]}|${B[o + ARK.om]}`;
          if (h.vFree === null) h.vFree = key; else if (key !== h.vFree) st.freeVar++;
          if (B[o + ARK.dev] !== URZ.BRAK) st.freeVar++;
          st.freeChecked++;
        }
        // CHWYT bez skoku: prędkość przed i po chwili chwytu (pole jedzie z krawędzią)
        if (h.prevTs !== undefined && h.prevTs < F[k][2] && ts >= F[k][2]) st.grabDv = Math.max(st.grabDv, Math.abs(B[o + ARK.vx] - h.prevVx));
        h.prevTs = ts; h.prevVx = B[o + ARK.vx];
        if (ts >= F[k][2] + F[k][7]) st.rest = Math.max(st.rest, Math.abs(B[o + ARK.x] - CHWYT.xStop));
        const lift = B[o + ARK.y] - (HALA.passY);
        if (fr && lift < 10 && B[o + ARK.age] > H) st.gap = Math.min(st.gap, B[o + ARK.x] - fr.x);
        if (fr && lift >= 10 && fr.x > B[o + ARK.x] && th < 0.05) st.under = Math.min(st.under, lift - 9);
        live.push(k);
      } else if (s === ARK_ST.GRZEBIEN) live.push(k);
      // ODŁOŻENIE w slot: prędkość względna kaseta ↔ arkusz (kaseta stoi w załadunku) i położenie
      if (s === ARK_ST.KASETA && h.st === ARK_ST.GRZEBIEN) {
        st.landDv = Math.max(st.landDv, Math.hypot(h.vLast || 0, 0));
        st.slot = Math.max(st.slot, Math.abs(B[o + ARK.z] - slotZ(B[o + ARK.slot])));
      }
      h.vLast = B[o + ARK.vz];
      h.st = s;
    }
    // płyta n ↔ n+1 (przekroje, zachodzące zakresy x)
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
      const A = plate(B, MVR, live[a]); const Bp = plate(B, MVR, live[b]);
      if (Math.min(A.x1, Bp.x1) - Math.max(A.x0, Bp.x0) <= 0) continue;
      st.pair = Math.min(st.pair, segDist(A, Bp) - 0.5 * (A.t + Bp.t));
    }
    // kolejka grzebienia: kolejność cięć, podziałka
    const Q = r.div.view.kolejka; const QN = r.div.view.kolejkaN[0];
    for (let j = 1; j < QN; j++) {
      if (B[Q[j - 1] * ARK_N + ARK.seq] > B[Q[j] * ARK_N + ARK.seq]) st.order++;
      st.pitch = Math.min(st.pitch, B[Q[j] * ARK_N + ARK.z] - B[Q[j - 1] * ARK_N + ARK.z]);
    }
    // kasety: ramy nie zachodzą na siebie (pudła w planie), przyspieszenie z różnic
    for (let c = 0; c < KAS_CAP; c++) {
      const o = c * KAS_N;
      if (KS[o + KAS.st] === KAS_ST.WOLNA) { kasPrev[c * 4] = NaN; continue; }
      for (let d = c + 1; d < KAS_CAP; d++) {
        const q = d * KAS_N;
        if (KS[q + KAS.st] === KAS_ST.WOLNA) continue;
        const ox = (KASETA.x1 - KASETA.x0) - Math.abs(KS[o + KAS.dx] - KS[q + KAS.dx]);
        const oz = (KASETA.z1 - KASETA.z0) - Math.abs(KS[o + KAS.dz] - KS[q + KAS.dz]);
        if (ox > -3 && oz > -3) st.kasOverlap++;
      }
    }
  }
  st.cas = r.div.view.licz[LICZ.kaset];
  st.licz = Array.from(r.div.view.licz);
  return st;
}

// ---------------------------------------------------------------------------------------------------------------------
test('dzielenie/krzywka: okres, okno synchronizacji, skok 251 j., zawroty, x rozdzielenia stałe', () => {
  let acc = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) acc += camGp((i + 0.5) / n) / n;
  assert.ok(Math.abs(acc) < 1e-6, `∮ g' = ${acc}`);
  assert.ok(Math.abs(camG(1) - camG(0)) < 1e-12 && Math.abs(camG(0.3) - camG(1.3)) < 1e-12, 'g okresowa');
  for (let u = 0; u <= DZIEL.W_SYNC; u += 0.001) assert.equal(camGp(u), 1, `g' w oknie (${u})`);
  let gmax = 0;
  for (let i = 0; i <= 4000; i++) {
    const u = i / 4000;
    gmax = Math.max(gmax, Math.abs(camGpp(u)));
    const d = (camG(u + 1e-6) - camG(u - 1e-6)) / 2e-6;
    assert.ok(Math.abs(d - camGp(u)) < 1e-4, `g' = dg/du przy ${u}`);
  }
  assert.ok(gmax < 8.6 && gmax > 8.3, `g'' max ${gmax}`);
  assert.ok(Math.abs(camGp(U_HOME)) < 1e-9 && Math.abs(camGp(U_FRONT)) < 1e-9, 'zawroty: g\' = 0');
  assert.ok(Math.abs(camX(U_HOME) - DZIEL.X_HOME) < 1e-9, 'spoczynek X_HOME');
  assert.ok(Math.abs(X_FRONT - DZIEL.X_HOME - 251) <= 1, `skok wózka ${(X_FRONT - DZIEL.X_HOME).toFixed(2)}`);
  assert.ok(Math.abs(XB - 3585.75) < 0.2, `XB ${XB}`);
  assert.ok(FRONT_MAX < PASMO.sExit - 20, 'najdalsze czoło przed końcem drogi pasma');
});

test('dzielenie/prawo ruchu (analitycznie): wyrzut Δv, hamowanie do xStop, rampa ciągła, podziałka 1 w okresie, plan pięciomianowy bez cofania', () => {
  const RB = new Float64Array(3);
  const MX = new Float64Array(4);
  const Fp = new Float64Array(9);
  for (const v0 of [234, 334, 468]) {
    planFlight(XB + 1, v0, true, Fp);
    assert.ok(Math.abs(Fp[0] - v0 - CHWYT.kick.dv) < 1e-12, 'prędkość po wyrzucie');
    // ciągłość x, v, a na granicach faz i spoczynek dokładnie na xStop
    let pv = null;
    for (let t = 0; t < Fp[2] + Fp[7] + 0.5; t += 1 / 960) {
      motionX(t, v0, Fp, RB, MX);
      if (pv) {
        assert.ok(Math.abs(MX[1] - pv[1]) < 0.6, `v ciągła (${v0}, t ${t.toFixed(3)})`);
        assert.ok(Math.abs(MX[2] - pv[2]) < 12, `a ciągłe (${v0}, t ${t.toFixed(3)})`);
        assert.ok(MX[1] >= -1e-9 && MX[1] <= v0 + CHWYT.kick.dv + 1e-9);
      }
      pv = [MX[0], MX[1], MX[2]];
    }
    assert.ok(Math.abs(XB + 1 + pv[0] - CHWYT.xStop) < 1e-9 && pv[1] === 0, `spoczynek ${(XB + 1 + pv[0]).toFixed(6)}`);
    // droga hamowania z całki rampy = D (zamknięta postać)
    brakeRamp(Fp[7], Fp[6], CHWYT.ramp, RB);
    assert.ok(Math.abs(Fp[4] * Fp[7] - Fp[5] * RB[2] - Fp[8]) < 1e-9, 'droga hamowania');
  }
  // podziałka sprzężona z drogą: G(1) = 1, g(0) = g(1) = 0, g ciągłe
  const MC = new Float64Array(3);
  let prev = 0;
  for (let u = 0; u <= 1.0001; u += 0.0005) { marchCam(u, MC); assert.ok(MC[0] >= prev - 1e-12); prev = MC[0]; }
  marchCam(1, MC); assert.equal(MC[0], 1); assert.equal(MC[1], 0);
  marchCam(1e-9, MC); assert.ok(MC[1] < 1e-6);
  // plan pięciomianowy: ze spoczynku i z ruchu, ograniczenia v, a, bez cofania, koniec w spoczynku
  const C = new Float64Array(7);
  const E = new Float64Array(4);
  for (const [z0, v0, a0, z1] of [[-131, 0, 0, -451], [-131, -12, 0, -427], [-200, -90, -50, -403], [-131, 0, 0, -131]]) {
    planQuintic(z0, v0, a0, z1, STOJAK.vMax, STOJAK.aMax, C);
    for (let k = 0; k <= 200; k++) {
      evalQuintic(C, C[6] * k / 200, E);
      assert.ok(Math.abs(E[1]) <= STOJAK.vMax * 1.001 && Math.abs(E[2]) <= STOJAK.aMax * 1.001 && E[1] * Math.sign(z1 - z0 || -1) >= -1e-6, `plan ${z0}→${z1}`);
    }
    evalQuintic(C, C[6], E);
    assert.ok(Math.abs(E[0] - z1) < 1e-6 && E[1] === 0);
  }
});

for (const mode of [1, 1.4, 0.7, 'rampa']) {
  test(`dzielenie/ruch ${mode === 'rampa' ? 'przy rampie 0,7 → 1,4 Q w 3 s' : `przy ${mode} Q`}: lot stały co do bitu, chwyt bez skoku, granice a i zrywu, bez zmiany znaku prędkości, spoczynek i slot, nic przez nic, kolejka, bilans masy i pędu`, () => {
    const s = motionRun(mode);
    assert.equal(s.bal, 0, 'bilans masy linii i dzielenia po każdym podkroku');
    assert.ok(s.ped < 1e-9, `bilans pędu ${s.ped}`);
    assert.ok(s.grabbed > 12 && s.cas >= 1, `złapanych ${s.grabbed}, kaset ${s.cas}`);
    assert.equal(s.licz[LICZ.przepelnienie], 0, 'przepełnień 0');
    // 1. lot swobodny
    assert.ok(s.freeChecked > 0 || mode === 1.4, 'podkroki lotu swobodnego');
    assert.equal(s.freeVar, 0, 'prędkość w locie swobodnym zmienia się albo działa urządzenie');
    // 2. chwyt bez skoku, odłożenie bez prędkości względnej
    assert.ok(s.grabDv < 0.01, `skok prędkości przy chwycie ${s.grabDv}`);
    assert.ok(s.landDv <= 0.5, `prędkość względna w slocie ${s.landDv}`);
    // 3. granice
    assert.ok(s.axMax <= 520, `|aₓ| ${s.axMax.toFixed(1)}`);
    assert.ok(s.aMax <= 650, `|a| środka masy ${s.aMax.toFixed(1)}`);
    assert.ok(s.jMax <= 7000, `zryw (x, z) ${s.jMax.toFixed(0)}`);
    assert.ok(s.azHinge <= 210, `|a_z| grzebienia ${s.azHinge.toFixed(1)}`);
    assert.ok(s.aKas <= 460, `kasety ${s.aKas.toFixed(1)}`);
    // 4. znaki
    assert.equal(s.vzPos, 0, 'v_z > 0 (ruch w bok tylko w −z)');
    assert.equal(s.vxNeg, 0, 'vₓ < 0 (arkusz się cofa)');
    // 5. położenia
    assert.ok(s.rest <= 0.5, `tył w spoczynku ±${s.rest}`);
    assert.ok(s.front <= 4660.5, `przód ${s.front.toFixed(2)}`);
    assert.ok(s.slot <= 0.3, `slot ±${s.slot}`);
    // 6. nic przez nic (szczelina cięcia ma 2 j. — przy wejściu wyrzutu czoło pasma podchodzi o ułamek)
    assert.ok(s.gap >= 1.5, `szczelina do czoła pasma ${s.gap.toFixed(2)}`);
    assert.ok(s.under >= (mode === 'rampa' ? 2.5 : 5), `prześwit nad pasmem ${s.under.toFixed(2)}`);
    assert.ok(s.pair >= 5, `prześwit płyt n ↔ n+1 ${s.pair.toFixed(2)}`);
    assert.equal(s.kasOverlap, 0, 'kasety zachodzą na siebie');
    // 7. kolejka
    assert.equal(s.order, 0, 'kolejność w grzebieniu');
    assert.ok(s.pitch >= 24 - 0.1, `podziałka ${s.pitch.toFixed(3)}`);
  });
}

test('dzielenie/przepełnienie: odbiór zablokowany → bufor 6, arkusz niezłapany leci w osi do przetopu (wyrzut, bez chwytu), linia nie staje, po odbiorze rytm wraca', () => {
  const r = rig({ seed: 2, odbior: 'stop' });
  const B = r.div.view.bodies;
  const L = r.div.view.licz;
  let maxBuf = 0;
  let overT = null;
  for (let i = 0; i < 70 * 60 && overT === null; i++) {
    r.line.setQ(1);
    stepPage(r, () => { const a = r.div.audit(); if (a.balance !== 0 || a.mismatch !== 0) assert.fail('bilans'); });
    maxBuf = Math.max(maxBuf, r.div.rack.bufTargeted());
    if (L[LICZ.przepelnienie] > 0) overT = i;
  }
  assert.ok(overT !== null, 'przepełnienie przy zablokowanym odbiorze');
  assert.ok(maxBuf <= STOJAK.buf && maxBuf >= STOJAK.buf - 1, `bufor ${maxBuf}`);
  // niezłapany arkusz: stan PRZETOP, w osi, bez chwytu, z prędkością po wyrzucie; dolatuje do konta przetopu
  let found = false;
  bodies(r.div, (o, i) => { if (B[o + ARK.kind] === RODZAJ.PRZEPELNIENIE) { found = true; assert.equal(B[o + ARK.st], ARK_ST.PRZETOP); assert.equal(r.div.view.mov[i * MV_N + MV.grab], 0); assert.ok(Math.abs(B[o + ARK.z] + r.div.view.mov[i * MV_N + MV.hw]) < 1e-9); } });
  assert.ok(found);
  const p0 = L[LICZ.przetop];
  for (let i = 0; i < 7 * 60; i++) stepPage(r);
  assert.ok(L[LICZ.przetop] > p0 + 4 * UT, 'arkusz przeleciał przez PRZETOP');
  assert.ok(r.line.stan[LIN_STAN.overrun] === 0 && r.div.view.noz[NOZ.st] === NOZ_ST.PRACA, 'linia i nóż pracują');
  // odbiór zwolniony: kasety ruszają, przepełnienia ustają
  const over = L[LICZ.przepelnienie];
  for (let i = 0; i < 40 * 60; i++) { r.line.setQ(1); if (i % 60 === 0) r.div.odbierz(); stepPage(r); }
  const kas = L[LICZ.kaset];
  const over2 = L[LICZ.przepelnienie];
  for (let i = 0; i < 30 * 60; i++) { r.line.setQ(1); if (i % 60 === 0) r.div.odbierz(); stepPage(r); }
  assert.ok(L[LICZ.kaset] > kas, 'kasety odjeżdżają po odbiorze');
  assert.equal(L[LICZ.przepelnienie], over2, 'po powrocie do rytmu bez przepełnień');
  assert.ok(over2 >= over);
});

test('dzielenie/chwyt wyłączony (awaria): każdy kawałek dostaje wyrzut i leci prosto w osi do przetopu; lot co do bitu do końca tunelu', () => {
  const r = rig({ seed: 3, chwyt: false });
  const B = r.div.view.bodies;
  const v = new Map();
  let checked = 0;
  for (let i = 0; i < 25 * 60; i++) {
    stepPage(r, () => {
      bodies(r.div, (o) => {
        assert.equal(B[o + ARK.st], ARK_ST.PRZETOP);
        assert.ok(Math.abs(B[o + ARK.y] - HALA.passY) < 1e-9 && B[o + ARK.th] === 0, 'w osi');
        if (B[o + ARK.tS] > CHWYT.kick.t + 1e-9) {
          const s = B[o + ARK.seq];
          if (!v.has(s)) v.set(s, B[o + ARK.vx]); else if (v.get(s) !== B[o + ARK.vx]) assert.fail('prędkość odpadu w locie');
          checked++;
        }
      });
    });
  }
  assert.ok(checked > 2000 && v.size > 8);
  assert.ok(r.div.view.licz[LICZ.przetop] > 30 * UT);
});

test('dzielenie/długość z drogi i odpad § 12.1 F: zmienny przepływ 0,7…1,4 Q — arkusz 640 ± 0,5 j., 5,01 t ± 1,5 %, rozdzielenia co P; żaden arkusz po zmianie przepływu nie idzie do odpadu', () => {
  const r = rig({ seed: 5 });
  const N = r.div.view.noz;
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let q = 1;
  let target = 1;
  let cuts = N[NOZ.cuts];
  let lastM = null;
  const lens = [];
  const masses = [];
  const dM = [];
  for (let i = 0; i < 70 * 60; i++) {
    if (i % 300 === 0) target = 0.7 + 0.7 * rnd();
    q += Math.max(-0.15 * DT, Math.min(0.15 * DT, target - q));
    r.line.setQ(q);
    stepPage(r, () => {
      if (N[NOZ.cuts] !== cuts) {
        cuts = N[NOZ.cuts];
        if (lastM !== null) dM.push(N[NOZ.nextCut] - P - lastM);
        lastM = N[NOZ.nextCut] - P;
        bodies(r.div, (o) => {
          const Bq = r.div.view.bodies;
          if (!fresh(Bq, o) || Bq[o + ARK.kind] === RODZAJ.CZOLO || Bq[o + ARK.kind] === RODZAJ.OGON) return;
          lens.push(Bq[o + ARK.len]);
          masses.push(Bq[o + ARK.units] / UT);
        });
      }
    });
  }
  assert.ok(lens.length > 25, `arkuszy ${lens.length}`);
  for (const l of lens) assert.ok(Math.abs(l - DZIEL.L) <= DZIEL.tol.len, `arkusz ${l.toFixed(3)} j.`);
  for (const m of masses) assert.ok(Math.abs(m / 5.012 - 1) < 0.015, `masa ${m.toFixed(3)} t`);
  for (const d of dM) assert.ok(Math.abs(d - DZIEL.P) <= 0.5, `rozdzielenia co ${d.toFixed(3)} j. drogi`);
  const L = r.div.view.licz;
  assert.equal(L[LICZ.zle], 0, 'arkusze po zmianie przepływu nie są odrzucane (bez zmiany metalu)');
  assert.equal(L[LICZ.przepelnienie], 0, 'bez przepełnień');
  assert.ok(L[LICZ.dobre] >= lens.length - 1);
});

test('dzielenie/bilans: linia + dzielenie = 0 po KAŻDYM podkroku (prawdziwa komora, 2 obiegi stali, miedź, dobieg); pęd; masy kaset = arkusze', () => {
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const r = rig({ seed: 11 });
  const last = { v: sim.counters[LICZNIK.delivered] };
  let metal = 0;
  let checks = 0;
  let pedMax = 0;
  const check = () => {
    const la = r.line.audit();
    const da = r.div.audit();
    if (la.balance !== 0 || la.mismatch !== 0) assert.fail(`bilans linii ${la.balance} / ${la.mismatch}`);
    if (da.balance !== 0 || da.mismatch !== 0 || da.line !== 0) assert.fail(`bilans dzielenia ${da.balance} / ${da.mismatch} / z linią ${da.line}`);
    if (da.ped > pedMax) pedMax = da.ped;
    checks++;
  };
  for (let i = 0; i < 300 * 60; i++) {
    if (i === 190 * 60) metal = 1;
    sim.step(DT);
    feed(sim, r.inp, last, metal);
    stepPage(r, check);
  }
  r.line.drain();
  for (let i = 0; i < 60 * 60; i++) { r.inp[LIN_WEJ.units] = 0; stepPage(r, check); }
  assert.ok(checks > 80000);
  assert.ok(pedMax < 1e-9, `bilans pędu ${pedMax}`);
  const L = r.div.view.licz;
  assert.ok(L[LICZ.kaset] >= 8, `kaset odebranych ${L[LICZ.kaset]}`);
  assert.equal(r.line.stan[LIN_STAN.overrun], 0, 'nic nie minęło końca drogi pasma');
  assert.ok(L[LICZ.zle] > 0, 'zmiana metalu: kawałki mieszane do przetopu');
  // dobre arkusze = w ruchu + w kasetach + odebrane
  let inSystem = 0;
  bodies(r.div, (o) => { if (r.div.view.bodies[o + ARK.kind] === RODZAJ.DOBRY) inSystem++; });
  const delivered = Math.round(L[LICZ.odebrane] / (5.012 * UT));
  assert.ok(Math.abs(L[LICZ.dobre] - (inSystem + delivered)) <= 1, `dobre ${L[LICZ.dobre]} = ${inSystem} + ${delivered}`);
});

test('dzielenie/czystość: ξ każdego arkusza od rozdzielenia do wyjazdu kasety stała (1e-12) — osłona argonu w całej strefie', () => {
  const r = rig({ seed: 9 });
  const B = r.div.view.bodies;
  const xi = new Map();
  let checked = 0;
  let out = 0;
  const L = r.div.view.licz;
  for (let i = 0; i < 50 * 60; i++) {
    r.line.setQ(1);
    stepPage(r, () => bodies(r.div, (o) => {
      const s = B[o + ARK.seq];
      if (!xi.has(s)) xi.set(s, B[o + ARK.xi]);
      else if (Math.abs(B[o + ARK.xi] - xi.get(s)) > 1e-12) assert.fail(`ξ arkusza ${s} zmienia się`);
      checked++;
    }));
    out = L[LICZ.kaset];
  }
  assert.ok(checked > 50000 && out >= 1, `sprawdzeń ${checked}, kaset ${out}`);
  for (const [, x] of xi) assert.ok(x < 0.005, `ξ ${x}`);
});

test('dzielenie/zimne czoło: pierwszy kawałek (klin) w osi do przetopu, pierwszy arkusz dobry i złapany (stal i miedź)', () => {
  for (const metal of [0, 1]) {
    const r = rig({ seed: 11, metal, cold: true });
    const dump = syntheticDump(240);
    const B = r.div.view.bodies;
    const N = r.div.view.noz;
    r.inp[LIN_WEJ.head] = 200;
    r.inp[LIN_WEJ.tempT] = 0.95;
    let head = null;
    let firstGood = null;
    let cuts = 0;
    for (let i = 0; i < 160 * 60 && firstGood === null; i++) {
      r.inp[LIN_WEJ.units] = dump();
      r.line.step(DT, r.inp);
      if (N[NOZ.cuts] !== cuts) {
        cuts = N[NOZ.cuts];
        bodies(r.div, (o) => {
          if (B[o + ARK.age] > DT + 1e-9) return;
          if (head === null) head = { kind: B[o + ARK.kind], len: B[o + ARK.len], st: B[o + ARK.st] };
          else if (firstGood === null) firstGood = { kind: B[o + ARK.kind], len: B[o + ARK.len], st: B[o + ARK.st] };
        });
      }
    }
    assert.ok(head !== null && firstGood !== null, `metal ${metal}: obcięcie, pierwszy arkusz`);
    assert.equal(head.kind, RODZAJ.CZOLO, 'pierwszy kawałek = czoło');
    assert.equal(head.st, ARK_ST.PRZETOP, 'czoło leci do przetopu');
    assert.ok(head.len >= DZIEL.head.min - 1);
    assert.equal(firstGood.kind, RODZAJ.DOBRY, `metal ${metal}: pierwszy arkusz po czole dobry`);
    assert.equal(firstGood.st, ARK_ST.LOT, 'złapany listwą');
    assert.ok(Math.abs(firstGood.len - DZIEL.L) <= 0.5);
  }
});

test('dzielenie/koniec pasma: dobieg → ogon w osi do przetopu, arkusze kończą drogę do kaset, krzywka staje w tylnym zawrocie', () => {
  const r = rig({ seed: 6 });
  const N = r.div.view.noz;
  for (let i = 0; i < 20 * 60; i++) stepPage(r);
  r.line.drain();
  for (let i = 0; i < 90 * 60; i++) {
    stepPage(r, () => { const a = r.div.audit(); if (a.balance !== 0 || a.mismatch !== 0) assert.fail('bilans w dobiegu'); });
    if (r.line.view.ring[1] === 0 && N[NOZ.st] === NOZ_ST.SPOCZYNEK) {
      let moving = 0;
      bodies(r.div, (o) => { const s = r.div.view.bodies[o + ARK.st]; if (s === ARK_ST.LOT || s === ARK_ST.PRZETOP) moving++; });
      if (moving === 0) break;
    }
  }
  assert.equal(r.div.view.licz[LICZ.ogon], 1, 'jeden ogon');
  assert.equal(r.line.view.ring[1], 0, 'pasmo wyjechało');
  assert.equal(N[NOZ.st], NOZ_ST.SPOCZYNEK, 'nóż w spoczynku');
  assert.ok(Math.abs(N[NOZ.x] - DZIEL.X_HOME) < 0.5 && Math.abs(N[NOZ.v]) < 1, `wózki w tylnym zawrocie (${N[NOZ.x].toFixed(2)})`);
  bodies(r.div, (o) => { const s = r.div.view.bodies[o + ARK.st]; assert.ok(s !== ARK_ST.LOT && s !== ARK_ST.PRZETOP, 'nic w locie'); });
  assert.equal(r.line.stan[LIN_STAN.overrun], 0);
});

test('dzielenie/ciepło: T arkusza nierosnąca, brzeg √t (miedź szybciej), arkusz przy cięciu ok. 1100 K, kaseta w odbiorze 880–1000 K (stal, Q 1); w kasecie wolniej niż w locie', () => {
  let prevS = Infinity;
  let prevC = Infinity;
  for (let t = 0; t < 5; t += 0.05) {
    const s = edgeExcess(800, t, 0);
    const c = edgeExcess(800, t, 1);
    assert.ok(s <= prevS + 1e-9 && c <= prevC + 1e-9);
    if (t > 0) assert.ok(c < s, 'miedź stygnie brzegiem szybciej');
    prevS = s; prevC = c;
  }
  assert.ok(Math.abs(DZIEL.edge.tau - DZIEL.edge.w0 ** 2 / (4 * DZIEL.edge.alpha)) < 1e-12, 'τ = w0² / 4α');
  assert.ok(edgeWidth(1, 1) > edgeWidth(1, 0));
  const r = rig({ seed: 8 });
  const B = r.div.view.bodies;
  const prevT = new Float64Array(ARK_CAP).fill(Infinity);
  const Tcut = [];
  let rateFly = 0; let nFly = 0; let rateKas = 0; let nKas = 0;
  for (let i = 0; i < 60 * 60; i++) {
    r.line.setQ(1);
    stepPage(r);
    bodies(r.div, (o, idx) => {
      const avg = 0.25 * (B[o + ARK.T0] + B[o + ARK.T1] + B[o + ARK.T2] + B[o + ARK.T3]);
      if (B[o + ARK.age] <= DT + 1e-9) { prevT[idx] = Infinity; if (B[o + ARK.kind] === RODZAJ.DOBRY && i > 20 * 60) Tcut.push(avg); }
      assert.ok(avg <= prevT[idx] + 1e-9, 'T nie rośnie');
      if (prevT[idx] !== Infinity) {
        const d = (prevT[idx] - avg) / DT;
        if (B[o + ARK.st] === ARK_ST.LOT) { rateFly += d / avg ** 4; nFly++; } else if (B[o + ARK.st] === ARK_ST.KASETA) { rateKas += d / avg ** 4; nKas++; }
      }
      prevT[idx] = avg;
    });
  }
  const tc = Tcut.reduce((a, b) => a + b, 0) / Tcut.length;
  assert.ok(tc > 1060 && tc < 1140, `arkusz przy cięciu ${tc.toFixed(0)} K`);
  const Tp = r.div.view.lastCas[2];
  assert.ok(Tp > 880 && Tp < 1000, `kaseta w odbiorze ${Tp.toFixed(0)} K`);
  // w kasecie sąsiedzi zasłaniają ściany: stygnięcie (na T⁴) wolniejsze niż w locie
  assert.ok(nKas > 100 && rateKas / nKas < 0.7 * rateFly / nFly, 'w kasecie wolniej');
});

test('dzielenie/klasyfikacja: metal mieszany → odpad, wymiar poza tolerancją → zapis (arkusz dobry), czoło i ogon → odpad', () => {
  const o = new Float64Array(KAW_N);
  const good = () => { o.fill(0); o[KAW.len] = 640; o[KAW.wMin] = 200; o[KAW.wMax] = 201; o[KAW.tMin] = 8.95; o[KAW.tMax] = 9.05; o[KAW.cu] = 0; o[KAW.cutF] = 1; };
  good();
  assert.equal(classifyPiece(o), 0);
  o[KAW.cu] = 0.5;
  assert.equal(classifyPiece(o), PRZYCZYNA.metal);
  good(); o[KAW.tMax] = 9.4;
  assert.equal(classifyPiece(o), PRZYCZYNA.grubosc);
  good(); o[KAW.cutF] = 0;
  assert.equal(classifyPiece(o), -(RODZAJ.CZOLO + 1));
  good(); o[KAW.tail] = 1;
  assert.equal(classifyPiece(o), -(RODZAJ.OGON + 1));
  // w linii: domieszka miedzi 0,5 → kawałek ZŁY w osi do przetopu; grubość poza tolerancją → arkusz DOBRY do kasety
  const r = rig({ seed: 4 });
  const N = r.div.view.noz;
  const B = r.div.view.bodies;
  for (let i = 0; i < 25 * 60; i++) stepPage(r);
  const SL = r.line.view.slices;
  for (let k = 0; k < r.line.view.ring[1]; k++) { const oo = r.line.sliceOffset(k); if (SL[oo + PL.s] > XB - 600) SL[oo + PL.x] = 0.5; }
  let found = false;
  let cuts = N[NOZ.cuts];
  for (let i = 0; i < 6 * 60 && !found; i++) {
    stepPage(r);
    if (N[NOZ.cuts] !== cuts) { cuts = N[NOZ.cuts]; bodies(r.div, (oo) => { if (fresh(B, oo) && B[oo + ARK.kind] === RODZAJ.ZLY && (B[oo + ARK.cause] & PRZYCZYNA.metal)) { found = true; assert.equal(B[oo + ARK.st], ARK_ST.PRZETOP); } }); }
  }
  assert.ok(found, 'kawałek z domieszką miedzi do przetopu');
});

test('dzielenie/zasada G: taśma przy F3 bit w bit (linia z dzieleniem i bez, 60 s); nóż nie zależy od tego, co dzieje się z arkuszem (chwyt / bez chwytu / odbiór stop)', () => {
  const a = rig({ seed: 11 });
  const mill = createRollingMill();
  const b = { line: createFormingLine({ seed: 11, kin: mill }), inp: new Float64Array(LIN_WEJ_N) };
  b.inp[LIN_WEJ.tempT] = 1;
  const c = rig({ seed: 11, chwyt: false });
  const d = rig({ seed: 11, odbior: 'stop' });
  const cmp = () => {
    const la = a.line;
    const lb = b.line;
    const na = la.view.ring[1];
    const nb = lb.view.ring[1];
    for (let k = 1; k <= Math.min(na, nb); k++) {
      const oa = la.sliceOffset(na - k);
      const ob = lb.sliceOffset(nb - k);
      if (la.view.slices[oa + PL.s] >= 3300 || lb.view.slices[ob + PL.s] >= 3300) break;
      for (const f of [PL.s, PL.u, PL.m, PL.H, PL.A, PL.a, PL.xi, PL.T, PL.Ts]) {
        if (la.view.slices[oa + f] !== lb.view.slices[ob + f]) assert.fail(`plaster ${k} pole ${f}: ${la.view.slices[oa + f]} ≠ ${lb.view.slices[ob + f]}`);
      }
    }
    for (const q of [c, d]) for (const f of [NOZ.x, NOZ.v, NOZ.u, NOZ.zF, NOZ.power, NOZ.cuts, NOZ.lastLen]) assert.equal(q.div.view.noz[f], a.div.view.noz[f], `nóż pole ${f}`);
  };
  for (let i = 0; i < 60 * 60; i++) {
    a.line.step(DT, a.inp);
    b.line.step(DT, b.inp);
    c.line.step(DT, c.inp);
    d.line.step(DT, d.inp);
    if (i % 30 === 0) cmp();
  }
  cmp();
  assert.ok(a.div.view.noz[NOZ.cuts] > 15, 'dzielenie pracowało');
  assert.ok(b.line.stan[LIN_STAN.overrun] > 0, 'bez dzielenia pasmo wychodzi końcem drogi');
});

test('dzielenie/styk zwijarki (etap 2): program KREGI na granicy cięcia → krzywka parkuje; armOneCut — jeden obieg i jedno cięcie na zadanej drodze; koniec drogi pasma zmienny bez wpływu na plastry przed nożem', () => {
  const r = rig({ seed: 7 });
  const N = r.div.view.noz;
  const events = [];
  r.div.onProgramChange = (p, k) => events.push([p, k]);
  for (let i = 0; i < 20 * 60; i++) { r.line.setQ(1); stepPage(r); }
  r.div.setProgram(PROGRAM.KREGI);
  const cuts0 = N[NOZ.cuts];
  for (let i = 0; i < 4 * 60; i++) { r.line.setQ(1); stepPage(r); }
  assert.equal(events.length, 1, 'zdarzenie zmiany programu');
  assert.equal(events[0][0], PROGRAM.KREGI);
  assert.equal(N[NOZ.cuts], cuts0 + 1, 'zmiana na granicy cięcia, potem bez cięć');
  assert.equal(N[NOZ.st], NOZ_ST.SPOCZYNEK);
  assert.ok(Math.abs(N[NOZ.x] - DZIEL.X_HOME) < 0.5, 'krzywka zaparkowana');
  // jeden obieg: cięcie na drodze M zadanej
  const Mcut = N[NOZ.M] + 0.6 * P;
  assert.ok(r.div.armOneCut(Mcut));
  let cutM = null;
  for (let i = 0; i < 4 * 60 * 4 && cutM === null; i++) { r.line.setQ(1); r.line.step(H, r.inp); if (N[NOZ.cuts] === cuts0 + 2) cutM = N[NOZ.M]; }
  assert.ok(cutM !== null && Math.abs(cutM - Mcut) < 3, `cięcie na M ${cutM && cutM.toFixed(1)} (zadane ${Mcut.toFixed(1)})`);
  for (let i = 0; i < 2 * 60; i++) { r.line.setQ(1); stepPage(r); }
  assert.equal(N[NOZ.cuts], cuts0 + 2, 'jedno cięcie');
  assert.equal(N[NOZ.st], NOZ_ST.SPOCZYNEK);
  // koniec drogi pasma w biegu: plastry przed nożem bit w bit z linią bez zmiany
  const a = rig({ seed: 3 });
  const b = rig({ seed: 3 });
  for (let i = 0; i < 10 * 60; i++) { a.line.step(DT, a.inp); b.line.step(DT, b.inp); }
  assert.equal(a.line.stripExit, PASMO.sExit);
  a.line.setStripExit(PASMO.sExit + 400);
  for (let i = 0; i < 5 * 60; i++) { a.line.step(DT, a.inp); b.line.step(DT, b.inp); }
  const n = Math.min(a.line.view.ring[1], b.line.view.ring[1]);
  for (let k = 1; k <= n; k++) {
    const oa = a.line.sliceOffset(a.line.view.ring[1] - k);
    const ob = b.line.sliceOffset(b.line.view.ring[1] - k);
    if (a.line.view.slices[oa + PL.s] >= XB - 10) break;
    assert.equal(a.line.view.slices[oa + PL.s], b.line.view.slices[ob + PL.s]);
  }
  // konta etapu 2 istnieją i są zerowe
  for (const k of [LICZ.zwoj, LICZ.kregi, LICZ.odebraneKregi, LICZ.kieszen]) assert.equal(a.div.view.licz[k], 0);
});

test('dzielenie/iskry szczeliny (zasada G): liczba = round(8 · jedn. szczeliny) na cięcie, w puli, bez NaN, pod nożem w dół', () => {
  const r = rig({ seed: 12 });
  const debris = createScaleDebris(31);
  const N = r.div.view.noz;
  let total = 0;
  let cuts0 = null;
  let sparkN = 0;
  let sparkDown = 0;
  for (let i = 0; i < 40 * 60; i++) {
    r.line.setQ(1);
    r.line.step(DT, r.inp);
    debris.step(DT, r.mill, r.line);
    const n = r.div.takeSparks();
    total += n;
    if (cuts0 === null && N[NOZ.cuts] > 2) cuts0 = { c: N[NOZ.cuts], t: total };
    if (n > 0) debris.emitKerf(N[NOZ.sparkX], HALA.passY, N[NOZ.sparkZ], N[NOZ.vStrip], n, N[NOZ.sparkDir], N[NOZ.sparkT], N[NOZ.sparkEnd]);
    assert.ok(debris.count <= ZGORZ.cap);
    for (let q = 0; q < debris.count; q++) {
      const o = q * ZGORZ.stride;
      if (debris.data[o + 8] !== 0) continue;
      const x = debris.data[o];
      const y = debris.data[o + 1];
      if (x > DZIEL.kerf.x0 && x < 4700 && Math.abs(debris.data[o + 2]) < DZIEL.kerf.hz && y < HALA.passY - 10) { sparkN++; if (y < debris.data[o + 5]) sparkDown++; }
    }
  }
  const perCut = (total - cuts0.t) / (N[NOZ.cuts] - cuts0.c);
  const want = Math.round(DZIEL.sparkPerUnit * N[NOZ.kerfA]);
  assert.ok(Math.abs(perCut - want) <= 0.06 * want + 2, `iskier na cięcie ${perCut.toFixed(1)} (round(8 · ${N[NOZ.kerfA].toFixed(1)}) = ${want})`);
  for (let i = 0; i < debris.count * ZGORZ.stride; i++) assert.ok(Number.isFinite(debris.data[i]), 'bez NaN');
  assert.ok(sparkN > 200 && sparkDown / sparkN > 0.8, `iskry pod nożem w dół: ${sparkDown} / ${sparkN}`);
});

test('dzielenie/powtarzalność: ten sam hasz przy tym samym ziarnie, inny przy innym ziarnie linii', () => {
  const run = (seed) => { const r = rig({ seed }); for (let i = 0; i < 30 * 60; i++) r.line.step(DT, r.inp); return r.div.hash() + r.line.hash(); };
  assert.equal(run(11), run(11));
  assert.notEqual(run(11), run(12));
});

test('dzielenie/bez alokacji: krok linii z walcownią i dzieleniem (lot, grzebień, kasety), iskry szczeliny, wypełnienie buforów instancji', async () => {
  const fl = await import('../dema/ring-dzielnice/huta/formowanie/linia.js?dzielenie');
  const fm = await import('../dema/ring-dzielnice/huta/formowanie/walcownia.js?dzielenie');
  const fz = await import('../dema/ring-dzielnice/huta/formowanie/zgorzelina.js?dzielenie');
  const fd = await import('../dema/ring-dzielnice/huta/dzielenie/model.js?dzielenie');
  const fo = await import('../dema/ring-dzielnice/huta/dzielenie/obraz.js?dzielenie');
  const THREE = await import('three/webgpu');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { ZlozenieObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazZlozenia.js');
  const { createLineUniforms } = await import('../dema/ring-dzielnice/huta/formowanie/pasmoTSL.js');
  const mill = fm.createRollingMill();
  const div = fd.createDivider({});
  const line = fl.createFormingLine({ seed: 9, kin: mill, divider: div });
  const debris = fz.createScaleDebris(31);
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.tempT] = 1;
  const root = new THREE.Group();
  const sim = createMeltChamber({ seed: 7 });
  const o = new WytopObraz({ root, sim });
  const z = new ZlozenieObraz({ root, U: o.U });
  const img = new fo.DzielenieObraz({ root, U: o.U, LM: createLineUniforms(), zl: z });
  const NZ = div.view.noz;
  const step = (i) => {
    line.setQ(i % 600 < 300 ? 1 : 1.2);
    line.step(DT, inp);
    debris.step(DT, mill, line);
    const n = div.takeSparks();
    if (n > 0) debris.emitKerf(NZ[NOZ.sparkX], HALA.passY, NZ[NOZ.sparkZ], NZ[NOZ.vStrip], n, NZ[NOZ.sparkDir], NZ[NOZ.sparkT], NZ[NOZ.sparkEnd]);
  };
  let i = 0;
  const warm = () => { for (let k = 0; k < 900; k++) { step(i++); img.frame(div, line, 0.5, DT, DT, 0); } };
  warm();
  const per60 = await untilSteady(() => allocatedBytes(() => step(i++), 60), (b) => b < 8192, { warm, rounds: 60, pauseMs: 50 });
  assert.ok(per60 < 8192, `krok linii z dzieleniem alokuje ${per60} B na 60 kroków`);
  const perImg = await untilSteady(() => allocatedBytes(() => img.fill(div, 0.5, DT), 60), (b) => b < 8192, { warm, rounds: 60, pauseMs: 50 });
  assert.ok(perImg < 8192, `bufory instancji dzielenia alokują ${perImg} B na 60 klatek`);
});

test('dzielenie/geometria i kadr: bryły stałe poza drogą arkuszy (lot, chwyt, przechył, grzebień), poza drogą kaset i w wolnych obszarach etapu 2; kadr widoku 1 obejmuje pokład i bramy', () => {
  const B = new Budowniczy(400000);
  buildDivider(B);
  assert.equal(B.over, 0);
  const R = new Budowniczy(400000);
  buildRollingMill(R);
  const Y = HALA.passY;
  // objętości ruchu (z marginesem 0,5 j.): arkusz płaski w osi i uniesiony (od rozdzielenia do spoczynku, z przechyłem
  // ćwiartką walca wokół zawiasu), grzebień i kaseta w załadunku, drogi kaset (bufor, wjazd, odjazd, wyjazd, dowóz)
  const vols = [
    ['lot', [XB + 1, CHWYT.xStop + 640, Y - 4.5, Y + 15 + 4.5, -107, 100.5]],
    ['przechyl', [CHWYT.xGrab, CHWYT.xStop + 640, Y - 4.5 + 15, Y + 15 - 4.5 + 201, -131 - 9, -107 + 201]],
    ['grzebien', [CHWYT.xStop, CHWYT.xStop + 640, Y + 15 - 4.5, Y + 15 - 4.5 + 201, slotZ(0) - 9, -107]],
    ['odpad', [XB + 1, PRZETOP.x1, Y - 4.5, Y + 4.5, -100.5, 100.5]]
  ];
  const K = KASETA;
  const kas = (dx0, dx1, dz0, dz1) => [K.x0 + dx0, K.x1 + dx1, K.y0, K.y1, K.z0 + dz0, K.z1 + dz1];
  const kasVols = [kas(-K.in.dx, 0, 0, 0), kas(0, 0, K.out.dz, 0), kas(0, K.exit.dx, K.out.dz, K.out.dz), kas(-K.in.dx, -K.in.dx, -K.supply.dz, 0)];
  const inside = (b, x, y, z) => x > b[0] + 0.5 && x < b[1] - 0.5 && y > b[2] + 0.5 && y < b[3] - 0.5 && z > b[4] + 0.5 && z < b[5] - 0.5;
  let movers = 0;
  for (const S of [B, R]) {
    for (let i = 0; i < S.n; i++) {
      const x = S.pos[i * 3];
      const y = S.pos[i * 3 + 1];
      const z = S.pos[i * 3 + 2];
      const mark = S.mov[i * 3 + 2];
      if (S === B) {
        assert.ok(x >= HALA.deck.x0 && x <= DZIEL.wall.x1 + KASETA.exit.dx + 20 && z >= HALA.deck.z0 && z <= HALA.deck.z1, `poza pokładem: ${x}, ${z}`);
        assert.ok(y >= HALA.deckY - 40, `pod pokładem: ${y}`);
      }
      if (mark >= DZ_MARK.car) { if (S === B) movers++; continue; }
      for (const [id, b] of vols) if (inside(b, x, y, z)) assert.fail(`bryła w objętości ruchu „${id}”: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
      for (const b of kasVols) if (inside(b, x, y, z)) assert.fail(`bryła na drodze kasety: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
      for (const [id, w] of Object.entries(WOLNE)) {
        // (napisy i progi na pokładzie — płaskie, do 8 j. nad pokładem — nie zajmują miejsca)
        if (y < HALA.deckY + 8) continue;
        if (inside(w, x, y, z)) assert.fail(`bryła w wolnym obszarze etapu 2 „${id}”: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
      }
    }
  }
  assert.ok(movers > 300, 'grupy ruchome (wózki noża, kasety)');
  // bryły listew i grzebienia wg `dividerBoxes` poza objętościami ruchu arkuszy
  for (const { id, b } of dividerBoxes()) for (const [vid, v] of vols) {
    const ov = Math.min(b[1], v[1]) - Math.max(b[0], v[0]) > 0.5 && Math.min(b[3], v[3]) - Math.max(b[2], v[2]) > 0.5 && Math.min(b[5], v[5]) - Math.max(b[4], v[4]) > 0.5;
    assert.ok(!ov, `${id} w objętości „${vid}”`);
  }
  // kadr widoku 1: pokład do 4760 i brama WYJAZD KASET przy 1600 × 900 i 1600 × 450
  for (const [W, Hh] of [[1600, 900], [1600, 450]]) {
    const [x0, z0, x1, z1] = WIDOKI.top1;
    const zoom = Math.min(W / (x1 - x0), Hh / (z1 - z0));
    const hc = (Hh / 2) / Math.tan(17.5 * Math.PI / 180) / zoom;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const proj = (x, y, zz) => { const k = hc / (hc + (HALA.planeY - y)); return [W / 2 + (x - cx) * zoom * k, Hh / 2 + (zz - cz) * zoom * k]; };
    const ins = (p) => p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= Hh;
    for (const zz of [HALA.deck.z0, HALA.deck.z1]) assert.ok(ins(proj(HALA.deck.x1, HALA.deckY, zz)), `${W}×${Hh}: róg pokładu`);
    for (const zz of [DZIEL.exit.z0, DZIEL.exit.z1]) assert.ok(ins(proj(DZIEL.wall.x1, DZIEL.wall.yTop, zz)), `${W}×${Hh}: brama WYJAZD KASET`);
    if (Hh === 450) {
      const [a0, b0, a1, b1] = WIDOKI.top1R7;
      assert.ok(Math.abs(zoom - Math.min(W / (a1 - a0), Hh / (b1 - b0))) < 1e-9, '32:9 — piec bez zmian');
    }
  }
  void KAS_LIST; void MARSZ; void PED;
});

test('dzielenie/WGSL: arkusze, ostrze i pole ruchome budują się w Node, bez NaN i pochodnych; uniformy od zer; pasmo różni się tylko rozmiarem bloku pola', async () => {
  const THREE = await import('three/webgpu');
  const { uniformArray } = await import('three/tsl');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { ZlozenieObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazZlozenia.js');
  const { LiniaObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazLinii.js');
  const { createMetalLineMaterial } = await import('../dema/ring-dzielnice/huta/formowanie/pasmoTSL.js');
  const { DzielenieObraz } = await import('../dema/ring-dzielnice/huta/dzielenie/obraz.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const build = (mesh) => {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = mesh.material;
    b.build();
    return { vertex: b.vertexShader, fragment: b.fragmentShader };
  };
  const sim = createMeltChamber({ seed: 7 });
  const root = new THREE.Group();
  const o = new WytopObraz({ root, sim });
  const z = new ZlozenieObraz({ root, U: o.U });
  const l = new LiniaObraz({ root, U: o.U, zl: z });
  const d = new DzielenieObraz({ root, U: o.U, LM: l.LM, zl: z });
  for (const m of [d.mesh, d.blade, d.field, ...z.meshes]) {
    const w = build(m);
    assert.ok(w.vertex.length > 500 && w.fragment.length > 1000, m.name);
    assert.ok(!/NaN|undefined/.test(w.vertex + w.fragment), m.name);
    assert.ok(!/dpdx|dpdy|fwidth/.test(w.fragment), `${m.name}: bez pochodnych ekranu`);
  }
  assert.ok(d.field.material.forceSinglePass && !d.field.material.depthWrite, 'pole ruchome: jeden przebieg, bez zapisu głębi');
  for (const v of [d.OB.A.value, d.OB.B.value, d.OB.C.value, d.OB.D.value, d.OB.E.value, z.OU.dz.value, l.LM.cut.value, ...z.OU.ruch.array]) assert.deepEqual(v.toArray(), [0, 0, 0, 0]);
  assert.equal(z.OU.pole.array.length, 12);
  assert.equal(z.OU.ruch.array.length, DZ_MARK.ruchN);
  const pole8 = uniformArray(Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4').setName('FormowaniePole');
  const m8 = new THREE.Mesh(l.geometry, createMetalLineMaterial(o.U, l.LM, l.ST.node, pole8));
  const a = build(l.mesh);
  const b = build(m8);
  const norm = (s) => s.replace(/array<\s*vec4<f32>\s*,\s*(8|12)\s*>/g, 'array<vec4<f32>, N>').replace(/NodeBuffer_\d+/g, 'NB');
  assert.equal(norm(a.fragment), norm(b.fragment), 'fragment pasma bez zmian poza rozmiarem bloku pola');
  assert.equal(norm(a.vertex), norm(b.vertex), 'wierzchołki pasma bez zmian');
});

test('dzielenie/obraz: płyta obraca się na sztorc wokół chwyconej krawędzi; listwa świeci pod arkuszem (wędrujące pole) i jedzie z nim; kasety jadą z modelem; ostrze bez zmian', async () => {
  const THREE = await import('three/webgpu');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { ZlozenieObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazZlozenia.js');
  const { LiniaObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazLinii.js');
  const { DzielenieObraz } = await import('../dema/ring-dzielnice/huta/dzielenie/obraz.js');
  const { ARK_STRIDE } = await import('../dema/ring-dzielnice/huta/dzielenie/arkuszTSL.js');
  const { POLE_STRIDE, POLE_RODZAJ } = await import('../dema/ring-dzielnice/huta/dzielenie/poleTSL.js');
  const r = rig({ seed: 5 });
  const root = new THREE.Group();
  const o = new WytopObraz({ root, sim: createMeltChamber({ seed: 7 }) });
  const z = new ZlozenieObraz({ root, U: o.U });
  const l = new LiniaObraz({ root, U: o.U, zl: z });
  const d = new DzielenieObraz({ root, U: o.U, LM: l.LM, zl: z, stations: l.ST.array });
  const B = r.div.view.bodies;
  const NZ = r.div.view.noz;
  const KS = r.div.view.kas;
  const frame = () => { l.frame(r.line, r.mill, 0, DT, DT); d.frame(r.div, r.line, 0, DT, DT, 0); };
  for (let i = 0; i < 60 * 22; i++) { r.line.setQ(1); r.line.step(DT, r.inp); }
  let grips = 0; let slotOk = 0; let thOk = 0; let kasOk = 0; let envOut = 0;
  for (let i = 0; i < 60 * 14; i++) {
    r.line.setQ(1);
    r.line.step(DT, r.inp);
    frame();
    // instancje arkuszy: θ z modelu, środek z = zawias + półszerokość
    for (let k = 0, n = 0; k < ARK_CAP && n < d.n; k++) {
      const ob = k * ARK_N;
      if (B[ob + ARK.st] === ARK_ST.WOLNY) continue;
      const q = n * ARK_STRIDE;
      if (Math.abs(d.data[q + 21] - Math.min(HALF_PI, B[ob + ARK.th])) < 1e-5 && Math.abs(d.data[q + 2] - (B[ob + ARK.z] + r.div.view.mov[k * MV_N + MV.hw])) < 1e-3) thOk++;
      n++;
    }
    // listwa: ciało w chwycie siedzi w kanałach 36–39 / 40–43 (x tyłu, długość, siła) i ma pas pola w partii pola ruchomego
    bodies(r.div, (ob) => {
      if (B[ob + ARK.st] !== ARK_ST.LOT || B[ob + ARK.dev] !== URZ.LISTWA) return;
      const P9 = z.OU.pole.array[9]; const P10 = z.OU.pole.array[10];
      if ((Math.abs(P9.x - B[ob + ARK.x]) < 1e-3 && P9.z > 0) || (Math.abs(P10.x - B[ob + ARK.x]) < 1e-3 && P10.z > 0)) slotOk++;
      for (let f = 0; f < d.nf; f++) if (d.fData[f * POLE_STRIDE + 3] === POLE_RODZAJ.CHWYT && Math.abs(d.fData[f * POLE_STRIDE] - (B[ob + ARK.x] + 0.5 * B[ob + ARK.len])) < 1e-2) grips++;
    });
    // kasety: grupa ruchu = przesunięcie kasety
    for (let c = 0; c < KAS_CAP; c++) {
      const oc = c * KAS_N;
      if (KS[oc + KAS.st] === KAS_ST.WOLNA) continue;
      const v = z.OU.ruch.array[c];
      if (Math.abs(v.x - KS[oc + KAS.dx]) < 1e-3 && Math.abs(v.z - KS[oc + KAS.dz]) < 1e-3) kasOk++;
    }
    const u = NZ[NOZ.u] - Math.floor(NZ[NOZ.u]);
    if (u > DZIEL.U_FOLD + 0.01 && u < U_HOME - 0.01 && d.OB.B.value.w > 0) envOut++;
  }
  assert.ok(thOk > 3000, `instancje z θ i zawiasem (${thOk})`);
  assert.ok(slotOk > 200 && grips > 200, `listwa pod arkuszem: kanały ${slotOk}, pas pola ${grips}`);
  assert.ok(kasOk > 800, `kasety w grupach ruchu (${kasOk})`);
  assert.equal(envOut, 0, 'pas pola ostrza poza oknem cięcia');
});
