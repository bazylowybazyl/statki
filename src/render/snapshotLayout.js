// src/render/snapshotLayout.js — układ strony migawki klatki renderu (docs/PLAN-render-worker.md § 3.2).
//
// Strona = bloki o STAŁYM układzie (wzór: HALL_DUST_IN, src/3d/gasField/hallDustLayout.js). Rekord bloku ma do
// czterech części — Float64, Float32, Int32 (kody, sloty, liczniki), Uint8 — każda w osobnym obszarze strony
// z krokiem `stride` na rekord. Liczby z gry idą w Float64: render liczy je w double (kąty, prędkości, skale —
// zaokrąglenie do Float32 zmieniłoby macierze, a tryb `inline` ma dawać zrzuty bit w bit); Float32 tylko dla danych,
// które render i tak bierze jako float32. Pole nieobecne na obiekcie gry = NaN (lustro odtwarza `undefined`). Indeksy pól to stałe tego modułu (nazwy jak w grze). Pojemności rosną przez
// NOWY układ (`growSnapshotCapacity`) i nowy zestaw stron z generacją układu — bez alokacji w klatce.
//
// Bloki:
//   HEAD     — numery, czasy BEZWZGLĘDNE (§ 3.5) i surowe dt tej klatki, ekran, kamery, pudło cullingu, flagi, sloty
//              gracza i P2, poza renderu gracza, liczniki bloków;
//   LISTS    — kolejność slotów list przekazywanych modułom 3D (kolejność = kolejność partii — warunek zrzutów);
//   ENT      — rekord na slot ENCJI (renderIds.entities): poza, ruch, flagi, napęd, tarcza, maskowanie, wersje;
//   BODY     — rekord na slot CIAŁA belek (renderIds.bodies): kotwica, pivot, granice, liczniki, miejsce w NODES;
//   NODES    — węzły i belki ciał zmienionych od ostatniej klatki ODEBRANEJ (Float64: x, y[, z], żar, znacznik
//              żaru, spoczynek belek; Uint8: active, patch, zerwane belki) — pula, BODY wskazuje przesunięcia;
//   NOZZLES  — dysze MAIN i SIDE encji (pula; ENT wskazuje przesunięcie i liczbę);
//   SHOTS    — pociski w locie w kolejności `window.bullets`;
//   TURRETS  — rekordy wież tej klatki (Turret2D; po RW-26 liczone po stronie gry);
//   STATIONS — stacje w kolejności listy gry;
//   CORES    — rdzenie reaktorów (gospodarz + indeks);
//   WORLD    — skalary świata (warp gracza, słońce, strefa nieba …); bloki modułów świata dochodzą w RW-11c;
//   HALL     — kopia wejścia pyłu hal K-7 (`HALL_DUST_IN`).
// Napisy (id broni, klucze, stany AI, ród `dmgKey`) — kody ze słownika pakującego (`WORLD.DICT_N` wpisów; nowe wpisy
// kanałem bocznym, w `inline` — tablica pakującego).
//
// Czysty moduł (bez three, DOM i `window`).

import { HALL_DUST_IN } from '../3d/gasField/hallDustLayout.js';

export const SNAPSHOT_LAYOUT_VERSION = 1;

function fields(names) {
  const o = {};
  for (let i = 0; i < names.length; i++) {
    if (o[names[i]] !== undefined || names[i] === 'COUNT') throw new Error(`snapshotLayout: pole ${names[i]} dwa razy albo zastrzeżone`);
    o[names[i]] = i;
  }
  o.COUNT = names.length;
  return Object.freeze(o);
}

/** Rekord bloku: indeksy pól w każdej części + kroki (liczba słów części na rekord). */
function record(parts) {
  const out = { F64: fields(parts.f64 || []), F32: fields(parts.f32 || []), I32: fields(parts.i32 || []), U8: fields(parts.u8 || []) };
  out.stride = Object.freeze({ f64: out.F64.COUNT, f32: out.F32.COUNT, i32: out.I32.COUNT, u8: out.U8.COUNT });
  return Object.freeze(out);
}

// ── HEAD (Float64) ───────────────────────────────────────────────────────────────────────────────────────────
export const HEAD = fields([
  'VERSION', 'LAYOUT_GEN', 'K', 'FRAME_ID',
  // czasy bezwzględne (pominięta strona nie gubi czasu) + surowe wartości tej klatki (bit w bit w `inline`)
  'T_FRAME', 'T_PLAY', 'T_GAME', 'FRAME_DT', 'ALPHA', 'PHYS_DT',
  'SIM', 'SIM_RENDER', 'SIM_RENDER_SIM', 'VFX_TIME', 'BRIDGE_TIME', 'WALL', 'WALL_ORIGIN',
  'W', 'H', 'DPR', 'FLAGS',
  // kamera klatki (`cam`, ze wstrząsem) i bez wstrząsu (`camNoShake`)
  'CAM_X', 'CAM_Y', 'CAM_ZOOM', 'CAMNS_X', 'CAMNS_Y', 'CAMNS_ZOOM', 'SHAKE_PX_X', 'SHAKE_PX_Y',
  // kamera 3D (Core3D.syncCamera: tryb free3d) — 0 = z góry
  'CAM_MODE', 'CAM_POS_X', 'CAM_POS_Y', 'CAM_POS_Z', 'CAM_QX', 'CAM_QY', 'CAM_QZ', 'CAM_QW',
  'CAM_FOV', 'CAM_NEAR', 'CAM_FAR', 'CAM_VIEW_DIST',
  // gracz 2 / podzielony ekran
  'CAM2_ON', 'CAM2_X', 'CAM2_Y', 'CAM2_ZOOM',
  // pudło cullingu kadłubów (_hexCullInfo — liczone w render() przed updateHexShips3D)
  'CULL_X', 'CULL_Y', 'CULL_HALF_W', 'CULL_HALF_H', 'CULL_DRAW_HALF_W', 'CULL_DRAW_HALF_H',
  // gracz: slot / generacja i poza renderu (__interpShipPose)
  'PLAYER_SLOT', 'PLAYER_GEN', 'P2_SLOT', 'P2_GEN', 'INTERP_X', 'INTERP_Y', 'INTERP_ANGLE',
  // liczniki bloków tej strony
  'N_ENT', 'N_BODY', 'N_NOZZLES', 'N_SHOTS', 'N_TURRETS', 'N_STATIONS', 'N_CORES',
  'NODE_F64_USED', 'NODE_U8_USED', 'N_BODIES_PACKED', 'N_NODES_PACKED',
  // pierścień rozkazów: numer ostatniego rekordu klatki (RW-21)
  'EVENT_LAST'
]);

/** Bity HEAD.FLAGS. */
export const HEAD_FLAG = Object.freeze({
  PAUSED: 1,
  WORLD_FROZEN: 2,
  SPLIT: 4,
  SKIP_WORLD_3D: 8,   // CIC zakrywa ekran — bez renderu świata
  VIEW3D: 16,         // kamera 3D (View3D.active)
  FOG: 32,            // mgła wojny włączona
  CULL_SET: 64        // pudło cullingu wpisane (faza końcowa)
});

// ── LISTS (Int32): nagłówek liczników + dane, każda lista z pojemnością = pojemność encji ────────────────────
export const LIST = fields([
  'RENDER',       // renderEntities: gracz, P2, NPC, wraki (bez martwych)
  'SEEN',         // renderSeen: RENDER bez ukrytych mgłą
  'SEEN_COLD',    // renderSeenCold: SEEN + zimne wraki z ciałem do rysowania
  'NPCS', 'NPCS_SEEN', 'WRECKS', 'WRECKS_SEEN', 'COLD', 'COLD_NEAR', 'STATIONS'
]);

// ── ENT (rekord na slot encji) ───────────────────────────────────────────────────────────────────────────────
// Pola wybrane z inwentarza § 2.3 (kadłuby, dysze, lampy, maskowanie, tarcze, mostki, modele); każde czytane z encji
// raz na klatkę. Konfiguracja statyczna (obrazy, układ dysz i lamp, profil) — przez WERSJE (licznik zmienia się przy
// zmianie tożsamości obiektu źródła) i opis encji (RW-11), nie w każdej stronie.
export const ENT = record({
  f64: [
    // poza i ruch — surowe pola encji (NaN = pole nieobecne; lustro odtwarza `undefined`)
    'X', 'Y', 'POS_X', 'POS_Y', 'ANGLE', 'VX', 'VY', 'VEL_X', 'VEL_Y', 'ANG_VEL', 'ANGULAR_VELOCITY', 'Z',
    'RADIUS', 'R', 'W', 'H', 'SKIN_Z', 'RENDER_SCALE', 'HP_SCALE', 'HP_SCALE_X', 'HP_SCALE_Y',
    // napęd (thrusterInput, input), stan silników (engineIgn)
    'TI_MAIN', 'TI_LEFT', 'TI_RIGHT', 'TI_TORQUE', 'IN_MAIN', 'IN_THRUST_Y', 'IGN_T',
    // tarcza
    'SH_MAX', 'SH_VAL', 'SH_ACT', 'SH_HARD', 'SH_SHOW',
    // maskowanie (stan gry; wygląd liczy render)
    'CLOAK_LEVEL', 'CLOAK_ENERGY',
    // poziom B: wymiary sprite'a (koło zapasowe tarczy), obraz sprite'a renderu (width, height, natural*)
    'SPRITE_W', 'SPRITE_H', 'RS_W', 'RS_H', 'RS_NW', 'RS_NH',
    // zimny wrak: smuga z migawki (_coldSnapshot.impostor)
    'CI_X', 'CI_Y', 'CI_ROT', 'CI_HALF_W', 'CI_HALF_H', 'CI_R', 'CI_G', 'CI_B', 'CI_WX', 'CI_WY', 'CI_REACH', 'CI_OPACITY'
  ],
  i32: [
    'SLOT', 'GEN', 'FLAGS', 'FLAGS2', 'BODY_SLOT', 'BODY_GEN',
    'NOZ_OFF', 'NOZ_N', 'IGN_STATE', 'STATE', 'PHASE', 'OWNER_ID',
    'SH_STATE', 'SH_IMPACT_ID', 'CLOAK_STATE', 'CLOAK_BREAK',
    // trafienia tarczy (pula impF64: IMP_N rekordów od IMP_OFF, najnowsze pierwsze — jak shield.impacts)
    'IMP_OFF', 'IMP_N',
    // stan mostków (pula brF64 od BR_OFF: nagłówek BRIDGE_HEAD + BR_N × BRIDGE_REC; −1 — bez bridgeState)
    'BR_OFF', 'BR_N',
    // kody słownika: profil modelu 3D (A), stopień broni, frakcja, id kadłuba, id statku (B); zimny wrak: rodzaj
    // migawki i ród (A)
    'MODEL3D', 'WEAPON_TIER', 'FACTION', 'FACTION_ID', 'HULL_ID', 'SHIP_ID', 'COLD_KIND', 'COLD_DMG_KEY',
    // wersje konfiguracji statycznej (rosną przy zmianie tożsamości źródła)
    'V_VISUAL', 'V_HULL', 'V_NOZZLES', 'V_LIGHTS', 'V_BRIDGE', 'V_SHIELD'
  ]
});

/** Bity ENT.FLAGS. */
export const ENT_FLAG = Object.freeze({
  DEAD: 1, WRECK: 2, FRAGMENT: 4, PLAYER: 8, P2: 16, FOG_HIDDEN: 32, BRIDGE_HULK: 64, LIGHTS_OFF: 128,
  ROAD_LIGHTS_OFF: 256, COLD: 512, HAS_POS: 1024, HAS_SHIELD: 2048, HAS_CLOAK: 4096, PIRATE: 8192,
  FRIENDLY: 16384, HIDE_HEX: 32768, HAS_VEL: 65536, HAS_HEXGRID: 131072, RING_SEGMENT: 262144,
  ASTEROID_HEX: 524288, LIGHTS_HIDDEN: 1048576, ENGINES_HIDDEN: 2097152, TURRETS_HIDDEN: 4194304,
  EDITOR_BOOST: 8388608, FSYS_BOOST: 16777216, WARP_PREVIEW: 33554432, IGN_HOT: 67108864
});

/** Bity ENT.FLAGS2. */
export const ENT_FLAG2 = Object.freeze({
  IS_PLAYER_FIELD: 1, CAPITAL: 2, SLEEPING: 4, CLOAK_FORCED: 8, FIGHTER: 16, SH_FORCE_OFF: 32, SH_FORCED_OFF: 64,
  HAS_RS: 128, HAS_COLD_SNAP: 256
});

/** Wyrzut atmosfery mostka (obiekt `vent` gry; ID = numer obiektu — tożsamość dla prepareEmitterDelays). */
export const VENT = Object.freeze({ ID: 0, X: 1, Y: 2, DIRX: 3, DIRY: 4, EXITX: 5, EXITY: 6, BID: 7, STRIDE: 8 });
/** Stan mostków encji w puli brF64: nagłówek, potem rekord na mostek (kolejność bridgeState.bridges). */
export const BRIDGE_HEAD = Object.freeze({ CMD_LOST: 0, CMD_LOST_AT: 1, VENT: 2, STRIDE: 2 + VENT.STRIDE });
export const BRIDGE_REC = Object.freeze({ DEAD: 0, DEAD_AT: 1, MISSING: 2, VENT: 3, STRIDE: 3 + VENT.STRIDE });

/** Trafienie tarczy w puli impF64 (to, co czyta shield3D.processEntity). */
export const IMPACT = Object.freeze({ ID: 0, GRID_ANGLE: 1, DAMAGE: 2, INTENSITY: 3, FX_CLASS: 4, STRIDE: 5 });

// ── BODY (rekord na slot ciała belek; pola rekordu kadłuba `beamHull` i ciała `hull.body`) ──────────────────
export const BODY = record({
  f64: ['ANCHOR_DX', 'ANCHOR_DY', 'SCALE', 'SRC_W', 'SRC_H', 'PIVOT_X', 'PIVOT_Y', 'CELL', 'LAT_MIN_X', 'LAT_MIN_Y',
    'LAT_MIN_Z', 'MIN_X', 'MIN_Y', 'MIN_Z', 'MAX_X', 'MAX_Y', 'MAX_Z', 'MAX_DISP'],
  i32: ['SLOT', 'GEN', 'ENT_SLOT', 'FLAGS', 'NODE_COUNT', 'ACTIVE_NODES', 'BEAM_COUNT', 'STORE_VER', 'SHAPE_VER',
    'DMG_KEY', 'NODE_F64_OFF', 'NODE_U8_OFF', 'NODE_N', 'BEAM_F64_OFF', 'BEAM_U8_OFF', 'BEAM_N', 'REST_F64_OFF',
    'DIRTY_OFF', 'DIRTY_N', 'CHANGED_K', 'REST_K', 'HP_F64_OFF', 'HP_K']
});

export const BODY_FLAG = Object.freeze({
  SLEEPING: 1, PLANAR: 2, DEAD: 4, MESH_DIRTY: 8, DIRTY_ALL: 16, FRAGMENT: 32, ANCHOR_COM: 64, SOLID3D: 128,
  WORLD: 256, NO_SOLID_LOD: 512
});

/**
 * Węzły ciała w NODES: Float64 [x[n], y[n], (z[n] gdy ciało nie jest płaskie), heat[n], heatStamp[n]],
 * Uint8 [active[n], patch[n]] — od przesunięć NODE_F64_OFF / NODE_U8_OFF rekordu BODY. Belki: Float64 [rest[m]],
 * Uint8 [broken[m]] od BEAM_F64_OFF / BEAM_U8_OFF. Pozycje spoczynkowe Float64 [ox[n], oy[n](, oz[n])] od
 * REST_F64_OFF — tylko po zmianie kształtu magazynu (`shapeVersion`: przesunięcie początku ciała, zapis przez widok
 * węzła) od ostatniej klatki odebranej. Brudne węzły skóry (Int32, pula `nodeI32`): DIRTY_N indeksów od DIRTY_OFF —
 * `_region.dirty` z chwili pakowania (żar czworokąta liczy się w chwili zapisu, więc lustro przepisuje DOKŁADNIE ten
 * zbiór; flagi DIRTY_ALL / MESH_DIRTY w FLAGS). HP węzłów Float64 [hp[n], maxHp[n]] od HP_F64_OFF — tylko ciała
 * okrętów z mostkami (mostki 3D czytają HP komórek pod modelem co klatkę), po zmianie sumy HP od ostatniej klatki
 * odebranej (HP zmienia się przy trafieniach bez flag brudu skóry). Topologia (ix, iy, a, b, restBase, adj) — raz na
 * magazyn, poza stroną.
 */
export function bodyNodeF64Words(n, planar) {
  return n * (planar ? 4 : 5);
}
export function bodyNodeU8Bytes(n) {
  return n * 2;
}

// ── NOZZLES (rekord na dyszę: visual.mainThrusters, torqueThrusters albo engines.main) ───────────────────────
export const NOZZLE = record({
  f64: ['THROTTLE', 'VFX_SCALE', 'NOZZLE_DEG', 'BASE_DEG', 'GIMBAL_MIN', 'GIMBAL_MAX'],
  i32: ['KIND', 'FLAGS']   // KIND: 0 MAIN, 1 SIDE, 2 engines.main; FLAGS: 1 zniszczona, 2 brak obiektu
});

// ── SHOTS (rekord na pocisk, kolejność window.bullets) ───────────────────────────────────────────────────────
export const SHOT = record({
  f64: ['X', 'Y', 'VX', 'VY', 'VZ', 'Z', 'IVX', 'IVY', 'IVZ', 'LIFE', 'AGE', 'BORN_SIM'],
  i32: ['SLOT', 'GEN', 'VFX_KEY', 'TYPE', 'WEAPON_SIZE', 'FLAGS', 'SOURCE_SLOT', 'SOURCE_GEN', 'CLOCK']
});

export const SHOT_FLAG = Object.freeze({ FORCE_CANVAS: 1, PLAYER: 2 });

// ── TURRETS (rekord na wieżę tej klatki — rekordy Turret2D) ──────────────────────────────────────────────────
export const TURRET = record({
  f64: ['WX', 'WY', 'ANG', 'SCALE', 'RECOIL', 'SHAKE', 'R', 'HOUSING', 'BARREL', 'FLASH'],
  i32: ['ENT_SLOT', 'ENT_GEN', 'KEY', 'UID', 'WEAPON', 'FX_KEY']
});

// ── STATIONS ─────────────────────────────────────────────────────────────────────────────────────────────────
export const STATION = record({
  f64: ['X', 'Y', 'ANGLE', 'R', 'BASE_R'],
  i32: ['SLOT', 'GEN', 'FLAGS']   // FLAGS: 1 zniszczona 3D, 2 ukryta mgłą, 4 port ringu, 8 piracka
});

// ── CORES ────────────────────────────────────────────────────────────────────────────────────────────────────
export const CORE = record({
  f64: ['INTEGRITY', 'MELT_REMAIN', 'MELT_DUR', 'LAST_X', 'LAST_Y'],
  i32: ['HOST_SLOT', 'HOST_GEN', 'INDEX', 'STATE', 'DEAD_COUNT', 'ELSEWHERE']
});

// ── WORLD (Float64, skalary) ─────────────────────────────────────────────────────────────────────────────────
export const WORLD = fields([
  'SUN_X', 'SUN_Y', 'SUN_R', 'SKY_ZONE',
  // warp gracza (GameState.warp) i dopalacz (GameState.boost)
  'WARP_STATE', 'WARP_CHARGE', 'WARP_CHARGE_TIME', 'WARP_GEAR', 'WARP_DIR', 'WARP_FLYBY', 'WARP_CRUISE', 'WARP_SPEED',
  'WARP_EXIT_ACTIVE', 'WARP_EXIT_AGE', 'WARP_EXIT_TBRAKE', 'WARP_TARGET_BODY', 'BOOST_STATE',
  // słownik napisów: liczba wpisów (nowe — kanałem bocznym)
  'DICT_N'
]);

// ── HALL (kopia HALL_DUST_IN) ────────────────────────────────────────────────────────────────────────────────
export const HALL_WORDS = HALL_DUST_IN.size;

/** Pojemności domyślne (rosną przez growSnapshotCapacity). */
export const SNAPSHOT_DEFAULT_CAPACITY = Object.freeze({
  entities: 512, bodies: 512, nodeF64: 1 << 18, nodeU8: 1 << 17, nodeI32: 1 << 15, impacts: 2048, bridgeWords: 8192, nozzles: 4096, shots: 1024, turrets: 2048,
  stations: 64, cores: 256
});

const ALIGN = 8;
const alignUp = (n) => Math.ceil(n / ALIGN) * ALIGN;

/**
 * Układ strony dla pojemności `cap`: przesunięcia bajtów obszarów i rozmiar strony. Wynik stały dla `cap`.
 */
export function createSnapshotLayout(capacity = SNAPSHOT_DEFAULT_CAPACITY, gen = 0, blocks = null) {
  const cap = { ...SNAPSHOT_DEFAULT_CAPACITY, ...capacity };
  const regions = {};
  let off = 0;
  const region = (name, ctor, length) => {
    off = alignUp(off);
    regions[name] = { offset: off, length, bytes: length * ctor.BYTES_PER_ELEMENT, ctor: ctor.name };
    off += length * ctor.BYTES_PER_ELEMENT;
  };
  const recRegions = (prefix, rec, n) => {
    if (rec.stride.f64) region(`${prefix}F64`, Float64Array, n * rec.stride.f64);
    if (rec.stride.f32) region(`${prefix}F32`, Float32Array, n * rec.stride.f32);
    if (rec.stride.i32) region(`${prefix}I32`, Int32Array, n * rec.stride.i32);
    if (rec.stride.u8) region(`${prefix}U8`, Uint8Array, n * rec.stride.u8);
  };
  region('head', Float64Array, HEAD.COUNT);
  region('world', Float64Array, WORLD.COUNT);
  region('hall', Float64Array, HALL_WORDS);
  region('listCount', Int32Array, LIST.COUNT);
  region('listData', Int32Array, LIST.COUNT * cap.entities);
  recRegions('ent', ENT, cap.entities);
  recRegions('body', BODY, cap.bodies);
  region('nodeF64', Float64Array, cap.nodeF64);
  region('nodeU8', Uint8Array, cap.nodeU8);
  region('nodeI32', Int32Array, cap.nodeI32);
  region('impF64', Float64Array, cap.impacts * IMPACT.STRIDE);
  region('brF64', Float64Array, cap.bridgeWords);
  recRegions('noz', NOZZLE, cap.nozzles);
  recRegions('shot', SHOT, cap.shots);
  recRegions('tur', TURRET, cap.turrets);
  recRegions('sta', STATION, cap.stations);
  recRegions('core', CORE, cap.cores);
  // bloki modułów (RW-11c: ring, pas, baza, warp, planety… — własne pliki układu, wzór pyłu hal): obszary `blk:<nazwa>:f64|i32|u8`
  const blockList = [];
  if (blocks) {
    for (const b of blocks) {
      if (b.f64) region(`blk:${b.name}:f64`, Float64Array, b.f64);
      if (b.i32) region(`blk:${b.name}:i32`, Int32Array, b.i32);
      if (b.u8) region(`blk:${b.name}:u8`, Uint8Array, b.u8);
      blockList.push(Object.freeze({ name: b.name, f64: b.f64 | 0, i32: b.i32 | 0, u8: b.u8 | 0 }));
    }
  }
  return Object.freeze({
    version: SNAPSHOT_LAYOUT_VERSION, gen, cap: Object.freeze(cap), regions: Object.freeze(regions),
    blocks: Object.freeze(blockList), pageBytes: alignUp(off)
  });
}

const CTORS = { Float64Array, Float32Array, Int32Array, Uint8Array };

/**
 * Widoki strony (tworzone RAZ — `views` potrójnego bufora): `{ head, world, hall, listCount, listData, entF64, … }`.
 */
export function createSnapshotViews(buffer, byteOffset, layout) {
  const v = { layout, listStride: layout.cap.entities, blocks: {} };
  for (const b of layout.blocks || []) v.blocks[b.name] = { f64: null, i32: null, u8: null };
  for (const name in layout.regions) {
    const r = layout.regions[name];
    const view = new CTORS[r.ctor](buffer, byteOffset + r.offset, r.length);
    if (name.startsWith('blk:')) {
      const i = name.lastIndexOf(':');
      v.blocks[name.slice(4, i)][name.slice(i + 1)] = view;
    } else v[name] = view;
  }
  return v;
}

/** Nowa pojemność: każda przekroczona pozycja `need` × 2 (zaokrąglone w górę do potęgi dwójki). */
export function growSnapshotCapacity(cap, need) {
  const out = { ...cap };
  let grew = false;
  for (const k in need) {
    if (need[k] > (out[k] || 0)) {
      let c = Math.max(16, out[k] || 16);
      while (c < need[k] * 2) c *= 2;
      out[k] = c;
      grew = true;
    }
  }
  return grew ? out : cap;
}
