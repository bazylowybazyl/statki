// src/game/hullDesign/hullDesignBuildClient.js
//
// KREATOR KADŁUBÓW — strona budowy projektu: worker hullDesignBuild.worker.js (czyste etapy z pamięcią wyników poza
// wątkiem strony) i składanie wyniku. Worker wysyła pola poziomów i pakiety tekstur tylko przy nowym kluczu — tu
// zostaje ostatni egzemplarz każdego rodzaju, więc wynik zawsze ma komplet (kompozytor wysyła na GPU tylko to, czego
// klucz się zmienił). Bez Workera (Node, testy) — ten sam budowniczy na miejscu, z oddaniem pętli między etapami.
//
//   const client = createHullDesignBuildClient();
//   const res = await client.build(design, { fast, full, supersede });   // null — zastąpiona nowszą pracą
//   res.field — jak buildHullField (+ `packed` dla HullComposer.setDesign), res.cls / recipe / mounts / physics /
//   cells / timing; res.checks — obietnica kontroli pełnej budowy { systems, netCheck, integrity } (po obrazie) albo null.

import { createHullDesignBuilder } from './hullDesignBuild.js';

export function createHullDesignBuildClient() {
  let worker = null;
  try {
    if (typeof Worker !== 'undefined') worker = new Worker(new URL('./hullDesignBuild.worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  const waiting = new Map();
  const checkWaiters = new Map();   // id → zakończenie kontroli pełnej budowy (systemy, sieć, rama — po obrazie)
  const checkPromises = new Map();
  let seq = 0;
  const last = { geo: null, field: null, aux: null, groove: null, pipes: null };
  let local = null;
  let localJob = null;

  function assemble(m) {
    if (m.geo) last.geo = m.geo;
    const pk = m.packed;
    if (pk.field.data) last.field = pk.field;
    if (pk.aux.data) last.aux = pk.aux;
    if (pk.groove.data) last.groove = pk.groove;
    if (pk.pipes.a) last.pipes = { key: pk.pipes.key, a: pk.pipes.a, b: pk.pipes.b };
    const g = last.geo;
    if (!g || g.key !== m.keys.geo) throw new Error('budowa projektu: brak geometrii dla klucza');
    const field = {
      expanded: m.expanded, style: g.style, scale: g.scale, grid: g.grid, levels: g.levels, oct: null, loops: g.loops,
      bounds: g.bounds, image: g.image, band: g.band, dome: null, domeSigma: g.domeSigma, groove: null, grooveBand: m.grooveBand,
      pipeNet: m.pipeNet, pipeTex: null, area: g.area, integrity: null,
      packed: { field: last.field, aux: last.aux, groove: last.groove, pipes: { ...last.pipes, on: pk.pipes.on, w: pk.pipes.w, h: pk.pipes.h } }
    };
    return {
      field, keys: m.keys, fast: m.fast, cls: m.cls, recipe: m.recipe, mounts: m.mounts, timing: m.timing,
      cells: m.cells, physics: m.physics
    };
  }

  if (worker) {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.checks !== undefined) {
        const c = checkWaiters.get(m.id);
        checkWaiters.delete(m.id);
        c?.(m.checks);
        return;
      }
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.error) { w.reject(new Error(m.error)); return; }
      if (m.aborted) { checkWaiters.get(m.id)?.(null); checkWaiters.delete(m.id); checkPromises.delete(m.id); w.resolve(null); return; }
      try {
        const res = assemble(m);
        res.checks = checkPromises.get(m.id) || Promise.resolve(null);
        checkPromises.delete(m.id);
        w.resolve(res);
      } catch (err) { w.reject(err); }
    };
    worker.onerror = (e) => {
      const err = new Error(`worker budowy: ${e.message || e}`);
      for (const w of waiting.values()) w.reject(err);
      waiting.clear();
    };
  }

  return {
    get inWorker() { return !!worker; },
    /**
     * Budowa projektu (kopia w chwili wywołania). `opts.fast` — połowa rozdzielczości, `opts.full` — kontrola sieci,
     * alfa fizyki, `opts.supersede` — przerwij trwającą budowę (wygrywa najnowsza). Czekająca praca zastąpiona nowszą
     * kończy się null.
     */
    build(design, opts = {}) {
      const id = ++seq;
      const { supersede = false, ...runOpts } = opts;
      if (!worker) {
        local = local || createHullDesignBuilder();
        const job = localJob = { cancel: false };
        return local.run(design, runOpts, () => new Promise((ok) => setTimeout(ok, 0)).then(() => !job.cancel)).then((res) => {
          if (localJob === job) localJob = null;
          if (!res) return null;
          res.field.integrity = null;
          res.checks = Promise.resolve(runOpts.full ? local.checks() : null);
          return res;
        });
      }
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        if (runOpts.full) checkPromises.set(id, new Promise((ok) => checkWaiters.set(id, ok)));
        worker.postMessage({ type: 'build', id, design, opts: runOpts, supersede });
      });
    },
    /** Przerwij trwającą budowę (na granicy etapu; jej obietnica kończy się null). */
    cancel() {
      if (worker) worker.postMessage({ type: 'cancel' });
      else if (localJob) localJob.cancel = true;
    },
    reset() {
      if (worker) worker.postMessage({ type: 'reset' });
      local?.clear();
      for (const k of Object.keys(last)) last[k] = null;
    },
    dispose() {
      worker?.terminate();
      worker = null;
      for (const w of waiting.values()) w.resolve(null);
      waiting.clear();
    }
  };
}
