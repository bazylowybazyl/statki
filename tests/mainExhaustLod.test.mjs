// LOD dysz MAIN za kadrem (audyt FPS 2026-10-11 § 6.2 pkt 2): dysza okrętu poza pudłem rysowania, której strugi
// i iskry nie sięgną kadru, nie wypuszcza ich (engineVfxSystem.js → MainExhaust3D.push z pixelRadius = 0). Zasięg
// obrazu od wylotu (mainExhaustReach, mainExhaust3D.js) to sufit z liczb push / kick — ten test pilnuje lustra liczb,
// sprawdza sufit na PRAWDZIWYM push (strugi i iskry z dopalaczem, migotaniem, w ruchu) i decyzję kadru: ruch kadru
// względem dyszy, pamięć szczytu prędkości, oddalanie, wstrząs, kamera 3D i podzielony ekran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function stubCanvasDom() {
  const ctx2d = new Proxy({}, {
    get(target, key) {
      if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  globalThis.document = globalThis.document ?? {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d })
  };
}

const { MainExhaust3D, mainExhaustReach, MAIN_EXHAUST_REACH, createMainExhaustState, releaseMainExhaustState } = await import('../src/3d/mainExhaust3D.js');
const { MAIN_EXHAUST_TUNE: T, DEMO_NOZZLE_RADIUS } = await import('../src/data/engineFx.js');

test('sufity zasięgu = liczby push / kick (lustro — zmiana strugi albo iskier = zmiana JET_REACH / SPARK_SELF)', () => {
  const src = read('src/3d/mainExhaust3D.js');
  // rdzeń, ogon, uderzenie dopalacza: życie, długość końcowa, szerokości
  assert.match(src, /spawnJet\(x, y, dirX, dirY, 0\.09, 6 \* S, \(18 \+ 55 \* pw\) \* S \* L \* gl \* rand\(0\.85, 1\.15\),\n\s+\(4 \+ 6 \* pw\) \* S \* W, \(9 \+ 14 \* pw\) \* S \* W,/);
  assert.match(src, /spawnJet\(x, y, dirX, dirY, 0\.32, 12 \* S, \(40 \+ 75 \* pw\) \* S \* L \* rand\(0\.9, 1\.1\),\n\s+\(5 \+ 4 \* pw\) \* S \* W, \(9 \+ 10 \* pw\) \* S \* W,/);
  assert.match(src, /spawnJet\(p\.x, p\.y, p\.dirX, p\.dirY, 0\.55, 12 \* S, \(72 \+ 40 \* str\) \* S \* L, 9 \* S \* W, 20 \* S \* W,/);
  assert.match(src, /spawnJet\(p\.x, p\.y, p\.dirX, p\.dirY, 0\.40, 8 \* S, \(46 \+ 26 \* str\) \* S \* L, 16 \* S \* W, 36 \* S \* W,/);
  assert.match(src, /const gl = lerp\(1, g, 0\.15\);/);
  assert.match(src, /const g = fl \/ 0\.55;/);
  assert.match(src, /const ps = 0\.6 \+ 0\.4 \* Math\.min\(k, 1\.5\);/);
  assert.match(src, /const target = !state\.running \? 0 : \(state\.boosting \? Math\.max\(throttle, 1\) \* T\.boost : throttle\);/);
  // iskry: prędkość, życie, odsunięcie od wylotu
  assert.match(src, /spawnSpark\(state, x, y, dirX, dirY, S, ps, palIdx, a \/ rate, dt, 50, 200, rand\(0\.3, 0\.85\)\);/);
  assert.match(src, /spawnSpark\(state, p\.x, p\.y, p\.dirX, p\.dirY, S, 1, palIdx, 0, 0, 50, 220, rand\(0\.3, 1\.1\)\);/);
  assert.match(src, /const off = rand\(0, 3\) \* S;/);
  assert.match(src, /Fx3D\.spark\.spawn\(_pos, _vel, life, rand\(0\.5, 1\.5\),/, 'opór iskier ≤ 1,5 (SPARK_LAG)');
  // liczby z zadania: ogon 161,6 S·L przy dopalaczu ≈ 25,3 R × długość, iskry ≈ 38 R
  const R = MAIN_EXHAUST_REACH;
  assert.ok(Math.abs(R.JET_REACH[3] - 161.5625) < 1e-9, `ogon ${R.JET_REACH[3]}`);
  assert.ok(Math.abs(R.JET_REACH[3] / DEMO_NOZZLE_RADIUS - 25.24) < 0.01);
  assert.equal(R.JET_REACH[7], 18, 'pół szerokości uderzenia dopalacza');
  assert.ok(Math.abs(R.SPARK_SELF / DEMO_NOZZLE_RADIUS - 38.28) < 0.01, `iskry ${R.SPARK_SELF / DEMO_NOZZLE_RADIUS} R`);
  assert.equal(R.PW_MAX, T.boost * T.power);
  // monotoniczność: większa dysza, dłuższa struga, szybszy ruch, iskry — dalej
  const base = mainExhaustReach(20, 0.6, 2.2, 0, 0, false);
  assert.ok(Math.abs(base - (R.JET_REACH[3] * 0.6 + R.JET_REACH[4] * 2.2) * 20 / DEMO_NOZZLE_RADIUS) < 1e-9, 'ogon z pół szerokością');
  assert.ok(mainExhaustReach(40, 0.6, 2.2, 0, 0, false) > base);
  assert.ok(mainExhaustReach(20, 1.2, 2.2, 0, 0, false) > base);
  assert.ok(mainExhaustReach(20, 0.6, 2.2, 0, 0, true) > base);
  // ruch dyszy względem kadru × życie — najdalej sięga to, co żyje dłużej (uderzenie dopalacza 0,55 s)
  const J = R.JET_REACH;
  let moving = 0;
  for (let k = 0; k < 9; k += 3) moving = Math.max(moving, (J[k] * 0.6 + J[k + 1] * 2.2) * 20 / DEMO_NOZZLE_RADIUS + 1000 * J[k + 2]);
  assert.ok(Math.abs(mainExhaustReach(20, 0.6, 2.2, 1000, 0, false) - moving) < 1e-9, 'ruch × życie');
  assert.ok(moving >= base + 1000 * 0.32, 'co najmniej ogon w ruchu');
  assert.ok(mainExhaustReach(20, 0.6, 2.2, 1000, 500, true) > mainExhaustReach(20, 0.6, 2.2, 1000, 0, true), 'iskry w tyle za kadrem');
});

test('prawdziwy push: strugi i iskry (dopalacz, migotanie, ruch) nie wychodzą poza mainExhaustReach', async () => {
  stubCanvasDom();
  const { Core3D } = await import('../src/3d/core3d.js');
  const { Fx3D } = await import('../src/3d/fxParticles3D.js');
  Core3D.isInitialized = true;
  Core3D.scene = new THREE.Scene();
  try {
    assert.ok(Fx3D.ensure(), 'bank iskier');
    const mesh = MainExhaust3D.prewarm();
    assert.ok(mesh, 'pula strug');
    const R = 18, L = 0.9, W = 2.2;
    for (const v of [0, 400, 3000]) {
      const state = createMainExhaustState({ throttle: 1 });
      const p = { x: 0, y: 0, dirX: 0, dirY: -1, radius: R, throttle: 1, boost: false, lengthMul: L, widthMul: W,
        palette: 0, jetGain: 1, sparkMul: 1, pixelRadius: 99, dt: 0 };
      const jetReach = mainExhaustReach(R, L, W, 0, 0, false);
      const sparkReach = mainExhaustReach(R, L, W, v, v, true);
      let t = 0;
      let maxJet = 0;
      let maxSpark = 0;
      let jets = 0;
      let sparks = 0;
      const hist = [];   // pozycje wylotu na końcu klatek (czas, x) — iskra rodzi się względem wylotu z końca klatki
      for (let f = 0; f < 360; f++) {
        const dt = f % 5 === 0 ? 1 / 30 : 1 / 144;
        t += dt;
        p.x = v * t;
        p.dt = dt;
        p.boost = Math.floor(t / 0.6) % 2 === 1;   // wejścia dopalacza = uderzenia strugi (kick)
        // kolejność gry: bank iskier krokiem efektów, potem dysze (iskra rodzi się na końcu klatki — push)
        Fx3D.update(dt);
        MainExhaust3D.begin(0, 0, dt);
        MainExhaust3D.push(state, p);
        MainExhaust3D.flush(dt);
        hist.push([t, p.x]);
        // strugi: doklejone do wylotu — dalszy róg kwadu od wylotu tej klatki
        const n = mesh.geometry.instanceCount;
        const P = mesh.geometry.attributes.iPos.array;
        const D = mesh.geometry.attributes.iData.array;
        for (let i = 0; i < n; i++) {
          assert.ok(Math.abs(P[i * 2] + mesh.position.x - p.x) < 0.05 && Math.abs(P[i * 2 + 1]) < 0.05, 'struga przy wylocie');
          const d = Math.hypot(D[i * 4], D[i * 4 + 1] * 0.5);
          if (d > maxJet) maxJet = d;
          jets++;
        }
        // iskry: względem wylotu w chwili narodzin (wiek z banku), kadr stoi — ruch dyszy względem kadru = v
        const sp = Fx3D.spark.p;
        for (let i = 0; i < sp.count; i++) {
          const born = t - sp.f.t[i * 2];
          let k = hist.length - 1;
          while (k > 0 && hist[k][0] > born + 1e-9) k--;
          const d = Math.hypot(sp.f.pos[i * 3] - hist[k][1], sp.f.pos[i * 3 + 1]);
          if (d > maxSpark) maxSpark = d;
          sparks++;
        }
      }
      assert.ok(jets > 1000 && sparks > 500, `v ${v}: strugi ${jets}, iskry ${sparks}`);
      assert.ok(maxJet <= jetReach, `v ${v}: struga ${maxJet.toFixed(1)} ≤ ${jetReach.toFixed(1)}`);
      assert.ok(maxJet > 0.7 * jetReach, `v ${v}: sufit strugi nie za luźny (${(maxJet / jetReach).toFixed(2)})`);
      assert.ok(maxSpark <= sparkReach, `v ${v}: iskra ${maxSpark.toFixed(1)} ≤ ${sparkReach.toFixed(1)}`);
      // bez obrazu (pixelRadius = 0): moc i żar liczą się dalej, nowych strug ani iskier nie ma
      const before = MainExhaust3D.jetCount;
      const sparksBefore = Fx3D.spark.p.count;
      const power = state.power;
      p.pixelRadius = 0;
      p.throttle = 0.2;
      p.boost = false;
      MainExhaust3D.begin(0, 0, 1 / 60);
      MainExhaust3D.push(state, p);
      assert.equal(MainExhaust3D.jetCount, before, 'bez nowych strug');
      assert.equal(Fx3D.spark.p.count, sparksBefore, 'bez nowych iskier');
      assert.ok(state.power < power, 'moc goni ciąg dalej');
      releaseMainExhaustState(state);
      for (let f = 0; f < 120; f++) { MainExhaust3D.flush(1 / 60); Fx3D.update(1 / 60); }
    }
  } finally {
    MainExhaust3D.dispose();
    Fx3D.reset();
    Core3D.isInitialized = false;
    Core3D.scene = null;
  }
});

test('decyzja kadru: odległość za kadrem > zapas + zasięg; ruch kadru, szczyt prędkości, oddalanie, wstrząs', async () => {
  const { EngineNozzleInternals: I } = await import('../src/3d/engineVfxSystem.js');
  const fc = I.frameCtx;
  const saved = { ...fc };
  try {
    const cam = { x: 0, y: 0, zoom: 0.1 };
    const win = { camera: cam, CameraRig: { tune: { shakeMaxPx: 16 } }, splitScreenMode: false };
    const view = { x: 0, y: 0, drawHalfW: 9600, drawHalfH: 5400 };
    const frame = (dt = 1 / 60) => {
      fc.lod = true; fc.zoom = cam.zoom; fc.drawMargin = 96 / cam.zoom;
      view.x = cam.x; view.y = cam.y;
      I.prepareMainLod(view, dt, win);
    };
    frame(); frame();
    assert.equal(fc.mainLod, true);
    assert.ok(Math.abs(fc.viewPad - (960 + 320)) < 1e-9, 'zapas: margines pudła + 2 × wstrząs');
    const R = 20, L = 0.6, W = 2.2;
    const edge = 9600 + fc.viewPad + mainExhaustReach(R, L, W, 0, 0, false);
    // scena: y w górę — wylot na prawo od kadru
    assert.equal(I.mainJetsOffView(edge + 1, 0, R, L, W, false, 0, 0, 0), true, 'dalej niż zasięg — bez strug');
    assert.equal(I.mainJetsOffView(edge - 1, 0, R, L, W, false, 0, 0, 0), false, 'bliżej — strugi');
    assert.equal(I.mainJetsOffView(edge + 1, 0, R, L, W, true, 0, 0, 0), false, 'iskry sięgają dalej');
    assert.equal(I.mainJetsOffView(0, -(5400 + fc.viewPad + mainExhaustReach(R, L, W, 0, 0, false) + 1), R, L, W, false, 0, 0, 0), true, 'pod kadrem');
    assert.equal(I.mainJetsOffView(edge + 1, 0, R, L, W, false, -500, 0, 0), false, 'okręt leci ku kadrowi');
    assert.equal(I.mainJetsOffView(edge + 1, 0, R, L, W, false, 0, 0, 300), false, 'obrót okrętu (ω × ramię)');
    // kadr jedzie ku dyszy 1000 j/s (kamera gry bez wstrząsu) — okręt stoi
    for (let i = 0; i < 30; i++) { cam.x += 1000 / 60; frame(); }
    const far = cam.x + 9600 + fc.viewPad + mainExhaustReach(R, L, W, 0, 0, false) + 10;
    assert.equal(I.mainJetsOffView(far, 0, R, L, W, false, 0, 0, 0), false, 'kadr goni dyszę');
    assert.equal(I.mainJetsOffView(far, 0, R, L, W, false, 1000, 0, 0), true, 'okręt leci z kadrem — względem kadru stoi');
    // kadr staje: szczyt prędkości gaśnie (MAIN_LOD_HOLD 0,4 s) — po chwili znów bez strug
    frame();
    assert.equal(I.mainJetsOffView(far, 0, R, L, W, false, 0, 0, 0), false, 'tuż po zatrzymaniu — zapas zostaje');
    for (let i = 0; i < 180; i++) frame();
    assert.equal(I.mainJetsOffView(far, 0, R, L, W, false, 0, 0, 0), true, 'po 3 s — bez strug');
    // teleport kamery to cięcie, nie ruch
    cam.x += 5e6; frame();
    assert.ok(fc.viewGrow < 1e-6 && fc.viewVX === 0, 'cięcie kadru bez prędkości');
    // oddalanie: brzeg kadru ucieka ku dyszy
    for (let i = 0; i < 20; i++) { cam.zoom *= 0.98; frame(); }
    assert.ok(fc.viewGrow > 1000, `brzeg kadru przy oddalaniu ${fc.viewGrow.toFixed(0)} j/s`);
    // bez LOD: kamera 3D (perspektywa), podzielony ekran, brak kadru
    fc.lod = false; I.prepareMainLod(view, 1 / 60, win);
    assert.equal(fc.mainLod, false, 'kamera 3D');
    win.splitScreenMode = true; fc.lod = true; I.prepareMainLod(view, 1 / 60, win);
    assert.equal(fc.mainLod, false, 'podzielony ekran');
    win.splitScreenMode = false; I.prepareMainLod(null, 1 / 60, win);
    assert.equal(fc.mainLod, false, 'bez kadru');
  } finally {
    Object.assign(fc, saved);
  }
});

test('wpięcie: LOD tylko dla okrętów poza pudłem rysowania, przełącznik A/B, kadr z hexShips3D', () => {
  const src = read('src/3d/engineVfxSystem.js');
  assert.match(src, /const mainLod = frameCtx\.mainLod && entity\.__inDrawBox === false;/);
  assert.match(src, /if \(MainExhaust3D\.offscreenLod\) p\.pixelRadius = 0;\n\s+\}\n\s+\}\n\s+MainExhaust3D\.push\(item\.main, p\);/);
  // moc dyszy (EngineFrame: poświata na pyle, światła dysz na kadłubach, zapłon) z tego samego stanu — po push
  assert.match(src, /MainExhaust3D\.push\(item\.main, p\);\n\s+\/\/ moc strugi[^\n]*\n\s+EngineFrame\.nozzle\(/);
  assert.match(read('src/3d/hexShips3D.js'), /EngineVfxSystem\.update\(visibleVfx, cullInfo \? DRAW_BOX_MARGIN_PX \/ cameraZoom : Infinity, cullInfo\);/);
  assert.equal(MainExhaust3D.offscreenLod, true);
});
