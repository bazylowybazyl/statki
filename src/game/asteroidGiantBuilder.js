// src/game/asteroidGiantBuilder.js
//
// Budowa siatek olbrzymów w tle: pula workerów (asteroidGiantWorker.js),
// każdy olbrzym dzielony na plastry z (po kilkanaście), wyniki składane
// w jedną tablicę GiantRock.grid. Wątek główny nie liczy SDF (2,6–5,8 s na
// olbrzyma w jednym wątku). Bez workerów (node, test) — liczy od razu.

import { GiantRock, buildGiantPlan, fillGiantGrid } from './asteroidGiants.js';

const SLAB = 12;

export class GiantBuilder {
  constructor({ workers = null } = {}) {
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    this.size = Math.max(1, Math.min(8, workers ?? hw - 1));
    this.pool = [];
    this.queue = [];
    this.jobs = new Map();
    this.nextJob = 1;
    this.available = typeof Worker !== 'undefined';
  }

  _spawn() {
    const w = new Worker(new URL('./asteroidGiantWorker.js', import.meta.url), { type: 'module' });
    const slot = { w, busy: false };
    w.onmessage = (e) => this._onResult(slot, e.data);
    w.onerror = (e) => {
      console.error('asteroidGiantWorker', e.message || e);
      slot.busy = false;
    };
    this.pool.push(slot);
    return slot;
  }

  _pump() {
    while (this.queue.length) {
      let slot = this.pool.find((s) => !s.busy);
      if (!slot && this.pool.length < this.size) slot = this._spawn();
      if (!slot) return;
      const task = this.queue.shift();
      slot.busy = true;
      slot.w.postMessage(task.msg);
    }
  }

  _onResult(slot, data) {
    slot.busy = false;
    const job = this.jobs.get(data.job);
    if (job) {
      if (data.error) {
        job.reject(new Error(data.error));
        this.jobs.delete(data.job);
      } else {
        const g = job.giant;
        g.grid.set(data.slab, data.z0 * g.dims.nx * g.dims.ny);
        job.done += data.z1 - data.z0;
        job.onProgress?.(job.done / g.dims.nz);
        if (job.done >= g.dims.nz) {
          g.ready = true;
          g.buildMs = performance.now() - job.t0;
          this.jobs.delete(data.job);
          job.resolve(g);
        }
      }
    }
    this._pump();
  }

  /**
   * Olbrzym w (x, y) świata gry. Zwraca { giant, promise } — giant od razu
   * (plan, wymiary, trasy), siatka gotowa po rozwiązaniu promise.
   */
  build(presetId, seed, x, y, { onProgress = null } = {}) {
    const plan = buildGiantPlan(presetId, seed);
    const giant = new GiantRock(plan, x, y);
    if (!this.available) {
      const t0 = performance.now();
      fillGiantGrid(plan, giant.grid, giant.dims);
      giant.ready = true;
      giant.buildMs = performance.now() - t0;
      return { giant, promise: Promise.resolve(giant) };
    }
    const promise = new Promise((resolve, reject) => {
      const id = this.nextJob++;
      this.jobs.set(id, { giant, resolve, reject, done: 0, onProgress, t0: performance.now() });
      const nz = giant.dims.nz;
      for (let z0 = 0; z0 < nz; z0 += SLAB) {
        const z1 = Math.min(nz, z0 + SLAB);
        this.queue.push({ msg: { job: id, presetId, seed, z0, z1 } });
      }
      this._pump();
    });
    return { giant, promise };
  }

  dispose() {
    for (const s of this.pool) s.w.terminate();
    this.pool.length = 0;
    this.queue.length = 0;
  }
}
