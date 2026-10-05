// Budowle portowe (Z7): stocznia (szkic użytkownika 2026-09-27 — taśma, pochylnie
// z rojem dronów i jednym dźwigiem, piasta z placami postoju / refitu), hangar
// postojowy, boje redy. Układy (czysta matematyka), rój, adapter do ruchu v2,
// kolizje, dane scen i render na atrapie bez WebGL. node --test tests/portBuildings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { K7_ATLAS, K7_HEIGHTS, k7BoxPoly, k7ConvexOverlap, k7FloorFrame } from '../src/3d/haloRing/haloPortK7Layout.js';
import { buildHaloPortTrafficLayout } from '../src/3d/haloRing/haloPortTraffic.js';
import { WARSHIP_CLASSES } from '../src/game/traffic/shipyards.js';
import { BERTH_ROLE, findBerth, hullFitsBerth, hullFootprint } from '../src/game/traffic/dockLayout.js';
import { buildPortParking, createParkingRegistry, syncParking } from '../src/game/traffic/portParking.js';
import { trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { PORT_PALETTE_SIZE, resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import {
  HULL_BUILD_STAGES,
  SHIPYARD_ATLAS,
  createShipyardLayout,
  hullBuildFront,
  hullBuildStage,
  shipyardHullFits,
  shipyardPadPoly,
  shipyardPads,
  shipyardSolidList,
  slipStatesFromYard
} from '../src/3d/portBuildings/portShipyardLayout.js';
import {
  CRATE,
  CRATE_STRIDE,
  SWARM_HEAVY,
  SWARM_TUNE,
  SWARM_Z,
  createShipyardSwarm,
  pushShipyardSwarm,
  stepShipyardSwarm
} from '../src/3d/portBuildings/portShipyardSwarm.js';
import { CARGO_DRONE, CARGO_DRONE_STRIDE } from '../src/game/cargoPortOps.js';
import { HANGAR_SPEC, createHangarLayout, hangarQueuePoint, hangarSolidList, planHangarCapacity } from '../src/3d/portBuildings/portHangarLayout.js';
import {
  PORT_SERVICE_ROLE,
  buildPortModuleCollision,
  portGameToHub,
  portHeadingToGame,
  portHubToGame,
  portModuleCargoPose,
  portModuleFootprintGame,
  portModuleFrame,
  portModuleTraffic,
  portRingModuleFrame,
  setPortModuleDoorsOpen
} from '../src/3d/portBuildings/portModuleTraffic.js';
import { BUOY_KIND, BUOY_ROLE, buildPortBuoys, buoyFlash } from '../src/3d/portBuildings/portBuoyLayout.js';
import { PB_FX, PB_MAX_GROUPS, PB_STRIDE, YARD_CH, buildHangarScene, buildShipyardScene } from '../src/3d/portBuildings/portBuildingScene.js';

const STYLES = ['earth', 'mars', 'jupiter'];
const ring = createHaloRingLayout({});
const padPoly = (b) => k7BoxPoly(b.x, b.z, b.width, b.length);
const inShipBand = (s) => s.y + s.h / 2 >= K7_HEIGHTS.hullBottom && s.y - s.h / 2 <= K7_HEIGHTS.hullTop;
const solidPoly = (s) => k7BoxPoly(s.x, s.z, s.w, s.d, s.angle || 0);
// Pas ruchu kadłuba o szerokości `beam` od (x, z0) do (x, z1) w układzie budowli.
const lanePoly = (x, z0, z1, beam) => k7BoxPoly(x, (z0 + z1) / 2, beam, Math.abs(z1 - z0));
const K7_FIELDS = ['id', 'size', 'x', 'z', 'angle', 'width', 'length', 'padLength', 'padBeam', 'maxLength', 'maxBeam', 'capture', 'stopPoint', 'occupied', 'reserved', 'lane', 'serviceAnchors'];

// ---------------------------------------------------------------------------
test('styl: trzy ringi → trzy rodziny, paleta K-7 liniowo, emisja w paśmie HDR', () => {
  const fam = STYLES.map((k) => resolvePortBuildingStyle(k));
  assert.deepEqual(fam.map((s) => s.family), ['k7', 'vault', 'radiator']);
  assert.deepEqual(fam.map((s) => s.walls), ['k7', 'berm', 'pipes']);
  for (const s of fam) {
    assert.equal(s.palette.length, PORT_PALETTE_SIZE);
    for (const c of s.palette) for (const v of c) assert.ok(v >= 0 && v <= 1, `paleta ${s.key}: ${v}`);
    assert.equal(s.emit.length, 5);
    // barwne światła bloomują (> 0,9) i zostają barwne (≤ 1,5 — ACES odbarwia wyżej)
    for (const c of s.emit) assert.ok(Math.max(...c) > 0.9 && Math.max(...c) <= 1.5, `emisja ${s.key}: ${c}`);
    assert.ok(Math.max(...s.weld) > 1, 'iskry spawania HDR > 1');
    assert.ok(s.buoy.period > 0 && s.buoy.flashes >= 1);
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.palette[0]));
  }
  // paleta różna per planeta (hak stylu działa), ten sam układ
  assert.notDeepEqual(fam[0].palette, fam[1].palette);
  assert.notDeepEqual(fam[1].palette, fam[2].palette);
  assert.equal(resolvePortBuildingStyle('nieznana').family, 'k7');
  assert.equal(resolvePortBuildingStyle(null).key, 'earth');
});

test('styl megadoku (Z8): własny obiekt w kształcie profile.port + blok buildings', () => {
  const earth = resolvePortBuildingStyle('earth');
  const custom = resolvePortBuildingStyle({
    key: 'saturn', name: 'MEGADOK TITAN',
    k7Palette: [0x9aa0a8, 0x202428, 0xdcdcd0, 0x6a8fd0, 0xaf693b, 0x38777d, 0x8c9ba3, 0x879797, 0x101920, 0x343b3d, 0x987955, 0x153d4a, 0xc9b587, 0x84c1c6],
    k7Emit: [[0.3, 1.1, 1.3], [1.28, 0.9, 0.5], [1.4, 1.36, 1.14], [1.28, 0.16, 0.08], [0.4, 1.15, 0.66]],
    buildings: { family: 'radiator', walls: 'k7', buoy: { period: 2, flashes: 3 } }
  });
  assert.equal(custom.key, 'saturn');
  assert.equal(custom.name, 'MEGADOK TITAN');
  assert.equal(custom.family, 'radiator');
  assert.equal(custom.walls, 'k7');
  assert.equal(custom.buoy.period, 2);
  assert.equal(custom.buoy.flashes, 3);
  assert.notDeepEqual(custom.palette[3], earth.palette[3]);
  // brakujące pola z Ziemi
  assert.deepEqual(custom.glow, earth.glow);
  assert.deepEqual(custom.labels, earth.labels);
});

// ---------------------------------------------------------------------------
// Stocznia wg szkicu użytkownika (2026-09-27): galeria z taśmą wzdłuż ringu,
// trzon, dwie pochylnie po bokach, piasta — okrąg z wypustkami albo litera U.
const SHIPYARD_VARIANTS = [{}, { slips: 1 }, { slips: 3 }, { slips: 4 }, { hub: 'u' }, { hub: 'u', slips: 4 }];
const padOf = (b) => (b.kind === 'pad' ? shipyardPadPoly(b) : k7BoxPoly(b.x, b.z, b.padBeam, b.padLength));

test('stocznia: galeria z taśmą, trzon, pochylnie po bokach, piasta okrąg (Ziemia) / U (inne frakcje)', () => {
  assert.deepEqual(STYLES.map((k) => resolvePortBuildingStyle(k).shipyardHub), ['radial', 'u', 'u']);
  const l = createShipyardLayout({ id: 'Y-1' });
  assert.equal(l.slips.length, 2, 'SHIPYARD_MODEL.slots = 2 pochylnie');
  assert.deepEqual(l.slips.map((s) => s.side), [-1, 1], 'po obu stronach trzonu');
  for (const s of l.slips) {
    assert.ok(Math.abs(s.x) - s.width / 2 >= l.spine.x1, `${s.id} obok trzonu, nie na nim`);
    assert.ok(s.z0 > l.gallery.z1 && s.z1 < l.hub.z, 'między galerią a piastą');
  }
  // piasta Ziemi: okrąg z wypustkami (capital, 2 × L, 2 × nosiciel) i wewnętrzne place M
  assert.equal(l.hub.kind, 'radial');
  assert.deepEqual(l.hub.prongs.map((p) => Math.round(p.angle * 180 / Math.PI)), [0, -60, 60, -120, 120]);
  assert.deepEqual([l.capacity.CAPITAL, l.capacity.L, l.capacity.M], [3, 2, 4]);
  for (const b of l.berths) {
    for (const k of K7_FIELDS) assert.ok(b[k] !== undefined, `${b.id}: brak pola ${k}`);
    assert.ok(b.approach || b.launch, `${b.id}: podejście / zejście`);
    for (const p of padOf(b)) assert.ok(p.x >= l.x0 - 1e-6 && p.x <= l.x1 + 1e-6 && p.z >= l.backZ && p.z <= l.frontZ + 1e-6, `${b.id} poza obrysem`);
  }
  // place: dziobem ku środkowi piasty, podejście z zewnątrz
  for (const b of shipyardPads(l)) {
    const toHub = Math.atan2(l.hub.z - b.z, l.hub.x - b.x);
    assert.ok(Math.abs(Math.atan2(Math.sin(b.angle - toHub), Math.cos(b.angle - toHub))) < 1e-9, `${b.id} dziobem do piasty`);
    assert.ok(Math.hypot(b.approach.from.x - l.hub.x, b.approach.from.z - l.hub.z) > Math.hypot(b.x - l.hub.x, b.z - l.hub.z));
  }
  // inne frakcje: litera U — basen z capital i L, M na zewnątrz ramion
  const u = createShipyardLayout({ hub: 'u' });
  assert.equal(u.hub.kind, 'u');
  assert.equal(u.hub.arms.length, 2);
  assert.deepEqual([u.capacity.CAPITAL, u.capacity.L, u.capacity.M], [2, 4, 8]);
  const inBasin = (b) => b.x > u.hub.basin.x0 && b.x < u.hub.basin.x1 && b.z > u.hub.basin.z0;
  assert.ok(shipyardPads(u).filter((b) => b.ring === 'basin').every(inBasin));
  assert.ok(shipyardPads(u).filter((b) => b.ring === 'arm').every((b) => !inBasin(b)));
  // taśma: dwa podajniki z galerii (wzdłuż ringu), schodzą się w trzonie, koniec przy rdzeniu / terminalu
  for (const lay of [l, u]) {
    const [a, b] = lay.belt.feeds;
    const len = (p) => p.slice(1).reduce((acc, q, i) => acc + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
    assert.ok(Math.abs(len(a) - len(b)) < 1e-6, 'podajniki równej długości (kontenery na przemian)');
    assert.deepEqual(a.at(-1), [lay.belt.end.x, lay.belt.end.z]);
    assert.ok(a[0][1] === lay.belt.stubZ && a[0][1] > lay.gallery.z0 && a[0][1] < lay.gallery.z1, 'początek w galerii ringu');
    assert.ok(a[0][0] < lay.slips[0].x - lay.slips[0].width / 2 && b[0][0] > lay.slips[1].x + lay.slips[1].width / 2, 'galeria szersza niż pochylnie');
  }
  assert.ok(l.belt.end.z < l.hub.z - l.hub.core, 'taśma kończy się przed rdzeniem');
  assert.ok(u.belt.end.z < u.hub.terminal.z - u.hub.terminal.d / 2, 'taśma kończy się przed terminalem U');
});

test('stocznia: każda klasa okrętu mieści się na pochylni; Atlas na placu capital, nosiciel na swoim', () => {
  const l = createShipyardLayout({});
  for (const cls of Object.values(WARSHIP_CLASSES)) {
    const fp = hullFootprint(cls.hull);
    const size = trafficHullRenderSize(cls.hull);
    for (const b of l.berths.filter((v) => v.kind === 'slip')) {
      assert.ok(shipyardHullFits(b, { length: fp.length, beam: fp.width }), `${cls.id} (${fp.length} × ${fp.width}) na ${b.id}`);
      assert.ok(size.w <= b.padLength && size.h <= b.padBeam, `sprite ${cls.hull} na polu ${b.id}`);
    }
  }
  assert.deepEqual(SHIPYARD_ATLAS, { length: K7_ATLAS.w, beam: K7_ATLAS.h });
  const pads = shipyardPads(l);
  const capital = pads.filter((b) => b.maxBeam >= 1000);
  assert.equal(capital.length, 1);
  assert.ok(shipyardHullFits(capital[0], SHIPYARD_ATLAS), 'Atlas 1800 × 806 na placu capital (refit)');
  assert.equal(capital[0].maxLength, 2050, 'standard capital K-7');
  const carrier = hullFootprint('terran_carrier');
  const carrierSprite = trafficHullRenderSize('terran_carrier');
  const carrierPads = pads.filter((b) => b.size === 'CAPITAL' && b.maxBeam < 1000);
  assert.equal(carrierPads.length, 2);
  for (const b of carrierPads) {
    assert.ok(shipyardHullFits(b, { length: carrier.length, beam: carrier.width }));
    assert.ok(carrierSprite.w <= b.padLength && carrierSprite.h <= b.padBeam, 'sprite nosiciela na polu');
  }
  const u = createShipyardLayout({ hub: 'u' });
  assert.ok(shipyardPads(u).some((b) => shipyardHullFits(b, SHIPYARD_ATLAS)), 'U: capital w basenie');
});

test('stocznia: pola rozłączne, bryły poza polami i taśmą, zejście z pochylni i podejścia wolne', () => {
  for (const opts of SHIPYARD_VARIANTS) {
    const l = createShipyardLayout(opts);
    const tag = JSON.stringify(opts);
    for (let i = 0; i < l.berths.length; i++) {
      for (let j = i + 1; j < l.berths.length; j++) {
        assert.ok(!k7ConvexOverlap(padOf(l.berths[i]), padOf(l.berths[j])), `${tag}: ${l.berths[i].id} × ${l.berths[j].id}`);
      }
    }
    const solids = shipyardSolidList(l).filter(inShipBand);
    const beltPolys = [
      k7BoxPoly(0, (l.belt.stubZ + l.belt.end.z) / 2, l.belt.housing, l.belt.end.z - l.belt.stubZ),
      k7BoxPoly(0, l.belt.stubZ, 2 * l.belt.stub.x1, l.belt.housing)
    ];
    for (const s of solids) {
      const sp = solidPoly(s);
      for (const b of l.berths) assert.ok(!k7ConvexOverlap(sp, padOf(b)), `${tag}: ${s.id} na ${b.id}`);
      for (const bp of beltPolys) assert.ok(!k7ConvexOverlap(sp, bp), `${tag}: ${s.id} na taśmie`);
    }
    for (const b of l.berths) {
      if (b.kind === 'pad') {
        assert.ok(!k7ConvexOverlap(beltPolys[0], padOf(b)), `${tag}: taśma przez ${b.id}`);
        // podejście do placu (korytarz szerokości maxBeam) bez brył poza własną wieżą
        const a = b.approach.from;
        const len = Math.hypot(a.x - b.x, a.z - b.z);
        const corr = k7BoxPoly((a.x + b.x) / 2, (a.z + b.z) / 2, len, b.maxBeam, b.angle);
        for (const s of solids) if (s.id !== `PAD TOWER ${b.id}`) assert.ok(!k7ConvexOverlap(corr, solidPoly(s)), `${tag}: podejście ${b.id} przez ${s.id}`);
      } else {
        // zejście nosiciela (najszerszy) z pochylni ku piaście
        const carrier = hullFootprint(WARSHIP_CLASSES.carrier.hull);
        const lane = lanePoly(b.x, b.z - carrier.length / 2, b.launch.to.z, carrier.width + 20);
        for (const s of solids) assert.ok(!k7ConvexOverlap(lane, solidPoly(s)), `${tag}: zejście ${b.id} przez ${s.id}`);
      }
    }
  }
});

test('dźwig: jeden na pochylnię, profil ≤ 1/20 rozpiętości, wysięgnik nad stację taśmy', () => {
  for (const opts of [{}, { hub: 'u', slips: 4 }]) {
    const l = createShipyardLayout(opts);
    const sc = buildShipyardScene(l, resolvePortBuildingStyle('earth'));
    assert.equal(sc.rig.slips.length, l.slips.length);
    assert.equal(sc.groups.filter((g) => g.kind === 'crane-bridge').length, l.slips.length, 'jeden most na pochylnię');
    for (const s of l.slips) {
      const C = s.crane;
      for (const p of [C.leg, C.girder, C.girderH]) assert.ok(p <= C.span / 20 + 1e-9, `${s.id}: ${p} > ${C.span}/20`);
      assert.ok(C.legTop > K7_HEIGHTS.hullTop + 200, 'most nad płaszczyzną gry (FG)');
      assert.ok(C.span / 2 > s.padBeam / 2, 'nogi poza polem kadłuba');
      assert.equal(C.tipX, s.station.x, 'wysięgnik sięga stacji taśmy');
      assert.ok(Math.abs(C.innerRail) < Math.abs(C.outerRail) && Math.abs(C.tipX) < Math.abs(C.innerRail), 'wysięgnik nad trzonem');
      assert.ok(s.rack.slots.length >= SWARM_TUNE.perSlip + SWARM_TUNE.welders, 'stojak na cały rój');
    }
  }
});

test('budowa kadłuba: etapy po kolei, czoło 0 → 1 w każdym etapie, stan z rejestru stoczni', () => {
  const S = HULL_BUILD_STAGES;
  assert.equal(S.keel[0], 0);
  assert.equal(S.outfit[1], 1);
  for (const [a, b] of [[S.keel, S.frames], [S.frames, S.plating], [S.plating, S.outfit]]) assert.equal(a[1], b[0]);
  assert.equal(hullBuildStage(0), 'keel');
  assert.equal(hullBuildStage(0.2), 'frames');
  assert.equal(hullBuildStage(0.5), 'plating');
  assert.equal(hullBuildStage(0.9), 'outfit');
  assert.equal(hullBuildStage(1), 'done');
  for (const r of Object.values(S)) {
    let prev = -1;
    for (let k = 0; k <= 20; k++) {
      const p = r[0] + (r[1] - r[0]) * (k / 20) * 0.999;
      const f = hullBuildFront(p);
      assert.ok(f >= prev - 1e-9 && f >= 0 && f <= 1, `czoło rośnie w etapie ${r}`);
      prev = f;
    }
  }
  const yard = { building: [{ classId: 'carrier', remaining: WARSHIP_CLASSES.carrier.seconds * 0.25 }, { classId: 'frigate', remaining: WARSHIP_CLASSES.frigate.seconds }] };
  const st = slipStatesFromYard(yard, 2);
  assert.equal(st[0].hullId, 'terran_carrier');
  assert.ok(Math.abs(st[0].progress - 0.75) < 1e-9);
  assert.equal(st[0].stage, 'plating');
  assert.equal(st[1].progress, 0);
  assert.deepEqual(slipStatesFromYard({ building: [] }, 2), [null, null]);
  assert.deepEqual(slipStatesFromYard(null, 1), [null]);
});

// ---------------------------------------------------------------------------
// Rój dronów, taśma, dźwig (portShipyardSwarm.js)
const BUILDING = [{ hullId: 'terran_carrier', classId: 'carrier', progress: 0.5 }, { hullId: 'terran_frigate', classId: 'frigate', progress: 0.2 }];
function maxStep(sw, t0, frames, stateAt) {
  let prev = null;
  let worst = 0;
  for (let f = 0; f < frames; f++) {
    stepShipyardSwarm(sw, t0 + f / 60, stateAt(f));
    const D = sw.drones;
    if (prev) {
      for (let k = 0; k < sw.droneCount; k++) {
        const o = k * CARGO_DRONE_STRIDE;
        worst = Math.max(worst, Math.hypot(D[o] - prev[o], D[o + 1] - prev[o + 1], D[o + 2] - prev[o + 2]));
      }
    }
    prev = D.slice(0, sw.droneCount * CARGO_DRONE_STRIDE);
  }
  return worst;
}

test('rój: drony w rekordach Z5, liczba wg etapu, w obrysie stoczni, ładunek tylko w chwytaku', () => {
  const l = createShipyardLayout({});
  const sw = createShipyardSwarm(l);
  const pad = shipyardPads(l).find((b) => b.maxBeam >= 1000);
  stepShipyardSwarm(sw, 400, { slips: BUILDING, refit: [{ pad, length: 1800, beam: 806, work: 1 }] });
  const perSlip = SWARM_TUNE.perSlip + SWARM_TUNE.welders;
  assert.equal(sw.droneCount, l.slips.length * perSlip + sw.depots.length * SWARM_TUNE.refitDrones, 'wszystkie drony (w roju i na stojakach)');
  assert.equal(sw.stats.active, SWARM_TUNE.active.plating + SWARM_TUNE.welding.plating + SWARM_TUNE.active.frames + SWARM_TUNE.welding.frames + SWARM_TUNE.refitDrones);
  let carrying = 0;
  for (let t = 400; t < 460; t += 0.5) {
    stepShipyardSwarm(sw, t, { slips: BUILDING, refit: [{ pad, length: 1800, beam: 806, work: 1 }] });
    const D = sw.drones;
    let c = 0;
    for (let k = 0; k < sw.droneCount; k++) {
      const o = k * CARGO_DRONE_STRIDE;
      const x = D[o + CARGO_DRONE.U];
      const z = D[o + CARGO_DRONE.V];
      const h = D[o + CARGO_DRONE.Z];
      assert.ok(x >= l.x0 && x <= l.x1 && z >= l.backZ && z <= l.frontZ, `dron ${k} poza stocznią (${x}, ${z})`);
      assert.ok(h >= SWARM_Z.deck && h <= SWARM_Z.refitCruise + 60, `dron ${k} na wysokości ${h}`);
      if (D[o + CARGO_DRONE.CARRY] > 0.5) {
        c++;
        assert.ok(D[o + CARGO_DRONE.RES] >= 0, 'niesie surowiec');
      }
    }
    assert.equal(sw.carriedCount, c, 'kontener na haku = dron z ładunkiem');
    carrying += c;
  }
  assert.ok(carrying > 0, 'rój nosi moduły');
  // pochylnia bez kadłuba: rój na stojaku (po powrocie), dźwig w bazie
  const idle = createShipyardSwarm(l);
  stepShipyardSwarm(idle, 10, { slips: [null, null] });
  assert.equal(idle.stats.active, 0);
  for (let k = 0; k < l.slips.length * perSlip; k++) {
    const z = idle.drones[k * CARGO_DRONE_STRIDE + CARGO_DRONE.Z];
    assert.equal(z, SWARM_Z.rack, 'dron na stojaku');
  }
  assert.ok(idle.cranes.every((c, i) => c.z === l.slips[i].crane.homeZ && !c.carrying));
});

test('rój: ruch ciągły — praca, wejście do roju i powrót na stojak bez przeskoków', () => {
  const l = createShipyardLayout({ hub: 'u' });
  const sw = createShipyardSwarm(l);
  const pad = shipyardPads(l).find((b) => b.maxBeam >= 1000);
  const refit = [{ pad, length: 1800, beam: 806, work: 1 }];
  // prędkość szczytowa odcinka ≈ 1,5 × przelot (wygładzenie), klatka 1/60 s
  const limit = 1.6 * Math.max(SWARM_TUNE.speed, SWARM_TUNE.refitSpeed) / 60 + 1;
  assert.ok(maxStep(sw, 200, 3600, () => ({ slips: BUILDING, refit })) < limit, 'praca');
  assert.ok(maxStep(sw, 300, 3600, (f) => ({ slips: f < 600 ? [null, null] : BUILDING, refit: f < 600 ? [] : refit })) < limit, 'wejście do roju');
  assert.ok(maxStep(sw, 400, 3600, (f) => ({ slips: f < 60 ? BUILDING : [null, null], refit: f < 60 ? refit : [] })) < limit, 'powrót na stojak');
  // po powrocie wszyscy na stojakach
  stepShipyardSwarm(sw, 400 + 3600 / 60 + 90, { slips: [null, null] });
  assert.equal(sw.stats.active, 0);
});

test('taśma: kontenery na trasie podajników, windy na końcach, dźwig kursuje stacja ↔ czoło', () => {
  const l = createShipyardLayout({});
  const sw = createShipyardSwarm(l);
  stepShipyardSwarm(sw, 123.4, { slips: BUILDING, refit: [] });
  const K = sw.crates;
  let onBelt = 0;
  for (let i = 0; i < sw.crateCount; i++) {
    const o = i * CRATE_STRIDE;
    if (K[o + CRATE.DECK] !== SWARM_Z.belt) continue;
    onBelt++;
    const x = K[o];
    const z = K[o + 1];
    const onStub = Math.abs(z - l.belt.stubZ) < 1e-6 && Math.abs(x) <= l.belt.stub.x1 + 1e-6;
    const onSpine = Math.abs(x) < 25 && z >= l.belt.stubZ - 1e-6 && z <= l.belt.end.z + 1e-6;
    assert.ok(onStub || onSpine, `kontener taśmy poza trasą (${x}, ${z})`);
    if (K[o + CRATE.CLIP] > -1e8) assert.ok(K[o + CRATE.Z] <= SWARM_Z.belt, 'winda: wyjeżdża spod pokładu');
  }
  assert.ok(onBelt > 60, `kontenerów na taśmie ${onBelt}`);
  assert.equal(stepShipyardSwarm(sw, 124, { slips: BUILDING, belt: false }).crateCount < sw.crates.length, true);
  // dźwig: w zakresie szyn, wysięgnik nad stacją przy chwycie, blok tylko w drodze
  const s0 = l.slips[0];
  let sawTip = false;
  let sawFront = false;
  for (let t = 0; t < SWARM_TUNE.cranePeriod; t += 0.25) {
    stepShipyardSwarm(sw, 1000 + t, { slips: BUILDING });
    const c = sw.cranes[0];
    assert.ok(c.z >= s0.crane.z0 - 1e-6 && c.z <= s0.crane.z1 + 1e-6, 'most na szynach');
    const minX = Math.min(s0.crane.tipX, s0.x);
    const maxX = Math.max(s0.crane.tipX, s0.x);
    assert.ok(c.x >= minX - 1e-6 && c.x <= maxX + 1e-6, 'wózek między stacją a osią kadłuba');
    if (Math.abs(c.x - s0.crane.tipX) < 1 && c.hookY < 100) sawTip = true;
    if (Math.abs(c.x - s0.x) < 1 && c.carrying && c.hookY < 250) sawFront = true;
  }
  assert.ok(sawTip && sawFront, 'chwyt przy taśmie i odłożenie na kadłubie');
});

test('rój przez Z5: rekordy trafiają do CargoDrones3D / CargoContainers3D w pozie budowli', () => {
  const l = createShipyardLayout({ backZ: 0 });
  const sw = createShipyardSwarm(l);
  stepShipyardSwarm(sw, 50, { slips: BUILDING });
  const frame = portModuleFrame(1200, -3400, 0.7);
  const station = { x: 5_100_000, y: -2_300_000 };
  const pose = portModuleCargoPose(frame, station);
  const got = { drones: [], crates: [], deck: [] };
  const C = {
    ready: true,
    setDeckZ(z) { got.deck.push(z); },
    pushBerthContainer(p, u, v, z, yaw, unit, grid, res, seed, clip, light, kind) {
      const c = Math.cos(p.angle);
      const s = Math.sin(p.angle);
      got.crates.push({ x: p.x + u * c - v * s, y: p.y + u * s + v * c, u, v, kind, unit });
      return true;
    }
  };
  const D = { ready: true, pushDrone(p, rec, o) { got.drones.push({ u: rec[o], v: rec[o + 1], p }); return true; } };
  const n = pushShipyardSwarm(sw, C, D, pose, 50);
  assert.equal(n, sw.droneCount);
  assert.equal(got.crates.length, sw.crateCount + sw.carriedCount);
  // (u, v) = (x, z) układu budowli → ten sam punkt gry co portHubToGame
  for (const c of got.crates.slice(0, 20)) {
    const g = portHubToGame(frame, station, c.u, c.v);
    assert.ok(Math.abs(g.x - c.x) < 1e-6 && Math.abs(g.y - c.y) < 1e-6);
  }
  assert.ok(got.crates.some((c) => c.unit === SWARM_HEAVY), 'blok dźwigu');
  assert.ok(got.deck.every(Number.isFinite));
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
test('hangar: pojemność dla portów bez ringu z planu § 2 (parking max przy ×60)', () => {
  // Saturn 472, Uran 336, Ceres 317, Jowisz 266, Westa 123, Wenus 93, Merkury 78
  for (const need of [472, 336, 317, 266, 123, 93, 78]) {
    const plan = planHangarCapacity(need);
    assert.ok(plan.capacity.total >= need, `${need}: ${plan.capacity.total}`);
    assert.ok(plan.capacity.total <= need * 1.35 + 30, `${need}: za dużo zapasu ${plan.capacity.total}`);
    for (const d of plan.drums) {
      const spec = HANGAR_SPEC.drums[d.cls];
      assert.ok(spec.slots.includes(d.slots) && d.levels >= spec.levelsMin && d.levels <= spec.levelsMax);
      assert.equal(d.capacity, d.slots * d.levels);
      // kołyski w standardzie padów K-7 (statek klasy mieści się w kołysce)
      assert.ok(d.cradleLength >= d.maxLength && d.cradleBeam >= d.maxBeam, `${d.cls}: kołyska ${d.cradleLength} × ${d.cradleBeam}`);
    }
    for (const cls of ['s', 'm', 'l']) assert.ok(plan.capacity[cls] > 0, `${need}: klasa ${cls}`);
    assert.ok(plan.capacity.heavy > 0, 'zatoka ciężka (capital + mega)');
  }
  // większy port = więcej bębnów (nie tylko więcej poziomów)
  assert.ok(planHangarCapacity(472).drums.length > planHangarCapacity(93).drums.length);
});

test('hangar: bębny rozłączne i w ścianach, brama przepuszcza megafrachtowiec, przechwyt pod dachem', () => {
  for (const [capacity, rows] of [[300, 1], [472, 2], [93, 1]]) {
    const l = createHangarLayout({ capacity, rows });
    assert.equal(l.rows, rows);
    const inner = l.halfWidth - l.wall;
    for (const d of l.drums) {
      assert.ok(Math.abs(d.x) + d.outerR <= inner + 1e-6, `${d.id} w ścianach bocznych`);
      assert.ok(d.z - d.outerR >= l.backZ + l.wall - 1e-6 && d.z + d.outerR <= l.corridor.z0, `${d.id} przed korytarzem`);
    }
    for (let i = 0; i < l.drums.length; i++) {
      for (let j = i + 1; j < l.drums.length; j++) {
        const a = l.drums[i];
        const b = l.drums[j];
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= a.outerR + b.outerR, `${a.id} × ${b.id}`);
      }
      if (l.heavy) {
        const d = l.drums[i];
        const px = Math.max(l.heavy.x - l.heavy.width / 2, Math.min(d.x, l.heavy.x + l.heavy.width / 2));
        const pz = Math.max(l.heavy.z - l.heavy.depth / 2, Math.min(d.z, l.heavy.z + l.heavy.depth / 2));
        assert.ok(Math.hypot(px - d.x, pz - d.z) >= d.outerR, `${d.id} na zatoce ciężkiej`);
      }
    }
    const mega = hullFootprint('megafreighter');
    const bin = l.berths.find((b) => b.kind === 'hangar-in');
    const bout = l.berths.find((b) => b.kind === 'hangar-out');
    assert.ok(bin.maxBeam >= mega.width && bin.maxLength >= mega.length);
    const solids = hangarSolidList(l).filter(inShipBand);
    for (const [b, z1] of [[bin, bin.approach.from.z], [bout, bout.launch.to.z]]) {
      const lane = lanePoly(b.x, b.z - 400, z1, mega.width + 60);
      for (const s of solids) assert.ok(!k7ConvexOverlap(lane, solidPoly(s)), `${b.id} przez ${s.id}`);
      // punkt przechwytu / pojawienia się pod dachem (w obrysie hali): statek chowa się pod dachem FG
      assert.ok(b.z < l.frontZ - l.wall && b.z > l.corridor.z0, `${b.id}: przechwyt pod dachem`);
    }
  }
});

test('hangar: kolejka od bramy IN na zewnątrz, punkty kolejki na pasie', () => {
  const l = createHangarLayout({ capacity: 300, queueSlots: 10, queuePitch: 700 });
  const gin = l.gates.find((g) => g.kind === 'in');
  assert.equal(l.queue.slots.length, 10);
  for (let k = 0; k < l.queue.slots.length; k++) {
    const s = l.queue.slots[k];
    assert.equal(s.x, gin.x);
    assert.ok(s.z > l.apronZ1, 'kolejka przed płytą (w kosmosie)');
    if (k) assert.ok(Math.abs(s.z - l.queue.slots[k - 1].z - 700) < 1e-9, 'rozstaw kolejki');
    assert.ok(Math.abs(s.angle + Math.PI / 2) < 1e-9, 'dziobem do bramy');
  }
  const p = hangarQueuePoint(l, 1000);
  assert.equal(p.x, gin.x);
  assert.ok(Math.abs(p.z - (l.queue.path[0][1] + 1000)) < 1e-9);
  assert.ok(Math.abs(p.angle + Math.PI / 2) < 1e-9);
});

// ---------------------------------------------------------------------------
test('adapter: place piasty = dok floty z refitem (findBerth), pochylnie w układzie gry', () => {
  const l = createShipyardLayout({ id: 'Y-1' });
  const station = { id: 'saturn', x: 5_100_000, y: -2_300_000 };
  const frame = portModuleFrame(-4000, 9000, -Math.PI / 2);
  const t = portModuleTraffic(l, { frame, station, stationId: 'saturn' });
  assert.equal(t.docks.length, 1);
  assert.equal(t.yards.length, 2);
  const dock = t.docks[0];
  assert.equal(dock.kind, 'shipyard-pads');
  assert.equal(dock.role, BERTH_ROLE.MILITARY, 'postój floty po produkcji');
  assert.equal(dock.berths.length, shipyardPads(l).length);
  for (const [i, berth] of dock.berths.entries()) {
    const src = shipyardPads(l)[i];
    const g = portHubToGame(frame, station, src.x, src.z);
    assert.ok(Math.abs(berth.x - g.x) < 1e-6 && Math.abs(berth.y - g.y) < 1e-6);
    assert.ok(Math.abs(berth.angle - portHeadingToGame(frame, src.angle)) < 1e-9);
    assert.equal(berth.service, 'refit');
    assert.equal(berth.role, BERTH_ROLE.MILITARY);
  }
  const layout = { stationId: 'saturn', docks: t.docks, berths: t.docks.flatMap((d) => d.berths) };
  const carrierBerth = findBerth(layout, 'terran_carrier', 0, { role: BERTH_ROLE.MILITARY })?.berth;
  assert.ok(carrierBerth && hullFitsBerth(carrierBerth, 'terran_carrier'), 'nosiciel znajduje plac');
  assert.ok(findBerth(layout, 'terran_frigate', 0, { role: BERTH_ROLE.MILITARY }), 'fregata znajduje plac');
  assert.equal(findBerth(layout, 'container_ship', 0, { role: BERTH_ROLE.CIVIL }), null, 'kurs cywilny nie staje w stoczni');
  // wyłącznie serwis: rola PORT_SERVICE_ROLE (flota ich nie wybiera)
  const svc = portModuleTraffic(l, { frame, station, role: PORT_SERVICE_ROLE });
  const svcLayout = { docks: svc.docks, berths: svc.docks.flatMap((d) => d.berths) };
  assert.equal(findBerth(svcLayout, 'terran_frigate', 0, { role: BERTH_ROLE.MILITARY }), null);
  assert.ok(findBerth(svcLayout, 'terran_frigate', 0, { role: PORT_SERVICE_ROLE }));
  // pochylnia: kurs zejścia = dziób ku piaście (+z układu → w grze +y przy kącie −π/2)
  const yardA = t.yards[0];
  assert.ok(Math.abs(yardA.angle - Math.PI / 2) < 1e-9);
  assert.ok(yardA.launchY > yardA.y);
  // odwrotność: gra → układ
  const src = shipyardPads(l)[0];
  const back = portGameToHub(frame, station, dock.berths[0].x, dock.berths[0].y);
  assert.ok(Math.abs(back.x - src.x) < 1e-6 && Math.abs(back.z - src.z) < 1e-6);
  // bryły w grze z zakresem wysokości, bez drzwi
  assert.ok(t.solids.length > 10 && t.solids.every((s) => s.points.length === 4 && s.y1 > s.y0));
  assert.equal(t.solids.filter((s) => s.door).length, 0);
});

test('adapter na ringu: ramka k7FloorFrame z obrotem grupy (Mars −π), tył na płycie podłogi', () => {
  const l = createShipyardLayout({ id: 'Y-R' });
  const theta = 0.55;
  const plain = portRingModuleFrame(ring, theta);
  // budowle Z7 zostają wpięte w podłogę (hale K-7 i zatoki od 2026-10-05 stoją na pylonach — k7Frame)
  const ref = k7FloorFrame(ring, theta);
  assert.deepEqual(plain.origin, ref.origin);
  // tył układu (z = K7_PLACEMENT.backZ) leży na płycie portu jak ściana tylna K-7
  assert.equal(l.backZ, 250);
  assert.ok(Math.abs(plain.floorZ - l.backZ) < 1e-6);
  const station = { id: 'mars', x: 1000, y: 2000 };
  const rotated = portRingModuleFrame(ring, theta, -Math.PI);
  const a = portModuleTraffic(l, { frame: plain, station }).docks[0].berths[0];
  const b = portModuleTraffic(l, { frame: rotated, station }).docks[0].berths[0];
  // obrót o π wokół środka planety: punkt przechodzi na drugą stronę
  assert.ok(Math.abs((a.x - station.x) + (b.x - station.x)) < 1e-6);
  assert.ok(Math.abs((a.y - station.y) + (b.y - station.y)) < 1e-6);
});

test('adapter: hangar jako punkt wejścia redy portu bez ringu (portParking, Z2)', () => {
  const h = createHangarLayout({ id: 'H-1', capacity: 472 });
  const station = { id: 'saturn', x: 3_000_000, y: 1_000_000 };
  const frame = portModuleFrame(0, 6000, Math.PI / 2);
  const t = portModuleTraffic(h, { frame, station, stationId: 'saturn' });
  assert.equal(t.hangars.length, 1);
  const hg = t.hangars[0];
  assert.equal(hg.capacity, h.capacity.total);
  assert.equal(hg.queue.length, h.queue.slots.length);
  // punkt wejścia leży w obrysie hali (pod dachem)
  const fp = portModuleFootprintGame(h, frame, station);
  const xs = fp.map((p) => p.x);
  const ys = fp.map((p) => p.y);
  assert.ok(hg.x > Math.min(...xs) && hg.x < Math.max(...xs) && hg.y > Math.min(...ys) && hg.y < Math.max(...ys));
  // reda portu bez ringu: hangar najpierw, z pojemnością budowli
  const dockLayout = { stationId: 'saturn', docks: [], berths: [] };
  const plan = buildPortParking(dockLayout, station, { hangar: { x: hg.x, y: hg.y, capacity: hg.capacity } });
  assert.equal(plan.mode, 'hangar');
  const reg = createParkingRegistry(plan, { role: BERTH_ROLE.CIVIL });
  const ships = Array.from({ length: h.capacity.total + 40 }, (_, i) => ({ id: `s${i}`, hullId: 'container_ship', idleSince: i }));
  syncParking(reg, ships);
  const spots = [...reg.byShip.values()];
  assert.equal(spots.filter((s) => s.kind === 'hangar').length, h.capacity.total);
  assert.ok(spots.filter((s) => s.kind === 'hangar').every((s) => s.x === hg.x && s.y === hg.y));
  assert.ok(spots.some((s) => s.kind !== 'hangar'), 'nadmiar ponad hangar stoi na redzie');
});

test('kolizje: rdzeń piasty, kołnierz i wieże blokują, place i pokład nie', () => {
  for (const hub of ['radial', 'u']) {
    const l = createShipyardLayout({ hub });
    const col = buildPortModuleCollision(l);
    assert.equal(col.doors.length, 0);
    // kadłub na każdym placu: wolny (wieże serwisowe stoją obok pola)
    for (const b of shipyardPads(l)) {
      const hull = k7BoxPoly(b.x, b.z, Math.min(b.maxLength, 600), Math.min(b.maxBeam, 300), b.angle);
      assert.equal(col.test(hull), null, `${hub}: plac ${b.id}`);
    }
    // kadłub na pochylni i nad trzonem: pokład, nie przeszkoda
    for (const s of l.slips) assert.equal(col.test(k7BoxPoly(s.x, s.z, 400, 900)), null);
    assert.equal(col.test(k7BoxPoly(0, (l.spine.rootZ1 + l.slips[0].z1) / 2, 300, 600)), null, 'nad trzonem');
    // rdzeń / terminal i kołnierz zatrzymują
    const core = l.hub.kind === 'radial' ? { x: 0, z: l.hub.z } : l.hub.terminal;
    assert.ok(String(col.test(k7BoxPoly(core.x, core.z, 200, 200))).match(/CORE|TERMINAL/));
    assert.ok(String(col.test(k7BoxPoly(l.spine.collar.x, l.spine.collar.z, 200, 200))).startsWith('COLLAR'));
  }
  const hc = buildPortModuleCollision(createHangarLayout({ capacity: 200 }));
  assert.equal(hc.doors.length, 0);
  setPortModuleDoorsOpen(hc, true);
});

// ---------------------------------------------------------------------------
test('boje: z planu redy Ziemi — narożniki, brzegi stref, końce rzędów, role', () => {
  const port = buildHaloPortTrafficLayout(ring, { id: 'earth', x: 0, y: 0 });
  const plan = buildPortParking(port, null, {});
  const set = buildPortBuoys(plan);
  assert.equal(set.zones.length, plan.zones.length);
  assert.ok(set.count > plan.zones.length * 12);
  for (const zi of set.zones.keys()) {
    const zone = plan.zones[zi];
    const zinfo = set.zones[zi];
    let corners = 0;
    for (let i = zinfo.start; i < zinfo.start + zinfo.count; i++) {
      const dx = set.x[i] - zone.cx;
      const dy = set.y[i] - zone.cy;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
      const inArc = wrap(a - zone.a0) >= -1e-6 && wrap(zone.a1 - a) >= -1e-6;
      assert.ok(r >= zone.r0 - 1 && r <= zone.r1 + 1 && inArc, `boja ${i} poza strefą ${zone.id}`);
      if (set.kind[i] === BUOY_KIND.corner) corners++;
      if (set.kind[i] !== BUOY_KIND.row) {
        const onArc = Math.abs(r - zone.r0) < 1 || Math.abs(r - zone.r1) < 1;
        const onEdge = Math.abs(wrap(a - zone.a0)) < 1e-6 || Math.abs(wrap(a - zone.a1)) < 1e-6;
        assert.ok(onArc || onEdge, `boja brzegu ${i} nie na brzegu strefy`);
      }
      assert.equal(set.role[i], zone.role === 'military' ? BUOY_ROLE.military : BUOY_ROLE.civil);
      assert.ok(set.phase[i] >= 0 && set.phase[i] <= 1);
    }
    assert.equal(corners, 4, `${zone.id}: 4 narożniki`);
  }
  assert.ok(set.x instanceof Float64Array, 'pozycje świata w double (precyzja przy 5–10 mln j.)');
});

test('boje: rytm błysków z profilu planety (Ziemia Fl 3 s, Mars Fl(2) 5 s)', () => {
  const count = (rhythm, phase = 0) => {
    let n = 0;
    let prev = 0;
    for (let t = 0; t < rhythm.period; t += 0.01) {
      const v = buoyFlash(t, phase, rhythm);
      if (v && !prev) n++;
      prev = v;
    }
    return n;
  };
  assert.equal(count(resolvePortBuildingStyle('earth').buoy), 1);
  assert.equal(count(resolvePortBuildingStyle('mars').buoy), 2);
  assert.equal(count(resolvePortBuildingStyle('jupiter').buoy), 1);
  // faza przesuwa błysk (bieg światła od kotwicy strefy)
  const r = resolvePortBuildingStyle('earth').buoy;
  assert.notEqual(buoyFlash(0.1, 0, r), buoyFlash(0.1, 0.5, r));
});

// ---------------------------------------------------------------------------
function checkScene(sc, label) {
  const fxModes = new Set(Object.values(PB_FX));
  let n = 0;
  for (const [setName, set] of Object.entries(sc.sets)) {
    for (const [kind, data] of Object.entries(set)) {
      assert.equal(data.length % PB_STRIDE, 0, `${label} ${setName}/${kind}`);
      for (let i = 0; i < data.length; i += PB_STRIDE) {
        n++;
        for (let k = 0; k < PB_STRIDE; k++) assert.ok(Number.isFinite(data[i + k]), `${label}: NaN w instancji`);
        const mat = data[i + 7];
        assert.ok(mat >= 0 && mat <= 20 && Number.isInteger(mat), `${label}: materiał ${mat}`);
        assert.ok(data[i + 12] >= 0 && data[i + 12] <= sc.groups.length, `${label}: grupa ${data[i + 12]}`);
        assert.ok(fxModes.has(data[i + 17]), `${label}: tryb efektu ${data[i + 17]}`);
        assert.ok(data[i + 4] > 0 && data[i + 5] > 0 && data[i + 6] > 0, `${label}: rozmiar`);
      }
    }
  }
  assert.ok(sc.groups.length + 1 <= PB_MAX_GROUPS, `${label}: ${sc.groups.length} grup`);
  assert.equal(sc.instances, n);
  for (const p of sc.plates) assert.ok(p.z1 > p.z0 && p.points.length >= 3);
  for (const l of sc.labels) assert.ok(['bg', 'fg', 'roof'].includes(l.set) && l.text && l.width > 0);
  return n;
}

test('sceny: dane instancji skończone, grupy w limicie, style zmieniają wygląd, piasta wg frakcji', () => {
  const hangar = createHangarLayout({ capacity: 472, rows: 2 });
  const counts = {};
  for (const key of STYLES) {
    const style = resolvePortBuildingStyle(key);
    const yard = createShipyardLayout({ hub: style.shipyardHub });
    const four = createShipyardLayout({ hub: style.shipyardHub, slips: 4 });
    const y = buildShipyardScene(yard, style);
    counts[key] = checkScene(y, `stocznia ${key}`);
    checkScene(buildShipyardScene(four, style), `stocznia ×4 ${key}`);
    const h = buildHangarScene(hangar, style);
    checkScene(h, `hangar ${key}`);
    assert.equal(h.rig.drums.length, hangar.drums.length, 'grupa obrotu na każdy bęben');
    assert.equal(y.rig.slips.length, 2);
    assert.ok(y.rig.slips.every((s) => s.crane.bridge && s.crane.trolley && s.crane.hoist && s.crane.cables), 'jeden dźwig z grupami');
    // dźwigi, wieże, kołnierz i rdzeń w FG; pokład, taśma, place w BG
    assert.ok(y.sets.fg.box.length > 0 && y.sets.bg.box.length > y.sets.fg.box.length);
    assert.equal(y.sets.roof.box.length + y.plates.filter((p) => p.set === 'roof').length, 0, 'stocznia bez dachu zanikającego');
    // lampy placów: flagi bitowe kanałów zajętości i refitu (tryb show)
    const fx = [];
    for (const data of Object.values(y.sets.bg)) for (let i = 0; i < data.length; i += PB_STRIDE) fx.push([data[i + 17], data[i + 19]]);
    assert.ok(fx.some(([m, c]) => m === PB_FX.show && c === YARD_CH.padsBusy));
    assert.ok(fx.some(([m, c]) => m === PB_FX.show && c === YARD_CH.padsRefit));
    assert.ok(fx.some(([m]) => m === PB_FX.chase), 'światła biegnące taśmy');
  }
  // Ziemia (okrąg) i Mars / Jowisz (U) — inny kształt; Mars i Jowisz — inne dachy
  assert.notEqual(counts.earth, counts.mars);
  assert.notEqual(counts.mars, counts.jupiter);
  // kanały: 4 pochylnie × 3 + 4 kanały piasty mieszczą się w 16
  assert.equal(YARD_CH.slipBase(3) + 2 < YARD_CH.refitOn, true);
  assert.ok(Math.max(YARD_CH.refitOn, YARD_CH.padsBusy, YARD_CH.belt, YARD_CH.padsRefit) < 16);
});

// ---------------------------------------------------------------------------
const read = (f) => readFileSync(new URL(`../src/3d/portBuildings/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('shadery: TSL bez GLSL, pozycja przez modelViewMatrix (bez viewMatrix * świat), bez renderera', () => {
  for (const f of ['portBuildings3D.js', 'portHullBuild3D.js', 'portBuoys3D.js', 'portBuildings3D.tsl.js', 'portHullBuild3D.tsl.js']) {
    const text = read(f);
    assert.doesNotMatch(text, /new THREE\.WebGLRenderer|WebGLRenderer\(/, `${f}: bez własnego renderera`);
    assert.doesNotMatch(text, /ShaderMaterial|\/\* glsl \*\/|gl_FragColor|gl_Position|haloRingGLSL|SUN_SHADOW_GLSL/, `${f}: bez GLSL (port WebGPU)`);
    // ręczne cameraViewMatrix * modelWorldMatrix omija highPrecision (AGENTS.md: precyzja float32)
    assert.doesNotMatch(text, /cameraViewMatrix\.mul\(\s*modelWorldMatrix/, `${f}: pozycja przez modelViewMatrix`);
  }
  // dane boi przepisywane co klatkę względem początku przy kamerze (AGENTS.md: precyzja float32)
  const buoys = read('portBuoys3D.js');
  assert.match(buoys, /sceneOriginNearCamera\(this\.origin, camera\)/);
  assert.match(buoys, /this\.body\.position\.set\(o\.x, o\.y, 0\)/);
});

// ---------------------------------------------------------------------------
// Render na atrapie (three bez WebGL): siatki, warstwy, grupy ruchome, kanały.
const { Core3D } = await import('../src/3d/core3d.js');
const { PortShipyard3D, PortHangar3D } = await import('../src/3d/portBuildings/portBuildings3D.js');
const { PortBuoys3D } = await import('../src/3d/portBuildings/portBuoys3D.js');

test('render stoczni: warstwy BG/FG, dźwig z pozy roju, kadłub w budowie, lampy placów, rój przez Z5', () => {
  const frame = portModuleFrame(0, 0, -Math.PI / 2);
  const layout = createShipyardLayout({ backZ: 0, hub: 'u' });
  const yard = new PortShipyard3D({ layout, style: 'mars', frame });
  yard.setLayers(1, 2);
  assert.ok(yard.meshes.bg.length >= 3 && yard.meshes.fg.length >= 2);
  for (const m of yard.meshes.bg) assert.ok(m.layers.isEnabled(1) && !m.layers.isEnabled(2));
  for (const m of yard.meshes.fg) assert.ok(m.layers.isEnabled(2));
  assert.equal(yard.root.matrixAutoUpdate, false);
  const G = yard.uniforms.uGroup.value;
  const bridge = yard.rig.slips[0].crane.bridge;
  const trolley = yard.rig.slips[0].crane.trolley;
  const slips = [{ hullId: 'terran_carrier', classId: 'carrier', progress: 0.6 }, null];
  const zs = new Set();
  for (let k = 0; k < 60; k++) {
    yard.update(1, { slips });
    const cr = yard.swarm.cranes[0];
    // macierz mostu = poza dźwigu z roju (z), wózek = x dźwigu
    assert.ok(Math.abs(G[bridge].elements[14] - cr.z) < 1e-6);
    assert.ok(Math.abs(G[trolley].elements[12] - cr.x) < 1e-6);
    zs.add(Math.round(cr.z));
  }
  assert.ok(zs.size > 10, 'dźwig jeździ');
  // kadłub w budowie: czworokąt w wymiarach sprite'a kadłuba
  const hull = yard.hulls[0];
  const size = trafficHullRenderSize('terran_carrier');
  assert.equal(hull.hullLength, size.w);
  assert.equal(hull.hullBeam, size.h);
  // lampy placów: flagi bitowe zajętości / refitu z mapy placów
  const pads = shipyardPads(layout);
  yard.update(0, { pads: { [pads[0].id]: 1, [pads[2].id]: 2 }, refit: [{ pad: pads[2].id, length: 600, beam: 250 }] });
  const chan = (i) => yard.uniforms.uChan.value[i >> 2].getComponent(i & 3);
  assert.equal(chan(YARD_CH.padsBusy), 1 + 4);
  assert.equal(chan(YARD_CH.padsRefit), 4);
  assert.ok(chan(YARD_CH.refitOn) > 0, 'skład refitu pracuje');
  // bez stanu placów w klatce — flagi zostają
  yard.update(0.1, {});
  assert.equal(chan(YARD_CH.padsBusy), 5);
  // rój przez atrapę Z5
  const seen = { drones: 0, crates: 0 };
  const C = { ready: true, setDeckZ() {}, pushBerthContainer() { seen.crates++; return true; } };
  const D = { ready: true, pushDrone() { seen.drones++; return true; } };
  yard.pushCargo(C, D, portModuleCargoPose(frame, { x: 0, y: 0 }));
  assert.equal(seen.drones, yard.swarm.droneCount);
  assert.equal(seen.crates, yard.swarm.crateCount + yard.swarm.carriedCount);
  assert.ok(yard.drawCalls <= 12, `draw calle stoczni: ${yard.drawCalls}`);
  yard.dispose();
});

test('render hangaru: bęben obraca się o gniazdo, kanały zajętości i kolejki', () => {
  const frame = portModuleFrame(0, 0, -Math.PI / 2);
  const layout = createHangarLayout({ capacity: 300 });
  const hangar = new PortHangar3D({ layout, style: 'jupiter', frame });
  const G = hangar.uniforms.uGroup.value;
  const g0 = hangar.rig.drums[0];
  hangar.update(0, { fill: [0.25, 0.5, 0.75], queue: 4, gateIn: 1 });
  const angle = () => Math.atan2(G[g0].elements[8], G[g0].elements[0]);
  const a0 = angle();
  hangar.update(0, { events: [{ drum: 0, dir: 1 }] });
  const step = 2 * Math.PI / layout.drums[0].slots;
  assert.ok(Math.abs(Math.abs(angle() - a0) - step) < 1e-6, 'obrót o jedno gniazdo');
  const chan = hangar.uniforms.uChan.value;
  assert.equal(chan[0].x, 0.25);
  assert.equal(chan[0].y, 0.5);
  assert.equal(chan[2].x, 1, 'brama IN zielona');
  assert.equal(chan[2].y, 4, 'kolejka');
  // zajętość zostaje, gdy klatka jej nie podaje
  hangar.update(0.1, {});
  assert.equal(chan[0].x, 0.25);
  assert.ok(hangar.drawCalls <= 10, `draw calle hangaru: ${hangar.drawCalls}`);
  hangar.dispose();
});

test('render boi: tylko w kadrze, względem początku przy kamerze (7 mln j.)', () => {
  const port = buildHaloPortTrafficLayout(ring, { id: 'earth', x: 7_080_000, y: 6_290_000 });
  const set = buildPortBuoys(buildPortParking(port, null, {}));
  const buoys = new PortBuoys3D({ buoys: set, style: 'earth' });
  buoys.setLayers(1, 2);
  // kadr na pierwszej boi
  const cam = { x: set.x[0], y: set.y[0], zoom: 0.5 };
  const n = buoys.update(cam, { time: 1, viewW: 1920, viewH: 1080 });
  assert.ok(n > 0 && n < set.count, `w kadrze ${n} z ${set.count}`);
  assert.deepEqual([buoys.body.position.x, buoys.body.position.y], [cam.x, -cam.y]);
  const p = buoys._b.iPos.array;
  for (let i = 0; i < n; i++) assert.ok(Math.abs(p[i * 4]) < 5000 && Math.abs(p[i * 4 + 1]) < 5000, 'dane instancji małe (względem początku)');
  assert.ok(buoys.body.layers.isEnabled(1) && buoys.light.layers.isEnabled(2));
  // poza kadrem: zero instancji, siatki ukryte
  assert.equal(buoys.update({ x: 0, y: 0, zoom: 1 }, {}), 0);
  assert.equal(buoys.body.visible, false);
  buoys.dispose();
});

void THREE;
void Core3D;
