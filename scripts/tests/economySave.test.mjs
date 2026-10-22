/**
 * Gracz na rynku i zapis (E7): zapis ekonomii świata ruchu, wczytanie na świeży świat, oferta portu
 * dla kupca w buforze rynku i agregat komputera handlowego.
 *
 * Najważniejsze: to, co gracz zostawił w układzie (magazyny rynków, wyrwy w pasie, flota frakcji),
 * wraca po F5 — także na stacji gracza dokładanej po starcie — a stary albo obcy zapis nie wywraca
 * startu świata.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCE_KEYS } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import { createTrafficCore } from '../../src/game/traffic/trafficCore.js';
import { TRAFFIC_MSG, BELT_MSG, MARKET_FIELD, marketOffset } from '../../src/game/traffic/trafficProtocol.js';
import { stepTrafficWorld } from '../../src/game/traffic/trafficWorld.js';
import { recordExtraction } from '../../src/game/traffic/miningFields.js';
import { ECONOMY_SAVE_VERSION, isEconomySave } from '../../src/game/traffic/economySave.js';

const OPTS = { seed: 7, economyScale: 4, capacityMultiplier: 4, piracyPressure: 1, bubble: false };

function makeCore() {
  const inbox = [];
  const core = createTrafficCore(message => inbox.push(message));
  return { core, inbox };
}

function lastOf(inbox, type) {
  for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].type === type) return inbox[i];
  return null;
}

const PLAYER_DEF = {
  id: 'stacja-gracza', label: 'Stacja gracza', kind: 'player',
  position: { source: 'point', x: 9_000_000, y: 1_000_000 },
  factionId: FACTION.TERRA_NOVA,
  industry: { buildings: ['foundry'], size: 0.3 },
  docks: { layout: 'piers' }
};

export function run() {
  const t = createSuite('economySave');

  t.section('1. Zapis: magazyny, wyrwy, flota');
  const a = makeCore();
  a.core.handle({ type: TRAFFIC_MSG.INIT, ...OPTS });
  a.core.handle({ type: TRAFFIC_MSG.MARKET_ADD, def: PLAYER_DEF });
  const world = a.core.world;
  for (let i = 0; i < 120; i++) stepTrafficWorld(world);
  // Ślady gracza w świecie: handel na Ziemi, urobek w pasie, magazyn własnej stacji.
  a.core.handle({ type: TRAFFIC_MSG.STOCK, seq: 1, stationId: 'earth', bag: { steel: -400 } });
  a.core.handle({ type: TRAFFIC_MSG.STOCK, seq: 2, stationId: PLAYER_DEF.id, bag: { iron_ore: 777 } });
  // Punkt w paśmie pola (środek pola to Słońce — tam nie ma skał).
  const field = world.director.mining.defs.find(def => def.table) || world.director.mining.defs[0];
  const fr = (field.rMin + field.rMax) / 2;
  const fx = field.cx + Math.cos(field.angle || 0) * fr;
  const fy = field.cy + Math.sin(field.angle || 0) * fr;
  for (let i = 0; i < 20; i++) recordExtraction(world.director.mining, fx, fy, 50_000, 'player');
  const yards = world.shipyards.fleets;
  yards.set(FACTION.TERRA_NOVA, { frigate: 7, destroyer: 3 });

  a.core.handle({ type: TRAFFIC_MSG.ECONOMY_SAVE, requestId: 5 });
  const saved = lastOf(a.inbox, TRAFFIC_MSG.ECONOMY_SAVE_RESULT);
  const state = saved?.state;
  t.equal('odpowiedź niesie requestId', saved?.requestId, 5);
  t.check('zapis ma wersję i magazyny', isEconomySave(state) && state.version === ECONOMY_SAVE_VERSION);
  t.check('zapis przechodzi przez JSON', isEconomySave(JSON.parse(JSON.stringify(state))));
  t.check('zapis ma stację gracza', !!state.stations[PLAYER_DEF.id]);
  t.check('zapis ma rejestr pasa', state.mining.length > 0);
  t.equal('zapis ma flotę frakcji', state.fleets[FACTION.TERRA_NOVA]?.frigate, 7);

  t.section('2. Wczytanie na świeży świat (inne ziarno, stacja gracza po market-add)');
  const b = makeCore();
  b.core.handle({ type: TRAFFIC_MSG.INIT, ...OPTS, seed: 99, restore: JSON.parse(JSON.stringify(state)) });
  const ready = lastOf(b.inbox, TRAFFIC_MSG.READY);
  t.check('ready mówi, co przywrócono', ready?.restored?.stations > 20 && ready.restored.pending === 1);
  const before = b.core.world.getEconomy('earth');
  const zgodne = RESOURCE_KEYS.every(key => Math.abs((before.resources[key] || 0)
    - (state.stations.earth.stock[key] || 0)) < 0.01);
  t.check('magazyn Ziemi jak w zapisie', zgodne);
  t.check('wyrwy wracają z rejestru pasa', b.core.world.director.mining.holes.size > 0
    && b.core.world.director.mining.holes.size === world.director.mining.holes.size);
  const holesMsg = b.inbox.find(message => message.type === BELT_MSG.HOLES);
  t.check('wyrwy z zapisu idą do gry od razu po ready (przed krokiem świata)',
    holesMsg?.holes?.length === world.director.mining.holes.size);
  t.equal('flota frakcji wraca', b.core.world.shipyards.fleets.get(FACTION.TERRA_NOVA)?.destroyer, 3);
  b.core.handle({ type: TRAFFIC_MSG.MARKET_ADD, def: PLAYER_DEF });
  const own = b.core.world.getEconomy(PLAYER_DEF.id);
  t.check('stacja gracza dostaje magazyn po market-add', Math.abs((own?.resources.iron_ore || 0)
    - state.stations[PLAYER_DEF.id].stock.iron_ore) < 0.01);

  t.section('3. Stary albo obcy zapis nie wywraca startu');
  for (const [label, restore] of [
    ['obca wersja', { ...state, version: 999 }],
    ['śmieci', 'nie-zapis'],
    ['pusty obiekt', {}],
    ['nieznane stacje i towary', { ...state, stations: { atlantyda: { stock: { kryptonit: 5 } } }, mining: [['x']], fleets: { nikt: { czolg: 3 } } }]
  ]) {
    const c = makeCore();
    c.core.handle({ type: TRAFFIC_MSG.INIT, ...OPTS, restore });
    t.check(`${label}: świat wstaje`, !!lastOf(c.inbox, TRAFFIC_MSG.READY) && !lastOf(c.inbox, TRAFFIC_MSG.ERROR));
  }

  t.section('4. Oferta portu dla kupca w buforze rynku');
  for (let i = 0; i < 2; i++) stepTrafficWorld(world);
  a.core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 5 });
  const tick = lastOf(a.inbox, TRAFFIC_MSG.TICK);
  const stations = lastOf(a.inbox, TRAFFIC_MSG.READY).stations;
  const earthIndex = (tick.stations || stations).findIndex(entry => entry.id === 'earth');
  let sprzedaje = 0;
  let skupuje = 0;
  let nieUzywa = 0;
  let ponadZapas = false;
  for (let r = 0; r < RESOURCE_KEYS.length; r++) {
    const o = marketOffset(earthIndex, r, RESOURCE_KEYS.length);
    if (tick.market[o + MARKET_FIELD.SELL] > 0) sprzedaje++;
    if (tick.market[o + MARKET_FIELD.BUY] > 0) skupuje++;
    if (tick.market[o + MARKET_FIELD.BUY] === -1) nieUzywa++;
    if (tick.market[o + MARKET_FIELD.SELL] > tick.market[o + MARKET_FIELD.STOCK] + 1e-9) ponadZapas = true;
  }
  t.check('Ziemia coś sprzedaje i coś skupuje', sprzedaje > 0 && skupuje > 0);
  t.check('towar, którego port nie używa, ma skup −1 (terminal: „nie skupuje”)', nieUzywa > 0);
  t.check('oferta sprzedaży nie przekracza zapasu', !ponadZapas);

  t.section('5. Komputer handlowy: agregat na żądanie');
  a.core.handle({ type: TRAFFIC_MSG.TRADE_SUMMARY, requestId: 9 });
  const summary = lastOf(a.inbox, TRAFFIC_MSG.TRADE_SUMMARY_RESULT)?.summary;
  t.check('są trasy z ładunkiem', summary?.routes.length > 0 && summary.routes[0].tons > 0);
  t.check('trasy od najgęstszej', summary.routes.every((route, i, list) => i === 0 || list[i - 1].tons >= route.tons));
  t.check('porty mają pozycje i oferty', summary.ports.length > 20
    && summary.ports.every(port => Number.isFinite(port.x) && Array.isArray(port.buy) && Array.isArray(port.sell)));
  t.check('są okazje handlowe', summary.opportunities.length > 0);
  t.check('agregat przechodzi przez JSON', !!JSON.parse(JSON.stringify(summary)).totals);

  return t.results;
}

runIfMain(import.meta.url, run);
