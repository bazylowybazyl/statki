import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeFiles = [
  'index.html',
  'src/3d/hexShips3D.js',
  'src/game/destructor.js',
  'src/ui/destructorConfigPanel.js',
  'src/ui/devTools.js'
];

const removedTokens = [
  'shipDamagedSprite',
  'damagedImage',
  'damagedImg',
  'uDamagedTex',
  'damagedTexture',
  'armorThreshold',
  'aHPRatio'
];

test('damaged sprite pipeline is fully removed from runtime rendering', () => {
  for (const file of runtimeFiles) {
    const source = readFileSync(file, 'utf8');
    for (const token of removedTokens) {
      assert.equal(source.includes(token), false, `${file} still contains ${token}`);
    }
  }

  assert.equal(existsSync('assets/damaged.png'), false, 'legacy damaged sprite asset still exists');
});
