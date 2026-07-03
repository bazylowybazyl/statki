/**
 * GPU Point-sprite Particle System for rocket smoke / exhaust haze.
 * Ported from rakiety.html GPUParticleManager.
 * Coordinate system: Y-up (overlay convention).
 *
 * Kept as close as practical to rakiety.html, with only zoom scaling
 * adapted for the overlay orthographic camera used in the game.
 *
 * Smoke types:
 *   1 = default warm exhaust smoke
 *   2 = chemical red/purple/pink smoke
 */
import * as THREE from "three";

/* ── World scale (must match rocketFireGPU.js) ── */
const WS = 0.1;

/** Ustaw zakres uploadu atrybutu (nowe i stare API three). */
function applyAttrRange(attr, start, count) {
    if (!attr) return;
    if (typeof attr.clearUpdateRanges === 'function') {
        attr.clearUpdateRanges();
        attr.addUpdateRange(start, count);
    } else {
        if (!attr.updateRange) attr.updateRange = { offset: 0, count: -1 };
        attr.updateRange.offset = start;
        attr.updateRange.count = count;
    }
    attr.needsUpdate = true;
}

export class RocketSmokeGPU {
    /**
     * @param {THREE.Scene} scene  — overlay scene
     * @param {number} maxParticles — ring-buffer capacity
     */
    constructor(scene, maxParticles = 200000) {
        this.maxParticles = maxParticles;
        this.activeIndex = 0;
        this._time = 0;
        // Dirty-span spawnów między commitami + znak wodny żywych cząstek.
        this._dirtyMin = Infinity;
        this._dirtyMax = -1;
        this._dirtyWrapped = false;
        this.highWater = 0;
        this._lastSpawnTime = -Infinity;
        this._maxLifeSeen = 0;

        /* ── Points geometry ── */
        const geo = new THREE.BufferGeometry();
        this.startPos = new Float32Array(maxParticles * 3);
        this.startVel = new Float32Array(maxParticles * 3);
        this.dataInfo = new Float32Array(maxParticles * 4);
        const dummyPos = new Float32Array(maxParticles * 3);

        geo.setAttribute("position",  new THREE.BufferAttribute(dummyPos,       3));
        geo.setAttribute("aStartPos", new THREE.BufferAttribute(this.startPos,  3));
        geo.setAttribute("aStartVel", new THREE.BufferAttribute(this.startVel,  3));
        geo.setAttribute("aData",     new THREE.BufferAttribute(this.dataInfo,  4));

        /* ── Soft radial gradient texture ── */
        const canvas = document.createElement("canvas");
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext("2d");
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0,   "rgba(255,255,255,1)");
        grad.addColorStop(0.2, "rgba(255,255,255,0.8)");
        grad.addColorStop(0.5, "rgba(255,255,255,0.2)");
        grad.addColorStop(1,   "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        const texture = new THREE.CanvasTexture(canvas);

        const smokeSize = 180 * WS;   // 18 game units

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime:        { value: 0 },
                uTexture:     { value: texture },
                u_smokeSize:  { value: smokeSize },
                u_worldScale: { value: WS },
                u_zoom:       { value: 1.0 },
                u_dpr:        { value: 1.0 }
            },

            /* ─── VERTEX SHADER ─── */
            vertexShader: /* glsl */ `
                attribute vec3 aStartPos;
                attribute vec3 aStartVel;
                attribute vec4 aData;

                uniform float uTime;
                uniform float u_smokeSize;
                uniform float u_worldScale;
                uniform float u_zoom;
                uniform float u_dpr;

                varying vec3  vColor;
                varying float vAlpha;

                void main() {
                    float startTime = aData.x;
                    float maxLife   = aData.y;
                    float age       = uTime - startTime;
                    float smokeType = aData.w;

                    if (age < 0.0 || age > maxLife) {
                        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
                        gl_PointSize = 0.0;
                        return;
                    }

                    float ratio   = 1.0 - (age / maxLife);
                    float ageNorm = age / maxLife;

                    // Noise dispersion on horizontal plane (XZ in Y-up)
                    float noiseX = sin(age * 10.0 + aStartPos.z * 0.02) * 20.0 * u_worldScale;
                    float noiseZ = cos(age * 12.0 + aStartPos.x * 0.02) * 20.0 * u_worldScale;

                    vec3 pos = aStartPos + aStartVel * age;
                    pos.x += noiseX * age * 2.0;
                    pos.z += noiseZ * age * 2.0;

                    // Buoyancy (smoke rises in +Y)
                    pos.y += (80.0 * u_worldScale) * age + age * age * (150.0 * u_worldScale);

                    float smokeScale = max(0.05, aData.z);
                    float currentSize = smokeScale * (u_smokeSize + age * 600.0 * u_worldScale);

                    if (smokeType >= 1.5) {
                        vec3 chemA = vec3(0.72, 0.16, 0.24);
                        vec3 chemB = vec3(0.62, 0.18, 0.74);
                        vec3 chemC = vec3(0.96, 0.36, 0.72);
                        vec3 chemMix = mix(chemA, chemB, smoothstep(0.0, 0.6, ageNorm));
                        vColor = mix(chemMix, chemC, smoothstep(0.35, 1.0, ageNorm));
                    } else {
                        vColor = vec3(0.42, 0.38, 0.34);
                    }
                    vAlpha = smoothstep(0.0, 0.2, ageNorm) * ratio * 0.95;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    // Point sprites are in screen pixels. Multiply by zoom so they
                    // shrink proportionally with the orthographic projection.
                    float zoomScale = max(0.01, u_zoom);
                    gl_PointSize = max(0.5, currentSize * zoomScale * u_dpr);
                    gl_Position  = projectionMatrix * mvPosition;
                }
            `,

            /* ─── FRAGMENT SHADER ─── */
            fragmentShader: /* glsl */ `
                uniform sampler2D uTexture;
                varying vec3  vColor;
                varying float vAlpha;

                void main() {
                    vec4 texColor = texture2D(uTexture, gl_PointCoord);
                    gl_FragColor  = vec4(vColor, texColor.a * vAlpha);
                }
            `,

            blending:    THREE.NormalBlending,
            depthWrite:  false,
            depthTest:   true,
            transparent: true
        });

        // Rysuj tylko użyty fragment ring-buffera (0 na starcie), nie całe 200k punktów.
        geo.setDrawRange(0, 0);

        this.points = new THREE.Points(geo, this.material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 999;
        scene.add(this.points);
    }

    /** Spawn one smoke particle. */
    spawn(x, y, z, vx, vy, vz, size, life, type) {
        const i  = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        const i3 = i * 3, i4 = i * 4;

        this.startPos[i3]   = x;  this.startPos[i3+1] = y;  this.startPos[i3+2] = z;
        this.startVel[i3]   = vx; this.startVel[i3+1] = vy; this.startVel[i3+2] = vz;

        this.dataInfo[i4]   = this._time;
        this.dataInfo[i4+1] = life;
        this.dataInfo[i4+2] = size;
        this.dataInfo[i4+3] = type;

        // NIE ustawiamy tu needsUpdate na całych buforach (200k cząstek ≈ 8 MB
        // na klatkę przy dymiącej rakiecie). Dirty-span + commit() raz na klatkę.
        if (i < this._dirtyMin) this._dirtyMin = i;
        if (i > this._dirtyMax) this._dirtyMax = i;
        if (this.activeIndex === 0) this._dirtyWrapped = true;
        if (i + 1 > this.highWater) this.highWater = i + 1;
        this._lastSpawnTime = this._time;
        if (life > this._maxLifeSeen) this._maxLifeSeen = life;
    }

    /** Wyślij na GPU zakres zespawnowany od ostatniego commit(). Raz na klatkę. */
    commit() {
        if (this._dirtyMax < this._dirtyMin && !this._dirtyWrapped) return;
        const geo = this.points.geometry;
        const start = this._dirtyWrapped ? 0 : this._dirtyMin;
        const count = this._dirtyWrapped ? this.maxParticles : (this._dirtyMax - this._dirtyMin + 1);
        applyAttrRange(geo.attributes.aStartPos, start * 3, count * 3);
        applyAttrRange(geo.attributes.aStartVel, start * 3, count * 3);
        applyAttrRange(geo.attributes.aData, start * 4, count * 4);
        geo.setDrawRange(0, this.highWater);
        this._dirtyMin = Infinity;
        this._dirtyMax = -1;
        this._dirtyWrapped = false;
    }

    /** Update shader time uniform. Call once per frame BEFORE spawn(). */
    update(globalTime) {
        this._time = globalTime;
        this.material.uniforms.uTime.value = globalTime;
        // Wszystkie cząstki wygasły → zeruj draw range i zacznij bufor od zera.
        if (this.highWater > 0 && (globalTime - this._lastSpawnTime) > (this._maxLifeSeen + 0.5)) {
            this.highWater = 0;
            this.activeIndex = 0;
            this._maxLifeSeen = 0;
            this.points.geometry.setDrawRange(0, 0);
        }
    }

    dispose() {
        this.points.geometry.dispose();
        this.material.dispose();
        if (this.material.uniforms.uTexture.value) this.material.uniforms.uTexture.value.dispose();
        if (this.points.parent) this.points.parent.remove(this.points);
    }
}
