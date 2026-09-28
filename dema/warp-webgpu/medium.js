// dema/warp-webgpu/medium.js
//
// OŚRODEK — nośnik efektu warpa „Nurt”. Miliony drobin materii
// międzyplanetarnej (gaz, pył) liczone na GPU (compute). Bańki warpa NIE
// rysujemy: widać ją po tym, co robi z ośrodkiem, jak w wizualizacji metryki
// Alcubierre'a (czas Yorka: przed statkiem przestrzeń się kurczy, za nim
// rozszerza), ale bez siatki — zamiast linii siatki są strugi materii.
//
// Pola bańki (układ bańki: oś x = kurs, elipsoida a = R·asp wzdłuż, R w poprzek):
//   • OPŁYW — przepływ potencjalny wokół kuli (w układzie rozciągniętym do
//     kuli): ośrodek w spoczynku w świecie, bańka go przebija; w układzie
//     kamery strugi opływają bańkę, przyspieszają w talii (1,5 v) i zamierają
//     przy czole;
//   • NAPRĘŻENIE (York): c = n·x̂ · pas(ρ) — przy ścianie z przodu c > 0
//     (ściśnięcie, turkus), z tyłu c < 0 (rozrzedzenie, pomarańcz), po bokach
//     zero; dryf zerowy przy samej ścianie (bez ostrego obrysu). Przy
//     ŁADOWANIU (bańka stoi) świecą oba płaty — to „wystrzał”, który user
//     zaakceptował. W LOCIE czoło jest ciemne (user 2026-09-27: kopuła drobin
//     przed dziobem „nie ok”): tył pasa karmi warkocz, a w talii część drobin
//     ZAPALA się przy samej ścianie i płynie wzdłuż konturu bańki (linie od
//     barków do rufy, potem pomarańczowy warkocz) — zamiast „czapy” zebranej
//     materii z iteracji 1;
//   • KIESZEŃ — wnętrze bańki (ρ < R) to płaska przestrzeń jadąca ze statkiem:
//     ośrodek w niej jest niesiony i NIE świeci (w locie gaśnie też
//     wzbudzenie z ładowania — kropki przy ścianie układały się w kopułę);
//   • ZAWIROWANIA — za bańką pole wirowe unoszone z przepływem (warkocz);
//   • WYRZUT / WYDECH — jednorazowe pchnięcia ośrodka przed / za bańką
//     (znaczniki w kroku), np. przy wypadnięciu okrętu z tunelu.
// Przegródka bańki może mieć A = 0 i służyć tylko za:
//   • NIĆ ZWIASTUNA — prosta linia wzbudzonego ośrodka od B wzdłuż osi
//     (heraldLen), z punktem ZBIERANIA na końcu (ośrodek ściągany do punktu
//     wyjścia, pullR / pullGain) — widać, skąd i gdzie wyjdzie okręt.
// TUNEL (szew, osobne przegródki): ośrodek rozsuwa się od osi szczeliny,
// a w jej środku płynie wzdłuż niej (wnętrze tunelu).
// Wzbudzenie E (świecenie) rośnie w polach i gaśnie z czasem τ — za bańką
// zostaje świecący warkocz, ośrodek w spoczynku jest niewidoczny.
// Widoczność `vis` (osobny bufor): kieszeń gasi ośrodek, przy bańce drobiny na
// krawędzi rzutu (|n·z| małe) są przygaszone — bez jasnego obrysu powłoki.
//
// Układ: współrzędne sceny (x w prawo, y w górę, z do kamery) WZGLĘDEM KOTWICY
// kamery — zero kłopotów z precyzją przy dowolnej drodze; co krok CPU podaje
// przesunięcie kotwicy (`shift`). Ośrodek leży POD płaszczyzną gry (z ≤ 0):
// populacja bliska (z od −1500 do 0 — tu działa bańka) i głęboka (paralaksa).
// Krok stały (1/240 s), render dosuwa drobiny o `lag` (czas od ostatniego kroku).
//
// Render: kwad-smuga na drobinę (instancje), wierzchołki w pikselach ekranu
// między pozycją a pozycją „przed migawką” (ruch WZGLĘDEM kamery) — smugi są
// płaskie, równoległe do przepływu; pass perspektywiczny (głębia = paralaksa).

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray,
  instanceIndex, hash, Loop, If, Return, select, mix, smoothstep, clamp, floor, abs,
  exp, sin, cos, sqrt, min, max, dot, length, normalize, positionGeometry,
  cameraProjectionMatrix, cameraViewMatrix, varyingProperty, mx_noise_float
} from 'three/tsl';

export const MEDIUM_CAP = 1 << 21;
export const BUBBLE_CAP = 16;
export const SEAM_CAP = 8;

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

export class WarpMedium {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene pass ośrodka (kamera perspektywiczna)
   */
  constructor({ renderer, scene }) {
    this.renderer = renderer;
    this.cfg = { ...MEDIUM_DEFAULTS };
    this.count = 0;
    this.stats = { steps: 0 };
    this._seed = 1;
    this._stepSeed = 1;

    this.pos = instancedArray(MEDIUM_CAP, 'vec4').setName('medPos');   // xyz (kotwica), w ziarno
    this.vel = instancedArray(MEDIUM_CAP, 'vec4').setName('medVel');   // xyz prędkość (świat), w wzbudzenie E
    this.aux = instancedArray(MEDIUM_CAP, 'vec4').setName('medAux');   // x znacznik ± (ścisk/rozrzedzenie), y —, z gęstość, w wiek wylotu
    this.vis = instancedArray(MEDIUM_CAP, 'float').setName('medVis');  // widoczność (kieszeń, krawędź rzutu)

    const v4 = (n) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4');
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
      bA: v4(BUBBLE_CAP),   // xy środek (kotwica), zw oś (jednostkowa)
      bB: v4(BUBBLE_CAP),   // x R (poprzek), y asp (a/R), z amplituda A, w front zapadania (x/a)
      bC: v4(BUBBLE_CAP),   // xy prędkość bańki (świat), z naprężenie [1/s], w zawirowania
      bD: v4(BUBBLE_CAP),   // x promień punktu zbierania, y jego siła, z wyrzut (1 w kroku), w prędkość wyrzutu
      bE: v4(BUBBLE_CAP),   // x długość nici zwiastuna (od B), y jej siła, z wzbudzenie, w wydech tyłu (1 w kroku)
      sCount: uniform(0, 'int'),
      sA: v4(SEAM_CAP),     // xy środek szczeliny, zw oś
      sB: v4(SEAM_CAP),     // x pół-długość, y pół-szerokość otwarcia, z rozsuwanie [j/s], w przepływ wnętrza [j/s]
      // Render
      camVel: uniform(new THREE.Vector3()),
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
    this._buildCompute();
    this._buildRender(scene);
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
    const pos = this.pos;
    const vel = this.vel;
    const aux = this.aux;
    const visB = this.vis;

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
    })().compute(MEDIUM_CAP).setName('medInit');

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

      // Powrót do spoczynku + opór kwadratowy (pchnięcia hamują).
      v.subAssign(v.mul(U.dampK));
      v.subAssign(v.mul(min(length(v).mul(U.quadDrag).mul(dt), 0.5)));

      Loop(U.bCount, ({ i: bi }) => {
        const A0 = U.bA.element(bi).toVar();
        const B0 = U.bB.element(bi).toVar();
        const D0 = U.bD.element(bi).toVar();
        const E0 = U.bE.element(bi).toVar();
        const active = B0.z.greaterThan(0.001).or(E0.y.greaterThan(0.0)).or(D0.y.greaterThan(0.0)).or(D0.z.greaterThan(0.5)).or(E0.w.greaterThan(0.5));
        If(active, () => {
          const C0 = U.bC.element(bi).toVar();
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
              const tip = smoothstep(E0.x, E0.x.sub(wh.mul(3.0)), xl);
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
                const behind = smoothstep(0.15, -0.55, n.x);
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
                // Wzbudzenie jak w iteracji 1 (lot się podobał): pas naprężenia
                // + przepływ przy bańce. W LOCIE czoło jest ciemne (user: kopuła
                // drobin przed dziobem „nie ok”) — świeci od barków do tyłu: strugi
                // wzdłuż boków i warkocz; resztki turkusowego płata z ładowania
                // gasną przy kopnięciu (czoło je „zdmuchuje”).
                const band = exp(s1.div(U.bandW).negate()).toVar();
                const c = n.x.mul(band).toVar();
                const moving = float(1.0).sub(still).toVar();
                const front = smoothstep(0.1, 0.4, n.x).mul(moving).toVar();
                const flowK = length(udl).div(max(sp, R.mul(0.2))).mul(exp(s1.div(0.36).negate()));
                E.addAssign(abs(c).mul(1.7).mul(float(1.0).sub(front)).add(flowK.mul(0.25).mul(still)).mul(Ab).mul(E0.z).mul(dt).mul(3.0));
                E.mulAssign(float(1.0).sub(min(front.mul(exp(s1.div(0.9).negate())).mul(dt).mul(8.0), 1.0)));
                // Strugi w locie (zamiast czapy z iteracji 1): w talii, gdzie ośrodek
                // najszybciej mija bańkę, część drobin ZAPALA się (E ≥ progu — talię
                // mija w ~0,03 s, całkowanie by nie nadążyło) jako linie (turkus),
                // płynie wzdłuż boków i za rufą przechodzi w pomarańczowy warkocz.
                // Zapłon tylko w cienkiej warstwie przy ścianie: drobiny płyną wtedy
                // wzdłuż konturu bańki (linie opinające ją od barków), nie deszczem.
                const waist = smoothstep(0.45, 0.1, n.x).mul(smoothstep(-0.7, -0.2, n.x)).mul(exp(s1.div(0.15).negate())).mul(moving).toVar();
                const lineSel = select(hs.lessThan(0.4), float(1.0), float(0.08));
                const ign = waist.mul(lineSel).mul(Ab).mul(E0.z).toVar();
                E.assign(max(E, ign.mul(2.4)));
                tag.assign(mix(tag, float(1.0), min(ign.mul(1.5), 1.0)));
                tag.addAssign(clamp(c.mul(5.0), -1.0, 1.0).sub(tag).mul(min(abs(c).mul(float(1.0).sub(front)).mul(U.tagRate).mul(dt).mul(4.0), 1.0)));
                // Warkocz: rozrzedzona przestrzeń za bańką barwi ośrodek na pomarańcz.
                const behindK = smoothstep(-0.2, -0.75, n.x).mul(exp(s1.div(1.2).negate())).mul(Ab);
                tag.addAssign(float(-1.0).sub(tag).mul(min(behindK.mul(dt).mul(14.0), 1.0)));
                // Krawędź rzutu przygaszona (bez jasnego obrysu powłoki).
                const nearB = float(1.0).sub(smoothstep(0.35, 1.5, s1));
                vis.assign(min(vis, mix(float(1.0), abs(n.z).mul(0.7).add(0.3), nearB.mul(Ab))));
              });
            });
            // WYRZUT (np. okręt wypada z tunelu): ośrodek przed bańką dostaje
            // pchnięcie do przodu z rozrzutem — iskry lecą przed dziobem.
            If(D0.z.greaterThan(0.5).and(n.x.greaterThan(0.1)).and(s1.greaterThan(-0.2)), () => {
              const fall = smoothstep(2.4, 0.0, s1).mul(n.x).mul(hs.mul(0.8).add(0.2)).toVar();
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
              const fall = smoothstep(1.6, 0.0, s1).mul(n.x.negate()).mul(hs.mul(0.85).add(0.15));
              v.addAssign(nW.mul(R.mul(0.7).mul(fall)));
              E.addAssign(fall.mul(0.2));
              tag.assign(mix(tag, float(-1.0), fall));
            });
          });
        });
      });

      // TUNEL: ośrodek rozsuwa się od osi szczeliny, w jej środku płynie wzdłuż.
      Loop(U.sCount, ({ i: si }) => {
        const S0 = U.sA.element(si).toVar();
        const S1 = U.sB.element(si).toVar();
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
          // Świeci tylko ośrodek w samym otwarciu — wypchnięty na boki zostaje
          // ciemny (świecąca ściana wnęki robiła „kapsułę” wokół okrętu).
          const mouth = smoothstep(wv.mul(1.6).add(20.0), wv, dperp).mul(ends);
          E.addAssign(mouth.mul(dt).mul(1.4));
          // Rozpychany ośrodek gaśnie: nić zwiastuna rozepchnięta od osi zostawiała
          // świecącą „puszkę” wokół okrętu jeszcze długo po zamknięciu szczeliny.
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

      // Pudło populacji: drobina, która wyjdzie, rodzi się po drugiej stronie
      // jako świeży, niewzbudzony ośrodek w spoczynku.
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
    })().compute(MEDIUM_CAP).setName('medStep');
  }

  _buildRender(scene) {
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
      // Pchnięte drobiny rozjaśniają się przez 0,18 s: w pierwszej chwili tysiące
      // smug startują z jednego miejsca i nałożone zalewałyby bloomem ekran.
      const jetFade = select(Ax.w.greaterThan(0.0), smoothstep(0.0, 0.18, Ax.w), float(1.0)).toVar();
      // Rodzaj: MGIEŁKA (miękka, szersza plama — objętość płatów i warkocza)
      // albo ISKRA (cienka smuga). Pchnięte drobiny zawsze iskrami.
      const hazeF = select(seed.mul(13.7).fract().lessThan(U.hazeShare).and(jetHot.lessThan(0.05)), float(1.0), float(0.0)).toVar();
      // Ruch względem kamery; dosunięcie o czas od ostatniego kroku.
      const vr = Vv.xyz.sub(U.camVel).toVar();
      const head = P.xyz.add(vr.mul(U.lag)).toVar();
      // Mgiełka rozmyta ruchem słabiej niż iskry (okrągłe plamy gazu, nie „futro”).
      const sv = vr.mul(U.shutter.mul(jetHot.mul(0.9).add(1.0)).mul(mix(float(1.0), float(0.15), hazeF))).toVar();
      const svLen = length(sv);
      const capLen = U.maxLenPx.div(U.zoom);
      const tail = head.sub(sv.mul(min(capLen.div(max(svLen, 1e-3)), 1.0)));
      const c0 = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(head, 1.0))).toVar();
      const c1 = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(tail, 1.0))).toVar();
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
      // Barwa: turkus (ściśnięcie) / pomarańcz (rozrzedzenie) / neutralna,
      // gorąca biel przy świeżym pchnięciu.
      const tp = clamp(tag, 0.0, 1.0);
      const tn = clamp(tag.negate(), 0.0, 1.0);
      const base = mix(mix(U.colNeutral, U.colCyan, tp), U.colAmber, tn);
      const hot = clamp(E.mul(0.3).mul(jetHot), 0.0, 0.6);
      vCol.assign(mix(base, U.colHot, hot).mul(I.mul(norm)));

      // Głębsze drobiny cieńsze (perspektywa), bez schodzenia poniżej ~0,7 px;
      // mgiełka ma rozmiar w świecie (skaluje się z zoomem).
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
    this.mesh.name = 'warpMedium';
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  // --- CPU -----------------------------------------------------------------

  /** Pudła populacji z zakresu zoomu (najmniejszy zoom sceny) i ogniskowej. */
  setBoxes(minZoom, viewW, viewH, focalPx) {
    const cfg = this.cfg;
    const camZ = focalPx / minZoom;
    const half = (z, m) => ({
      x: (viewW * 0.5 / focalPx) * (camZ - z) * m,
      y: (viewH * 0.5 / focalPx) * (camZ - z) * m
    });
    const hn = half(-cfg.nearZ, 1.14);
    const hd = half(-cfg.deepZ, 1.18);
    this.U.boxNear.value.set(hn.x, hn.y, -cfg.nearZ, 0);
    this.U.boxDeep.value.set(hd.x, hd.y, -cfg.deepZ, -cfg.nearZ);
  }

  /** Liczba drobin (wszystkie od nowa, z ziarnem — powtarzalnie). */
  setCount(n, seed = this._seed) {
    const target = Math.max(0, Math.min(MEDIUM_CAP, Math.floor(n)));
    this.count = target;
    this.U.count.value = target;
    this.U.nearCount.value = Math.floor(target * this.cfg.nearShare);
    this.mesh.count = target;
    this.reset(seed);
  }

  reset(seed = this._seed) {
    this._seed = seed;
    this._stepSeed = seed * 7919;
    const U = this.U;
    U.initStart.value = 0;
    U.initCount.value = this.count;
    U.seedBase.value = seed;
    if (this.count > 0) this.renderer.compute(this.initNode, this.count);
  }

  /** Jeden krok symulacji; shift — przesunięcie kotwicy w scenie od poprzedniego kroku. */
  step(dt, time, shiftX, shiftY) {
    if (!this.count) return;
    const U = this.U;
    const cfg = this.cfg;
    U.dt.value = dt;
    U.time.value = time;
    U.shift.value.set(shiftX, shiftY, 0);
    U.dampK.value = 1 - Math.exp(-cfg.damping * dt);
    U.decayK.value = Math.exp(-dt / Math.max(0.05, cfg.decay));
    U.fadeK.value = Math.exp(-dt * Math.max(0, this.fade || 0));
    U.stepSeed.value = (this._stepSeed = (this._stepSeed + 1) >>> 0);
    this.renderer.compute(this.stepNode, this.count);
    this.stats.steps++;
  }

  /**
   * Przegródki → uniformy (scena względem kotwicy). b: { x, y, dx, dy, R, asp,
   * A, front, vx, vy, strain, turb, pullR, pullGain, release, jetSpeed,
   * heraldLen, heraldGain, excite, rear } albo null (pusta przegródka).
   */
  setBubbles(list) {
    const U = this.U;
    const n = Math.min(BUBBLE_CAP, list.length);
    let last = 0;
    for (let k = 0; k < BUBBLE_CAP; k++) {
      const b = k < n ? list[k] : null;
      if (!b) {
        U.bB.array[k].set(1, 1, 0, 2);
        U.bD.array[k].set(1, 0, 0, 0);
        U.bE.array[k].set(0, 0, 0, 0);
        continue;
      }
      last = k + 1;
      U.bA.array[k].set(b.x, b.y, b.dx, b.dy);
      U.bB.array[k].set(b.R, b.asp, b.A, b.front);
      U.bC.array[k].set(b.vx, b.vy, b.strain, b.turb);
      U.bD.array[k].set(b.pullR || 1, b.pullGain || 0, b.release ? 1 : 0, b.jetSpeed || 0);
      U.bE.array[k].set(b.heraldLen || 0, b.heraldGain || 0, b.excite, b.rear ? 1 : 0);
    }
    U.bCount.value = last;
  }

  /** Szczeliny tuneli: { x, y, dx, dy, halfLen, halfWidth, push, flow } (scena). */
  setSeams(list) {
    const U = this.U;
    const n = Math.min(SEAM_CAP, list.length);
    for (let k = 0; k < n; k++) {
      const s = list[k];
      U.sA.array[k].set(s.x, s.y, s.dx, s.dy);
      U.sB.array[k].set(s.halfLen, s.halfWidth, s.push, s.flow);
    }
    U.sCount.value = n;
  }

  setView({ camVelX, camVelY, lag, viewW, viewH, zoom, camZ, time, warpVis }) {
    const U = this.U;
    U.camVel.value.set(camVelX, camVelY, 0);
    U.lag.value = lag;
    U.viewHalfPx.value.set(viewW * 0.5, viewH * 0.5);
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

  setVisible(v) {
    this.mesh.visible = !!v;
  }
}
