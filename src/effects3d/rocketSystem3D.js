/**
 * 3D Rocket System — LOT rakiet (fizyka, naprowadzanie, zapalnik, obrażenia).
 * Ported from rakiety.html RocketManager + integration layer.
 *
 * Wygląd (port WebGPU, zadanie 19): efekty z dema `dema/rakiety-webgpu` w scenie Core3D —
 * src/3d/rockets/ (dym GPU z samocieniem, płomienie z dyskami Macha, kadłubki, kule ognia,
 * iskry, łuki, Supernowa z pozostałością). Ten moduł zgłasza reżyserowi efektów zdarzenia
 * (`effects`: onLaunch / onIgnite / onFly / prepareContact / onDetonate / update); dawne
 * cząstki RocketFireGPU / RocketSmokeGPU, siatka kadłubków w scenie overlaya, gorące
 * powietrze wybuchów i wybuch Supernowej z overlaya odeszły. Lot, naprowadzanie, trafienia
 * i obrażenia bez zmian (tests/rocketGuidance.test.mjs); bez `effects` (testy w Node)
 * rakiety latają bez obrazu.
 *
 * Coordinate convention (lot, Y-up jak dawny overlay):
 *   game world (x, y) → (x, 0, y)
 *   height above ground → Y
 *
 * Usage in index.html:
 *   import { initRocketSystem3D } ...
 *   initRocketSystem3D(Core3D.scene, { effects: createRocketFx(Core3D) })
 *   // every frame (przed render()): window.rocketSystem3D.update(dt)
 *   // on fire:     window.rocketSystem3D.fire(gameX, gameY, target, damage, weaponDef, 'blue', vx, vy)
 */
import * as THREE from "three";
import { isEntityShieldBlocking } from "../../shieldSystem.js";
import { shieldImpactClass } from "../data/weapons.js";
import { SimClock } from "../game/simClock.js";

/*
 * UKŁAD RAKIETY (src/game/carrierVelocity.js). Rakieta startuje z prędkością
 * wyrzutni (`frameVel`, płaszczyzna x/z overlaya) i zachowuje ją — to jej pęd,
 * w próżni nic go nie odbierze, więc salwa z pędzącego okrętu nie zostaje w tyle.
 * Model lotu (kinematyczny: prędkość idzie za nosem, szybkość goni desiredSpeed)
 * działa na ruch WŁASNY w tym układzie: z pokładu wyrzutni rakieta leci tak samo
 * jak z postoju, a przy wyrzutni w spoczynku (frameVel = 0) wszystko jest jak
 * przed zmianą. Układu świadomie NIE dopasowujemy do ruchu celu — rakieta
 * zyskałaby prędkość celu nawet strzelana z postoju. Prowadzenie liczy ruch celu
 * względem układu, a znany dryf układu kompensuje w całości; zasięg = droga własna.
 * Dym z dyszy dziedziczy układ (nośnik cząstki w src/3d/rockets/smoke.js).
 */

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
const _force     = new THREE.Vector3();
const _forward   = new THREE.Vector3();
const _drag      = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _qTarget   = new THREE.Quaternion();
const _BASE_FWD  = new THREE.Vector3(0, 1, 0);  // rocket nose in local space
const _renderDir = new THREE.Vector3();
const _leadAim2D = { x: 0, y: 0, t: 0 };
// Scratch prowadzenia (bez obiektów per rakieta per klatka).
const _leadPos = { x: 0, y: 0 };
const _leadVel = { x: 0, y: 0 };
const _leadFrame = { x: 0, y: 0 };
const _targetVel = { x: 0, y: 0 };

function readTargetVelocity2D(target, out) {
    const vel = target?.vel || target?.velocity || null;
    out.x = Number(target?.vx ?? vel?.x) || 0;
    out.y = Number(target?.vy ?? vel?.y) || 0;
    return out;
}

// `frameVel` — układ, w którym leci pocisk: zwracany punkt = cel przesunięty
// o ruch WZGLĘDEM układu (kierunek nosa w tym układzie). Bez niego = świat.
function solveLeadAim2D(shooterPos, shooterVel, target, projectileSpeed, out = _leadAim2D, frameVel = null) {
    const tx = Number(target?.x ?? target?.pos?.x) || 0;
    const ty = Number(target?.y ?? target?.pos?.y) || 0;
    const tv = readTargetVelocity2D(target, _targetVel);
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
    const fx = frameVel ? (Number(frameVel.x) || 0) : 0;
    const fy = frameVel ? (Number(frameVel.y) || 0) : 0;
    out.x = tx + (tv.x - fx) * t;
    out.y = ty + (tv.y - fy) * t;
    out.t = t;
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
    const fireVfx = String(weaponDef?.rocketFireVfx || '').toLowerCase();
    const smokeVfx = String(weaponDef?.rocketSmokeVfx || '').toLowerCase();
    const explosionVfx = String(weaponDef?.rocketExplosionVfx || '').toLowerCase();
    let bodyColorHex = null;
    if (weaponDef?.rocketBodyColor) {
        try {
            bodyColorHex = new THREE.Color(weaponDef.rocketBodyColor).getHex();
        } catch {
            bodyColorHex = null;
        }
    }
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
        hitRadius: proximityRadius,
        bodyColorHex,
        fireVfxType: fireVfx === 'supernova' ? 10 : 0,
        smokeVfxType: smokeVfx === 'chemical' ? 2 : 1,
        explosionCoreType: explosionVfx === 'supernova' ? 13 : 3,
        explosionSparkType: explosionVfx === 'supernova' ? 14 : 4,
        shockwaveType: explosionVfx === 'supernova' ? 15 : 5,
        anamorphicType: explosionVfx === 'supernova' ? 16 : 0,
        fractalRingType: explosionVfx === 'supernova' ? 17 : 0,
        explosionStyle: explosionVfx === 'supernova' ? 'supernova' : 'default'
    };
}

/* ── Singleton ── */
let instance = null;

/* ═══════════════════════════════════════════════════
   CLASS
   ═══════════════════════════════════════════════════ */

class RocketSystem3D {
    /**
     * @param {object|null} scene scena (zgodność API — lot jej nie potrzebuje; obraz rysuje
     *   reżyser efektów w scenie Core3D)
     * @param {object} [opts]
     * @param {object|null} [opts.effects] reżyser efektów (src/3d/rockets/effects.js —
     *   `createRocketFx(Core3D).director`); null = lot bez obrazu (testy w Node)
     */
    constructor(scene, opts = {}) {
        this.scene      = scene;
        this.globalTime = 0;
        this.activeRockets = 0;
        this.effects    = opts?.effects || null;

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
                bodyColorHex: null,
                fireVfxType: 0,
                smokeVfxType: 1,
                explosionCoreType: 3,
                explosionSparkType: 4,
                shockwaveType: 5,
                anamorphicType: 0,
                fractalRingType: 0,
                explosionStyle: "default",
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
                visualDir:      new THREE.Vector3(0, 0, 1),
                // Układ rakiety (x, z overlaya) i czas pozy wyrzutni — patrz nagłówek.
                frameVel:       new THREE.Vector3(),
                bornSim:        0,
                frameSynced:    false
            });
        }
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
     * @param {number}      launchVx, launchVy — prędkość wyrzutni (świat gry):
     *                      rakieta startuje w jej układzie (patrz nagłówek)
     */
    fire(gameX, gameY, target, damage, weaponDef, colorTheme = "blue", launchVx = 0, launchVy = 0) {
        let r = null;
        for (let i = 0; i < ROCKET.maxRockets; i++) {
            if (!this.rockets[i].active) { r = this.rockets[i]; break; }
        }
        if (!r) return;

        r.active = true;
        this.activeRockets++;
        // Game coords → overlay: X stays, game-Y → overlay-Z, height=0
        r.position.set(gameX, 0, gameY);
        r.frameVel.set(Number(launchVx) || 0, 0, Number(launchVy) || 0);
        // Poza wyrzutni pochodzi z kroku fizyki — pierwszy update dosuwa układ
        // do czasu klatki (SimClock), jak interpolowany kadłub gracza.
        r.bornSim = SimClock.sim;
        r.frameSynced = false;

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
        r.bodyColorHex = profile.bodyColorHex;
        r.fireVfxType = profile.fireVfxType;
        r.smokeVfxType = profile.smokeVfxType;
        r.explosionCoreType = profile.explosionCoreType;
        r.explosionSparkType = profile.explosionSparkType;
        r.shockwaveType = profile.shockwaveType;
        r.anamorphicType = profile.anamorphicType;
        r.fractalRingType = profile.fractalRingType;
        r.explosionStyle = profile.explosionStyle;
        r.didImpactDamage = false;
        r.hitShield       = false;
        r.weaponDef       = weaponDef;
        r.closestTargetDist = Infinity;
        r.lastTargetDist = Infinity;
        r.missCount = 0;
        r.reacquireUntil = 0;
        r.terminalEnteredAtDist = Infinity;
        r.missGrowTime = 0;
        r.prevExhaustPos.copy(r.position);

        // Nos w stronę celu przesuniętego o ruch względem układu wyrzutni.
        _leadFrame.x = r.frameVel.x;
        _leadFrame.y = r.frameVel.z;
        const initialAim = target && !target.dead
            ? (target._isPositionTarget
                ? { x: Number(target.x ?? target.pos?.x) || gameX, y: Number(target.y ?? target.pos?.y) || gameY }
                : solveLeadAim2D(
                    { x: gameX, y: gameY },
                    _leadFrame,
                    target,
                    profile.desiredSpeed,
                    _leadAim2D,
                    _leadFrame
                ))
            : null;
        if (initialAim) {
            _targetDir.set(initialAim.x - gameX, profile.cruiseAltitude, initialAim.y - gameY);
            if (_targetDir.lengthSq() > 1e-6) {
                _targetDir.normalize();
                r.quaternion.setFromUnitVectors(_BASE_FWD, _targetDir);
            }
        }

        // Wygląd: wyrzut (obłok pary, błysk) — barwa pasa kadłubka ze strony (colorTheme).
        if (this.effects) this.effects.onLaunch(r, colorTheme);
    }

    /* ─────────────────── UPDATE ─────────────────── */

    update(dt) {
        if (dt <= 0) return;
        dt = Math.min(dt, 0.05);
        this.globalTime += dt;
        const fx = this.effects;
        const R  = ROCKET;

        // Pusta pula → nie iteruj 2000 slotów.
        for (let i = 0; this.activeRockets > 0 && i < R.maxRockets; i++) {
            const r = this.rockets[i];
            if (!r.active) continue;
            r.timeSinceLaunch += dt;

            /* ── State transition: EJECTED → POWERED ── */
            if (r.state === "EJECTED") {
                if (r.velocity.y < -5 * WS || r.timeSinceLaunch > r.ignitionDelay) {
                    r.state = "POWERED";
                    r.currentThrust = r.maxThrust;
                    if (fx) fx.onIgnite(r);
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
                // Prowadzenie w układzie rakiety: prędkość całkowita = własna + układ,
                // punkt = cel przesunięty o ruch WZGLĘDEM układu (u = v_celu − układ).
                // Punkt w świecie też ma ruch względny (−układ), więc liczymy go zawsze.
                _leadPos.x = r.position.x;
                _leadPos.y = r.position.z;
                _leadVel.x = r.velocity.x + r.frameVel.x;
                _leadVel.y = r.velocity.z + r.frameVel.z;
                _leadFrame.x = r.frameVel.x;
                _leadFrame.y = r.frameVel.z;
                // Dostrojona formuła (prędkość własna w ruchu względnym — z nią
                // zestrojone leadHorizon) — przy wyrzutni w spoczynku jak dawniej.
                const tunedLead = solveLeadAim2D(_leadPos, _leadVel, r.target, planarSpeed, _leadAim2D, _leadFrame);
                const tunedX = tunedLead.x;
                const tunedY = tunedLead.y;
                // Udział dryfu układu w ruchu względnym: 0 = wyrzutnia w spoczynku,
                // 1 = cel stoi, a przesuwa go tylko dryf — znany co do joty, więc
                // wyprzedzamy go w całości i z prawdziwym czasem przechwycenia w
                // układzie rakiety (dostrojona formuła zaniża go przy szybkim
                // zbliżaniu: 7800 j/s mijało cel o 75 j. przy bezpieczniku 65 j.).
                // W pościgu (cel leci z układem) ruch względny znika sam.
                readTargetVelocity2D(r.target, _targetVel);
                const frameSpeed = Math.hypot(r.frameVel.x, r.frameVel.z);
                const driftShare = frameSpeed > 1e-6
                    ? frameSpeed / (frameSpeed + Math.hypot(_targetVel.x, _targetVel.y))
                    : 0;
                let leadPoint = tunedLead;
                if (driftShare > 0) {
                    const trueLead = solveLeadAim2D(_leadPos, _leadFrame, r.target, planarSpeed, _leadAim2D, _leadFrame);
                    trueLead.x = tunedX + (trueLead.x - tunedX) * driftShare;
                    trueLead.y = tunedY + (trueLead.y - tunedY) * driftShare;
                    leadPoint = trueLead;
                }

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

                const aimWeight = leadWeight + (1 - leadWeight) * driftShare;
                const aimX = THREE.MathUtils.lerp(tx, leadPoint.x, aimWeight);
                const aimZ = THREE.MathUtils.lerp(ty, leadPoint.y, aimWeight);
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
            _forward.set(0, 1, 0).applyQuaternion(r.quaternion).normalize();

            if (r.state === "POWERED") {
                // Kinematic flight: velocity follows the nose. The quaternion above is
                // turn-rate-capped, so weaponDef.turnRate governs the actual flight path,
                // not just the visual heading. Free-force integration couldn't turn the
                // velocity vector (lateral authority = thrust/mass ≈ 175 u/s² at cruise
                // throttle → 18 500u turn radius at 1800 u/s vs ~65u fuse), so missiles
                // sailed past targets. Speed tracks guidanceDesiredSpeed with a real
                // decel limit, making terminal/reacquire speed factors actually brake.
                const speed = r.velocity.length();
                const desiredSpeed = Math.max(220, guidanceDesiredSpeed);
                const accelLimit = r.maxThrust / r.mass;
                const newSpeed = speed < desiredSpeed
                    ? Math.min(desiredSpeed, speed + accelLimit * dt)
                    : Math.max(desiredSpeed, speed - accelLimit * 0.8 * dt);
                r.velocity.copy(_forward).multiplyScalar(newSpeed);
                // currentThrust only drives exhaust VFX intensity now.
                const throttleNorm = THREE.MathUtils.clamp(((desiredSpeed - speed) / desiredSpeed) * 1.4 + 0.25, 0.12, 1.0);
                r.currentThrust = r.maxThrust * throttleNorm;
            } else {
                // EJECTED: ballistic cold-launch arc (gravity + drag), motor not lit.
                const weight = r.mass * PHYSICS.gravity;
                _force.set(0, -weight, 0);
                const speedSq = r.velocity.lengthSq();
                if (speedSq > 1) {
                    _drag.copy(r.velocity).normalize().negate();
                    _force.addScaledVector(_drag, speedSq * PHYSICS.airDrag);
                }
                r.velocity.addScaledVector(_force.divideScalar(r.mass), dt);
            }

            r.position.addScaledVector(r.velocity, dt);
            // Układ rakiety: pierwszy update dosuwa pozę z kroku fizyki (bornSim)
            // do czasu tej klatki — potem SimClock.render rośnie o to samo dt.
            const frameDt = r.frameSynced ? dt : (SimClock.render - r.bornSim);
            r.frameSynced = true;
            r.position.x += r.frameVel.x * frameDt;
            r.position.z += r.frameVel.z * frameDt;
            // Zasięg = droga WŁASNA (względem układu), nie przelot razem z wyrzutnią.
            r.travelDistance += Math.hypot(r.velocity.x, r.velocity.z) * dt;
            // prevTravelPos still holds the pre-step position; the fuse check below
            // sweeps the full segment traveled this frame. Synced after hit detection.

            if (r.position.y > R.maxAltitude) {
                r.position.y = R.maxAltitude;
                if (r.velocity.y > 0) r.velocity.y *= 0.2;
            }

            /* ── Kierunek kadłubka (wygląd: kurs w płaszczyźnie gry) ── */
            _renderDir.copy(_forward);
            if (_renderDir.lengthSq() < 1e-6) {
                _renderDir.copy(r.visualDir);
            } else {
                _renderDir.normalize();
                r.visualDir.copy(_renderDir);
            }

            /* ── Wygląd lotu: smuga porcji gazu wzdłuż odcinka dyszy (src/3d/rockets/) ── */
            if (fx) fx.onFly(r, dt);

            const traveled = r.travelDistance;

            /* ── Hit detection (swept: closest approach over this frame's segment) ── */
            if (r.target && !r.target.dead) {
                const tx = Number(r.target.x ?? r.target.pos?.x) || 0;
                const ty = Number(r.target.y ?? r.target.pos?.y) || 0;
                // Endpoint-only distance tunnels through the fuse sphere at high speed
                // (supernova at 30 fps steps 120u/frame against a 98u fuse).
                const x1 = r.prevTravelPos.x, z1 = r.prevTravelPos.z;
                const segX = r.position.x - x1;
                const segZ = r.position.z - z1;
                const segLenSq = segX * segX + segZ * segZ;
                let tSeg = segLenSq > 1e-9 ? ((tx - x1) * segX + (ty - z1) * segZ) / segLenSq : 1;
                tSeg = THREE.MathUtils.clamp(tSeg, 0, 1);
                const cx = x1 + segX * tSeg;
                const cz = z1 + segZ * tSeg;
                const dx = tx - cx;
                const dz = ty - cz;
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
                    // Detonate at the closest-approach point, not wherever the step ended.
                    r.position.x = cx;
                    r.position.z = cz;
                    // Wygląd: punkt i normalna poszycia wzdłuż odcinka lotu — przed obrażeniami
                    // (krater zabija węzły). Tylko odczyt kadłuba, bez losowania.
                    if (fx && !isPointTarget) fx.prepareContact(r, x1, z1, cx, cz);
                    this._onHit(r);
                    this._explode(r);
                    continue;
                }
            }
            r.prevTravelPos.copy(r.position);

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

        // Wygląd: zegar reżysera efektów (dym jedzie z rakietą co do kroku), sekwencje
        // Supernowej, płonące odłamki, przypalenia.
        if (fx) fx.update(dt);
    }

    /* ─────────────────── DAMAGE ─────────────────── */

    _onHit(r) {
        const target = r.target;
        if (!target || target.dead) return;
        if (target._isPositionTarget) return;

        const dmg = r.damage || 60;

        // Rakiety zdejmowały HP tarczy przez applyDamageTo*, ale nigdy nie
        // rejestrowały trafienia — pole nie dostawało ani ripple, ani cząsteczek.
        if (isEntityShieldBlocking(target) && typeof window !== "undefined" && window.registerShieldImpact) {
            window.registerShieldImpact(
                target, r.position.x, r.position.z, dmg, shieldImpactClass(r.weaponDef)
            );
            // Kula ognia na polu energetycznym to VFX trafienia w PANCERZ.
            // Detonacja zostaje (obrażenia obszarowe, dźwięk), znika sam pokaz —
            // zastępuje go bańka i cząsteczki w kolorze tarczy.
            r.hitShield = true;
        }

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
            // OPTIMIZATION: distSq early-reject, sqrt only if inside radius
            const distSq = dx * dx + dz * dz;
            const effectiveRadius = blastRadius + getEntityRadius(player) * 0.65;
            const effRadSq = effectiveRadius * effectiveRadius;
            if (distSq <= effRadSq && applyPlayer) {
                const dist = Math.sqrt(distSq);
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
            // OPTIMIZATION: distSq early-reject avoids sqrt for far NPCs (blast radius is small
            // relative to NPC count — most NPCs are out of range and now skip Math.hypot entirely)
            const distSq = dx * dx + dz * dz;
            const effectiveRadius = blastRadius + getEntityRadius(npc) * 0.65;
            const effRadSq = effectiveRadius * effectiveRadius;
            if (distSq > effRadSq) continue;
            const dist = Math.sqrt(distSq);
            const falloff = THREE.MathUtils.clamp(1 - (dist / Math.max(1, effectiveRadius)), 0, 1);
            const dmg = damageBase * (0.35 + falloff * 0.65);
            if (dmg > 1 && applyNpc) applyNpc(npc, dmg, "rocket");
        }
    }

    /* ─────────────────── EXPLOSION ─────────────────── */

    _explode(r) {
        if (r.active) this.activeRockets = Math.max(0, this.activeRockets - 1);
        r.active = false;

        const ex = r.position.x;
        const ez = r.position.z;
        this._applyBlastDamage(r, ex, ez);

        // Wygląd wybuchu (src/3d/rockets/effects.js): głowica na polu tarczy — receptura
        // tarczy (pole ma też własne wstęgi i bańkę), na kadłubie — kula ognia z nośnikiem
        // trafionego kadłuba, w próżni (koniec zasięgu, punkt) — w układzie rakiety;
        // Supernowa — implozja, błysk, fala, pozostałość.
        const hitShield = !!r.hitShield;
        r.hitShield = false;
        const hitEntity = r.didImpactDamage && r.target && !r.target._isPositionTarget ? r.target : null;
        if (this.effects) this.effects.onDetonate(r, ex, ez, hitEntity, hitShield);
    }

    /* ─────────────────── DISPOSE ─────────────────── */

    dispose() {
        instance = null;
        if (typeof window !== "undefined" && window.rocketSystem3D === this) window.rocketSystem3D = null;
    }
}

/* ═══════════════════════════════════════════════════
   PUBLIC API  (module exports + window globals)
   ═══════════════════════════════════════════════════ */

/**
 * @param {object|null} scene scena (zgodność API; obraz rysuje reżyser efektów w Core3D)
 * @param {object} [opts] { effects } — `createRocketFx(Core3D)` (src/3d/rockets/rocketFx.js)
 *   albo sam reżyser; bez niego lot bez obrazu (testy w Node)
 */
export function initRocketSystem3D(scene, opts = {}) {
    if (instance) instance.dispose();
    const fx = opts?.effects || null;
    const director = fx && fx.director ? fx.director : fx;
    instance = new RocketSystem3D(scene, { effects: director });
    // Klatka efektów czyta pulę slotów rakiet (kadłubki, płomienie, światła dysz, ślady w dymie).
    if (fx && typeof fx.attachRockets === "function") fx.attachRockets(instance.rockets);
    if (typeof window !== "undefined") window.rocketSystem3D = instance;
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
 * @param {number}  launchVx, launchVy — prędkość wyrzutni (układ rakiety)
 */
export function fireRocket3D(gameX, gameY, target, damage, weaponDef, color, launchVx = 0, launchVy = 0) {
    if (instance) instance.fire(gameX, gameY, target, damage, weaponDef, color, launchVx, launchVy);
}
