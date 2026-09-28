// Zadanie 21b: platforma wydobywcza gracza (src/game/asteroidMiningRig.js) na fizyce skał
// (src/game/asteroidMining.js) — przejęcie skały pola, lasery dronów, urobek do ładowni
// (tony całkowite, udźwig), ładunki z magazynka, seria detonacji (jedna ciężka operacja na
// klatkę), wiązka z limitem ładowni, piła, zwalnianie dalekich ciał, determinizm, alokacje.
// node --test tests/asteroidMiningRig.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';

import { AsteroidMining, createYield } from '../src/game/asteroidMining.js';
import { MiningRig, MINING_FX, MINING_ORE_KEYS, createRigYield } from '../src/game/asteroidMiningRig.js';
import { ROCK_TYPE_INDEX } from '../src/game/asteroidRockKinds.js';
import { MINING_CHARGES, createMiningChargeStock, miningChargeById } from '../src/data/miningCharges.js';
import { RESOURCES, ASTEROID_YIELD } from '../src/data/resources.js';

// Kształt bez GPU: lekko pofalowana kula (jak tests/asteroidMining.test.mjs).
const lumpy = (shape, x, y, z) => 1 + 0.08 * Math.sin(3 * x + shape) * Math.cos(2 * y) + 0.05 * z * z;

function fieldRock(type, r, x, y, id, extra = {}) {
  return {
    id, x, y, r, d: 2 * r, shape: 3, type: ROCK_TYPE_INDEX[type],
    qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0.05, phase: 0.3,
    sx: 1, sy: 1, sz: 0.95, seed: 0.37, ...extra
  };
}

// Pole zastępcze: to samo API co AsteroidBeltField.forEachRockInRect (pasmo pomijane).
function fakeField(rocks) {
  return {
    rocks,
    calls: 0,
    forEachRockInRect(band, x0, y0, x1, y1, minD, cb) {
      this.calls++;
      let n = 0;
      for (const r of rocks) {
        if (r.d < minD || r.x + r.r < x0 || r.x - r.r > x1 || r.y + r.r < y0 || r.y - r.r > y1) continue;
        cb(r);
        n++;
      }
      return n;
    }
  };
}

const playZ = (rock) => -rock.r * 1.45 * Math.max(rock.sx, rock.sy, rock.sz);

function makeRig({ rocks, hold = 1e9, stock = null, seed = 0x51A7 } = {}) {
  const mining = new AsteroidMining({ radiusAt: lumpy, seed });
  const field = fakeField(rocks || [fieldRock('copper', 350, 3000, 0, 101)]);
  const rig = new MiningRig({ mining, field, playZ, stock: stock || createMiningChargeStock({ S: 2, M: 2, L: 2, XL: 1 }) });
  const cargo = {};
  let used = 0;
  rig.onCargo = (key, t) => {
    const take = Math.max(0, Math.min(t, Math.floor(hold - used)));
    cargo[key] = (cargo[key] || 0) + take;
    used += take;
    return take;
  };
  rig.cargoFree = () => hold - used;
  const ship = { x: 0, y: 0, angle: 0, len: 1800 };
  return { rig, mining, field, cargo, ship, used: () => used };
}

// Klatka gry: budżet ciężkich operacji, dwa kroki fizyki 120 Hz.
function frame(rig, ship, steps = 2) {
  rig.beginFrame();
  for (let i = 0; i < steps; i++) rig.step(1 / 120, ship);
}

function drainFx(rig, from) {
  const out = [];
  for (let i = from; i < rig.fxWrite; i++) out.push({ ...rig.fx[i % rig.fx.length] });
  return out;
}

// Pomiar alokacji PIERWSZY w pliku: inne testy robią miejsca wywołań polimorficznymi (JIT
// przestaje wklejać i pakuje liczby) — zasada z PLAN §3 (zadanie 19).
test('krok bez wydobycia (drony w doku) i cięcie laserem nie alokują na krok', () => {
  const { rig, ship } = makeRig();
  // Rozgrzewka JIT (interpreter pakuje każdą liczbę) — pomiar dopiero po optymalizacji.
  const measure = (fn, n) => {
    let best = Infinity;
    for (let i = 0; i < 3000; i++) fn();
    for (let attempt = 0; attempt < 4; attempt++) {
      for (let i = 0; i < 200; i++) fn();
      const before = v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
      for (let i = 0; i < n; i++) fn();
      const after = v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
      if (after >= before) best = Math.min(best, (after - before) / n);
    }
    return best;
  };
  const idle = measure(() => frame(rig, ship), 400);
  assert.ok(idle < 64, `bezczynny krok: ${idle.toFixed(1)} B/klatkę`);
  // Cięcie laserem (skała przejęta, drony na miejscu).
  rig.setEnabled(true);
  const rock = rig.field.rocks[0];
  rig.pointer(rock.x, rock.y, true);
  for (let f = 0; f < 120; f++) frame(rig, ship);
  assert.ok(rig.drones.some((d) => d.laserOn));
  const cutting = measure(() => frame(rig, ship), 200);
  // Rozpad do sprawdzenia (co 0,2 s) i przeliczenie masy tworzą tablice robocze, a kopanie
  // (dig — funkcja za duża na wklejenie) pakuje kilka liczb — średnio ~80 B na klatkę
  // (2026-09-28; przed zwarciem RockBody.sample: ~5 KB — próbki marszu promienia na stercie).
  assert.ok(cutting < 512, `cięcie: ${cutting.toFixed(1)} B/klatkę`);
});

test('laser: skała pola pod celem przechodzi do fizyki, drony tną, ruda trafia do ładowni w pełnych tonach', () => {
  const { rig, mining, cargo, ship } = makeRig();
  rig.setEnabled(true);
  const rock = rig.field.rocks[0];
  rig.pointer(rock.x, rock.y, true);
  frame(rig, ship);
  assert.equal(mining.bodies.length, 1, 'skała przejęta');
  assert.ok(rig.taken.has(rock.id) && rig.takenVersion > 0, 'id skały do schowania w warstwie pola');
  const body = mining.bodies[0];
  assert.ok(body.anchored, 'platforma kotwiczy skałę');
  assert.ok(Math.abs(body.p[2] - playZ(rock)) < body.cs * 3, 'ciało w z warstwy PLAY');
  // Drony lecą ~3000 j. i zaczynają ciąć; po chwili urobek (skorupa uboga — długo, rdzeń bogaty).
  // Otwór w środku skały r = 350 przechodzi na wylot po kilkunastu sekundach — wtedy promień
  // celu nie trafia skały i drony przestają ciąć (jak w demie).
  let lasered = 0;
  let firstLaser = -1;
  for (let f = 0; f < 60 * 25; f++) {
    frame(rig, ship);
    if (rig.drones.some((d) => d.laserOn)) { lasered++; if (firstLaser < 0) firstLaser = f; }
  }
  assert.ok(firstLaser >= 0 && firstLaser < 90, `drony zaczynają ciąć po ${firstLaser} klatkach (lot z doku)`);
  assert.ok(lasered > 60 * 5, `drony tną (${lasered} klatek)`);
  const cu = RESOURCES[ASTEROID_YIELD.copper] ? ASTEROID_YIELD.copper : null;
  assert.ok(cu);
  assert.ok((cargo[cu] || 0) >= 1, `ruda miedzi w ładowni: ${cargo[cu] || 0} t`);
  assert.ok(Number.isInteger(cargo[cu]), 'ładownia dostaje całe tony');
  assert.equal(rig.totals.ore[cu], cargo[cu]);
  assert.ok(rig.yield.ore[cu] < 1, 'ułamek czeka na pełną tonę');
  assert.ok(rig.totals.waste > 0, 'skała płonna odpada (nie do ładowni)');
});

test('pełna ładownia: urobek laserów przepada, komunikat; wiązka nie łapie rudy ponad miejsce', () => {
  const { rig, mining, cargo, ship } = makeRig({ hold: 2 });
  const messages = [];
  rig.onMessage = (t) => messages.push(t);
  rig.setEnabled(true);
  const rock = rig.field.rocks[0];
  rig.pointer(rock.x, rock.y, true);
  for (let f = 0; f < 60 * 40 && rig.totals.lostOre < 1; f++) frame(rig, ship);
  const held = Object.values(cargo).reduce((a, b) => a + b, 0);
  assert.equal(held, 2, 'ładownia pełna (2 t)');
  assert.ok(rig.totals.lostOre >= 1, 'nadmiar przepada');
  assert.ok(messages.some((m) => /Ładownia pełna/.test(m)));
  // Wiązka przy pełnej ładowni: maxOre = 0 — odłamy z rudą zostają (skała płonna nie).
  mining.pebbles.push({
    id: 999, sourceId: 0, parentId: 0, type: 1, typeId: 'copper', oreRes: ASTEROID_YIELD.copper, oreTypeId: 'copper',
    p: [ship.x + 100, -ship.y, -60], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0], r: 40, mass: 3, oreMass: 1.2,
    shape: 0, seed: 0.1, grace: 0, age: 0, alive: true, gravel: false, sleep: 0, asleep: false
  });
  rig.pointer(rock.x, rock.y, false);
  rig.toggleTractor();
  for (let f = 0; f < 30; f++) frame(rig, ship);
  assert.ok(mining.pebbles.some((p) => p.id === 999), 'okruch z rudą czeka przy statku');
});

test('ładunki: magazynek, seria detonacji — jedna ciężka operacja na klatkę, zdarzenia efektów', () => {
  const rocks = [fieldRock('ice', 320, 2500, 0, 201), fieldRock('silicon', 300, 2500, 1400, 202)];
  const { rig, mining, ship } = makeRig({ rocks, stock: createMiningChargeStock({ S: 0, M: 3, L: 0, XL: 0 }) });
  rig.setEnabled(true);
  rig.chargeIndex = MINING_CHARGES.findIndex((c) => c.id === 'M');
  // Bez ładunków S: odmowa.
  rig.chargeIndex = 0;
  assert.equal(rig.plantCharge(2500, 0), null, 'brak S w magazynku');
  rig.chargeIndex = 1;
  // Przejęcie skały przy osadzaniu to ciężka operacja: drugi ładunek w tej samej klatce czeka.
  rig.beginFrame();
  const a = rig.plantCharge(2500, 0);
  assert.ok(a && a.body, 'ładunek w skale lodu');
  const b = rig.plantCharge(2500, 1400);
  assert.equal(b, 'deferred', 'drugie przejęcie w następnej klatce');
  frame(rig, ship);
  assert.equal(rig.charges.length, 2, 'drugi ładunek osadzony w kolejnej klatce');
  assert.equal(rig.stock.M, 1, 'magazynek M: 3 − 2');
  assert.equal(mining.bodies.length, 2);
  const fx0 = rig.fxWrite;
  assert.equal(rig.detonate(), 2);
  frame(rig, ship);
  const first = drainFx(rig, fx0).filter((e) => e.kind === MINING_FX.BLAST || e.kind === MINING_FX.CONTAINED);
  assert.equal(first.length, 1, 'jeden wybuch w pierwszej klatce');
  frame(rig, ship);
  const both = drainFx(rig, fx0).filter((e) => e.kind === MINING_FX.BLAST || e.kind === MINING_FX.CONTAINED);
  assert.equal(both.length, 2, 'drugi w następnej');
  assert.ok(both.every((e) => e.energy > 0 && Number.isFinite(e.x + e.y + e.z)));
  assert.ok(both.some((e) => e.kind === MINING_FX.BLAST), 'M rozbija kruchą skałę');
  assert.ok(mining.bodies.length + mining.pebbles.length > 2, 'odłamy');
  assert.equal(rig.totals.blasts, 2);
});

test('wiązka zbiera odłamy do ładowni; ruda z rdzenia liczy się w tonach surowca', () => {
  const rocks = [fieldRock('titan', 260, 1600, 0, 301)];
  const { rig, mining, cargo, ship } = makeRig({ rocks, stock: createMiningChargeStock({ XL: 2 }) });
  rig.setEnabled(true);
  rig.chargeIndex = MINING_CHARGES.findIndex((c) => c.id === 'XL');
  rig.beginFrame();
  assert.ok(rig.plantCharge(1600, 0));
  rig.detonate();
  frame(rig, ship);
  const pieces = mining.bodies.length - 1 + mining.pebbles.length;
  assert.ok(pieces > 0, `wybuch XL rozbija tytan (${pieces})`);
  rig.toggleTractor();
  assert.equal(rig.tractorOn, true);
  let seen = 0;
  for (let f = 0; f < 60 * 20; f++) {
    frame(rig, ship);
    if (rig.tractorCount > 0) seen++;
  }
  assert.ok(seen > 0, 'cele wiązki do rysowania');
  assert.ok(rig.totals.collected > 0, `złapane ${rig.totals.collected}`);
  const ti = ASTEROID_YIELD.titan;
  assert.ok((cargo[ti] || 0) + rig.yield.ore[ti] > 0, 'ruda tytanu z odłamów');
});

test('piła: skała rozcięta na wylot rozpada się na dwie części, cięcie co sawInterval', () => {
  const rocks = [fieldRock('rock', 300, 1200, 0, 401)];
  const { rig, mining, ship } = makeRig({ rocks });
  rig.setEnabled(true);
  // Przejęcie skały (laser jedną klatkę) i start piły w poprzek.
  rig.pointer(1200, 0, true);
  frame(rig, ship);
  rig.pointer(1200, 0, false);
  assert.equal(mining.bodies.length, 1);
  let slices = 0;
  const orig = mining.slice.bind(mining);
  mining.slice = (...a) => { slices++; return orig(...a); };
  assert.ok(rig.startSaw(1200, -700, 1200, 700));
  let frames = 0;
  while (!rig.saw.done && frames < 60 * 30) { frame(rig, ship); frames++; }
  assert.ok(rig.saw.done, 'piła doszła do końca linii');
  assert.equal(mining.bodies.length, 2, 'dwie połówki');
  const simTime = frames / 60;
  assert.ok(slices <= Math.ceil(simTime / rig.cfg.sawInterval) + 2 * mining.bodies.length + 2, `cięć ${slices} w ${simTime.toFixed(1)} s`);
  // Połówki po obu stronach linii x = 1200.
  const [a, b] = mining.bodies;
  assert.ok(Math.sign(a.p[0] - 1200) !== Math.sign(b.p[0] - 1200));
});

test('daleko od statku: ciała i okruchy zwolnione, nietknięta skała wraca do pola', () => {
  const rocks = [fieldRock('iron', 280, 2000, 0, 501)];
  const { rig, mining, ship } = makeRig({ rocks });
  rig.setEnabled(true);
  rig.pointer(2000, 0, true);
  rig.beginFrame();
  rig.step(1 / 120, ship);
  rig.pointer(2000, 0, false);
  assert.equal(mining.bodies.length, 1);
  assert.ok(rig.taken.has(501));
  const far = { x: 200000, y: 0, angle: 0, len: 1800 };
  for (let f = 0; f < 90; f++) frame(rig, far);
  assert.equal(mining.bodies.length, 0, 'ciało zwolnione');
  assert.ok(!rig.taken.has(501), 'nietknięta skała wraca do warstwy pola');
});

test('determinizm: te same wejścia = ten sam urobek, te same odłamy i zdarzenia', () => {
  const run = () => {
    const rocks = [fieldRock('crystal', 300, 2200, 300, 601), fieldRock('copper', 340, 2600, -900, 602)];
    const { rig, mining, cargo, ship } = makeRig({ rocks, stock: createMiningChargeStock({ L: 2 }) });
    rig.setEnabled(true);
    rig.pointer(2200, 300, true);
    for (let f = 0; f < 240; f++) frame(rig, ship);
    rig.pointer(2600, -900, false);
    rig.chargeIndex = MINING_CHARGES.findIndex((c) => c.id === 'L');
    rig.beginFrame();
    rig.plantCharge(2200, 300);
    frame(rig, ship);
    rig.plantCharge(2600, -900);
    frame(rig, ship);
    rig.detonate();
    rig.toggleTractor();
    for (let f = 0; f < 300; f++) frame(rig, ship);
    return JSON.stringify({
      cargo, totals: rig.totals, bodies: mining.bodies.map((b) => [b.id, b.p.map((v) => v.toFixed(5))]),
      pebbles: mining.pebbles.length, fx: drainFx(rig, 0).map((e) => [e.kind, e.x.toFixed(4), e.energy.toFixed(5)])
    });
  };
  assert.equal(run(), run());
});

test('ładunki: tabela S–XL, ceny tymczasowe rosnące z energią, magazynek startowy', () => {
  assert.deepEqual(MINING_CHARGES.map((c) => c.id), ['S', 'M', 'L', 'XL']);
  for (let i = 1; i < MINING_CHARGES.length; i++) {
    assert.ok(MINING_CHARGES[i].energy > MINING_CHARGES[i - 1].energy);
    assert.ok(MINING_CHARGES[i].price > MINING_CHARGES[i - 1].price);
  }
  assert.equal(miningChargeById('XL').energy, 32);
  const s = createMiningChargeStock();
  assert.ok(s.S > 0 && s.XL > 0);
  // Worek urobku: pola wszystkich rud od razu (tryb szybki obiektu przy zapisie co krok).
  const y = createRigYield();
  for (const k of MINING_ORE_KEYS) assert.equal(y.ore[k], 0);
  assert.ok(MINING_ORE_KEYS.every((k) => RESOURCES[k]), 'klucze z resources.js');
  assert.ok(createYield().ore);
});
