export const CRITICAL_MODULE_TYPES = Object.freeze({
  CORE: 'core',
  BRIDGE: 'bridge'
});

export function normalizeCriticalModuleType(kind) {
  const raw = String(kind || '').toLowerCase();
  if (raw === CRITICAL_MODULE_TYPES.BRIDGE) return CRITICAL_MODULE_TYPES.BRIDGE;
  return CRITICAL_MODULE_TYPES.CORE;
}

export function normalizeCriticalMarker(marker, idx = 0, kind = CRITICAL_MODULE_TYPES.CORE) {
  const x = Number(marker?.x);
  const y = Number(marker?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const type = normalizeCriticalModuleType(marker?.type || kind);
  const prefix = type === CRITICAL_MODULE_TYPES.BRIDGE ? 'bridge' : 'core';
  return {
    id: marker?.id || `${prefix}_${idx}`,
    x,
    y,
    type
  };
}

export function getCriticalModuleFailureMode(kind) {
  const type = normalizeCriticalModuleType(kind);
  if (type === CRITICAL_MODULE_TYPES.BRIDGE) {
    return {
      kind: CRITICAL_MODULE_TYPES.BRIDGE,
      destroy: false,
      disable: true,
      createWreck: true,
      reactorExplosion: false
    };
  }
  return {
    kind: CRITICAL_MODULE_TYPES.CORE,
    destroy: true,
    disable: false,
    createWreck: false,
    reactorExplosion: true
  };
}

export function collectActiveStructuralShards(entity) {
  const shards = entity?.hexGrid?.shards;
  if (!Array.isArray(shards)) return [];
  return shards.filter(shard => shard && shard.active !== false && !shard.isDebris && (shard.hp == null || shard.hp > 0));
}
