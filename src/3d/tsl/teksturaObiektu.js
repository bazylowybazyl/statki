// src/3d/tsl/teksturaObiektu.js
//
// Tekstura per obiekt w grafie wspólnym (port WebGPU, docs/webgpu/PLAN.md §3).
//
// Graf budowany raz na moduł, materiały go współdzielą, a wartości per obiekt czytają węzły
// z `material.uniforms` rysowanego obiektu. Dla liczb wystarcza `uniform().onObjectUpdate()`,
// dla tekstur NIE: `texture().onObjectUpdate()` w three r183 nie działa — TextureNode.setup
// sam ustawia updateType (OBJECT tylko przy macierzy uv albo flipY, inaczej NONE), a
// NodeBuilder zbiera węzły do aktualizacji po budowie, więc węzeł wypada z listy i każdy obiekt
// próbkowałby teksturę z chwili budowy (zadanie 04, `HullObjectTextureNode` w hexShips3D.tsl.js).
// Tu: updateType na stałe OBJECT i własne update(). Wiązanie tekstury i samplera three klonuje
// na każdy obiekt renderu (grupa „object”); sampler idzie za teksturą (Bindings._update →
// updateSampler), więc filtr, anizotropia i zawijanie są tekstury obiektu.
//
// Zastępcza przy budowie: ścieżkę próbkowania (textureSample / textureLoad) TSL wybiera z
// tekstury obecnej przy BUDOWIE — zastępcza ma filtr liniowy. Osobny obiekt na każde wiązanie
// (TextureNode skleja wiązania po uuid tekstury obecnej przy budowie).
import { DataTexture, LinearFilter, NodeUpdateType, RGBAFormat, TextureNode, UnsignedByteType } from 'three/webgpu';
import { nodeObject } from 'three/tsl';

/** Tekstura 1×1 do budowy grafu (filtr liniowy — ścieżka textureSample). */
export function teksturaZastepcza(r, g, b, a, colorSpace) {
  const t = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat, UnsignedByteType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  if (colorSpace) t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}

export class ObjectTextureNode extends TextureNode {
  static get type() {
    return 'ObjectTextureNode';
  }

  get updateType() {
    return NodeUpdateType.OBJECT;
  }

  set updateType(_value) { /* stałe OBJECT — patrz nagłówek */ }

  update(frame) {
    // Bez tekstury w materiale — zastępcza (inaczej zostałaby tekstura poprzedniego obiektu).
    const value = frame.material?.uniforms?.[this.objectKey]?.value;
    this.value = (value && value.isTexture === true) ? value : this.objectFallback;
  }

  clone() {
    const node = super.clone();
    node.objectKey = this.objectKey;
    node.objectFallback = this.objectFallback;
    return node;
  }
}

/**
 * Węzeł tekstury `material.uniforms[key].value` rysowanego obiektu, próbkowany w `uvNode`.
 * @param {string} key klucz w `material.uniforms`
 * @param {import('three').Texture} placeholder zastępcza (budowa i obiekty bez tekstury)
 * @param {import('three/tsl').ShaderNodeObject} uvNode
 */
export function teksturaObiektu(key, placeholder, uvNode) {
  const node = new ObjectTextureNode(placeholder, uvNode);
  node.objectKey = key;
  node.objectFallback = placeholder;
  return nodeObject(node);
}
