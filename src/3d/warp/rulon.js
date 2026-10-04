// src/3d/warp/rulon.js
//
// Port 1:1 z dema (dema/warp-webgpu/rulon.js, 2026-10-03). W GRZE: uniformy RULON we wspólnej
// grupie renderu, piksele = bufor rysowania celu sceny (composerTarget), F = ogniskowa kamery
// perspektywy ośrodka; stan klatki pisze sterownik (warpNurt.js: setRulon).
// ZGINA SIĘ CAŁA GRA (user 2026-10-03: „wszystko ma się zaginać, planety, asteroidy, cała gra”):
// installRulonGlobal() (Core3D przy imporcie) przepuszcza pozycję wierzchołka KAŻDEGO materiału
// węzłowego przez rulonForward (rulonClip) — gałąź po jednolitym warunku: RULON.pass (Core3D = 1
// tylko w passach sceny, pre-passie halo i warstwie DIST) i RULON.k > 0 (skok). Bez skoku
// shader liczy to samo co wcześniej. Wyjątki: materiał passa cienia (`isShadowPassMaterial` —
// mapa cienia w świecie), `material.rulonBend = false` (płaszczyzny pełnoekranowe: mgławica liczy
// odwrotność we fragmencie, zasłona i dno ośrodka pasa). Przyciemnienie horyzontu walca (jasność
// rulonu) liczy RAZ post (odwrotność na piksel), maskę słońca — jej pass (odwrotność). Culling na czas
// rulonu: płaszczyzny kadru odsunięte o RULON_STATE.cullMargin (rulon wciąga do kadru świat zza
// jego brzegu). Moduły z własnym cullingiem CPU (pas asteroid, LOD ringu, aktywność warstw planet)
// nie widzą poszerzenia — ich obiekty spoza zwykłego kadru nie pojawiają się na brzegu walca.
//
// RULON (pomysł usera 2026-10-03): ładowanie skoku ZWIJA rzeczywistość wokół
// osi lotu i ZAWIJA ją do statku — jedna faza: walec zgięty W DÓŁ, od kamery
// (odwrócone U, „∩”), i lejek / klepsydra z szyjką przy statku („wciągać
// z przodu, wypluwać z tyłu”); za brzegiem świata pustka skoku. Oś = kurs skoku
// przez statek (gracz ustawia się w stronę skoku, zanim go odpali — w locie oś
// się nie obraca ani nie przesuwa). Płaszczyzna gry (kadłuby, szczeliny, blaski)
// zostaje płaska.
//
// JEDNO przekształcenie dla wszystkich warstw, w WIERZCHOŁKACH (gwiazdy,
// ośrodek, planety z poświatą i pierścieniem — `bendMaterial`; w grze tak samo
// skały pasa i każda inna siatka tła), więc bryły uginają się razem z rulonem.
// Mgławica (płaszczyzna z teksturą) — odwrotnością we fragmencie.
//
// KIESZEŃ: wokół bańki (pół-szerokość rc w bok, pół-długość ra wzdłuż) przestrzeń
// zostaje płaska — jak płaskie wnętrze bańki warpa; rzeczywistość zawija się
// NA bańkę, a ośrodek (drobiny bańki) płynie lejkiem bez zgniatania samej bańki.
//
// Kolejność (px ekranu, y w górę, od środka kadru; a — wzdłuż kursu od
// statku, s — w bok od osi; f — siła lejka 0..1, φ(a) = exp(−(a/Wa)²)):
//  1. WZDŁUŻ (ścisk przed kieszenią, wyrzut za nią), T = tanh, z = Wa·ZONE_K,
//     a_f = ra + 1,5 z:
//       a₁ = a − C·f·z·(T((a − a_f)/z) + T(a_f/z)) + E·f·z·(T((a + a_f)/z) − T(a_f/z));
//     a₁' = 1 − C·f·sech²(…) + E·f·sech²(…) ≥ 1 − C > 0 (monotoniczne);
//  2. W BOK — rzeczywistość ściągana do osi przy statku, kieszeń nietknięta:
//       s₁ = core(s, 1 − P·f·φ),  core(s, λ) = s·λ + (1 − λ)·rc·sat(s/rc),
//       sat(x) = x / (1 + x⁴)^¼ (łagodny ogranicznik: prawie liniowy do ~0,7 —
//       kieszeń płaska; daleko s·λ + przesunięcie; ściśle rosnące);
//  3. KOLANO — cały wszechświat w bok mieści się przed horyzontem:
//       σ = s₁ do s0, dalej s0 + L·T((s₁ − s0)/L)  (σ → s0 + L = `reach` × łuk horyzontu);
//  4. KRAWĘDZIE — brzeg świata zawinięty do statku (szyjka klepsydry):
//       σ' = core(σ, 1 − Pe·f·φ);
//  5. WALEC o krzywiźnie k (długość łuku σ' zachowana), kamera F px nad ekranem:
//       θ = k·σ',  x = sin θ / k,  d = 2 sin²(θ/2) / k,
//       q = ((a_c + a₁)·h + (s_c + x)·n) · F / (F + d);
//     horyzont: cos θ_h = 1 / (1 + F·k); przyciemnienie brzegu z σ (ciemny brzeg
//     idzie za krawędzią klepsydry).
// PRECYZJA (GPU, float32): WGSL dopuszcza błąd bezwzględny sin ~2⁻¹¹, a przy płaskim
// rulonie (k ≈ 0) θ ~ 10⁻⁶ — „sin θ / k” dawał szum w bok (drobiny przylotu w pionowych
// pasach, rozsypane siatki planet). Walec liczy się więc bez sin/atan sprzętowych:
// x = σ'·sinc θ, d = σ'·(θ/2)·sinc²(θ/2) (sinc — wielomian do θ¹², |θ| < 1,6),
// w odwrotności σ' = 2·(t/k)·atan(t)/t, atan(t)/t z redukcji argumentu i szeregu.
// Odwrotność: walec — równanie kwadratowe w t = tan(θ/2); wzdłuż — Newton;
// core — Newton (funkcja nieparzysta, wklęsła dla s > 0: zbieżność monotoniczna
// od s = y); kolano — atanh.
//
// Ta sama matematyka w TSL i w JS (bliźniak CPU: planety, testy) — zmiana
// w jednym = zmiana w drugim.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, atan, sqrt, abs, max, min, exp, log, sign,
  smoothstep, select, dot, modelViewProjection, varyingProperty, renderGroup, If, Loop
} from 'three/tsl';

const shared = (value, type) => uniform(value, type).setGroup(renderGroup);

export const RULON_DEFAULTS = Object.freeze({
  radiusH: 0.72,   // promień walca przy pełnym zwinięciu [× wysokość kadru]
  limbDark: 0.5,   // przyciemnienie przy horyzoncie (0 = brak) — bryła walca
  fadeFrom: 0.93,  // zanik od tej części kąta horyzontu (brzeg bez migotania)
  reach: 0.9,      // nieskończoność w bok = ta część łuku do horyzontu
  knee: 0.45,      // do tej części zasięgu odległość od osi bez kompresji
  throatH: 0.5,    // lejek: półszerokość wzdłuż kursu [× wysokość kadru]
  pinch: 0.93,     // ściągnięcie rzeczywistości do osi przy statku (0..0,97)
  edge: 0.93,      // zawinięcie krawędzi świata do statku (0..0,97)
  suck: 0.45,      // ścisk przed kieszenią (0..0,9)
  spit: 1.3,       // wyrzut za kieszenią (0..2,2)
  boost: 2.5,      // powiększenie ciał przeciąganych przez lejek (planety)
  pocket: 1.2      // kieszeń: × pół-wymiary bańki
});

// Szerokość stref ścisku / wyrzutu wzdłuż kursu [× Wa].
const ZONE_K = 0.4;
const NEWTON = 8;

/** Wspólne uniformy rulonu (jedna paczka dla wszystkich warstw). */
export const RULON = {
  k: shared(0, 'float'),                           // krzywizna [1/px]; 0 = płasko
  F: shared(1700, 'float'),                        // ogniskowa wirtualnej kamery [px]
  h: shared(new THREE.Vector2(1, 0), 'vec2'),     // kurs na ekranie (y w górę)
  sc: shared(0, 'float'),                          // oś: przesunięcie w bok od środka kadru [px]
  ac: shared(0, 'float'),                          // statek: położenie wzdłuż kursu od środka kadru [px]
  s0: shared(1e9, 'float'),                        // kolano kompresji [px od osi]
  L: shared(1, 'float'),                           // zasięg kompresji za kolanem [px]
  field: shared(0, 'float'),                       // lejek 0..1 (oś czasu skoku)
  Wa: shared(400, 'float'),                        // półszerokość lejka wzdłuż kursu [px]
  rc: shared(60, 'float'),                         // kieszeń: pół-szerokość [px]
  ra: shared(80, 'float'),                         // kieszeń: pół-długość [px]
  pinch: shared(RULON_DEFAULTS.pinch, 'float'),
  edge: shared(RULON_DEFAULTS.edge, 'float'),
  suck: shared(RULON_DEFAULTS.suck, 'float'),
  spit: shared(RULON_DEFAULTS.spit, 'float'),
  medW: shared(1, 'float'),                        // udział ośrodka w lejku
  pass: shared(0, 'float'),                        // 1 = pass świata (gięty), 0 = post, cienie, tło menu
  viewHalf: shared(new THREE.Vector2(960, 540), 'vec2'),
  limb: shared(RULON_DEFAULTS.limbDark, 'float'),
  fadeFrom: shared(RULON_DEFAULTS.fadeFrom, 'float')
};

/** Strojenie spoza uniformów (suwaki dema). */
export const RULON_TUNE = { throatH: RULON_DEFAULTS.throatH, boost: RULON_DEFAULTS.boost, pocket: RULON_DEFAULTS.pocket };

const K_EPS = 1e-9;

// --- TSL ----------------------------------------------------------------------
//
// W GRZE przekształcenia to CZYSTE funkcje WGSL (setLayout): three buduje ich kod raz na klasę
// buildera, a materiał tylko je woła — hak rulonu wchodzi do KAŻDEGO materiału, więc wklejone
// drzewo (~25 ms NodeBuildera na materiał) mnożyło czas rozgrzewki. Uniformy RULON idą jako
// PARAMETRY (pułapka 1: uniform złapany w domknięciu funkcji z layoutem czytałby cudzy slot),
// spakowane w 4 × vec4 + kurs. Pomocnicze funkcje biorą paczkę P (pola jak w RULON).
// Pośrednie wyniki na zmiennych (.toVar): three typuje głębokie drzewa wyrażeń wykładniczo.

const tanhT = (x) => {
  const xv = float(x).toVar();
  const e = exp(abs(xv).mul(-2.0)).toVar();
  return sign(xv).mul(float(1.0).sub(e).div(e.add(1.0))).toVar();
};

/** sat(x) = x / (1 + x⁴)^¼ i jego pochodna (1 + x⁴)^(−5/4). */
const satT = (x) => {
  const xv = float(x).toVar();
  const x2 = xv.mul(xv).toVar();
  const q = float(1.0).add(x2.mul(x2)).toVar();
  const r = sqrt(sqrt(q)).toVar();
  return vec2(xv.div(r), float(1.0).div(r.mul(q)));
};

/** core(s, λ) = s·λ + (1 − λ)·rc·sat(s/rc) — ściąga do osi, kieszeń przy osi bez zmian. */
const coreT = (s, lam, P) => {
  const sv = float(s).toVar();
  const lv = float(lam).toVar();
  const st = satT(sv.div(P.rc)).toVar();
  return sv.mul(lv).add(float(1.0).sub(lv).mul(P.rc).mul(st.x)).toVar();
};

/** Odwrotność core (Newton od s = y; pętla TSL — 8 kroków jednym ciałem). */
const coreInvT = (y, lam, P) => {
  const yv = float(y).toVar();
  const lv = float(lam).toVar();
  const s = yv.toVar();
  Loop(NEWTON, () => {
    const st = satT(s.div(P.rc)).toVar();
    const f = s.mul(lv).add(float(1.0).sub(lv).mul(P.rc).mul(st.x)).sub(yv);
    const df = lv.add(float(1.0).sub(lv).mul(st.y));
    s.subAssign(f.div(max(df, 1e-4)));
  });
  return s;
};

/** Kolano: odległość od osi → odległość na rulonie (ze znakiem). */
const kneeTsl = (s, P) => {
  const sv = float(s).toVar();
  const a = abs(sv).toVar();
  const over = max(a.sub(P.s0), 0.0).toVar();
  return sign(sv).mul(min(a, P.s0).add(P.L.mul(tanhT(over.div(P.L))))).toVar();
};

/** Odwrotność kolana. */
const kneeInvTsl = (sg, P) => {
  const sv = float(sg).toVar();
  const a = abs(sv).toVar();
  const over = min(max(a.sub(P.s0), 0.0).div(P.L), 0.999999).toVar();
  const at = log(float(1.0).add(over).div(float(1.0).sub(over))).mul(0.5);
  return sign(sv).mul(min(a, P.s0).add(P.L.mul(at))).toVar();
};

const bump = (a, P) => {
  const u = float(a).div(P.Wa).toVar();
  return exp(u.mul(u).negate()).toVar();
};

/** Wzdłuż kursu: a₁(a) i pochodna (ścisk przed kieszenią, wyrzut za nią). */
const alongT = (a, fw, P) => {
  const av = float(a).toVar();
  const z = P.Wa.mul(ZONE_K).toVar();
  const af = P.ra.add(z.mul(1.5)).toVar();
  const C = P.suck.mul(fw).toVar();
  const E = P.spit.mul(fw).toVar();
  const t0 = tanhT(af.div(z));
  const tf = tanhT(av.sub(af).div(z));
  const tr = tanhT(av.add(af).div(z));
  const a1 = av.sub(C.mul(z).mul(tf.add(t0))).add(E.mul(z).mul(tr.sub(t0)));
  const da = float(1.0).sub(C.mul(float(1.0).sub(tf.mul(tf)))).add(E.mul(float(1.0).sub(tr.mul(tr))));
  return vec2(a1, da);
};

// Horner krokami na zmiennej (zagnieżdżony wielomian three typował wykładniczo).
const horner = (z, coeffs) => {
  const p = float(coeffs[0]).toVar();
  for (let i = 1; i < coeffs.length; i++) p.assign(p.mul(z).add(coeffs[i]));
  return p;
};
const SINC_C = [1 / 6227020800, -1 / 39916800, 1 / 362880, -1 / 5040, 1 / 120, -1 / 6, 1];
const ATAN_C = [-1 / 15, 1 / 13, -1 / 11, 1 / 9, -1 / 7, 1 / 5, -1 / 3, 1];

/** sin(x)/x — wielomian w x² do x¹² (|x| < 1,6: błąd < 10⁻⁹), bez sin sprzętowego. */
const sincT = (x) => {
  const z = float(x).mul(x).toVar();
  return horner(z, SINC_C);
};

/** atan(t)/t — redukcja u = t/(1 + √(1 + t²)) (atan t = 2 atan u) i szereg do u¹⁴. */
const atanOverT = (t) => {
  const tv = float(t).toVar();
  const r = float(1.0).add(sqrt(float(1.0).add(tv.mul(tv)))).toVar();
  const u = tv.div(r).toVar();
  const z = u.mul(u).toVar();
  const s = horner(z, ATAN_C);
  return s.mul(2.0).div(r).toVar();
};

/** Jasność dla kąta θ: zanik przy horyzoncie, przyciemnienie brzegu (bryła walca). */
const rulonVis = (theta, k, P) => {
  const fk = P.F.mul(k).toVar();
  const th = atan(sqrt(fk.mul(fk.add(2.0)))).toVar();
  const u = abs(theta).div(max(th, 1e-6)).toVar();
  // Odwrócone krawędzie wzorem 1 − smoothstep (WGSL: low ≥ high to błąd shadera — pułapka 6).
  const fade = float(1.0).sub(smoothstep(P.fadeFrom, 1.0, u));
  return fade.mul(float(1.0).sub(P.limb.mul(u).mul(u)));
};

/** Paczka parametrów z 4 × vec4 + kurs (pola jak w RULON). */
const unpack = (p0, p1, p2, p3, h) => ({
  k: p0.x, F: p0.y, sc: p0.z, ac: p0.w,
  s0: p1.x, L: p1.y, field: p1.z, Wa: p1.w,
  rc: p2.x, ra: p2.y, pinch: p2.z, edge: p2.w,
  suck: p3.x, spit: p3.y, limb: p3.z, fadeFrom: p3.w,
  h
});
const packArgs = () => [
  vec4(RULON.k, RULON.F, RULON.sc, RULON.ac),
  vec4(RULON.s0, RULON.L, RULON.field, RULON.Wa),
  vec4(RULON.rc, RULON.ra, RULON.pinch, RULON.edge),
  vec4(RULON.suck, RULON.spit, RULON.limb, RULON.fadeFrom),
  RULON.h
];
const PACK_INPUTS = [
  { name: 'rp0', type: 'vec4' }, { name: 'rp1', type: 'vec4' }, { name: 'rp2', type: 'vec4' },
  { name: 'rp3', type: 'vec4' }, { name: 'rh', type: 'vec2' }
];

const rulonForwardFn = Fn(([p, w, p0, p1, p2, p3, hh]) => {
  const P = unpack(p0, p1, p2, p3, hh);
  const k = max(P.k, K_EPS).toVar();
  const h = vec2(P.h).toVar();
  const n = vec2(h.y.negate(), h.x).toVar();
  const fw = min(P.field.mul(w), 1.0).toVar();
  const a = dot(p, h).sub(P.ac).toVar();
  const phi = bump(a, P);
  const a1 = alongT(a, fw, P).x.toVar();
  const s1 = coreT(dot(p, n).sub(P.sc), float(1.0).sub(P.pinch.mul(fw).mul(phi)), P);
  const sig = kneeTsl(s1, P);
  const sigE = coreT(sig, float(1.0).sub(P.edge.mul(fw).mul(phi)), P);
  const theta = sigE.mul(k).toVar();
  const x = sigE.mul(sincT(theta)).toVar();
  const sh = sincT(theta.mul(0.5)).toVar();
  const g = P.F.div(P.F.add(sigE.mul(theta).mul(0.5).mul(sh).mul(sh))).toVar();
  const q = h.mul(P.ac.add(a1)).add(n.mul(P.sc.add(x))).mul(g);
  return vec3(q, rulonVis(sig.mul(k), k, P));
}).setLayout({
  name: 'rulonForward', type: 'vec3',
  inputs: [{ name: 'p', type: 'vec2' }, { name: 'w', type: 'float' }, ...PACK_INPUTS]
});

const rulonInverseFn = Fn(([q, p0, p1, p2, p3, hh]) => {
  const P = unpack(p0, p1, p2, p3, hh);
  const k = max(P.k, K_EPS).toVar();
  const h = vec2(P.h).toVar();
  const n = vec2(h.y.negate(), h.x).toVar();
  const F = P.F;
  const ap = dot(q, h).toVar();
  const lp = dot(q, n).toVar();
  // Walec.
  const c = F.mul(P.sc.sub(lp)).mul(k).toVar();
  const A = c.sub(lp.mul(2.0)).toVar();
  const B = F.mul(2.0).toVar();
  const D = B.mul(B).sub(A.mul(c).mul(4.0)).toVar();
  // t = tan(θ/2); t/k liczone bez k (przy płaskim rulonie t ~ 10⁻⁶).
  const tk = F.mul(P.sc.sub(lp)).mul(-2.0).div(B.add(sqrt(max(D, 0.0)))).toVar();
  const sigE = tk.mul(2.0).mul(atanOverT(tk.mul(k))).toVar();
  const theta = sigE.mul(k).toVar();
  const sh = sincT(theta.mul(0.5)).toVar();
  const g = F.div(F.add(sigE.mul(theta).mul(0.5).mul(sh).mul(sh))).toVar();
  // Wzdłuż — Newton od a = a₁.
  const fw = min(P.field, 1.0).toVar();
  const y = ap.div(g).sub(P.ac).toVar();
  const a = y.toVar();
  Loop(NEWTON, () => {
    const r = alongT(a, fw, P).toVar();
    a.subAssign(r.x.sub(y).div(max(r.y, 1e-4)));
  });
  const phi = bump(a, P);
  // Krawędzie, kolano, w bok.
  const sig = coreInvT(sigE, float(1.0).sub(P.edge.mul(fw).mul(phi)), P).toVar();
  const s = coreInvT(kneeInvTsl(sig, P), float(1.0).sub(P.pinch.mul(fw).mul(phi)), P);
  const p = h.mul(P.ac.add(a)).add(n.mul(P.sc.add(s)));
  // Za „nieskończonością” (s0 + L; po zawinięciu krawędzi — szyjka) — pustka skoku.
  const inf = abs(sig).div(P.s0.add(P.L));
  const vis = select(D.greaterThan(0.0), rulonVis(sig.mul(k), k, P), float(0.0)).mul(float(1.0).sub(smoothstep(0.97, 1.0, inf)));
  return vec3(p, vis);
}).setLayout({
  name: 'rulonInverse', type: 'vec3',
  inputs: [{ name: 'q', type: 'vec2' }, ...PACK_INPUTS]
});

/**
 * Płaski punkt [px, y w górę, od środka kadru] → vec3(punkt na ekranie, jasność).
 * `w` — udział warstwy w lejku (1 = cała rzeczywistość, 0 = sam rulon).
 */
export const rulonForward = (p, w) => rulonForwardFn(p, float(w), ...packArgs());

/** Punkt na ekranie [px, y w górę, od środka] → vec3(płaski punkt, jasność; 0 = za brzegiem). Lejek w pełnym udziale. */
export const rulonInverse = (q) => rulonInverseFn(q, ...packArgs());

/**
 * Materiał siatki tła → przez rulon w wierzchołkach (po pełnej projekcji
 * materiału, więc działa też z instancjami i `positionNode`): pozycja na
 * ekranie [px] przechodzi przez `rulonForward`, jasność mnoży kolor
 * (`mode`: 'rgb' — nieprzezroczyste i addytywne, 'all' — premultiplied).
 * Kamera passa: ortho w px albo perspektywa (dzielenie przez w). Siatka musi
 * mieć `frustumCulled = false` — płaskie miejsce bywa daleko poza kadrem.
 */
export function bendMaterial(mat, { weight = 1, mode = 'rgb' } = {}) {
  const vVis = varyingProperty('float', 'vRulonVis');
  mat.vertexNode = Fn(() => {
    const clip = vec4(modelViewProjection).toVar();
    const px = clip.xy.div(clip.w).mul(RULON.viewHalf);
    const r = rulonForward(px, float(weight)).toVar();
    vVis.assign(r.z);
    return vec4(r.xy.div(RULON.viewHalf).mul(clip.w), clip.z, clip.w);
  })();
  const base = mat.fragmentNode;
  mat.fragmentNode = Fn(() => {
    const col = vec4(base).toVar();
    return mode === 'all' ? col.mul(vVis) : vec4(col.rgb.mul(vVis), col.a);
  })();
  return mat;
}

// --- CPU (bliźniak TSL) -------------------------------------------------------

/**
 * Stan klatki: bend 0..1 (zwinięcie), field 0..1 (lejek), hx/hy — kurs na ekranie
 * (y w górę), shipX/shipY — statek [px od środka, y w górę], bubbleW/bubbleL —
 * pół-wymiary bańki [px] (kieszeń), W/H — kadr, F — ogniskowa.
 */
export function setRulon({ bend, field = 0, hx, hy, shipX, shipY, bubbleW = 50, bubbleL = 70, W, H, F, strength = 1 }) {
  const b = Math.max(0, bend * strength);
  const R = RULON_DEFAULTS.radiusH * H;
  RULON.k.value = b > 1e-4 ? b / R : 0;
  RULON.F.value = F;
  const l = Math.sqrt(hx * hx + hy * hy) || 1;   // bez Math.hypot (alokuje w V8, pułapka z 17)
  const ux = hx / l;
  const uy = hy / l;
  RULON.h.value.set(ux, uy);
  RULON.sc.value = shipX * -uy + shipY * ux;
  RULON.ac.value = shipX * ux + shipY * uy;
  RULON.field.value = Math.min(1, Math.max(0, field));
  RULON.Wa.value = Math.max(1, RULON_TUNE.throatH * H);
  RULON.rc.value = Math.max(4, bubbleW * RULON_TUNE.pocket);
  RULON.ra.value = Math.max(4, bubbleL * RULON_TUNE.pocket);
  RULON.viewHalf.value.set(W * 0.5, H * 0.5);
  const k = RULON.k.value;
  if (k > 0) {
    const reach = RULON_DEFAULTS.reach * Math.acos(1 / (1 + F * k)) / k;
    RULON.s0.value = reach * RULON_DEFAULTS.knee;
    RULON.L.value = reach - RULON.s0.value;
  } else {
    RULON.s0.value = 1e9;
    RULON.L.value = 1;
  }
}

function coreCpu(s, lam) {
  const rc = RULON.rc.value;
  const x = s / rc;
  return s * lam + (1 - lam) * rc * x / Math.pow(1 + x * x * x * x, 0.25);
}

function coreInvCpu(y, lam) {
  const rc = RULON.rc.value;
  let s = y;
  for (let i = 0; i < NEWTON; i++) {
    const x = s / rc;
    const q = 1 + x * x * x * x;
    s -= (coreCpu(s, lam) - y) / Math.max(lam + (1 - lam) * Math.pow(q, -1.25), 1e-4);
  }
  return s;
}

function kneeCpu(s) {
  const a = Math.abs(s);
  const s0 = RULON.s0.value;
  return Math.sign(s) * (Math.min(a, s0) + RULON.L.value * Math.tanh(Math.max(a - s0, 0) / RULON.L.value));
}

function kneeInvCpu(sg) {
  const a = Math.abs(sg);
  const s0 = RULON.s0.value;
  const over = Math.min(Math.max(a - s0, 0) / RULON.L.value, 0.999999);
  return Math.sign(sg) * (Math.min(a, s0) + RULON.L.value * Math.atanh(over));
}

const bumpCpu = (a) => {
  const u = a / RULON.Wa.value;
  return Math.exp(-u * u);
};

const _al = { a1: 0, da: 1 };
function alongCpu(a, fw) {
  const z = RULON.Wa.value * ZONE_K;
  const af = RULON.ra.value + 1.5 * z;
  const C = RULON.suck.value * fw;
  const E = RULON.spit.value * fw;
  const t0 = Math.tanh(af / z);
  const tf = Math.tanh((a - af) / z);
  const tr = Math.tanh((a + af) / z);
  _al.a1 = a - C * z * (tf + t0) + E * z * (tr - t0);
  _al.da = 1 - C * (1 - tf * tf) + E * (1 - tr * tr);
  return _al;
}

/** CPU: płaski punkt [px, y w górę] → { x, y, g (skala głębi), vis }. */
export function rulonForwardCpu(px, py, out = { x: 0, y: 0, g: 1, vis: 1 }, w = 1) {
  const k = Math.max(RULON.k.value, K_EPS);
  const F = RULON.F.value;
  const hx = RULON.h.value.x;
  const hy = RULON.h.value.y;
  const nx = -hy;
  const ny = hx;
  const sc = RULON.sc.value;
  const ac = RULON.ac.value;
  const fw = Math.min(1, RULON.field.value * w);
  const a = px * hx + py * hy - ac;
  const phi = bumpCpu(a);
  const a1 = alongCpu(a, fw).a1;
  const s1 = coreCpu(px * nx + py * ny - sc, 1 - RULON.pinch.value * fw * phi);
  const sig = kneeCpu(s1);
  const th = coreCpu(sig, 1 - RULON.edge.value * fw * phi) * k;
  const x = Math.sin(th) / k;
  const sh = Math.sin(th * 0.5);
  const g = F / (F + 2 * sh * sh / k);
  out.x = (hx * (ac + a1) + nx * (sc + x)) * g;
  out.y = (hy * (ac + a1) + ny * (sc + x)) * g;
  out.g = g;
  const thH = Math.acos(1 / (1 + F * k));
  const u = Math.abs(sig * k) / Math.max(thH, 1e-6);
  const f0 = RULON.fadeFrom.value;
  const tt = Math.min(1, Math.max(0, (u - 1) / (f0 - 1)));
  out.vis = tt * tt * (3 - 2 * tt) * (1 - RULON.limb.value * u * u);
  return out;
}

/** CPU: powiększenie ciała w płaskim punkcie (przeciąganie przez lejek). */
export function rulonBoostCpu(px, py) {
  const a = px * RULON.h.value.x + py * RULON.h.value.y - RULON.ac.value;
  return 1 + RULON_TUNE.boost * RULON.field.value * bumpCpu(a);
}

/** CPU: odwrotność (testy). */
export function rulonInverseCpu(qx, qy, out = { x: 0, y: 0, vis: 1 }) {
  const k = Math.max(RULON.k.value, K_EPS);
  const F = RULON.F.value;
  const hx = RULON.h.value.x;
  const hy = RULON.h.value.y;
  const nx = -hy;
  const ny = hx;
  const sc = RULON.sc.value;
  const ac = RULON.ac.value;
  const ap = qx * hx + qy * hy;
  const lp = qx * nx + qy * ny;
  const c = F * (sc - lp) * k;
  const A = c - 2 * lp;
  const B = 2 * F;
  const D = B * B - 4 * A * c;
  if (!(D > 0)) { out.x = qx; out.y = qy; out.vis = 0; return out; }
  const t = -2 * c / (B + Math.sqrt(D));
  const th = 2 * Math.atan(t);
  const sh = Math.sin(th * 0.5);
  const g = F / (F + 2 * sh * sh / k);
  const fw = Math.min(1, RULON.field.value);
  const y = ap / g - ac;
  let a = y;
  for (let i = 0; i < NEWTON; i++) {
    const r = alongCpu(a, fw);
    a -= (r.a1 - y) / Math.max(r.da, 1e-4);
  }
  const phi = bumpCpu(a);
  const sig = coreInvCpu(th / k, 1 - RULON.edge.value * fw * phi);
  if (Math.abs(sig) >= RULON.s0.value + RULON.L.value) { out.x = qx; out.y = qy; out.vis = 0; return out; }
  const s = coreInvCpu(kneeInvCpu(sig), 1 - RULON.pinch.value * fw * phi);
  out.x = hx * (ac + a) + nx * (sc + s);
  out.y = hy * (ac + a) + ny * (sc + s);
  out.vis = 1;
  return out;
}

/** Rulon płaski (poza skokiem): materiały liczą to samo co bez rulonu (gałąź po RULON.k). */
export function resetRulon() {
  if (RULON.k.value !== 0) RULON.k.value = 0;
  if (RULON.field.value !== 0) RULON.field.value = 0;
  RULON.s0.value = 1e9;
  RULON.L.value = 1;
  RULON_STATE.cullMargin = 0;
}

// --- Cała gra na rulonie --------------------------------------------------------

/** Stan CPU rulonu: odsunięcie płaszczyzn cullingu [j. świata] (0 = zwykły culling). */
export const RULON_STATE = { cullMargin: 0 };

/** Czy rulon jest zwinięty (CPU; Core3D: łapacze cienia, post). */
export function rulonActive() {
  return RULON.k.value > 1e-7;
}

/**
 * Pozycja w przestrzeni obcinania → przez rulon (gałąź po jednolitym warunku: pass świata
 * i zwinięty rulon). Wierzchołki za kamerą perspektywy (w ≤ 0) bez zmian.
 */
export function rulonClip(clipNode) {
  return Fn(() => {
    const c = vec4(clipNode).toVar('rulonClipPos');
    If(RULON.pass.greaterThan(0.5).and(RULON.k.greaterThan(1e-7)).and(c.w.greaterThan(1e-6)), () => {
      const px = c.xy.div(c.w).mul(RULON.viewHalf);
      const r = rulonForward(px, float(1.0));
      c.assign(vec4(r.xy.div(RULON.viewHalf).mul(c.w), c.z, c.w));
    });
    return c;
  })();
}

let _installed = false;

/**
 * Instaluje rulon dla CAŁEJ gry (raz, przed budową pierwszego materiału — Core3D przy imporcie):
 *  - NodeMaterial.setupHardwareClipping — three woła go w setup() tuż po ustawieniu wyjścia etapu
 *    wierzchołków (builder.stack.outputNode = pozycja obcinania), więc tu owijamy ją rulonClip;
 *    pomijamy materiał passa cienia (mapa cienia w świecie) i `rulonBend === false`;
 *  - Frustum.setFromProjectionMatrix — przy zwiniętym rulonie płaszczyzny boczne odsunięte o
 *    RULON_STATE.cullMargin (obiekty zza kadru, które rulon wciąga, nie wypadają w cullingu).
 * Pilnuje tests/warpNurt.test.mjs (źródła three: punkt zaczepienia w setup()).
 */
export function installRulonGlobal() {
  if (_installed) return;
  _installed = true;
  const proto = THREE.NodeMaterial.prototype;
  const origClip = proto.setupHardwareClipping;
  proto.setupHardwareClipping = function (builder) {
    if (this.rulonBend !== false && this.isShadowPassMaterial !== true && builder?.stack?.outputNode) {
      builder.stack.outputNode = rulonClip(builder.stack.outputNode);
    }
    return origClip.call(this, builder);
  };
  const fproto = THREE.Frustum.prototype;
  const origSet = fproto.setFromProjectionMatrix;
  fproto.setFromProjectionMatrix = function (m, coordinateSystem, reversedDepth) {
    const out = origSet.call(this, m, coordinateSystem, reversedDepth);
    const margin = RULON_STATE.cullMargin;
    if (margin > 0) for (let i = 0; i < 4; i++) this.planes[i].constant += margin;
    return out;
  };
}
