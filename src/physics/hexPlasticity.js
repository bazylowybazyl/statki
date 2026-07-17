import {
  HEX_NEIGHBOR_COUNT,
  rebuildHexBodyBoundary
} from './hexArena.js';

export const DEFAULT_PLASTICITY_CONFIG = Object.freeze({
  diffusionIterations: 12,
  diffusion: 0.46,
  retain: 0.72,
  drive: 0.085,
  spring: 0.055,
  damping: 0.82,
  yieldPoint: 0.35,
  plasticRate: 0.42,
  maxPlasticStep: 0.65,
  bulge: 0.025,
  tearThreshold: 13.5,
  maxOffset: 180
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function removeNeighborOneWay(arena, fromIndex, toIndex) {
  const base = fromIndex * HEX_NEIGHBOR_COUNT;
  for (let n = 0; n < HEX_NEIGHBOR_COUNT; n++) {
    if (arena.neighbors[base + n] !== toIndex) continue;
    arena.neighbors[base + n] = -1;
    return true;
  }
  return false;
}

export function createPlasticityScratch(capacity) {
  const safeCapacity = Math.max(1, Number(capacity) | 0);
  return {
    forceX: new Float32Array(safeCapacity),
    forceY: new Float32Array(safeCapacity),
    nextForceX: new Float32Array(safeCapacity),
    nextForceY: new Float32Array(safeCapacity)
  };
}

function ensureScratch(scratch, capacity) {
  if (
    !scratch ||
    !(scratch.forceX instanceof Float32Array) ||
    scratch.forceX.length < capacity
  ) {
    return createPlasticityScratch(capacity);
  }
  return scratch;
}

function clearMemberScratch(body, scratch) {
  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    scratch.forceX[index] = 0;
    scratch.forceY[index] = 0;
    scratch.nextForceX[index] = 0;
    scratch.nextForceY[index] = 0;
  }
}

function diffuseForces(arena, body, scratch, config) {
  const iterations = Math.max(0, Math.min(32, Number(config.diffusionIterations) | 0));
  const diffusion = clamp(finite(config.diffusion, 0.46), 0, 1);
  const retain = clamp(finite(config.retain, 0.72), 0, 1);

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let slot = 0; slot < body.memberCount; slot++) {
      const index = body.memberIndices[slot];
      if (!arena.isActive(index) || arena.bodyId[index] !== body.bodyId) continue;

      let sumX = 0;
      let sumY = 0;
      let neighborCount = 0;
      const base = index * HEX_NEIGHBOR_COUNT;
      for (let n = 0; n < HEX_NEIGHBOR_COUNT; n++) {
        const neighborIndex = arena.neighbors[base + n];
        if (neighborIndex < 0 || !arena.isActive(neighborIndex) || arena.bodyId[neighborIndex] !== body.bodyId) continue;
        sumX += scratch.forceX[neighborIndex];
        sumY += scratch.forceY[neighborIndex];
        neighborCount++;
      }
      const averageX = neighborCount > 0 ? sumX / neighborCount : 0;
      const averageY = neighborCount > 0 ? sumY / neighborCount : 0;
      scratch.nextForceX[index] = scratch.forceX[index] * retain + averageX * diffusion;
      scratch.nextForceY[index] = scratch.forceY[index] * retain + averageY * diffusion;
    }

    const swapX = scratch.forceX;
    scratch.forceX = scratch.nextForceX;
    scratch.nextForceX = swapX;
    const swapY = scratch.forceY;
    scratch.forceY = scratch.nextForceY;
    scratch.nextForceY = swapY;
  }
}

function applyPlasticMotion(arena, body, scratch, dt, config) {
  const stepScale = clamp(finite(dt, 1 / 120) * 120, 0.05, 4);
  const drive = Math.max(0, finite(config.drive, 0.085)) * stepScale;
  const spring = Math.max(0, finite(config.spring, 0.055)) * stepScale;
  const damping = Math.pow(clamp(finite(config.damping, 0.82), 0, 1), stepScale);
  const yieldPoint = Math.max(0, finite(config.yieldPoint, 0.35));
  const plasticRate = Math.max(0, finite(config.plasticRate, 0.42));
  const maxPlasticStep = Math.max(0.001, finite(config.maxPlasticStep, 0.65)) * stepScale;
  const maxOffset = Math.max(1, finite(config.maxOffset, 180));
  const bulge = Math.max(0, finite(config.bulge, 0.025)) * stepScale;
  const centerRow = Math.max(0, body.rows - 1) * 0.5;
  let changed = 0;

  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    if (!arena.isActive(index) || arena.bodyId[index] !== body.bodyId) continue;

    const forceX = scratch.forceX[index];
    const forceY = scratch.forceY[index];
    const offsetX = arena.baseX[index] - arena.restX[index];
    const offsetY = arena.baseY[index] - arena.restY[index];
    let velocityX = (arena.velocityX[index] + forceX * drive - offsetX * spring) * damping;
    let velocityY = (arena.velocityY[index] + forceY * drive - offsetY * spring) * damping;

    if (Math.abs(forceX) > yieldPoint || Math.abs(forceY) > yieldPoint) {
      const plasticX = clamp(forceX * drive * plasticRate, -maxPlasticStep, maxPlasticStep);
      let plasticY = clamp(forceY * drive * plasticRate, -maxPlasticStep, maxPlasticStep);

      if (Math.abs(forceX) > yieldPoint && body.rows > 1) {
        const rowDirection = (arena.cellR[index] - centerRow) / Math.max(1, centerRow);
        plasticY += Math.sign(rowDirection || 1) * Math.abs(forceX) * bulge * Math.abs(rowDirection);
      }

      const nextOffsetX = clamp(offsetX + plasticX, -maxOffset, maxOffset);
      const nextOffsetY = clamp(offsetY + plasticY, -maxOffset, maxOffset);
      if (Math.abs(nextOffsetX - offsetX) > 1e-6 || Math.abs(nextOffsetY - offsetY) > 1e-6) {
        arena.baseX[index] = arena.restX[index] + nextOffsetX;
        arena.baseY[index] = arena.restY[index] + nextOffsetY;
        arena.targetX[index] = arena.deformX[index];
        arena.targetY[index] = arena.deformY[index];
        arena.markDirty(index);
        changed++;
      }
    }

    if (Math.abs(velocityX) < 1e-5) velocityX = 0;
    if (Math.abs(velocityY) < 1e-5) velocityY = 0;
    arena.velocityX[index] = velocityX;
    arena.velocityY[index] = velocityY;
  }
  return changed;
}

function tearOverstretchedBonds(arena, body, config) {
  const tearThreshold = Math.max(0, finite(config.tearThreshold, 13.5));
  if (tearThreshold <= 0) return 0;
  let tears = 0;

  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    if (!arena.isActive(index) || arena.bodyId[index] !== body.bodyId) continue;
    const base = index * HEX_NEIGHBOR_COUNT;
    for (let n = 0; n < HEX_NEIGHBOR_COUNT; n++) {
      const neighborIndex = arena.neighbors[base + n];
      if (neighborIndex < 0 || neighborIndex <= index || !arena.isActive(neighborIndex)) continue;
      if (arena.bodyId[neighborIndex] !== body.bodyId) continue;

      const restDx = arena.restX[neighborIndex] - arena.restX[index];
      const restDy = arena.restY[neighborIndex] - arena.restY[index];
      const currentDx = arena.baseX[neighborIndex] - arena.baseX[index];
      const currentDy = arena.baseY[neighborIndex] - arena.baseY[index];
      const stretchX = currentDx - restDx;
      const stretchY = currentDy - restDy;
      if (stretchX * stretchX + stretchY * stretchY <= tearThreshold * tearThreshold) continue;

      removeNeighborOneWay(arena, index, neighborIndex);
      removeNeighborOneWay(arena, neighborIndex, index);
      tears++;
    }
  }
  return tears;
}

/**
 * Referencyjny, deterministyczny solver CPU. Używa wyłącznie typed arrays i
 * służy również jako fallback oraz oracle dla implementacji WebGPU.
 */
export function stepHexPlasticity(arena, body, seeds, dt, options = {}, scratch = null) {
  const config = { ...DEFAULT_PLASTICITY_CONFIG, ...options };
  const state = ensureScratch(scratch, arena.capacity);
  clearMemberScratch(body, state);

  const seedCount = Math.max(0, Number(seeds?.count) | 0);
  const indices = seeds?.indices;
  const forceX = seeds?.forceX;
  const forceY = seeds?.forceY;
  for (let seed = 0; seed < seedCount; seed++) {
    const index = Number(indices?.[seed]) | 0;
    if (index < 0 || index >= arena.capacity || !arena.isActive(index)) continue;
    if (arena.bodyId[index] !== body.bodyId) continue;
    state.forceX[index] += finite(forceX?.[seed], 0);
    state.forceY[index] += finite(forceY?.[seed], 0);
  }

  diffuseForces(arena, body, state, config);
  const changed = applyPlasticMotion(arena, body, state, dt, config);
  const tears = tearOverstretchedBonds(arena, body, config);
  if (tears > 0) rebuildHexBodyBoundary(arena, body);
  return { changed, tears, scratch: state };
}
