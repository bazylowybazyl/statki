// src/game/sector/sectorStars.js
//
// KLASY GWIAZD mapy gwiezdnej. Rozkład pod rozgrywkę, nie pod astronomię: prawdziwe karły M to ~3/4
// gwiazd, a na mapie byłyby nudnym czerwonym tłem — tu M i K to połowa, G i F to „ciepłe” rdzenie
// z życiem, gorące O / B, olbrzymy, białe karły i gwiazdy neutronowe — rzadkie i widoczne z daleka.
//
// `hz` — skala strefy życia względem Słońca (orbita mapy Ziemi 25 AU × hz; w przybliżeniu √L, przycięte
// do zakresu, w którym orbity mieszczą się w świecie 0–140 AU mapy). `sunRadius` — promień tarczy
// gwiazdy w świecie układu [j.] (Słońce gry: 200 tys., `SYSTEM_MAP_CONSTANTS.sunRadius`). `mapSize` —
// względny rozmiar kropki na mapie. `color` — barwa sRGB (UI i obraz), `life` — czy w strefie życia
// mogą być planety ziemskie i oceaniczne. Moduł czysty.

export const STAR_CLASSES = Object.freeze({
  O: Object.freeze({ id: 'O', label: 'błękitny olbrzym O', color: '#9db4ff', hz: 3.2, sunRadius: 300_000, mapSize: 1.6, weight: 0.012, planets: [0, 3], life: false }),
  B: Object.freeze({ id: 'B', label: 'gwiazda B', color: '#aabfff', hz: 2.6, sunRadius: 260_000, mapSize: 1.4, weight: 0.04, planets: [1, 4], life: false }),
  A: Object.freeze({ id: 'A', label: 'gwiazda A', color: '#cad7ff', hz: 1.7, sunRadius: 230_000, mapSize: 1.2, weight: 0.07, planets: [2, 6], life: true }),
  F: Object.freeze({ id: 'F', label: 'gwiazda F', color: '#f8f7ff', hz: 1.25, sunRadius: 210_000, mapSize: 1.08, weight: 0.10, planets: [3, 8], life: true }),
  G: Object.freeze({ id: 'G', label: 'żółty karzeł G', color: '#fff1d8', hz: 1.0, sunRadius: 200_000, mapSize: 1.0, weight: 0.15, planets: [3, 9], life: true }),
  K: Object.freeze({ id: 'K', label: 'pomarańczowy karzeł K', color: '#ffcf96', hz: 0.72, sunRadius: 170_000, mapSize: 0.9, weight: 0.22, planets: [2, 7], life: true }),
  M: Object.freeze({ id: 'M', label: 'czerwony karzeł M', color: '#ff9c5c', hz: 0.45, sunRadius: 130_000, mapSize: 0.75, weight: 0.30, planets: [1, 5], life: true }),
  KIII: Object.freeze({ id: 'KIII', label: 'czerwony olbrzym', color: '#ff7f45', hz: 2.2, sunRadius: 380_000, mapSize: 1.5, weight: 0.05, planets: [1, 4], life: false }),
  D: Object.freeze({ id: 'D', label: 'biały karzeł', color: '#e2eaff', hz: 0.25, sunRadius: 60_000, mapSize: 0.6, weight: 0.045, planets: [0, 3], life: false }),
  N: Object.freeze({ id: 'N', label: 'gwiazda neutronowa', color: '#b8e4ff', hz: 0.2, sunRadius: 25_000, mapSize: 0.55, weight: 0.012, planets: [0, 2], life: false })
});

export const STAR_CLASS_IDS = Object.freeze(Object.keys(STAR_CLASSES));

/** Szansa układu podwójnego (towarzysz: klasa ≤ klasy głównej, mniejsza). */
export const BINARY_CHANCE = 0.09;

/** Kolejność „temperatury” — towarzysz układu podwójnego nie jest gorętszy od gwiazdy głównej. */
const HEAT_ORDER = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];

/** Losuje klasę gwiazdy z wag `STAR_CLASSES`. */
export function pickStarClass(rng) {
  let sum = 0;
  for (const id of STAR_CLASS_IDS) sum += STAR_CLASSES[id].weight;
  let r = rng.next() * sum;
  for (const id of STAR_CLASS_IDS) {
    r -= STAR_CLASSES[id].weight;
    if (r < 0) return id;
  }
  return 'M';
}

/** Towarzysz układu podwójnego: chłodniejszy (albo biały karzeł), klasa z ciągu ≤ głównej. */
export function pickCompanionClass(primary, rng) {
  if (rng.chance(0.18)) return 'D';
  const i0 = HEAT_ORDER.indexOf(primary);
  const from = i0 < 0 ? HEAT_ORDER.indexOf('K') : i0;
  return HEAT_ORDER[Math.min(HEAT_ORDER.length - 1, from + rng.int(0, 3))];
}

/** Barwa klasy jako [r, g, b] 0–1 (sRGB) — obraz dema. */
export function starColorRgb(classId) {
  const hex = (STAR_CLASSES[classId] || STAR_CLASSES.G).color;
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
