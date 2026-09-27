// Otoczenie dema ringu Halo: Ziemia (shadery skopiowane z gry), niebo kinowe,
// tło trybu gry (mgławica + gwiazdy jak w grze), sprite Atlasa i post HDR
// (bloom z bloomConfig.js + ACES jak uberPass gry). Nic z tego nie idzie do
// portu — gra ma własne planety, tło i post.
//
// Port WebGPU (zadanie 06): wszystko w TSL (WebGPURenderer). Kinowa planeta liczy
// cień ringu funkcją haloRingBlock z biblioteki TSL ringu (haloRingTSL.js).
// Nieprzeniesione materiały ringu (ShaderMaterial, zadania 07–10) rysują się
// magentowym zamiennikiem gry (src/3d/tsl/zamiennik.js — instaluje go demo), kolor
// wyjścia jak w grze (acesGry + linearDoSrgb, src/3d/tsl/kolorGry.js), uniformy
// otoczenia przez makeUniforms (src/3d/tsl/uniformy.js).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Discard, float, int, vec2, vec3, vec4, mat3, uniform, texture, uv, varying,
  positionLocal, positionWorld, positionView, positionGeometry, normalView, normalWorld, cameraPosition,
  cameraViewMatrix, cameraProjectionMatrix, modelViewMatrix, modelWorldMatrix, screenCoordinate,
  instancedBufferAttribute, abs, floor, fract, sqrt, exp, pow, min, max, clamp, mix, step, smoothstep, dot, length,
  normalize, dFdx, dFdy, mod
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import {
  STAR_PARALLAX_LAYERS,
  computeStarParallaxFactor,
  pickStarParallaxLayer
} from '../src/3d/starParallax.js';
import { haloRingTSL } from '../src/3d/haloRing/haloRingTSL.js';
import { HALO_HDR } from '../src/3d/haloRing/haloRingConfig.js';
import { mulberry32 } from '../src/3d/haloRing/haloRingLayout.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { makeUniforms } from '../src/3d/tsl/uniformy.js';

export const DEMO_LAYERS = Object.freeze({
  world: 0,        // świat ortho gry (sprite Atlasa)
  bg: 1,           // BG persp gry: ring
  fg: 2,           // FG persp gry (po świecie ortho): suwnice, węże i dach K-7
  ringPlanet: 6,   // Ziemia w ortho (tryb gry)
  gameSky: 8,      // mgławica + gwiazdy trybu gry
  cineSky: 9,      // niebo kinowe
  cinePlanet: 10   // Ziemia w kamerze kinowej
});

// uniform() z .value — obiekt { klucz: węzeł } działa jak dawne { value }.
const U = makeUniforms;

const hash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});
const vhash = Fn(([p0]) => {
  const p = fract(p0.mul(0.3183099).add(0.1)).mul(17.0).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
});
const vnoise = Fn(([x]) => {
  const i = floor(x).toVar();
  const f0 = fract(x);
  const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0))).toVar();
  const h = (ox, oy, oz) => vhash(i.add(vec3(ox, oy, oz)));
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), f.x), mix(h(0, 1, 0), h(1, 1, 0), f.x), f.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), f.x), mix(h(0, 1, 1), h(1, 1, 1), f.x), f.y),
    f.z
  );
});

// Cień ringu na planecie gry (analityczny okrąg w płaszczyźnie, jak EARTH_FRAGMENT gry).
function ringShadowFactor(u, worldXY, lit) {
  const f = float(1.0).toVar();
  If(u.uRingShadowStrength.greaterThan(0.0005).and(u.uRingShadowRadius.greaterThan(1.0)), () => {
    const rsP = worldXY.sub(u.uRingShadowCenter).toVar();
    const rsSun = u.sunPosition.xy.sub(worldXY).toVar();
    const rsLen = length(rsSun).toVar();
    If(rsLen.greaterThan(1.0), () => {
      const rsD = rsSun.div(rsLen);
      const rsB = dot(rsP, rsD).toVar();
      const rsC = dot(rsP, rsP).sub(u.uRingShadowRadius.mul(u.uRingShadowRadius)).toVar();
      const rsDisc = rsB.mul(rsB).sub(rsC).toVar();
      If(rsC.lessThan(0.0).and(rsDisc.greaterThan(0.0)), () => {
        const rsT = rsB.negate().add(sqrt(rsDisc));
        const rsShade = float(1.0).sub(smoothstep(0.0, max(1.0, u.uRingShadowReach), rsT)).mul(u.uRingShadowStrength).mul(lit);
        f.assign(float(1.0).sub(clamp(rsShade, 0.0, 0.95)));
      });
    });
  });
  return f;
}

// Planeta w trybie gry (KOPIA 1:1 EARTH_FRAGMENT z src/3d/planet3d.assets.js).
// night = true: Ziemia (mapa nocy, normalnych, połysk oceanu); false: Mars/Jowisz.
function gamePlanetMaterial(u, tex, night) {
  const m = new THREE.NodeMaterial();
  m.name = night ? 'DemoEarthGame' : 'DemoPlanetGame';
  m.fragmentNode = Fn(() => {
    const vUv = uv();
    const vViewPosition = positionView.negate().toVar();
    const vNormal = normalView;
    const viewDir = normalize(vViewPosition).toVar();
    const sunViewPosition = cameraViewMatrix.mul(vec4(u.sunPosition, 1.0)).xyz;
    const lightDir = normalize(sunViewPosition.add(vViewPosition)).toVar();
    const halfVector = normalize(lightDir.add(viewDir));
    const normal = normalize(vNormal).toVar();
    if (night) {
      const mapN = texture(tex.normal, vUv).xyz.mul(2.0).sub(1.0).toVar();
      mapN.assign(vec3(mapN.xy.mul(0.8), mapN.z));
      const q0 = dFdx(positionView);
      const q1 = dFdy(positionView);
      const st0 = dFdx(vUv);
      const st1 = dFdy(vUv);
      const S = normalize(q0.mul(st1.y).sub(q1.mul(st0.y)));
      const T = normalize(q0.negate().mul(st1.x).add(q1.mul(st0.x)));
      const N = normalize(vNormal);
      normal.assign(normalize(mat3(S, T, N).mul(mapN)));
    }
    const NdotL = dot(normal, lightDir).toVar();
    const sunL = max(0.0, NdotL).toVar();
    const dayLight = clamp(u.uAmbient.add(sunL.mul(u.uSunIntensity)), 0.0, 1.2).toVar();
    const dayColor = texture(tex.day, vUv);
    const terminatorCenter = float(-0.02).sub(u.uSunWrap.mul(0.45)).toVar();
    const terminatorSoft = float(0.26).add(abs(u.uSunWrap).mul(0.35)).toVar();
    const mixFactor = smoothstep(terminatorCenter.sub(terminatorSoft), terminatorCenter.add(terminatorSoft), NdotL).toVar();
    const finalColor = vec3(0.0).toVar();
    if (night) {
      const nightColor = texture(tex.night, vUv);
      const specularMask = texture(tex.spec, vUv).x;
      const specular = float(0.0).toVar();
      If(sunL.greaterThan(0.0), () => {
        const waterMask = smoothstep(0.08, 0.82, specularMask);
        const NdotH = max(0.0, dot(normal, halfVector));
        const shininess = mix(16.0, 42.0, waterMask);
        specular.assign(pow(NdotH, shininess).mul(waterMask).mul(u.uSpecular).mul(sunL));
      });
      const daySide = dayColor.rgb.mul(u.uBrightness).mul(dayLight).add(vec3(0.55, 0.62, 0.78).mul(specular));
      const nightMask = float(1.0).sub(mixFactor);
      const nightBase = nightColor.rgb.toVar();
      const cityBrightness = dot(nightBase, vec3(0.299, 0.587, 0.114));
      const cityGlow = nightBase.mul(cityBrightness.mul(cityBrightness)).mul(5.0);
      const nightSide = nightBase.mul(0.55).add(cityGlow).mul(nightMask);
      finalColor.assign(mix(nightSide, daySide, mixFactor));
    } else {
      const twilight = smoothstep(terminatorCenter.sub(terminatorSoft.add(0.06)), terminatorCenter.add(terminatorSoft), NdotL);
      const minNightLight = max(0.006, u.uAmbient.mul(0.35));
      const lit = mix(minNightLight, dayLight, twilight);
      const nightBand = float(1.0).sub(smoothstep(-0.35, 0.08, NdotL));
      finalColor.assign(dayColor.rgb.mul(u.uBrightness).mul(lit).add(vec3(0.02, 0.03, 0.05).mul(nightBand)));
    }
    const sunsetBand = smoothstep(-0.30, -0.02, NdotL).mul(float(1.0).sub(smoothstep(-0.02, 0.20, NdotL))).toVar();
    finalColor.assign(mix(finalColor, finalColor.mul(u.sunsetTint), sunsetBand.mul(0.45)));
    If(u.uHazeStrength.greaterThan(0.0005), () => {
      const geoN = normalize(vNormal);
      const mu = clamp(dot(geoN, viewDir), 0.0, 1.0);
      const airmass = u.uHazeStrength.div(mu.mul(0.95).add(0.05));
      const extinction = exp(airmass.negate().mul(u.uHazeBeta)).toVar();
      const dayHaze = smoothstep(-0.02, 0.30, dot(geoN, lightDir));
      const hazeCol = u.uHazeColor.mul(dayHaze).add(u.sunsetTint.mul(0.9).mul(sunsetBand).mul(0.6));
      finalColor.assign(finalColor.mul(extinction).add(hazeCol.mul(float(1.0).sub(extinction))));
    });
    const dither = hash12(screenCoordinate.xy).sub(0.5).div(1024.0);
    finalColor.addAssign(dither.mul(mixFactor.mul(float(1.0).sub(mixFactor)).mul(4.0)));
    finalColor.assign(max(finalColor, vec3(0.0)));
    finalColor.mulAssign(ringShadowFactor(u, positionWorld.xy, mixFactor));
    const luminance = dot(finalColor, vec3(0.299, 0.587, 0.114));
    const bloomPush = smoothstep(0.85, 1.0, luminance).mul(u.uPlanetBloom);
    return vec4(finalColor.add(finalColor.mul(bloomPush)), 1.0);
  })();
  return m;
}

// Kinowa planeta i jej poświata (oświetlenie słońcem ringu, cień ringu z biblioteki TSL).
function cinePlanetMaterial(H, u, tex, earth) {
  const m = new THREE.NodeMaterial();
  m.name = earth ? 'DemoEarthCine' : 'DemoPlanetCine';
  const R = H.uniforms;
  m.fragmentNode = Fn(() => {
    const vUv = uv();
    const vPosW = positionWorld.toVar();
    const Ng = normalize(vPosW.sub(u.uCenter)).toVar();
    const V = normalize(cameraPosition.sub(vPosW));
    const L = R.uSunDir;
    const NgL = dot(Ng, L).toVar();
    const ringVis = H.haloRingBlock(vPosW.add(Ng.mul(8.0)), L).toVar();
    const dn = vnoise(Ng.mul(R.uPlanet.w).div(420.0)).mul(0.6).add(vnoise(Ng.mul(R.uPlanet.w).div(95.0)).mul(0.4)).toVar();
    const closeK = float(1.0).sub(smoothstep(9000.0, 30000.0, length(cameraPosition.sub(vPosW)))).toVar();
    const day = texture(tex.day, vUv).rgb.mul(float(1.0).add(dn.sub(0.5).mul(0.22).mul(closeK))).toVar();
    const term = smoothstep(-0.06, 0.16, NgL);
    const sun = R.uSunColor.mul(ringVis).mul(term).toVar();
    const surf = vec3(0.0).toVar();
    if (earth) {
      const mapN = texture(tex.normal, vUv).xyz.mul(2.0).sub(1.0).toVar();
      mapN.assign(vec3(mapN.xy.mul(0.9), mapN.z));
      const q0 = dFdx(vPosW);
      const q1 = dFdy(vPosW);
      const st0 = dFdx(vUv);
      const st1 = dFdy(vUv);
      const S = normalize(q0.mul(st1.y).sub(q1.mul(st0.y)).add(1e-6)).toVar();
      const T = normalize(q0.negate().mul(st1.x).add(q1.mul(st0.x)).add(1e-6)).toVar();
      const N = normalize(mat3(S, T, Ng).mul(mapN));
      const NdL = dot(N, L);
      const water = smoothstep(0.08, 0.8, texture(tex.spec, vUv).x);
      const cuv = vec2(vUv.x.add(u.uCloudShift), vUv.y).toVar();
      const cRaw = dot(texture(tex.clouds, cuv).rgb, vec3(0.299, 0.587, 0.114));
      const cloud = smoothstep(0.1, 0.78, cRaw.add(dn.sub(0.5).mul(0.12).mul(closeK))).toVar();
      // cień chmur: odczyt przesunięty ku słońcu
      const Lt = L.sub(Ng.mul(NgL));
      const shUV = cuv.add(vec2(dot(Lt, S), dot(Lt, T)).mul(0.0009));
      const cShadow = smoothstep(0.15, 0.8, dot(texture(tex.clouds, shUV).rgb, vec3(0.299, 0.587, 0.114)));
      surf.assign(day.mul(0.95).mul(sun.mul(max(NdL, 0.0)).mul(float(1.0).sub(cShadow.mul(0.55))).add(vec3(0.004, 0.006, 0.01))));
      // połysk oceanu (GGX, lekko szorstki)
      const Hh = normalize(L.add(V));
      const a2 = 0.028;
      const NdH = max(dot(Ng, Hh), 0.0);
      const dd = NdH.mul(NdH).mul(a2 - 1.0).add(1.0);
      const om = float(1.0).sub(max(dot(Ng, V), 0.0));
      const fres = float(0.02).add(float(0.98).mul(om.mul(om).mul(om).mul(om).mul(om)));
      const glint = min(float(a2).div(dd.mul(dd).mul(3.14159)).mul(fres).mul(0.25).mul(max(NgL, 0.0)), 12.0);
      surf.addAssign(sun.mul(glint).mul(water).mul(float(1.0).sub(cloud)).mul(vec3(1.0, 0.95, 0.88)));
      // światła nocne po nocnej stronie i w cieniu ringu
      const nightT = texture(tex.night, vUv).rgb;
      const nightMask = float(1.0).sub(smoothstep(-0.14, 0.04, NgL.mul(ringVis)));
      surf.addAssign(nightT.mul(nightT).mul(vec3(1.0, 0.72, 0.42)).mul(0.55).mul(nightMask).mul(float(1.0).sub(cloud.mul(0.8))));
      const cloudCol = vec3(0.74).mul(sun.mul(float(0.35).add(float(0.65).mul(max(NgL, 0.0)))).add(vec3(0.005, 0.007, 0.012)));
      surf.assign(mix(surf, cloudCol, cloud.mul(0.94)));
    } else {
      surf.assign(day.mul(0.95).mul(sun.mul(max(NgL, 0.0)).add(vec3(0.004, 0.005, 0.006))));
    }
    // cienka atmosfera wzdłuż promienia: błękit w dzień, zachód przy terminatorze
    const mu = max(dot(Ng, V), 0.0);
    const airmass = float(1.0).div(mu.add(0.045));
    const beta = earth ? vec3(0.020, 0.048, 0.115) : u.uAtmBeta;
    const ext = exp(beta.negate().mul(airmass)).toVar();
    const dayF = smoothstep(-0.1, 0.3, NgL);
    const sunsetF = smoothstep(-0.2, 0.0, NgL).mul(float(1.0).sub(smoothstep(0.0, 0.28, NgL))).toVar();
    const scatA = earth ? vec3(0.30, 0.52, 1.0) : u.uAtmScat;
    const scatB = earth ? vec3(1.0, 0.42, 0.16) : u.uAtmSunset;
    const scat = mix(scatA, scatB, sunsetF).mul(dayF.mul(0.9).add(sunsetF.mul(0.35))).mul(ringVis);
    surf.assign(surf.mul(ext).add(scat.mul(R.uSunColor).mul(float(1.0).sub(ext)).mul(0.62)));
    return vec4(max(surf, vec3(0.0)), 1.0);
  })();
  return m;
}

// Poświata limbu: tylna ścianka powłoki, widoczna tylko poza tarczą planety.
function cineAtmosphereMaterial(H, u, earth) {
  const m = new THREE.NodeMaterial();
  m.name = earth ? 'DemoEarthCineAtm' : 'DemoPlanetCineAtm';
  const R = H.uniforms;
  m.fragmentNode = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(ro)).toVar();
    const oc = ro.sub(u.uCenter).toVar();
    const b = dot(oc, rd).toVar();
    const c = dot(oc, oc).sub(u.uRa.mul(u.uRa)).toVar();
    const disc = b.mul(b).sub(c).toVar();
    If(disc.lessThanEqual(0.0), () => { Discard(); });
    const sq = sqrt(disc).toVar();
    const t0 = max(b.negate().sub(sq), 0.0).toVar();
    const t1 = b.negate().add(sq).toVar();
    const Rp = R.uPlanet.w;
    const cp = dot(oc, oc).sub(Rp.mul(Rp));
    const dp = b.mul(b).sub(cp).toVar();
    If(dp.greaterThan(0.0), () => {
      const tp = b.negate().sub(sqrt(dp));
      If(tp.greaterThan(0.0), () => { t1.assign(min(t1, tp)); });
    });
    If(t1.lessThanEqual(t0), () => { Discard(); });
    const tm = clamp(b.negate(), t0, t1);
    const pm = ro.add(rd.mul(tm)).toVar();
    const hmin = max(length(pm.sub(u.uCenter)).sub(Rp), 0.0);
    const Hs = u.uRa.sub(Rp).mul(0.22);
    const tau = t1.sub(t0).mul(exp(hmin.negate().div(Hs))).div(u.uRa.sub(Rp)).mul(0.9).toVar();
    const n = normalize(pm.sub(u.uCenter));
    const nl = dot(n, R.uSunDir).toVar();
    const dayF = smoothstep(-0.22, 0.25, nl);
    const sunsetF = smoothstep(-0.28, -0.02, nl).mul(float(1.0).sub(smoothstep(-0.02, 0.22, nl))).toVar();
    const ringVis = H.haloRingBlock(pm, R.uSunDir);
    const cA = earth ? vec3(0.26, 0.5, 1.0) : u.uAtmDay;
    const cB = earth ? vec3(1.0, 0.38, 0.12) : u.uAtmSunset;
    const col = mix(cA, cB, sunsetF).mul(dayF.add(sunsetF.mul(0.6))).mul(ringVis);
    const gain = earth ? float(0.75) : float(0.75).mul(u.uAtmGain);
    const glow = col.mul(R.uSunColor).mul(float(1.0).sub(exp(tau.negate().mul(vec3(0.35, 0.62, 1.0))))).mul(gain);
    return vec4(glow, 1.0);
  })();
  m.side = THREE.BackSide;
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.forceSinglePass = true;
  return m;
}

const texLoader = new THREE.TextureLoader();
function loadTex(path, renderer, srgb) {
  const tex = texLoader.load(path);
  tex.anisotropy = renderer.getMaxAnisotropy();
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
  const H = haloRingTSL(ringUniforms);

  const gameU = U({
    uPlanetBloom: 0.78 * BLOOM_DEFAULTS.planetBloomMultiplier,
    sunPosition: new THREE.Vector3(0, 0, 0),
    uBrightness: 1.2,
    uAmbient: 0.05,
    uSpecular: 1.2,
    uSunWrap: 0.5,
    uSunIntensity: 1.0,
    sunsetTint: new THREE.Vector3(1.4, 0.1, 0.1),
    uHazeStrength: 1.0,
    uHazeColor: new THREE.Vector3(0.55, 0.72, 1.0),
    uHazeBeta: new THREE.Vector3(0.05, 0.10, 0.22),
    uRingShadowStrength: 0.0,
    uRingShadowRadius: 0.0,
    uRingShadowReach: 1.0,
    uRingShadowCenter: new THREE.Vector2(0, 0)
  });

  // HALO_DEFAULTS z gry: rozmiar 1,05 × 0,985, coef 0,47 × 1,08 + 0,12, power 9 + 1,5
  const atmSize = 1.05 * 0.985;
  const atmU = U({ coef: 0.47 * 1.08 + 0.12, power: 9.0 + 1.5, glowColor: new THREE.Vector3(0.3, 0.6, 1.0), sunsetTint: new THREE.Vector3(1.2, 0.4, 0.1), uSunIntensity: 1.1, sunPosition: new THREE.Vector3() });
  const atmMat = new THREE.NodeMaterial();
  atmMat.name = 'DemoEarthGameAtm';
  {
    // vRimMask w wierzchołku (jak ATMOSPHERE_VERTEX): tył powłoki, zwrot od kamery
    const facing = dot(normalWorld, normalize(cameraPosition.sub(positionWorld)));
    const vRimMask = varying(clamp(facing.negate().sub(0.05), 0.0, 1.0));
    atmMat.fragmentNode = Fn(() => {
      const normalW = normalize(normalWorld);
      const radialFade = smoothstep(0.0, 1.0, pow(vRimMask, max(0.35, atmU.power.mul(0.18))));
      const rim = radialFade.mul(clamp(atmU.coef, 0.0, 2.0));
      const lightDir = normalize(atmU.sunPosition.sub(positionWorld));
      const sunDot = dot(normalW, lightDir).toVar();
      const dayFactor = smoothstep(-0.45, 0.25, sunDot);
      const sunsetFactor = smoothstep(-0.35, -0.05, sunDot).mul(float(1.0).sub(smoothstep(-0.05, 0.25, sunDot))).toVar();
      const baseColor = mix(atmU.glowColor, atmU.sunsetTint.mul(1.5), sunsetFactor.mul(0.8));
      const intensity = clamp(rim.mul(dayFactor.add(sunsetFactor.mul(0.3))), 0.0, 1.0);
      const alpha = intensity.mul(clamp(atmU.uSunIntensity, 0.2, 1.0)).toVar();
      If(alpha.lessThanEqual(0.001), () => { Discard(); });
      return vec4(baseColor, alpha);
    })();
  }
  atmMat.transparent = true;
  atmMat.side = THREE.BackSide;
  atmMat.depthWrite = false;
  atmMat.depthTest = true;
  atmMat.blending = THREE.AdditiveBlending;
  atmMat.forceSinglePass = true;

  const sphere = new THREE.SphereGeometry(1, 192, 128);
  const cloudSphere = new THREE.SphereGeometry(1.005, 192, 128);
  const atmSphere = new THREE.SphereGeometry(atmSize, 96, 64);

  // --- tryb gry
  const cloudU = U({ sunPosition: new THREE.Vector3(), uOpacity: 0.62 });
  const cloudMat = new THREE.NodeMaterial();
  cloudMat.name = 'DemoEarthGameClouds';
  cloudMat.fragmentNode = Fn(() => {
    const texel = texture(cloudTex, uv());
    const mask = dot(texel.rgb, vec3(0.299, 0.587, 0.114)).toVar();
    If(mask.lessThan(0.03), () => { Discard(); });
    const nrm = normalize(normalWorld);
    const lightDir = normalize(cloudU.sunPosition.sub(positionWorld));
    const lit = smoothstep(-0.02, 0.22, dot(nrm, lightDir)).toVar();
    const alpha = mask.mul(cloudU.uOpacity).mul(pow(lit, 1.35)).toVar();
    If(alpha.lessThan(0.01), () => { Discard(); });
    const color = vec3(1.0).mul(float(0.08).add(float(0.92).mul(lit))).toVar();
    If(gameU.uHazeStrength.greaterThan(0.0005), () => {
      const viewDirW = normalize(cameraPosition.sub(positionWorld));
      const mu = clamp(dot(nrm, viewDirW), 0.0, 1.0);
      const airmass = gameU.uHazeStrength.div(mu.mul(0.95).add(0.05));
      const extinction = exp(airmass.negate().mul(gameU.uHazeBeta)).toVar();
      const hazeDay = smoothstep(-0.02, 0.30, dot(nrm, lightDir));
      color.assign(color.mul(extinction).add(gameU.uHazeColor.mul(hazeDay).mul(float(1.0).sub(extinction))));
    });
    const shadowU = { ...gameU, sunPosition: cloudU.sunPosition };
    color.mulAssign(ringShadowFactor(shadowU, positionWorld.xy, lit));
    return vec4(color, alpha);
  })();
  cloudMat.transparent = true;
  cloudMat.depthWrite = false;
  cloudMat.side = THREE.DoubleSide;
  cloudMat.forceSinglePass = true;

  const game = new THREE.Group();
  game.name = 'EarthGame';
  const gameMesh = new THREE.Mesh(sphere, gamePlanetMaterial(gameU, { day, night, spec, normal }, true));
  const gameClouds = new THREE.Mesh(cloudSphere, cloudMat);
  const gameAtm = new THREE.Mesh(atmSphere, atmMat);
  game.add(gameMesh, gameClouds, gameAtm);
  game.scale.setScalar(planetRadius);
  game.traverse((o) => o.layers.set(DEMO_LAYERS.ringPlanet));

  // --- kamera kinowa
  const cineU = U({ uCenter: new THREE.Vector3(), uCloudShift: 0, uRa: planetRadius + 1250 });
  const cine = new THREE.Group();
  cine.name = 'EarthCinematic';
  const cineMesh = new THREE.Mesh(sphere, cinePlanetMaterial(H, cineU, { day, night, spec, normal, clouds: cloudTex }, true));
  const cineAtm = new THREE.Mesh(new THREE.SphereGeometry((planetRadius + 1250) / planetRadius, 128, 96), cineAtmosphereMaterial(H, cineU, true));
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
      cloudU.sunPosition.value.set(sx, sy, 0);
      atmU.sunPosition.value.set(sx, sy, 0);
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
// Mars i Jowisz (ringi z profilami planet, Z6 2026-09-26): sama tekstura dnia
// (bez nocy, oceanu i chmur). Tryb gry: shader planety gry (ścieżka bez nocnej
// tekstury) z liczbami DirectPlanet.init i poświata limbu jak
// createRingAtmosphere (planet3d.assets.js, RING_ATMOSPHERE_TUNE); kamera
// kinowa: to samo słońce co ring, cień ringu, cienka atmosfera w barwach planety.
export const DEMO_PLANETS = Object.freeze({
  mars: Object.freeze({
    day: '/assets/planety/solar/mars/mars_color.jpg',
    game: { ambient: 0.0035, sunIntensity: 1.04, brightness: 0.95, sunsetTint: [0.2, 0.5, 1.5], haze: 0.32, hazeColor: [0.9, 0.62, 0.42], hazeBeta: [0.14, 0.10, 0.07], bloom: 0.4 },
    atm: { height: 700, day: [0.85, 0.5, 0.3], sunset: [0.35, 0.55, 1.0], gain: 0.55, beta: [0.05, 0.04, 0.03], scat: [0.95, 0.6, 0.4] }
  }),
  jupiter: Object.freeze({
    day: '/assets/planety/solar/jupiter/jupiter_color.jpg',
    game: { ambient: 0.0025, sunIntensity: 0.92, brightness: 0.92, sunsetTint: [1.0, 0.6, 0.3], haze: 0, hazeColor: [0.55, 0.72, 1.0], hazeBeta: [0.05, 0.10, 0.22], bloom: 0.05 },
    atm: { height: 2400, day: [0.72, 0.64, 0.52], sunset: [1.0, 0.55, 0.25], gain: 0.75, beta: [0.03, 0.035, 0.045], scat: [0.8, 0.72, 0.6] }
  })
});

// Planeta dema wg klucza profilu ringu (Ziemia: createEarth bez zmian).
export function createPlanetBody(renderer, ringUniforms, planetRadius, key = 'earth') {
  const look = DEMO_PLANETS[key];
  if (!look) return createEarth(renderer, ringUniforms, planetRadius);
  const H = haloRingTSL(ringUniforms);
  const day = loadTex(look.day, renderer, true);
  const g = look.game;
  const gameU = U({
    uPlanetBloom: g.bloom * BLOOM_DEFAULTS.planetBloomMultiplier,
    sunPosition: new THREE.Vector3(),
    uBrightness: g.brightness,
    uAmbient: g.ambient,
    uSpecular: 0.0,
    uSunWrap: -0.01,
    uSunIntensity: g.sunIntensity,
    sunsetTint: new THREE.Vector3(...g.sunsetTint),
    uHazeStrength: g.haze,
    uHazeColor: new THREE.Vector3(...g.hazeColor),
    uHazeBeta: new THREE.Vector3(...g.hazeBeta),
    uRingShadowStrength: 0.0,
    uRingShadowRadius: 0.0,
    uRingShadowReach: 1.0,
    uRingShadowCenter: new THREE.Vector2(0, 0)
  });
  const a = look.atm;
  const ra = 1 + a.height / planetRadius;
  const atmU = U({
    uSunDir: new THREE.Vector3(1, 0, 0),
    uRa: ra,
    uHs: a.height * 0.22 / planetRadius,
    uDayColor: new THREE.Vector3(...a.day),
    uSunsetColor: new THREE.Vector3(...a.sunset),
    uGain: new THREE.Vector3(1.02, 0.985, 0.933).multiplyScalar(a.gain)
  });
  // Poświata limbu w passie ortho (jak RING_ATMOSPHERE_FRAGMENT gry, bez maski cieni).
  const ringAtm = new THREE.NodeMaterial();
  ringAtm.name = 'DemoRingAtmosphere';
  ringAtm.fragmentNode = Fn(() => {
    const vOff = positionLocal.xy;
    const rho = length(vOff).toVar();
    If(rho.greaterThanEqual(atmU.uRa), () => { Discard(); });
    const h = max(rho.sub(1.0), 0.0);
    const chord = float(2.0).mul(sqrt(max(atmU.uRa.mul(atmU.uRa).sub(rho.mul(rho)), 0.0)));
    const tau = chord.mul(exp(h.negate().div(atmU.uHs))).div(atmU.uRa.sub(1.0)).mul(0.9).toVar();
    const n = vec3(vOff.div(max(rho, 1e-4)), 0.0);
    const nl = dot(n, atmU.uSunDir).toVar();
    const dayF = smoothstep(-0.22, 0.25, nl);
    const sunsetF = smoothstep(-0.28, -0.02, nl).mul(float(1.0).sub(smoothstep(-0.02, 0.22, nl))).toVar();
    const col = mix(atmU.uDayColor, atmU.uSunsetColor, sunsetF).mul(dayF.add(sunsetF.mul(0.6)));
    const glow = col.mul(atmU.uGain).mul(float(1.0).sub(exp(tau.negate().mul(vec3(0.35, 0.62, 1.0))))).toVar();
    const alpha = max(glow.x, max(glow.y, glow.z)).toVar();
    If(alpha.lessThanEqual(0.001), () => { Discard(); });
    return vec4(glow, alpha);
  })();
  ringAtm.transparent = true;
  ringAtm.premultipliedAlpha = true;
  ringAtm.depthWrite = false;
  ringAtm.depthTest = true;
  ringAtm.blending = THREE.AdditiveBlending;
  ringAtm.forceSinglePass = true;

  const sphere = new THREE.SphereGeometry(1, 192, 128);
  const game = new THREE.Group();
  game.name = `${key}Game`;
  const gameMesh = new THREE.Mesh(sphere, gamePlanetMaterial(gameU, { day }, false));
  const gameAtm = new THREE.Mesh(new THREE.CircleGeometry(ra, 256), ringAtm);
  // dysk w płaszczyźnie środka planety: przednia półkula zasłania go głębią,
  // zostaje pierścień poza tarczą (jak w grze)
  game.add(gameMesh, gameAtm);
  game.scale.setScalar(planetRadius);
  game.traverse((o) => o.layers.set(DEMO_LAYERS.ringPlanet));

  const cineU = U({
    uCenter: new THREE.Vector3(),
    uAtmBeta: new THREE.Vector3(...a.beta),
    uAtmScat: new THREE.Vector3(...a.scat),
    uAtmSunset: new THREE.Vector3(...a.sunset),
    uAtmDay: new THREE.Vector3(...a.day),
    uAtmGain: a.gain / 0.95,
    uRa: planetRadius + a.height
  });
  const cine = new THREE.Group();
  cine.name = `${key}Cinematic`;
  const cineMesh = new THREE.Mesh(sphere, cinePlanetMaterial(H, cineU, { day }, false));
  const cineAtm = new THREE.Mesh(new THREE.SphereGeometry((planetRadius + a.height) / planetRadius, 128, 96), cineAtmosphereMaterial(H, cineU, false));
  cineAtm.renderOrder = 6;
  cine.add(cineMesh, cineAtm);
  cine.scale.setScalar(planetRadius);
  cine.rotation.x = Math.PI / 2;
  cine.traverse((o) => o.layers.set(DEMO_LAYERS.cinePlanet));

  let spin = 0;
  return {
    game,
    cine,
    gameUniforms: gameU,
    update(dt, { planetCenterZ, sunAzimuth, ringShadow }) {
      spin += 0.02 * dt;
      gameMesh.rotation.y = spin;
      cineMesh.rotation.y = spin;
      const dist = 1.06e6;
      const sx = Math.cos(sunAzimuth) * dist;
      const sy = Math.sin(sunAzimuth) * dist;
      gameU.sunPosition.value.set(sx, sy, 0);
      atmU.uSunDir.value.set(Math.cos(sunAzimuth), Math.sin(sunAzimuth), 0);
      if (ringShadow) {
        gameU.uRingShadowStrength.value = ringShadow.strength;
        gameU.uRingShadowRadius.value = ringShadow.radius;
        gameU.uRingShadowReach.value = ringShadow.reach;
      }
      cine.position.set(0, 0, planetCenterZ);
      cineU.uCenter.value.set(0, 0, planetCenterZ);
    }
  };
}

// ---------------------------------------------------------------------------
// Niebo kinowe: gwiazdy (3 warstwy jak ringCitySkyDome) + Droga Mleczna +
// tarcza słońca HDR z poświatą. Rysowane na nieskończoności (xyww).
const h31 = Fn(([p0]) => {
  const p = fract(p0.mul(0.1031)).toVar();
  p.addAssign(dot(p, p.yzx.add(33.33)));
  return fract(p.x.add(p.y).mul(p.z));
});
const starLayer = Fn(([d, scale, threshold]) => {
  const cp = d.mul(scale);
  const cell = floor(cp).toVar();
  const local = fract(cp).sub(0.5);
  const seed = h31(cell).toVar();
  const jitter = vec3(h31(cell.add(7.1)), h31(cell.add(3.7)), h31(cell.add(1.9))).sub(0.5);
  const radius = mix(0.05, 0.12, seed).toVar();
  const core = float(1.0).sub(smoothstep(radius.mul(0.2), radius, length(local.sub(jitter.mul(0.6)))));
  return core.mul(step(threshold, seed));
});
const skyFbm = Fn(([p0]) => {
  const p = vec3(p0).toVar();
  const s = float(0.0).toVar();
  const a = float(0.5).toVar();
  Loop(5, () => {
    s.addAssign(a.mul(vnoise(p)));
    p.assign(p.mul(2.03).add(1.7));
    a.mulAssign(0.5);
  });
  return s;
});

export function createSky() {
  const uniforms = U({ uSunDirW: new THREE.Vector3(1, 0, 0), uSunCore: HALO_HDR.sunDisk, uStars: 1.0 });
  const material = new THREE.NodeMaterial();
  material.name = 'DemoSky';
  // kierunek z geometrii sfery; pozycja na nieskończoności (xyww)
  const clip = cameraProjectionMatrix.mul(vec4(cameraViewMatrix.mul(vec4(positionGeometry, 0.0)).xyz, 1.0));
  material.vertexNode = vec4(clip.x, clip.y, clip.w, clip.w);
  material.fragmentNode = Fn(() => {
    const d = normalize(positionGeometry).toVar();
    const bandN = vec3(0.31, -0.52, 0.8).normalize();
    const lat = dot(d, bandN).toVar();
    const band = exp(lat.negate().mul(lat).div(2.0 * 0.16 * 0.16)).toVar();
    const core = exp(lat.negate().mul(lat).div(2.0 * 0.05 * 0.05)).toVar();
    const cloud = skyFbm(d.mul(4.0).add(3.0)).toVar();
    const dust = smoothstep(0.52, 0.72, skyFbm(d.mul(9.0).add(11.0))).mul(core).toVar();
    const glow = band.mul(float(0.35).add(float(0.9).mul(smoothstep(0.35, 0.75, cloud)))).mul(float(1.0).sub(dust.mul(0.85)));
    const col = vec3(0.0005, 0.0008, 0.0016).toVar();
    col.addAssign(vec3(0.020, 0.022, 0.030).mul(glow));
    col.addAssign(vec3(0.026, 0.020, 0.014).mul(core).mul(smoothstep(0.45, 0.8, cloud)).mul(float(1.0).sub(dust)));
    const s1 = starLayer(d, float(110.0), float(0.985));
    const s2 = starLayer(d.yzx.add(vec3(7.1, 3.7, 5.3)), float(240.0), float(0.975).sub(band.mul(0.03)));
    const s3 = starLayer(d.zxy.add(vec3(1.9, 8.2, 4.4)), float(52.0), float(0.996));
    col.addAssign(vec3(0.62, 0.74, 1.0).mul(s1).mul(0.55).mul(uniforms.uStars));
    col.addAssign(vec3(0.85, 0.9, 1.0).mul(s2).mul(0.32).mul(uniforms.uStars).mul(float(0.6).add(band)));
    col.addAssign(vec3(1.0, 0.86, 0.7).mul(s3).mul(1.6).mul(uniforms.uStars));
    const sd = dot(d, uniforms.uSunDirW).toVar();
    const disk = smoothstep(0.99996, 0.99999, sd);
    const sp = max(sd, 0.0).toVar();
    const halo = pow(sp, 1400.0).mul(1.4).add(pow(sp, 90.0).mul(0.06)).add(pow(sp, 8.0).mul(0.004));
    // poświata tylko poza tarczą: rdzeń zostaje dokładnie w paśmie bieli (8-12)
    col.addAssign(vec3(1.0, 0.96, 0.9).mul(mix(halo, uniforms.uSunCore, disk)));
    return vec4(col, 1.0);
  })();
  material.side = THREE.BackSide;
  material.depthTest = false;
  material.depthWrite = false;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.layers.set(DEMO_LAYERS.cineSky);
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------
// Tło trybu gry: mgławica na z = −150 000 (paralaksa 0,98) + gwiazdy
// z warstwami paralaksy gry. Gwiazdy leżą POD ringiem (z < −W): w grze są na
// z = −250 i rysowałyby się na wnętrzu wstęgi — do notatki portu.
// Gwiazdy: WebGPU rysuje punkty tylko o boku 1 px, więc to instancje duszków
// (Sprite + PointsNodeMaterial, rozmiar w pikselach jak gl_PointSize).
export function createGameBackground(renderer, { starsZ }) {
  const group = new THREE.Group();
  const neb = loadTex('/assets/nebula.png', renderer, true);
  const nebMat = new THREE.MeshBasicNodeMaterial({ map: neb, depthWrite: false, depthTest: false });
  nebMat.name = 'DemoNebula';
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
  const starU = U({ cameraOffset: new THREE.Vector2(), containerSize: worldScale });
  const aPos = instancedBufferAttribute(new THREE.InstancedBufferAttribute(pos, 3));
  const aSize = instancedBufferAttribute(new THREE.InstancedBufferAttribute(size, 1));
  const aBright = instancedBufferAttribute(new THREE.InstancedBufferAttribute(bright, 1));
  const aColor = instancedBufferAttribute(new THREE.InstancedBufferAttribute(color, 3));
  const aPar = instancedBufferAttribute(new THREE.InstancedBufferAttribute(par, 1));
  const starMat = new THREE.PointsNodeMaterial();
  starMat.name = 'DemoStars';
  const hs = starU.containerSize.mul(0.5);
  const pxy = aPos.xy.sub(starU.cameraOffset.mul(aPar));
  starMat.positionNode = vec3(mod(pxy.add(hs), starU.containerSize).sub(hs), aPos.z);
  starMat.sizeNode = aSize.mul(0.8);
  starMat.sizeAttenuation = false;
  const vColor = varying(aColor);
  const vB = varying(aBright);
  starMat.colorNode = Fn(() => {
    const dd = length(uv().sub(0.5));
    const a = float(1.0).sub(smoothstep(0.1, 0.5, dd)).mul(vB).toVar();
    If(a.lessThan(0.01), () => { Discard(); });
    return vec4(vColor.mul(a), 1.0);
  })();
  starMat.transparent = true;
  starMat.depthWrite = false;
  starMat.blending = THREE.AdditiveBlending;
  const stars = new THREE.Sprite(starMat);
  stars.count = count;
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
      starU.cameraOffset.value.set(camX, camY);
    }
  };
}

// Tekstura sprite'a kadłuba gracza (tryb lotu: frachtowce jak NPC).
export function loadShipTexture(path, renderer) {
  return loadTex(path, renderer, true);
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
// Post HDR jak w grze: scena → cel HalfFloat z MSAA → bloom (BloomNode, liczby
// z bloomConfig.js) → ACES (fit z uberPassa gry) + sRGB na kanwę (RenderPipeline).
export function createPost(renderer) {
  let sceneRT = null;
  let pipeline = null;
  let samples = 4;
  const state = { bloomOn: true, exposure: 1.0 };
  const uExposure = uniform(1.0);
  const uBloomOn = uniform(1.0);
  const sceneTex = texture(new THREE.Texture());
  const bloomNode = bloom(sceneTex, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);

  function build() {
    const c = sceneTex.rgb.add(bloomNode.rgb.mul(uBloomOn));
    const out = vec4(linearDoSrgb(acesGry(max(c, vec3(0.0)).mul(uExposure))), 1.0);
    pipeline = new THREE.RenderPipeline(renderer, out);
    pipeline.outputColorTransform = false;
  }

  function alloc(w, h) {
    sceneRT?.dispose();
    sceneRT = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true, stencilBuffer: false });
    sceneRT.texture.colorSpace = THREE.NoColorSpace;
    sceneTex.value = sceneRT.texture;
    if (!pipeline) build();
  }

  return {
    state,
    get sceneTarget() { return sceneRT; },
    configure({ msaa }) {
      samples = msaa;
    },
    resize(w, h) { alloc(w, h); },
    begin() {
      renderer.setRenderTarget(sceneRT);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
    },
    finish() {
      uExposure.value = state.exposure;
      uBloomOn.value = state.bloomOn ? 1 : 0;
      renderer.setRenderTarget(null);
      pipeline.render();
    },
    dispose() {
      sceneRT?.dispose();
      pipeline?.dispose();
    }
  };
}
