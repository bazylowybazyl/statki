import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isFighterUnit,
  fighterPoint,
  clusterByProximity,
  computeFighterClouds,
  computeBattles,
  createRoll,
  stepRoll,
  rollingCells
} from '../src/game/fighterClouds.js';

test('isFighterUnit recognizes fighters and interceptors, ignores dead/others', () => {
  assert.equal(isFighterUnit({ fighter: true }), true);
  assert.equal(isFighterUnit({ type: 'fighter' }), true);
  assert.equal(isFighterUnit({ type: 'interceptor' }), true);
  assert.equal(isFighterUnit({ type: 'battleship' }), false);
  assert.equal(isFighterUnit({ fighter: true, dead: true }), false);
  assert.equal(isFighterUnit(null), false);
});

test('fighterPoint reads pos or x/y', () => {
  assert.deepEqual(fighterPoint({ pos: { x: 5, y: 7 } }), { x: 5, y: 7 });
  assert.deepEqual(fighterPoint({ x: 3, y: 4 }), { x: 3, y: 4 });
});

test('clusterByProximity groups nearby points and splits distant ones', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 60 }, // grupa A
    { x: 5000, y: 5000 }, { x: 5100, y: 5050 } // grupa B
  ];
  const clusters = clusterByProximity(pts, 400);
  assert.equal(clusters.length, 2);
  const sizes = clusters.map((c) => c.length).sort();
  assert.deepEqual(sizes, [2, 3]);
});

test('clusterByProximity single-linkage chains via intermediate points', () => {
  // Punkty w łańcuchu, każdy < linkDist od następnego, ale końce daleko.
  const pts = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 600, y: 0 }, { x: 900, y: 0 }];
  const clusters = clusterByProximity(pts, 400);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].length, 4);
});

test('clusterByProximity handles empty input', () => {
  assert.deepEqual(clusterByProximity([], 500), []);
  assert.deepEqual(clusterByProximity(null, 500), []);
});

test('computeFighterClouds separates teams even when overlapping', () => {
  const desc = [
    { x: 0, y: 0, team: 'friendly', selected: true },
    { x: 40, y: 10, team: 'friendly', selected: false },
    { x: 20, y: 20, team: 'enemy', selected: false },
    { x: 60, y: 5, team: 'enemy', selected: false }
  ];
  const { clouds } = computeFighterClouds(desc, { linkDist: 500 });
  assert.equal(clouds.length, 2);
  const friendly = clouds.find((c) => c.team === 'friendly');
  const enemy = clouds.find((c) => c.team === 'enemy');
  assert.equal(friendly.count, 2);
  assert.equal(friendly.selectedCount, 1);
  assert.equal(friendly.selected, true);
  assert.equal(enemy.count, 2);
  assert.equal(enemy.selected, false);
});

test('computeFighterClouds aggregates command target', () => {
  const desc = [
    { x: 0, y: 0, team: 'friendly', cmd: { x: 1000, y: 0, type: 'move' } },
    { x: 40, y: 0, team: 'friendly', cmd: { x: 1040, y: 0, type: 'move' } }
  ];
  const { clouds } = computeFighterClouds(desc, { linkDist: 500 });
  assert.equal(clouds.length, 1);
  assert.ok(clouds[0].cmd);
  assert.equal(clouds[0].cmd.x, 1020);
  assert.equal(clouds[0].cmd.type, 'move');
  assert.equal(clouds[0].cmd.share, 1);
});

test('computeBattles pairs engaged friendly and enemy clouds', () => {
  const desc = [
    { x: 0, y: 0, team: 'friendly' },
    { x: 50, y: 0, team: 'friendly' },
    { x: 400, y: 0, team: 'enemy' },
    { x: 450, y: 0, team: 'enemy' }
  ];
  const { clouds } = computeFighterClouds(desc, { linkDist: 300 });
  const { battles } = computeBattles(clouds, { engageDist: 1000 });
  assert.equal(battles.length, 1);
  assert.equal(battles[0].friendlyCount, 2);
  assert.equal(battles[0].enemyCount, 2);
  assert.ok(battles[0].separation > 0);
});

test('computeBattles ignores distant non-engaged clouds', () => {
  const desc = [
    { x: 0, y: 0, team: 'friendly' },
    { x: 100000, y: 0, team: 'enemy' }
  ];
  const { clouds } = computeFighterClouds(desc, { linkDist: 300 });
  const { battles } = computeBattles(clouds, { engageDist: 1000 });
  assert.equal(battles.length, 0);
});

test('computeBattles marks battle selected when a friendly cloud is selected', () => {
  const desc = [
    { x: 0, y: 0, team: 'friendly', selected: true },
    { x: 400, y: 0, team: 'enemy' }
  ];
  const { clouds } = computeFighterClouds(desc, { linkDist: 300 });
  const { battles } = computeBattles(clouds, { engageDist: 1000 });
  assert.equal(battles.length, 1);
  assert.equal(battles[0].selected, true);
});

test('stepRoll eases toward target and snaps when close', () => {
  const roll = createRoll(100);
  stepRoll(roll, 90, 0.016);
  assert.ok(roll.display < 100 && roll.display > 90, `got ${roll.display}`);
  for (let i = 0; i < 400; i++) stepRoll(roll, 90, 0.016);
  assert.equal(roll.display, 90);
});

test('rollingCells renders crisp digits at rest', () => {
  const { cells, frac } = rollingCells(99, 99);
  assert.equal(frac, 0);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].loDigit, 9);
  assert.equal(cells[1].loDigit, 9);
});

test('rollingCells flags only the changing digit mid-roll', () => {
  const { cells } = rollingCells(94.5, 90);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].rolling, false); // tens stays 9
  assert.equal(cells[1].rolling, true); // ones 4<->5 rolling
});

test('rollingCells keeps digit count stable across a carry', () => {
  const a = rollingCells(100, 100);
  assert.equal(a.digitCount, 3);
  const b = rollingCells(99, 99);
  assert.equal(b.digitCount, 2);
});
