// Elektrownia „KOREK” — materiał PROMIENIA energii (główny: wylot korka → odbiornik, przekaźnikowy: odbiornik → ring).
// Walec z uv.y wzdłuż (0 — źródło, 1 — cel); długość w `uPlantBeamLen` (impulsy co ~0,024 R jadą od źródła do celu).
// Mieszanie ONE/ONE (blendAddytywnePremul), bez zapisu głębi, warstwa w `uPlantLayer` (0 — rdzeń, 1 — poświata).
import * as THREE from 'three/webgpu';
import { Fn, float, vec3, vec4, varying, normalLocal, uv, transformNormalToView, abs, dot, max, mix, normalize, select, sin, smoothstep } from 'three/tsl';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import { PLANT_COLORS, perObjectUniforms, sdown, viewDirView } from './earthBitePlantCommon.tsl.js';

function buildBeamGraph() {
  const U = perObjectUniforms();
  const T = PLANT_COLORS;
  // normalna i kierunek do widza w przestrzeni widoku (promień przekaźnikowy ma skalę tylko wzdłuż osi walca)
  const vNormalV = varying(transformNormalToView(normalLocal), 'vBeamNormalView');
  const vUv = uv();
  const fragmentNode = Fn(() => {
    const V = viewDirView();
    const n = normalize(vNormalV);
    // jasność wg kąta do osi widzenia (środek walca najjaśniejszy) — warstwa 0: rdzeń, 1: poświata
    const c = abs(dot(n, V));
    const core = U.uPlantLayer.lessThan(0.5);
    const prof = select(core, c.mul(c).mul(c), c.mul(c).mul(0.12));
    const s = vUv.y.mul(U.uPlantBeamLen);
    const pulse = float(0.82).add(sin(s.mul(260.0).sub(U.uPlantTime.mul(14.0))).mul(0.18));
    const ends = smoothstep(0.0, 0.02, vUv.y).mul(sdown(0.985, 1.0, vUv.y));
    const col = mix(vec3(...T.beam), vec3(...T.beamCore), select(core, c.mul(c), float(0.0)))
      .mul(prof.mul(pulse).mul(ends).mul(U.uPlantBeam.x).mul(select(core, 6.0, 2.5)));
    return vec4(col, max(col.r, max(col.g, col.b)));
  })();
  return { fragmentNode };
}

let GRAPH = null;

/** Promień (warstwa w `uniforms.uPlantLayer`): addytywnie, bez zapisu głębi. */
export function createPlantBeamMaterial(uniforms) {
  GRAPH ??= buildBeamGraph();
  const m = new THREE.NodeMaterial();
  m.name = 'EarthBitePlantBeam';
  m.uniforms = uniforms;
  m.fragmentNode = GRAPH.fragmentNode;
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  m.forceSinglePass = true;
  blendAddytywnePremul(m);
  return m;
}
