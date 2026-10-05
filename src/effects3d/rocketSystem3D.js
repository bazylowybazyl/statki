/**
 * 3D Rocket System — LOT rakiet (fizyka, naprowadzanie, zapalnik, obrażenia) i SALWY.
 * Ported from rakiety.html RocketManager + integration layer.
 *
 * Wygląd (port WebGPU, zadanie 19): efekty z dema `dema/rakiety-webgpu` w scenie Core3D —
 * src/3d/rockets/ (dym GPU z samocieniem, płomienie z dyskami Macha, kadłubki, kule ognia,
 * iskry, łuki, Supernowa z pozostałością). Ten moduł zgłasza reżyserowi efektów zdarzenia
 * (`effects`: onLaunch / onIgnite / onFly / onSplit / prepareContact / onDetonate / update,
 * opcjonalnie beginUpdate); bez `effects` (testy w Node) rakiety latają bez obrazu.
 *
 * LOT (2026-09-30, „feel” rakiet — tests/rocketGuidance.test.mjs):
 *   1. WYRZUT — zimny start z komory: rakieta wyskakuje pod kątem `launchElevation` (90° —
 *      pionowo, VLS) i wytraca prędkość, ZAWISA chwilę nad kadłubem;
 *   2. ZAPŁON po `ignitionDelay` — silnik, przechył z pionu w kurs WACHLARZA salwy (każda
 *      rakieta salwy ma własny kierunek w ±`dispersal`), rozpędzanie z `boostAccel`;
 *   3. NAPROWADZANIE — fazy intercept / terminal / reacquire jak dawniej (wyprzedzenie celu,
 *      turnRate), obrót narasta przez pierwsze 0,8 s po wachlarzu (szerokie łuki), kluczenie
 *      `weave` gaśnie przy celu — salwa zakręca łukami i zbiega się na cel z kilku stron;
 *   4. ZEJŚCIE na płaszczyznę gry w fazie końcowej.
 * Wysokość (Y) jest tylko obrazem (kamery 3D, światło dyszy, skrót perspektywy): zapalnik,
 * zasięg i trafienia liczą się w płaszczyźnie gry jak dotąd.
 *
 * SALWA (`fireSalvo`, z fireWeaponCore): pierwsza rakieta od razu, reszta z kolejki co
 * `burstDelay` z KOLEJNYCH komór wyrzutni (`launchPorts` × rzędy, `cellSpacing`). Komora i kierunek
 * wyrzutni są zapisane w układzie strzelca, więc salwa z lecącego i obracającego się okrętu
 * wychodzi z jego pokładu (pęd — prędkość punktu komory, v + ω × r). Strzelec zniszczony w trakcie
 * salwy — reszta przepada.
 * HYDRA (`submunition`): nosiciel pęka `splitRange` przed celem na rakiety potomne (wachlarz,
 * własne naprowadzanie, obrażenia każdej = obrażenia nosiciela).
 * Losowanie gry (Math.random): JEDNO ziarno na rakietę albo na salwę — rozrzut wyrzutu, zapłonu,
 * wachlarza i fazy kluczenia idą z haszu ziarna (`seedHash`).
 *
 * Coordinate convention (lot, Y-up jak dawny overlay):
 *   game world (x, y) → (x, 0, y)
 *   height above ground → Y
 *
 * Usage in index.html:
 *   import { initRocketSystem3D } ...
 *   initRocketSystem3D(Core3D.scene, { effects: createRocketFx(Core3D) })
 *   // every frame (przed render()): window.rocketSystem3D.update(dt)
 *   // on fire:  window.rocketSystem3D.fireSalvo(shooter, x, y, target, damage, weaponDef, 'blue', vx, vy, n, gap, az, mode)
 *   //       albo window.rocketSystem3D.fire(gameX, gameY, target, damage, weaponDef, 'blue', vx, vy)
 */
import * as THREE from "three";
import { isEntityShieldBlocking } from "../../shieldSystem.js";
import { shieldImpactClass, submunitionDef } from "../data/weapons.js";
import { SimClock } from "../game/simClock.js";
import { writePointVelocity } from "../game/carrierVelocity.js";

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
// Głowica przez przebicie tarczy: obrażenia w pancerz (jeden obiekt — bez alokacji na trafienie).
const ROCKET_BREACH_DAMAGE_OPTS = Object.freeze({ bypassShield: true });

const ROCKET = Object.freeze({
    mass:            8000,
    maxThrust:       28_000_000 * WS,   // 2 800 000 (przyspieszenie domyślne: maxThrust / masa)
    hitRadius:       800  * WS,          // 80 game units
    bodyLength:      160  * WS,          // 16
    maxRockets:      2000,
    maxAltitude:     600
});

/** Tryb wyrzutu rakiety (r.mode). */
export const LAUNCH_ELEVATED = 0;   // zimny wyrzut z komory pod kątem (VLS: 90°)
export const LAUNCH_RAIL = 1;       // z belki myśliwca: zrzut w bok, zapłon po chwili
export const LAUNCH_SPLIT = 2;      // głowica potomna Hydry: od razu na silniku

/** Pojemność kolejki salw (rakiety czekające na swoją komorę). */
const SALVO_CAP = 1024;
/** Najwięcej rakiet w jednej salwie. */
const SALVO_MAX = 64;
/** Czas, przez który obrót po wachlarzu narasta od TURN_RAMP_START do pełnego turnRate [s]. */
const TURN_RAMP = 1.0;
const TURN_RAMP_START = 0.4;
/** Zawis: prędkość wyrzutu gaśnie jak e^(−k·t), k = POP_DECAY / ignitionDelay (przy zapłonie ~16 %). */
const POP_DECAY = 1.8;
/** Głowica bez celu (cel zginął w locie) pyta hak `retarget` o nowy co tyle sekund. */
const RETARGET_EVERY = 0.2;

const TAU = Math.PI * 2;

/* ── Reusable temp vectors (allocated once) ── */
const _forward   = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _BASE_FWD  = new THREE.Vector3(0, 1, 0);  // rocket nose in local space
const _leadAim2D = { x: 0, y: 0, t: 0 };
// Scratch prowadzenia (bez obiektów per rakieta per klatka).
const _leadPos = { x: 0, y: 0 };
const _leadVel = { x: 0, y: 0 };
const _leadFrame = { x: 0, y: 0 };
const _targetVel = { x: 0, y: 0 };
const _pointVel = { x: 0, y: 0 };
// Opis wyrzutu dla fire() z salwy / podziału (jeden obiekt — fire czyta go od razu).
const _launch = {
    mode: LAUNCH_ELEVATED, index: 0, count: 1, seed: 0, azimuth: NaN, shooter: null,
    // tylko LAUNCH_SPLIT: wysokość i ruch własny nosiciela, kurs wachlarza
    y: 0, vx: 0, vy: 0, vz: 0
};

/**
 * Liczba 0..1 z ziarna rakiety / salwy i klucza (hasz 32-bit) — rozrzut wyrzutu bez kolejnych
 * losowań z Math.random (sekwencja gry): jedno ziarno, dowolnie wiele niezależnych liczb.
 */
export function seedHash(seed, k) {
    let h = ((seed * 4294967296) >>> 0) ^ Math.imul(k + 0x6D2B79F5, 0x9E3779B1);
    h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function readTargetVelocity2D(target, out) {
    const vel = target?.vel || target?.velocity || null;
    out.x = Number(target?.vx ?? vel?.x) || 0;
    out.y = Number(target?.vy ?? vel?.y) || 0;
    return out;
}

/** Poza strzelca: NPC całkują x/y (kanoniczne), gracz ma x/y jako lustro pos po kroku fizyki. */
function entX(e) { const x = Number(e?.x); return Number.isFinite(x) ? x : (Number(e?.pos?.x) || 0); }
function entY(e) { const y = Number(e?.y); return Number.isFinite(y) ? y : (Number(e?.pos?.y) || 0); }
function entAngle(e) { return Number(e?.angle) || 0; }
function entGone(e) { return !e || e.dead === true || e.destroyed === true || e.removed === true; }

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

const clampN = (v, a, b) => (v < a ? a : (v > b ? b : v));
const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
function wrapPi(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
}

function resolveRocketProfile(weaponDef) {
    const desiredSpeed = Math.max(400, Number(weaponDef?.baseSpeed) || Number(weaponDef?.speed) || 1200);
    const maxRange = Math.max(3000, Number(weaponDef?.baseRange) || Number(weaponDef?.range) || 12000);
    const blastRadius = Math.max(24, Number(weaponDef?.explodeRadius) || Number(weaponDef?.explosionRadius) || 48);
    const turnRateDeg = Math.max(25, Number(weaponDef?.turnRate) || 180);
    const speedFactor = THREE.MathUtils.clamp(desiredSpeed / 1200, 0.6, 4.0);
    const turnPenalty = THREE.MathUtils.clamp(180 / turnRateDeg, 0.45, 4.0);
    const homingDelay = THREE.MathUtils.clamp(Number(weaponDef?.homingDelay) || 0, 0, 3);
    const speedScale = Math.max(0.9, desiredSpeed / 900);
    const cruiseAltitudeDefault = Math.min(ROCKET.maxAltitude * 0.2, Math.max(30, desiredSpeed * 0.03));
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
    const k = THREE.MathUtils.clamp(turnRateDeg / 420, 0, 1);
    const deg = THREE.MathUtils.degToRad;
    const sub = weaponDef?.submunition ? submunitionDef(weaponDef) : null;
    return {
        desiredSpeed,
        maxRange,
        blastRadius,
        turnRateRad: deg(turnRateDeg),
        homingDelay: Number.isFinite(homingDelay) ? homingDelay : 0,
        maxThrust: ROCKET.maxThrust * speedScale,
        // Przyspieszenie silnika [j./s²] (dawniej maxThrust / masa — ~350 × speedScale).
        accel: Number(weaponDef?.boostAccel) > 0
            ? THREE.MathUtils.clamp(Number(weaponDef.boostAccel), 200, 20000)
            : (ROCKET.maxThrust * speedScale) / ROCKET.mass,
        // Wyrzut: kąt nad płaszczyzną, prędkość zimnego startu, zapłon (zawis).
        elevation: deg(THREE.MathUtils.clamp(numOr(weaponDef?.launchElevation, 70), 0, 90)),
        ejectSpeed: THREE.MathUtils.clamp(Number(weaponDef?.ejectSpeed) || 320, 40, 1500),
        ignitionDelay: THREE.MathUtils.clamp(numOr(weaponDef?.ignitionDelay, 0.12), 0.04, 0.8),
        launchTurnRateRad: deg(THREE.MathUtils.clamp(Number(weaponDef?.launchTurnRate) || Math.max(240, turnRateDeg * 0.5), 60, 1440)),
        dispersalRad: deg(THREE.MathUtils.clamp(Number(weaponDef?.dispersal) || 0, 0, 170)),
        dispersalTime: THREE.MathUtils.clamp(numOr(weaponDef?.dispersalTime, 0.2), 0, 1.5),
        weaveRad: deg(THREE.MathUtils.clamp(Number(weaponDef?.weave) || 0, 0, 40)),
        weaveHz: THREE.MathUtils.clamp(Number(weaponDef?.weaveHz) || 0, 0, 8),
        cruiseAltitude: Number.isFinite(cruiseAltitudeRaw)
            ? THREE.MathUtils.clamp(cruiseAltitudeRaw, 0, ROCKET.maxAltitude * 0.9)
            : cruiseAltitudeDefault,
        proximityRadius,
        terminalRadius,
        reacquireRadius,
        reacquireTurnMultiplier: THREE.MathUtils.clamp(
            Number(weaponDef?.reacquireTurnMultiplier) || THREE.MathUtils.lerp(2.3, 1.55, k),
            1.2,
            3.2
        ),
        reacquireSpeedFactor: THREE.MathUtils.clamp(
            Number(weaponDef?.reacquireSpeedFactor) || THREE.MathUtils.lerp(0.52, 0.72, k),
            0.35,
            0.95
        ),
        terminalSpeedFactor: THREE.MathUtils.clamp(
            Number(weaponDef?.terminalSpeedFactor) || THREE.MathUtils.lerp(0.68, 0.86, k),
            0.45,
            1.0
        ),
        leadHorizon: THREE.MathUtils.clamp(
            Number(weaponDef?.leadHorizon) || THREE.MathUtils.lerp(0.82, 0.38, k),
            0,
            1
        ),
        terminalLeadHorizon: THREE.MathUtils.clamp(
            Number(weaponDef?.terminalLeadHorizon) || THREE.MathUtils.lerp(0.18, 0.06, k),
            0,
            0.5
        ),
        // Wygląd rakiety (płomień, dym, kule ognia, Supernowa) czyta reżyser efektów z dema
        // (src/3d/rockets/) wprost z weaponDef; w profilu lotu zostaje tylko skala kadłubka.
        bodyScale: THREE.MathUtils.clamp(Number(weaponDef?.bodyScale) || 1, 0.25, 3.0),
        hitRadius: proximityRadius,
        // Głowica kasetowa (Hydra): liczba rakiet potomnych i odległość podziału od celu.
        subDef: sub,
        splitCount: sub ? THREE.MathUtils.clamp(Math.round(Number(weaponDef.submunition.count) || 0), 0, 16) : 0,
        splitRange: sub ? THREE.MathUtils.clamp(Number(weaponDef.submunition.splitRange) || 1500, 300, 8000) : 0
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
        this._frameNo = 0;

        /* ── Rocket data pool ── */
        this.rockets = [];
        for (let i = 0; i < ROCKET.maxRockets; i++) {
            this.rockets.push({
                active: false,
                index:  i,
                position:       new THREE.Vector3(),
                velocity:       new THREE.Vector3(),
                quaternion:     new THREE.Quaternion(),
                target:         null,
                state:          "EJECTED",
                timeSinceLaunch: 0,
                mass:           0,
                maxThrust:      0,
                currentThrust:  0,
                accel:          0,
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
                didImpactDamage:false,
                hitShield: false,
                weaponDef:      null,
                launchPos:      new THREE.Vector3(),
                prevTravelPos:  new THREE.Vector3(),
                travelDistance: 0,
                closestTargetDist: Infinity,
                lastTargetDist: Infinity,
                missCount: 0,
                reacquireUntil: 0,
                retargetAt:     0,
                terminalEnteredAtDist: Infinity,
                missGrowTime: 0,
                // Kurs nosa w płaszczyźnie gry (x, 0, z — jednostkowy) i jego wzniesienie [rad]:
                // pion (wyrzut) = π/2, lot poziomy = 0. Czyta reżyser efektów (kadłubek, płomień, dym).
                visualDir:      new THREE.Vector3(0, 0, 1),
                nosePitch:      0,
                noseAz:         0,
                // Układ rakiety (x, z overlaya) i czas pozy wyrzutni — patrz nagłówek.
                frameVel:       new THREE.Vector3(),
                bornSim:        0,
                frameSynced:    false,
                bornFrame:      -1,
                // Wyrzut i salwa.
                mode:           LAUNCH_ELEVATED,
                salvoIndex:     0,
                salvoCount:     1,
                seed:           0,
                launchAz:       0,
                dispAz:         0,
                popDrag:        1,
                ignitedAt:      0,
                interceptAt:    0,
                launchTurnRateRad: 0,
                dispersalTime:  0,
                weaveRad:       0,
                weaveHz:        0,
                weavePhase:     0,
                weavePhase2:    0,
                // Głowica kasetowa.
                subDef:         null,
                splitCount:     0,
                splitRange:     0,
                // Strzelec (tylko na czas onLaunch — efekt wyrzutni, odrzut kasety).
                shooter:        null,
                hostile:        false
            });
        }

        /* ── Kolejka salw (SoA): rakiety czekające na swoją komorę ── */
        this._qN = 0;
        this._qShooter = new Array(SALVO_CAP).fill(null);
        this._qTarget = new Array(SALVO_CAP).fill(null);
        this._qDef = new Array(SALVO_CAP).fill(null);
        this._qT = new Float64Array(SALVO_CAP);
        this._qLx = new Float64Array(SALVO_CAP);      // komora: układ strzelca (albo świat bez strzelca)
        this._qLy = new Float64Array(SALVO_CAP);
        this._qLaz = new Float64Array(SALVO_CAP);     // kierunek wyrzutni względem kursu strzelca
        this._qVx = new Float64Array(SALVO_CAP);      // pęd wyrzutni (bez strzelca)
        this._qVy = new Float64Array(SALVO_CAP);
        this._qDmg = new Float64Array(SALVO_CAP);
        this._qSeed = new Float64Array(SALVO_CAP);
        this._qIndex = new Uint16Array(SALVO_CAP);
        this._qCount = new Uint16Array(SALVO_CAP);
        this._qTheme = new Uint8Array(SALVO_CAP);
        this._qMode = new Uint8Array(SALVO_CAP);
        this._qLocal = new Uint8Array(SALVO_CAP);     // 1 — komora w układzie strzelca

        // Cele per rakieta NASTĘPNEJ salwy (planNextSalvo; kierowanie ogniem gracza dzieli salwę
        // na kilka celów) — fireSalvo zużywa je raz.
        this._nextTargets = null;
        // POLE WIDZENIA głowicy: `(rakieta) => encja | null` — nowy cel dla rakiety, której cel
        // zginął w locie (pyta co RETARGET_EVERY s). null — rakieta leci dalej prosto (jak dawniej).
        this.retarget = null;
    }

    /** Rakiety czekające w kolejkach salw (HUD, testy). */
    get pendingLaunches() { return this._qN; }

    /**
     * Cele per rakieta dla NASTĘPNEGO `fireSalvo` (indeks = numer rakiety w salwie; brak wpisu —
     * cel salwy). Jednorazowe; `null` kasuje plan (wołający czyści go po strzale).
     */
    planNextSalvo(targets) {
        this._nextTargets = targets || null;
    }

    /** Czy następna salwa ma już rozpisane cele (planNextSalvo). */
    get hasSalvoPlan() { return this._nextTargets !== null; }

    /**
     * Obrażenia rakiet W LOCIE i w kolejkach salw, które lecą na żywe cele (Map cel → suma),
     * dla strony `hostile` (false — gracz i sojusznicy). Nosiciel kasetowy liczy wszystkie głowice.
     * Budżet celów kierowania ogniem: nie dosyłać rakiet celowi, który już ma swoje w drodze.
     */
    collectIncoming(out, hostile = false) {
        out.clear();
        let seen = 0;
        for (let i = 0; seen < this.activeRockets && i < ROCKET.maxRockets; i++) {
            const r = this.rockets[i];
            if (!r.active) continue;
            seen++;
            if (r.hostile !== hostile) continue;
            const t = r.target;
            if (!t || t.dead || t._isPositionTarget) continue;
            out.set(t, (out.get(t) || 0) + r.damage * (r.splitCount > 0 ? r.splitCount : 1));
        }
        const theme = hostile ? 1 : 0;
        for (let q = 0; q < this._qN; q++) {
            if (this._qTheme[q] !== theme) continue;
            const t = this._qTarget[q];
            if (!t || t.dead || t._isPositionTarget) continue;
            const split = Math.round(Number(this._qDef[q]?.submunition?.count) || 0);
            out.set(t, (out.get(t) || 0) + this._qDmg[q] * (split > 0 ? split : 1));
        }
        return out;
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
     * @param {object|null} launch — opis wyrzutu z salwy / podziału (`_launch`: tryb, numer
     *                      w salwie, ziarno, kierunek wyrzutni); null — pojedyncza rakieta
     * @returns {object|null} slot rakiety (null — pula pełna)
     */
    fire(gameX, gameY, target, damage, weaponDef, colorTheme = "blue", launchVx = 0, launchVy = 0, launch = null) {
        let r = null;
        for (let i = 0; i < ROCKET.maxRockets; i++) {
            if (!this.rockets[i].active) { r = this.rockets[i]; break; }
        }
        if (!r) return null;

        const profile = resolveRocketProfile(weaponDef);
        const mode = launch ? launch.mode : (profile.elevation > 0.02 ? LAUNCH_ELEVATED : LAUNCH_RAIL);
        const index = launch ? launch.index : 0;
        const count = launch ? Math.max(1, launch.count) : 1;
        // Jedno losowanie gry na rakietę (albo na całą salwę — ziarno z fireSalvo).
        const seed = launch && Number.isFinite(launch.seed) ? launch.seed : Math.random();
        const hk = index * 16;

        r.active = true;
        this.activeRockets++;
        // Game coords → overlay: X stays, game-Y → overlay-Z, height=0
        r.position.set(gameX, 0, gameY);
        r.frameVel.set(Number(launchVx) || 0, 0, Number(launchVy) || 0);
        // Poza wyrzutni pochodzi z kroku fizyki — pierwszy update dosuwa układ
        // do czasu klatki (SimClock), jak interpolowany kadłub gracza.
        r.bornSim = SimClock.sim;
        r.frameSynced = false;
        r.bornFrame = this._frameNo;
        r.mode = mode;
        r.salvoIndex = index;
        r.salvoCount = count;
        r.seed = seed;
        r.shooter = launch ? (launch.shooter || null) : null;
        r.hostile = colorTheme === "red";

        r.target          = target;
        r.state           = "EJECTED";
        r.guidancePhase   = "launch";
        r.timeSinceLaunch = 0;
        r.ignitedAt       = 0;
        r.interceptAt     = 0;
        r.travelDistance  = 0;
        r.mass            = ROCKET.mass;
        r.maxThrust       = profile.maxThrust;
        r.currentThrust   = 0;
        r.accel           = profile.accel;
        r.turnRateRad     = profile.turnRateRad;
        r.homingDelay     = profile.homingDelay;
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
        r.launchTurnRateRad = profile.launchTurnRateRad;
        r.dispersalTime = profile.dispersalTime;
        r.weaveRad = profile.weaveRad;
        r.weaveHz = profile.weaveHz;
        r.weavePhase = seedHash(seed, hk + 7) * TAU;
        r.weavePhase2 = seedHash(seed, hk + 8) * TAU;
        r.subDef = profile.subDef;
        r.splitCount = profile.splitCount;
        r.splitRange = profile.splitRange;
        r.didImpactDamage = false;
        r.hitShield       = false;
        r.weaponDef       = weaponDef;
        r.closestTargetDist = Infinity;
        r.lastTargetDist = Infinity;
        r.missCount = 0;
        r.reacquireUntil = 0;
        r.retargetAt = 0;
        r.terminalEnteredAtDist = Infinity;
        r.missGrowTime = 0;

        // Środek wachlarza: cel przesunięty o ruch względem układu wyrzutni (albo punkt).
        _leadFrame.x = r.frameVel.x;
        _leadFrame.y = r.frameVel.z;
        let aimAz = NaN;
        if (target && !target.dead) {
            if (target._isPositionTarget) {
                const px = Number(target.x ?? target.pos?.x);
                const py = Number(target.y ?? target.pos?.y);
                if (Number.isFinite(px) && Number.isFinite(py) && (px !== gameX || py !== gameY)) aimAz = Math.atan2(py - gameY, px - gameX);
            } else {
                _leadPos.x = gameX;
                _leadPos.y = gameY;
                const aim = solveLeadAim2D(_leadPos, _leadFrame, target, profile.desiredSpeed, _leadAim2D, _leadFrame);
                if (aim.x !== gameX || aim.y !== gameY) aimAz = Math.atan2(aim.y - gameY, aim.x - gameX);
            }
        }
        const launchAz = launch && Number.isFinite(launch.azimuth)
            ? launch.azimuth
            : (Number.isFinite(aimAz) ? aimAz : 0);
        const fanCenter = Number.isFinite(aimAz) ? aimAz : launchAz;
        // Wachlarz salwy: numer rakiety na złotym podziale (równo, bez rzędów) z obrotem salwy;
        // pojedyncza rakieta — sam rozrzut.
        let fan = (seedHash(seed, hk + 1) - 0.5) * 2 * (0.08 + 0.12 * profile.dispersalRad);
        if (count > 1 && profile.dispersalRad > 0) {
            const u = (index * 0.6180339887 + seedHash(seed, 4093)) % 1;
            fan += (u * 2 - 1) * profile.dispersalRad;
        }
        r.dispAz = fanCenter + fan;
        r.launchAz = launchAz;

        if (mode === LAUNCH_SPLIT && launch) {
            // Głowica potomna: wysokość i ruch nosiciela, nos w kurs wachlarza — od razu na silniku.
            r.position.y = Math.max(0, Number(launch.y) || 0);
            const sp = Math.max(200, Math.sqrt(launch.vx * launch.vx + launch.vy * launch.vy + launch.vz * launch.vz));
            const c = Math.cos(r.dispAz);
            const s = Math.sin(r.dispAz);
            _targetDir.set(c * 0.96, 0.28, s * 0.96).normalize();
            r.quaternion.setFromUnitVectors(_BASE_FWD, _targetDir);
            r.velocity.copy(_targetDir).multiplyScalar(sp * 0.75);
            r.state = "POWERED";
            r.ignitionDelay = 0;
            r.popDrag = 1;
            r.currentThrust = r.maxThrust;
            r.frameSynced = true;
            r.visualDir.set(c, 0, s);
            r.noseAz = r.dispAz;
            r.nosePitch = Math.asin(_targetDir.y);
        } else if (mode === LAUNCH_RAIL) {
            // Zrzut z belki (myśliwiec): w bok od kadłuba i lekko do przodu, zapłon po chwili.
            const side = seedHash(seed, hk + 2) < 0.5 ? -1 : 1;
            const c = Math.cos(launchAz);
            const s = Math.sin(launchAz);
            const fwd = profile.ejectSpeed * 0.45;
            const lat = profile.ejectSpeed * 0.35 * side;
            r.velocity.set(c * fwd - s * lat, 0, s * fwd + c * lat);
            _targetDir.set(c, 0, s);
            r.quaternion.setFromUnitVectors(_BASE_FWD, _targetDir);
            r.ignitionDelay = Math.min(profile.ignitionDelay, 0.1) * (0.85 + 0.3 * seedHash(seed, hk + 3));
            r.popDrag = POP_DECAY / Math.max(0.04, r.ignitionDelay);
            r.visualDir.set(c, 0, s);
            r.noseAz = launchAz;
            r.nosePitch = 0;
        } else {
            // Zimny wyrzut z komory pod kątem launchElevation (rozrzut ±4°, prędkość ±10 %):
            // rakieta wyskakuje nad kadłub i zawisa, aż zapali silnik.
            const el = THREE.MathUtils.clamp(profile.elevation + (seedHash(seed, hk + 3) - 0.5) * 0.14, 0, Math.PI / 2);
            const az = launchAz + (seedHash(seed, hk + 4) - 0.5) * 0.4;
            const sp = profile.ejectSpeed * (0.9 + 0.2 * seedHash(seed, hk + 5));
            const ce = Math.cos(el);
            _targetDir.set(ce * Math.cos(az), Math.sin(el), ce * Math.sin(az));
            r.velocity.copy(_targetDir).multiplyScalar(sp);
            r.quaternion.setFromUnitVectors(_BASE_FWD, _targetDir);
            r.ignitionDelay = profile.ignitionDelay * (0.85 + 0.3 * seedHash(seed, hk + 6));
            r.popDrag = POP_DECAY / Math.max(0.04, r.ignitionDelay);
            r.visualDir.set(Math.cos(az), 0, Math.sin(az));
            r.noseAz = az;
            r.nosePitch = el;
        }
        r.launchPos.copy(r.position);
        r.prevTravelPos.copy(r.position);

        // Wygląd: wyrzut (obłok pary, błysk, odrzut kasety) — barwa pasa kadłubka ze strony (colorTheme).
        if (this.effects) {
            this.effects.onLaunch(r, colorTheme);
            // Głowica potomna wychodzi na silniku — zapłon od razu.
            if (r.state === "POWERED") this.effects.onIgnite(r);
        }
        r.shooter = null;
        return r;
    }

    /**
     * SALWA z wyrzutni: `count` rakiet co `gap` s z kolejnych komór (`launchPorts` × rzędy,
     * `cellSpacing` z karty broni) wokół wylotu (gameX, gameY). Pierwsza od razu, reszta z kolejki
     * (update) — pozycja komory w układzie strzelca, pęd = prędkość jej punktu na kadłubie.
     * @param {object|null} shooter    — okręt z wyrzutnią (null — komory stoją w świecie)
     * @param {number}      azimuth    — kierunek wyrzutni (świat, rad); NaN — w stronę celu
     * @param {number}      mode       — LAUNCH_ELEVATED | LAUNCH_RAIL
     * @returns {number} liczba rakiet w salwie (wystrzelonych i czekających)
     */
    fireSalvo(shooter, gameX, gameY, target, damage, weaponDef, colorTheme = "blue", launchVx = 0, launchVy = 0,
        count = 1, gap = 0, azimuth = NaN, mode = LAUNCH_ELEVATED) {
        const n = Math.max(1, Math.min(SALVO_MAX, Math.round(Number(count)) || 1));
        const seed = Math.random();
        // Cele per rakieta (planNextSalvo) — jednorazowe.
        const perTarget = this._nextTargets;
        this._nextTargets = null;
        const hasShooter = !!shooter && !entGone(shooter);
        let az = Number(azimuth);
        if (!Number.isFinite(az)) {
            const tx = Number(target?.x ?? target?.pos?.x);
            const ty = Number(target?.y ?? target?.pos?.y);
            az = Number.isFinite(tx) && Number.isFinite(ty) ? Math.atan2(ty - gameY, tx - gameX) : (hasShooter ? entAngle(shooter) : 0);
        }
        const ports = Math.max(1, Math.round(Number(weaponDef?.launchPorts) || 1));
        const rows = Math.ceil(n / ports);
        const spacing = Math.max(0, Number(weaponDef?.cellSpacing) || 0);
        const gapS = Math.max(0, Number(gap) || 0);
        const ca = Math.cos(az);
        const sa = Math.sin(az);
        const sx = hasShooter ? entX(shooter) : 0;
        const sy = hasShooter ? entY(shooter) : 0;
        const shA = hasShooter ? entAngle(shooter) : 0;
        const cs = Math.cos(-shA);
        const ss = Math.sin(-shA);
        const L = _launch;
        L.mode = mode === LAUNCH_RAIL ? LAUNCH_RAIL : LAUNCH_ELEVATED;
        L.count = n;
        L.seed = seed;
        L.shooter = hasShooter ? shooter : null;
        let fired = 0;
        for (let k = 0; k < n; k++) {
            // Komora k: kolumna (w poprzek wyrzutni) i rząd (wzdłuż) — ripple przechodzi rzędami.
            const col = k % ports;
            const row = Math.floor(k / ports);
            const lat = (col - (ports - 1) * 0.5) * spacing;
            const lon = (row - (rows - 1) * 0.5) * spacing * 0.85;
            const px = gameX + ca * lon - sa * lat;
            const py = gameY + sa * lon + ca * lat;
            const delay = k * gapS * (k > 0 ? 0.85 + 0.3 * seedHash(seed, 2000 + k) : 0);
            const tk = (perTarget && perTarget[k]) || target;
            if (delay <= 0 || this._qN >= SALVO_CAP) {
                L.index = k;
                L.azimuth = az;
                L.shooter = hasShooter ? shooter : null;
                if (this.fire(px, py, tk, damage, weaponDef, colorTheme, launchVx, launchVy, L)) fired++;
                continue;
            }
            const q = this._qN++;
            this._qShooter[q] = hasShooter ? shooter : null;
            this._qTarget[q] = tk || null;
            this._qDef[q] = weaponDef;
            this._qT[q] = delay;
            if (hasShooter) {
                const dx = px - sx;
                const dy = py - sy;
                this._qLx[q] = dx * cs - dy * ss;
                this._qLy[q] = dx * ss + dy * cs;
                this._qLaz[q] = az - shA;
                this._qLocal[q] = 1;
            } else {
                this._qLx[q] = px;
                this._qLy[q] = py;
                this._qLaz[q] = az;
                this._qLocal[q] = 0;
            }
            this._qVx[q] = Number(launchVx) || 0;
            this._qVy[q] = Number(launchVy) || 0;
            this._qDmg[q] = damage;
            this._qSeed[q] = seed;
            this._qIndex[q] = k;
            this._qCount[q] = n;
            this._qTheme[q] = colorTheme === "red" ? 1 : 0;
            this._qMode[q] = L.mode;
            fired++;
        }
        L.shooter = null;
        return fired;
    }

    /** Kolejka salw: rakiety, którym minął odstęp — z komory w AKTUALNEJ pozie strzelca. */
    _drainSalvos(dt) {
        const L = _launch;
        let i = 0;
        while (i < this._qN) {
            this._qT[i] -= dt;
            if (this._qT[i] > 0) { i++; continue; }
            const sh = this._qShooter[i];
            if (this._qLocal[i] === 1 && entGone(sh)) { this._qRemove(i); continue; }
            let x = this._qLx[i];
            let y = this._qLy[i];
            let az = this._qLaz[i];
            let vx = this._qVx[i];
            let vy = this._qVy[i];
            if (this._qLocal[i] === 1) {
                const a = entAngle(sh);
                const c = Math.cos(a);
                const s = Math.sin(a);
                const lx = x;
                const ly = y;
                x = entX(sh) + lx * c - ly * s;
                y = entY(sh) + lx * s + ly * c;
                az += a;
                writePointVelocity(sh, x, y, _pointVel);
                vx = _pointVel.x;
                vy = _pointVel.y;
            }
            const target = this._qTarget[i];
            L.mode = this._qMode[i];
            L.index = this._qIndex[i];
            L.count = this._qCount[i];
            L.seed = this._qSeed[i];
            L.azimuth = az;
            L.shooter = this._qLocal[i] === 1 ? sh : null;
            this.fire(x, y, target && !target.dead ? target : null, this._qDmg[i], this._qDef[i],
                this._qTheme[i] ? "red" : "blue", vx, vy, L);
            L.shooter = null;
            this._qRemove(i);
        }
    }

    _qRemove(i) {
        const last = --this._qN;
        if (i !== last) {
            this._qShooter[i] = this._qShooter[last];
            this._qTarget[i] = this._qTarget[last];
            this._qDef[i] = this._qDef[last];
            this._qT[i] = this._qT[last];
            this._qLx[i] = this._qLx[last];
            this._qLy[i] = this._qLy[last];
            this._qLaz[i] = this._qLaz[last];
            this._qVx[i] = this._qVx[last];
            this._qVy[i] = this._qVy[last];
            this._qDmg[i] = this._qDmg[last];
            this._qSeed[i] = this._qSeed[last];
            this._qIndex[i] = this._qIndex[last];
            this._qCount[i] = this._qCount[last];
            this._qTheme[i] = this._qTheme[last];
            this._qMode[i] = this._qMode[last];
            this._qLocal[i] = this._qLocal[last];
        }
        // Kolejka nie trzyma encji ani definicji po wyjściu rakiety.
        this._qShooter[last] = null;
        this._qTarget[last] = null;
        this._qDef[last] = null;
    }

    /** Czyści kolejki salw strzelca (np. okręt usunięty ze świata bez flagi dead). */
    cancelSalvos(shooter) {
        for (let i = this._qN - 1; i >= 0; i--) if (this._qShooter[i] === shooter) this._qRemove(i);
    }

    /* ─────────────────── UPDATE ─────────────────── */

    update(dt) {
        if (dt <= 0) return;
        dt = Math.min(dt, 0.05);
        this.globalTime += dt;
        const frameNo = ++this._frameNo;
        const fx = this.effects;
        const R  = ROCKET;
        if (fx && typeof fx.beginUpdate === "function") fx.beginUpdate(this.activeRockets + this._qN);
        // Salwy: rakiety, na które przyszła kolej (przed krokiem — lecą już w tej klatce).
        if (this._qN > 0) this._drainSalvos(dt);

        // Pusta pula → nie iteruj 2000 slotów.
        for (let i = 0; this.activeRockets > 0 && i < R.maxRockets; i++) {
            const r = this.rockets[i];
            if (!r.active) continue;
            // Głowica potomna urodzona w tej klatce (podział nosiciela) rusza od następnej.
            if (r.mode === LAUNCH_SPLIT && r.bornFrame === frameNo) continue;
            r.timeSinceLaunch += dt;
            const t = r.timeSinceLaunch;

            /* ── State transition: EJECTED → POWERED (zapłon po zawisie) ── */
            if (r.state === "EJECTED" && t >= r.ignitionDelay) {
                r.state = "POWERED";
                r.ignitedAt = t;
                r.currentThrust = r.maxThrust;
                if (fx) fx.onIgnite(r);
            }

            const speedNow = r.velocity.length();
            let guidanceDesiredSpeed = Math.max(300, r.desiredSpeed || 1200);
            // Sterowanie nosem: KURS (az, płaszczyzna gry) i WZNIESIENIE (el) osobno, każde z limitem
            // obrotu — kwaternion po najkrótszym łuku przy nawrotach szedł „przez zenit” (pętla w górę).
            let desAz = r.noseAz;
            let desEl = 0;
            let azRate = Math.max(0.001, r.turnRateRad);
            let elRate = Math.max(azRate, r.launchTurnRateRad);
            let steer = false;
            let target = r.target;
            let live = !!target && !target.dead;
            // POLE WIDZENIA głowicy: cel zginął w locie — hak `retarget` szuka nowego (przed nosem).
            if (!live && target && !target._isPositionTarget && this.retarget !== null && t >= r.retargetAt) {
                r.retargetAt = t + RETARGET_EVERY;
                const next = this.retarget(r);
                if (next && !next.dead) {
                    r.target = target = next;
                    live = true;
                    if (r.guidancePhase !== "launch") {
                        r.guidancePhase = "intercept";
                        r.interceptAt = t - TURN_RAMP;   // pełny obrót od razu — rakieta jest już w locie
                    }
                    r.closestTargetDist = Infinity;
                    r.lastTargetDist = Infinity;
                    r.missCount = 0;
                    r.missGrowTime = 0;
                    r.terminalEnteredAtDist = Infinity;
                }
            }
            let dist2D = Infinity;

            /* ── Faza wyrzutu: zawis, zapłon, przechył w kurs wachlarza salwy ── */
            if (r.guidancePhase === "launch") {
                const sinceIgnition = r.state === "POWERED" ? t - r.ignitedAt : -1;
                if (sinceIgnition >= r.dispersalTime && t >= r.homingDelay) {
                    r.guidancePhase = "intercept";
                    r.interceptAt = t;
                } else {
                    const look = Math.max(140, speedNow * 0.35);
                    desAz = r.dispAz;
                    desEl = Math.atan(THREE.MathUtils.clamp((r.cruiseAltitude - r.position.y) / look, -0.9, 1.2));
                    // Przed zapłonem nos dopiero zaczyna się kłaść (stery gazowe), po zapłonie — pełny przechył.
                    azRate = elRate = r.state === "POWERED" ? r.launchTurnRateRad : r.launchTurnRateRad * 0.2;
                    steer = true;
                    if (live) {
                        const tx = Number(target.x ?? target.pos?.x) || r.position.x;
                        const ty = Number(target.y ?? target.pos?.y) || r.position.z;
                        r.lastTargetDist = Math.hypot(tx - r.position.x, ty - r.position.z);
                    }
                }
            }

            /* ── Guidance phases: intercept / terminal / reacquire ── */
            if (!steer && live) {
                const isPointTarget = !!target._isPositionTarget;
                const tx = Number(target.x ?? target.pos?.x) || r.position.x;
                const ty = Number(target.y ?? target.pos?.y) || r.position.z;
                const targetRadius = isPointTarget ? 0 : Math.max(
                    Number(target.radius) || 0,
                    (Number(target.w) || 0) * 0.5,
                    (Number(target.h) || 0) * 0.5
                );
                const fuseRadius = Math.max(r.proximityRadius || r.hitRadius || R.hitRadius, targetRadius * 0.9);
                const terminalRadius = Math.max(r.terminalRadius || fuseRadius * 2, fuseRadius * 1.35);
                const reacquireRadius = Math.max(r.reacquireRadius || terminalRadius * 1.4, terminalRadius);

                const directDx = tx - r.position.x;
                const directDz = ty - r.position.z;
                dist2D = Math.hypot(directDx, directDz);

                if (isPointTarget) {
                    r.guidancePhase = "intercept";
                } else {
                    if (r.guidancePhase !== "reacquire" && dist2D <= terminalRadius) {
                        if (r.guidancePhase !== "terminal") {
                            r.guidancePhase = "terminal";
                            r.terminalEnteredAtDist = dist2D;
                            r.missGrowTime = 0;
                        }
                    } else if (r.guidancePhase === "reacquire" && (dist2D <= terminalRadius * 1.15 || t >= r.reacquireUntil)) {
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
                                r.reacquireUntil = t + THREE.MathUtils.clamp(0.24 + r.missCount * 0.08, 0.24, 0.9);
                                r.missGrowTime = 0;
                            }
                        } else {
                            r.missGrowTime = Math.max(0, r.missGrowTime - dt * 2.5);
                        }
                    }
                }

                /* ── Głowica kasetowa: nosiciel pęka przed celem ── */
                if (r.splitCount > 0 && r.state === "POWERED" && dist2D <= r.splitRange && t >= r.ignitionDelay + 0.35) {
                    this._split(r, frameNo);
                    continue;
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
                const tunedLead = solveLeadAim2D(_leadPos, _leadVel, target, planarSpeed, _leadAim2D, _leadFrame);
                const tunedX = tunedLead.x;
                const tunedY = tunedLead.y;
                // Udział dryfu układu w ruchu względnym: 0 = wyrzutnia w spoczynku,
                // 1 = cel stoi, a przesuwa go tylko dryf — znany co do joty, więc
                // wyprzedzamy go w całości i z prawdziwym czasem przechwycenia w
                // układzie rakiety (dostrojona formuła zaniża go przy szybkim
                // zbliżaniu: 7800 j/s mijało cel o 75 j. przy bezpieczniku 65 j.).
                // W pościgu (cel leci z układem) ruch względny znika sam.
                readTargetVelocity2D(target, _targetVel);
                const frameSpeed = Math.hypot(r.frameVel.x, r.frameVel.z);
                const driftShare = frameSpeed > 1e-6
                    ? frameSpeed / (frameSpeed + Math.hypot(_targetVel.x, _targetVel.y))
                    : 0;
                let leadPoint = tunedLead;
                if (driftShare > 0) {
                    const trueLead = solveLeadAim2D(_leadPos, _leadFrame, target, planarSpeed, _leadAim2D, _leadFrame);
                    trueLead.x = tunedX + (trueLead.x - tunedX) * driftShare;
                    trueLead.y = tunedY + (trueLead.y - tunedY) * driftShare;
                    leadPoint = trueLead;
                }

                let leadWeight = 0;
                let targetY = r.cruiseAltitude;
                let dive = false;
                let effectiveTurnRate = Math.max(0.001, r.turnRateRad);
                if (r.guidancePhase === "intercept") {
                    leadWeight = isPointTarget ? 0 : r.leadHorizon;
                    if (dist2D <= terminalRadius * 1.6) { targetY = 0; dive = true; }
                    // Po wachlarzu obrót narasta od 40 %: tory salwy zakręcają szerokimi łukami,
                    // zanim rakiety złapią cel pełnym naprowadzaniem.
                    const ramp = Math.min(1, TURN_RAMP_START + (1 - TURN_RAMP_START) * (t - r.interceptAt) / TURN_RAMP);
                    effectiveTurnRate *= ramp;
                } else if (r.guidancePhase === "terminal") {
                    leadWeight = isPointTarget ? 0 : r.terminalLeadHorizon;
                    targetY = 0;
                    dive = true;
                    guidanceDesiredSpeed *= r.terminalSpeedFactor;
                    effectiveTurnRate *= 1.25;
                } else if (r.guidancePhase === "reacquire") {
                    leadWeight = isPointTarget ? 0 : Math.min(0.18, r.terminalLeadHorizon);
                    targetY = 0;
                    dive = true;
                    guidanceDesiredSpeed *= r.reacquireSpeedFactor;
                    effectiveTurnRate *= r.reacquireTurnMultiplier;
                }

                const aimWeight = leadWeight + (1 - leadWeight) * driftShare;
                const aimX = THREE.MathUtils.lerp(tx, leadPoint.x, aimWeight);
                const aimZ = THREE.MathUtils.lerp(ty, leadPoint.y, aimWeight);
                const aimAz = Math.atan2(aimZ - r.position.z, aimX - r.position.x);
                desAz = aimAz;

                // Kluczenie: kurs celu kołysze się (dwie harmoniczne — bez metronomu), gaśnie przed
                // fazą końcową, żeby nie psuć trafień.
                if (r.weaveRad > 0 && r.guidancePhase === "intercept") {
                    const fade = THREE.MathUtils.clamp((dist2D - terminalRadius * 1.25) / (terminalRadius * 1.5), 0, 1);
                    if (fade > 0) {
                        const ph = TAU * r.weaveHz * t;
                        desAz += r.weaveRad * fade * (Math.sin(r.weavePhase + ph) + 0.5 * Math.sin(r.weavePhase2 + ph * 1.73)) * 0.667;
                    }
                }

                // Pułap: nachylenie z błędu wysokości na odcinku wyprzedzenia (niezależnie od odległości
                // celu — daleki cel nie zostawia rakiety w górze); nurkowanie przed celem tak, żeby
                // zejść na płaszczyznę gry na granicy zapalnika.
                const look = dive
                    ? Math.max(40, dist2D - fuseRadius * 0.5)
                    : Math.max(160, planarSpeed * 0.4);
                desEl = Math.atan(THREE.MathUtils.clamp((targetY - r.position.y) / look, -1.2, 0.9));

                if (r.guidancePhase === "reacquire" || r.guidancePhase === "terminal") {
                    const angleError = Math.abs(wrapPi(aimAz - r.noseAz));
                    const anglePenalty = THREE.MathUtils.clamp(angleError / Math.PI, 0, 1);
                    guidanceDesiredSpeed *= THREE.MathUtils.lerp(1.0, 0.45, anglePenalty);
                }

                azRate = effectiveTurnRate;
                elRate = Math.max(effectiveTurnRate, r.launchTurnRateRad);
                steer = true;
                r.lastTargetDist = dist2D;
            } else if (!steer) {
                // Bez celu (zginął w locie albo brak namiaru): wyrównanie na wysokości przelotu, kurs bez zmian.
                desAz = r.noseAz;
                desEl = Math.atan(THREE.MathUtils.clamp((r.cruiseAltitude - r.position.y) / Math.max(160, speedNow * 0.4), -0.9, 0.9));
                elRate = r.launchTurnRateRad;
                steer = true;
            }

            if (steer) {
                // Kurs: przy nosie w pionie zmiana az prawie nie rusza nosem — limit rośnie jak 1/cos(el).
                const errAz = wrapPi(desAz - r.noseAz);
                const azStep = azRate * dt / Math.max(0.2, Math.cos(r.nosePitch));
                r.noseAz = wrapPi(r.noseAz + clampN(errAz, -azStep, azStep));
                const elStep = elRate * dt;
                r.nosePitch += clampN(desEl - r.nosePitch, -elStep, elStep);
            }

            /* ── Physics ── */
            const ce = Math.cos(r.nosePitch);
            _forward.set(ce * Math.cos(r.noseAz), Math.sin(r.nosePitch), ce * Math.sin(r.noseAz));

            if (r.state === "POWERED") {
                // Kinematic flight: velocity follows the nose. The nose above is
                // turn-rate-capped, so weaponDef.turnRate governs the actual flight path,
                // not just the visual heading. Free-force integration couldn't turn the
                // velocity vector (lateral authority = thrust/mass ≈ 175 u/s² at cruise
                // throttle → 18 500u turn radius at 1800 u/s vs ~65u fuse), so missiles
                // sailed past targets. Speed tracks guidanceDesiredSpeed with a real
                // decel limit, making terminal/reacquire speed factors actually brake.
                const desiredSpeed = Math.max(220, guidanceDesiredSpeed);
                const accelLimit = r.accel;
                const newSpeed = speedNow < desiredSpeed
                    ? Math.min(desiredSpeed, speedNow + accelLimit * dt)
                    : Math.max(desiredSpeed, speedNow - accelLimit * 0.8 * dt);
                r.velocity.copy(_forward).multiplyScalar(newSpeed);
                // currentThrust only drives exhaust VFX intensity now.
                const throttleNorm = THREE.MathUtils.clamp(((desiredSpeed - speedNow) / desiredSpeed) * 1.4 + 0.25, 0.12, 1.0);
                r.currentThrust = r.maxThrust * throttleNorm;
                r.position.addScaledVector(r.velocity, dt);
            } else {
                // EJECTED: zimny wyrzut bez silnika — prędkość gaśnie wykładniczo (zawis nad komorą),
                // droga liczona analitycznie (bez zależności od kroku klatki).
                const k = r.popDrag;
                const e = Math.exp(-k * dt);
                const f = (1 - e) / k;
                r.position.x += r.velocity.x * f;
                r.position.y += r.velocity.y * f;
                r.position.z += r.velocity.z * f;
                r.velocity.multiplyScalar(e);
            }
            // Kwaternion nosa (zgodność: odczyt w efektach i konsoli).
            r.quaternion.setFromUnitVectors(_BASE_FWD, _forward);

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

            // Wysokość to obraz: płaszczyzna gry jest podłogą, pułap — sufitem.
            if (r.position.y < 0) r.position.y = 0;
            else if (r.position.y > R.maxAltitude) r.position.y = R.maxAltitude;

            /* ── Kurs nosa w płaszczyźnie (wygląd: kadłubek, płomień, dym; wzniesienie w nosePitch) ── */
            r.visualDir.set(Math.cos(r.noseAz), 0, Math.sin(r.noseAz));

            /* ── Wygląd lotu: smuga porcji gazu wzdłuż odcinka dyszy (src/3d/rockets/) ── */
            if (fx) fx.onFly(r, dt);

            const traveled = r.travelDistance;

            /* ── Hit detection (swept: closest approach over this frame's segment) ── */
            if (live && !target.dead) {
                const tx = Number(target.x ?? target.pos?.x) || 0;
                const ty = Number(target.y ?? target.pos?.y) || 0;
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
                const dist = Math.sqrt(dx * dx + dz * dz);
                const isPointTarget = !!target._isPositionTarget;
                const targetRadius = isPointTarget ? 0 : Math.max(
                    Number(target.radius) || 0,
                    (Number(target.w) || 0) * 0.5,
                    (Number(target.h) || 0) * 0.5
                );
                const fuseRadius = Math.max((r.hitRadius || R.hitRadius), targetRadius * 0.9);
                const minArmTime = isPointTarget ? 0.7 : 0.18;
                const minArmDistance = isPointTarget
                    ? Math.max(320, fuseRadius * 4.0)
                    : Math.max(90, fuseRadius * 1.1);
                const isArmed = (t >= minArmTime) && (traveled >= minArmDistance);
                const shouldDetonate = isArmed && dist <= fuseRadius;
                if (shouldDetonate) {
                    // Detonate at the closest-approach point, not wherever the step ended.
                    r.position.x = cx;
                    r.position.z = cz;
                    // Wygląd: punkt i normalna poszycia wzdłuż odcinka lotu — przed obrażeniami
                    // (krater zabija węzły). Tylko odczyt kadłuba, bez losowania.
                    if (fx && !isPointTarget) fx.prepareContact(r, x1, z1, cx, cz);
                    this._onHit(r, x1, z1, cx, cz);
                    this._explode(r);
                    continue;
                }
            }
            r.prevTravelPos.copy(r.position);

            if (traveled >= (r.maxRange || 0)) {
                this._explode(r);
            }
        }

        // Wygląd: zegar reżysera efektów (dym jedzie z rakietą co do kroku), sekwencje
        // Supernowej, płonące odłamki, przypalenia.
        if (fx) fx.update(dt);
    }

    /* ─────────────────── SPLIT (Hydra) ─────────────────── */

    /**
     * Nosiciel głowicy kasetowej pęka: rakiety potomne (wachlarz ±dispersal wokół kursu nosiciela,
     * jego wysokość i ruch, ten sam cel i układ) — nosiciel znika bez obrażeń.
     */
    _split(r, frameNo) {
        const sub = r.subDef;
        const n = r.splitCount;
        if (this.effects && typeof this.effects.onSplit === "function") this.effects.onSplit(r);
        const x = r.position.x;
        const z = r.position.z;
        const L = _launch;
        L.mode = LAUNCH_SPLIT;
        L.count = n;
        L.seed = seedHash(r.seed, 9001 + r.salvoIndex);
        L.azimuth = Math.atan2(r.visualDir.z, r.visualDir.x);
        L.shooter = null;
        L.y = r.position.y;
        L.vx = r.velocity.x;
        L.vy = r.velocity.y;
        L.vz = r.velocity.z;
        const target = r.target;
        const damage = r.damage;
        const theme = r.hostile ? "red" : "blue";
        const fvx = r.frameVel.x;
        const fvz = r.frameVel.z;
        // Nosiciel znika przed potomnymi (zwalnia slot, liczniki bez obrażeń).
        this._deactivate(r);
        for (let k = 0; k < n; k++) {
            L.index = k;
            const c = this.fire(x, z, target, damage, sub, theme, fvx, fvz, L);
            if (c) c.bornFrame = frameNo;
        }
    }

    _deactivate(r) {
        if (r.active) this.activeRockets = Math.max(0, this.activeRockets - 1);
        r.active = false;
        r.target = null;
        r.shooter = null;
    }

    /* ─────────────────── DAMAGE ─────────────────── */

    _onHit(r, x0 = r.position.x, z0 = r.position.z, x1 = r.position.x, z1 = r.position.z) {
        const target = r.target;
        if (!target || target.dead) return;
        if (target._isPositionTarget) return;

        const dmg = r.damage || 60;

        // Rakiety zdejmowały HP tarczy przez applyDamageTo*, ale nigdy nie
        // rejestrowały trafienia — pole nie dostawało ani ripple, ani cząsteczek.
        let shieldBlocking = isEntityShieldBlocking(target);
        // Przebicie tarczy (src/3d/shield3D.js): głowica w dziurze przegrzanego pola trafia pancerz.
        const breach = shieldBlocking && typeof window !== "undefined" && !!(target._realEntity || target).__shieldBreach
            && typeof window.isShieldBreachedAt === "function" && window.isShieldBreachedAt(target, r.position.x, r.position.z);
        if (breach) shieldBlocking = false;
        if (shieldBlocking && typeof window !== "undefined" && window.registerShieldImpact) {
            window.registerShieldImpact(
                target, r.position.x, r.position.z, dmg, shieldImpactClass(r.weaponDef)
            );
            // Kula ognia na polu energetycznym to VFX trafienia w PANCERZ.
            // Detonacja zostaje (obrażenia obszarowe, dźwięk), znika sam pokaz —
            // zastępuje go bańka i cząsteczki w kolorze tarczy.
            r.hitShield = true;
        }

        // Głowica na poszyciu (zadanie 25c): mały krater na miarę rany rakiety w punkcie styku
        // (ten sam co obraz wybuchu) — przed obrażeniami HP, żeby śmierć celu (wrak z całego
        // kadłuba) nie zabrała mu kadłuba. Punkt i krater liczy gra (index.html).
        if (!shieldBlocking && target.beamHull && typeof window !== "undefined" && window.applyRocketHullImpact) {
            const tvx = Number(target.vx ?? target.vel?.x) || 0;
            const tvy = Number(target.vy ?? target.vel?.y) || 0;
            window.applyRocketHullImpact(target, x0, z0, x1, z1, dmg, r.weaponDef,
                r.velocity.x + r.frameVel.x - tvx, r.velocity.z + r.frameVel.z - tvy);
        }

        const applyNpc    = window.applyDamageToNPC;
        const applyPlayer = window.applyDamageToPlayer;

        // Determine if target is the player
        const isPlayer = (target === window.ship) || !!target._isPlayerShip || (target === window.Game?.player);
        const dmgOpts = breach ? ROCKET_BREACH_DAMAGE_OPTS : undefined;
        if (isPlayer) {
            if (applyPlayer) applyPlayer(dmg, dmgOpts);
        } else {
            if (applyNpc) applyNpc(target, dmg, "rocket", dmgOpts);
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

    /**
     * Ciała budowli w zasięgu wybuchu (kawałki doku w bańce gracza, src/game/worldBodies.js): front ciśnienia
     * przez solver — belki gną się i pękają, wyspy bez kotwic odpadają. Obrażenia budowli raz na wybuch.
     * Piraci we własny dok nie strzelają (jak pociski).
     */
    _blastWorldBodies(r, ex, ez) {
        const W = typeof window !== "undefined" ? window.WorldBodies : null;
        if (!W || !(W.stats?.live > 0) || r.shooter?.isPirate) return;
        const radius = Math.max(0, Number(r.blastRadius) || 0);
        const dmg = Math.max(0, Number(r.damage) || 0);
        if (radius <= 0 || dmg <= 0) return;
        const owners = W.detonateDamage(ex, ez, radius, dmg, r.velocity.x + r.frameVel.x, r.velocity.z + r.frameVel.z);
        const applyStation = window.applyDamageToStation;
        if (!owners || !owners.length || typeof applyStation !== "function") return;
        for (let i = 0; i < owners.length; i++) {
            const st = owners[i];
            if (st && !st._destroyed3D && st.hp > 0) applyStation(st, dmg);
        }
    }

    /* ─────────────────── EXPLOSION ─────────────────── */

    _explode(r) {
        if (r.active) this.activeRockets = Math.max(0, this.activeRockets - 1);
        r.active = false;

        const ex = r.position.x;
        const ez = r.position.z;
        this._applyBlastDamage(r, ex, ez);
        this._blastWorldBodies(r, ex, ez);

        // Wygląd wybuchu (src/3d/rockets/effects.js): głowica na polu tarczy — receptura
        // tarczy (pole ma też własne wstęgi i bańkę), na kadłubie — kula ognia z nośnikiem
        // trafionego kadłuba, w próżni (koniec zasięgu, punkt) — w układzie rakiety;
        // Supernowa — implozja, błysk, fala, pozostałość.
        const hitShield = !!r.hitShield;
        r.hitShield = false;
        const hitEntity = r.didImpactDamage && r.target && !r.target._isPositionTarget ? r.target : null;
        if (this.effects) this.effects.onDetonate(r, ex, ez, hitEntity, hitShield);
        r.target = null;
        r.shooter = null;
    }

    /* ─────────────────── DISPOSE ─────────────────── */

    dispose() {
        instance = null;
        for (let i = this._qN - 1; i >= 0; i--) this._qRemove(i);
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
