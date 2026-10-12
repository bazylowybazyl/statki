import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';

// Klucz edytora gniazd (hpEditor.v1 → ships[klucz]) dla kadłuba gracza. Do 2026-10-12 toEditorHullAlias obcinał
// przedrostek terran_, a resolvePlayerEditorKey zwracał alias kandydata — Citadella ('carrier', rama 'terran_carrier')
// i Colossus ('supercapital') nie trafiały w klucze edytora terran_carrier / terran_supercapital i dostawały układ
// gniazd, dysz i świateł Atlasa; Corvus (sprite fregaty Terra Novy, edytor bez wpisu 'corvus') — też Atlasa.

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const catalogSource = readFileSync(new URL('../src/data/playerHullCatalog.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function loadEditorKeyFns(storageShips = {}) {
  const start = indexSource.indexOf('    function toEditorHullAlias(');
  const resolveAt = indexSource.indexOf('    function resolvePlayerEditorKey(', start);
  assert.ok(start > 0 && resolveAt > start, 'toEditorHullAlias i resolvePlayerEditorKey muszą stać w index.html w tej kolejności');
  const end = indexSource.indexOf('\n    }\n', resolveAt);
  assert.ok(end > resolveAt, 'koniec resolvePlayerEditorKey');
  const source = indexSource.slice(start, end + 7);
  const env = { player: { shipFrame: '' }, ship: { activeHullId: '' } };
  const factory = new Function('SHIP_EDITOR_DEFAULTS', 'readShipsEditorConfigFromStorage', 'Game', 'ship',
    `${source}\nreturn { toEditorHullAlias, getEditorHullConfigKeys, resolvePlayerEditorKey };`);
  const fns = factory(SHIP_EDITOR_DEFAULTS, () => storageShips, { get player() { return env.player; } }, env.ship);
  return { ...fns, env };
}

// Pary id → rama z katalogu kadłubów gracza (plik importuje sprite'y, więc czytany jako tekst).
function playerHulls() {
  const out = [];
  const re = /id: '([a-z_]+)',[\s\S]*?shipFrame: '([a-z_]+)'/g;
  let m;
  while ((m = re.exec(catalogSource))) out.push({ id: m[1], shipFrame: m[2] });
  return out;
}

const EXPECTED = {
  atlas: 'atlas',
  frigate: 'frigate',
  corvus: 'frigate',
  pirate_frigate: 'pirate_frigate',
  destroyer: 'destroyer',
  pirate_destroyer: 'pirate_destroyer',
  battleship: 'battleship',
  pirate_battleship: 'pirate_battleship',
  carrier: 'terran_carrier',
  supercapital: 'terran_supercapital',
  megafreighter: 'megafreighter'
};

test('klucz edytora: każdy kadłub gracza trafia we własny wpis edytora (nie w Atlasa)', () => {
  const hulls = playerHulls();
  assert.ok(hulls.length >= Object.keys(EXPECTED).length, `katalog: ${hulls.length} kadłubów`);
  const { resolvePlayerEditorKey, env } = loadEditorKeyFns();
  const editorShips = SHIP_EDITOR_DEFAULTS.ships;
  for (const { id, shipFrame } of hulls) {
    env.player.shipFrame = shipFrame;
    env.ship.activeHullId = id;
    const key = resolvePlayerEditorKey();
    assert.ok(editorShips[key], `${id}: klucz ${key} jest w edytorze`);
    if (EXPECTED[id]) assert.equal(key, EXPECTED[id], `${id} (rama ${shipFrame})`);
    // To samo z jawnie podanym kluczem (getPlayerEditorConfigFromStorage(preferredKey)).
    env.player.shipFrame = '';
    env.ship.activeHullId = '';
    assert.equal(resolvePlayerEditorKey(shipFrame), key, `${id}: preferredKey = rama`);
  }
});

test('klucz edytora: wpis zapisany w edytorze pod kluczem z przedrostkiem terran_ jest czytany', () => {
  const { getEditorHullConfigKeys, resolvePlayerEditorKey, env } = loadEditorKeyFns({ terran_carrier: { hardpoints: [{}] } });
  assert.deepEqual(getEditorHullConfigKeys('terran_carrier'), ['carrier', 'terran_carrier']);
  assert.deepEqual(getEditorHullConfigKeys('terran_battleship'), ['battleship', 'terran_battleship']);
  assert.deepEqual(getEditorHullConfigKeys('atlas'), ['atlas', 'player']);
  assert.deepEqual(getEditorHullConfigKeys('pirate_frigate'), ['pirate_frigate']);
  env.player.shipFrame = 'terran_carrier';
  env.ship.activeHullId = 'carrier';
  assert.equal(resolvePlayerEditorKey(), 'terran_carrier');
  // Atlas zapisany pod dawnym kluczem 'player' — rozwiązuje się na 'atlas' jak dawniej.
  const legacy = loadEditorKeyFns({ player: { hardpoints: [{}] } });
  legacy.env.player.shipFrame = 'atlas';
  assert.equal(legacy.resolvePlayerEditorKey(), 'atlas');
});
