// src/3d/coreFx3D.tsl.js
//
// Materiały efektów rdzenia w TSL (port WebGPU, zadanie 15; docs/webgpu/PLAN.md §3).
// Odpowiednik dawnego GLSL z coreFx3D.js: GLOW_* (żar reaktora pod kadłubem),
// VENT_* (wyrzuty plazmy), JET_* (strumień), ORB_* (kula), RING_* (pierścień),
// FLASH_* (rozbłysk). Wzory 1:1 z WebGL, w tej samej kolejności.
//
// Każdy efekt ma jeden materiał (jeden mesh z InstancedBufferGeometry, zwykły
// Mesh — bez uuid obiektu w kluczu), graf budowany raz przy createCoreFx3D.
// Blend jak dawniej: ONE/ONE na kolorze i alfie (blendAddytywnePremul z
// tsl/mieszanie.js — NIE premultipliedAlpha, które w NodeMaterial mnoży rgb przez
// alfę w shaderze), alfa z shadera = max(rgb) liniowo.
//
// Pułapki WGSL (PLAN §3): smoothstep z odwróconymi krawędziami (stałymi — błąd
// kompilacji, w biegu — wynik niezdefiniowany) liczony wzorem jak HLSL (baza
// WebGL: ANGLE/FXC) — smoothRev; pow z ujemną podstawą = NaN — kwadrat
// mnożeniem, podstawy potęg niecałkowitych obcięte do ≥ 0.
//
// Pozycje: jak w WebGL — atrybuty w układzie świata sceny (x, −y), mesh
// w początku układu (macierz jednostkowa), więc modelViewMatrix = macierz
// widoku (liczona na CPU w double, renderer.highPrecision — ten sam wynik).
// AGENT: precyzja przy 5–10 mln j. (początek przy kamerze w mesh.position,
// dane względem niego) — patrz nagłówek coreFx3D.js; shadery już biorą
// modelViewMatrix, zmiana dotyczy tylko CPU (atrybuty + mesh.position).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard,
  abs, atan, attribute, cameraProjectionMatrix, clamp, cos, dot, exp, float, floor, fract, length, max, min, mix,
  modelViewMatrix, positionGeometry, pow, select, sin, smoothstep, sqrt, step, uniform, varying, vec2, vec3, vec4
} from 'three/tsl';
import { uniformsAdapter } from './tsl/uniformy.js';
import { blendAddytywnePremul } from './tsl/mieszanie.js';

// smoothstep wzorem (jak rozwija go HLSL): poprawny także dla e0 > e1.
const smoothRev = (e0, e1, x) => {
  const t = clamp(float(x).sub(e0).div(float(e1).sub(e0)), 0.0, 1.0);
  return t.mul(t).mul(float(3.0).sub(t.mul(2.0)));
};

// NOISE_GLSL: hasz z sin, szum wartości 2D, fbm 3 oktawy.
const cfxHash = /*@__PURE__*/ Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)))
  .setLayout({ name: 'cfxHash', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
const cfxNoise = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  f.assign(f.mul(f).mul(float(3.0).sub(f.mul(2.0))));
  const a = cfxHash(i);
  const b = cfxHash(i.add(vec2(1.0, 0.0)));
  const c = cfxHash(i.add(vec2(0.0, 1.0)));
  const d = cfxHash(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}).setLayout({ name: 'cfxNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
const cfxFbm = /*@__PURE__*/ Fn(([p0]) => {
  const p = vec2(p0).toVar();
  const v = float(0.0).toVar();
  v.addAssign(cfxNoise(p).mul(0.55));
  p.mulAssign(2.03);
  v.addAssign(cfxNoise(p).mul(0.28));
  p.mulAssign(2.01);
  v.addAssign(cfxNoise(p).mul(0.17));
  return v;
}).setLayout({ name: 'cfxFbm', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const WHITE = vec3(1.0, 0.97, 0.92);

// Wyjście efektu: kolor liniowy, alfa = max(rgb) (≤ 1) — ONE/ONE jak blend bloomu.
const fxOut = (col) => vec4(col, min(1.0, max(col.x, max(col.y, col.z))));

// Punkt świata sceny (x, y) na płaszczyźnie z = uZ → przestrzeń obcinania.
const clipAt = (xy, z) => cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(xy, z, 1.0));

function fxMaterial(name, U, vertexNode, fragmentNode) {
  const material = new THREE.NodeMaterial();
  material.name = `coreFx3D:${name}`;
  material.uniforms = U;
  material.lights = false;
  material.fog = false;
  // ONE/ONE jak dawne AdditiveBlending + premultipliedAlpha (tsl/mieszanie.js):
  // NodeMaterial z premultipliedAlpha mnożyłby rgb przez alfę w shaderze —
  // słabe wyrzuty (alfa = max(rgb) < 1) gasły kwadratowo.
  blendAddytywnePremul(material);
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.vertexNode = vertexNode;
  material.fragmentNode = fragmentNode;
  return material;
}

/** Żar reaktora: kwad pod kadłubem (widać go tylko przez wyrwę — test głębi). */
export function createCoreGlowMaterial({ z, coreEdge }) {
  const U = uniformsAdapter({ uTime: uniform(0), uZ: uniform(z) });
  const aCore = attribute('aCore', 'vec4');     // x, y (scena), promień (świat), obrót
  const aColor = attribute('aColor', 'vec4');   // barwa ciała (znormalizowana do pasma), ziarno
  const aState = attribute('aState', 'vec4');   // jasność ciała L, jasność rdzenia L, promień rdzenia (0-1), puls 0-1
  const vUv = varying(positionGeometry.xy, 'vCfxUv');
  const vColor = varying(aColor, 'vCfxColor');
  const vState = varying(aState, 'vCfxState');
  const vertexNode = Fn(() => {
    const c = cos(aCore.w).toVar();
    const s = sin(aCore.w).toVar();
    const pg = positionGeometry;
    const p = vec2(pg.x.mul(c).sub(pg.y.mul(s)), pg.x.mul(s).add(pg.y.mul(c))).mul(aCore.z).toVar();
    return clipAt(vec2(aCore.x.add(p.x), aCore.y.add(p.y)), U.uZ);
  })();
  const fragmentNode = Fn(() => {
    const r = length(vUv).toVar();
    If(r.greaterThan(1.0), () => {
      Discard();
    });
    const seed = vColor.w;
    const pulse = vState.w;
    // Wir plazmy we współrzędnych biegunowych: kąt obraca się, promień płynie do środka.
    const ang = atan(vUv.y, vUv.x);
    const q = vec2(ang.mul(1.2).add(U.uTime.mul(0.35)).add(seed.mul(13.0)), r.mul(3.2).sub(U.uTime.mul(pulse.mul(1.6).add(0.7))));
    const n = cfxFbm(q.mul(1.7).add(seed.mul(7.0)));
    const bodyProfile = smoothRev(1.0, 0.1, r);
    const body = bodyProfile.mul(n.mul(0.65).add(0.35)).mul(pulse.mul(0.14).add(0.86)).toVar();
    const coreR = max(0.02, vState.z).mul(pulse.mul(0.18).add(1.0)).toVar();
    // Ostra krawędź: mało pikseli w paśmie 0,9–8, które bloom brałby w całości.
    const core = smoothRev(coreR, coreR.mul(coreEdge), r);
    // Ciało pod progiem bloomu także przy rdzeniu (bez sumy ciało + rdzeń > 0,9 wokół).
    body.mulAssign(smoothstep(coreR.mul(0.6), coreR.mul(1.6), r).mul(0.35).add(0.65));
    const col = vColor.rgb.mul(vState.x.mul(body)).add(WHITE.mul(vState.y.mul(core))).toVar();
    return fxOut(col);
  })();
  return fxMaterial('glow', U, vertexNode, fragmentNode);
}

/** Wyrzuty plazmy: pierścień cząstek nad kadłubem (czas życia z atrybutów). */
export function createCoreVentMaterial({ z, coreEdge, hotLife, hotRadius }) {
  const U = uniformsAdapter({ uTime: uniform(0), uZ: uniform(z) });
  const aStart = attribute('aStart', 'vec4');   // x, y (scena), vx, vy
  const aLife = attribute('aLife', 'vec4');     // t0, życie, rozmiar startowy, rozmiar końcowy
  const aColor = attribute('aColor', 'vec4');   // barwa ciała (pasmo), jasność białego rdzenia
  const age = U.uTime.sub(aLife.x);
  const t = age.div(aLife.y);
  const vUv = varying(positionGeometry.xy, 'vCfxUv');
  const vColor = varying(aColor, 'vCfxColor');
  const vAge = varying(t, 'vCfxAge');
  const vertexNode = Fn(() => {
    const dead = age.lessThan(0.0).or(age.greaterThan(aLife.y));
    const drag = 2.4;
    const pos = aStart.xy.add(aStart.zw.mul(float(1.0).sub(exp(age.mul(-drag))).div(drag)));
    // sqrt z ujemnego t (przed startem) = NaN — obcięte; takie instancje i tak lecą poza obcięcie.
    const size = mix(aLife.z, aLife.w, sqrt(max(t, 0.0)));
    const clip = clipAt(pos.add(positionGeometry.xy.mul(size)), U.uZ);
    return select(dead, vec4(2.0, 2.0, 2.0, 1.0), clip);
  })();
  const fragmentNode = Fn(() => {
    const r = length(vUv).toVar();
    If(r.greaterThan(1.0), () => {
      Discard();
    });
    const soft = pow(max(float(1.0).sub(r), 0.0), 1.7);
    const k = float(1.0).sub(vAge);
    const fade = k.mul(k);
    // Głowica: ostra w przestrzeni i w czasie — piksele w paśmie 8–12 albo 0.
    const hot = step(vAge, hotLife).mul(float(1.0).sub(smoothstep(hotRadius * coreEdge, hotRadius, r)));
    const col = vColor.rgb.mul(soft.mul(fade)).add(vec3(1.0, 0.96, 0.9).mul(vColor.a.mul(hot))).toVar();
    return fxOut(col);
  })();
  return fxMaterial('vents', U, vertexNode, fragmentNode);
}

/** Strumień plazmy po detonacji (odcinek od wyrwy do celu). */
export function createCoreJetMaterial({ z, coreEdge }) {
  const U = uniformsAdapter({ uTime: uniform(0), uZ: uniform(z) });
  const aSeg = attribute('aSeg', 'vec4');     // początek x, y; koniec x, y (scena)
  const aJet = attribute('aJet', 'vec4');     // półszerokość (świat), obwiednia 0–1, ziarno, długość (świat)
  const aColor = attribute('aColor', 'vec4'); // barwa ciała (pasmo), jasność białej żyły
  const u = positionGeometry.x.add(0.5);
  const vUv = varying(vec2(u, positionGeometry.y.mul(2.0)), 'vCfxUv');
  const vJet = varying(aJet, 'vCfxJet');
  const vColor = varying(aColor, 'vCfxColor');
  const vertexNode = Fn(() => {
    const a = aSeg.xy;
    const d = aSeg.zw.sub(a).toVar();
    const len = max(1.0, length(d)).toVar();
    const dir = d.div(len).toVar();
    const nrm = vec2(dir.y.negate(), dir.x);
    // w wyrwie zwężony, na celu rozlany (rozprysk na pancerzu)
    const w = aJet.x.mul(smoothstep(0.0, 0.2, u).mul(0.45).add(0.55)).mul(smoothstep(0.86, 1.0, u).mul(0.7).add(1.0));
    const p = a.add(dir.mul(u.mul(len))).add(nrm.mul(positionGeometry.y.mul(2.0).mul(w)));
    return clipAt(p, U.uZ);
  })();
  const fragmentNode = Fn(() => {
    const uu = vUv.x.toVar();
    const across = abs(vUv.y).toVar();
    const flow = cfxFbm(vec2(uu.mul(vJet.w).div(70.0).sub(U.uTime.mul(9.0)).add(vJet.z.mul(17.0)), vUv.y.mul(2.2)));
    const w = flow.mul(0.4).add(0.6).toVar();
    const body = smoothRev(w, w.mul(0.2), across);
    // biała żyła tylko przy wylocie z wyrwy (pierwsze 30% długości): na całej
    // długości bloom z linii 8+ zjadał barwę frakcji i strumień robił się biały
    const vein = float(1.0).sub(smoothstep(0.09 * coreEdge, 0.09, across.div(max(0.4, w)))).mul(float(1.0).sub(smoothstep(0.26, 0.3, uu)));
    const tail = smoothRev(1.0, 0.9, uu).toVar();
    const env = vJet.y;
    const on = step(0.4, env);
    const col = vColor.rgb.mul(body.mul(env).mul(tail)).add(WHITE.mul(vein.mul(vColor.a).mul(on).mul(tail))).toVar();
    return fxOut(col);
  })();
  return fxMaterial('jets', U, vertexNode, fragmentNode);
}

/** Kula plazmy (wypadła z komory, leci i topi). */
export function createCoreOrbMaterial({ z, coreEdge }) {
  const U = uniformsAdapter({ uTime: uniform(0), uZ: uniform(z) });
  const aOrb = attribute('aOrb', 'vec4');     // x, y (scena), promień obrazu (świat), faza wirowania
  const aOrbS = attribute('aOrbS', 'vec4');   // postęp zapalnika 0–1, ziarno, jasność ciała, jasność rdzenia
  const aColor = attribute('aColor', 'vec4'); // barwa (pasmo)
  const vUv = varying(positionGeometry.xy, 'vCfxUv');
  const vS = varying(aOrbS, 'vCfxS');
  const vColor = varying(aColor, 'vCfxColor');
  const vPhase = varying(aOrb.w, 'vCfxPhase');
  const vertexNode = clipAt(aOrb.xy.add(positionGeometry.xy.mul(aOrb.z)), U.uZ);
  const fragmentNode = Fn(() => {
    const r = length(vUv).toVar();
    If(r.greaterThan(1.0), () => {
      Discard();
    });
    const fuse = vS.x.toVar();
    // torus plazmy, który wypadł z komory: jasny pierścień wiruje, mgiełka wokół
    const ang = atan(vUv.y, vUv.x).add(vPhase);
    const q = vec2(ang.mul(1.6), r.mul(4.5).sub(U.uTime.mul(1.6)).add(vS.y.mul(9.0)));
    const n = cfxFbm(q.mul(1.4).add(vS.y.mul(5.0)));
    // pow(x, 2) z ujemną podstawą (r < 0,5) = NaN w WGSL — kwadrat mnożeniem.
    const x = r.sub(0.5).div(0.19);
    const ring = exp(x.mul(x).negate());
    const haze = smoothRev(1.0, 0.0, r).mul(0.28);
    const body = ring.mul(n.mul(0.45).add(0.55)).add(haze).mul(vS.z);
    // serce pulsuje coraz szybciej, im bliżej zapalnika
    const pulse = sin(U.uTime.mul(mix(6.0, 30.0, fuse.mul(fuse))).add(vS.y.mul(6.0))).mul(0.5).add(0.5);
    const coreR = pulse.mul(0.05).mul(fuse.mul(0.6).add(0.4)).add(0.08).toVar();
    const core = float(1.0).sub(smoothstep(coreR.mul(coreEdge), coreR, r));
    const col = vColor.rgb.mul(body).add(WHITE.mul(core.mul(vS.w))).toVar();
    return fxOut(col);
  })();
  return fxMaterial('orbs', U, vertexNode, fragmentNode);
}

/** Pierścień plazmy (front fali po detonacji). */
export function createCoreRingMaterial({ z, coreEdge }) {
  const U = uniformsAdapter({ uTime: uniform(0), uZ: uniform(z) });
  const aRing = attribute('aRing', 'vec4');   // x, y (scena), promień frontu (świat), grubość względna
  const aRingS = attribute('aRingS', 'vec4'); // wiek 0–1, jasność ciała, jasność białej krawędzi, ziarno
  const aColor = attribute('aColor', 'vec4'); // barwa (pasmo)
  const vUv = varying(positionGeometry.xy.mul(1.25), 'vCfxUv');
  const vS = varying(aRingS, 'vCfxS');
  const vColor = varying(aColor, 'vCfxColor');
  const vTh = varying(aRing.w, 'vCfxTh');
  const vertexNode = clipAt(aRing.xy.add(positionGeometry.xy.mul(aRing.z).mul(1.25)), U.uZ);
  const fragmentNode = Fn(() => {
    const r = length(vUv).toVar();
    If(r.greaterThan(1.25), () => {
      Discard();
    });
    const th = max(0.01, vTh).toVar();
    const age = vS.x.toVar();
    const ang = atan(vUv.y, vUv.x);
    const n = cfxNoise(vec2(ang.mul(5.0).add(vS.w.mul(13.0)), age.mul(3.0)));
    const d = r.sub(1.0).div(th).toVar();
    // za frontem plazma ciągnie się dłużej niż przed nim
    const prof = select(d.lessThan(0.0), exp(d.mul(d).mul(-0.6)), exp(d.mul(d).mul(-4.0)));
    const fade = pow(max(float(1.0).sub(age), 0.0), 1.6);
    const body = prof.mul(n.mul(0.35).add(0.65)).mul(fade).mul(vS.y);
    const e = th.mul(0.22).toVar();
    const edge = step(age, 0.18).mul(float(1.0).sub(smoothstep(e.mul(coreEdge), e, abs(r.sub(1.0)))));
    const col = vColor.rgb.mul(body).add(WHITE.mul(edge.mul(vS.z))).toVar();
    return fxOut(col);
  })();
  return fxMaterial('rings', U, vertexNode, fragmentNode);
}

/**
 * Rozbłysk plazmy: mała biała kula (ostra, 8–12, gaśnie po 30% życia) i barwny
 * rozbłysk pod progiem pasma barwy.
 */
export function createCoreFlashMaterial({ z, coreEdge }) {
  const U = uniformsAdapter({ uTime: uniform(0), uZ: uniform(z) });
  const aFlash = attribute('aFlash', 'vec4');   // x, y (scena), promień (świat), wiek 0–1
  const aFlashS = attribute('aFlashS', 'vec4'); // jasność bieli, jasność ciała, ziarno, —
  const aColor = attribute('aColor', 'vec4');   // barwa (pasmo)
  const vUv = varying(positionGeometry.xy, 'vCfxUv');
  const vF = varying(aFlash, 'vCfxF');
  const vS = varying(aFlashS, 'vCfxS');
  const vColor = varying(aColor, 'vCfxColor');
  const vertexNode = clipAt(aFlash.xy.add(positionGeometry.xy.mul(aFlash.z)), U.uZ);
  const fragmentNode = Fn(() => {
    const r = length(vUv).toVar();
    If(r.greaterThan(1.0), () => {
      Discard();
    });
    const age = vF.w.toVar();
    const coreR = mix(0.3, 0.07, clamp(age.div(0.3), 0.0, 1.0)).toVar();
    const white = step(age, 0.3).mul(float(1.0).sub(smoothstep(coreR.mul(coreEdge), coreR, r)));
    const ang = atan(vUv.y, vUv.x);
    const n = cfxNoise(vec2(ang.mul(4.0).add(vS.z.mul(11.0)), r.mul(3.0).add(age.mul(2.0))));
    const halo = pow(max(0.0, float(1.0).sub(r)), 1.6).mul(n.mul(0.25).add(0.75));
    const body = halo.mul(pow(max(float(1.0).sub(age), 0.0), 1.8)).mul(vS.y);
    const col = vColor.rgb.mul(body).add(WHITE.mul(white.mul(vS.x))).toVar();
    return fxOut(col);
  })();
  return fxMaterial('flashes', U, vertexNode, fragmentNode);
}

// Eksport węzłów do testów (bez GPU).
export const CORE_FX_TSL_INTERNALS = Object.freeze({ smoothRev, cfxHash, cfxNoise, cfxFbm });
