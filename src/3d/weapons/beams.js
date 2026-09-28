// src/3d/weapons/beams.js
//
// Wiązki laserowe (port `dema/bronie-webgpu/beams.js`, zadanie 17) — JEDEN draw call na
// wszystkie wiązki w kadrze: kwad wzdłuż wiązki, kształt w shaderze.
//   CONT  — wiązka ciągła: białe jądro (stała szerokość w px), ciało w barwie broni płynące
//           szumem (plazma w kanale), pakiety energii biegnące do celu, rozbłysk przy soczewce.
//   PULSE — impuls: front biegnie od emitera do celu (~42 000 j/s), potem zwężenie i zgaśnięcie.
//   PD    — laser obrony punktowej: cienki, szybki impuls.
// Pasma HDR jak w grze: ponad progiem bloomu tylko cienkie jądro i krótkie rozbłyski, ciało
// ≤ ~1. W grze końce wiązek liczy fasada (weaponFx.js) co klatkę — z nośnikiem strzelca,
// względem początku pul przy kamerze; bufor to lista wiązek TEJ klatki (zero alokacji).

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, attributeArray, instanceIndex, positionGeometry,
  varyingProperty, texture, If, mix, clamp, smoothstep, exp, sin, max, length, pow
} from 'three/tsl';
import { additiveMaterial } from './gpuFx.js';
import { liveRangeAttribute, markRange } from './liveRange.js';

export const BEAM = Object.freeze({ CONT: 0, PULSE: 1, PD: 2 });
/** Wiązek w jednym draw callu na klatkę (PD w bitwie: setki równocześnie). */
export const BEAM_MAX = 1024;
/** Prędkość frontu impulsu [j/s] (demo). */
export const PULSE_SPEED = 42000;
const FLOATS = 16;
const sq = (x) => x.mul(x);

export class BeamSystem {
  /**
   * @param {object} o
   * @param {THREE.Texture} o.noise
   * @param {import('../fx/gpuPoolOrigin.js').FxPoolOrigin} o.origin
   */
  constructor({ noise, origin, renderOrder = 52 }) {
    this.noise = noise;
    this.origin = origin;
    this.renderOrder = renderOrder;
    this.node = attributeArray(BEAM_MAX * 4, 'vec4').setName('wfxBeams');
    this.data = this.node.value.array;
    liveRangeAttribute(this.node.value);
    this.U = { zoom: uniform(1).setName('wfxBeamZoom') };
    this.count = 0;
    this.dropped = 0;
    this.mesh = null;
  }

  build(scene) {
    if (this.mesh) return this;
    const U = this.U;
    const Q = this.node;
    const noise = this.noise;
    const T = this.origin.timeFx;
    const vL = varyingProperty('vec4', 'vWfxBmL');   // wzdłuż, w poprzek, długość, szerokość
    const vA = varyingProperty('vec4', 'vWfxBmA');   // barwa ciała, moc
    const vB = varyingProperty('vec4', 'vWfxBmB');   // styl, ziarno, wiek, szer. jądra [j.]
    const mat = additiveMaterial('wfxBeams');
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(4)).toVar();
      const A = Q.element(i).toVar();
      const B = Q.element(i.add(uint(1))).toVar();
      const C = Q.element(i.add(uint(2))).toVar();
      const D = Q.element(i.add(uint(3))).toVar();
      const ab = A.zw.sub(A.xy).toVar();
      const len = max(length(ab), 1e-3).toVar();
      const dir = ab.div(len);
      const perp = vec2(dir.y.negate(), dir.x);
      const W = B.w;
      const halo = W.mul(2.4).add(float(3.0).div(U.zoom)).toVar();
      const g = positionGeometry.xy;
      const along = mix(halo.negate(), len.add(halo), g.x.add(0.5));
      const across = g.y.mul(2.0).mul(halo);
      vL.assign(vec4(along, across, len, W));
      vA.assign(C);
      // jądro: ≥ 1,2 px, rośnie z szerokością wiązki
      vB.assign(vec4(D.x, D.y, D.z, max(W.mul(0.16), float(1.2).div(U.zoom))));
      return vec3(A.xy.add(dir.mul(along)).add(perp.mul(across)), 16.0);
    })();
    // 1, gdy front jeszcze nie doszedł do celu
    const step1 = (front, len) => smoothstep(len.add(1.0), len.sub(1.0), front);
    mat.fragmentNode = Fn(() => {
      const along = vL.x;
      const across = vL.y;
      const len = vL.z;
      const W = max(vL.w, 1e-3);
      const style = vB.x;
      const seed = vB.y;
      const age = vB.z;
      const coreW = max(vB.w, 1e-3);
      const col = vA.xyz;
      const power = vA.w;
      const t = T;
      const inside = clamp(along, 0.0, len);
      const d = length(vec2(along.sub(inside), across)).toVar();
      // końce: miękkie wejście przy soczewce, domknięcie przy celu
      const endFade = smoothstep(0.0, W.mul(0.6), len.sub(along).add(W.mul(0.3)))
        .mul(smoothstep(W.negate().mul(0.8), W.mul(0.4), along));
      const out = vec3(0.0).toVar();
      If(style.lessThan(0.5), () => {
        // CONT: płynąca plazma, pakiety energii
        const flowU = along.div(W.mul(9.0)).sub(t.mul(3.2));
        const n1 = texture(noise, vec2(flowU, across.div(W).mul(0.35).add(seed))).r;
        const n2 = texture(noise, vec2(flowU.mul(2.3).sub(t.mul(1.7)), across.div(W).mul(0.7).sub(seed))).b;
        const flow = n1.mul(0.65).add(n2.mul(0.35));
        const core = exp(sq(d.div(coreW)).negate());
        const body = exp(sq(d.div(W.mul(0.5))).negate()).mul(flow.mul(0.8).add(0.45));
        const sheath = exp(sq(d.div(W.mul(1.25))).negate()).mul(0.22).mul(n2.mul(0.5).add(0.6));
        const packet = pow(sin(along.div(W.mul(5.0)).sub(t.mul(55.0))).mul(0.5).add(0.5), 10.0).mul(exp(sq(d.div(W.mul(0.35))).negate())).mul(0.55);
        const lens = exp(sq(length(vec2(along, across)).div(W.mul(1.4))).negate()).mul(1.6);
        out.assign(vec3(1.0, 1.0, 1.0).mul(core.mul(4.5)).add(col.mul(body.add(sheath).add(packet))).add(col.add(0.6).mul(lens)));
      }).ElseIf(style.lessThan(1.5), () => {
        // PULSE: front impulsu, potem zwężenie i zgaśnięcie
        const front = age.mul(PULSE_SPEED);
        const reached = smoothstep(front, front.sub(W.mul(6.0)), along);
        const head = exp(sq(along.sub(front).div(W.mul(2.0))).negate()).mul(step1(front, len));
        const n = texture(noise, vec2(along.div(W.mul(7.0)).sub(t.mul(5.0)), across.div(W).mul(0.4).add(seed))).r;
        const core = exp(sq(d.div(coreW)).negate());
        const body = exp(sq(d.div(W.mul(0.45))).negate()).mul(n.mul(0.6).add(0.6));
        const sheath = exp(sq(d.div(W.mul(1.1))).negate()).mul(0.2);
        out.assign(vec3(1.0).mul(core.mul(5.0)).add(col.mul(body.add(sheath))).mul(reached).add(col.add(0.8).mul(head.mul(2.0))));
      }).Else(() => {
        // PD: cienki impuls
        const core = exp(sq(d.div(coreW.mul(0.8))).negate());
        const body = exp(sq(d.div(W.mul(0.6))).negate()).mul(0.7);
        out.assign(vec3(1.0).mul(core.mul(4.0)).add(col.mul(body)));
      });
      const c = max(out.mul(power).mul(endFade), vec3(0.0)).toVar();
      return vec4(c, max(c.x, max(c.y, c.z)));
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = this.renderOrder;
    this.mesh.name = 'wfxBeams';
    this.mesh.count = 2;
    this.mesh.visible = false;
    if (scene) scene.add(this.mesh);
    return this;
  }

  begin() { this.count = 0; }

  /**
   * Wiązka na tę klatkę: końce w układzie LOKALNYM (scena − początek pul), styl, szerokość
   * [j.], barwa HDR (tablica [r, g, b] albo liczby przez addRgb), moc 0..1, ziarno, wiek [s].
   */
  add(x0, y0, x1, y1, style, width, col, power, seed = 0, age = 0) {
    return this.addRgb(x0, y0, x1, y1, style, width, col[0], col[1], col[2], power, seed, age);
  }

  addRgb(x0, y0, x1, y1, style, width, r, g, b, power, seed = 0, age = 0) {
    if (this.count >= BEAM_MAX) { this.dropped++; return false; }
    const o = this.count++ * FLOATS;
    const D = this.data;
    D[o] = x0; D[o + 1] = y0; D[o + 2] = x1; D[o + 3] = y1;
    D[o + 4] = 1; D[o + 5] = 1; D[o + 6] = 1; D[o + 7] = width;
    D[o + 8] = r; D[o + 9] = g; D[o + 10] = b; D[o + 11] = power;
    D[o + 12] = style; D[o + 13] = seed; D[o + 14] = age; D[o + 15] = 0;
    return true;
  }

  commit(zoom, originX, originY) {
    this.U.zoom.value = Math.max(1e-4, zoom);
    const mesh = this.mesh;
    if (!mesh) return;
    const n = this.count;
    if (n === 1) {
      // druga instancja z zerową mocą (liczba instancji 1 ↔ > 1 zmienia klucz programu)
      const D = this.data;
      for (let k = FLOATS; k < FLOATS * 2; k++) D[k] = 0;
    }
    if (n > 0) markRange(this.node.value, 0, Math.max(2, n) * FLOATS);
    mesh.count = Math.max(2, n);
    mesh.visible = n > 0;
    if (n > 0) {
      mesh.position.set(originX, originY, 0);
      mesh.updateMatrixWorld(true);
    }
  }
}
