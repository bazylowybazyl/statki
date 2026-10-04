// dema/warp-webgpu/rulon.js
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
  smoothstep, select, dot, modelViewProjection, varyingProperty
} from 'three/tsl';

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
  k: uniform(0),                           // krzywizna [1/px]; 0 = płasko
  F: uniform(1700),                        // ogniskowa wirtualnej kamery [px]
  h: uniform(new THREE.Vector2(1, 0)),     // kurs na ekranie (y w górę)
  sc: uniform(0),                          // oś: przesunięcie w bok od środka kadru [px]
  ac: uniform(0),                          // statek: położenie wzdłuż kursu od środka kadru [px]
  s0: uniform(1e9),                        // kolano kompresji [px od osi]
  L: uniform(1),                           // zasięg kompresji za kolanem [px]
  field: uniform(0),                       // lejek 0..1 (oś czasu skoku)
  Wa: uniform(400),                        // półszerokość lejka wzdłuż kursu [px]
  rc: uniform(60),                         // kieszeń: pół-szerokość [px]
  ra: uniform(80),                         // kieszeń: pół-długość [px]
  pinch: uniform(RULON_DEFAULTS.pinch),
  edge: uniform(RULON_DEFAULTS.edge),
  suck: uniform(RULON_DEFAULTS.suck),
  spit: uniform(RULON_DEFAULTS.spit),
  medW: uniform(1),                        // udział ośrodka w lejku
  viewHalf: uniform(new THREE.Vector2(960, 540)),
  limb: uniform(RULON_DEFAULTS.limbDark),
  fadeFrom: uniform(RULON_DEFAULTS.fadeFrom)
};

/** Strojenie spoza uniformów (suwaki dema). */
export const RULON_TUNE = { throatH: RULON_DEFAULTS.throatH, boost: RULON_DEFAULTS.boost, pocket: RULON_DEFAULTS.pocket };

const K_EPS = 1e-9;

// --- TSL ----------------------------------------------------------------------

const tanhT = (x) => {
  const e = exp(abs(x).mul(-2.0));
  return sign(x).mul(float(1.0).sub(e).div(e.add(1.0)));
};

/** sat(x) = x / (1 + x⁴)^¼ i jego pochodna (1 + x⁴)^(−5/4). */
const satT = (x) => {
  const x2 = x.mul(x);
  const q = float(1.0).add(x2.mul(x2));
  const r = sqrt(sqrt(q));
  return vec2(x.div(r), float(1.0).div(r.mul(q)));
};

/** core(s, λ) = s·λ + (1 − λ)·rc·sat(s/rc) — ściąga do osi, kieszeń przy osi bez zmian. */
const coreT = (s, lam) => s.mul(lam).add(float(1.0).sub(lam).mul(RULON.rc).mul(satT(s.div(RULON.rc)).x));

/** Odwrotność core (Newton od s = y). */
const coreInvT = (y, lam) => {
  const s = vec2(y, 0.0).x.toVar();
  for (let i = 0; i < NEWTON; i++) {
    const st = satT(s.div(RULON.rc));
    const f = s.mul(lam).add(float(1.0).sub(lam).mul(RULON.rc).mul(st.x)).sub(y);
    const df = lam.add(float(1.0).sub(lam).mul(st.y));
    s.subAssign(f.div(max(df, 1e-4)));
  }
  return s;
};

/** Kolano: odległość od osi → odległość na rulonie (ze znakiem). */
const kneeTsl = (s) => {
  const a = abs(s);
  const over = max(a.sub(RULON.s0), 0.0);
  return sign(s).mul(min(a, RULON.s0).add(RULON.L.mul(tanhT(over.div(RULON.L)))));
};

/** Odwrotność kolana. */
const kneeInvTsl = (sg) => {
  const a = abs(sg);
  const over = min(max(a.sub(RULON.s0), 0.0).div(RULON.L), 0.999999);
  const at = log(float(1.0).add(over).div(float(1.0).sub(over))).mul(0.5);
  return sign(sg).mul(min(a, RULON.s0).add(RULON.L.mul(at)));
};

const bump = (a) => {
  const u = a.div(RULON.Wa);
  return exp(u.mul(u).negate());
};

/** Wzdłuż kursu: a₁(a) i pochodna (ścisk przed kieszenią, wyrzut za nią). */
const alongT = (a, fw) => {
  const z = RULON.Wa.mul(ZONE_K);
  const af = RULON.ra.add(z.mul(1.5));
  const C = RULON.suck.mul(fw);
  const E = RULON.spit.mul(fw);
  const t0 = tanhT(af.div(z));
  const tf = tanhT(a.sub(af).div(z));
  const tr = tanhT(a.add(af).div(z));
  const a1 = a.sub(C.mul(z).mul(tf.add(t0))).add(E.mul(z).mul(tr.sub(t0)));
  const da = float(1.0).sub(C.mul(float(1.0).sub(tf.mul(tf)))).add(E.mul(float(1.0).sub(tr.mul(tr))));
  return vec2(a1, da);
};

/** sin(x)/x — wielomian w x² do x¹² (|x| < 1,6: błąd < 10⁻⁹), bez sin sprzętowego. */
const sincT = (x) => {
  const z = x.mul(x);
  return float(1.0).add(z.mul(float(-1 / 6).add(z.mul(float(1 / 120).add(z.mul(float(-1 / 5040)
    .add(z.mul(float(1 / 362880).add(z.mul(float(-1 / 39916800).add(z.mul(1 / 6227020800))))))))))));
};

/** atan(t)/t — redukcja u = t/(1 + √(1 + t²)) (atan t = 2 atan u) i szereg do u¹⁴. */
const atanOverT = (t) => {
  const r = float(1.0).add(sqrt(float(1.0).add(t.mul(t))));
  const u = t.div(r);
  const z = u.mul(u);
  const s = float(1.0).add(z.mul(float(-1 / 3).add(z.mul(float(1 / 5).add(z.mul(float(-1 / 7)
    .add(z.mul(float(1 / 9).add(z.mul(float(-1 / 11).add(z.mul(float(1 / 13).add(z.mul(-1 / 15))))))))))))));
  return s.mul(2.0).div(r);
};

/** Jasność dla kąta θ: zanik przy horyzoncie, przyciemnienie brzegu (bryła walca). */
const rulonVis = (theta, k) => {
  const fk = RULON.F.mul(k);
  const th = atan(sqrt(fk.mul(fk.add(2.0))));
  const u = abs(theta).div(max(th, 1e-6));
  const fade = smoothstep(1.0, RULON.fadeFrom, u);
  return fade.mul(float(1.0).sub(RULON.limb.mul(u).mul(u)));
};

/**
 * Płaski punkt [px, y w górę, od środka kadru] → vec3(punkt na ekranie, jasność).
 * `w` — udział warstwy w lejku (1 = cała rzeczywistość, 0 = sam rulon).
 */
export const rulonForward = Fn(([p, w]) => {
  const k = max(RULON.k, K_EPS);
  const h = RULON.h;
  const n = vec2(h.y.negate(), h.x);
  const fw = min(RULON.field.mul(w), 1.0);
  const a = dot(p, h).sub(RULON.ac).toVar();
  const phi = bump(a).toVar();
  const a1 = alongT(a, fw).x;
  const s1 = coreT(dot(p, n).sub(RULON.sc), float(1.0).sub(RULON.pinch.mul(fw).mul(phi)));
  const sig = kneeTsl(s1).toVar();
  const sigE = coreT(sig, float(1.0).sub(RULON.edge.mul(fw).mul(phi))).toVar();
  const theta = sigE.mul(k).toVar();
  const x = sigE.mul(sincT(theta));
  const sh = sincT(theta.mul(0.5));
  const g = RULON.F.div(RULON.F.add(sigE.mul(theta).mul(0.5).mul(sh).mul(sh)));
  const q = h.mul(RULON.ac.add(a1)).add(n.mul(RULON.sc.add(x))).mul(g);
  return vec3(q, rulonVis(sig.mul(k), k));
});

/** Punkt na ekranie [px, y w górę, od środka] → vec3(płaski punkt, jasność; 0 = za brzegiem). Lejek w pełnym udziale. */
export const rulonInverse = Fn(([q]) => {
  const k = max(RULON.k, K_EPS);
  const h = RULON.h;
  const n = vec2(h.y.negate(), h.x);
  const F = RULON.F;
  const ap = dot(q, h);
  const lp = dot(q, n);
  // Walec.
  const c = F.mul(RULON.sc.sub(lp)).mul(k);
  const A = c.sub(lp.mul(2.0));
  const B = F.mul(2.0);
  const D = B.mul(B).sub(A.mul(c).mul(4.0));
  // t = tan(θ/2); t/k liczone bez k (przy płaskim rulonie t ~ 10⁻⁶).
  const tk = F.mul(RULON.sc.sub(lp)).mul(-2.0).div(B.add(sqrt(max(D, 0.0))));
  const sigE = tk.mul(2.0).mul(atanOverT(tk.mul(k))).toVar();
  const theta = sigE.mul(k).toVar();
  const sh = sincT(theta.mul(0.5));
  const g = F.div(F.add(sigE.mul(theta).mul(0.5).mul(sh).mul(sh)));
  // Wzdłuż — Newton od a = a₁.
  const fw = min(RULON.field, 1.0);
  const y = ap.div(g).sub(RULON.ac).toVar();
  const a = y.toVar();
  for (let i = 0; i < NEWTON; i++) {
    const r = alongT(a, fw);
    a.subAssign(r.x.sub(y).div(max(r.y, 1e-4)));
  }
  const phi = bump(a).toVar();
  // Krawędzie, kolano, w bok.
  const sig = coreInvT(sigE, float(1.0).sub(RULON.edge.mul(fw).mul(phi))).toVar();
  const s = coreInvT(kneeInvTsl(sig), float(1.0).sub(RULON.pinch.mul(fw).mul(phi)));
  const p = h.mul(RULON.ac.add(a)).add(n.mul(RULON.sc.add(s)));
  // Za „nieskończonością” (s0 + L; po zawinięciu krawędzi — szyjka) — pustka skoku.
  const inf = abs(sig).div(RULON.s0.add(RULON.L));
  const vis = select(D.greaterThan(0.0), rulonVis(sig.mul(k), k), float(0.0)).mul(smoothstep(1.0, 0.97, inf));
  return vec3(p, vis);
});

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
  const l = Math.hypot(hx, hy) || 1;
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
