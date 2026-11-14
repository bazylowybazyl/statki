// Worker dema miasta 3D (dema/miasto-3d.js): układ płytki (raz na kadłub) i masyw miasta (przy każdej zmianie
// parametrów) poza wątkiem strony. Wejście: { id, field?, opts } — pole kadłuba z budowy kreatora (levels, grid,
// bounds, band, expanded, pipeNet). Wyjście: tablice miasta (przekazywane, bez kopii) + liczby.
import { buildHullBoard } from '../src/game/hullDesign/hullDesignBoard.js';
import { buildHullCity } from '../src/game/hullDesign/hullDesignCity.js';

let field = null;
let board = null;
let boardMs = 0;

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.field) { field = m.field; board = null; }
    if (!field) throw new Error('brak pola kadłuba');
    if (!board) {
      const t = performance.now();
      board = buildHullBoard(field, { variant: 'A' });
      boardMs = Math.round(performance.now() - t);
    }
    const t = performance.now();
    const c = buildHullCity(field, board, m.opts || {});
    const cityMs = Math.round(performance.now() - t);
    const out = {
      ok: c.ok, reason: c.reason, boxes: c.boxes, nBoxes: c.nBoxes, lights: c.lights, nLights: c.nLights,
      height: c.height, bounds: c.bounds, stats: c.stats, plazas: c.plazas, nBuildings: c.buildings.length,
      dominants: c.buildings.filter((b) => b.flags & 2).map((b) => ({ x: b.x, y: b.y, top: b.top, family: b.family }))
    };
    const transfer = [c.boxes.buffer, c.lights.buffer];
    if (c.height) transfer.push(c.height.data.buffer);
    self.postMessage({ id: m.id, city: out, boardMs, cityMs }, transfer);
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err?.stack || err) });
  }
};
