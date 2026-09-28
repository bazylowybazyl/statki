// src/3d/warp/medium.js
//
// OŚRODEK — nośnik efektu warpa „Nurt” (port 1:1 z dema: dema/warp-webgpu/medium.js;
// opis techniki: docs/webgpu/DEMO-WARP.md). Miliony drobin materii międzyplanetarnej
// (gaz, pył) liczone na GPU (compute). Bańki warpa NIE rysujemy: widać ją po tym, co robi
// z ośrodkiem, jak w wizualizacji metryki Alcubierre'a (czas Yorka: przed statkiem
// przestrzeń się kurczy, za nim rozszerza), ale bez siatki — zamiast linii siatki są strugi.
//
// Pola bańki (układ bańki: oś x = kurs, elipsoida a = R·asp wzdłuż, R w poprzek):
//   • OPŁYW — przepływ potencjalny wokół kuli (w układzie rozciągniętym do kuli);
//   • NAPRĘŻENIE (York): przy ścianie z przodu ściśnięcie (turkus), z tyłu rozrzedzenie
//     (pomarańcz), dryf zerowy przy samej ścianie (bez obrysu). Przy ŁADOWANIU (bańka
//     stoi) świecą oba płaty; w LOCIE czoło jest ciemne, światło niesie talia (zapłon
//     drobin przy ścianie) i tył pasa (pomarańczowy warkocz);
//   • KIESZEŃ — wnętrze bańki to płaska przestrzeń jadąca ze statkiem (nie świeci);
//   • ZAWIROWANIA — za bańką pole wirowe unoszone z przepływem;
//   • WYRZUT / WYDECH — jednorazowe pchnięcia ośrodka przed / za bańką.
// Przegródka może mieć A = 0 i służyć za NIĆ ZWIASTUNA (heraldLen) z PUNKTEM ZBIERANIA
// (pullR / pullGain). TUNEL (szczeliny, osobne przegródki): ośrodek rozsuwa się od osi
// szczeliny, w otwarciu świeci i płynie wzdłuż niej.
//
// W GRZE (różnice względem dema):
//   • układ: współrzędne sceny (x w prawo, y w górę, z do kamery) WZGLĘDEM KAMERY OŚRODKA —
//     sterownik (warpNurt.js) podaje przesunięcie kamery na krok (`shift`), a siatka stoi w
//     kamerze gry (mesh.position) i rzutuje się `modelViewMatrix` (highPrecision — double na
//     CPU, świat przy 5–10 mln j. bez drżenia); `offset` = kamera ośrodka − kamera gry
//     w chwili renderu (pauza, dosunięcie między krokami);
//   • wszystkie przegródki i szczeliny w JEDNYM buforze uniformów (limit 12 na etap):
//     16 × 5 vec4 baniek + 8 × 2 vec4 szczelin;
//   • pass PERSPEKTYWICZNY Core3D na warstwie WARP_MEDIUM_LAYER (8), po planetach, przed
//     passem ortho (Core3D.renderPassWarp) — rysowany tylko, gdy sterownik zgłosi aktywność;
//   • liczba drobin z budżetu gry (domyślnie 1 mln — DEMO-WARP § Do portu), pudło populacji
//     idzie za zoomem kamery (gęstość na ekranie stała).
// Krok stały (1/240 s) — sterownik, render dosuwa drobiny o `lag` (czas od ostatniego kroku).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray,
  instanceIndex, hash, Loop, If, Return, select, mix, smoothstep, clamp, floor, abs,
  exp, sin, cos, sqrt, min, max, dot, length, normalize, positionGeometry,
  cameraProjectionMatrix, modelViewMatrix, varyingProperty, mx_noise_float
} from 'three/tsl';

export const MEDIUM_CAP = 1 << 20;
export const MEDIUM_COUNT_DEFAULT = 1000000;
export const BUBBLE_CAP = 16;
export const SEAM_CAP = 8;
/** Warstwa ośrodka w Core3D (8 — wolna od portu dla nowego warpa; 9 = tło menu, 10 = DIST). */
export const WARP_MEDIUM_LAYER = 8;
// Układ bloku przegródek: bańka k → 5 vec4 od k·5, szczelina j → 2 vec4 od SLOT_SEAM_BASE + j·2.
const SLOT_BUBBLE_STRIDE = 5;
const SLOT_SEAM_BASE = BUBBLE_CAP * SLOT_BUBBLE_STRIDE;
const SLOT_VEC4 = SLOT_SEAM_BASE + SEAM_CAP * 2;

export const MEDIUM_DEFAULTS = Object.freeze({
  nearShare: 0.72,
  nearZ: 1500,            // [j.] głębokość populacji bliskiej (≈ 1,3 R Atlasa)
  deepZ: 26000,           // [j.] dno populacji głębokiej
  damping: 0.9,           // [1/s] swobodna drobina wraca do spoczynku
  quadDrag: 0.00002,      // [1/j.] opór kwadratowy (pchnięcia hamują)
  decay: 1.1,             // [s] czas gaśnięcia wzbudzenia
  tagRate: 5.0,
  bandW: 0.27,            // szerokość pasa naprężenia (× R, na zewnątrz ściany)
  bandSpeed: 5000,        // [j/s] powyżej tej prędkości bańki pas naprężenia gaśnie (lot)
  cloudScale: 1 / 21000,  // skala obłoków gęstości ośrodka
  cloudBase: 0.18,
  // Render
  eGain: 0.22,
  streamGlow: 0.09,       // poświata rzadkich drobin w ruchu (× warpVis)
  streamShare: 0.16,      // udział drobin, które ją mają (reszta tylko wzbudzenie)
  hazeShare: 0.45,        // udział mgiełki: miękkie, szersze plamy (objętość płatów)
  hazeGain: 0.3,
  hazeSize: 22,           // [j.] pół-szerokość plamy mgiełki (× 1…2,8)
  bright: 1.0,
  widthPx: 1.05,          // pół-szerokość smugi [px]
  maxLenPx: 520,
  normPx: 26,             // długość, powyżej której smuga ciemnieje (energia rozłożona)
  shutter: 1 / 60
});

/**
 * Udział drobin wybieranych do przeniesienia w nowy pas pudła, gdy jego pole rośnie r razy
 * (oddalenie kamery). Równa gęstość wymaga przeniesienia f = 1 − 1/r drobin; przeniesienie
 * udaje się z szansą 1 − r⁻⁴ (4 losowania punktu w nowym pudle poza starym).
 */
export function growShare(r) {
  if (!(r > 1.0005)) return 0;
  const f = 1 - 1 / r;
  return Math.min(1, f / (1 - Math.pow(r, -4)));
}

export class WarpMedium {
  /** @param {{ count?: number }} [o] */
  constructor(o = {}) {
    this.cfg = { ...MEDIUM_DEFAULTS };
    this.capacity = Math.max(2, Math.min(MEDIUM_CAP, Math.floor(Number(o.count) || MEDIUM_COUNT_DEFAULT)));
    this.count = 0;
    this.fade = 0;
    this.stats = { steps: 0 };
    this._seed = 1;
    this._stepSeed = 1;
    this.initialized = false;

    const cap = this.capacity;
    this.pos = instancedArray(cap, 'vec4').setName('warpMedPos');   // xyz (kamera ośrodka), w ziarno
    this.vel = instancedArray(cap, 'vec4').setName('warpMedVel');   // xyz prędkość (świat), w wzbudzenie E
    this.aux = instancedArray(cap, 'vec4').setName('warpMedAux');   // x znacznik ±, y —, z gęstość, w wiek wylotu
    this.vis = instancedArray(cap, 'float').setName('warpMedVis');  // widoczność (kieszeń, krawędź rzutu)

    this.slots = uniformArray(Array.from({ length: SLOT_VEC4 }, () => new THREE.Vector4()), 'vec4').setName('warpMedSlots');
    this.U = {
      count: uniform(0, 'uint'),
      nearCount: uniform(0, 'uint'),
      initStart: uniform(0, 'uint'),
      initCount: uniform(0, 'uint'),
      seedBase: uniform(0, 'uint'),
      stepSeed: uniform(0, 'uint'),
      dt: uniform(1 / 240),
      time: uniform(0),
      shift: uniform(new THREE.Vector3()),
      boxNear: uniform(new THREE.Vector4(16000, 9000, -1500, 0)),
      boxDeep: uniform(new THREE.Vector4(30000, 17000, -26000, -1500)),
      // Przyrost pudeł w tej klatce: (udział bliskich, udział głębokich) i stare pół-wymiary.
      grow: uniform(new THREE.Vector2()),
      boxNearOld: uniform(new THREE.Vector2()),
      boxDeepOld: uniform(new THREE.Vector2()),
      dampK: uniform(0),
      quadDrag: uniform(this.cfg.quadDrag),
      decayK: uniform(1),
      fadeK: uniform(1),    // dodatkowe gaszenie wszystkich drobin (wyjście z warpa)
      tagRate: uniform(this.cfg.tagRate),
      bandW: uniform(this.cfg.bandW),
      bandSpeed: uniform(this.cfg.bandSpeed),
      cloudOrigin: uniform(new THREE.Vector2()),
      cloudScale: uniform(this.cfg.cloudScale),
      cloudBase: uniform(this.cfg.cloudBase),
      bCount: uniform(0, 'int'),
      sCount: uniform(0, 'int'),
      // Render
      camVel: uniform(new THREE.Vector3()),
      offset: uniform(new THREE.Vector3()),
      lag: uniform(0),
      shutter: uniform(this.cfg.shutter),
      viewHalfPx: uniform(new THREE.Vector2(960, 540)),
      maxLenPx: uniform(this.cfg.maxLenPx),
      zoom: uniform(0.1),
      camZ: uniform(17000),
      eGain: uniform(this.cfg.eGain),
      streamGlow: uniform(this.cfg.streamGlow),
      streamShare: uniform(this.cfg.streamShare),
      hazeShare: uniform(this.cfg.hazeShare),
      hazeGain: uniform(this.cfg.hazeGain),
      hazeSize: uniform(this.cfg.hazeSize),
      warpVis: uniform(0),
      bright: uniform(this.cfg.bright),
      widthPx: uniform(this.cfg.widthPx),
      normPx: uniform(this.cfg.normPx),
      colCyan: uniform(new THREE.Vector3(0.14, 0.7, 1.0)),
      colAmber: uniform(new THREE.Vector3(1.0, 0.36, 0.07)),
      colNeutral: uniform(new THREE.Vector3(0.4, 0.47, 0.62)),
      colHot: uniform(new THREE.Vector3(0.8, 0.92, 1.0))
    };
    this._emptySlots();
    this._buildCompute();
    this._buildRender();
  }

  // --- TSL -----------------------------------------------------------------

  /** Gęstość ośrodka w miejscu (obłoki) — liczona tylko przy narodzinach drobiny. */
  _cloud(xy, seed) {
    const U = this.U;
    const q = xy.add(U.cloudOrigin).mul(U.cloudScale);
    const n1 = mx_noise_float(vec3(q, 0.37));
    const n2 = mx_noise_float(vec3(q.mul(2.7).add(vec2(3.1, 7.7)), 1.9)).mul(0.5);
    const dens = smoothstep(-0.35, 0.65, n1.add(n2));
    const vary = seed.mul(7.13).fract().mul(0.8).add(0.6);
    return U.cloudBase.add(float(1.0).sub(U.cloudBase).mul(dens)).mul(vary);
  }

  _buildCompute() {
    const U = this.U;
    const S = this.slots;
    const pos = this.pos;
    const vel = this.vel;
    const aux = this.aux;
    const visB = this.vis;
    const cap = this.capacity;

    // Inicjalizacja zakresu [initStart, initStart + initCount).
    this.initNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.initCount), () => { Return(); });
      const i = instanceIndex.add(U.initStart).toVar();
      const s = i.add(U.seedBase.mul(uint(0x9E3779B1))).toVar();
      const h1 = hash(s);
      const h2 = hash(s.bitXor(uint(0x68E31DA4)));
      const h3 = hash(s.bitXor(uint(0xB5297A4D)));
      const h4 = hash(s.bitXor(uint(0x1B56C4E9)));
      const near = i.lessThan(U.nearCount);
      const box = select(near, U.boxNear, U.boxDeep).toVar();
      const p = vec3(
        h1.sub(0.5).mul(2.0).mul(box.x),
        h2.sub(0.5).mul(2.0).mul(box.y),
        mix(box.w, box.z, h3)
      ).toVar();
      pos.element(i).assign(vec4(p, h4));
      vel.element(i).assign(vec4(0.0));
      aux.element(i).assign(vec4(0.0, 0.0, this._cloud(p.xy, h4), 0.0));
      visB.element(i).assign(1.0);
    })().compute(cap).setName('warpMedInit');

    this.stepNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const i = instanceIndex;
      const P = pos.element(i).toVar();
      const Vv = vel.element(i).toVar();
      const Ax = aux.element(i).toVar();
      const p = P.xyz.sub(U.shift).toVar();
      const seed = P.w.toVar();
      const v = Vv.xyz.toVar();
      const E = Vv.w.toVar();
      const tag = Ax.x.toVar();
      const w = Ax.z.toVar();
      const jet = Ax.w.toVar();
      const vis = float(1.0).toVar();
      const dt = U.dt;
      const hs = hash(i.bitXor(uint(0x2545F491))).toVar();

      // Pudło urosło (kamera się oddaliła): część drobin przenosi się w nowy pas przy brzegu
      // (do 4 losowań punktu w nowym pudle poza starym) — gęstość na ekranie zostaje równa,
      // bez pustych brzegów. Tylko w pierwszym kroku klatki z przyrostem (poza nim U.grow = 0).
      If(U.grow.x.add(U.grow.y).greaterThan(0.0), () => {
        const nearG = i.lessThan(U.nearCount);
        const q = select(nearG, U.grow.x, U.grow.y);
        const bNew = select(nearG, U.boxNear, U.boxDeep).toVar();
        const bOld = select(nearG, U.boxNearOld, U.boxDeepOld).toVar();
        const gs = i.bitXor(U.stepSeed.mul(uint(0x85EBCA6B))).toVar();
        If(hash(gs.bitXor(uint(0x51ED270B))).lessThan(q), () => {
          const moved = float(0.0).toVar();
          for (const salt of [0x2C1B3C6D, 0x297A2D39, 0x68BC21EB, 0x02E5BE93]) {
            If(moved.lessThan(0.5), () => {
              const rx = hash(gs.bitXor(uint(salt))).sub(0.5).mul(2.0).mul(bNew.x).toVar();
              const ry = hash(gs.bitXor(uint((salt ^ 0x7FEB352D) >>> 0))).sub(0.5).mul(2.0).mul(bNew.y).toVar();
              If(abs(rx).greaterThan(bOld.x).or(abs(ry).greaterThan(bOld.y)), () => {
                const rz = mix(bNew.w, bNew.z, hash(gs.bitXor(uint((salt ^ 0x3C6EF372) >>> 0))));
                p.assign(vec3(rx, ry, rz));
                v.assign(vec3(0.0));
                E.assign(0.0);
                tag.assign(0.0);
                jet.assign(0.0);
                w.assign(this._cloud(p.xy, seed));
                moved.assign(1.0);
              });
            });
          }
        });
      });

      // Powrót do spoczynku + opór kwadratowy (pchnięcia hamują).
      v.subAssign(v.mul(U.dampK));
      v.subAssign(v.mul(min(length(v).mul(U.quadDrag).mul(dt), 0.5)));

      Loop({ start: int(0), end: U.bCount, type: 'int', condition: '<', name: 'bi' }, ({ bi }) => {
        const base = bi.mul(SLOT_BUBBLE_STRIDE).toVar();
        const A0 = S.element(base).toVar();
        const B0 = S.element(base.add(1)).toVar();
        const D0 = S.element(base.add(3)).toVar();
        const E0 = S.element(base.add(4)).toVar();
        const active = B0.z.greaterThan(0.001).or(E0.y.greaterThan(0.0)).or(D0.y.greaterThan(0.0)).or(D0.z.greaterThan(0.5)).or(E0.w.greaterThan(0.5));
        If(active, () => {
          const C0 = S.element(base.add(2)).toVar();
          const dx = A0.z;
          const dy = A0.w;
          const rx = p.x.sub(A0.x);
          const ry = p.y.sub(A0.y);
          const xl = rx.mul(dx).add(ry.mul(dy)).toVar();
          const yl = rx.mul(dy.negate()).add(ry.mul(dx)).toVar();
          const R = B0.x.toVar();
          const asp = B0.y.toVar();
          const aLen = R.mul(asp).toVar();

          // NIĆ ZWIASTUNA: prosta linia od B wzdłuż osi, długości heraldLen.
          If(E0.y.greaterThan(0.0).and(E0.x.greaterThan(1.0)), () => {
            If(xl.greaterThan(0.0).and(xl.lessThan(E0.x)), () => {
              const wh = R.mul(0.14).add(50.0);
              const r2 = yl.mul(yl).add(p.z.mul(p.z));
              const g = exp(r2.div(wh.mul(wh)).negate()).toVar();
              // smoothstep(E0.x, E0.x − 3wh, xl) z dema (krawędzie odwrócone) wzorem: 1 − smoothstep(e1, e0, x).
              const tip = float(1.0).sub(smoothstep(E0.x.sub(wh.mul(3.0)), E0.x, xl));
              E.addAssign(E0.y.mul(g).mul(tip).mul(dt).mul(2.4));
              tag.addAssign(float(1.0).sub(tag).mul(min(g.mul(dt).mul(6.0), 1.0)));
              // Zbieganie ku osi i spływ ku punktowi wyjścia.
              const pull = vec3(dy.mul(yl), dx.negate().mul(yl), p.z.negate()).mul(g.mul(1.6));
              const flow = vec3(dx, dy, 0.0).mul(E0.y.mul(g).mul(R.mul(0.9)));
              v.addAssign(pull.add(flow).sub(v.mul(g.mul(0.5))).mul(dt.mul(6.0)));
            });
          });
          // PUNKT ZBIERANIA na końcu nici (punkt wyjścia / skoku).
          If(D0.y.greaterThan(0.0), () => {
            const P0 = vec3(A0.x.add(dx.mul(E0.x)), A0.y.add(dy.mul(E0.x)), 0.0);
            const d3 = p.sub(P0).toVar();
            const dist = max(length(d3), 1.0).toVar();
            If(dist.lessThan(D0.x.mul(3.0)), () => {
              const rr = dist.div(D0.x);
              const g = exp(rr.mul(rr).negate()).toVar();
              const inward = d3.div(dist).negate();
              // Ściąganie po spirali (lekki wir) — ośrodek „zbierany” w punkt.
              const swirl = vec3(d3.y.negate(), d3.x, 0.0).div(dist).mul(0.35);
              v.addAssign(inward.add(swirl).mul(D0.x.mul(1.4).mul(D0.y).mul(g)).sub(v.mul(g.mul(D0.y).mul(1.5))).mul(dt.mul(4.0)));
              E.addAssign(g.mul(D0.y).mul(dt).mul(3.2));
              tag.addAssign(float(1.0).sub(tag).mul(min(g.mul(dt).mul(5.0), 1.0)));
            });
          });

          const q = vec3(xl.div(asp), yl, p.z).toVar();
          const rho = max(length(q), 1.0).toVar();
          If(rho.lessThan(R.mul(4.6)), () => {
            const n = q.div(rho).toVar();
            const gl = normalize(vec3(n.x.div(asp), n.y, n.z)).toVar();
            const nW = vec3(gl.x.mul(dx).sub(gl.y.mul(dy)), gl.x.mul(dy).add(gl.y.mul(dx)), gl.z).toVar();
            const s1 = rho.div(R).sub(1.0).toVar();
            // Front zapadania: przed nim pola bańki już nie ma.
            const Ab = B0.z.mul(float(1.0).sub(smoothstep(B0.w.sub(0.14), B0.w.add(0.14), xl.div(aLen)))).toVar();
            If(Ab.greaterThan(0.001), () => {
              const vB = vec3(C0.x, C0.y, 0.0).toVar();
              const vlx = C0.x.mul(dx).add(C0.y.mul(dy)).toVar();
              const vly = C0.x.mul(dy.negate()).add(C0.y.mul(dx)).toVar();
              const sp = length(vec2(vlx, vly)).toVar();
              // 1 = bańka stoi (ładowanie), 0 = lot.
              const still = float(1.0).sub(smoothstep(U.bandSpeed.mul(0.15), U.bandSpeed, sp)).toVar();
              If(s1.lessThan(0.0), () => {
                // KIESZEŃ: płaska przestrzeń jedzie z bańką, ośrodek w niej nie świeci.
                // W locie gaśnie też wzbudzenie z ładowania: drobiny w kieszeni stoją
                // względem statku (kropki zamiast smug) i przy ścianie układały się
                // w kropkowaną kopułę przed dziobem.
                v.assign(mix(v, vB, min(Ab, 1.0)));
                vis.assign(min(vis, mix(float(1.0), smoothstep(-0.16, 0.0, s1), Ab)));
                E.mulAssign(float(1.0).sub(min(float(1.0).sub(still).mul(Ab).mul(dt).mul(10.0), 1.0)));
              }).Else(() => {
                // OPŁYW: przepływ potencjalny wokół kuli (układ rozciągnięty).
                const Uq = vec3(vlx.negate().div(asp), vly.negate(), 0.0).toVar();
                const kr = R.div(rho);
                const k = kr.mul(kr).mul(kr).mul(0.5);
                const udq = Uq.sub(n.mul(dot(Uq, n).mul(3.0))).mul(k.mul(Ab)).toVar();
                const udl = vec3(udq.x.mul(asp), udq.y, udq.z).toVar();
                const ud = vec3(udl.x.mul(dx).sub(udl.y.mul(dy)), udl.x.mul(dy).add(udl.y.mul(dx)), udl.z).toVar();
                // NAPRĘŻENIE (York): łagodny dryf, zerowy przy samej ścianie.
                const g = s1.mul(exp(s1.mul(-2.5))).mul(2.7);
                const vStrain = nW.mul(n.x.mul(g).mul(C0.z).mul(R).mul(Ab).negate());
                // ZAWIROWANIA za bańką, unoszone z przepływem.
                const behind = float(1.0).sub(smoothstep(-0.55, 0.15, n.x));
                const ph = xl.add(sp.mul(U.time).mul(0.85)).div(R.mul(0.62)).toVar();
                const qy = yl.div(R.mul(0.55)).toVar();
                const qz = p.z.div(R.mul(0.55)).toVar();
                const a1 = ph.add(qy.mul(1.3));
                const a2 = ph.mul(0.7).sub(qy.mul(1.9)).add(1.7);
                const a3 = ph.mul(1.6).add(qz.mul(1.4)).add(4.1);
                const cy = cos(a1).mul(1.3).sub(cos(a2).mul(1.9)).add(cos(a3).mul(0.4));
                const cx = cos(a1).mul(-1.0).sub(cos(a2).mul(0.7)).sub(cos(a3).mul(1.6));
                const turbL = vec2(cy.mul(0.5), cx.negate().mul(0.5));
                const turbFall = exp(s1.mul(-0.85)).mul(behind).mul(C0.w).mul(sp).mul(Ab);
                const vT = vec3(turbL.x.mul(dx).sub(turbL.y.mul(dy)), turbL.x.mul(dy).add(turbL.y.mul(dx)), sin(a3).mul(0.25)).mul(turbFall);
                const vTarget = ud.add(vStrain).add(vT);
                // Sprzężenie: przy bańce drobina jest znacznikiem przepływu.
                const couple = Ab.mul(float(1.0).sub(smoothstep(0.6, 3.3, s1)));
                v.assign(mix(v, vTarget, min(couple, 1.0)));
                // Wzbudzenie jak w iteracji 1: pas naprężenia + przepływ przy bańce. W LOCIE
                // czoło jest ciemne — świeci od barków do tyłu: strugi wzdłuż boków i warkocz.
                const band = exp(s1.div(U.bandW).negate()).toVar();
                const c = n.x.mul(band).toVar();
                const moving = float(1.0).sub(still).toVar();
                const front = smoothstep(0.1, 0.4, n.x).mul(moving).toVar();
                const flowK = length(udl).div(max(sp, R.mul(0.2))).mul(exp(s1.div(0.36).negate()));
                E.addAssign(abs(c).mul(1.7).mul(float(1.0).sub(front)).add(flowK.mul(0.25).mul(still)).mul(Ab).mul(E0.z).mul(dt).mul(3.0));
                E.mulAssign(float(1.0).sub(min(front.mul(exp(s1.div(0.9).negate())).mul(dt).mul(8.0), 1.0)));
                // Strugi w locie: w talii część drobin ZAPALA się (E ≥ progu — talię mija w
                // ~0,03 s, całkowanie by nie nadążyło) i płynie wzdłuż konturu bańki
                // (linie od barków), za rufą przechodzi w pomarańczowy warkocz.
                const waist = float(1.0).sub(smoothstep(0.1, 0.45, n.x)).mul(smoothstep(-0.7, -0.2, n.x)).mul(exp(s1.div(0.15).negate())).mul(moving).toVar();
                const lineSel = select(hs.lessThan(0.4), float(1.0), float(0.08));
                const ign = waist.mul(lineSel).mul(Ab).mul(E0.z).toVar();
                E.assign(max(E, ign.mul(2.4)));
                tag.assign(mix(tag, float(1.0), min(ign.mul(1.5), 1.0)));
                tag.addAssign(clamp(c.mul(5.0), -1.0, 1.0).sub(tag).mul(min(abs(c).mul(float(1.0).sub(front)).mul(U.tagRate).mul(dt).mul(4.0), 1.0)));
                // Warkocz: rozrzedzona przestrzeń za bańką barwi ośrodek na pomarańcz.
                const behindK = float(1.0).sub(smoothstep(-0.75, -0.2, n.x)).mul(exp(s1.div(1.2).negate())).mul(Ab);
                tag.addAssign(float(-1.0).sub(tag).mul(min(behindK.mul(dt).mul(14.0), 1.0)));
                // Krawędź rzutu przygaszona (bez jasnego obrysu powłoki).
                const nearB = float(1.0).sub(smoothstep(0.35, 1.5, s1));
                vis.assign(min(vis, mix(float(1.0), abs(n.z).mul(0.7).add(0.3), nearB.mul(Ab))));
              });
            });
            // WYRZUT (np. okręt wypada z tunelu): ośrodek przed bańką dostaje pchnięcie do
            // przodu z rozrzutem — iskry lecą przed dziobem.
            If(D0.z.greaterThan(0.5).and(n.x.greaterThan(0.1)).and(s1.greaterThan(-0.2)), () => {
              const fall = float(1.0).sub(smoothstep(0.0, 2.4, s1)).mul(n.x).mul(hs.mul(0.8).add(0.2)).toVar();
              const r1 = hash(i.bitXor(uint(0x7F4A7C15))).mul(6.2832);
              const r2 = hash(i.bitXor(uint(0x3C6EF372))).mul(2.0).sub(1.0);
              const rs = sqrt(max(float(1.0).sub(r2.mul(r2)), 0.0));
              const scatter = vec3(rs.mul(cos(r1)), rs.mul(sin(r1)), r2.mul(0.4));
              v.addAssign(vec3(dx, dy, 0.0).mul(D0.w.mul(fall)).add(nW.mul(D0.w.mul(0.35).mul(fall))).add(scatter.mul(D0.w.mul(0.25).mul(fall))));
              E.addAssign(fall.mul(0.8));
              jet.assign(select(fall.greaterThan(0.25), float(0.0001), jet));
              tag.assign(mix(tag, float(1.0), fall));
            });
            // WYDECH tyłu: pomarańczowy obłok przy zamknięciu bańki.
            If(E0.w.greaterThan(0.5).and(n.x.lessThan(-0.05)).and(s1.greaterThan(-0.2)), () => {
              const fall = float(1.0).sub(smoothstep(0.0, 1.6, s1)).mul(n.x.negate()).mul(hs.mul(0.85).add(0.15));
              v.addAssign(nW.mul(R.mul(0.7).mul(fall)));
              E.addAssign(fall.mul(0.2));
              tag.assign(mix(tag, float(-1.0), fall));
            });
          });
        });
      });

      // TUNEL: ośrodek rozsuwa się od osi szczeliny, w jej środku płynie wzdłuż.
      Loop({ start: int(0), end: U.sCount, type: 'int', condition: '<', name: 'si' }, ({ si }) => {
        const sbase = si.mul(2).add(SLOT_SEAM_BASE).toVar();
        const S0 = S.element(sbase).toVar();
        const S1 = S.element(sbase.add(1)).toVar();
        const dx = S0.z;
        const dy = S0.w;
        const rx = p.x.sub(S0.x);
        const ry = p.y.sub(S0.y);
        const xl = rx.mul(dx).add(ry.mul(dy)).toVar();
        const yl = rx.mul(dy.negate()).add(ry.mul(dx)).toVar();
        If(abs(xl).lessThan(S1.x.mul(1.5)).and(abs(yl).lessThan(S1.y.mul(8.0).add(300.0))), () => {
          const tx = clamp(xl.div(max(S1.x, 1.0)), -1.0, 1.0);
          const wv = S1.y.mul(max(float(1.0).sub(tx.mul(tx)), 0.0)).toVar();
          const dperp = max(sqrt(yl.mul(yl).add(p.z.mul(p.z))), 1.0).toVar();
          const outW = vec3(dy.negate().mul(yl), dx.mul(yl), p.z).div(dperp);
          const ends = float(1.0).sub(smoothstep(1.0, 1.5, abs(xl).div(max(S1.x, 1.0))));
          const near = exp(max(dperp.sub(wv), 0.0).div(max(S1.y.mul(2.5), 40.0)).negate()).mul(ends).toVar();
          v.addAssign(outW.mul(S1.z.mul(near)).sub(v.mul(near.mul(0.5))).mul(dt.mul(5.0)));
          // Świeci tylko ośrodek w samym otwarciu — wypchnięty na boki zostaje ciemny.
          // smoothstep(wv·1,6 + 20, wv, d) z dema (krawędzie odwrócone) wzorem 1 − smoothstep(wv, wv·1,6 + 20, d).
          const mouth = float(1.0).sub(smoothstep(wv, wv.mul(1.6).add(20.0), dperp)).mul(ends);
          E.addAssign(mouth.mul(dt).mul(1.4));
          // Rozpychany ośrodek gaśnie: nić zwiastuna rozepchnięta od osi zostawiała świecącą
          // „puszkę” wokół okrętu jeszcze długo po zamknięciu szczeliny.
          E.mulAssign(float(1.0).sub(min(near.mul(float(1.0).sub(mouth)).mul(dt).mul(7.0), 1.0)));
          tag.addAssign(float(1.0).sub(tag).mul(min(mouth.mul(dt).mul(4.0), 1.0)));
          If(dperp.lessThan(wv), () => {
            v.assign(mix(v, vec3(dx, dy, 0.0).mul(S1.w), 0.25));
            E.addAssign(dt.mul(4.0));
          });
        });
      });

      p.addAssign(v.mul(dt));
      E.mulAssign(U.decayK.mul(U.fadeK));
      If(jet.greaterThan(0.0), () => { jet.addAssign(dt); });

      // Pudło populacji: drobina, która wyjdzie, rodzi się po drugiej stronie jako świeży,
      // niewzbudzony ośrodek w spoczynku.
      const near = i.lessThan(U.nearCount);
      const box = select(near, U.boxNear, U.boxDeep).toVar();
      If(abs(p.x).greaterThan(box.x).or(abs(p.y).greaterThan(box.y)).or(p.z.lessThan(box.z.sub(400.0))).or(p.z.greaterThan(10.0)), () => {
        const span = box.xy.mul(2.0);
        const wrapped = p.xy.sub(span.mul(floor(p.xy.add(box.xy).div(span)))).toVar();
        const zt = hash(i.bitXor(U.stepSeed));
        p.assign(vec3(wrapped, mix(box.w, box.z, zt)));
        v.assign(vec3(0.0));
        E.assign(0.0);
        tag.assign(0.0);
        jet.assign(0.0);
        w.assign(this._cloud(wrapped, seed));
      });

      pos.element(i).assign(vec4(p, seed));
      vel.element(i).assign(vec4(v, E));
      aux.element(i).assign(vec4(tag, 0.0, w, jet));
      visB.element(i).assign(vis);
    })().compute(cap).setName('warpMedStep');
  }

  _buildRender() {
    const U = this.U;
    const pos = this.pos;
    const vel = this.vel;
    const aux = this.aux;
    const visB = this.vis;
    const vCol = varyingProperty('vec3', 'vMedCol');
    const vAlong = varyingProperty('float', 'vMedAlong');
    const vSide = varyingProperty('float', 'vMedSide');
    const vLen = varyingProperty('float', 'vMedLen');
    const vW = varyingProperty('float', 'vMedW');

    const mat = new THREE.NodeMaterial();
    mat.name = 'warp:medium';
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
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;

    mat.vertexNode = Fn(() => {
      const i = instanceIndex;
      const P = pos.element(i).toVar();
      const Vv = vel.element(i).toVar();
      const Ax = aux.element(i).toVar();
      const vis = visB.element(i);
      const seed = P.w;
      const E = Vv.w;
      const tag = Ax.x;
      const w = Ax.z;
      const jetHot = select(Ax.w.greaterThan(0.0), exp(Ax.w.div(0.5).negate()), float(0.0)).toVar();
      // Pchnięte drobiny rozjaśniają się przez 0,18 s: w pierwszej chwili tysiące smug startują
      // z jednego miejsca i nałożone zalewałyby bloomem ekran.
      const jetFade = select(Ax.w.greaterThan(0.0), smoothstep(0.0, 0.18, Ax.w), float(1.0)).toVar();
      // Rodzaj: MGIEŁKA (miękka, szersza plama — objętość płatów i warkocza) albo ISKRA
      // (cienka smuga). Pchnięte drobiny zawsze iskrami.
      const hazeF = select(seed.mul(13.7).fract().lessThan(U.hazeShare).and(jetHot.lessThan(0.05)), float(1.0), float(0.0)).toVar();
      // Ruch względem kamery; dosunięcie o czas od ostatniego kroku; `offset` = kamera
      // ośrodka − kamera gry (siatka stoi w kamerze gry).
      const vr = Vv.xyz.sub(U.camVel).toVar();
      const head = P.xyz.add(Vv.xyz.mul(U.lag)).add(U.offset).toVar();
      // Mgiełka rozmyta ruchem słabiej niż iskry (okrągłe plamy gazu, nie „futro”).
      const sv = vr.mul(U.shutter.mul(jetHot.mul(0.9).add(1.0)).mul(mix(float(1.0), float(0.15), hazeF))).toVar();
      const svLen = length(sv);
      const capLen = U.maxLenPx.div(U.zoom);
      const tail = head.sub(sv.mul(min(capLen.div(max(svLen, 1e-3)), 1.0)));
      const c0 = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(head, 1.0))).toVar();
      const c1 = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(tail, 1.0))).toVar();
      const s0 = c0.xy.div(c0.w).mul(U.viewHalfPx).toVar();
      const s1 = c1.xy.div(c1.w).mul(U.viewHalfPx).toVar();
      const dS = s1.sub(s0).toVar();
      const L = length(dS).toVar();
      const dir = select(L.greaterThan(0.01), dS.div(max(L, 0.01)), vec2(1.0, 0.0)).toVar();
      const perp = vec2(dir.y.negate(), dir.x);

      // Jasność: wzbudzenie + poświata rzadkich iskier w ruchu (skok gracza).
      const depthFade = exp(head.z.div(15000.0)).toVar();
      const deep = select(i.greaterThanEqual(U.nearCount), float(1.0), float(0.0));
      const streamOn = select(seed.lessThan(U.streamShare), float(1.0), float(0.0)).mul(float(1.0).sub(hazeF)).mul(deep);
      const stream = U.streamGlow.mul(U.warpVis).mul(streamOn).mul(w).mul(smoothstep(4.0, 40.0, L));
      const kindGain = mix(float(1.0), U.hazeGain, hazeF);
      const I = w.mul(E.mul(U.eGain).mul(kindGain).add(stream)).mul(depthFade).mul(U.bright).mul(vis).mul(jetFade).toVar();
      const norm = float(1.0).div(sqrt(float(1.0).add(L.div(U.normPx))));
      // Barwa: turkus (ściśnięcie) / pomarańcz (rozrzedzenie) / neutralna, gorąca biel przy
      // świeżym pchnięciu.
      const tp = clamp(tag, 0.0, 1.0);
      const tn = clamp(tag.negate(), 0.0, 1.0);
      const base = mix(mix(U.colNeutral, U.colCyan, tp), U.colAmber, tn);
      const hot = clamp(E.mul(0.3).mul(jetHot), 0.0, 0.6);
      vCol.assign(mix(base, U.colHot, hot).mul(I.mul(norm)));

      // Głębsze drobiny cieńsze (perspektywa), bez schodzenia poniżej ~0,7 px; mgiełka ma
      // rozmiar w świecie (skaluje się z zoomem).
      const persp = U.camZ.div(c0.w);
      const speckW = U.widthPx.mul(jetHot.mul(0.35).add(1.0)).mul(clamp(persp, 0.66, 1.0));
      const hazeW = max(U.hazeSize.mul(seed.mul(5.3).fract().mul(1.8).add(1.0)).mul(U.zoom).mul(persp), 1.6);
      const wpx = mix(speckW, hazeW, hazeF).toVar();
      const g = positionGeometry.xy;
      const alongPx = g.x.add(0.5).mul(L.add(wpx.mul(2.0))).sub(wpx);
      const side = g.y.mul(2.0).mul(wpx);
      const pix = s0.add(dir.mul(alongPx)).add(perp.mul(side));
      vAlong.assign(alongPx);
      vSide.assign(side);
      vLen.assign(L);
      vW.assign(wpx);
      const on = select(I.mul(norm).greaterThan(0.00035), float(1.0), float(0.0));
      return vec4(pix.div(U.viewHalfPx).mul(c0.w), c0.z, c0.w).mul(on);
    })();

    mat.fragmentNode = Fn(() => {
      const da = max(max(vAlong.negate(), vAlong.sub(vLen)), 0.0);
      const d2 = da.mul(da).add(vSide.mul(vSide)).div(vW.mul(vW));
      const prof = exp(d2.mul(-2.3));
      const taper = mix(float(1.0), float(0.16), clamp(vAlong.div(max(vLen, 1.0)), 0.0, 1.0));
      return vec4(vCol.mul(prof).mul(taper), 0.0);
    })();

    this.material = mat;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'warp:medium';
    // Liczba instancji: 0 albo ≥ 2 (DEMO-RAKIETY: przejście 1 ↔ > 1 przebudowuje potok).
    this.mesh.count = this.capacity;
    this.mesh.layers.set(WARP_MEDIUM_LAYER);
    this.mesh.matrixAutoUpdate = true;
  }

  // --- CPU -----------------------------------------------------------------

  _emptySlots() {
    const A = this.slots.array;
    for (let k = 0; k < BUBBLE_CAP; k++) {
      const b = k * SLOT_BUBBLE_STRIDE;
      A[b + 1].set(1, 1, 0, 2);
      A[b + 3].set(1, 0, 0, 0);
      A[b + 4].set(0, 0, 0, 0);
    }
    this.U.bCount.value = 0;
    this.U.sCount.value = 0;
  }

  /**
   * Pudła populacji z zoomu kamery i ogniskowej (bufor rysowania w px): bliska przy
   * płaszczyźnie gry (tu działa bańka), głęboka do deepZ (paralaksa).
   */
  setBoxes(zoom, viewW, viewH, focalPx) {
    const cfg = this.cfg;
    const U = this.U;
    const z = Math.max(1e-4, zoom);
    const camZ = focalPx / z;
    const hx = (viewW * 0.5 / focalPx);
    const hy = (viewH * 0.5 / focalPx);
    const bn = U.boxNear.value;
    const bd = U.boxDeep.value;
    const nx = hx * (camZ + cfg.nearZ) * 1.14;
    const ny = hy * (camZ + cfg.nearZ) * 1.14;
    const dxx = hx * (camZ + cfg.deepZ) * 1.18;
    const dyy = hy * (camZ + cfg.deepZ) * 1.18;
    // Przyrost od ostatniego kroku (oddalenie): udział drobin do przeniesienia w nowy pas.
    // Przeniesienie ma szansę 1 − r⁻⁴ (4 losowania), więc wybór z prawdopodobieństwem f / szansa.
    if (this.initialized && this._boxSet) {
      const gn = growShare((nx * ny) / Math.max(1, bn.x * bn.y));
      const gd = growShare((dxx * dyy) / Math.max(1, bd.x * bd.y));
      if (gn > 0 || gd > 0) {
        // Kilka klatek bez kroku (zacięcie): przyrosty się składają — stare pudło zostaje z pierwszej.
        if (!(U.grow.value.x > 0 || U.grow.value.y > 0)) {
          U.boxNearOld.value.set(bn.x, bn.y);
          U.boxDeepOld.value.set(bd.x, bd.y);
        }
        const on = U.boxNearOld.value;
        const od = U.boxDeepOld.value;
        U.grow.value.set(growShare((nx * ny) / Math.max(1, on.x * on.y)), growShare((dxx * dyy) / Math.max(1, od.x * od.y)));
      }
    }
    bn.set(nx, ny, -cfg.nearZ, 0);
    bd.set(dxx, dyy, -cfg.deepZ, -cfg.nearZ);
    this._boxSet = true;
  }

  /** Liczba drobin i ziarno (wszystkie od nowa — powtarzalnie). Wymaga renderera. */
  setCount(renderer, n, seed = this._seed) {
    const target = Math.max(0, Math.min(this.capacity, Math.floor(n)));
    this.count = target;
    this.U.count.value = target;
    this.U.nearCount.value = Math.floor(target * this.cfg.nearShare);
    this.reset(renderer, seed);
  }

  reset(renderer, seed = this._seed) {
    this._seed = seed;
    this._stepSeed = (seed * 7919) >>> 0;
    const U = this.U;
    U.initStart.value = 0;
    U.initCount.value = this.count;
    U.seedBase.value = seed >>> 0;
    U.grow.value.set(0, 0);
    if (this.count > 0 && renderer) {
      renderer.compute(this.initNode, this.count);
      this.initialized = true;
    }
  }

  /** Rozgrzewka: potoki kerneli bez pracy (licznik 0 → wczesny powrót). */
  warm(renderer) {
    const U = this.U;
    const c = U.count.value;
    const ic = U.initCount.value;
    U.count.value = 0;
    U.initCount.value = 0;
    renderer.compute(this.initNode, 1);
    renderer.compute(this.stepNode, 1);
    U.count.value = c;
    U.initCount.value = ic;
  }

  /** Jeden krok symulacji; shift — przesunięcie kamery ośrodka w scenie od poprzedniego kroku. */
  step(renderer, dt, time, shiftX, shiftY) {
    if (!this.count || !renderer) return;
    const U = this.U;
    const cfg = this.cfg;
    U.dt.value = dt;
    U.time.value = time;
    U.shift.value.set(shiftX, shiftY, 0);
    U.dampK.value = 1 - Math.exp(-cfg.damping * dt);
    U.decayK.value = Math.exp(-dt / Math.max(0.05, cfg.decay));
    U.fadeK.value = Math.exp(-dt * Math.max(0, this.fade || 0));
    U.stepSeed.value = (this._stepSeed = (this._stepSeed + 1) >>> 0);
    renderer.compute(this.stepNode, this.count);
    U.grow.value.set(0, 0);
    this.stats.steps++;
  }

  /**
   * Przegródki → blok uniformów (scena względem kamery ośrodka). list[k]: { x, y, dx, dy, R,
   * asp, A, front, vx, vy, strain, turb, pullR, pullGain, release, jetSpeed, heraldLen,
   * heraldGain, excite, rear } albo null (pusta przegródka, stały indeks).
   */
  setBubbles(list, n) {
    const A = this.slots.array;
    const count = Math.min(BUBBLE_CAP, n);
    let last = 0;
    for (let k = 0; k < BUBBLE_CAP; k++) {
      const b = k < count ? list[k] : null;
      const o = k * SLOT_BUBBLE_STRIDE;
      if (!b) {
        A[o + 1].set(1, 1, 0, 2);
        A[o + 3].set(1, 0, 0, 0);
        A[o + 4].set(0, 0, 0, 0);
        continue;
      }
      last = k + 1;
      A[o].set(b.x, b.y, b.dx, b.dy);
      A[o + 1].set(b.R, b.asp, b.A, b.front);
      A[o + 2].set(b.vx, b.vy, b.strain, b.turb);
      A[o + 3].set(b.pullR || 1, b.pullGain || 0, b.release ? 1 : 0, b.jetSpeed || 0);
      A[o + 4].set(b.heraldLen || 0, b.heraldGain || 0, b.excite, b.rear ? 1 : 0);
    }
    this.U.bCount.value = last;
  }

  /** Szczeliny tuneli: { x, y, dx, dy, halfLen, halfWidth, push, flow } (scena). */
  setSeams(list, n) {
    const A = this.slots.array;
    const count = Math.min(SEAM_CAP, n);
    for (let k = 0; k < count; k++) {
      const s = list[k];
      const o = SLOT_SEAM_BASE + k * 2;
      A[o].set(s.x, s.y, s.dx, s.dy);
      A[o + 1].set(s.halfLen, s.halfWidth, s.push, s.flow);
    }
    this.U.sCount.value = count;
  }

  /**
   * Widok (render): prędkość kamery ośrodka (scena), przesunięcie kamery ośrodka względem
   * kamery gry (scena), dosunięcie, połowa bufora [px], zoom, odległość kamery persp.
   */
  setView(camVelX, camVelY, offX, offY, lag, halfW, halfH, zoom, camZ, time, warpVis) {
    const U = this.U;
    U.camVel.value.set(camVelX, camVelY, 0);
    U.offset.value.set(offX, offY, 0);
    U.lag.value = lag;
    U.viewHalfPx.value.set(halfW, halfH);
    U.zoom.value = zoom;
    U.camZ.value = camZ;
    U.time.value = time;
    U.warpVis.value = warpVis;
  }

  /** Gaszenie świecenia całego ośrodka [1/s] (0 = tylko zwykły zanik). */
  setFade(rate) {
    this.fade = rate;
  }

  setCloudOrigin(x, y) {
    this.U.cloudOrigin.value.set(x, y);
  }
}
