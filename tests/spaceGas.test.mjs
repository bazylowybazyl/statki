// GAZ W OTWARTEJ PRZESTRZENI — port dema dema/gazy-transport-webgpu.html (docs/PLAN-gazy-kosmos.md).
// GK-1: rdzeń pola (src/3d/spaceGas/spaceGasSim.js) — WGSL budowany w Node, limity wiązań, „ten sam graf = ten sam kod”
// (pułapka 35), lustra CPU (szum, profil źródła), reguły okna (przesunięcie tylko w klatce z krokiem, przenikanie obrazu).
// node --test tests/spaceGas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { vec4, smoothstep } = await import('three/tsl');
const { SpaceGasSim, srcShapeCpu, SPACE_GAS_SUB, SPACE_GAS_SRC } = await import('../src/3d/spaceGas/spaceGasSim.js');
const { fbm, gnoiseCpu, fbmCpu } = await import('../src/3d/spaceGas/spaceGasNoise.js');
const { GAS_HULL_REC, GAS_HULL_MASK } = await import('../src/3d/gas/gasObstacleLayout.js');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const wgsl = (node) => { const b = renderer.backend.createNodeBuilder(node, renderer); b.build(); return b.computeShader; };

// pole dalekie testu: ławica z fbm (jak scena mgły dema)
const farEnv = (q, U) => {
  const w = q.sub(U.windOff).div(6500.0);
  return vec4(smoothstep(0.0, 0.3, fbm(w, 4)).mul(2.0), 0.0, 0.0, 0.0);
};
const makeSim = (o = {}) => new SpaceGasSim({ farEnv, N: 32, maxSources: 8, maxRocks: 4, maxHulls: 4, ...o });

test('GK-1: kernele budują się w Node; storage ≤ 7 na kernel (zapas do limitu 8), uniformy ≤ 12 na etap', () => {
  const sim = makeSim();
  const names = ['init', 'shift', 'shiftCopy', 'curl', 'advect', 'react', 'div', 'jacAB', 'jacBA', 'project0', 'project1'];
  const ks = sim.kernels();
  assert.equal(ks.length, names.length);
  ks.forEach((k, i) => {
    const code = wgsl(k);
    const storage = (code.match(/var<storage/g) || []).length;
    const uniforms = (code.match(/var<uniform>/g) || []).length;
    assert.ok(storage <= 7, `${names[i]}: ${storage} buforów storage`);
    assert.ok(uniforms <= 12, `${names[i]}: ${uniforms} buforów uniformów`);
  });
  // kAdvect i kProject — 7 (dawniej 8 z flagB)
  assert.equal((wgsl(sim.kAdvect).match(/var<storage/g) || []).length, 7);
  assert.equal((wgsl(sim.kProject[0]).match(/var<storage/g) || []).length, 7);
  assert.doesNotMatch(wgsl(sim.kAdvect), /FlagB/i, 'bez bufora flagB');
});

test('GK-1: ten sam graf = ten sam kod (pułapka 35: tylko gnoise z layoutem)', () => {
  const a = makeSim({ name: 'gazA' });
  const b = makeSim({ name: 'gazA' });
  for (const [ka, kb] of [[a.kAdvect, b.kAdvect], [a.kInit, b.kInit], [a.kShift, b.kShift]]) {
    assert.equal(wgsl(ka), wgsl(kb));
  }
  const code = wgsl(a.kAdvect);
  assert.deepEqual(code.match(/^fn \w+/gm), ['fn spaceGasNoise', 'fn main'], 'jedna funkcja z layoutem (szum), reszta wklejona');
  assert.doesNotMatch(code, /fn fbm/, 'fbm wklejana');
});

test('lustro CPU szumu: zakres i ciągłość', () => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const x = (i * 0.731) % 97 - 40, y = (i * 1.913) % 83 - 30;
    const v = gnoiseCpu(x, y);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    assert.ok(Math.abs(gnoiseCpu(x + 1e-4, y) - v) < 1e-2, 'ciągły');
  }
  assert.ok(lo > -1.5 && hi < 1.5 && hi - lo > 1.2);
  assert.equal(gnoiseCpu(3, 7), 0, 'węzeł siatki — 0');
  assert.ok(Math.abs(fbmCpu(1.3, 2.7, 5)) < 1.2);
});

test('lustro CPU profilu źródła: stożek, kula, front wybuchu', () => {
  const o = {};
  // stożek wzdłuż +x: na osi w połowie długości (przed zanikiem) — pełny profil, prędkość wzdłuż osi
  srcShapeCpu(200, 0, [0, 0, 1, 0], [1000, 100, 0.2, 2000], [8, 0, SPACE_GAS_SRC.cone, 300], o);
  assert.ok(o.prof > 0.99 && o.cmp > 0.99 && o.tx > 0 && Math.abs(o.ty) < 1e-9);
  assert.ok(o.near > 0.4 && o.near < 1, 'źródło gaśnie ku zasięgowi 300');
  srcShapeCpu(200, 300, [0, 0, 1, 0], [1000, 100, 0.2, 2000], [8, 0, 0, 300], o);
  assert.ok(o.prof < 0.05 && o.ty > 0, 'z boku — słabo, prędkość rozchyla pióropusz na boki');
  srcShapeCpu(-500, 0, [0, 0, 1, 0], [1000, 100, 0.2, 2000], [8, 0, 0, 300], o);
  assert.equal(o.prof, 0, 'za wylotem nic');
  // kula
  srcShapeCpu(0, 0, [0, 0, 1, 0], [200, 0, 0, 160], [2, 0, SPACE_GAS_SRC.ball, 0], o);
  assert.equal(o.prof, 1);
  // front: na pierścieniu pełny, prędkość na zewnątrz
  srcShapeCpu(500, 0, [0, 0, 1, 0], [500, 100, 0, 1400], [10, 0, SPACE_GAS_SRC.front, 0], o);
  assert.ok(o.prof === 1 && o.cmp === 1 && o.tx > 1399);
  srcShapeCpu(700, 0, [0, 0, 1, 0], [500, 100, 0, 1400], [10, 0, SPACE_GAS_SRC.front, 0], o);
  assert.equal(o.prof, 0);
});

test('okno: przesunięcie tylko w klatce z krokiem; start i teleport = init; przenikanie obrazu poprzedni → bieżący', () => {
  const sim = makeSim();
  const lists = [];
  const r = { compute(L) { lists.push(L.map((k) => k.name)); } };
  const C = sim.cell;
  // start: init + krok, obraz w teksturze 1, poprzedni = init (0)
  sim.frame(r, 0.001, 0, 0);
  assert.equal(lists.length, 1);
  assert.equal(lists[0][0], 'spaceGasInit');
  assert.ok(lists[0].includes('spaceGasProject1'));
  assert.equal(sim.image.cur, 1);
  assert.equal(sim.image.prev, 0);
  assert.equal(sim.ox, -16);
  // klatka bez kroku: kamera odjechała o 3 komórki — okno stoi, brak dispatchy
  sim.frame(r, 0.001, 3 * C, 0);
  assert.equal(lists.length, 1);
  assert.equal(sim.ox, -16, 'bez kroku okno stoi (drżenie dema 2026-10-13)');
  const w1a = sim.image.w1;
  // krok: przesunięcie razem z krokiem, nowy obraz w teksturze 0
  sim.frame(r, SPACE_GAS_SUB, 3 * C, 0);
  assert.deepEqual(lists[1].slice(0, 2), ['spaceGasShift', 'spaceGasShiftCopy']);
  assert.equal(sim.U.shift.value.x, 3);
  assert.equal(sim.ox, -13);
  assert.equal(sim.image.cur, 0);
  assert.equal(sim.image.origin[0].x, -13 * C, 'tekstura bieżąca — nowy róg');
  assert.equal(sim.image.origin[1].x, -16 * C, 'tekstura poprzednia — róg z jej kroku');
  assert.ok(w1a >= 0 && w1a <= 1 && sim.image.w1 >= 0 && sim.image.w1 <= 1);
  // teleport dalej niż okno = init
  sim.frame(r, SPACE_GAS_SUB, 1e6, 0);
  assert.equal(lists.at(-1)[0], 'spaceGasInit');
  // Jacobi: nieparzysta liczba iteracji kończy w prsB (rzut czyta prsB)
  const L = lists[1];
  assert.equal(L.filter((n) => n === 'spaceGasJacobiAB').length, 16);
  assert.equal(L.filter((n) => n === 'spaceGasJacobiBA').length, 15);
  // pauza: dt 0 — nic
  const n0 = lists.length;
  sim.frame(r, 0, 1e6, 0);
  assert.equal(lists.length, n0);
});

test('rozgrzanie sceny: × 4 czasu pola, najwyżej 8 kroków na klatkę', () => {
  const sim = makeSim();
  let steps = 0;
  const r = { compute(L) { steps += L.filter((n) => n.name.startsWith('spaceGasProject')).length; } };
  sim.requestReset(1);
  sim.frame(r, 0.05, 0, 0);
  assert.equal(steps, 8);
  assert.ok(sim.warmLeft < 1);
});

test('rozgrzewka: puste dispatche wszystkich kerneli z live = 0, potem live wraca', () => {
  const sim = makeSim();
  let seen = null, live = null;
  sim.warm({ compute(L) { seen = L.length; live = sim.U.live.value; } });
  assert.equal(seen, 11);
  assert.equal(live, 0);
  assert.equal(sim.U.live.value, 1);
  assert.match(wgsl(sim.kAdvect), /return;/, 'wyjście przy live = 0');
});

test('kadłub z rekordu GAS_HULL_REC: macierz świat → teksle, maska do pasma (tylko przy zmianie wersji)', () => {
  const sim = makeSim();
  const R = GAS_HULL_REC;
  const F = new Float64Array(R.stride);
  F[R.ax] = 1000; F[R.ay] = 500; F[R.ex] = 1; F[R.ey] = 0; F[R.fx] = 0; F[R.fy] = 1;
  F[R.x0] = -320; F[R.y0] = -80; F[R.tx] = 10; F[R.ty] = 5; F[R.vx] = 100; F[R.w] = 0.1; F[R.reach] = 330;
  F[R.uid] = 7; F[R.ver] = 1;
  for (let k = 0; k < GAS_HULL_MASK.words; k++) F[R.mask + k] = 0xffffffff >>> 0;
  sim.beginInputs();
  assert.ok(sim.addHullRecord(F, 0, R, 900, 400));
  const A = sim.U.hullA.array[0], B = sim.U.hullB.array[0];
  // punkt świata = kotwica → teksel (32, 16) (środek maski)
  const relx = 0, rely = 0;
  assert.equal(A.z * relx + A.w * rely + B.z, 32);
  assert.equal(B.x * relx + B.y * rely + B.w, 16);
  assert.equal(A.x, 100, 'kotwica względem kotwicy sceny');
  assert.equal(sim.hullMaskData[0], 255);
  assert.ok(sim._maskDirty);
  sim._maskDirty = false;
  sim.beginInputs();
  sim.addHullRecord(F, 0, R, 900, 400);
  assert.equal(sim._maskDirty, false, 'ta sama wersja maski — bez wysyłki');
});

// --- GK-2 / GK-3 / GK-5: wejście gry, mapy, warstwa, scena pasa ------------------------------------------------------

const { packSpaceGasFrame, createSpaceGasInputState, SPACE_GAS_IN, SPACE_GAS_ENV_RES } = await import('../src/game/spaceGasInput.js');
const { BeltGasScene } = await import('../src/3d/spaceGas/spaceGasBelt.js');
const { SpaceGasMaps } = await import('../src/3d/spaceGas/spaceGasMaps.js');
const { packSpaceGasBlock } = await import('../src/render/blocks/spaceGasBlock.js');

// sztuczne pole pasa: pierścień 90–110 tys. j. wokół Słońca (0, 0), lód rośnie z promieniem
function fakeField() {
  return {
    holeVersion: 0, calls: 0,
    rectTouchesBelt(x0, y0, x1, y1) { const r = Math.hypot((x0 + x1) / 2, (y0 + y1) / 2); return r > 80000 && r < 120000; },
    sampleMacro(x, y) {
      this.calls++;
      const r = Math.hypot(x, y);
      const w = r > 90000 && r < 110000 ? 1 : 0;
      return { weight: w, cluster: 0.5, ice: (r - 90000) / 20000, hole: 1, gas: 0 };
    },
    forEachRockInRect(band, x0, y0, x1, y1, minD, cb) {
      cb({ x: (x0 + x1) / 2 + 100, y: (y0 + y1) / 2, r: 300, type: 5, seed: 0.3 });
      cb({ x: (x0 + x1) / 2 - 100, y: (y0 + y1) / 2, r: 300, type: 1, seed: 0.7 });
    }
  };
}

test('GK-2: wejście pasa — obwiednia przesuwana przyrostowo, kotwica = Słońce, odgazowanie tylko skał z lodem', () => {
  const out = new Float64Array(SPACE_GAS_IN.size);
  const st = createSpaceGasInputState();
  const field = fakeField();
  const o = { dt: 1 / 60, camX: 100000, camY: 0, halfW: 3000, halfH: 1700, field, sunX: 0, sunY: 0, windowCells: 256, cell: 64, iceTypes: new Set([5]), time: 1 };
  packSpaceGasFrame(out, st, o);
  const I = SPACE_GAS_IN, G = SPACE_GAS_ENV_RES;
  assert.equal(out[I.active], 1);
  assert.equal(out[I.camX], 100000);
  assert.equal(field.calls, G * G, 'pierwsza klatka: cała siatka');
  assert.ok(Math.abs(out[I.sunX] + 1) < 1e-9, 'Słońce w −x');
  assert.equal(out[I.jets], 1, 'tylko skała z lodem');
  assert.ok(out[I.jetBase + 2] > 0.99, 'struga od Słońca');
  const ver = out[I.envVer];
  // mały ruch w obrębie próbki — bez próbkowania
  field.calls = 0;
  o.camX += 10;
  packSpaceGasFrame(out, st, o);
  assert.equal(field.calls, 0);
  assert.equal(out[I.envVer], ver);
  // przesunięcie o jedną próbkę — jedna nowa kolumna
  o.camX += out[I.envCell];
  packSpaceGasFrame(out, st, o);
  assert.equal(field.calls, G);
  assert.equal(out[I.envVer], ver + 1);
  // wyrwa (nowa wersja wyrw) — cała siatka od nowa
  field.calls = 0;
  field.holeVersion = 1;
  packSpaceGasFrame(out, st, o);
  assert.equal(field.calls, G * G);
  // poza pasem — nieaktywne, blok kopiuje sam nagłówek
  o.camX = 300000;
  packSpaceGasFrame(out, st, o);
  assert.equal(out[I.active], 0);
  const blk = new Float64Array(I.size).fill(7);
  packSpaceGasBlock(blk, out);
  assert.equal(blk[I.active], 0);
  assert.equal(blk[I.envBase], 7, 'bez gazu siatka nie jest kopiowana');
});

test('GK-3: mapy gazu i światła — WGSL w Node, storage ≤ 7, tekstury pisane nie są próbkowane w tym samym kernelu', () => {
  const scene = new BeltGasScene();
  const sim = new SpaceGasSim({ farEnv: (q, U) => scene.farEnv(q, U), N: 32 });
  const maps = new SpaceGasMaps(sim, scene, { w: 64, h: 36 });
  for (const k of maps.kernels()) {
    const b = renderer.backend.createNodeBuilder(k, renderer);
    b.build();
    assert.ok((b.computeShader.match(/var<storage/g) || []).length <= 7);
    const w = new Set(), r = new Set();
    for (const gr of b.getBindings()) for (const bd of gr.bindings) {
      if (!bd.texture || bd.constructor?.name === 'NodeSampler') continue;
      if (bd.store === true || bd.access === 'writeOnly') w.add(bd.texture.name); else r.add(bd.texture.name);
    }
    for (const t of w) assert.ok(!r.has(t), `${k.name}: ${t} pisana i próbkowana`);
  }
  // pole dalekie pasa w kernelu startu okna
  assert.match(wgsl(sim.kInit), /spaceGasNoise/);
  // mapa: środek na siatce tekseli
  const r = maps.place(1000.3, -50.2, 3000, 1700, {});
  const tx = maps.U.texel.value.x;
  assert.ok(Math.abs(r.cx / tx - Math.round(r.cx / tx)) < 1e-9);
});

test('GK-3: warstwa — dwie połowy w passie ortho, test głębi bez zapisu, dolna przed efektami, górna po nich', async () => {
  const { SpaceGasLayer, SPACE_GAS_ORDER } = await import('../src/3d/spaceGas/spaceGasLayer.js');
  const scene = new BeltGasScene();
  const sim = new SpaceGasSim({ farEnv: (q, U) => scene.farEnv(q, U), N: 32 });
  const maps = new SpaceGasMaps(sim, scene, { w: 64, h: 36 });
  const layer = new SpaceGasLayer(maps, { grid: null });
  for (const m of layer.warmupMeshes()) {
    assert.equal(m.material.depthTest, true);
    assert.equal(m.material.depthWrite, false);
    assert.equal(m.layers.mask, 1, 'warstwa 0 — pass ortho');
  }
  assert.ok(SPACE_GAS_ORDER.lower < 0 && SPACE_GAS_ORDER.upper > 55, 'efekty gry mają 0…55');
  layer.place(8e6, -3e6, 1000, 500);
  assert.equal(layer.lower.position.y, 3e6, 'scena: −y gry');
  assert.ok(layer.lower.position.z < -10.4 && layer.upper.position.z > 15);
});

test('GK-4: pył gazu — kernele w Node (storage ≤ 7), pozycje względem rogu okna, przesunięcie okna przesuwa drobiny', async () => {
  const { SpaceGasDust, SPACE_GAS_DUST_ORDER } = await import('../src/3d/spaceGas/spaceGasDust.js');
  const scene = new BeltGasScene();
  const sim = new SpaceGasSim({ farEnv: (q, U) => scene.farEnv(q, U), N: 32 });
  const maps = new SpaceGasMaps(sim, scene, { w: 64, h: 36 });
  const dust = new SpaceGasDust(sim, maps, { count: 256 });
  for (const k of dust.kernels()) {
    const code = wgsl(k);
    assert.ok((code.match(/var<storage/g) || []).length <= 7, k.name);
  }
  assert.equal(dust.mesh.geometry.instanceCount, 256);
  assert.ok(SPACE_GAS_DUST_ORDER > -45 && SPACE_GAS_DUST_ORDER < 0, 'po dolnej połowie gazu, przed efektami');
  const calls = [];
  const r = { compute(L) { calls.push(Array.isArray(L) ? L.map((k) => k.name) : [L.name]); } };
  const rect = { cx: 0, cy: 0, w: 3000, h: 1700 };
  sim.ox = 10; sim.oy = 20;
  dust.frame(r, 1 / 60, null, 1e6, 0, rect, 1);
  assert.deepEqual(calls[0], ['spaceGasDustInit', 'spaceGasDustStep'], 'pierwsza klatka — start drobin');
  assert.equal(dust.mesh.position.x, 1e6 + 10 * sim.cell, 'siatka w rogu okna (kotwica + róg)');
  assert.equal(dust.mesh.position.y, -(20 * sim.cell), 'scena: −y gry');
  sim.ox = 13;
  dust.frame(r, 1 / 60, null, 1e6, 0, rect, 1);
  assert.deepEqual(calls[1], ['spaceGasDustStep']);
  assert.equal(dust.U.shift.value.x, -3 * sim.cell, 'okno o 3 komórki w prawo — drobiny o tyle w lewo względem rogu');
  dust.frame(r, 1 / 60, null, 1e6, 0, rect, 1);
  assert.equal(dust.U.shift.value.x, 0);
});

test('E3: gaz rzednie w wyrwie — obwiednia z sampleMacro × hole, nowa wersja wyrw = cała siatka od nowa', async () => {
  const { AsteroidBeltField } = await import('../src/game/asteroidBeltField.js');
  const AU = 42253.52;
  const field = new AsteroidBeltField({ auToWorld: AU });
  let p = null;
  for (let i = 0; i < 3600; i++) {
    const a = (i / 3600) * Math.PI * 2;
    const x = Math.cos(a) * 38.6 * AU, y = Math.sin(a) * 38.6 * AU;
    const m = field.sampleMacro(x, y);
    if (!p || m.cluster > p.c) p = { x, y, c: m.cluster };
  }
  const I = SPACE_GAS_IN, G = SPACE_GAS_ENV_RES;
  const out = new Float64Array(I.size);
  const st = createSpaceGasInputState();
  const o = { dt: 1 / 60, camX: p.x, camY: p.y, halfW: 3000, halfH: 1700, field, sunX: 0, sunY: 0, windowCells: 256, cell: 64 };
  // próbka siatki najbliższa punktowi (x, y) świata
  const envAt = (x, y) => {
    const c = out[I.envCell];
    const i = Math.round((x - out[I.envX0]) / c), j = Math.round((y - out[I.envY0]) / c);
    return out[I.envBase + (j * G + i) * 2];
  };
  packSpaceGasFrame(out, st, o);
  assert.equal(out[I.active], 1, 'rdzeń pola — gaz');
  const before = envAt(p.x, p.y), far = envAt(p.x + 7000, p.y + 7000);
  assert.ok(before > 0.3, `obwiednia w rdzeniu ${before}`);
  const ver = out[I.envVer];
  field.setHoles([{ id: 'w1', x: p.x, y: p.y, r: 5000, depth: 1 }]);
  packSpaceGasFrame(out, st, o);
  assert.ok(out[I.envVer] > ver, 'nowa wersja wyrw — nowa siatka (i wysyłka tekstury)');
  assert.ok(envAt(p.x, p.y) < before * 0.05, `środek wyrwy: ${envAt(p.x, p.y)} (było ${before})`);
  assert.ok(Math.abs(envAt(p.x + 7000, p.y + 7000) - far) < 1e-9, 'poza wyrwą bez zmian');
  // źródło gazu pola (`gas` — E3 zostawiło miejsce) dokłada gęstość także w wyrwie
  const orig = field.sampleMacro.bind(field);
  field.sampleMacro = (x, y) => { const m = orig(x, y); m.gas = 0.5; return m; };
  field.holeVersion++;
  packSpaceGasFrame(out, st, o);
  assert.ok(Math.abs(envAt(p.x, p.y) - 0.5) < 0.05, 'gaz pola w wyrwie');
});

test('GK-5b: wybuchy (pierścień GameBlasts), pociski i raster olbrzyma w wejściu; raster w polu', async () => {
  const { createExplosionEvents } = await import('../src/game/explosionEvents.js');
  const writer = { ring: { data: new Float64Array(64) }, str: () => 0, _begin: () => 0, _commit() {} };
  const ev = createExplosionEvents(writer);
  ev.ready = true;
  const I = SPACE_GAS_IN;
  const out = new Float64Array(I.size);
  const st = createSpaceGasInputState();
  const field = fakeField();
  // olbrzym: koło r = 2000 j. 1500 j. na prawo od kamery
  const gx = 101500, gy = 0;
  const giants = { entries: [{ x: gx, y: gy, halfX: 2000, halfY: 2000, giant: { ready: true, band: 0, sampleWorld: (x, y) => Math.hypot(x - gx, y - gy) - 2000 } }] };
  const o = { dt: 1 / 60, camX: 100000, camY: 0, halfW: 3000, halfH: 1700, field, sunX: 0, sunY: 0, windowCells: 256, cell: 64,
    blasts: ev, giants, bullets: [{ x: 100200, y: 50, vx: 3000, vy: 0 }, { x: 900000, y: 0, vx: 3000, vy: 0 }] };
  ev.blast({ x: 999, y: 999, size: 280 });   // przed pierwszą klatką — pomijany
  packSpaceGasFrame(out, st, o);
  assert.equal(out[I.blasts], 0);
  const samples = st.rasterSamples;
  ev.blast({ x: 100100, y: 20, size: 560 });
  packSpaceGasFrame(out, st, o);
  assert.equal(out[I.blasts], 1);
  assert.equal(out[I.blastBase], 100100, 'względem kotwicy (Słońce 0, 0)');
  assert.ok(Math.abs(out[I.blastBase + 4] - 1.2 * Math.SQRT2) < 1e-9, 'życie × √(560 / 280)');
  assert.equal(out[I.bolts], 1, 'pocisk poza oknem pominięty');
  assert.ok(out[I.boltBase + 2] > 0.99 && out[I.boltBase + 4] === 3000);
  assert.equal(out[I.rasterOn], 1);
  assert.ok(samples > 0 && samples < 128 * 128, `próbki tylko w pudle olbrzyma (${samples})`);
  // bit w środku olbrzyma zapalony, przy kamerze zgaszony
  const tex = out[I.rasterTexel];
  const bit = (x, y) => {
    const k = Math.floor((y - out[I.rasterY0]) / tex) * 128 + Math.floor((x - out[I.rasterX0]) / tex);
    return (out[I.rasterBase + (k >>> 5)] >>> (k & 31)) & 1;
  };
  assert.equal(bit(gx, gy), 1);
  assert.equal(bit(97000, 0), 0, 'poza olbrzymem');
  // ruch w obrębie teksla — bez próbkowania; wybuch wygasa po życiu
  o.camX += 10;
  packSpaceGasFrame(out, st, o);
  assert.equal(st.rasterSamples, 0);
  o.dt = 2;
  packSpaceGasFrame(out, st, o);
  assert.equal(out[I.blasts], 0, 'wybuch po życiu');
  // render: raster do tekstury pola tylko przy nowej wersji
  const scene = new BeltGasScene();
  const sim = new SpaceGasSim({ farEnv: (q, U) => scene.farEnv(q, U), N: 32 });
  const v0 = sim.rasterTex.version;
  sim.setRaster(out, I);
  assert.ok(sim.rasterTex.version > v0 && sim.U.raster.value.w === 1);
  const v1 = sim.rasterTex.version;
  sim.setRaster(out, I);
  assert.equal(sim.rasterTex.version, v1, 'ta sama wersja — bez wysyłki');
  assert.match(wgsl(sim.kAdvect), /spaceGasRaster|texture/);
  assert.equal((wgsl(sim.kAdvect).match(/var<storage/g) || []).length, 7, 'raster jako tekstura — bufory storage bez zmian');
});

// --- 2026-10-29: drżenie i oddalenie (zgłoszenie 5120 × 1440 @ 240 Hz: „gazy i mgła w polu asteroid mocno drżą”, „przy
// oddaleniu nie widać wypychania, ogon szybko znika”) — zegar gry, ciśnienie przy przesunięciu okna, drabina teksla map,
// okno przy okręcie, siatka obwiedni pod mapą, zanik niezależny od proporcji kadru ----------------------------------------

const { SPACE_GAS_MAX_SUB } = await import('../src/3d/spaceGas/spaceGasSim.js');
const { placeGasWindow, SPACE_GAS_INPUT_TUNE } = await import('../src/game/spaceGasInput.js');
const { spaceGasTexelLevel, SPACE_GAS_TEXEL_STEPS } = await import('../src/3d/spaceGas/spaceGasMaps.js');
const { SPACE_GAS_MAP_MARGIN, SPACE_GAS_SCENE } = await import('../src/3d/spaceGas/spaceGasLayout.js');

test('zegar gry w polu: krok pola = krok fizyki (pominięte strony dochodzą), obraz w chwili renderu, pauza i cofnięty zegar bez kroków', () => {
  const sim = makeSim();
  let steps = 0;
  const r = { compute(L) { steps += L.filter((k) => k.name.startsWith('spaceGasProject')).length; } };
  const S = SPACE_GAS_SUB;
  const w = () => (sim.image.cur === 1 ? sim.image.w1 : 1 - sim.image.w1);   // waga bieżącego kroku w obrazie
  const clk = { sim: 600 * S, render: 600 * S - 0.5 * S };
  sim.frame(r, 0.004, 0, 0, 0, 0, clk);
  assert.equal(steps, 1, 'start okna: init + krok');
  // 240 Hz: klatki bez kroku fizyki — bez kroków pola, obraz w chwili renderu kadłubów (alfa)
  for (const a of [0.25, 0.5, 0.75]) {
    clk.render = clk.sim - (1 - a) * S;
    sim.frame(r, S / 4, 0, 0, 0, 0, clk);
    assert.ok(Math.abs(w() - a) < 1e-9, `obraz ${w()} ≠ alfa ${a}`);
    assert.ok(Math.abs(sim.acc - a * S) < 1e-12, 'acc = alfa · krok (faza wobec fizyki stała)');
  }
  assert.equal(steps, 1);
  clk.sim += S; clk.render = clk.sim - S;
  sim.frame(r, S / 4, 0, 0, 0, 0, clk);
  assert.equal(steps, 2, 'krok fizyki → krok pola');
  assert.ok(Math.abs(w()) < 1e-9, 'alfa 0 — obraz w poprzednim kroku');
  // worker pominął strony: fizyka o 2 kroki dalej → 2 kroki pola (dawniej dt jednej strony — czas przepadał)
  clk.sim += 2 * S; clk.render = clk.sim - 0.4 * S;
  sim.frame(r, 0.004, 0, 0, 0, 0, clk);
  assert.equal(steps, 4);
  // sufit kroków na klatkę (przestój)
  clk.sim += 10 * S; clk.render = clk.sim - 0.5 * S;
  sim.frame(r, 0.1, 0, 0, 0, 0, clk);
  assert.equal(steps, 4 + SPACE_GAS_MAX_SUB);
  // pauza: sim stoi, render = sim — bez kroków, obraz w bieżącym kroku
  clk.render = clk.sim;
  sim.frame(r, 0, 0, 0, 0, 0, clk);
  assert.equal(steps, 4 + SPACE_GAS_MAX_SUB);
  assert.equal(w(), 1);
  // zegar cofnięty (nowa sesja gry) — bez kroku, dalej od nowego miejsca
  clk.sim = 3 * S; clk.render = 3 * S;
  sim.frame(r, 0.004, 0, 0, 0, 0, clk);
  assert.equal(steps, 4 + SPACE_GAS_MAX_SUB);
  clk.sim += S; clk.render = clk.sim - 0.5 * S;
  sim.frame(r, 0.004, 0, 0, 0, 0, clk);
  assert.equal(steps, 5 + SPACE_GAS_MAX_SUB);
  // rozgrzanie sceny: × 4 kroków na krok fizyki
  sim.requestReset(1);
  sim.frame(r, 0.004, 0, 0, 0, 0, clk);
  const s0 = steps;
  clk.sim += S; clk.render = clk.sim - 0.5 * S;
  sim.frame(r, S, 0, 0, 0, 0, clk);
  assert.equal(steps - s0, 4);
});

test('przesunięcie okna przenosi ciśnienie: kShift → velB.z → kShiftCopy → prsB (po 7 buforów storage), A/B shiftPrs', () => {
  const sim = makeSim();
  const shift = wgsl(sim.kShift), copy = wgsl(sim.kShiftCopy);
  assert.equal((shift.match(/var<storage/g) || []).length, 7);
  assert.equal((copy.match(/var<storage/g) || []).length, 7);
  assert.match(shift, /spaceGasPrsB/, 'kShift czyta ciśnienie komórki źródłowej');
  assert.match(copy, /spaceGasPrsB/, 'kShiftCopy pisze ciśnienie');
  assert.equal(sim.tune.shiftPrs, 1);
  assert.equal(sim.ST.shiftPrs.value, 1);
  sim.tune.shiftPrs = 0;
  sim.syncTune();
  assert.equal(sim.ST.shiftPrs.value, 0, 'A/B: od zera jak dawniej');
});

test('okno pola przy okręcie: przy oddaleniu okręt i ślad w oknie (okno w mapie), domyślny kadr — okno obejmuje kadr, ciągłe', () => {
  const T = SPACE_GAS_INPUT_TUNE;
  const halfWin = 256 * 64 / 2;
  const W = 5120, H = 1440, v = 507;
  const b = Math.min(T.wakeFrac * halfWin, v * T.wakeSec);
  const st = { wakeX: 0, wakeY: 0 };
  // kamera wyprzedza okręt o ~880 px (rig, nawigacja); sprężyna ustalona
  const place = (zoom) => {
    const hw = W / 2 / zoom, hh = H / 2 / zoom, camX = 0.344 * W / 2 / zoom;
    const ship = { on: true, x: 0, y: 0, vx: v, vy: 0 };
    st.wakeX = 0; st.wakeY = 0;
    for (let i = 0; i < 1200; i++) placeGasWindow(st, ship, camX, 0, hw, hh, halfWin, 1 / 60, {});
    return { ...placeGasWindow(st, ship, camX, 0, hw, hh, halfWin, 1 / 60, {}), hw, hh, camX };
  };
  // domyślny kadr Atlasa (0,341): okno obejmuje mapę kadru (× 1,08) — jak dawniej (statek 2,6 km za środkiem)
  {
    const p = place(0.341);
    const m = p.hw * SPACE_GAS_MAP_MARGIN, mh = p.hh * SPACE_GAS_MAP_MARGIN;
    assert.ok(p.x - halfWin <= p.camX - m + 1e-6 && p.x + halfWin >= p.camX + m - 1e-6, 'kadr w oknie (x)');
    assert.ok(p.y - halfWin <= -mh + 1e-6 && p.y + halfWin >= mh - 1e-6, 'kadr w oknie (y)');
  }
  // oddalenie: dawniej statek wypadał z okna od ~0,107, ślad w oknie: 3,8 km (0,2), 2,3 km (0,15), 0,9 km (0,12)
  for (const zoom of [0.2, 0.15, 0.12, 0.0667, 0.035]) {
    const p = place(zoom);
    assert.ok(p.lead, `zoom ${zoom}: okręt prowadzi okno`);
    assert.ok(Math.abs(p.x) < halfWin - 600, `zoom ${zoom}: okręt w oknie (środek ${Math.round(p.x)})`);
    const rear = halfWin - p.x;              // ślad w oknie za rufą (okręt w 0, lot w +x)
    const frameRear = p.hw - p.camX;         // do tylnej krawędzi kadru
    assert.ok(rear >= Math.min(frameRear, halfWin + b) - 1, `zoom ${zoom}: ślad w oknie ${Math.round(rear)} j. (kadr ${Math.round(frameRear)})`);
    const m = p.hw * SPACE_GAS_MAP_MARGIN;
    assert.ok(m <= halfWin || (p.x - halfWin >= p.camX - m - 1e-6 && p.x + halfWin <= p.camX + m + 1e-6), `zoom ${zoom}: okno w mapie`);
  }
  // ciągłe w przejściu okno = mapa (luz 0)
  const atHw = (hw) => placeGasWindow({ wakeX: -b, wakeY: 0 }, { on: true, x: 0, y: 0, vx: v, vy: 0 }, 2000, 0, hw, 800, halfWin, 0, {}).x;
  const h0 = halfWin / SPACE_GAS_MAP_MARGIN;
  assert.ok(Math.abs(atHw(h0 * 0.999) - atHw(h0 * 1.001)) < 20);
  assert.equal(atHw(h0), 2000, 'okno = mapa: środek na kamerze');
  // bez okrętu (RTS, kamera fabuły), okręt poza kadrem, A/B followShip — kamera (bez wstrząsu)
  assert.equal(placeGasWindow({ wakeX: 0, wakeY: 0 }, null, 3000, -500, 40000, 11000, halfWin, 1 / 60, {}).x, 3000);
  assert.equal(placeGasWindow({ wakeX: 0, wakeY: 0 }, { on: true, x: 90000, y: 0, vx: v, vy: 0 }, 3000, -500, 40000, 11000, halfWin, 1 / 60, {}).lead, false);
  try {
    T.followShip = false;
    assert.equal(placeGasWindow({ wakeX: 0, wakeY: 0 }, { on: true, x: 0, y: 0, vx: v, vy: 0 }, 3000, -500, 40000, 11000, halfWin, 1 / 60, {}).x, 3000);
  } finally { T.followShip = true; }
  // sprężyna: narasta szybko, gaśnie wolno (postój — ślad zostaje w oknie), pauza trzyma
  const s2 = { wakeX: 0, wakeY: 0 };
  const ship = { on: true, x: 0, y: 0, vx: v, vy: 0 };
  for (let i = 0; i < 60; i++) placeGasWindow(s2, ship, 0, 0, 40000, 11000, halfWin, 1 / 60, {});
  assert.ok(-s2.wakeX > b * 0.6 && -s2.wakeX < b, `po 1 s: ${s2.wakeX}`);
  const held = s2.wakeX;
  placeGasWindow(s2, ship, 0, 0, 40000, 11000, halfWin, 0, {});
  assert.equal(s2.wakeX, held, 'pauza');
  ship.vx = 0;
  for (let i = 0; i < 60; i++) placeGasWindow(s2, ship, 0, 0, 40000, 11000, halfWin, 1 / 60, {});
  assert.ok(-s2.wakeX > -held * 0.8, `postój 1 s: przesunięcie gaśnie wolno (${s2.wakeX})`);
});

test('wejście: zegar gry i środek okna w nagłówku; siatka obwiedni obejmuje okno i mapę kadru przy oddaleniu (krok × 2^k, histereza)', () => {
  const I = SPACE_GAS_IN, G = SPACE_GAS_ENV_RES;
  const out = new Float64Array(I.size);
  const st = createSpaceGasInputState();
  const field = fakeField();
  const base = { dt: 1 / 60, camX: 100000, camY: 0, halfW: 7507, halfH: 2111, field, sunX: 0, sunY: 0, windowCells: 256, cell: 64, simTime: 12.5, renderTime: 12.49 };
  packSpaceGasFrame(out, st, base);
  assert.equal(out[I.simTime], 12.5);
  assert.equal(out[I.renderTime], 12.49);
  assert.equal(out[I.envCell], 704, 'domyślny kadr: krok siatki okna jak dawniej');
  assert.equal(out[I.winX], 100000, 'bez okrętu: okno przy kamerze');
  assert.ok(I.winY < I.header && I.renderTime < I.header, 'zegar i okno w nagłówku (blok kopiuje go także bez gazu)');
  packSpaceGasFrame(out, st, { ...base, simTime: undefined, renderTime: undefined });
  assert.ok(Number.isNaN(out[I.simTime]) && Number.isNaN(out[I.renderTime]), 'bez zegara — NaN (render liczy z dt)');
  // kamera bez wstrząsu: wstrząs nie rusza okna
  packSpaceGasFrame(out, st, { ...base, camX: 100090, camNsX: 100000, camNsY: 0 });
  assert.equal(out[I.winX], 100000);
  // oddalenie 5120 × 1440 przy zoomie 0,0667 z okrętem: siatka obejmuje okno (z zapasem) i mapę kadru
  const z = 0.0667, hw = 2560 / z, hh = 720 / z;
  const o = { ...base, halfW: hw, halfH: hh, camNsX: 100000, camNsY: 0, focusOn: true, focusX: 100000 - 13200, focusY: 0, focusVX: 507, focusVY: 0 };
  for (let i = 0; i < 240; i++) packSpaceGasFrame(out, st, o);
  const c = out[I.envCell];
  const inGrid = (x, y) => x >= out[I.envX0] && x <= out[I.envX0] + (G - 1) * c && y >= out[I.envY0] && y <= out[I.envY0] + (G - 1) * c;
  const wx = out[I.winX], wy = out[I.winY], h = 128 * 64;
  assert.ok(c > 704 && Math.log2(c / 704) % 1 === 0, `krok × 2^k (${c})`);
  for (const [x, y] of [[wx - h * 1.1, wy - h * 1.1], [wx + h * 1.1, wy + h * 1.1],
    [100000 - hw * 1.2, -hh * 1.2], [100000 + hw * 1.2, hh * 1.2]]) assert.ok(inGrid(x, y), `punkt ${Math.round(x)}, ${Math.round(y)} w siatce`);
  assert.ok(Math.abs(wx - (100000 - 13200)) < h, 'okręt w oknie');
  // przybliżenie: krok wraca do kroku okna (histereza: dopiero wyraźnie mniejsza rozpiętość)
  packSpaceGasFrame(out, st, { ...o, halfW: hw * 0.95, halfH: hh * 0.95 });
  assert.equal(out[I.envCell], c, 'histereza');
  packSpaceGasFrame(out, st, { ...base });
  assert.equal(out[I.envCell], 704);
  // A/B: dawna siatka okna
  try {
    SPACE_GAS_INPUT_TUNE.envCover = false;
    packSpaceGasFrame(out, st, o);
    assert.equal(out[I.envCell], 704);
  } finally { SPACE_GAS_INPUT_TUNE.envCover = true; }
});

test('drabina teksla map: przy ruchu zoomu siatka tekseli stoi w świecie (przeskok tylko na stopniu), mapa pokrywa kadr, zanik faktury ciągły', () => {
  // stopień: najmniejszy 2^(j/8) ≥ potrzebny; w dół dopiero z histerezą
  for (const need of [3.7, 21.09, 10.55, 64, 205.7]) {
    const j = spaceGasTexelLevel(NaN, need);
    assert.ok(2 ** (j / SPACE_GAS_TEXEL_STEPS) >= need - 1e-9 && 2 ** ((j - 1) / SPACE_GAS_TEXEL_STEPS) < need);
    assert.equal(spaceGasTexelLevel(j, need * 0.99), j, 'histereza');
    assert.equal(spaceGasTexelLevel(j, need * 1.2), spaceGasTexelLevel(NaN, need * 1.2), 'w górę od razu');
  }
  const scene = new BeltGasScene();
  const sim = new SpaceGasSim({ farEnv: (q, U) => scene.farEnv(q, U), N: 32 });
  const maps = new SpaceGasMaps(sim, scene, { w: 768, h: 432 });
  const camX = 1.6e6 + 0.37, camY = -2.3e5 + 0.11;   // pas: kotwica = Słońce, ~76 tys. tekseli od kamery
  const at = (zoom) => {
    const r = maps.place(camX, camY, 2560 / zoom, 720 / zoom, {});
    return { tx: maps.U.texel.value.x, ty: maps.U.texel.value.y, mx: maps.U.min.value.x, my: maps.U.min.value.y, r, lod: maps.U.lodTexel.value };
  };
  const a = at(0.341);
  assert.ok(a.r.w / 2 >= 2560 / 0.341 * SPACE_GAS_MAP_MARGIN - 1e-6 && a.r.w / 2 <= 2560 / 0.341 * SPACE_GAS_MAP_MARGIN * 1.13, 'mapa pokrywa kadr');
  assert.ok(a.r.h / 2 >= 720 / 0.341 * SPACE_GAS_MAP_MARGIN - 1e-6);
  // sprężyna zoomu po ząbku kółka: kolejne klatki o < 1% — ten sam teksel i ta sama siatka tekseli (dawniej 100% klatek
  // z ruchem zoomu przesuwało próbkowanie o > ¼ teksla)
  let lod = a.lod;
  for (const zz of [0.3405, 0.3401, 0.3398, 0.3402, 0.3409]) {
    const b = at(zz);
    assert.equal(b.tx, a.tx);
    assert.equal(b.ty, a.ty);
    assert.equal(b.mx, a.mx);
    assert.equal(b.my, a.my);
    assert.notEqual(b.lod, lod, 'teksel zaniku faktury idzie za kadrem (ciągły)');
    lod = b.lod;
  }
  assert.ok(Math.abs(at(0.2).lod - 2560 / 0.2 * SPACE_GAS_MAP_MARGIN * 2 / 768) < 1e-9);
  // A/B: teksel wprost z kadru (dawniej)
  maps.ladder = false;
  const o1 = at(0.341), o2 = at(0.3405);
  assert.ok(Math.abs(o1.tx - 2560 / 0.341 * SPACE_GAS_MAP_MARGIN * 2 / 768) < 1e-9);
  assert.notEqual(o1.tx, o2.tx);
});

test('SpaceGas._update: dt z zegara renderu przez pominięte strony, środek okna z wejścia, dysze spoza okna pominięte; zanik 32:9', async () => {
  const { SpaceGas, SPACE_GAS_TUNE, spaceGasViewFade } = await import('../src/3d/spaceGas/spaceGas.js');
  const { EngineFrame } = await import('../src/3d/engineFrame.js');
  const I = SPACE_GAS_IN;
  const calls = [];
  const g = Object.create(Object.getPrototypeOf(SpaceGas));
  const sim = {
    N: 256, cell: 64, srcN: 0, hullN: 0, image: { valid: true }, stats: { resets: 0, substeps: 0, dispatches: 0 }, src: [],
    beginInputs() { this.srcN = 0; this.src.length = 0; }, addSource(...a) { this.src.push(a); this.srcN++; return true; },
    setRaster() {}, requestReset() {},
    frame(r, dt, cx, cy, wx, wy, clock) { calls.push({ dt, cx, cy, clock: clock ? { ...clock } : null }); }
  };
  Object.assign(g, {
    input: new Float64Array(I.size), obstacles: null, tune: { ...SPACE_GAS_TUNE },
    _serial: -1, _scene: SPACE_GAS_SCENE.belt, _rect: { cx: 0, cy: 0, w: 1, h: 1 }, _warpFade: 1, _renderTime: NaN, _clk: { sim: 0, render: 0 },
    stats: { ...SpaceGas.stats }, dust: null, looks: {}, scene: { look: null, setEnvelope() {} }, sim,
    layer: { L: { fade: { value: 1 } }, setVisible() {}, place() {} },
    maps: { U: { sunDir: { value: { set() {} } }, simOn: { value: 0 }, amount: { value: 1 } }, place(cx, cy, hw, hh, out) { return out; }, kernels() { return []; } }
  });
  const IN = g.input;
  IN[I.active] = 1; IN[I.scene] = SPACE_GAS_SCENE.belt; IN[I.halfW] = 2560 / 0.035; IN[I.halfH] = 720 / 0.035;
  IN[I.camX] = 9000; IN[I.camY] = 0; IN[I.winX] = 5000; IN[I.winY] = -300;
  const page = (k, skipped = false) => {
    IN[I.serial] = k; IN[I.renderTime] = k / 240; IN[I.simTime] = Math.floor(k / 4) / 60; IN[I.dt] = 1 / 240;
    if (!skipped) g._update({ renderer: { compute() {} } });
  };
  page(1); page(2); page(3, true); page(4, true); page(5);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].dt, 0, 'pierwsza strona — bez poprzedniej');
  assert.ok(Math.abs(calls[1].dt - 1 / 240) < 1e-12);
  assert.ok(Math.abs(calls[2].dt - 3 / 240) < 1e-12, 'pominięte strony workera nie gubią czasu (dawniej 1/240)');
  assert.deepEqual(calls[2].clock, { sim: 1 / 60, render: 5 / 240 }, 'krok pola z zegara fizyki');
  assert.equal(calls[2].cx, 5000, 'środek okna z wejścia, nie kamera');
  assert.equal(calls[2].cy, -300);
  assert.equal(g.stats.viewFade, 1, 'minZoom na 32:9 — gaz pełny');
  assert.equal(g.stats.viewFade, spaceGasViewFade(IN[I.halfW], IN[I.halfH], SPACE_GAS_TUNE.fadeView));
  // A/B: bez zegara — dt tej strony (dawniej)
  g.tune.clock = false;
  page(6); page(7, true); page(8);
  assert.ok(Math.abs(calls.at(-1).dt - 1 / 240) < 1e-12 && calls.at(-1).clock === null);
  g.tune.clock = true;
  // dysze: stożek w oknie — źródło; stożek daleko poza oknem — pominięty (nie zabiera budżetu 64)
  try {
    EngineFrame.count = 2;
    for (let k = 0; k < 2; k++) { EngineFrame.power[k] = 1; EngineFrame.spread[k] = 80; EngineFrame.dirX[k] = 1; EngineFrame.dirY[k] = 0; }
    EngineFrame.x[0] = 5000; EngineFrame.y[0] = 300;            // scena: y = −y gry; kotwica 0
    EngineFrame.x[1] = 5000 + 60000; EngineFrame.y[1] = 300;
    page(9);
    assert.equal(sim.src.length, 1);
    assert.equal(g.stats.jetsSkipped, 1);
  } finally { EngineFrame.count = 0; }
  // A/B drabiny teksla z SpaceGas.tune (mapy biorą przełącznik co klatkę)
  assert.equal(g.maps.ladder, true);
  g.tune.texelLadder = false;
  page(10);
  assert.equal(g.maps.ladder, false);
});

test('zanik obrazu przy oddaleniu niezależny od proporcji kadru: ≤ 16:9 jak dawniej, 32:9 jak 16:9 tej samej wysokości', async () => {
  const { spaceGasViewFade } = await import('../src/3d/spaceGas/spaceGas.js');
  const f = [40000, 80000];
  const old = (hw, hh) => 1 - Math.min(1, Math.max(0, (Math.max(hw, hh) - f[0]) / (f[1] - f[0])));
  for (const [W, H] of [[1920, 1080], [2560, 1440], [1024, 768], [1080, 1920]]) {
    for (const z of [0.5, 0.1, 0.035, 0.02, 0.012]) assert.equal(spaceGasViewFade(W / 2 / z, H / 2 / z, f), old(W / 2 / z, H / 2 / z));
  }
  for (const z of [0.1, 0.064, 0.05, 0.035, 0.02]) assert.equal(spaceGasViewFade(2560 / z, 720 / z, f), old(1280 / z, 720 / z), `5120 × 1440 = 2560 × 1440 (zoom ${z})`);
  assert.equal(spaceGasViewFade(2560 / 0.035, 720 / 0.035, f), 1, 'minZoom na 32:9 — gaz pełny');
  assert.ok(Math.abs(spaceGasViewFade(2560 / 0.035, 720 / 0.035, f, 0) - 0.171) < 0.01, 'A/B: dawny wzór (0,17)');
});
