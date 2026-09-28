/**
 * Materiały skał asteroid: gęstość (masa) i twardość per typ — czyta je fizyka wydobycia
 * (src/game/asteroidMaterials.js → asteroidMining.js).
 *
 * Dawna konfiguracja kruchego destruktora heksów starego pola asteroid (siatki HEX_*, masy
 * zderzeń i taranowania, HP per rozmiar, COLLISION_CONFIG) odeszła razem z asteroidDestructor.js
 * w zadaniu 24 portu WebGPU — stare pole usunęło zadanie 21, wydobycie (21b) liczy własną fizykę.
 */

/**
 * Realne gęstości materiałów (g/cm³) skalowane do skali gry.
 * Hardness: 0.0 (jak puch) - 1.0 (jak diament).
 */
export const ASTEROID_MATERIAL = {
  ice:     { mass: 0.9,  hardness: 0.10 },  // Kuiper - łatwy łup, kruchy
  silicon: { mass: 2.3,  hardness: 0.35 },  // Lekki, kruchy
  crystal: { mass: 2.7,  hardness: 0.20 },  // Jak szkło - bardzo kruchy
  titan:   { mass: 4.5,  hardness: 0.95 },  // Najtwardszy
  iron:    { mass: 7.8,  hardness: 0.70 },  // Twardy
  copper:  { mass: 8.9,  hardness: 0.55 },  // Średnio
  uran:    { mass: 19.0, hardness: 0.60 },  // Bardzo gęste, średnia twardość
};
