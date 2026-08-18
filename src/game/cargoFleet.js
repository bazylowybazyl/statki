/**
 * FLOTY TOWAROWE — logistyka, która sprawia, że surowiec fizycznie gdzieś leci.
 *
 * Ruch NPC w grze istniał od dawna, ale był teatrem: frachtowce latały między
 * stacjami z pustymi ładowniami, a ich utrata nikogo nic nie kosztowała.
 * Ten moduł daje im ładunek i powód.
 *
 * Trasa nie jest wpisana w żadną tabelę — wynika z tego, co się nie bilansuje
 * w `stationEconomy`: van rusza stamtąd, gdzie jest nadwyżka, tam, gdzie jest
 * największy niedobór. Zmiana produkcji sama przerysowuje mapę połączeń.
 *
 * Moduł jest czystą logiką: planuje trasy i prowadzi księgowość ładunku,
 * ale nie tworzy encji ani ich nie rysuje — od tego jest warstwa gry.
 */

import { RESOURCES, getBagMass } from '../data/resources.js';
import { getStationDeficits, getStationSurpluses, stationWantsResource } from './stationEconomy.js';
import { isDerelict, normalizeFaction, areFactionsHostile } from '../data/factions.js';

// ============================================================
// Klasy vanów
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

/** Minimalna masa, dla której w ogóle opłaca się wysyłać transport. */
const MIN_SHIPMENT_MASS = 12;

/** Ile jednocześnie vanów na trasie — zapobiega zalaniu układu ruchem. */
export const MAX_ACTIVE_VANS = 14;

/** Odstęp między próbami wystawienia nowego zlecenia (sekundy gry). */
export const DISPATCH_INTERVAL = 12;

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
// Planowanie zleceń
// ============================================================

function stationId(station) {
  return String(station?.id || station?.name || '').toLowerCase();
}

/**
 * Szuka najlepszego zlecenia: nadwyżka u jednego, największy głód u drugiego.
 * Zwraca `null`, gdy nic sensownego nie ma do przewiezienia.
 *
 * `getEcon(station)` dostarcza magazyn — moduł nie zna sposobu jego trzymania.
 */
export function planShipment(stations, getEcon, options = {}) {
  const skipPairs = options.skipPairs instanceof Set ? options.skipPairs : new Set();
  const active = Array.isArray(stations) ? stations.filter(s => s && !isDerelict(s)) : [];
  if (active.length < 2) return null;

  let best = null;

  for (const source of active) {
    const sourceEcon = getEcon(source);
    if (!sourceEcon) continue;
    const surpluses = getStationSurpluses(source, sourceEcon, 8);
    if (!surpluses.length) continue;

    for (const target of active) {
      if (target === source) continue;
      // Nikt nie wozi towaru wprost do frakcji, z którą jest w stanie wojny.
      if (areFactionsHostile(source.factionId, target.factionId)) continue;
      if (skipPairs.has(`${stationId(source)}>${stationId(target)}`)) continue;

      const targetEcon = getEcon(target);
      if (!targetEcon) continue;
      const deficits = getStationDeficits(target, targetEcon, 8);
      if (!deficits.length) continue;

      for (const deficit of deficits) {
        const surplus = surpluses.find(s => s.id === deficit.id);
        if (!surplus || surplus.spare <= 0) continue;
        if (!stationWantsResource(target, deficit.id)) continue;

        const units = Math.min(surplus.spare, Math.max(1, deficit.missing));
        const mass = (RESOURCES[deficit.id]?.mass || 1) * units;
        if (mass < MIN_SHIPMENT_MASS) continue;

        // Priorytet: im pustszy magazyn odbiorcy, tym pilniejsze zlecenie.
        // Wartość towaru rozstrzyga remisy, żeby najpierw jechało to, co drogie.
        const score = (1 - deficit.fill) * 100 + Math.min(20, (deficit.value || 0) * 0.05);
        if (!best || score > best.score) {
          best = { source, target, resourceId: deficit.id, units, mass, score };
        }
      }
    }
  }

  if (!best) return null;

  const vanClass = pickVanClass(best.mass);
  const carried = Math.min(best.units, Math.floor(vanClass.capacity / (RESOURCES[best.resourceId]?.mass || 1)));
  if (carried <= 0) return null;

  return {
    source: best.source,
    target: best.target,
    resourceId: best.resourceId,
    units: carried,
    vanClass
  };
}

// ============================================================
// Trwałe rekordy przesyłek
// ============================================================

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

function nextShipmentOrderId(state, prefix = 'shipment') {
  let seq = Math.max(1, Math.floor(Number(state.nextOrderId) || 1));
  let id = `${prefix}-${String(seq).padStart(6, '0')}`;
  const used = new Set((state.orders || []).map(order => String(order?.id || '')));
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

function resolveOrderEconomy(options, stationId, order) {
  const resolver = options?.getEconomy || options?.getEcon || options?.resolveEconomy;
  return typeof resolver === 'function' ? resolver(stationId, order) : null;
}

/**
 * Analityczny tick rekordów. Nie zna gracza, renderu ani NPC, więc dostawa działa
 * także wtedy, gdy w pobliżu nie ma żadnej zmaterializowanej encji.
 */
export function advanceShipmentOrders(state, dt, options = {}) {
  if (!state) return [];
  if (!Array.isArray(state.orders)) state.orders = [];
  ensureActiveOrderIndex(state);
  const delta = Math.max(0, Number(dt) || 0);
  state.elapsedSeconds = Math.max(0, Number(state.elapsedSeconds) || 0) + delta;
  const now = state.elapsedSeconds;
  const events = Array.isArray(options.events) ? options.events : [];
  events.length = 0;

  for (let index = state.activeOrders.length - 1; index >= 0; index--) {
    const order = state.activeOrders[index];
    if (!order) {
      state.activeOrders.splice(index, 1);
      continue;
    }
    if (order.status === SHIPMENT_STATUS.IN_TRANSIT) {
      // Po materializacji pozycja aktora i npcStep są jedynym zegarem trasy.
      // Rekord wznawia zegar analityczny dopiero po zapisaniu fizycznego postępu.
      if (order.actorId) continue;
      const duration = Math.max(0, Number(order.route?.durationSeconds) || 0);
      order.elapsedSeconds = Math.min(duration, Math.max(0, Number(order.elapsedSeconds) || 0) + delta);
      order.remainingSeconds = Math.max(0, duration - order.elapsedSeconds);
      order.routeProgress = duration <= 0 ? 1 : Math.min(1, order.elapsedSeconds / duration);
      if (order.remainingSeconds > MASS_EPSILON) continue;
    } else if (order.status !== SHIPMENT_STATUS.AWAITING_UNLOAD) {
      state.activeOrders.splice(index, 1);
      continue;
    } else if (Number.isFinite(Number(order.nextUnloadAttemptAt))
      && now + MASS_EPSILON < Number(order.nextUnloadAttemptAt)) {
      continue;
    }

    const targetEcon = resolveOrderEconomy(options, order.targetStationId, order);
    const result = tryDeliverShipmentOrder(order, targetEcon, now);
    if (!result.changed) {
      const retryInterval = Math.max(0, Number(options.retryIntervalSeconds) || 0);
      order.nextUnloadAttemptAt = retryInterval > 0 ? now + retryInterval : null;
    }
    const event = { type: result.changed ? 'delivered' : 'awaitingUnload', orderId: order.id, result };
    events.push(event);
    if (typeof options.onEvent === 'function') options.onEvent(event, order);
    if (result.changed) state.activeOrders.splice(index, 1);
  }
  return events;
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
 * Atomowo odzyskuje całą partię z konkretnego wraku. Cargo nie jest dzielone
 * pomiędzy wrak i odbiorcę: gdy brakuje miejsca, operacja jest no-opem.
 */
export function recoverWreckedShipmentOrder(order, wreckInventory, receiverInventory, options = {}) {
  const empty = {};
  if (!order || order.status !== SHIPMENT_STATUS.WRECK || order.cargoLocation !== 'wreckInventory') {
    return { changed: false, moved: empty, status: order?.status || null };
  }

  const wreckBag = wreckInventoryBag(wreckInventory);
  const manifest = cloneManifest(wreckBag);
  if (!wreckBag || !manifestHasCargo(manifest)) {
    return { changed: false, moved: empty, status: order.status };
  }

  const receiverBag = receiverInventory?.resources && typeof receiverInventory.resources === 'object'
    ? receiverInventory.resources
    : receiverInventory;
  if (!receiverBag || typeof receiverBag !== 'object') {
    return { changed: false, moved: empty, status: order.status };
  }
  const receiverEcon = receiverInventory?.resources
    ? receiverInventory
    : { resources: receiverBag, capacity: options.capacity || null };
  if (!targetCanAcceptWholeManifest(receiverEcon, manifest)) {
    return { changed: false, moved: empty, status: order.status, reason: 'capacity' };
  }

  const ownerKind = options.ownerKind === SHIPMENT_OWNER_KIND.STATION
    ? SHIPMENT_OWNER_KIND.STATION
    : SHIPMENT_OWNER_KIND.PLAYER;
  const ownerId = String(options.ownerId || (ownerKind === SHIPMENT_OWNER_KIND.PLAYER ? 'player' : '')).trim();
  if (!ownerId) return { changed: false, moved: empty, status: order.status };

  for (const [id, amount] of Object.entries(manifest)) {
    receiverBag[id] = (Number(receiverBag[id]) || 0) + amount;
  }
  for (const id of Object.keys(manifest)) delete wreckBag[id];

  order.status = SHIPMENT_STATUS.RECOVERED;
  order.owner = { kind: ownerKind, id: ownerId };
  order.cargoLocation = ownerKind === SHIPMENT_OWNER_KIND.STATION ? 'stationInventory' : 'playerInventory';
  order.recoveredAt = Number.isFinite(Number(options.now)) ? Number(options.now) : null;
  order.actorId = null;
  return { changed: true, moved: manifest, status: order.status };
}

function actorViewId(actorOrId, order) {
  if (actorOrId && typeof actorOrId === 'object') {
    const objectId = actorOrId.id ?? actorOrId.actorId ?? actorOrId.shipmentViewId;
    if (objectId != null && String(objectId).trim()) return String(objectId);
  }
  if (actorOrId != null && typeof actorOrId !== 'object' && String(actorOrId).trim()) return String(actorOrId);
  return `shipment-view:${order.id}`;
}

function serializableViewState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const out = {};
  const numericKeys = [
    'x', 'y', 'vx', 'vy', 'angle', 'hp', 'maxHp', 'lane', 'dockPort',
    'routeProgress', 'recordElapsedSeconds', 'clockTime'
  ];
  for (const key of numericKeys) {
    const value = Number(snapshot[key]);
    if (Number.isFinite(value)) out[key] = value;
  }
  if (typeof snapshot.phase === 'string') out.phase = snapshot.phase;
  return Object.keys(out).length ? out : null;
}

/** Wiąże widok z rekordem, ale nie kopiuje manifestu i nie prowadzi ruchu. */
export function materializeShipmentOrderView(order, actorOrId = null) {
  if (!order || (order.status !== SHIPMENT_STATUS.IN_TRANSIT && order.status !== SHIPMENT_STATUS.AWAITING_UNLOAD)) {
    return null;
  }
  const actorId = actorViewId(actorOrId, order);
  if (order.actorId && order.actorId !== actorId) return null;
  order.actorId = actorId;

  if (actorOrId && typeof actorOrId === 'object') {
    actorOrId.shipmentOrderId = order.id;
    actorOrId.shipmentViewId = actorId;
    actorOrId.isCargoVan = true;
  }

  return {
    actorId,
    shipmentOrderId: order.id,
    vanClassId: order.vanClassId,
    sourceStationId: order.sourceStationId,
    targetStationId: order.targetStationId,
    factionId: order.factionId,
    status: order.status,
    viewState: order.viewState ? { ...order.viewState } : null
  };
}

/** Zapisuje wyłącznie małą migawkę widoku; nie ustawia `dead` i nie dotyka cargo. */
export function dematerializeShipmentOrderView(order, actorOrId = null, snapshot = null) {
  if (!order || !order.actorId) return false;
  const actorId = actorViewId(actorOrId, order);
  if (actorOrId != null && actorId !== order.actorId) return false;
  const actor = actorOrId && typeof actorOrId === 'object' ? actorOrId : null;
  order.viewState = serializableViewState(snapshot || actor);
  if (order.status === SHIPMENT_STATUS.IN_TRANSIT && order.viewState) {
    const duration = Math.max(0, Number(order.route?.durationSeconds) || 0);
    const rawProgress = Number(order.viewState.routeProgress);
    if (Number.isFinite(rawProgress)) {
      const progress = Math.max(0, Math.min(1, rawProgress));
      order.routeProgress = progress;
      order.elapsedSeconds = duration * progress;
      order.remainingSeconds = Math.max(0, duration - order.elapsedSeconds);
      order.viewState.recordElapsedSeconds = order.elapsedSeconds;
      const clockTime = Number(order.viewState.clockTime);
      if (Number.isFinite(clockTime)) order.eta = clockTime + order.remainingSeconds;
    }
  }
  order.actorId = null;
  if (actor) {
    delete actor.shipmentOrderId;
    delete actor.shipmentViewId;
  }
  return true;
}

export function getShipmentOrder(state, orderId) {
  const id = String(orderId || '');
  return Array.isArray(state?.orders) ? state.orders.find(order => order?.id === id) || null : null;
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

/** Opis ładunku do HUD-u i skanera. */
export function describeCargo(cargo) {
  const parts = [];
  for (const [id, amount] of Object.entries(cargo || {})) {
    if (amount <= 0) continue;
    parts.push(`${RESOURCES[id]?.label || id} ×${Math.round(amount)}`);
  }
  return parts.join(', ');
}

export function cargoMass(cargo) {
  return getBagMass(cargo);
}

/** Łączna wartość ładunku w CR — do wyceny łupu i nagród za eskortę. */
export function cargoValue(cargo) {
  let total = 0;
  for (const [id, amount] of Object.entries(cargo || {})) {
    total += (RESOURCES[id]?.value || 0) * (Number(amount) || 0);
  }
  return total;
}
