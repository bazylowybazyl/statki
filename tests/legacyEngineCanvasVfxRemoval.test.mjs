import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('player turning no longer emits legacy square canvas engine flashes', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const engine3d = await readFile(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /function\s+emitShipSideThrusterParticles\s*\(/);
  assert.doesNotMatch(html, /emitShipSideThrusterParticles\s*\(/);
  assert.match(engine3d, /EngineVfxSystem\.update\(visibleVfx\)/);
});
