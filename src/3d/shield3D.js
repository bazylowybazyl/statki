// ============================================================
// Shield 3D — dwa warianty tarczy:
//  1) "hull" — tarcza-obrys dopasowana do sylwetki kadłuba (statki z hexGrid):
//     płaska kopuła zbudowana na radialnym profilu z shieldSystem, świecąca
//     obramówka (fresnel + pas krawędziowy), ripple trafień po powierzchni.
//  2) "sphere" — klasyczna kolista bańka (droideka, port z flow-shield-effect):
//     stacje, budowle, myśliwce i przyszłe generatory osłon obszarowych.
// ============================================================
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import {
    getEntityShieldBaseRadius,
    getEntityShieldProfile,
    getShieldHullAngle,
    isShieldSuppressed,
    sampleShieldProfileRadius
} from '../../shieldSystem.js';

const MAX_HITS = 24;

function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
}

// ── Vertex shader (sfera) ────────────────────────────────────────────────────
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

// ── Wspólne kawałki GLSL (noise, hex, life color) ────────────────────────────
const SHIELD_GLSL_COMMON = `
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
`;

const SHIELD_UNIFORMS_GLSL = `
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
uniform float uIsBreaking;
uniform float uEnergyShot;
`;

// ── Fragment shader (sfera — oryginalny wygląd droideki) ─────────────────────
const SHIELD_FRAGMENT = `
#define MAX_HITS 24
${SHIELD_UNIFORMS_GLSL}
uniform float uFadeStart;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vObjPos;
varying float vWorldY;
${SHIELD_GLSL_COMMON}
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

// ── Vertex shader (tarcza-obrys kadłuba) ─────────────────────────────────────
const HULL_SHIELD_VERTEX = `
attribute float aEdge;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vObjPos;
varying float vEdge;

void main() {
    vObjPos  = position;
    vEdge    = aEdge;
    vNormal  = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
}
`;

// ── Fragment shader (tarcza-obrys kadłuba) ───────────────────────────────────
// Geometria leży w lokalnej klatce kadłuba (x w prawo, y = -y_grid, z w górę),
// jednostki świata. Trafienia liczone dystansem planarnym w XY, obramówka
// z fresnela + pasa krawędziowego (vEdge).
const HULL_SHIELD_FRAGMENT = `
#define MAX_HITS 24
${SHIELD_UNIFORMS_GLSL}
uniform float uRimStart;
uniform float uRimIntensity;
uniform float uFilmStrength;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vObjPos;
varying float vEdge;
${SHIELD_GLSL_COMMON}
void main(){
    // ── Reveal / dissolve ─────────────────────────────────────────────────────
    float noise = snoise(vObjPos * uNoiseScale) * 0.5 + 0.5;

    float effectiveReveal = uReveal;
    if (uIsBreaking > 0.5) {
        float glitch = fract(sin(dot(vObjPos.xy, vec2(12.9898, 78.233)) + uTime * 30.0) * 43758.5453);
        effectiveReveal = max(effectiveReveal, glitch * 0.3);
    }

    float revealMask = smoothstep(effectiveReveal - uNoiseEdgeWidth, effectiveReveal, noise);
    if (revealMask < 0.001) discard;

    float innerFade  = mix(0.98, 0.15, uNoiseEdgeSmoothness);
    float edgeLow    = smoothstep(effectiveReveal-uNoiseEdgeWidth, effectiveReveal-uNoiseEdgeWidth*innerFade, noise);
    float edgeHigh   = smoothstep(effectiveReveal-uNoiseEdgeWidth*0.15, effectiveReveal, noise);
    float revealEdge = edgeLow * (1.0 - edgeHigh);

    // ── Fresnel: kopuła jest płaska na środku (przezroczysta z góry),
    //    a przy krawędzi normalne kładą się poziomo -> świecący obrys.
    float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), uFresnelPower) * uFresnelStrength;

    // ── Flow noise ────────────────────────────────────────────────────────────
    float t   = uTime * uFlowSpeed;
    float fn1 = snoise(vObjPos*uFlowScale + vec3(t, t*0.6, t*0.4));
    float fn2 = snoise(vObjPos*uFlowScale*2.1 + vec3(-t*0.5, t*0.9, t*0.3));
    float flowNoise = (fn1*0.6 + fn2*0.4)*0.5 + 0.5;

    // ── Hex w lokalnej płaszczyźnie kadłuba ───────────────────────────────────
    vec2 faceUV = vObjPos.xy;
    float hex   = hexPattern(faceUV);
    vec2  cId   = hexCellId(faceUV);
    float flash = cellFlash(cId);

    // ── Hit ring buffer: dystans planarny od punktu trafienia na obrysie ──────
    float ringContrib = 0.0;
    float hexHitBoost = 0.0;

    for (int i = 0; i < MAX_HITS; i++) {
        float ht      = uHitTime[i];
        float elapsed = uTime - ht;

        float isActive = step(0.0, ht)
                       * step(0.0, elapsed)
                       * step(elapsed, uHitDuration);

        float dist = length(vObjPos.xy - uHitPos[i].xy);

        float ringR      = min(elapsed * uHitRingSpeed, uHitMaxRadius);
        float noiseD     = snoise(vObjPos * (uNoiseScale * 2.5) + vec3(elapsed*2.0)) * uHitRingWidth * 0.45;
        float ring       = smoothstep(uHitRingWidth, 0.0, abs(dist + noiseD - ringR));
        float fade       = 1.0 - smoothstep(uHitDuration*0.5, uHitDuration, elapsed);
        float radialFade = 1.0 - smoothstep(uHitMaxRadius*0.75, uHitMaxRadius, ringR);
        ringContrib     += ring * fade * radialFade * isActive;

        float zone     = smoothstep(uHitImpactRadius, 0.0, dist);
        float zoneFade = 1.0 - smoothstep(0.0, uHitDuration*0.35, elapsed);
        hexHitBoost   += zone * zoneFade * isActive;
    }

    ringContrib = min(ringContrib, 2.0);
    hexHitBoost = min(hexHitBoost, 1.0);

    float energyBoost = uEnergyShot * 0.5;

    vec3 lColor = lifeColor(uLife);
    if (uIsBreaking > 0.5) {
        float bFlash = fract(uTime * 25.0);
        lColor = mix(vec3(1.0, 0.15, 0.1), vec3(2.0), bFlash * 0.4);
    }

    // ── Obramówka: jasny pas przy krawędzi obrysu ─────────────────────────────
    float rim = smoothstep(uRimStart, 1.0, vEdge);
    float rimGlow = rim * rim * uRimIntensity;

    // ── Film energetyczny na całej czaszy — tarcza ma widoczną "górę" ─────────
    float film = uFilmStrength * (0.55 + 0.45 * flowNoise);

    float effectiveHexOpacity = (uHexOpacity + hexHitBoost * uHitIntensity) * uShowHex;
    float intensity = hex * effectiveHexOpacity * (0.3 + fresnel*0.7) + fresnel*0.4 + flash * uShowHex;
    intensity += energyBoost + rimGlow + film;

    vec3 shieldColor = lColor * intensity * 2.0;
    shieldColor += lColor * (flowNoise * (fresnel + rim * 0.6 + uFilmStrength) * uFlowIntensity);
    shieldColor += lColor * ringContrib * uHitIntensity;

    vec3 edgeColor = mix(uNoiseEdgeColor, lColor, 1.0 - uLife);
    vec3 edgeGlow  = edgeColor * revealEdge * uNoiseEdgeIntensity;

    // Ringi trafień i rozbłysk strefy wliczone do alphy — inaczej ripple
    // znika na górze czaszy, gdzie fresnel jest mały.
    float alphaIntensity = intensity + ringContrib * uHitIntensity * 0.6 + hexHitBoost * 0.35;
    float alpha = clamp(alphaIntensity*uOpacity*revealMask + revealEdge*uNoiseEdgeIntensity, 0.0, 1.0);

    gl_FragColor = vec4(shieldColor + edgeGlow, alpha);
}
`;

// ── Shared state ─────────────────────────────────────────────────────────────
const HIT_DURATION = 1.5; // seconds — must match uHitDuration default

const state = {
    meshes: new Map(),
    geometry: null,
    // Cache geometrii tarcz-obrysów: klucz = hash binów profilu.
    // Statki tej samej klasy współdzielą geometrię.
    hullGeoCache: new Map(), // key → { geometry, refs }
    // Per-entity ring buffer for 3D hits — survives longer than shieldSystem impacts
    hitBuffers: new Map()  // entity → { hits: [{gridAngle, localAngle, startTime}], seen: Map }
};

// Shared sphere geometry — one instance for all shields
function getSharedGeometry() {
    if (!state.geometry) {
        state.geometry = new THREE.SphereGeometry(1.8, 32, 32);
    }
    return state.geometry;
}

// ── Geometria tarczy-obrysu: polarna kopuła na profilu r(θ) ─────────────────
// Rozdzielczość czaszy: 192 segmenty kątowe × 8 pierścieni — obrys ma być
// gładką krzywą (jasny rim bezlitośnie podkreśla każdą fasetkę). Geometria
// jest współdzielona per klasa kadłuba, więc koszt jest jednorazowy.
const HULL_ANGULAR_STEPS = 192;
const HULL_RADIAL_T = [0.30, 0.52, 0.70, 0.83, 0.90, 0.945, 0.975, 1.0];

function buildHullShieldGeometry(profile) {
    const N = HULL_ANGULAR_STEPS;
    const rings = HULL_RADIAL_T;
    const h = clamp(profile.minR * 0.85, 8, 140);

    const positions = [0, 0, h];
    const edges = [0];

    for (let j = 0; j < rings.length; j++) {
        const t = rings[j];
        // Spłaszczona czasza (jak ściśnięta sfera): normalne pochylają się już
        // od środka, więc fresnel daje gradient poświaty na CAŁEJ górze tarczy,
        // nie tylko na obrysie. Rim ląduje na z=0.
        const z = h * Math.pow(Math.max(0, 1 - t * t), 0.62);
        for (let i = 0; i < N; i++) {
            const theta = (i / N) * Math.PI * 2;
            const r = sampleShieldProfileRadius(profile, theta) * t;
            // Klatka grid-local (y w dół) -> geometria 3D (y w górę): y = -y_grid.
            positions.push(Math.cos(theta) * r, -Math.sin(theta) * r, z);
            edges.push(t);
        }
    }

    const indices = [];
    for (let i = 0; i < N; i++) {
        indices.push(0, 1 + ((i + 1) % N), 1 + i);
    }
    for (let j = 0; j < rings.length - 1; j++) {
        const base0 = 1 + j * N;
        const base1 = 1 + (j + 1) * N;
        for (let i = 0; i < N; i++) {
            const i1 = (i + 1) % N;
            const a = base0 + i, b = base0 + i1;
            const c = base1 + i, d = base1 + i1;
            indices.push(a, d, c);
            indices.push(a, b, d);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Gwarancja normalnych w górę (+z na czubku kopuły) — winding zależy od
    // lustrzanego odbicia y, więc weryfikujemy i ewentualnie odwracamy.
    const normals = geometry.getAttribute('normal');
    if (normals.getZ(0) < 0) {
        const idx = geometry.getIndex();
        for (let i = 0; i < idx.count; i += 3) {
            const tmp = idx.getX(i + 1);
            idx.setX(i + 1, idx.getX(i + 2));
            idx.setX(i + 2, tmp);
        }
        idx.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    return geometry;
}

function profileGeoKey(profile) {
    const bins = profile.bins;
    let hash = 0;
    for (let i = 0; i < bins.length; i++) {
        hash = ((hash * 31) + ((bins[i] * 4 + 0.5) | 0)) | 0;
    }
    return bins.length + '|' + hash;
}

function acquireHullGeometry(profile) {
    const key = profileGeoKey(profile);
    let entry = state.hullGeoCache.get(key);
    if (!entry) {
        entry = { geometry: buildHullShieldGeometry(profile), refs: 0 };
        state.hullGeoCache.set(key, entry);
    }
    entry.refs++;
    return { key, geometry: entry.geometry };
}

function releaseHullGeometry(key) {
    const entry = state.hullGeoCache.get(key);
    if (entry) entry.refs = Math.max(0, entry.refs - 1);
    // Ewikcja nieużywanych geometrii dopiero przy przepełnieniu cache.
    if (state.hullGeoCache.size > 48) {
        for (const [k, e] of state.hullGeoCache) {
            if (e.refs <= 0) {
                e.geometry.dispose();
                state.hullGeoCache.delete(k);
            }
        }
    }
}

function makeHitUniformArrays(y) {
    const hitPositions = [];
    const hitTimes = [];
    for (let i = 0; i < MAX_HITS; i++) {
        hitPositions.push(new THREE.Vector3(0, y, 0));
        hitTimes.push(-999);
    }
    return { hitPositions, hitTimes };
}

// ── Create shield material with droideka preset defaults ─────────────────────
function createShieldMaterial() {
    const { hitPositions, hitTimes } = makeHitUniformArrays(1.8);

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

// ── Materiał tarczy-obrysu: parametry przeskalowane do rozmiaru kadłuba ──────
function createHullShieldMaterial(profile) {
    const maxR = Math.max(1, profile.maxR);
    const { hitPositions, hitTimes } = makeHitUniformArrays(0);
    const hexCell = clamp(maxR * 0.16, 10, 40);

    return new THREE.ShaderMaterial({
        uniforms: {
            uTime:                { value: 0 },
            uColor:               { value: new THREE.Color('#5992f7') },
            uLife:                { value: 1.0 },
            uReveal:              { value: 1.0 },
            // Hex grid (domyślnie wyłączony — czysty energetyczny obrys)
            uHexScale:            { value: 1 / hexCell },
            uHexOpacity:          { value: 0.27 },
            uShowHex:             { value: 0.0 },
            uEdgeWidth:           { value: 0.2 },
            // Fresnel — ciaśniejszy niż na sferze, robi obramówkę
            uFresnelPower:        { value: 2.2 },
            uFresnelStrength:     { value: 2.2 },
            uOpacity:             { value: 0.30 },
            // Flash
            uFlashSpeed:          { value: 0.6 },
            uFlashIntensity:      { value: 0.11 },
            // Noise edge (reveal/dissolve) — skala w jednostkach świata
            uNoiseScale:          { value: 2.2 / maxR },
            uNoiseEdgeColor:      { value: new THREE.Color('#7faaf5') },
            uNoiseEdgeWidth:      { value: 0.1 },
            uNoiseEdgeIntensity:  { value: 0.6 },
            uNoiseEdgeSmoothness: { value: 0.5 },
            // Flow noise — intensywność jak na sferze, film niesie ją na górze
            uFlowScale:           { value: 5.5 / maxR },
            uFlowSpeed:           { value: 1.08 },
            uFlowIntensity:       { value: 4.0 },
            // Hit ring buffer — dystanse w jednostkach świata
            uHitPos:              { value: hitPositions },
            uHitTime:             { value: hitTimes },
            uHitRingSpeed:        { value: maxR * 0.85 },
            uHitRingWidth:        { value: clamp(maxR * 0.06, 5, 26) },
            uHitMaxRadius:        { value: maxR * 1.7 },
            uHitDuration:         { value: 1.5 },
            uHitIntensity:        { value: 1.0 },
            uHitImpactRadius:     { value: maxR * 0.22 },
            // Obramówka + film wnętrza
            uRimStart:            { value: 0.84 },
            uRimIntensity:        { value: 1.5 },
            uFilmStrength:        { value: 0.14 },
            // Game-specific
            uIsBreaking:          { value: 0.0 },
            uEnergyShot:          { value: 0.0 },
        },
        vertexShader: HULL_SHIELD_VERTEX,
        fragmentShader: HULL_SHIELD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        blending: THREE.AdditiveBlending
    });
}

function pickHitSlot(hits, timeNow) {
    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        if (!hit || (timeNow - (Number(hit.startTime) || 0)) >= HIT_DURATION) return i;
    }

    let oldestIdx = 0;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (let i = 0; i < hits.length; i++) {
        const hitTime = Number(hits[i]?.startTime) || 0;
        if (hitTime < oldestTime) {
            oldestTime = hitTime;
            oldestIdx = i;
        }
    }
    return oldestIdx;
}

// ── Create shield mesh for entity ────────────────────────────────────────────
function createShieldMesh(entity) {
    const material = createShieldMaterial();
    const mesh = new THREE.Mesh(getSharedGeometry(), material);
    mesh.renderOrder = 10;
    mesh.userData.kind = 'sphere';
    Core3D.scene.add(mesh);
    state.meshes.set(entity, mesh);
    return mesh;
}

function createHullShieldMesh(entity, profile) {
    const material = createHullShieldMaterial(profile);
    const { key, geometry } = acquireHullGeometry(profile);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 10;
    mesh.userData.kind = 'hull';
    mesh.userData.geoKey = key;
    mesh.userData.profileRef = profile;
    Core3D.scene.add(mesh);
    state.meshes.set(entity, mesh);
    return mesh;
}

function removeShieldMesh(entity, mesh) {
    Core3D.scene.remove(mesh);
    state.meshes.delete(entity);
    state.hitBuffers.delete(entity);
    mesh.material.dispose();
    if (mesh.userData.kind === 'hull' && mesh.userData.geoKey) {
        releaseHullGeometry(mesh.userData.geoKey);
    }
}

// ── Wspólne uniformy stanu tarczy (aktywacja/breaking/energia/HP) ────────────
function applyShieldStateUniforms(u, shield, time) {
    u.uTime.value = time;

    // Life = shield HP ratio
    u.uLife.value = Math.max(0, Math.min(1, (shield.val || 0) / (shield.max || 1)));

    // Reveal mapping from state machine
    // During activating: shield grows from center (scale handles it), fully visible
    // During breaking: dissolve out via reveal
    if (shield.state === 'breaking') {
        const breakProgress = Math.max(0, Math.min(1, shield.activationProgress || 0));
        u.uReveal.value = 1.0 - breakProgress; // dissolve out
    } else {
        u.uReveal.value = 0.0;
    }

    u.uIsBreaking.value = shield.state === 'breaking' ? 1.0 : 0.0;

    if (shield.energyShotTimer > 0) {
        u.uEnergyShot.value = shield.energyShotTimer / (shield.energyShotDuration || 1);
    } else {
        u.uEnergyShot.value = 0.0;
    }
}

// ── Ring buffer trafień 3D (dłuższy niż impacts w shieldSystem) ──────────────
function syncHitBuffer(entity, shield, time) {
    if (!state.hitBuffers.has(entity)) {
        state.hitBuffers.set(entity, { hits: new Array(MAX_HITS).fill(null), seen: new Map() });
    }
    const hb = state.hitBuffers.get(entity);

    // Detect new impacts by stable impact id; startTime alone can collide under multi-hit same-frame fire.
    const impacts = shield.impacts || [];
    for (const imp of impacts) {
        const key = Number.isFinite(imp?.id) ? `id:${imp.id}` : `t:${imp.startTime}`;
        const hitStartTime = Number(imp?.startTime) || time;
        if (key && !hb.seen.has(key)) {
            hb.seen.set(key, hitStartTime);
            const slot = pickHitSlot(hb.hits, time);
            hb.hits[slot] = {
                localAngle: imp.localAngle || 0,
                gridAngle: Number.isFinite(imp.gridAngle) ? imp.gridAngle : null,
                startTime: hitStartTime
            };
        }
    }

    // Clean up old seen keys (prevent memory leak)
    if (hb.seen.size > 96) {
        const cutoff = time - HIT_DURATION * 2;
        for (const [key, seenAt] of hb.seen) {
            if ((Number(seenAt) || 0) < cutoff) hb.seen.delete(key);
        }
    }

    return hb;
}

function resolveEntityPose(entity, interpPoseOverride) {
    let x = Number.isFinite(entity.x) ? entity.x : entity.pos?.x;
    let y = Number.isFinite(entity.y) ? entity.y : entity.pos?.y;
    let interpAngle = null;

    if (interpPoseOverride && entity.isPlayer && entity === (typeof window !== 'undefined' ? window.ship : null)) {
        x = interpPoseOverride.x;
        y = interpPoseOverride.y;
        interpAngle = interpPoseOverride.angle;
    }
    return { x: x || 0, y: y || 0, interpAngle };
}

// ── Update: tarcza-obrys kadłuba ─────────────────────────────────────────────
function updateHullShieldMesh(entity, mesh, shield, profile, time, interpPoseOverride) {
    const pose = resolveEntityPose(entity, interpPoseOverride);
    // Gracz z interpolacją: spriteRotation gracza = 0, więc kąt interpolowany
    // można podstawić wprost.
    const hullAngle = pose.interpAngle !== null ? pose.interpAngle : getShieldHullAngle(entity);

    // During activation, shield grows from center; during breaking, stays full size
    const ap = Math.max(0, Math.min(1, shield.activationProgress || 0));
    const scaleProgress = shield.state === 'breaking' ? 1 : Math.max(0.02, ap);
    mesh.scale.set(scaleProgress, scaleProgress, scaleProgress);

    mesh.position.set(pose.x, -pose.y, 1);
    mesh.rotation.set(0, 0, -hullAngle);

    const u = mesh.material.uniforms;
    applyShieldStateUniforms(u, shield, time);

    const hb = syncHitBuffer(entity, shield, time);
    for (let i = 0; i < MAX_HITS; i++) {
        const hit = hb.hits[i];
        if (hit && (time - hit.startTime) < HIT_DURATION) {
            // Kąt w klatce profilu: zapisany przy rejestracji impaktu (gridAngle),
            // fallback z localAngle (kąt świata, y-up) dla starych impaktów.
            const a = hit.gridAngle !== null ? hit.gridAngle : (-(hit.localAngle || 0) - hullAngle);
            const r = sampleShieldProfileRadius(profile, a);
            u.uHitPos.value[i].set(Math.cos(a) * r, -Math.sin(a) * r, 0);
            u.uHitTime.value[i] = hit.startTime;
        } else {
            u.uHitTime.value[i] = -999;
        }
    }
}

// ── Update: kolista bańka (oryginalna ścieżka) ───────────────────────────────
function updateSphereShieldMesh(entity, mesh, shield, time, interpPoseOverride) {
    // Uniform scale: sphere radius=1.8, shield covers the shared gameplay radius.
    const s = getEntityShieldBaseRadius(entity) / 1.8;
    // During activation, shield grows from center; during breaking, stays full size
    const ap = Math.max(0, Math.min(1, shield.activationProgress || 0));
    const scaleProgress = shield.state === 'breaking' ? 1 : Math.max(0.02, ap);
    mesh.scale.set(s * scaleProgress, s * scaleProgress, s * scaleProgress);

    const pose = resolveEntityPose(entity, interpPoseOverride);
    let visualAngle = pose.interpAngle !== null ? pose.interpAngle : (entity.angle || 0);

    const profile = entity.capitalProfile;
    if (profile) {
        if (Number.isFinite(profile.spriteRotation)) visualAngle += profile.spriteRotation;
        if (Number.isFinite(profile.shieldRotation)) visualAngle += profile.shieldRotation;
    }

    mesh.position.set(pose.x, -pose.y, 1);
    mesh.rotation.set(Math.PI / 2, -visualAngle, 0);

    const u = mesh.material.uniforms;
    applyShieldStateUniforms(u, shield, time);

    const hb = syncHitBuffer(entity, shield, time);
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

// ── Per-frame update ─────────────────────────────────────────────────────────
export function updateShields3D(dt, entities, interpPoseOverride = null) {
    if (!Core3D.isInitialized) return;
    const time = performance.now() / 1000;

    const activeEntities = new Set();

    for (const entity of entities) {
        const shield = entity?.shield;
        if (!shield || !shield.max || shield.state === 'off' || isShieldSuppressed(entity)) continue;

        // Statki z hexGrid: tarcza-obrys; reszta (stacje, budowle, myśliwce,
        // przyszłe generatory osłon obszarowych): kolista bańka.
        const profile = getEntityShieldProfile(entity);
        const kind = profile ? 'hull' : 'sphere';

        let mesh = state.meshes.get(entity);
        if (mesh && (mesh.userData.kind !== kind || (kind === 'hull' && mesh.userData.profileRef !== profile))) {
            removeShieldMesh(entity, mesh);
            mesh = null;
        }
        if (!mesh) {
            mesh = kind === 'hull' ? createHullShieldMesh(entity, profile) : createShieldMesh(entity);
        }
        activeEntities.add(entity);

        if (kind === 'hull') {
            updateHullShieldMesh(entity, mesh, shield, profile, time, interpPoseOverride);
        } else {
            updateSphereShieldMesh(entity, mesh, shield, time, interpPoseOverride);
        }
    }

    // Cleanup dead shields
    for (const [entity, mesh] of state.meshes) {
        if (!activeEntities.has(entity)) {
            removeShieldMesh(entity, mesh);
        }
    }
}
