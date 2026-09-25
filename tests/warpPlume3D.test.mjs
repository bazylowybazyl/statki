import test from 'node:test';
import assert from 'node:assert/strict';

import { WarpPlumeFX } from '../src/3d/warpPlume3D.js';
import { WARP_PLUME_BASE_LEN } from '../src/data/engineFx.js';

const DT = 1 / 60;

function run(fx, seconds, dt = DT) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) fx.update(dt, null, 1080, true);
}

test('zapłon → praca → dopalacz → gaszenie → instancja gotowa do puli', () => {
  const fx = new WarpPlumeFX();
  fx.setPose(7_080_000, -6_290_000, -5, 1, 0, 34);
  assert.equal(fx.state, 'off');
  fx.ignite();
  run(fx, 1.2);
  assert.equal(fx.state, 'running');
  const lenRun = fx.plumeMat.uniforms.uLen.value;
  assert.ok(Math.abs(lenRun - WARP_PLUME_BASE_LEN) < 0.2, `długość przy pełnej mocy ${lenRun}`);

  fx.setBoost(true);
  run(fx, 1.5);
  assert.ok(fx.plumeMat.uniforms.uLen.value > lenRun * 1.4, 'skok (dopalacz) wydłuża strumień');

  fx.shutdown();
  run(fx, 0.5);
  assert.equal(fx.state, 'shutdown');
  assert.equal(fx.finished, false, 'poświata po wyłączeniu jeszcze świeci');
  run(fx, 4);
  assert.equal(fx.state, 'off');
  assert.equal(fx.finished, true);
});

test('ponowny zapłon w trakcie gaszenia (szybki drugi skok)', () => {
  const fx = new WarpPlumeFX();
  fx.ignite();
  run(fx, 1.2);
  fx.shutdown();
  run(fx, 0.3);
  fx.ignite();
  assert.equal(fx.state, 'ignition');
  run(fx, 1.2);
  assert.equal(fx.state, 'running');
});

test('setPose: plume leży w płaszczyźnie gry i celuje w kierunek wydechu', () => {
  const fx = new WarpPlumeFX();
  fx.setPose(10, 20, -5, 0, -1, 12);
  fx.root.updateMatrixWorld(true);
  const e = fx.root.matrixWorld.elements;
  // lokalna oś +Z (oś dyszy) po obrocie = kolumna 2 macierzy / skala
  const ax = e[8] / 12, ay = e[9] / 12, az = e[10] / 12;
  assert.ok(Math.abs(ax) < 1e-9 && Math.abs(ay + 1) < 1e-9 && Math.abs(az) < 1e-9, `oś ${ax},${ay},${az}`);
  assert.equal(fx.root.position.x, 10);
  assert.equal(fx.root.scale.x, 12);
});

test('strumień nigdy nie płynie wstecz — także przy gwałtownych zmianach mocy', () => {
  // Cecha szumu oktawy 1 siedzi na q = z·0,26·k − φ. Po kroku jej z przesuwa się
  // o z·(k_stare/k_nowe − 1) + Δφ/(0,26·k_nowe). Dawniej φ = czas·prędkość:
  // spadek prędkości cofał cały strumień, a skok rozciągnięcia k ciągnął ogon
  // z powrotem do dyszy.
  const fx = new WarpPlumeFX();
  fx.ignite();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  let minRatio = Infinity;
  for (let frame = 0; frame < 60 * 40; frame++) {
    if (frame % 25 === 0) fx.setBoost(rnd() < 0.5);
    if (frame % 400 === 399) fx.shutdown();
    if (frame % 400 === 150) fx.ignite();
    if (frame % 97 === 0) fx.params.flowSpeed = 1 + rnd() * 15;   // suwak w locie
    const dt = frame % 7 === 0 ? 1 / 30 : DT;                       // nierówne klatki
    const before = { o1: fx._ph.o1, k: fx._ph.stretch };
    fx.update(dt, null, 1080, true);
    const after = { o1: fx._ph.o1, k: fx._ph.stretch };
    let dPhi = after.o1 - before.o1;
    if (dPhi < -100) dPhi += 289;                                   // zawinięcie okresu simplexa
    assert.ok(dPhi > 0, `faza cofnęła się w klatce ${frame}`);
    const zTail = fx.plumeMat.uniforms.uBoundZ1.value;
    for (const z of [0, zTail * 0.5, zTail]) {
      const q0 = z * 0.26 * before.k - before.o1;
      const zNew = (q0 + before.o1 + dPhi) / (0.26 * after.k);
      const v = (zNew - z) / dt;
      assert.ok(v > 0, `klatka ${frame}: cecha na z=${z.toFixed(1)} cofa się (v=${v.toFixed(3)})`);
      const flowAtDyszy = dPhi / (0.26 * after.k * dt);
      minRatio = Math.min(minRatio, v / flowAtDyszy);
    }
  }
  assert.ok(minRatio > 0.25, `ogon płynie co najmniej ~30% prędkości wylotu (min ${minRatio.toFixed(3)})`);
});
