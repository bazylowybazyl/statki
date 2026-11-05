// Lustro miasta-ogrodu ringu w JS (dema/woksele-zawalenia/miasto.js): rozkłady z reguły, węzły w rzucie, odstępy sąsiadów, zgodność z kodem ringu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MIASTO, RZUT_W, RZUT_D, DZIALKA_U, DZIALKA_V, haloHash12, budynkiDzielnicy, rozmiarDzielnicy,
  siatkaBudynku, dlaKazdegoWezla, wezlyBudynku, wezlyDzielnicy, węzłyBudynku, węzłyDzielnicy,
} from '../dema/woksele-zawalenia/miasto.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';

const DXY = [5, 10, 20, 40];

const mediana = (t) => {
  const s = [...t].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};

test('stałe i wzory lustra zgadzają się z kodem ringu', () => {
  const uklad = createHaloRingLayout({});
  const n = Math.round(uklad.circumference / 140);
  assert.equal(MIASTO.kwartalyObwod, n);
  assert.ok(Math.abs(MIASTO.T - uklad.circumference / n) < 1e-9);
  assert.equal(MIASTO.rzedy, Math.ceil(uklad.floor.length / MIASTO.blockT));

  const miasto = readFileSync(new URL('../src/3d/haloRing/haloRingCity.js', import.meta.url), 'utf8');
  for (const wzor of [
    'gardenBlockT: 118',
    'step(bh, 0.24)',
    'haloHash12(bid.mul(7.0).add(lot).add(3.0))',
    'haloHash12(bid.add(0.5))',
    'float(0.35).add(float(0.65).mul(fract(lotH.mul(13.7))))',
    'mix(float(10.0).add(float(60.0).mul(lotHt).mul(lotHt)), float(40.0).add(float(250.0).mul(lotHt).mul(lotHt)), typeGlass)',
    'vec2(T.div(3.0), blockT / 2.0).mul(0.72)',
    'step(0.55, lotHt).mul(step(fract(lotH.mul(5.3)), mix(0.6, 0.95, typeGlass)))',
    'foot.mul(mix(0.55, 0.62, fract(lotH.mul(3.7))))',
    'height.mul(mix(0.35, 0.7, fract(lotH.mul(9.1))))',
    'vec2(fract(lotH.mul(2.3)), fract(lotH.mul(4.9))).sub(0.5).mul(foot.sub(size.xy)).mul(0.8)',
  ]) assert.ok(miasto.includes(wzor), `haloRingCity.js zmienił wzór, popraw lustro: ${wzor}`);

  const tsl = readFileSync(new URL('../src/3d/haloRing/haloRingTSL.js', import.meta.url), 'utf8');
  const hasz = tsl.slice(tsl.indexOf("pure('haloHash12'"), tsl.indexOf("pure('haloHash13'"));
  for (const wzor of ['vec3(a.p.x, a.p.y, a.p.x).mul(0.1031)', 'p3.addAssign(dot(p3, p3.yzx.add(33.33)))', 'fract(p3.x.add(p3.y).mul(p3.z))']) {
    assert.ok(hasz.includes(wzor), `haloHash12 zmienił wzór, popraw lustro: ${wzor}`);
  }
});

test('hasz ma rozkład równomierny, a parki zajmują około 24% kwartałów', () => {
  let parki = 0;
  let suma = 0;
  const N = 200;
  for (let u = 0; u < N; u++) {
    for (let v = 0; v < 46; v++) {
      const h = haloHash12(u + 0.5, v + 0.5);
      assert.ok(h >= 0 && h < 1);
      suma += h;
      if (h <= MIASTO.parkProg) parki++;
    }
  }
  const razem = N * 46;
  assert.ok(Math.abs(suma / razem - 0.5) < 0.02, `średnia ${suma / razem}`);
  assert.ok(Math.abs(parki / razem - 0.24) < 0.03, `parki ${parki / razem}`);
});

test('dzielnica jest deterministyczna, a ziarno wybiera inne miejsce', () => {
  const a = budynkiDzielnicy({ kwartalyU: 8, kwartalyV: 6, ziarno: 3 });
  assert.deepEqual(a, budynkiDzielnicy({ kwartalyU: 8, kwartalyV: 6, ziarno: 3 }));
  assert.notDeepEqual(a.map((b) => b.h), budynkiDzielnicy({ kwartalyU: 8, kwartalyV: 6, ziarno: 4 }).map((b) => b.h));
});

test('dzielnica około 500 budynków: rozkłady wysokości i rzutu z reguły', () => {
  const r = rozmiarDzielnicy(500);
  const b = budynkiDzielnicy({ ...r, ziarno: 1 });
  assert.ok(b.length > 400 && b.length < 600, `budynków ${b.length}`);
  const ogrod = b.filter((x) => x.typGlass === 0).map((x) => x.h);
  const szklo = b.filter((x) => x.typGlass === 1).map((x) => x.h);
  const przejscie = b.length - ogrod.length - szklo.length;
  console.log(`dzielnica ${r.kwartalyU} × ${r.kwartalyV}: ${b.length} budynków, ogród ${ogrod.length} (${Math.min(...ogrod).toFixed(1)}–${Math.max(...ogrod).toFixed(1)}, mediana ${mediana(ogrod).toFixed(1)}), szkło ${szklo.length} (${Math.min(...szklo).toFixed(1)}–${Math.max(...szklo).toFixed(1)}, mediana ${mediana(szklo).toFixed(1)}), przejście ${przejscie}, z uskokiem ${b.filter((x) => x.uskok).length}`);
  assert.ok(ogrod.length > 100 && szklo.length > 80);
  assert.ok(Math.min(...ogrod) >= 17.3 && Math.max(...ogrod) <= 70);
  assert.ok(Math.min(...szklo) >= 70.6 && Math.max(...szklo) <= 290);
  assert.ok(Math.abs(mediana(ogrod) - 37.3) < 8, `mediana ogrodu ${mediana(ogrod)}`);
  assert.ok(Math.abs(mediana(szklo) - 153.9) < 30, `mediana szkła ${mediana(szklo)}`);
  for (const x of b) {
    assert.ok(Math.abs(x.w - 33.6) < 0.01 && Math.abs(x.d - 42.48) < 0.01);
    assert.equal(x.szklo, x.typGlass > 0.5);
    assert.ok(Math.abs(x.x) < (r.kwartalyU * MIASTO.T) / 2 && Math.abs(x.y) < (r.kwartalyV * MIASTO.blockT) / 2);
  }
  // Szkło w środku, ogrody na obrzeżu.
  const odl = (x) => Math.sqrt(x.x * x.x + x.y * x.y);
  assert.ok(mediana(b.filter((x) => x.typGlass === 1).map(odl)) < mediana(b.filter((x) => x.typGlass === 0).map(odl)));
  // Odstępy: działka minus rzut, około 13 i 16,5.
  assert.ok(Math.abs(DZIALKA_U - RZUT_W - 13.07) < 0.01 && Math.abs(DZIALKA_V - RZUT_D - 16.52) < 0.01);
});

test('duża próbka: mediany wysokości trzymają się wzoru', () => {
  const b = budynkiDzielnicy({ kwartalyU: 40, kwartalyV: 40, ziarno: 2 });
  const ogrod = b.filter((x) => x.typGlass === 0).map((x) => x.h);
  const szklo = b.filter((x) => x.typGlass === 1).map((x) => x.h);
  assert.ok(Math.abs(mediana(ogrod) - 37.3) < 3, `mediana ogrodu ${mediana(ogrod)}`);
  assert.ok(Math.abs(mediana(szklo) - 153.9) < 12, `mediana szkła ${mediana(szklo)}`);
  const parkow = 1 - b.length / (40 * 40 * 6);
  assert.ok(Math.abs(parkow - 0.24) < 0.04, `parki ${parkow}`);
});

test('uskok stoi wewnątrz rzutu korpusu i jest z reguły', () => {
  const b = budynkiDzielnicy({ kwartalyU: 20, kwartalyV: 20, ziarno: 5 });
  const u = b.filter((x) => x.uskok);
  assert.ok(u.length > b.length * 0.2 && u.length < b.length * 0.7, `uskoków ${u.length} z ${b.length}`);
  for (const x of u) {
    assert.ok(Math.abs(x.uskok.dx) + x.uskok.w / 2 < x.w / 2);
    assert.ok(Math.abs(x.uskok.dy) + x.uskok.d / 2 < x.d / 2);
    const k = x.uskok.w / x.w;
    assert.ok(k >= 0.55 - 1e-6 && k <= 0.62 + 1e-6);
    assert.ok(x.uskok.h >= x.h * 0.35 - 1e-6 && x.uskok.h <= x.h * 0.7 + 1e-6);
  }
});

/** Sprawdza węzły każdego budynku i odstęp pudeł kolumn między sąsiadami (narożniki pudła to prawdziwe kolumny, więc odległość jest ścisła). */
function sprawdzSiatke(budynki, dx, nazwa) {
  const pudla = [];
  for (const b of budynki) {
    const s = siatkaBudynku(b, dx);
    let n = 0;
    let zMax = 0;
    const licz = dlaKazdegoWezla(b, dx, (x, y, z, i, j, k) => {
      n++;
      zMax = Math.max(zMax, z);
      assert.ok(Math.abs(x - b.x) <= b.w / 2 + 1e-9, `${nazwa}: węzeł poza rzutem na x przy dx = ${dx}`);
      assert.ok(Math.abs(y - b.y) <= b.d / 2 + 1e-9, `${nazwa}: węzeł poza rzutem na y przy dx = ${dx}`);
      assert.ok(z > 0);
      assert.ok(i >= 0 && i < s.nx && j >= 0 && j < s.ny && k >= 0);
    });
    assert.equal(n, licz);
    assert.equal(n, wezlyBudynku(b, dx));
    assert.ok(n >= 1);
    const wys = b.h + (s.uskok ? b.uskok.h : 0);
    assert.ok(zMax <= wys + dx / 2 + 1e-9, `${nazwa}: węzeł nad dachem: ${zMax} przy ${wys}, dx = ${dx}`);
    pudla.push({ x: b.x, y: b.y, kx: ((s.nx - 1) * dx) / 2, ky: ((s.ny - 1) * dx) / 2, vx: (s.nx * dx) / 2, vy: (s.ny * dx) / 2 });
  }
  let minKol = Infinity;
  let minKost = Infinity;
  for (let a = 0; a < pudla.length; a++) {
    for (let c = a + 1; c < pudla.length; c++) {
      const p = pudla[a];
      const q = pudla[c];
      const ax = Math.abs(p.x - q.x);
      const ay = Math.abs(p.y - q.y);
      const gx = Math.max(0, ax - p.kx - q.kx);
      const gy = Math.max(0, ay - p.ky - q.ky);
      minKol = Math.min(minKol, Math.sqrt(gx * gx + gy * gy));
      minKost = Math.min(minKost, Math.max(ax - p.vx - q.vx, ay - p.vy - q.vy));
    }
  }
  // Kolumny dalej niż jedno dx: sfery kontaktu (średnica do dx) nie stykają się na starcie. Kostki obrazu też się nie nakładają.
  assert.ok(minKol >= dx, `${nazwa}: kolumny sąsiadów ${minKol.toFixed(2)} przy dx = ${dx}`);
  assert.ok(minKost > 0, `${nazwa}: kostki sąsiadów nachodzą o ${(-minKost).toFixed(2)} przy dx = ${dx}`);
  return { minKol, minKost };
}

test('węzły stoją w rzucie, a sąsiedzi mają odstęp przy dx = 5, 10, 20, 40', () => {
  const b = budynkiDzielnicy({ ...rozmiarDzielnicy(500), ziarno: 1 });
  for (const dx of DXY) sprawdzSiatke(b, dx, 'proste ulice');
  const krzywe = budynkiDzielnicy({ ...rozmiarDzielnicy(500), ziarno: 1, skrzywienie: 1 });
  for (const dx of DXY) sprawdzSiatke(krzywe, dx, 'skrzywienie 1');
  assert.notEqual(krzywe[10].x, b[10].x);
});

test('wydmuszka nigdy nie ma więcej węzłów, a przy grubym węźle niczego nie oszczędza', () => {
  const b = budynkiDzielnicy({ ...rozmiarDzielnicy(200), ziarno: 1 });
  for (const dx of DXY) assert.ok(wezlyDzielnicy(b, dx, { wydmuszka: true }) <= wezlyDzielnicy(b, dx));
  assert.equal(wezlyDzielnicy(b, 40, { wydmuszka: true }), wezlyDzielnicy(b, 40));
  assert.ok(wezlyDzielnicy(b, 5, { wydmuszka: true }) < wezlyDzielnicy(b, 5) * 0.8);
});

test('nazwy z ogonkami to te same funkcje', () => {
  assert.equal(węzłyBudynku, wezlyBudynku);
  assert.equal(węzłyDzielnicy, wezlyDzielnicy);
});

test('wypisuje liczby węzłów dzielnic około 200, 500 i 1000 budynków', () => {
  const wiersze = [];
  for (const cel of [200, 500, 1000]) {
    const r = rozmiarDzielnicy(cel);
    // Parki to rzut monetą na kwartał, więc mała dzielnica waha się o kilkadziesiąt budynków: ziarno najbliższe celowi.
    let b = null;
    for (let ziarno = 1; ziarno <= 8; ziarno++) {
      const c = budynkiDzielnicy({ ...r, ziarno });
      if (!b || Math.abs(c.length - cel) < Math.abs(b.length - cel)) b = c;
    }
    const szklo = b.filter((x) => x.szklo).length;
    assert.ok(Math.abs(b.length - cel) < cel * 0.2, `cel ${cel}: ${b.length}`);
    for (const dx of DXY) {
      const n = wezlyDzielnicy(b, dx);
      const nw = wezlyDzielnicy(b, dx, { wydmuszka: true });
      const og = b.filter((x) => !x.szklo).map((x) => wezlyBudynku(x, dx));
      const sz = b.filter((x) => x.szklo).map((x) => wezlyBudynku(x, dx));
      const jeden = b.filter((x) => wezlyBudynku(x, dx) === 1).length;
      wiersze.push(`${String(b.length).padStart(5)} (${r.kwartalyU}×${r.kwartalyV}, szkło ${szklo}) dx=${String(dx).padStart(2)}: ${String(n).padStart(8)} węzłów, wydmuszka ${String(nw).padStart(7)}, mediana ogród ${String(mediana(og)).padStart(4)}, szkło ${String(mediana(sz)).padStart(5)}, max ${String(Math.max(...og, ...sz)).padStart(5)}, po 1 węźle ${jeden}`);
      assert.ok(n > 0);
    }
  }
  console.log(wiersze.join('\n'));
});
