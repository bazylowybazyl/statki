// src/3d/planetGen/planetGenShell.tsl.js
//
// POWŁOKI NAD PLANETĄ liczone po promieniu widzenia (siatka = kula jednostkowa, dziecko kuli planety; promień powłoki
// daje graf):
//   • wspólne: promień widzenia w układzie obiektu (kamera perspektywiczna — z pozycji kamery; ortho — stały
//     kierunek), odcinek w powłoce między kulą zewnętrzną a wewnętrzną (`shellRay`), cień planety (`planetLit`);
//   • ATMOSFERA (`createGenAtmosphereMaterial`): rozpraszanie pojedyncze — gęstość e^(−h / Hs), 10 próbek wzdłuż
//     promienia, światło słońca osłabione drogą przez powietrze (funkcja Chapmana, za terminatorem — przez punkt
//     promienia słońca najbliższy planecie) i cieniem planety. Błękit
//     krawędzi tarczy, mgiełka pod kątem i czerwień przy terminatorze wychodzą z jednego wzoru (nie z doklejonej
//     barwy). Mieszanie addytywne — osłabienie gruntu mgiełką liczy graf powierzchni gry;
//   • ZORZA (`createGenAuroraMaterial`): świecąca objętość nad owalem wokół bieguna magnetycznego — kurtyny z szumu
//     zależnego tylko od KIERUNKU (stałe wzdłuż promienia planety = pionowe promienie), ostry dół, zanik ku górze,
//     zieleń u dołu i róż u góry; tylko po nocnej stronie.
// Wartości per obiekt w `material.uniforms` (SHELL_UNIFORM_KEYS + klucze materiału). Obraz (zasada żelazna 1).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, int, vec2, vec3, vec4, uniform, varying, positionGeometry, screenCoordinate, texture3D,
  abs, acos, clamp, dot, exp, fract, length, max, min, mix, normalize, sin, smoothstep, sqrt, step
} from 'three/tsl';
import { cloudNoiseTexture } from './planetGenNoise3D.js';

/** Klucze wspólne powłok (układ obiektu siatki powłoki). */
export const SHELL_UNIFORM_KEYS = Object.freeze({
  uShCam: 'vec4',    // xyz — pozycja kamery, w — 1: kamera ortho (promień = uShDir)
  uShDir: 'vec3',    // kierunek widzenia kamery ortho (od kamery)
  uShSun: 'vec4'     // xyz — ku słońcu, w — jasność słońca
});

export function shellPerObject(keys) {
  const U = {};
  for (const [k, t] of Object.entries(keys)) {
    const init = t === 'vec4' ? new THREE.Vector4() : (t === 'vec3' ? new THREE.Vector3() : 0);
    U[k] = uniform(init, t).onObjectUpdate(({ material }) => material.uniforms[k].value);
  }
  return U;
}

/** Wartości początkowe kluczy wspólnych. */
export function shellUniforms() {
  return {
    uShCam: { value: new THREE.Vector4(0, 0, 5, 0) },
    uShDir: { value: new THREE.Vector3(0, 0, -1) },
    uShSun: { value: new THREE.Vector4(1, 0, 0, 1.1) }
  };
}

/**
 * Promień widzenia przez powłokę [rIn, rOut] (wołać we fragmencie). `vDir` — varying wierzchołka kuli jednostkowej.
 * Wynik: o — początek promienia, rd — kierunek, t0 / t1 — wejście i wyjście z powłoki (t1 = powierzchnia kuli
 * wewnętrznej, gdy promień w nią trafia), hit — 1: promień trafia w kulę wewnętrzną.
 */
export function shellRay(U, vDir, rOut, rIn) {
  const xf = vDir.mul(rOut).toVar();
  const ortho = step(0.5, U.uShCam.w);
  const o = mix(U.uShCam.xyz, xf, ortho).toVar();
  const rdRaw = mix(xf.sub(U.uShCam.xyz), U.uShDir, ortho);
  const rd = rdRaw.div(max(length(rdRaw), 1e-6)).toVar();
  const b = dot(o, rd).toVar();
  const oo = dot(o, o).toVar();
  const sq = sqrt(max(b.mul(b).sub(oo.sub(rOut.mul(rOut))), 0.0)).toVar();
  const t0 = max(b.negate().sub(sq), 0.0).toVar();
  const dIn = b.mul(b).sub(oo.sub(rIn.mul(rIn))).toVar();
  const tIn = b.negate().sub(sqrt(max(dIn, 0.0))).toVar();
  const hit = step(0.0, dIn).mul(step(0.0, tIn)).toVar();
  const t1 = mix(b.negate().add(sq), tIn, hit).toVar();
  return { o, rd, t0, t1, hit };
}

/** Cień planety w punkcie x (|x| ≥ 1, układ planety): 1 — w słońcu. */
export function planetLit(x, sun) {
  const d = dot(x, sun);
  const perp = length(x.sub(sun.mul(d)));
  return max(smoothstep(-0.02, 0.06, d), smoothstep(1.0, 1.015, perp));
}

/** Biały szum piksela 0…1 (przesunięcie startu marszu). */
export const pixelNoise = () => fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));

function shellMaterial(name, graph, uniforms, blend) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.uniforms = uniforms;
  m.positionNode = graph.positionNode;
  m.fragmentNode = graph.fragmentNode;
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  // 'add' — (One, One); 'over' — barwa już pomnożona przez krycie (One, OneMinusSrcAlpha)
  m.blendDst = blend === 'add' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  m.blendDstAlpha = blend === 'add' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  return m;
}
export { shellMaterial };

// ── ATMOSFERA ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const ATMOSPHERE_UNIFORM_KEYS = Object.freeze({
  ...SHELL_UNIFORM_KEYS,
  uAtShape: 'vec4',    // promień powłoki (1 + wysokość), wysokość skali Hs [R], gęstość (grubość optyczna pionu), siła
  uAtBeta: 'vec3',     // rozpraszanie na barwę (największa składowa = 1)
  uAtMie: 'vec4'       // rgb — barwa mgiełki przy słońcu, a — siła
});
export const ATMOSPHERE_STEPS = 10;
let atmGraph = null;
function buildAtmosphere() {
  const U = shellPerObject(ATMOSPHERE_UNIFORM_KEYS);
  const vDir = varying(positionGeometry, 'vAtDir');
  const positionNode = Fn(() => positionGeometry.mul(U.uAtShape.x))();
  const fragmentNode = Fn(() => {
    const Ra = U.uAtShape.x;
    const Hs = max(U.uAtShape.y, 1e-5);
    const R = shellRay(U, vDir, Ra, float(1.0));
    const sun = normalize(U.uShSun.xyz).toVar();
    const seg = max(R.t1.sub(R.t0), 0.0).toVar();
    const dt = seg.div(ATMOSPHERE_STEPS).toVar();
    const jit = pixelNoise().toVar();
    // grubość optyczna pionu × barwa = współczynnik na jednostkę długości przy gruncie
    const k = U.uAtBeta.mul(U.uAtShape.z.div(Hs)).toVar();
    const tauV = float(0.0).toVar();
    const L = vec3(0.0).toVar();
    const cosT = dot(R.rd, sun);
    // faza Rayleigha 3 / 16π · (1 + cos²) w jednostkach grafu gry (powierzchnia = albedo · słońce, czyli E / π):
    // współczynnik 3 / 16. (Bez podzielenia przez 4π atmosfera wybielała cały kadr.)
    const phaseR = cosT.mul(cosT).add(1.0).mul(0.1875);
    const phaseM = float(1.0).div(float(1.32).sub(cosT.mul(1.3))).pow(1.5).mul(0.03);
    // Droga światła słońca przez powietrze do punktu (w wysokościach skali): funkcja Chapmana — 1 / μ wysoko nad
    // horyzontem, √(π / 2Hs) przy słońcu na horyzoncie. ZA terminatorem (μ < 0) promień słońca przechodzi niżej,
    // przez gęstsze powietrze: droga = dwie połówki przez punkt najbliższy planecie − odcinek za punktem. Bez tego
    // powietrze za terminatorem świeciło jasno i blado (szeroki szaroróżowy pas zamiast wąskiej czerwieni zmierzchu).
    const ch90 = sqrt(float(Math.PI / 2).div(Hs)).toVar();
    Loop({ start: int(0), end: int(ATMOSPHERE_STEPS), type: 'int', condition: '<' }, ({ i }) => {
      const x = R.o.add(R.rd.mul(R.t0.add(dt.mul(jit.add(float(i)))))).toVar();
      const r = length(x).toVar();
      const rho = exp(r.sub(1.0).max(0.0).div(Hs).negate()).toVar();
      const up = x.div(max(r, 1e-5));
      const mu = dot(up, sun).toVar();
      const am = abs(mu);
      const own = rho.div(am.add(exp(am.mul(-6.0)).div(ch90))).toVar();
      const rT = r.mul(sqrt(max(float(1.0).sub(mu.mul(mu)), 0.0)));
      const rhoT = exp(rT.sub(1.0).max(0.0).div(Hs).negate());
      const tauS = Hs.mul(mix(own, rhoT.mul(ch90).mul(2.0).sub(own), step(mu, 0.0)));
      const lit = planetLit(x, sun);
      // (droga słońca ×1,7: pył i ozon przy gruncie gaszą niskie słońce mocniej niż samo rozpraszanie — pas
      // zmierzchu zostaje ciepły; bez tego błękit rozproszony w powietrzu zmieniał czerwień zachodu w szarość)
      const T = exp(k.mul(tauV.add(tauS.mul(1.7))).negate());
      L.addAssign(T.mul(rho.mul(dt)).mul(lit));
      tauV.addAssign(rho.mul(dt));
    });
    const col = L.mul(k).mul(phaseR).add(L.mul(U.uAtMie.rgb).mul(U.uAtMie.a.mul(phaseM)).mul(U.uAtShape.z.div(Hs)));
    return vec4(max(col.mul(U.uShSun.w).mul(U.uAtShape.w), vec3(0.0)), 0.0);
  })();
  return { positionNode, fragmentNode };
}
/** Materiał atmosfery (kula jednostkowa; mieszanie addytywne). */
export function createGenAtmosphereMaterial(uniforms) {
  if (!atmGraph) atmGraph = buildAtmosphere();
  return shellMaterial('PlanetGenAtmosphere', atmGraph, uniforms, 'add');
}
/** Uniformy atmosfery z opisu planety (barwy poświaty planety przy ringu — spec.ringAtm). */
export function atmosphereUniforms(spec) {
  const t = spec.ringAtm || { day: [0.26, 0.5, 1.0], gain: 0.8 };
  const m = Math.max(t.day[0], t.day[1], t.day[2], 1e-3);
  const blue = t.day[2] >= t.day[0];
  return {
    ...shellUniforms(),
    // grubość optyczna pionu dla najmocniej rozpraszanej barwy: ~0,2 (błękit Ziemi) × mgiełka planety
    uAtShape: { value: new THREE.Vector4(1.07, 0.012, 0.1 + 0.2 * Math.min(1, spec.haze?.strength ?? 0.3), 1.25 * Math.max(0.35, t.gain || 0.5)) },
    // barwa rozpraszania: z barwy dnia poświaty; błękitne atmosfery dostają rozjazd jak w rozpraszaniu Rayleigha
    uAtBeta: { value: new THREE.Vector3(...(blue ? [0.2, 0.47, 1.0] : t.day.map((v) => v / m))) },
    uAtMie: { value: new THREE.Vector4(1.0, 0.9, 0.78, 0.1) }
  };
}

// ── ZORZA ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const AURORA_UNIFORM_KEYS = Object.freeze({
  ...SHELL_UNIFORM_KEYS,
  uAuAxis: 'vec4',     // xyz — oś magnetyczna (układ planety), w — odległość kątowa owalu od bieguna [rad]
  uAuShape: 'vec4',    // dół [R nad powierzchnią], góra, szerokość owalu [rad], jasność
  uAuTime: 'vec4',     // czas [s], częstość kurtyn, —, —
  uAuLow: 'vec3',      // barwa dołu (zieleń)
  uAuHigh: 'vec3'      // barwa góry (róż)
});
export const AURORA_STEPS = 22;
let auroraGraph = null;
function buildAurora() {
  const U = shellPerObject(AURORA_UNIFORM_KEYS);
  const noise = cloudNoiseTexture();
  const vDir = varying(positionGeometry, 'vAuDir');
  const positionNode = Fn(() => positionGeometry.mul(U.uAuShape.y.add(1.0)))();
  const fragmentNode = Fn(() => {
    const rOut = U.uAuShape.y.add(1.0);
    const rIn = U.uAuShape.x.add(1.0);
    // odcinek w powłoce zorzy; promień trafiający w planetę kończy się na niej
    const R = shellRay(U, vDir, rOut, float(1.0));
    const axis = normalize(U.uAuAxis.xyz).toVar();
    const sun = normalize(U.uShSun.xyz).toVar();
    const seg = max(R.t1.sub(R.t0), 0.0).toVar();
    const dt = seg.div(AURORA_STEPS).toVar();
    // szybkie odrzucenie: początek, środek i koniec odcinka daleko od obu biegunów magnetycznych
    const capAt = (t) => abs(dot(normalize(R.o.add(R.rd.mul(t))), axis));
    const near = max(max(capAt(R.t0), capAt(R.t0.add(seg.mul(0.5)))), capAt(R.t0.add(seg))).toVar();
    const capCos = (U.uAuAxis.w.add(U.uAuShape.z.mul(3.5)).add(0.1)).cos();
    const L = vec3(0.0).toVar();
    If(near.greaterThan(capCos).and(seg.greaterThan(1e-6)), () => {
      const jit = pixelNoise().toVar();
      const Fq = U.uAuTime.y;
      const t = U.uAuTime.x;
      Loop({ start: int(0), end: int(AURORA_STEPS), type: 'int', condition: '<' }, ({ i }) => {
        const x = R.o.add(R.rd.mul(R.t0.add(dt.mul(jit.add(float(i)))))).toVar();
        const r = length(x).toVar();
        const dir = x.div(max(r, 1e-5)).toVar();
        const hN = r.sub(rIn).div(max(rOut.sub(rIn), 1e-5)).toVar();
        const ca = abs(dot(dir, axis));
        const colat = acos(clamp(ca, 0.0, 1.0));
        // szum zależy tylko od kierunku: kurtyna jest stała wzdłuż promienia planety (pionowe promienie)
        const q = dir.mul(Fq).add(axis.mul(t.mul(0.004))).toVar();
        const n1 = texture3D(noise, q, float(0.0)).a;
        const n2 = texture3D(noise, q.mul(5.3).add(vec3(0.0, t.mul(0.011), 0.0)), float(0.0)).g;
        const n3 = texture3D(noise, q.mul(0.37).add(vec3(0.31, 0.17, 0.53)), float(0.0)).a;
        // owal: falujący pas wokół bieguna; kurtyny = cienkie wstęgi wzdłuż poziomic szumu w pasie (kilka obok
        // siebie, z przerwami), w nich pionowe promienie
        const zz = colat.sub(U.uAuAxis.w).sub(n3.sub(0.5).mul(0.14)).div(max(U.uAuShape.z, 1e-4));
        const band = exp(zz.mul(zz).negate());
        const lines = abs(fract(n1.mul(5.0)).sub(0.5));
        const arc = float(1.0).sub(smoothstep(0.05, 0.22, lines)).mul(smoothstep(0.3, 0.55, n3.add(n1.mul(0.4))).mul(0.85).add(0.15));
        const rays = n2.mul(n2).mul(2.2).add(0.1);
        // pion: ostry dół, zanik ku górze (wysokie promienie tam, gdzie drobny szum jasny)
        const vert = smoothstep(0.0, 0.05, hN).mul(exp(hN.mul(mix(float(7.5), float(2.4), n2)).negate())).mul(step(hN, 1.0));
        // tylko noc: przed terminatorem gaśnie (za dnia niebo jest jaśniejsze niż zorza)
        const night = float(1.0).sub(smoothstep(-0.3, -0.06, dot(dir, sun)));
        const e = band.mul(arc).mul(rays).mul(vert).mul(night);
        const col = mix(U.uAuLow, U.uAuHigh, smoothstep(0.14, 0.62, hN));
        L.addAssign(col.mul(e));
      });
      L.mulAssign(dt.mul(U.uAuShape.w).div(max(rOut.sub(rIn), 1e-5)));
    });
    return vec4(max(L, vec3(0.0)), 0.0);
  })();
  return { positionNode, fragmentNode };
}
/** Materiał zorzy (kula jednostkowa; mieszanie addytywne, HDR). */
export function createGenAuroraMaterial(uniforms) {
  if (!auroraGraph) auroraGraph = buildAurora();
  return shellMaterial('PlanetGenAurora', auroraGraph, uniforms, 'add');
}
/** Uniformy zorzy: oś magnetyczna odchylona od osi obrotu (z ziarna planety), owal ~20° od bieguna. */
export function auroraUniforms(spec, rng01 = [0.3, 0.7]) {
  const tilt = 0.12 + 0.14 * rng01[0];
  const az = rng01[1] * Math.PI * 2;
  return {
    ...shellUniforms(),
    uAuAxis: { value: new THREE.Vector4(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az), 0.36) },
    uAuShape: { value: new THREE.Vector4(0.012, 0.1, 0.06, 4.5) },
    uAuTime: { value: new THREE.Vector4(0, 2.3, 0, 0) },
    uAuLow: { value: new THREE.Vector3(0.1, 1.0, 0.42) },
    uAuHigh: { value: new THREE.Vector3(0.95, 0.16, 0.5) }
  };
}
