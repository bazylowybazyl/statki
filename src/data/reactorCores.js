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
// (BRIDGE_LAYOUT_PROPOSALS) — tests/reactorCoreMarkers.test.mjs. Bellator, Iron Skull i Atlas — miejsca z dema
// rdzenia (dema/rdzen-hulls-data.js, docs/webgpu/DEMO-RDZEN.md).
//
// Klucz = id profilu renderu kadłuba (HULL_RENDER_PROFILES, getNpcHullRenderProfileId).

const marker = (m) => Object.freeze([Object.freeze(m)]);

export const REACTOR_CORE_MARKERS = Object.freeze({
  atlas: marker({ id: 'atlas_A', x: -275, y: 94, r: 56, armorMul: 3, hr: 44, tier: 'R6', model: 'atlas' }),
  // Terra Nova — kreator: custos −20 (r 5), hasta −30 (r 8), bellator −17 (r 26), citadella −230 (r 24), colossus −330 (r 30)
  terran_frigate: marker({ id: 'custos_A', x: -214.5, y: 6, r: 295.8, hr: 62.5, tier: 'R1', model: 'terran' }),
  terran_destroyer: marker({ id: 'hasta_A', x: -92.5, y: -0.5, r: 88.9, hr: 21.3, tier: 'R2', model: 'terran' }),
  terran_battleship: marker({ id: 'bellator_A', x: -32, y: 0, r: 48, armorMul: 3, hr: 48.2, tier: 'R4', model: 'terran' }),
  terran_carrier: marker({ id: 'citadella_A', x: -357.6, y: -12, r: 92.9, hr: 37.2, tier: 'R5', model: 'terran' }),
  terran_supercapital: marker({ id: 'colossus_A', x: -353.2, y: -2, r: 64.3, hr: 32.2, tier: 'R6', model: 'terran' }),
  pirate_battleship: marker({ id: 'skull_A', x: -60, y: 0, r: 62.64, armorMul: 3, tier: 'R4', model: 'pirate' })
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
