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
import { prepareSkinChunks, selectSkinChunk } from './beamSkinChunks3D.js';
import { prepareSkinSurface, createSurfaceState, updateSurfaceState, writeTearRims } from './beamSkinSurface3D.js';

const FIELD_ALIVE = 255;
const FIELD_NEVER = 128;
const FIELD_GONE = 0;

const SKIN_VERTEX_SHADER = `
attribute vec3 aCellUV;
attribute vec3 aShellOffset;

uniform sampler3D uField;
uniform sampler3D uLinks;
uniform float uTopology;
uniform vec3 uDims;
uniform vec3 uLatticeMin;
uniform vec3 uBodyOffset;
uniform float uCellSize;
uniform float uDeformScale;
uniform float uFfd;

varying vec3 vCellUV;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vRestPosition;
varying float vDent;

void main() {
  vCellUV = aCellUV;
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);

  vec3 pos = position + uBodyOffset + aShellOffset;
  vRestPosition = position + aShellOffset;
  vDent = 0.0;
  if (uFfd > 0.5) {
    vec4 anchor = texture(uField, aCellUV);
    vec3 anchorDisp = (anchor.rgb * 255.0 - 128.0) / 127.0;
    vec3 anchorCell = floor(aCellUV * uDims);
    vec4 links = floor(texture(uLinks, aCellUV) * 255.0 + 0.5);
    vec3 f = (position - uLatticeMin) / uCellSize - 0.5;
    vec3 base = floor(f);
    vec3 frac = f - base;
    vec3 disp = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      vec3 o = vec3(float(i & 1), float((i / 2) & 1), float((i / 4) & 1));
      vec4 t = texture(uField, (base + o + 0.5) / uDims);
      vec3 wv = mix(1.0 - frac, frac, o);
      float w = wv.x * wv.y * wv.z;
      vec3 delta = base + o - anchorCell;
      bool connected = uTopology < 0.5 || all(lessThan(abs(delta), vec3(0.5)));
      if (uTopology > 0.5 && all(lessThan(abs(delta), vec3(1.5)))) {
        int bit = int(delta.x + 1.0) + int(delta.y + 1.0) * 3 + int(delta.z + 1.0) * 9;
        connected = connected || ((int(links[bit / 8]) & (1 << (bit & 7))) != 0);
      }
      // A lost support inherits its own panel's anchor, never the origin
      // or a node across a broken connection.
      disp += (connected && t.a > 0.75 ? (t.rgb * 255.0 - 128.0) / 127.0 : anchorDisp) * w;
    }
    pos += disp * uDeformScale;
    vDent = length(disp * uDeformScale) / uCellSize;
  }
  vec4 view = modelViewMatrix * vec4(pos, 1.0);
  vViewPosition = view.xyz;
  gl_Position = projectionMatrix * view;
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
uniform float uRim;
uniform float uRoughness;
uniform float uMetalness;
uniform float uFfd;

varying vec3 vCellUV;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vRestPosition;
varying float vDent;

void main() {
  if (uRim < 0.5 && texture(uField, vCellUV).a < 0.25) discard;

  vec3 dx = dFdx(vViewPosition), dy = dFdy(vViewPosition);
  vec3 rx = dFdx(vRestPosition), ry = dFdy(vRestPosition);
  // Trace of the deformed metric in rest-surface coordinates: 2 when intact.
  // Safety net for extreme stretch, including long thin spikes with small area.
  if (uFfd > 0.5 && uRim < 0.5) {
    float aa = dot(rx, rx), ab = dot(rx, ry), bb = dot(ry, ry);
    float det = aa * bb - ab * ab;
    float stretch = (dot(dx, dx) * bb + dot(dy, dy) * aa - 2.0 * dot(dx, dy) * ab) / max(det, 1e-20);
    if (det > 1e-20 && stretch > 12.0) discard;
  }

  vec3 base = uBaseColor;
  if (uHasMap > 0.5) base *= texture2D(uMap, vUv).rgb;

  vec3 face = normalize(cross(dx, dy));
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  // Derivatives include the actual dent; retain smooth authored normals on
  // undamaged surfaces instead of faceting every imported model.
  n = normalize(mix(n, face, uRim > 0.5 ? 1.0 : smoothstep(0.03, 0.18, vDent)));
  float dim = 1.0;
  if (!gl_FrontFacing && uRim < 0.5) dim = uInteriorDim;

  float ndl = max(0.0, dot(n, uLightDirView));
  float fill = max(0.0, dot(n, -uLightDirView)) * 0.12;
  vec3 halfDir = normalize(uLightDirView + normalize(-vViewPosition));
  float specular = pow(max(0.0, dot(n, halfDir)), mix(90.0, 8.0, uRoughness)) * ndl;
  vec3 specColor = mix(vec3(0.04), base, uMetalness);
  gl_FragColor = vec4(base * dim * (uAmbient + ndl * uDiffuse + fill) + specColor * specular * dim, 1.0);
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

const RIB_VERTEX_SHADER = `
uniform vec3 uColor;
varying vec3 vColor;
varying vec3 vNormal;
void main() {
  vColor = uColor;
  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const ribMatrix = new THREE.Matrix4();
const ribRotation = new THREE.Quaternion();
const ribDirection = new THREE.Vector3();
const ribCenter = new THREE.Vector3();
const ribScale = new THREE.Vector3();
const ribUp = new THREE.Vector3(0, 1, 0);

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
  _seen: new Set(),
  debris: null,
  lightDirWorld: new THREE.Vector3(0.35, 0.8, 0.5).normalize(),
  _lightDirView: new THREE.Vector3(),
  _lastTimeSec: 0,
  skinEnabled: true,
  ffdEnabled: true,
  interiorsEnabled: true,
  beamsEnabled: false,
  nodesEnabled: false,
  stats: { bodies: 0, nodes: 0, beams: 0, brokenBeams: 0, skinTriangles: 0, interiorTriangles: 0 },

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
    if (!prepareSkinSurface(skin)) prepareSkinChunks(skin);
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
    const data = { skin: null, beamLines: null, nodeMesh: null, beamCapacity: body.beams.length };
    if (body.skin) data.skin = this._createBodySkin(body);
    this.bodyData.set(body, data);
    body.meshDirty = true;
    return data;
  },

  _createNodeMesh(body, data) {
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
  },

  _createBeamLines(body, data) {
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
  },

  _createBodySkin(body) {
    const skin = body.skin;
    const gpuParts = this._ensureSkinGeometries(skin);
    const dims = skin.dims;
    const surface = skin._surface ? createSurfaceState(skin) : null;
    if (surface) updateSurfaceState(body, surface);
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
    let linksTexture = null;
    if (surface) {
      linksTexture = new THREE.Data3DTexture(surface.links, dims.x, dims.y, dims.z);
      linksTexture.format = THREE.RGBAFormat;
      linksTexture.type = THREE.UnsignedByteType;
      linksTexture.minFilter = linksTexture.magFilter = THREE.NearestFilter;
      linksTexture.needsUpdate = true;
    }

    const deformScale = Math.max(1e-3, body.cellSize * 8);
    const meshes = [];
    const materials = [];
    const partIds = [];
    let triangleCount = 0;
    for (let partId = 0; partId < gpuParts.length; partId++) {
      const gp = gpuParts[partId];
      const patch = surface && !surface.intact ? surface.parts[partId] : null;
      const chunk = surface || body.activeNodes === skin._nodeCount ? null : selectSkinChunk(skin, partId, body.nodes);
      // Atrybuty modelu pozostają wspólne. Odłam wysyła tylko swoje indeksy,
      // zamiast przetwarzać cały GLB i odrzucać go dopiero w fragmencie shadera.
      const geometry = new THREE.BufferGeometry();
      for (const name of Object.keys(gp.geometry.attributes)) geometry.setAttribute(name, gp.geometry.attributes[name]);
      geometry.setIndex(patch ? new THREE.BufferAttribute(patch.indices, 1).setUsage(THREE.DynamicDrawUsage)
        : chunk ? new THREE.BufferAttribute(chunk.selected.slice(), 1).setUsage(THREE.DynamicDrawUsage) : gp.geometry.index);
      const count = patch ? patch.count : chunk ? chunk.count : geometry.index.count;
      geometry.setDrawRange(0, count);
      triangleCount += count / 3;
      const map = gp.material?.map || null;
      const color = gp.material?.color;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uField: { value: texture },
          uLinks: { value: linksTexture || texture },
          uTopology: { value: surface ? 1 : 0 },
          uMap: { value: map },
          uHasMap: { value: map ? 1 : 0 },
          uBaseColor: { value: new THREE.Vector3(color?.r ?? 0.75, color?.g ?? 0.76, color?.b ?? 0.78) },
          uDims: { value: new THREE.Vector3(dims.x, dims.y, dims.z) },
          uLatticeMin: { value: new THREE.Vector3(body.skinLatticeMin.x, body.skinLatticeMin.y, body.skinLatticeMin.z) },
          uBodyOffset: { value: new THREE.Vector3() },
          uCellSize: { value: body.cellSize },
          uDeformScale: { value: deformScale },
          uFfd: { value: this.ffdEnabled ? 1 : 0 },
          uLightDirView: { value: new THREE.Vector3(0, 0, 1) },
          uAmbient: { value: 0.34 },
          uDiffuse: { value: 0.95 },
          uInteriorDim: { value: 0.45 },
          uRim: { value: 0 },
          uRoughness: { value: gp.material?.roughness ?? 0.65 },
          uMetalness: { value: gp.material?.metalness ?? 0.25 }
        },
        vertexShader: SKIN_VERTEX_SHADER,
        fragmentShader: SKIN_FRAGMENT_SHADER,
        side: THREE.DoubleSide
      });
      material.defaultAttributeValues.aShellOffset = [0, 0, 0];
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      meshes.push(mesh);
      materials.push(material);
      partIds.push(partId);
    }
    const result = { meshes, materials, partIds, triangleCount, texture, linksTexture, surface, data, base: skin._baseField, dims, deformScale,
      nodes: body.nodes, activeNodes: body.activeNodes, deformed: false, rims: null, ribs: null };
    if (surface && !surface.intact) this._updateTearRims(body, result);
    return result;
  },

  _updateSkinIndices(body, sd) {
    if (sd.surface) {
      if (!updateSurfaceState(body, sd.surface)) return;
      sd.linksTexture.needsUpdate = true;
      sd.triangleCount = 0;
      for (let i = 0; i < sd.meshes.length; i++) {
        const partId = sd.partIds[i], geometry = sd.meshes[i].geometry;
        const part = sd.surface.parts[partId], source = body.skin._gpu[partId].geometry;
        if (sd.surface.intact) geometry.setIndex(source.index);
        else if (geometry.index.array !== part.indices) geometry.setIndex(new THREE.BufferAttribute(part.indices, 1).setUsage(THREE.DynamicDrawUsage));
        else geometry.index.needsUpdate = true;
        geometry.setDrawRange(0, part.count);
        sd.triangleCount += part.count / 3;
      }
      this._updateTearRims(body, sd);
      return;
    }
    if (sd.nodes === body.nodes && sd.activeNodes === body.activeNodes) return;
    sd.triangleCount = 0;
    for (let i = 0; i < sd.meshes.length; i++) {
      const partId = sd.partIds[i];
      const chunk = selectSkinChunk(body.skin, partId, body.nodes);
      const geometry = sd.meshes[i].geometry;
      if (geometry.index === body.skin._gpu[partId].geometry.index) {
        geometry.setIndex(new THREE.BufferAttribute(chunk.selected.slice(0, chunk.count), 1).setUsage(THREE.DynamicDrawUsage));
      } else {
        geometry.index.array.set(chunk.selected.subarray(0, chunk.count));
        geometry.index.needsUpdate = true;
      }
      geometry.setDrawRange(0, chunk.count);
      sd.triangleCount += chunk.count / 3;
    }
    sd.nodes = body.nodes;
    sd.activeNodes = body.activeNodes;
  },

  _updateTearRims(body, sd) {
    if (!sd.rims) sd.rims = { capacity: 0, count: 0, mesh: null };
    const rims = writeTearRims(body.skin, sd.surface, sd.rims);
    if (!rims.count && !rims.mesh) return;
    if (!rims.mesh) {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...sd.materials[0].uniforms,
          uBaseColor: { value: new THREE.Vector3(0.40, 0.43, 0.46) }, uHasMap: { value: 0 },
          uRim: { value: 1 }, uRoughness: { value: 0.58 }, uMetalness: { value: 0.7 } },
        vertexShader: SKIN_VERTEX_SHADER, fragmentShader: SKIN_FRAGMENT_SHADER, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      rims.mesh = mesh;
    }
    const geometry = rims.mesh.geometry;
    if (rims.grew) {
      // Dispose only these private buffers before replacing their capacity.
      geometry.dispose();
      for (const [name, key] of [['position', 'positions'], ['normal', 'normals'], ['aCellUV', 'cells'], ['aShellOffset', 'insets']]) {
        geometry.setAttribute(name, new THREE.BufferAttribute(rims[key], 3).setUsage(THREE.DynamicDrawUsage));
      }
    } else for (const name of ['position', 'normal', 'aCellUV', 'aShellOffset']) geometry.attributes[name].needsUpdate = true;
    geometry.setDrawRange(0, rims.count);
  },

  _updateRibs(body, sd) {
    if (!sd.surface || (sd.surface.intact && !sd.ribs)) return;
    if (!sd.ribs || sd.ribs.beams !== body.beams) {
      if (sd.ribs) {
        this.scene.remove(sd.ribs.mesh); sd.ribs.mesh.dispose();
        sd.ribs.mesh.geometry.dispose(); sd.ribs.mesh.material.dispose();
      }
      const members = [];
      for (let i = 0; i < body.beams.length; i++) if (body.beams[i].type >= BEAM_TYPE.FRAME) members.push(i);
      const material = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Vector3(0.22, 0.25, 0.28) },
          uLightDirView: { value: this._lightDirView.clone() }, uAmbient: { value: 0.38 }, uDiffuse: { value: 0.8 } },
        vertexShader: RIB_VERTEX_SHADER, fragmentShader: NODE_FRAGMENT_SHADER
      });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, Math.max(1, members.length));
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
      sd.ribs = { mesh, members: new Uint32Array(members), beams: body.beams };
    }
    const ribs = sd.ribs;
    let count = 0;
    for (const index of ribs.members) {
      const beam = body.beams[index], a = body.nodes[beam.a], b = body.nodes[beam.b];
      if (beam.broken || !a.active || !b.active) continue;
      ribDirection.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const length = ribDirection.length();
      if (length < 1e-5 || length > beam.restBase * 1.7) continue;
      ribRotation.setFromUnitVectors(ribUp, ribDirection.multiplyScalar(1 / length));
      ribCenter.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
      const width = body.cellSize * (beam.type === BEAM_TYPE.BULKHEAD ? 0.24 : 0.14);
      ribScale.set(width, length, width * 0.6);
      ribMatrix.compose(ribCenter, ribRotation, ribScale);
      ribs.mesh.setMatrixAt(count++, ribMatrix);
    }
    ribs.mesh.count = count;
    ribs.mesh.instanceMatrix.needsUpdate = true;
  },

  _updateSkinField(body, sd) {
    this._updateSkinIndices(body, sd);
    if (this.interiorsEnabled) this._updateRibs(body, sd);
    const data = sd.data;
    data.set(sd.base);
    const nx = sd.dims.x;
    const nxy = sd.dims.x * sd.dims.y;
    // Duży zgniot nie może zatrzymać się wizualnie na sztywnym limicie 8 komórek.
    let scale = body.cellSize * 8;
    let maxDisplacement = 0;
    for (const n of body.nodes) {
      if (n.active) maxDisplacement = Math.max(maxDisplacement, Math.abs(n.x - n.ox), Math.abs(n.y - n.oy), Math.abs(n.z - n.oz));
    }
    scale = Math.max(scale, maxDisplacement);
    // The intact high-detail fleet needs no field sampling in its vertex
    // shader. Rigid translation / rotation is already in the model matrix.
    sd.deformed = maxDisplacement > body.cellSize * 0.001;
    sd.deformScale = Math.max(1e-3, scale);
    const invScale = 1 / sd.deformScale;
    for (const material of sd.materials) material.uniforms.uDeformScale.value = sd.deformScale;

    for (const n of body.nodes) {
      if (!n.active) continue;
      const o = (n.ix + n.iy * nx + n.iz * nxy) * 4;
      let vx = (n.x - n.ox) * invScale;
      let vy = (n.y - n.oy) * invScale;
      let vz = (n.z - n.oz) * invScale;
      if (vx < -1) vx = -1; else if (vx > 1) vx = 1;
      if (vy < -1) vy = -1; else if (vy > 1) vy = 1;
      if (vz < -1) vz = -1; else if (vz > 1) vz = 1;
      data[o] = Math.round(vx * 127 + 128);
      data[o + 1] = Math.round(vy * 127 + 128);
      data[o + 2] = Math.round(vz * 127 + 128);
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
    this.stats.interiorTriangles = 0;

    const seen = this._seen;
    seen.clear();
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
      if (showBeams && !data.beamLines) { this._createBeamLines(body, data); this._updateBeamLines(body, data); }
      if (showNodes && !data.nodeMesh) { this._createNodeMesh(body, data); this._updateNodes(body, data); }

      if (body.meshDirty) {
        if (showBeams) this._updateBeamLines(body, data);
        if (showNodes) this._updateNodes(body, data);
        if (data.skin) this._updateSkinField(body, data.skin);
        body.meshDirty = false;
      }

      const px = body.pos.x, py = body.pos.y, pz = body.pos.z;
      const q = body.quat;

      if (data.beamLines) {
        data.beamLines.visible = showBeams;
        data.beamLines.position.set(px, py, pz);
        data.beamLines.quaternion.set(q.x, q.y, q.z, q.w);
      }
      if (data.nodeMesh) {
        data.nodeMesh.visible = showNodes;
        data.nodeMesh.position.set(px, py, pz);
        data.nodeMesh.quaternion.set(q.x, q.y, q.z, q.w);
        data.nodeMesh.material.uniforms.uLightDirView.value.copy(this._lightDirView);
      }

      if (data.skin) {
        for (let i = 0; i < data.skin.meshes.length; i++) {
          const sm = data.skin.meshes[i];
          sm.visible = this.skinEnabled && sm.geometry.drawRange.count > 0;
          sm.position.set(px, py, pz);
          sm.quaternion.set(q.x, q.y, q.z, q.w);
          const u = data.skin.materials[i].uniforms;
          // Skóra pozostaje w oryginalnej kratownicy, a każdy odłam ma już
          // własny środek masy. Ten offset zachowuje jej pozycję przy podziale,
          // również gdy użytkownik wyłączy FFD.
          u.uBodyOffset.value.set(body.latticeMin.x - body.skinLatticeMin.x,
            body.latticeMin.y - body.skinLatticeMin.y, body.latticeMin.z - body.skinLatticeMin.z);
          u.uLightDirView.value.copy(this._lightDirView);
          u.uFfd.value = this.ffdEnabled && data.skin.deformed ? 1 : 0;
        }
        if (this.skinEnabled) this.stats.skinTriangles += data.skin.triangleCount;
        const rims = data.skin.rims, ribs = data.skin.ribs;
        if (rims?.mesh) {
          rims.mesh.visible = this.skinEnabled && this.interiorsEnabled && rims.count > 0;
          rims.mesh.position.set(px, py, pz);
          rims.mesh.quaternion.set(q.x, q.y, q.z, q.w);
          if (rims.mesh.visible) this.stats.interiorTriangles += rims.count / 3;
        }
        if (ribs) {
          ribs.mesh.visible = this.skinEnabled && this.interiorsEnabled;
          ribs.mesh.position.set(px, py, pz);
          ribs.mesh.quaternion.set(q.x, q.y, q.z, q.w);
          ribs.mesh.material.uniforms.uLightDirView.value.copy(this._lightDirView);
          if (ribs.mesh.visible) this.stats.interiorTriangles += ribs.mesh.count * 12;
        }
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
      for (let i = 0; i < data.skin.meshes.length; i++) {
        const sm = data.skin.meshes[i];
        this.scene?.remove(sm);
        // Nie usuwaj współdzielonych buforów innych odłamów z WebGLAttributes.
        for (const name of Object.keys(sm.geometry.attributes)) sm.geometry.deleteAttribute(name);
        const source = body.skin._gpu[data.skin.partIds[i]].geometry;
        if (sm.geometry.index === source.index) sm.geometry.setIndex(null);
        sm.geometry.dispose();
      }
      for (const mat of data.skin.materials) mat.dispose?.();
      data.skin.texture?.dispose?.();
      data.skin.linksTexture?.dispose();
      for (const mesh of [data.skin.rims?.mesh, data.skin.ribs?.mesh]) if (mesh) {
        this.scene?.remove(mesh);
        mesh.dispose?.(); mesh.geometry.dispose(); mesh.material.dispose();
      }
    }
    this.bodyData.delete(body);
  },

  disposeSkinAssets(skin) {
    if (!skin?._gpu) return;
    for (const gp of skin._gpu) gp.geometry?.dispose?.();
    skin._gpu = null;
    skin._baseField = null;
    skin._chunks = null;
    skin._surface = null;
    skin._surfaceEdges = null;
  },

  dispose() {
    for (const [body, data] of this.bodyData) this._disposeBodyData(body, data);
    this.bodyData.clear();
    this._seen.clear();
    if (this.debris) {
      this.debris.dispose(this.scene);
      this.debris = null;
    }
    this.scene = null;
  }
};
