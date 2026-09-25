/**
 * beamStore3D — węzły i belki ciała w tablicach typowanych (SoA).
 *
 * Gorące pętle silnika (solver, kolizje, trafienia, skóra) czytają tablice magazynu
 * wprost: bez przeskoków po obiektach rozsianych po stercie i bez pracy dla
 * odśmiecacza. `body.nodes` / `body.beams` zostają jako tablice WIDOKÓW — obiekt
 * z getterami i setterami na tym samym magazynie — dla kodu spoza gorącej ścieżki
 * (testy, callbacki odłamków, podgląd). Widok węzła zachowuje tożsamość przy
 * rozpadzie: przepina się na magazyn nowego ciała (`_s`, `_i`), jak dawny obiekt.
 */

// Pola liczbowe węzła: nazwa w widoku → tablica w magazynie. Float64 = te same
// liczby co zwykłe pola obiektów JS, więc symulacja jest bit w bit jak dawniej.
const NODE_F64 = ['x', 'y', 'z', 'ox', 'oy', 'oz', 'px', 'py', 'pz', 'vx', 'vy', 'vz',
  'mass', 'invMass', 'hp', 'maxHp', 'coverage', 'r', 'g', 'b', 'crushDepth'];
const NODE_I32 = ['ix', 'iy', 'iz', 'depth', 'beamCount', 'localBeamCount', 'platingCount',
  'quiet', 'solveStamp', 'outerStamp', 'islandStamp', 'massStamp', 'crushStamp', 'hashNext'];
const NODE_U8 = ['active', 'surface', 'act', 'skinDirty'];
// Dawne nazwy pól wewnętrznych obiektu węzła → pola magazynu.
const NODE_ALIASES = {
  _act: 'act', _quiet: 'quiet', _solveStamp: 'solveStamp', _outerStamp: 'outerStamp',
  _skinDirty: 'skinDirty', __islandStamp: 'islandStamp', _massStamp: 'massStamp',
  _crushStamp: 'crushStamp', _crushDepth: 'crushDepth', _hashNext: 'hashNext'
};
const NODE_BOOLEAN = new Set(['active', 'surface']);

const BEAM_F64 = ['rest', 'restBase', 'stiffness', 'deform', 'brk', 'strain', 'fatigue'];
const BEAM_I32 = ['a', 'b', 'stamp'];
const BEAM_U8 = ['type', 'broken', 'restBridge'];
const BEAM_ALIASES = { break: 'brk', _stamp: 'stamp' };
const BEAM_BOOLEAN = new Set(['broken', 'restBridge']);
const NODE_FIELDS = [...NODE_F64, ...NODE_I32, ...NODE_U8];
const BEAM_FIELDS = [...BEAM_F64, ...BEAM_I32, ...BEAM_U8];
// Listy pól z typem tablicy — konstruktory niżej muszą tworzyć dokładnie te pola (pilnuje test).
export const NODE_STORE_FIELDS = Object.freeze(Object.fromEntries([
  ...NODE_F64.map(f => [f, Float64Array]), ...NODE_I32.map(f => [f, Int32Array]), ...NODE_U8.map(f => [f, Uint8Array])]));
export const BEAM_STORE_FIELDS = Object.freeze(Object.fromEntries([
  ...BEAM_F64.map(f => [f, Float64Array]), ...BEAM_I32.map(f => [f, Int32Array]), ...BEAM_U8.map(f => [f, Uint8Array])]));

// Pola magazynów przypisane JAWNIE, po nazwie. Pętla `this[f] = …` po liście nazw
// przestawiała BeamNodeStore (39 pól) w tryb słownikowy V8 (limit ~12 właściwości
// dodanych kluczem obliczanym): każde `s.x` było wtedy wyszukiwaniem w słowniku, co
// kosztowało funkcje wołane per węzeł (skóra sprite'a +40%, activateNode, zgniot).
export class BeamNodeStore {
  constructor(count) {
    this.count = count;
    const f64 = () => new Float64Array(count), i32 = () => new Int32Array(count), u8 = () => new Uint8Array(count);
    this.x = f64(); this.y = f64(); this.z = f64();
    this.ox = f64(); this.oy = f64(); this.oz = f64();
    this.px = f64(); this.py = f64(); this.pz = f64();
    this.vx = f64(); this.vy = f64(); this.vz = f64();
    this.mass = f64(); this.invMass = f64(); this.hp = f64(); this.maxHp = f64();
    this.coverage = f64(); this.r = f64(); this.g = f64(); this.b = f64(); this.crushDepth = f64();
    this.ix = i32(); this.iy = i32(); this.iz = i32(); this.depth = i32();
    this.beamCount = i32(); this.localBeamCount = i32(); this.platingCount = i32();
    this.quiet = i32(); this.solveStamp = i32(); this.outerStamp = i32(); this.islandStamp = i32();
    this.massStamp = i32(); this.crushStamp = i32(); this.hashNext = i32().fill(-1);
    this.active = u8(); this.surface = u8(); this.act = u8(); this.skinDirty = u8();
    // Lista belek węzła i: adj[adjStart[i] .. adjStart[i + 1]) — indeksy belek.
    this.adjStart = new Int32Array(count + 1);
    this.adj = new Int32Array(0);
  }

  clone() {
    const copy = new BeamNodeStore(this.count);
    for (const f of NODE_FIELDS) copy[f].set(this[f]);
    copy.adjStart = this.adjStart.slice();
    copy.adj = this.adj.slice();
    return copy;
  }
}

export class BeamLinkStore {
  constructor(count) {
    this.count = count;
    this.rest = new Float64Array(count); this.restBase = new Float64Array(count);
    this.stiffness = new Float64Array(count); this.deform = new Float64Array(count);
    this.brk = new Float64Array(count); this.strain = new Float64Array(count); this.fatigue = new Float64Array(count);
    this.a = new Int32Array(count); this.b = new Int32Array(count); this.stamp = new Int32Array(count);
    this.type = new Uint8Array(count); this.broken = new Uint8Array(count); this.restBridge = new Uint8Array(count);
  }

  clone() {
    const copy = new BeamLinkStore(this.count);
    for (const f of BEAM_FIELDS) copy[f].set(this[f]);
    return copy;
  }
}

export class BeamNodeView {
  constructor(store, index) { this._s = store; this._i = index; }
  get id() { return this._i; }
  // Lista belek węzła (widok CSR — tylko do odczytu, jak dawna tablica indeksów).
  get beams() { const s = this._s; return s.adj.subarray(s.adjStart[this._i], s.adjStart[this._i + 1]); }
}

export class BeamView {
  constructor(store, index) { this._s = store; this._i = index; }
}

function defineAccessors(proto, fields, aliases, booleans) {
  const define = (name, field) => {
    if (booleans.has(field)) {
      Object.defineProperty(proto, name, {
        get() { return this._s[field][this._i] === 1; },
        set(v) { this._s[field][this._i] = v ? 1 : 0; }
      });
    } else {
      Object.defineProperty(proto, name, {
        get() { return this._s[field][this._i]; },
        set(v) { this._s[field][this._i] = v; }
      });
    }
  };
  for (const f of fields) define(f, f);
  for (const [name, field] of Object.entries(aliases)) define(name, field);
}
defineAccessors(BeamNodeView.prototype, [...NODE_F64, ...NODE_I32, ...NODE_U8], NODE_ALIASES, NODE_BOOLEAN);
defineAccessors(BeamView.prototype, [...BEAM_F64, ...BEAM_I32, ...BEAM_U8], BEAM_ALIASES, BEAM_BOOLEAN);

export function nodeViews(store) {
  const out = new Array(store.count);
  for (let i = 0; i < store.count; i++) out[i] = new BeamNodeView(store, i);
  return out;
}

export function beamViews(store) {
  const out = new Array(store.count);
  for (let i = 0; i < store.count; i++) out[i] = new BeamView(store, i);
  return out;
}

// `obj.nodes` / `obj.beams` NA ŻĄDANIE (konstrukcje i ciała): tablica widoków powstaje
// przy pierwszym odczycie i należy do bieżącego magazynu obiektu. Gorąca ścieżka czyta
// magazyny, więc flota nie trzyma setek tysięcy widoków — przy siatce 7,5 j. pełne GC
// znakowało ich ~0,5 mln co kilka sekund (11 × 9–23 ms w bitwie taranów).
// Akcesory nie są przeliczalne: spread `{ ...structure }` ich nie wywołuje.
const LAZY_NODES = {
  configurable: true, enumerable: false,
  get() {
    if (this._nodeViewsOf !== this.nodeStore) {
      this._nodeViews = nodeViews(this.nodeStore);
      this._nodeViewsOf = this.nodeStore;
    }
    return this._nodeViews;
  },
  set(views) { this._nodeViews = views; this._nodeViewsOf = views ? this.nodeStore : null; }
};
const LAZY_BEAMS = {
  configurable: true, enumerable: false,
  get() {
    if (this._beamViewsOf !== this.beamStore) {
      this._beamViews = beamViews(this.beamStore);
      this._beamViewsOf = this.beamStore;
    }
    return this._beamViews;
  },
  set(views) { this._beamViews = views; this._beamViewsOf = views ? this.beamStore : null; }
};

/** Leniwe `nodes` / `beams` na obiekcie z `nodeStore` / `beamStore`; opcjonalnie gotowe widoki. */
export function defineLazyViews(obj, nodes = null, beams = null) {
  obj._nodeViews = nodes; obj._nodeViewsOf = nodes ? obj.nodeStore : null;
  obj._beamViews = beams; obj._beamViewsOf = beams ? obj.beamStore : null;
  Object.defineProperty(obj, 'nodes', LAZY_NODES);
  Object.defineProperty(obj, 'beams', LAZY_BEAMS);
  return obj;
}

/** Widoki węzłów, jeśli już powstały dla bieżącego magazynu — bez tworzenia nowych. */
export function cachedNodeViews(obj) {
  return obj._nodeViewsOf === obj.nodeStore ? obj._nodeViews : null;
}

export function cachedBeamViews(obj) {
  return obj._beamViewsOf === obj.beamStore ? obj._beamViews : null;
}

/** Widok jednego węzła bez budowania tablicy: gotowy, jeśli istnieje, inaczej osobny (bez gwarancji tożsamości). */
export function nodeViewAt(obj, i) {
  const views = cachedNodeViews(obj);
  return views ? views[i] : new BeamNodeView(obj.nodeStore, i);
}

/**
 * Listy belek węzłów (CSR) z tablic końców. Kolejność jak dawne `node.beams.push`
 * w kolejności belek — solver i wyspy odwiedzają sąsiadów w tej samej kolejności.
 */
export function buildAdjacency(nodeStore, beamStore) {
  const n = nodeStore.count, m = beamStore.count;
  const start = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) { start[beamStore.a[e] + 1]++; start[beamStore.b[e] + 1]++; }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const fill = start.slice(0, n);
  const adj = new Int32Array(start[n]);
  for (let e = 0; e < m; e++) {
    adj[fill[beamStore.a[e]]++] = e;
    adj[fill[beamStore.b[e]]++] = e;
  }
  nodeStore.adjStart = start;
  nodeStore.adj = adj;
}

// Obiekty węzłów i belek z budowy konstrukcji → magazyny + widoki węzłów (kratownica
// budowy trzyma widoki; belki dostają widoki dopiero na żądanie, przez defineLazyViews).
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
