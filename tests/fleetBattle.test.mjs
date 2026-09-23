import test from 'node:test';
import assert from 'node:assert/strict';

// Dwie floty zespawnowane daleko od siebie: obraz sytuacji z czujników +
// dowódca floty (front, zwiad, fazy) + mózgi okrętów + pilot lotu, tak jak
// w npcStep (mózgi i dowódca 20 Hz, lot 120 Hz).
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
globalThis.window = globalThis.window || {};
Object.assign(globalThis.window, {
  wrapAngle,
  applySeparationForces: () => ({ ax: 0, ay: 0 }),
  queryAIGrid: () => ({ buffer: [], count: 0 }),
  ship: null,
  __frameId: 1,
  bullets: [],
  __npcRocketThreats: [],
  __playerRocketThreats: [],
  getUnitKind: () => 'battleship'
});

const { aiBattleship, aiFrigate, aiDestroyer } = await import('../src/ai/capitalAI.js');
const { stepShipFlight } = await import('../src/game/flight/shipFlightModel.js');
const Coord = await import('../src/ai/fleetCoordinator.js');
const Aw = await import('../src/ai/fleetAwareness.js');

// Jak aiPickTarget w index.html (bez misji pirackiej).
window.aiPickTarget = (npc) => {
  if (npc.forceTarget && !npc.forceTarget.dead) return npc.forceTarget;
  return Aw.pickContactTarget(npc, { player: window.ship ?? null, priority: null });
};

const railgun = { baseRange: 14000, baseSpeed: 8000 };
const armata = { baseRange: 7000, baseSpeed: 2500 };
const DT = 1 / 120;
const BRAIN_DT = 1 / 20;

function makeShip(side, kind, x, y) {
  const friendlySide = side === 'friendly';
  const hull = (friendlySide ? 'terran_' : 'pirate_') + (kind === 'frigate_pd' ? 'frigate' : kind);
  const npc = {
    x, y, vx: 0, vy: 0, angle: friendlySide ? 0 : Math.PI, angVel: 0,
    mission: true, type: kind, shipFrame: hull,
    friendly: friendlySide, isPirate: !friendlySide,
    isCapitalShip: kind === 'battleship' || kind === 'destroyer',
    radius: kind === 'battleship' ? 140 : (kind === 'destroyer' ? 60 : 45),
    hp: 5000, maxHp: 5000, shield: { val: 5000, max: 5000 },
    weapons: { main: [{ weapon: friendlySide ? railgun : armata }] }
  };
  const brain = kind === 'battleship' ? aiBattleship : (kind === 'destroyer' ? aiDestroyer : aiFrigate);
  npc.ai = (dt) => brain(null, npc, dt);
  return npc;
}

function centroid(list) {
  let x = 0;
  let y = 0;
  for (const s of list) { x += s.x; y += s.y; }
  return { x: x / list.length, y: y / list.length };
}

test('two fleets spawned 35 km apart detect each other and close in together', () => {
  Aw.resetFleetAwareness();
  Coord.resetFleetCoordinator();
  window.SupportWing = { order: 'engage' };
  const friendlies = [
    makeShip('friendly', 'battleship', 0, 0),
    makeShip('friendly', 'destroyer', 0, 1500),
    makeShip('friendly', 'frigate_pd', 0, -1500),
    makeShip('friendly', 'frigate_pd', 0, 3000)
  ];
  const pirates = [
    makeShip('pirate', 'battleship', 35000, 0),
    makeShip('pirate', 'frigate_pd', 35000, 1500),
    makeShip('pirate', 'frigate_pd', 35000, -1500)
  ];
  const npcs = [...friendlies, ...pirates];

  let firstContactT = null;
  let engageT = null;
  let maxAdvanceSpread = 0;
  const startF = centroid(friendlies);
  const startP = centroid(pirates);
  for (let i = 0; i < 120 * 120; i++) {
    const t = i * DT;
    window.__frameId++;
    if (i % 6 === 0) {
      Coord.updateFleetCoordinator(npcs, null, BRAIN_DT);
      for (const npc of npcs) npc.ai(BRAIN_DT);
    }
    for (const npc of npcs) stepShipFlight(npc, DT);

    const aw = Aw.describeFleetAwareness();
    if (firstContactT == null && aw.friendly.visible > 0 && aw.pirate.visible > 0) firstContactT = t;
    const phaseF = Coord.getFleetPhase('friendly');
    if (engageT == null && phaseF.phase === 'engage') engageT = t;
    if (phaseF.phase === 'advance') {
      // Spójność: w fazie zbliżania żaden okręt nie ucieka daleko przed resztę.
      let minD = Infinity;
      let maxD = -Infinity;
      for (const s of friendlies) {
        const d = s.x; // oś natarcia ≈ +X
        minD = Math.min(minD, d);
        maxD = Math.max(maxD, d);
      }
      maxAdvanceSpread = Math.max(maxAdvanceSpread, maxD - minD);
    }
  }

  assert.ok(firstContactT != null && firstContactT < 1, `wykrycie: ${firstContactT}`);
  assert.ok(engageT != null && engageT < 60, `faza walki po ${engageT} s`);
  const endF = centroid(friendlies);
  const endP = centroid(pirates);
  const gap = Math.hypot(endF.x - endP.x, endF.y - endP.y);
  assert.ok(gap < 12000, `floty się nie zbliżyły: ${gap.toFixed(0)} u`);
  assert.ok(Math.hypot(endF.x - startF.x, endF.y - startF.y) > 5000, 'sojusznicy stali w miejscu');
  assert.ok(Math.hypot(endP.x - startP.x, endP.y - startP.y) > 5000, 'piraci stali w miejscu');
  // Front nie wyprzedza floty o więcej niż ~2,5 km, zwiad fregat jest do ~7 km
  // przed frontem — rozrzut w zbliżaniu musi się w tym mieścić.
  assert.ok(maxAdvanceSpread < 11000, `flota rozsypała się w zbliżaniu: ${maxAdvanceSpread.toFixed(0)} u`);
  delete window.SupportWing;
});

test('escort order does not chase a fleet far from the player', () => {
  Aw.resetFleetAwareness();
  Coord.resetFleetCoordinator();
  const me = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, isCapitalShip: true, sensors: { passiveRange: 80000 } };
  window.ship = me;
  window.SupportWing = { order: 'guard' };
  const escort = makeShip('friendly', 'battleship', 0, 2000);
  escort.supportData = { leader: me };
  const raider = makeShip('pirate', 'battleship', 40000, 0);
  raider.ai = () => {}; // pirat stoi
  const npcs = [escort, raider];
  for (let i = 0; i < 120 * 20; i++) {
    window.__frameId++;
    if (i % 6 === 0) {
      Coord.updateFleetCoordinator(npcs, me, BRAIN_DT);
      escort.ai(BRAIN_DT);
    }
    stepShipFlight(escort, DT);
  }
  assert.equal(Coord.getFleetPhase('friendly').phase, 'idle', 'ESKORTA nie rusza na wroga 40 km od gracza');
  assert.ok(Math.hypot(escort.x, escort.y - 2000) < 1500, 'eskorta odpłynęła od gracza');

  // Ten sam wróg w promieniu obrony — skrzydło przechwytuje.
  raider.x = 11000;
  for (let i = 0; i < 120 * 5; i++) {
    window.__frameId++;
    if (i % 6 === 0) {
      Coord.updateFleetCoordinator(npcs, me, BRAIN_DT);
      escort.ai(BRAIN_DT);
    }
    stepShipFlight(escort, DT);
  }
  assert.notEqual(Coord.getFleetPhase('friendly').phase, 'idle');
  assert.equal(escort.target, raider);
  delete window.ship;
  delete window.SupportWing;
});

test('lost enemy is searched for at its last known position', () => {
  Aw.resetFleetAwareness();
  Coord.resetFleetCoordinator();
  window.SupportWing = { order: 'engage' };
  const hunter = makeShip('friendly', 'destroyer', 0, 0);
  const prey = makeShip('pirate', 'frigate_pd', 18000, 0); // niszczyciel: 30 km × 0,7 = 21 km
  prey.ai = () => {};
  const npcs = [hunter, prey];
  for (let i = 0; i < 12; i++) Coord.updateFleetCoordinator(npcs, null, BRAIN_DT);
  assert.equal(Aw.isVisibleToSide('friendly', prey), true);
  prey.x = 200000; // zniknął z czujników
  for (let i = 0; i < 12; i++) Coord.updateFleetCoordinator(npcs, null, BRAIN_DT);
  assert.equal(Coord.getFleetPhase('friendly').phase, 'search');
  // Łowca stoi w miejscu (bez mózgu), więc front wyprzedza go o ~2,5 km —
  // ważne, że slot prowadzi W STRONĘ ostatniej znanej pozycji.
  const slot = Coord.getBattleSlot(hunter);
  assert.ok(slot && slot.x > hunter.x + 1000, 'front nie idzie w stronę ostatniej znanej pozycji');
  delete window.SupportWing;
});
