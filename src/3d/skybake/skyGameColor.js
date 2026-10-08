// src/3d/skybake/skyGameColor.js
//
// Barwa tekstury tła ↔ obraz na ekranie gry. NebulaSystem czyta PNG jako sRGB (sprzętowe
// dekodowanie do liniowego), a post gry kończy się acesGry → linearDoSrgb (src/3d/tsl/kolorGry.js).
// Wypiek opisuje obraz WYŚWIETLANY (liniowo, „Dl”) i zapisuje teksturę po ODWRÓCENIU acesGry,
// więc w grze wychodzi dokładnie to, co na podglądzie — bez tego gra przyciemniała głębokie czernie
// (acesGry(0,01) ≈ 0,004) i rozjaśniała półtony.
//
// Zakres: acesGry(1) ≈ 0,80, więc obraz wyświetlany ≤ 0,80 liniowo (≈ 0,906 sRGB); jaśniejsze
// piksele dochodzą do tekstury 1,0. Próg bloomu gry 0,9 (tekstury) ↔ obraz ≈ 0,78 liniowo — gaz tła
// trzymaj niżej, wyżej tylko gwiazdy.
import { Fn, clamp, max, mix, pow, sqrt, step, vec3 } from 'three/tsl';

/** Największa jasność wyświetlana osiągalna z tekstury (acesGry(1)). */
export const SKY_DISPLAY_MAX = (2.51 + 0.03) / (2.43 + 0.59 + 0.14);

/**
 * Odwrotność acesGry: y = x(2,51x + 0,03) / (x(2,43x + 0,59) + 0,14) → x ≥ 0.
 * (2,43y − 2,51)x² + (0,59y − 0,03)x + 0,14y = 0, pierwiastek dodatni (a < 0 dla y < 1,03).
 */
export const acesGryInv = /*@__PURE__*/ Fn(([yIn]) => {
  const y = clamp(yIn, vec3(0.0), vec3(SKY_DISPLAY_MAX));
  const a = y.mul(2.43).sub(2.51);
  const b = y.mul(0.59).sub(0.03);
  const c = y.mul(0.14);
  const disc = max(b.mul(b).sub(a.mul(c).mul(4.0)), vec3(0.0));
  return clamp(b.negate().sub(sqrt(disc)).div(a.mul(2.0)), vec3(0.0), vec3(1.0));
}).setLayout({ name: 'acesGryInv', type: 'vec3', inputs: [{ name: 'yIn', type: 'vec3' }] });

/** Standardowe kodowanie sRGB (zapis do RGBA8; gra dekoduje teksturę sprzętowo tym samym wzorem). */
export const srgbEncode = /*@__PURE__*/ Fn(([c]) => {
  const hi = pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)).mul(1.055).sub(0.055);
  const lo = c.mul(12.92);
  return mix(hi, lo, step(c, vec3(0.0031308)));
}).setLayout({ name: 'skySrgbEncode', type: 'vec3', inputs: [{ name: 'c', type: 'vec3' }] });

// ── Lustra CPU (testy, kontrola eksportu) ────────────────────────────────────

export function acesGryCpu(x) {
  const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return Math.min(1, Math.max(0, v));
}

export function acesGryInvCpu(yIn) {
  const y = Math.min(SKY_DISPLAY_MAX, Math.max(0, yIn));
  const a = 2.43 * y - 2.51;
  const b = 0.59 * y - 0.03;
  const c = 0.14 * y;
  const disc = Math.max(0, b * b - 4 * a * c);
  return Math.min(1, Math.max(0, (-b - Math.sqrt(disc)) / (2 * a)));
}

export function srgbEncodeCpu(x) {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
}

export function srgbDecodeCpu(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Obraz wyświetlany w grze (liniowo) z bajtu tekstury sRGB — gra bez bloomu i bez maski słońca. */
export function gameDisplayFromByteCpu(byte) {
  return acesGryCpu(srgbDecodeCpu(byte / 255));
}
