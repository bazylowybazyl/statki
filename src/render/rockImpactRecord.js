// src/render/rockImpactRecord.js
//
// Rekord ROCK_IMPACT strumienia rozkazów renderu (src/render/renderCommands.js — RC.ROCK_IMPACT): uderzenie, szorowanie
// i osiadanie ciała na planetoidzie pod bazą piratów (misja 1). Pisze gra (src/game/story/pirateRockImpacts.js — kontrakt
// z fizyką upadku bazy), czyta obraz (src/3d/pirateRockImpactFx.js — dekoder i efekty). Czysty moduł (bez three, DOM
// i `window`): kod, układ pól, rodzaje.

/** Kod typu rekordu (zakres „świat” 74–127; 112–115 zarezerwowane dla tego toru). */
export const ROCK_IMPACT_CODE = 112;

/**
 * Układ rekordu: rodzaj zdarzenia (ROCK_EVENT), id ciała (liczba — gra mapuje napisy na liczby), rodzaj ciała (indeks
 * w ROCK_BODY_KINDS), punkt styku (świat gry: x, y, z — wysokość, ujemna pod płaszczyzną gry), normalna skały (układ gry:
 * y w dół, z w górę), prędkość wzdłuż normalnej [j/s, ≥ 0 — zbliżanie], styczna [j/s], masa (silnika), rozmiar (promień
 * łaty styku / ciała [j.]), energia (½·m·v²), prędkość ciała (układ gry; szorowanie — kierunek śladu; 0 = brak).
 */
export const ROCK_IMPACT_REC = Object.freeze({
  TYPE: 0, ID: 1, KIND: 2, X: 3, Y: 4, Z: 5, NX: 6, NY: 7, NZ: 8, SPEED: 9, SLIDE: 10, MASS: 11, SIZE: 12, ENERGY: 13,
  VX: 14, VY: 15, VZ: 16, WORDS: 17
});

/**
 * Rodzaj zdarzenia. BLAST — wybuch / kłąb w głębi BEZ skały (wieża przebija dysk mieszkalny): punkt w powietrzu, normalna =
 * kierunek główny (ruch ciała; zera — kulisty), SIZE — promień kuli wybuchu, SPEED — prędkość ciała.
 */
export const ROCK_EVENT = Object.freeze({ IMPACT: 0, SCRAPE: 1, SETTLE: 2, BLAST: 3 });

/** Rodzaje ciał (kolejność = kod w rekordzie). */
export const ROCK_BODY_KINDS = Object.freeze(['other', 'tower', 'disc', 'drum', 'core', 'debris', 'cable']);

/** Kod rodzaju ciała z napisu (nieznany — 'other'). */
export function rockBodyKindCode(kind) {
  const i = ROCK_BODY_KINDS.indexOf(String(kind || 'other'));
  return i < 0 ? 0 : i;
}
