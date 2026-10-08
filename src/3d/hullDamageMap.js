// src/3d/hullDamageMap.js
//
// MAPA RAN NA KADŁUBACH BELKOWYCH (zadanie 18-C, docs/webgpu/PROJEKT-BRONI.md §3) — część CPU:
// sloty w puli, przydział po kluczu rodu (`hull.dmgKey`: kadłub, jego wrak i odłamy — jedna
// warstwa w uv rodzica), LRU, kolejka stempli, lista zadań kernela i krok klatki efektów
// (`Core3D.addFxStep`). GPU (pula, kernel, próbkowanie w materiale): hullDamageMap.tsl.js.
//
// SKĄD STEMPLE:
//   • KRATERY i RZAZY — hak `HullBodies.onImpact` → `onHullImpact(entity, r)` po każdym `impact` i
//     `cutSegment` (Hexlance), bez bramki LOD efektów (każde trafienie zostawia ranę). Punkt i uv z
//     `hullImpactResult` (ten sam węzeł co krater). Rodzinę broni podaje wołający:
//     `setSource(pocisk | broń | id, wariant)` … `HullBodies.impact(...)` … `clearSource()` (jak
//     ActiveCarrier; w grze robi to applyHexImpact w index.html). Bez źródła: krater = `generic`,
//     rzaz = Hexlance;
//   • RECEPTURY efektów (zadanie 17): `ctx.stamp` fasady WeaponFx → `stampRecipe(encja, x, y, …)` z
//     parametrami receptury. Stempel w miejscu krateru z haka tej klatki jest pomijany (to samo
//     trafienie), reszta idzie na mapę: wtórne wybuchy Yamato (zdarzenia opóźnione — w miejscu
//     widocznych wybuchów, punkt przesunięty o ruch nośnika), rzazy i zakleszczenia przebić (18-B),
//     wiązka ciągła między taktami obrażeń, żar płonącej wyrwy (`burnStep`);
//   • bez krateru i bez receptury (narzędzia, 18-B): `stampAt(e, x, y, rodzina, wariant, dirX, dirY)`,
//     `stampKerf(e, x0, y0, x1, y1, rodzina)`;
//   • ROZDARCIA (2026-09-29) — hak `HullBodies.onNodeLost` → `onHullNodeLost`: węzeł zniszczony poza
//     trafieniem broni (zderzenie i zgniot, oparcie po zerwanych belkach, odpryski rozpadu, cięcie wraku,
//     wybuch reaktora) dostaje stempel rodziny `tear` z dziurą o promieniu ~1 komórki — ten sam materiał
//     rany co po broni: poszarpany, osmalony brzeg dziury zamiast gołych krawędzi siatki. Węzły bliżej
//     niż DMG_TEAR_MERGE_CELLS od stempla tej klatki łączą się; najwyżej DMG_TEAR_SLOT_CAP stempli slotu
//     na klatkę (reszta limitu — broń).
//
// Reguła „dziura albo krater” (§3.4): promień = krater zabił węzły ? max(receptura, zasięg
// dziury + ½ komórki) : receptura. Przestrzelina PRZEZROCZYSTA (kanał otworu) tylko z małego
// kalibru bez krateru (r ≤ 0,6 komórki); w pozostałych kształt brzegu z receptury bez
// przezroczystości — dziurę robi geometria belek (krater, rzaz).
// Lej tylko w prawdziwej dziurze (zadanie 25c): stempel krateru / rzazu niesie promień dziury
// (hullImpactResult.crater — zasięg węzłów zabitych przez krater; rzaz — pół szerokości pasa), kernel
// kładzie go do kanału krateru teksela, a materiał maluje lej (ciemne dno) tylko tam; reszta rany —
// żar i osmalenie. Stemple receptur, stampAt i stampKerf dziury nie mają (lej się nie pojawia).
//
// Pamięć (klasy wg długości kadłuba-korzenia w świecie, teksel 8 B): L 512×256 ×12 (≥ 900 j.),
// M 256×128 ×32 (400–900), S 128×64 ×64 (160–400), myśliwce bez mapy → 24 MB GPU (kopia CPU
// zwalniana po wgraniu). Pełna klasa: najpierw WOLNY slot większej klasy, potem slot najdawniej
// widzianego kadłuba spoza kadru (LRU) w swojej klasie, potem mniejsza klasa; wszystko w kadrze —
// stempel przepada (licznik).
// Trafienia dalej niż pół kadru od ekranu nie stemplują (walka poza kadrem nie mieli slotów).
//
// Klatka: fizyka stempluje (kolejka CPU) → updateHexShips3D wiąże sloty z materiałami (`bind`:
// widoczność dla LRU i stygnięcia) → krok efektów przed passami: zadania (czyszczenie brudnego
// prostokąta przejętego slotu, stygnięcie gorących w kadrze, naprawa, stemple) i jeden dispatch.
// Zero alokacji na trafienie i na klatkę (tablice typowane, rekordy slotów stworzone raz).

import { attributeArray, uniform } from 'three/tsl';
import { Core3D } from './core3d.js';
import { HullBodies } from '../game/hullBodies.js';
import { fxRandom } from './fx/fxRandom.js';
import { ActiveCarrier } from '../game/carrierVelocity.js';
import { SimClock } from '../game/simClock.js';
import {
  stampEntry, stampFamilyFor, stampPowerFor, stampFlakRadiusFor,
  S_R, S_HEAT, S_SCORCH, S_HOLE, S_ION, S_ELONG, S_POW, TEAR_HOLE_CELLS
} from './hullDamageStamps.js';
import {
  DMG_CLASSES, DMG_POOL_TEXELS, DMG_FLAG_CLEAR, DMG_FLAG_ZERO_HEAT, DMG_JOB_VEC4, DMG_STAMP_VEC4, DMG_STAMP_REACH,
  createHullDamageKernel, damageHotSeconds, hullDamagePool
} from './hullDamageMap.tsl.js';

/** Żar świeżego spawu łaty (pas przy krawędzi komórki — stygnie jak rana: czerwień ~2–3 s). */
export const DMG_PATCH_SEAM_HEAT = 1.6;
/** Pół boku kwadratu łaty względem pół komórki (zakładka — sąsiednie łaty bez szpar). */
export const DMG_PATCH_OVERLAP = 1.04;

// ── Konfiguracja ────────────────────────────────────────────────────────────

// Klasy slotów i rozmiar puli: jedno źródło przy puli (hullDamageMap.tsl.js — materiał i kernel).
export { DMG_CLASSES, DMG_POOL_TEXELS };
export const DMG_TEXEL_BYTES = 8;
/** Stempli na klatkę (ponad — przepadają, licznik `stats.droppedStamps`). */
export const DMG_STAMP_CAP = 1024;
/** Stempli jednego slotu na klatkę (seria CIWS w jeden kadłub). */
export const DMG_SLOT_STAMP_CAP = 48;
/** Zadań na klatkę (potęga dwójki ≥ liczby slotów). */
export const DMG_JOB_CAP = 128;
/** Kraterów z haka pamiętanych w klatce (pomijanie duplikatów ctx.stamp receptur). */
export const DMG_HOOK_RING = 64;
/** Przestrzelina przezroczysta tylko z kalibru o promieniu stempla ≤ tyle komórek silnika (§3.4). */
export const DMG_SMALL_CALIBER_CELLS = 0.6;
/** Wygaszanie osmalenia i przestrzelin przy naprawie R [1/s] (jak HP węzłów: 0,8 maxHp/s). */
export const DMG_HEAL_RATE = 0.8;
/** Czas, po którym najgorętszy teksel (żar ≤ DMG_HEAT_MAX) jest zimny [s] (~6,3 s). */
export const DMG_HOT_SEC = damageHotSeconds();
/** Znaki rzazu wzdłuż cięcia: odstęp [j.] i najwięcej znaków na jedno cięcie. */
export const DMG_KERF_STEP = 22;
export const DMG_KERF_MAX = 8;
/** Trafienie dalej od kadru efektów (Core3D.fx.view) niż ten ułamek jego boku — bez stempla. */
export const DMG_VIEW_MARGIN = 0.5;
/** Rozdarcia: węzeł bliżej stempla rozdarcia tej klatki niż tyle komórek — bez nowego stempla. */
export const DMG_TEAR_MERGE_CELLS = 0.9;
/** Rozdarcia: stempli slotu na klatkę (DMG_SLOT_STAMP_CAP − ta liczba zostaje dla broni). */
export const DMG_TEAR_SLOT_CAP = 32;
/** Rozdarcia tej klatki pamiętane do łączenia (pierścień). */
export const DMG_TEAR_RING = 64;

const TEXELS = DMG_POOL_TEXELS;
const SLOT_COUNT = DMG_CLASSES.reduce((n, c) => n + c.count, 0);
if (SLOT_COUNT > DMG_JOB_CAP) throw new Error('hullDamageMap: DMG_JOB_CAP < liczba slotów');

/** Klasa slotu dla kadłuba o długości `len` [j. świata] (−1 = bez mapy). */
export function damageClassFor(len) {
  for (let c = 0; c < DMG_CLASSES.length; c++) if (len >= DMG_CLASSES[c].minLen) return c;
  return -1;
}

// ── Stan ────────────────────────────────────────────────────────────────────

// Prostokąty tekseli: [x0, y0, x1, y1], x0 > x1 = pusty.
function makeSlot(index, cls, base) {
  const C = DMG_CLASSES[cls];
  return {
    index, cls, base, w: C.w, h: C.h,
    key: 0, seen: -1, worldW: 1, worldH: 1, aspect: 1,
    clear: false, hot: false, hotUntil: 0, coolTime: 0,
    hx0: 1, hy0: 1, hx1: 0, hy1: 0,           // gorące teksele (stygną w kadrze)
    dx0: 1, dy0: 1, dx1: 0, dy1: 0,           // brudne teksele puli (do wyczyszczenia przy przejęciu)
    px0: 1, py0: 1, px1: 0, py1: 0,           // stemple tej klatki
    pending: 0, cursor: 0, heal: 0, release: false
  };
}

// Zakres wysyłki atrybutu na stałe (jak lightGrid.js: three czyści listę po wysyłce — tu nie).
function keepUpdateRanges() {}
function permanentUpdateRange(attr) {
  const range = { start: 0, count: attr.array.length };
  attr.updateRanges.length = 0;
  attr.updateRanges.push(range);
  attr.clearUpdateRanges = keepUpdateRanges;
  return range;
}

const _pose = { x: 0, y: 0, theta: 0, c: 1, s: 0 };
const _uv = { u: 0, v: 0, du: 0, dv: 0 };
const _patchWorld = { x: 0, y: 0 };

// Parametry stempla dla _enqueueStamp — tablica zamiast argumentów: liczby double w argumentach
// wywołań nieinlinowanych V8 pakuje w obiekty (~45 B na trafienie, pomiar w teście alokacji).
// u, v — uv skóry; r — promień [j. świata]; kierunek w świecie gry (0, 0 = koło); el — wydłużenie;
// hole — promień prawdziwej dziury [j. świata] (0 = bez dziury: lej się nie maluje; zadanie 25c).
const P_U = 0, P_V = 1, P_R = 2, P_HEAT = 3, P_SCORCH = 4, P_RIM = 5, P_CUT = 6, P_ION = 7, P_DX = 8, P_DY = 9, P_EL = 10,
  P_HOLE = 11;
const _p = new Float64Array(12);
/** Liczb na stempel w kolejce i buforze GPU (DMG_STAMP_VEC4 × 4). */
export const DMG_STAMP_FLOATS = DMG_STAMP_VEC4 * 4;
const SF = DMG_STAMP_FLOATS;
// Parametry receptury (żar, osmalenie, brzeg, jony, wydłużenie) z wpisu tabeli STAMP do _p.
function setStampEntry(entry) {
  _p[P_HEAT] = entry[S_HEAT]; _p[P_SCORCH] = entry[S_SCORCH]; _p[P_RIM] = entry[S_HOLE]; _p[P_ION] = entry[S_ION];
  _p[P_EL] = entry[S_ELONG];
}
// Wektor świata do przesunięcia uv (pętla rzazu) — też przez tablicę.
const _vec = new Float64Array(2);

export const HullDamageMap = {
  enabled: true,
  // Narzędzia (odczyt puli przez renderer.getArrayBufferAsync — rozmiar z kopii CPU): nie oddawaj kopii.
  keepCpuCopy: false,
  frame: 0,
  slots: [],
  _byKey: new Map(),
  // Kolejka stempli klatki (SoA): slot, A (u, v, r/H, otwór), B (żar, osmalenie, brzeg, jony), C (kierunek uv,
  // wydłużenie, ziarno), D (promień dziury / H, 0, 0, 0).
  _qSlot: new Int32Array(DMG_STAMP_CAP),
  _qData: new Float32Array(DMG_STAMP_CAP * SF),
  _qCount: 0,
  // Kratery z haka tej klatki (klucz, x, y, promień) — pierścień; klatka wpisu osobno.
  _hookData: new Float64Array(DMG_HOOK_RING * 4),
  _hookFrame: new Int32Array(DMG_HOOK_RING).fill(-1),
  _hookHead: 0,
  // Rozdarcia tej klatki (klucz, x, y) — pierścień do łączenia sąsiednich węzłów.
  _tearData: new Float64Array(DMG_TEAR_RING * 3),
  _tearFrame: new Int32Array(DMG_TEAR_RING).fill(-1),
  _tearHead: 0,
  // Źródło trafienia (setSource / clearSource).
  _src: { active: false, family: 'generic', variant: 'impact', power: 1, flakR: 0 },
  // GPU (leniwie): pula, bufory zadań i stempli, kernel, krok klatki efektów.
  _gpu: null,
  _step: null,
  _time: 0,
  stats: {
    poolBytes: TEXELS * DMG_TEXEL_BYTES, cpuCopyBytes: TEXELS * DMG_TEXEL_BYTES, slotsL: 0, slotsM: 0, slotsS: 0,
    stamps: 0, droppedStamps: 0, offView: 0, noSlot: 0, evictions: 0, downgrades: 0, upgrades: 0,
    jobs: 0, threads: 0, dispatch: 0, heals: 0, recipeStamps: 0, recipeDup: 0,
    tearStamps: 0, tearMerged: 0, tearCapped: 0, patchStamps: 0
  },

  // ── Przydział ─────────────────────────────────────────────────────────────

  _ensureSlots() {
    if (this.slots.length) return;
    let base = 0;
    let index = 0;
    for (let c = 0; c < DMG_CLASSES.length; c++) {
      const C = DMG_CLASSES[c];
      for (let k = 0; k < C.count; k++) {
        this.slots.push(makeSlot(index++, c, base));
        base += C.w * C.h;
      }
    }
  },

  /**
   * Slot rodu `key`: istniejący albo nowy — wolny w swojej klasie → wolny w większej (tylko wolny:
   * nie wypycha dużych kadłubów) → LRU spoza kadru w swojej klasie → mniejsza klasa (wolny, potem
   * LRU). null = brak (wszystko w kadrze).
   */
  acquire(key, worldW, worldH) {
    if (!(key > 0) || !this.enabled) return null;
    this._ensureSlots();
    const have = this._byKey.get(key);
    if (have !== undefined) return have;
    const cls = damageClassFor(Math.max(worldW, worldH));
    if (cls < 0) return null;
    // Klasy: 0 = L (największa) … 2 = S; mniejszy indeks = większa klasa.
    let s = this._pick(cls, false);
    for (let c = cls - 1; !s && c >= 0; c--) s = this._pick(c, false);
    if (!s) s = this._pick(cls, true);
    for (let c = cls + 1; !s && c < DMG_CLASSES.length; c++) s = this._pick(c, true);
    if (!s) {
      this.stats.noSlot++;
      return null;
    }
    if (s.key !== 0) {
      this._byKey.delete(s.key);
      this.stats.evictions++;
    }
    if (s.cls > cls) this.stats.downgrades++;
    else if (s.cls < cls) this.stats.upgrades++;
    this._assign(s, key, worldW, worldH);
    return s;
  },

  // Wolny slot klasy albo — z allowLru — najdawniej widziany spoza kadru. Chronione: widziane w ostatniej
  // narysowanej klatce i ze stemplami tej klatki (ich stemple czekają w kolejce).
  _pick(cls, allowLru) {
    const S = this.slots;
    let lru = null;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (s.cls !== cls) continue;
      if (s.key === 0) return s;
      if (!allowLru || s.seen >= this.frame - 1 || s.pending > 0) continue;
      if (!lru || s.seen < lru.seen) lru = s;
    }
    return lru;
  },

  _assign(s, key, worldW, worldH) {
    s.key = key;
    s.worldW = Math.max(1, worldW);
    s.worldH = Math.max(1, worldH);
    s.aspect = s.worldW / s.worldH;
    // Brudny prostokąt poprzedniego właściciela czyści pierwsze zadanie (pusty = nic do czyszczenia).
    s.clear = s.dx0 <= s.dx1;
    s.hot = false;
    s.hotUntil = 0;
    s.coolTime = this._time;
    s.hx0 = 1; s.hy0 = 1; s.hx1 = 0; s.hy1 = 0;
    s.px0 = 1; s.py0 = 1; s.px1 = 0; s.py1 = 0;
    s.pending = 0;
    s.heal = 0;
    s.release = false;
    // Świeży slot jest „widziany” w tej klatce — nie odda go następne trafienie w innego.
    s.seen = this.frame;
    this._byKey.set(key, s);
    this._countSlots();
    // Krok klatki efektów przy pierwszej ranie, gdyby rozgrzewka (prewarmHexShips3D) nie poszła.
    if (!this._step) this.ensureStep();
  },

  _free(s) {
    if (s.key) this._byKey.delete(s.key);
    s.key = 0;
    s.seen = -1;
    s.hot = false;
    s.clear = false;
    s.pending = 0;
    s.heal = 0;
    s.release = false;
    this._countSlots();
  },

  _countSlots() {
    let l = 0, m = 0, sm = 0;
    for (const s of this.slots) {
      if (!s.key) continue;
      if (s.cls === 0) l++; else if (s.cls === 1) m++; else sm++;
    }
    this.stats.slotsL = l; this.stats.slotsM = m; this.stats.slotsS = sm;
  },

  /** Slot rodu bez przydziału (albo undefined). */
  slotOf(key) { return this._byKey.get(key); },

  // Punkt trafienia (świat gry) daleko poza kadrem efektów — bez stempla.
  _offView(x, y) {
    const v = Core3D.fx?.view;
    if (!v || !(v.x1 > v.x0) || !(v.y1 > v.y0)) return false;
    const mx = (v.x1 - v.x0) * DMG_VIEW_MARGIN;
    const my = (v.y1 - v.y0) * DMG_VIEW_MARGIN;
    if (x >= v.x0 - mx && x <= v.x1 + mx && y >= v.y0 - my && y <= v.y1 + my) return false;
    this.stats.offView++;
    return true;
  },

  // ── Materiał (hexShips3D.js, raz na klatkę na rysowany kadłub) ─────────────

  /**
   * Wiąże slot rodu z materiałem kadłuba (holdery createHullUniforms: uDmgSlot, uDmgWorld)
   * i zaznacza go jako widoczny (LRU, stygnięcie w kadrze). Brak slotu → mapa wyłączona.
   */
  bind(key, uniforms) {
    const slotU = uniforms?.uDmgSlot?.value;
    if (!slotU) return false;
    const s = key > 0 ? this._byKey.get(key) : undefined;
    if (s === undefined) {
      slotU.w = 0;
      return false;
    }
    s.seen = this.frame;
    slotU.set(s.base, s.w, s.h, 1);
    const worldU = uniforms.uDmgWorld?.value;
    if (worldU) worldU.set(s.worldW, s.worldH);
    return true;
  },

  // ── Źródło trafienia ──────────────────────────────────────────────────────

  /**
   * Źródło stempla dla najbliższego haka onImpact: pocisk gry (`vfxKey`, `type`, `weaponSize`,
   * `flakBurstRadius`), opis broni z MASTER_WEAPONS (`id`, `category`, `size`) albo id / rodzina
   * (string); wariant — 'impact' | 'kerf' | 'exit' | 'stuck' | 'ricochet' (18-B; rodzina bez wariantu —
   * stempel trafienia, hullDamageStamps.stampEntry). Kierunek lotu niesie hullImpactResult
   * (impact: wektor `vel`, cut: odcinek).
   */
  setSource(src, variant = 'impact') {
    const s = this._src;
    s.active = true;
    s.family = stampFamilyFor(src);
    s.variant = variant || 'impact';
    s.power = stampPowerFor(src);
    s.flakR = stampFlakRadiusFor(src);
  },

  clearSource() {
    this._src.active = false;
  },

  // ── Haki HullBodies ───────────────────────────────────────────────────────

  /** HullBodies.onImpact: stempel z krateru albo znaki rzazu wzdłuż cięcia. */
  onHullImpact(entity, r) {
    const self = HullDamageMap;
    const hull = entity?.beamHull;
    if (!hull || !r || !(r.dmgKey > 0) || !self.enabled) return;
    if (self._offView(r.x, r.y)) return;
    const worldW = hull.srcWidth * hull.scale;
    const worldH = hull.srcHeight * hull.scale;
    const slot = self.acquire(r.dmgKey, worldW, worldH);
    if (!slot) return;
    const src = self._src.active ? self._src : null;
    const cut = r.kind === 'cut';
    const family = src ? src.family : (cut ? 'hexlance' : 'generic');
    const variant = src ? src.variant : (cut ? 'kerf' : 'impact');
    const e = stampEntry(family, variant);
    const cs = hull.cellSize;
    let rad = e[S_R] * (e[S_POW] ? (src ? src.power : 1) : 1);
    if (family === 'flak' && src && src.flakR > 0) rad = src.flakR * 0.2;
    // Prawdziwa dziura (zadanie 25c): krater — zasięg węzłów zabitych przez krater, rzaz — pół
    // szerokości pasa; w niej (i tylko w niej) lej rany (kanał krateru teksela).
    const holeR = cut ? (r.killed > 0 ? r.radius : 0) : (r.crater > 0 ? r.crater : 0);
    // Reguła „dziura albo krater”: krater (zabite węzły) — dziura z geometrii, żar obejmuje brzeg.
    let holeCut = 0;
    if (holeR > 0) rad = Math.max(rad, holeR + 0.5 * cs);
    else if (!(r.killed > 0) && rad <= DMG_SMALL_CALIBER_CELLS * cs) holeCut = e[S_HOLE];
    const dirX = r.dirX || 0;
    const dirY = r.dirY || 0;
    setStampEntry(e);
    _p[P_R] = rad;
    _p[P_DX] = dirX;
    _p[P_DY] = dirY;
    _p[P_HOLE] = holeR;
    if (cut || variant === 'kerf') {
      // Pas rzazu: znaki co ≤ DMG_KERF_STEP od wejścia do końca cięcia (≤ DMG_KERF_MAX), bez otworu.
      const len = Math.min(r.len > 0 ? r.len : 0, Math.max(worldW, worldH));
      const n = Math.max(1, Math.min(DMG_KERF_MAX, Math.ceil(len / DMG_KERF_STEP)));
      const step = n > 1 ? len / (n - 1) : 0;
      _p[P_CUT] = 0;
      for (let k = 0; k < n; k++) {
        _vec[0] = dirX * step * k;
        _vec[1] = dirY * step * k;
        uvDelta(hull);
        _p[P_U] = r.u + _uv.du;
        _p[P_V] = r.v + _uv.dv;
        self._enqueueStamp(slot, hull);
      }
    } else {
      _p[P_U] = r.u;
      _p[P_V] = r.v;
      _p[P_CUT] = holeCut;
      if (self._enqueueStamp(slot, hull)) self._rememberHook(r.dmgKey, r.x, r.y, rad);
    }
  },

  // Krater z haka w tej klatce (pierścień): receptura efektu trafienia (17) woła ctx.stamp w tym samym
  // punkcie — ten stempel już jest (bez bramki LOD efektu), więc stampRecipe go pomija.
  _rememberHook(key, x, y, r) {
    const i = this._hookHead;
    this._hookHead = (i + 1) % DMG_HOOK_RING;
    const o = i * 4;
    this._hookData[o] = key; this._hookData[o + 1] = x; this._hookData[o + 2] = y; this._hookData[o + 3] = r;
    this._hookFrame[i] = this.frame;
  },

  _hookedHere(key, x, y, r) {
    const H = this._hookData, F = this._hookFrame;
    for (let i = 0; i < DMG_HOOK_RING; i++) {
      if (F[i] !== this.frame) continue;
      const o = i * 4;
      if (H[o] !== key) continue;
      const dx = H[o + 1] - x, dy = H[o + 2] - y;
      const rr = Math.max(r, H[o + 3]);
      if (dx * dx + dy * dy <= rr * rr) return true;
    }
    return false;
  },

  /**
   * `ctx.stamp` receptur efektów broni (zadanie 17, src/3d/weapons/recipes.js): (encja kadłuba, punkt
   * świata gry, promień, żar, osmalenie, brzeg rany, jony, kierunek, wydłużenie) — parametry wprost z
   * receptury. Pomija stempel w miejscu krateru z haka tej klatki (trafienie już ostemplowane — hak nie
   * zależy od bramki LOD efektu), resztę stempluje: wtórne wybuchy Yamato (zdarzenia opóźnione — punkt
   * przesunięty o ruch nośnika od chwili trafienia), rzazy przebić (18-B), wiązkę ciągłą między taktami
   * obrażeń, podtrzymanie żaru płonącej wyrwy (`burn`). Przestrzelina nigdy przezroczysta.
   */
  stampRecipe(entity, x, y, r, heat, scorch = 0, hole = 0, ion = 0, dirX = 0, dirY = 0, elong = 1) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || !(hull.dmgKey > 0) || !this.enabled) return false;
    // Zdarzenie opóźnione: punkt świata z chwili trafienia — kadłub przez ten czas się przesunął.
    const c = ActiveCarrier;
    if (c.vx !== 0 || c.vy !== 0) {
      const dt = SimClock.now(c.clock) - c.t0;
      if (dt > 0 && dt < 5) { x += c.vx * dt; y += c.vy * dt; }
    }
    if (this._hookedHere(hull.dmgKey, x, y, r)) { this.stats.recipeDup++; return false; }
    if (this._offView(x, y)) return false;
    const slot = this.acquire(hull.dmgKey, hull.srcWidth * hull.scale, hull.srcHeight * hull.scale);
    if (!slot) return false;
    const uv = HullBodies.spriteUvAt(entity, x, y);
    _p[P_U] = uv.u; _p[P_V] = uv.v; _p[P_R] = r;
    _p[P_HEAT] = heat; _p[P_SCORCH] = scorch; _p[P_RIM] = hole; _p[P_CUT] = 0; _p[P_ION] = ion;
    _p[P_DX] = dirX; _p[P_DY] = dirY; _p[P_EL] = elong > 1 ? elong : 1; _p[P_HOLE] = 0;
    const ok = this._enqueueStamp(slot, hull);
    if (ok) this.stats.recipeStamps++;
    return ok;
  },

  /**
   * HullBodies.onNodeLost: węzeł zniszczony poza trafieniem broni (zderzenie, zgniot, oparcie, rozpad,
   * cięcie, wybuch reaktora) — stempel rozdarcia (`tear`) w uv jego komórki z dziurą ~1 komórki: lej rany
   * tylko przy prawdziwej dziurze, poszarpany szumem, dookoła osmalenie i słaby żar. Sąsiednie węzły tej
   * klatki łączą się (DMG_TEAR_MERGE_CELLS), limit na slot zostawia miejsce stemplom broni.
   */
  onHullNodeLost(entity, hull, u, v, x, y) {
    const self = HullDamageMap;
    if (!hull || !(hull.dmgKey > 0) || !self.enabled) return;
    const key = hull.dmgKey;
    const cs = hull.cellSize;
    if (self._tornHere(key, x, y, DMG_TEAR_MERGE_CELLS * cs)) { self.stats.tearMerged++; return; }
    if (self._offView(x, y)) return;
    const slot = self.acquire(key, hull.srcWidth * hull.scale, hull.srcHeight * hull.scale);
    if (!slot) return;
    if (slot.pending >= DMG_TEAR_SLOT_CAP) { self.stats.tearCapped++; return; }
    setStampEntry(stampEntry('tear'));
    _p[P_U] = u; _p[P_V] = v; _p[P_R] = stampEntry('tear')[S_R]; _p[P_CUT] = 0;
    _p[P_DX] = 0; _p[P_DY] = 0; _p[P_HOLE] = TEAR_HOLE_CELLS * cs;
    if (!self._enqueueStamp(slot, hull)) return;
    self.stats.tearStamps++;
    const i = self._tearHead;
    self._tearHead = (i + 1) % DMG_TEAR_RING;
    const o = i * 3;
    self._tearData[o] = key; self._tearData[o + 1] = x; self._tearData[o + 2] = y;
    self._tearFrame[i] = self.frame;
  },

  _tornHere(key, x, y, r) {
    const T = this._tearData, F = this._tearFrame, r2 = r * r;
    for (let i = 0; i < DMG_TEAR_RING; i++) {
      if (F[i] !== this.frame) continue;
      const o = i * 3;
      if (T[o] !== key) continue;
      const dx = T[o + 1] - x, dy = T[o + 2] - y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  },

  /** HullBodies.onRepair: naprawa R wygasza osmalenie i przestrzeliny; koniec naprawy czyści mapę. */
  onHullRepair(entity, dt, changed) {
    const self = HullDamageMap;
    const key = entity?.beamHull?.dmgKey;
    const s = key > 0 ? self._byKey.get(key) : undefined;
    if (s === undefined) return;
    s.heal += changed ? Math.max(0, Number(dt) || 0) * DMG_HEAL_RATE : 1;
  },

  /**
   * ŁATA (rój dronów naprawczych, src/game/repairRig.js): odbudowana komórka (ix, iy) kadłuba to nowa blacha — w jej
   * kwadracie mapa ran gaśnie (osmalenie, lej, brzeg, otwór, jony), przy krawędzi zostaje świeży spaw (żar `seamHeat`
   * stygnący jak rana). Podkład ze spawami rysuje skóra (beamHullSkin.js → hexShips3D.tsl.js). Bez slotu — slot
   * dostaje (świeży spaw też jest raną). Zwraca, czy stempel trafił do kolejki.
   */
  patchCell(entity, ix, iy, seamHeat = DMG_PATCH_SEAM_HEAT) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || !(hull.dmgKey > 0) || !this.enabled) return false;
    const w = HullBodies.cellWorld(entity, ix, iy, _patchWorld);
    if (w && this._offView(w.x, w.y)) return false;
    const slot = this.acquire(hull.dmgKey, hull.srcWidth * hull.scale, hull.srcHeight * hull.scale);
    if (!slot) return false;
    if (this._qCount >= DMG_STAMP_CAP || slot.pending >= DMG_SLOT_STAMP_CAP) {
      this.stats.droppedStamps++;
      return false;
    }
    // uv środka komórki (konwencja skóry: v = 0 u góry obrazu) i pół boku w jednostkach wysokości kadłuba (kernel).
    const pp = hull.pixelPitch;
    const u = (ix + 0.5) * pp / hull.srcWidth;
    const v = (hull.ny - (iy + 0.5)) * pp / hull.srcHeight;
    const half = 0.5 * pp / hull.srcHeight * DMG_PATCH_OVERLAP;
    const hu = half / slot.aspect;
    const x0 = Math.max(0, Math.floor((u - hu) * slot.w - 0.5));
    const x1 = Math.min(slot.w - 1, Math.ceil((u + hu) * slot.w - 0.5));
    const y0 = Math.max(0, Math.floor((v - half) * slot.h - 0.5));
    const y1 = Math.min(slot.h - 1, Math.ceil((v + half) * slot.h - 0.5));
    if (!(x0 <= x1 && y0 <= y1)) return false;
    const i = this._qCount++;
    const o = i * SF;
    const Q = this._qData;
    Q[o] = u; Q[o + 1] = v; Q[o + 2] = half; Q[o + 3] = 0;
    Q[o + 4] = 0; Q[o + 5] = 0; Q[o + 6] = 0; Q[o + 7] = 0;
    Q[o + 8] = 1; Q[o + 9] = 0; Q[o + 10] = 1; Q[o + 11] = 0;
    Q[o + 12] = 0; Q[o + 13] = half; Q[o + 14] = Math.max(0, Number(seamHeat) || 0); Q[o + 15] = 0;
    this._qSlot[i] = slot.index;
    if (slot.pending === 0) { slot.px0 = x0; slot.py0 = y0; slot.px1 = x1; slot.py1 = y1; }
    else {
      if (x0 < slot.px0) slot.px0 = x0;
      if (y0 < slot.py0) slot.py0 = y0;
      if (x1 > slot.px1) slot.px1 = x1;
      if (y1 > slot.py1) slot.py1 = y1;
    }
    slot.pending++;
    this.stats.stamps++;
    this.stats.patchStamps = (this.stats.patchStamps | 0) + 1;
    return true;
  },

  /** Naprawa slotu rodu wprost (amount ≥ 1 = pełna: slot czyszczony i zwalniany). */
  heal(key, amount = 1) {
    const s = key > 0 ? this._byKey.get(key) : undefined;
    if (s !== undefined) s.heal += Math.max(0, Number(amount) || 0);
  },

  // ── Stemple wprost (18-B, 17) ─────────────────────────────────────────────

  /**
   * Stempel w punkcie świata bez krateru (sam obraz): rodzina i wariant z tabeli STAMP. uv z
   * HullBodies.spriteUvAt (węzeł najbliżej punktu). Przestrzelina nigdy przezroczysta.
   */
  stampAt(entity, x, y, family = 'generic', variant = 'impact', dirX = 0, dirY = 0, power = 1) {
    const hull = entity?.beamHull;
    if (!hull || !(hull.dmgKey > 0) || !this.enabled || this._offView(x, y)) return false;
    const slot = this.acquire(hull.dmgKey, hull.srcWidth * hull.scale, hull.srcHeight * hull.scale);
    if (!slot) return false;
    const uv = HullBodies.spriteUvAt(entity, x, y);
    const e = stampEntry(family, variant);
    setStampEntry(e);
    _p[P_U] = uv.u; _p[P_V] = uv.v; _p[P_R] = e[S_R] * (e[S_POW] ? power : 1); _p[P_CUT] = 0;
    _p[P_DX] = dirX; _p[P_DY] = dirY; _p[P_HOLE] = 0;
    return this._enqueueStamp(slot, hull);
  },

  /** Znaki rzazu wzdłuż odcinka (świat gry) — przebicie z 18-B (pas żaru; dziurę robi geometria). */
  stampKerf(entity, x0, y0, x1, y1, family = 'hexlance') {
    const hull = entity?.beamHull;
    if (!hull || !(hull.dmgKey > 0) || !this.enabled || this._offView(x0, y0)) return 0;
    const slot = this.acquire(hull.dmgKey, hull.srcWidth * hull.scale, hull.srcHeight * hull.scale);
    if (!slot) return 0;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const uv = HullBodies.spriteUvAt(entity, x0, y0);
    const u0 = uv.u, v0 = uv.v;
    const e = stampEntry(family, 'kerf');
    const n = Math.max(1, Math.min(DMG_KERF_MAX, Math.ceil(len / DMG_KERF_STEP)));
    let made = 0;
    for (let k = 0; k < n; k++) {
      const f = n > 1 ? k / (n - 1) : 0;
      _vec[0] = dx * f;
      _vec[1] = dy * f;
      uvDelta(hull);
      setStampEntry(e);
      _p[P_U] = u0 + _uv.du; _p[P_V] = v0 + _uv.dv; _p[P_R] = e[S_R]; _p[P_CUT] = 0;
      _p[P_DX] = dx; _p[P_DY] = dy; _p[P_HOLE] = 0;
      if (this._enqueueStamp(slot, hull)) made++;
    }
    return made;
  },

  // ── Kolejka ───────────────────────────────────────────────────────────────

  /**
   * Stempel z parametrów w `_p` (uv skóry, promień [j. świata], parametry receptury, kierunek w
   * świecie gry — 0, 0 = koło) do kolejki klatki. Zwraca false, gdy kolejka lub limit slotu pełne
   * albo stempel całkiem poza obrazem kadłuba.
   */
  _enqueueStamp(slot, hull) {
    if (this._qCount >= DMG_STAMP_CAP || slot.pending >= DMG_SLOT_STAMP_CAP) {
      this.stats.droppedStamps++;
      return false;
    }
    const u = _p[P_U], v = _p[P_V];
    const rH = Math.max(1e-5, _p[P_R] / slot.worldH);
    // Kierunek w układzie uv z proporcją (u × W/H, v w dół obrazu): lokalny kadłuba (lx, −ly).
    let cx = 1, cy = 0, el = 1;
    const dirX = _p[P_DX], dirY = _p[P_DY];
    const dl = Math.sqrt(dirX * dirX + dirY * dirY);
    if (dl > 1e-9 && hull && hull.entity && _p[P_EL] > 1) {
      HullBodies.entityPose(hull, _pose);
      const lx = _pose.c * dirX - _pose.s * dirY;
      const ly = -_pose.s * dirX - _pose.c * dirY;
      const l2 = Math.sqrt(lx * lx + ly * ly);
      if (l2 > 1e-9) { cx = lx / l2; cy = -ly / l2; el = _p[P_EL]; }
    }
    // Prostokąt tekseli zasięgu stempla (r < 1,6 · (1 + falowanie) · wydłużenie).
    const ext = DMG_STAMP_REACH * el * rH;
    const x0 = Math.max(0, Math.floor((u - ext / slot.aspect) * slot.w - 0.5));
    const x1 = Math.min(slot.w - 1, Math.ceil((u + ext / slot.aspect) * slot.w - 0.5));
    const y0 = Math.max(0, Math.floor((v - ext) * slot.h - 0.5));
    const y1 = Math.min(slot.h - 1, Math.ceil((v + ext) * slot.h - 0.5));
    if (!(x0 <= x1 && y0 <= y1)) return false;
    const i = this._qCount++;
    const o = i * SF;
    const Q = this._qData;
    Q[o] = u; Q[o + 1] = v; Q[o + 2] = rH; Q[o + 3] = _p[P_CUT];
    Q[o + 4] = _p[P_HEAT]; Q[o + 5] = _p[P_SCORCH]; Q[o + 6] = _p[P_RIM]; Q[o + 7] = _p[P_ION];
    Q[o + 8] = cx; Q[o + 9] = cy; Q[o + 10] = el; Q[o + 11] = fxRandom.next() * 100;
    // Prawdziwa dziura (lej): promień / H świata — koło bez wydłużenia i falowania (dziura w belkach).
    Q[o + 12] = _p[P_HOLE] > 0 ? _p[P_HOLE] / slot.worldH : 0; Q[o + 13] = 0; Q[o + 14] = 0; Q[o + 15] = 0;
    this._qSlot[i] = slot.index;
    if (slot.pending === 0) { slot.px0 = x0; slot.py0 = y0; slot.px1 = x1; slot.py1 = y1; }
    else {
      if (x0 < slot.px0) slot.px0 = x0;
      if (y0 < slot.py0) slot.py0 = y0;
      if (x1 > slot.px1) slot.px1 = x1;
      if (y1 > slot.py1) slot.py1 = y1;
    }
    slot.pending++;
    this.stats.stamps++;
    return true;
  },

  // ── Zadania i dispatch ────────────────────────────────────────────────────

  _ensureGpu() {
    if (this._gpu) return this._gpu;
    const pool = hullDamagePool();
    const jobs = attributeArray(DMG_JOB_CAP * DMG_JOB_VEC4, 'uvec4').setName('hullDamageJobs').toReadOnly();
    const stamps = attributeArray(DMG_STAMP_CAP * DMG_STAMP_VEC4, 'vec4').setName('hullDamageStamps').toReadOnly();
    const U = { total: uniform(0, 'uint'), jobCount: uniform(0, 'uint') };
    const jobsU32 = jobs.value.array;
    this._gpu = {
      pool, jobs, stamps, U,
      jobsU32,
      jobsF32: new Float32Array(jobsU32.buffer, jobsU32.byteOffset, jobsU32.length),
      stampsF32: stamps.value.array,
      jobRange: permanentUpdateRange(jobs.value),
      stampRange: permanentUpdateRange(stamps.value),
      kernel: createHullDamageKernel(pool.rw, jobs, stamps, U, DMG_JOB_CAP),
      cpuCopyDropped: false
    };
    return this._gpu;
  },

  /**
   * Buduje zadania klatki w buforach CPU (bez GPU). Zwraca liczbę wątków (0 = nic do zrobienia).
   * now — zegar efektów [s].
   */
  buildJobs(now) {
    this._time = now;
    const g = this._ensureGpu();
    const S = this.slots;
    const J = g.jobsU32;
    const JF = g.jobsF32;
    let jobs = 0;
    let threads = 0;
    let stampBase = 0;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (!s.key) continue;
      const visible = s.seen >= this.frame;
      const fullHeal = s.heal >= 1 && s.pending === 0;
      if (!(s.clear || s.pending > 0 || s.heal > 0 || (s.hot && visible))) continue;
      let flags = 0;
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      let coolDt = 0;
      let heal = 0;
      if (s.clear || fullHeal) {
        // Czyszczenie brudnego prostokąta (przejęty slot albo pełna naprawa): wszystko na zero.
        flags |= DMG_FLAG_CLEAR;
        x0 = s.dx0; y0 = s.dy0; x1 = s.dx1; y1 = s.dy1;
        s.dx0 = 1; s.dy0 = 1; s.dx1 = 0; s.dy1 = 0;
        s.clear = false;
        s.hot = false;
        s.hx0 = 1; s.hy0 = 1; s.hx1 = 0; s.hy1 = 0;
      } else {
        if (s.hot) {
          coolDt = Math.max(0, now - s.coolTime);
          x0 = s.hx0; y0 = s.hy0; x1 = s.hx1; y1 = s.hy1;
          if (now >= s.hotUntil && s.pending === 0) {
            // Ostygło: ostatnie zadanie zeruje resztki żaru i jonów, slot przestaje być gorący.
            flags |= DMG_FLAG_ZERO_HEAT;
            s.hot = false;
            s.hx0 = 1; s.hy0 = 1; s.hx1 = 0; s.hy1 = 0;
          }
        }
        if (s.heal > 0 && s.dx0 <= s.dx1) {
          heal = Math.min(1, s.heal);
          if (x0 > x1) { x0 = s.dx0; y0 = s.dy0; x1 = s.dx1; y1 = s.dy1; }
          else {
            if (s.dx0 < x0) x0 = s.dx0;
            if (s.dy0 < y0) y0 = s.dy0;
            if (s.dx1 > x1) x1 = s.dx1;
            if (s.dy1 > y1) y1 = s.dy1;
          }
          this.stats.heals++;
        }
      }
      s.coolTime = now;
      s.heal = 0;
      if (s.pending > 0) {
        if (x0 > x1) { x0 = s.px0; y0 = s.py0; x1 = s.px1; y1 = s.py1; }
        else {
          if (s.px0 < x0) x0 = s.px0;
          if (s.py0 < y0) y0 = s.py0;
          if (s.px1 > x1) x1 = s.px1;
          if (s.py1 > y1) y1 = s.py1;
        }
        if (!s.hot) { s.hx0 = s.px0; s.hy0 = s.py0; s.hx1 = s.px1; s.hy1 = s.py1; }
        else {
          if (s.px0 < s.hx0) s.hx0 = s.px0;
          if (s.py0 < s.hy0) s.hy0 = s.py0;
          if (s.px1 > s.hx1) s.hx1 = s.px1;
          if (s.py1 > s.hy1) s.hy1 = s.py1;
        }
        if (s.dx0 > s.dx1) { s.dx0 = s.px0; s.dy0 = s.py0; s.dx1 = s.px1; s.dy1 = s.py1; }
        else {
          if (s.px0 < s.dx0) s.dx0 = s.px0;
          if (s.py0 < s.dy0) s.dy0 = s.py0;
          if (s.px1 > s.dx1) s.dx1 = s.px1;
          if (s.py1 > s.dy1) s.dy1 = s.py1;
        }
        s.hot = true;
        s.hotUntil = now + DMG_HOT_SEC;
      }
      if (fullHeal) s.release = true;
      if (x0 > x1 || y0 > y1) { s.pending = 0; continue; }
      const rw = x1 - x0 + 1;
      const rh = y1 - y0 + 1;
      const o = jobs * DMG_JOB_VEC4 * 4;
      J[o] = threads; J[o + 1] = s.base; J[o + 2] = s.w; J[o + 3] = s.h;
      J[o + 4] = x0; J[o + 5] = y0; J[o + 6] = rw; J[o + 7] = flags;
      J[o + 8] = stampBase; J[o + 9] = s.pending; JF[o + 10] = s.aspect; JF[o + 11] = coolDt;
      JF[o + 12] = heal; J[o + 13] = 0; J[o + 14] = 0; J[o + 15] = 0;
      s.cursor = stampBase;
      stampBase += s.pending;
      threads += rw * rh;
      jobs++;
    }
    // Stemple w kolejności zadań (sortowanie przez zliczanie: kursor slotu).
    const Q = this._qData;
    const GS = g.stampsF32;
    for (let i = 0; i < this._qCount; i++) {
      const s = S[this._qSlot[i]];
      if (s.pending <= 0) continue;
      const d = s.cursor++ * SF;
      const o = i * SF;
      for (let k = 0; k < SF; k++) GS[d + k] = Q[o + k];
    }
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      s.pending = 0;
      if (s.release) this._free(s);
    }
    this._qCount = 0;
    g.jobRange.count = Math.max(1, jobs) * DMG_JOB_VEC4 * 4;
    g.stampRange.count = Math.max(1, stampBase) * DMG_STAMP_VEC4 * 4;
    g.U.total.value = threads;
    g.U.jobCount.value = jobs;
    this.stats.jobs = jobs;
    this.stats.threads = threads;
    return threads;
  },

  _anyWork() {
    const S = this.slots;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (!s.key) continue;
      if (s.clear || s.pending > 0 || s.heal > 0 || (s.hot && s.seen >= this.frame)) return true;
    }
    return false;
  },

  /**
   * Krok klatki efektów: zadania + jeden dispatch (bez pracy — nic, także bez wysyłek). Czas CPU
   * kroku liczy klatka efektów (Core3D.fxStats.cpuMs) — tu bez performance.now (pakowanie liczb).
   */
  update(ctx) {
    const now = Number(ctx?.time) || 0;
    const work = this.slots.length > 0 && (this._qCount > 0 || this._anyWork());
    const threads = work ? this.buildJobs(now) : 0;
    this._time = now;
    if (!work) { this.stats.jobs = 0; this.stats.threads = 0; }
    this.stats.dispatch = 0;
    if (threads > 0 && ctx?.renderer) {
      const g = this._gpu;
      g.jobs.value.needsUpdate = true;
      g.stamps.value.needsUpdate = true;
      // Rozmiar dispatchu zaokrąglony w górę do potęgi dwójki: three przelicza (i alokuje) rozmiar
      // siatki grup przy każdej zmianie liczby — nadmiarowe wątki wychodzą na pierwszym warunku.
      let n = 256;
      while (n < threads) n *= 2;
      this.stats.dispatch = n;
      ctx.renderer.compute(g.kernel, n);
      this._dropCpuCopy(ctx.renderer);
    }
    this.frame++;
  },

  // Pula powstaje na GPU z kopii CPU (24 MB) przy pierwszym dispatchu i potem jest wyłącznie
  // w GPU (kernel pisze, materiały czytają) — kopię CPU oddajemy, gdy bufor GPU już istnieje.
  _dropCpuCopy(renderer) {
    const g = this._gpu;
    if (!g || g.cpuCopyDropped || this.keepCpuCopy) return;
    const attr = g.pool.attribute;
    let buffer = null;
    try { buffer = renderer?.backend?.get?.(attr)?.buffer || null; } catch { buffer = null; }
    if (!buffer) return;
    attr.array = new Uint32Array(2);
    g.cpuCopyDropped = true;
    this.stats.cpuCopyBytes = 0;
  },

  /** Rozgrzewka (ekran ładowania): pipeline kernela i bufory GPU (pusta lista zadań). */
  warm(ctx) {
    const g = this._ensureGpu();
    if (!ctx?.renderer) return;
    g.U.total.value = 0;
    g.U.jobCount.value = 0;
    ctx.renderer.compute(g.kernel, 1);
    this._dropCpuCopy(ctx.renderer);
  },

  /** Rejestracja kroku w Core3D.fx (idempotentna). */
  ensureStep() {
    if (this._step) return this._step;
    this._ensureSlots();
    const self = this;
    this._step = {
      name: 'hullDamageMap',
      update(ctx) { self.update(ctx); },
      warm(ctx) { self.warm(ctx); }
    };
    Core3D.addFxStep(this._step);
    return this._step;
  },

  /** Wyczyść wszystko (nowa gra, testy): sloty wolne (brudne prostokąty zostają do czyszczenia), kolejki puste. */
  reset() {
    for (const s of this.slots) this._free(s);
    this._byKey.clear();
    this._qCount = 0;
    this._hookFrame.fill(-1);
    this._tearFrame.fill(-1);
    this._src.active = false;
    const st = this.stats;
    st.stamps = 0; st.droppedStamps = 0; st.offView = 0; st.noSlot = 0; st.evictions = 0; st.downgrades = 0; st.upgrades = 0;
    st.jobs = 0; st.threads = 0; st.dispatch = 0; st.heals = 0; st.recipeStamps = 0; st.recipeDup = 0;
    st.tearStamps = 0; st.tearMerged = 0; st.tearCapped = 0;
  }
};

/**
 * Wektor w świecie gry (dx, dy; y w dół) → przesunięcie uv skóry kadłuba (du, dv): obrót do układu
 * ciała (jak toLocal w hullBodies.js) i skala sprite'a (u wzdłuż szerokości obrazu, v w dół obrazu).
 */
export function worldVecToUv(hull, dx, dy, out = _uv) {
  _vec[0] = dx;
  _vec[1] = dy;
  uvDelta(hull);
  out.du = _uv.du;
  out.dv = _uv.dv;
  return out;
}

// Wersja wewnętrzna: wektor z _vec, wynik w _uv (bez argumentów double — zero alokacji).
function uvDelta(hull) {
  HullBodies.entityPose(hull, _pose);
  const dx = _vec[0], dy = _vec[1];
  const lx = _pose.c * dx - _pose.s * dy;
  const ly = -_pose.s * dx - _pose.c * dy;
  _uv.du = lx / Math.max(1e-6, hull.srcWidth * hull.scale);
  _uv.dv = -ly / Math.max(1e-6, hull.srcHeight * hull.scale);
}

if (typeof window !== 'undefined') window.HullDamageMap = HullDamageMap;
