// Materiały tła menu w TSL (port WebGPU, zadanie 11) — Ziemia w układzie ringu, poświata limbu i niebo
// kamery kinowej (menuBackdrop3D.js). 1:1 z dawnym GLSL (EARTH_FRAGMENT, ATMOSPHERE_FRAGMENT, SKY_*):
// te same wzory w tej samej kolejności, światło w układzie lokalnym ringu z jego uniformów (uCamLocal,
// uSunDir, uSunColor, uPlanet) i cień ringu z biblioteki ringu (haloRingTSL → haloRingBlock) — tło menu
// nie czyta już haloRingGLSL.js.
//
// Różnice zapisu względem GLSL (wynik ten sam):
//  - potęgi całkowite mnożeniem (pow z ujemną podstawą to NaN w WGSL — PLAN §3; FXC w bazie i tak liczył
//    pow(x, 5) mnożeniem), potęgi niecałkowite (1400, 90, 8 nieba) z podstawą ≥ 0 jak w GLSL;
//  - smoothstep z odwróconymi STAŁYMI krawędziami (brzeg płatu mgławicy: 1 → 0,45) wzorem jak HLSL —
//    wbudowany smoothstep z low ≥ high jest w WGSL błędem shadera (agents.md, pułapka 6);
//  - mgławica próbkowana z poziomu 0 (textureSampleLevel): jej tekstura ma minFilter LinearFilter — WebGL bierze sam
//    poziom 0, a three r183 na WebGPU i tak robi mipmapy i filtruje trójliniowo; bez pochodnych próbka jest też
//    poprawna w gałęzi zależnej od piksela (textureSample w niejednolitym przepływie to błąd WGSL);
//  - textureGrad chmur: pochodne uv Ziemi jak w GLSL (dFdy TSL = oś y jak w GL, agents.md pułapka 26).
// Funkcje z setLayout są CZYSTE (bez uniformów w domknięciu — agents.md pułapka 1).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, Discard, Loop,
  float, vec2, vec3, vec4, uniform, texture, varying, uv,
  positionGeometry, modelViewMatrix, cameraProjectionMatrix,
  abs, atan, clamp, dFdx, dFdy, dot, exp, floor, fract, length, max, min, mix, normalize, pow, smoothstep, sqrt, step
} from 'three/tsl';
import { haloRingTSL } from './haloRing/haloRingTSL.js';

const LUMA = vec3(0.299, 0.587, 0.114);

// ── Szum: hasz sfery (mbHash dawnego GLSL = vh nieba) i szum wartości 3D ──────────────────
const mbHash = /*@__PURE__*/ Fn(([p0]) => {
  const p = fract(p0.mul(0.3183099).add(0.1)).mul(17.0).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
}).setLayout({ name: 'menuHash13', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

const mbNoise = /*@__PURE__*/ Fn(([x]) => {
  const i = floor(x).toVar();
  const f0 = fract(x).toVar();
  const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0))).toVar();
  const h = (ox, oy, oz) => mbHash(i.add(vec3(ox, oy, oz)));
  return mix(
    mix(mix(mbHash(i), h(1.0, 0.0, 0.0), f.x), mix(h(0.0, 1.0, 0.0), h(1.0, 1.0, 0.0), f.x), f.y),
    mix(mix(h(0.0, 0.0, 1.0), h(1.0, 0.0, 1.0), f.x), mix(h(0.0, 1.0, 1.0), h(1.0, 1.0, 1.0), f.x), f.y),
    f.z
  );
}).setLayout({ name: 'menuNoise3', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] });

// fbm nieba: 5 oktaw szumu wartości (jak pętla GLSL)
const skyFbm = /*@__PURE__*/ Fn(([p0]) => {
  const s = float(0.0).toVar();
  const a = float(0.5).toVar();
  const p = vec3(p0).toVar();
  Loop({ start: 0, end: 5, type: 'int', condition: '<', name: 'oct' }, () => {
    s.addAssign(a.mul(mbNoise(p)));
    p.assign(p.mul(2.03).add(1.7));
    a.mulAssign(0.5);
  });
  return s;
}).setLayout({ name: 'menuSkyFbm', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

// hasz komórki gwiazd (h31)
const h31 = /*@__PURE__*/ Fn(([p0]) => {
  const p = fract(p0.mul(0.1031)).toVar();
  p.addAssign(dot(p, p.yzx.add(33.33)));
  return fract(p.x.add(p.y).mul(p.z));
}).setLayout({ name: 'menuHash31', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

const starLayer = /*@__PURE__*/ Fn(([d, scale, threshold]) => {
  const cp = d.mul(scale).toVar();
  const cell = floor(cp).toVar();
  const local = fract(cp).sub(0.5).toVar();
  const seed = h31(cell).toVar();
  const jitter = vec3(h31(cell.add(7.1)), h31(cell.add(3.7)), h31(cell.add(1.9))).sub(0.5).toVar();
  const radius = mix(0.05, 0.12, seed).toVar();
  const core = float(1.0).sub(smoothstep(radius.mul(0.2), radius, length(local.sub(jitter.mul(0.6)))));
  return core.mul(step(threshold, seed));
}).setLayout({
  name: 'menuStarLayer', type: 'float',
  inputs: [{ name: 'd', type: 'vec3' }, { name: 'scale', type: 'float' }, { name: 'threshold', type: 'float' }]
});

// ── Wierzchołki w układzie ringu: vPosL = uLocal · pozycja (siatka → ring), rzut jak three ────────────
function localVaryings(uLocal) {
  return {
    vUv: uv(),
    vPosL: varying(uLocal.mul(vec4(positionGeometry, 1.0)).xyz, 'vMenuPosL')
  };
}

/**
 * Ziemia tła menu (dawny EARTH_FRAGMENT): mapa normalnych z pochodnych, cień ringu (haloRingBlock), szum
 * z bliska, połysk oceanu (GGX), światła miast nocą, chmury z przesunięciem i cieniem, cienka atmosfera.
 * tex: { day, night, spec, normal, clouds } (tekstury planety gry — pożyczone). Zwraca { material, uniforms }.
 */
export function createMenuEarthMaterial(ring, tex) {
  const H = haloRingTSL(ring.uniforms);
  const U = H.uniforms;
  const uLocal = uniform(new THREE.Matrix4());
  const uCloudShift = uniform(0);
  const { vUv, vPosL } = localVaryings(uLocal);
  const dayTex = texture(tex.day, vUv);
  const nightTex = texture(tex.night, vUv);
  const specTex = texture(tex.spec, vUv);
  const normalTex = texture(tex.normal, vUv);
  const cloudTex = texture(tex.clouds, vUv);

  const fragmentNode = Fn(() => {
    const posL = vec3(vPosL).toVar();
    const Ng = normalize(posL.sub(U.uPlanet.xyz)).toVar();
    const V = normalize(U.uCamLocal.sub(posL)).toVar();
    const L = U.uSunDir;
    // mapa normalnych (rama z pochodnych, jak w grze)
    const rawN = normalTex.xyz.mul(2.0).sub(1.0).toVar();
    const mapN = vec3(rawN.xy.mul(0.9), rawN.z).toVar();
    const q0 = dFdx(posL).toVar();
    const q1 = dFdy(posL).toVar();
    const st0 = dFdx(vUv).toVar();
    const st1 = dFdy(vUv).toVar();
    const S = normalize(q0.mul(st1.y).sub(q1.mul(st0.y)).add(1e-6)).toVar();
    const T = normalize(q0.negate().mul(st1.x).add(q1.mul(st0.x)).add(1e-6)).toVar();
    const N = normalize(S.mul(mapN.x).add(T.mul(mapN.y)).add(Ng.mul(mapN.z))).toVar();
    const NgL = dot(Ng, L).toVar();
    const NdL = dot(N, L).toVar();
    const ringVis = H.haloRingBlock(posL.add(Ng.mul(8.0)), L).toVar();
    // detal z bliska: szum 3D na sferze (tekstura 8k to ~29 j./teksel)
    const dn = mbNoise(Ng.mul(U.uPlanet.w.div(420.0))).mul(0.6).add(mbNoise(Ng.mul(U.uPlanet.w.div(95.0))).mul(0.4)).toVar();
    const closeK = float(1.0).sub(smoothstep(9000.0, 30000.0, length(U.uCamLocal.sub(posL)))).toVar();
    const day = dayTex.rgb.mul(float(1.0).add(dn.sub(0.5).mul(0.22).mul(closeK))).toVar();
    const water = smoothstep(0.08, 0.8, specTex.r).toVar();
    // Chmury płyną względem lądu: przesunięcie zawinięte fract() z gradientami nieprzesuniętego UV
    // (tekstura chmur gry ma zawijanie clamp, a fract bez gradientów dawał szew mipmap na południku).
    const cuv = vec2(fract(vUv.x.add(uCloudShift)), vUv.y).toVar();
    const cRaw = dot(cloudTex.sample(cuv).grad(st0, st1).rgb, LUMA).toVar();
    const cloud = smoothstep(0.1, 0.78, cRaw.add(dn.sub(0.5).mul(0.12).mul(closeK))).toVar();
    // cień chmur: odczyt przesunięty ku słońcu (warstwa ~1% promienia nad ziemią)
    const Lt = L.sub(Ng.mul(NgL)).toVar();
    const shOff = vec2(dot(Lt, S), dot(Lt, T)).mul(0.0009).toVar();
    const shUV = vec2(fract(cuv.x.add(shOff.x)), cuv.y.add(shOff.y));
    const cShadow = smoothstep(0.15, 0.8, dot(cloudTex.sample(shUV).grad(st0, st1).rgb, LUMA)).toVar();
    const term = smoothstep(-0.06, 0.16, NgL);
    const sun = U.uSunColor.mul(ringVis).mul(term).toVar();
    const surf = day.mul(0.95).mul(sun.mul(max(NdL, 0.0)).mul(float(1.0).sub(cShadow.mul(0.55))).add(vec3(0.004, 0.006, 0.01))).toVar();
    // połysk oceanu (GGX, lekko szorstki); Fresnel (1 − cos)^5 mnożeniem
    const Hh = normalize(L.add(V)).toVar();
    const a2 = float(0.028);
    const NdH = max(dot(Ng, Hh), 0.0).toVar();
    const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0).toVar();
    const k = float(1.0).sub(max(dot(Ng, V), 0.0)).toVar();
    const k2 = k.mul(k);
    const fres = float(0.02).add(float(0.98).mul(k2.mul(k2).mul(k))).toVar();
    const glint = min(a2.div(float(3.14159).mul(dd).mul(dd)).mul(fres).mul(0.25).mul(max(NgL, 0.0)), 12.0);
    surf.addAssign(sun.mul(glint).mul(water).mul(float(1.0).sub(cloud)).mul(vec3(1.0, 0.95, 0.88)));
    // światła nocne (miasta Ziemi) po nocnej stronie i w cieniu ringu
    const night = nightTex.rgb.toVar();
    const nightMask = float(1.0).sub(smoothstep(-0.14, 0.04, NgL.mul(ringVis)));
    surf.addAssign(night.mul(night).mul(vec3(1.0, 0.72, 0.42)).mul(0.55).mul(nightMask).mul(float(1.0).sub(cloud.mul(0.8))));
    // chmury (ta sama tekstura co w grze)
    const cloudCol = vec3(0.74).mul(sun.mul(float(0.35).add(float(0.65).mul(max(NgL, 0.0)))).add(vec3(0.005, 0.007, 0.012)));
    surf.assign(mix(surf, cloudCol, cloud.mul(0.94)));
    // cienka atmosfera wzdłuż promienia: błękit w dzień, zachód przy terminatorze
    const mu = max(dot(Ng, V), 0.0);
    const airmass = float(1.0).div(mu.add(0.045));
    const ext = exp(vec3(0.020, 0.048, 0.115).negate().mul(airmass)).toVar();
    const dayF = smoothstep(-0.1, 0.3, NgL);
    const sunsetF = smoothstep(-0.2, 0.0, NgL).mul(float(1.0).sub(smoothstep(0.0, 0.28, NgL))).toVar();
    const scat = mix(vec3(0.30, 0.52, 1.0), vec3(1.0, 0.42, 0.16), sunsetF).mul(dayF.mul(0.9).add(sunsetF.mul(0.35))).mul(ringVis);
    surf.assign(surf.mul(ext).add(scat.mul(U.uSunColor).mul(vec3(1.0).sub(ext)).mul(0.62)));
    return vec4(max(surf, vec3(0.0)), 1.0);
  })();

  const material = new NodeMaterial();
  material.name = 'MenuEarth';
  material.fragmentNode = fragmentNode;
  material.fog = false;
  material.toneMapped = false;
  const uniforms = {
    ...ring.uniforms,
    uLocal,
    uCloudShift,
    dayTexture: dayTex,
    nightTexture: nightTex,
    specularTexture: specTex,
    normalTexture: normalTex,
    cloudTexture: cloudTex
  };
  material.uniforms = uniforms;
  return { material, uniforms };
}

/**
 * Poświata limbu (dawny ATMOSPHERE_FRAGMENT): tylna ścianka powłoki R + 1250, widoczna tylko poza tarczą
 * planety — cięciwa przez powłokę, gęstość e^(−h/Hs), barwa dnia / zachodu, cień ringu. Addytywnie.
 */
export function createMenuAtmosphereMaterial(ring, radiusOuter) {
  const H = haloRingTSL(ring.uniforms);
  const U = H.uniforms;
  const uLocal = uniform(new THREE.Matrix4());
  const uRa = uniform(radiusOuter);
  const { vPosL } = localVaryings(uLocal);

  const fragmentNode = Fn(() => {
    const ro = U.uCamLocal;
    const rd = normalize(vec3(vPosL).sub(ro)).toVar();
    const oc = ro.sub(U.uPlanet.xyz).toVar();
    const b = dot(oc, rd).toVar();
    const c = dot(oc, oc).sub(uRa.mul(uRa)).toVar();
    const disc = b.mul(b).sub(c).toVar();
    Discard(disc.lessThanEqual(0.0));
    const sq = sqrt(max(disc, 0.0)).toVar();
    const t0 = max(b.negate().sub(sq), 0.0).toVar();
    const t1 = b.negate().add(sq).toVar();
    const R = U.uPlanet.w;
    const cp = dot(oc, oc).sub(R.mul(R));
    const dp = b.mul(b).sub(cp).toVar();
    If(dp.greaterThan(0.0), () => {
      const tp = b.negate().sub(sqrt(dp)).toVar();
      If(tp.greaterThan(0.0), () => { t1.assign(min(t1, tp)); });
    });
    Discard(t1.lessThanEqual(t0));
    const tm = clamp(b.negate(), t0, t1);
    const pm = ro.add(rd.mul(tm)).toVar();
    const hmin = max(length(pm.sub(U.uPlanet.xyz)).sub(R), 0.0);
    const Hs = uRa.sub(R).mul(0.22);
    const tau = t1.sub(t0).mul(exp(hmin.negate().div(Hs))).div(uRa.sub(R)).mul(0.9).toVar();
    const n = normalize(pm.sub(U.uPlanet.xyz));
    const nl = dot(n, U.uSunDir).toVar();
    const dayF = smoothstep(-0.22, 0.25, nl);
    const sunsetF = smoothstep(-0.28, -0.02, nl).mul(float(1.0).sub(smoothstep(-0.02, 0.22, nl))).toVar();
    const ringVis = H.haloRingBlock(pm, U.uSunDir);
    const col = mix(vec3(0.26, 0.5, 1.0), vec3(1.0, 0.38, 0.12), sunsetF).mul(dayF.add(sunsetF.mul(0.6))).mul(ringVis);
    const glow = col.mul(U.uSunColor).mul(vec3(1.0).sub(exp(tau.negate().mul(vec3(0.35, 0.62, 1.0))))).mul(0.75);
    return vec4(glow, 1.0);
  })();

  const material = new NodeMaterial();
  material.name = 'MenuEarthAtmosphere';
  material.fragmentNode = fragmentNode;
  material.side = THREE.BackSide;
  material.transparent = true;
  material.depthWrite = false;
  // (SRC_ALPHA, ONE) jak ShaderMaterial z AdditiveBlending w bazie; alfa wyjścia = 1
  material.blending = THREE.AdditiveBlending;
  material.fog = false;
  material.toneMapped = false;
  const uniforms = { ...ring.uniforms, uLocal, uRa };
  material.uniforms = uniforms;
  return { material, uniforms };
}

/**
 * Niebo na nieskończoności (dawne SKY_VERTEX / SKY_FRAGMENT, xyww): gwiazdy w 3 warstwach, Droga Mleczna,
 * płat mgławicy gry za planetą, tarcza słońca HDR z poświatą. nebulaMap — tekstura NebulaSystem (pożyczona;
 * bez niej tekstura zastępcza i uNebulaGain = 0). Zwraca { material, uniforms } (uniformy nieba: kierunek
 * słońca i płat mgławicy w układzie nieba — MenuBackdrop3D._skyFrame).
 */
export function createMenuSkyMaterial({ nebulaMap = null, sunCore = 10 } = {}) {
  const placeholder = nebulaMap ? null : makeNebulaPlaceholder();
  const u = {
    uSunDir: uniform(new THREE.Vector3(1, 0, 0)),
    uSunCore: uniform(sunCore),
    uStars: uniform(1.0),
    uNebulaGain: uniform(0),
    uNebC: uniform(new THREE.Vector3(-1, 0, 0)),
    uNebR: uniform(new THREE.Vector3(0, -1, 0)),
    uNebU: uniform(new THREE.Vector3(0, 0, 1)),
    uNebHalf: uniform(new THREE.Vector2(1, 0.6))
  };
  const vDir = varying(normalize(positionGeometry), 'vMenuSkyDir');
  // mat3(modelViewMatrix) · pozycja (obrót grupy nieba względem kamery), potem rzut i z = w (daleko)
  const vertexNode = Fn(() => {
    const v = modelViewMatrix.mul(vec4(positionGeometry, 0.0)).xyz;
    const clip = cameraProjectionMatrix.mul(vec4(v, 1.0)).toVar();
    return vec4(clip.x, clip.y, clip.w, clip.w);
  })();

  // Płat mgławicy: kąty wokół kierunku środka płatu (uNebC), połowy szerokości w uNebHalf.
  const nebulaUv = (d, nc) => vec2(atan(dot(d, u.uNebR), nc).div(u.uNebHalf.x), atan(dot(d, u.uNebU), nc).div(u.uNebHalf.y));
  const nebulaTex = texture(nebulaMap || placeholder, vec2(0.5));

  const fragmentNode = Fn(() => {
    const d = normalize(vec3(vDir)).toVar();
    // Droga Mleczna: pasmo wokół wielkiego koła, obłok gwiazd + ciemne pasy pyłu
    const bandN = normalize(vec3(0.31, -0.52, 0.8));
    const lat = dot(d, bandN).toVar();
    const band = exp(lat.mul(lat).negate().div(2.0 * 0.16 * 0.16)).toVar();
    const core = exp(lat.mul(lat).negate().div(2.0 * 0.05 * 0.05)).toVar();
    const cloud = skyFbm(d.mul(4.0).add(3.0)).toVar();
    const dust = smoothstep(0.52, 0.72, skyFbm(d.mul(9.0).add(11.0))).mul(core).toVar();
    const glow = band.mul(float(0.35).add(float(0.9).mul(smoothstep(0.35, 0.75, cloud)))).mul(float(1.0).sub(dust.mul(0.85)));
    const col = vec3(0.0005, 0.0008, 0.0016).toVar();
    col.addAssign(vec3(0.010, 0.013, 0.022).mul(glow));
    col.addAssign(vec3(0.013, 0.011, 0.010).mul(core).mul(smoothstep(0.45, 0.8, cloud)).mul(float(1.0).sub(dust)));
    // mgławica gry: płat nieba za planetą (kąty wokół uNebC), miękki brzeg
    const nc = dot(d, u.uNebC).toVar();
    If(u.uNebulaGain.greaterThan(0.0).and(nc.greaterThan(0.05)), () => {
      const nuv = nebulaUv(d, nc).toVar();
      // smoothstep(1, 0,45, |nuv|) wzorem (odwrócone stałe krawędzie)
      const t = clamp(abs(nuv).sub(1.0).div(0.45 - 1.0), 0.0, 1.0).toVar();
      const edge = t.mul(t).mul(vec2(3.0).sub(t.mul(2.0))).toVar();
      If(edge.x.mul(edge.y).greaterThan(0.0), () => {
        // Poziom 0 jawnie: mgławica gry ma minFilter LinearFilter (WebGL: sam poziom 0, dwuliniowo), a three r183
        // na WebGPU i tak generuje mipmapy i daje samplerowi mipmapFilter 'linear' — próbka z pochodnymi była
        // trójliniowa (rozmyte włókna, 0,2% pikseli kadru > 8/255). Bez pochodnych: poprawne też w gałęzi.
        col.addAssign(nebulaTex.sample(nuv.mul(0.5).add(0.5)).level(0).rgb.mul(u.uNebulaGain).mul(edge.x).mul(edge.y));
      });
    });
    const s1 = starLayer(d, 110.0, 0.985);
    const s2 = starLayer(d.yzx.add(vec3(7.1, 3.7, 5.3)), 240.0, float(0.975).sub(band.mul(0.03)));
    const s3 = starLayer(d.zxy.add(vec3(1.9, 8.2, 4.4)), 52.0, 0.996);
    col.addAssign(vec3(0.62, 0.74, 1.0).mul(s1).mul(0.55).mul(u.uStars));
    col.addAssign(vec3(0.85, 0.9, 1.0).mul(s2).mul(0.32).mul(u.uStars).mul(float(0.6).add(band)));
    col.addAssign(vec3(1.0, 0.86, 0.7).mul(s3).mul(1.6).mul(u.uStars));
    const sd = dot(d, u.uSunDir).toVar();
    const disk = smoothstep(0.99996, 0.99999, sd);
    const sdp = max(sd, 0.0).toVar();
    const halo = pow(sdp, 1400.0).mul(1.4).add(pow(sdp, 90.0).mul(0.06)).add(pow(sdp, 8.0).mul(0.004));
    // poświata tylko poza tarczą: rdzeń zostaje dokładnie w paśmie bieli (8–12)
    col.addAssign(vec3(1.0, 0.96, 0.9).mul(mix(halo, u.uSunCore, disk)));
    return vec4(col, 1.0);
  })();

  const material = new NodeMaterial();
  material.name = 'MenuSky';
  material.vertexNode = vertexNode;
  material.fragmentNode = fragmentNode;
  material.side = THREE.BackSide;
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.toneMapped = false;
  const uniforms = { ...u, uNebulaMap: nebulaTex };
  material.uniforms = uniforms;
  return { material, uniforms, placeholder };
}

// Tekstura zastępcza mgławicy (1 × 1, czarna, filtr liniowy — ta sama ścieżka próbkowania co tekstura gry).
function makeNebulaPlaceholder() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = 'MenuSky:mglawicaZastepcza';
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
