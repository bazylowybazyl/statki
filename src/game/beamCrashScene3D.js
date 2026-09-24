import { makeBoxTriangles, concatTriangleSets } from './voxelBody3D.js';
import { cloneBeamNode, cloneBeam } from './beamBody3D.js';

export const CRASH_TARGET_SIZE = 120;
export const STATION_MASS_RATIO = 100000;
export const DEFAULT_CRASH_SPEED = 300;
export const CRASH_BREAK_MULTIPLIER = 0.6;
export const STRESS_PAIR_COUNT = 10;

export function buildRamShipTriangles(size = CRASH_TARGET_SIZE * 0.42) {
  const L = size;
  return concatTriangleSets([
    { positions: makeBoxTriangles(L * 0.86, L * 0.24, L * 0.30, -L * 0.05, 0, 0), color: [0.55, 0.58, 0.66] },
    { positions: makeBoxTriangles(L * 0.34, L * 0.15, L * 0.18, L * 0.48, 0, 0), color: [0.75, 0.44, 0.28] },
    { positions: makeBoxTriangles(L * 0.40, L * 0.06, L * 0.72, -L * 0.18, 0.02 * L, 0), color: [0.36, 0.45, 0.58] },
    { positions: makeBoxTriangles(L * 0.24, L * 0.14, L * 0.14, -L * 0.46, 0, L * 0.20), color: [0.30, 0.62, 0.86] },
    { positions: makeBoxTriangles(L * 0.24, L * 0.14, L * 0.14, -L * 0.46, 0, -L * 0.20), color: [0.30, 0.62, 0.86] },
    { positions: makeBoxTriangles(L * 0.30, L * 0.30, L * 0.10, -L * 0.02, L * 0.20, 0), color: [0.48, 0.52, 0.60] }
  ]);
}

export function buildFallbackStationTris() {
  const S = CRASH_TARGET_SIZE;
  return concatTriangleSets([
    { positions: makeBoxTriangles(S * 0.9, S * 0.34, S * 0.34), color: [0.5, 0.54, 0.62] },
    { positions: makeBoxTriangles(S * 0.3, S * 0.62, S * 0.62), color: [0.42, 0.48, 0.6] },
    { positions: makeBoxTriangles(S * 0.22, S * 0.22, S * 0.95, S * 0.25, 0, 0), color: [0.62, 0.5, 0.34] },
    { positions: makeBoxTriangles(S * 0.22, S * 0.95, S * 0.22, -S * 0.25, 0, 0), color: [0.34, 0.56, 0.62] }
  ]);
}

export function cloneBeamStructure(src) {
  return {
    ...src,
    nodes: src.nodes.map(cloneBeamNode),
    beams: src.beams.map(b => cloneBeam(b)),
    invInertia: src.invInertia.slice()
  };
}

export function createCrashBodies(system, stationStructure, ramStructure, options = {}) {
  const { heavyShip = false, rammingMassMult = 1, combat = false } = options;
  const massRatio = Math.max(1, Number(options.massRatio) || STATION_MASS_RATIO);
  const station = system.createBody(cloneBeamStructure(stationStructure), {
    name: 'stacja', static: !heavyShip && !combat, noSplit: !heavyShip && !combat,
    massMultiplier: heavyShip || combat ? 1 : massRatio * ramStructure.mass / stationStructure.mass
  });
  const ship = system.createBody(cloneBeamStructure(ramStructure), {
    name: 'statek',
    position: { x: station.radius + ramStructure.radius + CRASH_TARGET_SIZE * 0.45, y: 0, z: 0 },
    quaternion: { x: 0, y: 1, z: 0, w: 0 },
    massMultiplier: heavyShip && !combat ? massRatio * stationStructure.mass / ramStructure.mass : 1,
    rammingMassMult
  });
  return [station, ship];
}

export function createCrashFleet(system, stationStructure, ramStructure, options = {}) {
  const count = Math.max(1, Math.min(STRESS_PAIR_COUNT, options.pairCount | 0 || 1));
  const bodies = [], pairs = [];
  const columns = count > 1 ? 2 : 1, rows = Math.ceil(count / columns);
  const departure = stationStructure.radius + ramStructure.radius + CRASH_TARGET_SIZE * 0.45;
  const pitchX = departure + stationStructure.radius + ramStructure.radius + CRASH_TARGET_SIZE * 0.6;
  const pitchZ = 2 * Math.max(stationStructure.radius, ramStructure.radius) + CRASH_TARGET_SIZE * 0.75;
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < count; i++) {
    const [station, ship] = createCrashBodies(system, stationStructure, ramStructure, options);
    const x = count === 1 ? 0 : (i % columns - (columns - 1) / 2) * pitchX - departure / 2;
    const z = (Math.floor(i / columns) - (rows - 1) / 2) * pitchZ;
    station.pos.x += x; ship.pos.x += x;
    station.pos.z = ship.pos.z = z;
    station.name = `stacja-${i + 1}`; ship.name = `statek-${i + 1}`;
    bodies.push(station, ship);
    pairs.push({ station, ship });
    for (const b of [station, ship]) {
      bounds.minX = Math.min(bounds.minX, b.pos.x - b.radius); bounds.maxX = Math.max(bounds.maxX, b.pos.x + b.radius);
      bounds.minY = Math.min(bounds.minY, b.pos.y - b.radius); bounds.maxY = Math.max(bounds.maxY, b.pos.y + b.radius);
      bounds.minZ = Math.min(bounds.minZ, b.pos.z - b.radius); bounds.maxZ = Math.max(bounds.maxZ, b.pos.z + b.radius);
    }
  }
  return { bodies, pairs, bounds };
}

export function launchCrashPairs(system, pairs, speed = DEFAULT_CRASH_SPEED) {
  let launched = 0;
  for (const { station, ship } of pairs) {
    if (ship.dead || station.dead) continue;
    const dx = station.pos.x - ship.pos.x, dy = station.pos.y - ship.pos.y, dz = station.pos.z - ship.pos.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / len, ny = dy / len, nz = dz / len;
    // Kwaternion obracający lokalny dziób +X w stronę własnej stacji.
    const w = 1 + nx;
    if (w < 1e-8) Object.assign(ship.quat, { x: 0, y: 1, z: 0, w: 0 });
    else {
      const inv = 1 / Math.hypot(ny, nz, w);
      Object.assign(ship.quat, { x: 0, y: -nz * inv, z: ny * inv, w: w * inv });
    }
    ship._rotTick = -1;
    ship.vel.x = nx * speed; ship.vel.y = ny * speed; ship.vel.z = nz * speed;
    ship.angVel.x = ship.angVel.y = ship.angVel.z = 0;
    system.wake(ship, 60);
    launched++;
  }
  return launched;
}
