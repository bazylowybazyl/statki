// Graf TSL kadłuba w budowie na pochylni (port WebGPU; dawne HULL_VERTEX / HULL_FRAGMENT z
// portHullBuild3D.js, 1:1 co do wzorów). Graf RAZ na tryb światła (przestrzeń / uniformy
// ringu), kadłuby dostają lekkie NodeMaterial-e; wartości kadłuba (postęp, rozmiar, strojenie
// światła, odwrócenie v) i budowli (łuk spawalniczy, słońce, uHub) czytają węzły z
// `material.uniforms` rysowanego obiektu, sprite — `teksturaObiektu`.
import * as THREE from 'three';
import {
  Fn, If, Discard,
  float, vec2, vec3, vec4,
  attribute, varyingProperty, positionGeometry,
  modelViewMatrix, cameraProjectionMatrix,
  abs, clamp, dot, floor, fract, fwidth, length, max, min, mix, normalize, pow, smoothstep, step
} from 'three/tsl';
import { teksturaObiektu, teksturaZastepcza } from '../tsl/teksturaObiektu.js';
import { haloHash12 } from '../haloRing/haloRingTSL.js';
import { sunFill, sunVisibility } from '../sunShadowMask.js';
import { pbLightModel, pbPerObject } from './portBuildings3D.tsl.js';
import { HULL_BUILD_STAGES } from './portShipyardLayout.js';

const S = HULL_BUILD_STAGES;
const r4 = (x) => +Number(x).toFixed(4);   // stałe jak dawne literały GLSL (num: 4 miejsca)
const LUMA = vec3(0.2126, 0.7152, 0.0722);

let SPACE_GRAPH = null;
const HALO_GRAPHS = new WeakMap();

/** Graf kadłuba w budowie dla trybu światła (null = przestrzeń, inaczej uniformy ringu). */
export function portHullBuildGraph(haloU = null) {
  if (!haloU && SPACE_GRAPH) return SPACE_GRAPH;
  if (haloU && HALO_GRAPHS.has(haloU)) return HALO_GRAPHS.get(haloU);
  const G = buildGraph(haloU);
  if (haloU) HALO_GRAPHS.set(haloU, G);
  else SPACE_GRAPH = G;
  return G;
}

function buildGraph(haloU) {
  const Lm = pbLightModel(haloU);
  const flipV = pbPerObject(1, 'uFlipV');
  const build = pbPerObject(new THREE.Vector4(), 'uBuild');        // x postęp 0..1, y czas, z ziarno, w tekstura gotowa
  const hullSize = pbPerObject(new THREE.Vector2(1, 1), 'uHullSize'); // długość, szerokość [j.]
  const hullLight = pbPerObject(new THREE.Vector3(0.24, 1.18, 0.3), 'uHullLight'); // otoczenie, rozproszone, połysk
  const weld = pbPerObject(new THREE.Vector3(), 'uPbWeld');

  const vUv = varyingProperty('vec2', 'vHbUv');
  const vLit = varyingProperty('vec3', 'vHbLit');
  const vSunH = varyingProperty('vec3', 'vHbSunH');
  const vUpL = varyingProperty('vec3', 'vHbUpL');
  const vAlongL = varyingProperty('vec3', 'vHbAlongL');
  const vAcrossL = varyingProperty('vec3', 'vHbAcrossL');

  const vertexNode = Fn(() => {
    const p4 = vec4(positionGeometry, 1.0);
    vUv.assign(attribute('uv', 'vec2'));
    vLit.assign(Lm.pointToLit(p4));
    vSunH.assign(Lm.sunLitFlat());
    // osie układu budowli w ramie światła: góra (y), wzdłuż (z = dziób), w poprzek (x = lewa burta)
    vUpL.assign(normalize(Lm.dirToLit(vec3(0.0, 1.0, 0.0))));
    vAlongL.assign(normalize(Lm.dirToLit(vec3(0.0, 0.0, 1.0))));
    vAcrossL.assign(normalize(Lm.dirToLit(vec3(1.0, 0.0, 0.0))));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(p4));
  })();

  const uvT = vec2(vUv.x, flipV.greaterThan(0.5).select(float(1.0).sub(vUv.y), vUv.y));
  const map = teksturaObiektu('uMap', teksturaZastepcza(0, 0, 0, 0, THREE.SRGBColorSpace), uvT);

  const fragmentNode = Fn(() => {
    const uv0 = vec2(vUv).toVar();
    // próbka i pochodne przed odrzuceniami (jednolity przepływ — pułapki 15, 29)
    const tex = vec4(map).toVar();
    const hu = vec2(uv0.x.mul(hullSize.x), uv0.y.sub(0.5).mul(hullSize.y)).toVar();
    const fw = float(0.0).toVar();
    fw.assign(fwidth(hu.x).add(fwidth(hu.y)));
    If(build.w.lessThan(0.5), () => { Discard(); });
    const inside = smoothstep(0.3, 0.6, tex.a).toVar();
    If(inside.lessThan(0.02), () => { Discard(); });
    const p = build.x.toVar();
    const t = build.y.toVar();
    const keelLen = clamp(p.div(r4(S.keel[1])), 0.0, 1.0).toVar();
    const frameFront = clamp(p.sub(r4(S.frames[0])).div(r4(S.frames[1] - S.frames[0])), 0.0, 1.0).toVar();
    const plateFront = clamp(p.sub(r4(S.plating[0])).div(r4(S.plating[1] - S.plating[0])), 0.0, 1.0).toVar();
    const paintFront = clamp(p.sub(r4(S.outfit[0])).div(r4(S.outfit[1] - S.outfit[0])), 0.0, 1.0).toVar();
    // płyty poszycia 28 × 20 j.: od rufy, czoło postrzępione
    const cellSize = vec2(28.0, 20.0);
    const cell = floor(hu.div(cellSize)).toVar();
    const key = cell.x.add(0.5).mul(cellSize.x).div(hullSize.x).add(haloHash12(cell.add(build.z)).sub(0.5).mul(0.16)).toVar();
    const plateEdge = mix(-0.14, 1.1, plateFront).toVar();
    const plated = step(key, plateEdge).toVar();
    const painted = step(uv0.x.add(haloHash12(cell.mul(1.7).add(3.0).add(build.z)).sub(0.5).mul(0.08)), mix(-0.1, 1.1, paintFront)).toVar();
    // szkielet: stępka, wręgi (co 24 j.), wzdłużniki (co 30 j.); linie ≥ ~pół piksela
    const keelW = max(5.0, fw.mul(0.9)).toVar();
    const ribW = min(max(2.2, fw.mul(0.45)), 6.0).toVar();
    const strW = min(max(1.4, fw.mul(0.35)), 5.0).toVar();
    const keel = step(uv0.x, keelLen).mul(float(1.0).sub(smoothstep(keelW, keelW.add(fw), abs(hu.y))));
    const ribD = abs(fract(hu.x.div(24.0).add(0.5)).sub(0.5)).mul(24.0);
    const grown = step(0.0005, frameFront).mul(step(uv0.x, frameFront)).toVar();
    const rib = float(1.0).sub(smoothstep(ribW, ribW.add(fw), ribD)).mul(grown);
    const strD = abs(fract(hu.y.div(30.0).add(0.5)).sub(0.5)).mul(30.0);
    const stringer = float(1.0).sub(smoothstep(strW, strW.add(fw), strD)).mul(grown);
    const frame = max(keel, max(rib, stringer)).mul(inside).toVar();
    If(plated.lessThan(0.5).and(frame.lessThan(0.5)), () => { Discard(); });
    const base = vec3(0.075, 0.08, 0.085).toVar();
    If(plated.greaterThan(0.5), () => {
      const real = tex.rgb;
      const lum = dot(real, LUMA);
      const primer = vec3(0.26, 0.29, 0.28).mul(float(0.5).add(float(0.9).mul(lum)));
      const cf = fract(hu.div(cellSize)).toVar();
      const seam = float(1.0).sub(smoothstep(0.0, 0.07, min(min(cf.x, float(1.0).sub(cf.x)), min(cf.y, float(1.0).sub(cf.y)))));
      base.assign(mix(primer.mul(float(1.0).sub(seam.mul(0.4))), real, painted));
    });
    // poduszkowa normalna (jak kadłuby gry) w ramie światła
    const pp = clamp(uv0, 0.0, 1.0).mul(2.0).sub(1.0).toVar();
    const N = normalize(vUpL.add(vAlongL.mul(pp.x.mul(0.45))).add(vAcrossL.mul(pp.y.mul(0.45)))).toVar();
    const L = normalize(vSunH).toVar();
    const P = vec3(vLit).toVar();
    let sv; let fill; let V;
    if (Lm.halo) {
      const { H, U } = Lm;
      sv = dot(H.haloSunVisibility(P.add(vec3(vUpL).mul(2.0)), U.uSunDir), LUMA).toVar();
      fill = float(0.4).add(float(0.6).mul(sv));
      V = normalize(U.uCamLocal.sub(P)).toVar();
    } else {
      sv = Lm.sunVisS.mul(sunVisibility()).toVar();
      fill = sunFill(sv);
      V = normalize(P.negate()).toVar();
    }
    const NdL = dot(N, L).toVar();
    const dif = max(0.0, NdL);
    const col = base.mul(hullLight.x.mul(fill).add(dif.mul(hullLight.y).mul(sv))).toVar();
    const spec = pow(max(dot(N, normalize(L.add(V))), 0.0), 32.0);
    col.addAssign(vec3(spec.mul(hullLight.z).mul(smoothstep(-0.02, 0.08, NdL)).mul(sv)).mul(plated));
    // iskry spawania przy czole budowy (punkty ~2 j., migają)
    const frontU = p.lessThan(r4(S.keel[1])).select(keelLen, p.lessThan(r4(S.frames[1])).select(frameFront,
      p.lessThan(r4(S.plating[1])).select(plateEdge, float(-2.0))));
    const nearFront = float(1.0).sub(smoothstep(0.0, float(22.0).div(hullSize.x), abs(uv0.x.sub(frontU))));
    const sc = floor(hu.div(6.0)).toVar();
    const n = floor(t.mul(18.0)).toVar();
    const h = haloHash12(sc.add(n.mul(13.1)).add(build.z.mul(7.0)));
    const sf = fract(hu.div(6.0)).sub(0.5);
    const spark = step(0.955, h).mul(nearFront).mul(float(1.0).sub(smoothstep(0.1, 0.32, length(sf)))).mul(step(p, 0.999));
    col.addAssign(weld.mul(spark).mul(float(0.8).add(float(0.8).mul(haloHash12(sc.add(n))))));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();

  return { vertexNode, fragmentNode, nodes: { flipV, build, hullSize, hullLight, weld, map } };
}
