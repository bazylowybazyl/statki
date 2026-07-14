import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { cloneSynthCityGeometry, synthCityAssets } from './ringCityAssets.js';
import {
    getOutwardDomeClearance,
    resolveOutwardCitySurface,
    SYNTHCITY_PITCH,
    SYNTHCITY_RIBBON_ROWS,
    SYNTHCITY_ROAD_WIDTH
} from './ringCitySurface.js';

const TAU = Math.PI * 2;
const CAR_VARIANTS = 8;
const BASE_ALTITUDES = Object.freeze([20, 60, 40, 80]);
const ALTITUDE_OFFSETS = Object.freeze([0, 0, 0, 0, 0, 200, 200, 200, 400]);

export const SYNTHCITY_TRAFFIC_SPEED = 72;
export const SYNTHCITY_TRAFFIC_FAST_SPEED = 144;
export const DEFAULT_RING_TRAFFIC_COUNT = 320;

function seededRandom(seed) {
    let state = (Number(seed) >>> 0) || 1;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function wrapAngle(angle) {
    let value = angle % TAU;
    if (value < 0) value += TAU;
    return value;
}

function wrapDistance(distance, span) {
    let value = distance % span;
    if (value < 0) value += span;
    return value;
}

export function createRingTrafficState(layout, options = {}) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return null;
    const requestedCount = Number(options.count);
    const count = Number.isFinite(requestedCount)
        ? Math.max(0, Math.floor(requestedCount))
        : DEFAULT_RING_TRAFFIC_COUNT;
    const rand = seededRandom(options.seed || 9746);
    const roadColumns = Math.max(1, Math.round(surface.circumference / SYNTHCITY_PITCH));
    const roadPitch = surface.circumference / roadColumns;
    const state = {
        count,
        surface,
        layout,
        roadColumns,
        roadPitch,
        angle: new Float32Array(count),
        sourceRadius: new Float32Array(count),
        altitude: new Float32Array(count),
        speed: new Float32Array(count),
        direction: new Int8Array(count),
        variant: new Uint8Array(count),
        variantSlot: new Uint16Array(count),
        variantCounts: new Uint16Array(CAR_VARIANTS)
    };

    for (let i = 0; i < count; i++) {
        const direction = Math.floor(rand() * 4);
        const variant = Math.floor(rand() * CAR_VARIANTS);
        if (direction < 2) {
            // East/west traffic follows a tangential road between two 128-unit
            // city blocks.  Opposite directions get a small lane separation.
            const roadRow = Math.floor(rand() * SYNTHCITY_RIBBON_ROWS);
            const roadCenter = wrapDistance(
                roadRow * SYNTHCITY_PITCH - SYNTHCITY_ROAD_WIDTH * 0.5,
                surface.width
            );
            const laneOffset = direction === 0 ? -4 : 4;
            state.sourceRadius[i] = surface.sourceInnerRadius + THREE.MathUtils.clamp(
                roadCenter + laneOffset,
                0,
                surface.width
            );
            state.angle[i] = rand() * TAU;
        } else {
            // North/south traffic crosses the ribbon on a radial road.  The
            // road angle is snapped to the same whole-pitch grid as the ground
            // texture and building placement.
            const roadColumn = Math.floor(rand() * roadColumns);
            const roadArc = wrapDistance(
                roadColumn * roadPitch - SYNTHCITY_ROAD_WIDTH * 0.5,
                surface.circumference
            );
            state.angle[i] = roadArc / surface.baseRadius;
            state.sourceRadius[i] = surface.sourceInnerRadius + rand() * surface.width;
        }
        state.direction[i] = direction;
        state.variant[i] = variant;
        state.variantSlot[i] = state.variantCounts[variant]++;
        state.altitude[i] = BASE_ALTITUDES[direction] + ALTITUDE_OFFSETS[Math.floor(rand() * ALTITUDE_OFFSETS.length)];
        state.speed[i] = rand() < 0.2 ? SYNTHCITY_TRAFFIC_FAST_SPEED : SYNTHCITY_TRAFFIC_SPEED;
    }
    return state;
}

export function stepRingTrafficState(state, dt) {
    if (!state || !(dt > 0)) return state;
    const step = Math.min(1, Number(dt) || 0);
    const inner = state.surface.sourceInnerRadius;
    const outer = state.surface.sourceOuterRadius;
    const baseRadius = Math.max(1, state.surface.baseRadius);

    for (let i = 0; i < state.count; i++) {
        const direction = state.direction[i];
        const speed = state.speed[i];
        if (direction < 2) {
            const sign = direction === 0 ? 1 : -1;
            state.angle[i] = wrapAngle(state.angle[i] + sign * (speed / baseRadius) * step);
            continue;
        }

        const sign = direction === 2 ? 1 : -1;
        let sourceRadius = state.sourceRadius[i] + sign * speed * step;
        if (sourceRadius > outer) {
            sourceRadius = outer - (sourceRadius - outer);
            state.direction[i] = 3;
        } else if (sourceRadius < inner) {
            sourceRadius = inner + (inner - sourceRadius);
            state.direction[i] = 2;
        }
        state.sourceRadius[i] = Math.max(inner, Math.min(outer, sourceRadius));
    }
    return state;
}

export function writeRingTrafficMatrix(state, index, target, scale = 1) {
    const angle = state.angle[index];
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    // Keep high traffic lanes under the arched transparent canopy.  Cars retain
    // their original SynthCity altitude in the middle of the ribbon and descend
    // smoothly near its two end walls.
    const altitude = Math.min(
        state.altitude[index],
        Math.max(12, getOutwardDomeClearance(state.sourceRadius[index], state.layout) - 28)
    );
    const radius = state.surface.baseRadius - altitude;
    const x = cosA * radius;
    const y = sinA * radius;
    const z = state.sourceRadius[index] - state.surface.sourceInnerRadius;
    const direction = state.direction[index];
    const s = Number(scale) || 1;

    if (direction < 2) {
        const sign = direction === 0 ? 1 : -1;
        return target.set(
            0, -cosA * s, -sign * sinA * s, x,
            0, -sinA * s,  sign * cosA * s, y,
            -sign * s, 0, 0, z,
            0, 0, 0, 1
        );
    }

    const sign = direction === 2 ? 1 : -1;
    return target.set(
        -sign * sinA * s, -cosA * s, 0, x,
         sign * cosA * s, -sinA * s, 0, y,
         0, 0, sign * s, z,
         0, 0, 0, 1
    );
}

export class RingCityTraffic {
    constructor(layout, key = 'ring', options = {}) {
        this.layout = layout;
        this.key = key;
        this.options = options;
        this.group = new THREE.Group();
        this.group.name = `RingCityTraffic:${key}`;
        this.group.userData.fgCategory = 'buildings';
        this.state = createRingTrafficState(layout, {
            count: options.count,
            seed: options.seed
        });
        this.meshes = new Array(CAR_VARIANTS).fill(null);
        this.geometries = [];
        this.matrixScratch = new THREE.Matrix4();
        this.visibleFraction = 0;
    }

    build() {
        const material = synthCityAssets.materials.cars;
        if (!this.state || !material) return this.group;
        for (let variant = 0; variant < CAR_VARIANTS; variant++) {
            const count = this.state.variantCounts[variant];
            if (!count) continue;
            const geometry = cloneSynthCityGeometry(`car_${String(variant + 1).padStart(2, '0')}`);
            if (!geometry) continue;
            geometry.computeBoundingSphere();
            this.geometries.push(geometry);
            const mesh = new THREE.InstancedMesh(geometry, material, count);
            mesh.name = `RingCityTrafficCars:${this.key}:${variant + 1}`;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            // Mesh-level only: this does not iterate individual cars, while
            // still avoiding submission for unusual off-axis/split views.
            mesh.frustumCulled = true;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.userData.lodLevel = 'DETAIL';
            mesh.userData.fgCategory = 'buildings';
            this.meshes[variant] = mesh;
            this.group.add(mesh);
        }
        if (Core3D?.enableForeground3D) Core3D.enableForeground3D(this.group);
        this.update(0, 0);
        return this.group;
    }

    update(dt, lodLevel = 0) {
        if (!this.state) return;
        const visibleFraction = lodLevel <= 0 ? 1 : lodLevel === 1 ? 0.45 : 0;
        this.group.visible = visibleFraction > 0;
        this.visibleFraction = visibleFraction;
        if (visibleFraction <= 0) return;

        stepRingTrafficState(this.state, dt);
        for (let variant = 0; variant < CAR_VARIANTS; variant++) {
            const mesh = this.meshes[variant];
            if (!mesh) continue;
            mesh.count = Math.max(0, Math.floor(this.state.variantCounts[variant] * visibleFraction));
        }

        for (let i = 0; i < this.state.count; i++) {
            const variant = this.state.variant[i];
            const slot = this.state.variantSlot[i];
            const mesh = this.meshes[variant];
            if (!mesh || slot >= mesh.count) continue;
            writeRingTrafficMatrix(this.state, i, this.matrixScratch, this.options.scale || 1);
            mesh.setMatrixAt(slot, this.matrixScratch);
        }
        for (const mesh of this.meshes) {
            if (mesh?.count) mesh.instanceMatrix.needsUpdate = true;
        }
    }

    getState() {
        return {
            count: this.state?.count || 0,
            visibleFraction: this.visibleFraction,
            instancedDraws: this.meshes.reduce((sum, mesh) => sum + (mesh ? 1 : 0), 0)
        };
    }

    dispose() {
        if (this.group.parent) this.group.parent.remove(this.group);
        for (const mesh of this.meshes) {
            // InstancedMesh owns GPU-side instance state in addition to its
            // geometry, so release it explicitly during ring hard resets.
            mesh?.dispose?.();
        }
        for (const geometry of this.geometries) geometry.dispose?.();
        this.geometries.length = 0;
        this.meshes.fill(null);
        this.state = null;
    }
}
