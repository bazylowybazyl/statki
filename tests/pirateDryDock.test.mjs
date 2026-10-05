// Suchy dok piratów (misja 1): układ wg szkicu użytkownika i poprawki 2026-10-05 (parking zamknięty
// w prostokącie, okręty burta w burtę, cienkie bramy do taranowania, światła, bez suwnic i bez czaszek), scena
// (bryły Z7), kawałki pod silnik zniszczeń, łańcuch rozpadu, bryły trafień i taranu w układzie gry, plan misji.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRYDOCK_BOW_HEADING, DRYDOCK_DEFAULT_BAYS, createPirateDryDockLayout, dryDockBayClass, dryDockChunkAt,
  dryDockHullFits, dryDockShipPose, planDryDockChain, pointInPoly
} from '../src/3d/portBuildings/pirateDryDockLayout.js';
import { DD_CH, buildPirateDryDockScene } from '../src/3d/portBuildings/pirateDryDockScene.js';
import {
  DRYDOCK_TEST_MODULE, dryDockChunkSolids, dryDockPlanarSolids, dryDockSolidsBounds, dryDockSolidsToTriangles, dryDockTopRaster
} from '../src/3d/portBuildings/pirateDryDockChunks.js';
import { PB_FX, PB_MAX_GROUPS, PB_MAX_LAMPS, PB_STRIDE } from '../src/3d/portBuildings/portBuildingScene.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { k7HeightToZ } from '../src/3d/haloRing/haloPortK7Layout.js';
import {
  SHIPYARD_TUNE, dryDockRamOverlap, dryDockSegmentHit, parkedBeamOf, parkedLengthOf, placeDryDock, planShipyard
} from '../src/game/story/shipyardLayout.js';
import { voxelizeTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';

const l = createPirateDryDockLayout();
const style = resolvePortBuildingStyle('pirate');
const scene = buildPirateDryDockScene(l, style);
const ATLAS = { length: 1800, beam: 806 };

// Zakres wysokości świata bryły (y instancji = środek po k7HeightToZ, sy = wysokość; bez obrotu)
const yRange = (arr, i) => [arr[i + 1] - arr[i + 5] / 2, arr[i + 1] + arr[i + 5] / 2];

test('układ: trzon, po jednej stronie zamknięty parking z 10 okrętami burta w burtę, po drugiej hala jak K-7', () => {
  assert.equal(l.berths.length, 10);
  assert.deepEqual(l.berths.map((b) => b.cls), [...DRYDOCK_DEFAULT_BAYS]);
  const P = l.parking;
  // parking: od lica trzonu (z0) do ogrodzenia (z1), między bramami taranowymi (x0, x1)
  assert.equal(P.z0, l.spine.z1);
  assert.ok(P.x0 > l.spine.x0 && P.x1 < l.spine.x1, 'parking w obrysie trzonu');
  for (const b of l.berths) {
    assert.equal(b.angle, DRYDOCK_BOW_HEADING);
    assert.ok(b.slot.x0 >= P.x0 + l.spec.parking.entry - 1e-6 && b.slot.x1 <= P.x1 - l.spec.parking.exit + 1e-6, b.id);
  }
  // burta w burtę: stanowiska jedno za drugim, odstęp = bayGap
  for (let i = 1; i < l.berths.length; i++) {
    assert.ok(Math.abs(l.berths[i].slot.x0 - l.berths[i - 1].slot.x1 - l.spec.parking.bayGap) < 1e-6);
  }
  // zamknięcie: bramy taranowe na obu końcach, brama w ogrodzeniu przy każdym stanowisku, pylony w narożnikach
  const gates = P.gates;
  assert.deepEqual(gates.filter((g) => g.kind === 'ram').map((g) => g.id), ['G-W', 'G-E']);
  assert.equal(gates.filter((g) => g.kind === 'bay').length, l.berths.length);
  assert.equal(P.pylons.length, 4);
  // hala po stronie −z, brama główna od kosmosu
  const h = l.hall;
  assert.ok(h.backZ <= l.spine.z0 + 1e-6 && h.frontZ < h.bodyEndZ && h.bodyEndZ < h.backZ);
  assert.ok(2 * h.halfWidth > 3800 && h.backZ - h.frontZ > 3200, 'hala ~4 × 4 km');
  const g1 = h.gates.find((g) => g.id === 'G-01');
  assert.ok(Math.abs(g1.z - h.frontZ) < 1e-6 && g1.nz < -0.99, 'G-01 od kosmosu');
  assert.deepEqual(h.gates.map((g) => g.edge).sort(), [0, 1, 5]);
  assert.ok(l.spine.x1 - l.spine.x0 >= 2 * h.halfWidth + 800, 'trzon dłuższy od hali');
});

test('okręty mieszczą się w stanowiskach, stoją środkiem na torze taranu, Atlas mieści się w bramie', () => {
  const P = l.parking;
  for (const b of l.berths) {
    const ship = { length: b.shipLength, beam: parkedBeamOf(b.cls) };
    assert.ok(dryDockHullFits(b, ship), b.id);
    const pose = dryDockShipPose(b, ship.length);
    assert.ok(Math.abs(pose.z - P.laneZ) < 1e-6, `${b.id}: środek na torze`);
    assert.ok(pose.z - ship.length / 2 > P.z0 + 40, `${b.id}: dziób nie w trzonie`);
    assert.ok(pose.z + ship.length / 2 < P.z1 - 60, `${b.id}: rufa przed ogrodzeniem`);
  }
  // pancernik piratów (sprite 720 × 380 z kolcami) mieści się w swoim stanowisku
  const bs = l.berths.find((b) => b.cls === 'battleship');
  assert.ok(bs.slot.x1 - bs.slot.x0 >= 380 && dryDockHullFits(bs, { length: parkedLengthOf('battleship'), beam: 380 }));
  // światło bram końcowych > szerokość Atlasa; Atlas na torze nie dotyka trzonu ani ogrodzenia
  assert.ok(P.gateZ1 - P.gateZ0 > ATLAS.beam + 40, `światło bramy ${P.gateZ1 - P.gateZ0}`);
  assert.ok(Math.abs(P.laneZ - (P.gateZ0 + P.gateZ1) / 2) < 1e-6);
  assert.ok(P.laneZ - ATLAS.beam / 2 > P.z0 + 50 && P.laneZ + ATLAS.beam / 2 < P.z1 - 50);
  // pas Atlasa obejmuje każdy okręt na całej długości
  for (const b of l.berths) {
    const pose = dryDockShipPose(b, b.shipLength);
    assert.ok(pose.z - b.shipLength / 2 >= P.laneZ - ATLAS.beam / 2 - 1e-6 && pose.z + b.shipLength / 2 <= P.laneZ + ATLAS.beam / 2 + 1e-6, b.id);
  }
});

test('wylot z hali: każde pole ma trasę za bramę, skrajne — bramami logistycznymi', () => {
  const h = l.hall;
  for (const p of h.pads) {
    const path = p.launch.path;
    assert.ok(path.length >= 3, p.id);
    const end = path[path.length - 1];
    assert.ok(!pointInPoly(l.hallArea.poly, end.x, end.z), `${p.id}: koniec trasy poza halą`);
    assert.ok(pointInPoly(l.hallArea.poly, path[0].x, path[0].z), `${p.id}: start w hali`);
  }
  assert.equal(h.pads.find((p) => p.id === 'H-M2').launch.gate, 'G-03');
  assert.equal(h.pads.find((p) => p.id === 'H-M5').launch.gate, 'G-02');
  assert.equal(h.pads.find((p) => p.id === 'H-M1').launch.gate, 'G-01');
  assert.equal(h.slips.length, 2, 'dwie pochylnie w hali (pancerniki w budowie)');
});

test('scena: kawałki w grupach w limicie, bez suwnic i czaszek, bramy cienkie przecinają płaszczyznę gry, światła', () => {
  assert.ok(l.chunks.length + 1 <= PB_MAX_GROUPS);
  assert.ok(!l.chunks.some((c) => c.kind === 'crane'), 'bez suwnic');
  const groups = new Set();
  let n = 0;
  for (const set of Object.values(scene.sets)) {
    for (const arr of Object.values(set)) {
      for (let i = 0; i < arr.length; i += PB_STRIDE) {
        groups.add(arr[i + 12]);
        n++;
        for (let k = 0; k < PB_STRIDE; k++) assert.ok(Number.isFinite(arr[i + k]));
      }
    }
  }
  assert.equal(n, scene.instances);
  for (const c of l.chunks) assert.ok(groups.has(c.group), `kawałek ${c.id} bez brył`);
  // bez czaszek: żadnego emblematu w napisach (decyzja użytkownika 2026-10-05)
  assert.ok(!scene.labels.some((q) => q.text === '☠'));
  // bramy (FG): skrzydła cienkie i przecinają płaszczyznę gry (z świata 0) — Atlas w nie trafia
  const fgBox = scene.sets.fg.box;
  for (const g of l.parking.gates) {
    const grp = l.chunkById.get(g.chunk).group;
    let crossing = 0;
    for (let i = 0; i < fgBox.length; i += PB_STRIDE) {
      if (fgBox[i + 12] !== grp) continue;
      const [y0, y1] = yRange(fgBox, i);
      const thin = g.axis === 'z' ? fgBox[i + 4] : fgBox[i + 6];
      if (y0 < -20 && y1 > 20 && thin <= 41) crossing++;
    }
    assert.ok(crossing >= 2, `${g.id}: skrzydła bramy przez płaszczyznę gry (${crossing})`);
  }
  // reflektory: maszty na pylonach i słupach, lampy budowli = reflektory + pochylnie
  assert.equal(l.lights.filter((q) => q.kind === 'flood').length, 6);
  assert.equal(scene.lamps.length, PB_MAX_LAMPS);
  for (const q of l.lights) if (q.chunk) assert.ok(l.chunkById.has(q.chunk), q.chunk);
  // lampki stanowisk: maski bitowe (tryb show) w kanałach 8 / 9
  assert.equal(DD_CH.bays, 8);
  assert.equal(DD_CH.baysFree, 9);
  const shows = [];
  for (const set of Object.values(scene.sets)) {
    for (const arr of Object.values(set)) {
      for (let i = 0; i < arr.length; i += PB_STRIDE) if (arr[i + 17] === PB_FX.show) shows.push([arr[i + 18], arr[i + 19]]);
    }
  }
  assert.equal(shows.filter(([, ch]) => ch === DD_CH.bays).length, l.berths.length);
  assert.equal(shows.filter(([, ch]) => ch === DD_CH.baysFree).length, l.berths.length);
  // trzon: wierzch kręgosłupa ponad płaszczyzną, pokład parkingu (grupa 0) pod nią
  assert.ok(k7HeightToZ(387) > 0 && k7HeightToZ(-154) < 0);
});

test('kawałki pod silnik zniszczeń: koniec parkingu z bramą wokselizuje się, rzut z góry do płaskiej kratownicy', () => {
  const solids = dryDockChunkSolids(l, scene, DRYDOCK_TEST_MODULE);
  assert.ok(solids.length > 300);
  assert.ok(solids.every((s) => DRYDOCK_TEST_MODULE.includes(s.chunk)));
  assert.ok(solids.some((s) => s.kind === 'cone'), 'kolce w bryłach');
  const tri = dryDockSolidsToTriangles(solids, { palette: style.palette });
  assert.ok(tri.count > 1000 && tri.positions.every(Number.isFinite));
  const vox = voxelizeTriangles(tri.positions, tri.colors, { cellSize: 60, shellLayers: 1, interiorMode: 'shell' });
  const st = buildBeamStructure(vox, { frameStride: 2, bulkheadEvery: 0 });
  assert.ok(st.stats.nodes > 500 && st.stats.beams > st.stats.nodes, JSON.stringify(st.stats));
  // płaska kratownica: tylko bryły przecinające płaszczyznę gry (bez rękawów i kołysek pod nią)
  const planar = dryDockPlanarSolids(l, scene, DRYDOCK_TEST_MODULE);
  assert.ok(planar.length > 50 && planar.length < solids.length);
  const b = dryDockSolidsBounds(planar);
  assert.ok(b.y0 <= 25 && b.y1 >= -25);
  const img = dryDockTopRaster(planar, { unitsPerPx: 8, palette: style.palette });
  let opaque = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) opaque++;
  assert.ok(opaque > 1000 && opaque < img.width * img.height, `kratownica ${opaque} px`);
});

test('łańcuch rozpadu: wszystkie kawałki od miejsca trafienia po kotwicach, wybuchy tylko przy dużych', () => {
  const chain = planDryDockChain(l, 'S-3');
  assert.equal(chain.length, l.chunks.length);
  assert.equal(chain[0].id, 'S-3');
  for (let i = 1; i < chain.length; i++) assert.ok(chain[i].t >= chain[i - 1].t);
  const t = (id) => chain.find((c) => c.id === id).t;
  assert.ok(t('S-4') < t('S-E'));
  assert.ok(chain.filter((c) => c.size > 0).length < l.chunks.length / 2, 'nie każdy kawałek wybucha');
  assert.ok(chain.filter((c) => c.kind === 'gate').every((c) => c.size === 0), 'bramy bez wybuchów');
  assert.ok(chain[chain.length - 1].t < 9, 'cały rozpad w kilka sekund');
  const skip = new Set(['S-3', 'R-2']);
  assert.equal(planDryDockChain(l, 'S-3', { skip }).length, l.chunks.length - 2);
  // trafienie w trzon przy stanowisku = odcinek, z którym idzie okręt stanowiska
  for (const b of l.berths) assert.equal(dryDockChunkAt(l, b.x, 0), b.segment, b.id);
});

test('plan misji: 10 okrętów na parkingu (klasy jak stanowiska), tor taranu przez bramy, eskorta w hali', () => {
  assert.deepEqual(SHIPYARD_TUNE.parked.map(dryDockBayClass), [...DRYDOCK_DEFAULT_BAYS]);
  const center = { x: 4_000_000, y: -2_000_000 };
  for (const from of [{ x: 3_000_000, y: -2_000_000 }, { x: 4_500_000, y: -1_300_000 }]) {
    const s = planShipyard(center, from);
    assert.equal(s.parked.length, SHIPYARD_TUNE.parked.length);
    assert.equal(s.defenders.length, SHIPYARD_TUNE.defenders.length + (SHIPYARD_TUNE.flagship ? 1 : 0));
    assert.equal(s.turrets.length, SHIPYARD_TUNE.turrets);
    const dock = s.dock;
    const g = dock.toGame(1234, -567);
    const hb = dock.toHub(g.x, g.y);
    assert.ok(Math.abs(hb.x - 1234) < 1e-6 && Math.abs(hb.z + 567) < 1e-6);
    const P = dock.layout.parking;
    for (const p of s.parked) {
      const h = dock.toHub(p.x, p.y);
      assert.ok(h.x > P.x0 && h.x < P.x1 && h.z > P.z0 && h.z < P.z1, 'okręt na parkingu');
      const want = Math.atan2(-dock.n.y, -dock.n.x);
      assert.ok(Math.abs(Math.atan2(Math.sin(p.angle - want), Math.cos(p.angle - want))) < 1e-9, 'dziobem ku trzonowi');
    }
    // tor taranu: start przed bramą G-W, koniec za G-E, przez środek każdego okrętu
    const a = dock.toHub(s.rowStart.x, s.rowStart.y);
    const e = dock.toHub(s.rowEnd.x, s.rowEnd.y);
    assert.ok(a.x < P.x0 && e.x > P.x1 && Math.abs(a.z - P.laneZ) < 1e-6 && Math.abs(e.z - P.laneZ) < 1e-6);
    const ax = s.rowEnd.x - s.rowStart.x;
    const ay = s.rowEnd.y - s.rowStart.y;
    const len = Math.hypot(ax, ay);
    for (const p of s.parked) {
      const off = Math.abs(((p.x - s.rowStart.x) * ay - (p.y - s.rowStart.y) * ax) / len);
      assert.ok(off < 1, `okręt ${p.key} poza osią toru (${off.toFixed(1)})`);
    }
    for (const d of s.defenders) {
      assert.ok(dock.inHall(d.x, d.y), 'eskorta na polu hali');
      const end = d.launch[d.launch.length - 1];
      assert.ok(!dock.inHall(end.x, end.y));
    }
    assert.ok(dock.distance(s.rally.x, s.rally.y) > 9000);
    assert.ok(dock.distance(s.warpIn.x, s.warpIn.y) > 50000);
  }
});

test('trafienia: trzon na licu, przelot nad halą — pudło, odpadły kawałek przepuszcza pocisk', () => {
  const dock = placeDryDock({ x: 0, y: 0 }, 0.3);
  const b3 = l.berths[2];
  // strzał w poprzek parkingu ku trzonowi między okrętami (nad bramą stanowiska) — najpierw brama, potem trzon
  const a = dock.toGame(b3.x, 3000);
  const b = dock.toGame(b3.x, -200);
  const hit = dryDockSegmentHit(dock.hitShapes, a.x, a.y, b.x, b.y);
  assert.ok(hit);
  assert.equal(hit.chunk, b3.gate, 'brama stanowiska w ogrodzeniu');
  // brama i ogrodzenie staranowane / odpadłe → pocisk leci do trzonu
  const gone = new Set([b3.gate]);
  const hit2 = dryDockSegmentHit(dock.hitShapes, a.x, a.y, b.x, b.y, {}, gone);
  assert.equal(hit2.chunk, b3.segment);
  const hh = dock.toHub(hit2.x, hit2.y);
  assert.ok(Math.abs(hh.z - l.spine.z1) < 1e-6, 'punkt wejścia na licu trzonu');
  // odcinek w środku hali (między ścianami) nie trafia w ściany, ale przelatuje przez obszar hali (Hexlance)
  const c = dock.toGame(0, -1500);
  const d = dock.toGame(300, -2500);
  assert.equal(dryDockSegmentHit(dock.hitShapes, c.x, c.y, d.x, d.y), null);
  assert.ok(dryDockSegmentHit([dock.hallArea], c.x, c.y, d.x, d.y));
  // przelot przez bramę G-01 (oś hali) nie dotyka ościeży
  const e = dock.toGame(0, l.hall.frontZ - 800);
  const f = dock.toGame(0, l.hall.frontZ + 900);
  assert.equal(dryDockSegmentHit(dock.hitShapes, e.x, e.y, f.x, f.y), null);
  // przelot torem taranu przez parking: tylko bramy taranowe na końcach (okręty to nie bryły doku)
  const s0 = dock.toGame(l.parking.x0 - 500, l.parking.laneZ);
  const s1 = dock.toGame(l.parking.x1 + 500, l.parking.laneZ);
  assert.equal(dryDockSegmentHit(dock.hitShapes, s0.x, s0.y, s1.x, s1.y).chunk, 'G-W');
  assert.equal(dryDockSegmentHit(dock.hitShapes, s0.x, s0.y, s1.x, s1.y, {}, new Set(['G-W'])).chunk, 'G-E');
});

test('taran: kadłub Atlasa na torze rozbija samą bramę, zjechany ku trzonowi — też pylon; pominięte kawałki', () => {
  const axis = 0.7;
  const dock = placeDryDock({ x: 1_000_000, y: 500_000 }, axis);
  const P = l.parking;
  const out = [];
  const at = (x, z) => dock.toGame(x, z);
  // dziób Atlasa 60 j. za linią bramy G-W, kurs wzdłuż osi (+x układu)
  let c = at(P.x0 + 60 - ATLAS.length / 2, P.laneZ);
  assert.equal(dryDockRamOverlap(dock.ramShapes, c.x, c.y, axis, ATLAS.length / 2, ATLAS.beam / 2, null, out), 1);
  assert.deepEqual(out, ['G-W']);
  // przed bramą — nic
  c = at(P.x0 - 80 - ATLAS.length / 2, P.laneZ);
  assert.equal(dryDockRamOverlap(dock.ramShapes, c.x, c.y, axis, ATLAS.length / 2, ATLAS.beam / 2, null, out), 0);
  // zjechany ku trzonowi o 120 — brama i pylon ramy (Q-W)
  c = at(P.x0 + 60 - ATLAS.length / 2, P.laneZ - 120);
  dryDockRamOverlap(dock.ramShapes, c.x, c.y, axis, ATLAS.length / 2, ATLAS.beam / 2, null, out);
  assert.deepEqual(out.slice().sort(), ['G-W', 'Q-W']);
  // brama już staranowana — pominięta
  c = at(P.x0 + 60 - ATLAS.length / 2, P.laneZ);
  assert.equal(dryDockRamOverlap(dock.ramShapes, c.x, c.y, axis, ATLAS.length / 2, ATLAS.beam / 2, new Set(['G-W']), out), 0);
  // w środku parkingu na torze — żadnej bryły taranu (okręty liczy gra osobno)
  c = at(0, P.laneZ);
  assert.equal(dryDockRamOverlap(dock.ramShapes, c.x, c.y, axis, ATLAS.length / 2, ATLAS.beam / 2, null, out), 0);
  // trzon nie jest bryłą taranu
  assert.ok(!dock.ramShapes.some((s) => s.chunk.startsWith('S-')));
});
