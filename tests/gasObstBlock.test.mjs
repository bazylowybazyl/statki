// RW-11c: blok migawki z przeszkodami gazu wybuchów (src/render/blocks/gasObstBlock.js). Strona renderu dostaje ten sam
// układ co GAS_OBST_IN gry, a reżyser wybuchów (explosionFx._applyObstacles) czyta z niego to samo co z tablicy gry:
// nagłówek, pudła i obrysy statyki (przy zmianie statVer) i kadłuby klatki — także po rotacji stron trójbufora,
// gdy liczba rekordów maleje (strona trzyma za licznikami resztki starszych stron).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { createGasObstBlock, gasObstInputOf, packGasObstBlock } from '../src/render/blocks/gasObstBlock.js';
import { GAS_HULL_REC, GAS_OBST_IN } from '../src/3d/gas/gasObstacleLayout.js';

const I = GAS_OBST_IN;
const HS = GAS_HULL_REC.stride;

// Wejście gry o zadanych licznikach; pola rekordów z ziarna (łatwo odróżnić klatki).
function input(serial, statVer, nb, nf, nh, seed) {
  const a = new Float64Array(I.size).fill(NaN);   // NaN poza rekordami — konsument nie może ich czytać
  a.fill(0, 0, I.header);
  a[I.serial] = serial; a[I.statVer] = statVer; a[I.boxes] = nb; a[I.foots] = nf; a[I.hulls] = nh; a[I.dropped] = 1;
  let s = seed;
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 * 2e4 - 1e4;
  for (let i = 0; i < nb * I.boxStride; i++) a[I.boxBase + i] = r();
  for (let i = 0; i < nf * HS; i++) a[I.footBase + i] = r();
  for (let i = 0; i < nh * HS; i++) a[I.hullBase + i] = r();
  return a;
}

// Odczyt konsumenta jak explosionFx._applyObstacles: liczniki i rekordy w ich zakresie.
function consume(IN) {
  const nb = Math.min(I.maxBoxes, IN[I.boxes] | 0), nf = Math.min(I.maxFoots, IN[I.foots] | 0);
  const nh = Math.min(I.maxHulls, IN[I.hulls] | 0);
  return {
    head: Array.from(IN.subarray(0, I.header)),
    boxes: Array.from(IN.subarray(I.boxBase, I.boxBase + nb * I.boxStride)),
    foots: Array.from(IN.subarray(I.footBase, I.footBase + nf * HS)),
    hulls: Array.from(IN.subarray(I.hullBase, I.hullBase + nh * HS))
  };
}

test('blok przeszkód gazu: strona renderu = wejście gry dla konsumenta, przez rotację stron i malejące liczniki', () => {
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createGasObstBlock());
  const frame = createSnapshotFrame();
  const frames = [
    input(1, 1, 40, 3, 12, 7), input(2, 1, 40, 3, 5, 8), input(3, 2, 6, 0, 0, 9),
    input(4, 2, 6, 0, 32, 10), input(5, 3, 1024, 24, 1, 11), input(6, 3, 0, 0, 0, 12)
  ];
  for (const g of frames) {
    packer.begin(frame);
    frame.gasObst = g;
    const page = packer.view;
    packer.finish(frame);
    const got = gasObstInputOf(page);
    assert.ok(got, `klatka ${g[I.serial]}: blok z wejściem`);
    assert.equal(got.length, I.size, 'ten sam układ co GAS_OBST_IN');
    assert.deepEqual(consume(got), consume(g), `klatka ${g[I.serial]}: odczyt konsumenta`);
  }
});

test('blok przeszkód gazu: bez wejścia (gra bez reżysera wybuchów) — null dla setObstacleInput', () => {
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createGasObstBlock());
  const frame = createSnapshotFrame();
  packer.begin(frame);
  frame.gasObst = input(9, 4, 3, 1, 2, 3);
  let page = packer.view;
  packer.finish(frame);
  assert.ok(gasObstInputOf(page));
  for (let k = 0; k < 4; k++) {      // każda strona trójbufora po kolei
    packer.begin(frame);
    frame.gasObst = null;
    page = packer.view;
    packer.finish(frame);
    assert.equal(gasObstInputOf(page), null, `strona ${k}: brak wejścia`);
  }
  assert.equal(gasObstInputOf(null), null);
  const dst = new Float64Array(I.size);
  packGasObstBlock(dst, new Float64Array(10));   // za krótka tablica — jak brak wejścia
  assert.equal(dst[I.serial], -1);
});

test('blok przeszkód gazu: wpięcie w grze (rejestracja przy migawce, wejście klatki w fazie finish)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /renderSnapshot\.addBlock\(createGasObstBlock\(\)\)/);
  assert.match(src, /function packRenderSnapshotFinish\(\) \{[\s\S]{0,600}f\.gasObst = window\.__explosions \? gasObstIn : null;/);
});
