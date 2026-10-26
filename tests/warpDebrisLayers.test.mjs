// HIERARCHIA WARSTW W0 (DECYZJE-2, 2026-10-26; krytyk § 1): na ekranie tempo przesuwu rośnie z bliskością —
// niebo ≤ gwiazdy deep < gwiazdy mid < SKAŁY W WARPIE < gwiazdy speed / pył. Skały pasa w skoku (warpDebris.js) płyną
// z flowCap · q (q z prawdziwej prędkości kamery), gwiazdy gry — z kamerą gwiazd ograniczoną w warpie do STAR_SPEED_CAP
// (warpNurt.js) × paralaksa warstwy (starParallax.js). Obie strony skalują się zoomem tak samo (głębokość skał
// w jednostkach camZ), więc kolejność sprawdza się w jednostkach paralaksy dla każdego q z zakresu.
// node --test tests/warpDebrisLayers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WARP_DEBRIS, warpDebrisFlowQ, warpDebrisLayerSpeeds } from '../src/3d/asteroids/warpDebris.js';
import { STAR_PARALLAX_LAYERS } from '../src/3d/starParallax.js';
import { WARP_DRIVES, HYPERCRUISE_ENGINES } from '../src/data/driveModes.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const layer = (name) => STAR_PARALLAX_LAYERS.find((l) => l.name === name);
const ZOOM_JUMP = 0.2133 * 0.55;   // kadr skoku 1080p (cameraRig: zoom odniesienia × warpZoomOut)

test('przepływ skał przy q = 1 = kamera gwiazd w warpie (jedna skala tempa obu warstw)', () => {
  const m = /const STAR_SPEED_CAP = (\d+);/.exec(read('src/3d/warp/warpNurt.js'));
  assert.ok(m, 'STAR_SPEED_CAP w warpNurt.js');
  assert.equal(Number(m[1]), WARP_DEBRIS.flowCap);
});

test('W0: gwiazdy mid < skały (każde pasmo) < gwiazdy speed dla każdego q z zakresu przepływu', () => {
  const mid = layer('mid');
  const speed = layer('speed');
  const deep = layer('deep');
  assert.ok(mid && speed && deep, 'warstwy gwiazd deep / mid / speed');
  for (let q = WARP_DEBRIS.flowMin; q <= 1 + 1e-9; q += 0.05) {
    const sp = warpDebrisLayerSpeeds(1, q, 1);   // jednostki paralaksy: px/s = flowCap · zoom · (q · k)
    const slowest = Math.min(...sp.map((b) => b.min));
    const fastest = Math.max(...sp.map((b) => b.max));
    assert.ok(slowest > mid.parallaxMax, `q ${q.toFixed(2)}: najwolniejsza skała ${slowest.toFixed(3)} > gwiazdy mid ${mid.parallaxMax}`);
    assert.ok(fastest < speed.parallaxMin, `q ${q.toFixed(2)}: najszybsza skała ${fastest.toFixed(3)} < gwiazdy speed ${speed.parallaxMin}`);
    assert.ok(slowest > deep.parallaxMax, 'skały szybsze niż gwiazdy deep');
    // pasma uporządkowane: bliskie szybsze od środkowych, środkowe od dalekich (bez nakładania)
    for (let i = 1; i < sp.length; i++) assert.ok(sp[i - 1].min >= sp[i].max - 1e-9, `pasmo ${sp[i - 1].id} ≥ ${sp[i].id}`);
  }
});

test('W0 w liczbach (kadr skoku 1080p): walka i hipercruise Mk I–II bez warstwy, hipercruise Mk III i warp Mk I–III', () => {
  const cap = WARP_DEBRIS.flowCap;
  const px = (q) => warpDebrisLayerSpeeds(ZOOM_JUMP, q, cap);
  const stars = (l) => [cap * l.parallaxMin * ZOOM_JUMP, cap * l.parallaxMax * ZOOM_JUMP];
  const [midLo, midHi] = stars(layer('mid'));
  const [spdLo] = stars(layer('speed'));
  // Tryb skoku pasa: kamera > 30 tys. j/s (asteroidBelt.js: WARP_MODE_ON) — walka i hipercruise Mk I / II go nie włączają.
  const ON = 30000;
  assert.match(read('src/3d/asteroids/asteroidBelt.js'), /const WARP_MODE_ON = 30000;/);
  assert.ok(HYPERCRUISE_ENGINES.hypercruise_mk1.vmax <= ON && HYPERCRUISE_ENGINES.hypercruise_mk2.vmax <= ON, 'hipercruise Mk I–II: pole pasa');
  const cases = [
    ['hipercruise Mk III', HYPERCRUISE_ENGINES.hypercruise_mk3.vmax],
    ['warp Mk I (strefa pasa 0,8)', WARP_DRIVES.warp_mk1.speed * 0.8],
    ['warp Mk II (strefa pasa 0,8)', WARP_DRIVES.warp_mk2.speed * 0.8],
    ['warp Mk III (strefa pasa 0,8)', WARP_DRIVES.warp_mk3.speed * 0.8],
    ['mijana planeta (zwolnienie)', 36000]
  ];
  for (const [name, v] of cases) {
    const q = warpDebrisFlowQ(v);
    const sp = px(q);
    const lo = Math.min(...sp.map((b) => b.min));
    const hi = Math.max(...sp.map((b) => b.max));
    assert.ok(lo > midHi && hi < spdLo, `${name}: skały ${lo.toFixed(0)}–${hi.toFixed(0)} px/s, gwiazdy mid ≤ ${midHi.toFixed(0)}, speed ≥ ${spdLo.toFixed(0)}`);
  }
  // Liczby z raportu: q = 1 — skały 608–1576 px/s, q min — 334–867 px/s; gwiazdy mid 90–296, speed od 1675.
  const full = px(1);
  assert.ok(Math.abs(Math.min(...full.map((b) => b.min)) - 608) < 2 && Math.abs(Math.max(...full.map((b) => b.max)) - 1576) < 2);
  const slow = px(WARP_DEBRIS.flowMin);
  assert.ok(Math.abs(Math.min(...slow.map((b) => b.min)) - 334) < 2 && Math.abs(Math.max(...slow.map((b) => b.max)) - 867) < 2);
  assert.ok(Math.abs(midLo - 90) < 1 && Math.abs(midHi - 296) < 1 && Math.abs(spdLo - 1675) < 1);
});
