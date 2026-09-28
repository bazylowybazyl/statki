// src/3d/asteroids/rockLayers.js
//
// Warstwa renderu skał jednego pasma pola — port dema/asteroidy-webgpu/rockLayers.js
// (zadanie 21; tam port dawnego rockLayer3D.js). Logika bez zmian: komórki pola
// ładowane z budżetem czasu (najbliższe środka kadru najpierw, z marginesem), GPU
// dostaje tylko skały W KADRZE rozdzielone na koszyki LOD według rozmiaru każdej
// skały na ekranie (jeden mesh na poziom LOD, jeden draw call na koszyk).
//
// Początek jest WSPÓLNY dla całego pola (Core3D.fx.origin — ten sam co siatki
// świateł i pul GPU): setOrigin() przepisuje dane wczytanych skał (świat gry −
// początek, double na CPU). Instancja ma dodatkowo transmitancję słońca (iStretch.w).
// Zmiany względem dema: siatki na warstwie passa Core3D (`layer`: 0 gra, 1 tło) pod
// grupą pola (`parent` stoi na początku pola), stały zakres wysyłki buforów (bez
// alokacji na klatkę).

import * as THREE from 'three/webgpu';
import { ROCK_LODS, pickRockLod } from './rockBank.js';
import { permanentUpdateRange, markLiveRange } from './tslCommon.js';

const FLOATS = 20;               // iPos 4, iRot 4, iSpin 4, iShape 4, iStretch 4
const LOD_CAPACITY = [24576, 12288, 4096, 2048, 512, 128];
const CULL_MARGIN = 0.12;
const REBUILD_MOVE = 0.05;

function cellKey(cx, cy) {
  return (cx + 1048576) * 2097152 + (cy + 1048576);
}

export const ROCK_INSTANCE_FLOATS = FLOATS;

class LodBuckets {
  constructor({ bank, material, renderOrder, name, capacities = LOD_CAPACITY, maxLod = LOD_CAPACITY.length - 1, layer = 0 }) {
    this.material = material;
    this.group = new THREE.Group();
    this.group.name = name;
    this.baseGeoms = bank.ensureGeometries();
    this.dropped = 0;
    this.lods = this.baseGeoms.map((base, i) => {
      const capacity = i > maxLod ? 1 : (capacities[i] ?? 64);
      const data = new Float32Array(capacity * FLOATS);
      const buffer = new THREE.InstancedInterleavedBuffer(data, FLOATS, 1);
      const range = permanentUpdateRange(buffer);
      const ig = new THREE.InstancedBufferGeometry();
      ig.setIndex(base.index);
      ig.setAttribute('position', base.getAttribute('position'));
      ig.setAttribute('aMip', base.getAttribute('aMip'));
      ig.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
      ig.setAttribute('iRot', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
      ig.setAttribute('iSpin', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
      ig.setAttribute('iShape', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
      ig.setAttribute('iStretch', new THREE.InterleavedBufferAttribute(buffer, 4, 16));
      ig.instanceCount = 0;
      ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(ig, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      mesh.visible = false;
      mesh.name = `${name}_lod${i}`;
      mesh.layers.set(layer);
      this.group.add(mesh);
      return { index: i, capacity, count: 0, data, buffer, range, geo: ig, mesh };
    });
    this._result = { drawn: 0, tris: 0 };
  }

  begin() {
    for (const L of this.lods) L.count = 0;
    this.dropped = 0;
  }

  slot(lod) {
    const L = this.lods[lod];
    if (L.count >= L.capacity) { this.dropped++; return -1; }
    return (L.count++) * FLOATS;
  }

  commit() {
    let drawn = 0;
    let tris = 0;
    for (const L of this.lods) {
      L.geo.instanceCount = L.count;
      L.mesh.visible = L.count > 0;
      if (L.count) markLiveRange(L.buffer, L.range, L.count * FLOATS);
      drawn += L.count;
      tris += L.count * 8 * ROCK_LODS[L.index].n * ROCK_LODS[L.index].n;
    }
    const res = this._result;
    res.drawn = drawn;
    res.tris = tris;
    return res;
  }

  /** Wszystkie koszyki puste i ukryte (pole poza kadrem). */
  clear() {
    for (const L of this.lods) {
      L.count = 0;
      L.geo.instanceCount = 0;
      L.mesh.visible = false;
    }
  }
}

export class RockLayer {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.parent grupa pola (stoi na początku pola)
   * @param {number} [o.layer] warstwa passa Core3D (0 = gra / ortho, 1 = tło / persp.)
   * @param {import('./rockBank.js').RockShapeBankGPU} o.bank
   * @param {THREE.NodeMaterial} o.material RockNodeMaterial
   * @param {import('../../game/asteroidBeltField.js').AsteroidBeltField} o.field
   * @param {number} o.bandIndex
   * @param {boolean} [o.perspective] pasmo w kamerze perspektywicznej (tło)
   * @param {(rock) => number} [o.zOf] z sceny instancji (domyślnie −rock.z)
   * @param {(x:number, y:number) => number} o.sunT transmitancja słońca w punkcie świata
   */
  constructor(o) {
    this.scene = o.parent;
    this.bank = o.bank;
    this.material = o.material;
    this.field = o.field;
    this.bandIndex = o.bandIndex;
    this.band = this.field.bands[this.bandIndex];
    this.perspective = !!o.perspective;
    this.zOf = o.zOf || ((rock) => -rock.z);
    this.sunT = o.sunT || (() => 1);
    this.minPx = o.minPx ?? 0.6;
    this.maxLod = Math.min(ROCK_LODS.length - 1, o.maxLod ?? ROCK_LODS.length - 1);
    this.fadeZoom = o.fadeZoom || null;
    this.marginFrac = o.marginFrac ?? 0.3;
    // Minerały (minerals.js): dopisywane przy kompaktowaniu dla skał w kadrze.
    this.minerals = o.minerals || null;
    // Skały przejęte przez wydobycie (asteroidMining.js — rysuje je minedRocks.js):
    // id rekordów pola pomijane przy kompaktowaniu.
    this.hidden = new Set();
    this.enabled = true;
    this.origin = { x: 0, y: 0 };
    this.stats = { instances: 0, drawn: 0, tris: 0, cells: 0, pending: 0, lods: [] };
    this._missing = [];
    this._order = [];
    // Porównanie kolejki komórek raz na warstwę (bez domknięcia przy każdej zmianie kadru).
    this._byDistance = (a, b) => this._missing[a + 2] - this._missing[b + 2];
    this._version = 0;
    this._built = { x: NaN, y: NaN, zoom: NaN, version: -1, minPx: NaN };
    this.buckets = new LodBuckets({
      bank: this.bank, material: this.material,
      renderOrder: o.renderOrder ?? 0, name: `AsteroidBelt:rocks_${this.band.id}`, maxLod: this.maxLod, layer: o.layer ?? 0
    });
    this.group = this.buckets.group;
    this.octaves = this.band.octaves.map((oct) => this._createOctave(oct, o.capacity ?? 4096));
    this.scene.add(this.group);
  }

  _createOctave(oct, capacity) {
    return {
      oct, capacity,
      data: new Float32Array(capacity * FLOATS),
      count: 0,
      slotRock: new Array(capacity),
      slotCell: new Int32Array(capacity),
      slotPos: new Int32Array(capacity),
      cells: new Map(),
      cellsById: new Map(),
      nextCellId: 1,
      active: false,
      range: null,
      pending: 0
    };
  }

  _grow(o) {
    const capacity = o.capacity * 2;
    const data = new Float32Array(capacity * FLOATS);
    data.set(o.data);
    const slotCell = new Int32Array(capacity);
    slotCell.set(o.slotCell);
    const slotPos = new Int32Array(capacity);
    slotPos.set(o.slotPos);
    o.slotRock.length = capacity;
    o.data = data;
    o.slotCell = slotCell;
    o.slotPos = slotPos;
    o.capacity = capacity;
  }

  setVisible(v) {
    this.enabled = !!v;
    this.group.visible = this.enabled;
    this.minerals?.setVisible(this.enabled);
  }

  /** Skała pola (id rekordu) znika z warstwy / wraca. */
  hide(id) {
    if (!this.hidden.has(id)) { this.hidden.add(id); this._version++; }
  }

  unhide(id) {
    if (this.hidden.delete(id)) this._version++;
  }

  /** Nowy lokalny początek sceny (świat gry, double): przepisanie danych. */
  setOrigin(x, y) {
    this.origin.x = x;
    this.origin.y = y;
    for (const o of this.octaves) {
      for (let s = 0; s < o.count; s++) this._writeSlot(o, s, o.slotRock[s]);
    }
    this._version++;
  }

  /**
   * @param {object} f cam {x,y,zoom} (świat gry), viewW, viewH [px], focalPx, time, budgetMs
   */
  update(f) {
    if (!this.enabled) return;
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    const camZ = f.focalPx / zoom;
    let minPx = this.minPx;
    if (this.fadeZoom) {
      const [full, gone] = this.fadeZoom;
      const t = Math.min(1, Math.max(0, (full - zoom) / Math.max(1e-6, full - gone)));
      minPx += t * t * (3 - 2 * t) * 60;
    }
    this.effectiveMinPx = minPx;
    const L = this.material.L;
    L.pxScale.value = this.perspective ? f.focalPx : zoom;
    L.camZ.value = this.perspective ? camZ : 0;
    L.minPx.value = minPx;

    const band = this.band;
    const spreadFar = this.perspective ? (camZ + band.zFar) / camZ : 1;
    const halfW = (f.viewW * 0.5 / zoom) * spreadFar;
    const halfH = (f.viewH * 0.5 / zoom) * spreadFar;
    const marginW = halfW * this.marginFrac;
    const marginH = halfH * this.marginFrac;
    const pxPerUnitNear = this.perspective ? f.focalPx / (camZ + band.zNear) : zoom;
    const budgetEnd = performance.now() + (f.budgetMs ?? 3);
    let pending = 0;
    let loaded = 0;
    let instances = 0;
    let cells = 0;
    const touches = this.field.rectTouchesBelt(f.cam.x - halfW - marginW, f.cam.y - halfH - marginH, f.cam.x + halfW + marginW, f.cam.y + halfH + marginH);
    for (const o of this.octaves) {
      const rPxMax = o.oct.d1 * 0.5 * pxPerUnitNear;
      const wanted = touches && rPxMax >= minPx;
      if (!wanted) {
        if (o.cells.size) this._unloadAll(o);
        o.active = false;
        continue;
      }
      o.active = true;
      const cs = o.oct.cell;
      const pad = o.oct.d1 * 0.5;
      const cx0 = Math.floor((f.cam.x - halfW - marginW - pad) / cs);
      const cx1 = Math.floor((f.cam.x + halfW + marginW + pad) / cs);
      const cy0 = Math.floor((f.cam.y - halfH - marginH - pad) / cs);
      const cy1 = Math.floor((f.cam.y + halfH + marginH + pad) / cs);
      const r = o.range;
      const rangeChanged = !r || r[0] !== cx0 || r[1] !== cx1 || r[2] !== cy0 || r[3] !== cy1;
      if (rangeChanged || o.pending > 0) {
        if (!o.range) o.range = [0, 0, 0, 0];
        o.range[0] = cx0; o.range[1] = cx1; o.range[2] = cy0; o.range[3] = cy1;
        for (const cell of o.cells.values()) {
          if (cell.cx < cx0 - 1 || cell.cx > cx1 + 1 || cell.cy < cy0 - 1 || cell.cy > cy1 + 1) this._unloadCell(o, cell);
        }
        const missing = this._missing;
        missing.length = 0;
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            if (!o.cells.has(cellKey(cx, cy))) {
              const dx = (cx + 0.5) * cs - f.cam.x;
              const dy = (cy + 0.5) * cs - f.cam.y;
              missing.push(cx, cy, dx * dx + dy * dy);
            }
          }
        }
        o.pending = 0;
        if (missing.length) {
          const order = this._order;
          order.length = 0;
          for (let i = 0; i < missing.length; i += 3) order.push(i);
          order.sort(this._byDistance);
          for (let j = 0; j < order.length; j++) {
            const i = order[j];
            if (loaded > 0 && performance.now() > budgetEnd) { o.pending++; continue; }
            this._loadCell(o, missing[i], missing[i + 1]);
            loaded++;
          }
        }
        pending += o.pending;
      }
      instances += o.count;
      cells += o.cells.size;
    }
    this._compact(f, zoom, camZ, minPx);
    this.stats.instances = instances;
    this.stats.cells = cells;
    this.stats.pending = pending;
  }

  _compact(f, zoom, camZ, minPx) {
    const B = this._built;
    const viewWorldW = f.viewW / zoom;
    if (B.version === this._version
      && Math.abs(f.cam.x - B.x) < viewWorldW * REBUILD_MOVE
      && Math.abs(f.cam.y - B.y) < viewWorldW * REBUILD_MOVE
      && Math.abs(zoom - B.zoom) < B.zoom * 0.03
      && minPx === B.minPx) return;
    B.x = f.cam.x; B.y = f.cam.y; B.zoom = zoom; B.version = this._version; B.minPx = minPx;
    const buckets = this.buckets;
    buckets.begin();
    const M = this.minerals;
    M?.begin();
    const cx = f.cam.x - this.origin.x;
    const cy = -(f.cam.y - this.origin.y);
    const baseHalfW = (f.viewW * 0.5 / zoom) * (1 + CULL_MARGIN + REBUILD_MOVE);
    const baseHalfH = (f.viewH * 0.5 / zoom) * (1 + CULL_MARGIN) + (f.viewW / zoom) * REBUILD_MOVE;
    const persp = this.perspective;
    const focal = f.focalPx;
    const maxLod = this.maxLod;
    const lods = buckets.lods;
    const hidden = this.hidden.size ? this.hidden : null;
    for (const o of this.octaves) {
      if (!o.active || !o.count) continue;
      const d = o.data;
      for (let s = 0; s < o.count; s++) {
        if (hidden && hidden.has(o.slotRock[s].id)) continue;
        const b = s * FLOATS;
        const r = d[b + 3];
        let pxPerUnit = zoom;
        let halfW = baseHalfW;
        let halfH = baseHalfH;
        if (persp) {
          const k = (camZ - d[b + 2]) / camZ;
          pxPerUnit = focal / (camZ - d[b + 2]);
          halfW *= k;
          halfH *= k;
        }
        const rr = r * 1.5;
        if (Math.abs(d[b] - cx) > halfW + rr || Math.abs(d[b + 1] - cy) > halfH + rr) continue;
        const rPx = r * pxPerUnit;
        if (rPx < minPx) continue;
        const lod = pickRockLod(rPx, maxLod);
        const dst = buckets.slot(lod);
        if (dst < 0) continue;
        const out = lods[lod].data;
        for (let i = 0; i < FLOATS; i++) out[dst + i] = d[b + i];
        if (M) M.appendRock(out, dst, rPx);
      }
    }
    M?.commit();
    const res = buckets.commit();
    this.stats.drawn = res.drawn;
    this.stats.tris = res.tris;
    const lodStats = this.stats.lods;
    for (let i = 0; i < lods.length; i++) lodStats[i] = lods[i].count;
  }

  _writeSlot(o, s, rock) {
    const d = o.data;
    const b = s * FLOATS;
    d[b] = rock.x - this.origin.x;
    d[b + 1] = -(rock.y - this.origin.y);
    d[b + 2] = this.zOf(rock);
    d[b + 3] = rock.r;
    d[b + 4] = rock.qx; d[b + 5] = rock.qy; d[b + 6] = rock.qz; d[b + 7] = rock.qw;
    d[b + 8] = rock.ax; d[b + 9] = rock.ay; d[b + 10] = rock.az; d[b + 11] = rock.spin;
    d[b + 12] = rock.shape; d[b + 13] = rock.type; d[b + 14] = rock.seed; d[b + 15] = rock.phase;
    d[b + 16] = rock.sx; d[b + 17] = rock.sy; d[b + 18] = rock.sz; d[b + 19] = this.sunT(rock.x, rock.y);
  }

  _loadCell(o, cx, cy) {
    const key = cellKey(cx, cy);
    const rocks = this.field.cellRocks(this.bandIndex, o.oct.k, cx, cy);
    const cell = { id: o.nextCellId++, cx, cy, slots: [] };
    o.cells.set(key, cell);
    o.cellsById.set(cell.id, cell);
    for (let i = 0; i < rocks.length; i++) {
      if (o.count >= o.capacity) this._grow(o);
      const s = o.count++;
      o.slotRock[s] = rocks[i];
      o.slotCell[s] = cell.id;
      o.slotPos[s] = cell.slots.length;
      cell.slots.push(s);
      this._writeSlot(o, s, rocks[i]);
    }
    this._version++;
  }

  _unloadCell(o, cell) {
    const slots = cell.slots.sort((a, b) => b - a);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const last = o.count - 1;
      if (s !== last) {
        o.data.copyWithin(s * FLOATS, last * FLOATS, last * FLOATS + FLOATS);
        const ownerId = o.slotCell[last];
        const owner = o.cellsById.get(ownerId);
        const pos = o.slotPos[last];
        owner.slots[pos] = s;
        o.slotRock[s] = o.slotRock[last];
        o.slotCell[s] = ownerId;
        o.slotPos[s] = pos;
      }
      o.slotRock[last] = undefined;
      o.count = last;
    }
    o.cells.delete(cellKey(cell.cx, cell.cy));
    o.cellsById.delete(cell.id);
    this._version++;
  }

  _unloadAll(o) {
    o.cells.clear();
    o.cellsById.clear();
    for (let s = 0; s < o.count; s++) o.slotRock[s] = undefined;
    o.count = 0;
    o.range = null;
    o.pending = 0;
    this._version++;
  }

  /** Wszystkie wczytane skały (rekordy pola, tylko do odczytu) — bez przejętych przez wydobycie. */
  forEachLoaded(cb) {
    const hidden = this.hidden.size ? this.hidden : null;
    for (const o of this.octaves) {
      if (!o.active) continue;
      for (let s = 0; s < o.count; s++) {
        if (hidden && hidden.has(o.slotRock[s].id)) continue;
        cb(o.slotRock[s], o.data, s * FLOATS);
      }
    }
  }

  /** Czy są wczytane skały (pole trzyma początek pul, dopóki coś jest w pamięci). */
  get hasLoaded() {
    for (const o of this.octaves) if (o.count > 0) return true;
    return false;
  }

  /** Pole poza kadrem: komórki wyładowane, koszyki i minerały puste. */
  clear() {
    for (const o of this.octaves) {
      if (o.count || o.cells.size) this._unloadAll(o);
      o.active = false;
    }
    this.buckets.clear();
    this.minerals?.clear();
    this._built.version = -1;
    this.stats.instances = 0;
    this.stats.drawn = 0;
    this.stats.tris = 0;
    this.stats.cells = 0;
    this.stats.pending = 0;
  }
}

/**
 * Skały podane wprost (galerie dema; w grze — skały z HP) na tej samej siatce
 * banku i tym samym materiale co warstwa. Rekordy jak z AsteroidBeltField
 * (x, y, z, r, q*, a*, spin, phase, shape, type, seed, s*); pozycje względem
 * wspólnego początku sceny — port RockSet3D z rockLayer3D.js.
 */
export class RockSet {
  constructor({ parent, layer = 0, bank, material, renderOrder = 1, perspective = false, zOf = null, name = 'rockSet', maxLod = ROCK_LODS.length - 1, minerals = null, sunT = null }) {
    this.scene = parent;
    this.minerals = minerals;
    this.material = material;
    this.perspective = perspective;
    this.zOf = zOf || ((rock) => -rock.z);
    this.sunT = sunT || (() => 1);
    this.maxLod = maxLod;
    this.origin = { x: 0, y: 0 };
    this.rocks = [];
    this.buckets = new LodBuckets({ bank, material, renderOrder, name, capacities: [512, 512, 256, 128, 64, 32], maxLod, layer });
    this.group = this.buckets.group;
    this.scene.add(this.group);
    this.enabled = true;
    this._dirty = true;
    this._lastPx = -1;
    this.stats = { drawn: 0, tris: 0 };
  }

  set(rocks) {
    this.rocks = rocks;
    this._dirty = true;
  }

  setOrigin(x, y) {
    this.origin.x = x;
    this.origin.y = y;
    this._dirty = true;
  }

  /** f: cam, viewW, viewH, focalPx (jak RockLayer.update). */
  update(f) {
    if (!this.enabled) return;
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    const camZ = f.focalPx / zoom;
    const L = this.material.L;
    L.pxScale.value = this.perspective ? f.focalPx : zoom;
    L.camZ.value = this.perspective ? camZ : 0;
    const px = this.perspective ? f.focalPx / camZ : zoom;
    if (!this._dirty && Math.abs(px - this._lastPx) <= this._lastPx * 0.15) return;
    this._dirty = false;
    this._lastPx = px;
    const B = this.buckets;
    B.begin();
    const M = this.minerals;
    M?.begin();
    for (const rock of this.rocks) {
      if (rock.alive === false) continue;
      const pxPerUnit = this.perspective ? f.focalPx / (camZ + (rock.z || 0)) : zoom;
      const rPx = rock.r * pxPerUnit;
      const lod = pickRockLod(rPx, this.maxLod);
      const b = B.slot(lod);
      if (b < 0) continue;
      const d = B.lods[lod].data;
      d[b] = rock.x - this.origin.x;
      d[b + 1] = -(rock.y - this.origin.y);
      d[b + 2] = this.zOf(rock);
      d[b + 3] = rock.r;
      d[b + 4] = rock.qx; d[b + 5] = rock.qy; d[b + 6] = rock.qz; d[b + 7] = rock.qw;
      d[b + 8] = rock.ax; d[b + 9] = rock.ay; d[b + 10] = rock.az; d[b + 11] = rock.spin;
      d[b + 12] = rock.shape; d[b + 13] = rock.type; d[b + 14] = rock.seed; d[b + 15] = rock.phase;
      d[b + 16] = rock.sx; d[b + 17] = rock.sy; d[b + 18] = rock.sz; d[b + 19] = this.sunT(rock.x, rock.y);
      if (M) M.appendRock(d, b, rPx);
    }
    const res = B.commit();
    M?.commit();
    this.stats.drawn = res.drawn;
    this.stats.tris = res.tris;
  }

  setVisible(v) {
    this.enabled = !!v;
    this.group.visible = this.enabled;
    this.minerals?.setVisible(this.enabled);
  }
}
