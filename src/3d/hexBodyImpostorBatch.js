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

/**
 * Średni kolor sprite'a ciała — liczony RAZ, z rzadkiego próbkowania canvasa.
 * Bierzemy tylko piksele o sensownej alfie, inaczej przezroczyste tło zjadałoby
 * barwę do czerni.
 */
export function computeAverageBodyColor(source) {
  if (!source) return null;
  const width = source.naturalWidth || source.width || 0;
  const height = source.naturalHeight || source.height || 0;
  if (!width || !height) return null;

  // NIGDY nie wołamy getContext/getImageData na źródle. `grid.cacheCanvas` to
  // ten sam canvas, z którego leci texImage2D pancerza — pobranie z niego
  // kontekstu 2D z `willReadFrequently` (albo samo getImageData) każe
  // przeglądarce przenieść backing store do pamięci CPU i od tej pory KAŻDY
  // upload tekstury z tego canvasa jest wolny, na stałe. Kopiujemy do własnego
  // bufora 32x32 i czytamy tylko jego.
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(32, width);
  canvas.height = Math.min(32, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try { ctx.drawImage(source, 0, 0, canvas.width, canvas.height); }
  catch (_) { return null; }

  let data;
  try { data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; }
  catch (_) { return null; }

  const stride = Math.max(1, Math.floor((canvas.width * canvas.height) / 1024));
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < canvas.width * canvas.height; i += stride) {
    const o = i * 4;
    if (data[o + 3] < 64) continue;
    r += data[o]; g += data[o + 1]; b += data[o + 2];
    n++;
  }
  if (n === 0) return null;
  return new THREE.Color((r / n) / 255, (g / n) / 255, (b / n) / 255);
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
