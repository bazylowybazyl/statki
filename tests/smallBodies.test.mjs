// Małe ciała (src/data/smallBodies.js — strumień C planu docs/PLAN-pas-realizm.md): dane, skala, położenia
// (rozstrzyganie kątów z położeń świata), strefy, wyłączenia skał, stacje Unii Pasa, węzły ruchu v2, mapy.
// node --test tests/smallBodies.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  SMALL_BODIES, SMALL_BODY_BY_ID, SMALL_BODY_STATIONS, SMALL_BODY_SCALE, PLUTO_FROM_NEPTUNE, SMALL_BODY_PATH_CLEAR,
  smallBodyGameRadius, realAuToMapAu, smallBodyPosition, smallBodyStationPosition, smallBodyStationAngle,
  smallBodyStationOrbit, smallBodyZones, smallBodyExclusions, resolveSmallBodyAngles, smallBodyAngle
} from '../src/data/smallBodies.js';
import { SMALL_BODY_MAPS, SMALL_BODY_SHAPE_RANGE } from '../src/3d/planetMaps.js';
import { FACTION, getDefaultStationFaction, FACTIONS } from '../src/data/factions.js';
import { smallBodyOutposts, TRAFFIC_OUTPOSTS, buildTrafficWorld } from '../src/game/traffic/trafficWorld.js';
import { computeWorldUnitsPerAu } from '../src/data/systemMap.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';

const AU = computeWorldUnitsPerAu(getOutermostBeltEdgeAu(BELT_DEFINITIONS));
const SUN = { x: 6_000_000, y: 6_000_000 };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('ciała: komplet, AU mapy wg umowy planu (liniowo Mars 33 ↔ Jowisz 50,2), Westa bliżej Słońca niż Ceres', () => {
  assert.deepEqual(SMALL_BODIES.map((b) => b.id), ['ceres', 'vesta', 'pallas', 'hygiea', 'psyche', 'pluto', 'charon']);
  for (const id of ['ceres', 'vesta', 'pallas', 'hygiea', 'psyche']) {
    const b = SMALL_BODY_BY_ID[id];
    assert.ok(Math.abs(realAuToMapAu(b.realAU) - b.orbitAU) < 0.02, `${id}: ${b.orbitAU} vs ${realAuToMapAu(b.realAU)}`);
    // w pasie głównym, poza lukami Kirkwooda (37,57 / 39,08 / 39,70 / 41,20)
    assert.ok(b.orbitAU > 35.5 && b.orbitAU < 41.5, id);
    for (const gap of [37.57, 39.08, 39.7, 41.2]) assert.ok(Math.abs(b.orbitAU - gap) > 0.15, `${id} w luce ${gap}`);
  }
  assert.ok(SMALL_BODY_BY_ID.vesta.orbitAU < SMALL_BODY_BY_ID.ceres.orbitAU);
  // Pluton w paśmie plutonków (umowa planu 125,5–128,5)
  assert.ok(SMALL_BODY_BY_ID.pluto.orbitAU >= 125.5 && SMALL_BODY_BY_ID.pluto.orbitAU <= 128.5);
  assert.equal(SMALL_BODY_BY_ID.charon.parentId, 'pluto');
  assert.ok(Object.isFrozen(SMALL_BODIES) && SMALL_BODIES.every(Object.isFrozen));
});

test('skala: Luna 9 072 j. ściśnięta pierwiastkiem — kolejność wielkości jak w Układzie, wszystkie mniejsze od Luny', () => {
  assert.equal(smallBodyGameRadius(SMALL_BODY_SCALE.anchorKm), SMALL_BODY_SCALE.anchorRadius);
  const r = Object.fromEntries(SMALL_BODIES.map((b) => [b.id, b.radius]));
  assert.ok(r.pluto > r.charon && r.charon > r.ceres && r.ceres > r.vesta && r.vesta > r.pallas && r.pallas > r.hygiea && r.hygiea > r.psyche);
  for (const b of SMALL_BODIES) assert.ok(b.radius < SMALL_BODY_SCALE.anchorRadius, b.id);
  // czytelność: Psyche (najmniejsza) większa niż okręt kapitałowy (~1–1,5 tys. j.)
  assert.ok(r.psyche > 2000);
  // osie: iloczyn = 1 (promień średni), biegunowa najkrótsza
  for (const b of SMALL_BODIES) {
    const [x, y, z] = b.axes;
    assert.ok(Math.abs(x * y * z - 1) < 1e-9, b.id);
    assert.ok(y <= Math.min(x, z) + 1e-9, b.id);
  }
});

test('stacje Unii Pasa: Ceres (stolica) i Westa (huta), frakcja z factions.js, stacja po dziennej stronie ciała', () => {
  assert.deepEqual(SMALL_BODY_STATIONS.map((b) => b.station.id), ['ceres', 'vesta']);
  for (const b of SMALL_BODY_STATIONS) {
    assert.equal(getDefaultStationFaction(b.station.id), FACTION.BELT_UNION);
    assert.equal(b.factionId, FACTION.BELT_UNION);
    const body = smallBodyPosition(b, SUN, AU);
    const st = smallBodyStationPosition(b, SUN, AU);
    const d = Math.hypot(st.x - body.x, st.y - body.y);
    assert.ok(Math.abs(d - smallBodyStationOrbit(b)) < 1e-6);
    assert.ok(d > b.radius * Math.max(...b.axes) + b.station.r * 2.8, `${b.id}: stacja w bryle`);
    // po stronie Słońca (iloczyn skalarny kierunku stacji i kierunku do Słońca > 0)
    const toSun = { x: SUN.x - body.x, y: SUN.y - body.y };
    assert.ok((st.x - body.x) * toSun.x + (st.y - body.y) * toSun.y > 0, b.id);
    // studnia obejmuje stację
    assert.ok(smallBodyZones(b).outer > d);
  }
  assert.ok(FACTIONS[FACTION.BELT_UNION].homeStations.includes('ceres'));
  assert.ok(SMALL_BODY_BY_ID.ceres.role === 'capital');
});

test('strefy: inner nad powierzchnią, studnia Plutona obejmuje Charona', () => {
  for (const b of SMALL_BODIES) {
    const z = smallBodyZones(b);
    assert.ok(z.inner > b.radius * Math.max(...b.axes) * 0.99, b.id);
    assert.ok(z.outer > z.inner && z.gravityWell > z.outer, b.id);
  }
  const charon = SMALL_BODY_BY_ID.charon;
  const pluto = SMALL_BODY_BY_ID.pluto;
  assert.ok(smallBodyZones(pluto).outer > charon.separation + charon.radius);
  const pp = smallBodyPosition(pluto, SUN, AU);
  const cp = smallBodyPosition(charon, SUN, AU);
  assert.ok(Math.abs(Math.hypot(cp.x - pp.x, cp.y - pp.y) - charon.separation) < 1e-6);
});

test('kąty: tor kampanii, zajęte koła, Pluton 90–180° od Neptuna; ta sama odpowiedź dla tych samych danych', () => {
  // tor przez preferowane miejsce Ceres → Ceres musi zejść z toru
  const c0 = smallBodyPosition(SMALL_BODY_BY_ID.ceres, SUN, AU);
  const seg = { ax: SUN.x + (c0.x - SUN.x) * 0.5, ay: SUN.y + (c0.y - SUN.y) * 0.5, bx: SUN.x + (c0.x - SUN.x) * 1.6, by: SUN.y + (c0.y - SUN.y) * 1.6 };
  const keep = [{ x: c0.x + 1000, y: c0.y, r: 50000 }];
  for (let k = 0; k < 40; k++) {
    const nep = (k * 0.7) % (Math.PI * 2) - Math.PI;
    const report = {};
    const angles = resolveSmallBodyAngles({ origin: SUN, au: AU, planetAngles: { neptune: nep }, avoidSegments: [seg], keepOut: keep, report });
    assert.deepEqual(report.failed, []);
    for (const b of SMALL_BODIES.filter((q) => !q.parentId)) {
      const p = smallBodyPosition(b, SUN, AU, { x: 0, y: 0 }, angles);
      const well = smallBodyZones(b).gravityWell;
      const dx = seg.bx - seg.ax;
      const dy = seg.by - seg.ay;
      const t = Math.max(0, Math.min(1, ((p.x - seg.ax) * dx + (p.y - seg.ay) * dy) / (dx * dx + dy * dy)));
      assert.ok(Math.hypot(seg.ax + dx * t - p.x, seg.ay + dy * t - p.y) >= well + SMALL_BODY_PATH_CLEAR - 1, `${b.id} na torze`);
      assert.ok(Math.hypot(p.x - keep[0].x, p.y - keep[0].y) >= well + keep[0].r - 1, `${b.id} w zajętym kole`);
    }
    const d = Math.abs(wrap(angles.pluto - nep));
    assert.ok(d >= PLUTO_FROM_NEPTUNE.min - 1e-9 && d <= PLUTO_FROM_NEPTUNE.max + 1e-9, `Pluton ${d} od Neptuna`);
    const again = resolveSmallBodyAngles({ origin: SUN, au: AU, planetAngles: { neptune: nep }, avoidSegments: [seg], keepOut: keep });
    assert.deepEqual(again, angles);
  }
  // bez ograniczeń — kąty preferowane
  const free = resolveSmallBodyAngles({ origin: SUN, au: AU });
  for (const b of SMALL_BODIES.filter((q) => !q.parentId)) assert.ok(Math.abs(wrap(free[b.id] - b.angle)) < 1e-9, b.id);
  assert.equal(smallBodyAngle(SMALL_BODY_BY_ID.ceres, { ceres: 1.25 }), 1.25);
});

test('wyłączenia skał pola: ciało i stacja (elipsy obejmują bryłę i bryłę stacji)', () => {
  const ex = smallBodyExclusions(SUN, AU, 900);
  for (const b of SMALL_BODIES) {
    const e = ex.find((q) => q.id === b.id);
    const p = smallBodyPosition(b, SUN, AU);
    assert.ok(e && Math.abs(e.x - p.x) < 1e-6 && e.rx >= b.radius * Math.max(...b.axes) + 900 - 1e-6, b.id);
  }
  for (const b of SMALL_BODY_STATIONS) {
    const e = ex.find((q) => q.id === `${b.id}:station`);
    const p = smallBodyStationPosition(b, SUN, AU);
    assert.ok(e && Math.hypot(e.x - p.x, e.y - p.y) < 1e-6 && e.rx > b.station.r * 2.8, b.id);
  }
});

test('ruch v2: węzły ceres / vesta w punkcie stacji gry, kąt ciała z planetAngles', () => {
  const angles = { ceres: 1.1, vesta: -2.0 };
  const outposts = smallBodyOutposts({ planetAngles: angles });
  for (const b of SMALL_BODY_STATIONS) {
    const o = outposts.find((q) => q.id === b.station.id);
    const p = smallBodyStationPosition(b, { x: 0, y: 0 }, AU, { x: 0, y: 0 }, angles);
    assert.ok(Math.abs(o.orbitAU * AU * Math.cos(o.angle) - p.x) < 1e-3 && Math.abs(o.orbitAU * AU * Math.sin(o.angle) - p.y) < 1e-3, b.id);
  }
  // domyślne placówki: Ceres i Westa przy kątach preferowanych, Westa bliżej Słońca, kryjówki pirackie zostają
  const ids = TRAFFIC_OUTPOSTS.map((o) => o.id);
  assert.deepEqual(ids, ['ceres', 'vesta', 'gniazdo-hildy', 'zlomowisko']);
  assert.ok(TRAFFIC_OUTPOSTS[1].orbitAU < TRAFFIC_OUTPOSTS[0].orbitAU);
  // świat ruchu z grą: węzeł Ceres = stacja gry
  const world = buildTrafficWorld({ seed: 7, origin: SUN, planetAngles: angles });
  const node = world.stations.find((s) => s.id === 'ceres');
  const expect = smallBodyStationPosition(SMALL_BODY_BY_ID.ceres, SUN, AU, { x: 0, y: 0 }, angles);
  assert.ok(node && Math.hypot(node.x - expect.x, node.y - expect.y) < 1, `węzeł Ceres ${node?.x},${node?.y}`);
  assert.equal(node.factionId, FACTION.BELT_UNION);
});

test('mapy: wpis na każde ciało, kształt z zakresem (blok SMALL_BODY_SHAPE czyta też generator), pliki w public/', () => {
  for (const b of SMALL_BODIES) {
    const m = SMALL_BODY_MAPS[b.id];
    assert.ok(m && m.day && m.night && m.normal, b.id);
    for (const key of ['day', 'night', 'normal', 'shape']) {
      if (!m[key]) continue;
      assert.ok(existsSync(new URL(`../public/${m[key]}`, import.meta.url)), `${b.id}: brak ${m[key]}`);
    }
  }
  for (const id of ['ceres', 'vesta', 'pallas', 'hygiea', 'psyche']) {
    const [lo, hi] = SMALL_BODY_SHAPE_RANGE[id];
    assert.ok(lo < 0 && hi > 0, id);
    assert.ok(SMALL_BODY_MAPS[id].shape && SMALL_BODY_MAPS[id].shapeRange, id);
  }
  assert.equal(SMALL_BODY_MAPS.pluto.shape, null);
  const py = readFileSync(new URL('../scripts/planety/male_ciala.py', import.meta.url), 'utf8');
  assert.ok(py.includes("'SMALL_BODY_SHAPE'"), 'generator czyta zakresy z planetMaps.js');
});

test('kształt bryły: dekodowanie 16 bitów RG, bieguny w jednym punkcie, szew bez pęknięcia normalnych', async () => {
  const THREE = await import('three/webgpu');
  const { decodeSmallBodyShape, displaceSmallBodyGeometry, sampleSmallBodyShape } = await import('../src/3d/smallBodyShape.js');
  const range = [-0.2, 0.2];
  const w = 16;
  const h = 8;
  const rgba = new Uint8Array(w * h * 4);
  const want = (i, j) => Math.sin(i / w * Math.PI * 2) * 0.1 + (j / (h - 1) - 0.5) * 0.05;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const q = Math.round((want(i, j) - range[0]) / (range[1] - range[0]) * 65535);
      const k = (j * w + i) * 4;
      rgba[k] = q >> 8; rgba[k + 1] = q & 255; rgba[k + 3] = 255;
    }
  }
  const s = decodeSmallBodyShape(rgba, w, h, range);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) assert.ok(Math.abs(s.d[j * w + i] - want(i, j)) < 1e-5);
  // próbka w środku teksela = wartość teksela; u zawinięte (u = 1 + x ≡ x)
  assert.ok(Math.abs(sampleSmallBodyShape(s, (3 + 0.5) / w, 1 - (2 + 0.5) / h) - s.d[2 * w + 3]) < 1e-6);
  assert.ok(Math.abs(sampleSmallBodyShape(s, 1 + (3 + 0.5) / w, 1 - (2 + 0.5) / h) - s.d[2 * w + 3]) < 1e-6);
  const seg = { w: 32, h: 16 };
  const geo = new THREE.SphereGeometry(1, seg.w, seg.h);
  const ext = displaceSmallBodyGeometry(geo, s, seg);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  assert.ok(ext > 1 && ext < 1 + range[1] + 1e-6);
  for (const row of [0, seg.h]) {
    const a = row * (seg.w + 1);
    for (let ix = 1; ix <= seg.w; ix++) {
      assert.ok(Math.hypot(pos.getX(a + ix) - pos.getX(a), pos.getY(a + ix) - pos.getY(a), pos.getZ(a + ix) - pos.getZ(a)) < 1e-6, 'biegun');
    }
  }
  for (let iy = 1; iy < seg.h; iy++) {
    const a = iy * (seg.w + 1);
    const b = a + seg.w;
    assert.ok(Math.hypot(pos.getX(a) - pos.getX(b), pos.getY(a) - pos.getY(b), pos.getZ(a) - pos.getZ(b)) < 1e-6, 'szew: pozycja');
    assert.ok(Math.hypot(nrm.getX(a) - nrm.getX(b), nrm.getY(a) - nrm.getY(b), nrm.getZ(a) - nrm.getZ(b)) < 1e-6, 'szew: normalna');
  }
});
