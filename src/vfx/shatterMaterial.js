/**
 * shatterMaterial.js
 *
 * Creates a THREE.ShaderMaterial that animates mesh fragments flying apart
 * from their triangle centroids, then settling into slow debris drift.
 *
 * Requires the geometry to have aCentroid and aRandom3 attributes
 * (produced by shatterShaderBake.js).
 *
 * Uniforms you drive every frame:
 *   uTime          — current world time (seconds)
 *
 * Uniforms set once at trigger:
 *   uShatterTime   — world time when shatter starts (set to current time on trigger)
 *
 * Read-only config uniforms (set at creation, tunable per-effect):
 *   uDuration      — active explosion animation length (s)         default 1.8
 *   uDebrisLifetime— total mesh lifetime incl. debris drift (s)    default 60
 *   uFragmentDrift — peak outward speed (world units/s)            default 800
 *   uSpin          — tumble rate (rad/s)                           default 4.0
 *   uShrink        — triangle convergence toward centroid (0..1)   default 0.35
 *   uHeatGlow      — heat-glow emission intensity (first ~200ms)   default 1.0
 *   uGravity       — downward acceleration (units/s²)              default 0
 *   uStaggerWindow — per-triangle start delay spread (s)           default 0.55
 *   uBurstStrength — extra outward pulse strength                  default 0.65
 *   uHasTexture    — 1.0 if tDiffuse map supplied, else 0.0
 *   uBaseColor     — fallback solid colour when no texture
 *   tDiffuse       — optional diffuse map
 *
 * Usage:
 *   import { createShatterMaterial } from './shatterMaterial.js';
 *   const mat = createShatterMaterial({ map: mesh.material.map });
 *   mesh.geometry = bakedGeo;
 *   mesh.material = mat;
 *   mat.uniforms.uShatterTime.value = worldTime;  // trigger!
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GLSL — Vertex Shader
// ---------------------------------------------------------------------------
const VERT = /* glsl */`
precision highp float;

uniform float uTime;
uniform float uShatterTime;
uniform float uDuration;
uniform float uDebrisLifetime;
uniform float uFragmentDrift;
uniform float uSpin;
uniform float uShrink;
uniform float uHeatGlow;
uniform float uGravity;
uniform float uStaggerWindow;
uniform float uBurstStrength;

attribute vec3 aCentroid;   // centroid of this triangle (model space)
attribute vec3 aRandom3;    // normalised random direction (model space)

varying vec2  vUv;
varying float vAlpha;
varying float vHeat;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

void main() {
    vUv = uv;

    float t = uTime - uShatterTime;
    float triSeed = hash13(aRandom3 * 3.71 + aCentroid * 0.017);
    float triDelay = triSeed * uStaggerWindow;
    float maxLife = uDebrisLifetime + uStaggerWindow;

    // --- Not yet triggered or beyond lifetime → invisible ---
    if (t < 0.0 || t > maxLife) {
        vAlpha = 0.0;
        gl_Position = vec4(0.0, 0.0, 9999.0, 1.0);
        return;
    }

    float localT = t - triDelay;

    // Triangle not yet released — keep original shape visible for staged breakup.
    if (localT <= 0.0) {
        vAlpha = 1.0;
        vHeat = uHeatGlow * smoothstep(0.20, 0.0, t) * smoothstep(0.0, 0.02, t);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        return;
    }

    if (localT > uDebrisLifetime) {
        vAlpha = 0.0;
        gl_Position = vec4(0.0, 0.0, 9999.0, 1.0);
        return;
    }

    float dur      = max(0.001, uDuration * mix(0.72, 1.18, triSeed));
    float activeT  = min(localT, dur);
    float debrisT  = max(0.0, localT - dur);
    float an       = activeT / dur;   // 0→1 during active phase

    // === DRIFT: centroid moves outward along aRandom3 ===
    // Ease-in/out drift during active phase, then secondary outward pulses.
    float driftCurve = an * an * (3.0 - 2.0 * an);
    vec3 activeDrift = aRandom3 * uFragmentDrift * driftCurve;

    float burst1 = exp(-pow((localT - 0.06) * 8.0, 2.0));
    float burst2 = exp(-pow((localT - 0.22) * 5.2, 2.0));
    float burst3 = exp(-pow((localT - 0.48) * 3.7, 2.0));
    float burstPulse = burst1 * 0.65 + burst2 * 0.45 + burst3 * 0.25;
    vec3 burstDrift = aRandom3 * uFragmentDrift * uBurstStrength * burstPulse;

    // Debris phase: continues with inertia then exponential drag
    float debrisDrag  = exp(-debrisT * 0.42);
    vec3  debrisDrift = aRandom3 * uFragmentDrift * (0.45 + triSeed * 0.55) * debrisT * debrisDrag;

    // === TUMBLE: Rodrigues rotation ===
    // Use a slightly different axis than drift direction for more complex motion.
    vec3  axis       = normalize(aRandom3 + vec3(0.311, 0.723, -0.461) * 0.35);
    float totalAngle = uSpin * (activeT * 1.15 + debrisT * 0.35);  // slower inertial tumble in debris

    // Shrink triangle toward its centroid during active phase
    vec3 relPos = (position - aCentroid) * (1.0 - an * uShrink);

    // Rodrigues rotation formula
    float cosA = cos(totalAngle);
    float sinA = sin(totalAngle);
    vec3  tumbled = relPos * cosA
                  + cross(axis, relPos) * sinA
                  + axis * dot(axis, relPos) * (1.0 - cosA);

    // === GRAVITY (optional) ===
    float drop = uGravity * t * t * 0.5;   // s = ½ g t²

    // === FINAL POSITION ===
    vec3 centroidWorld = aCentroid + activeDrift + burstDrift + debrisDrift;
    centroidWorld.y   -= drop;
    vec3 finalPos = centroidWorld + tumbled;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);

    // === ALPHA ===
    // Active phase: fade in quickly, hold, fade out in last 40%
    float activeAlpha = smoothstep(0.0, 0.06, an) * (1.0 - smoothstep(0.58, 1.0, an));
    // Debris phase: slow exponential decay
    float debrisAlpha = smoothstep(0.0, 0.06, an) * exp(-debrisT * 0.22);

    // Blend phases: step(dur, t) = 1.0 when in debris phase
    float inDebris = step(dur, t);
    vAlpha = mix(activeAlpha, debrisAlpha, inDebris);

    // === HEAT GLOW (first ~200ms) ===
    vHeat = uHeatGlow * smoothstep(0.24, 0.0, localT) * smoothstep(0.0, 0.02, localT);
}
`;

// ---------------------------------------------------------------------------
// GLSL — Fragment Shader
// ---------------------------------------------------------------------------
const FRAG = /* glsl */`
precision highp float;

uniform sampler2D tDiffuse;
uniform float     uHasTexture;
uniform vec3      uBaseColor;

varying vec2  vUv;
varying float vAlpha;
varying float vHeat;

void main() {
    if (vAlpha < 0.005) discard;

    vec4 texColor = uHasTexture > 0.5
        ? texture2D(tDiffuse, vUv)
        : vec4(uBaseColor, 1.0);

    // Heat glow: orange-hot emission that fades quickly
    vec3 heatColor  = vec3(1.0, 0.42, 0.06) * vHeat * 5.0;
    vec3 finalColor = texColor.rgb + heatColor;

    gl_FragColor = vec4(finalColor, texColor.a * vAlpha);
}
`;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {THREE.Texture|null}  [opts.map]            Diffuse texture from source material
 * @param {THREE.Color|null}    [opts.color]          Fallback colour when no map
 * @param {number}  [opts.duration=1.8]
 * @param {number}  [opts.debrisLifetime=60]
 * @param {number}  [opts.fragmentDrift=800]
 * @param {number}  [opts.spin=4.0]
 * @param {number}  [opts.shrink=0.35]
 * @param {number}  [opts.heatGlow=1.0]
 * @param {number}  [opts.gravity=0]
 * @param {number}  [opts.staggerWindow=0.55]
 * @param {number}  [opts.burstStrength=0.65]
 * @returns {THREE.ShaderMaterial}
 */
export function createShatterMaterial(opts = {}) {
    const {
        map           = null,
        color         = new THREE.Color(0.5, 0.55, 0.6),
        duration      = 1.8,
        debrisLifetime = 60.0,
        fragmentDrift = 800,
        spin          = 4.0,
        shrink        = 0.35,
        heatGlow      = 1.0,
        gravity       = 0,
        staggerWindow = 0.55,
        burstStrength = 0.65,
    } = opts;

    return new THREE.ShaderMaterial({
        uniforms: {
            uTime:          { value: 0.0 },
            uShatterTime:   { value: -9999.0 },  // trigger by setting to current time
            uDuration:      { value: duration },
            uDebrisLifetime:{ value: debrisLifetime },
            uFragmentDrift: { value: fragmentDrift },
            uSpin:          { value: spin },
            uShrink:        { value: shrink },
            uHeatGlow:      { value: heatGlow },
            uGravity:       { value: gravity },
            uStaggerWindow: { value: staggerWindow },
            uBurstStrength: { value: burstStrength },
            uHasTexture:    { value: map ? 1.0 : 0.0 },
            tDiffuse:       { value: map },
            uBaseColor:     { value: color instanceof THREE.Color ? color : new THREE.Color(color) },
        },
        vertexShader:   VERT,
        fragmentShader: FRAG,
        transparent:    true,
        depthWrite:     false,
        side:           THREE.DoubleSide,   // see both faces of flying fragments
    });
}
