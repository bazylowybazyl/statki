// dema/kontakty-czujnikow/namiarTSL.js
//
// CZUJKA (PPM) i NAMIAR — trzecia runda (2026-11-10, plan: docs/PLAN-kontakt-czujnikow.md § 6). Słowa użytkownika:
// „w grze gracz będzie klikał PPM i wtedy pojawi się czujka radaru … do ciał niebieskich będzie błona, a do
// technologicznych struna … błona jest 360 stopni, struna w stronę, w którą pokazuje myszka gracz”.
//  STRUNA — jeden gładki łuk przy MOIM okręcie, obraca się za myszką (kierunek celowania). Drga tym mocniej, im silniejszy
//     sygnał technologiczny w tym kierunku (Σ dopasowanie kąta × `me` grup) — w pustym kierunku prawie nie drgnie. Na łuku,
//     w miejscu wskazującym grupę, struna wybija się w KOLCE (trójkąty z samej linii) w stronę grupy: ile wrogów, tyle trójkątów, mały = statek, duży =
//     budowla; duże w środku, mniejsze na boki (gromada rośnie ku środkowi — „strzałka” w stronę grupy). Bez pękania.
//     Wykrycie (grupa w namiarze ma `them` ≥ 1): struna i trójkąty czerwienieją, nad gromadą „!” (oko przy kursorze
//     rysuje nakładka 2D). Radar zgadnięty (`est`) — trójkąty puste, słabsze.
//  BŁONA — jedna zamknięta, organiczna błona 360° wokół MOJEGO okrętu (język OBŁOKU): po PPM nadyma się i pokazuje
//     wszystkie ciała niebieskie układu — w stronę każdego wybrzuszenie, tym większe, im bliżej (szersze dla większego
//     ciała), zabarwione rodzajem ciała (skalista, gazowy olbrzym, lodowa / wodna, gwiazda). Impuls PPM — fala w kształcie
//     błony i refrakcja (warstwa DIST).
//  WACHLARZ (druga runda, do porównania) — jeden na okręt: przy mnie niebieski z `me`, przy wrogu czerwony z `them`.
//
// Wszystko w px ekranu (stały rozmiar na ekranie, jak nakładka 2D): kwad pełnoekranowy, addytywnie, jedna funkcja na piksel
// nad blokiem `uniformArray` `namiarCzujnikow`:
//   nagłówek: H0 = (znaczników, czas, px bufora na px CSS, kotwic), H1 = (bufor W, H, —, —)
//   kotwice = mój okręt (≤ NAMIAR_ANCH, 4 × vec4):
//     STRUNA: A0 = (sx, sy, promień łuku, kierunek celowania), A1 = (pół kąta, amplituda [px], τ, widoczność),
//             A2 = (wykrycie 0..1, pierwsza gromada, gromad, bogactwo harmonicznych 0..1), A3 = (ziarno, —, —, —)
//     BŁONA:  A0 = (sx, sy, promień bazowy, ślad), A1 = (pierwsze ciało, ciał, ziarno, widoczność), A2 = (wiek impulsu, —, —, —)
//   znaczniki (≤ NAMIAR_MARKS, 4 × vec4):
//     STRUNA (gromada trójkątów): M0 = (kąt grupy względem celowania, budowli, statków, wyłonienie 0..1),
//             M1 = (wykrycie 0..1, est, ziarno, błysk „!” 1 → 0)
//     BŁONA (ciało niebieskie): M0 = (kierunek, bliskość 0..1, szerokość [rad], wyłonienie ze sprężyną), M1 = (rodzaj, ziarno)
//     WACHLARZ: M0 = (sx, sy, r0, kierunek), M1 = (ułamek, est, ziarno, strona), M2 = (rozbłysk, —, —, —), M3 = (limit kąta)
// Współrzędne: px bufora, y od góry, kąt jak canvas `arc`. Stan (celowanie, amplituda ze szarpnięciem, τ, wyłonienia,
// wykrycie, sprężyny) liczy CPU po stronie widoku — w shaderze same formuły.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, screenCoordinate, positionGeometry,
  exp, sin, cos, atan, length, sqrt, mix, smoothstep, clamp, max, min, abs, fract, floor, step, texture3D, dot
} from 'three/tsl';
import { fxNoise } from '../../src/3d/fx/noise.js';
import { tv, u01, uOf, hash3 } from './kontaktyTSL.js';

export const NAMIAR_STYLES = Object.freeze(['wachlarz', 'struna', 'blona']);
export const NAMIAR_HDR = 2;
export const NAMIAR_ANCH = 6;
export const NAMIAR_ANCH_VEC = 4;
export const NAMIAR_MARKS = 32;
export const NAMIAR_MARK_BASE = NAMIAR_HDR + NAMIAR_ANCH_VEC * NAMIAR_ANCH;
export const NAMIAR_MARK_VEC = 5;     // 5 × vec4 na znacznik (piąty — granica wykrycia: wiedza obustronna)
/** Wachlarz w px CSS: łuków, odstęp, pół szerokości [rad], grubość. Trójkąty struny [px CSS]: pół podstawy i wysokość
 *  (statek / budowla), odstęp, uniesienie nad struną. */
export const NAMIAR_GEOM = Object.freeze({
  N: 7, GAP: 11, HALF: 0.3, LW: 2.2,
  TRI_SHIP: [4.6, 9.0], TRI_BASE: [8.5, 16.5], TRI_GAP: 7.0, TRI_LIFT: 3.0
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

function anchorAt(B, ai) {
  const b = ai.mul(NAMIAR_ANCH_VEC).add(NAMIAR_HDR);
  return [tv('v4', B.element(b)), tv('v4', B.element(b.add(1))), tv('v4', B.element(b.add(2))), tv('v4', B.element(b.add(3)))];
}

function markLoop(B, start, end, name, body) {
  Loop({ start, end, type: 'int', condition: '<', name }, (o) => {
    const base = o[name].mul(NAMIAR_MARK_VEC).add(NAMIAR_MARK_BASE);
    body({
      M0: tv('v4', B.element(base)),
      M1: tv('v4', B.element(base.add(1))),
      M2: tv('v4', B.element(base.add(2))),
      M3: tv('v4', B.element(base.add(3))),
      get M4() { return tv('v4', B.element(base.add(4))); }
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
// 2. STRUNA — czujka kierunkowa. Trójkąty grup to KOLCE samej struny (szkic użytkownika 2026-11-10: linia w miejscu grupy
//    wybija się w ostry ząb na zewnątrz i wraca) — wyrastają ze struny przy wyłonieniu (wysokość od 0, podstawa się
//    rozszerza), jadą z jej drganiem; duże (budowla) w środku gromady, małe (statki) na boki.
const STR_F = [0.9, 1.97, 3.13];                       // [Hz w czasie τ] niewspółmierne
const STR_TRAIL = [[0.0, 1.0], [0.024, 0.22]];         // ślad luminoforu: opóźnienie τ, jasność

function strunaLook(B, px) {
  const { t, pxs, anchors } = header(B);
  const G = NAMIAR_GEOM;
  const rgb = vec3(0).toVar('stRgb');
  Loop({ start: int(0), end: anchors, type: 'int', condition: '<', name: 'sa' }, ({ sa }) => {
    const [A0, A1, A2, A3] = anchorAt(B, sa);
    const vis = A1.w;
    const d = tv('v2', px.sub(A0.xy));
    const r = tv('f', length(d));
    const rs = A0.z, H = A1.x;
    If(vis.greaterThan(0.001).and(abs(r.sub(rs)).lessThan(pxs.mul(62.0))), () => {
      const dA = tv('f', wrapAngle(atan(d.y, d.x).sub(A0.w)));
      const a = tv('f', abs(dA));
      If(a.lessThan(H.add(pxs.mul(16.0).div(rs))), () => {
        const s = tv('f', clamp(dA.add(H).div(H.mul(2.0)), 0.0, 1.0));
        const arcLen = tv('f', H.mul(2.0).mul(rs));
        const amp = A1.y, tau = A1.z, harm = A2.w, seed = A3.x;
        const det = tv('f', A2.x);
        const aN = [tv('f', amp), tv('f', amp.mul(0.42).mul(harm)), tv('f', amp.mul(0.22).mul(smoothstep(0.5, 1.0, harm)))];
        const ph = STR_F.map((_, n) => tv('f', seed.mul(2.399 * (n + 1) * 2.0).add(n * 1.3)));
        const sPi = tv('f', s.mul(PI));
        const mW = STR_F.map((_, n) => tv('f', sin(sPi.mul(n + 1))));
        const dW = STR_F.map((_, n) => tv('f', cos(sPi.mul(n + 1)).mul((n + 1) * PI).div(arcLen)));
        const c0 = STR_F.map((_, n) => tv('f', cos(tau.mul(STR_F[n] * TAU).add(ph[n]))));
        let y0 = float(0);
        for (let n = 0; n < STR_F.length; n++) y0 = y0.add(aN[n].mul(mW[n]).mul(c0[n]));
        const yv0 = tv('f', y0);
        // ── kolce: profil „namiotu” na strunie w miejscu każdego trójkąta gromady ─────────────────────────────────
        const bump = float(0).toVar();
        const dbump = float(0).toVar();
        const near = float(0).toVar();
        const estAt = float(0).toVar();
        const first = int(A2.y);
        markLoop(B, first, first.add(int(A2.z)), 'sg', ({ M0, M1 }) => {
          const rev = M0.w;
          const sc = tv('f', M0.x.add(H).div(H.mul(2.0)));            // środek gromady na łuku (0..1)
          const nB = M0.y, nS = M0.z;
          const ntot = tv('f', nB.add(nS));
          const reach = nB.mul(G.TRI_BASE[0] * 2 + G.TRI_GAP).add(nS.mul(G.TRI_SHIP[0] * 2 + G.TRI_GAP)).mul(0.5).add(26.0).mul(pxs);
          If(rev.greaterThan(0.001).and(abs(s.sub(sc)).mul(arcLen).lessThan(reach)), () => {
            const posR = float(0).toVar(), posL = float(0).toVar();
            const lastR = float(0).toVar(), lastL = float(0).toVar();
            const maxH = float(0).toVar();
            Loop({ start: int(0), end: int(ntot), type: 'int', condition: '<', name: 'tj' }, ({ tj }) => {
              const jf = tv('f', float(tj));
              const big = tv('f', step(jf.add(0.5), nB));                   // budowle w środku, statki na boki
              const hb = tv('f', mix(float(G.TRI_SHIP[0]), float(G.TRI_BASE[0]), big).mul(pxs));
              const hh = tv('f', mix(float(G.TRI_SHIP[1]), float(G.TRI_BASE[1]), big).mul(pxs));
              const isFirst = tv('f', step(jf, 0.5));
              const odd = tv('f', fract(jf.mul(0.5)).mul(2.0));
              const right = tv('f', odd.mul(float(1.0).sub(isFirst)));
              const left = tv('f', float(1.0).sub(odd).mul(float(1.0).sub(isFirst)));
              const gp = pxs.mul(G.TRI_GAP);
              posR.addAssign(right.mul(lastR.add(hb).add(gp)));
              posL.addAssign(left.mul(lastL.add(hb).add(gp)));
              const off = tv('f', right.mul(posR).sub(left.mul(posL)));
              lastR.assign(mix(lastR, hb, right.add(isFirst)));
              lastL.assign(mix(lastL, hb, left.add(isFirst)));
              // wyrastanie po kolei od środka, z przerzutem; lekka fala wielkości biegnie ku środkowi
              const pop = tv('f', smoothstep(jf.div(ntot.add(3.0)), jf.add(3.0).div(ntot.add(3.0)), rev));
              const breathe = sin(t.mul(3.2).sub(abs(off).div(pxs.mul(9.0)))).mul(0.06).add(1.0);
              const sz = tv('f', pop.mul(sin(pop.mul(PI)).mul(0.22).add(1.0)).mul(breathe));
              const sj = tv('f', sc.add(off.div(arcLen)));
              const inArc = tv('f', step(0.0, sj).mul(step(sj, 1.0)));
              const da = tv('f', s.sub(sj).mul(arcLen));                   // px wzdłuż łuku od osi kolca
              const hbj = tv('f', hb.mul(sz.mul(0.45).add(0.55)));         // podstawa rośnie razem z wysokością
              const hj = tv('f', hh.mul(sz).mul(inArc));
              const inside = tv('f', step(abs(da), hbj));
              bump.addAssign(hj.mul(max(float(1.0).sub(abs(da).div(hbj)), 0.0)));
              dbump.addAssign(hj.div(hbj).mul(inside).mul(float(1.0).sub(step(0.0, da).mul(2.0))));
              near.assign(max(near, inside.mul(inArc).mul(step(0.02, sz))));
              estAt.assign(max(estAt, M1.y.mul(inside).mul(inArc)));
              maxH.assign(max(maxH, hh.mul(pop)));
            });
            // „!” nad gromadą, pionowo na ekranie; błysk przy wykryciu
            const gdet = M1.x;
            If(gdet.greaterThan(0.01), () => {
              const scc = tv('f', clamp(sc, 0.0, 1.0));
              const thc = A0.w.add(scc.mul(2.0).sub(1.0).mul(H));
              let yc = float(0);
              for (let n = 0; n < STR_F.length; n++) yc = yc.add(aN[n].mul(sin(scc.mul(PI * (n + 1)))).mul(c0[n]));
              const pE = A0.xy.add(vec2(cos(thc), sin(thc)).mul(rs.add(yc).add(maxH).add(pxs.mul(G.TRI_LIFT + 15.0))));
              const fl = M1.w;
              const qg = tv('v2', px.sub(pE).div(pxs.mul(fl.mul(0.7).add(1.4))));
              const bar = length(qg.sub(vec2(0.0, clamp(qg.y, -6.5, 1.2)))).sub(1.55);
              const dotg = length(qg.sub(vec2(0.0, 5.2))).sub(1.75);
              const sd = tv('f', min(bar, dotg));
              const glyph = float(1.0).sub(smoothstep(-0.6, 0.6, sd));
              const gh = gauss(max(sd, 0.0), float(4.5)).mul(0.32);
              const pulse = sin(t.mul(6.0).add(seed.mul(5.0))).mul(0.14).add(0.86);
              rgb.addAssign(mix(c3(RED), vec3(1.0), fl.mul(0.4)).mul(glyph.mul(1.7).add(gh)).mul(gdet).mul(pulse).mul(vis).mul(fl.mul(1.2).add(1.0)));
            });
          });
        });
        // ── kreska: drganie + kolce, ślad luminoforu ───────────────────────────────────────────────────────────────
        const offs = tv('f', r.sub(rs));
        const wl = tv('f', pxs.mul(0.82));
        const core = float(0).toVar();
        const glow = float(0).toVar();
        for (let q = 0; q < STR_TRAIL.length; q++) {
          let y = float(0), sl = float(0);
          if (q === 0) {
            y = yv0;
            for (let n = 0; n < STR_F.length; n++) sl = sl.add(aN[n].mul(dW[n]).mul(c0[n]));
          } else {
            const tq = tv('f', tau.sub(STR_TRAIL[q][0]));
            for (let n = 0; n < STR_F.length; n++) {
              const c = tv('f', cos(tq.mul(STR_F[n] * TAU).add(ph[n])));
              y = y.add(aN[n].mul(mW[n]).mul(c));
              sl = sl.add(aN[n].mul(dW[n]).mul(c));
            }
          }
          const yv = tv('f', y.add(bump));
          const slv = tv('f', sl.add(dbump));
          const dist = tv('f', abs(offs.sub(yv)).div(sqrt(slv.mul(slv).add(1.0))));
          core.addAssign(gauss(dist, wl).mul(STR_TRAIL[q][1]));
          if (q === 0) glow.addAssign(gauss(dist, wl.mul(5.0)));
        }
        const e = pxs.mul(1.2).div(rs);
        const endMask = tv('f', float(1.0).sub(smoothstep(H.sub(e), H.add(e), a)));
        // radar zgadnięty — kolce w kreskach
        const dashA = step(0.42, fract(s.mul(arcLen).div(pxs.mul(4.0))));
        const estMask = mix(float(1.0), dashA.mul(0.75).add(0.1), estAt);
        const sig = clamp(amp.div(pxs.mul(6.0)), 0.0, 1.0);
        const col = tv('v3', mix(c3(BLUE), c3(RED), det));
        const I = tv('f', sig.mul(0.4).add(0.66).add(det.mul(0.2)).mul(near.mul(0.3).add(1.0)).mul(vis));
        rgb.addAssign(col.mul(core.mul(I).add(glow.mul(I).mul(0.12))).mul(endMask).mul(estMask));
        // słabe wypełnienie kolca — ząb czyta się jako kształt
        const vv = offs.sub(yv0);
        const fillT = step(0.0, vv).mul(step(vv, bump)).mul(near).mul(mix(float(0.09), float(0.03), estAt));
        rgb.addAssign(col.mul(fillT).mul(vis));
        // węzły na końcach
        const pd2 = offs.mul(offs).add(a.sub(H).mul(rs).mul(a.sub(H).mul(rs)));
        rgb.addAssign(col.mul(exp(pd2.div(pxs.mul(2.0).mul(pxs.mul(2.0))).negate()).mul(1.1).mul(vis)));
      });
    });
  });
  return rgb;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. BŁONA — ciała niebieskie, 360°
const TINTS = [[1.0, 0.48, 0.2], [0.95, 0.7, 0.34], [0.3, 0.82, 1.0], [1.0, 0.84, 0.4]];   // skalista, gazowa, lodowa/wodna, gwiazda
const tintOf = (i) => mix(mix(c3(TINTS[0]), c3(TINTS[1]), step(0.5, i)), mix(c3(TINTS[2]), c3(TINTS[3]), step(2.5, i)), step(1.5, i));

function blonaLook(B, px, noiseTex) {
  const { t, pxs, anchors } = header(B);
  const rgb = vec3(0).toVar('blRgb');
  Loop({ start: int(0), end: anchors, type: 'int', condition: '<', name: 'ba' }, ({ ba }) => {
    const [A0, A1, A2] = anchorAt(B, ba);
    const vis = A1.w;
    const d = tv('v2', px.sub(A0.xy));
    const r = tv('f', length(d));
    const Rb0 = A0.z, sig = A0.w, aSeed = A1.z, ping = A2.x;
    If(vis.greaterThan(0.001).and(r.lessThan(Rb0.mul(3.0).add(pxs.mul(660.0)))), () => {
      const th = tv('f', atan(d.y, d.x));
      const Rb = tv('f', Rb0.mul(smoothstep(0.0, 1.0, vis).mul(0.28).add(0.72)));     // nadyma się po PPM
      const sumB = float(0).toVar();
      const sumD = float(0).toVar();
      const tintAcc = vec3(0).toVar();
      const tintW = float(0).toVar();
      const tipW = float(0).toVar();
      const first = int(A1.x);
      markLoop(B, first, first.add(int(A1.y)), 'bp', ({ M0, M1 }) => {
        const da = tv('f', wrapAngle(th.sub(M0.x)));
        const c = M0.y, sg = M0.z, rev = M0.w;
        const sg2 = tv('f', sg.mul(sg));
        const w = tv('f', exp(da.mul(da).div(sg2).negate()));
        const hgt = tv('f', Rb.mul(c.mul(c).mul(0.6).add(0.18)).mul(rev));
        sumB.addAssign(hgt.mul(w));
        sumD.addAssign(hgt.mul(w).mul(da.mul(-2.0).div(sg2)));
        const k = tv('f', w.mul(clamp(rev, 0.0, 1.0)).mul(c.mul(0.7).add(0.3)));
        tintAcc.addAssign(tintOf(M1.x).mul(k));
        tintW.addAssign(k);
        tipW.assign(max(tipW, gauss(da, sg.mul(0.6)).mul(clamp(rev, 0.0, 1.0)).mul(c.mul(0.6).add(0.4))));
      });
      const q = tv('v2', d.div(pxs));
      const n1 = tv('v4', texture3D(noiseTex, vec3(q.div(420.0).add(aSeed), t.mul(0.025))).level(0));
      const n2 = tv('v4', texture3D(noiseTex, vec3(q.div(140.0).add(0.37), t.mul(0.05))).level(0));
      const Rm = tv('f', Rb.add(sumB));
      const wob = n1.x.sub(0.5).mul(Rb.mul(0.06)).add(n2.y.sub(0.5).mul(Rb.mul(0.025)));
      const slope = tv('f', sqrt(sumD.div(max(r, Rb.mul(0.7))).mul(sumD.div(max(r, Rb.mul(0.7)))).add(1.0)));
      const F = tv('f', r.sub(Rm).sub(wob).div(slope));     // ≈ odległość od brzegu błony [px bufora]; < 0 — w środku
      const tint = tv('v3', tintAcc.div(max(tintW, 1e-4)));
      const col = tv('v3', mix(c3(BLUE), tint, clamp(tintW, 0.0, 1.0).mul(0.7)));
      const lum = tv('f', clamp(sig.mul(0.42).add(0.58), 0.45, 1.3).mul(vis));    // ślad: cisza przygasza, ciąg rozjaśnia
      // brzeg: miękka linia, jasność faluje wzdłuż (kłęby, nie kreska z lampy), wierzchołki wybrzuszeń jaśniejsze
      const rim = tv('f', gauss(F, pxs.mul(1.9)));
      const rimVar = tv('f', n2.x.add(n1.y.mul(0.5)).add(0.15));
      const inside = tv('f', step(F, 0.0));
      const fillK = tv('f', exp(min(F, 0.0).div(Rb.mul(0.34))));
      const cloud = tv('f', smoothstep(0.28, 0.86, n1.y.mul(0.6).add(n2.x.mul(0.4))));
      const body = fillK.mul(fillK).mul(inside).mul(cloud.mul(0.16).add(0.012));
      const soft = gauss(F.add(pxs.mul(13.0)), pxs.mul(8.0)).mul(n1.x.mul(0.5).add(0.1)).mul(0.2).mul(inside);
      const bands = smoothstep(0.86, 1.0, sin(q.y.mul(0.55).sub(t.mul(9.0)).add(n2.y.mul(6.0)))).mul(cloud).mul(fillK).mul(inside).mul(0.09);
      const pc = floor(q.div(1.5));
      const speck = step(float(1.0).sub(fillK.mul(fillK).mul(inside).mul(0.006)), u01(hash3(uOf(pc.x.add(4096.0)), uOf(pc.y.add(4096.0)), uOf(t.mul(24.0))))).mul(0.7);
      const outK = exp(max(F, 0.0).div(pxs.mul(15.0)).negate()).mul(float(1.0).sub(inside));
      const haze = outK.mul(n2.y.mul(0.9).add(0.05)).mul(0.15).mul(tipW.mul(1.5).add(1.0));
      const rimI = rim.mul(rimVar).mul(tipW.mul(1.3).add(0.9));
      rgb.addAssign(col.mul(rimI.add(body).add(soft).add(bands).add(haze).add(speck)).mul(lum));
      // impuls PPM: fala w kształcie błony biegnie na zewnątrz
      const Rr = pxs.mul(float(1.0).sub(exp(ping.div(0.35).negate())).mul(620.0));
      const ring = gauss(F.sub(Rr), pxs.mul(ping.mul(10.0).add(2.0))).mul(exp(ping.div(0.3).negate())).mul(0.9).mul(step(ping, 1.4));
      const flare = rim.mul(exp(ping.div(0.18).negate())).mul(2.2);
      rgb.addAssign(mix(c3(BLUE), vec3(1.0), 0.25).mul(ring.add(flare)).mul(step(0.0, ping)));
    });
  });
  return rgb;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Refrakcja impulsu PPM (BŁONA): warstwa DIST Core3D — RG = przesunięcie [px bufora, osie sceny].
function pingDisp(B, px) {
  const { pxs, anchors } = header(B);
  const disp = vec2(0).toVar('pgDisp');
  Loop({ start: int(0), end: anchors, type: 'int', condition: '<', name: 'pa' }, ({ pa }) => {
    const [A0, A1, A2] = anchorAt(B, pa);
    const age = A2.x;
    If(age.greaterThan(0.0).and(age.lessThan(1.2)).and(A1.w.greaterThan(0.001)), () => {
      const dp = tv('v2', px.sub(A0.xy));
      const rp = tv('f', length(dp));
      const Rr = A0.z.add(pxs.mul(float(1.0).sub(exp(age.div(0.35).negate())).mul(620.0)));
      const amp = pxs.mul(9.0).mul(exp(age.div(0.45).negate())).mul(gauss(rp.sub(Rr), pxs.mul(age.mul(16.0).add(9.0))));
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

/** Kwad pełnoekranowy propozycji (addytywnie, warstwa 0); BŁONA ma drugi kwad na warstwie DIST (`dist` — refrakcja impulsu). */
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
  if (style === 'blona') {
    // warstwa DIST: przesunięcie [px bufora, osie sceny] w RG, B = A = 0 (aberracja barw z „uber”), addytywnie
    const dm = baseMaterial('NamiarCzujnikow:blona-dist');
    dm.blendSrcAlpha = THREE.OneFactor;
    dm.fragmentNode = Fn(() => {
      const p = tv('v2', screenCoordinate.xy);
      const o = pingDisp(block.node, p);
      return vec4(clamp(o, vec2(-24.0), vec2(24.0)).mul(rectMask(rect, p)), 0.0, 0.0);
    })();
    dist = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dm);
    dist.name = 'NamiarCzujnikow:blona-dist';
    dist.frustumCulled = false;
    dist.layers.set(distLayer);
  }
  return { mesh, dist, rect };
}

// pomocniki wspólne z granicą wykrycia (granicaTSL.js)
export { header, anchorAt, markLoop, baseMaterial, rectMask, gauss, wrapAngle, c3, BLUE, RED, PI, TAU };
