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

varying vec3 vColor;
varying float vStress;
varying vec3 vNormal;

void main() {
  vec3 n = normalize(vNormal);
  float ndl = max(0.0, dot(n, uLightDirView));
  float fill = max(0.0, dot(n, -uLightDirView)) * 0.12;
  vec3 col = vColor * (uAmbient + ndl * uDiffuse + fill);

  float stress = clamp(vStress / max(0.001, uStressNorm), 0.0, 1.0);
  col += vec3(1.0, 0.28, 0.05) * stress * uStressTint;

  gl_FragColor = vec4(col, 1.0);
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

export const VoxelShips3D = {
  scene: null,
  bodyMeshes: new Map(),
  debris: null,
  lightDirWorld: new THREE.Vector3(0.35, 0.8, 0.5).normalize(),
  _lightDirView: new THREE.Vector3(),
  _lastTimeSec: 0,
  stats: { bodies: 0, instances: 0, cells: 0 },

  init(scene) {
    this.scene = scene;
    if (!this.debris) this.debris = new DebrisPool(scene);
    return this;
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

    const geometry = new THREE.BoxGeometry(cs * 1.02, cs * 1.02, cs * 1.02);
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
        uStressNorm: { value: Math.max(0.001, (cfg?.tearThreshold || cs * 2.5) * 0.6) }
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

      // odsłonięta = ma mniej niż 6 żywych sąsiadów (test inline — bez mutacji fizyki)
      let alive = 0;
      const nbs = cell.neighbors;
      for (let n = 0; n < nbs.length; n++) if (nbs[n].active) alive++;
      if (alive >= 6) continue;

      const o = write * 16;
      instArr[o + 0] = 1; instArr[o + 1] = 0; instArr[o + 2] = 0; instArr[o + 3] = 0;
      instArr[o + 4] = 0; instArr[o + 5] = 1; instArr[o + 6] = 0; instArr[o + 7] = 0;
      instArr[o + 8] = 0; instArr[o + 9] = 0; instArr[o + 10] = 1; instArr[o + 11] = 0;
      instArr[o + 12] = cell.gx + cell.dx;
      instArr[o + 13] = cell.gy + cell.dy;
      instArr[o + 14] = cell.gz + cell.dz;
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
      if (body.grid.meshDirty || data.needsRefresh) {
        this._refreshInstances(body, data);
        body.grid.meshDirty = false;
        data.needsRefresh = false;
      }

      const mesh = data.mesh;
      mesh.position.set(body.pos.x, body.pos.y, body.pos.z);
      mesh.quaternion.set(body.quat.x, body.quat.y, body.quat.z, body.quat.w);
      mesh.material.uniforms.uLightDirView.value.copy(this._lightDirView);

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
    this.bodyMeshes.delete(body);
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
