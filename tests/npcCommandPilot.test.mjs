import test from 'node:test';
import assert from 'node:assert/strict';

import { applyNpcCommandIntent } from '../src/ai/npcCommandPilot.js';
import { stepShipFlight } from '../src/game/flight/shipFlightModel.js';

// Komendy RTS dla okrętów z modelem lotu: komenda ustawia intencję, a lot liczy
// ten sam pilot co w walce.

const DT = 1 / 120;

function makeShip(extra = {}) {
  return {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0,
    mission: true, friendly: true, type: 'destroyer', shipFrame: 'terran_destroyer', radius: 60,
    ...extra
  };
}

function deps(extra = {}) {
  return {
    getTargetPos: (unit, cmd) => {
      const e = cmd.targetEntity;
      if (e && !e.dead) return { x: e.x, y: e.y };
      return cmd.target || null;
    },
    pickTarget: () => null,
    triggerRam: () => {},
    defaultOrbitRadius: 420,
    ...extra
  };
}

function run(ship, seconds, d, onTick) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (ship.command) applyNpcCommandIntent(ship, ship.command, d);
    stepShipFlight(ship, DT);
    if (onTick) onTick(i * DT);
  }
}

test('move command flies to the point and turns into hold with the ordered facing', () => {
  const ship = makeShip();
  ship.command = { type: 'move', target: { x: 4000, y: 1500 }, arrival: 90, faceAngle: Math.PI / 2 };
  run(ship, 20, deps());
  assert.equal(ship.command?.type, 'hold');
  assert.ok(Math.hypot(ship.x - 4000, ship.y - 1500) < 90 + 30, 'nie stanął na miejscu');
  assert.ok(Math.abs(Math.atan2(Math.sin(ship.angle - Math.PI / 2), Math.cos(ship.angle - Math.PI / 2))) < 0.05);
});

test('hold keeps the ship on its point after a push', () => {
  const ship = makeShip();
  ship.command = { type: 'hold' };
  applyNpcCommandIntent(ship, ship.command, deps());
  ship.vx = 600; // uderzenie / odepchnięcie
  run(ship, 15, deps());
  assert.ok(Math.hypot(ship.x, ship.y) < 30, `odpłynął o ${Math.hypot(ship.x, ship.y).toFixed(0)} u`);
});

test('ram command fires the impulse once, nose on target', () => {
  const ship = makeShip();
  const victim = { x: 3000, y: 800, vx: 0, vy: 0, radius: 120 };
  const rams = [];
  ship.command = { type: 'ram', targetEntity: victim, target: { x: victim.x, y: victim.y }, arrival: 380, ramImpulse: 3400 };
  run(ship, 15, deps({ triggerRam: (unit, impulse) => rams.push(impulse) }));
  assert.equal(rams.length, 1);
  const bearing = Math.atan2(victim.y, victim.x);
  assert.ok(Math.abs(Math.atan2(rams[0].dirY, rams[0].dirX) - bearing) < 0.35, 'taran nie w stronę celu');
  assert.equal(ship.command, null);
});

test('attack-move with a target hands control back to the combat brain', () => {
  const ship = makeShip();
  const enemy = { x: 5000, y: 0, dead: false };
  ship.command = { type: 'attack-move', target: { x: 6000, y: 0 } };
  const handled = applyNpcCommandIntent(ship, ship.command, deps({ pickTarget: () => enemy }));
  assert.equal(handled, false);
  assert.equal(ship.forceTarget, enemy);
});

test('orbit command circles the target at the ordered radius', () => {
  const ship = makeShip({ x: 900, y: 0 });
  const center = { x: 0, y: 0, vx: 0, vy: 0 };
  ship.command = { type: 'orbit', targetEntity: center, target: { x: 0, y: 0 }, orbitRadius: 900, orbitDir: 1 };
  let minR = Infinity;
  let maxR = 0;
  let unwrapped = 0;
  let last = 0;
  run(ship, 30, deps(), (t) => {
    const b = Math.atan2(ship.y, ship.x);
    unwrapped += Math.atan2(Math.sin(b - last), Math.cos(b - last));
    last = b;
    if (t > 8) {
      const r = Math.hypot(ship.x, ship.y);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
  });
  assert.ok(minR > 650 && maxR < 1200, `promień ${minR.toFixed(0)}..${maxR.toFixed(0)}`);
  assert.ok(unwrapped > Math.PI * 2, 'nie okrąża celu');
});
