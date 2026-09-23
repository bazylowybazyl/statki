import test from 'node:test';
import assert from 'node:assert/strict';

// Mózg kapitalny (20 Hz) + pilot/integrator (120 Hz) razem, tak jak w npcStep.
// capitalAI publikuje się w `window` przy imporcie — stub PRZED importem.
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

const { aiBattleship, aiFrigate } = await import('../src/ai/capitalAI.js');
const { stepShipFlight, usesShipFlightModel } = await import('../src/game/flight/shipFlightModel.js');
const { resolveCapitalIdealRange } = await import('../src/ai/capitalAiTuning.js');

const armata = { id: 'armata_mk1', baseRange: 7000, baseSpeed: 2500 };
const DT = 1 / 120;
const BRAIN_DT = 1 / 20;

function makePirate(type, hull, x) {
  return {
    x, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0,
    mission: true, isPirate: true, friendly: false,
    type, shipFrame: hull, radius: type === 'battleship' ? 140 : 45,
    hp: 5000, maxHp: 5000, shield: { val: 5000, max: 5000 },
    weapons: { main: [{ weapon: armata }, { weapon: armata }] }
  };
}

// Zwraca metryki po dojściu na dystans: zakres (rozwinięty) namiaru względem
// celu — karuzela daje wiele radianów, trzymanie pozycji z zygzakiem ułamek.
function duel(brain, npc, target, seconds) {
  window.aiPickTarget = () => target;
  let brainT = 0;
  let unwrapped = null;
  let last = null;
  let minB = Infinity;
  let maxB = -Infinity;
  let settledT = null;
  const ideal = resolveCapitalIdealRange(npc, target);
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    window.__frameId++;
    brainT -= DT;
    if (brainT <= 0) {
      brainT += BRAIN_DT;
      brain(null, npc, BRAIN_DT);
    }
    stepShipFlight(npc, DT);
    const d = Math.hypot(npc.x - target.x, npc.y - target.y);
    if (settledT == null && Math.abs(d - ideal) < ideal * 0.2) settledT = i * DT;
    const b = Math.atan2(npc.y - target.y, npc.x - target.x);
    unwrapped = unwrapped == null ? b : unwrapped + wrapAngle(b - last);
    last = b;
    if (settledT != null) {
      minB = Math.min(minB, unwrapped);
      maxB = Math.max(maxB, unwrapped);
    }
  }
  const dist = Math.hypot(npc.x - target.x, npc.y - target.y);
  const facingErr = Math.abs(wrapAngle(Math.atan2(target.y - npc.y, target.x - npc.x) - npc.angle));
  return { ideal, dist, settledT, bearingRange: maxB - minB, facingErr };
}

test('pirate battleship closes to gun range, faces the target and does not circle it', () => {
  const npc = makePirate('battleship', 'pirate_battleship', -12000);
  const target = { x: 0, y: 0, vx: 0, vy: 0, radius: 220, angle: 0 };
  assert.equal(usesShipFlightModel(npc), true);
  const r = duel(aiBattleship, npc, target, 60);
  assert.ok(r.settledT != null && r.settledT < 30, `dojście na dystans: ${r.settledT}`);
  assert.ok(Math.abs(r.dist - r.ideal) < r.ideal * 0.25, `dystans ${r.dist.toFixed(0)} vs ${r.ideal.toFixed(0)}`);
  assert.ok(r.bearingRange < 0.6, `namiar przejechał ${r.bearingRange.toFixed(2)} rad — karuzela`);
  assert.ok(r.facingErr < 0.35, `kadłub odwrócony od celu o ${r.facingErr.toFixed(2)} rad`);
});

test('pirate frigate weaves at range instead of orbiting', () => {
  // Fregata podejmuje walkę dopiero w ~2× dystansu bojowego (eskorta, nie łowca).
  const npc = makePirate('frigate_pd', 'pirate_frigate', -3000);
  const target = { x: 0, y: 0, vx: 0, vy: 0, radius: 220, angle: 0 };
  const r = duel(aiFrigate, npc, target, 60);
  assert.ok(r.settledT != null && r.settledT < 15, `dojście na dystans: ${r.settledT}`);
  assert.ok(Math.abs(r.dist - r.ideal) < r.ideal * 0.3, `dystans ${r.dist.toFixed(0)} vs ${r.ideal.toFixed(0)}`);
  assert.ok(r.bearingRange < 1.2, `namiar przejechał ${r.bearingRange.toFixed(2)} rad — karuzela`);
});

test('ship follows a moving target and keeps its range', () => {
  const npc = makePirate('battleship', 'pirate_battleship', -9000);
  const target = { x: 0, y: 0, vx: 250, vy: 150, radius: 220, angle: 0 };
  window.aiPickTarget = () => target;
  let brainT = 0;
  for (let i = 0; i < 120 * 50; i++) {
    window.__frameId++;
    target.x += target.vx * DT;
    target.y += target.vy * DT;
    brainT -= DT;
    if (brainT <= 0) {
      brainT += BRAIN_DT;
      aiBattleship(null, npc, BRAIN_DT);
    }
    stepShipFlight(npc, DT);
  }
  const ideal = resolveCapitalIdealRange(npc, target);
  const d = Math.hypot(npc.x - target.x, npc.y - target.y);
  assert.ok(Math.abs(d - ideal) < ideal * 0.3, `dystans do ruchomego celu ${d.toFixed(0)} vs ${ideal.toFixed(0)}`);
  assert.ok(Math.hypot(npc.vx - target.vx, npc.vy - target.vy) < 150, 'nie dopasował prędkości celu');
});

test('brains only set intent — movement is integrated by the flight step alone', () => {
  const npc = makePirate('battleship', 'pirate_battleship', -5000);
  const target = { x: 0, y: 0, vx: 0, vy: 0, radius: 220, angle: 0 };
  window.aiPickTarget = () => target;
  const before = { x: npc.x, y: npc.y, vx: npc.vx, vy: npc.vy, angle: npc.angle };
  aiBattleship(null, npc, BRAIN_DT);
  assert.deepEqual(
    { x: npc.x, y: npc.y, vx: npc.vx, vy: npc.vy, angle: npc.angle },
    before,
    'mózg nie może ruszać pozycji/prędkości — to robi stepShipFlight co tick'
  );
  assert.equal(npc.__flightIntent.mode, 'arrive');
});
