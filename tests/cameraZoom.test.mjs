import test from 'node:test';
import assert from 'node:assert/strict';

import { CAMERA_ZOOM_SMOOTH, stepCameraZoom, cameraZoomBase, wheelDeltaPx } from '../src/game/cameraZoom.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

// Ząbek kółka przy deltaY = 100 i camera.wheelSpeed = 0,002.
const NOTCH = Math.exp(0.2);

function makeCam(zoom = 1, targetZoom = zoom) {
  return { zoom, targetZoom, minZoom: 0.035, maxZoom: 3.2, zoomVel: 0 };
}

function run(cam, dts) {
  for (const dt of dts) stepCameraZoom(cam, dt);
  return cam;
}

const steps = (dt, n) => Array.from({ length: n }, () => dt);

test('ząbek z miejsca: miękki start, bez przestrzału, staje dokładnie na celu', () => {
  const cam = makeCam(1, NOTCH);
  const dt = 1 / 144;
  let prev = cam.zoom;
  let firstStep = null;
  let settledAt = null;
  for (let i = 1; i <= 288; i++) {
    const moving = stepCameraZoom(cam, dt);
    assert.ok(cam.zoom >= prev, 'zoom monotoniczny');
    assert.ok(cam.zoom <= NOTCH, 'bez przestrzału');
    if (firstStep === null) firstStep = Math.log(cam.zoom);
    prev = cam.zoom;
    if (!moving) { settledAt = i * dt; break; }
  }
  // Pierwsza klatka to ułamek drogi (lerp 1. rzędu dawał od razu pełną prędkość).
  assert.ok(firstStep / 0.2 < 0.01, `pierwsza klatka: ${(firstStep / 0.2 * 100).toFixed(2)}% drogi`);
  assert.ok(settledAt !== null && settledAt < 1.2, `ustalenie po ${settledAt} s`);
  assert.equal(cam.zoom, NOTCH);
  assert.equal(cam.zoomVel, 0);
});

test('przebieg nie zależy od FPS ani od nierównych klatek', () => {
  const at60 = run(makeCam(1, 2.5), steps(1 / 60, 30));
  const at120 = run(makeCam(1, 2.5), steps(1 / 120, 60));
  const at144 = run(makeCam(1, 2.5), steps(1 / 144, 72));
  const uneven = [0.033, 0.004, 0.021, 0.0069, 0.012, 0.033, 0.0011, 0.017];
  const used = uneven.reduce((a, b) => a + b, 0);
  const atUneven = run(makeCam(1, 2.5), [...uneven, 0.5 - used]);
  for (const cam of [at120, at144, atUneven]) {
    assert.ok(Math.abs(cam.zoom - at60.zoom) < 1e-9, `${cam.zoom} vs ${at60.zoom}`);
    assert.ok(Math.abs(cam.zoomVel - at60.zoomVel) < 1e-9);
  }
  assert.ok(at60.zoom > 1 && at60.zoom < 2.5, 'po 0,5 s jeszcze w drodze do dalekiego celu');
});

test('przybliżanie i oddalanie mają to samo tempo (log zoomu)', () => {
  const zoomIn = run(makeCam(1, 2), steps(1 / 144, 20));
  const zoomOut = run(makeCam(1, 0.5), steps(1 / 144, 20));
  assert.ok(Math.abs(Math.log(zoomIn.zoom) + Math.log(zoomOut.zoom)) < 1e-12);
});

test('seria ząbków to jeden ciągły ruch — bez szarpnięcia przy każdym ząbku', () => {
  const cam = makeCam(1, 1);
  const dt = 1 / 144;
  const notchEvery = 7; // ~49 ms między ząbkami
  let prevLog = 0;
  let prevStep = 0;
  let worstJump = 0;
  for (let frame = 0; frame < 144; frame++) {
    const notchNow = frame < 5 * notchEvery && frame % notchEvery === 0;
    if (notchNow) cam.targetZoom *= NOTCH;
    stepCameraZoom(cam, dt);
    const logZ = Math.log(cam.zoom);
    const step = logZ - prevLog;
    if (notchNow && frame > 0) worstJump = Math.max(worstJump, step / prevStep);
    prevLog = logZ;
    prevStep = step;
  }
  // Dawny lerp 1. rzędu (4/s) przy tych samych ząbkach: ×2,4 na ząbku, a krokowany
  // w fizyce 120 Hz dokładał 14 klatek bez ruchu przy 144 Hz (26 przy 165 Hz).
  assert.ok(worstJump < 1.3, `skok kroku na ząbku: ×${worstJump.toFixed(2)}`);
  assert.ok(Math.abs(Math.log(cam.targetZoom) - 1) < 1e-12);
  assert.ok(Math.abs(Math.log(cam.zoom) - 1) < 1e-3, 'po serii dojeżdża do celu');
});

test('zoom zapisany z zewnątrz rusza sprężynę od spoczynku', () => {
  const cam = makeCam(1, 3);
  run(cam, steps(1 / 144, 20));
  assert.ok(cam.zoomVel > 1, 'rozpędzona');
  cam.zoom = 2; // koniec przejścia kamery, teleport, dev
  const before = cam.zoom;
  stepCameraZoom(cam, 1 / 144);
  const firstStep = Math.log(cam.zoom / before);
  assert.ok(firstStep > 0 && firstStep < 0.002, `pierwszy krok po zapisie: ${firstStep}`);
});

test('cel poza zakresem kończy się na granicy zoomu', () => {
  const far = run(makeCam(1, 99), steps(1 / 60, 120));
  assert.equal(far.zoom, 3.2);
  const near = run(makeCam(1, 0.001), steps(1 / 60, 240));
  assert.equal(near.zoom, 0.035);
  assert.equal(near.zoomVel, 0);
});

test('człon przejściowy (kop warpa): zoom = zoomBase · e^człon, sprężyna i cel gracza go nie widzą', () => {
  // Spoczynek: człon działa od razu (bez sprężyny), zdjęty — dokładnie zoom gracza.
  const cam = makeCam(0.5, 0.5);
  cam.zoomImpulseLog = Math.log(0.55);
  stepCameraZoom(cam, 1 / 144);
  assert.ok(Math.abs(cam.zoom - 0.275) < 1e-12);
  assert.equal(cam.zoomBase, 0.5);
  assert.equal(cam.targetZoom, 0.5);
  assert.equal(cameraZoomBase(cam), 0.5);
  cam.zoomImpulseLog = 0;
  assert.equal(stepCameraZoom(cam, 1 / 144), false, 'bez członu i w spoczynku — stoi');
  assert.equal(cam.zoom, 0.5);

  // Ząbek kółka w trakcie członu: sprężyna (zoom gracza) biegnie tak samo jak bez niego.
  const plain = makeCam(1, NOTCH);
  const kicked = makeCam(1, NOTCH);
  for (let i = 0; i < 144; i++) {
    kicked.zoomImpulseLog = -0.3 * Math.sin(i / 20);
    stepCameraZoom(plain, 1 / 144);
    stepCameraZoom(kicked, 1 / 144);
    assert.ok(Math.abs(kicked.zoomBase - plain.zoom) < 1e-12, `klatka ${i}`);
    assert.ok(Math.abs(Math.log(kicked.zoom / kicked.zoomBase) - kicked.zoomImpulseLog) < 1e-12);
  }

  // Zapis z zewnątrz (teleport, harness, dev) w trakcie członu = nowy zoom gracza.
  const ext = makeCam(0.5, 0.5);
  ext.zoomImpulseLog = Math.log(0.55);
  stepCameraZoom(ext, 1 / 144);
  ext.zoom = ext.targetZoom = 0.1;
  assert.equal(cameraZoomBase(ext), 0.1);
  stepCameraZoom(ext, 1 / 144);
  assert.equal(ext.zoomBase, 0.1);
  assert.ok(Math.abs(ext.zoom - 0.055) < 1e-12);

  // Zakres: zoom na ekranie przycięty, zoom gracza nie.
  const edge = makeCam(0.035, 0.035);
  edge.zoomImpulseLog = Math.log(0.55);
  stepCameraZoom(edge, 1 / 144);
  assert.equal(edge.zoom, 0.035);
  assert.equal(edge.zoomBase, 0.035);
  // Śmieci w członie nie psują zoomu.
  const bad = makeCam(0.5, 0.5);
  bad.zoomImpulseLog = NaN;
  stepCameraZoom(bad, 1 / 144);
  assert.equal(bad.zoom, 0.5);
});

test('delta kółka: linie (Firefox) i strony liczone jak piksele', () => {
  assert.equal(wheelDeltaPx(100, 0), 100);
  assert.ok(Math.abs(wheelDeltaPx(3, 1) - 100) < 1e-9);
  assert.equal(wheelDeltaPx(-1, 2, 900), -900);
  assert.equal(wheelDeltaPx(undefined, 0), 0);
  assert.ok(CAMERA_ZOOM_SMOOTH.omega > 0);
});

// --- index.html ---

const indexHtml = readIndexHtml();

function loadUpdateCameraZoom(scope) {
  return loadIndexFunction(indexHtml, 'function updateCameraZoom(dt) {', 'updateCameraZoom', scope);
}

test('RTS: punkt świata pod kursorem stoi przez całą animację (też w interpolacji)', () => {
  const camera = {
    ...makeCam(1, NOTCH * NOTCH),
    mode: 'rts',
    x: 1000,
    y: 500,
    targetX: 1000,
    targetY: 500,
    transition: null,
    zoomAnchor: { active: true, dx: 300, dy: -200 },
  };
  // Pan w toku: poprzedni krok fizyki był 10 j. wcześniej.
  const prevCameraState = { x: 990, y: 504 };
  const updateCameraZoom = loadUpdateCameraZoom({ camera, prevCameraState, stepCameraZoom });
  const renderedAnchor = (alpha) => ({
    x: prevCameraState.x + (camera.x - prevCameraState.x) * alpha + camera.zoomAnchor.dx / camera.zoom,
    y: prevCameraState.y + (camera.y - prevCameraState.y) * alpha + camera.zoomAnchor.dy / camera.zoom,
  });
  const start = [0, 0.37, 1].map(renderedAnchor);
  let frames = 0;
  while (camera.zoomAnchor.active && frames < 600) {
    updateCameraZoom(1 / 144);
    frames++;
    [0, 0.37, 1].forEach((alpha, i) => {
      const p = renderedAnchor(alpha);
      assert.ok(Math.abs(p.x - start[i].x) < 1e-9 && Math.abs(p.y - start[i].y) < 1e-9,
        `klatka ${frames}, alpha ${alpha}: (${p.x}, ${p.y})`);
    });
  }
  assert.equal(camera.zoom, NOTCH * NOTCH);
  assert.equal(camera.zoomAnchor.active, false, 'kotwica gaśnie po dojechaniu');
  assert.equal(camera.targetX, camera.x);
});

test('przejście kamery prowadzi zoom samo — sprężyna stoi i gubi prędkość', () => {
  const camera = {
    ...makeCam(1.5, 0.4),
    mode: 'ship',
    x: 0,
    y: 0,
    transition: { kind: 'focus' },
    zoomVel: 2,
    zoomAnchor: { active: true, dx: 0, dy: 0 },
  };
  const updateCameraZoom = loadUpdateCameraZoom({ camera, prevCameraState: { x: 0, y: 0 }, stepCameraZoom });
  updateCameraZoom(1 / 60);
  assert.equal(camera.zoom, 1.5);
  assert.equal(camera.zoomVel, 0);
  assert.equal(camera.zoomAnchor.active, false);
});

test('zoom liczony raz na klatkę renderu, nie w krokach fizyki', () => {
  const cameraTarget = sliceFunction(indexHtml, 'function updateCameraTarget(dt) {');
  assert.doesNotMatch(cameraTarget, /camera\.zoom \+=/);
  const loop = sliceFunction(indexHtml, 'function loop(now) {');
  const paused = loop.match(/if \(PAUSED(?: \|\| StoryGame\.worldFrozen)?\) \{[\s\S]*?render\(0, frame\);/)?.[0] || '';
  assert.match(paused, /updateCameraZoom\(frame\);/);
  assert.match(loop, /updateCameraZoom\(frame\);[\s\S]*?render\(alpha, frame\);/);
  const wheel = indexHtml.match(/canvas\.addEventListener\('wheel', e => \{[\s\S]*?\}, \{ passive: false \}\);/)?.[0] || '';
  assert.ok(wheel.length > 0);
  assert.doesNotMatch(wheel, /camera\.zoom =/);
});
