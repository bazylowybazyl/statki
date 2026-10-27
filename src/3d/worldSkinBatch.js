// src/3d/worldSkinBatch.js
//
// PARTIE skór ciał świata (2026-10-27, docs/AUDYT-baza-po-upadku-2026-10-27.md § 5). Odłam budowli (wyspa, wrak
// kawałka — worldBodies3D.js) był osobną siatką na zestaw (bryła 3D — na zestaw i połówkę), a każdy rysunek kosztuje
// ~15–25 µs CPU three r183: po upadku bazy piratów ~200 rysunków skór nad polem gruzu, klatka workera ~4,4 ms. Tu
// odłamy jednej (budowla × zestaw × rodzaj skóry) rysują się JEDNYM rysunkiem na stronę partii (bryła 3D — dwoma:
// połówka pod płaszczyzną w passie tła, nad nią w FG):
//  - wierzchołki PODZBIORU odłamu (fragmentSkinSubset — trójkąty kawałka, które odłam widzi) skopiowane do bufora strony
//    z przeplotem: pozycja, normalna i atrybuty wariantu „skin” tak jak w skórze kawałka, slot egzemplarza w aPbN.w
//    (kolumna, której graf nie czyta); indeks przesunięty na początek wpisu. Odłamy kawałka dzielą wierzchołki skóry
//    kawałka (podzbiory to indeksy), a dane egzemplarza są w wierzchołku — stąd kopia, nie wspólne atrybuty;
//  - dane egzemplarza (macierze, slot pola skóry, mapa ran, rany brył, flagi widoczności) w buforze storage ze slotem
//    (WorldSkinStore, układ WS) — wierzchołek czyta je po slocie z atrybutu, fragment po slocie z varyingu;
//  - przycinanie do kadru i połówek: flaga na (zestaw × połówka) egzemplarza (WS.FLAGS), liczona w haku passa tą samą
//    sferą i tym samym testem co three (worldBodies3D.commitWorldSkinStore) — wierzchołek niewidocznego egzemplarza
//    wypada poza bryłę obcinania bez liczenia FFD, a strona bez widocznego wpisu nie idzie do rysowania.
// Strony o stałej pojemności, wolne miejsca po usuniętych wpisach biorą nowe (pierwsze dopasowanie) — bez przepisywania
// partii (pełna wysyłka partii przy kompaktowaniu to dziesiątki MB w jednej klatce); wpis większy od strony dostaje
// stronę na miarę. Kolejność w stronie = kolejność miejsc (materiał nieprzezroczysty z testem głębi — obraz ten sam).
import * as THREE from 'three/webgpu';
import { storage } from 'three/tsl';
import { zbierzZakres, zbierzZakresy } from './zakresyWysylki.js';

// ── Dane egzemplarza w buforze storage ──────────────────────────────────────────────────────────────────────────
// Układ slotu (vec4): 0–3 macierz model-widok (kolumny; double na CPU jak highpModelViewMatrix three, float32 w
// buforze), 4–7 macierz świata (wysokość fragmentu połówki bryły), 8–11 ciało → układ budowli (lampy, normalne),
// 12 (cmin.xyz, offset) i 13 (cdim.xyz, on) slotu pola skóry (hullSkin3D), 14 (spoczynek uOff.xyz, —), 15 slot mapy
// ran, 16 uv rany, 17 (rozmiar slotu ran w j. świata, —, —), 18–19 slot i wymiary pola ran brył (solidWounds),
// 20 flagi widoczności (zestaw bg: pod / płaskie, nad; zestaw fg: pod / płaskie, nad). Slot 0 = zera (rozgrzewka).
export const WORLD_SKIN_SLOT_VEC4 = 21;
export const WORLD_SKIN_SLOTS = 2048;
export const WS = Object.freeze({
  MV: 0, WORLD: 4, HUB: 8, CMIN: 12, CDIM: 13, OFFV: 14, DMG_SLOT: 15, DMG_UV: 16, DMG_WORLD: 17, WOUND: 18, WOUND_DIM: 19, FLAGS: 20
});

export const WorldSkinStore = {
  slotVec4: WORLD_SKIN_SLOT_VEC4,
  capacity: WORLD_SKIN_SLOTS,
  attribute: null,
  node: null,
  _free: [],
  _next: 1,
  _warned: false,
  stats: { acquired: 0, released: 0, exhausted: 0 },

  _ensure() {
    if (this.attribute) return;
    this.attribute = new THREE.StorageBufferAttribute(new Float32Array(this.capacity * this.slotVec4 * 4), 4);
    this.node = storage(this.attribute, 'vec4', this.capacity * this.slotVec4).toReadOnly().setName('worldSkinStore');
  },

  getNode() {
    this._ensure();
    return this.node;
  },

  /** Slot egzemplarza (≥ 1) albo 0 — pula pełna (egzemplarz rysuje się własnymi siatkami). */
  acquire() {
    this._ensure();
    let slot = 0;
    if (this._free.length > 0) slot = this._free.pop();
    else if (this._next < this.capacity) slot = this._next++;
    if (!slot) {
      this.stats.exhausted++;
      if (!this._warned) {
        this._warned = true;
        console.warn(`[WorldSkinStore] pula ${this.capacity} slotów skór ciał świata pełna — kolejne odłamy własnymi siatkami`);
      }
      return 0;
    }
    this.stats.acquired++;
    return slot;
  },

  /** Zwolnienie: flagi widoczności zerowane (wierzchołki starego wpisu nie rysują się z cudzymi danymi). */
  release(slot) {
    if (!(slot > 0) || !this.attribute) return;
    const o = (slot * this.slotVec4 + WS.FLAGS) * 4;
    this.attribute.array.fill(0, o, o + 4);
    zbierzZakres(this.attribute, o, 4);
    this._free.push(slot);
    this.stats.released++;
  },

  array() {
    this._ensure();
    return this.attribute.array;
  },

  /** Wysyłka slotów [lo, hi] (włącznie). */
  upload(lo, hi) {
    if (!this.attribute || hi < lo) return;
    const s = this.slotVec4 * 4;
    zbierzZakres(this.attribute, lo * s, (hi - lo + 1) * s);
  },

  /** Wszystko zwolnione (testy). */
  reset() {
    if (this.attribute) this.attribute.array.fill(0);
    this._free.length = 0;
    this._next = 1;
  }
};

// ── Strony partii ───────────────────────────────────────────────────────────────────────────────────────────────
// Wierzchołek partii (float32, przeplot): pozycja 0, normalna 3, aPbA 6, aPbN 10 (w = slot egzemplarza), aPbFx 14,
// aLat 18, aOwn 21 — jeden bufor wierzchołków (limit 8 na pipeline), 96 B jak skóra kawałka.
export const SKIN_BATCH_STRIDE = 24;
export const SKIN_BATCH_SLOT = 13;
const LAYOUT = [['position', 3, 0], ['normal', 3, 3], ['aPbA', 4, 6], ['aPbN', 4, 10], ['aPbFx', 4, 14], ['aLat', 3, 18], ['aOwn', 3, 21]];
// Pierwsza strona partii mała (kilka odłamów przed upadkiem budowli — 6 MB), kolejne duże (pole gruzu po upadku bazy
// piratów: ~1,5 mln wierzchołków w partiach — mniej stron = mniej rysunków); nowa strona wysyła przy tworzeniu bufor
// w całości (three: mappedAtCreation), więc nie większe niż ~25 MB naraz.
const PAGE_VERTS_FIRST = 1 << 16;   // 65 536 wierzchołków (6,3 MB)
const PAGE_VERTS = 1 << 18;         // 262 144 wierzchołki (25 MB)
const PAGE_INDEX_PER_VERT = 4;      // indeksów na wierzchołek pojemności (skóry: ~2,6 indeksu na wierzchołek)
const COPY_STEP = 16384;            // wierzchołków / indeksów na krok generatora kopii

export const SKIN_BATCH_STATS = { pages: 0, entries: 0, verts: 0, indices: 0, bytes: 0, copies: 0, copyVerts: 0 };

function pow2AtLeast(n, min) {
  let c = min;
  while (c < n) c *= 2;
  return c;
}

// wolne przedziały [start, end) — pierwsze dopasowanie, scalane przy zwalnianiu (jak pole skóry hullSkin3D)
function allocRange(free, n) {
  for (let k = 0; k < free.length; k++) {
    const f = free[k];
    if (f[1] - f[0] >= n) {
      const s = f[0];
      f[0] += n;
      if (f[0] >= f[1]) free.splice(k, 1);
      return s;
    }
  }
  return -1;
}
function freeRange(free, start, n) {
  if (!(n > 0) || start < 0) return;
  let k = 0;
  while (k < free.length && free[k][0] < start) k++;
  free.splice(k, 0, [start, start + n]);
  for (let i = Math.max(0, k - 1); i < free.length - 1;) {
    if (free[i][1] >= free[i + 1][0]) { free[i][1] = Math.max(free[i][1], free[i + 1][1]); free.splice(i + 1, 1); }
    else i++;
  }
}
// koniec zajętej części (wolny przedział sięgający pojemności się nie liczy)
function highWater(free, cap) {
  const last = free[free.length - 1];
  return last && last[1] >= cap ? last[0] : cap;
}

class SkinBatchPage {
  constructor(batch, vcap, icap) {
    this.batch = batch;
    this.vcap = vcap;
    this.icap = icap;
    this.data = new Float32Array(vcap * SKIN_BATCH_STRIDE);
    this.idx = new Uint32Array(icap);
    this.vFree = [[0, vcap]];
    this.iFree = [[0, icap]];
    this.entries = 0;
    this.vis = [0, 0];        // wpisy z widoczną połówką (klatka — commit)
    this.ib = new THREE.InterleavedBuffer(this.data, SKIN_BATCH_STRIDE);
    this.aIdx = new THREE.BufferAttribute(this.idx, 1);
    const g = this.geometry = new THREE.BufferGeometry();
    for (const [name, size, off] of LAYOUT) g.setAttribute(name, new THREE.InterleavedBufferAttribute(this.ib, size, off));
    g.setIndex(this.aIdx);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    this.meshes = batch.halves.map((h, i) => {
      const m = new THREE.Mesh(g, h.material);
      m.name = `ciało świata — partia (${batch.set}${batch.solid ? (i ? ' nad' : ' pod') : ''})`;
      m.frustumCulled = false;
      m.layers.set(h.layer);
      m.visible = false;
      m.matrixAutoUpdate = false;
      return m;
    });
    for (const m of this.meshes) batch.scene?.add(m);
    SKIN_BATCH_STATS.pages++;
    SKIN_BATCH_STATS.bytes += this.data.byteLength + this.idx.byteLength;
  }

  _drawRange() {
    this.geometry.setDrawRange(0, highWater(this.iFree, this.icap));
  }

  dispose() {
    for (const m of this.meshes) m.removeFromParent();
    this.geometry.dispose();
    SKIN_BATCH_STATS.pages--;
    SKIN_BATCH_STATS.bytes -= this.data.byteLength + this.idx.byteLength;
  }
}

// Kopia wierzchołków podzbioru: numer wierzchołka kawałka → miejsce we wpisie (znacznik pokolenia zamiast czyszczenia
// tablicy), kolejność pierwszego wystąpienia w indeksie. Wspólne dla wszystkich partii (kopie idą po kolei).
let _stamp = new Uint32Array(0);
let _map = new Uint32Array(0);
let _order = new Uint32Array(0);
let _gen = 0;

/**
 * Partia skór (budowla × zestaw × rodzaj skóry): strony z siatką na połówkę (`halves`: [{ material, layer }] — skóra
 * płaska jedna, bryła 3D dwie: pod płaszczyzną, nad nią), siatki stron w `scene`. Wpis = odłam: `addSteps` kopiuje
 * podzbiór w krokach, `remove` zwalnia miejsce.
 */
export class WorldSkinBatch {
  constructor({ set, solid, halves, scene = null }) {
    this.set = set;
    this.solid = !!solid;
    this.halves = halves;
    this.scene = scene;
    this.pages = [];
  }

  /**
   * Generator: kopia trójkątów `geometry` (indeks na atrybutach skóry kawałka — podzbiór odłamu albo cała skóra) do
   * strony partii, slot egzemplarza w aPbN.w. `owner.entry` dostaje wpis od chwili przydziału miejsca (porzucenie
   * kopii — remove(owner.entry)); wynik: wpis albo null (pusty indeks).
   */
  *addSteps(slot, geometry, owner = {}) {
    const index = geometry.index;
    const count = index ? Math.min(index.count, geometry.drawRange.count) : 0;
    if (!(count >= 3)) return null;
    const I = index.array;
    const nSrc = geometry.attributes.position.count;
    if (_stamp.length < nSrc) {
      const n = pow2AtLeast(nSrc, 65536);
      _stamp = new Uint32Array(n);
      _map = new Uint32Array(n);
      _order = new Uint32Array(n);
      _gen = 0;
    }
    if (++_gen >= 0xffffffff) { _stamp.fill(0); _gen = 1; }
    const gen = _gen;
    // Tablice pokolenia są wspólne: kopie idą po kolei (kolejka worldBodies3D); kopia wznowiona po cudzej — porzucona.
    // 1. wierzchołki wpisu w kolejności pierwszego wystąpienia
    let nv = 0;
    for (let k = 0; k < count; k++) {
      if (k > 0 && (k % (4 * COPY_STEP)) === 0) {
        yield;
        if (_gen !== gen) return null;
      }
      const v = I[k];
      if (_stamp[v] !== gen) { _stamp[v] = gen; _map[v] = nv; _order[nv++] = v; }
    }
    // 2. miejsce w stronie (wolne miejsca istniejących stron, inaczej nowa strona)
    let page = null, vStart = -1, iStart = -1;
    for (const p of this.pages) {
      vStart = allocRange(p.vFree, nv);
      if (vStart < 0) continue;
      iStart = allocRange(p.iFree, count);
      if (iStart >= 0) { page = p; break; }
      freeRange(p.vFree, vStart, nv);
    }
    if (!page) {
      const vcap = pow2AtLeast(nv, this.pages.length ? PAGE_VERTS : PAGE_VERTS_FIRST);
      page = new SkinBatchPage(this, vcap, pow2AtLeast(count, vcap * PAGE_INDEX_PER_VERT));
      this.pages.push(page);
      vStart = allocRange(page.vFree, nv);
      iStart = allocRange(page.iFree, count);
    }
    page.entries++;
    const entry = { batch: this, page, slot, vStart, vCount: nv, iStart, iCount: count, alive: true };
    owner.entry = entry;
    SKIN_BATCH_STATS.entries++;
    SKIN_BATCH_STATS.verts += nv;
    SKIN_BATCH_STATS.indices += count;
    // 3. wierzchołki (atrybuty skóry: zwykłe albo z przeplotem — tablica, krok, przesunięcie)
    const src = LAYOUT.map(([name, size, off]) => {
      const a = geometry.attributes[name];
      if (!a) throw new Error(`worldSkinBatch: skóra bez atrybutu ${name}`);
      return a.isInterleavedBufferAttribute
        ? { arr: a.data.array, stride: a.data.stride, offset: a.offset, size, off }
        : { arr: a.array, stride: a.itemSize, offset: 0, size, off };
    });
    const D = page.data;
    for (let j = 0; j < nv; j++) {
      if (j > 0 && (j % COPY_STEP) === 0) {
        yield;
        if (!entry.alive) return null;
        if (_gen !== gen) { this.remove(entry); return null; }
      }
      const v = _order[j];
      const o = (vStart + j) * SKIN_BATCH_STRIDE;
      for (let a = 0; a < src.length; a++) {
        const s = src[a];
        const so = v * s.stride + s.offset;
        for (let c = 0; c < s.size; c++) D[o + s.off + c] = s.arr[so + c];
      }
      D[o + SKIN_BATCH_SLOT] = slot;
    }
    zbierzZakres(page.ib, vStart * SKIN_BATCH_STRIDE, nv * SKIN_BATCH_STRIDE);
    // 4. indeks (na końcu — do tej pory zera: trójkąty zdegenerowane)
    const P = page.idx;
    for (let k = 0; k < count; k++) P[iStart + k] = vStart + _map[I[k]];
    zbierzZakresy(page.aIdx, iStart, count);
    page._drawRange();
    SKIN_BATCH_STATS.copies++;
    SKIN_BATCH_STATS.copyVerts += nv;
    return entry;
  }

  /** Wpis znika: indeks zerowany (zdegenerowane), miejsce wolne; pusta strona zwolniona. */
  remove(entry) {
    if (!entry || !entry.alive) return;
    entry.alive = false;
    const page = entry.page;
    page.idx.fill(0, entry.iStart, entry.iStart + entry.iCount);
    zbierzZakresy(page.aIdx, entry.iStart, entry.iCount);
    freeRange(page.vFree, entry.vStart, entry.vCount);
    freeRange(page.iFree, entry.iStart, entry.iCount);
    page.entries--;
    SKIN_BATCH_STATS.entries--;
    SKIN_BATCH_STATS.verts -= entry.vCount;
    SKIN_BATCH_STATS.indices -= entry.iCount;
    if (page.entries <= 0) {
      page.dispose();
      const i = this.pages.indexOf(page);
      if (i >= 0) this.pages.splice(i, 1);
    } else {
      page._drawRange();
    }
  }

  dispose() {
    for (const p of this.pages) p.dispose();
    this.pages.length = 0;
  }
}

let _warmGeo = null;
/** Geometria rozgrzewki: jeden trójkąt z układem atrybutów strony partii (klucz pipeline'u), indeks Uint32. */
export function skinBatchWarmGeometry() {
  if (_warmGeo) return _warmGeo;
  const ib = new THREE.InterleavedBuffer(new Float32Array(3 * SKIN_BATCH_STRIDE), SKIN_BATCH_STRIDE);
  ib.array[0 * SKIN_BATCH_STRIDE + 3 + 2] = 1;
  ib.array[1 * SKIN_BATCH_STRIDE + 3 + 2] = 1;
  ib.array[2 * SKIN_BATCH_STRIDE + 3 + 2] = 1;
  ib.array[1 * SKIN_BATCH_STRIDE] = 1;
  ib.array[2 * SKIN_BATCH_STRIDE + 1] = 1;
  const g = new THREE.BufferGeometry();
  for (const [name, size, off] of LAYOUT) g.setAttribute(name, new THREE.InterleavedBufferAttribute(ib, size, off));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  _warmGeo = g;
  return g;
}
