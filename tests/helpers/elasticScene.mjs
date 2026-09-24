// Scena porównawcza sprężystości: taran, łańcuch pchnięć i seria trafień,
// z zaseedowaną losowością i zegarem. Zwraca pełny stan heksów (wgniecenia,
// siatka, pieczenie, hp) — do porównania dwóch trybów simulateElasticity.
import { DestructorSystem as D, DESTRUCTOR_CONFIG as C, disposeHexBody } from '../../src/game/destructor.js';
import { makeDestructorHull as hull } from './destructorHull.mjs';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function snapshotShards(e) {
  const shards = e.hexGrid.shards;
  const out = new Float64Array(shards.length * 11);
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    const o = i * 11;
    out[o] = s.targetDeformation.x;
    out[o + 1] = s.targetDeformation.y;
    out[o + 2] = s.deformation.x;
    out[o + 3] = s.deformation.y;
    out[o + 4] = s.gridX;
    out[o + 5] = s.gridY;
    out[o + 6] = Number(s._bakedOffX) || 0;
    out[o + 7] = Number(s._bakedOffY) || 0;
    out[o + 8] = s.hp;
    out[o + 9] = s.active ? 1 : 0;
    out[o + 10] = s.isDebris ? 1 : 0;
  }
  return out;
}

/**
 * @param {object} opts
 *   elasticActiveList — wartość DESTRUCTOR_CONFIG.elasticActiveList na czas sceny
 *   ticks             — liczba kroków fizyki 120 Hz
 *   onVisuals(entities, tick) — opcjonalny hak po każdym updateVisuals
 */
export function runElasticScene({ elasticActiveList = 1, ticks = 360, onVisuals = null } = {}) {
  const prev = {
    mode: C.elasticActiveList,
    random: Math.random,
    tick: D._tick,
    simTime: D._simulationTime,
    drift: D._driftCursor
  };
  let clock = 1000;
  C.elasticActiveList = elasticActiveList;
  Math.random = seeded(4321);
  Object.defineProperty(performance, 'now', { value: () => clock, configurable: true, writable: true });
  D._tick = 0;
  D._simulationTime = 0;
  D._driftCursor = 0;

  const entities = [
    hull({ width: 160, height: 60, x: 0, y: 0, vx: 360, mass: 60000 }),
    hull({ width: 160, height: 60, x: 150, y: 0, mass: 60000 }),
    hull({ width: 160, height: 60, x: 300, y: 0, mass: 60000 }),
    hull({ width: 120, height: 50, x: 150, y: 420, vx: 30 }),
    hull({ width: 240, height: 110, x: -1500, y: 800, angle: 0.4 }),
    hull({ width: 120, height: 50, x: 2500, y: -900, angle: -1.1 })
  ];
  const rand = seeded(99);
  const dt = 1 / 120;
  let impacts = 0;
  try {
    for (let tick = 0; tick < ticks; tick++) {
      for (const e of entities) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.angle += e.angVel * dt;
      }
      D.update(dt, entities);
      // Trafienia w kadłuby poza taranem — wgniecenia rozchodzą się sprężyście.
      if (tick % 9 === 0) {
        const target = entities[4 + (tick % 2)];
        const grid = target.hexGrid;
        const shards = grid.shards;
        const s = shards[Math.floor(rand() * shards.length)];
        if (s && s.active) {
          const lx = s.gridX - grid.srcWidth * 0.5;
          const ly = s.gridY - grid.srcHeight * 0.5;
          const c = Math.cos(target.angle);
          const sn = Math.sin(target.angle);
          const wx = target.x + lx * c - ly * sn;
          const wy = target.y + lx * sn + ly * c;
          const a = rand() * Math.PI * 2;
          D.applyImpact(target, wx, wy, 40 + rand() * 260, { x: Math.cos(a) * 3000, y: Math.sin(a) * 3000 });
          impacts++;
        }
      }
      if (tick % 2 === 0) {
        D.updateVisuals(1 / 60, entities);
        if (onVisuals) onVisuals(entities, tick);
      }
      clock += 1000 / 120;
    }
    return { shards: entities.map(snapshotShards), impacts };
  } finally {
    for (const e of entities) disposeHexBody(e);
    C.elasticActiveList = prev.mode;
    Math.random = prev.random;
    delete performance.now;
    D._tick = prev.tick;
    D._simulationTime = prev.simTime;
    D._driftCursor = prev.drift;
  }
}
