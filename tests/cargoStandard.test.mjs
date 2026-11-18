// Standard ładunku (propozycja): drabina kontener → moduł → sekcja, nośniki, sprzęg, gniazdo. Test pilnuje, że liczby
// standardu zgadzają się z tym, co już jest w grze i demach (kontener, moduł naczepy, chwyty dronów, klasy ruchu v2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CARGO_TONNES_PER_CONTAINER, CARGO_LEVELS, CARGO_LEVEL_IDS, CARGO_TRAILER, CARGO_SECTION, CARGO_COUPLER, CARGO_SOCKET,
  CARGO_CARRIERS, CARGO_CARRIER_IDS, CARGO_FLAT_GOODS, CARGO_TOOL_SECTIONS, CARGO_SECTION_TRACTOR,
  cargoCarrierFor, cargoIsHazmat, cargoMaxPiece, cargoSectionRigLength, cargoRigTonnes, cargoBreakdown,
  cargoContainersFor, cargoSectionsInArea, cargoHullFitsSocket
} from '../src/data/cargoStandard.js';
import { CARGO_CONTAINER, CARGO_BAY_HULLS, cargoModuleSize } from '../src/data/cargoBays.js';
import { CONTAINER_FAMILY } from '../src/data/cargoContainers.js';
import { RESOURCE_KEYS } from '../src/data/resources.js';
import { TRUCK_MODULE, TRUCK_TRAILER, TRUCK_TRAILER_TONNES, TRUCK_TRACTORS, truckRigTonnes } from '../src/data/spaceTrucks.js';
import { SWARM_DRONE_CLASSES } from '../src/data/swarmDrones.js';
import { VAN_CLASSES } from '../src/game/traffic/shipmentOrders.js';
import { DIRECTOR_DEFAULTS } from '../src/game/traffic/trafficDirector.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('kontener standardu = kontener gry, 7,5 t', () => {
  const c = CARGO_LEVELS.container;
  assert.equal(c.L, CARGO_CONTAINER.L);
  assert.equal(c.W, CARGO_CONTAINER.W);
  assert.equal(c.H, CARGO_CONTAINER.H);
  assert.equal(c.containers, 1);
  assert.equal(c.tonnes, CARGO_TONNES_PER_CONTAINER);
  assert.equal(CARGO_TONNES_PER_CONTAINER, 7.5);
});

test('moduł = ładunek naczepy ciągnika (wymiary i tony z dema ciągników)', () => {
  const m = CARGO_LEVELS.module;
  assert.equal(m.L, TRUCK_MODULE.L);
  assert.equal(m.W, TRUCK_MODULE.W);
  assert.equal(m.containers, TRUCK_MODULE.containers);
  assert.equal(m.tonnes, TRUCK_TRAILER_TONNES);
  // naczepa: bryła i rozstaw przegubów jak w spaceTrucks.js
  assert.equal(CARGO_TRAILER.body.L, TRUCK_TRAILER.body[1] - TRUCK_TRAILER.body[0]);
  assert.equal(CARGO_TRAILER.body.W, TRUCK_TRAILER.body[2] * 2);
  assert.equal(CARGO_TRAILER.pitch, TRUCK_TRAILER.kingpinX - TRUCK_TRAILER.rearHitchX);
  assert.equal(CARGO_TRAILER.tonnes, TRUCK_TRAILER_TONNES);
  // moduł mieści się na bryle naczepy
  assert.ok(m.L <= CARGO_TRAILER.body.L && m.W <= CARGO_TRAILER.body.W);
});

test('drabina: każdy stopień to 2 × 2 poprzedniego i 4 × ton', () => {
  assert.deepEqual([...CARGO_LEVEL_IDS], ['container', 'module', 'section']);
  for (const id of CARGO_LEVEL_IDS) {
    const lv = CARGO_LEVELS[id];
    assert.equal(lv.tonnes, lv.containers * CARGO_TONNES_PER_CONTAINER, id);
    const ref = cargoModuleSize({ nx: lv.nx, ny: lv.ny, nz: 1 }, {});
    assert.equal(lv.L, ref.L, id);
    assert.equal(lv.W, ref.W, id);
    if (!lv.of) continue;
    const low = CARGO_LEVELS[lv.of];
    assert.equal(lv.nx, low.nx * 2, id);
    assert.equal(lv.ny, low.ny * 2, id);
    assert.equal(lv.tonnes, low.tonnes * 4, id);
  }
  assert.equal(CARGO_LEVELS.section.tonnes, 120);
  assert.equal(CARGO_LEVELS.section.containers, 16);
});

test('stopnie = chwyty dronów roju (S, L, dwa chwyty Capital na sekcję)', () => {
  for (const id of CARGO_LEVEL_IDS) {
    const lv = CARGO_LEVELS[id];
    const pack = SWARM_DRONE_CLASSES[lv.grip].pack;
    assert.equal(pack.nx * pack.ny * lv.grips, lv.containers, `${id}: chwyty × kontenery w chwycie`);
    assert.equal(lv.nx % pack.nx, 0, `${id}: chwyt dzieli obrys wzdłuż`);
    assert.equal(lv.ny % pack.ny, 0, `${id}: chwyt dzieli obrys w poprzek`);
  }
  // obrys sekcji istnieje już w grze: moduł 4 × 4 wagonu megafrachtowca
  const wagon = CARGO_BAY_HULLS.megafreighter_wagon.bays[0].module;
  assert.equal(wagon.nx, CARGO_LEVELS.section.nx);
  assert.equal(wagon.ny, CARGO_LEVELS.section.ny);
});

test('sekcja w ramie: obrys, sprzęg, gniazdo', () => {
  const S = CARGO_SECTION;
  assert.ok(near(S.load.L + 2 * S.frame, S.outer.L), 'rama wzdłuż');
  assert.ok(near(S.load.W + 2 * S.frame, S.outer.W), 'rama w poprzek');
  assert.equal(S.modules * CARGO_LEVELS.module.tonnes, S.tonnes);
  assert.equal(S.containers * CARGO_TONNES_PER_CONTAINER, S.tonnes);
  assert.equal(CARGO_COUPLER.rigidPitch, S.outer.L + 2 * CARGO_COUPLER.reach);
  assert.ok(CARGO_COUPLER.towPitch > CARGO_COUPLER.rigidPitch, 'dyszel dłuższy niż sprzęg sztywny');
  // przy ograniczniku przegubu narożniki sąsiednich sekcji się nie stykają (dyszel na osi, przegub w połowie odstępu)
  const gap = CARGO_COUPLER.towPitch - S.outer.L;
  assert.ok((S.outer.W / 2) * Math.tan(CARGO_COUPLER.maxBend / 2) < gap / 2, 'zgięcie zestawu sekcyjnego bez kolizji naroży');
  assert.equal(CARGO_SOCKET.L, S.outer.L + 2 * CARGO_SOCKET.clear);
  assert.equal(CARGO_SOCKET.W, S.outer.W + 2 * CARGO_SOCKET.clear);
  assert.equal(CARGO_SOCKET.minBeam, CARGO_SOCKET.W + 2 * CARGO_SOCKET.wall);
  assert.ok(CARGO_SOCKET.depth >= S.H);
  // sprzęg sztywny mieści się w gnieździe na długość (sekcja z uszami wchodzi w otwór)
  assert.ok(CARGO_COUPLER.rigidPitch <= CARGO_SOCKET.L);
  // sekcja narzędziowa pasuje do tego samego gniazda i sprzęgu
  for (const tool of Object.values(CARGO_TOOL_SECTIONS)) {
    assert.equal(tool.outer.L, S.outer.L, tool.id);
    assert.equal(tool.outer.W, S.outer.W, tool.id);
    assert.equal(tool.tonnes, 0, tool.id);
    assert.ok(CARGO_CARRIERS[tool.feeds], `${tool.id}: podaje do istniejącej odmiany nośnika`);
    assert.ok(tool.rate > 0);
  }
});

test('odmiany nośnika: trzy rodziny gry + nowa platforma; każdy towar ma nośnik', () => {
  assert.deepEqual([...CARGO_CARRIER_IDS], ['box', 'tank', 'hopper', 'flat']);
  const families = new Set(Object.values(CONTAINER_FAMILY));
  for (const c of Object.values(CARGO_CARRIERS)) {
    if (c.existing) assert.ok(families.has(c.family), `${c.id}: rodzina kontenera gry`);
    else assert.equal(c.family, null, `${c.id}: nowa rodzina`);
  }
  assert.deepEqual(Object.values(CARGO_CARRIERS).filter((c) => !c.existing).map((c) => c.id), ['flat']);
  for (const id of CARGO_FLAT_GOODS) assert.ok(RESOURCE_KEYS.includes(id), `towar platformy ${id} istnieje`);
  for (const id of RESOURCE_KEYS) {
    const carrier = cargoCarrierFor(id);
    if (id === 'workforce') { assert.equal(carrier, null, 'ludzie lecą promem'); continue; }
    assert.ok(CARGO_CARRIERS[carrier], `${id} → ${carrier}`);
  }
  // styk z hutą: materiał na platformie, ruda i złom w zasobniku, tlen w zbiorniku
  assert.equal(cargoCarrierFor('steel'), 'flat');
  assert.equal(cargoCarrierFor('copper_wire'), 'flat');
  assert.equal(cargoCarrierFor('hull_plate'), 'flat');
  assert.equal(cargoCarrierFor('iron_ore'), 'hopper');
  assert.equal(cargoCarrierFor('scrap'), 'hopper');
  assert.equal(cargoCarrierFor('oxygen'), 'tank');
  assert.equal(cargoCarrierFor('chips'), 'box');
  assert.equal(cargoCarrierFor('nieznany'), 'box');
  assert.equal(cargoIsHazmat('fuel_rods'), true);
  assert.equal(cargoIsHazmat('missile_round'), true);
  assert.equal(cargoIsHazmat('steel'), false);
  // największa sztuka na platformie rośnie ze stopniem
  assert.deepEqual(cargoMaxPiece('container'), { L: 15, W: 7 });
  assert.deepEqual(cargoMaxPiece('module'), { L: 31, W: 15 });
  assert.deepEqual(cargoMaxPiece('section'), { L: 63, W: 31 });
});

test('zgodność z ruchem v2: klasy ładowni, wyprawa górnicza, zestawy ciągników', () => {
  const cap = Object.fromEntries(VAN_CLASSES.map((c) => [c.id, c.capacity]));
  assert.deepEqual(cargoBreakdown(cap.van), { sections: 0, modules: 2, containers: 0, rest: 0 }, 'van = 2 moduły');
  assert.deepEqual(cargoBreakdown(cap.heavy), { sections: 7, modules: 2, containers: 0, rest: 0 }, 'heavy = 7 sekcji + 2 moduły');
  assert.deepEqual(cargoBreakdown(cap.mega), { sections: 20, modules: 0, containers: 0, rest: 0 }, 'mega = 20 sekcji');
  // dwie klasy zostawiają resztę mniejszą niż kontener — nazwane w propozycji, bez zmiany ruchu v2
  assert.deepEqual(cargoBreakdown(cap.hauler), { sections: 1, modules: 1, containers: 1, rest: 2.5 });
  assert.deepEqual(cargoBreakdown(cap.bulk), { sections: 3, modules: 0, containers: 2, rest: 5 });
  // jedna wyprawa górnicza = jedna sekcja; statek z dema rudy huty (360 t) = 3 sekcje
  assert.deepEqual(cargoBreakdown(DIRECTOR_DEFAULTS.miningYieldUnits), { sections: 1, modules: 0, containers: 0, rest: 0 });
  assert.deepEqual(cargoBreakdown(360), { sections: 3, modules: 0, containers: 0, rest: 0 });
  // zestawy ciągników: lekki z 2 naczepami = van, szosowy z 4 = sekcja, ciężki z 5 = 150 t
  assert.equal(cargoRigTonnes({ trailers: TRUCK_TRACTORS.light.trailersMax }), cap.van);
  assert.equal(cargoRigTonnes({ trailers: TRUCK_TRACTORS.standard.trailersMax }), CARGO_LEVELS.section.tonnes);
  assert.equal(cargoRigTonnes({ trailers: TRUCK_TRACTORS.heavy.trailersMax }), 150);
  for (let n = 0; n <= 5; n++) assert.equal(cargoRigTonnes({ trailers: n }), truckRigTonnes(n));
  // ciągnik sekcyjny z kompletem sekcji wiezie ładunek frachtowca `bulk` (z dokładnością do reszty)
  const full = cargoRigTonnes({ sections: CARGO_SECTION_TRACTOR.sectionsMax });
  assert.equal(full, 360);
  assert.ok(Math.abs(full - cap.bulk) <= CARGO_LEVELS.module.tonnes);
  assert.equal(cargoSectionRigLength(0), CARGO_SECTION_TRACTOR.body.L);
  assert.equal(cargoSectionRigLength(3), CARGO_SECTION_TRACTOR.body.L + 3 * CARGO_COUPLER.towPitch);
});

test('rachunki pomocnicze: kontenery na masę, sekcje w polu, gniazdo w kadłubie', () => {
  assert.equal(cargoContainersFor(0), 0);
  assert.equal(cargoContainersFor(7.5), 1);
  assert.equal(cargoContainersFor(8), 2);
  assert.equal(cargoContainersFor(120), 16);
  assert.deepEqual(cargoBreakdown(0), { sections: 0, modules: 0, containers: 0, rest: 0 });
  assert.deepEqual(cargoBreakdown(-5), { sections: 0, modules: 0, containers: 0, rest: 0 });
  // Atlas: 400 t = 3 sekcje + 1 moduł + 1 kontener + 2,5 t, a luk 346 × 275 j. mieści geometrycznie 4 × 6 sekcji
  assert.deepEqual(cargoBreakdown(CARGO_BAY_HULLS.atlas.cargoToday), { sections: 3, modules: 1, containers: 1, rest: 2.5 });
  assert.deepEqual(cargoSectionsInArea(346.4, 274.8), { nx: 4, ny: 6, count: 24 });
  assert.deepEqual(cargoSectionsInArea(71, 39), { nx: 0, ny: 0, count: 0 });
  // kombajn (346 × 114 j.) pomieści gniazdo, belter (120 × 41 j.) — nie: ciągnie sekcję na sprzęgu
  assert.equal(cargoHullFitsSocket(346, 114), true);
  assert.equal(cargoHullFitsSocket(120, 41), false);
});

test('moduł danych jest czysty i zamrożony', () => {
  const src = readFileSync(new URL('../src/data/cargoStandard.js', import.meta.url), 'utf8');
  assert.ok(!/from\s+['"]three/.test(src), 'bez three');
  assert.ok(!/\b(document|window)\./.test(src), 'bez DOM');
  const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  for (const p of imports) assert.ok(p.startsWith('./'), `import tylko z src/data: ${p}`);
  for (const o of [CARGO_LEVELS, CARGO_TRAILER, CARGO_SECTION, CARGO_COUPLER, CARGO_SOCKET, CARGO_CARRIERS, CARGO_TOOL_SECTIONS, CARGO_SECTION_TRACTOR, CARGO_FLAT_GOODS]) {
    assert.ok(Object.isFrozen(o));
    for (const v of Object.values(o)) if (v && typeof v === 'object') assert.ok(Object.isFrozen(v));
  }
});
