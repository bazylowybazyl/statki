/**
 * beamShips3D.webgpu — renderer ciał węzłowo-belkowych (destructorBeams3D) na WebGPU + TSL.
 *
 * Port beamShips3D.js (GLSL, demo destruktor3d.html na WebGLRenderer) dla dema
 * destruktor3d-webgpu.html (wybuchy i dym z gazu 3D — plan docs/PLAN-zniszczenia-swiata-3d.md § 12).
 * Logika CPU 1:1 (kawałki skóry, stan powierzchni, pole przemieszczeń, żebra, krawędzie rozdarć),
 * materiały węzłowe:
 *  • SKÓRA — model .glb jedzie po polu deformacji węzłów (FFD z 8 próbek pola i bitów połączeń),
 *    znika tam, gdzie węzeł zginął, i tam, gdzie rozciągnięcie metryki > 12 (szpikulce). JEDEN graf
 *    na wszystkie części i odłamy (pole, połączenia i mapa części — tekstury per obiekt, liczby —
 *    `uniform().onObjectUpdate` z `material.uniforms`): nowy wrak nie buduje programu w klatce
 *    rozpadu. MeshStandardNodeMaterial — skórę oświetlają światła sceny (słońce, błyski i ogień
 *    wybuchów jako PointLight).
 *  • KRAWĘDZIE ROZDARĆ — drugi graf (inny układ atrybutów: przesunięcie powłoki), normalna ściany.
 *  • ŻEBRA, WĘZŁY, BELKI — instancje / linie z materiałami węzłowymi three.
 *  • Skóra 2D ze sprite'a (tryb płaski) — MeshBasicNodeMaterial z mapą i barwami wierzchołków.
 * API jak BeamShips3D (init, sync, spawnDebris, disposeSkinAssets, flagi i statystyki).
 */

import * as THREE from 'three/webgpu';
import {
  Fn, If, float, int, uint, vec3, vec4, uniform, attribute, clamp, positionGeometry, positionView, normalView, frontFacing,
  varyingProperty, select, mix, smoothstep, floor, abs, dot, cross, normalize, length, max, dFdx, dFdy, uv, nodeObject
} from 'three/tsl';
import { MetalDebrisPoolGPU } from './beamDebris3D.webgpu.js';
import { BEAM_TYPE } from '../game/beamBody3D.js';
import { prepareSkinChunks, selectSkinChunk } from './beamSkinChunks3D.js';
import { prepareSkinSurface, createSurfaceState, updateSurfaceState, writeTearRims } from './beamSkinSurface3D.js';
import { buildSpriteSkinTopology, writeSpriteSkinGeometry, writeSpriteSkinQuads } from './beamSpriteSkin2D.js';
import { teksturaObiektu, teksturaZastepcza } from './tsl/teksturaObiektu.js';

const FIELD_ALIVE = THREE.DataUtils.toHalfFloat(1);
const FIELD_NEVER = THREE.DataUtils.toHalfFloat(0.5);
const FIELD_GONE = 0;

// --- tekstura 3D per obiekt (jak teksturaObiektu dla 2D: wartość z material.uniforms rysowanego obiektu) ---
class ObjectTexture3DNode extends THREE.Texture3DNode {
  static get type() { return 'ObjectTexture3DNode'; }
  get updateType() { return THREE.NodeUpdateType.OBJECT; }
  set updateType(_v) { /* stałe OBJECT — teksturaObiektu.js */ }
  update(frame) {
    const value = frame.material?.uniforms?.[this.objectKey]?.value;
    this.value = (value && value.isTexture === true) ? value : this.objectFallback;
  }
  clone() {
    const node = super.clone();
    node.objectKey = this.objectKey;
    node.objectFallback = this.objectFallback;
    return node;
  }
}

function objectTexture3D(key, placeholder, uvwNode) {
  const node = new ObjectTexture3DNode(placeholder, uvwNode, float(0));
  node.objectKey = key;
  node.objectFallback = placeholder;
  return nodeObject(node);
}

function placeholder3D(type) {
  const data = type === THREE.HalfFloatType ? new Uint16Array(4) : new Uint8Array(4);
  const t = new THREE.Data3DTexture(data, 1, 1, 1);
  t.format = THREE.RGBAFormat;
  t.type = type;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

const perObject = (init, key, type) => uniform(init, type).onObjectUpdate(({ material }) => {
  const v = material?.uniforms?.[key]?.value;
  return v === undefined || v === null ? init : v;
});

let _skinTemplates = null;

/** Grafy skóry (zwykła i krawędzie rozdarć) — budowane raz, materiały to klony z własnymi `uniforms`. */
function skinTemplates() {
  if (_skinTemplates) return _skinTemplates;
  const fieldPh = placeholder3D(THREE.HalfFloatType);
  const linksPh = placeholder3D(THREE.UnsignedByteType);
  const mapPh = teksturaZastepcza(255, 255, 255, 255, THREE.SRGBColorSpace);
  const make = (rim) => {
    const U = {
      dims: perObject(new THREE.Vector3(1, 1, 1), 'uDims'),
      latticeMin: perObject(new THREE.Vector3(), 'uLatticeMin'),
      bodyOffset: perObject(new THREE.Vector3(), 'uBodyOffset'),
      cellSize: perObject(1, 'uCellSize'),
      deformScale: perObject(1, 'uDeformScale'),
      ffd: perObject(0, 'uFfd'),
      topology: perObject(0, 'uTopology'),
      baseColor: perObject(new THREE.Vector3(0.75, 0.76, 0.78), 'uBaseColor'),
      roughness: perObject(0.65, 'uRoughness'),
      metalness: perObject(0.25, 'uMetalness'),
      interiorDim: perObject(0.45, 'uInteriorDim')
    };
    const aCell = attribute('aCellUV', 'vec3');
    const vCell = varyingProperty('vec3', rim ? 'vBeamRimCell' : 'vBeamCell');
    const vRest = varyingProperty('vec3', rim ? 'vBeamRimRest' : 'vBeamRest');
    const vDent = varyingProperty('float', rim ? 'vBeamRimDent' : 'vBeamDent');
    const field = (uvw) => objectTexture3D('uField', fieldPh, uvw);
    const links = (uvw) => objectTexture3D('uLinks', linksPh, uvw);
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.name = rim ? 'BeamSkinRim' : 'BeamSkin';
    mat.side = THREE.DoubleSide;
    mat.positionNode = Fn(() => {
      const shell = rim ? attribute('aShellOffset', 'vec3') : vec3(0.0);
      vCell.assign(aCell);
      const pos = positionGeometry.add(U.bodyOffset).add(shell).toVar();
      vRest.assign(positionGeometry.add(shell));
      vDent.assign(0.0);
      If(U.ffd.greaterThan(0.5), () => {
        const anchor = field(aCell).toVar();
        const anchorDisp = anchor.rgb;
        const anchorCell = floor(aCell.mul(U.dims)).toVar();
        const lk = floor(links(aCell).mul(255.0).add(0.5)).toVar();
        const f = positionGeometry.sub(U.latticeMin).div(U.cellSize).sub(0.5).toVar();
        const base = floor(f).toVar();
        const frac = f.sub(base).toVar();
        const disp = vec3(0.0).toVar();
        for (let i = 0; i < 8; i++) {
          const o = vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1);
          const t = field(base.add(o).add(0.5).div(U.dims)).toVar();
          const wv = mix(vec3(1.0).sub(frac), frac, o);
          const w = wv.x.mul(wv.y).mul(wv.z);
          const delta = base.add(o).sub(anchorCell).toVar();
          const ad = abs(delta);
          const same = ad.x.lessThan(0.5).and(ad.y.lessThan(0.5)).and(ad.z.lessThan(0.5));
          const near = ad.x.lessThan(1.5).and(ad.y.lessThan(1.5)).and(ad.z.lessThan(1.5));
          // Bit połączenia sąsiada (3³ − 1 kierunków w 4 bajtach tekstury połączeń).
          // (u32 — przesunięcia w WGSL wymagają u32; poza sąsiedztwem bit nieużywany, stąd clamp).
          const dd = clamp(delta.add(1.0), 0.0, 2.0);
          const bit = uint(dd.x).add(uint(dd.y).mul(uint(3))).add(uint(dd.z).mul(uint(9))).toVar();
          const byteIdx = bit.shiftRight(uint(3));
          const byteVal = uint(select(byteIdx.equal(uint(0)), lk.x, select(byteIdx.equal(uint(1)), lk.y, select(byteIdx.equal(uint(2)), lk.z, lk.w))));
          const linked = byteVal.shiftRight(bit.bitAnd(uint(7))).bitAnd(uint(1)).equal(uint(1));
          const topo = U.topology.greaterThan(0.5);
          const connected = topo.not().or(same).or(topo.and(near).and(linked));
          // Utracona podpora dziedziczy kotwicę własnego panelu — nigdy początek ani węzeł zza zerwania.
          disp.addAssign(select(connected.and(t.a.greaterThan(0.75)), t.rgb, anchorDisp).mul(w));
        }
        pos.addAssign(disp.mul(U.deformScale));
        vDent.assign(length(disp.mul(U.deformScale)).div(U.cellSize));
      });
      return pos;
    })();
    if (rim) {
      mat.colorNode = vec4(U.baseColor, 1.0);
    } else {
      const map = teksturaObiektu('uMap', mapPh, uv());
      mat.colorNode = Fn(() => {
        const base = U.baseColor.mul(map.rgb);
        return vec4(select(frontFacing, base, base.mul(U.interiorDim)), 1.0);
      })();
    }
    mat.roughnessNode = U.roughness;
    mat.metalnessNode = U.metalness;
    // Normalna: gładka autorska na nietkniętej powierzchni, ścianowa (z pochodnych) we wgnieceniu;
    // obie zwrócone do kamery (powłoka dwustronna — wnętrze widać przez wyrwę).
    mat.normalNode = Fn(() => {
      const toCam = positionView.negate();
      const face = normalize(cross(dFdx(positionView), dFdy(positionView))).toVar();
      const faceO = select(dot(face, toCam).lessThan(0.0), face.negate(), face);
      if (rim) return faceO;
      const n0 = normalize(normalView).toVar();
      const nO = select(dot(n0, toCam).lessThan(0.0), n0.negate(), n0);
      return normalize(mix(nO, faceO, smoothstep(0.03, 0.18, vDent)));
    })();
    // Odrzucenie: martwa komórka pola (skóra) i szpikulce (rozciągnięcie metryki > 12) — pochodne
    // liczone na górze grafu, przed jakimkolwiek rozgałęzieniem.
    mat.maskNode = Fn(() => {
      const rx = dFdx(vRest), ry = dFdy(vRest), dx = dFdx(positionView), dy = dFdy(positionView);
      if (rim) return float(1.0).greaterThan(0.0);
      const aa = dot(rx, rx), ab = dot(rx, ry), bb = dot(ry, ry);
      const det = aa.mul(bb).sub(ab.mul(ab));
      const stretch = dot(dx, dx).mul(bb).add(dot(dy, dy).mul(aa)).sub(dot(dx, dy).mul(ab).mul(2.0)).div(max(det, 1e-20));
      const torn = U.ffd.greaterThan(0.5).and(det.greaterThan(1e-20)).and(stretch.greaterThan(12.0));
      const alive = field(vCell).a.greaterThanEqual(0.25);
      return alive.and(torn.not());
    })();
    return mat;
  };
  _skinTemplates = { skin: make(false), rim: make(true) };
  return _skinTemplates;
}

let _nodeTemplates = null;
function nodeTemplates() {
  if (_nodeTemplates) return _nodeTemplates;
  const node = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.2 });
  node.name = 'BeamNodes';
  const rib = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.22, 0.25, 0.28), roughness: 0.55, metalness: 0.55 });
  rib.name = 'BeamRibs';
  _nodeTemplates = { node, rib };
  return _nodeTemplates;
}

const ribMatrix = new THREE.Matrix4();
const ribRotation = new THREE.Quaternion();
const ribDirection = new THREE.Vector3();
const ribCenter = new THREE.Vector3();
const ribScale = new THREE.Vector3();
const ribUp = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

// Kolory bazowe belek wg roli konstrukcyjnej — od razu widać, gdzie jest
// poszycie, a gdzie nośny szkielet.
const BEAM_BASE_COLORS = {
  [BEAM_TYPE.PLATING]: [0.42, 0.52, 0.62],
  [BEAM_TYPE.INTERIOR]: [0.34, 0.38, 0.44],
  [BEAM_TYPE.FRAME]: [0.95, 0.62, 0.22],
  [BEAM_TYPE.BULKHEAD]: [0.25, 0.85, 0.80]
};

export const BeamShips3DGPU = {
  scene: null,
  bodyData: new Map(),
  _seen: new Set(),
  debris: null,
  _spriteTextures: new WeakMap(),
  _spriteRange: { min: 0, max: -1 },
  lightDirWorld: new THREE.Vector3(0.35, 0.8, 0.5).normalize(),
  _lastTimeSec: 0,
  skinEnabled: true,
  ffdEnabled: true,
  interiorsEnabled: true,
  beamsEnabled: false,
  nodesEnabled: false,
  stats: { bodies: 0, nodes: 0, beams: 0, brokenBeams: 0, skinTriangles: 0, interiorTriangles: 0 },

  init(scene) {
    this.scene = scene;
    if (!this.debris) this.debris = new MetalDebrisPoolGPU(scene);
    return this;
  },

  setLightDir(x, y, z) { this.lightDirWorld.set(x, y, z).normalize(); },

  spawnDebris(x, y, z, vx, vy, vz, r, g, b, scale, structural = false) {
    this.debris?.spawn(x, y, z, vx, vy, vz, r, g, b, scale, this._lastTimeSec, structural);
  },

  /** Siatki do rozgrzewki (compileAsync): wszystkie siatki ciał w scenie. */
  warmupObjects() {
    const list = [];
    for (const data of this.bodyData.values()) {
      if (data.skin) { list.push(...data.skin.meshes); if (data.skin.rims?.mesh) list.push(data.skin.rims.mesh); if (data.skin.ribs) list.push(data.skin.ribs.mesh); }
      if (data.nodeMesh) list.push(data.nodeMesh);
      if (data.beamLines) list.push(data.beamLines);
    }
    return list;
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
    const data = { skin: null, sprite: null, beamLines: null, nodeMesh: null, beamCapacity: body.beamStore.count };
    if (body.skin) data.skin = this._createBodySkin(body);
    if (body.spriteSkin) data.sprite = this._createSpriteSkin(body);
    this.bodyData.set(body, data);
    body.meshDirty = true;
    return data;
  },

  _createNodeMesh(body, data) {
    const cs = body.cellSize;
    const nodeGeo = new THREE.BoxGeometry(cs * 0.4, cs * 0.4, cs * 0.4);
    const nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeTemplates().node, body.nodeStore.count);
    nodeMesh.frustumCulled = false;
    nodeMesh.count = 0;
    // Barwy instancji od startu (instanceColor wchodzi do układu atrybutów — bez przebudowy później).
    nodeMesh.setColorAt(0, _color.setRGB(1, 1, 1));
    this.scene.add(nodeMesh);
    data.nodeMesh = nodeMesh;
  },

  _createBeamLines(body, data) {
    const cap = body.beamStore.count;
    const linePos = new Float32Array(cap * 6);
    const lineCol = new Float32Array(cap * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
    lineGeo.setDrawRange(0, 0);
    const lineMat = new THREE.LineBasicNodeMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    if (body.spriteSkin) { lineMat.depthTest = false; lines.renderOrder = 20; }
    this.scene.add(lines);
    data.beamLines = lines;
    data.beamCapacity = cap;
  },

  _skinUniforms(body, dims, texture, linksTexture, surface, deformScale, gp) {
    const color = gp?.material?.color;
    return {
      uField: { value: texture },
      uLinks: { value: linksTexture || null },
      uTopology: { value: surface ? 1 : 0 },
      uMap: { value: gp?.material?.map || null },
      uBaseColor: { value: new THREE.Vector3(color?.r ?? 0.75, color?.g ?? 0.76, color?.b ?? 0.78) },
      uDims: { value: new THREE.Vector3(dims.x, dims.y, dims.z) },
      uLatticeMin: { value: new THREE.Vector3(body.skinLatticeMin.x, body.skinLatticeMin.y, body.skinLatticeMin.z) },
      uBodyOffset: { value: new THREE.Vector3() },
      uCellSize: { value: body.cellSize },
      uDeformScale: { value: deformScale },
      uFfd: { value: this.ffdEnabled ? 1 : 0 },
      uInteriorDim: { value: 0.45 },
      // PBR bez mapy otoczenia: metal z GLB byłby czarny — jak dawny GLSL (połysk, nie lustro).
      uRoughness: { value: Math.max(0.45, gp?.material?.roughness ?? 0.65) },
      uMetalness: { value: Math.min(0.3, gp?.material?.metalness ?? 0.25) }
    };
  },

  _createBodySkin(body) {
    const skin = body.skin;
    const gpuParts = this._ensureSkinGeometries(skin);
    const dims = skin.dims;
    const surface = skin._surface ? createSurfaceState(skin) : null;
    if (surface) updateSurfaceState(body, surface);
    const texels = dims.x * dims.y * dims.z;

    if (!skin._baseField) {
      const base = new Uint16Array(texels * 4);
      for (let i = 0; i < texels; i++) {
        base[i * 4 + 3] = skin.occupancy[i] ? FIELD_GONE : FIELD_NEVER;
      }
      skin._baseField = base;
    }

    // Połówkowe floaty — ruch poniżej komórki (8-bitowe pole skakało co cellSize · 8 / 127).
    const data = new Uint16Array(texels * 4);
    const texture = new THREE.Data3DTexture(data, dims.x, dims.y, dims.z);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.HalfFloatType;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    let linksTexture = null;
    if (surface) {
      linksTexture = new THREE.Data3DTexture(surface.links, dims.x, dims.y, dims.z);
      linksTexture.format = THREE.RGBAFormat;
      linksTexture.type = THREE.UnsignedByteType;
      linksTexture.minFilter = linksTexture.magFilter = THREE.NearestFilter;
      linksTexture.generateMipmaps = false;
      linksTexture.needsUpdate = true;
    }

    const deformScale = Math.max(1e-3, body.cellSize * 8);
    const meshes = [];
    const materials = [];
    const partIds = [];
    let triangleCount = 0;
    const template = skinTemplates().skin;
    for (let partId = 0; partId < gpuParts.length; partId++) {
      const gp = gpuParts[partId];
      const patch = surface && !surface.intact ? surface.parts[partId] : null;
      const chunk = surface || body.activeNodes === skin._nodeCount ? null : selectSkinChunk(skin, partId, body.nodeStore);
      const geometry = new THREE.BufferGeometry();
      for (const name of Object.keys(gp.geometry.attributes)) geometry.setAttribute(name, gp.geometry.attributes[name]);
      geometry.setIndex(patch ? new THREE.BufferAttribute(patch.indices, 1)
        : chunk ? new THREE.BufferAttribute(chunk.selected.slice(), 1) : gp.geometry.index);
      const count = patch ? patch.count : chunk ? chunk.count : geometry.index.count;
      geometry.setDrawRange(0, count);
      triangleCount += count / 3;
      const material = template.clone();
      material.uniforms = this._skinUniforms(body, dims, texture, linksTexture, surface, deformScale, gp);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      meshes.push(mesh);
      materials.push(material);
      partIds.push(partId);
    }
    const result = { meshes, materials, partIds, triangleCount, texture, linksTexture, surface, data, base: skin._baseField, dims, deformScale,
      store: body.nodeStore, activeNodes: body.activeNodes, deformed: false, rims: null, ribs: null };
    if (surface && !surface.intact) this._updateTearRims(body, result);
    return result;
  },

  // --- skóra kadłuba 2D ze sprite'a (tryb płaski) ---

  _spriteTexture(skin) {
    const source = skin.image || skin;
    let texture = this._spriteTextures.get(source);
    if (!texture) {
      texture = new THREE.Texture(skin.image || null);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      if (skin.image) texture.needsUpdate = true;
      this._spriteTextures.set(source, texture);
    }
    return texture;
  },

  _createSpriteSkin(body) {
    const skin = body.spriteSkin;
    const material = new THREE.MeshBasicNodeMaterial({
      map: this._spriteTexture(skin),
      vertexColors: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    if (skin.tint) material.color.setRGB(skin.tint[0], skin.tint[1], skin.tint[2]);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10 + (body.id % 1000) * 0.001;
    this.scene.add(mesh);
    const sprite = { mesh, topology: null, positions: null, colors: null, visible: 0 };
    this._rebuildSpriteSkin(body, sprite);
    return sprite;
  },

  _rebuildSpriteSkin(body, sprite) {
    const topology = buildSpriteSkinTopology(body);
    const vertices = topology.count * 4;
    sprite.positions = new Float32Array(vertices * 3);
    sprite.colors = new Float32Array(vertices * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(sprite.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(sprite.colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(topology.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(topology.indices, 1));
    sprite.mesh.geometry.dispose();
    sprite.mesh.geometry = geometry;
    sprite.topology = topology;
    sprite.visible = writeSpriteSkinGeometry(body, topology, sprite.positions, sprite.colors);
    this._clearSkinDirty(body);
  },

  _updateSpriteSkin(body, sprite) {
    if (sprite.topology.store !== body.nodeStore || sprite.topology.beamStore !== body.beamStore) {
      this._rebuildSpriteSkin(body, sprite);
      return;
    }
    const geometry = sprite.mesh.geometry;
    const position = geometry.attributes.position, color = geometry.attributes.color;
    const region = body._region;
    if (region && region.store === body.nodeStore && !region.dirtyAll) {
      if (region.dirtyCount === 0) return;
      const range = writeSpriteSkinQuads(body, sprite.topology, sprite.positions, sprite.colors,
        region.dirty, region.dirtyCount, this._spriteRange);
      this._clearSkinDirty(body);
      sprite.visible = body.activeNodes;
      if (range.max < range.min) return;
      for (const attribute of [position, color]) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(range.min * 12, (range.max - range.min + 1) * 12);
        attribute.needsUpdate = true;
      }
      return;
    }
    sprite.visible = writeSpriteSkinGeometry(body, sprite.topology, sprite.positions, sprite.colors);
    this._clearSkinDirty(body);
    for (const attribute of [position, color]) {
      attribute.clearUpdateRanges();
      attribute.needsUpdate = true;
    }
  },

  _clearSkinDirty(body) {
    const region = body._region;
    if (!region || region.store !== body.nodeStore) return;
    const skinDirty = body.nodeStore.skinDirty;
    if (region.dirtyAll) {
      skinDirty.fill(0);
      region.dirtyAll = false;
    } else {
      for (let k = 0; k < region.dirtyCount; k++) skinDirty[region.dirty[k]] = 0;
    }
    region.dirtyCount = 0;
  },

  disposeSpriteSkin(skin) {
    const source = skin?.image || skin;
    const texture = source ? this._spriteTextures.get(source) : null;
    if (!texture) return;
    texture.dispose();
    this._spriteTextures.delete(source);
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
        else if (geometry.index.array !== part.indices) geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
        else geometry.index.needsUpdate = true;
        geometry.setDrawRange(0, part.count);
        sd.triangleCount += part.count / 3;
      }
      this._updateTearRims(body, sd);
      return;
    }
    if (sd.store === body.nodeStore && sd.activeNodes === body.activeNodes) return;
    sd.triangleCount = 0;
    for (let i = 0; i < sd.meshes.length; i++) {
      const partId = sd.partIds[i];
      const chunk = selectSkinChunk(body.skin, partId, body.nodeStore);
      const geometry = sd.meshes[i].geometry;
      if (geometry.index === body.skin._gpu[partId].geometry.index) {
        geometry.setIndex(new THREE.BufferAttribute(chunk.selected.slice(0, chunk.count), 1));
      } else {
        geometry.index.array.set(chunk.selected.subarray(0, chunk.count));
        geometry.index.needsUpdate = true;
      }
      geometry.setDrawRange(0, chunk.count);
      sd.triangleCount += chunk.count / 3;
    }
    sd.store = body.nodeStore;
    sd.activeNodes = body.activeNodes;
  },

  _updateTearRims(body, sd) {
    if (!sd.rims) sd.rims = { capacity: 0, count: 0, mesh: null };
    const rims = writeTearRims(body.skin, sd.surface, sd.rims);
    if (!rims.count && !rims.mesh) return;
    if (!rims.mesh) {
      const material = skinTemplates().rim.clone();
      material.uniforms = { ...sd.materials[0].uniforms,
        uBaseColor: { value: new THREE.Vector3(0.40, 0.43, 0.46) }, uMap: { value: null },
        uRoughness: { value: 0.58 }, uMetalness: { value: 0.7 } };
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      rims.mesh = mesh;
    }
    const geometry = rims.mesh.geometry;
    if (rims.grew) {
      geometry.dispose();
      for (const [name, key] of [['position', 'positions'], ['normal', 'normals'], ['aCellUV', 'cells'], ['aShellOffset', 'insets']]) {
        geometry.setAttribute(name, new THREE.BufferAttribute(rims[key], 3));
      }
    } else for (const name of ['position', 'normal', 'aCellUV', 'aShellOffset']) geometry.attributes[name].needsUpdate = true;
    geometry.setDrawRange(0, rims.count);
  },

  _updateRibs(body, sd) {
    if (!sd.surface || (sd.surface.intact && !sd.ribs)) return;
    const s = body.nodeStore, e = body.beamStore;
    if (!sd.ribs || sd.ribs.beamStore !== e) {
      if (sd.ribs) {
        this.scene.remove(sd.ribs.mesh); sd.ribs.mesh.dispose();
        sd.ribs.mesh.geometry.dispose();
      }
      const members = [];
      for (let i = 0; i < e.count; i++) if (e.type[i] >= BEAM_TYPE.FRAME) members.push(i);
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), nodeTemplates().rib, Math.max(1, members.length));
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      sd.ribs = { mesh, members: new Uint32Array(members), beamStore: e };
    }
    const ribs = sd.ribs;
    const x = s.x, y = s.y, z = s.z, ix = s.ix, iy = s.iy, iz = s.iz, active = s.active;
    let count = 0;
    for (const index of ribs.members) {
      const a = e.a[index], b = e.b[index];
      if (e.broken[index] || !active[a] || !active[b]) continue;
      const dims = sd.dims, exposed = sd.surface.exposed;
      const ca = ix[a] + iy[a] * dims.x + iz[a] * dims.x * dims.y;
      const cb = ix[b] + iy[b] * dims.x + iz[b] * dims.x * dims.y;
      if (!exposed[ca] && !exposed[cb]) continue;
      ribDirection.set(x[b] - x[a], y[b] - y[a], z[b] - z[a]);
      const length = ribDirection.length();
      if (length < 1e-5 || length > e.restBase[index] * 1.7) continue;
      ribRotation.setFromUnitVectors(ribUp, ribDirection.multiplyScalar(1 / length));
      ribCenter.set((x[a] + x[b]) * 0.5, (y[a] + y[b]) * 0.5, (z[a] + z[b]) * 0.5);
      const width = body.cellSize * (e.type[index] === BEAM_TYPE.BULKHEAD ? 0.24 : 0.14);
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
    let scale = body.cellSize * 8;
    let maxDisplacement = 0;
    const s = body.nodeStore, x = s.x, y = s.y, z = s.z, ox = s.ox, oy = s.oy, oz = s.oz, active = s.active;
    for (let i = 0; i < s.count; i++) {
      if (active[i]) maxDisplacement = Math.max(maxDisplacement, Math.abs(x[i] - ox[i]), Math.abs(y[i] - oy[i]), Math.abs(z[i] - oz[i]));
    }
    scale = Math.max(scale, maxDisplacement);
    sd.deformed = maxDisplacement > body.cellSize * 0.001;
    sd.deformScale = Math.max(1e-3, scale);
    const invScale = 1 / sd.deformScale;
    for (const material of sd.materials) material.uniforms.uDeformScale.value = sd.deformScale;
    if (sd.rims?.mesh) sd.rims.mesh.material.uniforms.uDeformScale = sd.materials[0].uniforms.uDeformScale;

    const ix = s.ix, iy = s.iy, iz = s.iz;
    for (let i = 0; i < s.count; i++) {
      if (!active[i]) continue;
      const o = (ix[i] + iy[i] * nx + iz[i] * nxy) * 4;
      let vx = (x[i] - ox[i]) * invScale;
      let vy = (y[i] - oy[i]) * invScale;
      let vz = (z[i] - oz[i]) * invScale;
      if (vx < -1) vx = -1; else if (vx > 1) vx = 1;
      if (vy < -1) vy = -1; else if (vy > 1) vy = 1;
      if (vz < -1) vz = -1; else if (vz > 1) vz = 1;
      data[o] = THREE.DataUtils.toHalfFloat(vx);
      data[o + 1] = THREE.DataUtils.toHalfFloat(vy);
      data[o + 2] = THREE.DataUtils.toHalfFloat(vz);
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
    const ns = body.nodeStore, e = body.beamStore;
    const x = ns.x, y = ns.y, z = ns.z, active = ns.active;
    let w = 0;
    let broken = 0;
    for (let bi = 0; bi < e.count; bi++) {
      if (e.broken[bi]) { broken++; continue; }
      const a = e.a[bi];
      const c = e.b[bi];
      if (!active[a] || !active[c]) continue;
      pos[w * 6] = x[a]; pos[w * 6 + 1] = y[a]; pos[w * 6 + 2] = z[a];
      pos[w * 6 + 3] = x[c]; pos[w * 6 + 4] = y[c]; pos[w * 6 + 5] = z[c];
      const base = BEAM_BASE_COLORS[e.type[bi]] || BEAM_BASE_COLORS[BEAM_TYPE.PLATING];
      const s = Math.min(1, Math.abs(e.strain[bi]) / Math.max(1e-4, e.brk[bi]));
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
    const col = mesh.instanceColor.array;
    const s = body.nodeStore;
    let w = 0;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const o = w * 16;
      arr[o + 0] = 1; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = 1; arr[o + 11] = 0;
      arr[o + 12] = s.x[i]; arr[o + 13] = s.y[i]; arr[o + 14] = s.z[i]; arr[o + 15] = 1;
      col[w * 3] = s.r[i]; col[w * 3 + 1] = s.g[i]; col[w * 3 + 2] = s.b[i];
      w++;
    }
    mesh.count = w;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  },

  sync(bodies, camera, nowSec) {
    if (!this.scene) return;
    this._lastTimeSec = nowSec;
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
      if (data && data.beamCapacity < body.beamStore.count) {
        this._disposeBodyData(body, data);
        data = null;
      }
      if (!data) data = this._createBodyData(body);

      const hasSkin = !!((body.skin || body.spriteSkin) && this.skinEnabled);
      const showBeams = this.beamsEnabled || !hasSkin;
      const showNodes = this.nodesEnabled || !hasSkin;
      if (showBeams && !data.beamLines) { this._createBeamLines(body, data); this._updateBeamLines(body, data); }
      if (showNodes && !data.nodeMesh) { this._createNodeMesh(body, data); this._updateNodes(body, data); }

      if (body.meshDirty) {
        if (showBeams) this._updateBeamLines(body, data);
        if (showNodes) this._updateNodes(body, data);
        if (data.skin) this._updateSkinField(body, data.skin);
        if (data.sprite) this._updateSpriteSkin(body, data.sprite);
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
      }

      if (data.sprite) {
        const mesh = data.sprite.mesh;
        mesh.visible = this.skinEnabled && data.sprite.visible > 0;
        mesh.position.set(px, py, pz);
        mesh.quaternion.set(q.x, q.y, q.z, q.w);
        if (mesh.visible) this.stats.skinTriangles += data.sprite.visible * 2;
      }

      if (data.skin) {
        for (let i = 0; i < data.skin.meshes.length; i++) {
          const sm = data.skin.meshes[i];
          sm.visible = this.skinEnabled && sm.geometry.drawRange.count > 0;
          sm.position.set(px, py, pz);
          sm.quaternion.set(q.x, q.y, q.z, q.w);
          const u = data.skin.materials[i].uniforms;
          // Skóra zostaje w oryginalnej kratownicy, a odłam ma już własny środek masy.
          u.uBodyOffset.value.set(body.latticeMin.x - body.skinLatticeMin.x,
            body.latticeMin.y - body.skinLatticeMin.y, body.latticeMin.z - body.skinLatticeMin.z);
          u.uFfd.value = this.ffdEnabled && data.skin.deformed ? 1 : 0;
        }
        if (this.skinEnabled) this.stats.skinTriangles += data.skin.triangleCount;
        const rims = data.skin.rims, ribs = data.skin.ribs;
        if (rims?.mesh) {
          rims.mesh.visible = this.skinEnabled && this.interiorsEnabled && rims.count > 0;
          rims.mesh.position.set(px, py, pz);
          rims.mesh.quaternion.set(q.x, q.y, q.z, q.w);
          const ru = rims.mesh.material.uniforms, su = data.skin.materials[0].uniforms;
          ru.uBodyOffset = su.uBodyOffset; ru.uFfd = su.uFfd; ru.uDeformScale = su.uDeformScale;
          if (rims.mesh.visible) this.stats.interiorTriangles += rims.count / 3;
        }
        if (ribs) {
          ribs.mesh.visible = this.skinEnabled && this.interiorsEnabled;
          ribs.mesh.position.set(px, py, pz);
          ribs.mesh.quaternion.set(q.x, q.y, q.z, q.w);
          if (ribs.mesh.visible) this.stats.interiorTriangles += ribs.mesh.count * 12;
        }
      }

      this.stats.bodies++;
      this.stats.nodes += body.activeNodes;
      this.stats.beams += body.liveBeams;
      this.stats.brokenBeams += (body.beamStore.count - body.liveBeams);
    }

    for (const [body, data] of this.bodyData) {
      if (!seen.has(body)) this._disposeBodyData(body, data);
    }

    if (this.debris) this.debris.commit(nowSec);
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
      data.nodeMesh.dispose?.();
    }
    if (data.sprite) {
      this.scene?.remove(data.sprite.mesh);
      data.sprite.mesh.geometry.dispose();
      data.sprite.mesh.material.dispose();
    }
    if (data.skin) {
      for (let i = 0; i < data.skin.meshes.length; i++) {
        const sm = data.skin.meshes[i];
        this.scene?.remove(sm);
        // WebGPU: RenderObject przy dispose czyta atrybuty geometrii — nie zdejmujemy ich (jak w wersji
        // WebGL); wspólne bufory innych odłamów three wyśle ponownie przy ich następnym rysunku.
        const source = body.skin._gpu[data.skin.partIds[i]].geometry;
        if (sm.geometry.index === source.index) sm.geometry.setIndex(null);
        sm.geometry.dispose();
      }
      // Klony materiału dzielą węzły szablonu — zwalniamy tylko tekstury ciała.
      data.skin.texture?.dispose?.();
      data.skin.linksTexture?.dispose();
      for (const mesh of [data.skin.rims?.mesh, data.skin.ribs?.mesh]) if (mesh) {
        this.scene?.remove(mesh);
        mesh.dispose?.(); mesh.geometry.dispose();
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
