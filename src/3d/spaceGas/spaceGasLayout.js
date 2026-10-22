// src/3d/spaceGas/spaceGasLayout.js
//
// UKŁAD wejścia klatki gazu w otwartej przestrzeni — część CZYSTA, wspólna dla strony gry (src/game/spaceGasInput.js —
// pakuje) i renderu (spaceGas.js — czyta; blok migawki src/render/blocks/spaceGasBlock.js — kopiuje). Szew jak pył hal
// K-7 i przeszkody gazu wybuchów: Float64Array o stałym układzie, bez referencji do encji.

/** Rodzaje scen gazu (render wybiera pole dalekie i wygląd). */
export const SPACE_GAS_SCENE = Object.freeze({ none: 0, belt: 1 });

/** Bok siatki obwiedni [próbki]. */
export const SPACE_GAS_ENV_RES = 32;
/** Najwięcej strug odgazowania na klatkę. */
export const SPACE_GAS_MAX_JETS = 12;
const JET = 6;     // x, y (względem kotwicy), kierunek xy (od Słońca), promień skały, wydajność 0..1

const G = SPACE_GAS_ENV_RES;
const HEADER = 32;

/** Układ wejścia klatki (Float64Array). */
export const SPACE_GAS_IN = Object.freeze({
  serial: 0,        // numer klatki gry
  active: 1,        // 1 — gaz w kadrze (obszar sceny przy kamerze), 0 — render nic nie liczy
  scene: 2,         // SPACE_GAS_SCENE
  dt: 3,            // czas gry klatki [s] (0 — pauza, sceny fabuły)
  anchorX: 4,       // kotwica sceny [świat gry, double]
  anchorY: 5,
  camX: 6,          // kamera względem kotwicy
  camY: 7,
  halfW: 8,         // pół kadru [j.]
  halfH: 9,
  windX: 10,        // wiatr [j/s] (D4: prędkość tła pola)
  windY: 11,
  sunX: 12,         // kierunek ku Słońcu w płaszczyźnie (jednostkowy, świat gry)
  sunY: 13,
  envVer: 14,       // wersja siatki obwiedni (zmiana = wysyłka tekstury)
  envX0: 15,        // róg siatki (środek próbki 0, 0) względem kotwicy [j.]
  envY0: 16,
  envCell: 17,      // odstęp próbek [j.]
  jets: 18,         // strug odgazowania
  windowCells: 19,  // okno pola [komórki] (128 / 256 / 384 — preset)
  cell: 20,         // bok komórki pola [j.]
  envMax: 21,       // największa obwiednia w siatce
  header: HEADER,
  envBase: HEADER,              // G·G par (obwiednia gazu, udział lodu)
  jetBase: HEADER + G * G * 2,
  jetStride: JET,
  size: HEADER + G * G * 2 + SPACE_GAS_MAX_JETS * JET
});

