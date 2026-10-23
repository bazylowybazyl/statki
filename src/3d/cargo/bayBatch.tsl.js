// src/3d/cargo/bayBatch.tsl.js
//
// PARTIA ŁADOWNI FLOTY (E12 — przeładunek w bańce ruchu): wnętrza i skrzydła wrót WSZYSTKICH statków jednego
// kadłuba w dwóch rysunkach (wnętrze, skrzydła) zamiast rigu na statek (CargoBayRig: 1 + 2…6 rysunków na statek).
// Fragmenty te same co rig (bayInteriorFragment / bayLeafFragment z bay.tsl.js — jeden wygląd), wierzchołek
// z instancji: środek ładowni względem początku przy kamerze (mesh.position = początek, float32 bez drżenia przy
// 5–10 mln j.), kurs ładowni w scenie, indeks rekordu w tablicy ładowni (CargoBayTable — światło, lampy, cień
// krawędzi otworu). Rodzaj = kadłub z ładownią (geometria wnętrza i wycinki sprite'a skrzydeł), materiały to klony
// jednego grafu z wartościami rodzaju w `material.uniforms` (siatka slotów, tekstura sprite'a) — jeden program
// na wszystkie rodzaje. Mesh + InstancedBufferGeometry (nie InstancedMesh — uuid w kluczu programu), jeden
// przepleciony bufor instancji (limit 8 buforów wierzchołków).
import * as THREE from 'three/webgpu';
import { Discard, Fn, If, attribute, dot, float, fract, int, positionGeometry, screenCoordinate, uniform, varyingProperty, vec2, vec3 } from 'three/tsl';
import { loadImageBitmap } from '../canvas2d.js';
import { RenderWorld } from '../../render/renderWorld.js';
import { LEAF_RENDER_ORDER, bayInteriorFragment, bayLeafFragment, buildBayInteriorGeometry, buildLeafGeometry } from './bay.tsl.js';
import { CargoBayTable } from './cargoLight.tsl.js';
import { cargoBayDoorPose, cargoBayHull, cargoBayScale, cargoHullBays } from '../../data/cargoBays.js';

const perObject = (key, type, init) =>
  uniform(init, type).onObjectUpdate(({ material }) => material.uniforms?.[key]?.value ?? init);

export const BAY_INTERIOR_STRIDE = 8;
export const BAY_LEAF_STRIDE = 20;

let _interior = null;
let _leaf = null;

/** Wnętrze z instancji: iBayPose (środek x, y względem początku, cos, sin kursu), iBayInfo.x — rekord tablicy. */
function interiorTemplate() {
  if (_interior) return _interior;
  const m = new THREE.NodeMaterial();
  m.name = 'Cargo:wnetrze-partia';
  m.lights = false;
  m.fog = false;
  m.side = THREE.DoubleSide;
  const uGridA = perObject('uGridA', 'vec4', new THREE.Vector4(0, 0, 17, 9));
  const uGridB = perObject('uGridB', 'vec4', new THREE.Vector4(1, 1, 16, 8));
  const vN = varyingProperty('vec3', 'vBbN');
  const vP = varyingProperty('vec3', 'vBbP');
  const vBay = varyingProperty('float', 'vBbBay');
  m.positionNode = Fn(() => {
    const pose = attribute('iBayPose', 'vec4');
    const info = attribute('iBayInfo', 'vec4');
    const p = positionGeometry;
    vN.assign(attribute('normal', 'vec3'));
    vP.assign(p);
    vBay.assign(info.x);
    return vec3(pose.x.add(p.x.mul(pose.z)).sub(p.y.mul(pose.w)), pose.y.add(p.x.mul(pose.w)).add(p.y.mul(pose.z)), p.z);
  })();
  m.fragmentNode = bayInteriorFragment(int(vBay.add(0.5)), uGridA, uGridB, vP, vN);
  _interior = m;
  return m;
}

/**
 * Skrzydła z instancji: iBayPose; iLeafP (położenie pudła w układzie ładowni x, y, z0, rekord), iLeafDims (L, W,
 * grubość, skóra proxy w otworze 0…1), iLeafUV (wycinek sprite'a), iLeafInfo (strona, przy osi, kieszeń, środek w b) —
 * jak uniformy rigu. Skóra: domknięte skrzydło odpada w pikselach, w których proxy pokazuje już skórę (ten sam szum
 * IGN ekranu co shipProxyBatch3D.tsl.js) — przenikanie zamiast zamiany w jednej klatce.
 */
function leafTemplate() {
  if (_leaf) return _leaf;
  const m = new THREE.NodeMaterial();
  m.name = 'Cargo:wrota-partia';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.blending = THREE.NoBlending;
  m.depthWrite = true;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  const vN = varyingProperty('vec3', 'vBlN');
  const vU = varyingProperty('vec3', 'vBlU');
  const vFace = varyingProperty('float', 'vBlFace');
  const vBay = varyingProperty('float', 'vBlBay');
  const vUV = varyingProperty('vec4', 'vBlUV');
  const vDims = varyingProperty('vec4', 'vBlDims');
  const vInfo = varyingProperty('vec4', 'vBlInfo');
  const vSkin = varyingProperty('float', 'vBlSkin');
  m.positionNode = Fn(() => {
    const pose = attribute('iBayPose', 'vec4');
    const lp = attribute('iLeafP', 'vec4');
    const dims = attribute('iLeafDims', 'vec4');
    const g = positionGeometry;
    const p = vec3(g.x.mul(dims.x).add(lp.x), g.y.mul(dims.y).add(lp.y), g.z.mul(dims.z).add(lp.z));
    vN.assign(attribute('normal', 'vec3'));
    vU.assign(g);
    vFace.assign(attribute('aFace', 'float'));
    vBay.assign(lp.w);
    vUV.assign(attribute('iLeafUV', 'vec4'));
    vDims.assign(dims);
    vSkin.assign(dims.w);
    vInfo.assign(attribute('iLeafInfo', 'vec4'));
    return vec3(pose.x.add(p.x.mul(pose.z)).sub(p.y.mul(pose.w)), pose.y.add(p.x.mul(pose.w)).add(p.y.mul(pose.z)), p.z);
  })();
  const leaf = bayLeafFragment(int(vBay.add(0.5)), vUV, vDims, vInfo, vU, vN, vFace);
  m.fragmentNode = Fn(() => {
    const ign = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
    If(ign.lessThan(vSkin), () => { Discard(); });
    return leaf;
  })();
  _leaf = m;
  return m;
}

function placeholderTexture() {
  const t = new THREE.DataTexture(new Uint8Array([60, 64, 70, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function instGeometry(base, stride, capacity, attrs) {
  const geo = new THREE.InstancedBufferGeometry();
  for (const name of ['position', 'normal', 'aFace']) if (base.getAttribute(name)) geo.setAttribute(name, base.getAttribute(name));
  geo.setIndex(base.getIndex());
  const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * stride), stride, 1);
  let off = 0;
  for (const name of attrs) { geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, off)); off += 4; }
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return { geo, buffer };
}

/**
 * Partia ładowni: rodzaj na kadłub z ładownią (pierwsza ładownia kadłuba). begin() → push…() → end(); pozycje
 * względem początku (origin — początek przy kamerze, ten sam co kontenerów i dronów).
 */
export class CargoBayBatch {
  constructor(scene, capacity = 40) {
    this.scene = scene;
    this.capacity = capacity;
    this.kinds = new Map();
    this.kindList = [];
    this.origin = { x: 0, y: 0 };
  }

  kind(hullKey) {
    let k = this.kinds.get(hullKey);
    if (k !== undefined) return k;
    const H = cargoBayHull(hullKey);
    const geo = H ? cargoHullBays(H)[0] : null;
    if (!geo) { this.kinds.set(hullKey, null); return null; }
    const s = cargoBayScale(H);
    const sw = H.png.w * s;
    const sh = H.png.h * s;
    const interior = instGeometry(buildBayInteriorGeometry(geo), BAY_INTERIOR_STRIDE, this.capacity, ['iBayPose', 'iBayInfo']);
    const im = interiorTemplate().clone();
    im.uniforms = {
      uGridA: { value: new THREE.Vector4(geo.a0, geo.b0, geo.pitchA, geo.pitchB) },
      uGridB: { value: new THREE.Vector4(geo.cols, geo.rows, geo.module.L, geo.module.W) }
    };
    const imesh = new THREE.Mesh(interior.geo, im);
    imesh.name = `Cargo:wnetrze-partia:${hullKey}`;
    imesh.frustumCulled = false;
    imesh.visible = false;
    const leafCap = this.capacity * geo.leaves.length;
    const leaves = instGeometry(buildLeafGeometry(), BAY_LEAF_STRIDE, leafCap, ['iBayPose', 'iLeafP', 'iLeafDims', 'iLeafUV', 'iLeafInfo']);
    const lm = leafTemplate().clone();
    const ph = placeholderTexture();
    lm.uniforms = { uSprite: { value: ph } };
    const lmesh = new THREE.Mesh(leaves.geo, lm);
    lmesh.name = `Cargo:wrota-partia:${hullKey}`;
    lmesh.frustumCulled = false;
    lmesh.renderOrder = LEAF_RENDER_ORDER;
    lmesh.visible = false;
    this.scene.add(imesh);
    this.scene.add(lmesh);
    // Wycinki sprite'a skrzydeł (stałe na rodzaj): uv zamkniętego skrzydła jak CargoBayRig.
    const leafUV = geo.leaves.map((L) => {
      const x0 = geo.cx + L.a0;
      const x1 = geo.cx + L.a1;
      const y0 = geo.cy + Math.min(L.b0, L.b1);
      const y1 = geo.cy + Math.max(L.b0, L.b1);
      return [x0 / sw + 0.5, y0 / sh + 0.5, x1 / sw + 0.5, y1 / sh + 0.5];
    });
    k = {
      hullKey, H, geo, imesh, lmesh, ibuf: interior.buffer, lbuf: leaves.buffer, count: 0, leafCount: 0,
      leafUV, pose: cargoBayDoorPose(geo, 0), sprite: null, loading: false
    };
    if (RenderWorld.isBrowser) {
      k.loading = true;
      loadImageBitmap(H.sprite).then((img) => {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        k.sprite = tex;
        lm.uniforms.uSprite.value = tex;
      }, (err) => { console.warn('[bayBatch] sprite ładowni:', hullKey, err); });
    }
    this.kinds.set(hullKey, k);
    this.kindList.push(k);
    return k;
  }

  begin(origin) {
    this.origin.x = origin.x;
    this.origin.y = origin.y;
    for (const k of this.kindList) { k.count = 0; k.leafCount = 0; }
  }

  /**
   * Ładownia statku: hullKey, (x, y) — środek ładowni w scenie WZGLĘDEM początku, yaw — kurs osi a w scenie,
   * door — postęp wrót [s osi przebiegu], table — rekord w CargoBayTable (światło), seed — ziarno lamp.
   * Rekord tablicy dostaje te same współrzędne (kontenery i drony liczą światło względem tego samego początku).
   */
  push(hullKey, x, y, yaw, door, table, seed = 0, skin = 0) {
    const k = this.kind(hullKey);
    if (!k || k.count >= this.capacity) return null;
    const geo = k.geo;
    const pose = cargoBayDoorPose(geo, door, k.pose);
    CargoBayTable.set(table, geo, x, y, yaw, pose, seed);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const n = k.count++;
    const I = k.ibuf.array;
    const o = n * BAY_INTERIOR_STRIDE;
    I[o] = x; I[o + 1] = y; I[o + 2] = c; I[o + 3] = s;
    I[o + 4] = table; I[o + 5] = 0; I[o + 6] = 0; I[o + 7] = 0;
    const Lb = k.lbuf.array;
    for (let i = 0; i < geo.leaves.length; i++) {
      const L = geo.leaves[i];
      const q = pose.leaves[i];
      const wB = Math.abs(L.b1 - L.b0);
      const bc = (L.b0 + L.b1) / 2;
      // Skrzydło kieszeni schowane całe pod poszyciem — bez rysunku (jak CargoBayRig.update).
      if (geo.door === 'pocket' && Math.abs(q.db) >= wB && pose.open >= 0.999) continue;
      const m = k.leafCount++;
      const p = m * BAY_LEAF_STRIDE;
      Lb[p] = x; Lb[p + 1] = y; Lb[p + 2] = c; Lb[p + 3] = s;
      Lb[p + 4] = q.da; Lb[p + 5] = bc + q.db; Lb[p + 6] = q.z0; Lb[p + 7] = table;
      Lb[p + 8] = L.a1 - L.a0; Lb[p + 9] = wB; Lb[p + 10] = geo.leafT; Lb[p + 11] = skin;
      const uv = k.leafUV[i];
      Lb[p + 12] = uv[0]; Lb[p + 13] = uv[1]; Lb[p + 14] = uv[2]; Lb[p + 15] = uv[3];
      Lb[p + 16] = L.side; Lb[p + 17] = L.index === 0 ? 1 : 0; Lb[p + 18] = geo.door === 'pocket' ? 1 : 0; Lb[p + 19] = bc + q.db;
    }
    return pose;
  }

  end() {
    let draws = 0;
    for (const k of this.kindList) {
      draws += this._commit(k.imesh, k.ibuf, k.count, BAY_INTERIOR_STRIDE);
      draws += this._commit(k.lmesh, k.lbuf, k.leafCount, BAY_LEAF_STRIDE);
    }
    return draws;
  }

  // Partia rodzaju: pozycja względem początku, liczba instancji, wysyłka zakresu (bez tablic w klatce).
  _commit(mesh, buf, n, stride) {
    mesh.position.set(this.origin.x, this.origin.y, 0);
    mesh.geometry.instanceCount = n;
    mesh.visible = n > 0;
    if (!(n > 0)) return 0;
    buf.updateRanges.length = 0;
    buf.addUpdateRange(0, n * stride);
    buf.needsUpdate = true;
    return 1;
  }

  /** Rozgrzewka: obie siatki rodzajów (tworzy rodzaje z listy kadłubów). */
  warmupMeshes(hullKeys) {
    const out = [];
    for (const key of hullKeys) {
      const k = this.kind(key);
      if (k) out.push(k.imesh, k.lmesh);
    }
    return out;
  }
}
