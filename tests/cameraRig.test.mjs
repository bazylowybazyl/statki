import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAMERA_RIG_DEFAULTS,
  CAMERA_RIG_RANGES,
  createCameraRig,
  createCameraRigTune,
  stepCameraRig,
  noteCameraRigCombat,
  cameraLookMagnitude,
  defaultShipZoom,
  cameraShakeAmplitudePx,
  sampleCameraShakePx,
  normalizeCameraLookMode
} from '../src/game/cameraRig.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

const W = 1920;
const H = 1080;
const VMAX = 10000;
const tune = createCameraRigTune();

function input(over = {}) {
  return {
    dt: 1 / 144,
    viewW: W,
    viewH: H,
    mouseX: W / 2,
    mouseY: H / 2,
    lookFrozen: false,
    lookEnabled: true,
    velX: 0,
    velY: 0,
    maxSpeed: VMAX,
    mode: 'auto',
    ...over
  };
}

function settle(rig, over = {}, seconds = 4, dt = 1 / 144) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) stepCameraRig(rig, input({ dt, ...over }), tune);
  return rig;
}

// Środek statku na ekranie = środek kadru − offset (kamera jest przed statkiem).
function shipScreen(rig) {
  return { x: W / 2 - rig.offsetX, y: H / 2 - rig.offsetY };
}

test('nawigacja: kursor nie rusza kamerą — świat stoi pod wskaźnikiem', () => {
  const rig = createCameraRig();
  for (const [mx, my] of [[0, 0], [W, 0], [W, H], [0, H], [W * 0.8, H * 0.3]]) {
    settle(rig, { mouseX: mx, mouseY: my }, 1);
    assert.ok(Math.abs(rig.offsetX) < 1e-6 && Math.abs(rig.offsetY) < 1e-6, `kursor (${mx}, ${my})`);
  }
  assert.equal(rig.combat, 0);
});

test('nawigacja: wyprzedzenie lotu — statek ~⅓ ekranu od tylnej krawędzi przy v_max', () => {
  const rig = settle(createCameraRig(), { velX: VMAX }, 6);
  const s = shipScreen(rig);
  const full = (1 - Math.exp(-1 / tune.leadSpeedRef)) * tune.navLead * W / 2;
  assert.ok(Math.abs(rig.offsetX - full) < 0.5, `offset ${rig.offsetX} vs ${full}`);
  assert.ok(s.x / W > 0.3 && s.x / W < 0.35, `statek na ${(s.x / W * 100).toFixed(1)}% szerokości`);
  // W pionie ta sama część pół ekranu (elipsa kadru), nie ułamek szerokości.
  const up = settle(createCameraRig(), { velY: -VMAX * 3 }, 6);
  assert.ok(Math.abs(up.offsetY + tune.navLead * H / 2) < 0.5, `offset pionowy ${up.offsetY}`);
});

test('nawigacja: wyprzedzenie widać przy zwykłych prędkościach, nie dopiero przy v_max', () => {
  // Atlas po ~6 s pełnego ciągu: ~1400 j/s z v_max 10 000. Liniowo byłoby 14% pełnego.
  const rig = settle(createCameraRig(), { velX: 1400 }, 6);
  const share = rig.offsetX / (tune.navLead * W / 2);
  assert.ok(share > 0.35 && share < 0.6, `${(share * 100).toFixed(0)}% pełnego wyprzedzenia`);
  // Rośnie z prędkością i nie przekracza pełnego.
  const faster = settle(createCameraRig(), { velX: 4000 }, 6);
  assert.ok(faster.offsetX > rig.offsetX && faster.offsetX < tune.navLead * W / 2);
});

test('walka: statek zostaje w kadrze przy każdym położeniu kursora i pełnej prędkości', () => {
  const rig = createCameraRig();
  const margin = tune.frameMargin;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let worst = Infinity;
  for (let i = 0; i < 144 * 20; i++) {
    // Kursor skacze po całym kadrze co klatkę, statek leci w losowym kierunku.
    const a = rnd() * Math.PI * 2;
    stepCameraRig(rig, input({
      mode: 'always',
      mouseX: rnd() * W,
      mouseY: rnd() * H,
      velX: Math.cos(a) * VMAX * 1.5,
      velY: Math.sin(a) * VMAX * 1.5,
      dt: 1 / (30 + rnd() * 200)
    }), tune);
    const s = shipScreen(rig);
    worst = Math.min(worst, s.x / W, 1 - s.x / W, s.y / H, 1 - s.y / H);
  }
  assert.ok(worst >= margin - 1e-9, `najbliżej krawędzi: ${(worst * 100).toFixed(2)}% (margines ${margin * 100}%)`);
});

test('walka: kursor przy krawędzi zagląda na 0,75 pół ekranu, w martwej strefie nic', () => {
  const edge = settle(createCameraRig(), { mode: 'always', mouseX: W, mouseY: H / 2 }, 3);
  assert.ok(Math.abs(edge.offsetX - tune.combatLook * W / 2) < 0.5, `offset ${edge.offsetX}`);
  // Dawniej (×2,0 bez limitu) środek statku lądował tu 960 px ZA lewą krawędzią.
  assert.ok(shipScreen(edge).x > tune.frameMargin * W - 1e-6);

  const dz = tune.lookDeadZone * 0.9;
  const center = settle(createCameraRig(), { mode: 'always', mouseX: W / 2 + dz * W / 2, mouseY: H / 2 }, 2);
  assert.ok(Math.abs(center.offsetX) < 1e-6, 'martwa strefa');
});

test('walka: drżenie ręki (±5 px, 30 Hz) prawie nie rusza kamerą', () => {
  const rig = createCameraRig();
  const base = W * 0.75;
  settle(rig, { mode: 'always', mouseX: base, mouseY: H / 2 }, 3);
  let min = Infinity;
  let max = -Infinity;
  const dt = 1 / 144;
  for (let i = 0; i < 288; i++) {
    const t = i * dt;
    stepCameraRig(rig, input({ dt, mode: 'always', mouseX: base + 5 * Math.sin(2 * Math.PI * 30 * t), mouseY: H / 2 }), tune);
    min = Math.min(min, rig.offsetX);
    max = Math.max(max, rig.offsetX);
  }
  // Dawniej kamera szła za ręką 1:2 bez filtra — 20 px rozrzutu.
  assert.ok(max - min < 1, `rozrzut offsetu ${(max - min).toFixed(3)} px`);
});

test('zamrożony kursor trzyma punkt patrzenia; odmrożenie rusza płynnie, bez skoku', () => {
  const rig = settle(createCameraRig(), { mode: 'always', mouseX: W * 0.9, mouseY: H * 0.2 }, 3);
  const held = { x: rig.offsetX, y: rig.offsetY };
  // Menu PPM / koło ŚPM / Alt: kursor jedzie na drugi koniec ekranu.
  settle(rig, { mode: 'always', mouseX: W * 0.1, mouseY: H * 0.9, lookFrozen: true }, 1);
  assert.ok(Math.abs(rig.offsetX - held.x) < 0.01 && Math.abs(rig.offsetY - held.y) < 0.01, 'offset trzymany');
  // Odmrożenie z kursorem na drugim końcu (~1300 px drogi): pierwsza klatka to
  // ułamek drogi. Dawniej Alt zerował offset w jednej klatce — skok o setki px.
  const before = rig.offsetX;
  stepCameraRig(rig, input({ mode: 'always', mouseX: W * 0.1, mouseY: H * 0.9 }), tune);
  assert.ok(Math.abs(rig.offsetX - before) < 3, `pierwsza klatka po odmrożeniu: ${(rig.offsetX - before).toFixed(2)} px`);
});

test('krok niezależny od FPS i nierównych klatek', () => {
  const run = (dts) => {
    const rig = createCameraRig();
    for (const dt of dts) stepCameraRig(rig, input({ dt, mode: 'never', velX: VMAX, velY: -VMAX * 0.4 }), tune);
    return rig;
  };
  const steps = (dt, n) => Array.from({ length: n }, () => dt);
  const a = run(steps(1 / 60, 30));
  const b = run(steps(1 / 144, 72));
  const uneven = [0.033, 0.004, 0.021, 0.0069, 0.012, 0.033, 0.0011, 0.017];
  const c = run([...uneven, 0.5 - uneven.reduce((s, x) => s + x, 0)]);
  for (const r of [b, c]) {
    assert.ok(Math.abs(r.offsetX - a.offsetX) < 1e-6 && Math.abs(r.offsetY - a.offsetY) < 1e-6,
      `${r.offsetX} vs ${a.offsetX}`);
  }
  assert.ok(a.offsetX > 0 && a.offsetX < tune.navLead * W / 2, 'po 0,5 s jeszcze w drodze');
});

test('postawa walki: sygnał trzyma ją combatHold s, pauza nie odlicza', () => {
  const rig = createCameraRig();
  const dt = 1 / 144;
  noteCameraRigCombat(rig, tune, 'strzał');
  assert.equal(rig.combatReason, 'strzał');
  settle(rig, { holdDt: dt }, tune.combatEnterTime + 0.05, dt);
  assert.equal(rig.combat, 1, 'po czasie wejścia pełna walka');
  // Pauza: klatki lecą, czas gry stoi — walka zostaje.
  settle(rig, { holdDt: 0 }, 20, dt);
  assert.equal(rig.combat, 1);
  // Bez sygnałów: trzymanie, potem wyjście.
  settle(rig, { holdDt: dt }, tune.combatHold - tune.combatEnterTime - 0.2, dt);
  assert.equal(rig.combat, 1, 'jeszcze w oknie trzymania');
  settle(rig, { holdDt: dt }, 0.2 + tune.combatExitTime + 0.05, dt);
  assert.equal(rig.combat, 0, 'wróciła nawigacja');
});

test('opcja kamery: Zawsze / Nigdy ignorują sygnały, nieznana = Auto', () => {
  const always = settle(createCameraRig(), { mode: 'always' }, 1);
  assert.equal(always.combat, 1);
  const never = createCameraRig();
  noteCameraRigCombat(never, tune, 'trafienie');
  settle(never, { mode: 'never', mouseX: W, mouseY: H }, 1);
  assert.equal(never.combat, 0);
  assert.ok(Math.abs(never.offsetX) < 1e-6, 'Nigdy: kursor nie rusza kamerą mimo walki');
  assert.equal(normalizeCameraLookMode('bzdura'), 'auto');
  assert.equal(normalizeCameraLookMode('never'), 'never');
});

test('split-screen: kursor wyłączony, wyprzedzenie zostaje', () => {
  const rig = settle(createCameraRig(), { mode: 'always', lookEnabled: false, mouseX: W, velX: VMAX * 3 }, 3);
  assert.ok(Math.abs(rig.offsetX - tune.combatLead * W / 2) < 0.5);
});

test('krzywa kursora, zoom startowy i strojenie w zakresach', () => {
  assert.equal(cameraLookMagnitude(0.1, 0.12, 1.2), 0);
  assert.equal(cameraLookMagnitude(1, 0.12, 1.2), 1);
  assert.ok(cameraLookMagnitude(0.5, 0.12, 1) > cameraLookMagnitude(0.5, 0.12, 1.5));
  // Atlas: 1800 j. na 20% z 1920 px.
  assert.ok(Math.abs(defaultShipZoom(1920, 1800, tune) - 0.2133) < 1e-3);
  assert.equal(defaultShipZoom(1920, 10, tune), 3.2);
  const t = createCameraRigTune({ combatLook: 99, navOmega: 'x', nieznane: 1 });
  assert.equal(t.combatLook, CAMERA_RIG_RANGES.combatLook[1]);
  assert.equal(t.navOmega, CAMERA_RIG_DEFAULTS.navOmega);
  assert.equal('nieznane' in t, false);
  for (const key of Object.keys(CAMERA_RIG_DEFAULTS)) {
    const [min, max] = CAMERA_RIG_RANGES[key];
    assert.ok(CAMERA_RIG_DEFAULTS[key] >= min && CAMERA_RIG_DEFAULTS[key] <= max, key);
  }
});

test('wstrząs: w px z sufitem, gładki w czasie', () => {
  assert.equal(cameraShakeAmplitudePx(18, 0, tune), 18 * tune.shakeScale);
  assert.equal(cameraShakeAmplitudePx(1000, 1000, tune), tune.shakeMaxPx);
  const out = { x: 0, y: 0 };
  let prev = null;
  let worstStep = 0;
  for (let i = 0; i < 1000; i++) {
    sampleCameraShakePx(10, i / 1000, tune, out);
    assert.ok(Math.abs(out.x) <= 10 + 1e-9 && Math.abs(out.y) <= 10 + 1e-9);
    if (prev) worstStep = Math.max(worstStep, Math.abs(out.x - prev.x), Math.abs(out.y - prev.y));
    prev = { ...out };
  }
  // Biały szum skakał o pełną amplitudę między klatkami.
  assert.ok(worstStep < 2, `największy krok w 1 ms: ${worstStep.toFixed(3)} px`);
  sampleCameraShakePx(0, 1, tune, out);
  assert.deepEqual(out, { x: 0, y: 0 });
});

// --- index.html ---

const html = readIndexHtml();

test('render: kamera statku z riga, bez dawnego ×2,0 za kursorem', () => {
  const render = sliceFunction(html, 'function render(alpha, frameDt) {');
  assert.doesNotMatch(render, /lookAheadFactor/);
  assert.match(render, /stepCameraRig\(cameraRig, rigIn, cameraRigTune\)/);
  assert.match(render, /rigIn\.lookFrozen = isCameraLookFrozen\(\);/);
  assert.match(render, /rigIn\.holdDt = PAUSED \? 0 : \(frameDt \|\| 0\);/);
  // Przejście do statku goni żywy cel riga, potem krok przejścia raz na klatkę.
  assert.match(render, /camera\.transition\.targetX = rigX;[\s\S]*?stepCameraTransition\(frameDt \|\| 0\);/);
  const cameraTarget = sliceFunction(html, 'function updateCameraTarget(dt) {');
  assert.doesNotMatch(cameraTarget, /tr\.elapsed/, 'przejścia nie idą w krokach fizyki');
});

test('kursor zamrożony przy menu PPM, kole ŚPM, Alt, tablecie, CIC i poza kanwą', () => {
  const frozen = sliceFunction(html, 'function isCameraLookFrozen() {');
  for (const cond of ['isHudPointerMode()', '!mouse.overCanvas', 'worldCommandMenu.open', 'targetingMode.wheelOpen', 'stationUI.open', 'CICDisplay.active']) {
    assert.ok(frozen.includes(cond), cond);
  }
});

test('trafienie przełącza postawę, obrażenia spoza walki nie', () => {
  // sliceFunction staje na `{}` domyślnego parametru — wycinek do przypisania na window.
  const dmgAt = html.indexOf('function applyDamageToPlayer(amount, opts = {}) {');
  const dmg = html.slice(dmgAt, html.indexOf('window.applyDamageToPlayer = applyDamageToPlayer;', dmgAt));
  assert.match(dmg, /opts\?\.combat !== false\) noteCameraCombat\(/);
  const integrity = sliceFunction(html, 'function enforceNpcHexIntegrityBalance() {');
  const playerCalls = integrity.match(/applyDamageToPlayer\([^)]*\)/g) || [];
  assert.ok(playerCalls.length >= 2);
  for (const call of playerCalls) assert.match(call, /combat: false/, call);
});

function makeCamera(over = {}) {
  return {
    x: 0, y: 0, zoom: 0.5, targetX: 0, targetY: 0, targetZoom: 0.5,
    minZoom: 0.035, maxZoom: 3.2, mode: 'ship', transition: null, ...over
  };
}

function loadTransition(camera) {
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep01 = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  return loadIndexFunction(html, 'function stepCameraTransition(dt) {', 'stepCameraTransition',
    { camera, lerp, smoothstep01, clamp });
}

test('przejście do statku: goni ruchomy cel, kończy dokładnie na nim, zoomu nie rusza', () => {
  const camera = makeCamera({
    x: 0, y: 0, zoom: 0.3,
    transition: { kind: 'ship', startX: 0, startY: 0, startZoom: 0.3, targetX: 1000, targetY: 0, targetZoom: 2, elapsed: 0, duration: 0.75 }
  });
  const step = loadTransition(camera);
  let targetX = 1000;
  let prevX = camera.x;
  let worstJump = 0;
  const dt = 1 / 144;
  while (camera.transition) {
    // render() przestawia cel co klatkę na statek + offset (statek leci).
    targetX += 3000 * dt;
    camera.transition.targetX = targetX;
    step(dt);
    worstJump = Math.max(worstJump, Math.abs(camera.x - prevX));
    prevX = camera.x;
    assert.equal(camera.zoom, 0.3, 'zoom prowadzi sprężyna, nie przejście');
  }
  assert.equal(camera.x, targetX, 'koniec na żywym celu — następna klatka riga bez skoku');
  assert.ok(worstJump < 60, `największy krok klatki: ${worstJump.toFixed(1)} j.`);
});

test('przejście do fokusu stacji nadal prowadzi zoom, a sprężyna zoomu stoi tylko wtedy', () => {
  const camera = makeCamera({
    mode: 'infrastructure', zoom: 0.3,
    transition: { kind: 'infrastructure', startX: 0, startY: 0, startZoom: 0.3, targetX: 500, targetY: 0, targetZoom: 0.9, elapsed: 0, duration: 0.9 }
  });
  const step = loadTransition(camera);
  step(0.45);
  assert.ok(camera.zoom > 0.3 && camera.zoom < 0.9);
  step(1);
  assert.equal(camera.zoom, 0.9);
  assert.equal(camera.transition, null);

  const zoomFn = sliceFunction(html, 'function updateCameraZoom(dt) {');
  assert.match(zoomFn, /if \(camera\.transition && camera\.transition\.kind !== 'ship'\) \{/);
});

test('powrót z edytora stacji wraca do zoomu gracza, nie do stałego defaultZoom', () => {
  const clearFocus = html.slice(html.indexOf('      clearFocus() {'), html.indexOf('      clearFocus() {') + 900);
  assert.match(clearFocus, /this\.returnZoom/);
  assert.match(html, /focusOnInfrastructure\(station, layout\) \{\s*if \(!station\) return;\s*this\.rememberShipZoom\(\);/);
});
