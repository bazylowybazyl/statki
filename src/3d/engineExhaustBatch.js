// src/3d/engineExhaustBatch.js
//
// Jedna instancjonowana pula na WSZYSTKIE dysze w grze.
//
// Poprzednio `createShortNeedleExhaust()` budowało na każdą dyszę cztery osobne
// obiekty — Mesh płomienia z własnym ShaderMaterial i własną PlaneGeometry, plus
// trzy Sprite'y z własnymi SpriteMaterial. Nic nie było współdzielone, więc nic
// nie dawało się zbatchować: 4 draw calle na dyszę. Przy 103 dyszach (19 statków)
// to 412 z 787 wywołań passa Ortho, przy 365 dyszach — 1460 z 1483. Pass Ortho
// jest związany submisją (~6 µs na wywołanie), więc to była największa
// pojedyncza pozycja w klatce.
//
// Tutaj wszystkie płomienie idą jednym wywołaniem, a każda z trzech warstw
// poświaty kolejnym: 4 draw calle niezależnie od wielkości floty.
//
// Wygląd zostaje bez zmian — fragment shader płomienia jest przeniesiony 1:1,
// a to, co było uniformem per dysza, jest teraz atrybutem instancji. Również
// czas: oryginał trzymał własne `uTime` w każdej dyszy (rosło o dt od momentu
// utworzenia), więc turbulencja i shock diamonds były rozjechane między
// silnikami. Wspólny uniform zsynchronizowałby całą flotę w jeden rytm, dlatego
// czas jedzie jako atrybut `aTime`.

import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { makeFlareTexture, makeGlowTexture, makeRingTexture } from '../../Engineeffects.js';

const MAX_NOZZLES = 4096;

// Point lighty dysz były najdroższą wersją tego pomysłu: jedno światło na dyszę,
// 365 w bitwie. Zostaje pula o stałym rozmiarze przypisywana najmocniejszym
// dyszom — reszta ma tylko poświatę sprite'ową i nikt tego nie zauważy.
const MAX_ENGINE_LIGHTS = 24;

// HDR: plazma dyszy musi przekraczać próg bloomu (src/3d/bloomConfig.js).
const ENGINE_HDR = 2.4;

// Głębokości z oryginalnej hierarchii: grupa dyszy siedziała na z=-5, a w niej
// płomień 0, heat glow 0.1, ring 0.2, flara 1.5.
const Z_FLAME = -5.0;
const Z_GLOW = -4.9;
const Z_RING = -4.8;
const Z_FLARE = -3.5;

const FLAME_VERTEX_SHADER = `
attribute vec2 aPos;
attribute float aRot;
attribute vec2 aScale;
attribute vec2 aFlame;
attribute float aTime;
attribute float aThrottle;
attribute float aBoost;
attribute float aCurve;
attribute vec3 aColorCore;
attribute vec3 aColorEdge;

varying vec2 vUv;
varying float vTime;
varying float vThrottle;
varying float vBoost;
varying float vCurve;
varying vec3 vColorCore;
varying vec3 vColorEdge;

void main() {
    vUv = uv;
    vTime = aTime;
    vThrottle = aThrottle;
    vBoost = aBoost;
    vCurve = aCurve;
    vColorCore = aColorCore;
    vColorEdge = aColorEdge;

    // Odwzorowanie starego łańcucha: mesh miał scale (totalWidth, totalLen)
    // i position.y = -totalLen/2 WEWNĄTRZ grupy dyszy, a grupa własny obrót,
    // skalę i pozycję w świecie.
    vec2 local = vec2(position.x * aFlame.x, position.y * aFlame.y - aFlame.y * 0.5);
    local *= aScale;
    float c = cos(aRot);
    float s = sin(aRot);
    vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aPos + rotated, ${Z_FLAME.toFixed(1)}, 1.0);
}
`;

const FLAME_FRAGMENT_SHADER = `
varying vec2 vUv;
varying float vTime;
varying float vThrottle;
varying float vBoost;
varying float vCurve;
varying vec3 vColorCore;
varying vec3 vColorEdge;

float random (in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
    // MSAA liczy piksel krawędzi w jego środku, także POZA kwadem — uv wychodzi
    // lekko poza [0, 1], a pow(y, ...) z ujemnym y daje w ANGLE/HLSL NaN, który
    // bloom rozlewa na cały ekran.
    vec2 uv = clamp(vUv, 0.0, 1.0);
    float x = (uv.x - 0.5) * 2.0;
    float y = 1.0 - uv.y;

    float visibleLength = 0.2 + 0.78 * (vThrottle + vBoost);
    float lengthMask = 1.0 - smoothstep(visibleLength * 0.7, visibleLength, y);

    float curvePow = max(0.2, vCurve);
    float width = (1.0 - pow(y, curvePow)) * 0.95;
    width *= (1.0 + vBoost * 0.4);

    float shape = 1.0 - smoothstep(width * 0.4, width, abs(x));
    shape *= smoothstep(0.0, 0.1, y);
    shape *= (1.0 - smoothstep(0.4, 0.95, y));

    float turbulenceMix = smoothstep(0.0, 0.3, vThrottle + vBoost);
    float flowSpeed = vTime * 8.0 * (1.0 + vThrottle * 2.5);
    float n = noise(vec2(x * 2.5, y * 6.0 - flowSpeed));
    float finalShape = mix(shape, shape * (0.7 + 0.4 * n), turbulenceMix);

    float diamonds = sin(y * 22.0 - vTime * 4.0) * sin(y * 14.0 + vTime * 9.0);
    float diamondPattern = smoothstep(0.3, 0.9, diamonds);
    diamondPattern *= (1.0 - abs(x) * 1.5);
    float diamondStr = smoothstep(0.2, 1.0, vThrottle) * (1.0 - vBoost);

    float coreGlowDist = length(vec2(x * 0.7, y * 4.0));
    float coreGlow = pow((1.0 - smoothstep(0.0, 0.6, coreGlowDist)), 2.0);
    float idlePulse = 0.9 + 0.1 * sin(vTime * 4.0);

    float coreIntensity = pow(clamp(1.0 - abs(x) / (width * 1.2), 0.0, 1.0), 3.0);
    vec3 color = mix(vColorEdge, vColorCore, coreIntensity);
    color += vColorCore * diamondPattern * diamondStr * 0.9;

    float streamAlpha = finalShape * lengthMask * (0.5 + 0.5 * vThrottle);
    float glowAlpha = coreGlow * idlePulse * (1.0 - vThrottle * 0.3);
    float finalAlpha = max(streamAlpha, glowAlpha);

    color *= (1.0 + (vThrottle + vBoost) * 1.5);

    gl_FragColor = vec4(color, finalAlpha);
}
`;

// Sprite'y three ignorują obrót rodzica i zawsze stoją równolegle do kamery.
// Przy ortho patrzącej prosto w -Z to jest kwad wyrównany do osi świata, więc
// odtwarzamy je zwykłym kwadratem bez obrotu.
function makeGlowVertexShader(z) {
  return `
attribute vec2 aPos;
attribute vec2 aSize;
attribute vec3 aColor;
attribute float aOpacity;

varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;

void main() {
    vUv = uv;
    vColor = aColor;
    vOpacity = aOpacity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aPos + position.xy * aSize, ${z.toFixed(1)}, 1.0);
}
`;
}

const GLOW_FRAGMENT_SHADER = `
uniform sampler2D uMap;

varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;

void main() {
    vec4 texel = texture2D(uMap, vUv);
    gl_FragColor = vec4(vColor, vOpacity) * texel;
}
`;

function makeInstancedQuad(attributeSpecs, material, renderOrder) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = 0;

  const arrays = {};
  for (const [name, itemSize] of attributeSpecs) {
    const array = new Float32Array(MAX_NOZZLES * itemSize);
    const attr = new THREE.InstancedBufferAttribute(array, itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attr);
    arrays[name] = array;
  }

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.visible = false;
  return { mesh, geo, arrays };
}

function makeGlowLayer(texture, color, z, renderOrder) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture } },
    vertexShader: makeGlowVertexShader(z),
    fragmentShader: GLOW_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const layer = makeInstancedQuad(
    [['aPos', 2], ['aSize', 2], ['aColor', 3], ['aOpacity', 1]],
    material,
    renderOrder
  );
  layer.defaultColor = new THREE.Color(color);
  return layer;
}

const _scratchColor = new THREE.Color();
const _glowColor = new THREE.Color();
const _warpBlue = new THREE.Color(0x0066ff);
const _heatCold = new THREE.Color(0x440000);
const _heatHot = new THREE.Color(0xff8800);

// Kelvin -> RGB, port 1:1 z Engineeffects.js.
function kelvinToRGB(target, k) {
  k = k / 100;
  let r, g, b;
  if (k <= 66) { r = 255; g = 99.47 * Math.log(k) - 161.12; }
  else { r = 329.7 * Math.pow(k - 60, -0.133); g = 288.1 * Math.pow(k - 60, -0.0755); }
  if (k >= 66) b = 255;
  else if (k <= 19) b = 0;
  else b = 138.5 * Math.log(k - 10) - 305.0;
  return target.setRGB(
    Math.max(0, Math.min(1, r / 255)),
    Math.max(0, Math.min(1, g / 255)),
    Math.max(0, Math.min(1, b / 255))
  );
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Stan jednej dyszy — wygładzanie ciągu, ciepła i flary żyje na CPU. */
export function createExhaustState(opts = {}) {
  return {
    throttleTarget: 0,
    currentThrottle: 0,
    warpTarget: 0,
    currentWarp: 0,
    heat: 0,
    flareOpacity: 0,
    lightIntensity: 2.0,
    lightDistance: 150,
    bloomGain: Number.isFinite(Number(opts.bloomGain)) ? Number(opts.bloomGain) : 1.0,
    colorTempK: Number.isFinite(Number(opts.colorTempK)) ? Number(opts.colorTempK) : 8000,
    curve: Number.isFinite(Number(opts.curve)) ? Number(opts.curve) : 1.8,
    // Własny zegar dyszy — bez tego cała flota pulsowałaby w jednym rytmie.
    time: Math.random() * 100
  };
}

let flame = null;
let flare = null;
let glow = null;
let ring = null;
let lightPool = null;
let count = 0;
const lightCandidates = [];
// Początek układu instancji tej klatki (sceneOrigin.js): aPos jest względem
// niego, a mesh.position warstw niesie duży kawałek (modelViewMatrix w double).
const origin = { x: 0, y: 0 };

function ensureBuilt() {
  if (flame) return true;
  if (!Core3D.isInitialized || !Core3D.scene) return false;

  const flameMaterial = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: FLAME_VERTEX_SHADER,
    fragmentShader: FLAME_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  flame = makeInstancedQuad([
    ['aPos', 2], ['aRot', 1], ['aScale', 2], ['aFlame', 2], ['aTime', 1],
    ['aThrottle', 1], ['aBoost', 1], ['aCurve', 1],
    ['aColorCore', 3], ['aColorEdge', 3]
  ], flameMaterial, 0);

  glow = makeGlowLayer(makeGlowTexture(), 0xff4400, Z_GLOW, 1);
  ring = makeGlowLayer(makeRingTexture(), 0xffaa00, Z_RING, 2);
  flare = makeGlowLayer(makeFlareTexture(), 0x88ccff, Z_FLARE, 3);

  for (const layer of [flame, glow, ring, flare]) Core3D.scene.add(layer.mesh);
  return true;
}

function areEnginePointLightsEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.ENGINE_POINT_LIGHTS_ENABLED === true) return true;
  return Core3D?.perfToggles?.enginePointLights === true;
}

function ensureLightPool() {
  if (lightPool) return lightPool;
  if (!Core3D.scene) return null;
  lightPool = [];
  for (let i = 0; i < MAX_ENGINE_LIGHTS; i++) {
    const light = new THREE.PointLight(0x4aaeff, 0, 150);
    light.name = 'EnginePointLight';
    light.userData.enginePointLight = true;
    light.visible = false;
    Core3D.scene.add(light);
    lightPool.push(light);
  }
  return lightPool;
}

function pushGlowInstance(layer, index, x, y, sizeX, sizeY, color, opacity) {
  const i2 = index * 2;
  const i3 = index * 3;
  layer.arrays.aPos[i2] = x;
  layer.arrays.aPos[i2 + 1] = y;
  layer.arrays.aSize[i2] = sizeX;
  layer.arrays.aSize[i2 + 1] = sizeY;
  layer.arrays.aColor[i3] = color.r;
  layer.arrays.aColor[i3 + 1] = color.g;
  layer.arrays.aColor[i3 + 2] = color.b;
  layer.arrays.aOpacity[index] = opacity;
}

function commitLayer(layer, instanceCount) {
  const visible = instanceCount > 0;
  if (layer.mesh.visible !== visible) layer.mesh.visible = visible;
  layer.mesh.position.set(origin.x, origin.y, 0);
  if (layer.geo.instanceCount !== instanceCount) layer.geo.instanceCount = instanceCount;
  if (!visible) return;
  // Zapisane jest tylko [0, instanceCount) — bez zakresu three wgrywalby caly
  // bufor na MAX_NOZZLES (dla samego plomienia ~280 kB na klatke).
  for (const name of Object.keys(layer.arrays)) {
    const attr = layer.geo.getAttribute(name);
    if (!attr) continue;
    if (attr.updateRanges && attr.updateRanges.length >= 8) attr.clearUpdateRanges();
    else if (attr.addUpdateRange) attr.addUpdateRange(0, instanceCount * (attr.itemSize || 1));
    attr.needsUpdate = true;
  }
}

export const EngineExhaustBatch = {
  MAX_NOZZLES,

  begin() {
    count = 0;
    lightCandidates.length = 0;
    // Wołane z updateHexShips3D po Core3D.syncCamera — kamera tej klatki.
    sceneOriginNearCamera(origin);
  },

  /**
   * Jedna dysza tej klatki.
   *
   * @param {object} state  stan z createExhaustState (mutowany — wygładzanie)
   * @param {object} p
   *   x, y            pozycja dyszy w przestrzeni sceny
   *   rot             obrót dyszy w przestrzeni sceny [rad]
   *   scaleX, scaleY  skala grupy dyszy (szerokość / długość)
   *   dt              krok czasu [s]
   */
  push(state, p) {
    if (!ensureBuilt()) return;
    if (count >= MAX_NOZZLES) return;

    const dt = Math.max(0, Math.min(0.1, Number(p.dt) || 0));
    state.time += dt;
    state.currentThrottle = lerp(state.currentThrottle, state.throttleTarget, 0.1);
    state.currentWarp = lerp(state.currentWarp, state.warpTarget, 0.05);

    const throttle = state.currentThrottle;
    const warp = state.currentWarp;

    const totalLen = 40 + 100 * throttle + 110 * warp;
    const pulse = 1.0 + 0.05 * Math.sin(state.time * 20.0);
    const throttleWidthFactor = 0.4 + 0.6 * throttle;
    const totalWidth = 96 * throttleWidthFactor * (1.0 + warp * 0.3) * pulse;

    const finalCol = kelvinToRGB(_scratchColor, state.colorTempK + throttle * 4000).lerp(_warpBlue, warp);
    const edgeMul = state.bloomGain * ENGINE_HDR;

    // Pozycja względem początku przy kamerze — małe liczby dla float32.
    const px = p.x - origin.x;
    const py = p.y - origin.y;

    const i = count++;
    const i2 = i * 2;
    const i3 = i * 3;
    const a = flame.arrays;
    a.aPos[i2] = px;
    a.aPos[i2 + 1] = py;
    a.aRot[i] = p.rot;
    a.aScale[i2] = p.scaleX;
    a.aScale[i2 + 1] = p.scaleY;
    a.aFlame[i2] = totalWidth;
    a.aFlame[i2 + 1] = totalLen;
    a.aTime[i] = state.time;
    a.aThrottle[i] = throttle;
    a.aBoost[i] = warp;
    a.aCurve[i] = state.curve;
    a.aColorCore[i3] = ENGINE_HDR;
    a.aColorCore[i3 + 1] = ENGINE_HDR;
    a.aColorCore[i3 + 2] = ENGINE_HDR;
    a.aColorEdge[i3] = finalCol.r * edgeMul;
    a.aColorEdge[i3 + 1] = finalCol.g * edgeMul;
    a.aColorEdge[i3 + 2] = finalCol.b * edgeMul;

    // Warstwy poświaty: heat glow siedział na (0, 2) w układzie dyszy, więc jego
    // offset przechodzi przez obrót grupy — sam kwad zostaje wyrównany do osi.
    const cR = Math.cos(p.rot);
    const sR = Math.sin(p.rot);
    const glowOffY = 2 * p.scaleY;
    const glowX = px - glowOffY * sR;
    const glowY = py + glowOffY * cR;

    state.flareOpacity = lerp(state.flareOpacity, (throttle * 0.5 + warp * 1.5) * state.bloomGain, 0.1);
    if (state.flareOpacity > 0.003) {
      _glowColor.copy(finalCol).multiplyScalar(ENGINE_HDR);
      pushGlowInstance(flare, i,
        px, py,
        (100 + warp * 150) * throttleWidthFactor * p.scaleX,
        (6 + warp * 4) * p.scaleY,
        _glowColor, state.flareOpacity);
    } else {
      pushGlowInstance(flare, i, 0, 0, 0, 0, flare.defaultColor, 0);
    }

    state.heat = (throttle > 0.1 || warp > 0.1)
      ? Math.min(1.0, state.heat + dt * 0.8)
      : Math.max(0.0, state.heat - dt * 0.3);

    if (state.heat > 0.003) {
      _glowColor.copy(_heatCold).lerp(_heatHot, state.heat).lerp(_warpBlue, warp * 0.8);
      pushGlowInstance(glow, i,
        glowX, glowY,
        70 * (1.0 + warp * 0.4) * throttleWidthFactor * p.scaleX,
        70 * p.scaleY,
        _glowColor, state.heat);
      pushGlowInstance(ring, i,
        px, py,
        50 * (1.0 + warp * 0.3) * throttleWidthFactor * p.scaleX,
        30 * p.scaleY,
        ring.defaultColor, state.heat);
    } else {
      pushGlowInstance(glow, i, 0, 0, 0, 0, glow.defaultColor, 0);
      pushGlowInstance(ring, i, 0, 0, 0, 0, ring.defaultColor, 0);
    }

    if (areEnginePointLightsEnabled()) {
      lightCandidates.push({
        state,
        x: p.x,
        y: p.y,
        weight: (throttle + warp) * p.scaleY,
        r: finalCol.r, g: finalCol.g, b: finalCol.b
      });
    }
  },

  flush() {
    if (!flame) return;
    commitLayer(flame, count);
    commitLayer(flare, count);
    commitLayer(glow, count);
    commitLayer(ring, count);

    const pool = areEnginePointLightsEnabled() ? ensureLightPool() : lightPool;
    if (!pool) return;
    if (lightCandidates.length > MAX_ENGINE_LIGHTS) {
      lightCandidates.sort((a, b) => b.weight - a.weight);
      lightCandidates.length = MAX_ENGINE_LIGHTS;
    }
    for (let i = 0; i < pool.length; i++) {
      const light = pool[i];
      const cand = lightCandidates[i];
      if (!cand) {
        // Intensywnosc tez na zero: _applyPassToggles w Core3D odslania wszystkie
        // swiatla z userData.enginePointLight przy wlaczeniu przelacznika, wiec
        // nieuzywany slot nie moze niesc jasnosci z poprzedniej klatki.
        if (light.visible) light.visible = false;
        if (light.intensity !== 0) light.intensity = 0;
        continue;
      }
      const s = cand.state;
      s.lightIntensity = lerp(s.lightIntensity, 2.0 + s.currentThrottle * 6.0 + s.currentWarp * 18.0, 0.2);
      s.lightDistance = lerp(s.lightDistance, 150 + s.currentThrottle * 150 + s.currentWarp * 650, 0.1);
      light.visible = true;
      light.position.set(cand.x, cand.y, 20);
      light.color.setRGB(cand.r, cand.g, cand.b);
      light.intensity = s.lightIntensity;
      light.distance = s.lightDistance;
    }
  },

  getStats() {
    return { nozzles: count, draws: count > 0 ? 4 : 0, lights: Math.min(lightCandidates.length, MAX_ENGINE_LIGHTS) };
  },

  dispose() {
    for (const layer of [flame, glow, ring, flare]) {
      if (!layer) continue;
      if (layer.mesh.parent) layer.mesh.parent.remove(layer.mesh);
      layer.geo.dispose();
      layer.mesh.material.dispose();
    }
    if (lightPool) {
      for (const light of lightPool) if (light.parent) light.parent.remove(light);
    }
    flame = glow = ring = flare = null;
    lightPool = null;
    count = 0;
    lightCandidates.length = 0;
  }
};
