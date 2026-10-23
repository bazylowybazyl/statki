// src/game/hullDesign/hullDesignBuild.js
//
// KREATOR KADŁUBÓW — BUDOWA ZALEŻNA OD ZMIANY (czysta: bez three i DOM; działa w workerze budowy
// hullDesignBuild.worker.js i wprost w Node / na stronie). Projekt → pakiet dla kompozytora i edytora, liczony
// etapami z pamięcią wyników po kluczu wejścia etapu:
//
//   rozwinięcie (zawsze, tanie) → GEOMETRIA (bryły, styl, detal, rozdzielczość: pola poziomów, metryka ośmiokątna,
//   kopuła) → ROWKI → SIEĆ (moduły, rury ręczne, ustawienia sieci + geometria) → MOC (martwe kable z bilansu klasy)
//   → klasa, receptura, mocowania → PAKIETY tekstur kompozytora (float16, ten sam wynik co setDesign) → przy pełnej
//   budowie: kontrola sieci, systemy, spójność ramy, alfa fizyki (ciało gry).
//
// Zmiana barw, naklejek albo klasy nie rusza geometrii ani sieci; przesunięcie modułu (bez bryły) — tylko sieć.
// Między etapami `yieldFn` (worker: oddaje pętlę zdarzeń, żeby nowsza praca mogła anulować starą); zwrócone
// `false` przerywa budowę (wynik null). Opis: docs/KREATOR-KADLUBA.md § „Płynność edycji”.

import { expandHullDesign } from './hullDesignSchema.js';
import {
  hullFieldGeometry, hullFieldGrooves, hullFieldPipes, hullFieldScale, rasterHullAlpha, hullCells, hullFrameIntegrity
} from './hullDesignGeometry.js';
import { hullDesignClass, applyHullDesignPower } from './hullDesignClass.js';
import { hullDesignRecipe, hullDesignMounts } from './hullDesignRecipe.js';
import { hullDesignSystems } from './hullDesignSystems.js';
import { pipeNetworkCheck } from './hullDesignPipes.js';
import { packHalfChannel, toHalfBits, halfFromF32Bits } from './hullDesignHalf.js';

// Pola obiektów rozwiniętych, które nie wpływają na wynik etapów (odwołania do części / kasztelu, znacznik kopii
// lustra) — poza kluczem (inaczej klucz niósłby całe definicje części).
const KEY_SKIP = new Set(['part', 'castle', 'mirrorOf', '_loops']);
const keyOf = (v) => JSON.stringify(v, (k, x) => (KEY_SKIP.has(k) ? undefined : (x instanceof Map ? [...x] : x)));

/** Mała pamięć LRU (ostatnie `cap` wpisów — przeciąganie w połowie rozdzielczości i pełna budowa obok siebie). */
function lru(cap) {
  const m = new Map();
  return {
    get(k) { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; },
    set(k, v) { m.delete(k); m.set(k, v); while (m.size > cap) m.delete(m.keys().next().value); return v; },
    clear() { m.clear(); }
  };
}

/** Tekstury kompozytora z geometrii: pola poziomów (RGBA16F) i kopuła + pola ośmiokątne 1–3 (RGBA16F). */
export function packHullFieldTextures(geo) {
  const n = geo.grid.w * geo.grid.h;
  const field = new Uint16Array(n * 4);
  for (let c = 0; c < 4; c++) packHalfChannel(field, c, geo.levels[c]);
  const aux = new Uint16Array(n * 4);
  packHalfChannel(aux, 0, geo.dome);
  const oct = geo.oct || [null, geo.levels[1], geo.levels[2], geo.levels[3]];
  for (let c = 1; c < 4; c++) packHalfChannel(aux, c, oct[c]);
  return { field, aux };
}

/** Tekstura rowków (RGBA16F): odległość [j.], szerokość najbliższego rowku [jd]. */
export function packHullGrooveTexture(groove, grooveBand, n) {
  const gr = new Uint16Array(n * 4);
  if (groove) {
    packHalfChannel(gr, 0, groove);
    if (groove.width) packHalfChannel(gr, 1, groove.width);
    else { const g14 = toHalfBits(1.4); for (let i = 0; i < n; i++) gr[i * 4 + 1] = g14; }
  } else {
    const gcap = toHalfBits(grooveBand || 1e3), g14 = toHalfBits(1.4);
    for (let i = 0; i < n; i++) { gr[i * 4] = gcap; gr[i * 4 + 1] = g14; }
  }
  return gr;
}

/**
 * Tekstury sieci rur (jak HullComposer._setPipes): pipeA (RGBA16F na siatce pola — przesunięcie, cos φ, sin φ,
 * odcinek; poza siecią 1000, 1), pipeB (RGBA8 — numer biegu, osprzętu); bez sieci — 1 × 1.
 */
export function packHullPipeTextures(pipeNet, pipeTex, grid) {
  const on = !!(pipeNet && pipeTex && pipeNet.runs.length + pipeNet.fits.length > 0);
  const hT = toHalfBits(1000), h1 = toHalfBits(1);
  if (!on) return { on, w: 1, h: 1, a: new Uint16Array([hT, h1, 0, 0]), b: new Uint8Array(4) };
  const n = grid.w * grid.h;
  const pa = new Uint16Array(n * 4);
  const A = pipeTex.a, M = pipeTex.mask;
  const bits = new Uint32Array(A.buffer, A.byteOffset, A.length);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (!M[i]) { pa[o] = hT; pa[o + 1] = h1; continue; }
    for (let c = 0; c < 4; c++) {
      const v = A[o + c];
      pa[o + c] = v > 65504 || v < -65504 ? toHalfBits(v) : halfFromF32Bits(bits[o + c]);
    }
  }
  return { on, w: grid.w, h: grid.h, a: pa, b: pipeTex.b };
}

/**
 * Budowniczy z pamięcią etapów. `run(design, opts, yieldFn)`:
 *   opts.fast — połowa rozdzielczości pola (przeciąganie): bez ciała gry; sieć z poprzedniego podglądu (`pipesStale`),
 *               gdy siatka pola i liczba modułów te same,
 *   opts.full — alfa fizyki i komórki belek (ciało gry); potem `checks()` — kontrola sieci, systemy, spójność ramy,
 *   opts.pipeTune, opts.tune — strojenie sieci / pola (jak buildHullField).
 * Zwraca { field (jak buildHullField; pakiety tekstur w `field.packed`, `oct` / `dome` / `groove` / `pipeTex` tylko
 * w pakietach), keys, cls, recipe, mounts, physics, cells, timing } albo null (przerwane); kontrola sieci i ramy
 * pełnej budowy — osobno, `checks()`.
 */
export function createHullDesignBuilder() {
  const C = { geo: lru(2), groove: lru(2), pipes: lru(2), power: lru(3), packGeo: lru(2), packGroove: lru(2), packPipes: lru(3), full: lru(2) };
  async function run(design, opts = {}, yieldFn = null) {
    const T = {};
    let t = performance.now();
    const lap = (k) => { const n = performance.now(); T[k] = Math.round((n - t) * 10) / 10; t = n; };
    const step = async () => (yieldFn ? (await yieldFn()) !== false : true);
    const expanded = expandHullDesign(design);
    const d = expanded.design;
    const fieldRes = opts.fast ? hullFieldScale(d).res * 0.5 : (Number(opts.fieldRes) > 0 ? Number(opts.fieldRes) : 0);
    lap('rozwiniecie');
    // GEOMETRIA
    const kGeo = keyOf([expanded.shapes, expanded.blocks, d.style, d.detail, fieldRes, opts.tune || null]);
    let geo = C.geo.get(kGeo);
    if (!geo) {
      if (!await step()) return null;
      geo = C.geo.set(kGeo, hullFieldGeometry(expanded, { fieldRes, tune: opts.tune }));
    }
    lap('geometria');
    // ROWKI
    const kGroove = `${kGeo}|${keyOf(expanded.grooves)}`;
    let gr = C.groove.get(kGroove);
    if (!gr) gr = C.groove.set(kGroove, hullFieldGrooves(expanded, geo));
    lap('rowki');
    // SIEĆ (przed oznaczeniem mocy)
    const kPipes = `${kGeo}|${keyOf([expanded.modules, expanded.pipes, d.pipeNet, d.seed, d.mirror, d.detail, opts.pipeTune || null])}`;
    // Przeciąganie (fast): sieć z ostatniego podglądu na tej samej siatce pola zamiast tras od nowa (A* to najdroższy
    // etap — kadr podglądu ma nadążać za myszą); po puszczeniu pełna budowa liczy prawdziwe trasy.
    const gridKey = `${geo.grid.x0},${geo.grid.y0},${geo.grid.w},${geo.grid.h},${geo.grid.res}`;
    let net0 = C.pipes.get(kPipes);
    let pipesStale = false;
    if (!net0 && opts.fast && lastFastPipes && lastFastPipes.gridKey === gridKey && lastFastPipes.modules === expanded.modules.length) {
      net0 = lastFastPipes.net0;
      pipesStale = true;
    }
    if (!net0) {
      if (!await step()) return null;
      net0 = C.pipes.set(kPipes, hullFieldPipes(expanded, geo, opts.pipeTune));
    }
    if (opts.fast) lastFastPipes = { gridKey, modules: expanded.modules.length, net0, kPipes: pipesStale ? lastFastPipes.kPipes : kPipes };
    const kNet = pipesStale ? lastFastPipes.kPipes : kPipes;
    lap('siec');
    const field = {
      expanded, style: geo.style, scale: geo.scale, grid: geo.grid, levels: geo.levels, oct: geo.oct, loops: geo.loops,
      bounds: geo.bounds, image: geo.image, band: geo.band, dome: geo.dome, domeSigma: geo.domeSigma,
      groove: gr.groove, grooveBand: gr.grooveBand, pipeNet: net0.pipeNet, pipeTex: net0.pipeTex, area: geo.area
    };
    // KLASA i MOC (martwe kable — raster sieci od nowa tylko przy zmianie zbioru martwych urządzeń)
    const cls = hullDesignClass(field);
    const kPower = `${kNet}|${[...cls.dead].sort((a, b) => a - b).join(',')}`;
    let pw = C.power.get(kPower);
    if (!pw) {
      const f2 = { ...field };
      applyHullDesignPower(f2, cls);
      pw = C.power.set(kPower, { pipeNet: f2.pipeNet, pipeTex: f2.pipeTex });
    }
    field.pipeNet = pw.pipeNet; field.pipeTex = pw.pipeTex;
    const recipe = hullDesignRecipe(field);
    const mounts = hullDesignMounts(field);
    lap('klasa');
    // PAKIETY tekstur kompozytora
    if (!await step()) return null;
    const n = geo.grid.w * geo.grid.h;
    let pg = C.packGeo.get(kGeo);
    if (!pg) pg = C.packGeo.set(kGeo, packHullFieldTextures(geo));
    let pgr = C.packGroove.get(kGroove);
    if (!pgr) pgr = C.packGroove.set(kGroove, packHullGrooveTexture(gr.groove, gr.grooveBand, n));
    let pp = C.packPipes.get(kPower);
    if (!pp) pp = C.packPipes.set(kPower, packHullPipeTextures(pw.pipeNet, pw.pipeTex, geo.grid));
    field.packed = {
      field: { key: kGeo, data: pg.field }, aux: { key: kGeo, data: pg.aux }, groove: { key: kGroove, data: pgr },
      pipes: { key: kPower, ...pp }
    };
    lap('pakiety');
    const out = { field, keys: { geo: kGeo, groove: kGroove, pipes: kNet, power: kPower }, cls, recipe, mounts, timing: T, fast: !!opts.fast, pipesStale };
    if (opts.full) {
      if (!await step()) return null;
      out.physics = rasterHullAlpha(field, 1);
      out.cells = hullCells(field, 0).count;
      lap('fizyka');
      lastFull = { key: kPower, field };
    }
    T.razem = Math.round(Object.values(T).reduce((a, b) => a + b, 0) * 10) / 10;
    return out;
  }
  /**
   * Kontrola ostatniej pełnej budowy (panele edytora — liczona PO wysłaniu obrazu): systemy, kontrola sieci
   * (wolne końce, poza obrysem, bez prądu / paliwa), spójność ramy. Z pamięci po kluczu sieci z mocą.
   */
  function checks() {
    if (!lastFull) return null;
    let fr = C.full.get(lastFull.key);
    if (!fr) {
      const f = lastFull.field;
      fr = C.full.set(lastFull.key, {
        systems: hullDesignSystems(f.expanded.modules),
        netCheck: pipeNetworkCheck(f.pipeNet, f),
        integrity: hullFrameIntegrity(f)
      });
    }
    return fr;
  }
  let lastFull = null;
  let lastFastPipes = null;
  return { run, checks, clear() { lastFull = null; lastFastPipes = null; for (const c of Object.values(C)) c.clear(); } };
}
