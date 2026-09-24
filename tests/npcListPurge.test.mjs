import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeFinishedNpcs } from '../src/game/npcListPurge.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

test('purgeFinishedNpcs: w miejscu, ta sama tablica, kolejność żywych bez zmian', () => {
  const a = { id: 'a' };
  const deadB = { id: 'b', done: true };
  const c = { id: 'c' };
  const deadD = { id: 'd', done: true };
  const e = { id: 'e' };
  const npcs = [a, deadB, c, deadD, e];
  const ref = npcs;
  const removed = [];
  assert.equal(purgeFinishedNpcs(npcs, n => n.done === true, n => removed.push(n)), 2);
  assert.equal(npcs, ref, 'window.npcs / GameState trzymają tę samą tablicę');
  assert.deepEqual(npcs.map(n => n.id), ['a', 'c', 'e']);
  assert.deepEqual(removed, [deadB, deadD]);
  assert.equal(purgeFinishedNpcs(npcs, n => n.done === true), 0);
  assert.equal(purgeFinishedNpcs([], () => true), 0);
});

test('index.html: z npcs wypada tylko martwy NPC misji po utworzeniu wraku', () => {
  const src = readIndexHtml();
  const ship = { isPlayer: true };
  const hulks = new Set();
  const finished = loadIndexFunction(src, 'function isFinishedMissionNpc(npc)', 'isFinishedMissionNpc', {
    ship,
    isBridgeHulk: (n) => hulks.has(n)
  });
  const hulk = { dead: true, mission: true, hexGrid: null };
  hulks.add(hulk);
  assert.equal(finished({ dead: true, mission: true, hexGrid: null }), true, 'wrak powstał, ciało zwolnione');
  assert.equal(finished({ dead: true, mission: true, hexGrid: {} }), false, 'ciało heksowe jeszcze żyje');
  assert.equal(finished({ dead: false, mission: true, hexGrid: null }), false);
  assert.equal(finished({ dead: true, mission: false, hexGrid: null }), false, 'cywil się odrodzi');
  assert.equal(finished({ dead: true, mission: true, hexGrid: null, isCargoVan: true }), false, 'frachtowiec sprząta rekord');
  assert.equal(finished(hulk), false, 'hulk po mostku');
  ship.dead = true;
  ship.mission = true;
  assert.equal(finished(ship), false, 'nigdy gracz');

  // Raz na klatkę, przed AI (npcStep), w physicsStep — nie w trakcie pętli po npcs.
  const physics = sliceFunction(src, 'function physicsStep(');
  const purgeAt = physics.indexOf('if (runFrameLogic) purgeFinishedNpcs(npcs, isFinishedMissionNpc, forgetPurgedNpc);');
  const npcStepAt = physics.indexOf('npcStep(dt, aiDbgEnabled');
  assert.ok(purgeAt > 0 && purgeAt < npcStepAt);
  assert.match(sliceFunction(src, 'function forgetPurgedNpc(npc)'), /Selection\.units\.delete\(npc\);/);
});
