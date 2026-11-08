// Kapsuły ratunkowe (E22, reguła `kapsuly-ratunkowe`): pula 2D, wyrzut, lot, dolot, trasa omijająca ring i doki.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POD_TUNE, POD_STATE, POD_KIND, createEscapePods, launchEscapePods, stepEscapePods, setEscapePodRoute,
  escapePodCount, escapePodsAllowed, fillEscapePodRenderFrame, escapePodRemaining
} from '../src/game/escapePods.js';
import {
  createEscapePodRouter, syncEscapePodRouter, pickEscapePodStation, routeEscapePod, POD_PATH_STRIDE
} from '../src/game/escapePodRoutes.js';
import { createRingObstacle, pointInRingSlab, transitIndexAt } from '../src/game/traffic/ringRouter.js';
import { createPath } from '../src/game/traffic/portPaths.js';
import { PortDockWorld } from '../src/game/portDockWorld.js';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

const X0 = 5_000_000;
const Y0 = 4_000_000;

/** Prosty router testu: prosta do punktu `targets[target]`. */
function straightEnv(pods, targets, extra = {}) {
  const path = createPath(8);
  const arrivals = [];
  const env = {
    px: X0, py: Y0, hasPlayer: true,
    route(i, x, y, target) {
      const t = targets[target];
      path.count = 0;
      path.data[0] = x; path.data[1] = y; path.data[2] = Infinity;
      path.data[POD_PATH_STRIDE] = t.x; path.data[POD_PATH_STRIDE + 1] = t.y; path.data[POD_PATH_STRIDE + 2] = Infinity;
      path.count = 2;
      return setEscapePodRoute(pods, i, path, POD_PATH_STRIDE) > 0;
    },
    onArrive(target, people, kind, course, x, y) { arrivals.push({ target, people, kind, course, x, y }); },
    ...extra
  };
  return { env, arrivals };
}

test('dopuszczenie: piraci, myśliwce i drony bez kapsuł; frakcje i cywile z kapsułami', () => {
  assert.equal(escapePodsAllowed({ isPirate: true, factionId: 'pirates' }), false);
  assert.equal(escapePodsAllowed({ factionId: 'pirates' }), false, 'frakcja piratów');
  assert.equal(escapePodsAllowed({ factionId: 'terra_nova', hull: 'pirate_destroyer' }), false, 'kadłub piracki');
  assert.equal(escapePodsAllowed({ factionId: null, type: 'pirate_supercapital' }), false, 'typ piracki');
  assert.equal(escapePodsAllowed({ factionId: 'terra_nova', type: 'fighter' }), false, 'myśliwiec');
  assert.equal(escapePodsAllowed({ factionId: 'terra_nova', fighter: true }), false);
  assert.equal(escapePodsAllowed({ factionId: 'consortium', hull: 'repair_drone' }), false, 'dron');
  assert.equal(escapePodsAllowed({ factionId: 'terra_nova', hull: 'terran_destroyer', type: 'destroyer' }), true);
  assert.equal(escapePodsAllowed({ factionId: 'consortium', hull: 'megafreighter' }), true);
  assert.equal(escapePodsAllowed({ factionId: null, hull: 'container_ship' }), true, 'bez frakcji — cywil');
  assert.equal(escapePodsAllowed(null), false);
});

test('liczba kapsuł z długości kadłuba: mały 1–2, frachtowiec kilka, kapitał i megafrachtowiec więcej', () => {
  assert.equal(escapePodCount(200), 1, 'prom');
  assert.equal(escapePodCount(320), 2, 'fregata');
  assert.equal(escapePodCount(520), 3, 'kontenerowiec');
  assert.equal(escapePodCount(900), 4, 'frachtowiec dalekiego zasięgu');
  assert.equal(escapePodCount(1040), 4, 'pancernik');
  assert.equal(escapePodCount(1800), 6, 'lotniskowiec');
  assert.equal(escapePodCount(3000), 8, 'ciężki frachtowiec');
  assert.equal(escapePodCount(4600), 12, 'megafrachtowiec');
  for (let l = 50; l < 6000; l += 37) assert.ok(escapePodCount(l + 37) >= escapePodCount(l), 'rośnie z długością');
});

test('wyrzut: najpierw chwila w kadłubie (jedzie z wrakiem), potem 100% pędu kadłuba + impuls z burty', () => {
  const pods = createEscapePods();
  const targets = [{ x: X0 + 60_000, y: Y0 }];
  const { env } = straightEnv(pods, targets);
  const hull = { x: X0, y: Y0, vx: 120, vy: -40, angle: 0.7, length: 1040, width: 330 };
  const n = launchEscapePods(pods, { ...hull, seed: 42, target: 0, people: 9, kind: POD_KIND.CREW }, env);
  assert.equal(n, 4);
  assert.equal(pods.count, 4);
  let people = 0;
  for (let i = 0; i < n; i++) {
    assert.equal(pods.state[i], POD_STATE.PENDING);
    people += pods.people[i];
    // Miejsce na burcie: w poprzek osi ± pół szerokości.
    const dx = pods.x[i] - X0;
    const dy = pods.y[i] - Y0;
    const across = -dx * Math.sin(hull.angle) + dy * Math.cos(hull.angle);
    assert.ok(Math.abs(Math.abs(across) - hull.width / 2) < 1e-6, `kapsuła ${i} na burcie`);
  }
  assert.equal(people, 9, 'ludzie po równo, reszta w pierwszej');
  // W kadłubie do opóźnienia: jedzie z pędem wraku.
  const dt = 1 / 60;
  const x0 = pods.x[0];
  for (let k = 0; k < 60; k++) stepEscapePods(pods, dt, env);
  assert.equal(pods.state[0], POD_STATE.PENDING, 'po 1 s jeszcze w kadłubie');
  assert.ok(Math.abs(pods.x[0] - (x0 + hull.vx * 1)) < 1e-6, 'jedzie z wrakiem');
  for (let k = 0; k < 150; k++) stepEscapePods(pods, dt, env);
  for (let i = 0; i < n; i++) {
    assert.notEqual(pods.state[i], POD_STATE.PENDING, `kapsuła ${i} wyrzucona`);
  }
  // Dryf po wyrzucie: prędkość = kadłub + impuls (silnik jeszcze nie pracuje).
  const fresh = createEscapePods();
  launchEscapePods(fresh, { ...hull, seed: 42, target: -1, delay: 0 }, env);
  // Odstęp 0,22 s między kapsułami: po 0,75 s wszystkie wyrzucone, dryf (1,3 s) trwa jeszcze u każdej.
  for (let k = 0; k < 45; k++) stepEscapePods(fresh, dt, env);
  for (let i = 0; i < fresh.count; i++) {
    assert.equal(fresh.state[i], POD_STATE.COAST, `kapsuła ${i} w dryfie`);
    const rvx = fresh.vx[i] - hull.vx;
    const rvy = fresh.vy[i] - hull.vy;
    const ej = Math.sqrt(rvx * rvx + rvy * rvy);
    assert.ok(ej >= POD_TUNE.ejectMin - 1e-3 && ej <= POD_TUNE.ejectMax + 1e-3, `impuls ${ej}`);
    // Na zewnątrz: impuls od osi kadłuba (składowa poprzeczna ze znakiem burty).
    const dx = fresh.x[i] - X0;
    const dy = fresh.y[i] - Y0;
    const side = -dx * Math.sin(hull.angle) + dy * Math.cos(hull.angle);
    const out = -rvx * Math.sin(hull.angle) + rvy * Math.cos(hull.angle);
    assert.ok(side * out > 0, 'wylot na zewnątrz kadłuba');
  }
});

test('lot do stacji: silnik po dryfie, dolot znika z puli, `onArrive` z ludźmi; bez celu — dryf do rozliczenia', () => {
  const pods = createEscapePods();
  const targets = [{ x: X0 + 20_000, y: Y0 + 5_000 }];
  const { env, arrivals } = straightEnv(pods, targets);
  launchEscapePods(pods, { x: X0, y: Y0, vx: 0, vy: 0, angle: 0, length: 3000, width: 600, seed: 7, target: 0, people: 80, kind: POD_KIND.FERRY, course: 1234 }, env);
  assert.equal(pods.count, 8);
  let t = 0;
  let sawEngine = false;
  const frame = { cap: 64, count: 0, x: new Float64Array(64), y: new Float64Array(64), ang: new Float32Array(64), thrust: new Float32Array(64), age: new Float32Array(64), seed: new Int32Array(64), uid: new Int32Array(64), flags: new Uint8Array(64) };
  while (pods.count > 0 && t < 200) {
    stepEscapePods(pods, 1 / 60, env);
    t += 1 / 60;
    fillEscapePodRenderFrame(pods, frame, 0);
    for (let i = 0; i < frame.count; i++) if (frame.flags[i] & 1) sawEngine = true;
  }
  assert.equal(pods.count, 0, `wszystkie doleciały (t = ${t.toFixed(1)} s)`);
  assert.ok(sawEngine, 'płomień silnika w obrazie');
  assert.equal(arrivals.length, 8);
  assert.equal(arrivals.reduce((s, a) => s + a.people, 0), 80);
  for (const a of arrivals) {
    assert.equal(a.kind, POD_KIND.FERRY);
    assert.equal(a.course, 1234);
    assert.ok(Math.hypot(a.x - targets[0].x, a.y - targets[0].y) <= POD_TUNE.arriveR + 1e-6, 'dolot w celu');
  }
  // 20,6 tys. j. przy 900 j./s i 170 j./s² — ~30 s.
  assert.ok(t > 22 && t < 60, `czas lotu ${t.toFixed(1)} s`);
  assert.equal(pods.stats.arrived, 8);
});

test('rozliczenie bez obrazu: daleko od gracza → dolot po czasie z pozostałej trasy', () => {
  const pods = createEscapePods();
  const targets = [{ x: X0 + 300_000, y: Y0 }];
  const { env, arrivals } = straightEnv(pods, targets);
  launchEscapePods(pods, { x: X0 + 39_500, y: Y0, vx: 0, vy: 0, angle: 0, length: 300, width: 100, seed: 3, target: 0, people: 4 }, env);
  for (let k = 0; k < 600 && pods.count; k++) stepEscapePods(pods, 1 / 60, env);
  assert.equal(pods.count, 0, 'kapsuły zeszły z obrazu');
  assert.equal(pods.transit.count, 2);
  assert.equal(arrivals.length, 0, 'jeszcze lecą');
  const eta = Math.max(pods.transit.eta[0], pods.transit.eta[1]);
  assert.ok(eta - pods.clock > 200, `zostało ~${(eta - pods.clock).toFixed(0)} s lotu`);
  while (pods.transit.count && pods.clock < eta + 1) stepEscapePods(pods, 0.5, env);
  assert.equal(arrivals.length, 2);
  assert.equal(arrivals.reduce((s, a) => s + a.people, 0), 4);
  assert.ok(Number.isNaN(arrivals[0].x), 'bez pozycji — dolot bez obrazu');
  assert.equal(pods.stats.abstracted, 2);
  assert.equal(pods.stats.settled, 2);
});

test('determinizm i krok 60 / 120 Hz: ten sam przebieg (rozrzut z ziarna, stałe na sekundę)', () => {
  function run(hz) {
    const pods = createEscapePods();
    const targets = [{ x: X0 + 15_000, y: Y0 - 9_000 }];
    const { env, arrivals } = straightEnv(pods, targets);
    launchEscapePods(pods, { x: X0, y: Y0, vx: 300, vy: 50, angle: 1.1, length: 1800, width: 500, seed: 99, target: 0 }, env);
    const pos = [];
    let t = 0;
    for (let k = 0; k < hz * 3; k++) { stepEscapePods(pods, 1 / hz, env); t += 1 / hz; }
    for (let i = 0; i < pods.count; i++) pos.push([pods.uid[i], pods.x[i], pods.y[i]]);
    while (pods.count && t < 120) { stepEscapePods(pods, 1 / hz, env); t += 1 / hz; }
    return { pos: pos.sort((a, b) => a[0] - b[0]), t, n: arrivals.length };
  }
  const a = run(60);
  const b = run(60);
  assert.deepEqual(a, b, 'ten sam przebieg');
  const c = run(120);
  assert.equal(c.n, a.n);
  assert.ok(Math.abs(c.t - a.t) < 0.6, `czas dolotu 60 Hz ${a.t.toFixed(2)} s, 120 Hz ${c.t.toFixed(2)} s`);
  for (let i = 0; i < a.pos.length; i++) {
    const d = Math.hypot(a.pos[i][1] - c.pos[i][1], a.pos[i][2] - c.pos[i][2]);
    assert.ok(d < 15, `poza po 3 s różni się o ${d.toFixed(1)} j.`);
  }
});

test('pełna pula: najstarsza kapsuła w locie przechodzi w rozliczenie bez obrazu', () => {
  const pods = createEscapePods(6);
  const targets = [{ x: X0 + 50_000, y: Y0 }];
  const { env } = straightEnv(pods, targets);
  launchEscapePods(pods, { x: X0, y: Y0, angle: 0, length: 1040, width: 300, seed: 1, target: 0, delay: 0 }, env);
  for (let k = 0; k < 30; k++) stepEscapePods(pods, 1 / 60, env);
  launchEscapePods(pods, { x: X0, y: Y0 + 3000, angle: 0, length: 1040, width: 300, seed: 2, target: 0 }, env);
  assert.equal(pods.count, 6);
  assert.equal(pods.stats.evicted, 2);
  assert.equal(pods.transit.count, 2, 'zwolnione miejsce — rozliczenie bez obrazu');
  assert.equal(pods.stats.launched, 8);
});

test('wybór stacji: własna frakcja najbliższa, potem niepiracka; opuszczone, zniszczone i pirackie odpadają', () => {
  const stations = [
    { id: 'far-own', x: 100_000, y: 0, factionId: 'terra_nova' },
    { id: 'near-other', x: 10_000, y: 0, factionId: 'consortium' },
    { id: 'pirate', x: 1_000, y: 0, factionId: 'pirates', isPirate: true },
    { id: 'abandoned', x: 2_000, y: 0, factionId: null, abandoned: true },
    { id: 'dead', x: 3_000, y: 0, factionId: 'terra_nova', hp: 0 }
  ];
  assert.equal(stations[pickEscapePodStation(stations, 0, 0, 'terra_nova')].id, 'far-own');
  assert.equal(stations[pickEscapePodStation(stations, 0, 0, 'belt_union')].id, 'near-other');
  assert.equal(stations[pickEscapePodStation(stations, 0, 0, null)].id, 'near-other');
  assert.equal(stations[pickEscapePodStation(stations, 0, 0, 'terra_nova', 'near-other')].id, 'near-other', 'port nadania');
  assert.equal(stations[pickEscapePodStation(stations, 0, 0, 'terra_nova', 'pirate')].id, 'far-own', 'piracki port nadania odpada');
  assert.equal(pickEscapePodStation([stations[2], stations[3]], 0, 0, 'terra_nova'), -1);
});

/** Lot kapsuły po trasie routera z próbkowaniem pozycji co krok. */
function flyRouted(router, station, x, y, check) {
  const pods = createEscapePods(4);
  const env = {
    px: x, py: y, hasPlayer: false,
    route(i, ax, ay) {
      if (!routeEscapePod(router, router.path, ax, ay, station)) return false;
      return setEscapePodRoute(pods, i, router.path, POD_PATH_STRIDE) > 0;
    },
    onArrive() {}
  };
  launchEscapePods(pods, { x, y, angle: 0, length: 200, width: 60, seed: 5, target: 0, delay: 0 }, env);
  let t = 0;
  while (pods.count && t < 900) {
    stepEscapePods(pods, 1 / 60, env);
    t += 1 / 60;
    for (let i = 0; i < pods.count; i++) check(pods.x[i], pods.y[i]);
  }
  return { left: pods.count, t, stats: pods.stats };
}

test('trasa przez ring Ziemi: płyta tylko tranzytem, wejście do zatoki z przestrzeni lejkiem', () => {
  const router = createEscapePodRouter();
  syncEscapePodRouter(router, { planets: [{ id: 'earth', x: X0, y: Y0 }] });
  assert.equal(router.rings.length, 1, 'ring Ziemi');
  const ring = router.rings[0];
  assert.ok(createRingObstacle({ key: 'earth', x: X0, y: Y0 }).slabOuter === ring.slabOuter);
  // Stanowisko zatoki po drugiej stronie planety (strefa portu nad płytą), start w korytarzu wewnętrznym.
  const a = 2.2;
  const berthR = ring.slabOuter + 1800;
  const bay = { id: 'b1', x: X0 + Math.cos(a) * berthR, y: Y0 + Math.sin(a) * berthR, hall: 'bay' };
  const hall = { id: 'k1', x: X0 + Math.cos(a + 0.4) * berthR, y: Y0 + Math.sin(a + 0.4) * berthR, hall: 'K-7' };
  syncEscapePodRouter(router, { ports: { earth: [hall, bay] } });
  const station = { id: 'earth', x: hall.x, y: hall.y, factionId: 'terra_nova' };
  const startR = ring.innerR;
  const sx = X0 + Math.cos(a + Math.PI) * startR;
  const sy = Y0 + Math.sin(a + Math.PI) * startR;
  assert.ok(routeEscapePod(router, router.path, sx, sy, station));
  const p = router.path;
  const last = (p.count - 1) * POD_PATH_STRIDE;
  assert.ok(Math.hypot(p.data[last] - bay.x, p.data[last + 1] - bay.y) < 1, 'cel = zatoka, nie hala K-7');
  let transit = 0;
  const r = flyRouted(router, station, sx, sy, (x, y) => {
    assert.ok(!pointInRingSlab(ring, x, y), `kapsuła w płycie ringu (${Math.round(x - X0)}, ${Math.round(y - Y0)})`);
    if (transitIndexAt(ring, x, y) >= 0 && Math.hypot(x - X0, y - Y0) < ring.slabOuter) transit++;
  });
  assert.equal(r.left, 0, `doleciała (${r.t.toFixed(0)} s)`);
  assert.ok(transit > 0, 'przeleciała tranzytem');
});

test('trasa do doku bez ringu: lejek i korytarz stanowiska, żaden odcinek nie przecina brył', () => {
  const world = new PortDockWorld();
  const table = {
    ceres: { kind: 'cross', mix: 'default', repeats: 1, dockCount: 2, x: X0, y: Y0, angle: 0.4, keepR: 0, style: 'earth' },
    vesta: { kind: 'wheel', mix: 'default', repeats: 4, dockCount: 2, x: X0 + 90_000, y: Y0, angle: -0.9, keepR: 0, style: 'earth' }
  };
  world.sync(table, 3);
  const router = createEscapePodRouter();
  syncEscapePodRouter(router, { planets: [], docks: world.docks, docksVersion: world.version });
  assert.equal(router.discs.length, 8);
  for (const [id, d] of [['ceres', world.docks[0]], ['vesta', world.docks[1]]]) {
    const station = { id, x: d.x, y: d.y, factionId: 'belt_union' };
    for (const ang of [0, 1.7, 3.3, 4.9]) {
      const sx = d.x + Math.cos(ang) * (d.keepR + 9000);
      const sy = d.y + Math.sin(ang) * (d.keepR + 9000);
      assert.ok(routeEscapePod(router, router.path, sx, sy, station));
      const p = router.path;
      for (let k = 1; k < p.count; k++) {
        const o0 = (k - 1) * POD_PATH_STRIDE;
        const o1 = k * POD_PATH_STRIDE;
        assert.ok(!world.segmentHitsSolid(p.data[o0], p.data[o0 + 1], p.data[o1], p.data[o1 + 1]),
          `${id} z ${ang}: odcinek ${k} przecina bryłę`);
      }
      const r = flyRouted(router, station, sx, sy, (x, y) => {
        assert.ok(!world.pointInSolid(x, y), `${id} z ${ang}: kapsuła w bryle`);
      });
      assert.equal(r.left, 0, `${id} z ${ang}: doleciała`);
    }
  }
});

test('ramka obrazu: bez kapsuł w kadłubie, poza w chwili klatki, mgła wojny', () => {
  const pods = createEscapePods();
  const { env } = straightEnv(pods, [{ x: X0 + 30_000, y: Y0 }]);
  launchEscapePods(pods, { x: X0, y: Y0, vx: 100, vy: 0, angle: 0, length: 900, width: 300, seed: 11, target: 0 }, env);
  const frame = { cap: 64, count: 0, x: new Float64Array(64), y: new Float64Array(64), ang: new Float32Array(64), thrust: new Float32Array(64), age: new Float32Array(64), seed: new Int32Array(64), uid: new Int32Array(64), flags: new Uint8Array(64) };
  fillEscapePodRenderFrame(pods, frame, 0);
  assert.equal(frame.count, 0, 'w kadłubie — bez obrazu');
  for (let k = 0; k < 180; k++) stepEscapePods(pods, 1 / 60, env);
  fillEscapePodRenderFrame(pods, frame, 0.01);
  assert.equal(frame.count, 4);
  assert.ok(Math.abs(frame.x[0] - (pods.x[0] - pods.vx[0] * 0.01)) < 1e-9, 'poza cofnięta o lag');
  fillEscapePodRenderFrame(pods, frame, 0, (x) => x < pods.x[0]);
  assert.ok(frame.count < 4, 'mgła wojny odfiltrowała');
  assert.ok(escapePodRemaining(pods, 0) > 0);
});

test('krok bez alokacji: pełna pula w locie i rozliczenia bez obrazu', async () => {
  const pods = createEscapePods();
  const targets = [{ x: X0 + 900_000, y: Y0 }];
  const { env } = straightEnv(pods, targets);
  for (let s = 0; s < 20; s++) launchEscapePods(pods, { x: X0, y: Y0 + s * 500, angle: 0, length: 3000, width: 600, seed: s, target: 0, delay: 0 }, env);
  const step = () => stepEscapePods(pods, 1 / 60, env);
  for (let k = 0; k < 600; k++) step();
  const best = await untilSteady(() => allocatedBytes(step, 2000), (b) => b < 4096, { warm: () => { for (let k = 0; k < 200; k++) step(); } });
  assert.ok(best < 4096, `krok alokuje ${best} B / 2000 kroków`);
});
