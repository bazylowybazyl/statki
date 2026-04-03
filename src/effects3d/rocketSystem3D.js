/**
 * 3D Rocket System — full physics, fire/smoke GPU particles, explosions.
 * Ported from rakiety.html RocketManager + integration layer.
 *
 * Coordinate convention (overlay scene, Y-up):
 *   game world (x, y) → overlay (x, 0, y)
 *   height above ground → overlay Y
 *
 * Usage in index.html:
 *   import { initRocketSystem3D, fireRocket3D, updateRocketSystem3D } ...
 *   initRocketSystem3D(overlay3D.scene)
 *   // every frame: updateRocketSystem3D(dt)
 *   // on fire:     fireRocket3D(gameX, gameY, target, damage, weaponDef, 'blue')
 */
import * as THREE from "three";
import { RocketFireGPU, FlameSettings } from "./rocketFireGPU.js";
import { RocketSmokeGPU } from "./rocketSmokeGPU.js";

/* ═══════════════════════════════════════════════════
   TUNABLES
   ═══════════════════════════════════════════════════ */

/** World scale: converts rakiety.html units → game world units. */
const WS = 0.1;

const PHYSICS = Object.freeze({
    gravity:  9.81 * 80 * WS,   // 78.48 u/s²
    airDrag:  0.0001
});

const ROCKET = Object.freeze({
    mass:            8000,
    maxThrust:       28_000_000 * WS,   // 2 800 000
    turnSpeedMin:    1.0,
    turnSpeedMax:    1.6,
    ejectUp:         1500 * WS,          // 150 u/s
    ejectUpRandom:   1000 * WS,          // +0…100
    ejectSpread:     1500 * WS,          // ±150 horizontal
    hitRadius:       800  * WS,          // 80 game units
    bodyLength:      160  * WS,          // 16
    bodyRadTop:      8    * WS,          // 0.8
    bodyRadBot:      16   * WS,          // 1.6
    exhaustOffset:   60   * WS,          // 6 (local, behind rocket)
    exhaustVel:      1200 * WS,          // 120
    exhaustSpread:   180  * WS,          // 18
    exhaustGap:      12   * WS,          // 1.2 (min distance between particles)
    maxRockets:      2000,
    maxAltitude:     500  * WS
});

/* ── Reusable temp vectors (allocated once) ── */
const _dummy     = new THREE.Object3D();
const _force     = new THREE.Vector3();
const _forward   = new THREE.Vector3();
const _drag      = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _qTarget   = new THREE.Quaternion();
const _exhaustP  = new THREE.Vector3();
const _BASE_FWD  = new THREE.Vector3(0, 1, 0);  // rocket nose in local space
const _VISUAL_FWD = new THREE.Vector3(0, 0, 1);
const _renderDir = new THREE.Vector3();
const _renderQuat = new THREE.Quaternion();
const _leadAim2D = { x: 0, y: 0 };

function getTargetVelocity2D(target) {
    if (!target) return { x: 0, y: 0 };
    const vel = target.vel || target.velocity || null;
    return {
        x: Number(target.vx ?? vel?.x) || 0,
        y: Number(target.vy ?? vel?.y) || 0
    };
}

function solveLeadAim2D(shooterPos, shooterVel, target, projectileSpeed, out = _leadAim2D) {
    const tx = Number(target?.x ?? target?.pos?.x) || 0;
    const ty = Number(target?.y ?? target?.pos?.y) || 0;
    const tv = getTargetVelocity2D(target);
    const speed = Math.max(1, projectileSpeed);
    const rx = tx - shooterPos.x;
    const ry = ty - shooterPos.y;
    const rvx = tv.x - (Number(shooterVel?.x) || 0);
    const rvy = tv.y - (Number(shooterVel?.y) || 0);
    const a = rvx * rvx + rvy * rvy - speed * speed;
    const b = 2 * (rx * rvx + ry * rvy);
    const c = rx * rx + ry * ry;
    let t = 0;
    if (Math.abs(a) < 1e-6) {
        if (Math.abs(b) > 1e-6) t = -c / b;
    } else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
            const sqrtDisc = Math.sqrt(disc);
            const t1 = (-b - sqrtDisc) / (2 * a);
            const t2 = (-b + sqrtDisc) / (2 * a);
            t = Math.min(t1, t2);
            if (t < 0) t = Math.max(t1, t2);
        }
    }
    if (!Number.isFinite(t) || t < 0) t = 0;
    out.x = tx + tv.x * t;
    out.y = ty + tv.y * t;
    return out;
}

function resolveRocketProfile(weaponDef) {
    const desiredSpeed = Math.max(400, Number(weaponDef?.baseSpeed) || Number(weaponDef?.speed) || 1200);
    const maxRange = Math.max(3000, Number(weaponDef?.baseRange) || Number(weaponDef?.range) || 12000);
    const blastRadius = Math.max(24, Number(weaponDef?.explodeRadius) || Number(weaponDef?.explosionRadius) || 48);
    const turnRateDeg = Math.max(25, Number(weaponDef?.turnRate) || 180);
    const speedFactor = THREE.MathUtils.clamp(desiredSpeed / 1200, 0.6, 4.0);
    const turnPenalty = THREE.MathUtils.clamp(180 / turnRateDeg, 0.45, 4.0);
    const homingDelay = THREE.MathUtils.clamp(Number(weaponDef?.homingDelay) || 0, 0, 3);
    const ignitionDelayRaw = Number(weaponDef?.ignitionDelay);
    const speedScale = Math.max(0.9, desiredSpeed / 900);
    const cruiseAltitudeDefault = Math.min(ROCKET.maxAltitude * 0.72, Math.max(10, desiredSpeed * 0.015));
    const cruiseAltitudeRaw = Number(weaponDef?.cruiseAltitude);
    const proximityDefault = Math.max(blastRadius * 0.9, 38 * speedFactor * Math.sqrt(turnPenalty));
    const proximityRadius = THREE.MathUtils.clamp(
        Number(weaponDef?.proximityRadius) || proximityDefault,
        50,
        320
    );
    const terminalRadius = THREE.MathUtils.clamp(
        Number(weaponDef?.terminalRadius) || Math.max(proximityRadius * 2.15, desiredSpeed * 0.16 * turnPenalty),
        proximityRadius * 1.2,
        Math.max(proximityRadius * 4.5, 900)
    );
    const reacquireRadius = THREE.MathUtils.clamp(
        Number(weaponDef?.reacquireRadius) || Math.max(terminalRadius * 1.45, desiredSpeed * 0.36 * turnPenalty),
        terminalRadius,
        Math.max(terminalRadius * 4.0, 2400)
    );
    return {
        desiredSpeed,
        maxRange,
        blastRadius,
        turnRateRad: THREE.MathUtils.degToRad(turnRateDeg),
        homingDelay: Number.isFinite(homingDelay) ? homingDelay : 0,
        ignitionDelay: Number.isFinite(ignitionDelayRaw)
            ? THREE.MathUtils.clamp(ignitionDelayRaw, 0.05, 0.35)
            : 0.12,
        maxThrust: ROCKET.maxThrust * speedScale,
        cruiseAltitude: Number.isFinite(cruiseAltitudeRaw)
            ? THREE.MathUtils.clamp(cruiseAltitudeRaw, 0, ROCKET.maxAltitude * 0.9)
            : cruiseAltitudeDefault,
        proximityRadius,
        terminalRadius,
        reacquireRadius,
        reacquireTurnMultiplier: THREE.MathUtils.clamp(
            Number(weaponDef?.reacquireTurnMultiplier) || THREE.MathUtils.lerp(2.3, 1.55, THREE.MathUtils.clamp(turnRateDeg / 420, 0, 1)),
            1.2,
            3.2
        ),
        reacquireSpeedFactor: THREE.MathUtils.clamp(
            Number(weaponDef?.reacquireSpeedFactor) || THREE.MathUtils.lerp(0.52, 0.72, THREE.MathUtils.clamp(turnRateDeg / 420, 0, 1)),
            0.35,
            0.95
        ),
        terminalSpeedFactor: THREE.MathUtils.clamp(
            Number(weaponDef?.terminalSpeedFactor) || THREE.MathUtils.lerp(0.68, 0.86, THREE.MathUtils.clamp(turnRateDeg / 420, 0, 1)),
            0.45,
            1.0
        ),
        leadHorizon: THREE.MathUtils.clamp(
            Number(weaponDef?.leadHorizon) || THREE.MathUtils.lerp(0.82, 0.38, THREE.MathUtils.clamp(turnRateDeg / 420, 0, 1)),
            0,
            1
        ),
        terminalLeadHorizon: THREE.MathUtils.clamp(
            Number(weaponDef?.terminalLeadHorizon) || THREE.MathUtils.lerp(0.18, 0.06, THREE.MathUtils.clamp(turnRateDeg / 420, 0, 1)),
            0,
            0.5
        ),
        bodyScale: THREE.MathUtils.clamp(Number(weaponDef?.bodyScale) || 1, 0.35, 3.0),
        exhaustScale: THREE.MathUtils.clamp(Number(weaponDef?.exhaustScale) || 1, 0.35, 3.0),
        fireScale: THREE.MathUtils.clamp(Number(weaponDef?.fireScale) || 1, 0.2, 3.0),
        smokeScale: THREE.MathUtils.clamp(Number(weaponDef?.smokeScale) || 1, 0.2, 3.0),
        explosionVisualScale: THREE.MathUtils.clamp(Number(weaponDef?.explosionVisualScale) || 1, 0.25, 4.0),
        hitRadius: proximityRadius
    };
}

/* ── Singleton ── */
let instance = null;

/* ═══════════════════════════════════════════════════
   CLASS
   ═══════════════════════════════════════════════════ */

class RocketSystem3D {
    constructor(overlayScene) {
        this.scene      = overlayScene;
        this.globalTime = 0;

        /* ── GPU particle systems ── */
        this.fireGPU  = new RocketFireGPU(overlayScene, 300000);
        this.smokeGPU = new RocketSmokeGPU(overlayScene, 200000);

        /* ── Rocket body InstancedMesh ── */
        const geo = new THREE.CylinderGeometry(
            ROCKET.bodyRadTop, ROCKET.bodyRadBot, ROCKET.bodyLength, 8
        );
        geo.rotateX(Math.PI * 0.5);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xe6e6e6,
            depthWrite: false,
            depthTest: false,
            transparent: true,
            opacity: 0.98,
            toneMapped: false
        });
        this.mesh = new THREE.InstancedMesh(geo, mat, ROCKET.maxRockets);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1002;
        overlayScene.add(this.mesh);

        /* ── Rocket data pool ── */
        this.rockets = [];
        for (let i = 0; i < ROCKET.maxRockets; i++) {
            this.rockets.push({
                active: false,
                index:  i,
                position:       new THREE.Vector3(),
                velocity:       new THREE.Vector3(),
                quaternion:     new THREE.Quaternion(),
                prevExhaustPos: new THREE.Vector3(),
                target:         null,
                state:          "EJECTED",
                timeSinceLaunch: 0,
                mass:           0,
                maxThrust:      0,
                currentThrust:  0,
                turnRateRad:    0,
                homingDelay:    0,
                ignitionDelay:  0,
                cruiseAltitude: 0,
                guidancePhase:  "launch",
                damage:         0,
                blastRadius:    0,
                desiredSpeed:   0,
                maxRange:       0,
                hitRadius:      0,
                proximityRadius: 0,
                terminalRadius: 0,
                reacquireRadius: 0,
                reacquireTurnMultiplier: 1,
                reacquireSpeedFactor: 1,
                terminalSpeedFactor: 1,
                leadHorizon: 0,
                terminalLeadHorizon: 0,
                bodyScale: 1,
                exhaustScale: 1,
                fireScale: 1,
                smokeScale: 1,
                explosionVisualScale: 1,
                didImpactDamage:false,
                weaponDef:      null,
                launchPos:      new THREE.Vector3(),
                prevTravelPos:  new THREE.Vector3(),
                travelDistance: 0,
                closestTargetDist: Infinity,
                lastTargetDist: Infinity,
                missCount: 0,
                reacquireUntil: 0,
                terminalEnteredAtDist: Infinity,
                missGrowTime: 0,
                visualDir:      new THREE.Vector3(0, 0, 1)
            });
            _dummy.position.set(0, -999999, 0);
            _dummy.updateMatrix();
            this.mesh.setMatrixAt(i, _dummy.matrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    /* ─────────────────── FIRE ─────────────────── */

    /**
     * Launch one 3D rocket.
     * @param {number}      gameX      — world X position of muzzle
     * @param {number}      gameY      — world Y position of muzzle (game coords)
     * @param {object|null} target     — entity with .x,.y (or .pos.x,.pos.y) and .dead
     * @param {number}      damage     — damage on impact
     * @param {object}      weaponDef  — weapon definition (for explodeRadius etc.)
     * @param {string}      colorTheme — 'blue' | 'red'
     */
    fire(gameX, gameY, target, damage, weaponDef, colorTheme = "blue") {
        let r = null;
        for (let i = 0; i < ROCKET.maxRockets; i++) {
            if (!this.rockets[i].active) { r = this.rockets[i]; break; }
        }
        if (!r) return;

        r.active = true;
        // Game coords → overlay: X stays, game-Y → overlay-Z, height=0
        r.position.set(gameX, 0, gameY);

        // Ejection: random horizontal spread + upward burst
        r.velocity.set(
            (Math.random() - 0.5) * ROCKET.ejectSpread * 2,
            ROCKET.ejectUp + Math.random() * ROCKET.ejectUpRandom,
            (Math.random() - 0.5) * ROCKET.ejectSpread * 2
        );

        // Identity quat = nose points +Y (up) → correct for vertical launch
        r.quaternion.identity();
        r.target          = target;
        r.state           = "EJECTED";
        r.guidancePhase   = "launch";
        r.timeSinceLaunch = 0;
        r.launchPos.copy(r.position);
        r.prevTravelPos.copy(r.position);
        r.travelDistance  = 0;
        r.mass            = ROCKET.mass;
        const profile = resolveRocketProfile(weaponDef);
        r.maxThrust       = profile.maxThrust;
        r.currentThrust   = 0;
        r.turnRateRad     = profile.turnRateRad;
        r.homingDelay     = profile.homingDelay;
        r.ignitionDelay   = profile.ignitionDelay;
        r.cruiseAltitude  = profile.cruiseAltitude;
        r.damage          = damage || 60;
        r.blastRadius     = profile.blastRadius;
        r.desiredSpeed    = profile.desiredSpeed;
        r.maxRange        = profile.maxRange;
        r.hitRadius       = profile.hitRadius;
        r.proximityRadius = profile.proximityRadius;
        r.terminalRadius = profile.terminalRadius;
        r.reacquireRadius = profile.reacquireRadius;
        r.reacquireTurnMultiplier = profile.reacquireTurnMultiplier;
        r.reacquireSpeedFactor = profile.reacquireSpeedFactor;
        r.terminalSpeedFactor = profile.terminalSpeedFactor;
        r.leadHorizon = profile.leadHorizon;
        r.terminalLeadHorizon = profile.terminalLeadHorizon;
        r.bodyScale = profile.bodyScale;
        r.exhaustScale = profile.exhaustScale;
        r.fireScale = profile.fireScale;
        r.smokeScale = profile.smokeScale;
        r.explosionVisualScale = profile.explosionVisualScale;
        r.didImpactDamage = false;
        r.weaponDef       = weaponDef;
        r.closestTargetDist = Infinity;
        r.lastTargetDist = Infinity;
        r.missCount = 0;
        r.reacquireUntil = 0;
        r.terminalEnteredAtDist = Infinity;
        r.missGrowTime = 0;
        r.prevExhaustPos.copy(r.position);

        const initialAim = target && !target.dead
            ? (target._isPositionTarget
                ? { x: Number(target.x ?? target.pos?.x) || gameX, y: Number(target.y ?? target.pos?.y) || gameY }
                : solveLeadAim2D(
                    { x: gameX, y: gameY },
                    { x: 0, y: 0 },
                    target,
                    profile.desiredSpeed
                ))
            : null;
        if (initialAim) {
            _targetDir.set(initialAim.x - gameX, profile.cruiseAltitude, initialAim.y - gameY);
            if (_targetDir.lengthSq() > 1e-6) {
                _targetDir.normalize();
                r.quaternion.setFromUnitVectors(_BASE_FWD, _targetDir);
            }
        }

        // Color per-instance
        const col = colorTheme === "red" ? 0xff3333 : 0x3377ff;
        this.mesh.setColorAt(r.index, new THREE.Color(col));
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    /* ─────────────────── UPDATE ─────────────────── */

    update(dt) {
        if (dt <= 0) return;
        dt = Math.min(dt, 0.05);
        this.globalTime += dt;

        // Update GPU particle clocks FIRST (so spawned particles get correct time)
        this.fireGPU.update(this.globalTime);
        this.smokeGPU.update(this.globalTime);

        // Pass zoom and DPR from the main game camera so smoke tracks the
        // real orthographic view instead of the intermediate overlay model.
        const zoom = window.camera?.zoom ?? 1;
        this.smokeGPU.material.uniforms.u_zoom.value = zoom;
        this.smokeGPU.material.uniforms.u_dpr.value = window._overlayDpr ?? (window.devicePixelRatio || 1);

        let matricesUpdated = false;
        const R  = ROCKET;
        const FS = FlameSettings;

        for (let i = 0; i < R.maxRockets; i++) {
            const r = this.rockets[i];
            if (!r.active) continue;
            matricesUpdated = true;
            r.timeSinceLaunch += dt;

            /* ── State transition: EJECTED → POWERED ── */
            if (r.state === "EJECTED") {
                if (r.velocity.y < -5 * WS || r.timeSinceLaunch > r.ignitionDelay) {
                    r.state = "POWERED";
                    r.currentThrust = r.maxThrust;
                }
            }

            let guidanceDesiredSpeed = Math.max(300, r.desiredSpeed || 1200);

            /* ── Guidance phases: launch / intercept / terminal / reacquire ── */
            if (r.target && !r.target.dead) {
                const isPointTarget = !!r.target._isPositionTarget;
                const tx = Number(r.target.x ?? r.target.pos?.x) || r.position.x;
                const ty = Number(r.target.y ?? r.target.pos?.y) || r.position.z;
                const targetRadius = isPointTarget ? 0 : Math.max(
                    Number(r.target.radius) || 0,
                    (Number(r.target.w) || 0) * 0.5,
                    (Number(r.target.h) || 0) * 0.5
                );
                const fuseRadius = Math.max(r.proximityRadius || r.hitRadius || R.hitRadius, targetRadius * 0.9);
                const terminalRadius = Math.max(r.terminalRadius || fuseRadius * 2, fuseRadius * 1.35);
                const reacquireRadius = Math.max(r.reacquireRadius || terminalRadius * 1.4, terminalRadius);

                const directDx = tx - r.position.x;
                const directDz = ty - r.position.z;
                const dist2D = Math.hypot(directDx, directDz);

                if (isPointTarget) {
                    r.guidancePhase = (r.state === "EJECTED") ? "launch" : "intercept";
                } else if (r.guidancePhase === "launch" && r.state === "POWERED") {
                    r.guidancePhase = "intercept";
                }

                if (!isPointTarget) {
                    if (r.guidancePhase !== "reacquire" && dist2D <= terminalRadius) {
                        if (r.guidancePhase !== "terminal") {
                            r.guidancePhase = "terminal";
                            r.terminalEnteredAtDist = dist2D;
                            r.missGrowTime = 0;
                        }
                    } else if (r.guidancePhase === "reacquire" && (dist2D <= terminalRadius * 1.15 || r.timeSinceLaunch >= r.reacquireUntil)) {
                        r.guidancePhase = dist2D <= terminalRadius ? "terminal" : "intercept";
                        if (r.guidancePhase === "terminal") r.terminalEnteredAtDist = dist2D;
                        r.missGrowTime = 0;
                    }

                    if (r.guidancePhase === "terminal" && Number.isFinite(r.lastTargetDist)) {
                        const missThreshold = Math.max(14, fuseRadius * 0.1);
                        const closeEnoughForMiss = r.lastTargetDist <= Math.max(reacquireRadius, fuseRadius * 1.9);
                        if (dist2D > r.lastTargetDist + missThreshold && closeEnoughForMiss && dist2D > fuseRadius * 1.08) {
                            r.missGrowTime += dt;
                            if (r.missGrowTime >= 0.06) {
                                r.guidancePhase = "reacquire";
                                r.missCount += 1;
                                r.reacquireUntil = r.timeSinceLaunch + THREE.MathUtils.clamp(0.24 + r.missCount * 0.08, 0.24, 0.9);
                                r.missGrowTime = 0;
                            }
                        } else {
                            r.missGrowTime = Math.max(0, r.missGrowTime - dt * 2.5);
                        }
                    }
                }

                const planarSpeed = Math.max(300, Math.hypot(r.velocity.x, r.velocity.z), guidanceDesiredSpeed);
                const leadPoint = isPointTarget
                    ? { x: tx, y: ty }
                    : solveLeadAim2D(
                        { x: r.position.x, y: r.position.z },
                        { x: r.velocity.x, y: r.velocity.z },
                        r.target,
                        planarSpeed
                    );

                let leadWeight = 0;
                let targetY = 0;
                let effectiveTurnRate = Math.max(0.001, r.turnRateRad);
                if (r.guidancePhase === "launch") {
                    leadWeight = isPointTarget ? 0 : 0.15;
                    targetY = r.cruiseAltitude * 0.65;
                } else if (r.guidancePhase === "intercept") {
                    leadWeight = isPointTarget ? 0 : r.leadHorizon;
                    targetY = dist2D > terminalRadius ? r.cruiseAltitude : 0;
                } else if (r.guidancePhase === "terminal") {
                    leadWeight = isPointTarget ? 0 : r.terminalLeadHorizon;
                    targetY = 0;
                    guidanceDesiredSpeed *= r.terminalSpeedFactor;
                    effectiveTurnRate *= 1.25;
                } else if (r.guidancePhase === "reacquire") {
                    leadWeight = isPointTarget ? 0 : Math.min(0.18, r.terminalLeadHorizon);
                    targetY = 0;
                    guidanceDesiredSpeed *= r.reacquireSpeedFactor;
                    effectiveTurnRate *= r.reacquireTurnMultiplier;
                }

                const aimX = THREE.MathUtils.lerp(tx, leadPoint.x, leadWeight);
                const aimZ = THREE.MathUtils.lerp(ty, leadPoint.y, leadWeight);
                const dx = aimX - r.position.x;
                const dz = aimZ - r.position.z;

                _targetDir.set(
                    dx,
                    THREE.MathUtils.clamp(targetY - r.position.y, -Math.max(60, r.cruiseAltitude), Math.max(120, r.cruiseAltitude)),
                    dz
                );

                if (_targetDir.lengthSq() > 1e-6) {
                    _targetDir.normalize();
                    _qTarget.setFromUnitVectors(_BASE_FWD, _targetDir);
                    _forward.set(0, 1, 0).applyQuaternion(r.quaternion).normalize();

                    const planarForwardLen = Math.hypot(_forward.x, _forward.z);
                    let angleError = 0;
                    if (planarForwardLen > 1e-6) {
                        const fx = _forward.x / planarForwardLen;
                        const fz = _forward.z / planarForwardLen;
                        const aimLen = Math.hypot(dx, dz);
                        if (aimLen > 1e-6) {
                            const ax = dx / aimLen;
                            const az = dz / aimLen;
                            angleError = Math.acos(THREE.MathUtils.clamp(fx * ax + fz * az, -1, 1));
                        }
                    }

                    if (r.guidancePhase === "reacquire" || r.guidancePhase === "terminal") {
                        const anglePenalty = THREE.MathUtils.clamp(angleError / Math.PI, 0, 1);
                        guidanceDesiredSpeed *= THREE.MathUtils.lerp(1.0, 0.45, anglePenalty);
                    }

                    if (r.timeSinceLaunch >= r.homingDelay || r.guidancePhase === "reacquire" || r.guidancePhase === "terminal") {
                        r.quaternion.rotateTowards(_qTarget, effectiveTurnRate * dt);
                    } else {
                        r.quaternion.slerp(_qTarget, THREE.MathUtils.clamp(dt * 6, 0, 0.18));
                    }
                }

                r.lastTargetDist = dist2D;
            }

            /* ── Physics ── */
            const weight = r.mass * PHYSICS.gravity;
            _force.set(0, -weight, 0);

            _forward.set(0, 1, 0).applyQuaternion(r.quaternion).normalize();
            if (r.currentThrust > 0) {
                _force.addScaledVector(_forward, r.currentThrust);
            }

            const speedSq = r.velocity.lengthSq();
            if (speedSq > 1) {
                _drag.copy(r.velocity).normalize().negate();
                _force.addScaledVector(_drag, speedSq * PHYSICS.airDrag);
            }

            r.velocity.addScaledVector(
                _force.divideScalar(r.mass), dt
            );
            r.position.addScaledVector(r.velocity, dt);
            r.travelDistance += Math.hypot(
                r.position.x - r.prevTravelPos.x,
                r.position.z - r.prevTravelPos.z
            );
            r.prevTravelPos.copy(r.position);

            if (r.position.y > R.maxAltitude) {
                r.position.y = R.maxAltitude;
                if (r.velocity.y > 0) r.velocity.y *= 0.2;
            }

            if (r.state === "POWERED") {
                const speed = r.velocity.length();
                const desiredSpeed = Math.max(220, guidanceDesiredSpeed);
                const throttleNorm = THREE.MathUtils.clamp(((desiredSpeed - speed) / desiredSpeed) * 1.4 + 0.25, 0.12, 1.0);
                r.currentThrust = r.maxThrust * throttleNorm;
            }

            /* ── Instance matrix ── */
            _renderDir.copy(_forward);
            if (_renderDir.lengthSq() < 1e-6) {
                _renderDir.copy(r.visualDir);
            } else {
                _renderDir.normalize();
                r.visualDir.copy(_renderDir);
            }
            _renderQuat.setFromUnitVectors(_VISUAL_FWD, _renderDir);

            _dummy.position.copy(r.position);
            _dummy.quaternion.copy(_renderQuat);
            _dummy.scale.setScalar(r.bodyScale || 1);
            _dummy.updateMatrix();
            this.mesh.setMatrixAt(r.index, _dummy.matrix);

            /* ── Exhaust position (behind rocket: local -Z for top-down visual) ── */
            _exhaustP.set(0, 0, -R.exhaustOffset * (r.exhaustScale || 1)).applyMatrix4(_dummy.matrix);

            /* ── Spawn FIRE particles ── */
            if (r.currentThrust > 0) {
                const dist = _exhaustP.distanceTo(r.prevExhaustPos);
                const steps = Math.min(15, Math.ceil(dist / Math.max(R.exhaustGap, 0.3)));
                const exhaustScale = Math.max(0.35, r.exhaustScale || 1);

                for (let s = 0; s < steps; s++) {
                    const jt = (s + Math.random() * 0.4 - 0.2) / steps;
                    const t  = Math.max(0, Math.min(1, jt));
                    const sx = r.prevExhaustPos.x + (_exhaustP.x - r.prevExhaustPos.x) * t;
                    const sy = r.prevExhaustPos.y + (_exhaustP.y - r.prevExhaustPos.y) * t;
                    const sz = r.prevExhaustPos.z + (_exhaustP.z - r.prevExhaustPos.z) * t;

                    const vx = -_renderDir.x * R.exhaustVel * exhaustScale * FS.velMult + (Math.random() - 0.5) * R.exhaustSpread * exhaustScale;
                    const vy = (-12 * WS) + (Math.random() - 0.5) * R.exhaustSpread * exhaustScale * 0.18;
                    const vz = -_renderDir.z * R.exhaustVel * exhaustScale * FS.velMult + (Math.random() - 0.5) * R.exhaustSpread * exhaustScale;

                    this.fireGPU.spawn(sx, sy, sz, vx, vy, vz,
                        Math.max(0.1, r.fireScale || 1),
                        Math.max(0.08, (FS.life + Math.random() * 0.05) * THREE.MathUtils.lerp(0.78, 1.0, Math.min(1, r.fireScale || 1))),
                        0);                                     // type = FIRE

                    if ((s & 1) === 0) {
                        this.smokeGPU.spawn(
                            sx, sy, sz,
                            -_renderDir.x * R.exhaustVel * 0.18 * exhaustScale + (Math.random() - 0.5) * R.exhaustSpread * 1.4 * exhaustScale,
                            4 + Math.random() * 10,
                            -_renderDir.z * R.exhaustVel * 0.18 * exhaustScale + (Math.random() - 0.5) * R.exhaustSpread * 1.4 * exhaustScale,
                            Math.max(0.15, r.smokeScale || 1),
                            Math.max(0.5, (1.6 + Math.random() * 1.4) * THREE.MathUtils.lerp(0.72, 1.0, Math.min(1, r.smokeScale || 1))),
                            1
                        );
                    }
                }
            } else if (r.state === "EJECTED" && Math.random() > 0.5) {
                // Cold-launch smoke puff (downward)
                this.smokeGPU.spawn(
                    _exhaustP.x, _exhaustP.y, _exhaustP.z,
                    0, -20 * WS, 0,
                    Math.max(0.15, r.smokeScale || 1), Math.max(0.18, 0.3 * Math.max(0.6, r.smokeScale || 1)), 1
                );
            }

            r.prevExhaustPos.copy(_exhaustP);

            const traveled = r.travelDistance;

            /* ── Hit detection ── */
            if (r.target && !r.target.dead) {
                const tx = Number(r.target.x ?? r.target.pos?.x) || 0;
                const ty = Number(r.target.y ?? r.target.pos?.y) || 0;
                const dx = tx - r.position.x;
                const dz = ty - r.position.z;
                const dist2D = Math.sqrt(dx * dx + dz * dz);
                const isPointTarget = !!r.target._isPositionTarget;
                const targetRadius = isPointTarget ? 0 : Math.max(
                    Number(r.target.radius) || 0,
                    (Number(r.target.w) || 0) * 0.5,
                    (Number(r.target.h) || 0) * 0.5
                );
                const fuseRadius = Math.max((r.hitRadius || R.hitRadius), targetRadius * 0.9);
                const minArmTime = isPointTarget ? 0.7 : 0.18;
                const minArmDistance = isPointTarget
                    ? Math.max(320, fuseRadius * 4.0)
                    : Math.max(90, fuseRadius * 1.1);
                const isArmed = (r.timeSinceLaunch >= minArmTime) && (traveled >= minArmDistance);
                const shouldDetonate = isArmed && dist2D <= fuseRadius;
                if (shouldDetonate) {
                    this._onHit(r);
                    this._explode(r);
                    continue;
                }
            }

            /* ── Ground / range expiry ── */
            if (r.position.y <= 0 && r.velocity.y < 0 && r.timeSinceLaunch > 0.5) {
                // Ground contact should not kill the rocket early; range or target hit is the source of truth.
                r.position.y = 0.5;
                r.velocity.y = Math.abs(r.velocity.y) * 0.25;
            }

            if (traveled >= (r.maxRange || 0)) {
                this._explode(r);
            }
        }

        if (matricesUpdated) this.mesh.instanceMatrix.needsUpdate = true;
    }

    /* ─────────────────── DAMAGE ─────────────────── */

    _onHit(r) {
        const target = r.target;
        if (!target || target.dead) return;
        if (target._isPositionTarget) return;

        const dmg = r.damage || 60;
        const applyNpc    = window.applyDamageToNPC;
        const applyPlayer = window.applyDamageToPlayer;

        // Determine if target is the player
        const isPlayer = (target === window.ship) || !!target._isPlayerShip || (target === window.Game?.player);
        if (isPlayer) {
            if (applyPlayer) applyPlayer(dmg);
        } else {
            if (applyNpc) applyNpc(target, dmg, "rocket");
        }
        r.didImpactDamage = true;
    }

    _applyBlastDamage(r, ex, ez) {
        const blastRadius = Math.max(0, Number(r.blastRadius) || 0);
        if (blastRadius <= 0) return;
        const damageBase = Math.max(0, Number(r.damage) || 0);
        if (damageBase <= 0) return;

        const applyNpc = window.applyDamageToNPC;
        const applyPlayer = window.applyDamageToPlayer;
        const player = window.ship;
        const getEntityRadius = (entity) => Math.max(
            Number(entity?.radius) || 0,
            (Number(entity?.w) || 0) * 0.5,
            (Number(entity?.h) || 0) * 0.5
        );

        if (player && !player.destroyed && (!r.didImpactDamage || r.target !== player)) {
            const dx = (player.pos?.x ?? player.x ?? 0) - ex;
            const dz = (player.pos?.y ?? player.y ?? 0) - ez;
            const dist = Math.hypot(dx, dz);
            const effectiveRadius = blastRadius + getEntityRadius(player) * 0.65;
            if (dist <= effectiveRadius && applyPlayer) {
                const falloff = THREE.MathUtils.clamp(1 - (dist / Math.max(1, effectiveRadius)), 0, 1);
                const dmg = damageBase * (0.3 + falloff * 0.7);
                if (dmg > 1) applyPlayer(dmg);
            }
        }

        const npcs = Array.isArray(window.npcs) ? window.npcs : [];
        for (let i = 0; i < npcs.length; i++) {
            const npc = npcs[i];
            if (!npc || npc.dead) continue;
            if (r.didImpactDamage && npc === r.target) continue;
            const dx = (npc.x ?? npc.pos?.x ?? 0) - ex;
            const dz = (npc.y ?? npc.pos?.y ?? 0) - ez;
            const dist = Math.hypot(dx, dz);
            const effectiveRadius = blastRadius + getEntityRadius(npc) * 0.65;
            if (dist > effectiveRadius) continue;
            const falloff = THREE.MathUtils.clamp(1 - (dist / Math.max(1, effectiveRadius)), 0, 1);
            const dmg = damageBase * (0.35 + falloff * 0.65);
            if (dmg > 1 && applyNpc) applyNpc(npc, dmg, "rocket");
        }
    }

    /* ─────────────────── EXPLOSION ─────────────────── */

    _explode(r) {
        r.active = false;
        _dummy.position.set(0, -999999, 0);
        _dummy.updateMatrix();
        this.mesh.setMatrixAt(r.index, _dummy.matrix);

        const ex = r.position.x;
        const ey = Math.max(r.position.y, 0);
        const ez = r.position.z;
        const eS = WS * Math.max(0.1, Number(FlameSettings.explosionSize) || 1.0) * Math.max(0.25, r.explosionVisualScale || 1);
        this._applyBlastDamage(r, ex, ez);

        // 1. FLASH — one big, short burst
        this.fireGPU.spawn(ex, ey, ez, 0, 0, 0,  250 * eS,  0.1,  3);

        // 2. CORE EXPLOSION — many fire particles
        for (let j = 0; j < 80; j++) {
            const spd   = (500 + Math.random() * 3500) * eS;
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const vx = spd * Math.sin(phi) * Math.cos(theta);
            const vy = spd * Math.cos(phi);
            const vz = spd * Math.sin(phi) * Math.sin(theta);

            this.fireGPU.spawn(ex, ey, ez, vx, vy, vz,
                (30 + Math.random() * 40) * eS,
                0.2 + Math.random() * 0.4,  3);
        }

        // 3. SPARKS — fast, stretched shrapnel
        for (let j = 0; j < 60; j++) {
            const spd   = (2000 + Math.random() * 5000) * eS;
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const vx = spd * Math.sin(phi) * Math.cos(theta);
            const vy = spd * Math.cos(phi);
            const vz = spd * Math.sin(phi) * Math.sin(theta);

            this.fireGPU.spawn(ex, ey, ez, vx, vy, vz,
                (5 + Math.random() * 10) * eS,
                0.3 + Math.random() * 0.3,  4);
        }

        // 4. SMOKE — warm haze rising upward
        for (let j = 0; j < 50; j++) {
            const spd   = (100 + Math.random() * 1500) * eS;
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const vx = spd * Math.sin(phi) * Math.cos(theta);
            const vy = spd * Math.cos(phi) + 50 * eS;   // extra lift
            const vz = spd * Math.sin(phi) * Math.sin(theta);

            this.smokeGPU.spawn(ex, ey, ez, vx, vy, vz,
                (100 * eS + Math.random() * 200 * eS),
                1.5 + Math.random() * 1.5,  1);
        }

        // 5. SHOCKWAVE — expanding flat ring in XZ plane
        this.fireGPU.spawn(ex, ey + 1, ez,  0, 0, 0,
            0,                                // size (shader computes)
            0.5 + Math.random() * 0.2,       // life
            5);                               // type = SHOCKWAVE

    }

    /* ─────────────────── DISPOSE ─────────────────── */

    dispose() {
        this.fireGPU.dispose();
        this.smokeGPU.dispose();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        instance = null;
        if (window.rocketSystem3D === this) window.rocketSystem3D = null;
    }
}

/* ═══════════════════════════════════════════════════
   PUBLIC API  (module exports + window globals)
   ═══════════════════════════════════════════════════ */

export function initRocketSystem3D(overlayScene) {
    if (instance) instance.dispose();
    instance = new RocketSystem3D(overlayScene);
    window.rocketSystem3D = instance;
    return instance;
}

export function updateRocketSystem3D(dt) {
    if (instance) instance.update(dt);
}

/**
 * @param {number}  gameX     — muzzle world X
 * @param {number}  gameY     — muzzle world Y (game coords)
 * @param {object}  target    — entity to guide toward
 * @param {number}  damage    — damage on hit
 * @param {object}  weaponDef — weapon definition
 * @param {string}  color     — 'blue' | 'red'
 */
export function fireRocket3D(gameX, gameY, target, damage, weaponDef, color) {
    if (instance) instance.fire(gameX, gameY, target, damage, weaponDef, color);
}
