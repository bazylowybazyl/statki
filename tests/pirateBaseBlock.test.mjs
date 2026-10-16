// RW-11c: blok migawki z klatką bazy piratów (src/render/blocks/pirateBaseBlock.js) — stan po stronie renderu = stan
// gry (storyBaseFrameState) w polach, które czyta updatePirateBase3D, przez rotację stron i zmianę liczby stanowisk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { applyPirateBaseBlock, createPirateBaseBlock, createPirateBaseMirror } from '../src/render/blocks/pirateBaseBlock.js';

function gameState(i) {
  const n = [0, 5, 40, 40, 130][i % 5];
  const s = {
    hidden: i % 3 === 0, habitatDead: i === 4, alarm: i % 2 === 1, bays: i % 2,
    berths: Array.from({ length: n }, (_, k) => ((k * 7 + i) % 3 === 0 ? 1 : 0)),
    habitat: 1 - i * 0.1, disc: 0.5 + i * 0.01, fuel: i * 0.2, warehouse: 1,
    sun: i === 2 ? null : { x: 4.5e6 + i, y: -2.25e6 - i, r: 9000 }
  };
  if (i === 3) s.daylight = 0.62;
  return s;
}

test('blok bazy piratów: stan renderu = stan gry (flagi, zasilanie, stanowiska, słońce, pora dnia, dt)', () => {
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createPirateBaseBlock());
  const frame = createSnapshotFrame();
  const mirror = createPirateBaseMirror();
  for (let i = 0; i < 10; i++) {
    const g = gameState(i);
    frame.pirateBase = g; frame.pirateBaseDt = i % 4 === 0 ? 0 : 1 / 60;
    packer.begin(frame);
    applyPirateBaseBlock(packer.view.blocks.pirateBase, mirror);
    packer.finish(frame);
    const m = mirror.state;
    assert.equal(mirror.present, true);
    assert.equal(mirror.dt, frame.pirateBaseDt);
    for (const k of ['hidden', 'habitatDead', 'alarm']) assert.equal(m[k], !!g[k], `${i}: ${k}`);
    for (const k of ['bays', 'habitat', 'disc', 'fuel', 'warehouse']) assert.ok(Object.is(m[k], g[k]), `${i}: ${k} ${m[k]} ≠ ${g[k]}`);
    assert.deepEqual(m.berths, g.berths, `${i}: stanowiska`);
    if (g.sun) assert.deepEqual([m.sun.x, m.sun.y], [g.sun.x, g.sun.y], `${i}: słońce`);
    else assert.equal(m.sun, null);
    assert.equal('daylight' in m, 'daylight' in g, `${i}: obecność daylight`);
    if ('daylight' in g) assert.equal(m.daylight, g.daylight);
  }
  frame.pirateBase = null;
  packer.begin(frame);
  applyPirateBaseBlock(packer.view.blocks.pirateBase, mirror);
  packer.finish(frame);
  assert.equal(mirror.present, false, 'bez stanu');
});

test('blok bazy piratów: wpięcie w grze (stan klatki i dt w fazie begin)', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /renderSnapshot\.addBlock\(createPirateBaseBlock\(\)\);/);
  assert.match(src, /f\.pirateBase = storyBaseFrameState\(\);\n\s+f\.pirateBaseDt = \(PAUSED \|\| StoryGame\.worldFrozen\) \? 0 : frameDt;/);
  assert.match(src, /updatePirateBase3D\(\(PAUSED \|\| StoryGame\.worldFrozen\) \? 0 : frameDt, storyBaseFrameState\(\)\);/);
});
