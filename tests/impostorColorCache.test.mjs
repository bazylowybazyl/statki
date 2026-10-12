import test from 'node:test';
import assert from 'node:assert/strict';

// Kolor smugi dalekiego kadłuba / wraku (hexBodyImpostorBatch.js computeAverageBodyColor, audyt FPS 2026-10-11):
// liczony raz na OBRAZ źródłowy — wraki dziedziczą obraz rodu, a każdy nowy wrak robił płótno, drawImage całego
// sprite'a i getImageData (szczyty 0,8–1,1 ms/kl w końcówce bitwy). Atrapa płótna zamiast DOM.

const created = [];
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const c = {
      width: 0,
      height: 0,
      getContext() {
        return {
          drawImage(src) { c.src = src; },
          getImageData(x, y, w, h) {
            const data = new Uint8ClampedArray(w * h * 4);
            const fill = c.src.fill;
            for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
            return { data };
          }
        };
      }
    };
    created.push(c);
    return c;
  }
};

const { computeAverageBodyColor, averageBodyColorCache } = await import('../src/3d/hexBodyImpostorBatch.js');

test('kolor smugi: raz na obraz źródłowy, ten sam obiekt dla wraków rodu; obraz bez rozmiaru — bez zapamiętania', () => {
  const sprite = { naturalWidth: 640, naturalHeight: 320, fill: [255, 128, 0, 255] };
  const c1 = computeAverageBodyColor(sprite);
  assert.ok(c1 && Math.abs(c1.r - 1) < 1e-9 && Math.abs(c1.g - 128 / 255) < 1e-9 && c1.b === 0);
  const n = created.length;
  assert.equal(computeAverageBodyColor(sprite), c1, 'drugi wrak tego samego obrazu — z pamięci');
  assert.equal(created.length, n, 'bez nowego płótna');

  // obraz jeszcze się wczytuje (0 × 0) — null i bez zapamiętania; po wczytaniu liczy się normalnie
  const loading = { naturalWidth: 0, naturalHeight: 0, fill: [10, 20, 30, 255] };
  assert.equal(computeAverageBodyColor(loading), null);
  loading.naturalWidth = 64; loading.naturalHeight = 64;
  const c2 = computeAverageBodyColor(loading);
  assert.ok(c2 && Math.abs(c2.b - 30 / 255) < 1e-9, 'po wczytaniu — kolor');

  // przezroczysty obraz — null, bez zapamiętania (płótno źródłowe mogło jeszcze nie mieć treści)
  const empty = { width: 32, height: 32, fill: [0, 0, 0, 0] };
  assert.equal(computeAverageBodyColor(empty), null);
  empty.fill = [0, 255, 0, 255];
  assert.ok(computeAverageBodyColor(empty)?.g === 1, 'treść dorysowana — kolor');

  // A/B pomiaru: bez pamięci — każde wołanie liczy od nowa (ten sam wynik)
  averageBodyColorCache.enabled = false;
  try {
    const before = created.length;
    const c3 = computeAverageBodyColor(sprite);
    assert.notEqual(c3, c1);
    assert.deepEqual([c3.r, c3.g, c3.b], [c1.r, c1.g, c1.b]);
    assert.equal(created.length, before + 1);
  } finally {
    averageBodyColorCache.enabled = true;
  }
});
