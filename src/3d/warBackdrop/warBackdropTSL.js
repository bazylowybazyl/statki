// src/3d/warBackdrop/warBackdropTSL.js — BITWA W GŁĘBI (scena „Wojna”, 2026-10-19): grafy TSL obrazu (raz na rodzaj).
//
// Cztery grafy, każdy budowany RAZ (zasada żelazna 4) i dzielony przez siatki pasma tła (warstwa 1) i pierwszego planu
// (warstwa 2) — obie rysuje kamera perspektywy Core3D, więc głębia daje paralaksę i skalę:
//   • KADŁUBY (`buildHullGraph`): kwad kadłuba z atlasu sprite'ów (alfa → pokrycie MSAA), kawałek rozpadu = ten sam kwad
//     z maską (pas poprzeczny z poszarpanym brzegiem, strona linii cięcia), żarzące się brzegi, ogień i osmalenie przy
//     uszkodzeniu, mgiełka głębi; zapis głębi (okręty zasłaniają się i planetę).
//   • POŚWIATY (`buildGlowGraph`, addytywnie): pióropusze dysz za rufą, myśliwce (kropka ze smugą) — co klatkę z CPU.
//   • ZDARZENIA (`buildEventGraph`, addytywnie): pierścień zdarzeń z narodzinami — smugi strzałów z błyskiem trafienia,
//     błyski (ogień, śmierć, warp, ładowanie, tarcza), fale, odłamki, wielkie wiązki, smugi przylotu z warpa; ruch
//     liczy GPU z zegara sceny (`uTime`), CPU pisze tylko nowe rekordy.
//   • PLANETA (`buildPlanetGraph` + `buildAtmosphereGraph`): kula pod sceną — mapa dnia, światła miast nocą, chmury,
//     pas zmierzchu, poświata brzegu; bez świateł sceny (własny model słońca: kierunek z gry).
// Minimalna szerokość w px (smugi, kropki) — z głębokości widoku (`uPxK` = j. świata na px na j. odległości).
import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If, abs, attribute, cameraViewMatrix, clamp, cos, dot, exp, float, fwidth, length, max, min, mix,
  modelViewMatrix, normalize, positionGeometry, positionView, select, sin, smoothstep, sqrt, step, texture, uniform, uv,
  varying, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { billboardOffset } from '../tsl/billboard3D.js';
import { blendAddytywnePremul } from '../tsl/mieszanie.js';
import { fxNoise } from '../fx/noise.js';

/** Układ rekordów instancji (liczby float). */
export const WB_HULL_STRIDE = 24;
export const WB_GLOW_STRIDE = 12;
export const WB_EVENT_STRIDE = 16;

/** Rodzaje rekordów pierścienia zdarzeń. */
export const WB_EVK = Object.freeze({ SHOT: 0, FLASH: 1, RING: 2, DEBRIS: 3, BEAM: 4, STREAK: 5 });

/** Wspólne uniformy grafów (jeden zestaw na obraz). */
export function createWarBackdropUniforms() {
  return {
    uTime: uniform(0),
    uPxK: uniform(0.001),
    uMinPx: uniform(1.4),
    uShade: uniform(0.92),
    uHaze: uniform(new THREE.Color(0.035, 0.05, 0.08)),
    uFxGain: uniform(1.0),
    uSunDir: uniform(new THREE.Vector3(1, 0, 0.12)),
    uSun: uniform(1.15),
    uCity: uniform(1.6),
    uCloud: uniform(0.75),
    uCloudShift: uniform(0),
    uRim: uniform(0.9),
    uAtmo: uniform(1.2)
  };
}

// ── KADŁUBY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Rekord (24 liczby): h0 = x, y, z, kąt (scena: y = −y gry, kąt = −kąt gry); h1 = pół długości, pół szerokości,
 * środek kawałka (lokalnie, ułamki, oś y sceny); h2 = uv0, rozmiar uv w atlasie; h3 = granice pasa b0, b1 (ułamki pół
 * długości), ziarna brzegów s0, s1; h4 = strona cięcia (−1, 0, 1), kąt cięcia (względem kadłuba, układ gry), żar
 * brzegów, krycie; h5 = błysk trafienia, ogień, mgiełka głębi, ziarno.
 */
export function buildHullGraph(U, atlasTex) {
  const h0 = attribute('wbH0', 'vec4');
  const h1 = attribute('wbH1', 'vec4');
  const h2 = attribute('wbH2', 'vec4');
  const h3 = attribute('wbH3', 'vec4');
  const h4 = attribute('wbH4', 'vec4');
  const h5 = attribute('wbH5', 'vec4');
  const local = positionGeometry.xy;
  const off = local.sub(h1.zw).mul(h1.xy);
  const c = cos(h0.w);
  const s = sin(h0.w);
  const positionNode = vec3(h0.x.add(off.x.mul(c)).sub(off.y.mul(s)), h0.y.add(off.x.mul(s)).add(off.y.mul(c)), h0.z);
  const uvAtlas = h2.xy.add(vec2(local.x.mul(0.5).add(0.5), float(0.5).sub(local.y.mul(0.5))).mul(h2.zw));
  const vLocal = varying(local, 'vWbHLocal');
  const vUv = varying(uvAtlas, 'vWbHUv');
  const vHalf = varying(h1.xy, 'vWbHHalf');
  const vCut = varying(h3, 'vWbHCut');
  const vSide = varying(h4, 'vWbHSide');
  const vLook = varying(h5, 'vWbHLook');
  const noiseTex = fxNoise.tile2D();
  const fragmentNode = Fn(() => {
    const hl = vHalf.x;
    const hw = vHalf.y;
    const lu = vLocal.x;
    const lv = vLocal.y.negate();
    const px = lu.mul(hl);
    const py = lv.mul(hw);
    // pochodne przed gałęziami (pułapka 15)
    const pxW = fwidth(px).toVar();
    const tex = texture(atlasTex, vUv).toVar();
    // pasy poprzeczne z poszarpanym brzegiem (ziarna s0 / s1 — ten sam brzeg dla sąsiednich kawałków)
    const s0 = vCut.z;
    const s1 = vCut.w;
    const jag0 = sin(lv.mul(6.3).add(s0)).mul(0.07).add(sin(lv.mul(15.1).add(s0.mul(1.7))).mul(0.045)).add(sin(lv.mul(37.0).add(s0.mul(2.3))).mul(0.02));
    const jag1 = sin(lv.mul(6.3).add(s1)).mul(0.07).add(sin(lv.mul(15.1).add(s1.mul(1.7))).mul(0.045)).add(sin(lv.mul(37.0).add(s1.mul(2.3))).mul(0.02));
    const e0 = lu.sub(vCut.x.add(jag0)).mul(hl);
    const e1 = vCut.y.add(jag1).sub(lu).mul(hl);
    // linia cięcia (wiązka): odległość ze znakiem w j. świata, brzeg poszarpany
    const side = vSide.x;
    const ca = cos(vSide.y);
    const sa = sin(vSide.y);
    const along = px.mul(ca).add(py.mul(sa));
    const sd = py.mul(ca).sub(px.mul(sa)).add(sin(along.mul(0.011).add(vLook.w)).mul(hw.mul(0.07))).add(sin(along.mul(0.037).add(vLook.w.mul(1.9))).mul(hw.mul(0.03)));
    const cutIn = select(abs(side).lessThan(0.5), float(1.0), step(0.0, sd.mul(side)));
    const inside = step(0.0, e0).mul(step(0.0, e1)).mul(cutIn);
    const alpha = tex.a.mul(inside).mul(vSide.w);
    If(alpha.lessThan(0.02), () => { Discard(); });
    // brzegi pęknięć: żar (HDR) gasnący z wiekiem kawałka
    const big = float(1e7);
    const d0 = select(vCut.x.greaterThan(-1.2), e0, big);
    const d1 = select(vCut.y.lessThan(1.2), e1, big);
    const d2 = select(abs(side).greaterThan(0.5), abs(sd), big);
    const dEdge = min(d0, min(d1, d2));
    const edgeW = max(hl.mul(0.03), pxW.mul(1.8));
    const hot = float(1.0).sub(smoothstep(0.0, edgeW, dEdge)).mul(vSide.z);
    // ogień i osmalenie (szum w j. świata — plamy niezależne od rozmiaru kadłuba)
    const n = texture(noiseTex, vec2(px, py).mul(1.0 / 700.0).add(vec2(vLook.w.mul(0.13), vLook.w.mul(0.29)))).toVar();
    const burn = vLook.y;
    const scorch = smoothstep(float(0.62).sub(burn.mul(0.45)), 0.95, n.r).mul(burn);
    const flick = sin(U.uTime.mul(13.0).add(n.b.mul(25.0))).mul(0.25).add(0.75);
    const fire = smoothstep(float(0.86).sub(burn.mul(0.22)), 0.98, n.g).mul(burn).mul(flick);
    const base = tex.rgb.mul(U.uShade).mul(float(1.0).sub(scorch.mul(0.7)));
    const lit = base.add(vec3(3.4, 1.35, 0.35).mul(fire)).add(vec3(0.55, 0.7, 1.0).mul(vLook.x.mul(0.1)));
    const hotCol = mix(lit, vec3(4.2, 1.7, 0.45), hot);
    const col = mix(hotCol, vec3(U.uHaze), vLook.z);
    return vec4(col, clamp(alpha, 0.0, 1.0));
  })();
  return { positionNode, fragmentNode };
}

// ── POŚWIATY (dysze, myśliwce) ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Rekord (12 liczb): g0 = x, y, z, rodzaj (0 — pióropusz dyszy, 1 — myśliwiec); g1 = kierunek ruchu (scena, xy),
 * długość, szerokość; g2 = barwa HDR, faza migotania.
 */
export function buildGlowGraph(U) {
  const g0 = attribute('wbG0', 'vec4');
  const g1 = attribute('wbG1', 'vec4');
  const g2 = attribute('wbG2', 'vec4');
  const local = positionGeometry.xy;
  const zv = modelViewMatrix.mul(vec4(g0.xyz, 1.0)).z;
  const pxW = max(zv.negate(), 1.0).mul(U.uPxK);
  const w = max(g1.w, pxW.mul(U.uMinPx));
  const len = max(g1.z, pxW.mul(U.uMinPx).mul(1.5));
  const depthDim = mix(float(1.0), float(0.4), smoothstep(0.0, 160000.0, g0.z.negate()));
  const gain = g1.w.div(w).mul(0.65).add(0.35).mul(min(g1.z.div(len), 1.0).mul(0.6).add(0.4)).mul(depthDim);
  const t = local.x.mul(0.5).add(0.5);
  const dir = g1.xy;
  const perp = vec2(dir.y.negate(), dir.x);
  const back = mix(len.mul(-0.14), len, t);
  const offset = vec3(dir.mul(back.negate()).add(perp.mul(local.y.mul(w).mul(0.5))), 0.0);
  const positionNode = g0.xyz.add(offset);
  const vT = varying(vec2(t, local.y), 'vWbGT');
  const vCol = varying(g2.rgb.mul(gain), 'vWbGCol');
  const vKind = varying(g0.w, 'vWbGKind');
  const vPh = varying(g2.w, 'vWbGPh');
  const fragmentNode = Fn(() => {
    const a = clamp(vT.x.sub(0.12).div(0.88), 0.0, 1.0);
    const y = vT.y;
    const ia = float(1.0).sub(a);
    const flick = sin(U.uTime.mul(31.0).add(vPh)).mul(0.08).add(0.92);
    const core = exp(vT.x.sub(0.12).mul(9.0).mul(vT.x.sub(0.12).mul(9.0)).add(y.mul(y).mul(9.0)).negate());
    const plumeW = mix(float(0.55), float(0.22), a);
    const plume = ia.mul(ia).mul(exp(y.mul(y).div(plumeW.mul(plumeW)).negate()));
    const fighter = exp(vT.x.sub(0.12).mul(14.0).mul(vT.x.sub(0.12).mul(14.0)).add(y.mul(y).mul(14.0)).negate()).mul(1.6)
      .add(ia.mul(ia).mul(ia).mul(exp(y.mul(y).mul(10.0).negate())).mul(0.35));
    const I = select(vKind.lessThan(0.5), core.mul(1.4).add(plume.mul(0.8)), fighter).mul(flick);
    const col = vCol.mul(I).mul(U.uFxGain).toVar();
    return vec4(col, max(col.r, max(col.g, col.b)));
  })();
  return { positionNode, fragmentNode };
}

// ── ZDARZENIA (pierścień) ───────────────────────────────────────────────────────────────────────────────────────────
// Barwy (HDR przed `uFxGain`).
function shotColor(sub) {
  return select(sub.lessThan(0.5), vec3(0.45, 0.78, 1.0).mul(2.6),
    select(sub.lessThan(1.5), vec3(1.0, 0.38, 0.14).mul(2.6),
      select(sub.lessThan(2.5), vec3(0.5, 0.9, 1.0).mul(2.0),
        select(sub.lessThan(3.5), vec3(1.0, 0.6, 0.25).mul(2.0),
          select(sub.lessThan(4.5), vec3(0.6, 0.9, 1.0).mul(3.6), vec3(1.0, 0.45, 0.18).mul(3.6))))));
}
function flashColor(sub) {
  return select(sub.lessThan(0.5), vec3(1.0, 0.75, 0.45),
    select(sub.lessThan(1.5), vec3(1.0, 0.55, 0.2),
      select(sub.lessThan(2.5), vec3(0.55, 0.82, 1.0),
        select(sub.lessThan(3.5), vec3(1.0, 0.62, 0.4),
          select(sub.lessThan(4.5), vec3(1.0, 0.92, 0.8),
            select(sub.lessThan(5.5), vec3(0.5, 0.85, 1.0),
              select(sub.lessThan(6.5), vec3(1.0, 0.32, 0.14),
                select(sub.lessThan(7.5), vec3(0.4, 0.7, 1.0), vec3(1.0, 0.7, 0.42)))))))));
}
function beamColor(sub) {
  return select(sub.lessThan(0.5), vec3(0.45, 0.8, 1.0), select(sub.lessThan(1.5), vec3(0.55, 0.85, 1.0), vec3(1.0, 0.24, 0.12)));
}

/**
 * Rekord (16 liczb): e0 = p0 (xyz, względem początku siatki), narodziny t0; e1 = p1, czas trwania; e2 = rozmiar, rodzaj
 * (WB_EVK), odmiana (barwa), ziarno; e3 = dodatki: SHOT — rozmiar błysku trafienia (0 — pudło), długość smugi; DEBRIS —
 * prędkość (xyz); STREAK — kierunek (xy), szerokość.
 */
export function buildEventGraph(U) {
  const e0 = attribute('wbE0', 'vec4');
  const e1 = attribute('wbE1', 'vec4');
  const e2 = attribute('wbE2', 'vec4');
  const e3 = attribute('wbE3', 'vec4');
  const vQ = varyingProperty('vec2', 'vWbEQ');
  const vLen = varyingProperty('vec2', 'vWbELen');
  const vKind = varyingProperty('vec4', 'vWbEKind');
  const vCol = varyingProperty('vec3', 'vWbECol');
  const vSeed = varyingProperty('float', 'vWbESeed');
  // Wierzchołki jako Fn z JAWNYMI zmiennymi przypisanymi przed rozgałęzieniami: zagnieżdżone `select` budują się jako
  // if / else, a węzeł wspólny dla dwóch gałęzi (szerokość kwadu, macierz widoku) dostawał wartość tylko w pierwszej —
  // druga gałąź czytała zmienną nieprzypisaną (kwady kierunkowe — smugi, wiązki — miały zerową szerokość; pułapka 36).
  const positionNode = Fn(() => {
    const local = positionGeometry.xy;
    const p0 = e0.xyz;
    const p1 = e1.xyz;
    const size = e2.x;
    const kind = e2.y;
    const sub = e2.z;
    const one = float(1.0);
    const dur = float(0).toVar();
    dur.assign(max(e1.w, 0.001));
    const age = float(0).toVar();
    age.assign(U.uTime.sub(e0.w));
    const sTau = float(0).toVar();
    sTau.assign(clamp(age.div(dur), 0.0, 1.0));
    const L01 = float(0).toVar();
    L01.assign(max(length(p1.xy.sub(p0.xy)), 0.001));
    const u01 = vec2(1, 0).toVar();
    u01.assign(p1.xy.sub(p0.xy).div(L01));
    // rodzaj (0 / 1 — liczby, nie bool: jawne zmienne)
    const fShot = float(0).toVar();
    fShot.assign(step(kind, 0.5));
    const fFlash = float(0).toVar();
    fFlash.assign(step(0.5, kind).mul(step(kind, 1.5)));
    const fRing = float(0).toVar();
    fRing.assign(step(1.5, kind).mul(step(kind, 2.5)));
    const fDebris = float(0).toVar();
    fDebris.assign(step(2.5, kind).mul(step(kind, 3.5)));
    const fBeam = float(0).toVar();
    fBeam.assign(step(3.5, kind).mul(step(kind, 4.5)));
    const fStreak = float(0).toVar();
    fStreak.assign(step(4.5, kind));
    // SHOT: smuga (głowa leci p0 → p1), potem błysk trafienia w p1
    const impLife = float(0.3);
    const fStreakPhase = float(0).toVar();
    fStreakPhase.assign(select(age.lessThan(dur), float(1.0), float(0.0)));
    const trail = float(0).toVar();
    trail.assign(min(e3.y, L01.mul(sTau)));
    const impTau = float(0).toVar();
    impTau.assign(clamp(age.sub(dur).div(impLife), 0.0, 1.0));
    const impGrow = one.sub(one.sub(impTau).mul(one.sub(impTau))).mul(0.7).add(0.3);
    const lifeEnd = dur.add(select(fShot.greaterThan(0.5).and(e3.x.greaterThan(0.0)), impLife, float(0.0)));
    const alive = float(0).toVar();
    alive.assign(select(age.greaterThanEqual(0.0).and(age.lessThan(lifeEnd)), float(1.0), float(0.0)));
    // DEBRIS: lot z oporem, smuga wzdłuż prędkości
    const vel = e3.xyz;
    const vlen = float(0).toVar();
    vlen.assign(max(length(vel.xy), 0.001));
    // środek, oś, pół długości / szerokości, billboard
    const cShot = select(fStreakPhase.greaterThan(0.5), mix(p0, p1, sTau).sub(vec3(u01.mul(trail.mul(0.5)), 0.0)), p1);
    const cDeb = p0.add(vel.mul(age.mul(one.sub(sTau.mul(0.35)))));
    const cStr = p0.sub(vec3(e3.xy.mul(size.mul(0.5)), 0.0));
    const center = vec3(0).toVar();
    center.assign(cShot.mul(fShot).add(cDeb.mul(fDebris)).add(mix(p0, p1, 0.5).mul(fBeam)).add(cStr.mul(fStreak))
      .add(p0.mul(fFlash.add(fRing))));
    const axis = vec2(1, 0).toVar();
    axis.assign(u01.mul(fShot.add(fBeam)).add(vel.xy.div(vlen).mul(fDebris)).add(e3.xy.mul(fStreak)).add(vec2(1.0, 0.0).mul(fFlash.add(fRing))));
    const flashGrow = select(sub.greaterThan(4.5).and(sub.lessThan(6.5)), sTau.mul(0.75).add(0.25),
      one.sub(one.sub(sTau).mul(one.sub(sTau)).mul(one.sub(sTau))).mul(0.65).add(0.35));
    const ringGrow = sqrt(sTau).mul(0.85).add(0.15);
    const beamEnv = smoothstep(0.0, 0.07, sTau).mul(one.sub(smoothstep(0.7, 1.0, sTau)).mul(0.75).add(0.25));
    const hl = float(0).toVar();
    hl.assign(trail.mul(0.5).mul(fStreakPhase).mul(fShot).add(vlen.mul(0.035).add(size.mul(0.5)).mul(fDebris))
      .add(L01.mul(0.5).mul(fBeam)).add(size.mul(0.5).mul(fStreak)));
    const hw = float(0).toVar();
    hw.assign(mix(e3.x.mul(impGrow), size.mul(0.5), fStreakPhase).mul(fShot).add(size.mul(flashGrow).mul(fFlash))
      .add(size.mul(ringGrow).mul(fRing)).add(size.mul(0.5).mul(fDebris)).add(size.mul(0.5).mul(beamEnv).mul(fBeam))
      .add(e3.z.mul(0.5).mul(fStreak)));
    const bill = float(0).toVar();
    bill.assign(min(fFlash.add(fRing).add(fShot.mul(one.sub(fStreakPhase))), 1.0));
    // minimum w px (głębia widoku środka): cienkie smugi grubieją do uMinPx, jasność maleje tak samo
    const zv = float(0).toVar();
    zv.assign(modelViewMatrix.mul(vec4(center, 1.0)).z);
    const pxW = float(0).toVar();
    pxW.assign(max(zv.negate(), 1.0).mul(U.uPxK));
    const minW = pxW.mul(mix(U.uMinPx, U.uMinPx.mul(1.6), bill)).mul(0.5);
    const hwE = float(0).toVar();
    hwE.assign(max(hw, minW).mul(alive));
    const hlE = float(0).toVar();
    hlE.assign(max(hl, pxW.mul(0.5).mul(one.sub(bill))).mul(alive));
    // w głębi efekty ciemnieją (z < 0: do 45% przy ~160 km) — głębia czytelna także w błyskach i smugach
    const depthDim = mix(float(1.0), float(0.45), smoothstep(0.0, 160000.0, center.z.negate()));
    const gain = select(hwE.greaterThan(0.0), hw.div(max(hwE, 1e-3)).mul(0.6).add(0.4).mul(depthDim), float(0.0));
    // barwa (stała na instancję)
    const color = shotColor(sub).mul(fShot).add(flashColor(sub).mul(fFlash)).add(vec3(1.0, 0.72, 0.48).mul(fRing))
      .add(select(sub.lessThan(0.5), vec3(1.0, 0.72, 0.36).mul(2.4), vec3(0.95, 0.5, 0.22).mul(1.1)).mul(fDebris))
      .add(beamColor(sub).mul(fBeam)).add(select(sub.lessThan(0.5), vec3(0.6, 0.85, 1.0), vec3(1.0, 0.6, 0.4)).mul(fStreak));
    vQ.assign(local);
    vLen.assign(vec2(hlE, hwE));
    vKind.assign(vec4(kind, sub, sTau, impTau.mul(one.sub(fStreakPhase))));
    vCol.assign(color.mul(gain));
    vSeed.assign(e2.w);
    const perp = vec2(axis.y.negate(), axis.x);
    const offOri = vec3(axis.mul(local.x.mul(hlE.add(hwE))).add(perp.mul(local.y.mul(hwE))), 0.0);
    const offBill = billboardOffset(local.x.mul(hwE), local.y.mul(hwE));
    return center.add(mix(offOri, offBill, bill));
  })();
  const fragmentNode = Fn(() => {
    const k = vKind.x;
    const sb = vKind.y;
    const tt = vKind.z;
    const it = float(1.0).sub(tt);
    const r = length(vQ);
    const out = float(0.0).toVar();
    // odcinek: odległość od osi w ułamkach szerokości z zaokrąglonymi końcami
    const hlq = vLen.x;
    const hwq = max(vLen.y, 1e-3);
    const xw = vQ.x.mul(hlq.add(hwq));
    const dx = max(abs(xw).sub(hlq), 0.0).div(hwq);
    const rr = dx.mul(dx).add(vQ.y.mul(vQ.y));
    If(k.lessThan(0.5), () => {
      If(vKind.w.lessThan(0.001), () => {
        const headW = smoothstep(hlq.negate(), hlq, xw).mul(0.75).add(0.25);
        out.assign(exp(rr.mul(-3.5)).mul(headW));
      }).Else(() => {
        const ii = float(1.0).sub(vKind.w);
        out.assign(exp(r.mul(r).mul(-5.0)).mul(ii).mul(ii).mul(2.4));
      });
    }).ElseIf(k.lessThan(1.5), () => {
      If(sb.greaterThan(3.5).and(sb.lessThan(4.5)), () => {
        // śmierć: biały błysk (krótki — kłąb ognia robią osobne kule)
        out.assign(exp(r.mul(r).mul(-4.0)).mul(it).mul(it).mul(it).mul(3.0));
      }).ElseIf(sb.greaterThan(1.5).and(sb.lessThan(3.5)), () => {
        // warp: rdzeń i pozioma flara
        const flare = exp(vQ.y.mul(vQ.y).mul(-160.0)).mul(exp(abs(vQ.x).mul(-2.2)));
        out.assign(exp(r.mul(r).mul(-9.0)).mul(2.5).add(flare.mul(1.6)).mul(it).mul(it).mul(2.2));
      }).ElseIf(sb.greaterThan(4.5).and(sb.lessThan(6.5)), () => {
        // ładowanie: rośnie, pulsuje, na końcu gaśnie
        const pulse = sin(tt.mul(70.0).add(vSeed)).mul(0.18).add(0.82);
        const endFade = float(1.0).sub(smoothstep(0.92, 1.0, tt));
        out.assign(exp(r.mul(r).mul(-4.0)).mul(tt.mul(tt).mul(3.2).add(0.4)).mul(pulse).mul(endFade).add(exp(r.mul(r).mul(-28.0)).mul(tt).mul(3.0).mul(endFade)));
      }).ElseIf(sb.greaterThan(6.5).and(sb.lessThan(7.5)), () => {
        // tarcza: pierścień
        const ring = exp(r.sub(0.78).div(0.12).mul(r.sub(0.78).div(0.12)).negate());
        out.assign(ring.mul(0.9).add(exp(r.mul(r).mul(-3.0)).mul(0.25)).mul(it).mul(it).mul(1.4));
      }).ElseIf(sb.greaterThan(0.5).and(sb.lessThan(1.5)), () => {
        // ogień: kula z poszarpanym brzegiem i gorącym rdzeniem, stygnie od brzegu (rdzeń gaśnie szybciej niż kłąb)
        const ax = vQ.x.div(max(r, 1e-3));
        const ay = vQ.y.div(max(r, 1e-3));
        const n = sin(ay.mul(7.0).add(ax.mul(3.0)).add(vSeed)).mul(0.07).add(sin(ax.mul(11.0).sub(ay.mul(5.0)).add(vSeed.mul(2.1))).mul(0.05))
          .add(sin(r.mul(17.0).sub(tt.mul(6.0)).add(vSeed.mul(0.7))).mul(0.04));
        const edge = float(1.0).sub(smoothstep(float(0.5).add(n), float(0.95).add(n.mul(0.5)), r));
        const core = exp(r.mul(r).mul(-10.0)).mul(it.mul(it).mul(it)).mul(1.5);
        const body = edge.mul(it.mul(it).mul(1.15)).mul(float(1.0).sub(r.mul(0.45)));
        out.assign(body.add(core));
      }).Else(() => {
        out.assign(exp(r.mul(r).mul(-5.0)).mul(it).mul(it).mul(2.6));
      });
    }).ElseIf(k.lessThan(2.5), () => {
      const ring = exp(r.sub(0.92).div(0.06).mul(r.sub(0.92).div(0.06)).negate());
      out.assign(ring.mul(it).mul(it).mul(1.3));
    }).ElseIf(k.lessThan(3.5), () => {
      out.assign(exp(rr.mul(-3.0)).mul(it).mul(select(sb.lessThan(0.5), it.mul(1.3), float(0.9))));
    }).ElseIf(k.lessThan(4.5), () => {
      // wiązka: biały rdzeń, barwna poświata, migotanie wzdłuż, flara u wylotu
      const y = vQ.y;
      const flick = sin(xw.mul(0.004).sub(tt.mul(90.0)).add(vSeed)).mul(0.12).add(0.88);
      const ends = smoothstep(-1.0, -0.94, vQ.x).mul(float(1.0).sub(smoothstep(0.82, 1.0, vQ.x)));
      const core = exp(y.mul(y).mul(-55.0)).mul(5.0);
      const glow = exp(y.mul(y).mul(-4.5)).mul(1.6);
      const muzzle = exp(xw.add(hlq).div(hwq.mul(2.5)).mul(xw.add(hlq).div(hwq.mul(2.5))).negate()).mul(2.5);
      out.assign(core.add(glow).mul(flick).mul(ends).add(muzzle.mul(exp(y.mul(y).mul(-3.0)))));
    }).Else(() => {
      // smuga przylotu z warpa: jasna głowa biegnie do punktu wyjścia, potem linia gaśnie
      const sx = vQ.x.mul(0.5).add(0.5);
      const hp = smoothstep(0.0, 0.5, tt);
      const line = exp(vQ.y.mul(vQ.y).mul(-30.0));
      const headG = exp(sx.sub(hp).mul(7.0).mul(sx.sub(hp).mul(7.0)).negate()).mul(2.2).add(step(sx, hp).mul(0.35));
      out.assign(line.mul(headG).mul(float(1.0).sub(smoothstep(0.5, 1.0, tt))).mul(2.6));
    });
    // kolor biały w rdzeniu (nasycenie spada z jasnością)
    const base = vCol.mul(out);
    const whiteK = clamp(out.sub(1.5).mul(0.25), 0.0, 0.6);
    const col = mix(base, vec3(max(base.r, max(base.g, base.b))), whiteK).mul(U.uFxGain).toVar();
    return vec4(col, max(col.r, max(col.g, col.b)));
  })();
  return { positionNode, fragmentNode };
}

// ── PLANETA ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Powierzchnia: dzień, noc (miasta), chmury, pas zmierzchu, poświata brzegu. Kierunek słońca w świecie (`uSunDir`). */
export function buildPlanetGraph(U, tex) {
  const fragmentNode = Fn(() => {
    const N = normalize(positionView.sub(modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz)).toVar();
    const V = normalize(positionView.negate());
    const L = normalize(cameraViewMatrix.mul(vec4(U.uSunDir, 0.0)).xyz);
    const ndl = dot(N, L).toVar();
    const st = uv();
    const day = texture(tex.day, st).rgb;
    const night = texture(tex.night, st).rgb;
    const cl = texture(tex.clouds, st.add(vec2(U.uCloudShift, 0.0))).r.mul(U.uCloud);
    const sunK = max(ndl, 0.0);
    const ground = day.mul(sunK.mul(0.92).add(0.015)).mul(U.uSun);
    const cloudSun = smoothstep(-0.06, 0.32, ndl);
    const cloudLit = mix(vec3(0.75, 0.42, 0.22), vec3(0.92, 0.9, 0.86), smoothstep(0.05, 0.4, ndl)).mul(cloudSun).mul(sunK.mul(0.85).add(0.15)).mul(U.uSun);
    const surf = mix(ground, cloudLit, cl);
    const tw = exp(ndl.div(0.11).mul(ndl.div(0.11)).negate());
    const twilight = vec3(0.9, 0.38, 0.12).mul(tw).mul(0.28).mul(float(1.0).sub(cl.mul(0.4)));
    const cityMask = float(1.0).sub(smoothstep(-0.14, 0.05, ndl));
    const city = night.mul(U.uCity).mul(cityMask).mul(float(1.0).sub(cl.mul(0.75)));
    const fres = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
    const f2 = fres.mul(fres);
    const rim = vec3(0.32, 0.55, 1.0).mul(f2.mul(f2)).mul(smoothstep(-0.25, 0.4, ndl).mul(0.95).add(0.05)).mul(U.uRim);
    return vec4(surf.add(twilight).add(city).add(rim), 1.0);
  })();
  return { fragmentNode };
}

/** Powłoka atmosfery (tylne ściany, addytywnie): poświata za brzegiem tarczy, jaśniej po stronie dnia. */
export function buildAtmosphereGraph(U, shellRatio) {
  const fragmentNode = Fn(() => {
    const N = normalize(positionView.sub(modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz));
    const V = normalize(positionView.negate());
    const L = normalize(cameraViewMatrix.mul(vec4(U.uSunDir, 0.0)).xyz);
    const x = dot(N, V).negate();
    const edge = Math.sqrt(Math.max(0, 1 - 1 / (shellRatio * shellRatio)));
    const I = smoothstep(0.0, edge, x);
    const light = smoothstep(-0.35, 0.45, dot(N, L)).mul(0.92).add(0.08);
    const col = vec3(0.3, 0.55, 1.0).mul(I.mul(I)).mul(light).mul(U.uAtmo).toVar();
    return vec4(col, max(col.r, max(col.g, col.b)));
  })();
  return { fragmentNode };
}

// ── siatki ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function quadGeometry(cap, stride, names) {
  const base = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  const arr = new Float32Array(cap * stride);
  const buf = new THREE.InstancedInterleavedBuffer(arr, stride);
  for (let i = 0; i < names.length; i++) geo.setAttribute(names[i], new THREE.InterleavedBufferAttribute(buf, 4, i * 4));
  geo.instanceCount = 0;
  return { geo, arr, buf };
}

function baseMaterial(name) {
  const mat = new THREE.NodeMaterial();
  mat.name = name;
  mat.lights = false;
  mat.fog = false;
  mat.side = THREE.DoubleSide;
  return mat;
}

/** Materiały (raz na obraz) — wspólne dla siatek tła i pierwszego planu. */
export function createWarBackdropMaterials(U, atlasTex, planetTex, shellRatio) {
  const hull = baseMaterial('WarBackdropHull');
  const hg = buildHullGraph(U, atlasTex);
  hull.positionNode = hg.positionNode;
  hull.fragmentNode = hg.fragmentNode;
  hull.transparent = false;
  hull.depthWrite = true;
  hull.depthTest = true;
  hull.alphaToCoverage = true;
  const glow = baseMaterial('WarBackdropGlow');
  const gg = buildGlowGraph(U);
  glow.positionNode = gg.positionNode;
  glow.fragmentNode = gg.fragmentNode;
  glow.transparent = true;
  glow.depthWrite = false;
  glow.depthTest = true;
  glow.forceSinglePass = true;
  blendAddytywnePremul(glow);
  const event = baseMaterial('WarBackdropFx');
  const eg = buildEventGraph(U);
  event.positionNode = eg.positionNode;
  event.fragmentNode = eg.fragmentNode;
  event.transparent = true;
  event.depthWrite = false;
  event.depthTest = true;
  event.forceSinglePass = true;
  blendAddytywnePremul(event);
  const planet = new THREE.NodeMaterial();
  planet.name = 'WarBackdropPlanet';
  planet.lights = false;
  planet.fog = false;
  planet.fragmentNode = buildPlanetGraph(U, planetTex).fragmentNode;
  const atmo = new THREE.NodeMaterial();
  atmo.name = 'WarBackdropAtmo';
  atmo.lights = false;
  atmo.fog = false;
  atmo.side = THREE.BackSide;
  atmo.transparent = true;
  atmo.depthWrite = false;
  atmo.depthTest = true;
  atmo.fragmentNode = buildAtmosphereGraph(U, shellRatio).fragmentNode;
  blendAddytywnePremul(atmo);
  return { hull, glow, event, planet, atmo };
}

/** Siatka partii kwadów na warstwie `layer`. */
export function createQuadBatch(material, cap, stride, names, layer, name, order) {
  const q = quadGeometry(cap, stride, names);
  const mesh = new THREE.Mesh(q.geo, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.layers.set(layer);
  return { mesh, arr: q.arr, buf: q.buf, cap, stride, count: 0 };
}
