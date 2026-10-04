// src/3d/cargoDrones3D.tsl.js
//
// Materiały TSL dronów Z5 (cargoDrones3D.js) — port 1:1 z dawnego GLSL (DRONE_*, LIGHT_*).
// Bryła: ta sama paralaksa, ścisk głębi i światło co kontenery (cargoContainers3D.tsl.js,
// wspólne węzły uniformów). Światła: billboardy (kwady instancji — nie punkty) w FG,
// AdditiveBlending (te same czynniki w WebGL r183 i WebGPU, mieszanie.js).
import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If, attribute, clamp, cos, exp, float, fract, int, length, max, min, mix, normalize, positionGeometry, pow,
  select, sin, smoothstep, step, varying, vec3, vec4
} from 'three/tsl';
import { cgDitherDiscard, cgLightDir, cgNoise, cgProjectLocal, cgShade, cgToObject } from './cargoContainers3D.tsl.js';
import { uniformNode } from './tsl/uniformy.js';

const flat = (node, name) => varying(node, name).setInterpolation('flat');

function baseMaterial(name) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.lights = false;
  m.fog = false;
  return m;
}

/** Bryła drona. U — wspólne uniformy kontenerów, paint — wpis adaptera uDronePaint (6 × vec3). */
export function createDroneMaterial(U, paint) {
  const m = baseMaterial('CARGO3D_DRONES');
  m.transparent = true;
  m.depthWrite = true;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  m.forceSinglePass = true;

  const aPart = attribute('aPart', 'float');
  const aMat = attribute('aMat', 'float');
  const iPos = attribute('iPos', 'vec4');
  const iSize = attribute('iSize', 'vec4');
  const iState = attribute('iState', 'vec4');
  const lp = positionGeometry.mul(iSize.xyz);
  // Rama chwytaka opada o DROP, zastrzały sięgają za nią.
  const frame = aPart.greaterThan(0.5).and(aPart.lessThan(1.5));
  const strut = aPart.greaterThan(1.5).and(aPart.lessThan(2.5)).and(positionGeometry.z.lessThan(0.3));
  const lz = lp.z.sub(select(frame.or(strut), iState.z, float(0.0)));
  const c = cos(iPos.w);
  const s = sin(iPos.w);
  const wz = max(iPos.z.add(lz), iState.y);
  const wp = vec3(iPos.x.add(c.mul(lp.x)).sub(s.mul(lp.y)), iPos.y.add(s.mul(lp.x)).add(c.mul(lp.y)), wz);
  m.positionNode = cgProjectLocal(wp, U);

  const vUnit = varying(positionGeometry, 'vCgUnit');
  const vObjN = varying(attribute('normal', 'vec3'), 'vCgObjN');
  const vObjL = varying(cgToObject(cgLightDir(wp, iState.x, U), c, s), 'vCgObjL');
  const vMat = flat(aMat, 'vCgMat');
  const vSize = flat(iSize, 'vCgSize');
  const vState = flat(iState, 'vCgState');
  const pal = uniformNode(paint);

  m.fragmentNode = Fn(() => {
    cgDitherDiscard(vSize.w);
    const mi = int(clamp(vMat.add(0.5), 0.0, 5.0));
    const albedo = vec3(pal.element(mi)).toVar();
    const specK = float(0.5).toVar();
    const specPow = float(24.0).toVar();
    const N = normalize(vObjN);
    const wl = vUnit.mul(vSize.xyz).toVar();
    If(mi.equal(3), () => {
      // Zamki chwytaka: pasy ostrzegawcze.
      const st = step(0.5, fract(wl.x.add(wl.y).div(max(min(vSize.x, vSize.y).mul(0.035), 0.12))));
      albedo.assign(mix(albedo, vec3(0.02), st));
    }).ElseIf(mi.equal(0), () => {
      // Panele korpusu i lekkie zabrudzenie.
      albedo.mulAssign(cgNoise(wl.xy.mul(float(3.0).div(max(vSize.y, 1.0))).add(vState.w.mul(13.0))).mul(0.2).add(0.88));
      specK.assign(0.7);
    }).ElseIf(mi.equal(5), () => {
      specK.assign(2.0); specPow.assign(64.0);
    }).ElseIf(mi.equal(4), () => {
      specK.assign(1.1); specPow.assign(40.0);
    });
    const col = cgShade(albedo, N, normalize(vObjL), vState.x, U.uCgShip.x, specK, specPow, U);
    return vec4(col, 1.0);
  })();
  return m;
}

/**
 * Światła dronów: billboard w FG. iLight: środek (względem origin, prawdziwe z) i promień,
 * iColor: barwa × moc, kształt (0 punkt z poświatą, 1 błysk RCS). L — wpisy adaptera
 * (uFgParallax, uCamRight, uCamUp, uBillboard, uLightGain).
 */
export function createDroneLightMaterial(L) {
  const m = baseMaterial('CARGO3D_DRONE_LIGHTS');
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  m.depthWrite = false;
  m.depthTest = true;

  const iLight = attribute('iLight', 'vec4');
  const iColor = attribute('iColor', 'vec4');
  const P = L.uFgParallax;
  // Pass FG ma kamerę perspektywiczną nad z = 0: nad płaszczyzną lotu dron jest w passie
  // ortho bez paralaksy, więc światło cofamy o nią (pozycja i skala).
  const p0 = iLight.xyz;
  const back = P.w.greaterThan(0.5).and(p0.z.greaterThan(0.0));
  const k = select(back, P.z.sub(p0.z).div(P.z), float(1.0));
  const pxy = select(back, P.xy.add(p0.xy.sub(P.xy).mul(k)), p0.xy);
  const r = iLight.w.mul(k);
  const bill = L.uBillboard.greaterThan(0.5);
  const right = select(bill, L.uCamRight, vec3(1.0, 0.0, 0.0));
  const up = select(bill, L.uCamUp, vec3(0.0, 1.0, 0.0));
  const q = positionGeometry.xy;
  m.positionNode = vec3(pxy, p0.z).add(right.mul(q.x).add(up.mul(q.y)).mul(r.mul(2.0)));

  const vQ = varying(q.mul(2.0), 'vCgQ');
  const vColor = flat(iColor, 'vCgColor');

  m.fragmentNode = Fn(() => {
    const d = length(vQ).toVar();
    If(d.greaterThan(1.0), () => { Discard(); });
    const core = float(0.0).toVar();
    const halo = float(0.0).toVar();
    If(vColor.w.greaterThan(0.5), () => {
      // Błysk RCS: miękki obłok bez twardego rdzenia.
      core.assign(exp(d.mul(d).mul(-9.0)));
      halo.assign(exp(d.mul(d).mul(-3.0)).mul(0.25));
    }).Else(() => {
      core.assign(float(1.0).sub(smoothstep(0.12, 0.22, d)));
      halo.assign(pow(max(float(1.0).sub(d), 0.0), 2.4).mul(float(1.0).sub(core)));
    });
    const col = vColor.rgb.mul(core.add(halo.mul(L.uLightGain.x)));
    const a = clamp(core.add(halo.mul(0.5)), 0.0, 1.0).toVar();
    If(a.lessThan(0.003), () => { Discard(); });
    return vec4(col, a);
  })();
  return m;
}
