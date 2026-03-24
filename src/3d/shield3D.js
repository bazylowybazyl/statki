// ============================================================
// Shield 3D — Droideka-style force shield (ported from flow-shield-effect)
// SphereGeometry + full GLSL: simplex noise, fresnel, flow noise,
// hit ring buffer with geodesic distance, reveal/dissolve, life color
// ============================================================
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { isShieldSuppressed } from '../../shieldSystem.js';

const MAX_HITS = 8;

// ── Vertex shader ────────────────────────────────────────────────────────────
const SHIELD_VERTEX = `
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vObjPos;
varying float vWorldY;

void main() {
    vObjPos  = position;
    vNormal  = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldY = worldPos.y;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
}
`;

// ── Fragment shader ──────────────────────────────────────────────────────────
const SHIELD_FRAGMENT = `
#define MAX_HITS 8

uniform float uTime;
uniform vec3  uColor;
uniform float uLife;
uniform float uHexScale;
uniform float uEdgeWidth;
uniform float uFresnelPower;
uniform float uFresnelStrength;
uniform float uOpacity;
uniform float uReveal;
uniform float uFlashSpeed;
uniform float uFlashIntensity;
uniform float uNoiseScale;
uniform vec3  uNoiseEdgeColor;
uniform float uNoiseEdgeWidth;
uniform float uNoiseEdgeIntensity;
uniform float uNoiseEdgeSmoothness;
uniform float uHexOpacity;
uniform float uShowHex;
uniform float uFlowScale;
uniform float uFlowSpeed;
uniform float uFlowIntensity;
uniform vec3  uHitPos[MAX_HITS];
uniform float uHitTime[MAX_HITS];
uniform float uHitRingSpeed;
uniform float uHitRingWidth;
uniform float uHitMaxRadius;
uniform float uHitDuration;
uniform float uHitIntensity;
uniform float uHitImpactRadius;
uniform float uFadeStart;
uniform float uIsBreaking;
uniform float uEnergyShot;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vObjPos;
varying float vWorldY;

// ── Simplex 3D noise ────────────────────────────────────────────────────────
vec3 mod289v3(vec3 x){ return x - floor(x*(1./289.))*289.; }
vec4 mod289v4(vec4 x){ return x - floor(x*(1./289.))*289.; }
vec4 permute(vec4 x){ return mod289v4(((x*34.)+1.)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }

float snoise(vec3 v){
    const vec2 C = vec2(1./6., 1./3.);
    const vec4 D = vec4(0., 0.5, 1., 2.);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1. - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289v3(i);
    vec4 p = permute(permute(permute(
      i.z+vec4(0.,i1.z,i2.z,1.))
     +i.y+vec4(0.,i1.y,i2.y,1.))
     +i.x+vec4(0.,i1.x,i2.x,1.));
    float n_ = 0.142857142857;
    vec3  ns = n_*D.wyz - D.xzx;
    vec4 j   = p - 49.*floor(p*ns.z*ns.z);
    vec4 x_  = floor(j*ns.z);
    vec4 y_  = floor(j - 7.*x_);
    vec4 x   = x_*ns.x + ns.yyyy;
    vec4 y   = y_*ns.x + ns.yyyy;
    vec4 h   = 1. - abs(x) - abs(y);
    vec4 b0  = vec4(x.xy, y.xy);
    vec4 b1  = vec4(x.zw, y.zw);
    vec4 s0  = floor(b0)*2.+1.;
    vec4 s1  = floor(b1)*2.+1.;
    vec4 sh  = -step(h, vec4(0.));
    vec4 a0  = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1  = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0  = vec3(a0.xy, h.x);
    vec3 p1  = vec3(a0.zw, h.y);
    vec3 p2  = vec3(a1.xy, h.z);
    vec3 p3  = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m = max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
    m = m*m;
    return 42.*dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

// ── Life color: uColor (full) -> red (empty) ────────────────────────────────
vec3 lifeColor(float life){
    return mix(vec3(1.0, 0.08, 0.04), uColor, life);
}

// ── Hex grid ────────────────────────────────────────────────────────────────
float hexPattern(vec2 p){
    p *= uHexScale;
    const vec2 s = vec2(1., 1.7320508);
    vec4 hC = floor(vec4(p, p-vec2(0.5,1.))/s.xyxy) + 0.5;
    vec4 h  = vec4(p-hC.xy*s, p-(hC.zw+0.5)*s);
    vec2 cell = (dot(h.xy,h.xy) < dot(h.zw,h.zw)) ? h.xy : h.zw;
    cell = abs(cell);
    float d = max(dot(cell, s*0.5), cell.x);
    return smoothstep(0.5-uEdgeWidth, 0.5, d);
}

vec2 hexCellId(vec2 p){
    p *= uHexScale;
    const vec2 s = vec2(1., 1.7320508);
    vec4 hC = floor(vec4(p, p-vec2(0.5,1.))/s.xyxy) + 0.5;
    vec4 h  = vec4(p-hC.xy*s, p-(hC.zw+0.5)*s);
    return (dot(h.xy,h.xy) < dot(h.zw,h.zw)) ? hC.xy : hC.zw+0.5;
}

float cellFlash(vec2 cellId){
    float rnd   = fract(sin(dot(cellId, vec2(127.1,311.7)))*43758.5453);
    float phase = rnd * 6.2831;
    float speed = 0.5 + rnd * 1.5;
    return smoothstep(0.6, 1.0, sin(uTime*uFlashSpeed*speed+phase)) * uFlashIntensity;
}

void main(){
    // ── Reveal / dissolve ─────────────────────────────────────────────────────
    float noise = snoise(vObjPos * uNoiseScale) * 0.5 + 0.5;

    // Breaking state: glitch + fast dissolve
    float effectiveReveal = uReveal;
    if (uIsBreaking > 0.5) {
        // Add glitch noise jitter to reveal threshold
        float glitch = fract(sin(dot(vObjPos.xy, vec2(12.9898, 78.233)) + uTime * 30.0) * 43758.5453);
        effectiveReveal = max(effectiveReveal, glitch * 0.3);
    }

    float revealMask = smoothstep(effectiveReveal - uNoiseEdgeWidth, effectiveReveal, noise);
    if (revealMask < 0.001) discard;

    float innerFade  = mix(0.98, 0.15, uNoiseEdgeSmoothness);
    float edgeLow    = smoothstep(effectiveReveal-uNoiseEdgeWidth, effectiveReveal-uNoiseEdgeWidth*innerFade, noise);
    float edgeHigh   = smoothstep(effectiveReveal-uNoiseEdgeWidth*0.15, effectiveReveal, noise);
    float revealEdge = edgeLow * (1.0 - edgeHigh);

    // ── Fresnel ───────────────────────────────────────────────────────────────
    float fresnel = pow(1.0 - dot(vNormal, vViewDir), uFresnelPower) * uFresnelStrength;

    // ── Flow noise ────────────────────────────────────────────────────────────
    float t   = uTime * uFlowSpeed;
    float fn1 = snoise(vObjPos*uFlowScale + vec3(t, t*0.6, t*0.4));
    float fn2 = snoise(vObjPos*uFlowScale*2.1 + vec3(-t*0.5, t*0.9, t*0.3));
    float flowNoise = (fn1*0.6 + fn2*0.4)*0.5 + 0.5;

    // ── Hex: cube-face select + seam fade ──────────────────────────────────
    vec3 absN = abs(normalize(vObjPos));
    float dominance = max(absN.x, max(absN.y, absN.z));
    float hexFade   = smoothstep(0.65, 0.85, dominance);

    vec2 faceUV;
    if (absN.x >= absN.y && absN.x >= absN.z) {
        faceUV = vObjPos.yz;
    } else if (absN.y >= absN.z) {
        faceUV = vObjPos.xz;
    } else {
        faceUV = vObjPos.xy;
    }

    float hex   = hexPattern(faceUV) * hexFade;
    vec2  cId   = hexCellId(faceUV);
    float flash = cellFlash(cId) * hexFade;

    // ── Hit ring buffer ───────────────────────────────────────────────────────
    vec3  normPos     = normalize(vObjPos);
    float ringContrib = 0.0;
    float hexHitBoost = 0.0;

    for (int i = 0; i < MAX_HITS; i++) {
        float ht      = uHitTime[i];
        float elapsed = uTime - ht;

        float isActive = step(0.0, ht)
                       * step(0.0, elapsed)
                       * step(elapsed, uHitDuration);

        // Geodesic distance on sphere surface
        float dist = acos(clamp(dot(normPos, normalize(uHitPos[i])), -1.0, 1.0));

        // Expanding ring
        float ringR      = min(elapsed * uHitRingSpeed, uHitMaxRadius);
        float noiseD     = snoise(normPos*5.0 + vec3(elapsed*2.0)) * 0.05;
        float ring       = smoothstep(uHitRingWidth, 0.0, abs(dist + noiseD - ringR));
        float fade       = 1.0 - smoothstep(uHitDuration*0.5, uHitDuration, elapsed);
        float radialFade = 1.0 - smoothstep(uHitMaxRadius*0.75, uHitMaxRadius, ringR);
        ringContrib     += ring * fade * radialFade * isActive;

        // Hex highlight zone
        float zone     = smoothstep(uHitImpactRadius, 0.0, dist);
        float zoneFade = 1.0 - smoothstep(0.0, uHitDuration*0.35, elapsed);
        hexHitBoost   += zone * zoneFade * isActive;
    }

    ringContrib = min(ringContrib, 2.0);
    hexHitBoost = min(hexHitBoost, 1.0);

    // ── Energy shot boost ─────────────────────────────────────────────────────
    float energyBoost = uEnergyShot * 0.5;

    // ── Combine ───────────────────────────────────────────────────────────────
    // ── Combine ───────────────────────────────────────────────────────────────
    vec3  lColor = lifeColor(uLife);

    // Breaking: shift to red/white
    if (uIsBreaking > 0.5) {
        float bFlash = fract(uTime * 25.0);
        lColor = mix(vec3(1.0, 0.15, 0.1), vec3(2.0), bFlash * 0.4);
    }

    float effectiveHexOpacity = (uHexOpacity + hexHitBoost * uHitIntensity) * uShowHex;
    float intensity = hex * effectiveHexOpacity * (0.3 + fresnel*0.7) + fresnel*0.4 + flash * uShowHex;
    intensity += energyBoost;

    vec3 shieldColor = lColor * intensity * 2.0;
    shieldColor += lColor * (flowNoise * fresnel * uFlowIntensity);
    shieldColor += lColor * ringContrib * uHitIntensity;

    vec3 edgeColor = mix(uNoiseEdgeColor, lColor, 1.0 - uLife);
    vec3 edgeGlow  = edgeColor * revealEdge * uNoiseEdgeIntensity;

    float alpha = clamp(intensity*uOpacity*revealMask + revealEdge*uNoiseEdgeIntensity, 0.0, 1.0);

    // Pełna okrągła tarcza w 3D - żadnego wycinania
    gl_FragColor = vec4(shieldColor + edgeGlow, alpha);
}
`;

// ── Shared state ─────────────────────────────────────────────────────────────
const HIT_DURATION = 1.5; // seconds — must match uHitDuration default

const state = {
    meshes: new Map(),
    geometry: null,
    // Per-entity ring buffer for 3D hits — survives longer than shieldSystem impacts
    hitBuffers: new Map()  // entity → { hits: [{angle, time}], idx: 0 }
};

// Shared sphere geometry — one instance for all shields
function getSharedGeometry() {
    if (!state.geometry) {
        state.geometry = new THREE.SphereGeometry(1.8, 32, 32);
    }
    return state.geometry;
}

// ── Create shield material with droideka preset defaults ─────────────────────
function createShieldMaterial() {
    const hitPositions = [];
    const hitTimes = [];
    for (let i = 0; i < MAX_HITS; i++) {
        hitPositions.push(new THREE.Vector3(0, 1.8, 0));
        hitTimes.push(-999);
    }

    return new THREE.ShaderMaterial({
        uniforms: {
            uTime:                { value: 0 },
            uColor:               { value: new THREE.Color('#5992f7') },
            uLife:                { value: 1.0 },
            uReveal:              { value: 1.0 },     // 1 = hidden, 0 = fully visible
            // Hex grid (showHex=0 for droideka — pure energy look)
            uHexScale:            { value: 3.0 },
            uHexOpacity:          { value: 0.27 },
            uShowHex:             { value: 0.0 },
            uEdgeWidth:           { value: 0.2 },
            // Fresnel
            uFresnelPower:        { value: 1.8 },
            uFresnelStrength:     { value: 1.75 },
            uOpacity:             { value: 0.29 },
            uFadeStart:           { value: 1.0 },
            // Flash
            uFlashSpeed:          { value: 0.6 },
            uFlashIntensity:      { value: 0.11 },
            // Noise edge (reveal/dissolve)
            uNoiseScale:          { value: 1.0 },
            uNoiseEdgeColor:      { value: new THREE.Color('#7faaf5') },
            uNoiseEdgeWidth:      { value: 0.1 },
            uNoiseEdgeIntensity:  { value: 0.6 },
            uNoiseEdgeSmoothness: { value: 0.5 },
            // Flow noise
            uFlowScale:           { value: 6.2 },
            uFlowSpeed:           { value: 1.08 },
            uFlowIntensity:       { value: 4.0 },
            // Hit ring buffer
            uHitPos:              { value: hitPositions },
            uHitTime:             { value: hitTimes },
            uHitRingSpeed:        { value: 0.8 },
            uHitRingWidth:        { value: 0.12 },
            uHitMaxRadius:        { value: 2.1 },
            uHitDuration:         { value: 1.5 },
            uHitIntensity:        { value: 1.0 },
            uHitImpactRadius:     { value: 0.3 },
            // Game-specific
            uIsBreaking:          { value: 0.0 },
            uEnergyShot:          { value: 0.0 },
        },
        vertexShader: SHIELD_VERTEX,
        fragmentShader: SHIELD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        blending: THREE.AdditiveBlending
    });
}

// ── Create shield mesh for entity ────────────────────────────────────────────
function createShieldMesh(entity) {
    const material = createShieldMaterial();
    const mesh = new THREE.Mesh(getSharedGeometry(), material);
    mesh.renderOrder = 10;
    Core3D.scene.add(mesh);
    state.meshes.set(entity, mesh);
    return mesh;
}

// ── Per-frame update ─────────────────────────────────────────────────────────
export function updateShields3D(dt, entities, interpPoseOverride = null) {
    if (!Core3D.isInitialized) return;
    const time = performance.now() / 1000;

    const activeEntities = new Set();

    for (const entity of entities) {
        const shield = entity?.shield;
        if (!shield || !shield.max || shield.state === 'off' || isShieldSuppressed(entity)) continue;

        let mesh = state.meshes.get(entity);
        if (!mesh) mesh = createShieldMesh(entity);
        activeEntities.add(entity);

        // --- Shield scale (uniform circle from max dimension) ---
        let w = entity.w || (entity.radius * 2) || 40;
        let h = entity.h || (entity.radius * 2) || 40;
        if (entity.capitalProfile) {
            const baseR = entity.radius || 20;
            w = Math.max(w, baseR * (entity.capitalProfile.lengthScale || 3.2));
            h = Math.max(h, baseR * (entity.capitalProfile.widthScale || 1.2));
        } else if (entity.fighter || entity.type === 'fighter') {
            w = Math.max(w, h); h = w;
        }

        // Uniform scale: sphere radius=1.8, shield covers half the longest dimension + 15% margin
        const maxDim = Math.max(w, h);
        const s = (maxDim * 0.5 * 1.15) / 1.8;
        // During activation, shield grows from center; during breaking, stays full size
        const ap = Math.max(0, Math.min(1, shield.activationProgress || 0));
        const scaleProgress = shield.state === 'breaking' ? 1 : Math.max(0.02, ap);
        mesh.scale.set(s * scaleProgress, s * scaleProgress, s * scaleProgress);

        // --- Position and angle ---
        let pos = { x: entity.x || entity.pos?.x, y: entity.y || entity.pos?.y };
        let visualAngle = entity.angle || 0;

        if (interpPoseOverride && entity.isPlayer && entity === (typeof window !== 'undefined' ? window.ship : null)) {
            pos.x = interpPoseOverride.x;
            pos.y = interpPoseOverride.y;
            visualAngle = interpPoseOverride.angle;
        }

        const profile = entity.capitalProfile;
        if (profile) {
            if (Number.isFinite(profile.spriteRotation)) visualAngle += profile.spriteRotation;
            if (Number.isFinite(profile.shieldRotation)) visualAngle += profile.shieldRotation;
        }

        mesh.position.set(pos.x, -pos.y, 1);
        mesh.rotation.set(Math.PI / 2, -visualAngle, 0);

        // --- Upload uniforms ---
        const u = mesh.material.uniforms;
        u.uTime.value = time;

        // Life = shield HP ratio
        u.uLife.value = Math.max(0, Math.min(1, (shield.val || 0) / (shield.max || 1)));

        // Reveal mapping from state machine
        // During activating: shield grows from center (scale handles it), fully visible
        // During breaking: dissolve out via reveal
        if (shield.state === 'activating') {
            u.uReveal.value = 0.0; // fully visible, growing via scale
        } else if (shield.state === 'active') {
            u.uReveal.value = 0.0;
        } else if (shield.state === 'breaking') {
            const breakProgress = Math.max(0, Math.min(1, shield.activationProgress || 0));
            u.uReveal.value = 1.0 - breakProgress; // dissolve out
        }

        // Breaking state
        u.uIsBreaking.value = shield.state === 'breaking' ? 1.0 : 0.0;

        // Energy shot
        if (shield.energyShotTimer > 0) {
            u.uEnergyShot.value = shield.energyShotTimer / (shield.energyShotDuration || 1);
        } else {
            u.uEnergyShot.value = 0.0;
        }

        // --- Impacts → 3D hit ring buffer ---
        // shieldSystem removes impacts after ~0.42s (IMPACT_DECAY=2.4),
        // but the shader ring effect needs 1.5s. We maintain our own ring buffer
        // that keeps hits alive for the full shader duration.
        if (!state.hitBuffers.has(entity)) {
            state.hitBuffers.set(entity, { hits: new Array(MAX_HITS).fill(null), idx: 0, seen: new Set() });
        }
        const hb = state.hitBuffers.get(entity);

        // Detect new impacts by startTime — copy them into our ring buffer
        const impacts = shield.impacts || [];
        for (const imp of impacts) {
            const key = imp.startTime;
            if (key && !hb.seen.has(key)) {
                hb.seen.add(key);
                const slot = hb.idx % MAX_HITS;
                hb.idx++;
                // Store angle in world-space (localAngle) and startTime
                hb.hits[slot] = { localAngle: imp.localAngle || 0, startTime: key };
            }
        }

        // Clean up old seen keys (prevent memory leak)
        if (hb.seen.size > 64) {
            const cutoff = time - HIT_DURATION * 2;
            for (const key of hb.seen) {
                if (key < cutoff) hb.seen.delete(key);
            }
        }

        // Upload hit ring buffer to shader
        for (let i = 0; i < MAX_HITS; i++) {
            const hit = hb.hits[i];
            if (hit && (time - hit.startTime) < HIT_DURATION) {
                // Object-space angle: localAngle + visualAngle (compensate mesh rotation.z = -visualAngle)
                const a = hit.localAngle + visualAngle;
                u.uHitPos.value[i].set(Math.cos(a) * 1.8, 0, -Math.sin(a) * 1.8);
                u.uHitTime.value[i] = hit.startTime;
            } else {
                u.uHitTime.value[i] = -999;
            }
        }
    }

    // Cleanup dead shields
    for (const [entity, mesh] of state.meshes) {
        if (!activeEntities.has(entity)) {
            Core3D.scene.remove(mesh);
            state.meshes.delete(entity);
            state.hitBuffers.delete(entity);
            mesh.material.dispose();
        }
    }
}
