import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { MAX_NAV_LIGHT_SPRITES, NAV_LIGHT_CHASE, glslFloat } from '../game/shipLightRuntime.js';

// Billboardy blasku świateł pozycyjnych. Rysują się na warstwie 2 (pass FG,
// PO shadowShaftsPass) — tak jak lasery i muzzle flashe — więc świecą także
// w cieniu planety i rozświetlają wtedy kadłub pod sobą (blend addytywny).
// Rdzeń wypycha luminancję HDR > progu bloomu (0.9), halo zostaje pod progiem
// i działa jako miękki rozlew światła na pancerzu.
const NAV_LIGHT_Z = 13;             // FG: nad kadłubem ortho, pod laserami (14+)
const NAV_LIGHT_RENDER_ORDER = 52;  // bronie zaczynają się od 55

const NAV_LIGHT_DEFAULTS = Object.freeze({
  coreGain: 5.0,   // mnożnik HDR jasnego rdzenia lampy
  haloGain: 0.9,   // mnożnik miękkiego halo (świadomie pod progiem bloomu)
  haloScale: 16,   // promień halo = radius lampy * haloScale
  minHaloPx: 3.2   // minimalny rozmiar ekranowy błysku (mryganie z daleka)
});

function getNavLightTuning() {
  if (typeof window === 'undefined') return NAV_LIGHT_DEFAULTS;
  if (!window.__shipLights3DTune) window.__shipLights3DTune = { ...NAV_LIGHT_DEFAULTS };
  return window.__shipLights3DTune;
}

const NAV_LIGHT_VERTEX_SHADER = `
attribute vec3 aColor;
attribute vec3 aParams;

varying vec2 vLocal;
varying vec3 vColor;
varying vec3 vParams;

void main() {
  vLocal = position.xy;
  vColor = aColor;
  vParams = aParams;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position.xy, 0.0, 1.0);
}
`;

// aParams: x = faza sekwencji (0..1 wzdłuż kadłuba), y = intensywność
// (power * fade), z = coreFrac (promień rdzenia / promień halo).
// Formuła chase MUSI być identyczna z pętlą lamp w HEX_FRAGMENT_SHADER
// (hexShips3D) — stałe wstrzykiwane z NAV_LIGHT_CHASE.
const NAV_LIGHT_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uCoreGain;
uniform float uHaloGain;

varying vec2 vLocal;
varying vec3 vColor;
varying vec3 vParams;

void main() {
  float d = length(vLocal);
  if (d >= 1.0) discard;

  float chase = fract(uTime * ${glslFloat(NAV_LIGHT_CHASE.speed)} + vParams.x * ${glslFloat(NAV_LIGHT_CHASE.phaseGain)});
  float pulse = smoothstep(0.0, ${glslFloat(NAV_LIGHT_CHASE.attack)}, chase)
    * (1.0 - smoothstep(${glslFloat(NAV_LIGHT_CHASE.hold)}, ${glslFloat(NAV_LIGHT_CHASE.release)}, chase));
  float seq = mix(${glslFloat(NAV_LIGHT_CHASE.rest)}, 1.0, pulse);

  float coreFrac = max(0.02, vParams.z);
  float core = 1.0 - smoothstep(0.0, coreFrac * 1.6, d);
  float halo = pow(max(0.0, 1.0 - d), 2.4);
  float intensity = vParams.y * seq;

  vec3 col = vColor * intensity * (core * uCoreGain + halo * uHaloGain);
  float alpha = clamp(intensity * (core + halo * 0.55), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

function setAttrUpdateRange(attr, count) {
  if (!attr) return;
  if (typeof attr.clearUpdateRanges === 'function') {
    attr.clearUpdateRanges();
    if (typeof attr.addUpdateRange === 'function' && count > 0) attr.addUpdateRange(0, count);
    return;
  }
  if (!attr.updateRange) attr.updateRange = { offset: 0, count: -1 };
  attr.updateRange.offset = 0;
  attr.updateRange.count = count;
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
    this.colorArray = new Float32Array(MAX_NAV_LIGHT_SPRITES * 3);
    this.paramsArray = new Float32Array(MAX_NAV_LIGHT_SPRITES * 3);
    const colorAttr = new THREE.InstancedBufferAttribute(this.colorArray, 3);
    const paramsAttr = new THREE.InstancedBufferAttribute(this.paramsArray, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    paramsAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aColor', colorAttr);
    this.geometry.setAttribute('aParams', paramsAttr);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCoreGain: { value: NAV_LIGHT_DEFAULTS.coreGain },
        uHaloGain: { value: NAV_LIGHT_DEFAULTS.haloGain }
      },
      vertexShader: NAV_LIGHT_VERTEX_SHADER,
      fragmentShader: NAV_LIGHT_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_NAV_LIGHT_SPRITES);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = NAV_LIGHT_RENDER_ORDER;
    this.mesh.layers.set(2);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
      matrixArray[offset + 12] = Number(sprite.x) || 0;
      matrixArray[offset + 13] = -(Number(sprite.y) || 0);
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
