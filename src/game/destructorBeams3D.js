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

import { BEAM_TYPE, computeNodeSetInertia } from './beamBody3D.js';

export function createBeamConfig(cellSize = 1) {
  const cs = Math.max(1e-6, Number(cellSize) || 1);
  return {
    cellSize: cs,

    // --- solver miękkiego ciała ---
    solverIterations: 3,
    nodeDamping: 0.12,          // tłumienie prędkości węzłów (na sekundę)
    plasticRate: 0.55,          // ile odkształcenia ponad próg zostaje na stałe
    maxRestDrift: 0.75,         // limit zmiany długości spoczynkowej (× oryginał)
    breakEnabled: 1,
    globalStiffnessMul: 1.0,
    globalBreakMul: 1.0,

    // --- kolizje ---
    nodeRadius: cs * 0.55,
    collisionIterations: 2,
    maxContacts: 64,
    restitution: 0.05,
    friction: 0.5,
    separationPercent: 0.9,
    separationSlop: cs * 0.02,

    // Ile penetracji przechodzi w lokalny zgniot węzłów. To ta liczba decyduje,
    // czy kadłuby się odbijają, czy wzajemnie wgniatają.
    crushTransfer: 0.85,
    crushSpeedThreshold: 3.0 * cs,
    crushMassBias: 0.65,

    // --- broń ---
    impactRadius: 3.0 * cs,
    impactBeamBreakRadius: 1.6 * cs,
    impactPush: 0.9,

    // --- rozpady ---
    splitCheckInterval: 10,
    splitMinNodes: 4,
    splitMaxPerTick: 2,
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
  return matVec(m, lx, ly, lz, o);
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

  perf: {
    lastUpdateMs: 0,
    lastSolverMs: 0,
    lastCollisionMs: 0,
    lastSplitMs: 0,
    contacts: 0,
    beamsBroken: 0,
    solvedBeams: 0
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
    const body = {
      id: NEXT_BODY_ID++,
      name: opts.name || `beam${NEXT_BODY_ID}`,
      pos: { x: 0, y: 0, z: 0, ...(opts.position || {}) },
      vel: { x: 0, y: 0, z: 0, ...(opts.velocity || {}) },
      quat: { x: 0, y: 0, z: 0, w: 1, ...(opts.quaternion || {}) },
      angVel: { x: 0, y: 0, z: 0, ...(opts.angularVelocity || {}) },
      mass: structure.mass,
      invMass: opts.static ? 0 : 1 / structure.mass,
      static: !!opts.static,
      invInertiaLocal: structure.invInertia.slice(),
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
      _splitDefer: 0
    };
    quatToMat3(body.quat, body._rot);
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
    if (body._hashTick === this._tick) return body._hash;
    const hash = body._hash;
    hash.clear();
    const cs = body.cellSize;
    for (const n of body.nodes) {
      if (!n.active || !n.surface) continue;
      const key = hashKey(Math.floor(n.x / cs), Math.floor(n.y / cs), Math.floor(n.z / cs));
      let bucket = hash.get(key);
      if (!bucket) { bucket = []; hash.set(key, bucket); }
      bucket.push(n);
    }
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
    const plasticRate = cfg.plasticRate;
    const breakOn = (cfg.breakEnabled | 0) === 1;
    const stiffMul = cfg.globalStiffnessMul;
    const breakMul = cfg.globalBreakMul;
    let solved = 0;
    let broke = 0;

    for (const body of bodies) {
      if (!body || body.dead) continue;
      if (body.isSleeping && (body.wakeHold | 0) <= 0) continue;

      const nodes = body.nodes;
      const beams = body.beams;

      // 1) predykcja pozycji z prędkości
      for (const n of nodes) {
        if (!n.active) continue;
        n.px = n.x; n.py = n.y; n.pz = n.z;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.z += n.vz * dt;
      }

      // 2) rzutowanie ograniczeń długości belek
      for (let it = 0; it < iterations; it++) {
        // Plastyczność i zerwanie oceniamy w PIERWSZEJ iteracji. Kolejne iteracje
        // ściągają węzły do długości spoczynkowych, więc widziane przez nie
        // odkształcenie jest już wyzerowane — materiał nigdy by się nie odkształcił.
        const measureIter = it === 0;
        for (let bi = 0; bi < beams.length; bi++) {
          const beam = beams[bi];
          if (beam.broken) continue;
          const a = nodes[beam.a];
          const c = nodes[beam.b];
          if (!a.active || !c.active) continue;

          const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z;
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (len < 1e-9) continue;

          const rest = beam.rest;
          const C = len - rest;
          const strain = C / rest;

          if (measureIter) {
            beam.strain = strain;
            const aStrain = strain < 0 ? -strain : strain;
            if (breakOn && aStrain > beam.break * breakMul) {
              beam.broken = true;
              body.structureDirty = true;
              broke++;
              continue;
            }
            if (aStrain > beam.deform) {
              // Trwałe odkształcenie: długość spoczynkowa wędruje ku bieżącej.
              const over = C - Math.sign(C) * beam.deform * rest;
              const next = rest + over * plasticRate;
              const lo = beam.restBase * (1 - cfg.maxRestDrift);
              const hi = beam.restBase * (1 + cfg.maxRestDrift);
              beam.rest = next < lo ? lo : (next > hi ? hi : next);
              body.meshDirty = true;
            }
          }

          const wa = a.invMass, wc = c.invMass;
          const wsum = wa + wc;
          if (wsum <= 0) continue;
          const k = beam.stiffness * stiffMul;
          const corr = (C / len) * (k / wsum);
          const cx = dx * corr, cy = dy * corr, cz = dz * corr;
          a.x += cx * wa; a.y += cy * wa; a.z += cz * wa;
          c.x -= cx * wc; c.y -= cy * wc; c.z -= cz * wc;
          solved++;
        }
      }

      // 3) prędkości z przesunięcia pozycji + tłumienie
      const invDt = 1 / dt;
      let motion = 0;
      for (const n of nodes) {
        if (!n.active) continue;
        n.vx = (n.x - n.px) * invDt * damp;
        n.vy = (n.y - n.py) * invDt * damp;
        n.vz = (n.z - n.pz) * invDt * damp;
        const m = Math.abs(n.vx) + Math.abs(n.vy) + Math.abs(n.vz);
        if (m > motion) motion = m;
      }

      // 4) Zdejmij translację netto chmury węzłów. Pozycję całości niesie ciało
      // sztywne, więc pole deformacji musi mieć zerową średnią — inaczej kadłub
      // powoli odpływa od własnego środka masy.
      let mx = 0, my = 0, mz = 0, msum = 0;
      for (const n of nodes) {
        if (!n.active) continue;
        mx += (n.x - n.ox) * n.mass;
        my += (n.y - n.oy) * n.mass;
        mz += (n.z - n.oz) * n.mass;
        msum += n.mass;
      }
      if (msum > 0) {
        mx /= msum; my /= msum; mz /= msum;
        const drift = Math.abs(mx) + Math.abs(my) + Math.abs(mz);
        if (drift > 1e-9) {
          for (const n of nodes) {
            if (!n.active) continue;
            n.x -= mx; n.y -= my; n.z -= mz;
          }
        }
      }

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
      for (const body of bodies) {
        if (body?.structureDirty && !body.noSplit && this.splitQueue.indexOf(body) === -1) {
          this.splitQueue.push(body);
        }
      }
    }
    this.perf.solvedBeams = solved;
    this.perf.lastSolverMs = nowMs() - t0;
  },

  // --------------------------- PĘTLA ---------------------------

  update(dt, bodies) {
    const t0 = nowMs();
    this._tick++;
    this.perf.contacts = 0;
    const cfg = this.config;

    for (const b of bodies) if (b && !b.dead) this._refreshRot(b);

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

          this.collideBodies(A, B, dt, it === 0);
        }
      }
    }
    const tAfterCol = nowMs();

    this.solveSoftBody(dt, bodies);

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
    const nodeR = cfg.nodeRadius;
    const contactDist = nodeR * 2;
    const contactDistSq = contactDist * contactDist;
    const reach = holder.radius + cs * 2;
    const reachSq = reach * reach;

    const wI = this._s1, lH = this._s2, wH = this._s3;
    const swapped = iter !== A;

    let count = 0;
    let hitX = 0, hitY = 0, hitZ = 0;
    let nX = 0, nY = 0, nZ = 0;
    let penetration = 0;
    const contactsA = [];
    const contactsB = [];
    const maxContacts = Math.max(8, cfg.maxContacts | 0);

    for (const nI of iter.nodes) {
      if (!nI.active || !nI.surface) continue;

      matVec(mI, nI.x, nI.y, nI.z, wI);
      wI.x += iter.pos.x; wI.y += iter.pos.y; wI.z += iter.pos.z;

      const hdx = wI.x - holder.pos.x, hdy = wI.y - holder.pos.y, hdz = wI.z - holder.pos.z;
      if (hdx * hdx + hdy * hdy + hdz * hdz > reachSq) continue;
      matVecT(mH, hdx, hdy, hdz, lH);

      const ci = Math.floor(lH.x / cs), cj = Math.floor(lH.y / cs), ck = Math.floor(lH.z / cs);
      let found = null;
      let bestD2 = contactDistSq;

      for (let dk = -1; dk <= 1 && !found; dk++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const bucket = hash.get(hashKey(ci + di, cj + dj, ck + dk));
            if (!bucket) continue;
            for (const nH of bucket) {
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
      contactsA.push(swapped ? found : nI);
      contactsB.push(swapped ? nI : found);
      count++;
      if (count >= maxContacts) break;
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
    const velAlongNormal = dvx * nX + dvy * nY + dvz * nZ;
    const approach = Math.max(0, -velAlongNormal);

    const massA = Math.max(1, A.mass * A.rammingMassMult);
    const massB = Math.max(1, B.mass * B.rammingMassMult);
    const invMassA = A.static ? 0 : 1 / massA;
    const invMassB = B.static ? 0 : 1 / massB;

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
        const crushing = approach > cfg.crushSpeedThreshold;
        const rest = crushing ? 0 : cfg.restitution;
        let j = (-(1 + rest) * velAlongNormal) / denom;
        if (crushing) j *= (1 - cfg.crushTransfer);
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
    if (approach > cfg.crushSpeedThreshold || penetration > cfg.nodeRadius * 0.5) {
      const bias = cfg.crushMassBias;
      const total = massA + massB;
      // Lżejsze ciało zgniata się bardziej — kwadraty stosunków mas jak w 2D.
      const shareA = A.static ? 0 : Math.pow(massB / total, bias);
      const shareB = B.static ? 0 : Math.pow(massA / total, bias);
      const depth = penetration * cfg.crushTransfer;

      const lnA = matVecT(this._refreshRot(A), -nX, -nY, -nZ, this._s4);
      const lnB = matVecT(this._refreshRot(B), nX, nY, nZ, this._s5);

      for (let i = 0; i < count; i++) {
        const na = contactsA[i];
        const nb = contactsB[i];
        if (na?.active && shareA > 0) {
          const d = depth * shareA;
          na.x += lnA.x * d; na.y += lnA.y * d; na.z += lnA.z * d;
        }
        if (nb?.active && shareB > 0) {
          const d = depth * shareB;
          nb.x += lnB.x * d; nb.y += lnB.y * d; nb.z += lnB.z * d;
        }
      }
      A.meshDirty = true;
      B.meshDirty = true;
    }

    // --- separacja ciał sztywnych ---
    const slop = cfg.separationSlop;
    if (penetration > slop && (invMassA + invMassB) > 0) {
      const corr = (penetration - slop) / (invMassA + invMassB) * cfg.separationPercent;
      A.pos.x += nX * corr * invMassA; A.pos.y += nY * corr * invMassA; A.pos.z += nZ * corr * invMassA;
      B.pos.x -= nX * corr * invMassB; B.pos.y -= nY * corr * invMassB; B.pos.z -= nZ * corr * invMassB;
    }
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
    if (!body || body.dead) return false;
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
    const live = new Int32Array(nodes.length);
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
    body.mass = Math.max(1, body.mass - node.mass);
    if (!body.static) body.invMass = 1 / body.mass;

    for (const bi of node.beams) {
      const beam = body.beams[bi];
      if (beam && !beam.broken) {
        beam.broken = true;
        body.liveBeams = Math.max(0, body.liveBeams - 1);
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

    for (const body of queued) {
      if (!body || body.dead || !body.structureDirty) continue;
      if (processed >= Math.max(1, cfg.splitMaxPerTick | 0)) {
        this.splitQueue.push(body);
        continue;
      }
      body.structureDirty = false;

      const groups = this.findIslands(body);
      if (groups.length <= 1) continue;
      groups.sort((a, b) => b.length - a.length);

      for (let gi = 1; gi < groups.length; gi++) {
        const group = groups[gi];
        if (group.length < Math.max(2, cfg.splitMinNodes | 0)) {
          for (const n of group) this.destroyNode(body, n);
          continue;
        }
        this._spawnWreck(body, group, bodies);
      }
      this._rebuildBody(body, groups[0]);
      processed++;
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
    for (const beam of body.beams) {
      if (beam.broken) continue;
      const a = body.nodes[beam.a];
      const c = body.nodes[beam.b];
      if (!indexMap.has(a) || !indexMap.has(c)) continue;
      kept.push({ ...beam, a: indexMap.get(a), b: indexMap.get(c) });
    }
    // Przepnij listy belek węzłów na nową numerację.
    for (const n of nodes) n.beams = [];
    for (let i = 0; i < kept.length; i++) {
      nodes[kept[i].a].beams.push(i);
      nodes[kept[i].b].beams.push(i);
    }
    for (let i = 0; i < nodes.length; i++) nodes[i].id = i;
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

    let radius = 0;
    for (const n of part.nodes) {
      const d = Math.sqrt(n.ox * n.ox + n.oy * n.oy + n.oz * n.oz);
      if (d > radius) radius = d;
    }
    body.radius = radius + body.cellSize;
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
      _splitDefer: 0
    };
    quatToMat3(wreck.quat, wreck._rot);

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

  /** Naprawa: długości spoczynkowe wracają do oryginału, belki się zrastają. */
  repair(bodies, dt) {
    const step = Math.min(1, Math.max(0.001, dt));
    let any = false;
    for (const body of bodies) {
      if (!body || body.dead) continue;
      let changed = false;
      for (const beam of body.beams) {
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
      }
      for (const n of body.nodes) {
        if (!n.active) continue;
        n.x += (n.ox - n.x) * step * 2;
        n.y += (n.oy - n.y) * step * 2;
        n.z += (n.oz - n.z) * step * 2;
        if (n.hp < n.maxHp) { n.hp = Math.min(n.maxHp, n.hp + n.maxHp * step); changed = true; }
      }
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
