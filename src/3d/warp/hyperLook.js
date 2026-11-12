// src/3d/warp/hyperLook.js
//
// WYGLĄD HIPERCRUISE'U v2 (2026-10-29, zgłoszenie użytkownika: „popraw efekt hypercruise — obecnie za mocno drga i robi
// kołowe haze, nie pasuje do czegoś takiego. Skupiamy się na silnikach — efekt z nich, i trzeba dodać jakiś efekt lotu.
// Może wykorzystać haze — dać go większego z silników i efekt à la opływowy, aerodynamiczny haze wzdłuż statku w dół —
// żeby oddać prędkość”). Hipercruise to szybki, spokojny przelot, nie skok przez tunel:
//   • bez kół — soczewki bańki na mgławicy (elipsa wokół statku przez cały lot), fali kopu i fali, błysku, blasku i żaru
//     wyjścia (player.js);
//   • bez szarpania — wstrząsy kopu / wyjścia / hamowania i kop kamery hipercruise'u przycięte (src/game/warpShakes.js,
//     src/game/cameraRig.js — strona gry);
//   • silniki — długi, smukły, spokojny strumień plazmy (warpPlume3D.js: `HYPER_LOOK.plume` w locie, łagodny rozruch
//     i dogasanie bez krztuszenia) i większe gorące powietrze dysz (engineVfxSystem.js: `HYPER_LOOK.haze`);
//   • lot — OPŁYW (hyperFlow.js): przezroczysta refrakcja wzdłuż burt ku rufie, kilwater za rufą i długie smugi gorącego
//     powietrza z dysz.
// A/B: `?hcStary=1` w adresie strony (działa też w workerze renderu — RenderWorld.pageSearch) — obraz hipercruise'u
// sprzed zmiany (koła, plazma i haze dysz jak dawniej, bez opływu). Wstrząsy i kamera po stronie gry bez A/B.

import { RenderWorld } from '../../render/renderWorld.js';

let _legacySearch = null;
let _legacyOn = false;
let _legacyForce = null;

/** Czy hipercruise ma wygląd sprzed 2026-10-29 (`?hcStary=1`). */
export function hyperLegacyLookOn(search = RenderWorld.pageSearch) {
  if (_legacyForce !== null) return _legacyForce;
  const s = typeof search === 'string' ? search : '';
  if (s !== _legacySearch) {
    _legacySearch = s;
    _legacyOn = /[?&]hcStary=1(?:&|$)/.test(s);
  }
  return _legacyOn;
}

/** Wymuszenie (testy, demo): true / false; null — z adresu strony. */
export function setHyperLegacyLook(on) {
  _legacyForce = on === true || on === false ? on : null;
}

/**
 * Strojenie wyglądu hipercruise'u v2 (wartości, nie flagi — obiekt modyfikowalny z konsoli: `WarpNurt.hyperLook`).
 *   plume — strumień plazmy w LOCIE hipercruise'u (warpPlume3D.js, instancja z `hyper`): turb — mnożnik turbulencji
 *     kształtu (zamiast 1 + 0,45 · dopalacz), flowBoost — człon dopalacza w prędkości przepływu (zamiast 1,7: szybki
 *     przepływ przy 60 kl/s przesuwał drobną oktawę o ~¾ okresu na klatkę — „koło wagonu”), stretch — cel rozciągnięcia
 *     cech wzdłuż osi (smugi zamiast kłębów), mach — tempo przewijania diamentów Macha (prawdziwe stoją), jitter —
 *     szum marszu, flicker — migotanie ciśnienia, boostLen — wydłużenie dopalaczem (zamiast WARP_PLUME_BOOST_LEN),
 *     width — szerokość, particles / partWidth — iskry plazmy (mniej i węższy stożek), glowBlue — rozmiar i siła
 *     dużej poświaty (koło 7 R wokół każdej dyszy), wobble — drżenie brzegu poświat (0 = okrągły, spokojny wylot);
 *   haze — gorące powietrze dysz w „uber” (engineVfxSystem.js): stożek × radius (dłuższy i szerszy, wzór płynie szybciej),
 *     siła × strength, źródło cofnięte pod prąd o shift · (radius − 1) promieni (bez dziury za wylotem).
 */
export const HYPER_LOOK = {
  plume: {
    turb: 0.5, flowBoost: 0.6, stretch: 0.3, mach: 0.08, jitter: 0.35, flicker: 0.08,
    boostLen: 1.15, width: 0.82, particles: 0.12, partWidth: 0.6, glowBlue: 0.55, wobble: 0
  },
  haze: { radius: 1.8, strength: 0.8, shift: 0.45 }
};
