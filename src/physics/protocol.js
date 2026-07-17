export const SIM_TICK_HZ = 120;
export const COMMAND_STRIDE = 16;
export const EVENT_STRIDE = 16;
export const AI_COMMAND_STRIDE = 12;
export const BODY_SNAPSHOT_STRIDE = 16;
export const AI_SNAPSHOT_STRIDE = 16;
export const GPU_CONTACT_STRIDE = 16;
export const MAX_GPU_CONTACTS = 8192;

export const PHYSICS_COMMAND = Object.freeze({
  NONE: 0,
  DESPAWN_BODY: 1,
  SET_BODY_STATE: 2,
  SET_BODY_PRIORITY: 3,
  APPLY_IMPACT: 4,
  REPAIR_BODY: 5,
  SPAWN_PROJECTILE: 6,
  APPLY_AI_COMMAND: 7,
  SET_PLAYER_INPUT: 8
});

export const PHYSICS_EVENT = Object.freeze({
  NONE: 0,
  BODY_SPAWNED: 1,
  BODY_DESPAWNED: 2,
  PROJECTILE_HIT: 3,
  PROJECTILE_EXPIRED: 4,
  SHARD_DESTROYED: 5,
  SHIELD_HIT: 6,
  BODY_SPLIT: 7,
  DEBRIS: 8,
  CONTACT_OVERFLOW: 9,
  PERF_SAMPLE: 10
});

export const AI_COMMAND = Object.freeze({
  NONE: 0,
  CONTROL: 1,
  FIRE: 2,
  TARGET: 3
});

export const BODY_FLAGS = Object.freeze({
  PLAYER: 1 << 0,
  VISIBLE: 1 << 1,
  IMPORTANT: 1 << 2,
  IN_CONTACT: 1 << 3,
  LOCKED_TARGET: 1 << 4,
  MISSION: 1 << 5,
  SLEEPING: 1 << 6
});

export function writeRecord(target, values) {
  const count = Math.min(target.length, values?.length || 0);
  let field = 0;
  for (; field < count; field++) target[field] = Number(values[field]) || 0;
  for (; field < target.length; field++) target[field] = 0;
  return target;
}
