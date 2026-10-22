// Ring w budowie (Jowisz, decyzja użytkownika 2026-10-22: „unfinished”): przerwy w płycie są
// PRAWDZIWYMI przelotami w płaszczyźnie gry — kolider, pociski, router ruchu v2, reda portu i radar
// widzą je tak samo; port i tranzyty stoją na zbudowanych segmentach; konstrukcja i zabudowa
// archetypu Fable nie stoją w przerwach, a front budowy ma plac budowy zamiast zabudowy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haloRingLayoutFor, createHaloRingPlacement, haloLocalToGame } from '../src/game/haloRingPlanets.js';
import { HaloRingCollider } from '../src/game/haloRingCollision.js';
import { haloRingConstruction, haloGapIndexAt, haloGapEdgeDistance, haloAngleDiff } from '../src/3d/haloRing/haloRingConstruction.js';
import { HALO_RING_PROFILES } from '../src/3d/haloRing/haloRingProfiles.js';
import { haloPortComplexAngles, haloTransitAngles, haloPortSites } from '../src/3d/haloRing/haloRingConfig.js';
import { createRingObstacle, pointInRingSlab, transitIndexAt, routeRing } from '../src/game/traffic/ringRouter.js';
import { createPath, pathReset, pathFinalize, pathX, pathY } from '../src/game/traffic/portPaths.js';
import { buildHaloPortTrafficLayout } from '../src/3d/haloRing/haloPortTraffic.js';
import { buildPortParking } from '../src/game/traffic/portParking.js';
import { FZ, buildFableCity, buildFableStructure, createFablePlan } from '../src/3d/haloRing/arch/fablePlan.js';

const jupiter = haloRingLayoutFor({ id: 'jupiter' });
const K = jupiter.construction;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('profil: Jowisz w budowie (3 przerwy, segmenty, front), Ziemia i Mars pełne', () => {
  assert.equal(K.active, true);
  assert.equal(K.gaps.length, 3);
  assert.equal(K.segments.length, 3);
  assert.ok(K.front > 0);
  for (const key of ['earth', 'mars']) assert.equal(haloRingLayoutFor({ id: key }).construction.active, false);
  // segmenty + przerwy = cały obwód
  const built = K.segments.reduce((s, g) => s + (g.a1 - g.a0), 0);
  const open = K.gaps.reduce((s, g) => s + 2 * g.half, 0);
  assert.ok(Math.abs(built + open - Math.PI * 2) < 1e-9);
  // przerwy realne dla okrętów: ≥ 5 tys. j. na podłodze
  for (const g of K.gaps) assert.ok(2 * g.half * jupiter.radii.floorMid > 5000);
  // port i tranzyty na segmentach, z frontem budowy i zapasem
  for (const a of [...haloPortComplexAngles(), ...haloTransitAngles()]) {
    assert.ok(haloGapEdgeDistance(a, K) > K.front, `kąt ${a.toFixed(3)} za blisko przerwy`);
  }
  for (const site of haloPortSites(jupiter.radii.floorMid)) {
    assert.equal(haloGapIndexAt(site.theta, K, (site.halfS || 0) / jupiter.radii.floorMid), -1, `płyta ${site.kind} w przerwie`);
  }
  // przerwa na porcie = błąd profilu
  const bad = { ...HALO_RING_PROFILES.jupiter, construction: { gaps: [{ at: 0, half: 0.1 }], front: 0.05 } };
  assert.throws(() => haloRingConstruction(bad, jupiter.radii.floorMid), /kompleksie portu/);
});

test('kolider: przerwa = przelot (statek i pociski), segment = płyta; czoło segmentu wypycha do przerwy', () => {
  const planet = { id: 'jupiter', x: 1_000_000, y: -500_000 };
  const col = new HaloRingCollider(planet);
  const place = createHaloRingPlacement(planet);
  const R = jupiter.radii;
  const mid = (R.back + R.floorMid) * 0.5;
  const at = (theta, r) => haloLocalToGame(place, Math.cos(theta) * r, Math.sin(theta) * r, {});
  for (const g of K.gaps) {
    const p = at(g.center, mid);
    assert.equal(col.pointInSlab(p.x, p.y), false, 'środek przerwy otwarty');
    const q = at(g.center + g.half + 0.01, mid);
    assert.equal(col.pointInSlab(q.x, q.y), true, 'segment za krawędzią przerwy');
    // statek w przerwie przy płycie: bez wypchnięcia
    const ship = { pos: at(g.center, mid), vel: { x: 0, y: 0 }, angle: 0, w: 300, h: 120, radius: 160 };
    assert.equal(col.constrainShip(ship, false).hit, false);
  }
  // statek wleciał wzdłuż przerwy w czoło segmentu (60 j. w głąb): wypchnięty WZDŁUŻ ringu do przerwy,
  // nie promieniowo przez grubość płyty
  const g = K.gaps[0];
  const edge = g.center + g.half;
  const ship = { pos: at(edge + 60 / R.floorMid, mid), vel: { x: 0, y: 0 }, angle: 0, w: 200, h: 80, radius: 110 };
  const before = { ...ship.pos };
  const res = col.constrainShip(ship, false);
  assert.equal(res.hit, true);
  const dx = ship.pos.x - before.x;
  const dy = ship.pos.y - before.y;
  const move = Math.hypot(dx, dy);
  assert.ok(move < 600, `ruch ${move.toFixed(0)} j. — krótszy niż przez płytę`);
  const after = Math.atan2(ship.pos.y - planet.y, ship.pos.x - planet.x);
  const beforeA = Math.atan2(before.y - planet.y, before.x - planet.x);
  assert.ok(Math.abs(Math.hypot(ship.pos.x - planet.x, ship.pos.y - planet.y) - Math.hypot(before.x - planet.x, before.y - planet.y)) < 5, 'promień bez zmian');
  assert.notEqual(Math.sign(haloAngleDiff(after, beforeA)), 0);
  assert.ok(res.building, 'wynik zna ring w budowie (komunikat)');
});

test('ruch v2: router widzi przerwy jako szerokie przeloty, reda nie zasłania ich wylotów', () => {
  const ring = createRingObstacle({ key: 'jupiter', x: 0, y: 0 });
  assert.equal(ring.transitAngles.length, 4 + K.gaps.length);
  assert.equal(ring.transitCount, 4);
  const R = jupiter.radii;
  const mid = (R.back + R.floorMid) * 0.5;
  for (let j = 0; j < K.gaps.length; j++) {
    const a = ring.transitAngles[4 + j];
    const x = Math.cos(a) * mid;
    const y = Math.sin(a) * mid;
    assert.equal(pointInRingSlab(ring, x, y), false, 'środek przerwy poza płytą');
    assert.equal(transitIndexAt(ring, x, y), 4 + j);
    assert.ok(ring.transitHalfWidths[4 + j] > 2000);
  }
  // trasa z korytarza wewnętrznego (pod przerwą) na zewnątrz: przez przerwę, bez wejścia w płytę
  const a = ring.transitAngles[4];
  const path = createPath(256);
  pathReset(path, Math.cos(a) * ring.innerR, Math.sin(a) * ring.innerR);
  routeRing(path, [ring], Math.cos(a) * ring.innerR, Math.sin(a) * ring.innerR, Math.cos(a) * 120_000, Math.sin(a) * 120_000, 0, 0);
  pathFinalize(path);
  let prevX = Math.cos(a) * ring.innerR;
  let prevY = Math.sin(a) * ring.innerR;
  let inSlab = 0;
  for (let i = 0; i < path.count; i++) {
    for (let k = 1; k <= 20; k++) {
      const x = prevX + (pathX(path, i) - prevX) * (k / 20);
      const y = prevY + (pathY(path, i) - prevY) * (k / 20);
      if (pointInRingSlab(ring, x, y)) inSlab++;
    }
    prevX = pathX(path, i);
    prevY = pathY(path, i);
  }
  assert.equal(inSlab, 0, 'trasa przez przerwę nie wchodzi w płytę');
  // reda: żaden slot nad przerwą
  const station = { id: 'jupiter', x: 0, y: 0 };
  const layout = buildHaloPortTrafficLayout(jupiter, station);
  assert.equal(layout.ring.gaps.length, K.gaps.length);
  const plan = buildPortParking(layout, station);
  const slots = plan.zones.flatMap((z) => z.bands.flatMap((b) => b.slots));
  assert.ok(slots.length > 0);
  for (const s of slots) {
    for (const gp of layout.ring.gaps) {
      const d = Math.abs(haloAngleDiff(s.theta, gp.angle));
      assert.ok(d > gp.halfArc / layout.ring.floorMid, `slot ${s.id || ''} nad przerwą`);
    }
  }
});

test('Fable w budowie: konstrukcja, rury i zabudowa nie stoją w przerwach; front = plac budowy', () => {
  const plan = createFablePlan(jupiter);
  const L = { add() { L.n++; }, n: 0 };
  const st = buildFableStructure(plan, L);
  assert.equal(st.site.fronts, K.gaps.length * 2);
  assert.ok(st.site.welds > 50 && st.site.drones > 50 && st.site.props > 200, JSON.stringify(st.site));
  const centers = (b) => {
    const out = [];
    for (let i = 0; i < b.count; i++) out.push([b.m[i * 16 + 12], b.m[i * 16 + 13], b.m[i * 16 + 14]]);
    return out;
  };
  for (const [x, y] of centers(st.bg.all).concat(centers(st.fg.all))) {
    const th = Math.atan2(y, x);
    // drony wiszą też nad krawędzią przerwy (0,2 frontu) — dalej w przerwie nic
    assert.ok(haloGapEdgeDistance(th, K) > -K.front * 0.25, `bryła w przerwie θ = ${th.toFixed(4)}`);
  }
  const city = buildFableCity(plan);
  for (const B of city.per) {
    for (const b of [B.box, B.tree]) {
      for (const [x, y] of centers(b)) assert.ok(haloGapEdgeDistance(Math.atan2(y, x), K) > K.front * 0.9, 'zabudowa na froncie albo w przerwie');
    }
  }
  for (const d of plan.domes) assert.ok(haloGapEdgeDistance(d.theta, K) > K.front, 'kopuła przy przerwie');
  // strefa frontu na mapie stref
  const g = K.gaps[0];
  const s = (g.center + g.half + K.front * 0.5 - jupiter.sectorStart + Math.PI * 4) % (Math.PI * 2) * plan.R;
  assert.equal(plan.zoneWithPort(s, 0).t, FZ.BUILD);
});

test('wpięcie: radar rysuje płytę z lukami przerw, shader Fable zna strefę BUILD, światła spawania migoczą', () => {
  const radar = read('src/ui/radar/radarTerrain.js');
  assert.match(radar, /col\.construction\?\.active \? col\.construction\.gaps/);
  assert.match(read('src/3d/haloRing/arch/fable.js'), /front budowy \(ring w budowie\)/);
  assert.match(read('src/3d/haloRing/arch/archTSL.js'), /faza ≥ 1: spawanie/);
  assert.match(read('index.html'), /PRZELOT TRANZYTEM ALBO PRZERWĄ BUDOWY/);
});
