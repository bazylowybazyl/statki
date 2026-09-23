// Chmury habitatu i powłoka powietrza.
//
// Chmury: warstwa 400–900 j. nad podłogą (pas obrotowy, jak konstrukcja),
// pokrycie z tych samych kafelkowych tekstur co cień chmur na terenie.
// Powłoka: walec r = rim między ścianami, rysowany tylko gdy kamera jest
// w powietrzu habitatu — dokłada rozpraszanie odcinka kamera → wyjście przez
// otwór (niebo habitatu nad wszystkim, co leży dalej: planetą, gwiazdami,
// drugim brzegiem wstęgi). Odcinki kończące się na powierzchni liczy shader
// tej powierzchni, więc nic nie liczy się dwa razy.
import * as THREE from 'three';
import {
  HALO_GLSL_AIR,
  HALO_GLSL_COMMON,
  HALO_GLSL_LIGHT,
  HALO_GLSL_NOISE,
  HALO_GLSL_RTE
} from './haloRingGLSL.js';
import { HALO_HDR } from './haloRingConfig.js';
import { HALO_GLSL_CLOUDCOVER, HALO_GLSL_SURFACE } from './haloRingTerrain.js';
import { HALO_GLSL_STRIP_VERTEX, HaloSegmentSet, buildStripGeometry } from './haloRingStructure.js';

const STRIP_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_RTE}
${HALO_GLSL_SURFACE}
${HALO_GLSL_STRIP_VERTEX}
void main() {
  float cells = iSeg + aAlong * uSegCells;
  float sRel = cells * uGridInfo.x;
  float dTheta = sRel / uFloorDims.z;
  vec3 rel = haloRelFromPolar(dTheta, aProfile.x - uFloorDims.z, aProfile.y);
  float th = uRefBasis.z + dTheta;
  vRel = rel;
  vNormal = vec3(vec2(cos(th), sin(th)) * aEdge.z, aEdge.w);
  vST = vec2(sRel, aEdge.y);
  vKind = aEdge.x;
  vRZ = aProfile;
  gl_Position = haloProjectRel(rel);
}
`;

const CLOUD_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_AIR}
${HALO_GLSL_SURFACE}
${HALO_GLSL_CLOUDCOVER}
varying vec3 vRel;
varying vec3 vNormal;
varying vec2 vST;
varying float vKind;
varying vec2 vRZ;

void main() {
  vec3 rel = vRel;
  float dist = length(rel);
  vec3 V = -rel / max(dist, 1e-3);
  vec3 p = uCamLocal + rel;
  float sRel = vST.x;
  float t = vST.y;
  float sAbs = sRel + uRefBasis.w;
  vec2 uvMap = haloMapUV(sAbs, t);
  vec4 A = texture(uMapA, uvMap);
  float moist = A.b;
  float cov = haloCloudCover(sRel, t, moist, CLOUD_OCTAVES);
  // postrzepione brzegi z drobnego szumu
  vec4 wisp = texture(uDetail1, vec2(sRel / uDetailN.x + uDetailOff.x, t / uDetailN.x));
  cov = clamp(cov + (wisp.r * 0.5) * cov * (1.0 - cov) * 2.2, 0.0, 1.0);
  // zanik przy scianach (powietrze sie tam nie kotluje) i na odleglosc gdy nisko
  float wall = smoothstep(0.0, 260.0, t) * smoothstep(0.0, 260.0, uFloorDims.y - t);
  // Warstwa jest 2D: pod bardzo ostrym katem wyglada jak plaska polka,
  // wiec przy kacie < ~8 stopni od plaszczyzny chmur gasnie (wolumen w Ultra, M5).
  float grazing = smoothstep(0.03, 0.16, abs(dot(V, haloUp(p))));
  float alpha = cov * 0.92 * wall * grazing;
  if (alpha < 0.004) discard;

  vec3 up = haloUp(p);
  vec3 L = uSunDir;
  float cz = dot(L, up);
  // samocien: pokrycie przesuniete ku sloncu w plaszczyznie stycznej
  vec3 Lt = L - up * cz;
  vec3 eTh = vec3(-p.y, p.x, 0.0) / max(length(p.xy), 1.0);
  float off = 260.0 / max(abs(cz), 0.25);
  float cov2 = haloCloudCover(sRel + dot(Lt, eTh) * off, t + Lt.z * off, moist, 2);
  float self = 1.0 - 0.55 * cov2;
  vec3 sunVis = haloSunVisibility(p, L);
  float camAlt = haloAltitude(uCamLocal);
  float below = step(camAlt, uCloudParams.x) * step(uRingZ.z, uCamLocal.z) * step(uCamLocal.z, uRingZ.y);
  // od spodu podstawa ciemniejsza (grube chmury), od gory jasne szczyty
  float thick = mix(1.0, 0.6 + 0.4 * (1.0 - cov), below);
  float mu = dot(-V, L);
  float g = 0.6;
  float hg = 0.25 * (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-3), 1.5);
  float lightAmt = (0.3 + 0.7 * max(cz, 0.0)) * self * thick + hg * 0.35 * (1.0 - cov);
  vec3 amb = haloSkyAmbient(p, up) * mix(0.9, 1.6, below) + haloPlanetshine(p, up) * 0.8 + haloPlanetshine(p, -up) * 0.2 + vec3(uNightAmbient);
  vec3 col = vec3(0.8) * (uSunColor * sunVis * lightAmt + amb);
  col = mix(col, vec3(haloLuma(col)) * vec3(0.96, 0.98, 1.04), 0.35);
  // noca chmury nad miastem podswietla od spodu luna miasta (zamiast czarnych plam)
  float urbanBelow = smoothstep(0.25, 0.6, texture(uMapC, uvMap).g);
  float nightK = 1.0 - smoothstep(0.02, 0.2, haloLuma(sunVis) * max(cz, 0.0) + haloLuma(amb));
  col += vec3(${HALO_HDR.windowSodium.map((x) => (x * 0.035).toFixed(4)).join(', ')}) * urbanBelow * nightK * (0.6 + 0.4 * cov) * uLayers.y * uNightLights;
  col = haloApplyAir(col, rel, haloIGN(gl_FragCoord.xy));
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

const SHELL_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_AIR}
// Czy promien za wyjsciem z powietrza trafia w druga strone wstegi (luk),
// zanim trafi w planete? Wtedy za powloka jest teren, nie niebo - bez wzmocnienia.
float haloHitsFarBand(vec3 p, vec3 d) {
  // habitat na zewnatrz: za wyjsciem z powietrza jest juz tylko kosmos
  if (uHabitat.x > 0.0) return 0.0;
  float b = uRing.w;
  float a = uRing.y - 0.5 * (uRingZ.y + uRingZ.z) * b;
  float rp = a + b * p.z;
  float A = dot(d.xy, d.xy) - b * b * d.z * d.z;
  float B = 2.0 * (dot(p.xy, d.xy) - b * d.z * rp);
  float C = dot(p.xy, p.xy) - rp * rp;
  float disc = B * B - 4.0 * A * C;
  if (disc <= 0.0 || abs(A) < 1e-6) return 0.0;
  float t2 = (-B + sqrt(disc)) / (2.0 * A);
  if (t2 <= 0.0) return 0.0;
  float z = p.z + t2 * d.z;
  float band = step(uRingZ.w, z) * step(z, uRingZ.x);
  vec3 oc = uPlanet.xyz - p;
  float tc = dot(oc, d);
  float d2 = dot(oc, oc) - tc * tc;
  float R2 = uPlanet.w * uPlanet.w;
  if (tc > 0.0 && d2 < R2 && tc - sqrt(R2 - d2) < t2) return 0.0;
  return band;
}
varying vec3 vRel;
varying vec3 vNormal;
varying vec2 vST;
varying float vKind;
varying vec2 vRZ;
void main() {
  float tExit = length(vRel);
  vec3 d = vRel / max(tExit, 1e-3);
  vec3 ins;
  vec3 tr;
  haloAirIntegrate(uCamLocal, d, 0.0, tExit, haloIGN(gl_FragCoord.xy), ins, tr);
  ins *= mix(haloSkyGain(tr), 1.0, haloHitsFarBand(uCamLocal + vRel, d));
  gl_FragColor = vec4(max(ins, vec3(0.0)), clamp(dot(tr, vec3(0.3333)), 0.0, 1.0));
}
`;

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
    this.material = new THREE.ShaderMaterial({
      name: 'HaloClouds',
      uniforms: { ...uniforms, ...surfaceUniforms, uSegCells: { value: domain.segCells } },
      vertexShader: STRIP_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      defines: { AIR_STEPS: Math.max(3, Math.round(quality.airSteps * 0.6)), CLOUD_OCTAVES: Math.min(4, quality.cloudOctaves) },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
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
    this.material = new THREE.ShaderMaterial({
      name: 'HaloAirShell',
      uniforms: { ...uniforms, ...surfaceUniforms, uSegCells: { value: domain.segCells } },
      vertexShader: STRIP_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
      defines: { AIR_STEPS: Math.max(6, quality.airSteps + 4) },
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
