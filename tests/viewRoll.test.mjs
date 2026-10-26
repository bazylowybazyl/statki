// Obrót kadru kamery z góry (cam.roll — src/3d/viewRoll.js; 2026-10-19, user: „obracajmy kamerę na czas warpu
// w kierunku lotu”, demo „Pęd”): konwencja świat ↔ ekran, źródła zniekształceń, soczewka świata (te same piksele
// przy obróconym świecie i kadrze), kadr efektów, obrót kadru w skoku w rigu kamery.
// node --test tests/viewRoll.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameraRoll, rollToScreen, rollToWorld, rolledHalfExtents } from '../src/3d/viewRoll.js';
import { DistortionField, DISTORT_HEADER, DISTORT_STRIDE } from '../src/3d/fx/distortion.js';
import { WarpWorldLens, newLensBody } from '../src/3d/warp/worldLens.js';
import {
  createCameraRig, createCameraRigTune, stepCameraRigRoll, CAMERA_WARP_ROLL_MODES
} from '../src/game/cameraRig.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('konwencja: ekran = R(−roll)·świat, świat = R(roll)·ekran; kurs θ w górę ekranu przy roll = θ + π/2', () => {
  assert.equal(cameraRoll(null), 0);
  assert.equal(cameraRoll({ roll: NaN }), 0);
  assert.equal(cameraRoll({ roll: 0.7 }), 0.7);
  const s = rollToScreen(1000, 0, Math.PI / 2, {});
  assert.ok(near(s.x, 0, 1e-9) && near(s.y, -1000, 1e-9), 'kurs w prawo (θ = 0) przy roll π/2 — w górę ekranu');
  for (const roll of [0, 0.3, -1.1, 2.9]) {
    const a = rollToScreen(123, -456, roll, {});
    const b = rollToWorld(a.x, a.y, roll, {});
    assert.ok(near(b.x, 123, 1e-9) && near(b.y, -456, 1e-9), `odwrotność przy ${roll}`);
    const theta = 0.8;
    const d = rollToScreen(Math.cos(theta), Math.sin(theta), theta + Math.PI / 2, {});
    assert.ok(near(d.x, 0, 1e-12) && near(d.y, -1, 1e-12), 'kurs w górę');
  }
  const z = rollToScreen(5, 7, 0, {});
  assert.equal(z.x, 5);
  assert.equal(z.y, 7);
  const e0 = rolledHalfExtents(800, 450, 0, {});
  assert.equal(e0.hw, 800);
  assert.equal(e0.hh, 450);
  const e90 = rolledHalfExtents(800, 450, Math.PI / 2, {});
  assert.ok(near(e90.hw, 450, 1e-9) && near(e90.hh, 800, 1e-9), '90° zamienia boki');
  const e45 = rolledHalfExtents(800, 450, Math.PI / 4, {});
  assert.ok(near(e45.hw, (800 + 450) / Math.SQRT2, 1e-9) && near(e45.hh, (800 + 450) / Math.SQRT2, 1e-9));
});

test('źródła zniekształceń: punkt przed dziobem trafia na górę ekranu, kierunek soczewki obraca się z kadrem', () => {
  const F = new DistortionField();
  F.begin();
  F.shock(1000, 0, 100, 20, 10);
  F.bubble(0, 300, 50, 20, 30, 1, 0, 1.4);
  F.commit(0, 0, 0.5, 2000, 2000, 0, 1, Math.PI / 2);
  const A = F.array;
  const b0 = DISTORT_HEADER;
  assert.ok(near(A[b0].x, 0, 1e-9) && near(A[b0].y, 500, 1e-9), 'fala: 1000 j. w prawo świata → 500 px w górę (oś sceny y w górę)');
  const b1 = DISTORT_HEADER + DISTORT_STRIDE;
  assert.ok(near(A[b1].x, 150, 1e-9) && near(A[b1].y, 0, 1e-9), 'soczewka: 300 j. w dół świata → 150 px w prawo');
  assert.ok(near(A[b1 + 2].x, 0, 1e-9) && near(A[b1 + 2].y, 1, 1e-9), 'kurs w prawo świata → w górę ekranu');
  // Bez obrotu — jak dawniej.
  F.begin();
  F.shock(1000, 0, 100, 20, 10);
  F.commit(0, 0, 0.5, 2000, 2000, 0, 1, 0);
  assert.equal(A[b0].x, 500);
  assert.ok(near(A[b0].y, 0, 0), 'y = ±0 jak dawniej');
});

// Soczewka świata: obrócenie całego układu wokół kamery o φ i kadru o ten sam kąt daje te same piksele.
function lensRun(phi) {
  const lens = new WarpWorldLens();
  const cam = { x: 6_500_000, y: 5_300_000 };
  const rot = (x, y) => {
    const dx = x - cam.x;
    const dy = y - cam.y;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    return { x: cam.x + c * dx - s * dy, y: cam.y + s * dx + c * dy };
  };
  const zoom = 0.1;
  const theta = 0.35;
  const ship = rot(cam.x + 1200, cam.y - 700);
  const mk = (id, ox, oy, r) => {
    const b = newLensBody(id);
    const p = rot(cam.x + 1200 + ox, cam.y - 700 + oy);
    b.x = p.x; b.y = p.y; b.r = r; b.flat = zoom; b.gate = 1; b.ready = true;
    return b;
  };
  const target = mk('cel', Math.cos(theta) * 900000, Math.sin(theta) * 900000, 48000);
  const flyby = mk('mars', Math.cos(theta) * 300000 - Math.sin(theta) * 75000, Math.sin(theta) * 300000 + Math.cos(theta) * 75000, 30000);
  const side = mk('bok', -Math.sin(theta) * 40000, Math.cos(theta) * 40000, 9000);
  const bodies = [target, flyby, side];
  const sx = 1200 * zoom;
  const sy = -700 * zoom;
  const ctx = {
    beta: 1, speed: 220000, velAngle: theta + phi, zoom, W: 1600, H: 900, focal: 1400, camZ: 14000,
    camX: cam.x, camY: cam.y, roll: phi, shipX: ship.x, shipY: ship.y, shipSx: sx, shipSy: sy,
    hullHalfLen: 90, hullHalfWid: 30, dt: 0, target
  };
  lens.update(bodies, bodies.length, ctx, target);
  return bodies.map((b) => ({ x: b.out.x, y: b.out.y, size: b.out.size, beta: b.out.beta, angle: b.out.angle }));
}

test('soczewka świata z obrotem kadru: obrócony świat + obrócony kadr = te same piksele (cel przy krawędzi, przelot, wejście)', () => {
  const base = lensRun(0);
  assert.ok(base[0].beta > 0.99 && base[0].size > 1, 'cel w soczewce');
  for (const phi of [Math.PI / 2, 1.1, -2.4]) {
    const r = lensRun(phi);
    for (let i = 0; i < base.length; i++) {
      assert.ok(near(r[i].x, base[i].x, 1e-6) && near(r[i].y, base[i].y, 1e-6), `ciało ${i} przy φ = ${phi}: ${r[i].x}, ${r[i].y} vs ${base[i].x}, ${base[i].y}`);
      assert.ok(near(r[i].size, base[i].size, 1e-6) && near(r[i].beta, base[i].beta, 1e-12));
      assert.ok(near(r[i].angle, base[i].angle, 1e-9), 'kąt obrotu przelotu ten sam (oś — w osiach świata)');
    }
  }
});

test('obrót kadru w skoku (stepCameraRigRoll): kurs w górę od ładowania, powrót do północy po zatrzymaniu', () => {
  const tune = createCameraRigTune();
  assert.deepEqual([...CAMERA_WARP_ROLL_MODES], ['up', 'right', 'off']);
  const run = (mode, dirX, dirY, seconds, dt = 1 / 60, rig = createCameraRig(), state = 'active') => {
    const inp = { dt, state, dirX, dirY, exitAge: -1, exitHalt: 1.35, enabled: true, mode };
    for (let t = 0; t < seconds - 1e-9; t += dt) stepCameraRigRoll(rig, inp, tune);
    return rig;
  };
  // Kurs w prawo (θ = 0): 'up' — roll π/2, 'right' — 0, 'off' — 0.
  assert.ok(near(run('up', 1, 0, 4).roll, Math.PI / 2, 1e-3));
  assert.equal(run('right', 1, 0, 4).roll, 0);
  assert.equal(run('off', 1, 0, 4).roll, 0);
  assert.ok(near(run('right', 0, 1, 4).roll, Math.PI / 2, 1e-3), 'kurs w dół, „w prawo” — roll π/2');
  // Ładowanie też obraca (0,8 s gry — większość drogi), bez skoku na starcie.
  const ch = run('up', 1, 0, 0.8, 1 / 60, createCameraRig(), 'charging');
  assert.ok(ch.roll > Math.PI / 2 * 0.6 && ch.roll < Math.PI / 2);
  const first = run('up', 1, 0, 1 / 60, 1 / 60, createCameraRig(), 'charging');
  assert.ok(first.roll < 0.01, 'pierwsza klatka — prawie nic');
  // Niezależny od FPS (sprężyna dokładna w kroku).
  assert.ok(near(run('up', 1, 0, 0.5, 1 / 30).roll, run('up', 1, 0, 0.5, 1 / 240).roll, 1e-9));
  // Wyjście: trzyma do zatrzymania + warpRollHold, potem wraca do dokładnego zera.
  const rig = run('up', 1, 0, 4);
  const inp = { dt: 1 / 60, state: 'idle', dirX: 1, dirY: 0, exitAge: 0, exitHalt: 1.35, enabled: true, mode: 'up' };
  for (let t = 0; t < 1.35 + tune.warpRollHold - 0.02; t += inp.dt) { inp.exitAge = t; stepCameraRigRoll(rig, inp, tune); }
  assert.ok(near(rig.roll, Math.PI / 2, 1e-3), 'do zatrzymania + chwila — kurs dalej w górę');
  for (let t = 0; t < 5; t += inp.dt) { inp.exitAge = -1; stepCameraRigRoll(rig, inp, tune); }
  assert.equal(rig.roll, 0);
  assert.equal(rig.rollVel, 0);
  // Najkrótsza droga: z 3,0 rad do celu −3,0 rad przez π (rośnie), nie przez 0.
  const r2 = createCameraRig();
  r2.roll = 3.0;
  const c = -3.0 - Math.PI / 2;
  stepCameraRigRoll(r2, { dt: 1 / 60, state: 'active', dirX: Math.cos(c), dirY: Math.sin(c), exitAge: -1, enabled: true, mode: 'up' }, tune);
  assert.ok(r2.roll > 3.0 || r2.roll < -3.0, `obrót przez π: ${r2.roll}`);
  // Wyłączona kamera statku (enabled: false) — wraca do zera.
  const r3 = run('up', 1, 0, 4);
  run('up', 1, 0, 5, 1 / 60, r3, 'active');
  const off = { dt: 1 / 60, state: 'active', dirX: 1, dirY: 0, exitAge: -1, enabled: false, mode: 'up' };
  for (let t = 0; t < 5; t += off.dt) stepCameraRigRoll(r3, off, tune);
  assert.equal(r3.roll, 0);
});

test('wpięcie: Core3D obraca kamery, maska słońca, gorące powietrze, ośrodek i soczewki warpa liczą z cam.roll', () => {
  const core = read('src/3d/core3d.js');
  assert.match(core, /this\.cameraOrtho\.rotation\.z = -roll;/);
  assert.match(core, /this\.cameraPersp\.up\.set\(Math\.sin\(roll\), Math\.cos\(roll\), 0\);/);
  assert.match(core, /uShafts\.uViewRot\.value\.set\(Math\.cos\(roll1\), -Math\.sin\(roll1\)\);/);
  assert.match(core, /const roll = cameraRoll\(camData\);/);
  const fx = read('src/3d/fx/fxFrame.js');
  assert.match(fx, /cameraRoll\(cam\)\);/);
  assert.match(fx, /rolledHalfExtents\(/);
  const nurt = read('src/3d/warp/warpNurt.js');
  assert.match(nurt, /this\._roll = cameraRoll\(cam\);/);
  assert.match(nurt, /L\.roll = roll;/);
  assert.match(nurt, /cullWarpFrameToView\(frame, vh\.hw, vh\.hh/);
  const planets = read('src/3d/planet3d.assets.js');
  assert.equal((planets.match(/lensImageToWorld\(L, o\.x, o\.y, [^;]+, _lensWorld\)/g) || []).length, 4, 'cztery rozstawienia ciał soczewki (planety, księżyce, małe ciała, słońce — DECYZJE M5)');
  // obrót kadru w rozstawieniu (worldLens.js: lensImageToWorld — świat = kamera + R(roll)·(o · k))
  const lensSrc = read('src/3d/warp/worldLens.js');
  assert.match(lensSrc, /export function lensImageToWorld\(L, ox, oy, z, plane, out\) \{[\s\S]*?const roll = Number\(L\.roll\) \|\| 0;/);
  assert.doesNotMatch(planets, /L\.camX \+ o\.x \* k/);
});
