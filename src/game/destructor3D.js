/**
 * destructor3D — port zasady działania destructor.js (hybrydowa destrukcja heksowa 2D)
 * na komórki sześcienne 3D i ciała sztywne 6DoF (pozycja Vector3 + kwaternion).
 *
 * Zachowane 1:1 z pierwowzoru (tylko wymiar wyżej):
 *  - broadphase sferyczny → bramka OBB SAT (15 osi zamiast 4),
 *  - narrowphase: iteracja po komórkach BRZEGOWYCH mniejszego ciała, okno kratownicy
 *    drugiego ciała, test kula–kula, redukcja kontaktów do wspólnej normalnej,
 *  - impuls sztywny + tryby crush: isDestruction / dominantRamming / overrun / hardWall
 *    z capami damage (getRammingDamageCap) i stemplem zgniotu (crash stamp),
 *  - deformacja: applyDeformation (kick + prędkość falowa), propagacja sprężysta
 *    CPU/GPU, pieczenie plastyczności powyżej yieldPoint,
 *  - sen/budzenie siatek, splitQueue → findIslands (BFS po sąsiadach) → wraki
 *    z odziedziczonym pędem i DOKŁADNIE przeliczonym tensorem bezwładności.
 *
 * Moduł nie importuje three — czysta matematyka, testowalny w node.
 * Stałe wymiarowe wyrażone względem cellSize (w 2D bazą był HEX_SPACING=13.5 px).
 */

import { DestructorGpuSoftBody3D } from './destructorGpuSoftBody3D.js';
import { packKey, invertSymmetric3, VOXEL_NEIGHBOR_OFFSETS } from './voxelBody3D.js';

export function createDestructor3DConfig(cellSize = 1) {
  const cs = Math.max(1e-6, Number(cellSize) || 1);
  return {
    cellSize: cs,
    cellHP: 80,
    inflictedDamageMult: 1.0,

    maxDeform: 7.4 * cs,          // 100 px / 13.5
    tearThreshold: 2.5 * cs,      // 34 px
    yieldPoint: 1.6 * cs,         // 22 px
    deformMul: 0.45,
    impactRadius: 3.0 * cs,       // pole trafienia broni (bendingRadius)
    collisionDeformScale: 1.15,

    softBodyTension: 0.14,
    gpuPropagationDamping: 0.96,
    visualLerpSpeed: 14.0,
    recoverSpeed: 1.0,
    repairRate: 100,

    restitution: 0.05,
    friction: 0.5,

    crashApproachSpeedThreshold: 15.0 * cs,   // 200 px/s
    crushPenetrationMin: 0.30,
    rammingCrushSpeedThreshold: 2.6 * cs,     // 35 px/s
    rammingCrushMassRatio: 2.5,
    rammingCrushScale: 0.70,
    rammingDamageCapMin: 0.08,
    rammingDamageCapMax: 1.40,
    rammingDamageCapLogScale: 0.16,
    rammingOverrunMassRatio: 8.0,
    rammingOverrunImpulseScale: 0.18,
    rammingOverrunSeparationPercent: 0.16,
    rammingOverrunDamageMin: 1.05,
    rammingOverrunDamageMult: 1.75,
    hardWallCrashSpeedThreshold: 11.0 * cs,   // 150 px/s
    hardWallCrashMassRatio: 2.5,
    hardWallCrashImpulseScale: 0.08,
    hardWallCrashNormalKeep: 0.04,
    hardWallCrashTangentKeep: 0.55,
    hardWallCrashCrushMult: 1.35,
    hardWallCrashDamageMin: 1.15,
    hardWallCrashDamageMult: 2.35,
    crashStampRadiusMin: 5.3 * cs,            // 72 px
    crashStampRadiusMax: 23.0 * cs,           // 320 px
    crashStampFrameSpeedScale: 0.36,
    crashStampMaxCells: 384,
    crashStampDamageMult: 1.20,
    crashStampDamageFrac: 0.18,
    overrunTargetVelocityKeep: 0.12,
    crushImpulseScale: 0.90,
    shearK: 0.06,

    collisionSearchRadius: 2,
    collisionIterations: 2,
    maxContacts: 48,
    contactRadiusScale: 0.82,
    cellHitRadiusFactor: 0.62,
    separationPercent: 0.92,
    crushSeparationPercent: 0.82,
    separationSlop: 0.01 * cs,

    applyDeformMaxInstant: 0.6 * cs,          // 8 px
    applyDeformMaxVel: 12.0 * cs,             // 160 px/s

    splitDamageThreshold: 200,
    splitCheckInterval: 12,
    splitMaxPerTick: 1,
    splitTimeBudgetMs: 1.5,
    splitCrashDeferTicks: 8,
    splitCrashSpeedThreshold: 10.4 * cs,      // 140 px/s
    wreckSplitLinearResponse: 0.23,
    wreckSplitOutwardKick: 0.6 * cs,
    wreckSplitAngularResponse: 0.030,
    wreckSplitMinAngularKick: 0.012,

    gpuSoftBody: 1,
    gpuSoftBodyMinCells: 64,
    gpuVelClamp: 13.0 * cs,                   // 180 px/s w kernelu 2D

    elasticSleepFrames: 30,
    elasticSleepThreshold: 0.011 * cs,
    elasticSleepVelocityThreshold: 0.0025 * cs,
    elasticSleepSnapThreshold: 0.003 * cs,
    elasticVisualThreshold: 0.004 * cs,
    elasticWakeFrames: 20,

    linearDamping: 0.02,
    angularDamping: 0.20
  };
}

// ============================ MATEMATYKA (scratch) ============================

function vset(o, x, y, z) { o.x = x; o.y = y; o.z = z; return o; }

function quatToMat3(q, m) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz); m[2] = 2 * (xz + wy);
  m[3] = 2 * (xy + wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
  m[6] = 2 * (xz - wy); m[7] = 2 * (yz + wx); m[8] = 1 - 2 * (xx + yy);
  return m;
}

// w = M·l (świat z lokalnych)
function matVec(m, x, y, z, o) {
  o.x = m[0] * x + m[1] * y + m[2] * z;
  o.y = m[3] * x + m[4] * y + m[5] * z;
  o.z = m[6] * x + m[7] * y + m[8] * z;
  return o;
}

// l = Mᵀ·w (lokalne ze świata)
function matVecT(m, x, y, z, o) {
  o.x = m[0] * x + m[3] * y + m[6] * z;
  o.y = m[1] * x + m[4] * y + m[7] * z;
  o.z = m[2] * x + m[5] * y + m[8] * z;
  return o;
}

function cross(ax, ay, az, bx, by, bz, o) {
  o.x = ay * bz - az * by;
  o.y = az * bx - ax * bz;
  o.z = ax * by - ay * bx;
  return o;
}

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

// I⁻¹_world · v = R · I⁻¹_local · Rᵀ · v
const _iiTmp = { x: 0, y: 0, z: 0 };
function applyInvInertia(body, vx, vy, vz, o) {
  if (body.static) return vset(o, 0, 0, 0);
  const m = body._rot;
  matVecT(m, vx, vy, vz, _iiTmp);
  const ii = body.invInertiaLocal;
  const lx = ii[0] * _iiTmp.x + ii[1] * _iiTmp.y + ii[2] * _iiTmp.z;
  const ly = ii[3] * _iiTmp.x + ii[4] * _iiTmp.y + ii[5] * _iiTmp.z;
  const lz = ii[6] * _iiTmp.x + ii[7] * _iiTmp.y + ii[8] * _iiTmp.z;
  return matVec(m, lx, ly, lz, o);
}

// Posortowane rosnąco po odległości offsety kuli — jak getSearchOffsets w 2D.
const SEARCH_OFFSETS_3D = Object.create(null);
function getSearchOffsets3D(radius) {
  const r = Math.max(0, radius | 0);
  let arr = SEARCH_OFFSETS_3D[r];
  if (arr) return arr;
  const list = [];
  const r2 = r * r;
  for (let dz = -r; dz <= r; dz++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= r2) list.push([dx, dy, dz, d2]);
      }
    }
  }
  list.sort((a, b) => a[3] - b[3]);
  const flat = new Int8Array(list.length * 3);
  for (let i = 0; i < list.length; i++) {
    flat[i * 3] = list[i][0];
    flat[i * 3 + 1] = list[i][1];
    flat[i * 3 + 2] = list[i][2];
  }
  arr = flat;
  SEARCH_OFFSETS_3D[r] = arr;
  return arr;
}

function getRammingDamageCap(cellHp, attackerMassAdvantage, cfg) {
  const hp = Math.max(1, Number(cellHp) || 1);
  const minFrac = Math.max(0.01, cfg.rammingDamageCapMin);
  const maxFrac = Math.max(minFrac, cfg.rammingDamageCapMax);
  const adv = Math.max(1, Number(attackerMassAdvantage) || 1);
  return hp * Math.min(maxFrac, minFrac + Math.log2(adv) * cfg.rammingDamageCapLogScale);
}

function getRamMass(body) {
  const m = Math.max(1, Number(body.mass) || 1);
  const mult = Number(body.rammingMassMult);
  return Number.isFinite(mult) && mult > 0 ? m * mult : m;
}

// ============================ CIAŁO / SIATKA ============================

let NEXT_BODY_ID = 1;

function makeCell(src, index, cfg) {
  return {
    ix: src.ix, iy: src.iy, iz: src.iz,
    gx: src.x, gy: src.y, gz: src.z,       // bieżąca baza (z zapieczoną plastycznością)
    ox: src.x, oy: src.y, oz: src.z,       // spoczynek / pristine dla GPU
    bkx: 0, bky: 0, bkz: 0,                // skumulowany bake plastyczny (= g - o)
    dx: 0, dy: 0, dz: 0,                   // deformacja wizualna
    tx: 0, ty: 0, tz: 0,                   // deformacja docelowa (fizyka)
    vx: 0, vy: 0, vz: 0,                   // prędkość falowa (broń / GPU)
    cvx: 0, cvy: 0, cvz: 0,                // prędkość kolizyjna (konsumowana przez GPU)
    hp: cfg.cellHP * src.coverage,
    maxHp: cfg.cellHP * src.coverage,
    mass: src.mass,
    hitRadius: cfg.cellSize * cfg.cellHitRadiusFactor * Math.max(0.55, Math.min(1, src.coverage + 0.15)),
    coverage: src.coverage,
    surface: !!src.surface,
    r: src.r, g: src.g, b: src.b,
    active: true,
    isDebris: false,
    neighbors: [],
    __meshIndex: index,
    __crushStamp: 0,
    __islandStamp: 0,
    exposed: false
  };
}

function buildLattice(cells) {
  const lattice = new Map();
  for (const c of cells) lattice.set(packKey(c.ix, c.iy, c.iz), c);
  return lattice;
}

function buildNeighbors(grid) {
  const lattice = grid.lattice;
  for (const c of grid.cells) {
    c.neighbors.length = 0;
    for (const [dx, dy, dz] of VOXEL_NEIGHBOR_OFFSETS) {
      const n = lattice.get(packKey(c.ix + dx, c.iy + dy, c.iz + dz));
      if (n) c.neighbors.push(n);
    }
  }
}

function updateGridBounds(grid) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let any = false;
  for (const c of grid.cells) {
    if (!c.active) continue;
    any = true;
    if (c.gx < minX) minX = c.gx; if (c.gx > maxX) maxX = c.gx;
    if (c.gy < minY) minY = c.gy; if (c.gy > maxY) maxY = c.gy;
    if (c.gz < minZ) minZ = c.gz; if (c.gz > maxZ) maxZ = c.gz;
  }
  if (!any) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }
  const h = grid.cellSize * 0.5;
  grid.bbCenter.x = (minX + maxX) * 0.5;
  grid.bbCenter.y = (minY + maxY) * 0.5;
  grid.bbCenter.z = (minZ + maxZ) * 0.5;
  grid.bbHalf.x = (maxX - minX) * 0.5 + h;
  grid.bbHalf.y = (maxY - minY) * 0.5 + h;
  grid.bbHalf.z = (maxZ - minZ) * 0.5 + h;
  let radius = 0;
  const cx = grid.bbCenter.x, cy = grid.bbCenter.y, cz = grid.bbCenter.z;
  const rx = grid.bbHalf.x, ry = grid.bbHalf.y, rz = grid.bbHalf.z;
  radius = Math.sqrt(cx * cx + cy * cy + cz * cz) + Math.sqrt(rx * rx + ry * ry + rz * rz);
  return radius;
}

function computeInertiaFromCells(cells, cellSize) {
  const cubeTerm = (cellSize * cellSize) / 6;
  let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
  for (const c of cells) {
    const m = c.mass;
    const px = c.gx, py = c.gy, pz = c.gz;
    ixx += m * (py * py + pz * pz + cubeTerm);
    iyy += m * (px * px + pz * pz + cubeTerm);
    izz += m * (px * px + py * py + cubeTerm);
    ixy -= m * px * py;
    ixz -= m * px * pz;
    iyz -= m * py * pz;
  }
  return invertSymmetric3([ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz]);
}

// ============================ SYSTEM ============================

export const Destructor3D = {
  config: null,
  splitQueue: [],
  onDebris: null,          // (body, cell, wx,wy,wz, vx,vy,vz) — hook renderera
  _tick: 0,
  _islandStamp: 1,
  _crushStampCounter: 0,
  _frameContacts: 0,
  _splitStamp: 1,

  perf: {
    lastUpdateMs: 0,
    lastCollisionMs: 0,
    lastSplitMs: 0,
    lastVisualMs: 0,
    lastContacts: 0,
    bodiesSplit: 0
  },

  _contacts: Array.from({ length: 96 }, () => ({
    cellA: null, cellB: null,
    ax: 0, ay: 0, az: 0,
    bx: 0, by: 0, bz: 0,
    nx: 0, ny: 0, nz: 0,
    penetration: 0
  })),

  init(config) {
    this.config = config;
    this.splitQueue.length = 0;
    this._tick = 0;
    DestructorGpuSoftBody3D.system = this;
    return this;
  },

  createBody(voxelBody, opts = {}) {
    const cfg = opts.config || this.config || createDestructor3DConfig(voxelBody.cellSize);
    const cells = voxelBody.cells.map((src, i) => makeCell(src, i, cfg));

    const grid = {
      cells,
      lattice: buildLattice(cells),
      nx: voxelBody.nx, ny: voxelBody.ny, nz: voxelBody.nz,
      cellSize: voxelBody.cellSize,
      latticeMin: { ...voxelBody.latticeMin },
      bbCenter: { x: 0, y: 0, z: 0 },
      bbHalf: { x: 0, y: 0, z: 0 },
      boundary: [],
      boundaryDirty: true,
      meshDirty: true,
      isSleeping: false,
      sleepFrames: 0,
      wakeHoldFrames: cfg.elasticWakeFrames | 0,
      activeCount: cells.length,
      baseCount: cells.length
    };
    buildNeighbors(grid);

    let mass = 0;
    for (const c of cells) mass += c.mass;
    mass = Math.max(1, mass);

    const body = {
      id: NEXT_BODY_ID++,
      name: opts.name || `body${NEXT_BODY_ID}`,
      pos: { x: 0, y: 0, z: 0, ...(opts.position || {}) },
      vel: { x: 0, y: 0, z: 0, ...(opts.velocity || {}) },
      quat: { x: 0, y: 0, z: 0, w: 1, ...(opts.quaternion || {}) },
      angVel: { x: 0, y: 0, z: 0, ...(opts.angularVelocity || {}) },
      mass,
      invMass: opts.static ? 0 : 1 / mass,
      static: !!opts.static,
      invInertiaLocal: voxelBody.invInertia ? voxelBody.invInertia.slice() : computeInertiaFromCells(cells, grid.cellSize),
      radius: 0,
      grid,
      config: cfg,
      dead: false,
      isWreck: false,
      noSplit: !!opts.noSplit,
      rammingMassMult: Number(opts.rammingMassMult) || 1,
      _rot: new Float64Array(9),
      _rotTick: -1,
      _gpuForceAwakeFrames: 0,
      _gpuRepairStamp: 0,
      _splitDeferUntilTick: 0,
      _splitStampSeen: 0
    };
    body.radius = updateGridBounds(grid);
    quatToMat3(body.quat, body._rot);
    body._rotTick = this._tick;
    return body;
  },

  wakeBody(body, holdFrames = 0) {
    const grid = body?.grid;
    if (!grid) return;
    grid.isSleeping = false;
    grid.sleepFrames = 0;
    if (holdFrames > 0) grid.wakeHoldFrames = Math.max(grid.wakeHoldFrames | 0, holdFrames | 0);
  },

  rebuildBoundary(grid) {
    if (!grid.boundaryDirty) return;
    grid.boundary.length = 0;
    for (const c of grid.cells) {
      if (!c.active) { c.exposed = false; continue; }
      let alive = 0;
      for (const n of c.neighbors) if (n.active) alive++;
      c.exposed = alive < 6;
      if (c.exposed) grid.boundary.push(c);
    }
    grid.boundaryDirty = false;
  },

  _refreshRot(body) {
    if (body._rotTick === this._tick) return body._rot;
    quatToMat3(body.quat, body._rot);
    body._rotTick = this._tick;
    return body._rot;
  },

  // --------------------------- INTEGRACJA ---------------------------

  integrate(dt, bodies) {
    const cfg = this.config;
    const linK = Math.exp(-(cfg?.linearDamping ?? 0) * dt);
    const angK = Math.exp(-(cfg?.angularDamping ?? 0) * dt);
    for (const b of bodies) {
      if (!b || b.dead || b.static) continue;
      b.vel.x *= linK; b.vel.y *= linK; b.vel.z *= linK;
      b.angVel.x *= angK; b.angVel.y *= angK; b.angVel.z *= angK;
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
      b.pos.z += b.vel.z * dt;

      const q = b.quat;
      const wx = b.angVel.x, wy = b.angVel.y, wz = b.angVel.z;
      const hx = 0.5 * dt * (wx * q.w + wy * q.z - wz * q.y);
      const hy = 0.5 * dt * (wy * q.w + wz * q.x - wx * q.z);
      const hz = 0.5 * dt * (wz * q.w + wx * q.y - wy * q.x);
      const hw = 0.5 * dt * (-wx * q.x - wy * q.y - wz * q.z);
      q.x += hx; q.y += hy; q.z += hz; q.w += hw;
      const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
      q.x /= len; q.y /= len; q.z /= len; q.w /= len;
    }
  },

  // --------------------------- PĘTLA FIZYKI ---------------------------

  update(dt, bodies) {
    const t0 = nowMs();
    this._tick++;
    this._frameContacts = 0;
    const cfg = this.config;
    const iters = Math.max(1, cfg.collisionIterations | 0);

    for (const b of bodies) if (b && !b.dead) this._refreshRot(b);

    for (let it = 0; it < iters; it++) {
      const doDamage = it === 0;
      for (let i = 0; i < bodies.length; i++) {
        const A = bodies[i];
        if (!A || A.dead || !A.grid || A.grid.activeCount <= 0) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const B = bodies[j];
          if (!B || B.dead || !B.grid || B.grid.activeCount <= 0) continue;
          if (A.static && B.static) continue;

          const dx = A.pos.x - B.pos.x;
          const dy = A.pos.y - B.pos.y;
          const dz = A.pos.z - B.pos.z;
          const relVx = A.vel.x - B.vel.x;
          const relVy = A.vel.y - B.vel.y;
          const relVz = A.vel.z - B.vel.z;
          const relSpeed = Math.sqrt(relVx * relVx + relVy * relVy + relVz * relVz);
          const margin = relSpeed * dt * 2 + cfg.cellSize * 2;
          const rs = A.radius + B.radius + margin;
          if (dx * dx + dy * dy + dz * dz > rs * rs) continue;

          // Iteracje > 0: pomiń pary katastroficzne i bardzo ciężkie (port bramki z 2D).
          const cellSum = A.grid.activeCount + B.grid.activeCount;
          const isCrashFrame = relSpeed > cfg.crashApproachSpeedThreshold;
          if (it > 0 && (isCrashFrame || cellSum > 9000)) continue;

          if (!this._obbOverlap(A, B, margin)) continue;
          this.collideBodies(A, B, dt, doDamage, relSpeed);
        }
      }
    }

    const tAfterCollision = nowMs();
    const splitInterval = Math.max(1, cfg.splitCheckInterval | 0);
    if (this._tick % splitInterval === 0 && this.splitQueue.length > 0) this.processSplits(bodies);
    const tEnd = nowMs();

    this.perf.lastUpdateMs = tEnd - t0;
    this.perf.lastCollisionMs = tAfterCollision - t0;
    this.perf.lastSplitMs = tEnd - tAfterCollision;
    this.perf.lastContacts = this._frameContacts;
  },

  // OBB SAT — 15 osi (Gottschalk). Half-extenty z AABB siatki + zapas na deformacje.
  _obbA: { c: { x: 0, y: 0, z: 0 }, he: [0, 0, 0] },
  _obbB: { c: { x: 0, y: 0, z: 0 }, he: [0, 0, 0] },
  _satR: new Float64Array(9),
  _satAbsR: new Float64Array(9),

  _obbOverlap(A, B, margin) {
    const cfg = this.config;
    const pad = cfg.maxDeform * cfg.collisionDeformScale + cfg.cellSize;
    const mA = this._refreshRot(A);
    const mB = this._refreshRot(B);
    const ga = A.grid, gb = B.grid;

    const oa = this._obbA, ob = this._obbB;
    matVec(mA, ga.bbCenter.x, ga.bbCenter.y, ga.bbCenter.z, oa.c);
    oa.c.x += A.pos.x; oa.c.y += A.pos.y; oa.c.z += A.pos.z;
    matVec(mB, gb.bbCenter.x, gb.bbCenter.y, gb.bbCenter.z, ob.c);
    ob.c.x += B.pos.x; ob.c.y += B.pos.y; ob.c.z += B.pos.z;
    oa.he[0] = ga.bbHalf.x + pad; oa.he[1] = ga.bbHalf.y + pad; oa.he[2] = ga.bbHalf.z + pad;
    ob.he[0] = gb.bbHalf.x + pad; ob.he[1] = gb.bbHalf.y + pad; ob.he[2] = gb.bbHalf.z + pad;

    // Osie = kolumny macierzy rotacji.
    const R = this._satR, AbsR = this._satAbsR;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        // colA_i · colB_j
        const v = mA[i] * mB[j] + mA[3 + i] * mB[3 + j] + mA[6 + i] * mB[6 + j];
        R[i * 3 + j] = v;
        AbsR[i * 3 + j] = Math.abs(v) + 1e-6;
      }
    }

    const tx = ob.c.x - oa.c.x, ty = ob.c.y - oa.c.y, tz = ob.c.z - oa.c.z;
    // t w układzie A
    const tA = [
      tx * mA[0] + ty * mA[3] + tz * mA[6],
      tx * mA[1] + ty * mA[4] + tz * mA[7],
      tx * mA[2] + ty * mA[5] + tz * mA[8]
    ];
    const m = Math.max(0, margin || 0);

    for (let i = 0; i < 3; i++) {
      const ra = oa.he[i];
      const rb = ob.he[0] * AbsR[i * 3] + ob.he[1] * AbsR[i * 3 + 1] + ob.he[2] * AbsR[i * 3 + 2];
      if (Math.abs(tA[i]) > ra + rb + m) return false;
    }
    for (let j = 0; j < 3; j++) {
      const ra = oa.he[0] * AbsR[j] + oa.he[1] * AbsR[3 + j] + oa.he[2] * AbsR[6 + j];
      const rb = ob.he[j];
      const t = Math.abs(tA[0] * R[j] + tA[1] * R[3 + j] + tA[2] * R[6 + j]);
      if (t > ra + rb + m) return false;
    }
    for (let i = 0; i < 3; i++) {
      const i1 = (i + 1) % 3, i2 = (i + 2) % 3;
      for (let j = 0; j < 3; j++) {
        const j1 = (j + 1) % 3, j2 = (j + 2) % 3;
        const ra = oa.he[i1] * AbsR[i2 * 3 + j] + oa.he[i2] * AbsR[i1 * 3 + j];
        const rb = ob.he[j1] * AbsR[i * 3 + j2] + ob.he[j2] * AbsR[i * 3 + j1];
        const t = Math.abs(tA[i2] * R[i1 * 3 + j] - tA[i1] * R[i2 * 3 + j]);
        if (t > ra + rb + m) return false;
      }
    }
    return true;
  },

  // --------------------------- NARROWPHASE + IMPULS ---------------------------

  _s1: { x: 0, y: 0, z: 0 }, _s2: { x: 0, y: 0, z: 0 }, _s3: { x: 0, y: 0, z: 0 },
  _s4: { x: 0, y: 0, z: 0 }, _s5: { x: 0, y: 0, z: 0 }, _s6: { x: 0, y: 0, z: 0 },
  _s7: { x: 0, y: 0, z: 0 }, _s8: { x: 0, y: 0, z: 0 },

  collideBodies(A, B, dt, doDamage, pairRelSpeed = 0) {
    const cfg = this.config;
    this.rebuildBoundary(A.grid);
    this.rebuildBoundary(B.grid);

    let iterator = A, holder = B;
    if (A.grid.boundary.length > B.grid.boundary.length) { iterator = B; holder = A; }

    const mI = this._refreshRot(iterator);
    const mH = this._refreshRot(holder);
    const hGrid = holder.grid;
    const cs = hGrid.cellSize;
    const cds = cfg.collisionDeformScale;
    const sr = Math.max(1, cfg.collisionSearchRadius | 0);
    const offsets = getSearchOffsets3D(sr);
    const contacts = this._contacts;
    const maxContacts = Math.min(contacts.length, Math.max(8, cfg.maxContacts | 0));
    let contactsCount = 0;

    const holderReach = holder.radius + cfg.maxDeform * cds + cs * 2;
    const holderReachSq = holderReach * holderReach;
    const swapped = iterator !== A;
    const wI = this._s1, lH = this._s2, wH = this._s3;

    const bList = iterator.grid.boundary;
    for (let i = 0; i < bList.length; i++) {
      const cI = bList[i];
      if (!cI.active) continue;

      // świat komórki iteratora (z deformacją kolizyjną)
      const lx = cI.gx + cI.dx * cds;
      const ly = cI.gy + cI.dy * cds;
      const lz = cI.gz + cI.dz * cds;
      matVec(mI, lx, ly, lz, wI);
      wI.x += iterator.pos.x; wI.y += iterator.pos.y; wI.z += iterator.pos.z;

      const hdx = wI.x - holder.pos.x;
      const hdy = wI.y - holder.pos.y;
      const hdz = wI.z - holder.pos.z;
      if (hdx * hdx + hdy * hdy + hdz * hdz > holderReachSq) continue;

      matVecT(mH, hdx, hdy, hdz, lH);
      const fi = (lH.x - hGrid.latticeMin.x) / cs;
      const fj = (lH.y - hGrid.latticeMin.y) / cs;
      const fk = (lH.z - hGrid.latticeMin.z) / cs;
      const ci = Math.floor(fi), cj = Math.floor(fj), ck = Math.floor(fk);
      if (ci < -sr || cj < -sr || ck < -sr || ci >= hGrid.nx + sr || cj >= hGrid.ny + sr || ck >= hGrid.nz + sr) continue;

      for (let oi = 0; oi < offsets.length; oi += 3) {
        const gx = ci + offsets[oi];
        const gy = cj + offsets[oi + 1];
        const gz = ck + offsets[oi + 2];
        if (gx < 0 || gy < 0 || gz < 0 || gx >= hGrid.nx || gy >= hGrid.ny || gz >= hGrid.nz) continue;
        const cH = hGrid.lattice.get(packKey(gx, gy, gz));
        if (!cH || !cH.active) continue;

        matVec(mH, cH.gx + cH.dx * cds, cH.gy + cH.dy * cds, cH.gz + cH.dz * cds, wH);
        wH.x += holder.pos.x; wH.y += holder.pos.y; wH.z += holder.pos.z;

        const nx = wI.x - wH.x, ny = wI.y - wH.y, nz = wI.z - wH.z;
        const distSq = nx * nx + ny * ny + nz * nz;
        const hitRad = (cI.hitRadius + cH.hitRadius) * cfg.contactRadiusScale;
        if (distSq >= hitRad * hitRad) continue;

        const dist = Math.sqrt(distSq);
        const ct = contacts[contactsCount];
        ct.cellA = swapped ? cH : cI;
        ct.cellB = swapped ? cI : cH;
        ct.ax = swapped ? wH.x : wI.x; ct.ay = swapped ? wH.y : wI.y; ct.az = swapped ? wH.z : wI.z;
        ct.bx = swapped ? wI.x : wH.x; ct.by = swapped ? wI.y : wH.y; ct.bz = swapped ? wI.z : wH.z;
        // normalna z B do A
        ct.nx = swapped ? -nx : nx; ct.ny = swapped ? -ny : ny; ct.nz = swapped ? -nz : nz;
        ct.penetration = Math.max(0, hitRad - dist);
        contactsCount++;
        break;
      }
      if (contactsCount >= maxContacts) break;
    }

    if (contactsCount === 0) return;

    this.wakeBody(A, cfg.elasticWakeFrames | 0);
    this.wakeBody(B, cfg.elasticWakeFrames | 0);
    this._frameContacts += contactsCount;

    // Redukcja kontaktów do wspólnego punktu i normalnej.
    let hitX = 0, hitY = 0, hitZ = 0, nX = 0, nY = 0, nZ = 0, penetration = 0;
    for (let i = 0; i < contactsCount; i++) {
      const ct = contacts[i];
      hitX += (ct.ax + ct.bx) * 0.5;
      hitY += (ct.ay + ct.by) * 0.5;
      hitZ += (ct.az + ct.bz) * 0.5;
      nX += ct.nx; nY += ct.ny; nZ += ct.nz;
      if (ct.penetration > penetration) penetration = ct.penetration;
    }
    hitX /= contactsCount; hitY /= contactsCount; hitZ /= contactsCount;

    let nLenSq = nX * nX + nY * nY + nZ * nZ;
    if (nLenSq < 1e-12) {
      nX = A.pos.x - B.pos.x; nY = A.pos.y - B.pos.y; nZ = A.pos.z - B.pos.z;
      nLenSq = nX * nX + nY * nY + nZ * nZ;
      if (nLenSq < 1e-12) { nX = 1; nY = 0; nZ = 0; nLenSq = 1; }
    }
    const invN = 1 / Math.sqrt(nLenSq);
    nX *= invN; nY *= invN; nZ *= invN;

    const rA = vset(this._s1, hitX - A.pos.x, hitY - A.pos.y, hitZ - A.pos.z);
    const rB = vset(this._s2, hitX - B.pos.x, hitY - B.pos.y, hitZ - B.pos.z);

    // prędkości punktu kontaktu
    const velA = this._s3;
    cross(A.angVel.x, A.angVel.y, A.angVel.z, rA.x, rA.y, rA.z, velA);
    velA.x += A.vel.x; velA.y += A.vel.y; velA.z += A.vel.z;
    const velB = this._s4;
    cross(B.angVel.x, B.angVel.y, B.angVel.z, rB.x, rB.y, rB.z, velB);
    velB.x += B.vel.x; velB.y += B.vel.y; velB.z += B.vel.z;

    const dvx = velA.x - velB.x, dvy = velA.y - velB.y, dvz = velA.z - velB.z;
    const impactSpeed = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
    const velAlongNormal = dvx * nX + dvy * nY + dvz * nZ;
    const approachSpeed = Math.max(0, -velAlongNormal);

    // oś środków — zbliżanie liczone też po niej (port effectiveApproachSpeed)
    let cnx = A.pos.x - B.pos.x, cny = A.pos.y - B.pos.y, cnz = A.pos.z - B.pos.z;
    const cLen = Math.sqrt(cnx * cnx + cny * cny + cnz * cnz) || 1;
    cnx /= cLen; cny /= cLen; cnz /= cLen;
    const relCx = A.vel.x - B.vel.x, relCy = A.vel.y - B.vel.y, relCz = A.vel.z - B.vel.z;
    const centerApproach = Math.max(0, -(relCx * cnx + relCy * cny + relCz * cnz));
    const effectiveApproachSpeed = Math.max(approachSpeed, centerApproach);

    const massA = getRamMass(A);
    const massB = getRamMass(B);
    const invMassA = A.static ? 0 : 1 / massA;
    const invMassB = B.static ? 0 : 1 / massB;
    const massRatio = Math.max(massA, massB) / Math.max(1, Math.min(massA, massB));

    // ---- Tryby zderzeń (port bram z 2D) ----
    const penRef = (A.grid.cellSize + B.grid.cellSize) * 0.5 * cfg.cellHitRadiusFactor;
    const deepCrushPenetration = penetration > penRef * cfg.crushPenetrationMin;
    const dominantMassPair = massRatio >= cfg.rammingCrushMassRatio;
    const directDominantRam = dominantMassPair && effectiveApproachSpeed > cfg.rammingCrushSpeedThreshold;
    const scrapeDominantRam = dominantMassPair && deepCrushPenetration && impactSpeed > cfg.rammingCrushSpeedThreshold;
    const overrunDominantRam = directDominantRam && massRatio >= cfg.rammingOverrunMassRatio;
    const dominantRammingCrush = directDominantRam || scrapeDominantRam;
    const hardWallCandidate = effectiveApproachSpeed > cfg.hardWallCrashSpeedThreshold;
    const hardWallCrushA = hardWallCandidate && !A.static && (B.static || massB >= massA * cfg.hardWallCrashMassRatio);
    const hardWallCrushB = hardWallCandidate && !B.static && (A.static || massA >= massB * cfg.hardWallCrashMassRatio);
    const hardWallCrash = hardWallCrushA || hardWallCrushB;
    const overrunDamageA = overrunDominantRam && massB > massA;
    const overrunDamageB = overrunDominantRam && massA > massB;
    const isDestruction = effectiveApproachSpeed > cfg.crashApproachSpeedThreshold;

    // ---- Impuls ----
    let bounceJ = 0;
    if (velAlongNormal < 0) {
      const iaN = applyInvInertia(A, rA.y * nZ - rA.z * nY, rA.z * nX - rA.x * nZ, rA.x * nY - rA.y * nX, this._s5);
      const tqA = cross(iaN.x, iaN.y, iaN.z, rA.x, rA.y, rA.z, this._s5);
      const ibN = applyInvInertia(B, rB.y * nZ - rB.z * nY, rB.z * nX - rB.x * nZ, rB.x * nY - rB.y * nX, this._s6);
      const tqB = cross(ibN.x, ibN.y, ibN.z, rB.x, rB.y, rB.z, this._s6);
      const denom = invMassA + invMassB +
        (tqA.x * nX + tqA.y * nY + tqA.z * nZ) +
        (tqB.x * nX + tqB.y * nY + tqB.z * nZ);

      if (Number.isFinite(denom) && denom > 1e-9) {
        const restitution = isDestruction ? 0 : cfg.restitution;
        let j = (-(1 + restitution) * velAlongNormal) / denom;
        if (hardWallCrash) j *= cfg.hardWallCrashImpulseScale;
        else if (overrunDominantRam) j *= cfg.rammingOverrunImpulseScale;
        else if (isDestruction) j *= 0.8;
        bounceJ = Math.abs(j);

        this._applyImpulse(A, rA, nX * j, nY * j, nZ * j, invMassA);
        this._applyImpulse(B, rB, -nX * j, -nY * j, -nZ * j, invMassB);

        // tarcie: składowa styczna prędkości względnej
        let tx = dvx - nX * velAlongNormal;
        let ty = dvy - nY * velAlongNormal;
        let tz = dvz - nZ * velAlongNormal;
        const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tLen > 1e-6) {
          tx /= tLen; ty /= tLen; tz /= tLen;
          const iaT = applyInvInertia(A, rA.y * tz - rA.z * ty, rA.z * tx - rA.x * tz, rA.x * ty - rA.y * tx, this._s5);
          const tqAT = cross(iaT.x, iaT.y, iaT.z, rA.x, rA.y, rA.z, this._s5);
          const ibT = applyInvInertia(B, rB.y * tz - rB.z * ty, rB.z * tx - rB.x * tz, rB.x * ty - rB.y * tx, this._s6);
          const tqBT = cross(ibT.x, ibT.y, ibT.z, rB.x, rB.y, rB.z, this._s6);
          const denomT = invMassA + invMassB +
            (tqAT.x * tx + tqAT.y * ty + tqAT.z * tz) +
            (tqBT.x * tx + tqBT.y * ty + tqBT.z * tz);
          if (Number.isFinite(denomT) && denomT > 1e-9) {
            let jt = -tLen / denomT;
            const maxF = bounceJ * cfg.friction;
            if (Math.abs(jt) > maxF) jt = -maxF;
            jt *= overrunDominantRam ? 0.12 : (isDestruction ? 0.25 : 0.8);
            this._applyImpulse(A, rA, tx * jt, ty * jt, tz * jt, invMassA);
            this._applyImpulse(B, rB, -tx * jt, -ty * jt, -tz * jt, invMassB);
          }
        }
      }
    }

    // hard wall: wytrać prędkość zamiast odbijać (port dampEntityAgainstHardWall)
    if (hardWallCrash) {
      if (hardWallCrushA) this._dampAgainstWall(A, B, nX, nY, nZ, cfg.hardWallCrashNormalKeep, cfg.hardWallCrashTangentKeep);
      if (hardWallCrushB) this._dampAgainstWall(B, A, -nX, -nY, -nZ, cfg.hardWallCrashNormalKeep, cfg.hardWallCrashTangentKeep);
    }
    if (overrunDominantRam) {
      if (overrunDamageA) this._dampOverrunTarget(A, B, -nX, -nY, -nZ, cfg.overrunTargetVelocityKeep);
      if (overrunDamageB) this._dampOverrunTarget(B, A, nX, nY, nZ, cfg.overrunTargetVelocityKeep);
    }

    // ---- Zgniot (deformacja + damage przy kontaktach) ----
    const crushActive = isDestruction || dominantRammingCrush || hardWallCrash;
    if (crushActive && doDamage) {
      A._gpuForceAwakeFrames = Math.max(A._gpuForceAwakeFrames | 0, 16);
      B._gpuForceAwakeFrames = Math.max(B._gpuForceAwakeFrames | 0, 16);

      // odrocz rozłam, aż zgniot się rozwinie (port splitCrashDefer)
      if (impactSpeed > cfg.splitCrashSpeedThreshold) {
        const deferUntil = this._tick + Math.max(4, cfg.splitCrashDeferTicks | 0);
        if (!A.noSplit) A._splitDeferUntilTick = Math.max(A._splitDeferUntilTick | 0, deferUntil);
        if (!B.noSplit) B._splitDeferUntilTick = Math.max(B._splitDeferUntilTick | 0, deferUntil);
      }

      const dtScale = dt * 60;
      const totalMass = massA + massB;
      const impulse = totalMass > 0 ? impactSpeed * (massA * massB) / totalMass : 0;
      const hardWallMult = hardWallCrash ? cfg.hardWallCrashCrushMult : 1;
      const crushEnergy = impulse * cfg.crushImpulseScale * dtScale * hardWallMult;

      // siła świata + ścinanie styczne
      let wfx = nX * crushEnergy, wfy = nY * crushEnergy, wfz = nZ * crushEnergy;
      const vtx = dvx - nX * velAlongNormal;
      const vty = dvy - nY * velAlongNormal;
      const vtz = dvz - nZ * velAlongNormal;
      const sh = cfg.shearK * dtScale;
      wfx += vtx * sh; wfy += vty * sh; wfz += vtz * sh;

      // udziały damage: kwadraty stosunków mas — faworyzują lżejsze ciało
      const baseRatioA = B.static ? 1 : (A.static ? 0 : massB / totalMass);
      const baseRatioB = A.static ? 1 : (B.static ? 0 : massA / totalMass);
      const sumSq = Math.max(1e-9, baseRatioA * baseRatioA + baseRatioB * baseRatioB);
      const realRatioA = (baseRatioA * baseRatioA) / sumSq;
      const realRatioB = (baseRatioB * baseRatioB) / sumSq;

      const lfA = matVecT(this._refreshRot(A), wfx, wfy, wfz, this._s5);
      const lfB = matVecT(this._refreshRot(B), -wfx, -wfy, -wfz, this._s6);
      const crushScale = (isDestruction || hardWallCrash) ? 1 : cfg.rammingCrushScale;

      let cAx = lfA.x * realRatioA * 2 * crushScale;
      let cAy = lfA.y * realRatioA * 2 * crushScale;
      let cAz = lfA.z * realRatioA * 2 * crushScale;
      let cBx = lfB.x * realRatioB * 2 * crushScale;
      let cBy = lfB.y * realRatioB * 2 * crushScale;
      let cBz = lfB.z * realRatioB * 2 * crushScale;

      const maxCrush = cfg.maxDeform;
      const magA = Math.sqrt(cAx * cAx + cAy * cAy + cAz * cAz);
      const magB = Math.sqrt(cBx * cBx + cBy * cBy + cBz * cBz);
      const limA = maxCrush * (0.15 + realRatioA);
      const limB = maxCrush * (0.15 + realRatioB);
      if (magA > limA && magA > 0) { const s = limA / magA; cAx *= s; cAy *= s; cAz *= s; }
      if (magB > limB && magB > 0) { const s = limB / magB; cBx *= s; cBy *= s; cBz *= s; }

      let stampB = (this._crushStampCounter + 2) | 0;
      if (stampB <= 1) stampB = 2;
      this._crushStampCounter = stampB;
      const stampA = stampB - 1;

      const massAdvA = massA / (massB + 1);
      const massAdvB = massB / (massA + 1);
      const capBaseA = getRammingDamageCap(cfg.cellHP, massAdvB, cfg);
      const capBaseB = getRammingDamageCap(cfg.cellHP, massAdvA, cfg);
      const overrunMin = cfg.cellHP * cfg.rammingOverrunDamageMin;
      const hardWallMin = cfg.cellHP * cfg.hardWallCrashDamageMin;
      const sqrtContacts = Math.sqrt(contactsCount);

      for (let c = 0; c < contactsCount; c++) {
        const ct = contacts[c];
        this._crushCell(
          A, ct.cellA, stampA, cAx, cAy, cAz, massAdvB, magA, realRatioA, sqrtContacts,
          doDamage, hardWallCrushA, overrunDamageA, capBaseA, hardWallMin, overrunMin, cfg
        );
        this._crushCell(
          B, ct.cellB, stampB, cBx, cBy, cBz, massAdvA, magB, realRatioB, sqrtContacts,
          doDamage, hardWallCrushB, overrunDamageB, capBaseB, hardWallMin, overrunMin, cfg
        );
      }

      // stempel zgniotu — pole obrażeń przy ciężkim wjeździe (port applyCrashStampDamage)
      if (hardWallCrushA || hardWallCrushB || overrunDamageA || overrunDamageB) {
        const frameTravel = effectiveApproachSpeed * Math.max(1 / 240, dt);
        const stampRadius = Math.min(cfg.crashStampRadiusMax, cfg.crashStampRadiusMin + frameTravel * cfg.crashStampFrameSpeedScale * 60);
        const stampDamage = cfg.cellHP * cfg.crashStampDamageMult;
        if (hardWallCrushA || overrunDamageA) {
          this._crashStamp(A, hitX, hitY, hitZ, stampRadius, stampDamage, cfg.crashStampMaxCells, nX, nY, nZ);
        }
        if (hardWallCrushB || overrunDamageB) {
          this._crashStamp(B, hitX, hitY, hitZ, stampRadius, stampDamage, cfg.crashStampMaxCells, -nX, -nY, -nZ);
        }
      }

      A.grid.meshDirty = true;
      B.grid.meshDirty = true;
    }

    // ---- Korekta separacji ----
    const slop = cfg.separationSlop;
    if (penetration > slop && (invMassA + invMassB) > 0) {
      const deepPen = penetration > penRef * 0.35;
      let sepPercent = cfg.separationPercent;
      if (overrunDominantRam) sepPercent = cfg.rammingOverrunSeparationPercent;
      else if (crushActive) sepPercent = deepPen ? 1.0 : cfg.crushSeparationPercent;
      const corr = (penetration - slop) / (invMassA + invMassB) * sepPercent;
      A.pos.x += nX * corr * invMassA; A.pos.y += nY * corr * invMassA; A.pos.z += nZ * corr * invMassA;
      B.pos.x -= nX * corr * invMassB; B.pos.y -= nY * corr * invMassB; B.pos.z -= nZ * corr * invMassB;
    }
  },

  _applyImpulse(body, r, jx, jy, jz, invMass) {
    if (invMass <= 0) return;
    body.vel.x += jx * invMass;
    body.vel.y += jy * invMass;
    body.vel.z += jz * invMass;
    const tq = cross(r.x, r.y, r.z, jx, jy, jz, this._s7);
    const dw = applyInvInertia(body, tq.x, tq.y, tq.z, this._s8);
    body.angVel.x += dw.x; body.angVel.y += dw.y; body.angVel.z += dw.z;
  },

  _dampAgainstWall(body, wall, nx, ny, nz, keepN, keepT) {
    const rvx = body.vel.x - wall.vel.x;
    const rvy = body.vel.y - wall.vel.y;
    const rvz = body.vel.z - wall.vel.z;
    const relN = rvx * nx + rvy * ny + rvz * nz;
    if (relN >= 0) return; // nie wjeżdża w ścianę
    const dN = relN * keepN - relN;
    body.vel.x += dN * nx; body.vel.y += dN * ny; body.vel.z += dN * nz;
    if (keepT >= 1) return;
    const rvx2 = body.vel.x - wall.vel.x;
    const rvy2 = body.vel.y - wall.vel.y;
    const rvz2 = body.vel.z - wall.vel.z;
    const relN2 = rvx2 * nx + rvy2 * ny + rvz2 * nz;
    const tX = rvx2 - nx * relN2, tY = rvy2 - ny * relN2, tZ = rvz2 - nz * relN2;
    const k = 1 - keepT;
    body.vel.x -= tX * k; body.vel.y -= tY * k; body.vel.z -= tZ * k;
  },

  _dampOverrunTarget(target, rammer, dx, dy, dz, keep) {
    // dx.. = kierunek taranowania (od rammera do celu)
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const nx = dx / len, ny = dy / len, nz = dz / len;
    const rammerN = rammer.vel.x * nx + rammer.vel.y * ny + rammer.vel.z * nz;
    if (rammerN <= 0) return;
    const targetN = target.vel.x * nx + target.vel.y * ny + target.vel.z * nz;
    const maxN = rammerN * Math.max(0, Math.min(1, keep));
    if (targetN <= maxN) return;
    const dN = maxN - targetN;
    target.vel.x += dN * nx; target.vel.y += dN * ny; target.vel.z += dN * nz;
  },

  _crushCell(body, cell, stamp, pushBaseX, pushBaseY, pushBaseZ, massAdvOther, rawMag, realRatio, sqrtContacts, doDamage, hardWall, overrun, capBase, hardWallMin, overrunMin, cfg) {
    if (!cell || !cell.active || cell.__crushStamp === stamp) return;
    cell.__crushStamp = stamp;

    const pushMult = 1 + Math.min(6, massAdvOther * 0.2);
    const px = pushBaseX * pushMult;
    const py = pushBaseY * pushMult;
    const pz = pushBaseZ * pushMult;

    this.applyDeformation(cell, px, py, pz, 1.0, true);

    // twardy limit deformacji (port hardLimitSq)
    const maxCrush = cfg.maxDeform;
    const hardLimitSq = maxCrush * maxCrush * 1.5;
    const defSq = cell.tx * cell.tx + cell.ty * cell.ty + cell.tz * cell.tz;
    if (defSq > hardLimitSq) {
      const s = Math.sqrt(hardLimitSq / defSq);
      cell.tx *= s; cell.ty *= s; cell.tz *= s;
      cell.dx *= s; cell.dy *= s; cell.dz *= s;
    }

    cell.cvx += px * 1.2; cell.cvy += py * 1.2; cell.cvz += pz * 1.2;

    if (doDamage) {
      const kinetic = (rawMag * realRatio * 0.18 * massAdvOther) / sqrtContacts;
      let damage = kinetic;
      let cap = capBase;
      if (hardWall) {
        damage = Math.max(damage * cfg.hardWallCrashDamageMult, hardWallMin);
        cap = Math.max(capBase, hardWallMin);
      } else if (overrun) {
        damage = Math.max(damage * cfg.rammingOverrunDamageMult, overrunMin);
        cap = Math.max(capBase, overrunMin);
      }
      cell.hp -= Math.min(cap, damage * cfg.inflictedDamageMult);
    }

    if (cell.hp <= 0) {
      this.destroyCell(body, cell);
      if (!body.noSplit && this.splitQueue.indexOf(body) === -1) this.splitQueue.push(body);
    }
  },

  // Pole obrażeń wokół punktu zgniotu (port applyCrashStampDamage).
  _crashStamp(body, wx, wy, wz, radius, damagePerCell, maxCells, fnx, fny, fnz) {
    const cfg = this.config;
    const grid = body.grid;
    const m = this._refreshRot(body);
    const l = matVecT(m, wx - body.pos.x, wy - body.pos.y, wz - body.pos.z, this._s5);
    const lf = matVecT(m, fnx, fny, fnz, this._s6);
    const cs = grid.cellSize;
    const rCells = Math.ceil(radius / cs) + 1;
    const ci = Math.floor((l.x - grid.latticeMin.x) / cs);
    const cj = Math.floor((l.y - grid.latticeMin.y) / cs);
    const ck = Math.floor((l.z - grid.latticeMin.z) / cs);
    const i0 = Math.max(0, ci - rCells), i1 = Math.min(grid.nx - 1, ci + rCells);
    const j0 = Math.max(0, cj - rCells), j1 = Math.min(grid.ny - 1, cj + rCells);
    const k0 = Math.max(0, ck - rCells), k1 = Math.min(grid.nz - 1, ck + rCells);
    const rSq = radius * radius;
    const invR = 1 / radius;
    const deformBase = Math.min(cfg.maxDeform * 0.85, Math.max(cs * 0.7, radius * 0.32));
    const dmgFrac = cfg.crashStampDamageFrac;
    let destroyed = 0;

    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cell = grid.lattice.get(packKey(i, j, k));
          if (!cell || !cell.active) continue;
          const ddx = cell.gx - l.x, ddy = cell.gy - l.y, ddz = cell.gz - l.z;
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 > rSq) continue;
          const factor = Math.max(0, 1 - Math.sqrt(d2) * invR);
          const influence = 0.35 + factor * 0.65;
          this.applyDeformation(cell, lf.x * deformBase * influence, lf.y * deformBase * influence, lf.z * deformBase * influence, 1.0, true);
          const capHp = Math.max(1, cell.maxHp);
          cell.hp -= Math.min(capHp * dmgFrac, damagePerCell * dmgFrac * (0.55 + factor * 0.45));
          if (cell.hp <= 0) {
            this.destroyCell(body, cell);
            destroyed++;
            if (destroyed >= maxCells) {
              if (!body.noSplit && this.splitQueue.indexOf(body) === -1) this.splitQueue.push(body);
              return destroyed;
            }
          }
        }
      }
    }
    if (destroyed > 0 && !body.noSplit && this.splitQueue.indexOf(body) === -1) this.splitQueue.push(body);
    return destroyed;
  },

  // --------------------------- DEFORMACJA / BROŃ ---------------------------

  applyDeformation(cell, vx, vy, vz, waveMult = 1.0, bypassLimit = false) {
    const cfg = this.config;
    const maxInstant = cfg.applyDeformMaxInstant;
    let ix = vx, iy = vy, iz = vz;
    const magSq = vx * vx + vy * vy + vz * vz;
    if (!bypassLimit && magSq > maxInstant * maxInstant) {
      const s = maxInstant / Math.sqrt(magSq);
      ix *= s; iy *= s; iz *= s;
    }
    cell.tx += ix; cell.ty += iy; cell.tz += iz;
    cell.dx += ix; cell.dy += iy; cell.dz += iz;

    cell.cvx += vx * 1.5 * waveMult;
    cell.cvy += vy * 1.5 * waveMult;
    cell.cvz += vz * 1.5 * waveMult;
    const maxVel = Math.max(cfg.cellSize * 0.1, cfg.applyDeformMaxVel * waveMult);
    const vSq = cell.cvx * cell.cvx + cell.cvy * cell.cvy + cell.cvz * cell.cvz;
    if (vSq > maxVel * maxVel) {
      const s = maxVel / Math.sqrt(vSq);
      cell.cvx *= s; cell.cvy *= s; cell.cvz *= s;
    }
  },

  // Rozkład uszkodzeń strukturalnych w polu kulistym (port distributeStructuralDamage).
  distributeStructuralDamage(body, lx, ly, lz, fx, fy, fz, damageScale = 1.0, customRadius = null) {
    const cfg = this.config;
    const grid = body.grid;
    this.wakeBody(body, cfg.elasticWakeFrames | 0);
    body._gpuForceAwakeFrames = Math.max(body._gpuForceAwakeFrames | 0, 30);

    const radius = customRadius || cfg.impactRadius;
    const invR = 1 / radius;
    const rSq = radius * radius;
    const deformMul = cfg.deformMul;
    const forceMag = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const cs = grid.cellSize;
    const rCells = Math.ceil(radius / cs) + 2;
    const ci = Math.floor((lx - grid.latticeMin.x) / cs);
    const cj = Math.floor((ly - grid.latticeMin.y) / cs);
    const ck = Math.floor((lz - grid.latticeMin.z) / cs);
    const i0 = Math.max(0, ci - rCells), i1 = Math.min(grid.nx - 1, ci + rCells);
    const j0 = Math.max(0, cj - rCells), j1 = Math.min(grid.ny - 1, cj + rCells);
    const k0 = Math.max(0, ck - rCells), k1 = Math.min(grid.nz - 1, ck + rCells);
    let anyDestroyed = false;
    let anyChange = false;

    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cell = grid.lattice.get(packKey(i, j, k));
          if (!cell || !cell.active) continue;
          const ddx = cell.gx - lx, ddy = cell.gy - ly, ddz = cell.gz - lz;
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 >= rSq) continue;
          const dist = Math.sqrt(d2);
          const factor = 1 - dist * invR;
          if (factor <= 0) continue;
          const influence = factor * factor * (3 - 2 * factor);

          const px = fx * influence * deformMul;
          const py = fy * influence * deformMul;
          const pz = fz * influence * deformMul;

          // 1) środek: natychmiastowy kick, 2) obrzeże: seed do propagacji
          if (factor > 0.58) {
            this.applyDeformation(cell, px * 0.28, py * 0.28, pz * 0.28, 0.60, false);
          } else {
            cell.tx += px * 0.16; cell.ty += py * 0.16; cell.tz += pz * 0.16;
          }
          // 3) fala osiowa
          const waveVel = 0.20 + influence * 0.10;
          cell.vx += px * waveVel; cell.vy += py * waveVel; cell.vz += pz * waveVel;
          // 4) rim-bulge promieniowy jako prędkość
          if (forceMag > 0.026 * cs && factor > 0.18 && factor < 0.72 && dist > 1e-4) {
            const rimVel = forceMag * influence * (1 - factor) * 0.06 / dist;
            cell.vx += ddx * rimVel; cell.vy += ddy * rimVel; cell.vz += ddz * rimVel;
          }
          anyChange = true;

          if (damageScale > 0) {
            const heat = (Math.abs(px) + Math.abs(py) + Math.abs(pz)) * 0.05 * (13.5 / cs);
            cell.hp -= heat;
            if (cell.hp <= 0) {
              this.destroyCell(body, cell);
              anyDestroyed = true;
            }
          }
        }
      }
    }

    if (anyChange) grid.meshDirty = true;
    if (anyDestroyed && !body.noSplit && this.splitQueue.indexOf(body) === -1) this.splitQueue.push(body);
  },

  // Trafienie broni w punkt świata (port applyImpact).
  applyImpact(body, wx, wy, wz, damage = 0, worldVel = null, opts = null) {
    const cfg = this.config;
    const grid = body?.grid;
    if (!grid) return false;
    const m = this._refreshRot(body);
    const l = matVecT(m, wx - body.pos.x, wy - body.pos.y, wz - body.pos.z, this._s5);
    const cs = grid.cellSize;

    // sonda: najbliższa aktywna komórka w oknie
    const sr = Math.max(2, cfg.collisionSearchRadius | 0);
    const offsets = getSearchOffsets3D(sr);
    const ci = Math.floor((l.x - grid.latticeMin.x) / cs);
    const cj = Math.floor((l.y - grid.latticeMin.y) / cs);
    const ck = Math.floor((l.z - grid.latticeMin.z) / cs);
    let hit = null;
    let bestD2 = Infinity;
    for (let oi = 0; oi < offsets.length; oi += 3) {
      const gx = ci + offsets[oi], gy = cj + offsets[oi + 1], gz = ck + offsets[oi + 2];
      if (gx < 0 || gy < 0 || gz < 0 || gx >= grid.nx || gy >= grid.ny || gz >= grid.nz) continue;
      const cell = grid.lattice.get(packKey(gx, gy, gz));
      if (!cell || !cell.active) continue;
      const ddx = cell.gx - l.x, ddy = cell.gy - l.y, ddz = cell.gz - l.z;
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      const rad = cell.hitRadius * 2;
      if (d2 < rad * rad && d2 < bestD2) { bestD2 = d2; hit = cell; }
    }
    if (!hit) return false;
    if (damage <= 0) return true;

    const lv = this._s6;
    if (worldVel) matVecT(m, worldVel.x, worldVel.y, worldVel.z, lv);
    else vset(lv, 0, 0, 0);
    let fLen = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
    if (fLen < 1e-3) {
      // brak wektora → pchnięcie promieniowe od punktu trafienia
      const rx = hit.gx - l.x, ry = hit.gy - l.y, rz = hit.gz - l.z;
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      const mag = Math.max(0.74 * cs, damage * 0.03 * cs);
      vset(lv, (rx / rl) * mag, (ry / rl) * mag, (rz / rl) * mag);
      fLen = mag;
    }

    const damageScale = Math.max(0.35, damage / 80);
    this.wakeBody(body, cfg.elasticWakeFrames | 0);
    this.distributeStructuralDamage(
      body, l.x, l.y, l.z,
      lv.x * 0.05 * damageScale, lv.y * 0.05 * damageScale, lv.z * 0.05 * damageScale,
      1.0, opts?.radius || cfg.impactRadius
    );

    hit.hp -= Math.max(1, damage * 0.9);
    if (hit.hp <= 0) {
      this.destroyCell(body, hit);
      if (!body.noSplit && damage >= cfg.splitDamageThreshold && this.splitQueue.indexOf(body) === -1) {
        this.splitQueue.push(body);
      }
    }
    grid.meshDirty = true;
    return true;
  },

  // Marsz promienia przez kratownicę (do klikania w demo).
  raycastBody(body, ox, oy, oz, dx, dy, dz, maxDist = 1e6) {
    const grid = body?.grid;
    if (!grid || body.dead) return null;
    const m = this._refreshRot(body);
    const lo = matVecT(m, ox - body.pos.x, oy - body.pos.y, oz - body.pos.z, this._s5);
    const ld = matVecT(m, dx, dy, dz, this._s6);
    const cs = grid.cellSize;

    // slab test vs AABB kratownicy
    const minX = grid.latticeMin.x, minY = grid.latticeMin.y, minZ = grid.latticeMin.z;
    const maxX = minX + grid.nx * cs, maxY = minY + grid.ny * cs, maxZ = minZ + grid.nz * cs;
    let t0 = 0, t1 = maxDist;
    const axes = [[lo.x, ld.x, minX, maxX], [lo.y, ld.y, minY, maxY], [lo.z, ld.z, minZ, maxZ]];
    for (const [o, d, mn, mx] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) return null;
        continue;
      }
      let ta = (mn - o) / d, tb = (mx - o) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }

    const step = cs * 0.33;
    for (let t = Math.max(0, t0); t <= t1; t += step) {
      const px = lo.x + ld.x * t, py = lo.y + ld.y * t, pz = lo.z + ld.z * t;
      const i = Math.floor((px - minX) / cs);
      const j = Math.floor((py - minY) / cs);
      const k = Math.floor((pz - minZ) / cs);
      if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz) continue;
      const cell = grid.lattice.get(packKey(i, j, k));
      if (cell && cell.active) {
        return {
          cell,
          t,
          x: ox + dx * t,
          y: oy + dy * t,
          z: oz + dz * t
        };
      }
    }
    return null;
  },

  // --------------------------- NISZCZENIE / ROZPADY ---------------------------

  destroyCell(body, cell, extraKick = null) {
    if (!cell || !cell.active) return;
    cell.active = false;
    cell.hp = 0;
    const grid = body.grid;
    grid.activeCount = Math.max(0, grid.activeCount - 1);
    grid.boundaryDirty = true;
    grid.meshDirty = true;
    this.wakeBody(body, this.config.elasticWakeFrames | 0);

    body.mass = Math.max(1, body.mass - cell.mass);
    if (!body.static) body.invMass = 1 / body.mass;

    if (this.onDebris) {
      const m = this._refreshRot(body);
      const w = matVec(m, cell.gx + cell.dx, cell.gy + cell.dy, cell.gz + cell.dz, this._s7);
      const rx = w.x, ry = w.y, rz = w.z;
      w.x += body.pos.x; w.y += body.pos.y; w.z += body.pos.z;
      // prędkość świata: ciało + ω×r + kopnięcie z deformacji/fali
      const kick = matVec(m,
        cell.dx * 2 + cell.vx + cell.cvx + (extraKick?.x || 0),
        cell.dy * 2 + cell.vy + cell.cvy + (extraKick?.y || 0),
        cell.dz * 2 + cell.vz + cell.cvz + (extraKick?.z || 0),
        this._s8
      );
      const wvx = body.vel.x + (body.angVel.y * rz - body.angVel.z * ry) + kick.x;
      const wvy = body.vel.y + (body.angVel.z * rx - body.angVel.x * rz) + kick.y;
      const wvz = body.vel.z + (body.angVel.x * ry - body.angVel.y * rx) + kick.z;
      this.onDebris(body, cell, w.x, w.y, w.z, wvx, wvy, wvz);
    }
  },

  findIslands(grid) {
    let stamp = (this._islandStamp + 1) | 0;
    if (stamp <= 0) stamp = 1;
    this._islandStamp = stamp;

    const groups = [];
    const stack = [];
    for (const seed of grid.cells) {
      if (!seed.active || seed.__islandStamp === stamp) continue;
      const group = [];
      stack.length = 0;
      stack.push(seed);
      seed.__islandStamp = stamp;
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur.active) continue;
        group.push(cur);
        for (const n of cur.neighbors) {
          if (!n.active || n.__islandStamp === stamp) continue;
          n.__islandStamp = stamp;
          stack.push(n);
        }
      }
      if (group.length) groups.push(group);
    }
    return groups;
  },

  processSplits(bodies) {
    const cfg = this.config;
    const queued = this.splitQueue;
    if (!queued.length) return;
    this.splitQueue = [];

    let stamp = (this._splitStamp + 1) | 0;
    if (stamp <= 0) stamp = 1;
    this._splitStamp = stamp;

    const startedAt = nowMs();
    const budget = Math.max(0.25, cfg.splitTimeBudgetMs);
    const maxPerTick = Math.max(1, cfg.splitMaxPerTick | 0);
    let processed = 0;
    const deferred = this.splitQueue;

    for (const body of queued) {
      if (!body || body.dead || !body.grid) continue;
      if (body._splitStampSeen === stamp) continue;
      body._splitStampSeen = stamp;

      const deferUntil = body._splitDeferUntilTick | 0;
      if (deferUntil > 0) {
        if (deferUntil > this._tick) { deferred.push(body); continue; }
        body._splitDeferUntilTick = 0;
      }
      if (processed >= maxPerTick || (nowMs() - startedAt) > budget) {
        deferred.push(body);
        continue;
      }

      const groups = this.findIslands(body.grid);
      if (groups.length <= 1) continue;
      groups.sort((a, b) => b.length - a.length);

      const main = groups[0];
      for (let gi = 1; gi < groups.length; gi++) {
        const group = groups[gi];
        if (group.length < 3) {
          for (const cell of group) this.destroyCell(body, cell);
          continue;
        }
        this._spawnWreck(body, group, bodies);
      }
      this._rebuildBodyFromCells(body, main);
      processed++;
      this.perf.bodiesSplit++;
    }
  },

  _centroidOfCells(cells, out) {
    let mx = 0, my = 0, mz = 0, mSum = 0;
    for (const c of cells) {
      mx += c.gx * c.mass; my += c.gy * c.mass; mz += c.gz * c.mass;
      mSum += c.mass;
    }
    const inv = mSum > 0 ? 1 / mSum : 0;
    vset(out, mx * inv, my * inv, mz * inv);
    out.mass = mSum;
    return out;
  },

  _shiftCells(cells, cx, cy, cz) {
    for (const c of cells) {
      c.gx -= cx; c.gy -= cy; c.gz -= cz;
      c.ox -= cx; c.oy -= cy; c.oz -= cz;
    }
  },

  _rebuildBodyFromCells(body, cells) {
    const grid = body.grid;
    const com = this._centroidOfCells(cells, this._s5);
    const m = this._refreshRot(body);
    const shiftW = matVec(m, com.x, com.y, com.z, this._s6);

    // przesunięcie ciała do nowego środka masy + zachowanie prędkości punktu
    body.pos.x += shiftW.x; body.pos.y += shiftW.y; body.pos.z += shiftW.z;
    body.vel.x += body.angVel.y * shiftW.z - body.angVel.z * shiftW.y;
    body.vel.y += body.angVel.z * shiftW.x - body.angVel.x * shiftW.z;
    body.vel.z += body.angVel.x * shiftW.y - body.angVel.y * shiftW.x;

    this._shiftCells(cells, com.x, com.y, com.z);
    grid.latticeMin.x -= com.x; grid.latticeMin.y -= com.y; grid.latticeMin.z -= com.z;

    grid.cells = cells;
    for (let i = 0; i < cells.length; i++) cells[i].__meshIndex = i;
    grid.lattice = buildLattice(cells);
    buildNeighbors(grid);
    grid.boundaryDirty = true;
    grid.meshDirty = true;
    grid.activeCount = cells.length;
    grid.baseCount = Math.max(grid.baseCount, cells.length);
    grid.isSleeping = false;
    grid.sleepFrames = 0;
    grid.wakeHoldFrames = this.config.elasticWakeFrames | 0;

    body.mass = Math.max(1, com.mass);
    if (!body.static) body.invMass = 1 / body.mass;
    body.invInertiaLocal = computeInertiaFromCells(cells, grid.cellSize);
    body.radius = updateGridBounds(grid);
  },

  _spawnWreck(parent, cells, bodies) {
    const cfg = this.config;
    const com = this._centroidOfCells(cells, this._s5);
    const m = this._refreshRot(parent);
    const comW = matVec(m, com.x, com.y, com.z, this._s6);

    // średnia prędkość falowa fragmentu + moment z fal (port spawnWreckEntity)
    let avx = 0, avy = 0, avz = 0;
    let tqx = 0, tqy = 0, tqz = 0;
    let energized = 0;
    for (const c of cells) {
      const lvx = c.vx + c.cvx, lvy = c.vy + c.cvy, lvz = c.vz + c.cvz;
      if (lvx * lvx + lvy * lvy + lvz * lvz < 1e-6) continue;
      avx += lvx; avy += lvy; avz += lvz;
      const rx = c.gx - com.x, ry = c.gy - com.y, rz = c.gz - com.z;
      tqx += ry * lvz - rz * lvy;
      tqy += rz * lvx - rx * lvz;
      tqz += rx * lvy - ry * lvx;
      energized++;
    }

    this._shiftCells(cells, com.x, com.y, com.z);

    const grid = {
      cells,
      lattice: buildLattice(cells),
      nx: parent.grid.nx, ny: parent.grid.ny, nz: parent.grid.nz,
      cellSize: parent.grid.cellSize,
      latticeMin: {
        x: parent.grid.latticeMin.x - com.x,
        y: parent.grid.latticeMin.y - com.y,
        z: parent.grid.latticeMin.z - com.z
      },
      bbCenter: { x: 0, y: 0, z: 0 },
      bbHalf: { x: 0, y: 0, z: 0 },
      boundary: [],
      boundaryDirty: true,
      meshDirty: true,
      isSleeping: false,
      sleepFrames: 0,
      wakeHoldFrames: cfg.elasticWakeFrames | 0,
      activeCount: cells.length,
      baseCount: cells.length
    };
    for (let i = 0; i < cells.length; i++) cells[i].__meshIndex = i;
    buildNeighbors(grid);

    const wreck = {
      id: NEXT_BODY_ID++,
      name: `${parent.name}-wrak`,
      pos: { x: parent.pos.x + comW.x, y: parent.pos.y + comW.y, z: parent.pos.z + comW.z },
      vel: {
        x: parent.vel.x + (parent.angVel.y * comW.z - parent.angVel.z * comW.y),
        y: parent.vel.y + (parent.angVel.z * comW.x - parent.angVel.x * comW.z),
        z: parent.vel.z + (parent.angVel.x * comW.y - parent.angVel.y * comW.x)
      },
      quat: { ...parent.quat },
      angVel: { ...parent.angVel },
      mass: Math.max(1, com.mass),
      invMass: 1 / Math.max(1, com.mass),
      static: false,
      invInertiaLocal: computeInertiaFromCells(cells, grid.cellSize),
      radius: 0,
      grid,
      config: cfg,
      dead: false,
      isWreck: true,
      noSplit: false,
      rammingMassMult: 1,
      _rot: new Float64Array(9),
      _rotTick: -1,
      _gpuForceAwakeFrames: 8,
      _gpuRepairStamp: 0,
      _splitDeferUntilTick: 0,
      _splitStampSeen: 0
    };
    wreck.radius = updateGridBounds(grid);
    quatToMat3(wreck.quat, wreck._rot);
    wreck._rotTick = this._tick;

    // impuls liniowy z fal + kopniak odśrodkowy
    if (energized > 0) {
      const inv = 1 / energized;
      const lw = matVec(m, avx * inv, avy * inv, avz * inv, this._s7);
      const resp = cfg.wreckSplitLinearResponse;
      wreck.vel.x += lw.x * resp; wreck.vel.y += lw.y * resp; wreck.vel.z += lw.z * resp;
    }
    const outLen = Math.sqrt(comW.x * comW.x + comW.y * comW.y + comW.z * comW.z);
    if (outLen > 1e-4) {
      const kick = cfg.wreckSplitOutwardKick;
      wreck.vel.x += (comW.x / outLen) * kick;
      wreck.vel.y += (comW.y / outLen) * kick;
      wreck.vel.z += (comW.z / outLen) * kick;
    }
    if (energized > 0) {
      const denom = Math.max(80, energized * Math.max(18, wreck.radius * wreck.radius * 0.08));
      const resp = cfg.wreckSplitAngularResponse;
      const tw = matVec(m, tqx, tqy, tqz, this._s7);
      let kx = (tw.x / denom) * resp, ky = (tw.y / denom) * resp, kz = (tw.z / denom) * resp;
      const kLen = Math.sqrt(kx * kx + ky * ky + kz * kz);
      const kMin = cfg.wreckSplitMinAngularKick;
      if (kLen < kMin && outLen > 1e-4) {
        kx = (comW.y / outLen) * kMin; ky = (comW.z / outLen) * kMin; kz = (comW.x / outLen) * kMin;
      }
      const kMax = 0.5;
      const kLen2 = Math.sqrt(kx * kx + ky * ky + kz * kz);
      if (kLen2 > kMax) { const s = kMax / kLen2; kx *= s; ky *= s; kz *= s; }
      wreck.angVel.x += kx; wreck.angVel.y += ky; wreck.angVel.z += kz;
    }

    if (Array.isArray(bodies) && !bodies.includes(wreck)) bodies.push(wreck);
    return wreck;
  },

  // --------------------------- WARSTWA WIZUALNA ---------------------------

  updateVisuals(dt, bodies) {
    const t0 = nowMs();
    const cfg = this.config;
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0.0001, dt)) : (1 / 60);
    const lerpK = Math.min(1, Math.max(0, cfg.visualLerpSpeed * step));
    const framesPerTick = Math.max(1, Math.round(step * 120));
    const sleepLimit = Math.max(1, cfg.elasticSleepFrames | 0);
    const visThreshold = cfg.elasticVisualThreshold;
    const velThreshold = cfg.elasticSleepVelocityThreshold;
    const snapThreshold = cfg.elasticSleepSnapThreshold;
    const sleepThreshold = cfg.elasticSleepThreshold;

    for (const body of bodies) {
      const grid = body?.grid;
      if (!grid || body.dead) continue;

      let wakeHold = grid.wakeHoldFrames | 0;
      if (wakeHold > 0) {
        wakeHold = Math.max(0, wakeHold - framesPerTick);
        grid.wakeHoldFrames = wakeHold;
      }
      const gpuAwake = (body._gpuForceAwakeFrames | 0) > 0;

      if (grid.isSleeping && wakeHold <= 0 && !gpuAwake) continue;

      let keepAwake = wakeHold > 0 || gpuAwake;
      let peak = 0;
      let changed = false;

      for (const cell of grid.cells) {
        if (!cell.active) continue;
        const diffX = cell.tx - cell.dx;
        const diffY = cell.ty - cell.dy;
        const diffZ = cell.tz - cell.dz;
        const aDiff = Math.abs(diffX) + Math.abs(diffY) + Math.abs(diffZ);
        const vel = Math.abs(cell.vx) + Math.abs(cell.vy) + Math.abs(cell.vz) +
          Math.abs(cell.cvx) + Math.abs(cell.cvy) + Math.abs(cell.cvz);
        if (vel > velThreshold) keepAwake = true;

        if (aDiff > visThreshold) {
          cell.dx += diffX * lerpK;
          cell.dy += diffY * lerpK;
          cell.dz += diffZ * lerpK;
          changed = true;
          keepAwake = true;
          const after = Math.abs(cell.tx - cell.dx) + Math.abs(cell.ty - cell.dy) + Math.abs(cell.tz - cell.dz);
          if (after > peak) peak = after;
          continue;
        }

        const restPeak = Math.max(
          Math.abs(cell.tx), Math.abs(cell.ty), Math.abs(cell.tz),
          Math.abs(cell.dx), Math.abs(cell.dy), Math.abs(cell.dz),
          vel
        );
        if (restPeak <= snapThreshold) {
          if (restPeak > 1e-5) {
            cell.dx = 0; cell.dy = 0; cell.dz = 0;
            cell.tx = 0; cell.ty = 0; cell.tz = 0;
            cell.vx = 0; cell.vy = 0; cell.vz = 0;
            cell.cvx = 0; cell.cvy = 0; cell.cvz = 0;
            changed = true;
          }
        } else {
          // O śnie decyduje AKTYWNOŚĆ (ruch do celu + prędkości), nie wielkość
          // trwałego wgniecenia — jak w 2D; inaczej pogięty kadłub nigdy nie zaśnie.
          const activity = Math.max(aDiff, vel);
          if (activity > peak) peak = activity;
        }
      }

      if (changed) grid.meshDirty = true;

      if (keepAwake) {
        grid.sleepFrames = 0;
        grid.isSleeping = false;
      } else if (peak <= sleepThreshold) {
        grid.sleepFrames = (grid.sleepFrames | 0) + framesPerTick;
        if (grid.sleepFrames >= sleepLimit) grid.isSleeping = true;
      } else {
        grid.sleepFrames = 0;
        grid.isSleeping = false;
      }
    }

    DestructorGpuSoftBody3D.tick(bodies, cfg, step);
    this.simulateElasticity(bodies, step);
    this.perf.lastVisualMs = nowMs() - t0;
  },

  // Propagacja sprężysta CPU — fallback / małe ciała (port simulateElasticity).
  simulateElasticity(bodies, dt) {
    const cfg = this.config;
    const tension = cfg.softBodyTension;
    if (tension <= 0) return;
    const k = 1 - Math.exp(-tension * dt * 60);
    const useGpu = (cfg.gpuSoftBody | 0) === 1 && DestructorGpuSoftBody3D.active;
    const gpuMin = cfg.gpuSoftBodyMinCells | 0;
    const yieldP = cfg.yieldPoint;
    const yieldSq = yieldP * yieldP;

    for (const body of bodies) {
      const grid = body?.grid;
      if (!grid || body.dead) continue;
      if (grid.isSleeping && (grid.wakeHoldFrames | 0) <= 0) continue;
      const count = grid.activeCount;
      if (useGpu && count >= gpuMin) continue; // to ciało liczy GPU
      if (count > 4000) continue;              // CPU killer guard

      let changed = false;
      for (const cell of grid.cells) {
        if (!cell.active) continue;
        const ax = cell.tx, ay = cell.ty, az = cell.tz;
        const defSq = ax * ax + ay * ay + az * az;
        const isResting = defSq < 1e-4;

        // pieczenie plastyczne powyżej yieldPoint
        const defLen = Math.sqrt(defSq);
        if (defLen > yieldP) {
          const ratio = (defLen - yieldP) / defLen;
          const bx = cell.tx * ratio, by = cell.ty * ratio, bz = cell.tz * ratio;
          cell.gx += bx; cell.gy += by; cell.gz += bz;
          cell.bkx += bx; cell.bky += by; cell.bkz += bz;
          cell.tx -= bx; cell.ty -= by; cell.tz -= bz;
          changed = true;
        }

        for (const n of cell.neighbors) {
          if (!n.active) continue;
          if (n.__meshIndex <= cell.__meshIndex) continue; // każda para raz
          const bx = n.tx, by = n.ty, bz = n.tz;
          if (isResting && bx * bx + by * by + bz * bz < 1e-4) continue;
          const curK = defSq > yieldSq ? k * 0.1 : k;
          const avgX = (ax + bx) * 0.5, avgY = (ay + by) * 0.5, avgZ = (az + bz) * 0.5;
          const dax = (avgX - ax) * curK, day = (avgY - ay) * curK, daz = (avgZ - az) * curK;
          const dbx = (avgX - bx) * curK, dby = (avgY - by) * curK, dbz = (avgZ - bz) * curK;
          if (Math.abs(dax) > 1e-6 || Math.abs(day) > 1e-6 || Math.abs(daz) > 1e-6 ||
            Math.abs(dbx) > 1e-6 || Math.abs(dby) > 1e-6 || Math.abs(dbz) > 1e-6) {
            changed = true;
          }
          cell.tx += dax; cell.ty += day; cell.tz += daz;
          n.tx += dbx; n.ty += dby; n.tz += dbz;
        }
      }

      if (changed) {
        grid.meshDirty = true;
        grid.isSleeping = false;
        grid.sleepFrames = 0;
      }
    }
  },

  // Naprawa (klawisz R w demo dla ciała gracza) — port DestructorSystem.repair.
  repair(bodies, dt) {
    const cfg = this.config;
    const step = Number.isFinite(dt) ? Math.max(0.0001, dt) : 0.1;
    const k = Math.min(1, cfg.recoverSpeed * step);
    const keep = 1 - k;
    let repaired = false;
    for (const body of bodies) {
      const grid = body?.grid;
      if (!grid || body.dead) continue;
      let any = false;
      for (const cell of grid.cells) {
        if (!cell.active) continue;
        const offX = cell.gx - cell.ox, offY = cell.gy - cell.oy, offZ = cell.gz - cell.oz;
        const needs =
          Math.abs(cell.dx) > 1e-3 || Math.abs(cell.dy) > 1e-3 || Math.abs(cell.dz) > 1e-3 ||
          Math.abs(cell.tx) > 1e-3 || Math.abs(cell.ty) > 1e-3 || Math.abs(cell.tz) > 1e-3 ||
          Math.abs(offX) > 1e-3 || Math.abs(offY) > 1e-3 || Math.abs(offZ) > 1e-3 ||
          cell.hp < cell.maxHp;
        if (!needs) continue;
        cell.dx *= keep; cell.dy *= keep; cell.dz *= keep;
        cell.tx *= keep; cell.ty *= keep; cell.tz *= keep;
        cell.gx -= offX * k; cell.gy -= offY * k; cell.gz -= offZ * k;
        cell.bkx = cell.gx - cell.ox; cell.bky = cell.gy - cell.oy; cell.bkz = cell.gz - cell.oz;
        cell.vx = 0; cell.vy = 0; cell.vz = 0;
        cell.cvx = 0; cell.cvy = 0; cell.cvz = 0;
        cell.hp = Math.min(cell.maxHp, cell.hp + cfg.repairRate * step);
        any = true;
      }
      if (any) {
        repaired = true;
        body._gpuRepairStamp = ((body._gpuRepairStamp | 0) + 1) | 0;
        this.wakeBody(body, cfg.elasticWakeFrames | 0);
        grid.meshDirty = true;
      }
    }
    return repaired;
  }
};

export { getSearchOffsets3D, getRammingDamageCap, quatToMat3 };
