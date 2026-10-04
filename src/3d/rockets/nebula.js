// src/3d/rockets/nebula.js
//
// POZOSTAŁOŚĆ SUPERNOWEJ (port z dema dema/rakiety-webgpu/nebula.js, zadanie 19; WIR —
// 2026-09-30) — dziesiątki tysięcy cząstek generowanych na GPU (compute, jedno zlecenie na
// wybuch — CPU nie dotyka cząstek) i poruszanych analitycznie w shaderze wierzchołków:
//   • kierunek z hasha (równomiernie na sferze), prędkość zależna od kierunku (duże płaty
//     szumu 3D) — powłoka nie jest kulą, rosną z niej „palce” jak niestabilność
//     Rayleigha–Taylora;
//   • jasność z grzbietów szumu (włókna), barwa ze składników pozostałości supernowych:
//     Hα (róż) we włóknach, [O III] (turkus) na szybkich płatach, [S II] (czerwień)
//     w zagęszczeniach; gorące wnętrze błękitno-białe;
//   • hamowanie r(t) = v·(1 − e^(−k·t))/k (faza Sedova w skrócie), rzut na płaszczyznę gry:
//     pojaśnienie brzegu powłoki wychodzi samo z geometrii, bez rysowanego pierścienia
//     (feedback użytkownika: żadnych świecących okręgów);
//   • WIR (feedback 2026-09-30: „nie ma animacji, tylko się powiększa”): obrót RÓŻNICOWY wokół
//     jądra — wnętrze szybciej niż brzeg, więc promieniste włókna nawijają się w ramiona spirali,
//     które kręcą się przez całe życie pozostałości; kłęby wyciągnięte wzdłuż ramion;
//   • PRZEPŁYW: przesunięcie z szumu 3D (przekrój = czas) — materia kłębi się i płynie, zamiast
//     stać po zatrzymaniu fali;
//   • FALA JASNOŚCI przez powłokę (wtórne fronty) i MIGOTANIE zagęszczeń;
//   • DŻETY PULSARA: strumień cząstek wyrzucanych przez całe życie wzdłuż OBRACAJĄCEJ SIĘ osi
//     (dwa przeciwne kierunki) — cząstki lecą prosto, a oś się kręci, więc razem kreślą podwójną
//     spiralę (zraszacz); oś tę samą rysuje reżyser jako wirujące snopy światła z jądra (effects.js).
// Pasmo HDR ciała 0,3–1,2 po sumowaniu, zagęszczenia do ~3 — iskrzą w bloomie.
//
// Środek wybuchu lokalnie względem początku pul Core3D (przeskok: kernel przesunięcia
// środków), czas narodzin w zegarze reżysera względem jego epoki. Ziarno z fxRandom.
// Parametry wiru (obrót, oś dżetów) są PER WYBUCH: kernel wpisuje je do cząstek (nE.w — obrót;
// dżety — kierunek i czas wyrzutu w nA), więc kilka pozostałości naraz kręci się niezależnie.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, instancedArray, instanceIndex, hash, texture3D,
  positionGeometry, uv, varyingProperty, If, Return, Loop, Break, select, mix, smoothstep, clamp, exp, sqrt,
  cos, sin, atan, round, max, min, abs, dot, length, normalize, cross
} from 'three/tsl';
import { NEBULA_COLORS } from './palette.js';
import { createShiftKernel } from '../fx/gpuPoolOrigin.js';

export const NEBULA_CAP = 1 << 18;
export const NEBULA_EVENTS = 8;

/** Rodzaje cząstek pozostałości (nC.w). */
export const NEB_FILAMENT = 0;
export const NEB_HOT = 1;
export const NEB_KNOT = 2;
export const NEB_SHELL = 3;
export const NEB_JET = 4;

/** Wir: udział obrotu brzegu (0,28) i wnętrza (1) — ω(ρ) = spin · (A + (1 − A)·(1 − ρ)²). */
export const SWIRL_RIM = 0.28;

export class NebulaSystem {
  constructor({ scene, origin, noise3D, rng, renderOrder = 75 }) {
    this.origin = origin;
    this.rng = rng;
    this.head = 0;
    this.highWater = 0;
    // Zdarzenia (wybuchy) — do wygaszenia puli: narodziny i życie w zegarze reżysera (lokalnie).
    this.evT0 = new Float64Array(NEBULA_EVENTS);
    this.evLife = new Float32Array(NEBULA_EVENTS);
    this.evN = new Int32Array(NEBULA_EVENTS);
    this.evCount = 0;
    this.nA = instancedArray(NEBULA_CAP, 'vec4').setName('rocketNebA'); // kierunek, t0 (dżet: t0 wyrzutu)
    this.nB = instancedArray(NEBULA_CAP, 'vec4').setName('rocketNebB'); // prędkość, włókno, rozmiar, życie
    this.nC = instancedArray(NEBULA_CAP, 'vec4').setName('rocketNebC'); // w[O III], w[S II], jasność, rodzaj
    this.nD = instancedArray(NEBULA_CAP, 'vec4').setName('rocketNebD'); // środek xy (lokalnie), ułamek promienia, ziarno
    this.nE = instancedArray(NEBULA_CAP, 'vec4').setName('rocketNebE'); // kierunek włókna (xyz, na sferze), obrót wiru [rad/s]
    this.U = {
      time: uniform(0),
      zoom: uniform(1),
      gain: uniform(1),
      start: uniform(0, 'uint'),
      count: uniform(0, 'uint'),
      seed: uniform(0, 'uint'),
      center: uniform(new THREE.Vector2()),
      t0: uniform(0),
      speed: uniform(1500),
      size: uniform(9),
      life: uniform(3.6),
      // Wir i dżety (per wybuch — wpisywane do cząstek w kernelu). Ramiona: liczba (2–3) i kąt
      // pierwszego — materia ściąga się do nich już przy wybuchu, obrót różnicowy nawija je w spiralę.
      arms: uniform(3),
      armPhase: uniform(0),
      spin: uniform(1),
      jetA0: uniform(0),
      jetOmega: uniform(2.4),
      jetSpeed: uniform(1000),
      jetSpan: uniform(4),
      jetLife: uniform(1.2),
      cHa: uniform(new THREE.Vector3(...NEBULA_COLORS.halpha)),
      cO3: uniform(new THREE.Vector3(...NEBULA_COLORS.oiii)),
      cS2: uniform(new THREE.Vector3(...NEBULA_COLORS.sii)),
      cHot: uniform(new THREE.Vector3(...NEBULA_COLORS.hot)),
      cJet: uniform(new THREE.Vector3(...NEBULA_COLORS.jet))
    };
    this._buildInit(noise3D);
    this._buildRender(scene, renderOrder, noise3D);
    this.shiftNode = createShiftKernel(origin, { buffer: this.nD, capacity: NEBULA_CAP, pos: [[0, 'xy']], name: 'rocketNebulaShift' });
    const sys = this;
    this.originEntry = origin.register({
      shiftNode: this.shiftNode,
      isLive: () => sys.highWater > 0,
      get dispatchCount() { return Math.max(1, sys.highWater); }
    });
  }

  _buildInit(noise3D) {
    const U = this.U;
    const { nA, nB, nC, nD, nE } = this;
    const ridgeAt = (d, seedOff) => {
      const f0 = texture3D(noise3D, d.mul(1.1).add(seedOff.mul(1.9))).level(0).y;
      const f1 = texture3D(noise3D, d.mul(2.3).add(seedOff.mul(0.7))).level(0).x;
      return float(1.0).sub(abs(f0.mul(0.65).add(f1.mul(0.35)).mul(2.0).sub(1.0)));
    };
    this.initNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const slot = U.start.add(instanceIndex).mod(uint(NEBULA_CAP)).toVar();
      const s = instanceIndex.mul(uint(747796405)).add(U.seed.mul(uint(2891336453))).toVar();
      const h3 = hash(s.bitXor(uint(0xB5297A4D)));
      const h4 = hash(s.bitXor(uint(0x1B56C4E9)));
      const h5 = hash(s.bitXor(uint(0x3C6EF372)));
      const h6 = hash(s.bitXor(uint(0x7F4A7C15)));
      const h7 = hash(s.bitXor(uint(0x2545F491)));
      const seedOff = vec3(float(U.seed.mod(uint(97))).mul(0.137), float(U.seed.mod(uint(89))).mul(0.211), 0.37);
      // Populacje: 1 gorące wnętrze (10%) — wirujący dysk przy jądrze, 2 zagęszczenia (3%),
      // 3 rozmyta powłoka [O III] (13%), 4 dżety pulsara (14%), 0 włókna (60%).
      const kind = select(h3.lessThan(0.10), float(1.0),
        select(h3.lessThan(0.13), float(2.0),
          select(h3.lessThan(0.26), float(3.0),
            select(h3.lessThan(0.40), float(4.0), float(0.0))))).toVar();
      // Kierunek: dla włókien i zagęszczeń próbkowanie z odrzucaniem — do 10 prób, aż
      // kierunek trafi na grzbiet szumu (sieć włókien na sferze).
      const dir = vec3(0.0, 0.0, 1.0).toVar();
      const fil = float(0.0).toVar();
      const onRidge = kind.equal(0.0).or(kind.equal(2.0));
      const tries = select(onRidge, int(10), int(1));
      Loop({ start: int(0), end: tries, type: 'int', condition: '<', name: 'nebTry' }, ({ nebTry }) => {
        const si = s.add(uint(nebTry).mul(uint(0x9E3779B9))).toVar();
        const z = hash(si).mul(2.0).sub(1.0).toVar();
        const phi = hash(si.bitXor(uint(0x68E31DA4))).mul(6.2831853);
        const rxy = sqrt(max(float(1.0).sub(z.mul(z)), 0.0));
        const d = vec3(rxy.mul(cos(phi)), rxy.mul(sin(phi)), z).toVar();
        const ridge = ridgeAt(d, seedOff);
        const r2 = ridge.mul(ridge);
        dir.assign(d);
        fil.assign(r2.mul(r2));
        If(fil.greaterThan(0.62), () => { Break(); });
      });
      // RAMIONA WIRU: kąt rzutu ściągnięty w 55 % ku najbliższemu ramieniu (arms co 2π/arms od
      // armPhase) — z wybuchu wychodzą szprychy gęstej materii, a obrót różnicowy (render) nawija je
      // w spiralę; między ramionami zostają ciemne przerwy. Dżety i gorące wnętrze bez ramion.
      const inArms = kind.equal(0.0).or(kind.equal(2.0)).or(kind.equal(3.0));
      const armStep = float(6.2831853).div(U.arms);
      const phiD = atan(dir.y, dir.x);
      const armU = phiD.sub(U.armPhase).div(armStep);
      const armF = armU.sub(round(armU)).toVar();
      const pullA = select(inArms, armF.mul(armStep).mul(-0.55), float(0.0));
      const cA = cos(pullA);
      const sA = sin(pullA);
      dir.assign(vec3(dir.x.mul(cA).sub(dir.y.mul(sA)), dir.x.mul(sA).add(dir.y.mul(cA)), dir.z));
      // Waga ramienia (1 — oś ramienia, 0 — środek przerwy, z kąta PRZED ściągnięciem): mnoży jasność.
      const armC = cos(armF.mul(3.14159265));
      const armW = select(inArms, armC.mul(armC), float(1.0));
      // Kierunek włókna: prostopadły do gradientu grzbietu w płaszczyźnie stycznej.
      const up = select(abs(dir.z).lessThan(0.9), vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0));
      const t1 = normalize(cross(up, dir)).toVar();
      const t2 = cross(dir, t1).toVar();
      const e = float(0.02);
      const g1 = ridgeAt(normalize(dir.add(t1.mul(e))), seedOff).sub(ridgeAt(normalize(dir.sub(t1.mul(e))), seedOff));
      const g2 = ridgeAt(normalize(dir.add(t2.mul(e))), seedOff).sub(ridgeAt(normalize(dir.sub(t2.mul(e))), seedOff));
      const fdir = t1.mul(g2.negate()).add(t2.mul(g1)).toVar();
      const lobe = texture3D(noise3D, dir.mul(0.42).add(seedOff)).level(0).x.toVar();
      const lobeK = smoothstep(0.25, 0.8, lobe);
      const speed = U.speed.mul(mix(float(0.7), float(1.25), lobeK)).mul(h4.mul(0.12).add(0.94)).toVar();
      const frac = select(kind.equal(1.0), h5.mul(0.6), select(kind.equal(3.0), h5.mul(0.2).add(0.8), h5.mul(0.08).add(0.92))).toVar();
      // Jasność: włókna z grzbietów szumu, ramiona jaśniejsze od przerw (ciemne pasy między nimi).
      const bright = select(kind.equal(1.0), float(0.75),
        select(kind.equal(2.0), float(2.4),
          select(kind.equal(3.0), float(0.2), mix(float(0.12), float(1.0), smoothstep(0.35, 0.9, fil)))))
        .mul(armW.mul(0.8).add(0.2));
      // Barwy: [O III] na rozmytej powłoce i szybkich płatach, [S II] w zagęszczeniach.
      const wO3 = select(kind.equal(3.0), float(1.0), smoothstep(0.55, 0.85, lobe).mul(0.8));
      const wS2 = select(kind.equal(2.0), float(0.6), smoothstep(0.55, 0.85, h4).mul(0.35));
      const life = U.life.mul(select(kind.equal(1.0), float(0.62), h5.mul(0.3).add(0.8)));
      const size = U.size.mul(select(kind.equal(3.0), float(2.2), select(kind.equal(2.0), float(1.3), h3.mul(0.6).add(0.7))));
      // Dżet pulsara: wyrzut w chwili τ z osi obróconej o ω·τ (+ π — drugi dżet), stożek ±3,5°.
      const tau = h5.mul(U.jetSpan);
      const side = select(h4.lessThan(0.5), float(0.0), float(3.14159265));
      const th = U.jetA0.add(U.jetOmega.mul(tau)).add(side).add(h6.sub(0.5).mul(0.12));
      const jetDir = vec3(cos(th), sin(th), 0.0);
      const isJet = kind.equal(4.0);
      nA.element(slot).assign(select(isJet, vec4(jetDir, U.t0.add(tau)), vec4(dir, U.t0)));
      nB.element(slot).assign(select(isJet,
        vec4(U.jetSpeed.mul(h7.mul(0.4).add(0.8)), 0.0, U.size.mul(h3.mul(0.7).add(1.0)), U.jetLife.mul(h7.mul(0.5).add(0.75))),
        vec4(speed, select(kind.equal(3.0), float(0.0), fil), size, life)));
      nC.element(slot).assign(vec4(wO3, wS2, select(isJet, h6.mul(0.5).add(0.7), bright), kind));
      nD.element(slot).assign(vec4(U.center, select(isJet, float(1.0), frac), h4));
      // Dżet: zamiast kierunku włókna — ω/v osi dżetu (render kładzie cząstkę wzdłuż spirali, którą
      // kreśli strumień: styczna do śladu = −kierunek + r·(ω/v)·prostopadła).
      const jetSpeedP = U.jetSpeed.mul(h7.mul(0.4).add(0.8));
      nE.element(slot).assign(vec4(
        select(isJet, vec3(U.jetOmega.div(max(jetSpeedP, 1.0)), 0.0, 0.0), fdir.div(max(length(fdir), 1e-5))),
        U.spin.mul(h7.mul(0.16).add(0.92))));
    })().compute(NEBULA_CAP).setName('rocketNebulaInit');
  }

  _buildRender(scene, renderOrder, noise3D) {
    const U = this.U;
    const { nA, nB, nC, nD, nE } = this;
    const vCol = varyingProperty('vec3', 'vRkNbCol');
    const mat = new THREE.NodeMaterial();
    mat.name = 'RocketNebula';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const A = nA.element(instanceIndex).toVar();
      const B = nB.element(instanceIndex).toVar();
      const C = nC.element(instanceIndex).toVar();
      const D = nD.element(instanceIndex).toVar();
      const E = nE.element(instanceIndex).toVar();
      const age = U.time.sub(A.w).toVar();
      const life = B.w;
      const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
      const ageN = clamp(age.div(max(life, 1e-3)), 0.0, 1.0).toVar();
      const isJet = C.w.equal(4.0);
      const k = float(1.05);
      const fil = B.y;
      // Droga: powłoka hamuje (Sedov), dżet leci prawie prosto (lekkie hamowanie w ośrodku).
      const rShell = B.x.mul(float(1.0).sub(exp(age.negate().mul(k)))).div(k).mul(D.z);
      const rJet = B.x.mul(age).mul(float(1.0).sub(ageN.mul(0.2)));
      const r = select(isJet, rJet, rShell).toVar();
      // WIR: obrót różnicowy wokół jądra (wnętrze rzutu szybciej niż brzeg) — promieniste włókna
      // nawijają się w ramiona spirali i kręcą przez całe życie. ρ — promień rzutu (0 środek, 1 brzeg).
      const dirXY = A.xy;
      const rho = clamp(length(dirXY).mul(D.z), 0.0, 1.0).toVar();
      const inner = float(1.0).sub(rho);
      const spin = E.w;
      const tS = max(age.sub(0.1), 0.0);
      const swirlK = select(isJet, float(0.3), float(1.0));
      const phiS = spin.mul(float(SWIRL_RIM).add(inner.mul(inner).mul(1.0 - SWIRL_RIM))).mul(tS).mul(swirlK).toVar();
      const cx = cos(phiS);
      const sx = sin(phiS);
      const d2 = vec2(dirXY.x.mul(cx).sub(dirXY.y.mul(sx)), dirXY.x.mul(sx).add(dirXY.y.mul(cx))).toVar();
      // PRZEPŁYW: przesunięcie z szumu 3D współporuszającego się z wirem (przekrój = czas).
      const nq = texture3D(noise3D, vec3(d2.x.mul(0.45).add(D.w.mul(0.31)), d2.y.mul(0.45).add(D.w.mul(0.17)), age.mul(0.07).add(D.w.mul(0.5)))).level(0);
      const flowK = smoothstep(0.12, 1.1, age).mul(select(isJet, float(0.35), float(1.0))).mul(0.22);
      const flow = vec2(nq.x.sub(0.5), nq.y.sub(0.5)).mul(r.mul(flowK));
      const center = D.xy.add(d2.mul(r)).add(flow);
      const env = select(isJet,
        smoothstep(0.0, 0.05, age).mul(float(1.0).sub(smoothstep(0.45, 1.0, ageN))),
        smoothstep(0.0, 0.07, age).mul(float(1.0).sub(smoothstep(0.35, 1.0, ageN))));
      // Barwa: gorący błysk na starcie → składniki pozostałości → późne ciemnienie w [S II];
      // zewnętrzny brzeg wiru turkusowy ([O III] na froncie), ramiona różowe (Hα).
      const ha = U.cHa;
      const wO3 = clamp(C.x.add(smoothstep(0.7, 1.0, rho).mul(0.45)), 0.0, 1.0);
      const mixed = mix(mix(ha, U.cO3, wO3), U.cS2, C.y);
      const shell = select(C.w.equal(1.0), U.cHot, mixed);
      const late = smoothstep(0.45, 1.0, ageN);
      const shellLate = mix(shell, U.cS2.mul(0.9), late.mul(0.4));
      const jetCol = mix(U.cJet.mul(1.35), U.cO3.mul(1.05), smoothstep(0.15, 0.85, ageN));
      const hotStart = exp(age.div(-0.22));
      const col = mix(select(isJet, jetCol, shellLate), U.cHot.mul(1.6), hotStart.mul(select(isJet, float(0.0), float(0.85))));
      // Fala jasności biegnąca przez powłokę (wtórne fronty) i migotanie zagęszczeń.
      const wave = sin(rho.mul(11.0).sub(age.mul(2.6)).add(D.w.mul(6.28318))).mul(0.24).add(0.8);
      const tw = max(sin(age.mul(D.w.mul(9.0).add(7.0)).add(D.w.mul(40.0))), 0.0);
      const tw2 = tw.mul(tw);
      const twinkle = select(C.w.equal(2.0), tw2.mul(tw2).mul(1.4).add(0.45), float(1.0));
      // Świeża plazma: szerokie, gładkie plamy; potem włókna wzdłuż ekspansji i ramion wiru. Kłęby
      // większe i ciemniejsze niż w demie (gładki gaz zamiast „sierści” pojedynczych kresek).
      const early = exp(age.div(-0.28));
      const sizeW = B.z.mul(r.div(700.0).add(0.6)).mul(early.mul(1.6).add(1.0))
        .mul(select(isJet, ageN.mul(0.9).add(0.55), float(1.3))).toVar();
      const px = sizeW.mul(U.zoom).toVar();
      const pxC = max(px, 2.0);
      const energy = min(px.div(pxC), 1.0);
      const radial = d2.div(max(length(d2), 0.05)).toVar();
      const fl = vec2(E.x.mul(cx).sub(E.y.mul(sx)), E.x.mul(sx).add(E.y.mul(cx)));
      const flL = length(fl);
      // Rzut kierunku włókna (krótki, gdy włókno biegnie ku kamerze → promień).
      const axis0 = mix(radial, fl.div(max(flL, 1e-3)), smoothstep(0.15, 0.5, flL).mul(0.85));
      // Ramię spirali: kierunek (1, ρ·dφ/dρ) w bazie (promieniowa, styczna) — z czasem kłęby
      // kładą się wzdłuż ramion wiru.
      const shear = rho.mul(spin).mul(tS).mul(inner).mul(-2.0 * (1.0 - SWIRL_RIM)).mul(swirlK);
      const tang = vec2(radial.y.negate(), radial.x);
      const arm = radial.add(tang.mul(shear));
      const armN = arm.div(max(length(arm), 1e-3));
      const shearK = smoothstep(0.2, 1.4, abs(shear)).mul(0.8);
      const axisW = mix(axis0.div(max(length(axis0), 1e-3)), armN, shearK);
      // Dżet: cząstka wzdłuż spirali strumienia (ciągła wstęga zamiast promienistych „ości”).
      const jetTan = radial.negate().add(tang.mul(r.mul(E.x)));
      const jetAxis = jetTan.div(max(length(jetTan), 1e-3));
      const axis = select(isJet, jetAxis, axisW.div(max(length(axisW), 1e-3))).toVar();
      const stretch = select(isJet, float(3.2), mix(float(1.1).add(fil.mul(2.0)), float(1.0), early));
      const perp = vec2(axis.y.negate(), axis.x);
      const g = positionGeometry.xy;
      const wPx = pxC.div(U.zoom);
      const q = axis.mul(g.x.mul(wPx).mul(stretch)).add(perp.mul(g.y.mul(wPx).mul(0.7))).mul(select(alive, float(1.0), float(0.0)));
      const areaK = select(isJet, float(1.0), float(0.62));
      vCol.assign(col.mul(C.z).mul(env).mul(wave).mul(twinkle).mul(energy.mul(energy)).mul(U.gain).mul(areaK).div(stretch.mul(0.35).add(0.65)));
      return vec3(center.add(q), 26.0);
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0);
      const d = dot(q, q);
      const g = exp(d.mul(-4.0)).mul(float(1.0).sub(smoothstep(0.6, 1.0, d)));
      return vec4(vCol.mul(g), 0.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'RocketNebula';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  /**
   * Nowa pozostałość w (x, y) ŚWIATA gry; czas lokalny reżysera; liczba cząstek (przycięta
   * do wolnego miejsca w pierścieniu przy kilku naraz), prędkość, rozmiar, życie, jasność;
   * wir: obrót [rad/s] (znak — kierunek), oś dżetów na starcie i jej obrót (układ SCENY: y w górę),
   * prędkość, czas wyrzutu i życie cząstek dżetu.
   */
  spawn(renderer, time, x, y, count = 98304, speed = 1500, size = 9, life = 3.8, gain = 1,
    spin = 1, jetA0 = 0, jetOmega = 2.4, jetSpeed = 1000, jetSpan = 4, jetLife = 1.2, arms = 3, armPhase = 0) {
    const U = this.U;
    let n = Math.min(count, NEBULA_CAP);
    // Kilka supernowych naraz (salwa 4 wyrzutni): nie zjadać cząstek żywej pozostałości —
    // przycięcie do wolnej części pierścienia (najmniej 25 %).
    let used = 0;
    for (let e = 0; e < this.evCount; e++) used += this.evN[e];
    if (used > 0) n = Math.max(Math.floor(n * 0.25), Math.min(n, NEBULA_CAP - Math.min(NEBULA_CAP, used)));
    U.start.value = this.head;
    U.count.value = n;
    U.seed.value = this.rng.uint32();
    U.center.value.set(x - this.origin.x, -y - this.origin.y);
    U.t0.value = time;
    U.speed.value = speed;
    U.size.value = size;
    U.life.value = life;
    U.gain.value = gain;
    U.spin.value = spin;
    U.jetA0.value = jetA0;
    U.jetOmega.value = jetOmega;
    U.jetSpeed.value = jetSpeed;
    U.jetSpan.value = jetSpan;
    U.jetLife.value = jetLife;
    U.arms.value = Math.max(1, Math.round(arms) || 3);
    U.armPhase.value = armPhase;
    renderer.compute(this.initNode, n);
    this.head = (this.head + n) % NEBULA_CAP;
    this.highWater = Math.min(NEBULA_CAP, Math.max(this.highWater, this.head === 0 ? NEBULA_CAP : this.head));
    if (this.head < n) this.highWater = NEBULA_CAP;
    let e = this.evCount;
    if (e < NEBULA_EVENTS) {
      this.evCount++;
    } else {
      // Pełna lista: nadpisz najstarsze zdarzenie.
      e = 0;
      for (let k = 1; k < NEBULA_EVENTS; k++) if (this.evT0[k] < this.evT0[e]) e = k;
    }
    this.evT0[e] = time;
    // Życie zdarzenia: najdłuższa cząstka powłoki (1,1 × life) albo ostatni dżet (τ + życie).
    this.evLife[e] = Math.max(life * 1.2, jetSpan + jetLife * 1.3);
    this.evN[e] = n;
    return n;
  }

  update(time, zoom, ox, oy) {
    this.U.time.value = time;
    this.U.zoom.value = zoom;
    for (let e = this.evCount - 1; e >= 0; e--) {
      if (time - this.evT0[e] >= this.evLife[e]) {
        const last = --this.evCount;
        this.evT0[e] = this.evT0[last];
        this.evLife[e] = this.evLife[last];
        this.evN[e] = this.evN[last];
      }
    }
    if (!this.evCount && this.highWater) {
      this.highWater = 0;
      this.head = 0;
    }
    this.mesh.count = this.highWater > 1 ? this.highWater : 0;
    this.mesh.visible = this.highWater > 1;
    if (this.mesh.visible) {
      const m = this.mesh;
      m.position.set(ox, oy, 0);
      m.updateMatrix();
      m.matrixWorld.copy(m.matrix);
    }
  }

  /** Przesunięcie czasów zdarzeń po przeskoku epoki reżysera (tylko przy pustej puli). */
  shiftTime(dT) {
    for (let e = 0; e < this.evCount; e++) this.evT0[e] += dT;
  }

  get live() { return this.highWater > 0; }

  clear() {
    this.highWater = 0;
    this.head = 0;
    this.evCount = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}
