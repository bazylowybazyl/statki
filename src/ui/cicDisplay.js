import { getHullRenderSize, resolveHullRenderProfileId } from '../data/ships.js';
import {
  formatAstronomicalUnits,
  formatLocalDistance,
  formatNavigationDistance,
  formatPhysicalVelocityKmS
} from '../config/units.js';
import { drawWreckFieldMarkers } from './wreckFieldMarkers.js';

// =============================================================================
// CIC — COMBAT INFORMATION CENTER
// =============================================================================
// Full-screen tactical overlay showing:
// - Radar sweep animation
// - Sensor contacts with NATO-style markers
// - Weapon range rings
// - Targeting queue
// - Long-range engagement controls
// =============================================================================

const CIC_CONFIG = {
  zoomDefault: 0.08,       // CIC map zoom (world units → screen)
  zoomMin: 0.0001,         // farther strategic overview before hitting CIC zoom-out limit
  zoomMax: 0.4,
  zoomSpeed: 0.0004,
  sweepSpeed: 0.6,          // radians per second
  sweepRange: 60000,        // radar sweep max range (world units)
  gridSpacing: 10000,       // world units between grid lines
  silhouetteMinPx: 18,
  colors: {
    bg: 'rgba(4, 12, 24, 0.95)',
    grid: 'rgba(30, 80, 140, 0.25)',
    gridMajor: 'rgba(40, 100, 170, 0.4)',
    sweep: 'rgba(80, 200, 255, 0.15)',
    sweepLine: 'rgba(80, 200, 255, 0.6)',
    friendly: '#4ade80',
    hostile: '#ef4444',
    unknown: '#fbbf24',
    selected: '#38bdf8',
    rangeRing: 'rgba(80, 160, 255, 0.2)',
    text: '#94a3b8',
    textBright: '#e2e8f0',
  }
};

const CIC_FIGHTER_TYPES = new Set(['fighter', 'interceptor', 'drone']);
const CIC_SILHOUETTE_CACHE = new Map();
const CIC_SOURCE_IDS = new WeakMap();
const EMPTY_CIC_WORLD_FEATURES = Object.freeze([]);
const CIC_HUD_RADAR_TRACKS = new WeakMap();
let cicSourceIdSeq = 1;
let cicHudRadarPreviousSweepAngle = null;
let cicHudRadarBurstPending = false;

function readPositiveNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function readSignedNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getEntityScaleX(entity) {
  return Math.max(
    0.0001,
    readPositiveNumber(entity?.visual?.spriteScaleX, readPositiveNumber(entity?.visual?.spriteScale, 1))
  );
}

function getEntityScaleY(entity) {
  return Math.max(
    0.0001,
    readPositiveNumber(entity?.visual?.spriteScaleY, readPositiveNumber(entity?.visual?.spriteScale, 1))
  );
}

function getEntitySpriteRotation(entity) {
  if (Number.isFinite(Number(entity?.visual?.spriteRotation))) return Number(entity.visual.spriteRotation);
  if (Number.isFinite(Number(entity?.capitalProfile?.spriteRotation))) return Number(entity.capitalProfile.spriteRotation);
  if (Number.isFinite(Number(entity?.profile?.spriteRotation))) return Number(entity.profile.spriteRotation);
  return 0;
}

function getEntityHullProfileId(entity) {
  const explicitId = String(entity?.activeHullId || entity?.shipFrame || entity?.shipId || '').trim().toLowerCase();
  if (explicitId) return resolveHullRenderProfileId(explicitId);

  const type = String(entity?.type || '').trim().toLowerCase();
  if (!type) return null;
  if (type.includes('battleship')) return resolveHullRenderProfileId(entity?.isPirate ? 'pirate_battleship' : 'terran_battleship');
  if (type.includes('destroyer')) return resolveHullRenderProfileId(entity?.isPirate ? 'pirate_destroyer' : 'terran_destroyer');
  if (type.includes('frigate')) return resolveHullRenderProfileId(entity?.isPirate ? 'pirate_frigate' : 'terran_frigate');
  if (type === 'supercapital') return resolveHullRenderProfileId('terran_supercapital');
  if (type === 'pirate_supercapital') return resolveHullRenderProfileId('pirate_supercapital');
  if (type === 'carrier') return resolveHullRenderProfileId('terran_carrier');
  if (type === 'capital_carrier') return resolveHullRenderProfileId('capital_carrier');
  return null;
}

function getEntitySpriteSource(entity) {
  const direct = entity?.renderSpriteImage || entity?.spriteImage || entity?.sprite;
  if (direct && readPositiveNumber(direct.width || direct.naturalWidth, 0) > 0) return direct;
  if (entity?.capitalSprite?.ready && entity.capitalSprite.image) return entity.capitalSprite.image;
  const beamImage = entity?.beamHull?.visualImage || entity?.beamHull?.image;
  if (beamImage && readPositiveNumber(beamImage.width || beamImage.naturalWidth, 0) > 0) return beamImage;
  const armorImage = entity?.hexGrid?.armorImage;
  if (armorImage && readPositiveNumber(armorImage.width || armorImage.naturalWidth, 0) > 0) return armorImage;
  const cacheCanvas = entity?.hexGrid?.cacheCanvas;
  if (cacheCanvas && readPositiveNumber(cacheCanvas.width, 0) > 0 && readPositiveNumber(cacheCanvas.height, 0) > 0) return cacheCanvas;
  return null;
}

function quantizeCicSize(value) {
  const px = Math.max(2, Number(value) || 2);
  const step = px >= 220 ? 10 : px >= 120 ? 8 : px >= 48 ? 4 : 2;
  return Math.max(2, Math.round(px / step) * step);
}

function getCicSourceId(source) {
  if (!source || typeof source !== 'object') return 'none';
  let id = CIC_SOURCE_IDS.get(source);
  if (!id) {
    id = `src_${cicSourceIdSeq++}`;
    CIC_SOURCE_IDS.set(source, id);
  }
  return id;
}

function getCicTintedSilhouette(source, width, height, tint) {
  if (!source) return null;
  const qW = quantizeCicSize(width);
  const qH = quantizeCicSize(height);
  const key = `${getCicSourceId(source)}|${qW}x${qH}|${tint}`;
  let cached = CIC_SILHOUETTE_CACHE.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = qW;
  canvas.height = qH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, qW, qH);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, qW, qH);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, qW, qH);
  ctx.globalCompositeOperation = 'source-over';
  CIC_SILHOUETTE_CACHE.set(key, canvas);
  return canvas;
}

// Obrys konturu sprite'a (hologram podglądu szyku i celu ruchu): tinta przesunięta w 8 kierunkach,
// środek wycięty samą sylwetką. Płótno ma margines CIC_OUTLINE_PAD px z każdej strony.
const CIC_OUTLINE_PAD = 2;
function getCicOutlineSilhouette(source, width, height, tint) {
  const filled = getCicTintedSilhouette(source, width, height, tint);
  if (!filled) return null;
  const key = `outline|${getCicSourceId(source)}|${filled.width}x${filled.height}|${tint}`;
  let cached = CIC_SILHOUETTE_CACHE.get(key);
  if (cached) return cached;
  const pad = CIC_OUTLINE_PAD;
  const canvas = document.createElement('canvas');
  canvas.width = filled.width + pad * 2;
  canvas.height = filled.height + pad * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const step = 1.25;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    ctx.drawImage(filled, pad + Math.cos(a) * step, pad + Math.sin(a) * step);
  }
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(filled, pad, pad);
  ctx.globalCompositeOperation = 'source-over';
  CIC_SILHOUETTE_CACHE.set(key, canvas);
  return canvas;
}

function getEntityHullMetrics(entity, zoom) {
  const scaleX = getEntityScaleX(entity);
  const scaleY = getEntityScaleY(entity);

  let worldW = 0;
  let worldH = 0;

  const hullGrid = entity?.hexGrid || entity?.beamHull;
  const gridW = readPositiveNumber(hullGrid?.srcWidth, 0);
  const gridH = readPositiveNumber(hullGrid?.srcHeight, 0);
  if (gridW > 0 && gridH > 0) {
    worldW = gridW * scaleX;
    worldH = gridH * scaleY;
  }

  if (!(worldW > 0 && worldH > 0)) {
    const entityW = readPositiveNumber(entity?.w, 0);
    const entityH = readPositiveNumber(entity?.h, 0);
    if (entityW > 0 && entityH > 0) {
      worldW = entityW * scaleX;
      worldH = entityH * scaleY;
    }
  }

  if (!(worldW > 0 && worldH > 0)) {
    const profileId = getEntityHullProfileId(entity);
    if (profileId) {
      const source = getEntitySpriteSource(entity);
      const srcW = readPositiveNumber(source?.naturalWidth || source?.width, 0);
      const srcH = readPositiveNumber(source?.naturalHeight || source?.height, 0);
      const size = getHullRenderSize(profileId, srcW, srcH);
      worldW = readPositiveNumber(size?.w, worldW) * scaleX;
      worldH = readPositiveNumber(size?.h, worldH) * scaleY;
    }
  }

  if (!(worldW > 0 && worldH > 0)) {
    const baseR = Math.max(1, readPositiveNumber(entity?.radius, readPositiveNumber(entity?.r, 14)));
    if (entity?.capitalProfile) {
      worldW = Math.max(worldW, baseR * Math.max(1.2, readPositiveNumber(entity.capitalProfile.lengthScale, 3.2)));
      worldH = Math.max(worldH, baseR * Math.max(1.0, readPositiveNumber(entity.capitalProfile.widthScale, 1.2)));
    } else {
      worldW = Math.max(worldW, baseR * 2);
      worldH = Math.max(worldH, baseR * 2);
    }
  }

  return {
    worldW,
    worldH,
    drawW: worldW * zoom,
    drawH: worldH * zoom
  };
}

export function getCicEntityHullMetrics(entity, zoom) {
  return getEntityHullMetrics(entity, zoom);
}

// Połowy boków prostokąta ekranu (osiowego) opisanego na obróconym kadłubie — ramka zaznaczenia
// jednostek (src/ui/commandOverlay.js). 0 / 0, gdy kadłub nie ma wymiarów.
export function getCicEntityScreenHalfExtents(entity, zoom, out = { hx: 0, hy: 0 }) {
  const metrics = getEntityHullMetrics(entity, zoom);
  const w = metrics.drawW;
  const h = metrics.drawH;
  if (!(w > 0 && h > 0)) {
    out.hx = 0;
    out.hy = 0;
    return out;
  }
  const angle = readSignedNumber(entity?.angle, 0) + getEntitySpriteRotation(entity);
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  out.hx = (w * c + h * s) * 0.5;
  out.hy = (w * s + h * c) * 0.5;
  return out;
}

function getContactPalette(isSelected, friendly, hostile) {
  if (isSelected) {
    return {
      marker: CIC_CONFIG.colors.selected,
      body: 'rgba(14, 34, 48, 0.96)',
      accent: 'rgba(56, 189, 248, 0.72)',
      glow: 'rgba(56, 189, 248, 0.52)'
    };
  }
  if (friendly) {
    return {
      marker: CIC_CONFIG.colors.friendly,
      body: 'rgba(10, 30, 18, 0.96)',
      accent: 'rgba(74, 222, 128, 0.64)',
      glow: 'rgba(74, 222, 128, 0.36)'
    };
  }
  if (hostile) {
    return {
      marker: CIC_CONFIG.colors.hostile,
      body: 'rgba(38, 12, 16, 0.96)',
      accent: 'rgba(239, 68, 68, 0.68)',
      glow: 'rgba(239, 68, 68, 0.36)'
    };
  }
  return {
    marker: CIC_CONFIG.colors.unknown,
    body: 'rgba(36, 30, 12, 0.96)',
    accent: 'rgba(251, 191, 36, 0.68)',
    glow: 'rgba(251, 191, 36, 0.34)'
  };
}

function finiteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampUnit(value) {
  return Math.max(-1, Math.min(1, value));
}

function normalizeCicRadarAngle(angle) {
  const tau = Math.PI * 2;
  const normalized = finiteNumber(angle, 0) % tau;
  return normalized < 0 ? normalized + tau : normalized;
}

export function didCicRadarSweepCrossAngle(previousAngle, currentAngle, targetAngle) {
  const previous = normalizeCicRadarAngle(previousAngle);
  const current = normalizeCicRadarAngle(currentAngle);
  const target = normalizeCicRadarAngle(targetAngle);
  const travel = normalizeCicRadarAngle(current - previous);
  if (travel <= 1e-7) return false;
  return normalizeCicRadarAngle(target - previous) <= travel + 1e-7;
}

function recountCicRadarContacts(model) {
  const contacts = Array.isArray(model?.contacts) ? model.contacts : [];
  let hostile = 0;
  let friendly = 0;
  let ghost = 0;
  let asteroid = 0;
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    if (contact?.isAsteroid) asteroid++;
    else if (contact?.isGhost) ghost++;
    else if (contact?.friendly) friendly++;
    else if (contact?.hostile) hostile++;
  }
  model.counts = { total: contacts.length, hostile, friendly, ghost, asteroid };
}

export function applyCicHudRadarSweepTracking(model, {
  previousSweepAngle = model?.sweepAngle,
  forceReveal = false,
  trackStore = CIC_HUD_RADAR_TRACKS
} = {}) {
  const contacts = Array.isArray(model?.contacts) ? model.contacts : [];
  const sweepAngle = normalizeCicRadarAngle(model?.sweepAngle);
  const previous = normalizeCicRadarAngle(previousSweepAngle);
  const originX = finiteNumber(model?.originX, 0);
  const originY = finiteNumber(model?.originY, 0);
  const range = Math.max(1, finiteNumber(model?.range, CIC_CONFIG.sweepRange));
  let writeIndex = 0;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const source = contact?.entity || contact?.radarTrackSource;
    if (!contact || (!source || (typeof source !== 'object' && typeof source !== 'function'))) continue;

    let track = trackStore.get(source);
    if (!track) {
      track = { visible: false, x: 0, y: 0, angle: 0, spriteRotation: 0, hitAngle: sweepAngle };
      trackStore.set(source, track);
    }

    const liveDx = finiteNumber(contact.x, originX) - originX;
    const liveDy = finiteNumber(contact.y, originY) - originY;
    const bearing = Math.atan2(liveDy, liveDx);
    const swept = forceReveal || didCicRadarSweepCrossAngle(previous, sweepAngle, bearing);
    if (swept) {
      track.visible = true;
      track.x = finiteNumber(contact.x, originX);
      track.y = finiteNumber(contact.y, originY);
      track.angle = finiteNumber(contact.angle, 0);
      track.spriteRotation = finiteNumber(contact.spriteRotation, 0);
      track.hitAngle = sweepAngle;
    }
    if (!track.visible) continue;

    contact.x = track.x;
    contact.y = track.y;
    contact.dx = track.x - originX;
    contact.dy = track.y - originY;
    contact.distance = Math.hypot(contact.dx, contact.dy);
    if (contact.distance > range) continue;
    contact.nx = clampUnit(contact.dx / range);
    contact.ny = clampUnit(contact.dy / range);
    contact.angle = track.angle;
    contact.spriteRotation = track.spriteRotation;
    const revolutionAge = normalizeCicRadarAngle(sweepAngle - track.hitAngle) / (Math.PI * 2);
    contact.radarEchoStrength = 0.25 + 0.75 * Math.pow(1 - revolutionAge, 2);
    contacts[writeIndex++] = contact;
  }

  contacts.length = writeIndex;
  recountCicRadarContacts(model);
  return model;
}

export function projectCicHudRadarContact(contact, {
  width = 176,
  height = 176,
  range = 20000,
  panWorldX = 0,
  panWorldY = 0
} = {}) {
  const safeRange = Math.max(1, finiteNumber(range, 20000));
  const scale = Math.max(1, Math.min(width, height) * 0.475) / safeRange;
  return {
    x: width * 0.5 + (finiteNumber(contact?.dx, 0) - finiteNumber(panWorldX, 0)) * scale,
    y: height * 0.5 + (finiteNumber(contact?.dy, 0) - finiteNumber(panWorldY, 0)) * scale
  };
}

function drawCicHudRadarWorldFeatures(
  ctx,
  width,
  height,
  model,
  range,
  worldScale,
  uiScale,
  panWorldX,
  panWorldY
) {
  const features = Array.isArray(model?.worldFeatures) ? model.worldFeatures : [];
  if (features.length === 0) return;

  const originX = finiteNumber(model?.originX, 0);
  const originY = finiteNumber(model?.originY, 0);

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    if (!feature) continue;
    const entity = feature.entity || feature;
    const dx = finiteNumber(entity?.x, finiteNumber(feature.x, originX)) - originX - panWorldX;
    const dy = finiteNumber(entity?.y, finiteNumber(feature.y, originY)) - originY - panWorldY;
    const planetRadius = Math.max(0, finiteNumber(feature.radius, 0));
    const ring = feature.ring || null;
    const ringOuterRadius = Math.max(0, finiteNumber(ring?.outerRadius, 0));
    const outerWorldRadius = Math.max(planetRadius, ringOuterRadius);
    if (Math.hypot(dx, dy) > range + outerWorldRadius) continue;

    const x = width * 0.5 + dx * worldScale;
    const y = height * 0.5 + dy * worldScale;
    const id = String(feature.id || entity?.id || entity?.name || '').toLowerCase();
    const color = feature.color || PLANET_COLORS[id] || (id === 'sun' ? '#ffb347' : '#8db8d8');

    if (ringOuterRadius > 0) {
      const innerRadius = Math.max(0, finiteNumber(ring?.innerRadius, 0)) * worldScale;
      const outerRadius = ringOuterRadius * worldScale;
      if (outerRadius >= 0.45 * uiScale) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.1;
        ctx.beginPath();
        ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
        if (innerRadius > 0) {
          ctx.moveTo(x + innerRadius, y);
          ctx.arc(x, y, innerRadius, 0, Math.PI * 2, true);
        }
        ctx.fill('evenodd');
        ctx.globalAlpha = 0.74;
        ctx.lineWidth = Math.max(0.65, 0.8 * uiScale);
        ctx.setLineDash([2 * uiScale, 2 * uiScale]);
        ctx.beginPath();
        ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        if (innerRadius > 0) {
          ctx.beginPath();
          ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        const boundaries = ring.boundaries;
        if (Array.isArray(boundaries)) {
          ctx.globalAlpha = 0.32;
          ctx.lineWidth = Math.max(0.45, 0.5 * uiScale);
          for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex++) {
            const boundaryRadius = Math.max(0, finiteNumber(boundaries[boundaryIndex], 0)) * worldScale;
            if (boundaryRadius <= innerRadius || boundaryRadius >= outerRadius) continue;
            ctx.beginPath();
            ctx.arc(x, y, boundaryRadius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    const screenRadius = planetRadius * worldScale;
    if (screenRadius < 0.35 * uiScale) continue;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = id === 'sun' ? 0.22 : 0.13;
    ctx.beginPath();
    ctx.arc(x, y, screenRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.86;
    ctx.lineWidth = Math.max(0.8, uiScale);
    ctx.beginPath();
    ctx.arc(x, y, screenRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawCicHudRadarShipFootprint(ctx, contact, x, y, worldScale, color, alpha = 0.86) {
  const worldW = Math.max(0, finiteNumber(contact?.hullWorldW, 0));
  const worldH = Math.max(0, finiteNumber(contact?.hullWorldH, 0));
  const drawW = worldW * worldScale;
  const drawH = worldH * worldScale;
  const extent = Math.max(drawW, drawH);
  if (extent < 1.2) return 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(finiteNumber(contact?.angle, 0) + finiteNumber(contact?.spriteRotation, 0));
  ctx.globalAlpha = alpha;
  const source = getEntitySpriteSource(contact?.entity);
  const silhouette = source
    ? getCicTintedSilhouette(source, Math.max(2, drawW), Math.max(2, drawH), color)
    : null;
  if (silhouette) {
    ctx.drawImage(silhouette, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-drawW * 0.5, -drawH * 0.5, drawW, drawH);
  }
  ctx.restore();
  return extent * 0.5;
}

// Radar klastra HUD w języku kopuły (cockpit-ui.css): okrągły i biegunowy zamiast kwadratowej
// siatki świata. Pierścienie zasięgu wokół statku z podpisami na skosie w GÓRNEJ połowie (dolną
// normalnie zakrywa cięciwa kopuły), podziałka namiaru na obrzeżu jak podziałka napędu, kurs
// statku = pomarańczowy znacznik na obrzeżu i linia od statku, przemiatanie = zanikający ślad.
// Kontakty: wróg romb, sojusznik kropka, nieznany kwadrat, duch przerywany romb; namierzony
// i wybrany — narożniki celownika (kolor kontaktu zostaje: strona konfliktu czytelna zawsze).
const HUD_RADAR_STYLE = Object.freeze({
  bgCenter: 'rgba(9, 15, 22, 0.94)',
  bgRim: 'rgba(3, 5, 8, 0.97)',
  ring: 'rgba(255, 255, 255, 0.085)',
  ringEdge: 'rgba(255, 255, 255, 0.15)',
  ringLabel: 'rgba(214, 222, 230, 0.62)',
  spoke: 'rgba(255, 255, 255, 0.045)',
  tick: 'rgba(255, 255, 255, 0.2)',
  tickMajor: 'rgba(255, 255, 255, 0.45)',
  sweepRgb: '150, 210, 255',
  headingRgb: '255, 138, 61',
  friendly: '#3ddc84',
  hostile: '#ff4a4a',
  unknown: '#ffb347',
  selected: '#5cc8ff',
  locked: '#ff6e6e',
  player: '#9fdcff',
  outline: 'rgba(0, 0, 0, 0.65)'
});
const HUD_RADAR_RING_STEPS = Object.freeze([500, 1000, 2000, 2500, 5000, 10000, 15000, 20000, 25000, 50000, 100000]);
const HUD_RADAR_SWEEP_TRAIL = 1.1;
// Podpisy pierścieni na namiarze ~godz. 1–2 (w górę i w prawo od statku).
const HUD_RADAR_LABEL_BEARING = -0.95;

function hudRadarRingStep(range) {
  const want = range / 4.5;
  for (let i = 0; i < HUD_RADAR_RING_STEPS.length; i++) {
    if (HUD_RADAR_RING_STEPS[i] >= want) return HUD_RADAR_RING_STEPS[i];
  }
  return HUD_RADAR_RING_STEPS[HUD_RADAR_RING_STEPS.length - 1];
}

function formatHudRadarDistance(value) {
  const k = value / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

// Narożniki celownika (kwadrat 2r, ramię arm) wokół (0, 0).
function strokeHudRadarBrackets(ctx, r, arm) {
  ctx.beginPath();
  for (let q = 0; q < 4; q++) {
    const sx = q === 0 || q === 3 ? -1 : 1;
    const sy = q < 2 ? -1 : 1;
    ctx.moveTo(sx * r, sy * (r - arm));
    ctx.lineTo(sx * r, sy * r);
    ctx.lineTo(sx * (r - arm), sy * r);
  }
  ctx.stroke();
}

export function drawCicHudRadarSurface(ctx, width, height, model, view = {}) {
  if (!ctx || width <= 0 || height <= 0) return;

  const S = HUD_RADAR_STYLE;
  const TAU = Math.PI * 2;
  const range = Math.max(1, finiteNumber(view.range, finiteNumber(model?.range, 20000)));
  const panWorldX = finiteNumber(view.panWorldX, 0);
  const panWorldY = finiteNumber(view.panWorldY, 0);
  const radius = Math.max(1, Math.min(width, height) * 0.475);
  const worldScale = radius / range;
  const uiScale = Math.max(0.75, Math.min(width, height) / 176);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const rim = Math.min(width, height) * 0.5;
  const shipPoint = projectCicHudRadarContact({ dx: 0, dy: 0 }, {
    width,
    height,
    range,
    panWorldX,
    panWorldY
  });

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rim, 0, TAU);
  ctx.clip();

  const background = ctx.createRadialGradient(cx, cy, 0, cx, cy, rim);
  background.addColorStop(0, S.bgCenter);
  background.addColorStop(1, S.bgRim);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Krzyż przez statek (osie świata) — ledwie widoczny, do orientacji.
  ctx.strokeStyle = S.spoke;
  ctx.lineWidth = Math.max(0.6, 0.6 * uiScale);
  ctx.beginPath();
  ctx.moveTo(shipPoint.x, 0);
  ctx.lineTo(shipPoint.x, height);
  ctx.moveTo(0, shipPoint.y);
  ctx.lineTo(width, shipPoint.y);
  ctx.stroke();

  // Pierścienie zasięgu co „ładny” krok; skraj zasięgu jaśniej, bez podpisu (ma go odczyt nad radarem).
  const ringStep = hudRadarRingStep(range);
  const labelCos = Math.cos(HUD_RADAR_LABEL_BEARING);
  const labelSin = Math.sin(HUD_RADAR_LABEL_BEARING);
  ctx.font = `${7 * uiScale}px Consolas, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let distance = ringStep; distance < range - ringStep * 0.25; distance += ringStep) {
    const ringRadius = distance * worldScale;
    if (ringRadius < 8 * uiScale) continue;
    ctx.strokeStyle = S.ring;
    ctx.lineWidth = Math.max(0.6, 0.7 * uiScale);
    ctx.beginPath();
    ctx.arc(shipPoint.x, shipPoint.y, ringRadius, 0, TAU);
    ctx.stroke();
    const label = formatHudRadarDistance(distance);
    const lx = shipPoint.x + labelCos * ringRadius + 2 * uiScale;
    const ly = shipPoint.y + labelSin * ringRadius;
    ctx.lineWidth = 2.5 * uiScale;
    ctx.strokeStyle = S.bgRim;
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = S.ringLabel;
    ctx.fillText(label, lx, ly);
  }
  ctx.strokeStyle = S.ringEdge;
  ctx.lineWidth = Math.max(0.7, 0.8 * uiScale);
  ctx.beginPath();
  ctx.arc(shipPoint.x, shipPoint.y, range * worldScale, 0, TAU);
  ctx.stroke();

  drawCicHudRadarWorldFeatures(
    ctx,
    width,
    height,
    model,
    range,
    worldScale,
    uiScale,
    panWorldX,
    panWorldY
  );

  // Przemiatanie: ślad gasnący za wiązką (gradient stożkowy) i cienka wiązka.
  const sweepAngle = finiteNumber(model?.sweepAngle, 0);
  const sweepRadius = Math.hypot(width, height);
  ctx.beginPath();
  ctx.moveTo(shipPoint.x, shipPoint.y);
  ctx.arc(shipPoint.x, shipPoint.y, sweepRadius, sweepAngle - HUD_RADAR_SWEEP_TRAIL, sweepAngle, false);
  ctx.closePath();
  if (typeof ctx.createConicGradient === 'function') {
    const trailEnd = HUD_RADAR_SWEEP_TRAIL / TAU;
    const trail = ctx.createConicGradient(sweepAngle - HUD_RADAR_SWEEP_TRAIL, shipPoint.x, shipPoint.y);
    trail.addColorStop(0, `rgba(${S.sweepRgb}, 0)`);
    trail.addColorStop(trailEnd, `rgba(${S.sweepRgb}, 0.2)`);
    trail.addColorStop(Math.min(1, trailEnd + 0.001), `rgba(${S.sweepRgb}, 0)`);
    trail.addColorStop(1, `rgba(${S.sweepRgb}, 0)`);
    ctx.fillStyle = trail;
  } else {
    ctx.fillStyle = `rgba(${S.sweepRgb}, 0.08)`;
  }
  ctx.fill();
  ctx.strokeStyle = `rgba(${S.sweepRgb}, 0.55)`;
  ctx.lineWidth = Math.max(0.7, 0.9 * uiScale);
  ctx.beginPath();
  ctx.moveTo(shipPoint.x, shipPoint.y);
  ctx.lineTo(shipPoint.x + Math.cos(sweepAngle) * sweepRadius, shipPoint.y + Math.sin(sweepAngle) * sweepRadius);
  ctx.stroke();

  // Podziałka namiaru na obrzeżu (co 10°, co 30° dłuższa) — jak podziałka napędu na kopule.
  for (let pass = 0; pass < 2; pass++) {
    const major = pass === 1;
    ctx.strokeStyle = major ? S.tickMajor : S.tick;
    ctx.lineWidth = Math.max(0.7, (major ? 1.1 : 0.8) * uiScale);
    ctx.beginPath();
    for (let deg = 0; deg < 360; deg += 10) {
      if ((deg % 30 === 0) !== major) continue;
      const angle = deg * Math.PI / 180;
      const inner = rim - (major ? 5.5 : 3) * uiScale;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(cx + cos * inner, cy + sin * inner);
      ctx.lineTo(cx + cos * rim, cy + sin * rim);
    }
    ctx.stroke();
  }

  // Kurs statku: przerywana linia od statku i trójkąt na obrzeżu, tam gdzie ją przetnie.
  const heading = finiteNumber(model?.heading, 0);
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  const offX = shipPoint.x - cx;
  const offY = shipPoint.y - cy;
  const rimInner = rim - 1;
  const b = offX * hx + offY * hy;
  const disc = b * b - (offX * offX + offY * offY - rimInner * rimInner);
  if (disc >= 0) {
    const reach = -b + Math.sqrt(disc);
    ctx.strokeStyle = `rgba(${S.headingRgb}, 0.32)`;
    ctx.lineWidth = Math.max(0.7, 0.8 * uiScale);
    ctx.setLineDash([3 * uiScale, 4 * uiScale]);
    ctx.beginPath();
    ctx.moveTo(shipPoint.x + hx * 9 * uiScale, shipPoint.y + hy * 9 * uiScale);
    ctx.lineTo(shipPoint.x + hx * reach, shipPoint.y + hy * reach);
    ctx.stroke();
    ctx.setLineDash([]);
    const tipX = shipPoint.x + hx * (reach - 6.5 * uiScale);
    const tipY = shipPoint.y + hy * (reach - 6.5 * uiScale);
    const baseX = shipPoint.x + hx * reach;
    const baseY = shipPoint.y + hy * reach;
    const wing = 3.2 * uiScale;
    ctx.fillStyle = `rgb(${S.headingRgb})`;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX - hy * wing, baseY + hx * wing);
    ctx.lineTo(baseX + hy * wing, baseY - hx * wing);
    ctx.closePath();
    ctx.fill();
  }

  const contacts = Array.isArray(model?.contacts) ? model.contacts : [];
  for (let i = contacts.length - 1; i >= 0; i--) {
    const contact = contacts[i];
    if (!contact) continue;
    const point = projectCicHudRadarContact(contact, {
      width,
      height,
      range,
      panWorldX,
      panWorldY
    });
    if (point.x < -8 || point.x > width + 8 || point.y < -8 || point.y > height + 8) continue;

    const locked = !!contact.locked;
    const selected = !!contact.selected;
    const ghost = !!contact.isGhost;
    const asteroid = !!contact.isAsteroid;
    const echoStrength = Math.max(0.2, finiteNumber(contact.radarEchoStrength, 1));
    const color = asteroid
      ? (ASTEROID_CIC_COLORS[contact.subType] || '#8aa0b8')
      : contact.friendly
        ? S.friendly
        : contact.hostile
          ? S.hostile
          : S.unknown;
    const size = asteroid
      ? (ASTEROID_CIC_DOT[contact.sizeClass] || 0.9) * uiScale
      : (contact.isCapital ? 3.6 : 2.6) * uiScale;
    const hullExtent = asteroid || ghost
      ? 0
      : drawCicHudRadarShipFootprint(ctx, contact, point.x, point.y, worldScale, color, 0.82 * echoStrength);

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (asteroid) {
      ctx.globalAlpha = 0.72 * echoStrength;
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, TAU);
      ctx.fill();
    } else if (hullExtent > 0) {
      ctx.globalAlpha = 0.8 * echoStrength;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0.8 * uiScale, Math.min(2 * uiScale, hullExtent * 0.22)), 0, TAU);
      ctx.fill();
    } else {
      // Poświata pod znakiem, potem znak z ciemnym obrysem (czytelny na smudze i planecie).
      ctx.globalAlpha = (ghost ? 0.08 : 0.2) * echoStrength;
      ctx.beginPath();
      ctx.arc(0, 0, size * 2.2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = (ghost ? 0.55 : 0.96) * echoStrength;
      ctx.beginPath();
      if (contact.hostile || ghost) {
        ctx.moveTo(0, -size * 1.15);
        ctx.lineTo(size * 1.15, 0);
        ctx.lineTo(0, size * 1.15);
        ctx.lineTo(-size * 1.15, 0);
        ctx.closePath();
      } else if (contact.friendly) {
        ctx.arc(0, 0, size, 0, TAU);
      } else {
        ctx.rect(-size * 0.85, -size * 0.85, size * 1.7, size * 1.7);
      }
      if (ghost) {
        ctx.setLineDash([2 * uiScale, 2 * uiScale]);
        ctx.lineWidth = Math.max(0.8, 0.9 * uiScale);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fill();
        ctx.strokeStyle = S.outline;
        ctx.lineWidth = Math.max(0.6, 0.7 * uiScale);
        ctx.stroke();
      }
    }

    if (locked || selected) {
      const bracket = Math.max(size * 1.15, hullExtent) + 3.2 * uiScale;
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = locked ? S.locked : S.selected;
      ctx.lineWidth = Math.max(0.9, 1.1 * uiScale);
      strokeHudRadarBrackets(ctx, bracket, Math.max(2.4 * uiScale, bracket * 0.42));
    }
    ctx.restore();
  }

  const playerHullExtent = drawCicHudRadarShipFootprint(
    ctx,
    model?.playerHull,
    shipPoint.x,
    shipPoint.y,
    worldScale,
    S.player,
    0.95
  );
  if (playerHullExtent <= 0) {
    ctx.save();
    ctx.translate(shipPoint.x, shipPoint.y);
    ctx.rotate(heading);
    ctx.fillStyle = S.player;
    ctx.strokeStyle = S.outline;
    ctx.lineWidth = Math.max(0.6, 0.7 * uiScale);
    ctx.beginPath();
    ctx.moveTo(5.5 * uiScale, 0);
    ctx.lineTo(-3.5 * uiScale, 3.4 * uiScale);
    ctx.lineTo(-2 * uiScale, 0);
    ctx.lineTo(-3.5 * uiScale, -3.4 * uiScale);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

export function createCicHudRadarModel({
  ship = null,
  npcs = [],
  SensorSystem = null,
  asteroidField = null,
  asteroids = null,
  lockedTargets = [],
  selectedTarget = null,
  worldFeatures = null,
  range = CIC_CONFIG.sweepRange,
  asteroidRange = range,
  maxContacts = 64,
  maxAsteroidContacts = 24,
  sweepAngle = 0
} = {}) {
  const shipPos = ship?.pos || ship || { x: 0, y: 0 };
  const shipX = finiteNumber(shipPos.x, 0);
  const shipY = finiteNumber(shipPos.y, 0);
  const safeRange = Math.max(1, finiteNumber(range, CIC_CONFIG.sweepRange));
  const safeAsteroidRange = Math.min(
    safeRange,
    Math.max(0, finiteNumber(asteroidRange, safeRange))
  );
  const contactLimit = Math.max(0, Math.floor(finiteNumber(maxContacts, 64)));
  const asteroidLimit = Math.max(0, Math.floor(finiteNumber(maxAsteroidContacts, 24)));
  const awareness = SensorSystem?.AWARENESS || CIC_CONFIG.AWARENESS || { HIDDEN: 0, GHOST: 1, DETECTED: 2, TRACKED: 3 };
  const detected = Number.isFinite(Number(awareness.DETECTED)) ? Number(awareness.DETECTED) : 2;
  const locks = new Set(Array.isArray(lockedTargets) ? lockedTargets : []);
  const contacts = [];

  function pushContact(contact) {
    const x = finiteNumber(contact.x, shipX);
    const y = finiteNumber(contact.y, shipY);
    const dx = x - shipX;
    const dy = y - shipY;
    const distance = Math.hypot(dx, dy);
    if (distance > safeRange) return;
    contacts.push({
      ...contact,
      x,
      y,
      dx,
      dy,
      distance,
      nx: clampUnit(dx / safeRange),
      ny: clampUnit(dy / safeRange),
      screenX: 0,
      screenY: 0,
      hitRadius: 16
    });
  }

  const list = Array.isArray(npcs) ? npcs : [];
  for (let i = 0; i < list.length; i++) {
    const npc = list[i];
    if (!npc || npc.dead) continue;
    const vis = SensorSystem?.getVisibility ? SensorSystem.getVisibility(npc) : { awareness: npc._sensorAwareness || 0 };
    const contactAwareness = finiteNumber(vis?.awareness, 0);
    const isLocked = locks.has(npc);
    const isSelected = selectedTarget === npc;
    // Mgła wojny (SensorSystem.hides): namiar ani zaznaczenie nie pokazują tego, czego strona gracza nie widzi.
    if (SensorSystem?.hides?.(npc)) continue;
    if (contactAwareness < detected && !isLocked && !isSelected) continue;

    pushContact({
      entity: npc,
      type: npc.type || 'unknown',
      subType: npc.subType || '',
      friendly: !!npc.friendly,
      hostile: !npc.friendly,
      isCapital: !!npc.isCapitalShip,
      radius: npc.radius || npc.r || 14,
      hp: npc.hp,
      maxHp: npc.maxHp,
      shield: npc.shield,
      awareness: contactAwareness,
      locked: isLocked,
      selected: isSelected,
      isGhost: false,
      x: npc.x,
      y: npc.y
    });
  }

  let asteroidList = Array.isArray(asteroids) ? asteroids : null;
  if (!asteroidList && asteroidLimit > 0 && safeAsteroidRange > 0 && asteroidField?.queryRadius) {
    asteroidList = asteroidField.queryRadius(shipX, shipY, safeAsteroidRange) || [];
  }
  if (Array.isArray(asteroidList) && asteroidLimit > 0) {
    const nearbyAsteroids = [];
    for (let i = 0; i < asteroidList.length; i++) {
      const asteroid = asteroidList[i];
      if (!asteroid || asteroid.alive === false || asteroid.dead) continue;
      const x = finiteNumber(asteroid.worldX ?? asteroid.x, shipX);
      const y = finiteNumber(asteroid.worldY ?? asteroid.y, shipY);
      const distance = Math.hypot(x - shipX, y - shipY);
      if (distance > safeAsteroidRange) continue;
      nearbyAsteroids.push({ asteroid, x, y, distance });
    }
    nearbyAsteroids.sort((a, b) => a.distance - b.distance);

    const limit = Math.min(asteroidLimit, nearbyAsteroids.length);
    for (let i = 0; i < limit; i++) {
      const entry = nearbyAsteroids[i];
      const asteroid = entry.asteroid;
      pushContact({
        entity: asteroid,
        type: 'asteroid',
        subType: asteroid.type || '',
        sizeClass: asteroid.size || '',
        friendly: false,
        hostile: false,
        isCapital: false,
        isAsteroid: true,
        radius: asteroid.scale || asteroid.radius || asteroid.r || 14,
        hp: asteroid.hp,
        maxHp: asteroid.hpMax,
        awareness: detected,
        locked: locks.has(asteroid),
        selected: selectedTarget === asteroid,
        isGhost: false,
        x: entry.x,
        y: entry.y
      });
    }
  }

  const ghosts = SensorSystem?.getGhosts ? SensorSystem.getGhosts() : null;
  if (ghosts?.forEach) {
    ghosts.forEach((ghost) => {
      if (!ghost) return;
      pushContact({
        entity: null,
        radarTrackSource: ghost,
        type: ghost.type || 'unknown',
        subType: ghost.subType || '',
        friendly: false,
        hostile: true,
        isCapital: !!ghost.isCapital,
        radius: ghost.radius || 14,
        awareness: awareness.GHOST || 1,
        locked: false,
        selected: false,
        isGhost: true,
        x: ghost.x,
        y: ghost.y
      });
    });
  }

  contacts.sort((a, b) => {
    const ap = (a.locked || a.selected) ? 0 : (a.isAsteroid ? 2 : (a.isGhost ? 3 : 1));
    const bp = (b.locked || b.selected) ? 0 : (b.isAsteroid ? 2 : (b.isGhost ? 3 : 1));
    if (ap !== bp) return ap - bp;
    return a.distance - b.distance;
  });

  if (contacts.length > contactLimit) contacts.length = contactLimit;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    if (!contact?.entity || contact.isAsteroid || contact.isGhost) continue;
    const metrics = getEntityHullMetrics(contact.entity, 1);
    contact.hullWorldW = metrics.worldW;
    contact.hullWorldH = metrics.worldH;
    contact.angle = finiteNumber(contact.entity.angle ?? contact.entity.a, 0);
    contact.spriteRotation = getEntitySpriteRotation(contact.entity);
  }

  const playerMetrics = ship ? getEntityHullMetrics(ship, 1) : null;
  const playerHull = ship && playerMetrics ? {
    entity: ship,
    hullWorldW: playerMetrics.worldW,
    hullWorldH: playerMetrics.worldH,
    angle: finiteNumber(ship.angle ?? ship.a, 0),
    spriteRotation: getEntitySpriteRotation(ship)
  } : null;

  let hostile = 0;
  let friendly = 0;
  let ghost = 0;
  let asteroid = 0;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    if (c.isAsteroid) asteroid++;
    else if (c.isGhost) ghost++;
    else if (c.friendly) friendly++;
    else if (c.hostile) hostile++;
  }

  return {
    range: safeRange,
    sweepAngle: finiteNumber(sweepAngle, 0),
    originX: shipX,
    originY: shipY,
    heading: finiteNumber(ship?.angle ?? ship?.a, 0),
    playerHull,
    worldFeatures: Array.isArray(worldFeatures) ? worldFeatures : EMPTY_CIC_WORLD_FEATURES,
    contacts,
    counts: {
      total: contacts.length,
      hostile,
      friendly,
      ghost,
      asteroid
    }
  };
}

// Hologram podglądu szyku / celu ruchu (z `outline: true`): blade wypełnienie i obrys w kolorach
// nakładek dowodzenia (src/ui/commandOverlay.js — ruch gracza jaśniejszy, skrzydło cyjan).
export function getCicPlacementGhostPalette({ player = false } = {}) {
  return player
    ? {
      marker: '#9fdcff',
      body: 'rgba(159, 220, 255, 0.13)',
      accent: 'rgba(159, 220, 255, 0.95)',
      glow: 'rgba(159, 220, 255, 0.5)'
    }
    : {
      marker: '#5cc8ff',
      body: 'rgba(92, 200, 255, 0.11)',
      accent: 'rgba(92, 200, 255, 0.9)',
      glow: 'rgba(92, 200, 255, 0.45)'
    };
}

function canDrawContactSilhouette(entity, contact, metrics, isSystemScale) {
  if (!entity || isSystemScale || contact?.isGhost) return false;
  if (entity.fighter || CIC_FIGHTER_TYPES.has(String(entity?.type || '').toLowerCase())) return false;
  const trackedAwareness = window.SensorSystem?.AWARENESS?.TRACKED || 3;
  if (Number.isFinite(Number(contact?.awareness)) && Number(contact.awareness) < trackedAwareness) return false;
  if (!getEntitySpriteSource(entity)) return false;
  return Math.max(metrics.drawW, metrics.drawH) >= CIC_CONFIG.silhouetteMinPx;
}

function drawShipSilhouette(ctx, entity, screenX, screenY, metrics, palette, accentAlpha = 0.22, options = {}) {
  const source = getEntitySpriteSource(entity);
  if (!source) return false;

  const drawW = Math.max(8, Number(metrics?.drawW) || 0);
  const drawH = Math.max(8, Number(metrics?.drawH) || 0);
  if (!(drawW > 0 && drawH > 0)) return false;

  const bodyCanvas = getCicTintedSilhouette(source, drawW, drawH, palette.body);
  if (!bodyCanvas) return false;
  const accentCanvas = getCicTintedSilhouette(source, drawW, drawH, palette.accent);

  ctx.save();
  ctx.translate(screenX, screenY);
  const angle = Number.isFinite(Number(options?.angle))
    ? Number(options.angle)
    : readSignedNumber(entity?.angle, 0);
  ctx.rotate(angle + getEntitySpriteRotation(entity));
  ctx.globalAlpha = readPositiveNumber(options?.alpha, 0.98);
  ctx.drawImage(bodyCanvas, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
  if (options?.outline) {
    // Hologram: blade wypełnienie (body) i ostry obrys konturu w kolorze akcentu.
    const outline = getCicOutlineSilhouette(source, drawW, drawH, palette.accent);
    if (outline) {
      const sx = drawW / (outline.width - CIC_OUTLINE_PAD * 2);
      const sy = drawH / (outline.height - CIC_OUTLINE_PAD * 2);
      ctx.globalAlpha = accentAlpha;
      ctx.drawImage(outline, -drawW * 0.5 - CIC_OUTLINE_PAD * sx, -drawH * 0.5 - CIC_OUTLINE_PAD * sy, outline.width * sx, outline.height * sy);
    }
  } else if (accentCanvas) {
    ctx.globalAlpha = accentAlpha;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = Math.max(4, Math.min(18, Math.max(drawW, drawH) * 0.08));
    ctx.drawImage(accentCanvas, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
  }
  ctx.restore();
  return true;
}

export function drawCicShipSilhouette(ctx, entity, screenX, screenY, metrics, palette, options = {}) {
  return drawShipSilhouette(
    ctx,
    entity,
    screenX,
    screenY,
    metrics,
    palette,
    readPositiveNumber(options?.accentAlpha, 0.22),
    options
  );
}

let cicActive = false;
let cicZoom = CIC_CONFIG.zoomDefault;
let cicTargetZoom = CIC_CONFIG.zoomDefault;  // smooth zoom target
let cicPanX = 0, cicPanY = 0; // offset from ship
let cicTargetPanX = 0, cicTargetPanY = 0; // smooth pan targets
let cicSweepAngle = 0;
let cicSelectedTarget = null;       // backward-compat alias → cicSelectedContacts[0]
let cicSelectedContacts = [];       // multi-select (contact objects, not entities)
let cicDragging = false;
let cicDragButton = -1;             // which button is dragging
let cicDragMoved = false;
let cicDragStart = { x: 0, y: 0 };
let cicMouseWorld = { x: 0, y: 0 };

// Box-select state (LMB rubber-band)
let cicBoxSelecting = false;
let cicBoxStart = { x: 0, y: 0 };  // screen coords
let cicBoxEnd   = { x: 0, y: 0 };  // screen coords

// System view blend: 0 = tactical, 1 = full system (derived from zoom level)
const SYSTEM_ZOOM_START = 0.006;  // start blending toward system view
const SYSTEM_ZOOM_FULL  = 0.0008; // fully in system view
let cicSystemBlend = 0;           // current blend factor (smoothed)

// Context menu state (right-click)
// items: array of { label, action: 'attack'|'move'|'travel'|'drone'|'recallDrones'|null (disabled) }
let cicContextMenu = {
  open: false,
  screenX: 0, screenY: 0,
  worldX: 0, worldY: 0,
  targetEntity: null,   // non-null when opened on enemy contact
  items: [],
};

// WSAD pan keys currently held
const cicKeys = new Set();

// Contact list refreshed each frame
let cicContacts = [];

export const CICDisplay = {
  get active() { return cicActive; },

  toggle() {
    cicActive = !cicActive;
    if (cicActive) {
      cicPanX = 0; cicPanY = 0;
      cicTargetPanX = 0; cicTargetPanY = 0;
      cicZoom = CIC_CONFIG.zoomDefault;
      cicTargetZoom = CIC_CONFIG.zoomDefault;
      cicSelectedTarget = null;
      cicSelectedContacts = [];
      cicBoxSelecting = false;
      cicSystemBlend = 0;
    } else {
      cicKeys.clear();
    }
    return cicActive;
  },

  close() {
    cicActive = false;
    cicSystemBlend = 0;
    cicBoxSelecting = false;
    cicSelectedContacts = [];
    cicContextMenu.open = false;
    cicKeys.clear();
  },
  open() {
    cicActive = true;
    cicPanX = 0; cicPanY = 0;
    cicTargetPanX = 0; cicTargetPanY = 0;
    cicZoom = CIC_CONFIG.zoomDefault;
    cicTargetZoom = CIC_CONFIG.zoomDefault;
    cicSelectedContacts = [];
    cicSystemBlend = 0;
  },

  getSelectedTarget()  { return cicSelectedContacts[0]?.entity || cicSelectedTarget || null; },
  getSelectedTargets() { return cicSelectedContacts.map(c => c.entity).filter(Boolean); },
  getHudRadarSnapshot(options = {}) {
    const model = createCicHudRadarModel({
      ...options,
      sweepAngle: cicSweepAngle
    });
    const previousSweepAngle = cicHudRadarPreviousSweepAngle ?? cicSweepAngle;
    cicHudRadarPreviousSweepAngle = cicSweepAngle;
    const forceReveal = cicHudRadarBurstPending;
    cicHudRadarBurstPending = false;
    return applyCicHudRadarSweepTracking(model, { previousSweepAngle, forceReveal });
  },
  triggerHudRadarBurst() {
    cicHudRadarBurstPending = true;
  },

  /** Jump to system view (V key) — sets target zoom to system level */
  toggleSystemView() {
    if (!cicActive) return;
    if (cicSystemBlend > 0.5) {
      // Already in system view → animate back to tactical
      cicTargetZoom = CIC_CONFIG.zoomDefault;
      cicTargetPanX = 0;
      cicTargetPanY = 0;
    } else {
      // Jump to system view: compute zoom to fit outermost orbit
      const planets = window.planets;
      const SUN = window.SUN;
      const ship = window.ship;
      let maxOrbit = 100000;
      if (planets) {
        for (const pl of planets) {
          if (pl && pl.orbitRadius > maxOrbit) maxOrbit = pl.orbitRadius;
        }
      }
      const fitZoom = Math.min(window.innerWidth, window.innerHeight) * 0.42 / (maxOrbit * 1.2);
      cicTargetZoom = fitZoom;
      // Center on sun but offset so player stays in view (no hard re-center)
      if (SUN && ship) {
        const sunOffX = SUN.x - ship.pos.x;
        const sunOffY = SUN.y - ship.pos.y;
        cicTargetPanX = sunOffX * 0.5;
        cicTargetPanY = sunOffY * 0.5;
      }
    }
  },

  get isSystemView() { return cicSystemBlend > 0.3; },

  /** WSAD key pressed — returns true if consumed */
  onKeyDown(code) {
    if (!cicActive) return false;
    if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD') {
      cicKeys.add(code);
      return true;
    }
    return false;
  },

  /** WSAD key released */
  onKeyUp(code) {
    cicKeys.delete(code);
  },

  /** Handle mouse wheel in CIC — proportional zoom, continuous range */
  onWheel(deltaY) {
    if (!cicActive) return;
    const factor = 1 - deltaY * 0.0015;
    cicTargetZoom = Math.max(CIC_CONFIG.zoomMin, Math.min(CIC_CONFIG.zoomMax, cicTargetZoom * factor));
  },

  /** Handle mouse down in CIC */
  onMouseDown(x, y, button) {
    if (!cicActive) return false;

    // Any click closes the context menu first
    if (cicContextMenu.open && button !== 2) {
      const ITEM_H = 26, MENU_W = 160;
      const mx = cicContextMenu.screenX, my = cicContextMenu.screenY;
      const menuH = cicContextMenu.items.length * ITEM_H;
      if (x >= mx && x <= mx + MENU_W && y >= my && y <= my + menuH) {
        const idx = Math.floor((y - my) / ITEM_H);
        const item = cicContextMenu.items[idx];
        if (item && item.action) {
          const { worldX, worldY, targetEntity } = cicContextMenu;
          if (item.action === 'attack' && window.cicAttackOrder) {
            if (targetEntity) {
              window.cicAttackOrder(targetEntity);
            } else if (cicSelectedContacts.length > 0 && window.cicGroupAttackOrder) {
              window.cicGroupAttackOrder(cicSelectedContacts.map(c => c.entity).filter(Boolean));
            }
          } else if (item.action === 'move') {
            // Kształt createMoveCommand (worldCommandMenu.js): autopilot i linia rozkazu czytają `target`
            // — dawne { type: 'moveTo', x, y } nie ruszało statku i nie miało linii.
            if (window.ship) window.ship.command = { type: 'move', target: { x: worldX, y: worldY }, arrival: 90 };
          } else if (item.action === 'travel') {
            // TRAVEL TO (index.html: setTravelTarget) — napęd dobiera podróż (dziś warp odcinkami).
            if (window.setTravelTarget) window.setTravelTarget(worldX, worldY);
          } else if (item.action === 'drone') {
            const droneSystem = window.SpotterDroneSystem;
            const ship = window.ship;
            if (droneSystem && ship?.pos) {
              droneSystem.deploy(ship.pos.x, ship.pos.y, worldX, worldY);
            }
          } else if (item.action === 'recallDrones') {
            const droneSystem = window.SpotterDroneSystem;
            const ship = window.ship;
            if (droneSystem && ship?.pos) {
              droneSystem.recallAll(ship.pos.x, ship.pos.y);
            }
          }
        }
        cicContextMenu.open = false;
        return true;
      }
      cicContextMenu.open = false;
      return true;
    }

    // Right-click: context menu
    if (button === 2) {
      const W = window.innerWidth, H = window.innerHeight;
      const cx = W / 2, cy = H / 2;
      const shipX = (window.ship?.pos?.x || 0) + cicPanX;
      const shipY = (window.ship?.pos?.y || 0) + cicPanY;
      const worldX = shipX + (x - cx) / cicZoom;
      const worldY = shipY + (y - cy) / cicZoom;

      // Check if click is near a hostile contact
      let hitContact = null;
      for (const c of cicContacts) {
        if (c.isGhost || !c.entity || c.friendly) continue;
        const ddx = c.screenX - x, ddy = c.screenY - y;
        const hitRadius = Math.max(12, Number(c.hitRadius) || 20);
        if (ddx * ddx + ddy * ddy < hitRadius * hitRadius) { hitContact = c; break; }
      }

      cicContextMenu.worldX = worldX;
      cicContextMenu.worldY = worldY;
      cicContextMenu.screenX = x;
      cicContextMenu.screenY = y;
      cicContextMenu.targetEntity = hitContact?.entity || null;

      if (hitContact) {
        // Clicked directly on enemy → immediate attack, no menu
        cicContextMenu.open = false;
        if (window.cicAttackOrder) window.cicAttackOrder(hitContact.entity);
      } else {
        // Empty space → show context menu
        const hasSelected = cicSelectedContacts.length > 0;
        const droneSystem = window.SpotterDroneSystem;
        const hasDroneSystem = !!droneSystem;
        const hasActiveDrones = !!droneSystem?.getDrones?.().some(d => d && !d.dead);
        cicContextMenu.items = [
          { label: 'ATAK', action: hasSelected ? 'attack' : null },
          { label: 'RUCH', action: 'move' },
          { label: 'TRAVEL TO', action: 'travel' },
          { label: 'SEND DRONE', action: hasDroneSystem ? 'drone' : null },
          { label: 'RECALL DRONES', action: hasActiveDrones ? 'recallDrones' : null },
        ];
        cicContextMenu.open = true;
      }
      return true;
    }

    // Middle mouse: always pan
    if (button === 1) {
      cicDragging = true;
      cicDragButton = 1;
      cicDragMoved = false;
      cicDragStart = { x, y };
      return true;
    }

    // LMB: start box-select
    if (button === 0) {
      cicDragging = true;
      cicDragButton = 0;
      cicDragMoved = false;
      cicDragStart = { x, y };
      cicBoxStart = { x, y };
      cicBoxEnd = { x, y };
      cicBoxSelecting = false;
      return true;
    }
    return false;
  },

  /** Handle mouse move in CIC */
  onMouseMove(x, y, dx, dy) {
    if (!cicActive) return;
    if (cicDragging) {
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) cicDragMoved = true;

      if (cicDragButton === 1) {
        // MMB — pan
        const ddx = dx / cicZoom;
        const ddy = dy / cicZoom;
        cicPanX -= ddx;
        cicPanY -= ddy;
        cicTargetPanX = cicPanX;
        cicTargetPanY = cicPanY;
      } else if (cicDragButton === 0 && cicDragMoved) {
        // LMB drag — box-select
        cicBoxSelecting = true;
        cicBoxEnd = { x, y };
      }
    }
    // Update mouse world position
    const W = window.innerWidth, H = window.innerHeight;
    const cx = W / 2, cy = H / 2;
    const shipX = (window.ship?.pos?.x || 0) + cicPanX;
    const shipY = (window.ship?.pos?.y || 0) + cicPanY;
    cicMouseWorld.x = shipX + (x - cx) / cicZoom;
    cicMouseWorld.y = shipY + (y - cy) / cicZoom;
  },

  /** Handle mouse up in CIC */
  onMouseUp(x, y, button) {
    if (button === 0) {
      if (cicBoxSelecting) {
        // Finalize box-select: collect all contacts inside the rectangle
        const x0 = Math.min(cicBoxStart.x, cicBoxEnd.x);
        const x1 = Math.max(cicBoxStart.x, cicBoxEnd.x);
        const y0 = Math.min(cicBoxStart.y, cicBoxEnd.y);
        const y1 = Math.max(cicBoxStart.y, cicBoxEnd.y);
        cicSelectedContacts = cicContacts.filter(c =>
          !c.isGhost && c.entity &&
          c.screenX >= x0 && c.screenX <= x1 &&
          c.screenY >= y0 && c.screenY <= y1
        );
        cicSelectedTarget = cicSelectedContacts[0]?.entity || null;
      } else if (!cicDragMoved) {
        // Short click → point-select nearest contact within 15px
        cicSelectedContacts = [];
        const px = x || cicDragStart.x;
        const py = y || cicDragStart.y;
        for (const c of cicContacts) {
          if (c.isGhost) continue;
          const ddx = c.screenX - px, ddy = c.screenY - py;
          const hitRadius = Math.max(10, Number(c.hitRadius) || 15);
          if (ddx * ddx + ddy * ddy < hitRadius * hitRadius) {
            cicSelectedContacts = [c];
            break;
          }
        }
        cicSelectedTarget = cicSelectedContacts[0]?.entity || null;
      }
      cicBoxSelecting = false;
    }
    cicDragging = false;
    cicDragMoved = false;
    cicDragButton = -1;
  },

  /**
   * Update CIC state.
   */
  update(dt, ship, npcs, stations, SensorSystem) {
    cicSweepAngle = (cicSweepAngle + CIC_CONFIG.sweepSpeed * dt) % (Math.PI * 2);

    if (!cicActive) {
      return;
    }

    cicContacts.length = 0;
    if (ship && npcs) {
      const model = createCicHudRadarModel({
        ship,
        npcs,
        SensorSystem,
        range: CIC_CONFIG.sweepRange,
        maxContacts: 2048,
        sweepAngle: cicSweepAngle
      });
      cicContacts.push(...model.contacts);
    }

    // WSAD camera pan — speed scales with visible area so it feels consistent at any zoom
    if (cicKeys.size > 0) {
      const panSpeed = 500 / cicZoom;
      if (cicKeys.has('KeyA')) cicTargetPanX -= panSpeed * dt;
      if (cicKeys.has('KeyD')) cicTargetPanX += panSpeed * dt;
      if (cicKeys.has('KeyW')) cicTargetPanY -= panSpeed * dt;
      if (cicKeys.has('KeyS')) cicTargetPanY += panSpeed * dt;
    }

  },

  /**
   * Draw the full CIC overlay.
   */
  draw(ctx, W, H, ship, SensorSystem, weapons, gameTime) {
    if (!cicActive || !ship) return;

    const cx = W / 2;
    const cy = H / 2;

    // ── Smooth zoom interpolation (logarithmic lerp for natural feel) ──
    const zoomRatio = cicTargetZoom / cicZoom;
    if (Math.abs(zoomRatio - 1) > 0.001) {
      cicZoom *= Math.pow(zoomRatio, 0.12); // smooth log-lerp
    } else {
      cicZoom = cicTargetZoom;
    }

    // ── System blend factor (0 = tactical, 1 = full system) ──
    const rawBlend = Math.max(0, Math.min(1,
      (SYSTEM_ZOOM_START - cicZoom) / (SYSTEM_ZOOM_START - SYSTEM_ZOOM_FULL)
    ));
    cicSystemBlend += (rawBlend - cicSystemBlend) * 0.1; // smooth blend

    // ── Smooth pan interpolation (no auto-centering — user controls pan freely) ──
    cicPanX += (cicTargetPanX - cicPanX) * 0.14;
    cicPanY += (cicTargetPanY - cicPanY) * 0.14;

    const isSystemScale = cicSystemBlend > 0.3;

    const shipX = ship.pos.x + cicPanX;
    const shipY = ship.pos.y + cicPanY;

    const toScreen = (wx, wy) => ({
      x: cx + (wx - shipX) * cicZoom,
      y: cy + (wy - shipY) * cicZoom,
    });

    ctx.save();
    ctx.resetTransform();

    // === BACKGROUND ===
    ctx.fillStyle = CIC_CONFIG.colors.bg;
    ctx.fillRect(0, 0, W, H);

    // === GRID (adaptive spacing based on zoom) ===
    let gridSpacing = CIC_CONFIG.gridSpacing;
    // At very far zoom, increase grid spacing so lines don't become invisible
    while (gridSpacing * cicZoom < 30) gridSpacing *= 5;
    const gridScreenSpacing = gridSpacing * cicZoom;

    if (gridScreenSpacing > 15) {
      ctx.strokeStyle = CIC_CONFIG.colors.grid;
      ctx.lineWidth = 0.5;

      const startWX = Math.floor((shipX - cx / cicZoom) / gridSpacing) * gridSpacing;
      const endWX = shipX + cx / cicZoom;
      const startWY = Math.floor((shipY - cy / cicZoom) / gridSpacing) * gridSpacing;
      const endWY = shipY + cy / cicZoom;

      const majorMul = gridSpacing * 5;
      for (let wx = startWX; wx <= endWX; wx += gridSpacing) {
        const sx = toScreen(wx, 0).x;
        const isMajor = Math.abs(wx % majorMul) < gridSpacing * 0.1;
        ctx.strokeStyle = isMajor ? CIC_CONFIG.colors.gridMajor : CIC_CONFIG.colors.grid;
        ctx.lineWidth = isMajor ? 1 : 0.5;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
      }
      for (let wy = startWY; wy <= endWY; wy += gridSpacing) {
        const sy = toScreen(0, wy).y;
        const isMajor = Math.abs(wy % majorMul) < gridSpacing * 0.1;
        ctx.strokeStyle = isMajor ? CIC_CONFIG.colors.gridMajor : CIC_CONFIG.colors.grid;
        ctx.lineWidth = isMajor ? 1 : 0.5;
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      }
    }

    // === SOLAR SYSTEM: Sun, Planets, Orbits, Rings ===
    drawSolarSystem(ctx, W, H, toScreen, cicZoom, gameTime);

    // === RANGE RINGS (from ship center) ===
    const shipScr = toScreen(ship.pos.x, ship.pos.y);
    ctx.strokeStyle = CIC_CONFIG.colors.rangeRing;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    const ringDistances = [5000, 10000, 20000, 50000, 100000];
    for (const rd of ringDistances) {
      const sr = rd * cicZoom;
      if (sr < 20 || sr > W * 2) continue;
      ctx.beginPath();
      ctx.arc(shipScr.x, shipScr.y, sr, 0, Math.PI * 2);
      ctx.stroke();
      // Label
      ctx.fillStyle = CIC_CONFIG.colors.text;
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${(rd / 1000).toFixed(0)}k`, shipScr.x + sr + 4, shipScr.y - 3);
    }
    ctx.setLineDash([]);

    // === SENSOR RANGES ===
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    for (const src of SensorSystem.getSensorSources()) {
      const sp = toScreen(src.x, src.y);
      const sr = src.range * cicZoom;
      switch (src.type) {
        case 'ship': ctx.strokeStyle = 'rgba(74,158,255,0.3)'; break;
        case 'probe': ctx.strokeStyle = 'rgba(20,184,166,0.3)'; break;
        case 'drone': ctx.strokeStyle = 'rgba(56,189,248,0.3)'; break;
        case 'infrastructure': ctx.strokeStyle = 'rgba(245,158,11,0.3)'; break;
      }
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // === RADAR SWEEP ===
    const sweepR = CIC_CONFIG.sweepRange * cicZoom;
    if (sweepR > 10) {
      // Sweep cone (trailing fade) — arc-based for compatibility
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = CIC_CONFIG.colors.sweep;
      ctx.beginPath();
      ctx.moveTo(shipScr.x, shipScr.y);
      ctx.arc(shipScr.x, shipScr.y, sweepR, cicSweepAngle - 0.5, cicSweepAngle, false);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Sweep line
      ctx.strokeStyle = CIC_CONFIG.colors.sweepLine;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(shipScr.x, shipScr.y);
      ctx.lineTo(
        shipScr.x + Math.cos(cicSweepAngle) * sweepR,
        shipScr.y + Math.sin(cicSweepAngle) * sweepR
      );
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // === POLA WRAKÓW (zimne wraki: src/game/wreckFields.js) ===
    drawWreckFieldMarkers(ctx, window.coldWreckFields, {
      toScreen,
      zoom: cicZoom,
      W,
      H,
      shipX: ship.pos.x,
      shipY: ship.pos.y,
      isSystemScale,
      formatDistance: formatLocalDistance
    });

    // === DRONES ON CIC ===
    if (window.SpotterDroneSystem) {
      for (const d of window.SpotterDroneSystem.getDrones()) {
        if (d.dead) continue;
        const dp = toScreen(d.x, d.y);
        const isActivePip = d === window.SpotterDroneSystem.getActivePip();
        ctx.save();
        ctx.translate(dp.x, dp.y);
        ctx.rotate(d.angle);
        const ds = Math.max(5, 6);
        ctx.fillStyle = isActivePip ? '#38bdf8' : '#64748b';
        ctx.strokeStyle = isActivePip ? '#7dd3fc' : '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ds * 1.5, 0);
        ctx.lineTo(-ds, ds * 0.8);
        ctx.lineTo(-ds * 0.5, 0);
        ctx.lineTo(-ds, -ds * 0.8);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
        // Label
        ctx.font = '7px monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'center';
        ctx.fillText('DRONE', dp.x, dp.y + 10);
      }
    }

    // === PLAYER SHIP ICON ===
    if (isSystemScale) {
      ctx.save();
      ctx.translate(shipScr.x, shipScr.y);
      // In system view: pulsing beacon dot
      const pulse = 0.6 + 0.4 * Math.sin(gameTime * 3);
      const beaconR = 4 + cicSystemBlend * 3;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = beaconR * 3 * pulse;
      ctx.fillStyle = '#e2e8f0';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, beaconR, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      // Label
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('ATLAS', 0, beaconR + 14);
      ctx.restore();
    } else {
      const playerMetrics = getEntityHullMetrics(ship, cicZoom);
      const playerPalette = getContactPalette(true, true, false);
      if (!drawShipSilhouette(ctx, ship, shipScr.x, shipScr.y, playerMetrics, playerPalette, 0.28)) {
        ctx.save();
        ctx.translate(shipScr.x, shipScr.y);
        ctx.rotate(ship.angle || 0);
        ctx.fillStyle = '#e2e8f0';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        const ss = Math.max(8, 220 * cicZoom);
        ctx.beginPath();
        ctx.moveTo(ss * 1.2, 0);
        ctx.lineTo(-ss * 0.7, ss * 0.6);
        ctx.lineTo(-ss * 0.5, 0);
        ctx.lineTo(-ss * 0.7, -ss * 0.6);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    // === CONTACTS ===
    for (const c of cicContacts) {
      const sp = toScreen(c.x, c.y);
      c.screenX = sp.x;
      c.screenY = sp.y;

      // Skip if off screen
      if (sp.x < -50 || sp.x > W + 50 || sp.y < -50 || sp.y > H + 50) continue;

      const isSelected = c.entity && cicSelectedContacts.some(s => s.entity === c.entity);
      const palette = getContactPalette(isSelected, c.friendly, c.hostile);
      const metrics = c.entity ? getEntityHullMetrics(c.entity, cicZoom) : null;
      const hullExtent = metrics ? Math.max(metrics.drawW, metrics.drawH) * 0.5 : 0;
      const size = Math.max(5, Math.min(14, c.radius * cicZoom * 2));
      const markerSize = Math.max(size, Math.min(28, hullExtent * 0.32));
      const iconSize = Math.max(markerSize, hullExtent);
      c.hitRadius = Math.max(14, Math.min(160, iconSize * 0.5 + 6));

      if (c.isGhost) {
        // Ghost: dashed diamond
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - markerSize); ctx.lineTo(sp.x + markerSize, sp.y);
        ctx.lineTo(sp.x, sp.y + markerSize); ctx.lineTo(sp.x - markerSize, sp.y);
        ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        continue;
      }

      const color = palette.marker;
      ctx.save();
      const drewSilhouette = canDrawContactSilhouette(c.entity, c, metrics, isSystemScale)
        ? drawShipSilhouette(ctx, c.entity, sp.x, sp.y, metrics, palette, isSelected ? 0.3 : 0.2)
        : false;
      const visualSize = drewSilhouette ? Math.max(markerSize, hullExtent * 0.5) : markerSize;

      // DETECTED: small diamond, no detail
      if (c.awareness === (window.SensorSystem?.AWARENESS?.DETECTED || 2)) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - markerSize); ctx.lineTo(sp.x + markerSize, sp.y);
        ctx.lineTo(sp.x, sp.y + markerSize); ctx.lineTo(sp.x - markerSize, sp.y);
        ctx.closePath(); ctx.stroke();
        ctx.font = '8px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(c.type.toUpperCase(), sp.x, sp.y + markerSize + 10);
      } else {
        if (!drewSilhouette) {
          // Fallback for contacts without a sprite silhouette.
          if (c.hostile) {
            ctx.fillStyle = color + '44';
            ctx.strokeStyle = color;
            ctx.lineWidth = isSelected ? 2.5 : 1.5;
            const s2 = c.isCapital ? markerSize * 1.8 : markerSize;
            ctx.beginPath();
            ctx.moveTo(sp.x, sp.y - s2); ctx.lineTo(sp.x + s2, sp.y);
            ctx.lineTo(sp.x, sp.y + s2); ctx.lineTo(sp.x - s2, sp.y);
            ctx.closePath(); ctx.fill(); ctx.stroke();
          } else {
            ctx.fillStyle = color + '44';
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, markerSize, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
          }
        }

        // Type label
        ctx.font = '9px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        const label = c.isCapital ? 'CAPITAL' : c.type.toUpperCase();
        ctx.fillText(label, sp.x, sp.y + visualSize + 11);

        // Distance
        ctx.fillStyle = CIC_CONFIG.colors.text;
        ctx.font = '8px monospace';
        ctx.fillText(formatLocalDistance(c.distance), sp.x, sp.y + visualSize + 21);

        // HP bar for tracked targets
        if (c.hp != null && c.maxHp) {
          const barW = 24, barH = 3;
          const hpRatio = Math.max(0, c.hp / c.maxHp);
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(sp.x - barW / 2, sp.y - visualSize - 8, barW, barH);
          ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#fbbf24' : '#ef4444';
          ctx.fillRect(sp.x - barW / 2, sp.y - visualSize - 8, barW * hpRatio, barH);
        }
      }

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = CIC_CONFIG.colors.selected;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const selR = visualSize + 8;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, selR, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    // === MISSION OBJECTIVE MARKERS ===
    drawCicObjectiveMarkers(ctx, W, H, toScreen, ship);

    // === BOX-SELECT RECTANGLE ===
    if (cicBoxSelecting) {
      const bx0 = Math.min(cicBoxStart.x, cicBoxEnd.x);
      const by0 = Math.min(cicBoxStart.y, cicBoxEnd.y);
      const bw  = Math.abs(cicBoxEnd.x - cicBoxStart.x);
      const bh  = Math.abs(cicBoxEnd.y - cicBoxStart.y);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fillStyle   = 'rgba(56, 189, 248, 0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(bx0, by0, bw, bh);
      ctx.strokeRect(bx0, by0, bw, bh);
      ctx.setLineDash([]);
    }

    // === CONTEXT MENU ===
    if (cicContextMenu.open) {
      const ITEM_H = 26, MENU_W = 160;
      const mx = cicContextMenu.screenX;
      const my = cicContextMenu.screenY;
      const items = cicContextMenu.items;
      const menuH = items.length * ITEM_H;
      ctx.fillStyle = 'rgba(4, 12, 28, 0.95)';
      ctx.strokeStyle = 'rgba(80, 160, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.fillRect(mx, my, MENU_W, menuH);
      ctx.strokeRect(mx, my, MENU_W, menuH);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const iy = my + i * ITEM_H;
        if (i > 0) {
          ctx.strokeStyle = 'rgba(80, 160, 255, 0.25)';
          ctx.beginPath(); ctx.moveTo(mx, iy); ctx.lineTo(mx + MENU_W, iy); ctx.stroke();
        }
        const disabled = !item.action;
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = disabled ? 'rgba(148, 163, 184, 0.35)' : '#94d4ff';
        ctx.fillText('▶ ' + item.label, mx + 10, iy + 17);
      }
    }

    // === TRAVEL NAV MARKER ===
    if (window.travelNav?.target) {
      const ct = window.travelNav.target;
      const ctScr = toScreen(ct.x, ct.y);

      // Trasa (waypointy) — przejęte z usuniętej mapy sektora.
      const waypoints = Array.isArray(window.travelNav.waypoints) ? window.travelNav.waypoints : [];
      ctx.save();
      ctx.strokeStyle = window.travelNav.active ? 'rgba(34, 211, 238, 0.75)' : 'rgba(34, 211, 238, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(shipScr.x, shipScr.y);
      if (waypoints.length) {
        const firstIdx = Math.max(0, Math.min(waypoints.length - 1, window.travelNav.waypointIndex | 0));
        for (let i = firstIdx; i < waypoints.length; i++) {
          const wp = waypoints[i];
          if (!wp) continue;
          const wpScr = toScreen(wp.x, wp.y);
          ctx.lineTo(wpScr.x, wpScr.y);
        }
      } else {
        ctx.lineTo(ctScr.x, ctScr.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = window.travelNav.active ? 1 : 0.6;
      ctx.strokeStyle = '#22d3ee';
      ctx.fillStyle = 'rgba(34, 211, 238, 0.15)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      const cmk = 10;
      ctx.beginPath();
      ctx.moveTo(ctScr.x, ctScr.y - cmk);
      ctx.lineTo(ctScr.x + cmk, ctScr.y);
      ctx.lineTo(ctScr.x, ctScr.y + cmk);
      ctx.lineTo(ctScr.x - cmk, ctScr.y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '8px monospace';
      ctx.fillStyle = '#22d3ee';
      ctx.textAlign = 'center';
      ctx.fillText('TRAVEL TARGET', ctScr.x, ctScr.y + cmk + 12);
      ctx.restore();
    }

    // === HUD OVERLAY ===
    // Top-left: CIC title
    ctx.fillStyle = CIC_CONFIG.colors.textBright;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(isSystemScale ? 'CIC — SYSTEM OVERVIEW' : 'COMBAT INFORMATION CENTER', 20, 30);

    // Contact count
    ctx.font = '11px monospace';
    ctx.fillStyle = CIC_CONFIG.colors.text;
    const hostileCount = cicContacts.filter(c => c.hostile && !c.isGhost).length;
    const ghostCount = cicContacts.filter(c => c.isGhost).length;
    ctx.fillText(`CONTACTS: ${cicContacts.length}  HOSTILE: ${hostileCount}  GHOSTS: ${ghostCount}`, 20, 50);

    // Zoom level
    const viewRadius = Math.round((W / 2) / cicZoom);
    const viewLabel = formatLocalDistance(viewRadius);
    ctx.fillText(`ZOOM: ${cicZoom.toFixed(4)}  VIEW: ±${viewLabel}`, 20, 66);

    // Probe status
    const probes = SensorSystem.getProbes();
    const probeCd = SensorSystem.getProbeCooldown();
    ctx.fillText(`PROBES: ${probes.length}/${SensorSystem.config.maxProbes}  CD: ${probeCd > 0 ? probeCd.toFixed(1) + 's' : 'READY'}`, 20, 82);

    // Drone status
    const DroneSystem = window.SpotterDroneSystem;
    if (DroneSystem) {
      const drones = DroneSystem.getDrones();
      const droneCd = DroneSystem.getCooldown();
      ctx.fillText(`DRONES: ${drones.length}/${DroneSystem.config.maxDrones}  CD: ${droneCd > 0 ? droneCd.toFixed(1) + 's' : 'READY'}`, 20, 98);
    }

    // Selected target info panel (bottom right) — shows first selected contact
    const _panelTarget = cicSelectedContacts[0]?.entity || null;
    if (_panelTarget && !_panelTarget.dead) {
      const t = _panelTarget;
      const panelX = W - 260;
      const panelY = H - 180;

      ctx.fillStyle = 'rgba(4, 12, 24, 0.85)';
      ctx.strokeStyle = CIC_CONFIG.colors.selected;
      ctx.lineWidth = 1;
      ctx.fillRect(panelX, panelY, 240, 160);
      ctx.strokeRect(panelX, panelY, 240, 160);

      ctx.fillStyle = CIC_CONFIG.colors.textBright;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('TARGET DATA', panelX + 10, panelY + 20);

      ctx.font = '10px monospace';
      ctx.fillStyle = CIC_CONFIG.colors.text;
      const dist = Math.hypot(t.x - ship.pos.x, t.y - ship.pos.y);
      const lines = [
        `TYPE: ${(t.type || 'UNKNOWN').toUpperCase()}${t.subType ? ' / ' + t.subType.toUpperCase() : ''}`,
        `DIST: ${formatLocalDistance(dist)}`,
        `HULL: ${t.hp?.toFixed(0) || '?'} / ${t.maxHp?.toFixed(0) || '?'}`,
        `SHLD: ${t.shield?.val?.toFixed(0) || '0'} / ${t.shield?.max?.toFixed(0) || '0'}`,
        `STAT: ${t.isCapitalShip ? 'CAPITAL' : t.friendly ? 'FRIENDLY' : 'HOSTILE'}`,
        `BEAR: ${((Math.atan2(t.y - ship.pos.y, t.x - ship.pos.x) * 180 / Math.PI + 360) % 360).toFixed(0)}°`,
      ];
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], panelX + 10, panelY + 40 + i * 16);
      }

      // Selection info
      ctx.fillStyle = '#38bdf8';
      const selCount = cicSelectedContacts.length;
      const hint = selCount > 1
        ? `${selCount} ZAZNACZONE  [PPM] ATAK`
        : '[PPM] ATAK / RUCH / TRAVEL TO / DRONE';
      ctx.fillText(hint, panelX + 10, panelY + 148);
    }

    // Bottom center: key hints
    ctx.fillStyle = CIC_CONFIG.colors.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    if (isSystemScale) {
      ctx.fillText('[TAB/M] Zamknij    [V] Widok taktyczny    [SCROLL] Zoom    [WSAD/MMB] Pan    [LMB] Zaznacz    [PPM] Rozkaz', W / 2, H - 16);
    } else {
      ctx.fillText('[TAB/M] Zamknij    [V] Widok systemu    [SCROLL] Zoom    [WSAD/MMB] Pan    [LMB] Zaznacz/Box    [PPM] Atak/Ruch/Travel to/Drone', W / 2, H - 16);
    }

    ctx.restore();
  },
};

// =============================================================================
// SOLAR SYSTEM RENDERING FOR CIC
// =============================================================================

const PLANET_COLORS = {
  mercury: '#b0a090',
  venus:   '#e6c87a',
  earth:   '#4a90d9',
  mars:    '#c96840',
  jupiter: '#d4a56a',
  saturn:  '#c9b87a',
  uranus:  '#7ec8c8',
  neptune: '#4466bb',
};

// Kolory typów asteroid na CIC (NATO-style tactical contacts).
const ASTEROID_CIC_COLORS = {
  iron:    '#a87a55',
  copper:  '#d97742',
  silicon: '#8aa0b8',
  titan:   '#c8d0d6',
  crystal: '#b886d4',
  ice:     '#9ed2ec',
  uran:    '#5fc77e',
};

// Promień kropki na CIC zależnie od klasy rozmiaru asteroidy.
const ASTEROID_CIC_DOT = {
  S:   0.7,
  M:   1.1,
  L:   1.7,
  BIG: 2.6,
};

function drawSolarSystem(ctx, W, H, toScreen, zoom, gameTime) {
  const SUN = window.SUN;
  const planets = window.planets;
  if (!SUN || !planets) return;

  const isSystemScale = cicSystemBlend > 0.3;
  const sunScr = toScreen(SUN.x, SUN.y);

  // === SUN ===
  const blend = cicSystemBlend;
  const sunMinR = 3 + blend * 9;
  const sunScreenR = Math.max(sunMinR, SUN.r * zoom);
  // Sun glow
  ctx.save();
  const glowR = sunScreenR * (4 + blend * 2);
  const sunGlow = ctx.createRadialGradient(sunScr.x, sunScr.y, sunScreenR * 0.3, sunScr.x, sunScr.y, glowR);
  sunGlow.addColorStop(0, 'rgba(255, 220, 100, 0.35)');
  sunGlow.addColorStop(0.4, 'rgba(255, 180, 60, 0.12)');
  sunGlow.addColorStop(1, 'rgba(255, 140, 30, 0)');
  ctx.fillStyle = sunGlow;
  ctx.beginPath();
  ctx.arc(sunScr.x, sunScr.y, glowR, 0, Math.PI * 2);
  ctx.fill();

  // Sun body
  const sunBody = ctx.createRadialGradient(sunScr.x, sunScr.y, 0, sunScr.x, sunScr.y, sunScreenR);
  sunBody.addColorStop(0, '#fff8e0');
  sunBody.addColorStop(0.5, '#ffe080');
  sunBody.addColorStop(1, '#ff9920');
  ctx.fillStyle = sunBody;
  ctx.beginPath();
  ctx.arc(sunScr.x, sunScr.y, sunScreenR, 0, Math.PI * 2);
  ctx.fill();

  // Sun label
  ctx.fillStyle = '#ffcc44';
  const sunLabelSize = Math.round(8 + blend * 4);
  ctx.font = blend > 0.5 ? `bold ${sunLabelSize}px monospace` : `${sunLabelSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('SOL', sunScr.x, sunScr.y + sunScreenR + 12 + blend * 4);
  ctx.restore();

  // === PLANET ORBITS & PLANETS ===
  for (const pl of planets) {
    if (!pl || !Number.isFinite(pl.x)) continue;

    const orbitR = pl.orbitRadius;
    const orbitScreenR = orbitR * zoom;
    const color = PLANET_COLORS[pl.id] || '#8899aa';

    // Orbit ring (only if large enough to see)
    if (orbitScreenR > 15 && orbitScreenR < W * 3) {
      ctx.save();
      ctx.strokeStyle = `rgba(60, 100, 160, ${0.15 + blend * 0.15})`;
      ctx.lineWidth = 0.7 + blend * 0.3;
      ctx.beginPath();
      ctx.arc(sunScr.x, sunScr.y, orbitScreenR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Planet dot
    const plScr = toScreen(pl.x, pl.y);

    // Skip if off screen with margin
    if (plScr.x < -100 || plScr.x > W + 100 || plScr.y < -100 || plScr.y > H + 100) continue;

    const planetScreenR = Math.max(2, pl.r * zoom);
    const tacticalR = Math.max(3, Math.min(planetScreenR, 14));
    const systemR = Math.max(8, 10 * Math.sqrt(zoom * 500));
    const dotR = tacticalR + (systemR - tacticalR) * blend;

    ctx.save();

    // Planet glow
    const glowAlpha = 0.15 + blend * 0.1;
    const glowMul = 3 + blend;
    if (dotR > 3) {
      ctx.globalAlpha = glowAlpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = dotR * 2;
      const plGlow = ctx.createRadialGradient(plScr.x, plScr.y, dotR * 0.3, plScr.x, plScr.y, dotR * glowMul);
      plGlow.addColorStop(0, color);
      plGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = plGlow;
      ctx.beginPath();
      ctx.arc(plScr.x, plScr.y, dotR * glowMul, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    // Planet body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(plScr.x, plScr.y, dotR, 0, Math.PI * 2);
    ctx.fill();

    // Planet outline
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5 + blend * 0.3;
    ctx.lineWidth = 1 + blend;
    ctx.beginPath();
    ctx.arc(plScr.x, plScr.y, dotR + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7 + blend * 0.2;
    const labelSize = Math.round(9 + blend * 4);
    ctx.font = blend > 0.5 ? `bold ${labelSize}px monospace` : `${labelSize}px monospace`;
    ctx.textAlign = 'center';
    const name = (pl.name || pl.id || '').toUpperCase();
    ctx.fillText(name, plScr.x, plScr.y + dotR + 12 + blend * 4);

    // Tactical: distance from player. System: mean orbit and orbital speed.
    if (window.ship) {
      const dist = Math.hypot(pl.x - window.ship.pos.x, pl.y - window.ship.pos.y);
      ctx.font = `${Math.round(7 + blend * 3)}px monospace`;
      ctx.globalAlpha = 0.4 + blend * 0.2;
      const hasOrbitalMetadata = Number.isFinite(Number(pl.physicalOrbitAU))
        && Number.isFinite(Number(pl.meanOrbitalSpeedKmS));
      const distLabel = blend > 0.5 && hasOrbitalMetadata
        ? `${formatAstronomicalUnits(pl.physicalOrbitAU)} · ${formatPhysicalVelocityKmS(pl.meanOrbitalSpeedKmS)}`
        : formatLocalDistance(dist);
      ctx.fillText(distLabel, plScr.x, plScr.y + dotR + 22 + blend * 6);
    }

    ctx.restore();

    // === PLANETARY ORBITAL ZONES (infrastructure ring, gravity well) ===
    const orbitRadii = window.planetOrbitRadii ? window.planetOrbitRadii(pl) : null;
    if (orbitRadii) {
      const innerR = orbitRadii.inner * zoom;
      const outerR = orbitRadii.outer * zoom;
      const gravR = orbitRadii.gravityWell * zoom;

      // Orbital zone band
      if (innerR > 3 && innerR < W * 3) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);

        ctx.beginPath();
        ctx.arc(plScr.x, plScr.y, innerR, 0, Math.PI * 2);
        ctx.stroke();

        if (outerR > 3 && outerR < W * 3) {
          ctx.beginPath();
          ctx.arc(plScr.x, plScr.y, outerR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Fill the zone band
        if (outerR > innerR) {
          ctx.globalAlpha = 0.03;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(plScr.x, plScr.y, outerR, 0, Math.PI * 2);
          ctx.arc(plScr.x, plScr.y, innerR, 0, Math.PI * 2, true);
          ctx.fill();
        }

        ctx.setLineDash([]);
        ctx.restore();
      }

      // Gravity well indicator
      if (gravR > 10 && gravR < W * 2) {
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = '#ff6644';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.arc(plScr.x, plScr.y, gravR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  // === STATIONS ===
  drawStationMarkers(ctx, W, H, toScreen, zoom);
}

// =============================================================================
// STATION & OBJECTIVE MARKERS
// =============================================================================
// Mapa sektora (M) została usunięta — CIC jest jedynym widokiem strategicznym,
// więc musi pokazywać to, co dawała mapa: gdzie stoją stacje i gdzie jest cel
// misji. Znaczniki mają stały rozmiar ekranowy, żeby nie znikały przy oddaleniu.

const CIC_OBJECTIVE_COLOR = '#ff5c8a';
const CIC_HOSTILE_STATION_COLOR = '#ff5555';
const CIC_FRIENDLY_STATION_COLOR = '#60a5fa';

function drawCicLabel(ctx, text, x, y, color, { size = 9, bold = false, align = 'center' } = {}) {
  if (!text) return;
  ctx.save();
  ctx.font = `${bold ? 'bold ' : ''}${size}px monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  const padX = 4;
  const boxX = align === 'center' ? x - w / 2 - padX : align === 'right' ? x - w - padX : x - padX;
  ctx.fillStyle = 'rgba(2, 10, 22, 0.72)';
  ctx.fillRect(boxX, y - size * 0.75, w + padX * 2, size * 1.5);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Rozmiar znacznika wrogiej stacji w pikselach — stały, niezależny od zoomu i od
// promienia stacji. Każda animacja (puls, obrót, zależność od st.r) czyta się na
// CIC jak migotanie, więc znacznik jest w pełni statyczny.
const CIC_HOSTILE_STATION_SIZE = 14;

/** Wroga stacja: statyczny X w okręgu. Cywilna: kwadrat z masztem. */
function drawStationMarkers(ctx, W, H, toScreen, zoom) {
  const stations = window.stations;
  if (!Array.isArray(stations) || stations.length === 0) return;

  for (const st of stations) {
    if (!st || !Number.isFinite(st.x)) continue;
    if (window.SensorSystem?.hides?.(st)) continue;   // mgła wojny: stacja piracka nierozpoznana
    const scr = toScreen(st.x, st.y);
    if (scr.x < -90 || scr.x > W + 90 || scr.y < -90 || scr.y > H + 90) continue;

    const hostile = !!st.isPirate;
    const color = hostile ? CIC_HOSTILE_STATION_COLOR : CIC_FRIENDLY_STATION_COLOR;
    const size = hostile
      ? CIC_HOSTILE_STATION_SIZE
      : Math.max(6, Math.min(16, (st.r || 120) * zoom));

    ctx.save();

    if (hostile) {
      // Pierścień zagrożenia (promień agresji obrony) — stała przezroczystość.
      const aggroRadius = Math.max(0, finiteNumber(window.mercMission?.aggroRadius, 0));
      const ringR = aggroRadius * zoom;
      if (ringR > size * 1.6 && ringR < Math.max(W, H) * 2) {
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        ctx.arc(scr.x, scr.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Ciemny kontur pod znacznikiem — czytelność na jasnym tle (Słońce, pasy).
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(2, 10, 22, 0.85)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(scr.x - size, scr.y - size); ctx.lineTo(scr.x + size, scr.y + size);
      ctx.moveTo(scr.x - size, scr.y + size); ctx.lineTo(scr.x + size, scr.y - size);
      ctx.stroke();

      // X = cel wrogi
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(scr.x - size, scr.y - size); ctx.lineTo(scr.x + size, scr.y + size);
      ctx.moveTo(scr.x - size, scr.y + size); ctx.lineTo(scr.x + size, scr.y - size);
      ctx.stroke();

      // Okrąg wokół X — symbol instalacji, nie statku.
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, size * 1.5, 0, Math.PI * 2);
      ctx.stroke();

      // Pasek HP
      if (Number.isFinite(st.hp) && Number.isFinite(st.maxHp) && st.maxHp > 0) {
        const barW = 40;
        const ratio = Math.max(0, Math.min(1, st.hp / st.maxHp));
        const barY = scr.y + size * 1.5 + 5;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(scr.x - barW / 2, barY, barW, 3);
        ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#fbbf24' : '#ef4444';
        ctx.fillRect(scr.x - barW / 2, barY, barW * ratio, 3);
      }
    } else {
      // Maszt (linia pionowa) — odróżnia instalację od statku.
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(scr.x, scr.y - size);
      ctx.lineTo(scr.x, scr.y - size * 1.9);
      ctx.moveTo(scr.x - size * 0.5, scr.y - size * 1.9);
      ctx.lineTo(scr.x + size * 0.5, scr.y - size * 1.9);
      ctx.stroke();

      // Korpus
      ctx.fillStyle = 'rgba(96, 165, 250, 0.18)';
      ctx.beginPath();
      ctx.rect(scr.x - size, scr.y - size, size * 2, size * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.65;
      ctx.fillRect(scr.x - size * 0.35, scr.y - size * 0.35, size * 0.7, size * 0.7);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    const name = hostile
      ? 'STACJA PIRACKA'
      : `STACJA ${String(st.planet?.label || st.id || 'ORBIT').toUpperCase()}`;
    const labelY = hostile ? scr.y + size * 1.5 + 18 : scr.y + size + 12;
    drawCicLabel(ctx, name, scr.x, labelY, color, {
      size: hostile ? 9 : 8,
      bold: hostile
    });
  }
}

/** Zbiera cele misji z dziennika; pozycja stacji ma pierwszeństwo nad zapisanym snapshotem. */
function collectCicObjectives() {
  const missions = window.MISSIONS?.active;
  if (!Array.isArray(missions) || missions.length === 0) return EMPTY_CIC_WORLD_FEATURES;
  const stations = Array.isArray(window.stations) ? window.stations : null;
  const out = [];
  for (let i = 0; i < missions.length; i++) {
    const mission = missions[i];
    if (!mission || mission.status !== 'active') continue;
    let x = finiteNumber(mission.pos?.x, NaN);
    let y = finiteNumber(mission.pos?.y, NaN);
    if (mission.stationId && stations) {
      const station = stations.find(st => st && st.id === mission.stationId);
      if (station && Number.isFinite(station.x)) { x = station.x; y = station.y; }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      x,
      y,
      title: String(mission.title || 'MISJA').toUpperCase(),
      objective: String(mission.objective || mission.location || '')
    });
  }
  return out;
}

function formatCicDistance(dist) {
  return formatNavigationDistance(dist);
}

/**
 * Znaczniki celów misji — geometria statyczna (bez obrotu i pulsowania; na CIC
 * animacja czyta się jak migotanie). Na ekranie: celownik z podpisem.
 * Poza ekranem: strzałka przy krawędzi z kierunkiem i dystansem — dzięki temu
 * gracz zawsze wie, GDZIE szukać celu, nawet przy pełnym oddaleniu.
 */
function drawCicObjectiveMarkers(ctx, W, H, toScreen, ship) {
  const objectives = collectCicObjectives();
  if (objectives.length === 0) return;

  const color = CIC_OBJECTIVE_COLOR;
  const margin = 58;
  const shipX = finiteNumber(ship?.pos?.x, 0);
  const shipY = finiteNumber(ship?.pos?.y, 0);

  for (const obj of objectives) {
    const scr = toScreen(obj.x, obj.y);
    const dist = Math.hypot(obj.x - shipX, obj.y - shipY);
    const distLabel = formatCicDistance(dist);
    const onScreen = scr.x >= margin && scr.x <= W - margin && scr.y >= margin && scr.y <= H - margin;

    if (onScreen) {
      const r = 26;
      ctx.save();
      ctx.translate(scr.x, scr.y);

      // Przerywany pierścień (nieruchomy)
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Narożniki celownika
      ctx.lineWidth = 2;
      const b = r + 7;
      const arm = 7;
      for (let q = 0; q < 4; q++) {
        const sx = q === 0 || q === 3 ? -1 : 1;
        const sy = q < 2 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(sx * b, sy * b - sy * arm);
        ctx.lineTo(sx * b, sy * b);
        ctx.lineTo(sx * b - sx * arm, sy * b);
        ctx.stroke();
      }
      ctx.restore();

      drawCicLabel(ctx, `◆ ${obj.title}`, scr.x, scr.y - r - 20, color, { size: 10, bold: true });
      drawCicLabel(ctx, distLabel, scr.x, scr.y + r + 20, color, { size: 9 });
      if (obj.objective) {
        drawCicLabel(ctx, obj.objective.toUpperCase(), scr.x, scr.y + r + 33, 'rgba(255, 200, 220, 0.85)', { size: 8 });
      }
      continue;
    }

    // Poza ekranem — strzałka na krawędzi
    const ex = Math.max(margin, Math.min(W - margin, scr.x));
    const ey = Math.max(margin, Math.min(H - margin, scr.y));
    let adx = scr.x - ex;
    let ady = scr.y - ey;
    if (Math.abs(adx) < 0.001 && Math.abs(ady) < 0.001) {
      adx = scr.x - W / 2;
      ady = scr.y - H / 2;
    }
    const angle = Math.atan2(ady, adx);

    ctx.save();
    ctx.translate(ex, ey);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-6, 9);
    ctx.lineTo(-1, 0);
    ctx.lineTo(-6, -9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const labelY = ey < H / 2 ? ey + 34 : ey - 30;
    drawCicLabel(ctx, `◆ ${obj.title}`, ex, labelY, color, { size: 9, bold: true });
    drawCicLabel(ctx, distLabel, ex, labelY + 13, color, { size: 8 });
  }
}

window.CICDisplay = CICDisplay;
