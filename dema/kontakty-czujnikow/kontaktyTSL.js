// dema/kontakty-czujnikow/kontaktyTSL.js
//
// KONTAKT CZUJNIKÓW — propozycje wyglądu (etap 1, 2026-11-04; plan: docs/PLAN-kontakt-czujnikow.md).
// KONTAKT = „coś tam jest, ale nie wiesz co”: wykryty czujnikami, niezidentyfikowany. Obraz ma oddać ROZMIAR (4 klasy
// sygnatury), NIEPEWNOŚĆ miejsca (promień `err`, punkt wędruje) i NIE zdradzać strony ani klasy; bliskie kontakty
// (flota) zlewają się w jeden kształt.
//
// BUDOWA (pod etap 2): każda propozycja to JEDNA funkcja na piksel nad blokiem kontaktów (`uniformArray` o stałej
// nazwie, ≤ KONTAKT_MAX): punkt świata piksela (j. względem środka kadru, osie sceny — y w górę) → pętla po kontaktach
// z odrzuceniem po zasięgu → pole (suma gaussów / metakule) → wygląd raz na piksel (szum, warstwice, iskry). Wynik:
// vec4(rgb, alfa) premultiplied — rgb świeci (HDR > 1 → bloom), alfa przyciemnia tło (wir: ciemne jądro).
// W demie funkcja siedzi w kwadzie pełnoekranowym passa gry (warstwa 0); w grze kontakt leży POD MGŁĄ WOJNY (poza
// wzrokiem), a mgła w „uber” przygasza wszystko pod sobą (×0,15–0,34, odbarwienie) — dlatego w etapie 2 ta sama funkcja
// idzie do postu PO `applyFogOfWar` (punkt świata piksela już tam jest: `fogRelPoint`), nie do sceny.
//
// Zasady: graf raz na propozycję (4 materiały, rozgrzane), wartości w bloku (bez `needsUpdate`), szum z tekstury
// `fxNoise.noise3D` zakotwiczony w świecie (początek kafla liczony na CPU w double — `noiseBase`), hasze całkowite
// (PCG — bez `Math.random`, wynik niezależny od kompilatora), pochodne (`fwidth`) poza gałęziami (pułapka 15),
// funkcje wklejane (bez `setLayout` — pułapki 1 i 35), bez `pow` z ujemną podstawą.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, screenCoordinate, positionGeometry,
  exp, log, sin, cos, atan, length, dot, mix, smoothstep, clamp, max, abs, fract, floor, step, fwidth, texture,
  texture3D, select
} from 'three/tsl';
import { fxNoise } from '../../src/3d/fx/noise.js';

export const KONTAKT_MAX = 48;
/** vec4 nagłówka: (liczba, czas, zoom bufora [px/j.], px bufora na px CSS), (bufor W, H, początek szumu x, y),
 *  (wiązka radaru: x, y [j. względem kadru], okres [s], włącznik), (—). */
export const KONTAKT_HDR = 4;
/** Okres szumu świata [j.] — kafel tekstury noise3D (krotności całkowite zachowują okresowość). */
export const KONTAKT_NOISE_TILE = 40000;
export const KONTAKT_STYLES = Object.freeze(['echo', 'oblok', 'wir', 'roj']);

const TAU = 6.283185307;

/** Blok kontaktów: nagłówek + 2 vec4 na kontakt — A = (x, y, R, err) [j., osie sceny względem środka kadru],
 *  B = (klasa 0–3, masa, ziarno 0–1, alfa). */
export function createContactBlock() {
  const arr = Array.from({ length: KONTAKT_HDR + 2 * KONTAKT_MAX }, () => new THREE.Vector4());
  const node = uniformArray(arr, 'vec4').setName('kontaktyCzujnikow');
  return { node, array: node.array };
}

const TV_ZERO = { f: () => float(0), u: () => uint(0), v2: () => vec2(0), v3: () => vec3(0), v4: () => vec4(0) };
/** Zmienna o typie ze STAŁEJ (pułapka 40: `.toVar()` z wyrażenia pyta o typ całe drzewo źródła — przy haszach
 *  i łańcuchach zmiennych budowa grafu rosła wykładniczo; roj budował się > 100 s). */
function tv(type, expr, name) {
  const v = TV_ZERO[type]().toVar(name);
  v.assign(expr);
  return v;
}

// ── hasze całkowite (PCG) ────────────────────────────────────────────────────────────────────────────────────────
function pcg(v) {
  const s = tv('u', v.mul(uint(747796405)).add(uint(2891336453)));
  const w = tv('u', s.shiftRight(s.shiftRight(uint(28)).add(uint(4))).bitXor(s).mul(uint(277803737)));
  return w.shiftRight(uint(22)).bitXor(w);
}
const u01 = (h) => float(h.bitAnd(uint(0xFFFFFF))).div(16777215.0);
const uOf = (f) => uint(int(floor(f)));
const hash2 = (a, b) => pcg(a.bitXor(pcg(b)));
const hash3 = (a, b, c) => pcg(a.bitXor(pcg(b.bitXor(pcg(c)))));

// ── wspólne wejście piksela ──────────────────────────────────────────────────────────────────────────────────────
function header(B) {
  const h0 = B.element(0);
  const h1 = B.element(1);
  const h2 = B.element(2);
  return {
    count: int(h0.x), time: h0.y, zoom: max(h0.z, 1e-6), pxs: max(h0.w, 0.25),
    res: h1.xy, nbase: h1.zw, sweep: h2.xy, sweepPeriod: max(h2.z, 0.1), sweepOn: h2.w
  };
}
const contactA = (B, i) => B.element(i.mul(2).add(KONTAKT_HDR));
const contactB = (B, i) => B.element(i.mul(2).add(KONTAKT_HDR + 1));

function pixelSetup(H) {
  const px = tv('v2', screenCoordinate.xy, 'kPx');
  // punkt świata piksela względem środka kadru (osie sceny: x w prawo, y w górę); screenCoordinate.y liczy od góry
  const rel = tv('v2', vec2(px.x.sub(H.res.x.mul(0.5)), H.res.y.mul(0.5).sub(px.y)).div(H.zoom), 'kRel');
  return { px, rel };
}

/** Szum świata: noise3D (2 kanały fBm), punkt = (początek kafla + rel / kafel) × k (k całkowite), w = czas. */
function noiseAt(tex, H, p, k, w, shift = 0) {
  const q = H.nbase.add(p.div(KONTAKT_NOISE_TILE)).mul(k);
  return texture3D(tex, vec3(shift ? q.add(shift) : q, w)).level(0);
}

const AMBER = [1.0, 0.70, 0.26];          // „nieznany” jak NTDS (radarConfig.unknown 255, 208, 80) — bez strony
const c3 = (a) => vec3(a[0], a[1], a[2]);

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. ECHO — morfująca plama-echo luminoforu (metakule): płaty krążą wokół punktu i zlewają się; jasny brzeg jak echo
//    PPI, warstwice w środku (cięższy kontakt = wyższe pole = więcej warstwic), rozjaśnienie przy przejściu wiązki
//    radaru gracza i zanik jak luminofor; przerywana obwiednia = gdzie kontakt może być.
function echoLook(B, H, ctx, noiseTex) {
  const { rel, px } = ctx;
  const t = H.time;
  const F = float(0).toVar('eF');
  const Ew = float(0).toVar('eE');
  const Fe = float(0).toVar('eEnv');
  Loop({ start: int(0), end: H.count, type: 'int', condition: '<', name: 'ei' }, ({ ei }) => {
    const A = tv('v4', contactA(B, ei), 'eA');
    const Bv = tv('v4', contactB(B, ei), 'eB');
    const d = tv('v2', rel.sub(A.xy), 'ed');
    const R = A.z;
    const e = A.w;
    const spread = tv('f', R.mul(0.42).add(e.mul(0.5)), 'eSp');
    const reach = R.mul(2.4).add(spread.mul(1.8));
    If(dot(d, d).lessThan(reach.mul(reach)), () => {
      const seed = Bv.z;
      const cls = Bv.x;
      const r0 = R.mul(0.72);
      const f = tv('f', exp(dot(d, d).div(r0.mul(r0)).negate()), 'ef');
      for (let l = 0; l < 5; l++) {
        const on = step(float(l + 0.5), cls.add(2.0));          // klasa 0 → 2 płaty … klasa 3 → 5
        const sgn = (l % 2) ? -1 : 1;
        const ang = seed.mul(TAU).add(l * 2.39996).add(t.mul((0.21 + 0.06 * l) * sgn));
        const rad = spread.mul(sin(t.mul(0.33 + 0.1 * l).add(seed.mul(7.0)).add(l * 1.7)).mul(0.4).add(0.62));
        const rl = R.mul(sin(t.mul(0.7 + 0.13 * l).add(seed.mul(3.0)).add(l * 2.1)).mul(0.12).add(0.5));
        const q = d.sub(vec2(cos(ang), sin(ang)).mul(rad));
        f.addAssign(on.mul(exp(dot(q, q).div(rl.mul(rl)).negate())).mul(0.85));
      }
      f.mulAssign(Bv.w);
      F.addAssign(f);
      Ew.addAssign(f.mul(e));
      const se = spread.mul(1.2).add(R.mul(0.85));
      Fe.addAssign(Bv.w.mul(exp(dot(d, d).div(se.mul(se)).negate())));
    });
  });
  const E = tv('f', Ew.div(max(F, 1e-4)), 'eErr');
  const errPx = tv('f', E.mul(H.zoom).div(H.pxs), 'eErrPx');                  // niepewność w px CSS
  const n = tv('v4', noiseAt(noiseTex, H, rel, 16, t.mul(0.03)), 'eN');
  const Fn_ = tv('f', F.add(n.x.sub(0.5).mul(0.38).mul(smoothstep(0.04, 0.45, F)).mul(clamp(errPx.div(25.0), 0.3, 1.0))), 'eFn');
  // pochodne przed rozgałęzieniem (tu: po pętli, jednorodny przepływ)
  const fw = tv('f', max(fwidth(Fn_), 1e-4), 'eFw');
  const fwE = tv('f', max(fwidth(Fe), 1e-4), 'eFwE');
  const tau = 0.45;
  const soft = tv('f', fw.mul(1.2).add(clamp(errPx.div(70.0), 0.0, 1.0).mul(0.12)), 'eSoft');
  const rim = tv('f', float(1.0).sub(smoothstep(0.0, soft, abs(Fn_.sub(tau)))), 'eRim');
  const inside = tv('f', smoothstep(soft.negate(), soft, Fn_.sub(tau)), 'eIn');
  // warstwice co 0,55 pola nad brzegiem
  const cv = Fn_.sub(tau).div(0.55);
  const contour = float(1.0).sub(smoothstep(0.0, fw.div(0.55).mul(1.1), abs(fract(cv.add(0.5)).sub(0.5)))).mul(step(0.5, cv));
  // obwiednia niepewności: słaba przerywana linia (wzór ekranu — kreski wzdłuż każdej krzywej)
  const envLine = float(1.0).sub(smoothstep(0.0, fwE.mul(1.3), abs(Fe.sub(0.28))))
    .mul(step(0.5, fract(px.x.add(px.y).div(H.pxs.mul(7.0))))).mul(float(1.0).sub(inside));
  const envFill = smoothstep(0.08, 0.5, Fe).mul(0.016);
  // wiązka radaru gracza (zgodnie z zegarem): echo malowane przy przejściu, gaśnie jak luminofor
  const ds = rel.sub(H.sweep);
  const beam = t.mul(TAU).div(H.sweepPeriod).negate();
  const since = fract(atan(ds.y, ds.x).sub(beam).div(TAU)).mul(H.sweepPeriod);
  const paint = tv('f', mix(float(1.0), exp(since.mul(-1.4)).mul(0.78).add(0.22), H.sweepOn), 'ePaint');
  // ziarno luminoforu i linie skanu (px CSS)
  const pc = floor(px.div(H.pxs));
  const grain = u01(hash3(uOf(pc.x), uOf(pc.y), uOf(t.mul(24.0))));
  const scan = step(0.5, fract(px.y.div(H.pxs.mul(3.0)))).mul(0.45).add(0.55);
  const fill = inside.mul(0.09).mul(scan).mul(grain.mul(0.6).add(0.7));
  const halo = smoothstep(0.0, tau, Fn_).mul(float(1.0).sub(inside)).mul(0.08);
  const lum = rim.mul(2.6).add(contour.mul(0.85)).add(fill).add(halo).mul(paint);
  const rimTint = mix(c3(AMBER), vec3(1.0, 0.93, 0.78), rim.mul(0.45));
  const rgb = rimTint.mul(lum).add(c3(AMBER).mul(envLine.mul(0.30).mul(paint.mul(0.5).add(0.5)).add(envFill)));
  return vec4(rgb, inside.mul(0.32).add(envFill.mul(2.0)));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. OBŁOK — obłok zakłóceń: miękka, zawirowana chmura (fBm na punkcie przesuniętym szumem) z pasmami interferencji
//    (jasne linie płynące w poprzek chmury jak zakłócony odbiór), rwanymi wierszami (co 1/7 s część wierszy skacze
//    w bok) i rzadkim „śniegiem” sygnału (iskry co klatkę). Cięższy = gęstszy, z jaśniejszym rdzeniem; niepewność =
//    szersza, rzadsza, bardziej postrzępiona chmura.
function oblokLook(B, H, ctx, noiseTex) {
  const { rel, px } = ctx;
  const t = H.time;
  const W = float(0).toVar('oW');
  const Ew = float(0).toVar('oE');
  const Rw = float(0).toVar('oR');
  const Kw = float(0).toVar('oK');
  Loop({ start: int(0), end: H.count, type: 'int', condition: '<', name: 'oi' }, ({ oi }) => {
    const A = tv('v4', contactA(B, oi), 'oA');
    const Bv = tv('v4', contactB(B, oi), 'oB');
    const d = tv('v2', rel.sub(A.xy), 'od');
    const S = A.z.mul(1.5).add(A.w.mul(0.9));
    const w = tv('f', Bv.w.mul(exp(dot(d, d).div(S.mul(S)).negate())), 'ow');
    W.addAssign(w);
    Ew.addAssign(w.mul(A.w));
    Rw.addAssign(w.mul(A.z));
    Kw.addAssign(w.mul(Bv.x));
  });
  const iw = float(1.0).div(max(W, 1e-4));
  const E = tv('f', Ew.mul(iw), 'oErr');
  const Rm = tv('f', Rw.mul(iw), 'oRm');
  const K = tv('f', Kw.mul(iw), 'oKm');
  const warpAmp = tv('f', Rm.mul(0.35).add(E.mul(0.45)), 'oWa');
  const nw = tv('v4', noiseAt(noiseTex, H, rel, 12, t.mul(0.02)), 'oNw');
  // rwane wiersze: co ~4 px CSS wiersz, raz na 1/7 s część wierszy przeskakuje w bok
  const band = uOf(px.y.div(H.pxs.mul(4.0)));
  const tf = uOf(t.mul(7.0));
  const hb = u01(hash2(band, tf));
  const tear = step(0.965, hb).mul(u01(hash3(band, tf, uint(7))).sub(0.5)).mul(warpAmp.mul(1.6));
  const pw = tv('v2', rel.add(nw.xy.sub(0.5).mul(warpAmp.mul(2.0))).add(vec2(tear, 0.0)), 'oPw');
  const F = float(0).toVar('oF');
  const core = float(0).toVar('oC');
  Loop({ start: int(0), end: H.count, type: 'int', condition: '<', name: 'oj' }, ({ oj }) => {
    const A = tv('v4', contactA(B, oj), 'oA2');
    const Bv = tv('v4', contactB(B, oj), 'oB2');
    const d = tv('v2', pw.sub(A.xy), 'od2');
    const S = A.z.mul(1.05).add(A.w.mul(0.6));
    const reach = S.mul(3.0);
    If(dot(d, d).lessThan(reach.mul(reach)), () => {
      F.addAssign(Bv.w.mul(Bv.y).mul(exp(dot(d, d).div(S.mul(S)).negate())));
      const rc = A.z.mul(0.5).add(A.w.mul(0.12));
      core.addAssign(Bv.w.mul(Bv.y).mul(exp(dot(d, d).div(rc.mul(rc)).negate())));
    });
  });
  const fb = tv('v4', noiseAt(noiseTex, H, pw, 24, t.mul(0.04)), 'oFb');
  const fd = noiseAt(noiseTex, H, pw, 72, t.mul(0.08), 0.31);
  // fBm: grube kłęby × drobna faktura; postrzępienie rośnie z niepewnością
  const ragged = clamp(E.div(max(Rm, 1.0)).mul(0.5), 0.0, 0.6);
  const tex = fb.x.mul(0.65).add(fd.y.mul(0.35));
  const D = tv('f', F.mul(mix(float(1.0), tex.mul(2.0), ragged.add(0.35))), 'oD');
  const cloud = tv('f', smoothstep(0.10, 0.85, D), 'oCloud');
  const dense = smoothstep(0.55, 1.4, D);
  // pasma interferencji płyną w dół ekranu, rzadkie i cienkie
  const bands = smoothstep(0.86, 1.0, sin(px.y.div(H.pxs).mul(0.55).sub(t.mul(9.0)).add(fb.y.mul(6.0)))).mul(0.6);
  // śnieg sygnału: ziarno px CSS × 1,5 losowane 24 razy na sekundę, rzadko
  const pc = floor(px.div(H.pxs.mul(1.5)));
  const fr = uOf(t.mul(24.0));
  const g = tv('f', u01(hash3(uOf(pc.x), uOf(pc.y), fr)), 'oG');
  const speck = step(float(1.0).sub(cloud.mul(0.035).mul(K.mul(0.25).add(0.75))), g);
  const tint = mix(c3(AMBER), vec3(0.80, 0.90, 1.0), u01(hash3(uOf(pc.x), uOf(pc.y), fr.add(uint(911)))));
  const cool = vec3(0.46, 0.52, 0.62);
  const body = mix(cool, c3(AMBER), dense.mul(0.6).add(0.15)).mul(cloud.mul(cloud).mul(0.16).add(dense.mul(0.22)))
    .mul(g.mul(0.25).add(0.85));
  const hot = c3(AMBER).mul(smoothstep(0.5, 1.8, core).mul(0.55));
  const rgb = body.add(c3(AMBER).mul(bands).mul(cloud).mul(0.18)).add(tint.mul(speck).mul(1.5)).add(hot);
  return vec4(rgb, cloud.mul(0.30));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. WIR — wir masy (styl sygnatur masy mgły wojny): ciemne jądro połyka tło, wokół pierścień ciepłego pyłu
//    w ramionach spirali logarytmicznej (2 ramiona, cięższe — 3; wzór obraca się sztywno — bez nawijania), cienki
//    fioletowy horyzont, soczewka (refrakcja `Core3D.fxDistortion().implode` z CPU). Cięższy = większe jądro, mocniejsza
//    soczewka, szybszy wir; niepewność = szerszy, rozmyty pierścień i miękki horyzont. Flota = kilka jąder w jednym
//    obłoku pyłu (pierścienie się sumują).
function wirLook(B, H, ctx, noiseTex) {
  const { rel } = ctx;
  const t = H.time;
  const Phi = float(0).toVar('wPhi');
  const core = float(0).toVar('wCore');
  const dust = float(0).toVar('wDust');
  const edge = float(0).toVar('wEdge');
  const shade = float(0).toVar('wShade');
  Loop({ start: int(0), end: H.count, type: 'int', condition: '<', name: 'wi' }, ({ wi }) => {
    const A = tv('v4', contactA(B, wi), 'wA');
    const Bv = tv('v4', contactB(B, wi), 'wB');
    const d = tv('v2', rel.sub(A.xy), 'wd');
    const rc = tv('f', A.z.mul(0.72).add(A.w.mul(0.2)), 'wRc');        // promień jądra
    const reach = rc.mul(4.5).add(A.w);
    If(dot(d, d).lessThan(reach.mul(reach)), () => {
      const cls = Bv.x;
      const al = Bv.w;
      const x = tv('f', length(d).div(rc), 'wX');
      const blur = tv('f', A.w.div(rc).mul(0.35), 'wBlur');            // niepewność w promieniach jądra
      core.addAssign(al.mul(cls.mul(0.06).add(0.82)).mul(exp(x.mul(x).mul(-1.3))));
      const dir = select(fract(Bv.z.mul(7.31)).greaterThan(0.5), float(1.0), float(-1.0));
      const arms = step(1.5, cls).add(2.0);
      const spin = t.mul(cls.mul(0.05).add(0.22)).mul(dir);
      const phase = atan(d.y, d.x).mul(arms).sub(log(x.add(0.25)).mul(arms).mul(1.3).mul(dir)).add(spin.mul(arms))
        .add(Bv.z.mul(TAU));
      const arm = cos(phase).mul(0.5).add(0.5);
      const arm2 = arm.mul(arm);
      const contrast = float(1.0).div(blur.add(1.0));
      const ringW = blur.mul(0.6).add(0.55);
      const rx = x.sub(1.75).div(ringW);
      const ring = exp(rx.mul(rx).negate());
      dust.addAssign(al.mul(Bv.y).mul(ring).mul(arm2.mul(arm2).mul(contrast).add(float(1.0).sub(contrast).mul(0.3)).add(0.06)));
      Phi.addAssign(al.mul(Bv.y).mul(exp(x.mul(x).mul(-0.09))));
      shade.addAssign(al.mul(exp(x.mul(x).mul(-0.3))));
      const ew = blur.mul(0.1).add(0.04);
      const ex = x.sub(0.98).div(ew);
      edge.addAssign(al.mul(exp(ex.mul(ex).negate())).mul(contrast.mul(0.6).add(0.4)));
    });
  });
  const n1 = noiseAt(noiseTex, H, rel, 24, t.mul(0.03)).x;
  const n2 = noiseAt(noiseTex, H, rel, 64, t.mul(0.05), 0.37).y;
  const coreC = tv('f', clamp(core, 0.0, 1.0), 'wCoreC');
  const dustN = dust.mul(n1.mul(0.9).add(n2.mul(0.5)).add(0.2)).mul(float(1.0).sub(coreC.mul(0.9)));
  const dustCol = vec3(1.0, 0.62, 0.32).mul(dustN).mul(0.55);
  const halo = vec3(0.6, 0.5, 1.0).mul(Phi).mul(float(1.0).sub(coreC)).mul(0.02);
  const rimCol = vec3(0.80, 0.72, 1.0).mul(clamp(edge, 0.0, 1.5)).mul(0.36);
  // ciemność: jądro + szeroki cień studni (przygasza gwiazdy wokół — „coś ciężkiego”)
  const dark = max(smoothstep(0.15, 0.8, core).mul(0.95), clamp(shade, 0.0, 1.0).mul(0.3));
  return vec4(dustCol.add(halo).add(rimCol), dark);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. RÓJ — rój drobin prawdopodobieństwa: iskry rozbłyskują tam, gdzie kontakt może być (gęstość = prawdopodobieństwo),
//    i krążą wokół środka jak rój (komórki w pierścieniach biegunowych, każdy pierścień obraca się sztywno — środek
//    szybciej); każda iskra żyje 0,5–1,5 s i odradza się w innym miejscu komórki. Cięższy = gęstszy i większy rój;
//    niepewność = rój szerszy i rzadszy; flota = roje się przenikają nad wspólną poświatą.
function rojLook(B, H, ctx) {
  const { rel } = ctx;
  const t = H.time;
  const spark = float(0).toVar('rSpark');
  const glow = float(0).toVar('rGlow');
  const cellPx = tv('f', H.pxs.mul(6.5), 'rCellPx');            // komórka ~6,5 px CSS
  const cellW = tv('f', cellPx.div(H.zoom), 'rCellW');           // ta sama komórka w j. świata
  Loop({ start: int(0), end: H.count, type: 'int', condition: '<', name: 'ri' }, ({ ri }) => {
    const A = tv('v4', contactA(B, ri), 'rA');
    const Bv = tv('v4', contactB(B, ri), 'rB');
    const d = tv('v2', rel.sub(A.xy), 'rd');
    const S = tv('f', A.z.mul(0.95).add(A.w.mul(0.8)), 'rS');
    const reach = S.mul(2.6);
    If(dot(d, d).lessThan(reach.mul(reach)), () => {
      const cls = Bv.x;
      const al = Bv.w;
      glow.addAssign(al.mul(Bv.y).mul(exp(dot(d, d).div(S.mul(S)).negate())));
      const r = tv('f', length(d), 'rR');
      const ringF = tv('f', floor(r.div(cellW)), 'rRing');
      const rc = tv('f', ringF.add(0.5).mul(cellW), 'rRc');
      const nTh = tv('f', max(floor(rc.mul(TAU).div(cellW)), 3.0), 'rNth');
      const dir = select(fract(Bv.z.mul(7.31)).greaterThan(0.5), float(1.0), float(-1.0));
      const om = dir.mul(cls.mul(0.12).add(0.55)).mul(float(0.65).div(rc.div(S).mul(1.2).add(1.0)).add(0.35));
      const u = tv('f', fract(atan(d.y, d.x).sub(om.mul(t)).div(TAU)).mul(nTh), 'rU');
      const ci = floor(u);
      const fu = fract(u);
      const fr = fract(r.div(cellW));
      const key = tv('u', hash3(uOf(Bv.z.mul(65535.0)), uOf(ringF), uOf(ci)), 'rKey');
      const life = u01(pcg(key.add(uint(1)))).mul(0.95).add(0.55);
      const ph = tv('f', t.div(life).add(u01(pcg(key.add(uint(2))))), 'rPh');
      const k2 = tv('u', hash2(key, uOf(ph)), 'rK2');
      const lp = fract(ph);
      const sx = u01(k2).mul(0.56).add(0.22);
      const sy = u01(pcg(k2.add(uint(1)))).mul(0.56).add(0.22);
      const dens = exp(rc.div(S).mul(rc.div(S)).negate());
      const P = clamp(dens.mul(cls.mul(0.2).add(0.42)).mul(al), 0.0, 1.0);
      const alive = step(u01(pcg(k2.add(uint(2)))), P);
      const env = smoothstep(0.0, 0.1, lp).mul(float(1.0).sub(smoothstep(0.25, 1.0, lp)));
      // kształt iskry w px bufora: wzdłuż orbity wydłużona ×1,7 (smuga ruchu)
      const arcPx = rc.mul(TAU).div(nTh).mul(H.zoom);
      const dx = fu.sub(sx).mul(arcPx);
      const dy = fr.sub(sy).mul(cellPx);
      const sp = H.pxs.mul(0.95);
      const shape = exp(dx.mul(dx).mul(0.35).add(dy.mul(dy)).div(sp.mul(sp)).negate());
      spark.addAssign(alive.mul(env).mul(shape).mul(u01(pcg(k2.add(uint(3)))).mul(2.6).add(1.4)));
    });
  });
  const sparkCol = mix(c3(AMBER), vec3(1.0, 0.95, 0.86), 0.5);
  return vec4(sparkCol.mul(spark).mul(2.2).add(c3(AMBER).mul(glow).mul(0.045)), 0.0);
}

const LOOKS = { echo: echoLook, oblok: oblokLook, wir: wirLook, roj: rojLook };

/**
 * Materiał kwadu pełnoekranowego jednej propozycji (graf raz na propozycję). `rect` — uniform vec4 (x0, y0, x1, y1)
 * w px bufora (y od góry): poza nim wynik 0 (porównanie 2 × 2 w demie).
 */
export function createContactMaterial(style, block, rect) {
  const look = LOOKS[style];
  if (!look) throw new Error(`kontakty: nieznana propozycja ${style}`);
  const noiseTex = fxNoise.noise3D();
  const mat = new THREE.NodeMaterial();
  mat.name = `KontaktCzujnikow:${style}`;
  mat.transparent = true;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.lights = false;
  mat.fog = false;
  mat.forceSinglePass = true;
  // premultiplied „over”: rgb + tło × (1 − alfa); alfa celu bez zmian (tło zapisało 1)
  mat.premultipliedAlpha = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  mat.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
  mat.fragmentNode = Fn(() => {
    const H = header(block.node);
    const ctx = pixelSetup(H);
    const out = tv('v4', look(block.node, H, ctx, noiseTex), 'kOut');
    const p = ctx.px;
    const inRect = step(rect.x, p.x).mul(step(p.x, rect.z)).mul(step(rect.y, p.y)).mul(step(p.y, rect.w));
    // siatka bezpieczeństwa: bez NaN / ujemnych w buforze HDR (NaN rozlałby bloom)
    const rgb = clamp(out.rgb, vec3(0.0), vec3(64.0)).mul(inRect);
    const a = clamp(out.a, 0.0, 1.0).mul(inRect);
    return vec4(rgb, a);
  })();
  return mat;
}

/** Kwad pełnoekranowy propozycji w passie gry (warstwa 0, na końcu kolejki przezroczystej). */
export function createContactMesh(style, block) {
  const rect = uniform(new THREE.Vector4(-1, -1, 1e9, 1e9));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createContactMaterial(style, block, rect));
  mesh.name = `KontaktCzujnikow:${style}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;
  mesh.layers.set(0);
  mesh.userData.rect = rect;
  return mesh;
}

/** Tło: ciemny kosmos z gwiazdami w komórkach px CSS (jak niebo gry — gwiazdy nie skalują się z zoomem), słaba
 *  mgławica; paralaksa ~0,3% ruchu kamery. Pass tła (warstwa 1). */
export function createSpaceBackdrop(core) {
  const U = {
    cam: uniform(new THREE.Vector2(0, 0)),     // przesunięcie paralaksy [px CSS]
    res: uniform(new THREE.Vector2(1600, 900)),
    pxs: uniform(1)
  };
  const cloud = fxNoise.cloud2D();
  const mat = new THREE.NodeMaterial();
  mat.name = 'KontaktyTlo';
  mat.depthWrite = false;
  mat.depthTest = false;
  mat.lights = false;
  mat.fog = false;
  mat.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
  mat.fragmentNode = Fn(() => {
    const q = tv('v2', screenCoordinate.xy.div(U.pxs).add(U.cam), 'tQ');
    const uvc = screenCoordinate.xy.div(U.res).sub(0.5);
    const col = tv('v3', mix(vec3(0.0042, 0.0058, 0.0105), vec3(0.0026, 0.0032, 0.006), clamp(length(uvc).mul(1.4), 0.0, 1.0)), 'tCol');
    const n1 = texture(cloud, q.div(2600.0)).level(0);
    const n2 = texture(cloud, q.div(900.0).add(vec2(0.31, 0.77))).level(0);
    const neb = smoothstep(0.48, 0.85, n1.x.mul(0.65).add(n2.y.mul(0.35)));
    col.addAssign(vec3(0.009, 0.006, 0.017).mul(neb).add(vec3(0.003, 0.006, 0.011).mul(smoothstep(0.5, 0.9, n2.x))));
    const layers = [[7.0, 0.035, 0.35, 11], [19.0, 0.10, 1.1, 23], [41.0, 0.16, 2.4, 37]];
    for (const [cell, prob, gain, salt] of layers) {
      const g = q.div(cell);
      const c = floor(g);
      const h = hash3(uOf(c.x), uOf(c.y), uint(salt));
      const on = step(u01(h), prob);
      const off = vec2(u01(pcg(h.add(uint(1)))), u01(pcg(h.add(uint(2))))).mul(0.7).add(0.15);
      const dd = fract(g).sub(off).mul(cell);
      const star = on.mul(exp(dot(dd, dd).mul(-1.6))).mul(u01(pcg(h.add(uint(3)))).mul(0.8).add(0.2));
      const tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.72, 0.84, 1.0), u01(pcg(h.add(uint(4)))));
      col.addAssign(tint.mul(star).mul(gain));
    }
    return vec4(col, 1.0);
  })();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10000;
  mesh.layers.set(1);
  mesh.name = 'KontaktyTlo';
  core.scene.add(mesh);
  return {
    mesh,
    sync(cam, cssW, cssH) {
      // paralaksa: 0,3% przesunięcia świata w px CSS przy zoomie 1 (tło daleko)
      U.cam.value.set((cam.x * 0.003) % 100000, (cam.y * 0.003) % 100000);
      const pr = core.pixelRatio || 1;
      U.res.value.set(cssW * pr, cssH * pr);
      U.pxs.value = core.pxScale || pr;
    }
  };
}

/** Pomocnicza: zawinięcie do [0, 1) (początek kafla szumu w double na CPU). */
export const wrap01 = (v) => v - Math.floor(v);
