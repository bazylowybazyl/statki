// Druga opinia Fable 2026-11-11 (raport w docs/RAPORT-kawalki-zawalen.md, „Druga iteracja Fable”): poprawki w demie wiązanych wokseli.
//  • P1: węzeł zabity w kSpal zostawiał u sąsiadów bity wiązań do siebie: po kSpal idą kCzysc i kCzyscS.
//  • P2 + U3: ciągliwość betonu w wypieku (par.ciagliwosc), tabela mięknięcia na GPU z parametrów WYPIEKU, nie solvera.
//  • P3: fala łamiąca tylko z prędkości w dół (flaga solvera falaPion). Bez flagi WGSL kF jak dotąd (gra).
//  • U5: moment bezwładności Atlasa z obrysu kadłuba.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { zbudujPlan, parametry, zbuduj, PARAMETRY, STRONA, KLASA_NAZWY } from '../src/3d/woksele/budowa.js';
import { S1 } from '../src/3d/woksele/scena.js';
import { createWokseleSolver, STATEK_SDF } from '../src/3d/woksele/solver.js';
import { createSpalanie } from '../src/3d/woksele/spalanie.js';
import { PLANETY_ATM } from '../src/3d/woksele/atmosfera.js';
import { WzorzecCpu } from '../dema/woksele-zawalenia/wzorzec-cpu.js';
import { sredniKwadratPromienia } from '../dema/woksele-zawalenia/atlas.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const kodKF = (s) => { const b = renderer.backend.createNodeBuilder(s.kernele.kF, renderer); b.build(); return b.computeShader; };

const plan = S1();
const { w } = zbudujPlan(plan);

test('falaPion: bez flagi kF bajt w bajt jak dotąd, z flagą fala z rzutu na grawitację stałą; wzorzec CPU nie łamie ruchu w bok', () => {
  const zwykly = kodKF(createWokseleSolver());
  assert.equal(kodKF(createWokseleSolver({ falaPion: false })), zwykly, 'bez flagi WGSL kF jak dotąd (gra)');
  const zFlaga = kodKF(createWokseleSolver({ falaPion: true }));
  assert.notEqual(zFlaga, zwykly);
  assert.match(zFlaga, /uGStala/);
  assert.ok(createWokseleSolver({ falaPion: true }).falaPion);
  assert.equal(createWokseleSolver().falaPion, false);
  // Wzorzec CPU: wolny węzeł uszkodzony ponad próg fali (cel fali = 1) pchnięty 200 j./s w bok i w dół. Fala rośnie (A > 0) przy ruchu w dół zawsze, w bok tylko bez flagi.
  // Po przebiegu wzorzec zamienia bufory: nowe A leży w m.A.
  let i = -1;
  for (let x = 0; x < w.n && i < 0; x++) if (!w.nieruchomy[x] && w.maska[x]) i = x;
  const A = (flaga, v) => {
    const m = new WzorzecCpu(w, flaga ? { ...(w.par ?? PARAMETRY), falaPion: true } : (w.par ?? PARAMETRY));
    for (let c = 0; c < 3; c++) m.vel[3 * i + c] = v[c];
    m.szkoda[i] = 1;
    m._przebudujListe();
    m._przebiegF();
    return m.A[i];
  };
  assert.ok(A(false, [200, 0, 0]) > 0, 'bez flagi szybki ruch w bok uruchamia falę');
  assert.equal(A(true, [200, 0, 0]), 0, 'z flagą ruch w bok fali nie uruchamia');
  assert.ok(A(true, [0, 0, -200]) > 0, 'z flagą ruch w dół dalej łamie');
});

test('ciągliwość: wypiek bez pola jak dotąd, × c wydłuża mięknięcie klas 0–3 (dysk i kotwica bez zmian); tabela GPU bierze klasy i ciągliwość z wypieku', () => {
  const bez = zbuduj(plan.scena, PARAMETRY);
  const jeden = zbuduj(plan.scena, parametry({ ciagliwosc: 1 }));
  const osiem = zbuduj(plan.scena, parametry({ ciagliwosc: 8 }));
  assert.deepEqual(Array.from(jeden.iT), Array.from(bez.iT), 'ciągliwość 1 = dzisiejszy wypiek');
  assert.deepEqual(Array.from(jeden.iC), Array.from(bez.iC));
  let klas03 = 0;
  for (let q = 0; q < STRONA * bez.n; q++) {
    if (bez.nbr[q] < 0 || !bez.iT[q]) continue;
    const kl = bez.klasaW[q] % 6;
    const oczek = kl <= 3 ? bez.iT[q] / 8 : bez.iT[q];
    assert.ok(Math.abs(osiem.iT[q] - oczek) <= 1e-9 * Math.abs(oczek), `iT wiązania ${q} klasy ${kl}`);
    if (kl <= 3) klas03++;
  }
  assert.ok(klas03 > 0);
  // Tabela GPU (wczytaj): rzędy klas z wypieku. Nakładka na dT strop działała dotąd tylko na CPU (U3).
  const s = createWokseleSolver({ maxNodes: Math.max(26000, bez.n) });
  const rzad = (ww, kl) => { s.wczytaj(ww); const t = s.atrybuty.tab.array; return [t[4 * (18 + kl)], t[4 * (18 + kl) + 1]]; };
  const [iT0] = rzad(bez, 0);
  const [iT8] = rzad(osiem, 0);
  assert.ok(Math.abs(iT0 / iT8 - 8) < 1e-5, `strop: tabela GPU × 1/8 przy ciągliwości 8 (${iT0} / ${iT8})`);
  const [iT8dysk] = rzad(osiem, 4);
  const [iT0dysk] = rzad(bez, 4);
  assert.ok(Math.abs(iT8dysk - iT0dysk) <= 1e-6 * iT0dysk, 'dysk bez zmian');
  const nakl = zbuduj(plan.scena, parametry({ klasy: { strop: { dT: PARAMETRY.klasy.strop.dT * 2 } } }));
  const [iTn] = rzad(nakl, 0);
  assert.ok(Math.abs(iT0 / iTn - 2) < 1e-5, 'nakładka sceny na dT dochodzi do tabeli GPU');
  assert.equal(KLASA_NAZWY[0], 'strop');
});

test('spalanie: po kSpal idą kCzysc i kCzyscS solvera (martwy węzeł nie zostaje u sąsiadów)', () => {
  const s = createWokseleSolver({ ciagliwe: true });
  const sp = createSpalanie({ solver: s, planeta: PLANETY_ATM.ziemia });
  const wywolania = [];
  sp.krok({ compute: (k) => wywolania.push(k) });
  const lista = wywolania.find((k) => Array.isArray(k) && k.includes(sp.kernele.kSpal));
  assert.ok(lista, 'kSpal w liście kerneli');
  const iSpal = lista.indexOf(sp.kernele.kSpal);
  assert.equal(lista[iSpal + 1], s.kernele.kCzysc);
  assert.equal(lista[iSpal + 2], s.kernele.kCzyscS);
});

test('Atlas: moment bezwładności z obrysu, nie z prostokąta (prostokąt pola daje (L² + W²) / 12)', () => {
  const W = STATEK_SDF.szer, H = STATEK_SDF.wys, hx = 900, hy = 400;
  const pelne = new Float32Array(W * H).fill(-1);
  const r2 = sredniKwadratPromienia(pelne, hx, hy);
  const oczek = ((2 * hx) ** 2 + (2 * hy) ** 2) / 12;
  assert.ok(Math.abs(r2 / oczek - 1) < 0.01, `prostokąt: ${r2} wobec ${oczek}`);
  // Węższy kadłub (pół szerokości pola) ma mniejszy moment.
  const waski = new Float32Array(W * H).fill(1);
  for (let j = H / 4; j < (3 * H) / 4; j++) for (let i = 0; i < W; i++) waski[j * W + i] = -1;
  assert.ok(sredniKwadratPromienia(waski, hx, hy) < r2);
});
