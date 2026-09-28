// Ta sama scena na silniku CPU (DestructorBeams3D) — odniesienie dla pomiarów i porównań GPU.
// Budowa sceny 1:1 jak destruktor2d.html (pozycje, gęstość, podkroki), bez renderu.
import { DestructorBeams3D as D, createBeamConfig } from '../../src/game/destructorBeams3D.js';
import { buildSpriteBeamStructure } from '../../src/game/beamSprite2D.js';
import { cloneBeamStructure } from '../../src/game/beamCrashScene3D.js';
import { setPlanarHeading } from '../../src/game/beamFlightControls2D.js';

const ATLAS_MASS = 800000;
const DUMMY_GAP = 420;
const FIXED_DT = 1 / 120;

const cache = new Map();
function structure(hull, cellSize, frames, bulkheads) {
  const cellsAlong = Math.max(4, Math.round(hull.w / cellSize));
  const key = `${hull.id}|${cellsAlong}|${frames}|${bulkheads}`;
  if (!cache.has(key)) {
    cache.set(key, buildSpriteBeamStructure(hull.imageData, { key: hull.id, textureSource: null, worldLength: hull.w, cellsAlong,
      frameStride: frames, bulkheadEvery: bulkheads }));
  }
  return cache.get(key);
}

const FLEET = [['atlas', 2], ['terran_carrier', 4], ['terran_battleship', 5], ['pirate_battleship', 5],
  ['terran_destroyer', 10], ['pirate_destroyer', 10], ['terran_frigate', 15], ['pirate_frigate', 15], ['long_haul_freighter', 6]];

/**
 * Flota jak scene 'fleet' / 'fleet-ram' dema GPU (i scripts/bench-belki-flota.mjs): te same pozycje, kursy, prędkości.
 * @param {object} o { hulls: { id: hull }, cellSize, frames, bulkheads, local, ramPairs }
 */
export function createCpuFleet(o) {
  const cfg = createBeamConfig(o.cellSize);
  Object.assign(cfg, { planar: true, maxContacts: 384, crushStrength: 300000, globalBreakMul: 0.6, localSolver: !!o.local });
  D.init(cfg);
  D.onDebris = null;
  D.splitQueue.length = 0;
  D.perf.beamsBroken = 0;
  const density = ATLAS_MASS / structure(o.hulls.atlas, o.cellSize, o.frames, o.bulkheads).mass;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let list = [];
  let slot = 0;
  for (const [id, count] of FLEET) {
    const s = structure(o.hulls[id], o.cellSize, o.frames, o.bulkheads);
    for (let i = 0; i < count; i++, slot++) {
      const b = D.createBody(cloneBeamStructure(s), { name: id, massMultiplier: density });
      b.pos.x = (slot % 9) * 4200; b.pos.y = Math.floor(slot / 9) * 4200;
      const heading = rnd() * Math.PI * 2, speed = 150 + rnd() * 250;
      setPlanarHeading(b, heading);
      b.vel.x = Math.cos(heading) * speed; b.vel.y = Math.sin(heading) * speed;
      list.push(b);
    }
  }
  for (let p = 0; p < (o.ramPairs || 0); p++) {
    const s = structure(o.hulls[p % 2 ? 'pirate_battleship' : 'terran_battleship'], o.cellSize, o.frames, o.bulkheads);
    const a = D.createBody(cloneBeamStructure(s), { massMultiplier: density });
    const b = D.createBody(cloneBeamStructure(s), { massMultiplier: density });
    a.pos.x = -20000; a.pos.y = p * 3000;
    b.pos.x = -19100; b.pos.y = p * 3000;
    setPlanarHeading(b, Math.PI / 2);
    a.vel.x = 900;
    list.push(a, b);
  }
  const travel = 8 * o.cellSize / 15;
  return {
    get bodies() { return list; },
    step(n = 1) {
      const times = [];
      for (let k = 0; k < n; k++) {
        const t0 = performance.now();
        let maxSpeed = 0;
        for (const b of list) if (!b.dead && !b.static) maxSpeed = Math.max(maxSpeed, Math.hypot(b.vel.x, b.vel.y));
        const subs = Math.min(50, Math.max(1, Math.ceil(maxSpeed * FIXED_DT / travel)));
        for (let s = 0; s < subs; s++) {
          D.integrate(FIXED_DT / subs, list);
          D.update(FIXED_DT / subs, list);
        }
        let changed = false;
        for (const b of list) if (!b.dead && b.activeNodes <= 0) { b.dead = true; changed = true; }
        if (changed) list = list.filter((b) => !b.dead);
        times.push({ ms: performance.now() - t0, substeps: subs });
      }
      return times;
    },
    summary() {
      let nodes = 0, wrecks = 0;
      for (const b of list) { nodes += b.activeNodes; if (b.isWreck) wrecks++; }
      return { bodies: list.length, nodes, wrecks, beamsBroken: D.perf.beamsBroken };
    }
  };
}

/**
 * @param {object} o { atlasHull, dummyHull, cellSize, frames, bulkheads, speed, pose (rad), massMul, local, cfg (suwaki) }
 * @returns {{ bodies, step(n), summary() }}
 */
export function createCpuRam(o) {
  const cfg = createBeamConfig(o.cellSize);
  cfg.planar = true;
  cfg.maxContacts = 384;
  cfg.localSolver = !!o.local;
  Object.assign(cfg, o.cfg || {});
  D.init(cfg);
  D.onDebris = null;
  D.splitQueue.length = 0;
  D.perf.beamsBroken = 0;
  const atlasS = structure(o.atlasHull, o.cellSize, o.frames, o.bulkheads);
  const density = ATLAS_MASS / atlasS.mass;
  const atlas = D.createBody(cloneBeamStructure(atlasS), { name: 'Atlas', massMultiplier: density });
  const bodies = [atlas];
  const ab = atlas._localBounds;
  let dummy = null;
  if (o.dummyHull) {
    dummy = D.createBody(cloneBeamStructure(structure(o.dummyHull, o.cellSize, o.frames, o.bulkheads)),
      { name: 'kukła', massMultiplier: density * (o.massMul || 1) });
    const pose = o.pose;
    setPlanarHeading(dummy, pose);
    const db = dummy._localBounds;
    const c = Math.cos(pose), s = Math.sin(pose);
    const reachX = Math.abs(c) * db[3] + Math.abs(s) * db[4];
    const centerX = c * db[0] - s * db[1], centerY = s * db[0] + c * db[1];
    dummy.pos.x = ab[0] + ab[3] + DUMMY_GAP + reachX - centerX;
    dummy.pos.y = -centerY;
    bodies.push(dummy);
  }
  const heading = dummy ? Math.atan2(dummy.pos.y - atlas.pos.y, dummy.pos.x - atlas.pos.x) : 0;
  setPlanarHeading(atlas, heading);
  atlas.vel.x = Math.cos(heading) * o.speed;
  atlas.vel.y = Math.sin(heading) * o.speed;
  D.wake(atlas, 60);
  let list = bodies;
  const travel = 8 * o.cellSize / 15;
  let contactSteps = 0;
  return {
    get bodies() { return list; },
    atlas, dummy,
    step(n = 1) {
      const times = [];
      for (let k = 0; k < n; k++) {
        const t0 = performance.now();
        let maxSpeed = 0;
        for (const b of list) if (!b.dead && !b.static) maxSpeed = Math.max(maxSpeed, Math.hypot(b.vel.x, b.vel.y));
        const subs = Math.min(50, Math.max(1, Math.ceil(maxSpeed * FIXED_DT / travel)));
        const h = FIXED_DT / subs;
        let contact = false;
        for (let s = 0; s < subs; s++) {
          D.integrate(h, list);
          D.update(h, list);
          if (D.perf.contacts > 0) contact = true;
        }
        if (contact) contactSteps++;
        let changed = false;
        for (const b of list) if (!b.dead && b.activeNodes <= 0) { b.dead = true; changed = true; }
        if (changed) list = list.filter((b) => !b.dead);
        times.push({ ms: performance.now() - t0, substeps: subs });
      }
      return times;
    },
    summary() {
      const out = { bodies: [], beamsBroken: D.perf.beamsBroken, contactSteps };
      for (const b of list) {
        const s = b.nodeStore;
        let sum = 0, max = 0, alive = 0;
        for (let i = 0; i < s.count; i++) {
          if (!s.active[i]) continue;
          const d = Math.hypot(s.x[i] - s.ox[i], s.y[i] - s.oy[i]);
          sum += d; max = Math.max(max, d); alive++;
        }
        out.bodies.push({ name: b.name, x: b.pos.x, y: b.pos.y, vx: b.vel.x, vy: b.vel.y, w: b.angVel.z, mass: b.mass,
          active: b.activeNodes, wreck: !!b.isWreck, dispMean: sum / Math.max(1, alive), dispMax: max });
      }
      return out;
    }
  };
}
