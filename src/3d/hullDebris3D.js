// Odłamki kadłubów na belkach (hullBodies.js) — pogięte płyty poszycia i kształtowniki
// z dema belek (beamDebris3D.js), koziołkujące w locie, w kolorze blachy z komórki.
//
// Różnice względem puli dema:
//  - światło: słońce gry (kierunek od słońca do kamery, jak kadłuby) + maska cienia
//    (sunShadowMask.js): w umbrze planety płyta gaśnie jak kadłub,
//  - precyzja float32: pozycje startowe WZGLĘDEM początku puli (mesh.position, three składa
//    modelViewMatrix w double). Początek „lepki”: pusta pula bierze go od kamery przy
//    pierwszym odłamku, żywa trzyma, aż kamera odjedzie (jak sparkSystem3D),
//  - jedna pula na grę (bez puli i tekstury na typ kadłuba jak odłamki heksów),
//  - bez żaru — świecący okruch czytał się jak „odprysk” shadera, żar zostaje na kadłubie.
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { createMetalDebrisGeometry } from './beamDebris3D.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { SUN_SHADOW_GLSL, sunShadowUniforms } from './sunShadowMask.js';

export const HULL_DEBRIS_CAPACITY = 8192;
export const HULL_DEBRIS_LIFE = 8;
// Kamera dalej od początku puli niż tyle — dane żywych odłamków przesuwamy do nowego.
const REBASE_DIST = 60000;

const VERTEX = `
attribute float aFace;
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aRot;
attribute vec3 aInfo;
attribute vec3 aColor;
attribute vec4 aShape;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vFace;
void main() {
  float age = uTime - aInfo.x;
  float life = aInfo.z;
  vColor = aColor; vFace = aFace; vLocal = position;
  vNormal = vec3(0.0, 0.0, 1.0);
  vAlpha = 0.0;
  if (age < 0.0 || age >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 center = aStart + aVel * ((1.0 - exp(-0.6 * age)) / 0.6);
  float angle = aShape.w + aRot.w * age;
  vec3 axis = normalize(aRot.xyz + vec3(1e-6, 0.0, 0.0));
  float c = cos(angle), s = sin(angle);
  vec3 p = position * aShape.xyz * aInfo.y;
  vec3 n = normalize(normal / aShape.xyz);
  vec3 rotated = p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
  // Normalna w układzie sceny (mesh bez obrotu) — światło słońca liczone w nim.
  vNormal = n * c + cross(axis, n) * s + axis * dot(axis, n) * (1.0 - c);
  vAlpha = 1.0 - smoothstep(life * 0.8, life, age);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(center + rotated, 1.0);
}
`;

const FRAGMENT = `
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uDiffuse;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vFace;
${SUN_SHADOW_GLSL}
void main() {
  // Nieprzezroczyste z testem głębi, koniec życia wygaszany ditheringiem (instancji
  // przezroczystych nie da się sortować per fragment).
  float noise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (vAlpha <= 0.0 || noise > vAlpha) discard;
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  float bare = smoothstep(0.7, 0.95, vFace);
  vec3 paint = vColor * mix(1.0, 0.62, min(1.0, vFace * 1.8));
  vec3 color = mix(paint, vec3(0.19, 0.22, 0.25), bare);
  float scratch = pow(0.5 + 0.5 * sin(vLocal.x * 119.0 + vLocal.z * 19.0), 12.0);
  color *= 1.0 - scratch * 0.12;
  float sunVis = sunVisibility();
  float diffuse = max(0.0, dot(n, uLightDir)) * sunVis;
  float specular = pow(max(0.0, dot(n, normalize(uLightDir + vec3(0.0, 0.0, 1.0)))), 28.0) * sunVis;
  gl_FragColor = vec4(color * (uAmbient * sunFill(sunVis) + diffuse * uDiffuse) + specular * mix(0.12, 0.45, bare), 1.0);
}
`;

const ATTRIBUTES = { aStart: 3, aVel: 3, aRot: 4, aInfo: 3, aColor: 3, aShape: 4 };

function createBatch(kind, capacity, material) {
  const geometry = createMetalDebrisGeometry(kind);
  const arrays = {};
  for (const [name, width] of Object.entries(ATTRIBUTES)) {
    arrays[name] = new Float32Array(capacity * width);
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(arrays[name], width).setUsage(THREE.DynamicDrawUsage));
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Hull debris: ${kind}`;
  mesh.frustumCulled = false;
  mesh.visible = false;
  // Nad kadłubami (renderOrder 10) — odłamek wylatuje z rany nad blachę.
  mesh.renderOrder = 11;
  return { kind, capacity, geometry, mesh, arrays, cursor: 0, first: 0, alive: 0, dirtyMin: capacity, dirtyMax: -1, highWater: 0 };
}

// sRGB → liniowe (kolor komórki pochodzi z bajtów sprite'a, shader liczy światło liniowo).
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const _origin = { x: 0, y: 0 };

export const HullDebris3D = {
  material: null,
  batches: null,
  originX: 0,
  originY: 0,
  stats: { spawned: 0 },

  ensure() {
    if (this.batches) return true;
    if (!Core3D?.scene) return false;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightDir: { value: new THREE.Vector3(0, 0, 1) },
        // Jaśniej niż kadłub: płyta z góry ma NdotL ≈ 0 (słońce w płaszczyźnie gry),
        // a ciemny okruch na ciemnym kadłubie ginął.
        uAmbient: { value: 0.5 },
        uDiffuse: { value: 1.25 },
        ...sunShadowUniforms
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.DoubleSide
    });
    const plates = Math.max(1, Math.floor(HULL_DEBRIS_CAPACITY * 2 / 3));
    this.batches = [createBatch('plate', plates, this.material),
      createBatch('strut', Math.max(1, HULL_DEBRIS_CAPACITY - plates), this.material)];
    for (const b of this.batches) Core3D.scene.add(b.mesh);
    return true;
  },

  _alive() {
    return this.batches ? this.batches[0].alive + this.batches[1].alive : 0;
  },

  _setOrigin(x, y) {
    this.originX = x;
    this.originY = y;
    for (const b of this.batches) b.mesh.position.set(x, y, 0);
  },

  // Przesunięcie żywych danych do nowego początku (rzadkie — kamera odjechała daleko).
  _rebase(x, y) {
    const dx = this.originX - x, dy = this.originY - y;
    for (const b of this.batches) {
      const a = b.arrays.aStart;
      for (let i = 0; i < b.highWater; i++) { a[i * 3] += dx; a[i * 3 + 1] += dy; }
      if (b.highWater > 0) { b.dirtyMin = 0; b.dirtyMax = Math.max(b.dirtyMax, b.highWater - 1); }
    }
    this._setOrigin(x, y);
  },

  /**
   * Odłamek w świecie gry (y w dół), prędkość j./s. r, g, b — kolor blachy komórki (sRGB 0–1),
   * scale — rozmiar (bok komórki × ~0,5–0,95), structural = kształtownik zamiast płyty.
   */
  spawn(x, y, vx, vy, r, g, b, scale, structural, nowSec) {
    if (!this.ensure()) return;
    if (this._alive() === 0) {
      sceneOriginNearCamera(_origin);
      this._setOrigin(_origin.x, _origin.y);
    }
    const batch = this.batches[structural ? 1 : 0];
    const i = batch.cursor, i3 = i * 3, i4 = i * 4;
    const a = batch.arrays;
    a.aStart[i3] = x - this.originX; a.aStart[i3 + 1] = -y - this.originY; a.aStart[i3 + 2] = 0;
    // Lekki ruch poza płaszczyznę tylko w obrocie — tor zostaje w płaszczyźnie gry.
    a.aVel[i3] = vx; a.aVel[i3 + 1] = -vy; a.aVel[i3 + 2] = 0;
    a.aRot[i4] = Math.random() * 2 - 1; a.aRot[i4 + 1] = Math.random() * 2 - 1; a.aRot[i4 + 2] = Math.random() * 2 - 1;
    a.aRot[i4 + 3] = (Math.random() - 0.5) * 7;
    a.aInfo[i3] = nowSec; a.aInfo[i3 + 1] = scale; a.aInfo[i3 + 2] = HULL_DEBRIS_LIFE;
    a.aColor[i3] = toLinear(r); a.aColor[i3 + 1] = toLinear(g); a.aColor[i3 + 2] = toLinear(b);
    a.aShape[i4] = 0.65 + Math.random() * 0.8;
    a.aShape[i4 + 1] = 0.5 + Math.random() * 0.9;
    a.aShape[i4 + 2] = 0.55 + Math.random() * 0.8;
    a.aShape[i4 + 3] = Math.random() * Math.PI * 2;
    if (!batch.alive) batch.first = i;
    if (batch.alive === batch.capacity) batch.first = (batch.first + 1) % batch.capacity;
    else batch.alive++;
    batch.cursor = (i + 1) % batch.capacity;
    if (i + 1 > batch.highWater) batch.highWater = i + 1;
    batch.geometry.instanceCount = batch.highWater;
    if (i < batch.dirtyMin) batch.dirtyMin = i;
    if (i > batch.dirtyMax) batch.dirtyMax = i;
    this.stats.spawned++;
  },

  /** Raz na klatkę renderu (updateHexShips3D): wygasanie, światło, upload zakresu. */
  update(nowSec) {
    if (!this.batches) return;
    const u = this.material.uniforms;
    u.uTime.value = nowSec;
    if (this._alive() > 0) {
      sceneOriginNearCamera(_origin);
      if (Math.abs(_origin.x - this.originX) > REBASE_DIST || Math.abs(_origin.y - this.originY) > REBASE_DIST) {
        this._rebase(_origin.x, _origin.y);
      }
      // Słońce jak u kadłubów: kierunek z punktu (tu: środka kadru) do słońca, uniesiony o 600.
      const sun = typeof window !== 'undefined' ? window.SUN : null;
      const cam = typeof window !== 'undefined' ? window.camera : null;
      if (sun && cam) u.uLightDir.value.set(sun.x - cam.x, -(sun.y - cam.y), 600).normalize();
    }
    for (const batch of this.batches) {
      // Narodziny po kolei i ten sam czas życia: wygasają najstarsze.
      while (batch.alive && nowSec >= batch.arrays.aInfo[batch.first * 3] + HULL_DEBRIS_LIFE) {
        batch.first = (batch.first + 1) % batch.capacity;
        batch.alive--;
      }
      batch.mesh.visible = batch.alive > 0;
      if (!batch.alive) {
        batch.geometry.instanceCount = 0;
        batch.cursor = 0;
        batch.highWater = 0;
      }
      if (batch.dirtyMax < batch.dirtyMin) continue;
      for (const name in ATTRIBUTES) {
        const attr = batch.geometry.getAttribute(name), width = ATTRIBUTES[name];
        attr.clearUpdateRanges();
        attr.addUpdateRange(batch.dirtyMin * width, (batch.dirtyMax - batch.dirtyMin + 1) * width);
        attr.needsUpdate = true;
      }
      batch.dirtyMin = batch.capacity;
      batch.dirtyMax = -1;
    }
  },

  /** Rozgrzanie programu shadera (bez kompilacji przy pierwszym trafieniu). */
  prewarm() {
    if (!this.ensure()) return [];
    return this.batches.map((b) => b.mesh);
  },

  dispose() {
    if (!this.batches) return;
    for (const b of this.batches) { Core3D.scene?.remove(b.mesh); b.geometry.dispose(); }
    this.material.dispose();
    this.batches = null;
    this.material = null;
  }
};

if (typeof window !== 'undefined') {
  window.HullDebris3D = HullDebris3D;
  // Wołane z hullBodies (onNodeDebris) — gra, y w dół.
  window.spawnHullDebris = (x, y, vx, vy, r, g, b, scale, structural) =>
    HullDebris3D.spawn(x, y, vx, vy, r, g, b, scale, structural, performance.now() * 0.001);
}
