import test from 'node:test';
import assert from 'node:assert/strict';

import { DestructorSystem as D, DESTRUCTOR_CONFIG as C, disposeHexBody } from '../src/game/destructor.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';
import { runElasticScene } from './helpers/elasticScene.mjs';

// simulateElasticity po liście heksów w ruchu (DESTRUCTOR_CONFIG.elasticActiveList)
// musi dawać wynik IDENTYCZNY z pełną iteracją — bit w bit, łącznie z -0.

const bitsEqual = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)
  .equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

test('lista aktywnych = pełna iteracja: taran, pchnięcia i 39 trafień, stan heksów bit w bit', () => {
  const full = runElasticScene({ elasticActiveList: 0 });
  const list = runElasticScene({ elasticActiveList: 1 });
  assert.ok(full.impacts > 20, `za mało trafień: ${full.impacts}`);
  assert.equal(list.shards.length, full.shards.length);
  let moving = 0;
  for (let e = 0; e < full.shards.length; e++) {
    assert.ok(bitsEqual(list.shards[e], full.shards[e]), `kadłub ${e}: stan heksów różni się od pełnej iteracji`);
    const a = full.shards[e];
    for (let i = 0; i < a.length; i += 11) if (!(a[i] * a[i] + a[i + 1] * a[i + 1] < 0.01)) moving++;
  }
  assert.ok(moving > 100, `scena ma mieć heksy w ruchu (jest ${moving})`);
});

function withElasticMode(mode, fn) {
  const prev = C.elasticActiveList;
  C.elasticActiveList = mode;
  try { return fn(); } finally { C.elasticActiveList = prev; }
}

test('siatka w spoczynku ma pustą listę, lokalne wgniecenie — krótką', () => {
  withElasticMode(1, () => {
    const calm = hull({ width: 160, height: 60 });
    const dented = hull({ width: 240, height: 110, x: 2000 });
    try {
      D.simulateElasticity([calm, dented], 1 / 60);
      assert.equal(calm.hexGrid._elasticMarkCount, 0, 'nietknięty kadłub: nic do liczenia');

      const s = dented.hexGrid.shards[0];
      s.targetDeformation.x = 3;
      dented.hexGrid._elasticRescan = true; // zapis spoza haków — zgłoszony jawnie
      D.wakeHexEntity(dented, 20);
      D.simulateElasticity([dented], 1 / 60);
      const marked = dented.hexGrid._elasticMarkCount;
      assert.ok(marked > 0 && marked < 30, `lokalne wgniecenie znaczy okolicę, nie cały kadłub (${marked} z ${dented.hexGrid.shards.length})`);
    } finally {
      disposeHexBody(calm);
      disposeHexBody(dented);
    }
  });
});

test('trafienie znaczy heksy przez hak, bez rescanu', () => {
  withElasticMode(1, () => {
    const e = hull({ width: 160, height: 60 });
    try {
      D.simulateElasticity([e], 1 / 60); // przygotuj znaczniki
      assert.equal(e.hexGrid._elasticMarkCount, 0);
      D.applyImpact(e, e.x - 40, e.y, 200, { x: 2000, y: 0 });
      assert.equal(e.hexGrid._elasticRescan, false, 'uszkodzenie idzie przez noteElasticShard, nie przez rescan');
      assert.ok(e.hexGrid._elasticMarkCount > 0, 'heksy wgniecione trafieniem są na liście');
    } finally {
      disposeHexBody(e);
    }
  });
});

test('znaczniki przeżywają sen siatki, nowa tablica shards i naprawa wymuszają rescan', () => {
  withElasticMode(1, () => {
    const e = hull({ width: 160, height: 60 });
    try {
      D.applyImpact(e, e.x, e.y, 250, { x: 0, y: 2500 });
      D.simulateElasticity([e], 1 / 60);
      const before = e.hexGrid._elasticMarkCount;
      assert.ok(before > 0);
      e.hexGrid.isSleeping = true;
      e.hexGrid.wakeHoldFrames = 0;
      D.simulateElasticity([e], 1 / 60);
      assert.equal(e.hexGrid._elasticMarkCount, before, 'uśpiona siatka nie gubi listy');

      // Nowa tablica (split, wrak z puli) — lista liczona od nowa po stanie heksów.
      e.hexGrid.isSleeping = false;
      e.hexGrid.shards = e.hexGrid.shards.slice();
      D.simulateElasticity([e], 1 / 60);
      assert.equal(e.hexGrid._elasticShardsRef, e.hexGrid.shards);

      e.hexGrid._elasticRescan = false;
      assert.equal(D.repair([e], 1 / 60), true, 'kadłub był wgnieciony — jest co naprawiać');
      assert.equal(e.hexGrid._elasticRescan, true, 'naprawa przepisuje wgniecenia hurtem');
    } finally {
      disposeHexBody(e);
    }
  });
});
