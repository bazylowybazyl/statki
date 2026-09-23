// Otoczenie dema ringu Halo: Ziemia (shadery skopiowane z gry), niebo kinowe,
// tło trybu gry (mgławica + gwiazdy jak w grze), sprite Atlasa i post HDR
// (bloom z bloomConfig.js + ACES jak uberPass gry). Nic z tego nie idzie do
// portu — gra ma własne planety, tło i post.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import {
  STAR_PARALLAX_LAYERS,
  computeStarParallaxFactor,
  pickStarParallaxLayer
} from '../src/3d/starParallax.js';
import { HALO_GLSL_COMMON, HALO_GLSL_LIGHT } from '../src/3d/haloRing/haloRingGLSL.js';
import { HALO_HDR } from '../src/3d/haloRing/haloRingConfig.js';
import { mulberry32 } from '../src/3d/haloRing/haloRingLayout.js';

export const DEMO_LAYERS = Object.freeze({
  world: 0,        // świat ortho gry (sprite Atlasa)
  bg: 1,           // BG persp gry: ring
  fg: 2,           // FG persp gry (po świecie ortho): suwnice, węże i dach K-7
  ringPlanet: 6,   // Ziemia w ortho (tryb gry)
  gameSky: 8,      // mgławica + gwiazdy trybu gry
  cineSky: 9,      // niebo kinowe
  cinePlanet: 10   // Ziemia w kamerze kinowej
});

// ---------------------------------------------------------------------------
// Shadery Ziemi — KOPIA 1:1 z src/3d/planet3d.assets.js (EARTH_*, CLOUD_*,
// ATMOSPHERE_*), żeby tryb gry wyglądał jak gra. Nie edytować tutaj.
const EARTH_VERTEX = `precision highp float; varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorldPosition; varying vec3 vViewPosition; void main() { vUv = uv; vNormal = normalize(normalMatrix * normal); vec4 worldPosition = modelMatrix * vec4(position, 1.0); vWorldPosition = worldPosition.xyz; vec4 mvPosition = viewMatrix * worldPosition; vViewPosition = -mvPosition.xyz; gl_Position = projectionMatrix * viewMatrix * worldPosition; }`;
const EARTH_FRAGMENT = `precision highp float; uniform float uPlanetBloom; uniform sampler2D dayTexture; uniform sampler2D nightTexture; uniform sampler2D specularTexture; uniform sampler2D normalTexture; uniform vec3 sunPosition; uniform vec3 sunsetTint; uniform float hasNightTexture; uniform float uBrightness; uniform float uAmbient; uniform float uSpecular; uniform float uSunWrap; uniform float uSunIntensity; uniform float uHazeStrength; uniform vec3 uHazeColor; uniform vec3 uHazeBeta; uniform float uRingShadowStrength; uniform float uRingShadowRadius; uniform float uRingShadowReach; uniform vec2 uRingShadowCenter; varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorldPosition; varying vec3 vViewPosition; float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); } void main() { vec3 viewDir = normalize(vViewPosition); vec3 sunViewPosition = (viewMatrix * vec4(sunPosition, 1.0)).xyz; vec3 lightDir = normalize(sunViewPosition + vViewPosition); vec3 halfVector = normalize(lightDir + viewDir); vec3 normal = normalize(vNormal); if (hasNightTexture > 0.5) { vec3 mapN = texture2D(normalTexture, vUv).xyz * 2.0 - 1.0; mapN.xy *= 0.8; vec3 q0 = dFdx(-vViewPosition.xyz); vec3 q1 = dFdy(-vViewPosition.xyz); vec2 st0 = dFdx(vUv.st); vec2 st1 = dFdy(vUv.st); vec3 S = normalize(q0 * st1.t - q1 * st0.t); vec3 T = normalize(-q0 * st1.s + q1 * st0.s); vec3 N = normalize(vNormal); mat3 tsn = mat3(S, T, N); normal = normalize(tsn * mapN); } float NdotL = dot(normal, lightDir); float sunL = max(0.0, NdotL); float dayLight = clamp(uAmbient + sunL * uSunIntensity, 0.0, 1.2); vec4 dayColor = texture2D(dayTexture, vUv); vec4 nightColor = texture2D(nightTexture, vUv); float specularMask = texture2D(specularTexture, vUv).r; float specular = 0.0; if (sunL > 0.0) { float waterMask = smoothstep(0.08, 0.82, specularMask); float NdotH = max(0.0, dot(normal, halfVector)); float shininess = mix(16.0, 42.0, waterMask); specular = pow(NdotH, shininess) * waterMask * uSpecular * sunL; } float terminatorCenter = -0.02 - uSunWrap * 0.45; float terminatorSoft = 0.26 + abs(uSunWrap) * 0.35; float mixFactor = smoothstep(terminatorCenter - terminatorSoft, terminatorCenter + terminatorSoft, NdotL); vec3 finalColor; if (hasNightTexture > 0.5) { vec3 daySide = dayColor.rgb * uBrightness * dayLight; daySide += vec3(0.55, 0.62, 0.78) * specular; float nightMask = 1.0 - mixFactor; vec3 nightBase = nightColor.rgb; float cityBrightness = dot(nightBase, vec3(0.299, 0.587, 0.114)); vec3 cityGlow = nightBase * pow(cityBrightness, 2.0) * 5.0; vec3 nightSide = (nightBase * 0.55 + cityGlow) * nightMask; finalColor = mix(nightSide, daySide, mixFactor); } else { float twilight = smoothstep(terminatorCenter - (terminatorSoft + 0.06), terminatorCenter + terminatorSoft, NdotL); float minNightLight = max(0.006, uAmbient * 0.35); float lit = mix(minNightLight, dayLight, twilight); float nightBand = 1.0 - smoothstep(-0.35, 0.08, NdotL); vec3 nightTint = vec3(0.02, 0.03, 0.05) * nightBand; finalColor = dayColor.rgb * uBrightness * lit + nightTint; } float sunsetBand = smoothstep(-0.30, -0.02, NdotL) * (1.0 - smoothstep(-0.02, 0.20, NdotL)); finalColor = mix(finalColor, finalColor * sunsetTint, sunsetBand * 0.45); if (uHazeStrength > 0.0005) { vec3 geoN = normalize(vNormal); float mu = clamp(dot(geoN, viewDir), 0.0, 1.0); float airmass = uHazeStrength / (mu * 0.95 + 0.05); vec3 extinction = exp(-airmass * uHazeBeta); float geoNdotL = dot(geoN, lightDir); float dayHaze = smoothstep(-0.02, 0.30, geoNdotL); vec3 hazeCol = uHazeColor * dayHaze + sunsetTint * 0.9 * sunsetBand * 0.6; finalColor = finalColor * extinction + hazeCol * (1.0 - extinction); } float dither = (hash12(gl_FragCoord.xy) - 0.5) / 1024.0; float ditherMask = mixFactor * (1.0 - mixFactor) * 4.0; finalColor += dither * ditherMask; finalColor = max(finalColor, vec3(0.0)); if (uRingShadowStrength > 0.0005 && uRingShadowRadius > 1.0) { vec2 rsP = vWorldPosition.xy - uRingShadowCenter; vec2 rsSun = sunPosition.xy - vWorldPosition.xy; float rsLen = length(rsSun); if (rsLen > 1.0) { vec2 rsD = rsSun / rsLen; float rsB = dot(rsP, rsD); float rsC = dot(rsP, rsP) - uRingShadowRadius * uRingShadowRadius; float rsDisc = rsB * rsB - rsC; if (rsC < 0.0 && rsDisc > 0.0) { float rsT = -rsB + sqrt(rsDisc); float rsShade = (1.0 - smoothstep(0.0, max(1.0, uRingShadowReach), rsT)) * uRingShadowStrength * mixFactor; finalColor *= 1.0 - clamp(rsShade, 0.0, 0.95); } } } float luminance = dot(finalColor, vec3(0.299, 0.587, 0.114)); float bloomPush = smoothstep(0.85, 1.0, luminance) * uPlanetBloom; finalColor += finalColor * bloomPush; gl_FragColor = vec4(finalColor, 1.0); }`;
const CLOUD_VERTEX = `varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorldPosition; void main() { vUv = uv; vec4 worldPosition = modelMatrix * vec4(position, 1.0); vNormal = normalize(mat3(modelMatrix) * normal); vWorldPosition = worldPosition.xyz; gl_Position = projectionMatrix * viewMatrix * worldPosition; }`;
const CLOUD_FRAGMENT = `precision highp float; uniform sampler2D cloudTexture; uniform vec3 sunPosition; uniform float uOpacity; uniform float uHazeStrength; uniform vec3 uHazeColor; uniform vec3 uHazeBeta; uniform float uRingShadowStrength; uniform float uRingShadowRadius; uniform float uRingShadowReach; uniform vec2 uRingShadowCenter; varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorldPosition; void main() { vec4 texel = texture2D(cloudTexture, vUv); float mask = dot(texel.rgb, vec3(0.299, 0.587, 0.114)); if (mask < 0.03) discard; vec3 normal = normalize(vNormal); vec3 lightDir = normalize(sunPosition - vWorldPosition); float lit = smoothstep(-0.02, 0.22, dot(normal, lightDir)); float alpha = mask * uOpacity * pow(lit, 1.35); if (alpha < 0.01) discard; vec3 color = vec3(1.0) * (0.08 + 0.92 * lit); if (uHazeStrength > 0.0005) { vec3 viewDirW = normalize(cameraPosition - vWorldPosition); float mu = clamp(dot(normal, viewDirW), 0.0, 1.0); float airmass = uHazeStrength / (mu * 0.95 + 0.05); vec3 extinction = exp(-airmass * uHazeBeta); float hazeDay = smoothstep(-0.02, 0.30, dot(normal, lightDir)); color = color * extinction + uHazeColor * hazeDay * (1.0 - extinction); } if (uRingShadowStrength > 0.0005 && uRingShadowRadius > 1.0) { vec2 rsP = vWorldPosition.xy - uRingShadowCenter; vec2 rsSun = sunPosition.xy - vWorldPosition.xy; float rsLen = length(rsSun); if (rsLen > 1.0) { vec2 rsD = rsSun / rsLen; float rsB = dot(rsP, rsD); float rsC = dot(rsP, rsP) - uRingShadowRadius * uRingShadowRadius; float rsDisc = rsB * rsB - rsC; if (rsC < 0.0 && rsDisc > 0.0) { float rsT = -rsB + sqrt(rsDisc); float rsShade = (1.0 - smoothstep(0.0, max(1.0, uRingShadowReach), rsT)) * uRingShadowStrength * lit; color *= 1.0 - clamp(rsShade, 0.0, 0.95); } } } gl_FragColor = vec4(color, alpha); }`;
const ATMOSPHERE_VERTEX = `varying vec3 vNormalWorld; varying vec3 vWorldPosition; varying float vRimMask; void main() { vNormalWorld = normalize(mat3(modelMatrix) * normal); vec4 worldPos = modelMatrix * vec4(position, 1.0); vWorldPosition = worldPos.xyz; vec3 viewDir = normalize(cameraPosition - worldPos.xyz); float facing = dot(vNormalWorld, viewDir); vRimMask = clamp(-facing - 0.05, 0.0, 1.0); vec4 viewPos = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewPos; }`;
const ATMOSPHERE_FRAGMENT = `precision highp float; varying vec3 vNormalWorld; varying vec3 vWorldPosition; varying float vRimMask; uniform vec3 glowColor; uniform vec3 sunsetTint; uniform vec3 sunPosition; uniform float coef; uniform float power; uniform float uSunIntensity; void main() { vec3 normalW = normalize(vNormalWorld); float radialFade = pow(vRimMask, max(0.35, power * 0.18)); radialFade = smoothstep(0.0, 1.0, radialFade); float rim = radialFade * clamp(coef, 0.0, 2.0); vec3 lightDir = normalize(sunPosition - vWorldPosition); float sunDot = dot(normalW, lightDir); float dayFactor = smoothstep(-0.45, 0.25, sunDot); float sunsetFactor = smoothstep(-0.35, -0.05, sunDot) * (1.0 - smoothstep(-0.05, 0.25, sunDot)); vec3 baseColor = mix(glowColor, sunsetTint * 1.5, sunsetFactor * 0.8); float intensity = clamp(rim * (dayFactor + sunsetFactor * 0.3), 0.0, 1.0); float alpha = intensity * clamp(uSunIntensity, 0.2, 1.0); if (alpha <= 0.001) discard; gl_FragColor = vec4(baseColor, alpha); }`;
// ---------------------------------------------------------------------------

// Planeta kinowa (wolno lepszą niż w grze — nie idzie do portu, brief §8):
// oświetlenie tym samym słońcem co ring, miękki terminator, połysk oceanu,
// chmury w tym samym shaderze (z cieniem), światła nocne, cienka atmosfera
// wzdłuż promienia i analityczny cień ringu (ta sama bryła co w ringu).
const CINE_EARTH_VERTEX = /* glsl */`
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNrmW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  vNrmW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const CINE_EARTH_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_LIGHT}
uniform sampler2D dayTexture;
uniform sampler2D nightTexture;
uniform sampler2D specularTexture;
uniform sampler2D normalTexture;
uniform sampler2D cloudTexture;
uniform vec3 uCenter;
uniform float uCloudShift;
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNrmW;
float vhash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vhash(i), vhash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(vhash(i + vec3(0.0, 1.0, 0.0)), vhash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(vhash(i + vec3(0.0, 0.0, 1.0)), vhash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(vhash(i + vec3(0.0, 1.0, 1.0)), vhash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
void main() {
  vec3 Ng = normalize(vPosW - uCenter);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = uSunDir;
  // mapa normalnych (rama z pochodnych, jak w grze)
  vec3 mapN = texture2D(normalTexture, vUv).xyz * 2.0 - 1.0;
  mapN.xy *= 0.9;
  vec3 q0 = dFdx(vPosW);
  vec3 q1 = dFdy(vPosW);
  vec2 st0 = dFdx(vUv);
  vec2 st1 = dFdy(vUv);
  vec3 S = normalize(q0 * st1.t - q1 * st0.t + 1e-6);
  vec3 T = normalize(-q0 * st1.s + q1 * st0.s + 1e-6);
  vec3 N = normalize(mat3(S, T, Ng) * mapN);
  float NgL = dot(Ng, L);
  float NdL = dot(N, L);
  float ringVis = haloRingBlock(vPosW + Ng * 8.0, L);
  // detal z bliska: szum 3D na sferze (tekstura 8k to ~29 j./teksel)
  float dn = vnoise(Ng * uPlanet.w / 420.0) * 0.6 + vnoise(Ng * uPlanet.w / 95.0) * 0.4;
  float closeK = 1.0 - smoothstep(9000.0, 30000.0, length(cameraPosition - vPosW));
  vec3 day = texture2D(dayTexture, vUv).rgb * (1.0 + (dn - 0.5) * 0.22 * closeK);
  float water = smoothstep(0.08, 0.8, texture2D(specularTexture, vUv).r);
  vec2 cuv = vec2(vUv.x + uCloudShift, vUv.y);
  float cRaw = dot(texture2D(cloudTexture, cuv).rgb, vec3(0.299, 0.587, 0.114));
  float cloud = smoothstep(0.1, 0.78, cRaw + (dn - 0.5) * 0.12 * closeK);
  // cien chmur: odczyt przesuniety ku sloncu (warstwa ~1% promienia nad ziemia)
  vec3 Lt = L - Ng * NgL;
  vec2 shUV = cuv + vec2(dot(Lt, S), dot(Lt, T)) * 0.0009;
  float cShadow = smoothstep(0.15, 0.8, dot(texture2D(cloudTexture, shUV).rgb, vec3(0.299, 0.587, 0.114)));
  float term = smoothstep(-0.06, 0.16, NgL);
  vec3 sun = uSunColor * ringVis * term;
  vec3 surf = day * 0.95 * (sun * max(NdL, 0.0) * (1.0 - cShadow * 0.55) + vec3(0.004, 0.006, 0.01));
  // polysk oceanu (GGX, lekko szorstki)
  vec3 H = normalize(L + V);
  float a2 = 0.028;
  float NdH = max(dot(Ng, H), 0.0);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(Ng, V), 0.0), 5.0);
  float glint = min(a2 / (3.14159 * dd * dd) * fres * 0.25 * max(NgL, 0.0), 12.0);
  surf += sun * glint * water * (1.0 - cloud) * vec3(1.0, 0.95, 0.88);
  // swiatla nocne (miasta Ziemi) po nocnej stronie i w cieniu ringu
  vec3 night = texture2D(nightTexture, vUv).rgb;
  float nightMask = 1.0 - smoothstep(-0.14, 0.04, NgL * ringVis);
  surf += night * night * vec3(1.0, 0.72, 0.42) * 0.55 * nightMask * (1.0 - cloud * 0.8);
  // chmury (ta sama tekstura co w grze)
  vec3 cloudCol = vec3(0.74) * (sun * (0.35 + 0.65 * max(NgL, 0.0)) + vec3(0.005, 0.007, 0.012));
  surf = mix(surf, cloudCol, cloud * 0.94);
  // cienka atmosfera wzdluz promienia: blekit w dzien, zachod przy terminatorze
  float mu = max(dot(Ng, V), 0.0);
  float airmass = 1.0 / (mu + 0.045);
  vec3 beta = vec3(0.020, 0.048, 0.115);
  vec3 ext = exp(-beta * airmass);
  float dayF = smoothstep(-0.1, 0.3, NgL);
  float sunsetF = smoothstep(-0.2, 0.0, NgL) * (1.0 - smoothstep(0.0, 0.28, NgL));
  vec3 scat = mix(vec3(0.30, 0.52, 1.0), vec3(1.0, 0.42, 0.16), sunsetF) * (dayF * 0.9 + sunsetF * 0.35) * ringVis;
  surf = surf * ext + scat * uSunColor * (1.0 - ext) * 0.62;
  gl_FragColor = vec4(max(surf, vec3(0.0)), 1.0);
}
`;
// Poswiata limbu: tylna scianka powloki, widoczna tylko poza tarcza planety.
const CINE_ATM_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_LIGHT}
uniform vec3 uCenter;
uniform float uRa;
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNrmW;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vPosW - ro);
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uRa * uRa;
  float disc = b * b - c;
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = -b + sq;
  float R = uPlanet.w;
  float cp = dot(oc, oc) - R * R;
  float dp = b * b - cp;
  if (dp > 0.0) { float tp = -b - sqrt(dp); if (tp > 0.0) t1 = min(t1, tp); }
  if (t1 <= t0) discard;
  float tm = clamp(-b, t0, t1);
  vec3 pm = ro + rd * tm;
  float hmin = max(length(pm - uCenter) - R, 0.0);
  float Hs = (uRa - R) * 0.22;
  float tau = (t1 - t0) * exp(-hmin / Hs) / (uRa - R) * 0.9;
  vec3 n = normalize(pm - uCenter);
  float nl = dot(n, uSunDir);
  float dayF = smoothstep(-0.22, 0.25, nl);
  float sunsetF = smoothstep(-0.28, -0.02, nl) * (1.0 - smoothstep(-0.02, 0.22, nl));
  float ringVis = haloRingBlock(pm, uSunDir);
  vec3 col = mix(vec3(0.26, 0.5, 1.0), vec3(1.0, 0.38, 0.12), sunsetF) * (dayF + sunsetF * 0.6) * ringVis;
  vec3 glow = col * uSunColor * (1.0 - exp(-tau * vec3(0.35, 0.62, 1.0))) * 0.75;
  gl_FragColor = vec4(glow, 1.0);
}
`;

const texLoader = new THREE.TextureLoader();
function loadTex(path, renderer, srgb) {
  const tex = texLoader.load(path);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ziemia w dwóch wersjach (te same tekstury): gra (ortho, oś Y jak w grze,
// słońce w płaszczyźnie XY) i kinowa (biegun = oś ringu, słońce z wysokością).
export function createEarth(renderer, ringUniforms, planetRadius) {
  const day = loadTex('/assets/planety/solar/earth/earth_color.jpg', renderer, true);
  const night = loadTex('/assets/planety/images/earth_nightmap.jpg', renderer, true);
  const spec = loadTex('/assets/planety/images/earth_specularmap.jpg', renderer, false);
  const normal = loadTex('/assets/planety/solar/earth/earth_normal.jpg', renderer, false);
  const cloudTex = loadTex('/assets/planety/solar/earth/earth_clouds.jpg', renderer, true);

  const makeUniforms = () => ({
    uPlanetBloom: { value: 0.78 * BLOOM_DEFAULTS.planetBloomMultiplier },
    dayTexture: { value: day },
    nightTexture: { value: night },
    specularTexture: { value: spec },
    normalTexture: { value: normal },
    sunPosition: { value: new THREE.Vector3(0, 0, 0) },
    hasNightTexture: { value: 1.0 },
    uBrightness: { value: 1.2 },
    uAmbient: { value: 0.05 },
    uSpecular: { value: 1.2 },
    uSunWrap: { value: 0.5 },
    uSunIntensity: { value: 1.0 },
    sunsetTint: { value: new THREE.Vector3(1.4, 0.1, 0.1) },
    uHazeStrength: { value: 1.0 },
    uHazeColor: { value: new THREE.Vector3(0.55, 0.72, 1.0) },
    uHazeBeta: { value: new THREE.Vector3(0.05, 0.10, 0.22) },
    uRingShadowStrength: { value: 0.0 },
    uRingShadowRadius: { value: 0.0 },
    uRingShadowReach: { value: 1.0 },
    uRingShadowCenter: { value: new THREE.Vector2(0, 0) }
  });

  // HALO_DEFAULTS z gry: rozmiar 1,05 × 0,985, coef 0,47 × 1,08 + 0,12, power 9 + 1,5
  const atmSize = 1.05 * 0.985;
  const makeAtm = () => new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    uniforms: {
      coef: { value: 0.47 * 1.08 + 0.12 },
      power: { value: 9.0 + 1.5 },
      glowColor: { value: new THREE.Vector3(0.3, 0.6, 1.0) },
      sunsetTint: { value: new THREE.Vector3(1.2, 0.4, 0.1) },
      uSunIntensity: { value: 1.1 },
      sunPosition: { value: new THREE.Vector3() }
    },
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending
  });

  const sphere = new THREE.SphereGeometry(1, 192, 128);
  const cloudSphere = new THREE.SphereGeometry(1.005, 192, 128);
  const atmSphere = new THREE.SphereGeometry(atmSize, 96, 64);

  // --- tryb gry
  const gameU = makeUniforms();
  const gameCloudU = {
    cloudTexture: { value: cloudTex }, sunPosition: { value: new THREE.Vector3() }, uOpacity: { value: 0.62 },
    uHazeStrength: gameU.uHazeStrength, uHazeColor: gameU.uHazeColor, uHazeBeta: gameU.uHazeBeta,
    uRingShadowStrength: gameU.uRingShadowStrength, uRingShadowRadius: gameU.uRingShadowRadius,
    uRingShadowReach: gameU.uRingShadowReach, uRingShadowCenter: gameU.uRingShadowCenter
  };
  const game = new THREE.Group();
  game.name = 'EarthGame';
  const gameMesh = new THREE.Mesh(sphere, new THREE.ShaderMaterial({ uniforms: gameU, vertexShader: EARTH_VERTEX, fragmentShader: EARTH_FRAGMENT }));
  const gameClouds = new THREE.Mesh(cloudSphere, new THREE.ShaderMaterial({ uniforms: gameCloudU, vertexShader: CLOUD_VERTEX, fragmentShader: CLOUD_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const gameAtm = new THREE.Mesh(atmSphere, makeAtm());
  game.add(gameMesh, gameClouds, gameAtm);
  game.scale.setScalar(planetRadius);
  game.traverse((o) => o.layers.set(DEMO_LAYERS.ringPlanet));

  // --- kamera kinowa: własne shadery (patrz CINE_EARTH_FRAGMENT)
  const cineU = {
    ...ringUniforms,
    dayTexture: { value: day },
    nightTexture: { value: night },
    specularTexture: { value: spec },
    normalTexture: { value: normal },
    cloudTexture: { value: cloudTex },
    uCenter: { value: new THREE.Vector3() },
    uCloudShift: { value: 0 },
    uRa: { value: planetRadius + 1250 }
  };
  const cine = new THREE.Group();
  cine.name = 'EarthCinematic';
  const cineMesh = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
    uniforms: cineU, vertexShader: CINE_EARTH_VERTEX, fragmentShader: CINE_EARTH_FRAGMENT
  }));
  const cineAtm = new THREE.Mesh(new THREE.SphereGeometry((planetRadius + 1250) / planetRadius, 128, 96), new THREE.ShaderMaterial({
    uniforms: cineU, vertexShader: CINE_EARTH_VERTEX, fragmentShader: CINE_ATM_FRAGMENT,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  cineAtm.renderOrder = 6;
  cine.add(cineMesh, cineAtm);
  cine.scale.setScalar(planetRadius);
  // biegun planety (oś Y sfery) = oś ringu (Z): ring równikowy
  cine.rotation.x = Math.PI / 2;
  cine.traverse((o) => o.layers.set(DEMO_LAYERS.cinePlanet));

  let spin = 0;
  let cloudSpin = 0;
  return {
    game,
    cine,
    gameUniforms: gameU,
    // sunInPlane: pozycja Słońca w płaszczyźnie XY (gra), sunDir: kierunek z wysokością
    update(dt, { planetCenterZ, sunAzimuth, sunDir, ringShadow }) {
      spin += 0.02 * dt;
      cloudSpin += 0.027 * dt;
      gameMesh.rotation.y = spin;
      gameClouds.rotation.y = cloudSpin;
      cineMesh.rotation.y = spin;
      cineAtm.rotation.y = spin;
      cineU.uCloudShift.value = (cloudSpin - spin) / (Math.PI * 2);
      const dist = 1.06e6;
      // gra: SUN w płaszczyźnie, z = z planety (planet3d.assets.js ≈:672)
      game.position.set(0, 0, 0);
      const sx = Math.cos(sunAzimuth) * dist;
      const sy = Math.sin(sunAzimuth) * dist;
      gameU.sunPosition.value.set(sx, sy, 0);
      gameCloudU.sunPosition.value.set(sx, sy, 0);
      gameAtm.material.uniforms.sunPosition.value.set(sx, sy, 0);
      if (ringShadow) {
        gameU.uRingShadowStrength.value = ringShadow.strength;
        gameU.uRingShadowRadius.value = ringShadow.radius;
        gameU.uRingShadowReach.value = ringShadow.reach;
      }
      // kino: planeta pod ringiem (środek z = −W/2), słońce = uSunDir ringu
      cine.position.set(0, 0, planetCenterZ);
      cineU.uCenter.value.set(0, 0, planetCenterZ);
      void sunDir;
    }
  };
}

// ---------------------------------------------------------------------------
// Niebo kinowe: gwiazdy (3 warstwy jak ringCitySkyDome) + Droga Mleczna +
// tarcza słońca HDR z poświatą. Rysowane na nieskończoności (xyww).
const SKY_VERTEX = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
}
`;
const SKY_FRAGMENT = /* glsl */`
uniform vec3 uSunDirW;
uniform float uSunCore;
uniform float uStars;
varying vec3 vDir;
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float starLayer(vec3 d, float scale, float threshold) {
  vec3 cp = d * scale;
  vec3 cell = floor(cp);
  vec3 local = fract(cp) - 0.5;
  float seed = h31(cell);
  vec3 jitter = vec3(h31(cell + 7.1), h31(cell + 3.7), h31(cell + 1.9)) - 0.5;
  float radius = mix(0.05, 0.12, seed);
  float core = 1.0 - smoothstep(radius * 0.2, radius, length(local - jitter * 0.6));
  return core * step(threshold, seed);
}
float vh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vh(i), vh(i + vec3(1.0, 0.0, 0.0)), f.x), mix(vh(i + vec3(0.0, 1.0, 0.0)), vh(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(vh(i + vec3(0.0, 0.0, 1.0)), vh(i + vec3(1.0, 0.0, 1.0)), f.x), mix(vh(i + vec3(0.0, 1.0, 1.0)), vh(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  // Droga Mleczna: pasmo wokol wielkiego kola, oblok gwiazd + ciemne pasy pylu
  vec3 bandN = normalize(vec3(0.31, -0.52, 0.8));
  float lat = dot(d, bandN);
  float band = exp(-lat * lat / (2.0 * 0.16 * 0.16));
  float core = exp(-lat * lat / (2.0 * 0.05 * 0.05));
  float cloud = fbm(d * 4.0 + 3.0);
  float dust = smoothstep(0.52, 0.72, fbm(d * 9.0 + 11.0)) * core;
  float glow = band * (0.35 + 0.9 * smoothstep(0.35, 0.75, cloud)) * (1.0 - dust * 0.85);
  vec3 col = vec3(0.0005, 0.0008, 0.0016);
  col += vec3(0.020, 0.022, 0.030) * glow;
  col += vec3(0.026, 0.020, 0.014) * core * smoothstep(0.45, 0.8, cloud) * (1.0 - dust);
  float s1 = starLayer(d, 110.0, 0.985);
  float s2 = starLayer(d.yzx + vec3(7.1, 3.7, 5.3), 240.0, 0.975 - band * 0.03);
  float s3 = starLayer(d.zxy + vec3(1.9, 8.2, 4.4), 52.0, 0.996);
  col += vec3(0.62, 0.74, 1.0) * s1 * 0.55 * uStars;
  col += vec3(0.85, 0.9, 1.0) * s2 * 0.32 * uStars * (0.6 + band);
  col += vec3(1.0, 0.86, 0.7) * s3 * 1.6 * uStars;
  float sd = dot(d, uSunDirW);
  float disk = smoothstep(0.99996, 0.99999, sd);
  float halo = pow(max(sd, 0.0), 1400.0) * 1.4 + pow(max(sd, 0.0), 90.0) * 0.06 + pow(max(sd, 0.0), 8.0) * 0.004;
  // poswiata tylko poza tarcza: rdzen zostaje dokladnie w pasmie bieli (8-12)
  col += vec3(1.0, 0.96, 0.9) * mix(halo, uSunCore, disk);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDirW: { value: new THREE.Vector3(1, 0, 0) },
      uSunCore: { value: HALO_HDR.sunDisk },
      uStars: { value: 1.0 }
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.layers.set(DEMO_LAYERS.cineSky);
  return { mesh, uniforms: material.uniforms };
}

// ---------------------------------------------------------------------------
// Tło trybu gry: mgławica na z = −150 000 (paralaksa 0,98) + gwiazdy
// z warstwami paralaksy gry. Gwiazdy leżą POD ringiem (z < −W): w grze są na
// z = −250 i rysowałyby się na wnętrzu wstęgi — do notatki portu.
export function createGameBackground(renderer, { starsZ }) {
  const group = new THREE.Group();
  const neb = loadTex('/assets/nebula.png', renderer, true);
  const nebMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: neb } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }',
    depthWrite: false,
    depthTest: false
  });
  const nebula = new THREE.Mesh(new THREE.PlaneGeometry(800000, 800000 / 1.6), nebMat);
  nebula.position.z = -150000;
  nebula.renderOrder = -999;
  nebula.frustumCulled = false;
  group.add(nebula);

  const count = 26000;
  const rand = mulberry32(0x5eed);
  const worldScale = 220000;
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const bright = new Float32Array(count);
  const color = new Float32Array(count * 3);
  const par = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const layer = pickStarParallaxLayer(rand());
    pos[i * 3] = (rand() - 0.5) * worldScale;
    pos[i * 3 + 1] = (rand() - 0.5) * worldScale;
    pos[i * 3 + 2] = 0;
    size[i] = (0.75 + Math.pow(rand(), 3) * 3.2) * layer.sizeMul * 1.65;
    bright[i] = (0.34 + rand() * 0.56) * layer.brightnessMul;
    par[i] = computeStarParallaxFactor(layer, rand());
    const r = rand();
    c.setHex(r > 0.82 ? 0x8fb7ff : r > 0.58 ? 0xdbe8ff : r > 0.22 ? 0xffffff : 0xb8d4ff);
    color.set([c.r, c.g, c.b], i * 3);
  }
  void STAR_PARALLAX_LAYERS;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('brightness', new THREE.BufferAttribute(bright, 1));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('parallaxFactor', new THREE.BufferAttribute(par, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { cameraOffset: { value: new THREE.Vector2() }, containerSize: { value: worldScale } },
    vertexShader: /* glsl */`
      uniform vec2 cameraOffset; uniform float containerSize;
      attribute float size; attribute float brightness; attribute vec3 color; attribute float parallaxFactor;
      varying vec3 vColor; varying float vB;
      void main() {
        vColor = color; vB = brightness;
        vec3 p = position;
        p.xy -= cameraOffset * parallaxFactor;
        float hs = containerSize * 0.5;
        p.xy = mod(p.xy + hs, containerSize) - hs;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = size * 0.8;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vB;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.1, 0.5, d)) * vB;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const stars = new THREE.Points(g, starMat);
  stars.frustumCulled = false;
  stars.position.z = starsZ;
  group.add(stars);
  group.traverse((o) => o.layers.set(DEMO_LAYERS.gameSky));
  return {
    group,
    update(camX, camY) {
      nebula.position.x = camX * 0.98;
      nebula.position.y = camY * 0.98;
      stars.position.x = camX;
      stars.position.y = camY;
      starMat.uniforms.cameraOffset.value.set(camX, camY);
    }
  };
}

export function createAtlasSprite(renderer) {
  const tex = loadTex('/assets/capital_ship_rect_v1.png', renderer, true);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1800, 806), mat);
  mesh.layers.set(DEMO_LAYERS.world);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Post HDR jak w grze: scena → RT HalfFloat z MSAA → kopia (resolve) →
// UnrealBloomPass (BLOOM_DEFAULTS) → ACES (fit z uberPassa gry) + sRGB.
const COPY = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }'
};
const TONEMAP = {
  uniforms: { tDiffuse: { value: null }, uExposure: { value: 1.0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uExposure; varying vec2 vUv;
    vec3 ACESFilmicToneMapping(vec3 color) {
      return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
    }
    vec4 LinearTosRGB(in vec4 value) {
      return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92, vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = LinearTosRGB(vec4(ACESFilmicToneMapping(max(c.rgb, vec3(0.0)) * uExposure), 1.0));
    }`
};

export function createPost(renderer) {
  const copyMat = new THREE.ShaderMaterial({ ...COPY, uniforms: THREE.UniformsUtils.clone(COPY.uniforms), depthTest: false, depthWrite: false });
  const toneMat = new THREE.ShaderMaterial({ ...TONEMAP, uniforms: THREE.UniformsUtils.clone(TONEMAP.uniforms), depthTest: false, depthWrite: false });
  const copyQuad = new FullScreenQuad(copyMat);
  const toneQuad = new FullScreenQuad(toneMat);
  let sceneRT = null;
  let postRT = null;
  let bloom = null;
  let samples = 4;
  let bloomScale = 1;
  const state = { bloomOn: true, exposure: 1.0 };

  function alloc(w, h) {
    sceneRT?.dispose();
    postRT?.dispose();
    sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true, stencilBuffer: false });
    postRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
    if (!bloom) {
      bloom = new UnrealBloomPass(new THREE.Vector2(w * bloomScale, h * bloomScale), BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);
    }
    bloom.setSize(Math.max(1, Math.floor(w * bloomScale)), Math.max(1, Math.floor(h * bloomScale)));
  }

  return {
    state,
    get sceneTarget() { return sceneRT; },
    configure({ msaa, bloomResolution }) {
      samples = msaa;
      bloomScale = bloomResolution;
    },
    resize(w, h) { alloc(w, h); },
    begin() {
      renderer.setRenderTarget(sceneRT);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
    },
    finish(dt) {
      renderer.setRenderTarget(postRT);
      copyMat.uniforms.tDiffuse.value = sceneRT.texture;
      copyQuad.render(renderer);
      if (state.bloomOn && bloom) bloom.render(renderer, null, postRT, dt, false);
      renderer.setRenderTarget(null);
      toneMat.uniforms.tDiffuse.value = postRT.texture;
      toneMat.uniforms.uExposure.value = state.exposure;
      toneQuad.render(renderer);
    },
    dispose() {
      sceneRT?.dispose();
      postRT?.dispose();
      bloom?.dispose();
      copyMat.dispose();
      toneMat.dispose();
    }
  };
}
