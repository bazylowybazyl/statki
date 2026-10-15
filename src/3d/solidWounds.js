// src/3d/solidWounds.js
//
// RANY BRYŁ 3D (docs/PORT-silnik-belek.md § „Ciała 3D” — trafienia brył): mapa ran kadłubów (hullDamageMap.js) leży
// w uv sprite'a ciał płaskich, a bryła 3D (wieża habitatu, dysk mieszkalny) przewraca się i obraca dowolnie — jej rany
// leżą w KOMÓRKACH kratownicy szablonu (ix, iy, iz — jak aLat skóry 3D). Pole: vec4 na komórkę = (żar w chwili stempla,
// czas stempla [s], osmalenie, —), slot na RÓD (`hull.dmgKey`: bryła, jej wrak i odłamy — te same komórki szablonu),
// komórki slotu w BLOKACH 4×4×4 (stempel dotyka kilku bloków — wysyłka na GPU zakresami bloków raz na klatkę).
// Stygnięcie żaru wzorem zamkniętym W SHADERZE (damageCoolHeat — ten sam co mapa ran): bez pracy na klatkę i bez
// kernela. Skóra bryły (portBuildings3D.tsl.js, wariant skin3) próbkuje pole trójliniowo w aLat.
//
// Stemple: kratery i rzazy (hak HullBodies.onImpact przez HullDamageMap.onHullImpact — hullImpactResult z latX/Y/Z),
// receptury efektów broni (ctx.stamp → HullDamageMap.stampRecipe → HullBodies.solidLatticeAt), rozdarcia po zgniocie
// (HullBodies.onSolidNodeLost). Parametry z tabeli STAMP (hullDamageStamps.js): promień, żar, osmalenie; stempel mniejszy
// niż komórka (45 j.) rozkłada się na nią z wagą pola (r / komórka)² — drobny kaliber osmala powoli, nie plamą.
// Zero alokacji na stempel; pamięć: WOUND_CAP komórek (8 MB GPU + kopia CPU).

import * as THREE from 'three/webgpu';
import { storage, uniform } from 'three/tsl';
import { zbierzZakresy } from './zakresyWysylki.js';
import { damageCoolHeatCpu, DMG_HEAT_MAX } from './hullDamageMap.tsl.js';
import { bodyRotation } from '../game/beamBand3D.js';

const _rot = new Float64Array(9);

/** Komórek pola (vec4 f32) na grę. */
export const WOUND_CAP = 1 << 19;
/** Bok bloku komórek (blok = 64 komórki ciągiem w pamięci). */
export const WOUND_BRICK = 4;
const BRICK_CELLS = WOUND_BRICK * WOUND_BRICK * WOUND_BRICK;
/** Stempli jednego slotu na klatkę (seria w jedną bryłę) i z tego rozdarć (reszta — broń). */
export const WOUND_SLOT_STAMP_CAP = 64;
export const WOUND_TEAR_CAP = 32;
/** Rozdarcia tej klatki bliżej niż tyle komórek od poprzedniego — jedno. */
export const WOUND_TEAR_MERGE_CELLS = 0.9;
/** Zasięg stempla w promieniach (jak kernel mapy ran: r < 1,6). */
const REACH = 1.6;

let _data = null;
let _attr = null;
let _node = null;
let _timeNode = null;
const _free = [[0, WOUND_CAP]];
const _t0 = typeof performance !== 'undefined' ? performance.now() : 0;
const _tearRing = new Float64Array(64 * 4);   // klucz, x, y, z (komórki) — rozdarcia tej klatki
let _tearHead = 0;
let _tearFrame = -1;

function ensureField() {
  if (_attr) return;
  _data = new Float32Array(WOUND_CAP * 4);
  _attr = new THREE.StorageBufferAttribute(_data, 4);
  _node = storage(_attr, 'vec4', WOUND_CAP).toReadOnly().setName('solidWoundField');
  _timeNode = uniform(0);
}

function allocCells(n) {
  for (let k = 0; k < _free.length; k++) {
    const f = _free[k];
    if (f[1] - f[0] >= n) {
      const start = f[0];
      f[0] += n;
      if (f[0] >= f[1]) _free.splice(k, 1);
      return start;
    }
  }
  return -1;
}

function freeCells(start, n) {
  if (!(n > 0) || start < 0) return;
  let k = 0;
  while (k < _free.length && _free[k][0] < start) k++;
  _free.splice(k, 0, [start, start + n]);
  for (let i = Math.max(0, k - 1); i < _free.length - 1;) {
    if (_free[i][1] >= _free[i + 1][0]) { _free[i][1] = Math.max(_free[i][1], _free[i + 1][1]); _free.splice(i + 1, 1); }
    else i++;
  }
}

/** Indeks komórki (x, y, z) slotu w polu (blok 4×4×4 ciągiem) — lustro CPU indeksu shadera (woundCellIndex). */
export function woundCellIndex(offset, nbx, nby, x, y, z) {
  const brick = (x >> 2) + (y >> 2) * nbx + (z >> 2) * nbx * nby;
  return offset + brick * BRICK_CELLS + (x & 3) + (y & 3) * 4 + (z & 3) * 16;
}

/**
 * Lustro CPU stempla w jednej komórce (testy, stempel na CPU): stan komórki T = [żar0, t0, osmalenie] (zmieniany),
 * odległość d [j.] środka komórki od środka stempla, promień r [j.], żar i osmalenie stempla, pole komórki `area`
 * (≤ 1), chwila `now` [s]. Żar sprzed stempla stygnie wzorem zamkniętym do `now`, rdzeń e^(−2,6ρ²), poświata
 * e^(−0,9ρ²) jak kernel mapy ran (bez falowania obrysu — komórka jest większa niż fale brzegu).
 */
export function woundStampCellCpu(T, d, r, heat, scorch, area, now) {
  const rr = d / Math.max(1e-6, r);
  if (!(rr < REACH)) return T;
  const r2 = rr * rr;
  const core = Math.exp(-2.6 * r2), halo = Math.exp(-0.9 * r2);
  const hNow = T[0] > 0 ? damageCoolHeatCpu(T[0], Math.max(0, now - T[1])) : 0;
  const h = Math.min(DMG_HEAT_MAX, Math.max(hNow, heat * core * area) + heat * 0.12 * halo * area);
  T[0] = h;
  T[1] = now;
  T[2] = Math.min(1, T[2] + scorch * halo * area);
  return T;
}

const _cell = [0, 0, 0];

export const SolidWounds = {
  enabled: true,
  frame: 0,
  slots: [],
  _byKey: new Map(),
  stats: { slots: 0, cells: 0, stamps: 0, tears: 0, tearMerged: 0, capped: 0, noSlot: 0, uploadBricks: 0 },

  /** Węzeł pola (bufor storage vec4 na grę) — graf skóry 3D budowli (portBuildings3D.tsl.js). */
  field() { ensureField(); return _node; },
  /** Uniform czasu [s] (stygnięcie w shaderze) — wartość ustawia frame(). */
  timeNode() { ensureField(); return _timeNode; },
  /** Bieżący czas pola [s] (czas strony od wczytania modułu). */
  now() { return ((typeof performance !== 'undefined' ? performance.now() : 0) - _t0) / 1000; },

  // ── Sloty ─────────────────────────────────────────────────────────────────

  /**
   * Slot rodu bryły (`hull.dmgKey`, wymiary kratownicy szablonu — hull.structure.dims albo body.dims). Pierwszy
   * stempel przydziela i zeruje slot (cały do wysłania); brak miejsca — oddaje najdawniej widziany slot innego rodu.
   */
  slotFor(hull) {
    if (!hull || !(hull.dmgKey > 0) || !this.enabled) return null;
    ensureField();
    const have = this._byKey.get(hull.dmgKey);
    if (have) return have;
    const d = hull.structure?.dims || hull.body?.dims;
    if (!d) return null;
    const nbx = Math.ceil(d.x / WOUND_BRICK), nby = Math.ceil(d.y / WOUND_BRICK), nbz = Math.ceil(d.z / WOUND_BRICK);
    const bricks = nbx * nby * nbz, cells = bricks * BRICK_CELLS;
    if (cells > WOUND_CAP) { this.stats.noSlot++; return null; }
    let offset = allocCells(cells);
    while (offset < 0) {
      // najdawniej widziany slot (poza widzianymi w tej klatce)
      let lru = null;
      for (const s of this.slots) if (s.seen < this.frame && (!lru || s.seen < lru.seen)) lru = s;
      if (!lru) { this.stats.noSlot++; return null; }
      this._release(lru);
      offset = allocCells(cells);
    }
    const slot = {
      key: hull.dmgKey, offset, cells, nbx, nby, nbz, dx: d.x, dy: d.y, dz: d.z,
      cs: hull.cellSize || hull.body?.cellSize || 1,
      seen: this.frame, pending: 0, tears: 0,
      dirty: new Uint8Array(bricks), dirtyList: [],
      // wartości obiektu dla skóry (userData siatki): (offset, nbx, nby, on), (dx, dy, dz, —)
      u: new THREE.Vector4(offset, nbx, nby, 1),
      dim: new THREE.Vector4(d.x, d.y, d.z, 0)
    };
    _data.fill(0, offset * 4, (offset + cells) * 4);
    for (let b = 0; b < bricks; b++) { slot.dirty[b] = 1; slot.dirtyList.push(b); }
    this.slots.push(slot);
    this._byKey.set(slot.key, slot);
    this._count();
    return slot;
  },

  _release(slot) {
    freeCells(slot.offset, slot.cells);
    this._byKey.delete(slot.key);
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
    slot.u.w = 0;
    this._count();
  },

  _count() {
    let cells = 0;
    for (const s of this.slots) cells += s.cells;
    this.stats.slots = this.slots.length;
    this.stats.cells = cells;
  },

  /** Slot rodu bez przydziału (albo undefined). */
  slotOf(key) { return this._byKey.get(key); },

  // ── Stemple ───────────────────────────────────────────────────────────────

  /**
   * Stempel w punkcie kratownicy (lx, ly, lz — komórki szablonu, węzeł = liczby całkowite): promień r [j. świata],
   * żar, osmalenie. Zwraca, czy coś zapisano (false: brak slotu, limit klatki, poza kratownicą).
   */
  stamp(hull, lx, ly, lz, r, heat, scorch) {
    const slot = this.slotFor(hull);
    if (!slot || !(r > 0)) return false;
    if (slot.pending >= WOUND_SLOT_STAMP_CAP) { this.stats.capped++; return false; }
    const cs = slot.cs;
    // ślad nie mniejszy niż komórka: zasięg REACH · re ≥ 0,88 komórki sięga zawsze najbliższego węzła kratownicy
    // (najdalej √3 / 2 komórki); drobny kaliber (laser 14 j. przy komórce 45) — siła z wagą pola `area` niżej, inaczej
    // połowa trafień nie trafiała w żadną komórkę
    const re = Math.max(r, 0.55 * cs);
    const Rc = REACH * re / cs;
    const x0 = Math.max(0, Math.ceil(lx - Rc)), x1 = Math.min(slot.dx - 1, Math.floor(lx + Rc));
    const y0 = Math.max(0, Math.ceil(ly - Rc)), y1 = Math.min(slot.dy - 1, Math.floor(ly + Rc));
    const z0 = Math.max(0, Math.ceil(lz - Rc)), z1 = Math.min(slot.dz - 1, Math.floor(lz + Rc));
    if (x1 < x0 || y1 < y0 || z1 < z0) return false;
    slot.pending++;
    const now = this.now();
    const area = Math.min(1, (r / cs) * (r / cs));
    const T = _cell, D = _data, nbx = slot.nbx, nby = slot.nby, off = slot.offset;
    let wrote = false;
    for (let z = z0; z <= z1; z++) {
      const dz = (z - lz) * cs;
      for (let y = y0; y <= y1; y++) {
        const dy = (y - ly) * cs;
        for (let x = x0; x <= x1; x++) {
          const dx = (x - lx) * cs;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= REACH * re) continue;
          const i = woundCellIndex(off, nbx, nby, x, y, z) * 4;
          T[0] = D[i]; T[1] = D[i + 1]; T[2] = D[i + 2];
          woundStampCellCpu(T, d, re, heat, scorch, area, now);
          D[i] = T[0]; D[i + 1] = T[1]; D[i + 2] = T[2];
          const b = (x >> 2) + (y >> 2) * nbx + (z >> 2) * nbx * nby;
          if (!slot.dirty[b]) { slot.dirty[b] = 1; slot.dirtyList.push(b); }
          wrote = true;
        }
      }
    }
    if (wrote) this.stats.stamps++;
    return wrote;
  },

  /**
   * Krater / rzaz bryły z haka HullBodies.onImpact (przez HullDamageMap.onHullImpact): `r` — hullImpactResult
   * (latX/Y/Z, crater, killed, kind, dirX/Y, len), `entry` — wpis tabeli STAMP (promień, żar, osmalenie), power —
   * mnożnik promienia receptury. Prawdziwa dziura (krater zabił węzły) — promień nie mniejszy niż dziura + ½ komórki
   * (żar obejmuje brzeg); rzaz — znaki wzdłuż cięcia (świat → komórki przez obrót ciała).
   */
  onImpact(hull, r, entry, power = 1) {
    if (!hull || !r || !entry) return false;
    const cs = hull.cellSize || hull.body?.cellSize || 1;
    let rad = entry[0] * power;
    const cut = r.kind === 'cut';
    const holeR = cut ? (r.killed > 0 ? r.radius : 0) : (r.crater > 0 ? r.crater : 0);
    if (holeR > 0) rad = Math.max(rad, holeR + 0.5 * cs);
    if (!cut) return this.stamp(hull, r.latX, r.latY, r.latZ, rad, entry[1], entry[2]);
    // rzaz: znaki co ≤ 1 komórka od wejścia do końca cięcia (≤ 8), kierunek świata → komórki kratownicy
    const len = Math.max(0, r.len || 0);
    const n = Math.max(1, Math.min(8, Math.ceil(len / cs)));
    const b = hull.body;
    if (!b) return this.stamp(hull, r.latX, r.latY, r.latZ, rad, entry[1], entry[2]);
    // kierunek świata silnika (x, −y gry, 0) → układ ciała (Rᵀ v) → komórki na jednostkę drogi
    const m = bodyRotation(b.quat, _rot);
    const vx = r.dirX, vy = -r.dirY;
    const lxv = (m[0] * vx + m[3] * vy) / cs, lyv = (m[1] * vx + m[4] * vy) / cs, lzv = (m[2] * vx + m[5] * vy) / cs;
    let any = false;
    for (let k = 0; k < n; k++) {
      const f = n > 1 ? (k / (n - 1)) * len : 0;
      if (this.stamp(hull, r.latX + lxv * f, r.latY + lyv * f, r.latZ + lzv * f, rad, entry[1], entry[2])) any = true;
    }
    return any;
  },

  /**
   * Rozdarcie po zgniocie bryły (HullBodies.onSolidNodeLost): komórka (ix, iy, iz) zniszczonego węzła — dziura
   * ~1 komórki (`holeCells`), słaby żar, osmalenie brzegu. Rozdarcia tej klatki bliżej niż WOUND_TEAR_MERGE_CELLS — jedno.
   */
  tear(hull, ix, iy, iz, entry, holeCells) {
    if (!hull || !entry || !(hull.dmgKey > 0)) return false;
    if (_tearFrame !== this.frame) { _tearFrame = this.frame; _tearHead = 0; _tearRing.fill(0); }
    const R = _tearRing, m2 = WOUND_TEAR_MERGE_CELLS * WOUND_TEAR_MERGE_CELLS;
    for (let k = 0; k < 64; k++) {
      const o = k * 4;
      if (R[o] !== hull.dmgKey) continue;
      const dx = R[o + 1] - ix, dy = R[o + 2] - iy, dz = R[o + 3] - iz;
      if (dx * dx + dy * dy + dz * dz <= m2) { this.stats.tearMerged++; return false; }
    }
    const slot = this.slotFor(hull);
    if (!slot) return false;
    if (slot.tears >= WOUND_TEAR_CAP) { this.stats.capped++; return false; }
    const cs = slot.cs;
    const rad = Math.max(entry[0], holeCells * cs + 0.5 * cs);
    if (!this.stamp(hull, ix, iy, iz, rad, entry[1], entry[2])) return false;
    slot.tears++;
    this.stats.tears++;
    const o = (_tearHead++ % 64) * 4;
    R[o] = hull.dmgKey; R[o + 1] = ix; R[o + 2] = iy; R[o + 3] = iz;
    return true;
  },

  // ── Render ────────────────────────────────────────────────────────────────

  /**
   * Wiąże slot rodu z egzemplarzem skóry (holder: { woundSlot: Vector4, woundDim: Vector4 }) i zaznacza go jako
   * widziany. Brak slotu → rany wyłączone (woundSlot.w = 0).
   */
  bind(hull, holder) {
    const s = hull?.dmgKey > 0 ? this._byKey.get(hull.dmgKey) : undefined;
    if (!s) { holder.woundSlot.w = 0; return false; }
    s.seen = this.frame;
    holder.woundSlot.copy(s.u);
    holder.woundDim.copy(s.dim);
    return true;
  },

  /** Klatka renderu: czas pola (stygnięcie w shaderze), wysyłka zmienionych bloków, liczniki klatki slotów. */
  flush() {
    ensureField();
    _timeNode.value = this.now();
    let bricks = 0;
    for (const s of this.slots) {
      s.pending = 0;
      s.tears = 0;
      const L = s.dirtyList;
      if (!L.length) continue;
      L.sort((a, b) => a - b);
      // kolejne bloki to ciągła pamięć — jeden zakres
      let run0 = L[0], prev = L[0];
      for (let k = 1; k <= L.length; k++) {
        const b = k < L.length ? L[k] : -2;
        if (b === prev + 1) { prev = b; continue; }
        zbierzZakresy(_attr, (s.offset + run0 * BRICK_CELLS) * 4, (prev - run0 + 1) * BRICK_CELLS * 4);
        run0 = b; prev = b;
      }
      for (let k = 0; k < L.length; k++) s.dirty[L[k]] = 0;
      bricks += L.length;
      L.length = 0;
    }
    this.stats.uploadBricks = bricks;
    this.frame++;
  },

  /** Wszystko zwolnione (nowa gra, koniec misji, testy). */
  reset() {
    for (const s of this.slots.slice()) this._release(s);
    this._byKey.clear();
    _tearFrame = -1;
    const st = this.stats;
    st.stamps = 0; st.tears = 0; st.tearMerged = 0; st.capped = 0; st.noSlot = 0; st.uploadBricks = 0;
  },

  /** Tylko testy: komórka slotu (kopia CPU) — [żar0, t0, osmalenie]. */
  _cellAt(key, x, y, z) {
    const s = this._byKey.get(key);
    if (!s || !_data) return null;
    const i = woundCellIndex(s.offset, s.nbx, s.nby, x, y, z) * 4;
    return [_data[i], _data[i + 1], _data[i + 2]];
  }
};

if (typeof window !== 'undefined') window.SolidWounds = SolidWounds;
