// src/3d/planetGen/planetGenPlume.tsl.js
//
// PIÓROPUSZ ERUPCJI nad planetą generatora: kolumna popiołu z parasolem na wysokości wyrównania gęstości, znoszona
// wiatrem. Jedna GĘSTOŚĆ (`plumeDensity` — kształt analityczny w układzie planety × szum płynący w górę kolumny)
// w trzech miejscach:
//   • BRYŁA pióropusza (`createPlumeMaterial`): marsz promienia widzenia przez kulę otaczającą (siatka-kula, dziecko
//     kuli planety), w każdym kroku światło słońca po krótkim marszu ku słońcu (samocień), cień planety (noc), żar
//     u podstawy i podświetlenie popiołu od fontanny lawy; wyjście (barwa, 1 − przepuszczalność) mieszane jak alfa
//     z barwą już pomnożoną;
//   • CIEŃ NA GRUNCIE (`plumeShadowAt`, hak materiału zbliżenia): marsz od punktu gruntu ku słońcu przez tę samą
//     gęstość — przy niskim słońcu długi cień kolumny i parasola;
//   • ŚWIATŁO FONTANNY na okolicy komina (punktowe, gaśnie z kwadratem odległości).
// Długości w PROMIENIACH planety (kula jednostkowa, układ obiektu planety). Wartości w `material.uniforms`
// (PLUME_UNIFORM_KEYS — te same obiekty w materiale powierzchni i w materiale bryły). Bez erupcji (gęstość 0 i żar 0)
// gałęzie się nie liczą. Obraz (zasada żelazna 1); rozgrywka (strefa zagrożenia, osłona) — w grze.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, int, vec2, vec3, vec4, uniform, varying, positionGeometry, screenCoordinate,
  clamp, dot, exp, fract, length, max, min, mix, normalize, pow, sin, smoothstep, sqrt, step
} from 'three/tsl';
import { pgNoise } from './planetGenNoise.tsl.js';

/** Klucze uniformów per obiekt (materiał powierzchni zbliżenia i materiał bryły pióropusza). */
export const PLUME_UNIFORM_KEYS = Object.freeze({
  uPlVent: 'vec4',     // xyz — kierunek komina (układ planety, jednostkowy), w — żar fontanny (0 — brak)
  uPlShape: 'vec4',    // wysokość kolumny, promień kolumny u szczytu, promień parasola, grubość parasola [R]
  uPlState: 'vec4',    // czas [s], wzrost kolumny 0…1, wzrost parasola 0…1, gęstość (ekstynkcja na R; 0 — brak)
  uPlWind: 'vec4',     // xyz — kierunek wiatru (styczny przy kominie, jednostkowy), w — znos szczytu [R]
  uPlAsh: 'vec4',      // rgb — albedo popiołu, a — promień kuli otaczającej [R]
  uPlGlowCol: 'vec3',  // barwa żaru (liniowa)
  uPlView: 'vec4'      // xyz — kierunek widzenia w układzie planety (od kamery), w — 1: kamera ortho
});

export const PLUME_STEPS = 36;
export const PLUME_LIGHT_STEPS = 3;
export const PLUME_GROUND_STEPS = 8;

/** Środek kuli otaczającej pióropusz (układ planety) — to samo w JS (siatka) i w grafach. */
export function plumeCenterNode(P) {
  return P.vent.mul(P.H.mul(0.55).add(1.0)).add(P.wind.mul(P.drift.mul(0.5)));
}

function params(U) {
  return {
    vent: U.uPlVent.xyz, glow: U.uPlVent.w,
    H: U.uPlShape.x, Rc: U.uPlShape.y, Ru: U.uPlShape.z, th: U.uPlShape.w,
    time: U.uPlState.x, g: U.uPlState.y, gu: U.uPlState.z, sigma: U.uPlState.w,
    wind: U.uPlWind.xyz, drift: U.uPlWind.w,
    ash: U.uPlAsh.rgb, Rb: U.uPlAsh.a, glowCol: U.uPlGlowCol
  };
}

/**
 * Gęstość 0…1 w punkcie `x` (układ planety). `octaves` — oktawy szumu brzegów (0 — sam kształt). Wynik { rho, z
 * (wysokość nad kulą [R]), r (odległość od osi [R]) }. Wklejana (bez setLayout — czyta uniformy z `P`, pułapka 1).
 */
export function plumeDensity(x, P, octaves = 3) {
  const len = length(x);
  const xh = x.div(max(len, 1e-5));
  const z = len.sub(1.0).toVar();
  const cv = dot(xh, P.vent);
  const zn = clamp(z.div(max(P.H, 1e-5)), 0.0, 1.4);
  // oś kolumny znoszona wiatrem z kwadratem wysokości
  const lat = xh.sub(P.vent.mul(cv)).sub(P.wind.mul(P.drift.mul(zn).mul(zn)));
  const r = length(lat).toVar();
  const top = max(P.H.mul(P.g), 1e-5);
  const rc = mix(P.Rc.mul(0.22), P.Rc, pow(clamp(z.div(top), 0.0, 1.0), 0.7));
  const body = float(1.0).sub(smoothstep(top.mul(0.88), top.mul(1.05), z)).mul(smoothstep(-0.0004, 0.0008, z));
  const rr = r.div(max(rc, 1e-5));
  const col = exp(rr.mul(rr).mul(-1.5)).mul(body);
  // szum kłębów: w kolumnie płynie w górę (H / 5 na sekundę), w parasolu wolno „wrze” (przesuw wzdłuż osi przez
  // cienką warstwę zmienia wzór w miejscu). AGENT: nie przesuwaj dziedziny promieniście o stałą długość — okrąg
  // o tym promieniu trafia w jeden punkt szumu i parasol dostaje współśrodkowe pręgi.
  const zu = P.H.mul(0.86);
  const ru0 = P.Ru.mul(P.gu).add(P.Rc);
  const gUmb = step(0.001, P.gu);
  // obwiednia bez szumu (parasol pogrubiony i poszerzony o zasięg szumu): poza nią gęstość jest zerem — większość
  // kroków marszu trafia w puste powietrze i nie liczy szumu
  const zb = z.sub(zu).div(max(P.th.mul(2.3), 1e-5));
  const bound = max(col, exp(zb.mul(zb).negate()).mul(float(1.0).sub(smoothstep(ru0.mul(0.8), ru0.mul(1.35), r))).mul(gUmb));
  const rho = float(0.0).toVar();
  const shape = float(0.0).toVar();
  If(bound.greaterThan(0.012), () => {
    const fn = float(1.15).div(max(P.Rc, 1e-5));
    const rise = mix(float(0.2), float(0.035), smoothstep(0.6, 0.85, zn));
    const q = x.sub(P.vent.mul(P.time.mul(P.H).mul(rise))).mul(fn).toVar();
    const n = float(0.0).toVar();
    if (octaves > 0) n.assign(pgNoise(q).mul(0.6));
    if (octaves > 1) n.addAssign(pgNoise(q.mul(2.7).add(vec3(3.1, 7.7, 1.3))).mul(0.3));
    if (octaves > 2) n.addAssign(pgNoise(q.mul(6.3).add(vec3(-5.2, 2.4, 9.1))).mul(0.16));
    // parasol: dysk na ~0,86 wysokości, rośnie po dojściu kolumny; wierzch i brzeg w kłębach (szum podnosi wierzch
    // i wypycha brzeg — przy niskim słońcu kłęby rzucają cień na siebie)
    const ru = ru0.mul(n.mul(0.3).add(1.0));
    const zz = z.sub(zu).sub(P.th.mul(n).mul(0.9)).div(max(P.th.mul(n.mul(0.35).add(1.0)), 1e-5));
    const umb = exp(zz.mul(zz).negate()).mul(float(1.0).sub(smoothstep(ru.mul(0.62), ru, r))).mul(gUmb);
    shape.assign(max(col, umb.mul(0.92)));
    // brzegi w strzępach (wnętrze pełne); poza kształtem nic
    if (octaves > 0) rho.assign(clamp(shape.mul(1.75).sub(0.36).add(n.mul(0.62).mul(float(1.0).sub(shape.mul(0.45)))), 0.0, 1.0).mul(smoothstep(0.03, 0.22, shape)));
    else rho.assign(shape);
  });
  return { rho, z, r, shape };
}

// Cień planety w punkcie x (układ planety, |x| ≥ 1): 1 — w słońcu.
function planetLit(x, sun) {
  const d = dot(x, sun);
  const perp = length(x.sub(sun.mul(d)));
  return max(smoothstep(-0.02, 0.05, d), smoothstep(1.0, 1.012, perp));
}

/**
 * Cień pióropusza na gruncie i światło fontanny lawy (hak materiału zbliżenia). `p` — punkt gruntu (jednostkowy),
 * `sunObj` — ku słońcu, `nObj` — normalna, `albedo` — barwa dnia. Wynik { shadow (mnożnik słońca), light (vec3) }.
 */
export function plumeShadowAt({ U, p, sunObj, nObj, albedo }) {
  const P = params(U);
  const shadow = float(1.0).toVar();
  const light = vec3(0.0).toVar();
  If(P.sigma.greaterThan(0.0).and(P.g.greaterThan(0.0)), () => {
    const oc = p.sub(plumeCenterNode(P)).toVar();
    const b = dot(oc, sunObj).toVar();
    const disc = b.mul(b).sub(dot(oc, oc).sub(P.Rb.mul(P.Rb))).toVar();
    If(disc.greaterThan(0.0), () => {
      const sq = sqrt(disc);
      const t0 = max(b.negate().sub(sq), 0.0).toVar();
      // do wyjścia z kuli otaczającej albo z powłoki pióropusza (promień od gruntu rośnie na wysokość)
      const Ro = P.H.mul(1.12).add(1.0);
      const bs = dot(p, sunObj);
      const tSh = bs.negate().add(sqrt(max(bs.mul(bs).add(Ro.mul(Ro)).sub(1.0), 0.0)));
      const t1 = min(b.negate().add(sq), tSh).toVar();
      If(t1.greaterThan(t0), () => {
        const dt = t1.sub(t0).div(PLUME_GROUND_STEPS).toVar();
        const tau = float(0.0).toVar();
        for (let i = 0; i < PLUME_GROUND_STEPS; i++) {
          tau.addAssign(plumeDensity(p.add(sunObj.mul(t0.add(dt.mul(i + 0.5)))), P, 1).rho);
        }
        shadow.assign(exp(tau.mul(dt).mul(P.sigma).mul(-0.55)));
      });
    });
  });
  If(P.glow.greaterThan(0.001), () => {
    // fontanna: światło punktowe tuż nad kominem
    const lp = P.vent.mul(P.Rc.mul(0.9).add(1.0));
    const dv = lp.sub(p).toVar();
    const d2 = dot(dv, dv).toVar();
    const r0 = P.Rc.mul(2.2);
    const fall = float(1.0).div(d2.div(r0.mul(r0)).add(1.0));
    const nl = max(dot(nObj, dv.div(sqrt(max(d2, 1e-12)))), 0.0).mul(0.75).add(0.25);
    light.assign(albedo.mul(P.glowCol).mul(P.glow.mul(fall).mul(nl).mul(2.4)));
    // rozbryzg fontanny: żarzące się strzępy lawy wokół komina (gasną z odległością, migoczą)
    const dg = sqrt(max(float(2.0).sub(dot(p, P.vent).mul(2.0)), 0.0)).div(max(P.Rc.mul(1.9), 1e-6)).toVar();
    If(dg.lessThan(2.2), () => {
      // (łagodna poświata z lekkim migotaniem — ostry próg szumu dawał łaciate plamy)
      const sp = pgNoise(p.mul(float(3.4).div(max(P.Rc, 1e-5))).add(vec3(0.0, P.time.mul(0.6), 0.0))).mul(0.5).add(0.5);
      const hot = exp(dg.mul(dg).mul(-1.7)).mul(sp.mul(0.4).add(0.6));
      light.addAssign(P.glowCol.add(vec3(0.0, 0.25, 0.1).mul(hot)).mul(P.glow.mul(hot).mul(hot).mul(2.6)));
    });
  });
  return { shadow, light };
}

// ── Bryła pióropusza ──────────────────────────────────────────────────────────────────────────────────────────────
function perObject(key, type) {
  const init = type === 'vec4' ? new THREE.Vector4() : new THREE.Vector3();
  return uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
}
const PLUME_MATERIAL_KEYS = Object.freeze({ ...PLUME_UNIFORM_KEYS, uPlSun: 'vec4', uPlFlash: 'vec4', uPlCam: 'vec4' });
let _graph = null;
function plumeGraph() {
  if (_graph) return _graph;
  const U = {};
  for (const [k, t] of Object.entries(PLUME_MATERIAL_KEYS)) U[k] = perObject(k, t);
  const P = params(U);
  // siatka = kula jednostkowa w układzie planety: pozycja = środek + promień · wierzchołek (w wierzchołkach)
  const vPos = varying(positionGeometry, 'vPlumeLocal');
  const positionNode = Fn(() => plumeCenterNode(P).add(positionGeometry.mul(P.Rb)))();
  const fragmentNode = Fn(() => {
    const C = plumeCenterNode(P).toVar();
    const sun = normalize(U.uPlSun.xyz).toVar();
    // odcinek promienia widzenia w kuli otaczającej (z punktu fragmentu — niezależnie od podziału siatki), ucięty
    // na powierzchni planety; kamera ortho — stały kierunek, perspektywiczna — od pozycji kamery przez fragment
    const xf = C.add(vPos.mul(P.Rb)).toVar();
    const rdRaw = mix(U.uPlView.xyz, xf.sub(U.uPlCam.xyz), U.uPlCam.w);
    const rd = rdRaw.div(max(length(rdRaw), 1e-6)).toVar();
    const oc = xf.sub(C).toVar();
    const bq = dot(oc, rd).toVar();
    const sq = sqrt(max(bq.mul(bq).sub(dot(oc, oc).sub(P.Rb.mul(P.Rb))), 0.0)).toVar();
    const xs = xf.add(rd.mul(bq.negate().sub(sq))).toVar();
    const tExit = sq.mul(2.0).toVar();
    const bp = dot(xs, rd).toVar();
    const x2 = dot(xs, xs).toVar();
    const dp = bp.mul(bp).sub(x2.sub(1.0)).toVar();
    const tPlanet = bp.negate().sub(sqrt(max(dp, 0.0))).toVar();
    // powłoka nad kulą do szczytu pióropusza: promień patrzący z góry idzie wzdłuż kolumny — kroki tylko w powłoce
    const Ro = P.H.mul(1.12).add(1.0);
    const dsh = bp.mul(bp).sub(x2.sub(Ro.mul(Ro))).toVar();
    const ssh = sqrt(max(dsh, 0.0)).toVar();
    const tIn = max(bp.negate().sub(ssh), 0.0).toVar();
    const tOut = min(tExit, bp.negate().add(ssh)).toVar();
    const tEnd = mix(tOut, min(tOut, tPlanet), step(0.0, dp).mul(step(0.0, tPlanet))).toVar();
    const x0 = xs.add(rd.mul(tIn)).toVar();
    const dt = max(tEnd.sub(tIn), 0.0).mul(step(0.0, dsh)).div(PLUME_STEPS).toVar();
    // przesunięcie startu białym szumem piksela (pasy kroków → ziarno; szum przeplatany dawał widoczną kratkę)
    const jit = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453)).toVar();
    const Tr = float(1.0).toVar();
    const col = vec3(0.0).toVar();
    const lstep = P.Rc.mul(1.3).toVar();
    If(dt.greaterThan(1e-7).and(P.sigma.greaterThan(0.0)), () => {
      Loop({ start: int(0), end: int(PLUME_STEPS), type: 'int', condition: '<' }, ({ i }) => {
        const x = x0.add(rd.mul(dt.mul(jit.add(float(i))))).toVar();
        const d = plumeDensity(x, P, 3);
        If(d.rho.greaterThan(0.004), () => {
          // światło słońca: krótki marsz ku słońcu (kroki rosnące), cień planety
          const tau = float(0.0).toVar();
          for (let j = 0; j < PLUME_LIGHT_STEPS; j++) {
            const sj = 0.6 * Math.pow(1.7, j);
            tau.addAssign(plumeDensity(x.add(sun.mul(lstep.mul(sj))), P, j === 0 ? 1 : 0).rho.mul(lstep.mul(sj * 0.7)));
          }
          const od = tau.mul(P.sigma);
          // wielokrotne rozpraszanie w przybliżeniu: drugi, wolniej gasnący człon (wnętrze kłębów nie czernieje)
          const lightT = max(exp(od.negate()), exp(od.mul(-0.22)).mul(0.55));
          const lit = planetLit(x, sun);
          const sunCol = mix(vec3(1.0, 0.5, 0.22), vec3(1.0, 0.97, 0.92), smoothstep(-0.02, 0.28, dot(normalize(x), sun))).mul(U.uPlSun.w);
          // żar: rdzeń fontanny u podstawy + popiół podświetlony od dołu
          const zh = d.z.div(max(P.H, 1e-5));
          const rcore = d.r.div(max(P.Rc.mul(0.45), 1e-6));
          const core = exp(zh.mul(-16.0)).mul(exp(rcore.mul(rcore).negate()));
          const rund = d.r.div(max(P.Rc, 1e-6));
          const under = exp(zh.mul(-3.2)).div(rund.mul(rund).add(1.0));
          // rdzeń żółtobiały (dodatek bieli do barwy żaru), dalej pomarańcz
          const glow = P.glowCol.add(vec3(0.0, 0.32, 0.2).mul(core)).mul(P.glow).mul(core.mul(14.0).add(P.ash.mul(under).mul(2.2)));
          const amb = vec3(0.035, 0.04, 0.05).mul(lit.mul(0.8).add(0.2));
          // wyładowanie w chmurze: błysk rozświetla popiół od środka
          const fd = x.sub(U.uPlFlash.xyz);
          const flash = vec3(0.72, 0.82, 1.0).mul(U.uPlFlash.w.mul(exp(dot(fd, fd).div(P.Rc.mul(P.Rc).mul(5.0)).negate())).mul(5.0));
          const S = P.ash.mul(sunCol.mul(lightT).mul(lit).add(amb).add(flash)).add(glow);
          const a = float(1.0).sub(exp(d.rho.mul(P.sigma).mul(dt).negate()));
          col.addAssign(S.mul(a).mul(Tr));
          Tr.mulAssign(float(1.0).sub(a));
        });
        If(Tr.lessThan(0.02), () => { Break(); });
      });
    });
    return vec4(col, float(1.0).sub(Tr));
  })();
  _graph = { positionNode, fragmentNode };
  return _graph;
}

/**
 * Materiał bryły pióropusza. `uniforms` — obiekty { value } z kluczami PLUME_UNIFORM_KEYS (te same co w materiale
 * powierzchni) + `uPlSun` (xyz — kierunek ku słońcu w układzie planety, w — jasność słońca). Siatka: kula jednostkowa
 * (dziecko kuli planety, bez własnego przekształcenia — środek i promień daje graf).
 */
export function createPlumeMaterial(uniforms) {
  const g = plumeGraph();
  const m = new THREE.NodeMaterial();
  m.name = 'PlanetGenPlume';
  m.uniforms = uniforms;
  m.positionNode = g.positionNode;
  m.fragmentNode = g.fragmentNode;
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  // barwa już pomnożona przez krycie: (One, OneMinusSrcAlpha) — bez `premultipliedAlpha` (mnożyłby drugi raz, pułapka 13)
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return m;
}

/** Wartości początkowe uniformów pióropusza (bez erupcji). */
export function plumeUniforms() {
  return {
    uPlVent: { value: new THREE.Vector4(1, 0, 0, 0) },
    uPlShape: { value: new THREE.Vector4(0.03, 0.006, 0.035, 0.004) },
    uPlState: { value: new THREE.Vector4(0, 0, 0, 0) },
    uPlWind: { value: new THREE.Vector4(0, 0, 1, 0) },
    uPlAsh: { value: new THREE.Vector4(0.3, 0.27, 0.25, 0.06) },
    uPlGlowCol: { value: new THREE.Vector3(1.0, 0.42, 0.1) },
    uPlView: { value: new THREE.Vector4(0, 0, -1, 1) },
    uPlSun: { value: new THREE.Vector4(1, 0, 0, 1.1) },
    uPlFlash: { value: new THREE.Vector4(0, 0, 0, 0) },   // wyładowanie: xyz — miejsce (układ planety), w — jasność
    uPlCam: { value: new THREE.Vector4(0, 0, 5, 0) }      // xyz — kamera (układ planety), w — 1: kamera perspektywiczna
  };
}
