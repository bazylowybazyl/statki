// dema/rakiety-webgpu/missileBodies.js
//
// Kadłubki rakiet: jedna siatka instancjonowana (korpus, ostrołuk, 4
// stateczniki, dysza) wzdłuż +X, oświetlana słońcem i siatką świateł
// (MeshStandardNodeMaterial przez GridLighting dema asteroid) — przelatując
// przez błysk wybuchu albo reflektor statku, rakieta łapie światło.
// Barwa instancji = barwa kadłubka, pas i żar dyszy w emisji z atrybutu.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, vec3, mix, smoothstep, positionLocal, float } from 'three/tsl';

export const BODY_CAP = 4096;

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

export class MissileBodies {
  constructor({ scene, capacity = BODY_CAP, renderOrder = 50 }) {
    this.capacity = capacity;
    const geo = buildGeometry();
    this.band = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.band.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('mBand', this.band);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.42, metalness: 0.55 });
    // Pas barwy strony na korpusie (x ∈ [0,05; 0,16]) i żar dyszy (x < −0,44).
    const band = attribute('mBand', 'vec4');
    const x = positionLocal.x;
    const inBand = smoothstep(0.03, 0.05, x).mul(float(1.0).sub(smoothstep(0.14, 0.16, x)));
    mat.colorNode = mix(vec3(1.0), band.xyz, inBand);
    mat.emissiveNode = vec3(1.6, 0.8, 0.35).mul(band.w).mul(float(1.0).sub(smoothstep(-0.47, -0.43, x)));
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
    this.mesh.name = 'missileBodies';
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 0, 1);
    this._roll = new THREE.Quaternion();
    this._x = new THREE.Vector3(1, 0, 0);
  }

  begin() {
    this.count = 0;
  }

  /** Rakieta w SCENIE: środek, kąt (scena), długość [j.], barwy, żar dyszy 0..1, obrót wokół osi. */
  add(x, y, z, angle, length, hull, band, glow, roll = 0) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this._q.setFromAxisAngle(this._axis, angle);
    this._roll.setFromAxisAngle(this._x, roll);
    this._q.multiply(this._roll);
    this._p.set(x, y, z);
    this._s.set(length, length, length);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    const c = this.mesh.instanceColor.array;
    c[i * 3] = hull[0]; c[i * 3 + 1] = hull[1]; c[i * 3 + 2] = hull[2];
    const b = this.band.array;
    b[i * 4] = band[0]; b[i * 4 + 1] = band[1]; b[i * 4 + 2] = band[2]; b[i * 4 + 3] = glow;
  }

  commit() {
    const n = this.count;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, n * 16);
    im.needsUpdate = true;
    const ic = this.mesh.instanceColor;
    ic.clearUpdateRanges();
    ic.addUpdateRange(0, n * 3);
    ic.needsUpdate = true;
    this.band.clearUpdateRanges();
    this.band.addUpdateRange(0, n * 4);
    this.band.needsUpdate = true;
  }
}
