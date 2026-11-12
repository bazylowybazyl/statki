// Zegar GPU na klatkę Core3D (src/3d/zegarGpuKlatki.js, 2026-11-04). three r183 grupuje znaczniki czasu po
// renderer.info.frame (takt rAF pętli three) i oddaje sumę ostatniego numeru w paczce — w workerze renderu takt
// stoi przez dziesiątki renderów (zapchane GPU), więc Core3D.gpuFrameMs dawał sumę wielu klatek (PerfHUD 14,82 ms
// przy 4,04 ms na klatkę). Test na PRAWDZIWYCH klasach three (pula WebGPUTimestampQueryPool, uid z
// Backend.updateTimeStampUID, przydział z WebGPUBackend.initTimestampQuery) z atrapą urządzenia GPU: info.frame stoi,
// rozwiązania wracają po kilkunastu–kilkudziesięciu klatkach, pula się zapełnia — gpuFrameMs / gpuComputeMs mają
// dawać ms NA JEDNĄ klatkę.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
globalThis.GPUBufferUsage = globalThis.GPUBufferUsage || { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUMapMode = globalThis.GPUMapMode || { READ: 1, WRITE: 2 };

const { default: WebGPUBackend } = await import('three/src/renderers/webgpu/WebGPUBackend.js');
const { default: Backend } = await import('three/src/renderers/common/Backend.js');
const { Core3D } = await import('../src/3d/core3d.js');
const { createZegarGpuKlatki } = await import('../src/3d/zegarGpuKlatki.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

// Atrapa urządzenia: zestaw zapytań = tablica czasów (ns), rozwiązanie i kopia jak w WebGPU, mapAsync czeka, aż test
// „odda GPU” (release) — tak wynik przychodzi po wielu klatkach.
function createGpu() {
  const gpu = { waiting: [], t: 1000n };
  gpu.device = {
    createQuerySet: ({ count }) => ({ times: new BigUint64Array(count), destroy() {} }),
    createBuffer: ({ size }) => ({
      data: new BigUint64Array(size / 8), mapState: 'unmapped',
      mapAsync() { this.mapState = 'pending'; return new Promise((r) => gpu.waiting.push(() => { this.mapState = 'mapped'; r(); })); },
      getMappedRange(off, bytes) { return this.data.buffer.slice(off, off + bytes); },
      unmap() { this.mapState = 'unmapped'; }, destroy() {}
    }),
    createCommandEncoder: () => ({
      resolveQuerySet(qs, first, count, buf, off) { buf.data.set(qs.times.subarray(first, first + count), off / 8); },
      copyBufferToBuffer(src, so, dst, doff, size) { dst.data.set(src.data.subarray(so / 8, (so + size) / 8), doff / 8); },
      finish: () => ({})
    }),
    queue: { submit() {} }
  };
  gpu.release = () => { const w = gpu.waiting.splice(0); for (const f of w) f(); return w.length; };
  return gpu;
}

// Renderer + backend three r183 (metody z prototypów), Core3D z zegarem jak po init().
function createRig({ sampleEvery = 4 } = {}) {
  const gpu = createGpu();
  const data = new WeakMap();
  const backend = Object.create(WebGPUBackend.prototype);
  Object.assign(backend, {
    device: gpu.device, trackTimestamp: true, timestampQueryPool: { render: null, compute: null },
    get(o) { let d = data.get(o); if (!d) data.set(o, d = {}); return d; }
  });
  const renderer = {
    info: { frame: 7, render: { frameCalls: 0, timestamp: 0 }, compute: { frameCalls: 0, timestamp: 0 } },
    backend,
    // Renderer.resolveTimestampsAsync po init: wprost do backendu (część synchroniczna w tym samym wywołaniu)
    resolveTimestampsAsync(type) { return backend.resolveTimestampsAsync(type); }
  };
  backend.renderer = renderer;
  const core = Object.assign(Object.create(Core3D), {
    renderer, gpuFrameMs: 0, gpuComputeMs: 0, gpuFrameSamples: 0, gpuComputeSamples: 0,
    _gpuTimerPending: { render: false, compute: false }, _gpuTimerGateFrame: -1, _gpuSplitHalf: 0, _gpuClock: null,
    _gpuTimestampFeature: true, gpuTimerSampleEvery: sampleEvery
  });
  core._onGpuRenderTimestamp = (ms) => core._handleGpuTimestamp('render', ms);
  core._onGpuComputeTimestamp = (ms) => core._handleGpuTimestamp('compute', ms);
  core._onGpuRenderTimestampError = () => core._handleGpuTimestamp('render', NaN);
  core._onGpuComputeTimestampError = () => core._handleGpuTimestamp('compute', NaN);
  core._installGpuFrameClock(renderer);
  const ctxR = Array.from({ length: 16 }, (_, i) => ({ id: 100 + i }));
  const ctxC = Array.from({ length: 4 }, (_, i) => ({ id: 200 + i, isComputeNode: true }));
  // pass renderu albo wywołanie compute: uid i przydział z kodu three, GPU zapisuje czas trwania
  const pass = (type, ms, i = 0) => {
    const info = renderer.info;
    if (type === 'render') info.render.frameCalls++; else info.compute.frameCalls++;
    const ctx = type === 'render' ? ctxR[i % ctxR.length] : ctxC[i % ctxC.length];
    backend.updateTimeStampUID(ctx);
    const desc = {};
    backend.initTimestampQuery(type, backend.getTimestampUID(ctx), desc);
    const w = desc.timestampWrites;
    const pool = backend.timestampQueryPool[type];
    if (w && typeof w.beginningOfPassWriteIndex === 'number' && pool) {
      pool.querySet.times[w.beginningOfPassWriteIndex] = gpu.t;
      gpu.t += BigInt(Math.round(ms * 1e6));
      pool.querySet.times[w.beginningOfPassWriteIndex + 1] = gpu.t;
    }
  };
  // takt rAF pętli three (Animation.update): nowy numer, liczniki wywołań od zera (Core3D._beginRenderInfo)
  const rafTick = () => { renderer.info.frame++; renderer.info.render.frameCalls = 0; renderer.info.compute.frameCalls = 0; };
  // jeden render() Core3D: 10 passów × 0,3 ms + compute 0,8 + 0,2 ms
  const render = () => {
    core._gpuTimerGate();
    pass('compute', 0.8, 0); pass('compute', 0.2, 1);
    for (let i = 0; i < 10; i++) pass('render', 0.3, i);
    core._gpuTimerAfterRender();
  };
  return { gpu, backend, renderer, core, pass, rafTick, render };
}

test('zegar GPU: stojące info.frame i wyniki po wielu klatkach — gpuFrameMs / gpuComputeMs na JEDNĄ klatkę', async () => {
  const rig = createRig();
  const { core, gpu, renderer, render } = rig;
  const seenR = [], seenC = [], threeSums = [];
  let sR = 0, sC = 0;
  // 240 renderów w JEDNYM takcie rAF three (worker przy zapchanym GPU: 22–69 taktów na ~240 renderów w 2 s),
  // GPU oddaje wyniki co 17 klatek
  for (let f = 1; f <= 240; f++) {
    render();
    if (f % 17 === 0) { gpu.release(); await tick(); await tick(); threeSums.push(renderer.info.render.timestamp); }
    if (core.gpuFrameSamples !== sR) { sR = core.gpuFrameSamples; seenR.push(core.gpuFrameMs); }
    if (core.gpuComputeSamples !== sC) { sC = core.gpuComputeSamples; seenC.push(core.gpuComputeMs); }
  }
  for (let i = 0; i < 4; i++) { render(); gpu.release(); await tick(); await tick(); }
  assert.ok(seenR.length >= 10, `próbek renderu: ${seenR.length}`);
  assert.ok(seenC.length >= 10, `próbek compute: ${seenC.length}`);
  for (const v of seenR) close(v, 3.0, 'render na klatkę');
  for (const v of seenC) close(v, 1.0, 'compute na klatkę');
  // ta sama symulacja daje w three (suma ostatniego info.frame paczki) wielokrotność klatki — dawny gpuFrameMs
  assert.ok(Math.max(...threeSums) > 3 * 3.0, `suma three ${Math.max(...threeSums)} — scenariusz błędu nie odtworzony`);
  assert.equal(renderer.info.frame, 7, 'info.frame stało przez cały przebieg');
  // mapa uid → ms puli three czyszczona po każdym wyniku
  assert.equal(rig.backend.timestampQueryPool.render.timestamps.size, 0);
  // próbki co gpuTimerSampleEvery klatek Core3D (nie taktów rAF): ~1/4 klatek ze znacznikami
  const st = core._gpuClock.stats;
  assert.ok(st.sampled >= 55 && st.sampled <= 62, `klatek z próbką: ${st.sampled}`);
  assert.equal(st.lost + st.foreign, 0);
});

test('zegar GPU: tryb off (takt rAF co klatkę), rendery modułów przed render() i podzielony ekran', async () => {
  const rig = createRig({ sampleEvery: 1 });
  const { core, gpu, render, pass, rafTick } = rig;
  const vals = [];
  let s = 0;
  // off: każda klatka gry = nowy takt rAF; moduł piecze do własnego celu PRZED render() (0,5 ms) — w tej klatce
  for (let f = 1; f <= 60; f++) {
    rafTick();
    pass('render', 0.5, 15);
    render();
    if (f % 5 === 0) { gpu.release(); await tick(); await tick(); }
    if (core.gpuFrameSamples !== s) { s = core.gpuFrameSamples; vals.push(core.gpuFrameMs); }
  }
  assert.ok(vals.length >= 5);
  // pierwsza klatka: pieczenie modułu przed pierwszą bramą — bez znaczników, klatka niepełna (pominięta)
  for (const v of vals) close(v, 3.5, 'render + pieczenie modułu');
  // podzielony ekran: dwa render() = jedna klatka (oba widoki)
  window.splitScreenMode = true;
  try {
    const before = vals.length;
    for (let f = 1; f <= 40; f++) {
      rafTick();
      render(); render();
      if (f % 4 === 0) { gpu.release(); await tick(); await tick(); }
      if (core.gpuFrameSamples !== s) { s = core.gpuFrameSamples; vals.push(core.gpuFrameMs); }
    }
    const split = vals.slice(before);
    assert.ok(split.length >= 4);
    // pierwsza klatka po przełączeniu może łączyć pieczenie modułu z wcześniejszej klatki — dalej pełne pary
    for (const v of split.slice(1)) close(v, 6.0, 'para widoków podzielonego ekranu');
  } finally {
    window.splitScreenMode = false;
  }
});

test('zegar GPU: pula three pełna przy wyniku w locie — klatki bez znaczników albo niepełne nie fałszują średniej', async () => {
  const rig = createRig({ sampleEvery: 1 });
  const { core, gpu, render, backend } = rig;
  const vals = [];
  let s = 0, disabled = 0;
  // GPU oddaje wynik dopiero po 150 klatkach: 24 zapytania na klatkę, pula 2048 — brama musi wyłączać znaczniki
  for (let f = 1; f <= 600; f++) {
    render();
    if (backend.trackTimestamp === false) disabled++;
    if (f % 150 === 0) { gpu.release(); await tick(); await tick(); }
    if (core.gpuFrameSamples !== s) { s = core.gpuFrameSamples; vals.push(core.gpuFrameMs); }
  }
  assert.ok(disabled > 0, 'brama wyłączała znaczniki przy pełnej puli');
  assert.ok(vals.length >= 3, `próbek: ${vals.length}`);
  for (const v of vals) close(v, 3.0, 'render na klatkę przy pełnej puli');
  close(core.gpuComputeMs, 1.0, 'compute na klatkę przy pełnej puli');
  assert.equal(core._gpuClock.stats.lost, 0);
});

test('zegar GPU: moduł rozliczenia bez three — klatka czeka na oba typy, niepełne pomijane, wynik spoza migawki ignorowany', () => {
  const Z = createZegarGpuKlatki();
  // atrapa puli: mapa uid → przesunięcie, rozwiązanie zeruje pulę
  const mkPool = () => ({ queryOffsets: new Map(), currentQueryIndex: 0, timestamps: new Map() });
  const pr = mkPool(), pc = mkPool();
  const alloc = (pool, type, uid) => { const off = pool.currentQueryIndex; pool.currentQueryIndex += 2; pool.queryOffsets.set(uid, off); Z.noteQuery(type, off); return off; };
  const resolveSync = (pool, type) => { Z.beforeResolve(type, pool); const offs = new Map(pool.queryOffsets); pool.queryOffsets.clear(); pool.currentQueryIndex = 0; Z.afterResolveCall(type, pool); return offs; };
  const result = (pool, type, offs, msOf) => { for (const [uid] of offs) pool.timestamps.set(uid, msOf(uid)); const n = Z.onResult(type, pool.timestamps); pool.timestamps.clear(); return n; };
  // klatka 0: próbka, render 2 passy, compute 1
  Z.setSampled(true);
  alloc(pr, 'render', 'r:1:a:f7'); alloc(pr, 'render', 'r:2:b:f7'); alloc(pc, 'compute', 'c:1:x:f7');
  Z.frameEnd();
  // klatka 1: próbka, ale brama wyłączyła render w środku (niepełna)
  Z.setSampled(true);
  alloc(pr, 'render', 'r:3:a:f7');
  Z.notePartial();
  Z.frameEnd();
  // klatka 2: bez próbki
  Z.setSampled(false);
  Z.frameEnd();
  const offR = resolveSync(pr, 'render');
  const offC = resolveSync(pc, 'compute');
  assert.equal(result(pr, 'render', offR, () => 1.5), 0, 'compute jeszcze nie wrócił — klatki czekają');
  assert.equal(Z.nextSettle, 0);
  pc.timestamps.set('c:999:obce:f1', 50); // wpis spoza migawki (cudze zlecenie) — pominięty
  assert.ok(result(pc, 'compute', offC, () => 0.25) > 0);
  assert.equal(Z.nextSettle, 3, 'klatki 0–2 rozliczone');
  close(Z.renderMs, 3.0, 'tylko klatka 0 (pełna): 2 × 1,5 ms');
  assert.equal(Z.renderN, 1);
  close(Z.computeMs, 0.25, 'compute klatki 0');
  assert.equal(Z.stats.foreign, 1);
  // zlecenie, które nic nie zabrało (pula compute wyłączona — three zwraca ostatnią wartość), nie rozlicza klatek
  Z.setSampled(true);
  alloc(pc, 'compute', 'c:2:x:f7');
  Z.frameEnd();
  Z.beforeResolve('compute', pc); Z.afterResolveCall('compute', pc); // currentQueryIndex ≠ 0 — nie zabrane
  Z.onResult('compute', pc.timestamps);
  assert.equal(Z.nextSettle, 3, 'bez rozwiązania compute klatka 3 czeka');
});
