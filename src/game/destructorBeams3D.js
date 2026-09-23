/**
 * destructorBeams3D — silnik destrukcji na WĘZŁACH i BELKACH (model BeamNG).
 *
 * Różnice względem destructor3D (kratownica wokseli):
 *  - stanem węzła jest jego POZYCJA, nie „baza + deformacja + cel + zapieczenie",
 *  - odkształcenie plastyczne siedzi w długościach spoczynkowych belek, nie w węzłach,
 *  - zniszczenie to ZERWANA BELKA, nie martwa komórka — cięcie wychodzi samo,
 *  - solver to PBD (bezwarunkowo stabilny), nie jawne całkowanie sprężyn,
 *  - powłoka jest triangulowana (przekątne ścienne), więc ma sztywność na ścinanie.
 *
 * Ruch całości niesie ciało sztywne 6DoF (pozycja + kwaternion); belki odpowiadają
 * wyłącznie za deformację WZGLĘDEM kształtu spoczynkowego. Ten podział jest tańszy
 * od pełnego BeamNG (gdzie transform wynika z węzłów) i pozwala zachować sprawdzony
 * solver kontaktów z destructor3D.
 */

import { BEAM_TYPE, computeNodeSetInertia, cloneBeam } from './beamBody3D.js';
import { beamSolverScratch, refreshBeamMounts, prepareBeamConstraints, projectBeamConstraints } from './beamConstraintSolver3D.js';
import { updateBeamBounds, beamBoundsOverlap } from './beamBounds3D.js';
import { beamConnectivityScratch, findBeamBridges } from './beamConnectivity3D.js';

export function createBeamConfig(cellSize = 1) {
  const cs = Math.max(1e-6, Number(cellSize) || 1);
  return {
    cellSize: cs,

    // --- solver miękkiego ciała ---
    solverIterations: 3,
    nodeDamping: 0.12,          // tłumienie prędkości węzłów (na sekundę)
    plasticRate: 0.55,          // ile odkształcenia ponad próg zostaje na stałe
    maxRestDrift: 0.75,         // limit zmiany długości spoczynkowej (× oryginał)
    plasticFatigue: 1.0,       // narastanie uszkodzeń przy ponownym przekraczaniu granicy plastycznej
    breakEnabled: 1,
    globalStiffnessMul: 1.0,
    globalBreakMul: 1.0,

    // --- kolizje ---
    nodeRadius: cs * 0.55,
    collisionIterations: 2,
    maxContacts: 128,
    restitution: 0.05,
    friction: 0.5,
    separationPercent: 0.9,
    separationSlop: cs * 0.02,

    // Ile penetracji przechodzi w lokalny zgniot węzłów. To ta liczba decyduje,
    // czy kadłuby się odbijają, czy wzajemnie wgniatają.
    crushTransfer: 0.85,
    crushSpeedThreshold: 3.0 * cs,
    crushMassBias: 0.65,
    crushBuckling: 0.65,

    // --- broń ---
    impactRadius: 3.0 * cs,
    impactBeamBreakRadius: 1.6 * cs,
    impactPush: 0.9,

    // --- rozpady ---
    splitCheckInterval: 10,
    splitMinNodes: 4,
    detachTornJoints: true,    // przerwane usztywnienie nie staje się pojedynczą linką
    mountMinSupportRatio: 0.3,
    splitMaxPerTick: 2,
    splitMaxFragments: 20,
    maxWrecks: 48,
    wreckOutwardKick: 0.5 * cs,
    wreckSpinResponse: 0.02,

    // --- ciało sztywne ---
    linearDamping: 0.02,
    angularDamping: 0.20,

    // --- sen ---
    sleepFrames: 40,
    sleepMotionThreshold: 0.004 * cs,
    wakeHoldFrames: 24
  };
}

// ============================ MATEMATYKA ============================

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

function matVec(m, x, y, z, o) {
  o.x = m[0] * x + m[1] * y + m[2] * z;
  o.y = m[3] * x + m[4] * y + m[5] * z;
  o.z = m[6] * x + m[7] * y + m[8] * z;
  return o;
}

function matVecT(m, x, y, z, o) {
  o.x = m[0] * x + m[3] * y + m[6] * z;
  o.y = m[1] * x + m[4] * y + m[7] * z;
  o.z = m[2] * x + m[5] * y + m[8] * z;
  return o;
}

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now() : Date.now();
}

const _ii = { x: 0, y: 0, z: 0 };
function applyInvInertia(body, vx, vy, vz, o) {
  if (body.static) { o.x = 0; o.y = 0; o.z = 0; return o; }
  const m = body._rot;
  matVecT(m, vx, vy, vz, _ii);
  const I = body.invInertiaLocal;
  const lx = I[0] * _ii.x + I[1] * _ii.y + I[2] * _ii.z;
  const ly = I[3] * _ii.x + I[4] * _ii.y + I[5] * _ii.z;
  const lz = I[6] * _ii.x + I[7] * _ii.y + I[8] * _ii.z;
  const scale = 1 / Math.max(1e-6, body.rammingMassMult);
  return matVec(m, lx * scale, ly * scale, lz * scale, o);
}

// Hash przestrzenny nad pozycjami węzłów. Węzły nie leżą już na regularnej
// kratownicy (deformują się), więc lookup po indeksie komórki odpada.
const HASH_BIAS = 512;
function hashKey(i, j, k) {
  return ((i + HASH_BIAS) | 0) | (((j + HASH_BIAS) | 0) << 10) | (((k + HASH_BIAS) | 0) << 20);
}

let NEXT_BODY_ID = 1;

// ============================ SYSTEM ============================

export const DestructorBeams3D = {
  config: null,
  splitQueue: [],
  onDebris: null,
  _tick: 0,
  _islandStamp: 1,
  _contactStamp: 1,

  perf: {
    lastUpdateMs: 0,
    lastSolverMs: 0,
    lastCollisionMs: 0,
    lastSplitMs: 0,
    contacts: 0,
    beamsBroken: 0,
    solvedBeams: 0,
    broadphasePairs: 0,
    aabbRejected: 0,
    narrowphasePairs: 0
  },

  _s1: { x: 0, y: 0, z: 0 }, _s2: { x: 0, y: 0, z: 0 }, _s3: { x: 0, y: 0, z: 0 },
  _s4: { x: 0, y: 0, z: 0 }, _s5: { x: 0, y: 0, z: 0 }, _s6: { x: 0, y: 0, z: 0 },

  init(config) {
    this.config = config;
    this.splitQueue.length = 0;
    this._tick = 0;
    this.perf.beamsBroken = 0;
    return this;
  },

  createBody(structure, opts = {}) {
    const cfg = opts.config || this.config || createBeamConfig(structure.cellSize);
    const massMultiplier = Math.max(1e-6, Number(opts.massMultiplier) || 1);
    if (massMultiplier !== 1) {
      for (const n of structure.nodes) {
        n.mass *= massMultiplier;
        n.invMass /= massMultiplier;
      }
    }
    const body = {
      id: NEXT_BODY_ID++,
      name: opts.name || `beam${NEXT_BODY_ID}`,
      pos: { x: 0, y: 0, z: 0, ...(opts.position || {}) },
      vel: { x: 0, y: 0, z: 0, ...(opts.velocity || {}) },
      quat: { x: 0, y: 0, z: 0, w: 1, ...(opts.quaternion || {}) },
      angVel: { x: 0, y: 0, z: 0, ...(opts.angularVelocity || {}) },
      mass: structure.mass * massMultiplier,
      invMass: opts.static ? 0 : 1 / (structure.mass * massMultiplier),
      static: !!opts.static,
      invInertiaLocal: structure.invInertia.map(v => v / massMultiplier),
      radius: structure.radius,
      config: cfg,
      nodes: structure.nodes,
      beams: structure.beams,
      cellSize: structure.cellSize,
      dims: structure.dims,
      latticeMin: { ...structure.latticeMin },
      // Układ kratownicy z chwili utworzenia — skóra mapuje po nim wierzchołki
      // i mapowanie musi przeżyć recentrowanie fragmentów przy rozłamie.
      skinLatticeMin: { ...structure.latticeMin },
      skin: structure.skin || null,
      activeNodes: structure.nodes.length,
      liveBeams: structure.beams.length,
      dead: false,
      isWreck: false,
      noSplit: !!opts.noSplit,
      rammingMassMult: Number(opts.rammingMassMult) || 1,
      meshDirty: true,
      structureDirty: true,
      isSleeping: false,
      sleepFrames: 0,
      wakeHold: cfg.wakeHoldFrames,
      _rot: new Float64Array(9),
      _rotTick: -1,
      _hash: new Map(),
      _hashTick: -1,
      _contactCursor: 0,
      _contacts: [],
      _contactDepths: [],
      _integrity: new Int32Array(structure.nodes.length),
      _connectivity: null,
      _splitDefer: 0
    };
    quatToMat3(body.quat, body._rot);
    updateBeamBounds(body);
    beamSolverScratch(body);
    return body;
  },

  wake(body, hold = 0) {
    if (!body) return;
    body.isSleeping = false;
    body.sleepFrames = 0;
    if (hold > 0) body.wakeHold = Math.max(body.wakeHold | 0, hold | 0);
  },

  _refreshRot(body) {
    if (body._rotTick === this._tick) return body._rot;
    quatToMat3(body.quat, body._rot);
    body._rotTick = this._tick;
    return body._rot;
  },

  _refreshHash(body) {
    if (body._hashTick === this._tick || (body.static && body._hashTick >= 0)) return body._hash;
    const hash = body._hash;
    hash.clear();
    const cs = body.cellSize;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const n of body.nodes) {
      if (!n.active) continue;
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
      const key = hashKey(Math.floor(n.x / cs), Math.floor(n.y / cs), Math.floor(n.z / cs));
      n._hashNext = hash.get(key) || null;
      hash.set(key, n);
    }
    body._hashMinX = minX; body._hashMaxX = maxX;
    body._hashMinY = minY; body._hashMaxY = maxY;
    body._hashMinZ = minZ; body._hashMaxZ = maxZ;
    body._hashTick = this._tick;
    return hash;
  },

  // --------------------------- CAŁKOWANIE CIAŁA SZTYWNEGO ---------------------------

  integrate(dt, bodies) {
    const cfg = this.config;
    const linK = Math.exp(-cfg.linearDamping * dt);
    const angK = Math.exp(-cfg.angularDamping * dt);
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

  // --------------------------- SOLVER MIĘKKIEGO CIAŁA (PBD) ---------------------------

  solveSoftBody(dt, bodies) {
    const t0 = nowMs();
    const cfg = this.config;
    const iterations = Math.max(1, cfg.solverIterations | 0);
    const damp = Math.exp(-cfg.nodeDamping * dt * 60);
    const plasticRate = 1 - Math.pow(1 - Math.min(1, cfg.plasticRate), dt * 120);
    const stepScaleSq = (dt * 120) ** 2;
    let solved = 0;
    let broke = 0;

    for (const body of bodies) {
      if (!body || body.dead || body.static) continue;
      if (body.isSleeping && (body.wakeHold | 0) <= 0) continue;

      const nodes = body.nodes;
      const beams = body.beams;
      const scratch = beamSolverScratch(body);
      if (cfg.breakEnabled) refreshBeamMounts(body, scratch, cfg);
      const positions = scratch.positions;

      // 1) predykcja pozycji z prędkości
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], j = i * 3;
        scratch.active[i] = n.active ? 1 : 0;
        if (!n.active) continue;
        n.px = n.x; n.py = n.y; n.pz = n.z;
        positions[j] = n.x + n.vx * dt;
        positions[j + 1] = n.y + n.vy * dt;
        positions[j + 2] = n.z + n.vz * dt;
        scratch.weights[i] = n.invMass;
      }

      // Zmierz WSZYSTKIE belki przed projekcją. Projekcja sąsiedniej belki
      // potrafiła skasować zgniot, zanim dalsza część poszycia go zobaczyła.
      const bodyBroken = prepareBeamConstraints(scratch, beams, cfg, dt, plasticRate, stepScaleSq);
      if (scratch.deformed) body.meshDirty = true;
      if (bodyBroken) {
        broke += bodyBroken;
        body.liveBeams = Math.max(0, body.liveBeams - bodyBroken);
        body.structureDirty = true;
        body.meshDirty = true;
        if (!body.noSplit && !this.splitQueue.includes(body)) this.splitQueue.push(body);
      }

      // 2) rzutowanie ograniczeń długości belek
      solved += projectBeamConstraints(scratch, scratch.count, iterations);

      // 3) prędkości z przesunięcia pozycji + tłumienie
      const invDt = 1 / dt;
      let motion = 0;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], j = i * 3;
        if (!n.active) continue;
        n.x = positions[j]; n.y = positions[j + 1]; n.z = positions[j + 2];
        n.vx = (n.x - n.px) * invDt * damp;
        n.vy = (n.y - n.py) * invDt * damp;
        n.vz = (n.z - n.pz) * invDt * damp;
        const m = Math.abs(n.vx) + Math.abs(n.vy) + Math.abs(n.vz);
        if (m > motion) motion = m;
      }

      // 4) Przenieś wspólny ruch węzłów na ciało, zachowując pozycje świata.
      // Samo odjęcie średniej cofało zgniot i teleportowało oderwane sekcje.
      let mx = 0, my = 0, mz = 0, msum = 0;
      let mvx = 0, mvy = 0, mvz = 0;
      for (const n of nodes) {
        if (!n.active) continue;
        mx += (n.x - n.ox) * n.mass;
        my += (n.y - n.oy) * n.mass;
        mz += (n.z - n.oz) * n.mass;
        mvx += n.vx * n.mass; mvy += n.vy * n.mass; mvz += n.vz * n.mass;
        msum += n.mass;
      }
      if (msum > 0) {
        mx /= msum; my /= msum; mz /= msum;
        mvx /= msum; mvy /= msum; mvz /= msum;
        const shift = matVec(this._refreshRot(body), mx, my, mz, this._s1);
        body.pos.x += shift.x; body.pos.y += shift.y; body.pos.z += shift.z;
        const velocity = matVec(body._rot, mvx, mvy, mvz, this._s2);
        body.vel.x += velocity.x; body.vel.y += velocity.y; body.vel.z += velocity.z;
        const drift = Math.abs(mx) + Math.abs(my) + Math.abs(mz);
        if (drift > 1e-9) {
          for (const n of nodes) {
            if (!n.active) continue;
            n.x -= mx; n.y -= my; n.z -= mz;
          }
        }
        for (const n of nodes) {
          if (!n.active) continue;
          n.vx -= mvx; n.vy -= mvy; n.vz -= mvz;
        }
      }
      this._updateRadius(body);
      body._hashTick = -1;

      if (motion > cfg.sleepMotionThreshold) {
        body.meshDirty = true;
        body.sleepFrames = 0;
        body.isSleeping = false;
      } else if ((body.wakeHold | 0) > 0) {
        body.wakeHold--;
      } else {
        body.sleepFrames++;
        if (body.sleepFrames >= cfg.sleepFrames) body.isSleeping = true;
      }
    }

    if (broke > 0) {
      this.perf.beamsBroken += broke;
    }
    this.perf.solvedBeams = solved;
    this.perf.lastSolverMs = nowMs() - t0;
  },

  _updateRadius(body) {
    updateBeamBounds(body);
  },

  // --------------------------- PĘTLA ---------------------------

  update(dt, bodies) {
    const t0 = nowMs();
    this._tick++;
    this.perf.contacts = 0;
    this.perf.broadphasePairs = this.perf.aabbRejected = this.perf.narrowphasePairs = 0;
    const cfg = this.config;

    for (const b of bodies) if (b && !b.dead) this._refreshRot(b);
    // Kontakt jest ostatnim ograniczeniem pozycji. Solver belek nie może
    // na końcu kroku wciągnąć właśnie odgiętego dziobu z powrotem w przeszkodę.
    this.solveSoftBody(dt, bodies);

    const tCol = nowMs();
    const iters = Math.max(1, cfg.collisionIterations | 0);
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < bodies.length; i++) {
        const A = bodies[i];
        if (!A || A.dead || A.activeNodes <= 0) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const B = bodies[j];
          if (!B || B.dead || B.activeNodes <= 0) continue;
          if (A.static && B.static) continue;
          this.perf.broadphasePairs++;

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
          const padding = (A.cellSize + B.cellSize) * (cfg.nodeRadius / cfg.cellSize);
          if (!beamBoundsOverlap(A, B, padding, this._tick)) { this.perf.aabbRejected++; continue; }

          this.perf.narrowphasePairs++;
          this.collideBodies(A, B, dt, it === 0);
        }
      }
    }
    const tAfterCol = nowMs();

    const tAfterSolve = nowMs();
    if (this._tick % Math.max(1, cfg.splitCheckInterval | 0) === 0 && this.splitQueue.length > 0) {
      this.processSplits(bodies);
    }

    this.perf.lastCollisionMs = tAfterCol - tCol;
    this.perf.lastSplitMs = nowMs() - tAfterSolve;
    this.perf.lastUpdateMs = nowMs() - t0;
  },

  // --------------------------- KOLIZJE ---------------------------

  collideBodies(A, B, dt, doDamage) {
    const cfg = this.config;
    // Iterujemy po węzłach ciała o mniejszej powierzchni, szukając w hashu drugiego.
    let iter = A, holder = B;
    if (A.activeNodes > B.activeNodes) { iter = B; holder = A; }

    const mI = this._refreshRot(iter);
    const mH = this._refreshRot(holder);
    const hash = this._refreshHash(holder);
    const cs = holder.cellSize;
    const contactDist = (A.cellSize + B.cellSize) * (cfg.nodeRadius / cfg.cellSize);
    const contactDistSq = contactDist * contactDist;
    const reach = holder.radius + cs * 2;
    const reachSq = reach * reach;

    const wI = this._s1, lH = this._s2, wH = this._s3;
    const swapped = iter !== A;

    let count = 0;
    let hitX = 0, hitY = 0, hitZ = 0;
    let nX = 0, nY = 0, nZ = 0;
    let penetration = 0;
    let contactMassA = 0, contactMassB = 0;
    const massStamp = ++this._contactStamp;
    const contactsA = A._contacts;
    const contactsB = B._contacts;
    const depths = A._contactDepths;
    const maxContacts = Math.max(8, cfg.maxContacts | 0);
    const start = iter._contactCursor % iter.nodes.length;

    for (let scan = 0; scan < iter.nodes.length; scan++) {
      const nodeIndex = (start + scan) % iter.nodes.length;
      const nI = iter.nodes[nodeIndex];
      if (!nI.active) continue;

      matVec(mI, nI.x, nI.y, nI.z, wI);
      wI.x += iter.pos.x; wI.y += iter.pos.y; wI.z += iter.pos.z;

      const hdx = wI.x - holder.pos.x, hdy = wI.y - holder.pos.y, hdz = wI.z - holder.pos.z;
      if (hdx * hdx + hdy * hdy + hdz * hdz > reachSq) continue;
      matVecT(mH, hdx, hdy, hdz, lH);
      if (lH.x < holder._hashMinX - contactDist || lH.x > holder._hashMaxX + contactDist ||
          lH.y < holder._hashMinY - contactDist || lH.y > holder._hashMaxY + contactDist ||
          lH.z < holder._hashMinZ - contactDist || lH.z > holder._hashMaxZ + contactDist) continue;

      const i0 = Math.floor((lH.x - contactDist) / cs), i1 = Math.floor((lH.x + contactDist) / cs);
      const j0 = Math.floor((lH.y - contactDist) / cs), j1 = Math.floor((lH.y + contactDist) / cs);
      const k0 = Math.floor((lH.z - contactDist) / cs), k1 = Math.floor((lH.z + contactDist) / cs);
      let found = null;
      let bestD2 = contactDistSq;

      // Odwiedź tylko kubiki przecinające sferę kontaktu. Dawny stały zakres
      // ±2 dawał 125 lookupów na węzeł, także przez pustkę pomiędzy odłamami.
      for (let k = k0; k <= k1; k++) {
        const ez = Math.max(0, k * cs - lH.z, lH.z - (k + 1) * cs);
        const z2 = ez * ez;
        if (z2 >= bestD2) continue;
        for (let j = j0; j <= j1; j++) {
          const ey = Math.max(0, j * cs - lH.y, lH.y - (j + 1) * cs);
          const yz2 = z2 + ey * ey;
          if (yz2 >= bestD2) continue;
          for (let i = i0; i <= i1; i++) {
            const ex = Math.max(0, i * cs - lH.x, lH.x - (i + 1) * cs);
            if (yz2 + ex * ex >= bestD2) continue;
            const bucket = hash.get(hashKey(i, j, k));
            if (!bucket) continue;
            for (let nH = bucket; nH; nH = nH._hashNext) {
              const ddx = lH.x - nH.x, ddy = lH.y - nH.y, ddz = lH.z - nH.z;
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d2 < bestD2) { bestD2 = d2; found = nH; }
            }
          }
        }
      }
      if (!found) continue;

      matVec(mH, found.x, found.y, found.z, wH);
      wH.x += holder.pos.x; wH.y += holder.pos.y; wH.z += holder.pos.z;

      const cnx = wI.x - wH.x, cny = wI.y - wH.y, cnz = wI.z - wH.z;
      const dist = Math.sqrt(cnx * cnx + cny * cny + cnz * cnz);
      const pen = contactDist - dist;
      if (pen <= 0) continue;

      hitX += (wI.x + wH.x) * 0.5;
      hitY += (wI.y + wH.y) * 0.5;
      hitZ += (wI.z + wH.z) * 0.5;
      nX += swapped ? -cnx : cnx;
      nY += swapped ? -cny : cny;
      nZ += swapped ? -cnz : cnz;
      if (pen > penetration) penetration = pen;
      contactsA[count] = swapped ? found : nI;
      contactsB[count] = swapped ? nI : found;
      depths[count] = pen;
      const ca = contactsA[count], cb = contactsB[count];
      if (ca._massStamp !== massStamp) { contactMassA += ca.mass; ca._massStamp = massStamp; }
      if (cb._massStamp !== massStamp) { contactMassB += cb.mass; cb._massStamp = massStamp; }
      count++;
      if (count >= maxContacts) {
        if (doDamage) iter._contactCursor = nodeIndex + 1;
        break;
      }
    }

    if (count === 0) return;

    hitX /= count; hitY /= count; hitZ /= count;
    let nLenSq = nX * nX + nY * nY + nZ * nZ;
    if (nLenSq < 1e-12) {
      nX = A.pos.x - B.pos.x; nY = A.pos.y - B.pos.y; nZ = A.pos.z - B.pos.z;
      nLenSq = nX * nX + nY * nY + nZ * nZ;
      if (nLenSq < 1e-12) { nX = 1; nY = 0; nZ = 0; nLenSq = 1; }
    }
    const invN = 1 / Math.sqrt(nLenSq);
    nX *= invN; nY *= invN; nZ *= invN;

    this.perf.contacts += count;
    this.wake(A, cfg.wakeHoldFrames);
    this.wake(B, cfg.wakeHoldFrames);

    const rAx = hitX - A.pos.x, rAy = hitY - A.pos.y, rAz = hitZ - A.pos.z;
    const rBx = hitX - B.pos.x, rBy = hitY - B.pos.y, rBz = hitZ - B.pos.z;

    const vAx = A.vel.x + (A.angVel.y * rAz - A.angVel.z * rAy);
    const vAy = A.vel.y + (A.angVel.z * rAx - A.angVel.x * rAz);
    const vAz = A.vel.z + (A.angVel.x * rAy - A.angVel.y * rAx);
    const vBx = B.vel.x + (B.angVel.y * rBz - B.angVel.z * rBy);
    const vBy = B.vel.y + (B.angVel.z * rBx - B.angVel.x * rBz);
    const vBz = B.vel.z + (B.angVel.x * rBy - B.angVel.y * rBx);

    const dvx = vAx - vBx, dvy = vAy - vBy, dvz = vAz - vBz;
    // W głębokim kontakcie środki węzłów mijają się. Normalna sferyczna
    // odwraca się wtedy mimo dalszego wjeżdżania w metal (tak jak w 2D).
    const closing = dvx * (A.pos.x - B.pos.x) + dvy * (A.pos.y - B.pos.y) + dvz * (A.pos.z - B.pos.z);
    const speed = Math.hypot(dvx, dvy, dvz);
    const massRatio = Math.max(A.mass, B.mass) / Math.max(1, Math.min(A.mass, B.mass));
    if (speed > cfg.crushSpeedThreshold &&
        ((closing < 0 && dvx * nX + dvy * nY + dvz * nZ >= 0) ||
          ((A.static || B.static || massRatio > 4) && penetration > contactDist * 0.2))) {
      nX = -dvx / speed; nY = -dvy / speed; nZ = -dvz / speed;
    }
    const velAlongNormal = dvx * nX + dvy * nY + dvz * nZ;
    const approach = Math.max(0, -velAlongNormal);

    const massA = Math.max(1, A.mass * A.rammingMassMult);
    const massB = Math.max(1, B.mass * B.rammingMassMult);
    const invMassA = A.static ? 0 : 1 / massA;
    const invMassB = B.static ? 0 : 1 / massB;
    const crushing = approach > cfg.crushSpeedThreshold;
    const transfer = crushing ? Math.max(0, Math.min(1, cfg.crushTransfer)) : 0;

    // --- impuls na ciała sztywne ---
    if (velAlongNormal < 0) {
      const iaN = applyInvInertia(A, rAy * nZ - rAz * nY, rAz * nX - rAx * nZ, rAx * nY - rAy * nX, this._s4);
      const tqAx = iaN.y * rAz - iaN.z * rAy;
      const tqAy = iaN.z * rAx - iaN.x * rAz;
      const tqAz = iaN.x * rAy - iaN.y * rAx;
      const ibN = applyInvInertia(B, rBy * nZ - rBz * nY, rBz * nX - rBx * nZ, rBx * nY - rBy * nX, this._s5);
      const tqBx = ibN.y * rBz - ibN.z * rBy;
      const tqBy = ibN.z * rBx - ibN.x * rBz;
      const tqBz = ibN.x * rBy - ibN.y * rBx;

      const denom = invMassA + invMassB +
        (tqAx * nX + tqAy * nY + tqAz * nZ) +
        (tqBx * nX + tqBy * nY + tqBz * nZ);

      if (Number.isFinite(denom) && denom > 1e-9) {
        // Im mocniejsze uderzenie, tym więcej energii idzie w zgniot zamiast w odbicie.
        const rest = crushing ? 0 : cfg.restitution;
        let j = (-(1 + rest) * velAlongNormal) / denom;
        // Zgniot potrzebuje drogi hamowania. Kolejna iteracja kontaktów nie
        // może ponownie wytracić całej prędkości przed następną warstwą.
        if (crushing) {
          // Pojedyncza warstwa poszycia nie zatrzymuje całej masy statku.
          // Opór rośnie wraz z masą materiału faktycznie objętego kontaktem.
          const contactShare = A.static ? contactMassB / B.mass : B.static ? contactMassA / A.mass
            : Math.max(contactMassA / A.mass, contactMassB / B.mass);
          j *= doDamage ? (1 - Math.pow(transfer, dt * 60)) * Math.max(0.04, Math.min(1, contactShare)) : 0;
        }
        this._applyImpulse(A, rAx, rAy, rAz, nX * j, nY * j, nZ * j, invMassA);
        this._applyImpulse(B, rBx, rBy, rBz, -nX * j, -nY * j, -nZ * j, invMassB);

        let tx = dvx - nX * velAlongNormal;
        let ty = dvy - nY * velAlongNormal;
        let tz = dvz - nZ * velAlongNormal;
        const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tLen > 1e-6) {
          tx /= tLen; ty /= tLen; tz /= tLen;
          let jt = -tLen / Math.max(1e-9, invMassA + invMassB);
          const maxF = Math.abs(j) * cfg.friction;
          if (jt < -maxF) jt = -maxF;
          this._applyImpulse(A, rAx, rAy, rAz, tx * jt, ty * jt, tz * jt, invMassA);
          this._applyImpulse(B, rBx, rBy, rBz, -tx * jt, -ty * jt, -tz * jt, invMassB);
        }
      }
    }

    // --- ZGNIOT: penetracja wpychana w węzły, nie oddawana jako odbicie ---
    // Tu powstaje wgniecenie. Belki dostają to jako wymuszenie przemieszczenia
    // i same decydują, czy się ugną sprężyście, odkształcą trwale, czy zerwą.
    if (doDamage && transfer > 0) {
      const bias = cfg.crushMassBias;
      const total = massA + massB;
      const weightA = A.static ? 0 : (B.static ? 1 : Math.pow(massB / total, bias));
      const weightB = B.static ? 0 : (A.static ? 1 : Math.pow(massA / total, bias));
      const weightSum = weightA + weightB || 1;
      const shareA = weightA / weightSum, shareB = weightB / weightSum;
      const travel = approach * dt;
      const stamp = ++this._contactStamp;

      // Normalna B -> A: dziób A cofa się w kierunku +N, dziób B w -N.
      const lnA = matVecT(this._refreshRot(A), nX, nY, nZ, this._s4);
      const lnB = matVecT(this._refreshRot(B), -nX, -nY, -nZ, this._s5);

      for (let i = 0; i < count; i++) {
        const na = contactsA[i];
        const nb = contactsB[i];
        const depth = Math.min(contactDist * 0.65, Math.max(depths[i], travel)) * transfer;
        if (na?.active && shareA > 0) {
          this._crushNode(na, lnA, depth * shareA, dt, stamp, cfg.crushBuckling);
        }
        if (nb?.active && shareB > 0) {
          this._crushNode(nb, lnB, depth * shareB, dt, stamp, cfg.crushBuckling);
        }
      }
      A.meshDirty = true;
      B.meshDirty = true;
      if (!A.static) { A._hashTick = -1; this._updateRadius(A); }
      if (!B.static) { B._hashTick = -1; this._updateRadius(B); }
    }

    // --- separacja ciał sztywnych ---
    const slop = cfg.separationSlop;
    if (penetration > slop && (invMassA + invMassB) > 0) {
      const separation = 1 - Math.pow(1 - cfg.separationPercent, dt * 60);
      const corr = (penetration - slop) / (invMassA + invMassB) * separation * (1 - transfer);
      A.pos.x += nX * corr * invMassA; A.pos.y += nY * corr * invMassA; A.pos.z += nZ * corr * invMassA;
      B.pos.x -= nX * corr * invMassB; B.pos.y -= nY * corr * invMassB; B.pos.z -= nZ * corr * invMassB;
    }
  },

  _crushNode(node, normal, depth, dt, stamp, buckling) {
    // Kilka węzłów przeciwnika może wskazać ten sam węzeł: nie mnożymy zgniotu.
    const previous = node._crushStamp === stamp ? node._crushDepth : 0;
    const d = Math.max(0, depth - previous);
    node._crushStamp = stamp;
    node._crushDepth = Math.max(previous, depth);
    // Ściskane poszycie wybocza się na boki, zamiast składać wszystkie
    // warstwy w ten sam punkt. Otwarte szwy zrywają następnie belki solvera.
    const along = node.ox * normal.x + node.oy * normal.y + node.oz * normal.z;
    const tx = node.ox - along * normal.x;
    const ty = node.oy - along * normal.y;
    const tz = node.oz - along * normal.z;
    const side = buckling / Math.max(depth * 2, Math.hypot(tx, ty, tz), 1e-6);
    const nx = normal.x + tx * side, ny = normal.y + ty * side, nz = normal.z + tz * side;
    node.x += nx * d; node.y += ny * d; node.z += nz * d;
    const speed = d * 30;
    node.vx += nx * speed; node.vy += ny * speed; node.vz += nz * speed;
  },

  _applyImpulse(body, rx, ry, rz, jx, jy, jz, invMass) {
    if (invMass <= 0) return;
    body.vel.x += jx * invMass;
    body.vel.y += jy * invMass;
    body.vel.z += jz * invMass;
    const tqx = ry * jz - rz * jy;
    const tqy = rz * jx - rx * jz;
    const tqz = rx * jy - ry * jx;
    const dw = applyInvInertia(body, tqx, tqy, tqz, this._s6);
    body.angVel.x += dw.x; body.angVel.y += dw.y; body.angVel.z += dw.z;
  },

  // --------------------------- BROŃ ---------------------------

  /**
   * Trafienie w punkt świata: uszkadza węzły w promieniu, ZRYWA belki w promieniu
   * mniejszym (stąd czyste przecięcie) i wpycha węzły wzdłuż wektora pocisku.
   */
  applyImpact(body, wx, wy, wz, damage = 0, worldVel = null, opts = null) {
    const cfg = this.config;
    if (!body || body.dead || body.static) return false;
    const m = this._refreshRot(body);
    const l = matVecT(m, wx - body.pos.x, wy - body.pos.y, wz - body.pos.z, this._s1);
    const radius = Math.max(cfg.cellSize, opts?.radius || cfg.impactRadius);
    const rSq = radius * radius;
    const breakR = Math.max(cfg.cellSize * 0.5, opts?.breakRadius || cfg.impactBeamBreakRadius);
    const breakRSq = breakR * breakR;

    let dir = this._s2;
    if (worldVel) {
      matVecT(m, worldVel.x, worldVel.y, worldVel.z, dir);
      const dl = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
      if (dl > 1e-6) { dir.x /= dl; dir.y /= dl; dir.z /= dl; }
      else { dir.x = 0; dir.y = 0; dir.z = 0; }
    } else { dir.x = 0; dir.y = 0; dir.z = 0; }

    let hitAny = false;
    let killed = 0;
    const push = cfg.impactPush * Math.min(3, damage / 200) * cfg.cellSize;

    for (const n of body.nodes) {
      if (!n.active) continue;
      const dx = n.x - l.x, dy = n.y - l.y, dz = n.z - l.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > rSq) continue;
      hitAny = true;
      const falloff = 1 - Math.sqrt(d2) / radius;
      const influence = falloff * falloff * (3 - 2 * falloff);
      n.hp -= damage * 0.5 * influence;
      n.x += dir.x * push * influence;
      n.y += dir.y * push * influence;
      n.z += dir.z * push * influence;
      if (n.hp <= 0) { this.destroyNode(body, n); killed++; }
    }

    if (!hitAny) return false;

    // Zerwij belki, których środek leży w rdzeniu trafienia — to daje ranę
    // o wyraźnej krawędzi zamiast rozmytego osłabienia konstrukcji.
    const nodes = body.nodes;
    for (const beam of body.beams) {
      if (beam.broken) continue;
      const a = nodes[beam.a], c = nodes[beam.b];
      const mx = (a.x + c.x) * 0.5 - l.x;
      const my = (a.y + c.y) * 0.5 - l.y;
      const mz = (a.z + c.z) * 0.5 - l.z;
      if (mx * mx + my * my + mz * mz > breakRSq) continue;
      // Gródź i wręg wytrzymują trafienie, które przecina poszycie na wylot.
      const resist = (beam.type === BEAM_TYPE.BULKHEAD) ? 380
        : (beam.type === BEAM_TYPE.FRAME) ? 260 : 90;
      if (damage < resist) continue;
      beam.broken = true;
      body.structureDirty = true;
      this.perf.beamsBroken++;
    }

    this.wake(body, cfg.wakeHoldFrames);
    body.meshDirty = true;
    body._hashTick = -1;
    this._updateRadius(body);
    this._refreshNodeIntegrity(body);
    if (!body.noSplit && (killed > 0 || body.structureDirty) && this.splitQueue.indexOf(body) === -1) {
      this.splitQueue.push(body);
    }
    return true;
  },

  // Węzeł bez wystarczającego oparcia w poszyciu przestaje istnieć — tak powstaje
  // dziura w kadłubie (maska skóry czyta właśnie ten stan).
  _refreshNodeIntegrity(body) {
    const nodes = body.nodes;
    const beams = body.beams;
    const live = body._integrity;
    live.fill(0);
    for (const beam of beams) {
      if (beam.broken) continue;
      live[beam.a]++;
      live[beam.b]++;
    }
    let liveBeams = 0;
    for (const beam of beams) if (!beam.broken) liveBeams++;
    body.liveBeams = liveBeams;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n.active) continue;
      if (n.beamCount > 0 && live[i] <= Math.max(1, Math.floor(n.beamCount * 0.22))) {
        this.destroyNode(body, n);
      }
    }
  },

  destroyNode(body, node) {
    if (!node || !node.active) return;
    node.active = false;
    node.hp = 0;
    body.activeNodes = Math.max(0, body.activeNodes - 1);
    body.meshDirty = true;
    body.structureDirty = true;
    body._hashTick = -1;
    body.mass = Math.max(1, body.mass - node.mass);
    if (!body.static) body.invMass = 1 / body.mass;

    for (const bi of node.beams) {
      const beam = body.beams[bi];
      if (beam && !beam.broken) {
        beam.broken = true;
        body.liveBeams = Math.max(0, body.liveBeams - 1);
        this.perf.beamsBroken++;
      }
    }

    if (this.onDebris) {
      const m = this._refreshRot(body);
      const w = matVec(m, node.x, node.y, node.z, this._s3);
      const rx = w.x, ry = w.y, rz = w.z;
      w.x += body.pos.x; w.y += body.pos.y; w.z += body.pos.z;
      const kick = matVec(m, node.vx, node.vy, node.vz, this._s4);
      this.onDebris(
        body, node, w.x, w.y, w.z,
        body.vel.x + (body.angVel.y * rz - body.angVel.z * ry) + kick.x,
        body.vel.y + (body.angVel.z * rx - body.angVel.x * rz) + kick.y,
        body.vel.z + (body.angVel.x * ry - body.angVel.y * rx) + kick.z
      );
    }
    if (body.activeNodes === 0) body.dead = true;
  },

  /** Promień vs węzły — do celowania w demie. Zwraca najbliższy trafiony węzeł. */
  raycastBody(body, ox, oy, oz, dx, dy, dz, maxDist = 1e6) {
    if (!body || body.dead) return null;
    const m = this._refreshRot(body);
    const o = matVecT(m, ox - body.pos.x, oy - body.pos.y, oz - body.pos.z, this._s1);
    const d = matVecT(m, dx, dy, dz, this._s2);
    const dLen = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 1;
    d.x /= dLen; d.y /= dLen; d.z /= dLen;

    const hitRadius = this.config.nodeRadius * 1.6;
    const hitSq = hitRadius * hitRadius;
    let best = null;
    let bestT = maxDist;

    for (const n of body.nodes) {
      if (!n.active || !n.surface) continue;
      const rx = n.x - o.x, ry = n.y - o.y, rz = n.z - o.z;
      const t = rx * d.x + ry * d.y + rz * d.z;
      if (t < 0 || t > bestT) continue;
      const cx = rx - d.x * t, cy = ry - d.y * t, cz = rz - d.z * t;
      if (cx * cx + cy * cy + cz * cz > hitSq) continue;
      bestT = t;
      best = n;
    }
    if (!best) return null;

    const w = matVec(m, best.x, best.y, best.z, this._s3);
    return {
      node: best,
      t: bestT,
      x: w.x + body.pos.x,
      y: w.y + body.pos.y,
      z: w.z + body.pos.z
    };
  },

  // --------------------------- ROZPADY ---------------------------

  /** Wyspy liczone po NIEZERWANYCH belkach — tu materializuje się przecięcie. */
  findIslands(body) {
    let stamp = (this._islandStamp + 1) | 0;
    if (stamp <= 0) stamp = 1;
    this._islandStamp = stamp;

    const nodes = body.nodes;
    const beams = body.beams;
    const groups = [];
    const stack = [];

    for (const seed of nodes) {
      if (!seed.active || seed.__islandStamp === stamp) continue;
      const group = [];
      stack.length = 0;
      stack.push(seed);
      seed.__islandStamp = stamp;
      while (stack.length > 0) {
        const cur = stack.pop();
        group.push(cur);
        for (const bi of cur.beams) {
          const beam = beams[bi];
          if (!beam || beam.broken) continue;
          const other = nodes[beam.a === cur.id ? beam.b : beam.a];
          if (!other.active || other.__islandStamp === stamp) continue;
          other.__islandStamp = stamp;
          stack.push(other);
        }
      }
      groups.push(group);
    }
    return groups;
  },

  processSplits(bodies) {
    const cfg = this.config;
    const queued = this.splitQueue;
    if (!queued.length) return;
    this.splitQueue = [];
    let processed = 0;

    let wreckCount = 0;
    for (const body of bodies) if (body?.isWreck && !body.dead) wreckCount++;
    for (const body of queued) {
      if (!body || body.dead || body.static || body.noSplit || !body.structureDirty) continue;
      if (processed >= Math.max(1, cfg.splitMaxPerTick | 0)) {
        this.splitQueue.push(body);
        continue;
      }
      body.structureDirty = false;
      processed++;

      if (cfg.breakEnabled && cfg.detachTornJoints) {
        body._connectivity = beamConnectivityScratch(body.nodes.length, body.beams.length, body._connectivity);
        const bridges = findBeamBridges(body.nodes, body.beams, body._connectivity);
        let detached = 0;
        for (let i = 0; i < body.beams.length; i++) {
          const beam = body.beams[i];
          // Preserve intentionally separate original struts / hinges. Only a
          // formerly braced joint that lost every alternate load path tears.
          if (bridges[i] && beam.restBridge === false) { beam.broken = true; detached++; }
        }
        if (detached) {
          body.liveBeams = Math.max(0, body.liveBeams - detached);
          this.perf.beamsBroken += detached;
          body.meshDirty = true;
          this.wake(body, cfg.wakeHoldFrames);
        }
      }

      const groups = this.findIslands(body);
      if (groups.length === 0) { body.dead = true; continue; }
      if (groups.length === 1) continue;
      groups.sort((a, b) => b.length - a.length);

      let fragments = 0;
      for (let gi = 1; gi < groups.length; gi++) {
        const group = groups[gi];
        if (group.length < Math.max(2, cfg.splitMinNodes | 0) ||
            fragments >= cfg.splitMaxFragments || wreckCount >= cfg.maxWrecks) {
          for (const n of group) this.destroyNode(body, n);
          continue;
        }
        this._spawnWreck(body, group, bodies);
        fragments++;
        wreckCount++;
      }
      this._rebuildBody(body, groups[0]);
    }
  },

  _partitionBeams(body, nodeSet) {
    const kept = [];
    const indexMap = new Map();
    const nodes = [];
    for (const n of nodeSet) {
      indexMap.set(n, nodes.length);
      nodes.push(n);
    }
    // Każda sekcja odwiedza tylko swoje belki. Skan całego rodzica dla każdego
    // odłamu mnożył pracę w najdroższej klatce rozpadu przez liczbę fragmentów.
    for (const n of nodes) {
      for (const bi of n.beams) {
        const beam = body.beams[bi];
        if (beam.broken || body.nodes[beam.a] !== n) continue;
        const c = body.nodes[beam.b];
        if (!indexMap.has(c)) continue;
        kept.push(cloneBeam(beam, indexMap.get(n), indexMap.get(c)));
      }
    }
    // Przepnij listy belek węzłów na nową numerację.
    for (const n of nodes) n.beams = [];
    for (let i = 0; i < kept.length; i++) {
      nodes[kept[i].a].beams.push(i);
      nodes[kept[i].b].beams.push(i);
    }
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].id = i;
      nodes[i].beamCount = nodes[i].beams.length;
    }
    return { nodes, beams: kept };
  },

  _shiftNodes(nodes, cx, cy, cz) {
    for (const n of nodes) {
      n.ox -= cx; n.oy -= cy; n.oz -= cz;
      n.x -= cx; n.y -= cy; n.z -= cz;
      n.px -= cx; n.py -= cy; n.pz -= cz;
    }
  },

  _rebuildBody(body, group) {
    const part = this._partitionBeams(body, group);
    const info = computeNodeSetInertia(part.nodes, body.cellSize);
    if (!info) return;

    const m = this._refreshRot(body);
    const shift = matVec(m, info.com.x, info.com.y, info.com.z, this._s1);
    body.pos.x += shift.x; body.pos.y += shift.y; body.pos.z += shift.z;
    body.vel.x += body.angVel.y * shift.z - body.angVel.z * shift.y;
    body.vel.y += body.angVel.z * shift.x - body.angVel.x * shift.z;
    body.vel.z += body.angVel.x * shift.y - body.angVel.y * shift.x;

    this._shiftNodes(part.nodes, info.com.x, info.com.y, info.com.z);
    body.latticeMin.x -= info.com.x;
    body.latticeMin.y -= info.com.y;
    body.latticeMin.z -= info.com.z;

    body.nodes = part.nodes;
    body.beams = part.beams;
    body.activeNodes = part.nodes.length;
    body.liveBeams = part.beams.length;
    body.mass = Math.max(1, info.mass);
    if (!body.static) body.invMass = 1 / body.mass;
    body.invInertiaLocal = info.invInertia;
    this._transferFragmentMotion(body);
    this._updateRadius(body);
    body.meshDirty = true;
    body._hashTick = -1;
    this.wake(body, this.config.wakeHoldFrames);
  },

  _spawnWreck(parent, group, bodies) {
    const cfg = this.config;
    const part = this._partitionBeams(parent, group);
    const info = computeNodeSetInertia(part.nodes, parent.cellSize);
    if (!info) return null;

    const m = this._refreshRot(parent);
    const comW = matVec(m, info.com.x, info.com.y, info.com.z, this._s1);
    this._shiftNodes(part.nodes, info.com.x, info.com.y, info.com.z);

    let radius = 0;
    for (const n of part.nodes) {
      const d = Math.sqrt(n.ox * n.ox + n.oy * n.oy + n.oz * n.oz);
      if (d > radius) radius = d;
    }

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
      mass: Math.max(1, info.mass),
      invMass: 1 / Math.max(1, info.mass),
      static: false,
      invInertiaLocal: info.invInertia,
      radius: radius + parent.cellSize,
      config: cfg,
      nodes: part.nodes,
      beams: part.beams,
      cellSize: parent.cellSize,
      dims: parent.dims,
      latticeMin: {
        x: parent.latticeMin.x - info.com.x,
        y: parent.latticeMin.y - info.com.y,
        z: parent.latticeMin.z - info.com.z
      },
      skinLatticeMin: { ...parent.skinLatticeMin },
      skin: parent.skin || null,
      activeNodes: part.nodes.length,
      liveBeams: part.beams.length,
      dead: false,
      isWreck: true,
      noSplit: false,
      rammingMassMult: 1,
      meshDirty: true,
      structureDirty: false,
      isSleeping: false,
      sleepFrames: 0,
      wakeHold: cfg.wakeHoldFrames,
      _rot: new Float64Array(9),
      _rotTick: -1,
      _hash: new Map(),
      _hashTick: -1,
      _contactCursor: 0,
      _contacts: [],
      _contactDepths: [],
      _integrity: new Int32Array(part.nodes.length),
      _connectivity: null,
      _splitDefer: 0
    };
    quatToMat3(wreck.quat, wreck._rot);
    this._transferFragmentMotion(wreck);
    this._updateRadius(wreck);

    const outLen = Math.sqrt(comW.x * comW.x + comW.y * comW.y + comW.z * comW.z);
    if (outLen > 1e-4) {
      const kick = cfg.wreckOutwardKick;
      wreck.vel.x += (comW.x / outLen) * kick;
      wreck.vel.y += (comW.y / outLen) * kick;
      wreck.vel.z += (comW.z / outLen) * kick;
      const spin = cfg.wreckSpinResponse;
      wreck.angVel.x += (comW.y / outLen) * spin;
      wreck.angVel.y += (comW.z / outLen) * spin;
      wreck.angVel.z += (comW.x / outLen) * spin;
    }

    if (Array.isArray(bodies) && !bodies.includes(wreck)) bodies.push(wreck);
    return wreck;
  },

  _transferFragmentMotion(body) {
    // Oderwana sekcja dziedziczy także ruch od zgniotu, nie tylko prędkość
    // środka rodzica. Średnią i moment pola prędkości zamieniamy na 6DoF.
    let vx = 0, vy = 0, vz = 0;
    let cx = 0, cy = 0, cz = 0;
    for (const n of body.nodes) {
      vx += n.vx * n.mass; vy += n.vy * n.mass; vz += n.vz * n.mass;
      cx += n.x * n.mass; cy += n.y * n.mass; cz += n.z * n.mass;
    }
    vx /= body.mass; vy /= body.mass; vz /= body.mass;
    cx /= body.mass; cy /= body.mass; cz /= body.mass;
    let lx = 0, ly = 0, lz = 0;
    for (const n of body.nodes) {
      const x = n.x - cx, y = n.y - cy, z = n.z - cz;
      lx += n.mass * (y * (n.vz - vz) - z * (n.vy - vy));
      ly += n.mass * (z * (n.vx - vx) - x * (n.vz - vz));
      lz += n.mass * (x * (n.vy - vy) - y * (n.vx - vx));
    }
    const I = body.invInertiaLocal;
    let wx = I[0] * lx + I[1] * ly + I[2] * lz;
    let wy = I[3] * lx + I[4] * ly + I[5] * lz;
    let wz = I[6] * lx + I[7] * ly + I[8] * lz;
    const limit = Math.min(1, 6 / (Math.hypot(wx, wy, wz) || 1));
    wx *= limit; wy *= limit; wz *= limit;
    // Ruch wokół rzeczywistego COM przelicz na początek układu fragmentu.
    const v = matVec(body._rot, vx - wy * cz + wz * cy,
      vy - wz * cx + wx * cz, vz - wx * cy + wy * cx, this._s4);
    body.vel.x += v.x; body.vel.y += v.y; body.vel.z += v.z;
    const w = matVec(body._rot, wx, wy, wz, this._s5);
    body.angVel.x += w.x; body.angVel.y += w.y; body.angVel.z += w.z;
    for (const n of body.nodes) {
      n.vx -= vx + wy * (n.z - cz) - wz * (n.y - cy);
      n.vy -= vy + wz * (n.x - cx) - wx * (n.z - cz);
      n.vz -= vz + wx * (n.y - cy) - wy * (n.x - cx);
    }
  },

  /** Naprawa: długości spoczynkowe wracają do oryginału, belki się zrastają. */
  repair(bodies, dt) {
    const step = Math.min(1, Math.max(0.001, dt));
    let any = false;
    for (const body of bodies) {
      if (!body || body.dead) continue;
      let changed = false;
      let liveBeams = 0;
      for (const beam of body.beams) {
        if (beam.fatigue > 0) { beam.fatigue = Math.max(0, beam.fatigue - step * 2); changed = true; }
        if (beam.rest !== beam.restBase) {
          beam.rest += (beam.restBase - beam.rest) * step * 2;
          if (Math.abs(beam.rest - beam.restBase) < 1e-4) beam.rest = beam.restBase;
          changed = true;
        }
        if (beam.broken) {
          const a = body.nodes[beam.a];
          const c = body.nodes[beam.b];
          if (a?.active && c?.active) { beam.broken = false; changed = true; }
        }
        if (!beam.broken && body.nodes[beam.a].active && body.nodes[beam.b].active) liveBeams++;
      }
      body.liveBeams = liveBeams;
      for (const n of body.nodes) {
        if (!n.active) continue;
        n.x += (n.ox - n.x) * step * 2;
        n.y += (n.oy - n.y) * step * 2;
        n.z += (n.oz - n.z) * step * 2;
        if (n.hp < n.maxHp) { n.hp = Math.min(n.maxHp, n.hp + n.maxHp * step); changed = true; }
      }
      this._updateRadius(body);
      if (changed) {
        any = true;
        body.meshDirty = true;
        this.wake(body, this.config.wakeHoldFrames);
      }
    }
    return any;
  }
};

export { BEAM_TYPE };
