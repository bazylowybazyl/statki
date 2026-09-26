import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

// rocketSystem3D's GPU particle classes build a gradient sprite via a 2D canvas
// in their constructors; stub just enough DOM for headless Node.
globalThis.window = globalThis.window ?? {};
globalThis.document = globalThis.document ?? {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: null,
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillRect: () => {}
    })
  })
};

const { initRocketSystem3D } = await import('../src/effects3d/rocketSystem3D.js');

const system = initRocketSystem3D(new THREE.Scene());

/**
 * Fire one rocket at a (possibly moving) mock NPC and step the system until the
 * rocket deactivates. Returns whether _onHit applied damage to that target.
 */
function flyRocket(weaponId, targetCfg, { dt = 1 / 60, maxT = 30 } = {}) {
  const weaponDef = MASTER_WEAPONS[weaponId];
  assert.ok(weaponDef, `weapon ${weaponId} exists`);

  const target = { radius: 40, dead: false, hp: 1e9, vx: 0, vy: 0, ...targetCfg };
  let damaged = false;
  window.applyDamageToNPC = (npc) => { if (npc === target) damaged = true; };

  system.fire(0, 0, target, weaponDef.baseDamage, weaponDef, 'blue');
  const rocket = system.rockets.find(r => r.active);
  assert.ok(rocket, 'rocket spawned');

  let minDist = Infinity;
  for (let t = 0; t < maxT && rocket.active; t += dt) {
    target.x += target.vx * dt;
    target.y += target.vy * dt;
    system.update(dt);
    minDist = Math.min(minDist, Math.hypot(target.x - rocket.position.x, target.y - rocket.position.z));
  }
  return { damaged, expired: rocket.active, minDist: Math.round(minDist) };
}

function assertAllHit(weaponId, mkTarget, opts, label) {
  const launches = 5;
  for (let i = 0; i < launches; i++) {
    const res = flyRocket(weaponId, mkTarget(), opts);
    assert.ok(
      res.damaged,
      `${label}: launch ${i + 1}/${launches} missed (closest approach ${res.minDist}u)`
    );
  }
}

test('cruise missile hits a stationary target', () => {
  assertAllHit('missile_rack', () => ({ x: 5000, y: 0 }), {}, 'cruise vs stationary');
});

test('cruise missile hits a crossing target (300 u/s)', () => {
  assertAllHit('missile_rack', () => ({ x: 5000, y: 0, vy: 300 }), {}, 'cruise vs crossing');
});

test('supernova missile hits a crossing target (300 u/s)', () => {
  assertAllHit('supernova_missile', () => ({ x: 10000, y: 0, vy: 300 }), {}, 'supernova vs crossing');
});

test('supernova missile does not tunnel through the fuse at 30 fps', () => {
  assertAllHit('supernova_missile', () => ({ x: 10000, y: 0, vy: 300 }), { dt: 1 / 30 }, 'supernova @30fps');
});

test('fast missile rack hits an evasive fast crossing target (500 u/s)', () => {
  assertAllHit('fast_missile_rack', () => ({ x: 4000, y: 0, vy: 500, radius: 12 }), {}, 'fast rack vs 500u/s');
});

// --- Układ rakiety: prędkość wyrzutni (src/game/carrierVelocity.js) ---
// Zegar gry kroczy jak w pętli (SimClock.advance + beginRender), żeby pierwszy
// update dosunął pozę wyrzutni tak samo jak w grze.
const { SimClock } = await import('../src/game/simClock.js');

function flyFromMovingLauncher(weaponId, launchVx, targetCfg, { dt = 1 / 60, maxT = 30 } = {}) {
  const weaponDef = MASTER_WEAPONS[weaponId];
  const target = { radius: 40, dead: false, hp: 1e9, vx: 0, vy: 0, ...targetCfg };
  let damaged = false;
  window.applyDamageToNPC = (npc) => { if (npc === target) damaged = true; };

  const launcher = { x: 0, y: 0 };
  system.fire(launcher.x, launcher.y, target, weaponDef.baseDamage, weaponDef, 'blue', launchVx, 0);
  const rocket = system.rockets.find(r => r.active);
  assert.ok(rocket, 'rocket spawned');

  let worstLag = -Infinity;
  for (let t = 0; t < maxT && rocket.active; t += dt) {
    SimClock.advance(dt);
    SimClock.beginRender(1, dt);
    launcher.x += launchVx * dt;
    target.x += target.vx * dt;
    target.y += target.vy * dt;
    system.update(dt);
    if (rocket.active) worstLag = Math.max(worstLag, launcher.x - rocket.position.x);
  }
  return { damaged, worstLag };
}

test('salwa z wyrzutni lecącej 8000 j/s nie zostaje w tyle i trafia cel lecący razem z nią', () => {
  for (let i = 0; i < 5; i++) {
    const res = flyFromMovingLauncher('missile_rack', 8000, { x: 5000, y: 0, vx: 8000 });
    assert.ok(res.damaged, `pościg: rakieta ${i + 1} chybiła`);
    // Z pokładu wyrzutni rakieta wychodzi jak z postoju: najwyżej rozrzut wyrzutu.
    assert.ok(res.worstLag < 60, `rakieta została ${Math.round(res.worstLag)} j. za wyrzutnią`);
  }
});

test('rakieta z pędzącej wyrzutni trafia nieruchomy cel przed nią (wyprzedzenie dryfu)', () => {
  // W układzie rakiety cel nadlatuje z 6000 j/s — rakieta ma ~3 s na zejście
  // o 1500 j. w bok. (14 000 / 2500 jest dla missile_rack fizycznie za ciasne.)
  for (let i = 0; i < 5; i++) {
    const res = flyFromMovingLauncher('missile_rack', 6000, { x: 20000, y: 1500 });
    assert.ok(res.damaged, `cel nieruchomy: rakieta ${i + 1} chybiła`);
  }
});

test('zasięg rakiety liczy się z drogi własnej, nie z przelotu razem z wyrzutnią', () => {
  // Cel 20 000 j. przed wyrzutnią lecącą 8000 j/s, sam leci 8000 j/s: względem
  // układu rakiety stoi 20 000 j. od niej — w zasięgu missile_rack (24 000).
  const res = flyFromMovingLauncher('missile_rack', 8000, { x: 20000, y: 0, vx: 8000 }, { maxT: 40 });
  assert.ok(res.damaged, 'rakieta wygasła przed celem w swoim zasięgu');
});
