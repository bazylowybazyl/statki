// Ringi-archetypy — materiały i siatki z zebranych instancji (ArchBatch).
// Każdy materiał ma wersję BG (pod statkami) i FG (górna ściana nad
// płaszczyzną gry: zanik i wycięcia jak w silniku Halo — dawne #define HALO_FG).
// Uniformy: wspólne obiekty { value } ringu (createHaloUniforms) + własne węzły uniform()
// materiału (`.value` jak dawniej).
//
// Port WebGPU (zadanie 10): materiały węzłowe z archTSL.js (dawne archGLSL.js), warianty
// (FG, atlas, barwy w wierzchołkach) budowane raz; partie instancji to zwykłe siatki z
// InstancedBufferGeometry (JEDEN przeplecony bufor: macierz, barwa, aInst — ARCH_INST_STRIDE),
// nie THREE.InstancedMesh (uuid InstancedMesh w kluczu programu = budowa NodeBuildera na
// partię, PLAN §3); punkty świateł to kwadraty instancjonowane (punkt WebGPU ma 1 px).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uniform } from 'three/tsl';
import {
  ARCH_INST_LAYOUT,
  ARCH_INST_STRIDE,
  ARCH_LIGHT_LAYOUT,
  ARCH_LIGHT_STRIDE,
  archNodeMaterial,
  makeArchGlassNodes,
  makeArchInstancedNodes,
  makeArchLineNodes,
  makeArchPointNodes,
  makeArchStripNodes
} from './archTSL.js';

export const ARCH_KIND = Object.freeze({ plain: 0, ecumene: 1, glow: 2, fable: 3, panel: 4, radiator: 5, water: 6 });

// Bryły jednostkowe (podstawa na y = 0, jak `assets.box` / UNIT_BOX_BASE dem).
export function archUnitGeometries() {
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0);
  const cyl8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0);
  const sphere = new THREE.SphereGeometry(1, 16, 10);
  const disc = new THREE.CylinderGeometry(1, 1, 1, 40).translate(0, 0.5, 0);
  for (const g of [box, cube, cyl, cyl8, sphere, disc]) g.deleteAttribute('uv');
  return { box, cube, cyl, cyl8, sphere, disc };
}

export class ArchMaterials {
  constructor(uniforms) {
    this.uniforms = uniforms;
    this.list = [];
    // rozmiar punktów świateł: wysokość bufora · 0,5 · projectionMatrix[1][1] (archRing.update)
    this.pointScale = uniform(540);
    this._inst = [null, null];
    this._instVC = [null, null];
  }
  _track(m) { this.list.push(m); return m; }

  instanced(fg = false, vertexColors = false) {
    const cache = vertexColors ? this._instVC : this._inst;
    const k = fg ? 1 : 0;
    if (!cache[k]) {
      cache[k] = this._track(archNodeMaterial(fg ? 'ArchInstancedFG' : 'ArchInstanced',
        makeArchInstancedNodes({ u: this.uniforms, fg, vertexColors }), {}, { ...this.uniforms }));
    }
    return cache[k];
  }

  strip({ map, emap, tint = [1, 1, 1], emitGain = 1, varScale = 900, fg = false, atlas = false }) {
    const uTint = uniform(new THREE.Vector3(...tint));
    const uEmitGain = uniform(emitGain);
    const uVarScale = uniform(varScale);
    const nodes = makeArchStripNodes({ u: this.uniforms, fg, atlas, map, emap, tint: uTint, emitGain: uEmitGain, varScale: uVarScale });
    return this._track(archNodeMaterial(fg ? 'ArchStripFG' : 'ArchStrip', nodes, { side: THREE.DoubleSide }, {
      ...this.uniforms, uMap: nodes.uniforms.uMap, uEmap: nodes.uniforms.uEmap, uTint, uEmitGain, uVarScale
    }));
  }

  glass({ alpha = 0.12, fg = false } = {}) {
    const uGlassAlpha = uniform(alpha);
    // przezroczyste DoubleSide w jednym przebiegu jak ShaderMaterial w bazie (forceSinglePass)
    return this._track(archNodeMaterial('ArchGlass', makeArchGlassNodes({ u: this.uniforms, fg, glassAlpha: uGlassAlpha }), {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true
    }, { ...this.uniforms, uGlassAlpha }));
  }

  lines({ color = [0.6, 0.7, 0.75], alpha = 0.55, fg = false } = {}) {
    const uLineColor = uniform(new THREE.Vector3(...color));
    const uLineAlpha = uniform(alpha);
    return this._track(archNodeMaterial('ArchLines', makeArchLineNodes({ u: this.uniforms, fg, lineColor: uLineColor, lineAlpha: uLineAlpha }), {
      transparent: true,
      depthWrite: false
    }, { ...this.uniforms, uLineColor, uLineAlpha }));
  }

  points(fg = false) {
    // dawne AdditiveBlending ShaderMaterial w WebGL: blendFunc(SRC_ALPHA, ONE) dla barwy i alfy
    return this._track(archNodeMaterial('ArchPoints', makeArchPointNodes({ u: this.uniforms, fg, pointScale: this.pointScale }), {
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.SrcAlphaFactor,
      blendDstAlpha: THREE.OneFactor
    }, { ...this.uniforms, uPointScale: this.pointScale }));
  }

  dispose() {
    for (const m of this.list) m.dispose();
    this.list.length = 0;
  }
}

// Geometria partii: bryła bazowa (wspólne bufory position / normal / color / index) + JEDEN
// przeplecony bufor instancji (ARCH_INST_LAYOUT). Wynik: { geo, data }.
export function archInstancedGeometry(base, data, count) {
  const geo = new THREE.InstancedBufferGeometry();
  if (base.index) geo.setIndex(base.index);
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  if (base.getAttribute('color')) geo.setAttribute('color', base.getAttribute('color'));
  const buf = new THREE.InstancedInterleavedBuffer(data, ARCH_INST_STRIDE);
  for (const [name, [offset, size]] of Object.entries(ARCH_INST_LAYOUT)) {
    geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, size, offset));
  }
  geo.instanceCount = count;
  return geo;
}

// Siatka z partii (ArchBatch): macierze, barwy, aInst. Obwiednia liczona z pozycji instancji
// (+ zapas na rozmiar), żeby frustum culling three działał na kawałki ringu.
export function archBatchMesh(batch, geometry, material, { pad = 0 } = {}) {
  const n = batch.count;
  if (!n) return null;
  const m = batch.m;
  const data = new Float32Array(n * ARCH_INST_STRIDE);
  for (let i = 0; i < n; i++) {
    const o = i * ARCH_INST_STRIDE;
    for (let k = 0; k < 16; k++) data[o + k] = m[i * 16 + k];
    data[o + 16] = batch.c[i * 3];
    data[o + 17] = batch.c[i * 3 + 1];
    data[o + 18] = batch.c[i * 3 + 2];
    for (let k = 0; k < 4; k++) data[o + 20 + k] = batch.a[i * 4 + k];
  }
  const geo = archInstancedGeometry(geometry, data, n);
  // obwiednia: środki instancji + największa skala
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  let big = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    const x = m[o + 12]; const y = m[o + 13]; const z = m[o + 14];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    const s = Math.max(Math.hypot(m[o], m[o + 1], m[o + 2]), Math.hypot(m[o + 4], m[o + 5], m[o + 6]), Math.hypot(m[o + 8], m[o + 9], m[o + 10]));
    if (s > big) big = s;
  }
  const r = big * 1.75 + pad;
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(minX - r, minY - r, minZ - r), new THREE.Vector3(maxX + r, maxY + r, maxZ + r));
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = true;
  mesh.name = batch.name || 'ArchBatch';
  mesh.userData.instances = n;
  return mesh;
}

// Punkty świateł: pozycje, barwy (HDR), rozmiar i faza — kwadraty instancjonowane (dawne
// THREE.Points z gl_PointSize; punkt WebGPU ma 1 px). Kwadrat: 4 wierzchołki ±0,5, 2 trójkąty CCW.
export function archPointsMesh(data, material) {
  const n = data.pos.length / 3;
  if (!n) return null;
  const quadPositions = new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3);
  const quadIndex = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1);
  const arr = new Float32Array(n * ARCH_LIGHT_STRIDE);
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  let big = 0;
  for (let i = 0; i < n; i++) {
    const o = i * ARCH_LIGHT_STRIDE;
    const x = data.pos[i * 3]; const y = data.pos[i * 3 + 1]; const z = data.pos[i * 3 + 2];
    arr[o] = x; arr[o + 1] = y; arr[o + 2] = z;
    arr[o + 3] = data.col[i * 3]; arr[o + 4] = data.col[i * 3 + 1]; arr[o + 5] = data.col[i * 3 + 2];
    arr[o + 6] = data.light[i * 2]; arr[o + 7] = data.light[i * 2 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    if (data.light[i * 2] > big) big = data.light[i * 2];
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(quadIndex);
  g.setAttribute('position', quadPositions);
  const buf = new THREE.InstancedInterleavedBuffer(arr, ARCH_LIGHT_STRIDE);
  for (const [name, [offset, size]] of Object.entries(ARCH_LIGHT_LAYOUT)) {
    g.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, size, offset));
  }
  g.instanceCount = n;
  // obwiednia z pozycji świateł (kwadrat ma rozmiar ekranowy — zapas na największe światło)
  const r = big * 2 + 50;
  g.boundingBox = new THREE.Box3(new THREE.Vector3(minX - r, minY - r, minZ - r), new THREE.Vector3(maxX + r, maxY + r, maxZ + r));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'ArchLights';
  mesh.frustumCulled = true;
  mesh.userData.instances = n;
  return mesh;
}

export class ArchLights {
  constructor() { this.pos = []; this.col = []; this.light = []; }
  add(x, y, z, color, size, phase = 0) {
    this.pos.push(x, y, z);
    this.col.push(color[0], color[1], color[2]);
    this.light.push(size, phase);
  }
}

// Półkula (makeHemisphere dema): ikosfera 5 przycięta równikiem.
export function archHemisphere() {
  const src = new THREE.IcosahedronGeometry(1, 5);
  const p = src.getAttribute('position');
  const out = [];
  for (let i = 0; i < p.count; i += 3) {
    const tri = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(p, i + j));
    const poly = [];
    for (let j = 0; j < 3; j++) {
      const a = tri[j];
      const b = tri[(j + 1) % 3];
      const ia = a.y >= -1e-7;
      const ib = b.y >= -1e-7;
      if (ia) poly.push(a.clone());
      if (ia !== ib) poly.push(a.clone().lerp(b, a.y / (a.y - b.y)).normalize());
    }
    for (let j = 1; j < poly.length - 1; j++) for (const v of [poly[0], poly[j], poly[j + 1]]) out.push(v.x, Math.max(0, v.y), v.z);
  }
  src.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out, 3));
  g.computeBoundingSphere();
  return g;
}

// Drzewo jednostkowe z barwą w wierzchołkach (pień ciemniej):
//  'ico'  — ECUMENE: korona-ikosfera (środek 0,64, promień 0,5 × 0,46) i pień
//           0,06 × 0,68; skala instancji x/z = 2 × promień korony, y = wysokość;
//  'cone' — Fable: dwa stożki korony + pień (createTreeGeometry dema).
export function archTreeGeometry(kind = 'ico') {
  let parts;
  if (kind === 'cone') {
    parts = [
      new THREE.ConeGeometry(0.5, 0.75, 6, 1).translate(0, 0.62, 0),
      new THREE.ConeGeometry(0.36, 0.5, 6, 1).translate(0, 0.85, 0),
      new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5).translate(0, 0.15, 0)
    ];
  } else {
    parts = [
      new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.92, 1).translate(0, 0.64, 0),
      new THREE.BoxGeometry(0.06, 0.68, 0.06).translate(0, 0.34, 0)
    ];
  }
  const flat = parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.getAttribute('uv')) n.deleteAttribute('uv'); return n; });
  const merged = mergeGeometries(flat, false);
  for (const g of new Set([...parts, ...flat])) g.dispose();
  const pos = merged.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const trunk = kind === 'cone' ? y < 0.31 : Math.abs(pos.getX(i)) < 0.031 && Math.abs(pos.getZ(i)) < 0.031 && y < 0.69;
    const v = trunk ? 0.35 : (kind === 'cone' ? 0.55 + 0.6 * y : 0.8 + 0.35 * y);
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}
