// src/3d/haloRing/haloPortK7Glb.js
//
// HALA K-7 Z BLENDERA (pilot 2026-10-13, docs/PILOT-blender-k7.md). Elementy hali — słupki paliwowe z ramionami
// SCARA (człony, wysięgnik, złączka), zamki pola, zbiorniki, pompy, kolektory i rurociągi paliwa, upusty, rury na
// ścianie tylnej, reflektory, ościeżnice i nadproża bram — zbudowane skryptem scripts/blender/k7/k7_hala.py z wymiarów
// gry (k7-dane.json) i wypieczone (AO w COLOR_0) do assets/k7/k7_hala.glb (LOD0) i k7_hala_lod1.glb (LOD1).
//
// DOMYŚLNA HALA GRY od 2026-10-13 (decyzja użytkownika); stara hala (bryły) zostaje do A/B:
//   ?k7=stara (albo 0 / old / false) — stara hala; brak parametru albo ?k7=blender — hala z Blendera;
//   window.__K7_GLB = true | false — to samo przed wczytaniem strony (bierze górę nad adresem).
// Bez pliku albo przy błędzie wczytania — stara hala (ostrzeżenie). Poza przeglądarką (Node) domyślnie stara. Kolizje bez zmian (te same bryły kolizji).
//
// Jak wpięte (haloPortK7.js): sekcje hali zastąpione modelem (K7_GLB_TAGS) nie są nagrywane bryłami
// (buildK7Scene, ringInfo.skipTags), a miejsca elementów (Recorder.place — kotwica, kurs, grupa ruchoma, tryb
// wysokości) dostają geometrię z pliku: JEDNA scalona geometria na zestaw (bg / fg) i LOD, wspólna dla wszystkich
// hal (ten sam układ createK7Layout), rysowana grafem K-7 (k7Graphs(u).glb — kody materiałów K-7, paleta ringu,
// lampy i reflektory hali, maska słońca ringu, grupy ruchome k7Groups). Wierzchołek niesie: pozycję w hubie PO
// odwzorowaniu wysokości (k7HeightToZ — jak bryły starej hali: 1:1 pod płaszczyzną lotu, ×0,42 nad nią; tryb 'lin'
// wysięgnika i złączki — liniowo ×0,42), normalną po tym samym odwzorowaniu, aK7 = (kod materiału, AO, grupa,
// waga płyt). Grupa ruchoma (człony ramienia, wysięgnik, złączka; zamki — emisja listwy) przesuwa wierzchołek
// macierzą grupy w shaderze (jak instancje).
//
// LOD: hala wybiera poziom z rozmiaru piksela w kamerze ringu (updateGlbLod — cullHalls w index.js / archRing.js):
// LOD0, gdy jednostka hali ma na ekranie ≥ K7_GLB_TUNE.lod0Ppu px (domyślnie 0,3 — zoom gry z góry ≈ 0,3).

import * as THREE from 'three';
import { RenderWorld } from '../../render/renderWorld.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { K7_MAT, buildK7Scene } from './haloPortK7Build.js';
import { K7_ABOVE_SCALE, K7_HEIGHTS, createK7Layout, k7HeightToZ } from './haloPortK7Layout.js';

/** Sekcje hali (K7_TAGS haloPortK7Build.js) rysowane z modelu z Blendera. */
export const K7_GLB_TAGS = Object.freeze([
  'fuel-base', 'fuel-link1', 'fuel-link2', 'fuel-rod', 'fuel-coupler', 'clamps', 'fuel-tanks', 'fuel-pumps',
  'fuel-headers', 'fuel-rack', 'fuel-vents', 'wall-pipes', 'spots', 'gate-jamb', 'gate-lintel'
]);

/** Elementy modelu (nazwy węzłów `<element>|bg` / `<element>|fg` w GLB = element w Recorder.place). */
export const K7_GLB_ELEMENTS = Object.freeze([
  'fuel-base-W', 'fuel-base-E', 'fuel-link1', 'fuel-link2', 'fuel-rod', 'fuel-coupler', 'clamp-pad', 'fuel-tank',
  'fuel-pump', 'fuel-headers', 'fuel-rack-W', 'fuel-rack-E', 'fuel-vent', 'wall-pipes', 'spot', 'gate-jamb',
  'gate-lintel-main', 'gate-lintel-side'
]);

/** Strojenie (na żywo: window.K7GlbTune w grze i w demie). */
export const K7_GLB_TUNE = {
  lod0Ppu: 0.3,      // LOD0 od tylu pikseli na jednostkę hali (histereza ±10%)
  forceLod: -1       // 0 / 1 — wymuszony poziom (A/B), −1 — z rozmiaru piksela
};

/** Budżet trójkątów na halę (strażnik tests/haloPortK7Glb.test.mjs). */
export const K7_GLB_TRI_BUDGET = Object.freeze({ lod0: 450000, lod1: 120000 });

/** Adres pliku GLB (assets/k7/, NIE public/ — tests/devPublicShadow.test.mjs). */
export function k7GlbUrl(lod = 0) {
  // jedna zmienna w szablonie (jak weaponGlb.js): Vite zamienia to na glob assets/k7/*.glb i wydaje pliki w buildzie
  const name = lod ? `k7_hala_lod${lod | 0}` : 'k7_hala';
  return new URL(`../../../assets/k7/${name}.glb`, import.meta.url).href;
}

const K7_GLB_OFF = new Set(['stara', 'old', '0', 'false']);

/** Czy hala z Blendera jest włączona w tej sesji (przełącznik; o gotowości pliku — k7GlbData). */
export function k7GlbEnabled() {
  const flag = RenderWorld.config.k7Glb;
  if (flag === true) return true;
  if (flag === false) return false;
  try {
    const search = RenderWorld.pageSearch;
    const q = search ? new URLSearchParams(search) : null;
    const v = q?.get('k7');
    if (v != null) return !K7_GLB_OFF.has(v);
  } catch (e) { /* bez location */ }
  // domyślnie tylko w przeglądarce: w Node pliku nie ma skąd pobrać, a budowa ringu pompowana synchronicznie
  // (tests/haloRingArchTlo.test.mjs) czekałaby na wczytanie bez końca — testy z GLB ustawiają __K7_GLB jawnie
  return RenderWorld.isBrowser;
}

// ---------------------------------------------------------------------------
// Parsowanie: scena glTF → elementy { [element]: { mode, sets: { bg?, fg? } } }, część zestawu =
// { pos (hub lokalnie, wysokości K-7), nor, mat (kod K7_MAT), ao, index, tris }.
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();

// Element i zestaw: ekstrasy węzła (k7_element / k7_set / k7_mode — skrypt Blendera), zapasowo nazwa
// `<element>|<zestaw>` (GLTFLoader zmienia nazwy prymitywów: kropki usuwa — „fuel-base-W|fg001”).
function elementOf(obj) {
  for (let o = obj; o; o = o.parent) {
    const u = o.userData || {};
    if (u.k7_element) return { element: String(u.k7_element), set: u.k7_set === 'fg' ? 'fg' : 'bg', mode: u.k7_mode === 'lin' ? 'lin' : 'abs' };
  }
  for (let o = obj; o; o = o.parent) {
    const n = String(o.userData?.name || o.name || '');
    const i = n.indexOf('|');
    if (i > 0) return { element: n.slice(0, i), set: n.slice(i + 1).startsWith('fg') ? 'fg' : 'bg', mode: 'abs' };
  }
  return null;
}

export function k7PartsFromGltfScene(scene, label = 'GLB') {
  scene.updateMatrixWorld(true);
  const acc = new Map();
  const unknown = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const id = elementOf(o);
    if (!id) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const col = g.attributes.color || null;
    const key = String(o.material?.name || '').split('.')[0];
    let code = K7_MAT[key];
    if (code == null) { unknown.add(o.material?.name || '(bez nazwy)'); code = K7_MAT.steel; }
    let e = acc.get(id.element);
    if (!e) {
      e = { mode: id.mode, sets: {} };
      acc.set(id.element, e);
    }
    const a = e.sets[id.set] || (e.sets[id.set] = { pos: [], nor: [], mat: [], ao: [], idx: [] });
    const base = a.pos.length / 3;
    _nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      a.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      a.nor.push(_v.x, _v.y, _v.z);
      a.mat.push(code);
      a.ao.push(col ? Math.min(1, Math.max(0, col.getX(i))) : 1);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) a.idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < pos.count; i++) a.idx.push(base + i);
  });
  const out = { elements: {}, unknownMaterials: [...unknown], hash: scene.userData?.k7_hash ?? null, lod: scene.userData?.k7_lod ?? null };
  let tris = 0;
  for (const [name, e] of acc) {
    const sets = {};
    for (const [set, a] of Object.entries(e.sets)) {
      sets[set] = Object.freeze({
        pos: Float32Array.from(a.pos), nor: Float32Array.from(a.nor), mat: Uint8Array.from(a.mat),
        ao: Float32Array.from(a.ao), index: Uint32Array.from(a.idx), tris: a.idx.length / 3
      });
      tris += a.idx.length / 3;
    }
    out.elements[name] = Object.freeze({ mode: e.mode, sets: Object.freeze(sets) });
  }
  out.tris = tris;
  if (out.unknownMaterials.length) console.warn(`[hala K-7 GLB] ${label}: nieznane materiały ${out.unknownMaterials.join(', ')} — steel`);
  return out;
}

/** ArrayBuffer GLB → elementy (k7PartsFromGltfScene). Działa też w Node (plik bez tekstur). */
export function parseK7Glb(arrayBuffer, label = 'GLB') {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
      try {
        const scene = gltf.scene;
        // ekstrasy sceny glTF (hasz wymiarów, LOD) — GLTFLoader kładzie je na userData sceny
        if (gltf.parser?.json?.scenes?.[0]?.extras) Object.assign(scene.userData, gltf.parser.json.scenes[0].extras);
        resolve(k7PartsFromGltfScene(scene, label));
      } catch (e) { reject(e); }
    }, reject);
  });
}

// ---------------------------------------------------------------------------
// Rejestr: wczytane poziomy (0, 1); null — brak (stara hala)
const _data = { lods: null, error: null };
let _loading = null;

/** Dane modelu ({ lods: [lod0, lod1] }) albo null, gdy przełącznik wyłączony, plik nie doszedł albo był błąd. */
export function k7GlbData() {
  return k7GlbEnabled() && _data.lods ? _data : null;
}

/** Rejestruje sparsowane poziomy (testy w Node, loader). */
export function registerK7Glb(lod0, lod1 = null) {
  _data.lods = [lod0, lod1 || lod0];
  _data.error = null;
  _geoCache.clear();
  _bufCache.clear();
}

/** Zapomina dane (testy). */
export function resetK7Glb() {
  _data.lods = null;
  _data.error = null;
  _loading = null;
  _geoCache.clear();
  _bufCache.clear();
}

async function fetchArrayBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
}

/**
 * Wczytuje oba poziomy (raz; kolejne wywołania — ta sama obietnica). Nigdy nie odrzuca: przełącznik wyłączony →
 * od razu null; błąd → ostrzeżenie i stara hala.
 */
export function loadK7Glb({ fetchFn = fetchArrayBuffer, force = false } = {}) {
  if (!force && !k7GlbEnabled()) return Promise.resolve(null);
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const [b0, b1] = await Promise.all([fetchFn(k7GlbUrl(0)), fetchFn(k7GlbUrl(1)).catch(() => null)]);
      const lod0 = await parseK7Glb(b0, 'k7_hala.glb');
      const lod1 = b1 ? await parseK7Glb(b1, 'k7_hala_lod1.glb') : null;
      registerK7Glb(lod0, lod1);
      // scalenie dla układu hal (createK7Layout — ten sam w każdej hali K-7 każdego ringu) porcjami w tle: budowa
      // hali bierze gotowe bufory (inaczej LOD0 ~50–150 ms CPU w jednej klatce budowy ringu)
      await prebuildK7GlbBuffers();
      return _data;
    } catch (err) {
      _data.error = err;
      console.warn(`[hala K-7 GLB] ${err?.message || err} — stara hala`);
      return null;
    }
  })();
  return _loading;
}

/** Obietnica gotowości dla budowy ringu (bez przełącznika — od razu). */
export function k7GlbWhenReady() {
  return k7GlbEnabled() ? loadK7Glb() : Promise.resolve(null);
}

/** Czy wczytanie się zakończyło (budowa ringu-archetypu czeka krokami generatora). */
export function k7GlbSettled() {
  if (!k7GlbEnabled()) return true;
  if (!_loading) loadK7Glb();
  return !!(_data.lods || _data.error);
}

// wczytanie od importu (menu: ring Ziemi buduje się w tle menu)
if (typeof window !== 'undefined' && k7GlbEnabled()) loadK7Glb();

// ---------------------------------------------------------------------------
// Scalona geometria hali z miejsc elementów (Recorder.place): na zestaw bg / fg, wspólna dla hal o tym samym układzie

/** Odwzorowanie wysokości jak bryły starej hali: 'abs' — k7HeightToZ(y + kotwica), 'lin' — y·0,42. */
export function k7GlbMapHeight(y, anchorY, mode) {
  return mode === 'lin' ? y * K7_ABOVE_SCALE : k7HeightToZ(y + anchorY);
}

const _geoCache = new Map();
const _bufCache = new Map();   // klucz (LOD + miejsca) → bufory scalone (prebuildK7GlbBuffers / pierwsza hala)

function placesKey(places) {
  let s = '';
  for (const p of places) s += `${p.element}:${p.x.toFixed(2)},${p.y},${p.z.toFixed(2)},${p.yaw.toFixed(4)},${p.group},${p.mode};`;
  return s;
}

/**
 * Bufory scalonej geometrii (bez three — testy): { bg, fg } z { position, normal, k7 (vec4), index, tris } albo null
 * dla pustego zestawu. `parts` — elementy jednego poziomu (k7PartsFromGltfScene), `places` — scene.places hali.
 */
export function buildK7GlbBuffers(parts, places) {
  const out = {};
  for (const _ of k7GlbMergeSteps(parts, places, out)) { /* do końca */ }
  return out;
}

/** To samo porcjami: przerwa (setTimeout 0) co `sliceMs` ms pracy — bez długiego zadania w klatce. */
export async function buildK7GlbBuffersAsync(parts, places, sliceMs = 6) {
  const out = {};
  let t0 = performance.now();
  for (const _ of k7GlbMergeSteps(parts, places, out)) {
    if (performance.now() - t0 > sliceMs) {
      await new Promise((r) => setTimeout(r, 0));
      t0 = performance.now();
    }
  }
  return out;
}

/** Miejsca elementów hali o układzie createK7Layout (wszystkie hale K-7 i ich zatoki — te same). */
export function k7GlbCanonicalPlaces() {
  return buildK7Scene(createK7Layout(), {}).places;
}

/** Scalenie obu poziomów dla układu hal w tle (loader; testy — sync przez acquire). */
export async function prebuildK7GlbBuffers(places = k7GlbCanonicalPlaces()) {
  const lods = _data.lods;
  if (!lods) return;
  const pk = placesKey(places);
  for (let lod = 0; lod < 2; lod++) {
    const key = `${lod}|${pk}`;
    if (!_bufCache.has(key)) _bufCache.set(key, await buildK7GlbBuffersAsync(lods[lod], places));
  }
}

// Scalanie krokami: generator ustępuje po każdym miejscu elementu (bufory wypełniane w `out`).
function* k7GlbMergeSteps(parts, places, out) {
  for (const set of ['bg', 'fg']) {
    let nv = 0;
    let ni = 0;
    for (const p of places) {
      const part = parts.elements[p.element]?.sets[set];
      if (!part) continue;
      nv += part.pos.length / 3;
      ni += part.index.length;
    }
    if (!nv) { out[set] = null; continue; }
    const position = new Float32Array(nv * 3);
    const normal = new Float32Array(nv * 3);
    const k7 = new Uint8Array(nv * 4);   // unorm8 ×4: kod materiału /255, AO, grupa /255, waga płyt
    const index = new Uint32Array(ni);
    let v0 = 0;
    let i0 = 0;
    const flight = K7_HEIGHTS.hullTop;
    for (const p of places) {
      const el = parts.elements[p.element];
      const part = el?.sets[set];
      if (!part) continue;
      const mode = el.mode === 'lin' || p.mode === 'lin' ? 'lin' : 'abs';
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      const P = part.pos;
      const N = part.nor;
      const n = P.length / 3;
      for (let i = 0; i < n; i++) {
        const lx = P[i * 3];
        const ly = P[i * 3 + 1];
        const lz = P[i * 3 + 2];
        const o = (v0 + i) * 3;
        // kurs: obrót wokół pionu jak rotY brył (lokalne +x → (cos, −sin)·… — x' = x·c + z·s, z' = −x·s + z·c)
        position[o] = p.x + lx * c + lz * s;
        position[o + 2] = p.z - lx * s + lz * c;
        position[o + 1] = mode === 'lin' ? ly * K7_ABOVE_SCALE : k7HeightToZ(ly + p.y);
        let nx = N[i * 3];
        let ny = N[i * 3 + 1];
        let nz = N[i * 3 + 2];
        const rx = nx * c + nz * s;
        const rz = -nx * s + nz * c;
        // normalna po odwzorowaniu wysokości: n' ∝ (nx, ny / f', nz); f' — pochodna w punkcie tuż pod powierzchnią
        let k = 1;
        if (mode === 'lin') k = K7_ABOVE_SCALE;
        else if (ly + p.y - 0.5 * ny > flight) k = K7_ABOVE_SCALE;
        ny /= k;
        const len = Math.hypot(rx, ny, rz) || 1;
        normal[o] = rx / len;
        normal[o + 1] = ny / len;
        normal[o + 2] = rz / len;
        const q = (v0 + i) * 4;
        k7[q] = part.mat[i];
        k7[q + 1] = Math.round(part.ao[i] * 255);
        k7[q + 2] = p.group || 0;
        k7[q + 3] = 255;
      }
      const I = part.index;
      for (let j = 0; j < I.length; j++) index[i0 + j] = I[j] + v0;
      v0 += n;
      i0 += I.length;
      yield;
    }
    out[set] = { position, normal, k7, index, tris: ni / 3, verts: nv };
  }
}

/**
 * Geometrie three (wspólne dla hal o tych samych miejscach; licznik użyć — releaseK7GlbGeometry): { bg, fg, tris }
 * dla poziomu `lod`. Kula obejmująca — kompleksu hali (obcinanie jak instancje starej hali).
 */
export function acquireK7GlbGeometry(lod, places, sphere) {
  const data = k7GlbData();
  const parts = data?.lods?.[lod | 0];
  if (!parts) return null;
  const key = `${lod | 0}|${placesKey(places)}`;
  let e = _geoCache.get(key);
  if (!e) {
    let buf = _bufCache.get(key);
    if (!buf) _bufCache.set(key, (buf = buildK7GlbBuffers(parts, places)));
    const geo = {};
    let tris = 0;
    for (const set of ['bg', 'fg']) {
      const b = buf[set];
      if (!b) { geo[set] = null; continue; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
      g.setAttribute('aK7', new THREE.BufferAttribute(b.k7, 4, true));
      g.setIndex(new THREE.BufferAttribute(b.index, 1));
      g.boundingSphere = sphere.clone();
      g.name = `K7 GLB LOD${lod | 0} ${set}`;
      geo[set] = g;
      tris += b.tris;
    }
    e = { key, geo, tris, users: 0 };
    _geoCache.set(key, e);
  }
  e.users++;
  return e;
}

export function releaseK7GlbGeometry(entry) {
  if (!entry || --entry.users > 0) return;
  for (const g of Object.values(entry.geo)) g?.dispose();
  _geoCache.delete(entry.key);
}
