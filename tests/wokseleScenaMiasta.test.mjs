// Sceny miasta dema wiązanych wokseli (dema/woksele-zawalenia/scenaMiasta.js, plan LOD § 5). Budowa przy dx = 20 trwa ułamek sekundy, bez GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dzielnica, planM1, planM2, planStanieMiasta, POJEMNOSC_MIASTA } from '../dema/woksele-zawalenia/scenaMiasta.js';
import { zbudujPlan, STRONA, ND } from '../dema/woksele-zawalenia/budowa.js';

test('dzielnica: każdy węzeł ma wiązania i należy do jednego budynku, między budynkami nie ma wiązań', () => {
  const plan = planStanieMiasta({ dx: 20 });
  const { w } = zbudujPlan(plan, {});
  const B = plan.scena.meta.budynki;
  assert.equal(B.length, 480);
  const nrB = new Int32Array(w.n).fill(-1);
  B.forEach((b, q) => { for (let i = b.start; i < b.start + b.n; i++) { assert.equal(nrB[i], -1); nrB[i] = q; } });
  for (let i = 0; i < w.n; i++) {
    assert.ok(nrB[i] >= 0, 'węzeł bez budynku');
    assert.notEqual(w.maska[i], 0, `węzeł ${i} bez wiązań`);
  }
  for (let e = 0; e < w.mW; e++) assert.equal(nrB[w.wa[e]], nrB[w.wb[e]], 'wiązanie między budynkami');
});

test('dzielnica: siatka ijk mieści się w 10 bitach, pary z różnych budynków nie są sąsiadami w ijk, kotwice tylko w k = 0', () => {
  const sc = dzielnica({ dx: 5 });
  const B = sc.meta.budynki;
  for (let i = 0; i < 3 * sc.n; i++) { assert.ok(sc.ijk[i] >= 0 && sc.ijk[i] < 1024); }
  // Pudła ijk budynków rozłączne o co najmniej 2 komórki w x albo y.
  const pudla = B.map((b) => {
    let a0 = 1e9, a1 = -1, c0 = 1e9, c1 = -1;
    for (let i = b.start; i < b.start + b.n; i++) { a0 = Math.min(a0, sc.ijk[3 * i]); a1 = Math.max(a1, sc.ijk[3 * i]); c0 = Math.min(c0, sc.ijk[3 * i + 1]); c1 = Math.max(c1, sc.ijk[3 * i + 1]); }
    return [a0, a1, c0, c1];
  });
  for (let p = 0; p < B.length; p++) for (let q = p + 1; q < B.length; q++) {
    const dx = Math.max(pudla[q][0] - pudla[p][1], pudla[p][0] - pudla[q][1]);
    const dy = Math.max(pudla[q][2] - pudla[p][3], pudla[p][2] - pudla[q][3]);
    assert.ok(dx >= 2 || dy >= 2, `budynki ${p} i ${q} za blisko w ijk`);
  }
});

test('pojemność z POJEMNOSC_MIASTA mieści dzielnicę przy każdym dx, a nKom to potęga dwójki', () => {
  for (const dx of Object.keys(POJEMNOSC_MIASTA).map(Number)) {
    const p = POJEMNOSC_MIASTA[dx];
    assert.equal(p.nKom & (p.nKom - 1), 0);
    assert.ok(dzielnica({ dx }).n <= p.maxWez, `dx = ${dx}`);
  }
});

test('statyka po budynku: wiązania przy podłodze niosą ciężar, F0 = f0 przy g = gProj', () => {
  const plan = planStanieMiasta({ dx: 20 });
  const { w } = zbudujPlan(plan, {});
  assert.ok(w.info.grupy.wieza.statyk < plan.scena.meta.budynki.length, 'pamięć po kluczu nie działa');
  assert.ok(w.info.grupy.wieza.residuum < 1e-6);
  let niosa = 0;
  for (let i = 0; i < w.n; i++) {
    if (!w.nieruchomy[i]) continue;
    assert.equal(plan.scena.ijk[3 * i + 2], 0);
    for (let d = 0; d < ND; d++) if (w.nbr[STRONA * i + d] >= 0 && w.F0[STRONA * i + d] !== 0) niosa++;
  }
  assert.ok(niosa > 0);
  for (let q = 0; q < w.n * STRONA; q += 97) assert.equal(w.F0[q], w.f0[q]);
});

test('plany: M1 około 120 trafień w 6–8 s od t = 1, M2 każdy budynek w 3 s, kratery po czasie, nosiciel w trafionym budynku', () => {
  for (const [plan, ileT] of [[planM1({ dx: 20 }), 120], [planM2({ dx: 20 }), 480]]) {
    const K = plan.gpu.kratery;
    for (let q = 1; q < K.length; q++) assert.ok(K[q].f >= K[q - 1].f);
    assert.equal(K.filter((k) => k.rodz !== 'dach').length, ileT);
    assert.ok(K[0].f >= 60, 'stoi co najmniej sekundę');
    const nrB = new Int32Array(plan.scena.n);
    plan.scena.meta.budynki.forEach((b, q) => { for (let i = b.start; i < b.start + b.n; i++) nrB[i] = q; });
    for (const k of K) assert.equal(plan.miasto.trafione[nrB[k.nos]], 1);
  }
  const T1 = planM1({ dx: 20 }).gpu.kratery.at(-1).f / 60, T2 = planM2({ dx: 20 }).gpu.kratery.at(-1).f / 60;
  assert.ok(T1 >= 6 && T1 <= 8.5, `M1 kończy przy t = ${T1}`);
  assert.ok(T2 <= 4.05, `M2 kończy przy t = ${T2}`);
});
