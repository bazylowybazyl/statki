/**
 * voxelShips3D — renderer ciał wokselowych destructor3D (odpowiednik hexShips3D).
 *
 * Wzorce przeniesione z hexShips3D.js:
 *  - jeden InstancedMesh na ciało; macierze instancji są LOKALNE (baza + deformacja),
 *    a transform świata (pozycja + kwaternion ciała) siedzi na obiekcie mesha,
 *  - renderują się wyłącznie komórki ODSŁONIĘTE (odpowiednik HYBRID LOD: brzeg +
 *    uszkodzenia) — wnętrze wolumenu nie kosztuje ani instancji, ani fill rate,
 *  - kompaktowanie widocznych instancji do wiodącego przedziału (mesh.count),
 *  - pula debris w całości animowana w shaderze (uTime), ring-buffer + dirty-span.
 *
 * Kolor komórki per instancja (aColor z wokselizacji), stres → żar (aStress).
 */

import * as THREE from 'three';
import { packKey, VOXEL_NEIGHBOR_OFFSETS } from '../game/voxelBody3D.js';

// Wygląd wokseli widocznych w ranach kadłuba pokrytego skórą.
const WOUND_BOX_SCALE = 0.70;   // mniejszy sześcian — nie wystaje ponad poszycie
const WOUND_COLOR_MUL = 0.55;   // ciemniejszy — czyta się jak konstrukcja, nie pancerz
const WOUND_INSET = 0.34;       // ułamek komórki, o który woksel chowa się pod blachę

const CELL_VERTEX_SHADER = `
attribute vec3 aColor;
attribute float aStress;

varying vec3 vColor;
varying float vStress;
varying vec3 vNormal;

void main() {
  vColor = aColor;
  vStress = aStress;
  // Macierze instancji są czystą translacją — normalna bez zmian per instancję.
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const CELL_FRAGMENT_SHADER = `
uniform vec3 uLightDirView;
uniform float uAmbient;
uniform float uDiffuse;
uniform float uStressTint;
uniform float uStressNorm;
uniform float uColorMul;

varying vec3 vColor;
varying float vStress;
varying vec3 vNormal;

void main() {
  vec3 n = normalize(vNormal);
  float ndl = max(0.0, dot(n, uLightDirView));
  float fill = max(0.0, dot(n, -uLightDirView)) * 0.12;
  // Pod skórą woksel udaje odsłoniętą konstrukcję, nie pomalowany pancerz —
  // stąd przyciemnienie względem koloru próbkowanego z tekstury kadłuba.
  vec3 col = vColor * uColorMul * (uAmbient + ndl * uDiffuse + fill);

  float stress = clamp(vStress / max(0.001, uStressNorm), 0.0, 1.0);
  col += vec3(1.0, 0.28, 0.05) * stress * uStressTint;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ===================== SKÓRA (oryginalny mesh .glb) =====================
// Trzy mechanizmy, wszystkie karmione jedną teksturą 3D pola kratownicy:
//   RGB = przesunięcie komórki względem spoczynku (zakodowane w [0,1]),
//   A   = 1.0 komórka żywa | 0.5 komórki tu nigdy nie było | 0.0 komórka zginęła.
//
// Vertex: FFD — wierzchołek zbiera trójliniowo przesunięcia 8 otaczających komórek
//         (wagi tylko z komórek ŻYWYCH, potem renormalizacja), więc wgniecenie
//         fizyki staje się prawdziwym wgnieceniem teksturowanego kadłuba.
// Fragment: maska — próbka A w komórce przypisanej wierzchołkowi; martwa → discard.
//         To 3D-owy odpowiednik `destination-out` na canvasie pancerza w 2D.
const SKIN_VERTEX_SHADER = `
attribute vec3 aCellUV;

uniform sampler3D uField;
uniform vec3 uDims;
uniform vec3 uLatticeMin;
uniform float uCellSize;
uniform float uDeformScale;
uniform float uFfd;

varying vec3 vCellUV;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vCellUV = aCellUV;
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);

  vec3 pos = position;

  if (uFfd > 0.5) {
    vec3 f = (position - uLatticeMin) / uCellSize - 0.5;
    vec3 base = floor(f);
    vec3 frac = f - base;
    vec3 disp = vec3(0.0);
    float wsum = 0.0;

    for (int i = 0; i < 8; i++) {
      vec3 o = vec3(float(i & 1), float((i / 2) & 1), float((i / 4) & 1));
      vec4 t = texture(uField, (base + o + 0.5) / uDims);
      vec3 wv = mix(1.0 - frac, frac, o);
      // step(0.75) przepuszcza wyłącznie komórki żywe (A=1.0); komórki nieistniejące
      // (A=0.5) i zniszczone (A=0.0) nie mają sensownego przesunięcia.
      float w = wv.x * wv.y * wv.z * step(0.75, t.a);
      disp += (t.rgb - 0.5) * 2.0 * w;
      wsum += w;
    }

    if (wsum > 0.001) pos += disp * (uDeformScale / wsum);
  }

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const SKIN_FRAGMENT_SHADER = `
uniform sampler3D uField;
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3 uBaseColor;
uniform vec3 uLightDirView;
uniform float uAmbient;
uniform float uDiffuse;
uniform float uInteriorDim;

varying vec3 vCellUV;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  if (texture(uField, vCellUV).a < 0.25) discard;

  vec3 base = uBaseColor;
  if (uHasMap > 0.5) base *= texture2D(uMap, vUv).rgb;

  vec3 n = normalize(vNormal);
  // Poszycie oglądane od środka (przez wyrwę) — ta sama tekstura, przyciemniona,
  // żeby wnętrze kadłuba czytało się inaczej niż zewnętrzny pancerz.
  float dim = 1.0;
  if (!gl_FrontFacing) {
    n = -n;
    dim = uInteriorDim;
  }

  float ndl = max(0.0, dot(n, uLightDirView));
  float fill = max(0.0, dot(n, -uLightDirView)) * 0.12;
  gl_FragColor = vec4(base * dim * (uAmbient + ndl * uDiffuse + fill), 1.0);
}
`;

const DEBRIS_VERTEX_SHADER = `
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aRot;    // oś xyz + prędkość kątowa w
attribute vec3 aInfo;   // birth, scale, life
attribute vec3 aColor;

uniform float uTime;

varying vec3 vColor;
varying float vAlpha;
varying vec3 vNormal;

void main() {
  float age = uTime - aInfo.x;
  float life = max(0.4, aInfo.z);
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    vColor = vec3(0.0);
    vNormal = vec3(0.0, 0.0, 1.0);
    return;
  }

  float k = 0.6;
  vec3 travel = aVel * ((1.0 - exp(-k * age)) / k);
  vec3 center = aStart + travel;

  float ang = aRot.w * age;
  vec3 ax = normalize(aRot.xyz + vec3(1e-6, 0.0, 0.0));
  float c = cos(ang);
  float s = sin(ang);
  vec3 p = position * aInfo.y;
  vec3 rotated = p * c + cross(ax, p) * s + ax * dot(ax, p) * (1.0 - c);
  vec3 rn = normal * c + cross(ax, normal) * s + ax * dot(ax, normal) * (1.0 - c);

  vAlpha = 1.0 - age / life;
  vColor = aColor;
  vNormal = normalize(normalMatrix * rn);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(center + rotated, 1.0);
}
`;

const DEBRIS_FRAGMENT_SHADER = `
uniform vec3 uLightDirView;
uniform float uAmbient;
uniform float uDiffuse;

varying vec3 vColor;
varying float vAlpha;
varying vec3 vNormal;

void main() {
  if (vAlpha <= 0.01) discard;
  vec3 n = normalize(vNormal);
  float ndl = max(0.0, dot(n, uLightDirView));
  gl_FragColor = vec4(vColor * (uAmbient + ndl * uDiffuse), vAlpha);
}
`;

const DEBRIS_MAX = 8192;
const DEBRIS_LIFE = 5.0;

function computeCellStress(cell) {
  const sx = Math.abs(cell.tx - cell.dx);
  const sy = Math.abs(cell.ty - cell.dy);
  const sz = Math.abs(cell.tz - cell.dz);
  const vel = (Math.abs(cell.vx) + Math.abs(cell.cvx) +
    Math.abs(cell.vy) + Math.abs(cell.cvy) +
    Math.abs(cell.vz) + Math.abs(cell.cvz)) * 0.18;
  const def = Math.max(sx, sy, sz) + (sx + sy + sz) * 0.2;
  return Math.max(def, vel);
}

class DebrisPool {
  constructor(scene) {
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.currentIndex = 0;
    this.lastSpawnTime = -Infinity;
    this._dirtyMin = Infinity;
    this._dirtyMax = -1;
    this._dirtyWrapped = false;

    this.startArr = new Float32Array(DEBRIS_MAX * 3);
    this.velArr = new Float32Array(DEBRIS_MAX * 3);
    this.rotArr = new Float32Array(DEBRIS_MAX * 4);
    this.infoArr = new Float32Array(DEBRIS_MAX * 3);
    this.colorArr = new Float32Array(DEBRIS_MAX * 3);

    this.geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(this.startArr, 3));
    this.geometry.setAttribute('aVel', new THREE.InstancedBufferAttribute(this.velArr, 3));
    this.geometry.setAttribute('aRot', new THREE.InstancedBufferAttribute(this.rotArr, 4));
    this.geometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(this.infoArr, 3));
    this.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.colorArr, 3));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightDirView: { value: new THREE.Vector3(0, 0, 1) },
        uAmbient: { value: 0.35 },
        uDiffuse: { value: 0.9 }
      },
      vertexShader: DEBRIS_VERTEX_SHADER,
      fragmentShader: DEBRIS_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, DEBRIS_MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, scale, nowSec) {
    const i = this.currentIndex;
    this.startArr[i * 3] = x; this.startArr[i * 3 + 1] = y; this.startArr[i * 3 + 2] = z;
    this.velArr[i * 3] = vx; this.velArr[i * 3 + 1] = vy; this.velArr[i * 3 + 2] = vz;
    const ax = Math.random() * 2 - 1, ay = Math.random() * 2 - 1, az = Math.random() * 2 - 1;
    this.rotArr[i * 4] = ax; this.rotArr[i * 4 + 1] = ay; this.rotArr[i * 4 + 2] = az;
    this.rotArr[i * 4 + 3] = (Math.random() - 0.5) * 8;
    this.infoArr[i * 3] = nowSec;
    this.infoArr[i * 3 + 1] = scale;
    this.infoArr[i * 3 + 2] = DEBRIS_LIFE * (0.6 + Math.random() * 0.4);
    this.colorArr[i * 3] = r; this.colorArr[i * 3 + 1] = g; this.colorArr[i * 3 + 2] = b;

    if (i < this._dirtyMin) this._dirtyMin = i;
    if (i > this._dirtyMax) this._dirtyMax = i;
    this.lastSpawnTime = nowSec;
    this.currentIndex = (this.currentIndex + 1) % DEBRIS_MAX;
    if (this.currentIndex === 0) this._dirtyWrapped = true;
    if (this.mesh.count < DEBRIS_MAX) this.mesh.count++;
  }

  commit(nowSec) {
    // wszystkie wygasły → wyzeruj pulę, żeby nie mielić martwych instancji
    if (this.mesh.count > 0 && (nowSec - this.lastSpawnTime) > DEBRIS_LIFE + 0.5) {
      this.mesh.count = 0;
      this.currentIndex = 0;
    }
    if (this._dirtyMax < this._dirtyMin && !this._dirtyWrapped) return;
    const start = this._dirtyWrapped ? 0 : this._dirtyMin;
    const count = this._dirtyWrapped ? DEBRIS_MAX : (this._dirtyMax - this._dirtyMin + 1);
    const apply = (name, stride) => {
      const attr = this.geometry.getAttribute(name);
      if (typeof attr.clearUpdateRanges === 'function') {
        attr.clearUpdateRanges();
        attr.addUpdateRange(start * stride, count * stride);
      }
      attr.needsUpdate = true;
    };
    apply('aStart', 3);
    apply('aVel', 3);
    apply('aRot', 4);
    apply('aInfo', 3);
    apply('aColor', 3);
    this._dirtyMin = Infinity;
    this._dirtyMax = -1;
    this._dirtyWrapped = false;
  }

  dispose(scene) {
    if (scene && this.mesh) scene.remove(this.mesh);
    this.geometry?.dispose?.();
    this.material?.dispose?.();
  }
}

// Kodowanie kanału A pola kratownicy — patrz komentarz przy SKIN_VERTEX_SHADER.
const FIELD_ALIVE = 255;
const FIELD_NEVER = 128;
const FIELD_GONE = 0;

export const VoxelShips3D = {
  scene: null,
  bodyMeshes: new Map(),
  debris: null,
  lightDirWorld: new THREE.Vector3(0.35, 0.8, 0.5).normalize(),
  _lightDirView: new THREE.Vector3(),
  _lastTimeSec: 0,
  skinEnabled: true,
  ffdEnabled: true,
  voxelsEnabled: true,
  stats: { bodies: 0, instances: 0, cells: 0, skinTriangles: 0 },

  init(scene) {
    this.scene = scene;
    if (!this.debris) this.debris = new DebrisPool(scene);
    return this;
  },

  // Geometria skóry powstaje RAZ na model i jest współdzielona przez rodzica
  // i wszystkie jego wraki — każde ciało różni się tylko własną teksturą pola.
  _ensureSkinGeometries(skin) {
    if (skin._gpu) return skin._gpu;
    const attrCache = new Map();
    skin._gpu = skin.parts.map((part) => {
      let shared = attrCache.get(part.positions);
      if (!shared) {
        shared = {
          position: new THREE.BufferAttribute(part.positions, 3),
          normal: new THREE.BufferAttribute(part.normals, 3),
          uv: new THREE.BufferAttribute(part.uvs, 2),
          cell: new THREE.BufferAttribute(part.cellUV, 3)
        };
        attrCache.set(part.positions, shared);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', shared.position);
      geometry.setAttribute('normal', shared.normal);
      geometry.setAttribute('uv', shared.uv);
      geometry.setAttribute('aCellUV', shared.cell);
      geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
      return { geometry, material: part.material };
    });
    return skin._gpu;
  },

  _createBodySkin(body) {
    const skin = body.skin;
    const gpuParts = this._ensureSkinGeometries(skin);
    const dims = skin.dims;
    const texels = dims.x * dims.y * dims.z;

    // Wzorzec pola: RGB neutralne (zerowe przesunięcie), A = „zginęła" dla komórek
    // pierwotnie istniejących i „nigdy nie istniała" dla reszty. Każda aktualizacja
    // kopiuje wzorzec i dopisuje wyłącznie komórki żywe TEGO ciała.
    if (!skin._baseField) {
      const base = new Uint8Array(texels * 4);
      for (let i = 0; i < texels; i++) {
        base[i * 4] = 128;
        base[i * 4 + 1] = 128;
        base[i * 4 + 2] = 128;
        base[i * 4 + 3] = skin.occupancy[i] ? FIELD_GONE : FIELD_NEVER;
      }
      skin._baseField = base;
    }

    const data = new Uint8Array(texels * 4);
    const texture = new THREE.Data3DTexture(data, dims.x, dims.y, dims.z);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    const cfg = body.config;
    const grid = body.grid;
    // Zapas ×1.5 nad maxDeform: pieczenie plastyczne potrafi skumulować przesunięcie
    // większe niż pojedyncze wgniecenie, a saturacja kodowania wygląda jak zerwanie.
    const deformScale = Math.max(1e-3, (cfg?.maxDeform || grid.cellSize * 7) * 1.5);
    const meshes = [];
    const materials = [];

    for (const gp of gpuParts) {
      const map = gp.material?.map || null;
      const color = gp.material?.color;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uField: { value: texture },
          uMap: { value: map },
          uHasMap: { value: map ? 1 : 0 },
          uBaseColor: { value: new THREE.Vector3(color?.r ?? 0.75, color?.g ?? 0.76, color?.b ?? 0.78) },
          uDims: { value: new THREE.Vector3(dims.x, dims.y, dims.z) },
          uLatticeMin: { value: new THREE.Vector3(grid.skinLatticeMin.x, grid.skinLatticeMin.y, grid.skinLatticeMin.z) },
          uCellSize: { value: grid.cellSize },
          uDeformScale: { value: deformScale },
          uFfd: { value: this.ffdEnabled ? 1 : 0 },
          uLightDirView: { value: new THREE.Vector3(0, 0, 1) },
          uAmbient: { value: 0.34 },
          uDiffuse: { value: 0.95 },
          uInteriorDim: { value: 0.45 }
        },
        vertexShader: SKIN_VERTEX_SHADER,
        fragmentShader: SKIN_FRAGMENT_SHADER,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(gp.geometry, material);
      mesh.frustumCulled = false; // FFD przesuwa wierzchołki poza policzoną sferę
      this.scene.add(mesh);
      meshes.push(mesh);
      materials.push(material);
    }

    return {
      meshes,
      materials,
      texture,
      data,
      base: skin._baseField,
      dims,
      deformScale,
      fieldDirty: true
    };
  },

  _updateSkinField(body, sd) {
    const data = sd.data;
    data.set(sd.base);

    const nx = sd.dims.x;
    const nxy = sd.dims.x * sd.dims.y;
    const invScale = 1 / sd.deformScale;

    for (const cell of body.grid.cells) {
      if (!cell.active) continue;
      const o = (cell.ix + cell.iy * nx + cell.iz * nxy) * 4;
      // Przesunięcie względem spoczynku = zapieczona plastyczność + deformacja wizualna.
      // Różnica (g + d) − o jest niewrażliwa na recentrowanie fragmentu przy rozłamie,
      // więc ta sama skóra pasuje do rodzica i do każdego wraka.
      let vx = ((cell.gx + cell.dx) - cell.ox) * invScale;
      let vy = ((cell.gy + cell.dy) - cell.oy) * invScale;
      let vz = ((cell.gz + cell.dz) - cell.oz) * invScale;
      if (vx < -1) vx = -1; else if (vx > 1) vx = 1;
      if (vy < -1) vy = -1; else if (vy > 1) vy = 1;
      if (vz < -1) vz = -1; else if (vz > 1) vz = 1;
      data[o] = (vx * 127.5 + 127.5) | 0;
      data[o + 1] = (vy * 127.5 + 127.5) | 0;
      data[o + 2] = (vz * 127.5 + 127.5) | 0;
      data[o + 3] = FIELD_ALIVE;
    }

    sd.texture.needsUpdate = true;
  },

  setLightDir(x, y, z) {
    this.lightDirWorld.set(x, y, z).normalize();
  },

  spawnDebris(x, y, z, vx, vy, vz, r, g, b, scale) {
    this.debris?.spawn(x, y, z, vx, vy, vz, r, g, b, scale, this._lastTimeSec);
  },

  _createBodyMesh(body) {
    const grid = body.grid;
    const capacity = grid.cells.length;
    if (capacity <= 0) return null;
    const cs = grid.cellSize;

    // Ciało bez skóry (np. proceduralny taran) to CAŁY jego wygląd — sześciany
    // muszą stykać się bokami. Pod skórą jest odwrotnie: powierzchnia poszycia
    // biegnie ŚRODKIEM komórki, więc pełnowymiarowy sześcian wystawałby pół
    // komórki ponad blachę i wyglądał jak klocek doklejony do kadłuba.
    const boxScale = body.skin ? WOUND_BOX_SCALE : 1.02;
    const geometry = new THREE.BoxGeometry(cs * boxScale, cs * boxScale, cs * boxScale);
    const colorArr = new Float32Array(capacity * 3);
    const stressArr = new Float32Array(capacity);
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colorArr, 3));
    geometry.setAttribute('aStress', new THREE.InstancedBufferAttribute(stressArr, 1));

    const cfg = body.config;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uLightDirView: { value: new THREE.Vector3(0, 0, 1) },
        uAmbient: { value: 0.32 },
        uDiffuse: { value: 0.95 },
        uStressTint: { value: 1.0 },
        uStressNorm: { value: Math.max(0.001, (cfg?.tearThreshold || cs * 2.5) * 0.6) },
        uColorMul: { value: body.skin ? WOUND_COLOR_MUL : 1.0 }
      },
      vertexShader: CELL_VERTEX_SHADER,
      fragmentShader: CELL_FRAGMENT_SHADER
    });

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    geometry.getAttribute('aColor').setUsage(THREE.DynamicDrawUsage);
    geometry.getAttribute('aStress').setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);

    const data = {
      mesh,
      capacity,
      cellsRef: grid.cells,
      renderedCount: 0,
      needsRefresh: true
    };
    this.bodyMeshes.set(body, data);
    return data;
  },

  _refreshInstances(body, data) {
    const grid = body.grid;
    const cells = grid.cells;
    // Ze skórą pokazujemy TYLKO rany: komórkę, która straciła sąsiada obecnego
    // w nietkniętej bryle. Zwykła powierzchnia kadłuba (nbrBase < 6) jest zakryta
    // meshem, więc nie kosztuje ani instancji, ani z-fightingu z poszyciem.
    const woundOnly = !!body.skin && this.skinEnabled;
    const lattice = grid.lattice;
    const cellSize = grid.cellSize;
    const mesh = data.mesh;
    const instArr = mesh.instanceMatrix.array;
    const colorAttr = mesh.geometry.getAttribute('aColor');
    const stressAttr = mesh.geometry.getAttribute('aStress');
    const colorArr = colorAttr.array;
    const stressArr = stressAttr.array;

    // Kompaktowanie: tylko komórki ODSŁONIĘTE trafiają do wiodącego przedziału.
    let write = 0;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell.active) continue;

      let alive = 0;
      const nbs = cell.neighbors;
      for (let n = 0; n < nbs.length; n++) if (nbs[n].active) alive++;
      if (alive >= (woundOnly ? cell.nbrBase : 6)) continue;

      // Wsuń woksel pod poszycie wzdłuż lokalnej normalnej (kierunek brakujących
      // sąsiadów = „na zewnątrz"). Bez tego sześcian siedzi środkiem na powierzchni
      // kadłuba i połowa jego objętości sterczy nad blachą.
      let insetX = 0, insetY = 0, insetZ = 0;
      if (woundOnly) {
        let outX = 0, outY = 0, outZ = 0;
        for (let k = 0; k < VOXEL_NEIGHBOR_OFFSETS.length; k++) {
          const dir = VOXEL_NEIGHBOR_OFFSETS[k];
          const n = lattice.get(packKey(cell.ix + dir[0], cell.iy + dir[1], cell.iz + dir[2]));
          if (!n || !n.active) { outX += dir[0]; outY += dir[1]; outZ += dir[2]; }
        }
        const len = Math.sqrt(outX * outX + outY * outY + outZ * outZ);
        if (len > 1e-6) {
          const s = (WOUND_INSET * cellSize) / len;
          insetX = -outX * s;
          insetY = -outY * s;
          insetZ = -outZ * s;
        }
      }

      const o = write * 16;
      instArr[o + 0] = 1; instArr[o + 1] = 0; instArr[o + 2] = 0; instArr[o + 3] = 0;
      instArr[o + 4] = 0; instArr[o + 5] = 1; instArr[o + 6] = 0; instArr[o + 7] = 0;
      instArr[o + 8] = 0; instArr[o + 9] = 0; instArr[o + 10] = 1; instArr[o + 11] = 0;
      instArr[o + 12] = cell.gx + cell.dx + insetX;
      instArr[o + 13] = cell.gy + cell.dy + insetY;
      instArr[o + 14] = cell.gz + cell.dz + insetZ;
      instArr[o + 15] = 1;

      colorArr[write * 3] = cell.r;
      colorArr[write * 3 + 1] = cell.g;
      colorArr[write * 3 + 2] = cell.b;
      stressArr[write] = computeCellStress(cell);
      write++;
    }

    mesh.count = write;
    data.renderedCount = write;
    mesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
    stressAttr.needsUpdate = true;
  },

  sync(bodies, camera, nowSec) {
    if (!this.scene) return;
    this._lastTimeSec = nowSec;
    this._lightDirView.copy(this.lightDirWorld).transformDirection(camera.matrixWorldInverse);

    this.stats.bodies = 0;
    this.stats.instances = 0;
    this.stats.cells = 0;
    this.stats.skinTriangles = 0;

    const seen = new Set();
    for (const body of bodies) {
      if (!body || body.dead || !body.grid || body.grid.activeCount <= 0) continue;
      seen.add(body);

      let data = this.bodyMeshes.get(body);
      if (data && (data.capacity < body.grid.cells.length)) {
        // po splicie głównego ciała cells może się wymienić — pojemność rośnie tylko przy rebuildzie
        this._disposeBodyMesh(body, data);
        data = null;
      }
      if (!data) data = this._createBodyMesh(body);
      if (!data) continue;

      if (data.cellsRef !== body.grid.cells) {
        data.cellsRef = body.grid.cells;
        data.needsRefresh = true;
      }
      // Przełącznik skóry zmienia regułę widoczności wokseli — wymuś przebudowę.
      if (data.skinModeApplied !== this.skinEnabled) {
        data.skinModeApplied = this.skinEnabled;
        data.needsRefresh = true;
      }

      // meshDirty karmi DWA konsumenty (instancje wokseli i pole skóry),
      // więc flagę czytamy raz i zerujemy dopiero po obsłużeniu obu.
      const gridDirty = body.grid.meshDirty;
      if (gridDirty || data.needsRefresh) {
        this._refreshInstances(body, data);
        data.needsRefresh = false;
      }

      const mesh = data.mesh;
      // Warstwę wokseli można zgasić tylko tam, gdzie zastępuje ją skóra —
      // ciało bez modelu (taran) zniknęłoby wtedy ze sceny całkowicie.
      mesh.visible = this.voxelsEnabled || !(body.skin && this.skinEnabled);
      mesh.position.set(body.pos.x, body.pos.y, body.pos.z);
      mesh.quaternion.set(body.quat.x, body.quat.y, body.quat.z, body.quat.w);
      mesh.material.uniforms.uLightDirView.value.copy(this._lightDirView);

      if (body.skin) {
        if (!data.skin) data.skin = this._createBodySkin(body);
        const sd = data.skin;
        if (gridDirty || sd.fieldDirty) {
          this._updateSkinField(body, sd);
          sd.fieldDirty = false;
        }
        for (let i = 0; i < sd.meshes.length; i++) {
          const sm = sd.meshes[i];
          sm.visible = this.skinEnabled;
          sm.position.set(body.pos.x, body.pos.y, body.pos.z);
          sm.quaternion.set(body.quat.x, body.quat.y, body.quat.z, body.quat.w);
          const u = sd.materials[i].uniforms;
          u.uLightDirView.value.copy(this._lightDirView);
          u.uFfd.value = this.ffdEnabled ? 1 : 0;
        }
        if (this.skinEnabled) this.stats.skinTriangles += body.skin.triangleCount;
      }

      body.grid.meshDirty = false;

      this.stats.bodies++;
      this.stats.instances += data.renderedCount;
      this.stats.cells += body.grid.activeCount;
    }

    // sprzątanie meshy ciał martwych/usuniętych
    for (const [body, data] of this.bodyMeshes) {
      if (!seen.has(body)) this._disposeBodyMesh(body, data);
    }

    if (this.debris) {
      this.debris.commit(nowSec);
      this.debris.material.uniforms.uTime.value = nowSec;
      this.debris.material.uniforms.uLightDirView.value.copy(this._lightDirView);
    }
  },

  _disposeBodyMesh(body, data) {
    if (!data) return;
    if (this.scene && data.mesh) this.scene.remove(data.mesh);
    data.mesh?.geometry?.dispose?.();
    data.mesh?.material?.dispose?.();
    if (data.skin) {
      // Geometria skóry jest WSPÓŁDZIELONA z wrakami — zwalniamy tylko to,
      // co należy do tego ciała: materiały i jego własną teksturę pola.
      for (const sm of data.skin.meshes) this.scene?.remove(sm);
      for (const mat of data.skin.materials) mat.dispose?.();
      data.skin.texture?.dispose?.();
      data.skin = null;
    }
    this.bodyMeshes.delete(body);
  },

  // Zwalnia geometrię skóry współdzieloną przez rodzica i wraki. Wołane przy
  // przebudowie sceny, nigdy przy usuwaniu pojedynczego ciała.
  disposeSkinAssets(skin) {
    if (!skin?._gpu) return;
    for (const gp of skin._gpu) gp.geometry?.dispose?.();
    skin._gpu = null;
    skin._baseField = null;
  },

  dispose() {
    for (const [body, data] of this.bodyMeshes) this._disposeBodyMesh(body, data);
    this.bodyMeshes.clear();
    if (this.debris) {
      this.debris.dispose(this.scene);
      this.debris = null;
    }
    this.scene = null;
  }
};
