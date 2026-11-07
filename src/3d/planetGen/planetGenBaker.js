// src/3d/planetGen/planetGenBaker.js
//
// WYPIEKACZ MAP PLANETY NA GPU: opis z ziarna (planetGenSpec.js) → tekstury o tych samych rolach co `PLANET_MAPS`
// gry (dzień sRGB, noc sRGB, połysk, normalne R = wschód / G = północ, chmury sRGB) albo — dla olbrzymów — mapa dnia
// dla wspólnego silnika żywej atmosfery (planetGenGas.js). Bez nowego renderera: dostaje WebGPURenderer gry
// (Core3D.renderer) albo dema.
//
// Przebieg na planetę: (1) PRÓBA — pole wysokości w 192 × 96 → odczyt CPU → kwantyle ważone polem powierzchni
// (poziom morza z udziału oceanu, progi rodzaju); (2) POLE w pełnej rozdzielczości (RGBA32F, cel wspólny dla planet —
// `releaseScratch()` po układzie); (3) DZIEŃ, NORMALNE (pełna), POŁYSK, NOC (połowa), CHMURY (pełna) — każde
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
  buildNormalGraph, buildSpecGraph, buildNightGraph, buildCloudGraph, setBakeUniforms, CLOUD_CYCLONES
} from './planetGenBake.tsl.js';
import { SOLID_TYPES } from './planetGenSolid.tsl.js';
import { GAS_BAKE, gasBakeUniforms } from './planetGenGasBake.tsl.js';
import { rngFor } from './planetGenRng.js';

export const PROBE_W = 192;
export const PROBE_H = 96;
const DEG = Math.PI / 180;

function makeTarget(w, h, { srgb = false, red = false, float32 = false, mips = true, name = '' } = {}) {
  const rt = new THREE.RenderTarget(w, h, {
    type: float32 ? THREE.FloatType : THREE.UnsignedByteType,
    format: red ? THREE.RedFormat : THREE.RGBAFormat,
    depthBuffer: false, stencilBuffer: false,
    generateMipmaps: mips,
    minFilter: float32 ? THREE.NearestFilter : (mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter),
    magFilter: float32 ? THREE.NearestFilter : THREE.LinearFilter
  });
  const t = rt.texture;
  t.name = name;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = float32 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
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
    this.probe = makeTarget(PROBE_W, PROBE_H, { float32: true, mips: false, name: 'planetGenProbe' });
    this._graphs = new Map();
    this._compiled = new Set();
    this.stats = { bakes: 0, compiles: 0, lastMs: 0 };
  }

  /** Graf przejścia (budowany raz): 'field:<rodzaj>', 'day:<rodzaj>', 'normal', 'spec', 'night', 'clouds', 'gas'. */
  graph(key) {
    let g = this._graphs.get(key);
    if (g) return g;
    const F = this.field.texture;
    const [pass, type] = key.split(':');
    if (pass === 'field') g = SOLID_TYPES[type].field();
    else if (pass === 'day') g = SOLID_TYPES[type].color(F);
    else if (pass === 'normal') g = buildNormalGraph(F);
    else if (pass === 'spec') g = buildSpecGraph(F);
    else if (pass === 'night') g = buildNightGraph(F);
    else if (pass === 'clouds') g = buildCloudGraph();
    else if (pass === 'gas') g = GAS_BAKE.build();
    else throw new Error(`planetGen: nieznane przejście „${key}”`);
    this._graphs.set(key, g);
    return g;
  }

  /** Przejścia potrzebne rodzajowi: [klucz grafu, format celu]. */
  passesFor(type) {
    if (PLANET_GEN_TYPE[type].kind === 'gas') return [['gas', 'srgb']];
    return [[`field:${type}`, 'float'], [`day:${type}`, 'srgb'], ['normal', 'rgba'], ['spec', 'red'], ['night', 'srgb'], ['clouds', 'srgb']];
  }

  /** Rozgrzewka pipeline'ów przejść dla rodzajów (w tle; obietnica — gotowe). */
  async compile(types) {
    const r = this.renderer;
    const dummies = {
      float: this.field, srgb: makeTarget(4, 2, { srgb: true, mips: false }), rgba: makeTarget(4, 2, { mips: false }),
      red: makeTarget(4, 2, { red: true, mips: false })
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
    for (const k of ['srgb', 'rgba', 'red']) dummies[k].dispose();
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

  /**
   * Wypiek map planety. `specOrDesc` — opis (describePlanet) albo { type, seed, … }. `size` — szerokość map
   * w pełnej rozdzielczości (wysokość = size / 2). Wynik: { spec, size, maps: { day, normal?, spec?, night?, clouds? }
   * (tekstury celów), levels, gas? (dane silnika atmosfery), bytes, ms: { probe, total }, dispose() }.
   */
  async bake(specOrDesc, { size = 2048 } = {}) {
    const spec = specOrDesc.look ? specOrDesc : describePlanet(specOrDesc);
    const r = this.renderer;
    const t0 = performance.now();
    const W = size;
    const H = size / 2;
    const texKm = 2 * Math.PI * spec.rKm / W;
    const ctx = { size: W, rKm: spec.rKm, texKm };
    const plan = plannedMaps(spec);
    const out = { spec, size: W, maps: {}, targets: [], levels: null, gas: null, bytes: plannedBytes(spec, W), ms: {} };
    const prev = r.getRenderTarget();
    const common = (w, h, extra = {}) => ({
      uSeed: [...spec.seedOffset, spec.seedInt], uRes: [w, h, 1 / w, 1 / h], uGeo: [spec.rKm, texKm, 0, 0], ...extra
    });
    try {
      if (spec.kind === 'gas') {
        const day = makeTarget(W, H, { srgb: true, name: `planetGen:${spec.type}:${spec.seed}:day` });
        out.targets.push(day);
        const gv = gasBakeUniforms(spec, ctx);
        gv.arrays(this.graph('gas'));
        this._draw('gas', day, { ...common(W, H), ...gv.values });
        out.maps.day = day.texture;
        out.gas = gv.engine;
        // tekstura profilu wiatru na GPU od razu (węzeł tekstury per obiekt nie wgrywa jej sam — pusty sampler w grupie)
        r.initTexture(gv.engine.windTexture());
      } else {
        const T = SOLID_TYPES[spec.type];
        const tu = T.uniformsFor(spec, ctx);
        const oct = [tu.octaves.x, tu.octaves.y, tu.octaves.z, tu.octaves.w];
        // (1) próba: kwantyle wysokości
        this._draw(`field:${spec.type}`, this.probe, { ...common(PROBE_W, PROBE_H), uOct: oct, ...tu.field });
        const px = await r.readRenderTargetPixelsAsync(this.probe, 0, 0, PROBE_W, PROBE_H);
        const hs = new Float32Array(PROBE_W * PROBE_H);
        const ws = new Float32Array(PROBE_W * PROBE_H);
        const rowF = px.length / (PROBE_W * PROBE_H) >= 4 ? 4 : 4;
        for (let y = 0; y < PROBE_H; y++) {
          const lat = ((y + 0.5) / PROBE_H - 0.5) * Math.PI;
          const w = Math.cos(lat);
          for (let x = 0; x < PROBE_W; x++) {
            const i = y * PROBE_W + x;
            hs[i] = px[i * rowF];
            ws[i] = w;
          }
        }
        const water = spec.look.water || 0;
        const [sea, q01, q10, q50, q90, q99, qMin, qMax] = weightedQuantiles(hs, ws, [Math.max(water, 1e-6), 0.01, 0.1, 0.5, 0.9, 0.99, 0, 1]);
        const seaLevel = water > 0 ? sea : qMin - 1e3;
        out.levels = { sea: seaLevel, q01, q10, q50, q90, q99, min: qMin, max: qMax };
        out.ms.probe = performance.now() - t0;
        const levels = { uLevels: [seaLevel, q10, q50, q90], uLevels2: [q01, q99, qMin, qMax], uOct: oct };
        // (2) pole
        this._ensureField(W, H);
        this._draw(`field:${spec.type}`, this.field, { ...common(W, H), ...levels, ...tu.field });
        // (3) mapy
        const day = makeTarget(W, H, { srgb: true, name: `planetGen:${spec.type}:${spec.seed}:day` });
        out.targets.push(day);
        this._draw(`day:${spec.type}`, day, { ...common(W, H), ...levels, ...tu.color });
        out.maps.day = day.texture;
        const normal = makeTarget(W, H, { name: `planetGen:${spec.type}:${spec.seed}:normal` });
        out.targets.push(normal);
        this._draw('normal', normal, { ...common(W, H), ...levels, uNorm: [tu.norm[0], water > 0 ? 1 : 0, 0, 0] });
        out.maps.normal = normal.texture;
        if (plan.spec) {
          const t = makeTarget(W / 2, H / 2, { red: true, name: `planetGen:${spec.type}:${spec.seed}:spec` });
          out.targets.push(t);
          this._draw('spec', t, { ...common(W / 2, H / 2), ...levels, uSpec: tu.spec || [water > 0 ? 1 : 0, 0, 0, 0] });
          out.maps.spec = t.texture;
        }
        if (plan.night) {
          const t = makeTarget(W / 2, H / 2, { srgb: true, name: `planetGen:${spec.type}:${spec.seed}:night` });
          out.targets.push(t);
          this._draw('night', t, { ...common(W / 2, H / 2), ...levels, ...nightUniforms(spec, tu) });
          out.maps.night = t.texture;
        }
        if (plan.clouds) {
          const t = makeTarget(W, H, { srgb: true, name: `planetGen:${spec.type}:${spec.seed}:clouds` });
          out.targets.push(t);
          this._draw('clouds', t, { ...common(W, H), ...levels, ...cloudUniforms(spec, ctx) });
          out.maps.clouds = t.texture;
        }
      }
    } finally {
      r.setRenderTarget(prev);
    }
    const device = r.backend?.device;
    if (device?.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    out.ms.total = performance.now() - t0;
    this.stats.bakes++;
    this.stats.lastMs = out.ms.total;
    out.dispose = () => { for (const t of out.targets) t.dispose(); out.targets.length = 0; };
    return out;
  }

  /** Zwalnia cel pola (wspólny dla planet — po wypieku układu). */
  releaseScratch() {
    resizeRenderTarget(this.field, 64, 32, this.renderer);
  }

  dispose() {
    this.field.dispose();
    this.probe.dispose();
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
    uCloud2: [c.sizeMul * Math.sqrt(6371 / spec.rKm) ** 0.35, c.style === 0 ? 0.11 : 0.2, spec.look.bands ?? 0.6, (spec.look.swirl ?? 0.5) * 0.9],
    uTint: c.tint,
    uOct: [0, 0, 0, Math.max(3, Math.min(8, Math.floor(Math.log2(ctx.size / 64)) + 2))]
  };
  for (let i = 0; i < CLOUD_CYCLONES; i++) {
    const hemi = rng.next() < 0.5 ? 1 : -1;
    const d = rng.dirInLat(12 * hemi, 38 * hemi);
    out[`uCyc${i}`] = [...d, rng.range(0.06, 0.14)];
  }
  return out;
}

export { DEG };
