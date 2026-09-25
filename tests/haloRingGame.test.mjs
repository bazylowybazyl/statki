// Port ringu „Halo” do gry (2026-09-25): ringi planet, stacja-port w hali K-7,
// kolizje (płyta, tranzyty, ściany portu), progi jakości „ultra” i wpięcie
// w index.html — bez GPU.
// node --test tests/haloRingGame.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HALO_PORT_STATION,
  HALO_RING_PLANETS,
  computeHaloPortStation,
  createHaloRingPlacement,
  haloGameToLocal,
  haloLocalToGame,
  haloRingKey,
  haloRingRotation
} from '../src/game/haloRingPlanets.js';
import { HALO_COLLISION, HaloRingCollider, haloSatPenetration, haloShipOutline } from '../src/game/haloRingCollision.js';
import { HALO_QUALITY, HALO_STATION_ANGLE, HALO_TRANSIT, haloPortComplexAngles, haloTransitAngles } from '../src/3d/haloRing/haloRingConfig.js';
import { createK7Layout, k7Frame, k7HubToWorld } from '../src/3d/haloRing/haloPortK7Layout.js';

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU);
const EARTH = { id: 'earth', x: 1060000, y: -250000, r: 2800 };
const MARS = { id: 'mars', x: -700000, y: 1200000, r: 2400 };

test('ringi planet: Ziemia i Mars, port pod kątem dawnej stacji (obrót grupy)', () => {
  assert.equal(haloRingKey(EARTH), 'earth');
  assert.equal(haloRingKey(MARS), 'mars');
  assert.equal(haloRingKey({ id: 'venus' }), '');
  assert.equal(haloRingRotation('earth'), 0, 'port Ziemi = HALO_STATION_ANGLE bez obrotu');
  for (const planet of [EARTH, MARS]) {
    const key = haloRingKey(planet);
    // kąt stacji w grze (y w dół) → Three (−kąt) → układ lokalny ringu (− obrót)
    const local = wrap(-HALO_RING_PLANETS[key].stationAngle - haloRingRotation(key));
    assert.ok(Math.abs(wrap(local - HALO_STATION_ANGLE)) < 1e-9, `${key}: port pod kątem stacji`);
    const place = createHaloRingPlacement(planet);
    for (const [x, y] of [[planet.x + 43000, planet.y], [planet.x - 1234, planet.y + 50000], [planet.x, planet.y]]) {
      const l = haloGameToLocal(place, x, y, {});
      const g = haloLocalToGame(place, l.x, l.y, {});
      assert.ok(Math.abs(g.x - x) < 1e-6 && Math.abs(g.y - y) < 1e-6, 'przejście świat gry ↔ lokalny ringu');
      assert.ok(Math.abs(Math.hypot(l.x, l.y) - Math.hypot(x - planet.x, y - planet.y)) < 1e-6, 'obrót bez skali');
    }
  }
});

test('stacja planety z ringiem = port: środek hali K-7, porty frachtowców i brama warp przed G-01', () => {
  const hall = createK7Layout();
  for (const planet of [EARTH, MARS]) {
    const st = computeHaloPortStation(planet);
    const place = createHaloRingPlacement(planet);
    const collider = new HaloRingCollider(planet);
    const frame = k7Frame(collider.layout);
    // stacja na osi huba hali gracza, w połowie hali
    const sx = planet.x + Math.cos(st.angle) * st.orbitRadius;
    const sy = planet.y + Math.sin(st.angle) * st.orbitRadius;
    const l = haloGameToLocal(place, sx, sy, {});
    const hub = { x: (l.x - frame.origin.x) * frame.tx + (l.y - frame.origin.y) * frame.ty, z: (l.x - frame.origin.x) * frame.rx + (l.y - frame.origin.y) * frame.ry };
    assert.ok(Math.abs(hub.x) < 1e-6, `${st.key}: stacja na osi hali (x ${hub.x})`);
    assert.ok(Math.abs(hub.z - (hall.backZ + hall.frontZ) / 2) < 1e-6, `${st.key}: stacja w połowie hali`);
    assert.ok(st.orbitRadius > collider.layout.radii.max, 'stacja poza bryłą ringu');
    assert.ok(st.terminalRange >= 5000 && st.terminalRange === HALO_PORT_STATION.terminalRange);
    // porty frachtowców i brama warp poza halą: przed bramą główną G-01
    for (const p of [...st.ports, st.gateOffset]) {
      const pl = haloGameToLocal(place, sx + p.x, sy + p.y, {});
      const z = (pl.x - frame.origin.x) * frame.rx + (pl.y - frame.origin.y) * frame.ry;
      assert.ok(z > hall.frontZ + 300, `${st.key}: port / brama przed G-01 (z ${z.toFixed(0)})`);
    }
    // i poza ścianami portu (frachtowiec czeka na płycie, nie w ścianie)
    for (const p of st.ports) {
      const ship = { pos: { x: sx + p.x, y: sy + p.y }, vel: { x: 0, y: 0 }, angle: st.angle, radius: 200 };
      const res = collider.constrainShip(ship, true);
      assert.equal(res.hit, false, `${st.key}: port frachtowca w przeszkodzie`);
    }
  }
});

// Statek w lokalnym kącie `theta` na promieniu `r` (układ ringu Ziemi).
function shipAt(collider, theta, r, vIn = 0, opts = {}) {
  const g = haloLocalToGame(collider.place, Math.cos(theta) * r, Math.sin(theta) * r, {});
  // prędkość promieniowo do środka ringu (świat gry: y w dół)
  const vx = -Math.cos(theta) * vIn;
  const vy = Math.sin(theta) * vIn;
  return { pos: { x: g.x, y: g.y }, vel: { x: vx, y: vy }, angle: opts.angle ?? 0, w: opts.w ?? 1800, h: opts.h ?? 806, radius: 300 };
}
const localR = (collider, ship) => {
  const l = haloGameToLocal(collider.place, ship.pos.x, ship.pos.y, {});
  return Math.hypot(l.x, l.y);
};

test('płyta ringu: wypchnięcie po stronie habitatu i planety, bez odbicia; daleko — nic', () => {
  const col = new HaloRingCollider(EARTH);
  const th = 0.4;   // między tranzytem (0) a kompleksem 1 (π/4)
  // habitat: w płycie, lecąc w głąb (ku planecie)
  const a = shipAt(col, th, col.floorMid + 250, 300);
  const ra = col.constrainShip(a, false);
  assert.ok(ra.hit && ra.floor > 0);
  assert.ok(localR(col, a) >= col.floorMid + HALO_COLLISION.padHeight + HALO_COLLISION.clearance, 'kadłub nad płytą');
  // składowa w głąb płyty wyzerowana, reszta prędkości bez zmian (brak odbicia)
  const l = haloGameToLocal(col.place, a.pos.x, a.pos.y, {});
  const radial = a.vel.x * (l.x / Math.hypot(l.x, l.y)) - a.vel.y * (l.y / Math.hypot(l.x, l.y));
  assert.ok(Math.abs(radial) < 1e-6, `prędkość promieniowa po zderzeniu ${radial}`);
  assert.equal(ra.impactSpeed, 300);
  // druga iteracja: już nic nie wchodzi w płytę
  assert.equal(col.constrainShip(a, false).hit, false);
  // planeta: statek między planetą a ringiem wbity w kadłub — wypchnięty do środka
  const b = shipAt(col, th, col.back - 200, -300);
  assert.ok(col.constrainShip(b, false).hit);
  assert.ok(localR(col, b) <= col.back - HALO_COLLISION.clearance + 1e-6, 'kadłub pod płytą od strony planety');
  // daleko od ringu i blisko, ale ponad płytą — bez kolizji
  assert.equal(col.constrainShip(shipAt(col, th, col.floorMid + 3000, 300), false).hit, false);
  assert.equal(col.constrainShip({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, radius: 100 }, false).hit, false);
});

test('tranzyty: korytarz przez płytę otwarty; pociski zatrzymuje płyta poza tranzytami', () => {
  const col = new HaloRingCollider(EARTH);
  const transits = haloTransitAngles();
  assert.equal(transits.length, HALO_TRANSIT.count);
  for (const t of transits) {
    // statek dziobem w tunelu (oś tunelu), środek w płycie — przelatuje
    const ship = shipAt(col, t, (col.back + col.floorMid) / 2, 300, { w: 900, h: 300, angle: -t + Math.PI });
    assert.equal(col.constrainShip(ship, false).hit, false, `tranzyt ${t.toFixed(3)} zamknięty`);
    const g = haloLocalToGame(col.place, Math.cos(t) * (col.back + 150), Math.sin(t) * (col.back + 150), {});
    assert.equal(col.pointInSlab(g.x, g.y), false, 'pocisk w tunelu przelatuje');
  }
  const g = haloLocalToGame(col.place, Math.cos(0.4) * (col.back + 150), Math.sin(0.4) * (col.back + 150), {});
  assert.equal(col.pointInSlab(g.x, g.y), true, 'pocisk w płycie');
  const out = haloLocalToGame(col.place, Math.cos(0.4) * (col.floorMid + 900), Math.sin(0.4) * (col.floorMid + 900), {});
  assert.equal(col.pointInSlab(out.x, out.y), false, 'pocisk nad habitatem leci dalej');
});

test('ściany portu: hala K-7 i zatoki wypychają statki graczy (SAT), wnętrze hali wolne', () => {
  const col = new HaloRingCollider(EARTH);
  assert.ok(col.wallItems.length > 300, 'ściany 4 hal, 8 zatok i 4 tuneli');
  const f = k7Frame(col.layout);
  const toShip = (hx, hz, angle = 0) => {
    const w = k7HubToWorld(f, hx, hz, {});
    const g = haloLocalToGame(col.place, w.x, w.y, {});
    return { pos: { x: g.x, y: g.y }, vel: { x: 0, y: 0 }, angle, w: 1800, h: 806 };
  };
  // środek hali (między stanowiskami capital a bramą) — wolne
  assert.equal(col.constrainShip(toShip(0, 3825), true).hit, false);
  // na ścianie bocznej — wypchnięty tak, że już jej nie dotyka
  const s = toShip(5220, 3000);
  const r = col.constrainShip(s, true);
  assert.ok(r.hit && r.walls > 0, 'ściana boczna');
  assert.equal(col.constrainShip(s, true).walls, 0, 'po wypchnięciu bez penetracji');
  // NPC (walls = false) ścian portu nie widzą
  assert.equal(col.constrainShip(toShip(5220, 3000), false).walls, 0);
  // SAT: kwadraty 2 × 2 przesunięte o 1,5 → penetracja 0,5 wzdłuż osi x
  const sq = (x, z) => [{ x: x - 1, z: z - 1 }, { x: x + 1, z: z - 1 }, { x: x + 1, z: z + 1 }, { x: x - 1, z: z + 1 }];
  const mtv = {};
  assert.ok(Math.abs(haloSatPenetration(sq(0, 0), sq(1.5, 0), mtv) - 0.5) < 1e-9);
  assert.deepEqual([mtv.x, Math.abs(mtv.z)], [-1, 0]);
  assert.equal(haloSatPenetration(sq(0, 0), sq(3, 0), mtv), 0);
});

test('obwiednia statku: prostokąt kadłuba (kurs) albo ośmiokąt z promienia', () => {
  const out = Array.from({ length: HALO_COLLISION.shipPoints }, () => ({ x: 0, y: 0 }));
  const ext = haloShipOutline({ pos: { x: 10, y: 20 }, angle: Math.PI / 2, w: 1800, h: 806 }, out);
  assert.ok(ext > 900 && ext < 1000);
  // kurs π/2 (y w dół): dziób na +y
  assert.ok(Math.max(...out.map((p) => p.y)) > 20 + 890);
  const r = haloShipOutline({ pos: { x: 0, y: 0 }, radius: 150 }, out);
  assert.equal(r, 150);
  for (const p of out) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 150) < 1e-9);
});

test('jakość „ultra”: dalszy LOD miasta, drzew, megastruktury i portu; high bez zmian', () => {
  const hi = HALO_QUALITY.high.lod;
  const ul = HALO_QUALITY.ultra.lod;
  assert.deepEqual([...hi.cityFade], [17000, 30000], 'high: progi strojone w demie');
  assert.equal(hi.cityMinPixels, 1.0);
  assert.deepEqual([...hi.buildingPixels], [0.6, 1.6]);
  assert.deepEqual([...hi.geomFade], [14000, 20000]);
  assert.equal(hi.treeGrid, 128);
  assert.equal(HALO_QUALITY.medium.lod, hi);
  assert.equal(HALO_QUALITY.low.lod.treeGrid, 88);
  assert.ok(ul.detailScale > 1.5, 'okna wygaszane dalej');
  assert.ok(ul.cityFade[0] > 2 * hi.cityFade[0] - 1 && ul.cityFade[1] > 2 * hi.cityFade[1] - 1, 'miasto z dalszej kamery');
  assert.ok(ul.cityMinPixels < hi.cityMinPixels && ul.buildingPixels[1] < hi.buildingPixels[0] * 2);
  assert.ok(ul.cityChunks[0] >= 2 * hi.cityChunks[0] && ul.cityChunks[1] >= 2 * hi.cityChunks[1]);
  assert.ok(ul.treeGrid > hi.treeGrid && ul.treeAltitude > hi.treeAltitude && ul.treePixels < hi.treePixels);
  assert.ok(ul.geomFade[1] > hi.geomFade[1] * 1.5 && ul.k7Pixels < hi.k7Pixels);
});

test('index.html: ring „Halo” zamiast starego ringu (render, kolizje, stacje, pociski)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /import \{ HaloRingGame \} from "\.\/src\/3d\/haloRing\/haloRingGame\.js";/);
  assert.match(html, /import \{ computeHaloPortStation \} from "\.\/src\/game\/haloRingPlanets\.js";/);
  for (const gone of ['planetaryRing3D', 'RingCityFlight', 'ZonePainterUI', 'getPotentialPlanetaryRingTargets', 'initRingColorTunerPanel', 'isRingSegment']) {
    assert.ok(!html.includes(gone), `stary ring: ${gone}`);
  }
  // render: kamera tej klatki (cam, ze wstrząsem) przed updateHexShips3D (Core3D.render)
  const upd = html.indexOf('haloRings.update(frameDt, cam, {');
  const hex = html.indexOf('updateHexShips3D(cam, renderEntities');
  assert.ok(upd > 0 && hex > upd, 'haloRings.update przed renderem 3D');
  // fizyka: płyta i ściany portu po asteroidach, przed destruktorem
  const phys = html.indexOf('function physicsStep(');
  const ast = html.indexOf('stepShipAsteroidCollisions(dt);', phys);
  const ring = html.indexOf('stepShipRingCollisions(dt);', phys);
  const destr = html.indexOf('DestructorSystem.update(dt, allDestructibles);', phys);
  assert.ok(ast > 0 && ring > ast && destr > ring, 'kolejność kolizji w physicsStep');
  assert.match(html, /haloRings\.constrainShip\(ship, true\)/);
  assert.match(html, /haloRings\.constrainShip\(npc, false\)/);
  // pociski: płyta zatrzymuje, stacja-port nie łapie trafień
  assert.match(html, /haloRings && haloRings\.pointInSlab\(b\.x, b\.y\)/);
  assert.match(html, /b\.source !== st && st\.isCollidable !== false/);
  // terminal stacji-portu w całej hali K-7
  assert.match(html, /Number\(station\.terminalRange\)/);
  // jakość z ustawień „Jakość planet i ringu”
  assert.match(html, /quality: window\.OPTIONS\?\.planetQuality/);
  const st3d = readFileSync(new URL('../src/3d/stations3D.js', import.meta.url), 'utf8');
  assert.equal((st3d.match(/station\.ringPort\) continue;/g) || []).length, 2, 'stacja-port bez bryły 3D');
  // domyślna infrastruktura stacji Ziemi / Marsa nie leży ikonami 2D na dachu hali K-7
  const infra = readFileSync(new URL('../src/ui/infrastructureUI.js', import.meta.url), 'utf8');
  assert.match(infra, /if \(inst\.stationRef\?\.ringPort\) continue;/);
  const massPanel = readFileSync(new URL('../src/ui/destructorMassPanel.js', import.meta.url), 'utf8');
  assert.ok(!massPanel.includes('__planetaryRingsDebug'), 'panel mas bez segmentów starego ringu');
});

test('port: 4 kompleksy co 90° od kąta stacji — każdy z halą i dwiema zatokami w ścianach portu', () => {
  const col = new HaloRingCollider(EARTH);
  const angles = haloPortComplexAngles();
  assert.equal(angles.length, 4);
  assert.equal(col.registry.halls.length, 4);
  assert.equal(col.registry.bays.length, 8);
  for (const [i, a] of angles.entries()) {
    assert.ok(Math.abs(wrap(a - (HALO_STATION_ANGLE + i * TAU / 4))) < 1e-9);
    // środek każdej hali wolny, jej ściana boczna — przeszkoda
    const f = k7Frame(col.layout, a);
    const c = k7HubToWorld(f, 0, 3825, {});
    const g = haloLocalToGame(col.place, c.x, c.y, {});
    assert.equal(col.constrainShip({ pos: { x: g.x, y: g.y }, vel: { x: 0, y: 0 }, angle: 0, w: 1800, h: 806 }, true).hit, false, `hala ${i}`);
  }
});
