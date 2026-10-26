// src/data/reactorCores.js
//
// Rdzenie (reaktory) kadłubów w grze — markery w przestrzeni PNG sprite'a: (0,0) = środek,
// +X = dziób, y w dół (jak `cores[]` w src/data/hardpointEditorDefaults.js). Kadłub bez wpisu dostaje
// komorę z automatu (`autoReactorMarker` w src/game/reactorCoreGame.js — najgłębsze miejsce przy środku masy).
//
// Pola: x, y — środek komory; r — promień komory (rozgrywka: komórki siatki belek z pancerzem armorMul);
// OBRAZ (model 3D reaktora nad kadłubem — src/3d/reactor3D.js, rozgrywka ich nie czyta): hr — promień obrysu
// obudowy [px PNG], tier — poziom rdzenia (R1–R6, etap 2 kreatora: docs/PLAN-KREATOR-STOCZNIA.md), model —
// rodzaj modelu (terran / pirate / atlas).
//
// FLOTA TERRA NOVY: jedno źródło miejsc z kreatorem — rdzeń presetu (src/game/hullDesign/hullDesignPresets.js,
// sloty hullDesignSystemSlots.js) w układzie projektu (x, y = 0) przeliczony na px PNG tak jak sloty
// (px = x / s − przesunięcie, tabela w nagłówku hullDesignSystemSlots.js), hr = promień modułu `reactor` / s
// (obudowa 3D stoi w gnieździe kreatora, wariant v 2). Promień komory r — dawny z automatu (rozgrywka bez zmian
// poza miejscem). Miejsca nie nachodzą na wieże (SHIP_EDITOR_DEFAULTS) ani strefy mostków
// (BRIDGE_LAYOUT_PROPOSALS) — tests/reactorCoreMarkers.test.mjs. Bellator i Iron Skull — miejsca z dema
// rdzenia (dema/rdzen-hulls-data.js, docs/webgpu/DEMO-RDZEN.md). Atlas — POD MOSTKIEM RUFOWYM (decyzja użytkownika
// 2026-10-26: „rdzeń powinien być pod tylnym mostkiem”; środek strefy `mostek_rufowy`): komora leży w strefie mostka,
// wspólne komórki mają większy z pancerzy, nie iloczyn (`bridgeArmorCells` w src/game/reactorCore.js).
//
// Klucz = id profilu renderu kadłuba (HULL_RENDER_PROFILES, getNpcHullRenderProfileId).

const marker = (m) => Object.freeze([Object.freeze(m)]);

export const REACTOR_CORE_MARKERS = Object.freeze({
  atlas: marker({ id: 'atlas_A', x: -735, y: -13, r: 56, armorMul: 3, hr: 44, tier: 'R6', model: 'atlas' }),
  // Terra Nova — kreator: custos −20 (r 5), hasta −30 (r 8), bellator −17 (r 26), citadella −230 (r 24), colossus −330 (r 30)
  terran_frigate: marker({ id: 'custos_A', x: -214.5, y: 6, r: 295.8, hr: 62.5, tier: 'R1', model: 'terran' }),
  terran_destroyer: marker({ id: 'hasta_A', x: -92.5, y: -0.5, r: 88.9, hr: 21.3, tier: 'R2', model: 'terran' }),
  terran_battleship: marker({ id: 'bellator_A', x: -32, y: 0, r: 48, armorMul: 3, hr: 48.2, tier: 'R4', model: 'terran' }),
  terran_carrier: marker({ id: 'citadella_A', x: -357.6, y: -12, r: 92.9, hr: 37.2, tier: 'R5', model: 'terran' }),
  terran_supercapital: marker({ id: 'colossus_A', x: -353.2, y: -2, r: 64.3, hr: 32.2, tier: 'R6', model: 'terran' }),
  pirate_battleship: marker({ id: 'skull_A', x: -60, y: 0, r: 62.64, armorMul: 3, tier: 'R4', model: 'pirate' }),
  // Kadłuby ruchu v2 (E13, 2026-10-22): komora w maszynowni za ładownią (blok rufowy sprite'a), promień komory
  // r = 0,6–1,6 komórki siatki belek (małe kadłuby — mniej, żeby zmieścić zbiornik i mostek; frachtowiec ciężki —
  // 3 komórki), poziom rdzenia = poziom mostka (klasa z pola kadłuba), obudowa hr = promień modułu `reactor`
  // poziomu (5 / 8 / 14 / — / — / 30 j.) / s. Komora poza strefą mostka i zbiornikiem — tests/trafficHullData.test.mjs.
  inter_station_shuttle: marker({ id: 'inter_station_shuttle_A', x: -330, y: -10, r: 182.4, hr: 71.5, tier: 'R1', model: 'terran' }),
  container_ship: marker({ id: 'container_ship_A', x: -650, y: -10, r: 110.9, hr: 45.5, tier: 'R2', model: 'terran' }),
  long_haul_freighter: marker({ id: 'long_haul_freighter_A', x: -580, y: -10, r: 78.8, hr: 46, tier: 'R3', model: 'terran' }),
  heavy_freighter: marker({ id: 'heavy_freighter_A', x: -660, y: -10, r: 44.3, hr: 29.6, tier: 'R6', model: 'terran' }),
  heavy_harvester: marker({ id: 'heavy_harvester_A', x: -130, y: 0, r: 110.9, hr: 39.4, tier: 'R2', model: 'terran' }),
  belter: marker({ id: 'belter_A', x: -500, y: -20, r: 192.2, hr: 49.3, tier: 'R1', model: 'terran' }),
  surveyor: marker({ id: 'surveyor_A', x: -560, y: -20, r: 180.2, hr: 46.2, tier: 'R1', model: 'terran' }),
  refinery_tender: marker({ id: 'refinery_tender_A', x: -560, y: -20, r: 83.2, hr: 51.7, tier: 'R3', model: 'terran' }),
  tanker: marker({ id: 'tanker_A', x: -460, y: -20, r: 74.2, hr: 46.2, tier: 'R3', model: 'terran' }),
  salvage_hauler: marker({ id: 'salvage_hauler_A', x: -440, y: -20, r: 95, hr: 59.1, tier: 'R3', model: 'terran' }),
  construction_tug: marker({ id: 'construction_tug_A', x: -420, y: -20, r: 160.2, hr: 41.1, tier: 'R1', model: 'terran' }),
  smuggler: marker({ id: 'smuggler_A', x: -420, y: -20, r: 160.2, hr: 41.1, tier: 'R1', model: 'pirate' }),
  pirate_raider: marker({ id: 'pirate_raider_A', x: -640, y: -20, r: 129.4, hr: 49.3, tier: 'R2', model: 'pirate' }),
  distress_beacon_ship: marker({ id: 'distress_beacon_ship_A', x: -330, y: -20, r: 144.1, hr: 37, tier: 'R1', model: 'terran' }),
  repair_drone: marker({ id: 'repair_drone_A', x: -170, y: -60, r: 144, hr: 80, tier: 'R1', model: 'terran' }),
  bounty_hunter: marker({ id: 'bounty_hunter_A', x: -400, y: -5, r: 131, hr: 53.8, tier: 'R2', model: 'terran' }),
  police_cutter: marker({ id: 'police_cutter_A', x: -150, y: -5, r: 192.2, hr: 49.3, tier: 'R1', model: 'terran' }),
  rescue_ship: marker({ id: 'rescue_ship_A', x: -470, y: -5, r: 144.1, hr: 59.1, tier: 'R2', model: 'terran' })
});

// Barwa plazmy reaktora per frakcja (liniowe RGB „ciała”, jak REACTOR_COLORS dema).
export const REACTOR_CORE_COLORS = Object.freeze({
  terran: Object.freeze([0.22, 0.72, 1.0]),
  pirate: Object.freeze([1.0, 0.16, 0.34]),
  player: Object.freeze([0.62, 0.42, 1.0])
});

export function reactorColorFor(entity) {
  if (entity?.isPlayer) return REACTOR_CORE_COLORS.player;
  return entity?.isPirate ? REACTOR_CORE_COLORS.pirate : REACTOR_CORE_COLORS.terran;
}
