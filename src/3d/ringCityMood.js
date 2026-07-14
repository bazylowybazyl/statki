import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { synthCityAssets } from './ringCityAssets.js';
import {
    OUTWARD_DOME_EDGE_HEIGHT,
    composeInwardCityMatrix,
    computeOutwardDomeBulge,
    createInwardDomeGeometry,
    getOutwardDomeClearance,
    resolveOutwardCitySurface
} from './ringCitySurface.js';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const HOLOGRAM_VARIANTS = 5;
const MOOD_COLORS = 2;

export const RING_CITY_MOOD_LEVEL = Object.freeze({
    OFF: 0,
    MEDIUM: 1,
    HIGH: 2
});

export const RING_CITY_MOOD_COUNTS = Object.freeze({
    // Roughly one hologram per SynthCity block. Instancing keeps this at the
    // same five hologram draw calls as the former sparse 240-panel version.
    holograms: 640,
    projectors: 64,
    lightPools: 160
});

function hashString(value) {
    const text = String(value || 'ring');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

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

export function resolveRingCityMoodLevel(cityQuality, lodLevel = 0) {
    const quality = String(cityQuality || 'medium').trim().toLowerCase();
    if (quality === 'low') return RING_CITY_MOOD_LEVEL.OFF;
    if (quality === 'high' || quality === 'ultra') return RING_CITY_MOOD_LEVEL.HIGH;
    return Number(lodLevel) < 2 ? RING_CITY_MOOD_LEVEL.MEDIUM : RING_CITY_MOOD_LEVEL.OFF;
}

function createPlacementBucket(count, variantCount) {
    return {
        count,
        angle: new Float32Array(count),
        sourceRadius: new Float32Array(count),
        height: new Float32Array(count),
        width: new Float32Array(count),
        depth: new Float32Array(count),
        yaw: new Float32Array(count),
        tilt: new Float32Array(count),
        variant: new Uint8Array(count),
        slot: new Uint16Array(count),
        variantCounts: new Uint16Array(variantCount)
    };
}

function resolveCount(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

export function createRingCityMoodState(layout, options = {}) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return null;
    const seed = (Number(options.seed) || hashString(options.key)) >>> 0;
    const rand = seededRandom(seed || 9746);
    const hologramCount = resolveCount(options.hologramCount, RING_CITY_MOOD_COUNTS.holograms);
    const projectorCount = resolveCount(options.projectorCount, RING_CITY_MOOD_COUNTS.projectors);
    const lightPoolCount = resolveCount(options.lightPoolCount, RING_CITY_MOOD_COUNTS.lightPools);
    const holograms = createPlacementBucket(hologramCount, HOLOGRAM_VARIANTS);
    const projectors = createPlacementBucket(projectorCount, MOOD_COLORS);
    const lightPools = createPlacementBucket(lightPoolCount, MOOD_COLORS);

    for (let i = 0; i < holograms.count; i++) {
        const variant = i % HOLOGRAM_VARIANTS;
        const sourceRadius = surface.sourceInnerRadius + (0.08 + rand() * 0.84) * surface.width;
        const clearance = getOutwardDomeClearance(sourceRadius, layout);
        const panelWidth = 64 + rand() * 158;
        const panelHeight = 42 + rand() * 104;
        const halfHeight = panelHeight * 0.5;
        const minimumCenter = halfHeight + 34;
        const maximumCenter = Math.max(minimumCenter, clearance - halfHeight - 42);
        // Keep most adverts above the average roofline so depth testing does
        // not bury them inside random buildings. Every third panel occupies a
        // higher skyline band, similar to SynthCity's animated toppers.
        const bandStart = i % 3 === 0 ? 0.62 : 0.34;
        const bandEnd = i % 3 === 0 ? 0.86 : 0.68;
        const bandHeight = clearance * (bandStart + rand() * (bandEnd - bandStart));
        holograms.angle[i] = wrapAngle(i * GOLDEN_ANGLE + rand() * 0.18);
        holograms.sourceRadius[i] = sourceRadius;
        holograms.height[i] = THREE.MathUtils.clamp(bandHeight, minimumCenter, maximumCenter);
        holograms.width[i] = panelWidth;
        holograms.depth[i] = panelHeight;
        // SynthCity follows a rectangular street grid. Quantizing yaw to its
        // two facade axes avoids arbitrary diagonal panels while still making
        // half the signs readable along the ring and half across its width.
        holograms.yaw[i] = (i & 1) * Math.PI * 0.5;
        // PlaneGeometry starts parallel to the roof. Rotate its local Y axis
        // into the radial/inward height axis: every advert now stands upright
        // from the city roof toward the planet instead of becoming a disk.
        holograms.tilt[i] = Math.PI * 0.5;
        holograms.variant[i] = variant;
        holograms.slot[i] = holograms.variantCounts[variant]++;
    }

    for (let i = 0; i < projectors.count; i++) {
        const variant = i % MOOD_COLORS;
        const sourceRadius = surface.sourceInnerRadius + (0.14 + rand() * 0.72) * surface.width;
        const clearance = getOutwardDomeClearance(sourceRadius, layout);
        const sourceHeight = 85 + rand() * Math.max(60, clearance * 0.28);
        projectors.angle[i] = wrapAngle(i * GOLDEN_ANGLE + rand() * 0.12);
        projectors.sourceRadius[i] = sourceRadius;
        projectors.height[i] = Math.min(clearance - 130, sourceHeight);
        projectors.width[i] = 18 + rand() * 34;
        projectors.depth[i] = Math.max(110, clearance - projectors.height[i] - 34);
        projectors.yaw[i] = rand() * TAU;
        projectors.tilt[i] = 0;
        projectors.variant[i] = variant;
        projectors.slot[i] = projectors.variantCounts[variant]++;
    }

    for (let i = 0; i < lightPools.count; i++) {
        const variant = i % MOOD_COLORS;
        lightPools.angle[i] = wrapAngle(i * GOLDEN_ANGLE + rand() * 0.2);
        lightPools.sourceRadius[i] = surface.sourceInnerRadius + (0.04 + rand() * 0.92) * surface.width;
        lightPools.height[i] = 5 + rand() * 5;
        lightPools.width[i] = 72 + rand() * 150;
        lightPools.depth[i] = lightPools.width[i] * (0.48 + rand() * 0.46);
        lightPools.yaw[i] = rand() * TAU;
        lightPools.tilt[i] = 0;
        lightPools.variant[i] = variant;
        lightPools.slot[i] = lightPools.variantCounts[variant]++;
    }

    return { surface, holograms, projectors, lightPools };
}

function makeInstancedVertexShader() {
    return `
        varying vec2 vUv;
        varying float vPhase;
        void main() {
            vUv = uv;
            vec4 localPosition = vec4(position, 1.0);
            #ifdef USE_INSTANCING
                localPosition = instanceMatrix * localPosition;
                vPhase = fract(dot(instanceMatrix[3].xyz, vec3(0.0131, 0.0173, 0.0197)));
            #else
                vPhase = 0.0;
            #endif
            gl_Position = projectionMatrix * modelViewMatrix * localPosition;
        }
    `;
}

function createHologramMaterial(texture) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: texture },
            uTime: { value: 0 },
            uOpacity: { value: 1 },
            uIntensity: { value: 2.35 }
        },
        vertexShader: makeInstancedVertexShader(),
        fragmentShader: `
            uniform sampler2D uMap;
            uniform float uTime;
            uniform float uOpacity;
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vPhase;
            void main() {
                // Double-sided billboards remain readable from both traffic
                // directions instead of showing mirrored copy on the back.
                vec2 sampleUv = vUv;
                if (!gl_FrontFacing) sampleUv.x = 1.0 - sampleUv.x;
                vec4 texel = texture2D(uMap, sampleUv);
                float luminance = max(texel.r, max(texel.g, texel.b));
                float mask = smoothstep(0.025, 0.24, luminance);
                float scan = 0.84 + 0.16 * sin(sampleUv.y * 260.0 + uTime * 5.2 + vPhase * 19.0);
                float flicker = 0.88 + 0.12 * sin(uTime * (2.1 + vPhase * 2.7) + vPhase * 41.0);
                float edge = smoothstep(0.0, 0.055, sampleUv.x) * smoothstep(0.0, 0.055, 1.0 - sampleUv.x)
                           * smoothstep(0.0, 0.055, sampleUv.y) * smoothstep(0.0, 0.055, 1.0 - sampleUv.y);
                float alpha = mask * edge * uOpacity;
                if (alpha < 0.01) discard;
                gl_FragColor = vec4(texel.rgb * uIntensity * scan * flicker, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false
    });
}

function createProjectorMaterial(color) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uTime: { value: 0 },
            uOpacity: { value: 0.24 },
            uIntensity: { value: 2.15 }
        },
        vertexShader: makeInstancedVertexShader(),
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uTime;
            uniform float uOpacity;
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vPhase;
            void main() {
                float along = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159265);
                float pulse = 0.82 + 0.18 * sin(uTime * 1.8 + vPhase * 31.0);
                float alpha = uOpacity * pow(max(0.0, along), 0.58) * pulse;
                gl_FragColor = vec4(uColor * uIntensity, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false
    });
}

function createLightPoolMaterial(color) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uTime: { value: 0 },
            uOpacity: { value: 0.34 },
            uIntensity: { value: 1.85 }
        },
        vertexShader: makeInstancedVertexShader(),
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uTime;
            uniform float uOpacity;
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vPhase;
            void main() {
                vec2 p = vUv * 2.0 - 1.0;
                float radial = max(0.0, 1.0 - dot(p, p));
                float pulse = 0.88 + 0.12 * sin(uTime * 1.35 + vPhase * 27.0);
                float alpha = pow(radial, 2.35) * uOpacity * pulse;
                if (alpha < 0.004) discard;
                gl_FragColor = vec4(uColor * uIntensity, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false
    });
}

function createHazeMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0.15 },
            uColorA: { value: new THREE.Color(0x1648d8) },
            uColorB: { value: new THREE.Color(0xb12bd6) }
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            varying vec3 vWorldNormal;
            void main() {
                vUv = uv;
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                vWorldNormal = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            uniform vec3 uColorA;
            uniform vec3 uColorB;
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            varying vec3 vWorldNormal;
            void main() {
                vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                float rim = pow(1.0 - abs(dot(normalize(vWorldNormal), viewDir)), 1.35);
                float canopy = 0.34 + 0.66 * sin(vUv.y * 3.14159265);
                float waves = 0.5 + 0.5 * sin(vUv.x * 46.0 + vUv.y * 9.0 - uTime * 0.18);
                vec3 color = mix(uColorA, uColorB, 0.32 + 0.28 * waves + 0.16 * sin(vUv.x * 13.0));
                float alpha = uOpacity * canopy * (0.42 + rim * 0.74) * (0.9 + waves * 0.1);
                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide,
        blending: THREE.NormalBlending,
        toneMapped: false
    });
}

function setMoodLayer(object) {
    object.userData.fgCategory = 'buildings';
    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(object);
    return object;
}

function setMeshBounds(mesh) {
    mesh.computeBoundingBox?.();
    mesh.computeBoundingSphere?.();
    mesh.frustumCulled = true;
}

export class RingCityMood {
    constructor(layout, key = 'ring', options = {}) {
        this.layout = layout;
        this.key = key;
        this.options = options;
        this.group = new THREE.Group();
        this.group.name = `RingCityMood:${key}`;
        this.group.userData.fgCategory = 'buildings';
        this.state = createRingCityMoodState(layout, {
            key,
            seed: options.seed,
            hologramCount: options.hologramCount,
            projectorCount: options.projectorCount,
            lightPoolCount: options.lightPoolCount
        });
        this.hologramMeshes = [];
        this.projectorMeshes = [];
        this.lightPoolMeshes = [];
        this.materials = [];
        this.geometries = [];
        this.animatedMaterials = [];
        this.hazeMesh = null;
        this.level = -1;
        this.lodLevel = -1;
        this.time = 0;
        this.matrixFrame = new THREE.Matrix4();
        this.matrixLocal = new THREE.Matrix4();
        this.matrixRotation = new THREE.Matrix4();
        this.matrixTilt = new THREE.Matrix4();
        this.matrixScale = new THREE.Matrix4();
    }

    _composePlacement(bucket, index, includeTilt = false) {
        composeInwardCityMatrix(bucket.angle[index], bucket.sourceRadius[index], this.layout, this.matrixFrame);
        this.matrixLocal.makeTranslation(0, 0, bucket.height[index]);
        this.matrixRotation.makeRotationZ(bucket.yaw[index]);
        this.matrixLocal.multiply(this.matrixRotation);
        if (includeTilt) {
            this.matrixTilt.makeRotationX(bucket.tilt[index]);
            this.matrixLocal.multiply(this.matrixTilt);
        }
        this.matrixScale.makeScale(
            bucket.width[index],
            includeTilt ? bucket.depth[index] : bucket.width[index],
            includeTilt ? 1 : bucket.depth[index]
        );
        this.matrixLocal.multiply(this.matrixScale);
        return this.matrixFrame.multiply(this.matrixLocal);
    }

    _buildHolograms() {
        const bucket = this.state?.holograms;
        if (!bucket) return;
        const geometry = new THREE.PlaneGeometry(1, 1);
        this.geometries.push(geometry);
        for (let variant = 0; variant < HOLOGRAM_VARIANTS; variant++) {
            const texture = synthCityAssets.textures[`ads_large_0${variant + 1}`]
                || synthCityAssets.textures[`ads_0${variant + 1}`];
            if (!texture || !bucket.variantCounts[variant]) {
                this.hologramMeshes.push(null);
                continue;
            }
            const material = createHologramMaterial(texture);
            const mesh = new THREE.InstancedMesh(geometry, material, bucket.variantCounts[variant]);
            mesh.name = `RingCityHolograms:${this.key}:${variant + 1}`;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.renderOrder = 4;
            mesh.userData.fullCount = bucket.variantCounts[variant];
            this.materials.push(material);
            this.animatedMaterials.push(material);
            this.hologramMeshes.push(mesh);
            this.group.add(mesh);
        }
        for (let i = 0; i < bucket.count; i++) {
            const mesh = this.hologramMeshes[bucket.variant[i]];
            if (!mesh) continue;
            mesh.setMatrixAt(bucket.slot[i], this._composePlacement(bucket, i, true));
        }
        for (const mesh of this.hologramMeshes) {
            if (!mesh) continue;
            mesh.instanceMatrix.needsUpdate = true;
            setMeshBounds(mesh);
        }
    }

    _buildProjectors() {
        const bucket = this.state?.projectors;
        if (!bucket) return;
        const geometry = new THREE.CylinderGeometry(0.82, 0.07, 1, 8, 1, true);
        geometry.translate(0, 0.5, 0);
        geometry.rotateX(Math.PI * 0.5);
        this.geometries.push(geometry);
        const colors = [0x25baff, 0xff36dc];
        for (let variant = 0; variant < MOOD_COLORS; variant++) {
            const material = createProjectorMaterial(colors[variant]);
            const mesh = new THREE.InstancedMesh(geometry, material, bucket.variantCounts[variant]);
            mesh.name = `RingCityProjectors:${this.key}:${variant}`;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.renderOrder = 5;
            mesh.userData.fullCount = bucket.variantCounts[variant];
            this.materials.push(material);
            this.animatedMaterials.push(material);
            this.projectorMeshes.push(mesh);
            this.group.add(mesh);
        }
        for (let i = 0; i < bucket.count; i++) {
            const mesh = this.projectorMeshes[bucket.variant[i]];
            mesh.setMatrixAt(bucket.slot[i], this._composePlacement(bucket, i, false));
        }
        for (const mesh of this.projectorMeshes) {
            mesh.instanceMatrix.needsUpdate = true;
            setMeshBounds(mesh);
        }
    }

    _buildLightPools() {
        const bucket = this.state?.lightPools;
        if (!bucket) return;
        const geometry = new THREE.CircleGeometry(1, 20);
        this.geometries.push(geometry);
        const colors = [0x148cff, 0xd91acb];
        for (let variant = 0; variant < MOOD_COLORS; variant++) {
            const material = createLightPoolMaterial(colors[variant]);
            const mesh = new THREE.InstancedMesh(geometry, material, bucket.variantCounts[variant]);
            mesh.name = `RingCityLightPools:${this.key}:${variant}`;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.renderOrder = 3;
            mesh.userData.fullCount = bucket.variantCounts[variant];
            this.materials.push(material);
            this.animatedMaterials.push(material);
            this.lightPoolMeshes.push(mesh);
            this.group.add(mesh);
        }
        for (let i = 0; i < bucket.count; i++) {
            const mesh = this.lightPoolMeshes[bucket.variant[i]];
            mesh.setMatrixAt(bucket.slot[i], this._composePlacement(bucket, i, true));
        }
        for (const mesh of this.lightPoolMeshes) {
            mesh.instanceMatrix.needsUpdate = true;
            setMeshBounds(mesh);
        }
    }

    _buildHaze() {
        const bulge = computeOutwardDomeBulge(this.layout);
        const geometry = createInwardDomeGeometry(
            this.layout,
            bulge * 0.96,
            512,
            8,
            Math.max(40, OUTWARD_DOME_EDGE_HEIGHT - 12)
        );
        if (!geometry) return;
        const material = createHazeMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `RingCityLocalHaze:${this.key}`;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 7;
        mesh.frustumCulled = true;
        this.geometries.push(geometry);
        this.materials.push(material);
        this.animatedMaterials.push(material);
        this.hazeMesh = mesh;
        this.group.add(mesh);
    }

    build() {
        if (!this.state) return this.group;
        this._buildLightPools();
        this._buildHolograms();
        this._buildProjectors();
        this._buildHaze();
        setMoodLayer(this.group);
        this.update(0, 2, 'low');
        return this.group;
    }

    _setMeshFraction(meshes, fraction) {
        for (const mesh of meshes) {
            if (!mesh) continue;
            const fullCount = Number(mesh.userData.fullCount) || 0;
            mesh.count = Math.max(0, Math.min(fullCount, Math.ceil(fullCount * fraction)));
            mesh.visible = mesh.count > 0;
        }
    }

    _applyProfile(level, lodLevel) {
        const enabled = level !== RING_CITY_MOOD_LEVEL.OFF;
        this.group.visible = enabled;
        if (!enabled) return;

        if (level === RING_CITY_MOOD_LEVEL.HIGH) {
            this._setMeshFraction(this.hologramMeshes, 1);
            this._setMeshFraction(this.projectorMeshes, 1);
            this._setMeshFraction(this.lightPoolMeshes, 1);
            if (this.hazeMesh) this.hazeMesh.material.uniforms.uOpacity.value = 0.155;
            return;
        }

        const near = Number(lodLevel) <= 0;
        this._setMeshFraction(this.hologramMeshes, near ? 0.64 : 0.46);
        this._setMeshFraction(this.projectorMeshes, near ? 0.52 : 0.32);
        this._setMeshFraction(this.lightPoolMeshes, near ? 0.56 : 0.36);
        if (this.hazeMesh) this.hazeMesh.material.uniforms.uOpacity.value = near ? 0.105 : 0.072;
    }

    update(dt, lodLevel = 0, cityQuality = 'medium') {
        const level = resolveRingCityMoodLevel(cityQuality, lodLevel);
        const safeLod = Math.max(0, Math.floor(Number(lodLevel) || 0));
        if (level !== this.level || safeLod !== this.lodLevel) {
            this.level = level;
            this.lodLevel = safeLod;
            this._applyProfile(level, safeLod);
        }
        if (level === RING_CITY_MOOD_LEVEL.OFF) return;
        this.time = (this.time + Math.max(0, Math.min(0.1, Number(dt) || 0))) % 10000;
        for (const material of this.animatedMaterials) {
            if (material?.uniforms?.uTime) material.uniforms.uTime.value = this.time;
        }
    }

    getState() {
        return {
            level: this.level,
            holograms: this.hologramMeshes.reduce((sum, mesh) => sum + (mesh?.count || 0), 0),
            projectors: this.projectorMeshes.reduce((sum, mesh) => sum + (mesh?.count || 0), 0),
            lightPools: this.lightPoolMeshes.reduce((sum, mesh) => sum + (mesh?.count || 0), 0),
            haze: !!this.hazeMesh,
            drawCalls: this.group.visible
                ? this.group.children.reduce((sum, child) => sum + (child.visible ? 1 : 0), 0)
                : 0
        };
    }

    dispose() {
        if (this.group.parent) this.group.parent.remove(this.group);
        for (const geometry of this.geometries) geometry.dispose?.();
        for (const material of this.materials) material.dispose?.();
        this.group.clear();
        this.hologramMeshes.length = 0;
        this.projectorMeshes.length = 0;
        this.lightPoolMeshes.length = 0;
        this.animatedMaterials.length = 0;
        this.geometries.length = 0;
        this.materials.length = 0;
        this.hazeMesh = null;
        this.state = null;
    }
}
