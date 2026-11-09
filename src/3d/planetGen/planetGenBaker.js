// src/3d/planetGen/planetGenBaker.js
//
// WYPIEKACZ MAP PLANETY NA GPU: opis z ziarna (planetGenSpec.js) → tekstury o tych samych rolach co `PLANET_MAPS`
// gry (dzień sRGB, noc sRGB, połysk, chmury sRGB) i mapa RZEŹBY (RGBA16F: wysokość, nachylenie, szorstkość — czyta ją
// materiał powierzchni generatora planetGenSurface.tsl.js), a dla olbrzymów — mapa dnia dla wspólnego silnika żywej
// atmosfery (planetGenGas.js). Bez nowego renderera: dostaje WebGPURenderer gry (Core3D.renderer) albo dema.
//
// Przebieg na planetę: (1) PRÓBA — pole wysokości w 192 × 96 → odczyt CPU → kwantyle ważone polem powierzchni
// (poziom morza z udziału oceanu, progi rodzaju); (2) POLE w pełnej rozdzielczości (RGBA32F, cel wspólny dla planet —
// `releaseScratch()` po układzie); (3) DZIEŃ, RZEŹBA (pełna), POŁYSK, NOC (połowa), CHMURY (pełna) — każde
// tylko gdy potrzebne (plannedMaps), cele z mipmapami. Grafy RAZ na rodzaj × przejście (bakeGraph); pipeline'y
// rozgrzewa `compile(rodzaje)` (compileAsyncNaCelu na celach tych samych formatów — pułapka 30).
//
// Pamięć: mapy planety należą do wyniku (`maps.dispose()`), cel pola i próby — do wypiekacza.
import * as THREE from 'three/webgpu';
import { compileAsyncNaCelu } from '../rozgrzewka.js';
import { resizeRenderTarget } from '../renderTargetResize.js';
import { describePlanet, plannedMaps, plannedBytes } from './planetGenSpec.js';
import { PLANET_GEN_TYPE } from './planetGenTypes.js';
import {
  buildReliefGraph, buildSpecGraph, buildNightGraph, buildCloudGraph, buildMaskGraph, setBakeUniforms, CLOUD_CYCLONES
} from './planetGenBake.tsl.js';
import { SOLID_TYPES } from './planetGenSolid.tsl.js';
import { GAS_BAKE, gasBakeUniforms } from './planetGenGasBake.tsl.js';
import { rngFor } from './planetGenRng.js';

export const PROBE_W = 192;
export const PROBE_H = 96;
const DEG = Math.PI / 180;

function makeTarget(w, h, { srgb = false, red = false, float32 = false, half = false, mips = true, name = '', clamp = false } = {}) {
  const rt = new THREE.RenderTarget(w, h, {
    type: float32 ? THREE.FloatType : (half ? THREE.HalfFloatType : THREE.UnsignedByteType),
    format: red ? THREE.RedFormat : THREE.RGBAFormat,
    depthBuffer: false, stencilBuffer: false,
    generateMipmaps: mips,
    minFilter: float32 ? THREE.NearestFilter : (mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter),
    magFilter: float32 ? THREE.NearestFilter : THREE.LinearFilter
  });
  const t = rt.texture;
  t.name = name;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = (float32 || clamp) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = mips;
  t.anisotropy = mips ? 8 : 1;
  return rt;
}

/** Kwantyle ważone (wagi = cos φ wiersza). `qs` — tablica ułamków. */
export function weightedQuantiles(values, weights, qs) {
  const n = values.length;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => values[a] - values[b]);
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i];
  const out = new Array(qs.length);
  const order = qs.map((q, k) => [q, k]).sort((a, b) => a[0] - b[0]);
  let acc = 0;
  let j = 0;
  for (const [q, k] of order) {
    const target = q * total;
    while (j < n - 1 && acc + weights[idx[j]] < target) { acc += weights[idx[j]]; j++; }
    out[k] = values[idx[j]];
  }
  return out;
}

export class PlanetGenBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.quad = new THREE.QuadMesh();
    this.field = makeTarget(64, 32, { float32: true, mips: false, name: 'planetGenField' });
    this._probes = [];
    this._graphs = new Map();
    this._compiled = new Set();
    this.stats = { bakes: 0, compiles: 0, lastMs: 0 };
  }

  /** Graf przejścia (budowany raz): 'field:<rodzaj>', 'day:<rodzaj>', 'relief', 'spec', 'night', 'clouds', 'gas'. */
  graph(key) {
    let g = this._graphs.get(key);
    if (g) return g;
    const F = this.field.texture;
    const [pass, type] = key.split(':');
    if (pass === 'field') g = SOLID_TYPES[type].field();
    else if (pass === 'day') g = SOLID_TYPES[type].color(F);
    else if (pass === 'relief') g = buildReliefGraph(F);
    else if (pass === 'spec') g = buildSpecGraph(F);
    else if (pass === 'night') g = buildNightGraph(F);
    else if (pass === 'clouds') g = buildCloudGraph();
    else if (pass === 'mask') g = buildMaskGraph(F);
    else if (pass === 'gas') g = GAS_BAKE.build();
    else throw new Error(`planetGen: nieznane przejście „${key}”`);
    this._graphs.set(key, g);
    return g;
  }

  /** Przejścia potrzebne rodzajowi: [klucz grafu, format celu]. */
  passesFor(type) {
    if (PLANET_GEN_TYPE[type].kind === 'gas') return [['gas', 'srgb']];
    return [[`field:${type}`, 'float'], [`day:${type}`, 'srgb'], ['relief', 'half'], ['spec', 'red'], ['night', 'srgb'], ['clouds', 'srgb'], ['mask', 'rgba']];
  }

  /** Rozgrzewka pipeline'ów przejść dla rodzajów (w tle; obietnica — gotowe). */
  async compile(types) {
    const r = this.renderer;
    const dummies = {
      float: this.field, srgb: makeTarget(4, 2, { srgb: true, mips: false }), half: makeTarget(4, 2, { half: true, mips: false }),
      red: makeTarget(4, 2, { red: true, mips: false }), rgba: makeTarget(4, 2, { mips: false })
    };
    const prev = r.getRenderTarget();
    const jobs = [];
    const keys = new Set();
    for (const t of types) for (const [k, fmt] of this.passesFor(t)) if (!this._compiled.has(`${k}|${fmt}`)) keys.add(`${k}|${fmt}`);
    if (!keys.size) return;
    try {
      for (const kf of keys) {
        const [k, fmt] = kf.split('|');
        this.quad.material = this.graph(k).material;
        r.setRenderTarget(dummies[fmt]);
        jobs.push(compileAsyncNaCelu(r, this.quad, this.quad.camera));
        this._compiled.add(kf);
        this.stats.compiles++;
      }
    } finally {
      r.setRenderTarget(prev);
    }
    await Promise.all(jobs);
    for (const k of ['srgb', 'half', 'red', 'rgba']) dummies[k].dispose();
  }

  _draw(graphKey, target, values) {
    const g = this.graph(graphKey);
    setBakeUniforms(g.U, values);
    this.quad.material = g.material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  _ensureField(w, h) {
    resizeRenderTarget(this.field, w, h, this.renderer);
  }

  _probeTarget(i) {
    while (this._probes.length <= i) this._probes.push(makeTarget(PROBE_W, PROBE_H, { float32: true, mips: false, name: `planetGenProbe${this._probes.length}` }));
    return this._probes[i];
  }

  /** Wypiek jednej planety (bakeSystem z jedną planetą). */
  async bake(specOrDesc, opts = {}) {
    return (await this.bakeSystem([specOrDesc], opts))[0];
  }

  /**
   * Wypiek map UKŁADU (lista opisów albo { type, seed, … }): (1) próby pól wszystkich planet z powierzchnią naraz
   * i JEDEN odczyt (opóźnienie odczytu GPU → CPU płaci się raz na układ, nie na planetę), (2) wszystkie przejścia
   * pełnej rozdzielczości bez czekania, (3) jedno czekanie na koniec pracy GPU. `size` — szerokość map (wysokość
   * size / 2), `sizes` — per planeta. Czas GPU (`gpuMs` wyniku całego układu) — ze znaczników czasu, gdy renderer
   * ma `trackTimestamp` (liczy wszystkie przejścia renderu od poprzedniego odczytu — rysunki klatek w tym czasie też).
   * Wynik: tablica { spec, size, maps: { day, relief?, spec?, night?, clouds?, mask? }, levels, gas?, bytes, ms,
   * dispose() }. `mask: true` — dodatkowo mapa masek pola (lawa, osady — materiał zbliżenia, buildMaskGraph).
   */
  async bakeSystem(list, { size = 2048, sizes = null, mask = false } = {}) {
    const r = this.renderer;
    const t0 = performance.now();
    const timed = !!r.backend?.trackTimestamp;
    if (timed) await r.resolveTimestampsAsync('render');
    const items = list.map((d, i) => {
      const spec = d.look ? d : describePlanet(d);
      const W = (sizes && sizes[i]) || size;
      const texKm = 2 * Math.PI * spec.rKm / W;
      const ctx = { size: W, rKm: spec.rKm, texKm };
      const out = { spec, size: W, maps: {}, targets: [], rt: {}, levels: null, gas: null, bytes: plannedBytes(spec, W), ms: {} };
      out.dispose = () => { for (const t of out.targets) t.dispose(); out.targets.length = 0; if (out.gas) out.gas.dispose(); };
      const tu = spec.kind === 'gas' ? null : SOLID_TYPES[spec.type].uniformsFor(spec, ctx);
      return { spec, W, H: W / 2, texKm, ctx, out, tu };
    });
    const common = (it, w, h, extra = {}) => ({
      uSeed: [...it.spec.seedOffset, it.spec.seedInt], uRes: [w, h, 1 / w, 1 / h], uGeo: [it.spec.rKm, it.texKm, 0, 0],
      // cała mapa: gałąź wycinka wyłączona (w = 0), jej uniformy skończone i niezdegenerowane
      uWin: [0, 0, 1e-3, 0], uFrX: [1, 0, 0], uFrY: [0, 1, 0], uFrZ: [0, 0, 1], ...extra
    });
    const prev = r.getRenderTarget();
    try {
      // (1) próby (kanał w pola) — wszystkie naraz, jeden odczyt
      const solids = items.filter((it) => it.tu);
      const reads = solids.map((it, k) => {
        const oct = [it.tu.octaves.x, it.tu.octaves.y, it.tu.octaves.z, it.tu.octaves.w];
        it.oct = oct;
        const rt = this._probeTarget(k);
        this._draw(`field:${it.spec.type}`, rt, { ...common(it, PROBE_W, PROBE_H), uOct: oct, uLevels: [0, 1, 0, 0], ...it.tu.field });
        return r.readRenderTargetPixelsAsync(rt, 0, 0, PROBE_W, PROBE_H);
      });
      const pixels = await Promise.all(reads);
      const tProbe = performance.now() - t0;
      const ws = new Float32Array(PROBE_W * PROBE_H);
      for (let y = 0; y < PROBE_H; y++) ws.fill(Math.cos(((y + 0.5) / PROBE_H - 0.5) * Math.PI), y * PROBE_W, (y + 1) * PROBE_W);
      const vs = new Float32Array(PROBE_W * PROBE_H);
      solids.forEach((it, k) => {
        const px = pixels[k];
        for (let i = 0; i < vs.length; i++) vs[i] = px[i * 4 + 3];
        const pq = it.tu.probeQ.map((q) => Math.min(0.999, Math.max(1e-4, q)));
        const qs = weightedQuantiles(vs, ws, [...pq, 0.01, 0.99, 0, 1]);
        it.uQ = qs.slice(0, 4);
        it.uQ2 = qs.slice(4, 8);
        it.out.levels = { uQ: it.uQ, uQ2: it.uQ2, sea: it.tu.water ? 0 : null };
        it.out.ms.probe = tProbe;
      });
      // (2) przejścia pełnej rozdzielczości
      for (const it of items) {
        const { spec, W, H, out } = it;
        const name = (m) => `planetGen:${spec.type}:${spec.seed}:${m}`;
        if (spec.kind === 'gas') {
          const day = makeTarget(W, H, { srgb: true, name: name('day') });
          out.targets.push(day);
          const gv = gasBakeUniforms(spec, it.ctx);
          gv.arrays(this.graph('gas'));
          this._draw('gas', day, { ...common(it, W, H), ...gv.values });
          out.maps.day = day.texture;
          out.rt.day = day;
          out.gas = gv.engine;
          // tekstura profilu wiatru na GPU od razu (węzeł tekstury per obiekt jej nie wgrywa — pusty sampler w grupie)
          r.initTexture(gv.engine.windTexture());
          continue;
        }
        const tu = it.tu;
        const plan = plannedMaps(spec);
        const levels = { uLevels: [tu.water ? 0 : -1e3, tu.landTop || 3, tu.water ? 1 : 0, 0], uQ: it.uQ, uQ2: it.uQ2, uOct: it.oct };
        this._ensureField(W, H);
        this._draw(`field:${spec.type}`, this.field, { ...common(it, W, H), ...levels, ...tu.field });
        const day = makeTarget(W, H, { srgb: true, name: name('day') });
        out.targets.push(day);
        this._draw(`day:${spec.type}`, day, { ...common(it, W, H), ...levels, ...tu.color });
        out.maps.day = day.texture;
        out.rt.day = day;
        const relief = makeTarget(W, H, { half: true, name: name('relief') });
        out.targets.push(relief);
        this._draw('relief', relief, { ...common(it, W, H), ...levels, uRel: spec.relief.rough });
        out.maps.relief = relief.texture;
        out.rt.relief = relief;
        if (plan.spec) {
          const t = makeTarget(W / 2, H / 2, { red: true, name: name('spec') });
          out.targets.push(t);
          this._draw('spec', t, { ...common(it, W / 2, H / 2), ...levels, uSpec: tu.spec || [0, 0, 0, 0] });
          out.maps.spec = t.texture;
          out.rt.spec = t;
        }
        if (plan.night) {
          const t = makeTarget(W / 2, H / 2, { srgb: true, name: name('night') });
          out.targets.push(t);
          this._draw('night', t, { ...common(it, W / 2, H / 2), ...levels, ...nightUniforms(spec, tu) });
          out.maps.night = t.texture;
          out.rt.night = t;
        }
        if (plan.clouds) {
          const t = makeTarget(W, H, { srgb: true, name: name('clouds') });
          out.targets.push(t);
          this._draw('clouds', t, { ...common(it, W, H), ...levels, ...cloudUniforms(spec, it.ctx) });
          out.maps.clouds = t.texture;
          out.rt.clouds = t;
        }
        if (mask) {
          const t = makeTarget(W, H, { name: name('mask') });
          out.targets.push(t);
          this._draw('mask', t, { ...common(it, W, H), ...levels });
          out.maps.mask = t.texture;
          out.rt.mask = t;
          out.bytes += Math.round(W * H * 4 * 4 / 3);
        }
      }
    } finally {
      r.setRenderTarget(prev);
    }
    const device = r.backend?.device;
    if (device?.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    const total = performance.now() - t0;
    const gpuMs = timed ? await r.resolveTimestampsAsync('render') : null;
    this.stats.bakes += items.length;
    this.stats.lastMs = total;
    this.stats.lastGpuMs = gpuMs;
    for (const it of items) { it.out.ms.total = total; it.out.ms.system = items.length; it.out.ms.gpu = gpuMs; }
    return items.map((it) => it.out);
  }

  /**
   * Cele WYCINKA pod kamerą (planetGenPatch.js): dzień sRGB, rzeźba RGBA16F, maski RGBA8 — z mipmapami, bez
   * zawijania. Wynik: { day, relief, mask, width, height, bytes, dispose() }.
   */
  createPatchTargets(width, height, tag = '') {
    const day = makeTarget(width, height, { srgb: true, clamp: true, name: `planetGenPatch:${tag}:day` });
    const relief = makeTarget(width, height, { half: true, clamp: true, name: `planetGenPatch:${tag}:relief` });
    const mask = makeTarget(width, height, { clamp: true, name: `planetGenPatch:${tag}:mask` });
    const set = {
      day, relief, mask, width, height, bytes: Math.round(width * height * (4 + 8 + 4) * 4 / 3),
      dispose() { day.dispose(); relief.dispose(); mask.dispose(); }
    };
    // cele na GPU od razu (węzły tekstur per obiekt nie wgrywają pustych — pusty próbnik w grupie wiązań)
    const r = this.renderer;
    const prev = r.getRenderTarget();
    for (const t of [day, relief, mask]) { r.setRenderTarget(t); r.clear(); }
    r.setRenderTarget(prev);
    return set;
  }

  /**
   * Wypiek WYCINKA mapy planety do celów `set` (createPatchTargets) — synchronicznie, bez odczytów: POLE (cel pola
   * wypiekacza w rozmiarze wycinka — nie wołaj `releaseScratch` między wycinkami), DZIEŃ, RZEŹBA, MASKI. `base` —
   * wynik `bakeSystem` tej planety (progi z próby całej planety — te same morza i kwantyle), `win` — okno:
   * { frame: { x, y, z } (osie układu wycinka), a0, b0 (kąt lewej górnej krawędzi [rad]), st (kąt teksela [rad]) }.
   * `tu` — `uniformsFor` rodzaju dla rozdzielczości wycinka (liczby oktaw, kratery; pamięć po poziomie u wołającego).
   */
  bakePatch(base, win, set, tu = null) {
    const r = this.renderer;
    const spec = base.spec;
    if (spec.kind === 'gas') throw new Error('planetGen: wycinek tylko dla planet z powierzchnią');
    const W = set.width;
    const H = set.height;
    const texKm = spec.rKm * win.st;
    const ctx = { size: Math.round(2 * Math.PI / win.st), rKm: spec.rKm, texKm };
    const t = tu || SOLID_TYPES[spec.type].uniformsFor(spec, ctx);
    const common = {
      uSeed: [...spec.seedOffset, spec.seedInt], uRes: [W, H, 1 / W, 1 / H], uGeo: [spec.rKm, texKm, 0, 0],
      uWin: [win.a0, win.b0, win.st, 1], uFrX: win.frame.x, uFrY: win.frame.y, uFrZ: win.frame.z,
      uLevels: [t.water ? 0 : -1e3, t.landTop || 3, t.water ? 1 : 0, 0], uQ: base.levels.uQ, uQ2: base.levels.uQ2,
      uOct: [t.octaves.x, t.octaves.y, t.octaves.z, t.octaves.w]
    };
    const prev = r.getRenderTarget();
    try {
      this._ensureField(W, H);
      this._draw(`field:${spec.type}`, this.field, { ...common, ...t.field });
      this._draw(`day:${spec.type}`, set.day, { ...common, ...t.color });
      this._draw('relief', set.relief, { ...common, uRel: spec.relief.rough });
      this._draw('mask', set.mask, common);
    } finally {
      r.setRenderTarget(prev);
    }
    this.stats.patches = (this.stats.patches || 0) + 1;
    return t;
  }

  /**
   * Kroki wypieku wycinka W PASACH (planetGenPatch.js piecze krok na klatkę): [{ pass, band, bands }]. Pas = poziomy
   * pasek celu (nożyce); `mpPerStep` — ile megapikseli pola na krok (pole ~1 ms GPU na megapiksel, dzień ~0,7).
   * Kolejność przejść jak w `bakePatch`: całe POLE przed DNIEM, RZEŹBĄ i MASKAMI (czytają sąsiednie teksele pola).
   */
  patchSteps(set, kind = 'surface', mpPerStep = 2.2) {
    const B = Math.max(1, Math.ceil(set.width * set.height / 1e6 / mpPerStep));
    const steps = [];
    const add = (pass, n) => { for (let i = 0; i < n; i++) steps.push({ pass, band: i, bands: n }); };
    if (kind === 'clouds') { add('clouds', Math.max(1, Math.ceil(B * 0.8))); return steps; }
    add('field', B);
    add('day', Math.max(1, Math.ceil(B * 0.7)));
    add('relief', Math.max(1, Math.ceil(B / 3)));
    add('mask', Math.max(1, Math.ceil(B / 4)));
    return steps;
  }

  // Rysunek jednego pasa przejścia do celu: nożyce na pas, bez czyszczenia celu (czyszczenie w WebGPU nie zna nożyc —
  // starłoby pasy już wypieczone), mipmapy dopiero po ostatnim pasie.
  _drawBand(graphKey, target, values, band, bands) {
    const g = this.graph(graphKey);
    setBakeUniforms(g.U, values);
    this.quad.material = g.material;
    const r = this.renderer;
    const y0 = Math.round(target.height * band / bands);
    const y1 = Math.round(target.height * (band + 1) / bands);
    const tex = target.texture;
    const mips = tex.generateMipmaps;
    const auto = r.autoClear;
    // AGENT: prostokąt nożyc bierze się z CELU (renderTarget.scissor), ale włącza je flaga RENDERERA
    // (setScissorTest) — sama flaga celu nic nie robi i każdy „pas” rysował cały cel (wypiek ×4 droższy, obraz ten sam)
    const st = r.getScissorTest();
    target.scissor.set(0, y0, target.width, y1 - y0);
    if (band < bands - 1) tex.generateMipmaps = false;
    r.autoClear = bands === 1;
    r.setScissorTest(bands > 1);
    try {
      r.setRenderTarget(target);
      this.quad.render(r);
    } finally {
      r.setScissorTest(st);
      r.autoClear = auto;
      tex.generateMipmaps = mips;
      target.scissor.set(0, 0, target.width, target.height);
    }
  }

  /**
   * Jeden krok wypieku wycinka (`step` z `patchSteps`) — jak `bakePatch` / `bakeCloudPatch`, ale jeden pas jednego
   * przejścia. Zwraca `tu` (uniformsFor rodzaju dla rozdzielczości okna — podaj je w kolejnych krokach).
   */
  bakePatchStep(base, win, set, tu, step) {
    const r = this.renderer;
    const spec = base.spec;
    const W = set.width;
    const H = set.height;
    const texKm = spec.rKm * win.st;
    const ctx = { size: Math.round(2 * Math.PI / win.st), rKm: spec.rKm, texKm };
    const frame = {
      uSeed: [...spec.seedOffset, spec.seedInt], uRes: [W, H, 1 / W, 1 / H], uGeo: [spec.rKm, texKm, 0, 0],
      uWin: [win.a0, win.b0, win.st, 1], uFrX: win.frame.x, uFrY: win.frame.y, uFrZ: win.frame.z
    };
    const prev = r.getRenderTarget();
    try {
      if (step.pass === 'clouds') {
        this._drawBand('clouds', set.clouds, { ...frame, ...cloudUniforms(spec, ctx) }, step.band, step.bands);
        return null;
      }
      const t = tu || SOLID_TYPES[spec.type].uniformsFor(spec, ctx);
      const common = {
        ...frame, uLevels: [t.water ? 0 : -1e3, t.landTop || 3, t.water ? 1 : 0, 0], uQ: base.levels.uQ, uQ2: base.levels.uQ2,
        uOct: [t.octaves.x, t.octaves.y, t.octaves.z, t.octaves.w]
      };
      if (step.pass === 'field') {
        this._ensureField(W, H);
        this._drawBand(`field:${spec.type}`, this.field, { ...common, ...t.field }, step.band, step.bands);
      } else if (step.pass === 'day') this._drawBand(`day:${spec.type}`, set.day, { ...common, ...t.color }, step.band, step.bands);
      else if (step.pass === 'relief') this._drawBand('relief', set.relief, { ...common, uRel: spec.relief.rough }, step.band, step.bands);
      else this._drawBand('mask', set.mask, common, step.band, step.bands);
      if (step.band === step.bands - 1 && step.pass === 'mask') this.stats.patches = (this.stats.patches || 0) + 1;
      return t;
    } finally {
      r.setRenderTarget(prev);
    }
  }

  /** Cel WYCINKA MAPY CHMUR pod kamerą (sRGB z mipmapami, bez zawijania). Wynik: { clouds, width, height, bytes, dispose() }. */
  createCloudPatchTarget(width, height, tag = '') {
    const clouds = makeTarget(width, height, { srgb: true, clamp: true, name: `planetGenPatch:${tag}:clouds` });
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(clouds);
    r.clear();
    r.setRenderTarget(prev);
    return { clouds, width, height, bytes: Math.round(width * height * 4 * 4 / 3), dispose() { clouds.dispose(); } };
  }

  /** Wypiek WYCINKA mapy chmur do `set.clouds` (okno `win` jak w `bakePatch`, w układzie kuli chmur). */
  bakeCloudPatch(base, win, set) {
    const r = this.renderer;
    const spec = base.spec;
    const W = set.width;
    const H = set.height;
    const texKm = spec.rKm * win.st;
    const ctx = { size: Math.round(2 * Math.PI / win.st), rKm: spec.rKm, texKm };
    const prev = r.getRenderTarget();
    try {
      this._draw('clouds', set.clouds, {
        uSeed: [...spec.seedOffset, spec.seedInt], uRes: [W, H, 1 / W, 1 / H], uGeo: [spec.rKm, texKm, 0, 0],
        uWin: [win.a0, win.b0, win.st, 1], uFrX: win.frame.x, uFrY: win.frame.y, uFrZ: win.frame.z,
        ...cloudUniforms(spec, ctx)
      });
    } finally {
      r.setRenderTarget(prev);
    }
    this.stats.patches = (this.stats.patches || 0) + 1;
    return null;
  }

  /** Zwalnia cel pola (wspólny dla planet — po wypieku układu). */
  releaseScratch() {
    resizeRenderTarget(this.field, 64, 32, this.renderer);
  }

  dispose() {
    this.field.dispose();
    for (const p of this._probes) p.dispose();
    for (const g of this._graphs.values()) g.material.dispose();
    this._graphs.clear();
  }
}

// ── Uniformy wspólnych przejść z opisu ───────────────────────────────────────────────────────────────────────────
function nightUniforms(spec, tu) {
  const n = spec.night;
  const civ = tu.civ || {};
  return {
    uCiv: [n.cities, civ.landOnly ?? 1, civ.latDeg ?? 50, civ.sea ?? 0],
    uCiv2: [civ.habW ?? 0, civ.freq ?? 26, civ.gain ?? 1, 0],
    uLava: [n.lava, 0, 0, 0],
    uLavaCol: tu.lavaColor || [1.0, 0.42, 0.08]
  };
}

function cloudUniforms(spec, ctx) {
  const c = spec.clouds;
  const rng = rngFor(spec.seed, `${spec.type}:cyklony`);
  const out = {
    uCloud: [c.cover, c.stretch, Math.min(CLOUD_CYCLONES, c.cyclones), c.style],
    uCloud2: [c.sizeMul * Math.sqrt(6371 / spec.rKm) ** 0.35, c.style === 0 ? 0.15 : 0.2, spec.look.bands ?? 0.6, (spec.look.swirl ?? 0.5) * 0.9],
    uTint: c.tint,
    uTint2: c.tint2 || c.tint,
    // (sufit 13: mapy planety ≤ 4096 px mają ≤ 8 oktaw — więcej liczą tylko wycinki pod kamerą)
    uOct: [0, 0, 0, Math.max(3, Math.min(13, Math.floor(Math.log2(ctx.size / 64)) + 2))]
  };
  for (let i = 0; i < CLOUD_CYCLONES; i++) {
    const hemi = rng.next() < 0.5 ? 1 : -1;
    // co trzeci tropikalny (12–28°, mały z okiem), reszta pozatropikalne (35–62°, duże, luźne — fronty)
    const tropical = i % 3 === 2;
    const d = tropical ? rng.dirInLat(12 * hemi, 28 * hemi) : rng.dirInLat(35 * hemi, 62 * hemi);
    out[`uCyc${i}`] = [...d, tropical ? rng.range(0.05, 0.09) : rng.range(0.16, 0.28)];
  }
  return out;
}

export { DEG };
