// src/3d/gas/gasObstacleLayout.js
//
// UKŁAD danych PRZESZKÓD GAZU wybuchów (F2 audytu 2026-10-08, etap C 2026-10-09) — część CZYSTA, wspólna dla strony gry
// (src/game/gasObstacleInput.js — pakuje wejście klatki) i renderu (src/3d/explosions/explosionFx.js → gasGrid.js).
// Szew jak pył hal K-7 (hallDustLayout.js): Float64Array o stałym układzie, bez referencji do encji.

/** Maska obrysu kadłuba (src/game/hullFootprint.js; = HALL_DUST_MASK pyłu hal): 64 × 32 bity w 64 słowach. */
export const GAS_HULL_MASK = Object.freeze({ w: 64, h: 32, words: 64 });

/**
 * Rekord kadłuba / obrysu statyki: kotwica, osie układu kadłuba (jednostkowe), róg maski i bok teksla w układzie kadłuba
 * [j.], prędkość kotwicy [j./s], prędkość kątowa [rad/s], zasięg (najdalszy róg maski) [j.], klucz rodu (hull.dmgKey —
 * gospodarz domeny), uid i wersja maski (pamięć pasm masek), słowa maski. W WEJŚCIU świat gry (y w dół); w gasGrid scena
 * (x gry, −y gry; ω sceny = −ω gry).
 */
export const GAS_HULL_REC = Object.freeze({
  ax: 0, ay: 1, ex: 2, ey: 3, fx: 4, fy: 5, x0: 6, y0: 7, tx: 8, ty: 9, vx: 10, vy: 11, w: 12, reach: 13,
  key: 14, uid: 15, ver: 16, mask: 18, stride: 18 + 64
});

const MAX_BOXES = 1024;
const MAX_FOOTS = 24;
const MAX_HULLS = 32;
const BOX = 6;   // cx, cy, ux, uy (oś pudła, jednostkowa), pół długości wzdłuż u, pół szerokości

/** Układ tablicy wejścia klatki (Float64Array, świat gry). */
export const GAS_OBST_IN = Object.freeze({
  serial: 0,        // numer klatki gry
  statVer: 1,       // wersja bloku statyki (0 = nigdy; zmiana = nowy raster domen)
  boxes: 2,         // pudeł statyki
  foots: 3,         // obrysów statyki (ruszone kawałki budowli)
  hulls: 4,         // kadłubów-przeszkód w tej klatce
  dropped: 5,       // kadłubów w domenach bez miejsca w tablicy
  header: 8,
  maxBoxes: MAX_BOXES, maxFoots: MAX_FOOTS, maxHulls: MAX_HULLS, boxStride: BOX,
  boxBase: 8,
  footBase: 8 + MAX_BOXES * BOX,
  hullBase: 8 + MAX_BOXES * BOX + MAX_FOOTS * GAS_HULL_REC.stride,
  size: 8 + MAX_BOXES * BOX + (MAX_FOOTS + MAX_HULLS) * GAS_HULL_REC.stride
});
