/**
 * ZLECENIA PRZEWOZU — księgowość ładunku ruchu v2.
 *
 * Jedna partia towaru ma w każdej chwili jednego właściciela: magazyn nadawcy,
 * przewoźnika (rekord zlecenia), magazyn odbiorcy albo wrak. Dyspozytor
 * (`trafficDirector.js`) nie dotyka magazynów wprost — załadunek, dostawę
 * i stratę robią funkcje stąd, każda jako jedna synchroniczna transakcja.
 *
 * Moduł jest czystą logiką: rekordy to zwykłe DTO (bez referencji do stacji,
 * kursów ani encji), stan floty to `createFleetState`. Tu są też klasy ładowni
 * (`VAN_CLASSES`) i karencja tras.
 *
 * Wydzielone 2026-10-22 (E2, docs/PLAN-ekonomia-rynki.md § 3.2) z dawnego
 * `src/game/cargoFleet.js`: zostało to, czego używa ruch v2. Stary planista
 * (`planShipment`), zegar analityczny zleceń i widok vanów w grze odeszły
 * razem ze starą ekonomią.
 */

import { RESOURCES, getBagMass } from '../../data/resources.js';
import { normalizeFaction } from '../../data/factions.js';

// ============================================================
// Klasy ładowni
// ============================================================

/**
 * Klasa dobierana do wielkości zlecenia. `npcType` odsyła do NPC_TYPES w grze,
 * więc vany korzystają z istniejących sylwetek zamiast wprowadzać nowe.
 */
export const VAN_CLASSES = Object.freeze([
  { id: 'van', npcType: 'freighter-small', capacity: 60, speed: 210, minLoad: 0 },
  { id: 'hauler', npcType: 'freighter-medium', capacity: 160, speed: 175, minLoad: 60 },
  { id: 'bulk', npcType: 'freighter-large', capacity: 380, speed: 140, minLoad: 160 },
  // Dwie klasy ciężkie. Wcześniej flota kończyła się na `bulk`, przez co
  // stanowiska klas `capital` i `mega` w dokach stały puste — port miał zapas,
  // którego nic nie było w stanie wykorzystać. Im większa ładownia, tym wolniej:
  // masówkę opłaca się wozić hurtem, ale nie w pośpiechu.
  { id: 'heavy', npcType: 'freighter-capital', capacity: 900, speed: 115, minLoad: 380 },
  { id: 'mega', npcType: 'freighter-capital', capacity: 2400, speed: 90, minLoad: 900 }
]);

export function pickVanClass(cargoMass) {
  const mass = Math.max(0, Number(cargoMass) || 0);
  let chosen = VAN_CLASSES[0];
  for (const cls of VAN_CLASSES) {
    if (mass >= cls.minLoad) chosen = cls;
  }
  return chosen;
}

/** Stabilne statusy rekordu przesyłki. Encja NPC jest tylko opcjonalnym widokiem. */
export const SHIPMENT_STATUS = Object.freeze({
  IN_TRANSIT: 'inTransit',
  AWAITING_UNLOAD: 'awaitingUnload',
  DELIVERED: 'delivered',
  WRECK: 'wreck',
  RECOVERED: 'recovered'
});

/** Rodzaj jedynego logicznego właściciela partii. */
export const SHIPMENT_OWNER_KIND = Object.freeze({
  CARRIER: 'carrier',
  STATION: 'station',
  WRECK: 'wreck',
  PLAYER: 'player'
});

const SHIPMENT_SCHEMA_VERSION = 1;
const DEFAULT_WARP_SPEED = 4000;
const MASS_EPSILON = 1e-6;

// ============================================================
// Trwałe rekordy przesyłek
// ============================================================

function stationId(station) {
  return String(station?.id || station?.name || '').toLowerCase();
}

function stableId(value) {
  const raw = value && typeof value === 'object' ? value.id : value;
  return raw == null ? '' : String(raw).trim().toLowerCase();
}

function cloneManifest(bag) {
  const out = {};
  for (const [id, rawAmount] of Object.entries(bag || {})) {
    const amount = Number(rawAmount);
    if (!RESOURCES[id] || !Number.isFinite(amount) || amount <= 0) continue;
    out[id] = amount;
  }
  return out;
}

function manifestFromShipment(shipment) {
  const explicit = cloneManifest(shipment?.manifest || shipment?.plannedManifest || shipment?.cargo);
  if (Object.keys(explicit).length) return explicit;
  const resourceId = String(shipment?.resourceId || '');
  const units = Number(shipment?.units);
  if (!RESOURCES[resourceId] || !Number.isFinite(units) || units <= 0) return {};
  return { [resourceId]: units };
}

function manifestHasCargo(bag) {
  for (const amount of Object.values(bag || {})) {
    if (Number(amount) > 0) return true;
  }
  return false;
}

function manifestIsValid(bag, allowEmpty = false) {
  const entries = Object.entries(bag || {});
  if (!allowEmpty && entries.length === 0) return false;
  for (const [id, amount] of entries) {
    if (!RESOURCES[id] || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return false;
  }
  return true;
}

function resolveVanClass(shipment, manifest) {
  const requestedId = String(shipment?.vanClassId || shipment?.vanClass?.id || '');
  const requested = VAN_CLASSES.find(cls => cls.id === requestedId);
  return requested || pickVanClass(getBagMass(manifest));
}

function routeEndpoint(routeOrSegment, side) {
  if (!routeOrSegment) return '';
  const keys = side === 'from'
    ? ['fromStationId', 'sourceStationId', 'from']
    : ['toStationId', 'targetStationId', 'to'];
  for (const key of keys) {
    const value = routeOrSegment[key];
    const id = stableId(value);
    if (id) return id;
  }
  return '';
}

function routeMode(routeOrSegment, fallback = 'warp') {
  return String(
    routeOrSegment?.mode
    || routeOrSegment?.kind
    || routeOrSegment?.type
    || routeOrSegment?.phase
    || fallback
  ).trim().toLowerCase();
}

function finiteNonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function routeDistance(routeOrSegment) {
  return finiteNonNegative(
    routeOrSegment?.distance
    ?? routeOrSegment?.length
    ?? routeOrSegment?.totalDistance
    ?? routeOrSegment?.totalLength
  );
}

function routeDuration(routeOrSegment) {
  return finiteNonNegative(
    routeOrSegment?.durationSeconds
    ?? routeOrSegment?.travelSeconds
    ?? routeOrSegment?.duration
  );
}

/**
 * Waliduje pełną ścieżkę przed pobraniem towaru. Zwracana migawka zawiera tylko
 * skalary i tablice DTO — nigdy `fromRef`, `toRef`, kolejek ani encji NPC.
 */
export function validateShipmentRoute(route, sourceId, targetId, options = {}) {
  const sourceStationId = stableId(sourceId);
  const targetStationId = stableId(targetId);
  const errors = [];
  if (!route || typeof route !== 'object') errors.push('missing-route');
  if (!sourceStationId) errors.push('missing-source-id');
  if (!targetStationId) errors.push('missing-target-id');
  if (sourceStationId && sourceStationId === targetStationId) errors.push('same-endpoint');
  if (route?.complete === false) errors.push('incomplete-route');
  if (errors.length) return { valid: false, errors, route: null };

  const rawSegments = Array.isArray(route.segments)
    ? route.segments
    : (Array.isArray(route.legs) ? route.legs : null);
  const segments = [];
  const warpSpeed = Math.max(1, Number(options.warpSpeed) || DEFAULT_WARP_SPEED);
  let cursor = sourceStationId;
  let totalDistance = 0;
  let computedDuration = 0;

  if (rawSegments) {
    if (rawSegments.length === 0) errors.push('empty-route');
    for (let i = 0; i < rawSegments.length; i++) {
      const segment = rawSegments[i];
      const fromStationId = routeEndpoint(segment, 'from');
      const toStationId = routeEndpoint(segment, 'to');
      const mode = routeMode(segment);
      if (!fromStationId || !toStationId) {
        errors.push(`segment-${i}-missing-endpoint`);
        continue;
      }
      if (fromStationId !== cursor) errors.push(`segment-${i}-disconnected`);
      if (mode !== 'warp') errors.push(`segment-${i}-unsupported-mode`);
      if (segment?.complete === false) errors.push(`segment-${i}-incomplete`);
      const distance = routeDistance(segment);
      const explicitDuration = routeDuration(segment);
      if (distance == null && explicitDuration == null) errors.push(`segment-${i}-missing-length`);
      const safeDistance = distance ?? 0;
      const durationSeconds = explicitDuration ?? (safeDistance / warpSpeed);
      totalDistance += safeDistance;
      computedDuration += durationSeconds;
      segments.push({ fromStationId, toStationId, mode, distance: safeDistance, durationSeconds });
      cursor = toStationId;
    }
    if (cursor !== targetStationId) errors.push('route-does-not-reach-target');
  } else {
    const fromStationId = routeEndpoint(route, 'from');
    const toStationId = routeEndpoint(route, 'to');
    const mode = routeMode(route);
    if (fromStationId !== sourceStationId) errors.push('route-source-mismatch');
    if (toStationId !== targetStationId) errors.push('route-target-mismatch');
    if (mode !== 'warp') errors.push('unsupported-route-mode');
    const distance = routeDistance(route);
    const explicitDuration = routeDuration(route);
    if (distance == null && explicitDuration == null) errors.push('route-missing-length');
    const safeDistance = distance ?? 0;
    const durationSeconds = explicitDuration ?? (safeDistance / warpSpeed);
    totalDistance = safeDistance;
    computedDuration = durationSeconds;
    segments.push({ fromStationId, toStationId, mode, distance: safeDistance, durationSeconds });
  }

  const requestedDuration = finiteNonNegative(options.travelSeconds);
  const topLevelDuration = routeDuration(route);
  const durationSeconds = requestedDuration ?? topLevelDuration ?? computedDuration;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) errors.push('invalid-duration');
  if (errors.length) return { valid: false, errors, route: null };

  return {
    valid: true,
    errors: [],
    route: {
      id: String(route.id || `${sourceStationId}>${targetStationId}`),
      fromStationId: sourceStationId,
      toStationId: targetStationId,
      mode: 'warp',
      distance: totalDistance,
      durationSeconds,
      segments
    }
  };
}

/**
 * Zbiór id wszystkich zleceń, prowadzony przyrostowo.
 *
 * Zlecenia tylko się dopisują, więc wystarczy doindeksować nowe wpisy od
 * ostatniego razu. Budowanie zbioru od zera przy KAŻDYM nowym zleceniu było
 * O(n²): po kilku godzinach ×60 (kilkanaście tysięcy zleceń) zjadało ~19%
 * ticku ruchu. Gdy ktoś podmieni albo skróci `orders` (wczytanie, test),
 * indeks buduje się od nowa — wynik jest zawsze ten sam co pełny przegląd.
 * Pole niewyliczalne, żeby nie trafiało do zapisu stanu.
 */
function usedOrderIds(state) {
  const orders = state.orders || [];
  let index = state.usedOrderIndex;
  if (!index || index.orders !== orders || index.count > orders.length) {
    index = { orders, count: 0, ids: new Set() };
    Object.defineProperty(state, 'usedOrderIndex', {
      value: index, writable: true, configurable: true, enumerable: false
    });
  }
  for (; index.count < orders.length; index.count++) {
    index.ids.add(String(orders[index.count]?.id || ''));
  }
  return index.ids;
}

function nextShipmentOrderId(state, prefix = 'shipment') {
  let seq = Math.max(1, Math.floor(Number(state.nextOrderId) || 1));
  let id = `${prefix}-${String(seq).padStart(6, '0')}`;
  const used = usedOrderIds(state);
  while (used.has(id)) {
    seq++;
    id = `${prefix}-${String(seq).padStart(6, '0')}`;
  }
  state.nextOrderId = seq + 1;
  return id;
}

function ensureActiveOrderIndex(state) {
  const descriptor = Object.getOwnPropertyDescriptor(state, 'activeOrders');
  if (Array.isArray(state.activeOrders) && descriptor && descriptor.enumerable === false) {
    return state.activeOrders;
  }
  const activeOrders = (state.orders || []).filter(order => order?.status === SHIPMENT_STATUS.IN_TRANSIT
    || order?.status === SHIPMENT_STATUS.AWAITING_UNLOAD);
  Object.defineProperty(state, 'activeOrders', {
    value: activeOrders,
    writable: true,
    configurable: true,
    enumerable: false
  });
  return activeOrders;
}

function sourceHasManifest(econ, manifest) {
  if (!econ?.resources) return false;
  for (const [id, amount] of Object.entries(manifest)) {
    if ((Number(econ.resources[id]) || 0) + MASS_EPSILON < amount) return false;
  }
  return true;
}

/**
 * Tworzy i ładuje rekord w jednej synchronicznej transakcji. Każda walidacja,
 * zwłaszcza kompletność trasy, kończy się PRZED pierwszą mutacją magazynu.
 */
export function createShipmentOrder(state, shipment, sourceEcon, route, options = {}) {
  if (!state || !shipment || !sourceEcon?.resources) return null;
  if (!Array.isArray(state.orders)) state.orders = [];
  ensureActiveOrderIndex(state);

  const sourceStationId = stableId(shipment.sourceStationId || shipment.source?.id);
  const targetStationId = stableId(shipment.targetStationId || shipment.target?.id);
  const routeCheck = validateShipmentRoute(route, sourceStationId, targetStationId, options);
  if (!routeCheck.valid) return null;

  const plannedManifest = manifestFromShipment(shipment);
  if (!manifestIsValid(plannedManifest) || !sourceHasManifest(sourceEcon, plannedManifest)) return null;

  const vanClass = resolveVanClass(shipment, plannedManifest);
  const plannedMass = getBagMass(plannedManifest);
  if (!vanClass || plannedMass > vanClass.capacity + MASS_EPSILON) return null;

  // Rekord powstaje w całości przed mutacją. `source`/`target`/route refs nie są kopiowane.
  const id = nextShipmentOrderId(state, String(options.idPrefix || 'shipment'));
  const now = Number.isFinite(Number(options.now))
    ? Number(options.now)
    : Math.max(0, Number(state.elapsedSeconds) || 0);
  const durationSeconds = routeCheck.route.durationSeconds;
  const carrierId = String(options.carrierId || `carrier:${id}`);
  const order = {
    schemaVersion: SHIPMENT_SCHEMA_VERSION,
    id,
    sourceStationId,
    targetStationId,
    factionId: normalizeFaction(shipment.factionId ?? shipment.source?.factionId),
    vanClassId: vanClass.id,
    plannedManifest: cloneManifest(plannedManifest),
    cargo: cloneManifest(plannedManifest),
    plannedMass,
    status: SHIPMENT_STATUS.IN_TRANSIT,
    owner: { kind: SHIPMENT_OWNER_KIND.CARRIER, id: carrierId },
    carrierId,
    cargoLocation: 'record',
    route: routeCheck.route,
    createdAt: now,
    departedAt: now,
    eta: now + durationSeconds,
    elapsedSeconds: 0,
    remainingSeconds: durationSeconds,
    routeProgress: durationSeconds <= 0 ? 1 : 0,
    actorId: null,
    viewState: null,
    deliveredAt: null,
    wreckedAt: null,
    recoveredAt: null,
    wreckId: null,
    nextUnloadAttemptAt: null
  };

  // Wszystkie odjęcia następują dopiero po pełnej walidacji całego manifestu.
  for (const [resourceId, amount] of Object.entries(plannedManifest)) {
    sourceEcon.resources[resourceId] = (Number(sourceEcon.resources[resourceId]) || 0) - amount;
  }
  state.orders.push(order);
  state.activeOrders.push(order);
  return order;
}

function targetCanAcceptWholeManifest(econ, manifest) {
  if (!econ?.resources) return false;
  for (const [id, amount] of Object.entries(manifest || {})) {
    const current = Number(econ.resources[id]) || 0;
    const cap = Number(econ.capacity?.[id]);
    if (Number.isFinite(cap) && current + amount > cap + MASS_EPSILON) return false;
  }
  return true;
}

/**
 * Rozładunek all-or-nothing. Jeśli choć jeden zasób się nie mieści, cały manifest
 * pozostaje własnością carriera i zlecenie czeka na wolny magazyn.
 */
export function tryDeliverShipmentOrder(order, targetEcon, now = null) {
  const empty = {};
  if (!order) return { changed: false, delivered: empty, status: null };
  if (order.status === SHIPMENT_STATUS.DELIVERED) {
    return { changed: false, delivered: empty, status: order.status };
  }
  if (order.status === SHIPMENT_STATUS.WRECK) {
    return { changed: false, delivered: empty, status: order.status };
  }
  if (order.status !== SHIPMENT_STATUS.IN_TRANSIT && order.status !== SHIPMENT_STATUS.AWAITING_UNLOAD) {
    return { changed: false, delivered: empty, status: order.status };
  }
  if (!manifestHasCargo(order.cargo) || !targetCanAcceptWholeManifest(targetEcon, order.cargo)) {
    order.status = SHIPMENT_STATUS.AWAITING_UNLOAD;
    order.remainingSeconds = 0;
    order.routeProgress = 1;
    return { changed: false, delivered: empty, status: order.status };
  }

  const delivered = cloneManifest(order.cargo);
  for (const [id, amount] of Object.entries(delivered)) {
    targetEcon.resources[id] = (Number(targetEcon.resources[id]) || 0) + amount;
  }
  order.cargo = {};
  order.status = SHIPMENT_STATUS.DELIVERED;
  order.owner = { kind: SHIPMENT_OWNER_KIND.STATION, id: order.targetStationId };
  order.cargoLocation = 'stationInventory';
  order.actorId = null;
  order.remainingSeconds = 0;
  order.routeProgress = 1;
  order.deliveredAt = Number.isFinite(Number(now)) ? Number(now) : order.eta;
  order.nextUnloadAttemptAt = null;
  return { changed: true, delivered, status: order.status };
}

function wreckInventoryBag(inventory) {
  if (!inventory || typeof inventory !== 'object') return null;
  if (inventory.resources && typeof inventory.resources === 'object') return inventory.resources;
  if (inventory.materials && typeof inventory.materials === 'object') return inventory.materials;
  return inventory;
}

function transferWholeManifestToBag(manifest, bag) {
  const moved = cloneManifest(manifest);
  if (!bag || !manifestHasCargo(moved)) return {};
  const nextValues = {};
  for (const [id, amount] of Object.entries(moved)) {
    const current = Number(bag[id]) || 0;
    const next = current + amount;
    if (!Number.isFinite(next)) return {};
    nextValues[id] = next;
  }
  for (const [id, next] of Object.entries(nextValues)) bag[id] = next;
  return moved;
}

/**
 * Atomowe `inTransit -> wreck`. Pierwsze wywołanie ustala właściciela. Jeśli nie
 * ma jeszcze jawnego inventory wraku, cargo pozostaje w rekordzie, ale jego ownerem
 * jest już wrak. Późniejsze przekazanie inventory przenosi je dokładnie raz.
 */
export function wreckShipmentOrder(order, wreckId = null, wreckInventory = null, now = null) {
  const empty = {};
  if (!order || order.status === SHIPMENT_STATUS.DELIVERED) {
    return { changed: false, moved: empty, retained: cloneManifest(order?.cargo), status: order?.status || null };
  }

  const resolvedWreckId = stableId(wreckId) || order.wreckId || `wreck:${order.id}`;
  if (order.status === SHIPMENT_STATUS.WRECK && order.wreckId && order.wreckId !== resolvedWreckId) {
    return { changed: false, moved: empty, retained: cloneManifest(order.cargo), status: order.status };
  }

  let changed = false;
  if (order.status !== SHIPMENT_STATUS.WRECK) {
    if (order.status !== SHIPMENT_STATUS.IN_TRANSIT && order.status !== SHIPMENT_STATUS.AWAITING_UNLOAD) {
      return { changed: false, moved: empty, retained: cloneManifest(order.cargo), status: order.status };
    }
    order.status = SHIPMENT_STATUS.WRECK;
    order.owner = { kind: SHIPMENT_OWNER_KIND.WRECK, id: resolvedWreckId };
    order.wreckId = resolvedWreckId;
    order.wreckedAt = Number.isFinite(Number(now)) ? Number(now) : null;
    order.actorId = null;
    order.remainingSeconds = 0;
    order.cargoLocation = 'record';
    changed = true;
  }

  let moved = {};
  const bag = wreckInventoryBag(wreckInventory);
  if (order.cargoLocation === 'record' && bag && manifestHasCargo(order.cargo)) {
    moved = transferWholeManifestToBag(order.cargo, bag);
    if (manifestHasCargo(moved)) {
      order.cargo = {};
      order.cargoLocation = 'wreckInventory';
      changed = true;
    }
  }

  return { changed, moved, retained: cloneManifest(order.cargo), status: order.status };
}

/**
 * Indeks id → zlecenie, prowadzony przyrostowo jak `usedOrderIds`: zlecenia
 * tylko się dopisują, więc wystarczy doindeksować nowe. Przegląd całej listy
 * przy każdej dostawie (`orders.find`) był ~12% ticku ruchu po kilku godzinach
 * ×60 — lista ma dziesiątki tysięcy zleceń. Przy duplikacie id wygrywa
 * pierwsze, tak jak w `find`.
 */
function orderIndexOf(state) {
  const orders = state.orders;
  let index = state.orderByIdIndex;
  if (!index || index.orders !== orders || index.count > orders.length) {
    index = { orders, count: 0, byId: new Map() };
    Object.defineProperty(state, 'orderByIdIndex', {
      value: index, writable: true, configurable: true, enumerable: false
    });
  }
  for (; index.count < orders.length; index.count++) {
    const order = orders[index.count];
    const id = order?.id;
    if (id !== undefined && !index.byId.has(id)) index.byId.set(id, order);
  }
  return index.byId;
}

export function getShipmentOrder(state, orderId) {
  const id = String(orderId || '');
  return Array.isArray(state?.orders) ? orderIndexOf(state).get(id) || null : null;
}

export function getActiveShipmentOrders(state) {
  const descriptor = state && Object.getOwnPropertyDescriptor(state, 'activeOrders');
  if (Array.isArray(state?.activeOrders) && descriptor?.enumerable === false) {
    return state.activeOrders.filter(order => order?.status === SHIPMENT_STATUS.IN_TRANSIT
      || order?.status === SHIPMENT_STATUS.AWAITING_UNLOAD);
  }
  if (!Array.isArray(state?.orders)) return [];
  return state.orders.filter(order => order?.status === SHIPMENT_STATUS.IN_TRANSIT
    || order?.status === SHIPMENT_STATUS.AWAITING_UNLOAD);
}

export function shipmentOrderMass(order) {
  return getBagMass(order?.cargo);
}

export function shipmentOrderPlannedMass(order) {
  return getBagMass(order?.plannedManifest);
}

/**
 * Kontrola lokalnych niezmienników DTO. Zewnętrzny magazyn/wrak sprawdza test
 * ledgerowy; tutaj pilnujemy jednego właściciela i zgodności statusu z custody.
 */
export function validateShipmentOrder(order) {
  const errors = [];
  if (!order || typeof order !== 'object') {
    return { valid: false, errors: ['missing-order'], ownerCount: 0, plannedMass: 0, recordCargoMass: 0 };
  }
  if (!String(order.id || '')) errors.push('missing-id');
  if (!stableId(order.sourceStationId)) errors.push('missing-source-id');
  if (!stableId(order.targetStationId)) errors.push('missing-target-id');
  if (!manifestIsValid(order.plannedManifest)) errors.push('invalid-planned-manifest');
  if (!manifestIsValid(order.cargo, true)) errors.push('invalid-cargo');

  const plannedMass = shipmentOrderPlannedMass(order);
  const recordCargoMass = shipmentOrderMass(order);
  if (Math.abs((Number(order.plannedMass) || 0) - plannedMass) > MASS_EPSILON) errors.push('planned-mass-mismatch');
  if (recordCargoMass > plannedMass + MASS_EPSILON) errors.push('cargo-exceeds-plan');

  const ownerKind = String(order.owner?.kind || '');
  const ownerId = String(order.owner?.id || '');
  const knownOwner = Object.values(SHIPMENT_OWNER_KIND).includes(ownerKind) && !!ownerId;
  const ownerCount = knownOwner ? 1 : 0;
  if (!knownOwner) errors.push('invalid-owner');

  const active = order.status === SHIPMENT_STATUS.IN_TRANSIT || order.status === SHIPMENT_STATUS.AWAITING_UNLOAD;
  if (active) {
    if (ownerKind !== SHIPMENT_OWNER_KIND.CARRIER || ownerId !== String(order.carrierId || '')) errors.push('active-owner-mismatch');
    if (order.cargoLocation !== 'record' || !manifestHasCargo(order.cargo)) errors.push('active-cargo-missing');
  } else if (order.status === SHIPMENT_STATUS.DELIVERED) {
    if (ownerKind !== SHIPMENT_OWNER_KIND.STATION || ownerId !== order.targetStationId) errors.push('delivered-owner-mismatch');
    if (manifestHasCargo(order.cargo) || order.cargoLocation !== 'stationInventory') errors.push('delivered-cargo-duplicated');
  } else if (order.status === SHIPMENT_STATUS.WRECK) {
    if (ownerKind !== SHIPMENT_OWNER_KIND.WRECK || ownerId !== order.wreckId) errors.push('wreck-owner-mismatch');
    if (order.cargoLocation === 'record' && !manifestHasCargo(order.cargo)) errors.push('wreck-record-cargo-missing');
    if (order.cargoLocation === 'wreckInventory' && manifestHasCargo(order.cargo)) errors.push('wreck-cargo-duplicated');
    if (order.cargoLocation !== 'record' && order.cargoLocation !== 'wreckInventory') errors.push('wreck-location-invalid');
  } else if (order.status === SHIPMENT_STATUS.RECOVERED) {
    const recoveredOwner = ownerKind === SHIPMENT_OWNER_KIND.PLAYER || ownerKind === SHIPMENT_OWNER_KIND.STATION;
    if (!recoveredOwner) errors.push('recovered-owner-mismatch');
    if (manifestHasCargo(order.cargo)) errors.push('recovered-cargo-duplicated');
    if (ownerKind === SHIPMENT_OWNER_KIND.PLAYER && order.cargoLocation !== 'playerInventory') {
      errors.push('recovered-player-location-mismatch');
    }
    if (ownerKind === SHIPMENT_OWNER_KIND.STATION && order.cargoLocation !== 'stationInventory') {
      errors.push('recovered-station-location-mismatch');
    }
  } else {
    errors.push('invalid-status');
  }

  if (order.actorId != null && typeof order.actorId !== 'string') errors.push('actor-id-not-serializable');
  const routeCheck = validateShipmentRoute(order.route, order.sourceStationId, order.targetStationId, {
    travelSeconds: order.route?.durationSeconds
  });
  if (!routeCheck.valid) errors.push('invalid-route');

  return { valid: errors.length === 0, errors, ownerCount, plannedMass, recordCargoMass };
}

// ============================================================
// Stan floty
// ============================================================

export function createFleetState() {
  const state = {
    // Rekordy są plain DTO: żadnych referencji do station/NPC ani kolejek warpa.
    orders: [],
    nextOrderId: 1,
    elapsedSeconds: 0,
    dispatchTimer: 0
  };
  // Runtime index: te same rekordy, bez kopiowania manifestów; terminalne DTO
  // zostają w `orders`, ale nie obciążają gorącego ticka ani serializacji.
  Object.defineProperty(state, 'activeOrders', {
    value: [],
    writable: true,
    configurable: true,
    enumerable: false
  });
  // Karencja jest wyłącznie indeksem runtime. Nie ma sensu serializować Mapy do `{}`.
  Object.defineProperty(state, 'cooldownPairs', {
    value: new Map(),
    writable: true,
    configurable: true,
    enumerable: false
  });
  return state;
}

function ensureCooldownPairs(state) {
  if (!state) return new Map();
  if (state.cooldownPairs instanceof Map) return state.cooldownPairs;
  const cooldownPairs = new Map();
  Object.defineProperty(state, 'cooldownPairs', {
    value: cooldownPairs,
    writable: true,
    configurable: true,
    enumerable: false
  });
  return cooldownPairs;
}

export function tickCooldowns(state, dt) {
  const cooldownPairs = ensureCooldownPairs(state);
  for (const [key, remaining] of cooldownPairs) {
    const next = remaining - dt;
    if (next <= 0) cooldownPairs.delete(key);
    else cooldownPairs.set(key, next);
  }
}

export function blockRoute(state, source, target, seconds = 45) {
  ensureCooldownPairs(state).set(`${stationId(source)}>${stationId(target)}`, seconds);
}

export function getBlockedPairs(state) {
  return new Set(ensureCooldownPairs(state).keys());
}
