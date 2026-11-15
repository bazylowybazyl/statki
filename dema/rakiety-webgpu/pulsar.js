// dema/rakiety-webgpu/pulsar.js
//
// WYBUCH „PULSAR” — głowica rakiety „Niszczyciel” (tylko demo, 2026-11-10; użytkownik: „kompletnie nowy duży
// wybuch, bardziej sci-fi, w kolorach jasny niebieski / pulsar”). Zrobiony od zera — bez gazu gry, kul ognia
// i mgławicy Supernowej. W miejscu trafienia na ~4,5 s zapala się miniaturowy PULSAR, liczony w 3D:
//   • ŁADOWANIE (0,55 s): dysk akrecyjny — spirala plazmy wciągana do jądra (cząstki + ramiona na dysku),
//     klatka linii pola magnetycznego zapala się wokół jądra, przestrzeń ugina się i SKRĘCA (soczewka
//     i skręcenie w poście), obraz przygasa;
//   • DETONACJA: błysk, POWŁOKA plazmy — bańka z siecią świecących żył (cienka powłoka jaśnieje na brzegu
//     tarczy, a wzór na przedniej i tylnej półkuli jedzie w przeciwne strony — widać, że to bryła),
//     pod nią wolniejsza bańka i przed nią słaby front jonów;
//   • PULSAR: oś magnetyczna M obraca się wokół nachylonej osi S — dwa DŻETY omiatają stożki jak latarnia
//     morska. Dżet celujący w kamerę skraca się i rozbłyska (dłuższa droga przez strugę) — to PULS:
//     błysk jądra, światło na kadłubach, fala w wietrze. Obroty hamują (3,2 → ~0,8 obr./s);
//   • WIATR PULSARA: w płaszczyźnie równika (⟂ S, widzianej jako nachylona elipsa) rozchodzi się dwuramienna
//     spirala fal sprzężona z obrotem; połowa dysku leży nad płaszczyzną gry, połowa pod nią;
//   • LINIE POLA: pętle dipola r = L·sin²θ przypięte do osi M — wirująca klatka (wstęgi 3D z testem głębi);
//   • CZĄSTKI (pulsarParticles.js): dopływ, plazma dżetów (śruba na stożku), rozbryzg równikowy, iskry powłoki;
//   • ZAPAŚĆ (0,45 s): linie pola i cząstki zapadają się do jądra, obroty przyspieszają, ostatni błysk i fala.
// GŁĘBIA przy kamerze z góry: wszystko, co leży POD płaszczyzną gry (z < 0), rysuje się PRZED kadłubami
// (kadłub to zasłania), a co NAD nią — po nich. Bryła nie maszeruje promienia: powłoki to trafienia promienia
// w sferę (dwa na piksel — przód i tył), dysk — przecięcie z płaszczyzną równika, dżety — najbliższe podejście
// promienia do osi (jasność × 1 / sin kąta do kamery). Ostre przy każdym zoomie, ~10 próbek szumu na piksel.
// Ograniczenie: promień = oś kamery ortho z góry (demo); kamery 3D gry wymagałyby promienia z kamery.
//
// Światła (siatka dema): jądro i dwa snopy dżetów omiatające kadłuby i dym. Post: soczewka, SKRĘCENIE
// (nowy typ źródła w post.js), fala jako sama refrakcja, przygaszenie i podbicie bloomu. Dym rakiet:
// ładowanie wsysa, detonacja wymiata (siły puli dymu). Układ: scena dema (x − O.x, −(y − O.y), z ku kamerze).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard, float, int, vec2, vec3, vec4, uniform, uniformArray, attribute, positionGeometry, varyingProperty, texture3D,
  mix, clamp, smoothstep, step, exp, sin, cos, atan, log, max, min, abs, sign, sqrt, dot, cross, length, normalize
} from 'three/tsl';
import { PulsarParticles, PK, PSHAPE, PULSAR_BLASTS } from './pulsarParticles.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Strojenie wybuchu (czasy [s], długości w R — promieniu powłoki). */
export const PULSAR = Object.freeze({
  R: 560,            // promień powłoki [j.] — jednostka długości bryły
  bound: 4.7,        // połowa boku kwadu bryły [R] (zasięg dżetów-latarni)
  charge: 0.55,      // ładowanie
  life: 3.4,         // życie pulsara po detonacji
  collapse: 0.45,    // zapaść
  alpha: 34 * DEG,   // kąt osi magnetycznej do osi obrotu
  spin0: 3.2,        // obroty na sekundę tuż po detonacji
  spinTau: 1.1,      // hamowanie: ω = spin0 / (1 + t / spinTau)
  ringLambda: 0.22,  // odstęp fal wiatru [R]
  jetLen: 4.4,       // zasięg dżetu [R] (droga w 3D; w rzucie krótszy o nachylenie osi)
  lineShells: [0.62, 1.0], // rozmiary pętli pola L [R]
  lineAz: 10,        // pętli na powłokę (azymuty)
  lineStar: 0.06     // promień „gwiazdy” — tu zaczynają się pętle [R]
});
const LINES = PULSAR.lineShells.length * PULSAR.lineAz;
const LINE_SEG = 44;

// Barwy liniowe: biel → lodowy błękit → jasny lazur → głęboki błękit, fiolet na obrzeżach.
const C_WHITE = [1.0, 1.0, 1.0];
const C_ICE = [0.6, 0.86, 1.0];
const C_AZURE = [0.14, 0.52, 1.0];
const C_DEEP = [0.04, 0.13, 0.7];
const C_VIOLET = [0.26, 0.17, 0.95];

const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);
const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smooth01 = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

function newBlast() {
  return {
    active: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, seed: 0, R: PULSAR.R,
    S: [0, 0, 1], s1: [1, 0, 0], s2: [0, 1, 0], M: [0, 0, 1], m1: [1, 0, 0],
    phi0: 0, rev: 0, mzHi: 1, pulse: 0, pulsePrev: 0, pulses: 0,
    detonated: false, collapsing: false, inAcc: 0, jetAcc: 0,
    // poziomy tej klatki (jasności i rozmiary bryły)
    L: { a: 0, c: 0, kEnd: 0, Rs: 0.02, I1: 0, I2: 0, I3: 0, Iring: 0, Lj: 0.02, Ij: 0, Icore: 0, Idisk: 0, Iflash: 0, Iglow: 0, lineI: 0, lineL: 0.3 }
  };
}

export class PulsarBlast {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene scena dema (kamera ortho z góry, z ku kamerze)
   * @param {THREE.Data3DTexture} o.noise3D szum 3D kafelkowy (R, G — dwa fBm)
   * @param {() => number} [o.rng]
   * renderOrderBack — warstwa pod płaszczyzną gry (przed kadłubami), renderOrderFront — nad nią (po kadłubach i dymie).
   */
  constructor({ renderer, scene, noise3D, rng = Math.random, renderOrderBack = 2, renderOrderFront = 36, renderOrderLines = 44, renderOrderParticles = 64 }) {
    this.renderer = renderer;
    this.rng = rng;
    this.noise3D = noise3D;
    this.time = 0;
    this.blasts = Array.from({ length: PULSAR_BLASTS }, newBlast);
    this.pops = [];           // ostatnie błyski po zapaści: { x, y, vx, vy, t0, R }
    this.U = { time: uniform(0), zoom: uniform(1) };
    // Wyjścia klatki dla reżysera efektów (effects.js).
    this.shake = 0;
    this.exposure = 1;
    this.bloomBoost = 0;
    this.forces = [];         // siły w dymie rakiet: { x, y, front, width, strength, type, reach } (scena)
    this._lights = [];
    this._dist = [];
    this._nL = 0;
    this._nD = 0;
    this._nF = 0;
    this.stats = { blasts: 0, live: 0 };
    this.particles = new PulsarParticles({ renderer, scene, renderOrder: renderOrderParticles });
    this._buildVolume(scene, renderOrderBack, renderOrderFront);
    this._buildLines(scene, renderOrderLines);
  }

  /** Siatki do rozgrzewki potoków. */
  get warmMeshes() {
    return [this.meshBack, this.meshFront, this.lineMesh, this.particles.mesh];
  }

  /** Żywe wybuchy. */
  get count() {
    let n = 0;
    for (const b of this.blasts) if (b.active) n++;
    return n;
  }

  // --- bryła: kwad na wybuch, dwie warstwy (pod i nad płaszczyzną gry) ---------------------------------

  _buildVolume(scene, orderBack, orderFront) {
    const U = this.U;
    const noise = this.noise3D;
    const cap = PULSAR_BLASTS;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    // A: środek xy (scena), R [j.], połowa boku [R]      B: czas od detonacji [s], ładowanie 0..1, zapaść 0..1, ziarno
    // C: oś obrotu S, obroty                              D: oś magnetyczna M, puls 0..1
    // E: promień powłoki [R], jasność frontu, bańki, pierścieni   F: zasięg dżetu [R], jasność dżetu, jądra, dysku
    // G: błysk, poświata wnętrza, front jonów, —
    this._attrs = [mk(), mk(), mk(), mk(), mk(), mk(), mk()];
    'ABCDEFG'.split('').forEach((k, i) => geo.setAttribute(`pz${k}`, this._attrs[i]));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const vQ = varyingProperty('vec2', 'vPzQ');
    const vA = varyingProperty('vec4', 'vPzA');
    const vB = varyingProperty('vec4', 'vPzB');
    const vC = varyingProperty('vec4', 'vPzC');
    const vD = varyingProperty('vec4', 'vPzD');
    const vE = varyingProperty('vec4', 'vPzE');
    const vF = varyingProperty('vec4', 'vPzF');
    const vG = varyingProperty('vec4', 'vPzG');
    const positionNode = Fn(() => {
      const A = attribute('pzA', 'vec4');
      const q = positionGeometry.xy.mul(2.0);
      vQ.assign(q.mul(A.w));
      vA.assign(A);
      vB.assign(attribute('pzB', 'vec4'));
      vC.assign(attribute('pzC', 'vec4'));
      vD.assign(attribute('pzD', 'vec4'));
      vE.assign(attribute('pzE', 'vec4'));
      vF.assign(attribute('pzF', 'vec4'));
      vG.assign(attribute('pzG', 'vec4'));
      return vec3(A.xy.add(q.mul(A.w.mul(A.z))), 0.0);
    })();

    const WHITE = vec3(...C_WHITE);
    const ICE = vec3(...C_ICE);
    const AZURE = vec3(...C_AZURE);
    const DEEP = vec3(...C_DEEP);
    const VIOLET = vec3(...C_VIOLET);
    const gauss = (x, w) => { const k = x.div(w); return exp(k.mul(k).negate()); };

    const fragment = (back) => Fn(() => {
      const P = vQ.toVar();                       // punkt kadru w układzie wybuchu [R]; promień leci wzdłuż −z
      const b2 = dot(P, P).toVar();
      If(b2.greaterThan(vA.w.mul(vA.w)), () => { Discard(); });
      const b = sqrt(b2).toVar();
      const chg = vB.y.toVar();
      const seed = vB.w.toVar();
      const S = vC.xyz.toVar();
      const rev = vC.w.toVar();
      const M = vD.xyz.toVar();
      const Rs = max(vE.x, 0.02).toVar();
      const time = U.time;
      const seedV = vec3(seed.mul(3.1), seed.mul(5.7), seed.mul(7.3)).toVar();
      const col = vec3(0.0).toVar();
      const sgn = back ? -1.0 : 1.0;

      // 1. POWŁOKI — trafienie promienia w sferę (przednia półkula w warstwie przedniej, tylna w tylnej).
      //    Cienka powłoka: droga ~ 1 / |n.z| → jasny brzeg tarczy; poza tarczą miękka krawędź.
      const addShell = (radius, inten, freq, spinK, veinCol, bodyCol, veinGain, bodyGain) => {
        const h2 = radius.mul(radius).sub(b2).toVar();
        const nz = sqrt(max(h2, 0.0)).div(radius).toVar();
        const limb = float(1.0).div(max(nz, 0.3));
        const edge = b.sub(radius).div(radius.mul(0.03).add(0.01));
        const rim = exp(edge.mul(edge).negate()).mul(1.4);
        const inside = step(0.0, h2);
        const n = vec3(P.div(radius), nz.mul(sgn)).toVar();
        // Obrót wzoru wokół osi S z fazą obrotu pulsara: przód i tył jadą w przeciwne strony.
        const ang = rev.mul(TAU * spinK).add(seed.mul(9.0));
        const ca = cos(ang).toVar();
        const sa = sin(ang).toVar();
        const nr = n.mul(ca).add(cross(S, n).mul(sa)).add(S.mul(dot(S, n).mul(float(1.0).sub(ca)))).toVar();
        const w1 = texture3D(noise, nr.mul(freq * 0.4).add(seedV).add(vec3(0.0, 0.0, time.mul(0.04)))).level(0);
        const nw = nr.add(vec3(w1.x, w1.y, w1.x.add(w1.y).mul(0.5)).sub(0.5).mul(0.5)).toVar();
        const a1 = texture3D(noise, nw.mul(freq).add(seedV.mul(1.7)).add(vec3(time.mul(0.05), 0.0, 0.0))).level(0).toVar();
        const a2 = texture3D(noise, nw.mul(freq * 2.6).add(seedV.mul(0.6)).sub(vec3(0.0, time.mul(0.07), 0.0))).level(0).toVar();
        // Żyły: wąski pas wokół poziomicy 0,5 szumu — cienka świecąca sieć (dwie skale). Szeroki pas (potęga
        // grzbietu) zajmował ćwierć powłoki i z bloomem robił z bańki białą kulę.
        const d1 = a1.x.sub(0.5).mul(28.0).toVar();
        const d2 = a2.y.sub(0.5).mul(22.0).toVar();
        const veins = exp(d1.mul(d1).negate()).add(exp(d2.mul(d2).negate()).mul(0.5));
        const body = smoothstep(0.35, 0.85, a1.y).mul(0.6).add(a2.x.mul(0.4));
        const k = inside.mul(limb).add(float(1.0).sub(inside).mul(rim));
        // Żyła: jasny rdzeń w barwie `veinCol`, obrzeże w barwie ciała powłoki.
        const vc = mix(bodyCol, veinCol, clamp(veins, 0.0, 1.0));
        col.addAssign(vc.mul(veins.mul(veinGain)).add(bodyCol.mul(body.mul(bodyGain))).mul(k.mul(inten)));
      };
      // Jasności: wypełnienia (ciało powłoki, poświata) w paśmie 0,1–0,5 — błękit zostaje błękitem po ACES;
      // nad progiem bloomu tylko cienkie żyły, jądro i osie dżetów. Żył jest dużo (dwie skale, dwie półkule,
      // trzy powłoki) — ich suma z bloomem łatwo robi z bańki białą kulę, stąd niskie poziomy (vE.y, vE.z).
      addShell(Rs, vE.y, 1.0, 0.16, mix(ICE, WHITE, 0.4), AZURE, 2.6, 0.5);              // front: ostre jasne żyły
      addShell(Rs.mul(0.7), vE.z, 1.5, -0.24, ICE, mix(AZURE, DEEP, 0.4), 1.4, 0.55);    // bańka pod nim, kręci się odwrotnie
      addShell(Rs.mul(1.32).add(0.04), vG.z, 0.7, 0.07, VIOLET, VIOLET, 0.5, 0.3);       // słaby front jonów przed powłoką
      // Łuna wokół powłoki: miękka błękitna otoczka po obu stronach brzegu tarczy (po połowie na warstwę).
      const au = b.sub(Rs).div(0.13);
      col.addAssign(AZURE.mul(exp(au.mul(au).negate()).mul(vE.y.mul(0.55))));

      // 2. PŁASZCZYZNA RÓWNIKA (⟂ S): jeden punkt przecięcia na piksel; nad płaszczyzną gry — warstwa przednia.
      const zP = dot(P, S.xy).negate().div(S.z).toVar();
      const passP = back ? step(zP, 0.0) : float(1.0).sub(step(zP, 0.0));
      const hp = vec3(P, zP).toVar();
      const s1 = normalize(vec3(S.y, S.x.negate(), 0.0)).toVar();
      const s2 = cross(S, s1).toVar();
      const hx = dot(hp, s1).toVar();
      const hy = dot(hp, s2).toVar();
      const rho = max(sqrt(hx.mul(hx).add(hy.mul(hy))), 1e-4).toVar();
      const psi = atan(hy, hx).toVar();
      const thick = float(1.0).div(S.z);          // droga przez cienki dysk
      //    Wiatr pulsara: dwuramienna spirala fal sprzężona z obrotem (jedna fala na obrót), tylko pod powłoką.
      const ph = rho.div(PULSAR.ringLambda).sub(rev).add(psi.mul(1 / Math.PI));
      const wv = cos(ph.mul(TAU)).mul(0.5).add(0.5).toVar();
      const wv2 = wv.mul(wv).toVar();
      const wv4 = wv2.mul(wv2).toVar();
      const wave = wv4.mul(wv4).mul(wv2);         // ^10 — wąskie grzbiety fal
      const clump = texture3D(noise, hp.mul(0.7).add(seedV).add(vec3(0.0, 0.0, rev.mul(0.05)))).level(0).x.mul(1.3).add(0.1);
      const envR = smoothstep(0.1, 0.24, rho).mul(float(1.0).sub(smoothstep(Rs.mul(0.9), Rs.mul(1.03), rho))).mul(exp(rho.mul(-0.8)));
      col.addAssign(mix(AZURE, ICE, wave).mul(wave.mul(clump).mul(1.5)).add(AZURE.mul(0.05)).mul(envR.mul(thick).mul(vE.w).mul(passP)));
      //    Dysk akrecyjny (ładowanie i zapaść): ramiona spirali logarytmicznej wirujące do środka.
      const ph2 = log(rho.add(0.03)).mul(1.35).add(psi.mul(1 / Math.PI)).add(time.mul(2.6));
      const ar = cos(ph2.mul(TAU)).mul(0.5).add(0.5).toVar();
      const ar2 = ar.mul(ar).toVar();
      const arms = ar2.mul(ar2).mul(ar);          // ^5 — wąskie ramiona, poszarpane szumem
      const rOut = mix(float(1.7), float(0.6), chg).toVar();
      const envD = smoothstep(0.02, 0.08, rho).mul(float(1.0).sub(smoothstep(rOut.mul(0.6), rOut, rho)));
      const diskCol = mix(AZURE, ICE, exp(rho.mul(-5.0)));
      col.addAssign(diskCol.mul(arms.mul(clump).mul(envD).mul(float(0.16).div(rho.add(0.1)).add(0.22)).mul(thick).mul(vF.w).mul(passP)));

      // 3. DŻETY wzdłuż osi magnetycznej M: najbliższe podejście promienia do osi. Odległość od osi = odległość
      //    piksela od rzutu osi; jasność × 1 / |M.xy| (oś ku kamerze — promień idzie wzdłuż strugi: błysk).
      const ml2 = max(dot(M.xy, M.xy), 0.08).toVar();
      const ml = sqrt(ml2).toVar();
      const sS = dot(P, M.xy).div(ml2).toVar();                      // wzdłuż osi [R] (droga w 3D)
      const dS = P.x.mul(M.y).sub(P.y.mul(M.x)).div(ml).toVar();     // od osi, ze znakiem
      const zJ = sS.mul(M.z);
      const passJ = back ? step(zJ, 0.0) : float(1.0).sub(step(zJ, 0.0));
      const sA = abs(sS).toVar();
      const Lj = max(vF.x, 0.02).toVar();
      const wJ = sA.mul(0.04).add(0.028).toVar();
      //    Podwójna śruba: dwa pasma wijące się wokół osi w przeciwfazie (tylne słabsze).
      const wob = sin(sA.mul(TAU / 0.42).sub(time.mul(9.0)).add(sign(sS).mul(1.3))).mul(sA.mul(0.03).add(0.016)).toVar();
      //    (pasma śruby gasną z odległością — daleko zostaje otoczka i cienki promień latarni)
      const twist = exp(sA.mul(-0.5));
      const strand1 = gauss(dS.sub(wob), wJ.mul(0.5)).mul(twist).toVar();
      const strand2 = gauss(dS.add(wob), wJ.mul(0.5)).mul(twist).mul(0.5);
      const sheath = gauss(dS, wJ.mul(1.5)).mul(0.3);
      const kn = sin(sA.div(0.3).sub(rev.mul(2.0)).mul(TAU)).mul(0.5).add(0.5).toVar();
      const knots = kn.mul(kn).mul(0.5).add(0.5);                    // zgrubienia płynące wzdłuż strugi
      const reach = float(1.0).sub(smoothstep(Lj.mul(0.5), Lj, sA)).mul(smoothstep(0.0, 0.05, sA));
      const fall = float(1.0).div(sA.mul(1.5).add(1.0));
      const boost = float(1.0).div(ml);
      const jet = strand1.add(strand2).add(sheath).mul(knots).mul(reach).mul(fall).mul(boost);
      //    „Latarnia”: cienki daleki promień w osi dżetu (nie cieńszy niż piksel).
      const bw = max(sA.mul(0.004).add(0.006), float(0.9).div(U.zoom.mul(vA.z)));
      const beam = gauss(dS, bw).mul(float(1.0).sub(smoothstep(Lj.mul(0.75), Lj.mul(1.05), sA))).mul(float(1.0).div(sA.mul(0.5).add(1.0))).mul(boost);
      col.addAssign(mix(AZURE, ICE, strand1).mul(jet.mul(1.1)).add(vec3(0.7, 0.9, 1.0).mul(beam.mul(2.2))).mul(vF.y.mul(passJ)));

      // 4. Poświata wnętrza bańki (po połowie na warstwę); w warstwie przedniej błysk detonacji i jądro.
      const gr = max(Rs.mul(0.8), 0.15);
      col.addAssign(AZURE.mul(exp(b2.div(gr.mul(gr)).negate()).mul(vG.y.mul(0.5))));
      if (!back) {
        // Błysk: mały i błękitny (szeroki biały zalewał kadr przez bloom), gaśnie w kilka klatek.
        col.addAssign(vec3(0.45, 0.76, 1.0).mul(exp(b2.div(0.22).negate()).mul(vG.x)));
        const pulse = vD.w;
        const hot = exp(b2.div(0.0009).negate()).mul(6.0);
        const warm = exp(b2.div(0.012).negate()).mul(pulse.mul(1.2).add(0.8));
        const halo = float(1.0).div(b2.mul(14.0).add(1.0));
        col.addAssign(WHITE.mul(hot).add(ICE.mul(warm)).add(AZURE.mul(halo.mul(halo).mul(0.08))).mul(vF.z));
      }
      // Wyjście premultiplied: jasna plazma trochę zasłania to, co pod nią (bryła, nie sam blask).
      const lum = max(max(col.x, col.y), col.z);
      return vec4(clamp(col, vec3(0.0), vec3(48.0)), clamp(lum.mul(0.4), 0.0, 0.75));
    })();

    const make = (back) => {
      const mat = new THREE.NodeMaterial();
      mat.name = back ? 'PulsarBack' : 'PulsarFront';
      mat.transparent = !back;          // tył: kolejka nieprzezroczysta (przed kadłubami), przód: przezroczysta (po nich)
      mat.depthWrite = false;
      mat.depthTest = false;
      mat.lights = false;
      mat.fog = false;
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha = THREE.OneFactor;
      mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      mat.blendEquation = THREE.AddEquation;
      mat.blendEquationAlpha = THREE.AddEquation;
      mat.positionNode = positionNode;
      mat.fragmentNode = fragment(back);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = mat.name;
      mesh.frustumCulled = false;
      mesh.renderOrder = back ? orderBack : orderFront;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    };
    this.meshBack = make(true);
    this.meshFront = make(false);
  }

  // --- linie pola magnetycznego: wstęgi 3D z testem głębi --------------------------------------------

  _buildLines(scene, order) {
    const U = this.U;
    const cap = PULSAR_BLASTS * LINES;
    const base = new THREE.PlaneGeometry(1, 1, LINE_SEG, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    // wybuch (indeks w uniformach), L [R], azymut pętli [rad], kąt startu θ0 [rad]
    this._lineAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geo.setAttribute('plL', this._lineAttr);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.lineGeo = geo;
    U.lC = v4Array(PULSAR_BLASTS, 'pulsarLC');   // środek xy (scena), R [j.], jasność
    U.lM = v4Array(PULSAR_BLASTS, 'pulsarLM');   // oś M, skala pętli
    U.lM1 = v4Array(PULSAR_BLASTS, 'pulsarLM1'); // m1 (⟂ M, wiruje z polem), —
    const vL = varyingProperty('vec4', 'vPulsL'); // w poprzek −1..1, wzdłuż 0..1, jasność, ziarno
    const mat = new THREE.NodeMaterial();
    mat.name = 'PulsarLines';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.side = THREE.DoubleSide;
    mat.forceSinglePass = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const Ln = attribute('plL', 'vec4');
      const bi = int(Ln.x.add(0.5)).toVar();
      const C = U.lC.element(bi).toVar();
      const Mv = U.lM.element(bi).toVar();
      const m1 = U.lM1.element(bi).xyz.toVar();
      const M = Mv.xyz.toVar();
      const m2 = cross(M, m1).toVar();
      const u = positionGeometry.x.add(0.5).toVar();
      const side = positionGeometry.y.mul(2.0).toVar();
      const Lr = Ln.y.mul(Mv.w).toVar();
      const ca = cos(Ln.z).toVar();
      const sa = sin(Ln.z).toVar();
      // Linia dipola: r = L·sin²θ w płaszczyźnie południkowej o azymucie Ln.z (układ osi M).
      const pt = (th) => {
        const st = sin(th);
        const r = Lr.mul(st).mul(st);
        return m1.mul(r.mul(st).mul(ca)).add(m2.mul(r.mul(st).mul(sa))).add(M.mul(r.mul(cos(th))));
      };
      const th = mix(Ln.w, float(Math.PI).sub(Ln.w), u).toVar();
      const p0 = pt(th).toVar();
      const p1 = pt(th.add(0.03)).toVar();
      const tan2 = p1.xy.sub(p0.xy).toVar();
      const perp = vec2(tan2.y.negate(), tan2.x).div(max(length(tan2), 1e-4));
      const w = max(C.z.mul(0.011), float(1.2).div(U.zoom));
      vL.assign(vec4(side, u, C.w, Ln.z.add(Ln.y.mul(7.0))));
      return vec3(C.xy.add(p0.xy.mul(C.z)).add(perp.mul(side.mul(w))), p0.z.mul(C.z).add(3.0));
    })();
    mat.fragmentNode = Fn(() => {
      const side = vL.x;
      const u = clamp(vL.y, 0.0, 1.0);
      const core = exp(side.mul(side).mul(-5.0)).toVar();
      const ends = smoothstep(0.0, 0.07, u).mul(float(1.0).sub(smoothstep(0.93, 1.0, u)));
      // Impulsy biegnące wzdłuż pętli od bieguna do bieguna i migotanie całej linii.
      const run = sin(u.mul(3.0).sub(U.time.mul(2.4)).add(vL.w).mul(TAU)).mul(0.5).add(0.5).toVar();
      const pulse = run.mul(run).mul(run).mul(0.75).add(0.25);
      const flick = sin(U.time.mul(47.0).add(vL.w.mul(13.0))).mul(0.25).add(0.75);
      const c = mix(vec3(...C_AZURE), vec3(...C_ICE), core.mul(core)).mul(core.mul(ends).mul(pulse).mul(flick).mul(vL.z));
      return vec4(max(c, vec3(0.0)), 0.0);
    })();
    this.lineMesh = new THREE.Mesh(geo, mat);
    this.lineMesh.name = 'pulsarLines';
    this.lineMesh.frustumCulled = false;
    this.lineMesh.renderOrder = order;
    this.lineMesh.visible = false;
    scene.add(this.lineMesh);
  }

  // --- reżyseria -------------------------------------------------------------------------------------

  /**
   * Nowy wybuch w (X, Y) sceny; cvx / cvy — nośnik [j./s] (trafiony kadłub w ruchu), R — promień powłoki [j.].
   * Bez wolnego miejsca zabiera najstarszy. Zwraca indeks.
   */
  spawn(X, Y, o = {}) {
    let i = this.blasts.findIndex((b) => !b.active);
    if (i < 0) {
      i = 0;
      for (let k = 1; k < this.blasts.length; k++) if (this.blasts[k].t > this.blasts[i].t) i = k;
    }
    const rng = this.rng;
    const b = this.blasts[i];
    b.active = true;
    b.x = X; b.y = Y;
    b.vx = o.cvx || 0; b.vy = o.cvy || 0;
    b.t = 0;
    b.R = o.R || PULSAR.R;
    b.seed = rng();
    // Oś obrotu S: 38–55° od osi kamery (dżety i dysk dobrze widać w rzucie), losowy azymut.
    const th = (38 + rng() * 17) * DEG;
    const az = rng() * TAU;
    const st = Math.sin(th);
    b.S[0] = st * Math.cos(az); b.S[1] = st * Math.sin(az); b.S[2] = Math.cos(th);
    // s1 = S × ẑ (znormalizowane), s2 = S × s1 — baza płaszczyzny równika (jak w shaderze).
    b.s1[0] = b.S[1] / st; b.s1[1] = -b.S[0] / st; b.s1[2] = 0;
    b.s2[0] = b.S[1] * b.s1[2] - b.S[2] * b.s1[1];
    b.s2[1] = b.S[2] * b.s1[0] - b.S[0] * b.s1[2];
    b.s2[2] = b.S[0] * b.s1[1] - b.S[1] * b.s1[0];
    b.mzHi = Math.cos(th - PULSAR.alpha);
    b.phi0 = rng() * TAU;
    b.rev = 0;
    b.pulse = 0; b.pulsePrev = 0; b.pulses = 0;
    b.detonated = false; b.collapsing = false;
    b.inAcc = 0; b.jetAcc = 0;
    this._axes(b);
    this._levels(b);
    this.stats.blasts++;
    return i;
  }

  // Oś magnetyczna M i wektor m1 (⟂ M, wiruje z polem) z fazy obrotu.
  _axes(b) {
    const ph = b.phi0 + b.rev * TAU;
    const cp = Math.cos(ph);
    const sp = Math.sin(ph);
    const ca = Math.cos(PULSAR.alpha);
    const sa = Math.sin(PULSAR.alpha);
    for (let k = 0; k < 3; k++) {
      const e1 = b.s1[k] * cp + b.s2[k] * sp;
      b.M[k] = b.S[k] * ca + e1 * sa;
      b.m1[k] = -b.S[k] * sa + e1 * ca;
    }
  }

  // Jasności i rozmiary bryły w chwili b.t (ładowanie → detonacja → pulsar → zapaść).
  _levels(b) {
    const P = PULSAR;
    const L = b.L;
    const a = b.t - P.charge;
    const c = clamp01(b.t / P.charge);
    const kEnd = clamp01((a - P.life) / P.collapse);
    const live = 1 - kEnd;
    const blink = kEnd > 0.8 ? ((kEnd - 0.8) / 0.2) ** 2 : 0;      // ostatni błysk tuż przed końcem
    L.a = a; L.c = c; L.kEnd = kEnd;
    if (a < 0) {
      L.Rs = 0.02; L.I1 = 0; L.I2 = 0; L.I3 = 0; L.Iring = 0;
      L.Lj = 0.3 + 0.6 * c; L.Ij = 0.18 * c * c;
      L.Icore = 0.3 + 2.2 * c * c * c;
      L.Idisk = Math.pow(c, 1.5);
      L.Iflash = 0; L.Iglow = 0.15 * c;
      L.lineI = c > 0.25 ? (c - 0.25) / 0.75 * 1.6 : 0;
      L.lineL = 0.35 + 0.25 * c;
      return;
    }
    L.Rs = (1 - Math.exp(-a / 0.3)) + 0.06 * a;
    // Powłoki: krótki jaśniejszy start, potem długo równy poziom (bańka ma być czytelna do zapaści).
    L.I1 = (0.16 + 0.17 * Math.exp(-a / 0.5)) * Math.exp(-a / 3.5) * live;
    L.I2 = (0.26 + 0.12 * Math.exp(-a / 0.6)) * smooth01(a / 0.3) * Math.exp(-a / 3.2) * live;
    L.I3 = 0.5 * Math.exp(-a / 0.3) * live;
    L.Iring = smooth01((a - 0.15) / 0.4) * (0.3 + 0.5 * Math.exp(-a / 1.2)) * (1 - kEnd * kEnd);
    L.Lj = Math.max(0.02, P.jetLen * (1 - Math.exp(-a / 0.14)) * (1 - 0.7 * kEnd) + 0.02);
    L.Ij = (1.0 * Math.exp(-a / 2.4) + 0.5 * Math.exp(-a / 0.3)) * live + 1.2 * blink;
    L.Icore = 3.5 * Math.exp(-a / 0.15) + 1.3 * Math.exp(-a / 2.6) + 2.5 * kEnd * kEnd + 6 * blink;
    L.Idisk = 0.8 * kEnd * live;
    L.Iflash = 2.2 * Math.exp(-a / 0.05) + 0.25 * Math.exp(-a / 0.22) + 0.9 * blink;
    L.Iglow = 0.22 * Math.exp(-a / 2.0) * live;
    L.lineI = (1.3 * Math.exp(-a / 2.6) + 0.35) * (1 + kEnd);
    L.lineL = (0.45 + 0.75 * (1 - Math.exp(-a / 0.35))) * (1 - Math.pow(kEnd, 1.5));
  }

  // Krok jednego wybuchu: obroty, pulsy, emisja cząstek, przejścia faz.
  _advance(b, slot, dt) {
    const P = PULSAR;
    const rng = this.rng;
    const pt = this.particles;
    b.t += dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const a = b.t - P.charge;
    const c = clamp01(b.t / P.charge);
    const kEnd = clamp01((a - P.life) / P.collapse);
    // Obroty: rozkręcanie w ładowaniu, hamowanie po detonacji, w zapaści znów w górę.
    let w = a < 0 ? P.spin0 * 1.25 * c * c : P.spin0 / (1 + a / P.spinTau);
    w += 7 * kEnd * kEnd;
    b.rev += w * dt;
    this._axes(b);
    // Puls: oś magnetyczna najbliżej osi kamery (raz na obrót).
    const pk = clamp01(1 - (b.mzHi - b.M[2]) / 0.14);
    b.pulse = a >= 0 ? pk * pk : 0;
    const beat = b.pulse > 0.6 && b.pulsePrev <= 0.6 && a > 0.25 && kEnd === 0;
    b.pulsePrev = b.pulse;
    if (a < 0) {
      // ŁADOWANIE: dopływ po spirali w płaszczyźnie równika (gęstnieje i zacieśnia się).
      b.inAcc += dt * 30000 * (0.3 + 0.7 * c);
      const n = Math.floor(b.inAcc);
      b.inAcc -= n;
      pt.burst(slot, PK.INFLOW, PSHAPE.PLANE, n, 0, 0, 1, 0, 0, 0, 0.3, 0.75, 0.45, 1.75 - 0.9 * c, 0, 3.6);
    } else {
      if (!b.detonated) {
        // DETONACJA: iskry powłoki i rozbryzg w płaszczyźnie równika.
        b.detonated = true;
        // (iskier niewiele i cienkie: tysiące addytywnych kresek w jednej bańce zlewały ją w białą plamę)
        pt.burst(slot, PK.SHELL, PSHAPE.SPHERE, 2200, 0, 0, 1, 0, 1.6, 3.8, 0.9, 2.4, 0.04, 0.12, 0, 3.2);
        pt.burst(slot, PK.EJECTA, PSHAPE.PLANE, 2200, 0, 0, 1, 0, 0.8, 2.8, 0.8, 2.2, 0.05, 0.2, 0.35, 3.2);
        this._kick = Math.max(this._kick, 18);
      }
      if (kEnd === 0) {
        // DŻETY: plazma wzdłuż ±M; oś się obraca, więc kolejne porcje lecą gdzie indziej — śruba na stożku.
        b.jetAcc += dt * 5200 * (0.35 + 0.65 * Math.exp(-a / 1.5));
        const n = Math.floor(b.jetAcc * 0.5);
        b.jetAcc -= n * 2;
        pt.burst(slot, PK.JET, PSHAPE.CONE, n, b.M[0], b.M[1], b.M[2], 0.05, 2.2, 3.6, 0.5, 1.1, 0.03, 0.07, 0.22, 2.6);
        pt.burst(slot, PK.JET, PSHAPE.CONE, n, -b.M[0], -b.M[1], -b.M[2], 0.05, 2.2, 3.6, 0.5, 1.1, 0.03, 0.07, 0.22, 2.6);
        if (beat) {
          // PULS: fala w wietrze — rozbryzg równikowy i garść iskier.
          b.pulses++;
          const k = Math.exp(-a / 2.4);
          pt.burst(slot, PK.EJECTA, PSHAPE.PLANE, Math.round(500 * k) + 120, 0, 0, 1, 0, 0.7, 1.7, 0.6, 1.5, 0.05, 0.14, 0.3, 3.2);
          pt.burst(slot, PK.SHELL, PSHAPE.SPHERE, Math.round(160 * k) + 50, 0, 0, 1, 0, 0.8, 2.0, 0.5, 1.2, 0.03, 0.08, 0, 3.2);
          this._kick = Math.max(this._kick, 2 + 4 * k);
        }
      } else if (!b.collapsing) {
        // ZAPAŚĆ: pył w całej bańce — kernel ściąga go do jądra.
        b.collapsing = true;
        pt.burst(slot, PK.MOTE, PSHAPE.SPHERE, 4200, 0, 0, 1, 0, 0.02, 0.2, 0.5, 0.9, 0.25, 1.25, 0.1, 5.0);
        pt.burst(slot, PK.INFLOW, PSHAPE.PLANE, 3500, 0, 0, 1, 0, 0, 0, 0.3, 0.6, 0.3, 1.3, 0, 4.5);
      }
    }
    if (a >= P.life + P.collapse) {
      // KONIEC: ostatni błysk — krótka fala iskier i garść drobin, które zostają i gasną.
      b.active = false;
      this.pops.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, t0: this.time, R: b.R });
      pt.setBlast(slot, b.x, b.y, 0, b.R, b.S[0], b.S[1], b.S[2], 0, b.vx, b.vy);
      pt.burst(slot, PK.SHELL, PSHAPE.SPHERE, 2600, 0, 0, 1, 0, 1.0, 3.2, 0.35, 1.0, 0.01, 0.05, 0, 4.5);
      pt.burst(slot, PK.MOTE, PSHAPE.SPHERE, 1400, 0, 0, 1, 0, 0.05, 0.45, 1.0, 2.4, 0.02, 0.3, 0.08, 4.5);
      this._kick = Math.max(this._kick, 8);
      return;
    }
    this._levels(b);
  }

  /**
   * Klatka: krok wybuchów (dt = 0 w pauzie — obraz stoi), instancje bryły i linii, cząstki, wyjścia dla reżysera
   * (światła, zniekształcenia, siły w dymie, wstrząs, ekspozycja, bloom). zoom — px ekranu na j.
   */
  update(dt, time, zoom = 1) {
    const P = PULSAR;
    this.time = time;
    this.U.time.value = time % 1000;
    this.U.zoom.value = zoom;
    this._kick = 0;
    this._nL = 0; this._nD = 0; this._nF = 0;
    this.exposure = 1;
    this.bloomBoost = 0;
    let rumble = 0;
    let n = 0;
    let nLines = 0;
    const [aA, aB, aC, aD, aE, aF, aG] = this._attrs.map((at) => at.array);
    const LA = this._lineAttr.array;
    const U = this.U;
    for (let i = 0; i < this.blasts.length; i++) {
      const b = this.blasts[i];
      if (b.active && dt > 0) this._advance(b, i, dt);
      if (!b.active) continue;
      const L = b.L;
      const o = n * 4;
      aA[o] = b.x; aA[o + 1] = b.y; aA[o + 2] = b.R; aA[o + 3] = P.bound;
      aB[o] = L.a; aB[o + 1] = L.c; aB[o + 2] = L.kEnd; aB[o + 3] = b.seed;
      aC[o] = b.S[0]; aC[o + 1] = b.S[1]; aC[o + 2] = b.S[2]; aC[o + 3] = b.rev;
      aD[o] = b.M[0]; aD[o + 1] = b.M[1]; aD[o + 2] = b.M[2]; aD[o + 3] = b.pulse;
      aE[o] = L.Rs; aE[o + 1] = L.I1; aE[o + 2] = L.I2; aE[o + 3] = L.Iring;
      aF[o] = L.Lj; aF[o + 1] = L.Ij; aF[o + 2] = L.Icore * (1 + 2.2 * b.pulse); aF[o + 3] = L.Idisk;
      aG[o] = L.Iflash; aG[o + 1] = L.Iglow; aG[o + 2] = L.I3; aG[o + 3] = 0;
      n++;
      // Linie pola: uniformy wybuchu + instancje pętli.
      U.lC.array[i].set(b.x, b.y, b.R, L.lineI);
      U.lM.array[i].set(b.M[0], b.M[1], b.M[2], L.lineL);
      U.lM1.array[i].set(b.m1[0], b.m1[1], b.m1[2], 0);
      if (L.lineI > 0.01 && L.lineL > 0.02) {
        for (let s = 0; s < P.lineShells.length; s++) {
          const Ls = P.lineShells[s];
          const th0 = Math.asin(Math.sqrt(Math.min(1, P.lineStar / Ls)));
          for (let k = 0; k < P.lineAz; k++) {
            const q = nLines * 4;
            LA[q] = i; LA[q + 1] = Ls; LA[q + 2] = (k + s * 0.5) / P.lineAz * TAU; LA[q + 3] = th0;
            nLines++;
          }
        }
      }
      // Cząstki: stan wybuchu dla kerneli.
      this.particles.setBlast(i, b.x, b.y, 0, b.R, b.S[0], b.S[1], b.S[2], L.kEnd, b.vx, b.vy);
      rumble = Math.max(rumble, this._outputs(b, zoom));
    }
    // Ostatnie błyski po zapaści: fala i światło przez 0,5 s.
    for (let k = this.pops.length - 1; k >= 0; k--) {
      const pp = this.pops[k];
      const a = time - pp.t0;
      if (a > 0.5 || a < 0) { this.pops.splice(k, 1); continue; }
      const x = pp.x + pp.vx * a;
      const y = pp.y + pp.vy * a;
      const f = 1 - a / 0.5;
      this._dist_(0, x, y, pp.R * 1.7 * (1 - Math.exp(-a / 0.2)), 70, 18 * f * f, 0.45, 1, 0.6);
      this._light(x, y, 150, 4200, 0.55, 0.8, 1.0, 5 * Math.exp(-a / 0.09), 0, 0, -1, -2, 0);
      this.bloomBoost = Math.max(this.bloomBoost, 0.7 * Math.exp(-a / 0.12));
    }
    this.geo.instanceCount = n;
    this.meshBack.visible = n > 0;
    this.meshFront.visible = n > 0;
    if (n) {
      for (const at of this._attrs) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * 4);
        at.needsUpdate = true;
      }
    }
    this.lineGeo.instanceCount = nLines;
    this.lineMesh.visible = nLines > 0;
    if (nLines) {
      this._lineAttr.clearUpdateRanges();
      this._lineAttr.addUpdateRange(0, nLines * 4);
      this._lineAttr.needsUpdate = true;
    }
    this.particles.update(dt, time, zoom);
    this.shake = Math.max(rumble, this._kick);
    this._lights.length = this._nL;
    this._dist.length = this._nD;
    this.forces.length = this._nF;
    this.stats.live = n;
  }

  _light(x, y, z, range, r, g, b, I, dx, dy, dz, cosOuter, cosInner) {
    if (!(I > 0.01)) return;
    let L = this._lights[this._nL];
    if (!L) L = this._lights[this._nL] = {};
    this._nL++;
    L.x = x; L.y = y; L.z = z; L.range = range; L.r = r * I; L.g = g * I; L.b = b * I;
    L.dx = dx; L.dy = dy; L.dz = dz; L.cosOuter = cosOuter; L.cosInner = cosInner;
  }

  // Źródło zniekształcenia: cap — sufit siły [px] na jednostkę zoomu (daleki zoom nie zawija obrazu).
  _dist_(type, x, y, radius, width, strength, disp, scale, cap) {
    if (!(strength > 0.02)) return;
    let D = this._dist[this._nD];
    if (!D) D = this._dist[this._nD] = {};
    this._nD++;
    D.type = type; D.x = x; D.y = y; D.radius = radius; D.width = width; D.strength = strength; D.disp = disp; D.scale = scale; D.cap = cap;
  }

  _force(x, y, front, width, strength, type, reach) {
    let F = this.forces[this._nF];
    if (!F) F = this.forces[this._nF] = {};
    this._nF++;
    F.x = x; F.y = y; F.front = front; F.width = width; F.strength = strength; F.type = type; F.reach = reach;
  }

  // Światła, zniekształcenia, siły w dymie i obraz całego kadru dla wybuchu b; zwraca dudnienie (wstrząs).
  _outputs(b) {
    const P = PULSAR;
    const L = b.L;
    const a = L.a;
    const c = L.c;
    const kEnd = L.kEnd;
    const R = b.R;
    const x = b.x;
    const y = b.y;
    // Jądro: światło dookólne (puls dokłada błysk na kadłubach).
    const core = Math.min(9, 0.5 * L.Icore * (1 + 1.6 * b.pulse) + 2.5 * L.Iflash);
    this._light(x, y, 140, R * (5 + 3 * Math.min(1, L.Iflash)), 0.55, 0.8, 1.0, core, 0, 0, -1, -2, 0);
    // Dżety: dwa snopy omiatające płaszczyznę gry (rzut osi M; im bardziej oś w płaszczyźnie, tym mocniej).
    const mxy = Math.sqrt(b.M[0] * b.M[0] + b.M[1] * b.M[1]);
    if (mxy > 0.2 && L.Ij > 0.05) {
      const I = 2.6 * L.Ij * mxy * mxy;
      const ux = b.M[0] / mxy;
      const uy = b.M[1] / mxy;
      const co = Math.cos(13 * DEG);
      const ci = Math.cos(5 * DEG);
      this._light(x, y, 70, R * 9, 0.5, 0.78, 1.0, I, ux, uy, -0.08, co, ci);
      this._light(x, y, 70, R * 9, 0.5, 0.78, 1.0, I, -ux, -uy, -0.08, co, ci);
    }
    let rumble = 0;
    if (a < 0) {
      // ŁADOWANIE: soczewka i skręcenie przestrzeni narastają, dym wsysany, obraz przygasa (tuż przed błyskiem mocno).
      const c2 = c * c;
      // (mała dyspersja barw: przy dużej drobne cząstki dysku rozszczepiały się w kolorowy szum)
      this._dist_(1, x, y, R * 1.35, 0, 34 * c2, 0.12, 1, 70);
      this._dist_(3, x, y, R * 1.7, 0, 46 * Math.pow(c, 1.5), 0.08, 1, 95);
      this._force(x, y, 0, 70, 7000 * c, 1, R * 2.0);
      this.exposure = Math.min(this.exposure, 1 - 0.26 * smooth01(c) - 0.22 * smooth01((b.t - (P.charge - 0.07)) / 0.07));
      rumble = 5.5 * c2;
    } else {
      // DETONACJA i PULSAR: fala (sama refrakcja) z falą odbitą, trwałe lekkie ugięcie i skręcenie wokół jądra.
      if (a < 1.2) {
        const f = 1 - a / 1.2;
        const rr = R * 5.2 * (1 - Math.exp(-a / 0.4));
        this._dist_(0, x, y, rr, 170 * (1 + a * 0.8), 34 * f * f, 0.45, 1, 0.6);
        this._dist_(0, x, y, rr * 0.6, 120 * (1 + a * 0.8), 14 * f * f, 0.45, 1, 0.6);
        this._force(x, y, R * 4.4 * (1 - Math.exp(-a / 0.42)), 200 * (1 + a * 1.5), 15000 * f * f, 0, 0);
      }
      const hold = Math.exp(-a / 1.6) * (1 - kEnd);
      this._dist_(1, x, y, R * 0.9, 0, 9 * hold + 26 * kEnd * kEnd, 0.12, 1, 60);
      this._dist_(3, x, y, R * 1.5, 0, 12 * hold + 4 * b.pulse * hold + 40 * kEnd * kEnd, 0.08, 1, 90);
      if (kEnd > 0) this._force(x, y, 0, 70, 5000 * kEnd, 1, R * 1.6);
      this.exposure = Math.min(this.exposure, 1 - 0.3 * Math.exp(-a / 0.05) - 0.16 * kEnd * kEnd);
      this.bloomBoost = Math.max(this.bloomBoost, 0.45 * Math.exp(-a / 0.22) + 0.1 * b.pulse * Math.exp(-a / 2.4));
      rumble = 2.5 * Math.exp(-a / 0.9) + 4 * kEnd * kEnd;
    }
    return rumble;
  }

  /** Światła wybuchów do siatki dema (scena). */
  addLights(grid) {
    let n = 0;
    for (let i = 0; i < this._nL; i++) {
      const L = this._lights[i];
      if (grid.add(L.x, L.y, L.z, L.range, L.r, L.g, L.b, 1.0, L.dx, L.dy, L.dz, L.cosOuter, L.cosInner) >= 0) n++;
    }
    return n;
  }

  /** Źródła zniekształceń (scena); zoom — px ekranu na j. (sufit siły z zoomu). */
  fillDistortion(post, zoom = 1) {
    for (let i = 0; i < this._nD; i++) {
      const D = this._dist[i];
      // typ 0 (fala): sufit na px grubości frontu; soczewka i skręcenie: sufit na jednostkę zoomu
      const cap = D.type === 0 ? D.width * zoom * D.cap : zoom * D.cap;
      post.add(D.type, D.x, D.y, D.radius, D.width, Math.min(D.strength, cap), D.disp, D.scale);
    }
  }

  /** Rozgrzewka: puste dispatche kerneli cząstek (potoki siatek — klatką rozgrzewki dema). */
  warm() {
    this.particles.warm();
  }

  clear() {
    for (const b of this.blasts) b.active = false;
    this.pops.length = 0;
    this.particles.clear();
    this.geo.instanceCount = 0;
    this.lineGeo.instanceCount = 0;
    this.meshBack.visible = false;
    this.meshFront.visible = false;
    this.lineMesh.visible = false;
    this._nL = 0; this._nD = 0; this._nF = 0;
    this._lights.length = 0; this._dist.length = 0; this.forces.length = 0;
    this.shake = 0; this.exposure = 1; this.bloomBoost = 0;
  }
}
