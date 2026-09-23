// CPU benchmark, independent of browser frame throttling and rendering.
// node scripts/benchmark-beams3d.mjs [--pairs=10] [--ticks=240] [--heavy=ship|station]
import { performance } from 'node:perf_hooks';
import { loadGlbModel, loadStationModel } from '../tests/helpers/beamCrashScene.mjs';
import { buildModelBeamStructure, disposeModelResources } from '../src/3d/beamModel3D.js';
import { createCrashFleet, launchCrashPairs } from '../src/game/beamCrashScene3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';

const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const pairs = Math.min(10, Math.max(1, Number(option('pairs', 10))));
const ticks = Math.max(1, Number(option('ticks', 240)));
const heavyShip = option('heavy', 'ship') === 'ship';
const cs = 120 / 44;
const stationRoot = await loadStationModel();
const shipRoot = await loadGlbModel(new URL('../venator.glb', import.meta.url));
try {
  const station = buildModelBeamStructure(stationRoot, { targetSize: 120, cellSize: cs });
  const ship = buildModelBeamStructure(shipRoot, { targetSize: 50.4, cellSize: cs * 0.9, forwardAxis: 'auto' });
  const cfg = createBeamConfig(cs);
  cfg.globalBreakMul = 0.6;
  cfg.maxWrecks *= pairs;
  D.init(cfg);
  const fleet = createCrashFleet(D, station, ship, { pairCount: pairs, heavyShip });
  launchCrashPairs(D, fleet.pairs);
  const samples = new Float64Array(ticks);
  let solver = 0, collision = 0, split = 0, contacts = 0;
  const started = performance.now();
  for (let i = 0; i < ticks; i++) {
    const t = performance.now();
    D.integrate(1 / 120, fleet.bodies);
    D.update(1 / 120, fleet.bodies);
    samples[i] = performance.now() - t;
    solver += D.perf.lastSolverMs;
    collision += D.perf.lastCollisionMs;
    split += D.perf.lastSplitMs;
    contacts += D.perf.contacts;
  }
  const wallMs = performance.now() - started;
  samples.sort();
  const rounded = n => Math.round(n * 100) / 100;
  console.log(JSON.stringify({ pairs, ticks, heavyShip, simulationMs: rounded(ticks / 120 * 1000),
    wallMs: rounded(wallMs), stepMeanMs: rounded(wallMs / ticks), stepP95Ms: rounded(samples[Math.ceil(ticks * 0.95) - 1]),
    stepMaxMs: rounded(samples[ticks - 1]), solverMeanMs: rounded(solver / ticks), collisionMeanMs: rounded(collision / ticks),
    splitMeanMs: rounded(split / ticks), contacts, broken: D.perf.beamsBroken,
    fragments: fleet.bodies.filter(b => b.isWreck && !b.dead).length,
    damagedTargets: fleet.pairs.filter(p => (heavyShip ? p.station : p.ship).activeNodes < (heavyShip ? station : ship).nodes.length).length,
    finite: fleet.bodies.every(b => Object.values(b.pos).every(Number.isFinite) && b.nodes.every(n => Number.isFinite(n.x + n.y + n.z)))
  }, null, 2));
} finally { disposeModelResources(stationRoot); disposeModelResources(shipRoot); }
