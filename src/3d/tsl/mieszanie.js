// src/3d/tsl/mieszanie.js
//
// Mieszanie efektów portu WebGPU 1:1 z WebGL (zadanie 13).
//
// ShaderMaterial w WebGL z `premultipliedAlpha: true` i AdditiveBlending zmienia
// TYLKO czynniki mieszania: gl.blendFunc(ONE, ONE) — shader pisze kolor już
// „premultiplied” (efekty gry: alfa = max(rgb)). NodeMaterial z tą flagą robi
// dodatkowo premultiplyAlpha na wyjściu (NodeMaterial.setupOutput, three r183):
// rgb · alfa — efekt addytywny ściemniałby (rgb · max(rgb)) i zmieniał kształt.
// Dlatego materiał węzłowy dostaje te same czynniki jawnie (CustomBlending
// ONE, ONE dla koloru i alfy) i premultipliedAlpha = false.
//
// AdditiveBlending BEZ premultipliedAlpha nie wymaga zmian: WebGL r183 ma
// blendFuncSeparate(SRC_ALPHA, ONE, ONE, ONE), WebGPU te same czynniki.
import { AddEquation, CustomBlending, OneFactor } from 'three/webgpu';

/** (ONE, ONE) dla koloru i alfy, wyjście shadera bez premultiplyAlpha. */
export function blendAddytywnePremul(material) {
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = OneFactor;
  material.blendEquationAlpha = null;
  material.blendSrcAlpha = null;
  material.blendDstAlpha = null;
  material.premultipliedAlpha = false;
  return material;
}
