import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stepDecay120, ticksAt120, REF_STEP_DT } from '../src/game/stepDecay.js';

// Krok fizyki przełączany ?physHz (domyślnie 120 Hz). Stałe strojone „na krok
// 1/120 s” muszą dawać ten sam przebieg w czasie rzeczywistym przy 60/240 Hz,
// a przy 120 Hz — dokładnie te same wartości co przed przełącznikiem.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('stepDecay120: przy kroku 1/120 s współczynnik bez zmian (bit w bit)', () => {
  assert.equal(REF_STEP_DT, 1 / 120);
  for (const k of [0.991, 0.99, 0.995, 1, 0.5]) assert.equal(stepDecay120(k, 1 / 120), k);
});

test('stepDecay120: ten sam zanik na sekundę przy 60 i 240 Hz', () => {
  const k = 0.991;
  const perSecond = Math.pow(k, 120);
  let v60 = 1;
  for (let i = 0; i < 60; i++) v60 *= stepDecay120(k, 1 / 60);
  let v240 = 1;
  for (let i = 0; i < 240; i++) v240 *= stepDecay120(k, 1 / 240);
  assert.ok(Math.abs(v60 - perSecond) < 1e-12, `${v60} vs ${perSecond}`);
  assert.ok(Math.abs(v240 - perSecond) < 1e-12, `${v240} vs ${perSecond}`);
});

test('ticksAt120: ten sam czas w krokach innej długości, przy 1/120 s wartość bez obróbki', () => {
  assert.equal(ticksAt120(12, 1 / 120), 12);
  assert.equal(ticksAt120(8.5, 1 / 120), 8.5);
  assert.equal(ticksAt120(12, 1 / 60), 6);
  assert.equal(ticksAt120(12, 1 / 240), 24);
  assert.equal(ticksAt120(1, 1 / 60), 1, 'co najmniej jeden krok');
});

test('index.html: ?physHz z białej listy, domyślnie 120, worker v2 zostaje przy 120', () => {
  const html = read('index.html');
  assert.match(html, /const PHYS_HZ_DEFAULT = 120;/);
  assert.match(html, /const PHYS_HZ_ALLOWED = \[60, 90, 120, 240\];/);
  assert.match(html, /const PHYS_HZ = resolvePhysicsHz\(\);/);
  assert.match(html, /requested !== PHYS_HZ_DEFAULT && DevFlags\.workerPhysicsV2/);
  assert.match(html, /PerfHUD\.setPhysicsHz\(PHYS_HZ\);/);
  assert.match(html, /new FixedStepCadence\(PHYS_HZ, AI_DECISION_TARGET_HZ\)/, 'mózg AI zostaje przy 20 Hz');
});

test('tarcie „na krok” w fizyce przeliczane przez stepDecay120', () => {
  const html = read('index.html');
  assert.match(html, /const drag = stepDecay120\(0\.991, dt\);/, 'latające odłamki');
  assert.match(html, /const wreckFriction = stepDecay120\(w\.friction, dt\);/, 'wraki');
  assert.match(html, /const npcDrag = stepDecay120\(npc\.friction \|\| 0\.99, dt\);/, 'NPC bez modelu lotu');
  assert.match(html, /const friction = stepDecay120\(npc\.friction \|\| 1\.0, dt\);/, 'NPC — fizyka pędu');
  assert.doesNotMatch(html, /w\.vx \*= w\.friction;/);
});

test('destruktor: liczniki splitów w krokach przeliczane na czas przy innym kroku', () => {
  const src = read('src/game/destructor.js');
  assert.match(src, /const splitInterval = ticksAt120\(Math\.max\(1, DESTRUCTOR_CONFIG\.splitCheckInterval \| 0\), step\);/);
  assert.match(src, /const deferTicks = ticksAt120\(/);
});
