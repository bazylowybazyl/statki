import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  HULL_LACQUER_DEFAULTS,
  MAX_ENGINE_ZONES,
  bakeHullShapeField,
  boxBlur3,
  buildLacquerEnvPixels,
  computeEngineZones
} from '../src/3d/hullLacquer.js';

test('domyślny kafel obłoków odbić istnieje w public/', () => {
  // Adres względny jak 'assets/nebula.png' — Vite serwuje public/ od korzenia.
  const url = new URL('../public/' + HULL_LACQUER_DEFAULTS.skyUrl, import.meta.url);
  assert.ok(existsSync(url), `brak pliku ${HULL_LACQUER_DEFAULTS.skyUrl}`);
});

// Kadłub testowy: prostokąt 96×32 w obrazie 128×64 (y obrazu rośnie w dół).
const W = 128;
const H = 64;
function hullAlpha() {
  const alpha = new Float32Array(W * H);
  for (let y = 16; y < 48; y++) for (let x = 16; x < 112; x++) alpha[y * W + x] = 1;
  return alpha;
}
function texel(field, x, y) {
  const i = (y * W + x) * 4;
  return { nx: field[i], ny: field[i + 1], mask: field[i + 2] };
}

test('boxBlur3 zachowuje sumę i jest symetryczne', () => {
  const src = new Float32Array(W * H);
  src[32 * W + 64] = 1;
  const out = boxBlur3(src, W, H, 4);
  const sum = out.reduce((acc, v) => acc + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-4, `suma ${sum}`);
  assert.ok(Math.abs(out[32 * W + 60] - out[32 * W + 68]) < 1e-6);
  assert.ok(Math.abs(out[28 * W + 64] - out[36 * W + 64]) < 1e-6);
});

test('mapa kształtu: normalne celują na zewnątrz kadłuba, y w górę obrazu', () => {
  const field = bakeHullShapeField(hullAlpha(), W, H);
  const left = texel(field, 18, 32);
  const right = texel(field, 109, 32);
  const top = texel(field, 64, 18);
  const bottom = texel(field, 64, 45);
  assert.ok(left.nx < -0.2, `lewa krawędź nx=${left.nx}`);
  assert.ok(right.nx > 0.2, `prawa krawędź nx=${right.nx}`);
  // Konwencja „poduszki” z hexShips3D: góra obrazu = +y normalnej.
  assert.ok(top.ny > 0.2, `górna krawędź ny=${top.ny}`);
  assert.ok(bottom.ny < -0.2, `dolna krawędź ny=${bottom.ny}`);
  // Nachylenie przekroju ograniczone — długość xy < sin(60°).
  for (const t of [left, right, top, bottom]) assert.ok(Math.hypot(t.nx, t.ny) < 0.87);
});

test('mapa kształtu: waga lakieru gaśnie przy sylwetce (bez obwódki), wewnątrz pełna', () => {
  const field = bakeHullShapeField(hullAlpha(), W, H);
  assert.ok(texel(field, 64, 32).mask > 0.99, 'środek kadłuba');
  assert.ok(texel(field, 16, 32).mask < 0.35, `teksel na sylwetce mask=${texel(field, 16, 32).mask}`);
  assert.equal(texel(field, 4, 4).mask, 0, 'poza kadłubem');
});

test('strefy silników: przestrzeń świateł (offset + środek + pivot), wsunięte wzdłuż forward', () => {
  const grid = { srcWidth: 400, srcHeight: 200, pivot: { x: 10, y: -4 } };
  const main = [
    { offset: { x: -180, y: -40 }, forward: { x: 1, y: 0 } },
    { offset: { x: -180, y: 40 }, forward: { x: 1, y: 0 } }
  ];
  const side = [{ offset: { x: 60, y: -95 }, forward: { x: 0, y: 1 } }];
  const zones = computeEngineZones(main, side, grid, { engineZoneMul: 1 });
  assert.equal(zones.length, 3);
  const [a, b, c] = zones;
  // Odstęp dysz głównych 80 → promień 40, ale sufit 9% z 200 = 18.
  assert.ok(Math.abs(a.r - 18) < 1e-6, `r=${a.r}`);
  // x = -180 + 200 + 10 = 30, wsunięte o 0,4 r w +x.
  assert.ok(Math.abs(a.x - (30 + 0.4 * 18)) < 1e-6, `x=${a.x}`);
  assert.ok(Math.abs(a.y - (-40 + 100 - 4)) < 1e-6, `y=${a.y}`);
  assert.ok(b.y > a.y);
  // Boczna dysza wsunięta w +y (do środka kadłuba).
  assert.ok(c.y > -95 + 100 - 4);
  assert.ok(c.r >= 200 * 0.02 && c.r <= 200 * 0.09);
});

test('strefy silników: limit, mnożnik 0 i brak danych', () => {
  const grid = { srcWidth: 1000, srcHeight: 500 };
  const many = Array.from({ length: 40 }, (_, i) => ({ offset: { x: -400, y: -200 + i * 10 }, forward: { x: 1, y: 0 } }));
  assert.equal(computeEngineZones(many, null, grid, {}).length, MAX_ENGINE_ZONES);
  assert.equal(computeEngineZones(many, null, grid, { engineZoneMul: 0 }).length, 0);
  assert.equal(computeEngineZones(null, undefined, grid, {}).length, 0);
  assert.equal(computeEngineZones([{ offset: { x: NaN, y: 0 } }], null, grid, {}).length, 0);
});

test('otoczenie: RGB z mgławicy, gwiazdy tylko w alfie i deterministyczne', () => {
  const size = 64;
  const src = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < src.length; i += 4) { src[i] = 10; src[i + 1] = 20; src[i + 2] = 30; src[i + 3] = 255; }
  const a = buildLacquerEnvPixels(src, size, { starCount: 40 });
  const b = buildLacquerEnvPixels(src, size, { starCount: 40 });
  assert.deepEqual(a, b);
  let stars = 0;
  for (let i = 0; i < a.length; i += 4) {
    assert.equal(a[i], 10);
    assert.equal(a[i + 1], 20);
    assert.equal(a[i + 2], 30);
    if (a[i + 3] > 0) stars++;
  }
  assert.ok(stars > 0, 'są gwiazdy');
  const empty = buildLacquerEnvPixels(null, size, { starCount: 0 });
  for (let i = 3; i < empty.length; i += 4) assert.equal(empty[i], 0);
});
