/**
 * AsteroidField3D — proceduralne pola asteroid renderowane przez InstancedMesh.
 *
 * Strategia wydajnościowa:
 *   - Jeden THREE.InstancedMesh per (typ × klasa rozmiaru × wariant wizualny).
 *     Łącznie 7 typów × (3S + 3M + 3L + 1BIG) = 70 meshów.
 *   - Każdy mesh ma stałą capacity (z marginesem na splity).
 *   - Slot-pooling: zniszczona asteroida zwalnia slot, nowa (po splicie lub respawnie)
 *     bierze go z wolnego stosu. Zero realokacji.
 *   - Geometria: pojedynczy PlaneGeometry(1,1). Asteroid sprite leży na płaszczyźnie XY
 *     na Z=-120 (głębiej niż planety -100, by nie nakładał się). Kamera gry top-down
 *     patrzy w stronę -Z, więc plane naturalnie face-camera bez billboardingu shader'em.
 *   - DynamicDrawUsage na instanceMatrix - zmiany scale/rotation per frame są tanie.
 *
 * Współrzędne (3D X, Y, Z) <-> (2D world X, Y) mapują się analogicznie do reszty kodu:
 *   3D.x =  2D.x
 *   3D.y = -2D.y
 *   3D.z = -120 ± jitter
 *
 * API publiczne:
 *   const field = new AsteroidField({ seed, planets, auToWorld, scene });
 *   field.update(dt);
 *   field.damage(asteroid, dmg) | field.damageById(id, dmg) -> { destroyed, drops, splits }
 *   field.queryRadius(cx, cy, r) -> Asteroid[]
 *   field.raycast(x0,y0, x1,y1) -> { asteroid, t } | null
 *   field.dispose();
 */

import * as THREE from 'three';
import { Core3D } from './core3d.js';
import {
  ASTEROID_TYPES,
  ASTEROID_SIZES,
  ASTEROID_TINT,
  ASTEROID_RESOURCE,
  SIZE_CLASS,
  ASTEROID_TEXTURE_FILES,
  ASTEROID_TEXTURE_BASE_PATH,
  BELT_DEFINITIONS,
  POOL_CAPACITY_PER_VARIANT,
  MAX_VARIANTS_PER_SIZE,
  pickWeighted,
} from '../data/asteroidTypes.js';

const Z_BASE = -120;
const Z_JITTER = 60;        // ±30 wokół Z_BASE
// Spin wyłączony - przy 500k asteroid każda obracająca się asteroida triggeruje
// re-upload bufora instanceMatrix pool'a (~600KB/pula). To ~20MB/klatkę przy
// gęstym pasie, czyli ostry FPS drop. Asteroidy w kosmosie obracają się tak wolno
// że i tak nie było tego widać przy tej skali (jest milion u-niedaleko od kamery).
const SPIN_MAX = 0;

// Reusable scratchpads
const _MAT = new THREE.Matrix4();
const _POS = new THREE.Vector3();
const _QUAT = new THREE.Quaternion();
const _SCALE = new THREE.Vector3();
const _EULER = new THREE.Euler();
const _HIDDEN_POS = new THREE.Vector3(0, 0, -1e7);
const _TINY = new THREE.Vector3(1e-6, 1e-6, 1e-6);
const _IDENTITY_QUAT = new THREE.Quaternion();

let _sharedTextureLoader = null;
function loader() {
  if (!_sharedTextureLoader) _sharedTextureLoader = new THREE.TextureLoader();
  return _sharedTextureLoader;
}

// Mulberry32 - deterministyczny RNG dla powtarzalnego generowania.
function makeRng(seed) {
  let s = (seed | 0) >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hideMatrix() {
  _MAT.compose(_HIDDEN_POS, _IDENTITY_QUAT, _TINY);
  return _MAT;
}

/**
 * Pula instancji jednej kombinacji (typ, rozmiar, wariant).
 */
class AsteroidPool {
  constructor(scene, key, texturePath, tint, capacity) {
    this.key = key;
    this.capacity = capacity;
    this.activeCount = 0;
    this.free = new Int32Array(capacity);
    this.freeTop = capacity;
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;

    this.texture = loader().load(texturePath, (tex) => {
      if (tex) {
        // Nie generujemy mipmap - oszczędza pamięć, asteroidy są często blisko swojej naturalnej skali.
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.anisotropy = 1;
        if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
      }
    });

    const geom = new THREE.PlaneGeometry(1, 1);
    // KRYTYCZNE dla wydajności przy 500k asteroid: alpha CUTOUT zamiast BLEND.
    //   - transparent:false + alphaTest:0.5 + depthWrite:true = opaque rendering
    //     z odrzucaniem pikseli pod progiem alpha
    //   - Bez tego: każda przezroczysta nakładka = blend = overdraw
    //     (5-20× w gęstym pasie = bottleneck memory bandwidth na GPU)
    //   - Z cutout: depth-buffer eliminuje overdraw, asteroidy z przodu blokują te z tyłu
    //   - Visual loss: lekko twardsze krawędzie sprite'a (akceptowalne)
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
      side: THREE.DoubleSide,
      color: new THREE.Color(tint),
    });

    this.mesh = new THREE.InstancedMesh(geom, mat, capacity);
    this.mesh.name = `asteroid_pool_${key}`;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.userData.isAsteroidPool = true;
    // KRITICAL: Core3D używa warstw do separacji pass-ów renderingu.
    // Layer 0 jest renderowany tylko przez cameraOrtho (Z=+150000),
    // a stations/statki idą na Layer 2 (cameraPersp). Asteroidy muszą
    // być razem z resztą sceny - dlatego layer 2.
    this.mesh.layers.set(2);

    // Init wszystkie sloty jako ukryte
    const hidden = hideMatrix();
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = false;

    scene.add(this.mesh);
  }

  allocate() {
    if (this.freeTop <= 0) return -1;
    this.activeCount++;
    return this.free[--this.freeTop];
  }

  release(idx) {
    if (idx < 0 || idx >= this.capacity) return;
    this.mesh.setMatrixAt(idx, hideMatrix());
    this.dirty = true;
    this.activeCount--;
    this.free[this.freeTop++] = idx;
  }

  writeMatrix(idx, x, y, z, rotZ, scale) {
    _EULER.set(0, 0, rotZ, 'XYZ');
    _QUAT.setFromEuler(_EULER);
    _SCALE.set(scale, scale, scale);
    _POS.set(x, y, z);
    _MAT.compose(_POS, _QUAT, _SCALE);
    this.mesh.setMatrixAt(idx, _MAT);
    this.dirty = true;
  }

  flush() {
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this.texture) this.texture.dispose();
  }
}

/**
 * Spatial hash grid - broad-phase dla queries (raycast, area weapons, viewport, spin LOD).
 * Cell size 2000u (~0.66 AU) - kompromis między granularnością a liczbą cells.
 * Bez tego przy 500k asteroid każde queryRadius / raycast iterowałoby pełną tablicę (~5ms+).
 * Z hashem: typowo <50k iteracji w gęstym pasie, <1k w rzadszych obszarach.
 */
class SpatialHash {
  constructor(cellSize = 2000) {
    this.cellSize = cellSize;
    /** @type {Map<number, Array<any>>} */
    this.cells = new Map();
  }
  _key(cx, cy) {
    // Pakujemy dwa signed-16 inty w 32-bit number. Klucze są stabilne i hashowalne.
    return ((cx + 32768) & 0xFFFF) * 0x10000 + ((cy + 32768) & 0xFFFF);
  }
  insert(item, x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const key = this._key(cx, cy);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    item._hashKey = key;
    item._hashIdx = bucket.length;
    bucket.push(item);
  }
  remove(item) {
    if (item._hashKey === undefined) return;
    const bucket = this.cells.get(item._hashKey);
    if (!bucket) return;
    const idx = item._hashIdx;
    const last = bucket.length - 1;
    if (idx !== last) {
      bucket[idx] = bucket[last];
      bucket[idx]._hashIdx = idx;
    }
    bucket.pop();
    if (bucket.length === 0) this.cells.delete(item._hashKey);
    item._hashKey = undefined;
    item._hashIdx = undefined;
  }
  forEachInRadius(x, y, r, cb) {
    const c = this.cellSize;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(this._key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) cb(bucket[i]);
      }
    }
  }
  forEachInRect(x0, y0, x1, y1, cb) {
    const c = this.cellSize;
    const cx0 = Math.floor(x0 / c);
    const cx1 = Math.floor(x1 / c);
    const cy0 = Math.floor(y0 / c);
    const cy1 = Math.floor(y1 / c);
    const cellsInRect = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    const occupied = this.cells.size;
    // Adaptywna strategia: dla małego rect iterujemy grid, dla bardzo szerokiego
    // (np. CIC z widokiem systemu, gdzie rect pokrywa miliony komórek pustych)
    // iterujemy zajęte komórki z mapy i filtrujemy. Próg 4x zapewnia, że strategia
    // grid jest preferowana gdy rect jest mniejszy niż mapa.
    if (cellsInRect < occupied * 4) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const bucket = this.cells.get(this._key(cx, cy));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) cb(bucket[i]);
        }
      }
    } else {
      // Iteruj wszystkie zajęte cells i odfiltruj poza rectem.
      for (const [key, bucket] of this.cells) {
        // Rozpakuj klucz (cx, cy) - patrz _key()
        const packedX = (key >>> 16) & 0xFFFF;
        const packedY = key & 0xFFFF;
        const cx = packedX - 32768;
        const cy = packedY - 32768;
        if (cx < cx0 || cx > cx1 || cy < cy0 || cy > cy1) continue;
        for (let i = 0; i < bucket.length; i++) cb(bucket[i]);
      }
    }
  }
  /** DDA traversal komórek wzdłuż odcinka. */
  forEachOnLine(x0, y0, x1, y1, cb) {
    const c = this.cellSize;
    let cx = Math.floor(x0 / c);
    let cy = Math.floor(y0 / c);
    const ex = Math.floor(x1 / c);
    const ey = Math.floor(y1 / c);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
    const tDeltaX = stepX !== 0 ? Math.abs(c / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(c / dy) : Infinity;
    let tMaxX = stepX > 0 ? (((cx + 1) * c) - x0) / dx
              : stepX < 0 ? ((cx * c) - x0) / dx
              : Infinity;
    let tMaxY = stepY > 0 ? (((cy + 1) * c) - y0) / dy
              : stepY < 0 ? ((cy * c) - y0) / dy
              : Infinity;
    const maxSteps = 4096;
    let steps = 0;
    while (steps++ < maxSteps) {
      const bucket = this.cells.get(this._key(cx, cy));
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) cb(bucket[i]);
      }
      if (cx === ex && cy === ey) break;
      if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDeltaX; }
      else { cy += stepY; tMaxY += tDeltaY; }
    }
  }
  clear() { this.cells.clear(); }
  get cellCount() { return this.cells.size; }
}

export class AsteroidField {
  constructor(opts = {}) {
    this.seed = (opts.seed != null ? opts.seed : 0xA57E20) >>> 0;
    this.scene = opts.scene || Core3D.scene;
    this.auToWorld = Number(opts.auToWorld) > 0 ? Number(opts.auToWorld) : 3000;
    this.planets = Array.isArray(opts.planets) ? opts.planets : [];
    // Słońce NIE jest w (0,0) - jest w (WORLD.w/2, WORLD.h/2). Bez tego offsetu
    // pasy pierścieniowe (Main Belt, Kuiper) generują się w lewym górnym rogu świata.
    const sun = opts.sun || (typeof window !== 'undefined' ? window.SUN : null);
    this.sunX = Number.isFinite(sun?.x) ? sun.x : 0;
    this.sunY = Number.isFinite(sun?.y) ? sun.y : 0;
    this.rng = makeRng(this.seed);

    /** @type {Map<string, AsteroidPool>} */
    this.pools = new Map();
    /** @type {Map<number, Asteroid>} */
    this.byId = new Map();
    /** Spatial hash do queries (raycast, area, viewport, LOD). */
    this.spatial = new SpatialHash(2000);
    this.nextId = 1;
    this._destroyedThisFrame = [];
    this._splitsThisFrame = [];

    this._initPools();
    this._generate();
    this._flushAll();

    if (typeof window !== 'undefined' && this.byId.size > 0) {
      const sample = this.byId.values().next().value;
      // eslint-disable-next-line no-console
      console.log(`[AsteroidField] spawned ${this.byId.size} asteroids; spatial hash ${this.spatial.cellCount} cells. Sample:`, {
        id: sample.id, type: sample.type, size: sample.size,
        worldX: Math.round(sample.worldX), worldY: Math.round(sample.worldY),
        z: Math.round(sample.position.z), scale: Math.round(sample.scale),
        belt: sample.beltId,
      });
    }
  }

  /**
   * Znajdź N najbliższych asteroid do (x, y) - debug. Używa spatial hash z rozszerzającym
   * się zasięgiem (potrajamy promień aż znajdziemy k+rezerwa kandydatów).
   */
  findNearest(x, y, k = 5) {
    const candidates = [];
    let radius = this.spatial.cellSize * 2;
    for (let tries = 0; tries < 8 && candidates.length < k * 2; tries++) {
      candidates.length = 0;
      this.spatial.forEachInRadius(x, y, radius, (a) => {
        if (a.alive) candidates.push(a);
      });
      if (candidates.length >= k) break;
      radius *= 2;
    }
    const sorted = candidates.map(a => ({
      asteroid: a, dist: Math.hypot(a.worldX - x, a.worldY - y),
    }));
    sorted.sort((u, v) => u.dist - v.dist);
    return sorted.slice(0, k).map(e => ({
      id: e.asteroid.id,
      type: e.asteroid.type,
      size: e.asteroid.size,
      dist: Math.round(e.dist),
      worldX: Math.round(e.asteroid.worldX),
      worldY: Math.round(e.asteroid.worldY),
      belt: e.asteroid.beltId,
    }));
  }

  // ---- public API ----

  /**
   * Klatkowa aktualizacja: spin propagowany tylko dla asteroid w LOD_RANGE od gracza,
   * używając spatial hash. Zamiast iteracji 500k asteroid przeszukujemy tylko cele
   * w komórkach pokrywających okrąg LOD (~9x9 cell = 81 cells przy LOD 8000 / cell 2000).
   */
  update(dt) {
    // Spin jest globalnie wyłączony (SPIN_MAX=0) - update() jest no-op przy
    // 500k asteroid. Splity/destroyacje robią flush bezpośrednio w _spawn/_destroy.
    if (SPIN_MAX === 0) return;

    const dtClamped = Math.max(0, Math.min(0.1, dt || 0));
    const ship = (typeof window !== 'undefined') ? window.ship : null;
    const camX = (ship?.pos?.x !== undefined) ? ship.pos.x : (ship?.x ?? Number.NaN);
    const camY = (ship?.pos?.y !== undefined) ? ship.pos.y : (ship?.y ?? Number.NaN);
    const hasLOD = Number.isFinite(camX) && Number.isFinite(camY);
    const LOD_RANGE = 8000;
    const LOD_RANGE2 = LOD_RANGE * LOD_RANGE;

    if (!hasLOD) { this._flushAll(); return; }

    this.spatial.forEachInRadius(camX, camY, LOD_RANGE, (a) => {
      if (!a.alive || a.spin === 0) return;
      const dx = a.worldX - camX;
      const dy = a.worldY - camY;
      if (dx * dx + dy * dy >= LOD_RANGE2) return;
      a.rotZ += a.spin * dtClamped;
      const pool = this.pools.get(a.poolKey);
      if (pool) pool.writeMatrix(a.instanceIdx, a.position.x, a.position.y, a.position.z, a.rotZ, a.scale);
    });

    this._flushAll();
  }

  /**
   * Zadaj obrażenia asteroidzie. Zwraca opis:
   *  { destroyed: bool, asteroid, drops?: {resource, amount}, splits?: Asteroid[], remainingHp: number }
   */
  damage(asteroid, dmg) {
    if (!asteroid || !asteroid.alive) return null;
    asteroid.hp -= Math.max(0, dmg);
    if (asteroid.hp <= 0) return this._destroy(asteroid);
    return { destroyed: false, asteroid, remainingHp: asteroid.hp };
  }

  damageById(id, dmg) {
    return this.damage(this.byId.get(id), dmg);
  }

  /**
   * Asteroidy w okręgu (broad-phase dla broni obszarowych). Spatial hash → O(k).
   * worldX/Y są w 2D space, więc cx/cy też przyjmujemy w 2D.
   */
  queryRadius(cx, cy, radius) {
    const result = [];
    // Spatial hash używa worldX/worldY (2D). Rozszerzamy promień o max scale asteroidy
    // (BIG=1500), żeby uniknąć missów przy krawędzi.
    const queryR = radius + 1500;
    this.spatial.forEachInRadius(cx, cy, queryR, (a) => {
      if (!a.alive) return;
      const dx = a.worldX - cx;
      const dy = a.worldY - cy;
      const reach = radius + a.scale * 0.5;
      if (dx * dx + dy * dy <= reach * reach) result.push(a);
    });
    return result;
  }

  /**
   * Asteroidy w prostokącie (viewport CIC). Spatial hash → tylko cells w boundsie.
   */
  queryRect(x0, y0, x1, y1) {
    const result = [];
    this.spatial.forEachInRect(x0, y0, x1, y1, (a) => {
      if (a.alive) result.push(a);
    });
    return result;
  }

  /**
   * Najbliższe trafienie linii (x0,y0)->(x1,y1). DDA walk po komórkach spatial hash.
   * Pierwszy trafiony asteroida w kierunku ruchu wygrywa - można early-exit.
   */
  raycast(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return null;
    let bestT = Infinity;
    let best = null;
    // DDA: dla każdej komórki przeciętej przez linię testujemy asteroidy w niej.
    this.spatial.forEachOnLine(x0, y0, x1, y1, (a) => {
      if (!a.alive) return;
      const ax = a.worldX, ay = a.worldY;
      const r = a.scale * 0.45;
      const ex = ax - x0, ey = ay - y0;
      const t = (ex * dx + ey * dy) / len2;
      if (t < 0 || t > 1) return;
      const px = x0 + dx * t, py = y0 + dy * t;
      const ddx = ax - px, ddy = ay - py;
      if (ddx * ddx + ddy * ddy <= r * r && t < bestT) {
        bestT = t;
        best = a;
      }
    });
    return best ? { asteroid: best, t: bestT } : null;
  }

  /** Liczba aktywnych asteroid. */
  get count() { return this.byId.size; }

  dispose() {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.byId.clear();
    this.spatial.clear();
  }

  // ---- internal ----

  _initPools() {
    // Limit wariantów per (typ, rozmiar) - patrz MAX_VARIANTS_PER_SIZE w asteroidTypes.js.
    // Po reducji: 7 typów x 4 rozmiary x 1 wariant = 28 pul zamiast 70.
    // Mniej draw calli + mniej tekstur w VRAM.
    for (const type of ASTEROID_TYPES) {
      const tint = ASTEROID_TINT[type] ?? 0xffffff;
      for (const size of ASTEROID_SIZES) {
        const files = ASTEROID_TEXTURE_FILES[type][size];
        const maxV = Math.min(files.length, MAX_VARIANTS_PER_SIZE);
        // Capacity skaluje się z liczbą wariantów - mniej wariantów = więcej asteroid w 1 puli
        const cap = (POOL_CAPACITY_PER_VARIANT[size] || 32) * Math.ceil(files.length / maxV);
        for (let v = 0; v < maxV; v++) {
          const key = `${type}_${size}_${v}`;
          const path = `${ASTEROID_TEXTURE_BASE_PATH}${files[v]}.png`;
          this.pools.set(key, new AsteroidPool(this.scene, key, path, tint, cap));
        }
      }
    }
  }

  _generate() {
    for (const belt of BELT_DEFINITIONS) {
      this._generateBelt(belt);
    }
  }

  _generateBelt(belt) {
    const count = belt.count | 0;
    for (let i = 0; i < count; i++) {
      const pos2D = this._sampleBeltPosition2D(belt);
      if (!pos2D) continue;
      const type = pickWeighted(belt.types, this.rng);
      const size = pickWeighted(belt.sizes, this.rng);
      const sc = SIZE_CLASS[size];
      // Wariant w zakresie utworzonych pul (limit przez MAX_VARIANTS_PER_SIZE).
      const variantCount = Math.min(ASTEROID_TEXTURE_FILES[type][size].length, MAX_VARIANTS_PER_SIZE);
      const variant = Math.floor(this.rng() * variantCount);
      const scaleJitter = 0.82 + this.rng() * 0.45;
      const z = Z_BASE + (this.rng() - 0.5) * Z_JITTER;
      this._spawn({
        type, size, variant,
        worldX: pos2D.x, worldY: pos2D.y, z,
        rotZ: this.rng() * Math.PI * 2,
        spin: (this.rng() - 0.5) * SPIN_MAX,
        scale: sc.scale * scaleJitter,
        beltId: belt.id,
      });
    }
  }

  /** Zwraca pozycję w 2D world space (x,y) — zgodną z resztą gry (czyli wokół SUN). */
  _sampleBeltPosition2D(belt) {
    const au = this.auToWorld;
    const sx = this.sunX;
    const sy = this.sunY;
    if (belt.shape === 'ring') {
      const r = (belt.innerAU + this.rng() * (belt.outerAU - belt.innerAU)) * au;
      const angle = this.rng() * Math.PI * 2;
      return { x: sx + Math.cos(angle) * r, y: sy + Math.sin(angle) * r };
    }
    if (belt.shape === 'lagrange') {
      const planet = this._findPlanet(belt.anchorPlanet);
      if (!planet) return null;
      // Planeta jest w globalnych koordynatach świata - liczymy względem SUN.
      const px = (planet.x ?? (sx + Math.cos(planet.angle || 0) * (planet.orbitRadius || planet.orbitAU * au))) - sx;
      const py = (planet.y ?? (sy + Math.sin(planet.angle || 0) * (planet.orbitRadius || planet.orbitAU * au))) - sy;
      const planetR = Math.hypot(px, py);
      if (planetR < 1) return null;
      const planetAngle = Math.atan2(py, px);
      const offset = belt.lagrange === 'L4' ? +Math.PI / 3 : -Math.PI / 3;
      const arcJitter = (this.rng() - 0.5) * (belt.arcSpread || 0.3);
      const angle = planetAngle + offset + arcJitter;
      const r = planetR + (this.rng() - 0.5) * (belt.spreadAU || 4) * au;
      return { x: sx + Math.cos(angle) * r, y: sy + Math.sin(angle) * r };
    }
    if (belt.shape === 'triangle') {
      const planet = this._findPlanet(belt.anchorPlanet);
      const px = (planet?.x ?? sx) - sx;
      const py = (planet?.y ?? sy) - sy;
      const planetAngle = Math.atan2(py, px);
      const cluster = Math.floor(this.rng() * 3);
      const clusterAngle = planetAngle + cluster * (Math.PI * 2 / 3);
      const beltR = (belt.radiusAU || 42) * au;
      const arcJitter = (this.rng() - 0.5) * 0.3;
      const angle = clusterAngle + arcJitter;
      const r = beltR + (this.rng() - 0.5) * (belt.spreadAU || 3) * au;
      return { x: sx + Math.cos(angle) * r, y: sy + Math.sin(angle) * r };
    }
    return null;
  }

  _findPlanet(id) {
    if (!id) return null;
    for (const p of this.planets) {
      if (p && (p.id === id || p.name === id)) return p;
    }
    return null;
  }

  /**
   * Wewnętrzny spawn z parametrami w 2D world space.
   */
  _spawn({ type, size, variant, worldX, worldY, z, rotZ, spin, scale, beltId }) {
    const key = `${type}_${size}_${variant}`;
    const pool = this.pools.get(key);
    if (!pool) return null;
    const idx = pool.allocate();
    if (idx < 0) {
      console.warn(`[AsteroidField] pool full: ${key} (cap=${pool.capacity})`);
      return null;
    }
    const sc = SIZE_CLASS[size];
    const asteroid = {
      id: this.nextId++,
      type, size, variant,
      poolKey: key,
      instanceIdx: idx,
      // pozycja w 3D space (3D.x = 2D.x, 3D.y = -2D.y)
      position: new THREE.Vector3(worldX, -worldY, z),
      // worldX/Y są też dostępne na asteroid - łatwiejszy dostęp dla logiki 2D
      worldX, worldY,
      rotZ, spin,
      scale,
      hp: sc.hp,
      hpMax: sc.hp,
      yield: sc.yield,
      resource: ASTEROID_RESOURCE[type],
      beltId,
      alive: true,
      _dirty: true,
    };
    pool.writeMatrix(idx, asteroid.position.x, asteroid.position.y, asteroid.position.z, rotZ, scale);
    this.byId.set(asteroid.id, asteroid);
    this.spatial.insert(asteroid, worldX, worldY);
    return asteroid;
  }

  _destroy(asteroid) {
    asteroid.alive = false;
    const sc = SIZE_CLASS[asteroid.size];
    const drops = { resource: asteroid.resource, amount: asteroid.yield };
    const splits = [];

    if (sc.splitInto) {
      const childSize = sc.splitInto.size;
      const childSC = SIZE_CLASS[childSize];
      const variantsAvail = Math.min(ASTEROID_TEXTURE_FILES[asteroid.type][childSize].length, MAX_VARIANTS_PER_SIZE);
      const baseAngle = this.rng() * Math.PI * 2;
      for (let k = 0; k < sc.splitInto.count; k++) {
        const a = baseAngle + k * (Math.PI * 2 / sc.splitInto.count);
        const dist = asteroid.scale * 0.45;
        const wx = asteroid.worldX + Math.cos(a) * dist;
        const wy = asteroid.worldY + Math.sin(a) * dist;
        const z = asteroid.position.z + (this.rng() - 0.5) * 12;
        const variant = Math.floor(this.rng() * variantsAvail);
        const child = this._spawn({
          type: asteroid.type,
          size: childSize,
          variant,
          worldX: wx, worldY: wy, z,
          rotZ: this.rng() * Math.PI * 2,
          spin: (this.rng() - 0.5) * SPIN_MAX * 1.6,
          scale: childSC.scale * (0.85 + this.rng() * 0.3),
          beltId: asteroid.beltId,
        });
        if (child) splits.push(child);
      }
    }

    const pool = this.pools.get(asteroid.poolKey);
    if (pool) pool.release(asteroid.instanceIdx);
    this.spatial.remove(asteroid);
    this.byId.delete(asteroid.id);

    return { destroyed: true, asteroid, drops, splits, remainingHp: 0 };
  }

  _flushAll() {
    for (const pool of this.pools.values()) pool.flush();
  }
}

/**
 * @typedef {Object} Asteroid
 * @property {number} id
 * @property {string} type           one of ASTEROID_TYPES
 * @property {string} size           one of ASTEROID_SIZES
 * @property {number} variant        index of texture variant
 * @property {string} poolKey
 * @property {number} instanceIdx
 * @property {THREE.Vector3} position 3D space position (x, -y, z)
 * @property {number} worldX         2D game world X
 * @property {number} worldY         2D game world Y
 * @property {number} rotZ           rotation in radians
 * @property {number} spin           rad/s
 * @property {number} scale          world units (diameter)
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} yield          base resource units dropped
 * @property {string} resource       resource id (iron_ore, etc.)
 * @property {string} beltId
 * @property {boolean} alive
 */
