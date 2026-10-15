// Worker WYPIEKU SKÓRY kawałka budowli (2026-10-15, optymalizacja przestojów): rdzeń portBuildingSkinBake.js poza
// wątkiem gry. Wiadomości: { type: 'bases', bases } — bryły bazowe (raz, kopia); { type: 'bake', id, parts, stride, cx,
// cz, lattice, maxEdgeCells } → { type: 'done', id, res, ms } (tablice wyniku przekazane, nie kopiowane) albo { err }.
import { bakeSkinCore } from './portBuildingSkinBake.js';

let bases = null;

self.onmessage = (ev) => {
  const m = ev.data;
  if (!m) return;
  if (m.type === 'bases') { bases = m.bases; return; }
  if (m.type !== 'bake') return;
  const t0 = performance.now();
  let res = null;
  try {
    if (!bases) throw new Error('brak brył bazowych');
    res = bakeSkinCore({ bases, parts: m.parts, stride: m.stride, cx: m.cx, cz: m.cz, lattice: m.lattice, maxEdgeCells: m.maxEdgeCells });
  } catch (err) {
    self.postMessage({ type: 'done', id: m.id, res: null, err: String((err && err.message) || err), ms: performance.now() - t0 });
    return;
  }
  const transfer = [];
  for (const set of ['bg', 'fg']) {
    const r = res[set];
    if (r) transfer.push(r.pos.buffer, r.nor.buffer, r.inter.buffer, r.index.buffer);
  }
  self.postMessage({ type: 'done', id: m.id, res, ms: performance.now() - t0 }, transfer);
};
