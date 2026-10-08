import test from 'node:test';
import assert from 'node:assert/strict';
import { readIndexHtml, sliceFunction } from './helpers/indexSource.mjs';
import {
  createReferenceAvoidance, createReferenceGrid, createReferenceObstacleCap, createReferenceSeparation
} from './helpers/aiNeighborReference.mjs';

// Migawka sąsiadów AI (src/ai/aiSpatialGrid.js, 2026-10-07): siatka trzyma byty w tablicach
// typowanych, a unik CPA (aiNeighborKernels.js) i separacja (index.html) liczą na nich. Wynik
// MUSI być bit w bit ten sam co w dawnym kodzie dla tych samych danych — wzorce (siatka na Map,
// computeTrafficAvoidance, applySeparationForces) to dosłowne kopie sprzed zmiany
// (tests/helpers/aiNeighborReference.mjs). Losowe sceny: stłoczone i rozproszone floty, szybkie
// byty (ścieżka „cała lista”), martwi, myśliwce, tarcze, styki kadłubów, aliasy (ten sam byt
// dwa razy w siatce), pozycje NaN.

globalThis.window = globalThis.window || {};
Object.assign(globalThis.window, { ship: null, __frameId: 1 });
const Grid = await import('../src/ai/aiSpatialGrid.js');
const { trafficAvoidanceObjects } = await import('../src/ai/aiNeighborKernels.js');
const { isEnemyUnit } = await import('../src/ai/aiUtils.js');
const { computeTrafficAvoidance, capitalObstacleSpeedCap } = await import('../src/ai/capitalAI.js');

// Nowa separacja: wycięta z index.html razem z pomocnikami, jak w scripts/szyk-floty.mjs.
const html = readIndexHtml();
const uid0 = html.indexOf('let __sepUidCounter = 0;');
const NEW_SEPARATION_SOURCE = [
  sliceFunction(html, 'function isNpcCombatActive(npc) {'),
  sliceFunction(html, 'function clampVecLen(x, y, maxLen) {'),
  html.slice(uid0, html.indexOf('function sepPriority(u) {', uid0)),
  sliceFunction(html, 'function sepPriority(u) {'),
  sliceFunction(html, 'function sepYieldFactor(npc, other) {'),
  sliceFunction(html, 'function shieldPairStandoff(a, b) {'),
  sliceFunction(html, 'function applySeparationForces(npc, ax, ay) {')
].join('\n');
function createNewSeparation(scope) {
  return new Function('__scope', `with (__scope) {\n${NEW_SEPARATION_SOURCE}\nreturn { applySeparationForces, sepUid };\n}`)(scope);
}

function rngOf(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Scena jako zwykłe dane — z niej powstają niezależne zestawy obiektów (każda implementacja
// dostaje własny: __sepUid i bufory separacji są polami bytów).
function makeScene(seed) {
  const rnd = rngOf(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const spread = pick([900, 2500, 6000, 20000]);
  const n = 20 + Math.floor(rnd() * 200);
  const ents = [];
  for (let i = 0; i < n; i++) {
    const far = rnd() < 0.08;
    const speedKind = rnd();
    const sp = speedKind < 0.2 ? rnd() * 25 : (speedKind < 0.9 ? rnd() * 700 : 2000 + rnd() * 28000);
    const dir = rnd() * Math.PI * 2;
    const fighter = rnd() < 0.2;
    const e = {
      id: i,
      x: (far ? 2e5 : spread) * (rnd() * 2 - 1),
      y: (far ? 2e5 : spread) * (rnd() * 2 - 1),
      vx: Math.cos(dir) * sp,
      vy: Math.sin(dir) * sp,
      radius: rnd() < 0.05 ? undefined : (fighter ? 10 + rnd() * 40 : 40 + rnd() * 900),
      mass: rnd() < 0.05 ? undefined : (fighter ? 0.5 + rnd() * 2 : 1 + rnd() * 200000),
      fighter,
      isCapitalShip: fighter ? rnd() < 0.05 : rnd() < 0.6,
      friendly: pick([true, true, false, false, undefined]),
      isPirate: rnd() < 0.4,
      team: rnd() < 0.15 ? pick(['a', 'b']) : undefined,
      dead: rnd() < 0.05,
      state: rnd() < 0.3 ? 'engage_formation' : 'idle',
      shield: rnd() < 0.65 ? { base: 50 + rnd() * 1500, progress: pick([0, 0.3 + rnd() * 0.7, 1]) } : null
    };
    if (rnd() < 0.01) e.x = NaN;
    if (rnd() < 0.01) e.y = NaN;
    ents.push(e);
  }
  // Styki kadłubów: losowe pary bliskich bytów.
  const contacts = new Set();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = ents[i];
      const b = ents[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1500 && rnd() < 0.15) contacts.add(i * 100000 + j);
    }
  }
  const player = rnd() < 0.75 ? {
    x: spread * (rnd() * 2 - 1),
    y: spread * (rnd() * 2 - 1),
    vx: (rnd() * 2 - 1) * 600,
    vy: (rnd() * 2 - 1) * 600,
    radius: 915,
    shield: { base: 1100, progress: rnd() < 0.5 ? 1 : 0 }
  } : null;
  // Lista NPC: czasem ten sam byt dwa razy, czasem gracz także na liście (alias w siatce).
  const order = ents.map((e) => e.id);
  if (rnd() < 0.3) order.push(order[Math.floor(rnd() * order.length)]);
  const playerInList = !!player && rnd() < 0.2;
  return { seed, ents, contacts, player, order, playerInList };
}

function instantiate(scene) {
  const byId = scene.ents.map((d) => {
    const e = {
      id: d.id, x: d.x, y: d.y, vx: d.vx, vy: d.vy, radius: d.radius, mass: d.mass,
      fighter: d.fighter, isCapitalShip: d.isCapitalShip, friendly: d.friendly, isPirate: d.isPirate,
      team: d.team, dead: d.dead, state: d.state
    };
    if (d.shield) e.__testShield = { ...d.shield };
    return e;
  });
  let player = null;
  if (scene.player) {
    const p = scene.player;
    player = {
      id: -1, pos: { x: p.x, y: p.y }, vel: { x: p.vx, y: p.vy }, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      radius: p.radius, friendly: true, destroyed: false, __testShield: { ...p.shield }
    };
  }
  const list = scene.order.map((id) => byId[id]);
  if (scene.playerInList) list.push(player);
  const hullBodies = {
    hasContact: (a, b) => {
      const i = Math.min(a.id, b.id);
      const j = Math.max(a.id, b.id);
      return i >= 0 && scene.contacts.has(i * 100000 + j);
    }
  };
  return { byId, player, list, hullBodies };
}

const shieldScope = {
  getEntityShieldBlockingProgress: (e) => (e.__testShield ? e.__testShield.progress : 0),
  getEntityShieldBaseRadius: (e) => (e.__testShield ? e.__testShield.base : 0)
};

function sameBits(a, b) {
  return Object.is(a, b);
}

function assertSameVec(actual, expected, label) {
  if (!sameBits(actual.ax, expected.ax) || !sameBits(actual.ay, expected.ay)) {
    assert.fail(`${label}: (${actual.ax}, ${actual.ay}) zamiast (${expected.ax}, ${expected.ay})`);
  }
}

// Kierunki do ogranicznika przeszkód (kurs do celu i pęd) — z ziarna sceny i numeru bytu.
function obstacleQuery(scene, e) {
  const rnd = rngOf(scene.seed * 977 + e.id * 31 + 7);
  const a = rnd() * Math.PI * 2;
  const kind = rnd();
  const b = rnd() * Math.PI * 2;
  return {
    d1x: Math.cos(a), d1y: Math.sin(a),
    d2x: kind < 0.2 ? NaN : (kind < 0.3 ? 0 : Math.cos(b)), d2y: kind < 0.2 ? NaN : (kind < 0.3 ? 0 : Math.sin(b)),
    spec: rnd() < 0.15 ? null : { decel: 200 + rnd() * 2000 }
  };
}

// Pomiar jednej implementacji na jej własnym zestawie obiektów.
function measure(scene, w, avoid, sep, obstacle) {
  const out = [];
  for (const e of w.byId) {
    const a = avoid(e, { ax: 0, ay: 0 });
    const s = sep.applySeparationForces(e, 0, 0);
    const q = obstacleQuery(scene, e);
    const capFresh = obstacle(e, q.d1x, q.d1y, q.d2x, q.d2y, q.spec, true);
    const cap = obstacle(e, q.d1x, q.d1y, q.d2x, q.d2y, q.spec, false);
    out.push({ avoid: { ax: a.ax, ay: a.ay }, sep: { ax: s.ax, ay: s.ay }, capFresh, cap, blk: { ...e.__obsBlk } });
  }
  return { out, uids: w.byId.map((e) => e.__sepUid) };
}

// Dawne liczenie: siatka na Map, unik, separacja i przeszkody dosłownie sprzed zmiany.
function runReference(scene, aiTick) {
  const w = instantiate(scene);
  const win = { ship: w.player, __frameId: 4242 };
  const grid = createReferenceGrid(win);
  grid.rebuildAIGrid(w.list, true);
  win.queryAIGrid = grid.queryAIGrid;
  win.isEnemyUnit = isEnemyUnit;
  const avoid = createReferenceAvoidance(win);
  const sep = createReferenceSeparation({
    window: win, npcs: w.list, HullBodies: w.hullBodies, aiDecisionTickId: aiTick, performance, ...shieldScope
  });
  globalThis.window.ship = w.player;
  return measure(scene, w, avoid, sep, createReferenceObstacleCap(win));
}

// Nowe liczenie na migawce prawdziwej siatki (window.queryAIGrid z aiSnapshot).
function runSnapshot(scene, aiTick) {
  const w = instantiate(scene);
  globalThis.window.ship = w.player;
  Grid.rebuildAIGrid(w.list, true);
  globalThis.window.queryAIGrid = Grid.queryAIGrid;
  const win = { ship: w.player, queryAIGrid: Grid.queryAIGrid, isEnemyUnit };
  const sep = createNewSeparation({
    window: win, npcs: w.list, HullBodies: w.hullBodies, aiDecisionTickId: aiTick, performance, ...shieldScope
  });
  return measure(scene, w, computeTrafficAvoidance, sep, capitalObstacleSpeedCap);
}

// Nowy kod na atrapie siatki (bez aiSnapshot) — droga po obiektach.
function runObjects(scene, aiTick) {
  const w = instantiate(scene);
  const refWin = { ship: w.player };
  const grid = createReferenceGrid(refWin);
  grid.rebuildAIGrid(w.list, true);
  const stub = (x, y, r) => grid.queryAIGrid(x, y, r);
  globalThis.window.ship = w.player;
  globalThis.window.queryAIGrid = stub;
  const win = { ship: w.player, queryAIGrid: stub, isEnemyUnit };
  const sep = createNewSeparation({
    window: win, npcs: w.list, HullBodies: w.hullBodies, aiDecisionTickId: aiTick, performance, ...shieldScope
  });
  try {
    return measure(scene, w, computeTrafficAvoidance, sep, capitalObstacleSpeedCap);
  } finally {
    globalThis.window.queryAIGrid = Grid.queryAIGrid;
  }
}

const BLK_KEYS = ['on', 'x', 'y', 'vx', 'vy', 'c', 'along'];

function compareRuns(ref, got, label) {
  let nonzeroAvoid = 0;
  let nonzeroSep = 0;
  let cappedObstacles = 0;
  for (let i = 0; i < ref.out.length; i++) {
    const r = ref.out[i];
    const g = got.out[i];
    assertSameVec(g.avoid, r.avoid, `${label}: unik bytu ${i}`);
    assertSameVec(g.sep, r.sep, `${label}: separacja bytu ${i}`);
    assert.ok(sameBits(g.capFresh, r.capFresh) && sameBits(g.cap, r.cap), `${label}: przeszkody bytu ${i}: ${g.cap} zamiast ${r.cap}`);
    for (const k of BLK_KEYS) assert.ok(sameBits(g.blk[k], r.blk[k]), `${label}: przeszkoda na kursie bytu ${i}, pole ${k}`);
    if (r.avoid.ax || r.avoid.ay) nonzeroAvoid++;
    if (r.sep.ax || r.sep.ay) nonzeroSep++;
    if (Number.isFinite(r.cap)) cappedObstacles++;
  }
  assert.deepEqual(got.uids, ref.uids, `${label}: kolejność nadawania __sepUid`);
  return { nonzeroAvoid, nonzeroSep, cappedObstacles };
}

test('unik CPA, separacja i przeszkody na migawce dają bit w bit to samo co dawny kod (losowe sceny)', () => {
  let avoidHits = 0;
  let sepHits = 0;
  let obstacleHits = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const scene = makeScene(seed * 7919);
    const tick = 1000 + seed;
    const ref = runReference(scene, tick);
    const snap = runSnapshot(scene, tick);
    const hits = compareRuns(ref, snap, `ziarno ${seed} (migawka)`);
    avoidHits += hits.nonzeroAvoid;
    sepHits += hits.nonzeroSep;
    obstacleHits += hits.cappedObstacles;
    compareRuns(ref, runObjects(scene, tick), `ziarno ${seed} (obiekty)`);
  }
  // Scena musi coś liczyć — inaczej porównanie zer niczego nie dowodzi.
  assert.ok(avoidHits > 200, `za mało niezerowych uników: ${avoidHits}`);
  assert.ok(sepHits > 500, `za mało niezerowych separacji: ${sepHits}`);
  assert.ok(obstacleHits > 300, `za mało przeszkód na kursie: ${obstacleHits}`);
});

test('separacja bez siatki (lista npcs) — nowa droga po obiektach jak dawna', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const scene = makeScene(seed * 104729);
    const tick = 5000 + seed;
    const run = (factory) => {
      const w = instantiate(scene);
      globalThis.window.ship = w.player;
      const sep = factory({
        window: { ship: w.player, isEnemyUnit }, npcs: w.list, HullBodies: w.hullBodies,
        aiDecisionTickId: tick, performance, ...shieldScope
      });
      const out = w.byId.map((e) => ({ avoid: { ax: 0, ay: 0 }, sep: { ...sep.applySeparationForces(e, 0, 0) }, capFresh: 0, cap: 0, blk: {} }));
      return { out, uids: w.byId.map((e) => e.__sepUid) };
    };
    compareRuns(run(createReferenceSeparation), run(createNewSeparation), `ziarno ${seed} (bez siatki)`);
  }
});

test('queryAIGrid zwraca te same byty w tej samej kolejności co dawna siatka', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const scene = makeScene(seed * 31337);
    const w = instantiate(scene);
    const refWin = { ship: w.player };
    const ref = createReferenceGrid(refWin);
    ref.rebuildAIGrid(w.list, true);
    globalThis.window.ship = w.player;
    Grid.rebuildAIGrid(w.list, true);
    const rnd = rngOf(seed);
    for (let q = 0; q < 60; q++) {
      const anchor = w.list[Math.floor(rnd() * w.list.length)];
      const x = q % 7 === 0 ? (rnd() * 2 - 1) * 30000 : (Number.isFinite(anchor?.x) ? anchor.x : 0) + (rnd() * 2 - 1) * 900;
      const y = q % 7 === 0 ? (rnd() * 2 - 1) * 30000 : (Number.isFinite(anchor?.y) ? anchor.y : 0) + (rnd() * 2 - 1) * 900;
      const radius = [0, 50, 450, 900, 3000, 4790, 4800, 5000, 6000, 20000, -5, NaN, Infinity][q % 13];
      const a = ref.queryAIGrid(x, y, radius);
      const expected = a.buffer.slice(0, a.count);
      const b = Grid.queryAIGrid(x, y, radius);
      assert.equal(b.count, a.count, `ziarno ${seed}, zapytanie ${q}: liczba bytów`);
      assert.equal(b.buffer.length, b.count);
      for (let i = 0; i < a.count; i++) {
        assert.ok(b.buffer[i] === expected[i], `ziarno ${seed}, zapytanie ${q}: byt ${i}`);
      }
    }
  }
});

test('kinematyka migawki odświeża się raz na krok (SimClock / __frameId), członkostwo w komórkach — przy przebudowie', () => {
  const scene = makeScene(424242);
  const tick = 9000;
  const w = instantiate(scene);
  globalThis.window.ship = w.player;
  Grid.rebuildAIGrid(w.list, true);
  const S = Grid.queryAIGrid.aiSnapshot;
  // Ruch po przebudowie (jak kolejne kroki fizyki przed mózgiem w późniejszej fazie).
  const moveAll = (k) => {
    for (const e of w.byId) {
      e.x += e.vx * k / 120;
      e.y += e.vy * k / 120;
    }
  };
  moveAll(3);
  // Ten sam krok — migawka trzyma dane z przebudowy.
  assert.ok(S.syncTick());
  const probe = w.byId.find((e) => !e.dead && Number.isFinite(e.x) && (e.vx || e.vy));
  const slotOf = (e) => S.refs.indexOf(e);
  assert.notEqual(S.x[slotOf(probe)], probe.x, 'bez nowego kroku migawka nie czyta obiektów');
  // Nowy krok: pierwsze jądro odświeża kinematykę z obiektów.
  globalThis.window.__frameId++;
  assert.ok(S.syncTick());
  assert.equal(S.x[slotOf(probe)], probe.x);
  assert.equal(S.vy[slotOf(probe)], probe.vy);
  // Po odświeżeniu wynik jak w dawnym kodzie, który czyta pola na żywo (komórki z przebudowy).
  const refWin = { ship: w.player };
  const refGrid = createReferenceGrid(refWin);
  const moved = w.byId.map((e) => [e.x, e.y]);
  for (const e of w.byId) {
    const d = scene.ents[e.id];
    e.x = d.x;
    e.y = d.y;
  }
  refGrid.rebuildAIGrid(w.list, true); // komórki z pozycji z przebudowy, jak w siatce migawki
  w.byId.forEach((e, i) => { e.x = moved[i][0]; e.y = moved[i][1]; });
  refWin.queryAIGrid = refGrid.queryAIGrid;
  refWin.isEnemyUnit = isEnemyUnit;
  const refAvoid = createReferenceAvoidance(refWin);
  globalThis.window.queryAIGrid = Grid.queryAIGrid;
  for (const e of w.byId) {
    const expected = refAvoid(e, { ax: 0, ay: 0 });
    const got = computeTrafficAvoidance(e, { ax: 0, ay: 0 });
    assertSameVec(got, expected, `unik bytu ${e.id} po ruchu`);
  }
  // Separacja: obie strony na tych samych obiektach — osobne ticki AI, żeby nie trafić w bufor.
  const refSep = createReferenceSeparation({
    window: refWin, npcs: w.list, HullBodies: w.hullBodies, aiDecisionTickId: tick, performance, ...shieldScope
  });
  const newSep = createNewSeparation({
    window: { ship: w.player, queryAIGrid: Grid.queryAIGrid, isEnemyUnit }, npcs: w.list, HullBodies: w.hullBodies,
    aiDecisionTickId: tick + 1, performance, ...shieldScope
  });
  for (const e of w.byId) {
    const expected = { ...refSep.applySeparationForces(e, 0, 0) };
    const got = newSep.applySeparationForces(e, 0, 0);
    assertSameVec(got, expected, `separacja bytu ${e.id} po ruchu`);
  }
});

test('ten sam byt wpisany dwa razy liczy się raz (gracz na liście NPC, powtórzony NPC)', () => {
  const a = { id: 0, x: 0, y: 0, vx: 300, vy: 0, radius: 100, mass: 1000, friendly: true };
  const b = { id: 1, x: 600, y: 0, vx: -300, vy: 0, radius: 100, mass: 1000, friendly: true };
  const player = { id: -1, pos: { x: 200, y: 50 }, vel: { x: 0, y: 0 }, x: 200, y: 50, radius: 915, friendly: true };
  const list = [a, b, b, player];
  globalThis.window.ship = player;
  Grid.rebuildAIGrid(list, true);
  const S = Grid.queryAIGrid.aiSnapshot;
  assert.equal(S.hasAliases, true);
  const ref = createReferenceGrid({ ship: player });
  ref.rebuildAIGrid(list, true);
  for (const [x, y, r] of [[0, 0, 900], [0, 0, 20000], [600, 0, 50]]) {
    const old = ref.queryAIGrid(x, y, r);
    const expected = old.buffer.slice(0, old.count);
    const q = Grid.queryAIGrid(x, y, r);
    assert.deepEqual(q.buffer.slice(0, q.count), expected, `zapytanie (${x}, ${y}, ${r})`);
  }
  // Komórka (0, 0): a, gracz (z listy i jako gracz); komórka (1, 0): b dwa razy.
  const q = Grid.queryAIGrid(0, 0, 900);
  assert.deepEqual(q.buffer.slice(0, q.count), [a, player, b]);
  globalThis.window.queryAIGrid = Grid.queryAIGrid;
  const got = computeTrafficAvoidance(a, { ax: 0, ay: 0 });
  const expected = trafficAvoidanceObjects(a, player, [a, player, b], 3, { ax: 0, ay: 0 });
  assertSameVec(got, expected, 'unik z aliasami');
  assert.ok(got.ax < 0 || got.ay !== 0, 'czołowe zbliżenie musi dać unik');
});

test('odstęp tarczy z taktu AI: zmiana tarczy w środku taktu działa od następnej przebudowy siatki', () => {
  // Dwa sojusznicze okręty 700 j. od siebie: kadłuby (2 × 150) się nie stykają, tarcze (2 × 400) tak.
  const make = () => {
    const a = { id: 0, x: 0, y: 0, vx: 0, vy: 0, radius: 150, mass: 20000, friendly: true, isCapitalShip: true,
      __testShield: { base: 400, progress: 1 } };
    const b = { id: 1, x: 700, y: 0, vx: 0, vy: 0, radius: 150, mass: 20000, friendly: true, isCapitalShip: true,
      __testShield: { base: 400, progress: 1 } };
    return { a, b, list: [a, b] };
  };
  const hullBodies = { hasContact: () => false };
  const sepOf = (w, tick, factory, queryAIGrid) => factory({
    window: { ship: null, queryAIGrid, isEnemyUnit }, npcs: w.list, HullBodies: hullBodies,
    aiDecisionTickId: tick, performance, ...shieldScope
  }).applySeparationForces(w.a, 0, 0);

  globalThis.window.ship = null;
  const w = make();
  Grid.rebuildAIGrid(w.list, false);
  const withShields = { ...sepOf(w, 1, createNewSeparation, Grid.queryAIGrid) };
  assert.ok(withShields.ax < 0, 'tarcze nachodzą — separacja odpycha a od b');

  // Tarcza b gaśnie w środku taktu; nowy krok fizyki (pozycje odświeżone), ta sama siatka.
  w.b.__testShield.progress = 0;
  globalThis.window.__frameId++;
  const sameCycle = sepOf(w, 2, createNewSeparation, Grid.queryAIGrid);
  assertSameVec(sameCycle, withShields, 'w tym samym takcie odstęp tarczy z przebudowy');

  // Następny takt: przebudowa siatki bierze nową tarczę — wynik jak w dawnym kodzie na żywo.
  Grid.rebuildAIGrid(w.list, false);
  const nextCycle = { ...sepOf(w, 3, createNewSeparation, Grid.queryAIGrid) };
  const ref = make();
  ref.b.__testShield.progress = 0;
  const refGrid = createReferenceGrid({ ship: null });
  refGrid.rebuildAIGrid(ref.list, false);
  const expected = sepOf(ref, 3, createReferenceSeparation, refGrid.queryAIGrid);
  assertSameVec(nextCycle, expected, 'po przebudowie odstęp tarczy z bieżącego stanu');
  assert.ok(Math.abs(nextCycle.ax) < Math.abs(withShields.ax), 'bez tarczy b odpychanie słabsze');
});
