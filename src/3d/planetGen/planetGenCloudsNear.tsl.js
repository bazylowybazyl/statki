// src/3d/planetGen/planetGenCloudsNear.tsl.js
//
// CHMURY Z BLISKA planety generatora (graf 'genCloudsNear'): graf chmur GRY z hakiem jak 'genClouds'
// (planetGenClouds.tsl.js) i do tego:
//   • WYCINKI mapy chmur pod kamerą (planetGenPatch.js, rodzaj 'clouds': ten sam graf wypieku chmur w oknie kadru —
//     ostre brzegi frontów, pola drobnych kłębów) — dwa miejsca A / B w układzie KULI CHMUR (chmury obracają się
//     względem gruntu), wagi i próbki jak w materiale powierzchni (planetGenSurfaceNear.tsl.js);
//   • BRYŁOWATOŚĆ BEZ MARSZU PROMIENIA: maska = grubość chmury; światło w punkcie gaśnie z grubością chmury po drodze
//     ku słońcu (dwie próbki maski przesunięte ku słońcu o wysokość chmur / tangens wysokości słońca) — strona od
//     słońca jasna, za grubą chmurą cień, przy niskim słońcu długi. Kamera gry patrzy z góry i nie ma paralaksy, więc
//     boków chmur i tak nie widać: głębię niesie światło;
//   • detal brzegów na drabinie oktaw (wchodzi poniżej teksela mapy użytej w punkcie, gaśnie poniżej ~3 px).
// Cień chmur na gruncie liczy materiał powierzchni (uGnCloud). Graf RAZ; wartości w `material.uniforms`.
import * as THREE from 'three/webgpu';
import {
  If, float, vec2, vec3, vec4,
  asin, atan, clamp, cross, dot, exp, fwidth, length, log2, max, min, mix, normalize, smoothstep, sqrt, step,
  modelWorldMatrixInverse
} from 'three/tsl';
import { registerPlanetCloudKind, PlanetBodyNodeMaterial } from '../planet3d.assets.tsl.js';
import { pgNoised } from './planetGenNoise.tsl.js';
import { genObjectTexture, tinyTexture } from './planetGenNodes.js';
import { GEN_CLOUD_UNIFORM_KEYS } from './planetGenClouds.tsl.js';

const PI = Math.PI;
const slotKeys = (s) => ({
  [`uGc${s}X`]: 'vec3', [`uGc${s}Y`]: 'vec3', [`uGc${s}Z`]: 'vec3',   // osie układu wycinka w układzie kuli chmur
  [`uGc${s}W`]: 'vec4',   // okno: a0, b0 [rad], 1 / (szerokość · teksel), 1 / (wysokość · teksel)
  [`uGc${s}T`]: 'vec4'    // kąt teksela [rad], waga `mix` 0…1, —, —
});
/** Klucze uniformów per obiekt grafu 'genCloudsNear'. */
export const GEN_CLOUD_NEAR_UNIFORM_KEYS = Object.freeze({
  ...GEN_CLOUD_UNIFORM_KEYS,
  ...slotKeys('A'), ...slotKeys('B'),
  uGcNear: 'vec4'      // kąt teksela mapy chmur planety [rad], wysokość chmur [R], siła cienia własnego, kontrast
});
export const GEN_CLOUD_NEAR_DATA_KEYS = Object.freeze({ A: 'patchCloudA', B: 'patchCloudB', global: 'cloudTexture' });
export const GEN_CLOUD_NEAR_OCTAVES = 8;

const rgba0 = () => tinyTexture(new Uint8Array([0, 0, 0, 255]), THREE.UnsignedByteType, THREE.SRGBColorSpace);
const UV0 = vec2(0.0);
const TEX = {
  A: genObjectTexture(GEN_CLOUD_NEAR_DATA_KEYS.A, rgba0(), UV0),
  B: genObjectTexture(GEN_CLOUD_NEAR_DATA_KEYS.B, rgba0(), UV0),
  G: genObjectTexture(GEN_CLOUD_NEAR_DATA_KEYS.global, rgba0(), UV0)
};
const LUM = vec3(0.299, 0.587, 0.114);

function slotAt(s, U, p) {
  const X = U[`uGc${s}X`];
  const Y = U[`uGc${s}Y`];
  const Z = U[`uGc${s}Z`];
  const W = U[`uGc${s}W`];
  const T = U[`uGc${s}T`];
  const dx = dot(p, X).toVar();
  const sb = clamp(dot(p, Y), -1.0, 1.0).toVar();
  const uvS = vec2(atan(dot(p, Z).negate(), max(dx, 1e-4)).sub(W.x).mul(W.z), asin(sb).sub(W.y).mul(W.w)).toVar();
  const edge = min(min(uvS.x, float(1.0).sub(uvS.x)), min(uvS.y, float(1.0).sub(uvS.y)));
  const w = float(0.0).toVar();
  w.assign(smoothstep(0.0, 0.03, edge).mul(step(0.15, dx)).mul(T.y));
  const ex = cross(Y, p);
  const e = ex.div(max(length(ex), 1e-5)).toVar();
  const n = cross(p, e).toVar();
  return { w, uvS, e, n, st: max(T.x, 1e-9), W, cosB: max(sqrt(max(float(1.0).sub(sb.mul(sb)), 0.0)), 0.05) };
}

function genCloudNear({ U, local, mask, lightDir }) {
  // pochodne przed gałęziami
  const pixL = float(0.0).toVar();
  pixL.assign(length(fwidth(local)));
  const p = normalize(local).toVar();
  const stG = max(U.uGcNear.x, 1e-9);
  const A = slotAt('A', U, p);
  const B = slotAt('B', U, p);
  const wG = max(float(1.0).sub(A.w).sub(B.w), 0.0).toVar();
  // słońce w układzie kuli chmur, kierunek styczny ku słońcu
  const sunObj = normalize(modelWorldMatrixInverse.mul(vec4(lightDir, 0.0)).xyz).toVar();
  const sinE = dot(sunObj, p).toVar();
  const tv = sunObj.sub(p.mul(sinE));
  const td = tv.div(max(length(tv), 1e-4)).toVar();
  // układ mapy planety (wschód / północ) i przyrost uv na radian łuku ku słońcu — dla każdego źródła
  const ex = cross(vec3(0.0, 1.0, 0.0), p);
  const e = ex.div(max(length(ex), 1e-5)).toVar();
  const n = cross(p, e).toVar();
  const cosLat = max(sqrt(max(float(1.0).sub(p.y.mul(p.y)), 0.0)), 0.03);
  const uvG = vec2(atan(p.z.negate(), p.x.add(step(p.x.abs().add(p.z.abs()), 1e-7).mul(1e-6))).div(2 * PI).add(0.5), asin(clamp(p.y, -1.0, 1.0)).div(PI).add(0.5)).toVar();
  const duvG = vec2(dot(td, e).div(cosLat.mul(2 * PI)), dot(td, n).div(PI)).toVar();
  const duvA = vec2(dot(td, A.e).div(A.cosB).mul(A.W.z), dot(td, A.n).mul(A.W.w)).toVar();
  const duvB = vec2(dot(td, B.e).div(B.cosB).mul(B.W.z), dot(td, B.n).mul(B.W.w)).toVar();
  const lodOf = (st, k = 0.75) => max(log2(max(pixL.mul(k).div(st), 1e-6)), 0.0);
  // maska w punkcie przesuniętym o `a` radianów ku słońcu, rozmyta do `blur` radianów (jedno źródło: wycinek, w którym
  // punkt leży, inaczej mapa planety) — wynik w zmiennej, próbki w gałęziach z jawnym poziomem
  const maskAt = (a, blur) => {
    const m = vec4(0.0).toVar();
    const uA = A.uvS.add(duvA.mul(a)).toVar();
    const uB = B.uvS.add(duvB.mul(a)).toVar();
    const inA = step(0.01, min(min(uA.x, float(1.0).sub(uA.x)), min(uA.y, float(1.0).sub(uA.y)))).mul(step(0.5, A.w));
    const inB = step(0.01, min(min(uB.x, float(1.0).sub(uB.x)), min(uB.y, float(1.0).sub(uB.y)))).mul(step(0.5, B.w));
    If(inA.greaterThan(0.5).and(A.w.greaterThanEqual(B.w)), () => {
      m.assign(TEX.A.sample(uA).level(max(lodOf(A.st), log2(max(blur.div(A.st), 1.0)))));
    }).ElseIf(inB.greaterThan(0.5), () => {
      m.assign(TEX.B.sample(uB).level(max(lodOf(B.st), log2(max(blur.div(B.st), 1.0)))));
    }).ElseIf(inA.greaterThan(0.5), () => {
      m.assign(TEX.A.sample(uA).level(max(lodOf(A.st), log2(max(blur.div(A.st), 1.0)))));
    }).Else(() => {
      m.assign(TEX.G.sample(uvG.add(duvG.mul(a))).level(max(lodOf(stG), log2(max(blur.div(stG), 1.0)))));
    });
    return m;
  };
  // ── maska i barwa w punkcie: mapa planety (maska grafu gry) + wycinki ──
  const tA = vec4(0.0).toVar();
  const tB = vec4(0.0).toVar();
  If(A.w.greaterThan(0.001), () => { tA.assign(TEX.A.sample(A.uvS).level(lodOf(A.st))); });
  If(B.w.greaterThan(0.001), () => { tB.assign(TEX.B.sample(B.uvS).level(lodOf(B.st))); });
  const mA = dot(tA.rgb, LUM);
  const mB = dot(tB.rgb, LUM);
  const mRaw = mask.mul(wG).add(mA.mul(A.w)).add(mB.mul(B.w)).toVar();
  // z bliska ostrzejsze brzegi: miękki welon maski (dobry z orbity) w wycinku czyta się jak dym — kontrast rośnie
  // z wagą wycinka
  const m0 = mix(mRaw, smoothstep(0.1, 0.6, mRaw), A.w.add(B.w).mul(0.75)).toVar();
  const lvl = log2(stG.div(A.st)).mul(A.w).add(log2(stG.div(B.st)).mul(B.w)).toVar();

  // ── detal brzegów na drabinie oktaw ──
  const nz = float(0.0).toVar();
  const aAmp = float(1.0).toVar();
  for (let k = 0; k < GEN_CLOUD_NEAR_OCTAVES; k++) {
    const f = U.uGcDetail.x.mul(Math.pow(2, k));
    const gIn = smoothstep(-1.0, 0.0, float(k).sub(lvl));
    const w = float(1.0).sub(smoothstep(0.1, 0.33, f.mul(pixL))).mul(gIn).toVar();
    If(w.greaterThan(0.002), () => {
      nz.addAssign(pgNoised(p.mul(f).add(U.uGcSeed.xyz.add(k * 7.13))).x.mul(w).mul(aAmp));
    });
    aAmp.mulAssign(mix(float(1.0), float(0.62), gIn));
  }
  const edge = smoothstep(0.02, 0.3, m0).mul(float(1.0).sub(smoothstep(0.45, 0.85, m0)));
  // (najcieńszy welon gaśnie do zera — próg odrzucenia grafu gry zostawiał z bliska płaską plamę o ostrym brzegu)
  const mE = clamp(m0.add(nz.mul(U.uGcDetail.y).mul(edge)), 0.0, 1.0);
  const m1 = mE.mul(mix(float(1.0), smoothstep(0.03, 0.16, mE), A.w.add(B.w))).toVar();

  // ── światło: grubość chmur po drodze ku słońcu ──
  const shade = float(1.0).toVar();
  If(m1.greaterThan(0.02).and(sinE.greaterThan(-0.12)), () => {
    // przesunięcie ku słońcu: wysokość chmur / tangens wysokości słońca (niskie słońce — długi cień), z sufitem
    const reach = min(U.uGcNear.y.div(max(sinE.add(0.06), 0.05)), U.uGcNear.y.mul(9.0)).toVar();
    const s1 = dot(maskAt(reach.mul(0.45), reach.mul(0.3)).rgb, LUM);
    const s2 = dot(maskAt(reach.mul(1.3), reach.mul(0.8)).rgb, LUM);
    // ciemniej, gdy ku słońcu chmura grubsza niż tu; jaśniej na krawędzi od słońca
    const occ = max(s1.sub(m1.mul(0.55)), 0.0).mul(1.5).add(max(s2.sub(m1.mul(0.4)), 0.0).mul(0.9));
    const rim = max(m1.sub(s1), 0.0);
    shade.assign(clamp(exp(occ.mul(U.uGcNear.z).negate()).mul(0.72).add(0.28).add(rim.mul(U.uGcNear.w)), 0.25, 1.35));
  });
  // grubsze chmury jaśniejsze u góry (wierzchołki), cienkie szarawe
  shade.mulAssign(mix(float(0.86), float(1.04), smoothstep(0.15, 0.8, m1)));
  const tex = tA.mul(A.w).add(tB.mul(B.w));
  const lum = max(mA.mul(A.w).add(mB.mul(B.w)), 1e-3);
  return { mask: m1, shade, tintPatch: min(tex.rgb.div(lum), vec3(1.6)), tintMix: A.w.add(B.w) };
}

registerPlanetCloudKind('genCloudsNear', { keys: GEN_CLOUD_NEAR_UNIFORM_KEYS, cloud: genCloudNear, name: 'PlanetCloudsGenNear' });

/** Materiał chmur z bliska (uniformy chmur generatora + GEN_CLOUD_NEAR_UNIFORM_KEYS + tekstury wycinków). */
export const createGenCloudNearMaterial = (uniforms) => new PlanetBodyNodeMaterial('genCloudsNear', uniforms);
