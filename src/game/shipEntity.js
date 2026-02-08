// src/game/shipEntity.js
// HYBRID PHYSICS MODEL (V46 Port)
// Model hybrydowy: Kinematyczny obrót (natychmiastowy) + Dynamiczny ruch (bezwładność z tarciem)

// --- KONFIGURACJA FIZYKI (V46) ---
// Te wartości sterują zachowaniem statku w głównym silniku gry.
export const SHIP_PHYSICS = {
  SPEED: 850,           // Podstawowa siła ciągu (liniowa) - wpływa na przyspieszenie
  ROTATION_SPEED: 2.8,  // Prędkość obrotu (radiany/s) - bezpośrednia kontrola (snappy feeling)
  FRICTION: 0.985,      // Tarcie "ślizgowe" (per klatka przy 60fps) - klucz do efektu driftu
  SIDE_POWER: 0.6,      // Mnożnik mocy dla silników bocznych (Q/E)
  BOOST_MULT: 2.5       // Mnożnik prędkości przy włączonym dopalaczu (SHIFT)
};

// --- SZABLON STATKU ---
const SHIP_TEMPLATE = {
  w: 450,
  h: 250,
  radius: 220, // Promień kolizji
  
  // Masa w tym modelu służy głównie do interakcji z innymi obiektami (taranowanie),
  // a nie do obliczania przyspieszenia gracza (to jest sterowane przez SHIP_PHYSICS.SPEED).
  mass: 2500, 
  rammingMass: 80000,
  
  pos: { x: 0, y: 0 },
  vel: { x: 0, y: 0 },
  angle: 0,
  angVel: 0,
  
  // Tłumienie ustawiamy na 0, ponieważ fizykę tarcia (drift) obsługujemy ręcznie w pętli gry
  // przy użyciu parametru SHIP_PHYSICS.FRICTION.
  linearDamping: 0, 
  angularDamping: 0,

  isCapitalShip: true,

  // --- PROFIL WIZUALNY (Capital Ship) ---
  capitalProfile: {
    spriteScale: 1.0,
    lengthScale: 2.1,
    widthScale: 1.2,
    spriteRotation: 0,
    spriteOffset: { x: 0, y: 0 },
    spriteSrc: "assets/capital_ship_rect_v1.png", // Domyślna grafika
    
    // Konfiguracja efektów silników
    engineGlowSize: 0.35,
    engineColor: 'rgba(100, 200, 255, 0.85)',
    engineOffsets: [
        { x: -0.15, y: 0.42 }, // Lewa dysza główna
        { x: 0.15, y: 0.42 },  // Prawa dysza główna
        { x: 0, y: 0.45 }      // Środek
    ]
  },

  engines: {}, // Zostanie wypełnione przez configureShipGeometry

  // --- WIEŻYCZKI (Turrets) ---
  // Definicje obrotowych wieżyczek z parametrami odrzutu (recoil)
  turret: { 
    angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, 
    recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14, offset: { x: 0, y: 0 } 
  },
  turret2: { 
    angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, 
    recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14, offset: { x: 0, y: 0 } 
  },
  turret3: { 
    angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, 
    recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14, offset: { x: 0, y: 0 } 
  },
  turret4: { 
    angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, 
    recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14, offset: { x: 0, y: 0 } 
  },

  // --- TARCZA (Shield) ---
  shield: {
    max: 18000, val: 18000, 
    regenRate: 150, regenDelay: 2.5, regenTimer: 0,
    state: 'active', activationProgress: 1.0, currentAlpha: 1.0,
    energyShotTimer: 0, energyShotDuration: 0.5, 
    impacts: [], 
    hexScale: 12, baseAlpha: 0.12
  },

  hull: { max: 12000, val: 12000 },
  
  special: { cooldown: 10, cooldownTimer: 0 },
  
  // Stan wejścia sterowania
  input: { thrustX: 0, thrustY: 0, aimX: 0, aimY: 0 },
  thrusterInput: { main: 0, leftSide: 0, rightSide: 0, torque: 0 },
  
  controller: 'player',
  aiController: null
};

export const SHIP_SPRITE_SCALE = 1.0;

// Bazowe pozycje elementów wizualnych (w pikselach oryginalnego sprite'a)
const SHIP_VISUAL_BASE = {
  turretTop: { x: -57.50, y: 77.50 },
  turretBottom: { x: 81.00, y: 63.50 },
  engineY: -210.00
};

// --- FUNKCJE POMOCNICZE ---

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clone(value[key]);
    return out;
  }
  return value;
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      target[key] = value.map(clone);
    } else if (value && typeof value === 'object') {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// --- KONFIGURACJA GEOMETRII ---
function configureShipGeometry(ship) {
  const hw = ship.w / 2;
  const hh = ship.h / 2;

  const rotateOffsetToForwardX = (offset) => ({
    x: offset.x * SHIP_SPRITE_SCALE,
    y: offset.y * SHIP_SPRITE_SCALE
  });

  ship.visual = {
    ...ship.visual,
    spriteScale: SHIP_SPRITE_SCALE,
    turretTop: rotateOffsetToForwardX(SHIP_VISUAL_BASE.turretTop),
    turretBottom: rotateOffsetToForwardX(SHIP_VISUAL_BASE.turretBottom),
    mainEngine: rotateOffsetToForwardX({ x: SHIP_VISUAL_BASE.engineY, y: 0 })
  };

  // Konfiguracja fizyczna i wizualna silników
  // (Używana głównie przez system efektów cząsteczkowych)
  
  ship.engines = ship.engines || {};
  
  // 1. Silnik Główny (Rufa)
  ship.engines.main = {
    offset: { x: Math.round(-hw + 20), y: 0 },
    visualOffset: { x: ship.visual.mainEngine.x, y: ship.visual.mainEngine.y },
    maxThrust: 1 // Wartość placeholder, fizyka używa SHIP_PHYSICS.SPEED
  };

  const sidePhysY = Math.round(hh - 10);
  const sideVisualY = Math.round((hh - 10) * ship.visual.spriteScale);

  // 2. Silniki Boczne (Strafe)
  ship.engines.sideLeft = { 
    offset: { x: 0, y: -sidePhysY }, 
    visualOffset: { x: 0, y: -sideVisualY }, 
    maxThrust: 1 
  };
  ship.engines.sideRight = { 
    offset: { x: 0, y: sidePhysY }, 
    visualOffset: { x: 0, y: sideVisualY }, 
    maxThrust: 1 
  };

  // 3. Silniki Manewrowe (Obrotowe)
  const torquePhysX = Math.round(hw * 0.8);
  const torqueVisualX = Math.round((hw * 0.8) * ship.visual.spriteScale);
  
  ship.engines.torqueLeft = { 
    offset: { x: -torquePhysX, y: 0 }, 
    visualOffset: { x: -torqueVisualX, y: 0 }, 
    maxThrust: 1 
  };
  ship.engines.torqueRight = { 
    offset: { x: torquePhysX, y: 0 }, 
    visualOffset: { x: torqueVisualX, y: 0 }, 
    maxThrust: 1 
  };

  // Konfiguracja VFX dla silników manewrowych
  if (!ship.visual.torqueThrusters) {
      const topX = Math.round(-hw * 0.82 * ship.visual.spriteScale);
      const topY = Math.round(hh * 0.62 * ship.visual.spriteScale);
      const botX = Math.round(-hw * 0.68 * ship.visual.spriteScale);
      const botY = Math.round(hh * 0.42 * ship.visual.spriteScale);
      const nudge = Math.round(-48.0 * ship.visual.spriteScale);
      
      const vfxWMin = Math.round(25.9 * ship.visual.spriteScale * 0.75);
      const vfxWMax = Math.round(25.9 * ship.visual.spriteScale * 1.25);
      const vfxLMin = Math.round(41.0 * ship.visual.spriteScale * 1.4);
      const vfxLMax = Math.round(41.0 * ship.visual.spriteScale * 2.6);

      const rotateThrusterOffset = (offset) => ({
        x: offset.x,
        y: offset.y
      });

      ship.visual.torqueThrusters = [
        { offset: rotateThrusterOffset({ x: topX, y: -topY }), forward: { x: 1, y: 0 }, side: 'left', yNudge: nudge, vfxWidthMin: vfxWMin, vfxWidthMax: vfxWMax, vfxLengthMin: vfxLMin, vfxLengthMax: vfxLMax },
        { offset: rotateThrusterOffset({ x: botX, y: -botY }), forward: { x: 1, y: 0 }, side: 'left', yNudge: nudge, vfxWidthMin: vfxWMin, vfxWidthMax: vfxWMax, vfxLengthMin: vfxLMin, vfxLengthMax: vfxLMax },
        { offset: rotateThrusterOffset({ x: topX, y: topY }), forward: { x: -1, y: 0 }, side: 'right', yNudge: nudge, vfxWidthMin: vfxWMin, vfxWidthMax: vfxWMax, vfxLengthMin: vfxLMin, vfxLengthMax: vfxLMax },
        { offset: rotateThrusterOffset({ x: botX, y: botY }), forward: { x: -1, y: 0 }, side: 'right', yNudge: nudge, vfxWidthMin: vfxWMin, vfxWidthMax: vfxWMax, vfxLengthMin: vfxLMin, vfxLengthMax: vfxLMax }
      ];
  }

  // Pozycje działek bocznych (dla rakiet)
  ship.sideGunsLeft = [];
  ship.sideGunsRight = [];
  const gunsPer = 8;
  const inset = 6 * ship.visual.spriteScale;
  const margin = 20 * ship.visual.spriteScale;
  const visualHH = hh * ship.visual.spriteScale;
  const visualHW = hw * ship.visual.spriteScale;
  
  for (let i = 0; i < gunsPer; i++) {
    const t = gunsPer === 1 ? 0.5 : (i / (gunsPer - 1));
    const xLocal = -visualHW + margin + t * ((visualHW - margin) - (-visualHW + margin));
    ship.sideGunsLeft.push({ x: Math.round(xLocal), y: -Math.round(visualHH - inset) });
    ship.sideGunsRight.push({ x: Math.round(xLocal), y: Math.round(visualHH - inset) });
  }

  const podW = Math.round(30 * ship.visual.spriteScale);
  const podH = Math.round(60 * ship.visual.spriteScale);
  const bottomTurret = ship.visual.turretBottom;
  const topTurret = ship.visual.turretTop;
  ship.pods = [
    { offset: { x: -bottomTurret.x, y: bottomTurret.y }, w: podW, h: podH },
    { offset: { x: bottomTurret.x, y: bottomTurret.y }, w: podW, h: podH },
    { offset: { x: -topTurret.x, y: topTurret.y }, w: podW, h: podH },
    { offset: { x: topTurret.x, y: topTurret.y }, w: podW, h: podH }
  ];

  // Przypisanie offsetów wieżyczek
  ship.turret.offset = { x: -bottomTurret.x, y: bottomTurret.y };
  ship.turret2.offset = { x: bottomTurret.x, y: bottomTurret.y };
  ship.turret3.offset = { x: -topTurret.x, y: topTurret.y };
  ship.turret4.offset = { x: topTurret.x, y: topTurret.y };

  // CIWS (Systemy obrony bezpośredniej)
  const ciwsOff = 22 * ship.visual.spriteScale;
  ship.ciws = [
    { offset: { x: -ciwsOff, y: -ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: 0, y: -ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: ciwsOff, y: -ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: -ciwsOff, y: 0 }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: ciwsOff, y: 0 }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: -ciwsOff, y: ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: 0, y: ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: ciwsOff, y: ciwsOff }, angle: 0, angVel: 0, cd: 0 }
  ];

  ship.nextFighterPod = 0;
  ship.nextFighterOrbit = 0;
}

// --- FACTORY FUNCTION ---
export function createShipEntity(options = {}) {
  const { world, overlayView, overrides } = options;
  const ship = clone(SHIP_TEMPLATE);

  const worldCenterX = world?.w != null ? world.w / 2 : 0;
  const worldCenterY = world?.h != null ? world.h / 2 : 0;

  ship.pos = {
    x: overrides?.pos?.x ?? worldCenterX,
    y: overrides?.pos?.y ?? worldCenterY
  };
  ship.vel = {
    x: overrides?.vel?.x ?? 0,
    y: overrides?.vel?.y ?? 0
  };

  if (overrides) {
    const rest = { ...overrides };
    delete rest.pos; 
    delete rest.vel;
    deepMerge(ship, rest);
  }

  configureShipGeometry(ship);
  
  // Obliczamy moment bezwładności (Inertia) dla kolizji
  // (Mimo że obrót gracza jest kinematyczny, inertia przydaje się przy zderzeniach fizycznych)
  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));

  if (overlayView) {
    overlayView.center.x = ship.pos.x;
    overlayView.center.y = ship.pos.y;
  }

  return ship;
}

// --- OBSŁUGA INPUTU ---
export function applyPlayerInput(ship, control = {}, thrusterTarget) {
  if (!ship) return thrusterTarget || null;
  if (control.controller) ship.controller = control.controller;

  // Aktualizacja surowych danych wejściowych
  if (typeof control.thrustX === 'number') ship.input.thrustX = control.thrustX;
  if (typeof control.thrustY === 'number') ship.input.thrustY = control.thrustY;
  if (typeof control.aimX === 'number') ship.input.aimX = control.aimX;
  if (typeof control.aimY === 'number') ship.input.aimY = control.aimY;

  // Obiekt stanu silników (używany przez renderer do efektów VFX)
  const target = thrusterTarget || ship.thrusterInput || { main: 0, leftSide: 0, rightSide: 0, torque: 0 };

  // 1. Silnik główny (Main Thrust)
  if (typeof control.main === 'number') {
      target.main = control.main;
  } else if (typeof ship.input.thrustY === 'number') {
      // ThrustY jest dodatni dla 'W', więc bierzemy go bezpośrednio
      target.main = Math.max(0, ship.input.thrustY);
  }

  // 2. Silniki boczne (Strafe)
  if (typeof control.leftSide === 'number') target.leftSide = control.leftSide;
  if (typeof control.rightSide === 'number') target.rightSide = control.rightSide;

  // 3. Obrót (Torque)
  if (typeof control.torque === 'number') target.torque = control.torque;

  ship.thrusterInput = target;
  return target;
}

// --- AI PLACEHOLDER ---
export function runShipAI(ship, dt) {
  if (!ship || ship.controller !== 'ai') return null;
  const controller = ship.aiController;
  if (!controller) return null;
  
  if (typeof controller === 'function') {
    return controller(ship, dt) || null;
  }
  if (typeof controller.update === 'function') {
    return controller.update(ship, dt) || null;
  }
  return null;
}
