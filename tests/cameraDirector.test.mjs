import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_DIRECTOR_DEFAULTS, CAM_POINT_MUST, createCameraDirector, createCameraDirectorTune, stepCameraDirector,
  beginCameraDirectorPoints, pushCameraDirectorPoint, noteCameraDirectorCue, noteCameraDirectorWheel,
  foldCameraDirectorZoom, normalizeCameraFrameMode
} from '../src/game/cameraDirector.js';
import { CAMERA_RIG_DEFAULTS, createCameraRig, stepCameraRig } from '../src/game/cameraRig.js';

const tune = createCameraDirectorTune();
// Atlas w domyślnym kadrze 1600 × 900 (pomiar w grze: zoom 0,1778 — kadr 9 × 5,1 km)
const VIEW = { viewW: 1600, viewH: 900, shipLength: 1800, baseZoom: 0.1778, minZoom: 0.035, maxZoom: 3.2, shipMargin: 0.12 };

function input(over = {}) {
  return { dt: 1 / 60, shipX: 0, shipY: 0, mode: 'full', enabled: true, suspend: false, ...VIEW, ...over };
}

// n kroków z tymi samymi punktami (funkcja `points(dir)` wpisuje je co klatkę — jak gra)
function run(dir, sec, over = {}, points = null, hz = 60) {
  const steps = Math.round(sec * hz);
  for (let i = 0; i < steps; i++) {
    beginCameraDirectorPoints(dir);
    if (points) points(dir, i / hz);
    stepCameraDirector(dir, input({ dt: 1 / hz, ...over }), tune);
  }
  return dir;
}

// Kadr: środek = statek + bias, zoom = baza · e^zoomLog. Punkt (x, y, r) w kadrze z marginesem (ułamek pół kadru).
function inFrame(dir, x, y, r, margin, over = {}) {
  const v = { ...VIEW, ...over };
  const z = v.baseZoom * Math.exp(dir.zoomLog);
  const cx = dir.biasX;
  const cy = dir.biasY;
  const hw = v.viewW / 2 / z;
  const hh = v.viewH / 2 / z;
  const f = 1 - margin;
  return Math.abs(x - cx) + r <= hw * f + 1 && Math.abs(y - cy) + r <= hh * f + 1;
}

test('bez wrogów kadr stoi na statku: przesunięcie 0, zoom gracza, kursor bez tłumienia', () => {
  const dir = run(createCameraDirector(), 3);
  assert.equal(dir.biasX, 0);
  assert.equal(dir.biasY, 0);
  assert.equal(dir.zoomLog, 0);
  assert.equal(dir.lookScale, 1);
  assert.equal(dir.presence, 0);
});

test('fala 10 km pod statkiem (pomiar z gry): kadr przesuwa się ku niej i oddala, aż wróg i statek się mieszczą', () => {
  const dir = run(createCameraDirector(), 12, {}, (d) => pushCameraDirectorPoint(d, 0, 10000, 400, 2, CAM_POINT_MUST));
  assert.ok(dir.biasY > 3000, `środek kadru ku fali: ${dir.biasY}`);
  assert.ok(Math.abs(dir.biasX) < 1);
  assert.ok(dir.zoomLog < -0.5, `oddalenie: ${dir.zoomLog}`);
  // wróg i cały kadłub (z promieniem) w kadrze z odstępem edgePad (środek statku pilnuje dodatkowo rig — frameMargin)
  assert.ok(inFrame(dir, 0, 10000, 400, tune.edgePad), 'wróg w kadrze');
  assert.ok(inFrame(dir, 0, 0, VIEW.shipLength / 2, tune.edgePad), 'statek w kadrze');
  // i nie dalej niż trzeba: jeden z warunków jest napięty (zoom o 5% bliżej już się nie mieści)
  const tight = { ...dir, zoomLog: dir.zoomLog + 0.05 };
  assert.ok(!inFrame(tight, 0, 10000, 400, tune.edgePad) || !inFrame(tight, 0, 0, VIEW.shipLength / 2, tune.edgePad));
  assert.ok(dir.lookScale < 0.6, 'kursor słabiej zagląda przy kadrze bitwy');
});

test('pasy HUD: wróg pod statkiem nie ląduje pod kopułą radaru, statek nie wchodzi pod panel celu', () => {
  const ins = { insetTop: 75, insetBottom: 165 };
  const dir = run(createCameraDirector(), 12, ins, (d) => pushCameraDirectorPoint(d, 0, 9000, 400, 2, CAM_POINT_MUST));
  const z = VIEW.baseZoom * Math.exp(dir.zoomLog);
  const scr = (wy) => (wy - dir.biasY) * z + VIEW.viewH / 2;
  const pad = tune.edgePad * VIEW.viewH / 2;
  assert.ok(scr(9000 + 400) <= VIEW.viewH - ins.insetBottom - pad + 1, `wróg nad kopułą: ${scr(9400)}`);
  assert.ok(scr(-VIEW.shipLength / 2) >= ins.insetTop + pad - 1, `kadłub pod panelem celu: ${scr(-900)}`);
  // bez pasów ten sam wróg mieści się bliżej — pasy kosztują oddalenie
  const free = run(createCameraDirector(), 12, {}, (d) => pushCameraDirectorPoint(d, 0, 9000, 400, 2, CAM_POINT_MUST));
  assert.ok(dir.zoomLog < free.zoomLog);
});

test('gracz przybliżył kółkiem (kadłub większy od kadru): wróg w kadrze nie jest powodem do oddalania', () => {
  const dir = run(createCameraDirector(), 6, { baseZoom: 0.7 }, (d) => pushCameraDirectorPoint(d, 300, 0, 50, 1, CAM_POINT_MUST));
  assert.ok(Math.abs(dir.zoomLog) < 1e-6, `${dir.zoomLog}`);
});

test('wróg daleko: oddalenie kończy się na podłodze (× minZoomFactor albo kadłub ≥ minShipFrac kadru)', () => {
  const dir = run(createCameraDirector(), 12, {}, (d) => pushCameraDirectorPoint(d, 40000, 0, 400, 2, CAM_POINT_MUST));
  const z = VIEW.baseZoom * Math.exp(dir.zoomLog);
  const floor = Math.max(VIEW.baseZoom * tune.minZoomFactor, Math.min(VIEW.baseZoom, tune.minShipFrac * VIEW.viewW / VIEW.shipLength));
  assert.ok(Math.abs(z - floor) / floor < 0.01, `zoom ${z} vs podłoga ${floor}`);
  // statek zawsze w kadrze
  assert.ok(inFrame(dir, 0, 0, VIEW.shipLength / 2, tune.edgePad));
});

test('wróg w kadrze gracza: bez oddalania, tylko przesunięcie', () => {
  const dir = run(createCameraDirector(), 6, {}, (d) => pushCameraDirectorPoint(d, 2000, 0, 300, 1, CAM_POINT_MUST));
  assert.ok(Math.abs(dir.zoomLog) < 1e-6);
  assert.ok(dir.biasX > 500 && dir.biasX <= 1000 + 1, `połowa drogi do wroga: ${dir.biasX}`);
});

test('tryb „Bez zoomu” przesuwa kadr, zoomu nie rusza; „Wył.” nic', () => {
  const pan = run(createCameraDirector(), 8, { mode: 'pan' }, (d) => pushCameraDirectorPoint(d, 0, 10000, 400, 2, CAM_POINT_MUST));
  assert.equal(pan.zoomLog, 0);
  assert.ok(pan.biasY > 1000, `kadr ku fali przy zoomie gracza: ${pan.biasY}`);
  assert.ok(inFrame(pan, 0, 0, VIEW.shipLength / 2, tune.edgePad), 'statek w kadrze przy zoomie gracza');
  const off = run(createCameraDirector(), 8, { mode: 'off' }, (d) => pushCameraDirectorPoint(d, 0, 10000, 400, 2, CAM_POINT_MUST));
  assert.equal(off.zoomLog, 0);
  assert.equal(off.biasY, 0);
  assert.equal(normalizeCameraFrameMode('x'), 'full');
});

test('przybliżanie czeka zoomInHold s i idzie wolno; zniknięcie wroga — kadr gaśnie po lingerSec', () => {
  const dir = createCameraDirector();
  run(dir, 10, {}, (d) => pushCameraDirectorPoint(d, 0, 10000, 400, 2, CAM_POINT_MUST));
  const out = dir.zoomLog;
  // wróg podchodzi na 3 km — potrzeba mniejsza, ale przez zoomInHold kadr stoi
  run(dir, tune.zoomInHold * 0.8, {}, (d) => pushCameraDirectorPoint(d, 0, 3000, 400, 2, CAM_POINT_MUST));
  assert.ok(Math.abs(dir.zoomLog - out) < 0.02, `czeka: ${dir.zoomLog} vs ${out}`);
  run(dir, 6, {}, (d) => pushCameraDirectorPoint(d, 0, 3000, 400, 2, CAM_POINT_MUST));
  assert.ok(dir.zoomLog > out + 0.2, `potem przybliża: ${dir.zoomLog}`);
  // wróg znika: kadr trzymany lingerSec, potem gaśnie do zera
  const held = dir.zoomLog;
  run(dir, tune.lingerSec * 0.8);
  assert.ok(Math.abs(dir.zoomLog - held) < 0.05, 'trzyma po ostatnim wrogu');
  run(dir, tune.lingerSec + tune.exitTime + 8);
  assert.ok(Math.abs(dir.zoomLog) < 0.01 && Math.abs(dir.biasY) < 20, `wraca do statku: ${dir.zoomLog}, ${dir.biasY}`);
});

test('kółko: przybliżenie zabiera reżyserowi władzę nad zoomem, nowy przylot ją przywraca', () => {
  const dir = createCameraDirector();
  const pts = (d) => pushCameraDirectorPoint(d, 0, 10000, 400, 2, CAM_POINT_MUST);
  run(dir, 10, {}, pts);
  const full = dir.zoomLog;
  noteCameraDirectorWheel(dir, Math.exp(0.2) ** 3);   // 3 ząbki przybliżenia
  run(dir, 1, {}, pts);
  assert.ok(dir.zoomLog > full * 0.2, `kółko działa od razu: ${dir.zoomLog} vs ${full}`);
  // nowy sygnał przylotu — pełna władza
  noteCameraDirectorCue(dir, 'fala-2', 9000, 0, 500, 1.5);
  run(dir, 3, {}, pts);
  assert.ok(dir.zoomLog < full * 0.9, `przylot oddala znowu: ${dir.zoomLog}`);
  // oddalenie kółkiem nie zmienia władzy
  const a = dir.authorityTarget;
  noteCameraDirectorWheel(dir, 0.8);
  assert.equal(dir.authorityTarget, a);
});

test('sygnał przylotu sam ustawia kadr i wygasa po cueLife', () => {
  const dir = createCameraDirector();
  noteCameraDirectorCue(dir, 'rec-1', -9000, 6000, 600, 1.5);
  run(dir, 2);
  assert.ok(dir.biasX < -500 && dir.biasY > 300, `kadr ku przylotowi: ${dir.biasX}, ${dir.biasY}`);
  assert.ok(dir.zoomLog < -0.1);
  assert.equal(dir.cueN, 1);
  run(dir, tune.cueLife);
  assert.equal(dir.cueN, 0);
});

test('suspend zeruje od razu, wejście w RTS przenosi oddalenie na zoom gracza', () => {
  const dir = run(createCameraDirector(), 8, {}, (d) => pushCameraDirectorPoint(d, 0, 10000, 400, 2, CAM_POINT_MUST));
  assert.ok(dir.zoomLog < 0);
  const log = dir.zoomLog;
  assert.equal(foldCameraDirectorZoom(dir), log);
  assert.equal(dir.zoomLog, 0);
  run(dir, 4, {}, (d) => pushCameraDirectorPoint(d, 0, 10000, 400, 2, CAM_POINT_MUST));
  stepCameraDirector(dir, input({ suspend: true }), tune);
  assert.equal(dir.zoomLog, 0);
  assert.equal(dir.biasY, 0);
});

test('wyłączenie (warp) gasi kadr płynnie, z fast szybciej', () => {
  const pts = (d) => pushCameraDirectorPoint(d, 0, 10000, 400, 2, CAM_POINT_MUST);
  const slow = run(createCameraDirector(), 8, {}, pts);
  const fast = run(createCameraDirector(), 8, {}, pts);
  run(slow, 0.5, { enabled: false }, pts);
  run(fast, 0.5, { enabled: false, fast: true }, pts);
  assert.ok(slow.zoomLog < -0.2, 'zwykłe wygaszanie trwa');
  assert.ok(fast.zoomLog > slow.zoomLog, 'fast szybciej');
});

test('przebieg nie zależy od FPS (30 vs 144 Hz)', () => {
  const pts = (d, t) => pushCameraDirectorPoint(d, 3000 * Math.cos(t * 0.3), 9000 + 2000 * Math.sin(t * 0.5), 400, 2, CAM_POINT_MUST);
  const a = run(createCameraDirector(), 9, {}, pts, 30);
  const b = run(createCameraDirector(), 9, {}, pts, 144);
  assert.ok(Math.abs(a.zoomLog - b.zoomLog) < 0.03, `${a.zoomLog} vs ${b.zoomLog}`);
  assert.ok(Math.abs(a.biasY - b.biasY) < 150, `${a.biasY} vs ${b.biasY}`);
});

test('punkty bez flagi „musi” (rój dronów) ciągną środek, nie oddalają', () => {
  const dir = run(createCameraDirector(), 6, {}, (d) => {
    for (let i = 0; i < 10; i++) pushCameraDirectorPoint(d, 8000 + i * 50, 0, 30, 0.15, 0);
  });
  assert.equal(dir.zoomLog, 0);
  assert.ok(dir.biasX > 300);
  assert.ok(dir.biasX * VIEW.baseZoom <= tune.leanMax * VIEW.viewW / 2 + 1, 'tylko wychylenie');
  assert.ok(inFrame(dir, 0, 0, VIEW.shipLength / 2, tune.edgePad));
});

test('sam daleki wróg (bez „musi”): kadr tylko się wychyla, statek nie ucieka w róg', () => {
  const dir = run(createCameraDirector(), 8, {}, (d) => pushCameraDirectorPoint(d, 12000, 4000, 400, 1, 0));
  assert.equal(dir.zoomLog, 0);
  const z = VIEW.baseZoom;
  const ex = dir.biasX * z / (VIEW.viewW / 2);
  const ey = dir.biasY * z / (VIEW.viewH / 2);
  assert.ok(Math.sqrt(ex * ex + ey * ey) <= tune.leanMax + 1e-3, `wychylenie ${ex}, ${ey}`);
  assert.ok(dir.biasX > 0 && dir.biasY > 0, 'w stronę wroga');
});

test('rig: przesunięcie reżysera po sprężynie i w kadrze, tłumienie kursora, kursor poza kanwą wraca do środka', () => {
  const tuneRig = { ...CAMERA_RIG_DEFAULTS };
  const base = { dt: 1 / 60, holdDt: 1 / 60, viewW: 1600, viewH: 900, mouseX: 800, mouseY: 450, velX: 0, velY: 0, maxSpeed: 500, mode: 'always' };
  // bias dodany wprost (bez sprężyny) i przycięty do kadru
  const rig = createCameraRig();
  stepCameraRig(rig, { ...base, biasX: 200, biasY: 9999 }, tuneRig);
  assert.equal(rig.offsetX, 200);
  assert.equal(rig.offsetY, 900 * (0.5 - tuneRig.frameMargin));
  // lookScale tłumi zaglądanie za kursorem
  const a = createCameraRig();
  const b = createCameraRig();
  for (let i = 0; i < 240; i++) {
    stepCameraRig(a, { ...base, mouseX: 1500 }, tuneRig);
    stepCameraRig(b, { ...base, mouseX: 1500, lookScale: 0.5 }, tuneRig);
  }
  assert.ok(Math.abs(b.offsetX - a.offsetX * 0.5) < 2, `${b.offsetX} vs ${a.offsetX}`);
  // kursor schodzi z kanwy: punkt trzymany lookAwayHold s, potem wraca
  const look = a.offsetX;
  for (let i = 0; i < Math.round(tuneRig.lookAwayHold * 60) - 5; i++) stepCameraRig(a, { ...base, mouseX: 1500, lookAway: true }, tuneRig);
  assert.ok(Math.abs(a.offsetX - look) < 1, 'trzyma');
  for (let i = 0; i < 600; i++) stepCameraRig(a, { ...base, mouseX: 1500, lookAway: true }, tuneRig);
  assert.ok(Math.abs(a.offsetX) < 5, `wraca do środka: ${a.offsetX}`);
  // zamrożenie (kursor zajęty UI) trzyma bez końca
  const c = createCameraRig();
  for (let i = 0; i < 240; i++) stepCameraRig(c, { ...base, mouseX: 1500 }, tuneRig);
  const held = c.offsetX;
  for (let i = 0; i < 900; i++) stepCameraRig(c, { ...base, mouseX: 100, lookFrozen: true }, tuneRig);
  assert.ok(Math.abs(c.offsetX - held) < 1);
});

test('strojenie: zakresy przycinają nadpisania', () => {
  const t = createCameraDirectorTune({ minZoomFactor: 5, bias: -1, foo: 3 });
  assert.equal(t.minZoomFactor, 1);
  assert.equal(t.bias, 0);
  assert.equal(t.foo, undefined);
  assert.equal(t.lookDamp, CAMERA_DIRECTOR_DEFAULTS.lookDamp);
});
