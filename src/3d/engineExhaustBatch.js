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
//
// Port WebGPU (zadanie 13): płomień i trzy warstwy poświaty to materiały węzłowe
// TSL 1:1 z dawnym GLSL. AdditiveBlending bez premultipliedAlpha ma na WebGPU te
// same czynniki co WebGL r183 (SRC_ALPHA, ONE | ONE, ONE) — mieszanie bez zmian.

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, abs, attribute, clamp, cos, dot, float, floor, fract, length, max, mix, positionGeometry, pow,
  sin, smoothstep, texture, uv, vec2, vec3, vec4
} from 'three/tsl';
import { Core3D } from './core3d.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { uniformsAdapter } from './tsl/uniformy.js';
import { makeFlareTexture, makeGlowTexture, makeRingTexture } from '../../Engineeffects.js';
// Losowość warstwy efektów (zadanie 23): wizualia nie zużywają Math.random gry — przebieg rozgrywki nie zależy od obrazu.
import { fxRandom } from './fx/fxRandom.js';

const MAX_NOZZLES = 4096;

// Point lighty dysz były najdroższą wersją tego pomysłu: jedno światło na dyszę,
// 365 w bitwie. Zostaje pula o stałym rozmiarze przypisywana najmocniejszym
// dyszom — reszta ma tylko poświatę sprite'ową i nikt tego nie zauważy.
const MAX_ENGINE_LIGHTS = 24;

// HDR rdzenia dyszy bocznej. Płomień mnoży barwę jeszcze przez (1 + 1,5 · ciąg),
// a w spoczynku zostaje biały „pilot” (glowAlpha) o jasności równej ENGINE_HDR.
// Przy 2,4 (dawniej) KAŻDA dysza — Atlas ma ich 8 — świeciła w spoczynku bielą
// HDR 2,4 z poświatą bloomu Core3D (~7,5× energii ponad progiem 0,9), w samym
// locie (moveGlow) ~3,3, a przy manewrze do HDR 6 (w „diamentach” ~11) — biała
// plama zalewała burtę. Przy 0,6 pilot (0,6) i lot (≤ 0,84) są pod progiem,
// a w bloomie świeci tylko dysza, która faktycznie odpala: pełny manewr 1,5
// (diamenty ~2,9). Audyt: docs/AUDYT-bloom-kolizje-2026-09-26.md.
const ENGINE_HDR = 0.6;

// Głębokości z oryginalnej hierarchii: grupa dyszy siedziała na z=-5, a w niej
// płomień 0, heat glow 0.1, ring 0.2, flara 1.5.
const Z_FLAME = -5.0;
const Z_GLOW = -4.9;
const Z_RING = -4.8;
const Z_FLARE = -3.5;

/* ============================================================================
   PŁOMIEŃ (TSL) — kwad na instancję dyszy
   ========================================================================== */
// Szum płomienia: random() na węzłach siatki (floor) — wejście całkowite.
// Funkcje z layoutem są CZYSTE (PLAN §3).
const flameRandom = /*@__PURE__*/ Fn(([st]) =>
  fract(sin(dot(st, vec2(12.9898, 78.233))).mul(43758.5453123))
).setLayout({ name: 'engineFlameRandom', type: 'float', inputs: [{ name: 'st', type: 'vec2' }] });

const flameNoise = /*@__PURE__*/ Fn(([st]) => {
  const i = floor(st).toVar();
  const f = fract(st).toVar();
  const a = flameRandom(i).toVar();
  const b = flameRandom(i.add(vec2(1.0, 0.0))).toVar();
  const c = flameRandom(i.add(vec2(0.0, 1.0)));
  const d = flameRandom(i.add(vec2(1.0, 1.0)));
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  return mix(a, b, u.x).add(c.sub(a).mul(u.y).mul(float(1.0).sub(u.x))).add(d.sub(b).mul(u.x).mul(u.y));
}).setLayout({ name: 'engineFlameNoise', type: 'float', inputs: [{ name: 'st', type: 'vec2' }] });

function makeFlameMaterial() {
  const aPos = attribute('aPos', 'vec2');
  const aRot = attribute('aRot', 'float');
  const aScale = attribute('aScale', 'vec2');
  const aFlame = attribute('aFlame', 'vec2');
  const vTime = attribute('aTime', 'float');
  const vThrottle = attribute('aThrottle', 'float');
  const vBoost = attribute('aBoost', 'float');
  const vCurve = attribute('aCurve', 'float');
  const vColorCore = attribute('aColorCore', 'vec3');
  const vColorEdge = attribute('aColorEdge', 'vec3');

  const m = new NodeMaterial();
  m.name = 'EngineFlame';
  // Odwzorowanie starego łańcucha: mesh miał scale (totalWidth, totalLen)
  // i position.y = -totalLen/2 WEWNĄTRZ grupy dyszy, a grupa własny obrót,
  // skalę i pozycję w świecie.
  m.positionNode = Fn(() => {
    const local = vec2(positionGeometry.x.mul(aFlame.x), positionGeometry.y.mul(aFlame.y).sub(aFlame.y.mul(0.5))).mul(aScale).toVar();
    const c = cos(aRot).toVar();
    const s = sin(aRot).toVar();
    const rotated = vec2(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)));
    return vec3(aPos.add(rotated), Z_FLAME);
  })();
  // Atrybuty instancji czytane we fragmencie idą varyingami (jak vTime, vThrottle…).
  m.fragmentNode = Fn(() => {
    // MSAA liczy piksel krawędzi w jego środku, także POZA kwadem — uv wychodzi
    // lekko poza [0, 1], a pow(y, ...) z ujemnym y daje w HLSL NaN, który
    // bloom rozlewa na cały ekran.
    const st = clamp(uv(), 0.0, 1.0).toVar();
    const x = st.x.sub(0.5).mul(2.0).toVar();
    const y = float(1.0).sub(st.y).toVar();

    const visibleLength = float(0.2).add(float(0.78).mul(vThrottle.add(vBoost))).toVar();
    const lengthMask = float(1.0).sub(smoothstep(visibleLength.mul(0.7), visibleLength, y));

    const curvePow = max(0.2, vCurve);
    const width = float(1.0).sub(pow(y, curvePow)).mul(0.95).toVar();
    width.mulAssign(float(1.0).add(vBoost.mul(0.4)));

    const shape = float(1.0).sub(smoothstep(width.mul(0.4), width, abs(x))).toVar();
    shape.mulAssign(smoothstep(0.0, 0.1, y));
    shape.mulAssign(float(1.0).sub(smoothstep(0.4, 0.95, y)));

    const turbulenceMix = smoothstep(0.0, 0.3, vThrottle.add(vBoost));
    const flowSpeed = vTime.mul(8.0).mul(float(1.0).add(vThrottle.mul(2.5)));
    const n = flameNoise(vec2(x.mul(2.5), y.mul(6.0).sub(flowSpeed)));
    const finalShape = mix(shape, shape.mul(float(0.7).add(float(0.4).mul(n))), turbulenceMix);

    const diamonds = sin(y.mul(22.0).sub(vTime.mul(4.0))).mul(sin(y.mul(14.0).add(vTime.mul(9.0))));
    const diamondPattern = smoothstep(0.3, 0.9, diamonds).toVar();
    diamondPattern.mulAssign(float(1.0).sub(abs(x).mul(1.5)));
    const diamondStr = smoothstep(0.2, 1.0, vThrottle).mul(float(1.0).sub(vBoost));

    const coreGlowDist = length(vec2(x.mul(0.7), y.mul(4.0)));
    const coreGlow = pow(float(1.0).sub(smoothstep(0.0, 0.6, coreGlowDist)), 2.0);
    const idlePulse = float(0.9).add(float(0.1).mul(sin(vTime.mul(4.0))));

    const coreIntensity = pow(clamp(float(1.0).sub(abs(x).div(width.mul(1.2))), 0.0, 1.0), 3.0);
    const color = mix(vColorEdge, vColorCore, coreIntensity).toVar();
    color.addAssign(vColorCore.mul(diamondPattern).mul(diamondStr).mul(0.9));

    const streamAlpha = finalShape.mul(lengthMask).mul(float(0.5).add(float(0.5).mul(vThrottle)));
    const glowAlpha = coreGlow.mul(idlePulse).mul(float(1.0).sub(vThrottle.mul(0.3)));
    const finalAlpha = max(streamAlpha, glowAlpha);

    color.mulAssign(float(1.0).add(vThrottle.add(vBoost).mul(1.5)));

    return vec4(color, finalAlpha);
  })();
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  // Jak ShaderMaterial w WebGL: jeden draw, nie dwa (tył + przód).
  m.forceSinglePass = true;
  m.fog = false;
  m.lights = false;
  return m;
}

// Sprite'y three ignorują obrót rodzica i zawsze stoją równolegle do kamery.
// Przy ortho patrzącej prosto w -Z to jest kwad wyrównany do osi świata, więc
// odtwarzamy je zwykłym kwadratem bez obrotu.
function makeGlowMaterial(tex, z, name) {
  const aPos = attribute('aPos', 'vec2');
  const aSize = attribute('aSize', 'vec2');
  const vColor = attribute('aColor', 'vec3');
  const vOpacity = attribute('aOpacity', 'float');
  const U = uniformsAdapter({ uMap: texture(tex) });
  const m = new NodeMaterial();
  m.name = name;
  m.positionNode = vec3(aPos.add(positionGeometry.xy.mul(aSize)), z);
  m.fragmentNode = vec4(vColor, vOpacity).mul(U.uMap.sample(uv()));
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  m.depthWrite = false;
  m.fog = false;
  m.lights = false;
  m.uniforms = U;
  return m;
}

// Układ danych instancji: przesunięcia pól w jednym rekordzie (floaty).
function instanceLayout(specs) {
  const out = { specs, stride: 0 };
  for (const [name, itemSize] of specs) {
    out[name] = out.stride;
    out.stride += itemSize;
  }
  return out;
}

const FLAME_LAYOUT = instanceLayout([
  ['aPos', 2], ['aRot', 1], ['aScale', 2], ['aFlame', 2], ['aTime', 1],
  ['aThrottle', 1], ['aBoost', 1], ['aCurve', 1],
  ['aColorCore', 3], ['aColorEdge', 3]
]);
const GLOW_LAYOUT = instanceLayout([['aPos', 2], ['aSize', 2], ['aColor', 3], ['aOpacity', 1]]);

// Dane instancji warstwy w JEDNYM buforze z przeplotem (rekord = layout.stride
// floatów). WebGPU pozwala na 8 buforów wierzchołków na pipeline — płomień z
// osobnym buforem na atrybut miał ich 12 (10 atrybutów instancji + position + uv)
// i pipeline się nie tworzył. Przy okazji jedno wgranie na warstwę zamiast
// jednego na atrybut. Shader czyta te same atrybuty (nazwy bez zmian).
function makeInstancedQuad(layout, material, renderOrder) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = 0;

  const data = new Float32Array(MAX_NOZZLES * layout.stride);
  const buffer = new THREE.InstancedInterleavedBuffer(data, layout.stride);
  buffer.setUsage(THREE.DynamicDrawUsage);
  for (const [name, itemSize] of layout.specs) {
    geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, itemSize, layout[name]));
  }

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.visible = false;
  return { mesh, geo, data, buffer, stride: layout.stride };
}

function makeGlowLayer(tex, color, z, renderOrder, name) {
  const material = makeGlowMaterial(tex, z, name);
  const layer = makeInstancedQuad(GLOW_LAYOUT, material, renderOrder);
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
    time: fxRandom.next() * 100
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

  flame = makeInstancedQuad(FLAME_LAYOUT, makeFlameMaterial(), 0);

  glow = makeGlowLayer(makeGlowTexture(), 0xff4400, Z_GLOW, 1, 'EngineHeatGlow');
  ring = makeGlowLayer(makeRingTexture(), 0xffaa00, Z_RING, 2, 'EngineHeatRing');
  flare = makeGlowLayer(makeFlareTexture(), 0x88ccff, Z_FLARE, 3, 'EngineFlare');

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
  const d = layer.data;
  const b = index * GLOW_LAYOUT.stride;
  d[b + GLOW_LAYOUT.aPos] = x;
  d[b + GLOW_LAYOUT.aPos + 1] = y;
  d[b + GLOW_LAYOUT.aSize] = sizeX;
  d[b + GLOW_LAYOUT.aSize + 1] = sizeY;
  d[b + GLOW_LAYOUT.aColor] = color.r;
  d[b + GLOW_LAYOUT.aColor + 1] = color.g;
  d[b + GLOW_LAYOUT.aColor + 2] = color.b;
  d[b + GLOW_LAYOUT.aOpacity] = opacity;
}

function commitLayer(layer, instanceCount) {
  const visible = instanceCount > 0;
  if (layer.mesh.visible !== visible) layer.mesh.visible = visible;
  layer.mesh.position.set(origin.x, origin.y, 0);
  if (layer.geo.instanceCount !== instanceCount) layer.geo.instanceCount = instanceCount;
  if (!visible) return;
  // Zapisane jest tylko [0, instanceCount) — bez zakresu three wgrywalby caly
  // bufor na MAX_NOZZLES (dla samego plomienia ~280 kB na klatke).
  const buffer = layer.buffer;
  buffer.clearUpdateRanges();
  buffer.addUpdateRange(0, instanceCount * layer.stride);
  buffer.needsUpdate = true;
}

// Dla testów: materiały i układ danych instancji (bez Core3D i kanwy 2D).
export const EngineExhaustInternals = Object.freeze({ makeFlameMaterial, makeGlowMaterial, makeInstancedQuad, FLAME_LAYOUT, GLOW_LAYOUT });

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
    // gain — jasność całej dyszy (maskowanie: widoczność komórki kadłuba pod dyszą); 1 = bez zmian.
    const gain = p.gain === undefined ? 1 : Math.max(0, Math.min(1, Number(p.gain) || 0));
    const edgeMul = state.bloomGain * ENGINE_HDR * gain;

    // Pozycja względem początku przy kamerze — małe liczby dla float32.
    const px = p.x - origin.x;
    const py = p.y - origin.y;

    const i = count++;
    const d = flame.data;
    const L = FLAME_LAYOUT;
    const b = i * L.stride;
    d[b + L.aPos] = px;
    d[b + L.aPos + 1] = py;
    d[b + L.aRot] = p.rot;
    d[b + L.aScale] = p.scaleX;
    d[b + L.aScale + 1] = p.scaleY;
    d[b + L.aFlame] = totalWidth;
    d[b + L.aFlame + 1] = totalLen;
    d[b + L.aTime] = state.time;
    d[b + L.aThrottle] = throttle;
    d[b + L.aBoost] = warp;
    d[b + L.aCurve] = state.curve;
    d[b + L.aColorCore] = ENGINE_HDR * gain;
    d[b + L.aColorCore + 1] = ENGINE_HDR * gain;
    d[b + L.aColorCore + 2] = ENGINE_HDR * gain;
    d[b + L.aColorEdge] = finalCol.r * edgeMul;
    d[b + L.aColorEdge + 1] = finalCol.g * edgeMul;
    d[b + L.aColorEdge + 2] = finalCol.b * edgeMul;

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
        _glowColor, state.flareOpacity * gain);
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
        _glowColor, state.heat * gain);
      pushGlowInstance(ring, i,
        px, py,
        50 * (1.0 + warp * 0.3) * throttleWidthFactor * p.scaleX,
        30 * p.scaleY,
        ring.defaultColor, state.heat * gain);
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

  // Rozgrzewka (zadanie 11, Core3D.warmup): cztery warstwy puli (płomień i trzy poświaty) — pipeline'y
  // przed pierwszą klatką gry (dawniej 4 budowy w niej). Tworzy pulę, jak pierwsza dysza.
  warmupMeshes() {
    return ensureBuilt() ? [flame.mesh, glow.mesh, ring.mesh, flare.mesh] : null;
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

// Pipeline'y puli na ekranie ładowania (phase 'loading' — pula powstaje wtedy, jak przy pierwszej dyszy gry).
Core3D.warmup?.add({ name: 'dysze SIDE', objects: () => EngineExhaustBatch.warmupMeshes(), phase: 'loading' });
