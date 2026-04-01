export const SHIPS = {
  atlas: {
    id: 'atlas',
    name: 'Atlas-class',
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
    name: 'Terranova Frigate',
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
    name: 'Terranova Destroyer',
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
    name: 'Terranova Battleship',
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
  }
};

const DEFAULT_RENDER_ASPECT = 1.6;
const MIN_RENDER_SIZE = 64;

export const HULL_RENDER_PROFILES = {
  atlas: { id: 'atlas', length: 2000, radius: 500 },
  supercapital: { id: 'supercapital', length: 2000, radius: 500 },
  terran_frigate: { id: 'terran_frigate', length: 320, radius: 120 },
  terran_destroyer: { id: 'terran_destroyer', length: 480, radius: 170 },
  terran_battleship: { id: 'terran_battleship', length: 1040, radius: 220 },
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
  carrier: 'capital_carrier'
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

export function getHullRenderSize(hullId, sourceWidth = 0, sourceHeight = 0) {
  const profile = getHullRenderProfile(hullId);
  const targetLength = Math.max(MIN_RENDER_SIZE, Number(profile?.length) || 0 || MIN_RENDER_SIZE);
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
    radius: Math.max(20, Number(profile?.radius) || 20),
    w: Math.max(MIN_RENDER_SIZE, Math.round(width)),
    h: Math.max(MIN_RENDER_SIZE, Math.round(height))
  };
}

export const SUPPORT_SHIP_TEMPLATES = {
  fighter: {
    color: '#7cff91',
    count: 9,
    stats: {
      hp: 120,
      accel: 350,
      maxSpeed: 650,
      turn: 7.0,
      radius: 12,
      mass: 0.8,
      separationRange: 30
    },
    spawnOffset: { x: -60, y: 0 },
    configureId: 'fighter'
  },
  interceptor: {
    stats: {
      hp: 80,
      accel: 350,
      maxSpeed: 650,
      turn: 7.0,
      radius: 12,
      mass: 0.8,
      separationRange: 30
    },
    configureId: 'interceptor'
  },
  frigate_pd: {
    shield: { max: 650, val: 650, regenRate: 130, regenDelay: 3.6, impacts: [], state: 'activating' },
    stats: {
      hp: 1200,
      accel: 200,
      maxSpeed: 280,
      turn: 1.2,
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
    stats: {
      hp: 1800,
      accel: 150,
      maxSpeed: 250,
      turn: 1.2,
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
    stats: {
      hp: 4200,
      accel: 140,
      maxSpeed: 200,
      turn: 0.9,
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
    stats: {
      hp: 12000,
      accel: 91,
      maxSpeed: 105,
      turn: 0.6,
      radius: 140,
      mass: 50000,
      rammingMass: 8000,
      friction: 0.99,
      separationRange: 440
    },
    configureId: 'battleship'
  }
};

export const CAPITAL_SHIP_TEMPLATES = {
  carrier: {
    id: 'capital_carrier',
    displayName: 'CSV Aegis',
    roleText: 'Carrier · Capital',
    hull: 42000,
    mass: 600000,
    rammingMass: 15000,
    shield: 28000,
    shieldRegen: 260,
    shieldDelay: 6,
    accel: 32,
    maxSpeed: 220,
    turn: 0.9,
    radius: 150,
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
      spriteSrc: 'assets/carrier.png',
      spriteScale: 5.0,
      spriteRotation: 0,
      shieldRotation: Math.PI / 2,
      spriteOffset: { x: 0, y: 0 },
      spriteLayer: 2,
      spriteEngineGlow: false,
      engineOffsets: [
        { x: -0.38, y: 0.92 },
        { x: 0, y: 0.95 },
        { x: 0.38, y: 0.92 }
      ],
      engineGlowSize: 0.28,
      engineOffsetMode: 'relative'
    }
  },
  supercapital: {
    id: 'supercapital',
    displayName: 'Atlas II',
    roleText: 'Supercapital',
    hull: 85000,
    mass: 100000,
    rammingMass: 800000,
    shield: 52000,
    shieldRegen: 400,
    shieldDelay: 8,
    accel: 120,
    maxSpeed: 500,
    turn: 1.2,
    radius: 220,
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
  }
};
