import {
  AI_COMMAND,
  AI_COMMAND_STRIDE,
  AI_SNAPSHOT_STRIDE,
  BODY_FLAGS,
  SIM_TICK_HZ
} from './protocol.js';

function wrapAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function hashId(id, mask) {
  return Math.imul(Number(id) | 0, 2654435761) & mask;
}

export class AiKernel {
  constructor(options = {}) {
    this.maxEntities = Math.max(8, Number(options.maxEntities) | 0 || 4096);
    const lookupSize = 1 << Math.ceil(Math.log2(this.maxEntities * 2));
    this.lookupMask = lookupSize - 1;
    this.lookupKeys = new Uint32Array(lookupSize);
    this.lookupValues = new Int32Array(lookupSize);
    this.lookupStamps = new Uint32Array(lookupSize);
    this.lookupStamp = 1;
    this.nextDecisionTick = new Uint32Array(this.maxEntities);
    this.commandRing = options.commandRing || null;
    this.command = new Float64Array(AI_COMMAND_STRIDE);
    this.perf = { decisions: 0, fires: 0, lastStepMs: 0 };
  }

  _buildLookup(snapshot, count) {
    let stamp = (this.lookupStamp + 1) >>> 0;
    if (stamp === 0) {
      this.lookupStamps.fill(0);
      stamp = 1;
    }
    this.lookupStamp = stamp;
    for (let record = 0; record < count; record++) {
      const offset = record * AI_SNAPSHOT_STRIDE;
      const id = Number(snapshot[offset]) >>> 0;
      let bucket = hashId(id, this.lookupMask);
      while (this.lookupStamps[bucket] === stamp) bucket = (bucket + 1) & this.lookupMask;
      this.lookupStamps[bucket] = stamp;
      this.lookupKeys[bucket] = id;
      this.lookupValues[bucket] = record;
    }
  }

  _findRecord(id) {
    const key = Number(id) >>> 0;
    let bucket = hashId(key, this.lookupMask);
    while (this.lookupStamps[bucket] === this.lookupStamp) {
      if (this.lookupKeys[bucket] === key) return this.lookupValues[bucket];
      bucket = (bucket + 1) & this.lookupMask;
    }
    return -1;
  }

  _findNearestHostile(snapshot, count, selfRecord) {
    const selfOffset = selfRecord * AI_SNAPSHOT_STRIDE;
    const team = snapshot[selfOffset + 2];
    const x = snapshot[selfOffset + 4];
    const y = snapshot[selfOffset + 5];
    let bestRecord = -1;
    let bestDistanceSq = Infinity;
    for (let record = 0; record < count; record++) {
      if (record === selfRecord) continue;
      const offset = record * AI_SNAPSHOT_STRIDE;
      if (snapshot[offset + 2] === team) continue;
      const dx = snapshot[offset + 4] - x;
      const dy = snapshot[offset + 5] - y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestRecord = record;
      }
    }
    return bestRecord;
  }

  step(snapshot, count, tick) {
    const start = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const safeCount = Math.min(this.maxEntities, Math.max(0, Number(count) | 0));
    this._buildLookup(snapshot, safeCount);
    let decisions = 0;
    let fires = 0;

    for (let record = 0; record < safeCount; record++) {
      const offset = record * AI_SNAPSHOT_STRIDE;
      const entityId = Number(snapshot[offset]) >>> 0;
      const generation = Number(snapshot[offset + 1]) >>> 0;
      const flags = Number(snapshot[offset + 3]) | 0;
      const importance = Math.max(0, Number(snapshot[offset + 15]) || 0);
      const hz = (flags & (BODY_FLAGS.IN_CONTACT | BODY_FLAGS.LOCKED_TARGET)) !== 0 || importance >= 0.75
        ? 30
        : (flags & BODY_FLAGS.VISIBLE) !== 0 ? 15 : 5;
      if (tick < this.nextDecisionTick[record]) continue;
      this.nextDecisionTick[record] = tick + Math.max(1, Math.round(SIM_TICK_HZ / hz));

      let targetRecord = this._findRecord(snapshot[offset + 9]);
      if (targetRecord < 0) targetRecord = this._findNearestHostile(snapshot, safeCount, record);
      if (targetRecord < 0) continue;

      const targetOffset = targetRecord * AI_SNAPSHOT_STRIDE;
      const x = snapshot[offset + 4];
      const y = snapshot[offset + 5];
      const tx = snapshot[targetOffset + 4];
      const ty = snapshot[targetOffset + 5];
      const targetVx = snapshot[targetOffset + 6];
      const targetVy = snapshot[targetOffset + 7];
      const dx = tx - x;
      const dy = ty - y;
      const distance = Math.hypot(dx, dy);
      const projectileLead = Math.min(1.5, distance / Math.max(1, snapshot[offset + 10] || 600));
      const aimX = tx + targetVx * projectileLead;
      const aimY = ty + targetVy * projectileLead;
      const desiredAngle = Math.atan2(aimY - y, aimX - x);
      const angleError = wrapAngle(desiredAngle - snapshot[offset + 8]);
      const turnRate = Math.max(0.01, snapshot[offset + 11] || 1);
      const turn = Math.max(-1, Math.min(1, angleError / turnRate));
      const weaponRange = Math.max(1, snapshot[offset + 12] || 1200);
      const thrust = distance > weaponRange * 0.7 ? 1 : distance < weaponRange * 0.3 ? -0.35 : 0.15;
      const fire = distance <= weaponRange && Math.abs(angleError) < 0.16 ? 1 : 0;

      const command = this.command;
      command.fill(0);
      command[0] = AI_COMMAND.CONTROL;
      command[1] = tick;
      command[2] = entityId;
      command[3] = generation;
      command[4] = thrust;
      command[5] = turn;
      command[6] = snapshot[targetOffset];
      command[7] = fire;
      command[8] = aimX;
      command[9] = aimY;
      if (this.commandRing) this.commandRing.push(command);
      decisions++;
      fires += fire;
    }

    const end = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    this.perf.decisions = decisions;
    this.perf.fires = fires;
    this.perf.lastStepMs = end - start;
    return this.perf;
  }
}
