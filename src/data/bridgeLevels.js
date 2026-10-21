// src/data/bridgeLevels.js
//
// MOSTKI NA POZIOMY KLAS I–VI (czyste dane: bez three, DOM i stanu gry). Poziom mostka = klasa okrętu (etap 2 stoczni
// z klocków, src/data/shipClasses.js: I Fregata … VI Superkapitał). Każdy poziom ma JEDEN model 3D w stylu Terra Novy
// (src/3d/bridge3DShapes.js, rodzaj `model`) skrojony na typowy kadłub swojej klasy, a jego OBRYS (w × h — pełne
// wymiary w j. świata, x wzdłuż okrętu) jest jednocześnie:
//   • strefą mostka w rozgrywce (BRIDGE_LAYOUT_PROPOSALS w src/game/shipBridge.js: w / s, h / s w px PNG sprite'a,
//     pole `level` strefy wybiera model),
//   • gniazdem modułu `bridge` v 2 w kreatorze kadłubów (src/game/hullDesign/hullDesignSchema.js — pół-wymiary w / 2,
//     h / 2; kompozytor rysuje płytę pokładu, szczelinę i ramę wokół obrysu).
// Pokład modelu to ośmiokąt z fazą narożników `ch` [j.] — tę samą fazę ma płyta gniazda w kreatorze.
// Kadłuby TN: Custos I, Hasta II, Bellator IV, Citadella V, Colossus VI; klasa III (krążownik) nie ma jeszcze kadłuba
// TN — jej model służy projektom gracza. Piraci, Atlas i lokomotywa megafrachtowca mają własne modele (bez poziomu).
// Zmiana obrysu poziomu = zmiana strefy zabicia w grze: przelicz strefy TN (tests/bridgeLevels.test.mjs).

export const BRIDGE_LEVELS = Object.freeze([
  Object.freeze({ level: 1, roman: 'I', w: 28, h: 16, ch: 3, model: 'tn_1' }),
  Object.freeze({ level: 2, roman: 'II', w: 42, h: 22, ch: 4, model: 'tn_2' }),
  Object.freeze({ level: 3, roman: 'III', w: 58, h: 30, ch: 5.5, model: 'tn_3' }),
  Object.freeze({ level: 4, roman: 'IV', w: 78, h: 40, ch: 7, model: 'tn_4' }),
  Object.freeze({ level: 5, roman: 'V', w: 108, h: 54, ch: 10, model: 'tn_5' }),
  Object.freeze({ level: 6, roman: 'VI', w: 150, h: 76, ch: 14, model: 'tn_6' })
]);
export const BRIDGE_LEVEL_MAX = BRIDGE_LEVELS.length;

/** Poziom mostka 1…6 (liczba spoza zakresu — przycięta, nie-liczba — 1). */
export function clampBridgeLevel(level) {
  const n = Math.round(Number(level));
  return Number.isFinite(n) ? Math.max(1, Math.min(BRIDGE_LEVEL_MAX, n)) : 1;
}

/** Wpis poziomu (obrys, faza pokładu, rodzaj modelu). */
export function bridgeLevel(level) {
  return BRIDGE_LEVELS[clampBridgeLevel(level) - 1];
}
