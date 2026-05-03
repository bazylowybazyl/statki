import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { initHexBody, getHexStructuralState } from '../game/destructor.js';
import { RingCityZoneGrid, setHoleAngles, isGateAngle } from './ringCityZoneGrid.js';
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
  ringRotationSpeed: 0.00,
  queryCellSize: 3000,
  forceFieldOpenRadius: 3000,
  forceFieldCloseRadius: 3800,
  forceFieldAnimSpeed: 1.2,
  visualCullMargin: 900,
  segmentActiveMargin: 3200
});

const DEFAULT_RING_VISUAL_Z = Object.freeze({
  floor: 0
});

const TEXTURE = Object.freeze({
  width: 216,
  height: 648,
  railHeight: 42
});

const FLOOR_DAMAGE = Object.freeze({
  pxPerSegment: 18,
  height: 72
});

const FLOOR_THEME = Object.freeze({
  inner:      { color: 0x111923, emissive: 0x0b5f7a, line: '#27d7ff' },
  industrial: { color: 0x151610, emissive: 0x665400, line: '#fcee0a' },
  military:   { color: 0x130f15, emissive: 0x6a001d, line: '#ff2b55' }
});

const RING_EDGE = Object.freeze({
  railLaneWidth: 220,
  railWallGap: 24,
  railReserve: 380,
  railOuterMargin: 20,
  wallSetback: 28,
  gateGapPadRatio: 0.18,
  gateReturnWallWidth: 128,
  gateReturnWallSetback: 96,
  gateRailTurnLength: 460,
  gateRailSideWidth: 150,
  wallThickness: 88,
  railBeamWidth: 24,
  railBeamHeight: 34,
  wallHeight: 420,
  innerWallHeight: 180,
  innerWallThickness: 54,
  billboardWidth: 620,
  billboardHeight: 170,
  billboardBottom: 92
});

const BUILD_GRID = Object.freeze({
  stride: 3,
  floors: 5,
  floorHeight: 300,
  slotWidthRatio: 0.92
});

const RING_HEX_WORLD_SCALE = CONFIG.segmentWorldWidth / TEXTURE.width;
const RING_FULL_ARC = Math.PI * 2;

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

const RING_SEGMENT_BANDS = Object.freeze(['inner', 'industrial', 'military']);

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

function createBuildableRingLayout(layout) {
  if (!layout) return layout;
  const cloneBand = (band) => {
    if (!band) return band;
    const depth = Math.max(1, band.outerR - band.innerR);
    const reserve = Math.min(RING_EDGE.railReserve, depth * 0.42);
    return {
      innerR: band.innerR,
      outerR: Math.max(band.innerR + depth * 0.35, band.outerR - reserve)
    };
  };
  const inner = cloneBand(layout.inner);
  const industrial = cloneBand(layout.industrial);
  const military = cloneBand(layout.military);
  return {
    ...layout,
    inner,
    industrial,
    military,
    innerRadius: inner?.innerR ?? layout.innerRadius,
    outerRadius: military?.outerR ?? layout.outerRadius,
    innerCenter: inner ? (inner.innerR + inner.outerR) * 0.5 : layout.innerCenter,
    industrialCenter: industrial ? (industrial.innerR + industrial.outerR) * 0.5 : layout.industrialCenter,
    militaryCenter: military ? (military.innerR + military.outerR) * 0.5 : layout.militaryCenter
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

function getBandTextureRangePx(bandId) {
  const layout = getRingBandLayout();
  if (bandId === 'inner') return [layout.innerBandTopPx, layout.innerBandBottomPx];
  if (bandId === 'industrial') return [layout.industrialBandTopPx, layout.industrialBandBottomPx];
  if (bandId === 'military') return [layout.militaryBandTopPx, layout.militaryBandBottomPx];
  return [0, TEXTURE.height];
}

function normalizeArcAngle(angle) {
  let next = Number(angle) % RING_FULL_ARC;
  if (next < 0) next += RING_FULL_ARC;
  return next;
}

function createBufferedGeometry(positions, uvs) {
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function pushQuad(positions, uvs, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, uv) {
  positions.push(
    ax, ay, az,
    bx, by, bz,
    cx, cy, cz,
    ax, ay, az,
    cx, cy, cz,
    dx, dy, dz
  );
  const q = uv || [0, 0, 1, 0, 1, 1, 0, 1];
  uvs.push(
    q[0], q[1],
    q[2], q[3],
    q[4], q[5],
    q[0], q[1],
    q[4], q[5],
    q[6], q[7]
  );
}

function getArcStepCount(innerRadius, outerRadius, startAngle, endAngle) {
  const span = Math.max(0, endAngle - startAngle);
  const radius = Math.max(1, (Math.abs(innerRadius) + Math.abs(outerRadius)) * 0.5);
  const byAngle = Math.ceil((span / RING_FULL_ARC) * 384);
  const byLength = Math.ceil((span * radius) / 180);
  return Math.max(1, Math.min(512, Math.max(byAngle, byLength)));
}

export function buildRingSolidArcRanges(segmentData, angleStep, gapPadAngle = 0) {
  const segments = Array.isArray(segmentData) ? segmentData : [];
  const count = segments.length;
  const step = Number(angleStep) || 0;
  if (!count || step <= 0) return [];

  const isSolid = (seg) => seg && seg.type !== 'HOLE';
  const hasSolid = segments.some(isSolid);
  if (!hasSolid) return [];
  if (segments.every(isSolid)) return [{ start: 0, end: RING_FULL_ARC }];

  const firstHole = segments.findIndex(seg => !isSolid(seg));
  const startIndex = (firstHole + 1) % count;
  const ranges = [];
  let runStart = null;
  let runEnd = null;

  for (let offset = 0; offset < count; offset++) {
    const index = (startIndex + offset) % count;
    const seg = segments[index];
    const wrap = index <= firstHole ? 1 : 0;
    const fallbackBase = (index + 0.5) * step;
    const center = (Number.isFinite(seg?.baseAngle) ? seg.baseAngle : fallbackBase) + wrap * RING_FULL_ARC;
    const segStart = center - step * 0.5;
    const segEnd = center + step * 0.5;

    if (isSolid(seg)) {
      if (runStart === null) runStart = segStart;
      runEnd = segEnd;
    } else if (runStart !== null) {
      const start = runStart + gapPadAngle;
      const end = runEnd - gapPadAngle;
      if (end > start) ranges.push({ start, end });
      runStart = null;
      runEnd = null;
    }
  }

  if (runStart !== null) {
    const start = runStart + gapPadAngle;
    const end = runEnd - gapPadAngle;
    if (end > start) ranges.push({ start, end });
  }

  return ranges;
}

function angleInArcRanges(angle, ranges, margin = 0) {
  if (!Array.isArray(ranges) || !ranges.length) return false;
  const a = normalizeArcAngle(angle);
  const candidates = [a, a + RING_FULL_ARC, a - RING_FULL_ARC];
  for (const range of ranges) {
    const start = Number(range?.start) + margin;
    const end = Number(range?.end) - margin;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (candidates.some(candidate => candidate >= start && candidate <= end)) return true;
  }
  return false;
}

export function buildRingGateReturnEndpointAngles(ranges) {
  const result = [];
  for (const range of ranges || []) {
    if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.end <= range.start) continue;
    result.push(range.start, range.end);
  }
  return result;
}

export function computeGateReturnWallOuterRadius(wallInner, wallOuter, innerWallOuter, setback) {
  const safeWallInner = Number(wallInner) || 0;
  const safeWallOuter = Math.max(safeWallInner + 1, Number(wallOuter) || 0);
  const safeInnerWallOuter = Number(innerWallOuter) || safeWallInner;
  const safeSetback = Math.max(0, Number(setback) || 0);
  const minOuter = Math.min(
    safeWallOuter,
    Math.max(safeWallInner + 20, safeInnerWallOuter + 24)
  );
  return Math.max(minOuter, safeWallOuter - safeSetback);
}

export function shouldBuildDockRailsForBand(bandId) {
  return bandId === 'industrial' || bandId === 'military';
}

export function buildGateRailTurnArcRanges(ranges, turnAngle) {
  const safeTurn = Math.max(0, Number(turnAngle) || 0);
  if (!safeTurn) return [];
  const result = [];
  for (const range of ranges || []) {
    if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.end <= range.start) continue;
    result.push(
      { start: range.start - safeTurn, end: range.start },
      { start: range.end, end: range.end + safeTurn }
    );
  }
  return result;
}

function buildGateRailSideAngles(ranges, turnAngle) {
  const safeTurn = Math.max(0, Number(turnAngle) || 0);
  if (!safeTurn) return [];
  const result = [];
  for (const range of ranges || []) {
    if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.end <= range.start) continue;
    result.push(range.start - safeTurn, range.end + safeTurn);
  }
  return result;
}

function createRingBandGeometry(innerRadius, outerRadius, z = 0) {
  const steps = 384;
  const positions = [];
  const uvs = [];
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const a0 = t0 * Math.PI * 2;
    const a1 = t1 * Math.PI * 2;
    const x00 = Math.cos(a0) * innerRadius;
    const y00 = Math.sin(a0) * innerRadius;
    const x01 = Math.cos(a1) * innerRadius;
    const y01 = Math.sin(a1) * innerRadius;
    const x10 = Math.cos(a0) * outerRadius;
    const y10 = Math.sin(a0) * outerRadius;
    const x11 = Math.cos(a1) * outerRadius;
    const y11 = Math.sin(a1) * outerRadius;

    positions.push(
      x00, y00, z,
      x10, y10, z,
      x11, y11, z,
      x00, y00, z,
      x11, y11, z,
      x01, y01, z
    );
    uvs.push(
      t0, 0,
      t0, 1,
      t1, 1,
      t0, 0,
      t1, 1,
      t1, 0
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function createRingAnnularBoxGeometry(innerRadius, outerRadius, height, z = 0) {
  const steps = 384;
  const positions = [];
  const uvs = [];
  const inner = Math.max(1, Math.min(innerRadius, outerRadius));
  const outer = Math.max(inner + 1, Math.max(innerRadius, outerRadius));
  const z0 = z;
  const z1 = z + height;

  const pushQuad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, uv) => {
    positions.push(
      ax, ay, az,
      bx, by, bz,
      cx, cy, cz,
      ax, ay, az,
      cx, cy, cz,
      dx, dy, dz
    );
    const q = uv || [0, 0, 1, 0, 1, 1, 0, 1];
    uvs.push(
      q[0], q[1],
      q[2], q[3],
      q[4], q[5],
      q[0], q[1],
      q[4], q[5],
      q[6], q[7]
    );
  };

  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const a0 = t0 * Math.PI * 2;
    const a1 = t1 * Math.PI * 2;
    const io0x = Math.cos(a0) * inner;
    const io0y = Math.sin(a0) * inner;
    const io1x = Math.cos(a1) * inner;
    const io1y = Math.sin(a1) * inner;
    const oo0x = Math.cos(a0) * outer;
    const oo0y = Math.sin(a0) * outer;
    const oo1x = Math.cos(a1) * outer;
    const oo1y = Math.sin(a1) * outer;

    pushQuad(oo0x, oo0y, z0, oo1x, oo1y, z0, oo1x, oo1y, z1, oo0x, oo0y, z1, [t0, 0, t1, 0, t1, 1, t0, 1]); // outer face
    pushQuad(io1x, io1y, z0, io0x, io0y, z0, io0x, io0y, z1, io1x, io1y, z1, [t1, 0, t0, 0, t0, 1, t1, 1]); // inner face
    pushQuad(io0x, io0y, z1, oo0x, oo0y, z1, oo1x, oo1y, z1, io1x, io1y, z1, [t0, 0, t0, 1, t1, 1, t1, 0]); // top cap
    pushQuad(io1x, io1y, z0, oo1x, oo1y, z0, oo0x, oo0y, z0, io0x, io0y, z0, [t1, 0, t1, 1, t0, 1, t0, 0]); // bottom cap
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function appendRingBandArc(positions, uvs, innerRadius, outerRadius, startAngle, endAngle, z = 0) {
  const inner = Math.max(1, Math.min(innerRadius, outerRadius));
  const outer = Math.max(inner + 1, Math.max(innerRadius, outerRadius));
  const steps = getArcStepCount(inner, outer, startAngle, endAngle);

  for (let i = 0; i < steps; i++) {
    const a0 = startAngle + ((endAngle - startAngle) * i) / steps;
    const a1 = startAngle + ((endAngle - startAngle) * (i + 1)) / steps;
    const u0 = a0 / RING_FULL_ARC;
    const u1 = a1 / RING_FULL_ARC;
    const x00 = Math.cos(a0) * inner;
    const y00 = Math.sin(a0) * inner;
    const x01 = Math.cos(a1) * inner;
    const y01 = Math.sin(a1) * inner;
    const x10 = Math.cos(a0) * outer;
    const y10 = Math.sin(a0) * outer;
    const x11 = Math.cos(a1) * outer;
    const y11 = Math.sin(a1) * outer;

    positions.push(
      x00, y00, z,
      x10, y10, z,
      x11, y11, z,
      x00, y00, z,
      x11, y11, z,
      x01, y01, z
    );
    uvs.push(
      u0, 0,
      u0, 1,
      u1, 1,
      u0, 0,
      u1, 1,
      u1, 0
    );
  }
}

function createRingBandRangesGeometry(innerRadius, outerRadius, ranges, z = 0) {
  const positions = [];
  const uvs = [];
  for (const range of ranges || []) {
    if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.end <= range.start) continue;
    appendRingBandArc(positions, uvs, innerRadius, outerRadius, range.start, range.end, z);
  }
  return createBufferedGeometry(positions, uvs);
}

function appendRingAnnularBoxArc(positions, uvs, innerRadius, outerRadius, height, z, startAngle, endAngle) {
  const inner = Math.max(1, Math.min(innerRadius, outerRadius));
  const outer = Math.max(inner + 1, Math.max(innerRadius, outerRadius));
  const z0 = z;
  const z1 = z + height;
  const steps = getArcStepCount(inner, outer, startAngle, endAngle);

  for (let i = 0; i < steps; i++) {
    const a0 = startAngle + ((endAngle - startAngle) * i) / steps;
    const a1 = startAngle + ((endAngle - startAngle) * (i + 1)) / steps;
    const u0 = a0 / RING_FULL_ARC;
    const u1 = a1 / RING_FULL_ARC;
    const io0x = Math.cos(a0) * inner;
    const io0y = Math.sin(a0) * inner;
    const io1x = Math.cos(a1) * inner;
    const io1y = Math.sin(a1) * inner;
    const oo0x = Math.cos(a0) * outer;
    const oo0y = Math.sin(a0) * outer;
    const oo1x = Math.cos(a1) * outer;
    const oo1y = Math.sin(a1) * outer;

    pushQuad(positions, uvs, oo0x, oo0y, z0, oo1x, oo1y, z0, oo1x, oo1y, z1, oo0x, oo0y, z1, [u0, 0, u1, 0, u1, 1, u0, 1]);
    pushQuad(positions, uvs, io1x, io1y, z0, io0x, io0y, z0, io0x, io0y, z1, io1x, io1y, z1, [u1, 0, u0, 0, u0, 1, u1, 1]);
    pushQuad(positions, uvs, io0x, io0y, z1, oo0x, oo0y, z1, oo1x, oo1y, z1, io1x, io1y, z1, [u0, 0, u0, 1, u1, 1, u1, 0]);
    pushQuad(positions, uvs, io1x, io1y, z0, oo1x, oo1y, z0, oo0x, oo0y, z0, io0x, io0y, z0, [u1, 0, u1, 1, u0, 1, u0, 0]);
  }

  for (const angle of [startAngle, endAngle]) {
    const u = angle / RING_FULL_ARC;
    const ix = Math.cos(angle) * inner;
    const iy = Math.sin(angle) * inner;
    const ox = Math.cos(angle) * outer;
    const oy = Math.sin(angle) * outer;
    pushQuad(positions, uvs, ix, iy, z0, ox, oy, z0, ox, oy, z1, ix, iy, z1, [u, 0, u, 1, u, 1, u, 0]);
  }
}

function createRingAnnularBoxRangesGeometry(innerRadius, outerRadius, height, z, ranges) {
  const positions = [];
  const uvs = [];
  for (const range of ranges || []) {
    if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.end <= range.start) continue;
    appendRingAnnularBoxArc(positions, uvs, innerRadius, outerRadius, height, z, range.start, range.end);
  }
  return createBufferedGeometry(positions, uvs);
}

function appendTri(positions, uvs, ax, ay, az, bx, by, bz, cx, cy, cz, uv) {
  positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  const q = uv || [0, 0, 1, 0, 0.5, 1];
  uvs.push(q[0], q[1], q[2], q[3], q[4], q[5]);
}

function appendRadialCapsuleBox(positions, uvs, angle, innerRadius, outerRadius, width, height, z = 0, capSegments = 10) {
  const inner = Math.max(1, Math.min(innerRadius, outerRadius));
  const outer = Math.max(inner + 1, Math.max(innerRadius, outerRadius));
  const halfWidth = Math.max(1, width * 0.5);
  const z0 = z;
  const z1 = z + Math.max(0.01, height);
  const radialX = Math.cos(angle);
  const radialY = Math.sin(angle);
  const tangentX = -radialY;
  const tangentY = radialX;
  const localPoints = [];
  const segs = Math.max(4, Math.floor(capSegments));

  for (let i = 0; i <= segs; i++) {
    const theta = Math.PI * 0.5 - (Math.PI * i) / segs;
    localPoints.push({
      r: outer + Math.cos(theta) * halfWidth,
      t: Math.sin(theta) * halfWidth
    });
  }
  for (let i = 0; i <= segs; i++) {
    const theta = -Math.PI * 0.5 - (Math.PI * i) / segs;
    localPoints.push({
      r: inner + Math.cos(theta) * halfWidth,
      t: Math.sin(theta) * halfWidth
    });
  }

  const points = localPoints.map(p => ({
    x: radialX * p.r + tangentX * p.t,
    y: radialY * p.r + tangentY * p.t
  }));
  const centerR = (inner + outer) * 0.5;
  const centerX = radialX * centerR;
  const centerY = radialY * centerR;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    pushQuad(positions, uvs, a.x, a.y, z0, b.x, b.y, z0, b.x, b.y, z1, a.x, a.y, z1);
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    appendTri(positions, uvs, centerX, centerY, z1, a.x, a.y, z1, b.x, b.y, z1);
    appendTri(positions, uvs, centerX, centerY, z0, b.x, b.y, z0, a.x, a.y, z0);
  }
}

function createRadialCapsuleBoxesGeometry(angles, innerRadius, outerRadius, width, height, z = 0, capSegments = 10) {
  const positions = [];
  const uvs = [];
  for (const angle of angles || []) {
    if (!Number.isFinite(angle)) continue;
    appendRadialCapsuleBox(positions, uvs, angle, innerRadius, outerRadius, width, height, z, capSegments);
  }
  return createBufferedGeometry(positions, uvs);
}

function createBillboardPanelGeometry(radius, angle, width, height, zBottom, radialOffset = 0) {
  const r = radius + radialOffset;
  const cx = Math.cos(angle) * r;
  const cy = Math.sin(angle) * r;
  const tx = -Math.sin(angle);
  const ty = Math.cos(angle);
  const halfW = width * 0.5;
  const z0 = zBottom;
  const z1 = zBottom + height;
  const x0 = cx - tx * halfW;
  const y0 = cy - ty * halfW;
  const x1 = cx + tx * halfW;
  const y1 = cy + ty * halfW;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y0, z0,
    x1, y1, z0,
    x1, y1, z1,
    x0, y0, z0,
    x1, y1, z1,
    x0, y0, z1
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    1, 1,
    0, 0,
    1, 1,
    0, 1
  ], 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function createThemedFloorTexture(theme) {
  const canvas = createCanvas(512, 256);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080b10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.015)');
  grad.addColorStop(1, 'rgba(0,0,0,0.20)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = theme?.line || '#42d9ff';
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 2;
  for (let y = 28; y < canvas.height; y += 56) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(18, 2.4);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createWallTexture(theme, repeatX = 24) {
  const canvas = createCanvas(1024, 256);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgba(255,255,255,0.14)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.055)');
  grad.addColorStop(0.62, 'rgba(0,0,0,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0.58)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const panelW = 128;
  const panelH = 78;
  for (let y = 10; y < canvas.height; y += panelH) {
    const row = Math.floor(y / panelH);
    const offset = row % 2 ? panelW * 0.5 : 0;
    for (let x = -panelW; x < canvas.width + panelW; x += panelW) {
      const px = x + offset;
      const tone = 0.035 + hash01(row * 911 + x * 13) * 0.055;
      ctx.fillStyle = `rgba(255,255,255,${tone})`;
      ctx.fillRect(px + 5, y + 5, panelW - 10, panelH - 10);
      ctx.strokeStyle = 'rgba(0,0,0,0.52)';
      ctx.strokeRect(px + 5.5, y + 5.5, panelW - 11, panelH - 11);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.strokeRect(px + 12.5, y + 12.5, panelW - 25, panelH - 25);
    }
  }

  ctx.fillStyle = 'rgba(0,0,0,0.36)';
  for (let x = 0; x <= canvas.width; x += 64) {
    ctx.fillRect(x - 2, 0, 4, canvas.height);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  const accent = theme?.line || '#39d7ff';
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  for (const y of [canvas.height * 0.22, canvas.height * 0.72]) {
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.26;
  ctx.lineWidth = 2;
  ctx.setLineDash([42, 26]);
  ctx.beginPath();
  ctx.moveTo(0, canvas.height * 0.47);
  ctx.lineTo(canvas.width, canvas.height * 0.47);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.72;
  ctx.fillStyle = accent;
  for (let x = 28; x < canvas.width; x += 128) {
    ctx.fillRect(x, 24, 22, 4);
    ctx.fillRect(x + 66, canvas.height - 38, 30, 4);
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(repeatX, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createRailTexture(theme) {
  const canvas = createCanvas(512, 128);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let x = 0; x < canvas.width; x += 36) ctx.fillRect(x, 0, 10, canvas.height);
  ctx.strokeStyle = theme?.railLine || '#7f8893';
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 5;
  for (const y of [34, 94]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height * 0.5);
  ctx.lineTo(canvas.width, canvas.height * 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(48, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBillboardTexture(theme, label, index) {
  const canvas = createCanvas(512, 192);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = theme?.line || '#39d7ff';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = theme?.line || '#39d7ff';
  ctx.fillRect(18, 18, canvas.width - 36, canvas.height - 36);
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#eafcff';
  ctx.font = '700 46px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width * 0.5, canvas.height * 0.45);
  ctx.font = '700 22px Arial, sans-serif';
  ctx.fillStyle = theme?.line || '#39d7ff';
  ctx.fillText(`LANE ${String(index + 1).padStart(2, '0')}`, canvas.width * 0.5, canvas.height * 0.72);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hash01(seed) {
  let x = (seed | 0) + 0x6D2B79F5;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}


const state = {
  rings: new Map(),
  entities: [],
  queryCells: new Map(),
  queryResult: [],
  queryCount: 0,
  querySerial: 0,
  visualZByKey: new Map()
};

function normalizeAnglePositive(angle) {
  const twoPi = Math.PI * 2;
  let a = Number(angle) || 0;
  a = a - Math.floor(a / twoPi) * twoPi;
  return a < 0 ? a + twoPi : a;
}

function nextQuerySerial() {
  state.querySerial = (state.querySerial + 1) & 0x7fffffff;
  if (state.querySerial <= 0) state.querySerial = 1;
  return state.querySerial;
}

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
  topRail.addColorStop(0, '#030405');
  topRail.addColorStop(0.45, '#10151b');
  topRail.addColorStop(1, '#040507');
  ctx.fillStyle = topRail;
  ctx.fillRect(0, topY, w, Math.max(1, railH));

  const bottomRail = ctx.createLinearGradient(0, bottomY, 0, y1);
  bottomRail.addColorStop(0, '#040507');
  bottomRail.addColorStop(0.55, '#10151b');
  bottomRail.addColorStop(1, '#030405');
  ctx.fillStyle = bottomRail;
  ctx.fillRect(0, bottomY, w, Math.max(1, y1 - bottomY));

  const glowSize = Math.max(1, Math.round(railH * 0.12));
  ctx.fillStyle = 'rgba(120, 132, 145, 0.28)';
  ctx.fillRect(0, topY + railH - glowSize, w, glowSize);
  ctx.fillRect(0, bottomY, w, glowSize);

  const stripeH = Math.max(1, Math.round(railH * 0.1));
  ctx.fillStyle = 'rgba(12, 14, 17, 0.95)';
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

  paintBand(layout.innerBandTopPx, layout.innerBandBottomPx, ['#030405', '#090d12', '#020304'], {
    grid: 'rgba(255,255,255,0.055)',
    decks: { fill: 'rgba(160,170,180,0.16)', stroke: 'rgba(150,160,172,0.45)' }
  });
  paintBand(layout.industrialBandTopPx, layout.industrialBandBottomPx, ['#030403', '#0b0c0a', '#020302'], {
    grid: 'rgba(255,255,255,0.045)'
  });
  paintBand(layout.militaryBandTopPx, layout.militaryBandBottomPx, ['#040303', '#0d090a', '#030202'], {
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
  // Collision must be independent from decorative floor/wall graphics.
  // Each band crop gets a fully opaque mask, while holes are handled by
  // segment type. This prevents a visual texture tweak from moving/removing
  // the physical destructor layer.
  collisionCtx.fillStyle = '#fff';
  collisionCtx.fillRect(0, 0, wallCollision.width, wallCollision.height);

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

function segmentHasLiveEntity(seg) {
  if (!seg) return false;
  const entities = Array.isArray(seg.entities) ? seg.entities : null;
  const count = entities ? entities.length : (seg.entity ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const entity = entities ? entities[i] : seg.entity;
    if (entity && !entity.dead) return true;
  }
  return false;
}

class PlanetaryRing {
  constructor(planet, key) {
    this.key = key;
    // NEW: compute multi-ring layout (3 narrower rings with gaps)
    this.layout = computeRingLayout(Number(planet?.r) || 2800);
    this.buildableLayout = createBuildableRingLayout(this.layout);
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
    this._ringEntitiesActive = false;
    this._rootAttached = false;

    // --- BUDYNKI 3D NA WARSTWIE 2 (FOREGROUND) ---
    this.buildings3D = new THREE.Group();
    this.buildings3D.name = `PlanetaryRingRoot:${this.key}`;
    this.buildings3D.userData.fgCategory = 'buildings';
    this.attachRootToScene();
    Core3D.enableForeground3D(this.buildings3D); // Na layer 1 ring przykrywał budynki, więc wracamy na pass FG.
    this.visualMeshes = [];
    this.zoneGrid = new RingCityZoneGrid(this.buildableLayout);
    this.ringFloor = null; // 3D ring pedestal mesh group
    this.floorDamageBands = [];
    this.wallRailMeshes = [];

    this.build();
    this.updateFromPlanet(planet, 0);
  }

  attachRootToScene() {
    if (!this.buildings3D || !Core3D.scene) return false;
    if (this.buildings3D.parent !== Core3D.scene) {
      Core3D.scene.add(this.buildings3D);
    }
    this._rootAttached = true;
    return true;
  }

  detachRootFromScene() {
    if (!this.buildings3D) return false;
    if (this.buildings3D.parent) {
      this.buildings3D.parent.remove(this.buildings3D);
    }
    this._rootAttached = false;
    return true;
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
    const bandTextures = this.createSegmentBandTextures(textures);
    this.segmentData.length = 0;

    for (let i = 0; i < segmentCount; i++) {
      const type = this.segmentTypes[i];
      const baseAngle = (i + 0.5) * this.angleStep;
      const segment = {
        index: i,
        type,
        baseAngle,
        worldAngle: baseAngle,
        entity: null,
        entities: [],
        entityByBand: Object.create(null)
      };

      if (type !== 'HOLE') {
        for (let b = 0; b < bandTextures.length; b++) {
          const bandTex = bandTextures[b];
          const entity = this.createSegmentEntity(
            i,
            type,
            bandTex.id,
            bandTex.display,
            bandTex.collision,
            bandTex
          );
          if (!entity || entity.dead) continue;
          segment.entities.push(entity);
          segment.entityByBand[bandTex.id] = entity;
          if (!segment.entity) segment.entity = entity;
        }
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
    this.buildVisualFloor();
    this.buildRingWallsAndRails();
    this.buildShipParking();
  }

  createSegmentBandTextures(textures) {
    const result = [];
    const sourceDisplay = textures.WALL_DISPLAY;
    const sourceCollision = textures.WALL_COLLISION || sourceDisplay;
    if (!sourceDisplay) return result;

    for (const id of RING_SEGMENT_BANDS) {
      const band = this.layout?.[id];
      if (!band) continue;
      const radius = (band.innerR + band.outerR) * 0.5;
      const coverageRadius = Math.max(radius, Number(band.outerR) || radius);
      const worldWidth = Math.max(2, (Number(this.angleStep) || 0) * coverageRadius + CONFIG.overlap);
      const worldHeight = Math.max(1, band.outerR - band.innerR);
      const canvasWidth = Math.max(2, Math.round(worldWidth / RING_HEX_WORLD_SCALE));
      const canvasHeight = Math.max(2, Math.round(worldHeight / RING_HEX_WORLD_SCALE));
      const [srcTop, srcBottom] = getBandTextureRangePx(id);
      const srcHeight = Math.max(1, srcBottom - srcTop);
      const display = createCanvas(canvasWidth, canvasHeight);
      const collision = createCanvas(canvasWidth, canvasHeight);
      if (!display || !collision) continue;

      display.getContext('2d').drawImage(
        sourceDisplay,
        0, srcTop, TEXTURE.width, srcHeight,
        0, 0, canvasWidth, canvasHeight
      );
      collision.getContext('2d').drawImage(
        sourceCollision,
        0, srcTop, TEXTURE.width, srcHeight,
        0, 0, canvasWidth, canvasHeight
      );

      result.push({
        id,
        display,
        collision,
        innerR: band.innerR,
        outerR: band.outerR,
        radius,
        worldWidth,
        worldHeight
      });
    }

    return result;
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

  buildVisualFloor() {
    if (!this.ringFloor || !this.segmentData.length) return;
    this.floorDamageBands.length = 0;

    for (const bandId of RING_SEGMENT_BANDS) {
      const band = this.layout?.[bandId];
      if (!band) continue;

      const geometry = createRingBandGeometry(band.innerR, band.outerR, 0.15);
      const damageCanvas = createCanvas(
        Math.max(1, this.segmentData.length * FLOOR_DAMAGE.pxPerSegment),
        FLOOR_DAMAGE.height
      );
      if (!damageCanvas) {
        geometry.dispose();
        continue;
      }

      const damageCtx = damageCanvas.getContext('2d');
      const damageTexture = new THREE.CanvasTexture(damageCanvas);
      damageTexture.wrapS = THREE.RepeatWrapping;
      damageTexture.wrapT = THREE.ClampToEdgeWrapping;
      damageTexture.minFilter = THREE.LinearFilter;
      damageTexture.magFilter = THREE.LinearFilter;

      const material = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0x000000,
        emissiveIntensity: 0,
        alphaMap: damageTexture,
        transparent: true,
        depthWrite: false,
        roughness: 0.92,
        metalness: 0.18,
        side: THREE.DoubleSide
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `PlanetaryRingFloorBand:${this.key}:${bandId}`;
      mesh.renderOrder = -4;
      mesh.userData.fgCategory = 'buildings';
      mesh.userData.isRingFloorBand = true;
      if (Core3D?.enableForeground3D) Core3D.enableForeground3D(mesh);
      this.ringFloor.add(mesh);

      const entry = {
        id: bandId,
        mesh,
        damageCanvas,
        damageCtx,
        damageTexture,
        pxPerSegment: FLOOR_DAMAGE.pxPerSegment,
        lastRatios: new Float32Array(this.segmentData.length),
        lastActiveCounts: new Int32Array(this.segmentData.length)
      };
      entry.lastRatios.fill(-1);
      entry.lastActiveCounts.fill(-1);

      for (let i = 0; i < this.segmentData.length; i++) {
        const seg = this.segmentData[i];
        const ratio = seg?.type === 'HOLE' ? 0 : 1;
        this.paintFloorDamageStripe(entry, i, ratio);
        entry.lastRatios[i] = ratio;
      }
      damageTexture.needsUpdate = true;
      this.floorDamageBands.push(entry);
    }
  }

  buildRingWallsAndRails() {
    if (!this.ringFloor || !this.layout) return;
    this.wallRailMeshes.length = 0;
    const arcRanges = buildRingSolidArcRanges(
      this.segmentData,
      this.angleStep,
      this.angleStep * RING_EDGE.gateGapPadRatio
    );
    if (!arcRanges.length) return;
    const gateReturnAngles = buildRingGateReturnEndpointAngles(arcRanges);

    for (const bandId of RING_SEGMENT_BANDS) {
      const band = this.layout?.[bandId];
      if (!band) continue;

      const theme = FLOOR_THEME[bandId] || FLOOR_THEME.inner;
      const buildBand = this.buildableLayout?.[bandId] || band;
      const maxWallInner = band.outerR
        - RING_EDGE.railOuterMargin
        - RING_EDGE.railLaneWidth
        - RING_EDGE.railWallGap
        - RING_EDGE.wallThickness;
      const wallInner = Math.max(
        band.innerR + 20,
        Math.min(buildBand.outerR + RING_EDGE.wallSetback, maxWallInner)
      );
      const wallOuter = Math.min(
        band.outerR - RING_EDGE.railOuterMargin - RING_EDGE.railLaneWidth - RING_EDGE.railWallGap,
        wallInner + RING_EDGE.wallThickness
      );
      const railInner = Math.min(
        band.outerR - RING_EDGE.railOuterMargin - 10,
        wallOuter + RING_EDGE.railWallGap
      );
      const railOuter = Math.min(band.outerR - RING_EDGE.railOuterMargin, railInner + RING_EDGE.railLaneWidth);
      const railWidth = Math.max(1, railOuter - railInner);
      const repeatX = Math.max(12, Math.round((Math.PI * 2 * wallInner) / 900));
      const innerWallInner = band.innerR + 8;
      const innerWallOuter = Math.min(band.outerR - 20, innerWallInner + RING_EDGE.innerWallThickness);
      const gateReturnWallOuter = computeGateReturnWallOuterRadius(
        wallInner,
        wallOuter,
        innerWallOuter,
        RING_EDGE.gateReturnWallSetback
      );
      const returnWallRepeatX = Math.max(4, Math.round((Math.max(1, gateReturnWallOuter - innerWallInner) / 900) * 6));
      const hasDockRails = shouldBuildDockRailsForBand(bandId);
      const railTurnAngle = hasDockRails
        ? Math.min(this.angleStep * 1.35, RING_EDGE.gateRailTurnLength / Math.max(1, railOuter))
        : 0;
      const railTurnArcRanges = buildGateRailTurnArcRanges(arcRanges, railTurnAngle);
      const railRanges = hasDockRails ? arcRanges.concat(railTurnArcRanges) : [];
      const railSideAngles = buildGateRailSideAngles(arcRanges, railTurnAngle);
      const railSideInner = Math.min(
        railInner,
        Math.max(innerWallOuter + RING_EDGE.railWallGap, band.innerR + 24)
      );

      if (hasDockRails) {
        const railGeometry = createRingBandRangesGeometry(railInner, railOuter, railRanges, 0.42);
        if (railGeometry) {
          const railMesh = new THREE.Mesh(
            railGeometry,
            new THREE.MeshStandardMaterial({
              color: 0x040506,
              emissive: 0x000000,
              emissiveIntensity: 0,
              map: createRailTexture(null),
              transparent: true,
              opacity: 0.92,
              roughness: 0.58,
              metalness: 0.62,
              depthWrite: false,
              side: THREE.DoubleSide
            })
          );
          railMesh.name = `PlanetaryRingDockRail:${this.key}:${bandId}`;
          railMesh.renderOrder = -2;
          railMesh.userData.fgCategory = 'buildings';
          this.ringFloor.add(railMesh);
          if (Core3D?.enableForeground3D) Core3D.enableForeground3D(railMesh);
          this.wallRailMeshes.push(railMesh);
        }

        const railReturnGeometry = createRadialCapsuleBoxesGeometry(
          railSideAngles,
          railSideInner,
          railOuter,
          RING_EDGE.gateRailSideWidth,
          3,
          0.41,
          14
        );
        if (railReturnGeometry) {
          const railReturn = new THREE.Mesh(
            railReturnGeometry,
            new THREE.MeshStandardMaterial({
              color: 0x040506,
              emissive: 0x000000,
              emissiveIntensity: 0,
              map: createRailTexture(null),
              transparent: true,
              opacity: 0.92,
              roughness: 0.58,
              metalness: 0.62,
              depthWrite: false,
              side: THREE.DoubleSide
            })
          );
          railReturn.name = `PlanetaryRingDockRailTurn:${this.key}:${bandId}`;
          railReturn.renderOrder = -2;
          railReturn.userData.fgCategory = 'buildings';
          this.ringFloor.add(railReturn);
          if (Core3D?.enableForeground3D) Core3D.enableForeground3D(railReturn);
          this.wallRailMeshes.push(railReturn);
        }
      }

      const beamCenters = [
        railInner + railWidth * 0.32,
        railInner + railWidth * 0.68
      ];
      if (hasDockRails) {
        for (let i = 0; i < beamCenters.length; i++) {
          const center = beamCenters[i];
          const halfBeam = Math.min(RING_EDGE.railBeamWidth, railWidth * 0.18) * 0.5;
          const beamGeometry = createRingAnnularBoxRangesGeometry(
            center - halfBeam,
            center + halfBeam,
            RING_EDGE.railBeamHeight,
            0.45,
            railRanges
          );
          if (!beamGeometry) continue;
          const railBeam = new THREE.Mesh(
            beamGeometry,
            new THREE.MeshStandardMaterial({
              color: 0x161d24,
              emissive: 0x000000,
              emissiveIntensity: 0,
              roughness: 0.48,
              metalness: 0.78,
              side: THREE.DoubleSide
            })
          );
          railBeam.name = `PlanetaryRingDockRailBeam:${this.key}:${bandId}:${i}`;
          railBeam.renderOrder = -1;
          railBeam.userData.fgCategory = 'buildings';
          this.ringFloor.add(railBeam);
          if (Core3D?.enableForeground3D) Core3D.enableForeground3D(railBeam);
          this.wallRailMeshes.push(railBeam);
        }

        const railBeamTurnGeometry = createRadialCapsuleBoxesGeometry(
          railSideAngles,
          railSideInner,
          railOuter,
          Math.max(RING_EDGE.railBeamWidth * 1.6, 34),
          RING_EDGE.railBeamHeight,
          0.45,
          12
        );
        if (railBeamTurnGeometry) {
          const railBeamTurn = new THREE.Mesh(
            railBeamTurnGeometry,
            new THREE.MeshStandardMaterial({
              color: 0x161d24,
              emissive: 0x000000,
              emissiveIntensity: 0,
              roughness: 0.48,
              metalness: 0.78,
              side: THREE.DoubleSide
            })
          );
          railBeamTurn.name = `PlanetaryRingDockRailBeamTurn:${this.key}:${bandId}`;
          railBeamTurn.renderOrder = -1;
          railBeamTurn.userData.fgCategory = 'buildings';
          this.ringFloor.add(railBeamTurn);
          if (Core3D?.enableForeground3D) Core3D.enableForeground3D(railBeamTurn);
          this.wallRailMeshes.push(railBeamTurn);
        }
      }

      const outerWallGeometry = createRingAnnularBoxRangesGeometry(
        wallInner,
        wallOuter,
        RING_EDGE.wallHeight,
        0.2,
        arcRanges
      );
      if (outerWallGeometry) {
        const outerWall = new THREE.Mesh(
          outerWallGeometry,
          new THREE.MeshStandardMaterial({
            color: 0x0b0f16,
            emissive: 0x020304,
            emissiveIntensity: 0.04,
            map: createWallTexture(theme, repeatX),
            roughness: 0.78,
            metalness: 0.45,
            side: THREE.DoubleSide
          })
        );
        outerWall.name = `PlanetaryRingOuterWall:${this.key}:${bandId}`;
        outerWall.userData.fgCategory = 'buildings';
        this.ringFloor.add(outerWall);
        if (Core3D?.enableForeground3D) Core3D.enableForeground3D(outerWall);
        this.wallRailMeshes.push(outerWall);
      }

      const returnWallGeometry = createRadialCapsuleBoxesGeometry(
        gateReturnAngles,
        innerWallInner,
        gateReturnWallOuter,
        RING_EDGE.gateReturnWallWidth,
        RING_EDGE.wallHeight,
        0.22,
        14
      );
      if (returnWallGeometry) {
        const returnWall = new THREE.Mesh(
          returnWallGeometry,
          new THREE.MeshStandardMaterial({
            color: 0x0b0f16,
            emissive: 0x020304,
            emissiveIntensity: 0.04,
            map: createWallTexture(theme, returnWallRepeatX),
            roughness: 0.78,
            metalness: 0.45,
            side: THREE.DoubleSide
          })
        );
        returnWall.name = `PlanetaryRingGateReturnWall:${this.key}:${bandId}`;
        returnWall.userData.fgCategory = 'buildings';
        this.ringFloor.add(returnWall);
        if (Core3D?.enableForeground3D) Core3D.enableForeground3D(returnWall);
        this.wallRailMeshes.push(returnWall);
      }

      const innerWallGeometry = createRingAnnularBoxRangesGeometry(
        innerWallInner,
        innerWallOuter,
        RING_EDGE.innerWallHeight,
        0.18,
        arcRanges
      );
      if (innerWallGeometry) {
        const innerWall = new THREE.Mesh(
          innerWallGeometry,
          new THREE.MeshStandardMaterial({
            color: 0x080b11,
            emissive: 0x010203,
            emissiveIntensity: 0.03,
            map: createWallTexture(theme, Math.max(8, Math.round(repeatX * 0.72))),
            roughness: 0.82,
            metalness: 0.38,
            side: THREE.DoubleSide
          })
        );
        innerWall.name = `PlanetaryRingInnerWall:${this.key}:${bandId}`;
        innerWall.userData.fgCategory = 'buildings';
        this.ringFloor.add(innerWall);
        if (Core3D?.enableForeground3D) Core3D.enableForeground3D(innerWall);
        this.wallRailMeshes.push(innerWall);
      }

      const billboardLabels = bandId === 'military'
        ? ['MIL DOCK', 'ARMORY', 'DRY BAY']
        : bandId === 'industrial'
          ? ['CARGO', 'REFIT', 'FREIGHT']
          : ['PORT', 'TRANSIT', 'MARKET'];
      const billboardCount = Math.max(8, Math.round((Math.PI * 2 * band.outerR) / 3600));
      const billboardOffset = bandId === 'inner' ? 0.08 : bandId === 'industrial' ? 0.18 : 0.28;
      const billboardRadius = wallInner - 6;

      for (let i = 0; i < billboardCount; i++) {
        const angle = ((i + 0.5) / billboardCount) * Math.PI * 2 + billboardOffset;
        const billboardMargin = Math.max(this.angleStep * 0.25, (RING_EDGE.billboardWidth * 0.5) / Math.max(1, billboardRadius));
        if (isGateAngle(angle) || !angleInArcRanges(angle, arcRanges, billboardMargin)) continue;
        const texture = createBillboardTexture(theme, billboardLabels[i % billboardLabels.length], i);
        if (!texture) continue;
        const billboard = new THREE.Mesh(
          createBillboardPanelGeometry(
            billboardRadius,
            angle,
            RING_EDGE.billboardWidth,
            RING_EDGE.billboardHeight,
            RING_EDGE.billboardBottom,
            0
          ),
          new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        billboard.name = `PlanetaryRingBillboard:${this.key}:${bandId}:${i}`;
        billboard.renderOrder = 4;
        billboard.userData.fgCategory = 'buildings';
        this.ringFloor.add(billboard);
        if (Core3D?.enableForeground3D) Core3D.enableForeground3D(billboard);
        this.wallRailMeshes.push(billboard);
      }
    }
  }

  paintFloorDamageStripe(entry, segmentIndex, ratio) {
    const ctx2d = entry?.damageCtx;
    if (!ctx2d) return;
    const px = entry.pxPerSegment;
    const h = entry.damageCanvas.height;
    const x = segmentIndex * px;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));

    ctx2d.clearRect(x, 0, px, h);
    if (clamped <= 0.01) {
      ctx2d.fillStyle = '#000';
      ctx2d.fillRect(x, 0, px, h);
      return;
    }

    ctx2d.fillStyle = '#fff';
    ctx2d.fillRect(x, 0, px, h);

    const damage = 1 - clamped;
    if (damage <= 0.01) return;

    const bandSeed = entry.id === 'inner' ? 11 : entry.id === 'industrial' ? 37 : 73;
    const holeCount = Math.max(1, Math.ceil(damage * 9));
    const baseRadius = Math.min(px, h) * (0.22 + damage * 0.16);

    for (let i = 0; i < holeCount; i++) {
      const seed = segmentIndex * 92821 + bandSeed * 131 + i * 6151;
      const cx = x + hash01(seed) * px;
      const cy = hash01(seed + 17) * h;
      const radius = baseRadius * (0.7 + hash01(seed + 31) * 1.35);
      const alpha = Math.min(0.95, 0.30 + damage * 0.95);
      const grad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
      grad.addColorStop(0.62, `rgba(0,0,0,${alpha * 0.72})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }

  paintFloorDamageFromEntity(entry, segmentIndex, entity, ratio) {
    const ctx2d = entry?.damageCtx;
    const grid = entity?.hexGrid;
    if (!ctx2d || !grid?.shards) {
      this.paintFloorDamageStripe(entry, segmentIndex, ratio);
      return;
    }

    const px = entry.pxPerSegment;
    const h = entry.damageCanvas.height;
    const x = segmentIndex * px;
    const srcW = Math.max(1, Number(grid.srcWidth) || 1);
    const srcH = Math.max(1, Number(grid.srcHeight) || 1);
    const clampedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));

    ctx2d.clearRect(x, 0, px, h);
    if (clampedRatio <= 0.01 || entity.dead) {
      ctx2d.fillStyle = '#000';
      ctx2d.fillRect(x, 0, px, h);
      return;
    }

    ctx2d.fillStyle = '#fff';
    ctx2d.fillRect(x, 0, px, h);

    for (const shard of grid.shards) {
      if (!shard) continue;
      const maxHp = Math.max(0.0001, Number(shard.maxHp) || 1);
      const hpRatio = Math.max(0, Math.min(1, (Number(shard.hp) || 0) / maxHp));
      const missing = !shard.active || shard.isDebris || hpRatio < 0.55;
      if (!missing) continue;

      const gx = Number(shard.gridX);
      const gy = Number(shard.gridY);
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;

      const u = Math.max(0, Math.min(1, gx / srcW));
      const v = Math.max(0, Math.min(1, gy / srcH));
      const cx = x + u * px;
      const cy = v * h;
      const hitRadius = Math.max(1, Number(shard.hitRadius) || 1);
      const radius = Math.max(
        1.6,
        Math.min(px, h) * 0.08,
        Math.max(px / srcW, h / srcH) * hitRadius * 2.4
      );
      const alpha = (!shard.active || shard.isDebris)
        ? 0.95
        : Math.max(0.25, Math.min(0.8, 1 - hpRatio));
      const grad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
      grad.addColorStop(0.7, `rgba(0,0,0,${alpha * 0.75})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }

  updateFloorDamageMaps() {
    if (!this.floorDamageBands.length) return false;
    let anyDirty = false;

    for (const band of this.floorDamageBands) {
      let dirty = false;
      for (let i = 0; i < this.segmentData.length; i++) {
        const seg = this.segmentData[i];
        const entity = seg?.entityByBand?.[band.id] || null;
        let ratio = 0;
        let activeCount = 0;
        if (entity && !entity.dead && entity.hexGrid) {
          const structural = getHexStructuralState(entity);
          ratio = (structural && structural.total > 0)
            ? Math.max(0, Math.min(1, structural.active / structural.total))
            : 1;
          activeCount = (structural && Number.isFinite(structural.active)) ? structural.active | 0 : 0;
        }

        const prev = band.lastRatios[i];
        const prevActive = band.lastActiveCounts[i];
        if (activeCount === prevActive && Math.abs(ratio - prev) < 0.002) continue;
        band.lastRatios[i] = ratio;
        band.lastActiveCounts[i] = activeCount;
        if (entity && !entity.dead && entity.hexGrid) this.paintFloorDamageFromEntity(band, i, entity, ratio);
        else this.paintFloorDamageStripe(band, i, ratio);
        dirty = true;
      }
      if (dirty) {
        band.damageTexture.needsUpdate = true;
        anyDirty = true;
      }
    }

    return anyDirty;
  }

  /** Update damage alpha texture based on segment structural state */
  updateDamageAlpha() {
    if (this.floorDamageBands.length) {
      this.updateFloorDamageMaps();
      return;
    }
    if (!this._damageCtx) return;
    const ctx2d = this._damageCtx;
    const pxPerSeg = this._damagePxPerSeg;
    let dirty = false;

    for (let i = 0; i < this.segmentData.length; i++) {
      const seg = this.segmentData[i];
      const entities = Array.isArray(seg.entities) ? seg.entities : null;
      const entityCount = entities ? entities.length : (seg.entity ? 1 : 0);

      // Dead, missing, or HOLE → fully transparent
      if (entityCount <= 0) {
        const prev = seg._lastDamageRatio ?? 1.0;
        if (prev > 0.001) {
          seg._lastDamageRatio = 0;
          ctx2d.clearRect(i * pxPerSeg, 0, pxPerSeg, 4);
          dirty = true;
        }
        continue;
      }

      // Structural damage ratio
      let active = 0;
      let total = 0;
      let aliveAny = false;
      for (let e = 0; e < entityCount; e++) {
        const entity = entities ? entities[e] : seg.entity;
        if (!entity) continue;
        if (!entity.dead) aliveAny = true;
        if (!entity.hexGrid) continue;
        const structural = getHexStructuralState(entity);
        if (structural && structural.total > 0) {
          active += entity.dead ? 0 : structural.active;
          total += structural.total;
        }
      }
      const ratio = total > 0 ? active / total : (aliveAny ? 1.0 : 0.0);
      if (!aliveAny && ratio <= 0) {
        const prev = seg._lastDamageRatio ?? 1.0;
        if (prev > 0.001) {
          seg._lastDamageRatio = 0;
          ctx2d.clearRect(i * pxPerSeg, 0, pxPerSeg, 4);
          dirty = true;
        }
        continue;
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

  createSegmentEntity(index, type, bandId, image, collisionImage = image, band = null) {
    const entity = {
      id: `ring_${this.key}_${bandId}_${index}`,
      name: `Ring ${this.key} ${bandId} ${index}`,
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
      hideHexVisual: true,
      ringPlanetKey: this.key,
      ringBandId: bandId,
      ringBandRadius: Number(band?.radius) || this.wallRadius,
      ringBandInnerRadius: Number(band?.innerR) || 0,
      ringBandOuterRadius: Number(band?.outerR) || 0,
      ringBandWorldWidth: Number(band?.worldWidth) || CONFIG.segmentWorldWidth,
      ringBandWorldHeight: Number(band?.worldHeight) || this.segmentWorldHeight,
      ringSegmentType: type,
      ringSegmentIndex: index,
      noSplit: true,
      mass: RING_SEGMENT_MASS,
      friction: 1,
      visual: {
        spriteScale: RING_HEX_WORLD_SCALE,
        spriteScaleX: RING_HEX_WORLD_SCALE,
        spriteScaleY: RING_HEX_WORLD_SCALE,
        hideHexMesh: true,
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

    // Set collision radius from actual layer dimensions.
    const scaleX = Math.max(0.0001, Number(entity.visual?.spriteScaleX) || RING_HEX_WORLD_SCALE);
    const scaleY = Math.max(0.0001, Number(entity.visual?.spriteScaleY) || scaleX);
    const hw = (entity.hexGrid.srcWidth || 0) * scaleX * 0.5;
    const hh = (entity.hexGrid.srcHeight || 0) * scaleY * 0.5;
    entity.radius = Math.max(hw, hh);

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

      const rawStart = this.segmentData[startIdx].baseAngle - this.angleStep * 0.5;
      const rawEnd = this.segmentData[startIdx + holeSize - 1].baseAngle + this.angleStep * 0.5;
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
    const shipRef = this._shipRef;
    let shipNearRing = false;
    let shipX = 0, shipY = 0;

    if (shipRef) {
      shipX = shipRef.pos?.x ?? shipRef.x ?? 0;
      shipY = shipRef.pos?.y ?? shipRef.y ?? 0;
      const shipDist = Math.hypot(shipX - this.lastPlanetX, shipY - this.lastPlanetY);
      const activeInner = Math.max(0, this.floorInnerRadius - CONFIG.segmentActiveMargin);
      const activeOuter = this.floorOuterRadius + CONFIG.segmentActiveMargin;
      shipNearRing = shipDist >= activeInner && shipDist <= activeOuter;
    }
    this._ringEntitiesActive = shipNearRing;

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
      const halfViewportX = (window.innerWidth || 1920) * 0.5 / camZoom;
      const halfViewportY = (window.innerHeight || 1080) * 0.5 / camZoom;
      const absDx = Math.abs(dxCam);
      const absDy = Math.abs(dyCam);
      const nearestX = Math.max(0, absDx - halfViewportX);
      const nearestY = Math.max(0, absDy - halfViewportY);
      const nearestDist = Math.hypot(nearestX, nearestY);
      const farthestDist = Math.hypot(absDx + halfViewportX, absDy + halfViewportY);
      const innerCull = Math.max(0, this.floorInnerRadius - CONFIG.visualCullMargin);
      const outerCull = this.floorOuterRadius + CONFIG.visualCullMargin;
      const ringIntersectsView = farthestDist >= innerCull && nearestDist <= outerCull;

      const shouldHideRoot = ringTooSmall || !ringIntersectsView;
      if (shouldHideRoot) {
        if (this.buildings3D.visible) this.buildings3D.visible = false;
        this.detachRootFromScene();
      } else {
        this.attachRootToScene();
        if (!this.buildings3D.visible) this.buildings3D.visible = true;
      }
      this._ringHidden = shouldHideRoot;

      if (shouldHideRoot && !shipNearRing) {
        // currentRotation already advanced above so segments will be
        // at correct world coords next time the ring becomes visible.
        return;
      }
    } else if (this.buildings3D && !this.buildings3D.visible) {
      // No camera info — be safe and show the ring.
      this.attachRootToScene();
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
    for (let i = 0; i < this.segmentData.length; i++) {
      const seg = this.segmentData[i];
      const worldAngle = seg.baseAngle + this.currentRotation;
      seg.worldAngle = worldAngle;

      const worldRot = worldAngle + Math.PI * 0.5;

      const entities = Array.isArray(seg.entities) ? seg.entities : null;
      const entityCount = entities ? entities.length : (seg.entity ? 1 : 0);
      for (let e = 0; e < entityCount; e++) {
        const entity = entities ? entities[e] : seg.entity;
        if (!entity || entity.dead) continue;

        const bandRadius = Math.max(1, Number(entity.ringBandRadius) || this.wallRadius);
        const worldX = this.lastPlanetX + Math.cos(worldAngle) * bandRadius;
        const worldY = this.lastPlanetY + Math.sin(worldAngle) * bandRadius;

        entity.x = worldX;
        entity.y = worldY;
        entity.angle = worldRot;

        if (shipNearRing) {
          // Tangential surface velocity: v = ω × r (perpendicular to radial direction)
          // This lets the destructor collision system transfer surface movement to colliding objects
          const surfSpeed = this.rotationSpeed * bandRadius;
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
    }

    this.updateForceFields(dt);

    // Update damage alpha texture — structural damage every 20 ticks
    // (updateDamageAlpha has internal dirty-check so frequent calls are cheap)
    this.updateDamageAlpha();

    if (this.buildings3D && !this.buildings3D.visible) return;

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
    const safeCamZoom = Math.max(0.0001, Number(camZoom) || 0.0001);
    const ringPixelRadius = this.ringRadius * safeCamZoom;

    // Determine current LOD level for chunk children from on-screen size.
    // 0 = full detail, 1 = hide DETAIL, 2 = hide DETAIL+MEDIUM, 3 = max cheap
    let lodLevel = 0;
    if (ringPixelRadius < 380) lodLevel = 3;
    else if (ringPixelRadius < 700) lodLevel = 2;
    else if (ringPixelRadius < 1200) lodLevel = 1;
    const skipAnimations = lodLevel >= 1;
    const hideAllDistricts = false;
    const useFarChunkMaterials = lodLevel >= 1;

    for (const b of this.visualMeshes) {
        // Global infrastructure — 4 large merged meshes (floor/path/trace/overlay).
        // Keep them visible even on the farthest LOD.
        if (b.isGlobalInfra) {
            b.mesh.visible = !hideAllDistricts;
            continue;
        }

        // LOD: keep district chunks alive even on the farthest zoom-out.
        if (hideAllDistricts && b.isDistrict) {
            b.mesh.visible = false;
            continue;
        }

        // Segment destruction check (for non-chunk entries)
        if (!b.isChunk && b.segmentIndex !== undefined) {
            const seg = this.segmentData[b.segmentIndex];
            if (!segmentHasLiveEntity(seg)) {
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
            const farMaterial = child.userData?.farMaterial;
            if (farMaterial) {
              const wantsFar = child.visible && useFarChunkMaterials;
              if (child.userData.usingFarMaterial !== wantsFar) {
                child.material = wantsFar ? farMaterial : (child.userData.nearMaterial || child.material);
                child.userData.usingFarMaterial = wantsFar;
              }
            }
          }
        } else if (b.isChunk && b.mesh.children) {
          for (const child of b.mesh.children) {
            child.visible = true;
            const nearMaterial = child.userData?.nearMaterial;
            if (nearMaterial && child.userData.usingFarMaterial) {
              child.material = nearMaterial;
              child.userData.usingFarMaterial = false;
            }
          }
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
      const entities = Array.isArray(seg?.entities) ? seg.entities : null;
      const count = entities ? entities.length : (seg?.entity ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const entity = entities ? entities[i] : seg.entity;
        if (entity) entity.dead = true;
      }
    }

    if (this.buildings3D?.parent) {
        this.buildings3D.parent.remove(this.buildings3D);
    }
    this._rootAttached = false;

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
    for (const mesh of this.wallRailMeshes) {
      if (mesh?.parent) mesh.parent.remove(mesh);
      mesh?.geometry?.dispose?.();
      const materials = Array.isArray(mesh?.material) ? mesh.material : (mesh?.material ? [mesh.material] : []);
      for (const material of materials) {
        material.map?.dispose?.();
        material.alphaMap?.dispose?.();
        material.emissiveMap?.dispose?.();
        material.dispose?.();
      }
    }
    this.wallRailMeshes.length = 0;
    for (const band of this.floorDamageBands) {
      if (band?.mesh?.parent) band.mesh.parent.remove(band.mesh);
      band?.mesh?.geometry?.dispose?.();
      if (band?.mesh?.material) {
        const material = band.mesh.material;
        material.map?.dispose?.();
        if (material.alphaMap && material.alphaMap !== band.damageTexture) {
          material.alphaMap.dispose?.();
        }
        material.alphaMap = null;
        material.map = null;
        material.dispose?.();
      }
      band?.damageTexture?.dispose?.();
    }
    this.floorDamageBands.length = 0;
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
    if (!ring?._ringEntitiesActive) continue;
    for (const seg of ring.segmentData) {
      const entities = Array.isArray(seg?.entities) ? seg.entities : null;
      const count = entities ? entities.length : (seg?.entity ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const entity = entities ? entities[i] : seg.entity;
        if (!entity || entity.dead || !entity.hexGrid) continue;
        state.entities.push(entity);
      }
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

function appendQueryTarget(entity) {
  if (!entity || entity.dead || !entity.hexGrid) return false;
  if (entity.__ringQuerySerial === state.querySerial) return false;
  entity.__ringQuerySerial = state.querySerial;
  state.queryResult[state.queryCount++] = entity;
  return true;
}

function updateRingQueryEntityPose(ring, seg, entity) {
  if (!ring || !seg || !entity) return;
  const worldAngle = seg.baseAngle + ring.currentRotation;
  const worldRot = worldAngle + Math.PI * 0.5;
  const bandRadius = Math.max(1, Number(entity.ringBandRadius) || ring.wallRadius);
  entity.x = ring.lastPlanetX + Math.cos(worldAngle) * bandRadius;
  entity.y = ring.lastPlanetY + Math.sin(worldAngle) * bandRadius;
  entity.angle = worldRot;
  entity.vx = -Math.sin(worldAngle) * ring.rotationSpeed * bandRadius;
  entity.vy =  Math.cos(worldAngle) * ring.rotationSpeed * bandRadius;
  entity.angVel = ring.rotationSpeed;
  seg.worldAngle = worldAngle;
}

function appendOnDemandRingTargets(x, y, radius = 0) {
  const qx = Number(x);
  const qy = Number(y);
  if (!Number.isFinite(qx) || !Number.isFinite(qy)) return;
  const qr = Math.max(0, Number(radius) || 0);

  for (const [, ring] of state.rings) {
    if (!ring?.segmentData?.length || !(ring.angleStep > 0)) continue;

    const dx = qx - ring.lastPlanetX;
    const dy = qy - ring.lastPlanetY;
    const dist = Math.hypot(dx, dy);
    const radialPad = qr + 1800;
    if (dist + radialPad < ring.floorInnerRadius) continue;
    if (dist - radialPad > ring.floorOuterRadius) continue;

    const localAngle = normalizeAnglePositive(Math.atan2(dy, dx) - ring.currentRotation);
    const segmentCount = ring.segmentData.length;
    let centerIndex = Math.floor(localAngle / ring.angleStep);
    centerIndex = ((centerIndex % segmentCount) + segmentCount) % segmentCount;

    const arcRadius = Math.max(1, Math.min(Math.max(dist, ring.floorInnerRadius), ring.floorOuterRadius));
    const arcWorldPerSegment = Math.max(1, ring.angleStep * arcRadius);
    const spanSegments = Math.min(
      Math.ceil(segmentCount * 0.5),
      Math.max(2, Math.ceil((qr + 1800) / arcWorldPerSegment) + 2)
    );

    for (let offset = -spanSegments; offset <= spanSegments; offset++) {
      const idx = (centerIndex + offset + segmentCount) % segmentCount;
      const seg = ring.segmentData[idx];
      if (!seg || seg.type === 'HOLE') continue;

      const entities = Array.isArray(seg.entities) ? seg.entities : null;
      const count = entities ? entities.length : (seg.entity ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const entity = entities ? entities[i] : seg.entity;
        if (!entity || entity.dead || entity.isCollidable === false || !entity.hexGrid) continue;
        updateRingQueryEntityPose(ring, seg, entity);

        const er = Math.max(80, Number(entity.radius) || 120);
        const ex = Number(entity.x) || 0;
        const ey = Number(entity.y) || 0;
        const reach = qr + er + 320;
        const edx = ex - qx;
        const edy = ey - qy;
        if (edx * edx + edy * edy > reach * reach) continue;

        appendQueryTarget(entity);
      }
    }
  }
}

function queryPotentialTargets(x, y, radius = 0) {
  const cellSize = CONFIG.queryCellSize;
  const baseX = Math.floor((Number(x) || 0) / cellSize);
  const baseY = Math.floor((Number(y) || 0) / cellSize);
  const span = Math.max(1, Math.ceil((Number(radius) || 0) / cellSize) + 1);

  state.queryCount = 0;
  nextQuerySerial();
  for (let ix = -span; ix <= span; ix++) {
    for (let iy = -span; iy <= span; iy++) {
      const key = `${baseX + ix},${baseY + iy}`;
      const cell = state.queryCells.get(key);
      if (!cell) continue;
      for (let i = 0; i < cell.length; i++) {
        appendQueryTarget(cell[i]);
      }
    }
  }
  appendOnDemandRingTargets(x, y, radius);
  return { buffer: state.queryResult, count: state.queryCount };
}

function clearRingCityVisuals(ring) {
  if (!ring?.visualMeshes?.length || !ring.ringFloor) return;
  for (let i = ring.visualMeshes.length - 1; i >= 0; i--) {
    const vm = ring.visualMeshes[i];
    if (!vm?.isDistrict && !vm?.isInfrastructure) continue;
    if (vm.mesh?.parent) vm.mesh.parent.remove(vm.mesh);
    if (vm.mesh?.traverse) {
      vm.mesh.traverse((obj) => {
        obj.geometry?.dispose?.();
      });
    } else {
      vm.mesh?.geometry?.dispose?.();
    }
    ring.visualMeshes.splice(i, 1);
  }
}

function autoFillRingCity(ring) {
  if (!ring?.zoneGrid || !ring.ringFloor) return false;
  clearRingCityVisuals(ring);
  ring.zoneGrid.fillWithZones();
  const districtMeshes = buildAllDistricts(ring.zoneGrid, ring);
  ring.visualMeshes.push(...districtMeshes);
  const infraMeshes = buildAllInfrastructure(ring.zoneGrid, ring);
  ring.visualMeshes.push(...infraMeshes);
  ring._autoFilledCity = true;
  return true;
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
      autoFillRingCity(ring);
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
    let aliveSegmentLayers = 0;
    for (const seg of ring.segmentData) {
      let segmentAlive = false;
      const entities = Array.isArray(seg?.entities) ? seg.entities : null;
      const count = entities ? entities.length : (seg?.entity ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const entity = entities ? entities[i] : seg.entity;
        if (!entity || entity.dead) continue;
        aliveSegmentLayers++;
        segmentAlive = true;
      }
      if (segmentAlive) aliveSegments++;
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
      aliveSegmentLayers,
      forceFieldCount: ring.forceFields.length,
      hidden: ring._ringHidden === true,
      entitiesActive: ring._ringEntitiesActive === true,
      rootAttached: ring._rootAttached === true,
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

