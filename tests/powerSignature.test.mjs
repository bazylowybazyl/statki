// Sygnatura stanu (zasilanie × osłona gazu) w prawdziwym wykrywaniu: AI (fleetAwareness) i mgła gracza (fogOfWar).
// Scenariusz użytkownika 2026-11-11: „ktoś cię goni, wchodzisz w chmurę gazową, wyłączasz i jest cisza”.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};

const A = await import('../src/ai/fleetAwareness.js');
const F = await import('../src/game/fogOfWar.js');
const P = await import('../src/game/shipPower.js');
const G = await import('../src/game/gasCover.js');

function pirate(type, x, y, extra = {}) {
  return { x, y, vx: 0, vy: 0, type, radius: 45, mission: true, friendly: false, isPirate: true, ...extra };
}
function player(x, y) {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, isCapitalShip: true, sensors: { passiveRange: 80000, activeRange: 90000 } };
}

test('bez haka i w stanie neutralnym wykrywanie jak dawniej (mnożnik 1)', () => {
  A.setAwarenessSignatureHook(null);
  A.resetFleetAwareness();
  const me = player(0, 0);
  const chaser = pirate('frigate_pd', 15000, 0);   // fregata 18 km × Atlas 1,3 = 23,4 km
  A.updateFleetAwareness([chaser], me, 0, true);
  assert.equal(A.isVisibleToSide('pirate', me), true);
  assert.equal(me.__sigMul, 1);
  A.setAwarenessSignatureHook((e) => P.powerSignatureMul(e));
  A.updateFleetAwareness([chaser], me, 0, true);
  assert.equal(A.isVisibleToSide('pirate', me), true, 'okręt bez stanu zasilania = PRACA');
  A.setAwarenessSignatureHook(null);
});

test('wyłączony gracz w gazie znika z obrazu ścigającego (zostaje duch)', () => {
  A.resetFleetAwareness();
  const me = player(0, 0);
  const chaser = pirate('frigate_pd', 9000, 0);
  const fakeGas = { sampleMacro: () => ({ weight: 1, cluster: 1, hole: 1, gas: 0 }) }; // gęste skupisko pasa
  A.setAwarenessSignatureHook((e) => P.powerSignatureMul(e) * G.gasSignatureMul(G.gasCoverAt(fakeGas, 0, 0)));
  A.updateFleetAwareness([chaser], me, 0, true);
  assert.equal(A.isVisibleToSide('pirate', me), true, 'włączony w gazie: 23,4 × 0,4 = 9,4 km — jeszcze widać');

  P.powerDownShip(me);
  for (let i = 0; i < 180; i++) P.stepShipPower(me, 1 / 60);
  assert.equal(P.powerStateOf(me), P.POWER_OFF);
  A.updateFleetAwareness([chaser], me, 0, true);
  assert.equal(A.isVisibleToSide('pirate', me), false, 'wyłączony w gazie: 23,4 × 0,3 × 0,4 ≈ 2,8 km — cisza');
  const ghost = A.getSideContacts('pirate').find((c) => c.entity === me);
  assert.ok(ghost && !ghost.visible, 'pościg ma ducha — leci tam, gdzie gracz zniknął');
  assert.ok(me.__sigMul < 0.15);
  A.setAwarenessSignatureHook(null);
});

test('osłona gazu: cienka mgła prawie nic, gęste skupisko pełna', () => {
  const thin = { sampleMacro: () => ({ weight: 1, cluster: 0, hole: 1, gas: 0 }) };
  const dense = { sampleMacro: () => ({ weight: 1, cluster: 1, hole: 1, gas: 0 }) };
  assert.ok(G.gasCoverAt(thin, 0, 0) < 0.05);
  assert.equal(G.gasCoverAt(dense, 0, 0), 1);
  assert.equal(G.gasCoverAt(null, 0, 0), 0);
  assert.equal(G.gasSignatureMul(0), 1);
  assert.equal(G.gasSignatureMul(1), G.GAS_COVER_TUNE.sigMul);
  assert.equal(G.visionMulFromSignature(0.1), G.GAS_COVER_TUNE.visionFloor);
});

test('mgła gracza: wyłączony NPC widać z bliższa, strefy fabuły bez zmian', () => {
  const st = F.createFogState();
  st.enabled = true;
  st.time = 0;
  F.pushFogSource(st, 0, 0, 10000, F.FOG_KIND.ship);
  const npc = pirate('frigate_pd', 8000, 0);
  F.stepFogEntities(st, { npcs: [npc] });
  assert.equal(npc.__fogVisible, true);
  npc.__sigMul = 0.3; // wyłączony — wzrok × podłoga 0,5 → 5 km
  F.stepFogEntities(st, { npcs: [npc] });
  assert.equal(npc.__fogVisible, false);
  F.pushFogSource(st, 8000, 0, 2000, F.FOG_KIND.reveal);
  F.stepFogEntities(st, { npcs: [npc] });
  assert.equal(npc.__fogVisible, true, 'strefa fabuły odsłania bez mnożnika');
  assert.equal(F.fogPointVisibleMul(st, 9000, 0, 0, 1), F.fogPointVisible(st, 9000, 0, 0));
});
