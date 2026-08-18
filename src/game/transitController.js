/**
 * Shared inter-station transit helpers.
 *
 * The route objects deliberately match the legacy civil-NPC shape used by
 * index.html.  This module owns route construction and actor assignment only;
 * callers remain responsible for advancing actors or persistent cargo orders.
 */

export const TRANSIT_PHASES = Object.freeze(['toGate', 'warping', 'toStation']);
export const DEFAULT_TRANSIT_WARP_SPEED = 4000;

const VALID_TRANSIT_PHASES = new Set(TRANSIT_PHASES);

function stationId(stationOrId) {
  const value = (stationOrId && typeof stationOrId === 'object')
    ? stationOrId.id
    : stationOrId;
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function routeKey(fromId, toId) {
  return `${String(fromId)}-${String(toId)}`;
}

function stationCoordinate(station, axis) {
  const gateValue = station?.warpGate?.[axis];
  if (Number.isFinite(gateValue)) return gateValue;
  const stationValue = station?.[axis];
  return Number.isFinite(stationValue) ? stationValue : 0;
}

function updateRouteGeometry(route) {
  const from = route.fromRef;
  const to = route.toRef;
  const sx = stationCoordinate(from, 'x');
  const sy = stationCoordinate(from, 'y');
  const ex = stationCoordinate(to, 'x');
  const ey = stationCoordinate(to, 'y');
  const dx = ex - sx;
  const dy = ey - sy;
  const distance = Math.hypot(dx, dy);

  route.start.x = sx;
  route.start.y = sy;
  route.end.x = ex;
  route.end.y = ey;
  route.dir.x = distance > 0 ? dx / distance : 0;
  route.dir.y = distance > 0 ? dy / distance : 0;
  route.length = distance;
}

/**
 * Creates a directed route for every pair of distinct stations.  Inner/outer
 * classification intentionally has no effect: cargo must be able to cross it.
 */
export function buildWarpRoutes(stations) {
  const routes = {};
  if (!Array.isArray(stations)) return routes;

  for (const from of stations) {
    const fromId = stationId(from);
    if (fromId === null) continue;

    for (const to of stations) {
      const toId = stationId(to);
      if (toId === null || String(fromId) === String(toId)) continue;

      const route = {
        from: fromId,
        to: toId,
        fromRef: from,
        toRef: to,
        start: { x: 0, y: 0, queues: [[], []] },
        end: { x: 0, y: 0 },
        dir: { x: 0, y: 0 },
        length: 0
      };
      updateRouteGeometry(route);
      routes[routeKey(fromId, toId)] = route;
    }
  }

  return routes;
}

/** Returns the exact directed route, or null when the pair is unavailable. */
export function getWarpRoute(routes, fromId, toId) {
  const from = stationId(fromId);
  const to = stationId(toId);
  if (!routes || from === null || to === null || String(from) === String(to)) return null;
  return routes[routeKey(from, to)] || null;
}

/** True only for a route that the existing NPC transit mover can consume. */
export function isCompleteTransitRoute(route) {
  return !!(
    route
    && stationId(route.from) !== null
    && stationId(route.to) !== null
    && String(route.from) !== String(route.to)
    && route.fromRef
    && route.toRef
    && route.start
    && Number.isFinite(route.start.x)
    && Number.isFinite(route.start.y)
    && Array.isArray(route.start.queues)
    && route.start.queues.length >= 2
    && Array.isArray(route.start.queues[0])
    && Array.isArray(route.start.queues[1])
    && route.end
    && Number.isFinite(route.end.x)
    && Number.isFinite(route.end.y)
    && route.dir
    && Number.isFinite(route.dir.x)
    && Number.isFinite(route.dir.y)
    && Number.isFinite(route.length)
    && route.length >= 0
  );
}

/**
 * Removes every occurrence of an actor from both lanes of its current route.
 * This must run before death, dematerialization, or reassignment so a stale
 * reference cannot block the head of a gate queue.
 */
export function removeActorFromTransitQueues(actor) {
  const queues = actor?.warpRoute?.start?.queues;
  if (!Array.isArray(queues)) return 0;

  let removed = 0;
  for (let lane = 0; lane < queues.length; lane++) {
    const queue = queues[lane];
    if (!Array.isArray(queue)) continue;
    for (let index = queue.length - 1; index >= 0; index--) {
      if (queue[index] !== actor) continue;
      queue.splice(index, 1);
      removed++;
    }
  }
  return removed;
}

function normalizedLane(value, random) {
  if (Number.isFinite(value)) return Math.abs(Math.trunc(value)) % 2;
  return random() < 0.5 ? 0 : 1;
}

function normalizedPort(value, portCount, random) {
  if (portCount <= 0) return 0;
  if (Number.isFinite(value)) {
    const integer = Math.trunc(value);
    return ((integer % portCount) + portCount) % portCount;
  }
  const roll = Math.max(0, Math.min(0.999999999999, Number(random()) || 0));
  return Math.floor(roll * portCount);
}

/**
 * Assigns an actor to an already validated inter-station route.
 *
 * Returns false without mutating the actor when the route is absent,
 * incomplete, mismatched, or requests an unsupported phase.
 */
export function assignTransitRoute(actor, source, target, route, opts = {}) {
  const sourceId = stationId(source);
  const targetId = stationId(target);
  const phase = opts.phase ?? 'toGate';

  if (!actor || sourceId === null || targetId === null) return false;
  if (!VALID_TRANSIT_PHASES.has(phase)) return false;
  if (!isCompleteTransitRoute(route)) return false;
  if (String(route.from) !== String(sourceId) || String(route.to) !== String(targetId)) return false;

  const random = typeof opts.random === 'function' ? opts.random : Math.random;
  const lane = normalizedLane(opts.lane, random);
  const dockPort = normalizedPort(opts.dockPort, target?.ports?.length || 0, random);
  const requestedSpeed = Number(opts.speed);
  const currentSpeed = Number(actor.speed);
  const maxSpeed = Number(actor.maxSpeed);
  const speed = requestedSpeed > 0
    ? requestedSpeed
    : currentSpeed > 0
      ? currentSpeed
      : maxSpeed > 0 ? maxSpeed : 0;
  const requestedFade = Number(opts.fade);
  const currentFade = Number(actor.fade);
  const fade = Number.isFinite(requestedFade)
    ? requestedFade
    : Number.isFinite(currentFade) ? currentFade : 1;

  // Validation is complete, so mutations can now happen atomically.
  removeActorFromTransitQueues(actor);
  actor.lastStation = sourceId;
  actor.target = targetId;
  actor.dockPort = dockPort;
  actor.warpRoute = route;
  actor.phase = phase;
  actor.lane = lane;
  actor.docking = false;
  actor.fade = fade;
  actor.speed = speed;

  if (phase === 'warping') {
    const requestedWarpSpeed = Number(opts.warpSpeed);
    const currentVelocity = Math.hypot(Number(actor.vx) || 0, Number(actor.vy) || 0);
    const warpSpeed = requestedWarpSpeed > 0
      ? requestedWarpSpeed
      : currentVelocity > 0 ? currentVelocity : DEFAULT_TRANSIT_WARP_SPEED;
    actor.vx = route.dir.x * warpSpeed;
    actor.vy = route.dir.y * warpSpeed;
  } else if (opts.resetVelocity !== false) {
    actor.vx = 0;
    actor.vy = 0;
  }

  return true;
}

/**
 * Refreshes geometry after stations move, preserving route objects, endpoint
 * objects, direction objects, and queue arrays by reference.
 */
export function refreshWarpRoutes(routes) {
  if (!routes || typeof routes !== 'object') return routes;
  for (const key in routes) {
    if (!Object.prototype.hasOwnProperty.call(routes, key)) continue;
    const route = routes[key];
    if (!route?.fromRef || !route?.toRef || !route.start || !route.end || !route.dir) continue;
    updateRouteGeometry(route);
  }
  return routes;
}
