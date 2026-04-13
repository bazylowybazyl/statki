/**
 * GPU Instanced Particle System for rocket fire, explosions, sparks, shockwaves.
 * Ported 1:1 from rakiety.html GPUInstancedParticleManager.
 * Coordinate system: Y-up (overlay convention).
 *
 * Particle types:
 *   0  = main fire (exhaust flame)
 *   2  = RCS thruster (blue)
 *   3  = explosion core
 *   4  = sparks / shrapnel
 *   5  = shockwave ring (flat in XZ)
 *   10 = supernova exhaust
 *   13 = supernova explosion core
 *   14 = supernova sparks
 *   15 = supernova shockwave ring
 *   16 = supernova anamorphic core
 *   17 = supernova fractal energy ring
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
                    float startTime = aData.x;
                    float maxLife   = aData.y;
                    float type      = aData.w;
                    bool  isNova    = type >= 9.5;
                    float mode      = isNova ? (type - 10.0) : type;
                    vType = mode;
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
                    if (mode < 0.5) {
                        float flameScale = max(0.05, aData.z);
                        float shape = 1.0 - pow(ageNorm, 2.5);
                        float mach  = 1.0 + sin(ageNorm * 30.0) * 0.3 * (1.0 - ageNorm);
                        currentSize = u_startSize * flameScale * shape * mach * (1.0 + ageNorm * u_growth);

                        // Turbulence on horizontal plane (X, Z in Y-up)
                        float scatter = pow(ageNorm, 3.0) * 60.0 * u_worldScale;
                        pos.x += sin(age * 50.0 + aStartPos.y) * scatter;
                        pos.z += cos(age * 43.0 + aStartPos.x) * scatter;

                        vec3 fireCore = isNova ? vec3(1.0, 0.74, 0.96) : vec3(1.0, 0.9, 0.6);
                        vec3 fireEdge = isNova ? vec3(0.82, 0.18, 1.0) : vec3(1.0, 0.1, 0.0);
                        vColor = mix(fireCore, fireEdge, pow(ageNorm, 0.8)) * u_hdrIntensity * u_overlayHdrComp;
                        vAlpha = pow(ratio, 1.5) * u_fireAlpha * u_overlayAlphaComp;
                        stretchFactor = 1.0 + (length(aStartVel) / max(u_worldScale, 0.001)) * 0.0003 * u_stretchMult * shape;
                    }
                    // ── RCS (type 2) ──
                    else if (mode < 2.5) {
                        currentSize += age * 600.0 * u_worldScale;
                        vColor = vec3(0.2, 0.5, 1.0) * u_hdrIntensity * u_overlayHdrComp;
                        vAlpha = ratio * 0.4 * u_overlayAlphaComp;
                        stretchFactor = 1.0 + (length(aStartVel) / max(u_worldScale, 0.001)) * 0.0003 * u_stretchMult;
                    }
                    // ── EXPLOSION CORE (type 3) ──
                    else if (mode < 3.5) {
                        float explosionAge = ageNorm;
                        float flash = 1.0 - pow(explosionAge, 0.5);
                        currentSize += age * 4000.0 * u_explosionSize;

                        vec3 expCore = isNova ? vec3(1.0, 0.95, 1.0) : vec3(1.0, 1.0, 0.8);
                        vec3 expMid  = isNova ? vec3(1.0, 0.35, 0.92) : vec3(1.0, 0.5, 0.0);
                        vec3 expEdge = isNova ? vec3(0.22, 0.95, 1.0) : vec3(0.8, 0.1, 0.0);

                        if (explosionAge < 0.3) {
                            vColor = mix(expCore, expMid, explosionAge / 0.3);
                        } else {
                            vColor = mix(expMid, expEdge, (explosionAge - 0.3) / 0.7);
                        }
                        vColor *= u_hdrIntensity * (isNova ? 4.4 : 3.0) * flash * u_overlayHdrComp;
                        vAlpha  = ratio * ratio * (isNova ? 1.08 : 1.0) * u_overlayAlphaComp;
                        stretchFactor = 1.0;
                    }
                    // ── SPARKS (type 4) ──
                    else if (mode < 4.5) {
                        currentSize = u_startSize * 0.8 * (1.0 - ageNorm);
                        vColor = (isNova ? vec3(1.0, 0.78, 0.98) : vec3(1.0, 0.9, 0.7)) * u_hdrIntensity * 4.0 * u_overlayHdrComp;
                        vAlpha = ratio * u_overlayAlphaComp;
                        stretchFactor = 1.0 + (length(aStartVel) / max(u_worldScale, 0.001)) * 0.002 * u_stretchMult;
                    }
                    // ── SHOCKWAVE (type 5) ──
                    else if (mode < 5.5) {
                        float waveAge = pow(ageNorm, 0.4);
                        float waveScale = max(0.05, aData.z);
                        currentSize = waveScale * u_startSize * 80.0 * u_explosionSize * (0.05 + waveAge * 2.5);
                        vColor = (isNova ? vec3(0.56, 0.95, 1.0) : vec3(1.0, 0.9, 0.8)) * u_hdrIntensity * (isNova ? 2.8 : 2.0) * u_overlayHdrComp;
                        vAlpha = pow(1.0 - ageNorm, 2.0) * (isNova ? 0.72 : 0.6) * u_overlayAlphaComp;
                        stretchFactor = 1.0;
                    }

                    else if (mode < 6.5) {
                        currentSize = max(0.05, aData.z) * (0.5 + ageNorm * 0.5);
                        vColor = (isNova ? vec3(0.72, 1.0, 1.0) : vec3(0.5, 1.0, 1.0)) * u_hdrIntensity * (isNova ? 6.8 : 5.2) * u_overlayHdrComp;
                        vAlpha = pow(ratio, 3.0) * (isNova ? 1.05 : 1.0) * u_overlayAlphaComp;
                        stretchFactor = 1.0;
                    }
                    else {
                        float waveAge = pow(ageNorm, 0.4);
                        currentSize = max(0.05, aData.z) * (0.35 + waveAge * 1.65);
                        vColor = (isNova ? vec3(1.0, 0.24, 0.95) : vec3(0.9, 0.1, 1.0)) * u_hdrIntensity * (isNova ? 3.2 : 4.0) * u_overlayHdrComp;
                        vAlpha = pow(1.0 - ageNorm, 1.5) * (isNova ? 0.9 : 0.75) * u_overlayAlphaComp;
                        stretchFactor = 1.0;
                    }

                    vec4 mvPosition;

                    if ((mode > 4.5 && mode < 5.5) || mode > 6.5) {
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

                void main() {
                    if (vType > 4.5 && vType < 5.5) {
                        // Shockwave ring (procedural)
                        float dist = length(vUv - vec2(0.5)) * 2.0;
                        float outerMask = 1.0 - smoothstep(0.95, 1.0, dist);
                        float ring      = smoothstep(0.85, 0.95, dist);
                        float innerHeat = smoothstep(0.0, 0.9, dist) * 0.15;
                        gl_FragColor = vec4(vColor, (ring + innerHeat) * outerMask * vAlpha);
                    } else if (vType > 5.5 && vType < 6.5) {
                        vec2 uv = vUv - vec2(0.5);
                        float dist = length(uv) * 2.0;
                        float core = max(0.0, 1.0 - smoothstep(0.0, 0.3, dist));
                        float flareY = max(0.0, 1.0 - smoothstep(0.0, 0.02, abs(uv.y)));
                        float flareX = max(0.0, 1.0 - smoothstep(0.0, 0.5, abs(uv.x)));
                        float flare = flareY * flareX * 2.0;
                        float aura = max(0.0, 1.0 - dist);
                        float finalIntensity = max(0.0, core + flare + aura * 0.3);
                        gl_FragColor = vec4(vColor * finalIntensity, finalIntensity * vAlpha);
                    } else if (vType > 6.5) {
                        vec2 uv = vUv - vec2(0.5);
                        float dist = length(uv) * 2.0;
                        if (dist > 1.0) discard;
                        float ringShape = max(0.0, 1.0 - smoothstep(0.0, 0.15, abs(dist - 0.7)));
                        float angle = atan(uv.y, uv.x);
                        float n = fbm(vec3(angle * 10.0, dist * 5.0, 0.0));
                        float finalRing = ringShape * (n * 2.5);
                        float innerGlow = max(0.0, smoothstep(0.0, 0.8, dist)) * 0.2;
                        gl_FragColor = vec4(vColor, (finalRing + innerGlow) * vAlpha);
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
