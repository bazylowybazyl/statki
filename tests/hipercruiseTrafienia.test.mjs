// Hipercruise (E5, 20–40 tys. j/s — 330–670 j. na krok 60 Hz) a trafienia (E9, 2026-10-22). Cel ruszony w kroku PRZED
// pociskami / rakietami stoi w pozie końca kroku; test trafienia idzie w ruchu względnym (odcinek przesunięty o v_celu·dt).
//   - siatka pocisków: komórki celu obejmują też pozę sprzed kroku (insertSwept) — inaczej szeroka faza gubiła 1–6%
//     trafień w mały kadłub;
//   - zapalnik rakiety na gracza (P2): odcinek lotu w układzie celu — inaczej małe kadłuby gubiły 20–75% trafień.
// Pomiar: node scripts/hipercruise-kolizje-sym.mjs --tryb pociski|rakiety
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const { BulletSpatialGrid } = await import('../src/game/bulletSpatialGrid.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const { SimClock } = await import('../src/game/simClock.js');
const { initRocketSystem3D } = await import('../src/game/rockets/rocketSim.js');

const DT = 1 / 60;

test('siatka pocisków: szybki cel wstawiony z drogą kroku łapie zapytanie odcinkiem przy pozie sprzed kroku', () => {
  // Cel 40 tys. j/s w +x: koniec kroku x = 5600, przed krokiem 4933. Pocisk w poprzek przy x = 4950 (koło celu
  // promienia 90 w pozie końca kroku go nie obejmuje — komórki 4000–5999 tak, ale 3000–3999 nie, więc pocisk
  // przy x = 3990 i cel tuż za granicą komórki pokazują różnicę).
  const grid = new BulletSpatialGrid(1000);
  const target = { x: 4600, y: 0, _blkMaxR: 90 };
  const dx = 40000 * DT;
  grid.insert(target);
  assert.equal(grid.getPotentialTargetsAlongSegment(3990, -200, 3990, 200, 0), 0, 'bez drogi kroku: cel poza zapytaniem');
  grid.clear();
  grid.insertSwept(target, 90, dx, 0);
  assert.equal(grid.getPotentialTargetsAlongSegment(3990, -200, 3990, 200, 0), 1, 'z drogą kroku: cel w zapytaniu');
  assert.equal(grid._resultBuffer[0], target);
  // insert = insertSwept bez drogi
  grid.clear();
  grid.insertSwept(target, 90, 0, 0);
  assert.equal(grid.getPotentialTargetsAlongSegment(3990, -200, 3990, 200, 0), 0);
});

test('pętla pocisków: każdy cel siatki wstawiany z drogą kroku (insertBulletGridTarget)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function bulletsAndCollisionsStep(');
  const body = html.slice(start, html.indexOf('// --- GLOWNA PETLA KOLIZJI ---', start));
  assert.ok(start > 0 && body.length > 0);
  assert.doesNotMatch(body, /SpatialGrid\.insert\(/, 'cel bez drogi kroku');
  const n = (body.match(/insertBulletGridTarget\([^)]*, dt\)/g) || []).length;
  assert.equal(n, 4, 'NPC, wraki, gracz, gracz 2');
  assert.match(html, /function insertBulletGridTarget\(e, dt\) \{\s*stampBulletCollisionRadii\(e\);\s*writeEntityVelocity\(e, _bulletTargetVel\);\s*SpatialGrid\.insertSwept\(e, e\._blkMaxR, _bulletTargetVel\.x \* dt, _bulletTargetVel\.y \* dt\);/);
});

// Rakieta w fazie naprowadzania leci +x 6000 j/s (100 j. na krok) z (0, 0). Cel 40 tys. j/s w −x stoi w pozie końca
// kroku w (−300, 0): na początku kroku był w (367, 0) — przeleciał przez rakietę. Odcinek świata (0 → 100) mija go
// o 300 j. (zapalnik 80), odcinek w układzie celu (−667 → 100) przechodzi przez środek.
function armedRocket(rs, target) {
  const r = rs.fire(0, 0, target, 10, MASTER_WEAPONS.missile_rack, 'red', 0, 0);
  assert.ok(r, 'rakieta w puli');
  r.state = 'POWERED';
  r.guidancePhase = 'intercept';
  r.timeSinceLaunch = 5;
  r.ignitedAt = 0;
  r.interceptAt = 0;
  r.travelDistance = 5000;
  r.maxRange = 1e9;
  r.frameSynced = true;
  r.hitRadius = 80;
  r.position.set(0, 0, 0);
  r.prevTravelPos.set(0, 0, 0);
  r.velocity.set(6000, 0, 0);
  r.frameVel.x = 0; r.frameVel.z = 0;
  r.noseAz = 0;
  return r;
}

test('zapalnik rakiety: gracz w hipercruise (ruszony przed rakietami) — odcinek w układzie celu', () => {
  const hits = [];
  window.applyDamageToPlayer = (dmg) => hits.push(dmg);
  window.applyDamageToNPC = () => hits.push('npc');
  const rs = initRocketSystem3D(null, {});
  const player = { pos: { x: -300, y: 0 }, vel: { x: -40000, y: 0 }, radius: 89, dead: false };
  window.ship = player;
  const r = armedRocket(rs, player);
  SimClock.advance(DT);
  rs.step(DT);
  assert.equal(r.active, false, 'rakieta zdetonowała w kroku przelotu');
  assert.deepEqual(hits, [10], 'trafienie gracza');
  window.ship = null;
});

test('zapalnik rakiety: NPC (rusza się po rakietach) — bez przesunięcia odcinka', () => {
  const hits = [];
  window.applyDamageToPlayer = () => hits.push('gracz');
  window.applyDamageToNPC = () => hits.push('npc');
  window.ship = { pos: { x: 1e6, y: 1e6 }, vel: { x: 0, y: 0 }, radius: 89, dead: false };
  const rs = initRocketSystem3D(null, {});
  const npc = { x: -300, y: 0, vx: -40000, vy: 0, radius: 89, dead: false };
  const r = armedRocket(rs, npc);
  SimClock.advance(DT);
  rs.step(DT);
  assert.equal(r.active, true, 'poza NPC z początku kroku — 300 j. od odcinka, bez detonacji');
  assert.deepEqual(hits, []);
  window.ship = null;
});
