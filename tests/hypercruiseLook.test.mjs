// Wygląd HIPERCRUISE'U po zgłoszeniu użytkownika z 2026-10-23 („kamera jak w warp — odpalenie hipercruise =
// przestawienie kamery za statkiem. usunięcie efektu cząsteczkowego, poprawienie dyszy — brak ognia, hipercruise
// odpalony = ogień … poruszanie się silników na boki … żeby się nie wyginało tak mocno”):
//   • plazma WARP „nie ma / jest” (warpPlume3D.js: preheat → zapłon z pchnięciem → dogasanie; warp bez zmian),
//   • hipercruise bez ośrodka „Nurtu” (player.js: hyperMediumOn — bańka i iskry hamowania to przegródki ośrodka),
//   • obrót kadru kursem w górę (index.html: updateCameraHyperRoll → cameraRig.roll; rzuty HUD-u z obrotem),
//   • mniejsze wychylenie dysz MAIN w locie (HYPERCRUISE_TUNE.nozzleGimbal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { WarpPlumeFX, WARP_PLUME_HYPER } from '../src/3d/warpPlume3D.js';
import { WarpPlayerFx, hyperMediumOn } from '../src/3d/warp/player.js';
import { WarpFrame, newWarpSlot } from '../src/3d/warp/frame.js';
import { createCameraRig, cameraRigTune, stepCameraRigRoll, normalizeCameraHyperRollMode } from '../src/game/cameraRig.js';
import { cameraRoll, rollToScreen, rollToWorld, rolledHalfExtents } from '../src/render/viewRoll.js';
import * as viewRoll3d from '../src/3d/viewRoll.js';
import { HYPERCRUISE_TUNE } from '../src/data/driveModes.js';
import { writeDustUniforms, SPACE_DUST_TUNE } from '../src/3d/dust/spaceDust.js';
import { readIndexHtml, loadIndexFunction } from './helpers/indexSource.mjs';

const DT = 1 / 60;
const html = readIndexHtml();

function run(fx, seconds, dt = DT, each = null) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    fx.update(dt, null, 1080, true);
    if (each) each(fx);
  }
}

// ── dysze: plazma „nie ma / jest” ─────────────────────────────────────────────────────────────────────

test('rozruch (preheat): bez płomienia — żar wylotu rośnie i drży, strumień niewidoczny', () => {
  const fx = new WarpPlumeFX();
  fx.setPose(0, 0, -5, 1, 0, 30);
  fx.preheat();
  assert.equal(fx.state, 'preheat');
  const hot = [];
  run(fx, 3, DT, (f) => {
    assert.equal(f.plume.visible, false, 'strumień plazmy nie świeci w rozruchu');
    assert.ok(f.ch.power < 1e-6 && f.ch.bright < 1e-6, 'kanały płomienia zgaszone');
    hot.push(f.glowHot.material.uniforms.uIntensity.value);
  });
  assert.ok(fx.ch.heat > 0.9, `żar po 3 s ${fx.ch.heat}`);
  assert.ok(fx.glowHot.visible, 'żar widać w poświacie wylotu');
  assert.ok(hot[20] < hot[hot.length - 1], 'żar narasta z czasem rozruchu');
  const tail = hot.slice(-60);
  assert.ok(Math.max(...tail) - Math.min(...tail) > 0.05, 'wylot drży');
  assert.equal(fx.finished, false, 'rozgrzana dysza nie wraca do puli');
});

test('zapłon z rozgrzania: błysk od razu, pchnięcie płomienia (dłuższy niż w pracy), potem praca z dopalaczem', () => {
  const fx = new WarpPlumeFX();
  fx.setPose(0, 0, -5, 1, 0, 30);
  fx.preheat();
  run(fx, 2);
  fx.ignite();
  fx.setBoost(true);
  fx.update(DT, null, 1080, true);
  assert.ok(fx.ch.ignite >= WARP_PLUME_HYPER.flash * 0.95, `błysk w pierwszej klatce zapłonu (${fx.ch.ignite})`);
  let maxLen = 0;
  let maxKick = 0;
  run(fx, 1.2, DT, (f) => {
    maxLen = Math.max(maxLen, f.plumeMat.uniforms.uLen.value);
    maxKick = Math.max(maxKick, f.ch.kick);
  });
  assert.ok(maxKick > 0.95 && maxKick <= 1 + 1e-9, `impuls pchnięcia znormalizowany do 1 (${maxKick})`);
  run(fx, 3);
  assert.equal(fx.state, 'running');
  assert.equal(fx.ch.kick, 0, 'pchnięcie wygasa');
  const steady = fx.plumeMat.uniforms.uLen.value;
  assert.ok(maxLen > steady * 1.08, `pchnięcie wydłuża płomień ponad pracę (${maxLen} vs ${steady})`);
});

test('zapłon bez rozgrzania (warp) bez zmian: faza żarzenia, zwykły błysk, bez pchnięcia', () => {
  const fx = new WarpPlumeFX();
  fx.ignite();
  fx.update(DT, null, 1080, true);
  assert.ok(fx.ch.ignite < 0.05, 'pierwsze 0,24 s — żarzenie, bez błysku');
  let maxIgn = 0;
  run(fx, 1.2, DT, (f) => {
    maxIgn = Math.max(maxIgn, f.ch.ignite);
    assert.equal(f.ch.kick, 0);
    assert.equal(f.ch.heat, 0);
  });
  assert.ok(maxIgn > 0.9 && maxIgn <= 1 + 1e-9, 'zwykły błysk zapłonu');
});

test('wyjście (fade): płomień dogasa i krztusi się, potem gaszenie z poświatą i powrót do puli', () => {
  const fx = new WarpPlumeFX();
  fx.ignite();
  fx.setBoost(true);
  run(fx, 2);
  const lenRun = fx.plumeMat.uniforms.uLen.value;
  fx.fade();
  assert.equal(fx.state, 'fading');
  assert.equal(fx.boost, false, 'dogasanie bez dopalacza');
  run(fx, WARP_PLUME_HYPER.fade * 0.8);
  assert.equal(fx.state, 'fading');
  assert.ok(fx.plumeMat.uniforms.uLen.value < lenRun * 0.7, 'płomień krótszy w dogasaniu');
  run(fx, WARP_PLUME_HYPER.fade * 0.4);
  assert.equal(fx.state, 'shutdown');
  run(fx, 4);
  assert.equal(fx.finished, true);
  // przerwany rozruch: z rozgrzania od razu gaszenie (żar stygnie)
  const pre = new WarpPlumeFX();
  pre.preheat();
  run(pre, 1);
  pre.fade();
  assert.equal(pre.state, 'shutdown');
  run(pre, 4);
  assert.equal(pre.finished, true);
});

test('engineVfxSystem: hipercruise → preheat / active / drop (dogasanie), warp gracza i NPC jak dawniej', () => {
  const vfx = readFileSync(new URL('../src/3d/engineVfxSystem.js', import.meta.url), 'utf8');
  assert.match(vfx, /if \(hyper === 'active'\) return 'active';\s*if \(hyper === 'charging'\) return 'preheat';\s*if \(hyper === 'drop'\) return 'drop';/);
  // rozgrzewanie i dogasanie bez wolnej instancji — bez zapasowej strugi MAIN na dopalaczu („fallback” — tylko ogień)
  assert.match(vfx, /if \(mode === 'off' \|\| mode === 'drop'\) return 'none';/);
  assert.match(vfx, /if \(!plume\) return mode === 'preheat' \? 'none' : 'fallback';/);
  // gra: __hyperMode 'drop' w wyjściu (bit HYPER_DROP migawki — renderMirror.test.mjs)
  assert.match(html, /ship\.__hyperMode = next !== 'idle' \? next : \(hc\.state === 'drop' \? 'drop' : undefined\);/);
});

// ── ośrodek „Nurtu” w hipercruisie ─────────────────────────────────────────────────────────────────────

function playerRig() {
  const fx = new WarpPlayerFx();
  fx.bubble = newWarpSlot();
  fx.push = newWarpSlot();
  fx.onShake = () => {};
  const frame = new WarpFrame();
  const game = { state: 'idle', charge: 0, chargeTime: 4, gear: 1, speed: 0, angle: 0.3, x: 1000, y: 2000, length: 1800, width: 800, palette: 'magenta', vRelX: 0, vRelY: 0, exitRamp: null, hyper: true, cruise: 20000 };
  const map = { camX: 900, camY: 1900 };
  const med = { camMX: 0, camMY: 0, flow: 0, flowX: 0, flowY: 0 };
  const step = (t, dt) => {
    frame.reset();
    fx.advance(t, dt, game, map, med);
    fx.fill(t, game, frame, map, med);
  };
  return { fx, frame, game, step };
}

test('hipercruise bez ośrodka: bez przegródek i poświaty drobin; soczewka bańki, gwiazdy i fale zostają; warp z ośrodkiem', () => {
  assert.equal(hyperMediumOn(''), false);
  assert.equal(hyperMediumOn('?dev=1&hcOsrodek=1'), true);
  assert.equal(hyperMediumOn('?hcOsrodek=10'), false);
  assert.equal(hyperMediumOn(''), false);
  const r = playerRig();
  let t = 0;
  r.game.state = 'charging';
  for (let i = 1; i <= 120; i++) { t += DT; r.game.charge = Math.min(1, i / 120); r.step(t, DT); }
  assert.equal(r.frame.bubbles.length, 0, 'rozruch bez bańki w ośrodku');
  assert.equal(r.frame.lens.count, 1, 'soczewka bańki na tle zostaje');
  assert.ok(r.frame.stars.stretch > 0.3, 'gwiazdy się wydłużają');
  r.game.state = 'active';
  let waves = 0;
  for (let i = 0; i < 90; i++) { t += DT; r.step(t, DT); waves = Math.max(waves, r.frame.waves.count); }
  assert.equal(r.frame.bubbles.length, 0, 'lot bez bańki w ośrodku');
  assert.equal(r.frame.warpVis, 0, 'bez poświaty drobin');
  assert.ok(waves > 0, 'fala kopu zostaje');
  r.game.state = 'idle';
  for (let i = 0; i < 120; i++) { t += DT; r.step(t, DT); assert.equal(r.frame.bubbles.length, 0, 'wyjście bez iskier ośrodka'); }
  // warp (hyper: false) — bańka w ośrodku jak dawniej
  const w = playerRig();
  w.game.hyper = false;
  w.game.chargeTime = 0.8;
  w.game.state = 'charging';
  t = 0;
  for (let i = 1; i <= 48; i++) { t += DT; w.game.charge = i / 48; w.step(t, DT); }
  assert.equal(w.frame.bubbles.length, 1);
});

// ── obrót kadru ─────────────────────────────────────────────────────────────────────────────────────────

test('viewRoll w warstwie szwu: src/3d/viewRoll.js to re-eksport src/render/viewRoll.js', () => {
  assert.equal(viewRoll3d.cameraRoll, cameraRoll);
  assert.equal(viewRoll3d.rollToScreen, rollToScreen);
  assert.equal(viewRoll3d.rollToWorld, rollToWorld);
  assert.equal(viewRoll3d.rolledHalfExtents, rolledHalfExtents);
});

function hyperRollScope() {
  const rig = createCameraRig();
  const scope = {
    _cameraRollInput: { dt: 0, state: 'idle', dirX: 1, dirY: 0, exitAge: -1, exitHalt: 0, enabled: true, mode: 'up', hold: false },
    _hyperRollPrev: 'idle',
    _hyperRollAfter: -1,
    hypercruise: { state: 'idle' },
    warp: { state: 'idle', exitRamp: null },
    hyperLook: { state: 'idle' },
    ship: { angle: 0, destroyed: false },
    camera: { mode: 'ship', transition: null },
    splitScreenMode: false,
    View3D: { active: false },
    cameraRig: rig,
    cameraRigTune,
    stepCameraRigRoll,
    cameraHyperRollMode: () => scope.mode,
    mode: 'up',
    HYPER_ROLL_AFTER: Number(/const HYPER_ROLL_AFTER = ([\d.]+);/.exec(html)[1]),
    _hyperInsetW: 0
  };
  scope.cameraFrameRollAllowed = loadIndexFunction(html, 'function cameraFrameRollAllowed() {', 'cameraFrameRollAllowed', scope);
  scope.cameraFrameRoll = loadIndexFunction(html, 'function cameraFrameRoll() {', 'cameraFrameRoll', scope);
  const update = loadIndexFunction(html, 'function updateCameraHyperRoll(gameDt) {', 'updateCameraHyperRoll', scope);
  const inset = loadIndexFunction(html, 'function stepHyperInsetWeight(frameDt) {', 'stepHyperInsetWeight', scope);
  const set = (hc, look) => { scope.hypercruise.state = hc; scope.hyperLook.state = look; };
  return { rig, scope, update, inset, set };
}

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('kamera za statkiem: od rozruchu kurs w górę ekranu, trzyma przez hamowanie i chwilę po nim, potem północ', () => {
  const { rig, scope, update, set } = hyperRollScope();
  scope.ship.angle = 0.4;   // kurs: roll = kurs + π/2
  set('spool', 'charging');
  for (let i = 0; i < 240; i++) update(DT);
  assert.ok(Math.abs(wrapPi(rig.roll - (0.4 + Math.PI / 2))) < 0.02, `rozruch 4 s: kurs w górę (${rig.roll})`);
  set('active', 'active');
  scope.ship.angle = 0.9;   // A/D w locie — kadr idzie za dziobem
  for (let i = 0; i < 180; i++) update(DT);
  assert.ok(Math.abs(wrapPi(rig.roll - (0.9 + Math.PI / 2))) < 0.02, 'lot: kadr za dziobem');
  set('drop', 'idle');
  for (let i = 0; i < 120; i++) update(DT);
  assert.ok(Math.abs(wrapPi(rig.roll - (0.9 + Math.PI / 2))) < 0.02, 'hamowanie wyjścia: kurs trzymany');
  set('idle', 'idle');
  for (let i = 0; i < Math.round(cameraRigTune.warpRollHold / DT) - 3; i++) update(DT);
  assert.ok(Math.abs(wrapPi(rig.roll - (0.9 + Math.PI / 2))) < 0.05, 'chwilę po wyjściu (warpRollHold) dalej za statkiem');
  for (let i = 0; i < 300; i++) update(DT);
  assert.equal(rig.roll, 0, 'potem północ — dokładne zero');
  // pauza: dt = 0 — kąt stoi
  set('spool', 'charging');
  for (let i = 0; i < 30; i++) update(DT);
  const r0 = rig.roll;
  for (let i = 0; i < 30; i++) update(0);
  assert.equal(rig.roll, r0);
});

test('po hipercruisie zwykły lot ma insety riga i obrót jak przed (okno po wyjściu się kończy)', () => {
  const { rig, scope, update, inset, set } = hyperRollScope();
  scope.ship.angle = 0.4;
  const frame = (n, dt = DT) => { for (let i = 0; i < n; i++) { update(dt); inset(dt); } };
  assert.equal(inset(DT), 0, "przed hipercruise'em — waga 0");
  set('spool', 'charging'); frame(240);
  set('active', 'active'); frame(120);
  assert.ok(scope._hyperInsetW > 0.99, 'w hipercruisie cały kadłub nad HUD-em');
  set('drop', 'idle'); frame(60);
  set('idle', 'idle'); frame(30);
  assert.ok(scope._hyperRollAfter > 0, 'okno po wyjściu trwa');
  frame(Math.round((scope.HYPER_ROLL_AFTER + 4) / DT));
  assert.equal(scope._hyperRollAfter, -1, 'okno po wyjściu zamknięte');
  assert.equal(scope._hyperInsetW, 0, "waga insetów dokładnie 0 — zwykły lot jak przed hipercruise'em");
  assert.equal(rig.roll, 0, 'kadr północą');
  // render: insety = pasy HUD + półwymiar kadłuba × waga (0 → dawne pasy), wyliczenie tylko przy wadze > 0
  assert.match(html, /const hcInsetW = stepHyperInsetWeight\(frameDt\);\s*let hcHullV = 0;\s*if \(hcInsetW > 1e-3 && !scouting\) \{/);
  assert.match(html, /rigIn\.insetTop = _camDirInsets\.top \+ hcHullV;\s*rigIn\.insetBottom = _camDirInsets\.bottom \+ hcHullV;/);
  // obrót kamery tej klatki: 0 od razu w RTS / podzielonym ekranie / kamerze 3D (rig dogania zero w tle)
  set('spool', 'charging'); frame(240);
  assert.ok(Math.abs(scope.cameraFrameRoll()) > 0.1);
  scope.View3D.active = true;
  assert.equal(scope.cameraFrameRoll(), 0, 'kamera 3D — kadr bez obrotu od razu');
  scope.View3D.active = false; scope.camera.mode = 'rts';
  assert.equal(scope.cameraFrameRoll(), 0, 'RTS — bez obrotu od razu');
});

test('obrót tylko dla kamery statku z góry gracza 1, nie w warpie; opcja Północ i A/B z adresu', () => {
  const cases = [
    ['RTS', (s) => { s.camera.mode = 'rts'; }],
    ['podzielony ekran', (s) => { s.splitScreenMode = true; }],
    ['kamera 3D', (s) => { s.View3D.active = true; }],
    ['przejście fokusu', (s) => { s.camera.transition = { kind: 'focus' }; }],
    ['warp gracza', (s) => { s.warp.state = 'charging'; }],
    ['opcja Północ', (s) => { s.mode = 'off'; }]
  ];
  for (const [name, apply] of cases) {
    const { rig, scope, update, set } = hyperRollScope();
    scope.ship.angle = 1;
    apply(scope);
    set('spool', 'charging');
    for (let i = 0; i < 120; i++) update(DT);
    assert.equal(rig.roll, 0, name);
  }
  assert.equal(normalizeCameraHyperRollMode('off'), 'off');
  assert.equal(normalizeCameraHyperRollMode('right'), 'right');
  assert.equal(normalizeCameraHyperRollMode('xyz'), 'up');
  assert.match(html, /data-camera-hyper-roll="up"/);
  assert.match(html, /data-camera-hyper-roll="off"/);
  assert.match(html, /localStorage\.setItem\('sc_camera_hyper_roll', mode\)/);
  assert.match(html, /cameraHyperRoll: 'up'/);
  // kolejność w loop(): obrót przed kopem (kurs kopu w osiach ekranu)
  assert.match(html, /updateCameraHyperRoll\(frame\);\s*updateCameraWarpKick\(frame\);/);
  assert.match(html, /updateCameraHyperRoll\(0\);\s*updateCameraWarpKick\(0\);/);
});

test('HUD i mysz: worldToScreenInto / screenToWorld z obrotem — punkt przed dziobem na górze ekranu, mysz → ten sam świat', () => {
  const scope = {
    View3D: { active: false, project: () => null, near: 1, pointOnPlaneZ: () => null },
    Game3D: { rig: { dist: 0 } },
    camera: { zoom: 0.5 },
    _currentCam: null,
    W: 1600, H: 900, _wtsVpW: 0, _wtsVpH: 0, _wtsVpOffX: 0, _wtsVpOffY: 0,
    _vpScratch: { x: 0, y: 0, w: 0, h: 0 },
    cameraRoll
  };
  scope.getViewportForCamera = loadIndexFunction(html, 'function getViewportForCamera(cam) {', 'getViewportForCamera', scope);
  scope.isView3DCamera = loadIndexFunction(html, 'function isView3DCamera(cam) {', 'isView3DCamera', scope);
  const wts = loadIndexFunction(html, 'function worldToScreenInto(wx, wy, cam, out, wz = 0) {', 'worldToScreenInto', scope);
  const stw = loadIndexFunction(html, 'function screenToWorld(sx, sy, camRef = camera) {', 'screenToWorld', scope);
  scope.worldToScreenInto = wts;
  const angleFor = loadIndexFunction(html, 'function screenAngleFor(angle, cam) {', 'screenAngleFor', scope);
  const heading = 0.7;
  const cam = { x: 5_000_000, y: -3_000_000, zoom: 0.5, roll: heading + Math.PI / 2 };
  const out = { x: 0, y: 0 };
  // 1000 j. przed dziobem → nad środkiem ekranu (y mniejsze), w osi pionowej
  wts(cam.x + Math.cos(heading) * 1000, cam.y + Math.sin(heading) * 1000, cam, out);
  assert.ok(Math.abs(out.x - 800) < 1e-6 && Math.abs(out.y - (450 - 500)) < 1e-6, `przed dziobem: ${out.x}, ${out.y}`);
  // kąt kursu na ekranie: w górę (−π/2)
  assert.ok(Math.abs(wrapPi(angleFor(heading, cam) + Math.PI / 2)) < 1e-12);
  // odwrotność — mysz trafia w ten sam punkt świata (menu PPM, wybór celu, celowanie)
  for (const [sx, sy] of [[10, 20], [1590, 880], [800, 450], [333, 777]]) {
    const w = stw(sx, sy, cam);
    wts(w.x, w.y, cam, out);
    assert.ok(Math.abs(out.x - sx) < 1e-6 && Math.abs(out.y - sy) < 1e-6, `${sx},${sy} → ${out.x},${out.y}`);
  }
  // bez obrotu — liczby jak dawniej
  const flat = { x: 100, y: 200, zoom: 2 };
  wts(150, 175, flat, out);
  assert.equal(out.x, 50 * 2 + 800);
  assert.equal(out.y, -25 * 2 + 450);
  assert.deepEqual(stw(900, 400, flat), { x: 150, y: 175 });
  assert.equal(angleFor(1.25, flat), 1.25);
});

test('rig w render(): wejścia ze świata obrócone do osi ekranu, offset i wstrząs z powrotem do świata; roll w kamerach klatki', () => {
  assert.match(html, /const camRoll = cameraFrameRoll\(\);\s*camera\.roll = camRoll;/);
  assert.match(html, /const rigRoll = cameraFrameRoll\(\);/);
  assert.match(html, /const roll = cameraFrameRoll\(\);/);
  assert.match(html, /let camNoShake = \{ x: camBaseX, y: camBaseY, zoom: camBaseZoom, roll: camRoll \};/);
  assert.match(html, /let cam = \{ x: camBaseX, y: camBaseY, zoom: camBaseZoom, roll: camRoll \};/);
  assert.match(html, /const sw = rollToWorld\(_cameraShakePx\.x, _cameraShakePx\.y, camRoll, _rollTmp\);/);
  // pudło cullingu kadłubów i bramka efektów trafień z obróconego kadru
  assert.match(html, /rolledHalfExtents\(\(W \* 0\.5\) \/ zoomNow, \(H \* 0\.5\) \/ zoomNow, cameraRoll\(cam\), _cullRollHalf\)/);
});

test('pył kosmiczny: obrót kadru w uniformach (G4.yz) i kontener wzoru z obróconego kadru', () => {
  const n = 64 * 4;
  const u0 = new Float32Array(n * 4);
  const u1 = new Float32Array(n * 4);
  const view = { camX: 0, camY: 0, zoomPx: 0.3, halfW: 800, halfH: 450, velX: 0, velY: 0, gridX: 0, gridY: 0, time: 0, vis: 1, plumes: 0 };
  writeDustUniforms(SPACE_DUST_TUNE, view, u0);
  assert.equal(u0[17], 1);
  assert.equal(u0[18], 0);
  writeDustUniforms(SPACE_DUST_TUNE, { ...view, roll: Math.PI / 4 }, u1);
  assert.ok(Math.abs(u1[17] - Math.SQRT1_2) < 1e-6 && Math.abs(u1[18] - Math.SQRT1_2) < 1e-6);
});

test('dysze MAIN w locie hipercruise\'u: wychylenie × nozzleGimbal tylko w obrazie (fizyka bez zmian)', () => {
  assert.ok(HYPERCRUISE_TUNE.nozzleGimbal > 0 && HYPERCRUISE_TUNE.nozzleGimbal < 0.5);
  const vfx = readFileSync(new URL('../src/3d/engineVfxSystem.js', import.meta.url), 'utf8');
  assert.match(vfx, /const hyperGimbalK = \(entity\.__hyperMode === 'active' \|\| entity\.__hyperMode === 'drop'\) \? HYPERCRUISE_TUNE\.nozzleGimbal : 1;/);
  assert.match(vfx, /resolveSlotForward\(slot, slot\.kind === 'side' \? 1 : hyperGimbalK\)/);
  // rozkaz dysz gry (moment, mainTorqueAssist w fizyce) — bez skali hipercruise'u
  assert.doesNotMatch(html, /HYPERCRUISE_TUNE\.nozzleGimbal/);
});
