// src/3d/rocks/rockLayer3D.js
//
// Warstwa renderu skał jednego pasma pola (AsteroidBeltField).
//
// Dane skał wczytanych komórek trzymamy na CPU per oktawa rozmiaru (komórki
// ładują się z budżetem czasu, najbliższe środka kadru najpierw, z marginesem
// — skała nie ma prawa „wyskoczyć” w widoku). GPU dostaje co przebudowę tylko
// skały W KADRZE, rozdzielone na koszyki LOD według rozmiaru KAŻDEJ skały na
// ekranie (jeden mesh na poziom LOD). Dawniej LOD szedł per oktawa dla
// wszystkich wczytanych skał — także setek poza kadrem — i przy zbliżeniu
// było 25–37 mln trójkątów na klatkę.
//
// Przebudowa zbioru tylko gdy kamera odjedzie o kilka % kadru, zmieni się
// zoom albo komórki; obrót liczy shader (uTime), więc stojąca kamera nic
// nie wysyła. Pozycje instancji są względem „lepkiego” początku przy kamerze
// (float32 na GPU bez drgań — sceneOrigin.js).

import * as THREE from 'three';
import { ROCK_LODS, pickRockLod } from './rockShapes3D.js';

const FLOATS = 20;               // iPos 4, iRot 4, iSpin 4, iShape 4, iStretch 4
const ORIGIN_REBASE = 120000;    // [j.] odjazd kamery, po którym przepisujemy pozycje
// Stałe pojemności koszyków LOD (nadmiar pomijany). Bez wzrostu w trakcie gry:
// zwolnienie starej geometrii instancji usuwałoby w three także współdzielone
// bufory siatki bazowej, z których korzystają pozostałe LOD-y.
const LOD_CAPACITY = [24576, 12288, 4096, 2048, 512, 128];
// Zapas kadru przy odrzucaniu i próg przebudowy (ułamek szerokości kadru).
const CULL_MARGIN = 0.12;
const REBUILD_MOVE = 0.05;

// Klucz komórki bez stringów (|cx|, |cy| < 2^20 — świat 12 mln j. przy komórce ≥ 1024 j.).
function cellKey(cx, cy) {
  return (cx + 1048576) * 2097152 + (cy + 1048576);
}

/** Meshe per poziom LOD z rosnącymi buforami instancji (wspólne dla warstw i zestawów). */
class LodBuckets {
  constructor({ bank, material, renderLayer, renderOrder, name, capacities = LOD_CAPACITY, maxLod = LOD_CAPACITY.length - 1 }) {
    this.material = material;
    this.group = new THREE.Group();
    this.group.name = name;
    this.baseGeoms = bank.ensureGeometries();
    this.dropped = 0;
    this.lods = this.baseGeoms.map((base, i) => {
      // LOD powyżej sufitu warstwy nigdy nie dostanie instancji — minimalny bufor.
      const capacity = i > maxLod ? 1 : (capacities[i] ?? 64);
      const data = new Float32Array(capacity * FLOATS);
      const buffer = new THREE.InstancedInterleavedBuffer(data, FLOATS, 1);
      buffer.setUsage(THREE.DynamicDrawUsage);
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
      mesh.layers.set(renderLayer);
      mesh.visible = false;
      mesh.name = `${name}_lod${i}`;
      this.group.add(mesh);
      return { index: i, capacity, count: 0, data, buffer, geo: ig, mesh };
    });
  }

  begin() {
    for (const L of this.lods) L.count = 0;
    this.dropped = 0;
  }

  /** Offset kolejnej instancji w koszyku (L.data) albo −1, gdy koszyk pełny. */
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
      if (L.count) {
        L.buffer.clearUpdateRanges?.();
        L.buffer.addUpdateRange(0, L.count * FLOATS);
        L.buffer.needsUpdate = true;
      }
      drawn += L.count;
      tris += L.count * 8 * ROCK_LODS[L.index].n * ROCK_LODS[L.index].n;
    }
    return { drawn, tris };
  }

  setOrigin(x, y) {
    for (const L of this.lods) L.mesh.position.set(x, -y, 0);
    this.group.updateMatrixWorld(true);
  }

  dispose() {
    for (const L of this.lods) L.geo.dispose();
  }
}

export class RockLayer3D {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {import('./rockShapes3D.js').RockShapeBank} o.bank
   * @param {THREE.ShaderMaterial} o.material
   * @param {import('../../game/asteroidBeltField.js').AsteroidBeltField} o.field
   * @param {number} o.bandIndex
   * @param {number} o.renderLayer warstwa three (0 = ortho gry, 1 = tło)
   * @param {boolean} [o.perspective] pasmo w kamerze perspektywicznej (tło)
   * @param {number} [o.renderOrder]
   * @param {number} [o.maxLod] najgęstszy poziom LOD tej warstwy
   * @param {(rock) => number} [o.zOf] głębokość sceny instancji (domyślnie −rock.z)
   * @param {import('./rockMinerals3D.js').MineralLayer3D} [o.minerals] kryształy/lód/tabliczki na skałach
   */
  constructor(o) {
    this.scene = o.scene;
    this.minerals = o.minerals || null;
    this.bank = o.bank;
    this.material = o.material;
    this.field = o.field;
    this.bandIndex = o.bandIndex;
    this.band = this.field.bands[this.bandIndex];
    this.perspective = !!o.perspective;
    this.renderLayer = o.renderLayer ?? 0;
    this.zOf = o.zOf || ((rock) => -rock.z);
    this.minPx = o.minPx ?? 0.6;
    this.maxLod = Math.min(ROCK_LODS.length - 1, o.maxLod ?? ROCK_LODS.length - 1);
    // [zoom pełny, zoom zgaszony]: przy oddaleniu próg pikseli rośnie i skały
    // pasma maleją do zera (bez wyskakiwania) — drobnica tła przy mapie taktycznej
    // to tysiące subpikselowych komórek bez wartości.
    this.fadeZoom = o.fadeZoom || null;
    this.marginFrac = o.marginFrac ?? 0.3;
    this.enabled = true;
    this.origin = { x: NaN, y: NaN };
    this.stats = { instances: 0, drawn: 0, tris: 0, cells: 0, pending: 0, loadedThisFrame: 0, lods: [] };
    this._missing = [];
    this._order = [];
    this._version = 0;
    this._built = { x: NaN, y: NaN, zoom: NaN, version: -1, minPx: NaN };
    this.buckets = new LodBuckets({
      bank: this.bank, material: this.material, renderLayer: this.renderLayer,
      renderOrder: o.renderOrder ?? 0, name: `rocks_${this.band.id}`, maxLod: this.maxLod
    });
    this.group = this.buckets.group;
    this.octaves = this.band.octaves.map((oct) => this._createOctave(oct, o.capacity ?? 4096));
    this.scene.add(this.group);
  }

  _createOctave(oct, capacity) {
    return {
      oct,
      capacity,
      data: new Float32Array(capacity * FLOATS),
      count: 0,
      slotRock: new Array(capacity),
      slotCell: new Int32Array(capacity),
      slotPos: new Int32Array(capacity),
      cells: new Map(),          // cellKey(cx, cy) → { id, cx, cy, slots: [] }
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

  /**
   * @param {object} f
   * @param {{x:number,y:number,zoom:number}} f.cam kamera gry
   * @param {number} f.viewW szerokość kadru [px CSS]
   * @param {number} f.viewH wysokość kadru [px CSS]
   * @param {number} f.focalPx ogniskowa kamery persp. [px] = (H/2)/tan(fov/2)
   * @param {number} f.time czas [s] obrotu skał
   * @param {number} f.sunX @param {number} f.sunY słońce w świecie gry
   * @param {number} [f.budgetMs] czas na generowanie komórek w tej klatce
   */
  update(f) {
    if (!this.enabled) return;
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    const camZ = f.focalPx / zoom;
    // Lepki początek przy kamerze.
    if (!(Math.abs(f.cam.x - this.origin.x) < ORIGIN_REBASE && Math.abs(f.cam.y - this.origin.y) < ORIGIN_REBASE)) {
      this._rebase(f.cam.x, f.cam.y);
    }
    let minPx = this.minPx;
    if (this.fadeZoom) {
      const [full, gone] = this.fadeZoom;
      const t = Math.min(1, Math.max(0, (full - zoom) / Math.max(1e-6, full - gone)));
      minPx += t * t * (3 - 2 * t) * 60;
    }
    this.effectiveMinPx = minPx;
    const u = this.material.uniforms;
    u.uTime.value = f.time;
    u.uSunRel.value.set(f.sunX - this.origin.x, -(f.sunY - this.origin.y), 0);
    u.uPxScale.value = this.perspective ? f.focalPx : zoom;
    u.uCamZ.value = this.perspective ? camZ : 0;
    u.uMinPx.value = minPx;

    const band = this.band;
    // Kadr na najdalszej głębokości pasma (perspektywa widzi tam szerzej).
    const spreadFar = this.perspective ? (camZ + band.zFar) / camZ : 1;
    const halfW = (f.viewW * 0.5 / zoom) * spreadFar;
    const halfH = (f.viewH * 0.5 / zoom) * spreadFar;
    const marginW = halfW * this.marginFrac;
    const marginH = halfH * this.marginFrac;
    // Największa skala na ekranie w paśmie (najbliższa głębokość).
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
        o.range = [cx0, cx1, cy0, cy1];
        // Zwalnianie z histerezą jednej komórki (kamera na granicy nie miga).
        for (const cell of o.cells.values()) {
          if (cell.cx < cx0 - 1 || cell.cx > cx1 + 1 || cell.cy < cy0 - 1 || cell.cy > cy1 + 1) this._unloadCell(o, cell);
        }
        // Ładowanie brakujących, od środka kadru.
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
          order.sort((a, b) => missing[a + 2] - missing[b + 2]);
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
    this.minerals?.syncFrom(this.material);
    this.stats.instances = instances;
    this.stats.cells = cells;
    this.stats.pending = pending;
    this.stats.loadedThisFrame = loaded;
  }

  /**
   * Zbiór do narysowania: skały w kadrze (z zapasem), LOD per skała z jej
   * rozmiaru na ekranie. Pomijany, gdy kamera stoi (±5% kadru), zoom ten sam
   * i komórki bez zmian.
   */
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
    const minerals = this.minerals;
    minerals?.begin();
    // Kamera względem początku warstwy (scena: y odwrócone).
    const cx = f.cam.x - this.origin.x;
    const cy = -(f.cam.y - this.origin.y);
    const baseHalfW = (f.viewW * 0.5 / zoom) * (1 + CULL_MARGIN + REBUILD_MOVE);
    const baseHalfH = (f.viewH * 0.5 / zoom) * (1 + CULL_MARGIN) + (f.viewW / zoom) * REBUILD_MOVE;
    const persp = this.perspective;
    const focal = f.focalPx;
    const maxLod = this.maxLod;
    const lods = buckets.lods;
    for (const o of this.octaves) {
      if (!o.active || !o.count) continue;
      const d = o.data;
      for (let s = 0; s < o.count; s++) {
        const b = s * FLOATS;
        const r = d[b + 3];
        let pxPerUnit = zoom;
        let halfW = baseHalfW;
        let halfH = baseHalfH;
        if (persp) {
          const k = (camZ - d[b + 2]) / camZ;   // d[b+2] = z sceny (ujemne = głębiej)
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
        if (minerals) minerals.appendRock(d, b, rPx);
      }
    }
    const res = buckets.commit();
    minerals?.commit();
    this.stats.drawn = res.drawn;
    this.stats.tris = res.tris;
    this.stats.lods = lods.map((L) => L.count);
  }

  _rebase(x, y) {
    this.origin.x = x;
    this.origin.y = y;
    for (const o of this.octaves) {
      for (let s = 0; s < o.count; s++) this._writeSlot(o, s, o.slotRock[s]);
    }
    this.buckets.setOrigin(x, y);
    this.minerals?.setOrigin(x, y);
    this._version++;
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
    d[b + 16] = rock.sx; d[b + 17] = rock.sy; d[b + 18] = rock.sz; d[b + 19] = 0;
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
    // Od najwyższego slotu: ostatni slot bufora nigdy nie należy do tej komórki
    // wyżej niż bieżący, więc przeniesienie nie psuje jej listy.
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

  /** Skały wczytane w pobliżu punktu (np. źródła światła) — bez alokacji wyniku. */
  forEachLoaded(cb) {
    for (const o of this.octaves) {
      if (!o.active) continue;
      for (let s = 0; s < o.count; s++) cb(o.slotRock[s]);
    }
  }

  /** Wszystkie komórki od nowa (zmiana gęstości/parametrów pola). */
  reset() {
    for (const o of this.octaves) this._unloadAll(o);
    this.buckets.begin();
    this.buckets.commit();
  }

  dispose() {
    this.scene.remove(this.group);
    this.buckets.dispose();
    this.minerals?.dispose();
  }
}

/**
 * Zestaw skał podanych wprost (bez komórek pola): galeria w demie, a w grze
 * skały z własnym stanem (HP, ruch po pchnięciu). Skała trafia do LOD-u ze
 * swojego rozmiaru na ekranie. `set(rocks)` oznacza przebudowę, `update()`
 * ustawia uniformy i przebudowuje przy zmianie zoomu o > 15%.
 */
export class RockSet3D {
  constructor({ scene, bank, material, renderLayer = 0, renderOrder = 0, perspective = false, zOf = null, name = 'rockSet', maxLod = ROCK_LODS.length - 1, minerals = null }) {
    this.scene = scene;
    this.minerals = minerals;
    this.bank = bank;
    this.material = material;
    this.perspective = perspective;
    this.zOf = zOf || ((rock) => -rock.z);
    this.maxLod = maxLod;
    this.origin = { x: 0, y: 0 };
    this.rocks = [];
    this.buckets = new LodBuckets({ bank, material, renderLayer, renderOrder, name, capacities: [512, 512, 256, 128, 64, 32], maxLod });
    this.group = this.buckets.group;
    this.scene.add(this.group);
    this._lastPxScale = -1;
  }

  /** Rekordy jak z AsteroidBeltField (x, y, z, r, q*, a*, spin, phase, shape, type, seed, s*). */
  set(rocks) {
    this.rocks = rocks;
    this._dirty = true;
  }

  update(f) {
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    const camZ = f.focalPx / zoom;
    const u = this.material.uniforms;
    if (Math.abs(f.cam.x - this.origin.x) > 100000 || Math.abs(f.cam.y - this.origin.y) > 100000) {
      this.origin.x = f.cam.x;
      this.origin.y = f.cam.y;
      this._dirty = true;
    }
    u.uTime.value = f.time;
    u.uSunRel.value.set(f.sunX - this.origin.x, -(f.sunY - this.origin.y), 0);
    u.uPxScale.value = this.perspective ? f.focalPx : zoom;
    u.uCamZ.value = this.perspective ? camZ : 0;
    const pxScale = this.perspective ? f.focalPx / camZ : zoom;
    if (this._dirty || Math.abs(pxScale - this._lastPxScale) > this._lastPxScale * 0.15) {
      this._lastPxScale = pxScale;
      this._rebuild(f, camZ);
    }
    this.minerals?.syncFrom(this.material);
  }

  _rebuild(f, camZ) {
    this._dirty = false;
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    const B = this.buckets;
    B.begin();
    const M = this.minerals;
    M?.begin();
    for (const rock of this.rocks) {
      if (rock.alive === false) continue;
      const depth = rock.z || 0;
      const pxPerUnit = this.perspective ? f.focalPx / (camZ + depth) : zoom;
      const lod = pickRockLod(rock.r * pxPerUnit, this.maxLod);
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
      d[b + 16] = rock.sx; d[b + 17] = rock.sy; d[b + 18] = rock.sz; d[b + 19] = 0;
      if (M) M.appendRock(d, b, rock.r * pxPerUnit);
    }
    B.commit();
    B.setOrigin(this.origin.x, this.origin.y);
    if (M) {
      M.commit();
      M.setOrigin(this.origin.x, this.origin.y);
    }
  }

  setVisible(v) {
    this.group.visible = !!v;
    this.minerals?.setVisible(v);
  }

  dispose() {
    this.scene.remove(this.group);
    this.buckets.dispose();
    this.minerals?.dispose();
  }
}

export { ROCK_LODS };
