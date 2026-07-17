import { FIGHTER_SQUADRON_DEFS } from './fighterSquadrons.js';

export const SHIP_SENSOR_PROFILES = {
  fighter_combat: { passiveRange: 8000, activeRange: 10000, lockRange: 8000, asteroidScanRange: 8000, scanWaveSpeed: 12000, role: 'combat' },
  frigate_combat: { passiveRange: 18000, activeRange: 24000, lockRange: 20000, asteroidScanRange: 10000, scanWaveSpeed: 18000, role: 'combat' },
  destroyer_combat: { passiveRange: 30000, activeRange: 38000, lockRange: 34000, asteroidScanRange: 12000, scanWaveSpeed: 26000, role: 'combat' },
  battleship_combat: { passiveRange: 45000, activeRange: 55000, lockRange: 50000, asteroidScanRange: 14000, scanWaveSpeed: 36000, role: 'combat' },
  capital_combat: { passiveRange: 60000, activeRange: 70000, lockRange: 62000, asteroidScanRange: 16000, scanWaveSpeed: 46000, role: 'combat' },
  atlas_combat: { passiveRange: 80000, activeRange: 90000, lockRange: 75000, asteroidScanRange: 18000, scanWaveSpeed: 60000, role: 'combat' },
  frigate_radar: { passiveRange: 42000, activeRange: 52000, lockRange: 28000, asteroidScanRange: 18000, scanWaveSpeed: 34000, role: 'radar' }
};

function fighterStatsFromSquadron(def) {
  return {
    hp: def.hp,
    accel: def.accel,
    maxSpeed: def.maxSpeed,
    turn: def.turn,
    radius: def.radius,
    mass: def.mass,
    separationRange: def.separationRange
  };
}

export const SHIPS = {
  atlas: {
    id: 'atlas',
    name: 'Atlas-class',
    sensors: { ...SHIP_SENSOR_PROFILES.atlas_combat },
    spec: { main: 24, missile: 8, aux: 8, hangar: 4, special: 1 },
    hardpointLayout: {
      type: 'atlas_broadside',
      rows: 4,
      rotate: 'ccw',
      leftX: -0.230,
      rightX: 0.240,
      spreadX: 0.028,
      depthY: 0.018,
      startY: -0.400,
      gapY: 0.110
    }
  },
  corvus: {
    id: 'corvus',
    name: 'Corvus-class',
    sensors: { ...SHIP_SENSOR_PROFILES.frigate_radar },
    spec: { main: 2, missile: 12, aux: 4, hangar: 2, special: 1 },
    hardpointLayout: {
      type: 'lines',
      rotate: 'cw',
      lines: [
        { type: 'main', count: 2, start: { x: -0.2, y: -0.5 }, end: { x: 0.2, y: -0.5 } },
        { type: 'missile', count: 6, start: { x: -0.5, y: -0.25 }, end: { x: -0.5, y: 0.25 } },
        { type: 'missile', count: 6, start: { x: 0.5, y: -0.25 }, end: { x: 0.5, y: 0.25 } },
        { type: 'aux', count: 4, start: { x: 0, y: -0.2 }, end: { x: 0, y: 0.2 } },
        { type: 'hangar', count: 2, start: { x: -0.15, y: 0.5 }, end: { x: 0.15, y: 0.5 } }
      ],
      specials: [{ type: 'special', pos: { x: 0, y: 0 } }]
    }
  },
  terran_frigate: {
    id: 'terran_frigate',
    name: 'Custos-class',
    sensors: { ...SHIP_SENSOR_PROFILES.frigate_combat },
    spec: { main: 4, missile: 2, aux: 2, hangar: 1, special: 1 },
    hardpointLayout: {
      type: 'lines',
      rotate: 'cw',
      lines: [
        { type: 'main', count: 4, start: { x: -0.1, y: -0.45 }, end: { x: 0.1, y: -0.45 } },
        { type: 'missile', count: 2, start: { x: -0.36, y: -0.2 }, end: { x: 0.36, y: -0.2 } },
        { type: 'aux', count: 2, start: { x: -0.14, y: 0.0 }, end: { x: 0.14, y: 0.0 } },
        { type: 'hangar', count: 1, start: { x: 0.0, y: 0.36 }, end: { x: 0.0, y: 0.36 } }
      ],
      specials: [{ type: 'special', pos: { x: 0, y: -0.05 } }]
    }
  },
  terran_destroyer: {
    id: 'terran_destroyer',
    name: 'Hasta-class',
    sensors: { ...SHIP_SENSOR_PROFILES.destroyer_combat },
    spec: { main: 10, missile: 4, aux: 4, hangar: 1, special: 1 },
    hardpointLayout: {
      type: 'lines',
      rotate: 'cw',
      lines: [
        { type: 'main', count: 6, start: { x: -0.34, y: -0.48 }, end: { x: 0.34, y: -0.48 } },
        { type: 'main', count: 4, start: { x: -0.22, y: -0.3 }, end: { x: 0.22, y: -0.3 } },
        { type: 'missile', count: 2, start: { x: -0.42, y: -0.1 }, end: { x: -0.42, y: 0.24 } },
        { type: 'missile', count: 2, start: { x: 0.42, y: -0.1 }, end: { x: 0.42, y: 0.24 } },
        { type: 'aux', count: 4, start: { x: -0.2, y: 0.02 }, end: { x: 0.2, y: 0.02 } },
        { type: 'hangar', count: 1, start: { x: 0.0, y: 0.42 }, end: { x: 0.0, y: 0.42 } }
      ],
      specials: [{ type: 'special', pos: { x: 0, y: -0.1 } }]
    }
  },
  terran_battleship: {
    id: 'terran_battleship',
    name: 'Bellator-class',
    sensors: { ...SHIP_SENSOR_PROFILES.battleship_combat },
    spec: { main: 12, missile: 6, aux: 6, hangar: 2, special: 1 },
    hardpointLayout: {
      type: 'lines',
      rotate: 'cw',
      lines: [
        { type: 'main', count: 6, start: { x: -0.34, y: -0.5 }, end: { x: 0.34, y: -0.5 } },
        { type: 'main', count: 6, start: { x: -0.3, y: -0.34 }, end: { x: 0.3, y: -0.34 } },
        { type: 'missile', count: 3, start: { x: -0.46, y: -0.16 }, end: { x: -0.46, y: 0.24 } },
        { type: 'missile', count: 3, start: { x: 0.46, y: -0.16 }, end: { x: 0.46, y: 0.24 } },
        { type: 'aux', count: 6, start: { x: -0.26, y: -0.02 }, end: { x: 0.26, y: -0.02 } },
        { type: 'hangar', count: 2, start: { x: -0.12, y: 0.44 }, end: { x: 0.12, y: 0.44 } }
      ],
      specials: [{ type: 'special', pos: { x: 0, y: -0.12 } }]
    }
  },
  terran_carrier: {
    id: 'terran_carrier',
    name: 'Citadella-class',
    sensors: { ...SHIP_SENSOR_PROFILES.capital_combat },
    spec: { main: 8, missile: 4, aux: 8, hangar: 4, special: 1 },
    hardpointLayout: {
      type: 'lines',
      rotate: 'cw',
      lines: [
        { type: 'main', count: 4, start: { x: 0.34, y: -0.34 }, end: { x: 0.34, y: 0.34 } },
        { type: 'main', count: 4, start: { x: -0.18, y: -0.42 }, end: { x: -0.18, y: 0.42 } },
        { type: 'missile', count: 4, start: { x: 0.02, y: -0.28 }, end: { x: 0.02, y: 0.28 } },
        { type: 'aux', count: 8, start: { x: -0.42, y: -0.36 }, end: { x: -0.42, y: 0.36 } },
        { type: 'hangar', count: 4, start: { x: -0.08, y: -0.35 }, end: { x: -0.08, y: 0.35 } }
      ],
      specials: [{ type: 'special', pos: { x: 0.38, y: 0 } }]
    }
  },
  terran_supercapital: {
    id: 'terran_supercapital',
    name: 'Colossus-class',
    sensors: { ...SHIP_SENSOR_PROFILES.atlas_combat },
    spec: { main: 16, missile: 8, aux: 10, hangar: 2, special: 1 },
    hardpointLayout: {
      type: 'lines',
      rotate: 'cw',
      lines: [
        { type: 'main', count: 8, start: { x: 0.38, y: -0.42 }, end: { x: 0.38, y: 0.42 } },
        { type: 'main', count: 8, start: { x: 0.08, y: -0.46 }, end: { x: 0.08, y: 0.46 } },
        { type: 'missile', count: 8, start: { x: -0.14, y: -0.44 }, end: { x: -0.14, y: 0.44 } },
        { type: 'aux', count: 10, start: { x: -0.42, y: -0.38 }, end: { x: -0.42, y: 0.38 } },
        { type: 'hangar', count: 2, start: { x: -0.24, y: -0.20 }, end: { x: -0.24, y: 0.20 } }
      ],
      specials: [{ type: 'special', pos: { x: 0.46, y: 0 } }]
    }
  }
};

const DEFAULT_RENDER_ASPECT = 1.6;
const MIN_RENDER_SIZE = 64;
export const HULL_RENDER_WORLD_SCALE = 0.6;

export const HULL_RENDER_PROFILES = {
  atlas: { id: 'atlas', length: 3000, radius: 500 },
  megafreighter: { id: 'megafreighter', length: 4600, radius: 760 },
  supercapital: { id: 'supercapital', length: 2000, radius: 500 },
  terran_frigate: { id: 'terran_frigate', length: 320, radius: 120 },
  terran_destroyer: { id: 'terran_destroyer', length: 480, radius: 170 },
  terran_battleship: { id: 'terran_battleship', length: 1040, radius: 220 },
  terran_carrier: { id: 'terran_carrier', length: 1800, radius: 320 },
  terran_supercapital: { id: 'terran_supercapital', length: 2600, radius: 500 },
  pirate_frigate: { id: 'pirate_frigate', length: 320, radius: 120 },
  pirate_destroyer: { id: 'pirate_destroyer', length: 600, radius: 170 },
  pirate_battleship: { id: 'pirate_battleship', length: 1200, radius: 220 },
  capital_carrier: { id: 'capital_carrier', length: 1200, radius: 250 }
};

export const HULL_RENDER_PROFILE_ALIASES = {
  player: 'atlas',
  frigate: 'terran_frigate',
  destroyer: 'terran_destroyer',
  battleship: 'terran_battleship',
  carrier: 'terran_carrier'
};

export function resolveHullRenderProfileId(hullId) {
  const raw = String(hullId || '').trim().toLowerCase();
  if (!raw) return 'atlas';
  if (HULL_RENDER_PROFILES[raw]) return raw;
  if (HULL_RENDER_PROFILE_ALIASES[raw]) return HULL_RENDER_PROFILE_ALIASES[raw];
  return 'atlas';
}

export function getHullRenderProfile(hullId) {
  return HULL_RENDER_PROFILES[resolveHullRenderProfileId(hullId)] || HULL_RENDER_PROFILES.atlas;
}

// ===========================================================================
// WEAPON SIZE TIERS (S / M / L / Capital)
// ---------------------------------------------------------------------------
// The same weapon can be mounted on any hull, but its turret, muzzle flash and
// projectile scale with the SHIP CLASS that carries it. A Tempest Ion looks
// full-size on the Atlas ("as now") and much smaller on a frigate.
//   Frigate              -> S
//   Destroyer            -> M
//   Battleship / Carrier -> L
//   Atlas / Supercapital -> Capital (reference size, unchanged)
// `turret` multiplies the 3D turret mesh (and its attached muzzle flash) scale.
// `bullet` multiplies the projectile trail / core / spark thickness.
// ===========================================================================
export const WEAPON_TIER_SCALE = Object.freeze({
  S:       { turret: 0.50, bullet: 0.55 },
  M:       { turret: 0.70, bullet: 0.74 },
  L:       { turret: 0.88, bullet: 0.90 },
  Capital: { turret: 1.00, bullet: 1.00 }
});

export const WEAPON_TIER_BY_HULL = Object.freeze({
  terran_frigate: 'S',
  pirate_frigate: 'S',
  terran_destroyer: 'M',
  pirate_destroyer: 'M',
  terran_battleship: 'L',
  terran_carrier: 'L',
  terran_supercapital: 'Capital',
  pirate_battleship: 'L',
  capital_carrier: 'L',
  megafreighter: 'Capital',
  supercapital: 'Capital',
  atlas: 'Capital'
});

export function getWeaponTierForHull(hullProfileId) {
  return WEAPON_TIER_BY_HULL[resolveHullRenderProfileId(hullProfileId)] || 'Capital';
}

// Classify an in-game entity (player ship or NPC) to its hull profile id.
// Mirrors getNpcHullRenderProfileId() in index.html so weapon tiers stay in
// sync with the rendered hull. Fighters/interceptors have no dedicated hull
// profile, so they fall back to the smallest (frigate) tier.
export function resolveEntityHullProfileId(entity) {
  if (!entity) return 'atlas';
  const type = String(entity.type || '').toLowerCase();
  if (type.includes('fighter') || type.includes('interceptor')) return 'terran_frigate';
  // Explicit ship frame — set on both player ships and classified NPCs.
  if (entity.shipFrame) return resolveHullRenderProfileId(entity.shipFrame);
  if (entity.activeHullId) return resolveHullRenderProfileId(entity.activeHullId);
  const pirate = !!entity.isPirate;
  if (type === 'battleship') return pirate ? 'pirate_battleship' : 'terran_battleship';
  if (type === 'destroyer') return pirate ? 'pirate_destroyer' : 'terran_destroyer';
  if (type.includes('frigate')) return pirate ? 'pirate_frigate' : 'terran_frigate';
  if (type === 'megafreighter') return 'megafreighter';
  if (type === 'supercapital') return 'terran_supercapital';
  if (type === 'carrier') return 'terran_carrier';
  if (type === 'capital_carrier') return 'capital_carrier';
  if (entity.isCapitalShip) return 'terran_carrier';
  return 'atlas';
}

export function getEntityWeaponTier(entity) {
  return getWeaponTierForHull(resolveEntityHullProfileId(entity));
}

export function getHullRenderSize(hullId, sourceWidth = 0, sourceHeight = 0) {
  const profile = getHullRenderProfile(hullId);
  const baseLength = Math.max(MIN_RENDER_SIZE, Number(profile?.length) || 0 || MIN_RENDER_SIZE);
  const targetLength = Math.max(MIN_RENDER_SIZE, Math.round(baseLength * HULL_RENDER_WORLD_SCALE));
  const srcW = Math.max(0, Number(sourceWidth) || 0);
  const srcH = Math.max(0, Number(sourceHeight) || 0);

  let width = targetLength;
  let height = Math.max(MIN_RENDER_SIZE, Math.round(targetLength / DEFAULT_RENDER_ASPECT));

  if (srcW > 0 && srcH > 0) {
    if (srcW >= srcH) {
      width = targetLength;
      height = Math.max(MIN_RENDER_SIZE, Math.round(targetLength * (srcH / srcW)));
    } else {
      height = targetLength;
      width = Math.max(MIN_RENDER_SIZE, Math.round(targetLength * (srcW / srcH)));
    }
  }

  return {
    id: profile.id,
    length: targetLength,
    radius: Math.max(20, Math.round((Number(profile?.radius) || 20) * HULL_RENDER_WORLD_SCALE)),
    w: Math.max(MIN_RENDER_SIZE, Math.round(width)),
    h: Math.max(MIN_RENDER_SIZE, Math.round(height))
  };
}

export const SUPPORT_SHIP_TEMPLATES = {
  fighter: {
    color: FIGHTER_SQUADRON_DEFS.multirole.color,
    count: FIGHTER_SQUADRON_DEFS.multirole.squadSize,
    sensors: { ...SHIP_SENSOR_PROFILES.fighter_combat },
    squadronId: 'multirole',
    stats: fighterStatsFromSquadron(FIGHTER_SQUADRON_DEFS.multirole),
    spawnOffset: { x: -60, y: 0 },
    configureId: 'fighter'
  },
  interceptor: {
    color: FIGHTER_SQUADRON_DEFS.interceptor.color,
    count: FIGHTER_SQUADRON_DEFS.interceptor.squadSize,
    sensors: { ...SHIP_SENSOR_PROFILES.fighter_combat },
    squadronId: 'interceptor',
    stats: fighterStatsFromSquadron(FIGHTER_SQUADRON_DEFS.interceptor),
    configureId: 'interceptor'
  },
  frigate_pd: {
    shield: { max: 650, val: 650, regenRate: 130, regenDelay: 3.6, impacts: [], state: 'activating' },
    sensors: { ...SHIP_SENSOR_PROFILES.frigate_combat },
    stats: {
      hp: 1200,
      accel: 260,
      maxSpeed: 420,
      turn: 1.35,
      radius: 45,
      mass: 10000,
      rammingMass: 1000,
      friction: 0.985,
      separationRange: 160
    },
    configureId: 'frigate_pd'
  },
  frigate_laser: {
    shield: { max: 900, val: 900, regenRate: 140, regenDelay: 3.8, impacts: [], state: 'activating' },
    sensors: { ...SHIP_SENSOR_PROFILES.frigate_combat },
    stats: {
      hp: 1800,
      accel: 230,
      maxSpeed: 380,
      turn: 1.15,
      radius: 45,
      mass: 10000,
      rammingMass: 1200,
      friction: 0.985,
      separationRange: 150
    },
    configureId: 'frigate_laser'
  },
  destroyer: {
    shield: { max: 2200, val: 2200, regenRate: 200, regenDelay: 4.5, impacts: [], state: 'activating' },
    sensors: { ...SHIP_SENSOR_PROFILES.destroyer_combat },
    stats: {
      hp: 4200,
      accel: 150,
      maxSpeed: 320,
      turn: 0.82,
      radius: 35,
      mass: 25000,
      rammingMass: 5000,
      friction: 0.986,
      separationRange: 120
    },
    configureId: 'destroyer'
  },
  battleship: {
    shield: { max: 7200, val: 7200, regenRate: 320, regenDelay: 5.2, impacts: [], state: 'activating' },
    sensors: { ...SHIP_SENSOR_PROFILES.battleship_combat },
    stats: {
      hp: 12000,
      accel: 85,
      maxSpeed: 240,
      turn: 0.48,
      radius: 140,
      mass: 50000,
      rammingMass: 8000,
      friction: 0.99,
      separationRange: 440
    },
    configureId: 'battleship'
  },
  pirate_battleship: {
    shield: { max: 7200, val: 7200, regenRate: 320, regenDelay: 5.2, impacts: [], state: 'activating' },
    sensors: { ...SHIP_SENSOR_PROFILES.battleship_combat },
    stats: {
      hp: 12000,
      accel: 85,
      maxSpeed: 240,
      turn: 0.48,
      radius: 140,
      mass: 50000,
      rammingMass: 8000,
      friction: 0.99,
      separationRange: 440
    },
    configureId: 'battleship',
    supportType: 'battleship',
    pirate: true
  }
};

export const CAPITAL_SHIP_TEMPLATES = {
  carrier: {
    id: 'carrier',
    faction: 'terran',
    shipName: 'Citadella',
    classId: 'carrier',
    displayName: 'Citadella',
    sensors: { ...SHIP_SENSOR_PROFILES.capital_combat },
    roleText: 'Carrier - Terra Nova',
    hull: 42000,
    mass: 100000,
    rammingMass: 15000,
    shield: 28000,
    shieldRegen: 260,
    shieldDelay: 6,
    accel: 48,
    maxSpeed: 190,
    turn: 0.3,
    radius: 192,
    hardpoints: { large: 2, medium: 2 },
    formationOffset: { x: -820, y: 380 },
    weaponRange: 2300,
    weapons: {
      mainCannons: [
        { id: 'port', offset: { x: 0.42, y: -0.18 }, cooldown: 3.4, projectileSpeed: 1700, damage: 210, spread: 0.0038, arc: Math.PI / 2.2 },
        { id: 'starboard', offset: { x: 0.42, y: 0.18 }, cooldown: 3.4, projectileSpeed: 1700, damage: 210, spread: 0.0038, arc: Math.PI / 2.2 }
      ],
      dorsalBatteries: [
        { id: 'dorsal', offset: { x: 0.18, y: 0 }, cooldown: 1.6, projectileSpeed: 1300, damage: 38, spread: 0.012, arc: Math.PI / 1.6 }
      ]
    },
    profile: {
      lengthScale: 1.0,
      widthScale: 4.0,
      hullColor: '#5a7dbe',
      deckColor: '#243150',
      accentColor: '#9dc5ff',
      engineColor: 'rgba(130,200,255,0.9)',
      hangarGlow: 'rgba(160,200,255,0.45)',
      spriteSrc: 'src/assets/ships/terrancarrier.png',
      spriteScale: 1.0,
      spriteRotation: 0,
      shieldRotation: Math.PI / 2,
      spriteOffset: { x: 0, y: 0 },
      spriteLayer: 2,
      spriteEngineGlow: false,
      engineOffsets: [
        { x: -0.44, y: -0.18 },
        { x: -0.44, y: 0.18 },
        { x: -0.48, y: 0 }
      ],
      engineGlowSize: 0.28,
      engineOffsetMode: 'relative'
    }
  },
  supercapital: {
    id: 'supercapital',
    faction: 'terran',
    shipName: 'Colossus',
    classId: 'supercapital',
    displayName: 'Colossus',
    sensors: { ...SHIP_SENSOR_PROFILES.atlas_combat },
    roleText: 'Supercapital - Terra Nova',
    hull: 85000,
    mass: 200000,
    rammingMass: 800000,
    shield: 52000,
    shieldRegen: 400,
    shieldDelay: 8,
    accel: 24,
    maxSpeed: 140,
    turn: 0.16,
    radius: 300,
    hardpoints: { large: 4, medium: 4 },
    formationOffset: { x: -1200, y: -500 },
    weaponRange: 3200,
    weapons: {},
    profile: {
      lengthScale: 2.1,
      widthScale: 1.2,
      hullColor: '#3d5a8a',
      deckColor: '#1a2940',
      accentColor: '#7ab5ff',
      engineColor: 'rgba(100, 200, 255, 0.85)',
      spriteSrc: 'src/assets/ships/terransupercapital.png',
      spriteScale: 1.0,
      spriteRotation: 0,
      spriteOffset: { x: 0, y: 0 },
      spriteLayer: 2,
      spriteEngineGlow: false,
      engineOffsets: [
        { x: -0.42, y: -0.15 },
        { x: -0.42, y: 0.15 },
        { x: -0.45, y: 0 }
      ],
      engineGlowSize: 0.35,
      engineOffsetMode: 'relative'
    }
  },
  atlas: {
    id: 'atlas',
    faction: 'independent',
    shipName: 'Atlas',
    classId: 'supercapital',
    displayName: 'Atlas',
    sensors: { ...SHIP_SENSOR_PROFILES.atlas_combat },
    roleText: 'Independent Supercapital',
    hull: 85000,
    mass: 200000,
    rammingMass: 800000,
    shield: 52000,
    shieldRegen: 400,
    shieldDelay: 8,
    accel: 24,
    maxSpeed: 140,
    turn: 0.16,
    radius: 300,
    hardpoints: { large: 4, medium: 4 },
    formationOffset: { x: -1200, y: -500 },
    weaponRange: 3200,
    weapons: {},
    disableSupportWing: true,
    profile: {
      lengthScale: 2.1,
      widthScale: 1.2,
      hullColor: '#3d5a8a',
      deckColor: '#1a2940',
      accentColor: '#eeb763',
      engineColor: 'rgba(238, 183, 99, 0.85)',
      spriteSrc: 'assets/capital_ship_rect_v1.png',
      spriteScale: 1.0,
      spriteRotation: 0,
      spriteOffset: { x: 0, y: 0 },
      spriteLayer: 2,
      spriteEngineGlow: false,
      engineOffsets: [
        { x: -0.42, y: -0.15 },
        { x: -0.42, y: 0.15 },
        { x: -0.45, y: 0 }
      ],
      engineGlowSize: 0.35,
      engineOffsetMode: 'relative'
    }
  },
  megafreighter: {
    id: 'megafreighter',
    faction: 'independent',
    displayName: 'Megafreighter',
    sensors: { ...SHIP_SENSOR_PROFILES.capital_combat },
    roleText: 'Mega Freighter - Dummy',
    hull: 160000,
    mass: 900000,
    rammingMass: 0,
    shield: 0,
    shieldRegen: 0,
    shieldDelay: 0,
    accel: 0,
    maxSpeed: 0,
    turn: 0,
    radius: 760,
    hardpoints: { large: 0, medium: 0 },
    formationOffset: { x: -2200, y: 900 },
    weaponRange: 0,
    weapons: {},
    staticDummy: true,
    disableEditorLayout: true,
    disableSupportWing: true,
    profile: {
      lengthScale: 4.8,
      widthScale: 1.65,
      hullColor: '#4f6573',
      deckColor: '#1c2b32',
      accentColor: '#b8c5bd',
      spriteSrc: 'assets/megafreighter.png',
      spriteScale: 1.0,
      spriteRotation: 0,
      spriteOffset: { x: 0, y: 0 },
      spriteLayer: 2,
      spriteEngineGlow: false,
      engineOffsets: [],
      engineGlowSize: 0,
      engineOffsetMode: 'relative'
    }
  }
};
