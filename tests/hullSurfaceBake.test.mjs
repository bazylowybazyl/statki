// Mapa powierzchni kadłuba ze sprite'a (oświetlenie v2, src/3d/hullSurfaceBake.js): normalne, AO i relief
// paneli odtworzone z alfy i jasności obrazu.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HULL_SURFACE_DEFAULTS, bakeHullSurface, bakeHullSurfaceField, blurField, downscaleRgba, hullSurfaceSize
} from '../src/3d/hullSurfaceBake.js';

// Obraz RGBA8 w × h z funkcji (x, y) → [r, g, b, a].
function image(w, h, fn) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      px.set(c, (y * w + x) * 4);
    }
  }
  return px;
}
const at = (data, w, x, y) => {
  const i = (y * w + x) * 4;
  return { nx: data[i] / 127.5 - 1, ny: data[i + 1] / 127.5 - 1, ao: data[i + 2] / 255, h: data[i + 3] / 255 };
};

test('pusta przestrzeń: normalna w górę, AO 1, relief 0 (A = 0,5)', () => {
  const w = 64; const h = 48;
  const px = image(w, h, (x, y) => (x > 20 && x < 44 && y > 14 && y < 34 ? [120, 120, 120, 255] : [0, 0, 0, 0]));
  const out = bakeHullSurfaceField(px, w, h, 1);
  const i = (2 * w + 2) * 4;
  assert.deepEqual(Array.from(out.subarray(i, i + 4)), [128, 128, 255, 128]);
});

test('jednolity kadłub: relief bez stopnia przy sylwetce (jasność normalizowana alfą), normalne kopuły na zewnątrz', () => {
  const w = 160; const h = 96;
  const px = image(w, h, (x, y) => (x >= 30 && x < 130 && y >= 20 && y < 76 ? [140, 140, 140, 255] : [0, 0, 0, 0]));
  const out = bakeHullSurfaceField(px, w, h, 1);
  // Relief paneli w całym wnętrzu ≈ 0 — pustka wokół nie wchodzi do tła (inaczej świecąca obwódka).
  for (const [x, y] of [[32, 48], [80, 22], [80, 48], [127, 48], [80, 73]]) {
    assert.ok(Math.abs(at(out, w, x, y).h - 0.5) < 0.02, `relief przy (${x}, ${y}) = ${at(out, w, x, y).h}`);
  }
  // Kopuła i faza: przy lewej krawędzi normalna w lewo, przy prawej w prawo; przy górnej (obraz) — w górę (+y).
  assert.ok(at(out, w, 31, 48).nx < -0.2, 'lewa krawędź');
  assert.ok(at(out, w, 128, 48).nx > 0.2, 'prawa krawędź');
  assert.ok(at(out, w, 80, 21).ny > 0.2, 'górna krawędź (y normalnej w górę obrazu)');
  assert.ok(at(out, w, 80, 74).ny < -0.2, 'dolna krawędź');
  // Środek prawie płaski.
  const c = at(out, w, 80, 48);
  assert.ok(Math.hypot(c.nx, c.ny) < 0.2, `środek ${JSON.stringify(c)}`);
});

test('jasny panel na ciemnej blasze: brzegi wyżej i pochylone na zewnątrz (relief pasmowy), szew niżej z AO', () => {
  // Relief to różnica jasności od tła paneli (DoG, σ 1,2 / 7 tekseli): duży panel ma uniesiony BRZEG
  // (środek wraca do poziomu blachy — normalne i samocień liczą się na krawędziach), szew — wnękę.
  const w = 200; const h = 120;
  const panel = (x, y) => x >= 80 && x < 120 && y >= 40 && y < 80;
  const seam = (x, y) => (x === 140 || x === 141) && y > 20 && y < 100;
  const px = image(w, h, (x, y) => {
    if (!(x >= 10 && x < 190 && y >= 10 && y < 110)) return [0, 0, 0, 0];
    if (panel(x, y)) return [200, 200, 200, 255];
    if (seam(x, y)) return [30, 30, 30, 255];
    return [110, 110, 110, 255];
  });
  const out = bakeHullSurfaceField(px, w, h, 1);
  assert.ok(at(out, w, 83, 60).h > 0.54, `brzeg panelu wyżej: ${at(out, w, 83, 60).h}`);
  assert.ok(at(out, w, 76, 60).h < 0.48, `blacha tuż przy panelu niżej: ${at(out, w, 76, 60).h}`);
  assert.ok(at(out, w, 140, 60).h < 0.45, `szew niżej: ${at(out, w, 140, 60).h}`);
  assert.ok(at(out, w, 80, 60).nx < -0.15, 'lewy brzeg panelu w lewo');
  assert.ok(at(out, w, 119, 60).nx > 0.15, 'prawy brzeg panelu w prawo');
  assert.ok(at(out, w, 140, 60).ao < at(out, w, 60, 60).ao - 0.05, 'szew ciemniejszy w AO');
  assert.ok(at(out, w, 60, 60).ao > 0.9, 'otwarta blacha bez AO');
});

test('pełny wypiek: zmniejszenie do maxSide, px sprite\'a na teksel, relief brzegu panelu w obu rozdzielczościach', () => {
  const W = 240; const H = 160;
  const px = image(W, H, (x, y) => {
    if (!(x >= 20 && x < 220 && y >= 20 && y < 140)) return [0, 0, 0, 0];
    return x >= 100 && x < 140 && y >= 60 && y < 100 ? [210, 210, 210, 255] : [100, 100, 100, 255];
  });
  const full = bakeHullSurface(px, W, H, { maxSide: 240 });
  const half = bakeHullSurface(px, W, H, { maxSide: 120 });
  assert.equal(full.width, 240);
  assert.equal(half.width, 120);
  assert.equal(half.height, 80);
  assert.equal(half.pxPerTexel, 2);
  assert.ok(at(full.data, full.width, 103, 80).h > 0.55, 'pełna: brzeg panelu wyżej');
  assert.ok(at(half.data, half.width, 51, 40).h > 0.55, 'połowa: brzeg panelu wyżej');
  assert.ok(at(full.data, full.width, 100, 80).nx < -0.1 && at(half.data, half.width, 50, 40).nx < -0.1, 'lewy brzeg w lewo');
});

test('pomocniki: rozmiar mapy, rozmycie zachowuje sumę, zmniejszenie waży barwę alfą', () => {
  assert.deepEqual(hullSurfaceSize(3747, 1677, 1536), { w: 1536, h: 687, scale: 1536 / 3747 });
  assert.deepEqual(hullSurfaceSize(800, 600, 1536), { w: 800, h: 600, scale: 1 });
  const w = 50; const h = 40;
  const f = new Float32Array(w * h);
  f[20 * w + 25] = 1;
  const b = blurField(f, w, h, 3);
  const sum = b.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-3, `suma ${sum}`);
  // Przezroczysty czarny piksel obok białego nie ciemni barwy po zmniejszeniu (ważenie alfą).
  const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]);
  const d = downscaleRgba(px, 2, 1, 1, 1);
  assert.deepEqual(Array.from(d), [255, 255, 255, 128]);
  assert.ok(HULL_SURFACE_DEFAULTS.heightRange > HULL_SURFACE_DEFAULTS.mesoClamp, 'relief mieści się w zakresie A');
});
