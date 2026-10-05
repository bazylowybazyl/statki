import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { RECIPES } from '../src/3d/weapons/recipes.js';
import { RECIPES as DEMO_RECIPES } from '../dema/bronie-webgpu/recipes.js';
import { WEAPON_FX } from '../src/3d/weapons/weaponFxTable.js';
import { continuousBeamState, continuousBeamAngle } from '../src/game/continuousBeam.js';
import { SimClock } from '../src/game/simClock.js';
import { loadIndexFunction, readIndexHtml } from './helpers/indexSource.mjs';
import { createBeamHarness, makeCircleTarget } from './helpers/beamShotHarness.mjs';

const weapon = MASTER_WEAPONS.beam_continuous;

test('smuga jest wyborem receptury jak w demie; lekka broń nie dostaje trwałego śladu', () => {
  for (const [id, entry] of Object.entries(WEAPON_FX)) {
    const def = MASTER_WEAPONS[id];
    if (def.category === 'beam') continue;
    const demo = DEMO_RECIPES[entry.fx].projectile({ def });
    const game = RECIPES[entry.fx].projectile(def.size);
    assert.equal(game.trail >= 0, !!demo.trailOpts, id);
  }
});

test('pierwszy krok pocisku 3D nie emituje smugi 2D; wymuszona kanwa zachowuje ślad', () => {
  let particles = 0;
  const scope = {
    WeaponFx: { available: true },
    CanvasVFX: { spawnParticleXY() { particles++; } },
    fxRandom: { next: () => 0.5 }
  };
  const spawn = loadIndexFunction(readIndexHtml(), 'function spawnBulletTrail(', 'spawnBulletTrail', scope);
  const bullet = { x: 0, y: 0, vx: 100, vy: 0, type: 'autocannon' };
  spawn(bullet, 2, 1 / 60);
  assert.equal(particles, 0, 'jeszcze bez __renderedByThree');
  bullet.forceCanvas = true;
  spawn(bullet, 2, 1 / 60);
  assert.equal(particles, 2);
  bullet.forceCanvas = false;
  scope.WeaponFx.available = false;
  spawn(bullet, 2, 1 / 60);
  assert.equal(particles, 4, 'zapas kanwy');
});

test('wiązka: 2,6 s ognia, 1,1 s przerwy, oddzielne emitery i ponowne naciśnięcie', () => {
  const shooter = {};
  let state;
  for (let i = 0; i <= 80; i++) {
    const time = i * 0.05;
    state = continuousBeamState(shooter, 'a', weapon, time);
    assert.equal(state.firing, time < 2.6 || time >= 3.7, `t=${time}`);
  }
  const held = continuousBeamState(shooter, 'a', weapon, 4);
  assert.equal(held, state, 'pauza nie tworzy stanu ani nie przesuwa cyklu');
  assert.equal(continuousBeamState(shooter, 'b', weapon, 4).start, 4);
  assert.equal(continuousBeamState(shooter, 'a', weapon, 4.5).start, 4.5, 'nowa seria po puszczeniu spustu');
  assert.equal(continuousBeamState(shooter, 'a', weapon, 0).start, 0, 'reset zegara nowej gry');
});

test('przerwa wiązki w fireWeaponCore nie zadaje obrażeń i nie wysyła wizualnego strzału', () => {
  const previous = SimClock.sim;
  const h = createBeamHarness();
  const shooter = { id: 'beam-feel', x: 0, y: 0, angle: 0 };
  const target = makeCircleTarget('cel', { x: 300, y: 0, radius: 40 });
  h.world.npcs.push(target);
  const muzzle = { pos: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, emitterUid: 'main' };
  try {
    for (let i = 0; i <= 74; i++) {
      SimClock.sim = i * 0.05;
      const log = h.fire(shooter, target, weapon.id, muzzle);
      const firing = SimClock.sim < 2.6 || SimClock.sim >= 3.7;
      assert.equal(log.some(e => e[0] === 'event'), firing, `strzał t=${SimClock.sim}`);
      assert.equal(log.some(e => e[0] === 'dmgNpc'), firing, `obrażenia t=${SimClock.sim}`);
    }
  } finally { SimClock.sim = previous; }
});

test('powolne cięcie po burcie: bez skoku na początku, ograniczony kąt, ręczny kursor bez dryfu', () => {
  const state = continuousBeamState({}, 'sweep', weapon, 0);
  const target = { radius: 300, w: 1200, angle: Math.PI / 2 };
  assert.equal(continuousBeamAngle(state, 0, 0, 0, 0, target, 1000, 0), 0);
  const values = Array.from({ length: 120 }, (_, i) => continuousBeamAngle(state, 0, i / 60, 0, 0, target, 1000, 0));
  assert.ok(Math.max(...values) - Math.min(...values) > 0.003);
  for (let i = 1; i < values.length; i++) assert.ok(Math.abs(values[i] - values[i - 1]) < 0.001);
  assert.ok(values.every(v => Math.abs(v) <= 0.031));
  target.angle = 0;
  assert.notEqual(continuousBeamAngle(state, 0, 2, 0, 0, target, 1000, 0), 0, 'cięcie także patrząc wzdłuż kadłuba');
  assert.equal(continuousBeamAngle(state, 0.7, 2, 0, 0, null, 1000, 0), 0.7);
});
