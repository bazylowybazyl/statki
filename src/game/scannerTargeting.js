const TONE_PRIORITY = {
  hostile: 0,
  resource: 1,
  station: 2,
  neutral: 3,
  friendly: 4,
  ghost: 5
};

export const DEFAULT_SENSOR_PROFILE = {
  passiveRange: 25000,
  activeRange: 10000,
  lockRange: 10000,
  asteroidScanRange: 10000,
  scanWaveSpeed: 4000,
  role: 'combat'
};

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function positiveSensorNumber(value, fallback) {
  return positiveNumber(value, fallback);
}

function asteroidSource(target) {
  return target?.asteroidRef || target;
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

function formatDecimal(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(digits).replace(/\.?0+$/, '');
}

function titleCaseName(value) {
  return String(value || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function getAsteroidDisplayName(asteroid) {
  const a = asteroidSource(asteroid) || {};
  const material = titleCaseName(a.type || a.resource || 'Unknown');
  return `${material || 'Unknown'} Asteroid`;
}

export function isAsteroidTarget(target) {
  const a = asteroidSource(target);
  if (!a) return false;
  if (a.isAsteroidTarget === true || a.isAsteroid === true || a.isAsteroidHex === true) return true;
  return Number.isFinite(Number(a.worldX)) &&
    Number.isFinite(Number(a.worldY)) &&
    Number.isFinite(Number(a.scale)) &&
    (a.type != null || a.size != null || a.resource != null || a.alive !== undefined);
}

export function isTargetAlive(target) {
  if (!target) return false;
  const a = asteroidSource(target);
  if (isAsteroidTarget(a)) {
    return a.alive !== false && !a.dead && !a.destroyed && !a.removed;
  }
  return !target.dead && !target.destroyed && !target.removed;
}

export function getTargetX(target) {
  const a = asteroidSource(target);
  if (isAsteroidTarget(a)) return finiteNumber(a.worldX, finiteNumber(target?.x, 0));
  if (Number.isFinite(Number(target?.pos?.x))) return Number(target.pos.x);
  return finiteNumber(target?.x, 0);
}

export function getTargetY(target) {
  const a = asteroidSource(target);
  if (isAsteroidTarget(a)) return finiteNumber(a.worldY, finiteNumber(target?.y, 0));
  if (Number.isFinite(Number(target?.pos?.y))) return Number(target.pos.y);
  return finiteNumber(target?.y, 0);
}

export function getTargetRadius(target) {
  const a = asteroidSource(target);
  if (isAsteroidTarget(a)) {
    return Math.max(12, positiveNumber(a.scale, positiveNumber(target?.radius, 24) * 2) * 0.5);
  }
  return Math.max(
    12,
    positiveNumber(target?.radius,
      positiveNumber(target?.r,
        positiveNumber(target?.baseR,
          positiveNumber(target?.w, 24))))
  );
}

export function resolveShipSensors(entity = {}, fallback = DEFAULT_SENSOR_PROFILE) {
  const source = entity?.sensors || entity?.sensorProfile || {};
  const base = fallback || DEFAULT_SENSOR_PROFILE;
  const passiveRange = positiveSensorNumber(
    source.passiveRange ?? source.passive ?? source.radarRange,
    positiveSensorNumber(base.passiveRange, DEFAULT_SENSOR_PROFILE.passiveRange)
  );
  const activeRange = positiveSensorNumber(
    source.activeRange ?? source.active ?? source.scanRange,
    positiveSensorNumber(base.activeRange, DEFAULT_SENSOR_PROFILE.activeRange)
  );
  const lockRange = positiveSensorNumber(
    source.lockRange ?? source.targetingRange,
    positiveSensorNumber(base.lockRange, DEFAULT_SENSOR_PROFILE.lockRange)
  );
  const asteroidScanRange = Math.min(activeRange, positiveSensorNumber(
    source.asteroidScanRange ?? source.asteroidRange ?? source.resourceScanRange,
    positiveSensorNumber(
      base.asteroidScanRange ?? base.asteroidRange ?? base.resourceScanRange,
      Math.min(activeRange, DEFAULT_SENSOR_PROFILE.asteroidScanRange)
    )
  ));
  const defaultWaveSpeed = Math.max(
    DEFAULT_SENSOR_PROFILE.scanWaveSpeed,
    activeRange / 1.6
  );
  return {
    passiveRange,
    activeRange,
    lockRange,
    asteroidScanRange,
    scanWaveSpeed: positiveSensorNumber(
      source.scanWaveSpeed ?? source.waveSpeed,
      positiveSensorNumber(base.scanWaveSpeed, defaultWaveSpeed)
    ),
    role: String(source.role || base.role || DEFAULT_SENSOR_PROFILE.role)
  };
}

export function distanceBetweenTargets(owner, target) {
  if (!owner || !target) return Infinity;
  return Math.hypot(getTargetX(target) - getTargetX(owner), getTargetY(target) - getTargetY(owner));
}

export function refreshScannerContactDistances(contacts = [], owner = null) {
  if (!owner) return 0;
  let updated = 0;
  for (const contact of contacts || []) {
    if (!contact?.target || !isTargetAlive(contact.target)) continue;
    contact.distance = distanceBetweenTargets(owner, contact.target);
    updated++;
  }
  return updated;
}

export function isTargetWithinSensorRange(owner, target, rangeKey = 'passiveRange') {
  if (!isTargetAlive(target)) return false;
  const sensors = resolveShipSensors(owner);
  const range = positiveSensorNumber(sensors[rangeKey], sensors.passiveRange);
  return distanceBetweenTargets(owner, target) <= range;
}

export function isStationTarget(target) {
  const type = String(target?.type || target?.kind || target?.__scannerContactType || '').toLowerCase();
  return !!(target?.isStation || type.includes('station') || type === 'station');
}

export function isLockableTarget(target) {
  if (!isTargetAlive(target)) return false;
  if (isAsteroidTarget(target)) return true;
  if (target?.friendly === false) return true;
  if (target?.isPirate || target?.hostile || target?.isHostile) return true;
  if (isStationTarget(target)) return true;
  return false;
}

export function buildScannerContact({
  target,
  type = 'unknown',
  tone = 'neutral',
  distance = 0,
  label = '',
  classLabel = '',
  sortGroup = null
} = {}) {
  const normalizedTone = String(tone || 'neutral').toLowerCase();
  const inferredType = String(type || '').toLowerCase();
  const group = sortGroup != null && Number.isFinite(Number(sortGroup))
    ? Number(sortGroup)
    : (TONE_PRIORITY[normalizedTone] ?? TONE_PRIORITY.neutral);
  const asteroid = isAsteroidTarget(target);
  return {
    target,
    type,
    tone: normalizedTone,
    distance: Math.max(0, finiteNumber(distance, 0)),
    label: label || (asteroid || inferredType === 'asteroid' ? getAsteroidDisplayName(target) : ''),
    classLabel: classLabel || (asteroid || inferredType === 'asteroid' ? String(asteroidSource(target)?.size || '') : ''),
    sortGroup: group
  };
}

function getStationDirectoryLabel(station) {
  const planetName = station?.planet?.name;
  if (typeof planetName === 'string' && planetName.trim()) return planetName.trim();
  const stationName = station?.name;
  if (typeof stationName === 'string' && stationName.trim()) return stationName.trim();
  if (station?.id != null) return String(station.id);
  return 'Station';
}

export function buildStationDirectoryContacts(stations = [], {
  ship = null,
  centerX = null,
  centerY = null,
  limit = 3
} = {}) {
  const sx = Number.isFinite(Number(centerX)) ? Number(centerX) : Number(ship?.pos?.x);
  const sy = Number.isFinite(Number(centerY)) ? Number(centerY) : Number(ship?.pos?.y);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return [];
  const max = Math.max(0, Math.floor(finiteNumber(limit, 3)));
  if (max <= 0) return [];

  return Array.from(stations || [])
    .filter((station) => station && isTargetAlive(station))
    .map((station) => buildScannerContact({
      target: station,
      type: 'station',
      tone: 'station',
      distance: Math.hypot(getTargetX(station) - sx, getTargetY(station) - sy),
      label: getStationDirectoryLabel(station),
      classLabel: 'STACJA'
    }))
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return String(a.label || '').localeCompare(String(b.label || ''));
    })
    .slice(0, max);
}

export function sortScannerContacts(contacts = []) {
  return Array.from(contacts)
    .filter((contact) => contact && contact.target && isTargetAlive(contact.target))
    .sort((a, b) => {
      const groupA = a.sortGroup != null && Number.isFinite(Number(a.sortGroup)) ? Number(a.sortGroup) : (TONE_PRIORITY[a.tone] ?? TONE_PRIORITY.neutral);
      const groupB = b.sortGroup != null && Number.isFinite(Number(b.sortGroup)) ? Number(b.sortGroup) : (TONE_PRIORITY[b.tone] ?? TONE_PRIORITY.neutral);
      if (groupA !== groupB) return groupA - groupB;
      const distA = finiteNumber(a.distance, 0);
      const distB = finiteNumber(b.distance, 0);
      if (distA !== distB) return distA - distB;
      return String(a.label || '').localeCompare(String(b.label || ''));
    });
}

export function sortScannerSweepContacts(contacts = []) {
  return Array.from(contacts)
    .filter((contact) => contact && contact.target && isTargetAlive(contact.target))
    .sort((a, b) => {
      const distA = finiteNumber(a.distance, 0);
      const distB = finiteNumber(b.distance, 0);
      if (distA !== distB) return distA - distB;
      const groupA = a.sortGroup != null && Number.isFinite(Number(a.sortGroup)) ? Number(a.sortGroup) : (TONE_PRIORITY[a.tone] ?? TONE_PRIORITY.neutral);
      const groupB = b.sortGroup != null && Number.isFinite(Number(b.sortGroup)) ? Number(b.sortGroup) : (TONE_PRIORITY[b.tone] ?? TONE_PRIORITY.neutral);
      if (groupA !== groupB) return groupA - groupB;
      return String(a.label || '').localeCompare(String(b.label || ''));
    });
}

export function selectNearestAsteroidTargets(asteroids = [], {
  centerX = 0,
  centerY = 0,
  limit = 48
} = {}) {
  const max = Math.max(0, Math.floor(positiveNumber(limit, 0)));
  if (max <= 0) return [];
  const nearest = [];
  let farthestIdx = -1;
  let farthestDistSq = -1;

  const recomputeFarthest = () => {
    farthestIdx = -1;
    farthestDistSq = -1;
    for (let i = 0; i < nearest.length; i++) {
      const distSq = nearest[i].distSq;
      if (distSq > farthestDistSq) {
        farthestDistSq = distSq;
        farthestIdx = i;
      }
    }
  };

  for (const asteroid of asteroids || []) {
    if (!isTargetAlive(asteroid)) continue;
    const dx = getTargetX(asteroid) - centerX;
    const dy = getTargetY(asteroid) - centerY;
    const distSq = dx * dx + dy * dy;
    if (nearest.length < max) {
      nearest.push({ asteroid, distSq });
      if (distSq > farthestDistSq) {
        farthestDistSq = distSq;
        farthestIdx = nearest.length - 1;
      }
      continue;
    }
    if (distSq >= farthestDistSq) continue;
    nearest[farthestIdx] = { asteroid, distSq };
    recomputeFarthest();
  }

  nearest.sort((a, b) => a.distSq - b.distSq);
  return nearest.map((entry) => ({
    asteroid: entry.asteroid,
    distance: Math.sqrt(entry.distSq)
  }));
}

export function buildAsteroidScanDetails(asteroid) {
  const a = asteroidSource(asteroid) || {};
  const speed = Math.hypot(finiteNumber(a.vx, 0), finiteNumber(a.vy, 0));
  return {
    title: `${getAsteroidDisplayName(a).toUpperCase()} ${String(a.size || '')}`.trim(),
    rows: [
      { name: 'Type', amount: String(a.type || 'unknown') },
      { name: 'Size', amount: String(a.size || '-') },
      { name: 'Mass', amount: formatNumber(a.mass) },
      { name: 'Hull', amount: `${formatNumber(a.hp)} / ${formatNumber(a.hpMax || a.hp)}` },
      { name: 'Hardness', amount: formatDecimal(a.hardness, 2) },
      { name: 'Resource', amount: String(a.resource || '-') },
      { name: 'Yield', amount: formatNumber(a.yield) },
      { name: 'Belt', amount: String(a.beltId || '-') },
      { name: 'Velocity', amount: `${formatDecimal(speed, 0)} u/s` },
      { name: 'Spin', amount: formatDecimal(a.spin, 3) }
    ]
  };
}

export function targetPoint(target) {
  return { x: getTargetX(target), y: getTargetY(target) };
}
