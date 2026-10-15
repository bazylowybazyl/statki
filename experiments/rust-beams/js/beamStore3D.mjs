// beamStore3D w pamięci WASM: te same pola i kolejność co src/game/beamStore3D.js (NODE_STORE_FIELDS /
// BEAM_STORE_FIELDS z oryginału), tablice to widoki na jeden blok pamięci liniowej na magazyn. Reszta
// modułu (widoki węzłów, leniwe tablice, buildAdjacency) — z oryginału.
import { RT } from './runtime.mjs';
import * as orig from '../../../src/game/beamStore3D.js?orig';

export const { NODE_STORE_FIELDS, BEAM_STORE_FIELDS, BeamNodeView, BeamView, nodeViews, beamViews, defineLazyViews,
  cachedNodeViews, cachedBeamViews, nodeViewAt, buildAdjacency } = orig;

const NODE_SPEC = (n) => Object.entries(NODE_STORE_FIELDS).map(([f, T]) => [f, T, n]);
const BEAM_SPEC = (n) => Object.entries(BEAM_STORE_FIELDS).map(([f, T]) => [f, T, n]);

// Pola przypisane jawnie, po nazwie i w kolejności oryginału (kształt obiektu jak w src — bez trybu słownikowego V8).
export class BeamNodeStore {
  constructor(count) {
    this.count = count;
    const a = RT.allocArrays(this, NODE_SPEC(count));
    this.x = a.x; this.y = a.y; this.z = a.z;
    this.ox = a.ox; this.oy = a.oy; this.oz = a.oz;
    this.px = a.px; this.py = a.py; this.pz = a.pz;
    this.vx = a.vx; this.vy = a.vy; this.vz = a.vz;
    this.mass = a.mass; this.invMass = a.invMass; this.hp = a.hp; this.maxHp = a.maxHp;
    this.coverage = a.coverage; this.r = a.r; this.g = a.g; this.b = a.b; this.crushDepth = a.crushDepth;
    this.heat = a.heat; this.heatStamp = a.heatStamp; this.temp = a.temp;
    this.ix = a.ix; this.iy = a.iy; this.iz = a.iz; this.depth = a.depth;
    this.beamCount = a.beamCount; this.localBeamCount = a.localBeamCount; this.platingCount = a.platingCount;
    this.quiet = a.quiet; this.solveStamp = a.solveStamp; this.outerStamp = a.outerStamp; this.islandStamp = a.islandStamp;
    this.massStamp = a.massStamp; this.crushStamp = a.crushStamp; this.hashNext = a.hashNext.fill(-1);
    this.active = a.active; this.surface = a.surface; this.act = a.act; this.skinDirty = a.skinDirty; this.patch = a.patch;
    this.adjStart = new Int32Array(count + 1);
    this.adj = new Int32Array(0);
    this.shapeVersion = 0;
  }

  clone() {
    const copy = new BeamNodeStore(this.count);
    for (const f of Object.keys(NODE_STORE_FIELDS)) copy[f].set(this[f]);
    copy.adjStart = this.adjStart.slice();
    copy.adj = this.adj.slice();
    return copy;
  }
}

export class BeamLinkStore {
  constructor(count) {
    this.count = count;
    const a = RT.allocArrays(this, BEAM_SPEC(count));
    this.rest = a.rest; this.restBase = a.restBase;
    this.stiffness = a.stiffness; this.deform = a.deform;
    this.brk = a.brk; this.strain = a.strain; this.fatigue = a.fatigue;
    this.a = a.a; this.b = a.b; this.stamp = a.stamp;
    this.type = a.type; this.broken = a.broken; this.restBridge = a.restBridge;
  }

  clone() {
    const copy = new BeamLinkStore(this.count);
    for (const f of Object.keys(BEAM_STORE_FIELDS)) copy[f].set(this[f]);
    return copy;
  }
}

// Kopia packBeamStructure z oryginału (tworzy magazyny — muszą to być klasy z pamięci WASM).
export function packBeamStructure(nodes, beams) {
  const ns = new BeamNodeStore(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    ns.x[i] = n.x; ns.y[i] = n.y; ns.z[i] = n.z;
    ns.ox[i] = n.ox; ns.oy[i] = n.oy; ns.oz[i] = n.oz;
    ns.px[i] = n.px; ns.py[i] = n.py; ns.pz[i] = n.pz;
    ns.vx[i] = n.vx; ns.vy[i] = n.vy; ns.vz[i] = n.vz;
    ns.mass[i] = n.mass; ns.invMass[i] = n.invMass; ns.hp[i] = n.hp; ns.maxHp[i] = n.maxHp;
    ns.coverage[i] = n.coverage; ns.r[i] = n.r; ns.g[i] = n.g; ns.b[i] = n.b;
    ns.ix[i] = n.ix; ns.iy[i] = n.iy; ns.iz[i] = n.iz; ns.depth[i] = n.depth | 0;
    ns.beamCount[i] = n.beamCount; ns.localBeamCount[i] = n.localBeamCount; ns.platingCount[i] = n.platingCount;
    ns.active[i] = n.active ? 1 : 0; ns.surface[i] = n.surface ? 1 : 0;
  }
  const bs = new BeamLinkStore(beams.length);
  for (let e = 0; e < beams.length; e++) {
    const b = beams[e];
    bs.a[e] = b.a; bs.b[e] = b.b;
    bs.rest[e] = b.rest; bs.restBase[e] = b.restBase; bs.stiffness[e] = b.stiffness;
    bs.deform[e] = b.deform; bs.brk[e] = b.break; bs.strain[e] = b.strain; bs.fatigue[e] = b.fatigue || 0;
    bs.type[e] = b.type; bs.broken[e] = b.broken ? 1 : 0; bs.restBridge[e] = b.restBridge ? 1 : 0;
  }
  buildAdjacency(ns, bs);
  return { nodeStore: ns, beamStore: bs, nodes: nodeViews(ns) };
}
