import test from 'node:test';
import assert from 'node:assert/strict';

// Warp niewrażliwy (decyzja użytkownika 2026-10-11): w skoku i na rampie wyjścia gracz nie zderza się z kadłubami,
// olbrzymami pasa ani ringiem; po rampie zostaje duchem, dopóki jego kadłub zachodzi na kadłub, w którym stanął.
// Zwykły lot (też PRZELOT) — zwykłe kolizje. Pomiar w grze: scripts/webgpu/tunelowanie-gra.mjs --tryb gra.
globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { readIndexHtml, loadIndexFunction, sliceFunction } = await import('./helpers/indexSource.mjs');

const html = readIndexHtml();

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}

test('duch gracza: skok i rampa — tak; po rampie, dopóki stoi w kadłubie; potem zwykłe kolizje', () => {
  const ship = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, x: 0, y: 0, angle: 0, angVel: 0, mass: 200000, isPlayer: true };
  const npc = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 50000 };
  HullBodies.createHull(ship, plate(600, 240));
  HullBodies.createHull(npc, plate(300, 120));
  const scope = {
    warp: { state: 'idle', exitRamp: null }, ship, npcs: [npc], _cachedAllDestructibles: null,
    worldBodies: { withEntities: (list) => list }, HullBodies, _warpGhostLinger: false, playerHullOverlapsAny: null,
    // Hipercruise (E5) bezczynny — duch tylko od warpa.
    hypercruise: { state: 'idle' }, hypercruiseDriving: () => false,
    // Pas bez olbrzymów — głąb skały nie trzyma ducha (osobny test: tests/hipercruisePrzeszkody.test.mjs).
    beltWorld: null, ROCK_ESCAPE_SPEED: 3000, _rockEscape: { x: 0, y: 0, dist: 0 }, playerRockEscape: null
  };
  scope.playerHullOverlapsAny = loadIndexFunction(html, 'function playerHullOverlapsAny(bodies) {', 'playerHullOverlapsAny', scope);
  scope.playerRockEscape = loadIndexFunction(html, 'function playerRockEscape() {', 'playerRockEscape', scope);
  const update = loadIndexFunction(html, 'function updatePlayerWarpGhost() {', 'updatePlayerWarpGhost', scope);
  try {
    assert.equal(update(), false, 'zwykły lot w kadłubie okrętu: kolizje (bez ducha)');
    scope.warp.state = 'active';
    ship.pos.x = ship.x = 5000;
    assert.equal(update(), true, 'skok');
    scope.warp.state = 'idle';
    scope.warp.exitRamp = { active: true };
    assert.equal(update(), true, 'rampa wyjścia');
    scope.warp.exitRamp.active = false;
    ship.pos.x = ship.x = 100;                          // stanął w okręcie
    assert.equal(update(), true, 'po rampie w kadłubie okrętu: dalej duch');
    assert.equal(update(), true);
    ship.pos.x = ship.x = 3000;                         // wyleciał
    assert.equal(update(), false, 'wolny: duch gaśnie');
    ship.pos.x = ship.x = 100;
    assert.equal(update(), false, 'ponowny wjazd w okręt w zwykłym locie: kolizja, nie duch');
    npc.isCollidable = false;
    scope.warp.exitRamp.active = true; update(); scope.warp.exitRamp.active = false;
    assert.equal(update(), false, 'kadłub bez kolizji (przylot NPC tunelem) nie trzyma ducha');
  } finally { HullBodies.release(ship); HullBodies.release(npc); }
});

test('physicsStep: flaga ducha przed kolizjami gracza; olbrzymy, ring i budzenie wraków ją czytają', () => {
  const step = html.slice(html.indexOf('function physicsStep('));
  const flag = step.indexOf('if (ship) ship.noHullCollisions = updatePlayerWarpGhost();');
  assert.ok(flag > 0, 'flaga ustawiana w physicsStep');
  for (const call of ['stepShipAsteroidCollisions(dt);', 'stepShipRingCollisions(dt);', 'HullBodies.step(dt, worldBodies.withEntities(allDestructibles));']) {
    const at = step.indexOf(call);
    assert.ok(at > flag, `${call} po fladze ducha`);
  }
  assert.match(sliceFunction(html, 'function stepShipAsteroidCollisions(dt) {'), /if \(ship && !ship\.dead && !ship\.noHullCollisions\) belt\.collideShip\(ship\);/);
  // Ring: duch warpa omija płytę, hipercruise (E5) NIE — płyta zostaje przeszkodą i zrywa lot.
  assert.match(sliceFunction(html, 'function stepShipRingCollisions(dt) {'), /if \(ship && !ship\.dead && \(!ship\.noHullCollisions \|\| hcRing\)\) \{[\s\S]*?const hit = haloWorld\.constrainShip\(ship, true\);\s+if \(hcRing && \(tunnel \|\| \(hit && hit\.hit\)\)\) \{\s+hypercruise\.reason = 'ring';\s+resetHypercruise\(hypercruise\);/);
  assert.match(step, /wakeSleepingWrecksNearBodies\(_sleepingWrecksBuffer, dynamicDestructibles, isPlayerWarpGhost\(\) \? ship : null\);/);
});
