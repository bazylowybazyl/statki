// src/3d/hexBodyImpostorBatch.js
//
// Jedno wywołanie na WSZYSTKIE dalekie ciała heksowe.
//
// Wraki i fragmenty są przypięte do pełnego LOD-u na zawsze (hexLodPolicy.js →
// wczesny `return` w resolveHexLod). Powód jest słuszny: impostor pancerza rysuje
// CAŁY sprite źródłowy, więc fragment zamieniłby się z powrotem w nienaruszony
// kadłub. Skutek uboczny był taki, że po bitwie z 286 wrakami pass Ortho miał 325
// wywołań, z czego 286 to były same wraki — i koszt narastał przez całą walkę,
// bo debris nigdy nie znika.
//
// Kluczowa obserwacja z pomiarów: przełączenie wraku na impostor NIE zmniejsza
// liczby wywołań (zamienia `mesh` na `armorMesh`, dalej jedno na ciało). Zbić
// da się je tylko scalając ciała między sobą. Tutaj robimy to dla przypadku,
// który faktycznie boli — pola bitwy oglądanego z oddali, gdzie wrak ma na
// ekranie kilkanaście pikseli i jest smugą, nie sylwetką.
//
// Kolor bierzemy ze średniej z canvasa sprite'a (raz na ciało), więc smugi mają
// barwę swojego kadłuba zamiast jednolitej szarości.

import * as THREE from 'three/webgpu';
import { Fn, If, Discard, float, vec2, vec3, vec4, attribute, uv, positionGeometry, cos, sin, length, smoothstep } from 'three/tsl';
import { Core3D } from './core3d.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { sunShadeUnlit } from './hexShips3D.tsl.js';
import { averageImageRGB } from '../render/bodyColor.js';
import { zbierzZakres } from './zakresyWysylki.js';

const MAX_IMPOSTORS = 2048;

// Materiał smug (TSL, port WebGPU — zadanie 04). Wierzchołek: kwadrat × rozmiar,
// obrót, pozycja względem początku batcha (mesh.position — sceneOrigin.js), z = −0,3.
// Fragment: miękka elipsa z lekko ściemnionym brzegiem — na kilkunastu pikselach
// czyta się jak kawałek blachy, a nie jak kropka. Kolor = średnia sprite'a bez
// światła, więc cień planety (maska Core3D) przygasza całość jak nocną stronę
// kadłuba (sunShadeUnlit — to samo miejsce importu maski co kadłuby).
function createImpostorMaterial() {
  const aPos = attribute('aPos', 'vec2');
  const aRot = attribute('aRot', 'float');
  const aSize = attribute('aSize', 'vec2');
  const aColor = attribute('aColor', 'vec3');
  const aOpacity = attribute('aOpacity', 'float');
  const local = positionGeometry.xy.mul(aSize);
  const c = cos(aRot);
  const s = sin(aRot);
  const rotated = vec2(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)));

  const material = new THREE.NodeMaterial();
  material.name = 'hull:impostor';
  material.lights = false;
  material.fog = false;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.positionNode = vec3(aPos.add(rotated), -0.3);
  material.fragmentNode = Fn(() => {
    const d = uv().sub(0.5).mul(2.0);
    const r = length(d).toVar();
    If(r.greaterThan(1.0), () => {
      Discard();
    });
    const mask = float(1.0).sub(smoothstep(0.55, 1.0, r));
    const color = sunShadeUnlit(aColor.mul(float(1.0).sub(r).mul(0.25).add(0.75)));
    return vec4(color, mask.mul(aOpacity));
  })();
  return material;
}

let mesh = null;
let geo = null;
let arrays = null;
let count = 0;
// Początek układu tej klatki (sceneOrigin.js): aPos względem niego, duży
// kawałek w mesh.position — smugi (także zimnych wraków, rysowanych nimi przy
// każdym zoomie) nie drgają przy 5–10 mln j.
const origin = { x: 0, y: 0 };

function ensureBuilt() {
  if (mesh) return true;
  if (!Core3D.isInitialized || !Core3D.scene) return false;

  const base = new THREE.PlaneGeometry(1, 1);
  geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = 0;

  arrays = {};
  for (const [name, itemSize] of [['aPos', 2], ['aRot', 1], ['aSize', 2], ['aColor', 3], ['aOpacity', 1]]) {
    const array = new Float32Array(MAX_IMPOSTORS * itemSize);
    const attr = new THREE.InstancedBufferAttribute(array, itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attr);
    arrays[name] = array;
  }

  mesh = new THREE.Mesh(geo, createImpostorMaterial());
  mesh.frustumCulled = false;
  // Tuż pod siatkami kadłubów (renderOrder 10), żeby żywy statek zawsze
  // przykrywał smugę, gdy się na siebie nakładają.
  mesh.renderOrder = 8;
  mesh.visible = false;
  Core3D.scene.add(mesh);
  return true;
}

// Rozgrzewka (zadanie 25a): batch powstawał przy pierwszej smudze (daleki kadłub, zimny wrak) i kompilował się
// w tej klatce (pipeline synchronicznie — harness: galeria-przebicie). Na ekranie ładowania: batch od razu, pass ortho.
Core3D.warmup?.add({ name: 'smugi dalekich kadłubów (hexBodyImpostorBatch)', objects: () => (ensureBuilt() ? mesh : null), layer: 0, phase: 'loading' });

// Kolor per obraz źródłowy (audyt FPS 2026-10-11): wraki dziedziczą obraz rodu (hullBodies.js), a każdy nowy wrak
// liczył średnią od nowa — płótno, drawImage całego sprite'a i getImageData (szczyty 0,8–1,1 ms/kl w końcówce
// bitwy). Wynik tylko do odczytu (wołający czytają r, g, b). `averageBodyColorCache.enabled = false` — A/B.
const _avgColorBySource = new WeakMap();
export const averageBodyColorCache = { enabled: true };

/**
 * Średni kolor sprite'a ciała — liczony RAZ na obraz (src/render/bodyColor.js, wspólny z grą: smuga zimnego wraku
 * liczona przy zamrażaniu, RW-31). Tu jako THREE.Color — ten sam obiekt dla wszystkich wraków rodu.
 */
export function computeAverageBodyColor(source) {
  if (!source || typeof source !== 'object') return null;
  const cache = averageBodyColorCache.enabled;
  if (cache) {
    const cached = _avgColorBySource.get(source);
    if (cached !== undefined) return cached;
  }
  const rgb = averageImageRGB(source, cache);
  if (!rgb) return null;
  const color = new THREE.Color(rgb.r, rgb.g, rgb.b);
  // zapamiętany tylko udany wynik (płótno źródłowe bez treści albo błąd odczytu — następne wołanie spróbuje znowu)
  if (cache) _avgColorBySource.set(source, color);
  return color;
}

export const HexBodyImpostorBatch = {
  MAX_IMPOSTORS,

  // Wołane z updateHexShips3D po Core3D.syncCamera — kamera tej klatki.
  begin() {
    count = 0;
    sceneOriginNearCamera(origin);
  },

  /**
   * @param {object} p
   *   x, y     pozycja ciała w przestrzeni sceny
   *   rot      obrót w przestrzeni sceny [rad]
   *   halfW/H  połowa rozmiaru na ekranie świata
   *   color    THREE.Color
   *   opacity  0..1 (przenikanie na progu)
   */
  push(p) {
    return this.pushRaw(p.x, p.y, p.rot, p.halfW, p.halfH, p.color.r, p.color.g, p.color.b, p.opacity);
  },

  /**
   * To samo co push, bez obiektu — dla pętli po setkach ciał co klatkę
   * (zimne wraki). false = batch pełny albo jeszcze niezbudowany.
   */
  pushRaw(x, y, rot, halfW, halfH, r, g, b, opacity) {
    if (!ensureBuilt()) return false;
    if (count >= MAX_IMPOSTORS) return false;
    const i = count++;
    const i2 = i * 2;
    const i3 = i * 3;
    arrays.aPos[i2] = x - origin.x;
    arrays.aPos[i2 + 1] = y - origin.y;
    arrays.aRot[i] = rot;
    arrays.aSize[i2] = halfW;
    arrays.aSize[i2 + 1] = halfH;
    arrays.aColor[i3] = r;
    arrays.aColor[i3 + 1] = g;
    arrays.aColor[i3 + 2] = b;
    arrays.aOpacity[i] = opacity;
    return true;
  },

  flush() {
    if (!mesh) return;
    const visible = count > 0;
    if (mesh.visible !== visible) mesh.visible = visible;
    if (geo.instanceCount !== count) geo.instanceCount = count;
    if (!visible) return;
    mesh.position.set(origin.x, origin.y, 0);
    for (const name of Object.keys(arrays)) {
      const attr = geo.getAttribute(name);
      if (!attr) continue;
      if (attr.updateRanges && attr.updateRanges.length >= 8) attr.clearUpdateRanges();
      else if (attr.addUpdateRange) attr.addUpdateRange(0, count * (attr.itemSize || 1));
      attr.needsUpdate = true;
    }
  },

  getCount() { return count; },

  dispose() {
    // kropki soczewki (HexBodyLensBatch) dzielą materiał — najpierw one
    HexBodyLensBatch.dispose();
    if (mesh) {
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.material.dispose();
    }
    if (geo) geo.dispose();
    mesh = null;
    geo = null;
    arrays = null;
    count = 0;
  }
};

// SOCZEWKA ŚWIATA — KROPKI FLOT, NPC I WRAKÓW (DECYZJE E2 / E3, etap 3A 2026-10-26): druga partia smug na TYM SAMYM
// materiale (ten sam graf TSL i układ atrybutów — ten sam pipeline, rozgrzany wpisem niżej), siatka na z = WARP_LENS_DOT_Z
// pod płaszczyzną gry: kropki soczewki skoku gracza rysują się w passie gry POD kadłubami (test głębi, bez zapisu) —
// nic z soczewki nie leży na statku. Jeden rysunek, tylko w skoku (pusta partia — schowana). Pisze hexShips3D
// (encje z kropką soczewki — `lensDot`, zimne wraki, rekordy dodatkowe ze smugą: olbrzymy pasa). Wysyłka zakresami
// (zakresyWysylki.js), bez DynamicDrawUsage.
export const WARP_LENS_DOT_Z = -640;
const LENS_MAX = 2048;
let lensMesh = null;
let lensGeo = null;
let lensArrays = null;
let lensCount = 0;
const lensOrigin = { x: 0, y: 0 };

function ensureLensBuilt() {
  if (lensMesh) return true;
  if (!ensureBuilt()) return false;
  const base = new THREE.PlaneGeometry(1, 1);
  lensGeo = new THREE.InstancedBufferGeometry();
  lensGeo.index = base.index;
  lensGeo.setAttribute('position', base.attributes.position);
  lensGeo.setAttribute('uv', base.attributes.uv);
  lensGeo.instanceCount = 0;
  lensArrays = {};
  for (const [name, itemSize] of [['aPos', 2], ['aRot', 1], ['aSize', 2], ['aColor', 3], ['aOpacity', 1]]) {
    const array = new Float32Array(LENS_MAX * itemSize);
    lensGeo.setAttribute(name, new THREE.InstancedBufferAttribute(array, itemSize));
    lensArrays[name] = array;
  }
  lensMesh = new THREE.Mesh(lensGeo, mesh.material);
  lensMesh.name = 'HexBodyLensBatch';
  lensMesh.frustumCulled = false;
  lensMesh.renderOrder = 8;
  lensMesh.visible = false;
  Core3D.scene.add(lensMesh);
  return true;
}

Core3D.warmup?.add({ name: 'kropki soczewki skoku (HexBodyLensBatch)', objects: () => (ensureLensBuilt() ? lensMesh : null), layer: 0, phase: 'loading' });

export const HexBodyLensBatch = {
  MAX_IMPOSTORS: LENS_MAX,

  /** Początek klatki (po Core3D.syncCamera): pusta partia, początek układu przy kamerze (sceneOrigin.js). */
  begin() {
    lensCount = 0;
    sceneOriginNearCamera(lensOrigin);
  },

  /** Smuga w scenie (x, −y gry), obrót sceny, połowy boków [j. sceny], barwa, krycie. false — partia pełna. */
  pushRaw(x, y, rot, halfW, halfH, r, g, b, opacity) {
    if (!ensureLensBuilt()) return false;
    if (lensCount >= LENS_MAX) return false;
    const i = lensCount++;
    const i2 = i * 2;
    const i3 = i * 3;
    lensArrays.aPos[i2] = x - lensOrigin.x;
    lensArrays.aPos[i2 + 1] = y - lensOrigin.y;
    lensArrays.aRot[i] = rot;
    lensArrays.aSize[i2] = halfW;
    lensArrays.aSize[i2 + 1] = halfH;
    lensArrays.aColor[i3] = r;
    lensArrays.aColor[i3 + 1] = g;
    lensArrays.aColor[i3 + 2] = b;
    lensArrays.aOpacity[i] = opacity;
    return true;
  },

  flush() {
    if (!lensMesh) return;
    const visible = lensCount > 0;
    if (lensMesh.visible !== visible) lensMesh.visible = visible;
    if (lensGeo.instanceCount !== lensCount) lensGeo.instanceCount = lensCount;
    if (!visible) return;
    lensMesh.position.set(lensOrigin.x, lensOrigin.y, WARP_LENS_DOT_Z);
    for (const name in lensArrays) {
      const attr = lensGeo.getAttribute(name);
      zbierzZakres(attr, 0, lensCount * attr.itemSize);
    }
  },

  getCount() { return lensCount; },

  dispose() {
    if (lensMesh && lensMesh.parent) lensMesh.parent.remove(lensMesh);
    if (lensGeo) lensGeo.dispose();
    lensMesh = null;
    lensGeo = null;
    lensArrays = null;
    lensCount = 0;
  }
};
