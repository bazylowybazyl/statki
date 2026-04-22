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
import { PanelShardManager } from './panelShardManager.js';
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TMP_OUT = new THREE.Vector3();
const TMP_TANGENT = new THREE.Vector3();
const TMP_SIZE_BOX = new THREE.Box3();
const TMP_SIZE_SPHERE = new THREE.Sphere();
const TMP_WORLD_POS = new THREE.Vector3();
const TMP_WORLD_SCALE = new THREE.Vector3();
const TMP_WORLD_QUAT = new THREE.Quaternion();
const TMP_SHELL_DIR = new THREE.Vector3();
const TMP_SHELL_AXIS_A = new THREE.Vector3();
const TMP_SHELL_AXIS_B = new THREE.Vector3();
const TMP_SHELL_NORMAL_MATRIX = new THREE.Matrix3();

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
        this.opts.onMotion?.(this.mesh, this.age, dt, this.vel, this.angVel);

        if (!this.shattered && this.preShatterBursts > 0) {
            const burstStart = Math.max(0.04, this.shatterAt - this.preShatterWindow);
            while (this._burstIndex < this.preShatterBursts) {
                const tNorm = (this._burstIndex + 1) / (this.preShatterBursts + 1);
                const burstTime = burstStart + this.preShatterWindow * tNorm;
                if (this.age < burstTime) break;
                _spawnDetachBurst(this.mesh, this.opts, this._burstIndex, this.preShatterBursts);
                _applyBurstImpulse(this.mesh, this.vel, this.angVel, this.opts, this._burstIndex, this.preShatterBursts);
                this._burstIndex++;
            }
        }

        // Trigger shatter on self after delayedShatter seconds
        if (!this.shattered && this.age >= this.shatterAt) {
            this.shattered = true;
            const breakupVel = this.vel.clone();
            const breakupAng = this.angVel.clone();
            // Stop physical motion — GPU shader handles all movement from here
            this.vel.set(0, 0, 0);
            this.angVel.set(0, 0, 0);
            _triggerHierarchyBreakup(this.mesh, this.opts, _worldTime, breakupVel, breakupAng);
        }
    }
}

// ── Module state ──────────────────────────────────────────────────────────────
let   _scene           = null;
let   _worldTime       = 0;
let   _reactorFactory  = null;       // createReactorBlowFactory result
let   _shockwaveMgr    = null;       // Shockwave3DManager instance

const _debrisMgr       = new DebrisManager();
let   _panelShardMgr   = null;
/** @type {Set<THREE.Mesh>} tracked shatter meshes — avoids full scene traverse */
const _shatterMeshes   = new Set();
/** @type {DismantleSection[]} */
const _dismantling     = [];
/** @type {Array<object>} */
const _rootFades       = [];
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
    debrisStyle:     'triangles',
    shardScale:      1.0,
    shardLifetime:   3.1,
    emissiveShardRatio: 0.16,
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
        shardScale:     1.08,
        shardLifetime:  3.2,
        emissiveShardRatio: 0.12,
        flashColor:     new THREE.Color(1.0, 0.6, 0.2),
        sparks:         900,
    },
    civilian: {
        fragmentDrift:  900,
        spin:           5.0,
        heatGlow:       0.8,
        staggerWindow:  0.65,
        burstStrength:  0.78,
        shardScale:     1.0,
        shardLifetime:  3.0,
        emissiveShardRatio: 0.24,
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
        const overlayPos = _meshOverlayPos(mesh);
        const burstSpacing = Math.max(0.04, opts.burstSpacing ?? 0.16);
        const burstSize = opts.burstSize ?? 14;
        for (let i = 0; i < burstPulses; i++) {
            _scheduleCallback(i * burstSpacing, () => {
                if (!_reactorFactory || typeof window === 'undefined' || !window.overlay3D?.spawn) return;
                const radius = 10 + i * 8;
                const angle = Math.random() * Math.PI * 2;
                const burstFx = _reactorFactory({
                    x: overlayPos.x + Math.cos(angle) * radius,
                    y: overlayPos.y + Math.sin(angle) * radius,
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

function _meshOverlayPos(mesh) {
    const p = _meshWorldPos(mesh);
    return { x: p.x, y: -p.y, worldPos: p };
}

function _estimateObjectWorldRadius(object3D) {
    if (!object3D) return 1;
    TMP_SIZE_BOX.setFromObject(object3D);
    if (TMP_SIZE_BOX.isEmpty()) return 1;
    TMP_SIZE_BOX.getBoundingSphere(TMP_SIZE_SPHERE);
    return Math.max(1, TMP_SIZE_SPHERE.radius || 1);
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
    const overlayPos = _meshOverlayPos(object3D);
    const worldRadius = _estimateObjectWorldRadius(object3D);
    const phase = burstCount > 0 ? (burstIndex / Math.max(1, burstCount - 1)) : 0;
    const jitterR = (opts.preBurstRadius ?? 12) * (1.0 + phase * 0.6);
    const angle = Math.random() * Math.PI * 2;
    const burstSize = (opts.preBurstSize ?? 12) * (1.0 + phase * 0.35) * THREE.MathUtils.clamp(0.9 + worldRadius * 0.018, 1.0, 2.6);
    const profile = (worldRadius > 58 || phase > 0.45) ? 'capital' : 'fighter';
    const fx = _reactorFactory({
        x: overlayPos.x + Math.cos(angle) * jitterR,
        y: overlayPos.y + Math.sin(angle) * jitterR,
        size: burstSize,
        profile,
    });
    if (fx) window.overlay3D.spawn(fx);
}

function _spawnBreakupBurst(object3D, opts = {}, kind = 'breakup') {
    if (!_reactorFactory || typeof window === 'undefined' || !window.overlay3D?.spawn || !object3D) return;
    const overlayPos = _meshOverlayPos(object3D);
    const worldRadius = _estimateObjectWorldRadius(object3D);
    const profile = worldRadius > 72 || kind !== 'carrier' ? 'capital' : 'fighter';
    const baseSize =
        kind === 'shellFinal' ? 18 :
        kind === 'shellSplit' ? 20 :
        kind === 'carrier' ? 16 : 14;
    const sizeMul =
        kind === 'shellFinal' ? 1.55 :
        kind === 'shellSplit' ? 1.35 :
        kind === 'carrier' ? 1.18 : 1.0;
    const fx = _reactorFactory({
        x: overlayPos.x,
        y: overlayPos.y,
        size: (opts.breakupBurstSize ?? baseSize) * sizeMul * THREE.MathUtils.clamp(0.95 + worldRadius * 0.022, 1.0, 3.2),
        profile,
    });
    if (fx) window.overlay3D.spawn(fx);
}

function _applyBurstImpulse(object3D, vel, angVel, opts, burstIndex = 0, burstCount = 1) {
    const phase = burstCount > 0 ? (burstIndex / Math.max(1, burstCount - 1)) : 0;
    const center = _meshWorldPos(object3D);
    const origin = opts.detachOrigin || opts.origin || center;

    TMP_OUT.subVectors(center, origin);
    TMP_OUT.z *= 0.18;
    if (TMP_OUT.lengthSq() < 1e-4) {
        TMP_OUT.set(Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.18);
    }
    TMP_OUT.normalize();

    TMP_TANGENT.crossVectors(TMP_OUT, WORLD_UP);
    if (TMP_TANGENT.lengthSq() < 1e-4) TMP_TANGENT.set(1, 0, 0);
    TMP_TANGENT.normalize();

    const kickBase = opts.preBurstImpulse ?? 18;
    const kick = kickBase * (0.78 + phase * 0.52);
    const tangentKick = kickBase * (0.08 + phase * 0.08) * (Math.random() - 0.5);
    vel.addScaledVector(TMP_OUT, kick);
    vel.addScaledVector(TMP_TANGENT, tangentKick);
    vel.z += (Math.random() - 0.5) * kickBase * 0.035;

    const angKick = (opts.preBurstAngularKick ?? 0.035) * (0.85 + phase * 0.55);
    angVel.x += (Math.random() - 0.5) * angKick;
    angVel.y += (Math.random() - 0.5) * angKick;
    angVel.z += (Math.random() - 0.5) * angKick;

    const maxSpeed = opts.maxCarrierSpeed ?? 240;
    if (vel.length() > maxSpeed) vel.setLength(maxSpeed);
}

function _cloneShellHierarchy(rootObject) {
    const clone = rootObject.clone(true);
    const srcMeshes = [];
    const dstMeshes = [];

    rootObject.traverse(child => {
        if (child.isMesh) srcMeshes.push(child);
    });
    clone.traverse(child => {
        if (child.isMesh) dstMeshes.push(child);
    });

    const count = Math.min(srcMeshes.length, dstMeshes.length);
    for (let i = 0; i < count; i++) {
        const src = srcMeshes[i];
        const dst = dstMeshes[i];
        if (src.geometry) {
            const g = src.geometry.clone();
            if (src.geometry.boundingSphere) g.boundingSphere = src.geometry.boundingSphere.clone();
            if (src.geometry.boundingBox) g.boundingBox = src.geometry.boundingBox.clone();
            if (src.geometry.__shardSpawnData) g.__shardSpawnData = src.geometry.__shardSpawnData;
            if (src.geometry.__shatterBaked) g.__shatterBaked = src.geometry.__shatterBaked;
            dst.geometry = g;
        }
        if (Array.isArray(src.material)) {
            dst.material = src.material.map(m => m?.clone?.() ?? m);
        } else if (src.material?.clone) {
            dst.material = src.material.clone();
        }
        dst.frustumCulled = false;
        dst.castShadow = src.castShadow;
        dst.receiveShadow = src.receiveShadow;
    }

    rootObject.updateWorldMatrix(true, true);
    rootObject.matrixWorld.decompose(TMP_WORLD_POS, TMP_WORLD_QUAT, TMP_WORLD_SCALE);
    clone.position.copy(TMP_WORLD_POS);
    clone.quaternion.copy(TMP_WORLD_QUAT);
    clone.scale.copy(TMP_WORLD_SCALE);
    clone.visible = true;
    clone.userData = { ...(rootObject.userData || {}) };
    return clone;
}

function _makePlane(normal, negate = false) {
    const n = negate ? normal.clone().multiplyScalar(-1) : normal.clone();
    return new THREE.Plane(n.normalize(), 0);
}

function _buildShellSplitDefs(count) {
    const pieceCount = Math.max(2, Math.min(4, count | 0));
    const baseAngle = Math.random() * Math.PI * 2;
    TMP_SHELL_AXIS_A.set(Math.cos(baseAngle), Math.sin(baseAngle), (Math.random() - 0.5) * 0.18).normalize();
    TMP_SHELL_AXIS_B.set(-TMP_SHELL_AXIS_A.y, TMP_SHELL_AXIS_A.x, (Math.random() - 0.5) * 0.14).normalize();

    const aPos = TMP_SHELL_AXIS_A.clone();
    const aNeg = TMP_SHELL_AXIS_A.clone().multiplyScalar(-1);
    const bPos = TMP_SHELL_AXIS_B.clone();
    const bNeg = TMP_SHELL_AXIS_B.clone().multiplyScalar(-1);

    if (pieceCount === 2) {
        return [
            { dir: aPos.clone(), localPlanes: [_makePlane(aPos)] },
            { dir: aNeg.clone(), localPlanes: [_makePlane(aPos, true)] },
        ];
    }

    if (pieceCount === 3) {
        return [
            { dir: aPos.clone().addScaledVector(bPos, 0.35).normalize(), localPlanes: [_makePlane(aPos), _makePlane(bPos)] },
            { dir: aPos.clone().addScaledVector(bNeg, 0.35).normalize(), localPlanes: [_makePlane(aPos), _makePlane(bPos, true)] },
            { dir: aNeg.clone(), localPlanes: [_makePlane(aPos, true)] },
        ];
    }

    return [
        { dir: aPos.clone().add(bPos).normalize(), localPlanes: [_makePlane(aPos), _makePlane(bPos)] },
        { dir: aPos.clone().add(bNeg).normalize(), localPlanes: [_makePlane(aPos), _makePlane(bPos, true)] },
        { dir: aNeg.clone().add(bPos).normalize(), localPlanes: [_makePlane(aPos, true), _makePlane(bPos)] },
        { dir: aNeg.clone().add(bNeg).normalize(), localPlanes: [_makePlane(aPos, true), _makePlane(bPos, true)] },
    ];
}

function _computeAdaptiveShellPieceCount(rootObject, opts = {}) {
    if (Number.isFinite(opts.shellPieceCount)) {
        return Math.max(2, Math.min(6, opts.shellPieceCount | 0));
    }
    const radius = _estimateObjectWorldRadius(rootObject);
    if (radius >= 520) return 6;
    if (radius >= 340) return 5;
    if (radius >= 220) return 4;
    if (radius >= 120) return 3;
    return 2;
}

function _createShellClipContext(rootObject, localPlanes) {
    const worldPlanes = localPlanes.map(p => p.clone());
    const materials = [];
    rootObject.traverse(child => {
        if (!child.isMesh) return;
        child.frustumCulled = false;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
            if (!mat) continue;
            mat.clippingPlanes = worldPlanes;
            mat.clipIntersection = false;
            mat.clipShadows = false;
            materials.push(mat);
        }
    });
    return { localPlanes, worldPlanes, materials };
}

function _updateShellClipContext(rootObject, clipCtx) {
    if (!rootObject || !clipCtx) return;
    rootObject.updateWorldMatrix(true, false);
    TMP_SHELL_NORMAL_MATRIX.getNormalMatrix(rootObject.matrixWorld);
    for (let i = 0; i < clipCtx.localPlanes.length; i++) {
        clipCtx.worldPlanes[i].copy(clipCtx.localPlanes[i]).applyMatrix4(rootObject.matrixWorld, TMP_SHELL_NORMAL_MATRIX);
    }
}

function _spawnShellSplit(rootObject, opts, worldTime, baseVelocity = null, baseAngular = null) {
    if (!_scene || opts.shellSplitEnabled === false) return false;
    const shellRadius = _estimateObjectWorldRadius(rootObject);
    const pieceCount = _computeAdaptiveShellPieceCount(rootObject, opts);
    const defs = _buildShellSplitDefs(pieceCount);
    if (!defs.length) return false;

    _spawnBreakupBurst(rootObject, opts, 'shellSplit');
    const origin = _meshWorldPos(rootObject);
    let spawnedPieces = 0;
    for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const pieceRoot = _cloneShellHierarchy(rootObject);
        pieceRoot.name = `${rootObject.name || 'shell'}__piece${i}`;
        pieceRoot.userData.destructionOwned = true;
        pieceRoot.userData.destructionPreset = opts.preset || rootObject.userData?.destructionPreset || 'default';
        _scene.add(pieceRoot);

        const clipCtx = _createShellClipContext(pieceRoot, def.localPlanes);
        _updateShellClipContext(pieceRoot, clipCtx);

        TMP_SHELL_DIR.copy(def.dir).applyQuaternion(pieceRoot.quaternion).normalize();
        const breakupOrigin = origin.clone().addScaledVector(TMP_SHELL_DIR, shellRadius * 0.18);
        const pieceVel = (baseVelocity ? baseVelocity.clone() : new THREE.Vector3())
            .multiplyScalar(0.88)
            .addScaledVector(TMP_SHELL_DIR, (opts.shellPieceKick ?? 42) * (0.92 + i * 0.08));
        pieceVel.z += (Math.random() - 0.5) * (opts.shellPieceKick ?? 42) * 0.018;

        const pieceAng = (baseAngular ? baseAngular.clone() : new THREE.Vector3()).multiplyScalar(0.38);
        const shellSpin = opts.shellPieceSpin ?? 0.18;
        pieceAng.x += (Math.random() - 0.5) * shellSpin;
        pieceAng.y += (Math.random() - 0.5) * shellSpin;
        pieceAng.z += (Math.random() - 0.5) * shellSpin;

        const pieceOpts = {
            ...opts,
            shellSplitEnabled: false,
            clipPlanes: clipCtx.worldPlanes,
            onMotion: () => _updateShellClipContext(pieceRoot, clipCtx),
            delayedShatter: opts.shellPieceShatterDelay ?? THREE.MathUtils.clamp(1.25 + shellRadius * 0.0045, 1.35, 3.6),
            drag: opts.shellPieceDrag ?? 0.99725,
            angularDrag: opts.shellPieceAngularDrag ?? 0.99625,
            launchRamp: opts.shellPieceLaunchRamp ?? 0.14,
            rotationDelay: opts.shellPieceRotationDelay ?? THREE.MathUtils.clamp(0.72 + shellRadius * 0.0018, 0.8, 1.45),
            maxRotationBeforeShatter: opts.shellPieceMaxRotation ?? 0.16,
            preShatterBursts: opts.shellPieceBursts ?? Math.max(3, Math.min(6, pieceCount)),
            preShatterWindow: opts.shellPieceBurstWindow ?? THREE.MathUtils.clamp(0.9 + shellRadius * 0.0022, 0.95, 1.85),
            preBurstSize: opts.shellPieceBurstSize ?? 14,
            preBurstRadius: opts.shellPieceBurstRadius ?? 10,
            preBurstImpulse: opts.shellPieceBurstImpulse ?? 16,
            preBurstAngularKick: opts.shellPieceBurstAngularKick ?? 0.028,
            maxCarrierSpeed: opts.shellPieceMaxSpeed ?? 225,
            shardScale: (opts.shardScale ?? DESTRUCTION_CONFIG.shardScale) * 0.84,
            shardLifetime: opts.shellPieceShardLifetime ?? Math.max(4.2, (opts.shardLifetime ?? DESTRUCTION_CONFIG.shardLifetime) * 1.18),
            emissiveShardRatio: opts.shellPieceEmissiveShardRatio ?? opts.emissiveShardRatio ?? DESTRUCTION_CONFIG.emissiveShardRatio,
            shardDrag: opts.shellPieceShardDrag ?? 0.9972,
            shardAngularDrag: opts.shellPieceShardAngularDrag ?? 0.9961,
            shardFadeStartMul: opts.shellPieceShardFadeStartMul ?? 0.84,
            driftMul: opts.shellPieceDriftMul ?? 1.16,
            detachOrigin: origin.clone(),
            breakupOrigin,
            preset: opts.preset || rootObject.userData?.destructionPreset || 'default',
        };

        _dismantling.push(new DismantleSection(pieceRoot, pieceVel, pieceAng, _scene, pieceOpts));
        _spawnDetachBurst(pieceRoot, { ...opts, preBurstSize: pieceOpts.preBurstSize, preBurstRadius: pieceOpts.preBurstRadius }, i, defs.length);
        spawnedPieces++;
    }

    rootObject.visible = false;
    if (rootObject.parent) rootObject.parent.remove(rootObject);
    return spawnedPieces > 0;
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

function _hasShardSpawnData(rootObject) {
    let found = false;
    rootObject.traverse(child => {
        if (found || !child.isMesh) return;
        const data = child.geometry?.__shardSpawnData;
        if (data?.count > 0) found = true;
    });
    return found;
}

function _shouldUsePanelHybrid(rootObject, opts) {
    return (opts.debrisStyle === 'panelHybrid') && !!_panelShardMgr && _hasShardSpawnData(rootObject);
}

function _markDestructionOwned(rootObject, opts) {
    if (!rootObject) return;
    rootObject.userData = rootObject.userData || {};
    rootObject.userData.destructionOwned = true;
    if (opts?.preset) rootObject.userData.destructionPreset = opts.preset;
}

function _registerRootCleanup(rootObject, worldTime, opts, extra = 0.8) {
    const expiry = worldTime + (opts.shardLifetime ?? opts.debrisLifetime ?? DESTRUCTION_CONFIG.shardLifetime) + extra;
    _debrisMgr.register(rootObject, _scene, expiry);
}

function _beginRootFade(rootObject, worldTime, opts) {
    const duration = Math.max(0.08, Math.min(0.12, opts.flashFadeDuration ?? 0.10));
    const flashColor = (opts.flashColor instanceof THREE.Color ? opts.flashColor : new THREE.Color(opts.flashColor ?? 0xffffff)).clone();
    const entries = [];
    rootObject.traverse(child => {
        if (!child.isMesh) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const snapshots = [];
        for (const mat of mats) {
            if (!mat) continue;
            snapshots.push({
                mat,
                opacity: Number.isFinite(mat.opacity) ? mat.opacity : 1,
                transparent: !!mat.transparent,
                depthWrite: mat.depthWrite !== false,
                emissive: mat.emissive?.clone?.() ?? null,
                emissiveIntensity: Number.isFinite(mat.emissiveIntensity) ? mat.emissiveIntensity : 1,
            });
            mat.transparent = true;
            mat.depthWrite = false;
        }
        if (snapshots.length) entries.push({ snapshots });
    });

    if (entries.length) {
        _rootFades.push({
            root: rootObject,
            start: worldTime,
            end: worldTime + duration,
            flashColor,
            entries,
        });
    } else {
        _scheduleCallback(duration, () => {
            if (rootObject) rootObject.visible = false;
        });
    }
}

function _spawnPanelHybrid(rootObject, opts, worldTime, baseVelocity = null, baseAngular = null) {
    if (!_panelShardMgr) return false;
    _markDestructionOwned(rootObject, opts);
    const spawned = _panelShardMgr.spawnFromObject(rootObject, {
        preset: opts.preset || rootObject.userData?.destructionPreset || 'default',
        fragmentDrift: opts.fragmentDrift ?? DESTRUCTION_CONFIG.fragmentDrift,
        shardScale: opts.shardScale ?? DESTRUCTION_CONFIG.shardScale,
        shardLifetime: opts.shardLifetime ?? DESTRUCTION_CONFIG.shardLifetime,
        emissiveShardRatio: opts.emissiveShardRatio ?? DESTRUCTION_CONFIG.emissiveShardRatio,
        clipPlanes: opts.clipPlanes,
        baseVelocity,
        baseAngular,
        origin: opts.breakupOrigin ?? opts.origin,
        driftMul: opts.driftMul,
        gravity: opts.gravity ?? 0,
    });
    if (spawned <= 0) return false;
    _registerRootCleanup(rootObject, worldTime, opts);
    return true;
}

function _triggerHierarchyBreakup(rootObject, opts, worldTime, baseVelocity = null, baseAngular = null) {
    if (_spawnShellSplit(rootObject, opts, worldTime, baseVelocity, baseAngular)) {
        return true;
    }
    if (_shouldUsePanelHybrid(rootObject, opts)) {
        _markDestructionOwned(rootObject, opts);
        if (_spawnPanelHybrid(rootObject, opts, worldTime, baseVelocity, baseAngular)) {
            _spawnBreakupBurst(rootObject, opts, opts.clipPlanes ? 'shellFinal' : 'carrier');
            if (opts.clipPlanes || opts.instantHideOnBreakup) {
                rootObject.visible = false;
                if (rootObject.parent) rootObject.parent.remove(rootObject);
            } else {
                _beginRootFade(rootObject, worldTime, opts);
            }
            return true;
        }
    }
    _applyShatterToHierarchy(rootObject, opts, worldTime);
    return false;
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
        if (_panelShardMgr?.disposeAll) _panelShardMgr.disposeAll();
        _panelShardMgr  = scene ? new PanelShardManager(scene) : null;
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
        _markDestructionOwned(rootMesh, opts);

        if (_shouldUsePanelHybrid(rootMesh, opts)) {
            if (_spawnPanelHybrid(rootMesh, opts, now)) {
                _beginRootFade(rootMesh, now, opts);
                this._spawnVFX(worldPos, opts);

                const dur = opts.duration ?? DESTRUCTION_CONFIG.duration;
                opts.onImpactStart?.();
                _scheduleCallback(dur * 0.30, () => opts.onShatterPeak?.());
                _scheduleCallback(dur,        () => opts.onCollapseEnd?.());
                _scheduleCallback(dur * 1.5,  () => opts.onSettle?.());

                this.emit('shatterStart', { mesh: rootMesh, worldTime: now });
                return;
            }
        }

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
        const sectionRadius = _estimateObjectWorldRadius(detachedRoot);

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
            debrisStyle: opts.debrisStyle ?? 'panelHybrid',
            preset: opts.preset ?? stationRoot.userData?.destructionPreset ?? 'default',
            shardScale: opts.shardScale ?? DESTRUCTION_CONFIG.shardScale,
            shardLifetime: opts.shardLifetime ?? DESTRUCTION_CONFIG.shardLifetime,
            emissiveShardRatio: opts.emissiveShardRatio ?? DESTRUCTION_CONFIG.emissiveShardRatio,
            delayedShatter: opts.delayedShatter ?? THREE.MathUtils.clamp(2.3 + sectionRadius * 0.0035, 2.4, 4.6),
            drag: opts.drag ?? 0.9971,
            angularDrag: opts.angularDrag ?? 0.9961,
            launchRamp: opts.launchRamp ?? 0.16,
            rotationDelay: opts.rotationDelay ?? THREE.MathUtils.clamp(1.15 + sectionRadius * 0.0014, 1.2, 1.9),
            maxRotationBeforeShatter: opts.maxRotationBeforeShatter ?? 0.12,
            staggerWindow: opts.staggerWindow ?? 0.65,
            burstStrength: opts.burstStrength ?? 0.78,
            burstPulses: opts.burstPulses ?? 0,
            preShatterBursts: opts.preShatterBursts ?? Math.max(5, Math.min(8, 3 + Math.round(sectionRadius / 120))),
            preShatterWindow: opts.preShatterWindow ?? THREE.MathUtils.clamp(1.55 + sectionRadius * 0.0018, 1.6, 2.4),
            preBurstSize: opts.preBurstSize ?? 16,
            preBurstRadius: opts.preBurstRadius ?? 14,
            preBurstImpulse: opts.preBurstImpulse ?? 22,
            preBurstAngularKick: opts.preBurstAngularKick ?? 0.045,
            maxCarrierSpeed: opts.maxCarrierSpeed ?? 300,
            detachOrigin: opts.detachOrigin ?? stationCenter.clone(),
            shellSplitEnabled: opts.shellSplitEnabled ?? true,
            shellPieceKick: opts.shellPieceKick ?? 46,
            shellPieceShatterDelay: opts.shellPieceShatterDelay ?? 1.15,
            shellPieceBursts: opts.shellPieceBursts ?? 3,
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
        const chunkRadius = _estimateObjectWorldRadius(detachedRoot);

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

        const shatterDelay = opts.shatterDelay ?? THREE.MathUtils.clamp(2.2 + chunkRadius * 0.0038, 2.25, 4.2);

        // Normalize fragmentDrift so world-space displacement stays meaningfully
        // outside the source hull, even for large station chunks.
        // regardless of model geometry scale (worldScale already captured above).
        const modelScale = Math.max(0.001, worldScale.x);
        const targetWorldDrift = 460;
        const normalizedDrift  = targetWorldDrift / modelScale;

        // ── 5. Hand off to DismantleSection fake physics ──────────────────
        // After shatterDelay, the chunk shatters via GPU shader
        const ds = new DismantleSection(detachedRoot, vel, angVel, _scene, {
            debrisStyle: opts.debrisStyle ?? 'panelHybrid',
            preset: opts.preset ?? stationRoot.userData?.destructionPreset ?? 'default',
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
            preShatterBursts: 5,
            preShatterWindow: 1.08,
            preBurstSize:   18,
            preBurstRadius: 14,
            preBurstImpulse: 24,
            preBurstAngularKick: 0.05,
            shardScale:     opts.shardScale ?? 1.06,
            shardLifetime:  opts.shardLifetime ?? 3.4,
            emissiveShardRatio: opts.emissiveShardRatio ?? 0.18,
            drag:           0.99725,
            angularDrag:    0.99625,
            launchRamp:     0.18,
            rotationDelay:  THREE.MathUtils.clamp(1.05 + chunkRadius * 0.0016, 1.1, 1.85),
            maxRotationBeforeShatter: 0.12,
            maxCarrierSpeed: 315,
            detachOrigin:   stationCenter.clone(),
            shellSplitEnabled: opts.shellSplitEnabled ?? true,
            shellPieceKick: opts.shellPieceKick ?? 54,
            shellPieceShatterDelay: opts.shellPieceShatterDelay ?? THREE.MathUtils.clamp(1.6 + chunkRadius * 0.0028, 1.7, 3.2),
            shellPieceBursts: opts.shellPieceBursts ?? Math.max(3, Math.min(6, 2 + Math.round(chunkRadius / 140))),
        });
        _dismantling.push(ds);

        // ── 6. Small spark burst at the breakaway point ───────────────────
        if (_reactorFactory) {
            const overlayPos = _meshOverlayPos(detachedRoot);
            const fx = _reactorFactory({
                x:       overlayPos.x,
                y:       overlayPos.y,
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

        if (_panelShardMgr) {
            _panelShardMgr.update(dt);
        }

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

        for (let i = _rootFades.length - 1; i >= 0; i--) {
            const fade = _rootFades[i];
            if (!fade.root || !fade.root.parent) {
                _rootFades.splice(i, 1);
                continue;
            }
            const t = Math.max(0, Math.min(1, (worldTime - fade.start) / Math.max(0.001, fade.end - fade.start)));
            const inv = 1.0 - t;
            for (const entry of fade.entries) {
                for (const snap of entry.snapshots) {
                    const mat = snap.mat;
                    mat.opacity = snap.opacity * inv;
                    if (snap.emissive) {
                        mat.emissive.copy(snap.emissive).lerp(fade.flashColor, inv * 0.55);
                        mat.emissiveIntensity = snap.emissiveIntensity + inv * 1.3;
                    }
                }
            }
            if (t >= 1.0) {
                fade.root.visible = false;
                _rootFades.splice(i, 1);
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
        const overlayY = -worldPos.y;

        // Sparks via reactorFactory
        if (_reactorFactory && sparks > 0) {
            const size = Math.sqrt(sparks) * 6;
            const fx = _reactorFactory({
                x:       worldPos.x,
                y:       overlayY,
                y:       worldPos.z,   // reactorblow uses top-down XY → Z maps to Y in world
                y:       overlayY,
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
        _markDestructionOwned(mesh, opts);

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
        if (_panelShardMgr?.disposeAll) _panelShardMgr.disposeAll();
        _panelShardMgr = null;
        _shatterMeshes.clear();
        _dismantling.length     = 0;
        _rootFades.length       = 0;
        _pendingCallbacks.length = 0;
        _listeners.clear();
    },
};
