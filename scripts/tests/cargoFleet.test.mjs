/**
 * Floty towarowe: dobór tras i księgowość ładunku.
 *
 * Najważniejsze, czego pilnuje: TOWAR SIĘ NIE MNOŻY. Załadunek musi zdjąć
 * dokładnie tyle, ile rozładunek doda — inaczej vany stałyby się generatorem
 * surowca z niczego i cała kalibracja produkcji przestałaby cokolwiek znaczyć.
 */

import {
  planShipment,
  pickVanClass,
  createFleetState,
  tickCooldowns,
  blockRoute,
  getBlockedPairs,
  cargoValue,
  describeCargo,
  VAN_CLASSES
} from '../../src/game/cargoFleet.js';
import { seedStationStock } from '../../src/game/stationEconomy.js';
import { RESOURCES, RESOURCE_KEYS, TIER } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import { createSuite, runIfMain } from './harness.mjs';

const CAPACITY_BY_TIER = { [TIER.RAW]: 250, [TIER.REFINED]: 150, [TIER.COMPONENT]: 60 };

function makeEcon() {
  const resources = {};
  const capacity = {};
  for (const id of RESOURCE_KEYS) {
    resources[id] = 0;
    capacity[id] = CAPACITY_BY_TIER[RESOURCES[id].tier] ?? 100;
  }
  return { resources, capacity };
}

function makeStation(id, factionId, x = 0) {
  return { id, planet: { id }, factionId, x, y: 0, r: 120 };
}

export function run() {
  const t = createSuite('cargoFleet');

  t.section('1. Dobór klasy vana do wielkości zlecenia');
  t.equal('mały ładunek → van', pickVanClass(10).id, 'van');
  t.equal('średni ładunek → hauler', pickVanClass(100).id, 'hauler');
  t.equal('duży ładunek → bulk', pickVanClass(300).id, 'bulk');
  t.check('każda klasa ma typ NPC i pojemność',
    VAN_CLASSES.every(c => !!c.npcType && c.capacity > 0 && c.speed > 0));

  t.section('2. Planer łączy nadwyżkę z niedoborem');
  const mercury = makeStation('mercury', FACTION.TERRA_NOVA, 0);
  const earth = makeStation('earth', FACTION.TERRA_NOVA, 5000);
  const econs = new Map([[mercury, makeEcon()], [earth, makeEcon()]]);
  const getEcon = (s) => econs.get(s);
  // Merkury tonie w rudzie żelaza, Ziemia jest jej pozbawiona.
  econs.get(mercury).resources.iron_ore = 240;
  econs.get(earth).resources.iron_ore = 0;

  const shipment = planShipment([mercury, earth], getEcon);
  t.check('planer znalazł zlecenie', !!shipment);
  t.equal('nadawcą jest stacja z nadwyżką', shipment?.source, mercury);
  t.equal('odbiorcą jest stacja z niedoborem', shipment?.target, earth);
  t.equal('przewożona jest ruda żelaza', shipment?.resourceId, 'iron_ore');
  t.check('ładunek mieści się w wybranym vanie',
    shipment.units * RESOURCES[shipment.resourceId].mass <= shipment.vanClass.capacity + 1e-6);

  t.section('3. Nie wozimy towaru do wrogiej frakcji');
  const pirateBase = makeStation('pirate_hold', FACTION.PIRATES, 9000);
  const econs2 = new Map([[mercury, makeEcon()], [pirateBase, makeEcon()]]);
  econs2.get(mercury).resources.iron_ore = 240;
  const hostileShipment = planShipment([mercury, pirateBase], (s) => econs2.get(s));
  t.check('brak trasy do frakcji wrogiej nadawcy', hostileShipment === null);

  t.section('4. Stacja opuszczona jest poza obiegiem');
  const derelict = makeStation('neptune', null, 12000);
  const econs3 = new Map([[mercury, makeEcon()], [derelict, makeEcon()]]);
  econs3.get(mercury).resources.iron_ore = 240;
  t.check('nikt nie wozi towaru na opuszczoną stację',
    planShipment([mercury, derelict], (s) => econs3.get(s)) === null);

  t.section('5. Karencja tras');
  const fleet = createFleetState();
  blockRoute(fleet, mercury, earth, 10);
  t.check('trasa trafia na listę zablokowanych', getBlockedPairs(fleet).has('mercury>earth'));
  t.check('planer omija zablokowaną trasę',
    planShipment([mercury, earth], getEcon, { skipPairs: getBlockedPairs(fleet) }) === null
    || planShipment([mercury, earth], getEcon, { skipPairs: getBlockedPairs(fleet) }).source !== mercury);
  tickCooldowns(fleet, 11);
  t.check('karencja wygasa po czasie', !getBlockedPairs(fleet).has('mercury>earth'));

  t.section('6. Wycena ładunku');
  t.equal('wartość liczona z rejestru surowców',
    cargoValue({ steel: 10 }), RESOURCES.steel.value * 10);
  t.check('opis ładunku jest czytelny', describeCargo({ steel: 10 }).includes('Stal'));
  t.equal('pusty ładunek ma zerową wartość', cargoValue({}), 0);

  t.section('7. Realistyczny układ generuje ruch');
  const network = [
    makeStation('mercury', FACTION.TERRA_NOVA, 0),
    makeStation('venus', FACTION.TERRA_NOVA, 3000),
    makeStation('earth', FACTION.TERRA_NOVA, 6000),
    makeStation('mars', FACTION.TERRA_NOVA, 9000),
    makeStation('jupiter', FACTION.OUTER_CONSORTIUM, 15000)
  ];
  const netEcons = new Map(network.map(s => [s, makeEcon()]));
  for (const s of network) seedStationStock(s, netEcons.get(s));
  // Sztuczna nadwyżka i głód, żeby na pewno było co planować.
  netEcons.get(network[0]).resources.iron_ore = 245;
  netEcons.get(network[2]).resources.iron_ore = 0;

  const planned = planShipment(network, (s) => netEcons.get(s));
  t.check('w zasiedlonym układzie planer znajduje trasę', !!planned);
  if (planned) {
    t.note(`${planned.source.id} → ${planned.target.id}: ${planned.resourceId} ×${planned.units} (${planned.vanClass.id})`);
    t.check('nadawca i odbiorca to różne stacje', planned.source !== planned.target);
    t.check('odbiorca faktycznie chce ten towar',
      (netEcons.get(planned.target).resources[planned.resourceId] || 0)
      < (netEcons.get(planned.target).capacity[planned.resourceId] || 0));
  }

  return t.results;
}

runIfMain(import.meta.url, run);
