/**
 * beamShips3D — renderer ciał węzłowo-belkowych (destructorBeams3D).
 *
 * Trzy warstwy, każda z inną rolą:
 *  1. SKÓRA — oryginalny mesh .glb, jedzie po polu deformacji węzłów (FFD)
 *     i znika tam, gdzie węzeł zginął. Identyczna zasada jak w voxelShips3D.
 *  2. BELKI — linie kolorowane typem i naprężeniem. Nie wymagają żadnej logiki
 *     widoczności: leżą wewnątrz kadłuba, więc bufor głębi chowa je za skórą,
 *     a przez wyrwę widać je same. To jest podgląd konstrukcji rodem z BeamNG.
 *  3. WĘZŁY — małe sześciany, głównie dla ciał BEZ modelu (wtedy siatka belek
 *     i węzłów jest całym ich wyglądem).
 */

import * as THREE from 'three';
import { BEAM_TYPE } from '../game/beamBody3D.js';

const FIELD_ALIVE = 255;
const FIELD_NEVER = 128;
const FIELD_GONE = 0;

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
  float dim = 1.0;
  if (!gl_FrontFacing) { n = -n; dim = uInteriorDim; }

  float ndl = max(0.0, dot(n, uLightDirView));
  float fill = max(0.0, dot(n, -uLightDirView)) * 0.12;
  gl_FragColor = vec4(base * dim * (uAmbient + ndl * uDiffuse + fill), 1.0);
}
`;

const NODE_VERTEX_SHADER = `
attribute vec3 aColor;
varying vec3 vColor;
varying vec3 vNormal;
void main() {
  vColor = aColor;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const NODE_FRAGMENT_SHADER = `
uniform vec3 uLightDirView;
uniform float uAmbient;
uniform float uDiffuse;
varying vec3 vColor;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  float ndl = max(0.0, dot(n, uLightDirView));
  gl_FragColor = vec4(vColor * (uAmbient + ndl * uDiffuse), 1.0);
}
`;

// Kolory bazowe belek wg roli konstrukcyjnej — od razu widać, gdzie jest
// poszycie, a gdzie nośny szkielet.
const BEAM_BASE_COLORS = {
  [BEAM_TYPE.PLATING]: [0.42, 0.52, 0.62],
  [BEAM_TYPE.INTERIOR]: [0.34, 0.38, 0.44],
  [BEAM_TYPE.FRAME]: [0.95, 0.62, 0.22],
  [BEAM_TYPE.BULKHEAD]: [0.25, 0.85, 0.80]
};

const DEBRIS_MAX = 6144;
const DEBRIS_LIFE = 5.0;

const DEBRIS_VERTEX_SHADER = `
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aRot;
attribute vec3 aInfo;
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
    vAlpha = 0.0; vColor = vec3(0.0); vNormal = vec3(0.0, 0.0, 1.0);
    return;
  }
  float k = 0.6;
  vec3 center = aStart + aVel * ((1.0 - exp(-k * age)) / k);
  float ang = aRot.w * age;
  vec3 ax = normalize(aRot.xyz + vec3(1e-6, 0.0, 0.0));
  float c = cos(ang), s = sin(ang);
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

class DebrisPool {
  constructor(scene) {
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.currentIndex = 0;
    this.lastSpawnTime = -Infinity;
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
    this._dirty = false;
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, scale, nowSec) {
    const i = this.currentIndex;
    this.startArr[i * 3] = x; this.startArr[i * 3 + 1] = y; this.startArr[i * 3 + 2] = z;
    this.velArr[i * 3] = vx; this.velArr[i * 3 + 1] = vy; this.velArr[i * 3 + 2] = vz;
    this.rotArr[i * 4] = Math.random() * 2 - 1;
    this.rotArr[i * 4 + 1] = Math.random() * 2 - 1;
    this.rotArr[i * 4 + 2] = Math.random() * 2 - 1;
    this.rotArr[i * 4 + 3] = (Math.random() - 0.5) * 7;
    this.infoArr[i * 3] = nowSec;
    this.infoArr[i * 3 + 1] = scale;
    this.infoArr[i * 3 + 2] = DEBRIS_LIFE * (0.6 + Math.random() * 0.4);
    this.colorArr[i * 3] = r; this.colorArr[i * 3 + 1] = g; this.colorArr[i * 3 + 2] = b;
    this.lastSpawnTime = nowSec;
    this.currentIndex = (this.currentIndex + 1) % DEBRIS_MAX;
    if (this.mesh.count < DEBRIS_MAX) this.mesh.count++;
    this._dirty = true;
  }

  commit(nowSec) {
    if (this.mesh.count > 0 && (nowSec - this.lastSpawnTime) > DEBRIS_LIFE + 0.5) {
      this.mesh.count = 0;
      this.currentIndex = 0;
    }
    if (!this._dirty) return;
    for (const name of ['aStart', 'aVel', 'aRot', 'aInfo', 'aColor']) {
      this.geometry.getAttribute(name).needsUpdate = true;
    }
    this._dirty = false;
  }

  dispose(scene) {
    if (scene && this.mesh) scene.remove(this.mesh);
    this.geometry?.dispose?.();
    this.material?.dispose?.();
  }
}

export const BeamShips3D = {
  scene: null,
  bodyData: new Map(),
  debris: null,
  lightDirWorld: new THREE.Vector3(0.35, 0.8, 0.5).normalize(),
  _lightDirView: new THREE.Vector3(),
  _lastTimeSec: 0,
  skinEnabled: true,
  ffdEnabled: true,
  beamsEnabled: false,
  nodesEnabled: false,
  stats: { bodies: 0, nodes: 0, beams: 0, brokenBeams: 0, skinTriangles: 0 },

  init(scene) {
    this.scene = scene;
    if (!this.debris) this.debris = new DebrisPool(scene);
    return this;
  },

  setLightDir(x, y, z) { this.lightDirWorld.set(x, y, z).normalize(); },

  spawnDebris(x, y, z, vx, vy, vz, r, g, b, scale) {
    this.debris?.spawn(x, y, z, vx, vy, vz, r, g, b, scale, this._lastTimeSec);
  },

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

  _createBodyData(body) {
    const data = { skin: null, beamLines: null, nodeMesh: null, beamCapacity: 0 };

    // --- warstwa węzłów ---
    const cs = body.cellSize;
    const nodeGeo = new THREE.BoxGeometry(cs * 0.4, cs * 0.4, cs * 0.4);
    const nodeColors = new Float32Array(body.nodes.length * 3);
    nodeGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(nodeColors, 3));
    const nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uLightDirView: { value: new THREE.Vector3(0, 0, 1) },
        uAmbient: { value: 0.35 },
        uDiffuse: { value: 0.9 }
      },
      vertexShader: NODE_VERTEX_SHADER,
      fragmentShader: NODE_FRAGMENT_SHADER
    });
    const nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, body.nodes.length);
    nodeMesh.frustumCulled = false;
    nodeMesh.count = 0;
    nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nodeGeo.getAttribute('aColor').setUsage(THREE.DynamicDrawUsage);
    this.scene.add(nodeMesh);
    data.nodeMesh = nodeMesh;

    // --- warstwa belek ---
    const cap = body.beams.length;
    const linePos = new Float32Array(cap * 6);
    const lineCol = new Float32Array(cap * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setDrawRange(0, 0);
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    this.scene.add(lines);
    data.beamLines = lines;
    data.beamCapacity = cap;

    // --- skóra ---
    if (body.skin) data.skin = this._createBodySkin(body);

    this.bodyData.set(body, data);
    return data;
  },

  _createBodySkin(body) {
    const skin = body.skin;
    const gpuParts = this._ensureSkinGeometries(skin);
    const dims = skin.dims;
    const texels = dims.x * dims.y * dims.z;

    if (!skin._baseField) {
      const base = new Uint8Array(texels * 4);
      for (let i = 0; i < texels; i++) {
        base[i * 4] = 128; base[i * 4 + 1] = 128; base[i * 4 + 2] = 128;
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

    const deformScale = Math.max(1e-3, body.cellSize * 8);
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
          uLatticeMin: { value: new THREE.Vector3(body.skinLatticeMin.x, body.skinLatticeMin.y, body.skinLatticeMin.z) },
          uCellSize: { value: body.cellSize },
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
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      meshes.push(mesh);
      materials.push(material);
    }
    return { meshes, materials, texture, data, base: skin._baseField, dims, deformScale };
  },

  _updateSkinField(body, sd) {
    const data = sd.data;
    data.set(sd.base);
    const nx = sd.dims.x;
    const nxy = sd.dims.x * sd.dims.y;
    const invScale = 1 / sd.deformScale;

    for (const n of body.nodes) {
      if (!n.active) continue;
      const o = (n.ix + n.iy * nx + n.iz * nxy) * 4;
      let vx = (n.x - n.ox) * invScale;
      let vy = (n.y - n.oy) * invScale;
      let vz = (n.z - n.oz) * invScale;
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

  _updateBeamLines(body, data) {
    const lines = data.beamLines;
    const posAttr = lines.geometry.getAttribute('position');
    const colAttr = lines.geometry.getAttribute('color');
    const pos = posAttr.array;
    const col = colAttr.array;
    const nodes = body.nodes;
    let w = 0;
    let broken = 0;

    for (const beam of body.beams) {
      if (beam.broken) { broken++; continue; }
      const a = nodes[beam.a];
      const c = nodes[beam.b];
      if (!a.active || !c.active) continue;

      pos[w * 6] = a.x; pos[w * 6 + 1] = a.y; pos[w * 6 + 2] = a.z;
      pos[w * 6 + 3] = c.x; pos[w * 6 + 4] = c.y; pos[w * 6 + 5] = c.z;

      const base = BEAM_BASE_COLORS[beam.type] || BEAM_BASE_COLORS[BEAM_TYPE.PLATING];
      // Naprężenie przesuwa kolor ku czerwieni — belka bliska zerwania świeci.
      const s = Math.min(1, Math.abs(beam.strain) / Math.max(1e-4, beam.break));
      const r = base[0] + (1 - base[0]) * s;
      const g = base[1] * (1 - s * 0.75);
      const b = base[2] * (1 - s * 0.9);
      for (let v = 0; v < 2; v++) {
        col[w * 6 + v * 3] = r;
        col[w * 6 + v * 3 + 1] = g;
        col[w * 6 + v * 3 + 2] = b;
      }
      w++;
    }

    lines.geometry.setDrawRange(0, w * 2);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    data.liveBeamsDrawn = w;
    data.brokenBeams = broken;
  },

  _updateNodes(body, data) {
    const mesh = data.nodeMesh;
    const arr = mesh.instanceMatrix.array;
    const colAttr = mesh.geometry.getAttribute('aColor');
    const col = colAttr.array;
    let w = 0;
    for (const n of body.nodes) {
      if (!n.active) continue;
      const o = w * 16;
      arr[o + 0] = 1; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = 1; arr[o + 11] = 0;
      arr[o + 12] = n.x; arr[o + 13] = n.y; arr[o + 14] = n.z; arr[o + 15] = 1;
      col[w * 3] = n.r; col[w * 3 + 1] = n.g; col[w * 3 + 2] = n.b;
      w++;
    }
    mesh.count = w;
    mesh.instanceMatrix.needsUpdate = true;
    colAttr.needsUpdate = true;
  },

  sync(bodies, camera, nowSec) {
    if (!this.scene) return;
    this._lastTimeSec = nowSec;
    this._lightDirView.copy(this.lightDirWorld).transformDirection(camera.matrixWorldInverse);

    this.stats.bodies = 0;
    this.stats.nodes = 0;
    this.stats.beams = 0;
    this.stats.brokenBeams = 0;
    this.stats.skinTriangles = 0;

    const seen = new Set();
    for (const body of bodies) {
      if (!body || body.dead || body.activeNodes <= 0) continue;
      seen.add(body);

      let data = this.bodyData.get(body);
      if (data && data.beamCapacity < body.beams.length) {
        this._disposeBodyData(body, data);
        data = null;
      }
      if (!data) data = this._createBodyData(body);

      const hasSkin = !!(body.skin && this.skinEnabled);
      // Bez skóry siatka belek i węzłów jest jedynym wyglądem ciała — nie wolno
      // jej wtedy zgasić, nawet gdy podgląd konstrukcji jest wyłączony.
      const showBeams = this.beamsEnabled || !hasSkin;
      const showNodes = this.nodesEnabled || !hasSkin;

      if (body.meshDirty) {
        if (showBeams) this._updateBeamLines(body, data);
        if (showNodes) this._updateNodes(body, data);
        if (data.skin) this._updateSkinField(body, data.skin);
        body.meshDirty = false;
      }

      const px = body.pos.x, py = body.pos.y, pz = body.pos.z;
      const q = body.quat;

      data.beamLines.visible = showBeams;
      data.beamLines.position.set(px, py, pz);
      data.beamLines.quaternion.set(q.x, q.y, q.z, q.w);

      data.nodeMesh.visible = showNodes;
      data.nodeMesh.position.set(px, py, pz);
      data.nodeMesh.quaternion.set(q.x, q.y, q.z, q.w);
      data.nodeMesh.material.uniforms.uLightDirView.value.copy(this._lightDirView);

      if (data.skin) {
        for (let i = 0; i < data.skin.meshes.length; i++) {
          const sm = data.skin.meshes[i];
          sm.visible = this.skinEnabled;
          sm.position.set(px, py, pz);
          sm.quaternion.set(q.x, q.y, q.z, q.w);
          const u = data.skin.materials[i].uniforms;
          u.uLightDirView.value.copy(this._lightDirView);
          u.uFfd.value = this.ffdEnabled ? 1 : 0;
        }
        if (this.skinEnabled) this.stats.skinTriangles += body.skin.triangleCount;
      }

      this.stats.bodies++;
      this.stats.nodes += body.activeNodes;
      this.stats.beams += body.liveBeams;
      this.stats.brokenBeams += (body.beams.length - body.liveBeams);
    }

    for (const [body, data] of this.bodyData) {
      if (!seen.has(body)) this._disposeBodyData(body, data);
    }

    if (this.debris) {
      this.debris.commit(nowSec);
      this.debris.material.uniforms.uTime.value = nowSec;
      this.debris.material.uniforms.uLightDirView.value.copy(this._lightDirView);
    }
  },

  _disposeBodyData(body, data) {
    if (!data) return;
    if (data.beamLines) {
      this.scene?.remove(data.beamLines);
      data.beamLines.geometry?.dispose?.();
      data.beamLines.material?.dispose?.();
    }
    if (data.nodeMesh) {
      this.scene?.remove(data.nodeMesh);
      data.nodeMesh.geometry?.dispose?.();
      data.nodeMesh.material?.dispose?.();
    }
    if (data.skin) {
      for (const sm of data.skin.meshes) this.scene?.remove(sm);
      for (const mat of data.skin.materials) mat.dispose?.();
      data.skin.texture?.dispose?.();
    }
    this.bodyData.delete(body);
  },

  disposeSkinAssets(skin) {
    if (!skin?._gpu) return;
    for (const gp of skin._gpu) gp.geometry?.dispose?.();
    skin._gpu = null;
    skin._baseField = null;
  },

  dispose() {
    for (const [body, data] of this.bodyData) this._disposeBodyData(body, data);
    this.bodyData.clear();
    if (this.debris) {
      this.debris.dispose(this.scene);
      this.debris = null;
    }
    this.scene = null;
  }
};
