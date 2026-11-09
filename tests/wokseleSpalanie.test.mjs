// Spalanie odłamków bazy w atmosferze (demo wokseli, src/3d/woksele/atmosfera.js): wzorzec CPU modelu ma dawać to, o co prosił użytkownik 2026-11-09:
// małe spalają się całe, największe dolatują, Mars pali dużo słabiej niż Ziemia, ale widocznie (żar), Hidalgo bez atmosfery nie pali nic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANETY_ATM, planetaZAdresu, gestosc, strumienCiepla, temperaturaRownowagi, symulujSpadek } from '../src/3d/woksele/atmosfera.js';

const { ziemia, mars, hidalgo } = PLANETY_ATM;

test('gęstość: ρ0 przy gruncie, e⁻¹ na skali wysokości', () => {
  assert.equal(gestosc(ziemia.atmosfera, 0), 1.225);
  assert.ok(Math.abs(gestosc(ziemia.atmosfera, 8500) / 1.225 - Math.exp(-1)) < 1e-12);
  assert.ok(gestosc(mars.atmosfera, 0) < gestosc(ziemia.atmosfera, 0) / 50);
});

test('strumień ciepła ∝ ρ·v³, temperatura rośnie z nim', () => {
  assert.ok(Math.abs(strumienCiepla(1, 2000) / strumienCiepla(1, 1000) - 8) < 1e-9);
  assert.ok(temperaturaRownowagi(1e7) > temperaturaRownowagi(1e6));
  assert.equal(temperaturaRownowagi(0), 250);
});

test('adres: nieznana planeta to Hidalgo', () => {
  assert.equal(planetaZAdresu('ZIEMIA'), ziemia);
  assert.equal(planetaZAdresu('mars'), mars);
  assert.equal(planetaZAdresu('wenus'), hidalgo);
  assert.equal(planetaZAdresu(null), hidalgo);
});

test('Ziemia: gruz i pojedyncze węzły spalają się w locie, wielka bryła doleciuje', () => {
  for (const [gruby, maly] of [[3, true], [8, true], [20, true], [40, false], [80, false]]) {
    const r = symulujSpadek({ planeta: ziemia, gruby, maly });
    assert.ok(!r.doleciał && r.hSpalony > 1000, `gruby ${gruby}: ${JSON.stringify(r)}`);
    assert.ok(r.Tmax > 3000, `gruby ${gruby}: żar ${r.Tmax}`);
  }
  const duza = symulujSpadek({ planeta: ziemia, gruby: 800 });
  assert.ok(duza.doleciał && duza.ulamek > 0.5 && duza.ulamek < 0.95, JSON.stringify(duza));
  assert.ok(duza.vUderzenia > 5000, 'wielka bryła prawie nie hamuje');
});

test('Mars: wszystko doleciuje, ze stratą najwyżej kilku procent, ale żarzy się (T > 2000 K)', () => {
  for (const [gruby, maly] of [[3, true], [40, false], [400, false]]) {
    const r = symulujSpadek({ planeta: mars, gruby, maly });
    assert.ok(r.doleciał, `gruby ${gruby}`);
    assert.ok(r.ulamek > 0.8, `gruby ${gruby}: ${r.ulamek}`);
    assert.ok(r.Tmax > 2000, `gruby ${gruby}: żar ${r.Tmax}`);
    const z = symulujSpadek({ planeta: ziemia, gruby, maly });
    assert.ok((r.Tmax / z.Tmax) ** 4 < 0.15, `Mars grzeje dużo słabiej (strumień ciepła ∝ T⁴): ${r.Tmax} / ${z.Tmax}`);
  }
});

test('Ziemia: spadek dłuższy niż na Hidalgo w grze (40 km), a żar dopiero w górnej atmosferze', () => {
  const r = symulujSpadek({ planeta: ziemia, gruby: 800 });
  assert.ok(ziemia.wysBazy > 2 * 40000);
  assert.ok(r.hZar < 100000 && r.hZar > 60000, `pierwszy żar ${r.hZar}`);
});
