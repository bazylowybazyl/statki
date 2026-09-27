// Chmury habitatu i powłoka powietrza.
//
// Chmury: warstwa 400–900 j. nad podłogą (pas obrotowy, jak konstrukcja),
// pokrycie z tych samych kafelkowych tekstur co cień chmur na terenie.
// Powłoka: walec r = rim między ścianami, rysowany tylko gdy kamera jest
// w powietrzu habitatu — dokłada rozpraszanie odcinka kamera → wyjście przez
// otwór (niebo habitatu nad wszystkim, co leży dalej: planetą, gwiazdami,
// drugim brzegiem wstęgi). Odcinki kończące się na powierzchni liczy shader
// tej powierzchni, więc nic nie liczy się dwa razy.
//
// Port WebGPU (zadanie 08): materiały w TSL (NodeMaterial), 1:1 z dawnym GLSL
// (CLOUD_FRAGMENT, SHELL_FRAGMENT). Wierzchołki z haloStripVertexTSL (jak konstrukcja),
// pokrycie chmur, burze i powietrze z biblioteki ringu (haloRingSurfaceTSL / haloRingTSL).
// Przezroczystość, mieszanie i kolejność rysowania bez zmian; chmury są DoubleSide —
// forceSinglePass jak ShaderMaterial w bazie WebGL (jeden przebieg). Warianty kompilacji:
// kroki powietrza i oktawy chmur z jakości (quality.airSteps, quality.cloudOctaves).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, Discard,
  float, vec2, vec3, vec4, uniform,
  abs, clamp, dot, length, max, mix, pow, smoothstep, sqrt, step
} from 'three/tsl';
import { haloRingSurfaceTSL, haloRingTSL } from './haloRingTSL.js';
import { nodeOf } from './haloUniformsAdapter.js';
import { HaloSegmentSet, buildStripGeometry, haloStripVertexTSL } from './haloRingStructure.js';

// Warianty z jakości (dawne defines AIR_STEPS / CLOUD_OCTAVES).
export const haloCloudAirSteps = (quality) => Math.max(3, Math.round(quality.airSteps * 0.6));
export const haloCloudOctaves = (quality) => Math.min(4, quality.cloudOctaves);
export const haloShellAirSteps = (quality) => Math.max(6, quality.airSteps + 4);

// ---------------------------------------------------------------------------
// Chmury: pokrycie, samocień, światło nieba i planety, łuna miasta nocą, błyski burz,
// perspektywa powietrzna; wyjście premultiplikowane (kolor · alfa, alfa).
export function makeHaloCloudNodes({ u, su, segCells, airSteps = 4, octaves = 3 }) {
  const H = haloRingTSL(u);
  const S = haloRingSurfaceTSL(u, su);
  const U = H.uniforms;
  const { mapA, mapC, detail1 } = S.textures;
  const detailN = nodeOf(su.uDetailN);
  const detailOff = nodeOf(su.uDetailOff);
  const { vertexNode, varyings } = haloStripVertexTSL({ u, su, segCells });
  const vRel = varyings.rel;
  const vST = varyings.st;

  const fragmentNode = Fn(() => {
    const rel = vec3(vRel).toVar();
    const dist = length(rel).toVar();
    const V = rel.negate().div(max(dist, 1e-3)).toVar();
    const p = U.uCamLocal.add(rel).toVar();
    const sRel = vST.x.toVar();
    const t = vST.y.toVar();
    const sAbs = sRel.add(U.uRefBasis.w).toVar();
    const uvMap = H.haloMapUV(sAbs, t).toVar();
    const A = mapA.sample(uvMap).toVar();
    const moist = A.z.toVar();
    const cov = S.haloCloudCover(sRel, t, moist, octaves).toVar();
    // postrzępione brzegi z drobnego szumu
    const wisp = detail1.sample(vec2(sRel.div(detailN.x).add(detailOff.x), t.div(detailN.x))).toVar();
    cov.assign(clamp(cov.add(wisp.x.mul(0.5).mul(cov).mul(float(1.0).sub(cov)).mul(2.2)), 0.0, 1.0));
    // zanik przy ścianach (powietrze się tam nie kotłuje) i na odległość, gdy nisko
    const wall = smoothstep(0.0, 260.0, t).mul(smoothstep(0.0, 260.0, U.uFloorDims.y.sub(t)));
    // Warstwa jest 2D: pod bardzo ostrym kątem wygląda jak płaska półka, więc przy
    // kącie < ~8° od płaszczyzny chmur gaśnie (wolumen w Ultra, M5).
    const grazing = smoothstep(0.03, 0.16, abs(dot(V, H.haloUp(p))));
    const alpha = cov.mul(0.92).mul(wall).mul(grazing).toVar();
    If(alpha.lessThan(0.004), () => { Discard(); });

    const up = H.haloUp(p).toVar();
    const L = U.uSunDir;
    const cz = dot(L, up).toVar();
    // samocień: pokrycie przesunięte ku słońcu w płaszczyźnie stycznej
    const Lt = L.sub(up.mul(cz)).toVar();
    const eTh = vec3(p.y.negate(), p.x, 0.0).div(max(length(p.xy), 1.0)).toVar();
    const off = float(260.0).div(max(abs(cz), 0.25)).toVar();
    const cov2 = S.haloCloudCover(sRel.add(dot(Lt, eTh).mul(off)), t.add(Lt.z.mul(off)), moist, 2);
    const self = float(1.0).sub(float(0.55).mul(cov2)).toVar();
    const sunVis = H.haloSunVisibility(p, L).toVar();
    const camAlt = H.haloAltitude(U.uCamLocal).toVar();
    const below = step(camAlt, U.uCloudParams.x).mul(step(U.uRingZ.z, U.uCamLocal.z)).mul(step(U.uCamLocal.z, U.uRingZ.y)).toVar();
    // od spodu podstawa ciemniejsza (grube chmury), od góry jasne szczyty
    const thick = mix(1.0, float(0.6).add(float(0.4).mul(float(1.0).sub(cov))), below).toVar();
    const mu = dot(V.negate(), L).toVar();
    const g = float(0.6);
    const hg = float(0.25).mul(float(1.0).sub(g.mul(g))).div(pow(max(float(1.0).add(g.mul(g)).sub(float(2.0).mul(g).mul(mu)), 1e-3), 1.5)).toVar();
    const lightAmt = float(0.3).add(float(0.7).mul(max(cz, 0.0))).mul(self).mul(thick).add(hg.mul(0.35).mul(float(1.0).sub(cov))).toVar();
    const amb = H.haloSkyAmbient(p, up).mul(mix(0.9, 1.6, below)).add(H.haloPlanetshine(p, up).mul(0.8))
      .add(H.haloPlanetshine(p, up.negate()).mul(0.2)).add(vec3(U.uNightAmbient)).toVar();
    const col = U.uCloudTint.mul(U.uSunColor.mul(sunVis).mul(lightAmt).add(amb)).toVar();
    col.assign(mix(col, vec3(H.haloLuma(col)).mul(vec3(0.96, 0.98, 1.04)), 0.35));
    // nocą chmury nad miastem podświetla od spodu łuna miasta (zamiast czarnych plam)
    const urbanBelow = smoothstep(0.25, 0.6, mapC.sample(uvMap).y);
    const nightK = float(1.0).sub(smoothstep(0.02, 0.2, H.haloLuma(sunVis).mul(max(cz, 0.0)).add(H.haloLuma(amb))));
    col.addAssign(U.uHdrSodium.mul(0.035).mul(urbanBelow).mul(nightK).mul(float(0.6).add(float(0.4).mul(cov))).mul(U.uLayers.y).mul(U.uNightLights));
    // błyski burz (profil: Jowisz): wnętrze chmury rozświetlone od środka, mocniej
    // w grubych chmurach; HDR > 1 (bloom), barwa chłodna
    If(U.uStorm.x.greaterThan(0.001), () => {
      const flash = H.haloStormFlash(sAbs, t);
      col.addAssign(vec3(0.62, 0.7, 1.0).mul(flash).mul(U.uStorm.w).mul(float(0.25).add(float(0.75).mul(cov))).mul(cov));
    });
    col.assign(H.haloApplyAir(col, rel, H.haloIGN(H.haloFragCoordGL()), airSteps));
    return vec4(col.mul(alpha), alpha);
  })();

  return { vertexNode, fragmentNode };
}

// ---------------------------------------------------------------------------
// Powłoka: rozpraszanie odcinka kamera → wyjście z powietrza przez otwarty brzeg.
// Wyjście: (światło nieba, przepuszczalność) — mieszanie kolor + cel · alfa.
export function makeHaloShellNodes({ u, su, segCells, airSteps = 8 }) {
  const H = haloRingTSL(u);
  const U = H.uniforms;
  const { vertexNode, varyings } = haloStripVertexTSL({ u, su, segCells });
  const vRel = varyings.rel;

  // Czy promień za wyjściem z powietrza trafia w drugą stronę wstęgi (łuk), zanim
  // trafi w planetę? Wtedy za powłoką jest teren, nie niebo — bez wzmocnienia.
  // Habitat na zewnątrz: za wyjściem z powietrza jest już tylko kosmos. Wklejane.
  const hitsFarBand = (p, d) => {
    const res = float(0.0).toVar();
    If(U.uHabitat.x.lessThanEqual(0.0), () => {
      const b = U.uRing.w;
      const a = U.uRing.y.sub(float(0.5).mul(U.uRingZ.y.add(U.uRingZ.z)).mul(b)).toVar();
      const rp = a.add(b.mul(p.z)).toVar();
      const A = dot(d.xy, d.xy).sub(b.mul(b).mul(d.z).mul(d.z)).toVar();
      const B = float(2.0).mul(dot(p.xy, d.xy).sub(b.mul(d.z).mul(rp))).toVar();
      const C = dot(p.xy, p.xy).sub(rp.mul(rp)).toVar();
      const disc = B.mul(B).sub(float(4.0).mul(A).mul(C)).toVar();
      If(disc.greaterThan(0.0).and(abs(A).greaterThanEqual(1e-6)), () => {
        const t2 = B.negate().add(sqrt(disc)).div(float(2.0).mul(A)).toVar();
        If(t2.greaterThan(0.0), () => {
          const z = p.z.add(t2.mul(d.z)).toVar();
          const band = step(U.uRingZ.w, z).mul(step(z, U.uRingZ.x)).toVar();
          const oc = U.uPlanet.xyz.sub(p).toVar();
          const tc = dot(oc, d).toVar();
          const d2 = dot(oc, oc).sub(tc.mul(tc)).toVar();
          const R2 = U.uPlanet.w.mul(U.uPlanet.w).toVar();
          const planetFirst = tc.greaterThan(0.0).and(d2.lessThan(R2)).and(tc.sub(sqrt(R2.sub(d2))).lessThan(t2));
          res.assign(planetFirst.select(0.0, band));
        });
      });
    });
    return res;
  };

  const fragmentNode = Fn(() => {
    const tExit = length(vRel).toVar();
    const d = vRel.div(max(tExit, 1e-3)).toVar();
    const air = H.haloAirIntegrate(U.uCamLocal, d, float(0.0), tExit, H.haloIGN(H.haloFragCoordGL()), airSteps).toVar();
    const ins = air.element(0).toVar();
    const tr = air.element(1).toVar();
    ins.mulAssign(mix(H.haloSkyGain(tr), 1.0, hitsFarBand(U.uCamLocal.add(vRel), d)));
    return vec4(max(ins, vec3(0.0)), clamp(dot(tr, vec3(0.3333)), 0.0, 1.0));
  })();

  return { vertexNode, fragmentNode };
}

// Materiał pasa atmosfery: NodeMaterial z węzłami i stanem renderu jak dawny ShaderMaterial.
function stripMaterial(name, nodes, uniforms, surfaceUniforms, segCells, state) {
  const m = new NodeMaterial();
  m.name = name;
  m.vertexNode = nodes.vertexNode;
  m.fragmentNode = nodes.fragmentNode;
  // jak ShaderMaterial w bazie WebGL: bez mgły sceny i bez tone mappingu materiału
  m.fog = false;
  m.toneMapped = false;
  Object.assign(m, state);
  m.uniforms = { ...uniforms, ...surfaceUniforms, uSegCells: segCells };
  return m;
}

export class HaloClouds {
  constructor({ layout, uniforms, surfaceUniforms, domain, quality }) {
    const f = layout.floor;
    const hc = uniforms.uCloudParams.value.x;
    // punkt podłogi + wysokość chmur promieniowo
    const pts = [];
    const rows = 6;
    for (let j = 0; j <= rows; j++) {
      const t = f.length * j / rows;
      pts.push({ r: layout.floorRadiusAtT(t) + layout.sigma * hc, z: layout.floorZAtT(t), v: t });
    }
    const built = buildStripGeometry([{ kind: 10, normal: f.normal, points: pts }], 24, domain.segCount);
    this.geometry = built.geometry;
    const segCells = uniform(domain.segCells);
    const nodes = makeHaloCloudNodes({
      u: uniforms, su: surfaceUniforms, segCells, airSteps: haloCloudAirSteps(quality), octaves: haloCloudOctaves(quality)
    });
    this.material = stripMaterial('HaloClouds', nodes, uniforms, surfaceUniforms, segCells, {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // WebGPU (jak WebGL dla materiałów innych niż ShaderMaterial) rysowałby przezroczysty
      // DoubleSide dwa razy (tył, potem przód) — baza WebGL miała jeden przebieg
      forceSinglePass: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'HaloClouds';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.segments = new HaloSegmentSet({
      layout, domain, geometry: this.geometry, segData: built.segData, segAttr: built.segAttr,
      rMin: Math.min(layout.radii.floorBottom, layout.radii.floorTop) + layout.sigma * hc - 10,
      rMax: Math.max(layout.radii.floorBottom, layout.radii.floorTop) + layout.sigma * hc + 10,
      zMin: layout.z.botIn, zMax: layout.z.topIn
    });
  }

  update(frustum, refS) {
    if (!this.mesh.visible) { this.geometry.instanceCount = 0; return; }
    this.segments.update(frustum, refS);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class HaloAirShell {
  constructor({ layout, uniforms, surfaceUniforms, domain, quality }) {
    const rim = layout.radii.rim;
    // Przód pasa patrzy w otwartą stronę powietrza (σ·r̂): kolejność punktów
    // decyduje o nawinięciu trójkątów, więc dla habitatu na zewnątrz odwrócona.
    const pts = [
      { r: rim, z: layout.z.botIn, v: 0 },
      { r: rim, z: layout.z.topIn, v: layout.z.topIn - layout.z.botIn }
    ];
    if (layout.sigma > 0) pts.reverse();
    const built = buildStripGeometry([{ kind: 11, normal: { r: layout.sigma, z: 0 }, points: pts }], 24, domain.segCount);
    this.geometry = built.geometry;
    const segCells = uniform(domain.segCells);
    const nodes = makeHaloShellNodes({ u: uniforms, su: surfaceUniforms, segCells, airSteps: haloShellAirSteps(quality) });
    this.material = stripMaterial('HaloAirShell', nodes, uniforms, surfaceUniforms, segCells, {
      transparent: true,
      depthWrite: false,
      // Tylko TYŁ pasa: wyjście z powietrza przez otwarty brzeg. W wariancie
      // Halo przód to ponowne wejście w powietrze po drugiej stronie wstęgi —
      // ten odcinek liczy już shader terenu, więc rysowany dwa razy
      // podwajałby mgłę na łuku.
      side: THREE.BackSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'HaloAirShell';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.segments = new HaloSegmentSet({
      layout, domain, geometry: this.geometry, segData: built.segData, segAttr: built.segAttr,
      rMin: rim - 10, rMax: rim + 10, zMin: layout.z.botIn, zMax: layout.z.topIn
    });
    this.active = false;
  }

  update(frustum, refS, cameraInsideAir) {
    this.active = cameraInsideAir;
    if (!cameraInsideAir || !this.mesh.visible) {
      this.geometry.instanceCount = 0;
      return;
    }
    this.segments.update(frustum, refS);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
