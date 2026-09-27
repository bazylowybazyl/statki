// src/3d/warpPlume3D.js
//
// Silnik WARP — port PlasmaEngineFX z `dema/silniki/plasma_engine_demo.html`.
// Plume to raymarch objętościowy w proxy (Box, BackSide): granice marszu
// (walec ∩ warstwa Z) liczą się analitycznie z AKTUALNYCH rozmiarów strumienia,
// więc wygląda poprawnie z każdego kąta, także w ortho z góry.
//
// Warp leci z tych samych dysz co MAIN: EngineVfxSystem bierze instancję
// z puli na czas ładowania i skoku, a po wyjściu gasi ją (poświata) i oddaje.
// Instancja kosztuje ~5 draw calli i raymarch na pikselach plume, dlatego pula
// ma limit — nadmiarowe dysze (duża flota wlatująca skokiem) dostają zwykłą
// strugę MAIN z dopalaczem.
//
// Różnice względem dema:
//   - bez PointLightów (enginePointLights: false) i bez passa zakłóceń
//     cieplnych (warstwa 3 w grze to planety; gorące powietrze daje
//     Core3D.pushHeatHazeWorld);
//   - bez siatek dyszy (gardziel, wnętrze) — dyszę rysuje sprite kadłuba;
//   - alfa = max(rgb) przy mieszaniu (ONE, ONE): alfa 1 na całym proxy
//     wycinała w poświacie bloomu ciemny prostokąt (kanwa Core3D jest premultiplied);
//   - pozycja w mesh.position (świat 5–10 mln j. — three składa modelView
//     w double), cały raymarch w przestrzeni lokalnej instancji;
//   - fazy przepływu całkowane na CPU (patrz sampleMedium).
//
// Port WebGPU (zadanie 13): trzy materiały węzłowe TSL 1:1 z dawnym GLSL.
//   - JEDEN GRAF na rodzaj (plume w wariancie jakości, poświata, cząstki), budowany
//     raz na moduł. Instancja puli ma własne materiały (ten sam graf = ten sam
//     klucz programu, NodeBuilder buduje go raz), a jej wartości leżą w
//     `material.uniforms.X.value` jak dawniej — węzły uniformów czytają je z
//     materiału rysowanego obiektu (onObjectUpdate). Dawniej `new ShaderMaterial`
//     w konstruktorze: na WebGPU każda z 16 instancji budowałaby ciężki raymarch
//     od nowa (przestój przy pierwszych skokach floty).
//   - Kroki marszu i oktawy (dawne `defines` PE_STEPS / PE_OCT) to stałe przy
//     budowie grafu: `Loop(steps)` i gałęzie oktaw w JS — jakość = osobny graf.
//   - Cząstki: WebGPU rysuje punkty tylko 1 px, więc dawne `gl_PointSize` to
//     kwad na instancję (rozmiar w pikselach celu przez viewportSize); dawne
//     `gl_PointCoord` = uv kwadu.
//   - Mieszanie jak WebGL z premultipliedAlpha (ONE, ONE — tsl/mieszanie.js).

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Break, Discard, Fn, If, Loop,
  abs, atan, attribute, cameraProjectionMatrix, clamp, cos, dot, exp, float, floor, fract, length,
  max, min, mix, modelViewMatrix, normalize, positionGeometry, pow, screenCoordinate, screenSize,
  select, sin, smoothstep, sqrt, step, uniform, uv, varying, vec2, vec3, vec4, viewportSize
} from 'three/tsl';
import { Core3D } from './core3d.js';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import { WARP_PLASMA_PALETTES, WARP_PLUME_BASE_LEN, WARP_PLUME_BOOST_LEN } from '../data/engineFx.js';

/* ============================================================================
   0. WSPÓLNE — simplex noise 3D (Ashima / Gustavson), prefiks pe_
   Funkcje z layoutem są CZYSTE (PLAN §3 — błąd r183 z uniformem w domknięciu).
   ========================================================================== */
const peMod289 = (x) => x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0));
const pePermute = (x) => peMod289(x.mul(34.0).add(1.0).mul(x));
const peTis = (r) => float(1.79284291400159).sub(r.mul(0.85373472095314));

export const peSnoise = /*@__PURE__*/ Fn(([v]) => {
  const C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const D = vec4(0.0, 0.5, 1.0, 2.0);
  const i = floor(v.add(dot(v, C.yyy))).toVar();
  const x0 = v.sub(i).add(dot(i, C.xxx)).toVar();
  const g = step(x0.yzx, x0.xyz).toVar();
  const l = float(1.0).sub(g).toVar();
  const i1 = min(g.xyz, l.zxy).toVar();
  const i2 = max(g.xyz, l.zxy).toVar();
  const x1 = x0.sub(i1).add(C.xxx).toVar();
  const x2 = x0.sub(i2).add(C.yyy).toVar();
  const x3 = x0.sub(D.yyy).toVar();
  i.assign(peMod289(i));
  const p = pePermute(pePermute(pePermute(
    i.z.add(vec4(0.0, i1.z, i2.z, 1.0)))
    .add(i.y).add(vec4(0.0, i1.y, i2.y, 1.0)))
    .add(i.x).add(vec4(0.0, i1.x, i2.x, 1.0))).toVar();
  const n_ = float(0.142857142857);
  const ns = n_.mul(D.wyz).sub(D.xzx).toVar();
  const j = p.sub(float(49.0).mul(floor(p.mul(ns.z).mul(ns.z)))).toVar();
  const x_ = floor(j.mul(ns.z)).toVar();
  const y_ = floor(j.sub(float(7.0).mul(x_))).toVar();
  const x = x_.mul(ns.x).add(ns.yyyy).toVar();
  const y = y_.mul(ns.x).add(ns.yyyy).toVar();
  const h = float(1.0).sub(abs(x)).sub(abs(y)).toVar();
  const b0 = vec4(x.xy, y.xy).toVar();
  const b1 = vec4(x.zw, y.zw).toVar();
  const s0 = floor(b0).mul(2.0).add(1.0).toVar();
  const s1 = floor(b1).mul(2.0).add(1.0).toVar();
  const sh = step(h, vec4(0.0)).negate().toVar();
  const a0 = b0.xzyw.add(s0.xzyw.mul(sh.xxyy)).toVar();
  const a1 = b1.xzyw.add(s1.xzyw.mul(sh.zzww)).toVar();
  const p0 = vec3(a0.xy, h.x).toVar();
  const p1 = vec3(a0.zw, h.y).toVar();
  const p2 = vec3(a1.xy, h.z).toVar();
  const p3 = vec3(a1.zw, h.w).toVar();
  const norm = peTis(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))).toVar();
  p0.mulAssign(norm.x);
  p1.mulAssign(norm.y);
  p2.mulAssign(norm.z);
  p3.mulAssign(norm.w);
  const m = max(float(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))), 0.0).toVar();
  m.assign(m.mul(m));
  return float(42.0).mul(dot(m.mul(m), vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))));
}).setLayout({ name: 'peSnoise', type: 'float', inputs: [{ name: 'v', type: 'vec3' }] });

const peHash12 = /*@__PURE__*/ Fn(([p]) => {
  const p3 = fract(vec3(p.xyx).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'peHash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// Uniform per obiekt: graf wspólny dla całej puli, wartość z `uniforms`
// materiału RYSOWANEGO obiektu (materiał na instancję, dawne API bez zmian).
// Wszystkie w grupie obiektu — jeden bufor uniformów na draw (limit 12 na etap).
function perObject(name, init) {
  return uniform(init).onObjectUpdate(({ material }) => material.uniforms[name].value);
}

/* ============================================================================
   1. PLUME — raymarch w układzie lokalnym: oś dyszy = +Z, promień dyszy = 1
   ========================================================================== */
const plumeGraphs = new Map();

function plumeGraph(steps, oct) {
  const key = `${steps}|${oct}`;
  const cached = plumeGraphs.get(key);
  if (cached) return cached;

  const u = {
    uTime: perObject('uTime', 0),              // tylko ziarno jittera marszu (zawijany na CPU)
    uLen: perObject('uLen', 0),                // długość ciała plume (promień dyszy = 1)
    uWidth: perObject('uWidth', 0),            // mnożnik promienia
    uCore: perObject('uCore', 0),              // intensywność białego rdzenia
    uBright: perObject('uBright', 0),          // globalna jasność
    uTurb: perObject('uTurb', 0),              // amplituda turbulencji
    uStretch: perObject('uStretch', 0),        // rozciągnięcie smug wzdłuż osi (wygładzane na CPU)
    uFlowPh: perObject('uFlowPh', new THREE.Vector3()),  // fazy oktaw w przestrzeni szumu (całkowane na CPU)
    uMachPh: perObject('uMachPh', 0),          // faza diamentów Macha (całkowana na CPU)
    uSheath: perObject('uSheath', 0),          // siła otoczki
    uDensity: perObject('uDensity', 0),        // gęstość / gain całki
    uBodyGain: perObject('uBodyGain', 0),      // ciało + otoczka względem rdzenia (pod próg bloomu gry)
    uAfterglow: perObject('uAfterglow', 0),    // 0..1 — poświata po wyłączeniu (bez rdzenia)
    uPower: perObject('uPower', 0),            // 0..1 moc silnika (kształt + barwa)
    uIgnite: perObject('uIgnite', 0),          // impuls zapłonu (0..1+)
    uExtinct: perObject('uExtinct', 0),        // samoprzesłanianie ośrodka
    uCamPosL: perObject('uCamPosL', new THREE.Vector3()),  // pozycja kamery w przestrzeni lokalnej
    uCamDirL: perObject('uCamDirL', new THREE.Vector3()),  // kierunek patrzenia kamery (ortho) lokalnie
    uOrtho: perObject('uOrtho', 0),
    uBoundR: perObject('uBoundR', 0),          // ciasne granice marszu — promień
    uBoundZ0: perObject('uBoundZ0', 0),
    uBoundZ1: perObject('uBoundZ1', 0),
    uJitter: perObject('uJitter', 0),
    uCoreWarm: perObject('uCoreWarm', new THREE.Color()),
    uCoreCold: perObject('uCoreCold', new THREE.Color()),
    uBody0: perObject('uBody0', new THREE.Color()),
    uBody1: perObject('uBody1', new THREE.Color()),
    uBody2: perObject('uBody2', new THREE.Color()),
    uBody3: perObject('uBody3', new THREE.Color()),
    uOuter0: perObject('uOuter0', new THREE.Color()),
    uOuter1: perObject('uOuter1', new THREE.Color())
  };

  // Ośrodek w punkcie p (wklejany w ciało pętli — jedna kopia w WGSL).
  const sampleMedium = (p) => {
    const res = vec4(0.0).toVar();
    const L = max(u.uLen, 0.001).toVar();
    const s = p.z.div(L).toVar();                      // 0 = wylot dyszy, 1 = koniec ciała
    // dawne `if (s > 1.32) return vec4(0.0);`
    If(s.greaterThan(1.32).not(), () => {
      const sc = clamp(s, 0.0, 1.32).toVar();
      const r = length(p.xy).toVar();
      const inNoz = select(s.lessThan(0.0), exp(p.z.mul(5.0)), float(1.0)).toVar();

      const flare = float(1.0).add(float(0.24).mul(sc.div(sc.add(0.055))).mul(exp(sc.negate().mul(6.5))));
      const taper = float(1.0).sub(float(0.56).mul(smoothstep(0.08, 1.20, sc)));
      const Renv = u.uWidth.mul(flare).mul(taper).toVar();

      // Fazy przepływu CAŁKOWANE na CPU (faza += prędkość·dt). Iloczyn czas·prędkość
      // skakał przy każdej zmianie prędkości i po minucie cofał strumień.
      const expand = float(1.0).div(float(0.55).add(float(0.95).mul(sc))).toVar();
      const fstr = u.uStretch;
      const q1 = vec3(p.xy.mul(expand).mul(1.45), p.z.mul(float(0.26).mul(fstr)).sub(u.uFlowPh.x));
      const n1 = peSnoise(q1).toVar();
      let n2;
      let n3;
      if (oct > 1) {
        const q2 = vec3(p.xy.mul(expand).mul(3.40), p.z.mul(float(0.62).mul(fstr)).sub(u.uFlowPh.y));
        n2 = peSnoise(q2).toVar();
      } else {
        n2 = n1.mul(0.6).toVar();
      }
      if (oct > 2) {
        const q3 = vec3(p.xy.mul(expand).mul(7.60).add(17.3), p.z.mul(float(1.45).mul(fstr)).sub(u.uFlowPh.z));
        n3 = peSnoise(q3).toVar();
      } else {
        n3 = n2.mul(0.6).toVar();
      }

      const tLow = n1;
      const tMid = n1.mul(0.55).add(n2.mul(0.45)).toVar();
      const tHigh = n1.mul(0.26).add(n2.mul(0.34)).add(n3.mul(0.40)).toVar();

      const tAmp = u.uTurb.mul(smoothstep(-0.02, 0.22, sc)).mul(float(1.0).add(float(0.45).mul(float(1.0).sub(u.uPower)))).toVar();

      const rq = r.div(max(Renv, 1e-4)).toVar();
      const rqB = rq.mul(float(1.0).sub(float(0.42).mul(tAmp).mul(tMid))).toVar();
      const rqS = rq.mul(float(1.0).sub(float(0.50).mul(tAmp).mul(tLow))).toVar();

      const tipN = float(0.17).mul(tAmp).mul(tLow).toVar();
      const eB = max(float(1.02).add(tipN), 0.34);
      const eS = max(float(1.30).add(tipN.mul(1.4)), 0.42);
      const axBody = float(1.0).sub(smoothstep(0.46, eB, sc));
      const axShe = float(1.0).sub(smoothstep(0.34, eS, sc)).toVar();
      const axCore = pow(float(1.0).sub(smoothstep(0.008, 0.26, sc)), 1.20);

      const body = pow(max(0.0, float(1.0).sub(rqB.mul(rqB))), 1.70).mul(axBody).toVar();
      const mott = float(0.72).add(float(0.56).mul(tMid.mul(0.5).add(0.5)));
      body.mulAssign(mix(0.98, mott, smoothstep(0.02, 0.30, sc)));

      const coreVis = smoothstep(0.14, 0.52, u.uPower).toVar();
      const Rc = u.uWidth.mul(float(0.18).add(float(0.27).mul(sc))).mul(float(0.70).add(float(0.42).mul(u.uPower)));
      const cr = r.div(max(Rc, 1e-4)).toVar();
      const core = exp(cr.negate().mul(cr).mul(2.9)).mul(axCore).toVar();
      core.mulAssign(float(0.86).add(float(0.28).mul(tHigh.mul(0.5).add(0.5))));
      core.mulAssign(float(1.0).add(float(0.19).mul(sin(sc.mul(33.0).sub(u.uMachPh))).mul(exp(sc.negate().mul(7.5)))));
      core.mulAssign(coreVis);

      const ign = exp(max(sc, 0.0).negate().mul(26.0)).mul(float(1.0).sub(smoothstep(0.35, 1.05, rq))).toVar();
      ign.mulAssign(float(0.85).add(float(0.30).mul(tHigh.mul(0.5).add(0.5))));

      const d = rqS.sub(0.88).div(0.26).toVar();
      const shell = exp(d.negate().mul(d));
      const skirt = exp(pow(max(0.0, rqS.sub(0.34)).div(0.66), 2.0).negate()).mul(0.46);
      const sheath = shell.add(skirt).mul(axShe).toVar();
      sheath.mulAssign(float(0.68).add(float(0.64).mul(tLow.mul(0.5).add(0.5))));
      sheath.mulAssign(float(0.45).add(float(0.75).mul(smoothstep(0.0, 0.35, sc))));

      const rm = clamp(rqB, 0.0, 1.2).toVar();
      const bodyCol = mix(u.uBody0, u.uBody1, smoothstep(0.00, 0.20, rm)).toVar();
      bodyCol.assign(mix(bodyCol, u.uBody2, smoothstep(0.12, 0.46, rm)));
      bodyCol.assign(mix(bodyCol, u.uBody3, smoothstep(0.38, 0.82, rm)));
      bodyCol.assign(mix(bodyCol, u.uOuter0, smoothstep(0.58, 1.34, sc.mul(0.74).add(rm.mul(0.46)))));
      bodyCol.assign(mix(bodyCol, mix(u.uOuter0, u.uOuter1, 0.45), u.uAfterglow.mul(0.85).add(float(1.0).sub(u.uPower).mul(0.18))));

      const coreCol = mix(u.uCoreWarm, u.uCoreCold, smoothstep(0.02, 0.26, sc));
      const sheathCol = mix(u.uOuter0, u.uOuter1, smoothstep(0.06, 0.70, sc));

      const noCore = float(1.0).sub(u.uAfterglow).toVar();
      const hollow = float(1.0).sub(float(0.50).mul(exp(cr.negate().mul(cr).mul(1.7))).mul(coreVis));
      const e = vec3(0.0).toVar();
      e.addAssign(coreCol.mul(core).mul(float(34.0).mul(u.uCore)).mul(noCore));
      e.addAssign(vec3(1.0, 0.90, 0.80).mul(ign).mul(float(3.4).add(float(16.0).mul(u.uIgnite)).mul(u.uCore)).mul(noCore));
      e.addAssign(bodyCol.mul(body).mul(hollow).mul(1.35).mul(u.uBodyGain));
      e.addAssign(sheathCol.mul(sheath).mul(float(0.46).mul(u.uSheath)).mul(u.uBodyGain));
      e.mulAssign(u.uBright.mul(u.uDensity).mul(inNoz));

      const dens = body.mul(0.55).add(core.mul(1.10)).add(sheath.mul(0.22)).add(ign.mul(0.5)).mul(inNoz);
      res.assign(vec4(e, dens));
    });
    return res;
  };

  const vLocal = varying(positionGeometry, 'vLocal');
  const fragmentNode = Fn(() => {
    const ro = vec3(0.0).toVar();
    const rd = vec3(0.0).toVar();
    If(u.uOrtho.greaterThan(0.5), () => {
      rd.assign(normalize(u.uCamDirL));
      ro.assign(vLocal.sub(rd.mul(u.uBoundZ1.mul(4.0).add(40.0))));
    }).Else(() => {
      ro.assign(u.uCamPosL);
      rd.assign(normalize(vLocal.sub(ro)));
    });

    const t0 = float(0.0).toVar();
    const t1 = float(1.0e9).toVar();
    // Dawne `discard` w granicach marszu. WGSL ma semantykę „demote to helper”
    // (Tint na D3D12: discard = flaga, kod po nim dalej się wykonuje), więc sam
    // Discard nie ominąłby pętli dla pikseli proxy poza walcem — marsz idzie
    // tylko przy `hit`, wynik piksela bez zmian.
    const hit = float(1.0).toVar();

    const a = dot(rd.xy, rd.xy).toVar();
    const b = float(2.0).mul(dot(ro.xy, rd.xy)).toVar();
    const c = dot(ro.xy, ro.xy).sub(u.uBoundR.mul(u.uBoundR)).toVar();
    If(a.lessThan(1.0e-7), () => {
      If(c.greaterThan(0.0), () => { hit.assign(0.0); });
    }).Else(() => {
      const disc = b.mul(b).sub(float(4.0).mul(a).mul(c)).toVar();
      If(disc.lessThan(0.0), () => { hit.assign(0.0); }).Else(() => {
        const sq = sqrt(disc).toVar();
        t0.assign(max(t0, b.negate().sub(sq).div(float(2.0).mul(a))));
        t1.assign(min(t1, b.negate().add(sq).div(float(2.0).mul(a))));
      });
    });
    If(abs(rd.z).lessThan(1.0e-7), () => {
      If(ro.z.lessThan(u.uBoundZ0).or(ro.z.greaterThan(u.uBoundZ1)), () => { hit.assign(0.0); });
    }).Else(() => {
      const ta = u.uBoundZ0.sub(ro.z).div(rd.z).toVar();
      const tb = u.uBoundZ1.sub(ro.z).div(rd.z).toVar();
      t0.assign(max(t0, min(ta, tb)));
      t1.assign(min(t1, max(ta, tb)));
    });
    t0.assign(max(t0, 0.0));
    If(t1.lessThanEqual(t0), () => { hit.assign(0.0); });
    If(hit.lessThan(0.5), () => { Discard(); });

    const acc = vec3(0.0).toVar();
    If(hit.greaterThan(0.5), () => {
      const stepLen = t1.sub(t0).div(float(steps)).toVar();
      // gl_FragCoord w konwencji GL (y od dołu celu) — ten sam wzór jittera co WebGL.
      const fragCoordGL = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y));
      const jit = peHash12(fragCoordGL.add(fract(u.uTime).mul(91.7))).mul(u.uJitter);
      const t = t0.add(stepLen.mul(jit)).toVar();
      const tr = float(1.0).toVar();

      Loop(steps, () => {
        const p = ro.add(rd.mul(t)).toVar();
        const m = sampleMedium(p);
        acc.addAssign(m.rgb.mul(stepLen).mul(tr));
        tr.mulAssign(exp(m.a.negate().mul(stepLen).mul(u.uExtinct)));
        If(tr.lessThan(0.012), () => { Break(); });
        t.addAssign(stepLen);
      });
    });

    const col = max(acc, 0.0).toVar();
    return vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
  })();

  const graph = { fragmentNode };
  plumeGraphs.set(key, graph);
  return graph;
}

/* ============================================================================
   2. BILLBOARDY POŚWIATY (view-space — działa w ortho i perspektywie)
   ========================================================================== */
let glowGraphCache = null;

function glowGraph() {
  if (glowGraphCache) return glowGraphCache;
  const u = {
    uSize: perObject('uSize', 0),
    uStretch: perObject('uStretch', 0),
    uColor: perObject('uColor', new THREE.Color()),
    uIntensity: perObject('uIntensity', 0),
    uFalloff: perObject('uFalloff', 0),
    uCoreBoost: perObject('uCoreBoost', 0),
    uTime: perObject('uTime', 0),
    uWobble: perObject('uWobble', 0)
  };
  const vertexNode = Fn(() => {
    const mv = modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).toVar();
    const xy = mv.xy.add(vec2(positionGeometry.x.mul(u.uSize).mul(u.uStretch), positionGeometry.y.mul(u.uSize)));
    return cameraProjectionMatrix.mul(vec4(xy, mv.z, mv.w));
  })();
  const fragmentNode = Fn(() => {
    const q = uv().sub(0.5).toVar();
    const d = length(q).mul(2.0).toVar();
    // atan(0, 0) jest niezdefiniowany — NaN w buforze HalfFloat bloom rozlewa
    // na cały ekran; przesunięcie o 1e-6 nic nie zmienia w obrazie.
    const ang = atan(q.y, q.x.add(1e-6)).toVar();
    const w = peSnoise(vec3(cos(ang).mul(1.6), sin(ang).mul(1.6), u.uTime.mul(0.6))).mul(u.uWobble);
    d.mulAssign(float(1.0).add(w));
    const f = max(0.0, float(1.0).sub(d)).toVar();
    const a = pow(f, u.uFalloff).add(u.uCoreBoost.mul(pow(f, u.uFalloff.mul(4.5)))).toVar();
    If(a.lessThan(0.0008), () => { Discard(); });
    const col = u.uColor.mul(a).mul(u.uIntensity).toVar();
    return vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
  })();
  glowGraphCache = { vertexNode, fragmentNode };
  return glowGraphCache;
}

/* ============================================================================
   3. CZĄSTKI — pozycja liczona proceduralnie w vertex shaderze; kwad na cząstkę
   (dawny punkt z gl_PointSize — WebGPU rysuje punkty tylko 1 px)
   ========================================================================== */
let particleGraphCache = null;

function particleGraph() {
  if (particleGraphCache) return particleGraphCache;
  const u = {
    uLifePh: perObject('uLifePh', 0),          // faza życia cząstek, całkowana na CPU (0..1)
    uLen: perObject('uLen', 0),
    uWidth: perObject('uWidth', 0),
    uEmit: perObject('uEmit', 0),
    uPower: perObject('uPower', 0),
    uSizeK: perObject('uSizeK', 0),
    uPixK: perObject('uPixK', 0),
    uOrtho: perObject('uOrtho', 0),
    uGain: perObject('uGain', 0),
    uPart0: perObject('uPart0', new THREE.Color()),
    uPart1: perObject('uPart1', new THREE.Color()),
    uPart2: perObject('uPart2', new THREE.Color())
  };
  const aSeed = attribute('aSeed', 'vec3');
  const aPhase = attribute('aPhase', 'float');
  const life = fract(u.uLifePh.add(aPhase));
  const gate = step(aPhase, u.uEmit);

  const vertexNode = Fn(() => {
    const lifeV = life.toVar();
    const sp = float(0.70).add(float(0.60).mul(aSeed.z));
    const z = lifeV.mul(u.uLen).mul(1.20).mul(sp);
    const ang = aSeed.x.mul(6.28318).add(lifeV.mul(2.4).mul(aSeed.z.sub(0.5))).toVar();
    const rad = float(0.16).add(float(0.80).mul(aSeed.y)).mul(u.uWidth).mul(float(0.55).add(float(1.10).mul(lifeV))).toVar();
    const wob = vec2(sin(lifeV.mul(12.0).add(aSeed.x.mul(31.0))), cos(lifeV.mul(9.5).add(aSeed.y.mul(27.0))))
      .mul(0.09).mul(u.uWidth).mul(lifeV);
    const pos = vec3(vec2(cos(ang).mul(rad), sin(ang).mul(rad)).add(wob), z);

    const mv = modelViewMatrix.mul(vec4(pos, 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(mv).toVar();

    const sz = float(0.026).add(float(0.042).mul(aSeed.z)).mul(float(1.0).sub(float(0.45).mul(lifeV))).mul(u.uWidth).toVar();
    const szP = sz.mul(u.uSizeK).div(max(mv.z.negate(), 0.01));
    const size = clamp(mix(szP, sz.mul(u.uPixK), u.uOrtho), 1.0, 42.0);
    // dawny punkt size × size pikseli celu: przesunięcie w NDC × w (dzielenie perspektywy)
    const off = positionGeometry.xy.mul(size).mul(2.0).div(viewportSize).mul(clip.w);
    return vec4(clip.xy.add(off), clip.z, clip.w);
  })();

  const fade = smoothstep(0.0, 0.05, life).mul(float(1.0).sub(smoothstep(0.30, 1.0, life)));
  const vA = varying(fade.mul(gate).mul(smoothstep(0.05, 0.4, u.uPower)), 'vA');
  const vC = varying(mix(u.uPart0, mix(u.uPart1, u.uPart2, smoothstep(0.25, 0.9, life)), smoothstep(0.015, 0.28, life)), 'vC');

  const fragmentNode = Fn(() => {
    // dawne gl_PointCoord = uv kwadu (funkcja odległości od środka — orientacja bez znaczenia)
    const d = length(uv().sub(0.5)).mul(2.0);
    const a = pow(max(0.0, float(1.0).sub(d)), 2.3).toVar();
    If(a.mul(vA).lessThan(0.002), () => { Discard(); });
    const col = vC.mul(a).mul(vA).mul(u.uGain).toVar();
    return vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
  })();
  particleGraphCache = { vertexNode, fragmentNode };
  return particleGraphCache;
}

// Materiał instancji puli: wspólny graf (ten sam klucz programu), własne wartości.
function makeFxMaterial(name, graph, uniforms, side) {
  const m = new NodeMaterial();
  m.name = name;
  if (graph.vertexNode) m.vertexNode = graph.vertexNode;
  m.fragmentNode = graph.fragmentNode;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = side;
  // Jak ShaderMaterial w WebGL: DoubleSide w jednym drawie, nie dwóch (tył + przód).
  m.forceSinglePass = true;
  m.fog = false;
  m.lights = false;
  blendAddytywnePremul(m);
  m.uniforms = uniforms;
  return m;
}

/* ============================================================================
   4. KLASA
   ========================================================================== */
// Jakość gry: HIGH z dema (44 kroki, 3 oktawy). Proxy jest duże, ale granice
// marszu liczą się z aktualnych rozmiarów, więc koszt idzie za plume.
const QUALITY = Object.freeze({ steps: 44, oct: 3, particles: 520, jitter: 1.0 });

// Zapas na NAJGORSZY przypadek: długość 5 × dopalacz 1 + 0,55 × zasięg otoczki
// 1,34 — za małe proxy ścina ogon płaszczyzną, a nic nie kosztuje.
const MAX_LEN = 110.0;
const MAX_RAD = 3.0;

const _m1 = new THREE.Matrix4();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _Z = new THREE.Vector3(0, 0, 1);

const clampJs = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
// wykładnicze dążenie niezależne od kroku czasu
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
// Szum poświaty ma okres 289 w przestrzeni szumu; czas mnożony przez 0,6.
const GLOW_TIME_WRAP = 289 / 0.6;

export class WarpPlumeFX {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'WarpPlumeFX';

    this.params = {
      coreBrightness: 1.00,
      plumeLength: 1.00,
      plumeWidth: 1.00,
      turbulence: 1.00,
      flowSpeed: 4.50,
      blueSheath: 1.00,
      flicker: 0.35,
      particles: 0.35,
      density: 1.00,
      bodyGain: 1.00,
      extinction: 0.28,
      boostAmount: 1.00
    };

    this.ch = {
      power: 0, core: 0, len: 0, wid: 0, bright: 0,
      sheath: 0, glow: 0, emit: 0, afterglow: 0, ignite: 0, boost: 0
    };
    this.boost = false;
    this.state = 'off';          // off | ignition | running | shutdown
    this.throttle = 0;
    this._stateT = 0;
    this._time = Math.random() * 10;
    this._ph = { o1: 0, o2: 0, o3: 0, mach: 0, life: 0, stretch: 1 };
    this._flickMul = 1;
    this._palIdx = -1;

    this._buildPlume();
    this._buildGlows();
    this._buildParticles();
    this.setPalette(0);
  }

  _buildPlume() {
    const g = new THREE.BoxGeometry(MAX_RAD * 2, MAX_RAD * 2, MAX_LEN + 1.0);
    g.translate(0, 0, (MAX_LEN + 1.0) * 0.5 - 0.5);
    this.plumeMat = makeFxMaterial('WarpPlume', plumeGraph(QUALITY.steps, QUALITY.oct), {
      uTime: { value: 0 }, uLen: { value: WARP_PLUME_BASE_LEN }, uWidth: { value: 1 }, uCore: { value: 1 },
      uBright: { value: 1 }, uTurb: { value: 1 }, uSheath: { value: 1 },
      uFlowPh: { value: new THREE.Vector3() }, uMachPh: { value: 0 }, uStretch: { value: 1 },
      uDensity: { value: 1 }, uBodyGain: { value: 1 }, uAfterglow: { value: 0 }, uPower: { value: 0 },
      uIgnite: { value: 0 }, uExtinct: { value: 0.28 },
      uCamPosL: { value: new THREE.Vector3() }, uCamDirL: { value: new THREE.Vector3(0, 0, -1) },
      uOrtho: { value: 1 }, uBoundR: { value: 1.5 }, uBoundZ0: { value: -0.5 }, uBoundZ1: { value: 12 },
      uJitter: { value: QUALITY.jitter },
      uCoreWarm: { value: new THREE.Color(1, 1, 1) }, uCoreCold: { value: new THREE.Color(1, 1, 1) },
      uBody0: { value: new THREE.Color() }, uBody1: { value: new THREE.Color() },
      uBody2: { value: new THREE.Color() }, uBody3: { value: new THREE.Color() },
      uOuter0: { value: new THREE.Color() }, uOuter1: { value: new THREE.Color() }
    }, THREE.BackSide);
    this.plume = new THREE.Mesh(g, this.plumeMat);
    this.plume.name = 'WarpPlume';
    this.plume.frustumCulled = false;
    this.plume.renderOrder = 1;
    this.root.add(this.plume);
  }

  _makeGlow(cfg) {
    const mat = makeFxMaterial('WarpPlumeGlow', glowGraph(), {
      uSize: { value: cfg.size }, uStretch: { value: 1 },
      uColor: { value: new THREE.Color() }, uIntensity: { value: 0 },
      uFalloff: { value: cfg.falloff }, uCoreBoost: { value: cfg.boost || 0 },
      uTime: { value: 0 }, uWobble: { value: cfg.wobble || 0 }
    }, THREE.DoubleSide);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.position.z = cfg.z;
    m.frustumCulled = false;
    m.renderOrder = cfg.order;
    this.root.add(m);
    return m;
  }

  _buildGlows() {
    this.glowHot = this._makeGlow({ size: 2.6, z: 0.10, falloff: 3.2, boost: 1.0, order: 3, wobble: 0.05 });
    this.glowMag = this._makeGlow({ size: 7.0, z: 0.90, falloff: 2.5, boost: 0.35, order: 2, wobble: 0.10 });
    this.glowBlue = this._makeGlow({ size: 14.0, z: 2.20, falloff: 2.1, boost: 0.0, order: 0, wobble: 0.14 });
  }

  _buildParticles() {
    const N = QUALITY.particles;
    // Kwad na cząstkę (instancje): pozycję liczy vertex shader z ziarna i fazy.
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const seed = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      seed[i * 3] = Math.random();
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = Math.random();
      phase[i] = Math.random();
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3));
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, MAX_LEN * 0.5), MAX_LEN);
    this.partMat = makeFxMaterial('WarpPlumeParticles', particleGraph(), {
      uLifePh: { value: 0 }, uLen: { value: WARP_PLUME_BASE_LEN }, uWidth: { value: 1 },
      uEmit: { value: 0 }, uPower: { value: 0 }, uSizeK: { value: 600 }, uPixK: { value: 20 },
      uOrtho: { value: 1 }, uGain: { value: 0.95 },
      uPart0: { value: new THREE.Color() }, uPart1: { value: new THREE.Color() },
      uPart2: { value: new THREE.Color() }
    }, THREE.DoubleSide);
    this.particles = new THREE.Mesh(g, this.partMat);
    this.particles.name = 'WarpPlumeParticles';
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 4;
    this.root.add(this.particles);
  }

  /** Paleta z WARP_PLASMA_PALETTES (indeks). */
  setPalette(idx) {
    const n = WARP_PLASMA_PALETTES.length;
    const k = ((Number(idx) | 0) % n + n) % n;
    if (k === this._palIdx) return;
    this._palIdx = k;
    const p = WARP_PLASMA_PALETTES[k];
    const U = this.plumeMat.uniforms;
    U.uCoreWarm.value.setHex(p.core[0]); U.uCoreCold.value.setHex(p.core[1]);
    U.uBody0.value.setHex(p.body[0]); U.uBody1.value.setHex(p.body[1]);
    U.uBody2.value.setHex(p.body[2]); U.uBody3.value.setHex(p.body[3]);
    U.uOuter0.value.setHex(p.outer[0]); U.uOuter1.value.setHex(p.outer[1]);
    this.glowHot.material.uniforms.uColor.value.setHex(p.glow[0]);
    this.glowMag.material.uniforms.uColor.value.setHex(p.glow[1]);
    this.glowBlue.material.uniforms.uColor.value.setHex(p.glow[2]);
    const pu = this.partMat.uniforms;
    pu.uPart0.value.setHex(p.part[0]);
    pu.uPart1.value.setHex(p.part[1]);
    pu.uPart2.value.setHex(p.part[2]);
  }

  ignite() {
    if (this.state === 'ignition' || this.state === 'running') return;
    this.state = 'ignition';
    this._stateT = 0;
    this.throttle = Math.max(this.throttle, 1);
  }

  shutdown() {
    if (this.state === 'off' || this.state === 'shutdown') return;
    this.state = 'shutdown';
    this._stateT = 0;
  }

  setBoost(on) { this.boost = !!on; }

  /** Instancja zgasła do końca — można ją oddać do puli. */
  get finished() {
    const ch = this.ch;
    return this.state === 'off' && ch.bright < 0.004 && ch.sheath < 0.004 && ch.glow < 0.004 && ch.ignite < 0.01;
  }

  /** Stan jak po utworzeniu — przed ponownym użyciem z puli. */
  reset() {
    for (const k of Object.keys(this.ch)) this.ch[k] = 0;
    this.boost = false;
    this.state = 'off';
    this.throttle = 0;
    this._stateT = 0;
    this._ph.stretch = 1;
  }

  /**
   * Pozycja i kierunek w scenie gry.
   * @param {number} x,y,z   wylot dyszy (scena)
   * @param {number} dirX,dirY kierunek wydechu w płaszczyźnie (jednostkowy)
   * @param {number} radius  promień wylotu dyszy [j. świata]
   */
  setPose(x, y, z, dirX, dirY, radius) {
    this.root.position.set(x, y, z);
    _v1.set(dirX, dirY, 0);
    if (_v1.lengthSq() < 1e-10) _v1.set(0, -1, 0);
    _v1.normalize();
    _q1.setFromUnitVectors(_Z, _v1);
    this.root.quaternion.copy(_q1);
    this.root.scale.setScalar(Math.max(1e-3, Number(radius) || 1));
  }

  update(dt, camera, viewportH, isOrtho) {
    this._time += dt;
    this._stateT += dt;
    const ch = this.ch;
    const P = this.params;
    const t = this._time;

    /* --------- automat stanów: każdy kanał ma inną charakterystykę ------- */
    let cmd = this.throttle;
    ch.ignite = approach(ch.ignite, 0, 9.0, dt);

    if (this.state === 'off') {
      cmd = 0;
      ch.afterglow = approach(ch.afterglow, 0, 5.0, dt);
    } else if (this.state === 'ignition') {
      const T = this._stateT;
      ch.afterglow = 0;
      if (T < 0.24) {
        cmd = 0.035 + 0.05 * (T / 0.24);
        ch.glow = approach(ch.glow, 1.35 * (0.25 + T / 0.24), 14, dt);
      } else {
        if (ch.ignite < 0.05 && T < 0.34) ch.ignite = 1.0;   // błysk zapłonu
        const u = clampJs((T - 0.24) / 0.62, 0, 1);
        const e = 1 - Math.pow(1 - u, 2.6);
        cmd = lerp(0.085, this.throttle, e);
        if (T > 0.95) { this.state = 'running'; this._stateT = 0; }
      }
    } else if (this.state === 'running') {
      ch.afterglow = approach(ch.afterglow, 0, 6.0, dt);
    } else { // shutdown
      cmd = 0;
      ch.afterglow = approach(ch.afterglow, 1, 7.0, dt);
      if (this._stateT > 1.5) this.state = 'off';
    }

    // 'dying' = shutdown ORAZ off — inaczej po zgaśnięciu kanały wracałyby
    // do wartości spoczynkowych i plume odradzałby się jako stały kikut.
    const dying = (this.state === 'shutdown' || this.state === 'off');

    ch.power = approach(ch.power, cmd, dying ? 7.5 : 3.6, dt);
    const coreTgt = Math.pow(clampJs((cmd - 0.07) / 0.93, 0, 1), 0.75);
    ch.core = approach(ch.core, dying ? 0 : coreTgt, dying ? 16 : 9, dt);
    const lenTgt = dying ? (0.22 * ch.sheath) : (0.16 + 0.84 * Math.pow(cmd, 0.72));
    ch.len = approach(ch.len, lenTgt, dying ? 9 : 5.2, dt);
    let widTgt = 0.55 + 0.45 * Math.pow(cmd, 0.5);
    if (dying) widTgt = (this._stateT < 0.22 && this.state === 'shutdown') ? ch.wid * 1.35 : 0.55 * ch.sheath;
    ch.wid = approach(ch.wid, widTgt, dying ? 3.2 : 2.6, dt);
    ch.bright = approach(ch.bright, dying ? 0 : (0.30 + 0.70 * cmd), dying ? 3.0 : 6.0, dt);
    ch.sheath = approach(ch.sheath, dying ? 0 : (0.45 + 0.55 * cmd), dying ? 1.9 : 3.4, dt);
    const glowTgt = dying ? 0 : (0.12 + 1.25 * Math.pow(cmd, 0.6));
    if (!(this.state === 'ignition' && this._stateT < 0.24)) {
      ch.glow = approach(ch.glow, glowTgt, dying ? 2.4 : 8, dt);
    }
    ch.emit = approach(ch.emit, dying ? 0 : cmd, 6, dt);
    const boostOn = this.boost && !dying && cmd > 0.25;
    ch.boost = approach(ch.boost, boostOn ? 1 : 0, boostOn ? 5.0 : 2.4, dt);

    /* --------------------------- flicker / drżenie ciśnienia ------------- */
    const unstable = P.flicker * (0.45 + 0.95 * (1 - ch.power)) * (ch.power > 0.01 ? 1 : 0);
    const f = Math.sin(t * 37.3) * 0.5 + Math.sin(t * 91.7) * 0.28 + Math.sin(t * 13.1) * 0.22;
    this._flickMul = 1 + unstable * 0.11 * f + ch.ignite * 0.9;

    /* ----------------------------- uniformy plume ------------------------ */
    const U = this.plumeMat.uniforms;
    // B = siła dopalacza: strumień SZYBSZY, dłuższy, nieco węższy i gorętszy.
    const B = ch.boost * P.boostAmount;
    const len = WARP_PLUME_BASE_LEN * P.plumeLength * Math.max(ch.len, 0.0001) * (1 + WARP_PLUME_BOOST_LEN * B);
    const width = P.plumeWidth * Math.max(ch.wid, 0.0001) * (1 - 0.10 * Math.min(B, 1.4));
    const flow = P.flowSpeed * (0.45 + 0.80 * ch.power) * (1 + 1.70 * B);

    // Całkowanie faz: prędkość strumienia = pochodna fazy, więc zmiana flow
    // zmienia tylko tempo. Oktawy żyją w przestrzeni szumu (z·k); simplex ma
    // okres 289, więc fazy zawijają się bez skoku obrazu. Rozciągnięcie k
    // przesuwa cechę na z o z·Δk/k — limit tempa zmian trzyma prędkość ogona
    // ≥ 30% flow, więc strumień nigdy nie płynie wstecz.
    const ph = this._ph;
    const zMax = Math.max(len * 1.34 + 0.4, 1);
    const maxLn = 0.7 * flow / zMax * dt;
    const lnD = clampJs(Math.log(1.17 / (1 + flow * 0.085) / ph.stretch), -maxLn, maxLn);
    ph.stretch *= Math.exp(lnD);
    const fstr = ph.stretch;
    const dz = flow * fstr * dt;
    ph.o1 = (ph.o1 + dz * 1.00 * 0.26) % 289;
    ph.o2 = (ph.o2 + dz * 2.30 * 0.62) % 289;
    ph.o3 = (ph.o3 + dz * 4.10 * 1.45) % 289;
    ph.mach = (ph.mach + flow * 5.0 * dt) % (Math.PI * 2);

    U.uTime.value = t % 1000;
    U.uLen.value = len;
    U.uWidth.value = width;
    U.uCore.value = P.coreBrightness * ch.core * this._flickMul * (1 + 0.30 * B);
    U.uBright.value = Math.max(ch.bright, ch.sheath * 0.60) * this._flickMul * (1 + 0.10 * B);
    U.uTurb.value = P.turbulence * (1 + 0.45 * B);
    U.uFlowPh.value.set(ph.o1, ph.o2, ph.o3);
    U.uMachPh.value = ph.mach;
    U.uStretch.value = fstr;
    U.uSheath.value = P.blueSheath * ch.sheath;
    U.uDensity.value = P.density;
    U.uBodyGain.value = P.bodyGain;
    U.uAfterglow.value = ch.afterglow;
    U.uPower.value = ch.power;
    U.uIgnite.value = ch.ignite;
    U.uExtinct.value = P.extinction;
    U.uBoundR.value = Math.min(MAX_RAD - 0.05, width * 1.45 + 0.20);
    U.uBoundZ0.value = -0.45;
    U.uBoundZ1.value = Math.min(MAX_LEN, len * 1.34 + 0.4);
    this.plume.visible = ch.bright > 0.004 || ch.sheath > 0.004;

    /* ---- kamera w przestrzeni lokalnej (poprawny raymarch w ortho) ------ */
    this.root.updateMatrixWorld(true);
    _m1.copy(this.plume.matrixWorld).invert();
    if (camera) {
      camera.getWorldPosition(_v1).applyMatrix4(_m1);
      U.uCamPosL.value.copy(_v1);
      camera.getWorldDirection(_v2).transformDirection(_m1).normalize();
      U.uCamDirL.value.copy(_v2);
    }
    U.uOrtho.value = isOrtho ? 1 : 0;

    /* ------------------------------ billboardy --------------------------- */
    const scl = this.root.scale.x;
    const glowT = t % GLOW_TIME_WRAP;
    const gh = this.glowHot.material.uniforms;
    gh.uTime.value = glowT;
    gh.uSize.value = (0.80 + 0.50 * ch.power) * scl;
    gh.uIntensity.value = (0.95 * ch.core + 3.2 * ch.ignite + 0.28 * ch.glow) * this._flickMul * (1 - ch.afterglow * 0.85);
    const gm = this.glowMag.material.uniforms;
    gm.uTime.value = glowT;
    gm.uSize.value = (2.3 + 1.7 * ch.power) * scl;
    gm.uIntensity.value = (0.30 * ch.bright + 0.8 * ch.ignite) * this._flickMul * (1 - ch.afterglow * 0.35);
    this.glowMag.position.z = 0.40 + 0.55 * ch.len;
    const gb = this.glowBlue.material.uniforms;
    gb.uTime.value = glowT;
    gb.uSize.value = (4.0 + 3.4 * ch.power) * scl;
    gb.uIntensity.value = 0.075 * ch.sheath * P.blueSheath * (0.5 + 0.5 * this._flickMul);
    this.glowBlue.position.z = 0.9 + 1.5 * ch.len;
    this.glowHot.visible = gh.uIntensity.value > 0.004;
    this.glowMag.visible = gm.uIntensity.value > 0.004;
    this.glowBlue.visible = gb.uIntensity.value > 0.004;

    /* -------------------------------- cząstki ---------------------------- */
    const pu = this.partMat.uniforms;
    const count = Math.floor(QUALITY.particles * P.particles);
    this.particles.geometry.instanceCount = count;
    this.particles.visible = count > 0 && ch.emit > 0.01;
    const partFlow = (0.55 + 0.9 * ch.power) * (1 + 1.5 * B);
    ph.life = (ph.life + partFlow * dt) % 1;
    pu.uLifePh.value = ph.life;
    pu.uLen.value = len;
    pu.uWidth.value = width;
    pu.uEmit.value = ch.emit;
    pu.uPower.value = ch.power;
    pu.uOrtho.value = isOrtho ? 1 : 0;
    pu.uGain.value = 0.95 * this._flickMul;
    if (camera && !isOrtho && camera.isPerspectiveCamera) {
      pu.uSizeK.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
    } else if (camera && camera.isOrthographicCamera) {
      pu.uPixK.value = viewportH / ((camera.top - camera.bottom) / (camera.zoom || 1)) * scl;
    }
  }

  /** Siatki do kompilacji shaderów na ekranie ładowania. */
  get meshes() {
    return [this.plume, this.glowHot, this.glowMag, this.glowBlue, this.particles];
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

// Dla testów: grafy (budowane raz na wariant) i jakość gry.
export const WarpPlumeInternals = Object.freeze({ plumeGraph, glowGraph, particleGraph, QUALITY });

/* ============================================================================
   5. PULA
   ========================================================================== */
// Gracz ma 5 dysz, ciężka flota piracka wlatuje skokiem kilkunastoma — ponad
// limit dysze dostają strugę MAIN z dopalaczem (EngineVfxSystem).
export const WARP_PLUME_CAP = 16;

const free = [];
let active = 0;

export const WarpPlume3D = {
  get cap() { return WARP_PLUME_CAP; },
  get activeCount() { return active; },

  /** Instancja z puli albo null, gdy limit wyczerpany / brak Core3D. */
  acquire() {
    if (active >= WARP_PLUME_CAP) return null;
    if (!Core3D.isInitialized || !Core3D.scene) return null;
    const fx = free.pop() || new WarpPlumeFX();
    if (fx.root.parent !== Core3D.scene) Core3D.scene.add(fx.root);
    fx.reset();
    fx.root.visible = true;
    active++;
    return fx;
  },

  release(fx) {
    if (!fx) return;
    fx.reset();
    fx.root.visible = false;
    free.push(fx);
    active = Math.max(0, active - 1);
  },

  /**
   * Obiekty do kompilacji na ekranie ładowania (widoczność ustawia wołający).
   * Instancja zostaje w puli — pierwszy skok nie buduje już niczego, a kolejne
   * instancje mają ten sam graf (ten sam program).
   */
  prewarm() {
    if (!Core3D.isInitialized || !Core3D.scene) return [];
    let fx = free[free.length - 1];
    if (!fx) {
      fx = new WarpPlumeFX();
      fx.root.visible = false;
      Core3D.scene.add(fx.root);
      free.push(fx);
    }
    return [fx.root, ...fx.meshes];
  },

  disposeAll() {
    for (const fx of free) fx.dispose();
    free.length = 0;
    active = 0;
  }
};
