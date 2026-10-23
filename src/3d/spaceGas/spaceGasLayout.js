// src/3d/spaceGas/spaceGasLayout.js
//
// UKŁAD wejścia klatki gazu w otwartej przestrzeni — część CZYSTA, wspólna dla strony gry (src/game/spaceGasInput.js —
// pakuje) i renderu (spaceGas.js — czyta; blok migawki src/render/blocks/spaceGasBlock.js — kopiuje). Szew jak pył hal
// K-7 i przeszkody gazu wybuchów: Float64Array o stałym układzie, bez referencji do encji.

/** Rodzaje scen gazu (render wybiera pole dalekie i wygląd). */
export const SPACE_GAS_SCENE = Object.freeze({ none: 0, belt: 1, ring: 2 });

/** Bok siatki obwiedni [próbki]. */
export const SPACE_GAS_ENV_RES = 32;
/** Najwięcej strug odgazowania na klatkę. */
export const SPACE_GAS_MAX_JETS = 12;
const JET = 6;     // x, y (względem kotwicy), kierunek xy (od Słońca), promień skały, wydajność 0..1
/** Najwięcej wybuchów (fronty i wyrzut) i pocisków w polu na klatkę. */
export const SPACE_GAS_MAX_BLASTS = 8;
export const SPACE_GAS_MAX_BOLTS = 24;
const BLAST = 5;  // x, y (względem kotwicy), rozmiar (size fabryki wybuchów), wiek [s], życie [s]
const BOLT = 5;   // x, y (względem kotwicy), kierunek lotu xy (jednostkowy), prędkość [j/s]
/** Raster przekroju olbrzymów pasa (z = 0) na okno pola: bok [teksle], słowa 32-bitowe. */
export const SPACE_GAS_RASTER = 128;
const RASTER_WORDS = SPACE_GAS_RASTER * SPACE_GAS_RASTER / 32;

const G = SPACE_GAS_ENV_RES;
const HEADER = 32;
const ENV = HEADER;
const JETS = ENV + G * G * 2;
const BLASTS = JETS + SPACE_GAS_MAX_JETS * JET;
const BOLTS = BLASTS + SPACE_GAS_MAX_BLASTS * BLAST;
const RASTER = BOLTS + SPACE_GAS_MAX_BOLTS * BOLT;

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
  blasts: 22,       // wybuchów w polu
  bolts: 23,        // pocisków w polu
  rasterOn: 24,     // 1 — raster olbrzymów ma bryły (0 — kernel go pomija)
  rasterX0: 25,     // róg rastra (krawędź teksla 0, 0) względem kotwicy [j.]
  rasterY0: 26,
  rasterTexel: 27,  // bok teksla [j.]
  rasterVer: 28,    // wersja rastra (zmiana = wysyłka tekstury)
  header: HEADER,
  envBase: ENV,                 // G·G par (obwiednia gazu, udział lodu)
  jetBase: JETS,
  jetStride: JET,
  blastBase: BLASTS,
  blastStride: BLAST,
  boltBase: BOLTS,
  boltStride: BOLT,
  rasterBase: RASTER,           // słowa rastra (bit k = teksel k, wiersz po wierszu; y gry w dół)
  rasterWords: RASTER_WORDS,
  size: RASTER + RASTER_WORDS
});
