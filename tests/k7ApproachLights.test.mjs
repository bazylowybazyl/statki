// REFLEKTORY PODEJŚCIA w hali K-7 (decyzja użytkownika 2026-11-11): reflektor stanowiska capital (ściana tylna) świeci
// przygaszony, póki stanowisko jest wolne, i rozjaśnia się sam, gdy gracz podchodzi pasem stanowiska — automat obsługi
// stanowisk (src/game/k7BerthService.js: histereza, poziom 0…1 w czasie klatki, pole `approachLight` stanowiska
// w rejestrze), mnożnik mocy (haloPortK7Lights.js — k7ApproachSpotGain), blok obsługi wejścia pyłu hal
// (HALL_DUST_SERVICE.light), światła hali w siatce gry (HallDust._lights) i pokład hali (HaloPortK7: uK7Spots).
// Obraz w prawdziwej grze: node scripts/webgpu/zatoki-reflektory-gra.mjs
// node --test tests/k7ApproachLights.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const { K7_SERVICE_TUNE, K7_POSE_OWNER, createK7BerthService, stepK7BerthService, k7BerthServiceState } =
  await import('../src/game/k7BerthService.js');
const { HaloRingCollider } = await import('../src/game/haloRingCollision.js');
const { k7BerthPose, k7HubToGame, k7HubHeadingToGame } = await import('../src/game/story/k7Dock.js');
const { createK7Layout, k7HeightToZ } = await import('../src/3d/haloRing/haloPortK7Layout.js');
const { K7_APPROACH_SPOT, k7ApproachSpotGain, k7LightRig } = await import('../src/3d/haloRing/haloPortK7Lights.js');
const { HALL_DUST_IN, HALL_DUST_SERVICE } = await import('../src/3d/gasField/hallDustLayout.js');
const { packHallService } = await import('../src/game/hallDustInput.js');

const DT = 1 / 60;
const DEG = Math.PI / 180;
const ATLAS = { w: 1800, h: 806 };

function world(x = 6123456.7, y = 4234567.8) {
  const planet = { id: 'earth', name: 'earth', x, y };
  const col = new HaloRingCollider(planet);
  // stanowiska wolne jak w świecie ringów gry (HaloRingWorld.setPlanets — domyślny układ K-7 ma gracza na C-01)
  for (const owner of col.registry.halls) for (const b of owner.layout.berths) { b.occupied = null; b.reserved = null; }
  const svc = createK7BerthService(col.registry);
  return { planet, col, svc, place: col.place };
}

/** Atlas w hubie hali `hall` w (hx, hz), kurs w hubie `hubAngle` (domyślnie kurs stanowiska — dziobem do ściany tylnej), prędkość w hubie. */
function shipAt(w, hx, hz, { hall = 0, hubAngle = -Math.PI / 2, vhx = 0, vhz = 0 } = {}) {
  const frame = k7BerthPose(w.planet, 'C-01', hall).frame;
  const p = k7HubToGame(w.planet, frame, hx, hz, {});
  const q = k7HubToGame(w.planet, frame, hx + vhx, hz + vhz, {});
  return { pos: { x: p.x, y: p.y }, vel: { x: q.x - p.x, y: q.y - p.y }, angle: k7HubHeadingToGame(frame, hubAngle), angVel: 0, ...ATLAS, frame };
}

function moveTo(w, s, hx, hz, { vhx = 0, vhz = 0, hubAngle = null } = {}) {
  const p = k7HubToGame(w.planet, s.frame, hx, hz, {});
  const q = k7HubToGame(w.planet, s.frame, hx + vhx, hz + vhz, {});
  s.pos.x = p.x; s.pos.y = p.y; s.vel.x = q.x - p.x; s.vel.y = q.y - p.y;
  if (hubAngle !== null) s.angle = k7HubHeadingToGame(s.frame, hubAngle);
}

function run(w, ship, sec, { dt = DT, lightDt = dt, each = null } = {}) {
  const list = [ship];
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) {
    stepK7BerthService(w.svc, dt, w.place, list, ship ? 1 : 0, K7_SERVICE_TUNE, lightDt);
    if (each) each(i);
  }
}

const rec = (w, id = 'C-01', hall = 0) => k7BerthServiceState(w.svc, hall, id);
const berthOf = (w, id = 'C-01', hall = 0) => w.col.registry.halls[hall].layout.berths.find((b) => b.id === id);
const L = createK7Layout();
const C01 = L.berths.find((b) => b.id === 'C-01');

test('mnożnik reflektora: wolne — przygaszony, podejście — pełny, bez poziomu — pełny (dema, tło menu)', () => {
  assert.equal(k7ApproachSpotGain(0), K7_APPROACH_SPOT.idle);
  assert.equal(k7ApproachSpotGain(1), 1);
  assert.equal(k7ApproachSpotGain(-3), K7_APPROACH_SPOT.idle);
  assert.equal(k7ApproachSpotGain(7), 1);
  for (const v of [NaN, undefined, null, 'x']) assert.equal(k7ApproachSpotGain(v), 1, String(v));
  let prev = 0;
  for (let i = 0; i <= 20; i++) {
    const g = k7ApproachSpotGain(i / 20);
    assert.ok(g >= prev - 1e-12, 'monotoniczny');
    prev = g;
  }
  assert.ok(K7_APPROACH_SPOT.idle > 0 && K7_APPROACH_SPOT.idle < 0.6, 'przygaszony, nie zgaszony');
  // reflektory podejścia = reflektory ściany tylnej nad stanowiskami capital (jeden na stanowisko)
  const rig = k7LightRig(L);
  const tagged = rig.spots.filter((s) => s.berthId);
  assert.deepEqual(tagged.map((s) => s.berthId), L.berths.filter((b) => b.size === 'CAPITAL').map((b) => b.id));
  for (const s of tagged) {
    const b = L.berths.find((q) => q.id === s.berthId);
    assert.equal(s.x, b.x, 'nad stanowiskiem');
    assert.ok(s.z < b.z && s.dir[2] > 0.5, 'ze ściany tylnej, snop ku bramie');
  }
});

test('podejście pasem z bramy: reflektor stanowiska rośnie do pełnego, sąsiednie zostają przygaszone; postój i obsługa trzymają, odlot ku bramie — gaśnie', () => {
  const w = world();
  // start: wszystkie wolne → przygaszone (poziom 0) w rejestrze od razu
  for (const id of ['C-01', 'C-02', 'C-03', 'C-04']) assert.equal(berthOf(w, id).approachLight, 0, id);
  // Atlas za bramą G-01 na osi pasu C-01, dziobem ku stanowisku, 220 j/s ku ścianie tylnej
  const s = shipAt(w, C01.x, L.frontZ + 600, { vhz: -220 });
  run(w, s, DT);
  assert.equal(rec(w).approach, true, 'za bramą w pasie: podejście');
  run(w, s, K7_SERVICE_TUNE.lightRise + 0.05);
  assert.equal(rec(w).light, 1, 'reflektor C-01 pełny');
  assert.equal(berthOf(w).approachLight, 1, 'poziom w rejestrze (obraz i pył hal)');
  for (const id of ['C-02', 'C-03', 'C-04']) assert.equal(berthOf(w, id).approachLight, 0, `${id} przygaszony`);
  for (let h = 1; h < w.col.registry.halls.length; h++) assert.equal(berthOf(w, 'C-01', h).approachLight, 0, `hala ${h}`);
  // rufą ku stanowisku (kurs odwrotny) — też podejście
  const w2 = world();
  const s2 = shipAt(w2, C01.x, 4000, { hubAngle: Math.PI / 2, vhz: -150 });
  run(w2, s2, 0.1);
  assert.equal(rec(w2).approach, true, 'rufą ku stanowisku');
  // dojazd na pole i postój → obsługa: reflektor dalej pełny (stanowisko zajęte)
  moveTo(w, s, C01.x, C01.z);
  run(w, s, K7_SERVICE_TUNE.dwell + 6);
  assert.equal(rec(w).state, 'docked');
  assert.equal(rec(w).light, 1);
  // odlot ku bramie (S — wsteczny, 300 j/s): awaryjne odpięcie, potem reflektor gaśnie w lightFall
  moveTo(w, s, C01.x, C01.z, { vhz: 300 });
  let idleAt = -1;
  let t = 0;
  run(w, s, 8, { each: () => {
    t += DT;
    const hz = C01.z + 300 * t;
    moveTo(w, s, C01.x, hz, { vhz: 300 });
    if (idleAt < 0 && rec(w).state === 'idle') idleAt = t;
  } });
  assert.ok(idleAt > 0, 'odpięcie skończone');
  assert.equal(rec(w).approach, false, 'oddalanie ku bramie to nie podejście');
  assert.equal(rec(w).light, 0, 'reflektor przygaszony po odlocie');
  assert.equal(berthOf(w).approachLight, 0);
});

test('bez podejścia: w poprzek pasa, za szybko, poza pasem, statek za krótki; histereza na brzegu pasa i przy prędkości', () => {
  const w = world();
  const half = L.lanes[0].width / 2;
  const s = shipAt(w, C01.x, 5000, { hubAngle: 0, vhz: -100 });
  run(w, s, 0.2);
  assert.equal(rec(w).approach, false, 'bokiem (kurs w poprzek pasa)');
  moveTo(w, s, C01.x, 5000, { hubAngle: -Math.PI / 2 + 30 * DEG, vhz: -100 });
  run(w, s, 0.2);
  assert.equal(rec(w).approach, false, 'kurs 30° od osi');
  moveTo(w, s, C01.x, 5000, { hubAngle: -Math.PI / 2, vhz: -650 });
  run(w, s, 0.2);
  assert.equal(rec(w).approach, false, 'za szybko na włączenie');
  moveTo(w, s, C01.x + half + 80, 5000, { vhz: -100 });
  run(w, s, 0.2);
  assert.equal(rec(w).approach, false, 'poza pasem');
  moveTo(w, s, C01.x, L.frontZ + L.apronDepth + 900, { vhz: -100 });
  run(w, s, 0.2);
  assert.equal(rec(w).approach, false, 'za daleko przed bramą');
  assert.equal(rec(w).light, 0, 'reflektor dalej przygaszony');
  // histereza: włączony w pasie — trzyma się przy 650 j/s i 120 j. za brzegiem pasa, gaśnie przy 800 j/s i 400 j. za brzegiem
  moveTo(w, s, C01.x, 5000, { vhz: -100 });
  run(w, s, 0.1);
  assert.equal(rec(w).approach, true);
  moveTo(w, s, C01.x + half + 120, 5000, { vhz: -650 });
  run(w, s, 0.1);
  assert.equal(rec(w).approach, true, 'trzymanie: zapas pasa i prędkości');
  moveTo(w, s, C01.x + half + 400, 5000, { vhz: -100 });
  run(w, s, 0.1);
  assert.equal(rec(w).approach, false, 'za zapasem pasa — koniec podejścia');
  moveTo(w, s, C01.x + half + 120, 5000, { vhz: -100 });
  run(w, s, 0.1);
  assert.equal(rec(w).approach, false, 'powrót na brzeg nie włącza (ścisły warunek)');
  // za krótki kadłub (fregata) — stanowisko go nie obsłuży, reflektor nie reaguje
  const w2 = world();
  const f = shipAt(w2, C01.x, 4000, { vhz: -100 });
  f.w = 600; f.h = 240;
  run(w2, f, 0.5);
  assert.equal(rec(w2).approach, false, 'fregata');
});

test('zajęte stanowisko (fabuła, ruch v2) — pełny; pauza gry nie zatrzymuje światła; A/B approachLights = false — wszystkie pełne', () => {
  const w = world();
  const owner = w.col.registry.halls[0];
  // fabuła: poza C-01 z właścicielem 'story' i zajętość — reflektor C-01 pełny, choć statku nie ma
  owner.poses.get('C-01').owner = K7_POSE_OWNER.story;
  owner.layout.berths.find((b) => b.id === 'C-01').occupied = 'player';
  // statek ruchu v2 zarezerwował C-03
  owner.layout.berths.find((b) => b.id === 'C-03').reserved = 'traffic';
  // dt gry = 0 (pauza, scena fabuły), czas klatki płynie — światło dochodzi do celu
  run(w, null, K7_SERVICE_TUNE.lightRise + 0.05, { dt: 0, lightDt: DT });
  assert.equal(rec(w).state, 'foreign');
  assert.equal(berthOf(w, 'C-01').approachLight, 1, 'fabuła — pełny');
  assert.equal(berthOf(w, 'C-03').approachLight, 1, 'ruch v2 — pełny');
  assert.equal(berthOf(w, 'C-02').approachLight, 0, 'wolne — przygaszony');
  // bez czasu klatki (i gry) — stoi
  owner.layout.berths.find((b) => b.id === 'C-03').reserved = null;
  run(w, null, 1, { dt: 0, lightDt: 0 });
  assert.equal(berthOf(w, 'C-03').approachLight, 1, 'stoi bez czasu');
  run(w, null, K7_SERVICE_TUNE.lightFall * 0.5, { dt: 0, lightDt: DT });
  const mid = berthOf(w, 'C-03').approachLight;
  assert.ok(mid > 0.4 && mid < 0.6, `gaśnie liniowo w lightFall: ${mid}`);
  // A/B
  const T = { ...K7_SERVICE_TUNE, approachLights: false };
  const w2 = world();
  for (let i = 0; i < 60; i++) stepK7BerthService(w2.svc, DT, w2.place, [null], 0, T, DT);
  for (const id of ['C-01', 'C-02', 'C-03', 'C-04']) assert.equal(berthOf(w2, id).approachLight, 1, `A/B ${id}`);
});

test('pył hal: blok obsługi niesie poziom reflektora (NaN bez rejestru), światło reflektora w siatce gry × mnożnik', async () => {
  const w = world();
  const owner = w.col.registry.halls[0];
  const IN = new Float64Array(HALL_DUST_IN.size);
  const S = HALL_DUST_SERVICE;
  owner.layout.berths.find((b) => b.id === 'C-02').approachLight = 0.5;
  packHallService(IN, owner.poses, owner.layout.berths);
  const at = (i) => IN[HALL_DUST_IN.service + i * S.stride + S.light];
  assert.deepEqual([at(0), at(1), at(2), at(3)], [0, 0.5, 0, 0]);
  packHallService(IN, owner.poses);
  assert.ok(Number.isNaN(at(0)) && Number.isNaN(at(1)), 'bez rejestru stanowisk — NaN (pełna moc)');
  // HallDust._lights (bez Core3D: stan kroku ustawiony ręcznie) — reflektor C-01 × mnożnik, pozostałe bez zmian
  const { HallDust, HALL_DUST_TUNE } = await import('../src/3d/gasField/hallDust.js');
  const rig = k7LightRig(L);
  const capIds = L.berths.filter((b) => b.size === 'CAPITAL').map((b) => b.id);
  Object.assign(HallDust, { rig, fields: [], _beaconBerth: rig.beacons.map((b) => (b.berthId ? capIds.indexOf(b.berthId) : -1)),
    _spotBerth: rig.spots.map((s) => (s.berthId ? capIds.indexOf(s.berthId) : -1)) });
  const I = HALL_DUST_IN;
  const H = HallDust.input;
  H.fill(0);
  H[I.active] = 1; H[I.viewHalf] = 1000; H[I.ax] = 1; H[I.by] = 1; H[I.lamps] = 0.22; H[I.clock] = 1;
  const spotsOf = (light) => {
    for (let b = 0; b < 4; b++) H[I.service + b * S.stride + S.light] = light[b];
    const calls = [];
    const grid = { count: 0, addWorld(...a) { calls.push(a); this.count++; } };
    HallDust._lights({ grid });
    // reflektory = światła z kierunkiem (11 argumentów)
    return calls.filter((c) => c.length > 8).map((c) => c[4]);
  };
  const full = spotsOf([NaN, NaN, NaN, NaN]);
  const lit = spotsOf([0, 1, 0.5, NaN]);
  assert.equal(full.length, rig.spots.length);
  assert.ok(Math.abs(lit[0] - full[0] * K7_APPROACH_SPOT.idle) < 1e-9, 'C-01 wolne — przygaszony');
  assert.ok(Math.abs(lit[1] - full[1]) < 1e-9, 'C-02 podejście — pełny');
  assert.ok(Math.abs(lit[2] - full[2] * k7ApproachSpotGain(0.5)) < 1e-9, 'C-03 w połowie');
  assert.ok(Math.abs(lit[3] - full[3]) < 1e-9, 'C-04 bez poziomu — pełny');
  for (let i = 4; i < full.length; i++) assert.equal(lit[i], full[i], 'bramy i ściany boczne bez zmian');
  assert.ok(HALL_DUST_TUNE.hallLights);
});

test('hala K-7 (obraz): uK7Spots reflektora stanowiska × mnożnik z rejestru, bez rejestru — pełna moc; stała liczba reflektorów', async () => {
  const { createHaloRingLayout } = await import('../src/3d/haloRing/haloRingLayout.js');
  const { createHaloUniforms } = await import('../src/3d/haloRing/haloRingUniforms.js');
  const { haloPortComplexAngles } = await import('../src/3d/haloRing/haloRingConfig.js');
  const { haloBayLayouts } = await import('../src/3d/haloRing/haloPortBays.js');
  const { HaloPortK7 } = await import('../src/3d/haloRing/haloPortK7.js');
  const ring = createHaloRingLayout({});
  const hall = new HaloPortK7({
    ringLayout: ring, uniforms: createHaloUniforms(ring), layout: createK7Layout(), angle: haloPortComplexAngles()[0], index: 0,
    bays: haloBayLayouts(ring).filter((b) => b.complex === 0), style: ring.planetProfile.port
  });
  const spots = hall.k7Uniforms.uK7Spots.value;
  const len = spots.length;
  const base = spots.map((v) => [v.x, v.y, v.z, v.w]);
  const rig = k7LightRig(L);
  const reg = createK7Layout().berths;
  for (const b of reg) b.approachLight = b.id === 'C-02' ? 1 : 0;
  hall.update(0.016, { berths: reg });
  assert.equal(spots.length, len, 'bez zmiany liczby reflektorów (graf)');
  rig.spots.forEach((s, i) => {
    const c = spots[i * 3 + 2];
    const k = s.berthId === 'C-02' ? 1 : s.berthId ? K7_APPROACH_SPOT.idle : 1;
    assert.ok(Math.abs(c.x - base[i * 3 + 2][0] * k) < 1e-6, `${s.berthId || 'reflektor ' + i}: barwa × ${k}`);
    assert.equal(c.w, base[i * 3 + 2][3], 'cos wewnętrzny bez zmian');
    assert.deepEqual([spots[i * 3].x, spots[i * 3].y, spots[i * 3].z], base[i * 3].slice(0, 3), 'pozycja bez zmian');
  });
  assert.equal(spots[0].y, k7HeightToZ(rig.spots[0].y));
  hall.update(0.016, {});
  rig.spots.forEach((s, i) => assert.ok(Math.abs(spots[i * 3 + 2].x - base[i * 3 + 2][0]) < 1e-6, 'bez rejestru — pełna moc'));
  hall.dispose();
});
