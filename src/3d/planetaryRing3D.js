import { Core3D } from './core3d.js';
import { initHexBody, getHexStructuralState } from '../game/destructor.js';

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
  ringRotationSpeed: 0.0,
  queryCellSize: 3000,
  gateOpenRadius: 3000,
  gateCloseRadius: 3800,
  doorLeafWidthRatio: 0.58,
  doorClosedOffsetWorld: 70,
  doorSlideDistanceWorld: 260,
  doorAnimSpeed: 2.8
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

const state = {
  rings: new Map(),
  entities: [],
  queryCells: new Map(),
  queryResult: [],
  queryCount: 0,
  gateMode: 'auto'
};

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
    this.angleStep = 0;
    this.lastPlanetX = 0;
    this.lastPlanetY = 0;
    this.updateTick = 0;

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
    for (let i = 0; i < this.segmentData.length; i++) {
      if (this.segmentTypes[i] !== 'GATE_L_OUTER') continue;
      this.createMechanicalGate(i);
    }

    this.buildConstructionSlots(segmentCount);
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
      mass: 0,
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

    entity.hexGrid.meshDirty = true;
    entity.hexGrid.cacheDirty = false;
    entity.hexGrid.textureDirty = false;
    entity.hexGrid.ringSegment = true;
    return entity;
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
    this.gates.push({
      startIndex,
      baseAngle: centerBaseAngle,
      leftOuter,
      leftInner,
      rightInner,
      rightOuter,
      targetOpen: false,
      openAmount: 0
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

  updateFromPlanet(planet, dt) {
    if (!planet) return;
    this.lastPlanetX = Number(planet.x) || 0;
    this.lastPlanetY = Number(planet.y) || 0;
    this.updateTick++;

    if (this.rotationSpeed !== 0) {
      this.currentRotation += this.rotationSpeed * dt;
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
      entity.vx = 0;
      entity.vy = 0;
      entity.angVel = 0;

      if ((this.updateTick % 20) === 0 && entity.hexGrid) {
        const structural = getHexStructuralState(entity);
        if (structural && structural.total > 0 && structural.active <= 0) {
          entity.dead = true;
        }
      }
    }

    this.updateGates(dt);
  }

  updateGates(dt) {
    if (!this.gates.length) return;
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

      const innerFold = Math.min(1, entry.openAmount * 2.0);
      const outerFold = Math.max(0, Math.min(1, (entry.openAmount - 0.5) * 2.0));

      const leftOuterOffset = -1.5 - outerFold;
      const leftInnerOffset = (-0.5 - innerFold) - outerFold;
      const rightOuterOffset = 1.5 + outerFold;
      const rightInnerOffset = (0.5 + innerFold) + outerFold;

      const moduleStates = [
        { entity: entry.leftOuter, offset: leftOuterOffset },
        { entity: entry.leftInner, offset: leftInnerOffset },
        { entity: entry.rightInner, offset: rightInnerOffset },
        { entity: entry.rightOuter, offset: rightOuterOffset }
      ];

      const fullyOpen = entry.openAmount >= 0.98;
      for (const item of moduleStates) {
        const entity = item.entity;
        if (!entity || entity.dead) continue;
        const moduleAngle = centerWorldAngle + item.offset * this.angleStep;
        entity.x = this.lastPlanetX + Math.cos(moduleAngle) * this.ringRadius;
        entity.y = this.lastPlanetY + Math.sin(moduleAngle) * this.ringRadius;
        entity.angle = moduleAngle + Math.PI * 0.5;
        entity.vx = 0;
        entity.vy = 0;
        entity.angVel = 0;
        entity.isCollidable = !fullyOpen;
      }

      if ((this.updateTick % 20) === 0) {
        for (const item of moduleStates) {
          const entity = item.entity;
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
    this.segmentData.length = 0;
    this.segmentTypes.length = 0;
    this.gates.length = 0;
    this.constructionSlots.length = 0;
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
  disposePlanetaryRings3D();
  const planetMap = syncRingSystems(planets);
  for (const [key, ring] of state.rings) {
    const planet = planetMap.get(key);
    if (!planet) continue;
    ring.updateFromPlanet(planet, 0);
  }
  rebuildEntityList();
  rebuildSpatialIndex();
  return state.rings;
}

export function updatePlanetaryRings3D(dt, planets = []) {
  if (!Core3D.isInitialized) return;
  const planetMap = syncRingSystems(planets);
  const step = Number(dt) || 0;
  for (const [key, ring] of state.rings) {
    const planet = planetMap.get(key);
    if (!planet) continue;
    ring.updateFromPlanet(planet, step);
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
    rings[key] = {
      segmentCount: ring.segmentData.length,
      aliveSegments,
      gateCount: ring.gates.length,
      openGateCount: ring.gates.filter(gate => (gate?.openAmount || 0) > 0.95).length,
      slotCount: ring.constructionSlots.length,
      radius: ring.ringRadius,
      rotation: ring.currentRotation,
      layerLayout: getRingBandLayout()
    };
  }
  return {
    gateMode: state.gateMode,
    rings,
    entities: state.entities.length,
    spatialCells: state.queryCells.size
  };
}

if (typeof window !== 'undefined') {
  window.__planetaryRingsDebug = {
    status: () => getPlanetaryRingDebug(),
    slots: (planetKey) => getPlanetaryRingSlots(planetKey),
    entities: () => getPlanetaryRingEntities()
  };
  window.togglePlanetaryRingGates = togglePlanetaryRingGates;
  window.setPlanetaryRingGateMode = setPlanetaryRingGateMode;
  window.getPlanetaryGateControlState = getPlanetaryGateControlState;
}
