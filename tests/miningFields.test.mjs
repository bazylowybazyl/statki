// Pas w ekonomii ruchu v2 (E3, docs/PLAN-ekonomia-rynki.md § 3.3; src/game/traffic/miningFields.js): pola wydobywcze
// z danych pasa, punkt wyprawy w skałach, urobek ze składu miejsca, rejestr uszczuplenia i wyrwy — w polu gry
// i w replice obrazu tak samo; wyrwy przez most (urobek gracza → worker → `belt-holes`).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMiningFields, planExpedition, pickMiningField, recordExtraction, takeHoleUpdates, holeList,
  tickMiningFields, summarizeMining, meanRockTonnes, MINING_FIELDS_CONFIG
} from '../src/game/traffic/miningFields.js';
import { trafficFields, buildTrafficWorld, stepTrafficWorld, seededRandom, DEFAULT_ANGLE_FOR, TRAFFIC_STEP_SECONDS } from '../src/game/traffic/trafficWorld.js';
import { buildTravelNetwork, getNode } from '../src/game/traffic/travelNetwork.js';
import { TrafficBridge } from '../src/game/trafficBridge.js';
import { createTrafficCore } from '../src/game/traffic/trafficCore.js';
import { BELT_MSG } from '../src/game/traffic/trafficProtocol.js';
import { BeltWorld } from '../src/game/beltWorld.js';
import { AsteroidBeltField, BELT_BAND, BELT_FIELD_CONFIG } from '../src/game/asteroidBeltField.js';
import { GiantRock, buildGiantPlan } from '../src/game/asteroidGiants.js';
import { ROCK_TYPES } from '../src/game/asteroidRockKinds.js';

let _model = null;
/** Model świata skryptu pomiarowego (kąty planet DEFAULT_ANGLE_FOR, Słońce w zerze) — wspólny dla testów. */
function model() {
  if (!_model) _model = createMiningFields({ angleFor: DEFAULT_ANGLE_FOR });
  return _model;
}

function fresh(config) {
  return createMiningFields({ angleFor: DEFAULT_ANGLE_FOR, config });
}

/** Najgęstszy punkt pola sektora `fieldId` (próbki co 4000 j. wokół jego środka). */
function densestIn(m, fieldId) {
  const def = m.byId.get(fieldId);
  let best = null;
  for (let r = def.rMin; r < def.rMax; r += 20000) {
    for (let a = def.a0; a < def.a1; a += 20000 / r) {
      const x = m.origin.x + Math.cos(a) * r;
      const y = m.origin.y + Math.sin(a) * r;
      const d = m.field.densityAt(x, y);
      if (!best || d > best.d) best = { x, y, d };
    }
  }
  return best;
}

test('pola z danych pasa: sektory pasa głównego i Kuipera, Hildy, Trojańczycy; uran tylko w Kuiperze', () => {
  const fields = trafficFields();
  const ids = new Set(fields.map((f) => f.id));
  for (let k = 1; k <= MINING_FIELDS_CONFIG.sectors.main; k++) assert.ok(ids.has(`belt-main-${String(k).padStart(2, '0')}`));
  for (let k = 1; k <= MINING_FIELDS_CONFIG.sectors.kuiper; k++) assert.ok(ids.has(`belt-kuiper-${String(k).padStart(2, '0')}`));
  for (const id of ['belt-hildas-l3', 'belt-hildas-l4', 'belt-hildas-l5', 'belt-greeks', 'belt-trojans']) assert.ok(ids.has(id), id);
  for (const f of fields) {
    const uran = (f.yields.uranium_ore || 0) > 0;
    assert.equal(uran, f.id.startsWith('belt-kuiper'), `uran tylko w Kuiperze: ${f.id}`);
    const sum = Object.values(f.yields).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 0.02, `udziały pola sumują się do 1: ${f.id} ${sum}`);
  }
  const main = fields.find((f) => f.id === 'belt-main-01');
  assert.ok(main.yields.carbon_ore > 0 && main.yields.nickel_ore > 0 && main.yields.platinum_ore > 0,
    'pas główny: rudy z widm (węgiel, nikiel, platyna) z przystanków składu');
  // Skały kończą się na mainOuterAu (41,5 AU) — pole nie sięga 47 AU strefy HUD.
  assert.equal(main.outerAU, BELT_FIELD_CONFIG.mainOuterAu);
  assert.ok(main.orbitAU > 35.5 && main.orbitAU < 41.5);
  // Węzły sieci leżą tam, gdzie pole: środek sektora na promieniu pasa wokół Słońca gry.
  const origin = { x: 6e6, y: 6e6 };
  const net = buildTravelNetwork({ origin, angleFor: DEFAULT_ANGLE_FOR, fields: trafficFields(undefined, { origin }) });
  const node = getNode(net, 'belt-main-03');
  const r = Math.hypot(node.x - origin.x, node.y - origin.y) / net.auInWorldUnits;
  assert.ok(Math.abs(r - node.orbitRadius / net.auInWorldUnits) < 1e-9 && r > 35.5 && r < 41.5);
});

test('geometria pola ruchu = pole gry: ta sama skala AU, Jowisz i gęstość jak w świecie z tymi kątami', () => {
  const m = model();
  const net = buildTravelNetwork({ angleFor: DEFAULT_ANGLE_FOR, fields: m.fields });
  assert.equal(m.au, net.auInWorldUnits);
  const jupiter = getNode(net, 'jupiter');
  const pj = m.field.regions.find((r) => r.beltId === 'greeks');
  assert.ok(Math.abs(Math.atan2(jupiter.y, jupiter.x) + Math.PI / 3 - pj.angMid) < 1e-9, 'L4 = Jowisz + 60°');
  // Pole gry z planetami sieci (jak BeltWorld z planetami gry) daje te same gęstości.
  const planets = net.stations.filter((n) => !n.moon && !n.outpost).map((n) => ({ id: n.id, x: n.x, y: n.y, angle: n.angle, orbitRadius: n.orbitRadius }));
  const game = new AsteroidBeltField({ planets, sunX: 0, sunY: 0, auToWorld: net.auInWorldUnits });
  for (const [x, y] of [[38.6 * m.au, 0], [0, 44.4 * m.au], [-50.2 * m.au * 0.5, 50.2 * m.au * 0.866], [133 * m.au, 0]]) {
    assert.equal(m.field.densityAt(x, y), game.densityAt(x, y));
  }
});

test('średnia skała ≥ 80 j. waży ~11 t, rdzeń komórki rejestru ma setki ton rudy', () => {
  const t = meanRockTonnes();
  assert.ok(t > 6 && t < 20, `średnia masa skały ${t}`);
  const m = fresh();
  const p = densestIn(m, 'belt-main-05');
  const cell = recordExtraction(m, p.x, p.y, 1e-9);
  assert.ok(cell.reserve > 80 && cell.reserve < 1200, `zasób komórki w rdzeniu pola: ${cell.reserve}`);
});

test('punkt wyprawy leży w skałach pola, urobek ze składu miejsca, czas z gęstości i rzadkości', () => {
  const m = fresh();
  const rng = seededRandom(11);
  const cases = [
    ['belt-main-04', 'iron_ore'], ['belt-main-07', 'silicon_ore'], ['belt-main-10', 'carbon_ore'],
    ['belt-main-02', 'raw_crystal'], ['belt-hildas-l4', 'ice'], ['belt-kuiper-05', 'uranium_ore']
  ];
  let total = 0;
  let inRocks = 0;
  for (const [fieldId, res] of cases) {
    const node = { id: fieldId };
    const def = m.byId.get(fieldId);
    let nearPeak = 0;
    for (let i = 0; i < 25; i++) {
      const plan = planExpedition(m, node, res, 120, rng);
      assert.ok(plan, `plan wyprawy: ${fieldId} ${res}`);
      // Hildy są rzadkie (szczyt pola < progu „w skałach”) — tam miarą jest bliskość szczytu ich pola.
      if (fieldId.startsWith('belt-hildas')) {
        if (plan.density >= 0.25 * Math.max(...def.table.dens)) nearPeak++;
        if (i === 24) assert.ok(nearPeak >= 18, `Hildy: wyprawy przy gęstych skupiskach ${nearPeak}/25`);
      } else {
        total++;
        if (plan.inRocks) inRocks++;
      }
      const dx = plan.spot.x - m.origin.x;
      const dy = plan.spot.y - m.origin.y;
      const r = Math.hypot(dx, dy);
      assert.ok(r >= def.rMin - 9000 && r <= def.rMax + 9000, `punkt w paśmie pola ${fieldId}`);
      assert.ok(plan.density > 0, 'punkt w pasie');
      const sum = Object.values(plan.harvest).reduce((s, n) => s + n, 0);
      assert.ok(sum <= 120 && sum >= 100, `ładownia ~pełna: ${sum}`);
      assert.ok(plan.harvest[res] >= 120 * MINING_FIELDS_CONFIG.minWanted - 1, `chciana ruda ≥ 70% ładowni: ${JSON.stringify(plan.harvest)}`);
      if (!fieldId.startsWith('belt-kuiper')) assert.equal(plan.harvest.uranium_ore, undefined, 'uran tylko w Kuiperze');
      for (const id of Object.keys(plan.harvest)) assert.ok(def.yields[id] > 0 || id === 'ice', `urobek ze składu pola: ${id} w ${fieldId}`);
      assert.ok(plan.seconds >= def.extractionSeconds * MINING_FIELDS_CONFIG.extraction.min - 1e-9);
    }
  }
  assert.ok(inRocks / total >= 0.9, `wyprawy w skałach: ${inRocks}/${total}`);
  // Kryształ jest rzadki — szuka się go dłużej niż żelaza w tym samym polu.
  const r2 = seededRandom(5);
  const fe = planExpedition(fresh(), { id: 'belt-main-04' }, 'iron_ore', 120, r2);
  const kr = planExpedition(fresh(), { id: 'belt-main-04' }, 'raw_crystal', 120, seededRandom(5));
  assert.ok(kr.seconds > fe.seconds, `kryształ dłużej (${kr.seconds}) niż żelazo (${fe.seconds})`);
});

test('wybór pola: najbliższy sektor z rudą; uran tylko z Kuipera; pole wyczerpane odpada', () => {
  const m = fresh();
  const net = buildTravelNetwork({ angleFor: DEFAULT_ANGLE_FOR, fields: m.fields });
  const ceres = { x: 38.8 * m.au, y: 0 };
  const pick = pickMiningField(m, net, ceres, 'iron_ore');
  assert.ok(pick && pick.id.startsWith('belt-main'), 'żelazo z pasa głównego');
  const near = net.fields.filter((f) => f.id.startsWith('belt-main'))
    .sort((a, b) => Math.hypot(a.x - ceres.x, a.y - ceres.y) - Math.hypot(b.x - ceres.x, b.y - ceres.y))[0];
  assert.equal(pick.id, near.id, 'najbliższy sektor');
  assert.ok(pickMiningField(m, net, ceres, 'uranium_ore').id.startsWith('belt-kuiper'));
  assert.equal(pickMiningField(m, net, ceres, 'steel_plate'), null, 'stal nie rośnie w pasie');
  // Wybieramy sektor do zera (tabela zabrana w całości) — wybór przechodzi dalej.
  planExpedition(m, near, 'iron_ore', 120, seededRandom(1));
  const def = m.byId.get(near.id);
  for (let i = 0; i < def.table.count; i++) def.table.taken[i] = def.table.reserve[i];
  def.table.avail.clear();
  const next = pickMiningField(m, net, ceres, 'iron_ore');
  assert.ok(next && next.id !== near.id, 'wyczerpany sektor odpada');
});

test('rejestr: progi uszczuplenia → wyrwa coraz głębsza; zmiany do wysłania raz; regeneracja tylko z konfiguracji', () => {
  const m = fresh();
  const p = densestIn(m, 'belt-main-06');
  const cell = recordExtraction(m, p.x, p.y, 1e-9);
  assert.equal(takeHoleUpdates(m), null, 'bez progu bez wyrwy');
  const levels = MINING_FIELDS_CONFIG.holeLevels;
  recordExtraction(m, p.x, p.y, cell.reserve * (levels[0] + 0.01));
  let up = takeHoleUpdates(m);
  assert.equal(up.length, 1);
  assert.equal(up[0].depth, MINING_FIELDS_CONFIG.holeDepths[0]);
  assert.ok(Math.hypot(up[0].x - (cell.ix + 0.5) * m.config.cell, up[0].y - (cell.iy + 0.5) * m.config.cell) < m.config.cell * 0.3);
  assert.equal(takeHoleUpdates(m), null, 'zmiana wysyła się raz');
  recordExtraction(m, p.x, p.y, cell.reserve);
  up = takeHoleUpdates(m);
  assert.equal(up[0].depth, 1, 'wybrana komórka = pusto');
  assert.equal(holeList(m).length, 1);
  // Domyślnie bez regeneracji.
  tickMiningFields(m, 3600 * 10);
  assert.equal(takeHoleUpdates(m), null);
  // Z regeneracją 50%/h komórka wraca do pola (wyrwa znika).
  const g = fresh({ regenPerHour: 0.5 });
  const c2 = recordExtraction(g, p.x, p.y, 1e-9);
  recordExtraction(g, p.x, p.y, c2.reserve);
  takeHoleUpdates(g);
  tickMiningFields(g, 3600 * 3);
  const back = takeHoleUpdates(g);
  assert.equal(back.length, 1);
  assert.equal(back[0].depth, 0, 'regeneracja zamyka wyrwę');
  assert.equal(holeList(g).length, 0);
});

test('kopalnia: kolejne wyprawy kopią sąsiednie komórki — wyrwa rośnie w wyrobisko', () => {
  const m = fresh({ claimReuse: 1 });
  const rng = seededRandom(3);
  const node = { id: 'belt-main-05' };
  const cells = new Set();
  for (let i = 0; i < 40; i++) {
    const plan = planExpedition(m, node, 'silicon_ore', 120, rng);
    assert.ok(plan);
    cells.add(`${Math.floor(plan.spot.x / m.config.cell)}:${Math.floor(plan.spot.y / m.config.cell)}`);
    recordExtraction(m, plan.spot.x, plan.spot.y, 120);
  }
  const holes = takeHoleUpdates(m) || [];
  assert.ok(holes.length >= 3, `wyrwy: ${holes.length}`);
  assert.ok(cells.size >= 3 && cells.size <= 20, `komórki wyrobiska: ${cells.size}`);
  // Wyrobisko jest zwarte: każda komórka ma sąsiada w zbiorze.
  const list = [...cells].map((k) => k.split(':').map(Number));
  const lonely = list.filter(([x, y]) => !list.some(([u, v]) => (u !== x || v !== y) && Math.abs(u - x) <= 1 && Math.abs(v - y) <= 1));
  assert.ok(lonely.length <= 2, `samotne komórki: ${lonely.length}`);
});

// ── Wyrwa w polu gry i w replice obrazu ─────────────────────────────────────────

function stubBuilder() {
  return () => ({
    build(id, seed, x, y) {
      return { giant: new GiantRock(buildGiantPlan(id, seed), x, y), promise: new Promise(() => {}) };
    }
  });
}

function rockIds(field, band, x0, y0, x1, y1) {
  const ids = [];
  field.forEachRockInRect(band, x0, y0, x1, y1, 0, (r) => ids.push(r.id));
  return ids.sort((a, b) => a - b);
}

test('wyrwa przez świat pasa: pole gry i replika obrazu tracą te same skały (gra i tło), reszta bit w bit', () => {
  const m = model();
  const bw = new BeltWorld({ planets: [], sun: { x: 0, y: 0 }, auToWorld: m.au, createBuilder: stubBuilder() });
  const replica = bw.createFieldReplica();
  const p = densestIn(m, 'belt-main-08');
  const R = 12000;
  const box = [p.x - R, p.y - R, p.x + R, p.y + R];
  const before = {};
  for (const band of [BELT_BAND.PLAY, BELT_BAND.MID]) {
    before[band] = rockIds(bw.field, band, ...box);
    assert.deepEqual(rockIds(replica, band, ...box), before[band], 'replika = pole gry przed wyrwą');
  }
  const far = [p.x + 60000, p.y - 8000, p.x + 76000, p.y + 8000];
  const farBefore = rockIds(bw.field, BELT_BAND.PLAY, ...far);

  // Skały pasma w kole r wokół środka wyrwy.
  const inCircle = (field, band, r) => {
    const ids = [];
    field.forEachRockInRect(band, p.x - r, p.y - r, p.x + r, p.y + r, 0, (q) => { if (Math.hypot(q.x - p.x, q.y - p.y) < r) ids.push(q.id); });
    return ids.length;
  };
  const circleBefore = { [BELT_BAND.PLAY]: inCircle(bw.field, BELT_BAND.PLAY, 4000), [BELT_BAND.MID]: inCircle(bw.field, BELT_BAND.MID, 4000) };

  bw.setHoles([{ id: 'w-test', x: p.x, y: p.y, r: 7000, depth: 1 }, { id: 'w-plytka', x: p.x + 9000, y: p.y, r: 6000, depth: 0.5 }]);
  for (const band of [BELT_BAND.PLAY, BELT_BAND.MID]) {
    const game = rockIds(bw.field, band, ...box);
    assert.deepEqual(rockIds(replica, band, ...box), game, 'replika = pole gry z wyrwą');
    assert.ok(game.length < before[band].length, `wyrwa zabiera skały pasma ${band}: ${before[band].length} → ${game.length}`);
    const left = inCircle(bw.field, band, 4000);
    assert.ok(left <= circleBefore[band] * 0.3, `w kole wyrwy zostaje ≤ 30% skał pasma ${band}: ${circleBefore[band]} → ${left}`);
    // Poza kołami wyrw (z zapasem największej skały z księżycem) — te same skały; w wyrwie mogą wejść drobne skały,
    // które wcześniej odpadały przez nachodzenie na zabraną dużą (tak samo w obu polach).
    const outside = (field) => {
      const ids = [];
      field.forEachRockInRect(band, ...box, 0, (q) => {
        if (Math.hypot(q.x - p.x, q.y - p.y) > 7000 + 7000 && Math.hypot(q.x - p.x - 9000, q.y - p.y) > 6000 + 7000) ids.push(q.id);
      });
      return ids.sort((a, b) => a - b);
    };
    if (band === BELT_BAND.PLAY) {
      const afterOut = outside(bw.field);
      bw.setHoles([{ id: 'w-test', depth: 0 }, { id: 'w-plytka', depth: 0 }]);
      assert.deepEqual(outside(bw.field), afterOut, 'poza wyrwą skały bez zmian (te same id)');
      bw.setHoles([{ id: 'w-test', x: p.x, y: p.y, r: 7000, depth: 1 }, { id: 'w-plytka', x: p.x + 9000, y: p.y, r: 6000, depth: 0.5 }]);
    }
  }
  // Środek wyrwy pusty, poza nią bez zmian.
  const core = rockIds(bw.field, BELT_BAND.PLAY, p.x - 2000, p.y - 2000, p.x + 2000, p.y + 2000);
  assert.equal(core.length, 0, 'środek wyrwy o głębokości 1 bez skał gry');
  assert.deepEqual(rockIds(bw.field, BELT_BAND.PLAY, ...far), farBefore, 'daleko od wyrwy skały bez zmian');
  assert.equal(bw.field.depletedDensityAt(p.x, p.y), 0);
  assert.equal(replica.depletedDensityAt(p.x + 9000, p.y), bw.field.depletedDensityAt(p.x + 9000, p.y));
  assert.ok(bw.field.holeVersion > 0 && bw.field.holeDirty.length > 0, 'prostokąt zmian dla warstw obrazu');

  // Replika zbudowana PÓŹNIEJ (obraz w workerze po starcie) dostaje wyrwy z historii — jeden wpis z pełnym stanem.
  const late = bw.createFieldReplica();
  assert.deepEqual(rockIds(late, BELT_BAND.PLAY, ...box), rockIds(bw.field, BELT_BAND.PLAY, ...box));
  assert.equal(bw._fieldOps.filter((e) => e[0] === 'holes').length, 1);

  // Usunięcie (depth 0) przywraca pole.
  bw.setHoles([{ id: 'w-test', depth: 0 }, { id: 'w-plytka', depth: 0 }]);
  assert.deepEqual(rockIds(bw.field, BELT_BAND.PLAY, ...box), before[BELT_BAND.PLAY]);
  assert.deepEqual(rockIds(replica, BELT_BAND.PLAY, ...box), before[BELT_BAND.PLAY]);
  assert.deepEqual(rockIds(late, BELT_BAND.PLAY, ...box), before[BELT_BAND.PLAY]);
});

test('typeSharesAt: udziały typów jak losowanie skał w komórkach (rdzeń pola)', () => {
  const m = model();
  const p = densestIn(m, 'belt-main-03');
  const shares = new Float64Array(ROCK_TYPES.length);
  const d = m.field.typeSharesAt(p.x, p.y, shares);
  assert.equal(d, m.field.densityAt(p.x, p.y));
  assert.ok(Math.abs(shares.reduce((s, v) => s + v, 0) - 1) < 1e-9);
  // Oczekiwany udział (typeSharesAt w miejscu KAŻDEJ skały — typ nie wpływa na przyjęcie kandydata) kontra
  // wylosowane typy skał w próbce.
  const rocks = [];
  m.field.forEachRockInRect(BELT_BAND.PLAY, p.x - 20000, p.y - 20000, p.x + 20000, p.y + 20000, 0, (r) => rocks.push({ x: r.x, y: r.y, type: r.type }));
  assert.ok(rocks.length > 300, `skał w próbce: ${rocks.length}`);
  const expected = new Float64Array(ROCK_TYPES.length);
  const seen = new Float64Array(ROCK_TYPES.length);
  const tmp = new Float64Array(ROCK_TYPES.length);
  for (const r of rocks) {
    m.field.typeSharesAt(r.x, r.y, tmp);
    for (let i = 0; i < tmp.length; i++) expected[i] += tmp[i] / rocks.length;
    seen[r.type] += 1 / rocks.length;
  }
  const neutral = (a) => a[ROCK_TYPES.indexOf('rock')] + a[ROCK_TYPES.indexOf('rock_c')];
  assert.ok(Math.abs(neutral(expected) - neutral(seen)) < 0.06, `wypełniacz: ${neutral(expected).toFixed(3)} vs ${neutral(seen).toFixed(3)}`);
  const top = [...expected.keys()].sort((a, b) => expected[b] - expected[a])[0];
  assert.ok(Math.abs(expected[top] - seen[top]) < 0.06, `najczęstszy typ ${ROCK_TYPES[top]}: ${expected[top].toFixed(3)} vs ${seen[top].toFixed(3)}`);
});

// ── Ruch v2: wyprawy w świecie i most ──────────────────────────────────────────

test('świat ruchu: wyprawy z danych pasa trafiają w skały, urobek schodzi z pasa po wydobyciu', () => {
  const world = buildTrafficWorld({ seed: 7, economyScale: 4, capacityMultiplier: 4, piracyPressure: 0 });
  assert.ok(world.director.mining, 'dyspozytor ma model pól');
  for (let t = 0; t < 40 * 60; t += TRAFFIC_STEP_SECONDS) stepTrafficWorld(world, TRAFFIC_STEP_SECONDS);
  const s = summarizeMining(world.director.mining);
  assert.ok(s.expeditions > 0, 'są wyprawy');
  assert.ok(s.inRocks / s.expeditions >= 0.7, `w skałach: ${s.inRocks}/${s.expeditions}`);
  const mine = world.registry.active.filter((c) => c.kind === 'mine');
  for (const c of mine) {
    assert.ok(c.payload.extract, 'wyprawa niesie punkt urobku');
    const extract = c.stages[c.payload.extract.stage];
    assert.equal(extract.reason, 'extract', 'indeks etapu wydobycia');
    assert.equal(c.payload.extract.booked, c.stageIndex > c.payload.extract.stage, 'urobek zszedł z pasa dopiero po wydobyciu');
  }
  assert.ok(s.extracted > 0, 'rejestr dostał urobek');
});

test('most: urobek gracza → rejestr w workerze → zdarzenie belt-holes i kopia wyrw', async () => {
  const bridge = new TrafficBridge({ useWorker: false, coreFactory: createTrafficCore });
  await bridge.init({ seed: 3, economyScale: 2, capacityMultiplier: 4, piracyPressure: 0 });
  const mining = bridge.core.world.director.mining;
  const p = densestIn(mining, 'belt-main-02');
  const got = [];
  bridge.on('belt-holes', (list) => got.push(...list));
  bridge.reportMining(p.x, p.y, 1e6);
  assert.equal(got.length, 1, 'wyrwa przyszła od razu');
  assert.equal(got[0].depth, 1);
  assert.equal(bridge.beltHoles.size, 1);
  assert.equal(summarizeMining(mining).player, 1e6);
  bridge.reportMining(p.x, p.y, -5);
  bridge.reportMining(NaN, p.y, 10);
  assert.equal(got.length, 1, 'zły urobek nic nie robi');
  // Wiadomość z pełną listą zastępuje kopię.
  bridge._receive({ type: BELT_MSG.HOLES, holes: [], full: true });
  assert.equal(bridge.beltHoles.size, 0);
});
