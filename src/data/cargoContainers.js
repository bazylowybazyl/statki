/**
 * KONTENERY ŁADUNKU — dane widoku (plan ruchu v2 § 3.4, Z5).
 *
 * Kontener jest WIDOKIEM liczby, nigdy źródłem prawdy (docs/SPEC-ekonomia-
 * i-logistyka.md § 10): ekonomia liczy tony w rekordach kursów, a tu tylko
 * zamieniamy „ile i czego” na kontenery stojące w slotach ładowni. Nic z tego
 * modułu nie wraca do rachunku.
 *
 * Trzy rodziny (reguła z pola `form` w resources.js):
 *   zbiornik (tank)     — gazy i ciecze (hel-3, metan, wodór, chłodziwo…),
 *   zsyp (hopper)       — stałe masowe tańsze niż 40 CR/t (ruda, lód, złom, stal),
 *   standard            — sztuki albo towar ≥ 40 CR/t (chipy, stop tytanu, podzespoły);
 *   + wariant hazmat    — pręty paliwowe i amunicja (kategoria ORDNANCE).
 *
 * Liczba kontenerów = ceil(sloty × masa / ładownia) (plan § 3.4). Sloty to
 * miejsca namalowane na sprite'ach „pusty pokład” (Z11, assets/ships/*_empty.png)
 * — w pikselach PNG, w formacie stref mostka (src/game/shipBridge.js:
 * x, y = środek względem środka płótna, +x = dziób, +y = w dół obrazka).
 * Siatki zmierzone z bursztynowych obrysów slotów (2026-09-26).
 *
 * Moduł bez importów z gry — tylko resources.js (czyste dane).
 */

import { RESOURCES, RESOURCE_KEYS, CATEGORY } from './resources.js';

// ============================================================
// Rodziny
// ============================================================

export const CONTAINER_FAMILY = Object.freeze({
  STANDARD: 'standard',
  TANK: 'tank',
  HOPPER: 'hopper'
});

/** Kod rodziny w danych instancji (shader cargoContainers3D.js). 3 = płyta maski ładowni. */
export const CONTAINER_FAMILY_CODE = Object.freeze({ standard: 0, tank: 1, hopper: 2, cover: 3 });

/** Próg zsypu: stałe masowe (`unit: 't'`) tańsze niż tyle CR/t jadą luzem. */
export const HOPPER_MAX_VALUE = 40;

/** Materiał w zsypie — wzór ładunku w shaderze (kod = indeks). */
export const HOPPER_MATERIAL = Object.freeze({ ORE: 0, ICE: 1, SCRAP: 2, BARS: 3, COILS: 4, GRANULATE: 5, CRYSTAL: 6 });

const HOPPER_MATERIAL_BY_RESOURCE = Object.freeze({
  ice: HOPPER_MATERIAL.ICE,
  scrap: HOPPER_MATERIAL.SCRAP,
  steel: HOPPER_MATERIAL.BARS,
  copper_wire: HOPPER_MATERIAL.COILS,
  polymer: HOPPER_MATERIAL.GRANULATE,
  raw_crystal: HOPPER_MATERIAL.CRYSTAL
});

/** Rodzina kontenera dla surowca (reguła planu § 3.4). */
export function containerFamilyOf(resourceId) {
  const def = RESOURCES[String(resourceId || '')];
  if (!def) return CONTAINER_FAMILY.STANDARD;
  if (def.form === 'gas' || def.form === 'liquid') return CONTAINER_FAMILY.TANK;
  if (def.unit === 't' && def.value < HOPPER_MAX_VALUE) return CONTAINER_FAMILY.HOPPER;
  return CONTAINER_FAMILY.STANDARD;
}

/** Hazmat: pręty paliwowe i amunicja — żółte pasy i romb na standardzie. */
export function isHazmatCargo(resourceId) {
  const def = RESOURCES[String(resourceId || '')];
  if (!def) return false;
  return resourceId === 'fuel_rods' || def.category === CATEGORY.ORDNANCE;
}

// ============================================================
// Wygląd (sRGB hex; shader przelicza na liniowe)
// ============================================================

// Farby kontenerów standardowych — jak domalowane na starych sprite'ach
// (niebieski, szary, czerwony, biały, pomarańczowy) plus kilka rzadszych.
// Wagi: niebieski i szary najczęstsze.
export const STANDARD_PAINTS = Object.freeze([
  '#2f5f8f', '#2f5f8f', '#7d8288', '#7d8288', '#8e3a2e', '#d6d6cf',
  '#c9782c', '#35664a', '#b89a4a', '#4f6d7a'
]);
export const HAZMAT_PAINT = '#d4a91c';
// Zbiorniki: biel i stal, rama ciemna albo w kolorze firmy.
export const TANK_SHELLS = Object.freeze(['#d9dde1', '#c8cdd2', '#a9b0b6']);
export const TANK_FRAMES = Object.freeze(['#2e3338', '#2f5f8f', '#8e3a2e', '#3c4a3f']);
// Zsypy: przemysłowe burty (rdza, stal, brąz).
export const HOPPER_BODIES = Object.freeze(['#5b5048', '#4c5560', '#6a4a32', '#55504a']);
// Płyta maski ładowni (tryb starego sprite'a z domalowanym ładunkiem).
export const COVER_PAINT = '#2a2d30';

/** Deterministyczny hash 32-bit (ziarno kursu, slot) → [0, 1). */
export function cargoHash01(a, b = 0, c = 0) {
  let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15) ^ ((c | 0) * 0x27d4eb2d), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Wygląd kontenera: rodzina, hazmat, farba korpusu, akcent (pas zbiornika,
 * rama, materiał zsypu). `seed` = ziarno kursu, `unit` = numer kontenera
 * (slot) — ten sam kontener wygląda tak samo w obu portach kursu.
 */
export function containerLook(resourceId, seed = 0, unit = 0, out = {}) {
  const id = String(resourceId || '');
  const def = RESOURCES[id] || null;
  const family = containerFamilyOf(id);
  const hazmat = isHazmatCargo(id);
  const h1 = cargoHash01(seed, unit, 11);
  const h2 = cargoHash01(seed, unit, 29);
  out.resourceId = id;
  out.family = family;
  out.code = CONTAINER_FAMILY_CODE[family];
  out.hazmat = hazmat;
  out.material = family === CONTAINER_FAMILY.HOPPER ? (HOPPER_MATERIAL_BY_RESOURCE[id] ?? HOPPER_MATERIAL.ORE) : 0;
  if (family === CONTAINER_FAMILY.TANK) {
    out.paint = TANK_SHELLS[Math.floor(h1 * TANK_SHELLS.length)];
    out.frame = TANK_FRAMES[Math.floor(h2 * TANK_FRAMES.length)];
    out.accent = def?.color || '#94a3b8';
  } else if (family === CONTAINER_FAMILY.HOPPER) {
    out.paint = HOPPER_BODIES[Math.floor(h1 * HOPPER_BODIES.length)];
    out.frame = out.paint;
    out.accent = def?.color || '#8a8f96';
  } else {
    out.paint = hazmat ? HAZMAT_PAINT : STANDARD_PAINTS[Math.floor(h1 * STANDARD_PAINTS.length)];
    out.frame = out.paint;
    out.accent = hazmat ? (def?.color || '#f07820') : out.paint;
  }
  return out;
}

// ============================================================
// Indeks surowców (tablice typowane w transferze i renderze)
// ============================================================

/** Surowiec → indeks (RESOURCE_KEYS); −1 = brak. */
export const CARGO_RESOURCE_INDEX = Object.freeze(Object.fromEntries(RESOURCE_KEYS.map((k, i) => [k, i])));
export function cargoResourceIndex(resourceId) {
  const i = CARGO_RESOURCE_INDEX[String(resourceId || '')];
  return i === undefined ? -1 : i;
}
export function cargoResourceKey(index) {
  return RESOURCE_KEYS[index] || null;
}

// ============================================================
// Układy ładowni (PNG „pusty pokład”)
// ============================================================
//
// Pola układu:
//   hullId        — id kadłuba ruchu (transportCompanies.hullForVanClass)
//   vanClass      — klasa ładowni (cargoFleet VAN_CLASSES: van/hauler/bulk/heavy/mega)
//   png           — wymiary płótna sprite'a (obie wersje mają to samo płótno)
//   renderLength  — dłuższy bok płótna w świecie (getHullRenderSize: długość
//                   profilu × 0,6; wagon: stały prostokąt składu 2760 × 1554)
//   hull          — obwiednia alfy sylwetki [px PNG] (place portowe stoją za burtą)
//   sprite        — empty: pusty pokład (kontenery 3D), painted: stary sprite
//                   z domalowanym ładunkiem (tryb maski ładowni)
//   grid          — zatoki: lewe krawędzie kolumn (x) i górne krawędzie rzędów
//                   (y) bursztynowych obrysów [px PNG, od lewego górnego rogu],
//                   szerokość w i wysokość h zatoki; split = sloty na zatokę
//                   (przegroda wzdłuż statku dzieli zatokę na górny i dolny slot)
//   unit          — kontener w slocie: inset (ułamek slotu), podsiatka widoku
//                   nx × ny (moduł ciężkich statków = kilka kontenerów w ramie),
//                   tiers (piętra), heightRatio (wysokość piętra / bok kontenera)
//   drones        — ile dronów najwyżej obsługuje statek przy stanowisku
//
// Kontener leży wzdłuż osi statku (x obrazka = dziób), bez obrotu.

const layout = (o) => Object.freeze({
  ...o,
  png: Object.freeze(o.png),
  sprite: Object.freeze(o.sprite),
  grid: Object.freeze({ ...o.grid, x: Object.freeze(o.grid.x), y: Object.freeze(o.grid.y) }),
  unit: Object.freeze(o.unit),
  hull: Object.freeze(o.hull)
});

export const CARGO_HOLD_LAYOUTS = Object.freeze({
  // Prom: górny i dolny rząd po 4, środek to kil bez slotów.
  inter_station_shuttle: layout({
    hullId: 'inter_station_shuttle', vanClass: 'van', label: 'Prom międzystacyjny',
    png: { w: 1774, h: 887 }, renderLength: 120, hull: { x0: 416, y0: 222, x1: 1354, y1: 652 },
    sprite: { empty: 'assets/ships/inter_station_shuttle_empty.png', painted: 'assets/inter_station_shuttle.png' },
    grid: { x: [707, 766, 825, 884], w: 49, y: [313, 503], h: 64, split: 1 },
    unit: { inset: 0.88, nx: 1, ny: 1, tiers: 1, heightRatio: 0.8 },
    drones: 2
  }),
  // Kontenerowiec: 3 × 6 w miejscach domalowanych kontenerów.
  container_ship: layout({
    hullId: 'container_ship', vanClass: 'hauler', label: 'Kontenerowiec',
    png: { w: 1774, h: 887 }, renderLength: 312, hull: { x0: 45, y0: 179, x1: 1742, y1: 681 },
    sprite: { empty: 'assets/ships/container_ship_empty.png', painted: 'assets/container_ship.png' },
    grid: { x: [488, 605, 723, 842, 959, 1077], w: 98, y: [303, 390, 497], h: 61, split: 1 },
    unit: { inset: 0.9, nx: 1, ny: 1, tiers: 1, heightRatio: 0.85 },
    drones: 4
  }),
  // Frachtowiec dalekiego zasięgu: 2 × 7 zatok, każda na 2 sloty.
  long_haul_freighter: layout({
    hullId: 'long_haul_freighter', vanClass: 'bulk', label: 'Frachtowiec dalekiego zasięgu',
    png: { w: 1774, h: 887 }, renderLength: 540, hull: { x0: 53, y0: 193, x1: 1723, y1: 660 },
    sprite: { empty: 'assets/ships/long_haul_freighter_empty.png', painted: 'assets/long_haul_freighter.png' },
    grid: { x: [486, 560, 632, 715, 788, 861, 934], w: 54, y: [337, 448], h: 78, split: 2 },
    unit: { inset: 0.9, nx: 1, ny: 1, tiers: 1, heightRatio: 0.85 },
    drones: 5
  }),
  // Ciężki frachtowiec: 3 × 8 zatok, każda na 2 sloty (48, nie „heavy 14”
  // z zastępczego sprite'a). Slot = moduł 2 × 3 kontenerów na 2 piętra.
  heavy_freighter: layout({
    hullId: 'heavy_freighter', vanClass: 'heavy', label: 'Ciężki frachtowiec',
    png: { w: 1774, h: 887 }, renderLength: 1800, hull: { x0: 42, y0: 153, x1: 1748, y1: 732 },
    sprite: { empty: 'assets/ships/heavy_freighter_empty.png', painted: 'assets/ships/heavy_freighter.png' },
    grid: { x: [436, 520, 604, 687, 770, 855, 939, 1023], w: 58, y: [284, 413, 541], h: 84, split: 2 },
    unit: { inset: 0.92, nx: 2, ny: 3, tiers: 2, heightRatio: 0.85 },
    drones: 8
  }),
  // Megafrachtowiec: 2 × 10 zatok, środkowy rząd to kil. Slot = moduł 2 × 6 × 2.
  megafreighter: layout({
    hullId: 'megafreighter', vanClass: 'mega', label: 'Megafrachtowiec',
    png: { w: 1774, h: 887 }, renderLength: 2760, hull: { x0: 18, y0: 136, x1: 1758, y1: 710 },
    sprite: { empty: 'assets/ships/megafreighter_empty.png', painted: 'assets/megafreighter.png' },
    grid: { x: [445, 517, 590, 661, 733, 805, 877, 948, 1018, 1089], w: 52, y: [274, 481], h: 91, split: 1 },
    unit: { inset: 0.92, nx: 2, ny: 6, tiers: 2, heightRatio: 0.85 },
    drones: 5
  }),
  // Wagon megafrachtowca (skład megafreighterTrain.js): 2 × 8 zatok po 2 sloty.
  megafreighter_wagon: layout({
    hullId: 'megafreighter_wagon', vanClass: 'mega', label: 'Wagon megafrachtowca',
    png: { w: 1672, h: 941 }, renderLength: 2760, hull: { x0: 40, y0: 176, x1: 1626, y1: 761 },
    sprite: { empty: 'assets/ships/megafreighterwagon_empty.png', painted: 'assets/megafreighterwagon.png' },
    grid: { x: [377, 494, 611, 728, 845, 963, 1080, 1197], w: 85, y: [298, 504], h: 142, split: 2 },
    unit: { inset: 0.92, nx: 3, ny: 5, tiers: 2, heightRatio: 0.85 },
    drones: 6
  })
});

export const CARGO_HOLD_LAYOUT_ORDER = Object.freeze(Object.keys(CARGO_HOLD_LAYOUTS));

/** Układ ładowni dla kadłuba (id ruchu v2 albo id układu) albo null. */
export function cargoHoldLayout(hullId) {
  return CARGO_HOLD_LAYOUTS[String(hullId || '')] || null;
}

/** Jednostki świata na piksel PNG (dłuższy bok płótna → renderLength). Układ albo jego id. */
export function cargoLayoutScale(lay) {
  const L = typeof lay === 'string' ? cargoHoldLayout(lay) : lay;
  return L ? L.renderLength / Math.max(L.png.w, L.png.h) : 1;
}

const _slotCache = new Map();

/**
 * Sloty układu w formacie stref mostka (px PNG, środek względem środka płótna):
 * [{ index, x, y, w, h, rot: 0, bay, col, row, part }] — zamrożone, z pamięci
 * podręcznej. Kolejność: rząd po rzędzie, kolumny od rufy do dziobu, w zatoce
 * najpierw górny slot.
 */
export function cargoHoldSlots(lay) {
  const L = typeof lay === 'string' ? cargoHoldLayout(lay) : lay;
  if (!L) return Object.freeze([]);
  let slots = _slotCache.get(L);
  if (slots) return slots;
  const g = L.grid;
  const cx = L.png.w / 2;
  const cy = L.png.h / 2;
  const split = Math.max(1, g.split | 0);
  const partH = g.h / split;
  const list = [];
  let bay = 0;
  for (let r = 0; r < g.y.length; r++) {
    for (let c = 0; c < g.x.length; c++) {
      for (let p = 0; p < split; p++) {
        list.push(Object.freeze({
          index: list.length,
          x: g.x[c] + g.w / 2 - cx,
          y: g.y[r] + partH * (p + 0.5) - cy,
          w: g.w,
          h: partH,
          rot: 0,
          bay, col: c, row: r, part: p
        }));
      }
      bay++;
    }
  }
  slots = Object.freeze(list);
  _slotCache.set(L, slots);
  return slots;
}

/**
 * Wymiary kontenera w slocie [j. świata]: L wzdłuż statku, W w poprzek, H wysokość
 * (piętra × wysokość kontenera podsiatki). `scale` = j./px (domyślnie z układu).
 */
export function cargoUnitSize(lay, scale = cargoLayoutScale(lay), out = {}) {
  const L = typeof lay === 'string' ? cargoHoldLayout(lay) : lay;
  if (!L) { out.L = out.W = out.H = 0; out.subL = out.subW = out.tierH = 0; return out; }
  const u = L.unit;
  const split = Math.max(1, L.grid.split | 0);
  out.L = L.grid.w * scale * u.inset;
  out.W = (L.grid.h / split) * scale * u.inset;
  out.subL = out.L / Math.max(1, u.nx);
  out.subW = out.W / Math.max(1, u.ny);
  out.tierH = u.heightRatio * Math.min(out.subL, out.subW);
  out.H = out.tierH * Math.max(1, u.tiers);
  return out;
}

// ============================================================
// Liczba i przydział kontenerów
// ============================================================

/**
 * Kontenery na pokładzie: ceil(sloty × masa / ładownia), 0 bez ładunku,
 * co najmniej 1 przy dowolnym ładunku, najwyżej wszystkie sloty.
 */
export function cargoContainerCount(slots, mass, capacity) {
  const n = Math.max(0, slots | 0);
  const m = Number(mass);
  const cap = Number(capacity);
  if (!(m > 1e-9) || !n) return 0;
  if (!(cap > 0)) return n;
  return Math.max(1, Math.min(n, Math.ceil(n * m / cap - 1e-9)));
}

/** Ładunek w postaci listy [{ resourceId, mass }] (przyjmuje też worek { id: masa }). */
export function normalizeCargo(cargo) {
  const out = [];
  if (Array.isArray(cargo)) {
    for (const e of cargo) {
      const id = String(e?.resourceId ?? e?.id ?? '');
      const mass = Number(e?.mass);
      if (id && mass > 0) out.push({ resourceId: id, mass });
    }
  } else if (cargo && typeof cargo === 'object') {
    for (const [id, mass] of Object.entries(cargo)) {
      if (Number(mass) > 0) out.push({ resourceId: id, mass: Number(mass) });
    }
  }
  return out;
}

/**
 * Podział kontenerów między surowce proporcjonalnie do masy (metoda
 * największych reszt). Każdy surowiec z ładunkiem dostaje ≥ 1 kontener, gdy
 * starcza slotów. Wynik: [{ resourceId, count }] w kolejności ładunku.
 */
export function allocateCargoContainers(cargo, slots, capacity) {
  const list = normalizeCargo(cargo);
  let total = 0;
  for (const e of list) total += e.mass;
  const count = cargoContainerCount(slots, total, capacity);
  const out = list.map((e) => ({ resourceId: e.resourceId, count: 0 }));
  if (!count || !list.length) return out;
  const shares = list.map((e) => e.mass / total * count);
  let used = 0;
  for (let i = 0; i < list.length; i++) { out[i].count = Math.floor(shares[i]); used += out[i].count; }
  // Najpierw po jednym dla pominiętych (dopóki starcza), potem największe reszty.
  const order = list.map((_, i) => i).sort((a, b) => (shares[b] - Math.floor(shares[b])) - (shares[a] - Math.floor(shares[a])) || a - b);
  for (const i of order) {
    if (used >= count) break;
    if (out[i].count === 0) { out[i].count = 1; used++; }
  }
  for (const i of order) {
    if (used >= count) break;
    if (shares[i] - out[i].count > 1e-9) { out[i].count++; used++; }
  }
  for (let i = 0; used < count; i = (i + 1) % out.length) { out[i].count++; used++; }
  // Nadmiar (gdy dołożone jedynki przekroczyły liczbę): zdejmij z największych.
  while (used > count) {
    let k = 0;
    for (let i = 1; i < out.length; i++) if (out[i].count > out[k].count) k = i;
    out[k].count--; used--;
  }
  return out;
}

const _orderCache = new Map();

/**
 * Kolejność zapełniania slotów: od środka ładowni na zewnątrz (środek masy
 * zostaje w osi przy częściowym ładunku), w zatoce oba sloty razem.
 * Int16Array indeksów slotów, zamrożona semantycznie (nie modyfikować).
 */
export function cargoFillOrder(lay) {
  const L = typeof lay === 'string' ? cargoHoldLayout(lay) : lay;
  if (!L) return new Int16Array(0);
  let order = _orderCache.get(L);
  if (order) return order;
  const slots = cargoHoldSlots(L);
  let mx = 0;
  let my = 0;
  for (const s of slots) { mx += s.x; my += s.y; }
  mx /= Math.max(1, slots.length);
  my /= Math.max(1, slots.length);
  const idx = slots.map((s) => s.index);
  idx.sort((a, b) => {
    const A = slots[a];
    const B = slots[b];
    const ka = Math.round(Math.abs(A.x - mx) / 4);
    const kb = Math.round(Math.abs(B.x - mx) / 4);
    if (ka !== kb) return ka - kb;
    const ya = Math.round(Math.abs(A.y - my) / 4);
    const yb = Math.round(Math.abs(B.y - my) / 4);
    if (ya !== yb) return ya - yb;
    return A.index - B.index;
  });
  order = Int16Array.from(idx);
  _orderCache.set(L, order);
  return order;
}

/**
 * Obsada pokładu dla ładunku: `out` (Int16Array długości slotów) dostaje indeks
 * surowca w slocie albo −1. Surowce leżą grupami w kolejności zapełniania.
 * Zwraca { slots: out, count }. Ta sama funkcja daje pokład w locie i stan
 * końcowy/początkowy przeładunku (cargoPortOps.js).
 */
export function cargoDeckFill(lay, cargo, capacity, out = null) {
  const L = typeof lay === 'string' ? cargoHoldLayout(lay) : lay;
  const slots = cargoHoldSlots(L);
  const res = out && out.length >= slots.length ? out : new Int16Array(slots.length);
  res.fill(-1);
  if (!L) return { slots: res, count: 0 };
  const order = cargoFillOrder(L);
  const alloc = allocateCargoContainers(cargo, slots.length, capacity);
  let k = 0;
  for (const a of alloc) {
    const ri = cargoResourceIndex(a.resourceId);
    for (let i = 0; i < a.count && k < order.length; i++) res[order[k++]] = ri;
  }
  return { slots: res, count: k };
}
