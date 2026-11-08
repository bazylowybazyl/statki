// Rozdzielczość dynamiczna i opcje grafiki w trybie worker (domyślnym): Core3D strony nie ma urządzenia, więc próbki czasu
// GPU idą z workera kanałem zwrotnym RET (`retWriteGpuClock` → `retReadStats`), a skala z powrotem rekordem obrazu
// (`gfxRenderRecord` → wiadomość `gfx`). Ścieżka przechodzona tu na prawdziwych modułach: bufor RET, próbnik i sterownik.
// W grze: `node scripts/webgpu/dyn-res-worker-gra.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const D = await import('../src/game/dynamicResolution.js');
const G = await import('../src/game/graphicsQuality.js');
const R = await import('../src/render/returnLayout.js');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Atrapa Core3D workera: `ms(scale)` — czas GPU klatki; skala stosowana jak `applyGfx` po wiadomości `gfx`. */
function workerCore(ms, scale = 1) {
  return {
    renderScale: scale, gpuFrameMs: 0, gpuComputeMs: 0, gpuFrameSamples: 0, gpuComputeSamples: 0,
    frame(computeMs = 0) {
      this.gpuFrameMs = ms(this.renderScale);
      this.gpuFrameSamples++;
      if (computeMs > 0) { this.gpuComputeMs = computeMs; this.gpuComputeSamples++; }
    }
  };
}

/** Strona: krok `stepDynamicResolution` — odczyt RET, próbnik, sterownik, rekord do workera przy zmianie stopnia. */
function pageDriver(ret, settings, send) {
  const dyn = D.createDynResState();
  const clock = D.createDynResClock();
  const stats = new Float64Array(R.RET_F64.COUNT);
  let applied = settings.renderScale;   // Core3D.renderScale strony (setRenderScale bez urządzenia — sama wartość)
  return {
    dyn,
    step(t) {
      R.retReadStats(ret, stats);
      const F = R.RET_F64;
      const sample = D.dynResSample(clock, t, stats[F.GPU_FRAME_SAMPLES], stats[F.GPU_COMPUTE_SAMPLES], stats[F.GPU_FRAME_MS], stats[F.GPU_COMPUTE_MS]);
      const scale = D.stepDynRes(dyn, t, settings.renderScale, G.gfxDynamicBudgetFps(settings.dynamicRes, settings.frameLimit), sample);
      if (dyn.changed && applied !== scale) { applied = scale; send(G.gfxRenderRecord(settings, scale)); }
      return scale;
    }
  };
}

test('RET: zegar GPU klatki z Core3D workera dochodzi do strony spójnie (ms razem z licznikiem, pod seqlockiem)', () => {
  const v = R.createReturnViews(R.createReturnBuffer(R.RET_DEFAULT_LAYOUT, { shared: false }));
  const out = new Float64Array(R.RET_F64.COUNT);
  R.retWriteGpuClock(v, { gpuFrameMs: 7.5, gpuComputeMs: 1.25, gpuFrameSamples: 41, gpuComputeSamples: 9, renderScale: 0.75 });
  assert.equal(Atomics.load(v.i32, R.RET_I32.SEQ_STATS) & 1, 0, 'zapis zamknięty');
  assert.equal(R.retReadStats(v, out), true);
  assert.equal(out[R.RET_F64.GPU_FRAME_MS], 7.5);
  assert.equal(out[R.RET_F64.GPU_COMPUTE_MS], 1.25);
  assert.equal(out[R.RET_F64.GPU_FRAME_SAMPLES], 41);
  assert.equal(out[R.RET_F64.GPU_COMPUTE_SAMPLES], 9);
  assert.equal(out[R.RET_F64.PIXEL_RATIO], 0.75);
  // brak wyniku (NaN przed pierwszym pomiarem) nie kasuje poprzedniej próbki, skala null = 0
  R.retWriteGpuClock(v, { gpuFrameMs: NaN, gpuComputeMs: undefined, gpuFrameSamples: 41, gpuComputeSamples: 9, renderScale: null });
  R.retReadStats(v, out);
  assert.equal(out[R.RET_F64.GPU_FRAME_MS], 7.5);
  assert.equal(out[R.RET_F64.PIXEL_RATIO], 0);
});

test('próbnik: tylko NOWA próbka (zmiana licznika), compute tylko świeży', () => {
  const c = D.createDynResClock();
  assert.equal(D.dynResSample(c, 0, 0, 0, 0, 0), 0, 'pierwszy odczyt: zero sterownik pomija (sampleMs > 0)');
  assert.equal(D.dynResSample(c, 0.1, 0, 0, 5, 1), null, 'licznik stoi — brak próbki');
  assert.equal(D.dynResSample(c, 0.2, 1, 1, 5, 2), 7, 'render + świeży compute');
  assert.equal(D.dynResSample(c, 0.3, 1, 1, 5, 2), null);
  assert.equal(D.dynResSample(c, 0.6, 2, 1, 5, 2), 7, 'compute sprzed 0,4 s — jeszcze świeży');
  assert.equal(D.dynResSample(c, 0.8, 3, 1, 5, 2), 5, 'compute sprzed 0,6 s — bez niego');
});

test('tryb worker od próbki do skali: przeciążenie schodzi stopniami, zapas wraca, wiadomość tylko przy zmianie stopnia', () => {
  const v = R.createReturnViews(R.createReturnBuffer(R.RET_DEFAULT_LAYOUT, { shared: false }));
  const settings = G.normalizeGfx({ ...G.gfxWithPreset(null, 'high'), renderScale: 1, dynamicRes: '60' });
  let load = 30;   // ms GPU klatki przy 100%
  const core = workerCore((s) => load * s * s, settings.renderScale);
  const sent = [];
  const page = pageDriver(v, settings, (rec) => { sent.push(rec); core.renderScale = rec.renderScale; });
  const hz = 60;
  let t = 0;
  const run = (seconds) => {
    for (let f = 0; f < seconds * hz; f++, t += 1 / hz) {
      // próbki co ~12 klatek — tyle daje zegar GPU workera na klatkę (5 / s), nie co klatkę
      if (f % 12 === 0) { core.frame(f % 24 === 0 ? 1 : 0); R.retWriteGpuClock(v, core); }
      page.step(t);
    }
  };
  run(20);
  assert.deepEqual(sent.map((r) => r.renderScale), [0.85, 0.75, 0.67], 'stopnie drabiny po kolei');
  assert.equal(core.renderScale, 0.67, 'Core3D workera na dnie');
  sent.forEach((r) => assert.deepEqual(structuredClone(r), r, 'rekord przechodzi przez postMessage'));
  load = 4;        // po bitwie: zapas
  run(30);
  assert.equal(core.renderScale, 1, 'powrót do skali z opcji');
  assert.equal(page.dyn.level, 0);
  const n = sent.length;
  run(10);
  assert.equal(sent.length, n, 'stabilnie: bez wiadomości');
});

test('tryb worker: bez próbek skala stoi i nic nie idzie do workera', () => {
  const settings = G.normalizeGfx({ ...G.gfxWithPreset(null, 'high'), renderScale: 1, dynamicRes: '60' });
  // karta bez znaczników czasu: liczniki w RET stoją na zerze
  const v0 = R.createReturnViews(R.createReturnBuffer(R.RET_DEFAULT_LAYOUT, { shared: false }));
  const sent0 = [];
  const p0 = pageDriver(v0, settings, (rec) => sent0.push(rec));
  for (let f = 0; f < 60 * 30; f++) p0.step(f / 60);
  assert.equal(p0.dyn.scale, 1);
  assert.equal(sent0.length, 0);
  // render staje (karta w tle): po ciszy dłuższej niż maxSampleAge przekroczenie się nie zlicza, choć ostatnia średnia była wysoka
  const v1 = R.createReturnViews(R.createReturnBuffer(R.RET_DEFAULT_LAYOUT, { shared: false }));
  const sent1 = [];
  const p1 = pageDriver(v1, settings, (rec) => sent1.push(rec));
  const core = workerCore(() => 40);
  for (let f = 0; f < 60 * 0.5; f++) { if (f % 12 === 0) { core.frame(); R.retWriteGpuClock(v1, core); } p1.step(f / 60); }
  for (let f = 30; f < 60 * 30; f++) p1.step(f / 60);
  assert.ok(p1.dyn.overT === 0, 'licznik przekroczenia wyzerowany');
  assert.ok(sent1.length <= 1, 'najwyżej stopień z pierwszej sekundy, nie zjazd na dno');
});

test('rekord obrazu działa od gotowego GPU, nie po całym init workera (tło menu z presetu gracza)', () => {
  const wk = src('src/render/render.worker.js');
  // wiadomość z kolejki wczesnych: przy gotowym GPU razem z tłem menu i planetami
  assert.match(wk, /if \(q\.type === 'gfx' \|\| q\.type === 'planets' \|\| q\.type === 'menu'/);
  // wiadomość późniejsza (zmiana opcji w menu w trakcie init): od razu, bez kolejki
  assert.match(wk, /if \(!st\.live && st\.tGpu && \(m\.type === 'gfx' \|\| m\.type === 'belt'/);
});

test('flaga znaczników czasu: worker ustawia GPU_TIMER z Core3D, opcje i PerfHUD czytają ją z RET, nie z Core3D strony', () => {
  const v = R.createReturnViews(R.createReturnBuffer(R.RET_DEFAULT_LAYOUT, { shared: false }));
  assert.equal(R.retHasFlag(v, R.RET_FLAG.GPU_TIMER), false);
  R.retSetFlag(v, R.RET_FLAG.GPU_READY | R.RET_FLAG.GPU_TIMER);
  assert.equal(R.retHasFlag(v, R.RET_FLAG.GPU_TIMER), true);
  const wk = src('src/render/render.worker.js');
  assert.match(wk, /Core3D\.gpuTimerSupported \? ret\.RET_FLAG\.GPU_TIMER : 0/);
  assert.match(wk, /retMod\.retWriteGpuClock\(st\.ret, Core3D\)/);
  assert.match(src('src/render/renderWorkerHost.js'), /host\.gpuTimerSupported = \(\) => retHasFlag\(ret, RET_FLAG\.GPU_TIMER\)/);
  const html = src('index.html');
  const dyn = html.slice(html.indexOf('function stepDynamicResolution('), html.indexOf('// --- Limit klatek'));
  assert.match(dyn, /st\[RET_F64\.GPU_FRAME_SAMPLES\]/, 'sterownik: liczniki z RET w trybie worker');
  assert.match(dyn, /dynResSample\(dynResClock, t, fS, cS, fMs, cMs\)/);
  assert.match(dyn, /rwHost \? rwHost\.gpuReady\(\) && !rwHost\.gpuTimerSupported\(\)/, 'notka opcji z flagi workera');
  assert.match(src('src/ui/perfHud.js'), /rw \? rw\.gpuTimerSupported\(\)/);
});
