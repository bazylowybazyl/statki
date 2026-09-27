// dema/rakiety-webgpu/fireballs.js
//
// KULA OGNIA wybuchu głowicy — objętość liczona marszem promienia (TSL) na
// kwadzie nad punktem wybuchu. Widok z góry, kamera ortho: promień idzie po
// −Z przez kulę jednostkową, 18 próbek. W próbce:
//   • gęstość: kula z brzegiem zaburzonym szumem 3D (tekstura, 2 oktawy,
//     płynie z czasem — kłęby się przewalają), promień rośnie szybko
//     (1 − e^(−t/τ)) i dalej powoli;
//   • temperatura: gorący środek, stygnie z czasem i ku brzegowi (szum
//     przesuwa granicę — języki ognia); barwa z rampy ciała czarnego;
//   • sadza: pochłanianie rośnie z wiekiem (świeża kula świeci, starsza dymi),
//     oświetlona słońcem od strony, z której pada (normalna ≈ kierunek od
//     środka) i żarem od środka.
// Całka od przodu do tyłu, wyjście premultiplied (barwa, 1 − transmitancja).
// Pasma HDR: środek świeżej kuli 4–8 (mały, krótki), ciało 0,5–1,3.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, uv, varyingProperty, positionGeometry, texture3D,
  mix, smoothstep, clamp, exp, max, min, sqrt, dot, length, normalize, Discard, If
} from 'three/tsl';

export const FIREBALL_CAP = 128;
const STEPS = 18;

export class FireballSystem {
  constructor({ scene, noise3D, capacity = FIREBALL_CAP, renderOrder = 40 }) {
    this.capacity = capacity;
    this.items = [];
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
    const mk = () => {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.f0 = mk(); this.f1 = mk(); this.f2 = mk();
    geo.setAttribute('fb0', this.f0); // środek xyz (scena), promień bieżący
    geo.setAttribute('fb1', this.f1); // wiek, życie, ziarno, żar 0..1
    geo.setAttribute('fb2', this.f2); // sadza 0..1, rozmiar kwadu (× promień), jasność, rodzaj
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const vA = varyingProperty('vec4', 'vFbA'); // q.xy (jednostki promienia), wiek, życie
    const vB = varyingProperty('vec4', 'vFbB'); // ziarno, żar, sadza, jasność
    const vC = varyingProperty('vec4', 'vFbC'); // rodzaj
    const mat = new THREE.NodeMaterial();
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
      vC.assign(vec4(C.w, 0.0, 0.0, 0.0));
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
      const kind = vC.x;
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
      const sunL = U.sunCol.mul(U.sunGain);
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
    this.mesh.name = 'fireballs';
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * Kula ognia (świat → scena liczy wołający): (x, y, z) scena, Rmax [j.],
   * życie [s], żar 0..1+, sadza 0..1, nośnik (cx, cy) scena.
   */
  add(time, x, y, z, rMax, life, heat = 1, soot = 1, cx = 0, cy = 0, bright = 1, kind = 0) {
    if (this.items.length >= this.capacity) this.items.shift();
    this.items.push({ t0: time, x, y, z, rMax, life, heat, soot, cx, cy, bright, kind, seed: Math.random() });
  }

  update(time) {
    this.U.time.value = time;
    this.items = this.items.filter((f) => time - f.t0 < f.life);
    const n = this.items.length;
    const F0 = this.f0.array; const F1 = this.f1.array; const F2 = this.f2.array;
    for (let i = 0; i < n; i++) {
      const f = this.items[i];
      const age = Math.max(0, time - f.t0);
      // Szybki wzrost, potem powolne rozprężanie.
      const R = f.rMax * ((1 - Math.exp(-age / 0.085)) * 0.82 + Math.min(1, age / f.life) * 0.3 + 0.04);
      const o = i * 4;
      F0[o] = f.x + f.cx * age; F0[o + 1] = f.y + f.cy * age; F0[o + 2] = f.z; F0[o + 3] = R;
      F1[o] = age; F1[o + 1] = f.life; F1[o + 2] = f.seed; F1[o + 3] = f.heat;
      F2[o] = f.soot; F2[o + 1] = 1.0; F2[o + 2] = f.bright; F2[o + 3] = f.kind;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    for (const at of [this.f0, this.f1, this.f2]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
  }
}
