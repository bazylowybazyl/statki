import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import {
  createCrashBodies, buildFallbackStationTris, DEFAULT_CRASH_SPEED,
  CRASH_BREAK_MULTIPLIER, STATION_MASS_RATIO, createCrashFleet, launchCrashPairs, STRESS_PAIR_COUNT
} from '../src/game/beamCrashScene3D.js';
import { loadStationTriangles, buildCrashStructures } from './helpers/beamCrashScene.mjs';
import { voxelizeTriangles, packKey } from '../src/game/voxelBody3D.js';

const stationTriangles = await loadStationTriangles();
const actual = buildCrashStructures(stationTriangles);

test('actual station reinforcements never cross exterior gaps between decks', () => {
  const full = voxelizeTriangles(stationTriangles.positions, stationTriangles.colors,
    { cellSize: actual.cellSize, shellLayers: 0 });
  const occupied = new Set(full.cells.map(n => packKey(n.ix, n.iy, n.iz)));
  for (const beam of actual.station.beams) {
    if (beam.type < 2) continue;
    const a = actual.station.nodes[beam.a], b = actual.station.nodes[beam.b];
    const steps = Math.ceil(beam.rest / actual.cellSize * 32);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const key = packKey(Math.round(a.ix + (b.ix - a.ix) * t),
        Math.round(a.iy + (b.iy - a.iy) * t), Math.round(a.iz + (b.iz - a.iz) * t));
      assert.ok(occupied.has(key), `beam ${beam.a}-${beam.b} (type ${beam.type}) bridges exterior space`);
    }
  }
});

function crash(structures, { speed = DEFAULT_CRASH_SPEED, near = false, heavyShip = false } = {}) {
  const cfg = createBeamConfig(structures.cellSize);
  cfg.globalBreakMul = CRASH_BREAK_MULTIPLIER;
  D.init(cfg);
  D.onDebris = null;
  const bodies = createCrashBodies(D, structures.station, structures.ship, { heavyShip });
  const [station, ship] = bodies;
  const target = heavyShip ? station : ship;
  const heavy = heavyShip ? ship : station;
  const heavyNodesBefore = heavy.activeNodes;
  const targetNodesBefore = target.activeNodes;
  assert.ok(Math.abs(heavy.mass / target.mass - STATION_MASS_RATIO) < 1e-6);
  if (near) ship.pos.x = 90;
  ship.vel.x = -speed;
  const stationState = JSON.stringify([station.pos, station.quat, station.vel, station.angVel]);
  let fragments = 0, contacts = 0, maxDeformation = 0;
  let debris = 0;
  D.onDebris = () => debris++;
  try {
    for (let i = 0; i < 480; i++) {
      D.integrate(1 / 120, bodies);
      D.update(1 / 120, bodies);
      contacts += D.perf.contacts;
      fragments = Math.max(fragments, bodies.filter(b => b.isWreck && !b.dead).length);
      for (const n of target.nodes) {
        if (n.active) maxDeformation = Math.max(maxDeformation, Math.hypot(n.x - n.ox, n.y - n.oy, n.z - n.oz));
      }
    }
    if (!heavyShip) {
      assert.equal(JSON.stringify([station.pos, station.quat, station.vel, station.angVel]), stationState);
      assert.equal(station.liveBeams, structures.station.beams.length);
      for (const n of station.nodes) assert.deepEqual([n.x, n.y, n.z], [n.ox, n.oy, n.oz]);
    }
    for (const body of bodies) {
      for (const value of [...Object.values(body.pos), ...Object.values(body.vel),
        ...Object.values(body.quat), ...Object.values(body.angVel)]) assert.ok(Number.isFinite(value));
      for (const n of body.nodes) assert.ok(Number.isFinite(n.x + n.y + n.z + n.vx + n.vy + n.vz));
    }
    const live = bodies.filter(b => b !== heavy && !b.dead);
    return { fragments, contacts, maxDeformation, debris, broken: D.perf.beamsBroken,
      largest: Math.max(...live.map(b => b.activeNodes)) / targetNodesBefore,
      heavyLoss: (heavyNodesBefore - heavy.activeNodes) / heavyNodesBefore,
      stationTravel: Math.hypot(station.pos.x, station.pos.y, station.pos.z),
      largestWreck: Math.max(0, ...live.filter(b => b.isWreck).map(b => b.activeNodes)),
      spinning: live.filter(b => b.isWreck && Math.hypot(b.angVel.x, b.angVel.y, b.angVel.z) > 0.03).length,
      plastic: live.reduce((sum, b) => sum + b.beams.filter(beam => Math.abs(beam.rest - beam.restBase) > 1e-4).length, 0) };
  } finally { D.onDebris = null; }
}

test('default demo ship crumples and separates against the actual anchored earth-station GLB', () => {
  const result = crash(actual);
  assert.ok(result.contacts > 0, JSON.stringify(result));
  assert.ok(result.fragments >= 4, JSON.stringify(result));
  assert.ok(result.largest < 0.65, JSON.stringify(result));
  assert.ok(result.maxDeformation > actual.cellSize * 3, JSON.stringify(result));
  assert.ok(result.plastic > 0 && result.spinning > 0 && result.debris > 0, JSON.stringify(result));
});

test('gentle contact with the same station does not shatter the ship', () => {
  const result = crash(actual, { speed: 10, near: true });
  assert.ok(result.contacts > 0, 'this must exercise contact, not just free flight');
  assert.equal(result.fragments, 0);
  assert.equal(result.broken, 0);
  assert.equal(result.largest, 1);
});

test('reversing masses lets the intact heavy ship tear apart the movable station', () => {
  const result = crash(actual, { heavyShip: true });
  assert.ok(result.contacts > 0 && result.fragments >= 4, JSON.stringify(result));
  assert.ok(result.largest < 0.8 && result.largestWreck > 40, JSON.stringify(result));
  assert.equal(result.heavyLoss, 0, 'the massive ship should keep its hull');
  assert.ok(result.stationTravel > 1 && result.spinning > 0, JSON.stringify(result));
});

test('the mass ratio control works in both directions and scales inertia consistently', () => {
  D.init(createBeamConfig(actual.cellSize));
  for (const heavyShip of [false, true]) {
    for (const massRatio of [10, 1000, 100000]) {
      const [station, ship] = createCrashBodies(D, actual.station, actual.ship, { heavyShip, massRatio });
      const heavy = heavyShip ? ship : station, light = heavyShip ? station : ship;
      assert.ok(Math.abs(heavy.mass / light.mass - massRatio) < 1e-6);
      assert.equal(station.static, !heavyShip);
      assert.equal(station.noSplit, !heavyShip);
      assert.equal(ship.static, false);
      for (const body of [station, ship]) {
        assert.ok(Math.abs(body.mass - body.nodes.reduce((sum, n) => sum + n.mass, 0)) / body.mass < 1e-12);
        assert.ok(body.invInertiaLocal.every(Number.isFinite));
      }
    }
  }
});

test('fallback geometry also supports a destructive crash with bounded fragments', () => {
  const result = crash(buildCrashStructures(buildFallbackStationTris()));
  assert.ok(result.fragments >= 3 && result.fragments <= D.config.maxWrecks, JSON.stringify(result));
  assert.ok(result.largest < 0.8 && result.broken > 1000, JSON.stringify(result));
});

test('reset clones pristine nodes, beam lengths, mass and contact state', () => {
  D.init(createBeamConfig(actual.cellSize));
  const first = createCrashBodies(D, actual.station, actual.ship);
  first[1].nodes[0].x += 40;
  first[1].beams[0].broken = true;
  first[1].beams[1].rest *= 0.5;
  const second = createCrashBodies(D, actual.station, actual.ship);
  assert.equal(second[0].mass, first[0].mass, 'station mass must not multiply on each reset');
  assert.equal(second[1].nodes[0].x, second[1].nodes[0].ox);
  assert.equal(second[1].beams[0].broken, false);
  assert.equal(second[1].beams[1].rest, second[1].beams[1].restBase);
  assert.notEqual(second[1].nodes[0].beams, first[1].nodes[0].beams);
  assert.equal(second[0].invMass, 0);
  assert.equal(second[0].noSplit, true);
});

test('stress fleet launches ten independent pairs with no initial overlap, then every station breaks', () => {
  const cfg = createBeamConfig(actual.cellSize);
  cfg.globalBreakMul = CRASH_BREAK_MULTIPLIER;
  cfg.maxWrecks *= STRESS_PAIR_COUNT;
  D.init(cfg);
  const fleet = createCrashFleet(D, actual.station, actual.ship, { pairCount: STRESS_PAIR_COUNT, heavyShip: true });
  assert.equal(fleet.bodies.length, 20);
  assert.equal(fleet.pairs.length, 10);
  for (let i = 0; i < fleet.bodies.length; i++) {
    const a = fleet.bodies[i];
    for (let j = i + 1; j < fleet.bodies.length; j++) {
      const b = fleet.bodies[j];
      assert.ok(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) > a.radius + b.radius);
      assert.notEqual(a.nodes[0], b.nodes[0]);
      assert.notEqual(a.beams[0], b.beams[0]);
    }
    assert.ok(a.pos.x - a.radius >= fleet.bounds.minX && a.pos.x + a.radius <= fleet.bounds.maxX);
    assert.ok(a.pos.z - a.radius >= fleet.bounds.minZ && a.pos.z + a.radius <= fleet.bounds.maxZ);
  }
  assert.equal(launchCrashPairs(D, fleet.pairs), 10);
  for (const { ship } of fleet.pairs) assert.equal(ship.vel.x, -DEFAULT_CRASH_SPEED);
  for (let i = 0; i < 240; i++) {
    D.integrate(1 / 120, fleet.bodies);
    D.update(1 / 120, fleet.bodies);
  }
  for (const { station, ship } of fleet.pairs) {
    assert.ok(station.activeNodes < actual.station.nodes.length, `${station.name} must lose hull sections`);
    assert.equal(ship.activeNodes, actual.ship.nodes.length, `${ship.name} must remain the heavy ram`);
  }
  assert.ok(fleet.bodies.filter(b => b.isWreck).length <= cfg.maxWrecks);
  for (const b of fleet.bodies) {
    assert.ok(Object.values(b.pos).every(Number.isFinite));
    assert.ok(b.nodes.every(n => Number.isFinite(n.x + n.y + n.z)));
  }
});
