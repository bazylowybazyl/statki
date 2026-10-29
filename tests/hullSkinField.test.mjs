// Pole skóry 3D (src/3d/ships3d/hullSkin3D.js — ciała świata i modele okrętów), 2026-10-29: (1) lustro ciała w workerze
// bez nowej strony węzłów (MirrorBody.nodesSeq) nie jest przeglądane — przegląd nic by nie zapisał; (2) wysyłka
// ROZRZUTEM: zmienione komórki na liście, krok Core3D.fx kopiuje ich bieżące wartości i kernel przepisuje je do pola
// (zamiast zakresu lo..hi slotu). Oba bez zmiany obrazu: pole lustra = pole ciała gry przeglądanego w każdej klatce,
// a bufor GPU (emulacja: zakresy jak three — WebGPUAttributeUtils.updateAttribute, kernel rozrzutu na CPU) = kopia CPU.
// Ruch sztywny odłamu żyje w pozie ciała (pos / quat, kąt encji), nie w węzłach — sonda prawdziwego upadku bazy piratów
// w Node (docs/AUDYT-wydajnosc-baza-gpu-2026-10-28.md § 8): dopasowanie ruchu sztywnego do węzłów w układzie ciała daje
// 0,04–0,1° i więcej zmienionych komórek, nie mniej.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { MirrorBody, applyBodyPage, describeBodyTopology } from '../src/render/mirrorBody.js';
import { BODY } from '../src/render/snapshotLayout.js';
import {
  FIELD_CAP, hullSkinField, ensureHullSkinSlot, releaseHullSkinSlot, writeHullSkinField, hullSkinFieldFxStep,
  hullSkinScatterState, HULL_SKIN_FIELD_OPTIONS, HULL_SKIN_FIELD_STATS
} from '../src/3d/ships3d/hullSkin3D.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ciało płaskie nx × ny na kratownicy (węzeł w środku swojej komórki), magazyny jak BeamNodeStore / BeamLinkStore
// w polach czytanych przez pakującego, lustro i pole skóry.
function makeBody(nx, ny, lm = { x: -100, y: -40, z: 0 }) {
  const n = nx * ny, cs = 15;
  const f = () => new Float64Array(n), i = () => new Int32Array(n), u = () => new Uint8Array(n);
  const s = {
    count: n, shapeVersion: 0, x: f(), y: f(), z: f(), ox: f(), oy: f(), oz: f(), heat: f(), heatStamp: f(),
    ix: i(), iy: i(), iz: i(), active: u().fill(1), patch: u(), skinDirty: u(),
    adjStart: new Int32Array(n + 1), adj: new Int32Array(0)
  };
  for (let k = 0; k < n; k++) {
    s.ix[k] = k % nx; s.iy[k] = (k / nx) | 0;
    s.x[k] = s.ox[k] = lm.x + (s.ix[k] + 0.5) * cs;
    s.y[k] = s.oy[k] = lm.y + (s.iy[k] + 0.5) * cs;
  }
  const m = n;
  const e = { count: m, a: new Int32Array(m), b: new Int32Array(m), rest: new Float64Array(m).fill(cs), restBase: new Float64Array(m).fill(cs),
    broken: new Uint8Array(m), type: new Uint8Array(m) };
  for (let k = 0; k < m; k++) { e.a[k] = k; e.b[k] = (k + 1) % n; }
  const region = { store: s, dirty: new Int32Array(n), dirtyCount: 0, dirtyAll: false, drift: 0 };
  return { nodeStore: s, beamStore: e, _region: region, activeNodes: n, meshDirty: true, isSleeping: false, planar: true,
    cellSize: cs, latticeMin: { ...lm }, dims: { x: nx, y: ny, z: 1 }, _boundsMinMax: new Float64Array(6), _maxDisp: 0, dead: false,
    pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } };
}

function markDirty(body, i) {
  const s = body.nodeStore, r = body._region;
  if (!s.skinDirty[i]) { s.skinDirty[i] = 1; r.dirty[r.dirtyCount++] = i; }
  body.meshDirty = true;
}

const hullOf = (body) => ({ body, anchorDX: 0, anchorDY: 0, revision: 0, isFragment: true, solid3D: false });

// Pakujący (strona gry) → lustro (worker): jedna strona na wywołanie, worker odbiera każdą.
function mirrorLink(B) {
  const ent = { x: 0, y: 0, angle: 0, beamHull: { body: B, srcWidth: 100, srcHeight: 100, scale: 1, pivot: { x: 0, y: 0 } } };
  const packer = new SnapshotPacker({ shared: false });
  const frame = createSnapshotFrame();
  Object.assign(frame, { ship: ent, npcs: [], wrecks: [], cam: { x: 0, y: 0, zoom: 1 }, consumeDirty: true });
  const mirror = new MirrorBody(0, 1);
  mirror.dims = { ...B.dims };
  const page = () => {
    frame.lastConsumed = packer.k;
    packer.begin(frame);
    const v = packer.view;
    const bs = packer.ids.bodies.peek(B);
    const storeVer = v.bodyI32[bs * BODY.stride.i32 + BODY.I32.STORE_VER];
    if (mirror.storeVer !== storeVer) mirror.setTopology(describeBodyTopology(B), storeVer);
    assert.ok(applyBodyPage(mirror, v, bs));
    packer.finish(frame);
  };
  return { ent, mirror, page };
}

// Emulacja GPU pola: bufor tworzony z kopii CPU przy pierwszym wiązaniu, potem zakresy (jak three) i kernel rozrzutu.
function fieldGpu() {
  const attr = hullSkinField().value;
  const gpu = new Float32Array(FIELD_CAP * 4);
  let created = false;
  const upload = () => {
    if (!created) { gpu.set(attr.array); created = true; }
    else for (const r of attr.updateRanges) gpu.set(attr.array.subarray(r.start, r.start + r.count), r.start);
    if (attr.updateRanges.length) attr.clearUpdateRanges();
  };
  const renderer = {
    compute(kernel, threads) {
      upload();
      const sc = hullSkinScatterState();
      assert.equal(kernel, sc.kernel);
      const n = sc.uCount.value;
      assert.ok(threads >= n, `wątki ${threads} ≥ ${n}`);
      for (let k = 0; k < n; k++) gpu.set(sc.valArr.subarray(k * 4, k * 4 + 4), sc.idxArr[k] * 4);
    }
  };
  const step = hullSkinFieldFxStep();
  return {
    gpu, renderer, upload,
    warm() { step.warm({ renderer }); },
    frame() { step.update({ renderer }); upload(); },   // klatka: krok Core3D.fx, potem wiązania passów
    slot(st) { return gpu.subarray(st.offset * 4, (st.offset + st.count) * 4); }
  };
}
const cpuSlot = (st) => hullSkinField().value.array.subarray(st.offset * 4, (st.offset + st.count) * 4);
const delta = (a) => Object.fromEntries(Object.entries(HULL_SKIN_FIELD_STATS).map(([k, v]) => [k, v - (a[k] || 0)]));

test('odłam obracany sztywno (poza ciała) nie przegląda ani nie pisze pola; odkształcony — tylko zmienione komórki, rozrzutem', () => {
  const G = fieldGpu();
  G.warm();
  const B = makeBody(12, 7);
  const { ent, mirror, page } = mirrorLink(B);
  page();
  const hull = hullOf(mirror);
  const st = ensureHullSkinSlot(hull, null);
  assert.ok(st, 'slot pola');
  assert.equal(writeHullSkinField(hull), B.nodeStore.count, 'pierwszy zapis — wszystkie węzły');
  G.frame();
  assert.deepEqual(G.slot(st), cpuSlot(st), 'GPU = CPU po pierwszym zapisie');
  // następna strona powtarza węzły (pakujący wysyła zmiany, dopóki nie wie o odbiorze) — przegląd bez zapisu
  page();
  assert.equal(writeHullSkinField(hull), 0, 'powtórzone węzły: nic do zapisu');
  let s0 = { ...HULL_SKIN_FIELD_STATS };
  // obrót i przesunięcie odłamu — poza ciała (encja i pos / quat), węzły w układzie ciała bez zmian
  for (let k = 1; k <= 30; k++) {
    const a = 0.07 * k;
    ent.angle = a; ent.x = 3 * k; ent.y = -2 * k;
    B.quat.z = Math.sin(-a / 2); B.quat.w = Math.cos(-a / 2); B.pos.x = 3 * k; B.pos.y = 2 * k;
    page();
    for (let r = 0; r < 4; r++) { assert.equal(writeHullSkinField(hull), 0, 'obrót sztywny: bez zapisu'); G.frame(); }
  }
  let d = delta(s0);
  assert.equal(d.scans, 0, 'bez nowej strony węzłów — bez przeglądu');
  assert.equal(d.skips, 120);
  assert.equal(d.cells, 0);
  assert.equal(hullSkinScatterState().n, 0, 'lista rozrzutu pusta');
  // odkształcenie: trzy węzły (jeden poniżej progu 0,02 j.)
  s0 = { ...HULL_SKIN_FIELD_STATS };
  const s = B.nodeStore;
  s.x[5] += 1.5; markDirty(B, 5);
  s.y[40] -= 0.8; markDirty(B, 40);
  s.x[70] += 0.01; markDirty(B, 70);
  page();
  assert.equal(writeHullSkinField(hull), 2, 'odkształcony: zmienione komórki');
  assert.equal(hullSkinScatterState().n, 2, 'na liście tylko one');
  G.frame();
  d = delta(s0);
  assert.equal(d.scans, 1);
  assert.equal(d.scattered, 2);
  assert.equal(d.rangeCells, 0, 'bez zakresu slotu');
  assert.equal(d.flushes, 1);
  assert.equal(d.flushCells, 2);
  assert.deepEqual(G.slot(st), cpuSlot(st), 'GPU = CPU po rozrzucie');
  // ten sam stan węzłów w kolejnej klatce workera — bez przeglądu
  assert.equal(writeHullSkinField(hull), 0);
  releaseHullSkinSlot(hull);
});

test('lustro z pominięciem i rozrzutem = ciało gry przeglądane w każdej klatce (pole CPU i GPU, 1500 klatek)', () => {
  const G = fieldGpu();
  G.warm();
  const A = makeBody(10, 9), B = makeBody(10, 9);
  const { mirror, page } = mirrorLink(B);
  page();
  const hullA = hullOf(A), hullM = hullOf(mirror);
  const stA = ensureHullSkinSlot(hullA, null), stM = ensureHullSkinSlot(hullM, null);
  assert.ok(stA && stM && stA.count === stM.count);
  const rnd = rng(7);
  const s0 = { ...HULL_SKIN_FIELD_STATS };
  let draws = 0;
  for (let k = 0; k < 1500; k++) {
    // krok gry co ~4. klatkę (60 Hz przy 240 kl/s) — te same zmiany w obu ciałach
    if (rnd() < 0.27) {
      const ops = [];
      const nOps = 1 + Math.floor(rnd() * 8);
      for (let q = 0; q < nOps; q++) ops.push([rnd(), Math.floor(rnd() * 90), rnd() * 0.6 - 0.3, rnd() * 0.6 - 0.3]);
      for (const body of [A, B]) {
        const s = body.nodeStore;
        for (const [kind, i, dx, dy] of ops) {
          if (kind < 0.8) { s.x[i] += dx; s.y[i] += dy; markDirty(body, i); }
          else if (kind < 0.86 && body.activeNodes > 40) { if (s.active[i]) { s.active[i] = 0; body.activeNodes--; markDirty(body, i); } }
          else if (kind < 0.9) { body._region.dirtyAll = true; body.meshDirty = true; for (let j = 0; j < s.count; j++) s.y[j] += 0.05; }
        }
      }
    }
    page();
    if (rnd() < 0.85) {
      draws++;
      writeHullSkinField(hullA);
      writeHullSkinField(hullM);
      G.frame();
      assert.deepEqual(cpuSlot(stM), cpuSlot(stA), `klatka ${k}: pole lustra = pole ciała gry`);
      assert.deepEqual(G.slot(stM), cpuSlot(stM), `klatka ${k}: GPU = CPU`);
      assert.deepEqual(G.slot(stA), cpuSlot(stA), `klatka ${k}: GPU = CPU (ciało gry)`);
    }
  }
  const d = delta(s0);
  assert.ok(draws > 1200);
  assert.ok(d.skips > draws * 0.4, `pominięte przeglądy lustra: ${d.skips} z ${draws}`);
  assert.equal(d.rangeCells, 0, 'wszystko rozrzutem');
  releaseHullSkinSlot(hullA);
  releaseHullSkinSlot(hullM);
});

test('A/B: bez rozrzutu i bez pominięcia — zakres lo..hi i przegląd w każdej klatce, to samo pole', () => {
  const G = fieldGpu();
  G.warm();
  const was = { ...HULL_SKIN_FIELD_OPTIONS };
  try {
    HULL_SKIN_FIELD_OPTIONS.scatter = false;
    HULL_SKIN_FIELD_OPTIONS.skip = false;
    const B = makeBody(8, 8);
    const { mirror, page } = mirrorLink(B);
    page();
    const hull = hullOf(mirror);
    const st = ensureHullSkinSlot(hull, null);
    const s0 = { ...HULL_SKIN_FIELD_STATS };
    writeHullSkinField(hull);
    G.frame();
    B.nodeStore.x[3] += 1; markDirty(B, 3);
    B.nodeStore.x[60] += 1; markDirty(B, 60);
    page();
    assert.equal(writeHullSkinField(hull), 2);
    G.frame();
    page();
    assert.equal(writeHullSkinField(hull), 0);
    const d = delta(s0);
    assert.equal(d.skips, 0, 'bez pominięcia');
    assert.equal(d.scans, 3);
    assert.equal(d.scattered, 0, 'bez rozrzutu');
    assert.equal(d.rangeCells, 64 + 58, 'pierwszy zapis cały slot, potem zakres komórek 3..60');
    assert.deepEqual(G.slot(st), cpuSlot(st), 'GPU = CPU');
    releaseHullSkinSlot(hull);
  } finally {
    Object.assign(HULL_SKIN_FIELD_OPTIONS, was);
  }
});

test('kernel rozrzutu: WGSL buduje się w Node — pole do zapisu (read_write), lista tylko do odczytu, warunek liczby', async () => {
  const THREE = await import('three/webgpu');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  hullSkinFieldFxStep().warm({ renderer: null });   // bez renderera: tylko budowa listy i kernela
  const sc = hullSkinScatterState();
  const b = renderer.backend.createNodeBuilder(sc.kernel, renderer);
  b.build();
  const w = b.computeShader;
  assert.match(w, /var<storage,\s*read_write>\s*hullSkin3DFieldRW/, 'pole do zapisu');
  assert.match(w, /var<storage,\s*read>\s*hullSkin3DScatterIdx/, 'indeksy do odczytu');
  assert.match(w, /var<storage,\s*read>\s*hullSkin3DScatterVal/, 'wartości do odczytu');
  assert.match(w, /if\s*\(\s*\(\s*instanceIndex\s*<\s*object\.\w+\s*\)\s*\)/, 'warunek liczby wątków');
  assert.match(w, /hullSkin3DFieldRW\.value\[\s*hullSkin3DScatterIdx\.value\[\s*instanceIndex\s*\]\s*\]\s*=\s*hullSkin3DScatterVal\.value\[\s*instanceIndex\s*\]/,
    'komórka pola = wartość z listy');
});

test('ciało gry (bez numeru stanu węzłów) przeglądane zawsze', () => {
  const A = makeBody(6, 6);
  const hull = hullOf(A);
  ensureHullSkinSlot(hull, null);
  const s0 = { ...HULL_SKIN_FIELD_STATS };
  writeHullSkinField(hull);
  writeHullSkinField(hull);
  writeHullSkinField(hull);
  const d = delta(s0);
  assert.equal(d.scans, 3);
  assert.equal(d.skips, 0);
  releaseHullSkinSlot(hull);
});
