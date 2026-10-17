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
