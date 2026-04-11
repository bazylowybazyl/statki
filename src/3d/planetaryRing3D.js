import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { initHexBody, getHexStructuralState } from '../game/destructor.js';
import { RingCityZoneGrid, setHoleAngles } from './ringCityZoneGrid.js';
import { loadSynthCityAssets } from './ringCityAssets.js';
import { buildAllDistricts, rebuildDistrictForCell } from './ringCityBuildings.js';
import { buildAllInfrastructure, createDistrictInfrastructure, rebuildAllInfrastructure } from './ringCityInfrastructure.js';
import { RingShipParking } from './ringShipParking.js';

const RING_PLANETS = new Set(['earth', 'mars']);

const CONFIG = Object.freeze({
  segmentWorldWidth: 800,
  segmentWorldHeight: 2400,
  overlap: 2,
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
  forceFieldOpenRadius: 3000,
  forceFieldCloseRadius: 3800,
  forceFieldAnimSpeed: 1.2
});

const DEFAULT_RING_VISUAL_Z = Object.freeze({
  floor: 0
});

const TEXTURE = Object.freeze({
  width: 216,
  height: 648,
  railHeight: 42
});

const BUILD_GRID = Object.freeze({
  stride: 3,
  floors: 5,
  floorHeight: 300,
  slotWidthRatio: 0.92
});

const HEX_SCALE_X = CONFIG.segmentWorldWidth / TEXTURE.width;

const RING_SEGMENT_MASS = 2500000;

// ============================================================
// NEW RING LAYOUT — 3 separate rings with gaps
// Multipliers are relative to planet radius (planet.r)
// ============================================================
const RING_LAYOUT = Object.freeze({
  station:    { innerMul: 0.0, outerMul: 1.0 },  // central station + infra
  gapInner:   { innerMul: 1.0, outerMul: 1.2 },  // buffer before inner ring
  inner:      { innerMul: 1.2, outerMul: 1.8 },  // residential + commercial
  gapSmall:   { innerMul: 1.8, outerMul: 1.9 },  // thin visual gap
  industrial: { innerMul: 1.9, outerMul: 2.4 },  // industrial zones
  gapParking: { innerMul: 2.4, outerMul: 3.3 },  // ship parking (~0.9R)
  military:   { innerMul: 3.3, outerMul: 3.8 }   // military zones (outer)
});

const COLLISION_FLOOR_LAYOUT = Object.freeze((() => {
  const floorStartMul = RING_LAYOUT.inner.innerMul;
  const floorEndMul = RING_LAYOUT.military.outerMul;
  const totalMul = Math.max(0.0001, floorEndMul - floorStartMul);
  const mapBand = (cfg) => ({
    start: (cfg.innerMul - floorStartMul) / totalMul,
    end: (cfg.outerMul - floorStartMul) / totalMul
  });
  return {
    floorStartMul,
    floorEndMul,
    inner: mapBand(RING_LAYOUT.inner),
    gapSmall: mapBand(RING_LAYOUT.gapSmall),
    industrial: mapBand(RING_LAYOUT.industrial),
    gapParking: mapBand(RING_LAYOUT.gapParking),
    military: mapBand(RING_LAYOUT.military)
  };
})());

function computeRingLayout(planetR) {
  const R = Math.max(2000, planetR || 2800);
  const band = (cfg) => ({ innerR: R * cfg.innerMul, outerR: R * cfg.outerMul });
  return {
    planetR: R,
    station:    band(RING_LAYOUT.station),
    inner:      band(RING_LAYOUT.inner),
    industrial: band(RING_LAYOUT.industrial),
    parking:    band(RING_LAYOUT.gapParking),
    military:   band(RING_LAYOUT.military),
    innerRadius:  R * RING_LAYOUT.inner.innerMul,     // innermost edge (for station proximity)
    outerRadius:  R * RING_LAYOUT.military.outerMul,  // outermost edge (for forceFields, LOD)
    // Center radii per-ring — handy for autostrada lane markers, parking center
    innerCenter:      R * (RING_LAYOUT.inner.innerMul      + RING_LAYOUT.inner.outerMul)      * 0.5,
    industrialCenter: R * (RING_LAYOUT.industrial.innerMul + RING_LAYOUT.industrial.outerMul) * 0.5,
    parkingCenter:    R * (RING_LAYOUT.gapParking.innerMul + RING_LAYOUT.gapParking.outerMul) * 0.5,
    militaryCenter:   R * (RING_LAYOUT.military.innerMul   + RING_LAYOUT.military.outerMul)   * 0.5
  };
}

function getRingBandLayout() {
  const toPxRange = (band) => {
    const top = Math.round(TEXTURE.height * (1 - band.end));
    const bottom = Math.round(TEXTURE.height * (1 - band.start));
    return [top, Math.max(top + 1, bottom)];
  };
  const [innerBandTopPx, innerBandBottomPx] = toPxRange(COLLISION_FLOOR_LAYOUT.inner);
  const [industrialBandTopPx, industrialBandBottomPx] = toPxRange(COLLISION_FLOOR_LAYOUT.industrial);
  const [militaryBandTopPx, militaryBandBottomPx] = toPxRange(COLLISION_FLOOR_LAYOUT.military);
  const [gapSmallTopPx, gapSmallBottomPx] = toPxRange(COLLISION_FLOOR_LAYOUT.gapSmall);
  const [gapParkingTopPx, gapParkingBottomPx] = toPxRange(COLLISION_FLOOR_LAYOUT.gapParking);
  return {
    innerBandTopPx,
    innerBandBottomPx,
    industrialBandTopPx,
    industrialBandBottomPx,
    militaryBandTopPx,
    militaryBandBottomPx,
    gapSmallTopPx,
    gapSmallBottomPx,
    gapParkingTopPx,
    gapParkingBottomPx
  };
}


const state = {
  rings: new Map(),
  entities: [],
  queryCells: new Map(),
  queryResult: [],
  queryCount: 0,
  visualZByKey: new Map()
};

function normalizeRingKey(planetKey) {
  return String(planetKey || '').toLowerCase();
}

function getRingVisualZ(planetKey) {
  const key = normalizeRingKey(planetKey);
  const override = state.visualZByKey.get(key);
  return {
    floor: Number.isFinite(Number(override?.floor)) ? Number(override.floor) : DEFAULT_RING_VISUAL_Z.floor
  };
}

function setRingVisualZ(planetKey, patch = {}) {
  const key = normalizeRingKey(planetKey);
  if (!key) return getRingVisualZ(key);
  const current = getRingVisualZ(key);
  const next = {
    floor: Number.isFinite(Number(patch.floor)) ? Number(patch.floor) : current.floor
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
  const paintBand = (top, bottom, colors, options = {}) => {
    const bandH = Math.max(1, bottom - top);
    fillBandGradient(ctx, top, bottom, colors[0], colors[1], colors[2]);
    const railH = Math.min(TEXTURE.railHeight, Math.max(6, Math.floor(bandH * 0.28)));
    drawBandRails(ctx, top, bottom, railH);
    if (options.grid) {
      ctx.fillStyle = options.grid;
      for (let i = 0; i < 30; i++) {
        const gx = 4 + ((i * 23) % Math.max(8, w - 8));
        const gy = top + 4 + ((i * 13) % Math.max(8, bandH - 8));
        ctx.fillRect(gx, gy, 2 + (i % 4), 2 + ((i * 2) % 3));
      }
    }
    if (options.decks) {
      ctx.fillStyle = options.decks.fill;
      const deckW = Math.max(18, Math.round(w * 0.28));
      const deckH = Math.max(10, Math.round(bandH * 0.42));
      for (let i = 0; i < 2; i++) {
        const dx = Math.round(w * 0.1 + i * w * 0.48);
        const dy = Math.round(top + bandH * 0.24);
        ctx.fillRect(dx, dy, deckW, deckH);
        ctx.strokeStyle = options.decks.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(dx, dy, deckW, deckH);
      }
    }
    if (options.bulkheads) {
      const defenseY = Math.round(top + bandH * 0.18);
      const defenseH = Math.max(10, Math.round(bandH * 0.64));
      ctx.fillStyle = 'rgba(26, 34, 48, 0.92)';
      ctx.fillRect(0, defenseY, w, defenseH);
      ctx.fillStyle = '#101724';
      for (let i = 1; i <= 3; i++) {
        const y = defenseY + (i * defenseH) / 4;
        ctx.fillRect(0, Math.round(y), w, 2);
      }
    }
  };

  paintBand(layout.innerBandTopPx, layout.innerBandBottomPx, ['#101722', '#1a2536', '#0d121b'], {
    grid: 'rgba(255,255,255,0.08)',
    decks: { fill: 'rgba(255,190,30,0.22)', stroke: 'rgba(200,160,20,0.72)' }
  });
  paintBand(layout.industrialBandTopPx, layout.industrialBandBottomPx, ['#0e1318', '#1d262d', '#11161d'], {
    grid: 'rgba(180,210,255,0.05)'
  });
  paintBand(layout.militaryBandTopPx, layout.militaryBandBottomPx, ['#0a0d14', '#1b2432', '#0d1119'], {
    bulkheads: true
  });
}

function getSegmentTextures() {
  if (textureCache) return textureCache;

  const wallDisplay = createCanvas(TEXTURE.width, TEXTURE.height);
  const wallCollision = createCanvas(TEXTURE.width, TEXTURE.height);
  if (!wallDisplay || !wallCollision) {
    textureCache = null;
    return null;
  }

  drawWallTexture(wallDisplay.getContext('2d'));

  const collisionCtx = wallCollision.getContext('2d');
  // Keep collision mask aligned with the display texture.
  // Ring hex geometry is generated from the collision image, so flipping only
  // the mask vertically makes the active shard bands diverge from the visual
  // floor bands and can "remove" a band from the zone it should sit under.
  collisionCtx.drawImage(wallDisplay, 0, 0);

  textureCache = Object.freeze({
    WALL_DISPLAY: wallDisplay,
    WALL_COLLISION: wallCollision
  });
  return textureCache;
}

function buildSegmentTypes(segmentCount) {
  const types = new Array(segmentCount).fill('WALL');
  const quarter = Math.floor(segmentCount / 4);
  const holeIndices = [0, quarter, quarter * 2, quarter * 3];
  for (const idx of holeIndices) {
    if (idx + 3 >= segmentCount) continue;
    types[idx] = 'HOLE';
    types[idx + 1] = 'HOLE';
    types[idx + 2] = 'HOLE';
    types[idx + 3] = 'HOLE';
  }
  return types;
}

class PlanetaryRing {
  constructor(planet, key) {
    this.key = key;
    // NEW: compute multi-ring layout (3 narrower rings with gaps)
    this.layout = computeRingLayout(Number(planet?.r) || 2800);
    // Outer radius of the whole populated city ring.
    this.ringRadius = this.layout.outerRadius;
    // Destructor floor spans all populated bands: inner + industrial + military.
    this.floorInnerRadius = this.layout.inner.innerR;
    this.floorOuterRadius = this.layout.military.outerR;
    this.segmentWorldHeight = Math.max(1, this.floorOuterRadius - this.floorInnerRadius);
    // Segment entities sit at the center of the full populated floor span.
    this.wallRadius = (this.floorInnerRadius + this.floorOuterRadius) * 0.5;
    this.currentRotation = 0;
    this.rotationSpeed = CONFIG.ringRotationSpeed;
    this.segmentData = [];
    this.segmentTypes = [];
    this.constructionSlots = [];
    this.forceFields = [];
    this.angleStep = 0;
    this.lastPlanetX = 0;
    this.lastPlanetY = 0;
    this.updateTick = 0;
    // Distance-gate hysteresis flag — true when entire ring root is hidden
    // because it's off-screen or too small. See updateFromPlanet().
    this._ringHidden = false;

    // --- BUDYNKI 3D NA WARSTWIE 2 (FOREGROUND) ---
    this.buildings3D = new THREE.Group();
    this.buildings3D.name = `PlanetaryRingRoot:${this.key}`;
    this.buildings3D.userData.fgCategory = 'buildings';
    if (Core3D.scene) {
        Core3D.scene.add(this.buildings3D);
        Core3D.enableForeground3D(this.buildings3D); // Na layer 1 ring przykrywał budynki, więc wracamy na pass FG.
    }
    this.visualMeshes = [];
    this.zoneGrid = new RingCityZoneGrid(this.layout);
    this.ringFloor = null; // 3D ring pedestal mesh group

    this.build();
    this.updateFromPlanet(planet, 0);
  }

  build() {
    const textures = getSegmentTextures();
    if (!textures) return;

    const effectiveWidth = CONFIG.segmentWorldWidth - CONFIG.overlap;
    const outerCoverageRadius = this.floorOuterRadius;
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

      if (type !== 'HOLE') {
        const image = textures.WALL_DISPLAY;
        const collisionImage = textures.WALL_COLLISION || image;
        const entity = this.createSegmentEntity(i, type, image, collisionImage);
        segment.entity = entity;
      }

      this.segmentData.push(segment);
    }

    // Sync hole center angles with zone grid so buildings avoid holes precisely
    const quarter = Math.floor(segmentCount / 4);
    const holeIndices = [0, quarter, quarter * 2, quarter * 3];
    const holeCenterAngles = holeIndices.map(idx => {
      // Center angle of the 4-segment hole group
      return (idx + 2) * this.angleStep;
    });
    setHoleAngles(holeCenterAngles);

    this.buildForceFields();
    this.buildConstructionSlots(segmentCount);
    this.buildRingPedestal();
    this.buildShipParking();
  }

  buildShipParking() {
    if (!this.ringFloor || !this.layout) return;
    const parkingSeed = ((this.layout.planetR || 1) * 7919 + (this.key?.length || 1) * 31) >>> 0;
    this.shipParking = new RingShipParking(this.layout);
    this.shipParking.generate({ seed: parkingSeed });
    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(this.shipParking.group);
    this.ringFloor.add(this.shipParking.group);
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

  buildRingPedestal() {
    const floorGroup = new THREE.Group();
    floorGroup.name = `PlanetaryRingFloor:${this.key}`;

    // Y-flip: game coords have Y-down, Three.js has Y-up.
    // Without scale.y = -1, rotation.z rotates the floor opposite to the physics direction.
    floorGroup.scale.set(1, -1, 1);

    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(floorGroup);
    this.buildings3D.add(floorGroup);
    this.ringFloor = floorGroup;
  }

  /** Update damage alpha texture based on segment structural state */
  updateDamageAlpha() {
    if (!this._damageCtx) return;
    const ctx2d = this._damageCtx;
    const pxPerSeg = this._damagePxPerSeg;
    let dirty = false;

    for (let i = 0; i < this.segmentData.length; i++) {
      const seg = this.segmentData[i];
      const entity = seg.entity;

      // Dead, missing, or HOLE → fully transparent
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

      const prev = seg._lastDamageRatio ?? 1.0;
      if (Math.abs(ratio - prev) < 0.005) continue;

      seg._lastDamageRatio = ratio;
      dirty = true;

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

  createSegmentEntity(index, type, image, collisionImage = image) {
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
        spriteScale: HEX_SCALE_X,
        spriteScaleX: HEX_SCALE_X,
        spriteScaleY: Math.max(0.0001, this.segmentWorldHeight / TEXTURE.height),
        spriteRotation: 0
      },
      hp: 1,
      maxHp: 1
    };

    initHexBody(entity, collisionImage, null, false, null, CONFIG.collisionAlphaCutoff);
    if (!entity.hexGrid) {
      entity.dead = true;
      return entity;
    }

    if (image && entity.hexGrid) {
      entity.hexGrid.armorImage = image;
      if (entity.hexGrid.cacheCanvas && entity.hexGrid.cacheCtx) {
        entity.hexGrid.cacheCtx.clearRect(0, 0, entity.hexGrid.cacheCanvas.width, entity.hexGrid.cacheCanvas.height);
        entity.hexGrid.cacheCtx.drawImage(image, 0, 0, entity.hexGrid.cacheCanvas.width, entity.hexGrid.cacheCanvas.height);
      }
    }

    // Set collision radius from actual hex dimensions (segment is ~800×2400 world units)
    const scaleX = Math.max(0.0001, Number(entity.visual?.spriteScaleX) || HEX_SCALE_X);
    const scaleY = Math.max(0.0001, Number(entity.visual?.spriteScaleY) || scaleX);
    const hw = (entity.hexGrid.srcWidth || 0) * scaleX * 0.5;
    const hh = (entity.hexGrid.srcHeight || 0) * scaleY * 0.5;
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

  // ── Force fields — indestructible energy barriers at ring holes ──────────────
  buildForceFields() {
    this.forceFields.length = 0;
    const quarter = Math.floor(this.segmentData.length / 4);
    const holeStarts = [0, quarter, quarter * 2, quarter * 3];
    const holeSize = 4; // 4 consecutive HOLE segments per opening

    for (const startIdx of holeStarts) {
      if (startIdx + holeSize - 1 >= this.segmentData.length) continue;
      // Verify all segments are holes
      let allHoles = true;
      for (let k = 0; k < holeSize; k++) {
        if (this.segmentTypes[startIdx + k] !== 'HOLE') { allHoles = false; break; }
      }
      if (!allHoles) continue;

      const rawStart = this.segmentData[startIdx].baseAngle;
      const rawEnd = this.segmentData[startIdx + holeSize - 1].baseAngle + this.angleStep;
      // Extend arc by half a segment on each side for seamless overlap with wall edges
      const overlap = this.angleStep * 0.5;
      const startAngle = rawStart - overlap;
      const endAngle = rawEnd + overlap;
      const arcAngle = endAngle - startAngle;
      const centerAngle = startAngle + arcAngle * 0.5;

      // Gate shields belong to the outer military ring only.
      // The city floor/destructor spans multiple bands, but the entry barrier
      // should only close the actual outer gate band instead of cutting through
      // inner/industrial slices.
      const innerR = this.layout.military.innerR;
      const outerR = this.layout.military.outerR;
      const gateRadius = (innerR + outerR) * 0.5;
      const segs = 32;

      const shape = new THREE.Shape();
      for (let i = 0; i <= segs; i++) {
        const a = startAngle + (arcAngle * i) / segs;
        const px = Math.cos(a) * outerR, py = Math.sin(a) * outerR;
        i === 0 ? shape.moveTo(px, py) : shape.lineTo(px, py);
      }
      for (let i = segs; i >= 0; i--) {
        const a = startAngle + (arcAngle * i) / segs;
        shape.lineTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
      }
      shape.closePath();

      const geo = new THREE.ShapeGeometry(shape);

      // Remap UVs: U = normalized angle along arc, V = normalized radius (inner→outer)
      const posAttr = geo.getAttribute('position');
      const uvAttr = geo.getAttribute('uv');
      for (let vi = 0; vi < posAttr.count; vi++) {
        const px = posAttr.getX(vi);
        const py = posAttr.getY(vi);
        let angle = Math.atan2(py, px);
        if (angle < 0) angle += Math.PI * 2;
        const u = Math.max(0, Math.min(1, (angle - startAngle) / arcAngle));
        const r = Math.hypot(px, py);
        const v = Math.max(0, Math.min(1, (r - innerR) / (outerR - innerR)));
        uvAttr.setXY(vi, u, v);
      }
      uvAttr.needsUpdate = true;

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uOpacity: { value: 0.6 },
          uTime: { value: 0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uOpacity;
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float scanLine = sin(vUv.y * 30.0 + uTime * 2.0) * 0.5 + 0.5;
            float scanLine2 = sin(vUv.x * 80.0 - uTime * 1.5) * 0.3 + 0.7;
            float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
            float edgeY = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
            float alpha = uOpacity * (0.35 + scanLine * 0.3) * edge * edgeY * scanLine2;
            vec3 col = mix(vec3(0.1, 0.4, 1.0), vec3(0.2, 0.7, 1.0), scanLine);
            gl_FragColor = vec4(col, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `PlanetaryRingForceField:${this.key}:${startIdx}`;
      mesh.position.z = 3;
      mesh.scale.set(1, -1, 1);
      mesh.frustumCulled = false;

      this.buildings3D.add(mesh);
      if (Core3D?.enableForeground3D) Core3D.enableForeground3D(mesh);

      this.forceFields.push({
        startIndex: startIdx,
        centerAngle,
        radius: gateRadius,
        mesh,
        targetOpacity: 0.6,
        currentOpacity: 0.6,
        isOpen: false
      });
    }
  }

  updateForceFields(dt) {
    if (!this.forceFields.length) return;

    // Defensive: if root group is hidden, force fields are invisible too.
    // Force field meshes have frustumCulled = false (line 740), so without
    // explicitly hiding them they'd still get submitted to the renderer.
    if (this.buildings3D && !this.buildings3D.visible) {
      for (const ff of this.forceFields) {
        if (ff?.mesh) ff.mesh.visible = false;
      }
      return;
    }

    const ship = (typeof window !== 'undefined') ? window.ship : null;
    const shipX = Number(ship?.pos?.x ?? ship?.x);
    const shipY = Number(ship?.pos?.y ?? ship?.y);
    const hasShip = Number.isFinite(shipX) && Number.isFinite(shipY);
    const dtClamped = Math.max(0, Number(dt) || 0);
    const animSpeed = CONFIG.forceFieldAnimSpeed;
    const now = performance.now() * 0.001;

    for (const ff of this.forceFields) {
      if (!ff?.mesh) continue;

      // Position at planet center (same as ringFloor)
      ff.mesh.position.set(this.lastPlanetX, -this.lastPlanetY, 3);
      ff.mesh.rotation.z = -this.currentRotation;

      // Distance check
      const worldAngle = ff.centerAngle + this.currentRotation;
      const ffRadius = Number(ff.radius) || this.layout.militaryCenter || this.wallRadius;
      const ffX = this.lastPlanetX + Math.cos(worldAngle) * ffRadius;
      const ffY = this.lastPlanetY + Math.sin(worldAngle) * ffRadius;
      const dist = hasShip ? Math.hypot(shipX - ffX, shipY - ffY) : Infinity;

      // Hysteresis open/close
      if (ff.isOpen) {
        ff.isOpen = dist < CONFIG.forceFieldCloseRadius;
      } else {
        ff.isOpen = dist < CONFIG.forceFieldOpenRadius;
      }

      ff.targetOpacity = ff.isOpen ? 0 : 0.6;

      // Smooth transition
      if (ff.currentOpacity < ff.targetOpacity) {
        ff.currentOpacity = Math.min(ff.targetOpacity, ff.currentOpacity + dtClamped * animSpeed);
      } else if (ff.currentOpacity > ff.targetOpacity) {
        ff.currentOpacity = Math.max(ff.targetOpacity, ff.currentOpacity - dtClamped * animSpeed);
      }

      ff.mesh.material.uniforms.uOpacity.value = ff.currentOpacity;
      ff.mesh.material.uniforms.uTime.value = now;
      ff.mesh.visible = ff.currentOpacity > 0.005;
    }
  }

  buildConstructionSlots(segmentCount) {
    this.constructionSlots.length = 0;
    const effectiveWidth = CONFIG.segmentWorldWidth - CONFIG.overlap;
    const slotsCount = Math.floor(segmentCount / BUILD_GRID.stride);
    const groupArcLength = effectiveWidth * BUILD_GRID.stride;
    const safeWidth = groupArcLength * BUILD_GRID.slotWidthRatio;

    for (let i = 0; i < slotsCount; i++) {
      const centerSegIndex = Math.floor(i * BUILD_GRID.stride + BUILD_GRID.stride * 0.5);
      let hasHole = false;
      for (let k = 0; k < BUILD_GRID.stride; k++) {
        const idx = (i * BUILD_GRID.stride + k) % segmentCount;
        if (this.segmentTypes[idx] === 'HOLE') {
          hasHole = true;
          break;
        }
      }
      if (hasHole) continue;
      const seg = this.segmentData[centerSegIndex % this.segmentData.length];
      if (!seg) continue;
      this.constructionSlots.push({
        index: i,
        baseAngle: seg.baseAngle,
        attachRadius: this.layout.innerCenter,
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

    // ============================================================
    // Ring root distance gate — early-out when ring is invisible.
    // Hides the entire `buildings3D` group (chunks, infrastructure,
    // ringFloor, force fields) and skips ALL per-frame CPU work
    // (segment loop, force field update, damage texture, visualMeshes
    // culling loop). This single check is the biggest perf win — at
    // full zoom-out the ring projects to ~40 px and contributes
    // hundreds of wasted draw calls + CPU work.
    // ============================================================
    if (hasCameraCenter && this.buildings3D) {
      const dxCam = this.lastPlanetX - camX;
      const dyCam = this.lastPlanetY - camY;
      // Pixel size of ring's outer extent (orthographic: world * zoom).
      const ringPixelRadius = this.ringRadius * camZoom;
      // Hysteresis prevents flicker at the threshold.
      const HIDE_PX = this._ringHidden ? 110 : 90;
      const ringTooSmall = ringPixelRadius < HIDE_PX;
      // Off-screen if planet center is outside (ringRadius + half-viewport).
      const halfViewportX = (window.innerWidth || 1920) * 0.5 / camZoom;
      const halfViewportY = (window.innerHeight || 1080) * 0.5 / camZoom;
      const ringOffScreen =
        Math.abs(dxCam) > this.ringRadius + halfViewportX + 200 ||
        Math.abs(dyCam) > this.ringRadius + halfViewportY + 200;

      const shouldHideRoot = ringTooSmall || ringOffScreen;
      if (this.buildings3D.visible !== !shouldHideRoot) {
        this.buildings3D.visible = !shouldHideRoot;
      }
      this._ringHidden = shouldHideRoot;

      if (shouldHideRoot) {
        // currentRotation already advanced above so segments will be
        // at correct world coords next time the ring becomes visible.
        return;
      }
    } else if (this.buildings3D && !this.buildings3D.visible) {
      // No camera info — be safe and show the ring.
      this.buildings3D.visible = true;
      this._ringHidden = false;
    }

    // Position ring floor at planet center
    if (this.ringFloor) {
      this.ringFloor.position.set(this.lastPlanetX, -this.lastPlanetY, visualZ.floor);
      this.ringFloor.rotation.z = -this.currentRotation;
    }

    // Per-segment update gating: full update (velocity/wake/structural)
    // only when the ship is within 1.5× ringRadius. Far away, we still
    // refresh world positions (cheap) so anything that queries entity
    // coords gets up-to-date values, but we skip the heavy work and
    // park hex grids to sleep so the destructor system skips them.
    const shipRef = this._shipRef;
    let shipNearRing = false;
    let shipX = 0, shipY = 0;
    if (shipRef) {
      shipX = shipRef.pos?.x ?? shipRef.x ?? 0;
      shipY = shipRef.pos?.y ?? shipRef.y ?? 0;
      const dShipSq = (shipX - this.lastPlanetX) * (shipX - this.lastPlanetX)
                    + (shipY - this.lastPlanetY) * (shipY - this.lastPlanetY);
      const nearThresh = this.ringRadius * 1.5;
      shipNearRing = dShipSq < nearThresh * nearThresh;
    }
    const surfSpeed = this.rotationSpeed * this.wallRadius;

    for (let i = 0; i < this.segmentData.length; i++) {
      const seg = this.segmentData[i];
      const worldAngle = seg.baseAngle + this.currentRotation;
      seg.worldAngle = worldAngle;

      const worldX = this.lastPlanetX + Math.cos(worldAngle) * this.wallRadius;
      const worldY = this.lastPlanetY + Math.sin(worldAngle) * this.wallRadius;
      const worldRot = worldAngle + Math.PI * 0.5;

      const entity = seg.entity;
      if (!entity || entity.dead) continue;

      entity.x = worldX;
      entity.y = worldY;
      entity.angle = worldRot;

      if (shipNearRing) {
        // Tangential surface velocity: v = ω × r (perpendicular to radial direction)
        // This lets the destructor collision system transfer surface movement to colliding objects
        entity.vx = -Math.sin(worldAngle) * surfSpeed;
        entity.vy =  Math.cos(worldAngle) * surfSpeed;
        entity.angVel = this.rotationSpeed;

        // Wake segments near ship so destructor collision loop (line 2968) doesn't skip them
        if (entity.hexGrid) {
          const ddx = worldX - shipX;
          const ddy = worldY - shipY;
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
      } else {
        // Ship far from this ring → park hex grid to sleep so destructor
        // collision pass skips it. Saves CPU in the broader physics loop.
        if (entity.hexGrid && entity.hexGrid.wakeHoldFrames <= 0) {
          entity.hexGrid.isSleeping = true;
        }
      }
    }

    this.updateForceFields(dt);

    // Update damage alpha texture — structural damage every 20 ticks
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
    // Każdy ring band ma własny promień centralny → liczymy łuk per-ring,
    // bo mniejszy promień = ten sam viewport pokrywa szerszy łuk kątowy.
    const viewportWorldWidth = hasCameraCenter ? (window.innerWidth || 1920) / camZoom : 99999;
    const computeArcHalf = (radius) => hasCameraCenter
        ? Math.min(Math.PI, Math.max(0.4, viewportWorldWidth / (radius * 1.2)))
        : Math.PI;
    const arcHalfByRing = {
        inner:      computeArcHalf(this.layout.innerCenter),
        industrial: computeArcHalf(this.layout.industrialCenter),
        military:   computeArcHalf(this.layout.militaryCenter)
    };
    const fallbackArcHalf = computeArcHalf(this.wallRadius);

    // LOD: dystans kamery od ringu → poziomy szczegółowości
    const lodDistanceSq = hasCameraCenter ? (cameraDistance * cameraDistance) : 0;
    const R = this.ringRadius;
    // LOD thresholds (squared for fast comparison)
    const LOD_DETAIL_SQ = (R * 2.5) * (R * 2.5);   // > 2.5R: hide DETAIL meshes (antennas, pads, edges)
    const LOD_MEDIUM_SQ = (R * 4.5) * (R * 4.5);   // > 4.5R: hide MEDIUM meshes (neon signs, chimneys)
    const LOD_HIDE_SQ   = (R * 8) * (R * 8);        // > 8R:   hide all districts
    const skipAnimations = lodDistanceSq > LOD_DETAIL_SQ;
    const hideAllDistricts = hasCameraCenter && lodDistanceSq > LOD_HIDE_SQ;

    // Determine current LOD level for chunk children
    // 0 = full detail, 1 = hide DETAIL, 2 = hide DETAIL+MEDIUM, 3 = hide all
    let lodLevel = 0;
    if (hasCameraCenter) {
      if (lodDistanceSq > LOD_HIDE_SQ) lodLevel = 3;
      else if (lodDistanceSq > LOD_MEDIUM_SQ) lodLevel = 2;
      else if (lodDistanceSq > LOD_DETAIL_SQ) lodLevel = 1;
    }

    for (const b of this.visualMeshes) {
        // Global infrastructure — 4 large merged meshes (floor/path/trace/overlay).
        // Even at extreme zoom-out the LOD_HIDE_SQ check should hide them.
        if (b.isGlobalInfra) {
            b.mesh.visible = !hideAllDistricts;
            continue;
        }

        // LOD: hide all districts when camera is very far away
        if (hideAllDistricts && b.isDistrict) {
            b.mesh.visible = false;
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

        // Angle-based culling — only for non-chunk legacy entries.
        // Chunks rely on Three.js built-in frustum culling (per merged mesh
        // bounding sphere), which is correct regardless of camera position
        // relative to the planet center. The previous angle math assumed the
        // camera looks at the ring from planet center; offset/zoomed cameras
        // produced false culls and the user saw bare zone overlay.
        if (hasCameraCenter && !b.isChunk && b.baseAngle !== undefined) {
            const worldAngle = b.baseAngle + this.currentRotation;
            let angleDiff = worldAngle - cameraAngle;
            angleDiff = angleDiff - Math.round(angleDiff / (Math.PI * 2)) * (Math.PI * 2);
            const arcHalf = (b.ringId && arcHalfByRing[b.ringId]) || fallbackArcHalf;
            if (Math.abs(angleDiff) > arcHalf + 0.15) {
                b.mesh.visible = false;
                continue;
            }
        }
        b.mesh.visible = true;

        // LOD: per-child visibility based on lodLevel tag
        if (b.isChunk && lodLevel > 0 && b.mesh.children) {
          for (const child of b.mesh.children) {
            const lod = child.userData.lodLevel;
            if (!lod) { child.visible = true; continue; }
            if (lod === 'DETAIL') child.visible = lodLevel < 1;
            else if (lod === 'MEDIUM') child.visible = lodLevel < 2;
            else child.visible = true; // CORE always visible
          }
        } else if (b.isChunk && b.mesh.children) {
          for (const child of b.mesh.children) child.visible = true;
        }

        // Animate dynamic decorations (spinning toppers & adverts)
        if (b.dynamicDecorations) {
          for (const dd of b.dynamicDecorations) {
            if (dd.mesh) dd.mesh.visible = !skipAnimations;
            if (!skipAnimations) {
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
    // Cleanup force field meshes
    for (const ff of this.forceFields) {
      if (!ff?.mesh) continue;
      if (ff.mesh.parent) ff.mesh.parent.remove(ff.mesh);
      if (ff.mesh.geometry) ff.mesh.geometry.dispose();
      if (ff.mesh.material) ff.mesh.material.dispose();
    }
    this.forceFields.length = 0;
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

let _lastEntityCountSig = -1;
let _spatialTick = 0;

function rebuildSpatialIndex(force = false) {
  // Throttle: rings rotate slowly so cell membership changes rarely.
  // Rebuild only when entity count changes (segment died) OR every 10 ticks.
  // Skips ~90% of per-frame index rebuilds with their associated allocations.
  const sig = state.entities.length;
  _spatialTick++;
  if (!force && sig === _lastEntityCountSig && (_spatialTick % 10) !== 0) {
    return;
  }
  _lastEntityCountSig = sig;

  // Reuse existing cell arrays (clear instead of realloc) — eliminates GC pressure.
  for (const cell of state.queryCells.values()) cell.length = 0;

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
  rebuildSpatialIndex(true);

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
    rebuildSpatialIndex(true);
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
 * Force fields at HOLE positions open when the player approaches.
 */
export function enforceRingBarrier(entity) {
  return false;
}

export function getPotentialPlanetaryRingTargets(x, y, radius = 0) {
  return queryPotentialTargets(x, y, radius);
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
      forceFieldCount: ring.forceFields.length,
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
  return { ...next };
}

export function resetPlanetaryRingVisualZ(planetKey) {
  const ring = getPlanetaryRing(planetKey);
  const next = clearRingVisualZ(planetKey);
  if (ring?.ringFloor) ring.ringFloor.position.z = next.floor;
  return { ...next };
}

export function getPlanetaryRingObjects(planetKey) {
  const ring = getPlanetaryRing(planetKey);
  if (!ring) return null;
  return {
    ring,
    buildings3D: ring.buildings3D || null,
    ringFloor: ring.ringFloor || null,
    forceFields: ring.forceFields.map((ff, index) => ({
      index,
      mesh: ff?.mesh || null
    }))
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
}

