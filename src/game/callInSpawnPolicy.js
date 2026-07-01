export const CALL_IN_SPAWN_MODES = Object.freeze({
  FRIENDLY: 'friendly',
  PIRATE: 'pirate',
  DUMMY: 'dummy'
});

const VALID_MODES = new Set(Object.values(CALL_IN_SPAWN_MODES));

export function normalizeCallInSpawnMode(mode = CALL_IN_SPAWN_MODES.FRIENDLY) {
  const normalized = String(mode || '').trim().toLowerCase();
  return VALID_MODES.has(normalized) ? normalized : CALL_IN_SPAWN_MODES.FRIENDLY;
}

export function getCallInSpawnPolicy(mode = CALL_IN_SPAWN_MODES.FRIENDLY, template = {}) {
  const normalized = normalizeCallInSpawnMode(mode);
  const friendly = normalized === CALL_IN_SPAWN_MODES.FRIENDLY;
  const dummy = normalized === CALL_IN_SPAWN_MODES.DUMMY;
  const weaponFaction = friendly ? 'terran' : 'pirate';
  const visualFaction = template?.pirate ? 'pirate' : weaponFaction;

  return {
    mode: normalized,
    friendly,
    isPirate: !friendly,
    aiEnabled: !dummy,
    joinSupportWing: friendly,
    registerFleet: friendly,
    weaponFaction,
    visualFaction,
    color: friendly ? (template?.color || '#7cff91') : '#ff5c7c'
  };
}

export function getCallInHullFrame(type, policy, template = {}) {
  const key = String(type || template?.supportType || template?.id || '').trim().toLowerCase();
  const visualFaction = policy?.visualFaction || (policy?.isPirate ? 'pirate' : 'terran');
  const pirateHull = visualFaction === 'pirate';

  if (key === 'fighter' || key === 'interceptor') return null;
  if (key.includes('frigate')) return pirateHull ? 'pirate_frigate' : 'terran_frigate';
  if (key === 'destroyer') return pirateHull ? 'pirate_destroyer' : 'terran_destroyer';
  if (key === 'battleship' || key === 'pirate_battleship') return pirateHull ? 'pirate_battleship' : 'terran_battleship';
  if (key === 'carrier' || key === 'capital_carrier' || key === 'carrier_capital') return 'capital_carrier';
  if (key === 'supercapital') return 'supercapital';

  return null;
}
