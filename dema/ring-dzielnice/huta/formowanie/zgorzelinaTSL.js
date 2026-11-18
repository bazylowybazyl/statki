// HUTA — formowanie, runda 7: MATERIAŁ ZGORZELINY I ISKIER PRZY CHWYCIE WALCÓW (TSL, jeden graf, jeden rysunek — partia
// instancji na rekordach `zgorzelina.js`: iA = xyz + życie, iB = xyz poprzedniego kroku + żar T̃, iC = rodzaj, rozmiar
// [j.], kąt obrotu płatka, ziarno).
//
// Trzy rodzaje w jednym programie (wybór maskami 0 / 1, bez rozgałęzień w wierzchołkach — pułapka 39):
//   ISKRA  smuga wzdłuż prędkości (ogon z drogi ok. 0,05 s), szerokość ≥ 1,3 px, długość ≥ 7 px — czytelna przy zwykłym
//          oddaleniu kamery gry; barwa i jasność z żaru (paleta kuli — `heatColor` / `heatPower`), dodawana (alfa 0).
//   PŁATEK płytka tlenku wirująca w locie: kwad obrócony kątem płatka, spłaszczony rzutem (raz płasko, raz kantem —
//          z kąta), wielkość ≥ 2 px; świeci żarem łuski (ciemna czerwień przy chwycie → szarość po ostygnięciu),
//          oświetlony słońcem i niebem jak matowa łuska (ciemnoszary; słaby błysk płaskiej strony) — przykrywa to, co za nim (alfa = pokrycie):
//          zimny płatek na tle żarzącej się taśmy to ciemna drobina. Błysk, gdy płaska strona trafia w słońce.
//   PYŁ    miałka zgorzelina: miękki krążek o małej alfie, ciemnoczerwony żar — dymek przy chwycie.
// Mieszanie: premultiplied (jeden, 1 − alfa) — emisja dodaje się, łuska przykrywa. Bez zapisu głębi.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, abs, attribute, cameraProjectionMatrix, clamp, cos, dot, float, length, max, min, mix, modelViewMatrix, pow, sin,
  smoothstep, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { LUMA, hash21, heatColor, heatPower } from '../wytop/wspolneTSL.js';

/** Strojenie (stałe grafu): najmniejszy rozmiar na ekranie [px] — iskra (szerokość, długość), płatek, pył. */
export const ZGORZ_LOOK = Object.freeze({ sparkW: 1.3, sparkL: 7, flake: 2.0, dust: 5, sparkGain: 2.6, flakeGain: 1.0, dustAlpha: 0.2 });

/** Materiał zgorzeliny i iskier walcowni (`U` — uniformy wytopu: kamera, słońce, paleta, ułamek kroku, px na j.). */
export function createScaleMaterial(U) {
  const vQ = varyingProperty('vec4', 'vZgQ');     // położenie w kwadzie (u, v), żar, życie 0…1
  const vR = varyingProperty('vec4', 'vZgR');     // maski: iskra, płatek, pył; płaskość płatka (0 kant … 1 płasko)
  const vS = varyingProperty('vec4', 'vZgS');     // ziarno, 0, 0, 0
  const L = ZGORZ_LOOK;
  const vertex = Fn(() => {
    const iA = attribute('iA', 'vec4');
    const iB = attribute('iB', 'vec4');
    const iC = attribute('iC', 'vec4');
    const corner = attribute('position', 'vec3');
    const c = vec3(0.0).toVar();
    c.assign(mix(iB.xyz, iA.xyz, U.frame.x));
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(c, 1.0)));
    const ppu = float(0.0).toVar();
    ppu.assign(U.frame.y.div(max(mv.z.negate(), 1.0)));
    const ipx = float(0.0).toVar();
    ipx.assign(float(1.0).div(max(ppu, 1e-4)));
    const kind = float(0.0).toVar();
    kind.assign(iC.x);
    const mS = float(0.0).toVar();
    mS.assign(float(1.0).sub(clamp(kind.mul(2.0), 0.0, 1.0)));
    const mD = float(0.0).toVar();
    mD.assign(clamp(kind.sub(1.5).mul(2.0), 0.0, 1.0));
    const mF = float(0.0).toVar();
    mF.assign(float(1.0).sub(mS).sub(mD));
    // ISKRA: smuga wzdłuż prędkości na ekranie (droga z ostatniego kroku × 3), głowa w położeniu iskry
    const dv = vec2(0.0).toVar();
    dv.assign(modelViewMatrix.mul(vec4(iA.xyz.sub(iB.xyz), 0.0)).xy);
    const dl = float(0.0).toVar();
    dl.assign(length(dv));
    const dir = vec2(0.0).toVar();
    dir.assign(dv.div(max(dl, 1e-4)).add(vec2(1e-4, 0.0)));
    dir.assign(dir.div(max(length(dir), 1e-4)));
    const wS = float(0.0).toVar();
    wS.assign(max(iC.y, ipx.mul(L.sparkW)));
    const lenS = float(0.0).toVar();
    lenS.assign(max(dl.mul(3.0), ipx.mul(L.sparkL)));
    const alongS = mix(lenS.negate(), wS, corner.x.mul(0.5).add(0.5));
    const offS = vec2(0.0).toVar();
    offS.assign(dir.mul(alongS).add(vec2(dir.y.negate(), dir.x).mul(corner.y.mul(wS))));
    // PŁATEK: kwad obrócony kątem płatka, spłaszczony rzutem płytki (płaskość z drugiego kąta wirowania)
    const ang = float(0.0).toVar();
    ang.assign(iC.z);
    const flat = float(0.0).toVar();
    flat.assign(abs(cos(ang.mul(0.73).add(iC.w.mul(6.28)))).mul(0.78).add(0.22));
    const sF = float(0.0).toVar();
    sF.assign(max(iC.y, ipx.mul(L.flake)));
    const ca = cos(ang);
    const sa = sin(ang);
    const qx = corner.x.mul(sF);
    const qy = corner.y.mul(sF).mul(max(flat, ipx.mul(L.flake * 0.6).div(sF)));
    const offF = vec2(0.0).toVar();
    offF.assign(vec2(qx.mul(ca).sub(qy.mul(sa)), qx.mul(sa).add(qy.mul(ca))));
    // PYŁ: krążek (promień ≥ kilka px)
    const sD = max(iC.y, ipx.mul(L.dust));
    const offD = corner.xy.mul(sD);
    const off = vec2(0.0).toVar();
    off.assign(offS.mul(mS).add(offF.mul(mF)).add(offD.mul(mD)));
    vQ.assign(vec4(mix(corner.xy, vec2(corner.x.mul(0.5).add(0.5), corner.y), mS), iB.w, iA.w));
    vR.assign(vec4(mS, mF, mD, flat));
    vS.assign(vec4(iC.w, 0.0, 0.0, 0.0));
    return cameraProjectionMatrix.mul(vec4(mv.xy.add(off), mv.z, 1.0));
  })();
  const fragment = Fn(() => {
    const u = vQ.x;
    const v = vQ.y;
    const T = vQ.z;
    const life = clamp(vQ.w, 0.0, 1.0);
    const mS = vR.x;
    const mF = vR.y;
    const mD = vR.z;
    const flat = vR.w;
    const seed = vS.x;
    const fade = smoothstep(0.0, 0.18, life);
    const hc = heatColor(U, T);
    const hp = heatPower(T);
    // iskra: jasna nitka, ogon gaśnie (u: 0 ogon → 1 głowa)
    const across = float(1.0).sub(smoothstep(0.2, 1.0, abs(v)));
    const t = clamp(u, 0.0, 1.0);
    const alongI = t.mul(t).mul(float(1.0).sub(smoothstep(0.92, 1.0, t)));
    const spark = hc.mul(hp.mul(U.t1.x).mul(L.sparkGain).mul(U.t4.w).add(0.04)).mul(across.mul(alongI).mul(fade));
    // płatek: nieregularna łuska (zaokrąglony kwadrat z wcięciami z ziarna), żar łuski + matowa łuska w świetle
    const r2 = max(abs(u), abs(v)).mul(0.6).add(length(vec2(u, v)).mul(0.5));
    // (ćwiartka kwadu z kroków — bez gałęzi): wcięcie brzegu łuski losowe w każdej ćwiartce
    const quad = clamp(u.mul(1e4), 0.0, 1.0).add(clamp(v.mul(1e4), 0.0, 1.0).mul(2.0));
    const notch = hash21(vec2(seed.mul(97.0), quad.add(1.0))).mul(0.25);
    const cov = float(1.0).sub(smoothstep(0.78, 0.98, r2.add(notch)));
    const facing = flat.mul(flat);
    const lit = vec3(0.03, 0.029, 0.028).mul(U.sunColor.mul(facing.mul(0.45).add(0.1)).add(U.ambient).add(vec3(0.05, 0.045, 0.04)));
    const glint = U.sunColor.mul(pow(facing, 60.0).mul(0.05));
    const glow = hc.mul(hp.mul(U.t1.x).mul(L.flakeGain).mul(facing.mul(0.4).add(0.6)));
    const aF = cov.mul(fade);
    const flake = lit.add(glint).add(glow).mul(aF);
    // pył: miękki krążek
    const d2 = dot(vec2(u, v), vec2(u, v));
    const soft = clamp(float(1.0).sub(d2), 0.0, 1.0);
    const aD = soft.mul(soft).mul(L.dustAlpha).mul(fade).mul(life.mul(0.6).add(0.4));
    const dust = hc.mul(hp.mul(U.t1.x).mul(0.5)).add(vec3(0.03, 0.028, 0.026)).mul(aD);
    const col = vec3(0.0).toVar();
    col.assign(spark.mul(mS).add(flake.mul(mF)).add(dust.mul(mD)));
    const a = float(0.0).toVar();
    a.assign(aF.mul(0.92).mul(mF).add(aD.mul(mD)));
    // (bez NaN i bez jasności ponad pasmo lamp: iskra najwyżej HDR ~3)
    const lum = dot(col, LUMA);
    col.mulAssign(min(float(1.0), float(3.0).div(max(lum, 1e-3))));
    return vec4(max(col, vec3(0.0)), clamp(a, 0.0, 1.0));
  })();
  const m = new NodeMaterial();
  m.name = 'WalcowniaZgorzelina';
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.side = THREE.DoubleSide;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  m.transparent = true;
  m.depthWrite = false;
  m.forceSinglePass = true;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return m;
}
