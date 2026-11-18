// HUTA — formowanie: POLE NADELIPSY (czysty JS) — wspólne dla pasma (`linia.js`) i błony (`blona.js`).
// Przekrój |x/a|ⁿ + |y/b|ⁿ ≤ 1 ma pole A = K(n)·a·b, K(n) = 4·Γ(1 + 1/n)² / Γ(1 + 2/n) (π przy n = 2, 4 przy n → ∞).

function gammaFn(z) {
  // Lanczos (g = 7) — tylko przy ładowaniu modułu
  const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  z -= 1;
  let x = p[0];
  for (let i = 1; i < 9; i++) x += p[i] / (z + i);
  const t = z + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
export const AREA_N0 = 2;
export const AREA_DN = 0.05;
export const AREA_TAB = new Float64Array(201);
for (let i = 0; i < AREA_TAB.length; i++) {
  const n = AREA_N0 + i * AREA_DN;
  AREA_TAB[i] = 4 * gammaFn(1 + 1 / n) ** 2 / gammaFn(1 + 2 / n);
}
/** Współczynnik pola nadelipsy K(n) (A = K·a·b). */
export function areaK(n) {
  let f = (n - AREA_N0) / AREA_DN;
  if (f <= 0) return AREA_TAB[0];
  if (f >= AREA_TAB.length - 1) return AREA_TAB[AREA_TAB.length - 1];
  const i = f | 0;
  f -= i;
  return AREA_TAB[i] + (AREA_TAB[i + 1] - AREA_TAB[i]) * f;
}
