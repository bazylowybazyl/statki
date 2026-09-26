/**
 * Testy rdzenia workera ruchu (`trafficCore.js`).
 *
 * Najważniejszy jest pierwszy: świat prowadzony WIADOMOŚCIAMI (klatki po 1/60 s,
 * handel, pojemności, zestrzelony kurs, zniszczona stacja) kończy w dokładnie
 * tym samym stanie co ten sam świat prowadzony wywołaniami wprost. Dzięki temu
 * worker gry liczy to samo, co mierzy skrypt headless — przy tym samym ziarnie.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCE_KEYS } from '../../src/data/resources.js';
import { resourcePrice } from '../../src/game/stationEconomy.js';
import { getNode } from '../../src/game/traffic/travelNetwork.js';
import {
  COURSE_STATUS, STAGE_KIND, currentStage, getActiveCourses, getCourse
} from '../../src/game/traffic/courseRegistry.js';
import { courseWorldPosition, destroyCourse } from '../../src/game/traffic/trafficDirector.js';
import {
  buildTrafficWorld, stepTrafficWorld, applyWorldStockDelta, setWorldCapacityFromGame,
  destroyWorldStation, baseCapacityOf, TRAFFIC_STEP_SECONDS
} from '../../src/game/traffic/trafficWorld.js';
import { createTrafficCore } from '../../src/game/traffic/trafficCore.js';
import {
  TRAFFIC_MSG, COURSE_STRIDE, COURSE_FIELD as F, COURSE_FLAG, COURSE_KIND_SHIFT,
  COURSE_KIND_MASK, MARKET_FIELD, marketOffset, courseNumber
} from '../../src/game/traffic/trafficProtocol.js';
import { worldDigest } from './trafficWorld.test.mjs';

const OPTS = { seed: 42, economyScale: 4, capacityMultiplier: 4, piracyPressure: 1 };
const STEPS = 720;   // godzina gry
const FRAME = 1 / 60;

/** Rdzeń z pocztą w tablicy — tak samo jak w workerze, tylko bez wątku. */
function makeCore() {
  const inbox = [];
  const core = createTrafficCore(message => inbox.push(message));
  return { core, inbox };
}

function lastOf(inbox, type) {
  for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].type === type) return inbox[i];
  return null;
}

function firstCourseId(world, predicate) {
  const course = getActiveCourses(world.registry)
    .filter(predicate)
    .sort((a, b) => courseNumber(a.id) - courseNumber(b.id))[0];
  return course?.id || null;
}

export function run() {
  const t = createSuite('trafficCore');

  // ----------------------------------------------------------
  t.section('Wiadomości dają ten sam świat co wywołania wprost');

  const direct = buildTrafficWorld({ ...OPTS, directorOptions: { protectObserved: true } });
  const { core, inbox } = makeCore();
  core.handle({ type: TRAFFIC_MSG.INIT, ...OPTS });
  const ready = lastOf(inbox, TRAFFIC_MSG.READY);
  t.check('rdzeń odpowiada `ready`', !!ready);
  t.equal('tabela stacji ma cały świat', ready?.stations.length, direct.stations.length);
  t.check('od razu jest rynek (tick z 0 kroków)', lastOf(inbox, TRAFFIC_MSG.TICK)?.steps === 0);

  const earth = getNode(direct.network, 'earth');
  const focus = { x: earth.x, y: earth.y, r: 80_000 };
  const wreckedIds = { destroyed: null };
  /** Zmiany z gry wstrzykiwane po zadanym kroku, w obu światach tak samo. */
  const zmiany = {
    30: {
      direct: world => applyWorldStockDelta(world, 'earth', { iron_ore: -500, steel: 250 }),
      message: { type: TRAFFIC_MSG.STOCK, seq: 1, stationId: 'earth', bag: { iron_ore: -500, steel: 250 } }
    },
    60: {
      direct: world => setWorldCapacityFromGame(world, 'mars', { iron_ore: baseCapacityOf('iron_ore') + 640 }),
      message: { type: TRAFFIC_MSG.CAPACITY, stationId: 'mars', capacity: { iron_ore: baseCapacityOf('iron_ore') + 640 } }
    },
    300: {
      direct: world => {
        wreckedIds.destroyed = firstCourseId(world, course =>
          currentStage(course)?.kind === STAGE_KIND.TRAVEL && !!course.payload?.orderId);
        destroyCourse(world.director, getCourse(world.registry, wreckedIds.destroyed), { x: 10, y: 20 });
      },
      message: () => ({
        type: TRAFFIC_MSG.DESTROYED, course: courseNumber(wreckedIds.destroyed), x: 10, y: 20
      })
    },
    420: {
      direct: world => destroyWorldStation(world, 'venus'),
      message: { type: TRAFFIC_MSG.STATION, stationId: 'venus', destroyed: true }
    }
  };

  let ticks = 0;
  let frames = 0;
  let hulls = [];
  for (let step = 1; step <= STEPS; step++) {
    stepTrafficWorld(direct, TRAFFIC_STEP_SECONDS);
    zmiany[step]?.direct(direct);

    // Klatki po 1/60 s aż rdzeń zrobi ten sam krok. Liczymy odpowiedzi, nie
    // klatki — suma ułamków nie trafia dokładnie w 5 s i o to właśnie chodzi.
    while (ticks < step) {
      const before = inbox.length;
      core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: FRAME });
      frames++;
      if (frames % 6 === 0) core.handle({ type: TRAFFIC_MSG.FOCUS, ...focus });
      for (let i = before; i < inbox.length; i++) {
        const message = inbox[i];
        if (message.type === TRAFFIC_MSG.TICK) ticks += message.steps;
        if (message.bubble?.hulls) hulls = message.bubble.hulls;
        if (message.type === TRAFFIC_MSG.BUBBLE && message.hulls) hulls = message.hulls;
      }
    }
    const zmiana = zmiany[step];
    if (zmiana) core.handle(typeof zmiana.message === 'function' ? zmiana.message() : zmiana.message);
  }
  t.note(`${STEPS} kroków, ${frames} klatek, ${inbox.length} wiadomości z rdzenia`);
  t.check('ten sam kurs został rozbity w obu światach',
    getCourse(core.world.registry, wreckedIds.destroyed)?.status === COURSE_STATUS.WRECKED
    || !getCourse(core.world.registry, wreckedIds.destroyed));
  t.equal('ten sam zegar', core.world.registry.clock, direct.registry.clock);
  t.equal('te same statystyki dyspozytora',
    JSON.stringify(core.world.director.stats), JSON.stringify(direct.director.stats));
  t.check('ten sam stan świata (kursy, magazyny, floty, wojna, piractwo)',
    worldDigest(core.world) === worldDigest(direct));
  t.check('coś się w ogóle działo', direct.director.stats.hauls > 20 && direct.director.stats.delivered > 0,
    `(przewozy ${direct.director.stats.hauls}, dostawy ${direct.director.stats.delivered})`);
  t.check('ruch przy Ziemi był widać w bańce',
    inbox.some(message => message.type === TRAFFIC_MSG.TICK && message.bubble.count > 0));

  // ----------------------------------------------------------
  t.section('Bańka zgadza się z pozycją rekordu');

  const tick = lastOf(inbox, TRAFFIC_MSG.TICK);
  const world = core.world;
  const { data, count, clock } = tick.bubble;
  const numery = new Map(getActiveCourses(world.registry).map(course => [courseNumber(course.id), course]));
  let zgodnePozycje = 0;
  let zgodneFlagi = 0;
  let zgodneKadluby = 0;
  let maxBlad = 0;
  for (let i = 0; i < count; i++) {
    const o = i * COURSE_STRIDE;
    const course = numery.get(data[o + F.ID]);
    if (!course) continue;
    const dur = data[o + F.DUR];
    const u = dur > 0 ? Math.min(1, Math.max(0, (clock - data[o + F.T0]) / dur)) : 1;
    const x = data[o + F.X0] + (data[o + F.X1] - data[o + F.X0]) * u;
    const y = data[o + F.Y0] + (data[o + F.Y1] - data[o + F.Y0]) * u;
    const oczekiwana = courseWorldPosition(world.network, course);
    const blad = Math.hypot(x - oczekiwana.x, y - oczekiwana.y);
    maxBlad = Math.max(maxBlad, blad);
    if (blad < 1e-6) zgodnePozycje++;
    const flags = data[o + F.FLAGS];
    const kind = tick.bubble && ready.kinds[(flags >>> COURSE_KIND_SHIFT) & COURSE_KIND_MASK];
    const dwell = currentStage(course)?.kind === STAGE_KIND.DWELL;
    if (kind === course.kind && !!(flags & COURSE_FLAG.DWELL) === dwell
      && !!(flags & COURSE_FLAG.BLOCKED) === !!course.blocked) zgodneFlagi++;
    if (hulls[data[o + F.HULL]] === course.unitClass) zgodneKadluby++;
  }
  t.check('w bańce przy Ziemi są kursy', count > 0, `(${count})`);
  t.equal('każdy rekord to żywy kurs', [...Array(count).keys()]
    .filter(i => numery.has(data[i * COURSE_STRIDE + F.ID])).length, count);
  t.equal('odcinek w chwili ticku = courseWorldPosition', zgodnePozycje, count);
  t.note(`największa różnica ${maxBlad.toExponential(2)} j.`);
  t.equal('rodzaj, postój i kolejka zgadzają się z rekordem', zgodneFlagi, count);
  t.equal('tabela kadłubów wskazuje klasę jednostki', zgodneKadluby, count);
  let pominiete = 0;
  for (const course of getActiveCourses(world.registry)) {
    const at = courseWorldPosition(world.network, course);
    if (!at || Math.hypot(at.x - focus.x, at.y - focus.y) > focus.r * 0.9) continue;
    if (![...Array(count).keys()].some(i => data[i * COURSE_STRIDE + F.ID] === courseNumber(course.id))) pominiete++;
  }
  t.equal('żaden kurs w promieniu bańki nie jest pominięty', pominiete, 0);

  // ----------------------------------------------------------
  t.section('Rynek w buforze');

  const stationIndex = ready.stations.findIndex(entry => entry.id === 'earth');
  const station = world.stations.find(entry => entry.id === 'earth');
  const econ = world.getEconomy('earth');
  let rynekZgodny = true;
  RESOURCE_KEYS.forEach((key, r) => {
    const o = marketOffset(stationIndex, r, ready.resources.length);
    const price = resourcePrice(station, econ, key);
    if (tick.market[o + MARKET_FIELD.STOCK] !== econ.resources[key]
      || tick.market[o + MARKET_FIELD.CAPACITY] !== econ.capacity[key]
      || tick.market[o + MARKET_FIELD.BID] !== price.bid
      || tick.market[o + MARKET_FIELD.ASK] !== price.ask) rynekZgodny = false;
  });
  t.check('zapas, pojemność i ceny Ziemi = magazyn świata', rynekZgodny);
  t.equal('kolejność surowców = RESOURCE_KEYS', ready.resources.join(), RESOURCE_KEYS.join());

  // ----------------------------------------------------------
  t.section('Handel przez wiadomości');

  core.handle({ type: TRAFFIC_MSG.STOCK, seq: 99, stationId: 'earth', bag: { steel: -1e12 } });
  t.equal('zakup ponad zapas zdejmuje tylko to, co jest', econ.resources.steel, 0);
  let wynik = null;
  while (!wynik) {
    const before = inbox.length;
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 });
    wynik = inbox.slice(before).find(message => message.type === TRAFFIC_MSG.TICK) || null;
  }
  t.equal('następny tick potwierdza numer zmiany', wynik.stockSeq, 99);

  // ----------------------------------------------------------
  t.section('Encja w grze przejmuje zegar kursu');

  const przypiety = getActiveCourses(world.registry).find(course =>
    currentStage(course)?.kind === STAGE_KIND.TRAVEL && currentStage(course).seconds > 60);
  const numer = courseNumber(przypiety.id);
  core.handle({ type: TRAFFIC_MSG.ATTACH, course: numer });
  t.check('attach przypina encję', !!przypiety.actorId);
  const etap = przypiety.stageIndex;
  const upłynęło = przypiety.stageElapsed;
  for (let i = 0; i < 60; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 });
  t.equal('zegar analityczny stoi', przypiety.stageElapsed, upłynęło);
  const zPrzypietym = lastOf(inbox, TRAFFIC_MSG.TICK).bubble;
  const rekord = [...Array(zPrzypietym.count).keys()]
    .find(i => zPrzypietym.data[i * COURSE_STRIDE + F.ID] === numer);
  t.check('przypięty kurs jest w bańce nawet poza promieniem', rekord !== undefined);
  t.check('i ma flagę ATTACHED', rekord !== undefined
    && !!(zPrzypietym.data[rekord * COURSE_STRIDE + F.FLAGS] & COURSE_FLAG.ATTACHED));
  const sekundy = currentStage(przypiety).seconds;
  const dalej = (przypiety.stageElapsed / sekundy + 1) / 2;
  core.handle({ type: TRAFFIC_MSG.PROGRESS, course: numer, progress: dalej });
  t.close('postęp z gry trafia do rekordu', przypiety.stageElapsed, sekundy * dalej, 1e-6);
  core.handle({ type: TRAFFIC_MSG.PROGRESS, course: numer, progress: dalej / 2 });
  t.close('ale nie cofa kursu (odgięcie toru w grze)', przypiety.stageElapsed, sekundy * dalej, 1e-6);
  core.handle({ type: TRAFFIC_MSG.DETACH, course: numer, progress: 0.75 });
  t.check('detach oddaje zegar', !przypiety.actorId);
  t.close('z postępem encji', przypiety.stageElapsed, currentStage(przypiety).seconds * 0.75, 1e-6);
  core.handle({ type: TRAFFIC_MSG.ATTACH, course: numer });
  core.handle({ type: TRAFFIC_MSG.STAGE_DONE, course: numer });
  t.equal('stage-done domyka etap', przypiety.stageIndex, etap + 1);
  core.handle({ type: TRAFFIC_MSG.DESTROYED, course: numer, x: 1, y: 2, reason: 'player' });
  t.equal('destroyed rozbija kurs', przypiety.status, COURSE_STATUS.WRECKED);
  let zWrakiem = null;
  while (!zWrakiem) {
    const before = inbox.length;
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 });
    zWrakiem = inbox.slice(before).find(message => message.type === TRAFFIC_MSG.TICK) || null;
  }
  const wrak = zWrakiem.wrecks.find(entry => entry.course === numer);
  t.check('wrak idzie do gry z pozycją i powodem', wrak?.x === 1 && wrak?.y === 2 && wrak?.reason === 'player');
  t.equal('z klasą jednostki', wrak?.hull, przypiety.unitClass);

  // ----------------------------------------------------------
  t.section('Stacja zniszczona w grze');

  const venus = ready.stations.findIndex(entry => entry.id === 'venus');
  const zFrakcjami = inbox.find(message => message.type === TRAFFIC_MSG.TICK && message.stationFactions);
  t.check('tick niesie nowe frakcje stacji', !!zFrakcjami);
  t.equal('Wenus bez frakcji', zFrakcjami?.stationFactions[venus], null);

  // ----------------------------------------------------------
  t.section('Piractwo nie rusza kursów oglądanych przez gracza');

  const piraci = makeCore();
  piraci.core.handle({ type: TRAFFIC_MSG.INIT, ...OPTS, seed: 5, piracyPressure: 400 });
  for (let i = 0; i < 360; i++) piraci.core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: TRAFFIC_STEP_SECONDS });
  const pw = piraci.core.world;
  const naSzlaku = getActiveCourses(pw.registry).find(course => {
    const stage = currentStage(course);
    return stage?.kind === STAGE_KIND.TRAVEL && stage.mode === 'conventional' && stage.risk > 0
      && !course.convoyId;
  });
  t.check('jest kurs na odsłoniętym szlaku', !!naSzlaku);
  piraci.core.handle({ type: TRAFFIC_MSG.ATTACH, course: courseNumber(naSzlaku.id) });
  for (let i = 0; i < 60; i++) piraci.core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: TRAFFIC_STEP_SECONDS });
  t.equal('przypięty kurs przetrwał 5 min przy presji ×400', naSzlaku.status, COURSE_STATUS.ACTIVE);
  piraci.core.handle({ type: TRAFFIC_MSG.CONFIG, protectObserved: false });
  for (let i = 0; i < 60 && naSzlaku.status === COURSE_STATUS.ACTIVE; i++) {
    piraci.core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: TRAFFIC_STEP_SECONDS });
  }
  t.equal('bez ochrony pada ofiarą kostki', naSzlaku.status, COURSE_STATUS.WRECKED);

  // ----------------------------------------------------------
  t.section('Błąd w wiadomości nie zabija rdzenia');

  const zly = { valueOf() { throw new Error('zła liczba'); } };
  const przed = inbox.length;
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: zly, y: 0, r: 10 });
  const blad = inbox.slice(przed).find(message => message.type === TRAFFIC_MSG.ERROR);
  t.check('rdzeń odsyła `error`', blad?.message === 'zła liczba' && blad?.during === TRAFFIC_MSG.FOCUS);
  const zegar = core.world.registry.clock;
  for (let i = 0; i < 5; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 });
  t.equal('i liczy dalej', core.world.registry.clock, zegar + TRAFFIC_STEP_SECONDS);
  t.equal('nieznana wiadomość jest ignorowana', core.handle({ type: 'nie-ma-takiej' }), undefined);

  return t.results;
}

runIfMain(import.meta.url, run);
