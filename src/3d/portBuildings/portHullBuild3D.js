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
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { TRAFFIC_HULLS, trafficHullRenderSize } from '../../data/trafficHulls.js';
import { SHIPYARD_HULL_Y } from './portShipyardLayout.js';
import { pbNodeMaterial } from './portBuildings3D.tsl.js';
import { portHullBuildGraph } from './portHullBuild3D.tsl.js';

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

// Shader: graf TSL w portHullBuild3D.tsl.js (graf raz na tryb światła, wartości kadłuba
// i budowli w material.uniforms — port WebGPU, dawne HULL_VERTEX / HULL_FRAGMENT).

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
    const material = pbNodeMaterial('PortHullBuild', portHullBuildGraph(building.haloUniforms || null), { ...host, ...this.uniforms }, {
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
