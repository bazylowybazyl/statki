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

// --- „Feel” rakiet (2026-09-30): wyrzut z komory, przechył, wachlarz salwy, kolejka komór, Hydra ---
const { LAUNCH_ELEVATED, LAUNCH_RAIL } = await import('../src/effects3d/rocketSystem3D.js');

function stepFor(seconds, fn = null, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) {
    if (fn) fn(dt);
    system.update(dt);
  }
}
const activeList = () => system.rockets.filter((r) => r.active);
function clearSystem() {
  for (const r of system.rockets) { r.active = false; r.target = null; }
  system.activeRockets = 0;
  system.cancelSalvos(undefined);
  while (system.pendingLaunches > 0) system._qRemove(0);
}

test('wyrzut z komory: rakieta wyskakuje w górę i zawisa, zapala silnik, kładzie się w kurs', () => {
  clearSystem();
  const def = MASTER_WEAPONS.missile_rack;
  const target = { x: 6000, y: 0, radius: 40, dead: false, vx: 0, vy: 0 };
  window.applyDamageToNPC = () => {};
  const r = system.fire(0, 0, target, 1, def, 'blue');
  assert.equal(r.mode, LAUNCH_ELEVATED);
  assert.ok(r.nosePitch > 1.1, `nos w górę przy wyrzucie: ${r.nosePitch}`);
  let maxY = 0;
  let ignitedAt = -1;
  let planarAtIgnition = Infinity;
  for (let t = 0; t < 1.5; t += 1 / 60) {
    system.update(1 / 60);
    maxY = Math.max(maxY, r.position.y);
    if (ignitedAt < 0 && r.state === 'POWERED') { ignitedAt = t; planarAtIgnition = Math.hypot(r.position.x, r.position.z); }
  }
  assert.ok(ignitedAt > 0.2 && ignitedAt < 0.45, `zapłon po zawisie: ${ignitedAt}`);
  assert.ok(maxY > 40, `wysokość wyrzutu ${maxY}`);
  assert.ok(planarAtIgnition < 60, `do zapłonu rakieta prawie stoi nad komorą (${planarAtIgnition} j. w płaszczyźnie)`);
  assert.ok(r.nosePitch < 0.6, `po przechyle nos prawie poziomo: ${r.nosePitch}`);
  assert.ok(r.position.y <= 600 && r.position.y >= 0);
  delete window.applyDamageToNPC;
});

test('salwa: pierwsza od razu, reszta z kolejki komór co burstDelay; wachlarz rozchodzi się na boki', () => {
  clearSystem();
  const def = MASTER_WEAPONS.grad_launcher;
  const target = { x: 7000, y: 0, radius: 200, dead: false, vx: 0, vy: 0 };
  let hits = 0;
  window.applyDamageToNPC = (npc) => { if (npc === target) hits++; };
  const shooter = { x: 0, y: 0, angle: 0, vx: 0, vy: 0, angVel: 0 };
  const n = system.fireSalvo(shooter, 0, 0, target, 10, def, 'blue', 0, 0, def.burstCount, def.burstDelay, 0, LAUNCH_ELEVATED);
  assert.equal(n, 24);
  assert.equal(activeList().length, 1, 'jedna rakieta od razu');
  assert.equal(system.pendingLaunches, 23);
  stepFor(def.burstDelay * 24 * 1.25);
  assert.equal(system.pendingLaunches, 0, 'kolejka opróżniona');
  // Wachlarz: po zapłonie rakiety rozchodzą się na obie strony osi strzału.
  let left = 0;
  let right = 0;
  stepFor(0.5);
  for (const r of activeList()) {
    if (r.position.z < -60) left++;
    if (r.position.z > 60) right++;
  }
  assert.ok(left >= 4 && right >= 4, `wachlarz: ${left} w lewo, ${right} w prawo`);
  stepFor(10);
  assert.equal(hits, 24, `grad trafień: ${hits}/24`);
  delete window.applyDamageToNPC;
});

test('salwa z pędzącego i obracającego się okrętu: kolejne rakiety wychodzą z jego komory, nie z punktu strzału', () => {
  clearSystem();
  const def = MASTER_WEAPONS.missile_rack;
  const target = { x: 30000, y: 0, radius: 60, dead: false, vx: 0, vy: 0 };
  window.applyDamageToNPC = () => {};
  const shooter = { x: 0, y: 0, angle: 0, vx: 3000, vy: 0, angVel: 0.4 };
  system.fireSalvo(shooter, 200, 0, target, 1, def, 'blue', 3000, 0, 3, 0.2, 0, LAUNCH_ELEVATED);
  const born = [];
  for (let t = 0; t < 0.6; t += 1 / 60) {
    shooter.x += shooter.vx / 60;
    shooter.angle += shooter.angVel / 60;
    system.update(1 / 60);
    for (const r of activeList()) {
      if (born.includes(r)) continue;
      born.push(r);
      // Komora 200 j. przed środkiem okrętu (± rozstaw komór) w jego AKTUALNEJ pozie.
      const ex = shooter.x + Math.cos(shooter.angle) * 200;
      const ey = shooter.y + Math.sin(shooter.angle) * 200;
      const off = Math.hypot(r.position.x - ex, r.position.z - ey);
      assert.ok(off < 90, `rakieta ${born.length}: ${Math.round(off)} j. od komory`);
      // Pęd komory: v + ω × r (składowa x ≈ prędkość okrętu).
      assert.ok(Math.abs(r.frameVel.x - 3000) < 120, `pęd wyrzutni x ${r.frameVel.x}`);
    }
  }
  assert.equal(born.length, 3);
  delete window.applyDamageToNPC;
});

test('strzelec zniszczony w trakcie salwy — reszta rakiet przepada', () => {
  clearSystem();
  const def = MASTER_WEAPONS.roj_pod;
  const target = { x: 5000, y: 0, radius: 60, dead: false, vx: 0, vy: 0 };
  const shooter = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
  system.fireSalvo(shooter, 0, 0, target, 1, def, 'blue', 0, 0, 8, 0.05, 0, LAUNCH_ELEVATED);
  stepFor(0.12);
  const flying = activeList().length;
  shooter.dead = true;
  stepFor(0.5);
  assert.equal(system.pendingLaunches, 0);
  assert.ok(flying >= 2 && activeList().length === flying, `po śmierci strzelca bez nowych rakiet (${flying} → ${activeList().length})`);
});

test('myśliwiec: zrzut z belki (bez wyrzutu w górę), jedna rakieta trafia cel w uniku', () => {
  clearSystem();
  const def = MASTER_WEAPONS.fast_missile_rack;
  const target = { x: 4000, y: 0, radius: 12, dead: false, vx: 0, vy: 500 };
  let damaged = false;
  window.applyDamageToNPC = (npc) => { if (npc === target) damaged = true; };
  const n = system.fireSalvo({ x: 0, y: 0, angle: 0 }, 0, 0, target, 1, def, 'blue', 0, 0, 1, 0, 0, LAUNCH_RAIL);
  assert.equal(n, 1);
  const r = activeList()[0];
  assert.equal(r.mode, LAUNCH_RAIL);
  assert.equal(r.nosePitch, 0);
  for (let t = 0; t < 20 && r.active; t += 1 / 60) { target.y += target.vy / 60; system.update(1 / 60); }
  assert.ok(damaged, 'trafia myśliwca w uniku');
  delete window.applyDamageToNPC;
});

test('nowe typy trafiają: Rój w płynący cel, Hydra pęka na głowice i wszystkie trafiają', () => {
  clearSystem();
  const roj = MASTER_WEAPONS.roj_pod;
  const t1 = { x: 4500, y: 0, radius: 80, dead: false, vx: 0, vy: 300 };
  let h1 = 0;
  window.applyDamageToNPC = (npc) => { if (npc === t1) h1++; };
  system.fireSalvo({ x: 0, y: 0, angle: 0 }, 0, 0, t1, 1, roj, 'blue', 0, 0, 8, 0.05, 0, LAUNCH_ELEVATED);
  stepFor(8, (dt) => { t1.y += t1.vy * dt; });
  assert.equal(h1, 8, `Rój: ${h1}/8`);

  clearSystem();
  const hydra = MASTER_WEAPONS.hydra_mirv;
  const t2 = { x: 9000, y: 0, radius: 150, dead: false, vx: 0, vy: 200 };
  let h2 = 0;
  const damages = [];
  window.applyDamageToNPC = (npc, dmg) => { if (npc === t2) { h2++; damages.push(dmg); } };
  let maxActive = 0;
  system.fireSalvo({ x: 0, y: 0, angle: 0 }, 0, 0, t2, 240, hydra, 'blue', 0, 0, 1, 0, 0, LAUNCH_ELEVATED);
  for (let t = 0; t < 12; t += 1 / 60) { t2.y += t2.vy / 60; system.update(1 / 60); maxActive = Math.max(maxActive, activeList().length); }
  assert.equal(maxActive, hydra.submunition.count, 'nosiciel pękł na głowice');
  assert.equal(h2, hydra.submunition.count, `Hydra: ${h2}/${hydra.submunition.count} głowic trafiło`);
  assert.ok(damages.every((d) => d === 240), 'każda głowica = obrażenia nosiciela');
  delete window.applyDamageToNPC;
});

test('lot bez NaN i w pułapie: pozycja, wysokość i nos skończone przez całą salwę', () => {
  clearSystem();
  const def = MASTER_WEAPONS.grad_launcher;
  const target = { x: 3000, y: 2500, radius: 100, dead: false, vx: -400, vy: 200 };
  window.applyDamageToNPC = () => {};
  system.fireSalvo({ x: 0, y: 0, angle: 1 }, 0, 0, target, 1, def, 'red', 500, -200, 24, def.burstDelay, 2.5, LAUNCH_ELEVATED);
  for (let t = 0; t < 6; t += 1 / 30) {
    target.x += target.vx / 30; target.y += target.vy / 30;
    system.update(1 / 30);
    for (const r of activeList()) {
      assert.ok(Number.isFinite(r.position.x) && Number.isFinite(r.position.y) && Number.isFinite(r.position.z), 'pozycja');
      assert.ok(Number.isFinite(r.nosePitch) && Number.isFinite(r.noseAz), 'nos');
      assert.ok(r.position.y >= 0 && r.position.y <= 600, `wysokość ${r.position.y}`);
    }
  }
  delete window.applyDamageToNPC;
});
