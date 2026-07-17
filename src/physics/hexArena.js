const FLOAT_FIELDS = Object.freeze([
  'restX', 'restY',
  'baseX', 'baseY',
  'deformX', 'deformY',
  'targetX', 'targetY',
  'velocityX', 'velocityY',
  'collisionVelocityX', 'collisionVelocityY',
  'hp', 'maxHp', 'mass', 'hitRadius', 'coverage'
]);

const INT_FIELDS = Object.freeze([
  'cellC', 'cellR', 'boundarySlot', 'freeNext'
]);

const UINT_FIELDS = Object.freeze([
  'bodyId', 'generation', 'dirtyRevision'
]);

const SHORT_FIELDS = Object.freeze([
  'flags', 'edgeMask'
]);

export const DEFAULT_HEX_ARENA_CAPACITY = 131072;
export const HEX_NEIGHBOR_COUNT = 6;

export const HEX_FLAGS = Object.freeze({
  ALLOCATED: 1 << 0,
  ACTIVE: 1 << 1,
  DEBRIS: 1 << 2,
  BOUNDARY: 1 << 3,
  DIRTY: 1 << 4,
  ASTEROID_CORE: 1 << 5
});

const ODD_NEIGHBORS = Object.freeze([
  0, -1,
  0, 1,
  -1, 0,
  -1, 1,
  1, 0,
  1, 1
]);

const EVEN_NEIGHBORS = Object.freeze([
  0, -1,
  0, 1,
  -1, -1,
  -1, 0,
  1, -1,
  1, 0
]);

const EMPTY_INITIAL = Object.freeze({});

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function createLayout(capacity) {
  let byteOffset = 0;
  const fields = Object.create(null);
  const add = (name, Type, length) => {
    byteOffset = align(byteOffset, Type.BYTES_PER_ELEMENT);
    fields[name] = { Type, byteOffset, length };
    byteOffset += Type.BYTES_PER_ELEMENT * length;
  };

  for (const name of FLOAT_FIELDS) add(name, Float32Array, capacity);
  for (const name of INT_FIELDS) add(name, Int32Array, capacity);
  for (const name of UINT_FIELDS) add(name, Uint32Array, capacity);
  for (const name of SHORT_FIELDS) add(name, Uint16Array, capacity);
  add('neighbors', Int32Array, capacity * HEX_NEIGHBOR_COUNT);

  return { fields, byteLength: align(byteOffset, 64) };
}

function createBackingBuffer(byteLength, shared) {
  if (shared && typeof SharedArrayBuffer === 'function') return new SharedArrayBuffer(byteLength);
  return new ArrayBuffer(byteLength);
}

function makeViews(buffer, layout) {
  const views = Object.create(null);
  for (const [name, descriptor] of Object.entries(layout.fields)) {
    views[name] = new descriptor.Type(buffer, descriptor.byteOffset, descriptor.length);
  }
  return views;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export class HexArena {
  constructor(options = {}) {
    this.capacity = positiveInt(options.capacity, DEFAULT_HEX_ARENA_CAPACITY);
    this.layout = createLayout(this.capacity);
    this.buffer = options.buffer || createBackingBuffer(this.layout.byteLength, options.shared !== false);
    if (this.buffer.byteLength < this.layout.byteLength) {
      throw new RangeError(`HexArena buffer too small: ${this.buffer.byteLength} < ${this.layout.byteLength}`);
    }

    Object.assign(this, makeViews(this.buffer, this.layout));
    this.shared = typeof SharedArrayBuffer === 'function' && this.buffer instanceof SharedArrayBuffer;
    this.allocatedCount = 0;
    this.highWaterMark = 0;
    this.revision = 1;

    if (options.initialize !== false) this.reset();
  }

  reset() {
    this.flags.fill(0);
    this.bodyId.fill(0);
    this.generation.fill(0);
    this.dirtyRevision.fill(0);
    this.boundarySlot.fill(-1);
    this.neighbors.fill(-1);
    for (let index = 0; index < this.capacity - 1; index++) this.freeNext[index] = index + 1;
    this.freeNext[this.capacity - 1] = -1;
    this.freeHead = this.capacity > 0 ? 0 : -1;
    this.allocatedCount = 0;
    this.highWaterMark = 0;
    this.revision = 1;
  }

  allocate(bodyId, initial = null) {
    const index = this.freeHead;
    if (index < 0) return -1;
    this.freeHead = this.freeNext[index];
    this.freeNext[index] = -1;

    let generation = (this.generation[index] + 1) >>> 0;
    if (generation === 0) generation = 1;
    this.generation[index] = generation;
    this.bodyId[index] = Number(bodyId) >>> 0;
    this.flags[index] = HEX_FLAGS.ALLOCATED | HEX_FLAGS.ACTIVE | HEX_FLAGS.DIRTY;
    this.boundarySlot[index] = -1;
    this.allocatedCount++;
    if (this.allocatedCount > this.highWaterMark) this.highWaterMark = this.allocatedCount;

    this._writeInitial(index, initial || EMPTY_INITIAL);
    this.markDirty(index);
    return index;
  }

  _writeInitial(index, initial) {
    const restX = finite(initial.restX ?? initial.gridX, 0);
    const restY = finite(initial.restY ?? initial.gridY, 0);
    const baseX = finite(initial.baseX, restX);
    const baseY = finite(initial.baseY, restY);

    this.restX[index] = restX;
    this.restY[index] = restY;
    this.baseX[index] = baseX;
    this.baseY[index] = baseY;
    this.deformX[index] = finite(initial.deformX ?? initial.deformation?.x, 0);
    this.deformY[index] = finite(initial.deformY ?? initial.deformation?.y, 0);
    this.targetX[index] = finite(initial.targetX ?? initial.targetDeformation?.x, this.deformX[index]);
    this.targetY[index] = finite(initial.targetY ?? initial.targetDeformation?.y, this.deformY[index]);
    this.velocityX[index] = finite(initial.velocityX ?? initial.__velX, 0);
    this.velocityY[index] = finite(initial.velocityY ?? initial.__velY, 0);
    this.collisionVelocityX[index] = finite(initial.collisionVelocityX ?? initial.__collVelX, 0);
    this.collisionVelocityY[index] = finite(initial.collisionVelocityY ?? initial.__collVelY, 0);
    this.maxHp[index] = Math.max(0, finite(initial.maxHp, 80));
    this.hp[index] = Math.max(0, finite(initial.hp, this.maxHp[index]));
    this.mass[index] = Math.max(0, finite(initial.mass, 10));
    this.hitRadius[index] = Math.max(0, finite(initial.hitRadius ?? initial.radius, 7));
    this.coverage[index] = Math.max(0, finite(initial.coverage, 1));
    this.cellC[index] = finite(initial.c, 0) | 0;
    this.cellR[index] = finite(initial.r, 0) | 0;
    this.edgeMask[index] = finite(initial.edgeMask, 0) & 0xffff;
    const neighborBase = index * HEX_NEIGHBOR_COUNT;
    this.neighbors.fill(-1, neighborBase, neighborBase + HEX_NEIGHBOR_COUNT);
  }

  release(index, generation = this.generation[index]) {
    if (!this.isAlive(index, generation)) return false;
    this.flags[index] = 0;
    this.bodyId[index] = 0;
    this.boundarySlot[index] = -1;
    const neighborBase = index * HEX_NEIGHBOR_COUNT;
    this.neighbors.fill(-1, neighborBase, neighborBase + HEX_NEIGHBOR_COUNT);
    this.freeNext[index] = this.freeHead;
    this.freeHead = index;
    this.allocatedCount = Math.max(0, this.allocatedCount - 1);
    this.revision = (this.revision + 1) >>> 0 || 1;
    return true;
  }

  isAlive(index, generation = this.generation[index]) {
    return index >= 0 && index < this.capacity &&
      (this.flags[index] & HEX_FLAGS.ALLOCATED) !== 0 &&
      this.generation[index] === (Number(generation) >>> 0);
  }

  isActive(index) {
    const flags = this.flags[index] || 0;
    return (flags & (HEX_FLAGS.ALLOCATED | HEX_FLAGS.ACTIVE | HEX_FLAGS.DEBRIS)) ===
      (HEX_FLAGS.ALLOCATED | HEX_FLAGS.ACTIVE);
  }

  markDirty(index) {
    this.flags[index] |= HEX_FLAGS.DIRTY;
    let revision = (this.revision + 1) >>> 0;
    if (revision === 0) revision = 1;
    this.revision = revision;
    this.dirtyRevision[index] = revision;
  }

  clearDirty(index) {
    this.flags[index] &= ~HEX_FLAGS.DIRTY;
  }

  setActive(index, active, debris = false) {
    if (!this.isAlive(index)) return false;
    let flags = this.flags[index];
    if (active) flags |= HEX_FLAGS.ACTIVE;
    else flags &= ~HEX_FLAGS.ACTIVE;
    if (debris) flags |= HEX_FLAGS.DEBRIS;
    else flags &= ~HEX_FLAGS.DEBRIS;
    this.flags[index] = flags;
    this.markDirty(index);
    return true;
  }

  getCurrentX(index) {
    return this.baseX[index] + this.deformX[index];
  }

  getCurrentY(index) {
    return this.baseY[index] + this.deformY[index];
  }

  get memoryBytes() {
    return this.layout.byteLength;
  }

  get utilization() {
    return this.capacity > 0 ? this.allocatedCount / this.capacity : 0;
  }
}

export function createHexBodyRecord(options = {}) {
  const memberIndices = options.memberIndices instanceof Uint32Array
    ? options.memberIndices
    : Uint32Array.from(options.memberIndices || []);
  const memberCount = Math.min(
    memberIndices.length,
    Number.isInteger(options.memberCount) ? Math.max(0, options.memberCount) : memberIndices.length
  );
  const cols = Math.max(1, positiveInt(options.cols, 1));
  const rows = Math.max(1, positiveInt(options.rows, 1));
  const cellToShard = options.cellToShard instanceof Int32Array && options.cellToShard.length >= cols * rows
    ? options.cellToShard
    : new Int32Array(cols * rows);
  cellToShard.fill(-1, 0, cols * rows);

  return {
    bodyId: Number(options.bodyId) >>> 0,
    generation: (Number(options.generation) >>> 0) || 1,
    revision: (Number(options.revision) >>> 0) || 1,
    cols,
    rows,
    memberIndices,
    memberCount,
    boundaryIndices: new Uint32Array(Math.max(1, memberIndices.length)),
    boundaryCount: 0,
    cellToShard,
    activeCount: 0
  };
}

function shardBelongsToBody(arena, body, index) {
  return arena.isActive(index) && arena.bodyId[index] === body.bodyId;
}

function setBoundaryFlag(arena, body, index, shouldBeBoundary) {
  const currentSlot = arena.boundarySlot[index];
  if (shouldBeBoundary) {
    if (currentSlot >= 0) return false;
    if (body.boundaryCount >= body.boundaryIndices.length) {
      throw new RangeError(`Boundary buffer exhausted for body ${body.bodyId}`);
    }
    const slot = body.boundaryCount++;
    body.boundaryIndices[slot] = index;
    arena.boundarySlot[index] = slot;
    arena.flags[index] |= HEX_FLAGS.BOUNDARY;
    return true;
  }

  if (currentSlot < 0) {
    arena.flags[index] &= ~HEX_FLAGS.BOUNDARY;
    return false;
  }
  const lastSlot = --body.boundaryCount;
  const movedIndex = body.boundaryIndices[lastSlot];
  if (currentSlot !== lastSlot) {
    body.boundaryIndices[currentSlot] = movedIndex;
    arena.boundarySlot[movedIndex] = currentSlot;
  }
  arena.boundarySlot[index] = -1;
  arena.flags[index] &= ~HEX_FLAGS.BOUNDARY;
  return true;
}

export function isHexBoundary(arena, body, index) {
  if (!shardBelongsToBody(arena, body, index)) return false;
  const base = index * HEX_NEIGHBOR_COUNT;
  for (let neighborOffset = 0; neighborOffset < HEX_NEIGHBOR_COUNT; neighborOffset++) {
    const neighborIndex = arena.neighbors[base + neighborOffset];
    if (neighborIndex < 0 || !shardBelongsToBody(arena, body, neighborIndex)) return true;
  }
  return false;
}

export function rebuildHexBodyTopology(arena, body) {
  body.cellToShard.fill(-1);
  body.activeCount = 0;

  for (let memberSlot = 0; memberSlot < body.memberCount; memberSlot++) {
    const index = body.memberIndices[memberSlot];
    if (!shardBelongsToBody(arena, body, index)) continue;
    const c = arena.cellC[index];
    const r = arena.cellR[index];
    if (c < 0 || r < 0 || c >= body.cols || r >= body.rows) continue;
    body.cellToShard[c + r * body.cols] = index;
    body.activeCount++;
  }

  for (let memberSlot = 0; memberSlot < body.memberCount; memberSlot++) {
    const index = body.memberIndices[memberSlot];
    const neighborBase = index * HEX_NEIGHBOR_COUNT;
    arena.neighbors.fill(-1, neighborBase, neighborBase + HEX_NEIGHBOR_COUNT);
    if (!shardBelongsToBody(arena, body, index)) continue;

    const c = arena.cellC[index];
    const r = arena.cellR[index];
    const offsets = (c & 1) !== 0 ? ODD_NEIGHBORS : EVEN_NEIGHBORS;
    for (let n = 0; n < HEX_NEIGHBOR_COUNT; n++) {
      const nc = c + offsets[n * 2];
      const nr = r + offsets[n * 2 + 1];
      if (nc < 0 || nr < 0 || nc >= body.cols || nr >= body.rows) continue;
      const neighborIndex = body.cellToShard[nc + nr * body.cols];
      if (neighborIndex >= 0 && shardBelongsToBody(arena, body, neighborIndex)) {
        arena.neighbors[neighborBase + n] = neighborIndex;
      }
    }
  }

  rebuildHexBodyBoundary(arena, body);
  body.revision = (body.revision + 1) >>> 0 || 1;
  return body;
}

export function rebuildHexBodyBoundary(arena, body) {
  body.boundaryCount = 0;
  for (let memberSlot = 0; memberSlot < body.memberCount; memberSlot++) {
    const index = body.memberIndices[memberSlot];
    arena.boundarySlot[index] = -1;
    arena.flags[index] &= ~HEX_FLAGS.BOUNDARY;
  }
  for (let memberSlot = 0; memberSlot < body.memberCount; memberSlot++) {
    const index = body.memberIndices[memberSlot];
    if (isHexBoundary(arena, body, index)) setBoundaryFlag(arena, body, index, true);
  }
  return body.boundaryCount;
}

export function refreshHexBoundaryAround(arena, body, index) {
  if (index < 0 || index >= arena.capacity) return 0;
  let changes = 0;
  if (setBoundaryFlag(arena, body, index, isHexBoundary(arena, body, index))) changes++;
  const base = index * HEX_NEIGHBOR_COUNT;
  for (let n = 0; n < HEX_NEIGHBOR_COUNT; n++) {
    const neighborIndex = arena.neighbors[base + n];
    if (neighborIndex < 0 || arena.bodyId[neighborIndex] !== body.bodyId) continue;
    if (setBoundaryFlag(arena, body, neighborIndex, isHexBoundary(arena, body, neighborIndex))) changes++;
  }
  if (changes > 0) body.revision = (body.revision + 1) >>> 0 || 1;
  return changes;
}

export function setHexBodyShardActive(arena, body, index, active, debris = !active) {
  if (arena.bodyId[index] !== body.bodyId || !arena.isAlive(index)) return false;
  const wasActive = arena.isActive(index);
  arena.setActive(index, active, debris);
  const isActive = arena.isActive(index);
  if (wasActive !== isActive) body.activeCount += isActive ? 1 : -1;
  refreshHexBoundaryAround(arena, body, index);
  return true;
}

export function copyShardIntoArena(arena, bodyId, shard) {
  const index = arena.allocate(bodyId, shard);
  if (index < 0) return -1;
  if (shard?.active === false || shard?.isDebris === true) {
    arena.setActive(index, false, shard?.isDebris === true);
  }
  if (shard?.__asteroidCore === true) arena.flags[index] |= HEX_FLAGS.ASTEROID_CORE;
  return index;
}

export function estimateHexArenaBytes(capacity = DEFAULT_HEX_ARENA_CAPACITY) {
  return createLayout(positiveInt(capacity, DEFAULT_HEX_ARENA_CAPACITY)).byteLength;
}
