import test from 'node:test';
import assert from 'node:assert/strict';
import { createColdWreckSystem, COLD_WRECK_CONFIG } from '../src/game/coldWrecks.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

// Budzenie śpiących wraków (wake sweep, index.html: wakeSleepingWrecksNearBodies).
// Look-ahead ma objąć drogę ciała do następnej budowy listy destruktora (raz na
// klatkę renderu), a nie trzy SEKUNDY lotu jak dawne `speed * 3` — przy tym
// przelot obok pola budził wraki w promieniu kilkunastu km i zerował im sen,
// więc nigdy nie zamarzały (src/game/coldWrecks.js).

const html = readIndexHtml();

// Stałe z index.html — test sprawdza wartości gry, nie własne kopie.
function indexConst(name) {
  const m = html.match(new RegExp(`const ${name} = ([^;\\n]+);`));
  assert.ok(m, `brak stałej ${name} w index.html`);
  return Function(`return (${m[1]});`)();
}

const LOOKAHEAD_SEC = indexConst('WRECK_WAKE_LOOKAHEAD_SEC');
const LOOKAHEAD_MAX = indexConst('WRECK_WAKE_LOOKAHEAD_MAX');
const WAKE_HEADER = 'function wakeSleepingWrecksNearBodies(';
const wake = loadIndexFunction(html, WAKE_HEADER, 'wakeSleepingWrecksNearBodies', {
  WRECK_WAKE_LOOKAHEAD_SEC: LOOKAHEAD_SEC,
  WRECK_WAKE_LOOKAHEAD_MAX: LOOKAHEAD_MAX
});
// Ta sama funkcja z dawnym horyzontem: 3 s lotu bez sufitu.
const wakeLegacy = loadIndexFunction(html, WAKE_HEADER, 'wakeSleepingWrecksNearBodies', {
  WRECK_WAKE_LOOKAHEAD_SEC: 3,
  WRECK_WAKE_LOOKAHEAD_MAX: Infinity
});

// Wrak tuż po uśpieniu w pętli wraków physicsStep.
function sleepingWreck(x, y, r = 300) {
  return {
    isWreck: true,
    x,
    y,
    radius: r,
    _bpRadius: r,
    _wreckSleeping: true,
    _wreckSleepTimer: 1.4,
    _wreckSleptSec: 0,
    hexGrid: { hexTemplate: {}, isSleeping: true, sleepFrames: 9999, wakeHoldFrames: 0 }
  };
}

// Ciało z listy destruktora (gracz, NPC) — pos/vel jak u statków.
function body(x, y, vx, vy, r = 400) {
  return { pos: { x, y }, vel: { x: vx, y: vy }, radius: r, _bpRadius: r };
}

test('horyzont budzenia: droga do następnej listy destruktora, nie sekundy lotu', () => {
  // Lista powstaje raz na klatkę renderu: po budowie ciało leci jeszcze najwyżej
  // 0,033 s (sufit klatki w loop()), a destruktor sięga po parę prędkość × 1/60 s dalej.
  assert.match(html, /const frame = Math\.min\(0\.033, \(now - lastTime\) \/ 1000\);/, 'sufit klatki, na którym stoi horyzont');
  assert.ok(LOOKAHEAD_SEC >= 0.033 + 1 / 60, `horyzont ${LOOKAHEAD_SEC} s nie obejmuje klatki + wydłużenia destruktora`);
  assert.ok(LOOKAHEAD_SEC <= 0.1, `horyzont ${LOOKAHEAD_SEC} s — to już sekundy lotu`);
  // Najszybszy ruch w grze: warp 80 tys. j./s × mnożnik strefy 2 (także tuż po wyjściu).
  assert.ok(LOOKAHEAD_MAX >= 160000 * LOOKAHEAD_SEC, 'sufit nie przycina żadnej prędkości gry');
  assert.ok(Number.isFinite(LOOKAHEAD_MAX), 'sufit istnieje');
});

test('szybki przelot obok pola i kurs na wrak z sekundy lotu nie budzą (dawniej promień 3 s lotu)', () => {
  const field = [sleepingWreck(0, 0), sleepingWreck(600, 0), sleepingWreck(1200, 0)];
  const ahead = sleepingWreck(0, -20000);
  const sleeping = [...field, ahead];
  const flyby = body(-2000, 1500, 6000, 0); // 6 tys. j./s, 1,5 km obok pola
  const charge = body(0, -20000 - 700 - 6000, 0, 6000); // prosto w wrak, styk za 1 s
  const list = [flyby, charge];
  wake(sleeping, list);
  assert.equal(sleeping.length, 4);
  assert.equal(list.length, 2);
  for (const w of [...field, ahead]) {
    assert.equal(w._wreckSleeping, true);
    assert.equal(w._wreckSleepTimer, 1.4, 'licznik snu nietknięty');
    assert.equal(w.hexGrid.isSleeping, true);
  }

  // Dawny wzór (300 + 400 + 6000 × 3 = 18,7 km) budził wszystkie.
  const legacyList = [flyby, charge];
  wakeLegacy(sleeping, legacyList);
  assert.equal(sleeping.length, 0);
  assert.equal(legacyList.length, 6);
});

test('gracz w warpie nie budzi niczego, także na kursie kolizyjnym; po wyjściu — budzi', () => {
  const w = sleepingWreck(0, 0);
  const player = body(-800, 0, 160000, 0);
  const sleeping = [w];
  const list = [player];
  wake(sleeping, list, player);
  assert.equal(w._wreckSleeping, true);
  assert.equal(sleeping.length, 1);
  assert.equal(list.length, 1);

  // Po wyjściu z warpa statek dalej leci szybko — wtedy jest zwykłym ciałem.
  wake(sleeping, list, null);
  assert.equal(w._wreckSleeping, false);
  assert.equal(w._wreckSleepTimer, 0);
  assert.equal(w.hexGrid.isSleeping, false);
  assert.equal(w.hexGrid.sleepFrames, 0);
  assert.equal(w.hexGrid.wakeHoldFrames, 20);
  assert.equal(sleeping.length, 0);
  assert.ok(list[1] === w, 'obudzony na końcu listy destruktora');
});

test('ciało bez kolizji (przylot NPC z warpa), wolniejsze niż 15 j./s i martwe nie budzą', () => {
  const w = sleepingWreck(0, 0);
  const warpingIn = body(-750, 0, 4000, 0);
  warpingIn.isCollidable = false;
  const drifting = body(0, 650, 0, -14);
  const dead = body(0, -650, 0, 500);
  dead.dead = true;
  const sleeping = [w];
  wake(sleeping, [warpingIn, drifting, dead]);
  assert.equal(w._wreckSleeping, true);
  assert.equal(sleeping.length, 1);

  // Ten sam przylot, gdy już może się zderzyć (isCollidable = true po hamowaniu).
  warpingIn.isCollidable = true;
  wake(sleeping, [warpingIn]);
  assert.equal(w._wreckSleeping, false);
});

test('sufit look-ahead: nawet nieskończona prędkość budzi tylko pas przy kursie', () => {
  const swR = 300;
  const aR = 400;
  for (const speed of [1e6, Infinity]) {
    const inside = sleepingWreck(swR + aR + LOOKAHEAD_MAX - 1, 0, swR);
    const outside = sleepingWreck(-(swR + aR + LOOKAHEAD_MAX + 1), 0, swR);
    const far = sleepingWreck(0, 50000, swR);
    const sleeping = [inside, outside, far];
    wake(sleeping, [body(0, 0, speed, 0, aR)]);
    assert.equal(inside._wreckSleeping, false, `${speed}: w zasięgu sufitu`);
    assert.equal(outside._wreckSleeping, true, `${speed}: za sufitem`);
    assert.equal(far._wreckSleeping, true, `${speed}: 50 km dalej`);
  }
});

// Pętla gry w miniaturze: loop() przycina klatkę do 0,033 s i robi kroki PHYS_DT;
// physicsStep w PIERWSZYM kroku klatki, po integracji ruchu, buduje listę
// destruktora (ciała + nieśpiące wraki) i woła wake sweep. Destruktor
// (resolveCollisions) bierze parę pod uwagę od odległości ar + br + min(v/60, 2·ar)
// — w każdym takim kroku wrak musi już być na liście. `phase` przesuwa start
// o ułamek drogi z klatki: najgorzej jest, gdy lista powstaje tuż za progiem.
function ramSleepingWreck({ speed, physHz, frameSec, phase, aR = 400, swR = 300 }) {
  const PHYS_DT = 1 / physHz;
  const wreck = sleepingWreck(0, 0, swR);
  const contact = swR + aR;
  const startGap = Math.max(speed * 0.25, 200) + phase * speed * Math.min(0.033, frameSec);
  const rammer = body(-(contact + startGap), 0, speed, 0, aR);
  const reach = contact + Math.min(speed / 60, 2 * aR);
  let list = [];
  let acc = 0;
  let wokeAtGap = null;
  let missed = 0;
  while (-rammer.pos.x > contact - 1) {
    acc += Math.min(0.033, frameSec);
    let steps = 0;
    while (acc >= PHYS_DT && steps < 10) {
      rammer.pos.x += rammer.vel.x * PHYS_DT;
      if (steps === 0) {
        list = wreck._wreckSleeping ? [rammer] : [rammer, wreck];
        wake(wreck._wreckSleeping ? [wreck] : [], list);
        if (wokeAtGap === null && !wreck._wreckSleeping) wokeAtGap = -rammer.pos.x - contact;
      }
      if (-rammer.pos.x < reach && !list.includes(wreck)) missed++;
      acc -= PHYS_DT;
      steps++;
    }
  }
  return { wokeAtGap, missed };
}

test('taran: śpiący wrak budzi się, zanim destruktor weźmie parę — każde ?physHz, fps i prędkość', () => {
  // Od wolnego spychania po wytracanie prędkości tuż po warpie (160 tys. j./s).
  const speeds = [16, 120, 1000, 3000, 10000, 20000, 50000, 80000, 160000];
  for (const physHz of [60, 90, 120, 240]) {
    for (const frameSec of [1 / 240, 1 / 144, 1 / 60, 1 / 30, 1 / 20]) {
      for (const speed of speeds) {
        for (let phase = 0; phase < 1; phase += 0.1) {
          const label = `${physHz} Hz, klatka ${(frameSec * 1000).toFixed(1)} ms, ${speed} j./s, faza ${phase.toFixed(1)}`;
          const { wokeAtGap, missed } = ramSleepingWreck({ speed, physHz, frameSec, phase });
          assert.equal(missed, 0, `${label}: destruktor widział parę bez wraku na liście`);
          assert.ok(wokeAtGap !== null, `${label}: wrak się nie obudził`);
          // Tuż przed stykiem, nie trzy sekundy lotu wcześniej.
          assert.ok(wokeAtGap <= speed * LOOKAHEAD_SEC, `${label}: obudzony ${wokeAtGap.toFixed(1)} j. przed stykiem`);
        }
      }
    }
  }
});

// Przelot obok pola: pętla wraków liczy sen w sekundach czasu gry
// (`_wreckSleptSec`, pilnuje tego coldWrecks.test.mjs), wake sweep raz na klatkę.
function flyPastField(wakeFn, onClosest) {
  const field = [];
  for (let i = 0; i < 6; i++) field.push(sleepingWreck(i * 600, 0));
  // Śpią od 19 s — do zamrożenia (afterSec) brakuje sekundy.
  for (const w of field) w._wreckSleptSec = COLD_WRECK_CONFIG.afterSec - 1;
  // 6 tys. j./s równolegle do pola, 3,5 km obok: poza clearRadius + promienie.
  const player = body(-12000, 3500, 6000, 0);
  let list = [player];
  const system = createColdWreckSystem({
    wrecks: field,
    coldWrecks: [],
    getAwakeBodies: () => list,
    getSimTimeMs: () => 1e9
  });
  const PHYS_DT = 1 / 120;
  // 60 fps, dwa kroki na klatkę; najbliżej pola po ~2,25 s.
  for (let frame = 0; frame < 240; frame++) {
    for (let s = 0; s < 2; s++) {
      player.pos.x += player.vel.x * PHYS_DT;
      if (s === 0) {
        list = [player, ...field.filter((w) => !w._wreckSleeping)];
        wakeFn(field.filter((w) => w._wreckSleeping), list);
      }
      for (const w of field) w._wreckSleptSec = w._wreckSleeping ? w._wreckSleptSec + PHYS_DT : 0;
    }
    if (frame === 134) onClosest(field, system, player);
  }
  return { field, system };
}

test('zimne wraki: pole mijane w szybkim przelocie śpi dalej i może zamarznąć przy przelatującym graczu', () => {
  let checkedClosest = false;
  const { field, system } = flyPastField(wake, (closeField, closeSystem, player) => {
    assert.ok(Math.abs(player.pos.x - 1500) < 1, 'środek pola');
    for (const w of closeField) {
      assert.equal(w._wreckSleeping, true, 'przelot nie budzi');
      assert.equal(closeSystem.isFreezeCandidate(w), true, 'gracz 3,5 km obok nie blokuje zamrożenia');
    }
    checkedClosest = true;
  });
  assert.ok(checkedClosest);
  for (const w of field) {
    assert.equal(w._wreckSleeping, true);
    assert.ok(w._wreckSleptSec >= COLD_WRECK_CONFIG.afterSec);
    assert.equal(system.isFreezeCandidate(w), true);
  }

  // Dawny horyzont budził całe pole już w pierwszej klatce i zerował sen.
  const legacy = flyPastField(wakeLegacy, () => {});
  for (const w of legacy.field) {
    assert.equal(w._wreckSleptSec, 0);
    assert.equal(legacy.system.isFreezeCandidate(w), false);
  }
});

test('physicsStep: wake sweep przy budowie listy, gracz w warpie wyłączony', () => {
  const physics = sliceFunction(html, 'function physicsStep(');
  const call = physics.indexOf("wakeSleepingWrecksNearBodies(_sleepingWrecksBuffer, dynamicDestructibles, warp.state === 'active' ? ship : null);");
  assert.ok(call > 0, 'wywołanie z graczem w warpie jako ignoreBody');
  const build = physics.indexOf('dynamicDestructibles = buildDynamicDestructibles(');
  const cache = physics.indexOf('_cachedDynamicDestructibles = dynamicDestructibles;');
  assert.ok(build > 0 && build < call && call < cache, 'po budowie listy, przed zapisem cache klatki');
  assert.doesNotMatch(physics, /for \(let si = _sleepingWrecksBuffer/, 'pętla budzenia tylko w funkcji');
});
