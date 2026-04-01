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
                turnSpeed:      0,
                damage:         0,
                blastRadius:    0,
                desiredSpeed:   0,
                maxLife:        0,
                hitRadius:      0,
                didImpactDamage:false,
                weaponDef:      null,
                launchPos:      new THREE.Vector3(),
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
        r.timeSinceLaunch = 0;
        r.launchPos.copy(r.position);
        r.mass            = ROCKET.mass;
        const weaponSpeed = Math.max(400, Number(weaponDef?.baseSpeed) || Number(weaponDef?.speed) || 1200);
        const weaponRange = Math.max(1500, Number(weaponDef?.baseRange) || Number(weaponDef?.range) || 6000);
        const weaponBlast = Math.max(24, Number(weaponDef?.explodeRadius) || Number(weaponDef?.explosionRadius) || 48);
        const speedScale = Math.max(0.9, weaponSpeed / 900);
        r.maxThrust       = ROCKET.maxThrust * speedScale;
        r.currentThrust   = 0;
        r.turnSpeed       = (ROCKET.turnSpeedMin + Math.random() * (ROCKET.turnSpeedMax - ROCKET.turnSpeedMin)) * THREE.MathUtils.clamp((Number(weaponDef?.turnRate) || 300) / 300, 0.8, 1.8);
        r.damage          = damage || 60;
        r.blastRadius     = weaponBlast;
        r.desiredSpeed    = weaponSpeed;
        r.maxLife         = THREE.MathUtils.clamp((weaponRange / Math.max(weaponSpeed, 1)) * 2.5, 8.0, 40);
        r.hitRadius       = THREE.MathUtils.clamp(weaponBlast * 0.9, 50, 180);
        r.didImpactDamage = false;
        r.weaponDef       = weaponDef;
        r.prevExhaustPos.copy(r.position);

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
                if (r.velocity.y < -5 * WS || r.timeSinceLaunch > 1.0) {
                    r.state = "POWERED";
                    r.currentThrust = r.maxThrust;
                }
            }

            /* ── Guidance (slerp toward target) before thrust integration ── */
            if (r.state === "POWERED" && r.target && !r.target.dead) {
                const tx = Number(r.target.x ?? r.target.pos?.x) || 0;
                const ty = Number(r.target.y ?? r.target.pos?.y) || 0;
                const isPointTarget = !!r.target._isPositionTarget;
                const altitudeBias = isPointTarget
                    ? Math.max(r.position.y * 1.2, 10 * WS)
                    : Math.max(r.position.y * 0.8, 5 * WS);
                _targetDir.set(
                    tx - r.position.x,
                    -altitudeBias,
                    ty - r.position.z
                );
                const len = _targetDir.length();
                if (len > 0.1) {
                    _targetDir.divideScalar(len);
                    _qTarget.setFromUnitVectors(_BASE_FWD, _targetDir);
                    const steerRate = isPointTarget ? r.turnSpeed * 1.45 : r.turnSpeed;
                    r.quaternion.slerp(_qTarget, steerRate * dt);
                }
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

            if (r.position.y > R.maxAltitude) {
                r.position.y = R.maxAltitude;
                if (r.velocity.y > 0) r.velocity.y *= 0.2;
            }

            if (r.state === "POWERED") {
                const speed = r.velocity.length();
                const desiredSpeed = Math.max(300, r.desiredSpeed || 1200);
                const throttleNorm = THREE.MathUtils.clamp(((desiredSpeed - speed) / desiredSpeed) * 1.4 + 0.25, 0.12, 1.0);
                r.currentThrust = r.maxThrust * throttleNorm;
            }

            /* ── Instance matrix ── */
            _renderDir.set(r.velocity.x, 0, r.velocity.z);
            if (_renderDir.lengthSq() < 1e-6) {
                _renderDir.copy(r.visualDir);
            } else {
                _renderDir.normalize();
                r.visualDir.copy(_renderDir);
            }
            _renderQuat.setFromUnitVectors(_VISUAL_FWD, _renderDir);

            _dummy.position.copy(r.position);
            _dummy.quaternion.copy(_renderQuat);
            _dummy.updateMatrix();
            this.mesh.setMatrixAt(r.index, _dummy.matrix);

            /* ── Exhaust position (behind rocket: local -Z for top-down visual) ── */
            _exhaustP.set(0, 0, -R.exhaustOffset).applyMatrix4(_dummy.matrix);

            /* ── Spawn FIRE particles ── */
            if (r.currentThrust > 0) {
                const dist = _exhaustP.distanceTo(r.prevExhaustPos);
                const steps = Math.min(15, Math.ceil(dist / Math.max(R.exhaustGap, 0.3)));

                for (let s = 0; s < steps; s++) {
                    const jt = (s + Math.random() * 0.4 - 0.2) / steps;
                    const t  = Math.max(0, Math.min(1, jt));
                    const sx = r.prevExhaustPos.x + (_exhaustP.x - r.prevExhaustPos.x) * t;
                    const sy = r.prevExhaustPos.y + (_exhaustP.y - r.prevExhaustPos.y) * t;
                    const sz = r.prevExhaustPos.z + (_exhaustP.z - r.prevExhaustPos.z) * t;

                    const vx = -_renderDir.x * R.exhaustVel * FS.velMult + (Math.random() - 0.5) * R.exhaustSpread;
                    const vy = (-12 * WS) + (Math.random() - 0.5) * R.exhaustSpread * 0.18;
                    const vz = -_renderDir.z * R.exhaustVel * FS.velMult + (Math.random() - 0.5) * R.exhaustSpread;

                    this.fireGPU.spawn(sx, sy, sz, vx, vy, vz,
                        0,                                      // size (computed by shader for type 0)
                        FS.life + Math.random() * 0.05,         // life
                        0);                                     // type = FIRE

                    if ((s & 1) === 0) {
                        this.smokeGPU.spawn(
                            sx, sy, sz,
                            -_renderDir.x * R.exhaustVel * 0.18 + (Math.random() - 0.5) * R.exhaustSpread * 1.4,
                            4 + Math.random() * 10,
                            -_renderDir.z * R.exhaustVel * 0.18 + (Math.random() - 0.5) * R.exhaustSpread * 1.4,
                            0, 1.6 + Math.random() * 1.4, 1
                        );
                    }
                }
            } else if (r.state === "EJECTED" && Math.random() > 0.5) {
                // Cold-launch smoke puff (downward)
                this.smokeGPU.spawn(
                    _exhaustP.x, _exhaustP.y, _exhaustP.z,
                    0, -20 * WS, 0,
                    0, 0.3, 1
                );
            }

            r.prevExhaustPos.copy(_exhaustP);

            /* ── Hit detection ── */
            if (r.target && !r.target.dead) {
                const tx = Number(r.target.x ?? r.target.pos?.x) || 0;
                const ty = Number(r.target.y ?? r.target.pos?.y) || 0;
                const dx = tx - r.position.x;
                const dz = ty - r.position.z;
                const dist2D = Math.sqrt(dx * dx + dz * dz);
                const isPointTarget = !!r.target._isPositionTarget;
                const traveled2D = Math.hypot(
                    r.position.x - r.launchPos.x,
                    r.position.z - r.launchPos.z
                );
                const minArmTime = isPointTarget ? 0.7 : 0.18;
                const minArmDistance = isPointTarget
                    ? Math.max(320, (r.hitRadius || R.hitRadius) * 4.0)
                    : Math.max(90, (r.hitRadius || R.hitRadius) * 1.25);
                const isArmed = (r.timeSinceLaunch >= minArmTime) && (traveled2D >= minArmDistance);
                // Must be close horizontally AND low enough (descended toward target)
                if (isArmed && dist2D < (r.hitRadius || R.hitRadius) && r.position.y < (r.hitRadius || R.hitRadius) * 2.2) {
                    this._onHit(r);
                    this._explode(r);
                    continue;
                }
            }

            /* ── Ground / timeout ── */
            const traveled = Math.hypot(
                r.position.x - r.launchPos.x,
                r.position.z - r.launchPos.z
            );
            if (r.position.y <= 0 && r.velocity.y < 0 && r.timeSinceLaunch > 0.5) {
                // Don't explode on ground until rocket traveled meaningful distance
                // or is close to the target — otherwise clamp above ground and keep flying
                const minGroundTravel = Math.max(200, (r.hitRadius || R.hitRadius) * 3);
                if (traveled > minGroundTravel || r.timeSinceLaunch > 3.0) {
                    this._explode(r);
                } else {
                    r.position.y = 0.5;
                    r.velocity.y = Math.abs(r.velocity.y) * 0.3;
                }
            } else if (r.timeSinceLaunch > (r.maxLife || 20)) {
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

        if (player && !player.destroyed && (!r.didImpactDamage || r.target !== player)) {
            const dx = (player.pos?.x ?? player.x ?? 0) - ex;
            const dz = (player.pos?.y ?? player.y ?? 0) - ez;
            const dist = Math.hypot(dx, dz);
            if (dist <= blastRadius && applyPlayer) {
                const falloff = THREE.MathUtils.clamp(1 - (dist / blastRadius), 0, 1);
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
            if (dist > blastRadius) continue;
            const falloff = THREE.MathUtils.clamp(1 - (dist / blastRadius), 0, 1);
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
        const eS = WS * Math.max(0.1, Number(FlameSettings.explosionSize) || 1.0);
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
