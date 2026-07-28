const EPSILON = 1e-7;

// Collision exclusions are module-global so the destruction solver can query
// them without knowing which TowConstraintSystem instance owns a rope.
const collisionExclusions = new WeakMap();

function addCollisionExclusion(a, b) {
  if (!a || !b || a === b) return;
  let peers = collisionExclusions.get(a);
  if (!peers) {
    peers = new Map();
    collisionExclusions.set(a, peers);
  }
  peers.set(b, (peers.get(b) || 0) + 1);
}

function removeCollisionExclusion(a, b) {
  const peers = collisionExclusions.get(a);
  if (!peers) return;
  const next = (peers.get(b) || 0) - 1;
  if (next > 0) peers.set(b, next);
  else peers.delete(b);
}

function registerCollisionExclusion(a, b) {
  addCollisionExclusion(a, b);
  addCollisionExclusion(b, a);
}

function unregisterCollisionExclusion(a, b) {
  removeCollisionExclusion(a, b);
  removeCollisionExclusion(b, a);
}

export function areTowBodiesCollisionDisabled(a, b) {
  if (!a || !b) return false;

  // A train is one articulated vehicle. Adjacent modules are registered in
  // the WeakMap by their couplers, while this shared id also covers the first
  // and last module and any destruction fragments that retain their owner.
  // It prevents startup/self-overlap damage without disabling collisions with
  // asteroids, stations, wrecks or other trains.
  const rootA = a.owner || a;
  const rootB = b.owner || b;
  const trainA = rootA.towTrainId;
  if (trainA != null && trainA !== '' && trainA === rootB.towTrainId) return true;

  return !!(
    collisionExclusions.get(a)?.has(b)
    || collisionExclusions.get(rootA)?.has(rootB)
  );
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function bodyX(body) {
  if (body?.pos && Number.isFinite(Number(body.pos.x))) return Number(body.pos.x);
  if (Number.isFinite(Number(body?.worldX))) return Number(body.worldX);
  return finite(body?.x);
}

function bodyY(body) {
  if (body?.pos && Number.isFinite(Number(body.pos.y))) return Number(body.pos.y);
  if (Number.isFinite(Number(body?.worldY))) return Number(body.worldY);
  return finite(body?.y);
}

function bodyVx(body) {
  if (body?.vel && Number.isFinite(Number(body.vel.x))) return Number(body.vel.x);
  return finite(body?.vx);
}

function bodyVy(body) {
  if (body?.vel && Number.isFinite(Number(body.vel.y))) return Number(body.vel.y);
  return finite(body?.vy);
}

function bodyAngle(body) {
  if (Number.isFinite(Number(body?.angle))) return Number(body.angle);
  return finite(body?.rotZ);
}

function setBodyPosition(body, x, y) {
  if (!body) return;
  if (body.pos && typeof body.pos === 'object') {
    body.pos.x = x;
    body.pos.y = y;
  }
  if ('worldX' in body || 'worldY' in body) {
    body.worldX = x;
    body.worldY = y;
  }
  if ('x' in body || !body.pos) body.x = x;
  if ('y' in body || !body.pos) body.y = y;
}

function setBodyVelocity(body, vx, vy) {
  if (!body) return;
  if (body.vel && typeof body.vel === 'object') {
    body.vel.x = vx;
    body.vel.y = vy;
  }
  if ('vx' in body || !body.vel) body.vx = vx;
  if ('vy' in body || !body.vel) body.vy = vy;
}

function setBodyAngularVelocity(body, angularVelocity) {
  if (!body) return;
  if ('angVel' in body || !('spin' in body)) body.angVel = angularVelocity;
  if ('spin' in body) body.spin = angularVelocity;
}

function bodyAngularVelocity(body) {
  if (Number.isFinite(Number(body?.angVel))) return Number(body.angVel);
  return finite(body?.spin);
}

function bodyMass(body) {
  if (!body || body.towStatic === true || body.immovable === true || body.static === true) return Infinity;
  if (Number(body.towInvMass) === 0) return Infinity;
  const mass = Number(body.mass ?? body.rammingMass);
  return Number.isFinite(mass) && mass > 0 ? mass : 1;
}

function bodyInertia(body, mass) {
  if (!Number.isFinite(mass)) return Infinity;
  const explicit = Number(body?.inertia);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const width = Math.max(1, finite(body?.w, finite(body?.radius, 1) * 2));
  const height = Math.max(1, finite(body?.h, finite(body?.radius, 1) * 2));
  return Math.max(1, mass * (width * width + height * height) / 12);
}

function bodyIsGone(body) {
  return !body || body.dead === true || body.destroyed === true || body.removed === true || body.alive === false;
}

function wakeBody(body, onWake = null) {
  if (!body) return;
  if (body._wreckSleeping) {
    body._wreckSleeping = false;
    body._wreckSleepTimer = 0;
  }
  if (body.hexGrid?.isSleeping) {
    body.hexGrid.isSleeping = false;
    body.hexGrid.sleepFrames = 0;
    body.hexGrid.wakeHoldFrames = Math.max(20, body.hexGrid.wakeHoldFrames | 0);
  }
  if (typeof body.onTowWake === 'function') body.onTowWake(body);
  if (onWake) onWake(body);
}

function writeWorldAnchors(record) {
  const angleA = bodyAngle(record.bodyA);
  const angleB = bodyAngle(record.bodyB);
  const cosA = Math.cos(angleA);
  const sinA = Math.sin(angleA);
  const cosB = Math.cos(angleB);
  const sinB = Math.sin(angleB);

  record._rAx = record.localAx * cosA - record.localAy * sinA;
  record._rAy = record.localAx * sinA + record.localAy * cosA;
  record._rBx = record.localBx * cosB - record.localBy * sinB;
  record._rBy = record.localBx * sinB + record.localBy * cosB;
  record.worldAx = bodyX(record.bodyA) + record._rAx;
  record.worldAy = bodyY(record.bodyA) + record._rAy;
  record.worldBx = bodyX(record.bodyB) + record._rBx;
  record.worldBy = bodyY(record.bodyB) + record._rBy;
}

function applyVelocityImpulse(body, impulseX, impulseY, leverX, leverY, invMass, invInertia) {
  if (invMass <= 0) return;
  setBodyVelocity(
    body,
    bodyVx(body) + impulseX * invMass,
    bodyVy(body) + impulseY * invMass
  );
  if (invInertia > 0) {
    const torqueImpulse = leverX * impulseY - leverY * impulseX;
    setBodyAngularVelocity(body, bodyAngularVelocity(body) + torqueImpulse * invInertia);
  }
}

function applyPositionCorrection(record, nx, ny, stretch, invMassA, invMassB, subDt) {
  const invTotal = invMassA + invMassB;
  if (invTotal <= EPSILON || record.positionCorrection <= 0) return;
  const correction = Math.min(
    stretch * record.positionCorrection,
    record.maxCorrectionSpeed * subDt
  );
  if (correction <= EPSILON) return;

  if (invMassA > 0) {
    const shareA = invMassA / invTotal;
    setBodyPosition(
      record.bodyA,
      bodyX(record.bodyA) + nx * correction * shareA,
      bodyY(record.bodyA) + ny * correction * shareA
    );
  }
  if (invMassB > 0) {
    const shareB = invMassB / invTotal;
    setBodyPosition(
      record.bodyB,
      bodyX(record.bodyB) - nx * correction * shareB,
      bodyY(record.bodyB) - ny * correction * shareB
    );
  }
}

function applyPointPositionCorrection(record, dx, dy, invMassA, invMassB, subDt) {
  const invTotal = invMassA + invMassB;
  if (invTotal <= EPSILON || record.positionCorrection <= 0) return;

  const distanceSq = dx * dx + dy * dy;
  if (distanceSq <= EPSILON) return;
  const distance = Math.sqrt(distanceSq);
  const maxCorrection = record.maxCorrectionSpeed * subDt;
  const requested = distance * record.positionCorrection;
  const correctionScale = Math.min(requested, maxCorrection) / distance;
  const correctionX = dx * correctionScale;
  const correctionY = dy * correctionScale;

  if (invMassA > 0) {
    const shareA = invMassA / invTotal;
    setBodyPosition(
      record.bodyA,
      bodyX(record.bodyA) + correctionX * shareA,
      bodyY(record.bodyA) + correctionY * shareA
    );
  }
  if (invMassB > 0) {
    const shareB = invMassB / invTotal;
    setBodyPosition(
      record.bodyB,
      bodyX(record.bodyB) - correctionX * shareB,
      bodyY(record.bodyB) - correctionY * shareB
    );
  }
}

/**
 * Allocation-free hot-path rope/coupler solver.
 *
 * The constraint is unilateral: it pulls when longer than `length`, but never
 * pushes. `constraintType: 'point'` switches to a rigid pin joint: both world
 * anchors stay together and transfer acceleration, braking and angular force,
 * while each body remains free to articulate around the joint. The hinge can
 * carry bearing friction (`hingeFriction` bleeds relative angular velocity),
 * an optional legacy orientation spring (`angularStiffness`), and a mechanical
 * stop (`jointLimit` radians around `referenceAngle`).
 */
export class TowConstraintSystem {
  constructor(options = {}) {
    this.constraints = [];
    this.iterations = Math.max(1, Number(options.iterations) | 0 || 4);
    this.onWake = typeof options.onWake === 'function' ? options.onWake : null;
    this._nextId = 1;
    this._stepDt = 0;
  }

  attach(bodyA, bodyB, options = {}) {
    if (!bodyA || !bodyB || bodyA === bodyB) return null;

    const localA = options.localAnchorA || options.anchorA || {};
    const localB = options.localAnchorB || options.anchorB || {};
    const record = {
      id: this._nextId++,
      bodyA,
      bodyB,
      localAx: finite(localA.x),
      localAy: finite(localA.y),
      localBx: finite(localB.x),
      localBy: finite(localB.y),
      constraintType: options.constraintType === 'point' ? 'point' : 'rope',
      length: Math.max(0, finite(options.length ?? options.restLength, 0)),
      stiffness: clamp(finite(options.stiffness, 0.32), 0.01, 1),
      damping: clamp(finite(options.damping, 0.92), 0, 1),
      referenceAngle: Number.isFinite(Number(options.referenceAngle))
        ? Number(options.referenceAngle)
        : wrapAngle(bodyAngle(bodyB) - bodyAngle(bodyA)),
      angularStiffness: clamp(finite(options.angularStiffness, 0), 0, 1),
      angularDamping: clamp(finite(options.angularDamping, 0.92), 0, 1),
      hingeFriction: clamp(finite(options.hingeFriction, 0), 0, 1),
      jointLimit: Number.isFinite(Number(options.jointLimit)) && Number(options.jointLimit) >= 0
        ? Number(options.jointLimit)
        : Infinity,
      limitStiffness: clamp(finite(options.limitStiffness, 0.5), 0.01, 1),
      maxTorque: Math.max(0, finite(options.maxTorque, Infinity)),
      positionCorrection: clamp(finite(options.positionCorrection, 0.16), 0, 1),
      maxCorrectionSpeed: Math.max(0, finite(options.maxCorrectionSpeed, 1800)),
      maxForce: Math.max(0, finite(options.maxForce, Infinity)),
      breakForce: Math.max(0, finite(options.breakForce, Infinity)),
      collideConnected: options.collideConnected !== false,
      tag: options.tag || '',
      onBreak: typeof options.onBreak === 'function' ? options.onBreak : null,
      lastTension: 0,
      stretch: 0,
      worldAx: 0,
      worldAy: 0,
      worldBx: 0,
      worldBy: 0,
      _rAx: 0,
      _rAy: 0,
      _rBx: 0,
      _rBy: 0,
      _broken: false
    };

    writeWorldAnchors(record);
    if (!(Number(options.length ?? options.restLength) >= 0)) {
      record.length = Math.hypot(record.worldBx - record.worldAx, record.worldBy - record.worldAy);
    }
    if (!record.collideConnected) registerCollisionExclusion(bodyA, bodyB);
    this.constraints.push(record);
    wakeBody(bodyA, this.onWake);
    wakeBody(bodyB, this.onWake);
    return record;
  }

  detach(handleOrId, reason = 'detached') {
    const id = typeof handleOrId === 'object' ? handleOrId?.id : handleOrId;
    for (let i = 0; i < this.constraints.length; i++) {
      const record = this.constraints[i];
      if (record !== handleOrId && record.id !== id) continue;
      this._removeAt(i, reason);
      return true;
    }
    return false;
  }

  detachBody(body, reason = 'body-detached') {
    let removed = 0;
    for (let i = this.constraints.length - 1; i >= 0; i--) {
      const record = this.constraints[i];
      if (record.bodyA !== body && record.bodyB !== body) continue;
      this._removeAt(i, reason);
      removed++;
    }
    return removed;
  }

  clear(reason = 'cleared') {
    for (let i = this.constraints.length - 1; i >= 0; i--) this._removeAt(i, reason);
  }

  _removeAt(index, reason) {
    const record = this.constraints[index];
    if (!record) return;
    if (!record.collideConnected) unregisterCollisionExclusion(record.bodyA, record.bodyB);
    const last = this.constraints.pop();
    if (index < this.constraints.length) this.constraints[index] = last;
    if (reason === 'broken' && record.onBreak) record.onBreak(record, reason);
  }

  _solvePoint(record, subDt) {
    writeWorldAnchors(record);
    const dx = record.worldBx - record.worldAx;
    const dy = record.worldBy - record.worldAy;
    record.stretch = Math.hypot(dx, dy);

    const massA = bodyMass(record.bodyA);
    const massB = bodyMass(record.bodyB);
    const invMassA = Number.isFinite(massA) ? 1 / massA : 0;
    const invMassB = Number.isFinite(massB) ? 1 / massB : 0;
    const inertiaA = bodyInertia(record.bodyA, massA);
    const inertiaB = bodyInertia(record.bodyB, massB);
    const invInertiaA = Number.isFinite(inertiaA) ? 1 / inertiaA : 0;
    const invInertiaB = Number.isFinite(inertiaB) ? 1 / inertiaB : 0;
    const invMassSum = invMassA + invMassB;

    const angularA = bodyAngularVelocity(record.bodyA);
    const angularB = bodyAngularVelocity(record.bodyB);
    const anchorVax = bodyVx(record.bodyA) - angularA * record._rAy;
    const anchorVay = bodyVy(record.bodyA) + angularA * record._rAx;
    const anchorVbx = bodyVx(record.bodyB) - angularB * record._rBy;
    const anchorVby = bodyVy(record.bodyB) + angularB * record._rBx;

    let biasX = dx * record.stiffness / Math.max(subDt, EPSILON);
    let biasY = dy * record.stiffness / Math.max(subDt, EPSILON);
    const biasSq = biasX * biasX + biasY * biasY;
    // Baumgarte bias is real velocity that survives into frame integration.
    // Uncapped it can close several times the remaining gap in one frame
    // (stiffness/subDt counts the same positional error in every sub-step),
    // which flips the error sign each frame and shakes the whole train. Never
    // let it close more than the current gap over one frame step.
    const maxBias = Math.min(
      record.maxCorrectionSpeed,
      record.stretch / Math.max(this._stepDt, subDt, EPSILON)
    );
    if (biasSq > maxBias * maxBias && biasSq > EPSILON) {
      const biasScale = maxBias / Math.sqrt(biasSq);
      biasX *= biasScale;
      biasY *= biasScale;
    }

    const targetX = ((anchorVbx - anchorVax) + biasX) * record.damping;
    const targetY = ((anchorVby - anchorVay) + biasY) * record.damping;
    const k11 = invMassSum
      + record._rAy * record._rAy * invInertiaA
      + record._rBy * record._rBy * invInertiaB;
    const k12 = -record._rAx * record._rAy * invInertiaA
      - record._rBx * record._rBy * invInertiaB;
    const k22 = invMassSum
      + record._rAx * record._rAx * invInertiaA
      + record._rBx * record._rBx * invInertiaB;
    const determinant = k11 * k22 - k12 * k12;

    // `K` is built from inverse masses, so capital-sized bodies naturally
    // produce determinants around 1e-12. Comparing that value with the
    // linear-distance epsilon disabled all velocity/angular impulses for the
    // Megafreighter and left only the positional shove.
    if (determinant > EPSILON * EPSILON) {
      const invDet = 1 / determinant;
      let impulseX = (k22 * targetX - k12 * targetY) * invDet;
      let impulseY = (k11 * targetY - k12 * targetX) * invDet;
      if (Number.isFinite(record.maxForce)) {
        const maxImpulse = record.maxForce * subDt;
        const impulseSq = impulseX * impulseX + impulseY * impulseY;
        if (impulseSq > maxImpulse * maxImpulse && impulseSq > EPSILON) {
          const impulseScale = maxImpulse / Math.sqrt(impulseSq);
          impulseX *= impulseScale;
          impulseY *= impulseScale;
        }
      }

      const impulseMagnitude = Math.hypot(impulseX, impulseY);
      const tension = impulseMagnitude / Math.max(subDt, EPSILON);
      record.lastTension = Math.max(record.lastTension, tension);
      if (tension > record.breakForce) {
        record._broken = true;
        return;
      }

      applyVelocityImpulse(record.bodyA, impulseX, impulseY, record._rAx, record._rAy, invMassA, invInertiaA);
      applyVelocityImpulse(record.bodyB, -impulseX, -impulseY, record._rBx, record._rBy, invMassB, invInertiaB);
    }

    // A train coupler is a pin plus a damped free hinge — NOT an orientation
    // servo. A wagon turns because the pin drags its bow along the leader's
    // path (Newtonian trailing); `hingeFriction` only bleeds RELATIVE angular
    // velocity so the pendulum swing settles instead of oscillating forever.
    // Driving the relative ANGLE to zero here made the train torsion-rigid:
    // yawing the head swung the tail the opposite way (the "banana" bug).
    // `angularStiffness` therefore stays opt-in for joints that want a spring,
    // and `jointLimit` models the coupler's mechanical stop against jackknife.
    const angularInvMass = invInertiaA + invInertiaB;
    if (angularInvMass > EPSILON * EPSILON) {
      if (record.angularStiffness > 0) {
        const angularError = wrapAngle(
          (bodyAngle(record.bodyB) - bodyAngle(record.bodyA)) - record.referenceAngle
        );
        const relativeAngularVelocity = bodyAngularVelocity(record.bodyB) - bodyAngularVelocity(record.bodyA);
        const angularBias = angularError * record.angularStiffness / Math.max(subDt, EPSILON);
        let angularImpulse = (relativeAngularVelocity + angularBias) * record.angularDamping / angularInvMass;
        if (Number.isFinite(record.maxTorque)) {
          angularImpulse = clamp(angularImpulse, -record.maxTorque * subDt, record.maxTorque * subDt);
        }
        if (invInertiaA > 0) {
          setBodyAngularVelocity(
            record.bodyA,
            bodyAngularVelocity(record.bodyA) + angularImpulse * invInertiaA
          );
        }
        if (invInertiaB > 0) {
          setBodyAngularVelocity(
            record.bodyB,
            bodyAngularVelocity(record.bodyB) - angularImpulse * invInertiaB
          );
        }
      }

      if (record.hingeFriction > 0) {
        const relativeAngularVelocity = bodyAngularVelocity(record.bodyB) - bodyAngularVelocity(record.bodyA);
        let frictionImpulse = relativeAngularVelocity * record.hingeFriction / angularInvMass;
        if (Number.isFinite(record.maxTorque)) {
          frictionImpulse = clamp(frictionImpulse, -record.maxTorque * subDt, record.maxTorque * subDt);
        }
        if (invInertiaA > 0) {
          setBodyAngularVelocity(
            record.bodyA,
            bodyAngularVelocity(record.bodyA) + frictionImpulse * invInertiaA
          );
        }
        if (invInertiaB > 0) {
          setBodyAngularVelocity(
            record.bodyB,
            bodyAngularVelocity(record.bodyB) - frictionImpulse * invInertiaB
          );
        }
      }

      if (Number.isFinite(record.jointLimit)) {
        const relativeAngle = wrapAngle(
          (bodyAngle(record.bodyB) - bodyAngle(record.bodyA)) - record.referenceAngle
        );
        let violation = 0;
        if (relativeAngle > record.jointLimit) violation = relativeAngle - record.jointLimit;
        else if (relativeAngle < -record.jointLimit) violation = relativeAngle + record.jointLimit;
        if (violation !== 0) {
          const relativeAngularVelocity = bodyAngularVelocity(record.bodyB) - bodyAngularVelocity(record.bodyA);
          let limitImpulse = (relativeAngularVelocity + violation * record.limitStiffness / Math.max(subDt, EPSILON))
            / angularInvMass;
          // The stop is one-sided and inelastic: it may only push the joint
          // back inside its cone, never drag it outward or add bounce.
          limitImpulse = violation > 0 ? Math.max(0, limitImpulse) : Math.min(0, limitImpulse);
          if (Number.isFinite(record.maxTorque)) {
            limitImpulse = clamp(limitImpulse, -record.maxTorque * subDt, record.maxTorque * subDt);
          }
          if (limitImpulse !== 0) {
            if (invInertiaA > 0) {
              setBodyAngularVelocity(
                record.bodyA,
                bodyAngularVelocity(record.bodyA) + limitImpulse * invInertiaA
              );
            }
            if (invInertiaB > 0) {
              setBodyAngularVelocity(
                record.bodyB,
                bodyAngularVelocity(record.bodyB) - limitImpulse * invInertiaB
              );
            }
          }
        }
      }
    }

    applyPointPositionCorrection(record, dx, dy, invMassA, invMassB, subDt);
    wakeBody(record.bodyA, this.onWake);
    wakeBody(record.bodyB, this.onWake);
  }

  _solve(record, subDt) {
    if (record.constraintType === 'point') {
      this._solvePoint(record, subDt);
      return;
    }
    writeWorldAnchors(record);
    const dx = record.worldBx - record.worldAx;
    const dy = record.worldBy - record.worldAy;
    const distSq = dx * dx + dy * dy;
    if (distSq <= EPSILON) {
      record.stretch = 0;
      return;
    }

    const distance = Math.sqrt(distSq);
    const stretch = distance - record.length;
    record.stretch = Math.max(0, stretch);
    if (stretch <= EPSILON) return;

    const nx = dx / distance;
    const ny = dy / distance;
    const massA = bodyMass(record.bodyA);
    const massB = bodyMass(record.bodyB);
    const invMassA = Number.isFinite(massA) ? 1 / massA : 0;
    const invMassB = Number.isFinite(massB) ? 1 / massB : 0;
    const inertiaA = bodyInertia(record.bodyA, massA);
    const inertiaB = bodyInertia(record.bodyB, massB);
    const invInertiaA = Number.isFinite(inertiaA) ? 1 / inertiaA : 0;
    const invInertiaB = Number.isFinite(inertiaB) ? 1 / inertiaB : 0;

    const crossA = record._rAx * ny - record._rAy * nx;
    const crossB = record._rBx * ny - record._rBy * nx;
    const effectiveInvMass = invMassA + invMassB
      + crossA * crossA * invInertiaA
      + crossB * crossB * invInertiaB;
    if (effectiveInvMass <= EPSILON) return;

    const angularA = bodyAngularVelocity(record.bodyA);
    const angularB = bodyAngularVelocity(record.bodyB);
    const anchorVax = bodyVx(record.bodyA) - angularA * record._rAy;
    const anchorVay = bodyVy(record.bodyA) + angularA * record._rAx;
    const anchorVbx = bodyVx(record.bodyB) - angularB * record._rBy;
    const anchorVby = bodyVy(record.bodyB) + angularB * record._rBx;
    const separatingSpeed = (anchorVbx - anchorVax) * nx + (anchorVby - anchorVay) * ny;
    const closingBias = Math.min(record.maxCorrectionSpeed, stretch * record.stiffness / Math.max(subDt, EPSILON));
    const correctionSpeed = separatingSpeed + closingBias;
    if (correctionSpeed <= 0) return;

    let impulse = correctionSpeed * record.damping / effectiveInvMass;
    if (Number.isFinite(record.maxForce)) impulse = Math.min(impulse, record.maxForce * subDt);
    const tension = impulse / Math.max(subDt, EPSILON);
    record.lastTension = Math.max(record.lastTension, tension);
    if (tension > record.breakForce) {
      record._broken = true;
      return;
    }

    const impulseX = nx * impulse;
    const impulseY = ny * impulse;
    applyVelocityImpulse(record.bodyA, impulseX, impulseY, record._rAx, record._rAy, invMassA, invInertiaA);
    applyVelocityImpulse(record.bodyB, -impulseX, -impulseY, record._rBx, record._rBy, invMassB, invInertiaB);
    applyPositionCorrection(record, nx, ny, stretch, invMassA, invMassB, subDt);
    wakeBody(record.bodyA, this.onWake);
    wakeBody(record.bodyB, this.onWake);
  }

  update(dt) {
    const step = clamp(finite(dt, 0), 0, 0.1);
    if (step <= 0 || this.constraints.length === 0) return;

    for (let i = this.constraints.length - 1; i >= 0; i--) {
      const record = this.constraints[i];
      if (bodyIsGone(record.bodyA) || bodyIsGone(record.bodyB)) this._removeAt(i, 'body-gone');
      else {
        record.lastTension = 0;
        record._broken = false;
      }
    }

    const subDt = step / this.iterations;
    this._stepDt = step;
    for (let iteration = 0; iteration < this.iterations; iteration++) {
      for (let i = 0; i < this.constraints.length; i++) {
        const record = this.constraints[i];
        if (!record._broken) this._solve(record, subDt);
      }
    }

    for (let i = this.constraints.length - 1; i >= 0; i--) {
      const record = this.constraints[i];
      if (record._broken) this._removeAt(i, 'broken');
      else writeWorldAnchors(record);
    }
  }

  forEach(callback) {
    for (let i = 0; i < this.constraints.length; i++) callback(this.constraints[i], i);
  }

  get size() {
    return this.constraints.length;
  }
}
