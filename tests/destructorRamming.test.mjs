import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorSystem, DESTRUCTOR_CONFIG, disposeHexBody } from '../src/game/destructor.js';
import { makeDestructorHull } from './helpers/destructorHull.mjs';

function simulateRam({ speed = 400, mass = 50000, hz = 120, offset = 0, angle = 0, friendly = false } = {}) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const atlas = makeDestructorHull({
    width: 640, height: 180, mass: 800000, rammingMass: 800000,
    vx: speed * c, vy: speed * s, angle, shipFrame: 'atlas'
  });
  const target = makeDestructorHull({
    width: 320, height: 100, mass, angle, friendly,
    x: 480 * c - offset * s, y: 480 * s + offset * c
  });
  const entities = [atlas, target];
  const before = target.hexGrid.activeStructuralCount;
  const atlasBefore = atlas.hexGrid.activeStructuralCount;
  const dt = 1 / hz;
  let contacts = 0;
  let firstLost = null;
  try {
    for (let tick = 0; tick < hz * 3; tick++) {
      for (const e of entities) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.angle += e.angVel * dt;
      }
      DestructorSystem.update(dt, entities);
      contacts += DestructorSystem.perf.lastContacts;
      if (firstLost === null && DestructorSystem.perf.lastContacts > 0) {
        firstLost = before - target.hexGrid.activeStructuralCount;
      }
      if (tick % (hz / 60) === 0) DestructorSystem.updateVisuals(1 / 60, entities);
    }
    for (const e of entities) {
      for (const value of [e.x, e.y, e.vx, e.vy, e.angle, e.angVel]) assert.ok(Number.isFinite(value));
    }
    return {
      lost: (before - target.hexGrid.activeStructuralCount) / before,
      atlasLost: (atlasBefore - atlas.hexGrid.activeStructuralCount) / atlasBefore,
      advance: (atlas.x - target.x) * c + (atlas.y - target.y) * s + 480,
      targetSpeed: target.vx * c + target.vy * s,
      firstLost, contacts
    };
  } finally {
    disposeHexBody(atlas);
    disposeHexBody(target);
  }
}

test('disabled drift search cap still finds scaled hull contacts outside adjacent cells', () => {
  const previousMargin = DESTRUCTOR_CONFIG.searchRDriftMargin;
  const probe = (margin) => {
    DESTRUCTOR_CONFIG.searchRDriftMargin = margin;
    const small = makeDestructorHull({ width: 16, height: 16, vx: 50, visual: { spriteScale: 4 } });
    const holder = makeDestructorHull({ width: 80, height: 32, x: 90 });
    try {
      assert.equal(holder.hexGrid._maxHexDrift, 0);
      DestructorSystem._frameContacts = 0;
      DestructorSystem.collideEntities(small, holder, 1 / 120, false);
      return DestructorSystem._frameContacts;
    } finally {
      disposeHexBody(small);
      disposeHexBody(holder);
    }
  };
  try {
    const uncapped = probe(undefined);
    assert.ok(uncapped > 0, 'the scaled hex radii overlap');
    assert.equal(probe(null), uncapped, 'null must disable the cap, not become zero');
  } finally {
    DESTRUCTOR_CONFIG.searchRDriftMargin = previousMargin;
  }
});

for (const [name, mass, friendly] of [['pirate battleship', 50000, false], ['friendly capital', 100000, true]]) {
  test(`Atlas crushes an unshielded ${name} at ordinary speed without launching it away`, () => {
    const result = simulateRam({ mass, friendly, speed: 400 });
    assert.ok(result.contacts > 0);
    assert.equal(result.firstLost, 0, 'the contact layer dents before breaking');
    assert.ok(result.lost > 0.6, `sustained crush must break the contact layers: ${JSON.stringify(result)}`);
    assert.ok(result.atlasLost < 0.05, 'the massive rammer should retain its hull');
    assert.ok(result.advance > 160, `the bow must crush through at least half the lighter hull: ${JSON.stringify(result)}`);
    assert.ok(result.targetSpeed < 380, `the victim must not outrun the rammer: ${JSON.stringify(result)}`);
  });
}

test('boost produces more destruction than a slow push', () => {
  const slow = simulateRam({ speed: 80 });
  const boost = simulateRam({ speed: 1000 });
  assert.ok(slow.lost < 0.05, `gentle push: ${slow.lost}`);
  assert.ok(boost.lost > 0.8, `boosted ram: ${boost.lost}`);
});

test('ramming remains effective across physics step sizes and a rotated off-center contact', () => {
  const results = [60, 120, 240].map(hz => simulateRam({ hz }));
  const losses = results.map(result => result.lost);
  assert.ok(Math.min(...losses) > 0.6, JSON.stringify(results));
  assert.ok(Math.max(...losses) - Math.min(...losses) < 0.15, JSON.stringify(results));
  const rotated = simulateRam({ angle: Math.PI / 2, offset: 25 });
  assert.ok(rotated.lost > 0.6 && rotated.advance > 320, JSON.stringify(rotated));
});

test('an equally massive hull still stops Atlas instead of being overrun', () => {
  const result = simulateRam({ speed: 600, mass: 800000 });
  assert.ok(result.lost < 0.05, JSON.stringify(result));
  assert.ok(result.advance < 100, JSON.stringify(result));
  assert.ok(result.targetSpeed > 200 && result.targetSpeed < 400);
});

test('yielding contact impulses preserve momentum and solver-only passes do not damage hulls', () => {
  const atlas = makeDestructorHull({ width: 640, height: 180, mass: 800000, vx: 400 });
  const target = makeDestructorHull({ width: 320, height: 100, mass: 50000, x: 476 });
  try {
    DestructorSystem._frameContacts = 0;
    DestructorSystem.collideEntities(atlas, target, 1 / 120, false);
    assert.ok(DestructorSystem._frameContacts > 0);
    assert.ok(Math.abs(atlas.mass * atlas.vx + target.mass * target.vx - 800000 * 400) < 1e-5);
    assert.ok(Math.abs(atlas.mass * atlas.vy + target.mass * target.vy) < 1e-5);
    for (const e of [atlas, target]) {
      for (const shard of e.hexGrid.shards) assert.equal(shard.hp, shard.maxHp);
    }
  } finally {
    disposeHexBody(atlas);
    disposeHexBody(target);
  }
});

test('contact damage tuning also controls damage from yielding hulls', () => {
  const previousScale = DESTRUCTOR_CONFIG.contactDamageScale;
  const atlas = makeDestructorHull({ width: 640, height: 180, mass: 800000, vx: 600 });
  const target = makeDestructorHull({ width: 320, height: 100, mass: 50000, x: 476 });
  try {
    DESTRUCTOR_CONFIG.contactDamageScale = 0;
    DestructorSystem._frameContacts = 0;
    DestructorSystem.collideEntities(atlas, target, 1 / 120, true);
    assert.ok(DestructorSystem._frameContacts > 0);
    assert.ok(target.hexGrid.shards.some(s => Math.hypot(s.targetDeformation.x, s.targetDeformation.y) > 0));
    for (const e of [atlas, target]) {
      for (const shard of e.hexGrid.shards) assert.equal(shard.hp, shard.maxHp);
    }
  } finally {
    DESTRUCTOR_CONFIG.contactDamageScale = previousScale;
    disposeHexBody(atlas);
    disposeHexBody(target);
  }
});
