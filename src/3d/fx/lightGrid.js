// src/3d/fx/lightGrid.js
//
// SIATKA ŚWIATEŁ GRY — jedna wersja scalona z trzech kopii w demach WebGPU
// (dema/asteroidy-webgpu/lights.js — stan z 2026-09-27, najpełniejszy;
// dema/bronie-webgpu/lightGrid.js; dema/rakiety-webgpu/lights.js). Dema zostają na
// swoich kopiach. Różnice kopii i wybór: docs/webgpu/FX-INFRA.md §1.
//
// Setki dynamicznych świateł (błyski luf, trafienia, żar, dysze rakiet, reflektory
// i lampy statków, pioruny) → pula na CPU → siatka komórek w płaszczyźnie XY wokół
// kamery (listy komórek z sum prefiksowych na CPU) → bufory storage na GPU. Tę samą
// siatkę czytają:
//   • materiały powierzchni przez własny `Lighting` three (GridLighting → GridLightsNode,
//     wzór: examples/jsm/tsl/lighting/TiledLightsNode.js) — każde światło komórki idzie
//     przez lightingModel.direct(), jak światło punktowe three;
//   • compute (dym, odłamki, ośrodek smug): `grid.loop(P, cb)` w kernelu.
//
// Dlaczego nie TiledLighting z r183: kafel 32 px mieści 8 świateł (dalsze giną — widać
// kafle), promień rzutu to distance / z bez ogniskowej, a compute nie ma piksela ekranu.
// Tu komórka w świecie ma listę bez limitu, test zasięgu jest w 3D.
//
// UKŁAD WSPÓŁRZĘDNYCH (precyzja, agents.md): świat gry leży przy 5–10 mln j., gdzie
// float32 ma krok 0,5–1 j. Siatka trzyma wszystko WZGLĘDEM POCZĄTKU przy kamerze:
//   lokalne = scena − początek,  scena = (x, −y świata gry, z),
// a różnicę liczy CPU w double (`addWorld`, `toLocalX/Y`). Początek jest w układzie
// SCENY — ten sam, który dają `sceneOriginNearCamera` (src/3d/sceneOrigin.js) i
// `FxPoolOrigin` (gpuPoolOrigin.js), więc pule GPU efektów i siatka mają jedną ramę.
// Materiały obiektów w bezwzględnej pozycji (kadłuby) dostają lokalny punkt z pozycji
// widoku (`localPosition()`: obrót kamery · positionView + (kamera − początek) liczone
// w double) — bez 0,5 j. szumu positionWorld przy 6 mln j.
//
// Światło = 4 × vec4 (LIGHT_FLOATS = 16):
//   L0 = pozycja (lokalna) + zasięg,
//   L1 = barwa × moc + rozpraszanie w ośrodku (pył / smugi reflektorów; 0..1),
//   L2 = oś reflektora (jednostkowa) + cos stożka zewn. (−2 = dookólne),
//   L3 = cos stożka wewn., rozbłysk lampy, mapa cienia (1..n, 0 = bez), właściciel
//        (materiał z `gridLightOwner` pomija światła swojego statku — własne lampy
//        kadłuba liczy jego shader, a własne czerwone lampy przepalały eskortę na różowo).
// Tłumienie jak dawne światła pola gry (fieldLights3D.js, usunięty w zadaniu 21): okno do zera na zasięgu
// × 1/(1 + 4x²); stożek z miękkim brzegiem smoothstep² (bez „łopat wiatraka”).
//
// Bufory (limit storage na etap — PLAN §3): DWA na materiał / kernel — światła (vec4)
// i indeks (uint: [start, liczba] dla każdej komórki, potem listy świateł komórek).
// Dema miały trzy (komórki i listy osobno).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec4, uniform, attributeArray, Loop, If,
  floor, max, abs, length, smoothstep, dot, normalize,
  positionView, positionWorld, cameraViewMatrix, cameraWorldMatrix, renderGroup
} from 'three/tsl';
import { buildNavLightClusters, buildRoadLightWorldEmitters, entityOwnRoadLightCount } from '../../game/shipLightRuntime.js';
import { cloakLightGain } from '../../game/cloakLook.js';
import {
  beginHullMountBind, bindHullMount, createHullMountSet, mountHullOf, refreshHullMountSet
} from '../../game/hullMounts.js';

export const LIGHT_CAP = 1536;          // świateł na klatkę (demo asteroid: 1024 przy teście „~4 ms”)
export const GRID_NX = 64;              // komórki siatki w poprzek kadru
export const GRID_NY = 40;
export const ITEM_CAP = 1 << 18;        // wpisów „światło w komórce” na klatkę
export const LIGHT_FLOATS = 16;         // 4 × vec4 na światło
export const GRID_CELLS = GRID_NX * GRID_NY;
export const CELL_WORDS = GRID_CELLS * 2;   // [start, liczba] na komórkę na początku indeksu

/** Dookólne: cos stożka zewnętrznego ≤ −1,5. */
export const OMNI = -2;

// Jeden zakres wysyłki na atrybut NA STAŁE (three czyści listę w clearUpdateRanges po wysyłce —
// tu wyłączone, więc klatka bez alokacji zmienia tylko `count`). Pierwsza wysyłka (tworzenie
// bufora) i tak kopiuje całą tablicę.
function keepUpdateRanges() {}
function permanentUpdateRange(attr) {
  const range = { start: 0, count: attr.array.length };
  attr.updateRanges.length = 0;
  attr.updateRanges.push(range);
  attr.clearUpdateRanges = keepUpdateRanges;
  return range;
}

// ---------------------------------------------------------------------------
// Profile świateł pola statków (reflektory, światło dookoła, lampy pozycyjne).
//
// Z dema asteroid WebGPU (stan 2026-09-27) — na bazie FIELD_SHIP_LIGHTS z dawnego
// fieldLights3D.js (moduł WebGL, usunięty w zadaniu 21), podkręcone pod światło wolumetryczne
// (prośby użytkownika 2026-09-27: „boczne lepsze niż w WebGL, bo tam ledwo
// świeciły”, reflektory dalekie „delikatnie poszerz”):
//   • spot  — reflektory dalekie (dziób): smuga w pyle z cieniem skał, stożek 36°;
//   • flood — reflektory otoczenia (rufa, burty): moc ×2,6, zasięg ×1,6, stożek 76°
//             z jasnością gasnącą od osi, pochylenie 10°, każdy z mapą cienia;
//   • omni  — światło dookoła kadłuba: w pyle prawie nic (szara mgła na kadr);
//   • nav   — czerwone lampy pozycyjne: czerwona poświata w pyle.
export const FIELD_SHIP_LIGHTS = Object.freeze({
  spot: Object.freeze({ rangeMul: 6.5, minRange: 2600, maxRange: 14000, coneDeg: 36, innerFrac: 0.45, intensity: 2.6, color: Object.freeze([1.0, 0.94, 0.84]), z: 140, tiltDeg: 5, beam: 1.0, scatter: 0.8, flare: 1 }),
  omni: Object.freeze({ rangeMul: 1.15, minRange: 700, maxRange: 2800, intensity: 0.5, color: Object.freeze([0.74, 0.84, 1.0]), z: 320, scatter: 0.06 }),
  flood: Object.freeze({ rangeMul: 0.9, minRange: 800, maxRange: 3400, coneDeg: 76, innerFrac: 0.0, intensity: 2.8, color: Object.freeze([0.9, 0.95, 1.0]), z: 70, tiltDeg: 10, beam: 0.8, flare: 0.45, scatter: 0.16 }),
  nav: Object.freeze({ intensity: 0.075, z: 40, rangeMul: 1.0, minRange: 320, scatter: 0.2 })
});

// Pod stropem olbrzyma (tunel, jaskinia): reflektory pochylone do dna, szersze
// światło dookoła (jak CAVE_SHIP_LIGHTS w demie WebGL).
export const CAVE_SHIP_LIGHTS = Object.freeze({
  spot: Object.freeze({ ...FIELD_SHIP_LIGHTS.spot, tiltDeg: 14 }),
  omni: Object.freeze({ ...FIELD_SHIP_LIGHTS.omni, rangeMul: 3.2, maxRange: 6500, intensity: 0.8, scatter: 0.04 }),
  flood: Object.freeze({ ...FIELD_SHIP_LIGHTS.flood, tiltDeg: 18 }),
  nav: FIELD_SHIP_LIGHTS.nav
});

// ---------------------------------------------------------------------------
// Siatka

/**
 * Siatka świateł: pula (CPU) + bufory storage (GPU) + pętla TSL po światłach komórki.
 *
 * Klatka: `begin(originX, originY)` → `add` / `addWorld` … → `build(x0, y0, x1, y1)`
 * (prostokąt LOKALNY kadru z zapasem) → render / compute czytają bufory.
 */
export class LightGrid {
  constructor({ name = 'fxGrid' } = {}) {
    this.name = name;
    // Bufory pisze tylko CPU → w compute też tylko do odczytu (`var<storage, read>`).
    this.lightNode = attributeArray(LIGHT_CAP * 4, 'vec4').setName(`${name}Lights`).toReadOnly();
    this.indexNode = attributeArray(CELL_WORDS + ITEM_CAP, 'uint').setName(`${name}Index`).toReadOnly();
    this.lights = this.lightNode.value.array;     // Float32Array (LIGHT_CAP × 16)
    this.index = this.indexNode.value.array;      // Uint32Array (komórki + listy)
    // Zakresy wysyłki na stałe (12-B): three czyści listę zakresów po każdej wysyłce, a ponowne
    // addUpdateRange alokowało obiekt i tablicę na klatkę — build() zmienia tylko `count`.
    this._lightRange = permanentUpdateRange(this.lightNode.value);
    this._indexRange = permanentUpdateRange(this.indexNode.value);
    this._counts = new Uint32Array(GRID_CELLS);
    this._x0 = new Int16Array(LIGHT_CAP);
    this._x1 = new Int16Array(LIGHT_CAP);
    this._y0 = new Int16Array(LIGHT_CAP);
    this._y1 = new Int16Array(LIGHT_CAP);
    // Uniformy siatki w grupie `render` (jeden wspólny bufor, odświeżany raz na
    // render() / compute()) — nie w buforze każdego obiektu osobno.
    // Prostokąt siatki (lokalny) i odwrotność komórki — do wyszukania komórki na GPU.
    this.rect = uniform(new THREE.Vector2()).setName(`${name}Rect`).setGroup(renderGroup);
    this.invCell = uniform(new THREE.Vector2(1, 1)).setName(`${name}InvCell`).setGroup(renderGroup);
    // Mnożnik wszystkich świateł siatki (przełącznik, panel).
    this.gain = uniform(1).setName(`${name}Gain`).setGroup(renderGroup);
    // Kamera passa względem początku siatki (double na CPU → mała liczba na GPU),
    // raz na wywołanie render() — dla `localPosition()` materiałów.
    this.camLocal = uniform(new THREE.Vector3()).setName(`${name}CamLocal`).setGroup(renderGroup)
      .onRenderUpdate(({ camera }) => {
        if (!camera) return;
        const e = camera.matrixWorld.elements;
        this.camLocal.value.set(e[12] - this.originX, e[13] - this.originY, e[14]);
      });
    // Mapy cienia reflektorów (np. ShadowAtlas dema asteroid, zadanie 21):
    // obiekt z `visibility(indeksNode, P) → float` — światło z L3.z > 0 gaśnie za skałą.
    // Ustaw PRZED budową materiałów i kerneli.
    this.shadows = null;
    // Początek siatki (scena, double) — zmienia go tylko begin().
    this.originX = 0;
    this.originY = 0;
    // Prostokąt odrzucania i budowy (lokalny); brak = bez odrzucania w add().
    this.hasBounds = false;
    this.bx0 = 0; this.by0 = 0; this.bx1 = 0; this.by1 = 0;
    this.count = 0;
    this.itemsUsed = 0;
    this.dropped = 0;
    this.culled = 0;
    this.cellW = 1;
    this.cellH = 1;
    this.stats = { lights: 0, items: 0, maxPerCell: 0, dropped: 0, culled: 0 };
  }

  // --- CPU -----------------------------------------------------------------

  /**
   * Nowa klatka świateł. `originX/Y` — początek w układzie SCENY (x, −y świata gry),
   * np. z `FxPoolOrigin` albo `sceneOriginNearCamera`; bez argumentów zostaje poprzedni.
   * Kasuje prostokąt odrzucania (ustaw go ponownie przez `setBounds`).
   */
  begin(originX = this.originX, originY = this.originY) {
    this.originX = Number.isFinite(originX) ? originX : 0;
    this.originY = Number.isFinite(originY) ? originY : 0;
    this.count = 0;
    this.culled = 0;
    this.hasBounds = false;
    return this;
  }

  /**
   * Prostokąt LOKALNY kadru (z zapasem): światła, których koło zasięgu go nie
   * dotyka, `add` odrzuca (nie zajmują puli); `build()` bez argumentów go używa.
   */
  setBounds(x0, y0, x1, y1) {
    this.bx0 = Math.min(x0, x1); this.bx1 = Math.max(x0, x1);
    this.by0 = Math.min(y0, y1); this.by1 = Math.max(y0, y1);
    this.hasBounds = true;
    return this;
  }

  /** Początek w układzie ŚWIATA gry (ox, oy) — dla kodu z dem: lokalne = (x − ox, −(y − oy)). */
  get worldOriginX() { return this.originX; }
  get worldOriginY() { return -this.originY; }

  /** Świat gry → lokalne siatki (double). */
  toLocalX(worldX) { return worldX - this.originX; }
  toLocalY(worldY) { return -worldY - this.originY; }

  /**
   * Dodaje światło we współrzędnych LOKALNYCH (scena − początek). Zwraca indeks albo
   * −1 (pula pełna, zerowa barwa / zasięg, poza prostokątem kadru).
   * cosOuter ≤ −1,5 = dookólne; oś (dx, dy, dz) nie musi być jednostkowa.
   */
  add(x, y, z, range, r, g, b, scatter = 0.5, dx = 0, dy = 0, dz = -1, cosOuter = OMNI, cosInner = 0, flare = 0, shadow = 0, owner = 0) {
    if (!(range > 1) || !(r + g + b > 1e-5) || !Number.isFinite(range)) return -1;
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return -1;
    if (this.hasBounds && (x + range < this.bx0 || x - range > this.bx1 || y + range < this.by0 || y - range > this.by1)) {
      this.culled++;
      return -1;
    }
    if (this.count >= LIGHT_CAP) return -1;
    let co = cosOuter;
    let ci = cosInner;
    let ax = 0;
    let ay = 0;
    let az = -1;
    if (co > -1.5) {
      const al = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (al > 1e-6) {
        ax = dx / al; ay = dy / al; az = dz / al;
        // smoothstep(e0, e1, x) z e0 ≥ e1 jest w WGSL nieokreślony (NaN w HalfFloat
        // rozlałby bloom na cały ekran) — stożek wewnętrzny zawsze węższy od zewnętrznego.
        if (!(co < 1)) co = 0.9999;
        if (!(ci > co + 1e-4)) ci = Math.min(1, co + 1e-4);
      } else {
        co = OMNI;
      }
    }
    const i = this.count++;
    const o = i * LIGHT_FLOATS;
    const L = this.lights;
    L[o] = x; L[o + 1] = y; L[o + 2] = z; L[o + 3] = range;
    L[o + 4] = r; L[o + 5] = g; L[o + 6] = b; L[o + 7] = scatter;
    L[o + 8] = ax; L[o + 9] = ay; L[o + 10] = az; L[o + 11] = co;
    L[o + 12] = ci; L[o + 13] = flare; L[o + 14] = shadow; L[o + 15] = owner;
    return i;
  }

  /** Jak `add`, ale pozycja w układzie ŚWIATA gry (x, y; z sceny) — różnica w double. */
  addWorld(worldX, worldY, z, range, r, g, b, scatter = 0.5, dx = 0, dy = 0, dz = -1, cosOuter = OMNI, cosInner = 0, flare = 0, shadow = 0, owner = 0) {
    return this.add(worldX - this.originX, -worldY - this.originY, z, range, r, g, b, scatter, dx, dy, dz, cosOuter, cosInner, flare, shadow, owner);
  }

  /**
   * Buduje listy komórek dla prostokąta LOKALNEGO [x0, x1] × [y0, y1] (bez argumentów —
   * prostokąt z `setBounds`) i oznacza użyte zakresy buforów do wysłania na GPU.
   */
  build(x0, y0, x1, y1) {
    if (x0 === undefined) {
      if (this.hasBounds) { x0 = this.bx0; y0 = this.by0; x1 = this.bx1; y1 = this.by1; }
      else { x0 = -1; y0 = -1; x1 = 1; y1 = 1; }
    }
    const nx = GRID_NX;
    const ny = GRID_NY;
    const cw = Math.max(1, (x1 - x0) / nx);
    const ch = Math.max(1, (y1 - y0) / ny);
    this.cellW = cw;
    this.cellH = ch;
    this.rect.value.set(x0, y0);
    this.invCell.value.set(1 / cw, 1 / ch);
    const counts = this._counts;
    counts.fill(0);
    const L = this.lights;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const o = i * LIGHT_FLOATS;
      const lx = L[o];
      const ly = L[o + 1];
      const range = L[o + 3];
      let bx0 = lx - range;
      let bx1 = lx + range;
      let by0 = ly - range;
      let by1 = ly + range;
      if (L[o + 11] > -1.5) {
        // Reflektor węższy niż półsfera: prostokąt wycinka koła (próbki łuku + wierzchołek).
        const ax = L[o + 8];
        const ay = L[o + 9];
        const al = Math.hypot(ax, ay);
        if (al > 1e-4) {
          const half = Math.acos(Math.max(-1, Math.min(1, L[o + 11])));
          if (half < Math.PI * 0.5) {
            const base = Math.atan2(ay, ax);
            bx0 = bx1 = lx;
            by0 = by1 = ly;
            for (let k = 0; k <= 8; k++) {
              const a = base - half + (2 * half) * (k / 8);
              const px = lx + Math.cos(a) * range * 1.05;
              const py = ly + Math.sin(a) * range * 1.05;
              if (px < bx0) bx0 = px;
              if (px > bx1) bx1 = px;
              if (py < by0) by0 = py;
              if (py > by1) by1 = py;
            }
            const pad = range * 0.06;
            bx0 -= pad; bx1 += pad; by0 -= pad; by1 += pad;
          }
        }
      }
      const cx0 = Math.max(0, Math.floor((bx0 - x0) / cw));
      const cx1 = Math.min(nx - 1, Math.floor((bx1 - x0) / cw));
      const cy0 = Math.max(0, Math.floor((by0 - y0) / ch));
      const cy1 = Math.min(ny - 1, Math.floor((by1 - y0) / ch));
      if (!(cx0 <= cx1 && cy0 <= cy1)) {
        // Poza prostokątem: jawny pusty zakres. Surowe granice światła daleko od kadru
        // (np. −40 000 komórek) przepełniały Int16Array w kopiach dem — zawinięty zakres
        // dawał setki tysięcy pustych iteracji na klatkę (a w scalonym indeksie
        // zapis poza komórkami).
        this._x0[i] = 1; this._x1[i] = 0; this._y0[i] = 1; this._y1[i] = 0;
        continue;
      }
      this._x0[i] = cx0; this._x1[i] = cx1; this._y0[i] = cy0; this._y1[i] = cy1;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) counts[cy * nx + cx]++;
      }
    }
    // Sumy prefiksowe: komórka c = [start (bezwzględny w indeksie), wpisane].
    const I = this.index;
    let total = 0;
    let maxPer = 0;
    for (let c = 0; c < GRID_CELLS; c++) {
      const k = Math.min(counts[c], Math.max(0, ITEM_CAP - total));
      I[c * 2] = CELL_WORDS + total;
      I[c * 2 + 1] = 0;
      if (counts[c] > maxPer) maxPer = counts[c];
      total += k;
    }
    let dropped = 0;
    for (let i = 0; i < n; i++) {
      const cx0 = this._x0[i];
      const cx1 = this._x1[i];
      const cy0 = this._y0[i];
      const cy1 = this._y1[i];
      if (cx0 > cx1 || cy0 > cy1) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * nx + cx;
          const filled = I[c * 2 + 1];
          const at = I[c * 2] + filled;
          if (at >= CELL_WORDS + ITEM_CAP || filled >= counts[c]) { dropped++; continue; }
          I[at] = i;
          I[c * 2 + 1] = filled + 1;
        }
      }
    }
    this.itemsUsed = total;
    this.dropped = dropped;
    this._lightRange.count = Math.max(1, n) * LIGHT_FLOATS;
    this.lightNode.value.needsUpdate = true;
    this._indexRange.count = CELL_WORDS + total;
    this.indexNode.value.needsUpdate = true;
    const s = this.stats;
    s.lights = n;
    s.items = total;
    s.maxPerCell = maxPer;
    s.dropped = dropped;
    s.culled = this.culled;
    return this;
  }

  /**
   * Lustro CPU pętli `loop` (bez map cienia): suma barwa × tłumienie × stożek świateł
   * komórki punktu LOKALNEGO (px, py, pz). Do testów i zapytań CPU (np. HUD). `out` =
   * { r, g, b, n } — n = liczba świateł, które dały wkład.
   */
  sampleCpu(px, py, pz, skipOwner = null, out = { r: 0, g: 0, b: 0, n: 0 }) {
    out.r = 0; out.g = 0; out.b = 0; out.n = 0;
    const rect = this.rect.value;
    const inv = this.invCell.value;
    const cx = Math.floor((px - rect.x) * inv.x);
    const cy = Math.floor((py - rect.y) * inv.y);
    if (cx < 0 || cy < 0 || cx >= GRID_NX || cy >= GRID_NY) return out;
    const c = cy * GRID_NX + cx;
    const I = this.index;
    const L = this.lights;
    const k = this.gain.value;
    for (let it = I[c * 2], end = I[c * 2] + I[c * 2 + 1]; it < end; it++) {
      const o = I[it] * LIGHT_FLOATS;
      const dx = L[o] - px;
      const dy = L[o + 1] - py;
      const dz = L[o + 2] - pz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const x = dist / Math.max(L[o + 3], 1);
      if (!(x < 1)) continue;
      if (skipOwner !== null && skipOwner >= 0.5 && Math.abs(L[o + 15] - skipOwner) <= 0.5) continue;
      const win = 1 - x * x;
      let att = (win * win) / (x * x * 4 + 1);
      if (L[o + 11] > -1.5) {
        const inv = 1 / Math.max(dist, 1e-3);
        const cosA = -(dx * inv * L[o + 8] + dy * inv * L[o + 9] + dz * inv * L[o + 10]);
        const e0 = L[o + 11];
        const e1 = L[o + 12];
        const t = Math.max(0, Math.min(1, (cosA - e0) / (e1 - e0)));
        const cone = t * t * (3 - 2 * t);
        att *= cone * cone;
      }
      out.r += L[o + 4] * k * att;
      out.g += L[o + 5] * k * att;
      out.b += L[o + 6] * k * att;
      out.n++;
    }
    return out;
  }

  // --- TSL -----------------------------------------------------------------

  /**
   * TSL: pętla po światłach komórki punktu P (vec3, układ LOKALNY siatki). Dla każdego
   * światła w zasięgu woła cb({ toL, att, col, scatter, dist, flare, owner }):
   *   toL — wektor jednostkowy od P do światła, att — tłumienie × stożek × cień,
   *   col — barwa × moc × gain, scatter — rozpraszanie w ośrodku (L1.w),
   *   dist — odległość, flare — rozbłysk lampy (L3.y), owner — właściciel (L3.w).
   * skipOwner (węzeł float) pomija światła tego właściciela; właściciele to liczby
   * ≥ 1, wartość < 0,5 (0 = „bez właściciela”) niczego nie pomija — inaczej materiał
   * bez statku gasiłby wszystkie światła efektów (mają właściciela 0). Zmienna pętli
   * ma jawną nazwę (`gridItem`) — można zagnieżdżać w innych `Loop`.
   */
  loop(P, cb, skipOwner = null) {
    const idx = this.indexNode;
    const lights = this.lightNode;
    const c = floor(P.xy.sub(this.rect).mul(this.invCell)).toVar();
    If(c.x.greaterThanEqual(0.0).and(c.y.greaterThanEqual(0.0)).and(c.x.lessThan(GRID_NX)).and(c.y.lessThan(GRID_NY)), () => {
      const cell = uint(int(c.y).mul(GRID_NX).add(int(c.x))).mul(uint(2)).toVar();
      const start = idx.element(cell).toVar();
      const end = start.add(idx.element(cell.add(uint(1)))).toVar();
      Loop({ start, end, type: 'uint', condition: '<', name: 'gridItem' }, ({ gridItem }) => {
        const li = idx.element(gridItem).mul(uint(4)).toVar();
        const L0 = lights.element(li).toVar();
        const d = L0.xyz.sub(P).toVar();
        const dist = length(d).toVar();
        const x = dist.div(max(L0.w, 1.0)).toVar();
        const L3 = lights.element(li.add(uint(3))).toVar();
        const use = skipOwner
          ? x.lessThan(1.0).and(skipOwner.lessThan(0.5).or(abs(L3.w.sub(skipOwner)).greaterThan(0.5)))
          : x.lessThan(1.0);
        If(use, () => {
          const L1 = lights.element(li.add(uint(1))).toVar();
          const L2 = lights.element(li.add(uint(2))).toVar();
          const x2 = x.mul(x);
          const win = float(1.0).sub(x2);
          const att = win.mul(win).div(x2.mul(4.0).add(1.0)).toVar();
          const toL = d.div(max(dist, 1e-3)).toVar();
          If(L2.w.greaterThan(-1.5), () => {
            // Stożek z miękkim brzegiem (smoothstep²). Oś jest jednostkowa (add()),
            // stożek wewnętrzny zawsze węższy od zewnętrznego (brak NaN ze smoothstep).
            const cone = smoothstep(L2.w, L3.x, dot(toL.negate(), L2.xyz));
            att.mulAssign(cone.mul(cone));
          });
          if (this.shadows) {
            If(L3.z.greaterThan(0.5).and(att.greaterThan(1e-4)), () => {
              att.mulAssign(this.shadows.visibility(L3.z, P));
            });
          }
          cb({ toL, att, col: L1.xyz.mul(this.gain), scatter: L1.w, dist, flare: L3.y, owner: L3.w });
        });
      });
    });
  }

  /**
   * TSL: punkt powierzchni w układzie LOKALNYM siatki dla materiałów.
   *   'view'  (domyślnie) — obrót kamery · positionView + (kamera − początek) liczone w
   *           double na CPU (`camLocal`): dokładne także przy 6–10 mln j.
   *           (`positionView` z `highPrecision` = modelViewMatrix z CPU w double);
   *   'world' — positionWorld − początek (float32 na GPU: ~0,5–1 j. szumu przy 6 mln j.;
   *           dla oświetlenia zwykle bez znaczenia, tańsze o jedno mnożenie macierzy).
   */
  localPosition(mode = 'view') {
    if (mode === 'world') {
      if (!this._originNode) {
        this._originNode = uniform(new THREE.Vector3()).setName(`${this.name}Origin`).setGroup(renderGroup)
          .onRenderUpdate(() => { this._originNode.value.set(this.originX, this.originY, 0); });
      }
      return positionWorld.sub(this._originNode);
    }
    return cameraWorldMatrix.mul(vec4(positionView, 0.0)).xyz.add(this.camLocal);
  }
}

// ---------------------------------------------------------------------------
// Oświetlenie materiałów

/**
 * Włącza siatkę świateł w materiale (tryb 'optIn' GridLighting). `owner` — węzeł
 * (np. `uniform(0).onObjectUpdate(({ object }) => object.userData.lightOwner || 0)`
 * — JEDEN wspólny dla materiałów wariantu, żeby dzieliły program) albo liczba ≥ 1:
 * światła z tym właścicielem materiał pomija (0 = bez właściciela, nic nie pomija).
 * Flaga jest zwykłym polem materiału, więc wchodzi do klucza programu
 * (RenderObject.getMaterialCacheKey) — materiał z siatką i bez niej nie dzielą programu.
 */
export function enableGridLights(material, owner = null) {
  material.gridLights = true;
  if (owner && owner.isNode) material.gridLightOwner = owner;
  else if (typeof owner === 'number' && owner >= 0.5) material.gridLightOwner = float(owner);
  return material;
}

/**
 * LightsNode sceny + siatka świateł. Tryb 'optIn' (gra): siatkę czytają tylko
 * materiały z `gridLights === true` — planety, tło, stacje, ring bez zmian (kod i obraz).
 * Tryb 'all' (jak dema): każdy oświetlany materiał poza `gridLights === false`.
 */
export class GridLightsNode extends THREE.LightsNode {
  static get type() { return 'FxGridLightsNode'; }

  constructor(grid, mode = 'optIn', positionMode = 'view') {
    super();
    this.grid = grid;
    this.mode = mode;
    this.positionMode = positionMode;
  }

  get hasLights() {
    return this.mode === 'all' ? true : super.hasLights;
  }

  /** Czy materiał budowany w `builder` czyta siatkę. */
  usesGrid(material) {
    if (!material) return false;
    return this.mode === 'all' ? material.gridLights !== false : material.gridLights === true;
  }

  setupLights(builder, lightNodes) {
    const material = builder.material;
    if (!this.usesGrid(material)) {
      super.setupLights(builder, lightNodes);
      return;
    }
    const reflected = builder.context.reflectedLight;
    // Kolejność deklaracji przed pętlą (jak w TiledLightsNode): zmienne światła
    // bezpośredniego muszą istnieć poza zasięgiem pętli.
    reflected.directDiffuse.toStack();
    reflected.directSpecular.toStack();
    super.setupLights(builder, lightNodes);
    const grid = this.grid;
    // `lightOwner` — nazwa pola z dem (kadłuby dema asteroid / rakiet).
    const owner = material.gridLightOwner ?? material.lightOwner ?? null;
    const skip = owner && owner.isNode ? owner : (typeof owner === 'number' && owner >= 0.5 ? float(owner) : null);
    Fn(() => {
      const P = grid.localPosition(this.positionMode).toVar();
      grid.loop(P, ({ toL, att, col }) => {
        const Lv = normalize(cameraViewMatrix.mul(vec4(toL, 0.0)).xyz);
        builder.lightsNode.setupDirectLight(builder, this, { lightDirection: Lv, lightColor: col.mul(att) });
      }, skip);
    }, 'void')();
  }
}

/**
 * System oświetlenia renderera: światła sceny (słońce itd.) + siatka świateł.
 * `renderer.lighting = new GridLighting(grid)` PRZED pierwszym renderem sceny.
 * Własna mapa scena → węzeł (bazowy `Lighting` trzyma ją w zmiennej modułu: węzeł
 * utworzony przez poprzedni system oświetlenia zostałby dla tej sceny na zawsze).
 */
export class GridLighting extends THREE.Lighting {
  constructor(grid, { mode = 'optIn', positionMode = 'view' } = {}) {
    super();
    this.grid = grid;
    this.mode = mode;
    this.positionMode = positionMode;
    this._nodes = new WeakMap();
  }

  createNode(lights = []) {
    return new GridLightsNode(this.grid, this.mode, this.positionMode).setLights(lights);
  }

  getNode(scene, camera) {
    if (scene.isQuadMesh) return super.getNode(scene, camera);
    let node = this._nodes.get(scene);
    if (node === undefined) {
      node = this.createNode();
      this._nodes.set(scene, node);
    }
    return node;
  }
}

// ---------------------------------------------------------------------------
// Światła pola statku (port FieldLights.addShip z dawnego fieldLights3D.js przez
// dema/asteroidy-webgpu/lights.js) — bez alokacji na wywołanie po stronie siatki.

const _one = [null];
const _emitters = [];
const _clusters = [];
const _emitterOptions = { out: _emitters, maxEmitters: 12 };
const _navOptions = { out: _clusters, time: 0 };
const _far = [];
let _farCount = 0;
const _farInfo = { n: 0, x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0, coneDeg: 36, range: 0, shadow: 0 };
const _axis = { ax: 0, ay: 0, az: 0 };
const NO_OPTS = Object.freeze({});

function spotAxis(dirX, dirY, tiltDeg, out) {
  const tilt = (tiltDeg ?? 0) * Math.PI / 180;
  const len = Math.hypot(dirX, dirY) || 1;
  out.ax = (dirX / len) * Math.cos(tilt);
  out.ay = -(dirY / len) * Math.cos(tilt);
  out.az = -Math.sin(tilt);
  return out;
}

function pushFar(x, y, dx, dy) {
  let f = _far[_farCount];
  if (!f) f = _far[_farCount] = { x: 0, y: 0, dx: 0, dy: 0, ax: 0, ay: 0, az: 0 };
  f.x = x; f.y = y; f.dx = dx; f.dy = dy;
  _farCount++;
}

// Zastępcza para reflektorów na dziobie (okręt bez własnych `road`) na kadłubie belkowym gaśnie z dziobem —
// komórka pod lampą martwa albo odcięta odłamem (hullMounts.js), jak lampy edytora. Wiązanie raz na encję
// i położenie pary (długość kadłuba), żywotność przy zmianie ciała. Zwraca maskę: bit 0 — lewa (s = −1), bit 1 — prawa.
const _bowPairs = new WeakMap();
function bowPairAlive(entity, along, side) {
  const hull = mountHullOf(entity);
  if (!hull) return 3;
  let rec = _bowPairs.get(entity);
  if (rec === undefined) {
    rec = { along: NaN, side: NaN, set: createHullMountSet() };
    _bowPairs.set(entity, rec);
  }
  const set = rec.set;
  if (rec.along !== along || rec.side !== side || set.lineage !== hull.dmgKey) {
    const rest = beginHullMountBind(set, hull, 2);
    const k = 1 / Math.max(1e-6, hull.scale);   // j. świata → px sprite'a
    set.cells[0] = bindHullMount(hull, along * k, -side * k, rest);
    set.cells[1] = bindHullMount(hull, along * k, side * k, rest);
    rec.along = along;
    rec.side = side;
  }
  refreshHullMountSet(set, hull);
  return set.alive[0] | (set.alive[1] << 1);
}

/**
 * Światła pola statku: reflektory dalekie (znaczniki `road` edytora), reflektory
 * otoczenia (`flood`, z obrysu: rufa i burty), światło dookoła, grupy czerwonych lamp
 * pozycyjnych (runtime gry `shipLightRuntime.js`).
 *
 * Wywołanie jak w demie: `addShipLights(grid, encja, długość, ox, oy, opts)` — ox, oy =
 * początek w układzie ŚWIATA gry (`grid.worldOriginX/Y`); albo krócej
 * `addShipLights(grid, encja, długość, opts)` — początek siatki.
 * opts: { floods, nav, strength, time, owner, profile (FIELD_/CAVE_SHIP_LIGHTS),
 *         shadows (atlas z `request(...)`), spotShadows }.
 * Reflektory dalekie dzielą jedną mapę cienia (średnia poza pary na dziobie), każdy
 * reflektor otoczenia ma własną. Zwraca wspólny obiekt `far` (średnia pozycja i oś
 * reflektorów dalekich — kamera mapy cienia), nadpisywany przy kolejnym wywołaniu.
 */
export function addShipLights(grid, entity, hullLength, ox, oy, opts) {
  if (ox !== null && typeof ox === 'object') { opts = ox; ox = undefined; oy = undefined; }
  if (!Number.isFinite(ox)) ox = grid.worldOriginX;
  if (!Number.isFinite(oy)) oy = grid.worldOriginY;
  if (!opts) opts = NO_OPTS;
  const prof = opts.profile || FIELD_SHIP_LIGHTS;
  const sp = prof.spot || FIELD_SHIP_LIGHTS.spot;
  const fl = prof.flood || FIELD_SHIP_LIGHTS.flood;
  const om = prof.omni || FIELD_SHIP_LIGHTS.omni;
  const nv = prof.nav || FIELD_SHIP_LIGHTS.nav;
  const atlas = opts.shadows || null;
  const owner = opts.owner || 0;
  const far = _farInfo;
  far.n = 0; far.x = 0; far.y = 0; far.z = sp.z; far.ax = 0; far.ay = 0; far.az = 0; far.shadow = 0;
  if (!entity) return far;
  // Maskowanie (src/game/cloakLook.js): światła okrętu gasną razem z kadłubem (ukryty — żadnych).
  const k = (opts.strength ?? 1) * cloakLightGain(entity);
  if (!(k > 0.002)) return far;
  const L = Math.max(100, hullLength || 600);
  const range = Math.min(sp.maxRange, Math.max(sp.minRange, L * sp.rangeMul));
  const angle = Number(entity.angle) || 0;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  // NPC w grze całkują x/y (pos to lustro) — jak FieldLights.addShip.
  const ex = Number(entity.pos?.x ?? entity.x) || 0;
  const ey = Number(entity.pos?.y ?? entity.y) || 0;
  _one[0] = entity;
  _emitters.length = 0;
  buildRoadLightWorldEmitters(_one, _emitterOptions);
  // Reflektory wyłączone (`entity.roadLightsOff`, klawisz L gracza): bez dalekich
  // i otoczenia — światło dookoła i lampy pozycyjne zostają.
  const beamsOn = !entity.roadLightsOff;
  // Reflektory dalekie: ze znaczników `road` albo para na dziobie — tylko okrętom bez własnych (zgaszone przez
  // rozpad kadłuba albo agonię hulka nie wracają jako zastępcze; para gaśnie z dziobem).
  _farCount = 0;
  const a = _axis;
  // Moc dzielona przez liczbę reflektorów z układu (zastępcza para: 2), nie przez żywe.
  let farShare = 2;
  if (beamsOn) {
    for (let i = 0; i < _emitters.length; i++) {
      const em = _emitters[i];
      if (!em.flood) pushFar(em.x, em.y, em.dir.x, em.dir.y);
    }
    const own = entityOwnRoadLightCount(entity);
    if (own > 0) farShare = Math.max(_farCount, own);
    else if (!_farCount) {
      const side = L * 0.035;
      const pair = bowPairAlive(entity, L * 0.47, side);
      for (let s = -1; s <= 1; s += 2) {
        if (pair & (s < 0 ? 1 : 2)) pushFar(ex + fx * L * 0.47 - fy * side * s, ey + fy * L * 0.47 + fx * side * s, fx, fy);
      }
    } else farShare = _farCount;
  }
  if (beamsOn && _farCount > 0) {
    for (let i = 0; i < _farCount; i++) {
      const f = _far[i];
      spotAxis(f.dx, f.dy, sp.tiltDeg, a);
      f.ax = a.ax; f.ay = a.ay; f.az = a.az;
      far.n++;
      far.x += f.x - ox; far.y += -(f.y - oy);
      far.ax += a.ax; far.ay += a.ay; far.az += a.az;
    }
    far.x /= far.n; far.y /= far.n;
    const al = Math.hypot(far.ax, far.ay, far.az) || 1;
    far.ax /= al; far.ay /= al; far.az /= al;
    far.coneDeg = sp.coneDeg;
    far.range = range;
    if (atlas && opts.spotShadows !== false) far.shadow = atlas.request(true, far.x, far.y, sp.z, far.ax, far.ay, far.az, sp.coneDeg, range);
    const half = Math.max(1, Math.min(170, sp.coneDeg)) * Math.PI / 360;
    const I = sp.intensity / Math.sqrt(farShare);
    for (let i = 0; i < _farCount; i++) {
      const f = _far[i];
      grid.add(
        f.x - ox, -(f.y - oy), sp.z, range,
        sp.color[0] * I * k, sp.color[1] * I * k, sp.color[2] * I * k,
        sp.scatter ?? 1, f.ax, f.ay, f.az,
        Math.cos(half), Math.cos(half * (sp.innerFrac ?? 0.45)), sp.flare ?? 1, far.shadow, owner
      );
    }
  }
  // Reflektory otoczenia: rufa i burty (moc z lampy edytora, 1,5 = domyślna).
  if (beamsOn && opts.floods !== false) {
    const floodRange = Math.min(fl.maxRange, Math.max(fl.minRange, L * fl.rangeMul));
    const fh = Math.max(1, Math.min(170, fl.coneDeg)) * Math.PI / 360;
    for (let i = 0; i < _emitters.length; i++) {
      const em = _emitters[i];
      if (!em.flood) continue;
      spotAxis(em.dir.x, em.dir.y, fl.tiltDeg, a);
      const x = em.x - ox;
      const y = -(em.y - oy);
      const shadow = atlas && opts.spotShadows !== false ? atlas.request(false, x, y, fl.z, a.ax, a.ay, a.az, fl.coneDeg, floodRange) : 0;
      const fI = fl.intensity * (Number(em.power) || 1.5) / 1.5;
      grid.add(
        x, y, fl.z, floodRange,
        fl.color[0] * fI * k, fl.color[1] * fI * k, fl.color[2] * fI * k,
        fl.scatter ?? 0.5, a.ax, a.ay, a.az,
        Math.cos(fh), Math.cos(fh * (fl.innerFrac ?? 0.4)), fl.flare ?? 0.3, shadow, owner
      );
    }
  }
  const omRange = Math.min(om.maxRange, Math.max(om.minRange, L * om.rangeMul));
  // Światło dookoła oświetla też własny kadłub (bez niego w mroku pola kadłub gasł
  // całkiem) — dlatego bez właściciela; lampy i reflektory własnego kadłuba już nie.
  grid.add(ex - ox, -(ey - oy), om.z, omRange, om.color[0] * om.intensity * k, om.color[1] * om.intensity * k, om.color[2] * om.intensity * k, om.scatter);
  if (opts.nav !== false) {
    _navOptions.time = opts.time || 0;
    buildNavLightClusters(_one, _navOptions);
    for (let i = 0; i < _clusters.length; i++) {
      const c = _clusters[i];
      const intensity = nv.intensity * c.power * c.pulse * k;
      grid.add(c.x - ox, -(c.y - oy), nv.z, Math.max(nv.minRange, c.rangeWorld * nv.rangeMul),
        c.color.r * intensity, c.color.g * intensity, c.color.b * intensity, nv.scatter,
        0, 0, -1, OMNI, 0, 0, 0, owner);
    }
  }
  _one[0] = null;
  return far;
}
