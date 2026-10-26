// Warp gracza w workerze renderu (nowy warp, etap W — DECYZJE W1 / W2; projekt D § 4): migawka niesie PEŁNY kształt
// GameState.warp (src/render/warpWorldMirror.js — rampa, ślizg, kurs x / y, ciało celu i startu, zegary, kotwica kadru),
// worker rozpakowuje go do lustra, więc WarpPlayerFx (player.js) widzi te same liczby co w trybie off: soczewka świata
// (lensBeta), smugi i front gwiazd, cień kadłuba i tryb wyjścia skończone i RÓWNE w obu trybach. Dawne lustro workera
// ({ active, age, tBrake } i kurs = NaN) dawało w 1. klatce wyjścia NaN — test „dawne lustro” to pokazuje.
// node --test tests/warpWorkerMirror.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORLD, SNAPSHOT_LAYOUT_VERSION } from '../src/render/snapshotLayout.js';
import { SnapshotPacker, SnapshotDict, createSnapshotFrame } from '../src/render/snapshotPack.js';
import {
  packWarpWorld, applyWarpWorld, createWarpWorldMirror, installWarpPlayerFields, publishWarpPlayerFields,
  warpBodyIndex, warpBodyAt, warpFxDt, WARP_RAMP_FIELDS, WARP_SLIDE_FIELDS, WARP_SCALAR_FIELDS, WARP_LENS_FIELDS
} from '../src/render/warpWorldMirror.js';
import {
  createWarpLensTrack, createWarpLensPhase, stepWarpLensPhase, warpLensBeta, WARP_LENS_PHASE, WARP_LENS_EXIT_SPAN
} from '../src/render/warpLensPhase.js';
import { createWarpExitRamp } from '../src/game/warpDrive.js';
import { RenderWorld, createMirrorPlayersSource } from '../src/render/renderWorld.js';
import { WarpPlayerFx, WARP_HULL_SHADOW } from '../src/3d/warp/player.js';
import { WarpFrame, newWarpSlot } from '../src/3d/warp/frame.js';
import { createCameraRig, stepCameraRig, CAMERA_RIG_DEFAULTS } from '../src/game/cameraRig.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DT = 1 / 60;

// ── świat testu: planety i małe ciała strony; worker ma KOPIE (postMessage — inne obiekty, ta sama kolejność) ──
function makeBodies() {
  const planets = [
    { id: 'earth', x: 1_056_000, y: 0, r: 8400, ringWorldRadius: 37800 },
    { id: 'mars', x: 1_200_000, y: 250_000, r: 6700 },
    null,   // dziura na liście (gra pomija `!planet`) — indeksy liczą się dalej
    { id: 'jupiter', x: -2_121_000, y: 40_000, r: 10700 }
  ];
  const small = [{ id: 'ceres', x: 1_640_000, y: -300_000, r: 4717 }, { id: 'vesta', x: 1_560_000, y: 120_000, r: 3300 }];
  return { planets, small };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

function makeGameWarp() {
  return {
    state: 'idle', charge: 0, chargeTime: 0.8, gear: 1, dir: { x: 0, y: 0 }, flybyFactor: 1, cruise: 175000,
    speed: 175000, entryProgress: 0, entryDuration: 0.9, kickSim: NaN, originBody: null, targetBody: null,
    exitRamp: null, exitSlide: null, gravityBrake: { active: false, timer: 0 }, chargeAngle: NaN,
    isBusy() { return this.state !== 'idle' || !!(this.exitRamp && this.exitRamp.active); }
  };
}

function packFrame(f, warp, bodies, extra = {}) {
  f.warp = warp;
  f.warpLens = extra.lens || null;
  f.boost = extra.boost === undefined ? { state: 'idle' } : extra.boost;
  f.planets = bodies.planets;
  f.smallBodies = bodies.small;
  f.warpFxClock = extra.clock ?? NaN;
  f.warpAnchorSX = extra.ax ?? NaN;
  f.warpAnchorSY = extra.ay ?? NaN;
  return f;
}

// ── kopia mapowania obiektu warpa na wejście efektu — warpNurt.js (WarpNurt.update, gałąź warpa) ──
// Strażnik źródła niżej pilnuje, że warpNurt czyta te same pola.
function gameView(warp, g) {
  g.state = warp.state;
  g.charge = warp.chargeTime > 0 ? Math.min(1, (Number(warp.charge) || 0) / warp.chargeTime) : 0;
  g.chargeTime = Number(warp.chargeTime) || 0.8;
  g.gear = warp.gear || 1;
  g.angle = warp.state === 'active' && warp.dir && (warp.dir.x || warp.dir.y) ? Math.atan2(warp.dir.y, warp.dir.x) : g.poseAngle;
  g.exitRamp = warp.exitRamp || null;
  g.flyby = Number.isFinite(warp.flybyFactor) ? warp.flybyFactor : 1;
  g.cruise = Number(warp.cruise) || Number(warp.speed) || 0;
  g.hyper = false;
  g.lens = g.lensRec || null;
  return g;
}

test('warpNurt czyta z obiektu warpa te pola, które kopiuje gameView testu (strażnik źródła)', () => {
  const src = read('src/3d/warp/warpNurt.js');
  for (const re of [
    /g\.state = warp\.state;/,
    /g\.charge = warp\.chargeTime > 0 \? Math\.min\(1, \(Number\(warp\.charge\) \|\| 0\) \/ warp\.chargeTime\) : 0;/,
    /g\.chargeTime = Number\(warp\.chargeTime\) \|\| 0\.8;/,
    /g\.gear = warp\.gear \|\| 1;/,
    /g\.angle = warp\.state === 'active' && warp\.dir && \(warp\.dir\.x \|\| warp\.dir\.y\) \? Math\.atan2\(warp\.dir\.y, warp\.dir\.x\) : pose\.angle;/,
    /g\.exitRamp = warp\.exitRamp \|\| null;/,
    /g\.flyby = Number\.isFinite\(warp\.flybyFactor\) \? warp\.flybyFactor : 1;/,
    /g\.cruise = Number\(warp\.cruise\) \|\| Number\(warp\.speed\) \|\| 0;/,
    /L\.target = o\.warp\?\.targetBody \|\| null;/
  ]) assert.match(src, re);
  // każde pole obiektu warpa czytane przez sterownik i moduły renderu (warpNurt, plazma dysz, lakier) jest w lustrze
  const mir = createWarpWorldMirror();
  const fields = new Set();
  for (const m of src.matchAll(/\bwarp\??\.(\w+)/g)) fields.add(m[1]);
  for (const f of ['state', 'exitRamp']) fields.add(f);   // engineVfxSystem.resolveWarpMode, hullLacquer.js
  for (const f of fields) assert.ok(f in mir.warp, `lustro warpa bez pola „${f}” (czyta je render)`);
  const vfx = read('src/3d/engineVfxSystem.js');
  assert.match(vfx, /const w = RenderWorld\.warp;[\s\S]{0,400}r && r\.active && r\.age < r\.tBrake \+ 0\.25/);
});

test('układ migawki 3: WORLD bez dawnego WARP_DIR (obiekt → zawsze NaN), z kursem x / y, rampą, ślizgiem, ciałami, zegarami, kotwicą, osią β soczewki', () => {
  assert.equal(SNAPSHOT_LAYOUT_VERSION, 3);
  // oś β soczewki (warpLensPhase.js): każde pole liczbowe rekordu strony gry ma słowo migawki; stan i flagi osobno
  const lensKeys = new Set(WARP_LENS_FIELDS.map((p) => p[1]));
  for (const k of Object.keys(createWarpLensPhase())) {
    if (k === 'state' || k === 'hyper' || k === 'arriving') continue;
    assert.ok(lensKeys.has(k), `pole osi β „${k}” bez słowa migawki`);
  }
  for (const k of ['WARP_LENS_STATE', 'WARP_LENS_HYPER', 'WARP_LENS_ARRIVING']) assert.ok(Number.isInteger(WORLD[k]), k);
  assert.equal(WORLD.WARP_DIR, undefined);
  for (const k of ['WARP_DIR_X', 'WARP_DIR_Y', 'WARP_TARGET_BODY', 'WARP_ORIGIN_BODY', 'WARP_KICK_SIM', 'WARP_FX_CLOCK',
    'WARP_ENTRY', 'WARP_EXIT_ACTIVE', 'WARP_SLIDE_ACTIVE', 'WARP_ABRUPT', 'WARP_ANCHOR_SX', 'WARP_ANCHOR_SY', 'BOOST_STATE']) {
    assert.ok(Number.isInteger(WORLD[k]), k);
  }
  // pełna rampa createWarpExitRamp: każde pole liczbowe ma słowo migawki
  const ramp = createWarpExitRamp({ v0: 120000, hullLength: 1800, dirX: 0.6, dirY: -0.8, vEnd: 1521, startTime: 12.5 });
  const rampKeys = new Set(WARP_RAMP_FIELDS.map((p) => p[1]));
  for (const k of Object.keys(ramp)) if (k !== 'active') assert.ok(rampKeys.has(k), `pole rampy „${k}” bez słowa migawki`);
  assert.deepEqual(new Set(WARP_SLIDE_FIELDS.map((p) => p[1])), new Set(['speed', 'vMin', 'decel', 'dirX', 'dirY']));
  assert.ok(WARP_SCALAR_FIELDS.some((p) => p[1] === 'entryProgress') && WARP_SCALAR_FIELDS.some((p) => p[1] === 'kickSim'));
});

test('indeks ciała: planety, potem małe ciała; worker podstawia SWOJE obiekty (te z initPlanets3D)', () => {
  const page = makeBodies();
  const wk = clone(page);
  assert.equal(warpBodyIndex(page.planets[1], page.planets, page.small), 1);
  assert.equal(warpBodyIndex(page.planets[3], page.planets, page.small), 3);
  assert.equal(warpBodyIndex(page.small[1], page.planets, page.small), page.planets.length + 1);
  assert.equal(warpBodyIndex({ id: 'obcy' }, page.planets, page.small), -1);
  assert.equal(warpBodyIndex(null, page.planets, page.small), -1);
  assert.equal(warpBodyAt(3, wk.planets, wk.small), wk.planets[3]);
  assert.equal(warpBodyAt(page.planets.length + 1, wk.planets, wk.small), wk.small[1]);
  assert.equal(warpBodyAt(-1, wk.planets, wk.small), null);
  assert.equal(warpBodyAt(1, null, null), null, 'worker przed wiadomością planet — bez celu');
  assert.equal(warpBodyAt(99, wk.planets, wk.small), null);
});

test('pakowanie → lustro: ładowanie, lot, rampa (zwolnienie / wlot / hamowanie), ślizg, hamowanie grawitacyjne — każde pole równe', () => {
  const page = makeBodies();
  const wk = clone(page);
  const dict = new SnapshotDict();
  const w = new Float64Array(WORLD.COUNT);
  const f = createSnapshotFrame();
  const mir = createWarpWorldMirror();
  const warp = makeGameWarp();
  const check = (label) => {
    packWarpWorld(w, packFrame(f, warp, page, { clock: 3.25, ax: -12.5, ay: 188 }), dict);
    applyWarpWorld(w, dict, mir, wk.planets, wk.small);
    const m = mir.warp;
    assert.equal(mir.hasWarp, true, label);
    for (const k of ['state', 'charge', 'chargeTime', 'gear', 'flybyFactor', 'cruise', 'speed', 'entryProgress']) {
      assert.equal(m[k], warp[k], `${label}: ${k}`);
    }
    assert.ok(Object.is(m.kickSim, warp.kickSim), `${label}: kickSim`);
    assert.equal(m.dir.x, warp.dir.x, `${label}: dir.x`);
    assert.equal(m.dir.y, warp.dir.y, `${label}: dir.y`);
    assert.equal(m.targetBody, warpBodyAt(warpBodyIndex(warp.targetBody, page.planets, page.small), wk.planets, wk.small), `${label}: cel`);
    assert.equal(m.originBody, warpBodyAt(warpBodyIndex(warp.originBody, page.planets, page.small), wk.planets, wk.small), `${label}: start`);
    if (warp.targetBody) assert.equal(m.targetBody.id, warp.targetBody.id, `${label}: cel — to samo ciało`);
    if (warp.exitRamp) {
      assert.ok(m.exitRamp, `${label}: rampa`);
      for (const k of Object.keys(warp.exitRamp)) assert.equal(m.exitRamp[k], warp.exitRamp[k], `${label}: exitRamp.${k}`);
    } else assert.equal(m.exitRamp, null, `${label}: bez rampy`);
    if (warp.exitSlide) {
      for (const k of Object.keys(warp.exitSlide)) assert.equal(m.exitSlide[k], warp.exitSlide[k], `${label}: exitSlide.${k}`);
    } else assert.equal(m.exitSlide, null, `${label}: bez ślizgu`);
    assert.equal(m.gravityBrake.active, !!warp.gravityBrake.active, `${label}: abrupt`);
    assert.equal(m.isBusy(), warp.isBusy(), `${label}: isBusy`);
    assert.equal(mir.fxClock, 3.25);
    assert.equal(mir.anchorSX, -12.5);
    assert.equal(mir.anchorSY, 188);
  };
  check('bezczynny');
  warp.state = 'charging'; warp.charge = 0.33; warp.chargeAngle = -1.1;
  check('ładowanie');
  warp.state = 'active'; warp.dir.x = Math.cos(-1.1); warp.dir.y = Math.sin(-1.1); warp.kickSim = 41.25;
  warp.originBody = page.planets[0]; warp.targetBody = page.small[1]; warp.entryProgress = 0.4; warp.flybyFactor = 0.37;
  warp.cruise = 128_400.5;
  check('lot (cel — małe ciało)');
  warp.targetBody = page.planets[3];
  check('lot (cel — planeta za dziurą listy)');
  warp.state = 'idle';
  warp.exitRamp = createWarpExitRamp({ v0: 128_400.5, hullLength: 1800, dirX: warp.dir.x, dirY: warp.dir.y, vEnd: 1521, startTime: 44.75 });
  for (const age of [0, 0.35, 0.9, 1.2, 1.3]) { warp.exitRamp.age = age; check(`rampa ${age}`); }
  warp.exitRamp.active = false;
  warp.exitSlide = { active: true, dirX: warp.dir.x, dirY: warp.dir.y, speed: 1521, vMin: 507, decel: 200 };
  check('ślizg');
  warp.exitSlide.active = false;
  check('po ślizgu');
  warp.exitRamp = null; warp.exitSlide = null; warp.gravityBrake.active = true;
  check('hamowanie grawitacyjne (bez rampy)');
  // brak obiektu warpa i dopalacza — lustro „nie ma” (RenderWorld.warp / boost workera = null)
  packWarpWorld(w, packFrame(f, null, page, { boost: null }), dict);
  applyWarpWorld(w, dict, mir, wk.planets, wk.small);
  assert.equal(mir.hasWarp, false);
  assert.equal(mir.hasBoost, false);
  assert.ok(Number.isNaN(mir.anchorSX), 'kotwica: NaN poza kamerą statku');
});

test('SnapshotPacker._packWorld pakuje warp przez warpWorldMirror (te same słowa co packWarpWorld)', () => {
  const page = makeBodies();
  const packer = new SnapshotPacker({ shared: false });
  const f = createSnapshotFrame();
  const warp = makeGameWarp();
  warp.state = 'active'; warp.dir.x = 0; warp.dir.y = -1; warp.targetBody = page.planets[1];
  warp.exitRamp = createWarpExitRamp({ v0: 90000, hullLength: 1800, dirX: 0, dirY: -1, vEnd: 0 });
  packFrame(f, warp, page, { clock: 1.5, ax: 3, ay: 4 });
  const v = { world: new Float64Array(WORLD.COUNT) };
  packer._packWorld(v, f);
  const w2 = new Float64Array(WORLD.COUNT);
  packWarpWorld(w2, f, packer.dict);
  for (let i = WORLD.WARP_STATE; i <= WORLD.BOOST_STATE; i++) assert.ok(Object.is(v.world[i], w2[i]), `słowo ${i}`);
  assert.equal(v.world[WORLD.WARP_TARGET_BODY], 1);
  assert.equal(v.world[WORLD.WARP_DIR_Y], -1);
  assert.equal(v.world[WORLD.WARP_EXIT_THALT], warp.exitRamp.tHalt);
  assert.equal(packer.dict.value(v.world[WORLD.WARP_STATE]), 'active');
});

// ── parzystość off ≡ worker na prawdziwym WarpPlayerFx ─────────────────────────────────────────────────────

function fxRig() {
  const fx = new WarpPlayerFx();
  fx.bubble = newWarpSlot();
  fx.push = newWarpSlot();
  const frame = new WarpFrame();
  const g = { state: 'idle', charge: 0, chargeTime: 0.8, gear: 1, speed: 0, angle: 0, poseAngle: -1.1, x: 1000, y: 2000,
    length: 1800, width: 800, palette: 'magenta', vRelX: 0, vRelY: 0, exitRamp: null, flyby: 1, cruise: 0, hyper: false };
  const map = { camX: 900, camY: 1900 };
  const med = { camMX: 0, camMY: 0, flow: 0, flowX: 0, flowY: 0 };
  const step = (t, dt, warp, lens = null) => {
    g.lensRec = lens;
    gameView(warp, g);
    frame.reset();
    fx.advance(t, dt, g, map, med);
    const shadow = WARP_HULL_SHADOW.player;
    const v = fx.visibleFlow(t);
    med.flow = v === null ? 0 : v;
    med.flowX = Math.cos(fx.angle) * med.flow;
    med.flowY = Math.sin(fx.angle) * med.flow;
    med.camMX += med.flowX * dt;
    med.camMY += med.flowY * dt;
    fx.fill(t, g, frame, map, med);
    const st = frame.stars;
    return {
      mode: fx.mode, beta: fx.lensBeta(t), stretch: st.stretch, tint: st.warpTint, frontS: st.frontS, frontOn: st.frontOn,
      warpVis: frame.warpVis, shadow, heat: fx.hull.heat, angle: fx.angle, tHalt: fx.ramp.tHalt, exitT: fx.exitT,
      bubble: fx.bubble.on ? 1 : 0, A: fx.bubble.A, flow: med.flow
    };
  };
  return { fx, step };
}

/** Skrypt skoku jak index.html (ładowanie 0,8 s → kop → lot ze zwolnieniem przy ciele → rampa → ślizg). */
function* jumpScript(page, { target = 'planet' } = {}) {
  const warp = makeGameWarp();
  let sim = 100;
  let t = 1;
  for (let i = 0; i < 30; i++) { t += DT; sim += DT; yield { t, sim, warp }; }
  warp.state = 'charging';
  warp.chargeAngle = -1.1;
  while (warp.state === 'charging') {
    warp.charge += DT;
    warp.dir.x = Math.cos(warp.chargeAngle); warp.dir.y = Math.sin(warp.chargeAngle);
    if (warp.charge >= warp.chargeTime) {
      warp.state = 'active'; warp.kickSim = sim; warp.entryProgress = 0;
      warp.originBody = page.planets[0];
      warp.targetBody = target === 'small' ? page.small[0] : page.planets[1];
      warp.cruise = 131_250;
    }
    t += DT; sim += DT; yield { t, sim, warp };
  }
  for (let i = 0; i < 180; i++) {
    warp.entryProgress = Math.min(1, warp.entryProgress + DT / warp.entryDuration);
    warp.flybyFactor = 1 - 0.8 * Math.exp(-(((i - 90) / 30) ** 2));   // mijane ciało
    t += DT; sim += DT; yield { t, sim, warp };
  }
  warp.state = 'idle';
  warp.exitRamp = createWarpExitRamp({ v0: 131_250, hullLength: 1800, dirX: warp.dir.x, dirY: warp.dir.y, vEnd: 1521, startTime: sim });
  while (warp.exitRamp.active) {
    t += DT; sim += DT;
    warp.exitRamp.age += DT;
    if (warp.exitRamp.age >= warp.exitRamp.tHalt) {
      warp.exitRamp.active = false;
      warp.exitSlide = { active: true, dirX: warp.dir.x, dirY: warp.dir.y, speed: 1521, vMin: 507, decel: 200 };
    }
    yield { t, sim, warp };
  }
  for (let i = 0; i < 360; i++) {
    const sl = warp.exitSlide;
    if (sl && sl.active) { sl.speed = Math.max(sl.vMin, sl.speed - sl.decel * DT); if (sl.speed <= sl.vMin + 1e-6) sl.active = false; }
    t += DT; sim += DT; yield { t, sim, warp };
  }
}

for (const target of ['planet', 'small']) {
  test(`parzystość off ≡ worker (WarpPlayerFx, cel: ${target}): soczewka β, smugi i front gwiazd, cień kadłuba, tryb — skończone i równe co klatkę`, () => {
    const page = makeBodies();
    const wk = clone(page);
    const dict = new SnapshotDict();
    const w = new Float64Array(WORLD.COUNT);
    const f = createSnapshotFrame();
    const mir = createWarpWorldMirror();
    const off = fxRig();
    const wrk = fxRig();
    let frames = 0, exitFrames = 0, maxBeta = 0, sawFront = false, sawIdleAfter = false;
    for (const { t, warp } of jumpScript(page, { target })) {
      const a = off.step(t, DT, warp);
      packWarpWorld(w, packFrame(f, warp, page), dict);
      applyWarpWorld(w, dict, mir, wk.planets, wk.small);
      const b = wrk.step(t, DT, mir.warp);
      for (const k of Object.keys(a)) {
        assert.ok(typeof a[k] === 'string' || Number.isFinite(a[k]) || a[k] === -1e9, `off ${k} @${t.toFixed(3)}: ${a[k]}`);
        if (typeof a[k] === 'number') assert.ok(Number.isFinite(b[k]) || b[k] === -1e9, `worker ${k} @${t.toFixed(3)}: ${b[k]}`);
        assert.ok(a[k] === b[k] || Math.abs(a[k] - b[k]) < 1e-9, `${k} @${t.toFixed(3)}: off ${a[k]} ≠ worker ${b[k]}`);
      }
      if (warp.state === 'active') {
        assert.equal(mir.warp.targetBody, target === 'small' ? wk.small[0] : wk.planets[1], 'cel skoku w workerze = obiekt ciała workera');
      }
      if (a.mode === 'exit') { exitFrames++; if (a.frontOn) sawFront = true; }
      if (exitFrames > 0 && a.mode === 'idle') sawIdleAfter = true;
      maxBeta = Math.max(maxBeta, a.beta);
      frames++;
    }
    assert.ok(frames > 600 && exitFrames > 60);
    assert.ok(maxBeta > 0.999, 'soczewka w locie');
    assert.ok(sawFront, 'front prostowania smug przy wyjściu');
    assert.ok(sawIdleAfter, 'tryb wyjścia wraca do bezczynności (dawniej w workerze: exit bez końca)');
    assert.equal(WARP_HULL_SHADOW.player, 1, 'cień kadłuba wrócił');
  });
}

test('dawne lustro workera ({ active, age, tBrake }, kurs = NaN): NaN w 1. klatce wyjścia — tego test parzystości nie przepuści', () => {
  const page = makeBodies();
  const rig = fxRig();
  const legacy = { state: 'idle', charge: 0, chargeTime: 0.8, gear: 1, dir: NaN, flybyFactor: 1, cruise: 0, speed: 0, exitRamp: null };
  const lr = { active: false, age: 0, tBrake: 0 };
  let nanBeta = false, nanTint = false;
  for (const { t, warp } of jumpScript(page)) {
    Object.assign(legacy, { state: warp.state, charge: warp.charge, chargeTime: warp.chargeTime, gear: warp.gear,
      flybyFactor: warp.flybyFactor, cruise: warp.cruise, speed: warp.speed });
    if (warp.exitRamp) { lr.active = warp.exitRamp.active; lr.age = warp.exitRamp.age; lr.tBrake = warp.exitRamp.tBrake; legacy.exitRamp = lr; }
    else legacy.exitRamp = null;
    const s = rig.step(t, DT, legacy);
    if (s.mode === 'exit' && Number.isNaN(s.beta)) nanBeta = true;
    if (s.mode === 'exit' && Number.isNaN(s.tint)) nanTint = true;
  }
  // β soczewki nie zależy już od kształtu rampy w lustrze (oś β z rekordu strony gry — warpLensPhase.js, test niżej);
  // smugi gwiazd (warpTint) z dawnej rampy dalej dają NaN
  assert.ok(nanTint && !nanBeta, 'dawny kształt rampy dawał NaN (warpTint)');
  WARP_HULL_SHADOW.player = 1;
});

// ── źródło graczy workera: RenderWorld.warp / .boost (plazma WARP i dopalacza gracza, lakier) ──

test('worker: RenderWorld.warp / .boost z lustra (dawniej undefined — brak plazmy WARP i dopalacza gracza)', () => {
  const page = makeBodies();
  const src = installWarpPlayerFields(createMirrorPlayersSource());
  const dict = new SnapshotDict();
  const w = new Float64Array(WORLD.COUNT);
  const mir = createWarpWorldMirror();
  const warp = makeGameWarp();
  warp.state = 'active';
  packWarpWorld(w, packFrame(createSnapshotFrame(), warp, page, { boost: { state: 'active' } }), dict);
  applyWarpWorld(w, dict, mir, page.planets, page.small);
  publishWarpPlayerFields(src, mir);
  RenderWorld.setSource(src);
  try {
    assert.equal(RenderWorld.warp, mir.warp);
    assert.equal(RenderWorld.warp.state, 'active');
    assert.equal(RenderWorld.boost.state, 'active');
    // rampa — plazma do hamowania (engineVfxSystem.resolveWarpMode: r.active && r.age < r.tBrake + 0,25)
    warp.state = 'idle';
    warp.exitRamp = createWarpExitRamp({ v0: 90000, hullLength: 1800, dirX: 1, dirY: 0 });
    warp.exitRamp.age = 0.5;
    packWarpWorld(w, packFrame(createSnapshotFrame(), warp, page), dict);
    applyWarpWorld(w, dict, mir, page.planets, page.small);
    publishWarpPlayerFields(src, mir);
    const r = RenderWorld.warp.exitRamp;
    assert.ok(r && r.active && r.age < r.tBrake + 0.25);
    packWarpWorld(w, packFrame(createSnapshotFrame(), null, page, { boost: null }), dict);
    applyWarpWorld(w, dict, mir, page.planets, page.small);
    publishWarpPlayerFields(src, mir);
    assert.equal(RenderWorld.warp, null);
    assert.equal(RenderWorld.boost, null);
  } finally {
    RenderWorld.setSource(null);
  }
  // `?szew=inline`: źródło luster bez pól własnych — czyta obiekty gry strony (getter prototypu)
  const inline = createMirrorPlayersSource();
  assert.equal(Object.prototype.hasOwnProperty.call(inline, 'warp'), false);
  // worker wpina pola i lustro
  const wsrc = read('src/render/render.worker.js');
  assert.match(wsrc, /warpWorld\.installWarpPlayerFields\(st\.players\)/);
  assert.match(wsrc, /ww\.applyWarpWorld\(v\.world, st\.dict, st\.warpMir, st\.planets \|\| null, st\.small \|\| null\);\s*ww\.publishWarpPlayerFields\(st\.players, st\.warpMir\);/);
  assert.match(wsrc, /wf\.warp = st\.warpMir\.hasWarp \? st\.warpMir\.warp : null;/);
  assert.doesNotMatch(wsrc, /WD\.WARP_DIR\]|st\.warpRamp|st\.warpObj/);
});

test('dt efektu w workerze z zegara efektu strony: pominięte strony nie gubią czasu, pauza = 0, cofnięcie — dt strony', () => {
  const st = { prev: NaN };
  assert.equal(warpFxDt(st, 10, 1 / 60), 1 / 60, 'pierwsza strona — dt strony');
  assert.ok(Math.abs(warpFxDt(st, 10 + 3 / 60, 1 / 60) - 3 / 60) < 1e-12, 'dwie pominięte strony — ich czas wraca');
  assert.equal(warpFxDt(st, 10 + 3 / 60, 0), 0, 'pauza — zegar stoi');
  assert.equal(warpFxDt(st, 2, 1 / 60), 1 / 60, 'zegar cofnięty (nowa sesja) — dt strony');
  assert.equal(warpFxDt(st, NaN, 0.02), 0.02, 'bez zegara — dt strony');
  // strona: zegar = suma dt klatek „Nurtu” (przycięte jak WarpNurt.update) w fazie begin migawki
  const html = read('index.html');
  assert.match(html, /_warpFxClock \+= Math\.max\(0, Math\.min\(0\.1, Number\(f\.warpNurt\.dt\) \|\| 0\)\);\s*f\.warpFxClock = _warpFxClock;/);
  assert.match(html, /f\.planets = planets;\s*f\.smallBodies = window\.smallBodies \|\| null;/);
  // ta sama kolejność ciał, którą strona wysyła workerowi
  assert.match(html, /rwHost\.syncPlanets\(planets, SUN, window\.smallBodies,/);
});

test('kotwica kadru skoku (DECYZJE M3): sprężyna riga bez kopu warpa i bez wysunięcia przy wyjściu', () => {
  const rig = createCameraRig();
  const input = { dt: DT, viewW: 1920, viewH: 1080, mode: 'never', velX: 0, velY: -400, maxSpeed: 500, lookEnabled: false };
  for (let i = 0; i < 120; i++) stepCameraRig(rig, input, CAMERA_RIG_DEFAULTS);
  assert.equal(rig.nominalX, rig.offsetX);
  assert.equal(rig.nominalY, rig.offsetY, 'bez kopu i wysunięcia kotwica = offset riga');
  // kop warpa (cofnięcie wzdłuż kursu) i wysunięcie przy wyjściu ruszają offset, kotwica stoi
  rig.warpDirX = 0; rig.warpDirY = -1; rig.warpLagPx = 140; rig.warpAheadK = 0.4;
  stepCameraRig(rig, input, CAMERA_RIG_DEFAULTS);
  assert.notEqual(rig.offsetY, rig.nominalY);
  assert.ok(Math.abs(rig.nominalY - rig.springY) < 1e-9);
  const html = read('index.html');
  assert.match(html, /o\.anchorSX = anchorOn \? -cameraRig\.nominalX : NaN;/);
  assert.match(html, /o\.anchorSY = anchorOn \? -cameraRig\.nominalY : NaN;/);
  assert.match(html, /f\.warpAnchorSX = f\.warpNurt\.anchorSX;\s*f\.warpAnchorSY = f\.warpNurt\.anchorSY;/);
  assert.match(read('src/render/render.worker.js'), /wf\.anchorSX = st\.warpMir\.anchorSX; wf\.anchorSY = st\.warpMir\.anchorSY;/);
});

test('W2: księżyce bez Math.random — miejsce obrazu = węzeł gry (moonWorldPosition), deterministycznie w off i w workerze', async () => {
  const { SYSTEM_MAP_MOON_BY_ID, moonWorldPosition } = await import('../src/data/systemMap.js');
  const M = await import('../src/3d/moonOrbit.js');
  // Miejsce obrazu (czyste funkcje DirectMoon — moonOrbit.js) przy dowolnym miejscu planety = węzeł gry ruchu v2
  // (addMoonNode: moonWorldPosition(księżyc, planeta)); planety stoją, więc miejsce rodzica dowolne.
  const parent = { x: 1234567.25, y: -7654321.5 };
  const cases = [[M.MOON_TUNE, 'earth'], ...M.JUPITER_MOONS_TUNE.map((t) => [t, 'jupiter'])];
  assert.deepEqual(cases.map(([t]) => t.mapId), ['luna', 'io', 'europa', 'ganimedes', 'kallisto']);
  for (const [tune, parentId] of cases) {
    const node = M.moonGameNode(tune);
    assert.ok(node, `węzeł gry ${tune.mapId}`);
    assert.equal(node, SYSTEM_MAP_MOON_BY_ID[tune.mapId]);
    assert.equal(node.parentId, parentId);
    const angle = M.moonStartAngle(tune, node);
    assert.equal(angle, node.angle, `kąt węzła ${tune.mapId}`);
    const r = M.moonOrbitRadius(tune, node, 20000);
    const p = M.moonPlaceInto({ x: 0, y: 0 }, parent.x, parent.y, angle, r);
    if (tune.mapId === 'io') {
      // jedyny wyjątek: węzeł Io (60 tys.) leży pod ringiem Jowisza — obraz odsunięty na 86 tys. tym samym kątem
      assert.equal(r, 86000);
      assert.ok(Math.abs(Math.atan2(p.y - parent.y, p.x - parent.x) - node.angle) < 1e-12);
    } else {
      const q = moonWorldPosition(node, parent);
      assert.ok(Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6, `${tune.mapId}: obraz (${p.x}, ${p.y}) ≠ węzeł gry (${q.x}, ${q.y})`);
    }
    // bez obiegu (węzeł stoi) — obieg tylko w A/B ?ksiezyce=orbita
    assert.equal(M.moonOrbits(node, '?dev=1&renderWorker=1'), false);
    assert.equal(M.moonOrbits(node, '?dev=1&ksiezyce=orbita'), true);
  }
  assert.equal(SYSTEM_MAP_MOON_BY_ID.luna.orbitRadius, 96000);
  assert.equal(SYSTEM_MAP_MOON_BY_ID.luna.angle, 0.42);
  // księżyc bez węzła: faza strojenia (albo 0), promień jak dawniej, obieg — bez Math.random
  assert.equal(M.moonStartAngle({ phase: 1.4 }, null), 1.4);
  assert.equal(M.moonStartAngle({}, null), 0);
  assert.equal(M.moonOrbitRadius({ orbitRadiusMul: 3, orbitRadiusMin: 30000 }, null, 20000), 60000);
  assert.equal(M.moonOrbits(null, ''), true);
  assert.ok(Math.abs(M.moonOrbitSpeed(M.MOON_TUNE) - 2 * Math.PI / 220) < 1e-15);
  // DirectMoon (planet3d.assets.js) bierze miejsce z tych funkcji, bez Math.random i własnego strojenia
  const src = read('src/3d/planet3d.assets.js');
  const cls = src.slice(src.indexOf('class DirectMoon'), src.indexOf('class DirectMoon') + 9000);
  assert.doesNotMatch(cls, /Math\.random/, 'faza księżyca bez Math.random (zasada żelazna 9)');
  assert.doesNotMatch(read('src/3d/moonOrbit.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /Math\.random/, 'moonOrbit.js bez Math.random (poza komentarzami)');
  assert.match(src, /from '\.\/moonOrbit\.js';/);
  assert.doesNotMatch(src, /const (MOON_TUNE|JUPITER_MOONS_TUNE) = /, 'strojenie księżyców tylko w moonOrbit.js');
  assert.match(cls, /this\.gameNode = moonGameNode\(this\.tune\);/);
  assert.match(cls, /this\.orbitAngle = moonStartAngle\(this\.tune, this\.gameNode\);/);
  assert.match(cls, /this\.orbits = moonOrbits\(this\.gameNode, RenderWorld\.pageSearch\);/);
  assert.match(cls, /const orbitRadius = moonOrbitRadius\(this\.tune, this\.gameNode, parentR\);/);
  assert.match(cls, /const place = moonPlaceInto\(_moonPlace, parentX, parentY, this\.orbitAngle, orbitRadius\);/);
});

test('worker: RenderWorld.pageSearch = adres STRONY (A/B z adresu działa też w workerze renderu)', () => {
  const w = read('src/render/render.worker.js');
  assert.match(w, /pageSearch = m\.pageBase \? new URL\(m\.pageBase\)\.search : '';/);
  assert.match(w, /Object\.defineProperty\(st\.players, 'pageSearch', \{ value: pageSearch/);
  // przed pierwszym importem modułów renderu (czytają adres przy imporcie)
  assert.ok(w.indexOf("Object.defineProperty(st.players, 'pageSearch'") < w.indexOf("import('../3d/core3d.js')"));
  // fasada: pole własne źródła przesłania getter prototypu (location.search skryptu workera)
  const src = createMirrorPlayersSource();
  Object.defineProperty(src, 'pageSearch', { value: '?ksiezyce=orbita&warp=ped', enumerable: true });
  RenderWorld.setSource(src);
  try { assert.equal(RenderWorld.pageSearch, '?ksiezyce=orbita&warp=ped'); } finally { RenderWorld.setSource(null); }
});

// ── oś β soczewki świata (etap integracji): strona gry liczy stepWarpLensPhase (zegar gry), migawka niesie rekord,
// worker liczy warpLensBeta z tych samych pól — β off ≡ worker co klatkę, także przerwane ładowanie, wyjście w kopie,
// wyjście bez rampy i wiek wyjścia po zdjęciu rampy ──

/** Skrypt osi β: ładowanie przerwane, ładowanie → kop → wyjście w kopie, skok → wyjście z rampą (rampa zdjęta przy
 *  settle) i ślizg, skok → hamowanie grawitacyjne (bez rampy). Zegar gry = sim (render = sim, krok 60 Hz). */
function* lensScript(page) {
  const warp = makeGameWarp();
  let sim = 50;
  const tick = function* (n) { for (let i = 0; i < n; i++) { sim += DT; yield { sim, warp }; } };
  const charge = function* (frac) {
    warp.state = 'charging'; warp.charge = 0;
    while (warp.charge < warp.chargeTime * frac - 1e-9) { warp.charge = Math.min(warp.chargeTime, warp.charge + DT); sim += DT; yield { sim, warp }; }
  };
  const kick = () => { warp.state = 'active'; warp.kickSim = sim; warp.charge = 0; warp.targetBody = page.planets[1]; };
  const exitRamp = () => {
    warp.state = 'idle';
    warp.exitRamp = createWarpExitRamp({ v0: 120000, hullLength: 1800, dirX: 1, dirY: 0, vEnd: 1521, startTime: sim });
  };
  yield* tick(10);
  // 1. przerwane ładowanie (60%)
  yield* charge(0.6);
  warp.state = 'idle'; warp.charge = 0;
  yield* tick(40);
  // 2. ładowanie → kop → wyjście w trakcie kopu (0,2 s)
  yield* charge(1);
  kick();
  yield* tick(12);
  exitRamp();
  for (let i = 0; i < 240; i++) {
    sim += DT;
    const r = warp.exitRamp;
    if (r) {
      if (r.active) { r.age += DT; if (r.age >= r.tHalt) { r.active = false; warp.exitSlide = { active: true, speed: 1521, vMin: 507, decel: 200, dirX: 1, dirY: 0 }; } }
      else { r.age += DT; if (r.age > r.tHalt + 1.6) warp.exitRamp = null; }   // cameraRig: settle — rampa zdjęta
    }
    const sl = warp.exitSlide;
    if (sl && sl.active) { sl.speed = Math.max(sl.vMin, sl.speed - sl.decel * DT); if (sl.speed <= sl.vMin + 1e-6) sl.active = false; }
    yield { sim, warp };
  }
  // 3. skok → hamowanie grawitacyjne (exitWarp({ abrupt }) — bez rampy)
  yield* charge(1);
  kick();
  yield* tick(90);
  warp.state = 'idle'; warp.exitRamp = null; warp.gravityBrake.active = true;
  yield* tick(60);
  warp.gravityBrake.active = false;
  yield* tick(200);
}

test('oś β soczewki: strona gry (stepWarpLensPhase, zegar gry) → migawka → worker (warpLensBeta) — β off ≡ worker co klatkę, pola trackera w migawce', () => {
  const page = makeBodies();
  const wk = clone(page);
  const dict = new SnapshotDict();
  const w = new Float64Array(WORLD.COUNT);
  const f = createSnapshotFrame();
  const mir = createWarpWorldMirror();
  const track = createWarpLensTrack();
  const s = createWarpLensPhase();
  const off = fxRig();
  const wrk = fxRig();
  let t = 1;
  let maxCharge = 0, sawAbort = false, sawExitKick = false, exitAfterRamp = 0, sawAbrupt = false, frames = 0;
  let prevB = 0, maxStep = 0, prevExit = -1;
  for (const { sim, warp } of lensScript(page)) {
    t += DT;
    stepWarpLensPhase(track, s, warp, sim, false);
    s.zoomRef = 0.2133; s.zoomJump = 0.2133 * 0.55; s.arrivalFill = 0.75;
    packWarpWorld(w, packFrame(f, warp, page, { lens: s }), dict);
    applyWarpWorld(w, dict, mir, wk.planets, wk.small);
    assert.equal(mir.hasLens, true);
    for (const k of Object.keys(s)) assert.ok(Object.is(mir.lens[k], s[k]) || mir.lens[k] === s[k], `pole ${k}: strona ${s[k]} ≠ worker ${mir.lens[k]}`);
    const bPage = warpLensBeta(s);
    const bWorker = warpLensBeta(mir.lens);
    assert.equal(bWorker, bPage, `β @${sim.toFixed(3)}`);
    assert.equal(bPage, s.beta, 'β tej klatki = wynik stepWarpLensPhase');
    // WarpPlayerFx (player.js): lensBeta z rekordu gry — ten sam wynik w trybie off i w workerze
    const a = off.step(t, DT, warp, s);
    const b = wrk.step(t, DT, mir.warp, mir.lens);
    assert.equal(a.beta, bPage, 'off: WarpPlayerFx.lensBeta = warpLensBeta(rekord)');
    assert.equal(b.beta, a.beta, 'worker = off');
    assert.ok(Number.isFinite(bPage) && bPage >= 0 && bPage <= 1);
    // (wyjście: β wyjścia stałe do końca frontu + zanurzenia, potem 0 — ciała gasną frontem per ciało w soczewce, więc
    //  skok globalnego β na końcu nie jest widoczny; kontrola ciągłości — ładowanie, kop, przerwanie)
    if (!(s.exitAge >= 0) || !(prevExit >= 0)) maxStep = Math.max(maxStep, Math.abs(bPage - prevB));
    prevExit = s.exitAge;
    prevB = bPage;
    if (warp.state === 'charging') maxCharge = Math.max(maxCharge, bPage);
    if (s.abortAge >= 0 && s.abortBeta > 0) sawAbort = true;
    if (s.exitAge >= 0 && s.exitBeta < 1 - 1e-6 && s.exitBeta > WARP_LENS_PHASE.chargeBeta) sawExitKick = true;
    if (s.exitAge >= 0 && !warp.exitRamp && !warp.gravityBrake.active && s.exitHalt > 0) exitAfterRamp++;
    if (warp.gravityBrake.active && s.exitAge >= 0 && s.arriving === true) sawAbrupt = true;
    frames++;
  }
  assert.ok(frames > 700, String(frames));
  assert.ok(Math.abs(maxCharge - WARP_LENS_PHASE.chargeBeta) < 1e-9, `ładowanie podnosi świat do 0,9 (${maxCharge})`);
  assert.ok(sawAbort, 'przerwane ładowanie: abortAge / abortBeta w migawce');
  assert.ok(sawExitKick, 'wyjście w trakcie kopu: β wyjścia < 1 w migawce');
  assert.ok(exitAfterRamp > 30, 'wiek wyjścia ciągły po zdjęciu rampy (trzymanie celu przy przylocie)');
  assert.ok(sawAbrupt, 'hamowanie grawitacyjne: wyjście bez rampy z wiekiem i dolotem');
  assert.ok(maxStep < 0.1, `β bez skoków w ładowaniu, kopie i przerwaniu (największy krok ${maxStep.toFixed(3)})`);
  assert.ok(WARP_LENS_EXIT_SPAN >= 13, 'wiek wyjścia dłuższy niż ślizg + trzymanie celu');
});

test('oś β w grze: index.html krokuje stepWarpLensPhase raz na klatkę (zegar gry) przed migawką i klatką „Nurtu”, worker czyta rekord z lustra', () => {
  const html = read('index.html');
  assert.match(html, /stepWarpLensPhase\(_warpLensTrack, s, warp, SimClock\.render, hyperOn\);/);
  assert.match(html, /stepPlayerWarpLensPhase\(\);(?:\s*\/\/[^\n]*\n)*\s*if \(renderSnapshot && !SZEW_LATE\) packRenderSnapshotBegin/);
  assert.match(html, /f\.warpLens = _warpLensPhase;/);
  assert.match(html, /o\.lensPhase = _warpLensPhase;/);
  assert.match(read('src/render/render.worker.js'), /wf\.lensPhase = st\.warpMir\.hasLens \? st\.warpMir\.lens : null;/);
  const nurt = read('src/3d/warp/warpNurt.js');
  assert.match(nurt, /g\.lens = o\.lensPhase \|\| null;/);
  assert.match(nurt, /const beta = ph \? warpLensBeta\(ph\) : 0;/);
});
