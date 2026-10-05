// Smugi pocisków (2026-10-04): (1) węzeł wspólny dwóch segmentów ma tę samą pozycję i drogę wzoru,
// a węzły leżą co `spacing` j. — także przez granicę klatek (wcześniej odstępy 2–36 j. i skok drogi
// ~0,2 na złączu każdej klatki: szum i włókna zaczynały się od nowa, smuga rozpadała się na skośne
// kreski); (2) smugę zostawiają tylko pociski z TRAIL_FAMILIES; (3) drugi zakres wysyłki nie wysyła
// przestarzałej kopii CPU (dane smug przesuwa kernel na GPU).
// node --test tests/weaponTrailContinuity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { TrailSystem, TRAIL, TRAIL_CAP } from '../src/3d/weapons/trails.js';
import { TRAIL_FAMILIES, WEAPON_FX } from '../src/3d/weapons/weaponFxTable.js';
import { liveRangeAttribute, markRange } from '../src/3d/weapons/liveRange.js';
import { FxPoolOrigin } from '../src/3d/fx/gpuPoolOrigin.js';
import { CLOCK_SIM } from '../src/game/simClock.js';

const SEG = 20; // liczb na segment (5 × vec4)
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function trailRun(steps, spacing = 36, pathUnit = 170) {
  const origin = new FxPoolOrigin({ name: 'tstTrail' });
  origin.update(0, 0, 0, 0, 0);
  const tr = new TrailSystem({ noise: new THREE.DataTexture(new Uint8Array(4), 1, 1), origin });
  tr.time = 0;
  const h = tr.begin(TRAIL.tempest, 0, 0, 1, 0, 7, spacing, pathUnit, 0, 0, 0, CLOCK_SIM);
  let x = 0;
  steps.forEach((s, f) => { x += s; tr.time = (f + 1) / 60; tr.advance(h, x, 0, (f + 1) / 60); });
  return { tr, x };
}

test('smuga: węzły co spacing j. i wspólny węzeł segmentów bez skoku drogi — przez granice klatek', () => {
  // Kroki na klatkę mniejsze, równe i większe od odstępu węzłów (bitwa: 8000 j/s ≈ 133 j. na klatkę).
  const steps = [20, 7, 70, 133, 36, 5, 5, 5, 90, 250, 13];
  const { tr, x } = trailRun(steps);
  const D = tr.data;
  const n = tr.head;
  assert.equal(n, Math.floor(x / 36), 'jeden segment na każde pełne 36 j. drogi');
  for (let k = 0; k < n; k++) {
    const o = k * SEG;
    assert.ok(Math.abs((D[o + 4] - D[o]) - 36) < 1e-3, `segment ${k}: długość ${D[o + 4] - D[o]}`);
    assert.ok(Math.abs((D[o + 13] - D[o + 12]) - 36 / 170) < 1e-5, `segment ${k}: przyrost drogi`);
    if (k + 1 < n) {
      const p = (k + 1) * SEG;
      assert.equal(D[p], D[o + 4], `złącze ${k}: pozycja x`);
      assert.equal(D[p + 3], D[o + 7], `złącze ${k}: narodziny (zegar efektów)`);
      assert.equal(D[p + 12], D[o + 13], `złącze ${k}: droga wzoru`);
    }
  }
});

test('smuga: domknięcie (end) startuje z ostatniego węzła z jego drogą', () => {
  const origin = new FxPoolOrigin({ name: 'tstTrailEnd' });
  origin.update(0, 0, 0, 0, 0);
  const t2 = new TrailSystem({ noise: new THREE.DataTexture(new Uint8Array(4), 1, 1), origin });
  const g = t2.begin(TRAIL.hexlance, 0, 0, 1, 0, 90, 120, 660, 0, 0, 0, CLOCK_SIM);
  t2.time = 1 / 60;
  t2.advance(g, 300, 0, 1 / 60);
  t2.end(g, 330, 0, 1 / 60);
  const D = t2.data;
  const last = (t2.head - 1) * SEG;
  const prev = last - SEG;
  assert.equal(D[last], D[prev + 4], 'odcinek domknięcia zaczyna się w ostatnim węźle');
  assert.equal(D[last + 12], D[prev + 13], 'z drogą ostatniego węzła');
  assert.ok(Math.abs(D[last + 4] - 330) < 1e-9);
});

test('smugę zostawiają tylko pociski ładowanych superbroni (Hexlance, Mjolnir)', () => {
  assert.deepEqual([...TRAIL_FAMILIES].sort(), ['hexlance', 'mjolnir']);
  assert.equal(WEAPON_FX.hexlance_siege.fx, 'hexlance');
  assert.equal(WEAPON_FX.siege_railgun.fx, 'mjolnir');
  // Bramka w jednym miejscu: konfiguracja pocisku (cache na rodzinę i rozmiar) w WeaponFx.
  const src = read('src/3d/weapons/weaponFx.js');
  assert.match(src, /c = r\?\.projectile \? r\.projectile\(size\) : RECIPES\.vulcan\.projectile\(size\);\n[^\n]*\n {4}if \(!TRAIL_FAMILIES\.has\(family\)\) c\.trail = -1;/);
  assert.match(src, /if \(conf\.trail >= 0 && this\._inView\(x, y, 2000\)\)/, 'pocisk bez smugi nie zakłada uchwytu');
});

test('zakresy wysyłki: drugi, nieużywany zakres powtarza pierwszy (bez przestarzałej kopii CPU)', () => {
  const attr = new THREE.StorageBufferAttribute(new Float32Array(TRAIL_CAP * SEG), 4);
  liveRangeAttribute(attr);
  markRange(attr, 400, 80);
  assert.equal(attr.updateRanges.length, 2);
  assert.deepEqual(attr.updateRanges.map((r) => [r.start, r.count]), [[400, 80], [400, 80]]);
  // Pierścień zawinięty: oba zakresy prawdziwe.
  markRange(attr, 1000, 40, 0, 20);
  assert.deepEqual(attr.updateRanges.map((r) => [r.start, r.count]), [[1000, 40], [0, 20]]);
  // Tylko drugi zakres: przechodzi na pierwszy, drugi go powtarza.
  markRange(attr, 0, 0, 60, 8);
  assert.deepEqual(attr.updateRanges.map((r) => [r.start, r.count]), [[60, 8], [60, 8]]);
});
