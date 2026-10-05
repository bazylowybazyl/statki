// Pula odłamków metalu dema destruktor3d-webgpu.html — port beamDebris3D.js (GLSL) na TSL.
// Ruch analityczny w wierzchołkach (start + v · (1 − e^(−0,6 t)) / 0,6, obrót wokół osi), koniec
// życia — wygaszenie ditheringiem (nieprzezroczyste, test głębi). Dane instancji w JEDNYM
// przeplecionym buforze (limit 8 buforów wierzchołków: pozycja, normalna, ściana + instancje),
// wysyłka zakresu zmienionych slotów. Oświetlenie światłami sceny (MeshStandardNodeMaterial,
// normalne ścian z pochodnych — odłamki są kanciaste). Losowanie kształtu: Math.random jak w
// oryginale (demo bez rozgrywki).
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, positionGeometry, varyingProperty, select, mix, smoothstep, exp,
  cos, sin, cross, dot, normalize, fract, floor, screenCoordinate, min
} from 'three/tsl';
import { createMetalDebrisGeometry } from './metalDebrisGeometry.js';

export const METAL_DEBRIS_CAPACITY = 6144;
export const METAL_DEBRIS_LIFE = 8;
const STRIDE = 20; // aStart 3, aVel 3, aRot 4, aInfo 3, aColor 3, aShape 4
const FIELDS = [['aStart', 0, 3], ['aVel', 3, 3], ['aRot', 6, 4], ['aInfo', 10, 3], ['aColor', 13, 3], ['aShape', 16, 4]];

function createMaterial(uTime) {
  const vColor = varyingProperty('vec3', 'vDebColor');
  const vAlpha = varyingProperty('float', 'vDebAlpha');
  const vLocal = varyingProperty('vec3', 'vDebLocal');
  const vFace = varyingProperty('float', 'vDebFace');
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.6 });
  mat.name = 'BeamMetalDebris';
  mat.flatShading = true;
  mat.positionNode = Fn(() => {
    const aStart = attribute('aStart', 'vec3');
    const aVel = attribute('aVel', 'vec3');
    const aRot = attribute('aRot', 'vec4');
    const aInfo = attribute('aInfo', 'vec3');
    const aShape = attribute('aShape', 'vec4');
    const age = uTime.sub(aInfo.x);
    const life = aInfo.z;
    const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
    vColor.assign(attribute('aColor', 'vec3'));
    vFace.assign(attribute('aFace', 'float'));
    vLocal.assign(positionGeometry);
    const center = aStart.add(aVel.mul(float(1.0).sub(exp(age.mul(-0.6))).div(0.6)));
    const angle = aShape.w.add(aRot.w.mul(age));
    const axis = normalize(aRot.xyz.add(vec3(1e-6, 0.0, 0.0)));
    const c = cos(angle);
    const s = sin(angle);
    const p = positionGeometry.mul(aShape.xyz).mul(aInfo.y);
    const rotated = p.mul(c).add(cross(axis, p).mul(s)).add(axis.mul(dot(axis, p)).mul(float(1.0).sub(c)));
    vAlpha.assign(select(alive, float(1.0).sub(smoothstep(life.mul(0.8), life, age)), float(0.0)));
    // Martwa instancja: wszystkie wierzchołki w jednym punkcie (zerowe pole — nic nie rysuje).
    return select(alive, center.add(rotated), vec3(0.0));
  })();
  mat.colorNode = Fn(() => {
    const bare = smoothstep(0.7, 0.95, vFace);
    const paint = vColor.mul(mix(float(1.0), float(0.62), min(float(1.0), vFace.mul(1.8))));
    const col = mix(paint, vec3(0.43, 0.47, 0.5), bare);
    const sc = sin(vLocal.x.mul(119.0).add(vLocal.z.mul(19.0))).mul(0.5).add(0.5);
    const sc2 = sc.mul(sc);
    const sc4 = sc2.mul(sc2);
    const scratch = sc4.mul(sc4).mul(sc4);
    return vec4(col.mul(float(1.0).sub(scratch.mul(0.12))), 1.0);
  })();
  // Wygaszanie na końcu życia: dithering (instancji nie da się posortować na fragment).
  mat.maskNode = Fn(() => {
    const noise = fract(sin(dot(floor(screenCoordinate.xy), vec2(12.9898, 78.233))).mul(43758.5453));
    return vAlpha.greaterThan(0.0).and(noise.lessThanEqual(vAlpha));
  })();
  return mat;
}

function createBatch(scene, kind, capacity, material) {
  const geometry = createMetalDebrisGeometry(kind);
  const array = new Float32Array(capacity * STRIDE);
  const buffer = new THREE.InstancedInterleavedBuffer(array, STRIDE, 1);
  for (const [name, offset, size] of FIELDS) geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
  const instanced = new THREE.InstancedBufferGeometry();
  instanced.index = geometry.index;
  for (const name of Object.keys(geometry.attributes)) instanced.setAttribute(name, geometry.attributes[name]);
  instanced.instanceCount = 0;
  const mesh = new THREE.Mesh(instanced, material);
  mesh.name = `Metal debris (WebGPU): ${kind}`;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return { kind, capacity, geometry: instanced, buffer, array, mesh, cursor: 0, first: 0, alive: 0, dirtyMin: capacity, dirtyMax: -1 };
}

export class MetalDebrisPoolGPU {
  constructor(scene, capacity = METAL_DEBRIS_CAPACITY) {
    this.uTime = uniform(0);
    this.material = createMaterial(this.uTime);
    const plates = Math.max(1, Math.floor(capacity * 2 / 3));
    this.batches = [createBatch(scene, 'plate', plates, this.material),
      createBatch(scene, 'strut', Math.max(1, capacity - plates), this.material)];
  }

  get meshes() { return this.batches.map((b) => b.mesh); }

  spawn(x, y, z, vx, vy, vz, r, g, b, scale, nowSec, structural = false) {
    const batch = this.batches[structural ? 1 : 0];
    const i = batch.cursor;
    const a = batch.array;
    const o = i * STRIDE;
    a[o] = x; a[o + 1] = y; a[o + 2] = z;
    a[o + 3] = vx; a[o + 4] = vy; a[o + 5] = vz;
    a[o + 6] = Math.random() * 2 - 1; a[o + 7] = Math.random() * 2 - 1; a[o + 8] = Math.random() * 2 - 1;
    a[o + 9] = (Math.random() - 0.5) * 7;
    a[o + 10] = nowSec; a[o + 11] = scale; a[o + 12] = METAL_DEBRIS_LIFE;
    a[o + 13] = r; a[o + 14] = g; a[o + 15] = b;
    a[o + 16] = 0.65 + Math.random() * 0.8;
    a[o + 17] = 0.5 + Math.random() * 0.9;
    a[o + 18] = 0.55 + Math.random() * 0.8;
    a[o + 19] = Math.random() * Math.PI * 2;
    if (!batch.alive) batch.first = i;
    if (batch.alive === batch.capacity) batch.first = (batch.first + 1) % batch.capacity;
    else batch.alive++;
    batch.cursor = (i + 1) % batch.capacity;
    batch.geometry.instanceCount = Math.max(batch.geometry.instanceCount, i + 1);
    batch.dirtyMin = Math.min(batch.dirtyMin, i);
    batch.dirtyMax = Math.max(batch.dirtyMax, i);
  }

  commit(nowSec) {
    this.uTime.value = nowSec;
    for (const batch of this.batches) {
      while (batch.alive && nowSec >= batch.array[batch.first * STRIDE + 10] + METAL_DEBRIS_LIFE) {
        batch.first = (batch.first + 1) % batch.capacity;
        batch.alive--;
      }
      batch.mesh.visible = batch.alive > 0;
      if (!batch.alive) { batch.geometry.instanceCount = 0; batch.cursor = 0; }
      if (batch.dirtyMax < batch.dirtyMin) continue;
      const buf = batch.buffer;
      buf.clearUpdateRanges();
      buf.addUpdateRange(batch.dirtyMin * STRIDE, (batch.dirtyMax - batch.dirtyMin + 1) * STRIDE);
      buf.needsUpdate = true;
      batch.dirtyMin = batch.capacity; batch.dirtyMax = -1;
    }
  }

  reset() {
    for (const batch of this.batches) {
      batch.cursor = batch.first = batch.alive = batch.geometry.instanceCount = 0;
      batch.dirtyMin = batch.capacity; batch.dirtyMax = -1;
      batch.mesh.visible = false;
    }
  }

  dispose(scene) {
    for (const batch of this.batches) { scene?.remove(batch.mesh); batch.geometry.dispose(); }
    this.material.dispose();
  }
}
