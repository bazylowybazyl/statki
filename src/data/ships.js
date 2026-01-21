export const SHIPS = {
  atlas: {
    id: 'atlas',
    name: 'Atlas-class',
    spec: { main: 24, missile: 8, aux: 8, hangar: 4, special: 1 },
    hardpointLayout: {
      type: 'atlas_broadside',
      rows: 4,
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
      lines: [
        { type: 'main', count: 2, start: { x: -0.2, y: -0.5 }, end: { x: 0.2, y: -0.5 } },
        { type: 'missile', count: 6, start: { x: -0.5, y: -0.25 }, end: { x: -0.5, y: 0.25 } },
        { type: 'missile', count: 6, start: { x: 0.5, y: -0.25 }, end: { x: 0.5, y: 0.25 } },
        { type: 'aux', count: 4, start: { x: 0, y: -0.2 }, end: { x: 0, y: 0.2 } },
        { type: 'hangar', count: 2, start: { x: -0.15, y: 0.5 }, end: { x: 0.15, y: 0.5 } }
      ],
      specials: [{ type: 'special', pos: { x: 0, y: 0 } }]
    }
  }
};

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
      mass: 2.5,
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
      mass: 2.5,
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
      mass: 8.0,
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
      mass: 25.0,
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
    mass: 40,
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
      spriteRotation: Math.PI / 2,
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
  }
};
