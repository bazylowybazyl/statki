import * as THREE from "three";

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

class NovaAdditiveParticleManager {
    constructor(scene, maxParticles) {
        this.maxParticles = maxParticles;
        this.activeIndex = 0;

        const baseGeo = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = baseGeo.index;
        geo.setAttribute("position", baseGeo.attributes.position);
        geo.setAttribute("uv", baseGeo.attributes.uv);

        this.startPos = new Float32Array(maxParticles * 3);
        this.startVel = new Float32Array(maxParticles * 3);
        this.dataInfo = new Float32Array(maxParticles * 4);

        geo.setAttribute("aStartPos", new THREE.InstancedBufferAttribute(this.startPos, 3));
        geo.setAttribute("aStartVel", new THREE.InstancedBufferAttribute(this.startVel, 3));
        geo.setAttribute("aData", new THREE.InstancedBufferAttribute(this.dataInfo, 4));
        geo.instanceCount = maxParticles;

        this.material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                attribute vec3 aStartPos;
                attribute vec3 aStartVel;
                attribute vec4 aData;

                uniform float uTime;

                varying vec3 vColor;
                varying float vAlpha;
                varying vec2 vUv;
                varying float vType;
                varying float vAgeNorm;

                float hash(float n) { return fract(sin(n) * 43758.5453123); }

                void main() {
                    vUv = uv;
                    vType = aData.w;
                    float startTime = aData.x;
                    float maxLife = aData.y;
                    float age = uTime - startTime;

                    if (age < 0.0 || age > maxLife) {
                        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
                        return;
                    }

                    float ratio = 1.0 - (age / maxLife);
                    vAgeNorm = age / maxLife;

                    vec3 pos = aStartPos + aStartVel * age;
                    float currentSize = aData.z;
                    vec4 mvPosition;

                    if (vType < 4.5) {
                        float drag = 3.5 + hash(aData.x) * 2.0;
                        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
                        vec3 currentVel = aStartVel * exp(-age * drag);
                        float speed = length(currentVel);

                        vec3 hot = vec3(1.0, 1.0, 1.0) * 5.0;
                        vec3 cold = vec3(1.0, 0.2, 0.8) * 2.0;
                        vColor = mix(hot, cold, pow(vAgeNorm, 0.5));
                        vAlpha = pow(ratio, 0.5) * 1.5;

                        mvPosition = modelViewMatrix * vec4(pos, 1.0);

                        vec3 viewVel = (modelViewMatrix * vec4(currentVel, 0.0)).xyz;
                        vec2 dir = normalize(viewVel.xy);
                        if (length(viewVel.xy) < 0.1) dir = vec2(0.0, 1.0);

                        float width = aData.z;
                        float stretch = aData.z * speed * 0.0015;
                        float tailFactor = 0.5 - position.y;

                        vec2 scaledOffset;
                        scaledOffset.x = position.x * width;
                        scaledOffset.y = -tailFactor * stretch;

                        vec2 rotatedOffset;
                        rotatedOffset.x = scaledOffset.x * dir.y + scaledOffset.y * dir.x;
                        rotatedOffset.y = -scaledOffset.x * dir.x + scaledOffset.y * dir.y;

                        mvPosition.xy += rotatedOffset;
                    } else if (vType < 5.5) {
                        currentSize = aData.z * (0.5 + vAgeNorm * 0.5);
                        vColor = vec3(0.5, 1.0, 1.0) * 10.0;
                        vAlpha = pow(ratio, 3.0);

                        mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        mvPosition.xy += position.xy * currentSize;
                    } else {
                        float waveCurve = pow(vAgeNorm, 0.4);
                        currentSize = aData.z * waveCurve;
                        vColor = vec3(0.9, 0.1, 1.0) * 4.0;
                        vAlpha = pow(1.0 - vAgeNorm, 1.5);

                        vec3 flatPos = pos;
                        flatPos.x += position.x * currentSize;
                        flatPos.z += position.y * currentSize;
                        mvPosition = modelViewMatrix * vec4(flatPos, 1.0);
                    }

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                varying vec2 vUv;
                varying float vType;
                varying float vAgeNorm;
                uniform float uTime;

                ${noiseChunk}

                void main() {
                    vec2 uv = vUv - vec2(0.5);
                    float dist = length(uv) * 2.0;

                    if (vType < 4.5) {
                        vec2 pt = vUv - vec2(0.5);
                        float glowX = pow(max(0.0, 0.5 - abs(pt.x)) * 2.0, 3.0);
                        float fadeY = smoothstep(1.0, 0.8, vUv.y) * smoothstep(0.0, 0.2, vUv.y);
                        float baseAlpha = glowX * fadeY;
                        float twinkle = pow(sin(uTime * 30.0 + vColor.g * 100.0 + pt.x * 10.0), 2.0);
                        float twinkleBlend = smoothstep(0.05, 0.15, vAgeNorm);
                        baseAlpha *= mix(1.0, twinkle, twinkleBlend);
                        gl_FragColor = vec4(vColor, baseAlpha * vAlpha);
                    } else if (vType < 5.5) {
                        float core = max(0.0, 1.0 - smoothstep(0.0, 0.3, dist));
                        float flareY = max(0.0, 1.0 - smoothstep(0.0, 0.02, abs(uv.y)));
                        float flareX = max(0.0, 1.0 - smoothstep(0.0, 0.5, abs(uv.x)));
                        float flare = flareY * flareX * 2.0;
                        float aura = max(0.0, 1.0 - dist);
                        float finalIntensity = max(0.0, core + flare + aura * 0.3);
                        gl_FragColor = vec4(vColor * finalIntensity, finalIntensity * vAlpha);
                    } else {
                        if (dist > 1.0) discard;
                        float ringShape = max(0.0, 1.0 - smoothstep(0.0, 0.15, abs(dist - 0.7)));
                        float angle = atan(uv.y, uv.x);
                        float n = fbm(vec3(angle * 10.0, dist * 5.0 - uTime * 2.0, uTime));
                        float finalRing = ringShape * (n * 2.5);
                        float innerGlow = max(0.0, smoothstep(0.0, 0.8, dist)) * 0.2;
                        gl_FragColor = vec4(vColor, (finalRing + innerGlow) * vAlpha);
                    }
                }
            `,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            transparent: true
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1000;
        scene.add(this.mesh);
    }

    spawn(x, y, z, vx, vy, vz, size, life, type, globalTime) {
        const i = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        const i3 = i * 3;
        const i4 = i * 4;

        this.startPos[i3] = x; this.startPos[i3 + 1] = y; this.startPos[i3 + 2] = z;
        this.startVel[i3] = vx; this.startVel[i3 + 1] = vy; this.startVel[i3 + 2] = vz;
        this.dataInfo[i4] = globalTime;
        this.dataInfo[i4 + 1] = life;
        this.dataInfo[i4 + 2] = size;
        this.dataInfo[i4 + 3] = type;

        const geo = this.mesh.geometry;
        geo.attributes.aStartPos.needsUpdate = true;
        geo.attributes.aStartVel.needsUpdate = true;
        geo.attributes.aData.needsUpdate = true;
    }

    update(globalTime) {
        this.material.uniforms.uTime.value = globalTime;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.material.dispose();
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    }
}

class NovaDarkShockwaveManager {
    constructor(scene, maxParticles) {
        this.maxParticles = maxParticles;
        this.activeIndex = 0;

        const baseGeo = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = baseGeo.index;
        geo.setAttribute("position", baseGeo.attributes.position);
        geo.setAttribute("uv", baseGeo.attributes.uv);

        this.startPos = new Float32Array(maxParticles * 3);
        this.startVel = new Float32Array(maxParticles * 3);
        this.dataInfo = new Float32Array(maxParticles * 4);

        geo.setAttribute("aStartPos", new THREE.InstancedBufferAttribute(this.startPos, 3));
        geo.setAttribute("aStartVel", new THREE.InstancedBufferAttribute(this.startVel, 3));
        geo.setAttribute("aData", new THREE.InstancedBufferAttribute(this.dataInfo, 4));
        geo.instanceCount = maxParticles;

        this.material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                attribute vec3 aStartPos;
                attribute vec3 aStartVel;
                attribute vec4 aData;
                uniform float uTime;

                varying vec2 vUv;
                varying float vAgeNorm;

                void main() {
                    vUv = uv;
                    float startTime = aData.x;
                    float maxLife = aData.y;
                    float age = uTime - startTime;

                    if (age < 0.0 || age > maxLife) {
                        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
                        return;
                    }

                    vAgeNorm = age / maxLife;
                    float waveCurve = pow(vAgeNorm, 0.4);
                    float currentSize = aData.z * waveCurve;

                    vec3 flatPos = aStartPos;
                    flatPos.x += position.x * currentSize;
                    flatPos.z += position.y * currentSize;
                    vec4 mvPosition = modelViewMatrix * vec4(flatPos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                varying float vAgeNorm;
                uniform float uTime;

                ${noiseChunk}

                void main() {
                    vec2 uv = vUv - vec2(0.5);
                    float dist = length(uv) * 2.0;
                    if (dist > 1.0) discard;

                    float ringShape = max(0.0, 1.0 - smoothstep(0.0, 0.4, abs(dist - 0.7)));
                    float angle = atan(uv.y, uv.x);
                    float n = fbm(vec3(angle * 12.0, dist * 3.0 - uTime, uTime * 0.5));
                    float alpha = ringShape * n * pow(1.0 - vAgeNorm, 2.0) * 0.9;
                    gl_FragColor = vec4(vec3(0.05, 0.05, 0.15), alpha);
                }
            `,
            blending: THREE.NormalBlending,
            depthWrite: false,
            depthTest: false,
            transparent: true
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 999;
        scene.add(this.mesh);
    }

    spawn(x, y, z, size, life, globalTime) {
        const i = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        const i3 = i * 3;
        const i4 = i * 4;

        this.startPos[i3] = x; this.startPos[i3 + 1] = y; this.startPos[i3 + 2] = z;
        this.startVel[i3] = 0; this.startVel[i3 + 1] = 0; this.startVel[i3 + 2] = 0;
        this.dataInfo[i4] = globalTime;
        this.dataInfo[i4 + 1] = life;
        this.dataInfo[i4 + 2] = size;
        this.dataInfo[i4 + 3] = 1;

        const geo = this.mesh.geometry;
        geo.attributes.aStartPos.needsUpdate = true;
        geo.attributes.aStartVel.needsUpdate = true;
        geo.attributes.aData.needsUpdate = true;
    }

    update(globalTime) {
        this.material.uniforms.uTime.value = globalTime;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.material.dispose();
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    }
}

export function createSupernovaMissileBlowFactory(scene) {
    const fireParticleSystem = new NovaAdditiveParticleManager(scene, 140000);
    const darkShockwaveSystem = new NovaDarkShockwaveManager(scene, 12000);

    return function spawn({ x = 0, y = 0, size = 60 } = {}) {
        const group = new THREE.Group();
        group.position.set(x, 0, y);
        scene.add(group);

        const light = new THREE.PointLight(0xff66ee, 0, size * 18);
        light.position.set(0, size * 0.45, 0);
        group.add(light);

        const expX = x;
        const expY = 5;
        const expZ = y;
        const initTime = performance.now() / 1000;
        let sparksSpawned = false;
        let disposed = false;

        fireParticleSystem.spawn(expX, expY, expZ + size * 0.15, 0, 0, 0, size * 12, 1.2, 5, initTime);
        fireParticleSystem.spawn(expX, expY, expZ + size * 0.05, 0, 0, 0, size * 17, 1.5, 6, initTime);
        darkShockwaveSystem.spawn(expX, expY, expZ, size * 19, 1.6, initTime);

        function pushHeatHaze(gt, expTime) {
            if (typeof window === "undefined" || !window.Core3D || expTime >= 1.8) return;
            const core = window.Core3D;
            if (core._lastHeatHazeFrame !== gt) {
                core._lastHeatHazeFrame = gt;
                core.beginHeatHazeFrame?.();
            }
            const currentRadius = size * 2 + (expTime * size * 25);
            const distortionStrength = Math.max(0, 1.0 - (expTime / 1.8)) * 6.0;
            core.pushHeatHazeWorld?.(expX, expZ, -4, currentRadius, distortionStrength);
        }

        function spawnNovaSparks(gt) {
            for (let i = 0; i < 3000; i++) {
                const speed = (size * 80) + Math.random() * (size * 220);
                const angle = Math.random() * Math.PI * 2;
                const vx = Math.cos(angle) * speed;
                const vz = Math.sin(angle) * speed;
                const startDist = Math.random() * size * 24;
                const startX = expX + Math.cos(angle) * startDist;
                const startZ = expZ + Math.sin(angle) * startDist;
                fireParticleSystem.spawn(
                    startX,
                    expY + size * 0.18,
                    startZ,
                    vx,
                    0,
                    vz,
                    size * (0.08 + Math.random() * 0.12),
                    2.5 + Math.random() * 3.0,
                    4,
                    gt
                );
            }
        }

        function update() {
            if (disposed) return;

            const gt = performance.now() / 1000;
            const expTime = gt - initTime;

            fireParticleSystem.update(gt);
            darkShockwaveSystem.update(gt);

            pushHeatHaze(gt, expTime);

            if (!sparksSpawned && expTime >= 1.0) {
                sparksSpawned = true;
                spawnNovaSparks(gt);
            }

            light.intensity = Math.max(0, 12.0 * (1.0 - expTime / 1.5));

            if (expTime > 4.6) dispose();
        }

        function dispose() {
            if (disposed) return;
            disposed = true;
            if (group.parent) group.parent.remove(group);
        }

        return { group, update, dispose, important: true };
    };
}
