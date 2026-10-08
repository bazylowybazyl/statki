/**
 * destructorBeams3D — silnik destrukcji na WĘZŁACH i BELKACH (model BeamNG).
 *
 * Różnice względem destructor3D (kratownica wokseli):
 *  - stanem węzła jest jego POZYCJA, nie „baza + deformacja + cel + zapieczenie",
 *  - odkształcenie plastyczne siedzi w długościach spoczynkowych belek, nie w węzłach,
 *  - zniszczenie to ZERWANA BELKA, nie martwa komórka — cięcie wychodzi samo,
 *  - solver to PBD (bezwarunkowo stabilny), nie jawne całkowanie sprężyn,
 *  - powłoka jest triangulowana (przekątne ścienne), więc ma sztywność na ścinanie.
 *
 * Ruch całości niesie ciało sztywne 6DoF (pozycja + kwaternion); belki odpowiadają
 * wyłącznie za deformację WZGLĘDEM kształtu spoczynkowego. Ten podział jest tańszy
 * od pełnego BeamNG (gdzie transform wynika z węzłów) i pozwala zachować sprawdzony
 * solver kontaktów z destructor3D.
 *
 * Dane węzłów i belek siedzą w magazynach SoA (body.nodeStore / body.beamStore,
 * beamStore3D); body.nodes / body.beams to widoki dla kodu spoza gorącej ścieżki.
 */

import { BEAM_TYPE, buildBeamStructure, computeStoreInertia } from './beamBody3D.js';
import { BeamNodeStore, BeamLinkStore, BeamNodeView, buildAdjacency, defineLazyViews, cachedNodeViews,
  cachedBeamViews, nodeViewAt } from './beamStore3D.js';
import { beamSolverScratch, refreshBeamMounts, prepareBeamConstraints, projectBeamConstraints,
  projectBeamConstraints2D } from './beamConstraintSolver3D.js';
import { updateBeamBounds, extendBeamBounds, beamBoundsOverlap } from './beamBounds3D.js';
import { beamConnectivityScratch, findBeamBridgesStore } from './beamConnectivity3D.js';
import { activeRegion, activateNode, activateNeighbors, markSkinDirty, resetActiveRegion } from './beamActiveRegion3D.js';

export function createBeamConfig(cellSize = 1) {
  const cs = Math.max(1e-6, Number(cellSize) || 1);
  return {
    cellSize: cs,

    // --- solver miękkiego ciała ---
    solverIterations: 3,
    nodeDamping: 0.12,          // tłumienie prędkości węzłów (na sekundę)
    plasticRate: 0.55,          // ile odkształcenia ponad próg zostaje na stałe
    maxRestDrift: 0.75,         // limit zmiany długości spoczynkowej (× oryginał)
    plasticFatigue: 1.0,       // narastanie uszkodzeń przy ponownym przekraczaniu granicy plastycznej
    breakEnabled: 1,
    globalStiffnessMul: 1.0,
    globalBreakMul: 1.0,

    // --- kolizje ---
    nodeRadius: cs * 0.55,
    collisionIterations: 2,
    // Siatka przestrzenna par ciał: bok komórki. Kadłub w paru komórkach, fregata w jednej.
    broadphaseCell: 64 * cs,
    maxContacts: 128,
    restitution: 0.05,
    friction: 0.5,
    separationPercent: 0.9,
    separationSlop: cs * 0.02,

    // Ile penetracji przechodzi w lokalny zgniot węzłów. To ta liczba decyduje,
    // czy kadłuby się odbijają, czy wzajemnie wgniatają.
    crushTransfer: 0.85,
    crushSpeedThreshold: 3.0 * cs,
    crushMassBias: 0.65,
    crushBuckling: 0.65,
    // Granica plastyczności zgniotu [j.²/s²] — 0 = dawne prawo (udział masy styku).
    // > 0: impuls zgniatania ≤ crushStrength · (front styku w węzłach) · (masa węzła
    // lżejszego ciała) / cs · dt, czyli siła rośnie z DŁUGOŚCIĄ frontu płyty 2D,
    // nie z liczbą węzłów. Dawne prawo w dużym kadłubie 2D dawało ~0,3% impulsu na
    // krok: rozpychała sama korekta pozycji, a styk trwał sekundami i zależał od siatki.
    crushStrength: 0,

    // --- broń ---
    impactRadius: 3.0 * cs,
    impactBeamBreakRadius: 1.6 * cs,
    impactPush: 0.9,

    // --- rozpady ---
    splitCheckInterval: 10,
    splitMinNodes: 4,
    detachTornJoints: true,    // przerwane usztywnienie nie staje się pojedynczą linką
    mountMinSupportRatio: 0.3,
    splitMaxPerTick: 2,
    splitMaxFragments: 20,
    // Kadłub po rozpadzie zostaje na swoich tablicach (kopiuje się tylko odłam), dopóki żywych
    // węzłów jest co najmniej tyle × pojemność; niżej magazyny się zagęszczają. Fizyka ta sama
    // przy każdej wartości (zagęszczenie zachowuje kolejność): 1 = zawsze, 0 = nigdy.
    compactBelow: 0.5,
    maxWrecks: 48,
    wreckOutwardKick: 0.5 * cs,
    wreckSpinResponse: 0.02,

    // --- ciało sztywne ---
    linearDamping: 0.02,
    angularDamping: 0.20,
    // Płaszczyzna gry (kadłuby 2D ze sprite'ów): ruch w XY, obrót tylko wokół Z,
    // węzły zostają na swoim z spoczynkowym.
    planar: false,

    // --- sen ---
    sleepFrames: 40,
    sleepMotionThreshold: 0.004 * cs,
    wakeHoldFrames: 24,

    // --- solver lokalny (beamActiveRegion3D) ---
    // Liczy tylko węzły w ruchu i ich sąsiadów zamiast całego obudzonego kadłuba —
    // pod ostrzałem rusza się kilka procent węzłów, a pełny solver liczył wszystkie.
    localSolver: false,
    // |vx|+|vy|+|vz| węzła [j./s], poniżej = spokój. 0,2·cs to ~0,05 j. na klatkę —
    // niewidoczne; niższy próg łapie drgania, które fala sprężysta roznosi po całym
    // kadłubie po każdym trafieniu (flota pod ostrzałem: 0,02·cs 4,7 ms/krok, 0,2·cs 1,4).
    // Pomiar 2026-10-07 (gra: siatka 15 j., trafienie w spoczywający kadłub; bitwa w Node, 4 ziarna): koszt
    // solvera w bitwie to ogon trafień — trafienie rusza wprost 1–2 węzły, solver liczy potem ~350 węzło-kroków
    // obszaru, w tym 20–45% to odliczanie ciszy. 0,4·cs: −43% węzło-kroków, cisza 4: −31%, razem −62% (czas
    // solvera −51%); zerwania i zabite węzły bez zmian, kształt po uspokojeniu inny o p50 0,02–0,04 j., maks.
    // ~0,6 j.; penetracja, energia i sen wraków w rozrzucie chaosu. Nastawy gry bez zmian (decyzja użytkownika).
    activeMotionThreshold: 0.2 * cs,
    activeSettleFrames: 8,              // kroki spokoju, po których węzeł wypada z obszaru

    // --- żar blachy (tylko do rysowania; fizyka go nie czyta) ---
    // Poziom zderzenia = min(1, zbliżanie / heatSpeed) · heatGain. Biało świeci BRZEG RANY —
    // końce belek zerwanych w zderzeniu (i sąsiedzi, strefa wpływu ciepła); zgniatana
    // powierzchnia dostaje tylko ułamek heatContact (pomarańcz). Podniesienie do poziomu,
    // nie suma. Znacznik w sekundach zegara `clock` systemu; zanik liczy shader.
    heatGain: 0,                        // 0 = bez żaru (demo); gra: 1
    heatSpeed: 20 * cs,                 // j./s zbliżania, przy których brzeg rany jest biały
    heatContact: 0.35,                  // żar zgniatanej powierzchni względem brzegu rany
    heatSpread: 0.55,                   // pierścień sąsiadów brzegu względem brzegu
    heatWoundWindow: 0.12,              // s — zerwania tak długo po styku liczą się do rany zderzenia
    heatDecay: 0.35                     // 1/s — ten sam zanik co w shaderze kadłuba
  };
}

/**
 * Kotwice ciała zakotwiczonego (`createBody(…, { anchored: true })`): węzły, dla których
 * `test(ox, oy, oz, i)` (pozycja SPOCZYNKOWA w układzie ciała) zwraca true, dostają invMass 0 —
 * solver, zgniot i trafienia ich nie przesuwają, a belki do nich mogą pęknąć (wyspa bez kotwicy
 * odpada jako swobodny wrak). Masa węzła zostaje (bezwładność, pęd sekcji). Zwraca liczbę kotwic.
 */
export function pinBeamNodes(body, test) {
  const s = body.nodeStore;
  let pins = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i] || !test(s.ox[i], s.oy[i], s.oz[i], i)) continue;
    s.invMass[i] = 0;
    s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0;
    pins++;
  }
  return pins;
}

// ============================ MATEMATYKA ============================

function quatToMat3(q, m) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz); m[2] = 2 * (xz + wy);
  m[3] = 2 * (xy + wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
  m[6] = 2 * (xz - wy); m[7] = 2 * (yz + wx); m[8] = 1 - 2 * (xx + yy);
  return m;
}

function matVec(m, x, y, z, o) {
  o.x = m[0] * x + m[1] * y + m[2] * z;
  o.y = m[3] * x + m[4] * y + m[5] * z;
  o.z = m[6] * x + m[7] * y + m[8] * z;
  return o;
}

function matVecT(m, x, y, z, o) {
  o.x = m[0] * x + m[3] * y + m[6] * z;
  o.y = m[1] * x + m[4] * y + m[7] * z;
  o.z = m[2] * x + m[5] * y + m[8] * z;
  return o;
}

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now() : Date.now();
}

const _ii = { x: 0, y: 0, z: 0 };
function applyInvInertia(body, vx, vy, vz, o) {
  if (body.static || body.anchored) { o.x = 0; o.y = 0; o.z = 0; return o; }
  const m = body._rot;
  matVecT(m, vx, vy, vz, _ii);
  const I = body.invInertiaLocal;
  const lx = I[0] * _ii.x + I[1] * _ii.y + I[2] * _ii.z;
  const ly = I[3] * _ii.x + I[4] * _ii.y + I[5] * _ii.z;
  const lz = I[6] * _ii.x + I[7] * _ii.y + I[8] * _ii.z;
  const scale = 1 / Math.max(1e-6, body.rammingMassMult);
  return matVec(m, lx * scale, ly * scale, lz * scale, o);
}

// Hash przestrzenny nad pozycjami węzłów. Węzły nie leżą już na regularnej
// kratownicy (deformują się), więc lookup po indeksie komórki odpada.
const HASH_BIAS = 512;
function hashKey(i, j, k) {
  return ((i + HASH_BIAS) | 0) | (((j + HASH_BIAS) | 0) << 10) | (((k + HASH_BIAS) | 0) << 20);
}

// Hasz [0, 1) indeksu węzła i soli (odrzut wybitej blachy krateru wymuszonego — bez Math.random).
function craterHash(i, salt) {
  let h = Math.imul(i ^ salt, 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Zbieranie pól sekcji do nowego magazynu (_partitionBeams): osobna pętla na typ tablicy,
// żeby każda była monomorficzna. Pomijane pola chwilowe: znaczniki (porównywane z rosnącymi
// licznikami, więc 0 ≡ stara wartość), hashNext (odbudowa co krok), crushDepth (ważny tylko
// przy bieżącym znaczniku zgniotu), beamCount (liczony od nowa).
function gatherF64(from, to, order, count) { for (let k = 0; k < count; k++) to[k] = from[order[k]]; }
function gatherI32(from, to, order, count) { for (let k = 0; k < count; k++) to[k] = from[order[k]]; }
function gatherU8(from, to, order, count) { for (let k = 0; k < count; k++) to[k] = from[order[k]]; }

function gatherNodeFields(src, dst, order, count) {
  gatherF64(src.x, dst.x, order, count); gatherF64(src.y, dst.y, order, count); gatherF64(src.z, dst.z, order, count);
  gatherF64(src.ox, dst.ox, order, count); gatherF64(src.oy, dst.oy, order, count); gatherF64(src.oz, dst.oz, order, count);
  gatherF64(src.px, dst.px, order, count); gatherF64(src.py, dst.py, order, count); gatherF64(src.pz, dst.pz, order, count);
  gatherF64(src.vx, dst.vx, order, count); gatherF64(src.vy, dst.vy, order, count); gatherF64(src.vz, dst.vz, order, count);
  gatherF64(src.mass, dst.mass, order, count); gatherF64(src.invMass, dst.invMass, order, count);
  gatherF64(src.hp, dst.hp, order, count); gatherF64(src.maxHp, dst.maxHp, order, count);
  gatherF64(src.coverage, dst.coverage, order, count);
  gatherF64(src.r, dst.r, order, count); gatherF64(src.g, dst.g, order, count); gatherF64(src.b, dst.b, order, count);
  gatherF64(src.heat, dst.heat, order, count); gatherF64(src.heatStamp, dst.heatStamp, order, count);
  gatherF64(src.temp, dst.temp, order, count);
  gatherI32(src.ix, dst.ix, order, count); gatherI32(src.iy, dst.iy, order, count); gatherI32(src.iz, dst.iz, order, count);
  gatherI32(src.depth, dst.depth, order, count); gatherI32(src.localBeamCount, dst.localBeamCount, order, count);
  gatherI32(src.platingCount, dst.platingCount, order, count); gatherI32(src.quiet, dst.quiet, order, count);
  gatherU8(src.active, dst.active, order, count); gatherU8(src.surface, dst.surface, order, count);
  gatherU8(src.act, dst.act, order, count); gatherU8(src.skinDirty, dst.skinDirty, order, count);
}

// Belki sekcji (list = indeksy w magazynie źródłowym, rosnąco); końce przez map. Zwraca liczbę żywych.
function gatherBeamFields(src, dst, list, count, map) {
  const a = dst.a, b = dst.b, sa = src.a, sb = src.b;
  for (let n = 0; n < count; n++) {
    const bi = list[n];
    a[n] = map[sa[bi]];
    b[n] = map[sb[bi]];
  }
  gatherF64(src.rest, dst.rest, list, count); gatherF64(src.restBase, dst.restBase, list, count);
  gatherF64(src.stiffness, dst.stiffness, list, count); gatherF64(src.deform, dst.deform, list, count);
  gatherF64(src.brk, dst.brk, list, count); gatherF64(src.strain, dst.strain, list, count);
  gatherF64(src.fatigue, dst.fatigue, list, count);
  gatherU8(src.type, dst.type, list, count); gatherU8(src.broken, dst.broken, list, count);
  gatherU8(src.restBridge, dst.restBridge, list, count);
  let live = 0;
  const broken = dst.broken;
  for (let n = 0; n < count; n++) if (!broken[n]) live++;
  return live;
}

// Płyta nx × ny komórek (jak kadłub 2D ze sprite'a) do rozgrzewki ścieżek rozpadu.
function warmUpLattice(nx, ny) {
  const cells = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const edge = ix === 0 || iy === 0 || ix === nx - 1 || iy === ny - 1;
      cells.push({ ix, iy, iz: 0, x: ix + 0.5, y: iy + 0.5, z: 0, surface: edge, depth: edge ? 1 : 2,
        coverage: 1, r: 0.5, g: 0.5, b: 0.5 });
    }
  }
  return { cells, nx, ny, nz: 1, cellSize: 1, origin: { x: 0, y: 0, z: 0 } };
}

// Pierwsza pozycja w rosnącej tablicy z wartością ≥ value.
function lowerBound(sorted, count, value) {
  let lo = 0, hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Siatka węzłów ciała (_refreshHash): kubełki nad AABB w komórkach cs; map = zapas dla
// ciała o zbyt dużym AABB (wtedy nx = ny = nz = 0). min / max — dokładne AABB żywych węzłów
// (układ ciała); store / version — magazyn i jego shapeVersion z chwili budowy.
function createNodeGrid() {
  return { heads: new Int32Array(0), i0: 0, j0: 0, k0: 0, nx: 0, ny: 0, nz: 0, map: null, fallback: null,
    minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
    store: null, version: -1 };
}

// Węzeł jako indeks w magazynie ciała; API przyjmuje też widok (testy, callbacki).
const nodeIndex = (node) => (typeof node === 'number' ? node : node ? node._i : -1);

let NEXT_BODY_ID = 1;

// ============================ SYSTEM ============================

export const DestructorBeams3D = {
  config: null,
  splitQueue: [],
  onDebris: null,
  // Haki gry (src/game/hullBodies.js); w demie puste.
  // (A, B) → false = para bez kolizji (właściciel, hol, wrak wyłączony); true = co krok;
  // liczba k > 1 = co k-ty krok z krokiem k · dt (wolne wraki — HULL_BODY_CONFIG.wreckPairEvery)
  pairFilter: null,
  onContact: null,        // (A, B, info) — styk pary po impulsie i zgniocie (_contactInfo, tylko do odczytu)
  onWreck: null,          // (parent, wreck) — nowy wrak z rozpadu, już w liście ciał
  onNodeDebris: null,     // (body, i, wx, wy, wz, vx, vy, vz) — ginący węzeł jako indeks, bez widoku
  clock: () => nowMs() * 0.001,   // sekundy znaczników żaru (baza czasu renderera)
  // Zasięg ostatniego krateru (applyImpact w trybie krateru): najdalszy węzeł zabity przez krater
  // od punktu trafienia [j.]; 0 = krater nikogo nie zabił (mapa ran gry: lej tylko w dziurze).
  lastCraterReach: 0,
  _tick: 0,
  _islandStamp: 1,
  _contactStamp: 1,
  _regionStamp: 1,

  perf: {
    lastUpdateMs: 0,
    lastSolverMs: 0,
    lastCollisionMs: 0,
    lastSplitMs: 0,
    contacts: 0,
    beamsBroken: 0,
    solvedBeams: 0,
    broadphasePairs: 0,
    aabbRejected: 0,
    narrowphasePairs: 0,
    hashLookups: 0,         // kubełki siatki węzłów odwiedzone przez kontakty (narastająco)
    narrowCandidates: 0     // węzły iterowanych ciał w obszarach nakładania par (narastająco)
  },

  _s1: { x: 0, y: 0, z: 0 }, _s2: { x: 0, y: 0, z: 0 }, _s3: { x: 0, y: 0, z: 0 },
  _s4: { x: 0, y: 0, z: 0 }, _s5: { x: 0, y: 0, z: 0 }, _s6: { x: 0, y: 0, z: 0 },

  init(config) {
    this.warmUp();
    this.config = config;
    this.splitQueue.length = 0;
    this._tick = 0;
    this.perf.beamsBroken = 0;
    return this;
  },

  _warmedUp: false,

  /**
   * Rozgrzewka JIT rzadkich ścieżek rozpadu — raz na proces (wołana z init). V8 kompiluje
   * funkcję dopiero po wielu przebiegach, a rozpady zdarzają się rzadko, więc pierwsze w bitwie
   * szły w interpreterze: przebudowa pancernika przy 7,5 j. 4 ms zamiast 0,1, przeniesienie
   * ruchu odłamu 1,4 ms zamiast 0,04. Mała płyta rozcinana w pętli przechodzi wszystkie
   * ścieżki (wrak, kadłub w miejscu, zagęszczenie, odprysk); potem stan systemu wraca.
   */
  warmUp(rounds = 48) {
    if (this._warmedUp) return;
    this._warmedUp = true;
    const saved = { config: this.config, splitQueue: this.splitQueue, onDebris: this.onDebris,
      pairFilter: this.pairFilter, onContact: this.onContact, onWreck: this.onWreck, onNodeDebris: this.onNodeDebris,
      tick: this._tick, perf: { ...this.perf }, nextId: NEXT_BODY_ID };
    try {
      const cfg = createBeamConfig(1);
      Object.assign(cfg, { planar: true, localSolver: true, crushStrength: 300000 });
      this.config = cfg;
      this.onDebris = null;
      this.pairFilter = null; this.onContact = null; this.onWreck = null; this.onNodeDebris = null;
      const base = buildBeamStructure(warmUpLattice(32, 10), { frameAxes: [0, 1, 0], frameToOppositeWall: true, maxFrameSpan: 10 });
      // Cięcia: na pół (kadłub w miejscu), ogon (wrak), ostatnia kolumna, róg (odprysk < splitMinNodes).
      const cuts = [16, 27, 30.5, -1];
      for (let r = 0; r < rounds; r++) {
        cfg.compactBelow = r % 4 === 3 ? 1 : 0.5;
        const body = this.createBody({ ...base, nodeStore: base.nodeStore.clone(), beamStore: base.beamStore.clone(),
          invInertia: base.invInertia.slice() }, {});
        const bodies = [body];
        const s = body.nodeStore, e = body.beamStore, cut = cuts[r % cuts.length];
        let broken = 0;
        for (let bi = 0; bi < e.count; bi++) {
          const xa = s.ox[e.a[bi]] - body.latticeMin.x, xb = s.ox[e.b[bi]] - body.latticeMin.x;
          const ya = s.oy[e.a[bi]] - body.latticeMin.y, yb = s.oy[e.b[bi]] - body.latticeMin.y;
          const split = cut < 0 ? ((xa < 2 && ya < 1) !== (xb < 2 && yb < 1)) : ((xa > cut) !== (xb > cut));
          if (split && !e.broken[bi]) { e.broken[bi] = 1; broken++; }
        }
        body.liveBeams -= broken;
        body.structureDirty = true;
        this.splitQueue = [body];
        this.processSplits(bodies);
      }
    } finally {
      this.config = saved.config;
      this.splitQueue = saved.splitQueue;
      this.onDebris = saved.onDebris;
      this.pairFilter = saved.pairFilter; this.onContact = saved.onContact;
      this.onWreck = saved.onWreck; this.onNodeDebris = saved.onNodeDebris;
      this._tick = saved.tick;
      Object.assign(this.perf, saved.perf);
      NEXT_BODY_ID = saved.nextId;
    }
  },

  createBody(structure, opts = {}) {
    const cfg = opts.config || this.config || createBeamConfig(structure.cellSize);
    const massMultiplier = Math.max(1e-6, Number(opts.massMultiplier) || 1);
    const ns = structure.nodeStore;
    if (massMultiplier !== 1) {
      for (let i = 0; i < ns.count; i++) {
        ns.mass[i] *= massMultiplier;
        ns.invMass[i] /= massMultiplier;
      }
    }
    const body = {
      id: NEXT_BODY_ID++,
      name: opts.name || `beam${NEXT_BODY_ID}`,
      pos: { x: 0, y: 0, z: 0, ...(opts.position || {}) },
      vel: { x: 0, y: 0, z: 0, ...(opts.velocity || {}) },
      quat: { x: 0, y: 0, z: 0, w: 1, ...(opts.quaternion || {}) },
      angVel: { x: 0, y: 0, z: 0, ...(opts.angularVelocity || {}) },
      mass: structure.mass * massMultiplier,
      invMass: opts.static || opts.anchored ? 0 : 1 / (structure.mass * massMultiplier),
      static: !!opts.static,
      // Zakotwiczone, ale niszczalne (świat: ściany, budowle): ciało jako całość stoi (masa ∞,
      // bez całkowania), węzły się gną, belki pękają. Kotwice = węzły z invMass 0 (pinBeamNodes);
      // wyspa bez kotwicy odpada jako swobodny wrak. `static` dalej = nieruchome I niezniszczalne.
      anchored: !!opts.anchored,
      invInertiaLocal: structure.invInertia.map(v => v / massMultiplier),
      radius: structure.radius,
      config: cfg,
      nodeStore: ns,
      beamStore: structure.beamStore,
      cellSize: structure.cellSize,
      dims: structure.dims,
      latticeMin: { ...structure.latticeMin },
      // Układ kratownicy z chwili utworzenia — skóra mapuje po nim wierzchołki
      // i mapowanie musi przeżyć recentrowanie fragmentów przy rozłamie.
      skinLatticeMin: { ...structure.latticeMin },
      skin: structure.skin || null,
      spriteSkin: structure.spriteSkin || null,
      activeNodes: ns.count,
      liveBeams: structure.beamStore.count,
      dead: false,
      isWreck: false,
      noSplit: !!opts.noSplit,
      rammingMassMult: Number(opts.rammingMassMult) || 1,
      collisionArmor: Number.isFinite(opts.collisionArmor) && opts.collisionArmor > 0 ? opts.collisionArmor : 1,
      meshDirty: true,
      structureDirty: true,
      isSleeping: false,
      sleepFrames: 0,
      wakeHold: cfg.wakeHoldFrames,
      _rot: new Float64Array(9),
      _rotTick: -1,
      _grid: createNodeGrid(),
      _hashTick: -1,
      _geomVer: 0,
      _contactCursor: 0,
      _contacts: [],
      _contactDepths: [],
      _integrity: new Int32Array(ns.count),
      _connectivity: null,
      _splitDefer: 0,
      _region: null,
      _lattice: null,
      _maxDisp: 0
    };
    // body.nodes / body.beams: widoki na żądanie; ciało z niesklonowanej konstrukcji
    // dzieli z nią gotowe widoki (te same węzły, jak dawniej te same obiekty).
    defineLazyViews(body, cachedNodeViews(structure), cachedBeamViews(structure));
    quatToMat3(body.quat, body._rot);
    updateBeamBounds(body);
    beamSolverScratch(body);
    return body;
  },

  /** Solver lokalny: węzeł trafiony, zgniatany albo przesunięty z zewnątrz musi wejść w obszar. */
  activate(body, node) {
    activateNode(body, node);
  },

  wake(body, hold = 0) {
    if (!body) return;
    body.isSleeping = false;
    body.sleepFrames = 0;
    if (hold > 0) body.wakeHold = Math.max(body.wakeHold | 0, hold | 0);
  },

  _refreshRot(body) {
    if (body._rotTick === this._tick) return body._rot;
    quatToMat3(body.quat, body._rot);
    body._rotTick = this._tick;
    return body._rot;
  },

  /**
   * Siatka węzłów ciała (układ lokalny): gęsta tablica kubełków nad AABB żywych węzłów.
   * Kubełek = indeks pierwszego węzła, dalej łańcuch `hashNext` (−1 = koniec). Dawniej Map
   * przebudowywana co krok dla każdego ciała w kontakcie — najdroższa funkcja taranu (18%
   * czasu). Ciało, którego AABB ma absurdalnie dużo kubełków (węzeł odrzucony daleko przed
   * najbliższym rozpadem), wraca na Map z kluczem hashKey. Kolejność w łańcuchu jak dawniej.
   * Siatka żyje do ZMIANY KSZTAŁTU, nie do końca kroku: kadłub, którego węzły stoją (śpiący,
   * wrak w dryfie — ruch sztywny siatki nie zmienia), nie przebudowuje jej w każdym kroku, w którym
   * jest gospodarzem pary. Zmianę zgłasza `body._hashTick = -1`: solver (ruch węzłów), zgniot,
   * trafienie, zniszczenie węzła, rozpad i przebudowa, naprawa; zapis x / y / z / active przez
   * widok węzła podbija `shapeVersion` magazynu, a nowy magazyn (zagęszczenie) to nowa siatka.
   */
  _refreshHash(body) {
    const grid = body._grid;
    const s = body.nodeStore;
    if (body._hashTick >= 0 && grid.store === s && grid.version === s.shapeVersion) return grid;
    const cs = body.cellSize;
    const x = s.x, y = s.y, z = s.z, active = s.active, next = s.hashNext;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < s.count; i++) {
      if (!active[i]) continue;
      const nx = x[i], ny = y[i], nz = z[i];
      minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
      minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
      minZ = Math.min(minZ, nz); maxZ = Math.max(maxZ, nz);
    }
    grid.minX = minX; grid.maxX = maxX;
    grid.minY = minY; grid.maxY = maxY;
    grid.minZ = minZ; grid.maxZ = maxZ;
    grid.store = s;
    grid.version = s.shapeVersion;
    body._hashTick = this._tick;
    grid.nx = grid.ny = grid.nz = 0;
    grid.map = null;
    if (minX === Infinity) return grid;
    const i0 = Math.floor(minX / cs), j0 = Math.floor(minY / cs), k0 = Math.floor(minZ / cs);
    const gx = Math.floor(maxX / cs) - i0 + 1, gy = Math.floor(maxY / cs) - j0 + 1, gz = Math.floor(maxZ / cs) - k0 + 1;
    const cells = gx * gy * gz;
    // 2^18 kubełków (1 MB) mieści pustą w środku stację 3D (kratownica 44³ ≈ 85 tys.).
    if (cells > Math.max(1 << 18, 32 * body.activeNodes)) {
      const map = grid.fallback ||= new Map();
      map.clear();
      for (let i = 0; i < s.count; i++) {
        if (!active[i]) continue;
        const key = hashKey(Math.floor(x[i] / cs), Math.floor(y[i] / cs), Math.floor(z[i] / cs));
        const head = map.get(key);
        next[i] = head === undefined ? -1 : head;
        map.set(key, i);
      }
      grid.map = map;
      return grid;
    }
    let heads = grid.heads;
    if (heads.length < cells) heads = grid.heads = new Int32Array(Math.max(cells, heads.length * 2));
    heads.fill(-1, 0, cells);
    for (let i = 0; i < s.count; i++) {
      if (!active[i]) continue;
      const c = (Math.floor(x[i] / cs) - i0) + gx * ((Math.floor(y[i] / cs) - j0) + gy * (Math.floor(z[i] / cs) - k0));
      next[i] = heads[c];
      heads[c] = i;
    }
    grid.i0 = i0; grid.j0 = j0; grid.k0 = k0;
    grid.nx = gx; grid.ny = gy; grid.nz = gz;
    return grid;
  },

  // --------------------------- CAŁKOWANIE CIAŁA SZTYWNEGO ---------------------------

  integrate(dt, bodies) {
    const cfg = this.config;
    const linK = Math.exp(-cfg.linearDamping * dt);
    const angK = Math.exp(-cfg.angularDamping * dt);
    const planar = !!cfg.planar;
    for (const b of bodies) {
      if (!b || b.dead || b.static || b.anchored) continue;
      if (planar) {
        // Odrzut odłamu (_spawnWreck) i szum numeryczny nie wyprowadzą kadłuba z płaszczyzny.
        b.vel.z = 0; b.angVel.x = 0; b.angVel.y = 0;
      }
      b.vel.x *= linK; b.vel.y *= linK; b.vel.z *= linK;
      b.angVel.x *= angK; b.angVel.y *= angK; b.angVel.z *= angK;
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
      b.pos.z += b.vel.z * dt;

      const q = b.quat;
      const wx = b.angVel.x, wy = b.angVel.y, wz = b.angVel.z;
      const hx = 0.5 * dt * (wx * q.w + wy * q.z - wz * q.y);
      const hy = 0.5 * dt * (wy * q.w + wz * q.x - wx * q.z);
      const hz = 0.5 * dt * (wz * q.w + wx * q.y - wy * q.x);
      const hw = 0.5 * dt * (-wx * q.x - wy * q.y - wz * q.z);
      q.x += hx; q.y += hy; q.z += hz; q.w += hw;
      if (planar) { q.x = 0; q.y = 0; }
      const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
      q.x /= len; q.y /= len; q.z /= len; q.w /= len;
    }
  },

  // --------------------------- SOLVER MIĘKKIEGO CIAŁA (PBD) ---------------------------

  solveSoftBody(dt, bodies) {
    const t0 = nowMs();
    const cfg = this.config;
    const iterations = Math.max(1, cfg.solverIterations | 0);
    const damp = Math.exp(-cfg.nodeDamping * dt * 60);
    const plasticRate = 1 - Math.pow(1 - Math.min(1, cfg.plasticRate), dt * 120);
    const stepScaleSq = (dt * 120) ** 2;
    const planar = !!cfg.planar;
    let solved = 0;
    let broke = 0;

    for (const body of bodies) {
      if (!body || body.dead || body.static) continue;
      if (body.isSleeping && (body.wakeHold | 0) <= 0) continue;
      if (cfg.localSolver) {
        broke += this._solveLocal(body, dt, iterations, damp, plasticRate, stepScaleSq);
        solved += this._localSolved;
        continue;
      }

      const s = body.nodeStore, count = s.count, active = s.active;
      const x = s.x, y = s.y, z = s.z, px = s.px, py = s.py, pz = s.pz;
      const vx = s.vx, vy = s.vy, vz = s.vz, ox = s.ox, oy = s.oy, oz = s.oz, mass = s.mass;
      const scratch = beamSolverScratch(body);
      if (cfg.breakEnabled) refreshBeamMounts(body, scratch, cfg);
      const positions = scratch.positions;

      // 1) predykcja pozycji z prędkości
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        scratch.active[i] = active[i] ? 1 : 0;
        if (!active[i]) continue;
        px[i] = x[i]; py[i] = y[i]; pz[i] = z[i];
        positions[j] = x[i] + vx[i] * dt;
        positions[j + 1] = y[i] + vy[i] * dt;
        positions[j + 2] = z[i] + vz[i] * dt;
        scratch.weights[i] = s.invMass[i];
      }

      // Zmierz WSZYSTKIE belki przed projekcją. Projekcja sąsiedniej belki
      // potrafiła skasować zgniot, zanim dalsza część poszycia go zobaczyła.
      const bodyBroken = prepareBeamConstraints(scratch, body.beamStore, null, 0, cfg, dt, plasticRate, stepScaleSq);
      if (scratch.deformed) body.meshDirty = true;
      if (bodyBroken) {
        broke += bodyBroken;
        body.liveBeams = Math.max(0, body.liveBeams - bodyBroken);
        body.structureDirty = true;
        body.meshDirty = true;
        if (!body.noSplit && !this.splitQueue.includes(body)) this.splitQueue.push(body);
      }

      // 2) rzutowanie ograniczeń długości belek
      solved += projectBeamConstraints(scratch, scratch.count, iterations);

      // 3) prędkości z przesunięcia pozycji + tłumienie
      const invDt = 1 / dt;
      let motion = 0;
      for (let i = 0; i < count; i++) {
        if (!active[i]) continue;
        const j = i * 3;
        x[i] = positions[j]; y[i] = positions[j + 1]; z[i] = planar ? oz[i] : positions[j + 2];
        vx[i] = (x[i] - px[i]) * invDt * damp;
        vy[i] = (y[i] - py[i]) * invDt * damp;
        vz[i] = (z[i] - pz[i]) * invDt * damp;
        const m = Math.abs(vx[i]) + Math.abs(vy[i]) + Math.abs(vz[i]);
        if (m > motion) motion = m;
      }

      // 4) Przenieś wspólny ruch węzłów na ciało, zachowując pozycje świata.
      // Samo odjęcie średniej cofało zgniot i teleportowało oderwane sekcje.
      // Ciało zakotwiczone stoi: ruch węzłów zostaje w węzłach, trzymają go kotwice.
      let mx = 0, my = 0, mz = 0, msum = 0;
      let mvx = 0, mvy = 0, mvz = 0;
      for (let i = 0; i < count; i++) {
        if (!active[i]) continue;
        mx += (x[i] - ox[i]) * mass[i];
        my += (y[i] - oy[i]) * mass[i];
        mz += (z[i] - oz[i]) * mass[i];
        mvx += vx[i] * mass[i]; mvy += vy[i] * mass[i]; mvz += vz[i] * mass[i];
        msum += mass[i];
      }
      if (msum > 0 && !body.anchored) {
        mx /= msum; my /= msum; mz /= msum;
        mvx /= msum; mvy /= msum; mvz /= msum;
        const shift = matVec(this._refreshRot(body), mx, my, mz, this._s1);
        body.pos.x += shift.x; body.pos.y += shift.y; body.pos.z += shift.z;
        const velocity = matVec(body._rot, mvx, mvy, mvz, this._s2);
        body.vel.x += velocity.x; body.vel.y += velocity.y; body.vel.z += velocity.z;
        const drift = Math.abs(mx) + Math.abs(my) + Math.abs(mz);
        if (drift > 1e-9) {
          for (let i = 0; i < count; i++) {
            if (!active[i]) continue;
            x[i] -= mx; y[i] -= my; z[i] -= mz;
          }
        }
        for (let i = 0; i < count; i++) {
          if (!active[i]) continue;
          vx[i] -= mvx; vy[i] -= mvy; vz[i] -= mvz;
        }
      }
      this._updateRadius(body);
      body._hashTick = -1;

      if (motion > cfg.sleepMotionThreshold) {
        body.meshDirty = true;
        body.sleepFrames = 0;
        body.isSleeping = false;
      } else if ((body.wakeHold | 0) > 0) {
        body.wakeHold--;
      } else {
        body.sleepFrames++;
        if (body.sleepFrames >= cfg.sleepFrames) body.isSleeping = true;
      }
    }

    if (broke > 0) {
      this.perf.beamsBroken += broke;
    }
    this.perf.solvedBeams = solved;
    this.perf.lastSolverMs = nowMs() - t0;
  },

  /**
   * Solver lokalny: PBD tylko na aktywnych węzłach (A), ich sąsiadach (F, też ruchomych,
   * żeby wgniecenie mogło się rozlać) i belkach tych węzłów. Końce belek poza A ∪ F
   * (pierścień O) stoją w miejscu jak reszta kadłuba. Reakcja pierścienia (−J) przechodzi
   * na ciało sztywne, więc pęd lokalnego ruchu — kopnięcie rakiety, zgniot — nie ginie.
   * Zwraca liczbę belek zerwanych w tym kroku.
   */
  _solveLocal(body, dt, iterations, damp, plasticRate, stepScaleSq) {
    this._localSolved = 0;
    const cfg = this.config;
    const region = activeRegion(body);
    const list = region.list;
    if (list.length === 0) {
      body.isSleeping = true;
      body.wakeHold = 0;
      return 0;
    }
    body.isSleeping = false;
    const s = body.nodeStore, e = body.beamStore;
    const x = s.x, y = s.y, z = s.z, px = s.px, py = s.py, pz = s.pz;
    const vx = s.vx, vy = s.vy, vz = s.vz, ox = s.ox, oy = s.oy, oz = s.oz;
    const mass = s.mass, invMass = s.invMass, active = s.active;
    const act = s.act, quiet = s.quiet, skinDirty = s.skinDirty;
    const solveStamp = s.solveStamp, outerStamp = s.outerStamp;
    const adjStart = s.adjStart, adj = s.adj;
    const ea = e.a, eb = e.b, broken = e.broken, beamStamp = e.stamp;
    const scratch = beamSolverScratch(body);
    const P = scratch.positions, W = scratch.weights, solverActive = scratch.active;
    let stamp = (this._regionStamp + 1) | 0;
    if (stamp <= 0) stamp = 1;
    this._regionStamp = stamp;
    const planar = !!cfg.planar;

    // Kroki 1–3 w trzech przebiegach zamiast pięciu (te same zbiory, ta sama kolejność belek, wynik bit
    // w bit): belki węzłów A wychodzą już przy szukaniu F (drugi koniec belki A zawsze jest w A ∪ F,
    // więc nie trafia do pierścienia), predykcja węzła — przy dopisaniu go do obszaru. Drugi koniec
    // belki: a ^ b ^ i (bez rozgałęzienia, które przy losowej kolejności końców chybiało co drugi raz).
    // `flat`: wszystkie węzły kroku mają to samo z predykcji — w płaszczyźnie gry (z = 0) belki liczą się
    // w 2D (dz ≡ 0, ta sama arytmetyka bez zer; z węzłów i tak wraca z oz).
    const solve = region.solve;
    let sCount = 0;
    let flat = planar, z0 = NaN;
    for (let r = 0; r < list.length; r++) {
      const i = list[r];
      if (!active[i] || solveStamp[i] === stamp) continue;
      solveStamp[i] = stamp;
      solve[sCount++] = i;
      const j = i * 3;
      px[i] = x[i]; py[i] = y[i]; pz[i] = z[i];
      P[j] = x[i] + vx[i] * dt;
      P[j + 1] = y[i] + vy[i] * dt;
      const pzj = P[j + 2] = z[i] + vz[i] * dt;
      if (sCount === 1) z0 = pzj; else if (pzj !== z0) flat = false;
      W[i] = invMass[i];
      solverActive[i] = 1;
    }
    const aCount = sCount;

    // 1) F (sąsiedzi A przez całe belki) i 2a) belki węzłów A.
    const constraints = region.constraints;
    let cCount = 0;
    for (let k = 0; k < aCount; k++) {
      const i = solve[k];
      for (let q = adjStart[i], q1 = adjStart[i + 1]; q < q1; q++) {
        const bi = adj[q];
        if (broken[bi]) continue;
        const o = ea[bi] ^ eb[bi] ^ i;
        const live = active[o];
        if (beamStamp[bi] !== stamp) {
          beamStamp[bi] = stamp;
          if (live) constraints[cCount++] = bi;
        }
        if (!live || solveStamp[o] === stamp) continue;
        solveStamp[o] = stamp;
        solve[sCount++] = o;
        const j = o * 3;
        px[o] = x[o]; py[o] = y[o]; pz[o] = z[o];
        P[j] = x[o] + vx[o] * dt;
        P[j + 1] = y[o] + vy[o] * dt;
        if ((P[j + 2] = z[o] + vz[o] * dt) !== z0) flat = false;
        W[o] = invMass[o];
        solverActive[o] = 1;
      }
    }

    // Sąsiad z poprzedniego kroku, który wypadł z obliczeń, zamraża resztkowe napięcie
    // belek do nieliczonych węzłów. Po powrocie do obszaru to napięcie strzelało skokiem
    // prędkości i znów budziło okolicę (obszar nigdy nie zasypiał). Jego stan to stan
    // równowagi — przyjmujemy go jako spoczynkowy.
    for (let k = 0; k < region.frontierCount; k++) {
      const i = region.frontier[k];
      if (!active[i] || solveStamp[i] === stamp) continue;
      this._bakeRest(body, i, stamp);
    }

    // 2b) Belki węzłów F i pierścień O (drugi koniec poza A ∪ F — nieruchomy, waga 0).
    const outer = region.outer;
    let oCount = 0;
    for (let k = aCount; k < sCount; k++) {
      const i = solve[k];
      for (let q = adjStart[i], q1 = adjStart[i + 1]; q < q1; q++) {
        const bi = adj[q];
        if (broken[bi] || beamStamp[bi] === stamp) continue;
        beamStamp[bi] = stamp;
        const o = ea[bi] ^ eb[bi] ^ i;
        if (!active[o]) continue;
        constraints[cCount++] = bi;
        if (solveStamp[o] !== stamp && outerStamp[o] !== stamp) {
          outerStamp[o] = stamp;
          outer[oCount++] = o;
          const j = o * 3;
          P[j] = x[o]; P[j + 1] = y[o];
          if ((P[j + 2] = z[o]) !== z0) flat = false;
          W[o] = 0;
          solverActive[o] = 1;
        }
      }
    }
    region.constraintCount = cCount;
    // Mocowania wręgów i grodzi tylko dla węzłów kroku i tylko po zmianie struktury —
    // pełne refreshBeamMounts przeliczało wszystkie belki kadłuba po każdym zerwaniu.
    // Zerwanie i śmierć węzła aktywują dotknięte węzły, więc trafiają do tego obszaru.
    if (cfg.breakEnabled && (region.mountLive !== body.liveBeams || region.mountActive !== body.activeNodes)) {
      this._refreshMountsLocal(body, scratch, solve, sCount);
      this._refreshMountsLocal(body, scratch, outer, oCount);
      region.mountLive = body.liveBeams;
      region.mountActive = body.activeNodes;
    }

    // 4) Odkształcenie i zerwania mierzone na belkach kroku, potem rzutowanie.
    const brokenNow = prepareBeamConstraints(scratch, e, constraints, cCount, cfg, dt, plasticRate, stepScaleSq, flat);
    if (scratch.deformed) {
      body.meshDirty = true;
      // Plastyczność zmienia cieniowanie także węzłów pierścienia (ich belki do obszaru).
      for (let k = 0; k < oCount; k++) markSkinDirty(body, outer[k]);
    }
    if (brokenNow) {
      body.liveBeams = Math.max(0, body.liveBeams - brokenNow);
      body.structureDirty = true;
      body.meshDirty = true;
      if (!body.noSplit && !this.splitQueue.includes(body)) this.splitQueue.push(body);
      // Brzeg rany zderzenia: belki zerwane tuż po styku rozżarzają oba końce do poziomu zderzenia.
      const woundNow = body._woundHeat > 0 ? this.clock() : 0;
      const wound = woundNow > 0 && woundNow - body._woundHeatAt <= cfg.heatWoundWindow ? body._woundHeat : 0;
      // Koniec zerwanej belki na pierścieniu traci oparcie — też rusza.
      for (let c = 0; c < cCount; c++) {
        const bi = constraints[c];
        if (!broken[bi]) continue;
        activateNode(body, ea[bi]);
        activateNode(body, eb[bi]);
        if (wound > 0.02) {
          this._heatWound(body, ea[bi], wound, woundNow);
          this._heatWound(body, eb[bi], wound, woundNow);
        }
      }
    }
    this._localSolved = flat ? projectBeamConstraints2D(scratch, scratch.count, iterations)
      : projectBeamConstraints(scratch, scratch.count, iterations);

    // 5) Zapis A ∪ F, impuls więzów J (reakcja pierścienia = −J), aktywność; od razu lista F
    // na następny krok (stan `act` węzła jest już ostateczny po jego własnym zapisie).
    const invDt = 1 / dt;
    const threshold = cfg.activeMotionThreshold;
    const mm = body._boundsMinMax;
    const keep = 1 - damp;
    const dirty = region.dirty, frontier = region.frontier;
    let jx = 0, jy = 0, jz = 0;       // impuls więzów na A ∪ F
    let qx = 0, qy = 0, qz = 0;       // pęd uspokojonych węzłów oddawany ciału
    let drift = 0, maxDisp = body._maxDisp, fCount = 0;
    for (let k = 0; k < sCount; k++) {
      const i = solve[k], j = i * 3;
      const ozi = oz[i];
      const nx = P[j], ny = P[j + 1], nz = planar ? ozi : P[j + 2];
      const pxi = px[i], pyi = py[i], pzi = pz[i];
      const wx = (nx - pxi) * invDt, wy = (ny - pyi) * invDt, wz = (nz - pzi) * invDt;
      const m = mass[i];
      jx += m * (wx - vx[i]); jy += m * (wy - vy[i]); jz += m * (wz - vz[i]);
      // Tłumienie to tarcie wewnętrzne: pęd, który zabiera węzłom, przejmuje kadłub.
      // Pełny solver ma prędkości węzłów o zerowej średniej, więc tam tłumienie pędu nie
      // zmienia; tu bez tego samo wgniecenie (pchnięcie pozycji) rozpędzało statek.
      const lost = m * keep;
      qx += lost * wx; qy += lost * wy; qz += lost * wz;
      drift += m * (Math.abs(nx - pxi) + Math.abs(ny - pyi) + Math.abs(nz - pzi));
      x[i] = nx; y[i] = ny; z[i] = nz;
      const nvx = wx * damp, nvy = wy * damp, nvz = wz * damp;
      if (!skinDirty[i]) { skinDirty[i] = 1; dirty[region.dirtyCount++] = i; }
      // W płaszczyźnie nz = oz: składowa z to +0, Math.max bez niej daje to samo.
      const disp = planar ? Math.max(Math.abs(nx - ox[i]), Math.abs(ny - oy[i]))
        : Math.max(Math.abs(nx - ox[i]), Math.abs(ny - oy[i]), Math.abs(nz - ozi));
      if (disp > maxDisp) maxDisp = disp;
      // Obrys tylko rośnie (extendBeamBounds); dokładny wraca przy wyrównaniu środka.
      if (nx < mm[0] || nx > mm[3] || ny < mm[1] || ny > mm[4] || nz < mm[2] || nz > mm[5] ||
          nx * nx + ny * ny + nz * nz > body._boundsR2) extendBeamBounds(body, nx, ny, nz);
      if (Math.abs(nvx) + Math.abs(nvy) + Math.abs(nvz) > threshold) {
        // activateNode wprost (węzeł żywy, skóra już oznaczona, ciało nie śpi).
        vx[i] = nvx; vy[i] = nvy; vz[i] = nvz;
        quiet[i] = 0;
        if (!act[i]) { act[i] = 1; list.push(i); }
      } else if (act[i]) {
        vx[i] = nvx; vy[i] = nvy; vz[i] = nvz;
        quiet[i]++;
      } else {
        // Sąsiad, który się nie rozpędził: węzły poza obszarem spoczywają w układzie ciała.
        qx += m * nvx; qy += m * nvy; qz += m * nvz;
        vx[i] = 0; vy[i] = 0; vz[i] = 0;
        frontier[fCount++] = i;
      }
    }
    body._maxDisp = maxDisp;
    region.frontierCount = fCount;

    // 6) Wyrzuć z obszaru węzły martwe i uspokojone (ich resztkowy pęd → ciało).
    const settle = Math.max(1, cfg.activeSettleFrames | 0);
    let write = 0;
    for (let r = 0; r < list.length; r++) {
      const i = list[r];
      if (!active[i] || !act[i]) { act[i] = 0; continue; }
      if (quiet[i] >= settle) {
        const m = mass[i];
        qx += m * vx[i]; qy += m * vy[i]; qz += m * vz[i];
        vx[i] = 0; vy[i] = 0; vz[i] = 0;
        act[i] = 0; quiet[i] = 0;
        // Jak wyżej: belki do węzłów, których nikt już nie liczy, przyjmują obecną długość.
        this._bakeRest(body, i, -1);
        continue;
      }
      list[write++] = i;
    }
    list.length = write;

    // 7) Pęd do ciała sztywnego: reakcja pierścienia i pęd uspokojonych węzłów.
    // Ciało zakotwiczone go nie przyjmuje (masa ∞ — reakcję bierze świat przez kotwice).
    const M = body.mass;
    if (M > 0 && !body.anchored) {
      const w = matVec(this._refreshRot(body), (qx - jx) / M, (qy - jy) / M, (qz - jz) / M, this._s2);
      body.vel.x += w.x; body.vel.y += w.y;
      if (!planar) body.vel.z += w.z;
    }
    region.drift += drift;
    // Środek masy wyrównujemy leniwie (O(N)): po uspokojeniu albo gdy lokalny ruch
    // przesunął już sporo masy — nie w każdym kroku jak pełny solver.
    if (write === 0 || region.drift > 0.25 * body.cellSize * M) this._recentre(body);
    body._hashTick = -1;
    body.meshDirty = true;
    if (write === 0) { body.isSleeping = true; body.wakeHold = 0; }
    return brokenNow;
  },

  // Długość spoczynkowa belek węzła do węzłów spoza obliczeń (nieaktywnych, spoza
  // bieżącego A ∪ F) = długość obecna, w granicach dryfu plastycznego.
  _bakeRest(body, i, stamp) {
    const s = body.nodeStore, e = body.beamStore, drift = this.config.maxRestDrift;
    const x = s.x, y = s.y, z = s.z, active = s.active, act = s.act, solveStamp = s.solveStamp;
    const ea = e.a, eb = e.b, broken = e.broken, rest = e.rest, restBase = e.restBase, adj = s.adj;
    for (let q = s.adjStart[i]; q < s.adjStart[i + 1]; q++) {
      const bi = adj[q];
      if (broken[bi]) continue;
      const m = ea[bi] === i ? eb[bi] : ea[bi];
      if (!active[m] || act[m] || solveStamp[m] === stamp) continue;
      const len = Math.sqrt((x[m] - x[i]) ** 2 + (y[m] - y[i]) ** 2 + (z[m] - z[i]) ** 2);
      const next = Math.max(restBase[bi] * (1 - drift), Math.min(restBase[bi] * (1 + drift), len));
      if (next === rest[bi]) continue;
      rest[bi] = next;
      // Cieniowanie skóry czyta trwałe odkształcenie belek obu końców.
      markSkinDirty(body, i);
      markSkinDirty(body, m);
    }
  },

  // Ta sama reguła co refreshBeamMounts (beamConstraintSolver3D), ale tylko dla podanych węzłów.
  _refreshMountsLocal(body, scratch, indices, count) {
    const s = body.nodeStore, e = body.beamStore, failed = scratch.mountFailed;
    const active = s.active, base = s.localBeamCount, adjStart = s.adjStart, adj = s.adj;
    const ea = e.a, eb = e.b, broken = e.broken, type = e.type;
    const ratio = this.config.mountMinSupportRatio ?? 0.3;
    for (let k = 0; k < count; k++) {
      const i = indices[k];
      if (base[i] < 4) { failed[i] = 0; continue; }
      let support = 0;
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
        const bi = adj[q];
        if (!broken[bi] && type[bi] < 2 && active[ea[bi]] && active[eb[bi]]) support++;
      }
      failed[i] = support < base[i] * ratio ? 1 : 0;
    }
  },

  // Przenosi średnie przemieszczenie węzłów na pozycję ciała (jak krok 4 pełnego solvera).
  _recentre(body) {
    const s = body.nodeStore, count = s.count, active = s.active;
    const x = s.x, y = s.y, z = s.z, ox = s.ox, oy = s.oy, oz = s.oz, mass = s.mass;
    let mx = 0, my = 0, mz = 0, msum = 0;
    for (let i = 0; i < count; i++) {
      if (!active[i]) continue;
      mx += (x[i] - ox[i]) * mass[i];
      my += (y[i] - oy[i]) * mass[i];
      mz += (z[i] - oz[i]) * mass[i];
      msum += mass[i];
    }
    if (body._region) body._region.drift = 0;
    // Zakotwiczone: układ ciała stoi z kotwicami (węzły z invMass 0 trzymają pozycje lokalne).
    if (msum > 0 && !body.anchored) {
      mx /= msum; my /= msum; mz /= msum;
      if (Math.abs(mx) + Math.abs(my) + Math.abs(mz) > 1e-9) {
        // Wszystkie węzły przesuwają się w układzie ciała — skóra całego kadłuba do przepisania.
        if (body._region) body._region.dirtyAll = true;
        const shift = matVec(this._refreshRot(body), mx, my, mz, this._s1);
        body.pos.x += shift.x; body.pos.y += shift.y; body.pos.z += shift.z;
        for (let i = 0; i < count; i++) {
          if (!active[i]) continue;
          x[i] -= mx; y[i] -= my; z[i] -= mz;
        }
      }
    }
    // Dokładne maksimum przemieszczenia (okno wyszukiwania trafień).
    let maxDisp = 0;
    for (let i = 0; i < count; i++) {
      if (!active[i]) continue;
      const disp = Math.max(Math.abs(x[i] - ox[i]), Math.abs(y[i] - oy[i]), Math.abs(z[i] - oz[i]));
      if (disp > maxDisp) maxDisp = disp;
    }
    body._maxDisp = maxDisp;
    this._updateRadius(body);
  },

  _updateRadius(body) {
    updateBeamBounds(body);
  },

  // --------------------------- PĘTLA ---------------------------

  update(dt, bodies) {
    const t0 = nowMs();
    this._tick++;
    this.perf.contacts = 0;
    this.perf.broadphasePairs = this.perf.aabbRejected = this.perf.narrowphasePairs = 0;
    const cfg = this.config;

    for (const b of bodies) if (b && !b.dead) this._refreshRot(b);
    // Kontakt jest ostatnim ograniczeniem pozycji. Solver belek nie może
    // na końcu kroku wciągnąć właśnie odgiętego dziobu z powrotem w przeszkodę.
    this.solveSoftBody(dt, bodies);

    const tCol = nowMs();
    const pairCount = this._broadphase(bodies, dt);
    const pairs = this._bpPairs, stride = this._bpStride;
    const iters = Math.max(1, cfg.collisionIterations | 0);
    // Para bez kontaktu, której ciała od tamtej iteracji się nie ruszyły (_geomVer: rozdzielenie,
    // zgniot, utrata węzła), w następnej znów nic nie znajdzie — skan pomijamy, wynik ten sam.
    let quietA = this._bpQuietA, quietB = this._bpQuietB;
    if (quietA.length < pairCount) {
      quietA = this._bpQuietA = new Int32Array(Math.max(pairCount, quietA.length * 2));
      quietB = this._bpQuietB = new Int32Array(quietA.length);
    }
    for (let it = 0; it < iters; it++) {
      for (let p = 0; p < pairCount; p++) {
        const key = pairs[p];
        const A = bodies[Math.floor(key / stride)];
        const B = bodies[key % stride];
        if (it === 0) quietA[p] = -1;
        if (!A || A.dead || A.activeNodes <= 0) continue;
        if (!B || B.dead || B.activeNodes <= 0) continue;
        if ((A.static || A.anchored) && (B.static || B.anchored)) continue;
        if (it > 0 && quietA[p] === A._geomVer && quietB[p] === B._geomVer) continue;
        let pairDt = dt;
        if (this.pairFilter !== null) {
          const filter = this.pairFilter(A, B);
          if (!filter) continue;
          // Liczba k > 1 z haka: para liczona co k-ty krok (faza z id ciał rozkłada pary na kroki),
          // z krokiem k · dt — zgniot, granica plastyczności i rozdzielenie za cały odstęp.
          if (filter !== true && filter > 1) {
            const every = filter | 0;
            if ((this._tick + A.id + B.id) % every !== 0) continue;
            pairDt = dt * every;
          }
        }
        this.perf.broadphasePairs++;

        const dx = A.pos.x - B.pos.x;
        const dy = A.pos.y - B.pos.y;
        const dz = A.pos.z - B.pos.z;
        const relVx = A.vel.x - B.vel.x;
        const relVy = A.vel.y - B.vel.y;
        const relVz = A.vel.z - B.vel.z;
        const relSpeed = Math.sqrt(relVx * relVx + relVy * relVy + relVz * relVz);
        const margin = relSpeed * pairDt * 2 + cfg.cellSize * 2;
        const rs = A.radius + B.radius + margin;
        if (dx * dx + dy * dy + dz * dz > rs * rs) continue;
        const padding = (A.cellSize + B.cellSize) * (cfg.nodeRadius / cfg.cellSize);
        if (!beamBoundsOverlap(A, B, padding, this._tick)) { this.perf.aabbRejected++; continue; }

        this.perf.narrowphasePairs++;
        if (this.collideBodies(A, B, pairDt, it === 0) === 0) { quietA[p] = A._geomVer; quietB[p] = B._geomVer; }
        else quietA[p] = -1;
      }
    }
    const tAfterCol = nowMs();

    const tAfterSolve = nowMs();
    if (this._tick % Math.max(1, cfg.splitCheckInterval | 0) === 0 && this.splitQueue.length > 0) {
      this.processSplits(bodies);
    }

    this.perf.lastCollisionMs = tAfterCol - tCol;
    this.perf.lastSplitMs = nowMs() - tAfterSolve;
    this.perf.lastUpdateMs = nowMs() - t0;
  },

  // --------------------------- SIATKA PAR CIAŁ ---------------------------

  _bpHead: new Int32Array(4096),
  _bpNext: new Int32Array(1024),
  _bpBody: new Int32Array(1024),
  _bpRange: new Int32Array(64 * 6),
  _bpBig: new Uint8Array(64),
  _bpSeen: new Int32Array(64),
  _bpSeenValue: 0,
  _bpPairs: new Float64Array(256),
  _bpStride: 1,
  _bpCount: 0,
  // Pary bez kontaktu w bieżącym kroku: _geomVer obu ciał z chwili skanu (−1 = liczyć).
  _bpQuietA: new Int32Array(256),
  _bpQuietB: new Int32Array(256),

  /**
   * Kandydaci na pary ciał z siatki przestrzennej (zamiast każdy z każdym). Ciało trafia
   * do komórek swojej sfery powiększonej o drogę w kroku i 3 komórki kratownicy — każda
   * para, która przejdzie test sfer w pętli kolizji, dzieli komórkę. Ciało szersze niż
   * 64 komórki (stacja przy drobnym boku siatki) sprawdzamy ze wszystkimi. Pary wychodzą
   * posortowane po (i, j), czyli w kolejności dawnej podwójnej pętli — wynik bit w bit.
   * Zwraca liczbę par w this._bpPairs (klucz i · stride + j).
   */
  _broadphase(bodies, dt) {
    const cfg = this.config;
    const count = bodies.length;
    const stride = this._bpStride = Math.max(1, count);
    if (this._bpRange.length < count * 6) {
      const size = Math.max(count, this._bpBig.length * 2);
      this._bpRange = new Int32Array(size * 6);
      this._bpBig = new Uint8Array(size);
      this._bpSeen = new Int32Array(size);
      this._bpSeenValue = 0;
    }
    const range = this._bpRange, big = this._bpBig, seen = this._bpSeen, head = this._bpHead;
    const mask = head.length - 1;
    const cell = cfg.broadphaseCell > 0 ? cfg.broadphaseCell : 64 * cfg.cellSize;
    const inv = 1 / cell, planar = !!cfg.planar;
    head.fill(-1);
    big.fill(0, 0, count);
    let entries = 0, bigCount = 0;

    for (let i = 0; i < count; i++) {
      const b = bodies[i], o = i * 6;
      range[o] = 1; range[o + 1] = 0;          // pusty zakres: ciało poza siatką
      if (!b || b.dead || b.activeNodes <= 0) continue;
      const speed = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vel.z * b.vel.z);
      const r = b.radius + speed * dt * 2 + cfg.cellSize * 3;
      const x0 = Math.floor((b.pos.x - r) * inv), x1 = Math.floor((b.pos.x + r) * inv);
      const y0 = Math.floor((b.pos.y - r) * inv), y1 = Math.floor((b.pos.y + r) * inv);
      const z0 = planar ? 0 : Math.floor((b.pos.z - r) * inv), z1 = planar ? 0 : Math.floor((b.pos.z + r) * inv);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 64) { big[i] = 1; bigCount++; continue; }
      range[o] = x0; range[o + 1] = x1; range[o + 2] = y0; range[o + 3] = y1; range[o + 4] = z0; range[o + 5] = z1;
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (entries === this._bpNext.length) {
          const next = new Int32Array(entries * 2), owner = new Int32Array(entries * 2);
          next.set(this._bpNext); owner.set(this._bpBody);
          this._bpNext = next; this._bpBody = owner;
        }
        const bucket = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
        this._bpBody[entries] = i;
        this._bpNext[entries] = head[bucket];
        head[bucket] = entries++;
      }
    }

    const next = this._bpNext, owner = this._bpBody;
    this._bpCount = 0;
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      if (range[o] > range[o + 1]) continue;
      let mark = (this._bpSeenValue + 1) | 0;
      if (mark <= 0) { seen.fill(0); mark = 1; }
      this._bpSeenValue = mark;
      const A = bodies[i];
      for (let z = range[o + 4]; z <= range[o + 5]; z++) for (let y = range[o + 2]; y <= range[o + 3]; y++) for (let x = range[o]; x <= range[o + 1]; x++) {
        const bucket = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
        for (let en = head[bucket]; en >= 0; en = next[en]) {
          const j = owner[en];
          if (j <= i || seen[j] === mark) continue;
          seen[j] = mark;
          const Bj = bodies[j];
          if ((A.static || A.anchored) && (Bj.static || Bj.anchored)) continue;
          this._bpPush(i * stride + j);
        }
      }
    }
    if (bigCount > 0) {
      for (let i = 0; i < count; i++) {
        if (!big[i]) continue;
        const A = bodies[i];
        for (let j = 0; j < count; j++) {
          if (j === i || (big[j] && j < i)) continue;
          const B = bodies[j];
          if (!B || B.dead || B.activeNodes <= 0 || ((A.static || A.anchored) && (B.static || B.anchored))) continue;
          this._bpPush(i < j ? i * stride + j : j * stride + i);
        }
      }
    }
    const pairs = this._bpCount;
    if (pairs > 1) this._bpPairs.subarray(0, pairs).sort();
    return pairs;
  },

  _bpPush(key) {
    if (this._bpCount === this._bpPairs.length) {
      const grown = new Float64Array(this._bpCount * 2);
      grown.set(this._bpPairs);
      this._bpPairs = grown;
    }
    this._bpPairs[this._bpCount++] = key;
  },

  // --------------------------- KOLIZJE ---------------------------

  /**
   * Styk pary: węzły ciała o mniejszej liczbie żywych węzłów (iterowanego) szukają najbliższego
   * węzła drugiego (gospodarza) w jego siatce. Zwraca liczbę kontaktów (0 = para bez styku).
   * Skan idzie tylko po KANDYDATACH (_contactCandidates) — węzłach, które mogą przejść testy sfery
   * zasięgu i pudła gospodarza; reszta odpadłaby na nich, więc kontakty, ich kolejność i kursor
   * skanu są te same co przy przeglądzie wszystkich węzłów (dawniej 76–97% par w bitwie przeglądało
   * cały kadłub bez jednego styku — dwa supercapitale burta w burtę: 2,1 tys. węzłów na parę).
   */
  collideBodies(A, B, dt, doDamage) {
    const cfg = this.config;
    const planar = !!cfg.planar;
    // Iterujemy po węzłach ciała o mniejszej powierzchni, szukając w hashu drugiego.
    let iter = A, holder = B;
    if (A.activeNodes > B.activeNodes) { iter = B; holder = A; }

    const mI = this._refreshRot(iter);
    const mH = this._refreshRot(holder);
    const grid = this._refreshHash(holder);
    const gHeads = grid.heads, gMap = grid.map;
    const gi0 = grid.i0, gj0 = grid.j0, gk0 = grid.k0, gnx = grid.nx, gny = grid.ny, gnz = grid.nz;
    let lookups = 0;
    const cs = holder.cellSize;
    const contactDist = (A.cellSize + B.cellSize) * (cfg.nodeRadius / cfg.cellSize);
    const contactDistSq = contactDist * contactDist;
    const reach = holder.radius + cs * 2;
    const reachSq = reach * reach;
    // Pudło gospodarza w jego układzie: AABB żywych węzłów ± contactDist.
    const bx0 = grid.minX - contactDist, bx1 = grid.maxX + contactDist;
    const by0 = grid.minY - contactDist, by1 = grid.maxY + contactDist;
    const bz0 = grid.minZ - contactDist, bz1 = grid.maxZ + contactDist;

    const swapped = iter !== A;
    const is = iter.nodeStore, hs = holder.nodeStore;
    const ix = is.x, iy = is.y, iz = is.z, iActive = is.active;
    const hx = hs.x, hy = hs.y, hz = hs.z, hNext = hs.hashNext;
    const sa = A.nodeStore, sb = B.nodeStore;
    // Ruch sztywny obu ciał jest stały w całym skanie (to samo działanie co matVec / matVecT).
    const i00 = mI[0], i01 = mI[1], i02 = mI[2], i10 = mI[3], i11 = mI[4], i12 = mI[5], i20 = mI[6], i21 = mI[7], i22 = mI[8];
    const h00 = mH[0], h01 = mH[1], h02 = mH[2], h10 = mH[3], h11 = mH[4], h12 = mH[5], h20 = mH[6], h21 = mH[7], h22 = mH[8];
    const pIx = iter.pos.x, pIy = iter.pos.y, pIz = iter.pos.z;
    const pHx = holder.pos.x, pHy = holder.pos.y, pHz = holder.pos.z;

    let count = 0;
    let hitX = 0, hitY = 0, hitZ = 0;
    let nX = 0, nY = 0, nZ = 0;
    let penetration = 0;
    let contactMassA = 0, contactMassB = 0;
    const massStamp = this._nextContactStamp();
    const contactsA = A._contacts;
    const contactsB = B._contacts;
    const depths = A._contactDepths;
    const maxContacts = Math.max(8, cfg.maxContacts | 0);
    const total = is.count;
    const start = iter._contactCursor % total;
    const candidates = this._contactCandidates(iter, holder, mI, mH, grid, contactDist, reach, start, total);
    const list = this._ncList;
    this.perf.narrowCandidates += candidates;

    for (let c = 0; c < candidates; c++) {
      const nodeIndex = list[c];
      if (!iActive[nodeIndex]) continue;

      const lx = ix[nodeIndex], ly = iy[nodeIndex], lz = iz[nodeIndex];
      const wIx = i00 * lx + i01 * ly + i02 * lz + pIx;
      const wIy = i10 * lx + i11 * ly + i12 * lz + pIy;
      const wIz = i20 * lx + i21 * ly + i22 * lz + pIz;

      const hdx = wIx - pHx, hdy = wIy - pHy, hdz = wIz - pHz;
      if (hdx * hdx + hdy * hdy + hdz * hdz > reachSq) continue;
      const lHx = h00 * hdx + h10 * hdy + h20 * hdz;
      const lHy = h01 * hdx + h11 * hdy + h21 * hdz;
      const lHz = h02 * hdx + h12 * hdy + h22 * hdz;
      if (lHx < bx0 || lHx > bx1 || lHy < by0 || lHy > by1 || lHz < bz0 || lHz > bz1) continue;

      const i0 = Math.floor((lHx - contactDist) / cs), i1 = Math.floor((lHx + contactDist) / cs);
      const j0 = Math.floor((lHy - contactDist) / cs), j1 = Math.floor((lHy + contactDist) / cs);
      // Płaszczyzna: węzły obu ciał leżą na z = 0 — jeden plaster hasha zamiast czterech.
      const k0 = planar ? Math.floor(lHz / cs + 0.5) : Math.floor((lHz - contactDist) / cs);
      const k1 = planar ? k0 : Math.floor((lHz + contactDist) / cs);
      let found = -1;
      let bestD2 = contactDistSq;

      // Odwiedź tylko kubiki przecinające sferę kontaktu. Dawny stały zakres
      // ±2 dawał 125 lookupów na węzeł, także przez pustkę pomiędzy odłamami.
      for (let k = k0; k <= k1; k++) {
        const ez = Math.max(0, k * cs - lHz, lHz - (k + 1) * cs);
        const z2 = ez * ez;
        if (z2 >= bestD2) continue;
        for (let j = j0; j <= j1; j++) {
          const ey = Math.max(0, j * cs - lHy, lHy - (j + 1) * cs);
          const yz2 = z2 + ey * ey;
          if (yz2 >= bestD2) continue;
          for (let i = i0; i <= i1; i++) {
            const ex = Math.max(0, i * cs - lHx, lHx - (i + 1) * cs);
            if (yz2 + ex * ex >= bestD2) continue;
            lookups++;
            let bucket;
            if (gMap) {
              const head = gMap.get(hashKey(i, j, k));
              if (head === undefined) continue;
              bucket = head;
            } else {
              const ci = i - gi0, cj = j - gj0, ck = k - gk0;
              if (ci < 0 || cj < 0 || ck < 0 || ci >= gnx || cj >= gny || ck >= gnz) continue;
              bucket = gHeads[ci + gnx * (cj + gny * ck)];
            }
            for (let h = bucket; h >= 0; h = hNext[h]) {
              const ddx = lHx - hx[h], ddy = lHy - hy[h], ddz = lHz - hz[h];
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d2 < bestD2) { bestD2 = d2; found = h; }
            }
          }
        }
      }
      if (found < 0) continue;

      const fx = hx[found], fy = hy[found], fz = hz[found];
      const wHx = h00 * fx + h01 * fy + h02 * fz + pHx;
      const wHy = h10 * fx + h11 * fy + h12 * fz + pHy;
      const wHz = h20 * fx + h21 * fy + h22 * fz + pHz;

      const cnx = wIx - wHx, cny = wIy - wHy, cnz = wIz - wHz;
      const dist = Math.sqrt(cnx * cnx + cny * cny + cnz * cnz);
      const pen = contactDist - dist;
      if (pen <= 0) continue;

      hitX += (wIx + wHx) * 0.5;
      hitY += (wIy + wHy) * 0.5;
      hitZ += (wIz + wHz) * 0.5;
      nX += swapped ? -cnx : cnx;
      nY += swapped ? -cny : cny;
      nZ += swapped ? -cnz : cnz;
      if (pen > penetration) penetration = pen;
      const ca = swapped ? found : nodeIndex, cb = swapped ? nodeIndex : found;
      contactsA[count] = ca;
      contactsB[count] = cb;
      depths[count] = pen;
      if (sa.massStamp[ca] !== massStamp) { contactMassA += sa.mass[ca]; sa.massStamp[ca] = massStamp; }
      if (sb.massStamp[cb] !== massStamp) { contactMassB += sb.mass[cb]; sb.massStamp[cb] = massStamp; }
      count++;
      if (count >= maxContacts) {
        if (doDamage) iter._contactCursor = nodeIndex + 1;
        break;
      }
    }
    this.perf.hashLookups += lookups;

    if (count === 0) return 0;
    // Styk: ciała zmieniają położenie i kształt (rozdzielenie, zgniot) — pary z nimi liczą się od nowa.
    this._touchGeometry(A);
    this._touchGeometry(B);

    hitX /= count; hitY /= count; hitZ /= count;
    let nLenSq = nX * nX + nY * nY + nZ * nZ;
    if (nLenSq < 1e-12) {
      nX = A.pos.x - B.pos.x; nY = A.pos.y - B.pos.y; nZ = A.pos.z - B.pos.z;
      nLenSq = nX * nX + nY * nY + nZ * nZ;
      if (nLenSq < 1e-12) { nX = 1; nY = 0; nZ = 0; nLenSq = 1; }
    }
    const invN = 1 / Math.sqrt(nLenSq);
    nX *= invN; nY *= invN; nZ *= invN;

    this.perf.contacts += count;
    this.wake(A, cfg.wakeHoldFrames);
    this.wake(B, cfg.wakeHoldFrames);

    const rAx = hitX - A.pos.x, rAy = hitY - A.pos.y, rAz = hitZ - A.pos.z;
    const rBx = hitX - B.pos.x, rBy = hitY - B.pos.y, rBz = hitZ - B.pos.z;

    const vAx = A.vel.x + (A.angVel.y * rAz - A.angVel.z * rAy);
    const vAy = A.vel.y + (A.angVel.z * rAx - A.angVel.x * rAz);
    const vAz = A.vel.z + (A.angVel.x * rAy - A.angVel.y * rAx);
    const vBx = B.vel.x + (B.angVel.y * rBz - B.angVel.z * rBy);
    const vBy = B.vel.y + (B.angVel.z * rBx - B.angVel.x * rBz);
    const vBz = B.vel.z + (B.angVel.x * rBy - B.angVel.y * rBx);

    const dvx = vAx - vBx, dvy = vAy - vBy, dvz = vAz - vBz;
    // W głębokim kontakcie środki węzłów mijają się. Normalna sferyczna
    // odwraca się wtedy mimo dalszego wjeżdżania w metal (tak jak w 2D).
    const closing = dvx * (A.pos.x - B.pos.x) + dvy * (A.pos.y - B.pos.y) + dvz * (A.pos.z - B.pos.z);
    const speed = Math.hypot(dvx, dvy, dvz);
    const massRatio = Math.max(A.mass, B.mass) / Math.max(1, Math.min(A.mass, B.mass));
    if (speed > cfg.crushSpeedThreshold &&
        ((closing < 0 && dvx * nX + dvy * nY + dvz * nZ >= 0) ||
          ((A.static || B.static || A.anchored || B.anchored || massRatio > 4) && penetration > contactDist * 0.2))) {
      nX = -dvx / speed; nY = -dvy / speed; nZ = -dvz / speed;
    }
    const velAlongNormal = dvx * nX + dvy * nY + dvz * nZ;
    const approach = Math.max(0, -velAlongNormal);

    const massA = Math.max(1, A.mass * A.rammingMassMult);
    const massB = Math.max(1, B.mass * B.rammingMassMult);
    const armorA = A.collisionArmor, armorB = B.collisionArmor;
    // Zakotwiczone jak statyczne dla ruchu sztywnego (masa ∞), ale gniecie się (niżej).
    const fixedA = A.static || A.anchored, fixedB = B.static || B.anchored;
    const invMassA = fixedA ? 0 : 1 / massA;
    const invMassB = fixedB ? 0 : 1 / massB;
    const crushing = approach > cfg.crushSpeedThreshold;
    const transfer = crushing ? Math.max(0, Math.min(1, cfg.crushTransfer)) : 0;
    let impulse = 0;

    // --- impuls na ciała sztywne ---
    if (velAlongNormal < 0) {
      const iaN = applyInvInertia(A, rAy * nZ - rAz * nY, rAz * nX - rAx * nZ, rAx * nY - rAy * nX, this._s4);
      const tqAx = iaN.y * rAz - iaN.z * rAy;
      const tqAy = iaN.z * rAx - iaN.x * rAz;
      const tqAz = iaN.x * rAy - iaN.y * rAx;
      const ibN = applyInvInertia(B, rBy * nZ - rBz * nY, rBz * nX - rBx * nZ, rBx * nY - rBy * nX, this._s5);
      const tqBx = ibN.y * rBz - ibN.z * rBy;
      const tqBy = ibN.z * rBx - ibN.x * rBz;
      const tqBz = ibN.x * rBy - ibN.y * rBx;

      const denom = invMassA + invMassB +
        (tqAx * nX + tqAy * nY + tqAz * nZ) +
        (tqBx * nX + tqBy * nY + tqBz * nZ);

      if (Number.isFinite(denom) && denom > 1e-9) {
        // Im mocniejsze uderzenie, tym więcej energii idzie w zgniot zamiast w odbicie.
        const rest = crushing ? 0 : cfg.restitution;
        let j = (-(1 + rest) * velAlongNormal) / denom;
        // Zgniot potrzebuje drogi hamowania. Kolejna iteracja kontaktów nie
        // może ponownie wytracić całej prędkości przed następną warstwą.
        if (crushing && cfg.crushStrength > 0) {
          // Stal ustępuje przy stałej sile na jednostkę frontu styku: nadmiar pędu
          // nie znika, tylko dalej gniecie — czas zgniatania wychodzi z pędu.
          const light = fixedA ? B : fixedB ? A : (A.mass <= B.mass ? A : B);
          const nodeMass = light.mass / Math.max(1, light.activeNodes);
          // Najpierw ustępuje słabsze poszycie. Sama duża masa cywilnego kadłuba
          // nie daje pancerza; ściana statyczna nie ogranicza odporności statku.
          // Ściana ZAKOTWICZONA (niszczalna budowla) — jak dwa kadłuby: słabszy materiał ogranicza
          // siłę styku (cienka brama nie zatrzyma pancernego Atlasa — pęka; pancerz 16 statku
          // przy ścianie traktowanej jak statyczna zatrzymywał go na bramie z 40 j. blachy).
          const armor = (A.static || B.static) ? (fixedA ? armorB : armorA) : Math.min(armorA, armorB);
          const jYield = cfg.crushStrength * count * nodeMass / Math.max(1e-6, light.cellSize) * dt * armor;
          j = doDamage ? Math.min(j, jYield) : 0;
        } else if (crushing) {
          // Pojedyncza warstwa poszycia nie zatrzymuje całej masy statku.
          // Opór rośnie wraz z masą materiału faktycznie objętego kontaktem.
          const contactShare = fixedA ? contactMassB / B.mass : fixedB ? contactMassA / A.mass
            : Math.max(contactMassA / A.mass, contactMassB / B.mass);
          j *= doDamage ? (1 - Math.pow(transfer, dt * 60)) * Math.max(0.04, Math.min(1, contactShare)) : 0;
        }
        impulse = j;
        this._applyImpulse(A, rAx, rAy, rAz, nX * j, nY * j, nZ * j, invMassA);
        this._applyImpulse(B, rBx, rBy, rBz, -nX * j, -nY * j, -nZ * j, invMassB);

        let tx = dvx - nX * velAlongNormal;
        let ty = dvy - nY * velAlongNormal;
        let tz = dvz - nZ * velAlongNormal;
        const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tLen > 1e-6) {
          tx /= tLen; ty /= tLen; tz /= tLen;
          let jt = -tLen / Math.max(1e-9, invMassA + invMassB);
          const maxF = Math.abs(j) * cfg.friction;
          if (jt < -maxF) jt = -maxF;
          this._applyImpulse(A, rAx, rAy, rAz, tx * jt, ty * jt, tz * jt, invMassA);
          this._applyImpulse(B, rBx, rBy, rBz, -tx * jt, -ty * jt, -tz * jt, invMassB);
        }
      }
    }

    // --- ZGNIOT: penetracja wpychana w węzły, nie oddawana jako odbicie ---
    // Tu powstaje wgniecenie. Belki dostają to jako wymuszenie przemieszczenia
    // i same decydują, czy się ugną sprężyście, odkształcą trwale, czy zerwą.
    if (doDamage && transfer > 0) {
      const bias = cfg.crushMassBias;
      const total = massA + massB;
      // Podatność poszycia maleje z kwadratem pancerza. Normalizacja zachowuje
      // cały zgniot: odporny kadłub przekazuje go słabszemu, zamiast kasować.
      // Równy pancerz = dawny podział wg masy, także Atlas kontra Atlas.
      // Para z ciałem zakotwiczonym: podział tylko z pancerza (materiału), nie z masy —
      // masa ∞ ściany oddawałaby cały zgniot statkowi, a ściana ma pękać.
      const anchoredPair = A.anchored || B.anchored;
      const weightA = A.static ? 0 : (B.static || anchoredPair ? 1 : Math.pow(massB / total, bias)) / (armorA * armorA);
      const weightB = B.static ? 0 : (A.static || anchoredPair ? 1 : Math.pow(massA / total, bias)) / (armorB * armorB);
      const weightSum = weightA + weightB || 1;
      const shareA = weightA / weightSum, shareB = weightB / weightSum;
      const travel = approach * dt;
      const stamp = this._nextContactStamp();

      // Normalna B -> A: dziób A cofa się w kierunku +N, dziób B w -N.
      const lnA = matVecT(this._refreshRot(A), nX, nY, nZ, this._s4);
      const lnB = matVecT(this._refreshRot(B), -nX, -nY, -nZ, this._s5);

      const local = !!cfg.localSolver;
      // Żar zderzenia: szybszy taran = bielszy brzeg rany (obie strony, także dziób taranującego).
      // Zgniatana powierzchnia tylko się rozgrzewa (heatContact); pełny poziom dostaje brzeg
      // rany — belki zerwane w solverze przez chwilę po styku (_woundHeat, _solveLocal).
      const level = cfg.heatGain > 0 ? Math.min(1, approach / Math.max(1e-6, cfg.heatSpeed)) * cfg.heatGain : 0;
      const heatNow = level > 0.02 ? this.clock() : 0;
      const heat = level * cfg.heatContact;
      if (heatNow > 0) {
        if (level >= (A._woundHeat || 0) || heatNow - (A._woundHeatAt || 0) > cfg.heatWoundWindow) { A._woundHeat = level; A._woundHeatAt = heatNow; }
        if (level >= (B._woundHeat || 0) || heatNow - (B._woundHeatAt || 0) > cfg.heatWoundWindow) { B._woundHeat = level; B._woundHeatAt = heatNow; }
      }
      for (let i = 0; i < count; i++) {
        const na = contactsA[i];
        const nb = contactsB[i];
        const depth = Math.min(contactDist * 0.65, Math.max(depths[i], travel)) * transfer;
        // Obrys rośnie o zgniecione węzły zamiast pełnego przeliczenia (dawniej 2× na parę na iterację).
        // Kotwica (invMass 0) się nie przesuwa — ustępują belki do niej.
        if (sa.active[na] && shareA > 0 && sa.invMass[na] > 0) {
          this._crushNode(sa, na, lnA, depth * shareA, dt, stamp, cfg.crushBuckling);
          extendBeamBounds(A, sa.x[na], sa.y[na], sa.z[na]);
          if (heatNow > 0) this._heatCrushed(A, na, heat, heatNow, local);
          if (local) activateNode(A, na);
        }
        if (sb.active[nb] && shareB > 0 && sb.invMass[nb] > 0) {
          this._crushNode(sb, nb, lnB, depth * shareB, dt, stamp, cfg.crushBuckling);
          extendBeamBounds(B, sb.x[nb], sb.y[nb], sb.z[nb]);
          if (heatNow > 0) this._heatCrushed(B, nb, heat, heatNow, local);
          if (local) activateNode(B, nb);
        }
      }
      A.meshDirty = true;
      B.meshDirty = true;
      if (!A.static) A._hashTick = -1;
      if (!B.static) B._hashTick = -1;
    }

    // --- separacja ciał sztywnych ---
    const slop = cfg.separationSlop;
    if (penetration > slop && (invMassA + invMassB) > 0) {
      const separation = 1 - Math.pow(1 - cfg.separationPercent, dt * 60);
      const corr = (penetration - slop) / (invMassA + invMassB) * separation * (1 - transfer);
      A.pos.x += nX * corr * invMassA; A.pos.y += nY * corr * invMassA; A.pos.z += nZ * corr * invMassA;
      B.pos.x -= nX * corr * invMassB; B.pos.y -= nY * corr * invMassB; B.pos.z -= nZ * corr * invMassB;
    }

    if (this.onContact !== null) {
      const info = this._contactInfo;
      info.count = count;
      info.x = hitX; info.y = hitY; info.z = hitZ;
      info.nx = nX; info.ny = nY; info.nz = nZ;       // normalna B → A
      info.relSpeed = speed;
      info.approach = approach;
      info.slide = Math.sqrt(Math.max(0, speed * speed - velAlongNormal * velAlongNormal));
      info.penetration = penetration;
      info.crushing = crushing;
      info.impulse = impulse;
      info.doDamage = doDamage;
      this.onContact(A, B, info);
    }
    return count;
  },

  _ncList: new Int32Array(1024),

  /**
   * Kandydaci skanu kontaktów (collideBodies) w this._ncList, w kolejności skanu: od `start` rosnąco,
   * z zawinięciem. Kandydat = żywy węzeł iterowanego ciała w obszarze, w którym może przejść testy
   * sfery zasięgu i pudła gospodarza — obie bryły przeniesione z układu gospodarza do układu
   * iterowanego ciała, AABB z zapasem na zaokrąglenia (skan liczy w układzie świata, 5–10 mln j.).
   * Test w układzie lokalnym, bez obrotu do świata: ~1 ns na węzeł (dawniej obrót, przesunięcie,
   * sfera i drugi obrót na każdy węzeł). Kubełki siatki węzłów iterowanego ciała + sortowanie do
   * kolejności skanu zmierzone 2026-10-07 — bez zysku (tarany, wraki, burta w burtę). Zwraca liczbę.
   */
  _contactCandidates(iter, holder, mI, mH, grid, contactDist, reach, start, total) {
    // Gospodarz bez żywych węzłów: każdy węzeł odpada na pudle (skan nic nie znajduje).
    if (!(grid.minX <= grid.maxX)) return 0;
    // Pudło gospodarza: środek i półosie w jego układzie.
    const hcx = (grid.minX + grid.maxX) * 0.5, hcy = (grid.minY + grid.maxY) * 0.5, hcz = (grid.minZ + grid.maxZ) * 0.5;
    const hex = (grid.maxX - grid.minX) * 0.5 + contactDist;
    const hey = (grid.maxY - grid.minY) * 0.5 + contactDist;
    const hez = (grid.maxZ - grid.minZ) * 0.5 + contactDist;
    // Początek gospodarza w układzie iterowanego: Rᵢᵀ (p_H − p_I); obrót gospodarz → iterowany M = Rᵢᵀ R_H.
    const pIx = iter.pos.x, pIy = iter.pos.y, pIz = iter.pos.z;
    const pHx = holder.pos.x, pHy = holder.pos.y, pHz = holder.pos.z;
    const dx = pHx - pIx, dy = pHy - pIy, dz = pHz - pIz;
    const ox = mI[0] * dx + mI[3] * dy + mI[6] * dz;
    const oy = mI[1] * dx + mI[4] * dy + mI[7] * dz;
    const oz = mI[2] * dx + mI[5] * dy + mI[8] * dz;
    const m00 = mI[0] * mH[0] + mI[3] * mH[3] + mI[6] * mH[6];
    const m01 = mI[0] * mH[1] + mI[3] * mH[4] + mI[6] * mH[7];
    const m02 = mI[0] * mH[2] + mI[3] * mH[5] + mI[6] * mH[8];
    const m10 = mI[1] * mH[0] + mI[4] * mH[3] + mI[7] * mH[6];
    const m11 = mI[1] * mH[1] + mI[4] * mH[4] + mI[7] * mH[7];
    const m12 = mI[1] * mH[2] + mI[4] * mH[5] + mI[7] * mH[8];
    const m20 = mI[2] * mH[0] + mI[5] * mH[3] + mI[8] * mH[6];
    const m21 = mI[2] * mH[1] + mI[5] * mH[4] + mI[8] * mH[7];
    const m22 = mI[2] * mH[2] + mI[5] * mH[5] + mI[8] * mH[8];
    const cx = ox + m00 * hcx + m01 * hcy + m02 * hcz;
    const cy = oy + m10 * hcx + m11 * hcy + m12 * hcz;
    const cz = oz + m20 * hcx + m21 * hcy + m22 * hcz;
    const ax = Math.abs(m00) * hex + Math.abs(m01) * hey + Math.abs(m02) * hez;
    const ay = Math.abs(m10) * hex + Math.abs(m11) * hey + Math.abs(m12) * hez;
    const az = Math.abs(m20) * hex + Math.abs(m21) * hey + Math.abs(m22) * hez;
    // Zasięg NaN (stan uszkodzony) w skanie nie odrzuca niczego — tu też nie.
    const sphere = reach >= 0 ? reach : Infinity;
    // Zapas: skan liczy położenie węzła w świecie (błąd ~ulp największej współrzędnej, ~2e-9 przy
    // 10 mln j.); 1e-12 × skala to wielokrotność, a w komórkach kadłuba — nic.
    const eps = 1e-12 * (Math.abs(pIx) + Math.abs(pIy) + Math.abs(pIz) + Math.abs(pHx) + Math.abs(pHy) + Math.abs(pHz) +
      Math.abs(hcx) + Math.abs(hcy) + Math.abs(hcz) + hex + hey + hez + (reach >= 0 ? reach : 0)) + 1e-9;
    // Część wspólna pudła i sfery zasięgu (każde z osobna zawiera węzły, które przejdą test).
    const rx0 = Math.max(cx - ax, ox - sphere) - eps, rx1 = Math.min(cx + ax, ox + sphere) + eps;
    const ry0 = Math.max(cy - ay, oy - sphere) - eps, ry1 = Math.min(cy + ay, oy + sphere) + eps;
    const rz0 = Math.max(cz - az, oz - sphere) - eps, rz1 = Math.min(cz + az, oz + sphere) + eps;
    if (!(rx0 <= rx1 && ry0 <= ry1 && rz0 <= rz1)) return 0;

    let list = this._ncList;
    if (list.length < total) list = this._ncList = new Int32Array(Math.max(total, list.length * 2));
    const s = iter.nodeStore, x = s.x, y = s.y, z = s.z, active = s.active;
    let m = 0;
    for (let n = start; n < total; n++) {
      if (!active[n]) continue;
      const px = x[n], py = y[n], pz = z[n];
      if (px < rx0 || px > rx1 || py < ry0 || py > ry1 || pz < rz0 || pz > rz1) continue;
      list[m++] = n;
    }
    for (let n = 0; n < start; n++) {
      if (!active[n]) continue;
      const px = x[n], py = y[n], pz = z[n];
      if (px < rx0 || px > rx1 || py < ry0 || py > ry1 || pz < rz0 || pz > rz1) continue;
      list[m++] = n;
    }
    return m;
  },

  // Zmiana położenia albo kształtu ciała w kroku kolizji: para bez kontaktu z tym ciałem nie może
  // pominąć kolejnej iteracji (update). Licznik w zakresie małych liczb całkowitych V8.
  _touchGeometry(body) {
    body._geomVer = (body._geomVer + 1) & 0x3fffffff;
  },

  _contactInfo: {
    count: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, relSpeed: 0, approach: 0, slide: 0,
    penetration: 0, crushing: false, impulse: 0, doDamage: false
  },

  // Żar węzła PODNIESIONY do poziomu `value` (nie dodany): brzeg zgniotu ma temperaturę
  // taranu, nie sumę kontaktów. Porównanie po zaniku od ostatniego znacznika. true = zapis.
  _raiseHeat(s, i, value, now) {
    const peak = s.heat[i];
    if (peak >= value && peak * Math.exp(-Math.max(0, now - s.heatStamp[i]) * this.config.heatDecay) >= value) return false;
    s.heat[i] = value > 1 ? 1 : value;
    s.heatStamp[i] = now;
    return true;
  },

  // Zgniatany węzeł i jego sąsiedzi (strefa wpływu ciepła): kontakty są rzadkie — co któryś
  // węzeł frontu — więc sam węzeł dawał kropkowany żar zamiast pasa rozgrzanej blachy.
  _heatCrushed(body, i, value, now, local) {
    this._raiseHeat(body.nodeStore, i, value, now);
    this._heatRing(body, i, value * this.config.heatSpread, now, local);
  },

  // Brzeg rany (koniec zerwanej belki) + pierścień sąsiadów. Tylko solver lokalny.
  _heatWound(body, i, value, now) {
    const s = body.nodeStore;
    if (!s.active[i]) return;
    if (this._raiseHeat(s, i, value, now)) markSkinDirty(body, i);
    this._heatRing(body, i, value * this.config.heatSpread, now, true);
  },

  _heatRing(body, i, ring, now, local) {
    if (!(ring > 0.02)) return;
    const s = body.nodeStore, e = body.beamStore, adj = s.adj, active = s.active, ea = e.a, eb = e.b;
    for (let q = s.adjStart[i]; q < s.adjStart[i + 1]; q++) {
      const bi = adj[q];
      const m = ea[bi] === i ? eb[bi] : ea[bi];
      if (!active[m]) continue;
      if (this._raiseHeat(s, m, ring, now) && local) markSkinDirty(body, m);
    }
  },

  // Znaczniki kontaktu lądują w Int32Array magazynu — licznik zawija się w int32,
  // inaczej po ~2^31 wywołaniach (godziny bitwy) porównania przestałyby działać.
  _nextContactStamp() {
    let stamp = (this._contactStamp + 1) | 0;
    if (stamp <= 0) stamp = 1;
    this._contactStamp = stamp;
    return stamp;
  },

  _crushNode(s, i, normal, depth, dt, stamp, buckling) {
    // Kilka węzłów przeciwnika może wskazać ten sam węzeł: nie mnożymy zgniotu.
    const previous = s.crushStamp[i] === stamp ? s.crushDepth[i] : 0;
    const d = Math.max(0, depth - previous);
    s.crushStamp[i] = stamp;
    s.crushDepth[i] = Math.max(previous, depth);
    // Ściskane poszycie wybocza się na boki, zamiast składać wszystkie
    // warstwy w ten sam punkt. Otwarte szwy zrywają następnie belki solvera.
    const ox = s.ox[i], oy = s.oy[i], oz = s.oz[i];
    const along = ox * normal.x + oy * normal.y + oz * normal.z;
    const tx = ox - along * normal.x;
    const ty = oy - along * normal.y;
    const tz = oz - along * normal.z;
    const side = buckling / Math.max(depth * 2, Math.hypot(tx, ty, tz), 1e-6);
    const nx = normal.x + tx * side, ny = normal.y + ty * side, nz = normal.z + tz * side;
    s.x[i] += nx * d; s.y[i] += ny * d; s.z[i] += nz * d;
    const speed = d * 30;
    s.vx[i] += nx * speed; s.vy[i] += ny * speed; s.vz[i] += nz * speed;
  },

  _applyImpulse(body, rx, ry, rz, jx, jy, jz, invMass) {
    if (invMass <= 0) return;
    body.vel.x += jx * invMass;
    body.vel.y += jy * invMass;
    body.vel.z += jz * invMass;
    const tqx = ry * jz - rz * jy;
    const tqy = rz * jx - rx * jz;
    const tqz = rx * jy - ry * jx;
    const dw = applyInvInertia(body, tqx, tqy, tqz, this._s6);
    body.angVel.x += dw.x; body.angVel.y += dw.y; body.angVel.z += dw.z;
  },

  // --------------------------- BROŃ ---------------------------

  /**
   * Trafienie w punkt świata: uszkadza węzły w promieniu, ZRYWA belki w promieniu
   * mniejszym (stąd czyste przecięcie) i wpycha węzły wzdłuż wektora pocisku.
   *
   * opts.hpBudget > 0 — tryb KRATERU (gra): zamiast HP po całym promieniu z opadaniem,
   * budżet HP schodzi z węzłów od najbliższego punktu trafienia, aż się wyczerpie.
   * Nadmiar ponad HP węzła przechodzi na następny — ciężki pocisk wybija dziurę na
   * miarę swojej energii, lekki drapie jeden węzeł. Belki pękają wtedy tylko przy
   * zabitych węzłach (i dalej wg oparcia), bez osobnego promienia zerwań.
   *
   * opts.killRadius > 0 — krater WYMUSZONY (gra, zadanie 25c: dziura na miarę rany ciężkiej
   * broni): każdy węzeł bliżej punktu trafienia niż killRadius ginie (jego HP schodzi z
   * budżetu, jeśli jest), dalej — budżet jak wyżej. Wgniecenie, odrzut wybitej blachy,
   * zerwane belki, oparcie i rozpad — ta sama fizyka co krater z budżetu; odrzut węzłów
   * wymuszonych z haszu węzła, nie z Math.random (krater nie przesuwa losowań gry).
   * Bez killRadius wywołanie liczy się bit w bit jak dotąd. Zasięg zabitych — lastCraterReach.
   */
  applyImpact(body, wx, wy, wz, damage = 0, worldVel = null, opts = null) {
    const cfg = this.config;
    this.lastCraterReach = 0;
    if (!body || body.dead || body.static) return false;
    const m = this._refreshRot(body);
    const l = matVecT(m, wx - body.pos.x, wy - body.pos.y, wz - body.pos.z, this._s1);
    const radius = Math.max(cfg.cellSize, opts?.radius || cfg.impactRadius);
    const rSq = radius * radius;
    const breakR = Math.max(cfg.cellSize * 0.5, opts?.breakRadius || cfg.impactBeamBreakRadius);
    const breakRSq = breakR * breakR;

    let dir = this._s2;
    if (worldVel) {
      matVecT(m, worldVel.x, worldVel.y, worldVel.z, dir);
      const dl = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
      if (dl > 1e-6) { dir.x /= dl; dir.y /= dl; dir.z /= dl; }
      else { dir.x = 0; dir.y = 0; dir.z = 0; }
    } else { dir.x = 0; dir.y = 0; dir.z = 0; }

    let hitAny = false;
    let killed = 0;
    const push = cfg.impactPush * Math.min(3, damage / 200) * cfg.cellSize;
    const fraction = Math.max(0, Math.min(1, opts?.damageFraction ?? 1));
    const breakProgress = Math.max(0, Math.min(1, opts?.breakProgress ?? 1));
    const impulseTime = opts?.impulseTime || 0;
    const local = !!cfg.localSolver;
    const s = body.nodeStore;
    const x = s.x, y = s.y, z = s.z, hp = s.hp, active = s.active;
    // Solver lokalny: tylko węzły z okna siatki wokół trafienia (O(okno), nie O(kadłub)).
    const windowCount = local ? this._impactNodes(body, l, Math.max(radius, breakR + 1.5 * cfg.cellSize)) : -1;
    const all = windowCount < 0;
    const candidates = this._impactNodesList;
    const total = all ? s.count : windowCount;
    const killedNodes = this._impactKilled;
    killedNodes.length = 0;
    const hpBudget = opts?.hpBudget > 0 ? opts.hpBudget * fraction : 0;
    const killR = opts?.killRadius > 0 ? opts.killRadius : 0;
    const killRSq = killR * killR;
    const crater = hpBudget > 0 || killR > 0;
    if (crater && this._craterNodes.length < total) {
      this._craterNodes = new Int32Array(Math.max(total, this._craterNodes.length * 2));
      this._craterD2 = new Float64Array(this._craterNodes.length);
    }
    const craterNodes = this._craterNodes, craterD2 = this._craterD2;
    let craterCount = 0;

    for (let k = 0; k < total; k++) {
      const i = all ? k : candidates[k];
      if (!active[i]) continue;
      const dx = x[i] - l.x, dy = y[i] - l.y, dz = z[i] - l.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > rSq) continue;
      hitAny = true;
      if (local) activateNode(body, i);
      const falloff = 1 - Math.sqrt(d2) / radius;
      const influence = falloff * falloff * (3 - 2 * falloff);
      if (crater) {
        // Wstawienie w kolejności odległości (węzłów w promieniu jest kilkadziesiąt).
        let at = craterCount++;
        while (at > 0 && craterD2[at - 1] > d2) {
          craterNodes[at] = craterNodes[at - 1];
          craterD2[at] = craterD2[at - 1];
          at--;
        }
        craterNodes[at] = i;
        craterD2[at] = d2;
      } else {
        hp[i] -= damage * 0.5 * influence * fraction;
      }
      // Węzeł krateru wymuszonego i tak ginie niżej: bez wgniecenia — odłamek rusza z miejsca
      // blachy (z odrzutem), a okno trafień nie puchnie o przesunięcie martwych węzłów.
      if (killR > 0 && d2 <= killRSq) continue;
      if (s.invMass[i] <= 0) {
        // Kotwica ciała zakotwiczonego: trafienie jej nie przesuwa (HP i śmierć — jak każdy węzeł).
      } else if (impulseTime > 0) {
        // Pressure changes velocity; the solver moves and buckles the metal
        // over subsequent steps instead of teleporting it at detonation.
        const length = Math.sqrt(d2);
        const radial = length > 1e-6 ? 0.7 / length : 0;
        const vx = dx * radial + dir.x * (radial ? 0.3 : 1);
        const vy = dy * radial + dir.y * (radial ? 0.3 : 1);
        const vz = dz * radial + dir.z * (radial ? 0.3 : 1);
        const kick = push * influence * fraction / impulseTime;
        s.vx[i] += vx * kick; s.vy[i] += vy * kick; s.vz[i] += vz * kick;
      } else {
        x[i] += dir.x * push * influence * fraction;
        y[i] += dir.y * push * influence * fraction;
        z[i] += dir.z * push * influence * fraction;
        extendBeamBounds(body, x[i], y[i], z[i]);
        if (local) this._noteDisplacement(body, i);
      }
      if (!crater && hp[i] <= 0) { this.destroyNode(body, i); killed++; if (local) killedNodes.push(i); }
    }

    if (!hitAny) return false;

    if (crater) {
      let budget = hpBudget;
      // Wybita blacha wylatuje z rany (odłamek bierze prędkość węzła w onNodeDebris): większość
      // odprysku wstecz, w stronę strzelca, z rozrzutem na boki, reszta przelatuje wzdłuż pocisku.
      // Bez kierunku pocisku — promieniście od punktu trafienia. Tempo rośnie z obrażeniami.
      const kick = Math.min(260, 40 + damage * 0.04);
      const hasDir = dir.x * dir.x + dir.y * dir.y > 1e-6;
      let reachSq = 0;
      // Węzły posortowane od najbliższego: wymuszone (≤ killRadius) są na początku listy, potem budżet.
      for (let k = 0; k < craterCount; k++) {
        const forced = killR > 0 && craterD2[k] <= killRSq;
        if (!forced && !(budget > 0)) break;
        const i = craterNodes[k];
        if (!active[i]) continue;
        const take = hp[i] < budget ? hp[i] : budget;
        hp[i] -= take;
        budget -= take;
        if (forced || hp[i] <= 1e-9) {
          // Odrzut: węzeł wymuszony — rozkład jak niżej, ale z haszu węzła (bez Math.random).
          const r0 = forced ? craterHash(i, 0x51ED27) : Math.random();
          const speed = kick * (0.6 + r0 * 0.8);
          if (hasDir) {
            const along = (forced ? craterHash(i, 0x2C1B3C6D) : Math.random()) < 0.65 ? -0.8 : 0.8;
            const side = ((forced ? craterHash(i, 0x297A2D39) : Math.random()) - 0.5) * 1.6;
            s.vx[i] += (dir.x * along - dir.y * side) * speed;
            s.vy[i] += (dir.y * along + dir.x * side) * speed;
          } else {
            const rx = x[i] - l.x, ry = y[i] - l.y, rl = Math.sqrt(rx * rx + ry * ry) || 1;
            s.vx[i] += rx / rl * speed;
            s.vy[i] += ry / rl * speed;
          }
          if (craterD2[k] > reachSq) reachSq = craterD2[k];
          this.destroyNode(body, i);
          killed++;
          if (local) killedNodes.push(i);
        } else if (local) markSkinDirty(body, i);
      }
      this.lastCraterReach = Math.sqrt(reachSq);
    }

    // Zerwij belki, których środek leży w rdzeniu trafienia — to daje ranę
    // o wyraźnej krawędzi zamiast rozmytego osłabienia konstrukcji.
    const e = body.beamStore, ea = e.a, eb = e.b, broken = e.broken, type = e.type;
    const affected = this._impactAffected;
    affected.length = 0;
    const beamCount = crater ? 0 : local ? this._impactBeams(body, all ? null : candidates, total) : e.count;
    const beamList = this._impactBeamList;
    for (let k = 0; k < beamCount; k++) {
      const bi = local ? beamList[k] : k;
      if (broken[bi]) continue;
      const a = ea[bi], c = eb[bi];
      const mx = (x[a] + x[c]) * 0.5 - l.x;
      const my = (y[a] + y[c]) * 0.5 - l.y;
      const mz = (z[a] + z[c]) * 0.5 - l.z;
      if (mx * mx + my * my + mz * mz > breakRSq) continue;
      // Gródź i wręg wytrzymują trafienie, które przecina poszycie na wylot.
      const resist = (type[bi] === BEAM_TYPE.BULKHEAD) ? 380
        : (type[bi] === BEAM_TYPE.FRAME) ? 260 : 90;
      if (damage * breakProgress < resist) continue;
      broken[bi] = 1;
      body.structureDirty = true;
      this.perf.beamsBroken++;
      if (local) {
        body.liveBeams = Math.max(0, body.liveBeams - 1);
        affected.push(a, c);
        activateNode(body, a);
        activateNode(body, c);
      }
    }

    this.wake(body, cfg.wakeHoldFrames);
    body.meshDirty = true;
    body._hashTick = -1;
    this._touchGeometry(body);
    if (local) {
      // Oparcie tracą tylko końce zerwanych belek i sąsiedzi zniszczonych węzłów.
      const adjStart = s.adjStart, adj = s.adj;
      for (const dead of killedNodes) {
        for (let q = adjStart[dead]; q < adjStart[dead + 1]; q++) {
          const bi = adj[q];
          affected.push(ea[bi] === dead ? eb[bi] : ea[bi]);
        }
      }
      this._refreshIntegrityAround(body, affected);
    } else {
      this._refreshNodeIntegrity(body);
    }
    if (!body.noSplit && (killed > 0 || body.structureDirty) && this.splitQueue.indexOf(body) === -1) {
      this.splitQueue.push(body);
    }
    return true;
  },

  _impactNodesList: [],
  _impactBeamList: [],
  _impactKilled: [],
  _impactAffected: [],
  _impactDoomed: [],
  _craterNodes: new Int32Array(256),
  _craterD2: new Float64Array(256),

  // Indeks siatki spoczynkowej: komórka (ix, iy, iz) → węzeł. Pozycja spoczynkowa
  // węzła to zawsze latticeMin + (i + 0,5) · cs (środek przesuwa ją razem z latticeMin),
  // więc węzeł w zasięgu r od punktu leży w oknie r + maks. przemieszczenie węzła.
  _latticeIndex(body) {
    let index = body._lattice;
    const s = body.nodeStore, e = body.beamStore;
    if (index && index.store === s && index.beamStore === e) return index;
    const d = body.dims;
    const cells = (index && index.cells.length === d.x * d.y * d.z) ? index.cells : new Int32Array(d.x * d.y * d.z);
    cells.fill(-1);
    for (let i = 0; i < s.count; i++) cells[s.ix[i] + s.iy[i] * d.x + s.iz[i] * d.x * d.y] = i;
    // Wręgi bywają długie (od burty do burty): ich środek może leżeć daleko od obu końców.
    const frames = [];
    for (let bi = 0; bi < e.count; bi++) if (e.type[bi] === BEAM_TYPE.FRAME) frames.push(bi);
    index = body._lattice = { store: s, beamStore: e, cells, frames };
    return index;
  },

  _noteDisplacement(body, i) {
    const s = body.nodeStore;
    const disp = Math.max(Math.abs(s.x[i] - s.ox[i]), Math.abs(s.y[i] - s.oy[i]), Math.abs(s.z[i] - s.oz[i]));
    if (disp > body._maxDisp) body._maxDisp = disp;
  },

  // Indeksy węzłów z okna wokół punktu (w this._impactNodesList); −1 = przejrzyj wszystkie.
  _impactNodes(body, l, reach) {
    const out = this._impactNodesList;
    out.length = 0;
    const index = this._latticeIndex(body);
    const cs = body.cellSize, lm = body.latticeMin, d = body.dims;
    // + cs: zgniot w bieżącym kroku mógł przesunąć węzeł przed aktualizacją _maxDisp.
    const pad = reach + (body._maxDisp || 0) + cs;
    const x0 = Math.max(0, Math.floor((l.x - pad - lm.x) / cs - 0.5));
    const x1 = Math.min(d.x - 1, Math.ceil((l.x + pad - lm.x) / cs - 0.5));
    const y0 = Math.max(0, Math.floor((l.y - pad - lm.y) / cs - 0.5));
    const y1 = Math.min(d.y - 1, Math.ceil((l.y + pad - lm.y) / cs - 0.5));
    const z0 = Math.max(0, Math.floor((l.z - pad - lm.z) / cs - 0.5));
    const z1 = Math.min(d.z - 1, Math.ceil((l.z + pad - lm.z) / cs - 0.5));
    if (x1 < x0 || y1 < y0 || z1 < z0) return 0;
    // Okno większe niż kadłub (mocno pogięty wrak): pełny przegląd jest tańszy.
    // (Żywe węzły, nie pojemność magazynu: decyzja ta sama z dziurami po rozpadzie i bez nich.)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > body.activeNodes) return -1;
    const cells = index.cells;
    for (let zz = z0; zz <= z1; zz++) {
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * d.x + zz * d.x * d.y;
        for (let xx = x0; xx <= x1; xx++) {
          const i = cells[row + xx];
          if (i >= 0) out.push(i);
        }
      }
    }
    return out.length;
  },

  // Belki węzłów z okna (albo wszystkich, gdy list = null) i długie wręgi; indeksy w _impactBeamList.
  _impactBeams(body, list, count) {
    const out = this._impactBeamList;
    out.length = 0;
    let stamp = (this._regionStamp + 1) | 0;
    if (stamp <= 0) stamp = 1;
    this._regionStamp = stamp;
    const s = body.nodeStore, e = body.beamStore, broken = e.broken, beamStamp = e.stamp;
    const adjStart = s.adjStart, adj = s.adj, active = s.active;
    for (let k = 0; k < count; k++) {
      const i = list ? list[k] : k;
      if (!active[i]) continue;
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
        const bi = adj[q];
        if (broken[bi] || beamStamp[bi] === stamp) continue;
        beamStamp[bi] = stamp;
        out.push(bi);
      }
    }
    for (const bi of this._latticeIndex(body).frames) {
      if (broken[bi] || beamStamp[bi] === stamp) continue;
      beamStamp[bi] = stamp;
      out.push(bi);
    }
    return out.length;
  },

  // Lokalny odpowiednik _refreshNodeIntegrity: sprawdza tylko węzły, które straciły belki.
  // Najpierw migawka (jak pełna wersja), potem niszczenie — bez kaskady w jednym wywołaniu.
  _refreshIntegrityAround(body, list) {
    const s = body.nodeStore, broken = body.beamStore.broken, doomed = this._impactDoomed;
    const active = s.active, beamCount = s.beamCount, adjStart = s.adjStart, adj = s.adj;
    doomed.length = 0;
    for (const i of list) {
      if (!active[i] || beamCount[i] <= 0) continue;
      let live = 0;
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) if (!broken[adj[q]]) live++;
      if (live <= Math.max(1, Math.floor(beamCount[i] * 0.22))) doomed.push(i);
    }
    for (const i of doomed) this.destroyNode(body, i);
  },

  // Węzeł bez wystarczającego oparcia w poszyciu przestaje istnieć — tak powstaje
  // dziura w kadłubie (maska skóry czyta właśnie ten stan).
  _refreshNodeIntegrity(body) {
    const s = body.nodeStore, e = body.beamStore, ea = e.a, eb = e.b, broken = e.broken;
    const live = body._integrity;
    live.fill(0);
    for (let bi = 0; bi < e.count; bi++) {
      if (broken[bi]) continue;
      live[ea[bi]]++;
      live[eb[bi]]++;
    }
    let liveBeams = 0;
    for (let bi = 0; bi < e.count; bi++) if (!broken[bi]) liveBeams++;
    body.liveBeams = liveBeams;

    const active = s.active, beamCount = s.beamCount;
    for (let i = 0; i < s.count; i++) {
      if (!active[i]) continue;
      if (beamCount[i] > 0 && live[i] <= Math.max(1, Math.floor(beamCount[i] * 0.22))) {
        this.destroyNode(body, i);
      }
    }
  },

  destroyNode(body, node) {
    const i = nodeIndex(node), s = body.nodeStore;
    if (i < 0 || !s.active[i]) return;
    // Sąsiedzi tracą oparcie — solver lokalny musi ich policzyć; skóra węzła znika.
    if (this.config?.localSolver) {
      activateNeighbors(body, i);
      markSkinDirty(body, i);
    }
    s.active[i] = 0;
    s.hp[i] = 0;
    body.activeNodes = Math.max(0, body.activeNodes - 1);
    body.meshDirty = true;
    body.structureDirty = true;
    body._hashTick = -1;
    this._touchGeometry(body);
    body.mass = Math.max(1, body.mass - s.mass[i]);
    if (!body.static && !body.anchored) body.invMass = 1 / body.mass;

    const broken = body.beamStore.broken, adj = s.adj;
    for (let q = s.adjStart[i]; q < s.adjStart[i + 1]; q++) {
      const bi = adj[q];
      if (!broken[bi]) {
        broken[bi] = 1;
        body.liveBeams = Math.max(0, body.liveBeams - 1);
        this.perf.beamsBroken++;
      }
    }

    if (this.onNodeDebris !== null) {
      const m = this._refreshRot(body);
      const w = matVec(m, s.x[i], s.y[i], s.z[i], this._s3);
      const rx = w.x, ry = w.y, rz = w.z;
      const kick = matVec(m, s.vx[i], s.vy[i], s.vz[i], this._s4);
      this.onNodeDebris(body, i, rx + body.pos.x, ry + body.pos.y, rz + body.pos.z,
        body.vel.x + (body.angVel.y * rz - body.angVel.z * ry) + kick.x,
        body.vel.y + (body.angVel.z * rx - body.angVel.x * rz) + kick.y,
        body.vel.z + (body.angVel.x * ry - body.angVel.y * rx) + kick.z);
    }
    if (this.onDebris) {
      const m = this._refreshRot(body);
      const w = matVec(m, s.x[i], s.y[i], s.z[i], this._s3);
      const rx = w.x, ry = w.y, rz = w.z;
      w.x += body.pos.x; w.y += body.pos.y; w.z += body.pos.z;
      const kick = matVec(m, s.vx[i], s.vy[i], s.vz[i], this._s4);
      // Widok węzła bez budowania widoków całego ciała — tylko na czas wywołania.
      this.onDebris(
        body, nodeViewAt(body, i), w.x, w.y, w.z,
        body.vel.x + (body.angVel.y * rz - body.angVel.z * ry) + kick.x,
        body.vel.y + (body.angVel.z * rx - body.angVel.x * rz) + kick.y,
        body.vel.z + (body.angVel.x * ry - body.angVel.y * rx) + kick.z
      );
    }
    if (body.activeNodes === 0) body.dead = true;
  },

  /** Promień vs węzły — do celowania w demie. Zwraca najbliższy trafiony węzeł. */
  raycastBody(body, ox, oy, oz, dx, dy, dz, maxDist = 1e6) {
    if (!body || body.dead) return null;
    const m = this._refreshRot(body);
    const o = matVecT(m, ox - body.pos.x, oy - body.pos.y, oz - body.pos.z, this._s1);
    const d = matVecT(m, dx, dy, dz, this._s2);
    const dLen = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 1;
    d.x /= dLen; d.y /= dLen; d.z /= dLen;

    const hitRadius = this.config.nodeRadius * 1.6;
    const hitSq = hitRadius * hitRadius;
    let best = -1;
    let bestT = maxDist;
    const s = body.nodeStore, x = s.x, y = s.y, z = s.z;

    for (let i = 0; i < s.count; i++) {
      if (!s.active[i] || !s.surface[i]) continue;
      const rx = x[i] - o.x, ry = y[i] - o.y, rz = z[i] - o.z;
      const t = rx * d.x + ry * d.y + rz * d.z;
      if (t < 0 || t > bestT) continue;
      const cx = rx - d.x * t, cy = ry - d.y * t, cz = rz - d.z * t;
      if (cx * cx + cy * cy + cz * cz > hitSq) continue;
      bestT = t;
      best = i;
    }
    if (best < 0) return null;

    const w = matVec(m, x[best], y[best], z[best], this._s3);
    return {
      node: nodeViewAt(body, best),
      nodeIndex: best,
      t: bestT,
      x: w.x + body.pos.x,
      y: w.y + body.pos.y,
      z: w.z + body.pos.z
    };
  },

  /**
   * Odcinek (x0, y0) → (x1, y1) w UKŁADZIE CIAŁA płaskiego (planar, nz = 1) przeciw kołom
   * węzłów o promieniu `reach`: pierwszy żywy węzeł na drodze. Wynik w `out` (t ∈ [0, 1],
   * node = indeks) i zwrot indeksu albo −1. Zapytania gry (pocisk, wiązka) — kandydaci
   * z siatki spoczynkowej wiersz po wierszu: w każdym wierszu tylko pas kolumn, przez który
   * przechodzi odcinek (± zasięg i maks. przemieszczenie węzła), więc długa wiązka przez
   * cały kadłub nie przegląda całego prostokąta.
   */
  sweepLocal2D(body, x0, y0, x1, y1, reach, out) {
    out.t = Infinity;
    out.node = -1;
    if (!body || body.dead || body.activeNodes <= 0) return -1;
    const mm = body._boundsMinMax;
    if (Math.max(x0, x1) < mm[0] - reach || Math.min(x0, x1) > mm[3] + reach ||
        Math.max(y0, y1) < mm[1] - reach || Math.min(y0, y1) > mm[4] + reach) return -1;
    const index = this._latticeIndex(body);
    const s = body.nodeStore, x = s.x, y = s.y, active = s.active, cells = index.cells;
    const cs = body.cellSize, lm = body.latticeMin, d = body.dims;
    // + cs: zgniot w bieżącym kroku mógł przesunąć węzeł przed aktualizacją _maxDisp.
    const pad = reach + (body._maxDisp || 0) + cs;
    const dx = x1 - x0, dy = y1 - y0;
    const a = dx * dx + dy * dy, r2 = reach * reach;
    const row0 = Math.max(0, Math.floor((Math.min(y0, y1) - pad - lm.y) / cs - 0.5));
    const row1 = Math.min(d.y - 1, Math.ceil((Math.max(y0, y1) + pad - lm.y) / cs - 0.5));
    let bestT = Infinity, best = -1;
    for (let iy = row0; iy <= row1; iy++) {
      const cy = lm.y + (iy + 0.5) * cs;
      let tLo = 0, tHi = 1;
      if (Math.abs(dy) > 1e-12) {
        let ta = (cy - pad - y0) / dy, tb = (cy + pad - y0) / dy;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > tLo) tLo = ta;
        if (tb < tHi) tHi = tb;
        if (tLo > tHi) continue;
      } else if (Math.abs(y0 - cy) > pad) continue;
      if (tLo >= bestT) continue;
      const xa = x0 + dx * tLo, xb = x0 + dx * tHi;
      const col0 = Math.max(0, Math.floor((Math.min(xa, xb) - pad - lm.x) / cs - 0.5));
      const col1 = Math.min(d.x - 1, Math.ceil((Math.max(xa, xb) + pad - lm.x) / cs - 0.5));
      const rowBase = iy * d.x;
      for (let ix = col0; ix <= col1; ix++) {
        const i = cells[rowBase + ix];
        if (i < 0 || !active[i]) continue;
        const fx = x0 - x[i], fy = y0 - y[i];
        const c = fx * fx + fy * fy - r2;
        let t;
        if (c <= 0) t = 0;
        else {
          if (a <= 1e-18) continue;
          const b = fx * dx + fy * dy;
          if (b >= 0) continue;                       // oddala się od środka
          const disc = b * b - a * c;
          if (disc < 0) continue;
          t = (-b - Math.sqrt(disc)) / a;
          if (t > 1) continue;
        }
        if (t < bestT) { bestT = t; best = i; }
      }
    }
    out.t = bestT;
    out.node = best;
    return best;
  },

  /** Najbliższy żywy węzeł ciała płaskiego w promieniu `reach` od punktu (układ ciała) albo −1. */
  probeLocal2D(body, lx, ly, reach) {
    if (!body || body.dead || body.activeNodes <= 0) return -1;
    const mm = body._boundsMinMax;
    if (lx < mm[0] - reach || lx > mm[3] + reach || ly < mm[1] - reach || ly > mm[4] + reach) return -1;
    const index = this._latticeIndex(body);
    const s = body.nodeStore, x = s.x, y = s.y, active = s.active, cells = index.cells;
    const cs = body.cellSize, lm = body.latticeMin, d = body.dims;
    const pad = reach + (body._maxDisp || 0) + cs;
    const x0 = Math.max(0, Math.floor((lx - pad - lm.x) / cs - 0.5));
    const x1 = Math.min(d.x - 1, Math.ceil((lx + pad - lm.x) / cs - 0.5));
    const y0 = Math.max(0, Math.floor((ly - pad - lm.y) / cs - 0.5));
    const y1 = Math.min(d.y - 1, Math.ceil((ly + pad - lm.y) / cs - 0.5));
    let bestD2 = reach * reach, best = -1;
    for (let iy = y0; iy <= y1; iy++) {
      const rowBase = iy * d.x;
      for (let ix = x0; ix <= x1; ix++) {
        const i = cells[rowBase + ix];
        if (i < 0 || !active[i]) continue;
        const ddx = x[i] - lx, ddy = y[i] - ly;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 <= bestD2) { bestD2 = d2; best = i; }
      }
    }
    return best;
  },

  // --------------------------- ROZPADY ---------------------------

  _islandStack: [],

  /** Wyspy liczone po NIEZERWANYCH belkach — tu materializuje się przecięcie.
   *  Zwraca listy indeksów węzłów w bieżącym magazynie ciała. */
  findIslands(body) {
    let stamp = (this._islandStamp + 1) | 0;
    if (stamp <= 0) stamp = 1;
    this._islandStamp = stamp;

    const s = body.nodeStore, e = body.beamStore;
    const active = s.active, island = s.islandStamp, adjStart = s.adjStart, adj = s.adj;
    const ea = e.a, eb = e.b, broken = e.broken;
    const groups = [];
    const stack = this._islandStack;

    for (let seed = 0; seed < s.count; seed++) {
      if (!active[seed] || island[seed] === stamp) continue;
      const group = [];
      stack.length = 0;
      stack.push(seed);
      island[seed] = stamp;
      while (stack.length > 0) {
        const cur = stack.pop();
        group.push(cur);
        for (let q = adjStart[cur]; q < adjStart[cur + 1]; q++) {
          const bi = adj[q];
          if (broken[bi]) continue;
          const other = ea[bi] === cur ? eb[bi] : ea[bi];
          if (!active[other] || island[other] === stamp) continue;
          island[other] = stamp;
          stack.push(other);
        }
      }
      groups.push(group);
    }
    return groups;
  },

  processSplits(bodies) {
    const cfg = this.config;
    const queued = this.splitQueue;
    if (!queued.length) return;
    this.splitQueue = [];
    let processed = 0;

    let wreckCount = 0;
    for (const body of bodies) if (body?.isWreck && !body.dead) wreckCount++;
    for (const body of queued) {
      if (!body || body.dead || body.static || body.noSplit || !body.structureDirty) continue;
      if (processed >= Math.max(1, cfg.splitMaxPerTick | 0)) {
        this.splitQueue.push(body);
        continue;
      }
      body.structureDirty = false;
      processed++;

      if (cfg.breakEnabled && cfg.detachTornJoints) {
        const e = body.beamStore;
        body._connectivity = beamConnectivityScratch(body.nodeStore.count, e.count, body._connectivity);
        const bridges = findBeamBridgesStore(body.nodeStore, e, body._connectivity);
        let detached = 0;
        for (let i = 0; i < e.count; i++) {
          // Preserve intentionally separate original struts / hinges. Only a
          // formerly braced joint that lost every alternate load path tears.
          if (bridges[i] && e.restBridge[i] === 0) {
            e.broken[i] = 1;
            detached++;
            if (cfg.localSolver) { activateNode(body, e.a[i]); activateNode(body, e.b[i]); }
          }
        }
        if (detached) {
          body.liveBeams = Math.max(0, body.liveBeams - detached);
          this.perf.beamsBroken += detached;
          body.meshDirty = true;
          this.wake(body, cfg.wakeHoldFrames);
        }
      }

      const groups = this.findIslands(body);
      if (groups.length === 0) { body.dead = true; continue; }
      if (groups.length === 1) {
        // Zakotwiczone ciało, które straciło ostatnią kotwicę (zniszczony węzeł-kotwica), odpada.
        if (body.anchored && !this._groupPinned(body, groups[0])) this._releaseAnchor(body, true);
        continue;
      }
      groups.sort((a, b) => b.length - a.length);
      // Zakotwiczone: zostaje największa wyspa Z KOTWICĄ, inne zakotwiczone wyspy też stoją
      // (osobne ciała), wyspy bez kotwicy odpadają jako swobodne wraki.
      let pinned = null;
      if (body.anchored) {
        pinned = groups.map(g => this._groupPinned(body, g));
        const stay = pinned.indexOf(true);
        if (stay > 0) {
          const g = groups[0]; groups[0] = groups[stay]; groups[stay] = g;
          pinned[stay] = pinned[0]; pinned[0] = true;
        } else if (stay < 0) {
          this._releaseAnchor(body, false);
          pinned = null;
        }
      }

      let fragments = 0;
      for (let gi = 1; gi < groups.length; gi++) {
        const group = groups[gi];
        if (group.length < Math.max(2, cfg.splitMinNodes | 0) ||
            fragments >= cfg.splitMaxFragments || wreckCount >= cfg.maxWrecks) {
          for (const i of group) this.destroyNode(body, i);
          continue;
        }
        this._spawnWreck(body, group, bodies, pinned !== null && pinned[gi]);
        fragments++;
        wreckCount++;
      }
      // Same odpryski (zniszczone jak zwykłe węzły): kadłub zostaje na swoich tablicach,
      // tak jak po trafieniu. Przebudowa klonuje wszystkie belki — pod ostrzałem trwała
      // w kółko. Pełny solver zachowuje dawną przebudowę (środek masy i tensor po odprysku).
      if (fragments > 0 || !cfg.localSolver) this._rebuildBody(body, groups[0]);
    }
  },

  /** Czy wyspa ciała zakotwiczonego trzyma się kotwicy (węzeł z invMass 0). */
  _groupPinned(body, group) {
    const invMass = body.nodeStore.invMass;
    for (let k = 0; k < group.length; k++) if (invMass[group[k]] === 0) return true;
    return false;
  },

  /**
   * Ciało zakotwiczone bez kotwic staje się swobodne: masa skończona, a ruch węzłów (zgniot,
   * pchnięcie pocisku) przechodzi na ruch sztywny. `transfer` = bez przebudowy (rozpad bez
   * podziału) — przy przebudowie robi to _rebuildBody.
   */
  _releaseAnchor(body, transfer) {
    body.anchored = false;
    body.invMass = 1 / Math.max(1, body.mass);
    if (transfer) this._transferFragmentMotion(body);
    this.wake(body, this.config.wakeHoldFrames);
  },

  _partitionMap: new Int32Array(0),
  _partitionOrder: new Int32Array(0),
  _partitionKept: new Int32Array(0),

  /**
   * Sekcja ciała (węzły `group` — indeksy w bieżącym magazynie) jako nowe magazyny.
   * `keepOrder` (zagęszczenie kadłuba): węzły i belki w DOTYCHCZASOWEJ kolejności (rosnące
   * indeksy), więc zagęszczenie jest przezroczyste dla fizyki — kadłub z dziurami po rozpadzie
   * w miejscu liczy się bit w bit tak samo jak zagęszczony. Wrak (bez keepOrder) powstaje
   * tak samo w obu trybach, więc dostaje tanią kolejność jak dawniej: węzły w kolejności
   * wyspy, belki węzeł po węźle — bez sortowania.
   * Belki: oba końce w sekcji, także zerwane (naprawa może je zrosnąć, jak w miejscu).
   * `beamCount` = żywe belki węzła w sekcji (próg oparcia liczony od stanu po rozpadzie).
   * Widoki węzłów sekcji przepinają się na nowy magazyn — tożsamość przeżywa rozpad.
   */
  _partitionBeams(body, group, keepOrder = false) {
    const src = body.nodeStore, srcBeams = body.beamStore, count = group.length;
    if (this._partitionMap.length < src.count) this._partitionMap = new Int32Array(src.count).fill(-1);
    if (this._partitionOrder.length < count) this._partitionOrder = new Int32Array(Math.max(count, this._partitionOrder.length * 2));
    const map = this._partitionMap;
    const order = this._partitionOrder.subarray(0, count);
    for (let k = 0; k < count; k++) order[k] = group[k];
    if (keepOrder) order.sort();
    for (let k = 0; k < count; k++) map[order[k]] = k;

    const ns = new BeamNodeStore(count);
    gatherNodeFields(src, ns, order, count);

    // Belki o obu końcach w sekcji — każda raz, od końca a (przy keepOrder potem posortowane).
    let kept = this._partitionKept, keptCount = 0;
    const adjStart = src.adjStart, adj = src.adj, ea = srcBeams.a, eb = srcBeams.b;
    for (let k = 0; k < count; k++) {
      const i = order[k];
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
        const bi = adj[q];
        if (ea[bi] !== i || map[eb[bi]] < 0) continue;
        if (keptCount === kept.length) {
          const grown = new Int32Array(Math.max(1024, kept.length * 2));
          grown.set(kept);
          kept = this._partitionKept = grown;
        }
        kept[keptCount++] = bi;
      }
    }
    const keptList = kept.subarray(0, keptCount);
    if (keepOrder) keptList.sort();
    const bs = new BeamLinkStore(keptCount);
    const liveBeams = gatherBeamFields(srcBeams, bs, keptList, keptCount, map);
    buildAdjacency(ns, bs);
    const beamCount = ns.beamCount;
    beamCount.fill(0);
    for (let n = 0; n < keptCount; n++) {
      if (bs.broken[n]) continue;
      beamCount[bs.a[n]]++;
      beamCount[bs.b[n]]++;
    }

    for (let k = 0; k < count; k++) map[order[k]] = -1;
    // Widoki węzłów istnieją tylko, jeśli ktoś je czytał — wtedy przepinamy je na nowy
    // magazyn (tożsamość węzła przeżywa rozpad). Inaczej sekcja zostaje bez widoków.
    const views = cachedNodeViews(body);
    let nodes = null;
    if (views) {
      nodes = new Array(count);
      for (let k = 0; k < count; k++) {
        const view = views[order[k]];
        view._s = ns;
        view._i = k;
        nodes[k] = view;
      }
    }
    return { nodes, nodeStore: ns, beamStore: bs, order, liveBeams };
  },

  _shiftStore(s, cx, cy, cz) {
    for (let i = 0; i < s.count; i++) {
      s.ox[i] -= cx; s.oy[i] -= cy; s.oz[i] -= cz;
      s.x[i] -= cx; s.y[i] -= cy; s.z[i] -= cz;
      s.px[i] -= cx; s.py[i] -= cy; s.pz[i] -= cz;
    }
  },

  /**
   * Kadłub po rozpadzie: zostaje sekcja `group`. Domyślnie W MIEJSCU — węzły odłamów (już
   * skopiowane do wraków) gasną na tablicach kadłuba, a kopiuje się tylko odłam. Dawniej
   * każdy rozpad kopiował cały pozostały kadłub (Atlas przy 7,5 j.: 12 tys. węzłów, 50 tys.
   * belek, 4–17 ms) i renderer budował od nowa skórę całego kadłuba. Gdy żywych węzłów
   * zostaje mniej niż `compactBelow` pojemności, magazyny się zagęszczają — w pierwotnej
   * kolejności, więc wynik fizyki jest ten sam (bit w bit) przy każdym progu.
   * `body.keepLayout` (żywe kadłuby gry, hullBodies.js): bez zagęszczania — magazyn zostaje w układzie
   * konstrukcji, więc odrost węzłów (HullBodies.regrowCell) ożywia wpisy w miejscu.
   */
  _rebuildBody(body, group) {
    const s = body.nodeStore;
    const compactBelow = body.keepLayout ? 0 : (this.config.compactBelow ?? 0.5);
    let part = null;
    if (group.length < compactBelow * s.count) {
      const cursor = body._contactCursor;
      part = this._partitionBeams(body, group, true);
      const order = part.order, n = order.length;
      // Kursor skanu kontaktów wskazuje ten sam węzeł co w miejscu (pierwszy żywy ≥ kursor).
      body._contactCursor = lowerBound(order, n, cursor);
      // Stan mocowań węzłów w scratchu solvera idzie za węzłami. Solver lokalny odświeża
      // go tylko dla obszaru przy zmianie struktury, więc bez przepisania węzeł wchodzący
      // później do obszaru czytał stan innego węzła (dawnego właściciela indeksu).
      // order rośnie i order[k] ≥ k — przepisanie w miejscu niczego nie nadpisuje przed odczytem.
      const failed = body._solverScratch?.mountFailed;
      if (failed) for (let k = 0; k < n; k++) failed[k] = failed[order[k]];
    } else {
      this._retireOutsideGroup(body, group);
    }
    // Węzły odłamów zgasły (albo przyjdzie nowy magazyn): siatka węzłów do przebudowy.
    body._hashTick = -1;
    const store = part ? part.nodeStore : s;
    const info = computeStoreInertia(store, body.cellSize);
    if (!info) return;

    const m = this._refreshRot(body);
    const shift = matVec(m, info.com.x, info.com.y, info.com.z, this._s1);
    body.pos.x += shift.x; body.pos.y += shift.y; body.pos.z += shift.z;
    body.vel.x += body.angVel.y * shift.z - body.angVel.z * shift.y;
    body.vel.y += body.angVel.z * shift.x - body.angVel.x * shift.z;
    body.vel.z += body.angVel.x * shift.y - body.angVel.y * shift.x;

    this._shiftStore(store, info.com.x, info.com.y, info.com.z);
    body.latticeMin.x -= info.com.x;
    body.latticeMin.y -= info.com.y;
    body.latticeMin.z -= info.com.z;

    if (part) {
      body.nodeStore = part.nodeStore;
      body.beamStore = part.beamStore;
      body.nodes = part.nodes;           // przepięte widoki albo null (na żądanie)
      body.beams = null;
      body.liveBeams = part.liveBeams;
    }
    body.activeNodes = group.length;
    body.mass = Math.max(1, info.mass);
    if (!body.static && !body.anchored) body.invMass = 1 / body.mass;
    body.invInertiaLocal = info.invInertia;
    if (!body.anchored) this._transferFragmentMotion(body);
    this._updateRadius(body);
    body.meshDirty = true;
    body._hashTick = -1;
    this.wake(body, this.config.wakeHoldFrames);
  },

  /**
   * Rozpad w miejscu: żywe węzły spoza `group` odleciały z wrakami (ich kopie są już
   * w magazynach wraków) — tu gasną bez śladu (bez odłamków i liczników zerwań), a ich
   * belki przestają się liczyć. Stan sekcji jak po zagęszczeniu: `beamCount` = żywe belki
   * węzła, `liveBeams`, obszar aktywny od nowa w kolejności indeksów.
   */
  _retireOutsideGroup(body, group) {
    const s = body.nodeStore;
    const active = s.active, adjStart = s.adjStart, adj = s.adj, broken = body.beamStore.broken;
    let stamp = (this._islandStamp + 1) | 0;
    if (stamp <= 0) stamp = 1;
    this._islandStamp = stamp;
    const mark = s.islandStamp;
    for (let k = 0; k < group.length; k++) mark[group[k]] = stamp;
    const views = cachedNodeViews(body);
    for (let i = 0; i < s.count; i++) {
      if (!active[i] || mark[i] === stamp) continue;
      active[i] = 0;
      s.act[i] = 0;
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) broken[adj[q]] = 1;
      // Widok tego węzła należy już do wraku — kadłub dostaje własny (martwy) widok.
      if (views) views[i] = new BeamNodeView(s, i);
    }
    const beamCount = s.beamCount;
    let live = 0;
    for (let k = 0; k < group.length; k++) {
      const i = group[k];
      let n = 0;
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) if (!broken[adj[q]]) n++;
      beamCount[i] = n;
      live += n;
    }
    body.liveBeams = live >> 1;
    // Obszar aktywny i jego listy od nowa (jak dla nowego magazynu); skóra całości do przepisania.
    resetActiveRegion(body);
  },

  // `anchored` — wyspa zakotwiczonego rodzica, która dalej trzyma się kotwicy: osobne ciało
  // zakotwiczone (stoi, bez prędkości i odrzutu), kotwice przechodzą z węzłami (invMass 0).
  _spawnWreck(parent, group, bodies, anchored = false) {
    const cfg = this.config;
    const part = this._partitionBeams(parent, group);
    const info = computeStoreInertia(part.nodeStore, parent.cellSize);
    if (!info) return null;

    const m = this._refreshRot(parent);
    const comW = matVec(m, info.com.x, info.com.y, info.com.z, this._s1);
    const ns = part.nodeStore;
    this._shiftStore(ns, info.com.x, info.com.y, info.com.z);

    let radius = 0;
    for (let i = 0; i < ns.count; i++) {
      const d = Math.sqrt(ns.ox[i] * ns.ox[i] + ns.oy[i] * ns.oy[i] + ns.oz[i] * ns.oz[i]);
      if (d > radius) radius = d;
    }

    const wreck = {
      id: NEXT_BODY_ID++,
      name: `${parent.name}-wrak`,
      pos: { x: parent.pos.x + comW.x, y: parent.pos.y + comW.y, z: parent.pos.z + comW.z },
      vel: anchored ? { x: 0, y: 0, z: 0 } : {
        x: parent.vel.x + (parent.angVel.y * comW.z - parent.angVel.z * comW.y),
        y: parent.vel.y + (parent.angVel.z * comW.x - parent.angVel.x * comW.z),
        z: parent.vel.z + (parent.angVel.x * comW.y - parent.angVel.y * comW.x)
      },
      quat: { ...parent.quat },
      angVel: anchored ? { x: 0, y: 0, z: 0 } : { ...parent.angVel },
      mass: Math.max(1, info.mass),
      invMass: anchored ? 0 : 1 / Math.max(1, info.mass),
      static: false,
      anchored: !!anchored,
      invInertiaLocal: info.invInertia,
      radius: radius + parent.cellSize,
      config: cfg,
      nodeStore: ns,
      beamStore: part.beamStore,
      cellSize: parent.cellSize,
      dims: parent.dims,
      latticeMin: {
        x: parent.latticeMin.x - info.com.x,
        y: parent.latticeMin.y - info.com.y,
        z: parent.latticeMin.z - info.com.z
      },
      skinLatticeMin: { ...parent.skinLatticeMin },
      skin: parent.skin || null,
      spriteSkin: parent.spriteSkin || null,
      activeNodes: ns.count,
      liveBeams: part.liveBeams,
      dead: false,
      isWreck: true,
      noSplit: false,
      rammingMassMult: 1,
      collisionArmor: parent.collisionArmor,
      meshDirty: true,
      structureDirty: false,
      isSleeping: false,
      sleepFrames: 0,
      wakeHold: cfg.wakeHoldFrames,
      _rot: new Float64Array(9),
      _rotTick: -1,
      _grid: createNodeGrid(),
      _hashTick: -1,
      _geomVer: 0,
      _contactCursor: 0,
      _contacts: [],
      _contactDepths: [],
      _integrity: new Int32Array(ns.count),
      _connectivity: null,
      _splitDefer: 0,
      _region: null,
      _lattice: null,
      _maxDisp: parent._maxDisp || 0
    };
    defineLazyViews(wreck, part.nodes, null);
    quatToMat3(wreck.quat, wreck._rot);
    if (!anchored) this._transferFragmentMotion(wreck);
    this._updateRadius(wreck);

    const outLen = Math.sqrt(comW.x * comW.x + comW.y * comW.y + comW.z * comW.z);
    if (outLen > 1e-4 && !anchored) {
      const kick = cfg.wreckOutwardKick;
      wreck.vel.x += (comW.x / outLen) * kick;
      wreck.vel.y += (comW.y / outLen) * kick;
      wreck.vel.z += (comW.z / outLen) * kick;
      const spin = cfg.wreckSpinResponse;
      wreck.angVel.x += (comW.y / outLen) * spin;
      wreck.angVel.y += (comW.z / outLen) * spin;
      wreck.angVel.z += (comW.x / outLen) * spin;
    }

    if (Array.isArray(bodies) && !bodies.includes(wreck)) bodies.push(wreck);
    if (this.onWreck !== null) this.onWreck(parent, wreck);
    return wreck;
  },

  _transferFragmentMotion(body) {
    // Oderwana sekcja dziedziczy także ruch od zgniotu, nie tylko prędkość
    // środka rodzica. Średnią i moment pola prędkości zamieniamy na 6DoF.
    // Tylko żywe węzły: kadłub po rozpadzie w miejscu ma na tablicach węzły odłamów.
    const s = body.nodeStore, count = s.count, mass = s.mass, active = s.active;
    const x = s.x, y = s.y, z = s.z, nvx = s.vx, nvy = s.vy, nvz = s.vz;
    let vx = 0, vy = 0, vz = 0;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < count; i++) {
      if (!active[i]) continue;
      vx += nvx[i] * mass[i]; vy += nvy[i] * mass[i]; vz += nvz[i] * mass[i];
      cx += x[i] * mass[i]; cy += y[i] * mass[i]; cz += z[i] * mass[i];
    }
    vx /= body.mass; vy /= body.mass; vz /= body.mass;
    cx /= body.mass; cy /= body.mass; cz /= body.mass;
    let lx = 0, ly = 0, lz = 0;
    for (let i = 0; i < count; i++) {
      if (!active[i]) continue;
      const rx = x[i] - cx, ry = y[i] - cy, rz = z[i] - cz;
      lx += mass[i] * (ry * (nvz[i] - vz) - rz * (nvy[i] - vy));
      ly += mass[i] * (rz * (nvx[i] - vx) - rx * (nvz[i] - vz));
      lz += mass[i] * (rx * (nvy[i] - vy) - ry * (nvx[i] - vx));
    }
    const I = body.invInertiaLocal;
    let wx = I[0] * lx + I[1] * ly + I[2] * lz;
    let wy = I[3] * lx + I[4] * ly + I[5] * lz;
    let wz = I[6] * lx + I[7] * ly + I[8] * lz;
    const limit = Math.min(1, 6 / (Math.hypot(wx, wy, wz) || 1));
    wx *= limit; wy *= limit; wz *= limit;
    // Ruch wokół rzeczywistego COM przelicz na początek układu fragmentu.
    const v = matVec(body._rot, vx - wy * cz + wz * cy,
      vy - wz * cx + wx * cz, vz - wx * cy + wy * cx, this._s4);
    body.vel.x += v.x; body.vel.y += v.y; body.vel.z += v.z;
    const w = matVec(body._rot, wx, wy, wz, this._s5);
    body.angVel.x += w.x; body.angVel.y += w.y; body.angVel.z += w.z;
    for (let i = 0; i < count; i++) {
      if (!active[i]) continue;
      nvx[i] -= vx + wy * (z[i] - cz) - wz * (y[i] - cy);
      nvy[i] -= vy + wz * (x[i] - cx) - wx * (z[i] - cz);
      nvz[i] -= vz + wx * (y[i] - cy) - wy * (x[i] - cx);
    }
  },

  /** Naprawa: długości spoczynkowe wracają do oryginału, belki się zrastają. */
  repair(bodies, dt) {
    const step = Math.min(1, Math.max(0.001, dt));
    let any = false;
    const local = !!this.config?.localSolver;
    for (const body of bodies) {
      if (!body || body.dead) continue;
      const s = body.nodeStore, e = body.beamStore, active = s.active;
      let changed = false;
      let liveBeams = 0;
      for (let bi = 0; bi < e.count; bi++) {
        // Belka do martwego węzła (albo do węzła, który odleciał z wrakiem) nie wróci —
        // nie ruszamy jej wcale, więc wynik nie zależy od tego, czy magazyn zagęszczono.
        const a = e.a[bi], c = e.b[bi];
        if (!active[a] || !active[c]) continue;
        if (e.fatigue[bi] > 0) { e.fatigue[bi] = Math.max(0, e.fatigue[bi] - step * 2); changed = true; }
        if (e.rest[bi] !== e.restBase[bi]) {
          e.rest[bi] += (e.restBase[bi] - e.rest[bi]) * step * 2;
          if (Math.abs(e.rest[bi] - e.restBase[bi]) < 1e-4) e.rest[bi] = e.restBase[bi];
          changed = true;
        }
        if (e.broken[bi]) { e.broken[bi] = 0; changed = true; }
        liveBeams++;
      }
      body.liveBeams = liveBeams;
      for (let i = 0; i < s.count; i++) {
        if (!active[i]) continue;
        if (local) activateNode(body, i);
        s.x[i] += (s.ox[i] - s.x[i]) * step * 2;
        s.y[i] += (s.oy[i] - s.y[i]) * step * 2;
        s.z[i] += (s.oz[i] - s.z[i]) * step * 2;
        if (s.hp[i] < s.maxHp[i]) { s.hp[i] = Math.min(s.maxHp[i], s.hp[i] + s.maxHp[i] * step); changed = true; }
      }
      body._hashTick = -1;
      this._updateRadius(body);
      if (changed) {
        any = true;
        body.meshDirty = true;
        this.wake(body, this.config.wakeHoldFrames);
      }
    }
    return any;
  }
};

export { BEAM_TYPE };
