// Poza renderu gracza w workerze (2026-10-17, zgłoszenie użytkownika: „statek im szybciej leci, tym bardziej drży /
// rozjeżdża się na kilka statków; w warpie jeden obok drugiego”): strona pakuje window.__interpShipPose do HEAD.INTERP_*,
// a moduły renderu (hexShips3D — skóra kadłuba, dysze, rakiety, warp) czytają ją przez RenderWorld.playerPose. Worker
// jej nie odbierał — kadłub gracza szedł w pozie KROKU fizyki (60 Hz), kamera i wieże w pozie interpolowanej.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('worker: HEAD.INTERP_X / Y / ANGLE strony → RenderWorld.playerPose (własne pole źródła luster)', () => {
  const src = read('src/render/render.worker.js');
  assert.match(src, /Object\.defineProperty\(st\.players, 'playerPose', \{ value: null, writable: true/);
  assert.match(src, /const ix = h\[H\.INTERP_X\], iy = h\[H\.INTERP_Y\], ia = h\[H\.INTERP_ANGLE\];/);
  assert.match(src, /st\.players\.playerPose = ip;/);
  // moduły z własną pozą gracza: tarcze (jak strona: updateShields3D(…, __interpShipPose)), mostki i okna mostków,
  // modele 3D statków, drony naprawcze (poseOf jak bridgeRenderPose strony) — żaden z pustą pozą
  assert.match(src, /st\.playerPoseOf = \(e\) => \(e === st\.players\.ship \? st\.players\.playerPose : null\);/);
  assert.match(src, /shields\.updateShields3D\(dt, rm\.lists\[L\.SEEN\], st\.players\.playerPose\)/);
  assert.match(src, /models\.syncShipModels3D\(\{ entities: rm\.lists\[L\.SEEN_COLD\], poseOf: st\.playerPoseOf,/);
  assert.match(src, /const poseOf = st\.playerPoseOf;/);
  assert.doesNotMatch(src, /poseOf: null/);
  assert.doesNotMatch(src, /updateShields3D\([^)]*, null\)/);
  // pakujący nadal wysyła pozę gracza
  assert.match(read('src/render/snapshotPack.js'), /h\[HEAD\.INTERP_X\] = ip \? raw\(ip\.x\) : NaN;/);
});

test('RenderWorld: źródło luster z własnym playerPose oddaje je modułom renderu (hexShips3D, dysze, warp)', async () => {
  const { RenderWorld, createMirrorPlayersSource } = await import('../src/render/renderWorld.js');
  const src = createMirrorPlayersSource();
  Object.defineProperty(src, 'playerPose', { value: null, writable: true, enumerable: true });
  const ship = { id: 'gracz' };
  src.ship = ship;
  const pose = { x: 123.5, y: -42, angle: 0.7 };
  src.playerPose = pose;
  RenderWorld.setSource(src);
  try {
    assert.equal(RenderWorld.ship, ship);
    assert.equal(RenderWorld.playerPose, pose);
    src.playerPose = null;
    assert.equal(RenderWorld.playerPose, null);
  } finally {
    RenderWorld.setSource(null);
  }
});

test('worker: HEAD.LEAD_* strony → RenderWorld.cameraLead (fregata zwiadu prowadzona kamerą — niebo-sfera)', async () => {
  const src = read('src/render/render.worker.js');
  assert.match(src, /Object\.defineProperty\(st\.players, 'cameraLead', \{ value: null, writable: true/);
  assert.match(src, /const lw = h\[H\.LEAD_W\];/);
  assert.match(src, /st\.players\.cameraLead = cl;/);
  // zegar klatek strony (pominięte strony nie gubią czasu nieba): HEAD.T_FRAME → RenderWorld.frameClock
  assert.match(src, /Object\.defineProperty\(st\.players, 'frameClock', \{ value: null, writable: true/);
  assert.match(src, /const tf = h\[H\.T_FRAME\];\s*st\.players\.frameClock = tf === tf \? tf : null;/);
  assert.match(read('src/3d/planet3d.assets.js'), /RenderWorld\.frameClock\)/);
  assert.match(read('src/render/snapshotPack.js'), /const cl = f\.cameraLead;/);
  // strona: obiekt z getterami nad stanem kamery fregaty i pole klatki migawki
  const html = read('index.html');
  assert.match(html, /window\.__cameraLead = \{/);
  assert.match(html, /f\.cameraLead = window\.__cameraLead;/);
  const { RenderWorld, createMirrorPlayersSource } = await import('../src/render/renderWorld.js');
  const s = createMirrorPlayersSource();
  Object.defineProperty(s, 'cameraLead', { value: null, writable: true, enumerable: true });
  RenderWorld.setSource(s);
  try {
    assert.equal(RenderWorld.cameraLead, null);
    const lead = { x: 1, y: 2, v: 900, w: 1 };
    s.cameraLead = lead;
    assert.equal(RenderWorld.cameraLead, lead);
  } finally {
    RenderWorld.setSource(null);
  }
});
