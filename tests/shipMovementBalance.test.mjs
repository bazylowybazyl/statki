import test from 'node:test';
import assert from 'node:assert/strict';

import { CAPITAL_SHIP_TEMPLATES, SUPPORT_SHIP_TEMPLATES } from '../src/data/ships.js';
import { SHIP_FLIGHT_SPECS } from '../src/data/shipFlightSpecs.js';
import { applyNpcFlightControl } from '../src/game/flight/npcFlight.js';

test('ship movement becomes heavier with every larger hull class', () => {
  const frigate = SUPPORT_SHIP_TEMPLATES.frigate_pd.stats;
  const destroyer = SUPPORT_SHIP_TEMPLATES.destroyer.stats;
  const battleship = SUPPORT_SHIP_TEMPLATES.battleship.stats;
  const carrier = CAPITAL_SHIP_TEMPLATES.carrier;
  const supercapital = CAPITAL_SHIP_TEMPLATES.supercapital;
  const ladder = [frigate, destroyer, battleship, carrier, supercapital];

  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i - 1].accel > ladder[i].accel, `accel step ${i}`);
    assert.ok(ladder[i - 1].maxSpeed > ladder[i].maxSpeed, `speed step ${i}`);
    assert.ok(ladder[i - 1].turn > ladder[i].turn, `turn step ${i}`);
  }

  // Szablony nie trzymają własnej kopii prowadzenia — to lustro tabeli
  // shipFlightSpecs.js, którą egzekwuje model lotu NPC.
  const mirrors = [
    [frigate, 'terran_frigate'],
    [destroyer, 'terran_destroyer'],
    [battleship, 'terran_battleship'],
    [carrier, 'terran_carrier'],
    [supercapital, 'terran_supercapital'],
    [CAPITAL_SHIP_TEMPLATES.atlas, 'atlas']
  ];
  for (const [template, hullId] of mirrors) {
    const spec = SHIP_FLIGHT_SPECS[hullId];
    assert.equal(template.accel, spec.accel, `${hullId}: accel`);
    assert.equal(template.maxSpeed, spec.maxSpeed, `${hullId}: maxSpeed`);
    assert.ok(Math.abs(template.turn - spec.turnRate * Math.PI / 180) < 1e-9, `${hullId}: turn`);
  }
});

function createPhysicalNpc({ accel, maxSpeed, turn }) {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    angVel: 0,
    accel,
    maxSpeed,
    turn,
    mass: 1000,
    w: 200,
    h: 80,
    friction: 0.999,
    visual: {
      mainThrusters: [{
        offset: { x: -90, y: 0 },
        baseDeg: 90,
        nozzleDeg: 90,
        gimbalMinDeg: -45,
        gimbalMaxDeg: 45
      }],
      torqueThrusters: []
    }
  };
}

test('physical NPC thrusters respect class acceleration and speed limits', () => {
  const frigate = createPhysicalNpc(SUPPORT_SHIP_TEMPLATES.frigate_pd.stats);
  const supercapital = createPhysicalNpc(CAPITAL_SHIP_TEMPLATES.supercapital);
  const thrust = { controller: 'npc', thrustY: 1, main: 1 };

  for (let i = 0; i < 120; i++) {
    applyNpcFlightControl(frigate, thrust, 1 / 60);
    applyNpcFlightControl(supercapital, thrust, 1 / 60);
  }

  const frigateSpeed = Math.hypot(frigate.vx, frigate.vy);
  const supercapitalSpeed = Math.hypot(supercapital.vx, supercapital.vy);
  assert.ok(frigateSpeed <= frigate.maxSpeed + 1e-6);
  assert.ok(supercapitalSpeed <= supercapital.maxSpeed + 1e-6);
  assert.ok(frigateSpeed > supercapitalSpeed * 4);

  supercapital.vel.x = supercapital.vx = 1000;
  applyNpcFlightControl(supercapital, { controller: 'npc', thrustY: 0, main: 0 }, 1 / 60);
  assert.ok(Math.hypot(supercapital.vx, supercapital.vy) <= supercapital.maxSpeed + 1e-6);
});
