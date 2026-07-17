import { AiKernel } from '../physics/aiKernel.js';
import { PhysicsKernel } from '../physics/physicsKernel.js';
import { AI_SNAPSHOT_STRIDE, BODY_FLAGS } from '../physics/protocol.js';

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function summarize(samples) {
  const sorted = Float64Array.from(samples);
  sorted.sort();
  let sum = 0;
  for (let index = 0; index < sorted.length; index++) sum += sorted[index];
  return {
    mean: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 0.50),
    p95: percentile(sorted, 0.95),
    max: sorted.length ? sorted[sorted.length - 1] : 0
  };
}

function createRng(seed) {
  let state = Number(seed) >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function attachGeneratedBody(kernel, slot, cols, rows, spacing, hexHeight) {
  const srcWidth = (cols - 1) * spacing + 18;
  const srcHeight = (rows - 0.5) * hexHeight + 18;
  const record = kernel.attachHexBody(slot, {
    count: cols * rows,
    cols,
    rows,
    srcWidth,
    srcHeight,
    hexSpacing: spacing,
    hexHeight,
    hitRadius: 9,
    hp: 80,
    shardMass: 10
  });
  if (!record) throw new Error(`HexArena exhausted while attaching ${cols * rows} hexes`);
  return { record, srcWidth, srcHeight };
}

function writeAiSnapshot(kernel, target) {
  let count = 0;
  for (let body = 0; body < kernel.maxBodies; body++) {
    if (kernel.bodyActive[body] === 0) continue;
    const offset = count * AI_SNAPSHOT_STRIDE;
    target[offset] = kernel.bodyEntityId[body];
    target[offset + 1] = kernel.bodyGeneration[body];
    target[offset + 2] = body & 1;
    target[offset + 3] = kernel.bodyFlags[body];
    target[offset + 4] = kernel.bodyX[body];
    target[offset + 5] = kernel.bodyY[body];
    target[offset + 6] = kernel.bodyVx[body];
    target[offset + 7] = kernel.bodyVy[body];
    target[offset + 8] = kernel.bodyAngle[body];
    target[offset + 9] = 0;
    target[offset + 10] = 1300;
    target[offset + 11] = 0.8;
    target[offset + 12] = 1800;
    target[offset + 15] = body < 2 ? 1 : 0.25;
    count++;
  }
  return count;
}

export function run100kBenchmark(options = {}) {
  const seed = Number(options.seed) >>> 0 || 0x51a7c0de;
  const warmupTicks = Math.max(0, Number(options.warmupTicks) | 0 || 30);
  const measuredTicks = Math.max(1, Number(options.measuredTicks) | 0 || 180);
  const projectileCount = Math.max(0, Number(options.projectileCount) | 0 || 3000);
  const spacing = 13.5;
  const hexHeight = Math.sqrt(3) * 9;
  const largeCols = Math.max(2, Number(options.largeCols) | 0 || 250);
  const largeRows = Math.max(2, Number(options.largeRows) | 0 || 100);
  const smallCols = Math.max(2, Number(options.smallCols) | 0 || 100);
  const smallRows = Math.max(2, Number(options.smallRows) | 0 || 50);
  const escortCount = Math.max(0, Number(options.escortCount) | 0 || 10);
  const totalHexes = largeCols * largeRows * 2 + smallCols * smallRows * escortCount;
  const bodyCapacity = Math.max(32, escortCount + 4);
  const kernel = new PhysicsKernel({
    maxBodies: bodyCapacity,
    maxProjectiles: Math.max(16, projectileCount + 32),
    hexCapacity: Math.max(131072, totalHexes + 1024),
    sharedArena: false,
    hashCellSize: 4096
  });
  const ai = new AiKernel({ maxEntities: bodyCapacity });
  const aiSnapshot = new Float32Array(bodyCapacity * AI_SNAPSHOT_STRIDE);
  const rng = createRng(seed);
  const setupStart = now();

  const largeWidth = (largeCols - 1) * spacing + 18;
  const largeHeight = (largeRows - 0.5) * hexHeight + 18;
  const contactSeparation = largeWidth - 8;
  const largeRadius = Math.hypot(largeWidth, largeHeight) * 0.5;
  const bodyA = kernel.spawnBody({
    entityId: 1, x: -contactSeparation * 0.5, y: 0, vx: 45, radius: largeRadius,
    mass: largeCols * largeRows * 10, hp: 1e7,
    flags: BODY_FLAGS.VISIBLE | BODY_FLAGS.IMPORTANT | BODY_FLAGS.IN_CONTACT
  });
  const bodyB = kernel.spawnBody({
    entityId: 2, x: contactSeparation * 0.5, y: 0, vx: -45, radius: largeRadius,
    mass: largeCols * largeRows * 10, hp: 1e7,
    flags: BODY_FLAGS.VISIBLE | BODY_FLAGS.IMPORTANT | BODY_FLAGS.IN_CONTACT
  });
  attachGeneratedBody(kernel, bodyA, largeCols, largeRows, spacing, hexHeight);
  attachGeneratedBody(kernel, bodyB, largeCols, largeRows, spacing, hexHeight);

  const smallWidth = (smallCols - 1) * spacing + 18;
  const smallHeight = (smallRows - 0.5) * hexHeight + 18;
  const smallRadius = Math.hypot(smallWidth, smallHeight) * 0.5;
  for (let escort = 0; escort < escortCount; escort++) {
    const angle = escort / Math.max(1, escortCount) * Math.PI * 2;
    const slot = kernel.spawnBody({
      entityId: escort + 3,
      x: Math.cos(angle) * 12000,
      y: Math.sin(angle) * 12000,
      vx: -Math.sin(angle) * 18,
      vy: Math.cos(angle) * 18,
      radius: smallRadius,
      mass: smallCols * smallRows * 10,
      hp: 2e6,
      distance: 12000,
      flags: BODY_FLAGS.VISIBLE
    });
    attachGeneratedBody(kernel, slot, smallCols, smallRows, spacing, hexHeight);
  }

  for (let projectile = 0; projectile < projectileCount; projectile++) {
    const side = projectile & 1 ? -1 : 1;
    const spread = (rng() - 0.5) * largeHeight * 1.4;
    kernel.spawnProjectile({
      ownerBody: side > 0 ? bodyB : bodyA,
      x: side * (contactSeparation * 0.5 + largeWidth * 0.5 + 20 + rng() * 120),
      y: spread,
      vx: -side * (900 + rng() * 1600),
      vy: (rng() - 0.5) * 160,
      radius: 2 + rng() * 3,
      damage: 12 + rng() * 40,
      life: 8,
      penetration: 1 + (rng() * 3 | 0)
    });
  }

  const setupMs = now() - setupStart;
  const physicsSamples = [];
  const aiSamples = [];
  const frameSamples = [];
  let contactTicks = 0;
  const totalTicks = warmupTicks + measuredTicks;
  for (let tick = 1; tick <= totalTicks; tick++) {
    // Keep the two benchmark capitals in deterministic continuous contact.
    kernel.bodyX[bodyA] = -contactSeparation * 0.5;
    kernel.bodyY[bodyA] = 0;
    kernel.bodyVx[bodyA] = 45;
    kernel.bodyVy[bodyA] = 0;
    kernel.bodyX[bodyB] = contactSeparation * 0.5;
    kernel.bodyY[bodyB] = 0;
    kernel.bodyVx[bodyB] = -45;
    kernel.bodyVy[bodyB] = 0;

    const physicsStart = now();
    const physicsPerf = kernel.step(1 / 120, tick, 0);
    const physicsMs = now() - physicsStart;
    if (physicsPerf.contacts > 0) contactTicks++;

    const aiCount = writeAiSnapshot(kernel, aiSnapshot);
    const aiStart = now();
    ai.step(aiSnapshot, aiCount, tick);
    const aiMs = now() - aiStart;
    if (tick > warmupTicks) {
      physicsSamples.push(physicsMs);
      aiSamples.push(aiMs);
      frameSamples.push(physicsMs + aiMs);
    }
  }

  let checksum = 2166136261 >>> 0;
  for (let body = 0; body < kernel.maxBodies; body++) {
    if (kernel.bodyActive[body] === 0) continue;
    checksum ^= Math.round(kernel.bodyX[body] * 16) >>> 0;
    checksum = Math.imul(checksum, 16777619) >>> 0;
    checksum ^= Math.round(kernel.bodyY[body] * 16) >>> 0;
    checksum = Math.imul(checksum, 16777619) >>> 0;
  }

  return {
    seed,
    totalHexes,
    activeHexes: kernel.arena.allocatedCount,
    bodies: kernel.bodyCount,
    projectilesRemaining: kernel.projectileCount,
    contactTicks,
    setupMs,
    physics: summarize(physicsSamples),
    ai: summarize(aiSamples),
    combined: summarize(frameSamples),
    commandBacklog: 0,
    structuralCpuBytes: kernel.arena.memoryBytes,
    estimatedGpuStructuralBytes: kernel.arena.capacity * 32,
    checksum
  };
}
