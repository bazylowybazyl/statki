import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

// Strażnik JEDNEJ ekonomii (E2, docs/PLAN-ekonomia-rynki.md § 3.2): gospodarka stacji, przewozy i ceny liczą się
// tylko w ruchu v2 (worker, most src/game/trafficBridge.js). Gra nie trzyma własnych magazynów, nie produkuje,
// nie wycenia z marżą doku i nie wozi towaru vanami. Zastępuje strażnik integracji vanów z dawnego
// scripts/tests/transitController.test.mjs (CARGO_DISPATCH_ENABLED = true), który pilnował starej ścieżki.

const ROOT = new URL('../', import.meta.url);
const src = readIndexHtml();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(m?js)$/.test(name)) out.push(path);
  }
  return out;
}

test('stara ekonomia usunięta: pliki i importy', () => {
  for (const file of ['src/game/cargoFleet.js', 'src/game/transitController.js']) {
    assert.equal(existsSync(new URL(file, ROOT)), false, `${file} nie wraca`);
  }
  const offenders = walk(new URL('src', ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    .filter(path => /from\s+['"][^'"]*(cargoFleet|transitController)\.js['"]/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, [], 'nikt w src/ nie importuje starej ekonomii');
  assert.ok(!/cargoFleet\.js|transitController\.js/.test(src), 'index.html nie importuje starej ekonomii');
});

test('index.html: bez starej produkcji, wyceny i vanów', () => {
  for (const name of [
    'updateStationEconomies', 'runStationEconomy', 'seedStationEconomies', 'getLocalBasePrice',
    'TRADE_BUY_MARGIN', 'TRADE_SELL_MARGIN', 'updateCargoFleet', 'planShipment', 'isCargoVan',
    'InfrastructureUI.ensureEconomy', 'Game.stationEconomy', 'warpRoutes', 'beginStationTransit'
  ]) {
    assert.ok(!src.includes(name), `index.html nie zawiera ${name}`);
  }
});

test('ruch v2 rusza bez flagi; ?trafficV2=0 to wyłącznik awaryjny', () => {
  assert.match(src, /trafficV2:\s*new URLSearchParams\(location\.search\)\.get\('trafficV2'\)\s*!==\s*'0'/);
  assert.match(src, /if \(DevFlags\.trafficV2\) \{\s*trafficV2 = initTrafficV2\(\);/);
  // Krok świata idzie z krokami fizyki, pojemności budynków przez most.
  assert.ok(src.includes('trafficV2.advance(steps * PHYS_DT)'));
  assert.ok(src.includes('if (trafficV2) syncTrafficV2Capacities(dt);'));
});

test('terminal czyta rynek z mostu, zmiany zapasu idą przez stockDelta', () => {
  const calls = [];
  const market = { resources: { steel: 50 }, capacity: { steel: 100 } };
  const bridge = {
    hasStation: id => id === 'earth',
    getEconomy: id => (id === 'earth' ? market : null),
    stockDelta: (id, bag, reason) => calls.push({ id, bag, reason })
  };
  const getTradeEconomy = loadIndexFunction(src, 'function getTradeEconomy(station)', 'getTradeEconomy', { trafficV2: bridge });
  assert.equal(getTradeEconomy({ id: 'earth' }), market);
  assert.equal(getTradeEconomy({ id: 'pirate-hideout' }), null, 'stacja spoza świata ruchu nie ma magazynu');
  assert.equal(loadIndexFunction(src, 'function getTradeEconomy(station)', 'getTradeEconomy', { trafficV2: null })({ id: 'earth' }), null,
    'wyłącznik ?trafficV2=0: brak rynku');

  const adjust = loadIndexFunction(src, 'function adjustStationStock(station, key, delta)', 'adjustStationStock', { trafficV2: bridge });
  adjust({ id: 'earth' }, 'steel', -10);
  adjust({ id: 'pirate-hideout' }, 'steel', 5);
  assert.deepEqual(calls, [{ id: 'earth', bag: { steel: -10 }, reason: 'player' }]);
  assert.equal(market.resources.steel, 50, 'gra nie pisze magazynu wprost — kopię zmienia most');

  const price = sliceFunction(src, 'function getTradePrice(station, key, side)');
  assert.ok(price.includes('resourcePrice(station, econ, key, { reputation: PLAYER.reputation })'), 'jeden model ceny: resourcePrice z reputacją');
});

test('infrastructureUI: budynki dają tylko pojemności, bez magazynu i produkcji', () => {
  const infra = readFileSync(new URL('src/ui/infrastructureUI.js', ROOT), 'utf8');
  assert.ok(!infra.includes('stationEconomy'), 'bez window.Game.stationEconomy');
  assert.ok(!infra.includes('ECONOMY_BUILDING_RULES') && !infra.includes('applyEconomyProduction'), 'bez produkcji');
  assert.ok(infra.includes('getCapacity: getStationCapacity'), 'pojemności dla mostu');
});
