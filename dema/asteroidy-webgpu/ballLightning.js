// dema/asteroidy-webgpu/ballLightning.js
//
// PIORUN KULISTY (rdzeń skały energetycznej; fizyka: src/game/asteroidMining.js
// → balls): kula plazmy w passie gry, addytywnie (kolor One/One, alfa zostaje —
// jak duszki blasku). Jasny, prawie biały rdzeń, fioletowe ciało, zimny brzeg,
// włókna wyładowań pełzające po powierzchni (szum 3D w ruchu), kula lekko
// „oddycha”. Niestabilna (bezpiecznik się kończy) — migocze szybciej i bieleje;
// w pułapce magnetycznej — uspokaja się i sinieje.
// Poświatę (duszki), światło (siatka) i łuki (burza) dokłada platforma dema
// (miningRig.js).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec4, uniform, attribute, varyingProperty, positionGeometry, texture3D,
  mix, smoothstep, clamp, abs, max, pow, sin, normalize
} from 'three/tsl';

export class BallLightningView {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene pass gry
   * @param {object} o.shared uniformy skał (noise, exposure)
   */
  constructor({ scene, shared, capacity = 16, renderOrder = 19 }) {
    this.capacity = capacity;
    this.S = shared;
    this.U = { time: uniform(0) };
    const base = new THREE.IcosahedronGeometry(1, 4);
    const geo = new THREE.InstancedBufferGeometry();
    if (base.index) geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const at of [this.a, this.b]) at.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('bA', this.a);
    geo.setAttribute('bB', this.b);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, this._buildMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.mesh.name = 'ballLightning';
    scene.add(this.mesh);
    this.count = 0;
  }

  _buildMaterial() {
    const S = this.S;
    const U = this.U;
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.forceSinglePass = true;
    mat.side = THREE.FrontSide;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    const vN = varyingProperty('vec3', 'vBallN');
    const vB = varyingProperty('vec4', 'vBallB');
    mat.positionNode = Fn(() => {
      const A = attribute('bA', 'vec4');
      const B = attribute('bB', 'vec4');
      const n = normalize(positionGeometry);
      // Oddech kuli: garby szumu w ruchu (większe przy niestabilnej).
      const t = U.time.mul(1.7).add(B.z.mul(13.0));
      const w = texture3D(S.noise, n.mul(0.8).add(vec3(t.mul(0.21), t.mul(-0.17), B.z.mul(3.0)))).level(0).r.sub(0.5);
      const r = A.w.mul(float(1.0).add(w.mul(float(0.14).add(B.x.mul(0.18)))));
      vN.assign(n);
      vB.assign(B);
      return A.xyz.add(n.mul(r));
    })();
    mat.fragmentNode = Fn(() => {
      const N = normalize(vN).toVar();
      const B = vB;
      const instab = clamp(B.x, 0.0, 1.0).toVar();
      const lock = clamp(B.y, 0.0, 1.0).toVar();
      const seed = B.z;
      // Kamera ortho z góry: patrzenie wzdłuż −Z — środek kuli ma N.z ≈ 1.
      const mu = clamp(N.z, 0.0, 1.0).toVar();
      const t = U.time.toVar();
      // Plazma: dwie warstwy szumu płynące w przeciwne strony.
      const p1 = N.mul(1.3).add(vec3(t.mul(0.33), t.mul(-0.27), seed.mul(7.0)));
      const p2 = N.mul(2.9).add(vec3(t.mul(-0.51), seed.mul(3.0), t.mul(0.44)));
      const a = texture3D(S.noise, p1).level(0).r.toVar();
      const b = texture3D(S.noise, p2).level(0).g.toVar();
      const swirl = a.mul(0.65).add(b.mul(0.35)).toVar();
      // Włókna wyładowań: cienkie izolinie szumu (w pułapce — rzadsze).
      const fil = float(1.0).sub(smoothstep(0.0, mix(float(0.05), float(0.025), lock), abs(swirl.sub(0.5)))).toVar();
      // Migotanie: szybsze i głębsze przy końcu bezpiecznika.
      const flick = float(1.0).add(sin(t.mul(mix(float(11.0), float(47.0), instab)).add(seed.mul(40.0))).mul(mix(float(0.12), float(0.45), instab)));
      // Barwy w paśmie HDR efektów: rdzeń ~2 (nie biała tarcza), ciało 0,5–1, włókna ~2,5.
      const violet = mix(vec3(0.62, 0.3, 1.0), vec3(0.3, 0.75, 1.0), lock.mul(0.7));
      const core = pow(mu, 6.0).mul(mix(float(0.9), float(2.2), instab)).mul(swirl.mul(0.6).add(0.7));
      const body = mu.mul(0.35).add(0.12).mul(swirl.mul(1.2).add(0.15));
      const rim = pow(float(1.0).sub(mu), 2.5).mul(0.9);
      const col = vec3(1.0, 0.85, 1.0).mul(core)
        .add(violet.mul(body))
        .add(mix(violet, vec3(0.75, 0.92, 1.0), 0.55).mul(fil).mul(mu.mul(0.9).add(0.8)))
        .add(violet.mul(rim))
        .mul(flick)
        .toVar();
      return vec4(max(col.mul(S.exposure), vec3(0.0)), 0.0);
    })();
    return mat;
  }

  /**
   * @param {Array} balls pioruny fizyki (p, r, fuse, fuse0, lock, id, display)
   * @param {number} ox, oy początek sceny (świat gry)
   * @param {number} time zegar efektów
   */
  update(balls, ox, oy, time) {
    this.U.time.value = time;
    const A = this.a.array;
    const B = this.b.array;
    let n = 0;
    for (const ball of balls) {
      if (!ball.alive || n >= this.capacity) continue;
      const o = n++ * 4;
      A[o] = ball.p[0] - ox; A[o + 1] = ball.p[1] + oy; A[o + 2] = ball.p[2]; A[o + 3] = ball.r;
      B[o] = ballInstability(ball); B[o + 1] = ball.lock || 0; B[o + 2] = ((ball.id * 0.6180339887) % 1); B[o + 3] = 0;
    }
    this.count = n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    for (const at of [this.a, this.b]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
  }
}

/** Niestabilność 0…1: rośnie, gdy bezpiecznik się kończy (ostatnie ~2,5 s). */
export function ballInstability(ball) {
  if (!Number.isFinite(ball.fuse)) return 0;
  return Math.min(1, Math.max(0, 1 - ball.fuse / 2.5));
}
