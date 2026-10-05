// Dym i ogień zniszczeń w grze (src/3d/gas/gasSmokeGame.js, plan zniszczeń § 12): logika CPU na atrapie Core3D —
// obłok pod płaszczyzną gry z nośnikiem wraku, ogniska jadące z wrakiem (pozycja i obrót), zabranie domeny przez
// nowe zdarzenie gasi jej ogniska, wrak zniknął — ogień gaśnie, kurz taranu od progu prędkości, pauza = dym stoi.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { GasSmokeGame, GAS_SMOKE_TUNE } = await import('../src/3d/gas/gasSmokeGame.js');
const { SimClock } = await import('../src/game/simClock.js');
const { CollisionFX } = await import('../src/vfx/collisionFx.js');

function fakeCore() {
  return {
    scene: new THREE.Scene(),
    perfToggles: {},
    steps: [],
    addFxStep(step) { this.steps.push(step); },
    fx: { removeStep() {} }
  };
}
const renderer = { calls: 0, compute() { this.calls++; } };
const ctx = (core) => ({ origin: { x: 0, y: 0 }, renderer, core: { activeCam1: { x: 0, y: 0 } }, grid: null });

let game = null;
let core = null;
function frame(dt = 1 / 60) {
  SimClock.sim += dt;
  core.steps[0].update(ctx(core));
}

test.before(() => {
  core = fakeCore();
  game = new GasSmokeGame(core);
  frame(0);   // pierwszy krok ustawia zegar
});
test.after(() => game.dispose());

test('śmierć okrętu: obłok pod płaszczyzną gry z nośnikiem wraku, ogniska na kadłubie jadą z wrakiem (pozycja i obrót)', () => {
  game.clear();
  const npc = { x: 5000, y: -2000, vx: 60, vy: -25, radius: 150, angle: 0.3 };
  const wreck = { x: 5003, y: -2001, vx: 60, vy: -25, angle: 0.3, beamHull: {} };
  game.shipWrecked(npc, wreck);
  assert.equal(game.stats.events >= 1, true);
  const g = game.grid;
  const s = g.slots.find((q) => q.active);
  assert.ok(s, 'domena zajęta');
  assert.deepEqual([s.vx, s.vy], [60, 25], 'nośnik = prędkość wraku (scena: y odwrócone)');
  assert.ok(s.cz < 0, 'domena pod płaszczyzną gry — kadłub nad dymem');
  assert.ok(game.followers.length >= 1);
  const f = game.followers[0];
  assert.equal(f.entity, wreck);
  frame();
  const d0 = Math.hypot(f.emitter.x - wreck.x, -f.emitter.y - wreck.y);
  // Wrak jedzie i obraca się: ognisko zostaje w tym samym miejscu kadłuba (odległość od środka bez zmian).
  wreck.x += 300; wreck.y -= 120; wreck.angle += 0.9;
  frame();
  const d1 = Math.hypot(f.emitter.x - wreck.x, -f.emitter.y - wreck.y);
  assert.ok(Math.abs(d1 - d0) < 1e-6, `ognisko na kadłubie: ${d0} → ${d1}`);
  // Kierunek płomienia: na zewnątrz w płaszczyźnie i lekko pod nią (nie słup na kamerę).
  assert.ok(f.uz < 0 && Math.hypot(f.ux, f.uy) > 0.9);
  // Wrak zniknął — ogień gaśnie.
  wreck.beamHull = null;
  frame();
  assert.equal(game.followers.length, 0);
});

test('zabranie domeny przez nowe zdarzenie gasi jej ogniska (nie sterują nośnikiem nowej domeny)', () => {
  game.clear();
  const wreck = { x: 0, y: 0, vx: 40, vy: 0, angle: 0, beamHull: {} };
  game.shipWrecked({ x: 0, y: 0, vx: 40, vy: 0, radius: 150, angle: 0 }, wreck);
  const fires = game.followers.length;
  assert.ok(fires >= 1);
  // Cztery stacje daleko (priorytet 3 > okręt 2): pula 4 domen pełna, domena wraku zabrana.
  for (let i = 1; i <= 4; i++) game.stationDestroyed({ x: i * 1e6, y: 0, r: 324 });
  assert.equal(game.followers.filter((q) => q.entity === wreck).length, 0, 'ogniska wraku zgasły');
  frame();
  for (const s of game.grid.slots) assert.equal(s.vx, 0, 'nośnik stacji nietknięty przez dawne ogniska wraku');
});

test('kurz taranu: od progu prędkości, co najwyżej co dustEvery na parę; pauza (sim stoi) — dym stoi', () => {
  game.clear();
  assert.equal(CollisionFX.listenerCount('impact') >= 1, true, 'dym słucha zdarzeń uderzenia CollisionFX');
  const before = game.stats.dust;
  const A = {};
  game._impact({ A, B: {}, x: 0, y: 0, nx: 1, ny: 0, approachSpeed: 50, contactVelX: 0, contactVelY: 0 });
  assert.equal(game.stats.dust, before, 'poniżej progu — bez kurzu');
  game._impact({ A, B: {}, x: 0, y: 0, nx: 1, ny: 0, approachSpeed: GAS_SMOKE_TUNE.dustMinSpeed + 300, contactVelX: 10, contactVelY: 0 });
  game._impact({ A, B: {}, x: 0, y: 0, nx: 1, ny: 0, approachSpeed: GAS_SMOKE_TUNE.dustMinSpeed + 300, contactVelX: 10, contactVelY: 0 });
  assert.equal(game.stats.dust, before + 1, 'drugi styk tej pary w tej samej chwili pominięty');
  const t0 = game.grid.time;
  core.steps[0].update(ctx(core));   // klatka bez kroku fizyki (pauza)
  assert.equal(game.grid.time, t0, 'czas gazu stoi');
});

test('wyłącznik perfToggles.gasSmoke: bryły schowane, symulacja stoi', () => {
  core.perfToggles.gasSmoke = false;
  const calls = renderer.calls;
  frame();
  assert.equal(renderer.calls, calls);
  assert.equal(game.meshes.back.visible || game.meshes.front.visible, false);
  core.perfToggles.gasSmoke = true;
});
