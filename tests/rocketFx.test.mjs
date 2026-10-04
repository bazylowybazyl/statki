// Rakiety z dema rakiety-webgpu w Core3D (port WebGPU, zadanie 19): reżyser receptur
// (src/3d/rockets/effects.js) na zdarzeniach lotu z rocketSystem3D, pule w scenie Core3D jako
// krok klatki efektów (rocketFx.js), iskry gry na puli z dema (SparkSystem3D). Lot, trafienia
// i obrażenia zostają w rocketSystem3D (tests/rocketGuidance.test.mjs bez zmian).
// Grafy TSL budowane do WGSL w Node (WebGPURenderer bez init, atrapa kanwy).
// node --test tests/rocketFx.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { readFileSync, readdirSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { FxFrame } = await import('../src/3d/fx/fxFrame.js');
const { LightGrid, LIGHT_FLOATS } = await import('../src/3d/fx/lightGrid.js');
const { RocketFx } = await import('../src/3d/rockets/rocketFx.js');
const { MISSILE_VFX, SMOKE_DRAG, SMOKE_KIND, VFX_CRUISE, VFX_FAST, VFX_NOVA, SPARK_COLORS, rocketVfxIndex } = await import('../src/3d/rockets/palette.js');
const { TRAIL_LOD_ZOOM, TRAIL_LOD_MAX } = await import('../src/3d/rockets/effects.js');
const { SparkPool } = await import('../src/3d/rockets/sparks.js');
const { RingUpload, ringAttr } = await import('../src/3d/rockets/ringUpload.js');
const { SparkSystem3D } = await import('../src/3d/sparkSystem3D.js');
const { ActiveCarrier } = await import('../src/game/carrierVelocity.js');
const { CLOCK_RENDER, CLOCK_SIM } = await import('../src/game/simClock.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const { initRocketSystem3D } = await import('../src/effects3d/rocketSystem3D.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);

// --- atrapy: renderer (liczniki), Core3D (scena, klatka efektów, haki) --------------------

function fakeRenderer(frame = 1) {
  return {
    info: { frame, compute: { frameCalls: 0 } },
    computes: 0,
    draws: 0,
    compute() { this.computes++; this.info.compute.frameCalls++; },
    getRenderTarget() { return null; },
    setRenderTarget() {},
    getClearColor(c) { return c; },
    getClearAlpha() { return 0; },
    setClearColor() {},
    clear() {},
    render() { this.draws++; }
  };
}

const cam = { x: 0, y: 0, zoom: 1 };
const fx = new FxFrame();
const core = {
  scene: new THREE.Scene(),
  fx,
  activeCam1: cam,
  addFxStep(step) { return fx.addStep(step); },
  removeFxStep(step) { fx.removeStep(step); },
  fxDistortion() { return fx.distortionSources(); },
  prewarmPass() {}
};
const gpu = fakeRenderer(1);
fx.attach(gpu, core);
// Jeden egzemplarz na plik (pule dymu i mgławicy mają duże bufory, jak w demie).
const rfx = new RocketFx(core);
const director = rfx.director;
let frameNo = 1;
function fxFrame() {
  gpu.info.frame = ++frameNo;
  fx.frame(gpu, cam, null, 1920, 1080, false, frameNo * (1000 / 60));
}
function resetAll() {
  rfx.clear();
  director.hasView = false;
  director.zoom = 1;
  director.opts.trailDensity = 1;
  rfx.attachRockets(null);
}

function fakeRocket(index, weaponId = 'missile_rack', x = 0, y = 0, heading = 0, speed = 3000) {
  const def = MASTER_WEAPONS[weaponId];
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return {
    index, active: true, state: 'POWERED', weaponDef: def, bodyScale: Number(def.bodyScale) || 1,
    position: new THREE.Vector3(x, 0, y), velocity: new THREE.Vector3(c * speed, 0, s * speed),
    frameVel: new THREE.Vector3(0, 0, 0), visualDir: new THREE.Vector3(c, 0, s),
    quaternion: new THREE.Quaternion(), maxThrust: 1, currentThrust: 1, guidancePhase: 'intercept',
    timeSinceLaunch: 1, target: null
  };
}

// Podgląd zleceń dymu z kolejki CPU puli (bez podmiany metody — podmiana psułaby JIT-owi
// wklejanie spawn w pomiarach alokacji niżej) — pola jak argumenty SmokeSystem.spawn:
// [x, y, z, vx, vy, cx, cy, size0, growth, life, temp, paleta, krycie, wiek].
function recordPuffs(fn) {
  const sm = rfx.smoke;
  const n0 = sm.spawnCount;
  fn();
  const puffs = [];
  for (let i = n0; i < sm.spawnCount; i++) {
    const Q = sm._qdata;
    const o = i * 14;
    puffs.push([sm._qx[i], sm._qy[i], Q[o], Q[o + 2], -Q[o + 3], Q[o + 5], -Q[o + 6] + 0, Q[o + 7], Q[o + 8],
      Q[o + 4], Q[o + 9], Math.floor(Q[o + 10]), Q[o + 12], Q[o + 1]]);
  }
  return puffs;
}

// --- zero alokacji na rakietę (pierwsze w pliku: późniejsze testy z atrapami siatki
// i pól zniekształceń robią wywołania polimorficzne, a to zmienia decyzje JIT w pomiarze) ---

const newSpaceUsed = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
function allocatedBytes(fn, n) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = newSpaceUsed();
    for (let i = 0; i < n; i++) fn(i);
    const delta = newSpaceUsed() - before;
    if (delta >= 0) return delta;
  }
  return Infinity;
}
// Najmniejsza z sześciu prób: pierwsze pomiary po rozgrzewce bywają zawyżone (JIT dopiero
// przestawia kod pod nowe miejsca wywołań), stan ustalony jest wyraźnie niżej.
function minAlloc(fn, n) {
  let m = Infinity;
  for (let k = 0; k < 6; k++) m = Math.min(m, allocatedBytes(fn, n));
  return m;
}

// Flota do pomiarów: rakiety (ostatnia to Supernowa — jony i łuki w locie) krążą w kadrze.
function makeFleet(count) {
  const rockets = [];
  for (let i = 0; i < count; i++) {
    const id = i === count - 1 ? 'supernova_missile' : (i % 5 === 0 ? 'fast_missile_rack' : 'missile_rack');
    rockets.push(fakeRocket(100 + i, id, (i % 8) * 300 - 1000, Math.floor(i / 8) * 200 - 400, i, 1500));
  }
  for (const r of rockets) { director.onLaunch(r, r.index % 2 ? 'red' : 'blue'); director.onIgnite(r); }
  const clock = { t: 0, k: 0 };
  const dt = 1 / 60;
  const fly = () => {
    const t = clock.t;
    const k = clock.k;
    for (let i = 0; i < rockets.length; i++) {
      const r = rockets[i];
      const a = t * 0.9 + i;
      r.visualDir.set(Math.cos(a), 0, Math.sin(a));
      r.velocity.set(Math.cos(a) * 1500, 0, Math.sin(a) * 1500);
      r.position.x += r.velocity.x * dt;
      r.position.z += r.velocity.z * dt;
      r.guidancePhase = (k & 63) < 20 ? 'terminal' : 'intercept';
      director.onFly(r, dt);
    }
    director.update(dt);
    clock.t = t + dt;
    clock.k = k + 1;
  };
  return { rockets, fly };
}

// Na rakietę i na obiekt efektu: zero (wpisy robocze pul, bufor świateł, kinematyka i liczby
// losowe w tablicach). Pomiar funkcji reżysera z 40 rakietami; wywołania pomiaru najpierw
// z kilkoma funkcjami (inaczej JIT wkleja mierzoną funkcję w pętlę pomiaru i mierzy co innego).
// Poza zakresem: grid.addWorld siatki świateł (src/3d/fx/lightGrid.js — `add` przekracza limit
// wklejania V8, liczby w argumentach są opakowywane: ~100 B na światło, uwaga w raporcie 19).
test('bez alokacji na rakietę: lot (smugi, jony, łuki), kadłubki, płomienie, duszki, światła, siły', () => {
  resetAll();
  const { rockets, fly } = makeFleet(40);
  const missiles = () => { rfx.bodies.begin(); rfx.plumes.begin(); director.addMissiles(rockets, 0, 0); };
  const glows = () => { rfx.glow.begin(); director.addGlows(rockets, 0, 0); };
  const lights = () => director.stageLights(rockets);
  const forces = () => director.fillForces(rockets, 0, 0, 0, 0);
  const empty = () => {};
  const parts = { fly, missiles, glows, lights, forces };
  for (let i = 0; i < 3000; i++) { fly(); missiles(); glows(); lights(); forces(); empty(); }   // rozgrzewka JIT
  for (let w = 0; w < 3; w++) for (const fn of [empty, ...Object.values(parts)]) allocatedBytes(fn, 300);
  const base = minAlloc(empty, 1500);
  for (const [name, fn] of Object.entries(parts)) {
    const used = minAlloc(fn, 1500) - base;
    assert.ok(used < 16 * 1024, `${name}: ${used} B na 1500 klatek (40 rakiet)`);
  }
  assert.ok(director.stats.puffs > 10000 && director._lN >= 40, 'pomiar objął smugi i światła');
  assert.ok(SparkSystem3D.pool.stats.emitted > 100, 'jony Supernowej');
  assert.ok(rfx.arcs.highWater > 0, 'łuki Supernowej');
});

// Klatka kroku „rakiety” (siły i krok dymu, światła do bufora, instancje, łuki, mgławica, mapa
// gęstości): stały narzut (uniformy three z liczbą w `value`, liczby w argumentach wywołań raz
// na klatkę) nie rośnie z liczbą rakiet.
test('krok „rakiety”: alokacja nie rośnie z liczbą rakiet (4 → 40)', () => {
  const ctx = fx.ctx;
  ctx.renderer = gpu;
  const measure = (count) => {
    resetAll();
    const { rockets, fly } = makeFleet(count);
    rfx.attachRockets(rockets);
    const frame = () => { fly(); rfx._spawn(ctx); director.stageLights(rockets); rfx._update(ctx); };
    const empty = () => {};
    for (let i = 0; i < 2500; i++) frame();
    for (let w = 0; w < 3; w++) { allocatedBytes(frame, 300); allocatedBytes(empty, 300); }
    const used = minAlloc(frame, 1000) - minAlloc(empty, 1000);
    rfx.attachRockets(null);
    return used;
  };
  const few = measure(4);
  const many = measure(40);
  assert.ok(many - few < 48 * 1024, `alokacja rośnie z liczbą rakiet: ${few} → ${many} B na 1000 klatek`);
});

// --- smuga: porcje gazu wzdłuż odcinka dyszy w klatce ---------------------------------

test('smuga: porcje wzdłuż odcinka dyszy w klatce, wiek z ułamka klatki, ruch doliczony analitycznie', () => {
  resetAll();
  const r = fakeRocket(3, 'missile_rack', 1000, -500, 0, 3000);
  director.onLaunch(r);
  assert.equal(director.kind[3], VFX_CRUISE);
  director.onIgnite(r);
  const dt = 1 / 60;
  const tr = MISSILE_VFX.cruise.trail;
  const L = 16 * r.bodyScale;
  const nozzle0 = r.position.x - L * 0.5;
  r.position.x += r.velocity.x * dt;
  const puffs = recordPuffs(() => director.onFly(r, dt));
  const d = r.velocity.x * dt;
  assert.equal(puffs.length, Math.floor(d / tr.spacing), 'liczba porcji = droga dyszy / odstęp');
  const k = SMOKE_DRAG[tr.kind];
  let prevX = -Infinity;
  let prevAge = Infinity;
  for (const p of puffs) {
    const [x, y, , vx, vy, cx, cy, , , life, , pal, opacity, age] = p;
    assert.equal(pal, tr.kind);
    assert.ok(age >= 0 && age < dt, `wiek porcji w obrębie klatki: ${age}`);
    assert.ok(age < prevAge, 'porcje bliżej dyszy są młodsze');
    prevAge = age;
    assert.equal(cx, 0); assert.equal(cy, 0);
    // Cofnięcie ruchu o wiek: punkt emisji leży na odcinku dyszy (y = kurs 0, x rośnie o odstęp).
    const e = Math.exp(-k * age);
    const f = (1 - e) / k;
    const ex = x - (vx / e) * f;
    const ey = y - (vy / e) * f;
    close(ey, -500, 1e-6, 'emisja na osi lotu');
    assert.ok(ex >= nozzle0 - 1e-6 && ex <= nozzle0 + d + 1e-6, `emisja na odcinku dyszy: ${ex}`);
    if (prevX > -Infinity) close(ex - prevX, tr.spacing, 1e-6, 'odstęp porcji');
    prevX = ex;
    assert.ok(life > 0 && opacity > 0);
  }
});

test('smuga: LOD przy dalekim zoomie — rzadsze porcje, większe krycie (ta sama gęstość)', () => {
  const run = (zoom) => {
    resetAll();
    director.zoom = zoom;
    const r = fakeRocket(5, 'missile_rack', 0, 0, 0.3, 2400);
    director.onLaunch(r);
    director.onIgnite(r);
    return recordPuffs(() => {
      for (let i = 0; i < 60; i++) {
        r.position.x += r.velocity.x / 60;
        r.position.z += r.velocity.z / 60;
        director.onFly(r, 1 / 60);
      }
    });
  };
  const near = run(1);
  const far = run(TRAIL_LOD_ZOOM / 16);
  close(far.length * TRAIL_LOD_MAX, near.length, TRAIL_LOD_MAX, 'porcje rzedną ×4');
  const mean = (list) => list.reduce((s, p) => s + p[12], 0) / list.length;
  assert.ok(mean(far) > mean(near) * 1.8, `krycie rośnie: ${mean(near)} → ${mean(far)}`);
});

test('poza kadrem: bez dymu i iskier; wybuch daleko zostawia tylko światło', () => {
  resetAll();
  director.hasView = true;
  director.vx0 = 50000; director.vy0 = 50000; director.vx1 = 52000; director.vy1 = 51000;
  const r = fakeRocket(7, 'missile_rack', 0, 0, 0, 2000);
  const sparks0 = SparkSystem3D.pool.stats.emitted;
  const puffs = recordPuffs(() => {
    director.onLaunch(r);
    director.onIgnite(r);
    for (let i = 0; i < 10; i++) { r.position.x += 2000 / 60; director.onFly(r, 1 / 60); }
    director.onDetonate(r, r.position.x, r.position.z, null, false);
  });
  assert.equal(puffs.length, 0);
  assert.equal(SparkSystem3D.pool.stats.emitted, sparks0);
  assert.equal(rfx.fireballs.count, 0);
  assert.equal(director.gN, 0, 'bez odłamków');
  assert.equal(director.sN, 0, 'bez fali');
  assert.equal(director.fN > 0, true, 'światło wybuchu zostaje (sięga w kadr)');
});

// --- wybuch, tarcza, supernowa ------------------------------------------------------

test('wybuch: zniekształcenia w ŚWIECIE gry (fala jedzie z nośnikiem), światła do siatki', () => {
  resetAll();
  const r = fakeRocket(9, 'missile_rack', 1000, -2000, 0, 2000);
  r.frameVel.set(100, 0, -40);
  director.onLaunch(r);
  director.onDetonate(r, 1000, -2000, null, false);
  assert.equal(rfx.fireballs.count, 1, 'kula ognia');
  director.update(0.05);
  const calls = [];
  director.fillDistortion({
    shock: (...a) => calls.push(['shock', ...a]),
    implode: (...a) => calls.push(['implode', ...a]),
    heat: (...a) => calls.push(['heat', ...a])
  });
  const shock = calls.find((c) => c[0] === 'shock');
  const heat = calls.find((c) => c[0] === 'heat');
  assert.ok(shock && heat);
  close(shock[1], 1000 + 100 * 0.05, 1e-9, 'x fali');
  close(shock[2], -2000 - 40 * 0.05, 1e-9, 'y fali w świecie gry (bez odbicia osi)');
  assert.ok(shock[3] > 0, 'promień fali rośnie');
  close(heat[2], -2000 - 40 * 0.05, 1e-9);
  const grid = new LightGrid({ name: 'testRakiet' });
  grid.begin(1000, 2000);   // początek w układzie SCENY (x, −y świata)
  assert.ok(director.addLights(grid, null) >= 1);
  // Lokalne siatki = scena − początek: (x − 1000, −y − 2000) → wybuch (1005, −2002) = (5, 2).
  const L = grid.lights;
  let found = false;
  for (let k = 0; k < grid.count; k++) {
    const o = k * LIGHT_FLOATS;
    if (Math.abs(L[o] - 5) < 1e-3 && Math.abs(L[o + 1] - 2) < 1e-3 && L[o + 4] > 0) found = true;
  }
  assert.ok(found, 'światło wybuchu w świecie gry (siatka dostaje x, y świata)');
});

test('tarcza: głowica pęka na polu — barwa pola, iskry styczne, bez kuli ognia', () => {
  resetAll();
  const r = fakeRocket(11, 'missile_rack', 0, 0, 0, 2000);
  director.onLaunch(r);
  const ent = { x: 300, y: 0, vx: 50, vy: 0, radius: 120, shield: { val: 100, max: 100 } };
  const pool = SparkSystem3D.pool;
  const h0 = pool.head;
  director.onDetonate(r, 190, 0, ent, true);
  assert.equal(rfx.fireballs.count, 0, 'bez kuli ognia na polu');
  const n = pool.head - h0;
  assert.ok(n > 10, `iskry plazmy: ${n}`);
  const C = pool.a2.array;
  const B = pool.a1.array;
  let shieldColored = 0;
  let tangential = 0;
  for (let i = h0; i < pool.head; i++) {
    if (Math.abs(C[i * 4] - 0.0999) < 1e-3 && Math.abs(C[i * 4 + 2] - 0.9301) < 1e-3) shieldColored++;
    // Normalna pola w punkcie (190, 0) wskazuje −x (od środka encji); styczne: |vx| < |vy|.
    if (Math.abs(B[i * 4]) < Math.abs(B[i * 4 + 1])) tangential++;
  }
  assert.ok(shieldColored > n * 0.4, 'barwa pełnej tarczy');
  assert.ok(tangential > n * 0.6, 'rozlane stycznie po polu');
  const D = pool.a3.array;
  assert.equal(D[h0 * 4], 50, 'nośnik: pole jedzie z encją');
});

test('Supernowa: implozja (przygaszenie) → błysk, bloom, fala, pozostałość, wstrząs → wygasa', () => {
  resetAll();
  const shakes = [];
  const prevCam = window.camera;
  window.camera = { shakeMag: 0, shakeDur: 0, addShake: (m, d) => shakes.push([m, d]) };
  const neb = rfx.nebula;
  try {
    director.renderer = fakeRenderer(1);
    const r = fakeRocket(13, 'supernova_missile', 500, -300, 0, 1800);
    director.onLaunch(r);
    assert.equal(director.kind[13], VFX_NOVA);
    director.onDetonate(r, 500, -300, null, false);
    for (let i = 0; i < 6; i++) director.update(1 / 60);
    assert.ok(director.exposure < 1 && director.exposure > 0.8, `przygaszenie w implozji: ${director.exposure}`);
    assert.equal(director.bloomBoost, 0);
    const calls = [];
    const sink = { shock: (...a) => calls.push(['shock', ...a]), implode: (...a) => calls.push(['implode', ...a]), heat: () => {} };
    director.fillDistortion(sink);
    const imp = calls.find((c) => c[0] === 'implode');
    assert.ok(imp, 'implozja');
    assert.deepEqual([imp[1], imp[2]], [500, -300], 'środek implozji w świecie gry');
    assert.equal(neb.evCount, 0);
    for (let i = 0; i < 12; i++) director.update(1 / 60);
    assert.equal(neb.evCount, 1, 'pozostałość raz');
    assert.ok(neb.highWater > 50000, `cząstki pozostałości: ${neb.highWater}`);
    // Środek w układzie sceny względem początku pul: (x, −y) świata gry.
    close(neb.U.center.value.x, 500 - fx.origin.x, 1e-6); close(neb.U.center.value.y, 300 - fx.origin.y, 1e-6);
    assert.ok(director.bloomBoost > 1, `podbicie bloomu: ${director.bloomBoost}`);
    assert.deepEqual(shakes, [[16, 0.45]], 'wstrząs tylko od supernowej w kadrze');
    calls.length = 0;
    director.fillDistortion(sink);
    assert.ok(calls.some((c) => c[0] === 'shock' && c[1] === 500 && c[2] === -300), 'fala supernowej');
    // Post z klatki efektów: min ekspozycji, max podbicia (kasowane co klatkę FxFrame).
    fxFrame();
    assert.ok(fx.post.bloomBoost > 1);
    for (let i = 0; i < 420; i++) director.update(1 / 60);
    assert.equal(director.nN, 0, 'sekwencja wygasła (wir z pulsarem ~6,4 s)');
    assert.equal(director.exposure, 1);
    assert.equal(director.bloomBoost, 0);
    fxFrame();
    assert.equal(fx.post.bloomBoost, 0);
    assert.equal(fx.post.exposure, 1);
  } finally {
    window.camera = prevCam;
  }
});

// --- pule w klatce efektów ----------------------------------------------------------------

test('krok „rakiety”: puste pule niewidoczne, wybuch odsłania dym, kulę ognia i duszki', () => {
  resetAll();
  fxFrame();
  fxFrame();
  for (const m of rfx.meshes) assert.equal(m.visible, false, `${m.name} pusty = niewidoczny`);
  const r = fakeRocket(15, 'missile_rack', 100, 50, 0, 2000);
  director.onLaunch(r);
  director.onDetonate(r, 100, 50, null, false);
  director.update(1 / 60);
  fxFrame();
  assert.ok(rfx.smoke.highWater > 1, 'zlecenia dymu wysłane w klatce efektów');
  assert.equal(rfx.smoke.mesh.visible, true);
  assert.equal(rfx.fireballs.mesh.visible, true);
  assert.equal(rfx.glow.mesh.visible, true);
  assert.equal(rfx.bodies.mesh.visible, false, 'bez rakiet w locie');
});

test('rozgrzewka kroku: kernele, mapa gęstości i siatki odsłonięte tylko na czas projekcji', () => {
  resetAll();
  for (const m of rfx.meshes) assert.equal(m.visible, false, `${m.name}: clear() chowa pulę`);
  const r = fakeRenderer(1);
  const seen = [];
  const warmCore = { ...core, prewarmPass: (m, layer) => seen.push([m.name, m.visible, layer, m.geometry.instanceCount ?? m.count]) };
  rfx._warm({ renderer: r, core: warmCore });
  assert.ok(r.computes >= 4, 'dispatche kerneli (emisja, krok, światło, mgławica)');
  assert.ok(r.draws >= 1, 'pass mapy gęstości');
  assert.equal(seen.length, rfx.meshes.length);
  for (const [name, vis, layer] of seen) {
    assert.equal(vis, true, `${name} widoczny w projekcji`);
    assert.equal(layer, 0, 'pass ortho (warstwa 0)');
  }
  for (const m of rfx.meshes) assert.equal(m.visible, false, `${m.name} wraca do niewidoczności`);
});

// --- iskry: API gry na puli z dema -------------------------------------------------------

test('SparkSystem3D: barwa PER ISKRA (burst nie przemalowuje żywych), przycięcia API, nośnik', () => {
  const pool = SparkSystem3D.pool;
  assert.ok(pool instanceof SparkPool);
  SparkSystem3D.setColor('#ff4d00');
  const h0 = pool.head;
  SparkSystem3D.emit(10, 20, 30, -40, 5, 3, 1, [0, 1, 0]);
  SparkSystem3D.burst(0, 0, 3, 100, 0.3, 0.4, '#0000ff');
  ActiveCarrier.set({ vx: 250, vy: -80, t0: 1.5, clock: CLOCK_RENDER });
  SparkSystem3D.emit(0, 0, 10, 0, 0.3, 0.4);
  ActiveCarrier.clear();
  const C = pool.a2.array;
  const A = pool.a0.array;
  const B = pool.a1.array;
  const D = pool.a3.array;
  assert.deepEqual([C[h0 * 4], C[h0 * 4 + 1], C[h0 * 4 + 2]], [0, 1, 0], 'jawna barwa');
  for (let i = h0 + 1; i <= h0 + 3; i++) assert.deepEqual([C[i * 4], C[i * 4 + 1], C[i * 4 + 2]], [0, 0, 1], 'barwa serii burst');
  const g = SPARK_COLORS.game;
  close(C[(h0 + 4) * 4], g[0], 1e-6); close(C[(h0 + 4) * 4 + 1], g[1], 1e-4); close(C[(h0 + 4) * 4 + 2], g[2], 1e-6);
  assert.deepEqual([C[h0 * 4], C[h0 * 4 + 1]], [0, 1], 'burst nie przemalował wcześniejszej iskry');
  // Świat gry → scena: y odwrócone (pozycja i prędkość), życie i rozmiar przycięte jak dawniej.
  assert.deepEqual([A[h0 * 4], A[h0 * 4 + 1], A[h0 * 4 + 3]], [10, -20, Math.fround(0.9)]);
  assert.deepEqual([B[h0 * 4], B[h0 * 4 + 1], B[h0 * 4 + 3]], [30, 40, Math.fround(0.9)]);
  const o = (h0 + 4) * 4;
  assert.deepEqual([D[o], D[o + 1], D[o + 2], D[o + 3]], [250, 80, 1.5, 1], 'nośnik z ActiveCarrier (zegar render)');
  assert.deepEqual([D[h0 * 4], D[h0 * 4 + 1], D[h0 * 4 + 3]].map((v) => v + 0), [0, 0, 0], 'bez nośnika');
});

test('pierścień: zawinięcie = dwa wycinki (koniec + początek), przeskok = [0, highWater)', () => {
  const pool = new SparkPool({ scene: new THREE.Scene(), capacity: 8 });
  const put = (n) => { for (let i = 0; i < n; i++) pool.emit(i, 0, 1, 0, 1, 0.5, 0.5, 1, 1, 1); };
  const ranges = () => pool.a0.updateRanges.map((r) => [r.start / 4, r.count / 4]);
  put(6);
  pool.update(0, 1);
  assert.deepEqual(ranges(), [[0, 6], [0, 0]]);
  assert.equal(pool.gain.updateRanges[0].count, 6, 'atrybut o rozmiarze 1');
  put(5);                        // indeksy 6, 7, 0, 1, 2
  pool.update(0.01, 1);
  assert.deepEqual(ranges(), [[6, 2], [0, 3]], 'bez pełnego bufora po zawinięciu');
  const v = pool.a0.version;
  pool.update(0.02, 1);
  assert.equal(pool.a0.version, v, 'nic nowego — bez wysyłki');
  pool._rebase(10, 0, 0, 0);
  put(1);
  pool.update(0.03, 1);
  assert.deepEqual(ranges(), [[0, 8], [0, 0]], 'przeskok: żywe dane przesunięte w miejscu');
  put(20);                       // więcej niż pojemność w jednej klatce
  pool.update(0.04, 1);
  assert.deepEqual(ranges(), [[0, 8], [0, 0]]);
  assert.equal(pool.a0.updateRanges.length, 2, 'zakresy na stałe');
  const up = new RingUpload(4);
  const at = ringAttr(4, 2);
  up.touch(3); up.touch(0);
  assert.equal(up.flush([at], 4), true);
  assert.deepEqual(at.updateRanges, [{ start: 6, count: 2 }, { start: 0, count: 2 }]);
  assert.equal(up.flush([at], 4), false);
  pool.dispose();
});

// --- gameplay nietknięty ------------------------------------------------------------------

test('lot rakiet: efekty nie zmieniają Math.random gry, toru ani trafień; kolejność zdarzeń', () => {
  const run = (effects) => {
    const orig = Math.random;
    let seed = 12345;
    let calls = 0;
    Math.random = () => { calls++; seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    try {
      const sys = initRocketSystem3D(null, effects ? { effects } : {});
      const target = { x: 6000, y: 800, vx: 0, vy: 250, radius: 60, dead: false, hp: 1e9 };
      let hits = 0;
      window.applyDamageToNPC = (npc) => { if (npc === target) hits++; };
      for (let k = 0; k < 6; k++) {
        const id = k % 3 === 2 ? 'supernova_missile' : (k % 3 === 1 ? 'fast_missile_rack' : 'missile_rack');
        const def = MASTER_WEAPONS[id];
        sys.fire(0, k * 40, target, def.baseDamage, def, k % 2 ? 'red' : 'blue');
      }
      const trace = [];
      for (let step = 0; step < 900; step++) {
        target.x += target.vx / 60;
        target.y += target.vy / 60;
        sys.update(1 / 60);
        if (step % 30 === 0) for (const r of sys.rockets) if (r.active) trace.push(r.position.x, r.position.z);
      }
      return { calls, hits, trace };
    } finally {
      Math.random = orig;
      delete window.applyDamageToNPC;
    }
  };
  resetAll();
  const bare = run(null);
  const withFx = run(rfx);
  assert.ok(bare.hits > 0, 'rakiety trafiają');
  assert.equal(withFx.calls, bare.calls, 'efekty nie losują z Math.random gry');
  assert.equal(withFx.hits, bare.hits);
  assert.deepEqual(withFx.trace, bare.trace, 'tor bez zmian');
  assert.ok(director.stats.puffs > 0, 'efekty działały');

  // Zdarzenia dla reżysera: start → lot (rakieta z zimnego wyrzutu) → zapłon → lot → styk → wybuch.
  const log = [];
  const rec = {
    onLaunch: () => log.push('start'),
    onIgnite: () => log.push('zapłon'),
    onFly: () => { if (log[log.length - 1] !== 'lot') log.push('lot'); },
    prepareContact: () => log.push('styk'),
    onDetonate: (r, x, y, hit, hitShield) => log.push(hit ? (hitShield ? 'wybuch-tarcza' : 'wybuch-trafienie') : 'wybuch'),
    update: () => {}
  };
  const sys = initRocketSystem3D(null, { effects: rec });
  const target = { x: 5000, y: 0, vx: 0, vy: 0, radius: 60, dead: false, hp: 1e9 };
  window.applyDamageToNPC = () => {};
  const def = MASTER_WEAPONS.missile_rack;
  sys.fire(0, 0, target, def.baseDamage, def, 'blue');
  for (let i = 0; i < 900 && sys.activeRockets > 0; i++) sys.update(1 / 60);
  delete window.applyDamageToNPC;
  assert.deepEqual(log, ['start', 'lot', 'zapłon', 'lot', 'styk', 'wybuch-trafienie']);
  initRocketSystem3D(null, { effects: rfx });
});

test('warstwa DIST: zgłoszenia właścicieli w klatce łączone przez OR, kasowane na starcie klatki efektów', async () => {
  const { Core3D } = await import('../src/3d/core3d.js');
  const f = new FxFrame();
  const c = Object.assign(Object.create(Core3D), { fx: f });
  const r = fakeRenderer(500);
  f.attach(r, c);
  f.addStep({ name: 'broń', update: () => c.setDistortLayerActive(true) });
  f.addStep({ name: 'rakiety', update: () => c.setDistortLayerActive(false) });
  f.frame(r, cam, null, 1920, 1080, false, 0);
  assert.equal(f.distortLayerActive, true, 'późniejsze „nie mam” nie gasi zgłoszenia innego właściciela');
  f.steps.length = 0;
  r.info.frame = 501;
  f.frame(r, cam, null, 1920, 1080, false, 16);
  assert.equal(f.distortLayerActive, false, 'bez zgłoszeń w klatce — warstwa wyłączona');
});

test('rocketVfxIndex: supernowa, szybka salwa, manewrujący', () => {
  assert.equal(rocketVfxIndex(MASTER_WEAPONS.supernova_missile), VFX_NOVA);
  assert.equal(rocketVfxIndex(MASTER_WEAPONS.fast_missile_rack), VFX_FAST);
  assert.equal(rocketVfxIndex(MASTER_WEAPONS.missile_rack), VFX_CRUISE);
  assert.equal(rocketVfxIndex({ id: 'x', rocketExplosionVfx: 'Supernova' }), VFX_NOVA);
  assert.equal(rocketVfxIndex(null), VFX_CRUISE);
  assert.equal(SMOKE_KIND.SOOT, 3);
});

// --- źródła: losowość efektów, stare moduły, WGSL ------------------------------------------

test('efekty rakiet i iskier bez Math.random (fxRandom); stare pule rakiet usunięte', () => {
  const files = readdirSync(new URL('../src/3d/rockets/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `src/3d/rockets/${f}`);
  files.push('src/3d/sparkSystem3D.js');
  assert.ok(files.length >= 12);
  for (const f of files) assert.doesNotMatch(stripComments(read(f)), /Math\.random/, f);
  for (const f of ['rocketFireGPU', 'rocketSmokeGPU', 'supernovaMissileBlow']) {
    assert.throws(() => read(`src/effects3d/${f}.js`), /ENOENT/, `${f}.js usunięty`);
  }
  const rockets = stripComments(read('src/effects3d/rocketSystem3D.js'));
  // Losowanie gry w locie: JEDNO ziarno na rakietę (fire) albo na salwę (fireSalvo) — rozrzut wyrzutu,
  // zapłonu, wachlarza i kluczenia z haszu ziarna (2026-09-30; dawniej 3 losowania wyrzutu na rakietę).
  assert.equal((rockets.match(/Math\.random\(\)/g) || []).length, 2, 'losowanie gry: ziarno rakiety i ziarno salwy');
  assert.doesNotMatch(rockets, /new THREE\.(Mesh|InstancedMesh|Points|ShaderMaterial)/, 'lot bez własnych siatek');
});

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const wgsl = new THREE.WebGPURenderer({ canvas });
wgsl.hasFeature = () => false;
wgsl.lighting = gpu.lighting;
function buildCompute(node) {
  const b = wgsl.backend.createNodeBuilder(node, wgsl);
  b.build();
  return b.computeShader;
}
function buildMesh(mesh) {
  const b = wgsl.backend.createNodeBuilder(mesh, wgsl);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const storageCount = (code) => (code.match(/var<storage/g) || []).length;

test('WGSL: kernele i materiały rakiet budują się; ≤ 8 buforów storage na etap, ≤ 8 buforów wierzchołków', () => {
  const kernels = {
    emisja: rfx.smoke.emitNode, krok: rfx.smoke.stepNode, swiatlo: rfx.smoke.lightNode, przesuniecie: rfx.smoke.shiftNode,
    mglawica: rfx.nebula.initNode, mglawicaPrzesuniecie: rfx.nebula.shiftNode
  };
  for (const [name, node] of Object.entries(kernels)) {
    const code = buildCompute(node);
    assert.ok(code.length > 200, name);
    assert.ok(storageCount(code) <= 8, `${name}: ${storageCount(code)} buforów storage`);
  }
  // Bug V z dema: siła śladu tylko w dymie starszym niż ~0,8 s (pełna od 1,6 s).
  assert.match(buildCompute(rfx.smoke.stepNode), /smoothstep\(\s*0\.8,\s*1\.6,/);
  const meshes = [...rfx.meshes, rfx.smoke.densityMesh, SparkSystem3D.pool.mesh];
  for (const m of meshes) {
    const { vertex, fragment } = buildMesh(m);
    assert.ok(vertex.length > 100 && fragment.length > 100, m.name);
    assert.ok(storageCount(vertex) <= 8 && storageCount(fragment) <= 8, `${m.name}: storage`);
    assert.ok(Object.keys(m.geometry.attributes).length <= 8, `${m.name}: bufory wierzchołków`);
    // pow tylko z nieujemną podstawą (NaN w HalfFloat rozlewa bloom): brak pow z gołym argumentem ujemnym.
    assert.doesNotMatch(fragment, /pow\(\s*-/, `${m.name}: pow z ujemną stałą`);
  }
});

// --- „Feel” rakiet (2026-09-30): rodzaje wyglądu nowych broni, wyrzut w pionie, Hydra, torpedy ---

test('wygląd nowych broni: Grad / Rój / głowice Hydry — mikrorakieta, nosiciel Hydry — własny rodzaj', async () => {
  const { VFX_MICRO, VFX_HYDRA } = await import('../src/3d/rockets/palette.js');
  const { submunitionDef } = await import('../src/data/weapons.js');
  assert.equal(rocketVfxIndex(MASTER_WEAPONS.grad_launcher), VFX_MICRO);
  assert.equal(rocketVfxIndex(MASTER_WEAPONS.roj_pod), VFX_MICRO);
  assert.equal(rocketVfxIndex(MASTER_WEAPONS.hydra_mirv), VFX_HYDRA);
  assert.equal(rocketVfxIndex(submunitionDef(MASTER_WEAPONS.hydra_mirv)), VFX_MICRO);
  assert.equal(rocketVfxIndex(MASTER_WEAPONS.missile_rack), VFX_CRUISE, 'dawne bronie bez zmian');
  assert.equal(rocketVfxIndex(MASTER_WEAPONS.fast_missile_rack), VFX_FAST);
  // Każdy rodzaj ma pełny profil (płomień, światło, smuga, wybuch) i paletę dymu w granicach puli.
  for (const k of ['micro', 'hydra']) {
    const v = MISSILE_VFX[k];
    assert.ok(v.body && v.plume && v.light && v.trail && v.blast, k);
    assert.ok(v.trail.kind >= 0 && v.trail.kind < 8, `${k}: paleta dymu`);
  }
  assert.equal(SMOKE_KIND.MICRO, 6);
});

test('wyrzut w pionie: słup dymu po zapłonie rozlewa się na boki (bez kierunku), dysza liczona w 3D', () => {
  resetAll();
  const r = fakeRocket(21, 'missile_rack', 0, 0, 0, 60);
  r.nosePitch = 1.45;           // nos prawie w górę (tuż po zapłonie)
  r.position.y = 60;
  r.velocity.set(0, 400, 0);    // wznosi się
  director.onLaunch(r);
  director.onIgnite(r);
  const puffs = recordPuffs(() => {
    for (let i = 0; i < 12; i++) { r.position.y += 400 / 60; director.onFly(r, 1 / 60); }
  });
  assert.ok(puffs.length >= 12, `porcje wzdłuż drogi dyszy w górę: ${puffs.length}`);
  // Prędkości w płaszczyźnie rozrzucone we wszystkich kierunkach (nie smuga do tyłu).
  let neg = 0; let pos = 0;
  for (const p of puffs) { if (p[3] < 0) neg++; else pos++; }
  assert.ok(neg > 2 && pos > 2, `rozlew na boki: ${neg} / ${pos}`);
  // z porcji rośnie z wysokością dyszy.
  assert.ok(puffs[puffs.length - 1][2] > 60, `z porcji ${puffs[puffs.length - 1][2]}`);
});

test('Hydra: pęknięcie nosiciela — błysk ze światłem, iskry, obłok, fala (sama refrakcja)', () => {
  resetAll();
  const r = fakeRocket(23, 'hydra_mirv', 200, 100, 0, 1800);
  director.onLaunch(r);
  const sparks0 = SparkSystem3D.pool.stats.emitted;
  const f0 = director.fN;
  const s0 = director.sN;
  const puffs = recordPuffs(() => director.onSplit(r));
  assert.equal(director.stats.splits > 0, true);
  assert.ok(director.fN > f0, 'błysk');
  assert.ok(director.sN > s0, 'fala');
  assert.ok(SparkSystem3D.pool.stats.emitted - sparks0 >= 30, 'iskry');
  assert.ok(puffs.length >= 8, 'obłok gazu');
});

test('torpeda: kilwater w dymie wzdłuż drogi w klatce, w układzie wyrzutni, bez alokacji na porcję', () => {
  resetAll();
  const b = { x: 1000, y: 500, vx: 1400 + 300, vy: 0 - 100, ivx: 300, ivy: -100 };
  const puffs = recordPuffs(() => director.torpedoWake(b, 1 / 60));
  // 1400 j/s własnego ruchu / 60 = 23 j. na klatkę, odstęp 9 j. → 2 porcje (akumulator na pocisku).
  assert.ok(puffs.length >= 2 && puffs.length <= 3, `porcje: ${puffs.length}`);
  for (const p of puffs) {
    assert.equal(p[5], 300, 'nośnik x = pęd wyrzutni');
    assert.equal(p[6], -100, 'nośnik y');
    assert.equal(p[11], SMOKE_KIND.MICRO);
    assert.ok(p[0] < 1000, 'ślad za torpedą');
  }
  assert.ok(Number.isFinite(b.__wakeAcc) && b.__wakeAcc >= 0 && b.__wakeAcc < 9, 'akumulator drogi');
  // Poza kadrem — bez porcji.
  director.hasView = true;
  director.vx0 = 50000; director.vy0 = 50000; director.vx1 = 51000; director.vy1 = 51000;
  assert.equal(recordPuffs(() => director.torpedoWake(b, 1 / 60)).length, 0);
  director.hasView = false;
});
