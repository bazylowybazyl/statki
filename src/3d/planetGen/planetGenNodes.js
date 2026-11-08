// src/3d/planetGen/planetGenNodes.js
//
// Węzły PER OBIEKT dla grafów planet generatora (jeden graf na rodzaj dla wszystkich planet, dane planety w
// `material.uniforms` rysowanego obiektu):
//   • PerObjectUniformArrayNode — tablica uniformów vec4 z aktualizacją na obiekt: przed rysunkiem kopiuje
//     `material.uniforms[klucz].value` (tablica Vector4 o długości `cap`) do bufora; bufor grupy obiektu jest osobny
//     dla każdego obiektu renderu (NodeBuilderState.createBindings). Stała nazwa (`setName`) — jeden WGSL;
//   • GenObjectTextureNode — tekstura per obiekt (jak PlanetObjectTextureNode gry: `texture().onObjectUpdate()` w three
//     r183 nie działa). Tekstura musi być na GPU przed pierwszym rysunkiem (`renderer.initTexture` — inaczej pusty
//     próbnik w grupie wiązań); zastępcza z filtrem liniowym (ścieżka próbkowania wybiera się przy budowie).
import * as THREE from 'three/webgpu';

export class PerObjectUniformArrayNode extends THREE.UniformArrayNode {
  static get type() { return 'PerObjectUniformArrayNode'; }
  constructor(key, cap) {
    super(Array.from({ length: cap }, () => new THREE.Vector4()), 'vec4');
    this.objectKey = key;
    this.updateType = THREE.NodeUpdateType.OBJECT;
    this._fallback = this.array;
  }
  update(frame) {
    const v = frame?.material?.uniforms?.[this.objectKey]?.value;
    this.array = (Array.isArray(v) && v.length === this._fallback.length) ? v : this._fallback;
    super.update(frame);
  }
}

export class GenObjectTextureNode extends THREE.TextureNode {
  static get type() { return 'GenObjectTextureNode'; }
  get updateType() { return THREE.NodeUpdateType.OBJECT; }
  set updateType(_v) { /* stałe OBJECT */ }
  update(frame) {
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

/** Węzeł tekstury per obiekt (`key` w material.uniforms), `fallback` — zastępcza z filtrem liniowym. */
export function genObjectTexture(key, fallback, uvNode = null) {
  const n = new GenObjectTextureNode(fallback, uvNode);
  n.objectKey = key;
  n.objectFallback = fallback;
  return n;
}

/** Tekstura 1 × 1 (filtr liniowy, bez mipmap): `data` — Uint8Array albo Uint16Array (połówki), `type` three. */
export function tinyTexture(data, type = THREE.UnsignedByteType, colorSpace = THREE.NoColorSpace) {
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, type);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}
