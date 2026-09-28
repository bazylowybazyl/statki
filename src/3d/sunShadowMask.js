// src/3d/sunShadowMask.js
//
// Maska widoczności słońca (shadow shafts) — biblioteka TSL (port WebGPU, zadanie 03).
//
// Core3D liczy ją raz na klatkę, ZANIM narysuje jakikolwiek pass sceny:
// analityczne okludery (tarcze planet i księżyców, pola odległości kadłubów,
// okręgi ringów) → tekstura wielkości bufora sceny. O tym, co z nią zrobić,
// decyduje materiał:
//  - powierzchnia oświetlana słońcem (kadłub, odłamki, mostek, planety przy
//    ringu) mnoży przez sunVisibility() człon słońca, a otoczenie przygasza
//    do uSunShadowFill (sunFill) — światła statku, żar ran i glow świecą
//    w cieniu tak samo jak poza nim;
//  - tło (mgławica, gwiazdy, pas w tle) dostaje długą ciemną smugę
//    (sunShaftBackdrop);
//  - emitery (pociski, wiązki, dysze, błyski, światła pozycyjne, tarcze)
//    i ring „Halo” (własny model słońca: zaćmienie z czerwonym brzegiem
//    + cień ścian) maski NIE czytają.
// Wcześniej pass mnożył GOTOWY obraz przez (0,06; 0,10; 0,16) po narysowaniu
// warstwy 0: gasił pod progiem bloomu broń i dysze (które na niej siedzą),
// kładł na ring drugi, sprzeczny cień i nie dało się rozświetlić cienia.
//
// Kanały maski: R = cień powierzchni (tarcze + kadłuby), G = smuga tła
// (R + ringi), B = mrok gęstego pola asteroid. Okrąg ringu to ściana 2D ze
// słońcem w płaszczyźnie — dla statków przeczyłby modelowi ringu (słońce 49°),
// więc zostaje tylko w tle.
//
// Odczyt po screenUV (fragCoord / rozmiar AKTUALNEGO celu renderu — three bierze go
// z celu przy każdym render()), więc snapshot refrakcji w połowie rozdzielczości trafia
// w ten sam punkt maski bez przestawiania uniformu (dawny uSunShadowTexel). W WebGPU
// wiersz 0 celu to GÓRA ekranu i pass maski (core3d.js) pisze go tak samo: piksel
// materiału i teksel maski leżą 1:1 (maska ma rozmiar bufora sceny).
//
// Funkcje TSL (sunVisibility(), sunFill(vis), sunShadeUnlit(color), sunShaftBackdrop(color),
// sunShadowSample(), fieldDarkness()) — tylko w węzłach FRAGMENTÓW (fragCoord). Każde
// wywołanie buduje własne węzły próbki na WSPÓLNYCH węzłach uniformów i tekstury: materiały
// dzielą wiązania (Core3D ustawia `.value` raz na klatkę), a grafy wariantów (kadłuby: graf
// na wariant) mają maskę w swoim kodzie raz — nie per obiekt. Bez setLayout: funkcja
// z uniformem w domknięciu byłaby w three r183 buforowana globalnie (PLAN §3).
//
// GLSL maski dla modułów poza portem (Z4/Z5/Z7 — na WebGPU i tak zamienniki):
// sunShadowMaskGLSL.js. Re-eksport niżej zostaje tylko dla budowli Z7.
import {
  DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType, Vector2
} from 'three/webgpu';
import { float, mix, output, renderGroup, screenUV, select, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';

// AGENT: re-eksport TYLKO dla budowli Z7 (portBuildings3D.js, portHullBuild3D.js importują stąd
// SUN_SHADOW_GLSL; Z4 i Z5 biorą go wprost z sunShadowMaskGLSL.js). To jedyna droga GLSL do grafu
// importów gry — wpis POZA_PORTEM w scripts/webgpu/grafGry.mjs. Po przepięciu Z7 usuń tę linię
// i wpis (strażnik tests/graBezGlsl.test.mjs sam o to poprosi).
export { SUN_SHADOW_GLSL } from './sunShadowMaskGLSL.js';

// Barwa smugi na tle — ta sama, którą pass mnożył dawniej cały obraz.
export const SUN_SHAFT_BACKDROP_TINT = Object.freeze([0.06, 0.10, 0.16]);
// Ile światła otoczenia zostaje na powierzchni w pełnym cieniu. Słońce gry leży
// w płaszczyźnie, więc płyty kadłuba patrzące w górę biorą od niego mało
// (NdotL ≈ 0) i jasność robi otoczenie 0,24 — bez przygaszenia go statek
// w umbrze wyglądał jak w słońcu. 0,4 = wyraźny cień, kadłub czytelny,
// a światła, dysze i żar mocniej od niego odcięte. Strojenie na żywo:
// sunShadowUniforms.uSunShadowFill.value.
export const SUN_SHADOW_FILL = 0.4;
// Ile otoczenia gaśnie w PEŁNYM mroku gęstego pola asteroid (kanał B maski,
// asteroidFieldLight.js). Cień planety zostawia 0,4 otoczenia (pył wokół
// statku dalej świeci w słońcu), w rdzeniu pola ten pył też jest w cieniu —
// kadłub widać tylko w jego własnych światłach i reflektorach.
export const FIELD_FILL_CUT = 0.92;

// Maska zastępcza (1×1, zero = pełne słońce), dopóki Core3D nie narysuje pierwszej maski.
// Filtr liniowy i RGBA8 jak cel maski: TSL wybiera ścieżkę próbkowania (textureSampleLevel
// z próbnikiem filtrującym) z tekstury obecnej przy BUDOWIE materiału.
function makePlaceholderMask() {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  t.name = 'sunShadowMask:zastepcza';
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}
export const SUN_SHADOW_MAP_PLACEHOLDER = makePlaceholderMask();

// Wartość wspólna: grupa renderu — jeden zapis na render() dla wszystkich materiałów
// (w buforze grupy, który kadłuby i tak mają — HULL_SHARED), nie w buforze każdego obiektu.
const shared = (value, type) => uniform(value, type).setGroup(renderGroup);

// Wspólne węzły uniformów (to samo API `.value` co dawne obiekty `{ value }`): materiały TSL
// czytają je przez funkcje niżej, a nieprzeniesione ShaderMaterial wkładają te same obiekty
// do swoich `uniforms` (attachSunShadowUniforms / spread) — Core3D ustawia je raz na klatkę.
// Tekstura: węzeł bazowy z uv-atrapą (bez niej każdy odczyt mnożyłby uv przez macierz
// tekstury — osobny uniform mat3 na obiekt, PLAN §3); odczyty to klony z własnym uv.
// Nie klonować materiałów z tymi obiektami (UniformsUtils.clone zeruje teksturę celu).
export const sunShadowUniforms = Object.freeze({
  uSunShadowMap: texture(SUN_SHADOW_MAP_PLACEHOLDER, vec2(0.5)),
  // Tylko dla GLSL nieprzeniesionych modułów (gl_FragCoord · teksel) — TSL czyta po screenUV.
  uSunShadowTexel: shared(new Vector2(1, 1)),
  uSunShadowOn: shared(0),
  uSunShadowFill: shared(SUN_SHADOW_FILL),
  uFieldFillCut: shared(FIELD_FILL_CUT)
});

export function attachSunShadowUniforms(uniforms) {
  if (!uniforms) return uniforms;
  uniforms.uSunShadowMap = sunShadowUniforms.uSunShadowMap;
  uniforms.uSunShadowTexel = sunShadowUniforms.uSunShadowTexel;
  uniforms.uSunShadowOn = sunShadowUniforms.uSunShadowOn;
  uniforms.uSunShadowFill = sunShadowUniforms.uSunShadowFill;
  uniforms.uFieldFillCut = sunShadowUniforms.uFieldFillCut;
  return uniforms;
}

// Teksel maski pod pikselem fragmentu. Poziom 0 jawnie (textureSampleLevel): odczyty leżą
// też w gałęziach zależnych od piksela (po Discard, w pętlach świateł), a maska nie ma
// mipmap — wynik jak dawny odczyt GLSL z poziomem 0.
function maskTexel() {
  return texture(sunShadowUniforms.uSunShadowMap, screenUV, float(0));
}

const maskOff = () => sunShadowUniforms.uSunShadowOn.lessThan(0.5);

/** vec2: x = cień powierzchni, y = smuga tła; 0 = pełne słońce (maska wyłączona → 0). */
export function sunShadowSample() {
  return select(maskOff(), vec2(0.0), maskTexel().rg);
}

/** float: mrok gęstego pola asteroid (0 = poza polem, 1 = rdzeń bez słońca). */
export function fieldDarkness() {
  return select(maskOff(), float(0.0), maskTexel().b);
}

/** float: 1 = pełne słońce, 0 = umbra planety. Mnoży człon słońca (rozproszone, połysk,
 *  odblask) — światła, żar i glow nigdy. */
export function sunVisibility() {
  return float(1.0).sub(sunShadowSample().x);
}

/** float: mnożnik światła otoczenia przy widoczności `vis` (część otoczenia to słońce);
 *  w mroku gęstego pola otoczenie gaśnie prawie całkiem (uFieldFillCut). */
export function sunFill(vis) {
  const U = sunShadowUniforms;
  return mix(U.uSunShadowFill, float(1.0), vis).mul(float(1.0).sub(fieldDarkness().mul(U.uFieldFillCut)));
}

/** vec3: powierzchnia bez modelu światła (impostor, sprite billboard). */
export function sunShadeUnlit(color) {
  return vec3(color).mul(sunFill(sunVisibility()));
}

/** vec3: tło — długa smuga cienia. */
export function sunShaftBackdrop(color) {
  return vec3(color).mul(mix(vec3(1.0), vec3(...SUN_SHAFT_BACKDROP_TINT), sunShadowSample().y));
}

// ── Wbudowane materiały three ────────────────────────────────────────────────
// WebGPURenderer zamienia MeshStandardMaterial / MeshBasicMaterial / PointsMaterial … na
// materiał węzłowy tej samej klasy przy budowie (NodeLibrary.fromMaterial) i KOPIUJE mu
// wszystkie wyliczalne pola — więc hak zapisany w polu materiału przechodzi na jego
// odpowiednik węzłowy (materiał węzłowy dostaje go wprost):
//  - 'direct': setupLightingModel = model oświetlenia KLASY (Physical dla Standard, Phong,
//    Lambert…) z direct() mnożącym barwę światła przez sunVisibility() — rozproszone i
//    połysk każdego światła bezpośredniego gasną w cieniu, otoczenie (indirect) zostaje;
//    dawniej to samo robił mnożnik reflectedLight.directDiffuse / directSpecular po
//    lights_fragment_end (onBeforeCompile, WebGL);
//  - 'backdrop': outputNode = smuga cienia na kolorze wyjściowym (`output`), jak dawny
//    mnożnik gl_FragColor po opaque_fragment.
// Klucz programu: klucz klasy + rodzaj haka — materiał z maską i bez niej to dwa programy.
function sunMaskedDirect(model) {
  const direct = model.direct;
  model.direct = function sunShadowDirect(input, builder) {
    input.lightColor = input.lightColor.mul(sunVisibility());
    return direct.call(this, input, builder);
  };
  return model;
}

// `this` = materiał węzłowy (kopia z biblioteki albo materiał węzłowy wprost); model klasy
// z jej prototypu (własne pole to ten hak — bez rekurencji).
function setupSunShadowLightingModel(builder) {
  const model = Object.getPrototypeOf(this).setupLightingModel.call(this, builder);
  return (model && typeof model.direct === 'function') ? sunMaskedDirect(model) : model;
}

function sunShadowDirectCacheKey() {
  return `${Object.getPrototypeOf(this).customProgramCacheKey.call(this)}|sunShadow:direct`;
}

function sunShadowBackdropCacheKey() {
  return `${Object.getPrototypeOf(this).customProgramCacheKey.call(this)}|sunShadow:backdrop`;
}

let _backdropOutput = null;
function backdropOutputNode() {
  if (!_backdropOutput) _backdropOutput = vec4(sunShaftBackdrop(output.rgb), output.a);
  return _backdropOutput;
}

// mode 'backdrop' = smuga na kolorze wyjściowym, 'direct' = maska na świetle bezpośrednim
// (otoczenie zostaje). Materiał wraca ten sam (hak w jego polach) — sygnatura bez zmian.
export function applySunShadowToBuiltinMaterial(material, mode = 'direct') {
  if (!material) return material;
  const kind = mode === 'backdrop' ? 'backdrop' : 'direct';
  if (kind === 'backdrop') {
    material.outputNode = backdropOutputNode();
    material.customProgramCacheKey = sunShadowBackdropCacheKey;
  } else {
    material.setupLightingModel = setupSunShadowLightingModel;
    material.customProgramCacheKey = sunShadowDirectCacheKey;
  }
  material.needsUpdate = true;
  return material;
}
