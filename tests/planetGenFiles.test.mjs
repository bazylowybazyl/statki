// Planeta jako pliki map (src/3d/planetGen/planetGenFiles.js): kodeki wysokości, pakowanie, opis plików, wpięcie
// w wypiekacz. Zapis i wczytanie w przeglądarce sprawdza narzędzie scripts/webgpu/planeta-wypal.mjs + demo `?plik=`.
// node --test tests/planetGenFiles.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLANET_FILES_FORMAT, HEIGHT_STEP_KM, PLANET_FILE_MAPS, quantizeHeight, halfToFloat, deltaEncode16, deltaDecode16,
  gzipBytes, gunzipBytes, maybeGunzip, checkPlanetMeta
} from '../src/3d/planetGen/planetGenFiles.js';

const src = (f) => readFileSync(new URL(`../src/3d/planetGen/${f}`, import.meta.url), 'utf8');

test('wysokość: krok 0,5 m, zakres ±16 km, połówki czytane poprawnie', () => {
  assert.equal(HEIGHT_STEP_KM, 0.0005);
  assert.equal(quantizeHeight(0), 0);
  assert.equal(quantizeHeight(1.2345), 2469);
  assert.equal(quantizeHeight(-6.2), -12400);
  assert.equal(quantizeHeight(99), 32767);
  assert.equal(quantizeHeight(-99), -32768);
  for (const km of [-8.4, -0.1, 0.0003, 0.42, 3.7, 8.5]) assert.ok(Math.abs(quantizeHeight(km) * HEIGHT_STEP_KM - km) <= HEIGHT_STEP_KM / 2 + 1e-12);
  // połówki: 1,0 = 0x3C00, −2,0 = 0xC000, 0,5 = 0x3800, najmniejsza zdenormalizowana, zero
  assert.equal(halfToFloat(0x3C00), 1);
  assert.equal(halfToFloat(0xC000), -2);
  assert.equal(halfToFloat(0x3800), 0.5);
  assert.equal(halfToFloat(0x0001), Math.pow(2, -24));
  assert.equal(halfToFloat(0x0000), 0);
});

test('kodek różnicowy Int16: odwracalny (także skoki przez zakres), gładki teren pakuje się dobrze', async () => {
  const W = 512;
  const H = 256;
  const a = new Int16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = Math.round(4000 * Math.sin(x / 40) * Math.cos(y / 31) + 300 * Math.sin(x * y / 900));
  a[5] = 32767; a[6] = -32768; a[7] = 32767; a[W * 3] = -32768;
  const enc = deltaEncode16(a, W, H);
  assert.equal(enc.length, W * H * 2);
  assert.deepEqual(deltaDecode16(enc, W, H), a);
  assert.throws(() => deltaDecode16(enc.subarray(1), W, H), /wysokość ma/);
  // pakowanie: gzip w obie strony; różnice pakują się lepiej niż surowe liczby
  const packed = await gzipBytes(enc);
  assert.deepEqual(await gunzipBytes(packed), enc);
  const raw = await gzipBytes(new Uint8Array(a.buffer));
  assert.ok(packed.length < raw.length, `różnice ${packed.length} B, surowe ${raw.length} B`);
});

test('pliki .bin: gzip rozpoznany po pierwszych bajtach, dane już rozpakowane przez serwer przechodzą bez zmian', async () => {
  const data = new Uint8Array(4096).map((_, i) => (i * 7) & 255);
  const packed = await gzipBytes(data);
  assert.equal(packed[0], 0x1F);
  assert.equal(packed[1], 0x8B);
  assert.deepEqual(await maybeGunzip(packed), data);
  assert.deepEqual(await maybeGunzip(data), data);
  // rozszerzenie nie może być .gz: serwer (Vite w dev) podaje takie pliki z Content-Encoding: gzip
  const code = src('planetGenFiles.js');
  assert.ok(!/'[a-z0-9.]+\.gz'/.test(code), 'żaden plik planety nie ma rozszerzenia .gz');
  assert.match(code, /'height\.i16\.bin'/);
});

test('opis plików: format, komplet pól, mapy stratne i bezstratne', () => {
  const ok = { format: PLANET_FILES_FORMAT, size: 4096, spec: { type: 'terran' }, levels: { uQ: [0, 0, 0, 0] }, maps: { day: { file: 'day.webp' } }, height: { file: 'height.i16.bin' } };
  assert.equal(checkPlanetMeta(ok), ok);
  assert.throws(() => checkPlanetMeta({ ...ok, format: 99 }), /nieznany format/);
  assert.throws(() => checkPlanetMeta({ ...ok, height: null }), /niepełny opis/);
  assert.throws(() => checkPlanetMeta(null), /nieznany format/);
  // maski i połysk bezstratnie (progi w materiałach), obrazy (dzień, noc, chmury) stratnie z wysoką jakością
  assert.equal(PLANET_FILE_MAPS.mask.type, 'image/png');
  assert.equal(PLANET_FILE_MAPS.spec.type, 'image/png');
  for (const k of ['day', 'night', 'clouds']) { assert.equal(PLANET_FILE_MAPS[k].type, 'image/webp'); assert.ok(PLANET_FILE_MAPS[k].quality >= 0.9); }
});

test('wypiekacz: planeta z plików ma kształt wyniku wypieku, rzeźba z tego samego grafu', () => {
  const baker = src('planetGenBaker.js');
  assert.match(baker, /importPlanet\(pack\)/);
  // mapa rzeźby: wysokość do celu pola, potem graf rzeźby jak w wypieku (nie osobny wzór na nachylenia)
  assert.match(baker, /this\._draw\('copyH', this\.field/);
  assert.match(baker, /this\._draw\('relief', relief, \{/);
  // wynik niesie to, czego potrzebują okna pod kamerą: poziomy z próby i siatkę spływu
  assert.match(baker, /out = \{ spec, size: W, maps: \{\}, targets: \[\], rt: \{\}, levels,/);
  assert.match(baker, /out\.drainage = \{ \.\.\.pack\.drainage, texture \}/);
  const bake = src('planetGenBake.tsl.js');
  // przepisanie bajtów sRGB do celu sRGB przez krzywą odwrotną; alfa z osobnego obrazu
  assert.match(bake, /export function buildCopyGraph\(\)/);
  assert.match(bake, /pow\(a\.rgb\.add\(0\.055\)\.div\(1\.055\), vec3\(2\.4\)\)/);
  assert.match(bake, /export function buildHeightCopyGraph\(\)/);
  // wczytanie: obrazy bez premultiplikacji i bez konwersji barw, wiersz 0 = wiersz 0 celu
  const files = src('planetGenFiles.js');
  assert.match(files, /premultiplyAlpha: 'none', colorSpaceConversion: 'none'/);
  assert.match(files, /t\.flipY = false/);
});
