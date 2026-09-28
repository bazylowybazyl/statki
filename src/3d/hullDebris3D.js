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
//  - materiał w TSL (port WebGPU, zadanie 04): jeden graf, jeden materiał na obie pule;
//    maska słońca przez to samo miejsce importu co kadłuby (hexShips3D.tsl.js).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard, float, vec2, vec3, vec4, attribute, varying,
  positionGeometry, normalGeometry, modelViewMatrix, cameraProjectionMatrix, frontFacing, screenCoordinate,
  cos, sin, cross, dot, exp, floor, fract, max, min, mix, normalize, pow, select, smoothstep
} from 'three/tsl';
import { Core3D } from './core3d.js';
import { createMetalDebrisGeometry } from './beamDebris3D.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { makeUniforms } from './tsl/uniformy.js';
import { sunFill, sunVisibility } from './hexShips3D.tsl.js';
// Losowość warstwy efektów (zadanie 23): wizualia nie zużywają Math.random gry — przebieg rozgrywki nie zależy od obrazu.
import { fxRandom } from './fx/fxRandom.js';

export const HULL_DEBRIS_CAPACITY = 8192;
export const HULL_DEBRIS_LIFE = 8;
// Kamera dalej od początku puli niż tyle — dane żywych odłamków przesuwamy do nowego.
const REBASE_DIST = 60000;

// Materiał odłamków (dawny VERTEX/FRAGMENT GLSL): koziołkujące płyty i kształtowniki,
// pozycje względem początku puli (mesh.position — modelViewMatrix z kontekstu,
// highPrecision), koniec życia ditheringiem (instancji nie da się sortować per fragment).
function createHullDebrisMaterial() {
  const uniforms = makeUniforms({
    uTime: 0,
    uLightDir: new THREE.Vector3(0, 0, 1),
    // Jaśniej niż kadłub: płyta z góry ma NdotL ≈ 0 (słońce w płaszczyźnie gry),
    // a ciemny okruch na ciemnym kadłubie ginął.
    uAmbient: 0.5,
    uDiffuse: 1.25
  });
  const aFace = attribute('aFace', 'float');
  const aStart = attribute('aStart', 'vec3');
  const aVel = attribute('aVel', 'vec3');
  const aRot = attribute('aRot', 'vec4');
  const aInfo = attribute('aInfo', 'vec3');
  const aColor = attribute('aColor', 'vec3');
  const aShape = attribute('aShape', 'vec4');

  const age = uniforms.uTime.sub(aInfo.x);
  const life = aInfo.z;
  const angle = aShape.w.add(aRot.w.mul(age));
  const axis = normalize(aRot.xyz.add(vec3(1e-6, 0.0, 0.0)));
  const c = cos(angle);
  const s = sin(angle);
  const rodrigues = (v) => v.mul(c).add(cross(axis, v).mul(s)).add(axis.mul(dot(axis, v)).mul(float(1.0).sub(c)));

  const vertexNode = Fn(() => {
    const center = aStart.add(aVel.mul(float(1.0).sub(exp(age.mul(-0.6))).div(0.6)));
    const p = positionGeometry.mul(aShape.xyz).mul(aInfo.y);
    const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(center.add(rodrigues(p)), 1.0)));
    // Poza życiem — poza obcięciem (vec4(2, 2, 2, 1) z GLSL).
    return select(age.lessThan(0.0).or(age.greaterThanEqual(life)), vec4(2.0, 2.0, 2.0, 1.0), clip);
  })();

  // Normalna w układzie sceny (mesh bez obrotu) — światło słońca liczone w nim.
  const vNormal = varying(rodrigues(normalize(normalGeometry.div(aShape.xyz))), 'vDebrisNormal');
  const vAlpha = varying(float(1.0).sub(smoothstep(life.mul(0.8), life, age)), 'vDebrisAlpha');
  const vLocal = varying(positionGeometry, 'vDebrisLocal');
  const vFace = varying(aFace, 'vDebrisFace');
  const vColor = varying(aColor, 'vDebrisColor');

  const fragmentNode = Fn(() => {
    // Szum ditheringu z piksela ekranu (w WebGPU oś y w dół — wzór inny niż w WebGL, to tylko dither).
    const noise = fract(sin(dot(floor(screenCoordinate.xy), vec2(12.9898, 78.233))).mul(43758.5453));
    If(vAlpha.lessThanEqual(0.0).or(noise.greaterThan(vAlpha)), () => {
      Discard();
    });
    const n = normalize(select(frontFacing, vNormal, vNormal.negate())).toVar();
    const bare = smoothstep(0.7, 0.95, vFace).toVar();
    const paint = vColor.mul(mix(1.0, 0.62, min(1.0, vFace.mul(1.8))));
    const color = mix(paint, vec3(0.19, 0.22, 0.25), bare).toVar();
    const scratch = pow(sin(vLocal.x.mul(119.0).add(vLocal.z.mul(19.0))).mul(0.5).add(0.5), 12.0);
    color.mulAssign(float(1.0).sub(scratch.mul(0.12)));
    const L = uniforms.uLightDir;
    const sunVis = sunVisibility().toVar();
    const diffuse = max(0.0, dot(n, L)).mul(sunVis);
    const specular = pow(max(0.0, dot(n, normalize(L.add(vec3(0.0, 0.0, 1.0))))), 28.0).mul(sunVis);
    return vec4(color.mul(uniforms.uAmbient.mul(sunFill(sunVis)).add(diffuse.mul(uniforms.uDiffuse)))
      .add(specular.mul(mix(0.12, 0.45, bare))), 1.0);
  })();

  const material = new THREE.NodeMaterial();
  material.name = 'hull:plateDebris';
  material.uniforms = uniforms;
  material.lights = false;
  material.fog = false;
  material.side = THREE.DoubleSide;
  material.vertexNode = vertexNode;
  material.fragmentNode = fragmentNode;
  return material;
}

const ATTRIBUTES = { aStart: 3, aVel: 3, aRot: 4, aInfo: 3, aColor: 3, aShape: 4 };

// WebGPU: najwyżej 8 buforów wierzchołków na pipeline (maxVertexBuffers = 8 także
// w adapterze), a każdy nieprzeplatany atrybut to osobny bufor. Pozycja, normalna
// i aFace (stałe, per wierzchołek) idą jednym przeplatanym buforem: 1 + 6 atrybutów
// instancji = 7. Z dziewięcioma pipeline nie powstawał (three r183 połyka ten błąd
// createRenderPipelineAsync), a odłamki po cichu znikały.
function interleaveStaticAttributes(geometry) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const face = geometry.getAttribute('aFace');
  const n = pos.count;
  const data = new Float32Array(n * 7);
  for (let i = 0; i < n; i++) {
    const o = i * 7;
    data[o] = pos.getX(i); data[o + 1] = pos.getY(i); data[o + 2] = pos.getZ(i);
    data[o + 3] = nor.getX(i); data[o + 4] = nor.getY(i); data[o + 5] = nor.getZ(i);
    data[o + 6] = face.getX(i);
  }
  const buffer = new THREE.InterleavedBuffer(data, 7);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
  geometry.setAttribute('aFace', new THREE.InterleavedBufferAttribute(buffer, 1, 6));
  return geometry;
}

function createBatch(kind, capacity, material) {
  const geometry = interleaveStaticAttributes(createMetalDebrisGeometry(kind));
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
    this.material = createHullDebrisMaterial();
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
    a.aRot[i4] = fxRandom.next() * 2 - 1; a.aRot[i4 + 1] = fxRandom.next() * 2 - 1; a.aRot[i4 + 2] = fxRandom.next() * 2 - 1;
    a.aRot[i4 + 3] = (fxRandom.next() - 0.5) * 7;
    a.aInfo[i3] = nowSec; a.aInfo[i3 + 1] = scale; a.aInfo[i3 + 2] = HULL_DEBRIS_LIFE;
    a.aColor[i3] = toLinear(r); a.aColor[i3 + 1] = toLinear(g); a.aColor[i3 + 2] = toLinear(b);
    a.aShape[i4] = 0.65 + fxRandom.next() * 0.8;
    a.aShape[i4 + 1] = 0.5 + fxRandom.next() * 0.9;
    a.aShape[i4 + 2] = 0.55 + fxRandom.next() * 0.8;
    a.aShape[i4 + 3] = fxRandom.next() * Math.PI * 2;
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
