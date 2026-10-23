// src/game/hullDesign/hullDesignBuild.worker.js
//
// KREATOR KADŁUBÓW — worker budowy projektu (moduł; bez DOM): czyste etapy z hullDesignBuild.js poza wątkiem strony.
// Wiadomość { type: 'build', id, design, opts, supersede } — `supersede` przerywa trwającą budowę na granicy etapu
// (wygrywa najnowsza; przerwana dostaje { id, aborted: true }). Czekająca praca, którą zastąpi nowsza, też kończy
// się `aborted`. Wynik idzie z przekazaniem tablic (transfer): pola poziomów tylko przy nowej geometrii, pakiety
// tekstur tylko przy nowym kluczu — strona trzyma poprzednie (hullDesignBuildClient.js).

import { createHullDesignBuilder } from './hullDesignBuild.js';

const builder = createHullDesignBuilder();
let current = null;     // { id }
let waiting = null;     // najnowsza praca w kolejce
const sent = { geo: null, field: null, aux: null, groove: null, pipes: null };

const yieldLoop = () => new Promise((ok) => setTimeout(ok, 0));
// Klucze etapów to długie napisy (bryły projektu) — do strony idą krótkie numery.
const keyIds = new Map();
let keySeq = 0;
function idOf(key) {
  let n = keyIds.get(key);
  if (n === undefined) {
    n = ++keySeq;
    keyIds.set(key, n);
    if (keyIds.size > 64) keyIds.delete(keyIds.keys().next().value);
  }
  return n;
}

self.onmessage = (e) => {
  const m = e.data;
  if (m?.type === 'reset') { builder.clear(); keyIds.clear(); for (const k of Object.keys(sent)) sent[k] = null; return; }
  if (m?.type === 'cancel') { if (current) current.cancel = true; return; }
  if (m?.type !== 'build') return;
  if (waiting) self.postMessage({ id: waiting.id, aborted: true });
  waiting = m;
  if (current && m.supersede) current.cancel = true;
  if (!current) pump();
};

async function pump() {
  while (waiting) {
    const job = waiting;
    waiting = null;
    current = { id: job.id, cancel: false };
    const cur = current;
    let res = null, err = null;
    try {
      res = await builder.run(job.design, job.opts || {}, async () => { await yieldLoop(); return !cur.cancel; });
    } catch (ex) {
      err = String(ex?.stack || ex);
    }
    current = null;
    if (err) { self.postMessage({ id: job.id, error: err }); continue; }
    if (!res) { self.postMessage({ id: job.id, aborted: true }); continue; }
    post(job.id, res);
    if (job.opts?.full) {
      // kontrola po wysłaniu obrazu — chyba że czeka nowsza praca (ona policzy swoją)
      await yieldLoop();
      let checks = null;
      if (!waiting) {
        try { checks = builder.checks(); } catch { checks = null; }
      }
      self.postMessage({ id: job.id, checks });
    }
  }
}

function post(id, res) {
  const transfer = [];
  const f = res.field;
  const k = { geo: idOf(res.keys.geo), power: idOf(res.keys.power) };
  // geometria strony (pola poziomów do próbkowania, kontury, pudła) — tylko gdy nowa; kopie (pamięć etapów zostaje)
  let geo = null;
  if (sent.geo !== k.geo) {
    const levels = f.levels.map((a) => a.slice());
    for (const a of levels) transfer.push(a.buffer);
    geo = { key: k.geo, levels, loops: f.loops, style: f.style, scale: f.scale, grid: f.grid, bounds: f.bounds, image: f.image, band: f.band, domeSigma: f.domeSigma, area: f.area };
    sent.geo = k.geo;
  }
  const pk = f.packed;
  const pack = (kind, rec, arrays) => {
    const key = idOf(rec.key);
    if (sent[kind] === key) return { key };
    sent[kind] = key;
    const out = { key };
    for (const [name, a] of Object.entries(arrays)) { const c = a.slice(); transfer.push(c.buffer); out[name] = c; }
    return out;
  };
  const packed = {
    field: pack('field', pk.field, { data: pk.field.data }),
    aux: pack('aux', pk.aux, { data: pk.aux.data }),
    groove: pack('groove', pk.groove, { data: pk.groove.data }),
    pipes: { ...pack('pipes', pk.pipes, { a: pk.pipes.a, b: pk.pipes.b }), on: pk.pipes.on, w: pk.pipes.w, h: pk.pipes.h }
  };
  const pipeNet = f.pipeNet ? { ...f.pipeNet, base: undefined } : null;
  const msg = {
    id, fast: res.fast, keys: { geo: k.geo, power: k.power }, geo, packed,
    expanded: f.expanded, pipeNet, grooveBand: f.grooveBand,
    cls: res.cls, recipe: res.recipe, mounts: res.mounts, timing: res.timing,
    cells: res.cells, physics: res.physics
  };
  if (res.physics) transfer.push(res.physics.data.buffer);
  self.postMessage(msg, transfer);
}
