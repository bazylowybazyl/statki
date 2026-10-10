// src/3d/gas/gasCommon.js
//
// Wspólne funkcje TSL gazu (symulacja gasGrid.js, render gasVolume.js, iskry gasEmbers.js):
// barwa ciała czarnego z temperatury gazu i moc świecenia płomienia.
//
// Skala temperatury gazu (bezwymiarowa, jak w Niagara Fluids „Temperature”):
//   0,3 ≈ 900 K (ciemna czerwień, ledwo świeci), 1 ≈ 1600 K (pomarańcz), 2 ≈ 2600 K (żółć),
//   3 ≈ biel. Moc świecenia ∝ T² z progiem (fizyczne T⁴ gasiło całą pomarańczową kulę ognia —
//   widać było tylko biały rdzeń): T = 1 ≈ 0,9 HDR (pomarańcz na progu bloomu), T = 2,4 ≈ 5 (żółć).
// Funkcje bez `setLayout` (wklejane): biorą uniformy z parametrów, nie z domknięcia.

import { vec3, clamp, mix, smoothstep, max } from 'three/tsl';

/** Barwa ciała czarnego (jasność maks. kanału ~1) z temperatury gazu T. */
export function gasBlackbody(T) {
  const t = clamp(T, 0.0, 4.0);
  const c1 = mix(vec3(0.0), vec3(0.5, 0.055, 0.006), smoothstep(0.12, 0.42, t));
  const c2 = mix(c1, vec3(1.0, 0.19, 0.022), smoothstep(0.38, 0.85, t));
  const c3 = mix(c2, vec3(1.0, 0.34, 0.045), smoothstep(0.8, 1.3, t));
  const c4 = mix(c3, vec3(1.0, 0.56, 0.15), smoothstep(1.2, 1.9, t));
  return mix(c4, vec3(1.0, 0.86, 0.6), smoothstep(1.8, 2.8, t));
}

/**
 * PALETY OGNIA (barwa ognia per domena — `GasSlot.fire`, etap E1 2026-10-09; wiersze — etap E2): te same progi temperatury
 * co ciało czarne, inne barwy przystanków. `fire` to pozycja na liście WIERSZY (GAS_FIRE_ROWS) z liniowym przejściem
 * między sąsiednimi: 0 — ciało czarne (wybuchy, armata, struga „rakieta”), 1 — plazma Yamato i struga „plazma” (głęboki
 * błękit → błękit → rdzeń biało-błękitny; barwy jak receptura Yamato w WeaponFx: fire1 / fire0 / core0 znormalizowane do
 * maks. 1), 2 — wodór (struga Terra Nova: blady błękit z fioletem, rdzeń prawie biały). fire 0 i 1 — bit w bit jak w E1.
 * Moc świecenia (gasFirePower) bez zmian — paleta zmienia tylko barwę.
 */
export const GAS_FIRE_STOPS = Object.freeze({
  blackbody: Object.freeze([[0.5, 0.055, 0.006], [1.0, 0.19, 0.022], [1.0, 0.34, 0.045], [1.0, 0.56, 0.15], [1.0, 0.86, 0.6]]),
  blue: Object.freeze([[0.03, 0.08, 0.5], [0.07, 0.27, 1.0], [0.14, 0.46, 1.0], [0.33, 0.62, 1.0], [0.72, 0.86, 1.0]]),
  hydrogen: Object.freeze([[0.12, 0.15, 0.5], [0.3, 0.41, 1.0], [0.5, 0.66, 1.0], [0.7, 0.8, 1.0], [0.88, 0.92, 1.0]])
});
/** Wiersze palet w kolejności indeksu `fire` (0, 1, 2 …). */
export const GAS_FIRE_ROWS = Object.freeze([GAS_FIRE_STOPS.blackbody, GAS_FIRE_STOPS.blue, GAS_FIRE_STOPS.hydrogen]);
/** Największy `fire` (ostatni wiersz). */
export const GAS_FIRE_MAX = GAS_FIRE_ROWS.length - 1;
const GAS_FIRE_EDGES = [[0.12, 0.42], [0.38, 0.85], [0.8, 1.3], [1.2, 1.9], [1.8, 2.8]];

/**
 * Przystanki palety domeny (5 × vec3 TSL) dla `fire` 0..GAS_FIRE_MAX — liczyć RAZ na marsz (fire stałe w domenie), przed
 * pętlą próbek (zmienne przypisane jawnie — pułapka 29). Przejście wiersz k → k+1 przez mix(…, clamp(fire − k, 0, 1)):
 * przy fire ≤ 1 kolejne mieszania mają wagę 0 (wartość bez zmian — E1 bit w bit).
 */
export function gasFireStops(fire) {
  return GAS_FIRE_ROWS[0].map((c, i) => {
    let e = mix(vec3(c[0], c[1], c[2]), vec3(GAS_FIRE_ROWS[1][i][0], GAS_FIRE_ROWS[1][i][1], GAS_FIRE_ROWS[1][i][2]), clamp(fire, 0.0, 1.0));
    for (let k = 2; k < GAS_FIRE_ROWS.length; k++) {
      const r = GAS_FIRE_ROWS[k][i];
      e = mix(e, vec3(r[0], r[1], r[2]), clamp(fire.sub(k - 1), 0.0, 1.0));
    }
    const v = vec3(0.0).toVar();
    v.assign(e);
    return v;
  });
}

/** Barwa ognia (jasność maks. kanału ~1) z temperatury T i przystanków `gasFireStops` (fire = 0 — jak gasBlackbody). */
export function gasFirePalette(T, stops) {
  const t = clamp(T, 0.0, 4.0);
  let c = vec3(0.0);
  for (let i = 0; i < 5; i++) c = mix(c, stops[i], smoothstep(GAS_FIRE_EDGES[i][0], GAS_FIRE_EDGES[i][1], t));
  return c;
}

/** Lustro CPU `gasFirePalette` (fire 0..GAS_FIRE_MAX). */
export function gasFirePaletteCpu(T, fire, out = [0, 0, 0]) {
  const t = Math.min(4, Math.max(0, T));
  const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const cl = (x) => Math.min(1, Math.max(0, x));
  out[0] = 0; out[1] = 0; out[2] = 0;
  for (let i = 0; i < 5; i++) {
    const k = ss(GAS_FIRE_EDGES[i][0], GAS_FIRE_EDGES[i][1], t);
    for (let c = 0; c < 3; c++) {
      const a = GAS_FIRE_ROWS[0][i][c];
      let e = a + (GAS_FIRE_ROWS[1][i][c] - a) * cl(fire);
      for (let r = 2; r < GAS_FIRE_ROWS.length; r++) e += (GAS_FIRE_ROWS[r][i][c] - e) * cl(fire - (r - 1));
      out[c] += (e - out[c]) * k;
    }
  }
  return out;
}

/**
 * Blask ognia z objętości światła (barwa liczona kernelem z ciała czarnego) w palecie domeny: przy fire > 0 luminancja
 * blasku zostaje, barwa przechodzi w barwę wiersza (luminancja 1): błękit plazmy (fire 1), blady błękit wodoru (fire 2).
 */
export const GAS_FIRE_GLOW_BLUE = Object.freeze([0.57, 1.06, 1.64]);
export const GAS_FIRE_GLOW_HYDROGEN = Object.freeze([0.78, 1.0, 1.66]);

/** Barwa blasku domeny (TSL; luminancja `luma`) z przejściem wiersz 1 → 2 — fire ≤ 1 jak w E1. */
export function gasFireGlow(glow, luma, fire) {
  const b = GAS_FIRE_GLOW_BLUE, h = GAS_FIRE_GLOW_HYDROGEN;
  const target = mix(vec3(b[0], b[1], b[2]), vec3(h[0], h[1], h[2]), clamp(fire.sub(1.0), 0.0, 1.0));
  return mix(glow, target.mul(luma), clamp(fire, 0.0, 1.0));
}

/**
 * Moc świecenia gazu: T² · k z progiem (żar; chłodny dym nie świeci) + tempo spalania · kb
 * (płomień przy froncie spalania — w Niagarze „flame” z reakcji paliwa). Zwraca skalar
 * (mnożnik barwy ciała czarnego).
 */
export function gasFirePower(T, burn, kT, kBurn) {
  const t = max(T, 0.0);
  return t.mul(t).mul(kT).mul(smoothstep(0.18, 0.62, t)).add(max(burn, 0.0).mul(kBurn));
}

/** Luminancja (Rec. 709) — wagi świateł i progi. */
export function gasLuma(c) {
  return c.x.mul(0.2126).add(c.y.mul(0.7152)).add(c.z.mul(0.0722));
}

/** Lustro CPU barwy ciała czarnego (te same progi) — światła punktowe ognia na CPU. */
export function gasBlackbodyCpu(T, out = [0, 0, 0]) {
  const t = Math.min(4, Math.max(0, T));
  const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const mixTo = (c, r, g, b, k) => { c[0] += (r - c[0]) * k; c[1] += (g - c[1]) * k; c[2] += (b - c[2]) * k; };
  out[0] = 0; out[1] = 0; out[2] = 0;
  mixTo(out, 0.5, 0.055, 0.006, ss(0.12, 0.42, t));
  mixTo(out, 1.0, 0.19, 0.022, ss(0.38, 0.85, t));
  mixTo(out, 1.0, 0.34, 0.045, ss(0.8, 1.3, t));
  mixTo(out, 1.0, 0.56, 0.15, ss(1.2, 1.9, t));
  mixTo(out, 1.0, 0.86, 0.6, ss(1.8, 2.8, t));
  return out;
}
