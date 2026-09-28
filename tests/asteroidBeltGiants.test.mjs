// Olbrzymy pasa w grze (zadanie 21, src/game/asteroidBeltGiants.js): miejsca jak w demie
// dema/asteroidy-webgpu, budowa na żądanie i kolizje kadłubów z przekrojem SDF (z = 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BeltGiants, planBeltGiantSites, BELT_GIANTS_CONFIG } from '../src/game/asteroidBeltGiants.js';
import { buildGiantPlan, GiantRock, GIANT_PRESET_IDS, fillGiantGrid } from '../src/game/asteroidGiants.js';
import { createNpcCollisionBody, loadNpcCollisionBody, storeNpcCollisionBody } from '../src/game/npcCollisionBody.js';
import * as DEMO from '../dema/asteroidy-webgpu/world.js';
import { wallGiant, syncBuilderFactory, wallBeltGiants } from './helpers/beltGiantWall.mjs';

// Olbrzym-ściana (lita skała dla x lokalnego ≥ 0) — tests/helpers/beltGiantWall.mjs.
const wallBelt = (presetId = 'arch', x = 1000, y = -2000, counter = { n: 0 }) => wallBeltGiants(presetId, x, y, counter);

function atlasBody(x, y, vx = 900) {
  return { pos: { x, y }, vel: { x: vx, y: 0 }, angle: 0, w: 1800, h: 806, radius: 0 };
}

test('giant sites are deterministic and the first one is the demo field giant (Labyrinth)', () => {
  const opts = { sunX: DEMO.SUN.x, sunY: DEMO.SUN.y, au: DEMO.AU };
  const a = planBeltGiantSites(DEMO.field, opts);
  const b = planBeltGiantSites(DEMO.field, opts);
  assert.deepEqual(a.map((s) => [s.id, s.x, s.y]), b.map((s) => [s.id, s.x, s.y]));
  assert.equal(a.length, BELT_GIANTS_CONFIG.presets.length, 'po olbrzymie na preset');
  assert.deepEqual(a.map((s) => s.id).sort(), [...GIANT_PRESET_IDS].sort(), 'każdy preset raz');
  const g = DEMO.FIELD_GIANTS[0];
  assert.equal(a[0].id, g.id);
  assert.equal(a[0].seed, g.seed);
  assert.ok(Math.abs(a[0].x - g.x) < 1e-6 && Math.abs(a[0].y - g.y) < 1e-6, 'Labirynt gry = Labirynt dema');
  // Rdzenie rozłożone po pasie (≥ minSepRad kąta), olbrzymy nie nachodzą na siebie.
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const d = Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y);
      assert.ok(d > 200000, `${a[i].id} i ${a[j].id} daleko od siebie (${Math.round(d)} j.)`);
    }
  }
});

test('giants build lazily near the point of interest and collide only when ready', () => {
  const counter = { n: 0 };
  const giants = new BeltGiants({
    field: null,
    sites: [{ id: 'arch', seed: 1, x: 0, y: 0 }],
    createBuilder: syncBuilderFactory(wallGiant, counter)
  });
  assert.equal(giants.readyCount, 0);
  const far = atlasBody(-400, 0);
  assert.equal(giants.collideShip(far), 0, 'bez siatki bez kolizji');
  assert.deepEqual(far.pos, { x: -400, y: 0 });
  assert.equal(giants.requestNear(BELT_GIANTS_CONFIG.buildRange * 3, 0), 0, 'daleko — bez budowy');
  assert.equal(counter.n, 0);
  assert.equal(giants.requestNear(0, BELT_GIANTS_CONFIG.buildRange * 0.5), 1, 'blisko — budowa');
  assert.equal(giants.requestNear(0, 0), 0, 'drugi raz nie buduje');
  assert.equal(counter.n, 1);
  assert.equal(giants.readyCount, 1);
});

test('ship hitting a giant wall is pushed out along the SDF normal and bounces', () => {
  const giants = wallBelt('arch', 1000, -2000);
  const G = giants.entries[0].giant;
  const R = 806 * BELT_GIANTS_CONFIG.hullCircleRadius;
  // Dziób (ostatnie koło, środek o L/2 − R przed środkiem statku) wbity 50 j. w ścianę.
  const body = atlasBody(G.x - (900 - R) - R + 50, G.y + 300);
  const depth = giants.collideShip(body);
  assert.ok(Math.abs(depth - 50) < 4, `głębokość wbicia ~50 j. (${depth.toFixed(2)})`);
  const noseX = body.pos.x + (900 - R);
  assert.ok(G.x - noseX >= R - 4, 'dziób wypchnięty przed ścianę');
  assert.ok(Math.abs(body.pos.y - (G.y + 300)) < 1e-6, 'wypchnięcie wzdłuż normalnej (bez ruchu w bok)');
  assert.ok(Math.abs(body.vel.x - (900 - BELT_GIANTS_CONFIG.bounce * 900)) < 1e-6, 'składowa w głąb odbita (×0,3)');
  assert.equal(giants.stats.collisions, 1);
  // Lot od ściany: bez zmiany prędkości.
  const away = atlasBody(body.pos.x, body.pos.y, -500);
  giants.collideShip(away);
  assert.equal(away.vel.x, -500, 'prędkość od ściany nietknięta');
});

test('fast ship stepped into a wall never tunnels through it', () => {
  const giants = wallBelt('warren', 0, 0);
  const G = giants.entries[0].giant;
  const R = 806 * BELT_GIANTS_CONFIG.hullCircleRadius;
  const body = atlasBody(G.x - 3000, G.y, 2400);
  const dt = 1 / 120;
  let maxNose = -Infinity;
  for (let i = 0; i < 600; i++) {
    body.vel.x = 2400;
    body.pos.x += body.vel.x * dt;
    body.pos.y += body.vel.y * dt;
    giants.collideShip(body);
    maxNose = Math.max(maxNose, body.pos.x + (900 - R) + R - G.x);
  }
  assert.ok(maxNose <= 5, `dziób nie wchodzi w skałę (max ${maxNose.toFixed(2)} j.)`);
  assert.ok(body.pos.x < G.x, 'statek zostaje przed ścianą');
});

test('wide hulls are not deeper in the rock than the SDF band allows', () => {
  // Szczelina: pasmo 6 × 64 = 384 j.; megafrachtowiec h ≈ 1520 → R ≈ 700 > pasmo.
  const giants = wallBelt('crevasse', 0, 0);
  const G = giants.entries[0].giant;
  const h = 1520;
  const R = h * BELT_GIANTS_CONFIG.hullCircleRadius;
  assert.ok(R > G.band, 'przypadek testowy: koło większe niż pasmo');
  // Kadłub bokiem do ściany (kąt π/2), burta 150 j. w skale.
  const body = { pos: { x: G.x - R + 150, y: 0 }, vel: { x: 300, y: 0 }, angle: Math.PI / 2, w: 4600, h, radius: 0 };
  const depth = giants.collideShip(body);
  assert.ok(depth > 100, `kolizja wykryta (${depth.toFixed(1)} j.)`);
  assert.ok(G.x - body.pos.x >= R - 4, `burta wypchnięta przed ścianę (${(G.x - body.pos.x).toFixed(1)} ≥ ${R.toFixed(1)})`);
  assert.ok(body.vel.x < 0, 'odbicie');
});

test('NPC collides through the kinematics view (x/vx canonical, pos/vel mirror)', () => {
  const giants = wallBelt('arch', 0, 0);
  const G = giants.entries[0].giant;
  const npc = { x: G.x - 450, y: 0, vx: 400, vy: 0, angle: 0, w: 1040, h: 440, radius: 220, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } };
  const body = createNpcCollisionBody();
  const depth = giants.collideShip(loadNpcCollisionBody(body, npc));
  assert.ok(depth > 0);
  storeNpcCollisionBody(body, npc);
  const R = 440 * BELT_GIANTS_CONFIG.hullCircleRadius;
  assert.ok(G.x - (npc.x + (520 - R)) >= R - 4, 'NPC wypchnięty przed ścianę');
  assert.ok(npc.vx < 0, 'NPC odbity');
  assert.equal(npc.pos.x, npc.x, 'lustro pos');
  assert.equal(npc.vel.x, npc.vx, 'lustro vel');
});

test('bullets stop in rock (pointBlocked) and roofAbove sees rock over the plane', () => {
  const giants = wallBelt('arch', 1000, -2000);
  const G = giants.entries[0].giant;
  assert.equal(giants.pointBlocked(G.x + 500, G.y), true, 'w skale');
  assert.equal(giants.pointBlocked(G.x - 500, G.y), false, 'w próżni');
  assert.equal(giants.pointBlocked(G.x + 40000, G.y), false, 'poza obrysem');
  assert.equal(giants.roofAbove(G.x + 500, G.y), true);
  assert.equal(giants.roofAbove(G.x - 500, G.y), false);
});

test('real giant grid (Arch): a ship flying into the rock stops at its wall', () => {
  // Prawdziwa siatka SDF (sekundy CPU) — jeden, najmniejszy preset.
  const giants = new BeltGiants({
    field: null,
    sites: [{ id: 'arch', seed: 1, x: 0, y: 0 }],
    createBuilder: syncBuilderFactory((id, seed, x, y) => {
      const g = new GiantRock(buildGiantPlan(id, seed), x, y);
      fillGiantGrid(g.plan, g.grid, g.dims);
      g.ready = true;
      return g;
    }, { n: 0 })
  });
  giants.requestNear(0, 0);
  const G = giants.entries[0].giant;
  let solid = null;
  for (let x = -G.plan.half[0]; x < G.plan.half[0] && !solid; x += 40) {
    if (G.sampleWorld(x, 0, 0) < -200) solid = { x, y: 0 };
  }
  assert.ok(solid, 'lita skała na osi bryły');
  const R = 806 * BELT_GIANTS_CONFIG.hullCircleRadius;
  const body = atlasBody(solid.x - 900 - 400, solid.y, 900);
  for (let i = 0; i < 240; i++) {
    body.vel.x = 900;
    body.pos.x += body.vel.x / 120;
    body.pos.y += body.vel.y / 120;
    giants.collideShip(body);
  }
  // Każde koło kadłuba poza skałą (SDF środka ≥ R z tolerancją kwantyzacji siatki).
  let minClear = Infinity;
  for (let k = -2; k <= 2; k++) {
    const off = k * (900 - R) / 2;
    minClear = Math.min(minClear, G.sampleWorld(body.pos.x + off, body.pos.y, 0) - R);
  }
  assert.ok(minClear > -12, `kadłub przy ścianie, nie w skale (zapas ${minClear.toFixed(1)} j.)`);
  assert.ok(body.pos.x + 900 < solid.x + 60, 'dziób nie przeszedł za pierwszą litą skałę');
  assert.ok(giants.stats.collisions > 0);
});
