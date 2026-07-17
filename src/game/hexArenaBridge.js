import {
  DEFAULT_HEX_ARENA_CAPACITY,
  HEX_FLAGS,
  HexArena,
  copyShardIntoArena,
  createHexBodyRecord,
  rebuildHexBodyTopology,
  setHexBodyShardActive
} from '../physics/hexArena.js';

const DEFAULT_BODY_CAPACITY = 4096;

let arena = null;
let shardRefs = null;
let nextBodyId = 1;
let initializedShared = false;

function supportsSharedArena() {
  return typeof SharedArrayBuffer === 'function' &&
    (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated === true);
}

export function getGlobalHexArena(options = {}) {
  if (arena) return arena;
  const capacity = Math.max(1024, Number(options.capacity) | 0 || DEFAULT_HEX_ARENA_CAPACITY);
  const shared = options.shared ?? supportsSharedArena();
  arena = new HexArena({ capacity, shared });
  shardRefs = new Array(capacity);
  initializedShared = arena.shared;
  return arena;
}

function allocateBodyId() {
  let id = nextBodyId++ >>> 0;
  if (id === 0) id = nextBodyId++ >>> 0;
  return id;
}

function isArenaShardAlive(globalArena, shard) {
  const index = Number(shard?.__arenaIndex);
  const generation = Number(shard?.__arenaGeneration);
  return Number.isInteger(index) && globalArena.isAlive(index, generation);
}

export function attachHexGridToArena(entity, shards = entity?.hexGrid?.shards) {
  const grid = entity?.hexGrid;
  if (!grid || !Array.isArray(shards) || shards.length === 0) return null;
  const globalArena = getGlobalHexArena();
  const previousBody = grid._packedBody;
  const bodyId = previousBody?.bodyId || allocateBodyId();
  const members = new Uint32Array(shards.length);
  const newlyAllocated = [];

  for (let slot = 0; slot < shards.length; slot++) {
    const shard = shards[slot];
    let index = Number(shard?.__arenaIndex);
    if (!isArenaShardAlive(globalArena, shard)) {
      index = copyShardIntoArena(globalArena, bodyId, shard);
      if (index < 0) {
        for (let rollback = 0; rollback < newlyAllocated.length; rollback++) {
          const rollbackIndex = newlyAllocated[rollback];
          globalArena.release(rollbackIndex);
          shardRefs[rollbackIndex] = undefined;
        }
        grid._packedArenaOverflow = true;
        return null;
      }
      newlyAllocated.push(index);
      shard.__arenaIndex = index;
      shard.__arenaGeneration = globalArena.generation[index];
    } else {
      globalArena.bodyId[index] = bodyId;
      syncShardToArena(shard, index, false);
    }
    shardRefs[index] = shard;
    members[slot] = index;
  }

  const body = createHexBodyRecord({
    bodyId,
    generation: previousBody?.generation || 1,
    revision: previousBody?.revision || 1,
    cols: grid.cols,
    rows: grid.rows,
    memberIndices: members
  });
  rebuildHexBodyTopology(globalArena, body);
  grid._packedBody = body;
  grid._packedArenaOverflow = false;
  return body;
}

export function rebuildHexGridArena(entity, shards = entity?.hexGrid?.shards) {
  return attachHexGridToArena(entity, shards);
}

export function syncShardToArena(shard, knownIndex = Number(shard?.__arenaIndex), markDirty = true) {
  const globalArena = arena;
  if (!globalArena || !isArenaShardAlive(globalArena, shard)) return false;
  const index = knownIndex;
  globalArena.baseX[index] = Number(shard.gridX) || 0;
  globalArena.baseY[index] = Number(shard.gridY) || 0;
  globalArena.deformX[index] = Number(shard.deformation?.x) || 0;
  globalArena.deformY[index] = Number(shard.deformation?.y) || 0;
  globalArena.targetX[index] = Number(shard.targetDeformation?.x) || 0;
  globalArena.targetY[index] = Number(shard.targetDeformation?.y) || 0;
  globalArena.velocityX[index] = Number(shard.__velX) || 0;
  globalArena.velocityY[index] = Number(shard.__velY) || 0;
  globalArena.collisionVelocityX[index] = Number(shard.__collVelX) || 0;
  globalArena.collisionVelocityY[index] = Number(shard.__collVelY) || 0;
  globalArena.hp[index] = Math.max(0, Number(shard.hp) || 0);
  globalArena.maxHp[index] = Math.max(0, Number(shard.maxHp) || 0);
  globalArena.mass[index] = Math.max(0, Number(shard.mass) || 0);
  globalArena.hitRadius[index] = Math.max(0, Number(shard.hitRadius) || 0);
  globalArena.coverage[index] = Math.max(0, Number(shard.coverage) || 0);
  if (markDirty) globalArena.markDirty(index);
  return true;
}

export function setPackedShardActive(entity, shard, active, debris = !active) {
  const grid = entity?.hexGrid;
  const body = grid?._packedBody;
  const globalArena = arena;
  if (!body || !globalArena || !isArenaShardAlive(globalArena, shard)) return false;
  const index = Number(shard.__arenaIndex);
  syncShardToArena(shard, index, false);
  return setHexBodyShardActive(globalArena, body, index, active, debris);
}

export function getPackedCollisionBody(entity) {
  return entity?.hexGrid?._packedBody || null;
}

export function getPackedShardRef(index) {
  return shardRefs?.[index] || null;
}

export function isPackedShardBoundary(shard) {
  if (!arena || !isArenaShardAlive(arena, shard)) return false;
  return (arena.flags[Number(shard.__arenaIndex)] & HEX_FLAGS.BOUNDARY) !== 0;
}

export function releaseHexGridArena(entity) {
  const grid = entity?.hexGrid;
  const body = grid?._packedBody;
  if (!body || !arena) return 0;
  let released = 0;
  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    if (arena.bodyId[index] !== body.bodyId) continue;
    const shard = shardRefs[index];
    if (arena.release(index, shard?.__arenaGeneration)) {
      if (shard) {
        shard.__arenaIndex = -1;
        shard.__arenaGeneration = 0;
      }
      shardRefs[index] = undefined;
      released++;
    }
  }
  grid._packedBody = null;
  return released;
}

export function getHexArenaStats() {
  if (!arena) {
    return {
      capacity: DEFAULT_HEX_ARENA_CAPACITY,
      allocated: 0,
      highWaterMark: 0,
      bytes: 0,
      shared: false,
      bodyCapacity: DEFAULT_BODY_CAPACITY
    };
  }
  return {
    capacity: arena.capacity,
    allocated: arena.allocatedCount,
    highWaterMark: arena.highWaterMark,
    bytes: arena.memoryBytes,
    shared: initializedShared,
    bodyCapacity: DEFAULT_BODY_CAPACITY
  };
}

export function resetHexArenaForTests(options = {}) {
  arena = null;
  shardRefs = null;
  nextBodyId = 1;
  initializedShared = false;
  return getGlobalHexArena(options);
}
