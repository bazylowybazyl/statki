// src/3d/powerArcsFx3D.js
//
// ISKRY I ŁUKI ELEKTRYCZNE PRZY RANACH ZASILANEJ CZĘŚCI KADŁUBA (pomysł przyjęty 2026-11-11: „iskry i łuki elektryczne
// przy ranach w zasilanej części okrętu; wyłączony okręt nie iskrzy”). Sam obraz — rozgrywka bez zmian.
//
// KIEDY: okręt (gracz i NPC) z kadłubem na belkach w PRACY (`shipPowerOn` z src/game/shipPower.js — encja bez
// `shipPower` = praca; ROZRUCH, GASZENIE i WYŁ. nie iskrzą; lustro workera niesie `shipPower { state, t }` albo null),
// nie wrak, nie odłam, nie hulk mostka (utrata dowodzenia gasi okręt), z ranami. RANA = BRZEG DZIURY: żywy węzeł,
// którego sąsiednia komórka siatki spoczynkowej (8-sąsiedztwo) ma węzeł MARTWY. Komórka bez węzła to burta (poza
// obrysem kadłuba), nie rana. Żywy statek trzyma magazyn w układzie konstrukcji (`body.keepLayout`), więc martwy wpis
// = dziura: krater, rzaz, odcięta sekcja.
//
// OBRAZ: krótki przeskok łuku z brzegu ku dziurze — przez dziurę do brzegu po drugiej stronie (marsz po komórkach,
// najwyżej `jumpCells`), inaczej łuk w pustkę na `freeMin…freeMax` komórki; czasem powtórne uderzenie z tego samego
// miejsca (`restrike`, łuk opóźniony ujemnym wiekiem); drobne iskry w stronę dziury z końca łuku i krótki błysk
// w siatce świateł Core3D. Pule ARC i SPARK broni (WeaponFx — rozgrzane krokami `Core3D.fx`, bez nowych materiałów
// i siatek), nośnik = kadłub w pozie RENDERU (efekt jedzie z okrętem; `writeCarrier(…, fromRender = true)`), barwa —
// chłodna biel, piraci — brudny pomarańcz (jak przepięcia agonii mostka w bridgeFx3D.js), × widoczność maskowania.
// Losowość tylko `fxRandom`, zegar modułu — `Core3D.frameNowMs()` (pauza: wołający podaje dt = 0 → nic).
//
// CZĘSTOŚĆ: na okręt `rateMin…rateMax` łuków / s (rośnie z liczbą brzegów do `edgeFull`), po świeżej ranie (nowe
// brzegi w przeglądzie) dodatkowo `freshRate` gasnące z `freshTau` — łuki wtedy częściej z nowych brzegów. W klatce
// najwyżej `maxArcsPerFrame` łuków na wszystkie okręty i `maxHulls` okrętów: największe na ekranie i najbliżej środka
// kadru (pierwsze zużywają budżet); okręt poza kadrem albo z komórką siatki mniejszą niż `minCellPx` px — nic.
//
// BRZEGI liczy `scanWoundEdges` tylko PO ZMIANIE ciała (magazyn, liczba węzłów, `activeNodes`; lustro w workerze —
// też nowy stan węzłów, gdy replika `active` nie nadążała za `activeNodes`) do tablic typowanych rekordu kadłuba.
// Klatka bez zmian nie przegląda węzłów i nie alokuje. W workerze ciało bez stanu węzłów (`nodesReceived` false —
// poza pudłem rozgrzania) jest pomijane.
//
// WOŁAJĄCY: BridgeFx3D.update na KOŃCU (ta sama lista i opcje — strona: tryby off / inline `renderSeenCold`, worker:
// lista SEEN_COLD; mgła wojny i soczewka skoku są już w liście; `cull` — pudło kadru `_hexCullInfo` / `st.cull`),
// więc moduł nie dokłada odwołań strony do renderu. Usługi: BridgeFx3D.attach → PowerArcsFx3D.attach({ weaponFx }).

import { fxRandom } from './fx/fxRandom.js';
import { Core3D } from './core3d.js';
import { shipPowerOn } from '../game/shipPower.js';
import { ActiveCarrier, writeCarrier } from '../game/carrierVelocity.js';
import { bridgeBeamHull, beamLatticePose, beamLatticeToWorldPosed } from '../game/shipBridgeBeams.js';

/** Strojenie (konsola / harness: import modułu). */
export const POWER_ARCS_TUNE = {
  enabled: true,
  maxArcsPerFrame: 3,   // budżet łuków na klatkę (wszystkie okręty)
  maxHulls: 6,          // okrętów z łukami w klatce (największe na ekranie, najbliżej środka kadru)
  rateMin: 0.35,        // łuków / s przy małej ranie (jeden brzeg)
  rateMax: 2.2,         // … przy dużej (edgeFull brzegów i więcej)
  edgeFull: 40,
  freshRate: 6,         // dodatkowe łuki / s tuż po nowej ranie (× świeżość 0..1)
  freshTau: 1.4,        // s — gaśnięcie świeżości
  freshPerEdge: 0.12,   // przyrost świeżości na nowy brzeg
  freshWindow: 2.5,     // s — brzeg „świeży” (pierwszeństwo przy wyborze, gdy świeżość > 0,15)
  minCellPx: 1.4,       // komórka siatki na ekranie [px], poniżej której łuków nie ma (z daleka niewidoczne)
  jumpCells: 4,         // przeskok przez dziurę do brzegu najwyżej tyle komórek
  freeMin: 0.6,         // łuk w pustkę: długość w komórkach
  freeMax: 1.5,
  spread: 1.1,          // rozrzut kierunku [rad] wokół kierunku do dziury (pełna szerokość)
  lifeMin: 0.05,        // s
  lifeMax: 0.13,
  widthPx: 1.3,         // szerokość łuku na ekranie
  restrike: 0.35,       // szansa powtórnego uderzenia z tego samego miejsca
  sparks: 1.0,          // mnożnik iskier (2–5 na łuk)
  light: 1.0,           // mnożnik mocy błysku w siatce świateł (0 — bez światła)
  z: 17                 // wysokość nad płaszczyzną gry (jak łuki agonii mostka)
};

// Barwy (HDR: rdzeń łuku nad progiem bloomu), iskry jak palety receptur broni (jon / ogień: barwa, chłodzenie G, B).
const ARC_COOL = [3.3, 3.8, 4.9];
const ARC_WARM = [4.8, 3.0, 1.6];
const SPARK_COOL = [1.7, 2.6, 3.8];
const SPARK_COOL_FADE = [1.0, 1.15];
const SPARK_WARM = [2.8, 2.3, 1.6];
const SPARK_WARM_FADE = [0.32, 0.06];
/** Rodzaj cząstki puli SPARK (K.SPARK w weapons/gpuFx.js — test pilnuje zgodności). */
export const POWER_ARC_SPARK_KIND = 0;

const NB_X = Int8Array.of(-1, 0, 1, -1, 1, -1, 0, 1);
const NB_Y = Int8Array.of(-1, -1, -1, 0, 0, 1, 1, 1);
const NB_W = Float64Array.of(Math.SQRT1_2, 1, Math.SQRT1_2, 1, 1, Math.SQRT1_2, 1, Math.SQRT1_2);
const MAX_CAND = 32;
const PRUNE_EVERY = 240;     // klatek — rekordy kadłubów niewidzianych tyle klatek odchodzą
const OLD = -1e9;            // znacznik brzegu sprzed pierwszego przeglądu (nie świeży)

const _pose = { x: 0, y: 0, c: 1, s: 0 };
const _a = { x: 0, y: 0 };
const _b = { x: 0, y: 0 };
const _carrier = { x: 0, y: 0, vx: 0, vy: 0, clock: 0, t0: 0, z: 0 };

function entX(e) { return (e.pos && typeof e.pos.x === 'number') ? e.pos.x : (Number(e.x) || 0); }
function entY(e) { return (e.pos && typeof e.pos.y === 'number') ? e.pos.y : (Number(e.y) || 0); }

/** Rekord kadłuba (tablice wielokrotnego użytku; rosną tylko przy większym magazynie). */
export function createWoundRecord(hull = null) {
  return {
    hull,
    store: null, n: -1, active: -1, seq: -1, stale: false,
    dimX: 0, dimY: 0, cells: null,
    edges: null, dirX: null, dirY: null, count: 0,
    born: null,      // Float64Array(n): chwila pierwszego widzenia brzegu [s]; −∞ — węzeł nie jest brzegiem
    fresh: 0, acc: 0, seen: 0
  };
}

/** Czy brzegi rekordu trzeba policzyć od nowa (zmiana ciała). */
export function woundRecordStale(rec, body) {
  const s = body.nodeStore;
  if (rec.store !== s || rec.n !== s.count || rec.active !== body.activeNodes) return true;
  // lustro: replika `active` nie nadążała za `activeNodes` — przegląd po nowym stanie węzłów
  return rec.stale && rec.seq !== body.nodesSeq;
}

/**
 * Brzegi ran kadłuba belkowego do rekordu `rec`: żywe węzły (warstwa iz = 0) z martwym węzłem w sąsiedniej komórce
 * siatki spoczynkowej, kierunek ku dziurze (średnia kierunków do martwych sąsiadów, siatka: x w prawo, y w górę).
 * `now` [s] — chwila narodzin nowych brzegów (świeżość). Zwraca liczbę nowych brzegów (0 przy pierwszym przeglądzie
 * rekordu — rany zastane nie są świeże). Bez alokacji, gdy magazyn się nie zmienił.
 */
export function scanWoundEdges(hull, rec, now = 0) {
  const body = hull.body;
  const s = body.nodeStore;
  const d = body.dims;
  const n = s.count;
  const dx = d.x | 0, dy = d.y | 0;
  const first = rec.store === null;
  const rebuilt = rec.store !== s || rec.n !== n || rec.dimX !== dx || rec.dimY !== dy;
  const prevCount = rec.count;
  if (rebuilt) {
    const cellsN = dx * dy;
    if (!rec.cells || rec.cells.length < cellsN) rec.cells = new Int32Array(cellsN);
    const cells = rec.cells;
    cells.fill(-1, 0, cellsN);
    const ix = s.ix, iy = s.iy, iz = s.iz;
    for (let i = 0; i < n; i++) {
      if (iz && iz[i] !== 0) continue;
      const gx = ix[i], gy = iy[i];
      if (gx >= 0 && gy >= 0 && gx < dx && gy < dy) cells[gx + gy * dx] = i;
    }
    if (!rec.edges || rec.edges.length < n) {
      const cap = Math.max(16, n);
      rec.edges = new Int32Array(cap);
      rec.dirX = new Float32Array(cap);
      rec.dirY = new Float32Array(cap);
      rec.born = new Float64Array(cap);
    }
    rec.born.fill(-Infinity, 0, n);
    rec.dimX = dx; rec.dimY = dy;
  }
  const cells = rec.cells, active = s.active, ix = s.ix, iy = s.iy, iz = s.iz;
  const edges = rec.edges, dirX = rec.dirX, dirY = rec.dirY, born = rec.born;
  // nowy magazyn przy znanym kadłubie (przebudowa ciała): przybytek brzegów liczy się jako świeży, bez ich wskazania
  const bornNew = first || rebuilt ? OLD : now;
  let count = 0, fresh = 0, live = 0;
  for (let i = 0; i < n; i++) {
    if (!active[i]) { born[i] = -Infinity; continue; }
    live++;
    if (iz && iz[i] !== 0) continue;
    const gx = ix[i], gy = iy[i];
    let sx = 0, sy = 0, nd = 0, fx = 0, fy = 0;
    for (let k = 0; k < 8; k++) {
      const nx = gx + NB_X[k], ny = gy + NB_Y[k];
      if (nx < 0 || ny < 0 || nx >= dx || ny >= dy) continue;
      const j = cells[nx + ny * dx];
      if (j < 0 || active[j]) continue;
      const w = NB_W[k];
      if (nd === 0) { fx = NB_X[k] * w; fy = NB_Y[k] * w; }
      sx += NB_X[k] * w; sy += NB_Y[k] * w;
      nd++;
    }
    if (nd === 0) { born[i] = -Infinity; continue; }
    let l = Math.sqrt(sx * sx + sy * sy);
    if (l < 1e-6) { sx = fx; sy = fy; l = Math.sqrt(sx * sx + sy * sy); }   // martwi sąsiedzi naprzeciw siebie
    edges[count] = i;
    dirX[count] = sx / l;
    dirY[count] = sy / l;
    count++;
    if (born[i] === -Infinity) { born[i] = bornNew; if (bornNew === now) fresh++; }
  }
  rec.count = count;
  rec.store = s;
  rec.n = n;
  rec.active = body.activeNodes;
  rec.seq = body.nodesSeq;
  rec.stale = live !== body.activeNodes;
  if (!first && rebuilt && count > prevCount) fresh = count - prevCount;
  return fresh;
}

export const PowerArcsFx3D = {
  weaponFx: null,
  tune: POWER_ARCS_TUNE,
  _records: new Map(),
  _frame: 0,
  _lastNow: NaN,
  _cand: new Array(MAX_CAND).fill(null),
  _candScore: new Float64Array(MAX_CAND),
  _candVis: new Float64Array(MAX_CAND),
  _candPose: new Array(MAX_CAND).fill(null),
  _pruneFn: null,
  _pruneLimit: 0,
  // liczby double dla _emit (niewklejone wywołanie pakowałoby argumenty double — alokacja na łuk): [0] chwila [s],
  // [1] widoczność maskowania okrętu
  _f: new Float64Array(2),
  /**
   * arcs / restrikes / sparks / lights / scans / frames — sumy; hulls, edges, frameArcs — ostatnia klatka (czas CPU
   * mierzy harness owinięciem `update` — performance.now() w module to alokacja w Node i dwa odczyty zegara na klatkę).
   */
  stats: { arcs: 0, restrikes: 0, sparks: 0, lights: 0, scans: 0, hulls: 0, edges: 0, frameArcs: 0, maxFrameArcs: 0, frames: 0 },

  /** Usługi hosta: weaponFx — fasada WeaponFx (pule ARC i SPARK); bez niej łuków nie ma. */
  attach(services = null) {
    if (services && services.weaponFx) this.weaponFx = services.weaponFx;
    return !!this.weaponFx;
  },

  /** Rekord brzegów kadłuba (testy i harness) albo null. */
  recordOf(hull) {
    return this._records.get(hull) || null;
  },

  /** Zapomina rekordy i zegar (testy, zmiana sceny). */
  reset() {
    this._records.clear();
    this._frame = 0;
    this._lastNow = NaN;
    for (let i = 0; i < MAX_CAND; i++) { this._cand[i] = null; this._candPose[i] = null; }
    const st = this.stats;
    st.arcs = st.restrikes = st.sparks = st.lights = st.scans = st.hulls = st.edges = st.frameArcs = st.maxFrameArcs = 0;
    st.frames = 0;
  },

  /**
   * Raz na klatkę renderu (z BridgeFx3D.update). opts: dt — krok klatki (0 = pauza: nic nie rośnie), zoom — px na j.
   * świata, poseOf(e) → poza renderu albo null, visibility(e) → 0..1 (maskowanie), cull — pudło kadru { x, y,
   * drawHalfW, drawHalfH } (bez niego bez cullingu), nowMs — zegar [ms] zamiast Core3D.frameNowMs() (testy).
   */
  update(entities, opts = {}) {
    const T = POWER_ARCS_TUNE;
    const st = this.stats;
    this._frame++;
    st.frames++;
    st.hulls = 0; st.edges = 0; st.frameArcs = 0;
    const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Core3D.frameNowMs();
    const now = nowMs * 0.001;
    let dt = 0;
    if (Number(opts.dt) > 0 && Number.isFinite(this._lastNow)) dt = Math.min(0.1, Math.max(0, now - this._lastNow));
    this._lastNow = now;
    if (this._frame % PRUNE_EVERY === 0) this._prune();
    if (!T.enabled || !(dt > 0) || !entities || !entities.length || !this.weaponFx) return;
    const F = this._f;
    F[0] = now;

    const zoom = Math.max(1e-6, Number(opts.zoom) || 1);
    const poseOf = typeof opts.poseOf === 'function' ? opts.poseOf : null;
    const visibility = typeof opts.visibility === 'function' ? opts.visibility : null;
    const cull = opts.cull || null;
    const cx = cull ? Number(cull.x) || 0 : 0;
    const cy = cull ? Number(cull.y) || 0 : 0;
    const hw = cull ? Math.max(1, Number(cull.drawHalfW) || 0) : 0;
    const hh = cull ? Math.max(1, Number(cull.drawHalfH) || 0) : 0;
    const diag = cull ? Math.sqrt(hw * hw + hh * hh) : 1;
    const maxHulls = Math.max(0, Math.min(MAX_CAND, T.maxHulls | 0));
    const cand = this._cand, score = this._candScore, cvis = this._candVis, cpose = this._candPose;
    let nc = 0;

    // 1. Kandydaci: okręty w PRACY z kadłubem belkowym w kadrze, kolejka po wielkości na ekranie i bliskości środka.
    for (let k = 0; k < entities.length; k++) {
      const e = entities[k];
      if (!e || e.dead || e.isWreck || e.isFragment || e.hideHexVisual === true || e.isBridgeHulk === true) continue;
      if (e.bridgeState && e.bridgeState.commandLost === true) continue;
      if (!shipPowerOn(e)) continue;
      const hull = bridgeBeamHull(e);
      if (!hull || hull.solid3D) continue;
      const body = hull.body;
      if (body.nodesReceived === false) continue;
      const cs = body.cellSize;
      if (!(cs * zoom >= T.minCellPx)) continue;
      // kadłub bez ran (przegląd po ostatniej zmianie) — bez dalszej pracy
      const rec = this._records.get(hull);
      if (rec !== undefined) {
        rec.seen = this._frame;
        if (rec.count === 0 && !woundRecordStale(rec, body)) continue;
      }
      const pose = poseOf ? poseOf(e) : null;
      const px = pose ? pose.x : entX(e);
      const py = pose ? pose.y : entY(e);
      const d = body.dims;
      const R = 0.5 * cs * Math.sqrt(d.x * d.x + d.y * d.y);
      let dist = 0;
      if (cull) {
        const ox = Math.abs(px - cx), oy = Math.abs(py - cy);
        if (ox > hw + R || oy > hh + R) continue;
        dist = Math.sqrt(ox * ox + oy * oy);
      }
      const vis = visibility ? Number(visibility(e)) : 1;
      if (!(vis > 0.05)) continue;
      const sc = (R * zoom) / (1 + dist / diag);
      // wstawienie do listy top-K (malejąco; pełna lista — ostatni wypada)
      if (maxHulls === 0 || (nc === maxHulls && sc <= score[nc - 1])) continue;
      let at = nc < maxHulls ? nc : maxHulls - 1;
      while (at > 0 && score[at - 1] < sc) {
        cand[at] = cand[at - 1]; score[at] = score[at - 1]; cvis[at] = cvis[at - 1]; cpose[at] = cpose[at - 1];
        at--;
      }
      cand[at] = e; score[at] = sc; cvis[at] = Math.min(1, vis); cpose[at] = pose;
      if (nc < maxHulls) nc++;
    }

    // 2. Łuki: przegląd brzegów po zmianie ciała, tempo z ran i świeżości, budżet klatki po kolei od pierwszych.
    let budget = Math.max(0, T.maxArcsPerFrame | 0);
    const decay = Math.exp(-dt / Math.max(0.05, T.freshTau));
    for (let q = 0; q < nc; q++) {
      const e = cand[q];
      const pose = cpose[q];
      cand[q] = null; cpose[q] = null;
      const hull = e.beamHull;
      const body = hull.body;
      let rec = this._records.get(hull);
      if (rec === undefined) { rec = createWoundRecord(hull); this._records.set(hull, rec); }
      rec.seen = this._frame;
      if (woundRecordStale(rec, body)) {
        const fresh = scanWoundEdges(hull, rec, now);
        rec.fresh = Math.min(1, rec.fresh + fresh * T.freshPerEdge);
        st.scans++;
      }
      if (rec.count === 0) { rec.acc = 0; continue; }
      st.hulls++;
      st.edges += rec.count;
      rec.fresh *= decay;
      const rate = (T.rateMin + (T.rateMax - T.rateMin) * Math.min(1, rec.count / Math.max(1, T.edgeFull)) + T.freshRate * rec.fresh) * cvis[q];
      rec.acc = Math.min(2, rec.acc + rate * dt);
      F[1] = cvis[q];
      while (rec.acc >= 1 && budget > 0) {
        rec.acc -= 1;
        if (this._emit(e, hull, rec, pose, T)) { budget--; st.frameArcs++; }
      }
    }
    if (st.frameArcs > st.maxFrameArcs) st.maxFrameArcs = st.frameArcs;
  },

  _prune() {
    this._pruneLimit = this._frame - PRUNE_EVERY;
    if (!this._pruneFn) {
      this._pruneFn = (rec, hull, map) => { if (rec.seen < this._pruneLimit) map.delete(hull); };
    }
    this._records.forEach(this._pruneFn);
  },

  /** Jeden łuk z brzegu rany rekordu (+ powtórne uderzenie, iskry, błysk); chwila i widoczność w `_f`. */
  _emit(e, hull, rec, pose, T) {
    const now = this._f[0];
    const vis = this._f[1];
    const W = this.weaponFx;
    if (!W.gpu && typeof W.ensure === 'function') W.ensure();
    const gpu = W.gpu;
    if (!gpu || !gpu.arc) return false;
    const body = hull.body;
    const s = body.nodeStore;
    const cs = body.cellSize;
    const lm = body.latticeMin;
    const count = rec.count;
    // brzeg: po świeżej ranie z pierwszeństwem nowych brzegów
    let k = Math.min(count - 1, (fxRandom.next() * count) | 0);
    if (rec.fresh > 0.15) {
      for (let t = 0; t < 6; t++) {
        const q = Math.min(count - 1, (fxRandom.next() * count) | 0);
        if (now - rec.born[rec.edges[q]] < T.freshWindow) { k = q; break; }
      }
    }
    const i = rec.edges[k];
    if (!s.active[i]) return false;   // węzeł zginął w tej klatce — brzegi poprawi następny przegląd
    // kierunek ku dziurze ± rozrzut (siatka: y w górę)
    const a = (fxRandom.next() - 0.5) * T.spread;
    const ca = Math.cos(a), sa = Math.sin(a);
    const ux = rec.dirX[k] * ca - rec.dirY[k] * sa;
    const uy = rec.dirX[k] * sa + rec.dirY[k] * ca;
    // początek: bieżąca pozycja węzła (wgniecenie) przesunięta wzdłuż brzegu
    const side = (fxRandom.next() - 0.5) * 0.6 * cs;
    const ax = s.x[i] - lm.x - uy * side;
    const ay = s.y[i] - lm.y + ux * side;
    // przeskok przez dziurę: marsz po komórkach w kierunku łuku — za martwymi komórkami żywy brzeg = koniec łuku
    const gx = s.ix[i], gy = s.iy[i];
    const dimX = rec.dimX, dimY = rec.dimY, cells = rec.cells;
    let bx = 0, by = 0, jump = false, crossed = false;
    const steps = Math.max(0, T.jumpCells | 0);
    for (let step = 1; step <= steps; step++) {
      const nx = Math.round(gx + ux * step), ny = Math.round(gy + uy * step);
      if (nx < 0 || ny < 0 || nx >= dimX || ny >= dimY) break;
      const j = cells[nx + ny * dimX];
      if (j < 0 || j === i) break;           // poza obrysem — łuk w pustkę
      if (!s.active[j]) { crossed = true; continue; }
      if (crossed) {
        const jt = (fxRandom.next() - 0.5) * 0.5 * cs;
        bx = s.x[j] - lm.x - uy * jt;
        by = s.y[j] - lm.y + ux * jt;
        jump = true;
      }
      break;
    }
    if (!jump) {
      const L = cs * (T.freeMin + fxRandom.next() * (T.freeMax - T.freeMin));
      bx = ax + ux * L;
      by = ay + uy * L;
    }
    const P = beamLatticePose(hull, pose, _pose);
    beamLatticeToWorldPosed(hull, P, ax, ay, _a);
    beamLatticeToWorldPosed(hull, P, bx, by, _b);
    const ddx = _b.x - _a.x, ddy = _b.y - _a.y;
    const L = Math.sqrt(ddx * ddx + ddy * ddy);
    if (!(L > 0.5)) return false;
    const pirate = e.isPirate === true;
    const col = pirate ? ARC_WARM : ARC_COOL;
    const g = Math.max(0, Math.min(1, vis));
    const amp = 0.14 * L + 0.05 * cs;
    const st = this.stats;
    ActiveCarrier.set(writeCarrier(e, _a.x, _a.y, true, _carrier));
    try {
      gpu.arc.begin(0, 1).at(_a.x, -_a.y).dir(ddx, -ddy).speed(L, L).life(T.lifeMin, T.lifeMax)
        .color(col[0] * g, col[1] * g, col[2] * g).x01(amp, T.widthPx).z(T.z).emit();
      st.arcs++;
      if (fxRandom.next() < T.restrike) {
        gpu.arc.begin(0, 1).at(_a.x, -_a.y).dir(ddx, -ddy).speed(L * 0.9, L).life(T.lifeMin, T.lifeMax)
          .color(col[0] * g, col[1] * g, col[2] * g).x01(amp * 1.2, T.widthPx * 0.85).z(T.z)
          .preAge(-(0.03 + 0.06 * fxRandom.next())).emit();
        st.restrikes++;
      }
      // iskry z końca łuku w stronę dziury (cząstki SPARK — 2D, stożek spłaszczony)
      const n = Math.round((2 + fxRandom.next() * 3) * T.sparks * g);
      if (n > 0 && gpu.spark) {
        const sc = pirate ? SPARK_WARM : SPARK_COOL;
        const cool = pirate ? SPARK_WARM_FADE : SPARK_COOL_FADE;
        gpu.spark.begin(POWER_ARC_SPARK_KIND, n).at(_b.x, -_b.y).dir(ddx, -ddy).cone(0.9, 0.18)
          .speed(cs * 6, cs * 22).life(0.12, 0.38).drag(1.0, 2.2).colors(sc).x01(cs * 0.6, cool[0]).x23(cool[1], 1.2)
          .z(T.z).emit();
        st.sparks += n;
      }
      // błysk w siatce świateł: chłodny, krótki, przy środku łuku (oświetla blachę wokół rany)
      const lights = Core3D && Core3D.fx ? Core3D.fx.lights : null;
      if (lights && T.light > 0 && g > 0) {
        const p = (0.9 + 0.8 * rec.fresh) * T.light * g;
        if (lights.flash(_a.x + ddx * 0.5, _a.y + ddy * 0.5, col[0] * 0.22, col[1] * 0.22, col[2] * 0.22, p, cs * 4 + L,
          0.09, 2, 0.5, T.z + 1) >= 0) st.lights++;
      }
    } finally {
      ActiveCarrier.clear();
    }
    return true;
  }
};
