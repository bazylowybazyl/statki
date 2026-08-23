// Zywy stan gry w jednym miejscu.
//
// Po co: glowny skrypt w index.html trzyma statek, kamere, listy NPC itd. jako
// zmienne modulowe. Kazdy modul wyciagniety z tego skryptu musialby albo dostac
// je argumentem (rozdete sygnatury), albo siegnac po `window.*` (bez kontroli,
// bez podpowiedzi edytora). Ten kontener jest trzecia opcja: jeden import,
// jawny zestaw pol, zero smiecenia w `window`.
//
// ZASADA: pola czytamy DOPIERO w momencie wywolania, nigdy nie zapamietujemy
// referencji przy inicjalizacji modulu — inaczej zlapiemy `null` sprzed startu
// gry albo nieaktualna liste po resecie swiata.
//
//   import { GameState } from '../game/gameState.js';
//   function draw() { const { ctx, ship } = GameState; ... }   // OK
//   const { ctx } = GameState;  function draw() { ... }        // ZLE
export const GameState = {
  // rdzen renderu 2D
  canvas: null,
  ctx: null,
  camera: null,

  // swiat
  ship: null,
  npcs: [],
  wrecks: [],
  bullets: [],
  stations: [],
  planets: [],

  // strefa swiata, w ktorej jest gracz (wplywa m.in. na VFX warpa)
  zoneState: null,

  // zegar gry w sekundach (0..24h), przesuwany co klatke — animacje UI
  gameTime: 0,

  // podsystemy gracza
  warp: null,
  input: null,
  mouse: null
};

/**
 * Publikuje (lub odswieza) fragment stanu. Wolane z index.html tam, gdzie
 * dana rzecz powstaje — i ponownie, jesli zostanie podmieniona.
 * @param {Partial<typeof GameState>} patch
 */
export function publishGameState(patch) {
  if (patch) Object.assign(GameState, patch);
  return GameState;
}
