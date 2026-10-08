import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CHIPS, CHIP_ORDER, CHIP_REMOVE_REFUND, PD_CHIP_ID, getChipDef } from '../src/data/chips.js';
import {
  chipListHas,
  hullHasChip,
  normalizeHullChips,
  serializeHullChips,
  installHullChip,
  removeHullChip,
  chipRemovalRefund
} from '../src/game/shipChips.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

const html = readIndexHtml();

// ---------------------------------------------------------------------------
// Katalog

test('katalog chipów ma PD CHIP z ceną i opisem mówiącym, co jest BEZ chipa', () => {
  const pd = CHIPS[PD_CHIP_ID];
  assert.equal(PD_CHIP_ID, 'pd_targeting');
  assert.ok(pd, 'brak wpisu pd_targeting');
  assert.equal(pd.id, PD_CHIP_ID);
  assert.equal(pd.name, 'PD CHIP');
  assert.equal(pd.cost, 900);
  // Zmiana zachowania gracza musi być napisana w opisie chipa (pułapka 1 briefu).
  assert.match(pd.desc, /rakiet/);
  assert.match(pd.desc, /myśliwc/);
  assert.match(pd.desc, /kadłub/);
  assert.equal(getChipDef(PD_CHIP_ID), pd);
  assert.equal(getChipDef('nie_ma'), null);
});

test('kolejność w UI pokrywa cały katalog, a każdy wpis ma komplet pól', () => {
  assert.deepEqual([...CHIP_ORDER].sort(), Object.keys(CHIPS).sort());
  for (const id of CHIP_ORDER) {
    const def = CHIPS[id];
    assert.equal(def.id, id);
    assert.equal(typeof def.name, 'string');
    assert.equal(typeof def.desc, 'string');
    assert.ok(Number.isFinite(def.cost) && def.cost > 0, `${id}: cena`);
  }
});

// ---------------------------------------------------------------------------
// Zapytania (pętle broni — bez alokacji)

test('chipListHas czyta tablice i Sety, pusty stan = brak chipa', () => {
  assert.equal(chipListHas(['a', PD_CHIP_ID], PD_CHIP_ID), true);
  assert.equal(chipListHas(new Set([PD_CHIP_ID]), PD_CHIP_ID), true);
  assert.equal(chipListHas(['a'], PD_CHIP_ID), false);
  assert.equal(chipListHas(null, PD_CHIP_ID), false);
  assert.equal(chipListHas(undefined, PD_CHIP_ID), false);
  assert.equal(chipListHas({}, PD_CHIP_ID), false);
  assert.equal(chipListHas([PD_CHIP_ID], ''), false);
});

test('hullHasChip patrzy tylko na wskazany kadłub', () => {
  const hullChips = { terran_frigate: [PD_CHIP_ID] };
  assert.equal(hullHasChip(hullChips, 'terran_frigate', PD_CHIP_ID), true);
  assert.equal(hullHasChip(hullChips, 'atlas', PD_CHIP_ID), false);
  assert.equal(hullHasChip(null, 'terran_frigate', PD_CHIP_ID), false);
});

test('hasShipChip w index.html: gracz czyta aktywny kadłub, NPC swoje entity.chips', () => {
  assert.match(html, /window\.hasShipChip = hasShipChip;/);
  const ship = { id: 'player' };
  const PLAYER = { activeHullId: 'terran_frigate', hullChips: {} };
  const hasShipChip = loadIndexFunction(html, 'function hasShipChip(entity, chipId) {', 'hasShipChip', {
    ship, PLAYER, hullHasChip, chipListHas
  });

  assert.equal(hasShipChip(ship, PD_CHIP_ID), false, 'bez chipa');
  PLAYER.hullChips.terran_frigate = [PD_CHIP_ID];
  assert.equal(hasShipChip(ship, PD_CHIP_ID), true, 'chip na aktywnym kadłubie');
  PLAYER.activeHullId = 'atlas';
  assert.equal(hasShipChip(ship, PD_CHIP_ID), false, 'chip jest per kadłub — inny kadłub go nie ma');

  assert.equal(hasShipChip({ chips: [PD_CHIP_ID] }, PD_CHIP_ID), true, 'NPC z tablicą');
  assert.equal(hasShipChip({ chips: new Set([PD_CHIP_ID]) }, PD_CHIP_ID), true, 'NPC z Setem');
  assert.equal(hasShipChip({}, PD_CHIP_ID), false, 'NPC domyślnie bez chipów');
  assert.equal(hasShipChip(null, PD_CHIP_ID), false);
});

// ---------------------------------------------------------------------------
// Zapis / odczyt 'loadout'

test('odczyt zapisu: tylko znane chipy i kadłuby, bez duplikatów; brak pola = brak chipów', () => {
  assert.deepEqual(normalizeHullChips(undefined), {});
  assert.deepEqual(normalizeHullChips(null), {});
  assert.deepEqual(normalizeHullChips([PD_CHIP_ID]), {});
  const loaded = normalizeHullChips({
    terran_frigate: [PD_CHIP_ID, PD_CHIP_ID, 'nieznany_chip', 7],
    atlas: [],
    usuniety_kadlub: [PD_CHIP_ID],
    zly_format: PD_CHIP_ID
  }, { isValidHull: (id) => id !== 'usuniety_kadlub' });
  assert.deepEqual(loaded, { terran_frigate: [PD_CHIP_ID] });
});

test('zapis i odczyt przechodzą przez JSON bez strat', () => {
  const hullChips = {};
  installHullChip(hullChips, 'terran_frigate', PD_CHIP_ID);
  installHullChip(hullChips, 'atlas', PD_CHIP_ID);
  const json = JSON.stringify({ hullChips: serializeHullChips(hullChips) });
  const back = normalizeHullChips(JSON.parse(json).hullChips);
  assert.deepEqual(back, hullChips);
  assert.equal(hullHasChip(back, 'terran_frigate', PD_CHIP_ID), true);
});

test('saveLoadout zapisuje hullChips, loadLoadout je czyta (zapis sprzed chipów działa)', () => {
  const save = sliceFunction(html, 'function saveLoadout() {');
  assert.match(save, /hullChips: serializeHullChips\(PLAYER\.hullChips\)/);
  const load = sliceFunction(html, 'function loadLoadout() {');
  assert.match(load, /PLAYER\.hullChips = normalizeHullChips\(data\?\.hullChips/);
  // Pole jest opcjonalne: normalizeHullChips(undefined) daje {} (test wyżej).
  assert.match(html, /hullChips: \{\},/, 'PLAYER startuje bez chipów');
});

// ---------------------------------------------------------------------------
// Instalacja / zdjęcie

test('instalacja jest idempotentna, zdjęcie czyści pusty kadłub', () => {
  const hullChips = {};
  assert.equal(installHullChip(hullChips, 'atlas', PD_CHIP_ID), true);
  assert.equal(installHullChip(hullChips, 'atlas', PD_CHIP_ID), false, 'drugi raz ten sam chip');
  assert.equal(installHullChip(hullChips, 'atlas', 'nieznany_chip'), false);
  assert.deepEqual(hullChips, { atlas: [PD_CHIP_ID] });
  assert.equal(removeHullChip(hullChips, 'atlas', PD_CHIP_ID), true);
  assert.equal(removeHullChip(hullChips, 'atlas', PD_CHIP_ID), false);
  assert.deepEqual(hullChips, {});
});

test('zdjęcie zwraca połowę ceny; chip postawiony za darmo (dev) nic nie zwraca', () => {
  const pd = CHIPS[PD_CHIP_ID];
  assert.equal(CHIP_REMOVE_REFUND, 0.5);
  assert.equal(chipRemovalRefund(pd), 450);
  assert.equal(chipRemovalRefund(pd, { freeInstall: true }), 0);
  assert.equal(chipRemovalRefund(null), 0);
});

// ---------------------------------------------------------------------------
// UI — sekcja CHIPY w reficie ręcznym zakładki WYPOSAŻENIE (src/ui/station/fittingPanel.js)

const fittingPanelSrc = readFileSync(new URL('../src/ui/station/fittingPanel.js', import.meta.url), 'utf8');

test('refit ręczny WYPOSAŻENIA ma sekcję CHIPY z katalogu (klik — instalacja albo zdjęcie)', () => {
  assert.match(fittingPanelSrc, /<div class="fit-m-sub">CHIPY<\/div>/);
  assert.match(fittingPanelSrc, /const chips = api\.chips\(\);/);
  assert.match(fittingPanelSrc, /api\.toggleChip\(c\.id\)/);
  const api = sliceFunction(html, 'function buildFittingApi() {');
  assert.match(api, /chips: \(\) => CHIP_ORDER\.map\(\(id\) => CHIPS\[id\]\)/);
  assert.match(api, /if \(hullHasChip\(PLAYER\.hullChips, PLAYER\.activeHullId, id\)\) removeMechanicChip\(id\);\s*else installMechanicChip\(id\);/);
});

test('lista chipów: kredyty blokują zakup, z ?dev instalacja za darmo, opis mówi o PD', () => {
  assert.match(fittingPanelSrc, /b\.disabled = !c\.installed && c\.cost > api\.credits\(\);/);
  const api = sliceFunction(html, 'function buildFittingApi() {');
  assert.match(api, /cost: isMechanicDevMode\(\) \? 0 : \(Number\(def\.cost\) \|\| 0\)/);
  const install = sliceFunction(html, 'function installMechanicChip(chipId) {');
  assert.match(install, /const cost = isMechanicDevMode\(\) \? 0 :/);
  assert.match(install, /PLAYER\.credits -= cost;/);
  // Opis chipa (pokazywany pod przyciskiem) mówi, co się dzieje BEZ chipa.
  assert.match(CHIPS[PD_CHIP_ID].desc, /Bez chipa PD strzela WYŁĄCZNIE do rakiet/);
  assert.match(fittingPanelSrc, /<small>\$\{esc\(c\.desc \|\| ''\)\}<\/small>/);
});
