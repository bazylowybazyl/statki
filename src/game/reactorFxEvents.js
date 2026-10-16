// src/game/reactorFxEvents.js
//
// Obraz rdzenia reaktora po stronie GRY (RW-22, docs/PLAN-render-worker.md § 3.3, § 2.6 p. 24): fasada `env.fx()`
// ReactorGame (src/game/reactorCoreGame.js — bez zmian) o metodach reżysera ReactorBlastFx (detonation, orbBurst,
// secondary, melt, jetCut, addJet, addOrb, clear), która zamiast rysować pisze rekordy RX_* (src/render/hullCommands.js).
// W chwili zdarzenia gra liczy to, o co render pytał silnik belek: przebiegi pęknięć (reactorCrackRuns — dawniej
// `_crackRun` z HullBodies.probe), pas rzazu strumienia (rekord jak DMG_KERF). Strumienie i kule (obiekty logiki,
// które obraz czyta co klatkę) dostają id: inline — rejestr tutaj (`hazardAt`), worker — blok CORES migawki.

import { HC, RX_DET, RX_HIT_WORDS, RX_ORB, RX_SEC, RX_MELT, RX_HAZ, RX_HAZ_KIND } from '../render/hullCommands.js';
import { reactorBlastSceneRadius, reactorCrackRuns } from './reactorCore.js';

function velX(e) { return Number(e?.vel?.x ?? e?.vx) || 0; }
function velY(e) { return Number(e?.vel?.y ?? e?.vy) || 0; }

/**
 * @param writer — pisarz rozkazów (RenderCommands.writer)
 * @param hullEvents — pisarz mapy ran (createHullDamageEvents) — pas rzazu strumienia
 */
export function createReactorFxEvents(writer, hullEvents) {
  const ids = new WeakMap();
  const byId = new Map();
  let next = 1;

  function hazardId(obj) {
    let id = ids.get(obj);
    if (id === undefined) { id = next++; ids.set(obj, id); }
    byId.set(id, obj);   // także kula po wybuchu (orbBurst po prune) — rekord musi ją rozwiązać
    return id;
  }
  // Rejestr bez martwych: strumień skończony i wygaszony, kula po wybuchu (obraz zdejmuje je tak samo).
  function prune() {
    for (const [id, o] of byId) if ((o.done && !(o.env > 0)) || o.detonated) byId.delete(id);
  }
  function ent(d, o, e) {
    const sp = writer.ids.entities;
    if (!e || typeof e !== 'object') { d[o] = -1; d[o + 1] = 0; return; }
    const slot = sp.slotOf(e);
    d[o] = slot; d[o + 1] = sp.gen(slot);
  }
  function writeHits(d, o, hits) {
    const n = hits ? hits.length : 0;
    for (let h = 0; h < n; h++) {
      const q = o + h * RX_HIT_WORDS, hit = hits[h];
      ent(d, q, hit.entity);
      d[q + 2] = hit.x; d[q + 3] = hit.y; d[q + 4] = hit.nx; d[q + 5] = hit.ny; d[q + 6] = hit.t;
    }
  }

  const api = {
    ready: false,
    /** Obiekt strumienia / kuli z id (null — nieznany). */
    hazardAt(id) { return byId.get(id) || null; },
    /** Każdy obiekt rejestru (id, obiekt) — blok `hazards` migawki (tryb worker). */
    forEachHazard(fn) { for (const [id, o] of byId) fn(id, o); },

    detonation(ev, res, hits = null) {
      const core = ev.core || null;
      const host = ev.host || null;
      // Barwa plazmy jak plasmaOf(core): core.color albo frakcja gospodarza / pochodzenia.
      const c = core?.color;
      const hasColor = Array.isArray(c) && c.length >= 3;
      const variant = writer.str(ev.variant);
      const cls = writer.str(core?.classId);
      const faction = writer.str(hasColor ? '' : String(core?.host?.faction || core?.origin?.faction || ''));
      const runs = res ? reactorCrackRuns(res, reactorBlastSceneRadius(host)) : [];
      let runPts = 0;
      for (let i = 0; i < runs.length; i++) runPts += runs[i].length;
      const cuts = res?.cuts || null;
      const nCuts = cuts ? cuts.length : 0;
      const E = res?.edges || null;
      let nEdges = 0;
      if (E) for (let k = 0; k + 2 < E.length; k += 6) nEdges++;
      const nHits = hits ? hits.length : 0;
      const D = RX_DET;
      const words = D.WORDS + nCuts + nEdges * 4 + runs.length + runPts + nHits * RX_HIT_WORDS;
      const o = writer._begin(HC.RX_DETONATION, words);
      const d = writer.ring.data;
      d[o + D.X] = ev.x; d[o + D.Y] = ev.y; d[o + D.VARIANT] = variant; d[o + D.CLASS] = cls;
      d[o + D.HAS_COLOR] = hasColor ? 1 : 0;
      d[o + D.CR] = hasColor ? c[0] : 0; d[o + D.CG] = hasColor ? c[1] : 0; d[o + D.CB] = hasColor ? c[2] : 0;
      d[o + D.FACTION] = faction;
      d[o + D.HOST_R] = Number(host?.radius); d[o + D.HOST_VX] = velX(host); d[o + D.HOST_VY] = velY(host);
      d[o + D.RES_X] = res ? res.x : 0; d[o + D.RES_Y] = res ? res.y : 0;
      ent(d, o + D.WRECK, res?.wreck);
      d[o + D.CRATER_R] = res ? Number(res.craterR) : 0;
      d[o + D.N_CUTS] = nCuts; d[o + D.N_EDGES] = nEdges; d[o + D.N_RUNS] = runs.length; d[o + D.N_RUNPTS] = runPts;
      d[o + D.N_HITS] = nHits;
      let q = o + D.WORDS;
      for (let i = 0; i < nCuts; i++) d[q++] = cuts[i];
      if (E) for (let k = 0; k + 2 < E.length; k += 6) { d[q] = E[k]; d[q + 1] = E[k + 1]; ent(d, q + 2, E[k + 2]); q += 4; }
      for (let i = 0; i < runs.length; i++) d[q++] = runs[i].length;
      for (let i = 0; i < runs.length; i++) { const r = runs[i]; for (let k = 0; k < r.length; k++) d[q++] = r[k]; }
      writeHits(d, q, hits);
      writer._commit();
    },

    orbBurst(ev, hits = null) {
      const id = ev.orb ? hazardId(ev.orb) : 0;
      const nHits = hits ? hits.length : 0;
      const o = writer._begin(HC.RX_ORB_BURST, RX_ORB.WORDS + nHits * RX_HIT_WORDS);
      const d = writer.ring.data;
      d[o + RX_ORB.X] = ev.x; d[o + RX_ORB.Y] = ev.y; d[o + RX_ORB.ORB] = id; d[o + RX_ORB.N_HITS] = nHits;
      writeHits(d, o + RX_ORB.WORDS, hits);
      writer._commit();
    },

    secondary(x, y, entity, size) {
      const o = writer._begin(HC.RX_SECONDARY, RX_SEC.WORDS);
      const d = writer.ring.data;
      d[o + RX_SEC.X] = x; d[o + RX_SEC.Y] = y; ent(d, o + RX_SEC.ENT, entity); d[o + RX_SEC.SIZE] = size;
      writer._commit();
    },

    melt(entity, orb, killed) {
      const id = orb ? hazardId(orb) : 0;
      const o = writer._begin(HC.RX_MELT, RX_MELT.WORDS);
      const d = writer.ring.data;
      ent(d, o + RX_MELT.ENT, entity); d[o + RX_MELT.ORB] = id; d[o + RX_MELT.KILLED] = killed;
      writer._commit();
    },

    jetCut(entity, x, y, dx, dy, depth) {
      if (!entity) return;
      hullEvents.kerf(entity, x, y, x + dx * depth, y + dy * depth, 'hexlance', HC.RX_JETCUT);
    },

    addJet(jet) { api._hazard(jet, RX_HAZ_KIND.JET); },
    addOrb(orb) { api._hazard(orb, RX_HAZ_KIND.ORB); },
    _hazard(obj, kind) {
      if (!obj) return;
      prune();
      const id = hazardId(obj);
      const o = writer._begin(HC.RX_HAZARD, RX_HAZ.WORDS);
      const d = writer.ring.data;
      d[o + RX_HAZ.KIND] = kind; d[o + RX_HAZ.ID] = id;
      writer._commit();
    },

    clear() {
      byId.clear();
      const o = writer._begin(HC.RX_CLEAR, 1);
      writer.ring.data[o] = 0;
      writer._commit();
    }
  };
  return api;
}
