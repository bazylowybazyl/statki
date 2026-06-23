import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAsteroidScanDetails,
  buildScannerContact,
  buildStationDirectoryContacts,
  getTargetRadius,
  getTargetX,
  getTargetY,
  isAsteroidTarget,
  isLockableTarget,
  isTargetWithinSensorRange,
  refreshScannerContactDistances,
  resolveShipSensors,
  selectNearestAsteroidTargets,
  sortScannerSweepContacts,
  sortScannerContacts
} from '../src/game/scannerTargeting.js';
import {
  CAPITAL_SHIP_TEMPLATES,
  SHIPS,
  SUPPORT_SHIP_TEMPLATES
} from '../src/data/ships.js';

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

test('scanner contact distances refresh against current ship position', () => {
  const target = { id: 'pir-1', x: 1000, y: 0, dead: false, friendly: false };
  const contact = buildScannerContact({ target, type: 'ship', tone: 'hostile', distance: 1000 });
  const contacts = [contact];

  assert.equal(refreshScannerContactDistances(contacts, { pos: { x: 250, y: 0 } }), 1);
  assert.equal(contact.distance, 750);

  target.x = 1250;
  assert.equal(refreshScannerContactDistances(contacts, { pos: { x: 250, y: 0 } }), 1);
  assert.equal(contact.distance, 1000);
  assert.equal(contacts[0], contact);
});

test('station directory contacts match nearest CapsLock station nodes', () => {
  const stations = [
    { id: 'mars', planet: { name: 'Mars' }, x: 1800, y: 0 },
    { id: 'earth', planet: { name: 'Earth' }, x: 300, y: 0 },
    { id: 'venus', name: 'Venus Trade Ring', x: 900, y: 0 },
    { id: 'jupiter', planet: { name: 'Jupiter' }, x: 2600, y: 0 }
  ];

  const contacts = buildStationDirectoryContacts(stations, {
    ship: { pos: { x: 0, y: 0 } },
    limit: 3
  });

  assert.deepEqual(contacts.map(contact => contact.label), ['Earth', 'Venus Trade Ring', 'Mars']);
  assert.deepEqual(contacts.map(contact => contact.type), ['station', 'station', 'station']);
  assert.deepEqual(contacts.map(contact => contact.tone), ['station', 'station', 'station']);
  assert.deepEqual(contacts.map(contact => contact.classLabel), ['STACJA', 'STACJA', 'STACJA']);
  assert.deepEqual(contacts.map(contact => Math.round(contact.distance)), [300, 900, 1800]);
});

test('ship sensor stats scale up with combat hull size', () => {
  const fighter = SUPPORT_SHIP_TEMPLATES.fighter.sensors;
  const frigate = SUPPORT_SHIP_TEMPLATES.frigate_pd.sensors;
  const destroyer = SUPPORT_SHIP_TEMPLATES.destroyer.sensors;
  const battleship = SUPPORT_SHIP_TEMPLATES.battleship.sensors;
  const carrier = CAPITAL_SHIP_TEMPLATES.carrier.sensors;
  const atlas = CAPITAL_SHIP_TEMPLATES.supercapital.sensors;

  assert.ok(frigate.passiveRange > fighter.passiveRange);
  assert.ok(destroyer.passiveRange > frigate.passiveRange);
  assert.ok(battleship.passiveRange > destroyer.passiveRange);
  assert.ok(carrier.passiveRange > battleship.passiveRange);
  assert.ok(atlas.passiveRange > carrier.passiveRange);
  assert.equal(SHIPS.atlas.sensors.lockRange, atlas.lockRange);
});

test('long range combat sensors keep asteroid sweeps local', () => {
  const atlas = resolveShipSensors({ sensors: CAPITAL_SHIP_TEMPLATES.supercapital.sensors });

  assert.equal(atlas.activeRange, 90000);
  assert.equal(atlas.lockRange, 75000);
  assert.equal(atlas.asteroidScanRange, 18000);
  assert.ok(atlas.asteroidScanRange < atlas.activeRange);
});

test('sensor helper checks passive active and lock range separately', () => {
  const ship = {
    pos: { x: 0, y: 0 },
    sensors: {
      passiveRange: 80000,
      activeRange: 90000,
      lockRange: 75000,
      asteroidScanRange: 18000,
      scanWaveSpeed: 60000,
      role: 'combat'
    }
  };
  const target = { x: 76000, y: 0, dead: false, friendly: false };

  assert.equal(resolveShipSensors(ship).activeRange, 90000);
  assert.equal(resolveShipSensors(ship).scanWaveSpeed, 60000);
  assert.equal(resolveShipSensors(ship).asteroidScanRange, 18000);
  assert.equal(isTargetWithinSensorRange(ship, target, 'passiveRange'), true);
  assert.equal(isTargetWithinSensorRange(ship, target, 'activeRange'), true);
  assert.equal(isTargetWithinSensorRange(ship, target, 'lockRange'), false);
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
