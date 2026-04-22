import * as THREE from "three";

// ─── GLSL noise ───────────────────────────────────────────────────────────────
const noiseChunk = `
    float hash(float n) { return fract(sin(n) * 43758.5453123); }
    float noise(vec3 x) {
        vec3 p = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n = p.x + p.y * 57.0 + 113.0 * p.z;
        return mix(mix(mix(hash(n + 0.0), hash(n + 1.0), f.x),
                       mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
                   mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                       mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
        float f = 0.0;
        f += 0.5000 * noise(p); p *= 2.02;
        f += 0.2500 * noise(p); p *= 2.03;
        f += 0.1250 * noise(p); p *= 2.01;
        return f;
    }
`;

// ─── GPU Instanced Particle Manager (Additive — ogień, rozbłyski, odłamki) ───
// Typy cząsteczek (aData.w):
//  1 — PUNCH FLASH      krótki ostry rozbłysk + krzyż
//  2 — FIREBALL CHUNK   poszarpany kłąb ognia z FBM
//  3 — TRAILED DEBRIS   rozżarzona smuga z dragiem (rozciągnięta wzdłuż wektora)
//  4 — SHRAPNEL         mały odłamek balistyczny z grawitacją
//  5 — ANAMORPHIC FLASH poziomy lens-flare
//  6 — PERCUSSIVE RING  ostry, cienki pierścień uderzeniowy (płaski na XZ)
//  7 — HOT DEBRIS CHUNK duży obracający się fragment z grawitacją
class GPUInstancedParticleManager {
    constructor(scene, maxParticles, blendingType) {
        this.maxParticles = maxParticles;
        this.activeIndex  = 0;
        this.dirty        = false;

        const baseGeo = new THREE.PlaneGeometry(1, 1);
        const geo     = new THREE.InstancedBufferGeometry();
        geo.index = baseGeo.index;
        geo.setAttribute("position", baseGeo.attributes.position);
        geo.setAttribute("uv",       baseGeo.attributes.uv);

        this.startPos  = new Float32Array(maxParticles * 3);
        this.startVel  = new Float32Array(maxParticles * 3);
        this.dataInfo  = new Float32Array(maxParticles * 4);

        geo.setAttribute("aStartPos", new THREE.InstancedBufferAttribute(this.startPos, 3));
        geo.setAttribute("aStartVel", new THREE.InstancedBufferAttribute(this.startVel, 3));
        geo.setAttribute("aData",     new THREE.InstancedBufferAttribute(this.dataInfo, 4));
        geo.instanceCount = maxParticles;

        this.material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                attribute vec3 aStartPos;
                attribute vec3 aStartVel;
                attribute vec4 aData;   // x=startTime  y=life  z=size  w=type

                uniform float uTime;

                varying vec3  vColor;
                varying float vAlpha;
                varying vec2  vUv;
                varying float vType;
                varying float vAgeNorm;
                varying float vSeed;

                float hash(float n) { return fract(sin(n) * 43758.5453123); }

                void main() {
                    vUv      = uv;
                    vType    = aData.w;
                    vSeed    = hash(aData.x);

                    float startTime = aData.x;
                    float maxLife   = aData.y;
                    float age       = uTime - startTime;

                    if (age < 0.0 || age > maxLife) {
                        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
                        return;
                    }

                    float ratio    = 1.0 - (age / maxLife);
                    vAgeNorm       = age / maxLife;

                    vec3  pos         = aStartPos + aStartVel * age;
                    float currentSize = aData.z;
                    vec4  mvPosition;

                    // ── TYPE 1: PUNCH FLASH ────────────────────────────────
                    if (vType < 1.5) {
                        float burst = pow(1.0 - ratio, 0.25);
                        currentSize = aData.z * (0.3 + burst * 0.7);
                        vec3 hot  = vec3(1.0, 1.0, 1.0);
                        vec3 cool = vec3(0.4, 0.7, 1.0);
                        vColor = mix(hot, cool, vAgeNorm) * 1.4;
                        vAlpha = pow(ratio, 3.0);

                        mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        mvPosition.xy += position.xy * currentSize;
                    }
                    // ── TYPE 2: FIREBALL CHUNK ─────────────────────────────
                    else if (vType < 2.5) {
                        float growth = pow(vAgeNorm, 0.4);
                        currentSize  = aData.z * (0.4 + growth * 1.4);

                        vec3 hotCore  = vec3(1.0, 0.95, 0.9);
                        vec3 midFire  = vec3(0.6, 0.8, 1.0);
                        vec3 darkEdge = vec3(0.05, 0.15, 0.4);
                        if (vAgeNorm < 0.25)
                            vColor = mix(hotCore, midFire, vAgeNorm / 0.25);
                        else
                            vColor = mix(midFire, darkEdge, (vAgeNorm - 0.25) / 0.75);
                        vColor *= 1.5;
                        vAlpha  = pow(ratio, 1.4);

                        mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        mvPosition.xy += position.xy * currentSize;
                    }
                    // ── TYPE 3: TRAILED DEBRIS ─────────────────────────────
                    else if (vType < 3.5) {
                        float drag = 1.5 + vSeed * 1.5;
                        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
                        vec3 currentVel = aStartVel * exp(-age * drag);
                        float speed     = length(currentVel);

                        vec3 hot  = vec3(1.0, 0.98, 0.95) * 2.0;
                        vec3 cold = vec3(0.15, 0.45, 1.0)  * 0.9;
                        vColor = mix(hot, cold, pow(vAgeNorm, 0.6));
                        vAlpha = pow(ratio, 0.7);

                        mvPosition = modelViewMatrix * vec4(pos, 1.0);

                        vec3 viewVel = (modelViewMatrix * vec4(currentVel, 0.0)).xyz;
                        vec2 dir = normalize(viewVel.xy);
                        if (length(viewVel.xy) < 0.1) dir = vec2(0.0, 1.0);

                        float width  = aData.z * 0.4;
                        float stretch = aData.z * speed * 0.0025;
                        float tailFactor = 0.5 - position.y;

                        vec2 scaledOffset;
                        scaledOffset.x = position.x * width;
                        scaledOffset.y = -tailFactor * stretch;

                        vec2 rotatedOffset;
                        rotatedOffset.x = scaledOffset.x * dir.y + scaledOffset.y * dir.x;
                        rotatedOffset.y = -scaledOffset.x * dir.x + scaledOffset.y * dir.y;
                        mvPosition.xy += rotatedOffset;
                    }
                    // ── TYPE 4: SHRAPNEL (balistyczny z grawitacją) ────────
                    else if (vType < 4.5) {
                        float drag = 0.6 + vSeed * 0.6;
                        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
                        pos.y -= 380.0 * age * age * (0.4 + vSeed); // grawitacja (Y=góra)

                        vec3 hot  = vec3(1.0, 0.85, 0.7);
                        vec3 cold = vec3(0.1,  0.3,  0.7);
                        vColor = mix(hot, cold, pow(vAgeNorm, 0.5)) * 1.3;
                        vAlpha = pow(ratio, 0.4);
                        currentSize = aData.z * (1.0 - vAgeNorm * 0.3);

                        mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        mvPosition.xy += position.xy * currentSize;
                    }
                    // ── TYPE 5: ANAMORPHIC FLASH ───────────────────────────
                    else if (vType < 5.5) {
                        currentSize = aData.z * (0.5 + vAgeNorm * 0.5);
                        vColor = vec3(0.6, 0.85, 1.0) * 4.0;
                        vAlpha = pow(ratio, 4.0);

                        mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        mvPosition.xy += position.xy * currentSize;
                    }
                    // ── TYPE 6: PERCUSSIVE RING (płaski na XZ) ─────────────
                    else if (vType < 6.5) {
                        float waveCurve = pow(vAgeNorm, 0.3);
                        currentSize = aData.z * waveCurve;
                        vColor = vec3(0.4, 0.75, 1.0) * 2.5;
                        vAlpha = pow(1.0 - vAgeNorm, 2.0);

                        vec3 flatPos = pos;
                        flatPos.x += position.x * currentSize;
                        flatPos.z += position.y * currentSize; // XZ — poziomo
                        mvPosition = modelViewMatrix * vec4(flatPos, 1.0);
                    }
                    // ── TYPE 7: HOT DEBRIS CHUNK (obrót + grawitacja) ──────
                    else {
                        float drag = 1.0 + vSeed * 1.0;
                        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
                        pos.y -= 240.0 * age * age * (0.3 + vSeed);

                        vec3 hot  = vec3(1.0,  0.9,  0.7);
                        vec3 mid  = vec3(0.3,  0.6,  1.0);
                        vec3 cold = vec3(0.05, 0.15, 0.4);
                        if (vAgeNorm < 0.3)
                            vColor = mix(hot, mid, vAgeNorm / 0.3);
                        else
                            vColor = mix(mid, cold, (vAgeNorm - 0.3) / 0.7);
                        vColor *= 0.9;
                        vAlpha = pow(ratio, 0.7);
                        currentSize = aData.z * (1.0 - vAgeNorm * 0.5);

                        float spinSpeed = (vSeed - 0.5) * 12.0;
                        float spin = age * spinSpeed;
                        float c = cos(spin), s = sin(spin);
                        vec2 rotPos = vec2(
                            position.x * c - position.y * s,
                            position.x * s + position.y * c
                        );
                        mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        mvPosition.xy += rotPos * currentSize;
                    }

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3  vColor;
                varying float vAlpha;
                varying vec2  vUv;
                varying float vType;
                varying float vAgeNorm;
                varying float vSeed;
                uniform float uTime;

                ${noiseChunk}

                void main() {
                    vec2  uv   = vUv - vec2(0.5);
                    float dist = length(uv) * 2.0;

                    // TYPE 1: PUNCH FLASH — twarda kula + krzyż ─────────────
                    if (vType < 1.5) {
                        float core   = max(0.0, 1.0 - smoothstep(0.0, 0.4, dist));
                        float spikeY = max(0.0, 1.0 - smoothstep(0.0, 0.05, abs(uv.y))) * (1.0 - abs(uv.x) * 1.6);
                        float spikeX = max(0.0, 1.0 - smoothstep(0.0, 0.05, abs(uv.x))) * (1.0 - abs(uv.y) * 1.6);
                        float total  = core * 1.5 + spikeY + spikeX * 0.6;
                        gl_FragColor = vec4(vColor, total * vAlpha);
                    }
                    // TYPE 2: FIREBALL — poszarpany kłąb FBM ─────────────────
                    else if (vType < 2.5) {
                        if (dist > 1.0) discard;
                        vec3  np    = vec3(uv * 3.0, vSeed * 50.0 + uTime * 0.5);
                        float n     = fbm(np);
                        float radial = max(0.0, 1.0 - dist);
                        float lump  = smoothstep(0.0, 0.6, n + radial * 0.7 - 0.4);
                        gl_FragColor = vec4(vColor, lump * vAlpha);
                    }
                    // TYPE 3: TRAILED DEBRIS — smuga z białym czołem ──────────
                    else if (vType < 3.5) {
                        vec2  pt      = vUv - vec2(0.5);
                        float glowX   = pow(max(0.0, 0.5 - abs(pt.x)) * 2.0, 2.5);
                        float fadeY   = smoothstep(1.0, 0.85, vUv.y) * smoothstep(0.0, 0.15, vUv.y);
                        float head    = smoothstep(0.6, 0.95, vUv.y) * 1.5;
                        gl_FragColor  = vec4(vColor, glowX * (fadeY + head) * vAlpha);
                    }
                    // TYPE 4: SHRAPNEL — mały twardy punkt ───────────────────
                    else if (vType < 4.5) {
                        if (dist > 1.0) discard;
                        float core = max(0.0, 1.0 - smoothstep(0.0, 0.6, dist));
                        float halo = max(0.0, 1.0 - smoothstep(0.0, 1.0, dist)) * 0.3;
                        gl_FragColor = vec4(vColor, (core + halo) * vAlpha);
                    }
                    // TYPE 5: ANAMORPHIC FLASH ────────────────────────────────
                    else if (vType < 5.5) {
                        float core   = max(0.0, 1.0 - smoothstep(0.0, 0.25, dist));
                        float flareY = max(0.0, 1.0 - smoothstep(0.0, 0.015, abs(uv.y)));
                        float flareX = max(0.0, 1.0 - smoothstep(0.0, 0.55,  abs(uv.x)));
                        float flare  = flareY * flareX * 2.5;
                        float aura   = max(0.0, 1.0 - dist) * 0.5;
                        float fi     = max(0.0, core + flare + aura);
                        gl_FragColor = vec4(vColor * fi, fi * vAlpha);
                    }
                    // TYPE 6: PERCUSSIVE RING — cienki ostry okrąg ────────────
                    else if (vType < 6.5) {
                        if (dist > 1.0) discard;
                        float edge = max(0.0, 1.0 - smoothstep(0.0, 0.06, abs(dist - 0.85)));
                        float angle = atan(uv.y, uv.x);
                        float n    = 0.7 + 0.3 * fbm(vec3(angle * 8.0, dist * 3.0, uTime * 0.3));
                        gl_FragColor = vec4(vColor, edge * n * vAlpha);
                    }
                    // TYPE 7: HOT DEBRIS — nieregularny kawałek ───────────────
                    else {
                        vec3  np     = vec3(uv * 4.0, vSeed * 30.0);
                        float n      = fbm(np);
                        float radial = max(0.0, 1.0 - dist * 1.2);
                        float chunk  = smoothstep(0.45, 0.65, n * 0.6 + radial);
                        if (chunk < 0.05) discard;
                        float coreHot    = max(0.0, 1.0 - smoothstep(0.0, 0.4, dist)) * 1.5;
                        vec3  finalColor = vColor + vec3(0.5, 0.4, 0.2) * coreHot;
                        gl_FragColor = vec4(finalColor, chunk * vAlpha);
                    }
                }
            `,
            blending:    blendingType,
            depthWrite:  false,
            depthTest:   false,
            transparent: true,
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder   = 1000;
        scene.add(this.mesh);
    }

    spawn(x, y, z, vx, vy, vz, size, life, type, globalTime) {
        let i   = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        let i3  = i * 3, i4 = i * 4;

        this.startPos[i3]   = x;  this.startPos[i3+1] = y;  this.startPos[i3+2] = z;
        this.startVel[i3]   = vx; this.startVel[i3+1] = vy; this.startVel[i3+2] = vz;
        this.dataInfo[i4]   = globalTime;
        this.dataInfo[i4+1] = life;
        this.dataInfo[i4+2] = size;
        this.dataInfo[i4+3] = type;

        this.dirty = true;
    }

    update(gt) {
        this.material.uniforms.uTime.value = gt;
        if (this.dirty) {
            const geo = this.mesh.geometry;
            geo.attributes.aStartPos.needsUpdate = true;
            geo.attributes.aStartVel.needsUpdate = true;
            geo.attributes.aData.needsUpdate     = true;
            this.dirty = false;
        }
    }
}

// ─── GPU Particle Manager (NormalBlending — kłębiasty dym artyleryjski) ───────
class GPUParticleManager {
    constructor(scene, maxParticles, blendingType) {
        this.maxParticles = maxParticles;
        this.activeIndex  = 0;
        this.dirty        = false;

        const baseGeo = new THREE.PlaneGeometry(1, 1);
        const geo     = new THREE.InstancedBufferGeometry();
        geo.index = baseGeo.index;
        geo.setAttribute("position", baseGeo.attributes.position);
        geo.setAttribute("uv",       baseGeo.attributes.uv);

        this.startPos = new Float32Array(maxParticles * 3);
        this.startVel = new Float32Array(maxParticles * 3);
        this.dataInfo = new Float32Array(maxParticles * 4);

        geo.setAttribute("aStartPos", new THREE.InstancedBufferAttribute(this.startPos, 3));
        geo.setAttribute("aStartVel", new THREE.InstancedBufferAttribute(this.startVel, 3));
        geo.setAttribute("aData",     new THREE.InstancedBufferAttribute(this.dataInfo, 4));
        geo.instanceCount = maxParticles;

        this.material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                attribute vec3 aStartPos;
                attribute vec3 aStartVel;
                attribute vec4 aData;
                uniform float uTime;

                varying vec3  vColor;
                varying float vAlpha;
                varying vec2  vUv;
                varying float vAgeNorm;
                varying float vSeed;

                float hash(float n) { return fract(sin(n) * 43758.5453123); }

                void main() {
                    vUv  = uv;
                    vSeed = hash(aData.x);
                    float startTime = aData.x;
                    float maxLife   = aData.y;
                    float age       = uTime - startTime;

                    if (age < 0.0 || age > maxLife) {
                        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
                        return;
                    }

                    vAgeNorm = age / maxLife;
                    float waveCurve = pow(vAgeNorm, 0.5);
                    float currentSize = aData.z * (0.3 + waveCurve * 0.9);

                    vColor = vec3(0.03, 0.06, 0.13); // mroczny granat
                    vAlpha = pow(1.0 - vAgeNorm, 1.8) * 0.9;

                    vec3 pos = aStartPos + aStartVel * age;
                    pos.y   += age * 40.0 * vSeed; // lekkie unoszenie dymu

                    vec3 flatPos = pos;
                    flatPos.x += position.x * currentSize;
                    flatPos.z += position.y * currentSize; // XZ — poziomo
                    vec4 mvPosition = modelViewMatrix * vec4(flatPos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3  vColor;
                varying float vAlpha;
                varying vec2  vUv;
                varying float vAgeNorm;
                varying float vSeed;
                uniform float uTime;

                ${noiseChunk}

                void main() {
                    vec2  uv   = vUv - vec2(0.5);
                    float dist = length(uv) * 2.0;
                    if (dist > 1.0) discard;

                    float cloud = max(0.0, 1.0 - smoothstep(0.2, 1.0, dist));
                    vec3  np    = vec3(uv * 4.0 + vSeed * 30.0, uTime * 0.15);
                    float n     = fbm(np);
                    float lump  = smoothstep(0.0, 0.7, n * 0.7 + cloud);
                    gl_FragColor = vec4(vColor, lump * vAlpha);
                }
            `,
            blending:    blendingType,
            depthWrite:  false,
            depthTest:   false,
            transparent: true,
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder   = 999;
        scene.add(this.mesh);
    }

    spawn(x, y, z, vx, vy, vz, size, life, type, globalTime) {
        let i   = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        let i3  = i * 3, i4 = i * 4;

        this.startPos[i3]   = x;  this.startPos[i3+1] = y;  this.startPos[i3+2] = z;
        this.startVel[i3]   = vx; this.startVel[i3+1] = vy; this.startVel[i3+2] = vz;
        this.dataInfo[i4]   = globalTime;
        this.dataInfo[i4+1] = life;
        this.dataInfo[i4+2] = size;
        this.dataInfo[i4+3] = type;

        this.dirty = true;
    }

    update(gt) {
        this.material.uniforms.uTime.value = gt;
        if (this.dirty) {
            const geo = this.mesh.geometry;
            geo.attributes.aStartPos.needsUpdate = true;
            geo.attributes.aStartVel.needsUpdate = true;
            geo.attributes.aData.needsUpdate     = true;
            this.dirty = false;
        }
    }
}

// ─── FABRYKA TRAFIENIA DZIAŁA YAMATO ─────────────────────────────────────────
export function createYamatoImpactFactory(scene) {
    const fireSystem  = new GPUInstancedParticleManager(scene, 60000, THREE.AdditiveBlending);
    const smokeSystem = new GPUParticleManager(scene, 12000, THREE.NormalBlending);

    return function spawn({ x = 0, y = 0, z, size = 110, color = null, quality = 1 } = {}) {
        const q      = Math.max(0.55, Math.min(1.25, Number(quality) || 1));
        const worldZ = (z !== undefined) ? z : y;

        const group  = new THREE.Group();
        group.position.set(x, 0, worldZ);
        scene.add(group);

        // Pozycja epicentrum w układzie 3D gry
        const eX = x;
        const eY = 5;          // lekko ponad ziemią
        const eZ = worldZ;     // world Y → 3D Z

        // Skala wizualna — 4× mniejsza niż pierwotne wartości
        const S = size * 0.25;

        // ── Bloom (0.3 podczas efektu, przywracany po zakończeniu) ──────────
        const bloomLease = acquireYamatoBloomSuppression();

        // ── Światło ─────────────────────────────────────────────────────────
        const light = new THREE.PointLight(0x66ccff, 0, size * 5);
        light.position.set(eX, size * 0.3, eZ);
        scene.add(light);

        // ── Wstrząs kamery ────────────────────────────────────────────────────
        if (typeof window !== "undefined" && window.camera?.addShake &&
            window.ship && !window.ship.destroyed) {
            const dx   = (window.ship.pos?.x || 0) - x;
            const dy   = (window.ship.pos?.y || 0) - worldZ;
            const dist = Math.hypot(dx, dy);
            const radius = Math.max(400, size * 6);
            if (dist < radius) {
                const falloff = 1 - dist / radius;
                window.camera.addShake(5 * falloff * Math.min(1.1, q), 0.28);
            }
        }

        // ── 3D shockwave ─────────────────────────────────────────────────────
        const sw3d = (typeof window !== "undefined") ? window.trigger3DShockwave : null;
        if (typeof sw3d === "function") {
            sw3d(eX, 0, -eZ, Math.max(60, size * 1.3 * q), 0.5, 0x44aaff);
        }

        const initTime = performance.now() / 1000;
        let disposed   = false;

        // Opóźnienia wtórnych wybuchów (czas w sekundach, nie setTimeout)
        const secDelays = [0.08, 0.19, 0.30, 0.43].map(d => d + Math.random() * 0.06);
        let   secIdx    = 0;

        // ── Natychmiastowe cząsteczki przy uderzeniu ─────────────────────────
        const gt0 = initTime;

        // 1. Punch flash (typ 1)
        fireSystem.spawn(eX, eY, eZ, 0,0,0, S * 72, 0.18, 1, gt0);

        // 2. Anamorphic flash (typ 5)
        fireSystem.spawn(eX, eY, eZ, 0,0,0, S * 100, 0.5, 5, gt0);

        // 3. Percussive ring (typ 6)
        fireSystem.spawn(eX, eY, eZ, 0,0,0, S * 63, 0.35, 6, gt0);

        // 4. Kule ognia — kilkanaście kłębów (typ 2)
        for (let i = 0; i < Math.round(28 * q); i++) {
            const angle = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const speed = (1.8 + Math.random() * 7.5) * S;
            const vx = Math.sin(phi) * Math.cos(angle) * speed;
            const vy = Math.cos(phi) * speed * 0.4 + Math.random() * S * 0.5;
            const vz = Math.sin(phi) * Math.sin(angle) * speed;
            const sz = (10 + Math.random() * 14) * S;
            fireSystem.spawn(eX, eY, eZ, vx, vy, vz, sz, 0.8 + Math.random() * 0.6, 2, gt0);
        }

        // 5. Rozżarzone smugi odłamków (typ 3)
        for (let i = 0; i < Math.round(80 * q); i++) {
            const angle = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const speed = (35 + Math.random() * 110) * S;
            const vx = Math.sin(phi) * Math.cos(angle) * speed;
            const vy = Math.cos(phi) * speed * 0.35 + Math.random() * S * 3;
            const vz = Math.sin(phi) * Math.sin(angle) * speed;
            const sz = (0.5 + Math.random() * 0.75) * S;
            fireSystem.spawn(eX, eY, eZ, vx, vy, vz, sz, 0.6 + Math.random() * 0.5, 3, gt0);
        }

        // 6. Duże obrotowe fragmenty (typ 7)
        for (let i = 0; i < Math.round(16 * q); i++) {
            const angle = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const speed = (13 + Math.random() * 36) * S;
            const vx = Math.sin(phi) * Math.cos(angle) * speed;
            const vy = Math.cos(phi) * speed * 0.5 + Math.random() * S * 2;
            const vz = Math.sin(phi) * Math.sin(angle) * speed;
            const sz = (1.8 + Math.random() * 3.2) * S;
            fireSystem.spawn(eX, eY, eZ, vx, vy, vz, sz, 1.2 + Math.random() * 0.8, 7, gt0);
        }

        // 7. Shrapnel (typ 4) — balistyczne odłamki z grawitacją
        for (let i = 0; i < Math.round(350 * q); i++) {
            const angle = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const speed = (22 + Math.random() * 82) * S;
            const vx = Math.sin(phi) * Math.cos(angle) * speed;
            const vy = Math.cos(phi) * speed * 0.6 + Math.random() * S * 13;
            const vz = Math.sin(phi) * Math.sin(angle) * speed;
            const sz = (0.13 + Math.random() * 0.22) * S;
            fireSystem.spawn(eX, eY, eZ, vx, vy, vz, sz, 1.0 + Math.random() * 1.5, 4, gt0);
        }

        // 8. Kłęby dymu
        for (let i = 0; i < Math.round(25 * q); i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist  = Math.random() * 1.5 * S;
            const sx    = eX + Math.cos(angle) * dist;
            const sz2   = eZ + Math.sin(angle) * dist;
            const speed = (2.5 + Math.random() * 7) * S;
            const vx = Math.cos(angle) * speed;
            const vz = Math.sin(angle) * speed;
            const smkSz = (26 + Math.random() * 26) * S;
            smokeSystem.spawn(sx, eY, sz2, vx, 0, vz, smkSz, 1.5 + Math.random() * 1.2, 1, gt0);
        }

        // ── update ────────────────────────────────────────────────────────────
        function update(dt) {
            if (disposed) return;

            const gt   = performance.now() / 1000;
            const time = gt - initTime;

            fireSystem.update(gt);
            smokeSystem.update(gt);

            // światło zanika po 0.4 s
            light.intensity = Math.max(0, 8 * (1 - time / 0.4));

            // ── wtórne łańcuchowe mini-wybuchy ──────────────────────────────
            while (secIdx < 4 && time >= secDelays[secIdx]) {
                const si    = secIdx++;
                const pAngle = Math.random() * Math.PI * 2;
                const pDist  = (7 + Math.random() * 20) * S;
                const px     = eX + Math.cos(pAngle) * pDist;
                const pz     = eZ + Math.sin(pAngle) * pDist;
                const ps     = 0.35 + Math.random() * 0.35;

                // mini punch
                fireSystem.spawn(px, eY, pz, 0,0,0, S * 36 * ps, 0.13, 1, gt);
                // mini ring
                fireSystem.spawn(px, eY, pz, 0,0,0, S * 28 * ps, 0.25, 6, gt);
                // mini kule
                for (let k = 0; k < 8; k++) {
                    const a  = Math.random() * Math.PI * 2;
                    const sp = (3 + Math.random() * 7) * S;
                    fireSystem.spawn(px, eY, pz,
                        Math.cos(a)*sp, Math.random()*S*2, Math.sin(a)*sp,
                        (5 + Math.random() * 7) * S * ps, 0.5 + Math.random() * 0.4, 2, gt);
                }
                // mini shrapnel
                for (let k = 0; k < 45; k++) {
                    const a   = Math.random() * Math.PI * 2;
                    const phi = Math.acos(2 * Math.random() - 1);
                    const sp  = (12 + Math.random() * 40) * S;
                    fireSystem.spawn(px, eY, pz,
                        Math.sin(phi)*Math.cos(a)*sp,
                        Math.cos(phi)*sp*0.5,
                        Math.sin(phi)*Math.sin(a)*sp,
                        (0.1 + Math.random() * 0.18) * S, 0.8 + Math.random() * 1.0, 4, gt);
                }
                // mini dym
                smokeSystem.spawn(px, eY, pz, 0,0,0, (14 + Math.random() * 12) * S * ps,
                    1.0 + Math.random() * 0.8, 1, gt);
            }

            if (time >= 1.6) dispose();
        }

        function dispose() {
            if (disposed) return;
            disposed = true;
            if (group.parent) group.parent.remove(group);
            if (light.parent)  light.parent.remove(light);
            releaseYamatoBloomSuppression(bloomLease);
        }

        return { group, update, dispose, important: true };
    };
}

// ─── Bloom suppression: redukuje do 0.3 podczas efektu ───────────────────────
function acquireYamatoBloomSuppression() {
    if (typeof window === "undefined") return null;
    const overlay = window.overlay3D;
    if (!overlay?.getBloomConfig || !overlay?.setBloomConfig) return null;

    const state = (window.__yamatoBloomSuppression =
        window.__yamatoBloomSuppression || { count: 0, previous: null });

    if (state.count === 0) {
        state.previous = overlay.getBloomConfig();
        overlay.setBloomConfig({ strength: 0.3 });
    }
    state.count += 1;
    return state;
}

function releaseYamatoBloomSuppression(state) {
    if (!state || typeof window === "undefined") return;
    const overlay = window.overlay3D;
    if (!overlay?.setBloomConfig) return;

    state.count = Math.max(0, state.count - 1);
    if (state.count === 0 && state.previous) {
        overlay.setBloomConfig(state.previous);
        state.previous = null;
    }
}
