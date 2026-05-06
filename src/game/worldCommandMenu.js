const NORMAL_TARGET_ACTIONS = [
  ['attack', 'ATTACK'],
  ['approach', 'APPROACH'],
  ['orbit', 'ORBIT'],
  ['jump', 'JUMP'],
  ['cruise', 'CRUISE'],
  ['scan', 'SCAN']
];

const NORMAL_EMPTY_ACTIONS = NORMAL_TARGET_ACTIONS.slice(1);

const RTS_ACTIONS = [
  ['approach', 'APPROACH'],
  ['orbit', 'ORBIT'],
  ['attack', 'ATTACK'],
  ['hold', 'HOLD'],
  ['scan', 'SCAN']
];

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

export function createApproachCommand({ point, targetEntity = null, arrival = 280 } = {}) {
  return {
    type: 'approach',
    target: targetEntity ? entityPoint(targetEntity) : pointFrom(point),
    targetEntity: targetEntity || null,
    arrival
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
    orbitRadius,
    orbitDir
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
  if (!command || command.type !== 'approach') return null;
  const target = command.targetEntity && !command.targetEntity.dead && !command.targetEntity.destroyed && !command.targetEntity.removed
    ? entityPoint(command.targetEntity)
    : entityPoint(command.target);
  if (!target) return null;
  return {
    start: pointFrom(from),
    end: target,
    arrival: Math.max(0, Number(command.arrival) || 0)
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
