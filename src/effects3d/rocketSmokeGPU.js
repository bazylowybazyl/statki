/**
 * GPU Point-sprite Particle System for rocket smoke / exhaust haze.
 * Ported from rakiety.html GPUParticleManager.
 * Coordinate system: Y-up (overlay convention).
 *
 * Kept as close as practical to rakiety.html, with only zoom scaling
 * adapted for the overlay orthographic camera used in the game.
 */
import * as THREE from "three";

/* ── World scale (must match rocketFireGPU.js) ── */
const WS = 0.1;

export class RocketSmokeGPU {
    /**
     * @param {THREE.Scene} scene  — overlay scene
     * @param {number} maxParticles — ring-buffer capacity
     */
    constructor(scene, maxParticles = 200000) {
        this.maxParticles = maxParticles;
        this.activeIndex = 0;
        this._time = 0;

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
                u_zoom:       { value: 1.0 }
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

                varying vec3  vColor;
                varying float vAlpha;

                void main() {
                    float startTime = aData.x;
                    float maxLife   = aData.y;
                    float age       = uTime - startTime;

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

                    float currentSize = u_smokeSize + age * 600.0 * u_worldScale;

                    vColor = vec3(0.42, 0.38, 0.34);
                    vAlpha = smoothstep(0.0, 0.2, ageNorm) * ratio * 0.95;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    // Point sprites are sized in screen pixels, so they must follow
                    // orthographic zoom directly. A large floor here makes smoke
                    // appear bigger and bigger relative to the world when zooming out.
                    float zoomScale = clamp(u_zoom, 0.01, 1.0);
                    gl_PointSize = max(1.0, currentSize * zoomScale);
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

        const geo = this.points.geometry;
        geo.attributes.aStartPos.needsUpdate = true;
        geo.attributes.aStartVel.needsUpdate = true;
        geo.attributes.aData.needsUpdate     = true;
    }

    /** Update shader time uniform. Call once per frame BEFORE spawn(). */
    update(globalTime) {
        this._time = globalTime;
        this.material.uniforms.uTime.value = globalTime;
    }

    dispose() {
        this.points.geometry.dispose();
        this.material.dispose();
        if (this.material.uniforms.uTexture.value) this.material.uniforms.uTexture.value.dispose();
        if (this.points.parent) this.points.parent.remove(this.points);
    }
}
