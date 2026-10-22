import test from 'node:test';
import assert from 'node:assert/strict';
import { readIndexHtml, loadIndexFunction, sliceFunction } from './helpers/indexSource.mjs';
import { ECONOMY_SAVE_VERSION } from '../src/game/traffic/economySave.js';
import { INPUT_ACTIONS, KEYDOWN_ORDER, KEYBOARD_LAYOUT } from '../src/input/inputActions.js';
import { createCicTradeLayer, formatTons } from '../src/ui/cicTradeLayer.js';

// Gracz na rynku i zapis (E7): zapis ekonomii w grze (wersja, tolerancyjne wczytanie), klawisz komputera
// handlowego w CIC i sama warstwa handlu. Worker (zapis / wczytanie / oferta / agregat) —
// scripts/tests/economySave.test.mjs.

const src = readIndexHtml();

test('zapis ekonomii: ta sama wersja w grze i w workerze', () => {
  const match = src.match(/const ECONOMY_SAVE_VERSION = (\d+);/);
  assert.ok(match, 'index.html ma ECONOMY_SAVE_VERSION');
  assert.equal(Number(match[1]), ECONOMY_SAVE_VERSION);
  assert.ok(src.includes("economy: ['economy']"), '?reset czyści zapis ekonomii');
});

test('zapis ekonomii: brak, obca wersja i śmieci nie wywracają startu', () => {
  const store = new Map();
  const scope = {
    localStorage: { getItem: key => (store.has(key) ? store.get(key) : null) },
    ECONOMY_SAVE_KEY: 'economy',
    ECONOMY_SAVE_VERSION,
    console: { info() {}, warn() {} }
  };
  const load = loadIndexFunction(src, 'function loadEconomySave()', 'loadEconomySave', scope);
  assert.equal(load(), null, 'brak zapisu');
  store.set('economy', '{nie json');
  assert.equal(load(), null, 'śmieci');
  store.set('economy', JSON.stringify({ version: 999, world: { version: 999 } }));
  assert.equal(load(), null, 'obca wersja');
  const ok = { version: ECONOMY_SAVE_VERSION, world: { version: ECONOMY_SAVE_VERSION, stations: {} }, playerStations: [] };
  store.set('economy', JSON.stringify(ok));
  assert.deepEqual(load(), ok, 'zapis tej wersji');
});

test('nowa gra: gospodarka od zera, zapis tylko po wyborze przed startem', async () => {
  // Świat ruchu przy starcie strony jest zawsze świeży (bez `restore`), zapis nakłada loadEconomyIntoWorld.
  const init = sliceFunction(src, 'function initTrafficV2()');
  assert.ok(!/restore:/.test(init) && !init.includes('loadEconomySave'), 'initTrafficV2 nie wczytuje zapisu');
  // startGame: kasowanie przed pierwszym autozapisem, po sprawdzeniu WebGPU (bez gry zapis zostaje).
  const start = sliceFunction(src, 'async function startGame()');
  const at = start.indexOf('beginEconomySession();');
  assert.ok(at > start.indexOf('showWebGpuRequired()') && at < start.indexOf('gameStarted = true;'), 'startGame woła beginEconomySession');

  const removed = [];
  const scope = {
    localStorage: { removeItem: key => removed.push(key) },
    ECONOMY_SAVE_KEY: 'economy',
    economySessionLoaded: false,
    economySaveCache: { stare: true }
  };
  const begin = loadIndexFunction(src, 'function beginEconomySession()', 'beginEconomySession', scope);
  assert.equal(begin(), 'new');
  assert.deepEqual(removed, ['economy'], 'nowa gra kasuje zapis');
  assert.equal(scope.economySaveCache, null, '…i stan workera do zapisu');
  scope.economySessionLoaded = true;
  assert.equal(begin(), 'load', 'wczytany zapis zostaje');
  assert.equal(removed.length, 1);

  const restores = [];
  const founded = [];
  const saved = { version: ECONOMY_SAVE_VERSION, world: { version: ECONOMY_SAVE_VERSION, stations: {} },
    playerStations: [{ id: 'stacja-gracza-1', buildings: [] }] };
  const loadScope = {
    trafficV2: { restoreEconomy: state => { restores.push(state); return Promise.resolve({ stations: 3, mining: 0, fleets: 0 }); } },
    gameStarted: false,
    economySessionLoaded: false,
    economySaveCache: null,
    stations: [],
    loadEconomySave: () => saved,
    foundPlayerStation: entry => founded.push(entry.id),
    console: { info() {} }
  };
  const load = loadIndexFunction(src, 'function loadEconomyIntoWorld()', 'loadEconomyIntoWorld', loadScope);
  assert.deepEqual(await load(), { stations: 3, mining: 0, fleets: 0 });
  assert.equal(restores[0], saved.world, 'zapis idzie do workera');
  assert.deepEqual(founded, ['stacja-gracza-1'], 'stacje gracza z zapisu');
  assert.equal(loadScope.economySessionLoaded, true);
  assert.equal(await load(), null, 'drugi raz nic');
  loadScope.economySessionLoaded = false;
  loadScope.gameStarted = true;
  assert.equal(await load(), null, 'w trakcie gry nic');
  assert.equal(restores.length, 1);
});

test('komputer handlowy: H w CIC przed zwiadem i dronem', () => {
  assert.ok(INPUT_ACTIONS.some(action => action.id === 'cic.trade' && action.ctx.includes('cic')));
  assert.deepEqual(KEYBOARD_LAYOUT['cic.trade'], ['KeyH']);
  const order = KEYDOWN_ORDER;
  assert.ok(order.indexOf('cic.trade') >= 0 && order.indexOf('cic.trade') < order.indexOf('ship.scout')
    && order.indexOf('cic.trade') < order.indexOf('tgt.drone'), 'H w CIC nie odpala zwiadu ani drona');
  assert.ok(src.includes("'cic.trade': {") && src.includes('CICDisplay.toggleTrade()'));
});

test('warstwa handlu: dane na żądanie, rysunek tras i portów, panel', async () => {
  assert.equal(formatTons(840), '840 t');
  assert.equal(formatTons(2400), '2,4 kt');
  let calls = 0;
  const summary = {
    routes: [{ from: 'mercury', to: 'earth', courses: 12, tons: 2400, value: 9000, main: 'iron_ore' }],
    ports: [
      { id: 'mercury', name: 'Merkury', x: 0, y: 0, buy: [{ id: 'iron_ore', price: 9, units: 500 }], sell: [] },
      { id: 'earth', name: 'Ziemia', x: 1000, y: 0, buy: [], sell: [{ id: 'iron_ore', price: 14, units: 300 }] }
    ],
    resources: [{ id: 'iron_ore', tons: 2400 }],
    opportunities: [{ id: 'iron_ore', from: 'mercury', to: 'earth', units: 100, buy: 9, sell: 14, gross: 500 }],
    mining: { courses: 3, tons: 300 },
    totals: { courses: 12, routes: 1, tons: 2400 }
  };
  const layer = createCicTradeLayer({ request: () => { calls++; return Promise.resolve(summary); } });
  layer.update(0);
  assert.equal(calls, 0, 'wyłączona warstwa nie pyta workera');
  layer.setEnabled(true);
  layer.update(0);
  await Promise.resolve();
  await Promise.resolve();
  layer.update(100);
  assert.equal(calls, 1, 'następne pytanie dopiero po refreshMs');
  assert.equal(layer.stats().routes, 1);
  const ops = [];
  const ctx = new Proxy({}, {
    get: (target, prop) => (prop in target ? target[prop] : (...args) => ops.push(prop)),
    set: (target, prop, value) => { target[prop] = value; return true; }
  });
  globalThis.OffscreenCanvas ??= class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx; } };
  ctx.measureText = () => ({ width: 40 });
  layer.draw(ctx, 800, 600, (x, y) => ({ x: 100 + x * 0.5, y: 300 + y * 0.5 }));
  assert.ok(ops.includes('stroke') && ops.includes('drawImage'), 'trasa i podpisy');
  const bottom = layer.drawPanel(ctx, 800, 20, 430);
  assert.ok(bottom > 20, 'panel pod panelem CIC');
});
