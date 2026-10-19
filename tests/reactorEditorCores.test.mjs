import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BRIDGE_LAYOUT_PROPOSALS, bridgeZoneDistance, bridgeZoneMargin, normalizeBridgeList, validateBridgeLayout } from '../src/game/shipBridge.js';
import { getHullRenderSize, getWeaponTierForHull } from '../src/data/ships.js';
import { HULLS as DEMO_HULLS } from '../dema/rdzen-hulls-data.js';

// Markery rdzeni (reaktorów) z edytora hardpointów (`cores[]`) w grze na belkach: ReactorGame.attach
// bierze je tylko, gdy KAŻDY niesie promień `r` (src/game/reactorCoreGame.js, editorMarkersWithRadius) —
// dziś wygrywają miejsca z src/data/reactorCores.js. Dwie otwarte poprawki z docs/PORT-rdzen.md § 5
// (`todo` do zdjęcia przy wpięciu markerów edytora) i spójność miejsc rdzeni ze strefami mostków.
// Przeniesione 2026-10-19 z tests/shipCore.test.mjs — heksowy rdzeń (shipCore.js) usunięty razem
// z silnikiem heksów.

test('PORT poprawka 1 (TODO integracji): index.html nie skaluje rdzeni gracza z góry', { todo: 'dziś uśpiony błąd — odblokować przy wpięciu markerów edytora (docs/PORT-rdzen.md § 5)' }, () => {
  // buildPlayerDefaultEditorCores mnoży marker PNG przez skalę edytora gracza, a attachReactorCores
  // skaluje PNG → kadłub drugi raz: rdzeń gracza wylądowałby ×0,48 bliżej środka (Atlas).
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = src.indexOf('function buildPlayerDefaultEditorCores');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('\n    }\n', start));
  assert.doesNotMatch(body, /x\s*\*\s*scaleX|y\s*\*\s*scaleY/);
});

test('PORT poprawka 3 (TODO integracji): normalizeEditorCore zachowuje pola rdzenia', { todo: 'dziś wycina wszystko poza id/x/y — bez `r` markery edytora nigdy nie biorą góry' }, () => {
  const src = readFileSync(new URL('../src/game/npcHardpointRuntime.js', import.meta.url), 'utf8');
  const start = src.indexOf('function normalizeEditorCore');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /armorMul/);
});

// Reaktor przy środku masy, poza mostkami (docs/PORT-rdzen.md § 3). Komora (koło r) ma stać
// ≥ bridgeZoneMargin od każdej strefy KAŻDEGO wariantu — komórka należy albo do komory, albo do mostka.
// Miejsca z dema rdzenia (dema/rdzen-hulls-data.js) = miejsca gry (src/data/reactorCores.js).
test('rdzenie: komora poza strefami mostków we wszystkich wariantach', () => {
  for (const def of Object.values(DEMO_HULLS)) {
    const entry = BRIDGE_LAYOUT_PROPOSALS[def.editorKey];
    assert.ok(entry, `${def.id}: kadłub bez propozycji mostków — test nieaktualny`);
    const size = getHullRenderSize(def.renderProfile, def.pngWidth, def.pngHeight);
    const margin = bridgeZoneMargin(size.w / def.pngWidth, getWeaponTierForHull(def.renderProfile));
    for (const [variant, list] of Object.entries(entry.variants)) {
      for (const core of def.cores) {
        for (const z of normalizeBridgeList(list)) {
          const gap = bridgeZoneDistance(z, core.x, core.y) - core.r;
          assert.ok(gap >= margin, `${def.id}/${core.id} ↔ ${variant}/${z.id}: brzeg komory ${gap.toFixed(1)} px PNG od mostka (min ${margin.toFixed(1)})`);
        }
      }
      const issues = validateBridgeLayout(list, { cores: def.cores }, { margin }).filter((i) => i.kind === 'core');
      assert.deepEqual(issues, [], `${def.id}/${variant}`);
    }
  }
});
