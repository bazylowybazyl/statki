// src/3d/cargo/shadows.tsl.js
//
// CIENIE ŁADUNKU (zadanie 26) — dwa proste rysunki instancji (wzór: cienie Z5 i mostka):
//   • NA KADŁUBIE: prostokąt obrysu (moduł niesiony przez drona, dron, skrzydło wrót „over”)
//     przeciągnięty od wysokości z0 do z1 wzdłuż „słońca cieni” (30°), POD płaszczyzną gry
//     (z = −0,5) z testem głębi GREATER — rysuje się tylko tam, gdzie kadłub (albo pokład
//     stacji) zapisał głębię w z = 0: nie w pustce i nie w otwartej ładowni (dno głębiej).
//     Kolejka przezroczysta PRZED kontenerami, dronami i skrzydłami (renderOrder 10), więc
//     obiekt nie ciemnieje od własnego cienia;
//   • KONTAKT: miękka ciemna obwódka wokół podstawy modułu na dnie ładowni i na placu
//     (zwykły test głębi, przed kontenerami).
// Pokrycie cienia z odległości do przeciągniętego prostokąta (6 próbek), półcień rośnie
// z wysokością.
import * as THREE from 'three/webgpu';
import {
  Fn, abs, attribute, cos, float, length, max, min, mix, positionGeometry, sin, smoothstep, varyingProperty, vec2,
  vec3, vec4
} from 'three/tsl';
import { CARGO_LIGHT } from './cargoLight.tsl.js';

export const SHADOW_FLOATS = 8;

function keepRanges() {}

function sdBox(p, b) {
  const d = abs(p).sub(b);
  return length(max(d, vec2(0.0))).add(min(max(d.x, d.y), 0.0));
}

function buildHullShadowMaterial() {
  const m = new THREE.NodeMaterial();
  m.name = 'Cargo:cienKadluba';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.depthFunc = THREE.GreaterDepth;
  m.blending = THREE.NormalBlending;
  m.premultipliedAlpha = false;
  const vP = varyingProperty('vec2', 'vShP');
  const vO = varyingProperty('vec4', 'vShO');
  const vB = varyingProperty('vec4', 'vShB');
  m.positionNode = Fn(() => {
    const iA = attribute('iA', 'vec4');
    const iB = attribute('iB', 'vec4');
    const c = cos(iA.z);
    const s = sin(iA.z);
    const S = CARGO_LIGHT.shadowDir;
    const sl = vec2(S.x.mul(c).add(S.y.mul(s)), S.y.mul(c).sub(S.x.mul(s)));
    const k = float(-1.0).div(max(S.z, 0.1));
    const o0 = sl.mul(k.mul(max(iB.z, 0.0)));
    const o1 = sl.mul(k.mul(max(iB.w, 0.0)));
    const hs = iB.xy.mul(0.5);
    const pad = length(o1).mul(0.08).add(min(iB.x, iB.y).mul(0.25)).add(0.5);
    const lo = hs.negate().add(min(min(o0, o1), vec2(0.0))).sub(pad);
    const hi = hs.add(max(max(o0, o1), vec2(0.0))).add(pad);
    const q = mix(lo, hi, positionGeometry.xy.add(0.5));
    vP.assign(q);
    vO.assign(vec4(o0, o1));
    vB.assign(vec4(hs, iA.w, length(o1)));
    return vec3(iA.x.add(q.x.mul(c)).sub(q.y.mul(s)), iA.y.add(q.x.mul(s)).add(q.y.mul(c)), -0.5);
  })();
  m.fragmentNode = Fn(() => {
    const hs = vB.xy;
    const d = float(1e9).toVar();
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      d.assign(min(d, sdBox(vP.sub(mix(vO.xy, vO.zw, t)), hs)));
    }
    const soft = max(vB.w.mul(0.08).add(min(hs.x, hs.y).mul(0.12)), 0.15);
    const body = float(1.0).sub(smoothstep(soft.negate(), soft, d));
    const a = min(body.mul(vB.z), 0.9);
    return vec4(0.0, 0.0, 0.0, a);
  })();
  return m;
}

function buildContactMaterial() {
  const m = new THREE.NodeMaterial();
  m.name = 'Cargo:cienKontaktu';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.blending = THREE.NormalBlending;
  m.premultipliedAlpha = false;
  const vP = varyingProperty('vec2', 'vCtP');
  const vB = varyingProperty('vec4', 'vCtB');
  m.positionNode = Fn(() => {
    const iA = attribute('iA', 'vec4');
    const iB = attribute('iB', 'vec4');
    const c = cos(iA.z);
    const s = sin(iA.z);
    const hs = iB.xy.mul(0.5);
    const q = positionGeometry.xy.mul(iB.xy.add(iB.w.mul(2.0)));
    vP.assign(q);
    vB.assign(vec4(hs, iA.w, iB.w));
    return vec3(iA.x.add(q.x.mul(c)).sub(q.y.mul(s)), iA.y.add(q.x.mul(s)).add(q.y.mul(c)), iB.z.add(0.04));
  })();
  m.fragmentNode = Fn(() => {
    const d = sdBox(vP, vB.xy);
    const a = float(1.0).sub(smoothstep(0.0, max(vB.w, 0.1), d)).mul(vB.z);
    return vec4(0.0, 0.0, 0.0, min(a, 0.85));
  })();
  return m;
}

class ShadowPool {
  constructor(scene, material, capacity, name, order) {
    this.capacity = capacity;
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setIndex(plane.getIndex());
    this.data = new Float32Array(capacity * SHADOW_FLOATS);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, SHADOW_FLOATS, 1);
    this.range = { start: 0, count: this.data.length };
    this.buffer.updateRanges.length = 0;
    this.buffer.updateRanges.push(this.range);
    this.buffer.clearUpdateRanges = keepRanges;
    geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.count = 0;
  }

  push(a0, a1, a2, a3, b0, b1, b2, b3) {
    if (this.count >= this.capacity) return false;
    const o = this.count++ * SHADOW_FLOATS;
    const d = this.data;
    d[o] = a0; d[o + 1] = a1; d[o + 2] = a2; d[o + 3] = a3;
    d[o + 4] = b0; d[o + 5] = b1; d[o + 6] = b2; d[o + 7] = b3;
    return true;
  }

  commit() {
    const n = this.count;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { this.range.count = n * SHADOW_FLOATS; this.buffer.needsUpdate = true; }
  }
}

export class CargoShadows {
  constructor(scene, capacity = 4096) {
    this.hull = new ShadowPool(scene, buildHullShadowMaterial(), capacity, 'Cargo:cienKadluba', 10);
    this.contact = new ShadowPool(scene, buildContactMaterial(), capacity, 'Cargo:cienKontaktu', 10.5);
  }

  begin() { this.hull.count = 0; this.contact.count = 0; }

  /** Cień na kadłubie: środek obrysu (x, y), kurs, L × W, wysokość z0…z1 nad z = 0, siła. */
  pushHull(x, y, yaw, L, W, z0, z1, strength) {
    if (!(z1 > 0) || strength <= 0.003) return false;
    return this.hull.push(x, y, yaw, strength, L, W, Math.max(0, z0), z1);
  }

  /** Obwódka kontaktu: środek podstawy (x, y, z), kurs, L × W, szerokość pad, siła. */
  pushContact(x, y, z, yaw, L, W, pad, strength) {
    if (strength <= 0.003) return false;
    return this.contact.push(x, y, yaw, strength, L, W, z, pad);
  }

  commit() { this.hull.commit(); this.contact.commit(); }
}
