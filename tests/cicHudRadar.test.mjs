import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};

// Model kontaktów mapy CIC (CICDisplay.update). Dawny mini-radar HUD-u (przemiatanie, rzut, rysunek)
// usunięty razem ze starym HUD-em 2026-10-19 — radar kokpitu ma własny tor (src/ui/radar/).
const { createCicHudRadarModel } = await import('../src/ui/cicDisplay.js');

function makeSensorSystem() {
  return {
    AWARENESS: { HIDDEN: 0, GHOST: 1, DETECTED: 2, TRACKED: 3 },
    getVisibility(entity) {
      return { awareness: entity._sensorAwareness ?? 0, sensorDist: entity._sensorDist ?? Infinity };
    },
    getGhosts() {
      return new Map([
        ['g1', { x: 0, y: -3000, type: 'destroyer', radius: 40, isCapital: false }]
      ]);
    }
  };
}

test('CIC HUD radar model exposes visible contacts, locks, and ghosts', () => {
  const ship = { pos: { x: 1000, y: 1000 } };
  const hostile = { id: 'pir-1', x: 3000, y: 1000, type: 'destroyer', radius: 44, _sensorAwareness: 3 };
  const friendly = { id: 'ally-1', x: 1000, y: 2500, type: 'frigate', friendly: true, radius: 32, _sensorAwareness: 3 };
  const hidden = { id: 'hidden', x: 1200, y: 1200, type: 'fighter', _sensorAwareness: 0 };

  const model = createCicHudRadarModel({
    ship,
    npcs: [hidden, hostile, friendly],
    SensorSystem: makeSensorSystem(),
    lockedTargets: [hostile],
    selectedTarget: friendly,
    range: 6000,
    sweepAngle: Math.PI / 2
  });

  assert.equal(model.range, 6000);
  assert.equal(model.sweepAngle, Math.PI / 2);
  assert.equal(model.contacts.length, 3);
  assert.equal(model.counts.hostile, 1);
  assert.equal(model.counts.friendly, 1);
  assert.equal(model.counts.ghost, 1);
  assert.equal(model.contacts.some(contact => contact.entity === hidden), false);

  const hostileContact = model.contacts.find(contact => contact.entity === hostile);
  assert.equal(hostileContact.locked, true);
  assert.equal(hostileContact.hostile, true);
  assert.equal(hostileContact.nx, 2000 / 6000);
  assert.equal(hostileContact.ny, 0);

  const friendlyContact = model.contacts.find(contact => contact.entity === friendly);
  assert.equal(friendlyContact.selected, true);
  assert.equal(friendlyContact.friendly, true);

  const ghostContact = model.contacts.find(contact => contact.isGhost);
  assert.equal(ghostContact.type, 'destroyer');
  assert.equal(ghostContact.hostile, true);
});

test('CIC HUD radar model keeps priority contacts inside max contact budget', () => {
  const ship = { pos: { x: 0, y: 0 } };
  const locked = { id: 'locked', x: 9000, y: 0, type: 'battleship', _sensorAwareness: 3 };
  const nearby = { id: 'nearby', x: 1000, y: 0, type: 'fighter', _sensorAwareness: 3 };

  const model = createCicHudRadarModel({
    ship,
    npcs: [nearby, locked],
    SensorSystem: makeSensorSystem(),
    lockedTargets: [locked],
    range: 10000,
    maxContacts: 1
  });

  assert.equal(model.contacts.length, 1);
  assert.equal(model.contacts[0].entity, locked);
  assert.equal(model.contacts[0].locked, true);
});

test('CIC HUD radar model includes nearby asteroids without marking them hostile', () => {
  const ship = { pos: { x: 100, y: 200 } };
  const asteroid = {
    id: 'ast-1',
    worldX: 1300,
    worldY: 200,
    type: 'iron',
    size: 'M',
    scale: 180,
    hp: 90,
    hpMax: 120,
    alive: true
  };
  const asteroidField = {
    queryRadius(cx, cy, radius) {
      assert.equal(cx, ship.pos.x);
      assert.equal(cy, ship.pos.y);
      assert.equal(radius, 5000);
      return [asteroid];
    }
  };

  const model = createCicHudRadarModel({
    ship,
    npcs: [],
    SensorSystem: makeSensorSystem(),
    asteroidField,
    range: 5000,
    maxContacts: 8
  });

  assert.equal(model.counts.asteroid, 1);
  assert.equal(model.counts.hostile, 0);

  const asteroidContact = model.contacts.find(contact => contact.isAsteroid);
  assert.ok(asteroidContact);
  assert.equal(asteroidContact.entity, asteroid);
  assert.equal(asteroidContact.type, 'asteroid');
  assert.equal(asteroidContact.subType, 'iron');
  assert.equal(asteroidContact.sizeClass, 'M');
  assert.equal(asteroidContact.nx, 1200 / 5000);
  assert.equal(asteroidContact.ny, 0);
});

test('CIC HUD radar model preserves real hull footprints and static world outlines', () => {
  const ship = { pos: { x: 1000, y: 2000 }, w: 1200, h: 420, angle: 0.25 };
  const capital = {
    id: 'capital-1',
    x: 5000,
    y: 2000,
    w: 1800,
    h: 640,
    angle: 0.75,
    type: 'supercapital',
    isCapitalShip: true,
    _sensorAwareness: 3
  };
  const worldFeatures = [{
    id: 'earth',
    type: 'planet',
    entity: { x: 30000, y: 2000 },
    radius: 37800,
    outerRadius: 43752,
    ring: { innerRadius: 41202, outerRadius: 43752, boundaries: [41810, 42418] }
  }];

  const model = createCicHudRadarModel({
    ship,
    npcs: [capital],
    SensorSystem: makeSensorSystem(),
    worldFeatures,
    range: 60000
  });

  assert.equal(model.originX, ship.pos.x);
  assert.equal(model.originY, ship.pos.y);
  assert.equal(model.worldFeatures, worldFeatures);
  assert.equal(model.playerHull.hullWorldW, 1200);
  assert.equal(model.playerHull.hullWorldH, 420);

  const contact = model.contacts.find(entry => entry.entity === capital);
  assert.ok(contact);
  assert.equal(contact.hullWorldW, 1800);
  assert.equal(contact.hullWorldH, 640);
  assert.equal(contact.angle, 0.75);
});
