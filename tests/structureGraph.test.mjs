// Gruby graf nośny budowli (docs/PLAN-zawalenia-budowli-3d.md, etap E1; src/game/structureGraph.js): bramki E1 —
// wspornik (siły pasów N = M(x)/h w każdym przekroju) i kolumna wobec analityki (≤ 5%), ocena tylko przy reszcie
// ≤ solveTol (także przy ciężkich losowych uszkodzeniach i na wyspie swobodnej), podcięcie ±x / ±y (W-1, W-2, wiele
// ziaren) → przechył ku stronie podciętej, zawias na przeciwnej krawędzi, uszkodzenie kondygnacji 15 → przechył
// albo zgniot (bez plastra), front κ 0,1–0,3 × gruz 20–30% do ziemi (κ = 1 staje), fala w konstrukcji kruszy ponad
// pasem broni, okno impulsu niezależne od zbieżności, wyspa swobodna z odciążeniem bezwładnościowym, prototyp progu
// dysku (szyja trzyma, upadek przebija; jeden próg nie rozdziela → próg od utrzymania z oknem, D8), determinizm 3×,
// 60 / 120 Hz ±5%, budżet zerwań (także cięcia plastra), bez alokacji w kroku, progi czasu (WYDAJNOSC).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as SG from '../src/game/structureGraph.js';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';
import { WYDAJNOSC } from './helpers/wydajnosc.mjs';

const HR = SG.buildHighriseArchetype({ seed: 5 });
const DISC = SG.buildDiscArchetype({ seed: 7 });
const EV = SG.STRUCT_EV, W = SG.STRUCT_EV_STRIDE;

function stepEvents(S) {
  const out = [];
  for (let j = 0; j < S.evCount; j++) out.push(Array.from(S.ev.subarray(j * W, (j + 1) * W)));
  return out;
}

// Podcięcie: kratery co 0,2 s w pasie broni (|z| ≤ 70) na ścianie x = sign·190 (punkty z PRNG — te same przy
// każdym Hz); stop przy pierwszej wyspie ≥ 30% masy (+ 0,5 s na zdarzenia).
function undercut(sign, hz, seconds = 30) {
  const S = SG.createStructure(HR, { id: 2 });
  const rnd = SG.structureRng(11), dt = 1 / hz, every = Math.round(0.2 * hz);
  const out = { events: [], island: null, hinge: null, S };
  let stopAt = Infinity;
  for (let s = 0; s < seconds * hz && s < stopAt; s++) {
    if (s % every === 0) { const y = (rnd() * 2 - 1) * 200, z = (rnd() * 2 - 1) * 70; SG.structureDamageSphere(S, sign * 190, y, z, 110, 0.18); }
    SG.stepStructure(S, dt, s);
    for (const e of stepEvents(S)) {
      out.events.push(e);
      if (e[0] === EV.ISLAND && !out.island && e[13] > 0.3 * HR.totalMass) { out.island = { t: e[1], id: e[2], mass: e[13], blocks: e[3] }; stopAt = s + Math.round(0.5 * hz); }
      if (e[0] === EV.HINGE && !out.hinge) out.hinge = { t: e[1], id: e[2], px: e[4], py: e[5], dx: e[7], dy: e[8], ax: e[10], ay: e[11], arm: e[13] };
    }
  }
  return out;
}

// Kondygnacja L: co 0,25 s zdrowie jej wiązań −0,12 (wszystkich — 'sym', albo po stronie +x — 'ecc'). Wyspa ze
// spadkiem pionowym (v3 = 1) uruchamia front (κ).
function storeyDamage(variant, L, hz, kappa = SG.STRUCT_TUNE.kappa, seconds = 16, debrisFrac = SG.STRUCT_TUNE.debrisFrac) {
  const S = SG.createStructure(HR, { id: 1 });
  const dt = 1 / hz, every = Math.round(0.25 * hz);
  const out = { islands: [], hinge: null, front: [], frontStart: -1, ground: null, stop: null, S, maxLevelsPerStep: 0 };
  for (let s = 0; s < seconds * hz; s++) {
    if (s % every === 0 && s < 4 * hz) {
      for (let j = HR.storeyStart[L]; j < HR.storeyStart[L + 1]; j++) {
        const k = HR.storeyBonds[j];
        if (variant === 'sym' || HR.cx[k] > 60) SG.structureDamageBond(S, k, 0.12);
      }
    }
    SG.stepStructure(S, dt, s);
    let fronts = 0;
    for (const e of stepEvents(S)) {
      if (e[0] === EV.ISLAND) {
        out.islands.push({ t: e[1], id: e[2], blocks: e[3], mass: e[13], drop: e[15] });
        if (e[15] === 1 && e[3] > 3 && out.frontStart < 0 && SG.structureStartFront(S, e[2], 0, { kappa, debrisFrac })) out.frontStart = e[1];
      }
      if (e[0] === EV.HINGE && !out.hinge) out.hinge = { t: e[1], dx: e[7], dy: e[8] };
      if (e[0] === EV.FRONT) { out.front.push({ t: e[1], level: e[2], v: e[13], debris: e[14] }); fronts++; }
      if (e[0] === EV.FRONT_GROUND) out.ground = { t: e[1], v: e[13] };
      if (e[0] === EV.FRONT_STOP) out.stop = { t: e[1], level: e[2] };
    }
    if (fronts > out.maxLevelsPerStep) out.maxLevelsPerStep = fronts;
  }
  return out;
}

// Wyspy swobodne ≥ 3 poziomów o rzucie węższym niż 0,4 rzutu budowli = „plaster” (Ronan Point).
function plasters(S) {
  const A = S.arch, found = [];
  for (let id = 0; id < S.nIsl; id++) {
    let lmin = 1e9, lmax = -1e9, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, cnt = 0;
    for (let i = 0; i < A.n; i++) {
      if (S.island[i] !== id || S.dead[i]) continue;
      cnt++; lmin = Math.min(lmin, A.level[i]); lmax = Math.max(lmax, A.level[i]);
      x0 = Math.min(x0, A.x[i]); x1 = Math.max(x1, A.x[i]); y0 = Math.min(y0, A.y[i]); y1 = Math.max(y1, A.y[i]);
    }
    if (cnt && lmax - lmin + 1 >= 3 && Math.min(x1 - x0, y1 - y0) < 0.4 * 2 * A.footR) found.push({ id, levels: lmax - lmin + 1, w: Math.min(x1 - x0, y1 - y0) });
  }
  return found;
}

// ── pomiar alokacji PIERWSZY w pliku (inne testy robią miejsca wywołań polimorficznymi) ──
test('krok egzemplarza nie alokuje: ostrzał, zerwania, wyspy, zawias, front, wyspa swobodna, pole płyty; 120 i 60 Hz (untilSteady)', async () => {
  const S = SG.createStructure(HR, { id: 3 });
  const rnd = SG.structureRng(3);
  let tick = 0, i0 = 0;
  // pole płyty z punktami wieży (gather / crush jak w kroku styku)
  const P = SG.createPlateField({ rIn: 560, rOut: 1950, zBot: -1056, thick: 220 });
  const C = SG.towerPointCloud(90), np = C.n;
  const wx = new Float64Array(np), wy = new Float64Array(np), wz = new Float64Array(np), jac = new Float64Array(np).fill(1);
  const plate = (i) => {
    if (i % 400 === 0) { P.th.fill(0); for (let c = 0; c < P.nc; c++) if (P.inDisc[c]) P.th[c] = 255; }
    const dz = -(i % 400) * 0.5;
    for (let p = 0; p < np; p++) { wx[p] = C.bx[p]; wy[p] = C.by[p]; wz[p] = -800 + C.bz[p] + dz; }
    SG.plateGather(P, wx, wy, wz, jac, np);
    for (let t = 0; t < P.nTouched; t++) P.newTop[P.touched[t]] = -1000;
    SG.plateCrush(P);
  };
  // cykl 1200 kroków: podcięcie +x (kratery i fala), potem kondygnacja 15 i front aż do ziemi — reset co cykl
  const fn = () => {
    const i = i0++ % 1200;
    if (i === 0) SG.structureReset(S);
    if (i < 700 && i % 24 === 0) {
      const y = (rnd() * 2 - 1) * 200, z = (rnd() * 2 - 1) * 70;
      SG.structureDamageSphere(S, 190, y, z, 110, 0.18);
      SG.structureHit(S, 190, y, z, 1500, -1, 0, 0);
    }
    if (i === 700) SG.structureReset(S);
    if (i > 700 && i < 900 && i % 30 === 0) for (let j = HR.storeyStart[15]; j < HR.storeyStart[16]; j++) SG.structureDamageBond(S, HR.storeyBonds[j], 0.12);
    SG.stepStructure(S, (i >> 6) & 1 ? 1 / 60 : 1 / 120, tick++);   // na zmianę 64 kroki 120 Hz i 64 kroki 60 Hz
    for (let j = 0; j < S.evCount; j++) {
      const o = j * W;
      if (S.ev[o] === EV.ISLAND && S.ev[o + 15] === 1 && S.ev[o + 3] > 3 && !S.front.active) SG.structureStartFront(S, S.ev[o + 2], 0, null);
      // wyspa oderwana (zawias): uderzenie rogiem — structureSolveIsland
      if (S.ev[o] === EV.HINGE) { const b = SG.structureNearestBlock(S, 190, 200, 300, S.ev[o + 2]); if (b >= 0) { SG.structureAddImpulse(S, b, 0, 0, 5e5 * HR.tune.pulseT); SG.structureSolveIsland(S, S.ev[o + 2]); } }
    }
    plate(i);
  };
  for (let r = 0; r < 4; r++) { for (let i = 0; i < 2400; i++) fn(); await new Promise((res) => setTimeout(res, 50)); }
  const perStep = await untilSteady(() => allocatedBytes(fn, 2400) / 2400, (b) => b < 64, { warm: () => { for (let i = 0; i < 1200; i++) fn(); } });
  assert.ok(perStep < 64, `alokacje: ${perStep.toFixed(1)} B/krok`);
});

test('archetypy: wieżowiec 160–200 bloków, dysk 300–500; kalibracja per wiązanie — wykorzystanie ~0,5 na KAŻDYM poziomie', () => {
  let hrBlocks = 0; for (let i = 0; i < HR.n; i++) if (!HR.anchor[i]) hrBlocks++;
  let dBlocks = 0; for (let i = 0; i < DISC.n; i++) if (!DISC.anchor[i]) dBlocks++;
  assert.ok(hrBlocks >= 160 && hrBlocks <= 200, `wieżowiec: ${hrBlocks} bloków`);
  assert.equal(HR.nLevels, 18);
  assert.ok(dBlocks >= 300 && dBlocks <= 500, `dysk: ${dBlocks} bloków`);
  // wiązania osiowe dysku między warstwami (zginanie płyty): ukośne i pionowe
  let plateD = 0; for (let k = 0; k < DISC.e; k++) if (DISC.cls[k] === SG.STRUCT_BOND.PLATE_D) plateD++;
  assert.ok(plateD > 300, `ukośne płyty: ${plateD}`);
  for (const [A, name, u0] of [[HR, 'wieżowiec', 0.5], [DISC, 'dysk', 0.15], [SG.buildColumnArchetype({ levels: 12 }), 'kolumna', 0.5]]) {
    const S = SG.createStructure(A, { id: 0 });
    for (let t = 0; t < 8; t++) SG.stepStructure(S, 1 / 120, t);
    assert.equal(S.stats.breaks, 0, `${name}: nienaruszona nie pęka`);
    const lv = new Float64Array(A.nLevels);
    for (let k = 0; k < A.e; k++) { const l = Math.max(A.level[A.ba[k]], A.level[A.bb[k]], 0); lv[l] = Math.max(lv[l], S.ratio[k]); }
    for (let l = 0; l < A.nLevels; l++) {
      // najbardziej obciążone wiązanie poziomu: u0 / (1 ± rozrzut 15%) — globalny limit benchmarku dawał ~0,02 przy szczycie
      assert.ok(lv[l] > u0 * 0.8 && lv[l] < u0 * 1.25, `${name} poziom ${l}: wykorzystanie ${lv[l].toFixed(3)}`);
    }
  }
});

test('kolumna: siła pionowa każdej kondygnacji = ciężar nad nią (≤ 5%), reszta równowagi z rekurencji CG = prawdziwa', () => {
  const A = SG.buildColumnArchetype({ levels: 12 });
  const S = SG.createStructure(A, { id: 0 });
  SG.stepStructure(S, 1 / 120, 0);
  assert.ok(S.stats.evals === 1);
  const Wl = new Float64Array(A.nLevels + 1);
  for (let i = 0; i < A.n; i++) if (A.level[i] >= 0) Wl[A.level[i]] += A.mass[i] * A.g;
  for (let l = A.nLevels - 1; l >= 0; l--) Wl[l] += Wl[l + 1];
  for (let st = 0; st < A.nStoreys; st++) {
    let up = 0;
    for (let j = A.storeyStart[st]; j < A.storeyStart[st + 1]; j++) { const k = A.storeyBonds[j]; up += S.nAx[k] * A.ng[k]; }
    assert.ok(Math.abs(up - Wl[st]) <= 0.05 * Wl[st], `kondygnacja ${st}: ${up.toFixed(0)} vs ciężar ${Wl[st].toFixed(0)}`);
  }
  assert.ok(Math.abs(SG.structureResidual(S) - S.lastErr) < 1e-6 + 0.01 * S.lastErr, 'reszta niezależna = rekurencja');
});

test('wspornik: moment u nasady rośnie z długością (∝ L²), błąd ≤ 5% wobec Σ m·g·x; siły osiowe w KAŻDYM przekroju = M(x) (≤ 5%)', () => {
  let prev = 0;
  for (const segments of [4, 8, 12]) {
    const A = SG.buildCantileverArchetype({ segments });
    const S = SG.createStructure(A, { id: 0 });
    for (let t = 0; t < 8; t++) SG.stepStructure(S, 1 / 120, t);
    // przekrój w połowie przęsła s: moment od bloków za nim wobec Σ N·n_x·z wiązań przekroju (pasy + stężenia; ścinanie
    // regulatora karze sztywny obrót — przy shearK 1e-4 koniec 12 przęseł przenosił osiowo tylko 63% momentu)
    for (let sg = 1; sg <= segments; sg++) {
      const xc = (sg - 0.5) * 100;
      let M = 0, Mn = 0;
      for (let i = 0; i < A.n; i++) if (!A.anchor[i] && A.x[i] > xc) M += (A.x[i] - xc) * A.mass[i] * A.g;
      for (let k = 0; k < A.e; k++) if (Math.abs(A.cx[k] - xc) < 1) Mn += S.nAx[k] * A.nx[k] * A.cz[k];
      assert.ok(Math.abs(Mn / M - 1) <= 0.05, `${segments} przęseł, przekrój ${sg}: osiowo ${(Mn / M * 100).toFixed(1)}% momentu`);
    }
    let Ma = 0;
    for (let i = 0; i < A.n; i++) if (!A.anchor[i]) Ma += A.x[i] * A.mass[i] * A.g;
    // siły wiązań kotwic działające na bloki wolne (oś y przez nasadę): M = Σ (z·Fx − x·Fz)
    let Mb = 0;
    for (let k = 0; k < A.e; k++) {
      const a = A.ba[k], b = A.bb[k];
      if (!A.anchor[a] || A.anchor[b]) continue;
      const dx = S.ux[b], dy = S.uy[b], dz = S.uz[b], ex = A.nx[k], ey = A.ny[k], ez = A.nz[k];
      const kk = S.ka[k], ks = S.kS[k], c = (kk - ks) * (ex * dx + ey * dy + ez * dz);
      Mb += A.z[b] * -(ks * dx + c * ex) - A.x[b] * -(ks * dz + c * ez);
    }
    const err = Math.abs(-Mb - Ma) / Ma;
    assert.ok(err <= 0.05, `${segments} przęseł: moment grafu ${(-Mb).toExponential(3)} vs ${Ma.toExponential(3)} (${(err * 100).toFixed(2)}%)`);
    assert.ok(-Mb > prev * 1.5, 'moment rośnie z długością');
    prev = -Mb;
  }
  // kontrola: laplasjan izotropowy (człon ścinania = osiowy) nie przenosi momentu — model benchmarku
  const L = SG.buildCantileverArchetype({ segments: 8, tune: { shearK: 1 } });
  const SL = SG.createStructure(L, { id: 0 });
  for (let t = 0; t < 8; t++) SG.stepStructure(SL, 1 / 120, t);
  let Ma = 0, Mb = 0;
  for (let i = 0; i < L.n; i++) if (!L.anchor[i]) Ma += L.x[i] * L.mass[i] * L.g;
  for (let k = 0; k < L.e; k++) {
    const a = L.ba[k], b = L.bb[k];
    if (!L.anchor[a] || L.anchor[b]) continue;
    Mb += L.z[b] * -(SL.kS[k] * SL.ux[b]) - L.x[b] * -(SL.kS[k] * SL.uz[b]);
  }
  assert.ok(Math.abs(-Mb) < 0.3 * Ma, `laplasjan: moment pasów ${(-Mb / Ma * 100).toFixed(0)}% — sceptyk miał rację`);
});

test('podcięcie +x → zawias i przechył ku +x, lustro −x → ku −x; ocena zawsze przy reszcie ≤ 5% (60 i 120 Hz)', () => {
  for (const hz of [120, 60]) {
    const P = undercut(1, hz), N = undercut(-1, hz);
    for (const [r, sign] of [[P, 1], [N, -1]]) {
      assert.ok(r.island, `${hz} Hz ${sign}: wyspa`);
      assert.ok(r.island.mass > 0.5 * HR.totalMass, `${hz} Hz: oderwała się góra (${r.island.mass.toFixed(0)} / ${HR.totalMass.toFixed(0)})`);
      assert.ok(r.hinge, `${hz} Hz ${sign}: zawias`);
      assert.ok(r.hinge.dx * sign > 0.8, `${hz} Hz: przechył ku ${sign > 0 ? '+' : '−'}x: (${r.hinge.dx.toFixed(2)}, ${r.hinge.dy.toFixed(2)})`);
      // oś obrotu ⊥ kierunek, pozioma; ramię > 0
      assert.ok(Math.abs(r.hinge.ax * r.hinge.dx + r.hinge.ay * r.hinge.dy) < 1e-9 && r.hinge.arm > 0);
      // zawias na krawędzi przeciwnej do podcięcia (ostatnia linia podpór), nie przy środku rzutu
      assert.ok(-sign * r.hinge.px > 0.6 * 190, `${hz} Hz: punkt zawiasu x ${r.hinge.px.toFixed(0)}`);
      assert.ok(r.S.stats.maxEvalErr <= HR.tune.solveTol, `${hz} Hz: błąd równowagi przy ocenie ${r.S.stats.maxEvalErr.toFixed(4)}`);
      // kroki z zerwaniami: każde zerwanie z oceny przyszło z rozwiązania zbieżnego (zerwania są) — sprawdzone wyżej
      assert.ok(r.S.stats.breaks > 20, 'kaskada zerwań przed oderwaniem');
      // kruszenie przed oderwaniem: zerwania wcześniej niż wyspa
      const firstBreak = r.events.find((e) => e[0] === EV.BREAK || e[0] === EV.BREAKS);
      assert.ok(firstBreak && firstBreak[1] < r.island.t - 1, 'zerwania narastają przed oderwaniem');
    }
  }
});

test('D11 — przechył ku stronie podciętej: W-1 i W-2, strony ±x / ±y, 8 ziaren × 3 warianty; zawias na przeciwnej krawędzi', () => {
  const res = { ok: 0, wrong: 0, drop: 0, none: 0, nearCenter: 0 };
  for (const A of [HR, SG.buildHighriseArchetype({ seed: 6 })]) {
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const half = sx ? 190 : 210;
      for (let seed = 1; seed <= 8; seed++) for (const [amt, wave] of [[0.18, 0], [0.12, 1500], [0.3, 0]]) {
        const S = SG.createStructure(A, { id: seed });
        const rnd = SG.structureRng(seed * 31 + 7);
        let out = null;
        for (let s = 0; s < 40 * 120 && !out; s++) {
          if (s % 24 === 0) {
            const t = rnd() * 2 - 1, z = (rnd() * 2 - 1) * 70, x = sx ? sx * 190 : t * 180, y = sy ? sy * 200 : t * 190;
            SG.structureDamageSphere(S, x, y, z, 110, amt);
            if (wave) SG.structureHit(S, x, y, z, wave, -sx, -sy, 0);
          }
          SG.stepStructure(S, 1 / 120, s);
          for (const e of stepEvents(S)) {
            if (e[0] === EV.ISLAND && e[13] > 0.3 * A.totalMass && e[14] === -1 && e[15] === 1) out = { drop: true };
            if (e[0] === EV.HINGE && e[15] > 0.3 * A.totalMass) out = { d: e[7] * sx + e[8] * sy, p: e[4] * sx + e[5] * sy };
          }
        }
        if (!out) res.none++;
        else if (out.drop) res.drop++;
        // ≤ 45° od normalnej ściany podciętej (narożnik bywa ostatnią linią podpór)
        else if (out.d > 0.7) { res.ok++; if (-out.p < 0.5 * half) res.nearCenter++; } else res.wrong++;
      }
    }
  }
  const n = res.ok + res.wrong + res.drop + res.none;
  assert.equal(res.wrong, 0, JSON.stringify(res));
  assert.ok(res.ok >= 0.95 * n, `przechył ku podcięciu w ${res.ok}/${n}: ${JSON.stringify(res)}`);
  assert.equal(res.nearCenter, 0, `punkt zawiasu przy środku rzutu: ${JSON.stringify(res)}`);
});

test('ciężkie losowe uszkodzenia: ocena tylko przy reszcie ≤ solveTol, mechanizmy pękają jako MECH (nie ścinanie), seria niezbieżnych przebiegów ograniczona', () => {
  const modes = new Int32Array(16);
  for (const seed of [4, 6, 7, 12]) {
    const S = SG.createStructure(HR, { id: 1 });
    const rnd = SG.structureRng(seed);
    for (let s = 0; s < 120 * 20; s++) {
      if (s % 6 === 0) SG.structureDamageBond(S, (rnd() * HR.e) | 0, 0.5 + rnd());
      SG.stepStructure(S, 1 / 120, s);
      for (const e of stepEvents(S)) if (e[0] === EV.BREAK) modes[e[3]]++;
    }
    assert.ok(S.stats.evals > 100 && S.stats.maxEvalErr <= HR.tune.solveTol, `ziarno ${seed}: oceny ${S.stats.evals}, błąd ${S.stats.maxEvalErr.toFixed(4)}`);
    assert.ok(S.stats.maxPending <= HR.tune.mechAfter + 16, `ziarno ${seed}: seria ${S.stats.maxPending}`);
  }
  // ścinanie materiału (poza blokami-mechanizmami) przy shearK 1e-6 nie łamie — przegub mechanizmu ma tryb MECH
  assert.equal(modes[SG.STRUCT_MODE.SHEAR], 0, `zerwania SHEAR: ${modes[SG.STRUCT_MODE.SHEAR]}`);
  assert.ok(modes[SG.STRUCT_MODE.MECH] > 0 && modes[SG.STRUCT_MODE.MECH] < 0.25 * modes.reduce((a, b) => a + b, 0), `MECH ${modes[SG.STRUCT_MODE.MECH]}`);
});

test('okno impulsu: pojedyncze trafienie = J / pulseT niezależnie od czasu od ostatniej oceny; styk ciągły F·dt → F', () => {
  const force = (S, b) => { SG.structureResidual(S); return S.fz[b] - HR.mass[b] * HR.g * HR.gz; };
  const b = SG.structureNearestBlock(SG.createStructure(HR, { id: 0 }), 190, 0, 300, -1);
  const a = SG.createStructure(HR, { id: 0 });
  SG.stepStructure(a, 1 / 120, 0);
  SG.structureAddImpulse(a, b, 0, 0, 100);
  const fa = force(a, b);
  const c = SG.createStructure(HR, { id: 0 });
  for (let t = 0; t < 60; t++) SG.stepStructure(c, 1 / 120, t);
  c.lastEval = 0;   // jak po 0,5 s niezbieżnych przebiegów
  SG.structureAddImpulse(c, b, 0, 0, 100);
  const fc = force(c, b);
  assert.ok(Math.abs(fa - 100 / HR.tune.pulseT) < 1e-6 && Math.abs(fc - fa) < 1e-6, `siła ${fa} / ${fc}`);
  // styk ciągły: F·dt przed każdym z 8 kroków (bez oceny między nimi) → F
  const d = SG.createStructure(HR, { id: 0 });
  SG.stepStructure(d, 1 / 120, 0);
  for (let t = 1; t <= 8; t++) { SG.structureAddImpulse(d, b, 0, 0, 5000 / 120); if (t < 8) { d.time += 1 / 120; d.dt = 1 / 120; } }
  assert.ok(Math.abs(force(d, b) - 5000) < 1e-6, `styk ciągły ${force(d, b)}`);
});

test('kondygnacja 15: zgniot od góry (spadek → front do ziemi) albo przechył (strona uszkodzona) — bez plastra', () => {
  const sym = storeyDamage('sym', 15, 120);
  const top = sym.islands.find((i) => i.mass > 100);
  assert.ok(top && top.drop === 1, 'symetrycznie: góra spada pionowo (bez zawiasu)');
  assert.ok(sym.frontStart > 0 && sym.ground, 'front zgniata budowlę do ziemi (κ domyślne)');
  assert.deepEqual(plasters(sym.S), [], 'bez plastra pełnej wysokości');
  const ecc = storeyDamage('ecc', 15, 120);
  assert.ok(ecc.hinge && ecc.hinge.dx > 0.8, `uszkodzona strona +x → przechył ku +x (${ecc.hinge?.dx})`);
  assert.deepEqual(plasters(ecc.S), [], 'bez plastra');
  // oderwana góra zaczyna się na kondygnacji 15 (nie niżej) — kalibracja per poziom
  const big = ecc.islands.reduce((m, i) => (i.mass > m.mass ? i : m), { mass: 0 });
  let lmin = 99;
  for (let i = 0; i < HR.n; i++) if (ecc.S.island[i] === big.id && !ecc.S.dead[i]) lmin = Math.min(lmin, HR.level[i]);
  assert.equal(lmin, 15);
});

test('plaster: wysoka wąska wyspa pęka po wiązaniach pięter (paczki ≤ chunkLevels poziomów)', () => {
  const S = SG.createStructure(HR, { id: 5 });
  SG.stepStructure(S, 1 / 120, 0);
  // odcinamy kolumnę obwodu +x (sektory przy x = +190) od reszty na wysokości 4–11: zrywamy wiązania poziome do
  // sąsiadów i rdzenia oraz pionowe u dołu i u góry
  const inCol = (i) => HR.level[i] >= 4 && HR.level[i] <= 11 && HR.x[i] > 150 && Math.abs(HR.y[i]) < 120;
  for (let k = 0; k < HR.e; k++) {
    const a = HR.ba[k], b = HR.bb[k];
    if (inCol(a) !== inCol(b)) SG.structureDamageBond(S, k, 1);
  }
  let split = null; const isl = [];
  for (let t = 1; t < 30; t++) {
    SG.stepStructure(S, 1 / 120, t);
    // cięcia plastra (SPLIT) w budżecie zerwań kroku
    assert.ok(S.breaksThisStep <= 64, `krok ${t}: ${S.breaksThisStep} zerwań`);
    for (const e of stepEvents(S)) { if (e[0] === EV.SPLIT) split = e; if (e[0] === EV.ISLAND) isl.push(e); }
  }
  assert.ok(split, 'SPLIT');
  assert.ok(split[13] >= 3, `rodzic ${split[13]} poziomów`);
  // kawałki z rodzicem = wyspa pęknięta (albo jej kawałek — cięcia ponad budżet schodzą w kolejnych krokach)
  const desc = new Set([split[2]]);
  for (const e of isl) if (desc.has(e[14])) desc.add(e[2]);
  assert.ok(isl.length >= 2 && isl.filter((e) => e[14] !== -1).every((e) => desc.has(e[14])), 'kawałki z rodzicem = wyspa pęknięta');
  assert.deepEqual(plasters(S), []);
});

test('front Bažanta: κ 0,1–0,3 × gruz 20–30% dochodzi do ziemi, κ = 1 staje (≤ 3 piętra); ≤ 1 poziom na 1/120 s; czas bez strat', () => {
  for (const L of [15, 9]) {
    for (const debris of [0.2, 0.3]) for (const kappa of [0.1, 0.2, 0.3]) {
      const r = storeyDamage('sym', L, 120, kappa, 20, debris);
      assert.ok(r.ground, `L ${L} κ ${kappa} gruz ${debris}: do ziemi (stop: ${JSON.stringify(r.stop)})`);
      assert.ok(r.front.length >= L - 1, `zgniecione poziomy ${r.front.length}`);
      assert.ok(r.maxLevelsPerStep <= 1);
      for (const f of r.front) assert.ok(f.debris > 0, 'gruz z każdego poziomu');
    }
    // κ = 1: R ≈ 1,25 ciężaru nad kondygnacją > ciężar spadającego bloku — staje po 1–3 piętrach (pęd z pierwszego
    // spadku swobodnego wytraca się na kolejnych)
    const stop = storeyDamage('sym', L, 120, 1, 12);
    assert.ok(stop.stop && !stop.ground, `κ = 1 staje (L ${L})`);
    assert.ok(stop.front.length <= 3, `κ = 1: ${stop.front.length} poziomów`);
  }
  // budżet poziomów wyczerpany (cienkie kondygnacje, szybki front): czas niedoliczony przechodzi na następny krok —
  // F.t + F.lag = czas gry, a ruch frontu (F.t do ziemi) jak bez limitu — budżet tylko go opóźnia
  {
    const NL = 40, lz = new Float64Array(NL), lm = new Float64Array(NL).fill(1), lc = new Float64Array(NL).fill(10);
    for (let l = 0; l < NL; l++) lz[l] = l * 2;
    const run = (lp) => {
      const F = SG.createCollapseFront();
      SG.startCollapseFront(F, 50, NL * 2, 600, NL - 1, 400, 0.2, 0.2, lp);
      let t = 0;
      while (F.active && t < 5) { SG.stepCollapseFront(F, lz, lm, lc, -2, 1 / 120); t += 1 / 120; assert.ok(Math.abs(F.t + F.lag - t) < 1e-9 || !F.active); }
      return { ft: F.t, wall: t, g: F.grounded };
    };
    const lim = run(1), free = run(1000);
    assert.ok(lim.g && free.g && Math.abs(lim.ft - free.ft) < 1e-9 && lim.wall > free.wall, `front z budżetem ${JSON.stringify(lim)}, bez ${JSON.stringify(free)}`);
  }
  // czysta funkcja kroku: 60 Hz → ≤ 2 poziomy na krok, czasy jak przy 120 Hz
  const levZ = Float64Array.from([0, 100, 200, 300, 400]), m = Float64Array.from([10, 10, 10, 10, 10]), cap = Float64Array.from([2000, 2000, 2000, 2000, 2000]);
  const tEnd = (hz) => {
    const F = SG.createCollapseFront();
    SG.startCollapseFront(F, 20, 500, 0, 4, 400, 0.2, 0.2);
    let t = 0, maxPer = 0;
    while (F.active && t < 20) { const c = SG.stepCollapseFront(F, levZ, m, cap, -50, 1 / hz); maxPer = Math.max(maxPer, c); t += 1 / hz; }
    return { t: F.t, grounded: F.grounded, maxPer };
  };
  const a = tEnd(120), b = tEnd(60);
  assert.ok(a.grounded && b.grounded);
  assert.ok(a.maxPer <= 1 && b.maxPer <= 2);
  assert.ok(Math.abs(a.t - b.t) <= 0.05 * a.t, `czas frontu 120 / 60 Hz: ${a.t.toFixed(3)} / ${b.t.toFixed(3)}`);
});

test('fala w konstrukcji: tylko z nią kruszy się ponad pasem broni (z > 420) przed oderwaniem', () => {
  const run = (wave) => {
    const S = SG.createStructure(HR, { id: 4 });
    let maxZ = -1e9, highBefore = 0, island = -1;
    for (let s = 0; s < 30 * 120 && island < 0; s++) {
      if (s % 30 === 0) {
        const y = ((s / 30) % 5 - 2) * 80;
        SG.structureDamageSphere(S, 190, y, 0, 60, 0.08);
        if (wave) SG.structureHit(S, 190, y, 0, 2000, -1, 0, 0);
      }
      SG.stepStructure(S, 1 / 120, s);
      for (const e of stepEvents(S)) {
        if (e[0] === EV.BREAK) { maxZ = Math.max(maxZ, e[6]); if (e[6] > 420) highBefore++; }
        if (e[0] === EV.ISLAND && e[13] > 0.3 * HR.totalMass) island = e[1];
      }
    }
    return { maxZ, highBefore, island, S };
  };
  const w = run(true), n = run(false);
  assert.ok(w.highBefore >= 3, `z falą: ${w.highBefore} zerwań ponad z 420 przed oderwaniem`);
  assert.ok(n.maxZ < 420 && n.highBefore === 0, `bez fali: najwyższe zerwanie z ${n.maxZ.toFixed(0)}`);
  assert.ok(w.S.stats.maxEvalErr <= HR.tune.solveTol);
  // osłabienie maleje z wysokością (deterministycznie): wytrzymałość wiązań nad trafieniem
  const S = SG.createStructure(HR, { id: 4 });
  SG.structureHit(S, 190, 0, 0, 2000, -1, 0, 0);
  let lo = 0, hi = 0, nl = 0, nh = 0;
  for (let k = 0; k < HR.e; k++) {
    if (Math.abs(HR.cy[k]) > 120 || HR.cx[k] < 80 || HR.cls[k] === SG.STRUCT_BOND.VERT) continue;
    if (HR.cz[k] > 0 && HR.cz[k] < 200) { lo += 1 - S.strength[k]; nl++; }
    if (HR.cz[k] > 800 && HR.cz[k] < 1000) { hi += 1 - S.strength[k]; nh++; }
  }
  assert.ok(nl && nh && lo / nl > 2 * (hi / nh) && hi > 0, `osłabienie: dół ${(lo / nl).toFixed(4)}, góra ${(hi / nh).toFixed(4)}`);
});

// Wyspa swobodna: wywołania aż do zbieżności (niezbieżne → −1, kontynuacja od zapamiętanych przemieszczeń).
function solveIsland(S, id, maxCalls = 80) {
  let br = -1, calls = 0;
  while (br < 0 && calls < maxCalls) { br = SG.structureSolveIsland(S, id); calls++; }
  return { br, calls };
}

test('wyspa swobodna: odciążenie bezwładnościowe — jednorodne przyspieszenie bez naprężeń, uderzenie rogiem łamie i dzieli; zerwania tylko ze zbieżnego rozwiązania', () => {
  const freeTop = () => {
    const S = SG.createStructure(HR, { id: 1 });
    let t = 0;
    for (; t < 240 && S.nIsl === 0; t++) {
      if (t % 30 === 0) for (let j = HR.storeyStart[9]; j < HR.storeyStart[10]; j++) SG.structureDamageBond(S, HR.storeyBonds[j], 0.3);
      SG.stepStructure(S, 1 / 120, t);
    }
    SG.stepStructure(S, 1 / 120, t);
    let id = -1, best = 0; const mass = new Float64Array(S.nIsl);
    for (let i = 0; i < HR.n; i++) if (S.island[i] >= 0 && !S.dead[i]) mass[S.island[i]] += HR.mass[i];
    for (let k = 0; k < S.nIsl; k++) if (mass[k] > best) { best = mass[k]; id = k; }
    return { S, id, mass: best };
  };
  // (1) wszystkie bloki tym samym przyspieszeniem (impuls m·a·pulseT) — sztywny ruch, zero naprężeń
  {
    const { S, id } = freeTop();
    for (let i = 0; i < HR.n; i++) if (S.island[i] === id) SG.structureAddImpulse(S, i, 0, HR.mass[i] * 900 * HR.tune.pulseT, HR.mass[i] * 1500 * HR.tune.pulseT);
    const br = SG.structureSolveIsland(S, id);
    assert.equal(br, 0);
    let maxR = 0;
    for (let t = 0; t < S.nAct2; t++) maxR = Math.max(maxR, S.ratio[S.act2[t]]);
    assert.ok(maxR < 1e-6, `bez naprężeń: ${maxR}`);
  }
  // (2) lądowanie rogiem: słaby impuls nie łamie nic, mocny łamie i dzieli wyspę (ISLAND z rodzicem)
  const corner = (S, id) => { let b = -1, bz = 1e9; for (let i = 0; i < HR.n; i++) if (S.island[i] === id && HR.x[i] > 100 && HR.y[i] > 100 && HR.z[i] < bz) { bz = HR.z[i]; b = i; } return b; };
  {
    const { S, id, mass } = freeTop();
    SG.structureAddImpulse(S, corner(S, id), 0, 0, 0.02 * mass * HR.g * HR.tune.pulseT);
    assert.equal(solveIsland(S, id).br, 0, 'słaby styk (2% ciężaru)');
    assert.ok(S.lastErr <= HR.tune.solveTol);
  }
  {
    const { S, id, mass } = freeTop();
    S.evCount = 0;
    SG.structureAddImpulse(S, corner(S, id), 0, 0, 5 * mass * HR.g * HR.tune.pulseT);
    const { br } = solveIsland(S, id);
    assert.ok(br > 0, 'mocny styk łamie');
    assert.ok(S.lastErr <= HR.tune.solveTol, `reszta ${S.lastErr}`);
    // zerwania ponad budżet kroku (64 na 1/120 s) czekają w kolejce — kawałki wychodzą w kolejnych krokach
    const kids = stepEvents(S).filter((e) => e[0] === EV.ISLAND);
    for (let t = 0; t < 8; t++) { SG.stepStructure(S, 1 / 120, 1000 + t); kids.push(...stepEvents(S).filter((e) => e[0] === EV.ISLAND)); }
    // kawałki wyspy (i kawałki kawałków, gdy kolejka zerwań schodzi w kolejnych krokach) — łańcuch rodziców do id
    const desc = new Set([id]);
    for (const e of kids) { assert.ok(desc.has(e[14]), `rodzic ${e[14]} spoza wyspy ${id}`); desc.add(e[2]); }
    assert.ok(kids.length >= 1);
  }
  // zerwania tylko z rozwiązania zbieżnego: wyspa po podcięciu (144 bloki, zimny start — ~1,5–5 tys. iteracji)
  // uderzona bokiem — kolejne wywołania co krok kontynuują rozwiązanie; −1 nic nie łamie
  for (const [px, py, pz, jx, jy, jz] of [[0, 200, 600, 0, -3, 0], [0, 0, 1800, -0.3, 0, -0.3]]) {
    const r = undercut(1, 120);
    const S = r.S, id = r.island.id;
    let mass = 0; for (let i = 0; i < HR.n; i++) if (S.island[i] === id && !S.dead[i]) mass += HR.mass[i];
    const b = SG.structureNearestBlock(S, px, py, pz, id), J = mass * HR.g * HR.tune.pulseT;
    SG.structureAddImpulse(S, b, jx * J, jy * J, jz * J);
    let br = -1, calls = 0, tick = 100000;
    while (br < 0 && calls < 80) {
      const b0 = S.stats.breaks;
      br = SG.structureSolveIsland(S, id); calls++;
      if (br < 0) assert.equal(S.stats.breaks, b0, 'niezbieżne wywołanie nic nie łamie');
      SG.stepStructure(S, 1 / 120, tick++);
    }
    assert.ok(br > 0 && S.lastErr <= HR.tune.solveTol, `wyspa po podcięciu: ${br} po ${calls} wywołaniach, reszta ${S.lastErr}`);
    if (pz > 1000) assert.ok(calls > 1 && S.stats.islandRefused >= calls - 1, `uderzenie w szczyt — kontynuacja: ${calls} wywołań`);
  }
  {
    const S = SG.createStructure(DISC, { id: 0 });
    SG.stepStructure(S, 1 / 120, 0);
    for (let i = 0; i < DISC.n; i++) if (DISC.anchor[i] === SG.STRUCT_ANCHOR.SUPPORT) SG.structureReleaseAnchor(S, i);
    SG.stepStructure(S, 1 / 120, 1);
    const id = S.island[SG.structureNearestBlock(S, 1400, 0, -900, -3)];
    assert.ok(id >= 0, 'dysk bez podpór = wyspa');
    const b = SG.structureNearestBlock(S, 1800, 0, -900, id);
    SG.structureAddImpulse(S, b, 0, 0, 2 * DISC.totalMass * DISC.g * DISC.tune.pulseT);
    const { br, calls } = solveIsland(S, id);
    assert.ok(br >= 0 && S.lastErr <= DISC.tune.solveTol, `wolny dysk: ${br} po ${calls} wywołaniach, reszta ${S.lastErr}`);
  }
});

test('prototyp progu dysku: SZYJA trzyma (bez otworów, ≤ 5% bloków grafu), UPADEK przebija (IoU ≥ 0,7); jeden próg nie rozdziela', () => {
  const cloud = SG.towerPointCloud();
  // (a) szyja — utrzymanie 1: krawędź talerza ~0,8–1,4 km/s przy 80–110°
  for (const omega0 of [0.55, 0.85]) {
    const a = SG.plateImpactScenario('szyja', { omega0, cloud, disc: DISC });
    assert.ok(a.rimSpeed > 800 && a.rimSpeed < 1500, `prędkość krawędzi ${a.rimSpeed.toFixed(0)}`);
    assert.equal(a.disc.holes, 0, `ω0 ${omega0}: otwory ${a.disc.holes}`);
    assert.ok(a.disc.trench > 0 && a.disc.trench <= 0.05 * a.disc.cells, `płytki rów: ${a.disc.trench} komórek`);
    assert.ok(a.graph.lostFrac <= 0.05, `graf dysku traci ${a.graph.lost}/${a.graph.blocks}`);
    assert.ok(a.endDeg > 95 && a.endDeg < 125, `wieża leży na koronie i w dysku: ${a.endDeg.toFixed(1)}°`);
  }
  // szyja przy utrzymaniu na brzegu okna trzymania (holdHeld) — tak samo
  {
    const a = SG.plateImpactScenario('szyja', { omega0: 0.85, cloud, disc: DISC, hold: SG.PLATE_TUNE.holdHeld });
    assert.equal(a.disc.holes, 0);
  }
  // (b) upadek — utrzymanie z zegara D8 w chwili dojścia (v0 / gFall ≥ 3,5 s > d8Seconds → 0), 900–1700 j/s
  for (const v0 of [900, 1700]) {
    const b = SG.plateImpactScenario('upadek', { v0, cloud, disc: DISC });
    assert.ok(b.tArrive >= SG.PLATE_TUNE.d8Seconds && b.hold === 0, `D8: wieża dochodzi po ${b.tArrive.toFixed(2)} s, utrzymanie ${b.hold}`);
    assert.ok(b.passed, `v0 ${v0}: wieża przechodzi`);
    assert.ok(b.vPass < v0, `wieża traci pęd na korku: ${b.vPass.toFixed(0)} z ${v0}`);
    // kształt otworu w prototypie 1-DOF (ruch pionowy) to z konstrukcji rzut wieży — IoU sprawdza tylko, że zgniot
    // nie wychodzi poza przekrój; wejście pod kątem / z ruchem bocznym — E6 (6 DOF)
    assert.ok(b.iou >= 0.7, `IoU otworu z przekrojem wieży ${b.iou.toFixed(3)}`);
    // graf dysku: podpory nie puszczają przed dotknięciem (utrzymanie 0 ≠ dysk odpada sam), po przebiciu zewnętrzny
    // pierścień zostaje bez podpór (otwór zjada pierścienie przy trzonie) — wyspa
    assert.equal(b.graph.supportFailsBeforeContact, 0, 'dysk nie spada przed wieżą');
    assert.ok(b.graph.islands >= 1 && b.graph.maxEvalErr <= DISC.tune.solveTol, JSON.stringify(b.graph));
  }
  // okno progu D8: przebija także przy utrzymaniu 0,05 i holdFree, nie przy holdHeld
  for (const hold of [0.05, SG.PLATE_TUNE.holdFree]) assert.ok(SG.plateImpactScenario('upadek', { v0: 900, cloud, disc: DISC, hold }).passed, `utrzymanie ${hold}`);
  assert.ok(!SG.plateImpactScenario('upadek', { v0: 1700, cloud, disc: DISC, hold: SG.PLATE_TUNE.holdHeld }).passed, 'utrzymanie holdHeld trzyma');
  // pole przypina komórki do GÓRNEJ warstwy grafu
  {
    const P = SG.createPlateField({ rIn: 560, rOut: 1950, zBot: -1056, thick: 220 });
    SG.plateBindGraph(P, SG.createStructure(DISC, { id: 0 }));
    let top = 0, all = 0, zmax = -Infinity;
    for (let i = 0; i < DISC.n; i++) if (!DISC.anchor[i]) zmax = Math.max(zmax, DISC.z[i]);
    for (let c = 0; c < P.nc; c++) if (P.cellBlock[c] >= 0) { all++; if (DISC.z[P.cellBlock[c]] === zmax) top++; }
    assert.ok(all > 5000 && top === all, `komórki w górnej warstwie ${top}/${all}`);
  }
  // jeden próg: przechodzi tylko przy σ ≤ ~6 (900 j/s), szyja trzyma dopiero od σ ≥ ~160 (1,2–1,4 km/s)
  const one = (s) => ({ szyja: SG.plateImpactScenario('szyja', { sigmaHeld: s, sigmaFree: s, omega0: 0.85, cloud, graph: false }),
    upadek: SG.plateImpactScenario('upadek', { sigmaHeld: s, sigmaFree: s, v0: 900, cloud, graph: false }) });
  const low = one(6), high = one(120);
  assert.ok(low.upadek.passed && low.szyja.disc.holes > 0.05 * low.szyja.disc.cells, 'σ, który przebija w upadku, przecina dysk w szyi');
  assert.ok(!high.upadek.passed && high.szyja.disc.holes > 0, 'σ prawie trzymający szyję zatrzymuje upadek');
});

test('determinizm: 3 przebiegi bit w bit (zdarzenia, stan wiązań, przemieszczenia)', () => {
  const runs = [0, 1, 2].map(() => undercut(1, 120));
  for (let r = 1; r < 3; r++) {
    assert.deepEqual(runs[r].events, runs[0].events);
    assert.ok(Buffer.from(runs[r].S.health.buffer).equals(Buffer.from(runs[0].S.health.buffer)));
    assert.ok(Buffer.from(runs[r].S.alive.buffer).equals(Buffer.from(runs[0].S.alive.buffer)));
    assert.ok(Buffer.from(runs[r].S.ux.buffer).equals(Buffer.from(runs[0].S.ux.buffer)));
  }
  // archetyp z tym samym ziarnem — te same limity; inne ziarno — inny rozrzut
  const a = SG.buildHighriseArchetype({ seed: 5 }), b = SG.buildHighriseArchetype({ seed: 6 });
  assert.ok(Buffer.from(a.limC.buffer).equals(Buffer.from(HR.limC.buffer)));
  assert.ok(!Buffer.from(b.limC.buffer).equals(Buffer.from(HR.limC.buffer)));
});

test('60 vs 120 Hz: czasy zdarzeń ±5% (oderwanie przy podcięciu, front do ziemi)', () => {
  const a = undercut(1, 120), b = undercut(1, 60);
  assert.ok(Math.abs(a.island.t - b.island.t) <= 0.05 * a.island.t, `oderwanie ${a.island.t.toFixed(3)} / ${b.island.t.toFixed(3)} s`);
  const c = storeyDamage('sym', 15, 120), d = storeyDamage('sym', 15, 60);
  const ta = c.ground.t - c.frontStart, tb = d.ground.t - d.frontStart;
  assert.ok(Math.abs(c.frontStart - d.frontStart) <= 0.05 * c.frontStart, `start frontu ${c.frontStart} / ${d.frontStart}`);
  assert.ok(Math.abs(ta - tb) <= 0.05 * ta, `front do ziemi ${ta.toFixed(3)} / ${tb.toFixed(3)} s`);
});

test('budżet: ≤ 64 zerwania na 1/120 s (60 Hz: 128), nadmiar w kolejce; rekordy zdarzeń ≤ STRUCT_EV_CAP, nadmiar zbiorczo', () => {
  for (const hz of [120, 60]) {
    const S = SG.createStructure(HR, { id: 6 });
    SG.stepStructure(S, 1 / hz, 0);
    for (let k = 0; k < HR.e; k++) SG.structureDamageBond(S, k, 1);   // wszystko w kolejce
    const cap = hz === 120 ? 64 : 128;
    let total = 0;
    for (let t = 1; t < 40; t++) {
      SG.stepStructure(S, 1 / hz, t);
      assert.ok(S.breaksThisStep <= cap, `${hz} Hz krok ${t}: ${S.breaksThisStep}`);
      assert.ok(S.evCount <= SG.STRUCT_EV_CAP);
      const ev = stepEvents(S);
      const nb = ev.filter((e) => e[0] === EV.BREAK).length + ev.filter((e) => e[0] === EV.BREAKS).reduce((s, e) => s + e[3], 0);
      if (!ev.some((e) => e[0] === EV.OVERFLOW)) assert.equal(nb, S.breaksThisStep, 'zerwania w rekordach (pojedynczo + zbiorczo)');
      total += S.breaksThisStep;
    }
    assert.equal(total, HR.e, 'kolejka opróżniona');
  }
});

test('gra nie losuje: src/game/structure*.js bez Math.random (rozrzut z PRNG ziarna archetypu)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/game/structureGraph.js', import.meta.url)), 'utf8');
  assert.ok(!/Math\.random/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
});

// ── progi czasu ściany (HULLFALL_TESTY_WYDAJNOSC=1) ──
test('WYDAJNOŚĆ: wieżowiec pod ostrzałem ≤ 0,1 ms średnio na krok; najgorszy krok ≤ 1 ms dla grafów misji', WYDAJNOSC, () => {
  const runHr = (A) => {
    const S = SG.createStructure(A, { id: 1 });
    let sum = 0, max = 0, n = 0;
    for (let s = 0; s < 20 * 120; s++) {
      if (s % 30 === 0) { const y = ((s / 30) % 5 - 2) * 80; SG.structureDamageSphere(S, 190, y, 0, 60, 0.05); SG.structureHit(S, 190, y, 0, 1500, -1, 0, 0); }
      const t0 = performance.now(); SG.stepStructure(S, 1 / 120, s); const d = performance.now() - t0;
      sum += d; n++; if (d > max) max = d;
    }
    return { mean: sum / n, max };
  };
  const runDisc = () => {
    const S = SG.createStructure(DISC, { id: 3 });
    let sum = 0, max = 0, n = 0;
    for (let s = 0; s < 10 * 120; s++) {
      if (s % 8 === 0) { const a = s * 0.01; const b = SG.structureNearestBlock(S, 1400 * Math.cos(a), 1400 * Math.sin(a), -880); if (b >= 0) SG.structureAddImpulse(S, b, 0, 0, -2e5 / 120); }
      const t0 = performance.now(); SG.stepStructure(S, 1 / 120, s); const d = performance.now() - t0;
      sum += d; n++; if (d > max) max = d;
    }
    return { mean: sum / n, max };
  };
  // ciężkie losowe uszkodzenia (mechanizmy, serie niezbieżnych przebiegów) i zawalenie (kondygnacja 15 → front)
  const runHeavy = (seed) => {
    const S = SG.createStructure(HR, { id: 1 }), rnd = SG.structureRng(seed);
    let sum = 0, max = 0, n = 0;
    for (let s = 0; s < 20 * 120; s++) {
      if (s % 6 === 0) SG.structureDamageBond(S, (rnd() * HR.e) | 0, 0.5 + rnd());
      const t0 = performance.now(); SG.stepStructure(S, 1 / 120, s); const d = performance.now() - t0;
      sum += d; n++; if (d > max) max = d;
    }
    return { mean: sum / n, max };
  };
  const runCollapse = () => {
    const S = SG.createStructure(HR, { id: 2 });
    let max = 0;
    for (let s = 0; s < 12 * 120; s++) {
      if (s % 30 === 0 && s < 480) for (let j = HR.storeyStart[15]; j < HR.storeyStart[16]; j++) SG.structureDamageBond(S, HR.storeyBonds[j], 0.12);
      const t0 = performance.now();
      SG.stepStructure(S, 1 / 120, s);
      for (let j = 0; j < S.evCount; j++) { const o = j * W; if (S.ev[o] === EV.ISLAND && S.ev[o + 15] === 1 && !S.front.active) SG.structureStartFront(S, S.ev[o + 2], 0, null); }
      const d = performance.now() - t0; if (d > max) max = d;
    }
    return { max };
  };
  const W2 = SG.buildHighriseArchetype({ seed: 6 });
  runHr(HR); runDisc(); runHeavy(4); runCollapse();   // rozgrzewka JIT
  const a = runHr(HR), b = runHr(W2), c = runDisc(), h = [4, 12].map(runHeavy), k = runCollapse();
  assert.ok(a.mean <= 0.1 && b.mean <= 0.1, `wieżowiec średnio ${a.mean.toFixed(4)} / ${b.mean.toFixed(4)} ms`);
  assert.ok(a.max <= 1 && b.max <= 1, `wieżowiec najgorszy krok ${a.max.toFixed(3)} / ${b.max.toFixed(3)} ms`);
  assert.ok(c.max <= 1, `dysk najgorszy krok ${c.max.toFixed(3)} ms (średnio ${c.mean.toFixed(3)})`);
  for (const r of h) assert.ok(r.mean <= 0.1 && r.max <= 1, `ciężkie uszkodzenia: średnio ${r.mean.toFixed(4)}, najgorszy ${r.max.toFixed(3)} ms`);
  assert.ok(k.max <= 1, `zawalenie z frontem: najgorszy krok ${k.max.toFixed(3)} ms`);
});
