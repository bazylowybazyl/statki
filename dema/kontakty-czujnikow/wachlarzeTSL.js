// dema/kontakty-czujnikow/wachlarzeTSL.js
//
// WACHLARZE namierzania „) ) )” przy okręcie gracza — propozycje efektów (etap 1, 2026-11-04; plan:
// docs/PLAN-kontakt-czujnikow.md § 5). Semantyka z prototypu zasięgu radarów (drawBearingFans w radarRangeOverlay.js,
// dane P.fans w sensorPicture.js) zostaje: na grupę wrogów w jednym kierunku dwie połówki krótkich łuków w stronę
// wroga — NIEBIESKA (lewa) = MÓJ zasięg względem nich (ułamek `me`), CZERWONA (prawa) = ICH zasięg względem mnie, czyli
// mój ślad sygnałowy (`them`); zapalonych łuków = ułamek × 7, puste miejsca skali słabo, pełny wachlarz z grotem =
// zasięg sięga; radar zgadnięty (`est`) — słabiej. Łuki STOJĄ przy okręcie. Zmienia się tylko wygląd:
//  1. PULS  — świecące łuki z poświatą, puls biegnie od okrętu po zapalonych łukach (szybciej przy progu — jak bicie
//             serca), przy przekroczeniu 1 rozbłysk (pierścień leci przez wachlarz) i „żar”: migotanie, grot z poświatą.
//  2. FALA  — grzbiety fal płyną od okrętu do granicy zasięgu i NAPRAWDĘ zginają tło (warstwa DIST Core3D:
//             przesunięcie w px, aberracja barw z „uber”); po przekroczeniu 1 przez wachlarz przechodzi fala uderzeniowa.
//  3. ISKRY — strumień iskier płynie od okrętu do granicy zasięgu (spójnie z RÓJ kontaktów), cienkie łuki skali pod
//             spodem, migocący front na granicy; po przekroczeniu 1 iskry dolatują do grota.
// Wszystko w px ekranu (jak dzisiejsza nakładka 2D — wachlarz ma stały rozmiar na ekranie): kwad pełnoekranowy,
// pętla po grupach z blokiem `uniformArray` `wachlarzeCzujnikow` (nagłówek 2 × vec4 + 3 × vec4 na grupę: G0 = (sx, sy,
// r0, kąt) w px bufora (y od góry, kąt jak canvas arc), G1 = (me, them, est, ziarno), G2 = (rozbłysk me, rozbłysk
// them, —, —) — rozbłysk 1 → 0 liczy CPU od chwili przejścia przez 1).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, screenCoordinate, positionGeometry,
  exp, sin, cos, atan, length, mix, smoothstep, clamp, max, min, abs, fract, floor, step
} from 'three/tsl';
import { tv, pcg, u01, uOf, hash3 } from './kontaktyTSL.js';

export const FAN_MAX = 32;
export const FAN_HDR = 2;
export const FAN_STYLES = Object.freeze(['puls', 'fala', 'iskry']);
/** Geometria jak w prototypie (RADAR_RANGE_STYLE, px CSS): łuków, odstęp, pół szerokości połówki i przerwa [rad]. */
export const FAN_GEOM = Object.freeze({ N: 7, GAP: 11, HALF: 0.23, SPLIT: 0.03, LW: 2.2 });

const TAU = 6.283185307;
const PI = 3.141592654;
const BLUE = [0.157, 0.60, 1.0];     // RADAR_RANGE_STYLE.ownRgb 110, 204, 255 (sRGB) → liniowo
const RED = [1.0, 0.162, 0.138];     // RADAR_RANGE_STYLE.enemyRgb 255, 112, 104 (sRGB) → liniowo
const c3 = (a) => vec3(a[0], a[1], a[2]);

export function createFanBlock() {
  const arr = Array.from({ length: FAN_HDR + 3 * FAN_MAX }, () => new THREE.Vector4());
  const node = uniformArray(arr, 'vec4').setName('wachlarzeCzujnikow');
  return { node, array: node.array };
}

/**
 * Pętla po grupach: dla piksela w zasięgu wachlarza woła `body(g)` z policzoną geometrią połówki, w której leży
 * piksel (niebieska: kąt < 0 względem kierunku grupy, czerwona: > 0). Wszystko w px bufora.
 */
function fanLoop(B, px, body) {
  const h0 = B.element(0);
  const count = int(h0.x);
  const t = h0.y;
  const pxs = max(h0.z, 0.25);
  const N = FAN_GEOM.N;
  Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'fi' }, ({ fi }) => {
    const base = fi.mul(3).add(FAN_HDR);
    const G0 = tv('v4', B.element(base), 'fG0');
    const G1 = tv('v4', B.element(base.add(1)), 'fG1');
    const G2 = tv('v4', B.element(base.add(2)), 'fG2');
    const gap = tv('f', pxs.mul(FAN_GEOM.GAP), 'fGap');
    const d = tv('v2', px.sub(G0.xy), 'fD');
    const r = tv('f', length(d), 'fR');
    const r0 = G0.z;
    const reach = r0.add(gap.mul(N + 2.5)).add(pxs.mul(16.0));
    If(r.lessThan(reach).and(r.greaterThan(r0.sub(gap.mul(1.5)))), () => {
      const dA0 = atan(d.y, d.x).sub(G0.w);
      const dA = tv('f', dA0.sub(floor(dA0.add(PI).div(TAU)).mul(TAU)), 'fDA');
      const blue = tv('f', step(dA, 0.0), 'fBlue');                       // 1 — niebieska (lewa), 0 — czerwona
      const a = tv('f', abs(dA), 'fA');
      const ratio = tv('f', mix(G1.y, G1.x, blue), 'fRatio');
      const est = tv('f', G1.z.mul(float(1.0).sub(blue)), 'fEst');
      const flash = tv('f', mix(G2.y, G2.x, blue), 'fFlash');
      const edge = pxs.mul(1.2).div(max(r, 1.0));
      const angMask = tv('f', smoothstep(FAN_GEOM.SPLIT, edge.add(FAN_GEOM.SPLIT), a)
        .mul(float(1.0).sub(smoothstep(edge.negate().add(FAN_GEOM.HALF), FAN_GEOM.HALF, a))), 'fAng');
      const u = tv('f', r.sub(r0).div(gap), 'fU');                          // odległość od r0 w odstępach łuków
      const i = tv('f', floor(u.add(0.5)), 'fI');
      const du = tv('f', u.sub(i).mul(gap), 'fDu');                         // px od środka najbliższego łuku
      const validArc = step(-0.5, i).mul(step(i, N - 0.5));
      const lit = tv('f', clamp(ratio, 0.0, 1.0).mul(N), 'fLit');
      const part = tv('f', clamp(lit.sub(i), 0.0, 1.0).mul(validArc), 'fPart');
      const reached = tv('f', step(1.0, ratio), 'fReached');
      const hot = tv('f', smoothstep(0.98, 1.4, ratio), 'fHot');
      const col = tv('v3', mix(c3(RED), c3(BLUE), blue), 'fCol');
      // grot: za ostatnim łukiem w środku połówki (układ lokalny: x wzdłuż środka połówki)
      const am = G0.w.add(mix(float((FAN_GEOM.HALF + FAN_GEOM.SPLIT) / 2), float(-(FAN_GEOM.HALF + FAN_GEOM.SPLIT) / 2), blue));
      const ca = cos(am), sa = sin(am);
      const q = vec2(d.x.mul(ca).add(d.y.mul(sa)), d.y.mul(ca).sub(d.x.mul(sa)));
      const rt = r0.add(gap.mul(N)).add(pxs.mul(2.0));
      const ax = q.x.sub(rt);
      const len = pxs.mul(7.0);
      const sdf = max(max(ax.negate(), ax.sub(len)), abs(q.y).sub(pxs.mul(4.5).mul(float(1.0).sub(ax.div(len)))));
      const arrow = tv('f', float(1.0).sub(smoothstep(pxs.mul(-0.7), pxs.mul(0.7), sdf)), 'fArrow');
      const dq = q.sub(vec2(rt.add(pxs.mul(3.0)), 0.0));
      body({
        t, pxs, d, r, r0, gap, a, blue, ratio, est, flash, angMask, u, i, du, validArc, lit, part, reached, hot, col,
        arrow, arrowDist2: dq.x.mul(dq.x).add(dq.y.mul(dq.y)), seed: G1.w, N
      });
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. PULS
function pulsLook(B, px) {
  const rgb = vec3(0.0).toVar('pRgb');
  fanLoop(B, px, (g) => {
    const { t, pxs, u, i, du, part, lit, ratio, est, flash, angMask, reached, hot, col, arrow, seed, N } = g;
    const lw = pxs.mul(FAN_GEOM.LW);
    const line = tv('f', exp(du.div(lw.mul(0.55)).mul(du.div(lw.mul(0.55))).negate()), 'pLine');
    const glow = exp(du.div(lw.mul(1.5)).mul(du.div(lw.mul(1.5))).negate());
    const fall = float(1.0).sub(i.mul(0.35 / N));
    // radar zgadnięty: łuk w kreskach, słabiej
    const dash = step(0.42, fract(g.a.mul(g.r).div(pxs.mul(5.0))));
    const estMul = mix(float(1.0), dash.mul(0.7).add(0.3).mul(0.62), est);
    // puls: miękkie pasmo biegnie od okrętu przez zapalone łuki; szybciej przy progu
    const sp = min(ratio, 1.3).mul(0.9).add(0.5);
    const pp = fract(t.mul(sp).add(seed)).mul(lit.add(2.2)).sub(1.1);
    const boost = exp(u.sub(pp).div(0.55).mul(u.sub(pp).div(0.55)).negate()).mul(1.4).mul(step(u, lit.add(0.5)));
    const flick = sin(t.mul(19.0).add(seed.mul(9.0)).add(i.mul(1.3))).mul(0.2).mul(hot).add(1.0);
    const Ilit = part.mul(fall).mul(line.mul(1.05).add(glow.mul(0.22)))
      .mul(boost.mul(0.8).add(1.0)).mul(flick).mul(estMul).mul(hot.mul(0.3).add(1.0));
    const empty = float(1.0).sub(step(0.001, part)).mul(g.validArc).mul(line).mul(0.10);
    const whiten = clamp(line.mul(boost.mul(0.22).add(hot.mul(0.15))), 0.0, 0.5);
    const arcCol = mix(col, vec3(1.0), whiten);
    rgb.addAssign(arcCol.mul(Ilit).add(col.mul(empty)).mul(angMask));
    // grot i żar, gdy zasięg sięga
    const breathe = sin(t.mul(6.0).add(seed.mul(5.0))).mul(0.5).add(0.5);
    rgb.addAssign(mix(col, vec3(1.0), 0.15).mul(arrow.mul(reached).mul(hot.mul(breathe).mul(0.6).add(1.5)).mul(estMul)));
    const fl = exp(g.arrowDist2.div(pxs.mul(9.0).mul(pxs.mul(9.0))).negate());
    rgb.addAssign(col.mul(fl.mul(reached).mul(breathe.mul(0.12).add(0.08))));
    // rozbłysk przy przejściu przez 1: pierścień leci przez wachlarz i dalej, połówka rozjarza się
    const rr = float(1.0).sub(flash).mul(N + 5);
    const ring = exp(u.sub(rr).div(0.35).mul(u.sub(rr).div(0.35)).negate()).mul(flash).mul(1.6);
    const wash = flash.mul(glow).mul(0.7).mul(step(u, float(N)));
    rgb.addAssign(mix(col, vec3(1.0), 0.25).mul(ring.add(wash)).mul(angMask));
  });
  return rgb;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. FALA — kolor (grzbiety) i przesunięcie tła (warstwa DIST); `distOut` = true — wyjście przesunięcia [px, osie sceny].
function falaLook(B, px, distOut) {
  const rgb = vec3(0.0).toVar('wRgb');
  const disp = vec2(0.0).toVar('wDisp');
  fanLoop(B, px, (g) => {
    const { t, pxs, d, r, u, du, lit, est, flash, angMask, reached, hot, col, arrow, seed, N } = g;
    const lw = pxs.mul(FAN_GEOM.LW);
    const line = exp(du.div(lw.mul(0.5)).mul(du.div(lw.mul(0.5))).negate());
    const phase = tv('f', u.div(1.5).sub(t.mul(0.9)).add(seed), 'wPh');
    const crestC = cos(phase.mul(TAU));
    const crest = smoothstep(0.9, 1.0, crestC);
    const litMask = tv('f', float(1.0).sub(smoothstep(lit.sub(0.6), lit.add(0.2), u)).mul(smoothstep(-0.6, -0.1, u)), 'wLit');
    // zgadnięty radar: grzbiety rwane (szum kąta i czasu)
    const brk = u01(hash3(uOf(g.a.mul(120.0)), uOf(phase), uint(17)));
    const estMul = mix(float(1.0), step(0.45, brk).mul(0.62), est);
    // fala uderzeniowa po przekroczeniu 1 (co ~1,8 s, przez cały wachlarz i dalej)
    const us = fract(t.mul(0.55).add(seed)).mul(N + 4).sub(0.5);
    const shock = tv('f', exp(u.sub(us).div(0.28).mul(u.sub(us).div(0.28)).negate()).mul(reached)
      .mul(float(1.0).sub(us.div(N + 4))), 'wShock');
    const rr = float(1.0).sub(flash).mul(N + 5);
    const ring = exp(u.sub(rr).div(0.35).mul(u.sub(rr).div(0.35)).negate()).mul(flash);
    if (!distOut) {
      const scale = float(1.0).sub(step(0.001, g.part)).mul(g.validArc).mul(line).mul(0.08)
        .add(g.part.mul(line).mul(0.34));
      rgb.addAssign(col.mul(crest.mul(litMask).mul(hot.mul(0.4).add(1.0)).mul(estMul)
        .add(litMask.mul(0.035)).add(scale).add(shock.mul(1.2)).add(ring.mul(1.5))).mul(angMask));
      rgb.addAssign(mix(col, vec3(1.0), 0.15).mul(arrow.mul(reached).mul(1.6).mul(estMul)));
    } else {
      // przesunięcie wzdłuż promienia (osie sceny: y w górę): sin fazy w zapalonym zasięgu, uderzenie, rozbłysk
      const radial = vec2(d.x, d.y.negate()).div(max(r, 1.0));
      const amp = pxs.mul(hot.mul(1.2).add(1.4)).mul(sin(phase.mul(TAU))).mul(litMask).mul(estMul.mul(0.5).add(0.5))
        .add(pxs.mul(3.0).mul(shock)).add(pxs.mul(4.0).mul(ring));
      disp.addAssign(radial.mul(amp.mul(angMask)));
    }
  });
  return distOut ? disp : rgb;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. ISKRY
function iskryLook(B, px) {
  const rgb = vec3(0.0).toVar('iRgb');
  fanLoop(B, px, (g) => {
    const { t, pxs, r, r0, gap, a, u, du, part, lit, ratio, est, flash, angMask, reached, hot, col, arrow, seed, N, blue } = g;
    const lw = pxs.mul(FAN_GEOM.LW);
    const line = exp(du.div(lw.mul(0.45)).mul(du.div(lw.mul(0.45))).negate());
    // cienkie łuki skali (zapalone wyraźniej) — siedem kresek zostaje czytelne
    const scale = float(1.0).sub(step(0.001, part)).mul(g.validArc).mul(line).mul(0.08).add(part.mul(line).mul(0.45));
    // iskry = kropki płynące wzdłuż łuków: 6 kolumn kąta na połówkę, w kolumnie kropki co odstęp łuków przesuwają się
    // na zewnątrz (każda wędruje od łuku do następnego i odradza się) — kropkowane ) ) ) płynące od okrętu
    const span = FAN_GEOM.HALF - FAN_GEOM.SPLIT;
    const aa = a.sub(FAN_GEOM.SPLIT).div(span).mul(6.0);
    const ai = floor(aa);
    const col6 = tv('u', hash3(uOf(ai.add(blue.mul(16.0))), uOf(seed.mul(65535.0)), uint(5)), 'iCol');
    const h0 = u01(col6);
    const vs = min(ratio, 1.3).mul(0.5).add(0.45);                        // odstępy łuków na sekundę
    const flow = tv('f', t.mul(vs).add(h0), 'iFlow');
    const sc = u.sub(fract(flow));
    const k = floor(sc.add(0.5));
    const dr = sc.sub(k).mul(gap);
    const da = fract(aa).sub(0.5).mul(r.mul(span / 6.0));
    const sp = pxs.mul(0.95);
    const dot2 = dr.mul(dr).mul(0.7).add(da.mul(da)).div(sp.mul(sp));
    const shape = exp(dot2.negate()).add(exp(dot2.mul(-0.12)).mul(0.12));
    // tożsamość kropki (kolumna + numer wędrówki) — migotanie i rzadsze kropki zgadniętego radaru
    const bead = tv('u', pcg(col6.bitXor(uOf(k.add(floor(flow)).add(4096.0)))), 'iBead');
    const hb = u01(bead);
    const exists = step(mix(float(0.0), float(0.5), est), hb);
    const tw = sin(t.mul(9.0).add(hb.mul(40.0))).mul(0.35).add(0.65);
    // kropki od okrętu do granicy zasięgu (po przekroczeniu 1 — do grota)
    const limit = mix(lit.sub(0.4), float(N + 0.9), reached);
    const ku = k.add(fract(flow));
    const litMask = float(1.0).sub(smoothstep(limit.sub(0.35), limit.add(0.2), ku)).mul(smoothstep(-0.6, 0.2, ku));
    const sparkI = exists.mul(shape).mul(litMask).mul(hb.mul(0.8).add(1.0)).mul(tw)
      .mul(mix(float(1.0), float(0.6), est)).mul(hot.mul(0.5).add(1.0));
    // migocący front na granicy zasięgu (gdy jeszcze nie sięga)
    const fu = u.sub(lit.sub(0.5));
    const front = exp(fu.mul(gap).div(pxs.mul(1.3)).mul(fu.mul(gap).div(pxs.mul(1.3))).negate())
      .mul(float(1.0).sub(reached)).mul(step(0.05, lit)).mul(sin(t.mul(23.0).add(a.mul(140.0))).mul(0.3).add(0.7)).mul(0.7);
    const sparkCol = mix(col, vec3(1.0), 0.3);
    rgb.addAssign(col.mul(scale.add(front)).add(sparkCol.mul(sparkI)).mul(angMask));
    // grot z migotania iskier, rozbłysk — pierścień iskier
    const fl = u01(hash3(uOf(t.mul(20.0)), uOf(seed.mul(999.0)), uOf(blue))).mul(0.8).add(0.6);
    rgb.addAssign(sparkCol.mul(arrow.mul(reached).mul(fl).mul(1.7)));
    const rr = float(1.0).sub(flash).mul(N + 5);
    const ring = exp(u.sub(rr).div(0.4).mul(u.sub(rr).div(0.4)).negate()).mul(flash).mul(step(0.4, h0)).mul(2.5);
    rgb.addAssign(sparkCol.mul(ring).mul(angMask));
  });
  return rgb;
}

function baseMaterial(name) {
  const mat = new THREE.NodeMaterial();
  mat.name = name;
  mat.transparent = true;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.lights = false;
  mat.fog = false;
  mat.forceSinglePass = true;
  mat.premultipliedAlpha = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  mat.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
  return mat;
}

const rectMask = (rect, p) => step(rect.x, p.x).mul(step(p.x, rect.z)).mul(step(rect.y, p.y)).mul(step(p.y, rect.w));

/** Kwad pełnoekranowy wariantu wachlarzy (addytywnie, warstwa 0). FALA ma drugi kwad na warstwie DIST (`dist`). */
export function createFanMeshes(style, block, distLayer) {
  const rect = uniform(new THREE.Vector4(-1, -1, 1e9, 1e9));
  const mat = baseMaterial(`WachlarzCzujnikow:${style}`);
  mat.fragmentNode = Fn(() => {
    const p = screenCoordinate.xy.toVar('wcPx');
    const rgb = style === 'puls' ? pulsLook(block.node, p) : style === 'fala' ? falaLook(block.node, p, false) : iskryLook(block.node, p);
    return vec4(clamp(rgb, vec3(0.0), vec3(48.0)).mul(rectMask(rect, p)), 0.0);
  })();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.name = `WachlarzCzujnikow:${style}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10001;
  mesh.layers.set(0);
  mesh.userData.rect = rect;
  let dist = null;
  if (style === 'fala') {
    // warstwa DIST: przesunięcie [px bufora, osie sceny] w RG, B = A = 0 (aberracja barw z „uber”), addytywnie
    const dm = baseMaterial('WachlarzCzujnikow:fala-dist');
    dm.blendSrcAlpha = THREE.OneFactor;
    dm.fragmentNode = Fn(() => {
      const p = screenCoordinate.xy.toVar('wdPx');
      const o = falaLook(block.node, p, true);
      return vec4(clamp(o, vec2(-24.0), vec2(24.0)).mul(rectMask(rect, p)), 0.0, 0.0);
    })();
    dist = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dm);
    dist.name = 'WachlarzCzujnikow:fala-dist';
    dist.frustumCulled = false;
    dist.layers.set(distLayer);
  }
  return { mesh, dist, rect };
}
