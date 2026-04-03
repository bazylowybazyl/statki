/**
 * GPU Instanced Particle System for rocket fire, explosions, sparks, shockwaves.
 * Ported 1:1 from rakiety.html GPUInstancedParticleManager.
 * Coordinate system: Y-up (overlay convention).
 *
 * Particle types:
 *   0 = main fire (exhaust flame)
 *   2 = RCS thruster (blue)
 *   3 = explosion core
 *   4 = sparks / shrapnel
 *   5 = shockwave ring (flat in XZ)
 */
import * as THREE from "three";

/* ── World scale: maps rakiety.html units → game world units ── */
const WS = 0.1;

/* ── Tunable flame settings (game-scaled from rakiety.html originals) ── */
export const FlameSettings = {
    stretchMult:   1.5,
    velMult:       0.10,
    startSize:     28.0,
    growth:        1.0,
    life:          0.25,           // seconds
    hdrIntensity:  3.5,
    fireAlpha:     0.60,
    explosionSize: 1.0,
    worldScale:    WS
};

const OVERLAY_HDR_COMP = 0.24;
const OVERLAY_ALPHA_COMP = 0.82;

export class RocketFireGPU {
    /**
     * @param {THREE.Scene} scene  — overlay scene to add mesh to
     * @param {number} maxParticles — ring-buffer capacity
     */
    constructor(scene, maxParticles = 300000) {
        this.maxParticles = maxParticles;
        this.activeIndex = 0;
        this._time = 0;

        /* ── Geometry: instanced quads ── */
        const baseGeo = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = baseGeo.index;
        geo.setAttribute("position", baseGeo.attributes.position);
        geo.setAttribute("uv", baseGeo.attributes.uv);

        this.startPos = new Float32Array(maxParticles * 3);
        this.startVel = new Float32Array(maxParticles * 3);
        this.dataInfo = new Float32Array(maxParticles * 4); // startTime, life, size, type

        geo.setAttribute("aStartPos", new THREE.InstancedBufferAttribute(this.startPos, 3));
        geo.setAttribute("aStartVel", new THREE.InstancedBufferAttribute(this.startVel, 3));
        geo.setAttribute("aData",     new THREE.InstancedBufferAttribute(this.dataInfo, 4));

        /* ── Soft radial gradient texture ── */
        const canvas = document.createElement("canvas");
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext("2d");
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0,   "rgba(255,255,255,1)");
        grad.addColorStop(0.3, "rgba(255,255,255,0.7)");
        grad.addColorStop(0.6, "rgba(255,255,255,0.1)");
        grad.addColorStop(1,   "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        const texture = new THREE.CanvasTexture(canvas);

        /* ── ShaderMaterial ── */
        const FS = FlameSettings;
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime:           { value: 0 },
                uTexture:        { value: texture },
                u_startSize:     { value: FS.startSize },
                u_growth:        { value: FS.growth },
                u_hdrIntensity:  { value: FS.hdrIntensity },
                u_fireAlpha:     { value: FS.fireAlpha },
                u_stretchMult:   { value: FS.stretchMult },
                u_explosionSize: { value: FS.explosionSize },
                u_worldScale:    { value: FS.worldScale },
                u_overlayHdrComp:   { value: OVERLAY_HDR_COMP },
                u_overlayAlphaComp: { value: OVERLAY_ALPHA_COMP }
            },

            /* ─── VERTEX SHADER ─── */
            vertexShader: /* glsl */ `
                attribute vec3 aStartPos;
                attribute vec3 aStartVel;
                attribute vec4 aData;   // x=startTime, y=life, z=size, w=type

                uniform float uTime;
                uniform float u_startSize;
                uniform float u_growth;
                uniform float u_hdrIntensity;
                uniform float u_fireAlpha;
                uniform float u_stretchMult;
                uniform float u_explosionSize;
                uniform float u_worldScale;
                uniform float u_overlayHdrComp;
                uniform float u_overlayAlphaComp;

                varying vec3  vColor;
                varying float vAlpha;
                varying vec2  vUv;
                varying float vType;

                void main() {
                    vUv   = uv;
                    vType = aData.w;
                    float startTime = aData.x;
                    float maxLife   = aData.y;
                    float type      = aData.w;
                    float age       = uTime - startTime;

                    if (age < 0.0 || age > maxLife) {
                        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
                        return;
                    }

                    float ratio   = 1.0 - (age / maxLife);
                    float ageNorm = age / maxLife;

                    vec3  pos         = aStartPos + aStartVel * age;
                    float currentSize = aData.z;
                    float stretchFactor = 1.0;

                    // ── FIRE (type 0) ──
                    if (type < 0.5) {
                        float flameScale = max(0.05, aData.z);
                        float shape = 1.0 - pow(ageNorm, 2.5);
                        float mach  = 1.0 + sin(ageNorm * 30.0) * 0.3 * (1.0 - ageNorm);
                        currentSize = u_startSize * flameScale * shape * mach * (1.0 + ageNorm * u_growth);

                        // Turbulence on horizontal plane (X, Z in Y-up)
                        float scatter = pow(ageNorm, 3.0) * 60.0 * u_worldScale;
                        pos.x += sin(age * 50.0 + aStartPos.y) * scatter;
                        pos.z += cos(age * 43.0 + aStartPos.x) * scatter;

                        vec3 fireCore = vec3(1.0, 0.9, 0.6);
                        vec3 fireEdge = vec3(1.0, 0.1, 0.0);
                        vColor = mix(fireCore, fireEdge, pow(ageNorm, 0.8)) * u_hdrIntensity * u_overlayHdrComp;
                        vAlpha = pow(ratio, 1.5) * u_fireAlpha * u_overlayAlphaComp;
                        stretchFactor = 1.0 + (length(aStartVel) / max(u_worldScale, 0.001)) * 0.0003 * u_stretchMult * shape;
                    }
                    // ── RCS (type 2) ──
                    else if (type < 2.5) {
                        currentSize += age * 600.0 * u_worldScale;
                        vColor = vec3(0.2, 0.5, 1.0) * u_hdrIntensity * u_overlayHdrComp;
                        vAlpha = ratio * 0.4 * u_overlayAlphaComp;
                        stretchFactor = 1.0 + (length(aStartVel) / max(u_worldScale, 0.001)) * 0.0003 * u_stretchMult;
                    }
                    // ── EXPLOSION CORE (type 3) ──
                    else if (type < 3.5) {
                        float explosionAge = ageNorm;
                        float flash = 1.0 - pow(explosionAge, 0.5);
                        currentSize += age * 4000.0 * u_explosionSize;

                        vec3 expCore = vec3(1.0, 1.0, 0.8);
                        vec3 expMid  = vec3(1.0, 0.5, 0.0);
                        vec3 expEdge = vec3(0.8, 0.1, 0.0);

                        if (explosionAge < 0.3) {
                            vColor = mix(expCore, expMid, explosionAge / 0.3);
                        } else {
                            vColor = mix(expMid, expEdge, (explosionAge - 0.3) / 0.7);
                        }
                        vColor *= u_hdrIntensity * 3.0 * flash * u_overlayHdrComp;
                        vAlpha  = ratio * ratio * u_overlayAlphaComp;
                        stretchFactor = 1.0;
                    }
                    // ── SPARKS (type 4) ──
                    else if (type < 4.5) {
                        currentSize = u_startSize * 0.8 * (1.0 - ageNorm);
                        vColor = vec3(1.0, 0.9, 0.7) * u_hdrIntensity * 4.0 * u_overlayHdrComp;
                        vAlpha = ratio * u_overlayAlphaComp;
                        stretchFactor = 1.0 + (length(aStartVel) / max(u_worldScale, 0.001)) * 0.002 * u_stretchMult;
                    }
                    // ── SHOCKWAVE (type 5) ──
                    else {
                        float waveAge = pow(ageNorm, 0.4);
                        currentSize = u_startSize * 80.0 * u_explosionSize * (0.05 + waveAge * 2.5);
                        vColor = vec3(1.0, 0.9, 0.8) * u_hdrIntensity * 2.0 * u_overlayHdrComp;
                        vAlpha = pow(1.0 - ageNorm, 2.0) * 0.6 * u_overlayAlphaComp;
                        stretchFactor = 1.0;
                    }

                    vec4 mvPosition;

                    if (type > 4.5) {
                        // SHOCKWAVE — flat in XZ plane (Y-up world)
                        vec3 flatPos = pos;
                        flatPos.x += position.x * currentSize;
                        flatPos.z += position.y * currentSize;
                        mvPosition = modelViewMatrix * vec4(flatPos, 1.0);
                    } else {
                        // BILLBOARD — always faces camera
                        mvPosition = modelViewMatrix * vec4(pos, 1.0);

                        vec3 viewVel = (modelViewMatrix * vec4(aStartVel, 0.0)).xyz;
                        vec2 dir = normalize(viewVel.xy);
                        if (length(viewVel.xy) < 0.1) dir = vec2(0.0, 1.0);

                        float width  = currentSize;
                        float height = currentSize * stretchFactor;

                        vec2 scaledOffset = position.xy;
                        scaledOffset.x *= width;
                        scaledOffset.y *= height;

                        vec2 rotatedOffset;
                        rotatedOffset.x =  scaledOffset.x * dir.y + scaledOffset.y * dir.x;
                        rotatedOffset.y = -scaledOffset.x * dir.x + scaledOffset.y * dir.y;

                        mvPosition.xy += rotatedOffset;
                    }

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,

            /* ─── FRAGMENT SHADER ─── */
            fragmentShader: /* glsl */ `
                uniform sampler2D uTexture;
                varying vec3  vColor;
                varying float vAlpha;
                varying vec2  vUv;
                varying float vType;

                void main() {
                    if (vType > 4.5) {
                        // Shockwave ring (procedural)
                        float dist = length(vUv - vec2(0.5)) * 2.0;
                        float outerMask = 1.0 - smoothstep(0.95, 1.0, dist);
                        float ring      = smoothstep(0.85, 0.95, dist);
                        float innerHeat = smoothstep(0.0, 0.9, dist) * 0.15;
                        gl_FragColor = vec4(vColor, (ring + innerHeat) * outerMask * vAlpha);
                    } else {
                        vec4 texColor = texture2D(uTexture, vUv);
                        gl_FragColor  = vec4(vColor, pow(texColor.a, 1.5) * vAlpha);
                    }
                }
            `,

            side:        THREE.DoubleSide,
            blending:    THREE.AdditiveBlending,
            depthWrite:  false,
            depthTest:   true,
            transparent: true
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1000;
        scene.add(this.mesh);
    }

    /**
     * Spawn a single fire / explosion / spark / shockwave particle.
     * @param {number} type  0=fire, 2=RCS, 3=explosion core, 4=sparks, 5=shockwave
     */
    spawn(x, y, z, vx, vy, vz, size, life, type) {
        const i  = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        const i3 = i * 3, i4 = i * 4;

        this.startPos[i3]   = x;  this.startPos[i3+1] = y;  this.startPos[i3+2] = z;
        this.startVel[i3]   = vx; this.startVel[i3+1] = vy; this.startVel[i3+2] = vz;

        this.dataInfo[i4]   = this._time;   // startTime
        this.dataInfo[i4+1] = life;
        this.dataInfo[i4+2] = size;
        this.dataInfo[i4+3] = type;

        const geo = this.mesh.geometry;
        geo.attributes.aStartPos.needsUpdate = true;
        geo.attributes.aStartVel.needsUpdate = true;
        geo.attributes.aData.needsUpdate     = true;
    }

    /** Update shader time uniform. Call once per frame BEFORE any spawn() calls. */
    update(globalTime) {
        this._time = globalTime;
        this.material.uniforms.uTime.value = globalTime;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.material.dispose();
        if (this.material.uniforms.uTexture.value) this.material.uniforms.uTexture.value.dispose();
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    }
}
