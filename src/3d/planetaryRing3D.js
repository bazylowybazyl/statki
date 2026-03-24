import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { initHexBody, getHexStructuralState } from '../game/destructor.js';
import { RingCityZoneGrid } from './ringCityZoneGrid.js';
import { loadSynthCityAssets } from './ringCityAssets.js';
import { buildAllDistricts, rebuildDistrictForCell } from './ringCityBuildings.js';
import { buildAllInfrastructure, createDistrictInfrastructure, rebuildAllInfrastructure } from './ringCityInfrastructure.js';

const RING_PLANETS = new Set(['earth', 'mars']);

const CONFIG = Object.freeze({
  segmentWorldWidth: 800,
  segmentWorldHeight: 2400,
  overlap: 2,
  pylonWorldWidth: 380,
  ringRadiusMul: 5.2,
  outerLayerRatio: 0.22,
  innerLayerRatio: 0.22,
  minMiddleGapRatio: 0.46,
  middleRailInsetWorld: 100,
  middleRailAlpha: 0.14,
  railWorldHeight: 150,
  collisionAlphaCutoff: 64,
  ringRotationSpeed: 0.05,
  queryCellSize: 3000,
  gateOpenRadius: 3000,
  gateCloseRadius: 3800,
  doorLeafWidthRatio: 0.58,
  doorClosedOffsetWorld: 70,
  doorSlideDistanceWorld: 260,
  doorAnimSpeed: 0.35,
  gateDepth: 500
});

const DEFAULT_RING_VISUAL_Z = Object.freeze({
  floor: 0,
  gate: 0,
  gateLight: 0
});

const TEXTURE = Object.freeze({
  width: 216,
  height: 648,
  pylonWidth: 103,
  railHeight: 42
});

const BUILD_GRID = Object.freeze({
  stride: 3,
  floors: 5,
  floorHeight: 300,
  slotWidthRatio: 0.92
});

const HEX_SCALE = CONFIG.segmentWorldWidth / TEXTURE.width;

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
const RING_SEGMENT_MASS = 2500000;
const GATE_GLOW_TEX_PATH = '/assets/effects/glow.png';

let gateGlowTexture = undefined;

function getGateGlowTexture() {
  if (gateGlowTexture !== undefined) return gateGlowTexture;
  try {
    const loader = new THREE.TextureLoader();
    gateGlowTexture = loader.load(GATE_GLOW_TEX_PATH);
  } catch {
    gateGlowTexture = null;
  }
  return gateGlowTexture;
}

function getRingBandLayout() {
  const totalWorld = Math.max(1, CONFIG.segmentWorldHeight);
  const minBandWorld = totalWorld * 0.12;
  const minGapWorld = totalWorld * CONFIG.minMiddleGapRatio;

  let outerWorld = Math.max(minBandWorld, totalWorld * CONFIG.outerLayerRatio);
  let innerWorld = Math.max(minBandWorld, totalWorld * CONFIG.innerLayerRatio);

  let gapWorld = totalWorld - outerWorld - innerWorld;
  if (gapWorld < minGapWorld) {
    const deficit = minGapWorld - gapWorld;
    const shrinkOuter = Math.min(deficit * 0.5, Math.max(0, outerWorld - minBandWorld));
    const shrinkInner = Math.min(deficit * 0.5, Math.max(0, innerWorld - minBandWorld));
    outerWorld -= shrinkOuter;
    innerWorld -= shrinkInner;
    gapWorld = totalWorld - outerWorld - innerWorld;
  }
  if (gapWorld < minGapWorld) {
    gapWorld = minGapWorld;
    const rest = totalWorld - gapWorld;
    outerWorld = Math.max(minBandWorld, rest * 0.5);
    innerWorld = Math.max(minBandWorld, rest - outerWorld);
  }

  const pxPerWorld = TEXTURE.height / totalWorld;
  const outerPx = Math.max(8, Math.round(outerWorld * pxPerWorld));
  const innerPx = Math.max(8, Math.round(innerWorld * pxPerWorld));
  const gapStartPx = outerPx;
  const gapEndPx = Math.max(gapStartPx + 6, TEXTURE.height - innerPx);

  const outerBandTopPx = 0;
  const outerBandBottomPx = gapStartPx;
  const innerBandTopPx = Math.min(TEXTURE.height - 1, gapEndPx);
  const innerBandBottomPx = TEXTURE.height;

  const gapStartWorld = -totalWorld * 0.5 + outerWorld;
  const gapEndWorld = totalWorld * 0.5 - innerWorld;
  const innerBandCenterLocalY = totalWorld * 0.5 - innerWorld * 0.5;

  return {
    outerWorld,
    innerWorld,
    gapWorld,
    gapStartWorld,
    gapEndWorld,
    innerBandCenterLocalY,
    outerBandTopPx,
    outerBandBottomPx,
    innerBandTopPx,
    innerBandBottomPx,
    gapStartPx,
    gapEndPx
  };
}

// --- Pedestal procedural textures ---
function _generatePedestalDeckTexture() {
    const w = 1024, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0e1622');
    grad.addColorStop(1, '#070b12');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
        ctx.fillStyle = y % 64 === 0 ? 'rgba(150,190,220,0.035)' : 'rgba(255,255,255,0.015)';
        ctx.fillRect(0, y, w, 2);
    }
    for (let x = 0; x < w; x += 64) {
        ctx.strokeStyle = 'rgba(90,120,150,0.08)';
        ctx.strokeRect(x + 2, 8, 52, h - 16);
        if ((x / 64) % 3 === 0) {
            ctx.fillStyle = 'rgba(0,243,255,0.07)';
            ctx.fillRect(x + 8, 14, 36, 3);
        }
    }
    ctx.strokeStyle = 'rgba(0,243,255,0.11)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75); ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(18, 2);
    tex.anisotropy = 4;
    return tex;
}

function _generatePedestalWallTexture() {
    const w = 512, h = 512;
    const c = document.createElement('canvas');
    c.width = c.height = h;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#101723');
    grad.addColorStop(1, '#04070c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.fillRect(x, 0, 3, h);
        ctx.fillStyle = 'rgba(0,243,255,0.04)';
        ctx.fillRect(x + 6, 24, 2, h - 48);
    }
    for (let y = 0; y < h; y += 48) {
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.fillRect(0, y, w, 2);
    }
    for (let i = 0; i < 18; i++) {
        const x = Math.random() * (w - 60);
        const y = Math.random() * (h - 30);
        ctx.fillStyle = 'rgba(120,160,190,0.05)';
        ctx.fillRect(x, y, 40 + Math.random() * 40, 8 + Math.random() * 10);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(20, 2.4);
    tex.anisotropy = 4;
    return tex;
}

const state = {
  rings: new Map(),
  entities: [],
  queryCells: new Map(),
  queryResult: [],
  queryCount: 0,
  gateMode: 'auto',
  visualZByKey: new Map()
};

function normalizeRingKey(planetKey) {
  return String(planetKey || '').toLowerCase();
}

function getRingVisualZ(planetKey) {
  const key = normalizeRingKey(planetKey);
  const override = state.visualZByKey.get(key);
  return {
    floor: Number.isFinite(Number(override?.floor)) ? Number(override.floor) : DEFAULT_RING_VISUAL_Z.floor,
    gate: Number.isFinite(Number(override?.gate)) ? Number(override.gate) : DEFAULT_RING_VISUAL_Z.gate,
    gateLight: Number.isFinite(Number(override?.gateLight)) ? Number(override.gateLight) : DEFAULT_RING_VISUAL_Z.gateLight
  };
}

function setRingVisualZ(planetKey, patch = {}) {
  const key = normalizeRingKey(planetKey);
  if (!key) return getRingVisualZ(key);
  const current = getRingVisualZ(key);
  const next = {
    floor: Number.isFinite(Number(patch.floor)) ? Number(patch.floor) : current.floor,
    gate: Number.isFinite(Number(patch.gate)) ? Number(patch.gate) : current.gate,
    gateLight: Number.isFinite(Number(patch.gateLight)) ? Number(patch.gateLight) : current.gateLight
  };
  state.visualZByKey.set(key, next);
  return next;
}

function clearRingVisualZ(planetKey) {
  const key = normalizeRingKey(planetKey);
  state.visualZByKey.delete(key);
  return getRingVisualZ(key);
}

let textureCache = null;

function normalizePlanetKey(planet) {
  if (!planet) return '';
  const candidates = [planet.id, planet.name, planet.label, planet.type];
  for (const candidate of candidates) {
    const key = String(candidate || '').trim().toLowerCase();
    if (!key) continue;
    if (key.includes('earth')) return 'earth';
    if (key.includes('mars')) return 'mars';
    if (RING_PLANETS.has(key)) return key;
  }
  return '';
}

function createCanvas(width, height) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawBandRails(ctx, y0, y1, railH) {
  const w = ctx.canvas.width;
  const topY = y0;
  const bottomY = Math.max(y0, y1 - railH);

  const topRail = ctx.createLinearGradient(0, topY, 0, topY + railH);
  topRail.addColorStop(0, '#07090f');
  topRail.addColorStop(0.45, '#222a36');
  topRail.addColorStop(1, '#080b12');
  ctx.fillStyle = topRail;
  ctx.fillRect(0, topY, w, Math.max(1, railH));

  const bottomRail = ctx.createLinearGradient(0, bottomY, 0, y1);
  bottomRail.addColorStop(0, '#080b12');
  bottomRail.addColorStop(0.55, '#222a36');
  bottomRail.addColorStop(1, '#07090f');
  ctx.fillStyle = bottomRail;
  ctx.fillRect(0, bottomY, w, Math.max(1, y1 - bottomY));

  const glowSize = Math.max(1, Math.round(railH * 0.12));
  ctx.fillStyle = 'rgba(0, 110, 230, 0.42)';
  ctx.fillRect(0, topY + railH - glowSize, w, glowSize);
  ctx.fillRect(0, bottomY, w, glowSize);

  const stripeH = Math.max(1, Math.round(railH * 0.1));
  ctx.fillStyle = 'rgba(18, 20, 24, 0.95)';
  const seg = Math.max(10, Math.round(w * 0.1));
  const gap = Math.max(8, Math.round(seg * 0.8));
  for (let x = 0; x < w; x += seg + gap) {
    ctx.fillRect(x, topY, seg, stripeH);
    ctx.fillRect(x, y1 - stripeH, seg, stripeH);
  }
}

function fillBandGradient(ctx, y0, y1, topColor, midColor, bottomColor) {
  const w = ctx.canvas.width;
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, topColor);
  grad.addColorStop(0.5, midColor);
  grad.addColorStop(1, bottomColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, y0, w, Math.max(1, y1 - y0));
}

function drawWallTexture(ctx) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const layout = getRingBandLayout();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1018';
  ctx.fillRect(0, layout.gapStartPx, w, layout.gapEndPx - layout.gapStartPx);

  const railH = Math.min(TEXTURE.railHeight, Math.max(8, Math.floor((layout.outerBandBottomPx - layout.outerBandTopPx) * 0.35)));
  fillBandGradient(ctx, layout.outerBandTopPx, layout.outerBandBottomPx, '#0a0d14', '#1b2432', '#0d1119');
  drawBandRails(ctx, layout.outerBandTopPx, layout.outerBandBottomPx, railH);

  const defenseY = Math.round(layout.outerBandTopPx + (layout.outerBandBottomPx - layout.outerBandTopPx) * 0.18);
  const defenseH = Math.max(10, Math.round((layout.outerBandBottomPx - layout.outerBandTopPx) * 0.64));
  ctx.fillStyle = 'rgba(26, 34, 48, 0.92)';
  ctx.fillRect(0, defenseY, w, defenseH);
  ctx.fillStyle = '#101724';
  for (let i = 1; i <= 3; i++) {
    const y = defenseY + (i * defenseH) / 4;
    ctx.fillRect(0, Math.round(y), w, 2);
  }

  const hardRows = 2;
  const rowH = defenseH / hardRows;
  for (let r = 0; r < hardRows; r++) {
    const cx = Math.round(w * 0.5);
    const cy = Math.round(defenseY + r * rowH + rowH * 0.5);
    const radius = Math.max(8, Math.round(w * 0.16));
    ctx.fillStyle = '#2b3649';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 45, 45, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(cx - Math.max(3, Math.round(radius * 0.22)), cy - Math.max(6, Math.round(radius * 0.55)), Math.max(6, Math.round(radius * 0.44)), Math.max(12, Math.round(radius * 1.1)));
  }

  const innerBandH = layout.innerBandBottomPx - layout.innerBandTopPx;
  const innerRailH = Math.min(TEXTURE.railHeight, Math.max(8, Math.floor(innerBandH * 0.35)));
  fillBandGradient(ctx, layout.innerBandTopPx, layout.innerBandBottomPx, '#101722', '#1a2536', '#0d121b');
  drawBandRails(ctx, layout.innerBandTopPx, layout.innerBandBottomPx, innerRailH);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 30; i++) {
    const gx = 4 + ((i * 23) % Math.max(8, w - 8));
    const gy = layout.innerBandTopPx + 4 + ((i * 13) % Math.max(8, innerBandH - 8));
    ctx.fillRect(gx, gy, 2 + (i % 4), 2 + ((i * 2) % 3));
  }

  ctx.fillStyle = 'rgba(255, 190, 30, 0.22)';
  const dockW = Math.max(18, Math.round(w * 0.28));
  const dockH = Math.max(12, Math.round(innerBandH * 0.48));
  for (let i = 0; i < 2; i++) {
    const dx = Math.round(w * 0.1 + i * w * 0.48);
    const dy = Math.round(layout.innerBandTopPx + innerBandH * 0.24);
    ctx.fillRect(dx, dy, dockW, dockH);
    ctx.strokeStyle = 'rgba(200,160,20,0.72)';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx, dy, dockW, dockH);
  }

  const middleInsetPx = Math.max(1, Math.round((CONFIG.middleRailInsetWorld / CONFIG.segmentWorldHeight) * h));
  const railTop = Math.min(layout.gapEndPx - 1, layout.gapStartPx + middleInsetPx);
  const railBottom = Math.max(layout.gapStartPx + 1, layout.gapEndPx - middleInsetPx);
  ctx.strokeStyle = `rgba(100, 180, 255, ${CONFIG.middleRailAlpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(6, railTop);
  ctx.lineTo(w - 6, railTop);
  ctx.moveTo(6, railBottom);
  ctx.lineTo(w - 6, railBottom);
  ctx.stroke();
}

function drawPylonTexture(ctx, side) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const layout = getRingBandLayout();
  const outerBandH = layout.outerBandBottomPx - layout.outerBandTopPx;
  const innerBandH = layout.innerBandBottomPx - layout.innerBandTopPx;
  const outerRailH = Math.min(TEXTURE.railHeight, Math.max(8, Math.floor(outerBandH * 0.35)));
  const innerRailH = Math.min(TEXTURE.railHeight, Math.max(8, Math.floor(innerBandH * 0.35)));
  const pylonW = TEXTURE.pylonWidth;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1018';
  ctx.fillRect(0, layout.gapStartPx, w, layout.gapEndPx - layout.gapStartPx);
  fillBandGradient(ctx, layout.outerBandTopPx, layout.outerBandBottomPx, '#0b0f16', '#162133', '#0d1118');
  fillBandGradient(ctx, layout.innerBandTopPx, layout.innerBandBottomPx, '#0d1118', '#1a2433', '#0b0f16');
  drawBandRails(ctx, layout.outerBandTopPx, layout.outerBandBottomPx, outerRailH);
  drawBandRails(ctx, layout.innerBandTopPx, layout.innerBandBottomPx, innerRailH);

  const px = (side === 'left') ? 0 : (w - pylonW);
  const grad = ctx.createLinearGradient(px, 0, px + pylonW, 0);
  grad.addColorStop(0, '#05070a');
  grad.addColorStop(0.5, '#1a202e');
  grad.addColorStop(1, '#05070a');

  ctx.fillStyle = grad;
  ctx.fillRect(px, layout.outerBandTopPx, pylonW, outerBandH);
  ctx.fillRect(px, layout.innerBandTopPx, pylonW, innerBandH);

  const drawEmitters = (startY, bandH) => {
    const emitterCount = Math.max(3, Math.floor(bandH / 12));
    const emitterW = Math.max(6, Math.round(pylonW * 0.14));
    const emitterH = Math.max(4, Math.round(h * 0.01));
    for (let i = 0; i < emitterCount; i++) {
      const y = Math.round(startY + i * (bandH / Math.max(1, emitterCount - 1)));
      const ex = side === 'left' ? (px + pylonW - emitterW - 5) : (px + 5);
      ctx.fillStyle = 'rgba(230,248,255,0.95)';
      ctx.fillRect(ex, y - emitterH * 0.5, emitterW, emitterH);
      ctx.fillStyle = 'rgba(0, 255, 255, 0.28)';
      ctx.fillRect(ex - 4, y - emitterH, emitterW + 8, emitterH * 2);
    }
  };
  drawEmitters(layout.outerBandTopPx + 4, Math.max(8, outerBandH - 8));
  drawEmitters(layout.innerBandTopPx + 4, Math.max(8, innerBandH - 8));
}

function drawGateCenterTexture(ctx) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const layout = getRingBandLayout();
  const outerBandH = layout.outerBandBottomPx - layout.outerBandTopPx;
  const innerBandH = layout.innerBandBottomPx - layout.innerBandTopPx;
  const outerRailH = Math.min(TEXTURE.railHeight, Math.max(8, Math.floor(outerBandH * 0.35)));
  const innerRailH = Math.min(TEXTURE.railHeight, Math.max(8, Math.floor(innerBandH * 0.35)));

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1018';
  ctx.fillRect(0, layout.gapStartPx, w, layout.gapEndPx - layout.gapStartPx);
  fillBandGradient(ctx, layout.outerBandTopPx, layout.outerBandBottomPx, '#0b1018', '#132234', '#0b1018');
  fillBandGradient(ctx, layout.innerBandTopPx, layout.innerBandBottomPx, '#0b1018', '#132234', '#0b1018');
  drawBandRails(ctx, layout.outerBandTopPx, layout.outerBandBottomPx, outerRailH);
  drawBandRails(ctx, layout.innerBandTopPx, layout.innerBandBottomPx, innerRailH);

  ctx.strokeStyle = 'rgba(95, 110, 136, 0.42)';
  ctx.lineWidth = 2;
  const gapH = Math.max(1, layout.gapEndPx - layout.gapStartPx);
  for (let i = 0; i < 4; i++) {
    const y = Math.round(layout.gapStartPx + ((i + 0.5) * gapH) / 4);
    ctx.beginPath();
    ctx.moveTo(10, y);
    ctx.lineTo(w - 10, y);
    ctx.stroke();
  }
}

function drawGateDoorLeafTexture(ctx, side = 'left') {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const layout = getRingBandLayout();
  const outerBandH = layout.outerBandBottomPx - layout.outerBandTopPx;
  const innerBandH = layout.innerBandBottomPx - layout.innerBandTopPx;
  const outerRailH = Math.min(TEXTURE.railHeight, Math.max(8, Math.floor(outerBandH * 0.35)));
  const innerRailH = Math.min(TEXTURE.railHeight, Math.max(8, Math.floor(innerBandH * 0.35)));

  ctx.clearRect(0, 0, w, h);
  fillBandGradient(ctx, layout.outerBandTopPx, layout.outerBandBottomPx, '#0b1018', '#1b2434', '#0b1018');
  fillBandGradient(ctx, layout.innerBandTopPx, layout.innerBandBottomPx, '#0b1018', '#1b2434', '#0b1018');
  drawBandRails(ctx, layout.outerBandTopPx, layout.outerBandBottomPx, outerRailH);
  drawBandRails(ctx, layout.innerBandTopPx, layout.innerBandBottomPx, innerRailH);

  const seamX = side === 'left' ? w - 2 : 2;
  ctx.strokeStyle = 'rgba(210, 230, 255, 0.68)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(seamX, layout.outerBandTopPx + 6);
  ctx.lineTo(seamX, layout.outerBandBottomPx - 6);
  ctx.moveTo(seamX, layout.innerBandTopPx + 6);
  ctx.lineTo(seamX, layout.innerBandBottomPx - 6);
  ctx.stroke();

  const boltX = side === 'left' ? w - 8 : 8;
  ctx.fillStyle = 'rgba(180, 200, 225, 0.8)';
  const boltRows = 8;
  for (let i = 0; i < boltRows; i++) {
    const yOuter = Math.round(layout.outerBandTopPx + 8 + (i * (outerBandH - 16)) / Math.max(1, boltRows - 1));
    const yInner = Math.round(layout.innerBandTopPx + 8 + (i * (innerBandH - 16)) / Math.max(1, boltRows - 1));
    ctx.fillRect(boltX - 1, yOuter - 1, 2, 2);
    ctx.fillRect(boltX - 1, yInner - 1, 2, 2);
  }
}

function getSegmentTextures() {
  if (textureCache) return textureCache;

  const wall = createCanvas(TEXTURE.width, TEXTURE.height);
  const gateL = createCanvas(TEXTURE.width, TEXTURE.height);
  const gateR = createCanvas(TEXTURE.width, TEXTURE.height);
  const gateInnerL = createCanvas(TEXTURE.width, TEXTURE.height);
  const gateInnerR = createCanvas(TEXTURE.width, TEXTURE.height);

  if (!wall || !gateL || !gateR || !gateInnerL || !gateInnerR) {
    textureCache = null;
    return null;
  }

  drawWallTexture(wall.getContext('2d'));
  drawPylonTexture(gateL.getContext('2d'), 'left');
  drawPylonTexture(gateR.getContext('2d'), 'right');
  drawGateDoorLeafTexture(gateInnerL.getContext('2d'), 'left');
  drawGateDoorLeafTexture(gateInnerR.getContext('2d'), 'right');

  textureCache = Object.freeze({
    WALL: wall,
    GATE_L_OUTER: gateL,
    GATE_L_INNER: gateInnerL,
    GATE_R_INNER: gateInnerR,
    GATE_R_OUTER: gateR
  });
  return textureCache;
}

function buildSegmentTypes(segmentCount) {
  const types = new Array(segmentCount).fill('WALL');
  const quarter = Math.floor(segmentCount / 4);
  const gateIndices = [0, quarter, quarter * 2, quarter * 3];
  for (const idx of gateIndices) {
    if (idx + 3 >= segmentCount) continue;
    types[idx] = 'GATE_L_OUTER';
    types[idx + 1] = 'GATE_L_INNER';
    types[idx + 2] = 'GATE_R_INNER';
    types[idx + 3] = 'GATE_R_OUTER';
  }
  return types;
}

class PlanetaryRing {
  constructor(planet, key) {
    this.key = key;
    this.ringRadius = Math.max(5000, (Number(planet?.r) || 2800) * CONFIG.ringRadiusMul);
    this.currentRotation = 0;
    this.rotationSpeed = CONFIG.ringRotationSpeed;
    this.segmentData = [];
    this.segmentTypes = [];
    this.constructionSlots = [];
    this.gates = [];
    this.gateLightSprites = [];
    this.angleStep = 0;
    this.lastPlanetX = 0;
    this.lastPlanetY = 0;
    this.updateTick = 0;

    // --- BUDYNKI 3D NA WARSTWIE 2 (FOREGROUND) ---
    this.buildings3D = new THREE.Group();
    this.buildings3D.name = `PlanetaryRingRoot:${this.key}`;
    if (Core3D.scene) {
        Core3D.scene.add(this.buildings3D);
        Core3D.enableForeground3D(this.buildings3D); // Na layer 1 ring przykrywał budynki, więc wracamy na pass FG.
    }
    this.visualMeshes = [];
    this.zoneGrid = new RingCityZoneGrid(this.ringRadius, CONFIG.segmentWorldHeight);
    this.ringFloor = null; // 3D ring pedestal mesh group

    this.build();
    this.updateFromPlanet(planet, 0);
  }

  build() {
    const textures = getSegmentTextures();
    if (!textures) return;

    const layout = getRingBandLayout();
    const effectiveWidth = CONFIG.segmentWorldWidth - CONFIG.overlap;
    const outerCoverageRadius = this.ringRadius + Math.max(
      CONFIG.segmentWorldHeight * 0.5,
      Math.abs(layout.gapStartWorld)
    );
    const circumference = Math.PI * 2 * outerCoverageRadius;
    const segmentCount = Math.max(24, Math.ceil(circumference / effectiveWidth));
    this.angleStep = (Math.PI * 2) / segmentCount;
    this.segmentTypes = buildSegmentTypes(segmentCount);
    this.segmentData.length = 0;

    for (let i = 0; i < segmentCount; i++) {
      const type = this.segmentTypes[i];
      const baseAngle = i * this.angleStep;
      const segment = {
        index: i,
        type,
        baseAngle,
        worldAngle: baseAngle,
        entity: null
      };

      const image = textures[type] || textures.WALL;
      const entity = this.createSegmentEntity(i, type, image);
      segment.entity = entity;

      this.segmentData.push(segment);
    }

    // Ring starts empty — player builds zones via zone painter UI

    for (let i = 0; i < this.segmentData.length; i++) {
      if (this.segmentTypes[i] !== 'GATE_L_OUTER') continue;
      this.createMechanicalGate(i);
    }

    this.buildConstructionSlots(segmentCount);
    this.buildRingPedestal();
  }

  // ── Damage alpha map — links visual floor to destructor ──────────────
  buildDamageAlphaMap() {
    const segCount = this.segmentData.length;
    const pxPerSeg = 8;
    const w = segCount * pxPerSeg;
    const h = 4;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext('2d');
    ctx2d.fillStyle = '#fff';
    ctx2d.fillRect(0, 0, w, h);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    this._damageCanvas = canvas;
    this._damageCtx = ctx2d;
    this._damageTexture = tex;
    this._damagePxPerSeg = pxPerSeg;
  }

  /** Remap RingGeometry UVs: U = angle/(2π), aligned to segment baseAngle */
  _remapRingUVs(geo) {
    const uvAttr = geo.getAttribute('uv');
    const posAttr = geo.getAttribute('position');
    for (let i = 0; i < uvAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      let angle = Math.atan2(y, x); // -PI..PI
      if (angle < 0) angle += Math.PI * 2; // 0..2PI — matches baseAngle range
      const u = angle / (Math.PI * 2); // 0..1
      uvAttr.setX(i, u);
    }
    uvAttr.needsUpdate = true;
  }

  buildRingPedestal() {
    const ringR = this.ringRadius;
    const halfH = CONFIG.segmentWorldHeight * 0.5;
    const innerR = ringR - halfH;
    const outerR = ringR + halfH;
    const overhang = 0;
    const pedestalH = 180;

    // Build damage alpha texture before materials
    this.buildDamageAlphaMap();
    const alphaTex = this._damageTexture;

    // Pedestal textures (procedural canvas)
    const deckTex = _generatePedestalDeckTexture();
    const wallTex = _generatePedestalWallTexture();

    const deckMat = new THREE.MeshStandardMaterial({
        map: deckTex, color: 0x1b2431, emissive: 0x0d2030,
        emissiveIntensity: 0.22, roughness: 0.82, metalness: 0.48, side: THREE.DoubleSide,
        alphaMap: alphaTex, transparent: true, alphaTest: 0.05
    });
    const wallMat = new THREE.MeshStandardMaterial({
        map: wallTex, color: 0x131a24, emissive: 0x08131d,
        emissiveIntensity: 0.16, roughness: 0.88, metalness: 0.38, side: THREE.DoubleSide
    });
    const trimMat = new THREE.MeshBasicMaterial({
        color: 0x2f6ea4, transparent: true, opacity: 0.3,
        alphaMap: alphaTex, alphaTest: 0.05
    });

    const floorGroup = new THREE.Group();
    floorGroup.name = `PlanetaryRingFloor:${this.key}`;

    // Top deck (main floor) — flat ring in XY plane
    const topGeo = new THREE.RingGeometry(innerR - overhang, outerR + overhang, 512);
    this._remapRingUVs(topGeo);
    const topDeckMesh = new THREE.Mesh(topGeo, deckMat);
    topDeckMesh.name = `PlanetaryRingTopDeck:${this.key}`;
    topDeckMesh.visible = false;
    floorGroup.add(topDeckMesh);

    // Autostrada (central highway)
    const autoW = 180;
    const autoGeo = new THREE.RingGeometry(ringR - autoW * 0.5, ringR + autoW * 0.5, 512);
    this._remapRingUVs(autoGeo);
    const autoMat = new THREE.MeshStandardMaterial({
        color: 0x0c1018, roughness: 0.88, metalness: 0.32, side: THREE.DoubleSide,
        alphaMap: alphaTex, transparent: true, alphaTest: 0.05
    });
    const autoMesh = new THREE.Mesh(autoGeo, autoMat);
    autoMesh.name = `PlanetaryRingHighway:${this.key}`;
    autoMesh.position.z = 0.5;
    autoMesh.visible = false;
    floorGroup.add(autoMesh);

    // Lane markers (torus rings) — TorusGeometry U already maps to angle
    const laneMat = new THREE.MeshBasicMaterial({
        color: 0x3a618a, transparent: true, opacity: 0.34,
        alphaMap: alphaTex, alphaTest: 0.05
    });
    const laneOffset = 34;
    for (const { radius, tube, opacity } of [
        { radius: ringR, tube: 2.8, opacity: 0.36 },
        { radius: ringR - laneOffset, tube: 2.2, opacity: 0.22 },
        { radius: ringR + laneOffset, tube: 2.2, opacity: 0.22 }
    ]) {
        const mat = laneMat.clone();
        mat.opacity = opacity;
        const strip = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 4, 320), mat);
        strip.name = `PlanetaryRingLane:${this.key}`;
        strip.position.z = 1.0;
        floorGroup.add(strip);
    }

    // Shoulder edges
    const shoulderMat = new THREE.MeshBasicMaterial({
        color: 0x17324b, transparent: true, opacity: 0.12,
        alphaMap: alphaTex, alphaTest: 0.05
    });
    for (const radius of [ringR - autoW * 0.5, ringR + autoW * 0.5]) {
        const shoulder = new THREE.Mesh(new THREE.TorusGeometry(radius, 4, 4, 320), shoulderMat);
        shoulder.name = `PlanetaryRingShoulder:${this.key}`;
        shoulder.position.z = 0.8;
        floorGroup.add(shoulder);
    }

    // Trim rails (edge glow)
    for (const { radius, tube, opacity } of [
        { radius: innerR - overhang + 18, tube: 6, opacity: 0.26 },
        { radius: outerR + overhang - 18, tube: 6, opacity: 0.26 }
    ]) {
        const mat = trimMat.clone();
        mat.opacity = opacity;
        const rail = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 4, 256), mat);
        rail.name = `PlanetaryRingRail:${this.key}`;
        rail.position.z = 2;
        floorGroup.add(rail);
    }

    // Y-flip: game coords have Y-down, Three.js has Y-up.
    // Without scale.y = -1, rotation.z rotates the floor opposite to the physics direction.
    floorGroup.scale.set(1, -1, 1);

    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(floorGroup);
    this.buildings3D.add(floorGroup);
    this.ringFloor = floorGroup;
  }

  /** Update damage alpha texture based on segment structural state + gate openings */
  updateDamageAlpha() {
    if (!this._damageCtx) return;
    const ctx2d = this._damageCtx;
    const pxPerSeg = this._damagePxPerSeg;
    let dirty = false;

    // Build gate openAmount lookup: segmentIndex → alpha (1=closed/opaque, 0=open/transparent)
    // Gate 3D mesh IS the floor piece moving away, so the static floor fades out underneath
    const gateAlpha = new Map();
    for (const gate of this.gates) {
      if (!gate) continue;
      const oa = gate.openAmount || 0;
      // Inner leaves open first, outer pylons follow with delay
      const innerAlpha = Math.max(0, 1 - oa * 2.5);       // fades to 0 by oa=0.4
      const outerAlpha = Math.max(0, 1 - Math.max(0, oa - 0.15) * 2.0); // fades 0.15→0.65
      gateAlpha.set(gate.startIndex, outerAlpha);       // GATE_L_OUTER
      gateAlpha.set(gate.startIndex + 1, innerAlpha);   // GATE_L_INNER
      gateAlpha.set(gate.startIndex + 2, innerAlpha);   // GATE_R_INNER
      gateAlpha.set(gate.startIndex + 3, outerAlpha);   // GATE_R_OUTER
    }

    for (let i = 0; i < this.segmentData.length; i++) {
      const seg = this.segmentData[i];
      const entity = seg.entity;

      // Dead or missing entity → fully transparent
      if (!entity || entity.dead) {
        const prev = seg._lastDamageRatio ?? 1.0;
        if (prev > 0.001) {
          seg._lastDamageRatio = 0;
          ctx2d.clearRect(i * pxPerSeg, 0, pxPerSeg, 4);
          dirty = true;
        }
        continue;
      }

      // Structural damage ratio
      let ratio = 1.0;
      if (entity.hexGrid) {
        const structural = getHexStructuralState(entity);
        if (structural && structural.total > 0) {
          ratio = structural.active / structural.total;
        }
      }

      // Gate opening: floor fades as 3D door mesh takes over visually
      if (gateAlpha.has(i)) {
        ratio *= gateAlpha.get(i);
      }

      const prev = seg._lastDamageRatio ?? 1.0;
      if (Math.abs(ratio - prev) < 0.005) continue;

      seg._lastDamageRatio = ratio;
      dirty = true;

      // Clear then fill with proportional alpha
      ctx2d.clearRect(i * pxPerSeg, 0, pxPerSeg, 4);
      if (ratio > 0.01) {
        ctx2d.globalAlpha = ratio;
        ctx2d.fillStyle = '#fff';
        ctx2d.fillRect(i * pxPerSeg, 0, pxPerSeg, 4);
        ctx2d.globalAlpha = 1;
      }
    }

    if (dirty) {
      this._damageTexture.needsUpdate = true;
    }
  }

  createSegmentEntity(index, type, image) {
    const entity = {
      id: `ring_${this.key}_${index}`,
      name: `Ring ${this.key} ${index}`,
      type: 'ring_segment',
      owner: this,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      angVel: 0,
      dead: false,
      isCollidable: true,
      isRingSegment: true,
      ringPlanetKey: this.key,
      ringSegmentType: type,
      ringSegmentIndex: index,
      noSplit: true,
      mass: RING_SEGMENT_MASS,
      friction: 1,
      visual: {
        spriteScale: HEX_SCALE,
        spriteRotation: 0
      },
      hp: 1,
      maxHp: 1
    };

    initHexBody(entity, image, null, false, null, CONFIG.collisionAlphaCutoff);
    if (!entity.hexGrid) {
      entity.dead = true;
      return entity;
    }

    // Set collision radius from actual hex dimensions (segment is ~800×2400 world units)
    const hw = (entity.hexGrid.srcWidth || 0) * HEX_SCALE * 0.5;
    const hh = (entity.hexGrid.srcHeight || 0) * HEX_SCALE * 0.5;
    entity.radius = Math.max(hw, hh);  // ~1200 units — used by collectNearbyRingDestructibles

    entity.hexGrid.meshDirty = true;
    entity.hexGrid.cacheDirty = false;
    entity.hexGrid.textureDirty = false;
    entity.hexGrid.ringSegment = true;
    entity.hexGrid.isSleeping = true;
    entity.hexGrid.sleepFrames = 9999;
    entity.hexGrid.wakeHoldFrames = 0;
    return entity;
  }

  _buildGateArcGeo(innerR, outerR, depth, startAngle, theta) {
    const segs = 32;
    const shape = new THREE.Shape();
    for (let i = 0; i <= segs; i++) {
      const a = startAngle + (theta * i) / segs;
      const px = Math.cos(a) * outerR, py = Math.sin(a) * outerR;
      i === 0 ? shape.moveTo(px, py) : shape.lineTo(px, py);
    }
    for (let i = segs; i >= 0; i--) {
      const a = startAngle + (theta * i) / segs;
      shape.lineTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelSegments: 1,
      bevelSize: 10, bevelThickness: 10, curveSegments: 1
    });
  }

  createMechanicalGate(startIndex) {
    const leftOuterSeg = this.segmentData[startIndex];
    const leftInnerSeg = this.segmentData[startIndex + 1];
    const rightInnerSeg = this.segmentData[startIndex + 2];
    const rightOuterSeg = this.segmentData[startIndex + 3];
    if (!leftOuterSeg || !leftInnerSeg || !rightInnerSeg || !rightOuterSeg) return;
    const leftOuter = leftOuterSeg.entity;
    const leftInner = leftInnerSeg.entity;
    const rightInner = rightInnerSeg.entity;
    const rightOuter = rightOuterSeg.entity;
    if (!leftOuter || !leftInner || !rightInner || !rightOuter) return;

    const centerBaseAngle = (leftInnerSeg.baseAngle + rightInnerSeg.baseAngle) * 0.5;
    let gateLightSprite = null;
    const glowTexture = getGateGlowTexture();
    if (glowTexture && Core3D.scene) {
      const gateLightMat = new THREE.SpriteMaterial({
        map: glowTexture, color: 0x66d9ff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending
      });
      gateLightSprite = new THREE.Sprite(gateLightMat);
      gateLightSprite.visible = false;
      gateLightSprite.renderOrder = 16;
      gateLightSprite.layers.set(2);
      Core3D.scene.add(gateLightSprite);
      this.gateLightSprites.push(gateLightSprite);
    }

    // --- 3D Gate Visuals ---
    const ringR = this.ringRadius;
    const halfH = CONFIG.segmentWorldHeight * 0.5;
    const innerR = ringR - halfH;
    const outerR = ringR + halfH;
    const depth = CONFIG.gateDepth;
    const leafAngle = 2 * this.angleStep;

    // Match ring floor (deckMat) so the gate looks like a piece of the ring
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x1b2431, emissive: 0x0d2030, emissiveIntensity: 0.22,
      roughness: 0.82, metalness: 0.48, side: THREE.DoubleSide
    });
    const railMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff, transparent: true, opacity: 0.45
    });

    // Left door arc
    const doorLGeo = this._buildGateArcGeo(innerR, outerR, depth, centerBaseAngle, leafAngle);
    doorLGeo.translate(0, 0, -depth * 0.3);
    const doorLMesh = new THREE.Mesh(doorLGeo, gateMat);
    // Left door edge rails
    for (const r of [innerR, outerR]) {
      const tGeo = new THREE.TorusGeometry(r, 10, 6, 32, leafAngle);
      tGeo.rotateZ(centerBaseAngle);
      const tMesh = new THREE.Mesh(tGeo, railMat.clone());
      tMesh.position.z = depth * 0.5 + 6;
      doorLMesh.add(tMesh);
    }

    // Right door arc
    const doorRGeo = this._buildGateArcGeo(innerR, outerR, depth, centerBaseAngle - leafAngle, leafAngle);
    doorRGeo.translate(0, 0, -depth * 0.3);
    const doorRMesh = new THREE.Mesh(doorRGeo, gateMat.clone());
    for (const r of [innerR, outerR]) {
      const tGeo = new THREE.TorusGeometry(r, 10, 6, 32, leafAngle);
      tGeo.rotateZ(centerBaseAngle - leafAngle);
      const tMesh = new THREE.Mesh(tGeo, railMat.clone());
      tMesh.position.z = depth * 0.5 + 6;
      doorRMesh.add(tMesh);
    }

    // Hinge on INNER edge at boundary angles
    const hingeLAngle = centerBaseAngle + leafAngle;
    const hingeLX = Math.cos(hingeLAngle) * innerR;
    const hingeLY = Math.sin(hingeLAngle) * innerR;

    const hingeRAngle = centerBaseAngle - leafAngle;
    const hingeRX = Math.cos(hingeRAngle) * innerR;
    const hingeRY = Math.sin(hingeRAngle) * innerR;

    // Left door: content → pivot → slide
    const doorLContent = new THREE.Group();
    doorLContent.add(doorLMesh);
    doorLContent.position.set(-hingeLX, -hingeLY, 0);

    const pivotL = new THREE.Group();
    pivotL.position.set(hingeLX, hingeLY, 0);
    pivotL.add(doorLContent);

    const slideL = new THREE.Group();
    slideL.add(pivotL);

    // Right door: content → pivot → slide
    const doorRContent = new THREE.Group();
    doorRContent.add(doorRMesh);
    doorRContent.position.set(-hingeRX, -hingeRY, 0);

    const pivotR = new THREE.Group();
    pivotR.position.set(hingeRX, hingeRY, 0);
    pivotR.add(doorRContent);

    const slideR = new THREE.Group();
    slideR.add(pivotR);

    // Lock (center seam) — attached to left door
    const lockMat3D = new THREE.MeshBasicMaterial({ color: 0xff003c });
    const lockGeo = new THREE.BoxGeometry(40, CONFIG.segmentWorldHeight + 30, depth + 30);
    const lockMesh3D = new THREE.Mesh(lockGeo, lockMat3D);
    lockMesh3D.position.set(
      Math.cos(centerBaseAngle) * ringR,
      Math.sin(centerBaseAngle) * ringR, 0
    );
    lockMesh3D.rotation.z = centerBaseAngle + Math.PI * 0.5;
    doorLContent.add(lockMesh3D);

    // Plasma shields (stationary at boundary angles)
    const shieldGeo = new THREE.PlaneGeometry(CONFIG.segmentWorldHeight, depth);
    const mkShieldMat = () => new THREE.MeshBasicMaterial({
      color: 0x00f3ff, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const shieldL3D = new THREE.Mesh(shieldGeo, mkShieldMat());
    shieldL3D.position.set(Math.cos(hingeLAngle) * ringR, Math.sin(hingeLAngle) * ringR, 0);
    shieldL3D.rotation.z = hingeLAngle;

    const shieldR3D = new THREE.Mesh(shieldGeo.clone(), mkShieldMat());
    shieldR3D.position.set(Math.cos(hingeRAngle) * ringR, Math.sin(hingeRAngle) * ringR, 0);
    shieldR3D.rotation.z = hingeRAngle;

    // Beacons (on outer edge, attached to doors)
    const beaconMat3D = new THREE.MeshBasicMaterial({ color: 0x110000 });
    const beaconGeo = new THREE.SphereGeometry(25, 10, 10);
    const beaconL3D = new THREE.Mesh(beaconGeo, beaconMat3D);
    beaconL3D.position.set(
      Math.cos(centerBaseAngle + leafAngle * 0.15) * outerR,
      Math.sin(centerBaseAngle + leafAngle * 0.15) * outerR,
      depth * 0.5 + 25
    );
    doorLContent.add(beaconL3D);

    const beaconMatR3D = beaconMat3D.clone();
    const beaconR3D = new THREE.Mesh(beaconGeo, beaconMatR3D);
    beaconR3D.position.set(
      Math.cos(centerBaseAngle - leafAngle * 0.15) * outerR,
      Math.sin(centerBaseAngle - leafAngle * 0.15) * outerR,
      depth * 0.5 + 25
    );
    doorRContent.add(beaconR3D);

    // Assemble gate group
    const gateVis = new THREE.Group();
    gateVis.name = `PlanetaryRingGate:${this.key}:${startIndex}`;
    gateVis.add(slideL);
    gateVis.add(slideR);
    gateVis.add(shieldL3D);
    gateVis.add(shieldR3D);
    gateVis.scale.set(1, -1, 1);

    this.buildings3D.add(gateVis);
    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(gateVis);

    this.gates.push({
      startIndex,
      baseAngle: centerBaseAngle,
      leftOuter, leftInner, rightInner, rightOuter,
      targetOpen: false,
      openAmount: 0,
      gateLightSprite,
      worldX: 0, worldY: 0,
      gate3D: {
        group: gateVis,
        slideL, slideR, pivotL, pivotR,
        lockMesh: lockMesh3D, lockMat: lockMat3D,
        shieldL: shieldL3D, shieldR: shieldR3D,
        beaconMatL: beaconMat3D, beaconMatR: beaconMatR3D,
        slideAngleL: hingeLAngle,
        slideAngleR: hingeRAngle,
        maxSlide: CONFIG.segmentWorldHeight + 60,
        maxRotation: Math.PI / 2
      }
    });
  }

  buildConstructionSlots(segmentCount) {
    const layout = getRingBandLayout();
    this.constructionSlots.length = 0;
    const effectiveWidth = CONFIG.segmentWorldWidth - CONFIG.overlap;
    const slotsCount = Math.floor(segmentCount / BUILD_GRID.stride);
    const groupArcLength = effectiveWidth * BUILD_GRID.stride;
    const safeWidth = groupArcLength * BUILD_GRID.slotWidthRatio;

    for (let i = 0; i < slotsCount; i++) {
      const centerSegIndex = Math.floor(i * BUILD_GRID.stride + BUILD_GRID.stride * 0.5);
      let hasGate = false;
      for (let k = 0; k < BUILD_GRID.stride; k++) {
        const idx = (i * BUILD_GRID.stride + k) % segmentCount;
        if (String(this.segmentTypes[idx] || '').startsWith('GATE')) {
          hasGate = true;
          break;
        }
      }
      if (hasGate) continue;
      const seg = this.segmentData[centerSegIndex % this.segmentData.length];
      if (!seg) continue;
      this.constructionSlots.push({
        index: i,
        baseAngle: seg.baseAngle,
        attachRadius: this.ringRadius - layout.innerBandCenterLocalY,
        width: safeWidth
      });
    }
  }

  updateFromPlanet(planet, dt, viewCamera = null) {
    if (!planet) return;
    this._shipRef = window.ship || null;
    const visualZ = getRingVisualZ(this.key);
    this.lastPlanetX = Number(planet.x) || 0;
    this.lastPlanetY = Number(planet.y) || 0;
    this.updateTick++;
    const camX = Number(viewCamera?.x);
    const camY = Number(viewCamera?.y);
    const camZoom = Math.max(0.01, Number(viewCamera?.zoom) || 1);
    const hasCameraCenter = Number.isFinite(camX) && Number.isFinite(camY);

    if (this.rotationSpeed !== 0) {
      this.currentRotation += this.rotationSpeed * dt;
    }

    // Position ring floor at planet center
    if (this.ringFloor) {
      this.ringFloor.position.set(this.lastPlanetX, -this.lastPlanetY, visualZ.floor);
      this.ringFloor.rotation.z = -this.currentRotation;
    }

    for (let i = 0; i < this.segmentData.length; i++) {
      const seg = this.segmentData[i];
      const worldAngle = seg.baseAngle + this.currentRotation;
      seg.worldAngle = worldAngle;

      const worldX = this.lastPlanetX + Math.cos(worldAngle) * this.ringRadius;
      const worldY = this.lastPlanetY + Math.sin(worldAngle) * this.ringRadius;
      const worldRot = worldAngle + Math.PI * 0.5;

      const entity = seg.entity;
      if (!entity || entity.dead) continue;

      entity.x = worldX;
      entity.y = worldY;
      entity.angle = worldRot;

      // Tangential surface velocity: v = ω × r (perpendicular to radial direction)
      // This lets the destructor collision system transfer surface movement to colliding objects
      const surfSpeed = this.rotationSpeed * this.ringRadius;
      entity.vx = -Math.sin(worldAngle) * surfSpeed;
      entity.vy =  Math.cos(worldAngle) * surfSpeed;
      entity.angVel = this.rotationSpeed;

      // Wake segments near ship so destructor collision loop (line 2968) doesn't skip them
      if (entity.hexGrid && this._shipRef) {
        const sx = this._shipRef.pos?.x ?? this._shipRef.x ?? 0;
        const sy = this._shipRef.pos?.y ?? this._shipRef.y ?? 0;
        const ddx = worldX - sx;
        const ddy = worldY - sy;
        const wakeThresh = 2500;
        if (ddx * ddx + ddy * ddy < wakeThresh * wakeThresh) {
          entity.hexGrid.isSleeping = false;
          entity.hexGrid.sleepFrames = 0;
        } else if (entity.hexGrid.wakeHoldFrames <= 0) {
          entity.hexGrid.isSleeping = true;
        }
      }

      if ((this.updateTick % 20) === 0 && entity.hexGrid) {
        const structural = getHexStructuralState(entity);
        if (structural && structural.total > 0 && structural.active <= 0) {
          entity.dead = true;
        }
      }
    }

    this.updateGates(dt);

    // Update damage alpha texture — gate openings every frame, structural damage every 20 ticks
    // (updateDamageAlpha has internal dirty-check so frequent calls are cheap)
    this.updateDamageAlpha();

    // --- AKTUALIZACJA BUDYNKÓW (z angle-based culling i LOD) ---
    // Oblicz kąt kamery względem planety (do culling per-cell)
    let cameraAngle = 0;
    let cameraDistance = Infinity;
    if (hasCameraCenter) {
        const relCX = camX - this.lastPlanetX;
        const relCY = camY - this.lastPlanetY;
        cameraAngle = Math.atan2(-relCY, relCX); // -Y bo game Y jest odwrócony
        cameraDistance = Math.hypot(relCX, relCY);
    }

    // Szerokość widocznego łuku zależy od zoom i dystansu
    // Przy zoom=1 i dystansie ~ringRadius, widać ~120° łuku
    const viewportWorldWidth = hasCameraCenter ? (window.innerWidth || 1920) / camZoom : 99999;
    const visibleArcHalf = hasCameraCenter
        ? Math.min(Math.PI, Math.max(0.4, viewportWorldWidth / (this.ringRadius * 1.2)))
        : Math.PI;

    // LOD: odległy ring = skip animacji dekoracji
    const lodDistanceSq = hasCameraCenter ? (cameraDistance * cameraDistance) : 0;
    const LOD_ANIM_DIST_SQ = (this.ringRadius * 3.5) * (this.ringRadius * 3.5);
    const skipAnimations = lodDistanceSq > LOD_ANIM_DIST_SQ;

    // Chunk arc half-width for culling (chunk covers CHUNK_ARC = PI/8 = 22.5°)
    const CHUNK_ARC_HALF = Math.PI / 16; // half of 22.5°

    for (const b of this.visualMeshes) {
        // Global infrastructure — always visible (GPU frustum culling handles it)
        if (b.isGlobalInfra) {
            b.mesh.visible = true;
            continue;
        }

        // Segment destruction check (for non-chunk entries)
        if (!b.isChunk && b.segmentIndex !== undefined) {
            const seg = this.segmentData[b.segmentIndex];
            if (!seg || !seg.entity || seg.entity.dead) {
                b.mesh.visible = false;
                continue;
            }
        }

        // Angle-based culling: chunks use wider arc, cells use tight arc
        if (hasCameraCenter && b.baseAngle !== undefined) {
            const worldAngle = b.baseAngle + this.currentRotation;
            let angleDiff = worldAngle - cameraAngle;
            angleDiff = angleDiff - Math.round(angleDiff / (Math.PI * 2)) * (Math.PI * 2);
            // Chunks are wider — add half chunk arc to the visible margin
            const margin = b.isChunk ? CHUNK_ARC_HALF + 0.15 : 0.15;
            if (Math.abs(angleDiff) > visibleArcHalf + margin) {
                b.mesh.visible = false;
                continue;
            }
        }

        b.mesh.visible = true;

        // Animate dynamic decorations (spinning toppers & adverts)
        // LOD: skip animacji gdy kamera daleko
        if (!skipAnimations && b.dynamicDecorations) {
          for (const dd of b.dynamicDecorations) {
            if (dd.mesh && dd.rotationSpeed) {
              dd.mesh.rotation.z += dd.rotationSpeed * dt * 60;
            }
            if (dd.update) {
              dd.update(dt);
            }
          }
        }
    }
  }

  updateGates(dt) {
    if (!this.gates.length) return;
    const visualZ = getRingVisualZ(this.key);
    const ship = (typeof window !== 'undefined') ? window.ship : null;
    const shipX = Number(ship?.pos?.x ?? ship?.x);
    const shipY = Number(ship?.pos?.y ?? ship?.y);
    const hasShip = Number.isFinite(shipX) && Number.isFinite(shipY);

    const dtClamped = Math.max(0, Number(dt) || 0);
    const openStep = dtClamped * CONFIG.doorAnimSpeed;

    for (const entry of this.gates) {
      if (!entry) continue;
      const centerWorldAngle = entry.baseAngle + this.currentRotation;
      const gateX = this.lastPlanetX + Math.cos(centerWorldAngle) * this.ringRadius;
      const gateY = this.lastPlanetY + Math.sin(centerWorldAngle) * this.ringRadius;
      entry.worldX = gateX;
      entry.worldY = gateY;
      const distToShip = hasShip ? Math.hypot(shipX - gateX, shipY - gateY) : Number.POSITIVE_INFINITY;

      const autoOpen = entry.targetOpen
        ? distToShip < CONFIG.gateCloseRadius
        : distToShip < CONFIG.gateOpenRadius;

      let shouldOpen = autoOpen;
      if (state.gateMode === 'open') shouldOpen = true;
      else if (state.gateMode === 'closed') shouldOpen = false;
      entry.targetOpen = shouldOpen;

      const target = shouldOpen ? 1 : 0;
      if (entry.openAmount < target) {
        entry.openAmount = Math.min(target, entry.openAmount + openStep);
      } else if (entry.openAmount > target) {
        entry.openAmount = Math.max(target, entry.openAmount - openStep);
      }

      const oa = entry.openAmount;

      // --- 5-Phase animation ---
      // Phase 1 (0.00-0.12): Alarm — lock pulses, no movement
      // Phase 2 (0.12-0.18): Unlock — lock changes color, shields activate
      // Phase 3 (0.18-0.55): Slide — doors slide radially outward
      // Phase 4 (0.55-0.60): Pause — mechanical stabilization
      // Phase 5 (0.60-1.00): Swing — doors rotate open on hinges
      let alarmProg = 0, lockProg = 0, slideProg = 0, swingProg = 0;
      if (oa < 0.12) {
        alarmProg = oa / 0.12;
      } else if (oa < 0.18) {
        alarmProg = 1; lockProg = (oa - 0.12) / 0.06;
      } else if (oa < 0.55) {
        alarmProg = 1; lockProg = 1; slideProg = (oa - 0.18) / 0.37;
      } else if (oa < 0.60) {
        alarmProg = 1; lockProg = 1; slideProg = 1;
      } else {
        alarmProg = 1; lockProg = 1; slideProg = 1;
        swingProg = Math.min(1, (oa - 0.60) / 0.40);
      }

      const easedSlide = easeInOutCubic(Math.min(1, slideProg));
      const easedSwing = easeInOutCubic(swingProg);

      const gateEntities = [entry.leftOuter, entry.leftInner, entry.rightInner, entry.rightOuter];
      // --- PRAWDZIWA FIZYKA BRAMY Z HEKSÓW ---
      const leafAngle = 2 * this.angleStep;
      const hingeLAngle = entry.baseAngle + leafAngle + this.currentRotation;
      const hingeRAngle = entry.baseAngle - leafAngle + this.currentRotation;

      const maxSlide = (entry.gate3D ? entry.gate3D.maxSlide : CONFIG.segmentWorldHeight + 60);
      const dLX = Math.cos(hingeLAngle) * easedSlide * maxSlide;
      const dLY = Math.sin(hingeLAngle) * easedSlide * maxSlide;
      const dRX = Math.cos(hingeRAngle) * easedSlide * maxSlide;
      const dRY = Math.sin(hingeRAngle) * easedSlide * maxSlide;

      const maxRot = (entry.gate3D ? entry.gate3D.maxRotation : Math.PI / 2);
      const swingRotL = easedSwing * maxRot;
      const swingRotR = -easedSwing * maxRot;

      const isMoving = oa > 0.01 && oa < 0.99;
      const dtSafe = dt > 0 ? dt : 0.016;

      const moveGateEntity = (entity, dx, dy, dRot) => {
        if (!entity || entity.dead) return;

        entity.isCollidable = true;
        entity.x += dx;
        entity.y += dy;
        entity.angle += dRot;

        if (isMoving && entity.hexGrid) {
          entity.hexGrid.isSleeping = false;
          entity.hexGrid.sleepFrames = 0;
          entity.vx = dx / dtSafe;
          entity.vy = dy / dtSafe;
        } else {
          entity.vx = 0;
          entity.vy = 0;
        }
      };

      moveGateEntity(entry.leftOuter, dLX, dLY, swingRotL);
      moveGateEntity(entry.leftInner, dLX, dLY, swingRotL);
      moveGateEntity(entry.rightInner, dRX, dRY, swingRotR);
      moveGateEntity(entry.rightOuter, dRX, dRY, swingRotR);

      // --- 3D visual animation ---
      const g3d = entry.gate3D;
      if (g3d) {
        // Position gate group at planet center (same as ringFloor)
        g3d.group.position.set(this.lastPlanetX, -this.lastPlanetY, visualZ.gate);
        g3d.group.rotation.z = -this.currentRotation;

        // Slide: translate radially outward along hinge angle direction
        const maxSlide = g3d.maxSlide;
        const dLX = Math.cos(g3d.slideAngleL);
        const dLY = Math.sin(g3d.slideAngleL);
        g3d.slideL.position.set(dLX * easedSlide * maxSlide, dLY * easedSlide * maxSlide, 0);

        const dRX = Math.cos(g3d.slideAngleR);
        const dRY = Math.sin(g3d.slideAngleR);
        g3d.slideR.position.set(dRX * easedSlide * maxSlide, dRY * easedSlide * maxSlide, 0);

        // Swing: rotate outward (away from gate center)
        g3d.pivotL.rotation.z = easedSwing * g3d.maxRotation * 1;
        g3d.pivotR.rotation.z = easedSwing * g3d.maxRotation * -1;

        // Lock color: red pulsing alarm → cyan unlock
        if (alarmProg > 0 && lockProg === 0) {
          const pulse = (Math.sin(performance.now() * 0.01) + 1) / 2;
          g3d.lockMat.color.setRGB(
            (0.5 + pulse * 1.5) * 1.0,
            (0.5 + pulse * 1.5) * 0.0,
            (0.5 + pulse * 1.5) * 0.24
          );
        } else {
          const t = easeInOutCubic(lockProg);
          g3d.lockMat.color.setRGB(1.0 * (1 - t), t * 0.95, 0.24 * (1 - t) + t * 1.0);
        }

        // Shields fade in during unlock
        g3d.shieldL.material.opacity = lockProg * 0.85;
        g3d.shieldR.material.opacity = lockProg * 0.85;

        // Beacons blink during movement
        const isMoving = oa > 0.01 && oa < 0.99;
        if (isMoving) {
          const blink = (performance.now() % 800) < 400;
          const hex = blink ? 0xff0000 : 0x110000;
          g3d.beaconMatL.color.setHex(hex);
          g3d.beaconMatR.color.setHex(hex);
        } else {
          g3d.beaconMatL.color.setHex(0x110000);
          g3d.beaconMatR.color.setHex(0x110000);
        }
      }

      // --- Gate light sprite ---
      const gateLightSprite = entry.gateLightSprite;
      if (gateLightSprite) {
        const openVis = Math.max(0, Math.min(1, (oa - 0.15) / 0.85));
        gateLightSprite.visible = openVis > 0.01;
        if (gateLightSprite.visible) {
          const baseScale = CONFIG.segmentWorldWidth * 2.4;
          gateLightSprite.position.set(gateX, -gateY, visualZ.gateLight);
          gateLightSprite.scale.set(
            baseScale * (0.35 + openVis * 0.5),
            baseScale * (0.45 + openVis * 0.9), 1
          );
          gateLightSprite.material.opacity = 0.04 + openVis * 0.16;
          if (Core3D.pushGodRayWorld && distToShip < (CONFIG.gateOpenRadius * 1.7)) {
            Core3D.pushGodRayWorld(gateX, -gateY, visualZ.gateLight,
              1200 + openVis * 800, 0.25 + openVis * 0.35, false);
          }
        }
      }

      // --- Structural death check for gate entities ---
      if ((this.updateTick % 20) === 0) {
        for (const entity of gateEntities) {
          if (!entity || !entity.hexGrid || entity.dead) continue;
          const structural = getHexStructuralState(entity);
          if (structural && structural.total > 0 && structural.active <= 0) {
            entity.dead = true;
            entity.isCollidable = false;
          }
        }
      }
    }
  }

  dispose() {
    for (const seg of this.segmentData) {
      if (seg?.entity) seg.entity.dead = true;
    }

    if (this.buildings3D && Core3D.scene) {
        Core3D.scene.remove(this.buildings3D);
    }

    this.segmentData.length = 0;
    this.segmentTypes.length = 0;
    for (const sprite of this.gateLightSprites) {
      if (!sprite) continue;
      if (sprite.parent) sprite.parent.remove(sprite);
      try { sprite.material?.dispose?.(); } catch { }
    }
    this.gateLightSprites.length = 0;
    // Cleanup gate 3D meshes
    for (const gate of this.gates) {
      const g3d = gate?.gate3D;
      if (!g3d) continue;
      g3d.group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      if (g3d.group.parent) g3d.group.parent.remove(g3d.group);
    }
    this.gates.length = 0;
    this.constructionSlots.length = 0;
    this.visualMeshes.length = 0;
    this.zoneGrid = null;
    this.ringFloor = null;
    // Cleanup damage alpha map
    if (this._damageTexture) {
      this._damageTexture.dispose();
      this._damageTexture = null;
    }
    this._damageCanvas = null;
    this._damageCtx = null;
  }
}

function buildPlanetMap(planets) {
  const map = new Map();
  if (!Array.isArray(planets)) return map;
  for (const planet of planets) {
    const key = normalizePlanetKey(planet);
    if (!key) continue;
    map.set(key, planet);
  }
  return map;
}

function syncRingSystems(planets) {
  const planetMap = buildPlanetMap(planets);
  const active = new Set();

  for (const key of RING_PLANETS) {
    const planet = planetMap.get(key);
    if (!planet) continue;
    active.add(key);
    if (!state.rings.has(key)) state.rings.set(key, new PlanetaryRing(planet, key));
  }

  for (const [key, ring] of state.rings) {
    if (active.has(key)) continue;
    ring.dispose();
    state.rings.delete(key);
  }

  return planetMap;
}

function rebuildEntityList() {
  state.entities.length = 0;
  for (const [, ring] of state.rings) {
    for (const seg of ring.segmentData) {
      if (!seg?.entity || seg.entity.dead) continue;
      if (!seg.entity.hexGrid) continue;
      state.entities.push(seg.entity);
    }
  }
}

function getSpatialKey(x, y) {
  const cellSize = CONFIG.queryCellSize;
  const cx = Math.floor((Number(x) || 0) / cellSize);
  const cy = Math.floor((Number(y) || 0) / cellSize);
  return `${cx},${cy}`;
}

function rebuildSpatialIndex() {
  state.queryCells.clear();
  for (const entity of state.entities) {
    const key = getSpatialKey(entity.x, entity.y);
    let cell = state.queryCells.get(key);
    if (!cell) {
      cell = [];
      state.queryCells.set(key, cell);
    }
    cell.push(entity);
  }
}

function queryPotentialTargets(x, y, radius = 0) {
  const cellSize = CONFIG.queryCellSize;
  const baseX = Math.floor((Number(x) || 0) / cellSize);
  const baseY = Math.floor((Number(y) || 0) / cellSize);
  const span = Math.max(1, Math.ceil((Number(radius) || 0) / cellSize) + 1);

  state.queryCount = 0;
  for (let ix = -span; ix <= span; ix++) {
    for (let iy = -span; iy <= span; iy++) {
      const key = `${baseX + ix},${baseY + iy}`;
      const cell = state.queryCells.get(key);
      if (!cell) continue;
      for (let i = 0; i < cell.length; i++) {
        state.queryResult[state.queryCount++] = cell[i];
      }
    }
  }
  return { buffer: state.queryResult, count: state.queryCount };
}

export function initPlanetaryRings3D(planets = []) {
  if (!Core3D.isInitialized) Core3D.init();

  // 1. Inicjujemy pierścienie od razu (nawet jako płaskie bryły zapasowe)
  disposePlanetaryRings3D();
  const planetMap = syncRingSystems(planets);
  for (const [key, ring] of state.rings) {
    const planet = planetMap.get(key);
    if (planet) ring.updateFromPlanet(planet, 0, null);
  }
  rebuildEntityList();
  rebuildSpatialIndex();

  // 2. Kiedy modele z SynthCity się pobiorą, robimy bezpieczny TWARDY RESET
  loadSynthCityAssets().then(() => {
    // disposePlanetaryRings3D usuwa wszystko, czyści pamięć i wyrejestrowuje ze sceny
    disposePlanetaryRings3D();

    // syncRingSystems odpala na nowo konstruktory, wpinając świeże, załadowane
    // budynki 3D prosto na warstwę Foreground w Core3D.scene
    const pm = syncRingSystems(planets);
    for (const [key, ring] of state.rings) {
      const p = pm.get(key);
      if (p) ring.updateFromPlanet(p, 0, null);
    }
    rebuildEntityList();
    rebuildSpatialIndex();
  }).catch(e => console.warn('[RingCity] Asset load warning:', e));

  return state.rings;
}

export function updatePlanetaryRings3D(dt, planets = [], viewCamera = null) {
  if (!Core3D.isInitialized) return;
  const planetMap = syncRingSystems(planets);
  const step = Number(dt) || 0;
  for (const [key, ring] of state.rings) {
    const planet = planetMap.get(key);
    if (!planet) continue;
    ring.updateFromPlanet(planet, step, viewCamera);
  }
  rebuildEntityList();
  rebuildSpatialIndex();
}

export function disposePlanetaryRings3D() {
  for (const [, ring] of state.rings) ring.dispose();
  state.rings.clear();
  state.entities.length = 0;
  state.queryCells.clear();
  state.queryResult.length = 0;
  state.queryCount = 0;
}

export function getPlanetaryRingSlots(planetKey) {
  const key = String(planetKey || '').toLowerCase();
  const ring = state.rings.get(key);
  if (!ring) return [];
  return ring.constructionSlots.map(slot => ({ ...slot }));
}

export function getPlanetaryRingEntities() {
  return state.entities;
}

/**
 * Ring barrier enforcement — pushes dynamic entities out of the ring wall.
 * This is a simple radial check that guarantees nothing passes through,
 * regardless of hex collision detection. Gates create openings.
 * Call this each physics step for entities near ring planets.
 */
export function enforceRingBarrier(entity) {
  return false;
}

export function getPotentialPlanetaryRingTargets(x, y, radius = 0) {
  return queryPotentialTargets(x, y, radius);
}

function normalizeGateMode(mode) {
  const key = String(mode || '').toLowerCase();
  if (key === 'open') return 'open';
  if (key === 'closed') return 'closed';
  return 'auto';
}

function refreshGateStateImmediately() {
  for (const [, ring] of state.rings) {
    ring.updateGates(0);
  }
}

export function setPlanetaryRingGateMode(mode = 'auto') {
  state.gateMode = normalizeGateMode(mode);
  refreshGateStateImmediately();
  return getPlanetaryGateControlState();
}

export function togglePlanetaryRingGates() {
  state.gateMode = state.gateMode === 'open' ? 'closed' : 'open';
  refreshGateStateImmediately();
  return getPlanetaryGateControlState();
}

export function getPlanetaryGateControlState() {
  let gateCount = 0;
  let openGateCount = 0;
  for (const [, ring] of state.rings) {
    for (const gate of ring.gates) {
      if (!gate) continue;
      gateCount++;
      if ((gate.openAmount || 0) > 0.95) openGateCount++;
    }
  }
  return {
    mode: state.gateMode,
    gateCount,
    openGateCount
  };
}

export function getPlanetaryRingDebug() {
  const rings = {};
  for (const [key, ring] of state.rings) {
    let aliveSegments = 0;
    for (const seg of ring.segmentData) {
      if (seg?.entity && !seg.entity.dead) aliveSegments++;
    }
    // Performance stats
    let visibleEntries = 0;
    let hiddenEntries = 0;
    let totalDecorations = 0;
    let drawCalls = 0;
    let chunkCount = 0;
    let globalInfraCount = 0;
    for (const vm of ring.visualMeshes) {
      if (vm.isChunk) chunkCount++;
      if (vm.isGlobalInfra) globalInfraCount++;
      if (vm.mesh.visible) {
        visibleEntries++;
        vm.mesh.traverse(c => { if (c.isMesh || c.isLineSegments) drawCalls++; });
      } else {
        hiddenEntries++;
      }
      if (vm.dynamicDecorations) totalDecorations += vm.dynamicDecorations.length;
    }

    rings[key] = {
      segmentCount: ring.segmentData.length,
      aliveSegments,
      gateCount: ring.gates.length,
      openGateCount: ring.gates.filter(gate => (gate?.openAmount || 0) > 0.95).length,
      slotCount: ring.constructionSlots.length,
      radius: ring.ringRadius,
      rotation: ring.currentRotation,
      layerLayout: getRingBandLayout(),
      // Performance (chunk-based system)
      totalVisualEntries: ring.visualMeshes.length,
      chunkCount,
      globalInfraCount,
      visibleEntries,
      hiddenEntries,
      culledPercent: ring.visualMeshes.length > 0 ? Math.round(hiddenEntries / ring.visualMeshes.length * 100) : 0,
      estimatedDrawCalls: drawCalls,
      totalDecorations,
      visualZ: getRingVisualZ(key)
    };
  }
  return {
    gateMode: state.gateMode,
    rings,
    entities: state.entities.length,
    spatialCells: state.queryCells.size
  };
}

export function rebuildRingCityCell(planetKey, cell) {
  const ring = state.rings.get(String(planetKey || '').toLowerCase());
  if (!ring) return;

  // Rebuild district (buildings) — chunk-aware: rebuilds entire chunk containing this cell
  rebuildDistrictForCell(cell, ring);

  // Rebuild ALL infrastructure globally (merges all cells into ~4 meshes)
  if (ring.zoneGrid) {
    rebuildAllInfrastructure(ring.zoneGrid, ring);
  }
}

export function getPlanetaryRing(planetKey) {
  return state.rings.get(normalizeRingKey(planetKey)) || null;
}

export function getPlanetaryRingVisualZ(planetKey) {
  return { ...getRingVisualZ(planetKey) };
}

export function setPlanetaryRingVisualZ(planetKey, patch = {}) {
  const ring = getPlanetaryRing(planetKey);
  const next = setRingVisualZ(planetKey, patch);
  if (ring?.ringFloor) ring.ringFloor.position.z = next.floor;
  if (ring?.gates) {
    for (const gate of ring.gates) {
      if (gate?.gate3D?.group?.position) gate.gate3D.group.position.z = next.gate;
      if (gate?.gateLightSprite?.position) gate.gateLightSprite.position.z = next.gateLight;
    }
  }
  return { ...next };
}

export function resetPlanetaryRingVisualZ(planetKey) {
  const ring = getPlanetaryRing(planetKey);
  const next = clearRingVisualZ(planetKey);
  if (ring?.ringFloor) ring.ringFloor.position.z = next.floor;
  if (ring?.gates) {
    for (const gate of ring.gates) {
      if (gate?.gate3D?.group?.position) gate.gate3D.group.position.z = next.gate;
      if (gate?.gateLightSprite?.position) gate.gateLightSprite.position.z = next.gateLight;
    }
  }
  return { ...next };
}

export function getPlanetaryRingObjects(planetKey) {
  const ring = getPlanetaryRing(planetKey);
  if (!ring) return null;
  return {
    ring,
    buildings3D: ring.buildings3D || null,
    ringFloor: ring.ringFloor || null,
    gates: Array.isArray(ring.gates) ? ring.gates.map((gate, index) => ({
      index,
      group: gate?.gate3D?.group || null,
      gateLightSprite: gate?.gateLightSprite || null
    })) : []
  };
}

if (typeof window !== 'undefined') {
  window.__planetaryRingsDebug = {
    status: () => getPlanetaryRingDebug(),
    slots: (planetKey) => getPlanetaryRingSlots(planetKey),
    entities: () => getPlanetaryRingEntities(),
    ring: (planetKey) => getPlanetaryRing(planetKey),
    objects: (planetKey) => getPlanetaryRingObjects(planetKey),
    visualZ: (planetKey) => getPlanetaryRingVisualZ(planetKey),
    setVisualZ: (planetKey, patch) => setPlanetaryRingVisualZ(planetKey, patch),
    resetVisualZ: (planetKey) => resetPlanetaryRingVisualZ(planetKey)
  };
  window.togglePlanetaryRingGates = togglePlanetaryRingGates;
  window.setPlanetaryRingGateMode = setPlanetaryRingGateMode;
  window.getPlanetaryGateControlState = getPlanetaryGateControlState;
}

