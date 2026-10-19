import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORT_FACTIONS } from '../src/data/supportRoster.js';
import { SUPPORT_SHIP_TEMPLATES } from '../src/data/ships.js';

const root = process.cwd();
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// Panel F12 odchudzony 2026-10-19 (decyzja użytkownika): kredyty, spawn jednostek, zerowanie zapisu. Strojenie
// renderu do panelu nie wraca — obraz rysuje worker renderu, a panel działałby na Core3D strony (bez wpływu na obraz).
test('panel F12: tylko kredyty, spawn i zerowanie zapisu — bez paneli strojenia', () => {
  for (const rel of ['src/ui/bloomTunerPanel.js', 'src/ui/cameraTunerPanel.js']) {
    assert.equal(existsSync(join(root, rel)), false, `${rel} usunięty`);
  }
  assert.doesNotMatch(read('index.html'), /bloomTunerPanel|cameraTunerPanel|initBloomTunerPanel|initCameraTunerPanel/);

  const panel = read('src/ui/devTools.js');
  // Bez importów renderu i gry: panel woła tylko globalne API gry (DevEconomy, spawnCallInShip, callServiceTug, …).
  const imports = [...panel.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../data/supportRoster.js']);
  for (const id of ['dt-add-credits-btn', 'dt-spawn-pirate-fleet-btn', 'dt-spawn-enemy-fighters-btn',
    'dt-spawn-support-fleet-btn', 'dt-spawn-unit-btn', 'dt-reset-save-btn']) {
    assert.match(panel, new RegExp(`id="${id}"`), id);
  }
  // Dawne martwe sekcje i haki (suwaki świata, oświetlenie Ziemi, HUD, Performance, panele, teleport) — nie wracają.
  assert.doesNotMatch(panel, /DevConfig|earthLight|hudOffsets|Core3DPerf|RingColors|__destructorPanel|__bloomPanel|devTeleportToPirateStation|setStationScale|localStorage\.setItem/);
});

// Lista spawnu F12 = karty Rezerwy kokpitu (src/data/supportRoster.js). Każda karta musi dać się wezwać przez
// spawnCallInShip (index.html): lotniskowce, supercapitale, Atlas, megafrachtowiec i holownik mają własne gałęzie,
// kadłuby cywilne — DEV_HULL_SPAWNS, reszta — szablony SUPPORT_SHIP_TEMPLATES.
test('karty Rezerwy (kokpit i F12): każdy klucz ma ścieżkę spawnu', () => {
  const html = read('index.html');
  const call = html.match(/function spawnCallInShip\(templateKey, opts = \{\}\) \{[\s\S]*?\r?\n {4}\}/)?.[0] || '';
  assert.ok(call, 'spawnCallInShip w index.html');
  const special = new Set([...call.matchAll(/templateKey === '([^']+)'/g)].map((m) => m[1]));
  const devHulls = html.match(/const DEV_HULL_SPAWNS = Object\.freeze\(\{([\s\S]*?)\r?\n {4}\}\);/)?.[1] || '';
  const devHullKeys = new Set([...devHulls.matchAll(/^\s*'?([\w-]+)'?: \{/gm)].map((m) => m[1]));
  assert.ok(special.has('service_tug') && devHullKeys.has('freighter-small'), 'gałęzie spawnu odczytane z index.html');

  const missing = [];
  for (const [factionId, faction] of Object.entries(SUPPORT_FACTIONS)) {
    assert.ok(['friendly', 'pirate', 'dummy'].includes(faction.mode), `${factionId}: strona wezwania`);
    for (const { key } of faction.roster) {
      if (!special.has(key) && !devHullKeys.has(key) && !SUPPORT_SHIP_TEMPLATES[key]) missing.push(`${factionId}:${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
