import test from 'node:test';
import assert from 'node:assert/strict';

import { SHIP_FLIGHT_SPECS } from '../src/data/shipFlightSpecs.js';
import {
  flightTurnTime,
  resolveShipFlightSpec,
  setFlightArrive,
  setFlightSeparation,
  setFlightStop,
  stepShipFlight,
  usesShipFlightModel,
  wrapFlightAngle
} from '../src/game/flight/shipFlightModel.js';

// Kontrakt modelu lotu NPC: specyfikacja z shipFlightSpecs.js jest egzekwowana
// dokładnie, a pilot planuje z tych samych liczb — więc okręt osiąga swoją
// prędkość, dojeżdża bez przestrzelenia i nie krąży wokół celu.

const DT = 1 / 120;
const TERRAN_LADDER = [
  ['terran_frigate', 'frigate_pd'],
  ['terran_destroyer', 'destroyer'],
  ['terran_battleship', 'battleship'],
  ['terran_carrier', 'carrier'],
  ['terran_supercapital', 'supercapital']
];

function makeShip(hull, type, extra = {}) {
  return { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mission: true, type, shipFrame: hull, ...extra };
}

// Mózg AI odświeża intencję co 50 ms (20 Hz), fizyka idzie co tick 120 Hz.
function flyTo(ship, target, { seconds = 60, brainDt = 0.05, arrival = 60, face = NaN, speedMode = 'combat', refVx = 0, refVy = 0 } = {}) {
  const start = { x: ship.x, y: ship.y };
  const d0 = Math.hypot(target.x - start.x, target.y - start.y);
  const axisX = (target.x - start.x) / d0;
  const axisY = (target.y - start.y) / d0;
  let brainT = 0;
  let maxSpeed = 0;
  let arriveT = null;
  let overshoot = 0;
  let path = 0;
  let t = 0;
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    brainT -= DT;
    if (brainT <= 0) {
      brainT += brainDt;
      setFlightArrive(ship, target.x + refVx * t, target.y + refVy * t, {
        arrival, speedMode, face, refVx, refVy, faceNear: arrival, faceFar: arrival + 2500
      });
    }
    const px = ship.x;
    const py = ship.y;
    stepShipFlight(ship, DT);
    t += DT;
    path += Math.hypot(ship.x - px, ship.y - py);
    const relVx = ship.vx - refVx;
    const relVy = ship.vy - refVy;
    maxSpeed = Math.max(maxSpeed, Math.hypot(ship.vx, ship.vy));
    const gx = target.x + refVx * t;
    const gy = target.y + refVy * t;
    const d = Math.hypot(gx - ship.x, gy - ship.y);
    if (arriveT == null && d <= arrival + 20 && Math.hypot(relVx, relVy) < 30) arriveT = t;
    if (!refVx && !refVy) {
      const along = (ship.x - start.x) * axisX + (ship.y - start.y) * axisY;
      overshoot = Math.max(overshoot, along - d0);
    }
  }
  return { maxSpeed, arriveT, overshoot, path, d0 };
}

test('every hull in the spec table resolves and writes the legacy fields', () => {
  for (const hullId of Object.keys(SHIP_FLIGHT_SPECS)) {
    const type = hullId === 'atlas' ? 'atlas' : hullId.replace(/^(terran|pirate)_/, '');
    const ship = makeShip(hullId, type);
    const spec = resolveShipFlightSpec(ship);
    assert.ok(spec, `brak specyfikacji dla ${hullId}`);
    assert.equal(spec.hullId, hullId);
    assert.equal(ship.maxSpeed, spec.maxSpeed, `${hullId}: npc.maxSpeed musi być tą samą liczbą co spec`);
    assert.equal(ship.turn, spec.turnRate);
    assert.ok(spec.cruiseSpeed > spec.maxSpeed && spec.travelSpeed >= spec.cruiseSpeed);
  }
});

test('terran hull ladder gets heavier with every class', () => {
  const specs = TERRAN_LADDER.map(([hull, type]) => resolveShipFlightSpec(makeShip(hull, type)));
  for (let i = 1; i < specs.length; i++) {
    const a = specs[i - 1];
    const b = specs[i];
    assert.ok(a.maxSpeed > b.maxSpeed, `maxSpeed ${a.hullId} > ${b.hullId}`);
    assert.ok(a.accel > b.accel, `accel ${a.hullId} > ${b.hullId}`);
    assert.ok(a.turnRate > b.turnRate, `turnRate ${a.hullId} > ${b.hullId}`);
    assert.ok(flightTurnTime(a, Math.PI) < flightTurnTime(b, Math.PI), `zawrócenie ${a.hullId} < ${b.hullId}`);
  }
});

test('ships reach their spec speed, never exceed it and stop on the mark', () => {
  for (const [hull, type] of TERRAN_LADDER) {
    const ship = makeShip(hull, type);
    const spec = resolveShipFlightSpec(ship);
    const r = flyTo(ship, { x: 6000, y: 0 });
    assert.ok(r.maxSpeed >= spec.maxSpeed * 0.99, `${hull}: osiąga ${r.maxSpeed.toFixed(0)} z ${spec.maxSpeed}`);
    assert.ok(r.maxSpeed <= spec.maxSpeed + 1e-6, `${hull}: przekracza limit (${r.maxSpeed})`);
    assert.ok(r.arriveT != null, `${hull}: nie dojechał`);
    // Profil trapezowy: rozpędzanie + przelot + hamowanie. Pilot może być
    // wolniejszy przez zapas hamowania i łagodną końcówkę, ale nie „pełzać".
    const ideal = spec.maxSpeed / spec.accel / 2 + 6000 / spec.maxSpeed + spec.maxSpeed / spec.decel / 2;
    assert.ok(r.arriveT < ideal * 1.35, `${hull}: dojazd ${r.arriveT.toFixed(1)} s, teoria ${ideal.toFixed(1)} s`);
    assert.ok(r.overshoot < 80, `${hull}: przestrzelił o ${r.overshoot.toFixed(0)} u`);
  }
});

test('a target behind the ship is reached without orbiting or flying away', () => {
  for (const [hull, type] of TERRAN_LADDER) {
    const ship = makeShip(hull, type);
    const r = flyTo(ship, { x: -4000, y: 0 });
    assert.ok(r.arriveT != null, `${hull}: nie zawrócił do celu za rufą`);
    // Krążenie wydłuża trasę — tu ma być praktycznie odcinek prosty.
    assert.ok(r.path < r.d0 * 1.1, `${hull}: trasa ${r.path.toFixed(0)} przy dystansie ${r.d0}`);
  }
});

test('180 degree turn matches the spec time without wobble', () => {
  for (const [hull, type] of TERRAN_LADDER) {
    const ship = makeShip(hull, type);
    const spec = resolveShipFlightSpec(ship);
    const target = Math.PI - 1e-3;
    setFlightStop(ship, target);
    let doneT = null;
    let overshoot = 0;
    let flips = 0;
    let lastSign = 0;
    for (let i = 0; i < 120 * 30; i++) {
      stepShipFlight(ship, DT);
      const err = Math.abs(wrapFlightAngle(target - ship.angle));
      if (doneT == null && err < 0.02) doneT = (i + 1) * DT;
      if (doneT != null) overshoot = Math.max(overshoot, err);
      if (Math.abs(ship.angVel) > 0.005) {
        const sign = Math.sign(ship.angVel);
        if (lastSign && sign !== lastSign) flips++;
        lastSign = sign;
      }
    }
    const ideal = flightTurnTime(spec, Math.PI);
    assert.ok(doneT != null, `${hull}: nie obrócił się`);
    assert.ok(Math.abs(doneT - ideal) < ideal * 0.15, `${hull}: obrót ${doneT.toFixed(2)} s, spec ${ideal.toFixed(2)} s`);
    assert.ok(overshoot < 3 * Math.PI / 180, `${hull}: przeregulowanie ${(overshoot * 180 / Math.PI).toFixed(2)}°`);
    assert.ok(flips <= 1, `${hull}: ${flips} zmian kierunku obrotu (drżenie)`);
  }
});

test('ships without side thrust relocate sideways slower but still arrive while facing the enemy', () => {
  const frigate = makeShip('terran_frigate', 'frigate_pd');
  const battleship = makeShip('terran_battleship', 'battleship');
  const rf = flyTo(frigate, { x: 0, y: 3000 }, { face: 0 });
  const rb = flyTo(battleship, { x: 0, y: 3000 }, { face: 0 });
  assert.ok(rf.arriveT != null && rb.arriveT != null);
  assert.ok(rb.arriveT > rf.arriveT * 1.5, `pancernik ${rb.arriveT.toFixed(1)} s vs fregata ${rf.arriveT.toFixed(1)} s`);
  // Na pozycji kadłub trzyma zadany kierunek (burta/dziób na wroga).
  assert.ok(Math.abs(wrapFlightAngle(battleship.angle)) < 0.05);
});

test('ship keeps station on a moving reference point', () => {
  const ship = makeShip('terran_destroyer', 'destroyer');
  const refVx = 300;
  const refVy = -120;
  flyTo(ship, { x: 2500, y: 800 }, { seconds: 30, refVx, refVy, arrival: 80 });
  const t = 30;
  const gx = 2500 + refVx * t;
  const gy = 800 + refVy * t;
  assert.ok(Math.hypot(gx - ship.x, gy - ship.y) < 80 + 40, 'zgubił ruchomy punkt');
  assert.ok(Math.hypot(ship.vx - refVx, ship.vy - refVy) < 25, 'nie dopasował prędkości');
});

test('brain cadence does not change how fast a ship flies', () => {
  const a = makeShip('terran_battleship', 'battleship');
  const b = makeShip('terran_battleship', 'battleship');
  const ra = flyTo(a, { x: 5000, y: 2000 }, { brainDt: DT });
  const rb = flyTo(b, { x: 5000, y: 2000 }, { brainDt: 0.05 });
  assert.ok(ra.arriveT != null && rb.arriveT != null);
  assert.ok(Math.abs(ra.arriveT - rb.arriveT) < ra.arriveT * 0.05, `${ra.arriveT} vs ${rb.arriveT}`);
});

test('collision overspeed and spin decay with the spec rates', () => {
  const ship = makeShip('terran_battleship', 'battleship');
  const spec = resolveShipFlightSpec(ship);
  ship.vx = spec.maxSpeed * 3;
  ship.angVel = 3;
  setFlightStop(ship);
  let maxSpeedAfter1s = 0;
  for (let i = 0; i < 120 * 12; i++) {
    stepShipFlight(ship, DT);
    if (i === 120) maxSpeedAfter1s = Math.hypot(ship.vx, ship.vy);
  }
  assert.ok(maxSpeedAfter1s < spec.maxSpeed * 3, 'governor nie ścina nadmiaru');
  assert.ok(Math.hypot(ship.vx, ship.vy) < 5, 'nie wyhamował');
  assert.ok(Math.abs(ship.angVel) < 0.01, 'nie wygasił obrotu po zderzeniu');
});

test('only mission warships use the flight model', () => {
  assert.equal(usesShipFlightModel(makeShip('terran_battleship', 'battleship')), true);
  assert.equal(usesShipFlightModel(makeShip('pirate_frigate', 'frigate_laser', { isPirate: true })), true);
  assert.equal(usesShipFlightModel({ type: 'interceptor', fighter: true, mission: true }), false);
  assert.equal(usesShipFlightModel({ type: 'freighter-medium', isCargoVan: true, mission: true }), false);
  assert.equal(usesShipFlightModel({ type: 'megafreighter_head', shipFrame: 'megafreighter', staticDummy: true, mission: true }), false);
  assert.equal(usesShipFlightModel({ type: 'battleship', shipFrame: 'terran_battleship' }), false, 'ruch cywilny/poza misją zostaje przy starej ścieżce');
  assert.equal(usesShipFlightModel({ type: 'corvette', mission: true }), false, 'nieznany typ nie może udawać Atlasa');
});

test('separation pushes an idle ship without spinning its hull', () => {
  const ship = makeShip('terran_battleship', 'battleship');
  ship.angle = 0.3;
  setFlightStop(ship);
  setFlightSeparation(ship, 0, 400); // sąsiad pcha w bok
  for (let i = 0; i < 120 * 5; i++) stepShipFlight(ship, DT);
  assert.ok(Math.abs(ship.angle - 0.3) < 1e-3, `kadłub obrócił się o ${(ship.angle - 0.3).toFixed(3)} rad`);
  assert.ok(ship.y > 50, 'separacja nie przesunęła okrętu');
});
