// src/3d/ships3d/ships/ships3D.js
//
// REJESTR MODELI 3D OKRĘTÓW: Atlas (atlasHull3D.js), flota Terra Nova / piratów (fleetHull3D.js,
// bryły rysowane ręcznie) i kadłuby z automatu (autoHull3D.js — lotniskowce, superkapitały,
// myśliwiec, megafrachtowiec, ruch v2). Jedno wejście: buildShip3D(id) → wynik o wspólnym kształcie:
//   { id, label, faction, tier, editorKey, profile, sprite: { width, height }, scale, palette,
//     deckZ, builder (MeshBuilder3D — toGeometry(THREE, scale)), mounts, nozzles, rcs, hangars,
//     lights, bridges, hexlanceMuzzle | null, heightAt(xw, yw), bottomAt(xw, yw), contains(xw, yw) }
// Wszystko w jednostkach świata gry, układ Core3D (X ku dziobowi, Y = −y sprite'a, Z w górę).
// Materiał: createShipMaterial({ deckMap: sprite, palette: wynik.palette }) (shipMaterials3D.tsl.js).

import { buildAtlasHull3D } from './atlasHull3D.js';
import { buildFleetHull3D, FLEET3D_SPECS } from './fleetHull3D.js';
import { buildAutoHull3D, AUTO3D_TABLE } from './autoHull3D.js';

/** id modelu (= id z HULL_RENDER_PROFILES) → opis; `sprite` — ścieżka PNG w repo. */
export const SHIP3D_MODELS = Object.freeze({
  atlas: Object.freeze({ id: 'atlas', label: 'Atlas — okręt gracza', short: 'Atlas', faction: 'player', tier: 'Capital', editor: 'atlas', sprite: 'assets/capital_ship_rect_v1.png', kind: 'atlas' }),
  ...Object.fromEntries(Object.entries(FLEET3D_SPECS).map(([id, s]) => [id, Object.freeze({
    id, label: s.label, short: s.label.split(' — ')[0], faction: s.faction, tier: s.tier, editor: s.editor, sprite: s.sprite, kind: 'fleet'
  })])),
  ...Object.fromEntries(Object.entries(AUTO3D_TABLE).map(([id, t]) => [id, Object.freeze({
    id, label: t.label, short: t.short, faction: t.faction, tier: t.tier || null, editor: t.editor || null, sprite: t.sprite, kind: 'auto'
  })]))
});

export const SHIP3D_IDS = Object.freeze(Object.keys(SHIP3D_MODELS));

/** Model 3D kadłuba (patrz nagłówek). o — opcje budowy (bridges, bridgeZScale, rcs — skrzynki RCS w bryle; gra: false). */
export function buildShip3D(id, o = {}) {
  if (id === 'atlas') return buildAtlasHull3D(o);
  if (FLEET3D_SPECS[id]) return buildFleetHull3D(id, o);
  if (AUTO3D_TABLE[id]) return buildAutoHull3D(id, o);
  throw new Error(`nieznany model okrętu 3D: ${id}`);
}
