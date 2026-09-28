// src/3d/rockets/missileBodies.js
//
// Kadłubki rakiet (port z dema dema/rakiety-webgpu/missileBodies.js, zadanie 19): jedna
// siatka instancjonowana (korpus, ostrołuk, 4 stateczniki, dysza) wzdłuż +X. Zamiast
// InstancedMesh + MeshStandardNodeMaterial z dema (światła sceny Core3D to słaba fioletowa
// wypełniająca — kadłuby gry liczą słońce same) — własne instancje i własne światło:
//   • słońce gry (kierunek jak dym rakiet: z pozycji SUN, 30° nad płaszczyzną), w masce
//     cienia słońca (sunVisibility — cień planety, kadłubów), Lambert + Blinn–Phong;
//   • wszystkie światła siatki Core3D.fx.grid (dysze sąsiadek, błyski wybuchów, efekty broni) —
//     przelatując przez błysk, rakieta łapie światło;
//   • pas barwy strony na korpusie i żar dyszy w emisji z atrybutu.
// Instancje przepisywane co klatkę względem początku pul Core3D (mesh.position = początek).
// Bufory wierzchołków: pozycja, normalna + 4 atrybuty instancji = 6.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn, float, vec3, vec4, uniform, attribute, varyingProperty, positionGeometry, normalGeometry,
  mix, smoothstep, clamp, max, dot, normalize, pow, cos, sin
} from 'three/tsl';
import { sunVisibility } from '../sunShadowMask.js';

export const BODY_CAP = 2048;

function buildGeometry() {
  // Długość 1 (x od −0,5 do +0,5), średnica ~0,16 — skala z długości rakiety.
  const parts = [];
  const body = new THREE.CylinderGeometry(0.075, 0.08, 0.72, 10, 1, false);
  body.rotateZ(-Math.PI / 2);
  body.translate(-0.08, 0, 0);
  parts.push(body);
  const nose = new THREE.ConeGeometry(0.075, 0.2, 10, 1, false);
  nose.rotateZ(-Math.PI / 2);
  nose.translate(0.38, 0, 0);
  parts.push(nose);
  const nozzle = new THREE.CylinderGeometry(0.05, 0.068, 0.06, 10, 1, true);
  nozzle.rotateZ(-Math.PI / 2);
  nozzle.translate(-0.47, 0, 0);
  parts.push(nozzle);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.BoxGeometry(0.16, 0.012, 0.13);
    fin.translate(-0.36, 0, 0.1);
    fin.rotateX(k * Math.PI / 2 + Math.PI / 4);
    parts.push(fin);
  }
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    return n;
  });
  const merged = mergeGeometries(clean, false);
  merged.computeBoundingSphere();
  return merged;
}

function liveAttr(capacity) {
  const at = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  at.setUsage(THREE.DynamicDrawUsage);
  const range = { start: 0, count: 4 };
  at.updateRanges.length = 0;
  at.updateRanges.push(range);
  at.clearUpdateRanges = () => {};
  at.__range = range;
  return at;
}

export class MissileBodies {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {import('../fx/lightGrid.js').LightGrid} o.grid siatka świateł Core3D
   * @param {{ sunDir: any, sunCol: any }} o.sun wspólne uniformy słońca efektów rakiet
   */
  constructor({ scene, grid, sun, capacity = BODY_CAP, renderOrder = 50 }) {
    this.capacity = capacity;
    this.count = 0;
    // Wpis roboczy dla push(): wołający wypełnia pola i woła push() — w pętlach klatki bez
    // przekazywania liczb zmiennoprzecinkowych przez argumenty (V8 opakowuje je w obiekty
    // przy wywołaniu, którego nie wklei; add(...) zostaje dla wywołań rzadkich).
    this.s = { x: 0, y: 0, z: 0, cos: 1, sin: 0, length: 0, glow: 0, roll: 0 };
    const src = buildGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', src.getAttribute('position'));
    geo.setAttribute('normal', src.getAttribute('normal'));
    this.b0 = liveAttr(capacity); // xyz środek (lokalnie), długość
    this.b1 = liveAttr(capacity); // cos kąta, sin kąta (scena), obrót wokół osi, żar dyszy
    this.b2 = liveAttr(capacity); // barwa kadłubka
    this.b3 = liveAttr(capacity); // barwa pasa
    this._attrs = [this.b0, this.b1, this.b2, this.b3];
    geo.setAttribute('mb0', this.b0);
    geo.setAttribute('mb1', this.b1);
    geo.setAttribute('mb2', this.b2);
    geo.setAttribute('mb3', this.b3);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const vN = varyingProperty('vec3', 'vRkBodyN');
    const vP = varyingProperty('vec3', 'vRkBodyP');
    const vX = varyingProperty('float', 'vRkBodyX');
    const vHull = varyingProperty('vec3', 'vRkBodyHull');
    const vBand = varyingProperty('vec4', 'vRkBodyBand');
    const mat = new THREE.NodeMaterial();
    mat.name = 'RocketBody';
    mat.lights = false;
    mat.fog = false;
    mat.transparent = false;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.positionNode = Fn(() => {
      const A = attribute('mb0', 'vec4');
      const B = attribute('mb1', 'vec4');
      const p = positionGeometry;
      const n = normalGeometry;
      // Obrót wokół osi rakiety (X), potem kurs w płaszczyźnie (Z), skala = długość.
      const cr = cos(B.z);
      const sr = sin(B.z);
      const py = p.y.mul(cr).sub(p.z.mul(sr));
      const pz = p.y.mul(sr).add(p.z.mul(cr));
      const ny = n.y.mul(cr).sub(n.z.mul(sr));
      const nz = n.y.mul(sr).add(n.z.mul(cr));
      const wx = p.x.mul(B.x).sub(py.mul(B.y));
      const wy = p.x.mul(B.y).add(py.mul(B.x));
      const local = vec3(wx, wy, pz).mul(A.w).add(A.xyz);
      vN.assign(vec3(n.x.mul(B.x).sub(ny.mul(B.y)), n.x.mul(B.y).add(ny.mul(B.x)), nz));
      vP.assign(local);
      vX.assign(p.x);
      vHull.assign(attribute('mb2', 'vec4').xyz);
      vBand.assign(vec4(attribute('mb3', 'vec4').xyz, B.w));
      return local;
    })();
    mat.fragmentNode = Fn(() => {
      const N = normalize(vN).toVar();
      const x = vX;
      // Pas barwy strony na korpusie (x ∈ [0,05; 0,16]) i żar dyszy (x < −0,44).
      const inBand = smoothstep(0.03, 0.05, x).mul(float(1.0).sub(smoothstep(0.14, 0.16, x)));
      const albedo = vHull.mul(mix(vec3(1.0), vBand.xyz, inBand)).toVar();
      const sunVis = sunVisibility().toVar();
      const L = sun.sunDir;
      const ndl = max(dot(N, L), 0.0);
      const H = normalize(L.add(vec3(0.0, 0.0, 1.0)));
      const spec = pow(max(dot(N, H), 0.0), 28.0).mul(0.45).mul(sunVis);
      const direct = sun.sunCol.mul(ndl.mul(0.62).mul(sunVis));
      // Światła siatki (lokalnie względem początku pul — ta sama rama co instancje).
      const pnt = vec3(0.0).toVar();
      grid.loop(vP, ({ toL, att, col }) => {
        pnt.addAssign(col.mul(att).mul(clamp(dot(N, toL).mul(0.8).add(0.2), 0.0, 1.0)));
      });
      const amb = vec3(0.05, 0.058, 0.075).mul(N.z.mul(0.4).add(0.6));
      const emis = vec3(1.6, 0.8, 0.35).mul(vBand.w).mul(float(1.0).sub(smoothstep(-0.47, -0.43, x)));
      const c = albedo.mul(amb.add(direct).add(pnt.mul(0.6))).add(sun.sunCol.mul(spec)).add(emis);
      return vec4(c, 1.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'RocketBodies';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  /** Rakieta LOKALNIE: środek, kąt (scena), długość [j.], barwy, żar dyszy 0..1, obrót wokół osi. */
  add(x, y, z, angle, length, hull, band, glow, roll = 0) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const o = i * 4;
    const B0 = this.b0.array; const B1 = this.b1.array; const B2 = this.b2.array; const B3 = this.b3.array;
    B0[o] = x; B0[o + 1] = y; B0[o + 2] = z; B0[o + 3] = length;
    B1[o] = Math.cos(angle); B1[o + 1] = Math.sin(angle); B1[o + 2] = roll; B1[o + 3] = glow;
    B2[o] = hull[0]; B2[o + 1] = hull[1]; B2[o + 2] = hull[2]; B2[o + 3] = 0;
    B3[o] = band[0]; B3[o + 1] = band[1]; B3[o + 2] = band[2]; B3[o + 3] = 0;
  }

  /** Kadłubek z wpisu roboczego `s` (lokalnie; kąt sceny jako cos / sin), barwy kadłuba i pasa. */
  push(hull, band) {
    if (this.count >= this.capacity) return;
    const s = this.s;
    const i = this.count++;
    const o = i * 4;
    const B0 = this.b0.array; const B1 = this.b1.array; const B2 = this.b2.array; const B3 = this.b3.array;
    B0[o] = s.x; B0[o + 1] = s.y; B0[o + 2] = s.z; B0[o + 3] = s.length;
    B1[o] = s.cos; B1[o + 1] = s.sin; B1[o + 2] = s.roll; B1[o + 3] = s.glow;
    B2[o] = hull[0]; B2[o + 1] = hull[1]; B2[o + 2] = hull[2]; B2[o + 3] = 0;
    B3[o] = band[0]; B3[o + 1] = band[1]; B3[o + 2] = band[2]; B3[o + 3] = 0;
  }

  commit(ox, oy) {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    const m = this.mesh;
    m.position.set(ox, oy, 0);
    m.updateMatrix();
    m.matrixWorld.copy(m.matrix);
    const A = this._attrs;
    for (let k = 0; k < A.length; k++) {
      A[k].__range.start = 0;
      A[k].__range.count = n * 4;
      A[k].needsUpdate = true;
    }
  }
}
