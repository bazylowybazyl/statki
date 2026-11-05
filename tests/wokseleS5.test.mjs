// Scena S5 (docs/SPEC-woksele-zawalenia.md § 5.5): budowa, wypiek szwów i plan eksplozji bajt w bajt z proby5/final/scena5.mjs + proby4/model-spec4.mjs.
// Skróty policzone w Node z prototypu (.tmp/ nie ma w repo, więc stałe). O kawałkach decydują dane budowy w wWiaz, więc inne bajty to inna scena, a nie szum.
// Osobny plik, bo tests/wokseleBudowa.test.mjs rusza przy imporcie wątki z biegami fizyki. Bez pomiaru ściany.
// node --test tests/wokseleS5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { S5 } from '../dema/woksele-zawalenia/scena.js';
import { zbudujPlan } from '../dema/woksele-zawalenia/budowa.js';
import { PLANY_POKAZU } from '../dema/woksele-zawalenia/scenyPokazu.js';

const WZOR = {
  21: {
    capEtyk: 59, fPierwsza: 104, fOstatnia: 363,
    szwy: { wSz: 5222, wCiete: 4761, wWew: 42387, wPod: 4996, wTor: 9924, wMoc: 940 },
    plan: '8bd34292e3b3b0558a212de2',
    pola: { pos: 'a634e7f6044283b4d2657aa4', vel0: 'b40fd980676f4af99b337608', kind: 'ac2bdcd0b799562cb1668610', ijk: '8ffa67dea19e2771e56fa5cf', grupa: 'f0bb46bdd04e241b2a46a88f', nbr: '4d791ddd33cefcecfe6b8bd1', R0: '0fd86c16e829d45cb3b02059', L: '0fd86c16e829d45cb3b02059', F0: '8e8fb6143d9ad39d2522d5dd', Ft: 'c59fc175e3252a0e71a57a6a', Fc: '4ef798ece61142b9025a85a4', klasaW: '8bf235d90d14f7f7953af57a', maska: '158347b9eabc9a02602fbfa5', iN0: '427f69868b353d554c8ab7e2', etyk: '45eb311473052256a099ce7d', nieruchomy: 'a0678402a9e423fcea5c163c', aLos: 'fa889261011dbae07402856e', rozlewW: 'fc8fea944ee46903ec365323', szokW: '1c8bebff611f049f0d4bc0b8', kUd: '486d59c96839b907880fecc1', bMax2W: '0ce98632e57569a201a97267', rk: '1b18db71b5b2223c8e38afdd', bezG: 'f0bb46bdd04e241b2a46a88f', bitPas: '4684a8840b75bdc6b20b18ac' },
  },
  7: {
    capEtyk: 58, fPierwsza: 106, fOstatnia: 419,
    szwy: { wSz: 5300, wCiete: 4491, wWew: 44548, wPod: 4308, wTor: 9795, wMoc: 758 },
    plan: '576bb497f3d2f9252ef95f22',
    pola: { pos: 'a634e7f6044283b4d2657aa4', vel0: 'b40fd980676f4af99b337608', kind: 'eec430eafc0bdda2c70707b9', ijk: '8ffa67dea19e2771e56fa5cf', grupa: 'f0bb46bdd04e241b2a46a88f', nbr: '4d791ddd33cefcecfe6b8bd1', R0: '0fd86c16e829d45cb3b02059', L: '0fd86c16e829d45cb3b02059', F0: '8e8fb6143d9ad39d2522d5dd', Ft: 'da5afe38b34c9cdf480bce2a', Fc: '34298eafbdc87bac82b8df57', klasaW: '0f093dd5b8720d2a4c923fd1', maska: '33affeb328867223658737cd', iN0: '7677a9ca558bf143ebd30ef7', etyk: '62bd32473ec24180dc004876', nieruchomy: '87c909a965ea58aa7ebef255', aLos: '48ded0a116e90233b501f02f', rozlewW: 'ab787f6ee53e7a9c36b795c7', szokW: 'db42a185997ac2ab88ff132f', kUd: 'bbcb554e0e2b538bbe1d9aa9', bMax2W: '550f692c172646d7f9605f7e', rk: '2b36d6963ef3816306e45882', bezG: 'f0bb46bdd04e241b2a46a88f', bitPas: '98f421742674d7fb17db77d8' },
  },
};
const NIERUCHOMY_PROZNIA_21 = '450f3a9a2b135e80f61b1420';
const MAX_WEZLOW = 26000; // § 2.2, createWokseleSolver w glowny.js
const KRATER_N = 4; // solver.js: kraterów na klatkę

const bajty = (t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength);
const skrot = (t) => createHash('sha256').update(bajty(t)).digest('hex').slice(0, 24);
const skrotPlanu = (plan) => createHash('sha256').update(JSON.stringify(plan.map((b) => [b.f, b.nos, b.rodz, +b.r.toFixed(6), +b.rdzen.toFixed(6), +(b.rdzenSam ?? 0).toFixed(6), +b.J.toFixed(6), +b.rP.toFixed(6), +b.tau.toFixed(6), +(b.dz ?? 0).toFixed(6)]))).digest('hex').slice(0, 24);

const pamiecStatyki = new Map();
const budowy = new Map();
function buduj(miejsce, ziarno) {
  const k = `${miejsce}:${ziarno}`;
  if (!budowy.has(k)) {
    const plan = S5({ miejsce, ziarno });
    budowy.set(k, { plan, ...zbudujPlan(plan, { pamiecStatyki }) });
  }
  return budowy.get(k);
}

for (const ziarno of [21, 7]) {
  test(`S5 ziarno ${ziarno}: budowa, szwy i plan bajt w bajt z prototypu`, () => {
    const { plan, w } = buduj('g', ziarno);
    const wz = WZOR[ziarno];
    assert.equal(w.n, 23982);
    assert.equal(plan.dane.nW, 6600);
    assert.equal(plan.dane.nD, 17382);
    assert.equal(w.capEtyk, wz.capEtyk);
    assert.deepEqual(w.szwy, wz.szwy);
    for (const k of Object.keys(wz.pola)) {
      const t = k === 'vel0' ? w.vel0 : w[k];
      assert.equal(skrot(t), wz.pola[k], `pole ${k}`);
    }
    assert.equal(plan.wybuchy.length, 38);
    assert.equal(plan.wybuchy[0].f, wz.fPierwsza);
    assert.equal(plan.wybuchy.at(-1).f, wz.fOstatnia);
    assert.equal(skrotPlanu(plan.wybuchy), wz.plan);
  });
}

test('S5: ta sama budowa w każdym miejscu, różni się tylko grawitacja i kotwice (§ 10.4)', () => {
  const g = buduj('g', 21), v = buduj('proznia', 21), p = buduj('planeta', 21);
  for (const k of ['Ft', 'Fc', 'klasaW', 'maska', 'iN0', 'L', 'F0', 'etyk', 'bitPas', 'flagi']) {
    assert.equal(skrot(v.w[k]), skrot(g.w[k]), `próżnia, pole ${k}`);
    assert.equal(skrot(p.w[k]), skrot(g.w[k]), `planeta, pole ${k}`);
  }
  assert.equal(skrotPlanu(v.plan.wybuchy), skrotPlanu(g.plan.wybuchy));
  assert.equal(skrot(v.w.nieruchomy), NIERUCHOMY_PROZNIA_21);
  assert.equal(v.w.nieruchomy.indexOf(1), -1, 'próżnia: uKotwice = 0');
  assert.ok(g.w.nieruchomy.indexOf(1) >= 0, 'przy g kotwice stoją');
  assert.ok(p.w.nieruchomy.indexOf(1) >= 0, 'planeta: kotwice stoją do ostatniej kuli wspornika');
  assert.equal(v.w.zr.gMod, 0);
  assert.equal(g.w.zr.gMod, 260);
  assert.equal(p.w.zr.punkt.g, 260);
  assert.equal(p.w.zr.punkt.r0, 14000);
  assert.ok(v.w.gruntZ < -1e20, 'próżnia bez gruntu');
  assert.equal(g.w.gruntZ, -2500);
});

test('S5: plan GPU w limitach solvera, kotwice puszczają tylko na planecie, po ostatniej kuli wspornika', () => {
  const { w, g, plan } = buduj('g', 21);
  assert.ok(w.n <= MAX_WEZLOW);
  assert.equal(g.kratery.length, 38);
  assert.equal(g.zerujL, false);
  assert.equal(g.puscKotwiceF, -1);
  assert.equal(g.bitPas, w.bitPas);
  const naKlatke = new Map();
  for (const e of g.kratery) {
    naKlatke.set(e.f, (naKlatke.get(e.f) ?? 0) + 1);
    assert.ok(e.nos >= 0 && e.nos < w.n, 'nosiciel');
    assert.equal(e.usunStojace, true);
    assert.ok(e.rS === 0 || e.rS > e.rdzen, 'strefa S = 2 szersza niż rdzeń');
  }
  assert.ok(Math.max(...naKlatke.values()) <= KRATER_N);
  // Slot pchnięcia wraca po 32 kraterach, a najdłuższy kop to 18 klatek: pierścień nie nadpisuje żywego slotu, gdy 32 kolejne kratery nie mieszczą się w 18 klatkach.
  for (let q = 32; q < g.kratery.length; q++) assert.ok(g.kratery[q].f - g.kratery[q - 32].f >= 18, 'pierścień wBlastK');
  const rodzaje = {};
  for (const b of plan.wybuchy) rodzaje[b.rodz] = (rodzaje[b.rodz] ?? 0) + 1;
  assert.deepEqual(rodzaje, { wspornik: 8, glowna: 9, mala: 18, wieza: 3 });
  // Kula wspornika obejmuje cały łuk kotwicy, inaczej zostaje stojący węzeł i trzyma sekcję. Tu z pozycji startowych, bez ruchu dysku.
  const kotwice = plan.dane.kotwiceWsp;
  const wsp = plan.wybuchy.filter((b) => b.rodz === 'wspornik');
  for (const i of kotwice) {
    const x = w.pos[3 * i], y = w.pos[3 * i + 1], z = w.pos[3 * i + 2];
    assert.ok(wsp.some((b) => (x - b.x) ** 2 + (y - b.y) ** 2 + (z - b.z) ** 2 < b.r * b.r), `węzeł kotwicy ${i} poza kulami wsporników`);
  }
  const p = buduj('planeta', 21);
  const fOst = Math.max(...p.plan.wybuchy.filter((b) => b.rodz === 'wspornik').map((b) => b.f));
  assert.equal(p.g.puscKotwiceF, fOst);
  assert.equal(buduj('proznia', 21).g.puscKotwiceF, -1);
});

test('S5: wątek budowy dostaje wszystko strukturalnie, a plany pokazu podają ziarno', () => {
  const { w, g } = buduj('g', 21);
  // postMessage klonuje: funkcje w wypieku albo w planie GPU wywaliłyby strukturalne klonowanie dopiero na stronie.
  const kopia = structuredClone({ w, g });
  assert.equal(kopia.w.n, w.n);
  assert.equal(kopia.g.kratery[0].rodz, g.kratery[0].rodz);
  for (const id of ['S5', 'S5v', 'S5p']) {
    assert.equal(PLANY_POKAZU[id](7).dane.o.ziarno, 7, id);
    assert.equal(PLANY_POKAZU[id]().dane.o.ziarno, 21, `${id}: domyślne ziarno jak w filmie`);
  }
  assert.equal(PLANY_POKAZU.S5v().dane.prozn, true);
  assert.equal(PLANY_POKAZU.S5p().miejsce, 'planeta');
});

test('moduły S5 bez Math.random i Math.hypot, testS5 bez three', () => {
  const kod = readFileSync(new URL('../dema/woksele-zawalenia/testS5.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  for (const zakazane of [/\bdocument\b/, /from\s+['"]three/, /Math\.random/, /Math\.hypot/]) assert.ok(!zakazane.test(kod), `testS5.js: ${zakazane}`);
});
