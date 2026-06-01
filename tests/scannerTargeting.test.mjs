import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAsteroidScanDetails,
  buildScannerContact,
  getTargetRadius,
  getTargetX,
  getTargetY,
  isAsteroidTarget,
  isLockableTarget,
  selectNearestAsteroidTargets,
  sortScannerSweepContacts,
  sortScannerContacts
} from '../src/game/scannerTargeting.js';

test('asteroid targets expose world coordinates and scale radius', () => {
  const asteroid = { worldX: 120, worldY: 240, scale: 800, alive: true, type: 'iron', size: 'BIG' };
  assert.equal(isAsteroidTarget(asteroid), true);
  assert.equal(getTargetX(asteroid), 120);
  assert.equal(getTargetY(asteroid), 240);
  assert.equal(getTargetRadius(asteroid), 400);
});

test('neutral asteroids are lockable without being hostile', () => {
  const asteroid = { worldX: 1, worldY: 2, scale: 120, alive: true, type: 'ice', size: 'S' };
  const hostile = { x: 10, y: 20, radius: 30, dead: false, friendly: false };
  const friendly = { x: 10, y: 20, radius: 30, dead: false, friendly: true };
  assert.equal(isLockableTarget(asteroid), true);
  assert.equal(isLockableTarget(hostile), true);
  assert.equal(isLockableTarget(friendly), false);
});

test('scanner contacts sort by group priority then distance', () => {
  const contacts = [
    buildScannerContact({ target: { x: 0, y: 0, dead: false, friendly: false }, type: 'ship', tone: 'hostile', distance: 800 }),
    buildScannerContact({ target: { worldX: 0, worldY: 0, scale: 100, alive: true, type: 'iron', size: 'M' }, type: 'asteroid', tone: 'resource', distance: 200 }),
    buildScannerContact({ target: { x: 0, y: 0, dead: false, friendly: true }, type: 'ship', tone: 'friendly', distance: 50 })
  ];
  const sorted = sortScannerContacts(contacts);
  assert.deepEqual(sorted.map((c) => c.tone), ['hostile', 'resource', 'friendly']);
});

test('scanner sweep contacts reveal from nearest to farthest', () => {
  const nearAsteroid = { worldX: 0, worldY: 0, scale: 100, alive: true, type: 'crystal', size: 'BIG' };
  const farHostile = { x: 0, y: 0, dead: false, friendly: false };
  const midStation = { x: 0, y: 0, dead: false, type: 'station' };
  const sorted = sortScannerSweepContacts([
    buildScannerContact({ target: farHostile, type: 'ship', tone: 'hostile', distance: 900 }),
    buildScannerContact({ target: nearAsteroid, type: 'asteroid', tone: 'resource', distance: 120 }),
    buildScannerContact({ target: midStation, type: 'station', tone: 'station', distance: 500 })
  ]);

  assert.deepEqual(sorted.map((contact) => contact.distance), [120, 500, 900]);
  assert.equal(sorted[0].label, 'Crystal Asteroid');
});

test('asteroid scanner contacts use material names in labels', () => {
  const crystal = buildScannerContact({
    target: { worldX: 0, worldY: 0, scale: 100, alive: true, type: 'crystal', size: 'M' },
    type: 'asteroid',
    tone: 'resource',
    distance: 200
  });
  assert.equal(crystal.label, 'Crystal Asteroid');
  assert.equal(crystal.classLabel, 'M');
});

test('asteroid scan details include mass resource and motion data', () => {
  const details = buildAsteroidScanDetails({
    type: 'uran',
    size: 'L',
    mass: 120000,
    hp: 420,
    hpMax: 900,
    hardness: 0.74,
    resource: 'uranium',
    yield: 80,
    beltId: 'main',
    vx: 3,
    vy: 4,
    spin: 0.125
  });
  assert.deepEqual(details.rows.map((row) => row.name), [
    'Type', 'Size', 'Mass', 'Hull', 'Hardness', 'Resource', 'Yield', 'Belt', 'Velocity', 'Spin'
  ]);
  assert.equal(details.rows.find((row) => row.name === 'Velocity').amount, '5 u/s');
});

test('target helpers support ship station and asteroid positions', () => {
  assert.equal(getTargetX({ pos: { x: 7, y: 8 } }), 7);
  assert.equal(getTargetY({ pos: { x: 7, y: 8 } }), 8);
  assert.equal(getTargetRadius({ r: 90 }), 90);
});

test('nearest asteroid selector returns a bounded ordered set', () => {
  const asteroids = [
    { id: 'far', worldX: 900, worldY: 0, scale: 100, alive: true, type: 'iron' },
    { id: 'near', worldX: 100, worldY: 0, scale: 100, alive: true, type: 'ice' },
    { id: 'dead', worldX: 50, worldY: 0, scale: 100, alive: false, type: 'crystal' },
    { id: 'mid', worldX: 500, worldY: 0, scale: 100, alive: true, type: 'uran' },
    { id: 'nearer', worldX: 20, worldY: 0, scale: 100, alive: true, type: 'crystal' }
  ];

  const selected = selectNearestAsteroidTargets(asteroids, {
    centerX: 0,
    centerY: 0,
    limit: 3
  });

  assert.deepEqual(selected.map(entry => entry.asteroid.id), ['nearer', 'near', 'mid']);
  assert.deepEqual(selected.map(entry => Math.round(entry.distance)), [20, 100, 500]);
});
