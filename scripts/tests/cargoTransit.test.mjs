/**
 * Rekordowy tranzyt cargo: dostawa poza ekranem, atomowe ownership i zachowanie masy.
 * Suita jest częścią głównego runnera i sprawdza rekord jako jedyne źródło prawdy.
 */

import {
  SHIPMENT_STATUS,
  SHIPMENT_OWNER_KIND,
  createFleetState,
  createShipmentOrder,
  advanceShipmentOrders,
  tryDeliverShipmentOrder,
  wreckShipmentOrder,
  recoverWreckedShipmentOrder,
  materializeShipmentOrderView,
  dematerializeShipmentOrderView,
  tickCooldowns,
  getShipmentOrder,
  getActiveShipmentOrders,
  shipmentOrderMass,
  shipmentOrderPlannedMass,
  validateShipmentRoute,
  validateShipmentOrder
} from '../../src/game/cargoFleet.js';
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
  const t = createSuite('cargoTransit');

  t.section('1. Pełna trasa jest warunkiem atomowego załadunku');
  const invalidState = createFleetState();
  const invalidSource = makeEcon({ steel: 50 }, { steel: 100 });
  const noRoute = createShipmentOrder(invalidState, makeShipment(10), invalidSource, null);
  t.equal('brak trasy odrzuca zlecenie', noRoute, null);
  t.equal('brak trasy nie zmienia magazynu', invalidSource.resources.steel, 50);
  t.equal('brak trasy nie dopisuje rekordu', invalidState.orders.length, 0);

  const directRoute = createShipmentOrder(invalidState, makeShipment(10), invalidSource, {
    from: 'earth', to: 'jupiter', mode: 'direct', length: 40000
  });
  t.equal('fallback direct jest odrzucany', directRoute, null);
  t.equal('direct nie zdejmuje cargo', invalidSource.resources.steel, 50);
  const teleportRoute = createShipmentOrder(invalidState, makeShipment(10), invalidSource, {
    from: 'earth', to: 'jupiter', mode: 'teleport', length: 40000
  });
  t.equal('nieobsługiwany tryb trasy jest odrzucany', teleportRoute, null);
  t.equal('teleport nie zdejmuje cargo', invalidSource.resources.steel, 50);

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
  t.check('ciągła inner→outer ma pełną ścieżkę', fullRoute.valid);
  t.equal('czas pełnej ścieżki sumuje segmenty', fullRoute.route?.durationSeconds, 10);

  t.section('2. Rekord jest stabilnym, serializowalnym DTO');
  const dtoState = createFleetState();
  const dtoSource = makeEcon({ steel: 40 }, { steel: 100 });
  const first = createShipmentOrder(dtoState, makeShipment(10), dtoSource, route(12), { now: 7 });
  const second = createShipmentOrder(dtoState, makeShipment(5), dtoSource, route(8), { now: 7 });
  t.equal('pierwszy rekord ma stabilny ID', first?.id, 'shipment-000001');
  t.equal('kolejny rekord ma następny stabilny ID', second?.id, 'shipment-000002');
  t.equal('rekord trzyma wyłącznie ID source', first?.sourceStationId, 'earth');
  t.equal('rekord trzyma wyłącznie ID target', first?.targetStationId, 'jupiter');
  t.check('plannedManifest i cargo są osobnymi workami', first?.plannedManifest !== first?.cargo);
  t.equal('ETA jest w czasie gry', first?.eta, 19);
  t.equal('właścicielem jest logiczny carrier', first?.owner.kind, SHIPMENT_OWNER_KIND.CARRIER);
  t.close('zapamiętana masa pochodzi z resources.js', first?.plannedMass, getBagMass({ steel: 10 }));
  const json = JSON.stringify(first);
  const restored = JSON.parse(json);
  t.check('rekord przechodzi JSON round-trip', restored.id === first.id && restored.route.segments.length === 1);
  t.check('rekord nie zawiera referencji stacji/warpa', !json.includes('fromRef') && !json.includes('toRef') && !json.includes('queues'));
  t.equal('lookup odnajduje rekord po ID', getShipmentOrder(dtoState, second.id), second);
  t.equal('oba rekordy są aktywne', getActiveShipmentOrders(dtoState).length, 2);
  t.check('nowy rekord spełnia ownership invariant', validateShipmentOrder(first).valid);

  const saveSource = makeEcon({ steel: 10 }, { steel: 100 });
  const saveState = createFleetState();
  createShipmentOrder(saveState, makeShipment(10), saveSource, route(1));
  const firstRestore = JSON.parse(JSON.stringify(saveState));
  tickCooldowns(firstRestore, 1);
  t.check('runtime cooldownPairs odbudowuje się po restore', firstRestore.cooldownPairs instanceof Map);
  const saveTarget = makeEcon({ steel: 0 }, { steel: 100 });
  advanceShipmentOrders(firstRestore, 1, { getEconomy: () => saveTarget });
  t.equal('po restore tick mutuje kanoniczny rekord orders', firstRestore.orders[0].status, SHIPMENT_STATUS.DELIVERED);
  t.equal('po restore kanoniczny rekord nie trzyma kopii cargo', shipmentOrderMass(firstRestore.orders[0]), 0);
  const serializedAfterTick = JSON.stringify(firstRestore);
  t.check('indeksy runtime nie trafiają do kolejnego save',
    !serializedAfterTick.includes('activeOrders') && !serializedAfterTick.includes('cooldownPairs'));
  const secondRestore = JSON.parse(JSON.stringify(firstRestore));
  advanceShipmentOrders(secondRestore, 10, { getEconomy: () => saveTarget });
  t.equal('drugi restore nie dostarcza partii ponownie', saveTarget.resources.steel, 10);

  t.section('3. Dostawa dochodzi bez gracza i bez aktora NPC');
  const offlineState = createFleetState();
  const offlineSource = makeEcon({ steel: 30 }, { steel: 100 });
  const offlineTarget = makeEcon({ steel: 0 }, { steel: 100 });
  const massBeforeDispatch = ledgerMass(offlineSource, offlineTarget);
  const offlineOrder = createShipmentOrder(offlineState, makeShipment(20), offlineSource, route(10));
  t.close('dispatch zachowuje masę magazyn+tranzyt', ledgerMass(offlineSource, offlineTarget, offlineOrder), massBeforeDispatch);
  advanceShipmentOrders(offlineState, 9, { getEconomy: () => offlineTarget });
  t.equal('przed ETA towar nadal jest w drodze', offlineOrder.status, SHIPMENT_STATUS.IN_TRANSIT);
  t.equal('nie powstał żaden widok NPC', offlineOrder.actorId, null);
  advanceShipmentOrders(offlineState, 1, { getEconomy: () => offlineTarget });
  t.equal('w ETA rekord jest dostarczony', offlineOrder.status, SHIPMENT_STATUS.DELIVERED);
  t.equal('odbiorca dostał cały manifest', offlineTarget.resources.steel, 20);
  t.equal('rekord nie ma drugiej kopii cargo', shipmentOrderMass(offlineOrder), 0);
  t.close('dostawa zachowuje masę', ledgerMass(offlineSource, offlineTarget, offlineOrder), massBeforeDispatch);
  t.check('dostarczony rekord ma jednego właściciela', validateShipmentOrder(offlineOrder).valid);

  t.section('4. Widoczny aktor przejmuje zegar trasy');
  const authorityState = createFleetState();
  const authoritySource = makeEcon({ steel: 10 }, { steel: 100 });
  const authorityTarget = makeEcon({ steel: 0 }, { steel: 100 });
  const authorityOrder = createShipmentOrder(authorityState, makeShipment(10), authoritySource, route(10));
  const authorityActor = { id: 'cargo-authority', x: 1, y: 2, vx: 3, vy: 4, phase: 'toGate' };
  materializeShipmentOrderView(authorityOrder, authorityActor);
  advanceShipmentOrders(authorityState, 20, { getEconomy: () => authorityTarget });
  t.equal('ETA nie dostarcza zmaterializowanego transportu', authorityOrder.status, SHIPMENT_STATUS.IN_TRANSIT);
  t.equal('widoczny transport nie mutuje targetu', authorityTarget.resources.steel, 0);
  t.equal('analityczny zegar stoi, gdy istnieje aktor', authorityOrder.elapsedSeconds, 0);
  dematerializeShipmentOrderView(authorityOrder, authorityActor, {
    x: 40, y: 50, vx: 6, vy: 7, phase: 'warping', routeProgress: 0.4, clockTime: 20
  });
  t.equal('handoff zapisuje fizyczny postęp', authorityOrder.elapsedSeconds, 4);
  t.equal('handoff przelicza pozostały czas', authorityOrder.remainingSeconds, 6);
  const resumed = materializeShipmentOrderView(authorityOrder, 'cargo-authority-2');
  t.equal('natychmiastowa rematerializacja zachowuje x', resumed?.viewState?.x, 40);
  t.equal('natychmiastowa rematerializacja zachowuje fazę', resumed?.viewState?.phase, 'warping');
  dematerializeShipmentOrderView(authorityOrder, 'cargo-authority-2', resumed.viewState);
  advanceShipmentOrders(authorityState, 6, { getEconomy: () => authorityTarget });
  t.equal('po dematerializacji rekord kończy pozostałą trasę', authorityOrder.status, SHIPMENT_STATUS.DELIVERED);
  t.equal('handoff dostarcza dokładnie raz', authorityTarget.resources.steel, 10);

  t.section('5. Overflow nie robi częściowego transferu');
  const overflowState = createFleetState();
  const overflowSource = makeEcon({ steel: 10 }, { steel: 100 });
  const overflowTarget = makeEcon({ steel: 95 }, { steel: 100 });
  const overflowOrder = createShipmentOrder(overflowState, makeShipment(10), overflowSource, route(1));
  const overflowMass = ledgerMass(overflowSource, overflowTarget, overflowOrder);
  advanceShipmentOrders(overflowState, 1, { getEconomy: () => overflowTarget });
  t.equal('pełny magazyn ustawia awaitingUnload', overflowOrder.status, SHIPMENT_STATUS.AWAITING_UNLOAD);
  t.equal('target nie dostał częściowej porcji', overflowTarget.resources.steel, 95);
  t.equal('cały manifest pozostał w rekordzie', overflowOrder.cargo.steel, 10);
  t.close('overflow zachowuje masę', ledgerMass(overflowSource, overflowTarget, overflowOrder), overflowMass);
  t.check('awaitingUnload nadal ma jednego carriera', validateShipmentOrder(overflowOrder).valid);

  // Symulujemy zużycie stacji, które zwalnia miejsce; sam transport nadal niczego nie tworzy.
  overflowTarget.resources.steel = 90;
  const retryMass = ledgerMass(overflowSource, overflowTarget, overflowOrder);
  const retryEvents = advanceShipmentOrders(overflowState, 0, { getEconomy: () => overflowTarget });
  t.equal('oczekujący rekord ponawia rozładunek bez ruchu NPC', overflowOrder.status, SHIPMENT_STATUS.DELIVERED);
  t.equal('retry dostarcza całość', overflowTarget.resources.steel, 100);
  t.equal('retry emituje zdarzenie dostawy', retryEvents[0]?.type, 'delivered');
  t.close('udany retry zachowuje bieżącą masę', ledgerMass(overflowSource, overflowTarget, overflowOrder), retryMass);

  t.section('6. Zniszczenie przenosi własność do wraku dokładnie raz');
  const wreckState = createFleetState();
  const wreckSource = makeEcon({ iron_ore: 20 }, { iron_ore: 100 });
  const wreckTarget = makeEcon({ iron_ore: 0 }, { iron_ore: 100 });
  const wreckOrder = createShipmentOrder(wreckState, makeShipment(12, 'iron_ore'), wreckSource, route(20));
  const wreckInventory = {};
  const beforeWreck = ledgerMass(wreckSource, wreckTarget, wreckOrder, wreckInventory);
  const wrecked = wreckShipmentOrder(wreckOrder, 'wreck-77', wreckInventory, 3);
  t.check('pierwsze zniszczenie zmienia rekord', wrecked.changed);
  t.equal('status przechodzi do wreck', wreckOrder.status, SHIPMENT_STATUS.WRECK);
  t.equal('jedynym ownerem jest wskazany wrak', wreckOrder.owner.id, 'wreck-77');
  t.equal('jawny inventory dostał cały manifest', wreckInventory.iron_ore, 12);
  t.equal('rekord wyzerował fizyczne cargo po transferze', shipmentOrderMass(wreckOrder), 0);
  t.close('zniszczenie zachowuje masę', ledgerMass(wreckSource, wreckTarget, wreckOrder, wreckInventory), beforeWreck);
  const wreckedAgain = wreckShipmentOrder(wreckOrder, 'wreck-77', wreckInventory, 4);
  t.check('drugie wywołanie jest idempotentne', !wreckedAgain.changed);
  t.equal('drugie wywołanie nie duplikuje wraku', wreckInventory.iron_ore, 12);
  t.check('zewnętrzny wrak spełnia invariant rekordu', validateShipmentOrder(wreckOrder).valid);

  t.section('7. Wrak może czasowo posiadać cargo rekordowo');
  const retainedState = createFleetState();
  const retainedSource = makeEcon({ steel: 10 }, { steel: 100 });
  const retainedOrder = createShipmentOrder(retainedState, makeShipment(10), retainedSource, route(20));
  const retained = wreckShipmentOrder(retainedOrder, 'wreck-late');
  t.equal('bez inventory cargo zostaje w rekordzie', retained.retained.steel, 10);
  t.equal('mimo tego logicznym ownerem jest wrak', retainedOrder.owner.kind, SHIPMENT_OWNER_KIND.WRECK);
  t.check('rekordowy wrak spełnia invariant', validateShipmentOrder(retainedOrder).valid);
  const lateInventory = {};
  const attached = wreckShipmentOrder(retainedOrder, 'wreck-late', lateInventory);
  t.equal('późniejsze inventory przejmuje cargo', lateInventory.steel, 10);
  t.equal('po podpięciu inventory rekord jest pusty', shipmentOrderMass(retainedOrder), 0);
  t.check('ponowne podpięcie nie kopiuje cargo', !wreckShipmentOrder(retainedOrder, 'wreck-late', lateInventory).changed);

  t.section('8. Materializacja jest tylko widokiem');
  const viewState = createFleetState();
  const viewSource = makeEcon({ steel: 10 }, { steel: 100 });
  const viewOrder = createShipmentOrder(viewState, makeShipment(10), viewSource, route(30));
  const cargoBeforeView = JSON.stringify(viewOrder.cargo);
  const progressBeforeView = viewOrder.routeProgress;
  const actor = { id: 'npc-cargo-1', x: 12, y: 34, vx: 2, vy: 3, angle: 0.5, hp: 80, dead: false };
  const descriptor = materializeShipmentOrderView(viewOrder, actor);
  t.equal('widok wskazuje rekord po ID', descriptor?.shipmentOrderId, viewOrder.id);
  t.check('descriptor nie zawiera manifestu', !Object.hasOwn(descriptor, 'cargo') && !Object.hasOwn(descriptor, 'plannedManifest'));
  t.check('aktor nie dostał kopii cargo', !Object.hasOwn(actor, '_cargo') && !Object.hasOwn(actor, '_extraSalvage'));
  t.equal('materializacja nie zmienia cargo', JSON.stringify(viewOrder.cargo), cargoBeforeView);
  t.equal('materializacja nie zmienia postępu', viewOrder.routeProgress, progressBeforeView);
  t.equal('drugi jednoczesny widok jest odrzucony', materializeShipmentOrderView(viewOrder, 'npc-cargo-2'), null);

  const progressBeforeDematerialize = viewOrder.routeProgress;
  const statusBeforeDematerialize = viewOrder.status;
  const dematerialized = dematerializeShipmentOrderView(viewOrder, actor);
  t.check('dematerializacja usuwa powiązanie widoku', dematerialized && viewOrder.actorId === null);
  t.equal('dematerializacja nie zmienia statusu', viewOrder.status, statusBeforeDematerialize);
  t.equal('dematerializacja nie zmienia postępu', viewOrder.routeProgress, progressBeforeDematerialize);
  t.equal('dematerializacja nie ustawia dead', actor.dead, false);
  t.equal('migawka pozycji jest serializowalna', viewOrder.viewState.x, 12);
  t.equal('cargo pozostaje tylko w rekordzie', JSON.stringify(viewOrder.cargo), cargoBeforeView);
  t.check('rekord po cyklu view nadal jest poprawny', validateShipmentOrder(viewOrder).valid);

  t.section('9. Walidator wykrywa niespójny lokalny zapis custody');
  const broken = JSON.parse(JSON.stringify(viewOrder));
  broken.owner = null;
  const brokenResult = validateShipmentOrder(broken);
  t.check('brak ownera unieważnia rekord', !brokenResult.valid);
  t.equal('brak ownera daje ownerCount=0', brokenResult.ownerCount, 0);
  const wrongOwner = JSON.parse(JSON.stringify(viewOrder));
  wrongOwner.owner = { kind: SHIPMENT_OWNER_KIND.STATION, id: 'earth' };
  t.check('aktywny transport nie może należeć do stacji', !validateShipmentOrder(wrongOwner).valid);
  t.close('plannedMass pozostaje niezależne od widoku', shipmentOrderPlannedMass(viewOrder), getBagMass({ steel: 10 }));

  t.section('10. Odzysk z wraku jest atomowy i zachowuje masę');
  const recoveryState = createFleetState();
  const recoverySource = makeEcon({ steel: 10 }, { steel: 100 });
  const recoveryReceiver = makeEcon({ steel: 0 }, { steel: 5 });
  const recoveryOrder = createShipmentOrder(recoveryState, makeShipment(10), recoverySource, route(20));
  const recoveryWreck = {};
  wreckShipmentOrder(recoveryOrder, 'wreck-recovery', recoveryWreck, 2);
  const recoveryMass = ledgerMass(recoverySource, recoveryReceiver, recoveryOrder, recoveryWreck);
  const rejectedRecovery = recoverWreckedShipmentOrder(recoveryOrder, recoveryWreck, recoveryReceiver, {
    ownerKind: SHIPMENT_OWNER_KIND.STATION,
    ownerId: 'mars',
    now: 3
  });
  t.check('brak miejsca odrzuca całą partię', !rejectedRecovery.changed && rejectedRecovery.reason === 'capacity');
  t.equal('odrzucona partia zostaje w konkretnym wraku', recoveryWreck.steel, 10);
  t.close('odrzucony odzysk zachowuje masę', ledgerMass(recoverySource, recoveryReceiver, recoveryOrder, recoveryWreck), recoveryMass);
  recoveryReceiver.capacity.steel = 10;
  const acceptedRecovery = recoverWreckedShipmentOrder(recoveryOrder, recoveryWreck, recoveryReceiver, {
    ownerKind: SHIPMENT_OWNER_KIND.STATION,
    ownerId: 'mars',
    now: 4
  });
  t.check('pełna partia przechodzi do stacji', acceptedRecovery.changed);
  t.equal('wrak po odzysku nie ma kopii cargo', recoveryWreck.steel, undefined);
  t.equal('rekord kończy jako recovered', recoveryOrder.status, SHIPMENT_STATUS.RECOVERED);
  t.equal('nowym ownerem jest stacja odzyskująca', recoveryOrder.owner.id, 'mars');
  t.close('udany odzysk zachowuje masę', ledgerMass(recoverySource, recoveryReceiver, recoveryOrder, recoveryWreck), recoveryMass);
  t.check('powtórny odzysk jest no-opem', !recoverWreckedShipmentOrder(
    recoveryOrder, recoveryWreck, recoveryReceiver, { ownerKind: SHIPMENT_OWNER_KIND.STATION, ownerId: 'mars' }
  ).changed);

  t.section('11. Niezależny ledger widzi dokładnie jednego właściciela partii');
  const lot = { steel: 10 };
  const custodyState = createFleetState();
  const custodySource = makeEcon({ steel: 10 }, { steel: 100 });
  const custodyTarget = makeEcon({ steel: 0 }, { steel: 100 });
  const custodyWreck = {};
  const custodyActor = { id: 'custody-view' };
  assertSingleBatchOwner(t, 'przed dispatch', lot, {
    source: custodySource.resources, record: {}, actor: {}, target: custodyTarget.resources, wreck: custodyWreck
  }, 'source');
  const custodyOrder = createShipmentOrder(custodyState, makeShipment(10), custodySource, route(10));
  assertSingleBatchOwner(t, 'po dispatch', lot, {
    source: custodySource.resources, record: custodyOrder.cargo, actor: {}, target: custodyTarget.resources, wreck: custodyWreck
  }, 'record');
  materializeShipmentOrderView(custodyOrder, custodyActor);
  assertSingleBatchOwner(t, 'po materializacji', lot, {
    source: custodySource.resources, record: custodyOrder.cargo, actor: custodyActor._cargo, target: custodyTarget.resources, wreck: custodyWreck
  }, 'record');
  dematerializeShipmentOrderView(custodyOrder, custodyActor, { routeProgress: 0.5, clockTime: 5 });
  assertSingleBatchOwner(t, 'po dematerializacji', lot, {
    source: custodySource.resources, record: custodyOrder.cargo, actor: custodyActor._cargo, target: custodyTarget.resources, wreck: custodyWreck
  }, 'record');
  wreckShipmentOrder(custodyOrder, 'custody-wreck', custodyWreck, 6);
  assertSingleBatchOwner(t, 'po zniszczeniu', lot, {
    source: custodySource.resources, record: custodyOrder.cargo, actor: custodyActor._cargo, target: custodyTarget.resources, wreck: custodyWreck
  }, 'wreck');
  const custodyPlayer = {};
  recoverWreckedShipmentOrder(custodyOrder, custodyWreck, custodyPlayer, {
    ownerKind: SHIPMENT_OWNER_KIND.PLAYER,
    ownerId: 'player',
    now: 7
  });
  assertSingleBatchOwner(t, 'po odzysku', lot, {
    source: custodySource.resources, record: custodyOrder.cargo, actor: custodyActor._cargo,
    target: custodyTarget.resources, wreck: custodyWreck, player: custodyPlayer
  }, 'player');

  return t.results;
}

runIfMain(import.meta.url, run);
