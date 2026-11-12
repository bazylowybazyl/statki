// dema/kontakty-czujnikow/granicaTSL.js
//
// GRANICA WYKRYCIA — „tu cię widzą” (czwarta runda, 2026-11-10; plan: docs/PLAN-kontakt-czujnikow.md § 7). Słowa
// użytkownika: „jakiś znacznik pokazujący zasięg graniczny — że jak przez niego lecisz, to widzi cię enemy … zmiana koloru
// nie pokazuje ci, gdzie przeciwnicy widzą, a po prostu koło ogromne pokazujące zasięg wzroku enemy jest suche”.
// Granica to okrąg wokół grupy o promieniu R = ich czujniki × MÓJ ślad — ciąg (×1,35) pcha ją na mnie, cicha praca (×0,5)
// ją odsuwa. Decyzja użytkownika: „tafla, ale bez podświetlenia” — TAFLA zostaje, i to w dwóch poziomach modelu (§ 7a):
// szara KONTAKTU („nie wiadomo kto”, jedzie z moim śladem) i czerwona WZROKU („objawienie kto”, stoi). Trzy pomysły w demie:
//  TAFLA — granicę widać tylko w pobliżu mojego okrętu: przezroczysta tafla pola siłowego (refrakcja na warstwie DIST,
//     kaustyka po stronie wroga), zmarszczki od punktu granicy najbliższego mnie, smuga, gdy tafla jedzie. Przejście:
//     błysk w miejscu przejścia, a zmarszczka obiega raz CAŁE koło (przez chwilę widać całą strefę) — do środka czerwień,
//     na zewnątrz błękit.
//  PRZYBÓJ — od wroga biegną słabe fale (jego czujniki), piętrzą się przy granicy i łamią na niej: piana wybiega za granicę
//     i cofa się, każdy grzbiet dochodzi w innym miejscu (zgięte grzbiety). Widać to tylko w pobliżu mnie; w zasięgu fale
//     obmywają kadłub.
//  PODŚWIETLENIE (zamiast oka przy kursorze) — gdy mnie widzą, kadłub jest oświetlony od strony wroga: czerwone światło
//     z płaskorzeźbą paneli, świecąca krawędź od strony wroga, linie skanu (przy przyboju — grzbiety jego fal), słaby
//     snop w przestrzeni. Atlas rysuje tu shader (sprite jako tekstura), nie nakładka 2D.
// Blok `namiarCzujnikow` (nagłówek i kotwice jak w namiarTSL.js; px bufora, y od góry, kąt jak canvas `arc`):
//   TAFLA / PRZYBÓJ: A0 = (sx, sy, pół długości okrętu, widoczność), A1 = (okno: pełne, zero [px], długość fali [px],
//     prędkość fal [px/s]); znacznik = grupa: M0 = (cx, cy, promień KONTAKTU Rc [px], widoczność), M1 = przejście granicy
//     kontaktu (wiek [s] albo −1, kierunek +1 do środka / −1 na zewnątrz, kąt miejsca przejścia, Rc w chwili przejścia),
//     M2 = (est, prędkość granicy kontaktu [px/s, + = rośnie], kąt mojego okrętu od środka grupy, promień WZROKU Rv [px]),
//     M3 = przejście granicy wzroku (wiek, kierunek, kąt, widoczność szarej tafli — wiedza × zlewanie: 0, gdy Rc ≤ Rv),
//     M4 = (całe koło szarej — wykrywam ich, całe koło czerwonej — identyfikuję ich, widoczność „?”, —); M0.w — widoczność
//     czerwonej. Obustronnie (słowa użytkownika, plan § 7b): ich granice widać, gdy wykrywam ich ALBO oni mnie; kawałek przy
//     mnie zawsze, całe koło słabo tylko wtedy, gdy wiem, gdzie są
//   PODŚWIETLENIE: A0 = (sx, sy, długość okrętu [px], kurs), A1 = (poziom mipmapy, fale przyboju 0/1, długość fali,
//     prędkość fal), A2 = (wysokość / długość sprite'a, widoczność); znacznik = grupa, która mnie widzi:
//     M0 = (cx, cy, światło 0..1, wiek włączenia [s]), M1 = (ziarno, —)
import * as THREE from 'three/webgpu';
import {
  Fn, If, float, int, uint, vec2, vec3, vec4, uniform, screenCoordinate, texture, texture3D,
  exp, sin, cos, atan, length, mix, smoothstep, clamp, max, min, abs, fract, floor, step, dot, normalize
} from 'three/tsl';
import { fxNoise } from '../fx/noise.js';
import { tv, pcg, u01, uOf, hash2, hash3, xCellsOct, zoomOctaves } from './kontaktyTSL.js';
import { header, anchorAt, markLoop, baseMaterial, rectMask, gauss, wrapAngle, c3, BLUE, RED, PI } from './namiarTSL.js';

export const GRANICA_STYLES = Object.freeze(['tafla', 'przyboj', 'swiatlo']);
/** Atlas: wysokość / długość sprite'a (assets/capital_ship_rect_v1.png, 3747 × 1677). */
export const HULL_ASPECT = 1677 / 3747;
const HULL_GAIN = 1.22;            // sprite idzie przez ACES postu — podbicie, żeby kadłub wyglądał jak w nakładce 2D

// Przejście przez granicę: zmarszczka obiega koło od miejsca przejścia (w obie strony, spotkanie po drugiej stronie
// po ~1,4 s), za nią gasnący ślad (cała strefa widoczna przez chwilę), błysk w miejscu przejścia — przy samej linii
// (gauss od `f`), krótki: szeroki i długi błysk wypełniał pas liczenia (|f| < pas) i wychodził jako łuk z twardymi brzegami.
function crossing(px, C, R, th, f, M1, pxs) {
  const age = M1.x;
  const live = tv('f', step(0.0, age).mul(step(age, 2.8)));
  const arcC = tv('f', abs(wrapAngle(th.sub(M1.z))).mul(R));
  const x = tv('f', clamp(age.div(1.4), 0.0, 1.0));
  const front = tv('f', R.mul(PI).mul(float(1.0).sub(float(1.0).sub(x).mul(float(1.0).sub(x)))));
  const ripple = tv('f', gauss(arcC.sub(front), pxs.mul(age.mul(14.0).add(9.0))).mul(float(1.0).sub(x.mul(0.6))).mul(live));
  const trail = tv('f', step(arcC, front).mul(exp(front.sub(arcC).div(R.mul(1.3).add(1.0)).negate()))
    .mul(exp(age.div(1.1).negate())).mul(live));
  const Pc = C.add(vec2(cos(M1.z), sin(M1.z)).mul(R));
  const flash = tv('f', gauss(length(px.sub(Pc)), pxs.mul(age.mul(45.0).add(12.0))).mul(gauss(f, pxs.mul(age.mul(30.0).add(10.0))))
    .mul(exp(age.div(0.2).negate())).mul(live));
  const col = tv('v3', mix(c3(BLUE), c3(RED), step(0.0, M1.y)));
  return { ripple, trail, flash, col };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. TAFLA — dwa poziomy (plan § 7a): szara tafla KONTAKTU (wiedzą, że coś jest — granica jedzie z moim śladem) i czerwona
//    tafla WZROKU (wiedzą, kto — stoi, wzrok nie zależy od śladu). Gdy cisza zsunie szarą pod czerwoną, szara zlewa się
//    z nią i znika (`M3.w`). Przejścia: szara / czerwona zmarszczka wokół koła, „?” albo „!” nad miejscem przejścia,
//    wyjście — błękit.
const GRAY = [0.42, 0.44, 0.47];          // szarość kontaktu (jak obłok X-ów), liniowo

const segD = (p, a, b) => {
  const pa = p.sub(a), ba = b.sub(a);
  const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0.0, 1.0);
  return length(pa.sub(ba.mul(h)));
};
// Glify w jednostkach glifu (y w dół), SDF (< 0 — w kresce): „?” — mają kontakt, „!” — wiedzą kto.
function glyphQuestion(q) {
  const c = vec2(0.0, -3.0);
  const d = q.sub(c);
  const a = atan(d.y, d.x);
  const gap = step(0.6, a).mul(step(a, 3.1));                 // dolny łuk od prawej do lewej — przerwa haczyka
  const e1 = vec2(2.0634, -1.5884);                           // c + 2,5·(cos 0,6, sin 0,6)
  const e2 = vec2(-2.5, -3.0);
  const arc = mix(abs(length(d).sub(2.5)), min(length(q.sub(e1)), length(q.sub(e2))), gap);
  const stem = min(segD(q, e1, vec2(0.0, 0.4)), segD(q, vec2(0.0, 0.4), vec2(0.0, 1.4)));
  return min(min(arc, stem).sub(0.75), length(q.sub(vec2(0.0, 3.7))).sub(0.95));
}
function glyphBang(q) {
  const bar = length(q.sub(vec2(0.0, clamp(q.y, -5.6, 1.0)))).sub(0.85);
  return min(bar, length(q.sub(vec2(0.0, 3.7))).sub(1.0));
}

// Znak przejścia nad miejscem przejścia (pionowo na ekranie, `lift` = nad obrysem kadłuba — kadłub z nakładki 2D leży nad
// warstwą 3D i zakrywał znak) i krótki błysk: ev = (wiek, kierunek, kąt, promień przejścia). `kind` 0 — kontakt („?”,
// szarość), 1 — wzrok („!”, czerwień); wyjście — sam błękitny błysk.
function crossMark(px, C, ev, pxs, kind, lift) {
  const out = vec3(0).toVar();
  const age = ev.x;
  If(age.greaterThanEqual(0.0).and(age.lessThan(2.2)), () => {
    const Pc = tv('v2', C.add(vec2(cos(ev.z), sin(ev.z)).mul(ev.w)));
    const dp = tv('v2', px.sub(Pc));
    If(length(dp).lessThan(lift.add(pxs.mul(70.0))), () => {
      const into = tv('f', step(0.0, ev.y));
      const flash = gauss(length(dp), pxs.mul(age.mul(40.0).add(10.0))).mul(exp(age.div(0.2).negate()));
      const pop = float(1.0).add(exp(age.div(0.1).negate()).mul(0.6));
      const q = tv('v2', dp.add(vec2(0.0, lift)).div(pxs.mul(1.8).mul(pop)));
      const sd = tv('f', kind === 0 ? glyphQuestion(q) : glyphBang(q));
      const gl = float(1.0).sub(smoothstep(-0.45, 0.45, sd));
      const gh = gauss(max(sd, 0.0), float(3.5)).mul(0.25);
      const ga = smoothstep(0.0, 0.06, age).mul(float(1.0).sub(smoothstep(1.3, 2.1, age))).mul(into);
      const col = kind === 0 ? mix(c3(GRAY), vec3(1.0), 0.35) : mix(c3(RED), vec3(1.0), 0.25);
      out.assign(mix(c3(BLUE), col, into).mul(flash.mul(1.5)).add(col.mul(gl.mul(1.6).add(gh)).mul(ga)));
    });
  });
  return out;
}

// Punkt piksela w ŚWIECIE względem środka koła [j.] (osie gry, po obrocie kadru): px bufora / zoom bufora (H1.z),
// obrót kadru H1.w. Wzory tafli (X-y, szum „mgły”, kreski) liczą się w świecie, skalą oktaw zoomu (`zoomOctaves`) —
// w px ekranu kręciły się przy zoomie i jechały z ruchem okrętu (zgłoszenie 2026-11-12).
function worldRel(dv, zb, roll) {
  const s = dv.div(zb);
  const c = cos(roll), sn = sin(roll);
  return tv('v2', vec2(c.mul(s.x).sub(sn.mul(s.y)), sn.mul(s.x).add(c.mul(s.y))));
}
// Szum 3D w skali `targetPx` px (przy zoomie) zakotwiczony w świecie: dwie oktawy przenikane.
function noiseOct(tex, rw, targetPx, pxs, zb, w, off) {
  const O = zoomOctaves(pxs.mul(targetPx).div(zb));
  const a = texture3D(tex, vec3(rw.div(O.s0).add(off), w)).level(0);
  const b = texture3D(tex, vec3(rw.div(O.s1).add(off + 0.29), w)).level(0);
  return tv('v4', mix(a, b, O.w1));
}

function taflaLook(B, px, noiseTex) {
  const { count, t, pxs } = header(B);
  const H1 = B.element(1);
  const zb = tv('f', max(H1.z, 1e-6));               // px bufora na j. świata
  const roll = H1.w;
  const rgb = vec3(0).toVar('tfRgb');
  const [A0, A1] = anchorAt(B, int(0));
  const S = A0.xy;
  const wNear = A1.x, wFar = A1.y;
  If(A0.w.greaterThan(0.001), () => {
    markLoop(B, int(0), count, 'tg', ({ M0, M1, M2, M3, M4 }) => {
      const C = tv('v2', M0.xy);
      const vis = tv('f', M0.w);                          // czerwona (wzrok): znam ich albo oni mnie widzą
      const Rc = tv('f', M0.z);
      const Rv = tv('f', M2.w);
      const gvis = tv('f', M3.w);                         // szara (kontakt): wykrywam ich albo oni mnie; × zlewanie
      const full = tv('v4', M4);                          // (całe koło szarej, całe koło czerwonej, „?”, przesunięcie okna szarej)
      const rate = tv('f', M2.y);
      const est = M2.x;
      const dv = tv('v2', px.sub(C));
      const r = tv('f', length(dv));
      const dS0 = tv('f', length(S.sub(C)));             // odległość mojego okrętu od środka grupy
      // ── WZROK: czerwona tafla (stoi) ──────────────────────────────────────────────────────────────────────────
      const fV = tv('f', r.sub(Rv));                      // > 0 — poza ich wzrokiem, < 0 — widzą, kto to
      If(Rv.greaterThan(1.0).and(vis.greaterThan(0.001)).and(abs(fV).lessThan(pxs.mul(95.0))), () => {
        const nrm = tv('v2', dv.div(max(r, 1.0)));
        const th = tv('f', atan(dv.y, dv.x));
        const win = tv('f', float(1.0).sub(smoothstep(wNear, wFar, length(C.add(nrm.mul(Rv)).sub(S)))));
        const prox = tv('f', float(1.0).sub(smoothstep(wNear.mul(0.35), wFar, abs(dS0.sub(Rv)))));
        const X = crossing(px, C, Rv, th, fV, M3, pxs);
        const V = tv('f', max(max(win, X.trail.mul(0.85)), full.y.mul(0.3)).mul(vis));
        // zmarszczki od punktu granicy najbliższego mnie
        const Pn = C.add(vec2(cos(M2.z), sin(M2.z)).mul(Rv));
        const dn = tv('f', length(px.sub(Pn)));
        const ripPh = tv('f', dn.div(pxs.mul(15.0)).sub(t.mul(5.0)));
        const ripK = tv('f', exp(dn.div(pxs.mul(240.0)).negate()).mul(prox));
        // szum zakotwiczony w grupie i w świecie (oktawy zoomu) — nie płynie z kamerą ani z zoomem
        const rw = worldRel(dv, zb, roll);
        const n1 = noiseOct(noiseTex, rw, 170.0, pxs, zb, t.mul(0.04), 0.37);
        const n2 = noiseOct(noiseTex, rw, 55.0, pxs, zb, t.mul(0.09), 0.31);
        const fe = tv('f', fV.add(sin(ripPh).mul(ripK).mul(pxs.mul(1.3))).add(n2.x.sub(0.5).mul(pxs.mul(1.6))));
        // linia: rdzeń + poświata; est (radar zgadnięty) — szersza, w kreskach
        const lw = tv('f', pxs.mul(mix(float(0.85), float(2.4), est)));
        // kreski ~9 px wzdłuż koła, w świecie (kąt świata × promień w j.; oktawy zoomu przenikane)
        const arcV = tv('f', atan(rw.y, rw.x).mul(Rv.div(zb)));
        const Od = zoomOctaves(pxs.mul(9.0).div(zb));
        const dashW = mix(step(0.45, fract(arcV.div(Od.s0))), step(0.45, fract(arcV.div(Od.s1))), Od.w1);
        const dash = mix(float(1.0), dashW, est);
        const core = gauss(fe, lw).mul(dash);
        const halo = gauss(fe, pxs.mul(7.0)).mul(0.2);
        // tafla po stronie wroga: kaustyka pola siłowego, gaśnie w głąb
        const sheetK = tv('f', exp(min(fV, 0.0).div(pxs.mul(26.0))).mul(step(fV, 0.0)));
        const caus = smoothstep(0.5, 0.85, n1.x.mul(0.65).add(n2.y.mul(0.35)));
        const sheet = sheetK.mul(caus.mul(0.55).add(0.1)).mul(0.3);
        const rip = smoothstep(0.7, 1.0, sin(ripPh)).mul(ripK).mul(gauss(fV, pxs.mul(8.0))).mul(0.22);
        const I = tv('f', prox.mul(0.65).add(0.35).mul(step(dS0, Rv).mul(0.25).add(1.0)));
        rgb.addAssign(mix(c3(RED), vec3(1.0), 0.3).mul(core.mul(1.4).add(halo)).mul(I).mul(V));
        rgb.addAssign(c3(RED).mul(sheet.add(rip)).mul(I).mul(win).mul(vis));
        rgb.addAssign(X.col.mul(gauss(fV, pxs.mul(3.0)).mul(2.4).add(gauss(fV, pxs.mul(12.0)).mul(0.35)).mul(X.ripple)).mul(vis));
      });
      // ── KONTAKT: szara tafla z X-ów (jedzie z moim śladem) ────────────────────────────────────────────────────
      const fC = tv('f', r.sub(Rc));
      If(gvis.greaterThan(0.001).and(abs(fC).lessThan(pxs.mul(60.0).add(abs(rate).mul(0.22)))), () => {
        const nrm = tv('v2', dv.div(max(r, 1.0)));
        const th = tv('f', atan(dv.y, dv.x));
        // okno przesunięte o `full.w`, gdy mnie namierzają — najbliższy kawałek ich granicy (droga ucieczki) zostaje widać
        const win = tv('f', float(1.0).sub(smoothstep(wNear, wFar, length(C.add(nrm.mul(Rc)).sub(S)).sub(full.w))));
        const prox = tv('f', float(1.0).sub(smoothstep(wNear.mul(0.35), wFar, abs(dS0.sub(Rc)))));
        const X = crossing(px, C, Rc, th, fC, M1, pxs);
        const V = tv('f', max(max(win, X.trail.mul(0.85)), full.x.mul(0.3)).mul(gvis));
        // X-y w komórkach ~6 px siatki ŚWIATA wokół środka grupy (oktawy zoomu z przenikaniem): przy linii gęsto, dalej
        // rzadko (szansa z odległości środka komórki od linii, px); każdy żyje 0,7–1,6 s i odradza się w innym miejscu
        // komórki — ten sam język co obłok kontaktu. Dawniej komórki w px wzdłuż łuku od punktu najbliższego mnie:
        // przy zoomie i ruchu okrętu X-y „jechały” po kole.
        const rw = worldRel(dv, zb, roll);
        const xI = tv('f', xCellsOct(rw, pxs.mul(6.0), zb, pxs, t, 41, (cw) => {
          const fc = length(cw).mul(zb).sub(Rc).div(pxs);
          return exp(fc.mul(fc).div(49.0).negate()).mul(0.85);
        }, { armBase: 1.3, armVar: 0.6, soft: false, tone: false }));
        const core = gauss(fC, pxs.mul(0.9)).mul(0.2);
        // tafla w ruchu: prążki za nią (ciąg pcha ją na mnie, cisza odsuwa)
        const sg = tv('f', step(0.0, rate).mul(2.0).sub(1.0));
        const fm = tv('f', fC.mul(sg).negate());
        const smW = tv('f', abs(rate).mul(0.07).add(pxs));
        // smugi wzdłuż koła: współrzędna łuku w świecie (kąt świata × promień w j.), skala oktawy zoomu
        const O7 = zoomOctaves(pxs.mul(7.0).div(zb));
        const arcW = tv('f', atan(rw.y, rw.x).mul(Rc.div(zb)));
        const ns = tv('v4', texture3D(noiseTex, vec3(arcW.div(O7.s0).add(0.17), fm.div(smW.mul(2.5)), t.mul(0.3))).level(0));
        const smear = step(0.0, fm).mul(exp(fm.div(smW).negate()))
          .mul(smoothstep(pxs.mul(25.0), pxs.mul(160.0), abs(rate))).mul(smoothstep(0.45, 0.8, ns.x).mul(0.8).add(0.08)).mul(0.3);
        const I = tv('f', prox.mul(0.65).add(0.35));
        rgb.addAssign(c3(GRAY).mul(xI.mul(1.5).add(core)).mul(I).mul(V));
        rgb.addAssign(c3(GRAY).mul(smear).mul(I).mul(win).mul(gvis));
        rgb.addAssign(mix(c3(BLUE), vec3(0.78, 0.8, 0.84), step(0.0, M1.y))
          .mul(gauss(fC, pxs.mul(3.0)).mul(1.8).add(xI.mul(2.0))).mul(X.ripple).mul(gvis));
      });
      // znaki przejść: „?” (kontakt) i „!” (wzrok), wyjście — błękitny błysk
      const lift = A0.z.mul(0.45).add(pxs.mul(24.0));        // pół wysokości kadłuba + odstęp
      rgb.addAssign(crossMark(px, C, M1, pxs, 0, lift).mul(full.z));
      rgb.addAssign(crossMark(px, C, vec4(M3.xyz, Rv), pxs, 1, lift).mul(vis));
    });
  });
  return rgb;
}

// Refrakcja tafli: warstwa DIST — RG = przesunięcie [px bufora, osie sceny]. Czerwona (wzrok) wyraźnie, szara słabo.
function taflaDisp(B, px) {
  const { count, t, pxs } = header(B);
  const disp = vec2(0).toVar('tfDisp');
  const [A0, A1] = anchorAt(B, int(0));
  const S = A0.xy;
  If(A0.w.greaterThan(0.001), () => {
    markLoop(B, int(0), count, 'td', ({ M0, M1, M2, M3 }) => {
      const C = tv('v2', M0.xy);
      const vis = tv('f', M0.w);
      const Rc = tv('f', M0.z);
      const Rv = tv('f', M2.w);
      const dv = tv('v2', px.sub(C));
      const r = tv('f', length(dv));
      const dS0 = tv('f', length(S.sub(C)));
      const fV = tv('f', r.sub(Rv));
      If(Rv.greaterThan(1.0).and(abs(fV).lessThan(pxs.mul(70.0))).and(vis.greaterThan(0.001)), () => {
        const nrm = tv('v2', dv.div(max(r, 1.0)));
        const th = tv('f', atan(dv.y, dv.x));
        const win = tv('f', float(1.0).sub(smoothstep(A1.x, A1.y, length(C.add(nrm.mul(Rv)).sub(S)))));
        const prox = tv('f', float(1.0).sub(smoothstep(A1.x.mul(0.35), A1.y, abs(dS0.sub(Rv)))));
        const X = crossing(px, C, Rv, th, fV, M3, pxs);
        // brzeg szyby: −x·e^(−x²) rozsuwa obraz po obu stronach linii
        const xl = tv('f', fV.div(pxs.mul(12.0)));
        const lens = xl.negate().mul(exp(xl.mul(xl).negate()));
        const amp = pxs.mul(6.0).mul(win.mul(prox.mul(0.6).add(0.4)).add(X.trail.mul(0.5)));
        const along = nrm.mul(lens.mul(amp).add(gauss(fV, pxs.mul(14.0)).mul(X.ripple).mul(pxs.mul(7.0))));
        // zmarszczki od punktu najbliższego mnie
        const Pn = C.add(vec2(cos(M2.z), sin(M2.z)).mul(Rv));
        const dnv = tv('v2', px.sub(Pn));
        const dn = tv('f', length(dnv));
        const ripK = exp(dn.div(pxs.mul(240.0)).negate()).mul(prox).mul(win);
        const rip = dnv.div(max(dn, 1.0)).mul(cos(dn.div(pxs.mul(15.0)).sub(t.mul(5.0)))).mul(ripK)
          .mul(gauss(fV, pxs.mul(20.0))).mul(pxs.mul(2.2));
        const o = tv('v2', along.add(rip).mul(vis));
        disp.addAssign(vec2(o.x, o.y.negate()));
      });
      const gvis = tv('f', M3.w);
      const fC = tv('f', r.sub(Rc));
      If(gvis.greaterThan(0.001).and(abs(fC).lessThan(pxs.mul(50.0))), () => {
        const nrm = tv('v2', dv.div(max(r, 1.0)));
        const th = tv('f', atan(dv.y, dv.x));
        const win = tv('f', float(1.0).sub(smoothstep(A1.x, A1.y, length(C.add(nrm.mul(Rc)).sub(S)))));
        const X = crossing(px, C, Rc, th, fC, M1, pxs);
        const xl = tv('f', fC.div(pxs.mul(9.0)));
        const lens = xl.negate().mul(exp(xl.mul(xl).negate()));
        const o = tv('v2', nrm.mul(lens.mul(pxs.mul(2.5)).mul(win).add(gauss(fC, pxs.mul(10.0)).mul(X.ripple).mul(pxs.mul(4.0)))).mul(gvis));
        disp.addAssign(vec2(o.x, o.y.negate()));
      });
    });
  });
  return disp;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. PRZYBÓJ
function przybojLook(B, px, noiseTex) {
  const { count, t, pxs } = header(B);
  const rgb = vec3(0).toVar('pbRgb');
  const [A0, A1] = anchorAt(B, int(0));
  const S = A0.xy, shipR = A0.z;
  const wNear = A1.x, wFar = A1.y, lam = A1.z, vel = A1.w;
  If(A0.w.greaterThan(0.001), () => {
    markLoop(B, int(0), count, 'pg', ({ M0, M1, M2 }) => {
      const C = tv('v2', M0.xy);
      const R = tv('f', M0.z);
      const dv = tv('v2', px.sub(C));
      const r = tv('f', length(dv));
      const f = tv('f', r.sub(R));
      const dPS = tv('f', length(px.sub(S)));
      const ins = tv('f', step(length(S.sub(C)), R));
      const nearShip = dPS.lessThan(shipR.mul(3.6)).and(ins.greaterThan(0.01));
      const inBand = f.greaterThan(lam.mul(-7.5)).and(f.lessThan(lam.mul(1.3).add(pxs.mul(30.0))));
      If(inBand.or(nearShip).and(M0.w.greaterThan(0.001)), () => {
        const nrm = tv('v2', dv.div(max(r, 1.0)));
        const th = tv('f', atan(dv.y, dv.x));
        const dS = tv('f', length(C.add(nrm.mul(R)).sub(S)));
        const win = tv('f', float(1.0).sub(smoothstep(wNear, wFar, dS)));
        const gapS = tv('f', length(S.sub(C)).sub(R));
        const prox = tv('f', float(1.0).sub(smoothstep(wNear.mul(0.35), wFar, abs(gapS))));
        const q = tv('v2', dv.div(pxs));
        const nb = tv('v4', texture3D(noiseTex, vec3(q.div(260.0).add(0.37), t.mul(0.03))).level(0));
        const arcPx = tv('f', wrapAngle(th.sub(M2.z)).mul(R).div(pxs));    // px wzdłuż granicy od punktu najbliższego mnie
        const fpx = tv('f', f.div(pxs));
        const nf = tv('v4', texture3D(noiseTex, vec3(arcPx.div(46.0).add(0.53), fpx.div(14.0).add(t.mul(0.35)), t.mul(0.2))).level(0));
        // grzbiety: koła od wroga, zgięte szumem; piętrzą się (węższe, jaśniejsze) przy granicy
        const bend = tv('f', nb.x.sub(0.5).mul(lam.mul(1.1)));
        const fn = tv('f', f.add(bend));
        const P = tv('f', vel.mul(t).sub(r).sub(bend).div(lam));
        const u = tv('f', fract(P));
        const steep = tv('f', smoothstep(lam.mul(-5.0), 0.0, fn));
        const crest = max(gauss(float(1.0).sub(u), mix(float(0.1), float(0.03), steep)),
          exp(u.div(mix(float(0.2), float(0.08), steep)).negate()));
        const shipZone = exp(dPS.mul(dPS).div(shipR.mul(shipR).mul(3.0)).negate()).mul(ins);
        const waveMask = step(fn, 0.0).mul(max(win.mul(exp(fn.div(lam.mul(6.0)))), shipZone));
        const waves = crest.mul(mix(float(0.22), float(1.0), steep)).mul(waveMask).mul(0.36);
        // łamanie: kiedy ostatni grzbiet doszedł do granicy w tym miejscu → wybieg piany za granicę i powrót
        const PB = tv('f', vel.mul(t).sub(R).sub(bend).div(lam));
        const run = tv('f', fract(PB));
        const reach = tv('f', lam.mul(0.48).mul(sin(clamp(run.div(0.7), 0.0, 1.0).mul(PI))));
        const burst = exp(run.div(0.14).negate()).mul(1.2).add(0.3);
        const foamBand = smoothstep(lam.mul(-0.32), lam.mul(-0.06), f).mul(float(1.0).sub(smoothstep(reach.sub(pxs.mul(2.0)), reach.add(pxs.mul(2.0)), f)));
        // piana: gładkie smugi wzdłuż granicy + drobiny w komórkach 3 px (łuk × odległość od granicy), migoczą 9 razy na s
        const speck = tv('f', smoothstep(0.35, 0.72, nf.x.mul(0.7).add(nf.y.mul(0.45))));
        const cell = floor(vec2(arcPx.div(3.0), fpx.div(3.0)));
        const hsp = u01(hash3(uOf(cell.x.add(65536.0)), uOf(cell.y.add(65536.0)), uOf(t.mul(9.0))));
        const dots = step(float(1.0).sub(speck.mul(0.3).add(0.04)), hsp);
        const foam = foamBand.mul(speck.mul(0.28).add(0.05).add(dots.mul(0.6))).mul(burst);
        const edge = gauss(f.sub(reach), pxs.mul(1.3)).mul(float(1.0).sub(run)).mul(0.9);
        const shore = gauss(f, pxs.mul(1.0)).mul(0.3);
        const X = crossing(px, C, R, th, f, M1, pxs);
        const I = tv('f', prox.mul(0.6).add(0.4).mul(ins.mul(0.2).add(1.0)).mul(M0.w));
        const V = tv('f', max(win, X.trail.mul(0.85)));
        rgb.addAssign(c3(RED).mul(0.85).mul(waves).mul(I));
        rgb.addAssign(mix(c3(RED), vec3(1.0), 0.32).mul(foam.add(edge).add(shore)).mul(I).mul(V));
        // przejście: piana obiega całe koło, błysk w miejscu przejścia
        const foamX = smoothstep(lam.mul(-0.5), 0.0, f).mul(float(1.0).sub(smoothstep(0.0, lam.mul(0.6), f)))
          .mul(speck.mul(0.8).add(0.25));
        rgb.addAssign(X.col.mul(foamX.mul(X.ripple).mul(2.2).add(X.flash.mul(1.6))).mul(M0.w));
      });
    });
  });
  return rgb;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. PODŚWIETLENIE — Atlas (sprite jako tekstura) oświetlony od strony grup, które mnie widzą. Wyjście premultiplied:
// rgb = kadłub × alfa + snop / poświata (addytywnie), alfa = kadłub.
const lumOf = (s) => dot(s.xyz, vec3(0.3, 0.5, 0.2)).mul(s.w);

function swiatloLook(B, px, hullTex) {
  const { count, t, pxs } = header(B);
  const out = vec4(0).toVar('swOut');
  const [A0, A1, A2] = anchorAt(B, int(0));
  const S = A0.xy, L = A0.z, hd = A0.w;
  const lod = A1.x, waveMode = A1.y, lam = A1.z, vel = A1.w;
  const d = tv('v2', px.sub(S));
  If(A2.y.greaterThan(0.001).and(length(d).lessThan(L.mul(2.8))), () => {
    const ch = tv('f', cos(hd));
    const sh = tv('f', sin(hd));
    const loc = tv('v2', vec2(d.x.mul(ch).add(d.y.mul(sh)), d.y.mul(ch).sub(d.x.mul(sh))));
    const Hh = tv('f', L.mul(A2.x));
    const uv = tv('v2', vec2(loc.x.div(L).add(0.5), loc.y.div(Hh).add(0.5)));
    const inUV = tv('f', step(0.0, uv.x).mul(step(uv.x, 1.0)).mul(step(0.0, uv.y)).mul(step(uv.y, 1.0)));
    const s0 = tv('v4', texture(hullTex, uv).level(lod));
    const a = tv('f', s0.w.mul(inUV));
    // płaskorzeźba paneli z jasności sprite'a (różnice ±1,2 px)
    const eu = tv('f', pxs.mul(1.2).div(L));
    const ev = tv('f', pxs.mul(1.2).div(Hh));
    const hR = lumOf(texture(hullTex, uv.add(vec2(eu, 0.0))).level(lod));
    const hL = lumOf(texture(hullTex, uv.sub(vec2(eu, 0.0))).level(lod));
    const hD = lumOf(texture(hullTex, uv.add(vec2(0.0, ev))).level(lod));
    const hU = lumOf(texture(hullTex, uv.sub(vec2(0.0, ev))).level(lod));
    const nrm = tv('v3', normalize(vec3(hL.sub(hR).mul(4.5), hU.sub(hD).mul(4.5), 1.0)));
    // poza prostokątem sprite'a [px]: próbki z przesunięciem gasną z odległością (zawijanie do brzegu powiela brzeg mipmapy)
    const outPx = (q) => length(max(max(q.negate(), q.sub(1.0)), vec2(0.0)).mul(vec2(L, Hh)));
    const diffAcc = vec3(0).toVar('swDiff');
    const emAcc = vec3(0).toVar('swEm');
    const spaceAcc = vec3(0).toVar('swSpace');
    markLoop(B, int(0), count, 'sl', ({ M0, M1 }) => {
      const C = M0.xy, Lk = M0.z, age = M0.w;
      const toE = tv('v2', C.sub(S));
      const ld = tv('v2', toE.div(max(length(toE), 1.0)));          // w stronę wroga (ekran)
      const ldl = tv('v2', vec2(ld.x.mul(ch).add(ld.y.mul(sh)), ld.y.mul(ch).sub(ld.x.mul(sh))));   // w układzie kadłuba
      const l3 = normalize(vec3(ldl.mul(0.97), 0.22));
      const s = tv('f', dot(d, ld));                                 // + w stronę wroga
      const near = smoothstep(L.mul(-0.5), L.mul(0.5), s);           // strona kadłuba od wroga jaśniej
      const diff = max(dot(nrm, l3), 0.0).mul(near.mul(0.8).add(0.5));
      // krawędź od strony wroga: tu kadłub, 2,6 px w stronę wroga już nie
      const uvT = tv('v2', uv.add(vec2(ldl.x.mul(eu), ldl.y.mul(ev)).mul(2.6)));
      const aT = texture(hullTex, uvT).level(lod).w.mul(step(outPx(uvT), 0.0));
      const rim = tv('f', a.mul(float(1.0).sub(aT)));
      // skan: TAFLA — linie biegną od wroga przez kadłub; PRZYBÓJ — grzbiety jego fal (te same co na ekranie)
      const phS = fract(s.add(vel.mul(t)).div(lam));
      const lineS = gauss(min(phS, float(1.0).sub(phS)).mul(lam), pxs.mul(1.1));
      const u = fract(vel.mul(t).sub(length(px.sub(C))).div(lam));
      const crestW = max(gauss(float(1.0).sub(u), float(0.05)), exp(u.div(0.14).negate()));
      const scan = mix(lineS, crestW, waveMode);
      const sweepPos = L.mul(0.75).sub(fract(t.div(1.9).add(M1.x)).mul(L.mul(1.5)));
      const sweep = gauss(s.sub(sweepPos), L.mul(0.05));
      const fl = tv('f', exp(age.div(0.28).negate()));
      diffAcc.addAssign(c3(RED).mul(diff.mul(1.9).add(fl.mul(0.5))).mul(Lk));
      emAcc.addAssign(c3(RED).mul(rim.mul(fl.mul(2.0).add(2.2)).add(scan.mul(0.5).add(sweep.mul(0.4)).mul(a))).mul(Lk));
      // snop w przestrzeni od strony wroga i poświata przy oświetlonej krawędzi (rozmyta alfa przesunięta od wroga)
      const perp = dot(d, vec2(ld.y.negate(), ld.x));
      const beam = gauss(perp, Hh.mul(1.1)).mul(smoothstep(0.0, L.mul(0.3), s)).mul(exp(s.div(L.mul(1.2)).negate()));
      const uvB = tv('v2', uv.sub(vec2(ldl.x.mul(eu), ldl.y.mul(ev)).mul(5.0)));
      const aB = texture(hullTex, uvB).level(lod.add(3.0)).w.mul(exp(outPx(uvB).div(pxs.mul(5.0)).negate()));
      spaceAcc.addAssign(c3(RED).mul(beam.mul(0.03).add(aB.mul(0.4)).mul(float(1.0).sub(a))).mul(Lk));
    });
    const base = tv('v3', s0.xyz.mul(HULL_GAIN));
    const hull = base.mul(vec3(1.0).add(diffAcc)).add(emAcc);
    out.assign(vec4(hull.mul(a).add(spaceAcc), a).mul(A2.y));
  });
  return out;
}

function placeholderTexture() {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Kwad pełnoekranowy pomysłu granicy. TAFLA ma drugi kwad na warstwie DIST (refrakcja), PODŚWIETLENIE rysuje kadłub
 *  (mieszanie premultiplied, przed efektami addytywnymi) z `hullTex` (sprite Atlasa, mipmapy). */
export function createGranicaMeshes(style, block, distLayer, hullTex = null) {
  if (!GRANICA_STYLES.includes(style)) throw new Error(`granica: nieznany pomysł ${style}`);
  const rect = uniform(new THREE.Vector4(-1, -1, 1e9, 1e9));
  const mat = baseMaterial(`GranicaWykrycia:${style}`);
  if (style === 'swiatlo') {
    const tex = hullTex || placeholderTexture();
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.fragmentNode = Fn(() => {
      const p = tv('v2', screenCoordinate.xy);
      const o = tv('v4', swiatloLook(block.node, p, tex));
      return vec4(clamp(o.xyz, vec3(0.0), vec3(48.0)), clamp(o.w, 0.0, 1.0)).mul(rectMask(rect, p));
    })();
  } else {
    const noiseTex = fxNoise.noise3D();
    mat.fragmentNode = Fn(() => {
      const p = tv('v2', screenCoordinate.xy);
      const rgb = style === 'tafla' ? taflaLook(block.node, p, noiseTex) : przybojLook(block.node, p, noiseTex);
      return vec4(clamp(rgb, vec3(0.0), vec3(48.0)).mul(rectMask(rect, p)), 0.0);
    })();
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.name = `GranicaWykrycia:${style}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = style === 'swiatlo' ? 9990 : 10002;
  mesh.layers.set(0);
  mesh.userData.rect = rect;
  let dist = null;
  if (style === 'tafla') {
    const dm = baseMaterial('GranicaWykrycia:tafla-dist');
    dm.blendSrcAlpha = THREE.OneFactor;
    dm.fragmentNode = Fn(() => {
      const p = tv('v2', screenCoordinate.xy);
      const o = taflaDisp(block.node, p);
      return vec4(clamp(o, vec2(-24.0), vec2(24.0)).mul(rectMask(rect, p)), 0.0, 0.0);
    })();
    dist = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dm);
    dist.name = 'GranicaWykrycia:tafla-dist';
    dist.frustumCulled = false;
    dist.layers.set(distLayer);
  }
  return { mesh, dist, rect };
}
