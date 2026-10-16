// src/3d/reactorBlast/reactorCommands.js
//
// Dekoder rekordów RX_* (RW-22, src/render/hullCommands.js) po stronie RENDERU: z rekordu buduje zdarzenie, wynik
// detonacji i trafienia (zastępniki o polach, które czyta ReactorBlastFx) i woła reżysera tak jak dawniej ReactorGame
// przez `env.fx()`. Strumienie i kule — obiekty z id (`hazardAt`: inline — rejestr gry, worker — lustra CORES).

import {
  HC, RX_DET, RX_HIT_WORDS, RX_ORB, RX_SEC, RX_MELT, RX_HAZ, RX_HAZ_KIND
} from '../../render/hullCommands.js';
import { decodeKerf } from '../hullDamageCommands.js';

const _color = [0, 0, 0];
const _ev = {
  x: 0, y: 0, variant: '', orb: null,
  core: { classId: '', color: undefined, host: { faction: '' }, origin: null },
  host: { radius: 0, vx: 0, vy: 0 }
};
const _res = { cuts: [], x: 0, y: 0, edges: [], wreck: null, craterR: 0, crackRuns: [], fragments: [] };
const _hits = [];
const _hitPool = [];

function readHits(rd, d, o, n) {
  _hits.length = 0;
  for (let h = 0; h < n; h++) {
    const q = o + h * RX_HIT_WORDS;
    const hit = _hitPool[h] || (_hitPool[h] = { entity: null, x: 0, y: 0, nx: 0, ny: 0, t: 0 });
    hit.entity = rd.ent(d, q);
    hit.x = d[q + 2]; hit.y = d[q + 3]; hit.nx = d[q + 4]; hit.ny = d[q + 5]; hit.t = d[q + 6];
    _hits.push(hit);
  }
  return _hits;
}

/**
 * @param reader — czytelnik rozkazów (RenderCommands.reader)
 * @param getFx — () → ReactorBlastFx albo null
 * @param hazardAt — (id) → obiekt strumienia / kuli albo null
 */
export function installReactorCommands(reader, getFx, hazardAt) {
  reader.on(HC.RX_DETONATION, (rd, d, o) => {
    const fx = getFx();
    if (!fx) return;
    const D = RX_DET;
    const ev = _ev, res = _res;
    ev.x = d[o + D.X]; ev.y = d[o + D.Y]; ev.variant = rd.str(d[o + D.VARIANT]); ev.orb = null;
    const core = ev.core;
    core.classId = rd.str(d[o + D.CLASS]);
    if (d[o + D.HAS_COLOR]) { _color[0] = d[o + D.CR]; _color[1] = d[o + D.CG]; _color[2] = d[o + D.CB]; core.color = _color; }
    else core.color = undefined;
    core.host.faction = rd.str(d[o + D.FACTION]) || '';
    ev.host.radius = d[o + D.HOST_R]; ev.host.vx = d[o + D.HOST_VX]; ev.host.vy = d[o + D.HOST_VY];
    res.x = d[o + D.RES_X]; res.y = d[o + D.RES_Y];
    res.wreck = rd.ent(d, o + D.WRECK);
    res.craterR = d[o + D.CRATER_R];
    const nCuts = d[o + D.N_CUTS], nEdges = d[o + D.N_EDGES], nRuns = d[o + D.N_RUNS], nHits = d[o + D.N_HITS];
    let q = o + D.WORDS;
    res.cuts.length = nCuts;
    for (let i = 0; i < nCuts; i++) res.cuts[i] = d[q++];
    const E = res.edges;
    E.length = nEdges * 6;
    for (let k = 0; k < nEdges; k++) {
      const b = k * 6;
      E[b] = d[q]; E[b + 1] = d[q + 1]; E[b + 2] = rd.ent(d, q + 2); E[b + 3] = 0; E[b + 4] = 0; E[b + 5] = 0;
      q += 4;
    }
    const runs = res.crackRuns;
    runs.length = nRuns;
    let p = q + nRuns;
    for (let i = 0; i < nRuns; i++) {
      const len = d[q + i];
      const r = runs[i] || (runs[i] = []);
      r.length = len;
      for (let k = 0; k < len; k++) r[k] = d[p++];
    }
    fx.detonation(ev, res, readHits(rd, d, p, nHits));
  });

  reader.on(HC.RX_ORB_BURST, (rd, d, o) => {
    const fx = getFx();
    const orb = hazardAt(d[o + RX_ORB.ORB]);
    if (!fx) return;
    const ev = _ev;
    ev.x = d[o + RX_ORB.X]; ev.y = d[o + RX_ORB.Y]; ev.orb = orb;
    fx.orbBurst(ev, readHits(rd, d, o + RX_ORB.WORDS, d[o + RX_ORB.N_HITS]));
    ev.orb = null;
  });

  reader.on(HC.RX_SECONDARY, (rd, d, o) => {
    const fx = getFx();
    if (fx) fx.secondary(d[o + RX_SEC.X], d[o + RX_SEC.Y], rd.ent(d, o + RX_SEC.ENT), d[o + RX_SEC.SIZE]);
  });

  reader.on(HC.RX_MELT, (rd, d, o) => {
    const fx = getFx();
    const orb = hazardAt(d[o + RX_MELT.ORB]);
    if (fx && orb) fx.melt(rd.ent(d, o + RX_MELT.ENT), orb, d[o + RX_MELT.KILLED]);
  });

  reader.on(HC.RX_JETCUT, (rd, d, o) => {
    const fx = getFx();
    if (!fx || !fx.opts.heat) return;
    decodeKerf(rd, d, o);
  });

  reader.on(HC.RX_HAZARD, (rd, d, o) => {
    const fx = getFx();
    const obj = hazardAt(d[o + RX_HAZ.ID]);
    if (!fx || !obj) return;
    if (d[o + RX_HAZ.KIND] === RX_HAZ_KIND.JET) fx.addJet(obj);
    else fx.addOrb(obj);
  });

  reader.on(HC.RX_CLEAR, () => {
    const fx = getFx();
    if (fx) fx.clear();
  });

  return reader;
}
