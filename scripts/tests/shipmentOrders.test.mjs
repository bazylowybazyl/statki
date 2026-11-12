/**
 * Zlecenia przewozu ruchu v2 (`src/game/traffic/shipmentOrders.js`): klasy ładowni,
 * karencja tras i księgowość ładunku.
 *
 * Najważniejsze, czego pilnuje: TOWAR SIĘ NIE MNOŻY. Załadunek zdejmuje dokładnie
 * tyle, ile rozładunek doda, a partia ma w każdej chwili jednego właściciela
 * (magazyn nadawcy → rekord przewoźnika → magazyn odbiorcy albo wrak).
 *
 * Do 2026-10-22 te same funkcje sprawdzały `cargoFleet.test.mjs` i `cargoTransit.test.mjs`
 * (razem ze starym planistą, zegarem analitycznym zleceń i widokiem vanów, które odeszły
 * ze starą ekonomią — E2).
 */

import {
  SHIPMENT_STATUS,
  SHIPMENT_OWNER_KIND,
  VAN_CLASSES,
  pickVanClass,
  createFleetState,
  createShipmentOrder,
  tryDeliverShipmentOrder,
  wreckShipmentOrder,
  tickCooldowns,
  blockRoute,
  getBlockedPairs,
  getShipmentOrder,
  getActiveShipmentOrders,
  shipmentOrderMass,
  shipmentOrderPlannedMass,
  validateShipmentRoute,
  validateShipmentOrder
} from '../../src/game/traffic/shipmentOrders.js';
import { getBagMass } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import { createSuite, runIfMain } from './harness.mjs';

function makeEcon(resources = {}, capacity = {}) {
  return { resources: { ...resources }, capacity: { ...capacity } };
}

function makeShipment(units = 10, resourceId = 'steel') {
  return {
    sourceStationId: 'earth',
    targetStationId: 'jupiter',
    factionId: FACTION.TERRA_NOVA,
    resourceId,
    units,
    vanClassId: 'van'
  };
}

function route(durationSeconds = 10) {
  return { id: 'earth-jupiter', from: 'earth', to: 'jupiter', mode: 'warp', length: 40000, durationSeconds };
}

function ledgerMass(source, target, order = null, wreck = null) {
  return getBagMass(source?.resources) + getBagMass(target?.resources)
    + shipmentOrderMass(order) + getBagMass(wreck);
}

function batchOwners(manifest, locations) {
  return Object.entries(locations)
    .filter(([, bag]) => Object.entries(manifest).every(([id, amount]) => (Number(bag?.[id]) || 0) >= amount))
    .map(([name]) => name);
}

function assertSingleBatchOwner(t, label, manifest, locations, expected) {
  const owners = batchOwners(manifest, locations);
  t.equal(`${label}: dokładnie jeden fizyczny owner`, owners.length, 1);
  t.equal(`${label}: owner jest właściwy`, owners[0], expected);
}

export function run() {
  const t = createSuite('shipmentOrders');

  t.section('1. Klasa ładowni dobierana do wielkości zlecenia');
  t.equal('mały ładunek → van', pickVanClass(10).id, 'van');
  t.equal('średni ładunek → hauler', pickVanClass(100).id, 'hauler');
  t.equal('duży ładunek → bulk', pickVanClass(300).id, 'bulk');
  t.equal('masówka → mega', pickVanClass(5000).id, 'mega');
  t.check('każda klasa ma typ NPC i pojemność',
    VAN_CLASSES.every(cls => cls.npcType && cls.capacity > 0 && cls.speed > 0));

  t.section('2. Karencja tras');
  const fleet = createFleetState();
  blockRoute(fleet, { id: 'mercury' }, { id: 'earth' }, 10);
  t.check('trasa trafia na listę zablokowanych', getBlockedPairs(fleet).has('mercury>earth'));
  tickCooldowns(fleet, 5);
  t.check('karencja trwa do końca', getBlockedPairs(fleet).has('mercury>earth'));
  tickCooldowns(fleet, 6);
  t.check('karencja wygasa po czasie', !getBlockedPairs(fleet).has('mercury>earth'));

  t.section('3. Pełna trasa jest warunkiem atomowego załadunku');
  const invalidState = createFleetState();
  const invalidSource = makeEcon({ steel: 50 }, { steel: 100 });
  t.equal('brak trasy odrzuca zlecenie',
    createShipmentOrder(invalidState, makeShipment(10), invalidSource, null), null);
  t.equal('brak trasy nie zmienia magazynu', invalidSource.resources.steel, 50);
  t.equal('brak trasy nie dopisuje rekordu', invalidState.orders.length, 0);
  t.equal('nieobsługiwany tryb trasy jest odrzucany', createShipmentOrder(invalidState, makeShipment(10), invalidSource, {
    from: 'earth', to: 'jupiter', mode: 'teleport', length: 40000
  }), null);
  t.equal('odrzucona trasa nie zdejmuje cargo', invalidSource.resources.steel, 50);
  t.equal('za mało towaru u nadawcy odrzuca zlecenie',
    createShipmentOrder(invalidState, makeShipment(60), invalidSource, route(5)), null);

  const disconnected = validateShipmentRoute({
    segments: [
      { from: 'earth', to: 'relay', mode: 'warp', length: 1000 },
      { from: 'venus', to: 'jupiter', mode: 'warp', length: 1000 }
    ]
  }, 'earth', 'jupiter');
  t.check('nieciągła ścieżka jest niepełna', !disconnected.valid && disconnected.errors.includes('segment-1-disconnected'));
  const fullRoute = validateShipmentRoute({
    id: 'inner-outer',
    segments: [
      { from: 'earth', to: 'relay', mode: 'warp', length: 12000 },
      { from: 'relay', to: 'jupiter', mode: 'warp', length: 28000 }
    ]
  }, 'earth', 'jupiter', { warpSpeed: 4000 });
  t.check('ciągła ścieżka jest pełna', fullRoute.valid);
  t.equal('czas pełnej ścieżki sumuje segmenty', fullRoute.route?.durationSeconds, 10);

  t.section('4. Rekord jest stabilnym, serializowalnym DTO');
  const dtoState = createFleetState();
  const dtoSource = makeEcon({ steel: 40 }, { steel: 100 });
  const first = createShipmentOrder(dtoState, makeShipment(10), dtoSource, route(12), { now: 7 });
  const second = createShipmentOrder(dtoState, makeShipment(5), dtoSource, route(8), { now: 7 });
  t.equal('pierwszy rekord ma stabilny ID', first?.id, 'shipment-000001');
  t.equal('kolejny rekord ma następny stabilny ID', second?.id, 'shipment-000002');
  t.equal('rekord trzyma wyłącznie ID source', first?.sourceStationId, 'earth');
  t.equal('rekord trzyma wyłącznie ID target', first?.targetStationId, 'jupiter');
  t.check('plannedManifest i cargo są osobnymi workami', first?.plannedManifest !== first?.cargo);
  t.equal('ETA jest w czasie świata', first?.eta, 19);
  t.equal('właścicielem jest logiczny carrier', first?.owner.kind, SHIPMENT_OWNER_KIND.CARRIER);
  t.close('zapamiętana masa pochodzi z resources.js', first?.plannedMass, getBagMass({ steel: 10 }));
  t.equal('załadunek zdjął towar u nadawcy', dtoSource.resources.steel, 25);
  const json = JSON.stringify(first);
  t.check('rekord przechodzi JSON round-trip', JSON.parse(json).id === first.id);
  t.check('rekord nie zawiera referencji stacji/warpa', !json.includes('fromRef') && !json.includes('toRef') && !json.includes('queues'));
  t.equal('lookup odnajduje rekord po ID', getShipmentOrder(dtoState, second.id), second);
  t.equal('oba rekordy są aktywne', getActiveShipmentOrders(dtoState).length, 2);
  t.check('nowy rekord spełnia ownership invariant', validateShipmentOrder(first).valid);
  const serialized = JSON.stringify(dtoState);
  t.check('indeksy runtime nie trafiają do zapisu',
    !serialized.includes('activeOrders') && !serialized.includes('cooldownPairs') && !serialized.includes('usedOrderIndex'));
  // Id z licznika, a nie z długości listy — po podmianie listy (wczytanie) indeks buduje się od nowa.
  dtoState.orders = JSON.parse(JSON.stringify(dtoState.orders));
  dtoState.nextOrderId = 1;
  const third = createShipmentOrder(dtoState, makeShipment(5), dtoSource, route(8), { now: 8 });
  t.equal('po podmianie listy id nie dubluje istniejących', third?.id, 'shipment-000003');

  t.section('5. Dostawa i overflow bez częściowego transferu');
  const deliverState = createFleetState();
  const deliverSource = makeEcon({ steel: 30 }, { steel: 100 });
  const deliverTarget = makeEcon({ steel: 0 }, { steel: 100 });
  const massBefore = ledgerMass(deliverSource, deliverTarget);
  const deliverOrder = createShipmentOrder(deliverState, makeShipment(20), deliverSource, route(10));
  t.close('załadunek zachowuje masę magazyn+tranzyt', ledgerMass(deliverSource, deliverTarget, deliverOrder), massBefore);
  const delivered = tryDeliverShipmentOrder(deliverOrder, deliverTarget, 10);
  t.check('rozładunek się udał', delivered.changed);
  t.equal('rekord jest dostarczony', deliverOrder.status, SHIPMENT_STATUS.DELIVERED);
  t.equal('odbiorca dostał cały manifest', deliverTarget.resources.steel, 20);
  t.equal('rekord nie ma drugiej kopii cargo', shipmentOrderMass(deliverOrder), 0);
  t.close('dostawa zachowuje masę', ledgerMass(deliverSource, deliverTarget, deliverOrder), massBefore);
  t.check('dostarczony rekord ma jednego właściciela', validateShipmentOrder(deliverOrder).valid);
  t.check('druga dostawa jest no-opem', !tryDeliverShipmentOrder(deliverOrder, deliverTarget, 11).changed);
  t.equal('druga dostawa nie dubluje towaru', deliverTarget.resources.steel, 20);

  const overflowState = createFleetState();
  const overflowSource = makeEcon({ steel: 10 }, { steel: 100 });
  const overflowTarget = makeEcon({ steel: 95 }, { steel: 100 });
  const overflowOrder = createShipmentOrder(overflowState, makeShipment(10), overflowSource, route(1));
  const overflowMass = ledgerMass(overflowSource, overflowTarget, overflowOrder);
  tryDeliverShipmentOrder(overflowOrder, overflowTarget, 1);
  t.equal('pełny magazyn ustawia awaitingUnload', overflowOrder.status, SHIPMENT_STATUS.AWAITING_UNLOAD);
  t.equal('target nie dostał częściowej porcji', overflowTarget.resources.steel, 95);
  t.equal('cały manifest pozostał w rekordzie', overflowOrder.cargo.steel, 10);
  t.close('overflow zachowuje masę', ledgerMass(overflowSource, overflowTarget, overflowOrder), overflowMass);
  t.check('awaitingUnload nadal ma jednego carriera', validateShipmentOrder(overflowOrder).valid);
  overflowTarget.resources.steel = 90;
  t.check('ponowiony rozładunek dostarcza całość', tryDeliverShipmentOrder(overflowOrder, overflowTarget, 2).changed);
  t.equal('magazyn odbiorcy pełny', overflowTarget.resources.steel, 100);

  t.section('6. Zniszczenie przenosi własność do wraku dokładnie raz');
  const wreckState = createFleetState();
  const wreckSource = makeEcon({ iron_ore: 20 }, { iron_ore: 100 });
  const wreckTarget = makeEcon({ iron_ore: 0 }, { iron_ore: 100 });
  const wreckOrder = createShipmentOrder(wreckState, makeShipment(12, 'iron_ore'), wreckSource, route(20));
  const wreckInventory = {};
  const beforeWreck = ledgerMass(wreckSource, wreckTarget, wreckOrder, wreckInventory);
  t.check('pierwsze zniszczenie zmienia rekord', wreckShipmentOrder(wreckOrder, 'wreck-77', wreckInventory, 3).changed);
  t.equal('status przechodzi do wreck', wreckOrder.status, SHIPMENT_STATUS.WRECK);
  t.equal('jedynym ownerem jest wskazany wrak', wreckOrder.owner.id, 'wreck-77');
  t.equal('jawny inventory dostał cały manifest', wreckInventory.iron_ore, 12);
  t.equal('rekord wyzerował fizyczne cargo po transferze', shipmentOrderMass(wreckOrder), 0);
  t.close('zniszczenie zachowuje masę', ledgerMass(wreckSource, wreckTarget, wreckOrder, wreckInventory), beforeWreck);
  t.check('drugie wywołanie jest idempotentne', !wreckShipmentOrder(wreckOrder, 'wreck-77', wreckInventory, 4).changed);
  t.equal('drugie wywołanie nie duplikuje wraku', wreckInventory.iron_ore, 12);
  t.check('wrak spełnia invariant rekordu', validateShipmentOrder(wreckOrder).valid);
  t.check('wraku nie da się dostarczyć', !tryDeliverShipmentOrder(wreckOrder, wreckTarget, 5).changed);

  // Ruch v2 rozbija kurs bez inventory (`wreck:<kurs>`) — cargo zostaje w rekordzie, właścicielem jest wrak.
  const retainedState = createFleetState();
  const retainedSource = makeEcon({ steel: 10 }, { steel: 100 });
  const retainedOrder = createShipmentOrder(retainedState, makeShipment(10), retainedSource, route(20));
  const retained = wreckShipmentOrder(retainedOrder, 'wreck-late');
  t.equal('bez inventory cargo zostaje w rekordzie', retained.retained.steel, 10);
  t.equal('logicznym ownerem jest wrak', retainedOrder.owner.kind, SHIPMENT_OWNER_KIND.WRECK);
  t.check('rekordowy wrak spełnia invariant', validateShipmentOrder(retainedOrder).valid);
  const lateInventory = {};
  wreckShipmentOrder(retainedOrder, 'wreck-late', lateInventory);
  t.equal('późniejsze inventory przejmuje cargo', lateInventory.steel, 10);
  t.equal('po podpięciu inventory rekord jest pusty', shipmentOrderMass(retainedOrder), 0);

  t.section('7. Walidator wykrywa niespójny zapis custody');
  const broken = JSON.parse(JSON.stringify(second));
  broken.owner = null;
  const brokenResult = validateShipmentOrder(broken);
  t.check('brak ownera unieważnia rekord', !brokenResult.valid);
  t.equal('brak ownera daje ownerCount=0', brokenResult.ownerCount, 0);
  const wrongOwner = JSON.parse(JSON.stringify(second));
  wrongOwner.owner = { kind: SHIPMENT_OWNER_KIND.STATION, id: 'earth' };
  t.check('aktywny transport nie może należeć do stacji', !validateShipmentOrder(wrongOwner).valid);
  t.close('plannedMass zgodne z manifestem', shipmentOrderPlannedMass(second), getBagMass({ steel: 5 }));

  t.section('8. Niezależny ledger widzi dokładnie jednego właściciela partii');
  const lot = { steel: 10 };
  const custodyState = createFleetState();
  const custodySource = makeEcon({ steel: 10 }, { steel: 100 });
  const custodyTarget = makeEcon({ steel: 0 }, { steel: 100 });
  const custodyWreck = {};
  assertSingleBatchOwner(t, 'przed dispatch', lot, {
    source: custodySource.resources, record: {}, target: custodyTarget.resources, wreck: custodyWreck
  }, 'source');
  const custodyOrder = createShipmentOrder(custodyState, makeShipment(10), custodySource, route(10));
  assertSingleBatchOwner(t, 'po dispatch', lot, {
    source: custodySource.resources, record: custodyOrder.cargo, target: custodyTarget.resources, wreck: custodyWreck
  }, 'record');
  wreckShipmentOrder(custodyOrder, 'custody-wreck', custodyWreck, 6);
  assertSingleBatchOwner(t, 'po zniszczeniu', lot, {
    source: custodySource.resources, record: custodyOrder.cargo, target: custodyTarget.resources, wreck: custodyWreck
  }, 'wreck');

  return t.results;
}

runIfMain(import.meta.url, run);
