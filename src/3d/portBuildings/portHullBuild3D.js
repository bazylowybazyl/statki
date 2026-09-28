// Kadłub w budowie na pochylni (Z7): sprite okrętu (ten sam obrazek, co proxy
// ruchu i pełny NPC — TRAFFIC_HULLS) z maską etapów budowy (HULL_BUILD_STAGES):
//   stępka   — belka w osi rośnie od rufy do dziobu,
//   wręgi    — żebra co 24 j. i wzdłużniki co 30 j. w obrysie z alfy sprite'a,
//   poszycie — płyty 28 × 20 j. od rufy z postrzępionym czołem, w podkładzie,
//   malowanie — podkład przechodzi w barwy sprite'a od rufy.
// Przy czole budowy iskry spawania (drobne punkty HDR). Gotowy kadłub (postęp 1)
// wygląda jak statek-proxy: poduszkowa normalna, otoczenie 0,24, rozproszone 1,18,
// połysk 0,30 (lustro rdzenia HEX_FRAGMENT_SHADER), słońce poziomo z azymutu.
//
// Czworokąt leży w układzie budowli (x w poprzek, z wzdłuż, dziób +z) na
// wysokości y = 110 (z świata −6: tuż pod płaszczyzną gry — statki ortho nad nim,
// suwnice FG nad wszystkim). Wierzchołki przeliczane przy zmianie kadłuba (bez
// skali w macierzy — normalne w świetle zostają poprawne).
import * as THREE from 'three';
import { HALO_GLSL_COMMON, HALO_GLSL_LIGHT, HALO_GLSL_NOISE } from '../haloRing/haloRingGLSL.js';
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { SUN_SHADOW_GLSL } from '../sunShadowMask.js';
import { TRAFFIC_HULLS, trafficHullRenderSize } from '../../data/trafficHulls.js';
import { HULL_BUILD_STAGES, SHIPYARD_HULL_Y } from './portShipyardLayout.js';

export const HULL_BUILD_Y = SHIPYARD_HULL_Y;

// Tekstury: host (gra) podaje dostawcę — (hullId) → { texture, flipY } z tego
// samego obrazka co NPC (acquireHullVisualTexture); bez niego moduł ładuje sam.
let textureProvider = null;
const ownTextures = new Map();
export function setPortHullTextureProvider(fn) {
  textureProvider = typeof fn === 'function' ? fn : null;
}
function hullTexture(hullId) {
  if (textureProvider) {
    const r = textureProvider(hullId);
    if (r?.texture) return r;
  }
  let t = ownTextures.get(hullId);
  if (!t) {
    const def = TRAFFIC_HULLS[hullId];
    if (!def || typeof Image === 'undefined') return null;
    const img = new Image();
    img.decoding = 'async';
    t = new THREE.Texture(img);
    // jak createManagedTexture w hexShips3D: flipY = false, sRGB, mipmapy
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    img.onload = () => { t.needsUpdate = true; t.userData.ready = true; };
    img.src = def.sprite;
    ownTextures.set(hullId, t);
  }
  return { texture: t, flipY: false, ready: !!t.userData.ready };
}

const S = HULL_BUILD_STAGES;
const num = (v) => {
  const s = Number(v).toFixed(4);
  return s;
};

const HULL_VERTEX = /* glsl */`
#ifdef PB_LIGHT_HALO
${HALO_GLSL_COMMON}
uniform mat4 uHub;
#else
uniform vec3 uSunDirW;
#endif
varying vec2 vUv;
varying vec3 vLit;
varying vec3 vSunH;
varying vec3 vUpL;
varying vec3 vAlongL;
varying vec3 vAcrossL;
void main() {
  vUv = uv;
#ifdef PB_LIGHT_HALO
  vLit = (uHub * vec4(position, 1.0)).xyz;
  mat3 R = mat3(uHub);
  vSunH = normalize(vec3(uSunDir.xy, 0.0006));
#else
  vLit = (modelViewMatrix * vec4(position, 1.0)).xyz;
  mat3 R = mat3(modelViewMatrix);
  vSunH = normalize(mat3(viewMatrix) * vec3(uSunDirW.xy, 0.0006));
#endif
  // osie ukladu budowli w ramie swiatla: gora (y), wzdluz (z = dziob), w poprzek (x = lewa burta)
  vUpL = normalize(R * vec3(0.0, 1.0, 0.0));
  vAlongL = normalize(R * vec3(0.0, 0.0, 1.0));
  vAcrossL = normalize(R * vec3(1.0, 0.0, 0.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HULL_FRAGMENT = /* glsl */`
#ifdef PB_LIGHT_HALO
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
#else
${SUN_SHADOW_GLSL}
uniform float uSunVisS;
#endif
uniform sampler2D uMap;
uniform float uFlipV;
uniform vec4 uBuild;       // x postep 0..1, y czas, z ziarno, w tekstura gotowa
uniform vec2 uHullSize;    // dlugosc, szerokosc [j.]
uniform vec3 uHullLight;   // otoczenie, rozproszone, polysk (strojenie kadlubow)
uniform vec3 uPbWeld;
varying vec2 vUv;
varying vec3 vLit;
varying vec3 vSunH;
varying vec3 vUpL;
varying vec3 vAlongL;
varying vec3 vAcrossL;
float hbHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  if (uBuild.w < 0.5) discard;
  vec2 uv = vec2(vUv.x, uFlipV > 0.5 ? 1.0 - vUv.y : vUv.y);
  vec4 tex = texture2D(uMap, uv);
  float inside = smoothstep(0.3, 0.6, tex.a);
  if (inside < 0.02) discard;
  float p = uBuild.x;
  float t = uBuild.y;
  // wspolrzedne w jednostkach: wzdluz od rufy, w poprzek od osi
  vec2 hu = vec2(vUv.x * uHullSize.x, (vUv.y - 0.5) * uHullSize.y);
  float keelLen = clamp(p / ${num(S.keel[1])}, 0.0, 1.0);
  float frameFront = clamp((p - ${num(S.frames[0])}) / ${num(S.frames[1] - S.frames[0])}, 0.0, 1.0);
  float plateFront = clamp((p - ${num(S.plating[0])}) / ${num(S.plating[1] - S.plating[0])}, 0.0, 1.0);
  float paintFront = clamp((p - ${num(S.outfit[0])}) / ${num(S.outfit[1] - S.outfit[0])}, 0.0, 1.0);
  // plyty poszycia 28 x 20 j.: od rufy, czolo postrzepione
  vec2 cellSize = vec2(28.0, 20.0);
  vec2 cell = floor(hu / cellSize);
  float key = (cell.x + 0.5) * cellSize.x / uHullSize.x + (hbHash(cell + uBuild.z) - 0.5) * 0.16;
  float plateEdge = mix(-0.14, 1.1, plateFront);
  float plated = step(key, plateEdge);
  float painted = step(vUv.x + (hbHash(cell * 1.7 + 3.0 + uBuild.z) - 0.5) * 0.08, mix(-0.1, 1.1, paintFront));
  // szkielet: stepka, wregi (co 24 j.), wzdluzniki (co 30 j.)
  float fw = fwidth(hu.x) + fwidth(hu.y);
  // szerokosci linii nie mniej niz ~pol piksela (z daleka szkielet nie znika)
  float keelW = max(5.0, fw * 0.9);
  float ribW = min(max(2.2, fw * 0.45), 6.0);
  float strW = min(max(1.4, fw * 0.35), 5.0);
  float keel = step(vUv.x, keelLen) * (1.0 - smoothstep(keelW, keelW + fw, abs(hu.y)));
  float ribD = abs(fract(hu.x / 24.0 + 0.5) - 0.5) * 24.0;
  float grown = step(0.0005, frameFront) * step(vUv.x, frameFront);
  float rib = (1.0 - smoothstep(ribW, ribW + fw, ribD)) * grown;
  float strD = abs(fract(hu.y / 30.0 + 0.5) - 0.5) * 30.0;
  float stringer = (1.0 - smoothstep(strW, strW + fw, strD)) * grown;
  float frame = max(keel, max(rib, stringer)) * inside;
  if (plated < 0.5 && frame < 0.5) discard;
  vec3 base;
  if (plated > 0.5) {
    vec3 real = tex.rgb;
    float lum = dot(real, vec3(0.2126, 0.7152, 0.0722));
    vec3 primer = vec3(0.26, 0.29, 0.28) * (0.5 + 0.9 * lum);
    vec2 cf = fract(hu / cellSize);
    float seam = 1.0 - smoothstep(0.0, 0.07, min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y)));
    base = mix(primer * (1.0 - 0.4 * seam), real, painted);
  } else {
    base = vec3(0.075, 0.08, 0.085);
  }
  // poduszkowa normalna (jak kadluby gry) w ramie swiatla
  vec2 pp = clamp(vUv, 0.0, 1.0) * 2.0 - 1.0;
  vec3 N = normalize(vUpL + vAlongL * (pp.x * 0.45) + vAcrossL * (pp.y * 0.45));
  vec3 L = normalize(vSunH);
#ifdef PB_LIGHT_HALO
  float sv = dot(haloSunVisibility(vLit + vUpL * 2.0, uSunDir), vec3(0.2126, 0.7152, 0.0722));
  float fill = 0.4 + 0.6 * sv;
  vec3 V = normalize(uCamLocal - vLit);
#else
  float sv = uSunVisS * sunVisibility();
  float fill = sunFill(sv);
  vec3 V = normalize(-vLit);
#endif
  float NdL = dot(N, L);
  float dif = max(0.0, NdL);
  vec3 col = base * (uHullLight.x * fill + dif * uHullLight.y * sv);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 32.0);
  col += vec3(spec * uHullLight.z * smoothstep(-0.02, 0.08, NdL) * sv) * plated;
  // iskry spawania przy czole budowy (punkty ~2 j., migaja)
  float frontU = p < ${num(S.keel[1])} ? keelLen : (p < ${num(S.frames[1])} ? frameFront : (p < ${num(S.plating[1])} ? plateEdge : -2.0));
  float nearFront = 1.0 - smoothstep(0.0, 22.0 / uHullSize.x, abs(vUv.x - frontU));
  vec2 sc = floor(hu / 6.0);
  float n = floor(t * 18.0);
  float h = hbHash(sc + n * 13.1 + uBuild.z * 7.0);
  vec2 sf = fract(hu / 6.0) - 0.5;
  float spark = step(0.955, h) * nearFront * (1.0 - smoothstep(0.1, 0.32, length(sf))) * step(p, 0.999);
  col += uPbWeld * spark * (0.8 + 0.8 * hbHash(sc + n));
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export const PORT_HULL_SHADERS = Object.freeze({ HULL_VERTEX, HULL_FRAGMENT });

/**
 * Kadłub w budowie na jednej pochylni. `building` — PortShipyard3D (uniformy
 * światła, tryb, łuk spawalniczy). setState({ hullId, progress } | null, czas).
 */
export class PortHullBuild3D {
  constructor({ slip, building }) {
    this.slip = slip;
    this.state = null;
    this.hullId = null;
    this.hullLength = 0;
    this.hullBeam = 0;
    this.seed = 11.3 * (slip.index + 1);
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(12);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    // u wzdłuż (0 rufa → 1 dziób), v w poprzek (1 = lewa burta = góra PNG)
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    const u = building.uniforms;
    this.uniforms = {
      uMap: { value: null },
      uFlipV: { value: 1 },
      uBuild: { value: new THREE.Vector4(0, 0, this.seed, 0) },
      uHullSize: { value: new THREE.Vector2(1, 1) },
      uHullLight: { value: new THREE.Vector3(0.24, 1.18, 0.30) },
      uPbWeld: u.uPbWeld,
      uHub: u.uHub,
      uSunDirW: u.uSunDirW,
      uSunVisS: u.uSunVisS
    };
    const host = building._common;
    const material = new THREE.ShaderMaterial({
      name: 'PortHullBuild',
      uniforms: { ...host, ...this.uniforms },
      vertexShader: HULL_VERTEX,
      fragmentShader: HULL_FRAGMENT,
      defines: { ...building.defines },
      side: THREE.DoubleSide
    });
    this.material = material;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = `PortHullBuild ${slip.id}`;
    this.mesh.frustumCulled = true;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    this._placeQuad(slip.padLength * 0.6, slip.padBeam * 0.4);
  }

  _placeQuad(len, beam) {
    const s = this.slip;
    const y = k7HeightToZ(HULL_BUILD_Y);
    const x0 = s.x - beam / 2;
    const x1 = s.x + beam / 2;
    const z0 = s.z - len / 2;
    const z1 = s.z + len / 2;
    // (u, v): (0,0) rufa-prawa burta, (1,0) dziób-prawa, (1,1) dziób-lewa, (0,1) rufa-lewa
    const p = this.pos;
    p.set([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0]);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(s.x, y, s.z), Math.hypot(len, beam) / 2 + 10);
    this.hullLength = len;
    this.hullBeam = beam;
  }

  /** Stan pochylni: { hullId, progress } albo null (pusta). */
  setState(state, time = 0) {
    this.state = state || null;
    const u = this.uniforms;
    if (!state || !TRAFFIC_HULLS[state.hullId]) {
      this.mesh.visible = false;
      return;
    }
    if (state.hullId !== this.hullId) {
      this.hullId = state.hullId;
      const size = trafficHullRenderSize(state.hullId);
      // sprite: szerokość = długość kadłuba (dziób +x obrazka), wysokość = szerokość
      this._placeQuad(size.w, size.h);
      u.uHullSize.value.set(size.w, size.h);
      this.seed = 11.3 * (this.slip.index + 1) + (state.seed || 0);
      u.uBuild.value.z = this.seed;
    }
    const tex = hullTexture(state.hullId);
    if (tex) {
      u.uMap.value = tex.texture;
      u.uFlipV.value = tex.flipY ? 0 : 1;
      const img = tex.texture.image;
      const ready = tex.ready ?? !!(img && (img.width || img.naturalWidth) && (img.complete !== false));
      u.uBuild.value.w = ready ? 1 : 0;
    } else {
      u.uBuild.value.w = 0;
    }
    u.uBuild.value.x = Math.max(0, Math.min(1, Number(state.progress) || 0));
    u.uBuild.value.y = time;
    this.mesh.visible = u.uBuild.value.w > 0.5;
  }

  /** Strojenie światła kadłubów gry (getHullLightTuning: dayAmbient, dayDiffuseMul, specularMul). */
  setLightTuning(t) {
    if (!t) return;
    const v = this.uniforms.uHullLight.value;
    if (Number.isFinite(t.dayAmbient)) v.x = t.dayAmbient;
    if (Number.isFinite(t.dayDiffuseMul)) v.y = t.dayDiffuseMul;
    if (Number.isFinite(t.specularMul)) v.z = t.specularMul;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
