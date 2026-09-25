// src/3d/sunShadowMask.js
//
// Maska widoczności słońca (shadow shafts).
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
//    + cień ścian, haloRingGLSL.js) maski NIE czytają.
// Wcześniej pass mnożył GOTOWY obraz przez (0,06; 0,10; 0,16) po narysowaniu
// warstwy 0: gasił pod progiem bloomu broń i dysze (które na niej siedzą),
// kładł na ring drugi, sprzeczny cień i nie dało się rozświetlić cienia.
//
// Kanały maski: R = cień powierzchni (tarcze + kadłuby), G = smuga tła
// (R + ringi). Okrąg ringu to ściana 2D ze słońcem w płaszczyźnie — dla
// statków przeczyłby modelowi ringu (słońce 49°), więc zostaje tylko w tle.
// Odczyt po gl_FragCoord: maska ma rozmiar bufora sceny, a uSunShadowTexel
// = 1 / rozmiar AKTUALNEGO celu (Core3D przestawia go na czas snapshotu
// refrakcji, który ma połowę rozdzielczości).
import * as THREE from 'three';

// Barwa smugi na tle — ta sama, którą pass mnożył dawniej cały obraz.
export const SUN_SHAFT_BACKDROP_TINT = Object.freeze([0.06, 0.10, 0.16]);
// Ile światła otoczenia zostaje na powierzchni w pełnym cieniu. Słońce gry leży
// w płaszczyźnie, więc płyty kadłuba patrzące w górę biorą od niego mało
// (NdotL ≈ 0) i jasność robi otoczenie 0,24 — bez przygaszenia go statek
// w umbrze wyglądał jak w słońcu. 0,4 = wyraźny cień, kadłub czytelny,
// a światła, dysze i żar mocniej od niego odcięte. Strojenie na żywo:
// sunShadowUniforms.uSunShadowFill.value.
export const SUN_SHADOW_FILL = 0.4;

// Wspólne obiekty uniformów: materiały dostają TE SAME referencje (spread albo
// attachSunShadowUniforms), więc Core3D ustawia je raz na klatkę dla wszystkich.
// Nie klonować takich materiałów: UniformsUtils.clone zeruje teksturę celu.
export const sunShadowUniforms = Object.freeze({
  uSunShadowMap: { value: null },
  uSunShadowTexel: { value: new THREE.Vector2(1, 1) },
  uSunShadowOn: { value: 0 },
  uSunShadowFill: { value: SUN_SHADOW_FILL }
});

export function attachSunShadowUniforms(uniforms) {
  if (!uniforms) return uniforms;
  uniforms.uSunShadowMap = sunShadowUniforms.uSunShadowMap;
  uniforms.uSunShadowTexel = sunShadowUniforms.uSunShadowTexel;
  uniforms.uSunShadowOn = sunShadowUniforms.uSunShadowOn;
  uniforms.uSunShadowFill = sunShadowUniforms.uSunShadowFill;
  return uniforms;
}

function glslNum(value) {
  const s = Number(value).toPrecision(6);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

const TINT = SUN_SHAFT_BACKDROP_TINT.map(glslNum).join(', ');

// Tylko do shaderów FRAGMENTÓW (gl_FragCoord).
export const SUN_SHADOW_GLSL = `
uniform sampler2D uSunShadowMap;
uniform vec2 uSunShadowTexel;
uniform float uSunShadowOn;
uniform float uSunShadowFill;
// x = cień powierzchni, y = smuga tła; 0 = pełne słońce.
vec2 sunShadowSample() {
  if (uSunShadowOn < 0.5) return vec2(0.0);
  return textureLod(uSunShadowMap, gl_FragCoord.xy * uSunShadowTexel, 0.0).rg;
}
// 1 = pełne słońce, 0 = umbra planety. Mnoży człon słońca (rozproszone,
// połysk, odblask) — światła, żar i glow nigdy.
float sunVisibility() {
  return 1.0 - sunShadowSample().x;
}
// Mnożnik światła otoczenia przy widoczności vis (część otoczenia to słońce).
float sunFill(float vis) {
  return mix(uSunShadowFill, 1.0, vis);
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

// Wbudowane materiały three (MeshBasic/MeshStandard): wstrzyknięcie przez
// onBeforeCompile. mode 'backdrop' = smuga na kolorze wyjściowym, 'direct' =
// maska na świetle bezpośrednim (otoczenie zostaje).
export function applySunShadowToBuiltinMaterial(material, mode = 'direct') {
  if (!material) return material;
  const kind = mode === 'backdrop' ? 'backdrop' : 'direct';
  material.onBeforeCompile = (shader) => {
    attachSunShadowUniforms(shader.uniforms);
    let frag = SUN_SHADOW_GLSL + shader.fragmentShader;
    if (kind === 'backdrop') {
      frag = frag.replace('#include <opaque_fragment>',
        '#include <opaque_fragment>\n\tgl_FragColor.rgb = sunShaftBackdrop(gl_FragColor.rgb);');
    } else {
      frag = frag.replace('#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n\t{ float sunVisD = sunVisibility(); reflectedLight.directDiffuse *= sunVisD; reflectedLight.directSpecular *= sunVisD; }');
    }
    shader.fragmentShader = frag;
  };
  material.customProgramCacheKey = () => `sunShadow:${kind}`;
  material.needsUpdate = true;
  return material;
}
