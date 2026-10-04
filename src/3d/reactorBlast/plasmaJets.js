// src/3d/reactorBlast/plasmaJets.js
//
// STRUMIEŃ PLAZMY z rozerwanej komory reaktora (wariant „wyrzut”) — kwad wzdłuż osi strumienia,
// kształt liczony analitycznie w TSL (widok z góry). Rozwinięcie płomienia napędu plazmowego
// supernowej (src/3d/rockets/plumes.js, rodzaj 2) do skali wybuchu reaktora:
//   • strumień się rozszerza (√s), przy wylocie DIAMENTY MACHA (przewężenia i jasne węzły
//     nieruchome względem dyszy — wyrwy w kadłubie);
//   • turbulencja z tekstury szumu przesuwana wzdłuż osi z prędkością strugi (porcje plazmy
//     płyną, a nie „wibrują” w miejscu), koniec strugi rwie się na kłęby;
//   • cienka biała nić rdzenia (jedyne pole nad progiem bloomu, szerokość z minimum w px),
//     ciało w barwie frakcji 0,6–1,2, otoczka 0,2–0,4 gasnąca przed brzegiem kwadu.
// Addytywnie (ONE, ONE; alfa celu bez zmian). Instancje przepisywane co klatkę — pozycje
// lokalnie względem początku pul Core3D. Bufory wierzchołków: pozycja, uv + 4 = 6.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, varyingProperty, positionGeometry, texture,
  mix, smoothstep, clamp, exp, sin, cos, max, sqrt, abs
} from 'three/tsl';

export const PLASMA_JET_CAP = 32;

function liveAttr(capacity) {
  const at = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const range = { start: 0, count: 4 };
  at.updateRanges.length = 0;
  at.updateRanges.push(range);
  at.clearUpdateRanges = () => {};
  at.__range = range;
  return at;
}

export class PlasmaJetSystem {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Texture} o.noise2D kafelkowy szum 2D (fxNoise.tile2D — RepeatWrapping)
   */
  constructor({ scene, noise2D, capacity = PLASMA_JET_CAP, renderOrder = 72 }) {
    this.capacity = capacity;
    this.count = 0;
    this.s = { x: 0, y: 0, z: 0, len: 0, dx: 1, dy: 0, width: 10, intensity: 1, seed: 0, flow: 3000, grow: 1, r: 1, g: 1, b: 1 };
    this.U = { time: uniform(0), zoom: uniform(1), gain: uniform(1) };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.a0 = liveAttr(capacity); this.a1 = liveAttr(capacity); this.a2 = liveAttr(capacity); this.a3 = liveAttr(capacity);
    this._attrs = [this.a0, this.a1, this.a2, this.a3];
    geo.setAttribute('pj0', this.a0); // początek xyz (lokalnie), długość
    geo.setAttribute('pj1', this.a1); // kierunek xy (scena), promień u wylotu, moc 0..1
    geo.setAttribute('pj2', this.a2); // ziarno, prędkość strugi [j./s], widoczna część 0..1, —
    geo.setAttribute('pj3', this.a3); // barwa plazmy (maks. kanał 1)
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const vA = varyingProperty('vec4', 'vRbJtA'); // s, u (× promień u wylotu), długość, promień
    const vB = varyingProperty('vec4', 'vRbJtB'); // moc, ziarno, prędkość, widoczna część
    const vCol = varyingProperty('vec3', 'vRbJtCol');
    const mat = new THREE.NodeMaterial();
    mat.name = 'ReactorPlasmaJet';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const A = attribute('pj0', 'vec4');
      const B = attribute('pj1', 'vec4');
      const C = attribute('pj2', 'vec4');
      const q = positionGeometry.xy;
      const s = q.x.add(0.5).mul(1.1).sub(0.06);
      const dir = B.xy;
      const perp = vec2(dir.y.negate(), dir.x);
      const R0 = max(B.z, 1e-3);
      // Otoczka do 2,4 promienia (rozszerzona strugą), z minimum ~5 px na nić rdzenia.
      const halfW = max(R0.mul(2.4).mul(float(0.6).add(max(s, 0.0).mul(1.1))), float(5.0).div(U.zoom));
      const t = q.y.mul(2.0);
      const p = A.xy.add(dir.mul(s.mul(A.w))).add(perp.mul(t.mul(halfW)));
      vA.assign(vec4(s, t.mul(halfW).div(R0), A.w, R0));
      vB.assign(vec4(B.w, C.x, C.y, C.z));
      vCol.assign(attribute('pj3', 'vec4').xyz);
      return vec3(p, A.z);
    })();
    mat.fragmentNode = Fn(() => {
      const s = vA.x.toVar();
      const u = vA.y.toVar();
      const len = vA.z;
      const R0 = vA.w;
      const power = vB.x;
      const seed = vB.y;
      const flowV = vB.z;
      const reach = clamp(vB.w, 0.0, 1.0);
      const time = U.time;
      const sp = clamp(s, 0.0, 1.0).toVar();
      const inFront = smoothstep(-0.05, 0.0, s);
      // Widoczna część (strumień wyrasta z wyrwy w ~0,1 s): czoło strugi poszarpane szumem.
      const d = sp.mul(len);
      const adv = d.sub(time.mul(flowV));
      const n1 = texture(noise2D, vec2(adv.div(R0.mul(7.0)), u.mul(0.12).add(seed))).level(0).x;
      const n2 = texture(noise2D, vec2(adv.div(R0.mul(2.6)).add(0.37), u.mul(0.33).add(seed.mul(1.7)))).level(0).y;
      const n = n1.mul(0.6).add(n2.mul(0.4)).toVar();
      const front = float(1.0).sub(smoothstep(reach.sub(0.08), reach.add(0.02), sp.add(n.sub(0.5).mul(0.08))));
      // Rozszerzenie strugi i diamenty Macha przy wylocie (nieruchome względem wyrwy).
      const rw = float(0.6).add(sqrt(sp).mul(1.1)).toVar();
      const phase = d.div(R0.mul(1.7)).mul(6.2831853);
      const cn = max(cos(phase), 0.0);
      const c2 = cn.mul(cn);
      const c4 = c2.mul(c2);
      const nodes = c4.mul(c4).mul(exp(sp.mul(-4.0)));
      const pinch = float(1.0).sub(exp(sp.mul(-3.5)).mul(0.35).mul(float(1.0).sub(cn)));
      const rwe = rw.mul(pinch).toVar();
      const oneMs = float(1.0).sub(sp).toVar();
      // Nić rdzenia: cienka, biała, gaśnie przed końcem.
      const lw = rwe.mul(0.14);
      const uc = u.div(lw);
      const coreLine = exp(uc.mul(uc).mul(-2.2)).mul(sqrt(oneMs)).mul(inFront);
      // Ciało: barwa frakcji, porcje płyną, koniec rwie się na kłęby.
      const bw = rwe.mul(0.55);
      const ub = u.div(bw);
      const erode = smoothstep(n.mul(0.3).add(0.62), 1.02, sp);
      const body = exp(ub.mul(ub).mul(-2.0)).mul(n.mul(0.9).add(0.55)).mul(oneMs.mul(0.6).add(0.4))
        .mul(float(1.0).sub(erode)).mul(nodes.mul(1.8).add(1.0)).mul(inFront);
      // Otoczka: szeroka, pod progiem bloomu, gaśnie przed brzegiem kwadu.
      const sw = rwe.mul(1.15);
      const us = u.div(sw);
      const sheath = exp(us.mul(us).mul(-1.3)).mul(oneMs.mul(oneMs)).mul(n.mul(0.6).add(0.6)).mul(inFront)
        .mul(float(1.0).sub(smoothstep(1.7, 2.3, abs(u).div(rw))));
      const flick = sin(time.mul(43.0).add(seed.mul(50.0))).mul(sin(time.mul(29.0).add(seed.mul(13.0)))).mul(0.1).add(0.9);
      const pcol = vCol;
      // Nić rdzenia 4,5 (cienka, nad progiem), ciało w barwie frakcji ~0,6–1,3, otoczka pod progiem.
      const col = vec3(1.0, 0.98, 0.96).mul(coreLine.mul(4.5).mul(power))
        .add(pcol.mul(body.mul(0.95)))
        .add(pcol.mul(vec3(0.85, 0.9, 1.0)).mul(sheath.mul(0.42)));
      return vec4(max(col.mul(front).mul(flick).mul(power).mul(U.gain), vec3(0.0)), 0.0);
    })();
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'ReactorPlasmaJets';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  /** Strumień z wpisu roboczego `s` (LOKALNIE): początek, kierunek (scena), długość, promień. */
  push() {
    if (this.count >= this.capacity) return;
    const s = this.s;
    if (!(s.len > 0) || !(s.intensity > 0)) return;
    const i = this.count++;
    const o = i * 4;
    const l = Math.sqrt(s.dx * s.dx + s.dy * s.dy) || 1;
    const A0 = this.a0.array, A1 = this.a1.array, A2 = this.a2.array, A3 = this.a3.array;
    A0[o] = s.x; A0[o + 1] = s.y; A0[o + 2] = s.z; A0[o + 3] = s.len;
    A1[o] = s.dx / l; A1[o + 1] = s.dy / l; A1[o + 2] = s.width; A1[o + 3] = s.intensity;
    A2[o] = s.seed; A2[o + 1] = s.flow; A2[o + 2] = s.grow; A2[o + 3] = 0;
    A3[o] = s.r; A3[o + 1] = s.g; A3[o + 2] = s.b; A3[o + 3] = 0;
  }

  commit(time, zoom, ox, oy) {
    this.U.time.value = time;
    this.U.zoom.value = zoom > 1e-4 ? zoom : 1e-4;
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    const m = this.mesh;
    m.position.set(ox, oy, 0);
    m.updateMatrix();
    m.matrixWorld.copy(m.matrix);
    for (let k = 0; k < this._attrs.length; k++) {
      const at = this._attrs[k];
      at.__range.start = 0;
      at.__range.count = n * 4;
      at.needsUpdate = true;
    }
  }

  clear() {
    this.count = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }
}
