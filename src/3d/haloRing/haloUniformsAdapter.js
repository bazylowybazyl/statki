// Adapter uniformów TSL dla ringu „Halo” (port WebGPU, zadanie 06).
//
// AGENT: lokalny pomocnik do czasu scalenia zadania 01 — po scaleniu przejść na
// `uniformsAdapter` z `src/3d/tsl/uniformy.js` (ten plik ma wtedy tylko
// re-eksportować albo zniknąć; importują go haloRingUniforms.js,
// haloRingWorldGen.js, haloRingTSL.js). `createUniformBlock` warto przenieść do
// src/3d/tsl/ — przyda się każdemu modułowi z wieloma tablicami uniformów.
//
// material.uniforms / ring.uniforms zostają obiektem { uFoo: { value } }, więc kod
// aktualizacji (`u.uFoo.value = x`, `u.uVec.value.set(...)`) się nie zmienia.

import * as THREE from 'three';
import { int, uniformArray } from 'three/tsl';

// Mapa węzłów uniform()/texture()/uniformArray → adapter:
//  - uniform() i texture() mają własne `.value` (liczba / Vector / Texture) — wchodzą wprost;
//  - uniformArray trzyma dane gry w `node.array` (`node.value` to spakowany Float32Array,
//    SPIKE 3) → opakowanie z `.value` = `node.array` i `.node` = węzeł.
// Zmiana `.value` nie przebudowuje pipeline'u.
export function uniformsAdapter(map) {
  const out = {};
  for (const [name, node] of Object.entries(map)) {
    if (node && node.isArrayBufferNode && Array.isArray(node.array)) {
      out[name] = {
        node,
        isUniformArrayRef: true,
        get value() { return node.array; },
        set value(v) { node.array = v; }
      };
    } else {
      out[name] = node;
    }
  }
  return out;
}

// Węzeł TSL wpisu adaptera (uniform/texture wprost, uniformArray i tablica bloku
// z opakowania — tablica bloku to obiekt z `.element(i)`, nie Node).
export function nodeOf(entry) {
  if (!entry) return null;
  if (entry.isNode || entry.isUniformBlockArray) return entry;
  const n = entry.node;
  if (n && (n.isNode || typeof n.element === 'function')) return n;
  return null;
}

// ---------------------------------------------------------------------------
// Blok uniformów: WSZYSTKIE wartości w JEDNYM buforze uniformów (uniformArray
// vec4). WebGPU pozwala na najwyżej 12 buforów uniformów na etap
// (maxUniformBuffersPerShaderStage = 12 także w adapterze RTX 5080), a każdy
// uniformArray three to osobny bufor — bake map ringu miał ich 20 i pipeline się
// nie tworzył. Blok zajmuje jeden.
//
// spec: { klucz: wartość } — liczba (float), Vector2/3/4 (vec2/3/4),
//        { array: [Vector3|Vector4…] } (tablica wektorów), { array: [liczby], type: 'float' }.
// name — nazwa bufora w WGSL (stała, inaczej three nadaje `NodeBuffer_<id>` i każdy
// egzemplarz bloku daje inny kod shadera = osobna kompilacja pipeline'u; ze stałą
// nazwą ringi Ziemi/Marsa/Jowisza i przebudowy dzielą programy).
// Wynik: { uniforms (adapter: .value jak dotąd, .node = węzeł TSL wpisu), node, elements }.
// Węzeł wpisu: float → element(k).x, vec3 → element(k).xyz, vec4 → element(k);
// tablica → obiekt z element(i) (i: liczba JS albo węzeł int), `length`.
export function createUniformBlock(spec, name = null) {
  const elements = [];
  const layout = [];
  for (const [key, v] of Object.entries(spec)) {
    if (typeof v === 'number') {
      const holder = new THREE.Vector4(v, 0, 0, 0);
      layout.push({ key, kind: 'float', index: elements.length, holder });
      elements.push(holder);
    } else if (v && (v.isVector2 || v.isVector3 || v.isVector4)) {
      layout.push({ key, kind: v.isVector4 ? 'vec4' : v.isVector3 ? 'vec3' : 'vec2', index: elements.length, vec: v });
      elements.push(v);
    } else if (v && Array.isArray(v.array)) {
      const base = elements.length;
      if (v.type === 'float') {
        const holders = v.array.map((x) => new THREE.Vector4(Number(x) || 0, 0, 0, 0));
        elements.push(...holders);
        layout.push({ key, kind: 'float[]', index: base, length: holders.length, holders });
      } else {
        const first = v.array[0];
        const kind = first?.isVector4 ? 'vec4[]' : first?.isVector3 ? 'vec3[]' : 'vec2[]';
        elements.push(...v.array);
        layout.push({ key, kind, index: base, length: v.array.length, items: v.array });
      }
    } else {
      throw new Error(`createUniformBlock: nieobsługiwany wpis ${key}`);
    }
  }
  const node = uniformArray(elements, 'vec4');
  if (name) node.setName(name);
  const pick = (el, kind) => (kind.startsWith('float') ? el.x : kind.startsWith('vec3') ? el.xyz : kind.startsWith('vec2') ? el.xy : el);
  const uniforms = {};
  for (const e of layout) {
    if (e.kind === 'float') {
      const holder = e.holder;
      uniforms[e.key] = {
        node: pick(node.element(e.index), 'float'),
        get value() { return holder.x; },
        set value(x) { holder.x = x; }
      };
    } else if (e.kind === 'vec2' || e.kind === 'vec3' || e.kind === 'vec4') {
      const vec = e.vec;
      uniforms[e.key] = {
        node: pick(node.element(e.index), e.kind),
        get value() { return vec; },
        set value(v) { vec.copy(v); }
      };
    } else {
      const base = e.index;
      const kind = e.kind;
      const arrNode = {
        isUniformBlockArray: true,
        length: e.length,
        element(i) {
          const idx = typeof i === 'number' ? base + i : int(i).add(base);
          return pick(node.element(idx), kind);
        }
      };
      let value;
      if (kind === 'float[]') {
        const holders = e.holders;
        value = new Proxy(holders, {
          get(target, prop) {
            if (prop === 'length') return holders.length;
            if (typeof prop === 'string' && /^\d+$/.test(prop)) return holders[Number(prop)].x;
            return Reflect.get(target, prop);
          },
          set(target, prop, v) {
            if (typeof prop === 'string' && /^\d+$/.test(prop)) { holders[Number(prop)].x = v; return true; }
            return Reflect.set(target, prop, v);
          }
        });
      } else {
        value = e.items;
      }
      uniforms[e.key] = { node: arrNode, value };
    }
  }
  return { uniforms, node, elements, layout };
}
