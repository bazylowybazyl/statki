import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeGameCameraHeight,
  computeHaloRingLayout,
  createHaloRingLayout,
  habitatVisibleStripBrief,
  riverCenterV
} from '../src/3d/haloRing/haloRingLayout.js';
import { HALO_STATION_ANGLE, HALO_TAU } from '../src/3d/haloRing/haloRingConfig.js';
import { computePlanetaryRingLayout } from '../src/3d/planetaryRing3D.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

test('obwiednia Halo = obwiednia obecnego ringu (port nie rusza stref orbit)', () => {
  for (const planet of [{ id: 'earth' }, { id: 'mars' }, 37800, 30000]) {
    assert.deepEqual(computeHaloRingLayout(planet), computePlanetaryRingLayout(planet));
  }
  const earth = computePlanetaryRingLayout({ id: 'earth' });
  assert.equal(earth.innerRadius, 41202);
  assert.equal(earth.outerRadius, 43752);
});

test('habitat domyślnie w stronę kosmosu; oba warianty w obwiedni 41 202–43 752', () => {
  const outward = createHaloRingLayout({ planetRadius: 37800, seed: 1337 });
  assert.equal(outward.facing, 'outward');
  assert.equal(outward.sigma, 1);
  assert.equal(outward.radii.rim, 43752, 'krawędź ścian na zewnętrznej granicy obwiedni');
  near(outward.radii.floorMid, 42252, 1, 'podłoga');
  near(outward.radii.back, 41800, 1, 'kadłub od strony planety');
  const inward = createHaloRingLayout({ planetRadius: 37800, seed: 1337, habitatFacing: 'inward' });
  assert.equal(inward.sigma, -1);
  assert.equal(inward.radii.hull, 43752);
  near(inward.radii.floorMid, 43300, 1, 'podłoga (Halo)');
  near(inward.radii.rim, 41800, 1, 'krawędź ścian (Halo)');
  for (const layout of [outward, inward]) {
    assert.ok(layout.radii.min >= 41202 && layout.radii.max <= 43752);
    assert.ok(layout.bounds.insideEnvelope);
  }
  // układ M1–M5 (i Halo): cała wstęga pod płaszczyzną gry
  const roofOut = createHaloRingLayout({ planetRadius: 37800, seed: 1337, flightLevel: 'roof' });
  assert.equal(inward.flightLevel, 'roof', 'Halo domyślnie pod płaszczyzną');
  for (const layout of [roofOut, inward]) {
    assert.equal(layout.z.bottom, -layout.width);
    assert.ok(layout.z.roof <= 0, 'płyta dachu nie może wyjść nad z = 0');
    assert.ok(layout.z.roof + layout.roofDetailMax <= 1e-9, 'detale dachu sięgają najwyżej z = 0');
    for (const v of layout.profile.vertices) assert.ok(v.z <= 0 && v.z >= -layout.width);
    assert.equal(layout.planetCenterZ, -layout.width / 2);
  }
  // punkt nad podłogą (h > 0) leży w powietrzu po stronie σ·r̂
  const p = outward.floorPoint(1000, outward.floor.length / 2, 300, {});
  assert.ok(outward.isInsideAir(p.x, p.y, p.z));
  near(outward.worldToFloor(p.x, p.y, p.z).alt, 300, 1e-6, 'wysokość nad podłogą');
  assert.ok(Math.hypot(p.x, p.y) > outward.radii.floorMid, 'na zewnątrz: w górę = od planety');
  const q = inward.floorPoint(1000, inward.floor.length / 2, 300, {});
  assert.ok(inward.isInsideAir(q.x, q.y, q.z));
  assert.ok(Math.hypot(q.x, q.y) < inward.radii.floorMid, 'Halo: w górę = ku planecie');
});

test('płaszczyzna gry na środku podłogi (decyzja użytkownika 2026-09-23)', () => {
  const L = createHaloRingLayout({});
  assert.equal(L.flightLevel, 0.5, 'domyślnie środek wstęgi');
  near(L.z.floorMid, 0, 1e-9, 'środek podłogi w płaszczyźnie gry');
  near(L.z.topIn, -L.z.botIn, 1e-9, 'podłoga symetrycznie nad i pod płaszczyzną');
  near(L.planetCenterZ, 0, 1e-9, 'planeta równikowo, środek w płaszczyźnie gry');
  near(L.z.top - L.z.bottom, L.width, 1e-9, 'szerokość wstęgi bez zmian');
  assert.equal(L.bounds.zMax, L.z.top);
  assert.equal(L.bounds.zMin, L.z.bottom);
  // ten sam profil, przesunięty tylko w Z
  const roof = createHaloRingLayout({ flightLevel: 'roof' });
  for (let i = 0; i < L.profile.vertices.length; i++) {
    near(L.profile.vertices[i].r, roof.profile.vertices[i].r, 1e-9, 'r wierzchołka');
    near(L.profile.vertices[i].z - roof.profile.vertices[i].z, L.zShift, 1e-9, 'z wierzchołka');
  }
  // punkt 300 j. nad podłogą w z = 0: w powietrzu habitatu, w połowie szerokości
  const f = L.worldToFloor(L.radii.floorMid + 300, 0, 0);
  near(f.alt, 300, 1e-6, 'wysokość nad podłogą');
  near(f.v, 0.5, 1e-9, 'v = 0,5');
  assert.ok(L.isInsideAir(L.radii.floorMid + 300, 0, 0));
  // flightLevel 0 = płaszczyzna przy górnej ścianie, 1 = przy dolnej
  near(createHaloRingLayout({ flightLevel: 0 }).z.topIn, 0, 1e-9, 'flightLevel 0');
  near(createHaloRingLayout({ flightLevel: 1 }).z.botIn, 0, 1e-9, 'flightLevel 1');
});

test('suwak ścian 800–2100: 2100 dochodzi do wewnętrznej krawędzi obwiedni', () => {
  for (const habitatFacing of ['outward', 'inward']) {
    const tall = createHaloRingLayout({ wallHeight: 2100, habitatFacing });
    near(tall.radii.min, 41200, 1, `${habitatFacing}: dół bryły przy 2100`);
    assert.ok(tall.radii.min < tall.envelope.innerRadius, '2100 wychodzi 2 j. poza obwiednię — suwak kończy się na granicy');
    const low = createHaloRingLayout({ wallHeight: 800, habitatFacing });
    assert.ok(low.bounds.insideEnvelope);
  }
  const clamped = createHaloRingLayout({ wallHeight: 5000 });
  assert.equal(clamped.wallHeight, 2100);
});

test('profil przekroju jest domknięty, zgodny z ruchem wskazówek i ma normalne na zewnątrz', () => {
  for (const habitatFacing of ['outward', 'inward']) {
    for (const tilt of [0, 8, 15]) {
      const layout = createHaloRingLayout({ floorTiltDeg: tilt, habitatFacing });
      const sigma = layout.sigma;
      const { vertices, edges } = layout.profile;
      assert.equal(edges.length, vertices.length);
      for (let i = 0; i < edges.length; i++) {
        const next = edges[(i + 1) % edges.length];
        assert.deepEqual(edges[i].b, next.a, `krawędź ${i} łączy się z ${i + 1}`);
        near(Math.hypot(edges[i].normal.r, edges[i].normal.z), 1, 1e-9, 'normalna jednostkowa');
        assert.ok(edges[i].length > 0);
      }
      // pole ze wzoru shoelace w (r, z): ujemne = zgodnie z ruchem wskazówek
      let area2 = 0;
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        area2 += a.r * b.z - b.r * a.z;
      }
      assert.ok(area2 < 0, 'profil obchodzony zgodnie z ruchem wskazówek zegara');
      const byKind = Object.fromEntries(edges.map((e) => [e.kind, e.normal]));
      assert.ok(sigma * byKind.floor.r > 0.9, 'podłoga patrzy w stronę σ·r̂ (w górę dla mieszkańców)');
      assert.ok(byKind.roof.z > 0.99, 'dach patrzy w +Z (kamera gry)');
      assert.ok(-sigma * byKind.hull.r > 0.99, 'kadłub patrzy w przeciwną stronę niż habitat');
      assert.ok(byKind.wallBottomInner.z > 0.99, 'dolna ściana od środka patrzy w +Z (§5.5)');
      assert.ok(byKind.wallTopInner.z < -0.99, 'górna ściana od środka patrzy w −Z');
      assert.ok(byKind.underside.z < -0.99);
      assert.ok(sigma * byKind.rimTop.r > 0.99 && sigma * byKind.rimBottom.r > 0.99, 'krawędzie ścian patrzą w otwartą stronę');
      near(byKind.floor.r, layout.floor.normal.r, 1e-9, 'normalna podłogi w layoucie');
      if (tilt > 0) {
        assert.ok(byKind.floor.z > 0, 'pochylona podłoga odwraca się ku kamerze gry');
        assert.ok(sigma * (layout.radii.floorTop - layout.radii.back) >= 250 - 1e-6, 'kadłub pod pochyloną podłogą ≥ 250');
      }
    }
  }
});

test('sektory pokrywają 360° bez dziur i zakładek, port leży pod kątem stacji', () => {
  for (const count of [8, 12, 16, 24]) {
    const layout = createHaloRingLayout({ sectorCount: count, seed: 7 });
    assert.equal(layout.sectors.length, count);
    let total = 0;
    for (let i = 0; i < count; i++) {
      const a = layout.sectors[i];
      const b = layout.sectors[(i + 1) % count];
      total += a.span;
      const gap = ((b.startAngle - a.endAngle) % HALO_TAU + HALO_TAU) % HALO_TAU;
      assert.ok(gap < 1e-9 || HALO_TAU - gap < 1e-9, `szczelina między sektorami ${i} i ${i + 1}`);
      // sąsiednie krajobrazy wolno (morze → Alpy), ale o różnym biomie
      assert.notEqual(`${a.type}:${a.biome || ''}`, `${b.type}:${b.biome || ''}`, 'dwa identyczne sąsiednie sektory');
    }
    near(total, HALO_TAU, 1e-9, 'suma kątów');
    for (let k = 0; k < 720; k++) {
      const theta = k / 720 * HALO_TAU;
      const idx = layout.sectorIndexAt(theta);
      assert.ok(idx >= 0 && idx < count);
      const blend = layout.sectorBlendAt(theta);
      near(blend.reduce((s, e) => s + e.weight, 0), 1, 1e-9, 'wagi przejść sumują się do 1');
    }
    const port = layout.sectors[layout.sectorIndexAt(HALO_STATION_ANGLE)];
    assert.ok(port.port, 'sektor pod kątem stacji ma port');
    // przemysł tylko wokół doków (poprawka użytkownika 2026-09-23): żadnego sektora przemysłowego
    assert.ok(layout.sectors.every((s) => s.type !== 'industrial'), `sektor przemysłowy przy ${count} sektorach`);
    assert.equal(port.type, 'landscape', 'sektor portu: krajobraz (góry wokół doków)');
  }
  const plan = createHaloRingLayout({ sectorCount: 16 }).sectors;
  const counts = plan.reduce((acc, s) => ({ ...acc, [s.type]: (acc[s.type] || 0) + 1 }), {});
  assert.deepEqual(counts, { landscape: 7, garden: 5, glass: 4 });
});

test('ten sam seed = ten sam ring; inny seed = inny', () => {
  const a = createHaloRingLayout({ seed: 4242 });
  const b = createHaloRingLayout({ seed: 4242 });
  const c = createHaloRingLayout({ seed: 4243 });
  assert.deepEqual(JSON.stringify(a.sectors), JSON.stringify(b.sectors));
  assert.deepEqual(a.rivers, b.rivers);
  assert.deepEqual(a.noiseOffset, b.noiseOffset);
  assert.notDeepEqual(a.rivers, c.rivers);
  // rzeki są okresowe: brak szwu na u = 0 / 1
  for (const river of a.rivers) near(riverCenterV(river, 0), riverCenterV(river, 1), 1e-9, 'rzeka na szwie');
});

test('widoczność habitatu z kamery gry — wariant Halo (§5.4–5.5)', () => {
  const h = computeGameCameraHeight(0.035, 1080);
  near(h * 0.035, 1712.9, 0.5, 'wysokość kamery persp × zoom (1080 px)');
  const layout = createHaloRingLayout({ habitatFacing: 'inward' });
  const brief = habitatVisibleStripBrief(43300, 6000, 1500, h);
  near(brief, 3228, 5, 'wzór z briefu przy zoomie 0,035');
  near(layout.habitatVisibleStripBrief(h), brief, 1, 'wzór w layoucie');
  // Dokładna geometria (dach na −100, ściany grube 250) daje ~10% mniej.
  const exact = layout.habitatVisibleStrip(h);
  assert.ok(exact > brief * 0.8 && exact < brief * 1.05, `dokładny pas ${exact}`);
  assert.ok(exact * 0.035 > 90, 'przy zoomie 0,035 pas podłogi to ~100 px');
  // Z bliska, nad dachem, podłogi nie widać.
  for (const zoom of [0.2, 1.0, 3.2]) {
    const hz = computeGameCameraHeight(zoom, 1080);
    assert.ok(layout.habitatVisibleStrip(hz, layout.radii.rim + 200) <= 0, `zoom ${zoom} nad dachem`);
  }
  // Dolna ściana od środka nad szczeliną planeta–ring: ~180 px przy zoomie 0,2.
  const h02 = computeGameCameraHeight(0.2, 1080);
  const px = layout.bottomWallVisibleStrip(h02, 39000) * 0.2;
  assert.ok(px > 150 && px < 200, `dolna ściana ${px} px`);
});

test('habitat w stronę kosmosu widać z obszaru rozgrywki poza ringiem (układ M2: wstęga pod płaszczyzną)', () => {
  const out = createHaloRingLayout({ flightLevel: 'roof' });
  const inn = createHaloRingLayout({ habitatFacing: 'inward' });
  const h1 = computeGameCameraHeight(1.0, 1080);
  const h02 = computeGameCameraHeight(0.2, 1080);
  // zoom 1, kamera 1000 j. za krawędzią ścian: kilkaset px podłogi i cała dolna ściana
  const floor1 = out.habitatVisibleStrip(h1, out.radii.rim + 1000);
  assert.ok(floor1 > 250, `podłoga przy zoomie 1: ${floor1}`);
  assert.ok(out.bottomWallVisibleStrip(h1, out.radii.rim + 1000) > 300);
  // zoom 0,2, krawędź ringu przy brzegu kadru (4800 j. = 960 px): ~200 px podłogi + ~180 px ściany
  const floor02 = out.habitatVisibleStrip(h02, out.radii.rim + 4800) * 0.2;
  assert.ok(floor02 > 150, `podłoga przy zoomie 0,2: ${floor02} px`);
  assert.ok(out.bottomWallVisibleStrip(h02, out.radii.rim + 4800) * 0.2 > 150);
  // ten sam kadr w wariancie Halo: habitat schowany za dachem
  assert.ok(inn.habitatVisibleStrip(h1, inn.radii.hull + 1000) <= 0);
  assert.equal(inn.bottomWallVisibleStrip(h1, inn.radii.hull + 1000), 0);
});
