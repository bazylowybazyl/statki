import * as THREE from 'three';
import { Core3D } from '../3d/core3d.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

const TMP_BOX = new THREE.Box3();
const TMP_CENTER = new THREE.Vector3();
const TMP_POS = new THREE.Vector3();
const TMP_NORMAL = new THREE.Vector3();
const TMP_OUT = new THREE.Vector3();
const TMP_TANGENT = new THREE.Vector3();
const TMP_ANGULAR = new THREE.Vector3();
const TMP_OFFSET = new THREE.Vector3();
const TMP_VELOCITY = new THREE.Vector3();
const TMP_ROTATION = new THREE.Quaternion();
const TMP_SHARD_ANGULAR = new THREE.Vector3();
const TMP_SCALE = new THREE.Vector3();
const TMP_CHILD_WORLD_SCALE = new THREE.Vector3();
const TMP_EULER = new THREE.Euler();
const TMP_MATRIX = new THREE.Matrix4();
const TMP_NORMAL_MATRIX = new THREE.Matrix3();
const TMP_ALIGN_QUAT = new THREE.Quaternion();
const TMP_TWIST_QUAT = new THREE.Quaternion();
const ZERO_VELOCITY = new THREE.Vector3();
const ZERO_ANGULAR = new THREE.Vector3();

const STYLE_DEFAULTS = Object.freeze({
    default: Object.freeze({
        emissiveRatio: 0.12,
        shardScale: 1.0,
        shardLifetime: 3.1,
        driftMul: 1.0,
        emissiveTint: new THREE.Color(0.82, 0.9, 1.0),
        warmTint: new THREE.Color(1.0, 0.64, 0.34),
        baseLiftTint: new THREE.Color(0.70, 0.74, 0.80),
    }),
    civilian: Object.freeze({
        emissiveRatio: 0.24,
        shardScale: 1.0,
        shardLifetime: 3.0,
        driftMul: 0.92,
        emissiveTint: new THREE.Color(0.72, 0.9, 1.0),
        warmTint: new THREE.Color(1.0, 0.74, 0.46),
        baseLiftTint: new THREE.Color(0.72, 0.78, 0.88),
    }),
    pirate: Object.freeze({
        emissiveRatio: 0.12,
        shardScale: 1.06,
        shardLifetime: 3.2,
        driftMul: 1.08,
        emissiveTint: new THREE.Color(1.0, 0.58, 0.36),
        warmTint: new THREE.Color(1.0, 0.46, 0.26),
        baseLiftTint: new THREE.Color(0.74, 0.56, 0.46),
    }),
});

function colorLuma(color) {
    return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

const SHARD_CAPACITY = Object.freeze({
    solid: Object.freeze({
        square: 1400,
        long: 1400,
        beam: 900,
        block: 480,
    }),
    emissive: Object.freeze({
        square: 360,
        long: 320,
        beam: 220,
        block: 80,
    }),
});

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function getStyleConfig(style) {
    return STYLE_DEFAULTS[style] || STYLE_DEFAULTS.default;
}

function makeShardGeometry(kind) {
    switch (kind) {
        case 'square': return new THREE.BoxGeometry(1.0, 1.0, 0.12);
        case 'long': return new THREE.BoxGeometry(1.8, 0.55, 0.12);
        case 'beam': return new THREE.BoxGeometry(1.6, 0.18, 0.18);
        case 'block':
        default: return new THREE.BoxGeometry(0.7, 0.7, 0.7);
    }
}

class InstancedShardPool {
    constructor(group, kind, materialType, geometry, material, capacity) {
        this.kind = kind;
        this.materialType = materialType;
        this.capacity = capacity;
        this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
        this.mesh.name = `panelShard_${materialType}_${kind}`;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 65;
        group.add(this.mesh);

        this.active = new Uint8Array(capacity);
        this.age = new Float32Array(capacity);
        this.life = new Float32Array(capacity);
        this.drag = new Float32Array(capacity);
        this.angularDrag = new Float32Array(capacity);
        this.baseScale = new Float32Array(capacity);
        this.fadeStart = new Float32Array(capacity);
        this.gravity = new Float32Array(capacity);
        this.colorR = new Float32Array(capacity);
        this.colorG = new Float32Array(capacity);
        this.colorB = new Float32Array(capacity);
        this.positions = new Array(capacity);
        this.velocities = new Array(capacity);
        this.rotations = new Array(capacity);
        this.angular = new Array(capacity);
        this.free = new Int32Array(capacity);
        this.freeTop = capacity;

        for (let i = 0; i < capacity; i++) {
            this.positions[i] = new THREE.Vector3();
            this.velocities[i] = new THREE.Vector3();
            this.rotations[i] = new THREE.Quaternion();
            this.angular[i] = new THREE.Vector3();
            this.free[i] = capacity - 1 - i;
            this._writeInactive(i);
        }

        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.needsUpdate = true;
    }

    spawn(config) {
        if (this.freeTop <= 0) return false;
        const idx = this.free[--this.freeTop];
        this.active[idx] = 1;
        this.age[idx] = 0;
        this.life[idx] = config.life;
        this.drag[idx] = config.drag;
        this.angularDrag[idx] = config.angularDrag;
        this.baseScale[idx] = config.scale;
        this.fadeStart[idx] = config.fadeStart;
        this.gravity[idx] = config.gravity;
        this.colorR[idx] = config.color.r;
        this.colorG[idx] = config.color.g;
        this.colorB[idx] = config.color.b;
        this.positions[idx].copy(config.position);
        this.velocities[idx].copy(config.velocity);
        this.rotations[idx].copy(config.rotation);
        this.angular[idx].copy(config.angular);
        this._writeActive(idx, 1.0);
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.needsUpdate = true;
        return true;
    }

    update(dt) {
        let dirty = false;
        for (let i = 0; i < this.capacity; i++) {
            if (!this.active[i]) continue;
            dirty = true;

            const nextAge = this.age[i] + dt;
            this.age[i] = nextAge;
            const life = this.life[i];
            if (nextAge >= life) {
                this.active[i] = 0;
                this.free[this.freeTop++] = i;
                this._writeInactive(i);
                continue;
            }

            const fadeT = nextAge <= this.fadeStart[i]
                ? 0
                : clamp01((nextAge - this.fadeStart[i]) / Math.max(0.001, life - this.fadeStart[i]));
            const scaleMul = 1.0 - fadeT * 0.42;
            const brightness = 1.0 - fadeT * fadeT;

            const vel = this.velocities[i];
            const pos = this.positions[i];
            vel.y -= this.gravity[i] * dt;
            pos.addScaledVector(vel, dt);
            vel.multiplyScalar(Math.pow(this.drag[i], dt * 60));

            const ang = this.angular[i];
            TMP_EULER.set(ang.x * dt, ang.y * dt, ang.z * dt, 'XYZ');
            TMP_TWIST_QUAT.setFromEuler(TMP_EULER);
            this.rotations[i].multiply(TMP_TWIST_QUAT).normalize();
            ang.multiplyScalar(Math.pow(this.angularDrag[i], dt * 60));

            this._writeActive(i, brightness, scaleMul);
        }

        if (dirty) {
            this.mesh.instanceMatrix.needsUpdate = true;
            this.mesh.instanceColor.needsUpdate = true;
        }
    }

    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }

    _writeActive(index, brightness = 1.0, scaleMul = 1.0) {
        const s = this.baseScale[index] * scaleMul;
        TMP_SCALE.set(s, s, s);
        TMP_MATRIX.compose(this.positions[index], this.rotations[index], TMP_SCALE);
        this.mesh.setMatrixAt(index, TMP_MATRIX);
        this.mesh.instanceColor.setXYZ(
            index,
            this.colorR[index] * brightness,
            this.colorG[index] * brightness,
            this.colorB[index] * brightness
        );
    }

    _writeInactive(index) {
        TMP_SCALE.set(0.00001, 0.00001, 0.00001);
        TMP_POS.set(0, -999999, 0);
        TMP_ROTATION.identity();
        TMP_MATRIX.compose(TMP_POS, TMP_ROTATION, TMP_SCALE);
        this.mesh.setMatrixAt(index, TMP_MATRIX);
        this.mesh.instanceColor.setXYZ(index, 0, 0, 0);
    }
}

export class PanelShardManager {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = 'PanelShardManager';
        this.group.userData.fgCategory = 'stations';
        this.scene.add(this.group);
        if (Core3D?.enableForeground3D) Core3D.enableForeground3D(this.group);

        const solidMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            vertexColors: true,
            transparent: true,
            opacity: 0.98,
            toneMapped: false,
        });
        const emissiveMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            vertexColors: true,
            transparent: true,
            opacity: 0.98,
            depthWrite: false,
            toneMapped: false,
        });

        this._solidPools = {};
        this._emissivePools = {};
        for (const kind of ['square', 'long', 'beam', 'block']) {
            this._solidPools[kind] = new InstancedShardPool(
                this.group,
                kind,
                'solid',
                makeShardGeometry(kind),
                solidMaterial.clone(),
                SHARD_CAPACITY.solid[kind]
            );
            if (Core3D?.enableForeground3D) Core3D.enableForeground3D(this._solidPools[kind].mesh);
            this._emissivePools[kind] = new InstancedShardPool(
                this.group,
                kind,
                'emissive',
                makeShardGeometry(kind),
                emissiveMaterial.clone(),
                SHARD_CAPACITY.emissive[kind]
            );
            if (Core3D?.enableForeground3D) Core3D.enableForeground3D(this._emissivePools[kind].mesh);
        }
    }

    update(dt) {
        for (const pool of Object.values(this._solidPools)) pool.update(dt);
        for (const pool of Object.values(this._emissivePools)) pool.update(dt);
    }

    disposeAll() {
        for (const pool of Object.values(this._solidPools)) pool.dispose();
        for (const pool of Object.values(this._emissivePools)) pool.dispose();
        if (this.group.parent) this.group.parent.remove(this.group);
    }

    spawnFromObject(rootObject, opts = {}) {
        if (!rootObject) return 0;
        rootObject.updateWorldMatrix(true, true);

        const style = getStyleConfig(opts.style || opts.preset || rootObject.userData?.destructionPreset || 'default');
        const driftBase = Math.max(34, (opts.fragmentDrift ?? 260) * 0.12 * (opts.driftMul ?? style.driftMul));
        const shardScale = opts.shardScale ?? style.shardScale;
        const shardLifetime = opts.shardLifetime ?? style.shardLifetime;
        const emissiveRatio = clamp01(opts.emissiveShardRatio ?? style.emissiveRatio);
        const baseVelocity = opts.baseVelocity || ZERO_VELOCITY;
        const baseAngular = opts.baseAngular || ZERO_ANGULAR;
        const gravity = Math.max(0, Number(opts.gravity) || 0);
        const clipPlanes = Array.isArray(opts.clipPlanes) && opts.clipPlanes.length ? opts.clipPlanes : null;
        const shardFadeStartMul = THREE.MathUtils.clamp(Number(opts.shardFadeStartMul) || 0.72, 0.35, 0.96);
        const shardDrag = Number.isFinite(opts.shardDrag) ? opts.shardDrag : null;
        const shardAngularDrag = Number.isFinite(opts.shardAngularDrag) ? opts.shardAngularDrag : null;

        const origin = opts.origin || this._computeWorldCenter(rootObject);
        let spawned = 0;

        rootObject.traverse((child) => {
            if (!child.isMesh || !child.visible || !child.geometry?.__shardSpawnData) return;
            const data = child.geometry.__shardSpawnData;
            if (!data.count) return;
            if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere();

            const materialInfo = this._buildMaterialInfo(child, style, emissiveRatio);
            TMP_NORMAL_MATRIX.getNormalMatrix(child.matrixWorld);
            child.getWorldScale(TMP_CHILD_WORLD_SCALE);
            const worldScaleMag = Math.max(TMP_CHILD_WORLD_SCALE.x, TMP_CHILD_WORLD_SCALE.y, TMP_CHILD_WORLD_SCALE.z);
            const worldRadius = Math.max(0.5, (child.geometry.boundingSphere?.radius ?? 1) * worldScaleMag);
            const meshScaleFactor = THREE.MathUtils.clamp(worldRadius * 0.12, 0.75, 6.2);

            for (let i = 0; i < data.count; i++) {
                const base = i * 3;
                TMP_POS.fromArray(data.centroids, base).applyMatrix4(child.matrixWorld);
                TMP_NORMAL.fromArray(data.normals, base).applyMatrix3(TMP_NORMAL_MATRIX).normalize();

                if (clipPlanes) {
                    let clippedOut = false;
                    const clipSlack = Math.max(1.5, worldRadius * 0.03);
                    for (let p = 0; p < clipPlanes.length; p++) {
                        if (clipPlanes[p].distanceToPoint(TMP_POS) < -clipSlack) {
                            clippedOut = true;
                            break;
                        }
                    }
                    if (clippedOut) continue;
                }

                TMP_OUT.subVectors(TMP_POS, origin);
                if (TMP_OUT.lengthSq() < 1e-5) TMP_OUT.copy(TMP_NORMAL);
                TMP_OUT.normalize();

                TMP_TANGENT.crossVectors(TMP_NORMAL, TMP_OUT);
                if (TMP_TANGENT.lengthSq() < 1e-5) TMP_TANGENT.crossVectors(TMP_NORMAL, WORLD_UP);
                if (TMP_TANGENT.lengthSq() < 1e-5) TMP_TANGENT.crossVectors(TMP_NORMAL, WORLD_RIGHT);
                TMP_TANGENT.normalize();

                const seedA = data.seeds[base];
                const seedB = data.seeds[base + 1];
                const seedC = data.seeds[base + 2];
                const areaWeight = data.areaWeights[i];
                const isBlock = data.kind[i] === 1;
                const archetype = isBlock ? 'block' : this._pickPanelKind(seedA);
                const emissive = !isBlock && seedB < materialInfo.emissiveChance;
                const pool = emissive ? this._emissivePools[archetype] : this._solidPools[archetype];
                const color = emissive ? materialInfo.emissiveColor : materialInfo.baseColor;

                const localScale = meshScaleFactor * shardScale * (isBlock ? 1.12 : 1.0) * (0.72 + areaWeight * 0.55) * (0.9 + seedC * 0.22);
                const localLife = shardLifetime * (0.92 + seedA * 0.42);
                const tangentialFactor = (seedC - 0.5) * 0.24;

                TMP_OFFSET.subVectors(TMP_POS, origin);
                const angularKick = TMP_ANGULAR.copy(baseAngular).cross(TMP_OFFSET).multiplyScalar(0.55);

                const velocity = TMP_VELOCITY
                    .copy(baseVelocity)
                    .multiplyScalar(0.9)
                    .addScaledVector(TMP_OUT, driftBase * (0.68 + seedA * 0.62))
                    .addScaledVector(TMP_NORMAL, driftBase * (0.32 + seedB * 0.52))
                    .addScaledVector(TMP_TANGENT, driftBase * tangentialFactor)
                    .add(angularKick);

                TMP_ALIGN_QUAT.setFromUnitVectors(FORWARD_AXIS, TMP_NORMAL);
                TMP_TWIST_QUAT.setFromAxisAngle(TMP_NORMAL, (seedB - 0.5) * Math.PI * 1.5);
                const rotation = TMP_ROTATION.copy(TMP_ALIGN_QUAT).multiply(TMP_TWIST_QUAT);
                if (isBlock) {
                    TMP_EULER.set(seedA * Math.PI * 2, seedB * Math.PI * 2, seedC * Math.PI * 2);
                    rotation.setFromEuler(TMP_EULER);
                }

                const angular = TMP_SHARD_ANGULAR.set(
                    (seedA - 0.5) * (isBlock ? 1.2 : 0.7),
                    (seedB - 0.5) * (isBlock ? 1.0 : 0.6),
                    (seedC - 0.5) * (isBlock ? 1.3 : 0.8)
                ).addScaledVector(baseAngular, 0.22);

                if (pool.spawn({
                    position: TMP_POS,
                    velocity,
                    rotation,
                    angular,
                    scale: localScale,
                    life: localLife,
                    fadeStart: localLife * shardFadeStartMul,
                    drag: shardDrag ?? (emissive ? 0.9955 : 0.9962),
                    angularDrag: shardAngularDrag ?? (emissive ? 0.9935 : 0.9946),
                    gravity,
                    color,
                })) {
                    spawned++;
                }
            }
        });

        return spawned;
    }

    _pickPanelKind(seed) {
        if (seed < 0.22) return 'square';
        if (seed < 0.78) return 'long';
        return 'beam';
    }

    _buildMaterialInfo(mesh, style, emissiveRatio) {
        const sourceMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const baseColor = new THREE.Color(0.58, 0.62, 0.68);
        if (sourceMat?.color) baseColor.copy(sourceMat.color);

        const emissiveColor = new THREE.Color();
        let emissiveChance = emissiveRatio;
        const meshName = `${mesh.name || ''} ${sourceMat?.name || ''}`.toLowerCase();
        const emissiveBoost = /window|light|lamp|neon|screen|glow|panel|sign/.test(meshName);
        const hasTexture = !!sourceMat?.map;
        const baseLuma = colorLuma(baseColor);

        if (sourceMat?.emissive && sourceMat.emissive.getHex() !== 0) {
            emissiveColor.copy(sourceMat.emissive);
            emissiveChance = Math.max(emissiveChance, 0.28);
        } else if (emissiveBoost) {
            emissiveColor.copy(baseColor).lerp(style.emissiveTint, 0.55);
            emissiveChance = Math.max(emissiveChance, 0.24);
        } else {
            emissiveColor.copy(baseColor).lerp(style.warmTint, style === STYLE_DEFAULTS.pirate ? 0.32 : 0.18);
        }

        if (sourceMat?.emissiveIntensity) {
            emissiveChance = Math.max(emissiveChance, 0.14 + sourceMat.emissiveIntensity * 0.12);
        }

        if (hasTexture && baseLuma < 0.34) {
            baseColor.lerp(style.baseLiftTint, 0.30);
        }
        if (baseLuma < 0.20) {
            baseColor.lerp(style.baseLiftTint, 0.52);
        }

        baseColor.multiplyScalar(1.08);
        emissiveColor.multiplyScalar(style === STYLE_DEFAULTS.pirate ? 1.08 : 1.14);

        return {
            baseColor,
            emissiveColor,
            emissiveChance: clamp01(emissiveChance),
        };
    }

    _computeWorldCenter(rootObject) {
        TMP_BOX.setFromObject(rootObject);
        if (!TMP_BOX.isEmpty()) return TMP_BOX.getCenter(TMP_CENTER);
        return rootObject.getWorldPosition(TMP_CENTER);
    }
}
