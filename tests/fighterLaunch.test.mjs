import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIGHTER_LAUNCH,
  orderHangarTubes,
  chevronFormationOffset,
  computeLaunchVector,
  buildLaunchPlan
} from '../src/game/fighterLaunch.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { getFighterSquadronDef } from '../src/data/fighterSquadrons.js';
import { getHullRenderSize } from '../src/data/ships.js';

// Atlas: sprite 3747x1677 renderowany do 1800x806 → skala hardpointów.
const ATLAS_SRC = { w: 3747, h: 1677 };
const atlasSize = getHullRenderSize('atlas', ATLAS_SRC.w, ATLAS_SRC.h);
const HP_SCALE_X = atlasSize.w / ATLAS_SRC.w;
const HP_SCALE_Y = atlasSize.h / ATLAS_SRC.h;
const ATLAS_HALF_BEAM = atlasSize.h * 0.5;

function atlasHangarTubes() {
  const raw = ATLAS_EDITOR_DEFAULTS.hardpoints.filter(hp => hp.type === 'hangar');
  return orderHangarTubes(raw.map(hp => ({
    hp,
    local: { x: hp.x * HP_SCALE_X, y: hp.y * HP_SCALE_Y },
    squadrons: [getFighterSquadronDef('multirole')]
  })));
}

test('the Atlas exposes six hangar bays, three per side', () => {
  const tubes = atlasHangarTubes();
  assert.equal(tubes.length, 6);

  const port = tubes.filter(t => t.side === -1);
  const starboard = tubes.filter(t => t.side === 1);
  assert.equal(port.length, 3, 'trzy hangary na lewej burcie');
  assert.equal(starboard.length, 3, 'trzy hangary na prawej burcie');

  // sideRank numeruje niezależnie w obrębie burty, od dziobu do rufy.
  assert.deepEqual(port.map(t => t.sideRank), [0, 1, 2]);
  assert.deepEqual(starboard.map(t => t.sideRank), [0, 1, 2]);

  // Kolejność globalna: od dziobu do rufy.
  for (let i = 1; i < tubes.length; i++) {
    assert.ok(tubes[i - 1].local.x >= tubes[i].local.x, 'wyrzutnie posortowane dziób → rufa');
  }
});

test('fighters are ejected sideways out of the hull, not along the keel', () => {
  const tubes = atlasHangarTubes();
  // Kadłub skierowany w +x, w bezruchu.
  const carrier = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };

  for (const tube of tubes) {
    const launch = computeLaunchVector(carrier, tube, ATLAS_HALF_BEAM);

    // Punkt startu leży na tej samej burcie co hangar i DALEJ od osi kadłuba.
    assert.equal(Math.sign(launch.y), tube.side, 'start po właściwej burcie');
    assert.ok(Math.abs(launch.y) > Math.abs(tube.local.y), 'punkt startu wysunięty na zewnątrz');

    // Impuls katapulty jest głównie boczny — to była pierwotna usterka:
    // stary kod używał wektora PRZODU (cos/sin kąta) mimo komentarza "w bok".
    assert.equal(Math.sign(launch.vy), tube.side, 'wyrzut w stronę własnej burty');
    assert.ok(Math.abs(launch.vy) > Math.abs(launch.vx), 'składowa boczna dominuje nad przednią');
    assert.ok(launch.vx > 0, 'z lekką składową do przodu');
  }

  // Dwie przeciwne burty wyrzucają w przeciwne strony.
  const port = tubes.find(t => t.side === -1);
  const starboard = tubes.find(t => t.side === 1);
  const a = computeLaunchVector(carrier, port, ATLAS_HALF_BEAM);
  const b = computeLaunchVector(carrier, starboard, ATLAS_HALF_BEAM);
  assert.ok(a.vy * b.vy < 0, 'burty wyrzucają w przeciwne strony');
});

test('launch vector rotates with the hull and inherits carrier momentum', () => {
  const tubes = atlasHangarTubes();
  const tube = tubes.find(t => t.side === 1);

  // Kadłub obrócony o 90° (dziób w +y) → prawa burta wskazuje w -x.
  const carrier = { x: 1000, y: -500, vx: 240, vy: -80, angle: Math.PI / 2 };
  const launch = computeLaunchVector(carrier, tube, ATLAS_HALF_BEAM);

  assert.ok(Math.abs(launch.nx + 1) < 1e-9, 'normalna prawej burty obraca się w -x');
  assert.ok(Math.abs(launch.ny) < 1e-9);

  // Pęd nosiciela musi wejść do prędkości myśliwca, inaczej lecący statek
  // zostawiałby świeżo wypuszczoną eskadrę za sobą.
  assert.ok(launch.vx < carrier.vx, 'wyrzut w -x na tle pędu +x');
  assert.ok(Math.abs((launch.vy - carrier.vy) - FIGHTER_LAUNCH.SPEED * FIGHTER_LAUNCH.FORWARD) < 1e-6,
    'składowa do przodu liczona względem pędu nosiciela');
});

test('chevron slots stay outboard of the hull and trail behind the tip', () => {
  const squadSize = getFighterSquadronDef('multirole').squadSize;

  for (const side of [1, -1]) {
    let prevRowX = Infinity;
    for (let slot = 0; slot < squadSize; slot++) {
      const off = chevronFormationOffset(0, side, slot, squadSize, ATLAS_HALF_BEAM);

      // Cały klin poza obrysem kadłuba.
      assert.equal(Math.sign(off.y), side, `slot ${slot} po właściwej burcie`);
      assert.ok(Math.abs(off.y) > ATLAS_HALF_BEAM,
        `slot ${slot} nie może siedzieć w kadłubie (|y|=${Math.abs(off.y).toFixed(0)}, półszerokość ${ATLAS_HALF_BEAM})`);

      // Kolejne rzędy schodzą do tyłu.
      assert.ok(off.x <= prevRowX + 1e-9, `slot ${slot} nie wyprzedza poprzedniego rzędu`);
      prevRowX = off.x;
    }
  }

  // Dziób klina jest z przodu i na linii burty.
  const tip = chevronFormationOffset(0, 1, 0, squadSize, ATLAS_HALF_BEAM);
  assert.ok(tip.x === 0, 'dziób pierwszego klina na trawersie hangaru');
  assert.equal(tip.y, ATLAS_HALF_BEAM + FIGHTER_LAUNCH.CHEVRON_STANDOFF);

  // Para skrzydłowych leży w tym samym rzędzie, po obu stronach linii klina.
  // Krok do wewnątrz jest ściśnięty (żeby ramię nie weszło w kadłub), więc klin
  // jest celowo lekko asymetryczny.
  const left = chevronFormationOffset(0, 1, 1, squadSize, ATLAS_HALF_BEAM);
  const right = chevronFormationOffset(0, 1, 2, squadSize, ATLAS_HALF_BEAM);
  assert.equal(left.x, right.x, 'para w tym samym rzędzie');
  assert.ok(left.y < tip.y && right.y > tip.y, 'skrzydłowi po obu stronach dzioba klina');

  // Najgłębszy rząd wciąż mieści się poza burtą — to jest właściwość, którą
  // ściskanie kroku ma gwarantować dla DOWOLNEJ liczebności eskadry.
  for (const size of [5, 9, 15, 24]) {
    for (let slot = 0; slot < size; slot++) {
      for (const s of [1, -1]) {
        const off = chevronFormationOffset(0, s, slot, size, ATLAS_HALF_BEAM);
        assert.ok(Math.abs(off.y) > ATLAS_HALF_BEAM, `eskadra ${size}, slot ${slot} poza kadłubem`);
      }
    }
  }
});

test('each hangar on a side gets its own chevron, stacked astern', () => {
  const squadSize = getFighterSquadronDef('multirole').squadSize;
  const first = chevronFormationOffset(0, 1, 0, squadSize, ATLAS_HALF_BEAM);
  const second = chevronFormationOffset(1, 1, 0, squadSize, ATLAS_HALF_BEAM);
  const third = chevronFormationOffset(2, 1, 0, squadSize, ATLAS_HALF_BEAM);

  assert.ok(second.x < first.x, 'drugi klin stoi za pierwszym');
  assert.ok(third.x < second.x, 'trzeci za drugim');

  // Odstęp musi przekraczać długość klina, inaczej eskadry wchodzą na siebie.
  const rows = Math.ceil((squadSize - 1) / 2);
  const chevronLen = rows * FIGHTER_LAUNCH.CHEVRON_ROW_GAP;
  assert.ok(first.x - second.x > chevronLen, 'kliny się nie nakładają');

  // Kliny tej samej burty dzielą tę samą linię boczną (nie oddalają się w bok).
  assert.equal(first.y, second.y);
});

test('launch plan runs every tube in parallel, one fighter at a time', () => {
  const tubes = atlasHangarTubes();
  const plan = buildLaunchPlan(tubes, tube => tube.squadrons);
  const squadSize = getFighterSquadronDef('multirole').squadSize;

  assert.equal(plan.length, tubes.length * squadSize, 'każdy hangar wypuszcza pełną eskadrę');

  // W obrębie jednej wyrzutni starty są ROZŁOŻONE W CZASIE (efekt katapulty),
  // ale różne wyrzutnie startują niemal równocześnie — tyle strumieni, ile hangarów.
  for (let ti = 0; ti < tubes.length; ti++) {
    const forTube = plan.filter(p => p.tubeIndex === ti);
    assert.equal(forTube.length, squadSize);
    for (let i = 1; i < forTube.length; i++) {
      const gap = forTube[i].delay - forTube[i - 1].delay;
      assert.ok(Math.abs(gap - FIGHTER_LAUNCH.INTERVAL) < 1e-9,
        `odstęp startów z wyrzutni ${ti} musi być stały`);
    }
    assert.deepEqual(forTube.map(p => p.slotInTube), forTube.map((_, i) => i));
  }

  // Pierwsza salwa (po jednym z każdej wyrzutni) mieści się poniżej jednego
  // interwału — inaczej nie byłoby "tyle strumieni ile hangarów".
  const firstWave = plan.filter(p => p.slotInTube === 0);
  assert.equal(firstWave.length, tubes.length);
  assert.ok(Math.max(...firstWave.map(p => p.delay)) < FIGHTER_LAUNCH.INTERVAL);

  // Cała salwa nie może się zlać w jedną klatkę.
  assert.ok(Math.max(...plan.map(p => p.delay)) > 1.5, 'start rozciągnięty w czasie');
});
