// src/3d/gas/gasGridSet.js
//
// ZESTAW SIATEK GAZU (etap D 2026-10-09, F5b audytu docs/AUDYT-wybuchy-gaz-2026-10-08.md): kilka GasGrid o różnej
// rozdzielczości atlasu (podstawowy 96² × 36 i „fine” 128² × 48 — kula ognia duża na ekranie dostaje drobniejszą
// siatkę) widzianych przez reżysera wybuchów, reżysera emiterów (GasExplosions) i żar (GasEmbers) jak JEDNA siatka:
//   • indeksy domen GLOBALNE — siatka 0: 0…S0−1, siatka 1: S0…S0+S1−1 (GasSlot.gid; GasSlot.index zostaje indeksem
//     w atlasie swojej siatki) — emitery, wtórne, właściciele świateł siatki, żar i przejęcia domen bez zmian;
//   • wspólne: strojenie fizyki (`tune` — jeden obiekt), początek sceny (`origin`), kierunek słońca, zegar (każda
//     siatka kroczy w simulate tym samym dt);
//   • osobne: atlasy, kernele (każda siatka swoje `renderer.compute` — siatka bez domen nic nie zleca), raster statyki
//     i maski kadłubów (okno rastra na siatkę), bryły obrazu (GasVolume na siatkę — explosionFx).
// Statystyki zbiorcze (`stats`) liczone po beginFrame / updateRasters / simulate — bez alokacji.

const SUM_KEYS = ['active', 'sources', 'hulls', 'hullsIn', 'hullsDropped', 'masked', 'rasters', 'rasterMs', 'packMs', 'bandUploads',
  'dropped', 'cells', 'allocs', 'releases'];

export class GasGridSet {
  /** @param {import('./gasGrid.js').GasGrid[]} grids — pierwsza: siatka podstawowa (N, NZ, MS zestawu) */
  constructor(grids) {
    this.grids = grids;
    this.base = new Int32Array(grids.length);
    this.slots = [];
    let b = 0;
    for (let t = 0; t < grids.length; t++) {
      const g = grids[t];
      this.base[t] = b;
      for (const s of g.slots) { s.gid = b + s.index; s.tier = t; this.slots.push(s); }
      b += g.S;
    }
    this.S = b;
    const m = grids[0];
    this.N = m.N; this.NZ = m.NZ; this.MS = m.MS;
    // wspólne obiekty strojenia, początku sceny i słońca (siatki czytają je przy pakowaniu / synchronizacji uniformów)
    for (let t = 1; t < grids.length; t++) {
      grids[t].tune = m.tune;
      grids[t].origin = m.origin;
      grids[t].sunDir = m.sunDir;
    }
    this.stats = {};
    for (const k of SUM_KEYS) this.stats[k] = 0;
    this.stats.substeps = 0;
    this._tierOf = new Int8Array(this.S);
    for (const s of this.slots) this._tierOf[s.gid] = s.tier;
  }

  // Siatka podstawowa — pola wewnętrzne dla narzędzi i testów (statyka, uniformy, źródła, atlasy).
  get U() { return this.grids[0].U; }
  get _boxN() { return this.grids[0]._boxN; }
  get _boxes() { return this.grids[0]._boxes; }
  get _footN() { return this.grids[0]._footN; }
  get _src() { return this.grids[0]._src; }
  get _srcN() { return this.grids[0]._srcN; }
  get staticVersion() { return this.grids[0].staticVersion; }

  get tune() { return this.grids[0].tune; }
  get origin() { return this.grids[0].origin; }
  get sunDir() { return this.grids[0].sunDir; }
  get time() { return this.grids[0].time; }
  get rng() { return this.grids[0].rng; }
  get live() { for (const g of this.grids) if (g.live) return true; return false; }
  get memoryBytes() { let n = 0; for (const g of this.grids) n += g.memoryBytes; return n; }

  /** Siatka i indeks lokalny domeny o indeksie globalnym `gid` (−1 / poza zakresem — null). */
  gridOf(gid) { return gid >= 0 && gid < this.S ? this.grids[this._tierOf[gid]] : null; }
  local(gid) { return gid - this.base[this._tierOf[gid]]; }

  /** Domena w siatce `opts.tier` (0 — podstawowa); zwraca indeks GLOBALNY albo −1. */
  acquire(x, y, z, radius, opts = {}) {
    const t = Math.max(0, Math.min(this.grids.length - 1, opts.tier | 0));
    const l = this.grids[t].acquire(x, y, z, radius, opts);
    return l < 0 ? -1 : this.base[t] + l;
  }
  release(gid) { const g = this.gridOf(gid); if (g) g.release(this.local(gid)); }
  feed(gid, until) { const g = this.gridOf(gid); if (g) g.feed(this.local(gid), until); }
  keepAlive(gid, until) { const g = this.gridOf(gid); if (g) g.keepAlive(this.local(gid), until); }
  contains(gid, x, y, z, m) { const g = this.gridOf(gid); return g ? g.contains(this.local(gid), x, y, z, m) : false; }
  slotAt(x, y, z, m) {
    for (let t = 0; t < this.grids.length; t++) { const l = this.grids[t].slotAt(x, y, z, m); if (l >= 0) return this.base[t] + l; }
    return -1;
  }
  // (argumenty jawnie — reżyser woła co klatkę na emiter; bez tablicy reszty argumentów)
  source(gid, x0, y0, z0, x1, y1, z1, r, fuel, temp, smoke, radial, vx, vy, vz, velBlend, noise) {
    const g = this.gridOf(gid);
    if (!g) { this.grids[0].stats.dropped++; return false; }
    return g.source(this.local(gid), x0, y0, z0, x1, y1, z1, r, fuel, temp, smoke, radial, vx, vy, vz, velBlend, noise);
  }
  solidAt(gid, x, y) { const g = this.gridOf(gid); return g ? g.solidAt(this.local(gid), x, y) : false; }
  freePoint(gid, x, y, maxCells, out) { const g = this.gridOf(gid); return g ? g.freePoint(this.local(gid), x, y, maxCells, out) : false; }
  clipSegment(gid, x0, y0, x1, y1, out) { const g = this.gridOf(gid); return g ? g.clipSegment(this.local(gid), x0, y0, x1, y1, out) : false; }

  setStatics(version, boxes, nBoxes, foots, nFoots) { for (const g of this.grids) g.setStatics(version, boxes, nBoxes, foots, nFoots); }
  hull(src, o = 0) { let ok = false; for (const g of this.grids) ok = g.hull(src, o) || ok; return ok; }
  beginFrame() { for (const g of this.grids) g.beginFrame(); this._sum(); }
  updateRasters() { for (const g of this.grids) g.updateRasters(); this._sum(); }

  /** Krok wszystkich siatek (każda swoje renderer.compute; bez domen — bez zleceń). */
  simulate(renderer, dt) {
    for (const g of this.grids) g.simulate(renderer, dt);
    this._sum();
  }

  _sum() {
    const S = this.stats;
    for (const k of SUM_KEYS) {
      let v = 0;
      for (const g of this.grids) v += Number(g.stats[k]) || 0;
      S[k] = v;
    }
    let sub = 0;
    for (const g of this.grids) sub = Math.max(sub, g.stats.substeps || 0);
    S.substeps = sub;
  }

  warm(renderer) { for (const g of this.grids) g.warm(renderer); }
  clear() { for (const g of this.grids) g.clear(); }
  dispose() { for (const g of this.grids) g.dispose(); }

  // Narzędzia (sonda, testy) — indeks globalny.
  probe(renderer, gid, opts) { return this.gridOf(gid).probe(renderer, this.local(gid), opts); }
  probeSlice(renderer, gid, z) { return this.gridOf(gid).probeSlice(renderer, this.local(gid), z); }
  checkProjectCpu(renderer, gid, zc) { return this.gridOf(gid).checkProjectCpu(renderer, this.local(gid), zc); }
  solidCpu(gid, px, py, out) { return this.gridOf(gid).solidCpu(this.local(gid), px, py, out); }
  sourceOcclusionCpu(gid, px, py, ax, ay) { return this.gridOf(gid).sourceOcclusionCpu(this.local(gid), px, py, ax, ay); }
}
