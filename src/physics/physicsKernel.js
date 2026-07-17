import {
  createHexBodyRecord,
  HexArena,
  rebuildHexBodyTopology,
  setHexBodyShardActive
} from './hexArena.js';
import { AdaptiveSimulationScheduler, SIMULATION_TIER } from './adaptiveScheduler.js';
import {
  AI_COMMAND,
  AI_COMMAND_STRIDE,
  AI_SNAPSHOT_STRIDE,
  BODY_FLAGS,
  BODY_SNAPSHOT_STRIDE,
  EVENT_STRIDE,
  PHYSICS_COMMAND,
  PHYSICS_EVENT,
  SIM_TICK_HZ
} from './protocol.js';

const DEFAULT_MAX_BODIES = 4096;
const DEFAULT_MAX_PROJECTILES = 65536;
const DEFAULT_HASH_BUCKETS = 8192;
const DEFAULT_HASH_CELL_SIZE = 2048;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nextGeneration(value) {
  const next = (Number(value) + 1) >>> 0;
  return next || 1;
}

function hashCell(x, y, mask) {
  return ((Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) >>> 0) & mask;
}

function segmentCircleToi(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const radiusSq = radius * radius;
  if (fx * fx + fy * fy <= radiusSq) return 0;
  const a = dx * dx + dy * dy;
  if (a <= 1e-12) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radiusSq;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return -1;
  const root = Math.sqrt(discriminant);
  const inv = 1 / (2 * a);
  const near = (-b - root) * inv;
  if (near >= 0 && near <= 1) return near;
  const far = (-b + root) * inv;
  return far >= 0 && far <= 1 ? far : -1;
}

export class PhysicsKernel {
  constructor(options = {}) {
    this.maxBodies = Math.max(8, Number(options.maxBodies) | 0 || DEFAULT_MAX_BODIES);
    this.maxProjectiles = Math.max(16, Number(options.maxProjectiles) | 0 || DEFAULT_MAX_PROJECTILES);
    this.tick = 0;
    this.budgetPressure = 0;

    this.bodyActive = new Uint8Array(this.maxBodies);
    this.bodyGeneration = new Uint32Array(this.maxBodies);
    this.bodyEntityId = new Uint32Array(this.maxBodies);
    this.bodyFlags = new Uint16Array(this.maxBodies);
    this.bodyX = new Float64Array(this.maxBodies);
    this.bodyY = new Float64Array(this.maxBodies);
    this.bodyPrevX = new Float64Array(this.maxBodies);
    this.bodyPrevY = new Float64Array(this.maxBodies);
    this.bodyVx = new Float32Array(this.maxBodies);
    this.bodyVy = new Float32Array(this.maxBodies);
    this.bodyAngle = new Float32Array(this.maxBodies);
    this.bodyAngVel = new Float32Array(this.maxBodies);
    this.bodyRadius = new Float32Array(this.maxBodies);
    this.bodyMass = new Float32Array(this.maxBodies);
    this.bodyHp = new Float32Array(this.maxBodies);
    this.bodyShield = new Float32Array(this.maxBodies);
    this.bodyShieldRadius = new Float32Array(this.maxBodies);
    this.bodyScaleX = new Float32Array(this.maxBodies);
    this.bodyScaleY = new Float32Array(this.maxBodies);
    this.bodyDistance = new Float32Array(this.maxBodies);
    this.bodyTimeToContact = new Float32Array(this.maxBodies);
    this.bodyLastStepDt = new Float32Array(this.maxBodies);
    this.bodyTeam = new Uint16Array(this.maxBodies);
    this.bodyTarget = new Int32Array(this.maxBodies);
    this.bodyProjectileSpeed = new Float32Array(this.maxBodies);
    this.bodyWeaponRange = new Float32Array(this.maxBodies);
    this.bodyLinearAccel = new Float32Array(this.maxBodies);
    this.bodyTurnAccel = new Float32Array(this.maxBodies);
    this.bodyImportance = new Float32Array(this.maxBodies);
    this.bodyAiThrust = new Float32Array(this.maxBodies);
    this.bodyAiTurn = new Float32Array(this.maxBodies);
    this.bodyHexRecords = new Array(this.maxBodies);
    this.bodyFreeNext = new Int32Array(this.maxBodies);
    this.bodyCount = 0;
    for (let index = 0; index < this.maxBodies - 1; index++) this.bodyFreeNext[index] = index + 1;
    this.bodyFreeNext[this.maxBodies - 1] = -1;
    this.bodyFreeHead = 0;

    this.scheduler = new AdaptiveSimulationScheduler(this.maxBodies, options.scheduler);

    this.projectileActive = new Uint8Array(this.maxProjectiles);
    this.projectileGeneration = new Uint32Array(this.maxProjectiles);
    this.projectileX = new Float64Array(this.maxProjectiles);
    this.projectileY = new Float64Array(this.maxProjectiles);
    this.projectilePrevX = new Float64Array(this.maxProjectiles);
    this.projectilePrevY = new Float64Array(this.maxProjectiles);
    this.projectileVx = new Float32Array(this.maxProjectiles);
    this.projectileVy = new Float32Array(this.maxProjectiles);
    this.projectileRadius = new Float32Array(this.maxProjectiles);
    this.projectileDamage = new Float32Array(this.maxProjectiles);
    this.projectileLife = new Float32Array(this.maxProjectiles);
    this.projectilePenetration = new Int16Array(this.maxProjectiles);
    this.projectileOwnerBody = new Int32Array(this.maxProjectiles);
    this.projectileFreeNext = new Int32Array(this.maxProjectiles);
    this.projectileCount = 0;
    for (let index = 0; index < this.maxProjectiles - 1; index++) this.projectileFreeNext[index] = index + 1;
    this.projectileFreeNext[this.maxProjectiles - 1] = -1;
    this.projectileFreeHead = 0;

    const bucketCount = Math.max(64, Number(options.hashBuckets) | 0 || DEFAULT_HASH_BUCKETS);
    this.hashBucketCount = 1 << Math.ceil(Math.log2(bucketCount));
    this.hashMask = this.hashBucketCount - 1;
    this.hashCellSize = Math.max(64, finite(options.hashCellSize, DEFAULT_HASH_CELL_SIZE));
    this.hashHeads = new Int32Array(this.hashBucketCount);
    this.hashNext = new Int32Array(this.maxBodies);
    this.bodyCellX = new Int32Array(this.maxBodies);
    this.bodyCellY = new Int32Array(this.maxBodies);
    this.maxBodyRadius = 0;
    this._contact = new Float64Array(8);
    this._reverseContact = new Float64Array(8);
    this._worldScratch = new Float64Array(4);
    this._gpuRecord = {
      bodyA: 0, bodyB: 0, shardA: 0, shardB: 0, tickId: 0,
      revisionA: 0, revisionB: 0, flags: 0, toi: 0,
      pointX: 0, pointY: 0, normalX: 0, normalY: 0, penetration: 0, relativeSpeed: 0
    };

    this.arena = options.arena || new HexArena({
      capacity: options.hexCapacity,
      shared: options.sharedArena !== false
    });
    this.eventRing = options.eventRing || null;
    this._event = new Float64Array(EVENT_STRIDE);
    this._command = new Float64Array(options.commandStride || 16);
    this._aiCommand = new Float64Array(AI_COMMAND_STRIDE);
    this.perf = {
      lastStepMs: 0,
      integratedBodies: 0,
      projectiles: 0,
      hits: 0,
      contacts: 0,
      backlog: 0
    };
  }

  spawnBody(initial = {}) {
    const slot = this.bodyFreeHead;
    if (slot < 0) return -1;
    this.bodyFreeHead = this.bodyFreeNext[slot];
    this.bodyFreeNext[slot] = -1;
    this.bodyActive[slot] = 1;
    this.bodyGeneration[slot] = nextGeneration(this.bodyGeneration[slot]);
    this.bodyEntityId[slot] = Number(initial.entityId) >>> 0;
    this.bodyFlags[slot] = Number(initial.flags) & 0xffff;
    this.bodyX[slot] = finite(initial.x);
    this.bodyY[slot] = finite(initial.y);
    this.bodyPrevX[slot] = this.bodyX[slot];
    this.bodyPrevY[slot] = this.bodyY[slot];
    this.bodyVx[slot] = finite(initial.vx);
    this.bodyVy[slot] = finite(initial.vy);
    this.bodyAngle[slot] = finite(initial.angle);
    this.bodyAngVel[slot] = finite(initial.angVel);
    this.bodyRadius[slot] = Math.max(0, finite(initial.radius, 1));
    this.bodyMass[slot] = Math.max(1, finite(initial.mass, 1));
    this.bodyHp[slot] = Math.max(0, finite(initial.hp, 100));
    this.bodyShield[slot] = Math.max(0, finite(initial.shield));
    this.bodyShieldRadius[slot] = Math.max(0, finite(initial.shieldRadius));
    this.bodyScaleX[slot] = Math.max(0.0001, finite(initial.scaleX, 1));
    this.bodyScaleY[slot] = Math.max(0.0001, finite(initial.scaleY, 1));
    this.bodyDistance[slot] = Math.max(0, finite(initial.distance));
    this.bodyTimeToContact[slot] = Number.isFinite(Number(initial.timeToContact)) ? Number(initial.timeToContact) : Infinity;
    this.bodyTeam[slot] = Number(initial.team) & 0xffff;
    this.bodyTarget[slot] = Number.isInteger(Number(initial.target)) ? Number(initial.target) | 0 : -1;
    this.bodyProjectileSpeed[slot] = Math.max(1, finite(initial.projectileSpeed, 900));
    this.bodyWeaponRange[slot] = Math.max(1, finite(initial.weaponRange, 1800));
    this.bodyLinearAccel[slot] = Math.max(0, finite(initial.linearAccel, 120));
    this.bodyTurnAccel[slot] = Math.max(0, finite(initial.turnAccel, 1.2));
    this.bodyImportance[slot] = Math.max(0, finite(initial.importance, (this.bodyFlags[slot] & BODY_FLAGS.IMPORTANT) ? 1 : 0));
    this.bodyAiThrust[slot] = 0;
    this.bodyAiTurn[slot] = 0;
    this.scheduler.reset(slot, this.tick, initial.tier ?? SIMULATION_TIER.VISIBLE);
    this.bodyCount++;
    this._emit(PHYSICS_EVENT.BODY_SPAWNED, slot, this.bodyEntityId[slot], this.bodyGeneration[slot]);
    return slot;
  }

  despawnBody(slot, generation = this.bodyGeneration[slot]) {
    if (!this.isBodyAlive(slot, generation)) return false;
    this._releaseHexBody(slot);
    this.bodyActive[slot] = 0;
    this.bodyFlags[slot] = 0;
    this.bodyFreeNext[slot] = this.bodyFreeHead;
    this.bodyFreeHead = slot;
    this.bodyCount = Math.max(0, this.bodyCount - 1);
    this._emit(PHYSICS_EVENT.BODY_DESPAWNED, slot, this.bodyEntityId[slot], generation);
    return true;
  }

  isBodyAlive(slot, generation = this.bodyGeneration[slot]) {
    return slot >= 0 && slot < this.maxBodies && this.bodyActive[slot] === 1 &&
      this.bodyGeneration[slot] === (Number(generation) >>> 0);
  }

  setBodyState(slot, state = {}) {
    if (!this.isBodyAlive(slot, state.generation ?? this.bodyGeneration[slot])) return false;
    if (Number.isFinite(Number(state.x))) this.bodyX[slot] = Number(state.x);
    if (Number.isFinite(Number(state.y))) this.bodyY[slot] = Number(state.y);
    if (Number.isFinite(Number(state.vx))) this.bodyVx[slot] = Number(state.vx);
    if (Number.isFinite(Number(state.vy))) this.bodyVy[slot] = Number(state.vy);
    if (Number.isFinite(Number(state.angle))) this.bodyAngle[slot] = Number(state.angle);
    if (Number.isFinite(Number(state.angVel))) this.bodyAngVel[slot] = Number(state.angVel);
    if (Number.isFinite(Number(state.flags))) this.bodyFlags[slot] = Number(state.flags) & 0xffff;
    if (Number.isFinite(Number(state.distance))) this.bodyDistance[slot] = Math.max(0, Number(state.distance));
    if (Number.isFinite(Number(state.timeToContact))) this.bodyTimeToContact[slot] = Number(state.timeToContact);
    return true;
  }

  attachHexBody(slot, init) {
    if (!this.isBodyAlive(slot) || !init) return null;
    const generatedCount = Math.max(0, Number(init.count) | 0);
    const sourceMembers = init.memberIndices || init.shards || [];
    const memberCount = generatedCount || sourceMembers.length;
    const members = new Uint32Array(memberCount);
    const generatedCols = Math.max(1, Number(init.cols) | 0);
    const generatedRows = Math.max(1, Number(init.rows) | 0);
    const generatedSpacing = Math.max(0.001, finite(init.hexSpacing, 13.5));
    const generatedHeight = Math.max(0.001, finite(init.hexHeight, Math.sqrt(3) * 9));
    for (let member = 0; member < memberCount; member++) {
      const source = generatedCount > 0 ? null : (init.shards?.[member] || sourceMembers[member] || null);
      const index = this.arena.allocate(slot + 1, source);
      if (index < 0) {
        for (let rollback = 0; rollback < member; rollback++) this.arena.release(members[rollback]);
        return null;
      }
      if (generatedCount > 0) {
        const c = Math.floor(member / generatedRows);
        const r = member - c * generatedRows;
        const x = c * generatedSpacing;
        const y = r * generatedHeight + ((c & 1) !== 0 ? generatedHeight * 0.5 : 0);
        this.arena.cellC[index] = c;
        this.arena.cellR[index] = r;
        this.arena.restX[index] = x;
        this.arena.restY[index] = y;
        this.arena.baseX[index] = x;
        this.arena.baseY[index] = y;
        this.arena.hitRadius[index] = Math.max(0.1, finite(init.hitRadius, 9));
        this.arena.hp[index] = Math.max(1, finite(init.hp, 80));
        this.arena.maxHp[index] = this.arena.hp[index];
        this.arena.mass[index] = Math.max(0.1, finite(init.shardMass, 10));
      }
      members[member] = index;
    }
    const record = createHexBodyRecord({
      bodyId: slot + 1,
      cols: generatedCols,
      rows: generatedRows,
      memberIndices: members
    });
    record.srcWidth = Math.max(1, finite(init.srcWidth, init.cols));
    record.srcHeight = Math.max(1, finite(init.srcHeight, init.rows));
    record.pivotX = finite(init.pivotX);
    record.pivotY = finite(init.pivotY);
    record.hexSpacing = Math.max(0.001, finite(init.hexSpacing, 13.5));
    record.hexHeight = Math.max(0.001, finite(init.hexHeight, Math.sqrt(3) * 9));
    rebuildHexBodyTopology(this.arena, record);
    this.bodyHexRecords[slot] = record;
    return record;
  }

  _releaseHexBody(slot) {
    const record = this.bodyHexRecords[slot];
    if (!record) return;
    for (let member = 0; member < record.memberCount; member++) {
      const index = record.memberIndices[member];
      if (this.arena.bodyId[index] === record.bodyId) this.arena.release(index);
    }
    this.bodyHexRecords[slot] = null;
  }

  spawnProjectile(initial = {}) {
    const slot = this.projectileFreeHead;
    if (slot < 0) return -1;
    this.projectileFreeHead = this.projectileFreeNext[slot];
    this.projectileFreeNext[slot] = -1;
    this.projectileActive[slot] = 1;
    this.projectileGeneration[slot] = nextGeneration(this.projectileGeneration[slot]);
    this.projectileX[slot] = finite(initial.x);
    this.projectileY[slot] = finite(initial.y);
    this.projectilePrevX[slot] = this.projectileX[slot];
    this.projectilePrevY[slot] = this.projectileY[slot];
    this.projectileVx[slot] = finite(initial.vx);
    this.projectileVy[slot] = finite(initial.vy);
    this.projectileRadius[slot] = Math.max(0, finite(initial.radius, 1));
    this.projectileDamage[slot] = Math.max(0, finite(initial.damage));
    this.projectileLife[slot] = Math.max(0, finite(initial.life, 1));
    this.projectilePenetration[slot] = Math.max(1, Number(initial.penetration) | 0 || 1);
    this.projectileOwnerBody[slot] = Number.isInteger(Number(initial.ownerBody))
      ? Number(initial.ownerBody) | 0
      : -1;
    this.projectileCount++;
    return slot;
  }

  _releaseProjectile(slot, eventType = PHYSICS_EVENT.PROJECTILE_EXPIRED) {
    if (this.projectileActive[slot] === 0) return;
    this.projectileActive[slot] = 0;
    this.projectileFreeNext[slot] = this.projectileFreeHead;
    this.projectileFreeHead = slot;
    this.projectileCount = Math.max(0, this.projectileCount - 1);
    if (eventType) this._emit(eventType, slot, this.projectileGeneration[slot]);
  }

  drainCommands(commandRing) {
    if (!commandRing) return 0;
    let count = 0;
    while (commandRing.pop(this._command)) {
      this.applyCommand(this._command);
      count++;
    }
    return count;
  }

  drainAiCommands(commandRing) {
    if (!commandRing) return 0;
    let count = 0;
    while (commandRing.pop(this._aiCommand)) {
      const command = this._aiCommand;
      const type = Number(command[0]) | 0;
      const body = Number(command[2]) | 0;
      const generation = Number(command[3]) >>> 0;
      if (type === AI_COMMAND.CONTROL && this.isBodyAlive(body, generation)) {
        this.bodyAiThrust[body] = Math.max(-1, Math.min(1, finite(command[4])));
        this.bodyAiTurn[body] = Math.max(-1, Math.min(1, finite(command[5])));
        this.bodyTarget[body] = Number(command[6]) | 0;
        if (command[7] > 0) {
          const aimX = finite(command[8], this.bodyX[body] + Math.cos(this.bodyAngle[body]));
          const aimY = finite(command[9], this.bodyY[body] + Math.sin(this.bodyAngle[body]));
          const dx = aimX - this.bodyX[body];
          const dy = aimY - this.bodyY[body];
          const distance = Math.hypot(dx, dy) || 1;
          const speed = this.bodyProjectileSpeed[body];
          this.spawnProjectile({
            ownerBody: body,
            x: this.bodyX[body], y: this.bodyY[body],
            vx: dx / distance * speed + this.bodyVx[body],
            vy: dy / distance * speed + this.bodyVy[body],
            radius: 2, damage: 12, life: 4, penetration: 1
          });
        }
      }
      count++;
    }
    return count;
  }

  applyCommand(command) {
    const type = Number(command[0]) | 0;
    const slot = Number(command[2]) | 0;
    const generation = Number(command[3]) >>> 0;
    if (type === PHYSICS_COMMAND.DESPAWN_BODY) return this.despawnBody(slot, generation);
    if (type === PHYSICS_COMMAND.SET_BODY_STATE) {
      return this.setBodyState(slot, {
        generation,
        x: command[4], y: command[5], vx: command[6], vy: command[7],
        angle: command[8], angVel: command[9], flags: command[10],
        distance: command[11], timeToContact: command[12]
      });
    }
    if (type === PHYSICS_COMMAND.APPLY_IMPACT) {
      return this.applyImpact(slot, command[4], command[5], command[6]);
    }
    if (type === PHYSICS_COMMAND.SPAWN_PROJECTILE) {
      return this.spawnProjectile({
        ownerBody: slot,
        x: command[4], y: command[5], vx: command[6], vy: command[7],
        radius: command[8], damage: command[9], life: command[10], penetration: command[11]
      });
    }
    return false;
  }

  applyImpact(bodySlot, worldX, worldY, damage) {
    if (!this.isBodyAlive(bodySlot)) return false;
    const shardIndex = this._probeHex(bodySlot, worldX, worldY);
    if (shardIndex >= 0) {
      this.arena.hp[shardIndex] = Math.max(0, this.arena.hp[shardIndex] - Math.max(0, finite(damage)));
      this.arena.markDirty(shardIndex);
      if (this.arena.hp[shardIndex] <= 0) {
        const record = this.bodyHexRecords[bodySlot];
        setHexBodyShardActive(this.arena, record, shardIndex, false, true);
        this._emit(PHYSICS_EVENT.SHARD_DESTROYED, bodySlot, shardIndex, this.arena.generation[shardIndex], worldX, worldY);
      }
      return true;
    }
    this.bodyHp[bodySlot] = Math.max(0, this.bodyHp[bodySlot] - Math.max(0, finite(damage)));
    return true;
  }

  step(baseDt = 1 / SIM_TICK_HZ, tick = this.tick + 1, budgetPressure = this.budgetPressure) {
    const start = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    this.tick = Number(tick) >>> 0;
    this.budgetPressure = Math.max(0, finite(budgetPressure));
    let integratedBodies = 0;

    for (let body = 0; body < this.maxBodies; body++) {
      if (this.bodyActive[body] === 0) continue;
      this.bodyPrevX[body] = this.bodyX[body];
      this.bodyPrevY[body] = this.bodyY[body];
      const speed = Math.hypot(this.bodyVx[body], this.bodyVy[body]);
      const tier = this.scheduler.classify(body, {
        flags: this.bodyFlags[body],
        distance: this.bodyDistance[body],
        speed,
        angularSpeed: this.bodyAngVel[body],
        timeToContact: this.bodyTimeToContact[body]
      }, this.tick, this.budgetPressure);
      if (tier === SIMULATION_TIER.SLEEP || !this.scheduler.shouldStep(body, this.tick)) continue;
      const dt = this.scheduler.consumeStepDt(body, this.tick, baseDt);
      this.bodyLastStepDt[body] = dt;
      this.bodyAngVel[body] += this.bodyAiTurn[body] * this.bodyTurnAccel[body] * dt;
      this.bodyAngle[body] += this.bodyAngVel[body] * dt;
      const acceleration = this.bodyAiThrust[body] * this.bodyLinearAccel[body];
      this.bodyVx[body] += Math.cos(this.bodyAngle[body]) * acceleration * dt;
      this.bodyVy[body] += Math.sin(this.bodyAngle[body]) * acceleration * dt;
      this.bodyX[body] += this.bodyVx[body] * dt;
      this.bodyY[body] += this.bodyVy[body] * dt;
      integratedBodies++;
    }

    this._buildBodyHash();
    const contacts = this._stepBodyContacts();
    const hits = this._stepProjectiles(baseDt);
    const end = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    this.perf.lastStepMs = end - start;
    this.perf.integratedBodies = integratedBodies;
    this.perf.projectiles = this.projectileCount;
    this.perf.hits = hits;
    this.perf.contacts = contacts;
    return this.perf;
  }

  _buildBodyHash() {
    this.hashHeads.fill(-1);
    this.maxBodyRadius = 0;
    const invCell = 1 / this.hashCellSize;
    for (let body = 0; body < this.maxBodies; body++) {
      if (this.bodyActive[body] === 0) continue;
      const cx = Math.floor(this.bodyX[body] * invCell);
      const cy = Math.floor(this.bodyY[body] * invCell);
      this.bodyCellX[body] = cx;
      this.bodyCellY[body] = cy;
      const bucket = hashCell(cx, cy, this.hashMask);
      this.hashNext[body] = this.hashHeads[bucket];
      this.hashHeads[bucket] = body;
      if (this.bodyRadius[body] > this.maxBodyRadius) this.maxBodyRadius = this.bodyRadius[body];
      if (this.bodyShieldRadius[body] > this.maxBodyRadius) this.maxBodyRadius = this.bodyShieldRadius[body];
    }
  }

  _writeShardWorld(body, shardIndex, out, offset) {
    const record = this.bodyHexRecords[body];
    const localX = (this.arena.baseX[shardIndex] + this.arena.deformX[shardIndex] - record.srcWidth * 0.5 - record.pivotX) * this.bodyScaleX[body];
    const localY = (this.arena.baseY[shardIndex] + this.arena.deformY[shardIndex] - record.srcHeight * 0.5 - record.pivotY) * this.bodyScaleY[body];
    const angle = this.bodyAngle[body];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    out[offset] = this.bodyX[body] + localX * cos - localY * sin;
    out[offset + 1] = this.bodyY[body] + localX * sin + localY * cos;
  }

  _findHexContactDirection(sourceBody, targetBody, out) {
    const sourceRecord = this.bodyHexRecords[sourceBody];
    const targetRecord = this.bodyHexRecords[targetBody];
    if (!sourceRecord || !targetRecord || sourceRecord.boundaryCount <= 0) return false;
    let bestPenetration = 0;
    out[7] = 0;

    for (let slot = 0; slot < sourceRecord.boundaryCount; slot++) {
      const sourceShard = sourceRecord.boundaryIndices[slot];
      if (!this.arena.isActive(sourceShard)) continue;
      const world = this._worldScratch;
      this._writeShardWorld(sourceBody, sourceShard, world, 0);
      const sourceWorldRadius = this.arena.hitRadius[sourceShard] * Math.max(this.bodyScaleX[sourceBody], this.bodyScaleY[sourceBody]);
      const targetScale = Math.max(this.bodyScaleX[targetBody], this.bodyScaleY[targetBody]);
      const targetShard = this._probeHex(targetBody, world[0], world[1], sourceWorldRadius / targetScale);
      if (targetShard < 0) continue;

      this._writeShardWorld(targetBody, targetShard, world, 2);
      const dx = world[2] - world[0];
      const dy = world[3] - world[1];
      const distanceSq = dx * dx + dy * dy;
      const sourceRadius = this.arena.hitRadius[sourceShard] * Math.max(this.bodyScaleX[sourceBody], this.bodyScaleY[sourceBody]);
      const targetRadius = this.arena.hitRadius[targetShard] * Math.max(this.bodyScaleX[targetBody], this.bodyScaleY[targetBody]);
      const combinedRadius = sourceRadius + targetRadius;
      if (distanceSq > combinedRadius * combinedRadius) continue;
      const distance = Math.sqrt(Math.max(1e-12, distanceSq));
      const penetration = combinedRadius - distance;
      if (penetration <= bestPenetration) continue;

      bestPenetration = penetration;
      out[0] = sourceShard;
      out[1] = targetShard;
      if (distance > 1e-5) {
        out[2] = dx / distance;
        out[3] = dy / distance;
      } else {
        const bodyDx = this.bodyX[targetBody] - this.bodyX[sourceBody];
        const bodyDy = this.bodyY[targetBody] - this.bodyY[sourceBody];
        const bodyDistance = Math.hypot(bodyDx, bodyDy) || 1;
        out[2] = bodyDx / bodyDistance;
        out[3] = bodyDy / bodyDistance;
      }
      out[4] = penetration;
      out[5] = (world[0] + world[2]) * 0.5;
      out[6] = (world[1] + world[3]) * 0.5;
      out[7] = 1;
    }
    return out[7] === 1;
  }

  _applyShardDeform(index, localX, localY, amount) {
    const maxDeform = 100;
    this.arena.targetX[index] = Math.max(-maxDeform, Math.min(maxDeform, this.arena.targetX[index] + localX * amount));
    this.arena.targetY[index] = Math.max(-maxDeform, Math.min(maxDeform, this.arena.targetY[index] + localY * amount));
    this.arena.markDirty(index);
  }

  _deformContactShard(body, shardIndex, worldDx, worldDy, amount) {
    if (shardIndex < 0 || !this.arena.isActive(shardIndex)) return;
    const angle = this.bodyAngle[body];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const localX = (worldDx * cos + worldDy * sin) / this.bodyScaleX[body];
    const localY = (-worldDx * sin + worldDy * cos) / this.bodyScaleY[body];
    this._applyShardDeform(shardIndex, localX, localY, amount);
    const neighborBase = shardIndex * 6;
    for (let neighbor = 0; neighbor < 6; neighbor++) {
      const neighborIndex = this.arena.neighbors[neighborBase + neighbor];
      if (neighborIndex >= 0 && this.arena.isActive(neighborIndex)) {
        this._applyShardDeform(neighborIndex, localX, localY, amount * 0.35);
      }
    }
  }

  _resolveBodyContact(bodyA, bodyB, nx, ny, penetration, shardA = -1, shardB = -1) {
    const invMassA = 1 / Math.max(1, this.bodyMass[bodyA]);
    const invMassB = 1 / Math.max(1, this.bodyMass[bodyB]);
    const invMassSum = invMassA + invMassB;
    const relativeNormalVelocity = (this.bodyVx[bodyB] - this.bodyVx[bodyA]) * nx +
      (this.bodyVy[bodyB] - this.bodyVy[bodyA]) * ny;
    if (relativeNormalVelocity < 0) {
      const impulse = -(1.05 * relativeNormalVelocity) / invMassSum;
      this.bodyVx[bodyA] -= impulse * nx * invMassA;
      this.bodyVy[bodyA] -= impulse * ny * invMassA;
      this.bodyVx[bodyB] += impulse * nx * invMassB;
      this.bodyVy[bodyB] += impulse * ny * invMassB;
    }

    const correction = Math.max(0, penetration - 0.02) * 0.35 / invMassSum;
    this.bodyX[bodyA] -= correction * nx * invMassA;
    this.bodyY[bodyA] -= correction * ny * invMassA;
    this.bodyX[bodyB] += correction * nx * invMassB;
    this.bodyY[bodyB] += correction * ny * invMassB;
    const deformAmount = Math.min(12, Math.max(0.15, penetration * 0.3));
    if (shardA >= 0) this._deformContactShard(bodyA, shardA, -nx, -ny, deformAmount);
    if (shardB >= 0) this._deformContactShard(bodyB, shardB, nx, ny, deformAmount);
    this.scheduler.markContact(bodyA, this.tick);
    this.scheduler.markContact(bodyB, this.tick);
  }

  _testBodyPair(bodyA, bodyB) {
    const radius = this.bodyRadius[bodyA] + this.bodyRadius[bodyB];
    const dx = this.bodyX[bodyB] - this.bodyX[bodyA];
    const dy = this.bodyY[bodyB] - this.bodyY[bodyA];
    const distanceSq = dx * dx + dy * dy;
    const currentOverlap = distanceSq <= radius * radius;
    const relativePrevX = this.bodyPrevX[bodyA] - this.bodyPrevX[bodyB];
    const relativePrevY = this.bodyPrevY[bodyA] - this.bodyPrevY[bodyB];
    const relativeX = this.bodyX[bodyA] - this.bodyX[bodyB];
    const relativeY = this.bodyY[bodyA] - this.bodyY[bodyB];
    const sweptToi = segmentCircleToi(relativePrevX, relativePrevY, relativeX, relativeY, 0, 0, radius);
    if (!currentOverlap && sweptToi < 0) return false;

    const recordA = this.bodyHexRecords[bodyA];
    const recordB = this.bodyHexRecords[bodyB];
    if (currentOverlap && recordA && recordB) {
      const forward = this._findHexContactDirection(bodyA, bodyB, this._contact);
      const reverse = this._findHexContactDirection(bodyB, bodyA, this._reverseContact);
      if (!forward && !reverse) return false;
      const centerDx = this.bodyX[bodyB] - this.bodyX[bodyA];
      const centerDy = this.bodyY[bodyB] - this.bodyY[bodyA];
      if (reverse && (!forward || this._reverseContact[4] > this._contact[4])) {
        let nx = -this._reverseContact[2];
        let ny = -this._reverseContact[3];
        if (nx * centerDx + ny * centerDy < 0) { nx = -nx; ny = -ny; }
        this._resolveBodyContact(
          bodyA, bodyB,
          nx, ny, this._reverseContact[4],
          this._reverseContact[1], this._reverseContact[0]
        );
      } else {
        let nx = this._contact[2];
        let ny = this._contact[3];
        if (nx * centerDx + ny * centerDy < 0) { nx = -nx; ny = -ny; }
        this._resolveBodyContact(
          bodyA, bodyB,
          nx, ny, this._contact[4],
          this._contact[0], this._contact[1]
        );
      }
      return true;
    }

    let nx;
    let ny;
    let penetration = 0.01;
    if (currentOverlap) {
      const distance = Math.sqrt(Math.max(1e-12, distanceSq));
      nx = dx / distance;
      ny = dy / distance;
      penetration = radius - distance;
    } else {
      const relX = relativePrevX + (relativeX - relativePrevX) * sweptToi;
      const relY = relativePrevY + (relativeY - relativePrevY) * sweptToi;
      const distance = Math.hypot(relX, relY) || 1;
      nx = -relX / distance;
      ny = -relY / distance;
    }
    this._resolveBodyContact(bodyA, bodyB, nx, ny, penetration);
    return true;
  }

  _stepBodyContacts() {
    let contacts = 0;
    const invCell = 1 / this.hashCellSize;
    for (let bodyA = 0; bodyA < this.maxBodies; bodyA++) {
      if (this.bodyActive[bodyA] === 0) continue;
      const padding = this.bodyRadius[bodyA] + this.maxBodyRadius;
      const minCellX = Math.floor((Math.min(this.bodyPrevX[bodyA], this.bodyX[bodyA]) - padding) * invCell);
      const maxCellX = Math.floor((Math.max(this.bodyPrevX[bodyA], this.bodyX[bodyA]) + padding) * invCell);
      const minCellY = Math.floor((Math.min(this.bodyPrevY[bodyA], this.bodyY[bodyA]) - padding) * invCell);
      const maxCellY = Math.floor((Math.max(this.bodyPrevY[bodyA], this.bodyY[bodyA]) + padding) * invCell);
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          const bucket = hashCell(cellX, cellY, this.hashMask);
          for (let bodyB = this.hashHeads[bucket]; bodyB >= 0; bodyB = this.hashNext[bodyB]) {
            if (bodyB <= bodyA || this.bodyCellX[bodyB] !== cellX || this.bodyCellY[bodyB] !== cellY) continue;
            if (this._testBodyPair(bodyA, bodyB)) contacts++;
          }
        }
      }
    }
    return contacts;
  }

  _safeSeparateBodies(bodyA, bodyB) {
    if (!this.isBodyAlive(bodyA) || !this.isBodyAlive(bodyB)) return false;
    const dx = this.bodyX[bodyB] - this.bodyX[bodyA];
    const dy = this.bodyY[bodyB] - this.bodyY[bodyA];
    const distance = Math.hypot(dx, dy) || 1;
    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = Math.max(0.5, this.bodyRadius[bodyA] + this.bodyRadius[bodyB] - distance);
    this._resolveBodyContact(bodyA, bodyB, nx, ny, Math.min(overlap, 32));
    return true;
  }

  consumeGpuContacts(contactBuffer, expectedTick = this.tick) {
    if (!contactBuffer?.readRecord) return { accepted: 0, stale: 0, overflowPairs: 0 };
    let accepted = 0;
    let stale = 0;
    for (let index = 0; index < contactBuffer.count; index++) {
      const record = this._gpuRecord;
      contactBuffer.readRecord(index, record);
      const revisionA = this.bodyHexRecords[record.bodyA]?.revision || 0;
      const revisionB = this.bodyHexRecords[record.bodyB]?.revision || 0;
      if (record.tickId !== (Number(expectedTick) >>> 0) || record.revisionA !== revisionA || record.revisionB !== revisionB) {
        stale++;
        continue;
      }
      if (!this.isBodyAlive(record.bodyA) || !this.isBodyAlive(record.bodyB)) {
        stale++;
        continue;
      }
      const normalLength = Math.hypot(record.normalX, record.normalY);
      if (normalLength < 1e-6) {
        stale++;
        continue;
      }
      this._resolveBodyContact(
        record.bodyA,
        record.bodyB,
        record.normalX / normalLength,
        record.normalY / normalLength,
        record.penetration,
        record.shardA,
        record.shardB
      );
      accepted++;
    }

    let overflowPairs = 0;
    if (contactBuffer.overflow) {
      const queue = contactBuffer.overflowPairs;
      for (let index = 0; index < queue.count; index++) {
        if (this._safeSeparateBodies(queue.bodyA[index], queue.bodyB[index])) overflowPairs++;
      }
      this._emit(PHYSICS_EVENT.CONTACT_OVERFLOW, overflowPairs, contactBuffer.dropped, expectedTick);
    }
    return { accepted, stale, overflowPairs };
  }

  _stepProjectiles(dt) {
    let hits = 0;
    const invCell = 1 / this.hashCellSize;
    for (let projectile = 0; projectile < this.maxProjectiles; projectile++) {
      if (this.projectileActive[projectile] === 0) continue;
      const x0 = this.projectileX[projectile];
      const y0 = this.projectileY[projectile];
      const x1 = x0 + this.projectileVx[projectile] * dt;
      const y1 = y0 + this.projectileVy[projectile] * dt;
      this.projectilePrevX[projectile] = x0;
      this.projectilePrevY[projectile] = y0;
      this.projectileX[projectile] = x1;
      this.projectileY[projectile] = y1;
      this.projectileLife[projectile] -= dt;
      if (this.projectileLife[projectile] <= 0) {
        this._releaseProjectile(projectile);
        continue;
      }

      const padding = this.maxBodyRadius + this.projectileRadius[projectile];
      const minCellX = Math.floor((Math.min(x0, x1) - padding) * invCell);
      const maxCellX = Math.floor((Math.max(x0, x1) + padding) * invCell);
      const minCellY = Math.floor((Math.min(y0, y1) - padding) * invCell);
      const maxCellY = Math.floor((Math.max(y0, y1) + padding) * invCell);
      let bestBody = -1;
      let bestToi = 2;
      let bestShield = false;

      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          const bucket = hashCell(cellX, cellY, this.hashMask);
          for (let body = this.hashHeads[bucket]; body >= 0; body = this.hashNext[body]) {
            if (this.bodyCellX[body] !== cellX || this.bodyCellY[body] !== cellY) continue;
            if (body === this.projectileOwnerBody[projectile]) continue;
            const shield = this.bodyShield[body] > 0 && this.bodyShieldRadius[body] > 0;
            const radius = (shield ? this.bodyShieldRadius[body] : this.bodyRadius[body]) + this.projectileRadius[projectile];
            const toi = segmentCircleToi(x0, y0, x1, y1, this.bodyX[body], this.bodyY[body], radius);
            if (toi >= 0 && toi < bestToi) {
              bestToi = toi;
              bestBody = body;
              bestShield = shield;
            }
          }
        }
      }

      if (bestBody < 0) continue;
      const hitX = x0 + (x1 - x0) * bestToi;
      const hitY = y0 + (y1 - y0) * bestToi;
      const damage = this.projectileDamage[projectile];
      if (bestShield) {
        this.bodyShield[bestBody] = Math.max(0, this.bodyShield[bestBody] - damage);
        this._emit(PHYSICS_EVENT.SHIELD_HIT, bestBody, projectile, 0, hitX, hitY, damage);
      } else {
        this.applyImpact(bestBody, hitX, hitY, damage);
        this._emit(PHYSICS_EVENT.PROJECTILE_HIT, bestBody, projectile, 0, hitX, hitY, damage);
      }
      this.scheduler.markContact(bestBody, this.tick);
      this.projectilePenetration[projectile]--;
      hits++;
      if (this.projectilePenetration[projectile] <= 0) this._releaseProjectile(projectile, 0);
    }
    return hits;
  }

  _probeHex(bodySlot, worldX, worldY, radiusPadding = 0) {
    const record = this.bodyHexRecords[bodySlot];
    if (!record) return -1;
    const dx = worldX - this.bodyX[bodySlot];
    const dy = worldY - this.bodyY[bodySlot];
    const angle = this.bodyAngle[bodySlot];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const localX = (dx * cos + dy * sin) / this.bodyScaleX[bodySlot] + record.srcWidth * 0.5 + record.pivotX;
    const localY = (-dx * sin + dy * cos) / this.bodyScaleY[bodySlot] + record.srcHeight * 0.5 + record.pivotY;
    const approxC = Math.round(localX / record.hexSpacing);
    let bestIndex = -1;
    let bestDistanceSq = Infinity;

    for (let dc = -2; dc <= 2; dc++) {
      const c = approxC + dc;
      if (c < 0 || c >= record.cols) continue;
      const rowOffset = (c & 1) !== 0 ? record.hexHeight * 0.5 : 0;
      const approxR = Math.round((localY - rowOffset) / record.hexHeight);
      for (let dr = -2; dr <= 2; dr++) {
        const r = approxR + dr;
        if (r < 0 || r >= record.rows) continue;
        const shardIndex = record.cellToShard[c + r * record.cols];
        if (shardIndex < 0 || !this.arena.isActive(shardIndex)) continue;
        const sx = this.arena.baseX[shardIndex] + this.arena.deformX[shardIndex];
        const sy = this.arena.baseY[shardIndex] + this.arena.deformY[shardIndex];
        const shardDx = localX - sx;
        const shardDy = localY - sy;
        const distanceSq = shardDx * shardDx + shardDy * shardDy;
        const radius = this.arena.hitRadius[shardIndex] + Math.max(0, finite(radiusPadding));
        if (distanceSq <= radius * radius && distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestIndex = shardIndex;
        }
      }
    }
    return bestIndex;
  }

  writeBodySnapshot(targetPage) {
    let count = 0;
    const maxRecords = Math.floor(targetPage.length / BODY_SNAPSHOT_STRIDE);
    for (let body = 0; body < this.maxBodies && count < maxRecords; body++) {
      if (this.bodyActive[body] === 0) continue;
      const offset = count * BODY_SNAPSHOT_STRIDE;
      targetPage[offset] = body;
      targetPage[offset + 1] = this.bodyGeneration[body];
      targetPage[offset + 2] = this.bodyEntityId[body];
      targetPage[offset + 3] = this.bodyFlags[body];
      targetPage[offset + 4] = this.bodyX[body];
      targetPage[offset + 5] = this.bodyY[body];
      targetPage[offset + 6] = this.bodyVx[body];
      targetPage[offset + 7] = this.bodyVy[body];
      targetPage[offset + 8] = this.bodyAngle[body];
      targetPage[offset + 9] = this.bodyAngVel[body];
      targetPage[offset + 10] = this.bodyHp[body];
      targetPage[offset + 11] = this.bodyShield[body];
      targetPage[offset + 12] = this.scheduler.tier[body];
      targetPage[offset + 13] = this.bodyLastStepDt[body];
      targetPage[offset + 14] = this.bodyHexRecords[body]?.activeCount || 0;
      targetPage[offset + 15] = this.bodyHexRecords[body]?.revision || 0;
      count++;
    }
    return count;
  }

  writeAiSnapshot(targetPage) {
    let count = 0;
    const maxRecords = Math.floor(targetPage.length / AI_SNAPSHOT_STRIDE);
    for (let body = 0; body < this.maxBodies && count < maxRecords; body++) {
      if (this.bodyActive[body] === 0) continue;
      const offset = count * AI_SNAPSHOT_STRIDE;
      targetPage[offset] = body;
      targetPage[offset + 1] = this.bodyGeneration[body];
      targetPage[offset + 2] = this.bodyTeam[body];
      targetPage[offset + 3] = this.bodyFlags[body];
      targetPage[offset + 4] = this.bodyX[body];
      targetPage[offset + 5] = this.bodyY[body];
      targetPage[offset + 6] = this.bodyVx[body];
      targetPage[offset + 7] = this.bodyVy[body];
      targetPage[offset + 8] = this.bodyAngle[body];
      targetPage[offset + 9] = this.bodyTarget[body];
      targetPage[offset + 10] = this.bodyProjectileSpeed[body];
      targetPage[offset + 11] = this.bodyTurnAccel[body];
      targetPage[offset + 12] = this.bodyWeaponRange[body];
      targetPage[offset + 13] = this.bodyLinearAccel[body];
      targetPage[offset + 14] = this.scheduler.tier[body];
      targetPage[offset + 15] = this.bodyImportance[body];
      count++;
    }
    return count;
  }

  _emit(type, a = 0, b = 0, c = 0, x = 0, y = 0, value = 0) {
    if (!this.eventRing) return false;
    const event = this._event;
    event.fill(0);
    event[0] = type;
    event[1] = this.tick;
    event[2] = a;
    event[3] = b;
    event[4] = c;
    event[5] = x;
    event[6] = y;
    event[7] = value;
    return this.eventRing.push(event);
  }
}

export { segmentCircleToi };
