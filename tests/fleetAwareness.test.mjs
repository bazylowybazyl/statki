import test from 'node:test';
import assert from 'node:assert/strict';

// Wspólny obraz sytuacji: kontakt widziany przez jeden okręt zna cała strona,
// zasięgi idą z profili czujników (jak radar gracza), zgubiony kontakt zostaje
// chwilę jako „duch".
globalThis.window = globalThis.window || {};

const A = await import('../src/ai/fleetAwareness.js');

// Promień jak w grze (szablony): od niego zależy wykrywalność nieznanych typów.
function radiusFor(type) {
  if (type.includes('frigate')) return 45;
  if (type === 'destroyer') return 60;
  return 140;
}
function friendly(type, x, y, extra = {}) {
  return { x, y, vx: 0, vy: 0, type, radius: radiusFor(type), mission: true, friendly: true, ...extra };
}
function pirate(type, x, y, extra = {}) {
  return { x, y, vx: 0, vy: 0, type, radius: radiusFor(type), mission: true, friendly: false, isPirate: true, ...extra };
}
function player(x, y) {
  return {
    pos: { x, y }, vel: { x: 0, y: 0 }, isCapitalShip: true,
    sensors: { passiveRange: 80000, activeRange: 90000, lockRange: 75000 }
  };
}

test('a contact seen by one ship is known to the whole side', () => {
  A.resetFleetAwareness();
  // Fregata (czujniki 18 km × wykrywalność fregaty 0,7 = 12,6 km) widzi wroga
  // 10 km dalej; pancernik 50 km z tyłu sam by go nie zobaczył (45 × 0,7 = 31,5 km).
  const scout = friendly('frigate_pd', 0, 0);
  const battleship = friendly('battleship', -50000, 0, { isCapitalShip: true });
  const enemy = pirate('frigate_pd', 10000, 0);
  A.updateFleetAwareness([scout, battleship, enemy], null, 0, true);
  assert.equal(A.isVisibleToSide('friendly', enemy), true);
  assert.equal(A.pickContactTarget(battleship, { player: null }), enemy, 'pancernik zna cel ze zwiadu');
});

test('sensor range follows the ship profile and target size', () => {
  A.resetFleetAwareness();
  const lone = friendly('battleship', 0, 0, { isCapitalShip: true }); // profil klasy: 45 km
  const nearFrigate = pirate('frigate_pd', 30000, 0);   // 45 × 0,7 = 31,5 km → widać
  const farFrigate = pirate('frigate_pd', 0, 35000);    // poza zasięgiem
  const farCapital = pirate('battleship', -55000, 0, { isCapitalShip: true }); // 45 × 1,3 = 58,5 km → widać
  A.updateFleetAwareness([lone, nearFrigate, farFrigate, farCapital], null, 0, true);
  assert.equal(A.isVisibleToSide('friendly', nearFrigate), true);
  assert.equal(A.isVisibleToSide('friendly', farFrigate), false);
  assert.equal(A.isVisibleToSide('friendly', farCapital), true, 'duży okręt widać z dalszej odległości');
});

test('the player ship feeds the friendly picture and is a contact for pirates', () => {
  A.resetFleetAwareness();
  const me = player(0, 0);
  const wing = friendly('frigate_pd', 0, 500);
  const raider = pirate('battleship', 70000, 0, { isCapitalShip: true });
  A.updateFleetAwareness([wing, raider], me, 0, true);
  // Atlas widzi 80 km — tyle, ile pokazuje radar gracza.
  assert.equal(A.isVisibleToSide('friendly', raider), true);
  // Pirat (45 km × 1,3 dla kapitała = 58,5 km) jeszcze nie widzi gracza z 70 km.
  assert.equal(A.isVisibleToSide('pirate', me), false);
  raider.x = 50000;
  A.updateFleetAwareness([wing, raider], me, 0, true);
  assert.equal(A.isVisibleToSide('pirate', me), true);
});

test('lost contacts become ghosts and expire', () => {
  A.resetFleetAwareness();
  const scout = friendly('frigate_pd', 0, 0);
  const enemy = pirate('frigate_pd', 8000, 0);
  A.updateFleetAwareness([scout, enemy], null, 0, true);
  assert.equal(A.pickContactTarget(scout, { player: null }), enemy);
  enemy.x = 60000; // znika z czujników
  A.updateFleetAwareness([scout, enemy], null, 1, true);
  assert.equal(A.pickContactTarget(scout, { player: null }), null, 'ducha nie da się celować');
  const ghost = A.getFreshestGhost('friendly');
  assert.ok(ghost && ghost.x === 8000, 'duch pamięta ostatnią znaną pozycję');
  A.updateFleetAwareness([scout, enemy], null, A.AWARENESS_CONFIG.ghostTtl + 1, true);
  assert.equal(A.getFreshestGhost('friendly'), null, 'duch wygasa');
});

test('escort leash limits targets to the player area, the locked target wins', () => {
  A.resetFleetAwareness();
  const me = player(0, 0);
  window.ship = me;
  window.SupportWing = { order: 'guard' };
  const escort = friendly('destroyer', 0, 800, { supportData: { leader: me } });
  const near = pirate('frigate_pd', 9000, 0);
  const far = pirate('battleship', 40000, 0, { isCapitalShip: true });
  A.updateFleetAwareness([escort, near, far], me, 0, true);
  assert.equal(A.pickContactTarget(escort, { player: me }), near);
  near.dead = true;
  A.updateFleetAwareness([escort, near, far], me, 0, true);
  assert.equal(A.pickContactTarget(escort, { player: me }), null, 'eskorta nie goni celu 40 km od gracza');
  assert.equal(A.pickContactTarget(escort, { player: me, priority: far }), far, 'cel gracza — tak');
  window.SupportWing.order = 'engage';
  assert.equal(A.pickContactTarget(escort, { player: me }), far, 'ATAK zdejmuje smycz');
  delete window.ship;
  delete window.SupportWing;
});

test('pirates with a home station only defend its area', () => {
  A.resetFleetAwareness();
  const home = { x: 0, y: 0, r: 400 };
  const guard = pirate('battleship', 0, 0, { isCapitalShip: true, home });
  const intruder = friendly('frigate_pd', 12000, 0);
  const passerby = friendly('battleship', 0, 40000, { isCapitalShip: true });
  A.updateFleetAwareness([guard, intruder, passerby], null, 0, true);
  assert.equal(A.pickContactTarget(guard, { player: null }), intruder);
  intruder.dead = true;
  A.updateFleetAwareness([guard, intruder, passerby], null, 0, true);
  assert.equal(A.isVisibleToSide('pirate', passerby), true);
  assert.equal(A.pickContactTarget(guard, { player: null }), null, 'nie rusza w pościg daleko od stacji');
});
