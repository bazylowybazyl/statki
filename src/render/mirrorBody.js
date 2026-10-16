// src/render/mirrorBody.js — replika ciała belek po stronie renderu (docs/PLAN-render-worker.md § 3.6, RW-11a).
//
// Moduły 3D (skóra kadłuba `beamHullSkin.js`, cień SDF, mocowania lamp i dysz `hullMounts.js`, sonda `HullBodies`)
// czytają `hull.body` i jego magazyny SoA. Lustro daje im obiekt o tych samych polach, aktualizowany W MIEJSCU ze
// strony migawki (blok BODY + pula NODES): stała klasa ukryta, tożsamość magazynu stała, dopóki gra nie podmieni
// magazynu (rozpad, odrost — `STORE_VER`), topologia z opisu ciała (raz na magazyn). Render czyści flagi brudu
// REPLIKI (`clearHullSkinDirty`, `meshDirty = false`) tak jak dziś czyści flagi gry — strona niesie zmiany od
// ostatniej klatki odebranej, replika je sumuje (bez powtórzeń, w kolejności dopisania — jak `_region.dirty` gry).
//
// Czysty moduł (bez three, DOM i `window`).

import { BODY, BODY_FLAG } from './snapshotLayout.js';

const BF = BODY.F64, BI = BODY.I32;

/**
 * Topologia magazynu (opis ciała, raz na magazyn — wspólna dla typu kadłuba; w workerze z `postMessage`):
 * `{ count, ix, iy, iz, adjStart, adj, beamCount, a, b, restBase, type, hp, maxHp, mass }` (tablice typowane).
 */
export function describeBodyTopology(body) {
  const s = body.nodeStore, e = body.beamStore;
  return {
    count: s.count,
    ix: s.ix.slice(0, s.count), iy: s.iy.slice(0, s.count), iz: s.iz.slice(0, s.count),
    adjStart: s.adjStart.slice(0, s.count + 1), adj: s.adj.slice(),
    beamCount: e ? e.count : 0,
    a: e ? e.a.slice(0, e.count) : new Int32Array(0),
    b: e ? e.b.slice(0, e.count) : new Int32Array(0),
    restBase: e ? e.restBase.slice(0, e.count) : new Float64Array(0),
    type: e ? e.type.slice(0, e.count) : new Uint8Array(0)
  };
}

/** Replika magazynu węzłów: pola czytane przez render (nazwy jak `BeamNodeStore`). */
export class MirrorNodeStore {
  constructor(topo) {
    const n = topo.count;
    this.count = n;
    this.x = new Float64Array(n); this.y = new Float64Array(n); this.z = new Float64Array(n);
    this.ox = new Float64Array(n); this.oy = new Float64Array(n); this.oz = new Float64Array(n);
    this.heat = new Float64Array(n); this.heatStamp = new Float64Array(n);
    this.hp = new Float64Array(n); this.maxHp = new Float64Array(n);
    this.ix = topo.ix; this.iy = topo.iy; this.iz = topo.iz;
    this.active = new Uint8Array(n); this.patch = new Uint8Array(n); this.skinDirty = new Uint8Array(n);
    this.adjStart = topo.adjStart; this.adj = topo.adj;
    this.shapeVersion = 0;
  }
}

/** Replika magazynu belek. */
export class MirrorBeamStore {
  constructor(topo) {
    const m = topo.beamCount;
    this.count = m;
    this.a = topo.a; this.b = topo.b; this.restBase = topo.restBase; this.type = topo.type;
    this.rest = new Float64Array(m);
    this.broken = new Uint8Array(m);
  }
}

/** Obszar brudny repliki (pola jak `_region` silnika belek, które czyta render). */
export class MirrorRegion {
  constructor(store) {
    this.store = store;
    this.dirty = new Int32Array(store.count);
    this.dirtyCount = 0;
    this.dirtyAll = false;
    this.drift = 0;
  }
}

/**
 * Ciało-lustro: `nodeStore`, `beamStore`, `_region` (replika), skalary z bloku BODY, pola statyczne z opisu
 * (`spriteSkin`, `dims`, `planar`, `anchored`). `_lattice` buduje render sam (hullMounts / sonda — `D._latticeIndex`).
 */
export class MirrorBody {
  constructor(slot, gen) {
    this.slot = slot;
    this.gen = gen;
    this.storeVer = -1;
    this.hpReceived = false;    // HP węzłów repliki doszło (mostki: obecność komórek liczona z HP przy adopcji)
    this.nodeStore = null;
    this.beamStore = null;
    this._region = null;
    this.activeNodes = 0;
    this.dead = false;
    this.isSleeping = false;
    this.planar = true;
    this.anchored = false;
    this.cellSize = 0;
    this.latticeMin = { x: 0, y: 0, z: 0 };
    this._boundsMinMax = new Float64Array(6);
    this._maxDisp = 0;
    this.pos = { x: 0, y: 0, z: 0 };            // poza w świecie silnika (bryły 3D — worldBodies3D)
    this.quat = { x: 0, y: 0, z: 0, w: 1 };
    this.meshDirty = false;
    this.spriteSkin = null;
    this.dims = null;
    this._lattice = null;
    this.entity = null;
  }

  /** Nowy magazyn (topologia z opisu): replika od zera, render przebuduje skórę (tożsamość magazynu inna). */
  setTopology(topo, storeVer) {
    const s = new MirrorNodeStore(topo);
    this.nodeStore = s;
    this.beamStore = new MirrorBeamStore(topo);
    this._region = new MirrorRegion(s);
    this.storeVer = storeVer;
    this.hpReceived = false;
  }
}

/**
 * Stan ciała ze strony: skalary BODY, węzły i belki z NODES (gdy spakowane), pozycje spoczynkowe (po zmianie
 * kształtu), suma brudu. Zwraca false, gdy brak topologii dla tej wersji magazynu (lustro czeka na opis).
 */
export function applyBodyPage(mb, v, bs) {
  const f64 = v.bodyF64, i32 = v.bodyI32;
  const b = bs * BODY.stride.f64, bi = bs * BODY.stride.i32;
  if (i32[bi + BI.STORE_VER] !== mb.storeVer || !mb.nodeStore) return false;
  const flags = i32[bi + BI.FLAGS];
  mb.activeNodes = i32[bi + BI.ACTIVE_NODES];
  mb.dead = (flags & BODY_FLAG.DEAD) !== 0;
  mb.isSleeping = (flags & BODY_FLAG.SLEEPING) !== 0;
  mb.planar = (flags & BODY_FLAG.PLANAR) !== 0;
  mb.cellSize = f64[b + BF.CELL];
  const lm = mb.latticeMin;
  lm.x = f64[b + BF.LAT_MIN_X]; lm.y = f64[b + BF.LAT_MIN_Y]; lm.z = f64[b + BF.LAT_MIN_Z];
  const bmm = mb._boundsMinMax;
  bmm[0] = f64[b + BF.MIN_X]; bmm[1] = f64[b + BF.MIN_Y]; bmm[2] = f64[b + BF.MIN_Z];
  bmm[3] = f64[b + BF.MAX_X]; bmm[4] = f64[b + BF.MAX_Y]; bmm[5] = f64[b + BF.MAX_Z];
  mb._maxDisp = f64[b + BF.MAX_DISP];
  const bp = mb.pos, bq = mb.quat;
  bp.x = f64[b + BF.POS_X]; bp.y = f64[b + BF.POS_Y]; bp.z = f64[b + BF.POS_Z];
  bq.x = f64[b + BF.QUAT_X]; bq.y = f64[b + BF.QUAT_Y]; bq.z = f64[b + BF.QUAT_Z]; bq.w = f64[b + BF.QUAT_W];
  const s = mb.nodeStore, e = mb.beamStore;
  s.shapeVersion = i32[bi + BI.SHAPE_VER];
  const ho = i32[bi + BI.HP_F64_OFF];
  if (ho >= 0) {
    const c = s.count;
    s.hp.set(v.nodeF64.subarray(ho, ho + c));
    s.maxHp.set(v.nodeF64.subarray(ho + c, ho + 2 * c));
    mb.hpReceived = true;
  }
  const n = i32[bi + BI.NODE_N];
  if (n > 0) {
    const F = v.nodeF64, U = v.nodeU8;
    const o = i32[bi + BI.NODE_F64_OFF], u = i32[bi + BI.NODE_U8_OFF];
    s.x.set(F.subarray(o, o + n));
    s.y.set(F.subarray(o + n, o + 2 * n));
    let p = o + 2 * n;
    if (!mb.planar) { s.z.set(F.subarray(p, p + n)); p += n; }
    s.heat.set(F.subarray(p, p + n)); p += n;
    s.heatStamp.set(F.subarray(p, p + n));
    s.active.set(U.subarray(u, u + n));
    s.patch.set(U.subarray(u + n, u + 2 * n));
    const m = i32[bi + BI.BEAM_N];
    if (m > 0) {
      const bo = i32[bi + BI.BEAM_F64_OFF], bu = i32[bi + BI.BEAM_U8_OFF];
      e.rest.set(F.subarray(bo, bo + m));
      e.broken.set(U.subarray(bu, bu + m));
    }
    const ro = i32[bi + BI.REST_F64_OFF];
    if (ro >= 0) {
      s.ox.set(F.subarray(ro, ro + n));
      s.oy.set(F.subarray(ro + n, ro + 2 * n));
      if (!mb.planar) s.oz.set(F.subarray(ro + 2 * n, ro + 3 * n));
    }
    // brud: suma z repliką (bez powtórzeń, kolejność dopisania)
    const reg = mb._region;
    if (flags & BODY_FLAG.MESH_DIRTY) mb.meshDirty = true;
    if (flags & BODY_FLAG.DIRTY_ALL) reg.dirtyAll = true;
    const dn = i32[bi + BI.DIRTY_N];
    if (dn > 0 && !reg.dirtyAll) {
      const D = v.nodeI32, d0 = i32[bi + BI.DIRTY_OFF];
      const sd = s.skinDirty, out = reg.dirty;
      for (let k = 0; k < dn; k++) {
        const i = D[d0 + k];
        if (!sd[i]) { sd[i] = 1; out[reg.dirtyCount++] = i; }
      }
    }
  }
  return true;
}
