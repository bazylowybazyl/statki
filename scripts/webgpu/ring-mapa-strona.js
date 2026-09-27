// Strona pomiaru map ringu (port WebGPU, zadanie 06, krok 5): buduje mapy świata
// ringu tak jak createHaloRing (bake niskiej → odczyt CPU → plan budowli i kopuł →
// setCivic → ponowny odczyt), piecze pełną mapę plastrami i tekstury detalu, a dla
// ringów-archetypów (Mars, Jowisz) próbkuje terrainHeightAt. Działa na OBU
// wersjach kodu: na tagu webgl-baseline (WebGLRenderer, odczyt synchroniczny) i na
// main (WebGPURenderer, HaloWorldMaps.init() + odczyt asynchroniczny) — wersję
// rozpoznaje po API (HaloWorldMaps.prototype.init). Wyniki: window.__mapa.
// Uruchamia scripts/webgpu/ring-mapa.mjs (porównanie dwóch przebiegów: --porownaj).
import * as THREE from 'three';
import { HaloWorldMaps } from '../../src/3d/haloRing/haloRingWorldGen.js';
import { HaloDetailTextures } from '../../src/3d/haloRing/haloRingDetail.js';
import { createHaloRingLayout } from '../../src/3d/haloRing/haloRingLayout.js';
import { HALO_QUALITY } from '../../src/3d/haloRing/haloRingConfig.js';
import { haloCivicContext, buildHaloLandmarkPlan } from '../../src/3d/haloRing/haloRingLandmarks.js';
import { buildHaloDomePlan } from '../../src/3d/haloRing/haloRingDomes.js';
import { RING_PLANET_WORLD_RADII } from '../../src/3d/ringScale.js';
import { HALO_RING_PLANETS } from '../../src/game/haloRingPlanets.js';
import { createArchRing } from '../../src/3d/haloRing/arch/archRing.js';

const params = new URLSearchParams(location.search);
const VARIANTS = (params.get('warianty') || 'earth,features,mars-halo,jupiter-halo,arch,detail').split(',').filter(Boolean);
const QUALITY = HALO_QUALITY[params.get('jakosc')] ? params.get('jakosc') : 'high';
const ASYNC = typeof HaloWorldMaps.prototype.init === 'function';
const logEl = document.getElementById('log');
const log = (s) => { logEl.textContent += '\n' + s; console.log('[mapa]', s); };

const state = { done: false, error: null, backend: null, gpu: null, quality: QUALITY, results: {}, arrays: {} };
window.__mapa = state;

// ---------------------------------------------------------------------------
function b64(typed) {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
state.get = (name) => (state.arrays[name] ? b64(state.arrays[name]) : null);
state.names = () => Object.keys(state.arrays).map((k) => ({ name: k, length: state.arrays[k].length }));

function fnv(values, quant) {
  let h = 0x811c9dc5;
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < values.length; i++) {
    let x;
    if (quant > 0) x = Math.round(values[i] / quant) | 0;
    else { f[0] = values[i]; x = u[0]; }
    h ^= x & 0xff; h = Math.imul(h, 16777619);
    h ^= (x >>> 8) & 0xff; h = Math.imul(h, 16777619);
    h ^= (x >>> 16) & 0xff; h = Math.imul(h, 16777619);
    h ^= (x >>> 24) & 0xff; h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stats(values, { bins = 16, sample = 12 } = {}) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sum2 = 0;
  let nan = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sum2 += v * v;
  }
  const n = values.length - nan;
  const mean = sum / Math.max(1, n);
  const hist = new Array(bins).fill(0);
  const span = max - min || 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    hist[Math.min(bins - 1, Math.floor((v - min) / span * bins))]++;
  }
  const picks = [];
  for (let k = 0; k < sample; k++) {
    const i = Math.floor((k + 0.5) / sample * values.length);
    picks.push([i, values[i]]);
  }
  return {
    n: values.length, nan, min, max, mean, std: Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean)),
    hist, histRange: [min, max], samples: picks,
    hashBits: fnv(values, 0), hash001: fnv(values, 0.01), hash01: fnv(values, 0.1), hash1: fnv(values, 1)
  };
}

// ---------------------------------------------------------------------------
let renderer = null;

async function makeRenderer() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  if (ASYNC) {
    const WG = await import('three/webgpu');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const want = ['maxTextureDimension2D', 'maxTextureArrayLayers', 'maxSampledTexturesPerShaderStage', 'maxInterStageShaderVariables',
      'maxVertexAttributes', 'maxStorageBuffersPerShaderStage', 'maxColorAttachmentBytesPerSample', 'maxBufferSize', 'maxStorageBufferBindingSize'];
    const requiredLimits = {};
    for (const k of want) if (Number.isFinite(adapter.limits[k])) requiredLimits[k] = adapter.limits[k];
    const r = new WG.WebGPURenderer({ canvas, antialias: false, alpha: true, requiredLimits });
    await r.init();
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    state.backend = r.backend.isWebGPUBackend ? 'webgpu' : 'webgpu-webgl2';
    const info = adapter.info || {};
    state.gpu = `${info.vendor || ''} ${info.architecture || ''} ${info.description || ''}`.trim();
    return r;
  }
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  r.outputColorSpace = THREE.LinearSRGBColorSpace;
  r.toneMapping = THREE.NoToneMapping;
  state.backend = 'webgl';
  const gl = r.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  state.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return r;
}

async function gpuSync() {
  if (ASYNC) await renderer.backend.device.queue.onSubmittedWorkDone();
  else {
    const gl = renderer.getContext();
    gl.finish();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }
}

// Odczyt celu (wszystkie kanały) → Float32Array w układzie wierszy „v rośnie z
// indeksem” (WebGL: readPixels od dołu; WebGPU: od góry celu, bake pisze v = 0 u góry).
async function readTarget(rt, x, y, w, h) {
  const type = rt.texture.type;
  const out = new Float32Array(w * h * 4);
  if (ASYNC) {
    const raw = await renderer.readRenderTargetPixelsAsync(rt, x, y, w, h);
    const bpe = raw.BYTES_PER_ELEMENT;
    const rowElems = Math.ceil((w * 4 * bpe) / 256) * 256 / bpe;
    for (let r = 0; r < h; r++) {
      for (let i = 0; i < w * 4; i++) {
        const v = raw[r * rowElems + i];
        out[r * w * 4 + i] = type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(v) : type === THREE.UnsignedByteType ? v / 255 : v;
      }
    }
    return out;
  }
  const buf = type === THREE.HalfFloatType ? new Uint16Array(w * h * 4) : type === THREE.UnsignedByteType ? new Uint8Array(w * h * 4) : new Float32Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, x, y, w, h, buf);
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    out[i] = type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(v) : type === THREE.UnsignedByteType ? v / 255 : v;
  }
  return out;
}

function channel(data, c) {
  const out = new Float32Array(data.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + c];
  return out;
}

function layoutOf(key) {
  const spec = HALO_RING_PLANETS[key];
  return createHaloRingLayout({ planetRadius: RING_PLANET_WORLD_RADII[key], seed: spec.seed, profile: spec.profile });
}

// Mapy jak w createHaloRing: konstrukcja (+ init na WebGPU), plan budowli z mapy
// sprzed placów, setCivic. Zwraca maps i czasy.
async function buildMaps(layout, { civic = true, before = null } = {}) {
  const t0 = performance.now();
  const maps = new HaloWorldMaps(renderer, layout, HALO_QUALITY[QUALITY]);
  if (ASYNC) await maps.init();
  await gpuSync();
  const tInit = performance.now() - t0;
  if (before) await before(maps);
  const pre = maps.cpu ? new Float32Array(maps.cpu.heights) : null;
  let landmarks = [];
  let domes = [];
  let tCivic = 0;
  if (civic) {
    const Wf = layout.floor.length;
    const ctx = haloCivicContext(layout, { heightAt: maps.cpu ? (theta, t) => maps.heightAtUV(theta / (Math.PI * 2), t / Wf) : null });
    landmarks = buildHaloLandmarkPlan(layout, { ctx });
    domes = buildHaloDomePlan(layout, { ctx });
    const t1 = performance.now();
    if (ASYNC) await maps.setCivic({ landmarks, domes });
    else maps.setCivic({ landmarks, domes });
    await gpuSync();
    tCivic = performance.now() - t1;
  }
  return { maps, pre, post: maps.cpu ? new Float32Array(maps.cpu.heights) : null, landmarks, domes, tInit, tCivic };
}

const civicSummary = (list) => list.map((o) => ({
  name: o.name, sector: o.sectorName, s: +o.s.toFixed(3), t: +o.t.toFixed(3), theta: +o.theta.toFixed(6),
  h: +(o.plazaH ?? o.floorH ?? 0).toFixed(3)
}));

async function variantHalo(name, layout, opts = {}) {
  log(`${name}: mapy (jakość ${QUALITY})…`);
  const b = await buildMaps(layout, opts);
  const res = { cpuSize: { w: b.maps.cpu?.w, h: b.maps.cpu?.h }, timings: { initMs: b.tInit, civicMs: b.tCivic } };
  if (ASYNC && b.maps.timings) res.timings.maps = JSON.parse(JSON.stringify(b.maps.timings));
  if (b.pre) { state.arrays[`${name}.cpu_pre`] = b.pre; res.cpuPre = stats(b.pre); }
  if (b.post && opts.civic !== false) { state.arrays[`${name}.cpu_post`] = b.post; res.cpuPost = stats(b.post); }
  res.landmarks = civicSummary(b.landmarks);
  res.domes = civicSummary(b.domes);
  // mapa niska A/B/C (po placach)
  if (opts.lowMaps !== false && b.maps.low) {
    const { w, h } = b.maps.low.size;
    res.lowSize = { w, h };
    for (const key of ['A', 'B', 'C']) {
      const data = await readTarget(b.maps.low[key], 0, 0, w, h);
      for (let c = 0; c < 4; c++) {
        const arr = channel(data, c);
        state.arrays[`${name}.low${key}${c}`] = arr;
        res[`low${key}${c}`] = stats(arr, { sample: 4 });
      }
    }
  }
  // pełna mapa plastrami (czas) + okno wokół granicy plastrów 11|12
  if (opts.full !== false) {
    const t0 = performance.now();
    let n = 0;
    while (!b.maps.ready && n < 100) { b.maps.step(); n++; }
    const cpuMs = performance.now() - t0;
    await gpuSync();
    res.timings.fullSlices = n;
    res.timings.fullCpuMs = cpuMs;
    res.timings.fullGpuMs = performance.now() - t0;
    const set = b.maps.full;
    if (set) {
      const { w, h } = set.size;
      res.fullSize = { w, h };
      const x0 = Math.round(w * 12 / 24) - 256;
      const data = await readTarget(set.A, x0, 0, 512, h);
      const arr = channel(data, 0);
      state.arrays[`${name}.fullA0_win`] = arr;
      res.fullA0Window = { x0, w: 512, h, ...stats(arr, { sample: 6 }) };
    }
  }
  b.maps.dispose();
  state.results[name] = res;
}

async function variantArch() {
  for (const key of ['mars', 'jupiter']) {
    log(`arch ${key}: terrainHeightAt (plan CPU)…`);
    const spec = HALO_RING_PLANETS[key];
    const t0 = performance.now();
    const ring = createArchRing({ planetRadius: RING_PLANET_WORLD_RADII[key], seed: spec.seed, profile: spec.profile, quality: QUALITY, renderer });
    const buildMs = performance.now() - t0;
    const L = ring.layout;
    const w = 2048;
    const h = Math.max(32, Math.round(96 * L.width / 6000));
    const out = new Float32Array(w * h);
    const pt = {};
    for (let y = 0; y < h; y++) {
      const t = (y + 0.5) / h * L.floor.length;
      for (let x = 0; x < w; x++) {
        const s = (x + 0.5) / w * L.circumference;
        L.floorPoint(s, t, 0, pt);
        out[y * w + x] = ring.terrainHeightAt(pt.x, pt.y, pt.z);
      }
    }
    // kolizje gry pytają na z = 0 (płaszczyzna gry): pas wokół ringu
    const ring0 = new Float32Array(w);
    const R = L.radii.floorMid;
    for (let x = 0; x < w; x++) {
      const th = (x + 0.5) / w * Math.PI * 2;
      ring0[x] = ring.terrainHeightAt(Math.cos(th) * R, Math.sin(th) * R, 0);
    }
    state.arrays[`arch-${key}.grid`] = out;
    state.arrays[`arch-${key}.z0`] = ring0;
    state.results[`arch-${key}`] = {
      archetype: L.archetype, mapsReady: ring.mapsReady, gridSize: { w, h }, buildMs,
      grid: stats(out), z0: stats(ring0), landmarks: civicSummary(ring.landmarks || []).length, domes: (ring.domes || []).length
    };
    ring.dispose();
  }
}

async function variantDetail() {
  log('detal: tekstury szumu 1024²…');
  const t0 = performance.now();
  const d = new HaloDetailTextures(renderer);
  if (ASYNC) await d.init();
  await gpuSync();
  const res = { ms: performance.now() - t0 };
  for (const [key, rt] of [['tex1', d.rt1], ['tex2', d.rt2]]) {
    const data = await readTarget(rt, 0, 0, 1024, 1024);
    for (let c = 0; c < 4; c++) {
      const arr = channel(data, c);
      state.arrays[`detail.${key}${c}`] = arr;
      res[`${key}${c}`] = stats(arr, { sample: 4 });
    }
  }
  d.dispose();
  state.results.detail = res;
}

// Cechy profilu, których dziś nie używa żaden profil (kaniony, kratery, wydmy,
// mesy, płaskowyż) — wymuszone na układzie Ziemi, żeby sprawdzić ich port.
async function forceFeatures(maps) {
  const u = maps.uniforms;
  const n = maps.layout.sectors.length;
  for (let i = 0; i < n; i++) u.uSectorFeat.value[i].set(i % 2 ? 1 : 0, i % 3 === 0 ? 1 : 0, i % 4 === 1 ? 1 : 0, i % 5 === 2 ? 0.8 : 0);
  u.uProfBake.value.x = 60;
  u.uCanyonA.value[0].set(0.36, 420, 190, 1);
  u.uCanyonM1.value[0].set(3, 0.05, 0.4);
  u.uCanyonM2.value[0].set(7, 0.02, 1.3);
  u.uCanyonA.value[1].set(0.7, 300, 120, 1);
  u.uCanyonM1.value[1].set(5, 0.04, 2.1);
  u.uCanyonM2.value[1].set(11, 0.015, 0.2);
  maps._bakeRegion(maps.low, 0, 1);
  if (ASYNC) await maps._readbackCpu();
  else maps._readbackCpu();
}

async function main() {
  renderer = await makeRenderer();
  log(`backend ${state.backend} (${state.gpu}), mapy asynchroniczne: ${ASYNC}`);
  for (const v of VARIANTS) {
    if (v === 'earth') await variantHalo('earth', layoutOf('earth'));
    else if (v === 'features') await variantHalo('features', layoutOf('earth'), { civic: false, before: forceFeatures, lowMaps: true, full: false });
    else if (v === 'mars-halo') await variantHalo('mars-halo', layoutOf('mars'), { full: false });
    else if (v === 'jupiter-halo') await variantHalo('jupiter-halo', layoutOf('jupiter'), { full: false });
    else if (v === 'arch') await variantArch();
    else if (v === 'detail') await variantDetail();
  }
  state.done = true;
  log('gotowe');
}

main().catch((err) => {
  state.error = String(err?.stack || err);
  state.done = true;
  log('BŁĄD ' + state.error);
});
