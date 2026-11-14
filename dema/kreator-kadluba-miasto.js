// dema/kreator-kadluba-miasto.js — wspólne operacje dema kreatora (Stocznia i Warsztat) na polu projektu `city`
// (miasto 3D w odsłoniętym środku: generator src/game/hullDesign/hullDesignCity.js, obraz src/3d/hullCity3D/,
// opis docs/OPIS-miasto-3d.md). Czyste funkcje na obiekcie projektu; interfejs po zmianie woła requestBuild — pole
// `city` nie zmienia obrazu kadłuba (klucz kształtu go pomija), demo liczy wtedy samo miasto (worker budowy).

import { HD_CITY_LIMITS, HD_CITY_VARIANT_KEYS, normalizeHullCityField } from '../src/game/hullDesign/hullDesignSchema.js';

export { HD_CITY_LIMITS, HD_CITY_VARIANT_KEYS };

/** Etykiety kompozycji masywu (HD_CITY_VARIANTS). */
export const CITY_VARIANT_LABELS = Object.freeze({ A: 'A · grzbiet z dominantami', B: 'B · tarasy', C: 'C · skupiska wież' });

/** Suwaki miasta: klucz, etykieta, zakres, krok, zapis tekstu. `build` — zmienia masyw (worker), inaczej sam obraz. */
export const CITY_SLIDERS = Object.freeze([
  { k: 'density', label: 'Gęstość', min: HD_CITY_LIMITS.density[0], max: HD_CITY_LIMITS.density[1], step: 0.05, build: true },
  { k: 'height', label: 'Wysokość', min: HD_CITY_LIMITS.height[0], max: HD_CITY_LIMITS.height[1], step: 0.05, build: true },
  { k: 'lights', label: 'Światła', min: HD_CITY_LIMITS.lights[0], max: HD_CITY_LIMITS.lights[1], step: 0.05, build: false }
]);

/** Ustawienia miasta projektu (po normalizacji) albo null; `shown` — z domyślnymi, gdy pola nie ma. */
export function cityOf(d) { return normalizeHullCityField(d?.city); }
export function cityShown(d) { return normalizeHullCityField({ ...(d?.city || {}), on: true }); }
export function cityOn(d) { return !!cityOf(d)?.on; }

/** Włącz / wyłącz miasto (wyłączone zostaje z `on: false` — ustawienia nie giną). Zwraca nowy stan. */
export function cityToggle(d) {
  const on = !cityOn(d);
  d.city = { ...cityShown(d), on };
  return on;
}

/** Zmiana pól miasta (kompozycja, ziarno, suwaki, poświata); włącza miasto. */
export function citySet(d, patch) {
  const c = { ...cityShown(d), ...patch, on: true };
  d.city = normalizeHullCityField(c);
}

/** Klucz masywu (pola, które liczy generator) — inna wartość = nowe miasto z workera. */
export function cityBuildKey(c) {
  return c?.on ? `${c.variant}|${c.seed}|${c.density}|${c.height}` : 'off';
}

/** Tekst suwaka. */
export function citySliderText(k, v) { return `${Number(v).toFixed(2)}${k === 'lights' ? '' : '×'}`; }
