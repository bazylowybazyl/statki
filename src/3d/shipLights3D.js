import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard,
  attribute, clamp, float, fract, length, max, mix, positionGeometry, pow, smoothstep, uniform, varying, vec4
} from 'three/tsl';
import { Core3D } from './core3d.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { MAX_NAV_LIGHT_SPRITES, NAV_LIGHT_CHASE } from '../game/shipLightRuntime.js';
import { uniformsAdapter } from './tsl/uniformy.js';

// Billboardy blasku świateł pozycyjnych. Rysują się na warstwie 2 (pass FG)
// i jak każda emisja nie czytają maski cienia (sunShadowMask.js), więc świecą
// także w cieniu planety i rozświetlają wtedy kadłub pod sobą (blend addytywny).
// Rdzeń wypycha luminancję HDR > progu bloomu (0.9), halo zostaje pod progiem
// i działa jako miękki rozlew światła na pancerzu.
//
// Port WebGPU (zadanie 15): materiał w TSL (NodeMaterial), wzory 1:1 z dawnym
// GLSL. InstancedMesh zostaje — three sam mnoży pozycję przez macierz instancji
// (przy ≤ 1024 instancjach to bufor uniformów, powyżej — atrybut instancji),
// a modelViewMatrix składa na CPU w double (renderer.highPrecision).
const NAV_LIGHT_Z = 13;             // FG: nad kadłubem ortho, pod laserami (14+)
const NAV_LIGHT_RENDER_ORDER = 52;  // bronie zaczynają się od 55

// 2026-09-26 (user: „żeby mocniej świeciły”): rdzeń 5 → 6,5, halo 0,9 → 1,3
// i o ~20% szersze. Rozlew na skały i sąsiednie kadłuby liczą grupy lamp
// (shipLightRuntime.buildNavLightClusters), nie te billboardy.
const NAV_LIGHT_DEFAULTS = Object.freeze({
  coreGain: 6.5,   // mnożnik HDR jasnego rdzenia lampy
  haloGain: 1.3,   // mnożnik miękkiego halo (świadomie pod progiem bloomu)
  haloScale: 19,   // promień halo = radius lampy * haloScale
  minHaloPx: 3.2   // minimalny rozmiar ekranowy błysku (mryganie z daleka)
});

function getNavLightTuning() {
  if (typeof window === 'undefined') return NAV_LIGHT_DEFAULTS;
  if (!window.__shipLights3DTune) window.__shipLights3DTune = { ...NAV_LIGHT_DEFAULTS };
  return window.__shipLights3DTune;
}

// aParams: x = faza sekwencji (0..1 wzdłuż kadłuba), y = intensywność
// (power * fade), z = coreFrac (promień rdzenia / promień halo).
// Formuła chase MUSI być identyczna z pętlą lamp kadłuba (hexShips3D.tsl.js) —
// stałe z NAV_LIGHT_CHASE.
function navLightFragment(U) {
  const vLocal = varying(positionGeometry.xy, 'vNavLocal');
  const vColor = varying(attribute('aColor', 'vec3'), 'vNavColor');
  const vParams = varying(attribute('aParams', 'vec3'), 'vNavParams');
  return Fn(() => {
    const d = length(vLocal).toVar();
    If(d.greaterThanEqual(1.0), () => {
      Discard();
    });

    const chase = fract(U.uTime.mul(NAV_LIGHT_CHASE.speed).add(vParams.x.mul(NAV_LIGHT_CHASE.phaseGain))).toVar();
    const pulse = smoothstep(0.0, NAV_LIGHT_CHASE.attack, chase)
      .mul(float(1.0).sub(smoothstep(NAV_LIGHT_CHASE.hold, NAV_LIGHT_CHASE.release, chase)));
    const seq = mix(float(NAV_LIGHT_CHASE.rest), float(1.0), pulse);

    const coreFrac = max(0.02, vParams.z);
    const core = float(1.0).sub(smoothstep(0.0, coreFrac.mul(1.6), d));
    // max(0, 1 − d) ≥ 0: potęga bez ujemnej podstawy (NaN w WGSL).
    const halo = pow(max(0.0, float(1.0).sub(d)), 2.4);
    const intensity = vParams.y.mul(seq).toVar();

    const col = vColor.mul(intensity).mul(core.mul(U.uCoreGain).add(halo.mul(U.uHaloGain)));
    const alpha = clamp(intensity.mul(core.add(halo.mul(0.55))), 0.0, 1.0);
    return vec4(col, alpha);
  })();
}

// Początek układu instancji przy kamerze (sceneOrigin.js) — scratch bez alokacji.
const _origin = { x: 0, y: 0 };

// Zakres uploadu: WebGPU (three r183) wysyła atrybut z zakresami po zmianie
// wersji; bez zakresów — cały bufor. Atrybuty mają domyślne użycie
// (DynamicDrawUsage w backendzie WebGPU = pełny upload przy KAŻDYM renderze).
function setAttrUpdateRange(attr, count) {
  if (!attr) return;
  attr.clearUpdateRanges();
  if (count > 0) attr.addUpdateRange(0, count);
}

export const ShipLights3D = {
  mesh: null,
  material: null,
  geometry: null,
  colorArray: null,
  paramsArray: null,

  // Parametry budowy sprite'ów dla buildPositionLightWorldSprites — trzymane
  // w tym module, żeby cały wygląd świateł tuningować w jednym miejscu.
  getSpriteBuildParams(cameraZoom) {
    const tune = getNavLightTuning();
    const haloScale = Number(tune.haloScale);
    const minHaloPx = Number(tune.minHaloPx);
    const zoom = Number(cameraZoom) > 0 ? Number(cameraZoom) : 1;
    return {
      haloScale: Number.isFinite(haloScale) && haloScale > 0 ? haloScale : NAV_LIGHT_DEFAULTS.haloScale,
      minHaloWorld: (Number.isFinite(minHaloPx) && minHaloPx >= 0 ? minHaloPx : NAV_LIGHT_DEFAULTS.minHaloPx) / zoom
    };
  },

  _ensure() {
    if (this.mesh || !Core3D.isInitialized || !Core3D.scene) return !!this.mesh;

    this.geometry = new THREE.PlaneGeometry(2, 2);
    // Shader czyta tylko pozycję — bez normalnych i uv (mniej buforów wierzchołków).
    this.geometry.deleteAttribute('normal');
    this.geometry.deleteAttribute('uv');
    this.colorArray = new Float32Array(MAX_NAV_LIGHT_SPRITES * 3);
    this.paramsArray = new Float32Array(MAX_NAV_LIGHT_SPRITES * 3);
    const colorAttr = new THREE.InstancedBufferAttribute(this.colorArray, 3);
    const paramsAttr = new THREE.InstancedBufferAttribute(this.paramsArray, 3);
    this.geometry.setAttribute('aColor', colorAttr);
    this.geometry.setAttribute('aParams', paramsAttr);

    const U = uniformsAdapter({
      uTime: uniform(0),
      uCoreGain: uniform(NAV_LIGHT_DEFAULTS.coreGain),
      uHaloGain: uniform(NAV_LIGHT_DEFAULTS.haloGain)
    });
    const material = new THREE.NodeMaterial();
    material.name = 'shipNavLights';
    material.uniforms = U;
    material.lights = false;
    material.fog = false;
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.DoubleSide;
    // Przezroczysty DoubleSide WebGPU rysowałby dwa razy (tył, przód) — WebGL
    // (ShaderMaterial) rysował raz.
    material.forceSinglePass = true;
    material.fragmentNode = navLightFragment(U);
    this.material = material;

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_NAV_LIGHT_SPRITES);
    this.mesh.name = 'SHIP_NAV_LIGHTS';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = NAV_LIGHT_RENDER_ORDER;
    this.mesh.layers.set(2);
    Core3D.scene.add(this.mesh);
    return true;
  },

  // sprites: wynik buildPositionLightWorldSprites (koordy świata gry).
  sync(sprites, timeSec) {
    const count = Array.isArray(sprites) ? Math.min(sprites.length, MAX_NAV_LIGHT_SPRITES) : 0;
    if (!this.mesh && count === 0) return;
    if (!this._ensure()) return;

    const tune = getNavLightTuning();
    const coreGain = Number(tune.coreGain);
    const haloGain = Number(tune.haloGain);
    this.material.uniforms.uTime.value = Number(timeSec) || 0;
    this.material.uniforms.uCoreGain.value = Number.isFinite(coreGain) ? Math.max(0, coreGain) : NAV_LIGHT_DEFAULTS.coreGain;
    this.material.uniforms.uHaloGain.value = Number.isFinite(haloGain) ? Math.max(0, haloGain) : NAV_LIGHT_DEFAULTS.haloGain;

    // Translacje względem początku przy kamerze: duży kawałek niesie
    // mesh.position (modelViewMatrix w double), float32 w shaderze dostaje
    // małe liczby — lampy nie drgają względem kadłuba przy 5–10 mln j.
    const org = sceneOriginNearCamera(_origin);
    this.mesh.position.set(org.x, org.y, 0);
    const matrixArray = this.mesh.instanceMatrix.array;
    for (let i = 0; i < count; i++) {
      const sprite = sprites[i];
      const halo = Math.max(0.5, Number(sprite.haloWorld) || 1);
      const offset = i * 16;
      matrixArray[offset + 0] = halo;
      matrixArray[offset + 1] = 0;
      matrixArray[offset + 2] = 0;
      matrixArray[offset + 3] = 0;
      matrixArray[offset + 4] = 0;
      matrixArray[offset + 5] = halo;
      matrixArray[offset + 6] = 0;
      matrixArray[offset + 7] = 0;
      matrixArray[offset + 8] = 0;
      matrixArray[offset + 9] = 0;
      matrixArray[offset + 10] = 1;
      matrixArray[offset + 11] = 0;
      // Świat gry -> scena three: Y jest odbite (tak jak mesh.position statków).
      matrixArray[offset + 12] = (Number(sprite.x) || 0) - org.x;
      matrixArray[offset + 13] = -(Number(sprite.y) || 0) - org.y;
      matrixArray[offset + 14] = NAV_LIGHT_Z;
      matrixArray[offset + 15] = 1;

      this.colorArray[i * 3] = Number(sprite.color?.r) || 0;
      this.colorArray[i * 3 + 1] = Number(sprite.color?.g) || 0;
      this.colorArray[i * 3 + 2] = Number(sprite.color?.b) || 0;

      this.paramsArray[i * 3] = Number(sprite.phase) || 0;
      this.paramsArray[i * 3 + 1] = Math.max(0, Number(sprite.intensity) || 0);
      this.paramsArray[i * 3 + 2] = Math.max(0.02, Math.min(1, (Number(sprite.coreWorld) || 1) / halo));
    }

    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count > 0) {
      setAttrUpdateRange(this.mesh.instanceMatrix, count * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      const colorAttr = this.geometry.getAttribute('aColor');
      const paramsAttr = this.geometry.getAttribute('aParams');
      setAttrUpdateRange(colorAttr, count * 3);
      setAttrUpdateRange(paramsAttr, count * 3);
      colorAttr.needsUpdate = true;
      paramsAttr.needsUpdate = true;
    }
  },

  dispose() {
    if (Core3D.scene && this.mesh) Core3D.scene.remove(this.mesh);
    this.geometry?.dispose?.();
    this.material?.dispose?.();
    this.mesh = null;
    this.material = null;
    this.geometry = null;
    this.colorArray = null;
    this.paramsArray = null;
  }
};

// Pipeline świateł pozycyjnych na ekranie ładowania (zadanie 11, Core3D.warmup — dawniej budowa w pierwszej klatce gry).
Core3D.warmup?.add({ name: 'światła pozycyjne statków', objects: () => (ShipLights3D._ensure() ? ShipLights3D.mesh : null), phase: 'loading' });
