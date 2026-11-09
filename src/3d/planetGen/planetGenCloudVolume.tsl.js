// src/3d/planetGen/planetGenCloudVolume.tsl.js
//
// CHMURY JAKO BRYŁA: powłoka [r0, r1] nad planetą liczona marszem promienia widzenia (siatka = kula jednostkowa,
// dziecko kuli planety obracane jak warstwa chmur). Chmura ma prawdziwą grubość: widać ją z profilu nad krawędzią
// tarczy, ma jasną stronę od słońca, ciemny spód i rzuca cień na sąsiednie chmury — to, czego płaska maska
// (planetGenCloudsNear.tsl.js) nie pokaże pod kątem.
//   • POKRYCIE z mapy chmur planety (wypiek generatora: pasy klimatu, fronty, cyklony) — gdzie i jak grubo;
//   • KSZTAŁT: kłąb tam, gdzie szum 3D (planetGenNoise3D.js, dwie skale) przekracza próg zależny od pokrycia
//     i wysokości w powłoce — kopuły zamiast płaskiego wieka; erozja brzegów drobnym szumem, pod kłębami cienka
//     ława warstwowa przy dużym pokryciu;
//   • ŚWIATŁO: w każdej próbce dwie próbki gęstości ku słońcu (bliska z kłębami, daleka bez szumu) → osłabienie światła,
//     z drugim, wolniej gasnącym członem (wielokrotne rozpraszanie w przybliżeniu), faza z rozjaśnieniem pod słońce,
//     światło nieba zależne od wysokości w chmurze, cień planety i barwa słońca przy terminatorze.
// Cień chmur na gruncie liczy materiał powierzchni z tych samych kłębów (funkcje `cloudCover`, `puffThreshold`,
// `puffShape`, `sheetDensity` stąd; uniformy uGnCloud, uGnCloudVol). Wartości per obiekt w `material.uniforms`
// (CLOUD_VOLUME_UNIFORM_KEYS, tekstura `cloudTexture`). Obraz (zasada żelazna 1).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, int, vec2, vec3, vec4, varying, positionGeometry, texture3D,
  asin, atan, abs, clamp, dot, exp, fwidth, length, log2, max, min, mix, normalize, smoothstep, step
} from 'three/tsl';
import { genObjectTexture, tinyTexture } from './planetGenNodes.js';
import { cloudNoiseTexture } from './planetGenNoise3D.js';
import { SHELL_UNIFORM_KEYS, shellPerObject, shellRay, shellUniforms, shellMaterial, planetLit, pixelNoise } from './planetGenShell.tsl.js';

const PI = Math.PI;
export const CLOUD_VOLUME_UNIFORM_KEYS = Object.freeze({
  ...SHELL_UNIFORM_KEYS,
  uCvShape: 'vec4',    // r0, r1 (promienie powłoki), ekstynkcja [1 / R], wzmocnienie pokrycia
  uCvNoise: 'vec4',    // częstość kłębów [1 / R], częstość erozji, siła erozji, czas [s]
  uCvTint: 'vec3',     // barwa chmur (albedo)
  uCvSky: 'vec4',      // rgb — światło nieba w chmurze, a — kąt teksela mapy chmur [rad]
  uCvMisc: 'vec4'      // najdłuższy odcinek marszu [R], rozjaśnienie pod słońce, krok [grubości powłoki], jasność słońca w chmurze
});
export const CLOUD_VOLUME_STEPS = 44;
export const CLOUD_VOLUME_STEPS_MIN = 16;
const LUM = vec3(0.299, 0.587, 0.114);
const cloudTex = genObjectTexture('cloudTexture', tinyTexture(new Uint8Array([0, 0, 0, 255]), THREE.UnsignedByteType, THREE.SRGBColorSpace), vec2(0.0));

// uv mapy chmur (równoodległościowej, biegun N = +Y) z kierunku w układzie kuli chmur
const dirUv = (dir) => vec2(
  atan(dir.z.negate(), dir.x.add(step(abs(dir.x).add(abs(dir.z)), 1e-7).mul(1e-6))).div(2 * PI).add(0.5),
  asin(clamp(dir.y, -1.0, 1.0)).div(PI).add(0.5)
);

// Stromość progu kłębów: gęstość = (szum − próg) · K, przycięta do 0…1 (większa = ostrzejszy brzeg kłębu).
const K = 7.0;

// POKRYCIE → PRÓG KŁĘBÓW. Kłąb jest tam, gdzie szum kształtu przekracza próg; próg spada z pokryciem mapy chmur
// i rośnie z wysokością, więc:
//   • udział powierzchni zajętej przez kłęby ≈ pokrycie (rozkład kanału R tekstury szumu: kwantyle 5 / 50 / 95% =
//     0,34 / 0,52 / 0,68 — stąd 0,71 − 0,43 · pokrycie): rzadka mgiełka mapy = pole osobnych kłębów, front = lita ława;
//   • wierzchołek kłębu leży tym wyżej, im mocniej szum przekracza próg — kopuły jak kalafior, bez płaskiego wieka;
//   • małe pokrycie = niskie kłęby (próg rośnie z wysokością szybciej), fronty i cyklony sięgają stropu powłoki.

// Części wspólne z cieniem brył chmur na gruncie (planetGenSurfaceNear.tsl.js liczy te same kłęby w punkcie, przez
// który promień słońca przechodzi nad gruntem — cień ma kształt kłębów, nie miękkiej plamy mapy pokrycia).
/** Pokrycie 0…1 z luminancji mapy chmur (`gain` — wzmocnienie stylu chmur). */
export const cloudCover = (lum, gain) => smoothstep(0.02, 0.85, lum.mul(gain));
/**
 * Ława warstwowa: cienka, półprzezroczysta warstwa w dolnej części powłoki tam, gdzie pokrycie jest duże (fronty,
 * ramiona cyklonów) — kłęby wystają z niej. Niesie wielki wzór mapy chmur, którego same kłęby nie pokażą (z daleka
 * zostawało pole „popcornu”). Gęstość 0…~0,15.
 */
export const sheetDensity = (cov, hN) => {
  const z = hN.sub(0.3).div(0.14);
  return smoothstep(0.42, 0.9, cov).mul(exp(z.mul(z).negate())).mul(0.15);
};
/** Próg kłębów z pokrycia i wysokości w powłoce (0 — podstawa, 1 — strop). */
export const puffThreshold = (cov, hN) => float(0.71).sub(cov.mul(0.43)).add(hN.mul(mix(float(0.52), float(0.27), cov)));
/** Szum kształtu kłębów w punkcie x układu kuli chmur (dwie skale; mediana ~0,52). Wklejana. */
export function puffNoise(x, freq, time, noise) {
  const q = x.mul(freq).add(vec3(time.mul(0.006), 0.0, time.mul(0.004))).toVar();
  const n = texture3D(noise, q, float(0.0)).r;
  // druga, ~3× większa skala tych samych kłębów: masy chmur z przejaśnieniami, na nich drobne kłęby (wieże tam,
  // gdzie obie skale są wysokie) — bez niej pole kłębów jednej wielkości („popcorn”) i widoczny okres kafla szumu
  const big = texture3D(noise, q.mul(0.31).add(vec3(0.37, 0.11, 0.73)), float(0.0)).r;
  return n.add(big.sub(0.52).mul(0.8));
}
/** Kształt kłębów 0…1 (bez erozji brzegów): szum kształtu ponad próg. Wklejana. */
export const puffShape = (x, thr, freq, time, noise) => clamp(puffNoise(x, freq, time, noise).sub(thr).mul(K), 0.0, 1.0);

// Wysokość punktu w powłoce 0…1 (podstawa → strop).
const heightIn = (x, U) => length(x).sub(U.uCvShape.x).div(max(U.uCvShape.y.sub(U.uCvShape.x), 1e-5));
// Pokrycie z mapy chmur w kierunku punktu x (układ kuli chmur) — próbka mapy z poziomem mipmapy.
const coverAt = (x, U, lod) => cloudCover(dot(cloudTex.sample(dirUv(x.div(max(length(x), 1e-5)))).level(lod).rgb, LUM), U.uCvShape.w);
// Zanik przy podstawie, stropie i tam, gdzie mapa jest pusta.
const fadeOf = (cov, hN) => smoothstep(0.0, 0.1, hN).mul(float(1.0).sub(smoothstep(0.86, 1.0, hN))).mul(smoothstep(0.02, 0.12, cov));

// Gęstość bez szumu (daleka próbka światła ku słońcu): kłęby zastąpione medianą szumu — ława i front rzucają
// cień, pole osobnych kłębów nie. Własna próbka mapy pokrycia (punkt leży kilka tekseli mapy dalej).
function densityCoarse(x, U, lod) {
  const cov = coverAt(x, U, lod).toVar();
  const hN = heightIn(x, U).toVar();
  return max(clamp(float(0.56).sub(puffThreshold(cov, hN)).mul(K), 0.0, 1.0).mul(fadeOf(cov, hN)), sheetDensity(cov, hN).mul(0.6));
}

// Gęstość 0…1 z kłębami w punkcie x przy pokryciu `cov` (z próbki mapy zrobionej przez wołającego). Próbki szumu
// 3D tylko tam, gdzie chmura jest możliwa (próg poniżej największej wartości szumu); `erode` — z erozją brzegów
// drobnym szumem (tylko wewnątrz kłębu), bez niej — bliska próbka światła.
function densityFull(x, U, noise, cov, erode) {
  const hN = float(0.0).toVar();
  hN.assign(heightIn(x, U));
  const thr = float(0.0).toVar();
  thr.assign(puffThreshold(cov, hN));
  const fade = float(0.0).toVar();
  fade.assign(fadeOf(cov, hN));
  const d = float(0.0).toVar();
  If(fade.greaterThan(0.002).and(thr.lessThan(1.12)), () => {
    const t = U.uCvNoise.w;
    const pn = puffNoise(x, U.uCvNoise.x, t, noise).toVar();
    const d0 = clamp(pn.sub(thr).mul(K), 0.0, 1.0).toVar();
    // ława warstwowa w płatach tego samego szumu (niższy próg): „spódnice” wokół kłębów, z przerwami
    d.assign(sheetDensity(cov, hN).mul(smoothstep(0.36, 0.6, pn)));
    if (!erode) {
      d.assign(max(d, d0.mul(fade)));
      return;
    }
    If(d0.greaterThan(0.0), () => {
      // erozja: Worley średni i drobny (kanały G, B) strzępi brzegi; wnętrze kłębu zostaje lite
      const hs = texture3D(noise, x.mul(U.uCvNoise.y).add(vec3(0.0, t.mul(0.009), 0.0)), float(0.0));
      const m = float(1.0).sub(hs.g.mul(0.62).add(hs.b.mul(0.38))).mul(U.uCvNoise.z);
      d.assign(max(d, clamp(d0.sub(m).div(max(float(1.0).sub(m), 0.2)), 0.0, 1.0).mul(fade)));
    });
  });
  return d;
}

let graph = null;
function build() {
  const U = shellPerObject(CLOUD_VOLUME_UNIFORM_KEYS);
  const noise = cloudNoiseTexture();
  const vDir = varying(positionGeometry, 'vCvDir');
  const positionNode = Fn(() => positionGeometry.mul(U.uCvShape.y))();
  const fragmentNode = Fn(() => {
    // rozmiar piksela na kuli zewnętrznej PRZED gałęziami (poziom mipmapy mapy pokrycia)
    const pixA = float(0.0).toVar();
    pixA.assign(length(fwidth(vDir)));
    const lod = clamp(log2(max(pixA.div(max(U.uCvSky.a, 1e-9)), 1e-6)), 0.0, 6.0).toVar();
    const R = shellRay(U, vDir, U.uCvShape.y, U.uCvShape.x);
    const sun = normalize(U.uShSun.xyz).toVar();
    const seg = min(max(R.t1.sub(R.t0), 0.0), U.uCvMisc.x).toVar();
    const thick = U.uCvShape.y.sub(U.uCvShape.x).toVar();
    // liczba kroków z długości odcinka: patrząc z góry powłoka jest cienka (kilkanaście kroków), przy krawędzi
    // tarczy odcinek jest wielokrotnie dłuższy (pełna liczba)
    const nS = int(clamp(seg.div(max(thick.mul(U.uCvMisc.z), 1e-7)), float(CLOUD_VOLUME_STEPS_MIN), float(CLOUD_VOLUME_STEPS))).toVar();
    const dt = seg.div(float(nS)).toVar();
    const jit = pixelNoise().toVar();
    const sigma = U.uCvShape.z;
    // faza: rozjaśnienie pod słońce (srebrne brzegi przy terminatorze), przycięte — bez prześwietlenia całej ławy
    const cosT = dot(R.rd, sun);
    const g = float(0.55);
    const hg = float(1.0).sub(g.mul(g)).div(float(1.0).add(g.mul(g)).sub(g.mul(cosT).mul(2.0)).pow(1.5));
    const phase = mix(float(1.0), clamp(hg.mul(0.55).add(0.6), 0.72, 1.9), U.uCvMisc.y).toVar();
    const Tr = float(1.0).toVar();
    const col = vec3(0.0).toVar();
    // PUSTE NIEBO: jedna próbka mapy pokrycia w środku odcinka, z poziomu mipmapy obejmującego cały odcinek —
    // gdy średnie pokrycie jest zerowe, marsz się nie zaczyna (większość tarczy to czyste niebo)
    const xm = R.o.add(R.rd.mul(R.t0.add(seg.mul(0.5))));
    const lodSeg = clamp(log2(max(seg.div(max(U.uCvSky.a, 1e-9)), 1e-6)).add(1.0), lod, 9.0);
    const any = dot(cloudTex.sample(dirUv(xm.div(max(length(xm), 1e-5)))).level(lodSeg).rgb, LUM).mul(U.uCvShape.w);
    If(dt.greaterThan(1e-7).and(any.greaterThan(0.02)), () => {
      Loop({ start: int(0), end: nS, type: 'int', condition: '<' }, ({ i }) => {
        const x = R.o.add(R.rd.mul(R.t0.add(dt.mul(jit.add(float(i)))))).toVar();
        // pokrycie z mapy raz na krok — służy też bliskiej próbce światła (leży ułamek teksela mapy dalej)
        const cov = coverAt(x, U, lod).toVar();
        const d = densityFull(x, U, noise, cov, true);
        If(d.greaterThan(0.004), () => {
          // nocna strona (poza pasem zmierzchu) — bez próbek światła: chmura tylko zasłania
          const mu = dot(normalize(x), sun).toVar();
          const S = vec3(0.0).toVar();
          If(mu.greaterThan(-0.2), () => {
          // światło słońca: dwie próbki gęstości ku słońcu — bliska z kłębami (sąsiednie kłęby cieniują się
          // nawzajem, wierzchołek jest jaśniejszy niż bok), daleka bez szumu z rzadszej mipmapy (cień ławy i frontu)
          const tau = float(0.0).toVar();
          tau.addAssign(densityFull(x.add(sun.mul(thick.mul(0.16))), U, noise, cov, false).mul(thick.mul(0.3)));
          tau.addAssign(densityCoarse(x.add(sun.mul(thick.mul(1.1))), U, lod.add(2.0)).mul(thick.mul(2.4)));
          const od = tau.mul(sigma);
          // osłabienie wprost + wolniej gasnący człon (światło rozproszone wielokrotnie we wnętrzu chmury)
          const lightT = exp(od.negate()).mul(0.7).add(exp(od.mul(-0.14)).mul(0.3));
          const lit = planetLit(x, sun);
          const sunCol = mix(vec3(1.0, 0.46, 0.2), vec3(1.0, 0.97, 0.93), smoothstep(-0.03, 0.26, mu)).mul(U.uShSun.w);
          const hN = length(x).sub(U.uCvShape.x).div(max(thick, 1e-5));
          // światło nieba: wierzchołki jaśniejsze niż podstawy, tylko po dziennej stronie
          const sky = U.uCvSky.rgb.mul(hN.mul(0.7).add(0.3)).mul(smoothstep(-0.1, 0.25, mu));
          S.assign(U.uCvTint.mul(sunCol.mul(lightT).mul(phase).mul(lit).mul(U.uCvMisc.w).add(sky)));
          });
          const a = float(1.0).sub(exp(d.mul(sigma).mul(dt).negate()));
          col.addAssign(S.mul(a).mul(Tr));
          Tr.mulAssign(float(1.0).sub(a));
        });
        If(Tr.lessThan(0.03), () => { Break(); });
      });
    });
    return vec4(col, float(1.0).sub(Tr));
  })();
  return { positionNode, fragmentNode };
}

/** Materiał chmur-bryły (kula jednostkowa; barwa pomnożona przez krycie). */
export function createGenCloudVolumeMaterial(uniforms) {
  if (!graph) graph = build();
  return shellMaterial('PlanetGenCloudVolume', graph, uniforms, 'over');
}

/**
 * Uniformy chmur-bryły z opisu planety i map (`maps.clouds` — z mipmapami). Powłoka 0,3–1,7% promienia nad powierzchnią —
 * przesadzona względem prawdziwej (jak cała rzeźba planet gry), żeby chmury było widać z profilu.
 */
export function cloudVolumeUniforms(spec, maps) {
  const c = spec.clouds || {};
  const W = maps.clouds?.image?.width || 2048;
  const deck = c.style === 1;
  const dust = c.style === 2;
  const tint = c.tint || [1, 1, 1];
  return {
    ...shellUniforms(),
    cloudTexture: { value: maps.clouds || null },
    // ekstynkcja: cała powłoka przy gęstości 1 ma grubość optyczną ~10 (brzegi kłębów półprzezroczyste, wnętrze lite)
    uCvShape: { value: new THREE.Vector4(1.003, deck ? 1.012 : 1.017, dust ? 320 : 720, deck ? 1.0 : (dust ? 0.9 : 1.45)) },
    uCvNoise: { value: new THREE.Vector4(23.0, 83.0, dust ? 0.2 : 0.55, 0) },
    uCvTint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]).multiplyScalar(dust ? 0.7 : 0.94) },
    uCvSky: { value: new THREE.Vector4(0.15, 0.2, 0.29, 2 * Math.PI / W) },
    // jasność słońca 0,74: oświetlony wierzchołek ~0,9 (pod progiem bloomu gry), srebrny brzeg pod słońce ponad nim
    uCvMisc: { value: new THREE.Vector4(0.2, 0.65, 0.07, 0.74) }
  };
}
