import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorSystem as D, DESTRUCTOR_CONFIG as C, disposeHexBody } from '../src/game/destructor.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';

// Drugi przebieg kolizji (collisionIterations = 2) liczy tylko pary z ciałem
// ruszonym przez kontakt. Wynik musi być IDENTYCZNY z pełnym przebiegiem —
// ta sama scena (taran + łańcuch pchnięć + ciała obok i daleko) liczona oboma
// trybami, z zaseedowaną losowością i zegarem.

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function runScene(refineMovedOnly) {
  const prevRefine = C.collisionRefineMovedOnly;
  const prevRandom = Math.random;
  const prevTick = D._tick;
  const prevSimTime = D._simulationTime;
  const prevQuery = D._queryBroadphase;
  let clock = 1000;
  C.collisionRefineMovedOnly = refineMovedOnly;
  Math.random = seeded(1234);
  Object.defineProperty(performance, 'now', { value: () => clock, configurable: true, writable: true });
  D._tick = 0;
  D._simulationTime = 0;
  let queries = 0;
  D._queryBroadphase = function countingQuery(...args) {
    queries++;
    return prevQuery.apply(this, args);
  };

  const entities = [
    hull({ width: 160, height: 60, x: 0, y: 0, vx: 320, mass: 60000 }),
    hull({ width: 160, height: 60, x: 150, y: 0, mass: 60000 }),
    hull({ width: 160, height: 60, x: 300, y: 0, mass: 60000 }),
    hull({ width: 120, height: 50, x: 150, y: 420, vx: 30 }),
    hull({ width: 120, height: 50, x: 6000, y: 6000, vx: -25 }),
    hull({ width: 120, height: 50, x: -6000, y: 3000, vy: 40 })
  ];
  const dt = 1 / 120;
  let contacts = 0;
  try {
    for (let tick = 0; tick < 240; tick++) {
      for (const e of entities) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.angle += e.angVel * dt;
      }
      D.update(dt, entities);
      contacts += D.perf.lastContacts;
      if (tick % 2 === 0) D.updateVisuals(1 / 60, entities);
      clock += 1000 / 120;
    }
    const state = entities.map((e) => {
      let hp = 0;
      let deform = 0;
      for (const s of e.hexGrid.shards) {
        if (!s.active) continue;
        hp += s.hp;
        deform += Math.abs(s.deformation.x) + Math.abs(s.deformation.y);
      }
      return {
        x: e.x, y: e.y, vx: e.vx, vy: e.vy, angle: e.angle, angVel: e.angVel,
        active: e.hexGrid.activeStructuralCount, hp, deform
      };
    });
    return { state, contacts, queries };
  } finally {
    for (const e of entities) disposeHexBody(e);
    D._queryBroadphase = prevQuery;
    C.collisionRefineMovedOnly = prevRefine;
    Math.random = prevRandom;
    delete performance.now;
    D._tick = prevTick;
    D._simulationTime = prevSimTime;
  }
}

test('przebieg poprawkowy tylko dla ruszonych ciał daje wynik identyczny z pełnym', () => {
  const full = runScene(0);
  const refined = runScene(1);
  assert.ok(full.contacts > 0, 'scena musi mieć kontakty (taran i łańcuch pchnięć)');
  assert.ok(full.state[2].vx > 50, 'pchnięcie przeszło łańcuchem do trzeciego kadłuba');
  assert.deepEqual(refined.state, full.state);
  assert.equal(refined.contacts, full.contacts);
  assert.ok(refined.queries < full.queries, `zapytania broadphase: ${refined.queries} vs ${full.queries}`);
});

test('bez kontaktu w pierwszym przebiegu drugi nic nie liczy', () => {
  const prevQuery = D._queryBroadphase;
  const prevDocument = globalThis.document;
  const a = hull({ width: 100, height: 40, x: 0, y: 0, vx: 20 });
  const b = hull({ width: 100, height: 40, x: 3000, y: 0 });
  let queries = 0;
  D._queryBroadphase = function countingQuery(...args) {
    queries++;
    return prevQuery.apply(this, args);
  };
  try {
    D.update(1 / 120, [a, b]);
    assert.equal(D.perf.lastContacts, 0);
    assert.equal(queries, 2, 'tylko pierwszy przebieg: jedno zapytanie na ciało');
  } finally {
    D._queryBroadphase = prevQuery;
    disposeHexBody(a);
    disposeHexBody(b);
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
  }
});
