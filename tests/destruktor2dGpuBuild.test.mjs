// Szybki budowniczy kadłubów dema GPU (dema/destruktor2d-webgpu/build.js) musi dawać
// DOKŁADNIE tę samą konstrukcję co buildSpriteBeamStructure — inaczej porównanie
// fizyki CPU i GPU mierzyłoby dwie różne konstrukcje.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng } from '../scripts/webgpu/png.mjs';
import { buildSpriteBeamStructure } from '../src/game/beamSprite2D.js';
import { getHullRenderSize } from '../src/data/ships.js';
import { buildSpriteHullGpu, colorBeams } from '../dema/destruktor2d-webgpu/build.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const HULLS = {
  atlas: 'assets/capital_ship_rect_v1.png',
  pirate_battleship: 'src/assets/ships/piratebattleship.png',
  terran_carrier: 'src/assets/ships/terrancarrier.png'
};

function load(id) {
  const img = readPng(join(repo, HULLS[id]));
  const size = getHullRenderSize(id, img.width, img.height);
  return { img, size };
}

function compare(id, cellSize, frameStride = 2, bulkheadEvery = 8) {
  const { img, size } = load(id);
  const opts = { worldLength: size.w, cellsAlong: Math.max(4, Math.round(size.w / cellSize)), frameStride, bulkheadEvery };
  const cpu = buildSpriteBeamStructure(img, opts);
  const gpu = buildSpriteHullGpu(img, opts);
  const s = cpu.nodeStore, e = cpu.beamStore;
  assert.equal(gpu.nodeCount, s.count, 'liczba węzłów');
  assert.equal(gpu.beamCount, e.count, 'liczba belek');
  for (let i = 0; i < s.count; i++) {
    if (gpu.ox[i] !== s.ox[i] || gpu.oy[i] !== s.oy[i]) assert.fail(`pozycja węzła ${i}`);
    if (gpu.mass[i] !== s.mass[i] || gpu.hp[i] !== s.hp[i]) assert.fail(`masa/HP węzła ${i}`);
    if (gpu.surface[i] !== s.surface[i] || gpu.ix[i] !== s.ix[i] || gpu.iy[i] !== s.iy[i]) assert.fail(`siatka węzła ${i}`);
    if (gpu.beamCountPerNode[i] !== s.beamCount[i] || gpu.localBeamCount[i] !== s.localBeamCount[i] ||
      gpu.platingCount[i] !== s.platingCount[i]) assert.fail(`liczniki belek węzła ${i}`);
  }
  for (let k = 0; k < e.count; k++) {
    if (gpu.beamA[k] !== e.a[k] || gpu.beamB[k] !== e.b[k] || gpu.type[k] !== e.type[k]) {
      assert.fail(`belka ${k}: gpu ${gpu.beamA[k]}-${gpu.beamB[k]}/${gpu.type[k]} cpu ${e.a[k]}-${e.b[k]}/${e.type[k]}`);
    }
    if (gpu.rest[k] !== e.rest[k]) assert.fail(`długość belki ${k}`);
    if (gpu.restBridge[k] !== e.restBridge[k]) assert.fail(`most belki ${k}`);
  }
  assert.equal(gpu.stats.frames, cpu.stats.frames, 'wręgi');
  assert.equal(gpu.stats.bulkheads, cpu.stats.bulkheads, 'grodzie');
  assert.ok(Math.abs(gpu.totalMass - cpu.mass) < 1e-6 * cpu.mass, 'masa');
  assert.ok(Math.abs(gpu.invIzz - cpu.invInertia[8]) <= 1e-9 * cpu.invInertia[8], 'bezwładność z');
  assert.ok(Math.abs(gpu.radius - cpu.radius) < 1e-9, 'promień');
  return { gpu, cpu };
}

test('Atlas 120 komórek (15 j.): ta sama konstrukcja co buildSpriteBeamStructure', () => {
  compare('atlas', 15);
});

test('Atlas 90 i 240 komórek, rzadkie wręgi i grodzie', () => {
  compare('atlas', 20, 4, 14);
  compare('atlas', 7.5, 1, 5);
});

test('inne kadłuby (pancernik piracki, lotniskowiec) i konstrukcja bez wręgów i grodzi', () => {
  compare('pirate_battleship', 15);
  compare('terran_carrier', 15);
  compare('pirate_battleship', 15, 0, 0);
});

test('kolorowanie belek: żaden węzeł nie ma dwóch belek jednego koloru, siatka w ~8 kolorach', () => {
  const { gpu } = compare('atlas', 15);
  const { color, colors } = colorBeams(gpu.nodeCount, gpu.beamA, gpu.beamB, gpu.ix, gpu.iy);
  const seen = new Map();
  for (let e = 0; e < gpu.beamCount; e++) {
    for (const n of [gpu.beamA[e], gpu.beamB[e]]) {
      const key = n * 64 + color[e];
      assert.ok(!seen.has(key), `węzeł ${n} ma dwie belki koloru ${color[e]}`);
      seen.set(key, e);
    }
  }
  assert.ok(colors <= 16, `za dużo kolorów: ${colors}`);
});
