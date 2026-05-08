const NORMAL_TARGET_ACTIONS = [
  ['attack', 'ATTACK'],
  ['ram', 'RAM'],
  ['approach', 'APPROACH'],
  ['orbit', 'ORBIT'],
  ['jump', 'JUMP'],
  ['cruise', 'CRUISE'],
  ['scan', 'SCAN']
];

const NORMAL_EMPTY_ACTIONS = NORMAL_TARGET_ACTIONS.filter(([action]) => action !== 'attack' && action !== 'ram');

const RTS_ACTIONS = [
  ['approach', 'APPROACH'],
  ['orbit', 'ORBIT'],
  ['attack', 'ATTACK'],
  ['ram', 'RAM'],
  ['hold', 'HOLD'],
  ['scan', 'SCAN']
];

const ORBIT_RANGE_PRESETS = [1000, 3000, 5000, 10000, 15000];

function menuItem([action, label]) {
  return { action, label };
}

function pointFrom(point) {
  return {
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0
  };
}

function entityPoint(entity) {
  if (!entity) return null;
  return pointFrom(entity.pos || entity);
}

function commandTargetPoint(command) {
  if (!command) return null;
  const ent = command.targetEntity;
  if (ent && !ent.dead && !ent.destroyed && !ent.removed) return entityPoint(ent);
  return entityPoint(command.target);
}

function unitSortKey(unit, index) {
  const id = unit?.id ?? unit?.uid ?? unit?.name;
  return id == null ? `~${index}` : String(id);
}

function unitRadius(unit) {
  return Math.max(8, Number(unit?.radius) || Number(unit?.r) || 20);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function buildNormalCommandMenuItems({ targetEntity = null } = {}) {
  return (targetEntity ? NORMAL_TARGET_ACTIONS : NORMAL_EMPTY_ACTIONS).map(menuItem);
}

export function buildRtsCommandMenuItems({ selectedCount = 0 } = {}) {
  const formation = Number(selectedCount) > 1;
  return [
    { action: formation ? 'move-formation' : 'move', label: formation ? 'MOVE FORMATION' : 'MOVE' },
    ...RTS_ACTIONS.map(menuItem)
  ];
}

export function buildOrbitRangeMenuItems({ currentRange = null } = {}) {
  const current = Math.max(80, Math.round(Number(currentRange) || 0));
  const currentLabel = current > 80 ? `CURRENT RANGE ${current}` : 'CURRENT RANGE';
  return [
    {
      action: 'orbit-range-current',
      label: currentLabel,
      orbitRangeMode: 'current',
      orbitRadius: current
    },
    ...ORBIT_RANGE_PRESETS.map((radius) => ({
      action: `orbit-range-${radius}`,
      label: String(radius),
      orbitRangeMode: 'preset',
      orbitRadius: radius
    })),
    {
      action: 'orbit-range-custom',
      label: 'X',
      orbitRangeMode: 'custom',
      orbitRadius: null
    }
  ];
}

export function resolveOrbitRadiusForUnit({
  unit = null,
  targetPoint = null,
  requestedRadius = null,
  fallbackRadius = 900,
  minRadius = 80
} = {}) {
  const minimum = Math.max(80, Number(minRadius) || 80);
  if (requestedRadius === 'current') {
    const unitPoint = entityPoint(unit);
    const target = entityPoint(targetPoint);
    if (unitPoint && target) {
      const dist = Math.hypot(unitPoint.x - target.x, unitPoint.y - target.y);
      if (Number.isFinite(dist) && dist > 1e-3) return Math.max(minimum, Math.round(dist));
    }
  }
  const numeric = Number(requestedRadius);
  if (Number.isFinite(numeric) && numeric > 0) return Math.max(minimum, Math.round(numeric));
  return Math.max(minimum, Math.round(Number(fallbackRadius) || 900));
}

export function createApproachCommand({ point, targetEntity = null, arrival = 280 } = {}) {
  return {
    type: 'approach',
    target: targetEntity ? entityPoint(targetEntity) : pointFrom(point),
    targetEntity: targetEntity || null,
    arrival
  };
}

export function createRamCommand({ point, targetEntity = null, arrival = null, ramImpulse = 3400 } = {}) {
  const targetRadius = targetEntity ? unitRadius(targetEntity) : 120;
  const hitArrival = Math.max(180, targetRadius + 260);
  return {
    type: 'ram',
    target: targetEntity ? entityPoint(targetEntity) : pointFrom(point),
    targetEntity: targetEntity || null,
    arrival: arrival != null && Number.isFinite(Number(arrival)) ? Number(arrival) : hitArrival,
    ramImpulse: Math.max(1600, Number(ramImpulse) || 3400)
  };
}

export function createOrbitCommand({
  point,
  targetEntity = null,
  arrival = 120,
  orbitRadius = 900,
  orbitDir = 1
} = {}) {
  return {
    type: 'orbit',
    target: targetEntity ? entityPoint(targetEntity) : pointFrom(point),
    targetEntity: targetEntity || null,
    arrival,
    orbitRadius: Math.max(80, Math.round(Number(orbitRadius) || 900)),
    orbitDir: (Number(orbitDir) || 1) >= 0 ? 1 : -1
  };
}

export function createMoveCommand({ point, arrival = 90, faceAngle = null } = {}) {
  const command = {
    type: 'move',
    target: pointFrom(point),
    arrival
  };
  if (Number.isFinite(faceAngle)) command.faceAngle = faceAngle;
  return command;
}

export function computeFormationTargets(units, anchor, faceAngle = 0) {
  const list = Array.from(units || []);
  const targets = new Map();
  if (!list.length) return targets;

  const sorted = list
    .map((unit, index) => ({ unit, index, key: unitSortKey(unit, index) }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.index - b.index);

  const center = pointFrom(anchor);
  const angle = Number.isFinite(faceAngle) ? faceAngle : 0;
  const forwardX = Math.cos(angle);
  const forwardY = Math.sin(angle);
  const sideX = -forwardY;
  const sideY = forwardX;
  const maxRadius = sorted.reduce((max, item) => Math.max(max, unitRadius(item.unit)), 20);
  const spacing = Math.max(80, maxRadius * 3);
  const cols = sorted.length <= 3 ? sorted.length : Math.ceil(Math.sqrt(sorted.length));
  const rows = Math.ceil(sorted.length / cols);

  for (let i = 0; i < sorted.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const itemsInRow = row === rows - 1 ? sorted.length - row * cols : cols;
    const sideOffset = (col - (itemsInRow - 1) / 2) * spacing;
    const forwardOffset = (row - (rows - 1) / 2) * spacing;
    targets.set(sorted[i].unit, {
      x: center.x + sideX * sideOffset + forwardX * forwardOffset,
      y: center.y + sideY * sideOffset + forwardY * forwardOffset,
      faceAngle: angle
    });
  }

  return targets;
}

export function computeRtsCameraPanDelta(keys = {}, { speed = 1200, zoom = 1, dt = 0 } = {}) {
  const right = (keys.d || keys.arrowright) ? 1 : 0;
  const left = (keys.a || keys.arrowleft) ? 1 : 0;
  const down = (keys.s || keys.arrowdown) ? 1 : 0;
  const up = (keys.w || keys.arrowup) ? 1 : 0;
  const x = right - left;
  const y = down - up;
  if (!x && !y) return { x: 0, y: 0 };
  const len = Math.hypot(x, y) || 1;
  const distance = (Number(speed) || 0) * (Number(dt) || 0) / Math.max(0.0001, Number(zoom) || 1);
  return {
    x: (x / len) * distance,
    y: (y / len) * distance
  };
}

export function computeCommandMenuOpenAnimation({ elapsed = 0, duration = 0.24 } = {}) {
  const t = clamp01((Number(elapsed) || 0) / Math.max(0.0001, Number(duration) || 0.24));
  return {
    alpha: smoothstep01(t),
    scaleY: 0.02 + 0.98 * smoothstep01(t),
    reveal: t
  };
}

export function computeAttackAutopilotState({
  distance = 0,
  weaponRanges = [],
  targetRadius = 0,
  minOrbitRadius = 420
} = {}) {
  const ranges = Array.from(weaponRanges || [])
    .map((range) => Number(range) || 0)
    .filter((range) => range > 0);
  const maxWeaponRange = ranges.length ? Math.max(...ranges) : 0;
  if (maxWeaponRange <= 0) {
    return {
      hasWeaponRange: false,
      inWeaponRange: false,
      commandType: null,
      maxWeaponRange: 0,
      approachArrival: 0,
      orbitRadius: 0
    };
  }

  const radius = Math.max(0, Number(targetRadius) || 0);
  const inWeaponRange = (Number(distance) || 0) <= maxWeaponRange;
  const approachArrival = Math.max(radius + 120, maxWeaponRange * 0.86);
  const orbitRadius = Math.min(
    maxWeaponRange * 0.92,
    Math.max(radius + 260, maxWeaponRange * 0.72, Number(minOrbitRadius) || 420)
  );
  return {
    hasWeaponRange: true,
    inWeaponRange,
    commandType: inWeaponRange ? 'orbit' : 'approach',
    maxWeaponRange,
    approachArrival,
    orbitRadius
  };
}

export function computeApproachPathLine(command, from) {
  if (!command || (command.type !== 'approach' && command.type !== 'ram')) return null;
  const target = commandTargetPoint(command);
  if (!target) return null;
  return {
    start: pointFrom(from),
    end: target,
    arrival: Math.max(0, Number(command.arrival) || 0)
  };
}

export function computeCommandVisual(command, from, unit = null) {
  if (!command) return null;
  const type = String(command.type || '').toLowerCase();
  if (!['move', 'attack-move', 'approach', 'ram', 'orbit'].includes(type)) return null;

  const target = commandTargetPoint(command);
  if (!target) return null;

  const start = pointFrom(from);
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const dist = Math.hypot(dx, dy);
  const arrival = Math.max(0, Number(command.arrival) || 0);
  const unitAngle = Number.isFinite(Number(unit?.angle)) ? Number(unit.angle) : 0;
  const faceAngle = Number.isFinite(Number(command.faceAngle))
    ? Number(command.faceAngle)
    : (dist > 1e-6 ? Math.atan2(dy, dx) : unitAngle);

  if (type === 'orbit') {
    const radius = Math.max(80, Number(command.orbitRadius) || 900);
    const orbitDir = (Number(command.orbitDir) || 1) >= 0 ? 1 : -1;
    const radialX = dist > 1e-6 ? (start.x - target.x) / dist : 1;
    const radialY = dist > 1e-6 ? (start.y - target.y) / dist : 0;
    const point = {
      x: target.x + radialX * radius,
      y: target.y + radialY * radius
    };
    const tangentX = -radialY * orbitDir;
    const tangentY = radialX * orbitDir;
    const arrowLen = Math.max(120, Math.min(420, radius * 0.24));
    const arrow = {
      start: {
        x: point.x - tangentX * arrowLen * 0.5,
        y: point.y - tangentY * arrowLen * 0.5
      },
      end: {
        x: point.x + tangentX * arrowLen * 0.5,
        y: point.y + tangentY * arrowLen * 0.5
      }
    };
    return {
      type,
      target,
      path: { start, end: point },
      arrow,
      orbit: {
        center: target,
        radius,
        dir: orbitDir,
        point,
        arrow
      }
    };
  }

  const showGhost = type === 'move' || type === 'attack-move' || type === 'approach' || type === 'ram';
  return {
    type,
    target,
    arrival,
    path: { start, end: target },
    arrow: dist > 1e-6 ? { start, end: target } : null,
    ghost: showGhost
      ? {
        pos: target,
        angle: faceAngle,
        arrival
      }
      : null
  };
}

export function hitTestCommandMenu(menu, x, y) {
  if (!menu || !Array.isArray(menu.items)) return null;
  const width = Number(menu.width) || 0;
  const itemHeight = Number(menu.itemHeight) || 0;
  const mx = Number(menu.x) || 0;
  const my = Number(menu.y) || 0;
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py) || width <= 0 || itemHeight <= 0) return null;
  if (px < mx || px > mx + width || py < my || py >= my + itemHeight * menu.items.length) return null;
  const index = Math.floor((py - my) / itemHeight);
  return menu.items[index] || null;
}
