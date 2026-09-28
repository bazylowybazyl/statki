// dema/warp-webgpu/rift.js
//
// TUNEL (szew) — przylot i odlot okrętów widziany z zewnątrz (user 2026-09-27:
// „prosta linia smuga i otwiera się tunel, z którego wypada statek”; stare demo
// miało lepszy feel przylotu floty i zasadzki). Kształt i oś czasu z propozycji 1
// (src/game/warpDrive.js: zwiastun → rozdarcie → wyrzut → zamknięcie), nowy
// wygląd: szczelina-soczewka wzdłuż kursu z cienkimi jasnymi brzegami (jedyne
// nad progiem bloomu), a w środku widać przestrzeń warpa — strugi płynące
// wzdłuż osi w barwach plazmy okrętu. Bez świecących obręczy.
// Instancje (jeden draw call), pass gry (kamera ortho, scena).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, attribute, uniform, positionGeometry, varyingProperty, max, min,
  abs, exp, clamp, smoothstep, floor, fract, sin, dot, mix
} from 'three/tsl';

export const RIFT_CAP = 24;

export class RiftSprites {
  constructor({ scene }) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const mk = () => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(RIFT_CAP * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.attrs = { rA: mk(), rB: mk(), rC: mk(), rD: mk(), rE: mk() };
    for (const [k, a] of Object.entries(this.attrs)) geo.setAttribute(k, a);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;
    this.count = 0;
    this.u = { time: uniform(0) };
    const U = this.u;

    const rA = attribute('rA', 'vec4'); // xy środek (scena), zw oś
    const rB = attribute('rB', 'vec4'); // x pół-długość, y pół-szerokość otwarcia, z pół-szerokość kwadu, w szerokość brzegu
    const rC = attribute('rC', 'vec4'); // rgb rdzeń (HDR), w jasność
    const rD = attribute('rD', 'vec4'); // rgb ciało plazmy, w „brudny” (piraci)
    const rE = attribute('rE', 'vec4'); // x ziarno, y przepływ wnętrza, z wypełnienie wnętrza, w —
    const vX = varyingProperty('float', 'vRiftX');
    const vY = varyingProperty('float', 'vRiftY');

    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.positionNode = Fn(() => {
      const g = positionGeometry.xy;
      const along = rB.x.mul(1.12).add(rB.w.mul(4.0));
      const lx = g.x.mul(2.0).mul(along);
      const ly = g.y.mul(2.0).mul(rB.z);
      vX.assign(lx);
      vY.assign(ly);
      const ax = vec2(rA.z, rA.w);
      const pr = vec2(rA.w.negate(), rA.z);
      return vec3(rA.xy.add(ax.mul(lx)).add(pr.mul(ly)), 6.0);
    })();
    mat.fragmentNode = Fn(() => {
      const hl = max(rB.x, 1.0);
      const t = clamp(vX.div(hl), -1.0, 1.0);
      const wv = rB.y.mul(max(float(1.0).sub(t.mul(t)), 0.0)).toVar();
      const ay = abs(vY).toVar();
      const tips = smoothstep(1.04, 0.8, abs(vX).div(hl)).toVar();
      // Brzeg: cienka linia na krawędzi soczewki (przy małym otwarciu — kreska).
      const ew = max(rB.w, 1.0);
      const ed = ay.sub(wv).div(ew);
      const dirty = rD.w;
      const flick = mix(float(1.0), sin(U.time.mul(41.0).add(vX.mul(0.013)).add(rE.x)).mul(0.35).add(0.75), dirty);
      const edge = exp(ed.mul(ed).negate()).mul(tips).mul(flick);
      // Wnętrze: przestrzeń warpa — strugi płynące wzdłuż osi.
      const inside = smoothstep(wv, wv.sub(ew.mul(1.5)), ay).mul(tips).toVar();
      const lane = floor(vY.div(max(rB.y.mul(0.22), ew))).toVar();
      const rnd = fract(sin(dot(vec2(lane, rE.x), vec2(12.9898, 78.233))).mul(43758.5453));
      const f = fract(vX.div(hl.mul(0.45)).sub(U.time.mul(rE.y).mul(rnd.mul(0.8).add(0.6))).add(rnd.mul(7.0)));
      const streak = smoothstep(0.0, 0.08, f).mul(smoothstep(0.55, 0.12, f)).mul(rnd.mul(0.7).add(0.3));
      const interior = rD.rgb.mul(inside.mul(streak.mul(1.1).add(0.18))).mul(rE.z);
      // Poświata przy szczelinie w kształcie soczewki: zwęża się ku ostrzom
      // (stała szerokość dawała prostokąt) i gaśnie przed brzegiem kwadu.
      const env = max(float(1.0).sub(t.mul(t)), 0.0).toVar();
      const glowW = rB.y.mul(1.3).mul(env.sqrt()).add(ew.mul(3.0));
      const glow = rD.rgb.mul(exp(max(ay.sub(wv), 0.0).div(glowW).negate()).mul(0.22)).mul(env).mul(tips)
        .mul(smoothstep(rB.z, rB.z.mul(0.6), ay));
      const col = rC.rgb.mul(edge).add(interior).add(glow).mul(rC.w);
      return vec4(max(col, vec3(0.0)), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'warpRifts';
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  /**
   * Szczelina w scenie: (x, y) środek, (ax, ay) oś, halfLen, halfWidth (otwarcie),
   * edgeW (szerokość brzegu, j.), core / body — barwy [r, g, b], k — jasność.
   */
  add(x, y, ax, ay, halfLen, halfWidth, edgeW, core, body, k, dirty = 0, seed = 0, flow = 1.6, fill = 1) {
    if (this.count >= RIFT_CAP || !(halfLen > 1) || !(k > 0.002)) return;
    const i = this.count++;
    const o = i * 4;
    const A = this.attrs;
    A.rA.array[o] = x; A.rA.array[o + 1] = y; A.rA.array[o + 2] = ax; A.rA.array[o + 3] = ay;
    A.rB.array[o] = halfLen; A.rB.array[o + 1] = halfWidth; A.rB.array[o + 2] = halfWidth * 5 + edgeW * 10 + 60; A.rB.array[o + 3] = edgeW;
    A.rC.array[o] = core[0]; A.rC.array[o + 1] = core[1]; A.rC.array[o + 2] = core[2]; A.rC.array[o + 3] = k;
    A.rD.array[o] = body[0]; A.rD.array[o + 1] = body[1]; A.rD.array[o + 2] = body[2]; A.rD.array[o + 3] = dirty;
    A.rE.array[o] = seed; A.rE.array[o + 1] = flow; A.rE.array[o + 2] = fill; A.rE.array[o + 3] = 0;
  }

  commit(time) {
    this.u.time.value = time;
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    for (const a of Object.values(this.attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
  }
}
