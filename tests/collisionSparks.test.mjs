import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Iskry tarcia (src/vfx/collisionSparks.js): budżet to TEMPO z prędkości styku,
// nie liczba na wywołanie z impulsu. Audyt 2026-09-26: taran 300 j./s na
// kadłubach belkowych sypał ~6 400 iskier/s (impuls ~10⁵–10⁶ nasycał skalę
// przy każdym dotyku) i zalewał zgniot bielą pod bloomem overlaya.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { CollisionFX } = await import('../src/vfx/collisionFx.js');
const { SparkSystem3D } = await import('../src/3d/sparkSystem3D.js');
const {
  COLLISION_SPARKS_TUNE: T,
  grindSparkBudget,
  grindSparkRate,
  impactSparkCount
} = await import('../src/vfx/collisionSparks.js');

function grind(A, B, simTime, approachSpeed, slideSpeed, bounceForce = 0) {
  return { A, B, simTime, approachSpeed, slideSpeed, bounceForce };
}

// Kontakt pary przez `seconds` przy kroku 1/hz; `callsPerStep` wywołań na krok
// (silnik belek potrafi zgłosić parę dwa razy w jednym kroku).
function sparksOver(seconds, hz, callsPerStep, approach, slide, bounceForce = 0) {
  const A = {}, B = {};
  let total = 0;
  const steps = Math.round(seconds * hz);
  const prevHz = window.PHYS_HZ;
  window.PHYS_HZ = hz;    // gra wystawia krok fizyki (`?physHz`)
  try {
    for (let k = 1; k <= steps; k++) {
      for (let c = 0; c < callsPerStep; c++) total += grindSparkBudget(grind(A, B, k / hz, approach, slide, bounceForce));
    }
  } finally {
    window.PHYS_HZ = prevHz;
  }
  return total;
}

test('tempo iskier rośnie z prędkością styku i ma sufit', () => {
  assert.equal(grindSparkRate(0, 0), 0);
  assert.equal(grindSparkRate(T.speedMin * 0.5, 0), 0, 'docisk poniżej progu nie iskrzy');
  const mid = grindSparkRate(60, 40);
  assert.ok(mid > 0 && mid < T.ratePerSec);
  assert.equal(grindSparkRate(T.speedFull, 0), T.ratePerSec);
  assert.equal(grindSparkRate(5000, 5000), T.ratePerSec, 'szybszy taran nie przebija sufitu');
  assert.equal(grindSparkRate(0, -120), grindSparkRate(0, 120), 'znak poślizgu bez znaczenia');
});

test('budżet = tempo × czas: sekunda styku daje ~tempo, niezależnie od wywołań na krok', () => {
  const single = sparksOver(1, 120, 1, 300, 0);
  const double = sparksOver(1, 120, 2, 300, 0);
  assert.ok(Math.abs(single - T.ratePerSec) <= 2, `sekunda pełnego tarcia: ${single} vs ${T.ratePerSec}`);
  assert.ok(Math.abs(double - single) <= 1, `drugie wywołanie w tym samym kroku nie dokłada iskier (${double} vs ${single})`);
});

test('budżet nie zależy od kroku fizyki (PHYS_HZ 60 / 120 / 240)', () => {
  const at60 = sparksOver(1, 60, 1, 150, 30);
  const at120 = sparksOver(1, 120, 1, 150, 30);
  const at240 = sparksOver(1, 240, 1, 150, 30);
  assert.ok(Math.abs(at60 - at120) <= 2, `${at60} vs ${at120}`);
  assert.ok(Math.abs(at240 - at120) <= 2, `${at240} vs ${at120}`);
});

test('impuls kadłuba (masa × prędkość) nie steruje iskrami — tylko prędkość styku', () => {
  const slowHeavy = sparksOver(1, 120, 1, 3, 0, 3e6);
  assert.equal(slowHeavy, 0, 'pchanie 3 j./s ciężkim kadłubem nie sypie iskrami');
  const light = sparksOver(1, 120, 1, 120, 0, 10);
  const heavy = sparksOver(1, 120, 1, 120, 0, 3e6);
  assert.ok(Math.abs(light - heavy) <= 2, `ten sam styk, inny impuls: ${light} vs ${heavy}`);
});

test('snop uderzenia: rośnie z prędkością zbliżania, ma sufit', () => {
  assert.equal(impactSparkCount(0), 0);
  assert.ok(impactSparkCount(60) > 0 && impactSparkCount(60) < impactSparkCount(300));
  assert.equal(impactSparkCount(T.impactSpeedFull), T.impactSparks);
  assert.equal(impactSparkCount(5000), T.impactSparks, 'szybszy taran nie przebija sufitu');
});

test('przerwa w styku nie nadrabia budżetu (nowy styk = jeden krok)', () => {
  const A = {}, B = {};
  grindSparkBudget(grind(A, B, 1.0, 300, 0));
  const afterGap = grindSparkBudget(grind(A, B, 6.0, 300, 0));
  assert.ok(afterGap <= Math.ceil(T.ratePerSec / 120), `po 5 s przerwy: ${afterGap}`);
});

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

test('taran na kadłubach belkowych: iskry w limicie tempa, z jasnością tarcia', () => {
  const emitted = [];
  const fake = {
    isInitialized: true,
    grindingSeam(points, pointCount, tx, ty, approach, slide, bvx, bvy, count, gain) { emitted.push({ count, gain }); },
    grindingBurst(x, y, nx, ny, tx, ty, approach, slide, bvx, bvy, count, gain) { emitted.push({ count, gain }); }
  };
  let impacts = 0;
  const onImpact = () => { impacts++; };
  CollisionFX.on('impact', onImpact);
  const prev = window.SparkSystem3D;
  window.SparkSystem3D = fake;
  const a = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, x: 0, y: 0, angle: 0, angVel: 0, mass: 800000, isPlayer: true };
  const b = { x: 904, y: 0, vx: -300, vy: 0, angle: 0, angVel: 0, mass: 200000 };
  HullBodies.createHull(a, plate(1200, 360));
  HullBodies.createHull(b, plate(600, 200));
  let grinds = 0;
  const onGrind = () => { grinds++; };
  CollisionFX.on('grind', onGrind);
  try {
    const dt = 1 / 120;
    for (let k = 0; k < 120; k++) {
      for (const e of [a, b, ...window.wrecks]) {
        if (e.pos) { e.pos.x += e.vel.x * dt; e.pos.y += e.vel.y * dt; e.x = e.pos.x; e.y = e.pos.y; }
        else { e.x += e.vx * dt; e.y += e.vy * dt; }
        e.angle += (e.angVel || 0) * dt;
      }
      HullBodies.step(dt, [a, b, ...window.wrecks]);
    }
  } finally {
    CollisionFX.off('grind', onGrind);
    CollisionFX.off('impact', onImpact);
    window.SparkSystem3D = prev;
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
    HullBodies.release(a);
    HullBodies.release(b);
  }
  const total = emitted.reduce((s, e) => s + e.count, 0);
  const ceiling = T.ratePerSec * 1.05 + impacts * T.impactSparks;
  assert.ok(grinds > 20, `para musi się trzeć (${grinds} zdarzeń)`);
  assert.ok(impacts >= 1, 'taran 300 j./s to uderzenie');
  assert.ok(total >= impactSparkCount(300), `chwila zderzenia ma swój snop (${total})`);
  assert.ok(total <= ceiling, `sekunda taranu: ${total} iskier (sufit ${ceiling}; dawniej ~6 400)`);
  assert.ok(emitted.every((e) => e.gain === T.gain), 'iskry tarcia mają jasność tarcia');
});

test('SparkSystem3D: jasność iskry idzie atrybutem instancji (domyślnie 1)', () => {
  const scene = new THREE.Scene();
  SparkSystem3D.init(scene);
  try {
    SparkSystem3D.emit(0, 0, 10, 0, 0.3, 0.4);
    SparkSystem3D.emit(0, 0, 10, 0, 0.3, 0.4, 0.5);
    SparkSystem3D.emit(0, 0, 10, 0, 0.3, 0.4, -2);
    const gains = scene.children.find((o) => o.geometry?.attributes?.iGain)?.geometry.attributes.iGain.array;
    assert.ok(gains, 'atrybut iGain w siatce iskier');
    assert.deepEqual(Array.from(gains.subarray(0, 3)), [1, 0.5, 0]);
    assert.ok(T.gain > 0 && T.gain < 1, 'iskra tarcia ciemniejsza od iskry trafienia');
  } finally {
    SparkSystem3D.dispose();
  }
});
