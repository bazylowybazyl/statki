// src/3d/planetGen/planetGenClouds.tsl.js
//
// CHMURY planet generatora: graf 'genClouds' = graf chmur GRY (planet3d.assets.tsl.js — to samo światło, pas zachodu,
// mgiełka, cień ringu) z hakiem `cloud`, który dokłada detal ponad rozdzielczość mapy chmur: przy zbliżeniu maska
// chmur z tekstury (rozmyta przy powiększeniu) rozpada się na brzegach na strzępy i kłęby (oktawy szumu z pochodnymi,
// każda gaśnie, gdy jej fala spada poniżej ~2–3 px — z daleka obraz jak z samej mapy), a kłęby mają jaśniejszą stronę
// od słońca. Graf RAZ dla wszystkich planet generatora; wartości planety w `material.uniforms` (GEN_CLOUD_UNIFORM_KEYS).
import { If, float, vec3, vec4, clamp, dot, fwidth, length, max, normalize, smoothstep, modelWorldMatrixInverse } from 'three/tsl';
import { registerPlanetCloudKind, PlanetBodyNodeMaterial } from '../planet3d.assets.tsl.js';
import { pgNoised } from './planetGenNoise.tsl.js';

/** Klucze uniformów per obiekt grafu 'genClouds' (dopisywane do kluczy chmur gry). */
export const GEN_CLOUD_UNIFORM_KEYS = Object.freeze({
  uGcDetail: 'vec4',   // częstość pierwszej oktawy [1/promień] (fala ~3 teksele mapy), erozja brzegów, cieniowanie kłębów, —
  uGcSeed: 'vec4'      // xyz — przesunięcie dziedziny szumu
});
export const GEN_CLOUD_OCTAVES = 3;

function genCloud({ U, local, mask, lightDir }) {
  // pochodne przed gałęziami
  const pixL = float(0.0).toVar();
  pixL.assign(length(fwidth(local)));
  const p = normalize(local).toVar();
  const n = float(0.0).toVar();
  const g = vec3(0.0).toVar();
  for (let k = 0; k < GEN_CLOUD_OCTAVES; k++) {
    const f = U.uGcDetail.x.mul(Math.pow(2, k));
    const w = float(1.0).sub(smoothstep(0.1, 0.33, f.mul(pixL))).toVar();
    If(w.greaterThan(0.002), () => {
      const nd = pgNoised(p.mul(f).add(U.uGcSeed.xyz.add(k * 7.13)));
      const a = w.mul(Math.pow(0.62, k));
      n.addAssign(nd.x.mul(a));
      g.addAssign(nd.yzw.mul(a.mul(f)));
    });
  }
  // erozja tylko tam, gdzie chmura cienka albo na brzegu — wnętrze grubych pól zostaje
  // (izotropowy szum w środku pól rozbijał duże zawirowania mapy na „popcorn” — tylko brzegi, słabo)
  const edge = smoothstep(0.02, 0.3, mask).mul(float(1.0).sub(smoothstep(0.45, 0.85, mask)));
  const m2 = clamp(mask.add(n.mul(U.uGcDetail.y).mul(edge)), 0.0, 1.0);
  // kłęby: strona od słońca jaśniejsza (gradient szumu w płaszczyźnie stycznej · słońce w układzie obiektu)
  const sunObj = normalize(modelWorldMatrixInverse.mul(vec4(lightDir, 0.0)).xyz);
  const gT = g.sub(p.mul(dot(g, p)));
  const lump = clamp(dot(gT, sunObj).div(max(U.uGcDetail.x, 1.0)).mul(U.uGcDetail.z), -0.15, 0.15);
  const shade = float(1.0).add(lump).add(n.mul(0.03));
  return { mask: m2, shade };
}

registerPlanetCloudKind('genClouds', { keys: GEN_CLOUD_UNIFORM_KEYS, cloud: genCloud, name: 'PlanetCloudsGen' });

/** Materiał chmur planety generatora (uniformy jak cloudUniforms DirectPlanet + GEN_CLOUD_UNIFORM_KEYS). */
export const createGenCloudMaterial = (uniforms) => new PlanetBodyNodeMaterial('genClouds', uniforms);
