// src/3d/planetGen/planetGenRegion.js
//
// STRUMIENIE REGIONU — sieć cieków w skali kilometra dla obszaru pod kamerą (płynne zbliżenie, etap 2).
// Siatka spływu planety ma komórki 8–17 km, więc z bliska jest na niej jedna rzeka i nic więcej. Gdy okno pod kamerą
// zejdzie dość głęboko, dla REGIONU wokół niego (siatka `size` × `size` komórek ~0,5 km, w układzie ściany okna)
// liczy się drugi, gęstszy spływ:
//   1. wypiekacz rysuje pole planety w oknie regionu i oddaje je na CPU (wysokość z wyciętymi dolinami rzek + woda),
//   2. rzeki i jeziora planety oraz brzeg regionu stają się UJŚCIAMI (wysokość ≤ 0) — strumienie spływają do rzek
//      planety i tam się kończą (bez drugiej rzeki obok rzeki), a zlewnie przecięte brzegiem regionu mają dokąd spłynąć,
//   3. `computeDrainage` (mapa lokalna) daje drzewo cieków → tekstura jak siatka spływu planety,
//   4. graf pola rysuje ją tym samym `riverNet` co rzeki planety, w skali komórek regionu (cienkie linie, małe
//      zakola, płytkie doliny, pasy wilgotności przy ciekach).
// Początek regionu leży na stałej kracie (co `REGION_SNAP` komórek) — przesunięty region liczy te same komórki.
//
// Część czysta (plan regionu, ujścia) działa w Node; `PlanetGenRegionStreams` woła wypiekacz i (w przeglądarce) workera.
import { PATCH_FRAMES } from './planetGenPatch.js';
import { computeDrainage } from './planetGenDrainage.js';
import { drainTexture } from './planetGenBake.tsl.js';

export const REGION_CELL_KM = 0.5;
export const REGION_SIZE = 1024;
/** Początek regionu = wielokrotność tylu komórek. */
export const REGION_SNAP = 64;
/** Pierścień ujść na brzegu regionu [komórki]. */
export const REGION_BORDER = 2;
/** Okno musi mieścić się w tej części boku regionu (reszta to zapas na ruch kamery i gaśnięcie przy brzegu). */
export const REGION_FIT = 0.86;
/** Szum trasowania spływu regionu [km] (planeta: 0,06 — tu komórki są 16–32 razy mniejsze). */
export const REGION_WANDER_KM = 0.02;

/** Kąt komórki regionu [rad]: teksel mapy planety / 2^k, najbliżej `cellKm` (komórki leżą na siatce tekseli okien). */
export function regionCellAngle(globalWidth, rKm, cellKm = REGION_CELL_KM) {
  const stG = 2 * Math.PI / globalWidth;
  const k = Math.max(0, Math.round(Math.log2(stG * rKm / cellKm)));
  return stG / Math.pow(2, k);
}

/**
 * Plan regionu dla okna `win` ({ frame (numer ściany), a0, b0, st }) o rozmiarze celu `width` × `height`.
 * Wynik { frame, cell, size, a0, b0, ox, oy, key } albo null (okno za duże na region — poziom za płytki).
 */
export function planRegion(win, { width, height, size = REGION_SIZE, cell }) {
  if (!win) return null;
  const wa = width * win.st;
  const wb = height * win.st;
  const span = size * cell;
  if (Math.max(wa, wb) > span * REGION_FIT) return null;
  const ia = Math.round((win.a0 + wa / 2 - span / 2) / (REGION_SNAP * cell)) * REGION_SNAP;
  const ib = Math.round((win.b0 + wb / 2 - span / 2) / (REGION_SNAP * cell)) * REGION_SNAP;
  return { frame: win.frame, cell, size, a0: ia * cell, b0: ib * cell, ox: ia, oy: ib, key: `${win.frame}:${ia}:${ib}:${size}` };
}

/** Czy region pokrywa okno z zapasem `pad` komórek od krawędzi siatki. */
export function regionCovers(region, win, width, height, pad = 44) {
  if (!region || !win || region.frame !== win.frame) return false;
  const m = pad * region.cell;
  const span = region.size * region.cell;
  return win.a0 >= region.a0 + m && win.a0 + width * win.st <= region.a0 + span - m
    && win.b0 >= region.b0 + m && win.b0 + height * win.st <= region.b0 + span - m;
}

/**
 * Pole regionu (RGBA: x — wysokość [km], y — woda słodka > 0) → wysokości dla spływu: ląd zostaje, morze, rzeki
 * i jeziora planety oraz pierścień brzegu to ujścia (−1). `row` — liczba elementów wiersza odczytu (≥ 4 · N).
 */
export function regionSinkHeights(px, N, { waterMin = 0.12, row = N * 4 } = {}) {
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const edgeY = y < REGION_BORDER || y >= N - REGION_BORDER;
    for (let x = 0; x < N; x++) {
      const o = y * row + x * 4;
      const v = px[o];
      const sink = edgeY || x < REGION_BORDER || x >= N - REGION_BORDER || !(v > 0) || px[o + 1] > waterMin;
      h[y * N + x] = sink ? -1 : v;
    }
  }
  return h;
}

/** Spływ regionu (mapa lokalna, bez smug osadu). */
export function regionDrainage(h, N, seed = 1) {
  return computeDrainage(h, null, N, N, { wrapX: false, rowWeight: false, plumes: false, seed, wander: REGION_WANDER_KM });
}

/**
 * Strumienie regionu jednej planety: pilnuje, żeby pod aktywnym oknem (`patches`) leżał policzony region, i podaje
 * go wypiekaczowi (`base.region`). `update()` co klatkę po `patches.update`. Liczenie: odczyt pola z karty (jedna
 * klatka opóźnienia i więcej), spływ w workerze (albo w miejscu, gdy workera nie ma), potem okno piecze się od nowa.
 */
export class PlanetGenRegionStreams {
  constructor(baker, base, patches, { size = REGION_SIZE, cellKm = REGION_CELL_KM, worker = true } = {}) {
    this.baker = baker;
    this.base = base;
    this.patches = patches;
    this.size = size;
    this.cell = regionCellAngle(base.size, base.spec.rKm, cellKm);
    this.enabled = !!base.drainage;
    this.region = null;
    this.pending = null;
    this.stats = { builds: 0, lastMs: 0, cpuMs: 0, streams: 0 };
    this._job = 0;
    this._old = null;
    this._worker = null;
    this._waits = new Map();
    this._useWorker = worker && typeof Worker !== 'undefined';
  }

  /** Co klatkę: gdy okno zeszło dość głęboko, a regionu pod nim nie ma — zaczyna liczenie. */
  update() {
    const P = this.patches;
    const cur = P.active >= 0 ? P.slots[P.active].win : null;
    if (!this.enabled || this.disposed || !cur || this.pending || P.job) return;
    if (this.region && regionCovers(this.region, cur, P.width, P.height)) return;
    const plan = planRegion(cur, { width: P.width, height: P.height, size: this.size, cell: this.cell });
    if (!plan || (this.region && plan.key === this.region.key)) return;
    this._start(plan);
  }

  _start(plan) {
    const base = this.base;
    const N = plan.size;
    const id = ++this._job;
    const t0 = performance.now();
    const region = {
      ...plan, axes: PATCH_FRAMES[plan.frame], seed: base.spec.seedInt % 65521,
      // głębokość dolin: stałe `riverNet` są dla komórek planety — strumień regionu ma dolinę płytszą w tej samej skali
      carve: 1.5 * plan.cell / (2 * Math.PI / base.drainage.width), texture: null
    };
    this.pending = region;
    this.baker.readRegionField(base, region).then(async (px) => {
      if (id !== this._job || this.disposed) return;
      const h = regionSinkHeights(px, N, { row: px.length / N });
      const d = await this._drain(h, N, base.spec.seedInt | 0);
      if (id !== this._job || this.disposed) return;
      const texture = drainTexture(d.data, N, N);
      this.baker.renderer.initTexture(texture);
      // (poprzednia tekstura może jeszcze służyć oknu, które właśnie gaśnie — zwalniana o jedno pokolenie później)
      if (this._old) this._old.dispose();
      this._old = this.region ? this.region.texture : null;
      this.region = { ...region, texture };
      base.region = this.region;
      this.pending = null;
      this.stats.builds++;
      this.stats.lastMs = performance.now() - t0;
      this.stats.cpuMs = d.stats ? d.stats.ms : 0;
      this.patches.refresh();
    }).catch((e) => {
      if (id === this._job) this.pending = null;
      console.error('[planetGenRegion] liczenie strumieni regionu nie powiodło się', e);
    });
  }

  _drain(h, N, seed) {
    if (!this._useWorker) return Promise.resolve(regionDrainage(h, N, seed));
    if (!this._worker) {
      this._worker = new Worker(new URL('./planetGenRegion.worker.js', import.meta.url), { type: 'module' });
      this._worker.onmessage = (ev) => {
        const w = this._waits.get(ev.data.id);
        if (!w) return;
        this._waits.delete(ev.data.id);
        if (ev.data.error) w.reject(new Error(ev.data.error)); else w.resolve(ev.data);
      };
    }
    return new Promise((resolve, reject) => {
      const id = this._job;
      this._waits.set(id, { resolve, reject });
      this._worker.postMessage({ id, h, N, seed, wander: REGION_WANDER_KM }, [h.buffer]);
    });
  }

  dispose() {
    this.disposed = true;
    this._job++;
    if (this._worker) { this._worker.terminate(); this._worker = null; }
    if (this._old) this._old.dispose();
    if (this.region && this.region.texture) this.region.texture.dispose();
    if (this.base.region === this.region) this.base.region = null;
    this.region = null;
  }
}
