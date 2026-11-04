// dema/kontakty-czujnikow/namiarTSL.js
//
// NAMIAR — jak oddać „kto kogo już widzi” między mną a grupą wrogów: trzy propozycje (2026-11-04, plan:
// docs/PLAN-kontakt-czujnikow.md § 5). Dane na grupę (te same dla wszystkich): `them` = ich czujniki × MOJA sygnatura / d
// (≥ 1 → WYKRYLI MNIE), `me` = moje czujniki × ICH sygnatura / d (≥ 1 → ja wykrywam ich), `est` = 1: ich czujniki
// zgadnięte z rozmiaru (kontakt bez identyfikacji) → czerwień słabsza albo rwana.
//  1. WACHLARZ — jeden wachlarz na okręt: przy MNIE niebieski w stronę wroga (długość z `me`), przy WROGU czerwony
//     w stronę mnie (długość z `them`), oba na jednej prostej, naprzeciw siebie. Łuki STOJĄ, biegnie po nich tylko
//     jasność. Pełna długość z grotem = sięga. Wróg poza kadrem — wachlarz przy krawędzi ekranu na tej prostej.
//  2. STRUNA — jeden gładki łuk przy MOIM okręcie w stronę grupy, końce nieruchome jak węzły. Drganie = suma harmonicznych
//     struny, sin(nπs)·cos(ω_n τ), o niewspółmiernych częstotliwościach (bez pików EKG). Amplituda rośnie z `them`
//     (daleko prawie prosta, przy progu mocno rozedrgana, wyższe harmoniczne dochodzą pod koniec). Przy them = 1 struna
//     PĘKA: dwa wolne końce (mody struny zamocowanej z jednej strony: sin((j−½)πh)), bicz, rozbłysk, fala uderzeniowa
//     z refrakcją (warstwa DIST), końce czerwone i rozedrgane; poniżej progu zrastają się. Słabsza struna przy wrogu
//     w stronę mnie drga z `me`.
//  3. BŁONA — jedna zamknięta, organiczna błona wokół MOJEGO okrętu (język OBŁOKU: szum, pasma interferencji). Promień
//     bazowy = mój ślad sygnałowy, w stronę każdej grupy wybrzuszenie rosnące z `them`; wiele grup = jeden kształt, zero
//     osobnych znaczników. them ≥ 1 → w tym miejscu błona czerwienieje i pęka (dziury, pasma uchodzące na zewnątrz).
//
// Wszystko w px ekranu (jak nakładka 2D — stały rozmiar na ekranie): kwad pełnoekranowy, addytywnie, jedna funkcja na
// piksel nad blokiem `uniformArray` `namiarCzujnikow`:
//   nagłówek: H0 = (znaczników, czas, px bufora na px CSS, kotwic), H1 = (bufor W, H, —, —)
//   kotwice (mój okręt, ≤ NAMIAR_ANCH): A0 = (sx, sy, promień bazowy błony, ślad), A1 = (pierwsza grupa, grup, ziarno, —)
//   znaczniki (≤ NAMIAR_MARKS): M0 = (sx, sy, r0, kierunek), M1 = (ułamek, est, ziarno, strona: 0 — przy mnie, 1 — przy
//   wrogu), M2 = (rozbłysk 1 → 0, szczelina 0..1, wiek pęknięcia [s], τ — czas struny całkowany na CPU),
//   M3 = (limit połowy kąta [rad] — sąsiednie grupy się nie nakładają, —, —, —)
// Współrzędne: px bufora, y od góry, kąt jak canvas `arc`. Stan zdarzeń (rozbłysk, szczelina, wiek, τ) liczy CPU po stronie
// widoku — w shaderze same formuły. τ na CPU (dτ = (1 + k²) dt), żeby struna mogła „stroić w górę” bez skoków fazy.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, screenCoordinate, positionGeometry,
  exp, sin, cos, atan, length, sqrt, mix, smoothstep, clamp, max, min, abs, fract, floor, step, texture3D
} from 'three/tsl';
import { fxNoise } from '../../src/3d/fx/noise.js';
import { tv, u01, uOf, hash3 } from './kontaktyTSL.js';

export const NAMIAR_STYLES = Object.freeze(['wachlarz', 'struna', 'blona']);
export const NAMIAR_HDR = 2;
export const NAMIAR_ANCH = 6;
export const NAMIAR_MARKS = 32;
export const NAMIAR_MARK_BASE = NAMIAR_HDR + 2 * NAMIAR_ANCH;
export const NAMIAR_MARK_VEC = 4;
/** Wachlarz w px CSS: łuków, odstęp, pół szerokości [rad], grubość. Struna: długość łuku i odstęp od r0 (przy mnie / przy wrogu). */
export const NAMIAR_GEOM = Object.freeze({
  N: 7, GAP: 11, HALF: 0.3, LW: 2.2,
  STR_LEN: [150, 104], STR_GAP: [30, 22], STR_HMAX: 1.25, STR_RIP: 0.1
});

const TAU = 6.283185307;
const PI = 3.141592654;
const BLUE = [0.157, 0.60, 1.0];     // 110, 204, 255 (sRGB) → liniowo
const RED = [1.0, 0.162, 0.138];     // 255, 112, 104 (sRGB) → liniowo
const c3 = (a) => vec3(a[0], a[1], a[2]);
const wrapAngle = (a) => a.sub(floor(a.add(PI).div(TAU)).mul(TAU));
const gauss = (x, w) => { const q = x.div(w); return exp(q.mul(q).negate()); };

export function createNamiarBlock() {
  const arr = Array.from({ length: NAMIAR_MARK_BASE + NAMIAR_MARK_VEC * NAMIAR_MARKS }, () => new THREE.Vector4());
  const node = uniformArray(arr, 'vec4').setName('namiarCzujnikow');
  return { node, array: node.array };
}

function header(B) {
  const h0 = B.element(0);
  return { count: int(h0.x), t: h0.y, pxs: max(h0.z, 0.25), anchors: int(h0.w) };
}

function markLoop(B, start, end, name, body) {
  Loop({ start, end, type: 'int', condition: '<', name }, (o) => {
    const base = o[name].mul(NAMIAR_MARK_VEC).add(NAMIAR_MARK_BASE);
    body({
      M0: tv('v4', B.element(base)),
      M1: tv('v4', B.element(base.add(1))),
      M2: tv('v4', B.element(base.add(2))),
      M3: tv('v4', B.element(base.add(3)))
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. WACHLARZ
function wachlarzLook(B, px) {
  const { count, t, pxs } = header(B);
  const G = NAMIAR_GEOM;
  const N = G.N;
  const rgb = vec3(0).toVar('wlRgb');
  const gap = tv('f', pxs.mul(G.GAP));
  const lw = tv('f', pxs.mul(G.LW));
  markLoop(B, int(0), count, 'wi', ({ M0, M1, M2, M3 }) => {
    const d = tv('v2', px.sub(M0.xy));
    const r = tv('f', length(d));
    const r0 = M0.z;
    If(r.lessThan(r0.add(gap.mul(N + 3)).add(pxs.mul(14))).and(r.greaterThan(r0.sub(gap.mul(1.5)))), () => {
      const dA = tv('f', wrapAngle(atan(d.y, d.x).sub(M0.w)));
      const a = tv('f', abs(dA));
      const ratio = M1.x, est = M1.y, seed = M1.z, flash = M2.x;
      const col = tv('v3', mix(c3(BLUE), c3(RED), M1.w));
      const hw = tv('f', min(M3.x, G.HALF));
      const edge = pxs.mul(1.2).div(max(r, 1.0));
      const angMask = tv('f', float(1.0).sub(smoothstep(hw.sub(edge), hw.add(edge), a)));
      const angFade = tv('f', mix(float(1.0), float(0.42), smoothstep(hw.mul(0.3), hw, a)));
      const u = tv('f', r.sub(r0).div(gap));                   // odległość od r0 w odstępach łuków
      const i = tv('f', floor(u.add(0.5)));
      const du = tv('f', u.sub(i).mul(gap));                   // px od środka najbliższego łuku
      const validArc = tv('f', step(-0.5, i).mul(step(i, N - 0.5)));
      const lit = tv('f', clamp(ratio, 0.0, 1.0).mul(N));
      const part = tv('f', clamp(lit.sub(i), 0.0, 1.0).mul(validArc));
      const reached = tv('f', step(1.0, ratio));
      const hot = tv('f', smoothstep(0.98, 1.4, ratio));
      const near = tv('f', smoothstep(0.7, 1.0, ratio));       // napięcie przy progu
      const line = tv('f', gauss(du, lw.mul(0.55)));
      const glow = tv('f', gauss(du, lw.mul(1.6)));
      const fall = float(1.0).sub(i.mul(0.3 / N));
      // radar zgadnięty: łuki w kreskach, słabiej
      const dash = step(0.42, fract(a.mul(r).div(pxs.mul(5.0))));
      const estMul = tv('f', mix(float(1.0), dash.mul(0.7).add(0.3).mul(0.62), est));
      // jasność biegnie od okrętu po zapalonych łukach — szybciej przy progu; łuki stoją
      const sp = min(ratio, 1.3).mul(0.9).add(0.5);
      const pp = fract(t.mul(sp).add(seed)).mul(lit.add(2.2)).sub(1.1);
      const boost = tv('f', gauss(u.sub(pp), float(0.6)).mul(1.5).mul(step(u, lit.add(0.5))));
      const flick = sin(t.mul(21.0).add(seed.mul(9.0)).add(i.mul(1.3))).mul(0.22).mul(hot.add(near.mul(0.4))).add(1.0);
      const Ilit = part.mul(fall).mul(line.mul(1.1).add(glow.mul(0.2))).mul(boost.mul(0.8).add(1.0)).mul(flick)
        .mul(estMul).mul(hot.mul(0.3).add(1.0));
      const empty = float(1.0).sub(step(0.001, part)).mul(validArc).mul(line).mul(0.1);
      // słaby klin światła od okrętu do granicy zasięgu — jeden kształt, nie osobne kreski
      const wedge = smoothstep(-0.6, 0.0, u).mul(float(1.0).sub(smoothstep(lit.sub(0.5), lit.add(0.1), u)))
        .mul(clamp(float(1.0).sub(a.div(hw)), 0.0, 1.0)).mul(0.045).mul(estMul);
      const whiten = clamp(line.mul(boost.mul(0.22).add(hot.mul(0.15))), 0.0, 0.5);
      rgb.addAssign(mix(col, vec3(1.0), whiten).mul(Ilit).add(col.mul(empty.add(wedge))).mul(angMask).mul(angFade));
      // grot za ostatnim łukiem: sięga
      const ca = cos(M0.w), sa = sin(M0.w);
      const qx = d.x.mul(ca).add(d.y.mul(sa));
      const qy = d.y.mul(ca).sub(d.x.mul(sa));
      const ax = qx.sub(r0.add(gap.mul(N)).add(pxs.mul(1.5)));
      const len = pxs.mul(10.0);
      const sdf = max(max(ax.negate(), ax.sub(len)), abs(qy).sub(pxs.mul(6.5).mul(float(1.0).sub(ax.div(len)))));
      const arrow = float(1.0).sub(smoothstep(pxs.mul(-0.7), pxs.mul(0.7), sdf));
      const breathe = sin(t.mul(6.0).add(seed.mul(5.0))).mul(0.5).add(0.5);
      rgb.addAssign(mix(col, vec3(1.0), 0.15).mul(arrow.mul(reached).mul(hot.mul(breathe).mul(0.6).add(1.5)).mul(estMul)));
      // rozbłysk przy przejściu przez 1: pierścień leci przez wachlarz i dalej, cały się rozjarza
      const rr = float(1.0).sub(flash).mul(N + 6);
      const ring = gauss(u.sub(rr), float(0.4)).mul(flash).mul(2.2);
      const wash = flash.mul(glow).mul(1.0).mul(step(u, float(N)));
      rgb.addAssign(mix(col, vec3(1.0), 0.25).mul(ring.add(wash)).mul(angMask));
    });
  });
  return rgb;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. STRUNA
const WHOLE_F = [1.3, 2.87, 4.71, 7.13, 9.93];       // [Hz w czasie τ] niewspółmierne, wyższe harmoniczne szybciej
const BROKEN_F = [2.1, 4.6, 7.7, 11.3];              // mody wolnego końca
const TRAIL = [[0.0, 1.0], [0.011, 0.42], [0.022, 0.2], [0.033, 0.09]];   // poświata luminoforu: opóźnienie τ, jasność

function strunaLook(B, px) {
  const { count, t, pxs } = header(B);
  const G = NAMIAR_GEOM;
  const rgb = vec3(0).toVar('stRgb');
  markLoop(B, int(0), count, 'si', ({ M0, M1, M2, M3 }) => {
    const side = M1.w, ratio = M1.x, est = M1.y, seed = M1.z;
    const flash = M2.x, gapS = M2.y, age = M2.z, tau = M2.w;
    const d = tv('v2', px.sub(M0.xy));
    const r = tv('f', length(d));
    const rs = tv('f', M0.z.add(pxs.mul(mix(float(G.STR_GAP[0]), float(G.STR_GAP[1]), side))));
    const lenPx = tv('f', pxs.mul(mix(float(G.STR_LEN[0]), float(G.STR_LEN[1]), side)));
    const H = tv('f', min(min(lenPx.div(rs.mul(2.0)), G.STR_HMAX), M3.x));
    const arcLen = tv('f', H.mul(2.0).mul(rs));
    const strength = tv('f', mix(float(1.0), float(0.6), side));
    const ampK = tv('f', clamp(arcLen.div(lenPx), 0.4, 1.0));     // krótsza struna (grupy obok siebie) — mniejsza amplituda
    const broken = tv('f', step(0.001, gapS));
    const hit = tv('v3', mix(c3(RED), c3(BLUE), side));      // barwa tego, kto sięgnął: przy mnie czerwień, przy wrogu błękit
    // ── pęknięcie: rozbłysk i fala w miejscu rozerwania ───────────────────────────────────────────────────────────
    const sb = tv('f', seed.sub(0.5).mul(0.16).add(0.5));
    const thB = M0.w.add(sb.mul(2.0).sub(1.0).mul(H));
    const pB = tv('v2', M0.xy.add(vec2(cos(thB), sin(thB)).mul(rs)));
    If(age.lessThan(1.5), () => {
      const rp = tv('f', length(px.sub(pB)));
      const burst = exp(age.div(0.08).negate()).mul(gauss(rp, pxs.mul(30.0))).mul(5.0);
      const haze = exp(age.div(0.2).negate()).mul(gauss(rp, pxs.mul(90.0))).mul(0.26);
      const Rr = pxs.mul(float(1.0).sub(exp(age.div(0.3).negate())).mul(560.0).add(10.0));
      const wr = pxs.mul(age.mul(9.0).add(2.0));
      const ring = gauss(rp.sub(Rr), wr).mul(exp(age.div(0.4).negate())).mul(1.3);
      rgb.addAssign(mix(hit, vec3(1.0), 0.3).mul(burst).add(hit.mul(haze.add(ring))).mul(strength.mul(strength)));
    });
    // ── struna ────────────────────────────────────────────────────────────────────────────────────────────────────
    If(abs(r.sub(rs)).lessThan(pxs.mul(64.0)), () => {
      const dA = tv('f', wrapAngle(atan(d.y, d.x).sub(M0.w)));
      const a = tv('f', abs(dA));
      If(a.lessThan(H.add(pxs.mul(10.0).div(rs))), () => {
        const s = tv('f', clamp(dA.add(H).div(H.mul(2.0)), 0.0, 1.0));
        const k = tv('f', clamp(ratio, 0.0, 1.0));
        const k3 = tv('f', k.mul(k).mul(k));
        const tension = tv('f', smoothstep(0.7, 1.0, k));
        // amplitudy całej struny [px bufora]: podstawowa + kolejne dochodzą coraz później; lekkie „oddychanie”
        const breath = sin(tau.mul(2.3).add(seed.mul(9.0))).mul(0.14).add(1.0);
        const A0 = tv('f', pxs.mul(k3.mul(12.0).add(0.45)).mul(strength).mul(breath).mul(ampK));
        const aW = [
          A0,
          tv('f', A0.mul(0.55).mul(smoothstep(0.3, 0.7, k))),
          tv('f', A0.mul(0.42).mul(smoothstep(0.55, 0.85, k))),
          tv('f', A0.mul(0.30).mul(smoothstep(0.72, 0.95, k))),
          tv('f', A0.mul(0.22).mul(smoothstep(0.85, 1.0, k)))
        ];
        const sPi = tv('f', s.mul(PI));
        const mW = WHOLE_F.map((_, n) => tv('f', sin(sPi.mul(n + 1))));
        const dW = WHOLE_F.map((_, n) => tv('f', cos(sPi.mul(n + 1)).mul((n + 1) * PI).div(arcLen)));
        const phW = WHOLE_F.map((_, n) => tv('f', seed.mul(2.399 * (n + 1) * 2.0).add(n * 1.3)));
        // połówki po pęknięciu: h = 0 przy węźle … 1 na wolnym końcu
        const left = tv('f', step(s, sb));
        const gs = tv('f', gapS.mul(G.STR_RIP));
        const lenH = tv('f', max(mix(float(1.0).sub(sb).sub(gs), sb.sub(gs), left), 0.05));
        const h = tv('f', mix(float(1.0).sub(s), s, left).div(lenH));
        const segPx = tv('f', lenH.mul(arcLen));
        const hot = tv('f', smoothstep(1.0, 1.5, ratio));
        const whip = tv('f', exp(age.div(0.3).negate()));
        const rat = tv('f', pxs.mul(hot.mul(2.4).add(2.8)).mul(strength).mul(ampK));
        const whipA = tv('f', pxs.mul(26.0).mul(whip).mul(strength).mul(ampK));
        const aB = [
          tv('f', rat.add(whipA)),
          tv('f', rat.mul(0.6).add(whipA.mul(0.35))),
          tv('f', rat.mul(0.38)),
          tv('f', rat.mul(0.22))
        ];
        const hPi = tv('f', h.mul(PI));
        const mB = BROKEN_F.map((_, j) => tv('f', sin(hPi.mul(j + 0.5))));
        const dB = BROKEN_F.map((_, j) => tv('f', cos(hPi.mul(j + 0.5)).mul((j + 0.5) * PI).div(segPx)));
        const phB = BROKEN_F.map((_, j) => tv('f', seed.mul(3.7 * (j + 1)).add(left.mul(1.7 + j))));
        // ślad: kilka próbek czasu (rozmycie ruchu / luminofor)
        const offs = r.sub(rs);
        const wl = tv('f', pxs.mul(k3.mul(0.12).add(0.8)));
        const core = float(0).toVar();
        const glow = float(0).toVar();
        for (let q = 0; q < TRAIL.length; q++) {
          const tq = tv('f', tau.sub(TRAIL[q][0]));
          const y = float(0).toVar();
          const sl = float(0).toVar();
          If(broken.lessThan(0.5), () => {
            for (let n = 0; n < WHOLE_F.length; n++) {
              const c = tv('f', cos(tq.mul(WHOLE_F[n] * TAU).add(phW[n])));
              y.addAssign(aW[n].mul(mW[n]).mul(c));
              sl.addAssign(aW[n].mul(dW[n]).mul(c));
            }
          }).Else(() => {
            for (let j = 0; j < BROKEN_F.length; j++) {
              const c = tv('f', cos(tq.mul(BROKEN_F[j] * TAU).add(phB[j])));
              y.addAssign(aB[j].mul(mB[j]).mul(c));
              sl.addAssign(aB[j].mul(dB[j]).mul(c));
            }
          });
          const dist = tv('f', abs(offs.sub(y)).div(sqrt(sl.mul(sl).add(1.0))));
          core.addAssign(gauss(dist, wl).mul(TRAIL[q][1]));
          if (q === 0) glow.addAssign(gauss(dist, wl.mul(5.5)));
        }
        // maski końców: węzły całej struny, wolny koniec połówki
        const e = pxs.mul(1.2).div(rs);
        const endMask = float(1.0).sub(smoothstep(H.sub(e), H.add(e), a));
        const aaH = pxs.mul(1.4).div(segPx);
        const tipMask = float(1.0).sub(smoothstep(float(1.0).sub(aaH), aaH.add(1.0), h));
        const lineMask = tv('f', endMask.mul(mix(float(1.0), tipMask, broken)));
        // rozmyta obwiednia drgania (struna przy progu widać jak wrzeciono)
        let envY = aW[0].mul(abs(mW[0]));
        for (let n = 1; n < aW.length; n++) envY = envY.add(aW[n].mul(abs(mW[n])));
        const env = tv('f', envY);
        const band = float(1.0).sub(smoothstep(env.mul(0.2), env.mul(1.15).add(pxs.mul(2.0)), abs(offs)))
          .mul(tension).mul(0.018).mul(float(1.0).sub(broken)).mul(endMask);
        // barwa: przy mnie spokojny błękit → napięcie bieleje; przy wrogu czerwień przygaszona; po pęknięciu — barwa sięgającego
        const ownCol = mix(c3(BLUE), c3(RED), side);
        const tenseCol = mix(ownCol, vec3(1.0, 0.8, 0.82), tension.mul(0.55));
        const pulse = sin(t.mul(5.2).add(seed.mul(7.0))).mul(0.16).add(1.0);
        const rejoin = smoothstep(0.0, 0.3, gapS);
        const col = tv('v3', mix(tenseCol, hit.mul(pulse), rejoin));
        // jasność: spokojna niska, przy progu HDR (bloom)
        const tip = tv('f', gauss(float(1.0).sub(h).mul(segPx), pxs.mul(7.0)).mul(broken));
        const I = tv('f', mix(k3.mul(0.5).add(0.62), float(1.25), broken).mul(strength).mul(flash.mul(2.5).add(1.0)));
        // radar zgadnięty — struna rwana (komórki wzdłuż łuku, losowane 9 razy na sekundę) i słabsza
        const cell = uOf(s.mul(13.0).add(seed.mul(7.0)));
        const gate = u01(hash3(cell, uOf(t.mul(9.0)), uint(3)));
        const estMul = tv('f', mix(float(1.0), step(0.34, gate).mul(0.66), est));
        rgb.addAssign(col.mul(core.mul(I).mul(tip.mul(1.8).add(1.0)).add(glow.mul(I).mul(0.12))).mul(lineMask).mul(estMul));
        rgb.addAssign(tenseCol.mul(band));
        // węzły: nieruchome kołki na końcach
        const pd2 = r.sub(rs).mul(r.sub(rs)).add(a.sub(H).mul(rs).mul(a.sub(H).mul(rs)));
        const pin = exp(pd2.div(pxs.mul(2.1).mul(pxs.mul(2.1))).negate()).mul(1.3).mul(strength);
        rgb.addAssign(mix(ownCol, hit, rejoin).mul(pin));
      });
    });
  });
  return rgb;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. BŁONA
function blonaLook(B, px, noiseTex) {
  const { t, pxs, anchors } = header(B);
  const rgb = vec3(0).toVar('blRgb');
  Loop({ start: int(0), end: anchors, type: 'int', condition: '<', name: 'ba' }, ({ ba }) => {
    const A0 = tv('v4', B.element(ba.mul(2).add(NAMIAR_HDR)));
    const A1 = tv('v4', B.element(ba.mul(2).add(NAMIAR_HDR + 1)));
    const d = tv('v2', px.sub(A0.xy));
    const r = tv('f', length(d));
    const Rb = A0.z, sig = A0.w, aSeed = A1.z;
    If(r.lessThan(Rb.mul(3.2).add(pxs.mul(330.0))), () => {
      const th = tv('f', atan(d.y, d.x));
      const sumB = float(0).toVar();         // wybrzuszenia [px]
      const sumD = float(0).toVar();         // ich pochodna po kącie
      const heat = float(0).toVar();
      const tear = float(0).toVar();
      const rag = float(0).toVar();
      const flW = float(0).toVar();          // rozbłysk grupy najsilniejszej w tym kierunku
      const flV = float(0).toVar();
      markLoop(B, int(A1.x), int(A1.x.add(A1.y)), 'bg', ({ M0, M1, M2 }) => {
        const da = tv('f', wrapAngle(th.sub(M0.w)));
        const k = tv('f', clamp(M1.x, 0.0, 1.5));
        const kc = tv('f', min(k, 1.0));
        const sg = tv('f', mix(float(0.9), float(0.42), kc));
        const sg2 = tv('f', sg.mul(sg));
        const w = tv('f', exp(da.mul(da).div(sg2).negate()));
        const hgt = tv('f', Rb.mul(kc.mul(kc).mul(kc).mul(1.05).add(0.04).add(k.sub(kc).mul(0.4))));
        sumB.addAssign(hgt.mul(w));
        sumD.addAssign(hgt.mul(w).mul(da.mul(-2.0).div(sg2)));
        const estDim = float(1.0).sub(M1.y.mul(0.4));
        heat.assign(max(heat, smoothstep(0.7, 1.0, k).mul(gauss(da, sg.mul(1.3))).mul(estDim)));
        tear.assign(max(tear, step(0.001, M2.y).mul(M2.y).mul(gauss(da, sg.mul(0.95)))));
        rag.assign(max(rag, M1.y.mul(w)));
        const fw = M2.x.mul(gauss(da, sg.mul(1.8)));
        const better = step(flW, fw);
        flV.assign(mix(flV, M2.x, better));
        flW.assign(max(flW, fw));
      });
      const q = tv('v2', d.div(pxs));
      // szum: grube kłęby, drobna faktura (język OBŁOKU); kafel noise3D — współrzędne w px CSS względem okrętu
      const n1 = tv('v4', texture3D(noiseTex, vec3(q.div(420.0).add(aSeed), t.mul(0.03))).level(0));
      const n2 = tv('v4', texture3D(noiseTex, vec3(q.div(140.0).add(0.37), t.mul(0.07))).level(0));
      const Rm = tv('f', Rb.add(sumB));
      const shiver = sin(th.mul(23.0).sub(t.mul(13.0))).add(sin(th.mul(37.0).add(t.mul(19.0))).mul(0.6)).mul(heat).mul(pxs.mul(1.5));   // drżenie przy progu
      const wob = n1.x.sub(0.5).mul(Rb.mul(0.24)).add(n2.y.sub(0.5).mul(Rb.mul(0.045)).mul(heat.mul(1.5).add(1.0))).add(shiver);
      const slope = tv('f', sqrt(sumD.div(max(r, Rb.mul(0.7))).mul(sumD.div(max(r, Rb.mul(0.7)))).add(1.0)));
      const F = tv('f', r.sub(Rm).sub(wob).div(slope));     // ≈ odległość od brzegu błony [px bufora]; < 0 — w środku
      const col = tv('v3', mix(c3(BLUE), c3(RED), clamp(heat.mul(1.1), 0.0, 1.0)));
      const lum = tv('f', clamp(sig.mul(0.42).add(0.58), 0.45, 1.3));   // ślad: cisza przygasza, ciąg rozjaśnia
      // brzeg: miękka linia, jasność faluje wzdłuż (kłęby, nie kreska z lampy)
      const rim = tv('f', gauss(F, pxs.mul(1.9)));
      const rimVar = tv('f', n2.x.mul(1.0).add(n1.y.mul(0.5)).add(0.15));
      const inside = tv('f', step(F, 0.0));
      const fillK = tv('f', exp(min(F, 0.0).div(Rb.mul(0.34))));
      // ciało błony: kłęby fBm przy brzegu (jak obłok), przygasają ku środkowi
      const cloud = tv('f', smoothstep(0.28, 0.86, n1.y.mul(0.6).add(n2.x.mul(0.4))));
      const body = fillK.mul(fillK).mul(inside).mul(cloud.mul(0.17).add(0.012));
      const soft = gauss(F.add(pxs.mul(13.0)), pxs.mul(8.0)).mul(n1.x.mul(0.5).add(0.1)).mul(0.22);
      // pasma interferencji płyną w dół ekranu, rzadkie i cienkie (jak w OBŁOKU)
      const bands = smoothstep(0.86, 1.0, sin(q.y.mul(0.55).sub(t.mul(9.0)).add(n2.y.mul(6.0)))).mul(cloud).mul(fillK).mul(inside).mul(0.1);
      // rzadki „śnieg” sygnału w ciele błony
      const pc = floor(q.div(1.5));
      const speck = step(float(1.0).sub(fillK.mul(fillK).mul(inside).mul(0.006)), u01(hash3(uOf(pc.x.add(4096.0)), uOf(pc.y.add(4096.0)), uOf(t.mul(24.0))))).mul(0.7);
      const outK = exp(max(F, 0.0).div(pxs.mul(15.0)).negate()).mul(float(1.0).sub(inside));
      const haze = outK.mul(n2.y.mul(0.9).add(0.05)).mul(0.17);
      // pęknięcie: dziury w brzegu i pasma uchodzące na zewnątrz wzdłuż promienia
      const n3 = tv('v4', texture3D(noiseTex, vec3(q.div(46.0).add(0.71), t.mul(0.5))).level(0));
      const holes = tv('f', smoothstep(0.47, 0.6, n3.x.add(float(1.0).sub(tear))));
      const rays = texture3D(noiseTex, vec3(th.div(TAU).mul(6.0), r.div(pxs).sub(t.mul(70.0)).div(620.0), t.mul(0.03))).level(0).x;
      const leak = smoothstep(0.42, 0.72, rays).mul(exp(max(F, 0.0).div(pxs.mul(30.0)).negate()))
        .mul(float(1.0).sub(inside)).mul(tear).mul(0.7);
      // radar zgadnięty: brzeg wybrzuszenia rwany
      const estCut = tv('f', float(1.0).sub(rag.mul(float(1.0).sub(step(0.46, n3.y)))));
      const rimI = rim.mul(rimVar).mul(heat.mul(0.9).add(0.95)).mul(holes).mul(estCut);
      rgb.addAssign(col.mul(rimI.add(body).add(soft.mul(inside)).add(bands).add(haze).add(speck)).mul(lum));
      rgb.addAssign(c3(RED).mul(leak));
      // rozbłysk przy przekroczeniu: brzeg się rozjarza, fala biegnie na zewnątrz w kształcie błony
      const fl = tv('f', flW.mul(flV));
      const age = float(1.0).sub(flV).mul(0.9);
      const Rr = pxs.mul(float(1.0).sub(exp(age.div(0.28).negate())).mul(300.0));
      const ring = gauss(F.sub(Rr), pxs.mul(age.mul(10.0).add(2.0))).mul(flW).mul(exp(age.div(0.38).negate())).mul(1.2);
      const blaze = rim.mul(fl).mul(3.5).add(gauss(F, pxs.mul(26.0)).mul(fl).mul(0.55));
      rgb.addAssign(mix(c3(RED), vec3(1.0), 0.14).mul(ring.add(blaze)));
    });
  });
  return rgb;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Refrakcja fali uderzeniowej przy pęknięciu (STRUNA, BŁONA): warstwa DIST Core3D — RG = przesunięcie [px bufora, osie sceny].
function shockDisp(B, px, style) {
  const { count, pxs } = header(B);
  const G = NAMIAR_GEOM;
  const disp = vec2(0).toVar('shDisp');
  markLoop(B, int(0), count, 'di', ({ M0, M1, M2 }) => {
    const age = M2.z;
    If(age.lessThan(1.1).and(M1.w.lessThan(0.5)), () => {
      let c;
      if (style === 'struna') {
        const rs = M0.z.add(pxs.mul(G.STR_GAP[0]));
        const H = min(pxs.mul(G.STR_LEN[0]).div(rs.mul(2.0)), G.STR_HMAX);
        const sb = M1.z.sub(0.5).mul(0.16).add(0.5);
        const thB = M0.w.add(sb.mul(2.0).sub(1.0).mul(H));
        c = M0.xy.add(vec2(cos(thB), sin(thB)).mul(rs));
      } else {
        c = M0.xy.add(vec2(cos(M0.w), sin(M0.w)).mul(M0.z.mul(2.0)));
      }
      const dp = tv('v2', px.sub(c));
      const rp = tv('f', length(dp));
      const Rr = pxs.mul(float(1.0).sub(exp(age.div(0.3).negate())).mul(560.0).add(10.0));
      const amp = pxs.mul(13.0).mul(exp(age.div(0.42).negate())).mul(gauss(rp.sub(Rr), pxs.mul(age.mul(16.0).add(10.0))));
      disp.addAssign(vec2(dp.x, dp.y.negate()).div(max(rp, 1.0)).mul(amp));
    });
  });
  return disp;
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

/** Kwad pełnoekranowy propozycji (addytywnie, warstwa 0); STRUNA i BŁONA mają drugi kwad na warstwie DIST (`dist`). */
export function createNamiarMeshes(style, block, distLayer) {
  if (!NAMIAR_STYLES.includes(style)) throw new Error(`namiar: nieznana propozycja ${style}`);
  const rect = uniform(new THREE.Vector4(-1, -1, 1e9, 1e9));
  const noiseTex = style === 'blona' ? fxNoise.noise3D() : null;
  const mat = baseMaterial(`NamiarCzujnikow:${style}`);
  mat.fragmentNode = Fn(() => {
    const p = tv('v2', screenCoordinate.xy);
    const rgb = style === 'wachlarz' ? wachlarzLook(block.node, p)
      : style === 'struna' ? strunaLook(block.node, p) : blonaLook(block.node, p, noiseTex);
    return vec4(clamp(rgb, vec3(0.0), vec3(48.0)).mul(rectMask(rect, p)), 0.0);
  })();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.name = `NamiarCzujnikow:${style}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10001;
  mesh.layers.set(0);
  mesh.userData.rect = rect;
  let dist = null;
  if (style !== 'wachlarz') {
    // warstwa DIST: przesunięcie [px bufora, osie sceny] w RG, B = A = 0 (aberracja barw z „uber”), addytywnie
    const dm = baseMaterial(`NamiarCzujnikow:${style}-dist`);
    dm.blendSrcAlpha = THREE.OneFactor;
    dm.fragmentNode = Fn(() => {
      const p = tv('v2', screenCoordinate.xy);
      const o = shockDisp(block.node, p, style);
      return vec4(clamp(o, vec2(-24.0), vec2(24.0)).mul(rectMask(rect, p)), 0.0, 0.0);
    })();
    dist = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dm);
    dist.name = `NamiarCzujnikow:${style}-dist`;
    dist.frustumCulled = false;
    dist.layers.set(distLayer);
  }
  return { mesh, dist, rect };
}
