// Komputer handlowy E23a (src/game/tradePartners.js, TrafficBridge.findTradePartners): kto ile płaci w układzie strony.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findTradePartners, travelEstimate, playerTravelDrives, TRADE_PARTNER_TUNE, describeTradePartnerRow
} from '../src/game/tradePartners.js';
import { resourcePrice } from '../src/game/stationEconomy.js';
import { TrafficBridge } from '../src/game/trafficBridge.js';

function mirror(stock, capacity, buy, sell = 0) {
  return {
    resources: { ice: stock, workforce: 0 },
    capacity: { ice: capacity, workforce: 0 },
    duress: {},
    bid: { ice: 0 }, ask: { ice: 0 },
    buy: { ice: buy, workforce: 0 },
    sell: { ice: sell, workforce: 0 }
  };
}

// Cztery rynki na osi X od gracza w (0, 0): bliski tańszy, daleki droższy, „ma dość”, „nie skupuje”.
function makeView() {
  const stations = [
    { id: 'near', name: 'Bliski', factionId: 'terra_nova', x: 200_000, y: 0, kind: 'planet' },
    { id: 'far', name: 'Daleki', factionId: 'mars_yards', x: 9_000_000, y: 0, kind: 'planet' },
    { id: 'full', name: 'Pełny', factionId: 'terra_nova', x: 300_000, y: 0, kind: 'moon' },
    { id: 'nope', name: 'Bez skupu', factionId: 'terra_nova', x: 400_000, y: 0, kind: 'moon' },
    { id: 'pir', name: 'Kryjówka', factionId: 'pirates', x: 100_000, y: 0, kind: 'hideout' },
    { id: 'fog', name: 'We mgle', factionId: 'belt_union', x: 150_000, y: 0, kind: 'small-body' }
  ];
  const market = new Map([
    ['near', mirror(600, 1000, 300)],   // zapełnienie 60% — niższa cena
    ['far', mirror(50, 1000, 900)],     // 5% — wyższa cena
    ['full', mirror(950, 1000, 0)],
    ['nope', mirror(0, 0, -1)],
    ['pir', mirror(0, 1000, 500)],
    ['fog', mirror(10, 1000, 500)]
  ]);
  return { stations, market, ready: true };
}

const FROM = { x: 0, y: 0 };

test('cena i ilość jak w terminalu: bid z reputacją, zaokrąglony, skup z oferty portu', () => {
  const view = makeView();
  const reputation = { terra_nova: 60, mars_yards: -30 };
  const res = findTradePartners(view, 'ice', 'buy', { from: FROM, reputation, amount: 10_000, limit: 10 });
  for (const row of res.rows) {
    const entry = view.stations.find((s) => s.id === row.stationId);
    const econ = view.market.get(row.stationId);
    const terminal = Math.max(1, Math.round(resourcePrice(entry, econ, 'ice', { reputation }).bid));
    assert.equal(row.price, terminal, `cena ${row.stationId} jak getTradeOffer`);
    assert.equal(row.offer, econ.buy.ice, 'ile przyjmie — oferta skupu portu');
    assert.equal(row.take, Math.min(10_000, econ.buy.ice));
  }
  const near = res.rows.find((r) => r.stationId === 'near');
  assert.equal(near.standing.id, 'allied', 'stosunki z frakcją rynku');
  assert.equal(near.canDock, true);
});

test('„ma dość” i „nie skupuje” wypadają z listy, liczone osobno', () => {
  const res = findTradePartners(makeView(), 'ice', 'buy', { from: FROM, limit: 10 });
  const ids = res.rows.map((r) => r.stationId);
  assert.ok(!ids.includes('full') && !ids.includes('nope'));
  assert.equal(res.skipped.full, 1);
  assert.equal(res.skipped.notBuying, 1);
});

test('kryjówki i rynki we mgle wojny pominięte', () => {
  const view = makeView();
  const all = findTradePartners(view, 'ice', 'buy', { from: FROM, limit: 10 });
  assert.ok(!all.rows.some((r) => r.stationId === 'pir'), 'kryjówka to paser, nie rynek');
  assert.ok(all.rows.some((r) => r.stationId === 'fog'), 'bez mgły rynek widać');
  const fog = findTradePartners(view, 'ice', 'buy', { from: FROM, limit: 10, hidden: (st) => st.id === 'fog' });
  assert.ok(!fog.rows.some((r) => r.stationId === 'fog'));
  assert.equal(fog.skipped.hidden, 1);
  assert.equal(fog.skipped.hideout, 1);
});

test('kolejność: zysk na minutę lotu — bliski tańszy przed dalekim droższym, mała partia', () => {
  const view = makeView();
  view.market.delete('fog');
  const res = findTradePartners(view, 'ice', 'buy', { from: FROM, amount: 20, limit: 10 });
  const near = res.rows.find((r) => r.stationId === 'near');
  const far = res.rows.find((r) => r.stationId === 'far');
  assert.ok(far.price > near.price, 'daleki płaci więcej');
  assert.ok(far.seconds > near.seconds, 'i leci się dłużej');
  assert.equal(res.rows[0].stationId, 'near', 'przy małej partii droga przeważa');
  // Duża partia: daleki przyjmie 900, bliski 300 — zarobek dalekiego rośnie szybciej niż czas lotu.
  const big = findTradePartners(view, 'ice', 'buy', { from: FROM, amount: 900, limit: 10 });
  const scoreOf = (id) => big.rows.find((r) => r.stationId === id).score;
  assert.ok(big.rows.every((r, i) => i === 0 || big.rows[i - 1].score >= r.score), 'wynik malejąco');
  assert.equal(big.rows[0].stationId, scoreOf('far') > scoreOf('near') ? 'far' : 'near');
});

test('cena zakupu partii: stratne za zyskownymi, wrogi dok na końcu', () => {
  const view = makeView();
  view.market.delete('fog');
  const near0 = findTradePartners(view, 'ice', 'buy', { from: FROM, limit: 10 }).rows.find((r) => r.stationId === 'near');
  // Kupione drożej, niż płaci bliski — tam strata, daleki zarabia.
  const basis = near0.price + 1;
  const res = findTradePartners(view, 'ice', 'buy', { from: FROM, amount: 50, costBasis: basis, limit: 10 });
  assert.equal(res.rows[0].stationId, 'far');
  assert.ok(res.rows.find((r) => r.stationId === 'near').profit < 0);
  const hostile = findTradePartners(view, 'ice', 'buy', { from: FROM, amount: 50, limit: 10, reputation: { mars_yards: -100 } });
  assert.equal(hostile.rows.at(-1).stationId, 'far', 'Mars wrogi — dok zamknięty, ostatni');
  assert.equal(hostile.rows.at(-1).canDock, false);
  assert.equal(hostile.skipped.hostile, 1);
});

test('pusty rynek i kopia przed pierwszym buforem: „liczę…”, bez wierszy', () => {
  const empty = findTradePartners({ stations: [], market: new Map() }, 'ice', 'buy', { from: FROM });
  assert.equal(empty.pending, true);
  assert.equal(empty.rows.length, 0);
  const notYet = findTradePartners({ ...makeView(), ready: false }, 'ice', 'buy', { from: FROM });
  assert.equal(notYet.pending, true);
  const nobody = makeView();
  for (const m of nobody.market.values()) m.buy.ice = 0;
  const none = findTradePartners(nobody, 'ice', 'buy', { from: FROM });
  assert.equal(none.pending, false);
  assert.equal(none.rows.length, 0, 'nikt nie skupuje — lista pusta, nie „liczę…”');
  assert.equal(findTradePartners(makeView(), 'nie-ma-takiego', 'buy', {}).rows.length, 0);
});

test('strona sprzedaży: kto sprzeda najtaniej (ask, oferta sprzedaży)', () => {
  const view = makeView();
  view.market.get('near').sell.ice = 200;
  view.market.get('far').sell.ice = 100;
  const res = findTradePartners(view, 'ice', 'sell', { from: FROM, amount: 50, limit: 10 });
  assert.deepEqual(res.rows.map((r) => r.stationId).sort(), ['far', 'near']);
  const near = res.rows.find((r) => r.stationId === 'near');
  assert.equal(near.price, Math.max(1, Math.round(resourcePrice(view.stations[0], view.market.get('near'), 'ice', {}).ask)));
});

test('limit, pominięta stacja (terminal) i pozycja z gry', () => {
  const view = makeView();
  const res = findTradePartners(view, 'ice', 'buy', { from: FROM, limit: 1, excludeId: 'near' });
  assert.equal(res.rows.length, 1);
  assert.ok(!res.rows.some((r) => r.stationId === 'near'));
  const moved = findTradePartners(view, 'ice', 'buy', {
    from: FROM, limit: 10, positionOf: (id, out) => { if (id !== 'far') return null; out.x = 1000; out.y = 0; return out; }
  });
  assert.equal(Math.round(moved.rows.find((r) => r.stationId === 'far').distance), 1000);
  assert.match(describeTradePartnerRow(res.rows[0]), /CR ×/);
});

test('czas lotu z tabeli napędów: hipercruise na krótkich, warp na długich', () => {
  const drives = playerTravelDrives('hypercruise_mk1', 'warp_mk2', 'supercapital');
  const short = travelEstimate(20_000, drives, {});
  assert.equal(short.mode, 'hypercruise');
  const long = travelEstimate(5_000_000, drives, {});
  assert.equal(long.mode, 'warp');
  assert.ok(long.seconds > 5_000_000 / 175_000, 'warp z narzutem');
  const noWarp = travelEstimate(5_000_000, playerTravelDrives('hypercruise_mk1', null), {});
  assert.equal(noWarp.mode, 'hypercruise');
  assert.ok(noWarp.seconds > long.seconds);
});

test('most: wynik w pamięci do następnego bufora rynku albo zmiany gry', async () => {
  const bridge = new TrafficBridge();
  await bridge.init({ seed: 3, economyScale: 2, capacityMultiplier: 4, piracyPressure: 0 });
  assert.ok(bridge.marketBuffers > 0, 'rynek przyszedł z startem');
  const filters = { from: { x: 0, y: 0 }, amount: 100 };
  const a = bridge.findTradePartners('ice', 'buy', filters);
  assert.equal(a.pending, false);
  assert.ok(a.rows.length > 0 && a.rows.length <= TRADE_PARTNER_TUNE.limit, 'ktoś w Słońcu skupuje lód');
  assert.equal(bridge.findTradePartners('ice', 'buy', { ...filters, from: { x: 1000, y: 0 } }), a,
    'ruch w kubełku pozycji — ten sam wynik, bez nowego rachunku');
  const top = a.rows[0];
  // Terminal: ta sama kopia, ta sama cena.
  const econ = bridge.getEconomy(top.stationId);
  assert.equal(top.price, Math.max(1, Math.round(resourcePrice(bridge.getStation(top.stationId), econ, 'ice', {}).bid)));
  bridge.stockDelta(top.stationId, { ice: 5 });
  const b = bridge.findTradePartners('ice', 'buy', filters);
  assert.notEqual(b, a, 'sprzedaż gracza przelicza');
  bridge.dispose();
});
