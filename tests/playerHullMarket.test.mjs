import test from 'node:test';
import assert from 'node:assert/strict';

import { SHIPS } from '../src/data/ships.js';
import {
  PLAYER_HULL_MARKET,
  PLAYER_HULL_MARKET_ORDER,
  getPlayerHullMarketEntry
} from '../src/data/playerHullMarket.js';

test('hangar market exposes every playable ship frame exactly once', () => {
  assert.equal(new Set(PLAYER_HULL_MARKET_ORDER).size, PLAYER_HULL_MARKET_ORDER.length);
  assert.deepEqual(
    new Set(PLAYER_HULL_MARKET_ORDER),
    new Set(Object.keys(PLAYER_HULL_MARKET))
  );

  const marketFrames = new Set(Object.values(PLAYER_HULL_MARKET).map(entry => entry.shipFrame));
  assert.deepEqual(marketFrames, new Set(Object.keys(SHIPS)));
});

test('balanced hull prices rise with capability while captured pirate hulls stay cheaper', () => {
  const cost = id => getPlayerHullMarketEntry(id)?.cost;

  assert.equal(cost('atlas'), 0);
  assert.ok(cost('frigate') < cost('destroyer'));
  assert.ok(cost('destroyer') < cost('battleship'));
  assert.ok(cost('battleship') < cost('carrier'));
  assert.ok(cost('carrier') < cost('megafreighter'));
  assert.ok(cost('megafreighter') < cost('supercapital'));

  assert.ok(cost('pirate_frigate') < cost('frigate'));
  assert.ok(cost('pirate_destroyer') < cost('destroyer'));
  assert.ok(cost('pirate_battleship') < cost('battleship'));
});

test('megafreighter is a purchasable industrial capital frame', () => {
  const entry = getPlayerHullMarketEntry('MEGAFREIGHTER');
  assert.equal(entry.shipFrame, 'megafreighter');
  assert.equal(entry.tier, 'industrial-capital');
  assert.ok(entry.cost > 0);
});
