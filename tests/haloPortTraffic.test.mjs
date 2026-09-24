// Port Ziemi (4 hale K-7 + 8 otwartych zatok ze stanowiskami K-7) jako układ doków ruchu v2.
// node --test tests/haloPortTraffic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { buildHaloPortTrafficLayout } from '../src/3d/haloRing/haloPortTraffic.js';
import { HALO_PORT } from '../src/3d/haloRing/haloRingConfig.js';
import { createK7Layout } from '../src/3d/haloRing/haloPortK7Layout.js';
import { createBayLayout } from '../src/3d/haloRing/haloPortBays.js';
import {
  berthClassForHull, berthOccupancy, findBerth, hullFootprint, releaseBerth, reserveBerth
} from '../src/game/traffic/dockLayout.js';
import { HULL_RENDER_PROFILES } from '../src/data/ships.js';

const ring = createHaloRingLayout({});
const station = { id: 'earth', x: 1000, y: -2000 };
const port = buildHaloPortTrafficLayout(ring, station);

test('skład portu: 4 hale × 28 + 8 zatok × 14 (2 MEGA, 4 L, 4 M, 4 S) = 224 stanowiska', () => {
  assert.equal(port.docks.length, HALO_PORT.complexes * (1 + HALO_PORT.docks));
  assert.equal(port.berths.length, 224);
  const occ = berthOccupancy(port);
  const count = Object.fromEntries(Object.entries(occ.byClass).map(([k, v]) => [k, v.total]));
  assert.deepEqual(count, { capital: 16, l: 48, m: 64, s: 80, mega: 16 });
  assert.equal(new Set(port.berths.map((b) => b.id)).size, port.berths.length, 'unikalne id');
  assert.ok(port.parkingRadius > ring.radii.rim + 2000, 'orbita postojowa za kompleksami');
});

test('dobór stanowisk ruchu v2 działa na porcie K-7 (best-fit, rezerwacja, zwolnienie)', () => {
  const expect = { atlas: 'capital', megafreighter: 'mega', inter_station_shuttle: 's', container_ship: 'm', long_haul_freighter: 'l', heavy_freighter: 'capital' };
  for (const [hull, cls] of Object.entries(expect)) {
    const pick = findBerth(port, hull, 0, { freeOnly: true });
    assert.ok(pick, `brak stanowiska dla ${hull}`);
    assert.equal(pick.berth.cls, cls, `${hull} → ${pick.berth.cls}`);
  }
  // pełne zatoki mega: megafrachtowiec nie dostaje niczego (nie mieści się w hali)
  const megas = port.berths.filter((b) => b.cls === 'mega');
  megas.forEach((b, i) => reserveBerth(b, 'test-' + i, 1e9));
  assert.equal(findBerth(port, 'megafreighter', 0, { freeOnly: true }), null);
  megas.forEach((b) => releaseBerth(b, 0));
});

test('każdy kadłub z klasy ruchu v2 fizycznie mieści się na stanowisku K-7 / w zatoce', () => {
  const pad = {};
  for (const b of [...createK7Layout().berths, ...createBayLayout().berths]) pad[b.size] ??= b;
  const k7Of = { s: 'S', m: 'M', l: 'L', capital: 'CAPITAL', mega: 'MEGA' };
  for (const hull of Object.keys(HULL_RENDER_PROFILES)) {
    const cls = berthClassForHull(hull);
    if (!cls) continue;
    const f = hullFootprint(hull);
    const p = pad[k7Of[cls.id]];
    assert.ok(f.length <= p.maxLength && f.width <= p.maxBeam, `${hull} (${cls.id}) nie mieści się na ${p.size}`);
  }
  // stanowiska zatok w tym samym standardzie co grzebienie K-7
  const k7 = createK7Layout().berths;
  for (const b of createBayLayout().berths) {
    if (b.size === 'MEGA') continue;
    const ref = k7.find((v) => v.size === b.size);
    assert.equal(b.padLength, ref.padLength);
    assert.equal(b.maxLength, ref.maxLength);
    assert.equal(b.maxBeam, ref.maxBeam);
  }
});

test('pozycje w układzie gry: stacja + (x, −y) ringu; hala gracza pod kątem stacji gry (45°)', () => {
  const hall0 = port.docks.find((d) => d.kind === 'k7' && d.complex === 0);
  const a = Math.atan2(hall0.y - station.y, hall0.x - station.x);
  assert.ok(Math.abs(a - Math.PI / 4) < 1e-6, `kąt hali 0 w grze ${a}`);
  for (const b of port.berths) {
    const r = Math.hypot(b.x - station.x, b.y - station.y);
    assert.ok(r > ring.radii.floorMid && r < ring.radii.rim + 9000, `${b.id}: r = ${r.toFixed(0)}`);
    // podejście z przestrzeni: dalej od planety niż stanowisko
    const ra = Math.hypot(b.approachX - station.x, b.approachY - station.y);
    assert.ok(ra > r - 1, `${b.id}: podejście bliżej planety niż stanowisko`);
  }
});
