// Scena B1 „Baza piratów” dema wiązanych wokseli (src/3d/woksele/scenaBazy.js, plan LOD § 5c). Bez GPU. Wypisuje tabelę węzłów na część i na dx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenaB1, POJEMNOSC_BAZY } from '../src/3d/woksele/scenaBazy.js';
import { zbudujPlan, STRONA, ND } from '../src/3d/woksele/budowa.js';
import { KIND } from '../src/3d/woksele/scena.js';
import { createPirateBaseLayout } from '../src/3d/portBuildings/pirateBaseLayout.js';
import { createGrupyGry } from '../src/3d/woksele/grupyGry.js';

const L0 = createPirateBaseLayout({ id: 'B1' });

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
  for (const n of ['AG-1', 'AG-2', 'B-01', 'B-12', 'B-13', 'B-24', 'H-C + H-T', 'trzon', 'dysk D-1…8', 'Y-A', 'Y-B', 'N-P', 'F-P', 'D-G', 'M-P', 'P-S', 'P-P', 'P-1', 'P-2', 'P-3', 'P-M', 'M-1']) assert.ok(nazwy.includes(n), `brak części ${n}`);
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

test('miasto: 24 wieżowce jako osobne części na siatce układu; bezMiasta zostawia samą wieżę; szyjaR zmienia promień trzonu', () => {
  const nazwy = (p) => p.miasto.budynki.map((b) => b.nazwa);
  const gra = plany[80];
  assert.equal(nazwy(gra).filter((n) => /^B-\d\d$/.test(n)).length, 24);
  const bez = scenaB1({ dx: 80, bezMiasta: true });
  assert.equal(nazwy(bez).filter((n) => /^B-/.test(n)).length, 0);
  assert.equal(bez.miasto.bezMiasta, true);
  assert.equal(gra.miasto.bezMiasta, false);
  // Wieżowiec przy dx = 40 leży dokładnie w rzucie z układu (boki na ścianach komórek): skóra z wypieku starej bryły trafia w dachy.
  const p40 = plany[40], pos = p40.scena.pos;
  for (const h of L0.habitat.buildings) {
    const c = p40.miasto.budynki.find((b) => b.nazwa === h.id);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = c.start; i < c.start + c.n; i++) { x0 = Math.min(x0, pos[3 * i]); x1 = Math.max(x1, pos[3 * i]); y0 = Math.min(y0, pos[3 * i + 1]); y1 = Math.max(y1, pos[3 * i + 1]); z1 = Math.max(z1, pos[3 * i + 2]); }
    const hx = (h.ux ? h.w : h.d) / 2, hy = (h.ux ? h.d : h.w) / 2;
    assert.deepEqual([x0 - 20, x1 + 20, y0 - 20, y1 + 20], [h.x - hx, h.x + hx, -h.z - hy, -h.z + hy], `${h.id}: rzut`);
    assert.ok(z1 > 150, `${h.id}: sięga nad płaszczyznę gry`);
  }
  // Trzon wieży: węzły w połowie wysokości wieży, najdalszy od osi.
  const promienSzyi = (p) => {
    const c = p.miasto.budynki.find((b) => b.nazwa === 'H-C + H-T'), q = p.scena.pos;
    let z0 = Infinity, zG = -Infinity, rMax = 0;
    for (let i = c.start; i < c.start + c.n; i++) { z0 = Math.min(z0, q[3 * i + 2]); zG = Math.max(zG, q[3 * i + 2]); }
    const zM = 0.5 * (z0 + zG);
    for (let i = c.start; i < c.start + c.n; i++) if (Math.abs(q[3 * i + 2] - zM) < 200) rMax = Math.max(rMax, Math.hypot(q[3 * i], q[3 * i + 1]));
    return rMax;
  };
  const gruba = scenaB1({ dx: 80, szyjaR: 320 });
  assert.ok(promienSzyi(gruba) > promienSzyi(gra) + 40, `trzon: ${promienSzyi(gruba)} wobec ${promienSzyi(gra)}`);
  assert.equal(gruba.kola[0], 320);
  assert.equal(gra.kola[0], L0.habitat.neckR);
  assert.ok(gra.kola.length <= 12, 'obraz mieści najwyżej 12 kół');
});

test('wnętrze szyi i szybu (szyjaWnetrze): 0 pusta rura, 1 stropy, 2 pełne — więcej węzłów tylko w wieży', () => {
  const ile = (w) => { const p = scenaB1({ dx: 80, bezMiasta: true, szyjaWnetrze: w }); return [p.scena.n, p.miasto.budynki.find((b) => b.nazwa === 'H-C + H-T').n]; };
  const [n0, w0] = ile(0), [n1, w1] = ile(1), [n2, w2] = ile(2);
  assert.equal(n1 - n0, w1 - w0);
  assert.equal(n2 - n0, w2 - w0);
  assert.ok(w0 < w1 && w1 < w2, `${w0} / ${w1} / ${w2}`);
  // Gra od 2026-11-11: wieża ze stropami (1).
  assert.equal(scenaB1({ dx: 80 }).scena.n, scenaB1({ dx: 80, szyjaWnetrze: 1 }).scena.n);
});

test('kratery misji (grupyGry): ćwiartka miasta składa swoje wieżowce, zgniot pod wieżą puszcza ich części bez kraterów, reaktor pęka jak budynek', () => {
  const plan = plany[80];
  const grupy = createGrupyGry({ w: plan.scena, l: L0, dx: 80 });
  const nazwy = new Set(plan.miasto.budynki.map((b) => b.nazwa));
  const czesc = (i) => plan.miasto.budynki.find((b) => i >= b.start && i < b.start + b.n)?.nazwa;
  // ćwiartka z puli: kratery w jej sześciu wieżowcach (nosiciel = węzeł wieżowca tej ćwiartki), rozłożone w czasie
  const lista = grupy.kawalek('H-S');
  assert.ok(lista.length >= 36, `kraterów ${lista.length}`);
  const moje = new Set(L0.habitat.buildings.filter((b) => b.chunk === 'H-S').map((b) => b.id));
  const trafione = new Set();
  for (const k of lista) { const n = czesc(k.nos); assert.ok(moje.has(n), `krater w ${n}`); trafione.add(n); }
  assert.equal(trafione.size, 6, 'każdy wieżowiec ćwiartki dostaje kratery');
  assert.ok(Math.max(...lista.map((k) => k.f)) - Math.min(...lista.map((k) => k.f)) > 60, 'wieżowce padają po kolei, nie w jednej klatce');
  // zgniot pod wieżą: bez kraterów, za to lista części do puszczenia kotwic (istnieją w wypieku)
  assert.deepEqual(grupy.kawalek('H-S', true), []);
  const pusc = grupy.czesciZgniotu('H-S');
  assert.equal(pusc.length, 6);
  for (const n of pusc) assert.ok(nazwy.has(n) && moje.has(n), n);
  assert.deepEqual(grupy.czesciZgniotu('H-C'), []);
  assert.deepEqual(grupy.czesciZgniotu('AG-1'), []);
  // reaktor: kratery w jego części; podstawę i wieżę prowadzi zerwanie (voxNeck), nie pęknięcie kawałka
  const r = grupy.kawalek('AG-2');
  assert.ok(r.length >= 10);
  for (const k of r) assert.equal(czesc(k.nos), 'AG-2');
  assert.deepEqual(grupy.kawalek('H-C'), []);
  assert.ok(grupy.kawalek('D-3').length > 0, 'sektor dysku pod wieżą ma kratery');
  assert.equal(grupy.szyjaR, L0.habitat.neckR);
});
