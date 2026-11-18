// HUTA — element 4 (dzielenie, runda 9): PRAWO RUCHU ARKUSZA OD ROZDZIELENIA (czysty JS, bez alokacji).
//
// Projekt: `.tmp/huta/formowanie/PROJEKT-chwyt-zwijanie.md` § 2.3. Wszystkie przebiegi liczone ANALITYCZNIE w chwili t od
// rozdzielenia (położenie, prędkość i przyspieszenie z tego samego wzoru — bez całkowania, więc spoczynek wypada dokładnie
// tam, gdzie liczył regulator, a lot swobodny ma prędkość stałą co do bitu):
//   WYRZUT     t ∈ [0, τ]: aₓ = (2Δv/τ) sin²(πt/τ) — listwy pola wzdłuż obu krawędzi
//   LOT        t ∈ [τ, t_g]: prędkość stała (żadna siła)
//   CHWYT      t = t_g: pole listwy przechyłu zamyka się na krawędzi −z (prędkość względna 0) i zaczyna HAMOWANIE:
//              aₓ = −A w(t − t_g), w — rampa (1 − cos)/2 w τ_r, stała, zanik w τ_r; T_h = 2D / v_g, A = v_g / (T_h − τ_r)
//   UNIESIENIE t ∈ [t_g, t_g + t_u]: y = h S5, zawias z: krawędź → `zHinge` (S5, ten sam czas)
//   PRZECHYŁ   t ∈ [t_p, t_p + t_θ], t_p = t_g + t_u: θ = 90° S5 wokół chwyconej krawędzi (dolny narożnik −z płyty)
// Ruch w −z po przechyle (grzebień, kaseta) — `stojak.js`.
import { CHWYT, HALF_T, PASS_Y, S5, S5d, S5dd, STOJAK } from './geometria.js';

const PI = Math.PI;
const HALF_PI = PI / 2;

/**
 * W(t) = ∫w (rampa hamowania), X(t) = ∫W; w — (1 − cos)/2 w τ_r, 1 przez t_f, (1 + cos)/2 w τ_r. `out` = [w, W, X].
 */
export function brakeRamp(t, tf, tr, out) {
  if (t <= 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  const k = tr / PI;
  const X1 = tr * tr / 4 - tr * tr / (PI * PI);   // X(τ_r)
  if (t < tr) {
    out[0] = 0.5 * (1 - Math.cos(t / k));
    out[1] = 0.5 * t - 0.5 * k * Math.sin(t / k);
    out[2] = 0.25 * t * t + 0.5 * k * k * (Math.cos(t / k) - 1);
    return out;
  }
  if (t < tr + tf) {
    const s = t - tr;
    out[0] = 1;
    out[1] = 0.5 * tr + s;
    out[2] = X1 + 0.5 * tr * s + 0.5 * s * s;
    return out;
  }
  const X2 = X1 + 0.5 * tr * tf + 0.5 * tf * tf;  // X(τ_r + t_f)
  if (t < 2 * tr + tf) {
    const s = t - tr - tf;
    out[0] = 0.5 * (1 + Math.cos(s / k));
    out[1] = 0.5 * tr + tf + 0.5 * s + 0.5 * k * Math.sin(s / k);
    out[2] = X2 + (0.5 * tr + tf) * s + 0.25 * s * s - 0.5 * k * k * (Math.cos(s / k) - 1);
    return out;
  }
  const T = 2 * tr + tf;
  const X3 = X2 + (0.5 * tr + tf) * tr + 0.25 * tr * tr + k * k;
  out[0] = 0;
  out[1] = tf + tr;
  out[2] = X3 + (tf + tr) * (t - T);
  return out;
}

/**
 * Plan lotu i chwytu z prędkości taśmy przy rozdzieleniu: wyrzut, chwila i miejsce chwytu, hamowanie. `out` (Float64Array
 * ≥ 9) = [v_k (po wyrzucie), x_k − x0 (droga wyrzutu), t_g, x_g − x0, v_g, A, t_f, T_h, D]. `x0` — tył przy rozdzieleniu.
 * `grab` = false — odpad / arkusz niezłapany (tylko wyrzut i lot).
 */
export function planFlight(x0, v0, grab, out) {
  const K = CHWYT.kick;
  const vk = v0 + K.dv;
  const dk = v0 * K.t + 0.5 * K.dv * K.t;
  out[0] = vk;
  out[1] = dk;
  if (!grab) { for (let i = 2; i < 9; i++) out[i] = 0; out[2] = -1; return out; }
  const xk = x0 + dk;
  const tg = xk >= CHWYT.xGrab ? K.t : K.t + (CHWYT.xGrab - xk) / vk;
  const xg = Math.max(xk, CHWYT.xGrab);
  const D = CHWYT.xStop - xg;
  const tr = CHWYT.ramp;
  const Th = Math.max(2 * tr, 2 * D / vk);
  out[2] = tg;
  out[3] = xg - x0;
  out[4] = vk;
  out[5] = vk / (Th - tr);
  out[6] = Th - 2 * tr;
  out[7] = Th;
  out[8] = D;
  return out;
}

/**
 * Ruch w x w chwili t od rozdzielenia (plan z `planFlight`, `F` — ten rekord): `out` = [x − x0, vₓ, aₓ, faza]
 * (faza: 0 wyrzut, 1 lot swobodny, 2 hamowanie, 3 spoczynek). `RB` — bufor rampy (3). Lot: vₓ = v_k bez obliczeń.
 */
export function motionX(t, v0, F, RB, out) {
  const K = CHWYT.kick;
  if (t < K.t) {
    const s = t / K.t;
    out[0] = v0 * t + K.dv * (0.5 * s * t + (Math.cos(2 * PI * s) - 1) * K.t / (4 * PI * PI));
    out[1] = v0 + K.dv * (s - Math.sin(2 * PI * s) / (2 * PI));
    const sn = Math.sin(PI * s);
    out[2] = 2 * K.dv / K.t * sn * sn;
    out[3] = 0;
    return out;
  }
  const tg = F[2];
  if (tg < 0 || t < tg) {
    out[0] = F[1] + F[0] * (t - K.t);
    out[1] = F[0];
    out[2] = 0;
    out[3] = 1;
    return out;
  }
  const tb = t - tg;
  if (tb >= F[7]) {
    // spoczynek: tył dokładnie na xStop (droga chwytu + droga hamowania)
    out[0] = F[3] + F[8];
    out[1] = 0; out[2] = 0; out[3] = 3;
    return out;
  }
  brakeRamp(tb, F[6], CHWYT.ramp, RB);
  out[0] = F[3] + F[4] * tb - F[5] * RB[2];
  out[1] = F[4] - F[5] * RB[1];
  out[2] = -F[5] * RB[0];
  out[3] = 2;
  return out;
}

/**
 * Uniesienie, zawias i przechył w chwili t (t_g — chwila chwytu, z0 — zawias przy rozdzieleniu, t_p — początek przechyłu,
 * −1 — jeszcze nie; najwcześniej t_g + t_u, później, gdy poprzedni arkusz nie odszedł jeszcze z wejścia): `out` = [lift,
 * ẏ, ÿ, z_h, ż_h, z̈_h, θ, ω, α].
 */
export function motionLift(t, tg, z0, tp, out) {
  const R = CHWYT.rise;
  const u = (t - tg) / R.t;
  const s = S5(u);
  const sd = S5d(u) / R.t;
  const sdd = S5dd(u) / (R.t * R.t);
  out[0] = R.h * s; out[1] = R.h * sd; out[2] = R.h * sdd;
  const dz = CHWYT.zHinge - z0;
  out[3] = z0 + dz * s; out[4] = dz * sd; out[5] = dz * sdd;
  const T = CHWYT.tilt.t;
  if (tp < 0) { out[6] = 0; out[7] = 0; out[8] = 0; return out; }
  const w = (t - tp) / T;
  out[6] = HALF_PI * S5(w); out[7] = HALF_PI * S5d(w) / T; out[8] = HALF_PI * S5dd(w) / (T * T);
  return out;
}

/**
 * MARSZ SPRZĘGNIĘTY: droga zawiasu w podziałkach G(u) dla postępu u = ΔM / P (0…1), rampa (1 − cos) szerokości r na
 * początku i końcu, plateau g_p = 1 / (1 − r). `out` = [G, g = dG/du, g' = d²G/du²].
 */
export function marchCam(u, out) {
  const r = STOJAK.uRamp;
  const gp = 1 / (1 - r);
  const k = r / PI;
  if (u <= 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  if (u >= 1) { out[0] = 1; out[1] = 0; out[2] = 0; return out; }
  if (u < r) {
    out[0] = gp * (0.5 * u - 0.5 * k * Math.sin(u / k));
    out[1] = gp * 0.5 * (1 - Math.cos(u / k));
    out[2] = gp * 0.5 * Math.sin(u / k) / k;
    return out;
  }
  if (u <= 1 - r) {
    out[0] = gp * (0.5 * r + (u - r));
    out[1] = gp;
    out[2] = 0;
    return out;
  }
  const s = u - (1 - r);
  out[0] = gp * (0.5 * r + 1 - 2 * r + 0.5 * s + 0.5 * k * Math.sin(s / k));
  out[1] = gp * 0.5 * (1 + Math.cos(s / k));
  out[2] = -gp * 0.5 * Math.sin(s / k) / k;
  return out;
}

/**
 * RUCH PIĘCIOMIANOWY (dosuw grzebienia, kaseta): z(τ) = Σ c_i τ^i od (z0, v0, a0) do (z1, 0, 0) w czasie T; T najmniejsze
 * (krok ×1,06) przy |v| ≤ vMax, |a| ≤ aMax i bez cofania (v · znak drogi ≥ 0). `C` — rekord (≥ 7): [c0…c5, T]. Zwraca
 * false, gdy takiego planu nie ma (np. ciało hamuje przed celem pośrednim — zmiana znaku przyspieszenia wymagałaby
 * cofnięcia): wtedy wołający dojeżdża starym planem i planuje dalej ze spoczynku. Bez alokacji.
 */
export function planQuintic(z0, v0, a0, z1, vMax, aMax, C) {
  const D = z1 - z0;
  const sg = D >= 0 ? 1 : -1;
  const ad = Math.abs(D);
  let T = Math.max(1.875 * ad / vMax, Math.sqrt(5.7735 * ad / aMax), 0.25);
  // wychodzimy z ruchu w stronę celu: najkrótszy czas może być krótszy niż ze spoczynku
  if (v0 * sg > 0) T = Math.max(T * 0.6, 0.25);
  for (let it = 0; it < 40; it++) {
    quinticCoef(z0, v0, a0, z1, T, C);
    if (quinticOk(C, T, sg, vMax, aMax)) { C[6] = T; return true; }
    T *= 1.06;
  }
  C[6] = T;
  return false;
}
/** Plan pięciomianowy w zadanym czasie T (współczynniki do `C`, C[6] = T); true, gdy spełnia ograniczenia i nie cofa. */
export function planQuinticT(z0, v0, a0, z1, T, vMax, aMax, C) {
  quinticCoef(z0, v0, a0, z1, T, C);
  C[6] = T;
  return quinticOk(C, T, z1 - z0 >= 0 ? 1 : -1, vMax, aMax);
}
function quinticCoef(z0, v0, a0, z1, T, C) {
  const D = z1 - z0;
  const T2 = T * T;
  const T3 = T2 * T;
  C[0] = z0; C[1] = v0; C[2] = 0.5 * a0;
  C[3] = (20 * D - 12 * v0 * T - 3 * a0 * T2) / (2 * T3);
  C[4] = (-30 * D + 16 * v0 * T + 3 * a0 * T2) / (2 * T3 * T);
  C[5] = (12 * D - 6 * v0 * T - a0 * T2) / (2 * T3 * T2);
}
function quinticOk(C, T, sg, vMax, aMax) {
  for (let i = 1; i <= 24; i++) {
    const t = T * i / 24;
    const v = C[1] + t * (2 * C[2] + t * (3 * C[3] + t * (4 * C[4] + t * 5 * C[5])));
    const a = 2 * C[2] + t * (6 * C[3] + t * (12 * C[4] + t * 20 * C[5]));
    if (Math.abs(v) > vMax * 1.0005 || Math.abs(a) > aMax * 1.0005 || v * sg < -1e-6) return false;
  }
  return true;
}
/** Stan ruchu pięciomianowego w chwili τ od początku planu: `out` = [z, v, a, zryw]; po T — cel w spoczynku. */
export function evalQuintic(C, tau, out) {
  const T = C[6];
  const t = tau < 0 ? 0 : tau > T ? T : tau;
  out[0] = C[0] + t * (C[1] + t * (C[2] + t * (C[3] + t * (C[4] + t * C[5]))));
  out[1] = C[1] + t * (2 * C[2] + t * (3 * C[3] + t * (4 * C[4] + t * 5 * C[5])));
  out[2] = 2 * C[2] + t * (6 * C[3] + t * (12 * C[4] + t * 20 * C[5]));
  out[3] = 6 * C[3] + t * (24 * C[4] + t * 60 * C[5]);
  if (tau >= T) { out[1] = 0; out[2] = 0; out[3] = 0; }
  return out;
}

/**
 * Środek masy płyty (szerokość W, grubość t) obróconej o θ wokół dolnej krawędzi −z (zawias z_h, spód y_b): względem
 * zawiasu z = W/2 cos θ − t/2 sin θ, y = W/2 sin θ + t/2 cos θ; pochodne z ω, α. `out` = [dz, dy, ż, ẏ, z̈, ÿ] (część
 * obrotowa — dodaje się do ruchu zawiasu).
 */
export function plateCom(W, th, theta, om, al, out) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const a = 0.5 * W;
  const b = 0.5 * th;
  out[0] = a * c - b * s;
  out[1] = a * s + b * c;
  out[2] = (-a * s - b * c) * om;
  out[3] = (a * c - b * s) * om;
  out[4] = (-a * c + b * s) * om * om + (-a * s - b * c) * al;
  out[5] = (-a * s - b * c) * om * om + (a * c - b * s) * al;
  return out;
}

/** Spód płyty w chwili rozdzielenia (oś pasa − półgrubość). */
export const Y_BOTTOM0 = PASS_Y - HALF_T;
