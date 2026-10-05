/**
 * ŁADOWNIE KADŁUBÓW — dane i geometria (zadanie 26: demo dema/ladownia-webgpu.html).
 *
 * Każdy kadłub dostaje ładownię jak frachtowce z Z11 (pusta przestrzeń ładunkowa
 * w kadłubie), ale zamkniętą wrotami „à la Venator”: prostokąt w osi statku, podzielony
 * WZDŁUŻ osi na dwie połowy, które rozsuwają się na boki i odsłaniają wnętrze z głębią
 * (dno, ściany, lampy) i kontenerami 3D w slotach. Moduł to czyste dane i geometria —
 * bez three, bez DOM, bez stanu gry. Rysowanie: src/3d/cargo/*.tsl.js, przeładunek
 * dronami: src/game/cargoBayOps.js. Opis i plan integracji: docs/webgpu/DEMO-LADOWNIA.md.
 *
 * PRZESTRZEŃ PNG (jak strefy mostków i hardpointy edytora): piksele sprite'a, (0, 0) =
 * środek płótna, +x = dziób, +y = w dół obrazka. Ładownia: środek (x, y), bok w wzdłuż
 * statku, bok h w poprzek — zawsze w osi (wrota dzielą ją wzdłuż osi statku).
 *
 * UKŁAD STATKU 3D (lokalny, jak Core3D): (px · s, −py · s, z), s = j./px (renderLength /
 * dłuższy bok płótna), z w górę (płaszczyzna gry z = 0 = poszycie kadłuba). Układ
 * ładowni (a, b, z): środek ładowni, a wzdłuż statku (dziób), b = +y 3D (w lewo od dziobu
 * patrząc z góry, czyli −y obrazka), dno w z = −głębokość, krawędź otworu w z = 0.
 *
 * KONTENER STANDARDOWY (propozycja do decyzji użytkownika): 16 × 8 × 8 j. — jak slot
 * kontenerowca z Z5 (zatoka 17,2 × 10,7 j. mieści jeden). Jednostka przeładunku (moduł) to
 * nx × ny × nz kontenerów: dron niesie cały moduł (małe okręty 1 × 1 × 1, duże ładownie
 * stosy 2 × 2 × 2, wagon megafrachtowca 4 × 4 × 2) — inaczej duże ładownie ładowałyby się
 * setkami kursów. Pojemność = kontenery × tony na kontener (CARGO_TONNES_OPTIONS).
 *
 * WROTA:
 *   over   — „Venator”: skrzydła podnoszą się, jadą na boki PO poszyciu i osiadają na nim
 *            (pas parkowania obok otworu musi być wolny: sylwetka, bez wieżyczek i mostków);
 *   pocket — kieszeń: skrzydła opadają pod poszycie i chowają się pod nie (bez pasa
 *            parkowania — dla kadłubów, gdzie obok otworu stoją wieżyczki).
 * leaves = skrzydła na stronę (1 = klasyczny Venator; 2–3 = teleskop: węższy pas
 * parkowania, skrzydła jadą z różną prędkością i zostają w stosie).
 */

// ============================================================
// Kontener, moduł, pojemność
// ============================================================

/** Kontener standardowy [j. świata]: L wzdłuż, W w poprzek, H wysokość; gap — szczelina w module. */
export const CARGO_CONTAINER = Object.freeze({ L: 16, W: 8, H: 8, gap: 0.25 });

/** Tony na kontener — warianty do decyzji (tabela pojemności w demie i w DEMO-LADOWNIA.md). */
export const CARGO_TONNES_OPTIONS = Object.freeze([0.5, 1, 2, 5]);
/** Wariant domyślny dema (propozycja: Atlas ≈ 7 skał miedzi, kontenerowiec ≈ klasa „hauler”). */
export const CARGO_TONNES_DEFAULT = 2;
/** Ruda z jednej skały miedzi r ≈ 650 j. (docs/ASTEROIDY-FIZYKA.md: ~140 t; zadanie: 138 t). */
export const CARGO_COPPER_ROCK_ORE_T = 138;

/** Stałe geometrii ładowni [j.]. */
export const CARGO_BAY_PARAMS = Object.freeze({
  moduleGap: 1.0,      // odstęp między modułami (rama chwytaka = moduł + 0,6)
  wallGap: 1.0,        // zapas od ściany
  depthClear: 1.5,     // luz nad stosem pod krawędzią otworu (wrota zamykają się nad ładunkiem)
  leafMin: 0.8,        // grubość skrzydła: 2,6% szerokości otworu, 0,8…4,5 j. (płyta pancerza)
  leafMax: 4.5,
  leafPerWidth: 0.026,
  liftGap: 0.35,       // prześwit skrzydła nad poszyciem przy przejeździe
  restGap: 0.12,       // skrzydło odstawione na szynach
  lampSpacing: 34,     // odstęp lamp na ścianie [j.]
  lampMin: 2,
  lampMax: 18
});

/** Wymiary modułu (nx × ny × nz kontenerów) [j.]. */
export function cargoModuleSize(module, out = {}) {
  const C = CARGO_CONTAINER;
  const nx = Math.max(1, module?.nx | 0);
  const ny = Math.max(1, module?.ny | 0);
  const nz = Math.max(1, module?.nz | 0);
  out.nx = nx; out.ny = ny; out.nz = nz;
  out.L = nx * C.L + (nx - 1) * C.gap;
  out.W = ny * C.W + (ny - 1) * C.gap;
  out.H = nz * C.H;
  out.count = nx * ny * nz;
  return out;
}

// ============================================================
// Kadłuby
// ============================================================

const bay = (o) => Object.freeze({
  door: 'over',
  leaves: 1,
  ...o,
  module: Object.freeze({ nx: 1, ny: 1, nz: 1, ...(o.module || {}) })
});

const hull = (o) => Object.freeze({
  ...o,
  png: Object.freeze(o.png),
  bays: Object.freeze(o.bays)
});

/**
 * Kadłuby z ładowniami. Pola:
 *   label, family ('gracz' | 'terra' | 'piraci' | 'frachtowce'), sprite (ścieżka jak w grze),
 *   png { w, h } — płótno (test pilnuje rozmiaru pliku), renderLength — dłuższy bok w świecie
 *   (getHullRenderSize; wagon: stały moduł składu 2760), profile — HULL_RENDER_PROFILES,
 *   editorKey / bridgeKey — klucze hardpointów i mostków (sprawdzanie stref),
 *   cargoToday — dzisiejsza ładownia [t] (cargoCap kadłuba gracza albo klasa ruchu), todayNote,
 *   bays — ładownie (PNG px) z wrotami i modułem.
 * Strefy: wolne od hardpointów, silników i mostków (zapas jak mostek — bridgeZoneMargin),
 * w sylwetce; przy „over” także pas parkowania skrzydeł (tests/cargoBays.test.mjs).
 */
export const CARGO_BAY_HULLS = Object.freeze({
  // Atlas: środek grzbietu między wieżą specjalną (x −320) a wyrzutnią (x 457); skrzydła
  // parkują na płytach „V” po obu stronach kręgosłupa — jak grzbietowy hangar Venatora.
  atlas: hull({
    label: 'Atlas', family: 'gracz', sprite: 'assets/capital_ship_rect_v1.png', png: { w: 3747, h: 1677 },
    renderLength: 1800, profile: 'atlas', editorKey: 'atlas', bridgeKey: 'atlas',
    cargoToday: 20, todayNote: 'cargoCap gracza',
    bays: [bay({ id: 'grzbiet', label: 'Hangar grzbietowy', x: 66, y: 0, w: 649, h: 272, door: 'over', leaves: 1, module: { nx: 2, ny: 2, nz: 2 } })]
  }),
  // --- Terra Nova ---
  terran_frigate: hull({
    label: 'Custos', family: 'terra', sprite: 'src/assets/ships/terranfrigate.png', png: { w: 2400, h: 1792 },
    renderLength: 192, profile: 'terran_frigate', editorKey: 'frigate', bridgeKey: 'frigate',
    cargoToday: 16, todayNote: 'cargoCap gracza',
    // Grzbiet między blokiem dowodzenia a widłami dziobu (kratka wentylacji).
    bays: [bay({ id: 'grzbiet', label: 'Luk grzbietowy', x: 82, y: 0, w: 680, h: 264, door: 'over', leaves: 2 })]
  }),
  terran_destroyer: hull({
    label: 'Hasta', family: 'terra', sprite: 'src/assets/ships/terrandestroyer.png', png: { w: 768, h: 573 },
    renderLength: 288, profile: 'terran_destroyer', editorKey: 'destroyer', bridgeKey: 'destroyer',
    cargoToday: 30, todayNote: 'cargoCap gracza',
    bays: [bay({ id: 'grzbiet', label: 'Luk grzbietowy', x: -4, y: 0, w: 146, h: 92, door: 'over', leaves: 2 })]
  }),
  terran_battleship: hull({
    label: 'Bellator', family: 'terra', sprite: 'src/assets/ships/terranbattleship.png', png: { w: 1158, h: 714 },
    renderLength: 624, profile: 'terran_battleship', editorKey: 'battleship', bridgeKey: 'battleship',
    cargoToday: 40, todayNote: 'cargoCap gracza',
    // Rynna grzbietowa przed mostkiem — skrzydła chowają się pod pancerz skrzydeł kadłuba.
    bays: [bay({ id: 'rynna', label: 'Rynna grzbietowa', x: 140, y: 0, w: 560, h: 72, door: 'pocket', module: { nz: 2 } })]
  }),
  terran_carrier: hull({
    label: 'Citadella', family: 'terra', sprite: 'src/assets/ships/terrancarrier.png', png: { w: 1672, h: 941 },
    renderLength: 1080, profile: 'terran_carrier', editorKey: 'terran_carrier', bridgeKey: 'terran_carrier',
    cargoToday: 80, todayNote: 'cargoCap gracza',
    // Dwa pokłady windowe lotniskowca (ciemne płyty z okręgami) — luki na obu burtach.
    bays: [
      bay({ id: 'lewa', label: 'Pokład lewy', x: 38, y: -158, w: 592, h: 107, door: 'pocket', module: { nx: 2, ny: 2, nz: 2 } }),
      bay({ id: 'prawa', label: 'Pokład prawy', x: 38, y: 158, w: 592, h: 107, door: 'pocket', module: { nx: 2, ny: 2, nz: 2 } })
    ]
  }),
  terran_supercapital: hull({
    label: 'Colossus', family: 'terra', sprite: 'src/assets/ships/terransupercapital.png', png: { w: 1672, h: 941 },
    renderLength: 1560, profile: 'terran_supercapital', editorKey: 'terran_supercapital', bridgeKey: 'terran_supercapital',
    cargoToday: 120, todayNote: 'cargoCap gracza',
    // Rufowy grzbiet za nadbudówką TERRA NOVA, przed dyszami.
    bays: [bay({ id: 'rufa', label: 'Hangar rufowy', x: -528, y: 0, w: 504, h: 112, door: 'over', leaves: 2, module: { nx: 2, ny: 2, nz: 2 } })]
  }),
  // --- Piraci (Iron Skull): płyta z napisem na grzbiecie to luk ---
  pirate_frigate: hull({
    label: 'Marauder', family: 'piraci', sprite: 'src/assets/ships/piratefrigate.png', png: { w: 1942, h: 809 },
    renderLength: 192, profile: 'pirate_frigate', editorKey: 'pirate_frigate', bridgeKey: 'pirate_frigate',
    cargoToday: 12, todayNote: 'cargoCap gracza',
    bays: [bay({ id: 'luk', label: 'Luk IRON SKULL', x: 128, y: 13, w: 318, h: 102, door: 'pocket' })]
  }),
  pirate_destroyer: hull({
    label: 'Reaver', family: 'piraci', sprite: 'src/assets/ships/piratedestroyer.png', png: { w: 1840, h: 854 },
    renderLength: 360, profile: 'pirate_destroyer', editorKey: 'pirate_destroyer', bridgeKey: 'pirate_destroyer',
    cargoToday: 22, todayNote: 'cargoCap gracza',
    bays: [bay({ id: 'luk', label: 'Luk IRON SKULL', x: 104, y: -9, w: 356, h: 132, door: 'pocket' })]
  }),
  pirate_battleship: hull({
    label: 'Iron Skull', family: 'piraci', sprite: 'src/assets/ships/piratebattleship.png', png: { w: 1727, h: 911 },
    renderLength: 720, profile: 'pirate_battleship', editorKey: 'pirate_battleship', bridgeKey: 'pirate_battleship',
    cargoToday: 32, todayNote: 'cargoCap gracza',
    bays: [bay({ id: 'luk', label: 'Luk IRON SKULL', x: 168, y: -8, w: 318, h: 140, door: 'pocket', module: { nz: 2 } })]
  }),
  // --- Frachtowce (Z11, puste pokłady): pokrywy luków to namalowane zatoki ---
  inter_station_shuttle: hull({
    label: 'Prom międzystacyjny', family: 'frachtowce', sprite: 'assets/ships/inter_station_shuttle_empty.png', png: { w: 1774, h: 887 },
    renderLength: 120, profile: 'inter_station_shuttle', editorKey: null, bridgeKey: null,
    cargoToday: 60, todayNote: 'klasa ruchu van',
    bays: [bay({ id: 'luk', label: 'Luk', x: -67, y: -3, w: 286, h: 286, door: 'pocket' })]
  }),
  container_ship: hull({
    label: 'Kontenerowiec', family: 'frachtowce', sprite: 'assets/ships/container_ship_empty.png', png: { w: 1774, h: 887 },
    renderLength: 312, profile: 'container_ship', editorKey: null, bridgeKey: null,
    cargoToday: 160, todayNote: 'klasa ruchu hauler',
    bays: [bay({ id: 'luki', label: 'Luki 3 × 6', x: -55, y: -13, w: 690, h: 258, door: 'pocket', module: { nz: 2 } })]
  }),
  long_haul_freighter: hull({
    label: 'Frachtowiec dalekiego zasięgu', family: 'frachtowce', sprite: 'assets/ships/long_haul_freighter_empty.png', png: { w: 1774, h: 887 },
    renderLength: 540, profile: 'long_haul_freighter', editorKey: null, bridgeKey: null,
    cargoToday: 380, todayNote: 'klasa ruchu bulk',
    bays: [bay({ id: 'luki', label: 'Luki 2 × 7', x: -150, y: -12, w: 506, h: 192, door: 'pocket', module: { nz: 2 } })]
  }),
  heavy_freighter: hull({
    label: 'Ciężki frachtowiec', family: 'frachtowce', sprite: 'assets/ships/heavy_freighter_empty.png', png: { w: 1774, h: 887 },
    renderLength: 1800, profile: 'heavy_freighter', editorKey: null, bridgeKey: null,
    cargoToday: 900, todayNote: 'klasa ruchu heavy',
    bays: [bay({ id: 'luki', label: 'Luki 3 × 8', x: -128, y: 11, w: 648, h: 344, door: 'pocket', module: { nx: 2, ny: 2, nz: 2 } })]
  }),
  megafreighter_wagon: hull({
    label: 'Wagon megafrachtowca', family: 'frachtowce', sprite: 'assets/ships/megafreighterwagon_empty.png', png: { w: 1672, h: 941 },
    renderLength: 2760, profile: null, editorKey: null, bridgeKey: null,
    cargoToday: 100, todayNote: 'cargoCap składu gracza 600 / 6 wagonów (klasa ruchu mega 2400)',
    bays: [
      bay({ id: 'lewa', label: 'Luki lewe', x: -6, y: -101, w: 908, h: 144, door: 'pocket', module: { nx: 4, ny: 4, nz: 2 } }),
      bay({ id: 'prawa', label: 'Luki prawe', x: -6, y: 105, w: 908, h: 144, door: 'pocket', module: { nx: 4, ny: 4, nz: 2 } })
    ]
  })
});

export const CARGO_BAY_HULL_ORDER = Object.freeze(Object.keys(CARGO_BAY_HULLS));

/** Kadłub z ładowniami albo null. */
export function cargoBayHull(id) {
  return CARGO_BAY_HULLS[String(id || '')] || null;
}

/** Jednostki świata na piksel PNG (dłuższy bok płótna → renderLength). */
export function cargoBayScale(h) {
  const H = typeof h === 'string' ? cargoBayHull(h) : h;
  return H ? H.renderLength / Math.max(H.png.w, H.png.h) : 1;
}

// ============================================================
// Geometria ładowni
// ============================================================

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const smoother = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

const _geoCache = new Map();

/**
 * Geometria ładowni w układzie statku 3D i ładowni (zamrożona, z pamięci podręcznej):
 *   cx, cy — środek ładowni w układzie statku 3D; halfA, halfB — pół boku otworu;
 *   depth — głębokość (dno w z = −depth); leafT — grubość skrzydła; pocketDrop — dół
 *   najgłębszego skrzydła „pocket” pod poszyciem (0 dla „over”);
 *   module — wymiary modułu; cols, rows, pitchA, pitchB, a0, b0 — siatka slotów
 *   (środek slotu (a0 + i·pitchA, b0 + j·pitchB)); slots, containers — ile modułów i kontenerów;
 *   lamps — lampy na ścianę (wzdłuż a), lampSpacing;
 *   leaves — skrzydła wrót (closed: a0, a1, b0, b1; side ±1; index 0 = przy osi);
 *   parking — pas parkowania skrzydeł „over” na stronę (w b, od krawędzi otworu).
 */
export function cargoBayGeometry(h, bayDef) {
  const H = typeof h === 'string' ? cargoBayHull(h) : h;
  const B = typeof bayDef === 'string' ? H?.bays.find((b) => b.id === bayDef) : bayDef;
  if (!H || !B) return null;
  let geo = _geoCache.get(B);
  if (geo) return geo;
  const P = CARGO_BAY_PARAMS;
  const s = cargoBayScale(H);
  const halfA = B.w * s / 2;
  const halfB = B.h * s / 2;
  const mod = cargoModuleSize(B.module, {});
  const pitchA = mod.L + P.moduleGap;
  const pitchB = mod.W + P.moduleGap;
  const cols = Math.max(0, Math.floor((2 * halfA - 2 * P.wallGap + P.moduleGap) / pitchA));
  const rows = Math.max(0, Math.floor((2 * halfB - 2 * P.wallGap + P.moduleGap) / pitchB));
  const leafT = clamp(2 * halfB * P.leafPerWidth, P.leafMin, P.leafMax);
  const n = Math.max(1, B.leaves | 0);
  // Kieszeń: skrzydła opadają pod poszycie do z = −pocketDrop (najgłębsze skrzydło, lustro
  // cargoBayDoorPose) — stos musi stać pod nimi, inaczej skrzydło jedzie przez kontenery.
  const pocketDrop = B.door === 'pocket' ? n * (leafT + P.liftGap) + leafT : 0;
  const depth = mod.H + P.depthClear + pocketDrop;
  const leafW = halfB / n;
  const leaves = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const b0 = side > 0 ? i * leafW : -(i + 1) * leafW;
      leaves.push(Object.freeze({ index: i, side, a0: -halfA, a1: halfA, b0, b1: b0 + leafW, travel: (n - i) * leafW }));
    }
  }
  const lamps = clamp(Math.round(2 * halfA / P.lampSpacing), P.lampMin, P.lampMax);
  geo = Object.freeze({
    hull: H, bay: B, id: B.id, scale: s,
    cx: B.x * s, cy: -B.y * s,
    halfA, halfB, depth, leafT, door: B.door, leafCount: n, leafW, pocketDrop,
    module: Object.freeze(mod),
    cols, rows, pitchA, pitchB,
    a0: -((cols - 1) * pitchA) / 2,
    b0: -((rows - 1) * pitchB) / 2,
    slots: cols * rows,
    containers: cols * rows * mod.count,
    lamps, lampSpacing: 2 * halfA / lamps,
    parking: B.door === 'over' ? leafW : 0,
    leaves: Object.freeze(leaves)
  });
  _geoCache.set(B, geo);
  return geo;
}

/** Geometrie wszystkich ładowni kadłuba. */
export function cargoHullBays(h) {
  const H = typeof h === 'string' ? cargoBayHull(h) : h;
  return H ? H.bays.map((b) => cargoBayGeometry(H, b)) : [];
}

const _slotCache = new Map();

/**
 * Sloty modułów ładowni w kolejności ZAŁADUNKU: kolumnami od rufy do dziobu, w kolumnie
 * od osi ładowni na zewnątrz (na zmianę strony) — ładownia zapełnia się od rufy, a środek
 * masy zostaje w osi. Rozładunek bierze odwrotnie. [{ index, col, row, a, b, order }]
 * w układzie ładowni (środek podstawy modułu na dnie: z = −depth).
 */
export function cargoBaySlots(geo) {
  if (!geo) return Object.freeze([]);
  let list = _slotCache.get(geo);
  if (list) return list;
  const out = [];
  const mid = (geo.rows - 1) / 2;
  const rowOrder = [];
  for (let j = 0; j < geo.rows; j++) rowOrder.push(j);
  rowOrder.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || q - p);
  for (let i = 0; i < geo.cols; i++) {
    for (const j of rowOrder) {
      out.push(Object.freeze({
        index: i * geo.rows + j, col: i, row: j,
        a: geo.a0 + i * geo.pitchA, b: geo.b0 + j * geo.pitchB, order: out.length
      }));
    }
  }
  list = Object.freeze(out);
  _slotCache.set(geo, list);
  return list;
}

/** Kontenery w module slotu przy częściowym wypełnieniu: piętro po piętrze (k z count). */
export function cargoModuleContainer(mod, k, out = {}) {
  const C = CARGO_CONTAINER;
  const perTier = mod.nx * mod.ny;
  const tier = Math.floor(k / perTier);
  const r = k - tier * perTier;
  const ix = r % mod.nx;
  const iy = Math.floor(r / mod.nx);
  out.a = -mod.L / 2 + C.L / 2 + ix * (C.L + C.gap);
  out.b = -mod.W / 2 + C.W / 2 + iy * (C.W + C.gap);
  out.z = tier * C.H;
  out.tier = tier;
  return out;
}

/** Kontenery na masę (widok liczby jak Z5): ceil(pojemność_kontenerów × masa / pojemność_t). */
export function cargoContainersForMass(containers, mass, tonnesPerContainer = CARGO_TONNES_DEFAULT) {
  const m = Number(mass);
  const t = Number(tonnesPerContainer);
  if (!(m > 1e-9) || !(containers > 0)) return 0;
  if (!(t > 0)) return containers;
  return Math.min(containers, Math.max(1, Math.ceil(m / t - 1e-9)));
}

/** Pojemność kadłuba: { bays, slots, containers, tonnes } dla wariantu tonażu. */
export function cargoHullCapacity(h, tonnesPerContainer = CARGO_TONNES_DEFAULT) {
  const bays = cargoHullBays(h);
  let slots = 0;
  let containers = 0;
  for (const g of bays) { slots += g.slots; containers += g.containers; }
  return { bays: bays.length, slots, containers, tonnes: containers * tonnesPerContainer };
}

/** Tabela pojemności wszystkich kadłubów (demo, dokument). */
export function cargoCapacityTable(tonnesPerContainer = CARGO_TONNES_DEFAULT) {
  return CARGO_BAY_HULL_ORDER.map((id) => {
    const H = CARGO_BAY_HULLS[id];
    const cap = cargoHullCapacity(H, tonnesPerContainer);
    const bays = cargoHullBays(H).map((g) => ({
      id: g.id, door: g.door, leaves: g.leafCount,
      sizeA: +(2 * g.halfA).toFixed(1), sizeB: +(2 * g.halfB).toFixed(1), depth: +g.depth.toFixed(1),
      grid: `${g.cols}×${g.rows}`, module: `${g.module.nx}×${g.module.ny}×${g.module.nz}`,
      slots: g.slots, containers: g.containers
    }));
    return {
      id, label: H.label, family: H.family, length: H.renderLength,
      today: H.cargoToday, todayNote: H.todayNote,
      ...cap,
      rocks: cap.tonnes / CARGO_COPPER_ROCK_ORE_T,
      bays
    };
  });
}

// ============================================================
// Przekształcenia
// ============================================================

/** Układ ładowni (a, b) → układ statku 3D (x, y). */
export function cargoBayToShip(geo, a, b, out = {}) {
  out.x = geo.cx + a;
  out.y = geo.cy + b;
  return out;
}

/**
 * Układ statku 3D → świat 3D (scena: x, y = −y gry). pose — poza GRY { x, y, angle }
 * (y w dół, kąt gry): grupa Core3D ma pozycję (x, −y) i obrót −kąt.
 */
export function cargoShipToWorld(pose, x, y, out = {}) {
  const th = -(Number(pose?.angle) || 0);
  const c = Math.cos(th);
  const s = Math.sin(th);
  out.x = (Number(pose?.x) || 0) + c * x - s * y;
  out.y = -(Number(pose?.y) || 0) + s * x + c * y;
  out.yaw = th;
  return out;
}

/** Kurs ładowni w świecie 3D (oś a) dla pozy gry. */
export function cargoBayWorldYaw(pose) {
  return -(Number(pose?.angle) || 0);
}

// ============================================================
// Wrota: przebieg w czasie
// ============================================================

/**
 * Przebieg otwierania [s] (zamykanie = ten sam przebieg wstecz):
 *   warn   — koguty i poświata szczeliny, wrota stoją,
 *   unlock — skrzydła odrywają się (over: w górę, pocket: w dół pod poszycie),
 *   slide  — przejazd na boki (dłużej przy szerszych wrotach),
 *   settle — over: osiadają na szynach; pocket: bez ruchu,
 *   lights — fala lamp wzdłuż ładowni, rusza w 55% przejazdu.
 */
export function cargoBayDoorTimeline(geo) {
  let T = _timelineCache.get(geo);
  if (T) return T;
  const warn = 0.9;
  const unlock = 0.7;
  const slide = clamp(1.8 + geo.halfB / 22, 2.4, 6.5);
  const settle = geo.door === 'over' ? 0.55 : 0.25;
  const lightsAt = warn + unlock + 0.55 * slide;
  const lights = clamp(0.8 + geo.halfA / 110, 1.0, 3.2);
  const total = Math.max(warn + unlock + slide + settle, lightsAt + lights);
  T = Object.freeze({ warn, unlock, slide, settle, lightsAt, lights, total });
  _timelineCache.set(geo, T);
  return T;
}

const _timelineCache = new WeakMap();

/**
 * Poza wrót dla postępu p [s] na osi przebiegu (0 = zamknięte, total = otwarte).
 * out: { open (0…1: odsłonięta część połowy otworu), lamps (0…1: fala lamp),
 *        warn (0…1: koguty), leaves: [{ da, db, z0, z1 }] — przesunięcie skrzydła
 *        w układzie ładowni i jego dół / góra w z }.
 */
export function cargoBayDoorPose(geo, p, out = null) {
  const T = cargoBayDoorTimeline(geo);
  const o = out ||{ open: 0, lamps: 0, warn: 0, active: false, leaves: geo.leaves.map(() => ({ da: 0, db: 0, z0: 0, z1: 0 })) };
  const P = CARGO_BAY_PARAMS;
  const t = clamp(Number(p) || 0, 0, T.total);
  const end = t >= T.total;
  const u = end ? 1 : smooth((t - T.warn) / T.unlock);
  const sl = end ? 1 : smoother((t - T.warn - T.unlock) / T.slide);
  const st = end ? 1 : smooth((t - T.warn - T.unlock - T.slide) / T.settle);
  o.open = sl;
  o.lamps = end ? 1 : clamp((t - T.lightsAt) / T.lights, 0, 1);
  o.active = t > 0 && t < T.total;
  // Koguty: od początku do końca ruchu (w obie strony — ten sam przebieg).
  o.warn = t > 0 && t < T.warn + T.unlock + T.slide + T.settle ? 1 : 0;
  const n = geo.leafCount;
  const lt = geo.leafT;
  for (let k = 0; k < geo.leaves.length; k++) {
    const L = geo.leaves[k];
    const q = o.leaves[k];
    const i = L.index;
    let z1;
    if (geo.door === 'over') {
      // Wewnętrzne skrzydła wyżej (przejeżdżają nad zewnętrznymi), stos na szynach.
      const lift = (lt + P.liftGap) * (n - i);
      const rest = P.restGap + lt * (n - 1 - i) + lt;
      z1 = u * lift * (1 - st) + st * rest;
      if (u <= 0) z1 = 0;
    } else {
      // Kieszeń: w dół pod poszycie (wewnętrzne głębiej), przejazd pod skórą.
      z1 = -u * (lt + P.liftGap) * (i + 1);
    }
    // (+ 0: bez −0 przy zamkniętych wrotach)
    q.da = 0;
    q.db = L.side * L.travel * sl + 0;
    q.z1 = z1 + 0;
    q.z0 = z1 - lt;
  }
  return o;
}

/** Postęp wrót (0…total) dla scen: otwarcie od tOpen, zamknięcie od tClose (null = bez). */
export function cargoBayDoorProgress(geo, t, tOpen = 0, tClose = null) {
  const T = cargoBayDoorTimeline(geo);
  if (!(t >= tOpen)) return 0;
  const opened = Math.min(T.total, t - tOpen);
  if (tClose === null || !(t >= tClose)) return opened;
  const at = Math.min(T.total, Math.max(0, tClose - tOpen));
  return Math.max(0, at - (t - tClose));
}

/** Wysokość lamp pod krawędzią [z]: przy kieszeni pod szczeliną skrzydeł. */
export function cargoBayLampZ(geo) {
  return geo.door === 'pocket' ? -(geo.pocketDrop + 1.0) : -0.9;
}

/**
 * Lampy ładowni: pozycje w układzie ładowni (obie długie ściany, pod krawędzią; przy wrotach
 * „pocket” pod szczeliną, w którą chowają się skrzydła). Lustro shadera (cargoLight.tsl.js).
 */
export function cargoBayLamps(geo) {
  const out = [];
  const z = cargoBayLampZ(geo);
  for (const side of [1, -1]) {
    for (let k = 0; k < geo.lamps; k++) {
      out.push({ k, side, a: -geo.halfA + (k + 0.5) * geo.lampSpacing, b: side * (geo.halfB - 0.6), z });
    }
  }
  return out;
}

// ============================================================
// Sprawdzanie stref (testy, narzędzie dema)
// ============================================================

/**
 * Prostokąty stref ładowni w PNG px: otwór i (dla „over”) pasy parkowania skrzydeł.
 * [{ bayId, kind: 'bay' | 'parking', x0, y0, x1, y1 }].
 */
export function cargoBayZoneRects(h) {
  const H = typeof h === 'string' ? cargoBayHull(h) : h;
  const out = [];
  if (!H) return out;
  const s = cargoBayScale(H);
  for (const B of H.bays) {
    const g = cargoBayGeometry(H, B);
    const x0 = B.x - B.w / 2;
    const x1 = B.x + B.w / 2;
    const y0 = B.y - B.h / 2;
    const y1 = B.y + B.h / 2;
    out.push({ bayId: B.id, kind: 'bay', x0, y0, x1, y1 });
    if (g.parking > 0) {
      const band = g.parking / s;
      out.push({ bayId: B.id, kind: 'parking', x0, y0: y0 - band, x1, y1: y0 });
      out.push({ bayId: B.id, kind: 'parking', x0, y0: y1, x1, y1: y1 + band });
    }
  }
  return out;
}

/**
 * Kolizje stref z hardpointami, silnikami, rdzeniami i ze strefami mostków (nakładanie
 * z zapasem margin / 2). editorCfg — wpis SHIP_EDITOR_DEFAULTS.ships, bridges — lista stref
 * mostków (PNG), margin — zapas jak mostek (bridgeZoneMargin: korpus wieżyczki klasy kadłuba).
 * Pas parkowania skrzydeł wymaga pełnego zapasu (skrzydło nie wjeżdża pod wieżyczkę), otwór
 * — openingMul × zapas (korpus wieżyczki 2D może lekko wisieć nad krawędzią otworu).
 * Punkty typu `hangar` (starty myśliwców) nie kolidują: hangar i ładownia to ten sam pokład.
 * Zwraca listę problemów (pusta = OK).
 */
export function validateCargoBays(h, editorCfg = {}, bridges = [], margin = 24, opts = {}) {
  const issues = [];
  const openingMul = Number.isFinite(opts.openingMul) ? opts.openingMul : 0.7;
  const ignore = new Set(opts.ignoreTypes || ['hangar']);
  const rects = cargoBayZoneRects(h);
  const dist = (r, x, y) => {
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dy = Math.max(r.y0 - y, 0, y - r.y1);
    return Math.hypot(dx, dy);
  };
  const markers = [];
  for (const hp of editorCfg?.hardpoints || []) markers.push(['hardpoint', hp]);
  for (const e of editorCfg?.engines?.main || []) markers.push(['engine', e]);
  for (const e of editorCfg?.engines?.side || []) markers.push(['engine', e]);
  for (const c of editorCfg?.cores || []) markers.push(['core', c]);
  for (const r of rects) {
    const need = r.kind === 'bay' ? margin * openingMul : margin;
    for (const [kind, m] of markers) {
      const x = Number(m?.x);
      const y = Number(m?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (kind === 'hardpoint' && ignore.has(m.type)) continue;
      const d = dist(r, x, y);
      if (d < need) issues.push({ bayId: r.bayId, zone: r.kind, kind, id: m.id || null, type: m.type || null, x, y, distance: Math.round(d * 10) / 10 });
    }
    for (const z of bridges || []) {
      const hw = (Number(z.w) || 0) / 2 + margin / 2;
      const hh = (Number(z.h) || 0) / 2 + margin / 2;
      if (r.x1 > z.x - hw && r.x0 < z.x + hw && r.y1 > z.y - hh && r.y0 < z.y + hh) {
        issues.push({ bayId: r.bayId, zone: r.kind, kind: 'bridge', id: z.id || null, x: z.x, y: z.y, distance: 0 });
      }
    }
  }
  // Ładownie jednego kadłuba nie nakładają się (razem z pasami parkowania).
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.bayId === b.bayId) continue;
      if (a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1) issues.push({ bayId: a.bayId, zone: a.kind, kind: 'bay', id: b.bayId, distance: 0 });
    }
  }
  return issues;
}
