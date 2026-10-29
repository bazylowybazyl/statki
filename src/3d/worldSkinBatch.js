// src/3d/worldSkinBatch.js
//
// PARTIE skór ciał świata (2026-10-27, docs/AUDYT-baza-po-upadku-2026-10-27.md § 5). Odłam budowli (wyspa, wrak
// kawałka — worldBodies3D.js) to osobny egzemplarz skóry: dawniej osobna siatka na zestaw (bryła 3D — na zestaw
// i połówkę), a każdy rysunek kosztuje ~15–25 µs CPU three r183 — po upadku bazy piratów ~200 rysunków skór nad polem
// gruzu, klatka workera ~4,4 ms. Tu odłamy jednego kawałka (ta sama skóra — geometria zestawu) rysują się JEDNYM
// obiektem renderu na połówkę: siatka na WSPÓLNYCH atrybutach skóry kawałka (bez kopii wierzchołków), indeks partii =
// podzbiory odłamów (fragmentSkinSubset — trójkąty kawałka, które odłam widzi) ułożone w jednym buforze, a każdy odłam
// to rysunek pośredni (drawIndexedIndirect) z rekordu: liczba indeksów, 1 instancja, początek wpisu w indeksie,
// firstInstance = slot egzemplarza (cecha `indirect-first-instance`) — wierzchołek bierze slot z instance_index.
//  - dane egzemplarza (macierze, slot pola skóry, mapa ran, rany brył, flagi widoczności) w buforze storage ze slotem
//    (WorldSkinStore, układ WS) — wierzchołek czyta je po slocie, fragment po slocie z varyingu;
//  - widoczność i kolejność: lista przesunięć rekordów (geometry.indirectOffset) układana co klatkę w haku passa
//    (worldBodies3D.commitWorldSkinStore — ten sam test kadru co three) od najbliższych; odłam poza kadrem albo połówka
//    bez fragmentu nie ma rysunku (zero pracy GPU), rekordy na GPU zmieniają się tylko przy dodaniu odłamu.
// Wersja z KOPIĄ wierzchołków podzbiorów do wspólnych stron (2026-10-27, pierwsze podejście) dawała ~1,5 mln kopii
// wierzchołków (~200 MB) po upadku bazy i przy zajętej pamięci GPU strony czytane wolno (GPU 3 → 11 ms) — odrzucona.
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

// ── Partia odłamów jednej skóry kawałka ─────────────────────────────────────────────────────────────────────────
// Rekord rysunku pośredniego (uint32): liczba indeksów, liczba instancji (1), pierwszy indeks, bazowy wierzchołek (0),
// pierwsza instancja = slot egzemplarza.
export const SKIN_BATCH_RECORD = 5;
export const SKIN_BATCH_STATS = { batches: 0, entries: 0, indices: 0, bytes: 0 };

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

/**
 * Partia odłamów jednej skóry kawałka (geometria zestawu `source` z indeksem — wspólne atrybuty): siatka na połówkę
 * (`halves`: [{ material, layer }] — skóra płaska jedna, bryła 3D dwie: pod płaszczyzną, nad nią), siatki w `scene`.
 * Wpis = odłam: `add` kopiuje indeks podzbioru i zapisuje rekord rysunku, `remove` zwalnia miejsce. Rysowane wpisy
 * i ich kolejność ustala co klatkę `setDraws(połówka, wpisy)`.
 */
export class WorldSkinBatch {
  constructor({ source, set, solid, halves, scene = null }) {
    this.source = source;
    this.set = set;
    this.solid = !!solid;
    this.halves = halves;
    this.scene = scene;
    this.entries = [];
    this._idxAlloc(pow2AtLeast(source.index ? source.index.count : 3, 4096), null);
    this._recAlloc(16, null);
    this.parts = halves.map((h, i) => {
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(source.attributes)) g.setAttribute(name, source.attributes[name]);
      g.setIndex(this.aIdx);
      const offsets = [];
      g.setIndirect(this.aRec, offsets);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
      const m = new THREE.Mesh(g, h.material);
      m.name = `ciało świata — partia (${set}${this.solid ? (i ? ' nad' : ' pod') : ''})`;
      m.frustumCulled = false;
      m.layers.set(h.layer);
      m.visible = false;
      scene?.add(m);
      return { geometry: g, mesh: m, offsets };
    });
    SKIN_BATCH_STATS.batches++;
  }

  _idxAlloc(cap, old) {
    const idx = new Uint32Array(cap);
    if (old) idx.set(old.subarray(0, Math.min(old.length, cap)));
    SKIN_BATCH_STATS.bytes += idx.byteLength - (old ? old.byteLength : 0);
    if (old) {
      // przedział wolny dopisany na końcu (nowa pojemność)
      freeRange(this.iFree, this.icap, cap - this.icap);
    } else {
      this.iFree = [[0, cap]];
    }
    this.icap = cap;
    this.idx = idx;
    this.aIdx = new THREE.BufferAttribute(idx, 1);
    if (this.parts) for (const p of this.parts) p.geometry.setIndex(this.aIdx);
  }

  _recAlloc(cap, old) {
    const recs = new Uint32Array(cap * SKIN_BATCH_RECORD);
    if (old) recs.set(old);
    SKIN_BATCH_STATS.bytes += recs.byteLength - (old ? old.byteLength : 0);
    if (!old) { this.freeRecs = []; this.nextRec = 0; }
    this.rcap = cap;
    this.recs = recs;
    this.aRec = new THREE.IndirectStorageBufferAttribute(recs, 1);
    if (this.parts) for (const p of this.parts) p.geometry.setIndirect(this.aRec, p.offsets);
  }

  get empty() { return this.entries.length === 0; }

  /**
   * Odłam do partii: indeks podzbioru (absolutne numery wierzchołków skóry kawałka — ta sama przestrzeń co `source`)
   * w wolnym miejscu indeksu partii, rekord rysunku z `slot`. Zwraca wpis albo null (pusty podzbiór).
   */
  add(slot, geometry) {
    const index = geometry.index;
    const count = index ? Math.min(index.count, geometry.drawRange.count) : 0;
    if (!(count >= 3)) return null;
    let iStart = allocRange(this.iFree, count);
    if (iStart < 0) {
      this._idxAlloc(pow2AtLeast(this.icap + count, this.icap * 2), this.idx);
      iStart = allocRange(this.iFree, count);
    }
    this.idx.set(index.array.subarray(0, count), iStart);
    zbierzZakresy(this.aIdx, iStart, count);
    let rec;
    if (this.freeRecs.length) rec = this.freeRecs.pop();
    else {
      if (this.nextRec >= this.rcap) this._recAlloc(this.rcap * 2, this.recs);
      rec = this.nextRec++;
    }
    const o = rec * SKIN_BATCH_RECORD;
    const R = this.recs;
    R[o] = count; R[o + 1] = 1; R[o + 2] = iStart; R[o + 3] = 0; R[o + 4] = slot;
    zbierzZakresy(this.aRec, o, SKIN_BATCH_RECORD);
    const entry = { batch: this, slot, iStart, iCount: count, rec, offset: rec * SKIN_BATCH_RECORD * 4, alive: true, depth: 0 };
    this.entries.push(entry);
    SKIN_BATCH_STATS.entries++;
    SKIN_BATCH_STATS.indices += count;
    return entry;
  }

  /** Wpis znika: miejsce w indeksie i rekord wolne (rysowane są tylko rekordy z listy klatki). */
  remove(entry) {
    if (!entry || !entry.alive) return;
    entry.alive = false;
    freeRange(this.iFree, entry.iStart, entry.iCount);
    this.freeRecs.push(entry.rec);
    const i = this.entries.indexOf(entry);
    if (i >= 0) { this.entries[i] = this.entries[this.entries.length - 1]; this.entries.pop(); }
    for (const p of this.parts) {
      const k = p.offsets.indexOf(entry.offset);
      if (k >= 0) p.offsets.splice(k, 1);
      if (!p.offsets.length) p.mesh.visible = false;
    }
    SKIN_BATCH_STATS.entries--;
    SKIN_BATCH_STATS.indices -= entry.iCount;
  }

  /**
   * Rysunki połówki `h` w tej klatce: przesunięcia rekordów `list` (wpisy, kolejność rysowania — od najbliższych),
   * `n` pierwszych. Siatka bez rysunków nie idzie do rysowania; położenie siatki = punkt najbliższego wpisu (`at` —
   * three sortuje obiekty nieprzezroczyste od najbliższych; graf partii nie czyta macierzy siatki).
   */
  setDraws(h, list, n, at = null) {
    const p = this.parts[h];
    if (!p) return 0;
    const off = p.offsets;
    off.length = n;
    for (let k = 0; k < n; k++) off[k] = list[k].offset;
    const vis = n > 0;
    if (p.mesh.visible !== vis) p.mesh.visible = vis;
    if (vis && at) p.mesh.position.copy(at);
    return vis ? 1 : 0;
  }

  dispose() {
    for (const p of this.parts) {
      p.mesh.removeFromParent();
      p.offsets.length = 0;
    }
    SKIN_BATCH_STATS.batches--;
    SKIN_BATCH_STATS.bytes -= this.idx.byteLength + this.recs.byteLength;
    SKIN_BATCH_STATS.entries -= this.entries.length;
    for (const e of this.entries) { e.alive = false; SKIN_BATCH_STATS.indices -= e.iCount; }
    this.entries.length = 0;
  }
}
