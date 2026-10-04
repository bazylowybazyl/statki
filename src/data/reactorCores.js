// src/data/reactorCores.js
//
// Rdzenie (reaktory) kadłubów w grze — markery w przestrzeni PNG sprite'a: (0,0) = środek,
// +X = dziób, y w dół (jak `cores[]` w src/data/hardpointEditorDefaults.js). Miejsca z dema
// rdzenia (dema/rdzen-hulls-data.js, docs/webgpu/DEMO-RDZEN.md): przy środku masy i poza strefami
// mostków we wszystkich wariantach. Kadłub bez wpisu dostaje komorę z automatu
// (`autoReactorMarker` w src/game/reactorCoreGame.js — najgłębsze miejsce przy środku masy).
//
// Klucz = id profilu renderu kadłuba (HULL_RENDER_PROFILES, getNpcHullRenderProfileId).

export const REACTOR_CORE_MARKERS = Object.freeze({
  atlas: Object.freeze([Object.freeze({ id: 'atlas_A', x: -275, y: 94, r: 56, armorMul: 3 })]),
  terran_battleship: Object.freeze([Object.freeze({ id: 'bellator_A', x: -32, y: 0, r: 48, armorMul: 3 })]),
  pirate_battleship: Object.freeze([Object.freeze({ id: 'skull_A', x: -60, y: 0, r: 62.64, armorMul: 3 })])
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
