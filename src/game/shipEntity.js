const SHIP_TEMPLATE = {
  w: 100,
  h: 300,
  mass: 140,
  pos: { x: 0, y: 0 },
  vel: { x: 0, y: 0 },
  angle: 0,
  angVel: 0,
  inertia: null,
  linearDamping: 0.9,
  angularDamping: 1.6,
  engines: {},
  turret: {
    angle: 0,
    angVel: 0,
    maxSpeed: 1.8,
    maxAccel: 8.0,
    damping: 2.0,
    recoil: 0,
    recoilMax: 12,
    recoilRecover: 48,
    recoilKick: 14,
    offset: { x: 0, y: 0 }
  },
  turret2: {
    angle: 0,
    angVel: 0,
    maxSpeed: 1.8,
    maxAccel: 8.0,
    damping: 2.0,
    recoil: 0,
    recoilMax: 12,
    recoilRecover: 48,
    recoilKick: 14,
    offset: { x: 0, y: 0 }
  },
  turret3: {
    angle: 0,
    angVel: 0,
    maxSpeed: 1.8,
    maxAccel: 8.0,
    damping: 2.0,
    recoil: 0,
    recoilMax: 12,
    recoilRecover: 48,
    recoilKick: 14,
    offset: { x: 0, y: 0 }
  },
  turret4: {
    angle: 0,
    angVel: 0,
    maxSpeed: 1.8,
    maxAccel: 8.0,
    damping: 2.0,
    recoil: 0,
    recoilMax: 12,
    recoilRecover: 48,
    recoilKick: 14,
    offset: { x: 0, y: 0 }
  },
  shield: { max: 15000, val: 15000, regenRate: 100, regenDelay: 2, regenTimer: 0 },
  hull: { max: 10000, val: 1000 },
  special: { cooldown: 10, cooldownTimer: 0 },
  input: { thrustX: 0, thrustY: 0, aimX: 0, aimY: 0 },
  controller: 'player',
  aiController: null
};

const SHIP_SPRITE_SCALE = 1.22;
const SHIP_VISUAL_BASE = {
  turretTop:    { x: 38.18587785469991, y: -52.448366304887465 },
  turretBottom: { x: 42.60145666564039, y:  43.668730035791256 },
  engineY: 119.44796580188681
};

function clone(value) {
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = clone(value[key]);
    }
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

function configureShipGeometry(ship) {
  const hw = ship.w / 2;
  const hh = ship.h / 2;

  ship.visual = {
    spriteScale: SHIP_SPRITE_SCALE,
    turretTop: {
      x: SHIP_VISUAL_BASE.turretTop.x * SHIP_SPRITE_SCALE,
      y: SHIP_VISUAL_BASE.turretTop.y * SHIP_SPRITE_SCALE
    },
    turretBottom: {
      x: SHIP_VISUAL_BASE.turretBottom.x * SHIP_SPRITE_SCALE,
      y: SHIP_VISUAL_BASE.turretBottom.y * SHIP_SPRITE_SCALE
    },
    mainEngine: {
      x: 0,
      y: Math.round(SHIP_VISUAL_BASE.engineY * SHIP_SPRITE_SCALE)
    }
  };

  ship.engines = ship.engines || {};
  ship.engines.main = {
    offset: { x: 0, y: Math.round(hh - 8) },
    visualOffset: { x: 0, y: ship.visual.mainEngine.y },
    maxThrust: ship.engines.main?.maxThrust ?? 12800
  };

  const sidePhysX = Math.round(hw - 8);
  const sideVisualX = Math.round((hw - 8) * ship.visual.spriteScale);
  ship.engines.sideLeft = {
    offset: { x: -sidePhysX, y: 0 },
    visualOffset: { x: -sideVisualX, y: 0 },
    maxThrust: ship.engines.sideLeft?.maxThrust ?? 3000
  };
  ship.engines.sideRight = {
    offset: { x: sidePhysX, y: 0 },
    visualOffset: { x: sideVisualX, y: 0 },
    maxThrust: ship.engines.sideRight?.maxThrust ?? 3000
  };

  const torquePhysY = Math.round(hh - 8);
  const torqueVisualY = Math.round((hh - 8) * ship.visual.spriteScale);
  ship.engines.torqueLeft = {
    offset: { x: 0, y: -torquePhysY },
    visualOffset: { x: 0, y: -torqueVisualY },
    maxThrust: ship.engines.torqueLeft?.maxThrust ?? 3000
  };
  ship.engines.torqueRight = {
    offset: { x: 0, y: torquePhysY },
    visualOffset: { x: 0, y: torqueVisualY },
    maxThrust: ship.engines.torqueRight?.maxThrust ?? 3000
  };

  const torqueThrusterX = sideVisualX + Math.round(12 * ship.visual.spriteScale);
  const torqueThrusterY = Math.round(54 * ship.visual.spriteScale);

  const torqueThrusterPodW = 16 * ship.visual.spriteScale;
  const torqueThrusterNozzleInset = 2 * ship.visual.spriteScale;
  const torqueThrusterNozzleW = 10 * ship.visual.spriteScale;
  const torqueThrusterNozzleH = 14 * ship.visual.spriteScale;

  const torqueThrusterExit = (torqueThrusterPodW / 2 - torqueThrusterNozzleInset) + torqueThrusterNozzleW * 0.85;
  const torqueThrusterNudge = -Math.round(torqueThrusterExit);

  const torqueThrusterVfxWidthMin = Math.round(torqueThrusterNozzleH * 0.75);
  const torqueThrusterVfxWidthMax = Math.round(torqueThrusterNozzleH * 1.25);
  const torqueThrusterVfxLengthMin = Math.round(torqueThrusterNozzleW * 1.4);
  const torqueThrusterVfxLengthMax = Math.round(torqueThrusterNozzleW * 2.6);
  ship.visual.torqueThrusters = [
    {
      offset: { x: -torqueThrusterX, y: -torqueThrusterY },
      forward: { x: 1, y: 0 },
      side: 'left',
      yNudge: torqueThrusterNudge,
      vfxWidthMin: torqueThrusterVfxWidthMin,
      vfxWidthMax: torqueThrusterVfxWidthMax,
      vfxLengthMin: torqueThrusterVfxLengthMin,
      vfxLengthMax: torqueThrusterVfxLengthMax
    },
    {
      offset: { x: -torqueThrusterX, y: torqueThrusterY },
      forward: { x: 1, y: 0 },
      side: 'left',
      yNudge: torqueThrusterNudge,
      vfxWidthMin: torqueThrusterVfxWidthMin,
      vfxWidthMax: torqueThrusterVfxWidthMax,
      vfxLengthMin: torqueThrusterVfxLengthMin,
      vfxLengthMax: torqueThrusterVfxLengthMax
    },
    {
      offset: { x: torqueThrusterX, y: -torqueThrusterY },
      forward: { x: -1, y: 0 },
      side: 'right',
      yNudge: torqueThrusterNudge,
      vfxWidthMin: torqueThrusterVfxWidthMin,
      vfxWidthMax: torqueThrusterVfxWidthMax,
      vfxLengthMin: torqueThrusterVfxLengthMin,
      vfxLengthMax: torqueThrusterVfxLengthMax
    },
    {
      offset: { x: torqueThrusterX, y: torqueThrusterY },
      forward: { x: -1, y: 0 },
      side: 'right',
      yNudge: torqueThrusterNudge,
      vfxWidthMin: torqueThrusterVfxWidthMin,
      vfxWidthMax: torqueThrusterVfxWidthMax,
      vfxLengthMin: torqueThrusterVfxLengthMin,
      vfxLengthMax: torqueThrusterVfxLengthMax
    }
  ];

  ship.sideGunsLeft = [];
  ship.sideGunsRight = [];
  const gunsPer = 8;
  const inset = 6 * ship.visual.spriteScale;
  const margin = 12 * ship.visual.spriteScale;
  const visualHH = hh * ship.visual.spriteScale;
  const visualHW = hw * ship.visual.spriteScale;
  for (let i = 0; i < gunsPer; i++) {
    const t = gunsPer === 1 ? 0.5 : (i / (gunsPer - 1));
    const yLocal = -visualHH + margin + t * ((visualHH - margin) - (-visualHH + margin));
    ship.sideGunsLeft.push({ x: -Math.round(visualHW - inset), y: Math.round(yLocal) });
    ship.sideGunsRight.push({ x: Math.round(visualHW - inset), y: Math.round(yLocal) });
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

  ship.turret.offset = { x: -bottomTurret.x, y: bottomTurret.y };
  ship.turret2.offset = { x: bottomTurret.x, y: bottomTurret.y };
  ship.turret3.offset = { x: -topTurret.x, y: topTurret.y };
  ship.turret4.offset = { x: topTurret.x, y: topTurret.y };

  const ciwsOff = 20 * ship.visual.spriteScale;
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

export function createShipEntity(options = {}) {
  const { world, overlayView, overrides } = options;
  const ship = clone(SHIP_TEMPLATE);

  const worldCenterX = world?.w != null ? world.w / 2 : ship.pos.x;
  const worldCenterY = world?.h != null ? world.h / 2 : ship.pos.y;

  ship.pos = {
    x: overrides?.pos?.x ?? worldCenterX,
    y: overrides?.pos?.y ?? worldCenterY
  };
  ship.vel = {
    x: overrides?.vel?.x ?? ship.vel.x,
    y: overrides?.vel?.y ?? ship.vel.y
  };
  if (typeof overrides?.angle === 'number') {
    ship.angle = overrides.angle;
  }
  if (typeof overrides?.angVel === 'number') {
    ship.angVel = overrides.angVel;
  }
  if (typeof overrides?.mass === 'number') {
    ship.mass = overrides.mass;
  }
  if (typeof overrides?.linearDamping === 'number') {
    ship.linearDamping = overrides.linearDamping;
  }
  if (typeof overrides?.angularDamping === 'number') {
    ship.angularDamping = overrides.angularDamping;
  }
  if (typeof overrides?.w === 'number') {
    ship.w = overrides.w;
  }
  if (typeof overrides?.h === 'number') {
    ship.h = overrides.h;
  }

  configureShipGeometry(ship);
  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));

  if (overrides) {
    const rest = { ...overrides };
    delete rest.pos;
    delete rest.vel;
    delete rest.angle;
    delete rest.angVel;
    delete rest.mass;
    delete rest.linearDamping;
    delete rest.angularDamping;
    delete rest.w;
    delete rest.h;
    if (rest.controller) ship.controller = rest.controller;
    if (rest.aiController) ship.aiController = rest.aiController;
    delete rest.controller;
    delete rest.aiController;
    deepMerge(ship, rest);
  }

  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));

  if (overlayView) {
    overlayView.center.x = ship.pos.x;
    overlayView.center.y = ship.pos.y;
  }

  return ship;
}

export function applyPlayerInput(ship, control = {}, thrusterTarget) {
  if (!ship) return thrusterTarget || null;

  if (Object.prototype.hasOwnProperty.call(control, 'controller')) {
    if (control.controller) {
      ship.controller = control.controller;
    }
  }

  if (typeof control.thrustX === 'number') ship.input.thrustX = control.thrustX;
  if (typeof control.thrustY === 'number') ship.input.thrustY = control.thrustY;
  if (typeof control.aimX === 'number') ship.input.aimX = control.aimX;
  if (typeof control.aimY === 'number') ship.input.aimY = control.aimY;

  const target = thrusterTarget || ship.thrusterInput || { main: 0, leftSide: 0, rightSide: 0, torque: 0 };

  if (typeof control.main === 'number') target.main = control.main;
  else if (typeof ship.input.thrustY === 'number') target.main = Math.max(0, ship.input.thrustY);

  if (typeof control.leftSide === 'number') target.leftSide = control.leftSide;
  if (typeof control.rightSide === 'number') target.rightSide = control.rightSide;
  if (typeof control.torque === 'number') target.torque = control.torque;

  ship.thrusterInput = target;
  return target;
}

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

export { SHIP_SPRITE_SCALE };
