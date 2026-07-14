import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const filesToCheck = [
  'index.html',
  'src/ui/hudSystem.js',
  'src/ui/devTools.js'
];

const removedHexArmorTokens = [
  'HexArmorHUD',
  'hexHud',
  'hex-armor-container',
  'hex-armor-canvas',
  'dt-hud-hex-y',
  'hudHexY',
  'hexY'
];

test('legacy hex armor HUD widget is fully removed from runtime UI files', () => {
  for (const file of filesToCheck) {
    const source = readFileSync(file, 'utf8');
    for (const token of removedHexArmorTokens) {
      assert.equal(source.includes(token), false, `${file} still contains ${token}`);
    }
  }
});
