// src/3d/sunShadowMaskGLSL.js
//
// LEGACY (port WebGPU): GLSL maski słońca dla ShaderMaterial jeszcze NIEPRZENIESIONYCH na
// TSL. Na WebGPU takie materiały i tak rysują się magentowym zamiennikiem (tekst GLSL nie
// jest kompilowany), ale ich moduły wklejają ten napis do swoich shaderów i muszą się
// wczytać. Biblioteka maski gry to funkcje TSL w sunShadowMask.js (zadanie 03) — ten plik
// jest tylko źródłem napisu `SUN_SHADOW_GLSL` (re-eksport w sunShadowMask.js).
//
// Użytkownicy (znikają przy porcie swoich materiałów): planet3d.assets.js (zadanie 05),
// bridge3D.js (15), asteroidBeltBackdrop3D.js / rocks/* (stare i nowe asteroidy — 21),
// shipProxyBatch3D.js (Z4), cargoContainers3D.js / cargoDrones3D.js (Z5),
// portBuildings/* (Z7). Ostatni zgasza plik (zadanie 24).
//
// Bez importów z sunShadowMask.js: tamten moduł re-eksportuje ten napis, więc import
// w drugą stronę dałby cykl (dostęp do stałej przed inicjalizacją).

// = SUN_SHAFT_BACKDROP_TINT z sunShadowMask.js w zapisie glslNum (pilnuje test
// shadowShaftsQuality: „legacy GLSL maski”).
const TINT = '0.0600000, 0.100000, 0.160000';

// Tylko do shaderów FRAGMENTÓW (gl_FragCoord).
export const SUN_SHADOW_GLSL = `
uniform sampler2D uSunShadowMap;
uniform vec2 uSunShadowTexel;
uniform float uSunShadowOn;
uniform float uSunShadowFill;
uniform float uFieldFillCut;
// x = cień powierzchni, y = smuga tła; 0 = pełne słońce.
vec2 sunShadowSample() {
  if (uSunShadowOn < 0.5) return vec2(0.0);
  return textureLod(uSunShadowMap, gl_FragCoord.xy * uSunShadowTexel, 0.0).rg;
}
// Mrok gęstego pola asteroid (0 = poza polem, 1 = rdzeń bez słońca).
float fieldDarkness() {
  if (uSunShadowOn < 0.5) return 0.0;
  return textureLod(uSunShadowMap, gl_FragCoord.xy * uSunShadowTexel, 0.0).b;
}
// 1 = pełne słońce, 0 = umbra planety. Mnoży człon słońca (rozproszone,
// połysk, odblask) — światła, żar i glow nigdy.
float sunVisibility() {
  return 1.0 - sunShadowSample().x;
}
// Mnożnik światła otoczenia przy widoczności vis (część otoczenia to słońce).
// W mroku gęstego pola otoczenie gaśnie prawie całkiem (uFieldFillCut).
float sunFill(float vis) {
  return mix(uSunShadowFill, 1.0, vis) * (1.0 - fieldDarkness() * uFieldFillCut);
}
// Powierzchnia bez modelu światła (impostor, sprite billboard).
vec3 sunShadeUnlit(vec3 color) {
  return color * sunFill(sunVisibility());
}
// Tło: długa smuga cienia.
vec3 sunShaftBackdrop(vec3 color) {
  return color * mix(vec3(1.0), vec3(${TINT}), sunShadowSample().y);
}
`;
