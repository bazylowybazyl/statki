// Scena B1 „Baza piratów” dema wiązanych wokseli (src/3d/woksele/scenaBazy.js, plan LOD § 5c). Bez GPU. Wypisuje tabelę węzłów na część i na dx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenaB1, POJEMNOSC_BAZY } from '../src/3d/woksele/scenaBazy.js';
import { zbudujPlan, STRONA, ND } from '../src/3d/woksele/budowa.js';
import { KIND } from '../src/3d/woksele/scena.js';
import { createPirateBaseLayout } from '../src/3d/portBuildings/pirateBaseLayout.js';
import { createGrupyGry, PRZEWROT_OM } from '../src/3d/woksele/grupyGry.js';
import { k7HeightToZ } from '../src/3d/haloRing/haloPortK7Layout.js';

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
    // podstawa tuż nad tarasem dysku, 300–450 j. pod płaszczyzną gry: cięcie w płaszczyźnie zostawia niski kikut
    let z0 = Infinity;
    for (let i = c.start; i < c.start + c.n; i++) z0 = Math.min(z0, pos[3 * i + 2]);
    assert.ok(z0 - 20 > -460 && z0 - 20 < -250, `${h.id}: spód ${z0 - 20}`);
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

test('kratery misji (grupyGry): wieżowiec miasta pęka sam (salwy tylko w jego części, przewrót bez kul przekroju), zgniot pod wieżą puszcza jego część bez kraterów, reaktor pęka jak budynek', () => {
  const plan = plany[80];
  const grupy = createGrupyGry({ w: plan.scena, l: L0, dx: 80 });
  const nazwy = new Set(plan.miasto.budynki.map((b) => b.nazwa));
  const czesc = (i) => plan.miasto.budynki.find((b) => i >= b.start && i < b.start + b.n)?.nazwa;
  for (const id of ['B-03', 'B-16']) {
    // kawałek gry = wieżowiec = część wokseli o tym samym id: krótkie salwy po obwodzie (ozdoba), upada przez przewrot (wGrze), bez kul przekroju (raport FABLE-3)
    const lista = grupy.kawalek(id);
    assert.ok(lista.length >= 6, `${id}: kraterów ${lista.length}`);
    for (const k of lista) assert.equal(czesc(k.nos), id, `${id}: krater w ${czesc(k.nos)}`);
    assert.ok(!lista.some((k) => k.rodz === 'wieza'), `${id}: bez kul przekroju`);
    assert.ok(grupy.przewrot(id, { x: 0, y: -1 }), `${id}: przewrót`);
    // zgniot pod wieżą: bez kraterów, sama część do puszczenia kotwic
    assert.deepEqual(grupy.kawalek(id, true), []);
    assert.deepEqual(grupy.czesciZgniotu(id), [id]);
    assert.ok(nazwy.has(id));
  }
  assert.deepEqual(grupy.czesciZgniotu('H-C'), []);
  assert.deepEqual(grupy.czesciZgniotu('AG-1'), []);
  assert.deepEqual(grupy.kawalek('H-S'), [], 'dzielnica nie jest kawałkiem');
  // reaktor: kratery w jego części; podstawę i wieżę prowadzi zerwanie (voxNeck), nie pęknięcie kawałka
  const r = grupy.kawalek('AG-2');
  assert.ok(r.length >= 10);
  for (const k of r) assert.equal(czesc(k.nos), 'AG-2');
  assert.deepEqual(grupy.kawalek('H-C'), []);
  assert.ok(grupy.kawalek('D-3').length > 0, 'sektor dysku pod wieżą ma kratery');
  assert.equal(grupy.szyjaR, L0.habitat.neckR);
});

test('przewrót wieżowca (FABLE-3): cięcie dwie warstwy nad podstawą, oś na krawędzi rzutu po stronie upadku, dach leci w stronę upadku; salwy krótkie, przy taranie krótsze', () => {
  const plan = plany[80];
  const grupy = createGrupyGry({ w: plan.scena, l: L0, dx: 80 });
  const h = L0.habitat.buildings.find((q) => q.id === 'B-16');
  const wx = h.ux ? h.w : h.d, wy = h.ux ? h.d : h.w;
  const cx = h.x, cy = -h.z;
  for (const f of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }]) {
    const p = grupy.przewrot('B-16', f);
    assert.ok(Math.abs(p.zMin - (k7HeightToZ(h.baseY) + 2 * 80)) < 1e-9, 'cięcie dwie warstwy nad podstawą, nie od pokładu pomostu');
    // oś na krawędzi prostokąta rzutu w kierunku f
    const ex = Math.abs(p.piv[0] - cx) / (0.5 * wx), ey = Math.abs(p.piv[1] - cy) / (0.5 * wy);
    assert.ok(Math.abs(Math.max(ex, ey) - 1) < 1e-9, `oś na krawędzi rzutu (${ex}, ${ey})`);
    assert.ok((p.piv[0] - cx) * f.x + (p.piv[1] - cy) * f.y > 0, 'oś po stronie upadku');
    // prędkość startowa dachu (om × (dach − oś)) w poziomie zgodna z f
    const r = [cx - p.piv[0], cy - p.piv[1], 1000];
    const v = [p.om[1] * r[2] - p.om[2] * r[1], p.om[2] * r[0] - p.om[0] * r[2], p.om[0] * r[1] - p.om[1] * r[0]];
    assert.ok(v[0] * f.x + v[1] * f.y > 0, 'dach leci w stronę upadku');
    assert.ok(Math.abs(Math.hypot(...p.om) - PRZEWROT_OM) < 1e-9);
  }
  assert.equal(grupy.przewrot('AG-1', { x: 1, y: 0 }), null, 'reaktor nie jest wieżowcem miasta');
  // bez kierunku z gry: na zewnątrz od osi habitatu
  const n = grupy.naZewnatrz('B-16');
  assert.ok(n.x * cx + n.y * cy > 0 && Math.abs(Math.hypot(n.x, n.y) - 1) < 1e-9);
  const zwykle = grupy.kawalek('B-16'), szybko = grupy.kawalek('B-16', 2);
  assert.ok(Math.max(...zwykle.map((k) => k.f)) <= 36, 'ostrzał: salwy w 0,6 s');
  assert.ok(Math.max(...szybko.map((k) => k.f)) <= 21, 'taran: salwy w 0,35 s');
  assert.deepEqual(grupy.kawalek('B-16', 1), [], 'zgniot dalej bez kraterów');
});

test('reaktory: pierścień pola wisi na ramionach z wiązaniami osiowymi także przy środku na siatce (AG-1)', async () => {
  // Zgłoszenie 2026-11-12 (demo B1R, --scenariusz stoi): przy ramieniu |ax − ay| < 0,75 dx środek AG-1 na siatce (x = −3440) dawał łańcuch pojedynczych
  // komórek połączonych tylko wiązaniami ukośnymi, a pierścień (≈110 węzłów) odpadał sam w pierwszej sekundzie. AG-2 leży poza siatką i stał.
  const { k7HeightToZ } = await import('../src/3d/haloRing/haloPortK7Layout.js');
  const plan = scenaB1({ dx: 40, mocSzyi: 3, giecieSzyi: 1, szyjaWnetrze: 1, stoi: true });
  const { w } = zbudujPlan(plan);
  for (const a of L0.antigravs) {
    const c = plan.miasto.budynki.find((b) => b.nazwa === a.id);
    const cx = a.x, cy = -a.z, zR = k7HeightToZ(a.ringY);
    const pas = (i) => Math.abs(w.pos[3 * i + 2] - zR) <= 40;
    const r = (i) => Math.hypot(w.pos[3 * i] - cx, w.pos[3 * i + 1] - cy);
    const odw = new Set(), stos = [];
    for (let i = c.start; i < c.start + c.n; i++) if (pas(i) && r(i) <= 0.62 * a.coreR + 1) { odw.add(i); stos.push(i); }
    while (stos.length) {
      const i = stos.pop();
      for (let d = 0; d < 6; d++) { const j = w.nbr[STRONA * i + d]; if (j >= c.start && j < c.start + c.n && pas(j) && !odw.has(j)) { odw.add(j); stos.push(j); } }
    }
    let pier = 0, osiagniety = 0;
    for (let i = c.start; i < c.start + c.n; i++) if (pas(i) && Math.abs(r(i) - a.ringR) <= 30) { pier++; if (odw.has(i)) osiagniety++; }
    assert.ok(pier > 50, `${a.id}: pierścień ${pier} węzłów`);
    assert.equal(osiagniety, pier, `${a.id}: ${pier - osiagniety} węzłów pierścienia bez drogi wiązaniami osiowymi do kolumny`);
  }
});

test('limit oderwania (capEtyk): bez wysp pokładu w obudowach reaktorów, sieroty bez kotwicy nie podbijają limitu (gra i demo B1R)', () => {
  // Raport FABLE-3 (2026-11-12): pokład pomostu wewnątrz obudów AG-1 i AG-2 był wyspą bez drogi do kotwicy (106 węzłów, etykieta 60000), limit wychodził
  // 90008 zamiast ~100 i bryła odcięta kraterami była przez 375 s „połączona z kotwicami”: w grze opadała w tłumieniu 40 j./s (dach nad statkiem).
  for (const [nazwa, o] of [['gra', { dx: 40, wGrze: true }], ['B1R', { dx: 40, mocSzyi: 3, giecieSzyi: 1, szyjaWnetrze: 1, stoi: true }]]) {
    const { w } = zbudujPlan(scenaB1(o));
    assert.ok(w.capEtyk > 0 && w.capEtyk < 400, `${nazwa}: capEtyk ${w.capEtyk}`);
    assert.equal(w.info.grupy.wieza.sieroty, 0, `${nazwa}: węzły wieży bez drogi do kotwicy`);
    assert.equal(w.info.grupy.dysk.sieroty, 0, `${nazwa}: węzły dysku bez drogi do kotwicy`);
  }
});

test('upadek bazy (czesciUpadku): środek puszcza pierwszy, boki spoza miasta ciągnięte ku osi — wewnętrzny koniec w dół szybciej, reaktor jedzie z pomostem', () => {
  // Prośba użytkownika 2026-11-12: środkowy habitat ma pociągnąć za sobą lewą i prawą stronę (zwinąć je do środka), a one mają lecieć w dół za centrum.
  const plan = plany[80];
  const w = plan.scena;
  const grupy = createGrupyGry({ w, l: L0, dx: 80 });
  const cz = grupy.czesciUpadku(plan.miasto.budynki);
  assert.equal(cz.length, plan.miasto.budynki.length);
  for (let k = 1; k < cz.length; k++) assert.ok(cz[k].t >= cz[k - 1].t, 'posortowane po czasie');
  const po = (n) => cz.find((c) => c.nazwa === n);
  for (const n of ['H-C + H-T', 'trzon', 'dysk D-1…8', 'B-01', 'B-16']) assert.ok(!po(n).om, `${n}: środek bez obrotu`);
  const tSrodka = Math.max(...['H-C + H-T', 'trzon', 'dysk D-1…8'].map((n) => po(n).t));
  const v = (c, x, y, z) => { const p = [x - c.piv[0], y - c.piv[1], z - c.piv[2]], o = c.om; return [o[1] * p[2] - o[2] * p[1], o[2] * p[0] - o[0] * p[2], o[0] * p[1] - o[1] * p[0]]; };
  for (const n of ['N-P', 'F-P', 'AG-1', 'P-2']) {
    const c = po(n);
    assert.ok(c.om && c.piv, `${n}: bok z obrotem`);
    assert.ok(c.t > tSrodka, `${n}: puszcza po środku`);
    let iMin = c.od, iMax = c.od, rMin = 1e9, rMax = 0;
    for (let i = c.od; i < c.od + c.n; i++) { const r = Math.hypot(w.pos[3 * i], w.pos[3 * i + 1]); if (r < rMin) { rMin = r; iMin = i; } if (r > rMax) { rMax = r; iMax = i; } }
    const vi = v(c, w.pos[3 * iMin], w.pos[3 * iMin + 1], w.pos[3 * iMin + 2]), vo = v(c, w.pos[3 * iMax], w.pos[3 * iMax + 1], w.pos[3 * iMax + 2]);
    assert.ok(vi[2] < vo[2] && vo[2] <= 1e-6, `${n}: wewnętrzny koniec w dół szybciej (${vi[2].toFixed(0)} wobec ${vo[2].toFixed(0)})`);
    const ku = -(vi[0] * w.pos[3 * iMin] + vi[1] * w.pos[3 * iMin + 1]) / rMin;
    assert.ok(ku > 50, `${n}: ku osi ${ku.toFixed(0)} j./s`);
  }
  // Reaktor stoi na pomoście: to samo pole prędkości w tym samym punkcie (wspólna wysokość osi obrotu).
  const ag = po('AG-1'), np = po('N-P');
  const [x, y] = [L0.antigravs[0].x, -L0.antigravs[0].z];
  const a = v(ag, x, y, 0), b = v(np, x, y, 0);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1, 'AG-1 jedzie razem z N-P');
  // bez ciągnięcia (zwin: null) jak dawniej: same czasy fali
  assert.ok(grupy.czesciUpadku(plan.miasto.budynki, { zwin: null }).every((c) => !c.om));
});
