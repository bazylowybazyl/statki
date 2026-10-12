// src/game/hallGas3dInput.js
//
// GAZ I PYŁ HALI K-7 v2 — WEJŚCIE KLATKI po stronie gry (czyste funkcje: bez three, DOM i Core3D; testy node).
// Nadzbiór wejścia pyłu 2D (src/game/hallDustInput.js — wybór hali przy kamerze, przekształcenie hala → gra w double,
// okręty z maską obrysu, pozy obsługi stanowisk) + BLOK DACHU (docs/BRIEF-gaz-hali-3d.md § 4): fizyczny otwór (ułamek
// otwarcia i prostokąt w układzie hali — brzeg wypływu i okno słońca), krycie dachu w obrazie (K7RoofFade) i wersja
// układu. Krok efektów (src/3d/hallGas3d/hallGas3d.js) czyta tylko tę tablicę.
import { HALL_GAS3D_IN, HALL_GAS3D_IN_VERSION } from '../3d/hallGas3d/hallGas3dLayout.js';
import { packHallDustFrame } from './hallDustInput.js';

export { HALL_GAS3D_IN, HALL_GAS3D_IN_VERSION };

export function createHallGas3dInput() {
  return new Float64Array(HALL_GAS3D_IN.size);
}

const clamp01 = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0;
};
const num = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

/**
 * Wejście klatki 3D: jak packHallDustFrame (te same pola `o`) + `o.roof` = { open (0..1 — ułamek otwarcia dachu),
 * x0, z0, x1, z1 (prostokąt otworu w układzie hali [j.]), view (krycie dachu w obrazie 0..1) }. Bez `roof` — dach zamknięty
 * i niewidoczny w obrazie (gaz nad kadłubem widać).
 */
export function packHallGas3dFrame(out, o = {}) {
  packHallDustFrame(out, o);
  const I = HALL_GAS3D_IN;
  const r = o.roof;
  out[I.version] = HALL_GAS3D_IN_VERSION;
  out[I.roofOpen] = r ? clamp01(r.open) : 0;
  out[I.roofX0] = r ? num(r.x0) : 0;
  out[I.roofZ0] = r ? num(r.z0) : 0;
  out[I.roofX1] = r ? num(r.x1) : 0;
  out[I.roofZ1] = r ? num(r.z1) : 0;
  out[I.roofView] = r ? clamp01(r.view) : 0;
  return out;
}
