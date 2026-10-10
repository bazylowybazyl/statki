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
  // poza żywą domeną (w niej mały wybuch dokłada się do gazu bez progu ekranu — test łańcucha niżej)
  assert.ok(fx.spawn(4500, 0, 300, 'capital'));
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
  const S = fx.grid.S;   // wszystkie domeny (atlas podstawowy + „fine”)
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
  // Po fazie ognia (> 2,2 s od OSTATNIEGO zasilenia — scalenia i wtórne też zasilają) presja skraca życie domen —
  // zwolnią się same; domena świeżo zasilona zostaje nietknięta.
  for (let i = 0; i < 150; i++) frame(fx, core, 1 / 60);
  const now = fx.grid.time;
  const fresh = fx.grid.slots.findIndex((s) => !s.active);
  fx.grid.slots[1].fed = now - 0.5;   // jak gdyby scalony wybuch pół sekundy temu
  const until1 = fx.grid.slots[1].until;
  fx.spawn(-90000, 0, 250, 'capital');
  assert.equal(fresh, -1, 'pula pełna');
  assert.ok(fx.grid.slots.every((s, i) => i === 1 || !s.active || now - s.fed <= 2.2 || s.until <= now + 0.41), 'domeny po ogniu wygasają');
  assert.equal(fx.grid.slots[1].until, until1, 'domena zasilona 0,5 s temu nietknięta');
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

test('F1 (2026-10-08, poprawki przeglądu): scalanie i dziedziczenie tylko, gdy KULA mieści się w kole życia gazu domeny i ma ≥ 3 komórki; wtórne bez progu ekranu', async () => {
  const { FIT_RR, MERGE_MIN_R_CELLS } = await import('../src/3d/explosions/explosionFx.js');
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const g = fx.grid;
  // 12 wybuchów kawałków doku (size 250 → R 400) na okręgu, na którym kula jeszcze mieści się w kole życia gazu:
  // jedna domena, zero cząstek.
  fx.spawn(0, 0, 250, 'capital');
  const s0 = g.slots.findIndex((s) => s.active);
  const h = g.slots[s0].h;
  const half = h * g.N * 0.5;
  const lim = FIT_RR * half - 2 * h - 400;   // największa odległość środka kuli od środka domeny
  assert.ok(lim > 0);
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * Math.PI * 2;
    fx.spawn(Math.cos(a) * lim * 0.95, Math.sin(a) * lim * 0.95, 250, 'capital');
  }
  assert.equal(g.slots.filter((s) => s.active).length, 1, '12 wybuchów w kole życia domeny = 1 domena');
  assert.equal(fx.stats.merged, 11);
  assert.equal(fx.stats.particles, 0);
  // Dawny zakres (pudło: |dx|, |dy| ≤ pół boku − R − 2h) w rogu — kula w pasie wygaszania: osobna domena, nie scalenie.
  const m = half - 400 - 2 * h;
  fx.spawn(m, -m, 250, 'capital');
  assert.equal(fx.stats.merged, 11, 'róg pudła już się nie scala');
  assert.equal(g.slots.filter((s) => s.active).length, 2);
  // Kula drobniejsza niż MERGE_MIN_R_CELLS komórek domeny: nie scala się (w cudzej domenie znikała), daleki zoom — cząstki.
  core.activeCam1.zoom = 0.02;
  const p0 = fx.stats.particles;
  fx.spawn(30, -30, (MERGE_MIN_R_CELLS * h * 0.6) / 1.1, 'fighter');   // fighter: zawsze cząstki — kontrola
  fx.spawn(30, -30, (MERGE_MIN_R_CELLS * h * 0.6) / 1.15, 'chain');    // R = 0,6 · 3 komórki
  assert.equal(fx.stats.merged, 11, 'drobna kula nie scala się');
  assert.equal(fx.stats.particles - p0, 2, 'drobne — cząstki');
  // Wtórne: daleki zoom (kula wtórnego ~3 px) — gaz w domenie rodzica, bo kula mieści się w jej kole życia.
  const inh0 = fx.stats.inherited;
  const sec0 = fx.stats.secondaries;
  for (let i = 0; i < 160; i++) frame(fx, core, 1 / 60);
  assert.ok(fx.stats.secondaries > sec0, 'wtórne wybuchły');
  assert.ok(fx.stats.inherited - inh0 >= (fx.stats.secondaries - sec0) - 2, 'wtórne prawie wszystkie w domenie rodzica');
  // Wtórny poza kołem życia rodzica — bez dziedziczenia (daleki zoom: cząstki).
  const inh1 = fx.stats.inherited;
  fx._spawn(half * 0.95, 0, 120, { fire: 1, gas: true, power: 0.8, lobes: [1, 1], trails: [0, 0], jets: [0, 0], sparks: 0, embers: 0, chunks: 0, smoke: 0.7, flash: 0, light: 0.5, shock: 0, haze: 0, secondaries: [0, 0], afterburn: 0, life: 0.7 }, 0, 0, s0, 0.75);
  assert.equal(fx.stats.inherited, inh1, 'wtórny przy brzegu domeny nie dziedziczy');
  // Kula drobna względem domeny (< MERGE_MIN_CELLS komórek), na ekranie duża, wolna domena jest — własna domena.
  core.activeCam1.zoom = 0.3;
  const n0 = g.slots.filter((s) => s.active).length;
  fx.spawn(30, 30, 40, 'escort');   // R 52 j. przy komórce ~22 j.
  assert.equal(g.slots.filter((s) => s.active).length, n0 + 1, 'ostrzejsza kula w osobnej domenie');
  fx.dispose();
});

test('F1/F15 (poprawki przeglądu): wygaszana domena nie bierze świeżej kuli, gdy jest wolna; bez wolnej — odżywa od razu (zanik dymu 0, obraz w ~0,1 s)', () => {
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const g = fx.grid;
  fx.spawn(0, 0, 250, 'capital');
  const s0 = g.slots.findIndex((s) => s.active);
  // Do głębokiego wygaszania (życie 3 s od ostatniego zasilenia — wtórne zasilają — + część z 1,6 s).
  for (let i = 0; i < 60 * 8 && !(g.slots[s0].active && g.slots[s0].fade < 0.3 && g.slots[s0].fade > 0); i++) frame(fx, core, 1 / 60);
  assert.ok(g.slots[s0].active && g.slots[s0].fade < 0.3, `wygasza się (fade ${g.slots[s0].fade})`);
  // Wolne domeny są: świeża kula w środku wygaszanej domeny dostaje WŁASNĄ.
  const m0 = fx.stats.merged;
  fx.spawn(0, 0, 250, 'capital');
  assert.equal(fx.stats.merged, m0, 'bez scalenia do wygaszanej, gdy jest wolna');
  assert.equal(g.slots.filter((s) => s.active).length, 2);
  // Bez wolnych: scalenie do wygaszanej — zanik dymu wyzerowany od razu, obraz wraca w ~0,1 s.
  for (const s of g.slots) if (!s.active) { s.active = true; s.until = 1e9; s.fed = g.time; s.cx = 1e7; s.cy = 1e7; s.fade = 1; }
  const fadeBefore = g.slots[s0].fade;
  fx.spawn(0, 0, 250, 'capital');
  assert.equal(fx.stats.merged, m0 + 1, 'bez wolnej — scalenie');
  assert.equal(g.slots[s0].extraDecay, 0, 'zanik dymu wyzerowany od razu');
  for (let i = 0; i < 6; i++) frame(fx, core, 1 / 60);
  assert.ok(g.slots[s0].fade >= Math.min(1, fadeBefore + 0.9), `obraz wraca w ~0,1 s (${g.slots[s0].fade})`);
  fx.dispose();
});

test('strojenie gazu wybuchów (etap A 2026-10-08): MacCormack prędkości, zbite wiry i turbulencja, gąbka, kurczenie, narzucenie gaśnie', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, {});
  const T = fx.grid.tune;
  assert.equal(T.velMacCormack, 1);
  assert.ok(T.vorticity <= 1.5 && T.turbulence <= 15, 'przy MacCormacku 3,5 / 35 dawało wzrost energii (sonda)');
  assert.ok(T.sponge > 0);
  assert.ok(T.drag > 0 && T.dragQuad > 0, 'opór w środku zostaje — bez niego niedobieżność rzutu rosła');
  assert.ok(T.contraction > 0);
  // Korekta dymu po MacCormacku (masa kuli okrętu w 1–3 s wróciła do bazy): szybszy zanik, mniej sadzy i rozprężania.
  assert.ok(T.smokeDecay > 0.42 && T.soot < 0.42 && T.disperse < 0.16, 'dym rozchodzi się i znika (2026-10-07)');
  assert.ok(fx.director.tune.velTau > 0);
  // Decyzja użytkownika 2026-10-08: 8–10 domen (6 → 8–10); etap D — trzy atlasy, razem ≥ 10 domen wybuchów, podstawowy ≥ 4
  // (wystrzały i zapłony — tylko tam: sufit wystrzałów 3).
  const G = EXPLOSION_GRID;
  assert.ok(G.slots + G.fineSlots + G.coarseSlots >= 10 && G.slots > EXPLOSION_TUNE.muzzleDomains, 'domeny wybuchów');
  fx.dispose();
});

test('F1: bez wolnej domeny nowy wybuch przejmuje domenę w końcówce wygaszania (obraz ≤ FADE_RECLAIM), żywej nie zabiera', async () => {
  const { FADE_RECLAIM } = await import('../src/3d/explosions/explosionFx.js');
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const S = fx.grid.S;
  for (let i = 0; i < S; i++) fx.spawn(i * 20000, 0, 250, 'capital');
  // Pełna pula, domeny żywe: cząstki, bez przejęcia.
  fx.spawn(-50000, 0, 250, 'capital');
  assert.equal(fx.stats.reclaimed, 0);
  assert.equal(fx.stats.noSlot, 1);
  // Do końcówki wygaszania wszystkich domen (życie 3 s + 80% z 1,6 s).
  for (let i = 0; i < 60 * 4.45; i++) frame(fx, core, 1 / 60);
  const fading = fx.grid.slots.filter((s) => s.active && s.fade <= FADE_RECLAIM);
  assert.ok(fading.length > 0, 'są domeny w końcówce wygaszania');
  const noSlot0 = fx.stats.noSlot;   // wtórne wybuchu z cząstek też szukały domeny
  // Stare źródła każdej domeny (ognisko) i wtórne w kolejce celujące w każdą domenę — przejęta domena ma je stracić.
  const old = [];
  for (let k = 0; k < S; k++) {
    const e = fx.director.fire(k, k * 20000, 0, 0, 30, 0.5, { keep: -10 });   // keep < 0: bez przedłużania domeny
    if (e) old.push([e, k]);
    const q = fx.qN++;
    fx.qT[q] = fx.time + 100; fx.qX[q] = k * 20000; fx.qY[q] = 0;
    fx.qS[q * 4] = 50; fx.qS[q * 4 + 1] = k; fx.qS[q * 4 + 2] = 0; fx.qS[q * 4 + 3] = 0;
  }
  const qBase = fx.qN - S;
  const t0 = fx.director.time;
  assert.ok(fx.spawn(-90000, 0, 250, 'capital'));
  assert.equal(fx.stats.reclaimed, 1, 'przejęta domena w końcówce wygaszania');
  assert.equal(fx.stats.noSlot, noSlot0, 'bez nowego noSlot');
  const k = fx.grid.slots.findIndex((s) => s.active && Math.abs(s.cx + 90000) < 1);
  assert.ok(k >= 0, 'nowy wybuch w przejętej domenie');
  for (const [e, slot] of old) {
    if (slot === k) assert.ok(!e.alive || e.t0 >= t0, 'stare źródło przejętej domeny zgaszone (dropSlot)');
    else assert.ok(e.alive, 'źródła innych domen żyją');
  }
  for (let j = 0; j < S; j++) assert.equal(fx.qS[(qBase + j) * 4 + 1], j === k ? -1 : j, 'wtórne celujące w przejętą domenę bez dziedziczenia');
  fx.dispose();
});

test('A2 (zbiornik paliwa): strumienie wzdłuż osi kadłuba z miejsca wybuchu, pierwszy z paliwem, własny zanik narzucenia', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  // Oś kadłuba w świecie gry: 30° (y w dół ekranu jak w grze) — scena ma (x, −y).
  const ax = Math.cos(Math.PI / 6), ay = Math.sin(Math.PI / 6);
  assert.ok(fx.spawn(0, 0, 300, 'capital', 0, 0, { axisX: ax * 5, axisY: ay * 5, jetVelTau: 0.6 }));
  const jets = fx.director.emitters.filter((e) => e.alive && e.jet);
  assert.ok(jets.length >= 3, `strumienie: ${jets.length}`);
  for (const e of jets) {
    const l = Math.hypot(e.jx, e.jy);
    const c = Math.abs((e.jx * ax + e.jy * -ay) / l);   // |cos| kąta do osi (oba zwroty)
    assert.ok(c > Math.cos(0.23), `strumień wzdłuż osi (cos ${c.toFixed(3)})`);
    assert.equal(e.velTau, 0.6, 'zanik narzucenia strumienia zbiornika');
  }
  // Na przemian rufa / dziób: są oba zwroty, pierwszy (rufa) z paliwem.
  const signs = jets.map((e) => Math.sign(e.jx * ax + e.jy * -ay));
  assert.ok(signs.includes(1) && signs.includes(-1), 'oba zwroty osi');
  assert.ok(jets[0].fuel > 0 && signs[0] < 0, 'pierwszy strumień ku rufie, z paliwem');
  // Bez osi: strumienie z zanikiem reżysera (−1), opcje nie przechodzą na kolejny wybuch.
  assert.ok(fx.spawn(20000, 0, 300, 'capital'));
  const plain = fx.director.emitters.filter((e) => e.alive && e.jet && Math.abs(e.x - 20000) < 2000);
  for (const e of plain) assert.equal(e.velTau, -1);
  assert.equal(fx._optAxis, false);
  fx.dispose();
});

test('A2: per-emiter velTau strumienia — narzucenie prędkości bije dłużej niż przy zaniku reżysera', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const slot = fx.grid.acquire(0, 0, 0, 200, { size: 1000, life: 10, now: fx.grid.time });
  const d = fx.director;
  const a = d.jet(slot, 0, 0, 0, 1, 0, 0, 10, 30, 900, 2, { velBlend: 36, velTau: 0.6 });
  const b = d.jet(slot, 0, 50, 0, 1, 0, 0, 10, 30, 900, 2, { velBlend: 36 });
  for (let i = 0; i < 30; i++) d.update(1 / 60);   // 0,5 s
  const blendOf = (k) => fx.grid._src[k * 18 + 14];
  const n = fx.grid._srcN;
  assert.ok(n >= 2);
  // Ostatnia klatka: źródło a (velTau 0,6) ma większe narzucenie niż b (velTau reżysera 0,15).
  const va = blendOf(n - 2), vb = blendOf(n - 1);
  assert.ok(va > vb * 2, `velBlend a ${va.toFixed(2)} vs b ${vb.toFixed(2)}`);
  fx.dispose();
});

test('A2: sam gaz (detonacja rdzenia) — domena z barwą dymu, bez błysku, świateł, fali, iskier i wtórnych; bez domeny nic', () => {
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const tint = [0.7, 0.9, 1.0];
  assert.ok(fx.spawn(0, 0, 300, 'capital', 0, 0, { gasOnly: true, tint }));
  assert.equal(fx.stats.gasOnly, 1);
  const s = fx.grid.slots.find((q) => q.active);
  assert.deepEqual([...s.tint], tint, 'barwa dymu domeny');
  assert.equal(fx.flashes.n, 0, 'bez błysku');
  assert.equal(fx.qN, 0, 'bez wtórnych');
  assert.equal(fx.fN, 0, 'bez płonących odłamków dymu rakiet');
  frame(fx, core, 1 / 60);
  assert.equal(core.calls.lights.length, 0, 'bez świateł');
  assert.equal(core.calls.shock.length + core.calls.heat.length, 0, 'bez fali i gorącego powietrza');
  // Następny zwykły wybuch: barwa domyślna (opcja nie przechodzi).
  fx.spawn(30000, 0, 300, 'capital');
  const s2 = fx.grid.slots.find((q) => q.active && Math.abs(q.cx - 30000) < 3000);
  assert.deepEqual([...s2.tint], [1, 1, 1]);
  // Daleko (cząstki) — sam gaz nie rusza.
  core.activeCam1.zoom = 0.005;
  assert.equal(fx.spawn(-60000, 0, 300, 'capital', 0, 0, { gasOnly: true, tint }), false);
  fx.dispose();
});

test('A2: wybuch wraku w ruchu — źródła gazu i łby odłamków jadą z nośnikiem domeny (stojąca domena bez zmian)', async () => {
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  assert.equal(fx.director.tune.followCarrier, true, 'reżyser wybuchów gry: źródła z nośnikiem');
  const { GasExplosions } = await import('../src/3d/gas/gasExplosions.js');
  assert.equal(new GasExplosions({ grid: null, rng: { next: () => 0.5 } }).tune.followCarrier, false, 'domyślnie (dym wraków, dema) — bez zmian');
  fx.spawn(0, 0, 300, 'capital', 400, 0);
  fx.spawn(50000, 0, 300, 'capital', 0, 0);
  const moving = fx.director.emitters.filter((e) => e.alive && Math.abs(e.x) < 5000 && !e.trail);
  const still = fx.director.emitters.filter((e) => e.alive && Math.abs(e.x - 50000) < 5000 && !e.trail);
  const x0m = moving.map((e) => e.x), x0s = still.map((e) => e.x);
  // 10 klatek (przed wtórnymi — te biorą zwolnione emitery z puli)
  for (let i = 0; i < 10; i++) frame(fx, core, 1 / 60);
  moving.forEach((e, i) => { if (e.alive) assert.ok(Math.abs(e.x - x0m[i] - 400 * 10 / 60) < 0.5, `źródło jedzie z nośnikiem: ${e.x - x0m[i]}`); });
  still.forEach((e, i) => { if (e.alive) assert.equal(e.x, x0s[i], 'domena stojąca — źródło w miejscu'); });
  // Żar: nośnik domeny w uniformie, łby odłamków (bez porwania) z kodem −2 − domena.
  const k = fx.grid.slots.findIndex((s) => s.active && Math.abs(s.vx - 400) < 1e-6);
  assert.ok(k >= 0);
  assert.ok(Math.abs(fx.embers.U.slotVel.array[k].x - 400) < 1e-6, 'nośnik domeny w uniformie żaru');
  fx.embers.burst(0, 0, 0, 1, 0, 0, 0, 1, 10, 10, 1, 1, 1, 2, -1, 1, 0, k);
  assert.equal(fx.embers._bursts[fx.embers._nBursts - 1].slot, -2 - k);
  fx.embers.burst(0, 0, 0, 1, 0, 0, 0, 1, 10, 10, 1, 1, 1, 2, -1);
  assert.equal(fx.embers._bursts[fx.embers._nBursts - 1].slot, -1, 'bez nośnika — jak dawniej');
  fx.dispose();
});

test('etap B: światło wybuchu w siatce ma właściciela = domenę gazu (w swoim dymie tylko daleko), przełącznik gridLight i otoczenie ze strefy nieba', async () => {
  const { GAS_LIGHT_OWNER_BASE } = await import('../src/3d/gas/gasVolume.js');
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  fx.spawn(0, 0, 300, 'capital');
  fx.spawn(400000, 0, 300, 'capital');   // druga domena
  core.activeCam1.zoom = 0.0005;
  fx.spawn(-800000, 0, 300, 'capital');  // cząstki (bez domeny)
  core.activeCam1.zoom = 0.3;
  const owners = [];
  const c = ctxOf(core);
  c.grid = { addWorld(x, y, z, range, r, g, b, sc, dx, dy, dz, co, ci, fl, sh, owner) { owners.push([x, owner]); return 0; } };
  SimClock.sim += 0.05;
  core.steps[0].spawn(c); core.steps[0].lights(c); core.steps[0].update(c);
  const ownerAt = (x) => owners.find((o) => Math.abs(o[0] - x) < 1)?.[1];
  const slotAt = (x) => fx.grid.slots.findIndex((q) => q.active && Math.abs(q.cx - x) < 5000);
  assert.ok(slotAt(0) >= 0 && slotAt(400000) >= 0 && slotAt(0) !== slotAt(400000));
  assert.equal(ownerAt(0), GAS_LIGHT_OWNER_BASE + slotAt(0));
  assert.equal(ownerAt(400000), GAS_LIGHT_OWNER_BASE + slotAt(400000));
  assert.equal(ownerAt(-800000), 0, 'wybuch z cząstek — bez właściciela (oświetla każdy dym)');
  // Przełącznik A/B i strefa nieba (window.getSkyRegion — jasność tła) → uniformy marszu.
  window.getSkyRegion = () => 0.55;
  EXPLOSION_TUNE.gridLight = false;
  frame(fx, core, 1 / 60);
  assert.equal(fx.volume.gridEnabled, false);
  assert.ok(Math.abs(fx.volume.U.ambientK.value - 0.55) < 1e-6, 'pas asteroid — ciemniejsze otoczenie');
  EXPLOSION_TUNE.gridLight = true;
  delete window.getSkyRegion;
  frame(fx, core, 1 / 60);
  assert.equal(fx.volume.gridEnabled, true);
  assert.equal(fx.volume.U.ambientK.value, 1);
  fx.dispose();
});

test('etap B (pkt 4): błysk wybuchu jedzie z nośnikiem (wrak w ruchu), stojący wybuch bez zmian', () => {
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  fx.spawn(1000, 2000, 300, 'capital', 250, -120);
  fx.spawn(-50000, 0, 300, 'capital');
  assert.equal(fx.flashes.n, 2);
  const cam = core.cameraOrtho;
  fx.flashes.update(0.2, cam);
  const A = fx.flashes.aA.array, o0 = fx.grid.origin;
  const pts = [[A[0] + o0.x, A[1] + o0.y], [A[4] + o0.x, A[5] + o0.y]];
  const moving = pts.find((p) => Math.abs(p[0] - 1000) < 200);
  const still = pts.find((p) => Math.abs(p[0] + 50000) < 200);
  assert.ok(Math.abs(moving[0] - (1000 + 250 * 0.2)) < 1e-3, 'x sceny = x gry + vx · wiek');
  assert.ok(Math.abs(moving[1] - (-2000 + 120 * 0.2)) < 1e-3, 'y sceny = −(y gry + vy · wiek)');
  assert.deepEqual(still, [-50000, 0]);
  fx.dispose();
});

test('etap B (F10): obraz gry — blask ognia w dymie silniejszy niż w demach, siatka świateł z kolanem i samocieniem', async () => {
  const { tuneLookForGame } = await import('../src/3d/explosions/explosionFx.js');
  const { createGasLook } = await import('../src/3d/gas/gasVolume.js');
  const base = createGasLook();
  const L = tuneLookForGame(createGasLook());
  assert.ok(L.glowGain >= 2 && L.glowGain <= 4 && L.glowGain > base.glowGain, 'blask ognia (gaśnie z ogniem)');
  assert.ok(L.gridKnee >= 0.3 && L.gridShadow >= 0.5, 'kolano i samocień świateł siatki (bez „waty” pod reflektorem)');
  assert.ok(L.ownNear > 0.2 && L.ownFar > L.ownNear, 'własne światło wybuchu tylko w dalekim polu');
});

// ── Etap E1 (2026-10-09): gaz przy wystrzale z lufy — armata i Yamato (niebieski ogień) ─────────────────────────────

// Atrapa WeaponFx (hak muzzleGas) i wylot.
const mzWfx = () => ({ muzzleGas: null });
const shooterOf = (key) => ({ beamHull: { dmgKey: key } });
const car = (vx = 0, vy = 0) => ({ vx, vy, z: 0 });

test('E1: domena wystrzału na OKRĘT — kolejne wystrzały tego okrętu w jego domenie, drugi okręt — druga domena, sufit i zapas dla wybuchów', async () => {
  const { MUZZLE_TAG } = await import('../src/3d/explosions/explosionFx.js');
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const wfx = mzWfx();
  const fx = new ExplosionFx(core, { weaponFx: wfx });
  frame(fx, core, 0);
  assert.equal(typeof wfx.muzzleGas, 'function', 'reżyser podpina hak WeaponFx');
  const A = shooterOf(11), B = shooterOf(22);
  const m = { x: 1000, y: 500, angle: 0.3 };
  const r1 = wfx.muzzleGas('armata', m, 1.25, 1.5, car(120, -40), A);
  assert.ok(r1 && r1.slot >= 0, 'gaz z lufy armaty');
  const slot1 = r1.slot;   // wynik to obiekt wielokrotnego użytku (bez alokacji) — numer domeny od razu
  const s1 = fx.grid.slots[slot1];
  assert.equal(s1.tag, MUZZLE_TAG);
  assert.equal(s1.fire, 0, 'armata: ogień prochowy (ciało czarne)');
  assert.ok(s1.isHost(11), 'strzelec = gospodarz swojej domeny (wylot nad pokładem, nie na pryzmacie kadłuba)');
  assert.ok(Math.abs(s1.vx - 120) < 1e-9 && Math.abs(s1.vy - 40) < 1e-9, 'nośnik = prędkość lufy (scena: y odbite)');
  // Mała domena: komórka z promienia wylotu (R = 20 · S · I), nie z kuli wybuchu.
  const R = 20 * 1.5 * 1.25;
  assert.ok(Math.abs(s1.h - R / EXPLOSION_TUNE.muzzleCellsR) < 1e-9, 'h z promienia wylotu');
  assert.equal(r1.owner, 30000 + slot1, 'błysk wylotu z właścicielem = domena wystrzału');
  assert.equal(r1.smokeK, EXPLOSION_TUNE.muzzleSmokeK);
  assert.ok(EXPLOSION_TUNE.muzzleSmokeK < 0.5, 'dym cząstkowy wylotu ograniczony (bez podwójnego dymu)');
  // Druga wieża tego samego okrętu obok — ta sama domena (zasilenie), bez nowej.
  const fed0 = s1.fed;
  frame(fx, core, 0.1);
  const r2 = wfx.muzzleGas('armata', { x: 1025, y: 508, angle: 0.25 }, 1.25, 1.5, car(120, -40), A);
  assert.equal(r2.slot, slot1, 'kolejny wystrzał okrętu w jego domenie');
  assert.ok(s1.fed > fed0, 'zasilenie (życie od teraz)');
  // Inny okręt — własna domena. Yamato — niebieski ogień, chłodny dym, osobna domena (inna paleta) nawet u tego samego okrętu.
  const r3 = wfx.muzzleGas('armata', { x: 1100, y: 520, angle: 0 }, 1.25, 1.5, car(120, -40), B);
  assert.ok(r3 && r3.slot !== slot1, 'drugi okręt — druga domena');
  const slot3 = r3.slot;
  const r4 = wfx.muzzleGas('yamato', { x: 1000, y: 500, angle: 0.3 }, 1.6, 2.4, car(120, -40), A);
  assert.ok(r4 && r4.slot !== slot1 && r4.slot !== slot3, 'Yamato — osobna domena (paleta ognia)');
  const s4 = fx.grid.slots[r4.slot];
  assert.equal(s4.fire, 1, 'Yamato: niebieski ogień');
  assert.ok(s4.tint[2] > s4.tint[0], 'dym Yamato lekko chłodny');
  // Sufit domen wystrzałów (3): czwarty okręt — bez gazu (wylot z cząstek jak dawniej).
  const r5 = wfx.muzzleGas('armata', { x: 9000, y: 0, angle: 0 }, 1.25, 1.5, car(), shooterOf(33));
  assert.equal(r5, null, 'ponad sufit — bez gazu');
  assert.equal(fx.stats.mzNoSlot, 1);
  frame(fx, core, 1 / 60);
  assert.equal(fx.stats.mzDomains, 3);
  // Inne rodziny broni — bez gazu i bez liczenia.
  const n0 = fx.stats.mzShots;
  assert.equal(wfx.muzzleGas('vulcan', m, 1, 1, car(), A), null);
  assert.equal(fx.stats.mzShots, n0);
  fx.dispose();
});

test('E1: zapas wolnych domen dla wybuchów, mały wylot na ekranie / poza kadrem bez gazu, domena wystrzału żyje krótko', () => {
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const wfx = mzWfx();
  const fx = new ExplosionFx(core, { weaponFx: wfx });
  frame(fx, core, 0);
  const S = fx.grid.S;
  // Wybuchy biorą wszystkie domeny poza zapasem — wystrzał nie bierze ostatnich wolnych.
  for (let i = 0; i < S - EXPLOSION_TUNE.muzzleReserve; i++) fx.spawn(i * 30000 + 100000, 0, 250, 'capital');
  assert.equal(wfx.muzzleGas('armata', { x: 0, y: 0, angle: 0 }, 1.25, 1.5, car(), shooterOf(1)), null, 'zapas dla wybuchów');
  // Za mały na ekranie (zoom 0,3: R = 20 · 0,2 · 1 = 4 j. → 1,2 px) i poza kadrem.
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx2 = new ExplosionFx(fakeCore(), { weaponFx: mzWfx() });
  fx2.core.fx.view = { x0: -5000, y0: -5000, x1: 5000, y1: 5000 };
  frame(fx2, fx2.core, 0);
  assert.equal(fx2.muzzleShot('armata', 0, 0, 0, 0.2, 1, car(), shooterOf(1)), null);
  assert.equal(fx2.stats.mzSmall, 1);
  assert.equal(fx2.muzzleShot('armata', 90000, 0, 0, 1.5, 1.25, car(), shooterOf(1)), null);
  assert.equal(fx2.stats.mzOff, 1);
  // Domena wystrzału: krótkie życie i wygaszanie, stały zanik dymu (dym rozchodzi się i znika szybko).
  const r = fx2.muzzleShot('armata', 0, 0, 0, 1.5, 1.25, car(), shooterOf(1));
  const s = fx2.grid.slots[r.slot];
  assert.ok(s.until - fx2.grid.time <= 0.6 && s.fadeTime <= 0.8, 'krótkie życie i wygaszanie');
  assert.ok(s.baseDecay > 0 && s.extraDecay >= s.baseDecay, 'stały zanik dymu domeny');
  for (let i = 0; i < 90; i++) frame(fx2, fx2.core, 1 / 60);   // 1,5 s
  assert.equal(s.active, false, 'domena wystrzału wolna po ~1,1 s');
  fx.dispose(); fx2.dispose();
});

test('E1: PIERWSZEŃSTWO WYBUCHÓW — wybuch nie scala się z domeną wystrzału, bez wolnej przejmuje ją (emitery gasną), wtórny jej nie dziedziczy', async () => {
  const { MUZZLE_TAG } = await import('../src/3d/explosions/explosionFx.js');
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const wfx = mzWfx();
  const fx = new ExplosionFx(core, { weaponFx: wfx });
  frame(fx, core, 0);
  const S = fx.grid.S;
  const r = wfx.muzzleGas('yamato', { x: 0, y: 0, angle: 0 }, 1.6, 2.4, car(), shooterOf(5));
  const mzSlot = r.slot;
  assert.ok(fx.director.emitters.some((e) => e.alive && e.slot === mzSlot), 'emitery wylotu');
  // Wybuch przy wylocie (mieści się w domenie wystrzału) — nie scala się, dostaje własną domenę.
  fx.spawn(30, 0, 60, 'escort');
  assert.equal(fx.stats.merged, 0, 'bez scalenia z domeną wystrzału');
  assert.equal(fx.grid.slots[mzSlot].tag, MUZZLE_TAG);
  // Wybuchy zajmują resztę domen; następny przejmuje domenę wystrzału (nie idzie cząstkami).
  let k = 1;
  while (fx.grid.slots.some((s) => !s.active)) fx.spawn(k++ * 30000, 0, 250, 'capital');
  const noSlot0 = fx.stats.noSlot;
  fx.spawn(-90000, 0, 250, 'capital');
  assert.equal(fx.stats.noSlot, noSlot0, 'wybuch dostał domenę');
  assert.equal(fx.stats.mzTaken, 1, 'domena wystrzału przejęta');
  assert.notEqual(fx.grid.slots[mzSlot].tag, MUZZLE_TAG, 'domena należy do wybuchu');
  assert.ok(!fx.director.emitters.some((e) => e.alive && e.slot === mzSlot && e.jet && e.t1 - e.t0 < 0.2), 'emitery wylotu zgaszone');
  // Wystrzał przy pełnej puli (same wybuchy) — nie zabiera domeny wybuchowi.
  const born = fx.grid.slots.map((s) => s.born);
  assert.equal(wfx.muzzleGas('armata', { x: 0, y: 0, angle: 0 }, 1.25, 1.5, car(), shooterOf(6)), null);
  assert.deepEqual(fx.grid.slots.map((s) => s.born), born, 'domeny wybuchów nietknięte');
  assert.equal(fx.grid.slots.length, S);
  fx.dispose();
});

test('E1: źródła wylotu — jęzor ognia wzdłuż lufy (z paliwem), kłąb i dym przed wylotem, hamulec armaty; jadą z nośnikiem domeny', () => {
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const ang = 0.5;
  const r = fx.muzzleShot('armata', 2000, 1000, ang, 1.5, 1.25, car(300, 0), shooterOf(9));
  const live = fx.director.emitters.filter((e) => e.alive && e.slot === r.slot);
  const jets = live.filter((e) => e.jet), puffs = live.filter((e) => !e.jet);
  assert.equal(jets.length, 3, 'jęzor + 2 jęzory hamulca');
  assert.equal(puffs.length, 2, 'kłąb ognia i dym');
  const main = jets.find((e) => e.fuel > 5);
  const ux = Math.cos(ang), uy = -Math.sin(ang);
  const l = Math.hypot(main.jx, main.jy);
  assert.ok((main.jx * ux + main.jy * uy) / l > 0.99, 'jęzor wzdłuż lufy (scena: y odbite)');
  assert.ok(Math.abs(main.x - 2000) < 1e-9 && Math.abs(main.y + 1000) < 1e-9, 'z wylotu');
  assert.ok(main.t1 - main.t0 <= 0.15, 'krótki');
  const fy = fx.muzzleShot('yamato', 0, 0, 0, 2.4, 1.6, car(), shooterOf(10));
  assert.equal(fx.director.emitters.filter((e) => e.alive && e.slot === fy.slot && e.jet).length, 1, 'Yamato bez hamulca');
  // Nośnik: źródła jadą z domeną (followCarrier).
  const x0 = main.x;
  frame(fx, core, 0.05);
  assert.ok(Math.abs(main.x - (x0 + 300 * 0.05)) < 1e-6);
  fx.dispose();
});

// ---------------------------------------------------------------- E2: dym zapłonu silnika (ENGINE_TAG)

const { EngineFrame } = await import('../src/3d/engineFrame.js');
const IGN = await import('../src/game/engineIgnition.js');
const { MAIN_EXHAUST_PALETTES } = await import('../src/data/engineFx.js');
const palIdx = (id) => MAIN_EXHAUST_PALETTES.findIndex((p) => p.id === id);

// Lista dysz klatki (jak EngineVfxSystem): okręt w scenie (x, −y gry), 3 dysze MAIN wydechem w −x sceny.
function engineFrameOf(list) {
  EngineFrame.begin();
  for (const { e, x, y, vx = 0, vy = 0, pal = 1, r = 40 } of list) {
    EngineFrame.beginShip(e, vx, -vy, false);
    for (const dy of [-120, 0, 120]) EngineFrame.nozzle(x, -y + dy, -1, 0, r, 0, pal);
    EngineFrame.endShip();
  }
}
const engShip = (key, running = false) => { const e = { beamHull: { dmgKey: key } }; IGN.setEngineState(e, running ? IGN.ENGINE_RUNNING : IGN.ENGINE_OFF); return e; };

test('E2: EngineFrame trzyma dysze okrętu na liście płaskiej (dym z każdej dyszy)', () => {
  const e = engShip(1);
  engineFrameOf([{ e, x: 1000, y: 500 }]);
  assert.equal(EngineFrame.count, 1);
  assert.equal(EngineFrame.nzCount[0], 3);
  const j = EngineFrame.nzFrom[0];
  assert.equal(EngineFrame.nzX[j], 1000);
  assert.equal(EngineFrame.nzY[j + 1], -500, 'scena: y odbite');
  assert.equal(EngineFrame.nzDX[j], -1);
  assert.equal(EngineFrame.nzR[j + 2], 40);
  EngineFrame.begin();
  assert.equal(EngineFrame.nzN, 0);
});

test('E2: zapłon — domena ZAPŁONU na okręt: dym (bez paliwa) → płomień z paliwem w palecie strugi, błysk i światło; gaszenie — resztkowy dym', async () => {
  const { ENGINE_TAG, ENGINE_FIRE_ROW } = await import('../src/3d/explosions/explosionFx.js');
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const e = engShip(21);
  IGN.igniteEngine(e);
  engineFrameOf([{ e, x: 2000, y: 800, vx: 40, vy: 0, pal: palIdx('plazma') }]);
  frame(fx, core, 1 / 60);
  assert.equal(fx.stats.engSeq, 1);
  assert.equal(fx.stats.engGas, 1, 'dym zapłonu z gazu');
  const slot = fx.grid.slots.findIndex((s) => s.active && s.tag === ENGINE_TAG);
  assert.ok(slot >= 0, 'domena zapłonu');
  const s = fx.grid.slots[slot];
  assert.equal(s.fire, 1, 'Atlas: paleta plazmy');
  assert.ok(s.isHost(21), 'okręt poza maską przeszkód swojej domeny (dysze na krawędzi kadłuba)');
  assert.ok(Math.abs(s.vx - 40 * EXPLOSION_TUNE.engineCarrier) < 1e-9, 'nośnik = prędkość okrętu z chwili zapłonu');
  assert.ok(Math.min(...s.tint) > 1.2 && Math.max(...s.tint) / Math.min(...s.tint) < 1.35, 'dym jasnoszary (lekko chłodny — słońce gry jest ciepłe)');
  assert.ok(s.baseDecay > 0, 'dym znika (stały zanik)');
  const live = () => fx.director.emitters.filter((m) => m.alive && m.slot === slot);
  const smoke = live().filter((m) => m.jet);
  assert.equal(smoke.length, 3, 'strumień z każdej dyszy');
  assert.ok(smoke.every((m) => m.fuel === 0 && m.smoke > 5), 'zimny dym bez paliwa');
  assert.ok(smoke.every((m) => m.jx < 0 && Math.abs(m.jy) < Math.abs(m.jx) * 0.2), 'wzdłuż osi dyszy (wydech)');
  assert.ok(smoke.every((m) => m.r0 >= 3 * s.h - 1e-9), `źródła ≥ 3 komórki promienia (r ${smoke[0].r0}, h ${s.h})`);
  assert.equal(live().filter((m) => !m.jet).length, 6, 'po dwa kłęby na dyszę (krztuszenie)');
  // ta sama faza w kolejnych klatkach — bez nowych źródeł
  const n1 = fx.director.emitters.filter((m) => m.alive).length;
  frame(fx, core, 1 / 60);
  assert.ok(fx.director.emitters.filter((m) => m.alive).length <= n1);
  // błysk: płomień w tej samej domenie, z paliwem, błysk i światło z właścicielem domeny
  for (let i = 0; i < 80; i++) IGN.stepEngineIgnition(e, 1 / 60);
  assert.equal(IGN.ignitionPhase(e), 1);
  const fl0 = fx.flashes.n;
  core.calls.lights.length = 0;
  frame(fx, core, 1 / 60);
  assert.equal(fx.stats.engGas, 2);
  const flame = live().filter((m) => m.jet && m.fuel > 10);
  assert.equal(flame.length, 3, 'płomień zapłonu z każdej dyszy (paliwo)');
  assert.ok(fx.flashes.n > fl0, 'błysk zapłonu');
  assert.ok(core.calls.lights.length >= 1, 'światło zapłonu w siatce');
  // gaszenie: resztkowy dym w nowej sekwencji
  for (let i = 0; i < 60; i++) IGN.stepEngineIgnition(e, 1 / 60);
  assert.equal(IGN.engineStateOf(e), IGN.ENGINE_RUNNING);
  frame(fx, core, 1 / 60);
  IGN.shutdownEngine(e);
  frame(fx, core, 1 / 60);
  assert.equal(fx.stats.engSeq, 2, 'gaszenie = nowa sekwencja');
  assert.equal(fx.stats.engGas, 3);
  // paleta z palety strugi: Terra Nova wodór, piraci rakieta
  assert.equal(ENGINE_FIRE_ROW[palIdx('wodor')], 2);
  assert.equal(ENGINE_FIRE_ROW[palIdx('rakieta')], 0);
  assert.equal(ENGINE_FIRE_ROW[palIdx('plazma')], 1);
  // domena znika: dym rozchodzi się i znika
  for (let i = 0; i < 60 * 6; i++) frame(fx, core, 1 / 60);
  assert.equal(fx.grid.slots[slot].active, false, 'domena zapłonu wolna po kilku sekundach');
  fx.dispose();
});

test('E2: PIERWSZEŃSTWO WYBUCHÓW i sufit zapłonów — wybuch nie scala się z domeną zapłonu, przejmuje ją; zapłon nie bierze ostatnich wolnych', async () => {
  const { ENGINE_TAG } = await import('../src/3d/explosions/explosionFx.js');
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const S = fx.grid.S;
  // trzy okręty w zapłonie: sufit engineDomains
  const ships = [31, 32, 33].map((k) => { const e = engShip(k); IGN.igniteEngine(e); return e; });
  engineFrameOf(ships.map((e, i) => ({ e, x: i * 20000, y: 0 })));
  frame(fx, core, 1 / 60);
  const eg = () => fx.grid.slots.filter((s) => s.active && s.tag === ENGINE_TAG).length;
  assert.equal(eg(), EXPLOSION_TUNE.engineDomains, 'sufit domen zapłonów');
  assert.equal(fx.stats.engNoSlot, 3 - EXPLOSION_TUNE.engineDomains);
  // wybuch przy dyszach — bez scalenia z domeną zapłonu
  fx.spawn(-300, 0, 60, 'escort');
  assert.equal(fx.stats.merged, 0, 'bez scalenia z domeną zapłonu');
  // wybuchy zajmują resztę; następny przejmuje domenę zapłonu (nie idzie cząstkami)
  let k = 1;
  while (fx.grid.slots.some((s) => !s.active)) fx.spawn(k++ * 50000 + 1e5, 0, 250, 'capital');
  const noSlot0 = fx.stats.noSlot;
  fx.spawn(-200000, 0, 250, 'capital');
  assert.equal(fx.stats.noSlot, noSlot0, 'wybuch dostał domenę');
  assert.equal(fx.stats.engTaken, 1, 'domena zapłonu przejęta');
  assert.equal(eg(), EXPLOSION_TUNE.engineDomains - 1);
  // przy pełnej puli nowy zapłon nie zabiera domeny wybuchowi
  const e4 = engShip(34); IGN.igniteEngine(e4);
  const born = fx.grid.slots.map((s) => s.born);
  engineFrameOf([{ e: e4, x: 90000, y: 0 }]);
  frame(fx, core, 1 / 60);
  assert.deepEqual(fx.grid.slots.map((s) => s.born), born, 'domeny wybuchów nietknięte');
  assert.equal(fx.grid.slots.length, S);
  fx.dispose();
});

test('E2: zapłon poza kadrem — bez gazu; okręt bez stanu silników i w pracy — bez dymu', () => {
  const core = fakeCore();
  core.fx.view = { x0: -5000, y0: -5000, x1: 5000, y1: 5000 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const far = engShip(41); IGN.igniteEngine(far);
  const run = engShip(42, true);
  const none = { beamHull: { dmgKey: 43 } };
  engineFrameOf([{ e: far, x: 90000, y: 0 }, { e: run, x: 0, y: 0 }, { e: none, x: 1000, y: 0 }]);
  frame(fx, core, 1 / 60);
  assert.equal(fx.stats.engGas, 0);
  assert.equal(fx.stats.engSmall, 1, 'poza kadrem');
  assert.equal(fx.stats.engSeq, 1, 'tylko okręt w sekwencji');
  fx.dispose();
});

test('E2 (poprawka): dym zapłonu we wnętrzu hali — otoczenie domeny z światła wnętrza (interiorLight), poza halą 0', async () => {
  const { ENGINE_TAG } = await import('../src/3d/explosions/explosionFx.js');
  const core = fakeCore();
  core.fx.view = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const fx = new ExplosionFx(core, {});
  frame(fx, core, 0);
  const calls = [];
  fx.interiorLight = (x, y) => { calls.push([x, y]); return x < 10000 ? 0.8 : 0; };
  const a = engShip(51), b = engShip(52);
  IGN.igniteEngine(a); IGN.igniteEngine(b);
  engineFrameOf([{ e: a, x: 2000, y: 800 }, { e: b, x: 40000, y: 800 }]);
  frame(fx, core, 1 / 60);
  const eg = fx.grid.slots.filter((s) => s.active && s.tag === ENGINE_TAG);
  assert.equal(eg.length, 2);
  const inHall = eg.find((s) => s.cx < 10000), out = eg.find((s) => s.cx >= 10000);
  assert.ok(Math.abs(inHall.ambient - 0.8 * EXPLOSION_TUNE.engineHallAmbient) < 1e-9, 'w hali: otoczenie × światło wnętrza');
  assert.equal(out.ambient, 0, 'poza halą bez otoczenia');
  assert.ok(calls.every(([x, y]) => Number.isFinite(x) && y > 0), 'pytanie w świecie gry (scena: y odbite — gra y 800)');
  // wybuch — bez otoczenia domeny (obraz wybuchów jak dawniej)
  fx.spawn(-90000, 0, 250, 'capital');
  assert.ok(fx.grid.slots.filter((s) => s.active && s.tag !== ENGINE_TAG).every((s) => s.ambient === 0));
  fx.dispose();
});
