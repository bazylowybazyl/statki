import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('X starts one scanner burst without scheduling recurring waves', () => {
  const html = readFileSync('index.html', 'utf8');

  assert.match(html, /if \(k === 'x'\) \{\s*if \(e\.repeat\) return;/);
  assert.match(html, /setScannerActive\(true\);[\s\S]{0,180}togglePlanetRadarVisibility\(true\)/);
  assert.match(html, /scanWaves\.length = 0;\s*triggerScanWave\(\{ reset: true \}\);\s*CICDisplay\.triggerHudRadarBurst\?\.\(\)/);
  assert.doesNotMatch(html, /scannerState\.pulseTimer/);
  assert.doesNotMatch(html, /getScannerRefreshInterval/);
});
