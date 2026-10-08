// Wybuchy WebGPU gry (src/3d/explosions/ — 2026-10-07, zamiast reactorblow.js): receptury i LOD (czyste), reżyser na
// atrapie Core3D — profile dawnej fabryki, poziom szczegółów (gaz / cząstki / samo światło), domeny gazu (łańcuch doku
// dokłada się do żywej domeny, brak wolnej = cząstki bez zabierania żywej, presja skraca życie starszych), fala i gorące
// powietrze w ŚWIECIE gry, światła w siatce, pauza = wybuch stoi, spłaszczony żar (gra z góry), fabryka o sygnaturze
// dawnego `window.makeReactorBlow`.
// node --test tests/explosions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const R = await import('../src/3d/explosions/explosionRecipes.js');
const { ExplosionFx, createExplosionFactory, EXPLOSION_TUNE, EXPLOSION_GRID } = await import('../src/3d/explosions/explosionFx.js');
const { FxPoolOrigin } = await import('../src/3d/fx/gpuPoolOrigin.js');
const { SimClock } = await import('../src/game/simClock.js');

function fakeCore() {
  const cameraOrtho = new THREE.OrthographicCamera(-800, 800, 450, -450, 1, 400000);
  cameraOrtho.position.set(0, 0, 150000);
  cameraOrtho.updateMatrixWorld();
  const calls = { shock: [], heat: [], lights: [] };
  const field = {
    shock(x, y, r, w, s) { calls.shock.push([x, y, r, w, s]); return true; },
    heat(x, y, r, s) { calls.heat.push([x, y, r, s]); return true; }
  };
  const core = {
    scene: new THREE.Scene(),
    steps: [],
    calls,
    activeCam1: { x: 0, y: 0, zoom: 0.3 },
    composerTarget: { width: 1600, height: 900 },
    cameraOrtho,
    cameraPersp: new THREE.PerspectiveCamera(45, 16 / 9, 10, 1e6),
    isFreePerspectiveCamera() { return false; },
    fxDistortion() { return field; },
    addFxStep(step) { this.steps.push(step); return step; },
    fx: {
      origin: new FxPoolOrigin({ name: 'testOrigin' }),
      view: { x0: -3000, y0: -1700, x1: 3000, y1: 1700 },
      removeStep() {}
    }
  };
  return core;
}
const renderer = { computeCalls: 0, compute() { this.computeCalls++; } };
function ctxOf(core) {
  return {
    renderer, core, origin: core.fx.origin, view: core.fx.view,
    grid: { addWorld(x, y, z, range, r, g, b) { core.calls.lights.push([x, y, z, range, r, g, b]); return 0; } }
  };
}
function frame(fx, core, dt = 1 / 60) {
  SimClock.sim += dt;
  const c = ctxOf(core);
  core.steps[0].spawn(c);
  core.steps[0].lights(c);
  core.steps[0].update(c);
}

test('receptury: profile dawnej fabryki (fighter … final), skala liczb, LOD i kadr', () => {
  for (const k of ['fighter', 'escort', 'cruiser', 'capital', 'chain', 'cut', 'final']) {
    const p = R.EXPLOSION_PROFILES[k];
    assert.ok(p && p.fire > 0 && Array.isArray(p.lobes) && Array.isArray(p.jets) && Array.isArray(p.trails), k);
    assert.ok(p.sparks >= 0 && p.light > 0 && p.flash > 0, k);
  }
  assert.equal(R.EXPLOSION_PROFILES.fighter.gas, false, 'drobne błyski rozpadu zawsze z cząstek');
  assert.equal(R.explosionProfile('nieznany'), R.EXPLOSION_PROFILES[R.DEFAULT_EXPLOSION_PROFILE]);
  assert.equal(R.countScale(R.COUNT_REF_SIZE), 1);
  assert.equal(R.countScale(1), 0.25, 'dolna granica');
  assert.equal(R.countScale(1e7), 2.2, 'górna granica');
  // LOD: gaz od GAS_MIN_PX promienia kuli na ekranie, mniejszy — cząstki, poza kadrem — samo światło.
  assert.equal(R.explosionLod(400, 0.3, true, true), R.LOD_GAS);
  assert.equal(R.explosionLod(400, (R.GAS_MIN_PX - 1) / 400, true, true), R.LOD_PARTICLES);
  assert.equal(R.explosionLod(400, 0.3, true, false), R.LOD_PARTICLES);
  assert.equal(R.explosionLod(400, 0.3, false, true), R.LOD_OFF);
  const v = { x0: -1000, y0: -500, x1: 1000, y1: 500 };
  assert.ok(R.explosionInView(v, 1200, 0, 0), 'zapas kadru');
  assert.ok(!R.explosionInView(v, 20000, 0, 100));
  for (let i = 0; i < 50; i++) {
    const n = R.rollRange([2, 4], { next: () => i / 50 });
    assert.ok(n >= 2 && n <= 4);
  }
});

test('reżyser: LOD wybuchu — gaz w kadrze, cząstki małe na ekranie, poza kadrem samo światło', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  assert.ok(fx.spawn(0, 0, 300, 'capital'));
  assert.equal(fx.stats.gas, 1);
  assert.equal(fx.grid.slots.filter((s) => s.active).length, 1);
  core.activeCam1.zoom = 0.01;   // daleko — kula ognia ~5 px
  assert.ok(fx.spawn(500, 0, 300, 'capital'));
  assert.equal(fx.stats.particles, 1);
  assert.ok(fx.spawn(5e6, 5e6, 300, 'capital'), 'poza kadrem wybuch rusza jako światło');
  assert.equal(fx.stats.off, 1);
  assert.equal(fx.spawn(NaN, 0, 300), false);
  assert.equal(fx.spawn(0, 0, 0), false);
  fx.dispose();
});

test('domeny gazu: łańcuch dokłada się do żywej domeny, brak wolnej — cząstki (żywej się nie zabiera), presja skraca życie', () => {
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const S = EXPLOSION_GRID.slots;
  // Wybuchy daleko od siebie: każdy dostaje domenę.
  for (let i = 0; i < S; i++) fx.spawn(i * 20000, 0, 250, 'capital');
  assert.equal(fx.grid.slots.filter((s) => s.active).length, S);
  const born = fx.grid.slots.map((s) => s.born);
  // Kolejny daleko: bez wolnej domeny — cząstki; żadna żywa domena nie została zabrana.
  fx.spawn(-50000, 0, 250, 'capital');
  assert.equal(fx.stats.noSlot, 1);
  assert.deepEqual(fx.grid.slots.map((s) => s.born), born, 'żywe domeny nietknięte');
  // Wybuch blisko środka żywej domeny — dokłada się do niej.
  fx.spawn(20000 + 120, 60, 200, 'capital');
  assert.equal(fx.stats.merged, 1);
  // Po fazie ognia (> 2,2 s) presja skraca życie starszych domen — zwolnią się same.
  for (let i = 0; i < 150; i++) frame(fx, core, 1 / 60);
  const now = fx.grid.time;
  fx.spawn(-90000, 0, 250, 'capital');
  assert.ok(fx.grid.slots.every((s) => !s.active || s.until <= now + 0.41), 'domeny po ogniu wygasają');
  fx.dispose();
});

test('fala (sama refrakcja) i gorące powietrze w ŚWIECIE gry, światło w siatce świateł', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  fx.spawn(1234, -567, 300, 'capital');
  core.calls.shock.length = 0; core.calls.heat.length = 0; core.calls.lights.length = 0;
  frame(fx, core, 0.1);
  assert.ok(core.calls.shock.length >= 1, 'fala');
  assert.deepEqual(core.calls.shock[0].slice(0, 2), [1234, -567], 'fala w świecie gry (x, y)');
  assert.ok(core.calls.heat.length >= 1, 'gorące powietrze');
  assert.deepEqual(core.calls.heat[0].slice(0, 2), [1234, -567]);
  assert.ok(core.calls.lights.length >= 1, 'światło w siatce');
  assert.deepEqual(core.calls.lights[0].slice(0, 2), [1234, -567], 'światło w świecie gry');
  // Przełączniki działają także na żywe wybuchy (A/B tej samej klatki).
  EXPLOSION_TUNE.shock = false;
  EXPLOSION_TUNE.gas = false;
  core.calls.shock.length = 0;
  frame(fx, core, 0.05);
  assert.equal(core.calls.shock.length, 0);
  assert.equal(fx.meshes.back.visible || fx.meshes.front.visible, false, 'gaz schowany');
  EXPLOSION_TUNE.shock = true;
  EXPLOSION_TUNE.gas = true;
  fx.dispose();
});

test('pauza: zegar gry stoi — wybuch stoi (gaz bez kroków, emitery bez zmian)', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  fx.spawn(0, 0, 300, 'capital');
  frame(fx, core, 1 / 60);
  const t = fx.time;
  const em = fx.director.stats.emitters;
  const calls = renderer.computeCalls;
  for (let i = 0; i < 10; i++) frame(fx, core, 0);
  assert.equal(fx.time, t);
  assert.equal(fx.director.stats.emitters, em);
  assert.equal(fx.grid.stats.substeps, 0, 'bez kroku symulacji gazu w pauzie');
  assert.ok(renderer.computeCalls - calls <= 10, 'najwyżej objętość światła i żar co klatkę');
  fx.dispose();
});

test('żar gry z góry: spłaszczony wyrzut i start rozrzucony w kuli ognia (uniformy paczek)', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  fx.spawn(0, 0, 300, 'capital');
  // Pierwsza paczka żaru porywanego przez gaz: spłaszczenie < 1 i promień startu > 0 trafiają do uniformów emisji.
  const b = fx.embers._bursts.slice(0, fx.embers._nBursts).find((q) => q.slot >= 0);
  assert.ok(b, 'paczka żaru w domenie');
  assert.ok(b.flat < 0.5 && b.r0 > 0, `flat ${b.flat}, r0 ${b.r0}`);
  frame(fx, core, 1 / 60);
  const E = fx.embers.U.bE.array;
  assert.ok(E.some((v) => v.x < 0.5 && v.y > 0), 'bE: spłaszczenie i rozrzut startu');
  assert.ok(fx.embers.U.fadeIn.value > 0.05, 'narastanie jasności żaru (tarcza w bloomie)');
  fx.dispose();
});

test('fabryka: sygnatura dawnego window.makeReactorBlow ({ x, y, size, profile }) i reżyser w spawn.system', () => {
  const core = fakeCore();
  const spawn = createExplosionFactory(core, {});
  assert.equal(typeof spawn, 'function');
  assert.ok(spawn.system instanceof ExplosionFx);
  assert.equal(window.__explosions, spawn.system);
  assert.equal(core.steps.length, 1);
  assert.equal(core.steps[0].name, 'wybuchy');
  for (const k of ['spawn', 'lights', 'update', 'warm']) assert.equal(typeof core.steps[0][k], 'function', k);
  frame(spawn.system, core, 0);
  assert.equal(spawn({ x: 0, y: 0, size: 380 }), true, 'bez profilu — domyślny');
  assert.equal(spawn({ x: 0, y: 0, size: 40, profile: 'fighter' }), true);
  assert.equal(spawn({ x: 0, y: 0, size: 300, profile: 'final', vx: 120, vy: -40 }), true, 'z nośnikiem');
  EXPLOSION_TUNE.enabled = false;
  assert.equal(spawn({ x: 0, y: 0, size: 300 }), false, 'wyłączone');
  EXPLOSION_TUNE.enabled = true;
  assert.equal(createExplosionFactory(null), null);
  spawn.system.dispose();
});
