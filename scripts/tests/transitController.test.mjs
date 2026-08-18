import {
  TRANSIT_PHASES,
  DEFAULT_TRANSIT_WARP_SPEED,
  buildWarpRoutes,
  getWarpRoute,
  isCompleteTransitRoute,
  assignTransitRoute,
  removeActorFromTransitQueues,
  refreshWarpRoutes
} from '../../src/game/transitController.js';
import { readFileSync } from 'node:fs';
import { createSuite, runIfMain } from './harness.mjs';

function station(id, x, y, inner) {
  return {
    id,
    x,
    y,
    inner,
    ports: [{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }],
    warpGate: { x: x + 20, y: y - 5 }
  };
}

export function run() {
  const t = createSuite('transitController');
  const earth = station('earth', 0, 0, true);
  const mars = station('mars', 300, 400, true);
  const jupiter = station('jupiter', 1200, 500, false);
  const stations = [earth, mars, jupiter];

  t.section('1. Pełna skierowana siatka warp');
  const routes = buildWarpRoutes(stations);
  t.equal('N stacji tworzy N*(N-1) tras', Object.keys(routes).length, 6);
  t.check('istnieje trasa inner → outer', !!getWarpRoute(routes, earth, jupiter));
  t.check('istnieje trasa outer → inner', !!getWarpRoute(routes, jupiter.id, earth.id));
  t.equal('nie istnieje pętla do tej samej stacji', getWarpRoute(routes, earth, earth), null);
  t.equal('brakująca para zwraca null', getWarpRoute(routes, 'earth', 'saturn'), null);

  const earthJupiter = getWarpRoute(routes, 'earth', 'jupiter');
  t.check('zbudowana trasa jest kompletna', isCompleteTransitRoute(earthJupiter));
  t.equal('trasa zachowuje referencję źródła', earthJupiter.fromRef, earth);
  t.equal('trasa zachowuje referencję celu', earthJupiter.toRef, jupiter);
  t.check('start ma dwie niezależne kolejki',
    earthJupiter.start.queues.length === 2
    && earthJupiter.start.queues[0] !== earthJupiter.start.queues[1]);

  t.section('2. Odświeżenie geometrii bez wymiany obiektów i kolejek');
  const routeRef = earthJupiter;
  const startRef = routeRef.start;
  const endRef = routeRef.end;
  const dirRef = routeRef.dir;
  const queuesRef = routeRef.start.queues;
  const lane0Ref = queuesRef[0];
  const sentinel = { id: 'queued' };
  lane0Ref.push(sentinel);
  earth.warpGate.x = 100;
  earth.warpGate.y = 100;
  jupiter.warpGate.x = 400;
  jupiter.warpGate.y = 500;
  const refreshed = refreshWarpRoutes(routes);
  t.equal('refresh zwraca ten sam rejestr', refreshed, routes);
  t.equal('obiekt trasy pozostaje ten sam', getWarpRoute(routes, 'earth', 'jupiter'), routeRef);
  t.equal('start pozostaje tym samym obiektem', routeRef.start, startRef);
  t.equal('koniec pozostaje tym samym obiektem', routeRef.end, endRef);
  t.equal('kierunek pozostaje tym samym obiektem', routeRef.dir, dirRef);
  t.equal('tablica kolejek pozostaje ta sama', routeRef.start.queues, queuesRef);
  t.equal('kolejka pasa pozostaje ta sama', routeRef.start.queues[0], lane0Ref);
  t.equal('zawartość kolejki nie znika', routeRef.start.queues[0][0], sentinel);
  t.close('start.x aktualizuje się z bramy źródłowej', routeRef.start.x, 100);
  t.close('end.y aktualizuje się z bramy docelowej', routeRef.end.y, 500);
  t.close('długość jest przeliczona w miejscu', routeRef.length, 500);
  t.close('kierunek X jest znormalizowany', routeRef.dir.x, 0.6);
  t.close('kierunek Y jest znormalizowany', routeRef.dir.y, 0.8);

  t.section('3. Atomowe przypisanie aktora do trasy');
  const actor = { maxSpeed: 175, vx: 12, vy: -4 };
  const assigned = assignTransitRoute(actor, earth, jupiter, routeRef, {
    lane: 1,
    dockPort: 2,
    random: () => 0.99
  });
  t.check('poprawna trasa zostaje przypisana', assigned);
  t.equal('źródło trafia do lastStation', actor.lastStation, 'earth');
  t.equal('cel trafia do target', actor.target, 'jupiter');
  t.equal('domyślna faza toGate', actor.phase, 'toGate');
  t.equal('pas jest ustawiony', actor.lane, 1);
  t.equal('port docelowy jest ustawiony', actor.dockPort, 2);
  t.equal('speed dziedziczy maxSpeed używany przez obecny NPC', actor.speed, 175);
  t.equal('start trasy zeruje vx', actor.vx, 0);
  t.equal('start trasy zeruje vy', actor.vy, 0);
  t.check('lista dozwolonych faz nie zawiera lotu po prostej',
    TRANSIT_PHASES.length === 3 && !TRANSIT_PHASES.includes('direct'));

  t.section('4. Wznowienie wspieranych faz i odrzucenie fallbacku');
  const warpActor = { maxSpeed: 140, vx: 0, vy: 0 };
  t.check('można wznowić fazę warping', assignTransitRoute(
    warpActor,
    earth,
    jupiter,
    routeRef,
    { phase: 'warping', lane: 0, dockPort: 0 }
  ));
  t.close('warping ustawia prędkość zgodnie z kierunkiem X',
    warpActor.vx, routeRef.dir.x * DEFAULT_TRANSIT_WARP_SPEED);
  t.close('warping ustawia prędkość zgodnie z kierunkiem Y',
    warpActor.vy, routeRef.dir.y * DEFAULT_TRANSIT_WARP_SPEED);
  t.check('można wznowić fazę toStation', assignTransitRoute(
    warpActor,
    earth,
    jupiter,
    routeRef,
    { phase: 'toStation', resetVelocity: false, lane: 0, dockPort: 0 }
  ));
  const beforeRejectedAssignment = { ...warpActor };
  t.equal('faza direct jest odrzucana', assignTransitRoute(
    warpActor,
    earth,
    jupiter,
    routeRef,
    { phase: 'direct' }
  ), false);
  t.equal('odrzucona faza nie zmienia phase', warpActor.phase, beforeRejectedAssignment.phase);
  t.equal('odrzucona faza nie zmienia route', warpActor.warpRoute, beforeRejectedAssignment.warpRoute);

  const missingRouteActor = { marker: 'unchanged' };
  t.equal('brak trasy jest odrzucany',
    assignTransitRoute(missingRouteActor, earth, jupiter, null), false);
  t.equal('odrzucenie nie mutuje aktora', Object.keys(missingRouteActor).length, 1);
  t.equal('trasa dla odwrotnego kierunku jest odrzucana',
    assignTransitRoute({}, earth, jupiter, getWarpRoute(routes, 'jupiter', 'earth')), false);

  t.section('5. Czyszczenie kolejek przy detach aktora');
  const otherActor = { id: 'other' };
  routeRef.start.queues[0].push(actor, otherActor, actor);
  routeRef.start.queues[1].push(actor);
  actor.warpRoute = routeRef;
  t.equal('usuwane są wszystkie wystąpienia z obu pasów',
    removeActorFromTransitQueues(actor), 3);
  t.check('aktor nie zostaje w żadnym pasie',
    routeRef.start.queues.every(queue => !queue.includes(actor)));
  t.check('pozostałe wpisy kolejki są zachowane',
    routeRef.start.queues[0].includes(sentinel) && routeRef.start.queues[0].includes(otherActor));
  t.equal('ponowne czyszczenie jest bezpieczne', removeActorFromTransitQueues(actor), 0);
  t.equal('aktor bez trasy jest bezpieczny', removeActorFromTransitQueues({}), 0);

  t.section('6. Integracja używa jednego movera i ma włączony dispatch');
  const indexSource = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  t.check('dispatch cargo jest jawnie włączony', /CARGO_DISPATCH_ENABLED\s*=\s*true/.test(indexSource));
  t.check('index nie ustawia fazy direct', !/phase\s*=\s*['"]direct['"]/.test(indexSource));
  t.check('usunięto kinematyczny mover vana',
    !indexSource.includes('van.x +=') && !indexSource.includes('van.y +=') && !indexSource.includes('cargoFleet.vans'));
  t.check('aktorzy cargo korzystają ze wspólnego przypisania i npcStep',
    indexSource.includes('assignTransitRoute(van, source, target, route')
    && indexSource.includes('function npcStep(dt'));
  t.check('wyjście z warpa zeruje prędkość przed podejściem',
    /if \(traveled >= route\.length\)[\s\S]{0,240}npc\.vx = 0;[\s\S]{0,80}npc\.vy = 0;/.test(indexSource));
  t.check('materializacja i dematerializacja mają histerezę 15/18 km',
    /CARGO_MATERIALIZE_RADIUS\s*=\s*15000/.test(indexSource)
    && /CARGO_DEMATERIALIZE_RADIUS\s*=\s*18000/.test(indexSource)
    && indexSource.includes('cargoDistanceToPlayerSq(van.x, van.y) > CARGO_DEMATERIALIZE_RADIUS')
    && indexSource.includes('<= CARGO_MATERIALIZE_RADIUS * CARGO_MATERIALIZE_RADIUS'));
  t.check('wrak ma osobny manifest partii transportowej',
    indexSource.includes('wreck._cargoManifest')
    && !indexSource.includes('return wreck._salvage.materials;'));
  const cargoUpdateSource = indexSource.slice(
    indexSource.indexOf('function updateCargoFleet(dt)'),
    indexSource.indexOf('// ============================================================', indexSource.indexOf('function updateCargoFleet(dt)'))
  );
  t.check('materializacja następuje przed analitycznym tickiem handoffu',
    cargoUpdateSource.indexOf('syncCargoOrderViews();') >= 0
    && cargoUpdateSource.indexOf('syncCargoOrderViews();') < cargoUpdateSource.indexOf('advanceShipmentOrders('));

  return t.results;
}

runIfMain(import.meta.url, run);
