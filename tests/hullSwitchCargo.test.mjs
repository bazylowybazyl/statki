// Przesiadka gracza (hangar — purchaseShip w index.html) z ładunkiem ponad ładowność nowego kadłuba: odmowa
// z komunikatem (przegląd K1 #7 — przy Atlasie 400 t przesiadka na fregatę zostawiała setki ton nadmiaru).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readIndexHtml, loadIndexFunction } from './helpers/indexSource.mjs';
import { getBagMass } from '../src/data/resources.js';
import { passengersAboard } from '../src/game/playerCrew.js';

const html = readIndexHtml();

function page(cargo, crew = { mode: 'faction', count: 0, contracts: [] }, cabins = {}) {
  const toasts = [];
  const switched = [];
  const hulls = { atlas: { id: 'atlas', name: 'Atlas', cost: 0, cargoCap: 400 }, frigate: { id: 'frigate', name: 'Custos', cost: 0, cargoCap: 16 } };
  const scope = {
    PLAYER: { activeHullId: 'atlas', credits: 0, cargo, crew },
    getBagMass,
    // Kabiny pasażerskie (workforce W6): ludzie na kontraktach zostają w kabinach starego kadłuba.
    passengersAboard,
    playerCabinCapacity: (id) => cabins[id] || 0,
    getPlayerHullDef: (id) => hulls[id] || null,
    playerOwnsHull: () => true,
    ensurePlayerOwnsHull: () => {},
    normalizePlayerHullId: (id) => id,
    HANGAR_UI_STATE: { marketExpanded: new Set(), ownedExpanded: new Set() },
    applyPlayerHullProfile: (id) => { switched.push(id); scope.PLAYER.activeHullId = id; return true; },
    buildHangarPanel: () => {},
    updateStationOverlay: () => {},
    stationUI: { tab: 'hangar', station: null },
    toast: (m) => toasts.push(m)
  };
  const purchaseShip = loadIndexFunction(html, 'function purchaseShip(shipBP, opts = {}) {', 'purchaseShip', scope);
  return { scope, purchaseShip, toasts, switched };
}

test('przesiadka z ładunkiem ponad ładowność nowego kadłuba — odmowa, ładunek i kadłub bez zmian', () => {
  const p = page({ steel: 120 });
  assert.equal(p.purchaseShip({ id: 'frigate' }, { activate: true }), false);
  assert.deepEqual(p.switched, []);
  assert.equal(p.scope.PLAYER.activeHullId, 'atlas');
  assert.match(p.toasts.at(-1), /^Rozładuj ładownię \(120 t > 16 t\)/);
});

test('ładunek mieści się — przesiadka; zakup bez aktywacji nie sprawdza ładowni', () => {
  const p = page({ steel: 10 });
  assert.equal(p.purchaseShip({ id: 'frigate' }, { activate: true }), true);
  assert.deepEqual(p.switched, ['frigate']);
  const q = page({ steel: 300 });
  assert.equal(q.purchaseShip({ id: 'frigate' }, { activate: false }), true);
  assert.deepEqual(q.switched, []);
});

test('ludzie na kontraktach w kabinach (workforce W6) — przesiadka na kadłub bez miejsca w kabinach: odmowa', () => {
  const crew = { mode: 'faction', count: 0, contracts: [{ fromId: 'earth', units: 120, paid: 11, secondsLeft: 900 }] };
  const p = page({}, crew, { atlas: 300 });
  assert.equal(p.purchaseShip({ id: 'frigate' }, { activate: true }), false);
  assert.deepEqual(p.switched, []);
  assert.match(p.toasts.at(-1), /^Oddaj kontrakty z kabin \(120 os\.\)/);
});
