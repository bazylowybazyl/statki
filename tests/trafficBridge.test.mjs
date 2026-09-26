import test from 'node:test';
import assert from 'node:assert/strict';

import { TrafficBridge } from '../src/game/trafficBridge.js';
import { createTrafficCore } from '../src/game/traffic/trafficCore.js';
import { TRAFFIC_MSG, COURSE_STRIDE, COURSE_FIELD } from '../src/game/traffic/trafficProtocol.js';

const OPTS = { seed: 3, economyScale: 2, capacityMultiplier: 4, piracyPressure: 0 };

/**
 * Worker na niby: wiadomości czekają w kolejkach, a test decyduje, kiedy
 * rdzeń je przerobi i kiedy odpowiedzi dojdą do gry — tak można odtworzyć
 * wyścig, którego prawdziwy worker nie daje złapać w teście.
 */
class FakeWorker {
  constructor() {
    this.toWorker = [];
    this.toGame = [];
    this.core = createTrafficCore(message => this.toGame.push(message));
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
  }

  postMessage(message) {
    this.toWorker.push(structuredClone(message));
  }

  work(limit = Infinity) {
    let done = 0;
    while (this.toWorker.length && done < limit) {
      this.core.handle(this.toWorker.shift());
      done++;
    }
    return done;
  }

  deliver() {
    while (this.toGame.length) this.onmessage?.({ data: this.toGame.shift() });
  }

  terminate() {
    this.terminated = true;
  }
}

test('bez Workera most sam przechodzi na główny wątek', async () => {
  const bridge = new TrafficBridge();
  assert.equal(bridge.useWorker, false, 'Node nie ma Web Workera');
  const ready = await bridge.init(OPTS);
  assert.equal(bridge.mode, 'main-fallback');
  assert.equal(bridge.ready, true);
  assert.equal(ready.stations.length, 34);
  assert.ok(bridge.hasStation('earth'));
  assert.equal(bridge.hasStation('PIR'), false, 'misyjna kryjówka nie należy do świata ruchu');
  assert.ok(bridge.getEconomy('earth').resources.iron_ore > 0, 'rynek przychodzi razem ze startem');
  assert.ok(bridge.takeMainThreadMs() > 0, 'budowa świata na głównym wątku liczy się do kosztu');
  assert.equal(bridge.takeMainThreadMs(), 0, 'odczyt zeruje licznik');
});

test('advance co klatkę: krok świata co 5 s czasu gry, pauza = brak kroków', async () => {
  const bridge = new TrafficBridge({ useWorker: false, coreFactory: createTrafficCore });
  await bridge.init(OPTS);
  let steps = 0;
  bridge.on('tick', message => { steps += message.steps; });
  for (let i = 0; i < 600; i++) bridge.advance(1 / 60);
  assert.equal(steps, 2);
  assert.ok(Math.abs(bridge.time - 10) < 1e-9);
  assert.equal(bridge.clock, 10);
  bridge.advance(0);
  bridge.advance(-3);
  assert.ok(Math.abs(bridge.time - 10) < 1e-9, 'zero i ujemne dt nic nie robią');
});

test('bańka: odcinki kursów da się interpolować po stronie gry', async () => {
  const bridge = new TrafficBridge({ useWorker: false, coreFactory: createTrafficCore });
  const ready = await bridge.init(OPTS);
  const earth = ready.stations.find(entry => entry.id === 'earth');
  bridge.setFocus(earth.x, earth.y, 5_000_000, true);
  for (let i = 0; i < 400; i++) bridge.advance(5);
  assert.ok(bridge.courses.count > 0, 'przy promieniu całego układu coś zawsze leci');
  const out = {};
  for (let i = 0; i < bridge.courses.count; i++) {
    bridge.coursePosition(i, out);
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y));
    assert.equal(typeof bridge.courseHull(i), 'string');
    assert.ok(bridge.courseHull(i).length > 0);
  }
  const data = bridge.courses.data;
  const moving = [...Array(bridge.courses.count).keys()].find(i => data[i * COURSE_STRIDE + COURSE_FIELD.DUR] > 0);
  assert.notEqual(moving, undefined);
  const start = bridge.coursePosition(moving, {}, data[moving * COURSE_STRIDE + COURSE_FIELD.T0]);
  assert.equal(start.x, data[moving * COURSE_STRIDE + COURSE_FIELD.X0]);
  assert.equal(start.y, data[moving * COURSE_STRIDE + COURSE_FIELD.Y0]);
});

test('handel: kopia rynku zmienia się od razu i nie miga, gdy worker jest w tyle', async () => {
  const fake = new FakeWorker();
  const bridge = new TrafficBridge({ workerFactory: () => fake });
  const readyPromise = bridge.init(OPTS);
  assert.equal(bridge.mode, 'worker');
  fake.work();
  fake.deliver();
  await readyPromise;

  const worldEcon = () => fake.core.world.getEconomy('earth');
  const mirror = bridge.getEconomy('earth');
  const przed = mirror.resources.steel;
  assert.equal(przed, worldEcon().resources.steel);

  // Gra przewija 5 s, a zaraz potem gracz kupuje stal. Worker przerobi
  // najpierw same klatki — jego rynek jeszcze NIE zna zakupu.
  for (let i = 0; i < 300; i++) bridge.advance(1 / 60);
  const applied = bridge.stockDelta('earth', { steel: -10 });
  assert.equal(applied.steel, -10);
  assert.equal(mirror.resources.steel, przed - 10, 'terminal widzi zakup w tej samej klatce');

  fake.work(300);
  const worldBefore = worldEcon().resources.steel;
  fake.deliver();
  assert.equal(bridge.getStats().pendingStock, 1, 'zakup czeka na potwierdzenie');
  assert.equal(mirror.resources.steel, worldBefore - 10,
    'stary rynek z workera nie cofa zakupu w kopii');

  // Teraz worker widzi zakup; następny tick go potwierdza.
  fake.work();
  for (let i = 0; i < 300; i++) bridge.advance(1 / 60);
  fake.work();
  fake.deliver();
  assert.equal(bridge.getStats().pendingStock, 0);
  assert.equal(mirror.resources.steel, worldEcon().resources.steel,
    'po potwierdzeniu kopia = magazyn świata, bez podwójnego odjęcia');
});

test('worker padł przed startem: ten sam świat rusza na głównym wątku', async () => {
  let fake = null;
  const bridge = new TrafficBridge({
    workerFactory: () => {
      fake = new FakeWorker();
      // Moduł workera się nie załadował — błąd przychodzi zamiast `ready`.
      setTimeout(() => fake.onerror?.({ message: 'import nie wyszedł', preventDefault() {} }), 0);
      return fake;
    }
  });
  const readyPromise = bridge.init(OPTS);
  bridge.advance(2.5);
  bridge.stockDelta('earth', { steel: 5 });
  bridge.advance(2.5);
  await readyPromise;
  assert.equal(bridge.mode, 'main-fallback');
  assert.match(bridge.fallbackReason, /import/);
  assert.equal(fake.terminated, true);
  assert.equal(bridge.clock, 5, 'wysłany czas nie przepadł — świat zrobił swój krok');
  assert.equal(bridge.getStats().pendingStock, 0, 'zmiana z przed startu też doszła');
});

test('błąd rdzenia trafia do zdarzeń, a most działa dalej', async () => {
  const bridge = new TrafficBridge({ useWorker: false, coreFactory: createTrafficCore });
  await bridge.init(OPTS);
  const errors = [];
  bridge.on('error', message => errors.push(message));
  // Rdzeń rzuca przy tej wiadomości (liczba, która nie daje się odczytać).
  bridge._send({ type: TRAFFIC_MSG.FOCUS, x: { valueOf() { throw new Error('zła liczba'); } }, y: 0, r: 10 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'zła liczba');
  assert.equal(bridge.lastError?.during, TRAFFIC_MSG.FOCUS);
  bridge.setConfig({ piracyPressure: 2 });
  bridge.advance(5);
  assert.equal(bridge.clock, 5);
  const snapshot = await bridge.requestSnapshot();
  assert.equal(snapshot.time, 5);
  assert.ok(snapshot.director.stats);
});

test('stacja zniszczona w grze: most dostaje nowe frakcje', async () => {
  const bridge = new TrafficBridge({ useWorker: false, coreFactory: createTrafficCore });
  await bridge.init(OPTS);
  assert.ok(bridge.getStation('venus').factionId);
  bridge.stationDestroyed('venus');
  bridge.advance(5);
  assert.equal(bridge.getStation('venus').factionId, null);
  assert.equal(bridge.getStation('venus').derelict, true);
  assert.equal(TRAFFIC_MSG.STATION, 'station');
});
