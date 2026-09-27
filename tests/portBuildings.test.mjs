// Budowle portowe (Z7): stocznia z suchym dokiem, hangar postojowy, boje redy.
// Układy (czysta matematyka), adapter do ruchu v2, kolizje, dane scen i render
// na atrapie bez WebGL. node --test tests/portBuildings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { K7_ATLAS, K7_HEIGHTS, k7BoxPoly, k7ConvexOverlap, k7Frame } from '../src/3d/haloRing/haloPortK7Layout.js';
import { buildHaloPortTrafficLayout } from '../src/3d/haloRing/haloPortTraffic.js';
import { WARSHIP_CLASSES } from '../src/game/traffic/shipyards.js';
import { BERTH_ROLE, findBerth, hullFitsBerth, hullFootprint } from '../src/game/traffic/dockLayout.js';
import { buildPortParking, createParkingRegistry, syncParking } from '../src/game/traffic/portParking.js';
import { trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { PORT_PALETTE_SIZE, resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import {
  HULL_BUILD_STAGES,
  SHIPYARD_ATLAS,
  SHIPYARD_SPEC,
  createShipyardLayout,
  hullBuildFront,
  hullBuildStage,
  shipyardDrydockBerth,
  shipyardHullFits,
  shipyardSolidList,
  slipStatesFromYard
} from '../src/3d/portBuildings/portShipyardLayout.js';
import { HANGAR_SPEC, createHangarLayout, hangarQueuePoint, hangarSolidList, planHangarCapacity } from '../src/3d/portBuildings/portHangarLayout.js';
import {
  PORT_SERVICE_ROLE,
  buildPortModuleCollision,
  portGameToHub,
  portHeadingToGame,
  portHubToGame,
  portModuleFootprintGame,
  portModuleFrame,
  portModuleTraffic,
  portRingModuleFrame,
  setPortModuleDoorsOpen
} from '../src/3d/portBuildings/portModuleTraffic.js';
import { BUOY_KIND, BUOY_ROLE, buildPortBuoys, buoyFlash } from '../src/3d/portBuildings/portBuoyLayout.js';
import { PB_FX, PB_MAX_GROUPS, PB_STRIDE, buildHangarScene, buildShipyardScene } from '../src/3d/portBuildings/portBuildingScene.js';

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
test('stocznia: 2 pochylnie + suchy dok, stanowiska w formacie K-7', () => {
  const l = createShipyardLayout({ id: 'Y-1' });
  assert.equal(l.slips.length, 2, 'SHIPYARD_MODEL.slots = 2 pochylnie');
  assert.ok(l.drydock);
  assert.deepEqual(l.berths.map((b) => [b.size, b.kind]), [['SLIP', 'slip'], ['SLIP', 'slip'], ['CAPITAL', 'drydock']]);
  for (const b of l.berths) {
    for (const k of K7_FIELDS) assert.ok(b[k] !== undefined, `${b.id}: brak pola ${k}`);
    assert.ok(b.approach || b.launch, `${b.id}: podejście / zejście`);
    assert.ok(b.x - b.width / 2 >= l.x0 - 1e-6 && b.x + b.width / 2 <= l.x1 + 1e-6, `${b.id} poza obrysem w x`);
    assert.ok(b.z - b.length / 2 >= l.backZ && b.z + b.length / 2 <= l.frontZ, `${b.id} poza obrysem w z`);
  }
  // pochylnia: dziobem w kosmos (+z); suchy dok: dziobem do ściany tylnej (jak capital K-7)
  assert.ok(Math.abs(l.berths[0].angle - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(shipyardDrydockBerth(l).angle + Math.PI / 2) < 1e-9);
  // warianty: 4 pochylnie bez doku, sam suchy dok
  const four = createShipyardLayout({ slips: 4, drydock: false });
  assert.equal(four.slips.length, 4);
  assert.equal(four.drydock, null);
  const dockOnly = createShipyardLayout({ slips: 0 });
  assert.equal(dockOnly.slips.length, 0);
  assert.ok(dockOnly.drydock);
  assert.equal(dockOnly.workshop, null);
});

test('stocznia: każda klasa okrętu mieści się na pochylni, Atlas w suchym doku', () => {
  const l = createShipyardLayout({});
  for (const cls of Object.values(WARSHIP_CLASSES)) {
    const fp = hullFootprint(cls.hull);
    for (const b of l.berths.filter((v) => v.kind === 'slip')) {
      assert.ok(shipyardHullFits(b, { length: fp.length, beam: fp.width }), `${cls.id} (${fp.length} × ${fp.width}) na ${b.id}`);
      // sprite kadłuba (render) też mieści się na polu
      const size = trafficHullRenderSize(cls.hull);
      assert.ok(size.w <= b.padLength && size.h <= b.padBeam, `sprite ${cls.hull} na polu ${b.id}`);
    }
  }
  const dock = shipyardDrydockBerth(l);
  assert.deepEqual(SHIPYARD_ATLAS, { length: K7_ATLAS.w, beam: K7_ATLAS.h });
  assert.ok(shipyardHullFits(dock, SHIPYARD_ATLAS), 'Atlas 1800 × 806 w suchym doku');
  // standard pola capital K-7 (maxLength 2050, maxBeam 1030)
  assert.equal(dock.maxLength, 2050);
  assert.equal(dock.maxBeam, 1030);
  assert.ok(dock.padLength >= K7_ATLAS.w + 300 && dock.padBeam >= K7_ATLAS.h + 300);
  assert.ok(dock.x - dock.padBeam / 2 >= l.drydock.x - l.drydock.halfWidth && dock.x + dock.padBeam / 2 <= l.drydock.x + l.drydock.halfWidth);
});

test('stocznia: pola rozłączne, bryły nie wchodzą na pola, pas zejścia i wjazd do doku wolne', () => {
  for (const opts of [{}, { slips: 4, drydock: false }, { slips: 1 }]) {
    const l = createShipyardLayout(opts);
    for (let i = 0; i < l.berths.length; i++) {
      for (let j = i + 1; j < l.berths.length; j++) {
        assert.ok(!k7ConvexOverlap(padPoly(l.berths[i]), padPoly(l.berths[j])), `${l.berths[i].id} × ${l.berths[j].id}`);
      }
    }
    const solids = shipyardSolidList(l).filter(inShipBand);
    // zejście nosiciela (najszerszy) z pochylni prosto w kosmos
    const carrier = hullFootprint(WARSHIP_CLASSES.carrier.hull);
    for (const b of l.berths.filter((v) => v.kind === 'slip')) {
      const lane = lanePoly(b.x, b.z - carrier.length / 2, b.launch.to.z, carrier.width + 20);
      for (const s of solids) assert.ok(!k7ConvexOverlap(lane, solidPoly(s)), `zejście ${b.id} przez ${s.id}`);
    }
    const dock = l.berths.find((v) => v.kind === 'drydock');
    if (!dock) continue;
    // wjazd Atlasa z przedpola na pole — skrzydła drzwi (door) zamknięte blokują, otwarte nie
    const lane = lanePoly(dock.x, dock.z - K7_ATLAS.w / 2, dock.approach.from.z, K7_ATLAS.h + 20);
    const blocking = solids.filter((s) => k7ConvexOverlap(lane, solidPoly(s)));
    assert.ok(blocking.length > 0 && blocking.every((s) => s.door), `wjazd do doku blokują tylko drzwi: ${blocking.map((s) => s.id)}`);
  }
});

test('suwnice: żaden profil nie grubszy niż 1/20 rozpiętości mostu', () => {
  const l = createShipyardLayout({});
  for (const s of l.slips) {
    const g = s.gantry;
    for (const p of [g.leg, g.girder, g.girderH]) assert.ok(p <= g.span / 20 + 1e-9, `pochylnia ${s.id}: ${p} > ${g.span}/20`);
    // most wisi nad płaszczyzną gry (FG), nogi stoją poza polem (kadłub między nimi)
    assert.ok(g.legTop > K7_HEIGHTS.hullTop + 200);
    assert.ok(g.span / 2 > s.padBeam / 2);
  }
  const G = l.drydock.gantry;
  for (const p of [G.girder, G.girderH]) assert.ok(p <= G.span / 20 + 1e-9, `suchy dok: ${p} > ${G.span}/20`);
  for (const t of l.towers) assert.ok(t.mast <= t.jib / 20 + 1e-9, 'żuraw: maszt ≤ wysięgnik / 20');
  assert.equal(SHIPYARD_SPEC.slip.maxBeam, 480);
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
test('adapter: suchy dok = stanowisko roli service (findBerth), pochylnie i hangar w układzie gry', () => {
  const l = createShipyardLayout({ id: 'Y-1' });
  const station = { id: 'saturn', x: 5_100_000, y: -2_300_000 };
  const frame = portModuleFrame(-4000, 9000, -Math.PI / 2);
  const t = portModuleTraffic(l, { frame, station, stationId: 'saturn' });
  assert.equal(t.docks.length, 1);
  assert.equal(t.yards.length, 2);
  const dock = t.docks[0];
  assert.equal(dock.role, PORT_SERVICE_ROLE);
  const berth = dock.berths[0];
  const src = shipyardDrydockBerth(l);
  const g = portHubToGame(frame, station, src.x, src.z);
  assert.ok(Math.abs(berth.x - g.x) < 1e-6 && Math.abs(berth.y - g.y) < 1e-6);
  assert.ok(Math.abs(berth.angle - portHeadingToGame(frame, src.angle)) < 1e-9);
  assert.equal(berth.cls, 'capital');
  assert.ok(hullFitsBerth(berth, 'terran_carrier'));
  const layout = { stationId: 'saturn', docks: t.docks, berths: t.docks.flatMap((d) => d.berths) };
  assert.equal(findBerth(layout, 'terran_carrier', 0, { role: PORT_SERVICE_ROLE })?.berth, berth);
  assert.equal(findBerth(layout, 'terran_carrier', 0, { role: BERTH_ROLE.MILITARY }), null, 'zapas floty nie staje w suchym doku');
  assert.equal(findBerth(layout, 'container_ship', 0, { role: BERTH_ROLE.CIVIL }), null, 'kurs cywilny nie staje w suchym doku');
  // pochylnia: kurs zejścia = dziób w kosmos (+z układu → w grze +y przy kącie −π/2)
  const yardA = t.yards[0];
  assert.ok(Math.abs(yardA.angle - Math.PI / 2) < 1e-9);
  assert.ok(yardA.launchY > yardA.y);
  // odwrotność: gra → układ
  const back = portGameToHub(frame, station, berth.x, berth.y);
  assert.ok(Math.abs(back.x - src.x) < 1e-6 && Math.abs(back.z - src.z) < 1e-6);
  // bryły w grze z zakresem wysokości
  assert.ok(t.solids.length > 5 && t.solids.every((s) => s.points.length === 4 && s.y1 > s.y0));
  assert.equal(t.solids.filter((s) => s.door).length, 2);
});

test('adapter na ringu: ramka k7Frame z obrotem grupy (Mars −π), tył na płycie podłogi', () => {
  const l = createShipyardLayout({ id: 'Y-R' });
  const theta = 0.55;
  const plain = portRingModuleFrame(ring, theta);
  const ref = k7Frame(ring, theta);
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

test('kolizje: zamknięte drzwi suchego doku blokują wjazd, otwarte przepuszczają', () => {
  const l = createShipyardLayout({});
  const col = buildPortModuleCollision(l);
  const dock = shipyardDrydockBerth(l);
  assert.equal(col.doors.length, 2);
  // Atlas na osi pasa, dziobem w dok, w otworze drzwi
  const hull = k7BoxPoly(dock.x, l.drydock.door.z, K7_ATLAS.h - 40, 600);
  assert.ok(String(col.test(hull)).startsWith('DOOR'), 'drzwi zamknięte');
  setPortModuleDoorsOpen(col, true);
  assert.equal(col.test(hull), null, 'drzwi otwarte');
  setPortModuleDoorsOpen(col, false);
  assert.ok(col.test(hull));
  // ściany boczne doku zatrzymują kadłub przesunięty w bok
  setPortModuleDoorsOpen(col, true);
  assert.ok(col.test(k7BoxPoly(dock.x + l.drydock.halfWidth, dock.z, 400, 600)));
  const hc = buildPortModuleCollision(createHangarLayout({ capacity: 200 }));
  assert.equal(hc.doors.length, 0);
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

test('sceny: dane instancji skończone, grupy w limicie, style zmieniają wygląd, nie układ', () => {
  const yard = createShipyardLayout({});
  const four = createShipyardLayout({ slips: 3 });
  const hangar = createHangarLayout({ capacity: 472, rows: 2 });
  const counts = {};
  for (const key of STYLES) {
    const style = resolvePortBuildingStyle(key);
    const y = buildShipyardScene(yard, style);
    counts[key] = checkScene(y, `stocznia ${key}`);
    checkScene(buildShipyardScene(four, style), `stocznia ×3 ${key}`);
    const h = buildHangarScene(hangar, style);
    checkScene(h, `hangar ${key}`);
    assert.equal(h.rig.drums.length, hangar.drums.length, 'grupa obrotu na każdy bęben');
    assert.equal(y.rig.slips.length, 2);
    assert.equal(y.rig.dock.doors.length, 6, '3 skrzydła drzwi na stronę');
    // dach suchego doku w zestawie roof (zanika), mosty suwnic w FG
    assert.ok(y.sets.roof.box.length > 0 || y.plates.some((p) => p.set === 'roof'));
    assert.ok(y.sets.fg.box.length > 0);
  }
  // rodziny mają inne dachy (liczba brył różna), układ stanowisk ten sam
  assert.notEqual(counts.earth, counts.mars);
  assert.notEqual(counts.mars, counts.jupiter);
});

// ---------------------------------------------------------------------------
const read = (f) => readFileSync(new URL(`../src/3d/portBuildings/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const glslBlocks = (text) => [...text.matchAll(/\/\* glsl \*\/`([\s\S]*?)`/g)].map((m) => m[1]);

test('shadery: komentarze ASCII, pozycja przez modelViewMatrix (bez viewMatrix * świat), bez renderera', () => {
  let blocks = 0;
  for (const f of ['portBuildings3D.js', 'portHullBuild3D.js', 'portBuoys3D.js']) {
    const text = read(f);
    assert.doesNotMatch(text, /new THREE\.WebGLRenderer|WebGLRenderer\(/, `${f}: bez własnego renderera`);
    for (const body of glslBlocks(text)) {
      blocks++;
      for (const line of body.split('\n')) assert.ok(!/[^\x00-\x7F]/.test(line), `${f}: nie-ASCII w GLSL: ${line.trim()}`);
      for (const m of body.matchAll(/gl_Position\s*=\s*([^;]+);/g)) {
        const expr = m[1];
        if (/^vec4\(2\.0/.test(expr)) continue;
        assert.match(expr, /projectionMatrix \* (modelViewMatrix|mv)\b/, `${f}: gl_Position = ${expr}`);
      }
    }
  }
  assert.ok(blocks >= 8);
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

test('render stoczni: warstwy BG/FG, suwnica idzie za czołem budowy, dach zanika, drzwi w kieszeniach', () => {
  const frame = portModuleFrame(0, 0, -Math.PI / 2);
  const yard = new PortShipyard3D({ layout: createShipyardLayout({ backZ: 0 }), style: 'mars', frame });
  yard.setLayers(1, 2);
  assert.ok(yard.meshes.bg.length >= 3 && yard.meshes.fg.length >= 2 && yard.meshes.roof.length >= 1);
  for (const m of yard.meshes.bg) assert.ok(m.layers.isEnabled(1) && !m.layers.isEnabled(2));
  for (const m of [...yard.meshes.fg, ...yard.meshes.roof]) assert.ok(m.layers.isEnabled(2));
  assert.equal(yard.root.matrixAutoUpdate, false);
  const G = yard.uniforms.uGroup.value;
  const bridgeA = yard.rig.slips[0].gantries[0].bridge;
  const zAt = (p) => {
    yard.update(0, { slips: [{ hullId: 'terran_carrier', classId: 'carrier', progress: p }, null] });
    return G[bridgeA].elements[14];
  };
  const z1 = zAt(0.4);
  const z2 = zAt(0.8);
  assert.ok(z2 > z1, `suwnica A za czołem poszycia: ${z1} → ${z2}`);
  // kadłub w budowie: czworokąt w wymiarach sprite'a kadłuba
  const hull = yard.hulls[0];
  const size = trafficHullRenderSize('terran_carrier');
  assert.equal(hull.hullLength, size.w);
  assert.equal(hull.hullBeam, size.h);
  // dach suchego doku: zanik (statek w środku) chowa siatki dachu
  yard.update(0, { drydock: { doors: 1, roofFade: 1, work: 1 } });
  assert.ok(yard.meshes.roof.every((m) => !m.visible));
  yard.update(0, { drydock: { doors: 0, roofFade: 0, work: 0 } });
  assert.ok(yard.meshes.roof.every((m) => m.visible));
  // drzwi: skrzydło przesuwa się o (openX − closedX) przy pełnym otwarciu
  yard.update(0, { drydock: { doors: 1, roofFade: 0 } });
  const leaf = yard.rig.dock.doors.find((d) => d.leaf === 2);
  assert.ok(Math.abs(G[leaf.group].elements[12] - (leaf.openX - leaf.closedX)) < 1e-6);
  assert.ok(yard.drawCalls <= 16, `draw calle stoczni: ${yard.drawCalls}`);
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
