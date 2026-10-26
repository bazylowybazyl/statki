// Bańka ruchu v2 w workerze (E6, docs/PLAN-ekonomia-rynki.md § 3.5): rdzeń ruchu (`trafficCore.js`) prowadzi lekkie
// statki przy porcie Ziemi i po każdym `advance` wysyła bufor encji (`actors`); `berth-hold` gracza zdejmuje
// stanowisko z puli dyspozytora i przenosi kurs w podejściu; `destroyed` z gry = kurs zniszczony, wrak z ładunkiem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficCore } from '../src/game/traffic/trafficCore.js';
import {
  TRAFFIC_MSG, ACTOR_STRIDE, ACTOR_FIELD, ACTOR_PHASES, ACTOR_FLAG, courseNumber
} from '../src/game/traffic/trafficProtocol.js';
import { getCourse, COURSE_STATUS } from '../src/game/traffic/courseRegistry.js';
import { PLAYER_BERTH_HOLDER } from '../src/game/traffic/trafficDirector.js';
import { BUBBLE_PORT_RANGE } from '../src/game/traffic/workerBubble.js';
import { ACTOR_CARGO_STRIDE, ACTOR_CARGO_FIELD, ACTOR_CARGO_MODE } from '../src/game/traffic/bubbleCargo.js';

const F = ACTOR_FIELD;

function startCore() {
  const got = { actors: null, ready: null, tick: null, errors: [], actorMsgs: 0 };
  const core = createTrafficCore((m) => {
    if (m.type === TRAFFIC_MSG.ACTORS) { got.actors = m; got.actorMsgs++; }
    else if (m.type === TRAFFIC_MSG.READY) got.ready = m;
    else if (m.type === TRAFFIC_MSG.TICK) got.tick = m;
    else if (m.type === TRAFFIC_MSG.ERROR) got.errors.push(m);
  });
  core.handle({ type: TRAFFIC_MSG.INIT, seed: 7, economyScale: 60, capacityMultiplier: 4, piracyPressure: 1 });
  return { core, got };
}

function decode(msg) {
  const out = [];
  for (let k = 0; k < msg.count; k++) {
    const o = k * ACTOR_STRIDE;
    out.push({
      id: msg.data[o + F.ID], x: msg.data[o + F.X], y: msg.data[o + F.Y], phase: ACTOR_PHASES[msg.data[o + F.PHASE]],
      flags: msg.data[o + F.FLAGS], port: msg.data[o + F.PORT], berth: msg.data[o + F.BERTH],
      length: msg.data[o + F.LENGTH], width: msg.data[o + F.WIDTH]
    });
  }
  return out;
}

// Jeden świat na plik: budowa i rozgrzewka kosztują kilka sekund.
const { core, got } = startCore();
const world = core.world;
const earth = world.network.nodes.get('earth');
// Fokus nad portem (r ≈ 50 tys. od środka), rozgrzewka gospodarki krokami 1 s, potem klatki 1/30 s.
core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
for (let i = 0; i < 20 * 60; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 });
for (let i = 0; i < 30 * 30; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });

test('ready niesie geometrię stanowisk portu bańki (Ziemia) w układzie gry', () => {
  const berths = got.ready.bubblePorts.earth;
  assert.ok(Array.isArray(berths) && berths.length > 100);
  const ids = new Set(got.ready.berths.earth);
  for (const b of berths) {
    assert.ok(ids.has(b.id));
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.angle));
    assert.ok(b.hall === 'K-7' || b.hall === 'ZATOKA');
  }
});

test('statki ruchu przy Ziemi: encje po każdym advance, fazy i stanowiska z tabel protokołu', () => {
  assert.equal(got.errors.length, 0, JSON.stringify(got.errors[0] || null));
  const actors = decode(got.actors);
  assert.ok(actors.length > 10, `encji ${actors.length}`);
  const phases = new Set(actors.map((a) => a.phase));
  assert.ok(phases.has('fly'));
  for (const a of actors) {
    // Kurs: numer ≥ 0; zapas floty na padach K-7 (STOCK): id ujemny.
    // Encje bez kursu (zapas floty, postój E15) mają id ujemny.
    assert.ok((a.flags & (ACTOR_FLAG.STOCK | ACTOR_FLAG.PARKED) ? a.id < 0 : a.id >= 0) && Number.isFinite(a.x) && a.length >= 40 && a.width >= 20);
    if (a.berth >= 0) {
      const stationId = got.ready.stations[a.port]?.id;
      assert.ok(got.ready.berths[stationId]?.[a.berth], 'stanowisko z tabeli `berths`');
    }
  }
  const s = core.stats;
  assert.ok(s.actorMs < 50, `krok bańki ${s.actorMs} ms`);
});

test('poza portem bańka gaśnie: jedna pusta wiadomość, rekordy bez przypiętych encji', () => {
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + BUBBLE_PORT_RANGE * 3, y: earth.y, r: 60_000 });
  const before = got.actorMsgs;
  core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.equal(got.actors.count, 0);
  core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.equal(got.actorMsgs, before + 1, 'bez kolejnych pustych wiadomości');
  let attached = 0;
  for (const c of world.registry.active) if (c.actorId) attached++;
  assert.equal(attached, 0);
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  for (let i = 0; i < 60; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.ok(got.actors.count > 0, 'bańka wraca przy porcie');
});

test('berth-hold: stanowisko gracza poza pulą, kurs w podejściu dostaje inne, zwolnienie oddaje stanowisko', () => {
  const layout = world.docks.get('earth');
  // Kurs, który leci na stanowisko (encja w podejściu albo rekord w dojściu).
  let course = null;
  for (const c of world.registry.active) {
    if (c.status !== COURSE_STATUS.ACTIVE || !c.berthRef || c.portStationId !== 'earth') continue;
    const stage = c.stages[c.stageIndex];
    const actor = core.world && c.actorId ? true : false;
    const moving = (Number(stage?.moveSeconds) || 0) > 0 && (Number(c.stageElapsed) || 0) < Number(stage.moveSeconds);
    if (moving && !actor) { course = c; break; }
  }
  const free = layout.berths.find((b) => !b.occupantId);
  assert.ok(free, 'wolne stanowisko w porcie Ziemi');
  assert.ok(course, 'kurs w dojściu do stanowiska Ziemi');
  const movedFrom = course.berthId;
  const ids = [free.id, movedFrom];
  core.handle({ type: TRAFFIC_MSG.BERTH_HOLD, berths: ids });
  assert.equal(free.occupantId, PLAYER_BERTH_HOLDER);
  const berth = layout.berths.find((b) => b.id === movedFrom);
  assert.equal(berth.occupantId, PLAYER_BERTH_HOLDER, 'stanowisko kursu w podejściu przeszło na gracza');
  assert.notEqual(course.berthId, movedFrom, 'kurs dostał inne stanowisko albo kolejkę');
  assert.ok(course.berthId || course.blocked, 'kurs ma nowe stanowisko albo czeka w kolejce');
  // Kroki świata: dyspozytor nie przydziela stanowisk gracza.
  for (let i = 0; i < 12; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 5 });
  for (const c of world.registry.active) assert.ok(!ids.includes(c.berthId), `kurs ${c.id} na stanowisku gracza`);
  core.handle({ type: TRAFFIC_MSG.BERTH_HOLD, berths: [] });
  assert.equal(free.occupantId, null);
});

test('destroyed z gry: kurs encji zniszczony, wrak z ładunkiem w ticku, encja znika w następnym advance', () => {
  const actors = decode(got.actors).filter((a) => !(a.flags & (ACTOR_FLAG.STOCK | ACTOR_FLAG.PARKED | ACTOR_FLAG.DEPARTED)));
  const target = actors.find((a) => {
    const c = getCourse(world.registry, core.world.registry.byId && [...world.registry.byId.keys()].find((id) => courseNumber(id) === a.id));
    return c && c.payload?.orderId;
  }) || actors[0];
  assert.ok(target);
  const courseId = [...world.registry.byId.keys()].find((id) => courseNumber(id) === target.id);
  core.handle({ type: TRAFFIC_MSG.DESTROYED, course: target.id, x: target.x, y: target.y, reason: 'player', byPirates: false });
  const course = getCourse(world.registry, courseId);
  assert.notEqual(course?.status, COURSE_STATUS.ACTIVE);
  core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.ok(!decode(got.actors).some((a) => a.id === target.id), 'encja zniszczonego kursu zniknęła');
  // Wrak idzie do gry z następnym tickiem świata (pozycja z gry, powód, ładunek kursu).
  for (let i = 0; i < 6; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 });
  const wrecks = got.tick.wrecks || [];
  const all = [...wrecks];
  const wreck = all.find((w) => w.course === target.id) || world.director.wrecks.find((w) => w.courseId === courseId);
  assert.ok(wreck, 'wrak kursu');
  assert.equal(wreck.reason, 'player');
  assert.ok(Math.abs(wreck.x - target.x) < 1e-6 && Math.abs(wreck.y - target.y) < 1e-6);
});

test('attach z gry przejmuje kurs bańki: encja wraca do rekordu z postępem i nie wraca do bańki', () => {
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  for (let i = 0; i < 30; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  const actors = decode(got.actors).filter((a) => !(a.flags & (ACTOR_FLAG.STOCK | ACTOR_FLAG.PARKED | ACTOR_FLAG.DEPARTED)));
  const pick = actors.find((a) => a.phase === 'fly') || actors[0];
  assert.ok(pick);
  const courseId = [...world.registry.byId.keys()].find((id) => courseNumber(id) === pick.id);
  const course = getCourse(world.registry, courseId);
  assert.ok(String(course.actorId).startsWith('bubble:'));
  core.handle({ type: TRAFFIC_MSG.ATTACH, course: pick.id });
  assert.equal(course.actorId, `game:${pick.id}`);
  for (let i = 0; i < 30; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.ok(!decode(got.actors).some((a) => a.id === pick.id), 'kurs gry nie wraca do bańki workera');
  core.handle({ type: TRAFFIC_MSG.DETACH, course: pick.id, progress: 0.5 });
  assert.equal(course.actorId, null);
});

test('zapas floty Ziemi stoi na padach hal K-7: encje STOCK z id ujemnym, bez kursu, na stanowiskach K-7', () => {
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  for (let i = 0; i < 12; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 5 });
  const actors = decode(got.actors);
  // Na padach: STOCK bez PARKED (nadmiar na redzie wojskowej — E15, osobny test).
  const stock = actors.filter((a) => (a.flags & ACTOR_FLAG.STOCK) && !(a.flags & ACTOR_FLAG.PARKED));
  const fleet = world.shipyards.fleets.get(world.stations.find((s) => s.id === 'earth').factionId) || {};
  const owned = Object.values(fleet).reduce((sum, n) => sum + n, 0);
  assert.ok(owned > 0, 'Terra Nova ma zapas okrętów');
  assert.ok(stock.length > 0, `okręty zapasu w bańce (${stock.length} z ${owned})`);
  const ids = new Set();
  for (const a of stock) {
    assert.ok(a.id < 0, 'id ujemny — nie numer kursu');
    assert.ok(!ids.has(a.id));
    ids.add(a.id);
    assert.equal(a.phase, 'docked');
    const berthId = got.ready.berths.earth[a.berth];
    assert.ok(String(berthId).includes(':K7-'), `pad hali K-7 (${berthId})`);
  }
  // Stały pad: ten sam okręt po kolejnym kroku świata stoi w tym samym miejscu.
  const before = new Map(stock.map((a) => [a.id, a.berth]));
  core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 5 });
  for (const a of decode(got.actors)) if (before.has(a.id)) assert.equal(a.berth, before.get(a.id));
});

test('garnizon K-7 (E4: PATROL / WAR) dokuje w halach przez bańkę i nie staje na padzie z okrętem zapasu', () => {
  const k7 = world.docks.get('earth').berths.find((b) => b.id.includes(':K7-'));
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: k7.x, y: k7.y, r: 60_000 });
  const berthIds = got.ready.berths.earth;
  const garrison = new Set();
  let overlap = 0;
  for (let f = 0; f < 30 * 180; f++) {
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
    if (f % 15) continue;
    const onPad = new Map();
    for (const a of decode(got.actors)) {
      const id = a.berth >= 0 ? berthIds[a.berth] : null;
      if (!id || !id.includes(':K7-')) continue;
      if (!(a.phase === 'docked' || a.phase === 'capture' || a.phase === 'undock')) continue;
      if (onPad.has(id)) overlap++;
      onPad.set(id, a.id);
      if (!(a.flags & (ACTOR_FLAG.STOCK | ACTOR_FLAG.PARKED))) garrison.add(a.id);
    }
  }
  assert.ok(garrison.size > 0, 'okręty garnizonu zadokowane w K-7 (kursy, nie zapas)');
  assert.equal(overlap, 0, 'dwa statki na jednym padzie K-7');
});

test('bańka w portach bez ringu (pomosty Merkurego i Westy): dokowanie bez wymuszeń, ready.bubblePorts dla wszystkich portów', () => {
  assert.ok(got.ready.bubblePorts.mercury?.length > 0 && got.ready.bubblePorts.vesta?.length > 0, 'geometria pomostów w ready');
  assert.ok(got.ready.bubblePorts.mars?.length > 0, 'port ringu Marsa w ready');
  for (const id of ['mercury', 'vesta']) {
    const berth0 = world.docks.get(id).berths[0];
    core.handle({ type: TRAFFIC_MSG.FOCUS, x: berth0.x, y: berth0.y, r: 60_000 });
    const s0 = { ...core.bubble.bubble.stats };
    const docked = new Set();
    for (let f = 0; f < 30 * 120; f++) {
      core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
      if (f % 15) continue;
      for (const a of decode(got.actors)) {
        const berthId = a.berth >= 0 ? got.ready.berths[got.ready.stations[a.port]?.id]?.[a.berth] : null;
        if ((a.phase === 'docked' || a.phase === 'capture') && berthId?.startsWith(`${id}:`)) docked.add(a.id);
      }
    }
    const s1 = core.bubble.bubble.stats;
    assert.ok(docked.size > 0, `${id}: statki zadokowane przy pomoście`);
    assert.equal((s1.forcedCaptures - s0.forcedCaptures) + (s1.forcedStages - s0.forcedStages), 0, `${id}: bez wymuszeń`);
  }
});

test('postoje przy stanowisku (kontrakt E12): rekord przy dokowaniu, koniec w `undocked`, tylko zmiany', () => {
  const berth0 = world.docks.get('earth').berths.find((b) => b.id.includes(':Z-'));
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: berth0.x, y: berth0.y, r: 60_000 });
  const live = new Map();
  let records = 0;
  let ended = 0;
  let repeated = 0;
  let fills = 0;
  for (let f = 0; f < 30 * 120; f++) {
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
    for (const id of got.actors.undocked || []) { if (live.delete(id)) ended++; }
    for (const rec of got.actors.docks || []) {
      if (live.has(rec.id) && JSON.stringify(live.get(rec.id)) === JSON.stringify(rec)) repeated++;
      live.set(rec.id, rec);
      records++;
      assert.ok(String(rec.berthId).includes(':'), 'id stanowiska');
      assert.ok(['load', 'unload', 'extract', 'refuel', 'service', 'hold'].includes(rec.mode), `tryb ${rec.mode}`);
      assert.ok(rec.cargo && typeof rec.cargo === 'object');
      for (const n of Object.values(rec.cargo)) assert.ok(n > 0);
      assert.ok(rec.dur >= 0 && Number.isFinite(rec.t0) && rec.t0 <= got.actors.time + 1e-6, 'zegar postoju w czasie mostu');
      assert.ok(typeof rec.hull === 'string' && rec.hull.length > 0);
      assert.ok(rec.fill === null || (rec.fill >= 0 && rec.fill <= 1), `wypełnienie ładowni ${rec.fill}`);
      if (rec.fill !== null) fills++;
    }
  }
  assert.ok(records > 0, 'postoje wysłane');
  assert.ok(ended > 0, 'koniec postoju zgłoszony');
  assert.equal(repeated, 0, 'ten sam rekord nie idzie drugi raz');
  assert.ok(fills > 0, 'frachtowce niosą wypełnienie ładowni');
  const withCargo = [...live.values()].filter((r) => Object.keys(r.cargo).length > 0).length;
  assert.ok(withCargo > 0 || ended > 0, 'ładunek w rekordach');
});

test('encje w podejściu niosą stanowisko (APPROACH) — gra rezerwuje je w rejestrze ringu', () => {
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  let seenApproach = false;
  let seenBerth = false;
  for (let i = 0; i < 30 * 40 && !(seenApproach && seenBerth); i++) {
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
    for (const a of decode(got.actors)) {
      if ((a.flags & ACTOR_FLAG.APPROACH) && a.berth >= 0) seenApproach = true;
      if ((a.phase === 'docked' || a.phase === 'capture') && a.berth >= 0) seenBerth = true;
    }
  }
  assert.ok(seenApproach, 'podejście na stanowisko');
  assert.ok(seenBerth, 'postój na stanowisku');
});

test('awans do NPC i powrót: attach zamraża rekord, detach z pozą (bez postępu) materializuje encję w miejscu NPC', () => {
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  for (let i = 0; i < 30; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  const actors = decode(got.actors).filter((a) => !(a.flags & (ACTOR_FLAG.STOCK | ACTOR_FLAG.PARKED | ACTOR_FLAG.DEPARTED)));
  const pick = actors.find((a) => a.phase === 'fly') || actors[0];
  assert.ok(pick);
  const courseId = [...world.registry.byId.keys()].find((id) => courseNumber(id) === pick.id);
  const course = getCourse(world.registry, courseId);
  core.handle({ type: TRAFFIC_MSG.ATTACH, course: pick.id });
  const stageIndex = course.stageIndex;
  const elapsed = course.stageElapsed;
  for (let i = 0; i < 60; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.equal(course.stageElapsed, elapsed, 'kurs gry nie biegnie w rekordzie');
  // NPC odleciał o 900 j. w bok i stanął.
  const px = pick.x + 600;
  const py = pick.y - 670;
  core.handle({ type: TRAFFIC_MSG.DETACH, course: pick.id, progress: null, pose: { x: px, y: py, angle: 1.2, speed: 0 } });
  assert.equal(course.actorId, null);
  assert.equal(course.stageIndex, stageIndex);
  assert.equal(course.stageElapsed, elapsed, '`progress: null` nie zeruje postępu etapu');
  assert.equal(course.viewState?.handoff, true);
  core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  const back = decode(got.actors).find((a) => a.id === pick.id);
  assert.ok(back, 'kurs wraca do bańki w następnym advance');
  assert.ok(Math.hypot(back.x - px, back.y - py) < 50, `encja w pozie NPC (${Math.round(back.x - px)}, ${Math.round(back.y - py)})`);
  assert.equal(course.viewState, null, 'poza oddana raz');
});

test('przeładunek (kontrakt E12 `actors.cargo`): rekordy encji przy stanowisku w postoju LOAD / UNLOAD', () => {
  const berth0 = world.docks.get('earth').berths.find((b) => b.id.includes(':Z-'));
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: berth0.x, y: berth0.y, r: 60_000 });
  let records = 0;
  let checked = 0;
  for (let f = 0; f < 30 * 60; f++) {
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
    const cargo = got.actors.cargo;
    if (!cargo) continue;
    assert.ok(cargo instanceof Float32Array);
    assert.equal(cargo.length % ACTOR_CARGO_STRIDE, 0);
    const atBerth = new Set(decode(got.actors).filter((a) => ['capture', 'docked', 'undock'].includes(a.phase)).map((a) => a.id));
    for (let o = 0; o < cargo.length; o += ACTOR_CARGO_STRIDE) {
      records++;
      const C = ACTOR_CARGO_FIELD;
      assert.ok(atBerth.has(cargo[o + C.ID]), 'rekord tylko dla encji przy stanowisku');
      assert.ok(cargo[o + C.MODE] === ACTOR_CARGO_MODE.LOAD || cargo[o + C.MODE] === ACTOR_CARGO_MODE.UNLOAD);
      assert.ok(cargo[o + C.FILL] >= 0 && cargo[o + C.FILL] <= 1);
      assert.ok(cargo[o + C.DWELL] >= cargo[o + C.MOVE]);
      const ri = cargo[o + C.RES];
      assert.ok(ri === -1 || (ri >= 0 && ri < got.ready.resources.length), 'indeks towaru w ready.resources');
      checked++;
    }
  }
  assert.ok(records > 0 && checked === records, 'statki przy zatokach Ziemi przeładowują');
});

test('stacja gracza dodana w biegu (zapis E7 → market-add) jest portem bańki: stanowiska w tabeli i w bańce, fokus przy niej', async () => {
  const { MARKET_KIND, MARKET_POSITION, DOCK_LAYOUT } = await import('../src/data/markets.js');
  const { bubblePortNear } = await import('../src/game/traffic/workerBubble.js');
  const at = { x: earth.x + 400_000, y: earth.y + 250_000 };
  core.handle({ type: TRAFFIC_MSG.MARKET_ADD, def: {
    id: 'gracz-test', label: 'Test', kind: MARKET_KIND.PLAYER,
    position: { source: MARKET_POSITION.POINT, x: at.x, y: at.y },
    factionId: null, industry: { buildings: [], size: 0.3 }, docks: { layout: DOCK_LAYOUT.PIERS }
  } });
  const berths = got.tick.bubblePorts?.['gracz-test'];
  assert.ok(Array.isArray(berths) && berths.length > 0, 'tick niesie stanowiska nowego portu');
  const state = core.bubble;
  assert.ok([...bubblePortIdsOf(state)].includes('gracz-test'));
  assert.equal(bubblePortNear(state, at.x, at.y), true, 'fokus przy stacji gracza budzi bańkę');
  assert.ok(state.bubble.ports.layouts.has('gracz-test'), 'układ doków w indeksie portów bańki');
  assert.ok([...state.bubble.ports.berths.values()].some((r) => r.stationId === 'gracz-test'), 'stanowiska w indeksie portów bańki');
});

function bubblePortIdsOf(state) {
  return state.ports || state.world.docks.keys();
}

test('koniec kursu przy stanowisku (rozładunek u celu): encja nie znika z pola — DEPARTED, odłączanie, lot poza port', () => {
  const berth0 = world.docks.get('earth').berths.find((b) => b.id.includes(':Z-'));
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: berth0.x, y: berth0.y, r: 60_000 });
  let prev = new Map();
  let vanishedDocked = 0;
  const seen = new Map();
  // Odlot liczy się od końca kursu widzianego w tym teście — encja, która odlatywała już wcześniej (inny fokus
  // poprzednich testów), nie pokaże odłączania.
  const withCourse = new Set();
  let maxJump = 0;
  for (let f = 0; f < 10 * 400 && !([...seen.values()].some((v) => v.phases.includes('fly') && v.dist > 3000)); f++) {
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 10 });
    const cur = new Map(decode(got.actors).filter((a) => a.id >= 0).map((a) => [a.id, a]));
    for (const [id, a] of prev) if (!cur.has(id) && (a.phase === 'docked' || a.phase === 'capture')) vanishedDocked++;
    for (const [id, a] of cur) {
      if (!(a.flags & ACTOR_FLAG.DEPARTED)) { withCourse.add(id); continue; }
      let v = seen.get(id);
      if (!v) {
        if (!withCourse.has(id)) continue;
        v = { phases: [], x0: a.x, y0: a.y, dist: 0 };
        seen.set(id, v);
      }
      if (v.phases[v.phases.length - 1] !== a.phase) v.phases.push(a.phase);
      v.dist = Math.hypot(a.x - v.x0, a.y - v.y0);
      const p = prev.get(id);
      if (p) maxJump = Math.max(maxJump, Math.hypot(a.x - p.x, a.y - p.y));
    }
    prev = cur;
  }
  assert.equal(vanishedDocked, 0, 'statek przy stanowisku nie znika w jednej klatce');
  const flown = [...seen.values()].find((v) => v.phases.includes('fly') && v.dist > 3000);
  assert.ok(flown, `odlot po końcu kursu (${seen.size} encji DEPARTED)`);
  assert.deepEqual(flown.phases.slice(0, 2), ['undock', 'fly'], 'odłączanie, potem lot');
  assert.ok(maxJump < 400, `ruch ciągły (największy skok w klatce 0,1 s: ${Math.round(maxJump)} j.)`);
  // Odlot przejęty przez grę jako NPC (taran, ogień): znika z bańki — NPC jest teraz tym statkiem.
  const departedId = [...seen.keys()].find((id) => decode(got.actors).some((a) => a.id === id));
  if (departedId !== undefined) {
    core.handle({ type: TRAFFIC_MSG.ENTITY_HOLD, id: departedId, on: true });
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 10 });
    assert.ok(!decode(got.actors).some((a) => a.id === departedId), 'odlot przejęty — bez encji w bańce');
  }
});

test('nietykalnych nie ma: zapas floty, postój i odlot przejęte przez grę (entity-hold) i zniszczone (entity-lost)', async () => {
  const { getShip, SHIP_STATE } = await import('../src/game/traffic/transportCompanies.js');
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  for (let i = 0; i < 30; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  const state = core.bubble;

  // 1. Okręt zapasu na padzie K-7: strata z zapasu frakcji (klasa −1, wrak ze złomem), encja znika.
  const stock = decode(got.actors).find((a) => (a.flags & ACTOR_FLAG.STOCK) && !(a.flags & ACTOR_FLAG.PARKED));
  assert.ok(stock, 'okręt zapasu przy Ziemi');
  const ref = state.stock.list.find((e) => e.id === stock.id);
  const fleet = world.shipyards.fleets.get(ref.factionId);
  const before = fleet[ref.classId];
  const wrecks = world.war.wrecks.length;
  core.handle({ type: TRAFFIC_MSG.ENTITY_HOLD, id: stock.id, on: true });
  core.handle({ type: TRAFFIC_MSG.ENTITY_LOST, id: stock.id, x: stock.x, y: stock.y, reason: 'player' });
  assert.equal(fleet[ref.classId], before - 1, 'zapas klasy mniejszy o okręt');
  assert.equal(world.war.wrecks.length, wrecks + 1, 'wrak ze złomem');
  for (let i = 0; i < 30 * 6; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.ok(!decode(got.actors).some((a) => a.id === stock.id), 'zniszczony okręt nie wraca na pad');

  // 2. Statek firmy na redzie: przejęty schodzi z puli dyspozytora, oddany wraca, zniszczony — firma go traci.
  let parked = null;
  for (let i = 0; i < 30 * 60 && !parked; i++) {
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
    parked = decode(got.actors).find((a) => (a.flags & ACTOR_FLAG.PARKED) && !(a.flags & ACTOR_FLAG.STOCK)) || null;
  }
  assert.ok(parked, 'statek na redzie Ziemi');
  const shipId = state.parked.list.find((e) => e.id === parked.id).shipId;
  core.handle({ type: TRAFFIC_MSG.ENTITY_HOLD, id: parked.id, on: true });
  const ship = getShip(world.companies, shipId);
  assert.equal(ship.state, SHIP_STATE.BUSY, 'poza pulą dyspozytora');
  assert.equal(ship.gameHold, true);
  core.handle({ type: TRAFFIC_MSG.ENTITY_HOLD, id: parked.id, on: false });
  assert.equal(ship.state, SHIP_STATE.PARKED, 'oddany — znów na postoju');
  core.handle({ type: TRAFFIC_MSG.ENTITY_HOLD, id: parked.id, on: true });
  core.handle({ type: TRAFFIC_MSG.ENTITY_LOST, id: parked.id, reason: 'player' });
  assert.equal(getShip(world.companies, shipId), null, 'firma straciła statek');
});
