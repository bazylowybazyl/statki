// E15 — widoczny ruch w grze (docs/E15-widoczny-ruch.md, reguła `ruch-v2`): rozgrzewka świata ruchu w tle przy
// ładowaniu (kawałki, determinizm, zegar mostu, zapis ekonomii w trakcie, tryb awaryjny bez niej), postój bez kursu
// w bańce (reda przy ringu, orbita postojowa przy budowli doku E14, nadmiar zapasu floty; nietykalny jak STOCK,
// oddanie pozy kursowi) i szersza bańka przy portach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createTrafficCore } from '../src/game/traffic/trafficCore.js';
import { TrafficBridge } from '../src/game/trafficBridge.js';
import {
  TRAFFIC_MSG, ACTOR_STRIDE, ACTOR_FIELD, ACTOR_PHASES, ACTOR_FLAG, TRAFFIC_WARMUP_SECONDS
} from '../src/game/traffic/trafficProtocol.js';
import {
  BUBBLE_ENTITY_LIMIT, BUBBLE_PORT_FOCUS_RADIUS, bubbleFocusRadius
} from '../src/game/traffic/workerBubble.js';
import {
  buildDockOrbitParking, createParkingRegistry, syncParking, PARKING_SLOT_CLASSES
} from '../src/game/traffic/portParking.js';
import { getNode } from '../src/game/traffic/travelNetwork.js';
import { TRAFFIC_BLOCK } from '../src/render/blocks/trafficBlock.js';
import { createTrafficBubble, syncTrafficBubble, damageTrafficActor } from '../src/game/trafficBubble.js';
import { trafficActorPromotable } from '../src/game/trafficPromotion.js';

const F = ACTOR_FIELD;
const INIT = { type: TRAFFIC_MSG.INIT, seed: 7, economyScale: 60, capacityMultiplier: 4, piracyPressure: 1 };

function decode(msg) {
  const out = [];
  for (let k = 0; k < (msg?.count || 0); k++) {
    const o = k * ACTOR_STRIDE;
    out.push({
      id: msg.data[o + F.ID], x: msg.data[o + F.X], y: msg.data[o + F.Y], angle: msg.data[o + F.ANGLE],
      phase: ACTOR_PHASES[msg.data[o + F.PHASE]], flags: msg.data[o + F.FLAGS], vx: msg.data[o + F.VX]
    });
  }
  return out;
}

/** Rdzeń z ręcznym harmonogramem rozgrzewki (`queue` — kawałki do przerobienia). */
function startCore(extra = {}) {
  const got = { actors: null, actorMsgs: 0, ready: null, tick: null, ticks: [], errors: [], restoreResults: [], saves: [] };
  const queue = [];
  const core = createTrafficCore((m) => {
    if (m.type === TRAFFIC_MSG.ACTORS) { got.actors = m; got.actorMsgs++; }
    else if (m.type === TRAFFIC_MSG.READY) got.ready = m;
    else if (m.type === TRAFFIC_MSG.TICK) { got.tick = m; got.ticks.push(m.warmup); }
    else if (m.type === TRAFFIC_MSG.ERROR) got.errors.push(m);
    else if (m.type === TRAFFIC_MSG.ECONOMY_RESTORE_RESULT) got.restoreResults.push(m);
    else if (m.type === TRAFFIC_MSG.ECONOMY_SAVE_RESULT) got.saves.push(m.state);
  }, { schedule: (fn) => queue.push(fn) });
  core.handle({ ...INIT, ...extra });
  return { core, got, queue };
}

// ============================================================
// Rozgrzewka
// ============================================================

test('rozgrzewka: stała protokołu, `warmup: true` = godzina, brak = start od zera (symulacja, bramka, testy)', () => {
  assert.equal(TRAFFIC_WARMUP_SECONDS, 3600);
  const plain = startCore();
  assert.equal(plain.got.ready.warmup.total, 0);
  assert.equal(plain.got.ready.warmup.active, false);
  assert.equal(plain.queue.length, 0, 'bez rozgrzewki nic nie czeka w harmonogramie');
  const warm = startCore({ warmup: true });
  assert.equal(warm.got.ready.warmup.total, TRAFFIC_WARMUP_SECONDS);
  assert.equal(warm.got.ready.warmup.active, true);
  assert.equal(warm.queue.length, 1, 'pierwszy kawałek zaplanowany po `ready`');
});

test('rozgrzewka liczy się kawałkami: wiadomości gry przechodzą między nimi, bańka stoi do końca, zegar świata przesunięty', () => {
  const { core, got, queue } = startCore({ warmup: 600 });
  const earth = getNode(core.world.network, 'earth');
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  let slices = 0;
  let game = 0;
  while (queue.length) {
    queue.shift()();
    slices++;
    // Gra w tym czasie gra (klatki, handel): świat dostaje jej czas normalnie, bańka milczy.
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
    game += 1 / 30;
    if (queue.length) assert.equal(got.actorMsgs, 0, 'w trakcie rozgrzewki bez `actors`');
  }
  assert.ok(slices > 1, `kawałków: ${slices}`);
  assert.equal(got.errors.length, 0, JSON.stringify(got.errors[0] || null));
  const last = got.tick.warmup;
  assert.equal(last.active, false);
  assert.equal(last.seconds, 600);
  const world = core.world;
  assert.ok(Math.abs(world.registry.clock + world.pending - (600 + game)) < 1e-6, 'zegar świata = rozgrzewka + czas gry');
  core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.ok(got.actorMsgs > 0, 'po rozgrzewce bańka rusza');
});

test('rozgrzewka deterministyczna: kawałki z przeplecionym czasem gry = zwykłe advance (osobne procesy, ziarno 7)', () => {
  const coreUrl = new URL('../src/game/traffic/trafficCore.js', import.meta.url).href;
  const script = (mode) => `
    import { createTrafficCore } from ${JSON.stringify(coreUrl)};
    const queue = [];
    const core = createTrafficCore(() => {}, { schedule: (fn) => queue.push(fn) });
    core.handle({ type: 'init', seed: 7, economyScale: 60, capacityMultiplier: 4, piracyPressure: 1, warmup: ${mode === 'warm' ? 900 : 0} });
    let i = 0;
    if (${JSON.stringify(mode)} === 'warm') {
      while (queue.length) { queue.shift()(); if (i++ % 2 === 0) core.handle({ type: 'advance', dt: 0.37 }); }
    } else {
      for (let s = 0; s < 900; s += 5) core.handle({ type: 'advance', dt: 5 });
    }
    const w = core.world;
    let rest = 960 - (w.registry.clock + w.pending);
    while (rest > 1e-9) { const d = Math.min(0.5, rest); core.handle({ type: 'advance', dt: d }); rest -= d; }
    let stock = 0;
    for (const e of w.economies.values()) for (const v of Object.values(e.resources)) stock += v;
    console.log(JSON.stringify({ clock: w.registry.clock, steps: w.steps, active: w.registry.active.length,
      ids: w.registry.active.map((c) => c.id).join(','), stock: Math.round(stock * 1000), delivered: w.director.stats.delivered }));
  `;
  const run = (mode) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script(mode)],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop());
  const warm = run('warm');
  const plain = run('plain');
  assert.equal(warm.clock, 960);
  assert.deepEqual(warm, plain);
});

test('zegar mostu po rozgrzewce = zegar świata; czas encji (`actors.time`) w tym samym czasie', async () => {
  const queue = [];
  const fake = {
    onmessage: null,
    core: null,
    postMessage(message) { this.core.handle(structuredClone(message)); },
    terminate() {}
  };
  fake.core = createTrafficCore((m) => fake.onmessage?.({ data: m }), { schedule: (fn) => queue.push(fn) });
  const bridge = new TrafficBridge({ workerFactory: () => fake });
  const ready = bridge.init({ ...INIT, type: undefined, warmup: 300 });
  await ready;
  assert.equal(bridge.warmup.active, true);
  let ended = null;
  bridge.on('warmup', (w) => { ended = w; });
  const earth = getNode(fake.core.world.network, 'earth');
  bridge.setFocus(earth.x + 50_000, earth.y, 60_000, true);
  let game = 0;
  while (queue.length) {
    queue.shift()();
    bridge.advance(1 / 60);
    game += 1 / 60;
  }
  assert.ok(ended && ended.seconds === 300, 'zdarzenie końca rozgrzewki');
  assert.ok(Math.abs(bridge.time - (300 + game)) < 1e-6, `most ${bridge.time}`);
  const w = fake.core.world;
  assert.ok(Math.abs(bridge.time - (w.registry.clock + w.pending)) < 1e-6, 'czas mostu = czas świata');
  bridge.advance(1 / 60);
  assert.ok(Math.abs(bridge.actors.time - bridge.time) < 1e-6, 'pozy encji ważne w czasie mostu');
});

test('tryb awaryjny (rdzeń na głównym wątku) startuje bez rozgrzewki', async () => {
  const bridge = new TrafficBridge({ useWorker: false, coreFactory: createTrafficCore });
  const ready = await bridge.init({ seed: 3, economyScale: 2, capacityMultiplier: 4, piracyPressure: 0, warmup: true });
  assert.equal(bridge.mode, 'main-fallback');
  assert.equal(ready.warmup.total, 0);
  assert.equal(bridge.warmup.active, false);
});

test('zapis ekonomii w trakcie rozgrzewki nakłada się na jej koniec: magazyny = zapis, odpowiedź po końcu', () => {
  const source = startCore();
  source.core.handle({ type: TRAFFIC_MSG.ECONOMY_SAVE, requestId: 1 });
  const state = source.got.saves[0];
  assert.ok(state?.stations?.earth, 'zapis świeżego świata');
  const { core, got, queue } = startCore({ warmup: 600 });
  queue.shift()();
  core.handle({ type: TRAFFIC_MSG.ECONOMY_RESTORE, requestId: 7, state });
  assert.equal(got.restoreResults.length, 0, 'odpowiedź czeka na koniec rozgrzewki');
  while (queue.length) queue.shift()();
  assert.equal(got.restoreResults.length, 1);
  assert.equal(got.restoreResults[0].requestId, 7);
  assert.ok(got.restoreResults[0].restored.stations > 0);
  const econ = core.world.getEconomy('earth');
  for (const [key, value] of Object.entries(state.stations.earth.stock)) {
    assert.ok(Math.abs(econ.resources[key] - value) < 1e-6, `${key}: ${econ.resources[key]} ≠ ${value}`);
  }
});

// ============================================================
// Postój bez kursu i szersza bańka — jeden świat po rozgrzewce jak w grze (60 min)
// ============================================================

const shared = startCore({ warmup: TRAFFIC_WARMUP_SECONDS });
while (shared.queue.length) shared.queue.shift()();
const world = shared.core.world;
const earthNode = getNode(world.network, 'earth');
shared.core.handle({ type: TRAFFIC_MSG.FOCUS, x: earthNode.x + 50_000, y: earthNode.y, r: 60_000 });
for (let i = 0; i < 6 * 30; i++) shared.core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });

test('bańka przy porcie szersza niż promień gry; w studni planety bez portu też; z dala — promień gry', () => {
  const state = shared.core.bubble;
  assert.ok(BUBBLE_PORT_FOCUS_RADIUS > 60_000);
  assert.equal(bubbleFocusRadius(state, earthNode.x + 50_000, earthNode.y, 60_000), BUBBLE_PORT_FOCUS_RADIUS);
  const neptune = getNode(world.network, 'neptune');
  assert.ok(neptune, 'węzeł Neptuna');
  // Studnia planety sama w sobie (zasięg portów wyłączony): Neptun — strefa planet_gravity gry.
  const wellsOnly = { ...state, range: 1 };
  assert.equal(bubbleFocusRadius(wellsOnly, neptune.x + 5_000, neptune.y, 60_000), BUBBLE_PORT_FOCUS_RADIUS, 'studnia Neptuna');
  assert.equal(bubbleFocusRadius(wellsOnly, neptune.x + 60_000, neptune.y, 60_000), 60_000, 'za studnią');
  assert.equal(bubbleFocusRadius(state, neptune.x + 2_000_000, neptune.y, 60_000), 60_000, 'pustka');
  assert.equal(BUBBLE_ENTITY_LIMIT, TRAFFIC_BLOCK.CAP, 'limit encji = blok migawki obrazu');
});

test('reda Ziemi w bańce: statki firm bez kursu (PARKED, id ujemny, faza hold, stoją) za ringiem', () => {
  assert.equal(shared.got.errors.length, 0, JSON.stringify(shared.got.errors[0] || null));
  const actors = decode(shared.got.actors);
  assert.ok(actors.length <= BUBBLE_ENTITY_LIMIT);
  const parked = actors.filter((a) => (a.flags & ACTOR_FLAG.PARKED) && !(a.flags & ACTOR_FLAG.STOCK));
  assert.ok(parked.length >= 10, `statków na redzie ${parked.length}`);
  const plan = world.parking.get('earth');
  const rim = Math.min(...plan.zones.map((z) => z.r0));
  const ids = new Set();
  for (const a of parked) {
    assert.ok(a.id < 0 && !ids.has(a.id));
    ids.add(a.id);
    assert.equal(a.phase, 'hold');
    assert.equal(a.vx, 0);
    const r = Math.hypot(a.x - earthNode.x, a.y - earthNode.y);
    assert.ok(r >= rim - 1, `poza płytą ringu i korytarzem (${Math.round(r)} < ${Math.round(rim)})`);
  }
  // Ten sam statek po kolejnym kroku świata stoi w tym samym miejscu (rejestr postoju jest stabilny).
  const before = new Map(parked.map((a) => [a.id, a]));
  for (let i = 0; i < 6; i++) shared.core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 });
  for (const a of decode(shared.got.actors)) {
    const b = before.get(a.id);
    if (b) assert.ok(a.x === b.x && a.y === b.y);
  }
});

test('statek z redy, który dostał kurs, startuje z miejsca postoju w tym samym buforze (bez mignięcia)', () => {
  let prev = new Map(decode(shared.got.actors).map((a) => [a.id, a]));
  let gone = 0;
  let same = 0;
  for (let f = 0; f < 240 * 10; f++) {
    shared.core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 10 });
    const cur = new Map(decode(shared.got.actors).map((a) => [a.id, a]));
    for (const [id, p] of prev) {
      if (cur.has(id) || !(p.flags & ACTOR_FLAG.PARKED) || (p.flags & ACTOR_FLAG.STOCK)) continue;
      gone++;
      for (const [cid, c] of cur) {
        if (cid >= 0 && !prev.has(cid) && Math.hypot(c.x - p.x, c.y - p.y) < 50) { same++; break; }
      }
    }
    prev = cur;
  }
  assert.ok(gone > 0, 'statki odlatują z redy');
  assert.ok(same >= gone * 0.8, `kurs w pozie postoju: ${same} z ${gone}`);
  assert.ok(shared.core.bubble.parked.handoffs > 0);
});

test('postój i zapas floty są nietykalne w grze (jak STOCK): pocisk staje, bez obrażeń i awansu', () => {
  const actors = decode(shared.got.actors).filter((a) => a.flags & ACTOR_FLAG.PARKED);
  assert.ok(actors.length > 0);
  const bridge = { actors: shared.got.actors, hulls: shared.core.world ? [] : [], tables: null, destroyCourse() { throw new Error('bez zgłoszeń'); } };
  bridge.actors = { ...shared.got.actors, seq: 1, time: 0 };
  const tb = createTrafficBubble(bridge);
  syncTrafficBubble(tb, 0);
  const a = tb.list.find((x) => x.flags & ACTOR_FLAG.PARKED);
  assert.ok(a);
  const hp = a.hp;
  assert.equal(damageTrafficActor(tb, a, 1e6, a.x, a.y), false);
  assert.equal(a.hp, hp);
  assert.equal(trafficActorPromotable(a), false);
});

test('orbita postojowa przy budowlach doków E14: za dyskiem zapasu, od strony przeciwnej do węzła, z dala od ścieżek', () => {
  const state = shared.core.bubble;
  let ports = 0;
  for (const [id, layout] of world.docks) {
    const m = layout.model;
    if (!m) continue;
    ports++;
    const node = getNode(world.network, id);
    const plan = buildDockOrbitParking(layout, node, {});
    const slots = plan.zones[0].bands.flatMap((b) => b.slots.map((s) => ({ ...s, cls: b.cls })));
    assert.ok(slots.length >= 12, `${id}: slotów ${slots.length}`);
    const dNode = Math.hypot(m.x - node.x, m.y - node.y);
    for (const s of slots) {
      const cls = PARKING_SLOT_CLASSES[s.cls];
      assert.ok(Math.hypot(s.x - m.x, s.y - m.y) - cls.depth / 2 > m.keepR + 1600, `${id}: slot w dysku zapasu`);
      assert.ok(Math.hypot(s.x - node.x, s.y - node.y) >= dNode, `${id}: slot bliżej ciała niż budowla`);
    }
    // Plan bańki (z odcinkami ścieżek) — żaden slot nie leży na ścieżce wejścia / wyjścia stanowiska.
    shared.core.handle({ type: TRAFFIC_MSG.FOCUS, x: m.x, y: m.y, r: 60_000 });
    shared.core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 5 });
    const reg = state.parked.regs.get(id);
    assert.ok(reg?.plan?.zones?.[0]?.bands?.some((b) => b.slots.length), `${id}: orbita w bańce`);
    for (const b of reg.plan.zones[0].bands) {
      for (const s of b.slots) {
        for (const berth of layout.berths) {
          assert.ok(Math.hypot(s.x - berth.x, s.y - berth.y) > 2000, `${id}: slot przy stanowisku`);
        }
      }
    }
  }
  assert.ok(ports >= 10, `portów z budowlą ${ports}`);
  const actors = decode(shared.got.actors);
  assert.equal(shared.got.errors.length, 0, JSON.stringify(shared.got.errors[0] || null));
  assert.ok(actors.length <= BUBBLE_ENTITY_LIMIT);
});

test('gracz ma pierwszeństwo do miejsca na redzie: nowy statek nie dostaje slotu pod graczem', () => {
  const plan = world.parking.get('earth');
  const zone = plan.zones.find((z) => z.role === 'civil');
  const first = zone.bands[0].slots[0];
  const free = createParkingRegistry(plan, { mode: 'reda' });
  syncParking(free, [{ id: 'a', hullId: 'inter_station_shuttle' }]);
  const blocked = createParkingRegistry(plan, {
    mode: 'reda', isFree: (slot) => Math.hypot(slot.x - first.x, slot.y - first.y) > 500
  });
  syncParking(blocked, [{ id: 'a', hullId: 'inter_station_shuttle' }]);
  const a = free.byShip.get('a');
  const b = blocked.byShip.get('a');
  assert.equal(a.kind, 'reda');
  assert.equal(b.kind, 'reda');
  assert.ok(Math.hypot(b.x - first.x, b.y - first.y) > 500, 'slot pod graczem pominięty');
});

test('symulacja i bramka bilansu nie proszą o rozgrzewkę', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const rel of ['../scripts/symulacja-ruchu.mjs', '../scripts/bramka-bilansu.mjs']) {
    const src = await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    assert.ok(!/warmup/.test(src), `${rel} bez rozgrzewki`);
  }
});
