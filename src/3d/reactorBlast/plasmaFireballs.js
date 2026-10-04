// src/3d/reactorBlast/plasmaFireballs.js
//
// KULA PLAZMY wybuchu reaktora — objętość liczona marszem promienia (TSL) na kwadzie nad
// punktem wybuchu (widok z góry, kamera ortho: promień po −Z przez kulę jednostkową, STEPS
// próbek). Rozwinięcie kuli ognia rakiet (src/3d/rockets/fireballs.js) o to, czego wybuch
// reaktora potrzebuje, a głowica nie:
//   • DWA ośrodki w jednej objętości: PLAZMA z komory (barwa frakcji, biały rdzeń tylko przez
//     pierwsze ~0,15 s, gaśnie w ~0,25 s) i OGIEŃ rozerwanego kadłuba (rampa ciała czarnego,
//     stygnie w ~1,5 s) — detonacja przechodzi z plazmy w ogień, a potem w sadzę;
//   • zwichrowanie przestrzeni szumu (domain warp) — kłęby i języki zamiast gładkiej kuli,
//     siła rośnie z wiekiem (świeży wybuch zwarty, stary się przewala);
//   • SADZA i opary metalu narastają od powłoki do środka, oświetlone słońcem gry (maska
//     cienia słońca) i żarem od środka;
//   • rodzaj 1 = KULA (wariant „kula plazmy”): podtrzymana plazma z wirującą powierzchnią
//     i ostrzejszym brzegiem, bez ognia i sadzy — wołający przesuwa ją co klatkę.
// Wyjście premultiplied (barwa, 1 − transmitancja): sadza przysłania kadłub pod spodem.
//
// Pasma HDR (próg bloomu 0,9 bramkuje pełną wartością, ACES bieli > ~1,5):
//   biały rdzeń świeżej plazmy 6–12 na małym polu i tylko przez chwilę, ciało plazmy w barwie
//   0,6–1,3, ogień 0,5–1,6 (najgorętsze języki lekko przez próg — wybuch ma świecić), sadza
//   oświetlona ≤ 0,5.
//
// Pula przepisywana co klatkę (begin → push … → commit) z rekordów reżysera — pozycje LOKALNIE
// względem początku pul Core3D (mesh.position = początek, highPrecision składa macierz w
// double). Bufory wierzchołków: pozycja, uv + 4 atrybuty instancji = 6 (limit 8).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec4, uniform, attribute, varyingProperty, positionGeometry, texture3D,
  mix, smoothstep, clamp, exp, max, min, sqrt, dot, length, cos, sin, step, Discard, If
} from 'three/tsl';
import { sunVisibility } from '../sunShadowMask.js';

export const PLASMA_FIREBALL_CAP = 128;
export const PLASMA_KIND_BLAST = 0;
export const PLASMA_KIND_ORB = 1;
const STEPS = 22;
// Kwad sięga PAD promieni kuli: szum wypycha płaty poza nominalną kulę (bez zapasu obrys był
// zawsze okręgiem kwadu — bryły i sadza wyglądały jak gładkie kule). Koszt: PAD² fragmentów.
const PAD = 1.3;

function liveAttr(capacity) {
  const at = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const range = { start: 0, count: 4 };
  at.updateRanges.length = 0;
  at.updateRanges.push(range);
  at.clearUpdateRanges = () => {};
  at.__range = range;
  return at;
}

export class PlasmaFireballSystem {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Data3DTexture} o.noise3D szum 3D (fxNoise.noise3D)
   * @param {number} [o.capacity]
   * @param {number} [o.renderOrder] po kulach ognia rakiet (40), przed iskrami (60)
   */
  constructor({ scene, noise3D, capacity = PLASMA_FIREBALL_CAP, renderOrder = 44 }) {
    this.capacity = capacity;
    this.count = 0;
    // Wpis roboczy (push): pola wypełnia wołający — bez liczb w argumentach pętli klatki.
    this.s = {
      x: 0, y: 0, z: 0, R: 0, age: 0, life: 1, seed: 0, heat: 1, soot: 1, plasma: 1,
      bright: 1, kind: PLASMA_KIND_BLAST, warp: 0.35, r: 1, g: 1, b: 1
    };
    this.U = {
      time: uniform(0),
      sunDir: uniform(new THREE.Vector3(-0.6, 0.5, 0.62).normalize()),
      sunCol: uniform(new THREE.Vector3(1.0, 0.95, 0.88)),
      sunGain: uniform(0.55),
      ambient: uniform(new THREE.Vector3(0.05, 0.058, 0.075)),
      gain: uniform(1)
    };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.a0 = liveAttr(capacity); this.a1 = liveAttr(capacity); this.a2 = liveAttr(capacity); this.a3 = liveAttr(capacity);
    this._attrs = [this.a0, this.a1, this.a2, this.a3];
    geo.setAttribute('pf0', this.a0); // środek xyz (lokalnie), promień
    geo.setAttribute('pf1', this.a1); // wiek, życie, ziarno, żar ognia 0..1
    geo.setAttribute('pf2', this.a2); // sadza, plazma, jasność, rodzaj
    geo.setAttribute('pf3', this.a3); // barwa plazmy (rgb, maks. kanał 1), zwichrowanie
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const vA = varyingProperty('vec4', 'vRbPfA'); // q.xy, wiek, życie
    const vB = varyingProperty('vec4', 'vRbPfB'); // ziarno, żar, sadza, plazma
    const vC = varyingProperty('vec4', 'vRbPfC'); // jasność, rodzaj, zwichrowanie, —
    const vCol = varyingProperty('vec3', 'vRbPfCol');
    const mat = new THREE.NodeMaterial();
    mat.name = 'ReactorPlasmaFireball';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const A = attribute('pf0', 'vec4');
      const B = attribute('pf1', 'vec4');
      const C = attribute('pf2', 'vec4');
      const E = attribute('pf3', 'vec4');
      const q = positionGeometry.xy.mul(2.0);
      vA.assign(vec4(q, B.x, B.y));
      vB.assign(vec4(B.z, B.w, C.x, C.y));
      vC.assign(vec4(C.z, C.w, E.w, 0.0));
      vCol.assign(E.xyz);
      return vec3(A.xy.add(q.mul(A.w.mul(PAD))), A.z);
    })();

    // Rampa ciała czarnego (T 0..1): czerwień → pomarańcz → żółć → biel HDR (jak kule ognia rakiet,
    // szczyt niższy: ogień reaktora dzieli objętość z plazmą).
    const blackbody = (T) => {
      const t = clamp(T, 0.0, 1.2);
      const c1 = mix(vec3(0.0), vec3(0.55, 0.06, 0.012), smoothstep(0.02, 0.25, t));
      const c2 = mix(c1, vec3(1.0, 0.33, 0.05), smoothstep(0.22, 0.5, t));
      const c3 = mix(c2, vec3(1.0, 0.72, 0.28), smoothstep(0.45, 0.78, t));
      const c4 = mix(c3, vec3(1.0, 0.94, 0.82), smoothstep(0.72, 0.95, t));
      return c4.mul(smoothstep(0.8, 1.15, t).mul(1.5).add(1.0));
    };

    mat.fragmentNode = Fn(() => {
      const q = vA.xy.toVar();
      const r2 = dot(q, q).toVar();
      If(r2.greaterThan(1.0), () => { Discard(); });
      const age = vA.z;
      const life = vA.w;
      const seed = vB.x;
      const heat0 = vB.y;
      const soot0 = vB.z;
      const plasma0 = vB.w;
      const bright = vC.x;
      const orb = step(0.5, vC.y).toVar();
      const warpAmt = vC.z;
      const pcol = vCol;
      const ageN = clamp(age.div(max(life, 1e-3)), 0.0, 1.0).toVar();
      // Promień przez kulę kwadu (promień PAD w jednostkach nominalnej kuli).
      const qs = q.mul(PAD).toVar();
      const zIn = sqrt(max(float(1.0).sub(r2), 0.0)).mul(PAD).toVar();
      const dz = zIn.mul(2.0 / STEPS).toVar();
      const off = vec3(seed.mul(7.31), seed.mul(3.17), seed.mul(5.53)).toVar();
      const flow = vec3(0.0, 0.0, age.mul(0.5)).toVar();
      // Kula: TORUS plazmy (jak rdzeń, z którego wypadł) wiruje — obrót różnicowy, środek
      // szybciej niż brzeg (skręcone włókna zamiast obracającej się tarczy); bez ognia i sadzy.
      const spinA = orb.mul(age.mul(float(7.0).sub(r2.mul(3.5))).add(seed.mul(6.0)));
      const ca = cos(spinA).toVar();
      const sa = sin(spinA).toVar();
      // Plazma: biały błysk i barwa frakcji gasną szybko (kula: podtrzymana).
      const whiteAmt = plasma0.mul(mix(exp(age.div(-0.07)), float(0.55), orb)).toVar();
      // Barwa frakcji trzyma się dłużej (wolna składowa ~1,1 s) — w ogniu zostają włókna plazmy.
      const plasmaAmt = plasma0.mul(mix(exp(age.div(-0.24)).mul(0.66).add(exp(age.div(-1.1)).mul(0.34)), float(1.0), orb)).toVar();
      // Ogień wchodzi, gdy plazma gaśnie (pierwsze ~0,1 s to czysta plazma z komory).
      const fireAmt = heat0.mul(exp(age.div(-0.5)).mul(0.6).add(exp(age.div(-1.6)).mul(0.4)))
        .mul(smoothstep(0.02, 0.18, age)).mul(float(1.0).sub(smoothstep(0.55, 1.0, ageN))).mul(float(1.0).sub(orb)).toVar();
      const sootAmt = soot0.mul(smoothstep(0.06, 0.5, ageN)).mul(float(1.0).sub(orb)).toVar();
      const coreR = mix(float(1.05), float(0.4), ageN).toVar();
      const edgeLo = mix(float(0.6), float(0.84), orb).toVar();
      // Nierówność brzegu rośnie z wiekiem (kłęby się przewalają), kula plazmy — gładka.
      const rough = mix(ageN.mul(0.3).add(0.62), float(0.2), orb).toVar();
      const sunL = U.sunCol.mul(U.sunGain).mul(sunVisibility()).toVar();
      const acc = vec3(0.0).toVar();
      const trans = float(1.0).toVar();
      for (let i = 0; i < STEPS; i++) {
        const z = zIn.sub(dz.mul(i + 0.5));
        const p = vec3(qs, z).toVar();
        const pr = vec3(p.x.mul(ca).sub(p.y.mul(sa)), p.x.mul(sa).add(p.y.mul(ca)), p.z);
        const w = texture3D(noise3D, pr.mul(0.75).add(off).add(flow.mul(0.6))).level(0).xy;
        const pw = pr.add(vec3(w.x.sub(0.5), w.y.sub(0.5), w.x.add(w.y).sub(1.0).mul(0.5)).mul(warpAmt));
        const n1 = texture3D(noise3D, pw.mul(1.2).add(off).add(flow)).level(0).x;
        const n2 = texture3D(noise3D, pw.mul(2.7).add(off.mul(1.7)).sub(flow.mul(1.3))).level(0).y;
        const n = n1.mul(0.62).add(n2.mul(0.38)).toVar();
        const r = length(p);
        const rd = r.add(n.sub(0.5).mul(rough)).toVar();
        // Z wiekiem wybuch rwie się na kłęby (próg szumu rośnie) — bez tego stara sadza była
        // czarną kulą o gładkim obrysie; kula plazmy (orb) się nie rwie.
        const tear = mix(smoothstep(ageN.mul(0.8).sub(0.1), ageN.mul(0.8).add(0.15), n), float(1.0), orb);
        const dens = float(1.0).sub(smoothstep(edgeLo, 1.0, rd)).mul(tear).toVar();
        // Plazma wybuchu: skupiona w środku, włókna z szumu (kontrast — nie jednolity dysk).
        const Pb = plasmaAmt.mul(float(1.0).sub(smoothstep(0.05, 0.8, rd.mul(n.mul(0.5).add(0.75)))))
          .mul(n.mul(1.3).add(0.35));
        // Plazma kuli: rura torusa w płaszczyźnie gry (promień 0,52, rura 0,26, brzeg z szumu —
        // wiruje z obrotem pr) i słaba powłoka kuli wokół.
        const tor = length(vec3(length(pr.xy).sub(0.52), pr.z, 0.0)).sub(0.26).add(n.sub(0.5).mul(0.24)).toVar();
        const Po = plasmaAmt.mul(float(1.0).sub(smoothstep(-0.12, 0.1, tor)).mul(n.mul(0.9).add(0.55))
          .add(float(1.0).sub(smoothstep(0.2, 0.95, rd)).mul(0.2)));
        const P = mix(Pb, Po, orb).toVar();
        // Całka po cięciwie (do 2 promieni): ciało plazmy w barwie frakcji pod progiem bloomu,
        // biały rdzeń — osobny człon: środek (≤ 1/3 promienia) i tylko przez pierwsze ~0,1 s
        // (kula: stała nić w osi rury torusa).
        const W = mix(whiteAmt.mul(float(1.0).sub(smoothstep(0.0, 0.34, rd))),
          whiteAmt.mul(1.65).mul(float(1.0).sub(smoothstep(-0.24, -0.08, tor))), orb).toVar();
        const emP = pcol.mul(P.mul(0.66)).add(vec3(1.0, 0.97, 0.95).mul(W.mul(W).mul(3.6)));
        // Ogień: gorący środek, języki z szumu, stygnie do brzegu i z czasem.
        const Tf = fireAmt.mul(float(1.0).sub(smoothstep(coreR.mul(0.2), coreR, rd.mul(n.mul(0.6).add(0.7))))).toVar();
        const S = sootAmt.mul(smoothstep(0.28, 0.95, rd.add(n.sub(0.5).mul(0.9)).add(ageN.mul(0.35)))).toVar();
        const em = emP.add(blackbody(Tf).mul(0.46)).mul(dens).mul(float(1.0).sub(S.mul(0.85))).mul(bright);
        const sigma = dens.mul(S.mul(1.15).add(0.3).add(P.mul(0.15)));
        // Sadza: słońce od strony normalnej, otoczenie, żar i plazma od środka.
        const nv = p.add(vec3(n.sub(0.5).mul(0.8))).add(vec3(0.0, 0.0, 0.02));
        const nrm = nv.div(max(length(nv), 1e-3));
        const lit = sunL.mul(clamp(dot(nrm, U.sunDir).mul(0.6).add(0.4), 0.0, 1.0)).add(U.ambient)
          .add(blackbody(Tf.mul(1.3)).mul(0.35)).add(pcol.mul(P.mul(0.3)));
        const sootCol = vec3(0.26, 0.25, 0.24).mul(lit).mul(dens).mul(S.mul(1.7));
        acc.addAssign(trans.mul(em.add(sootCol)).mul(dz));
        trans.mulAssign(exp(sigma.mul(dz).mul(-1.4)));
      }
      const fade = mix(float(1.0).sub(smoothstep(0.55, 1.0, ageN)), float(1.0), orb);
      const edge = float(1.0).sub(smoothstep(0.9, 1.0, sqrt(r2)));
      const a = float(1.0).sub(trans).mul(fade).mul(edge);
      return vec4(max(acc.mul(fade).mul(edge).mul(U.gain), vec3(0.0)), min(a, 1.0));
    })();
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'ReactorPlasmaFireballs';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  /** Kula z wpisu roboczego `s` (LOKALNIE względem początku pul). */
  push() {
    if (this.count >= this.capacity) return;
    const s = this.s;
    if (!(s.R > 0)) return;
    const i = this.count++;
    const o = i * 4;
    const A0 = this.a0.array, A1 = this.a1.array, A2 = this.a2.array, A3 = this.a3.array;
    A0[o] = s.x; A0[o + 1] = s.y; A0[o + 2] = s.z; A0[o + 3] = s.R;
    A1[o] = s.age; A1[o + 1] = s.life; A1[o + 2] = s.seed; A1[o + 3] = s.heat;
    A2[o] = s.soot; A2[o + 1] = s.plasma; A2[o + 2] = s.bright; A2[o + 3] = s.kind;
    A3[o] = s.r; A3[o + 1] = s.g; A3[o + 2] = s.b; A3[o + 3] = s.warp;
  }

  commit(time, ox, oy) {
    this.U.time.value = time;
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
