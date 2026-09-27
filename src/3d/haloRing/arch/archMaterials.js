// Ringi-archetypy — materiały i siatki z zebranych instancji (ArchBatch).
// Każdy materiał ma wersję BG (pod statkami) i FG (górna ściana nad
// płaszczyzną gry: #define HALO_FG — zanik i wycięcia jak w silniku Halo).
// Uniformy: wspólne obiekty { value } ringu (createHaloUniforms) + własne.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ARCH_GLASS_FRAGMENT,
  ARCH_GLASS_VERTEX,
  ARCH_INSTANCED_FRAGMENT,
  ARCH_INSTANCED_VERTEX,
  ARCH_LINE_FRAGMENT,
  ARCH_LINE_VERTEX,
  ARCH_POINTS_FRAGMENT,
  ARCH_POINTS_VERTEX,
  ARCH_STRIP_FRAGMENT,
  ARCH_STRIP_VERTEX
} from './archGLSL.js';

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

function makeShader(uniforms, vertexShader, fragmentShader, { fg = false, name = 'Arch', extra = {}, ...opts } = {}) {
  return new THREE.ShaderMaterial({
    name,
    uniforms: { ...uniforms, ...extra },
    vertexShader,
    fragmentShader,
    defines: fg ? { HALO_FG: '' } : {},
    ...opts
  });
}

export class ArchMaterials {
  constructor(uniforms) {
    this.uniforms = uniforms;
    this.list = [];
    this.pointScale = { value: 540 };
    this._inst = [null, null];
    this._instVC = [null, null];
  }
  _track(m) { this.list.push(m); return m; }

  instanced(fg = false, vertexColors = false) {
    const cache = vertexColors ? this._instVC : this._inst;
    const k = fg ? 1 : 0;
    if (!cache[k]) {
      cache[k] = this._track(makeShader(this.uniforms, ARCH_INSTANCED_VERTEX, ARCH_INSTANCED_FRAGMENT, {
        fg, name: fg ? 'ArchInstancedFG' : 'ArchInstanced', vertexColors
      }));
    }
    return cache[k];
  }

  strip({ map, emap, tint = [1, 1, 1], emitGain = 1, varScale = 900, fg = false, atlas = false }) {
    const m = makeShader(this.uniforms, ARCH_STRIP_VERTEX, ARCH_STRIP_FRAGMENT, {
      fg,
      name: fg ? 'ArchStripFG' : 'ArchStrip',
      side: THREE.DoubleSide,
      extra: {
        uMap: { value: map },
        uEmap: { value: emap },
        uTint: { value: new THREE.Vector3(...tint) },
        uEmitGain: { value: emitGain },
        uVarScale: { value: varScale }
      }
    });
    if (atlas) m.defines.ARCH_ATLAS = '';
    return this._track(m);
  }

  glass({ alpha = 0.12, fg = false } = {}) {
    return this._track(makeShader(this.uniforms, ARCH_GLASS_VERTEX, ARCH_GLASS_FRAGMENT, {
      fg,
      name: 'ArchGlass',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      extra: { uGlassAlpha: { value: alpha } }
    }));
  }

  lines({ color = [0.6, 0.7, 0.75], alpha = 0.55, fg = false } = {}) {
    return this._track(makeShader(this.uniforms, ARCH_LINE_VERTEX, ARCH_LINE_FRAGMENT, {
      fg,
      name: 'ArchLines',
      transparent: true,
      depthWrite: false,
      extra: { uLineColor: { value: new THREE.Vector3(...color) }, uLineAlpha: { value: alpha } }
    }));
  }

  points(fg = false) {
    return this._track(makeShader(this.uniforms, ARCH_POINTS_VERTEX, ARCH_POINTS_FRAGMENT, {
      fg,
      name: 'ArchPoints',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      extra: { uPointScale: this.pointScale }
    }));
  }

  dispose() {
    for (const m of this.list) m.dispose();
    this.list.length = 0;
  }
}

// InstancedMesh z partii (ArchBatch): macierze, barwy, aInst. Obwiednia
// liczona z pozycji instancji (+ zapas na rozmiar), żeby frustum culling
// three działał na kawałki ringu.
export function archBatchMesh(batch, geometry, material, { pad = 0 } = {}) {
  const n = batch.count;
  if (!n) return null;
  const geo = geometry.clone();
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(batch.a), 4);
  geo.setAttribute('aInst', inst);
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.instanceMatrix.array.set(batch.m);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(batch.c), 3);
  // obwiednia: środki instancji + największa skala
  const m = batch.m;
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
  mesh.boundingBox = new THREE.Box3(new THREE.Vector3(minX - r, minY - r, minZ - r), new THREE.Vector3(maxX + r, maxY + r, maxZ + r));
  mesh.boundingSphere = mesh.boundingBox.getBoundingSphere(new THREE.Sphere());
  geo.boundingSphere = mesh.boundingSphere.clone();
  geo.boundingBox = mesh.boundingBox.clone();
  mesh.frustumCulled = true;
  mesh.name = batch.name || 'ArchBatch';
  return mesh;
}

// Punkty świateł: pozycje, barwy (HDR), rozmiar i faza.
export function archPointsMesh(data, material) {
  const n = data.pos.length / 3;
  if (!n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(data.col, 3));
  g.setAttribute('aLight', new THREE.Float32BufferAttribute(data.light, 2));
  g.computeBoundingSphere();
  const pts = new THREE.Points(g, material);
  pts.name = 'ArchLights';
  pts.frustumCulled = true;
  return pts;
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
