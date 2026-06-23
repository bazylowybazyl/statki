// src/game/shipEntity.js
// HYBRID PHYSICS MODEL (V53 Port) - ZOPTYMALIZOWANY

import {
  SHIP_PHYSICS,
  applyPlayerThrusterVisualState as applyFlightThrusterVisualState,
  clearThrusterVisualState as clearFlightThrusterVisualState,
  clamp01 as clampFlight01,
  composeShipThrusterCommand as composeFlightThrusterCommand,
  computeShipThrusterForces as computeFlightThrusterForces,
  updateShipThrusterState as updateFlightThrusterState
} from './flight/thrusterModel.js';
import { CAPITAL_SHIP_TEMPLATES } from '../data/ships.js';

export { SHIP_PHYSICS };


export const SHIP_SPRITE_SCALE = 1.0;

const SHIP_VISUAL_BASE = {
  turretTop: { x: -77.50, y: -57.50 },
  turretBottom: { x: -63.50, y: 81.00 },
  engineX: -210.00
};

const DEFAULT_ENGINE_VFX = {
  tune: { mainW: 2.26, mainL: 2.37, sideW: 1.0, sideL: 0.98, curve: 1.8 },
  main: {
    offset: { x: -579.29, y: -52.0 }, forward: { x: 1, y: 0 }, mount: 'rear_upper',
    baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179
  },
  mains: [
    { offset: { x: -579.29, y: -52.0 }, forward: { x: 1, y: 0 }, mount: 'rear_upper', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 },
    { offset: { x: -579.29, y: 52.0 }, forward: { x: 1, y: 0 }, mount: 'rear_lower', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 },
    { offset: { x: -431.55, y: -423.13 }, forward: { x: 1, y: 0 }, mount: 'rear_upper', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 },
    { offset: { x: -431.55, y: 423.13 }, forward: { x: 1, y: 0 }, mount: 'rear_lower', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 }
  ],
  sides: [
    { offset: { x: -288, y: -444 }, forward: { x: 0, y: 1 }, side: 'left', mount: 'lower_left', baseDeg: 180, nozzleDeg: 180, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 },
    { offset: { x: -288, y: 444 }, forward: { x: 0, y: -1 }, side: 'right', mount: 'lower_right', baseDeg: 0, nozzleDeg: 0, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 },
    { offset: { x: 348, y: -384 }, forward: { x: 0, y: 1 }, side: 'left', mount: 'upper_left', baseDeg: 180, nozzleDeg: 180, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 },
    { offset: { x: 348, y: 384 }, forward: { x: 0, y: -1 }, side: 'right', mount: 'upper_right', baseDeg: 0, nozzleDeg: 0, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 }
  ]
};

function cloneSensorProfile(profile) {
  return profile ? { ...profile } : undefined;
}


export function composeShipThrusterCommand(ship, assist = null) {
  return composeFlightThrusterCommand(ship, assist);
}


export function updateShipThrusterState(ship, dt) {
  return updateFlightThrusterState(ship, dt);
}

export function computeShipThrusterForces(ship, options = {}, outResult = undefined) {
  return computeFlightThrusterForces(ship, options, outResult);
}

function configureShipGeometry(ship) {
  const hw = ship.w / 2;
  const hh = ship.h / 2;
  const spriteScale = (Number.isFinite(Number(ship?.visual?.spriteScale)) && Number(ship.visual.spriteScale) > 0) ? Number(ship.visual.spriteScale) : SHIP_SPRITE_SCALE;

  const rotateX = (o) => ({ x: o.x * spriteScale, y: o.y * spriteScale });

  ship.visual = ship.visual || {};
  ship.visual.spriteScale = spriteScale;
  ship.visual.turretTop = rotateX(SHIP_VISUAL_BASE.turretTop);
  ship.visual.turretBottom = rotateX(SHIP_VISUAL_BASE.turretBottom);
  ship.visual.mainEngine = rotateX({ x: SHIP_VISUAL_BASE.engineX, y: 0 });

  ship.engines = ship.engines || {};
  ship.engines.main = {
    offset: { x: Math.round(-hw + 20), y: 0 },
    visualOffset: { x: ship.visual.mainEngine.x, y: ship.visual.mainEngine.y },
    vfxOffset: { ...DEFAULT_ENGINE_VFX.main.offset },
    vfxForward: { ...DEFAULT_ENGINE_VFX.main.forward },
    mount: DEFAULT_ENGINE_VFX.main.mount, baseDeg: DEFAULT_ENGINE_VFX.main.baseDeg, nozzleDeg: DEFAULT_ENGINE_VFX.main.nozzleDeg,
    gimbalMinDeg: DEFAULT_ENGINE_VFX.main.gimbalMinDeg, gimbalMaxDeg: DEFAULT_ENGINE_VFX.main.gimbalMaxDeg,
    vfxYNudge: DEFAULT_ENGINE_VFX.main.yNudge, vfxLengthMin: DEFAULT_ENGINE_VFX.main.vfxLengthMin, vfxLengthMax: DEFAULT_ENGINE_VFX.main.vfxLengthMax,
    maxThrust: 1
  };

  const sideY = Math.round(hh - 10);
  const sideVisY = Math.round((hh - 10) * spriteScale);
  ship.engines.sideLeft = { offset: { x: 0, y: -sideY }, visualOffset: { x: 0, y: -sideVisY }, maxThrust: 1 };
  ship.engines.sideRight = { offset: { x: 0, y: sideY }, visualOffset: { x: 0, y: sideVisY }, maxThrust: 1 };

  const torqX = Math.round(hw * 0.8);
  const torqVisX = Math.round((hw * 0.8) * spriteScale);
  ship.engines.torqueLeft = { offset: { x: -torqX, y: 0 }, visualOffset: { x: -torqVisX, y: 0 }, maxThrust: 1 };
  ship.engines.torqueRight = { offset: { x: torqX, y: 0 }, visualOffset: { x: torqVisX, y: 0 }, maxThrust: 1 };

  if (!ship.visual.mainThrusters) {
    ship.visual.mainThrusters = DEFAULT_ENGINE_VFX.mains.map(t => ({ ...t, offset: {...t.offset}, forward: {...t.forward} }));
  }
  if (!ship.visual.torqueThrusters) {
    ship.visual.torqueThrusters = DEFAULT_ENGINE_VFX.sides.map(t => ({ ...t, offset: {...t.offset}, forward: {...t.forward} }));
  }

  // WyczyĹ›Ä‡ i wypeĹ‚nij ponownie unikajÄ…c nowej alokacji tablicy jeĹ›li istnieje
  ship.sideGunsLeft = ship.sideGunsLeft || [];
  ship.sideGunsRight = ship.sideGunsRight || [];
  ship.sideGunsLeft.length = 0;
  ship.sideGunsRight.length = 0;
  
  const inset = 6 * spriteScale, margin = 20 * spriteScale;
  const visualHH = hh * spriteScale, visualHW = hw * spriteScale;
  
  for (let i = 0; i < 8; i++) {
    const t = 8 === 1 ? 0.5 : (i / 7);
    const xLocal = -visualHW + margin + t * ((visualHW - margin) - (-visualHW + margin));
    ship.sideGunsLeft.push({ x: Math.round(xLocal), y: -Math.round(visualHH - inset) });
    ship.sideGunsRight.push({ x: Math.round(xLocal), y: Math.round(visualHH - inset) });
  }

  const podW = Math.round(30 * spriteScale), podH = Math.round(60 * spriteScale);
  const bT = ship.visual.turretBottom, tT = ship.visual.turretTop;
  ship.pods = [
    { offset: { x: -bT.x, y: bT.y }, w: podW, h: podH },
    { offset: { x: bT.x, y: bT.y }, w: podW, h: podH },
    { offset: { x: -tT.x, y: tT.y }, w: podW, h: podH },
    { offset: { x: tT.x, y: tT.y }, w: podW, h: podH }
  ];

  ship.turret = ship.turret || { angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14 };
  ship.turret2 = ship.turret2 || { angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14 };
  ship.turret3 = ship.turret3 || { angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14 };
  ship.turret4 = ship.turret4 || { angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14 };

  ship.turret.offset = { x: -bT.x, y: bT.y };
  ship.turret2.offset = { x: bT.x, y: bT.y };
  ship.turret3.offset = { x: -tT.x, y: tT.y };
  ship.turret4.offset = { x: tT.x, y: tT.y };

  const ciwsOff = 22 * spriteScale;
  const cOffs = [
    {x: -ciwsOff, y: -ciwsOff}, {x: 0, y: -ciwsOff}, {x: ciwsOff, y: -ciwsOff},
    {x: -ciwsOff, y: 0}, {x: ciwsOff, y: 0},
    {x: -ciwsOff, y: ciwsOff}, {x: 0, y: ciwsOff}, {x: ciwsOff, y: ciwsOff}
  ];
  ship.ciws = ship.ciws || [];
  for(let i=0; i<8; i++){
    if(!ship.ciws[i]) ship.ciws[i] = { angle: 0, angVel: 0, cd: 0 };
    ship.ciws[i].offset = cOffs[i];
  }
}

export function refreshShipGeometry(ship) {
  if (!ship) return null;
  configureShipGeometry(ship);
  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));
  return ship;
}

// Zoptymalizowany konstruktor statku (unikamy deepMerge dla szybkoĹ›ci)
export function createShipEntity(options = {}) {
  const { world, overlayView, overrides } = options;
  
  const ship = {
    w: 450, h: 250, radius: 220,
    mass: SHIP_PHYSICS.PLAYER_MASS, rammingMass: SHIP_PHYSICS.PLAYER_MASS,
    pos: { 
      x: overrides?.pos?.x ?? (world?.w != null ? world.w / 2 : 0), 
      y: overrides?.pos?.y ?? (world?.h != null ? world.h / 2 : 0) 
    },
    vel: { x: overrides?.vel?.x ?? 0, y: overrides?.vel?.y ?? 0 },
    angle: 0, angVel: 0, isCapitalShip: true,
    capitalProfile: {
      spriteScale: 1.0, lengthScale: 2.1, widthScale: 1.2, spriteRotation: 0,
      spriteOffset: { x: 0, y: 0 }, spriteSrc: "assets/capital_ship_rect_v1.png", spriteNormalSrc: null,
      engineGlowSize: 0.35, engineColor: 'rgba(100, 200, 255, 0.85)',
      engineOffsets: [{ x: -0.42, y: -0.15 }, { x: -0.42, y: 0.15 }, { x: -0.45, y: 0 }]
    },
    shield: {
      max: 18000, val: 18000, regenRate: 150, regenDelay: 2.5, regenTimer: 0,
      state: 'active', activationProgress: 1.0, currentAlpha: 1.0,
      energyShotTimer: 0, energyShotDuration: 0.5, impacts: [], hexScale: 12, baseAlpha: 0.12
    },
    hull: { max: 12000, val: 12000 },
    special: { cooldown: 10, cooldownTimer: 0 },
    agility: { active: false, cooldowns: { dash: 0, strafe: 0, arc: 0 }, maxCooldowns: { dash: 2.5, strafe: 2.5, arc: 5.0 }, arcCharge: 0, arcDir: 0, lastPivot: null, maneuver: null },
    input: { thrustX: 0, thrustY: 0, aimX: 0, aimY: 0 },
    thrusterInput: { main: 0, leftSide: 0, rightSide: 0, retro: 0, torque: 0 },
    controller: 'player',
    aiController: null,
    sensors: cloneSensorProfile(CAPITAL_SHIP_TEMPLATES.supercapital?.sensors)
  };

  if (overrides) {
    Object.assign(ship, overrides);
    // Zachowujemy referencje obiektĂłw wewnÄ™trznych, jeĹ›li nadpisujemy je pĹ‚ytko (waĹĽne dla wydajnoĹ›ci)
  }

  configureShipGeometry(ship);
  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));

  if (overlayView) {
    overlayView.center.x = ship.pos.x;
    overlayView.center.y = ship.pos.y;
  }

  return ship;
}

export function applyPlayerInput(ship, control = {}, thrusterTarget) {
  if (!ship) return thrusterTarget || null;
  if (control.controller) ship.controller = control.controller;

  if (control.thrustX !== undefined) ship.input.thrustX = control.thrustX;
  if (control.thrustY !== undefined) ship.input.thrustY = control.thrustY;
  if (control.aimX !== undefined) ship.input.aimX = control.aimX;
  if (control.aimY !== undefined) ship.input.aimY = control.aimY;

  // FIX: Zawsze upewniamy siÄ™, ĹĽe referencja thrusterInput statku wskazuje na aktywny cel (czyli globalne 'input' z index.html)
  const target = thrusterTarget || ship.thrusterInput || { main: 0, leftSide: 0, rightSide: 0, retro: 0, torque: 0 };
  ship.thrusterInput = target; 

  if (control.main !== undefined) target.main = control.main;
  else if (ship.input.thrustY !== undefined) target.main = Math.max(0, ship.input.thrustY);

  if (control.leftSide !== undefined) target.leftSide = control.leftSide;
  if (control.rightSide !== undefined) target.rightSide = control.rightSide;
  if (control.retro !== undefined) target.retro = clampFlight01(control.retro);
  else if (ship.input.thrustY !== undefined) target.retro = Math.max(0, -(Number(ship.input.thrustY) || 0));
  if (control.torque !== undefined) target.torque = control.torque;

  if (ship.destroyed) clearFlightThrusterVisualState(ship);
  else applyFlightThrusterVisualState(ship, target);
  
  return target;
}
