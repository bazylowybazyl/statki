/**
 * destruction3D.js — Silnik destrukcji obiektów 3D
 *
 * Architektura 3-tier:
 *   T1  GPU Shatter Shader   — każdy trójkąt leci od centroidu, 0ms CPU
 *   T2  Hierarchical Dismantle — sekcje pirackiej stacji odpadają kolejno
 *   T3  Implosion Vaporize   — LOD dla ringu / masowych destrukcji
 *
 * Inicjalizacja (np. w index.html lub core3D):
 *   import { Destruction3D } from './src/vfx/destruction3D.js';
 *   Destruction3D.init({ scene, getTime, reactorFactory, shockwaveManager });
 *
 * W pętli renderowania:
 *   Destruction3D.update(worldTime);
 *
 * Destrukcja obiektu:
 *   Destruction3D.shatter(stationMesh, { sparks: 600, flash: 1.0,
 *       onImpactStart: () => audio.play('boom') });
 *
 * Hierarchical (Tier 2):
 *   Destruction3D.dismantleSection(station, 'habitat_ring', { detachVelocity:[0,50,0] });
 *
 * Mass implosion (Tier 3):
 *   Destruction3D.implodeMass([b1, b2, b3], { staggerMs: 80 });
 *
 * Audio / event hooks:
 *   Destruction3D.on('shatterStart', ({ mesh, worldTime }) => { ... });
 */

import * as THREE from 'three';
import { bakeShatterGeometry, bakeShatterMesh } from './shatterShaderBake.js';
import { createShatterMaterial } from './shatterMaterial.js';
import { DebrisManager } from './destructionDebrisManager.js';

// ── Implosion (Tier 3) GLSL ─────────────────────────────────────────────────
const IMPLODE_VERT = /* glsl */`
uniform float uTime;
uniform float uStartTime;
uniform float uDuration;

varying float vAlpha;

float noise3(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
}

void main() {
    float t  = clamp((uTime - uStartTime) / max(0.001, uDuration), 0.0, 1.0);
    float n  = noise3(position * 0.01) * 2.0 - 1.0;
    float disp = sin(t * 3.14159 * 2.0 + n * 4.0) * 80.0 * (1.0 - t);
    vec3  pos  = position + normal * disp;
    pos       *= 1.0 - t * t;               // scale to zero
    vAlpha     = 1.0 - t;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;
const IMPLODE_FRAG = /* glsl */`
uniform vec3  uColor;
varying float vAlpha;
void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(uColor * vAlpha * 1.5, vAlpha);
}
`;

// ── Dismantle section fake-physics state ─────────────────────────────────────
class DismantleSection {
    constructor(mesh, vel, angVel, scene, opts) {
        this.mesh      = mesh;
        this.vel       = vel.clone();    // THREE.Vector3
        this.angVel    = angVel.clone(); // THREE.Euler or Vector3 for axis
        this.drag      = opts.drag ?? 0.985;          // per-frame drag
        this.angularDrag = opts.angularDrag ?? 0.986;
        this.launchRamp = Math.max(0.02, opts.launchRamp ?? 0.22);
        this.rotationDelay = Math.max(0, opts.rotationDelay ?? Math.min(0.72, (opts.delayedShatter ?? 1.0) * 0.55));
        this.maxRotationBeforeShatter = Math.max(0, opts.maxRotationBeforeShatter ?? 0.18);
        this.alive     = true;
        this.scene     = scene;
        this.opts      = opts;
        this.age       = 0;
        this.shatterAt = opts.delayedShatter ?? 1.0;
        this.shattered = false;
        this.preShatterBursts = Math.max(0, opts.preShatterBursts ?? 0);
        this.preShatterWindow = Math.min(this.shatterAt, opts.preShatterWindow ?? Math.max(0.22, this.shatterAt * 0.58));
        this._burstIndex = 0;
        this._rotTravel = new THREE.Vector3();
        opts.onDetach?.();
    }

    update(dt) {
        if (!this.alive) return;
        this.age += dt;

        // Apply velocity + drag with a soft launch ramp to avoid first-frame jump.
        const launchT = Math.min(1.0, this.age / this.launchRamp);
        const launchEase = launchT * launchT * (3.0 - 2.0 * launchT);
        this.mesh.position.addScaledVector(this.vel, dt * launchEase);
        this.vel.multiplyScalar(Math.pow(this.drag, dt * 60));

        // Let the chunk drift first; only add a tiny capped tumble shortly before shatter.
        const rotSpan = Math.max(0.04, this.shatterAt - this.rotationDelay);
        const rotT = this.age <= this.rotationDelay ? 0.0 : Math.min(1.0, (this.age - this.rotationDelay) / rotSpan);
        const rotEase = rotT * rotT * (3.0 - 2.0 * rotT);
        const rotStepX = _clampSignedStep(this._rotTravel.x, this.angVel.x * dt * launchEase * rotEase, this.maxRotationBeforeShatter);
        const rotStepY = _clampSignedStep(this._rotTravel.y, this.angVel.y * dt * launchEase * rotEase, this.maxRotationBeforeShatter);
        const rotStepZ = _clampSignedStep(this._rotTravel.z, this.angVel.z * dt * launchEase * rotEase, this.maxRotationBeforeShatter);
        this.mesh.rotation.x += rotStepX;
        this.mesh.rotation.y += rotStepY;
        this.mesh.rotation.z += rotStepZ;
        this._rotTravel.x += rotStepX;
        this._rotTravel.y += rotStepY;
        this._rotTravel.z += rotStepZ;
        this.angVel.multiplyScalar(Math.pow(this.angularDrag, dt * 60));

        if (!this.shattered && this.preShatterBursts > 0) {
            const burstStart = Math.max(0.04, this.shatterAt - this.preShatterWindow);
            while (this._burstIndex < this.preShatterBursts) {
                const tNorm = (this._burstIndex + 1) / (this.preShatterBursts + 1);
                const burstTime = burstStart + this.preShatterWindow * tNorm;
                if (this.age < burstTime) break;
                _spawnDetachBurst(this.mesh, this.opts, this._burstIndex, this.preShatterBursts);
                this._burstIndex++;
            }
        }

        // Trigger shatter on self after delayedShatter seconds
        if (!this.shattered && this.age >= this.shatterAt) {
            this.shattered = true;
            // Stop physical motion — GPU shader handles all movement from here
            this.vel.set(0, 0, 0);
            this.angVel.set(0, 0, 0);
            _applyShatterToHierarchy(this.mesh, this.opts, _worldTime);
        }
    }
}

// ── Module state ──────────────────────────────────────────────────────────────
let   _scene           = null;
let   _worldTime       = 0;
let   _reactorFactory  = null;       // createReactorBlowFactory result
let   _shockwaveMgr    = null;       // Shockwave3DManager instance

const _debrisMgr       = new DebrisManager();
/** @type {Set<THREE.Mesh>} tracked shatter meshes — avoids full scene traverse */
const _shatterMeshes   = new Set();
/** @type {DismantleSection[]} */
const _dismantling     = [];
/** @type {Array<{time:number, fn:Function}>} */
const _pendingCallbacks = [];
/** @type {Map<string, Function[]>} */
const _listeners       = new Map();

// LOD guard: if too many explosions in short window → downgrade
let   _burstCount      = 0;
let   _burstWindowEnd  = 0;
const BURST_LIMIT      = 3;
const BURST_WINDOW     = 0.5;  // seconds

// ── DESTRUCTION_CONFIG ────────────────────────────────────────────────────────
export const DESTRUCTION_CONFIG = {
    // Tier 1 defaults
    duration:        1.8,
    debrisLifetime:  60.0,
    fragmentDrift:   950,
    spin:            4.0,
    shrink:          0.35,
    heatGlow:        1.0,
    gravity:         0,
    staggerWindow:   0.55,
    burstStrength:   0.65,
    // VFX defaults
    sparks:          600,
    flash:           1.0,
    shockwave:       true,
    // Tier 3 defaults
    implodeDuration: 1.2,
    // LOD distance threshold (Tier 3 above)
    lodDistance:     40000,
};

// ── Presets per target type ───────────────────────────────────────────────────
export const DESTRUCTION_PRESETS = {
    pirate: {
        fragmentDrift:  600,
        spin:           3.5,
        heatGlow:       1.4,
        staggerWindow:  0.40,
        burstStrength:  0.55,
        flashColor:     new THREE.Color(1.0, 0.6, 0.2),
        sparks:         900,
    },
    civilian: {
        fragmentDrift:  900,
        spin:           5.0,
        heatGlow:       0.8,
        staggerWindow:  0.65,
        burstStrength:  0.78,
        flashColor:     new THREE.Color(0.8, 0.9, 1.0),
        sparks:         500,
    },
    ring: {
        fragmentDrift:  500,
        spin:           2.5,
        gravity:        120,
        heatGlow:       0.6,
        staggerWindow:  0.75,
        burstStrength:  0.48,
        flashColor:     new THREE.Color(1.0, 0.8, 0.4),
        sparks:         250,
    },
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Schedule an audio callback to fire at worldTime + delayS */
function _scheduleCallback(delayS, fn) {
    _pendingCallbacks.push({ time: _worldTime + delayS, fn });
}

/** Apply shatter (T1) to a single THREE.Mesh */
function _shatterSingle(mesh, opts, worldTime) {
    if (!mesh.isMesh) return;

    // Bake geometry (cached after first call)
    const bakedGeo = bakeShatterGeometry(mesh.geometry);

    // Extract source material diffuse texture if available
    const srcMat = mesh.material;
    const map    = srcMat && !Array.isArray(srcMat) ? (srcMat.map ?? null) : null;
    const color  = srcMat && !Array.isArray(srcMat)
        ? (srcMat.color ?? new THREE.Color(0.55, 0.6, 0.65))
        : new THREE.Color(0.55, 0.6, 0.65);

    // Swap geometry and material
    mesh.__originalGeometry = mesh.geometry;
    mesh.__originalMaterial = mesh.material;
    mesh.geometry = bakedGeo;

    const shatterMat = createShatterMaterial({
        map,
        color,
        duration:       opts.duration      ?? DESTRUCTION_CONFIG.duration,
        debrisLifetime: opts.debrisLifetime ?? DESTRUCTION_CONFIG.debrisLifetime,
        fragmentDrift:  opts.fragmentDrift  ?? DESTRUCTION_CONFIG.fragmentDrift,
        spin:           opts.spin           ?? DESTRUCTION_CONFIG.spin,
        shrink:         opts.shrink         ?? DESTRUCTION_CONFIG.shrink,
        heatGlow:       opts.heatGlow       ?? DESTRUCTION_CONFIG.heatGlow,
        gravity:        opts.gravity        ?? DESTRUCTION_CONFIG.gravity,
        staggerWindow:  opts.staggerWindow  ?? DESTRUCTION_CONFIG.staggerWindow,
        burstStrength:  opts.burstStrength  ?? DESTRUCTION_CONFIG.burstStrength,
    });
    mesh.material = shatterMat;

    // Trigger!
    shatterMat.uniforms.uShatterTime.value = worldTime;
    shatterMat.uniforms.uTime.value        = worldTime;

    // Register for cleanup + uTime tracking
    const expiry = worldTime + (opts.debrisLifetime ?? DESTRUCTION_CONFIG.debrisLifetime) + 2;
    if (!opts.__skipCleanup) _debrisMgr.register(mesh, _scene, expiry);
    _shatterMeshes.add(mesh);

    const burstPulses = Math.max(0, opts.burstPulses ?? 0);
    if (burstPulses > 0) {
        const worldPos = _meshWorldPos(mesh);
        const burstSpacing = Math.max(0.04, opts.burstSpacing ?? 0.16);
        const burstSize = opts.burstSize ?? 14;
        for (let i = 0; i < burstPulses; i++) {
            _scheduleCallback(i * burstSpacing, () => {
                if (!_reactorFactory || typeof window === 'undefined' || !window.overlay3D?.spawn) return;
                const radius = 10 + i * 8;
                const angle = Math.random() * Math.PI * 2;
                const burstFx = _reactorFactory({
                    x: worldPos.x + Math.cos(angle) * radius,
                    y: worldPos.z + Math.sin(angle) * radius,
                    size: burstSize * (1.0 + i * 0.22),
                    profile: 'fighter',
                });
                if (burstFx) window.overlay3D.spawn(burstFx);
            });
        }
    }
}

/** Build mesh world position */
function _meshWorldPos(mesh) {
    const p = new THREE.Vector3();
    mesh.getWorldPosition(p);
    return p;
}

function _clampSignedStep(current, step, limit) {
    if (limit <= 0 || step === 0) return 0;
    const next = current + step;
    if (next > limit) return limit - current;
    if (next < -limit) return -limit - current;
    return step;
}

function _detachWithCenteredPivot(object3D) {
    if (!_scene || !object3D) return object3D;
    object3D.updateWorldMatrix(true, true);
    const bbox = new THREE.Box3().setFromObject(object3D);
    const center = new THREE.Vector3();
    if (!bbox.isEmpty()) bbox.getCenter(center);
    else object3D.getWorldPosition(center);

    _scene.attach(object3D);

    const pivot = new THREE.Group();
    pivot.name = `${object3D.name || 'detached'}__pivot`;
    pivot.position.copy(center);
    _scene.add(pivot);

    object3D.position.sub(center);
    pivot.add(object3D);
    return pivot;
}

function _computePlanarDetachVelocity(centerPos, originPos, speed, planarBias = 0.12) {
    const outDir = new THREE.Vector3().subVectors(centerPos, originPos);
    outDir.z *= planarBias;
    if (outDir.lengthSq() < 1e-4) {
        outDir.set(Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * planarBias);
    }
    outDir.normalize();
    return outDir.multiplyScalar(speed);
}

function _spawnDetachBurst(object3D, opts, burstIndex = 0, burstCount = 1) {
    if (!_reactorFactory || typeof window === 'undefined' || !window.overlay3D?.spawn) return;
    const worldPos = _meshWorldPos(object3D);
    const phase = burstCount > 0 ? (burstIndex / Math.max(1, burstCount - 1)) : 0;
    const jitterR = (opts.preBurstRadius ?? 12) * (1.0 + phase * 0.6);
    const angle = Math.random() * Math.PI * 2;
    const fx = _reactorFactory({
        x: worldPos.x + Math.cos(angle) * jitterR,
        y: worldPos.z + Math.sin(angle) * jitterR,
        size: (opts.preBurstSize ?? 12) * (1.0 + phase * 0.35),
        profile: 'fighter',
    });
    if (fx) window.overlay3D.spawn(fx);
}

function _applyShatterToHierarchy(rootObject, opts, worldTime) {
    let meshCount = 0;
    rootObject.traverse(child => {
        if (!child.isMesh) return;
        meshCount++;
        _shatterSingle(child, { ...opts, __skipCleanup: true }, worldTime);
    });
    if (meshCount > 0) {
        const expiry = worldTime + (opts.debrisLifetime ?? DESTRUCTION_CONFIG.debrisLifetime) + 2;
        _debrisMgr.register(rootObject, _scene, expiry);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────
export const Destruction3D = {

    /**
     * Must be called once before using any other method.
     * @param {object} cfg
     * @param {THREE.Scene}  cfg.scene
     * @param {Function}     [cfg.reactorFactory]   createReactorBlowFactory(scene) return value
     * @param {object}       [cfg.shockwaveManager] Shockwave3DManager instance
     */
    init({ scene, reactorFactory = null, shockwaveManager = null }) {
        _scene          = scene;
        _reactorFactory = reactorFactory;
        _shockwaveMgr   = shockwaveManager;
    },

    /**
     * Pre-bake all meshes in a hierarchy (call after loading GLB models).
     * Amortises bake cost — no visible lag at destruction time.
     */
    prebake(rootObject3D) {
        bakeShatterMesh(rootObject3D);
    },

    // ── Tier 1: GPU Shatter ────────────────────────────────────────────────

    /**
     * Shatter a mesh (or Group/Object3D with Mesh children).
     *
     * @param {THREE.Object3D} rootMesh
     * @param {object} opts
     * @param {number}   [opts.duration]
     * @param {number}   [opts.debrisLifetime]
     * @param {number}   [opts.fragmentDrift]
     * @param {number}   [opts.spin]
     * @param {number}   [opts.shrink]
     * @param {number}   [opts.heatGlow]
     * @param {number}   [opts.gravity]
     * @param {number}   [opts.flash]
     * @param {THREE.Color} [opts.flashColor]
     * @param {number}   [opts.sparks]
     * @param {boolean}  [opts.shockwave]
     * @param {string}   [opts.preset]     'pirate'|'civilian'|'ring'
     * @param {Function} [opts.onImpactStart]   t=0.0
     * @param {Function} [opts.onShatterPeak]   t=duration*0.30
     * @param {Function} [opts.onCollapseEnd]   t=duration
     * @param {Function} [opts.onSettle]        t=duration*1.5
     * @param {string}   [opts.mode]  'auto'|'shatter'|'implode'
     */
    shatter(rootMesh, opts = {}) {
        if (!_scene) { console.warn('Destruction3D: call init() first'); return; }

        // Merge preset
        const preset = opts.preset ? (DESTRUCTION_PRESETS[opts.preset] ?? {}) : {};
        opts = { ...preset, ...opts };

        // LOD / burst guard
        const now = _worldTime;
        if (now > _burstWindowEnd) {
            _burstCount    = 0;
            _burstWindowEnd = now + BURST_WINDOW;
        }
        _burstCount++;

        const forceImplode = _burstCount > BURST_LIMIT || opts.mode === 'implode';
        if (forceImplode || opts.mode === 'implode') {
            this._implodeSingle(rootMesh, opts);
            return;
        }

        // --- T1 Shatter ---
        const worldPos = _meshWorldPos(rootMesh);

        // Shatter every Mesh descendant under one cleanup root
        _applyShatterToHierarchy(rootMesh, opts, now);

        // VFX
        this._spawnVFX(worldPos, opts);

        // Audio callbacks
        const dur = opts.duration ?? DESTRUCTION_CONFIG.duration;
        opts.onImpactStart?.();
        _scheduleCallback(dur * 0.30, () => opts.onShatterPeak?.());
        _scheduleCallback(dur,        () => opts.onCollapseEnd?.());
        _scheduleCallback(dur * 1.5,  () => opts.onSettle?.());

        this.emit('shatterStart', { mesh: rootMesh, worldTime: now });
    },

    // ── Tier 2: Hierarchical Dismantle ────────────────────────────────────

    /**
     * Detach a named section of a station and throw it outward, then shatter.
     *
     * @param {THREE.Object3D} stationRoot
     * @param {string}         sectionName  Name of child object to detach
     * @param {object} opts
     * @param {number[]}  [opts.detachVelocity]   [vx, vy, vz] initial velocity
     * @param {number}    [opts.spin]              tumble rate rad/s
     * @param {number}    [opts.delayedShatter]    seconds until section shatters (default 1.0)
     * @param {Function}  [opts.onDetach]          fires immediately on detach
     * @param {Function}  [opts.onCollapseEnd]     fires when section shatters
     */
    dismantleSection(stationRoot, sectionName, opts = {}) {
        if (!_scene) { console.warn('Destruction3D: call init() first'); return; }

        // Find section by name in hierarchy
        let section = null;
        stationRoot.traverse(child => {
            if (!section && child.name === sectionName) section = child;
        });
        if (!section) {
            console.warn(`Destruction3D.dismantleSection: "${sectionName}" not found in`, stationRoot.name);
            return;
        }

        // Detach to centered pivot so rotation doesn't orbit around an off-center origin.
        const detachedRoot = _detachWithCenteredPivot(section);

        const stationCenter = new THREE.Vector3();
        stationRoot.getWorldPosition(stationCenter);
        const detachedCenter = _meshWorldPos(detachedRoot);

        const baseSpeed = opts.velocity ?? 115;
        const vel = Array.isArray(opts.detachVelocity)
            ? new THREE.Vector3(opts.detachVelocity[0] ?? 0, opts.detachVelocity[1] ?? 0, opts.detachVelocity[2] ?? 0)
            : _computePlanarDetachVelocity(detachedCenter, stationCenter, baseSpeed, 0.10);
        vel.z += (Math.random() - 0.5) * baseSpeed * 0.006;

        const spinRate = opts.spin ?? 0.12;
        const angVel = new THREE.Vector3(
            (Math.random() - 0.5) * spinRate,
            (Math.random() - 0.5) * spinRate,
            (Math.random() - 0.5) * spinRate
        );

        const ds = new DismantleSection(detachedRoot, vel, angVel, _scene, {
            ...opts,
            delayedShatter: opts.delayedShatter ?? 1.15,
            drag: opts.drag ?? 0.992,
            angularDrag: opts.angularDrag ?? 0.993,
            launchRamp: opts.launchRamp ?? 0.16,
            rotationDelay: opts.rotationDelay ?? 0.46,
            maxRotationBeforeShatter: opts.maxRotationBeforeShatter ?? 0.12,
            staggerWindow: opts.staggerWindow ?? 0.65,
            burstStrength: opts.burstStrength ?? 0.78,
            burstPulses: opts.burstPulses ?? 0,
            preShatterBursts: opts.preShatterBursts ?? 4,
            preShatterWindow: opts.preShatterWindow ?? 0.62,
            preBurstSize: opts.preBurstSize ?? 13,
            preBurstRadius: opts.preBurstRadius ?? 10,
            onCollapseEnd: () => opts.onCollapseEnd?.(),
        });
        _dismantling.push(ds);

        this.emit('dismantleSection', { section: detachedRoot, sectionName, worldTime: _worldTime });
    },

    // ── Progressive Damage Chunk Detachment ───────────────────────────────

    /**
     * Detach a random mesh chunk from a station at a damage threshold.
     * Prefers small/peripheral meshes so the main hull stays visible longest.
     * Chunk flies away under fake physics, then shatters via GPU shader.
     *
     * @param {THREE.Object3D} stationRoot  Station root object
     * @param {object} [opts]
     * @param {number} [opts.velocity=420]    Initial outward speed (world units/s)
     * @param {number} [opts.shatterDelay=0.65] Seconds of flight before chunk shatters
     */
    detachChunk(stationRoot, opts = {}) {
        if (!_scene || !stationRoot) return;

        // ── 1. Collect non-detached mesh descendants ──────────────────────
        const candidates = [];
        stationRoot.traverse(child => {
            if (!child.isMesh || child.__detached || !child.geometry) return;
            if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
            const r = child.geometry.boundingSphere?.radius ?? 1;
            candidates.push({ mesh: child, r });
        });
        if (!candidates.length) return;

        // ── 2. Prefer small/peripheral meshes (details, not hull) ─────────
        candidates.sort((a, b) => a.r - b.r);
        // Drop the single largest (main hull) from the pool unless it's the only option
        const pool = candidates.length > 1 ? candidates.slice(0, -1) : candidates;
        // Pick randomly from the smaller half so tiny detail pieces go first
        const halfLen = Math.max(1, Math.ceil(pool.length * 0.6));
        const pick    = pool[Math.floor(Math.random() * halfLen)];
        const mesh    = pick.mesh;
        mesh.__detached = true;

        // ── 3. Capture world transform before detaching ───────────────────
        mesh.updateWorldMatrix(true, false);
        const worldPos   = new THREE.Vector3();
        const worldQuat  = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        mesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);

        mesh.removeFromParent();
        mesh.position.copy(worldPos);
        mesh.quaternion.copy(worldQuat);
        mesh.scale.copy(worldScale);
        _scene.add(mesh);
        const detachedRoot = _detachWithCenteredPivot(mesh);
        const detachedCenter = _meshWorldPos(detachedRoot);

        // ── 4. Velocity: outward from station centre + upward bias ────────
        const stationCenter = new THREE.Vector3();
        stationRoot.getWorldPosition(stationCenter);
        const baseSpeed = (opts.velocity ?? 170) * (0.75 + Math.random() * 0.45);
        const vel = _computePlanarDetachVelocity(detachedCenter, stationCenter, baseSpeed, 0.12);
        vel.z += (Math.random() - 0.5) * baseSpeed * 0.008;

        const spinRate = 0.16 + Math.random() * 0.16;
        const angVel = new THREE.Vector3(
            (Math.random() - 0.5) * spinRate,
            (Math.random() - 0.5) * spinRate,
            (Math.random() - 0.5) * spinRate
        );

        const shatterDelay = opts.shatterDelay ?? 0.95;

        // Normalize fragmentDrift so world-space displacement stays meaningfully
        // outside the source hull, even for large station chunks.
        // regardless of model geometry scale (worldScale already captured above).
        const modelScale = Math.max(0.001, worldScale.x);
        const targetWorldDrift = 320;
        const normalizedDrift  = targetWorldDrift / modelScale;

        // ── 5. Hand off to DismantleSection fake physics ──────────────────
        // After shatterDelay, the chunk shatters via GPU shader
        const ds = new DismantleSection(detachedRoot, vel, angVel, _scene, {
            delayedShatter: shatterDelay,
            // Chunk shatter opts — quicker, tighter than full station collapse
            duration:       1.05,
            debrisLifetime: 12,
            fragmentDrift:  normalizedDrift,
            spin:           5.0,
            heatGlow:       0.5,
            shrink:         0.55,
            staggerWindow:  0.72,
            burstStrength:  0.95,
            burstPulses:    0,
            preShatterBursts: 4,
            preShatterWindow: 0.58,
            preBurstSize:   15,
            preBurstRadius: 12,
            drag:           0.993,
            angularDrag:    0.993,
            launchRamp:     0.14,
            rotationDelay:  0.42,
            maxRotationBeforeShatter: 0.14,
        });
        _dismantling.push(ds);

        // ── 6. Small spark burst at the breakaway point ───────────────────
        if (_reactorFactory) {
            const fx = _reactorFactory({
                x:       detachedCenter.x,
                y:       detachedCenter.z,   // top-down: world-Z maps to reactorblow Y
                size:    18 + Math.random() * 18,
                profile: 'fighter',
            });
            if (fx && typeof window !== 'undefined' && window.overlay3D?.spawn) {
                window.overlay3D.spawn(fx);
            }
        }

        this.emit('chunkDetached', { mesh: detachedRoot, worldPos: detachedCenter, worldTime: _worldTime });
    },

    // ── Tier 3: Mass Implosion ─────────────────────────────────────────────

    /**
     * Implode multiple meshes with staggered timing (no debris, LOD).
     * @param {THREE.Object3D[]} meshes
     * @param {object} opts
     * @param {number}  [opts.staggerMs]       ms between each explosion (default 80)
     * @param {boolean} [opts.sharedShockwave] one big shockwave instead of N small ones
     */
    implodeMass(meshes, opts = {}) {
        if (!_scene) { console.warn('Destruction3D: call init() first'); return; }

        const staggerS = (opts.staggerMs ?? 80) / 1000;
        const center   = new THREE.Vector3();
        for (const m of meshes) center.add(_meshWorldPos(m));
        center.divideScalar(Math.max(1, meshes.length));

        meshes.forEach((mesh, idx) => {
            const delay = idx * staggerS;
            _scheduleCallback(delay, () => {
                this._implodeSingle(mesh, opts);
            });
        });

        if (opts.sharedShockwave !== false && _shockwaveMgr) {
            _shockwaveMgr.spawn(center.x, center.y, center.z, meshes.length * 800, 2.0, 0x55ffff);
        }

        this.emit('implodeMass', { count: meshes.length, worldTime: _worldTime });
    },

    // ── Update loop ────────────────────────────────────────────────────────

    /**
     * Call once per frame from the main render loop.
     * @param {number} worldTime   current world time in seconds
     * @param {number} dt          frame delta time in seconds
     */
    update(worldTime, dt = 0.016) {
        _worldTime = worldTime;

        // Update uTime on tracked shatter meshes (O(active) not O(all scene objects))
        for (const mesh of _shatterMeshes) {
            if (!mesh.parent) {
                _shatterMeshes.delete(mesh);  // already removed from scene
                continue;
            }
            if (mesh.material?.uniforms?.uTime) {
                mesh.material.uniforms.uTime.value = worldTime;
            }
        }

        // Debris cleanup
        _debrisMgr.update(worldTime);

        // Dismantle fake physics
        for (let i = _dismantling.length - 1; i >= 0; i--) {
            const ds = _dismantling[i];
            ds.update(dt);
            if (ds.age > (ds.opts.delayedShatter ?? 0.8) + (ds.opts.debrisLifetime ?? 60) + 2) {
                _dismantling.splice(i, 1);
            }
        }

        // Pending callbacks
        for (let i = _pendingCallbacks.length - 1; i >= 0; i--) {
            const cb = _pendingCallbacks[i];
            if (worldTime >= cb.time) {
                cb.fn();
                _pendingCallbacks.splice(i, 1);
            }
        }
    },

    // ── EventEmitter ──────────────────────────────────────────────────────

    /**
     * Subscribe to destruction events.
     * Events: 'shatterStart' | 'dismantleSection' | 'implodeMass' | 'collapseEnd'
     */
    on(event, fn) {
        if (!_listeners.has(event)) _listeners.set(event, []);
        _listeners.get(event).push(fn);
    },

    off(event, fn) {
        const arr = _listeners.get(event);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
    },

    emit(event, data) {
        for (const fn of (_listeners.get(event) ?? [])) fn(data);
    },

    // ── Internal VFX helpers ───────────────────────────────────────────────

    _spawnVFX(worldPos, opts) {
        const flash  = opts.flash    ?? DESTRUCTION_CONFIG.flash;
        const sparks = opts.sparks   ?? DESTRUCTION_CONFIG.sparks;
        const doShock = opts.shockwave ?? DESTRUCTION_CONFIG.shockwave;

        // Sparks via reactorFactory
        if (_reactorFactory && sparks > 0) {
            const size = Math.sqrt(sparks) * 6;
            const fx = _reactorFactory({
                x:       worldPos.x,
                y:       worldPos.z,   // reactorblow uses top-down XY → Z maps to Y in world
                size,
                profile: 'capital',
            });
            // Register with overlay so the effect gets update() called each frame
            if (fx && typeof window !== 'undefined' && window.overlay3D?.spawn) {
                window.overlay3D.spawn(fx);
            }
        }

        // Shockwave
        if (doShock && _shockwaveMgr) {
            _shockwaveMgr.spawn(worldPos.x, worldPos.y, worldPos.z, 1200, 1.8, 0x55ffff);
        }

        // Flash: inject into global PP uniform if available
        if (flash > 0 && typeof window !== 'undefined' && window.__ppFlash !== undefined) {
            window.__ppFlash = Math.max(window.__ppFlash ?? 0, flash);
        }
    },

    _implodeSingle(mesh, opts) {
        const worldPos = _meshWorldPos(mesh);
        const dur = opts.implodeDuration ?? DESTRUCTION_CONFIG.implodeDuration;

        mesh.traverse(child => {
            if (!child.isMesh) return;
            const col = (child.material?.color) ?? new THREE.Color(0.6, 0.65, 0.7);
            child.__originalMaterial = child.material;
            child.material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime:      { value: _worldTime },
                    uStartTime: { value: _worldTime },
                    uDuration:  { value: dur },
                    uColor:     { value: col.clone() },
                },
                vertexShader:   IMPLODE_VERT,
                fragmentShader: IMPLODE_FRAG,
                transparent:    true,
                depthWrite:     false,
            });
            _shatterMeshes.add(child);   // track for uTime updates
        });

        const expiry = _worldTime + dur + 0.5;
        _debrisMgr.register(mesh, _scene, expiry);
        this._spawnVFX(worldPos, { ...opts, sparks: Math.min(opts.sparks ?? 250, 250) });

        this.emit('shatterStart', { mesh, worldTime: _worldTime });
    },

    /** Update all implode material uTime uniforms (called from main update). */
    _updateImplodeUniforms(worldTime) {
        // Handled in general traverse above
    },

    // ── Utilities ─────────────────────────────────────────────────────────

    /**
     * Mark a station mesh for destruction on death. Call once per station model load.
     * Pre-bakes geometry so no lag at actual destruction time.
     * @param {THREE.Object3D} rootMesh
     * @param {'pirate'|'civilian'|'ring'|'auto'} [tier]
     */
    markDestructible(rootMesh, tier = 'auto') {
        this.prebake(rootMesh);
        rootMesh.__destructionTier = tier;
    },

    /**
     * Dispose all active effects and clean up. Call on scene unload.
     */
    dispose() {
        _debrisMgr.disposeAll();
        _shatterMeshes.clear();
        _dismantling.length     = 0;
        _pendingCallbacks.length = 0;
        _listeners.clear();
    },
};
