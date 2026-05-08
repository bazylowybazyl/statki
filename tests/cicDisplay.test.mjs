import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis.window || {};

const {
  getCicEntityHullMetrics,
  getCicPlacementGhostPalette
} = await import('../src/ui/cicDisplay.js');

test('CIC hull metrics preserve sprite footprint for RTS ghosts', () => {
  const source = { width: 256, height: 512 };
  const entity = {
    renderSpriteImage: source,
    spriteW: 256,
    spriteH: 512,
    w: 220,
    h: 440,
    visual: { spriteScale: 1.25 }
  };

  const metrics = getCicEntityHullMetrics(entity, 0.5);

  assert.equal(metrics.worldW, 275);
  assert.equal(metrics.worldH, 550);
  assert.equal(metrics.drawW, 137.5);
  assert.equal(metrics.drawH, 275);
});

test('CIC RTS placement ghost palette uses a translucent silhouette body', () => {
  const player = getCicPlacementGhostPalette({ player: true });
  const wingman = getCicPlacementGhostPalette({ player: false });

  assert.match(player.body, /rgba/);
  assert.match(player.accent, /rgba/);
  assert.notEqual(player.body, wingman.body);
  assert.notEqual(player.accent, wingman.accent);
});
