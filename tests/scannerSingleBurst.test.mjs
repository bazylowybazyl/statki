import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('X starts one scanner burst without scheduling recurring waves', () => {
  const html = readFileSync('index.html', 'utf8');

  // X — akcja 'tgt.scan' (GameActions, warstwa wejścia — docs/PLAN-pad.md, etap 1); powtórzenia klawisza odcina
  // główny keydown na samym początku.
  assert.match(html, /window\.addEventListener\('keydown', e => \{\r?\n\s+if \(e\.repeat\) return;/);
  // Radar planet usunięty jako martwy kod (rozbiór index.html, 2026-08-23) — X tylko włącza skaner, nie przełącza.
  assert.match(html, /'tgt\.scan': \{\s*run\(ev\) \{[\s\S]{0,300}?setScannerActive\(true\);/);
  assert.doesNotMatch(html.slice(html.indexOf("'tgt.scan': {"), html.indexOf("'ui.cic': {")), /setScannerActive\(false\)|!scannerState\.active/);
  assert.match(html, /scanWaves\.length = 0;\s*triggerScanWave\(\{ reset: true \}\);\s*CICDisplay\.triggerHudRadarBurst\?\.\(\)/);
  assert.doesNotMatch(html, /scannerState\.pulseTimer/);
  assert.doesNotMatch(html, /getScannerRefreshInterval/);
});
