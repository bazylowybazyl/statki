// src/3d/warp/stars.js
//
// Gwiazdy gry (StarSystem, planet3d.assets*.js) w warpie „Nurt” (dema/warp-webgpu/stars.js):
// smugi PŁASKIE, równoległe do kursu, ogonem do tyłu, rosną już przy ładowaniu (decyzje
// użytkownika z BRIEF-warp.md); przy skoku strzelają z przestrzałem, przy wyjściu wracają do
// punktów w ułamku sekundy — FRONT rzeczywistości idzie od dziobu ku rufie (gwiazdy przed nim
// wracają pierwsze). Bez tunelu 3D i bez gięcia przez bańkę.
//
// Wartości wspólne (grupa renderu — jeden zapis na klatkę): sterownik warpa (warpNurt.js)
// pisze je co klatkę, materiał gwiazd (createStarMaterial) czyta. Przy `stretch` = 0 materiał
// rysuje dawne punkty (gałąź po jednolitym warunku — obraz bez warpa jak przed zadaniem 22).
// Jednostki: piksele CSS kadru (jak dawny gl_PointSize gwiazd), oś y ekranu w GÓRĘ (klip).

import * as THREE from 'three/webgpu';
import { uniform, renderGroup } from 'three/tsl';

const shared = (value, type) => uniform(value, type).setGroup(renderGroup);

export const WARP_STARS = {
  stretch: shared(0, 'float'),                        // 0..1 (ładowanie → skok), > 1 = przestrzał przy skoku
  stretchPx: shared(74, 'float'),                     // długość smugi przy stretch = 1 [px] (× warstwa)
  heading: shared(new THREE.Vector2(1, 0), 'vec2'),   // kurs na ekranie (y w górę)
  frontOn: shared(0, 'float'),                        // front wyjścia aktywny
  frontPx: shared(0, 'float'),                        // położenie frontu wzdłuż kursu od statku [px]
  shipPx: shared(new THREE.Vector2(), 'vec2'),        // statek na ekranie [px od środka, y w górę]
  warpTint: shared(0, 'float')                        // biało-błękitne zabarwienie smug w skoku
};

/**
 * Kamera gwiazd w warpie: limit prędkości przesuwu wzoru [j/s kamery] na TĘ klatkę (0 = bez).
 * Sterownik warpa ustawia go przed updatePlanets3D (StarSystem.update czyta) — przy prędkości
 * warpa (do 160 tys. j/s) paralaksa to szum; demo: 14 tys. j/s.
 */
export const WARP_STAR_CAMERA = { speedCap: 0 };

/** Stan „bez warpa” (materiał rysuje dawne punkty). */
export function resetWarpStars() {
  const u = WARP_STARS;
  u.stretch.value = 0;
  u.frontOn.value = 0;
  u.frontPx.value = 0;
  u.warpTint.value = 0;
}
