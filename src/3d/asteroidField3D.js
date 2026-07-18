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
import { getAsteroidRammingMass, getCollisionMass, getMass, getHardness, getMaxHp } from '../data/asteroidPhysics.js';
import { COLLISION_CONFIG } from '../data/asteroidPhysics.js';
import { AsteroidDestructor, resolveShipAsteroidCollision } from '../game/asteroidDestructor.js';
import { DestructorSystem, getHexStructuralState, initHexBody } from '../game/destructor.js';
import {
  buildAsteroidHexEntityModel,
  initializeAsteroidHexIntegrity,
  integrateAsteroidHexEntityMotion,
  isAsteroidHexCoreDestroyed,
  syncAsteroidFromHexEntity,
  syncHexEntityFromAsteroid
} from '../game/asteroidHexAdapter.js';

const Z_BASE = -120;
const Z_JITTER = 60;        // ±30 wokół Z_BASE
const ASTEROID_RAYCAST_MAX_RADIUS = 700;
// Spin wyłączony - przy 500k asteroid każda obracająca się asteroida triggeruje
// re-upload bufora instanceMatrix pool'a (~600KB/pula). To ~20MB/klatkę przy
// gęstym pasie, czyli ostry FPS drop. Asteroidy w kosmosie obracają się tak wolno
// że i tak nie było tego widać przy tej skali (jest milion u-niedaleko od kamery).
const SPIN_MAX = 0;

export function segmentCircleHitInfo(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return null;

  const r = Math.max(0, Number(radius) || 0);
  const ex = cx - x0;
  const ey = cy - y0;
  const closestT = Math.max(0, Math.min(1, (ex * dx + ey * dy) / len2));
  const px = x0 + dx * closestT;
  const py = y0 + dy * closestT;
  const ddx = cx - px;
  const ddy = cy - py;
  const distSq = ddx * ddx + ddy * ddy;
  const rSq = r * r;
  if (distSq > rSq) return null;

  const fx = x0 - cx;
  const fy = y0 - cy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - rSq;
  let entryT = closestT;
  if (c <= 0) {
    entryT = 0;
  } else {
    const disc = b * b - 4 * len2 * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const t0 = (-b - root) / (2 * len2);
      const t1 = (-b + root) / (2 * len2);
      if (t0 >= 0 && t0 <= 1) entryT = t0;
      else if (t1 >= 0 && t1 <= 1) entryT = t1;
    }
  }

  return { entryT, closestT, distSq };
}

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

// Pojedyncza PlaneGeometry współdzielona przez wszystkie pule. Bez tego każda
// pula miała własne VBO geometrii (28 instances) - znikomy zysk per pula
// ale w sumie ~50µs/klatkę z mniej state changes WebGL.
let _sharedAsteroidGeometry = null;
function getSharedAsteroidGeometry() {
  if (!_sharedAsteroidGeometry) _sharedAsteroidGeometry = new THREE.PlaneGeometry(1, 1);
  return _sharedAsteroidGeometry;
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
        // Mipmapy + trilinear filtering KONIECZNE. Bez tego sprite asteroidy renderowany
        // na np. 30 pikseli ekranu sampluje z pełnej 600x600 PNG - GPU wybiera losowy
        // texel per pixel = sproszkowane, ziarniste artefakty (aliasing wysokich częstotliwości).
        // Koszt: +33% VRAM na mipmap chain. Warto.
        tex.minFilter = THREE.LinearMipmapLinearFilter;  // trilinear
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        // Anizotropowe filtrowanie - 4× pomaga gdy asteroida jest mocno nachylona w kadrze
        // (przy szerokim FOV i bliskim podejściu). Modest cost.
        tex.anisotropy = 4;
        if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
      }
    });

    const geom = getSharedAsteroidGeometry();
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
      // alphaToCoverage: używa próbek MSAA do wygładzania krawędzi cutout.
      // Bez tego krawędzie sprite'a (gdzie alpha przechodzi przez 0.5)
      // są twarde i schodkowe - wygląda jak pikselowy szum. Z MSAA 4×
      // dostajemy 4 gradacje przezroczystości na krawędziach = smooth.
      // Wymaga MSAA w render target (mamy: samples=4 w composer).
      alphaToCoverage: true,
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
    // GPU rysuje tylko sloty [0, watermark) - nieużyty margines pojemności
    // nie przechodzi przez vertex shader. Watermark rośnie w allocate().
    this.watermark = 0;
    this.mesh.count = 0;

    scene.add(this.mesh);

    // Okluder shadow shafts: asteroida to sprite z alpha-cutout — z białym
    // override'em maski rzucałaby PROSTOKĄT. Bliźniak instanced dzieli
    // geometrię i TEN SAM atrybut instanceMatrix (zero dodatkowych uploadów),
    // rysuje białą sylwetkę przez alphaTest w przejściu maski bez override'u
    // (warstwa persp sprite-okluderów — asteroidy żyją w passie FG).
    this.occluderMesh = null;
    if (typeof Core3D.enableSpriteOccluderPersp3D === 'function') {
      const occluderMat = new THREE.MeshBasicMaterial({
        map: this.texture,
        color: 0xffffff,
        transparent: false,
        alphaTest: 0.5,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide
      });
      this.occluderMesh = new THREE.InstancedMesh(geom, occluderMat, capacity);
      this.occluderMesh.name = `asteroid_pool_occluder_${key}`;
      this.occluderMesh.instanceMatrix = this.mesh.instanceMatrix;
      this.occluderMesh.frustumCulled = false;
      this.occluderMesh.count = 0;
      Core3D.enableSpriteOccluderPersp3D(this.occluderMesh);
      scene.add(this.occluderMesh);
    }
  }

  allocate() {
    if (this.freeTop <= 0) return -1;
    this.activeCount++;
    const idx = this.free[--this.freeTop];
    if (idx >= this.watermark) {
      this.watermark = idx + 1;
      this.mesh.count = this.watermark;
      if (this.occluderMesh) this.occluderMesh.count = this.watermark;
    }
    return idx;
  }

  release(idx) {
    if (idx < 0 || idx >= this.capacity) return;
    this.mesh.setMatrixAt(idx, hideMatrix());
    this.dirty = true;
    this.activeCount--;
    this.free[this.freeTop++] = idx;
  }

  hide(idx) {
    if (idx < 0 || idx >= this.capacity) return;
    this.mesh.setMatrixAt(idx, hideMatrix());
    this.dirty = true;
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
    // UWAGA: NIE dispose'ujemy geometrii bo jest współdzielona przez wszystkie pule.
    this.mesh.material.dispose();
    if (this.occluderMesh) {
      if (this.occluderMesh.parent) this.occluderMesh.parent.remove(this.occluderMesh);
      // Geometria i instanceMatrix współdzielone z this.mesh — tylko materiał.
      this.occluderMesh.material.dispose();
      this.occluderMesh = null;
    }
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

  /** Aktualizuje pozycję itemu w hashu. Re-inserts tylko jeśli zmieniła się komórka. */
  update(item, newX, newY) {
    const c = this.cellSize;
    const newCx = Math.floor(newX / c);
    const newCy = Math.floor(newY / c);
    const newKey = this._key(newCx, newCy);
    if (item._hashKey === newKey) return; // ta sama komórka - nic do roboty
    this.remove(item);
    let bucket = this.cells.get(newKey);
    if (!bucket) {
      bucket = [];
      this.cells.set(newKey, bucket);
    }
    item._hashKey = newKey;
    item._hashIdx = bucket.length;
    bucket.push(item);
  }
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
    /** Brittle hex destructor - lazy alokacja per damaged asteroid. */
    this.destructor = new AsteroidDestructor();
    this.activeHexAsteroids = new Set();
    this.activeHexById = new Map();
    this.maxActiveHexAsteroids = Math.max(8, Number(opts.maxActiveHexAsteroids) || 96);
    this._activeHexEntityBuffer = [];
    this._activeHexRemoveBuffer = [];
    /** Lista zdarzeń debris z ostatniej klatki - do konsumpcji przez systemy VFX. */
    this.debrisEvents = [];
    /** Set asteroid z vel != 0 (popchnięte, dryfują). Per-frame update tylko tych. */
    this.movingAsteroids = new Set();
    this.nextId = 1;
    this._destroyedThisFrame = [];
    this._splitsThisFrame = [];
    /** Radialne pasma pasów (minR/maxR od Słońca) mierzone przy spawnie. */
    this._beltRadialBounds = new Map();
    this._poolsVisible = true;

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

  _getAsteroidPool(asteroid) {
    return asteroid?.poolKey ? (this.pools.get(asteroid.poolKey) || null) : null;
  }

  _getAsteroidImage(asteroid) {
    const pool = this._getAsteroidPool(asteroid);
    const image = pool?.texture?.image || null;
    const width = Number(image?.naturalWidth || image?.width || 0);
    const height = Number(image?.naturalHeight || image?.height || 0);
    return (width > 0 && height > 0) ? image : null;
  }

  _hideAsteroidInstance(asteroid) {
    if (!asteroid || asteroid._instancedHidden) return;
    const pool = this._getAsteroidPool(asteroid);
    if (!pool) return;
    pool.hide(asteroid.instanceIdx);
    pool.flush();
    asteroid._instancedHidden = true;
  }

  _showAsteroidInstance(asteroid) {
    if (!asteroid || !asteroid._instancedHidden) return;
    const pool = this._getAsteroidPool(asteroid);
    if (!pool) return;
    pool.writeMatrix(
      asteroid.instanceIdx,
      asteroid.position.x,
      asteroid.position.y,
      asteroid.position.z,
      asteroid.rotZ,
      asteroid.scale
    );
    pool.flush();
    asteroid._instancedHidden = false;
  }

  _promoteAsteroidToHex(asteroid, reason = 'near') {
    if (!asteroid || !asteroid.alive) return null;
    if (asteroid.hexEntity?.hexGrid) return asteroid.hexEntity;
    if (this.activeHexAsteroids.size >= this.maxActiveHexAsteroids) return null;

    const image = this._getAsteroidImage(asteroid);
    if (!image) return null;

    const entity = buildAsteroidHexEntityModel(asteroid, image);
    entity.__promoteReason = reason;
    entity.owner = entity;
    entity.pos = null;
    entity.vel = null;
    initHexBody(entity, image, false, entity.mass, 40);
    if (!entity.hexGrid) return null;
    initializeAsteroidHexIntegrity(entity);

    entity.radius = Math.max(entity.radius || 0, asteroid.scale * 0.5);
    entity._bpRadius = entity.radius;
    entity.hexGrid.meshDirty = true;
    entity.hexGrid.meshDirtyAll = true;
    entity.hexGrid.gpuTextureNeedsUpdate = true;
    entity.hexGrid.wakeHoldFrames = 30;
    asteroid.hexEntity = entity;
    asteroid._hexPromoted = true;

    this.activeHexAsteroids.add(entity);
    this.activeHexById.set(asteroid.id, entity);
    this.movingAsteroids.delete(asteroid);
    this._hideAsteroidInstance(asteroid);
    this.destructor.release(asteroid.id);
    return entity;
  }

  getActiveHexEntities(out = null) {
    const result = out || this._activeHexEntityBuffer;
    result.length = 0;
    for (const entity of this.activeHexAsteroids) {
      if (!entity || entity.dead || entity.isCollidable === false || !entity.hexGrid) continue;
      result.push(entity);
    }
    return result;
  }

  _syncActiveHexAsteroidsFromEntities() {
    const remove = this._activeHexRemoveBuffer;
    remove.length = 0;

    for (const entity of this.activeHexAsteroids) {
      const asteroid = entity?.asteroidRef;
      if (!entity || !asteroid) {
        if (entity) remove.push(entity);
        continue;
      }
      if (!asteroid.alive || entity.dead || !entity.hexGrid) {
        if (asteroid.alive && entity.dead) this._destroy(asteroid);
        else remove.push(entity);
        continue;
      }

      const structural = getHexStructuralState(entity);
      if ((structural && structural.active <= 0) || isAsteroidHexCoreDestroyed(entity)) {
        entity.dead = true;
        remove.push(entity);
        this._destroy(asteroid);
        continue;
      }

      syncAsteroidFromHexEntity(asteroid, entity);
      asteroid.position.x = asteroid.worldX;
      asteroid.position.y = -asteroid.worldY;
      this.spatial.update(asteroid, asteroid.worldX, asteroid.worldY);

      if (structural) {
        asteroid.hp = Math.min(
          Math.max(0, asteroid.hp),
          Math.max(0, asteroid.hpMax * structural.ratio)
        );
      }

      this.movingAsteroids.delete(asteroid);
    }

    for (let i = 0; i < remove.length; i++) {
      const entity = remove[i];
      const asteroid = entity?.asteroidRef;
      if (asteroid?.hexEntity === entity) asteroid.hexEntity = null;
      this.activeHexAsteroids.delete(entity);
      if (entity?.asteroidId != null) this.activeHexById.delete(entity.asteroidId);
    }
  }

  _updateActiveHexAsteroids(dt) {
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    if (step <= 0 || this.activeHexAsteroids.size === 0) return;

    for (const entity of this.activeHexAsteroids) {
      const asteroid = entity?.asteroidRef;
      if (!entity || !asteroid || !asteroid.alive || entity.dead || !entity.hexGrid) continue;
      integrateAsteroidHexEntityMotion(asteroid, entity, step, {
        maxVelocity: COLLISION_CONFIG.asteroidMaxVelocity
      });
      asteroid.position.x = asteroid.worldX;
      asteroid.position.y = -asteroid.worldY;
      this.spatial.update(asteroid, asteroid.worldX, asteroid.worldY);
      entity._bpRadius = entity.radius;
    }
  }

  _resolveActiveAsteroidImpacts() {
    if (this.activeHexAsteroids.size === 0) return;

    for (const entity of this.activeHexAsteroids) {
      const a = entity?.asteroidRef;
      if (!entity || !a || !a.alive || entity.dead || !entity.hexGrid) continue;

      const avx = Number(entity.vx) || 0;
      const avy = Number(entity.vy) || 0;
      const speed = Math.hypot(avx, avy);
      if (speed < COLLISION_CONFIG.minImpactVelocity) continue;

      const ar = a.scale * COLLISION_CONFIG.collisionRadiusFactor;
      this.spatial.forEachInRadius(a.worldX, a.worldY, ar + ASTEROID_RAYCAST_MAX_RADIUS, (b) => {
        if (!b || b === a || !b.alive || b.hexEntity?.hexGrid) return;

        const br = b.scale * COLLISION_CONFIG.collisionRadiusFactor;
        const dx = b.worldX - a.worldX;
        const dy = b.worldY - a.worldY;
        const distSq = dx * dx + dy * dy;
        const hitR = ar + br;
        if (distSq <= 0.0001 || distSq >= hitR * hitR) return;

        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;
        const bvx = Number(b.vx) || 0;
        const bvy = Number(b.vy) || 0;
        const relVx = avx - bvx;
        const relVy = avy - bvy;
        const closing = relVx * nx + relVy * ny;
        if (closing <= 0) return;

        const massA = Math.max(1, Number(entity.mass) || getCollisionMass(a.type, a.size));
        const massB = Math.max(1, getCollisionMass(b.type, b.size));
        const invA = 1 / massA;
        const invB = 1 / massB;
        const restitution = Math.max(0, Math.min(1, Number(COLLISION_CONFIG.bounceCoeff) || 0.45));
        const impulse = ((1 + restitution) * closing) / (invA + invB);

        entity.vx = avx - impulse * invA * nx;
        entity.vy = avy - impulse * invA * ny;
        b.vx = bvx + impulse * invB * nx;
        b.vy = bvy + impulse * invB * ny;

        const penetration = hitR - dist;
        const sepDenom = invA + invB;
        const sepA = sepDenom > 0 ? (invA / sepDenom) * penetration : penetration * 0.5;
        const sepB = penetration - sepA;
        entity.x -= nx * sepA;
        entity.y -= ny * sepA;
        b.worldX += nx * sepB;
        b.worldY += ny * sepB;
        b.position.x = b.worldX;
        b.position.y = -b.worldY;

        const damage = Math.max(8, (closing - COLLISION_CONFIG.minImpactVelocity) * 1.8);
        const hitAx = a.worldX + nx * ar;
        const hitAy = a.worldY + ny * ar;
        const hitBx = b.worldX - nx * br;
        const hitBy = b.worldY - ny * br;
        DestructorSystem.applyImpact(entity, hitAx, hitAy, damage, { x: relVx, y: relVy }, {
          radius: Math.max(60, Math.min(260, Math.min(a.scale, b.scale) * 0.18))
        });
        this.applyDamageAt(b, hitBx, hitBy, damage, { x: relVx, y: relVy });
      });

      syncAsteroidFromHexEntity(a, entity);
      a.position.x = a.worldX;
      a.position.y = -a.worldY;
      this.spatial.update(a, a.worldX, a.worldY);
    }
  }

  _trackBeltRadialBounds(beltId, worldX, worldY) {
    const r = Math.hypot(worldX - this.sunX, worldY - this.sunY);
    const key = beltId || 'belt';
    const band = this._beltRadialBounds.get(key);
    if (!band) {
      this._beltRadialBounds.set(key, { minR: r, maxR: r });
    } else {
      if (r < band.minR) band.minR = r;
      if (r > band.maxR) band.maxR = r;
    }
  }

  /**
   * Pule asteroid mają frustumCulled=false, więc bez tego CAŁA pojemność
   * (~700k slotów = ~1.4M tris, głównie ukryte zero-scale quady) idzie przez
   * vertex shader co klatkę z dowolnego miejsca świata. Chowamy meshe pul,
   * gdy ani kamera, ani statek gracza nie sięgają radialnego pasma żadnego
   * pasa. Fizyka, spatial hash i hex-adapter działają dalej - to tylko render.
   */
  _updatePoolRenderVisibility() {
    if (this._beltRadialBounds.size === 0 || typeof window === 'undefined') return;
    const vw = Math.max(1, Number(window.innerWidth) || 1920);
    const vh = Math.max(1, Number(window.innerHeight) || 1080);
    let visible = false;
    const probes = [window.camera, window.ship?.pos || window.ship];
    for (const probe of probes) {
      const px = Number(probe?.x);
      const py = Number(probe?.y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      const zoom = Math.max(0.0001, Number(probe?.zoom) || 1);
      // Zasięg widoku + margines na dryf popchniętych asteroid i BIG splity.
      const reach = (Math.max(vw, vh) * 0.5) / zoom + 9000;
      const dist = Math.hypot(px - this.sunX, py - this.sunY);
      for (const band of this._beltRadialBounds.values()) {
        if (dist >= band.minR - reach && dist <= band.maxR + reach) { visible = true; break; }
      }
      if (visible) break;
    }
    if (visible === this._poolsVisible) return;
    this._poolsVisible = visible;
    for (const pool of this.pools.values()) pool.mesh.visible = visible;
  }

  // ---- public API ----

  /**
   * Klatkowa aktualizacja: spin propagowany tylko dla asteroid w LOD_RANGE od gracza,
   * używając spatial hash. Zamiast iteracji 500k asteroid przeszukujemy tylko cele
   * w komórkach pokrywających okrąg LOD (~9x9 cell = 81 cells przy LOD 8000 / cell 2000).
   */
  update(dt) {
    this._updatePoolRenderVisibility();
    this._syncActiveHexAsteroidsFromEntities();
    this._updateActiveHexAsteroids(dt);
    this._resolveActiveAsteroidImpacts();
    // Destruktor zawsze updateuje (przewija burstFramesLeft aktywnych hex bodies).
    // Koszt: O(N) gdzie N = liczba uszkodzonych asteroid (zwykle <50).
    this.destructor.update(dt);

    // Update pozycji popchniętych asteroid. Working set typowo <100.
    let needsFlush = false;
    if (this.movingAsteroids.size > 0) {
      this._updateMovingAsteroids(dt);
      needsFlush = true;
    }

    // Spin jest globalnie wyłączony (SPIN_MAX=0) - update() jest no-op przy
    // 500k asteroid. Splity/destroyacje robią flush bezpośrednio w _spawn/_destroy.
    if (SPIN_MAX === 0) {
      if (needsFlush) this._flushAll();
      return;
    }

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
    const radiusFactor = COLLISION_CONFIG.collisionRadiusFactor;
    // Max realny radius: BIG scale 1500 * 0.42 = 630. Margin 700u.
    const queryR = radius + 700;
    this.spatial.forEachInRadius(cx, cy, queryR, (a) => {
      if (!a.alive) return;
      const dx = a.worldX - cx;
      const dy = a.worldY - cy;
      const reach = radius + a.scale * radiusFactor;
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
  raycast(x0, y0, x1, y1, extraRadius = 0) {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return null;
    let bestT = Infinity;
    let bestHitT = Infinity;
    let best = null;
    // DDA: dla każdej komórki przeciętej przez linię testujemy asteroidy w niej.
    const radiusFactor = COLLISION_CONFIG.collisionRadiusFactor;
    const extra = Math.max(0, Number(extraRadius) || 0);
    const midX = (x0 + x1) * 0.5;
    const midY = (y0 + y1) * 0.5;
    const halfLen = Math.sqrt(len2) * 0.5;
    const queryR = halfLen + ASTEROID_RAYCAST_MAX_RADIUS + extra;

    this.spatial.forEachInRadius(midX, midY, queryR, (a) => {
      if (!a.alive) return;
      const r = a.scale * radiusFactor + extra;
      const hit = segmentCircleHitInfo(x0, y0, x1, y1, a.worldX, a.worldY, r);
      if (hit && hit.entryT < bestT) {
        bestT = hit.entryT;
        bestHitT = hit.closestT;
        best = a;
      }
    });
    return best ? { asteroid: best, t: bestT, hitT: bestHitT } : null;
  }

  /** Liczba aktywnych asteroid. */
  get count() { return this.byId.size; }

  dispose() {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.byId.clear();
    this.spatial.clear();
    this.activeHexAsteroids.clear();
    this.activeHexById.clear();
    this._activeHexEntityBuffer.length = 0;
    this._activeHexRemoveBuffer.length = 0;
  }

  // ---- internal ----

  /**
   * Adaptywne capacities pul - liczone z faktycznego rozkładu typów w pasach.
   * Wcześniej była uniformna capacity ~105000 na (typ × rozmiar S), co dawało:
   *   - silicon-S (~89k aktywnych): tylko 17% margin
   *   - uran-S (~7.6k aktywnych): 1300% margin = 100k pustych slotów = wasted vertex shader
   * Adaptywnie: każda pula dostaje tyle ile potrzebuje + 40% margin na splity.
   * Sumarycznie zmniejsza liczbę "ukrytych" slotów (które i tak idą przez vertex shader)
   * o ~50% przy 500k asteroid.
   */
  _precomputeExpectedCounts() {
    const counts = new Map();
    for (const belt of BELT_DEFINITIONS) {
      const beltCount = belt.count | 0;
      for (const type of Object.keys(belt.types)) {
        const typeWeight = belt.types[type];
        for (const size of Object.keys(belt.sizes)) {
          const sizeWeight = belt.sizes[size];
          const expected = beltCount * typeWeight * sizeWeight;
          const key = `${type}_${size}`;
          counts.set(key, (counts.get(key) || 0) + expected);
        }
      }
    }
    return counts;
  }

  _initPools() {
    const expectedCounts = this._precomputeExpectedCounts();
    const MARGIN = 1.4;        // 40% margin na splity i drobne rozproszenie RNG
    const MIN_CAP = 200;       // minimum dla rzadkich kombinacji
    let totalCap = 0;
    for (const type of ASTEROID_TYPES) {
      const tint = ASTEROID_TINT[type] ?? 0xffffff;
      for (const size of ASTEROID_SIZES) {
        const files = ASTEROID_TEXTURE_FILES[type][size];
        const maxV = Math.min(files.length, MAX_VARIANTS_PER_SIZE);
        const expected = expectedCounts.get(`${type}_${size}`) || 0;
        const totalNeeded = Math.max(MIN_CAP, Math.ceil(expected * MARGIN));
        const capPerVariant = Math.ceil(totalNeeded / maxV);
        for (let v = 0; v < maxV; v++) {
          const key = `${type}_${size}_${v}`;
          const path = `${ASTEROID_TEXTURE_BASE_PATH}${files[v]}.png`;
          this.pools.set(key, new AsteroidPool(this.scene, key, path, tint, capPerVariant));
          totalCap += capPerVariant;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[AsteroidField] allocated ${this.pools.size} pools, total capacity ${totalCap} slots`);
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
    this._trackBeltRadialBounds(beltId, worldX, worldY);
    const sc = SIZE_CLASS[size];
    // Fizyka z asteroidPhysics: mass, hardness, hpMax zależne od typu i rozmiaru
    // (kruchy ice ma mało HP, twardy titan dużo).
    const legacyMass = getMass(type, size);
    const mass = getCollisionMass(type, size);
    const rammingMass = getAsteroidRammingMass(type, size);
    const hardness = getHardness(type);
    const hpMax = getMaxHp(type, size);
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
      baseScale: scale,         // do shrink wizualnego gdy cells odpadają
      hp: hpMax,
      hpMax,
      mass,
      legacyMass,
      rammingMass,
      hardness,
      // Velocity - większość asteroid statyczna (vel=0). Po pchnięciu trafia
      // do this.movingAsteroids dla per-frame update pozycji.
      vx: 0,
      vy: 0,
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
    const hexEntity = asteroid.hexEntity;
    if (hexEntity) {
      hexEntity.dead = true;
      hexEntity.isCollidable = false;
      this.activeHexAsteroids.delete(hexEntity);
      this.activeHexById.delete(asteroid.id);
      asteroid.hexEntity = null;
    }
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
    // Zwolnij hex destructor jeśli istniał
    this.destructor.release(asteroid.id);
    // Usuń z movingAsteroids (jeśli była popchnięta)
    this.movingAsteroids.delete(asteroid);
    this.byId.delete(asteroid.id);
    this._flushAll();

    return { destroyed: true, asteroid, drops, splits, remainingHp: 0 };
  }

  _flushAll() {
    for (const pool of this.pools.values()) pool.flush();
  }

  // ===========================================================================
  // PUBLIC: damage / collision API
  // ===========================================================================

  /**
   * Aplikuje damage w punkcie (worldX, worldY) na asteroidę. Lazy-spawnuje hex
   * destruktor jeśli to pierwsze trafienie. Zwraca opis efektu.
   *
   * @returns {{ destroyed: boolean, ejectedCells: number, drops?: object, splits?: Array, hexBody?: object }}
   */
  applyDamageAt(asteroid, worldX, worldY, damage, impactVel = null) {
    if (!asteroid || !asteroid.alive) return { destroyed: false, ejectedCells: 0 };

    const hexEntity = this._promoteAsteroidToHex(asteroid, 'damage');
    if (hexEntity?.hexGrid) {
      const dmg = Math.max(0, Number(damage) || 0);
      const hit = DestructorSystem.applyImpact(
        hexEntity,
        worldX,
        worldY,
        dmg,
        impactVel || { x: asteroid.vx || 0, y: asteroid.vy || 0 },
        { radius: Math.max(48, Math.min(260, asteroid.scale * 0.18)) }
      );

      if (!hit) {
        return {
          destroyed: false,
          ejectedCells: 0,
          remainingHp: asteroid.hp,
          hexBody: hexEntity.hexGrid,
          hexEntity,
          hit: false,
        };
      }

      const structural = getHexStructuralState(hexEntity);
      if (structural) {
        asteroid.hp = Math.min(
          Math.max(0, asteroid.hp - dmg),
          Math.max(0, asteroid.hpMax * structural.ratio)
        );
      } else {
        asteroid.hp = Math.max(0, asteroid.hp - dmg);
      }
      syncAsteroidFromHexEntity(asteroid, hexEntity);
      asteroid.position.x = asteroid.worldX;
      asteroid.position.y = -asteroid.worldY;
      this.spatial.update(asteroid, asteroid.worldX, asteroid.worldY);

      if ((structural && structural.active <= 0) || isAsteroidHexCoreDestroyed(hexEntity) || asteroid.hp <= 0) {
        const destroyResult = this._destroy(asteroid);
        return { ...destroyResult, ejectedCells: 0, hexEntity };
      }

      return {
        destroyed: false,
        ejectedCells: hit ? 1 : 0,
        remainingHp: asteroid.hp,
        hexBody: hexEntity.hexGrid,
        hexEntity,
        hit: true,
      };
    }

    const result = this.destructor.applyDamage(asteroid, worldX, worldY, damage);
    const hex = result.hexBody;
    if (!hex) return { destroyed: false, ejectedCells: 0 };

    // Wizualnie: shrink asteroidy proporcjonalnie do żywych cells
    const liveness = hex.livenessFraction();
    // Min 0.45 baseScale - asteroida nie zniknie do zera dopóki rdzeń żyje
    const visualScale = asteroid.baseScale * Math.max(0.45, Math.pow(liveness, 0.6));
    asteroid.scale = visualScale;
    asteroid._dirty = true;
    // Push immediate visual update
    const pool = this.pools.get(asteroid.poolKey);
    if (pool) pool.writeMatrix(asteroid.instanceIdx, asteroid.position.x, asteroid.position.y, asteroid.position.z, asteroid.rotZ, visualScale);

    // Konsumuj listę cells odłamanych w tym hicie - debris event
    const ejections = hex.consumeEjections();
    if (ejections && ejections.length > 0) {
      this.debrisEvents.push({
        asteroidId: asteroid.id,
        worldX, worldY,
        type: asteroid.type,
        size: asteroid.size,
        cells: ejections.length,
      });
    }

    asteroid.hp = Math.max(0, asteroid.hp - damage);

    if (result.destroyed) {
      const destroyResult = this._destroy(asteroid);
      return { ...destroyResult, ejectedCells: result.ejectedCells };
    }

    return {
      destroyed: false,
      ejectedCells: result.ejectedCells,
      remainingHp: asteroid.hp,
      hexBody: hex,
      hit: true,
    };
  }

  /**
   * Sprawdza kolizje statku z pobliskimi asteroidami. Aplikuje damage do obu,
   * wypycha statek z asteroidy i ustawia bounce velocity.
   *
   * @param {object} ship - { pos, vel, mass?, radius?, hp? }
   * @returns {Array} lista kolizji rozstrzygniętych w tej klatce
   */
  checkShipCollisions(ship) {
    if (!ship || !ship.pos) return null;
    const sx = ship.pos.x;
    const sy = ship.pos.y;
    const shipR = ship.radius || 30;
    // Promień zapytania: statek + max scale (BIG=1500u)
    const queryR = shipR + 1500;

    let collisions = null;
    this.spatial.forEachInRadius(sx, sy, queryR, (asteroid) => {
      if (!asteroid.alive) return;
      if (asteroid.hexEntity?.hexGrid) return;

      const dxNear = sx - asteroid.worldX;
      const dyNear = sy - asteroid.worldY;
      const asteroidR = asteroid.scale * COLLISION_CONFIG.collisionRadiusFactor;
      const promoteR = shipR + asteroidR + 180;
      if (dxNear * dxNear + dyNear * dyNear <= promoteR * promoteR) {
        const promotedEntity = this._promoteAsteroidToHex(asteroid, 'ship-near');
        if (promotedEntity?.hexGrid && ship?.hexGrid) {
          DestructorSystem.collideEntities(ship, promotedEntity, 1 / 60, true);
        }
      }

      const result = resolveShipAsteroidCollision(ship, asteroid);
      if (!result || !result.collided) return;
      const contactLen = Math.hypot(dxNear, dyNear) || 1;
      const contactX = asteroid.worldX + (dxNear / contactLen) * asteroidR;
      const contactY = asteroid.worldY + (dyNear / contactLen) * asteroidR;

      // Separuj statek z asteroidy (wypchnięcie)
      if (result.separationDx !== 0 || result.separationDy !== 0) {
        ship.pos.x += result.separationDx;
        ship.pos.y += result.separationDy;
      }
      // Nowa velocity statku (post-collision)
      if (ship.vel) {
        ship.vel.x = result.shipVx;
        ship.vel.y = result.shipVy;
      }
      // Impuls do asteroidy - dodaje delta vel, oznacza jako moving
      if (result.asteroidDvx !== 0 || result.asteroidDvy !== 0) {
        this._applyImpulseToAsteroid(asteroid, result.asteroidDvx, result.asteroidDvy);
      }

      // Damage do statku - prawidłowe ship damage API (shield → hull) z window.applyDamageToPlayer/NPC.
      // Statek ma ship.hull.val + ship.shield.val, NIE ship.hp.
      if (result.shipDamage > 0) {
        const isPlayer = ship.controller === 'player' || ship === window.ship;
        if (isPlayer && typeof window.applyDamageToPlayer === 'function') {
          window.applyDamageToPlayer(result.shipDamage);
        } else if (typeof window.applyDamageToNPC === 'function') {
          window.applyDamageToNPC(ship, result.shipDamage, 'asteroid');
        } else {
          // Fallback - bezpośrednio na shield/hull
          let dmg = result.shipDamage;
          if (ship.shield?.val > 0) {
            const taken = Math.min(ship.shield.val, dmg);
            ship.shield.val -= taken;
            dmg -= taken;
            ship.shield.regenTimer = ship.shield.regenDelay || 2.5;
          }
          if (dmg > 0 && ship.hull) {
            ship.hull.val = Math.max(0, ship.hull.val - dmg);
          }
        }
      }

      // Damage do asteroidy (przez destruktor)
      if (result.asteroidDamage > 0) {
        this.applyDamageAt(asteroid, contactX, contactY, result.asteroidDamage, ship.vel || null);
      }

      if (!collisions) collisions = [];
      collisions.push({ asteroid, ...result });
    });

    // Flush GPU update jeśli któraś asteroida ucierpiała (scale shrink przez applyDamageAt
    // ustawia pool.dirty, ale bez flush ramka nie zobaczy zmiany do następnego update).
    if (collisions) this._flushAll();

    return collisions;
  }

  /**
   * Dodaje delta-velocity do asteroidy i wpisuje ją do movingAsteroids dla per-frame
   * aktualizacji pozycji. Auto-clamp do COLLISION_CONFIG.asteroidMaxVelocity.
   */
  _applyImpulseToAsteroid(asteroid, dvx, dvy) {
    asteroid.vx = (asteroid.vx || 0) + dvx;
    asteroid.vy = (asteroid.vy || 0) + dvy;
    const speed2 = asteroid.vx * asteroid.vx + asteroid.vy * asteroid.vy;
    const maxV = COLLISION_CONFIG.asteroidMaxVelocity;
    if (speed2 > maxV * maxV) {
      const sp = Math.sqrt(speed2);
      const k = maxV / sp;
      asteroid.vx *= k;
      asteroid.vy *= k;
    }
    // Mała losowa rotacja przy pchnięciu - off-center hit naturalnie obraca skałę.
    // Bez tego asteroidy lecą bez spinu = sztucznie. Skala proporcjonalna do prędkości.
    const speed = Math.sqrt(speed2);
    if (speed > 5) {
      const spinKick = (this.rng() - 0.5) * 0.6 * Math.min(1, speed / 200);
      asteroid.spin = (asteroid.spin || 0) + spinKick;
    }
    if (asteroid.hexEntity) syncHexEntityFromAsteroid(asteroid, asteroid.hexEntity);
    this.movingAsteroids.add(asteroid);
  }

  /**
   * Per-frame: przesuwa wszystkie ruchome asteroidy, aplikuje drag, sleep gdy
   * prędkość bardzo mała. Re-hashuje w spatial gdy przekroczyły komórkę.
   * Typowo working set <100 więc per-frame koszt <0.5ms.
   */
  _updateMovingAsteroids(dt) {
    const drag = Math.pow(COLLISION_CONFIG.asteroidDrag, dt * 60); // znormalizowane do dt
    const sleepV2 = COLLISION_CONFIG.asteroidSleepVelocity * COLLISION_CONFIG.asteroidSleepVelocity;
    const toRemove = [];

    for (const a of this.movingAsteroids) {
      if (a.hexEntity) {
        syncAsteroidFromHexEntity(a, a.hexEntity);
        a.position.x = a.worldX;
        a.position.y = -a.worldY;
        this.spatial.update(a, a.worldX, a.worldY);
        toRemove.push(a);
        continue;
      }
      if (!a.alive) {
        toRemove.push(a);
        continue;
      }
      // Drag - prędkość liniowa i kątowa
      a.vx *= drag;
      a.vy *= drag;
      if (a.spin) a.spin *= drag;
      // Sleep test
      const sp2 = a.vx * a.vx + a.vy * a.vy;
      if (sp2 < sleepV2 && Math.abs(a.spin || 0) < 0.02) {
        a.vx = 0;
        a.vy = 0;
        a.spin = 0;
        toRemove.push(a);
        continue;
      }
      // Przesunięcie + rotacja
      a.worldX += a.vx * dt;
      a.worldY += a.vy * dt;
      if (a.spin) a.rotZ += a.spin * dt;
      // 3D position (3D.y = -2D.y)
      a.position.x = a.worldX;
      a.position.y = -a.worldY;
      // Re-hash w spatial jeśli przekroczyła komórkę
      this.spatial.update(a, a.worldX, a.worldY);
      if (a.hexEntity) {
        syncHexEntityFromAsteroid(a, a.hexEntity);
        continue;
      }
      // Push do GPU
      const pool = this.pools.get(a.poolKey);
      if (pool) {
        pool.writeMatrix(a.instanceIdx, a.position.x, a.position.y, a.position.z, a.rotZ, a.scale);
      }
    }

    for (const a of toRemove) this.movingAsteroids.delete(a);
  }

  /**
   * Per-frame update destruktora - przewija burst frames aktywnych hex bodies.
   * Wywoływany razem z głównym update().
   */
  updateDestructor(dt) {
    this.destructor.update(dt);
  }

  /**
   * Pobierz i wyczyść listę debris events z ostatniej klatki (do VFX).
   */
  consumeDebrisEvents() {
    if (this.debrisEvents.length === 0) return null;
    const list = this.debrisEvents.slice();
    this.debrisEvents.length = 0;
    return list;
  }

  /** Debug: statystyki destruktora. */
  destructorStats() {
    return this.destructor.stats();
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
