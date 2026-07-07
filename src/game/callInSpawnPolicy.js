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
  const templateFaction = String(template?.faction || '').trim().toLowerCase();
  const requestedFaction = friendly ? 'terran' : (dummy ? 'independent' : 'pirate');
  const faction = template?.pirate ? 'pirate' : (templateFaction === 'independent' ? 'independent' : requestedFaction);
  const weaponFaction = faction === 'pirate' ? 'pirate' : 'terran';
  const visualFaction = faction;

  return {
    mode: normalized,
    faction,
    friendly,
    isPirate: faction === 'pirate',
    aiEnabled: !dummy,
    joinSupportWing: friendly && faction === 'terran',
    registerFleet: friendly && faction === 'terran',
    weaponFaction,
    visualFaction,
    color: faction === 'terran' ? (template?.color || '#7cff91') : (faction === 'independent' ? '#eeb763' : '#ff5c7c')
  };
}

export function getCallInHullFrame(type, policy, template = {}) {
  const key = String(type || template?.supportType || template?.id || '').trim().toLowerCase();
  const visualFaction = policy?.visualFaction || (policy?.isPirate ? 'pirate' : 'terran');
  const pirateHull = visualFaction === 'pirate';

  if (key === 'fighter' || key === 'interceptor') return null;
  if (key === 'atlas') return 'atlas';
  if (key.includes('frigate')) return pirateHull ? 'pirate_frigate' : 'terran_frigate';
  if (key === 'destroyer') return pirateHull ? 'pirate_destroyer' : 'terran_destroyer';
  if (key === 'battleship' || key === 'pirate_battleship') return pirateHull ? 'pirate_battleship' : 'terran_battleship';
  if (key === 'carrier') return pirateHull ? null : 'terran_carrier';
  if (key === 'megafreighter') return 'megafreighter';
  if (key === 'supercapital') return pirateHull ? null : 'terran_supercapital';

  return null;
}
