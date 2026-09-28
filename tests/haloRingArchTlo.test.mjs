// Zadanie 23 portu WebGPU: ring-archetyp (Mars = ECUMENE, Jowisz = Fable) budowany KROKAMI w klatkach gry
// (createArchRing z buildInBackground, archRing.js) — dawniej 0,4 s (Mars) i 0,7 s (Jowisz) CPU w jednej
// klatce pierwszego zbliżenia. Ta sama geometria co budowa synchroniczna, ready dopiero po krokach, dispose
// w trakcie budowy → ready false; klej gry kroczy budowę co klatkę, także poza kadrem. Bez GPU.
// node --test tests/haloRingArchTlo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createArchRing, ARCH_BUILD_BUDGET } from '../src/3d/haloRing/arch/archRing.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { HALO_RING_PLANETS } from '../src/game/haloRingPlanets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Atrapa DOM (atlasy napisów K-7, tablic i płyt rysowane na kanwie 2D) — przez cały test, bo kroki budowy
// w tle biegną dopiero w pumpBuild().
function fakeDocument() {
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 8 })
      : k === 'getImageData' || k === 'createImageData' ? (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h })
        : /^create(Linear|Radial|Conic)Gradient$|^createPattern$/.test(String(k)) ? () => ({ addColorStop() {}, setTransform() {} })
          : () => {}),
    set: (t, k, v) => { t[k] = v; return true; }
  });
  const prev = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx }) };
  return () => { if (prev === undefined) delete globalThis.document; else globalThis.document = prev; };
}

// Skrót geometrii grupy: nazwy siatek w kolejności i bity wszystkich atrybutów (także instancji partii).
function groupHash(group) {
  let h = 2166136261;
  const names = [];
  const seen = new Set();
  group.traverse((o) => {
    if (!o.geometry) return;
    names.push(o.name || o.type);
    const g = o.geometry;
    const list = Object.values(g.attributes);
    if (g.index) list.push(g.index);
    for (const a0 of list) {
      const a = a0.isInterleavedBufferAttribute ? a0.data : a0;
      if (seen.has(a)) continue;
      seen.add(a);
      const arr = a.array;
      const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength >> 2);
      for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
    }
  });
  return { h, names };
}

const camera = () => {
  const cam = new THREE.PerspectiveCamera(35, 16 / 9, 100, 500000);
  cam.position.set(0, 0, 60000);
  cam.updateMatrixWorld(true);
  return cam;
};

for (const [planet, stepsMin] of [['mars', 20], ['jupiter', 100]]) {
  test(`ring ${planet}: budowa w tle krokami = ta sama geometria co synchroniczna; ready po krokach`, async () => {
    const restore = fakeDocument();
    try {
      const spec = HALO_RING_PLANETS[planet];
      const opts = { planetRadius: RING_PLANET_WORLD_RADII[planet], seed: spec.seed, profile: spec.profile, quality: 'low' };
      const sync = createArchRing(opts);
      assert.equal(sync.mapsReady, true, 'bez opcji: jak dawniej, od razu');
      const ring = createArchRing({ ...opts, buildInBackground: true });
      // od razu: układ i uniformy (klej ustawia warstwy, słońce, wycięcia), brył i hal jeszcze nie ma
      assert.ok(ring.layout && ring.uniforms);
      assert.equal(ring.building, true);
      assert.equal(ring.mapsReady, false);
      assert.equal(ring.group.children.length, 0);
      assert.deepEqual(ring.k7Halls, []);
      assert.equal(ring.k7, null);
      assert.equal(ring.terrainHeightAt(ring.layout.radii.floorMid, 0, 0), 0, 'teren dopiero po budowie (kolizje podpina klej po ready)');
      assert.deepEqual(ring.landmarks, []);
      assert.doesNotThrow(() => ring.update(1 / 60, { camera: camera(), viewportHeight: 1080, gameView: true }));
      ring.setLayers({ default: 1, fg: 2 });
      ring.setSun(0.5, 0.8);
      const readyBefore = ring.ready; // klej gry czeka na tę obietnicę od utworzenia ringu
      // krok po kroku (budżet: 1 krok na wywołanie) — liczba kroków = ziarnistość przestojów
      let steps = 0;
      while (ring.pumpBuild({ ms: Infinity, maxSteps: 1 })) {
        steps++;
        if (steps > 100000) throw new Error('budowa się nie kończy');
      }
      assert.ok(steps >= stepsMin, `budowa w ${steps} krokach (≥ ${stepsMin})`);
      assert.equal(ring.building, false);
      assert.equal(ring.pumpBuild(), false, 'po budowie nic do roboty');
      assert.equal(await readyBefore, true, 'obietnica ready sprzed budowy rozstrzygnięta przez koniec kroków');
      assert.equal(await ring.ready, true);
      assert.equal(ring.mapsReady, true);
      assert.equal(ring.k7Halls.length, sync.k7Halls.length);
      const a = groupHash(sync.group);
      const b = groupHash(ring.group);
      assert.deepEqual(b.names, a.names, 'te same siatki w tej samej kolejności');
      assert.equal(b.h, a.h, 'bit w bit ta sama geometria i dane instancji');
      const x = ring.layout.radii.floorMid;
      assert.equal(ring.terrainHeightAt(x, 0, 120), sync.terrainHeightAt(x, 0, 120));
      assert.equal(ring.group.children[0].layers.mask, 1 << 1, 'warstwy ustawione przed budową nałożone po niej');
      sync.dispose();
      ring.dispose();
    } finally {
      restore();
    }
  });
}

test('budowa w tle przerwana: dispose → ready false; setQuality → nowa budowa od początku', async () => {
  const restore = fakeDocument();
  try {
    const spec = HALO_RING_PLANETS.mars;
    const opts = { planetRadius: RING_PLANET_WORLD_RADII.mars, seed: spec.seed, profile: spec.profile, quality: 'low', buildInBackground: true };
    const a = createArchRing(opts);
    const readyA = a.ready;
    for (let i = 0; i < 5; i++) a.pumpBuild({ ms: Infinity, maxSteps: 1 });
    a.dispose();
    assert.equal(await readyA, false);
    assert.equal(a.building, false);
    assert.equal(a.pumpBuild(), false);
    const b = createArchRing(opts);
    for (let i = 0; i < 5; i++) b.pumpBuild({ ms: Infinity, maxSteps: 1 });
    const readyB0 = b.ready;
    b.setQuality('medium');
    assert.equal(await readyB0, false, 'przerwana budowa jakości low');
    assert.equal(b.building, true);
    while (b.pumpBuild({ ms: Infinity, maxSteps: 64 }));
    assert.equal(await b.ready, true);
    assert.equal(b.quality, 'medium');
    assert.ok(b.group.children.length > 0);
    b.dispose();
  } finally {
    restore();
  }
});

test('budżet kroków na klatkę: najwyżej maxSteps kroków i do ms czasu (przy stojącym zegarze — sam limit kroków)', () => {
  assert.ok(ARCH_BUILD_BUDGET.maxSteps >= 1 && ARCH_BUILD_BUDGET.maxSteps <= 8);
  assert.ok(ARCH_BUILD_BUDGET.ms > 0 && ARCH_BUILD_BUDGET.ms <= 8);
  const src = read('src/3d/haloRing/haloRingGame.js');
  assert.match(src, /buildInBackground: true/, 'klej gry buduje ringi-archetypy w tle');
  const upd = src.slice(src.indexOf('  update(dt, cam, opts = {}) {'), src.indexOf('  _applySun(e, sun) {'));
  const pump = upd.indexOf('ring.pumpBuild()');
  assert.ok(pump > 0, 'kroki budowy co klatkę');
  assert.ok(pump < upd.indexOf('if (!inView) continue;'), 'także poza kadrem (przed wyjściem z pętli)');
});
