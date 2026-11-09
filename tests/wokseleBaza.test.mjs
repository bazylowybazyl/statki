// Scena B1 „Baza piratów” dema wiązanych wokseli (src/3d/woksele/scenaBazy.js, plan LOD § 5c). Bez GPU. Wypisuje tabelę węzłów na część i na dx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenaB1, POJEMNOSC_BAZY } from '../src/3d/woksele/scenaBazy.js';
import { zbudujPlan, STRONA, ND } from '../src/3d/woksele/budowa.js';
import { KIND } from '../src/3d/woksele/scena.js';

const plany = { 40: scenaB1({ dx: 40 }), 80: scenaB1({ dx: 80 }) };

test('tabela węzłów: najwyżej 150 tys. przy dx = 40, wszystkie części z układu mają węzły, pojemność wystarcza', () => {
  const nazwy = plany[40].czesci.map((c) => c.nazwa);
  const wiersze = nazwy.map((n, q) => `${n.padEnd(14)} ${String(plany[40].czesci[q].n).padStart(7)} ${String(plany[80].czesci[q].n).padStart(7)}`);
  console.log(`część             dx 40   dx 80\n${wiersze.join('\n')}\n${'razem'.padEnd(14)} ${String(plany[40].scena.n).padStart(7)} ${String(plany[80].scena.n).padStart(7)}\nw tym szyb H-C  ${plany[40].wezlySzybu} ${plany[80].wezlySzybu}`);
  for (const dx of [40, 80]) {
    const p = plany[dx];
    for (const c of p.czesci) assert.ok(c.n > 0, `${c.nazwa} bez węzłów przy dx = ${dx}`);
    assert.ok(p.scena.n <= POJEMNOSC_BAZY[dx].maxWez, `dx = ${dx}: ${p.scena.n} węzłów, pojemność ${POJEMNOSC_BAZY[dx].maxWez}`);
    assert.equal(Math.log2(POJEMNOSC_BAZY[dx].nKom) % 1, 0);
  }
  assert.ok(plany[40].scena.n <= 150000);
  for (const n of ['W-1', 'W-2', 'H-C + H-T', 'H-E, S, W, N', 'dysk D-1…8', 'Y-A', 'Y-B', 'N-P', 'F-P', 'D-G', 'M-P', 'P-S', 'P-P', 'P-1', 'P-2', 'P-3', 'P-M', 'M-1']) assert.ok(nazwy.includes(n), `brak części ${n}`);
});

test('budowa przy dx = 80: bez wiązań między częściami, bez wspólnych komórek, siatka ijk w 10 bitach, kotwice w dolnych warstwach i w dysku', () => {
  const plan = plany[80];
  const { w, g } = zbudujPlan(plan, {});
  const sc = plan.scena;
  const nrC = new Int32Array(w.n).fill(-1);
  plan.miasto.budynki.forEach((b, q) => { for (let i = b.start; i < b.start + b.n; i++) { assert.equal(nrC[i], -1); nrC[i] = q; } });
  const zajete = new Set();
  let samotne = 0;
  for (let i = 0; i < w.n; i++) {
    assert.ok(nrC[i] >= 0, 'węzeł bez części');
    const k = `${sc.pos[3 * i]},${sc.pos[3 * i + 1]},${sc.pos[3 * i + 2]}`;
    assert.ok(!zajete.has(k), `dwa węzły w jednej komórce: ${k}`);
    zajete.add(k);
    if (w.maska[i] === 0) samotne++;
  }
  for (let e = 0; e < w.mW; e++) assert.equal(nrC[w.wa[e]], nrC[w.wb[e]], 'wiązanie między częściami');
  for (let i = 0; i < 3 * w.n; i++) assert.ok(sc.ijk[i] >= 0 && sc.ijk[i] < 1024);
  assert.equal(samotne, 0, `węzły bez wiązań: ${samotne}`);
  assert.equal(w.podkrokiEf, 2);
  let kotwic = 0;
  for (let i = 0; i < w.n; i++) kotwic += w.nieruchomy[i];
  assert.ok(kotwic > 0);
  assert.ok(sc.kind.includes(KIND.KOTWICA));
  for (let i = sc.meta.grupy[1].start; i < w.n; i++) if (sc.kind[i] === KIND.KOTWICA) assert.equal(w.nieruchomy[i], 1);
  // Plan: posortowany po klatce, nosiciel to żywy węzeł, kotwice puszczają przed końcem.
  let f = -1;
  for (const k of g.kratery) { assert.ok(k.f >= f); f = k.f; assert.ok(k.nos >= 0 && k.nos < w.n); assert.ok(k.r > 0); }
  assert.ok(g.puscKotwiceF > 0 && g.puscKotwiceF < 60 * plan.T);
});

test('W1 bez zdarzeń: scena stoi na samym układzie, plan pusty', () => {
  const plan = scenaB1({ dx: 80, stoi: true });
  assert.equal(plan.gpu.kratery.length, 0);
  assert.equal(plan.gpu.puscKotwiceF, -1);
});

test('szyja: wzmocniona (gra, mocSzyi 8) to wnętrze ziarna, bez wzmocnienia (demo B1R) zostaje przy klasach z wypieku', () => {
  // Druga opinia 2026-11-08: klasa + 6 w rdzeniu szyi szła też przy mocSzyi 1, więc szyja B1R nie pękała po granicach ziaren i fala jej nie łamała.
  const { w: wG } = zbudujPlan(plany[80], {});
  const { w: wD } = zbudujPlan(scenaB1({ dx: 80, mocSzyi: 1, giecieSzyi: 1 }), {});
  assert.equal(wD.n, wG.n);
  let inne = 0;
  for (let q = 0; q < STRONA * wG.n; q++) {
    if (wG.klasaW[q] === wD.klasaW[q]) continue;
    assert.ok(wD.klasaW[q] < 6 && wG.klasaW[q] === wD.klasaW[q] + 6, `wiązanie ${q}: ${wG.klasaW[q]} wobec ${wD.klasaW[q]}`);
    inne++;
  }
  assert.ok(inne > 0, 'szyja bez wzmocnienia ma granice ziaren');
});

test('demo B1R: bez bębna i z grubszą szyją (prośba 2026-11-09), opcje domyślne (gra) z bębnem i szyją z układu', () => {
  const nazwy = (p) => p.miasto.budynki.map((b) => b.nazwa);
  const demo = scenaB1({ dx: 80, bezBebna: true, szyjaR: 200 });
  assert.ok(nazwy(plany[80]).includes('H-E, S, W, N'));
  assert.ok(!nazwy(demo).includes('H-E, S, W, N'));
  // Szyja: węzły wieży w połowie jej wysokości (między szybem a talerzem), najdalszy od osi.
  const promienSzyi = (p) => {
    const c = p.miasto.budynki.find((b) => b.nazwa === 'H-C + H-T'), pos = p.scena.pos;
    let z0 = Infinity, z1 = -Infinity, rMax = 0;
    for (let i = c.start; i < c.start + c.n; i++) { z0 = Math.min(z0, pos[3 * i + 2]); z1 = Math.max(z1, pos[3 * i + 2]); }
    const zM = 0.5 * (z0 + z1);
    for (let i = c.start; i < c.start + c.n; i++) if (Math.abs(pos[3 * i + 2] - zM) < 200) rMax = Math.max(rMax, Math.hypot(pos[3 * i], pos[3 * i + 1]));
    return rMax;
  };
  assert.ok(promienSzyi(demo) > promienSzyi(plany[80]) + 40, `szyja: ${promienSzyi(demo)} wobec ${promienSzyi(plany[80])}`);
  assert.equal(demo.kola[0], 200);
  assert.equal(plany[80].kola[0], 150);
  // Bez bębna trzon ma pokrywę i dno (szyb nie wisi nad pustą rurą), z bębnem jak dotąd.
  const trzon = (p) => p.miasto.budynki.find((b) => b.nazwa === 'trzon').n;
  assert.ok(trzon(demo) > 1.5 * trzon(plany[80]), `trzon: ${trzon(demo)} wobec ${trzon(plany[80])}`);
});

test('wnętrze szyi i szybu (szyjaWnetrze): 0 jak dotąd, 1 stropy, 2 pełne — więcej węzłów tylko w wieży', () => {
  const ile = (w) => { const p = scenaB1({ dx: 80, bezBebna: true, szyjaR: 200, szyjaWnetrze: w }); return [p.scena.n, p.miasto.budynki.find((b) => b.nazwa === 'H-C + H-T').n]; };
  const [n0, w0] = ile(0), [n1, w1] = ile(1), [n2, w2] = ile(2);
  assert.equal(n1 - n0, w1 - w0);
  assert.equal(n2 - n0, w2 - w0);
  assert.ok(w0 < w1 && w1 < w2, `${w0} / ${w1} / ${w2}`);
  assert.equal(scenaB1({ dx: 80 }).scena.n, scenaB1({ dx: 80, szyjaWnetrze: 0 }).scena.n);
});
