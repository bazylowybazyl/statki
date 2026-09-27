// src/3d/tsl/uniformy.js
//
// Adapter uniformów portu WebGPU (docs/webgpu/PLAN.md §3, SPIKE.md p. 3).
//
// Kod gry zmienia uniformy przez `material.uniforms.uFoo.value` — w materiałach
// węzłowych te same obiekty to węzły `uniform()` / `texture()`, które mają `.value`
// (liczba, Vector*.set w miejscu, podmiana tekstury), więc kod aktualizacji zostaje
// bez zmian, a pipeline się nie przebudowuje. Wyjątek: `uniformArray` trzyma dane
// gry w `node.array` (`node.value` to spakowany Float32Array), więc adapter wystawia
// `.value` → `node.array` (Vector4.set w miejscu działa, tablica przepisuje się co
// render). Wspólne obiekty uniformów (np. maska słońca) = wspólne węzły: ustawienie
// `.value` raz działa dla wszystkich materiałów.
//
// Limit: 12 buforów uniformów na etap shadera (tyle daje też RTX 5080). `uniform()`
// z domyślnej grupy dzielą jeden bufor, ale KAŻDY `uniformArray` i każdy `uniform()`
// z własną grupą (`.setGroup`) to osobny bufor — duże materiały pakują uniformy w jeden
// blok (wzór: `createUniformBlock` w src/3d/haloRing/, zadanie 06).
import { Color, Matrix3, Matrix4, Vector2, Vector3, Vector4 } from 'three/webgpu';
import { texture, uniform, uniformArray } from 'three/tsl';

// Wpis adaptera dla uniformArray: `.value` to tablica elementów gry (liczby
// albo wektory), `.node` — węzeł do grafu.
function arrayEntry(node) {
  return {
    node,
    isUniformArrayAdapter: true,
    get value() { return node.array; },
    set value(v) { node.array = v; }
  };
}

/**
 * Mapa `{ nazwa: węzeł }` → obiekt w kształcie `material.uniforms`.
 * `uniform()` i `texture()` idą bez zmian (mają `.value`), `uniformArray` dostaje
 * wpis z `.value` → `node.array` i `.node`.
 * @param {Record<string, any>} map
 * @returns {Record<string, any>}
 */
export function uniformsAdapter(map) {
  const out = {};
  if (!map) return out;
  for (const name of Object.keys(map)) {
    const node = map[name];
    out[name] = (node && node.isArrayBufferNode === true && Array.isArray(node.array)) ? arrayEntry(node) : node;
  }
  return out;
}

/** Węzeł z wpisu adaptera (dla uniformArray — `.node`, reszta to już węzły). */
export function uniformNode(entry) {
  return entry && entry.isUniformArrayAdapter === true ? entry.node : entry;
}

function arrayItemType(items) {
  const first = items.find((v) => v !== null && v !== undefined);
  if (typeof first === 'number') return 'float';
  if (first?.isVector4 || first?.isQuaternion) return 'vec4';
  if (first?.isVector3) return 'vec3';
  if (first?.isVector2) return 'vec2';
  if (first?.isColor) return 'color';
  if (first?.isMatrix4) return 'mat4';
  if (first?.isMatrix3) return 'mat3';
  throw new TypeError('makeUniforms: nieobsługiwany typ elementu tablicy');
}

/**
 * Wartości startowe → węzły opakowane adapterem, np.
 * `makeUniforms({ uTime: 0, uDir: new Vector2(), uMap: tex, uLights: [new Vector4(), …] })`.
 * Liczby → `uniform(float)`, wektory / kolor / macierze → `uniform()`, tekstury →
 * `texture()`, tablice → `uniformArray` (typ z pierwszego elementu).
 * @param {Record<string, any>} values
 */
export function makeUniforms(values) {
  const nodes = {};
  for (const name of Object.keys(values || {})) {
    const v = values[name];
    if (typeof v === 'number') nodes[name] = uniform(v);
    else if (typeof v === 'boolean') nodes[name] = uniform(v ? 1 : 0);
    else if (v?.isTexture) nodes[name] = texture(v);
    else if (Array.isArray(v)) nodes[name] = uniformArray(v, arrayItemType(v));
    else if (v instanceof Vector2 || v instanceof Vector3 || v instanceof Vector4 || v instanceof Color
      || v instanceof Matrix3 || v instanceof Matrix4) nodes[name] = uniform(v);
    else throw new TypeError(`makeUniforms: nieobsługiwana wartość „${name}”`);
  }
  return uniformsAdapter(nodes);
}
