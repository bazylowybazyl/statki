// src/3d/rockets/fireballs.js
//
// KULA OGNIA wybuchu głowicy (port z dema dema/rakiety-webgpu/fireballs.js, zadanie 19) —
// objętość liczona marszem promienia (TSL) na kwadzie nad punktem wybuchu. Widok z góry,
// kamera ortho: promień idzie po −Z przez kulę jednostkową, 18 próbek. W próbce:
//   • gęstość: kula z brzegiem zaburzonym szumem 3D (fxNoise.noise3D, 2 oktawy, płynie
//     z czasem — kłęby się przewalają), promień rośnie szybko (1 − e^(−t/τ)) i dalej powoli;
//   • temperatura: gorący środek, stygnie z czasem i ku brzegowi (szum przesuwa granicę —
//     języki ognia); barwa z rampy ciała czarnego;
//   • sadza: pochłanianie rośnie z wiekiem (świeża kula świeci, starsza dymi), oświetlona
//     słońcem od strony, z której pada (w masce cienia słońca gry), i żarem od środka.
// Całka od przodu do tyłu, wyjście premultiplied (barwa, 1 − transmitancja).
// Pasma HDR: środek świeżej kuli 4–8 (mały, krótki), ciało 0,5–1,3.
//
// Pula bez alokacji (SoA, zamiana z ostatnim przy wygaśnięciu), pozycje świata w double;
// instancje przepisywane co klatkę względem początku pul Core3D.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec4, uniform, attribute, varyingProperty, positionGeometry, texture3D,
  mix, smoothstep, clamp, exp, max, sqrt, dot, length, Discard, If
} from 'three/tsl';
import { sunVisibility } from '../sunShadowMask.js';

export const FIREBALL_CAP = 128;
const STEPS = 18;

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

export class FireballSystem {
  constructor({ scene, noise3D, rng, capacity = FIREBALL_CAP, renderOrder = 40 }) {
    this.capacity = capacity;
    this.rng = rng;
    this.count = 0;
    // Pula (SoA): pozycja świata (double), nośnik (świat), czasy, parametry.
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.cx = new Float32Array(capacity);
    this.cy = new Float32Array(capacity);
    this.t0 = new Float64Array(capacity);
    this.f = new Float32Array(capacity * 8); // z, rMax, life, heat, soot, bright, kind, seed
    this.U = {
      time: uniform(0),
      sunDir: uniform(new THREE.Vector3(-0.6, 0.5, 0.62).normalize()),
      sunCol: uniform(new THREE.Vector3(1.0, 0.95, 0.88)),
      sunGain: uniform(0.5),
      ambient: uniform(new THREE.Vector3(0.05, 0.058, 0.075)),
      gain: uniform(1)
    };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.f0 = liveAttr(capacity); this.f1 = liveAttr(capacity); this.f2 = liveAttr(capacity);
    this._attrs = [this.f0, this.f1, this.f2];
    geo.setAttribute('fb0', this.f0); // środek xyz (lokalnie), promień bieżący
    geo.setAttribute('fb1', this.f1); // wiek, życie, ziarno, żar 0..1
    geo.setAttribute('fb2', this.f2); // sadza 0..1, rozmiar kwadu (× promień), jasność, rodzaj
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const vA = varyingProperty('vec4', 'vRkFbA'); // q.xy (jednostki promienia), wiek, życie
    const vB = varyingProperty('vec4', 'vRkFbB'); // ziarno, żar, sadza, jasność
    const mat = new THREE.NodeMaterial();
    mat.name = 'RocketFireball';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const A = attribute('fb0', 'vec4');
      const B = attribute('fb1', 'vec4');
      const C = attribute('fb2', 'vec4');
      const k = C.y;
      const q = positionGeometry.xy.mul(2.0).mul(k);
      vA.assign(vec4(q, B.x, B.y));
      vB.assign(vec4(B.z, B.w, C.x, C.z));
      return vec3(A.xy.add(q.mul(A.w)), A.z);
    })();

    // Rampa ciała czarnego (T 0..1): czerwień → pomarańcz → żółć → biel HDR.
    const blackbody = (T) => {
      const t = clamp(T, 0.0, 1.2);
      const c1 = mix(vec3(0.0), vec3(0.55, 0.06, 0.012), smoothstep(0.02, 0.25, t));
      const c2 = mix(c1, vec3(1.0, 0.33, 0.05), smoothstep(0.22, 0.5, t));
      const c3 = mix(c2, vec3(1.0, 0.72, 0.28), smoothstep(0.45, 0.78, t));
      const c4 = mix(c3, vec3(1.0, 0.94, 0.82), smoothstep(0.72, 0.95, t));
      return c4.mul(smoothstep(0.78, 1.1, t).mul(4.0).add(1.0));
    };

    mat.fragmentNode = Fn(() => {
      const q = vA.xy.toVar();
      const r2 = dot(q, q).toVar();
      If(r2.greaterThan(1.0), () => { Discard(); });
      const age = vA.z;
      const life = vA.w;
      const seed = vB.x;
      const heat0 = vB.y;
      const soot = vB.z;
      const bright = vB.w;
      const ageN = clamp(age.div(max(life, 1e-3)), 0.0, 1.0).toVar();
      const zIn = sqrt(max(float(1.0).sub(r2), 0.0)).toVar();
      const dz = zIn.mul(2.0).div(STEPS);
      const off = vec3(seed.mul(7.31), seed.mul(3.17), seed.mul(5.53));
      const flow = vec3(0.0, 0.0, age.mul(0.55));
      const acc = vec3(0.0).toVar();
      const trans = float(1.0).toVar();
      // Żar: gorący na starcie, stygnie; gorący rdzeń kurczy się z czasem.
      const heat = heat0.mul(exp(age.div(-0.35)).mul(0.8).add(exp(age.div(-0.9)).mul(0.2)))
        .mul(float(1.0).sub(smoothstep(0.55, 1.0, ageN))).toVar();
      const coreR = mix(float(1.05), float(0.35), ageN).toVar();
      // Sadza narasta od zewnętrznej powłoki do środka.
      const sootAmt = soot.mul(smoothstep(0.04, 0.5, ageN)).toVar();
      // Słońce gry gaśnie w masce cienia (cień planety, kadłubów) — sadza w cieniu ciemna.
      const sunL = U.sunCol.mul(U.sunGain).mul(sunVisibility()).toVar();
      for (let i = 0; i < STEPS; i++) {
        const z = zIn.sub(dz.mul(i + 0.5));
        const p = vec3(q, z).toVar();
        const r = length(p);
        const n1 = texture3D(noise3D, p.mul(0.9).add(off).add(flow)).level(0).x;
        const n2 = texture3D(noise3D, p.mul(2.1).add(off.mul(1.7)).sub(flow.mul(1.6))).level(0).y;
        const n = n1.mul(0.68).add(n2.mul(0.32)).toVar();
        const rd = r.add(n.sub(0.5).mul(0.55)).toVar();
        const dens = float(1.0).sub(smoothstep(0.6, 1.0, rd)).toVar();
        const H = heat.mul(float(1.0).sub(smoothstep(coreR.mul(0.25), coreR, rd.mul(n.mul(0.6).add(0.7))))).toVar();
        const S = sootAmt.mul(smoothstep(0.3, 0.95, rd.add(n.sub(0.5).mul(0.9)).add(ageN.mul(0.35)))).toVar();
        const em = blackbody(H).mul(dens).mul(float(1.0).sub(S.mul(0.85))).mul(bright);
        const sigma = dens.mul(S.mul(1.7).add(0.5)).toVar();
        // Sadza: słońce od strony normalnej (kierunek od środka), otoczenie, żar od środka.
        const nv = p.add(vec3(n.sub(0.5).mul(0.8))).add(vec3(0.0, 0.0, 0.02));
        const nrm = nv.div(max(length(nv), 1e-3));
        const lit = sunL.mul(clamp(dot(nrm, U.sunDir).mul(0.6).add(0.4), 0.0, 1.0)).add(U.ambient).add(blackbody(H.mul(1.3)).mul(0.35));
        const sootCol = vec3(0.2, 0.18, 0.16).mul(lit).mul(dens).mul(S.mul(1.7));
        acc.addAssign(trans.mul(em.add(sootCol)).mul(dz));
        trans.mulAssign(exp(sigma.mul(dz).mul(-1.4)));
      }
      const fade = float(1.0).sub(smoothstep(0.7, 1.0, ageN));
      const edge = float(1.0).sub(smoothstep(0.8, 1.0, sqrt(r2)));
      const a = float(1.0).sub(trans).mul(fade).mul(edge);
      return vec4(acc.mul(fade).mul(edge).mul(U.gain), a);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'RocketFireballs';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  /**
   * Kula ognia (ŚWIAT gry): (x, y), z sceny, Rmax [j.], życie [s], żar 0..1+, sadza 0..1,
   * nośnik (cx, cy — świat), jasność, rodzaj; czas narodzin z zegara reżysera.
   */
  add(time, x, y, z, rMax, life, heat = 1, soot = 1, cx = 0, cy = 0, bright = 1, kind = 0) {
    let i = this.count;
    if (i >= this.capacity) {
      // Pełna pula: nadpisz najstarszą (jak `items.shift()` dema, bez alokacji).
      let oldest = 0;
      for (let k = 1; k < this.count; k++) if (this.t0[k] < this.t0[oldest]) oldest = k;
      i = oldest;
    } else {
      this.count++;
    }
    this.x[i] = x; this.y[i] = y; this.cx[i] = cx; this.cy[i] = cy; this.t0[i] = time;
    const o = i * 8;
    const F = this.f;
    F[o] = z; F[o + 1] = rMax; F[o + 2] = life; F[o + 3] = heat;
    F[o + 4] = soot; F[o + 5] = bright; F[o + 6] = kind; F[o + 7] = this.rng.next();
  }

  _remove(i) {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last];
    this.cx[i] = this.cx[last]; this.cy[i] = this.cy[last];
    this.t0[i] = this.t0[last];
    const F = this.f;
    for (let k = 0; k < 8; k++) F[i * 8 + k] = F[last * 8 + k];
  }

  /** Zdejmuje wygasłe (zegar reżysera). */
  expire(time) {
    for (let i = this.count - 1; i >= 0; i--) {
      if (time - this.t0[i] >= this.f[i * 8 + 2]) this._remove(i);
    }
  }

  /** Instancje tej klatki względem początku pul (ox, oy — układ sceny). */
  update(time, ox, oy) {
    this.U.time.value = time;
    this.expire(time);
    const n = this.count;
    const F0 = this.f0.array; const F1 = this.f1.array; const F2 = this.f2.array;
    const F = this.f;
    for (let i = 0; i < n; i++) {
      const o8 = i * 8;
      const life = F[o8 + 2];
      const age = Math.max(0, time - this.t0[i]);
      // Szybki wzrost, potem powolne rozprężanie.
      const R = F[o8 + 1] * ((1 - Math.exp(-age / 0.085)) * 0.82 + Math.min(1, age / life) * 0.3 + 0.04);
      const wx = this.x[i] + this.cx[i] * age;
      const wy = this.y[i] + this.cy[i] * age;
      const o = i * 4;
      F0[o] = wx - ox; F0[o + 1] = -wy - oy; F0[o + 2] = F[o8]; F0[o + 3] = R;
      F1[o] = age; F1[o + 1] = life; F1[o + 2] = F[o8 + 7]; F1[o + 3] = F[o8 + 3];
      F2[o] = F[o8 + 4]; F2[o + 1] = 1.0; F2[o + 2] = F[o8 + 5]; F2[o + 3] = F[o8 + 6];
    }
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

  clear() {
    this.count = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }
}
