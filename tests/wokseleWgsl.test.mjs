// WGSL kerneli solvera wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 9, § 2.2), budowany w Node bez GPU (renderer.backend.createNodeBuilder).
// Sam kernel uruchamia dopiero scripts/webgpu/woksele-demo.mjs. Tu tylko to, co widać w kodzie: liczba buforów, dostęp, atomiki, osłona uN, nazwy, upakowanie danych.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createWokseleSolver, slowoSasiada, sasiadZeSlowa, klasaZeSlowa, slowoIjk, KRATER_N, BIT_ZOSTAW } from '../dema/woksele-zawalenia/solver.js';
import { wieza, S1, S3, S4, krater, planGpu } from '../dema/woksele-zawalenia/scena.js';
import { WzorzecCpu } from '../dema/woksele-zawalenia/wzorzec-cpu.js';
import { WzorzecF32 } from '../dema/woksele-zawalenia/wzorzecF32.js';
import { zbuduj, PARAMETRY, STRONA } from '../dema/woksele-zawalenia/budowa.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;

const wgslKernela = (k) => {
  const b = renderer.backend.createNodeBuilder(k, renderer);
  b.build();
  return b.computeShader;
};

const solver = createWokseleSolver();
const WGSL = Object.fromEntries(Object.entries(solver.kernele).map(([nazwa, k]) => [nazwa, wgslKernela(k)]));
const NAZWY = Object.keys(WGSL);

/** Bufory storage kernela: nazwa → dostęp, typ. */
function bufory(wgsl) {
  const out = {};
  for (const m of wgsl.matchAll(/var<storage,\s*(\w+)>\s+(\w+)\s*:\s*([^;]+);/g)) out[m[2]] = { dostep: m[1], typ: m[3] };
  return out;
}

/** Typ elementu bufora ze struktury NodeBuffer (three zawija tablicę w strukturę): czy to atomik. */
function maAtomik(wgsl) {
  return /atomic</.test(wgsl);
}

// Dostęp każdego bufora każdego kernela wg § 2.2: co kernel pisze, a co tylko czyta.
const DOSTEP = {
  kF: { wokWez: 'read_write', wokStan: 'read_write', wokMaska: 'read_write', wokWiaz: 'read_write', wokLista: 'read', wokTab: 'read' },
  kI: { wokWez: 'read_write', wokStan: 'read_write', wokMaska: 'read_write' },
  kWstaw: { wokWez: 'read', wokKomLicz: 'read_write', wokKomSloty: 'read_write' },
  kLista: { wokWez: 'read', wokMaska: 'read', wokLista: 'read_write', wokIjk: 'read', wokKomLicz: 'read', wokKomSloty: 'read', wokTab: 'read' },
  kZerujPo: { wokWez: 'read', wokKomLicz: 'read_write' },
  kCzas: { wokCzasU: 'read_write', wokWez: 'read_write', wokMaska: 'read_write', wokStan: 'read_write' },
  kCzysc: { wokWez: 'read', wokMaska: 'read_write', wokStan: 'read', wokWiaz: 'read' },
  kCzyscS: { wokMaska: 'read_write', wokStan: 'read_write' },
  kZerujCel: { wokLicz: 'read_write' },
  kCel: { wokWez: 'read', wokLicz: 'read_write' },
  kKraterCel: { wokWez: 'read', wokLicz: 'read', wokBlastK: 'read_write', wokBlysk: 'read_write' },
  kKrater: { wokWez: 'read_write', wokStan: 'read_write', wokBlastK: 'read', wokMaska: 'read_write', wokZar: 'read_write' },
  kZerujWybuch: { wokLicz: 'read_write' },
  kWybuchSuma: { wokWez: 'read_write', wokStan: 'read', wokBlastK: 'read', wokLicz: 'read_write' },
  kWybuchMoment: { wokWez: 'read', wokLicz: 'read_write' },
  kWybuch: { wokWez: 'read_write', wokLicz: 'read' },
};

test('kernele P1 i P2: dokładnie te z § 12', () => {
  assert.deepEqual(NAZWY.slice().sort(), Object.keys(DOSTEP).sort());
});

for (const nazwa of Object.keys(DOSTEP)) {
  test(`${nazwa}: najwyżej 8 var<storage, dostęp jak w § 2.2`, () => {
    const b = bufory(WGSL[nazwa]);
    assert.ok(Object.keys(b).length <= 8, `${nazwa}: ${Object.keys(b).length} buforów storage`);
    const dostep = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.dostep]));
    assert.deepEqual(dostep, DOSTEP[nazwa]);
  });

  test(`${nazwa}: bez literału Infinity i NaN`, () => {
    assert.doesNotMatch(WGSL[nazwa], /Infinity/);
    assert.doesNotMatch(WGSL[nazwa], /\bNaN\b/);
  });

  test(`${nazwa}: osłona węzłów poza sceną na początku main`, () => {
    // Grupa robocza 64: compute(n) wysyła ceil(n/64) grup, więc indeks potrafi wyjść poza scenę (§ 2.4).
    const main = WGSL[nazwa].slice(WGSL[nazwa].indexOf('fn main'));
    assert.match(main, /instanceIndex\s*>=\s*\w+[^]{0,120}return;/, 'brak wczesnego wyjścia dla instanceIndex >= uN');
  });

  test(`${nazwa}: grupa robocza 64`, () => {
    assert.match(WGSL[nazwa], /@workgroup_size\(\s*64/);
  });
}

test('atomiki tylko w kWstaw, kCel, kWybuchSuma i kWybuchMoment (§ 2.4)', () => {
  const Z_ATOMIKIEM = new Set(['kWstaw', 'kCel', 'kWybuchSuma', 'kWybuchMoment']);
  for (const nazwa of NAZWY) assert.equal(maAtomik(WGSL[nazwa]), Z_ATOMIKIEM.has(nazwa), `${nazwa}: atomik`);
  assert.match(WGSL.kWstaw, /atomicAdd\(/);
  assert.match(WGSL.kCel, /atomicMin\(/);
  assert.match(WGSL.kWybuchSuma, /atomicAdd\(/);
  assert.match(WGSL.kWybuchSuma, /atomicMax\(/);
  assert.match(WGSL.kWybuchMoment, /atomicLoad\(/);
  for (const nazwa of NAZWY) if (!Z_ATOMIKIEM.has(nazwa)) assert.doesNotMatch(WGSL[nazwa], /atomic(Add|Load|Store|Min|Max)\(/, nazwa);
});

test('kZerujWybuch i kZerujCel piszą licznik zwykłym przypisaniem, nie przez zapis z CPU, a kZerujWybuch omija głowice i cel', () => {
  assert.match(WGSL.kZerujWybuch, /wokLicz\.value\[[^;]+\]\s*=\s*0u\s*;/);
  assert.match(WGSL.kZerujCel, /wokLicz\.value\[[^;]+\]\s*=\s*4294967295u\s*;/);
  assert.match(WGSL.kZerujWybuch, /instanceIndex\s*<\s*3u/);
});

test('kLista czyta licznik komórki bez atomików, kZerujPo pisze go zwykłym przypisaniem', () => {
  assert.equal(bufory(WGSL.kLista).wokKomLicz.dostep, 'read');
  assert.match(WGSL.kZerujPo, /wokKomLicz\.value\[[^;]+\]\s*=\s*0u\s*;/);
});

test('round: stały przecinek tylko w sumach pchnięcia i przez round, bez obcinania; floor tylko przy komórce siatki', () => {
  // § 2.8: |P|/N obcinanie 0,1221 j./s, round 0,0007. Każde i32 z f32 w kWybuchSuma i kWybuchMoment idzie przez round.
  const ROUND = new Set(['kWybuchSuma', 'kWybuchMoment']);
  for (const nazwa of NAZWY) assert.equal(/round\(/.test(WGSL[nazwa]), ROUND.has(nazwa), nazwa);
  // W kWybuchSuma każde i32 to wejście do sumy. W kWybuchMoment i32 czyta też sumy z licznika (u32 → i32), więc tam tylko to, co idzie do atomicAdd.
  for (const m of WGSL.kWybuchSuma.matchAll(/\bi32\(\s*([^()\s]+)/g)) assert.equal(m[1], 'round', `kWybuchSuma: i32 bez round: ${m[0]}`);
  for (const m of WGSL.kWybuchMoment.matchAll(/atomicAdd\([^,]+,\s*u32\(\s*i32\(\s*([^()\s]+)/g)) assert.equal(m[1], 'round', `kWybuchMoment: suma bez round: ${m[0]}`);
  for (const nazwa of ['kWstaw', 'kLista', 'kZerujPo']) assert.match(WGSL[nazwa], /i32\(\s*floor\(/, nazwa);
  for (const nazwa of ['kF', 'kI', 'kCzas', 'kCzysc', 'kCzyscS', 'kCel', 'kKrater', 'kWybuch']) assert.doesNotMatch(WGSL[nazwa], /floor\(/, nazwa);
});

test('tablice uniformów uKrater i uBlast mają stałe nazwy, a uniformów vec4 poza tablicami nie ma (§ 1.7)', () => {
  assert.match(WGSL.kKrater, /var<uniform> uKrater/);
  assert.match(WGSL.kWybuchSuma, /var<uniform> uBlast/);
  for (const nazwa of NAZWY) {
    const obj = WGSL[nazwa].match(/struct objectStruct \{([^}]*)\}/);
    if (obj) assert.doesNotMatch(obj[1], /vec4<f32>/, `${nazwa}: uniform vec4`);
  }
});

test('kF: sąsiad jako bity f32 przez bitcast, nie przez konwersję wartości', () => {
  assert.match(WGSL.kF, /bitcast<u32>/);
  // Konwersja wartości (u32(x)) to tylko flagi: jedno wystąpienie z pola .w drugiego rekordu stałych węzła.
  assert.match(WGSL.kF, /countOneBits\(/);
});

test('nazwy buforów stałe: bez NodeBuffer_<id>, dwa egzemplarze solvera dają ten sam kod', () => {
  const drugi = createWokseleSolver();
  for (const nazwa of NAZWY) {
    assert.doesNotMatch(WGSL[nazwa], /NodeBuffer_\d+\s*>?\s*:/, nazwa);
    assert.equal(wgslKernela(drugi.kernele[nazwa]), WGSL[nazwa], `${nazwa}: inny WGSL przy drugim budowaniu`);
  }
});

/** Pułapki 36 i 39: zmienna czytana przed pierwszym przypisaniem, np. przypisana tylko w jednej gałęzi. Wzór tests/hullCloakTSL.test.mjs. */
function czytanePrzedPrzypisaniem(wgsl) {
  const main = wgsl.slice(wgsl.indexOf('fn main'));
  const bledy = [];
  for (const m of main.matchAll(/var (nodeVar\d+)\s*:/g)) {
    const v = m[1];
    const re = new RegExp(`\\b${v}\\b`, 'g');
    re.lastIndex = m.index + 4 + v.length;
    const u = re.exec(main);
    if (!u) continue;
    if (!new RegExp(`^${v}(\\.[xyzw]+)?\\s*=[^=]`).test(main.slice(u.index, u.index + v.length + 12))) bledy.push(v);
  }
  return bledy;
}

for (const nazwa of Object.keys(DOSTEP)) {
  test(`${nazwa}: każda zmienna przypisana przed pierwszym odczytem`, () => {
    assert.deepEqual(czytanePrzedPrzypisaniem(WGSL[nazwa]), []);
  });
}

test('kF zawiera wszystkie gałęzie § 2.11, kolejność sprawdzeń wiązania jak we wzorcu', () => {
  const k = WGSL.kF;
  const stale = [
    ['fala łamie', 73856093], ['fala łamie, drugi mnożnik', 19349663], ['hash pary', 1540483477],
    ['etykieta bez drogi', 65535],
  ];
  for (const [opis, liczba] of stale) assert.match(k, new RegExp(`\\b${liczba}(u|\\.0)?\\b`), opis);
  // Kolejność w pętli wiązań: wypiek (uCosWyp) przed progiem rozciągania (1,5 R0) i przed ściskaniem (0,45 R0).
  const pWypiek = k.indexOf('uCosWyp');
  const pRozc = k.search(/\b1\.5\b/);
  const pSci = k.search(/\b0\.45\b/);
  assert.ok(pWypiek >= 0 && pRozc > pWypiek && pSci > pRozc, `kolejność gałęzi: wypiek ${pWypiek}, rozciąganie ${pRozc}, ściskanie ${pSci}`);
});

test('słowo sąsiada: numer i klasa wracają, a słowo nigdy nie jest denormalem ani NaN', () => {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (const klasa of [0, 1, 5, 6, 11]) {
    for (const j of [0, 1, 14941, 20621, 25999]) {
      const s = slowoSasiada(j, klasa);
      assert.equal(sasiadZeSlowa(s), j);
      assert.equal(klasaZeSlowa(s), klasa);
      const wykladnik = (s >>> 23) & 0xff;
      assert.ok(wykladnik !== 0 && wykladnik !== 0xff, `klasa ${klasa}, j ${j}: wykładnik ${wykladnik}`);
      u[0] = s;
      assert.equal(u[0], s, 'słowo przechodzi przez Float32Array bit w bit');
    }
  }
});

test('słowo ijk: bity jak w § 2.2, także grupa', () => {
  assert.equal(slowoIjk(3, 4, 5, 0), (3 | (4 << 10) | (5 << 20)) >>> 0);
  assert.equal(slowoIjk(1023, 1023, 1023, 3), 0xffffffff);
  assert.equal(slowoIjk(0, 0, 0, 1) >>> 30, 1);
  assert.equal(slowoIjk(0, 0, 0, 2) >>> 30, 2);
});

test('wczytanie budowy: wiązania, klasy i tablice stałe wracają z buforów', () => {
  const sc = wieza({ w: 100, d: 100, h: 180, pietroCo: 3, kolumnyCo: 2, rdzenW: 40, rdzenD: 40 });
  sc.g = 400; sc.gruntZ = 0; sc.vel0 = null;
  const w = zbuduj(sc, PARAMETRY);
  const s = createWokseleSolver({ maxNodes: Math.max(w.n, 8) });
  s.wczytaj(w);
  const { wiaz, stan, maska, ijk, tab, wez } = s.atrybuty;
  const u = new Uint32Array(wiaz.array.buffer, wiaz.array.byteOffset, wiaz.array.length);
  const n = w.n;
  for (let q = 0; q < STRONA * n; q++) {
    const b = 8 * q;
    assert.equal(wiaz.array[b], w.L[q]);
    assert.equal(wiaz.array[b + 2], w.F0[q]);
    assert.equal(wiaz.array[b + 3], w.R0[q]);
    assert.equal(wiaz.array[b + 4], w.Ft[q]);
    assert.equal(wiaz.array[b + 5], w.Fc[q]);
    if (w.nbr[q] < 0) continue;
    assert.equal(sasiadZeSlowa(u[b + 6]), w.nbr[q]);
    assert.equal(klasaZeSlowa(u[b + 6]), w.klasaW[q]);
    // Tablica klas ma te same iT i iC, które wzorzec trzyma per wiązanie, i ten sam krusz.
    const k = 4 * (18 + w.klasaW[q]);
    assert.equal(tab.array[k], Math.fround(w.iT[q]));
    assert.equal(tab.array[k + 1], Math.fround(w.iC[q]));
    assert.equal(tab.array[k + 2], w.kruszTab[w.klasaW[q]]);
  }
  for (let i = 0; i < n; i++) {
    assert.equal(maska.array[i], w.maska[i]);
    assert.equal(maska.array[n + i], w.maska[i]);
    assert.equal(wez.array[12 * i + 3], w.rk[i]);
    assert.equal(stan.array[4 * (2 * n + 2 * i)], w.bMax2W[i]);
    assert.equal(stan.array[4 * (2 * n + 2 * i) + 3], w.iN0[i]);
    assert.equal(stan.array[4 * (2 * n + 2 * i) + 4], w.kUd[i]);
    assert.equal(stan.array[4 * (2 * n + 2 * i) + 7], w.flagi[i]);
    assert.equal(ijk.array[i], slowoIjk(w.ijk[3 * i], w.ijk[3 * i + 1], w.ijk[3 * i + 2], w.grupa[i]));
  }
  for (let q = 0; q < 27; q++) assert.equal(tab.array[4 * (30 + q)], w.lutKier[q]);
  for (const [nazwa, k] of Object.entries(s.kernele)) assert.equal(k.getCount(), { kZerujCel: 1, kKraterCel: KRATER_N, kZerujWybuch: 20 }[nazwa] ?? n, nazwa);
  assert.equal(s.atrybuty.czasU.array[0], Math.fround(1e30));
  assert.equal(s.uniformy.uN.value, n);
  assert.equal(s.uniformy.uCap.value, w.capEtyk);
});

test('wzorzec f32 bez zaokrąglania to ten sam algorytm co WzorzecCpu, z zaokrąglaniem różni się mało', () => {
  // Podkrok po ruinie: góra wieży bez jednej kondygnacji spada na dół, więc działają gałęzie zerwań, kontaktów i szkody. Etykieta i F0 przy gruncie i kotwicach.
  const sc = wieza({ w: 100, d: 100, h: 180, pietroCo: 3 });
  sc.g = 400; sc.gruntZ = 0; sc.vel0 = null;
  const w = zbuduj(sc, PARAMETRY);
  const cpu = new WzorzecCpu(w);
  const lista = [];
  for (let i = 0; i < w.n; i++) if (Math.abs(sc.pos[3 * i + 2] - 60) < 25) lista.push(i);
  cpu.usun(lista);
  for (let k = 0; k < 40; k++) cpu.krok();
  assert.ok(cpu.zerwanych > 0, 'scena ma coś łamać');
  const m = cpu.migawka();
  const mielone = new WzorzecF32(w, PARAMETRY, { f32: false });
  mielone.wgraj(m);
  const baza = new WzorzecCpu(w);
  baza.wgraj(m);
  baza.podkrokPorownania();
  mielone.podkrokPorownania();
  const a = baza.stanPoPodkroku(), b = mielone.stanPoPodkroku();
  assert.deepEqual([...b.maskaW], [...a.maskaW], 'maski');
  for (const pole of ['szkoda', 'A', 'L', 'D', 'F0']) for (let q = 0; q < a[pole].length; q++) assert.ok(Math.abs(a[pole][q] - b[pole][q]) < 1e-3, `${pole}[${q}]: ${a[pole][q]} kontra ${b[pole][q]}`);
  let daMax = 0;
  for (let i = 0; i < w.n; i++) {
    if (!m.aktywny[i] || m.nieruchomy[i]) continue;
    for (let c = 0; c < 3; c++) daMax = Math.max(daMax, Math.abs(a.acc[3 * i + c] - b.acc[3 * i + c]));
  }
  assert.ok(daMax < 1e-2, `|Δa| ${daMax}`);
  // W f32 te same gałęzie, a różnica przyspieszenia rzędu tej ze specyfikacji (§ 8), bo tyle kosztuje samo zaokrąglenie.
  const f32 = new WzorzecF32(w);
  f32.wgraj(m);
  f32.podkrokPorownania();
  const c = f32.stanPoPodkroku();
  let daF32 = 0;
  for (let i = 0; i < w.n; i++) {
    if (!m.aktywny[i] || m.nieruchomy[i]) continue;
    for (let q = 0; q < 3; q++) daF32 = Math.max(daF32, Math.abs(a.acc[3 * i + q] - c.acc[3 * i + q]));
  }
  assert.ok(daF32 > 0 && daF32 < 5, `|Δa| f32 ${daF32}`);
});

test('lista kroku: 22 dispatche, lista kontaktów co 4 podkroki (§ 2.4)', () => {
  const nazwy = solver.sekwencja.map((e) => e[0]);
  assert.equal(nazwy.length, 22);
  assert.deepEqual(nazwy.slice(0, 7), ['kWstaw', 'kLista', 'kZerujPo', 'kF', 'kI', 'kF', 'kI']);
  assert.equal(nazwy.filter((x) => x === 'kF').length, 8);
  assert.equal(nazwy.filter((x) => x === 'kI').length, 8);
  assert.equal(nazwy.filter((x) => x === 'kLista').length, 2);
  assert.equal(nazwy.lastIndexOf('kWstaw'), 11);
});

test('plan zdarzeń: klatka węzła jak w Node, znak to rodzaj, bit ziaren w fladze, rezet przy wczytaniu', () => {

  const sc = wieza({ w: 100, d: 100, h: 180, pietroCo: 3, kolumnyCo: 2, rdzenW: 40, rdzenD: 40 });
  sc.g = 400; sc.gruntZ = 0; sc.vel0 = null;
  const w = zbuduj(sc, PARAMETRY);
  const s = createWokseleSolver({ maxNodes: Math.max(w.n, 8) });
  s.wczytaj(w);
  const pg = {
    czasy: { indeksy: Int32Array.from([3, 5, 7]), t: Float64Array.from([2, 2.01, 2 + 1 / 60]), rozerwij: Uint8Array.from([0, 1, 1]), zostawZiarna: true },
    pchniecia: [], kratery: [],
  };
  const p = s.ustawPlan(pg);
  const c = s.atrybuty.czasU.array;
  assert.equal(c[3], 120.5, 't = 2 należy do klatki 120, jak w planUsuwania');
  assert.equal(c[5], -120.5, 'rozerwanie: znak ujemny');
  assert.equal(c[7], -121.5, 't = 2 + 1/60 należy do klatki 121');
  assert.equal(p.klatki[120], 1);
  assert.equal(p.klatki[119], 0);
  const flaga = (i) => s.atrybuty.stan.array[4 * (2 * w.n + 2 * i) + 7];
  assert.equal(flaga(5), (w.flagi[5] | BIT_ZOSTAW) >>> 0);
  assert.equal(flaga(3), w.flagi[3], 'usunięcie nie dostaje bitu');
  s.wczytaj(w);
  assert.equal(c[3], Math.fround(1e30));
  assert.equal(flaga(5), w.flagi[5]);

});

test('plany pełnych scen niosą dane dla solvera: S4 pchnięcia i korekcję momentu, krater rząd, S3 nic', () => {
  const p4 = planGpu(S4());
  assert.equal(p4.pchniecia.length, 12);
  assert.equal(p4.zerujL, true);
  assert.equal(p4.swobodnyG, 0);
  assert.equal(p4.pchniecia[0].rP, 320);
  assert.equal(planGpu(S4({ g: 400 })).swobodnyG, 400);
  assert.equal(planGpu(S4({ g: 400, grunt: true, kotwice: true })).swobodnyG, 0);
  const k = planGpu(krater({ c: [190, 0, 650], r: 60, J: 300, rP: 160, proznia: true }));
  assert.equal(k.kratery.length, 1);
  assert.equal(k.kratery[0].rdzen, 0.4);
  assert.equal(planGpu(S3()).czasy.indeksy.length, 0);
  assert.ok(planGpu(S1()).czasy.indeksy.length > 0);
});
