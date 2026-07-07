export const DEFAULT_FIGHTER_SQUADRON_ID = 'multirole';

export const HANGAR_SQUADRON_CAPACITY = Object.freeze({
  S: 1,
  M: 3,
  L: 9,
  Capital: 9
});

export const FIGHTER_SQUADRON_DEFS = Object.freeze({
  interceptor: Object.freeze({
    id: 'interceptor',
    name: 'Interceptor Squadron',
    role: 'Anti-fighter screen',
    squadSize: 9,
    hp: 80,
    accel: 460,
    maxSpeed: 820,
    turn: 9.5,
    radius: 12,
    mass: 0.8,
    separationRange: 30,
    weaponId: 'laser_pd_mk1',
    missileId: 'osa_micro_missile',
    missileAmmo: 6,
    color: '#8fdcff'
  }),
  multirole: Object.freeze({
    id: 'multirole',
    name: 'Multirole Fighter Squadron',
    role: 'Balanced escort',
    squadSize: 9,
    hp: 120,
    accel: 350,
    maxSpeed: 650,
    turn: 7.0,
    radius: 12,
    mass: 0.8,
    separationRange: 30,
    weaponId: 'ciws_mk1',
    missileId: 'osa_micro_missile',
    missileAmmo: 8,
    color: '#7cff91'
  }),
  strike: Object.freeze({
    id: 'strike',
    name: 'Strike Fighter Squadron',
    role: 'Heavy attack wing',
    squadSize: 9,
    hp: 150,
    accel: 320,
    maxSpeed: 600,
    turn: 6.2,
    radius: 13,
    mass: 0.95,
    separationRange: 34,
    weaponId: 'ciws_mk2',
    missileId: 'fast_missile_rack',
    missileAmmo: 4,
    color: '#ffb86b'
  })
});

export function getDefaultFighterSquadronId() {
  return DEFAULT_FIGHTER_SQUADRON_ID;
}

export function getFighterSquadronDef(id = DEFAULT_FIGHTER_SQUADRON_ID) {
  return FIGHTER_SQUADRON_DEFS[id] || FIGHTER_SQUADRON_DEFS[DEFAULT_FIGHTER_SQUADRON_ID];
}

export function getHangarSquadronCapacity(size) {
  return HANGAR_SQUADRON_CAPACITY[String(size || '').trim()] || HANGAR_SQUADRON_CAPACITY.S;
}

export function getHangarModuleIdForSquadron(squadronId = DEFAULT_FIGHTER_SQUADRON_ID) {
  const def = getFighterSquadronDef(squadronId);
  return `fighter_squad_${def.id}`;
}

export function getSquadronIdForHangarModule(moduleId) {
  const id = String(moduleId || '').trim();
  if (id === 'fighter_bay') return DEFAULT_FIGHTER_SQUADRON_ID;
  const prefix = 'fighter_squad_';
  if (!id.startsWith(prefix)) return null;
  const squadronId = id.slice(prefix.length);
  return FIGHTER_SQUADRON_DEFS[squadronId] ? squadronId : null;
}

export function normalizeHangarSquadronMounts(moduleIds, capacity = 1) {
  const cap = Math.max(0, Number(capacity) || 0);
  if (!Array.isArray(moduleIds) || cap <= 0) return [];

  const out = [];
  for (const moduleId of moduleIds) {
    const squadronId = getSquadronIdForHangarModule(moduleId);
    if (!squadronId) continue;
    out.push(getHangarModuleIdForSquadron(squadronId));
    if (out.length >= cap) break;
  }
  return out;
}

export function addHangarSquadronMount(moduleIds, moduleId, capacity = 1) {
  const current = normalizeHangarSquadronMounts(moduleIds, capacity);
  if (current.length >= Math.max(0, Number(capacity) || 0)) return current;

  const squadronId = getSquadronIdForHangarModule(moduleId);
  if (!squadronId) return current;

  current.push(getHangarModuleIdForSquadron(squadronId));
  return normalizeHangarSquadronMounts(current, capacity);
}
