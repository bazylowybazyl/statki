export const LIGHT_KINDS = Object.freeze({
  POSITION: 'position',
  ROAD: 'road'
});

export const LIGHT_DEFAULTS = Object.freeze({
  [LIGHT_KINDS.POSITION]: Object.freeze({
    color: '#ff2b2b',
    power: 0.8,
    radius: 4,
    sequenceGroup: 'edge'
  }),
  [LIGHT_KINDS.ROAD]: Object.freeze({
    color: '#ffffff',
    power: 3,
    radius: 14,
    range: 800,
    coneDeg: 40,
    deg: 90
  })
});

export function createEmptyLights() {
  return {
    [LIGHT_KINDS.POSITION]: [],
    [LIGHT_KINDS.ROAD]: []
  };
}

export function hasLightsContent(lights) {
  return !!(
    (Array.isArray(lights?.[LIGHT_KINDS.POSITION]) && lights[LIGHT_KINDS.POSITION].length) ||
    (Array.isArray(lights?.[LIGHT_KINDS.ROAD]) && lights[LIGHT_KINDS.ROAD].length)
  );
}

export function normalizeLightKind(kind) {
  const raw = String(kind || '').toLowerCase();
  if (raw === LIGHT_KINDS.POSITION || raw === 'positional' || raw === 'nav') return LIGHT_KINDS.POSITION;
  if (raw === LIGHT_KINDS.ROAD || raw === 'headlight' || raw === 'spot') return LIGHT_KINDS.ROAD;
  return null;
}

export function round2(value) {
  const num = Number(value) || 0;
  const sign = num < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(num) * 100) / 100;
}

export function normalizeDeg(value, fallback = 0) {
  let deg = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function clampPositive(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeColor(value, fallback) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  return fallback;
}

export function normalizeLightMarker(marker, kind, makeId = null) {
  const normalizedKind = normalizeLightKind(kind);
  if (!normalizedKind || !marker || typeof marker !== 'object') return null;
  const x = Number(marker.x);
  const y = Number(marker.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const defaults = LIGHT_DEFAULTS[normalizedKind];
  const maxRadius = normalizedKind === LIGHT_KINDS.POSITION ? 12 : 48;
  const maxPower = normalizedKind === LIGHT_KINDS.POSITION ? 4 : 20;
  const out = {
    id: marker.id || (typeof makeId === 'function' ? makeId() : undefined),
    x: round2(x),
    y: round2(y),
    color: normalizeColor(marker.color, defaults.color),
    power: round2(clampPositive(marker.power, 0.05, maxPower, defaults.power)),
    radius: round2(clampPositive(marker.radius, 1, maxRadius, defaults.radius))
  };

  if (!out.id) delete out.id;

  if (normalizedKind === LIGHT_KINDS.POSITION) {
    out.sequenceGroup = String(marker.sequenceGroup || defaults.sequenceGroup || 'edge');
    return out;
  }

  out.deg = round2(normalizeDeg(marker.deg, defaults.deg));
  out.range = round2(clamp(marker.range, 50, 4000, defaults.range));
  out.coneDeg = round2(clamp(marker.coneDeg, 8, 160, defaults.coneDeg));
  return out;
}

export function normalizeLightsBlock(raw, makeId = null) {
  const out = createEmptyLights();
  const source = raw && typeof raw === 'object' ? raw : {};
  for (const kind of Object.values(LIGHT_KINDS)) {
    const markers = Array.isArray(source[kind]) ? source[kind] : [];
    for (const marker of markers) {
      const normalized = normalizeLightMarker(marker, kind, makeId);
      if (normalized) out[kind].push(normalized);
    }
  }
  return out;
}

export function compactLightMarker(marker, kind) {
  const normalized = normalizeLightMarker(marker, kind);
  if (!normalized) return null;
  const out = {
    id: normalized.id,
    x: round2(normalized.x),
    y: round2(normalized.y),
    color: normalized.color,
    power: round2(normalized.power),
    radius: round2(normalized.radius)
  };

  if (kind === LIGHT_KINDS.POSITION) {
    out.sequenceGroup = normalized.sequenceGroup || LIGHT_DEFAULTS[LIGHT_KINDS.POSITION].sequenceGroup;
    return out;
  }

  out.deg = round2(normalized.deg);
  out.range = round2(normalized.range);
  out.coneDeg = round2(normalized.coneDeg);
  return out;
}
