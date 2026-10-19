// src/render/snapshotPack.js — pakowanie migawki klatki renderu (docs/PLAN-render-worker.md § 3.2, RW-10).
//
// Strona gry: z obiektów gry i kamer tej klatki pisze stronę potrójnego bufora o układzie `snapshotLayout.js`.
// Pakowanie NIE zmienia stanu gry (warunek RW-10: zrzuty bit w bit z flagą `?szew=inline` i bez): żadnych zapisów
// do encji, ciał ani list; tożsamość obiektów → sloty `renderIds` (Map po stronie pakującego), wersje konfiguracji
// statycznej liczone z tożsamości obiektów źródła (pamięć w tablicach pakującego, bez stempli na obiektach).
//
// Dwie fazy (póki rekordy wież i wejście pyłu hal powstają w przebiegu 3D tej klatki):
//   begin(frame)  — przed aktualizacjami 3D: HEAD, LISTS, ENT, BODY, NODES, NOZZLES, SHOTS, STATIONS, CORES, WORLD;
//   finish(frame) — po updateHexShips3D: pudło cullingu, TURRETS (rekordy Turret2D), HALL, publikacja strony.
// Po RW-26 (wieże po stronie gry) i RW-11c (bloki modułów świata) fazy się zleją.
//
// Reguła bloków zmiennych (NODES): do strony k trafiają ciała zmienione PO ostatniej klatce ODEBRANEJ przez render
// (`frame.lastConsumed`; w trybie `inline` = k − 1), a nie tylko w klatce k — pominięta strona nie gubi zmian.
//
// Pola encji: poziom A (co klatkę) — wszystko, co moduły 3D czytają w każdej klatce (inwentarz RW-10 w
// docs/PLAN-render-worker.md § 4); poziom B (pola konfiguracji ustalane przy narodzinach: strona, profil, wymiary,
// skale gniazd) — przy nowym slocie / generacji i rotacyjnie co `TIER_B_PERIOD` klatek. Encje mają dziesiątki klas
// ukrytych (odczyt megamorficzny), więc każde pole czyta się najwyżej raz na klatkę.
//
// Czysty moduł (bez three, DOM i `window`).

import {
  HEAD, HEAD_FLAG, LIST, ENT, ENT_FLAG, ENT_FLAG2, IMPACT, VENT, BRIDGE_HEAD, BRIDGE_REC, BODY, BODY_FLAG, NOZZLE, SHOT, SHOT_FLAG, TURRET, STATION, CORE,
  WORLD, HALL_WORDS, SNAPSHOT_LAYOUT_VERSION, SNAPSHOT_DEFAULT_CAPACITY, createSnapshotLayout, createSnapshotViews,
  growSnapshotCapacity, bodyNodeF64Words, bodyNodeU8Bytes
} from './snapshotLayout.js';
import { createTripleBuffer, TripleBufferWriter } from './tripleBuffer.js';
import { createRenderIds } from './renderIds.js';
import { describeEntity, describeCore, describeStation } from './describeEntity.js';
import { describeBodyTopology } from './mirrorBody.js';

const EF = ENT.F64, EI = ENT.I32;
const BF = BODY.F64, BI = BODY.I32;
const NF = NOZZLE.F64, NI = NOZZLE.I32;
const SF = SHOT.F64, SI = SHOT.I32;
const TF = TURRET.F64, TI = TURRET.I32;
const STF = STATION.F64, STI = STATION.I32;
const CF = CORE.F64, CI = CORE.I32;
const ES64 = ENT.stride.f64, ESI = ENT.stride.i32;

/** Pamięć poziomu B na slot: Float64 (w, h, skale gniazd, wymiary sprite'a i obrazu) i Int32 (flagi, id, kody). */
const TB_F64 = 11, TB_I32 = 8;

/** Okres odświeżania pól poziomu B (klatki); encja odświeżana, gdy (slot + k) % okres === 0. */
export const TIER_B_PERIOD = 16;

const num = (v) => (typeof v === 'number' ? v : 0);
const raw = (v) => (typeof v === 'number' ? v : NaN);
const EMPTY = Object.freeze([]);
const PACK_LISTS = Object.freeze([LIST.RENDER, LIST.COLD_NEAR, LIST.NPCS, LIST.WRECKS, LIST.COLD, LIST.WORLD_BODIES]);

/** Słownik wartości (napisy, czasem liczby — id encji) → kody 0…n−1; −1 = brak (null / undefined / ''). */
/**
 * Pamięć ostatniego kodu na miejsce (slot encji × pole, indeks rekordu wieży × pole): ta sama wartość co w poprzedniej
 * klatce — kod bez wyszukiwania w słowniku (słownik tylko rośnie, więc kod wartości się nie zmienia).
 */
class CodeCache {
  constructor(dict) { this.dict = dict; this.v = []; this.c = new Int32Array(64); }
  code(i, val) {
    if (i < this.v.length && this.v[i] === val && val !== undefined) return this.c[i];
    const c = this.dict.code(val);
    if (i >= this.c.length) { const n = new Int32Array(Math.max(i + 1, this.c.length * 2)); n.set(this.c); this.c = n; }
    while (this.v.length <= i) this.v.push(undefined);
    this.v[i] = val;
    this.c[i] = c;
    return c;
  }
}

export class SnapshotDict {
  constructor() {
    this.values = [];
    this._map = new Map();
  }
  code(v) {
    if (v === undefined || v === null || v === '') return -1;
    let c = this._map.get(v);
    if (c === undefined) {
      c = this.values.length;
      this.values.push(v);
      this._map.set(v, c);
    }
    return c;
  }
  value(c) {
    return c >= 0 ? this.values[c] : undefined;
  }
}

/** Wejście klatki (jeden obiekt na grę, wypełniany przez `index.html`). */
export function createSnapshotFrame() {
  return {
    frameId: 0, frameDt: 0, alpha: 0, physDt: 0,
    paused: false, worldFrozen: false, split: false, view3d: false, fog: false, skipWorld3D: false,
    sim: 0, simRender: 0, simRenderSim: 0, vfxTime: 0, bridgeTime: 0, wall: 0, wallOrigin: 0,
    W: 0, H: 0, dpr: 1,
    cam: null, camNoShake: null, shakePxX: 0, shakePxY: 0, cam2: null,
    cull: null,                 // pudło cullingu (x, y, halfW, halfH, drawHalfW, drawHalfH) albo null
    interpPose: null,           // window.__interpShipPose
    ship: null, p2: null, npcs: null, wrecks: null, coldWrecks: null, coldRenderList: null, coldNearExtras: true,
    stations: null, bullets: null,
    hides: null,                // SensorSystem.hides (używane tylko przy fog)
    reactorCores: null,         // lista rdzeni albo null — wtedy coresOf
    coresOf: null,              // (listy) → rdzenie (ReactorGame.cores) z list migawki: [gracz, P2], NPC i wraki widoczne, zimne
    sun: null, skyZone: null,
    warp: null, boost: null,
    turretsOf: null,            // faza finish: (encja) → rekordy wież tej klatki (Turret2D.recordsFor) albo null
    turretFrame: null,          // faza finish (RW-26): rekordy klatki { frameCount, recordAt(i) } (Turret2D po syncFrame)
                                // — pierwszeństwo przed turretsOf
    consumeDirty: false,        // lustra (RW-11a): zerować flagi brudu skóry ciał gry po spakowaniu (tylko inline)
    hall: null,                 // faza finish: Float64Array HALL_DUST_IN
    repair: null,               // blok `repair` (blocks/repairBlock.js): RepairSwarm
    cloak: null,                // blok `cloak` (blocks/cloakBlock.js): CLOAK_LOOK_FRAME po stepCloakLooks (RW-26)
    gasObst: null,              // blok `gasObst` (blocks/gasObstBlock.js, RW-11c): wejście przeszkód gazu GAS_OBST_IN
    warpTraffic: null,          // blok `warp` (blocks/warpBlock.js, RW-11c): rejestr ruchu warpa gry (osie przylotów / odlotów)
    warpNurt: null,             // blok `warp`: klatka „Nurtu” (_warpNurtFrame — dt, camFollow, lensAllowed)
    pirateBase: null,           // blok `pirateBase` (blocks/pirateBaseBlock.js, RW-11c): storyBaseFrameState()
    pirateBaseDt: 0,            // blok `pirateBase`: dt gry obrazu bazy (0 w pauzie i scenach fabuły)
    ringWorld: null,            // blok `ring` (blocks/ringBlock.js, RW-11c): świat ringów gry (HaloRingWorld)
    ringShip: null,             // blok `ring`: statek gracza (obrys w hubie hali)
    ringRoof: null,             // blok `ring`: nadpisanie dachu hali przez fabułę
    poseOf: null,               // (encja, out { x, y, a }) → true: poza RENDERU encji inna niż jej pola (RW-31, § 2.6 p. 27 —
                                // holownik pod graczem na pokładzie: ServiceTugGame.renderPoseOf), bez zapisu w encji
    lastConsumed: -1           // k ostatnio odebranej strony (RET.LAST_CONSUMED; inline: k − 1)
  };
}

/**
 * Pakujący migawki: potrójny bufor, sloty, słownik, pamięć wersji. `onLayout(buffer, layout)` — nowy zestaw stron
 * (wzrost pojemności): czytelnik tworzy nowy `TripleBufferReader` z `createSnapshotViews`.
 */
export class SnapshotPacker {
  constructor({ ids = null, ownsIds = null, capacity = SNAPSHOT_DEFAULT_CAPACITY, shared = true, onLayout = null, now = null, describe = false } = {}) {
    this.ids = ids || createRenderIds();
    // Sloty wspólne z rozkazami i RET (RW-21, RW-29): jedna przestrzeń, JEDEN cykl begin / end na klatkę renderu —
    // robi go właściciel instancji (index.html), nie pakujący. Dwa cykle w klatce zwolniłyby sloty widziane tylko
    // w pierwszym. Własna instancja (testy, ids nie podane) — cykl robi pakujący.
    this.ownsIds = ownsIds == null ? !ids : !!ownsIds;
    this.dict = new SnapshotDict();
    this._entCodes = new CodeCache(this.dict);   // slot × 5: model3D, state, phase, stan tarczy, stan maskowania
    this._turCodes = new CodeCache(this.dict);   // rekord wieży × 4: key, uid, weaponId, fxKey
    this.shared = shared;
    this.onLayout = onLayout;
    this.now = now || (typeof performance !== 'undefined' ? () => performance.now() : () => 0);
    this.k = 0;
    this._tFrame = 0;
    this._tPlay = 0;
    this._tGame = 0;
    this._growNext = null;
    this.stats = {
      packs: 0, layoutGrows: 0, ents: 0, bodies: 0, bodiesPacked: 0, nodesPacked: 0, beamsPacked: 0,
      nodeF64Words: 0, nodeU8Bytes: 0, nozzles: 0, shots: 0, turrets: 0, stations: 0, cores: 0, descriptors: 0, topologies: 0,
      beginMs: 0, finishMs: 0, bytes: null
    };
    // pamięć pakującego na slot encji
    this._entPacked = new Int32Array(0);
    this._entGenSeen = new Uint32Array(0);
    this._ver = new Int32Array(0);   // 6 wersji na slot
    this._refVisual = []; this._refHull = []; this._refNozA = []; this._refNozB = []; this._refLights = [];
    this._refBridge = []; this._refShield = []; this._refEngFx = [];
    this._visScale = new Float64Array(0);
    // opisy encji i topologie magazynów (RW-11a): najnowszy na slot + kolejka nowych (worker — postMessage)
    this.describe = describe;
    this.descriptors = [];
    this.descQueue = [];
    this.topologies = [];
    this.topoQueue = [];
    this.coreDescs = new Map();   // uid rdzenia → opis (część statyczna)
    this.coreQueue = [];
    this.stationDescs = [];       // slot stacji → { gen, desc }
    this.stationQueue = [];
    this._resourceSlot = (img) => this.ids.resources.slotOf(img);
    // numery obiektów źródła opisów (tożsamość podobiektów konfiguracji — renderMirror.reconcileDescriptor)
    this._oids = new WeakMap();
    this._oidSeq = 0;
    this._oid = (o) => {
      let id = this._oids.get(o);
      if (id === undefined) { id = ++this._oidSeq; this._oids.set(o, id); }
      return id;
    };
    this._tierB = new Float64Array(0);   // ENT.F64 poziomu B na slot (W, H, HP_SCALE*)
    this._tierBI = new Int32Array(0);    // flagi i kody poziomu B na slot: [flagsB, flags2B, ownerId]
    // pamięć na slot ciała
    this._bodyGenSeen = new Uint32Array(0);   // generacja slotu, dla której pamięć niżej jest ważna
    // brud skóry do potwierdzenia odbioru (worker — `frame.consumeDirty === 'odbior'`): strona z ostatnią wysłaną listą
    // i jej długość, strony zdarzeń „całość” (dirtyAll) i „siatka” (meshDirty) — flaga na każdej stronie do odbioru
    this._dirtySentK = new Int32Array(0);
    this._dirtySentN = new Int32Array(0);
    this._allEventK = new Int32Array(0);
    this._meshEventK = new Int32Array(0);
    this._bodyPacked = new Int32Array(0);
    this._bodyChangedK = new Int32Array(0);
    // ostatnia strona, na którą węzły ciała (i pozycje spoczynkowe) NAPRAWDĘ trafiły — zmiana spoza pudła albo przy
    // braku miejsca na stronie czeka na najbliższą stronę z ciałem w pudle (RW-11a: lustra bez zaległości)
    this._bodyNodesW = new Int32Array(0);
    this._bodyRestW = new Int32Array(0);
    this._bodyHpW = new Int32Array(0);
    // latticeMin ciała z ostatniej strony: przesunięcie początku układu ciała (D._shiftStore przy przebudowie po
    // rozpadzie — bez podbicia shapeVersion) zmienia pozycje spoczynkowe razem z latticeMin
    this._bodyLatMin = new Float64Array(0);
    this._bodyActive = new Int32Array(0);
    this._bodyStoreVer = new Int32Array(0);
    this._bodyShapeVer = new Int32Array(0);
    this._bodyRestK = new Int32Array(0);
    this._bodyHpK = new Int32Array(0);
    this._bodyHpSum = new Float64Array(0);   // 2 na ciało: Σ hp, Σ maxHp
    this._bodyStore = [];
    this._bodyBeams = [];
    this._blocks = [];
    this._blocksDirty = false;
    this._fogR = new Uint8Array(64);     // RENDER: 1 = ukryte mgłą (jedno pytanie na encję w klatce)
    this._poseOut = { x: 0, y: 0, a: 0 };  // poza renderu z frame.poseOf (RW-31: holownik pod graczem)
    this._lists = new Array(LIST.COUNT);
    for (let i = 0; i < LIST.COUNT; i++) this._lists[i] = [];
    this._coreLists = [[null, null], null, null, null];
    // historia klatek (raport RW-10): czas pakowania [ms], węzły i ciała w NODES, bajty zajęte na stronie
    this.hist = { n: 0, ms: new Float64Array(4096), nodes: new Int32Array(4096), bodies: new Int32Array(4096), bytes: new Int32Array(4096) };
    this._setLayout(createSnapshotLayout(capacity, 0));
  }

  /**
   * Blok modułu (RW-11c — wzór pyłu hal: układ w pliku modułu): `{ name, f64, i32, u8, phase: 'begin' | 'finish',
   * pack(block, frame, packer) }` — `block` = { f64, i32, u8 } widoki tej strony (stałe rozmiary bloku). Rejestracja
   * przed pierwszym `begin` albo w biegu (nowy układ stron). Większy blok: `resizeBlock(nazwa, { f64, i32, u8 })`.
   */
  addBlock(def) {
    if (!def || !def.name || typeof def.pack !== 'function') throw new Error('snapshotPack: blok bez nazwy albo pack()');
    if (this._blocks.some((b) => b.name === def.name)) throw new Error(`snapshotPack: blok ${def.name} dwa razy`);
    this._blocks.push({ name: def.name, f64: def.f64 | 0, i32: def.i32 | 0, u8: def.u8 | 0, phase: def.phase || 'begin', pack: def.pack });
    this._regrow(this.layout.cap);
  }

  resizeBlock(name, sizes) {
    const b = this._blocks.find((x) => x.name === name);
    if (!b) return;
    b.f64 = sizes.f64 ?? b.f64; b.i32 = sizes.i32 ?? b.i32; b.u8 = sizes.u8 ?? b.u8;
    this._blocksDirty = true;
  }

  _packBlocks(v, frame, phase) {
    const list = this._blocks;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.phase === phase) b.pack(v.blocks[b.name], frame, this);
    }
  }

  _setLayout(layout) {
    this.layout = layout;
    this.buffer = createTripleBuffer(layout.pageBytes, { shared: this.shared, layoutGen: layout.gen });
    this.writer = new TripleBufferWriter(this.buffer, { views: (buf, off) => createSnapshotViews(buf, off, layout) });
    this.view = this.writer.page;
    if (this.onLayout) this.onLayout(this.buffer, layout);
  }

  _ensureSlotMemory() {
    const ne = this.ids.entities.capacity;
    if (this._entPacked.length < ne) {
      this._entPacked = grow32(this._entPacked, ne);
      const g = new Uint32Array(ne); g.set(this._entGenSeen); this._entGenSeen = g;
      this._ver = grow32(this._ver, ne * 6);
      const vs = new Float64Array(ne * 4); vs.set(this._visScale); this._visScale = vs;
      const b = new Float64Array(ne * TB_F64); b.set(this._tierB); this._tierB = b;
      this._tierBI = grow32(this._tierBI, ne * TB_I32);
    }
    const nb = this.ids.bodies.capacity;
    if (this._bodyPacked.length < nb) {
      const bg = new Uint32Array(nb); bg.set(this._bodyGenSeen); this._bodyGenSeen = bg;
      this._dirtySentK = grow32(this._dirtySentK, nb);
      this._dirtySentN = grow32(this._dirtySentN, nb);
      this._allEventK = grow32(this._allEventK, nb);
      this._meshEventK = grow32(this._meshEventK, nb);
      this._bodyPacked = grow32(this._bodyPacked, nb);
      this._bodyChangedK = grow32(this._bodyChangedK, nb);
      this._bodyNodesW = grow32(this._bodyNodesW, nb);
      this._bodyRestW = grow32(this._bodyRestW, nb);
      this._bodyHpW = grow32(this._bodyHpW, nb);
      const lmn = new Float64Array(nb * 3).fill(NaN); lmn.set(this._bodyLatMin); this._bodyLatMin = lmn;
      this._bodyActive = grow32(this._bodyActive, nb);
      this._bodyStoreVer = grow32(this._bodyStoreVer, nb);
      this._bodyShapeVer = grow32(this._bodyShapeVer, nb);
      this._bodyRestK = grow32(this._bodyRestK, nb);
      this._bodyHpK = grow32(this._bodyHpK, nb);
      const hs = new Float64Array(nb * 2).fill(NaN); hs.set(this._bodyHpSum); this._bodyHpSum = hs;
    }
  }

  /** Faza 1 (przed aktualizacjami 3D). */
  begin(frame) {
    const t0 = this.now();
    if (this._growNext) {
      const next = growSnapshotCapacity(this.layout.cap, this._growNext);
      this._growNext = null;
      if (next !== this.layout.cap) this._regrow(next);
    }
    if (this._blocksDirty) this._regrow(this.layout.cap);
    this.k++;
    const k = this.k;
    // kolejki opisów i topologii: nowe z tej strony (worker — wysyłka między finish a następnym begin)
    this.descQueue.length = 0;
    this.topoQueue.length = 0;
    this.coreQueue.length = 0;
    this.stationQueue.length = 0;
    if (this.ownsIds) this.ids.begin();
    this._buildLists(frame);
    if (frame.coresOf) {
      const cl = this._coreLists, L = this._lists;
      cl[0][0] = frame.ship || null;
      cl[0][1] = frame.p2 || null;
      cl[1] = L[LIST.NPCS_SEEN];
      cl[2] = L[LIST.WRECKS_SEEN];
      cl[3] = L[LIST.COLD_NEAR].length > 0 ? L[LIST.COLD_NEAR] : null;
      frame.reactorCores = frame.coresOf(cl);
    }
    this._ensureCapacity(frame);
    this._ensureSlotMemory();
    const v = this.view;
    this._packHead(v, frame, k);
    this._packLists(v);
    this._packEntities(v, frame, k);
    this._packShots(v, frame);
    this._packStations(v, frame);
    this._packCores(v, frame);
    this._packWorld(v, frame);
    if (this._blocks.length) this._packBlocks(v, frame, 'begin');
    this.stats.beginMs = this.now() - t0;
  }

  /** Faza 2 (po updateHexShips3D): pudło cullingu, wieże, pył hal, publikacja. */
  finish(frame) {
    const t0 = this.now();
    const v = this.view;
    if (frame.cull) writeCull(v.head, frame.cull);
    if (frame.turretFrame) this._packTurretFrame(v, frame.turretFrame);
    else this._packTurrets(v, frame);
    if (frame.hall && frame.hall.length >= HALL_WORDS) v.hall.set(frame.hall.subarray(0, HALL_WORDS));
    else v.hall.fill(0);
    if (this._blocks.length) this._packBlocks(v, frame, 'finish');
    v.world[WORLD.DICT_N] = this.dict.values.length;
    if (this.ownsIds) this.ids.end();
    this.writer.publish();
    this.view = this.writer.page;
    this.stats.packs++;
    this.stats.finishMs = this.now() - t0;
    const hs = this.hist, i = hs.n++ & 4095, st = this.stats;
    hs.ms[i] = st.beginMs + st.finishMs;
    hs.nodes[i] = st.nodesPacked;
    hs.bodies[i] = st.bodiesPacked;
    hs.bytes[i] = HEAD.COUNT * 8 + st.ents * (ENT.stride.f64 * 8 + ENT.stride.i32 * 4) + st.nodeF64Words * 8 + st.nodeU8Bytes +
      st.shots * (SHOT.stride.f64 * 8 + SHOT.stride.i32 * 4);
  }

  /**
   * Bajty bloków ostatnio spakowanej strony (raport RW-10): stałe (HEAD, WORLD, HALL) i zajęte w blokach zmiennych.
   */
  pageReport() {
    const st = this.stats;
    const L = this._lists;
    let listWords = 0;
    for (let i = 0; i < LIST.COUNT; i++) listWords += L[i].length;
    const rec = (r, n) => n * (r.stride.f64 * 8 + r.stride.f32 * 4 + r.stride.i32 * 4 + r.stride.u8);
    const out = {
      head: HEAD.COUNT * 8,
      world: WORLD.COUNT * 8,
      hall: HALL_WORDS * 8,
      lists: (LIST.COUNT + listWords) * 4,
      ent: rec(ENT, st.ents),
      body: rec(BODY, st.bodies),
      nodes: st.nodeF64Words * 8 + st.nodeU8Bytes,
      nozzles: rec(NOZZLE, st.nozzles),
      shots: rec(SHOT, st.shots),
      turrets: rec(TURRET, st.turrets),
      stations: rec(STATION, st.stations),
      cores: rec(CORE, st.cores)
    };
    let total = 0;
    for (const k in out) total += out[k];
    out.total = total;
    out.pageBytes = this.layout.pageBytes;
    return out;
  }

  // ── LISTS ────────────────────────────────────────────────────────────────────────────────────────────────
  _buildLists(f) {
    const L = this._lists;
    for (let i = 0; i < LIST.COUNT; i++) L[i].length = 0;
    const render = L[LIST.RENDER];
    const ship = f.ship;
    if (ship && !ship.dead) render.push(ship);
    const p2 = f.p2;
    if (f.split && p2 && !p2.destroyed) render.push(p2);
    const npcs = f.npcs || EMPTY;
    const rNpc = render.length;
    for (let i = 0; i < npcs.length; i++) { const e = npcs[i]; if (e && !e.dead) render.push(e); }
    const wrecks = f.wrecks || EMPTY;
    const rWreck = render.length;
    for (let i = 0; i < wrecks.length; i++) { const e = wrecks[i]; if (e && !e.dead) render.push(e); }
    const hides = f.fog ? f.hides : null;
    // mgła: jedno pytanie na encję listy RENDER (wynik w _fogR po indeksie) — listy NPCS_SEEN / WRECKS_SEEN i flaga
    // FOG_HIDDEN encji biorą je stąd (żywe NPC i wraki leżą w RENDER w tej samej kolejności)
    if (this._fogR.length < render.length) this._fogR = new Uint8Array(Math.max(render.length, this._fogR.length * 2));
    const fogR = this._fogR;
    const seenR = L[LIST.SEEN];
    for (let i = 0; i < render.length; i++) {
      const e = render[i];
      const h = hides && hides(e) ? 1 : 0;
      fogR[i] = h;
      if (!h) seenR.push(e);
    }
    // zimne wraki z ciałem do rysowania (index.html: withColdNearWrecks — tu bez zapisu _coldExtrasFrame)
    const near = L[LIST.COLD_NEAR];
    const cold = f.coldRenderList || EMPTY;
    if (f.coldNearExtras !== false) {
      for (let i = 0; i < cold.length; i++) {
        const w = cold[i];
        if (!w || !w.isCold || w.dead || !w.beamHull) continue;
        near.push(w);
      }
    }
    const seenCold = L[LIST.SEEN_COLD];
    const seen = L[LIST.SEEN];
    for (let i = 0; i < seen.length; i++) seenCold.push(seen[i]);
    for (let i = 0; i < near.length; i++) seenCold.push(near[i]);
    copyInto(npcs, L[LIST.NPCS]);
    fogIntoCached(npcs, L[LIST.NPCS_SEEN], hides, fogR, rNpc);
    copyInto(wrecks, L[LIST.WRECKS]);
    fogIntoCached(wrecks, L[LIST.WRECKS_SEEN], hides, fogR, rWreck);
    copyInto(f.coldWrecks || EMPTY, L[LIST.COLD]);
    copyInto(f.stations || EMPTY, L[LIST.STATIONS]);
    copyInto(f.worldPieces || EMPTY, L[LIST.WORLD_BODIES]);
  }

  _ensureCapacity(f) {
    const cap = this.layout.cap;
    let listMax = 0, sum = 0;
    for (let i = 0; i < LIST.COUNT; i++) {
      const n = this._lists[i].length;
      if (n > listMax) listMax = n;
      sum += n;
    }
    // sloty encji ≤ suma list (encja w kilku listach ma jeden slot) — highWater po przydziale nie przekroczy
    // highWater + suma
    const need = {
      entities: Math.max(listMax, this.ids.entities.highWater + sum),
      bodies: this.ids.bodies.highWater + sum,
      shots: (f.bullets ? f.bullets.length : 0) + 16,
      stations: (f.stations ? f.stations.length : 0) + 4,
      cores: (f.reactorCores ? f.reactorCores.length : 0) + 8
    };
    const next = growSnapshotCapacity(cap, need);
    if (next !== cap) this._regrow(next);
  }

  _regrow(cap) {
    this.stats.layoutGrows++;
    this._blocksDirty = false;
    this._setLayout(createSnapshotLayout(cap, this.layout ? this.layout.gen + 1 : 0, this._blocks));
  }

  _packLists(v) {
    const L = this._lists;
    const stride = v.listStride;
    const ents = this.ids.entities;
    const out = v.listData;
    for (let l = 0; l < LIST.COUNT; l++) {
      const list = L[l];
      const n = list.length;
      v.listCount[l] = n;
      const base = l * stride;
      for (let i = 0; i < n; i++) out[base + i] = list[i] ? ents.slotOf(list[i]) : -1;
    }
  }

  // ── HEAD ─────────────────────────────────────────────────────────────────────────────────────────────────
  _packHead(v, f, k) {
    const h = v.head;
    h[HEAD.VERSION] = SNAPSHOT_LAYOUT_VERSION;
    h[HEAD.LAYOUT_GEN] = this.layout.gen;
    h[HEAD.K] = k;
    h[HEAD.FRAME_ID] = num(f.frameId);
    const dt = num(f.frameDt);
    this._tFrame += dt;
    if (!f.paused) this._tPlay += dt;
    if (!f.paused && !f.worldFrozen) this._tGame += dt;
    h[HEAD.T_FRAME] = this._tFrame;
    h[HEAD.T_PLAY] = this._tPlay;
    h[HEAD.T_GAME] = this._tGame;
    h[HEAD.FRAME_DT] = raw(f.frameDt);
    h[HEAD.ALPHA] = num(f.alpha);
    h[HEAD.PHYS_DT] = num(f.physDt);
    h[HEAD.SIM] = num(f.sim);
    h[HEAD.SIM_RENDER] = num(f.simRender);
    h[HEAD.SIM_RENDER_SIM] = num(f.simRenderSim);
    h[HEAD.VFX_TIME] = num(f.vfxTime);
    h[HEAD.BRIDGE_TIME] = num(f.bridgeTime);
    h[HEAD.WALL] = num(f.wall);
    h[HEAD.WALL_ORIGIN] = num(f.wallOrigin);
    h[HEAD.W] = num(f.W);
    h[HEAD.H] = num(f.H);
    h[HEAD.DPR] = num(f.dpr) || 1;
    let flags = 0;
    if (f.paused) flags |= HEAD_FLAG.PAUSED;
    if (f.worldFrozen) flags |= HEAD_FLAG.WORLD_FROZEN;
    if (f.split) flags |= HEAD_FLAG.SPLIT;
    if (f.skipWorld3D) flags |= HEAD_FLAG.SKIP_WORLD_3D;
    if (f.view3d) flags |= HEAD_FLAG.VIEW3D;
    if (f.fog) flags |= HEAD_FLAG.FOG;
    h[HEAD.FLAGS] = flags;
    const cam = f.cam;
    h[HEAD.CAM_X] = cam ? raw(cam.x) : NaN;
    h[HEAD.CAM_Y] = cam ? raw(cam.y) : NaN;
    h[HEAD.CAM_ZOOM] = cam ? raw(cam.zoom) : NaN;
    const ns = f.camNoShake;
    h[HEAD.CAMNS_X] = ns ? raw(ns.x) : NaN;
    h[HEAD.CAMNS_Y] = ns ? raw(ns.y) : NaN;
    h[HEAD.CAMNS_ZOOM] = ns ? raw(ns.zoom) : NaN;
    h[HEAD.SHAKE_PX_X] = num(f.shakePxX);
    h[HEAD.SHAKE_PX_Y] = num(f.shakePxY);
    const free = !!(cam && cam.mode === 'free3d' && cam.position && cam.quaternion);
    h[HEAD.CAM_MODE] = free ? 1 : 0;
    if (free) {
      const p = cam.position, q = cam.quaternion;
      h[HEAD.CAM_POS_X] = p.x; h[HEAD.CAM_POS_Y] = p.y; h[HEAD.CAM_POS_Z] = p.z;
      h[HEAD.CAM_QX] = q.x; h[HEAD.CAM_QY] = q.y; h[HEAD.CAM_QZ] = q.z; h[HEAD.CAM_QW] = q.w;
      h[HEAD.CAM_FOV] = raw(cam.fov); h[HEAD.CAM_NEAR] = raw(cam.near); h[HEAD.CAM_FAR] = raw(cam.far);
      h[HEAD.CAM_VIEW_DIST] = raw(cam.viewDistance);
    } else {
      for (let i = HEAD.CAM_POS_X; i <= HEAD.CAM_VIEW_DIST; i++) h[i] = 0;
    }
    const c2 = f.cam2;
    h[HEAD.CAM2_ON] = c2 ? 1 : 0;
    h[HEAD.CAM2_X] = c2 ? raw(c2.x) : 0;
    h[HEAD.CAM2_Y] = c2 ? raw(c2.y) : 0;
    h[HEAD.CAM2_ZOOM] = c2 ? raw(c2.zoom) : 1;
    if (f.cull) writeCull(h, f.cull);
    else for (let i = HEAD.CULL_X; i <= HEAD.CULL_DRAW_HALF_H; i++) h[i] = 0;
    const ents = this.ids.entities;
    const ship = f.ship, p2 = f.p2;
    const ps = ship ? ents.slotOf(ship) : -1;
    h[HEAD.PLAYER_SLOT] = ps;
    h[HEAD.PLAYER_GEN] = ps >= 0 ? ents.gen(ps) : 0;
    const p2s = (p2 && f.split) ? ents.slotOf(p2) : -1;
    h[HEAD.P2_SLOT] = p2s;
    h[HEAD.P2_GEN] = p2s >= 0 ? ents.gen(p2s) : 0;
    const ip = f.interpPose;
    h[HEAD.INTERP_X] = ip ? raw(ip.x) : NaN;
    h[HEAD.INTERP_Y] = ip ? raw(ip.y) : NaN;
    h[HEAD.INTERP_ANGLE] = ip ? raw(ip.angle) : NaN;
    h[HEAD.EVENT_LAST] = 0;
  }

  // ── ENT, BODY, NODES, NOZZLES ───────────────────────────────────────────────────────────────────────────
  _packEntities(v, f, k) {
    const ents = this.ids.entities;
    const L = this._lists;
    const st = this.stats;
    st.ents = 0; st.bodies = 0; st.bodiesPacked = 0; st.nodesPacked = 0; st.beamsPacked = 0; st.nozzles = 0;
    this._nodeF64 = 0; this._nodeU8 = 0; this._nodeI32 = 0; this._noz = 0; this._imp = 0; this._br = 0;
    const hides = f.fog ? f.hides : null;
    const ship = f.ship, p2 = f.p2;
    // kolejność: listy źródłowe po kolei, encja pakowana raz (pierwsze wystąpienie) — listy pochodne (SEEN ⊂ RENDER,
    // SEEN_COLD ⊂ RENDER ∪ COLD_NEAR, NPCS_SEEN ⊂ NPCS, WRECKS_SEEN ⊂ WRECKS) nie wnoszą nowych encji, a kolejność
    // pierwszych wystąpień (sloty) jest ta sama co w przeglądzie wszystkich list; stacje mają własny blok
    const fogR = this._fogR;
    for (let q = 0; q < PACK_LISTS.length; q++) {
      const list = L[PACK_LISTS[q]];
      const inRender = PACK_LISTS[q] === LIST.RENDER;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e) continue;
        const s = ents.slotOf(e);
        if (this._entPacked[s] === k) continue;
        this._entPacked[s] = k;
        const fogHidden = inRender ? fogR[i] === 1 : !!(hides && hides(e));
        this._packEntity(v, e, s, k, f, fogHidden, e === ship, e === p2);
        st.ents++;
      }
    }
    const h = v.head;
    h[HEAD.N_ENT] = ents.highWater;
    h[HEAD.N_BODY] = this.ids.bodies.highWater;
    h[HEAD.N_NOZZLES] = this._noz;
    h[HEAD.NODE_F64_USED] = this._nodeF64;
    h[HEAD.NODE_U8_USED] = this._nodeU8;
    h[HEAD.N_BODIES_PACKED] = st.bodiesPacked;
    h[HEAD.N_NODES_PACKED] = st.nodesPacked;
    st.nodeF64Words = this._nodeF64;
    st.nodeU8Bytes = this._nodeU8;
  }

  _packEntity(v, e, s, k, f, fogHidden, isPlayer, isP2) {
    const ents = this.ids.entities;
    const f64 = v.entF64, i32 = v.entI32;
    const b = s * ES64, bi = s * ESI;
    const gen = ents.gen(s);
    // ── poziom B: przy nowym właścicielu slotu i rotacyjnie ──
    if (this._entGenSeen[s] !== gen || ((s + k) % TIER_B_PERIOD) === 0) {
      this._entGenSeen[s] = gen;
      this._tierBRead(e, s);
    }
    const tb = s * TB_F64, tbi = s * TB_I32;
    // ── poziom A: pola encji czytane co klatkę, każde raz ──
    const pos = e.pos, vel = e.vel;
    f64[b + EF.X] = raw(e.x);
    f64[b + EF.Y] = raw(e.y);
    f64[b + EF.POS_X] = pos ? raw(pos.x) : NaN;
    f64[b + EF.POS_Y] = pos ? raw(pos.y) : NaN;
    f64[b + EF.ANGLE] = raw(e.angle);
    f64[b + EF.VX] = raw(e.vx);
    f64[b + EF.VY] = raw(e.vy);
    f64[b + EF.VEL_X] = vel ? raw(vel.x) : NaN;
    f64[b + EF.VEL_Y] = vel ? raw(vel.y) : NaN;
    f64[b + EF.ANG_VEL] = raw(e.angVel);
    f64[b + EF.ANGULAR_VELOCITY] = raw(e.angularVelocity);
    const poseOf = f.poseOf;
    if (poseOf && poseOf(e, this._poseOut)) {
      const p = this._poseOut;
      f64[b + EF.X] = p.x; f64[b + EF.Y] = p.y; f64[b + EF.ANGLE] = p.a;
      if (pos) { f64[b + EF.POS_X] = p.x; f64[b + EF.POS_Y] = p.y; }
    }
    f64[b + EF.Z] = raw(e.z);
    f64[b + EF.RADIUS] = raw(e.radius);
    f64[b + EF.R] = raw(e.r);
    f64[b + EF.SKIN_Z] = raw(e.__skinZ);
    f64[b + EF.RENDER_SCALE] = raw(e.__renderScale);
    const tB = this._tierB;
    f64[b + EF.W] = tB[tb]; f64[b + EF.H] = tB[tb + 1];
    f64[b + EF.HP_SCALE] = tB[tb + 2]; f64[b + EF.HP_SCALE_X] = tB[tb + 3]; f64[b + EF.HP_SCALE_Y] = tB[tb + 4];
    f64[b + EF.SPRITE_W] = tB[tb + 5]; f64[b + EF.SPRITE_H] = tB[tb + 6];
    f64[b + EF.RS_W] = tB[tb + 7]; f64[b + EF.RS_H] = tB[tb + 8]; f64[b + EF.RS_NW] = tB[tb + 9]; f64[b + EF.RS_NH] = tB[tb + 10];
    const tBI = this._tierBI;
    i32[bi + EI.WEAPON_TIER] = tBI[tbi + 3]; i32[bi + EI.FACTION] = tBI[tbi + 4]; i32[bi + EI.FACTION_ID] = tBI[tbi + 5];
    i32[bi + EI.HULL_ID] = tBI[tbi + 6]; i32[bi + EI.SHIP_ID] = tBI[tbi + 7];
    const ec = this._entCodes, ecb = s * 5;
    i32[bi + EI.MODEL3D] = ec.code(ecb, e.model3DProfileId);
    let flags = this._tierBI[tbi] | (pos ? ENT_FLAG.HAS_POS : 0) | (vel ? ENT_FLAG.HAS_VEL : 0);
    let flags2 = this._tierBI[tbi + 1];
    if (e.dead) flags |= ENT_FLAG.DEAD;
    if (isPlayer) flags |= ENT_FLAG.PLAYER;
    if (isP2) flags |= ENT_FLAG.P2;
    if (fogHidden) flags |= ENT_FLAG.FOG_HIDDEN;
    if (e.isBridgeHulk) flags |= ENT_FLAG.BRIDGE_HULK;
    if (e.lightsOff) flags |= ENT_FLAG.LIGHTS_OFF;
    if (e.roadLightsOff) flags |= ENT_FLAG.ROAD_LIGHTS_OFF;
    if (e.isCold) flags |= ENT_FLAG.COLD;
    if (e.friendly) flags |= ENT_FLAG.FRIENDLY;
    if (e.hideHexVisual) flags |= ENT_FLAG.HIDE_HEX;
    if (e.__lightsHidden === true) flags |= ENT_FLAG.LIGHTS_HIDDEN;
    if (e.__enginesHidden === true) flags |= ENT_FLAG.ENGINES_HIDDEN;
    if (e.__turretsHidden === true) flags |= ENT_FLAG.TURRETS_HIDDEN;
    if (e.__editorBoost === true) flags |= ENT_FLAG.EDITOR_BOOST;
    if (e.__fSysBoost === true) flags |= ENT_FLAG.FSYS_BOOST;
    if (e.__warpPreview === true) flags |= ENT_FLAG.WARP_PREVIEW;
    if (e.fighter) flags2 |= ENT_FLAG2.FIGHTER;
    if (e._shieldForcedOff) flags2 |= ENT_FLAG2.SH_FORCED_OFF;
    i32[bi + EI.STATE] = ec.code(ecb + 1, e.state);
    i32[bi + EI.PHASE] = ec.code(ecb + 2, e.phase);
    i32[bi + EI.OWNER_ID] = this._tierBI[tbi + 2];
    // napęd i silniki
    const ti = e.thrusterInput;
    f64[b + EF.TI_MAIN] = ti ? raw(ti.main) : NaN;
    f64[b + EF.TI_LEFT] = ti ? raw(ti.leftSide) : NaN;
    f64[b + EF.TI_RIGHT] = ti ? raw(ti.rightSide) : NaN;
    f64[b + EF.TI_TORQUE] = ti ? raw(ti.torque) : NaN;
    const inp = e.input;
    f64[b + EF.IN_MAIN] = inp ? raw(inp.main) : NaN;
    f64[b + EF.IN_THRUST_Y] = inp ? raw(inp.thrustY) : NaN;
    const ign = e.engineIgn;
    if (ign) {
      i32[bi + EI.IGN_STATE] = num(ign.state) | 0;
      f64[b + EF.IGN_T] = raw(ign.t);
      if (ign.hot) flags |= ENT_FLAG.IGN_HOT;
    } else {
      i32[bi + EI.IGN_STATE] = -1;
      f64[b + EF.IGN_T] = NaN;
    }
    // tarcza
    const sh = e.shield;
    if (sh) {
      flags |= ENT_FLAG.HAS_SHIELD;
      f64[b + EF.SH_MAX] = raw(sh.max);
      f64[b + EF.SH_VAL] = raw(sh.val);
      f64[b + EF.SH_ACT] = raw(sh.activationProgress);
      f64[b + EF.SH_HARD] = raw(sh.hardness);
      // shield.show to w grze flaga (tryb TARCZE: `!!tune.shieldShow`) — raw() zrobiłby z true NaN i worker nie pokazywał
      // tarczy (2026-10-17); flaga jako 1 / 0, liczba bez zmian
      f64[b + EF.SH_SHOW] = typeof sh.show === 'boolean' ? (sh.show ? 1 : 0) : raw(sh.show);
      i32[bi + EI.SH_STATE] = ec.code(ecb + 3, sh.state);
      if (sh.forceOff) flags2 |= ENT_FLAG2.SH_FORCE_OFF;
      const imp = sh.impacts;
      i32[bi + EI.SH_IMPACT_ID] = imp && imp.length ? (num(imp[0].id) | 0) : 0;
      this._packImpacts(v, imp, bi);
    } else {
      f64[b + EF.SH_MAX] = NaN; f64[b + EF.SH_VAL] = NaN; f64[b + EF.SH_ACT] = NaN;
      f64[b + EF.SH_HARD] = NaN; f64[b + EF.SH_SHOW] = NaN;
      i32[bi + EI.SH_STATE] = -1; i32[bi + EI.SH_IMPACT_ID] = 0;
      i32[bi + EI.IMP_OFF] = -1; i32[bi + EI.IMP_N] = 0;
    }
    // maskowanie (stan gry)
    const ck = e.cloak;
    if (ck) {
      flags |= ENT_FLAG.HAS_CLOAK;
      f64[b + EF.CLOAK_LEVEL] = raw(ck.level);
      f64[b + EF.CLOAK_ENERGY] = raw(ck.energy);
      i32[bi + EI.CLOAK_STATE] = ec.code(ecb + 4, ck.state);
      const lb = ck.lastBreak;
      i32[bi + EI.CLOAK_BREAK] = lb ? this._breakSerial(lb) : 0;
      if (lb && lb.forced) flags2 |= ENT_FLAG2.CLOAK_FORCED;
    } else {
      f64[b + EF.CLOAK_LEVEL] = NaN; f64[b + EF.CLOAK_ENERGY] = NaN;
      i32[bi + EI.CLOAK_STATE] = -1; i32[bi + EI.CLOAK_BREAK] = 0;
    }
    // zimny wrak: smuga z migawki i ród (orphany mostków 3D)
    const cs = (flags & ENT_FLAG.COLD) !== 0 ? e._coldSnapshot : null;
    if (cs) {
      flags2 |= ENT_FLAG2.HAS_COLD_SNAP;
      i32[bi + EI.COLD_KIND] = this.dict.code(cs.kind);
      const ch = cs.hull;
      i32[bi + EI.COLD_DMG_KEY] = ch ? this.dict.code(ch.dmgKey) : -1;
      const im = cs.impostor;
      if (im) {
        f64[b + EF.CI_X] = raw(im.x); f64[b + EF.CI_Y] = raw(im.y); f64[b + EF.CI_ROT] = raw(im.rot);
        f64[b + EF.CI_HALF_W] = raw(im.halfW); f64[b + EF.CI_HALF_H] = raw(im.halfH);
        f64[b + EF.CI_R] = raw(im.r); f64[b + EF.CI_G] = raw(im.g); f64[b + EF.CI_B] = raw(im.b);
        f64[b + EF.CI_WX] = raw(im.wx); f64[b + EF.CI_WY] = raw(im.wy); f64[b + EF.CI_REACH] = raw(im.reach);
        f64[b + EF.CI_OPACITY] = raw(im.opacity);
      } else f64[b + EF.CI_X] = NaN;
    } else {
      i32[bi + EI.COLD_KIND] = -1; i32[bi + EI.COLD_DMG_KEY] = -1;
    }
    i32[bi + EI.SLOT] = s;
    i32[bi + EI.GEN] = gen;
    // wersje konfiguracji statycznej (tożsamość obiektów źródła)
    const vb = s * 6;
    const ver = this._ver;
    const visual = e.visual;
    // `visual` zmienia klucze bez zmiany tożsamości (podmiana tablic dysz, engineFx, spriteScale — index.html,
    // npcHardpointRuntime.js): wersja z tożsamości obiektu, jego tablic i engineFx oraz skal sprite'a.
    const vEngFx = visual ? visual.engineFx : undefined;
    const vsc = this._visScale, vo = s * 4;
    const sc0 = visual ? raw(visual.spriteScale) : NaN, sc1 = visual ? raw(visual.spriteScaleX) : NaN;
    const sc2 = visual ? raw(visual.spriteScaleY) : NaN, sc3 = visual ? raw(visual.spriteRotation) : NaN;
    if (this._refVisual[s] !== visual || this._refEngFx[s] !== vEngFx ||
        !sameNum(vsc[vo], sc0) || !sameNum(vsc[vo + 1], sc1) || !sameNum(vsc[vo + 2], sc2) || !sameNum(vsc[vo + 3], sc3)) {
      this._refVisual[s] = visual; this._refEngFx[s] = vEngFx;
      vsc[vo] = sc0; vsc[vo + 1] = sc1; vsc[vo + 2] = sc2; vsc[vo + 3] = sc3;
      ver[vb]++;
    }
    const hull = e.beamHull;
    if (this._refHull[s] !== hull) { this._refHull[s] = hull; ver[vb + 1]++; }
    let nozA = visual ? visual.mainThrusters : undefined;
    const nozB = visual ? visual.torqueThrusters : undefined;
    let mainKind = 0;
    if (!nozA || !nozA.length) {
      const eng = e.engines;
      if (eng && eng.main) { nozA = eng.main; mainKind = 2; }
    }
    if (this._refNozA[s] !== nozA || this._refNozB[s] !== nozB) {
      this._refNozA[s] = nozA; this._refNozB[s] = nozB; ver[vb + 2]++;
    }
    const lights = e.editorLights;
    if (this._refLights[s] !== lights) { this._refLights[s] = lights; ver[vb + 3]++; }
    const bridge = e.bridgeState;
    if (this._refBridge[s] !== bridge) { this._refBridge[s] = bridge; ver[vb + 4]++; }
    this._packBridge(v, bridge, bi);
    if (this._refShield[s] !== sh) { this._refShield[s] = sh; ver[vb + 5]++; }
    i32[bi + EI.V_VISUAL] = ver[vb];
    i32[bi + EI.V_HULL] = ver[vb + 1];
    i32[bi + EI.V_NOZZLES] = ver[vb + 2];
    i32[bi + EI.V_LIGHTS] = ver[vb + 3];
    i32[bi + EI.V_BRIDGE] = ver[vb + 4];
    i32[bi + EI.V_SHIELD] = ver[vb + 5];
    // opis encji (konfiguracja statyczna, biała lista) przy zmianie którejkolwiek wersji albo generacji slotu
    if (this.describe) {
      const d = this.descriptors[s];
      if (!d || d.gen !== gen || !sameVers(d.vers, ver, vb)) {
        const desc = describeEntity(e, this._resourceSlot, this._oid);
        const rec = d && d.gen === gen ? d : { gen, vers: new Int32Array(6), desc: null, res: new Int32Array(3) };
        for (let q = 0; q < 6; q++) rec.vers[q] = ver[vb + q];
        rec.desc = desc;
        const dh = desc.hull;
        rec.res[0] = dh ? dh.image : -1; rec.res[1] = dh ? dh.visualImage : -1; rec.res[2] = dh ? dh.normalMapImage : -1;
        this.descriptors[s] = rec;
        this.descQueue.push(s);
        this.stats.descriptors++;
      } else {
        // obrazy opisu żyją, dopóki żyje encja (zasoby zwalniane po `retain` klatkach bez odwołania)
        const res = this.ids.resources, r = d.res;
        if (r[0] >= 0) res.touch(r[0]);
        if (r[1] >= 0) res.touch(r[1]);
        if (r[2] >= 0) res.touch(r[2]);
      }
    }
    // dysze
    i32[bi + EI.NOZ_OFF] = this._noz;
    let nn = 0;
    if (mainKind === 2) nn += this._packNozzleOne(v, nozA, 2);
    else nn += this._packNozzles(v, nozA, 0);
    nn += this._packNozzles(v, nozB, 1);
    i32[bi + EI.NOZ_N] = nn;
    // ciało belek
    const body = hull ? hull.body : null;
    if (body) {
      const bs = this.ids.bodies.slotOf(body);
      i32[bi + EI.BODY_SLOT] = bs;
      i32[bi + EI.BODY_GEN] = this.ids.bodies.gen(bs);
      if (body.isSleeping) flags2 |= ENT_FLAG2.SLEEPING;
      if (this._bodyPacked[bs] !== k) {
        this._bodyPacked[bs] = k;
        const px = f64[b + EF.POS_X];
        this._packBody(v, body, hull, bs, s, k, f, px === px ? px : f64[b + EF.X], px === px ? f64[b + EF.POS_Y] : f64[b + EF.Y], !!bridge);
      }
    } else {
      i32[bi + EI.BODY_SLOT] = -1;
      i32[bi + EI.BODY_GEN] = 0;
    }
    i32[bi + EI.FLAGS] = flags;
    i32[bi + EI.FLAGS2] = flags2;
  }

  _tierBRead(e, s) {
    const tb = s * TB_F64, tbi = s * TB_I32;
    const B = this._tierB;
    B[tb] = raw(e.w);
    B[tb + 1] = raw(e.h);
    B[tb + 2] = raw(e.__hardpointScale);
    B[tb + 3] = raw(e.__hardpointScaleX);
    B[tb + 4] = raw(e.__hardpointScaleY);
    B[tb + 5] = raw(e.spriteW);
    B[tb + 6] = raw(e.spriteH);
    const rs = e.renderSpriteImage;
    B[tb + 7] = rs ? raw(rs.width) : NaN;
    B[tb + 8] = rs ? raw(rs.height) : NaN;
    B[tb + 9] = rs ? raw(rs.naturalWidth) : NaN;
    B[tb + 10] = rs ? raw(rs.naturalHeight) : NaN;
    const dict = this.dict, BI_ = this._tierBI;
    BI_[tbi + 3] = dict.code(e.weaponTier);
    BI_[tbi + 4] = dict.code(e.faction);
    BI_[tbi + 5] = dict.code(e.factionId);
    BI_[tbi + 6] = dict.code(e.__hullId);
    BI_[tbi + 7] = dict.code(e.shipId);
    let fl = 0, fl2 = 0;
    if (e.isWreck) fl |= ENT_FLAG.WRECK;
    if (e.isFragment) fl |= ENT_FLAG.FRAGMENT;
    if (e.isPirate) fl |= ENT_FLAG.PIRATE;
    if (e.isRingSegment) fl |= ENT_FLAG.RING_SEGMENT;
    if (e.isPlayer) fl2 |= ENT_FLAG2.IS_PLAYER_FIELD;
    if (e.isCapitalShip) fl2 |= ENT_FLAG2.CAPITAL;
    if (rs) fl2 |= ENT_FLAG2.HAS_RS;
    this._tierBI[tbi] = fl;
    this._tierBI[tbi + 1] = fl2;
    this._tierBI[tbi + 2] = this.dict.code(e.id || e.uid || e.name);
  }

  _packImpacts(v, imp, bi) {
    const i32 = v.entI32;
    const n = imp ? imp.length : 0;
    if (n === 0) { i32[bi + EI.IMP_OFF] = -1; i32[bi + EI.IMP_N] = 0; return; }
    const cap = this.layout.cap.impacts;
    if (this._imp + n > cap) {
      this._requestGrow('impacts', (this._imp + n) * 2);
      i32[bi + EI.IMP_OFF] = -1; i32[bi + EI.IMP_N] = 0;
      return;
    }
    const F = v.impF64, dict = this.dict;
    let o = this._imp * IMPACT.STRIDE;
    for (let j = 0; j < n; j++, o += IMPACT.STRIDE) {
      const t = imp[j];
      F[o + IMPACT.ID] = raw(t.id);
      F[o + IMPACT.GRID_ANGLE] = raw(t.gridAngle);
      F[o + IMPACT.DAMAGE] = raw(t.damage);
      F[o + IMPACT.INTENSITY] = raw(t.intensity);
      F[o + IMPACT.FX_CLASS] = dict.code(t.fxClass);
    }
    i32[bi + EI.IMP_OFF] = this._imp;
    i32[bi + EI.IMP_N] = n;
    this._imp += n;
  }

  _packBridge(v, st, bi) {
    const i32 = v.entI32;
    const list = st ? st.bridges : null;
    if (!st || !Array.isArray(list)) { i32[bi + EI.BR_OFF] = -1; i32[bi + EI.BR_N] = 0; return; }
    const n = list.length;
    const words = BRIDGE_HEAD.STRIDE + n * BRIDGE_REC.STRIDE;
    if (this._br + words > this.layout.cap.bridgeWords) {
      this._requestGrow('bridgeWords', (this._br + words) * 2);
      i32[bi + EI.BR_OFF] = -1; i32[bi + EI.BR_N] = 0;
      return;
    }
    const F = v.brF64;
    const o = this._br;
    F[o + BRIDGE_HEAD.CMD_LOST] = st.commandLost ? 1 : 0;
    F[o + BRIDGE_HEAD.CMD_LOST_AT] = raw(st.commandLostAt);
    this._writeVent(F, o + BRIDGE_HEAD.VENT, st.vent);
    let p = o + BRIDGE_HEAD.STRIDE;
    for (let j = 0; j < n; j++, p += BRIDGE_REC.STRIDE) {
      const br = list[j];
      F[p + BRIDGE_REC.DEAD] = br && br.dead ? 1 : 0;
      F[p + BRIDGE_REC.DEAD_AT] = br ? raw(br.deadAt) : NaN;
      F[p + BRIDGE_REC.MISSING] = br && br.missing ? 1 : 0;
      this._writeVent(F, p + BRIDGE_REC.VENT, br ? br.vent : null);
    }
    i32[bi + EI.BR_OFF] = o;
    i32[bi + EI.BR_N] = n;
    this._br = o + words;
  }

  _writeVent(F, o, vent) {
    if (!vent) { F[o + VENT.ID] = 0; return; }
    if (!this._ventIds) { this._ventIds = new WeakMap(); this._ventSeq = 0; }
    let id = this._ventIds.get(vent);
    if (id === undefined) { id = ++this._ventSeq; this._ventIds.set(vent, id); }
    F[o + VENT.ID] = id;
    F[o + VENT.X] = raw(vent.x); F[o + VENT.Y] = raw(vent.y);
    F[o + VENT.DIRX] = raw(vent.dirX); F[o + VENT.DIRY] = raw(vent.dirY);
    F[o + VENT.EXITX] = raw(vent.exitX); F[o + VENT.EXITY] = raw(vent.exitY);
    F[o + VENT.BID] = this.dict.code(vent.bridgeId);
  }

  _breakSerial(obj) {
    // `cloak.lastBreak` porównywany po TOŻSAMOŚCI (cloakLook.js) — numer kolejnego obiektu zerwania
    if (obj === this._lastBreakObj) return this._lastBreakId;
    if (!this._breakIds) this._breakIds = new WeakMap();
    let id = this._breakIds.get(obj);
    if (id === undefined) {
      this._breakSeq = (this._breakSeq || 0) + 1;
      id = this._breakSeq;
      this._breakIds.set(obj, id);
    }
    this._lastBreakObj = obj;
    this._lastBreakId = id;
    return id;
  }

  _packNozzles(v, list, kind) {
    if (!list || !list.length) return 0;
    const n = list.length;
    if (this._noz + n > this.layout.cap.nozzles) {
      this._requestGrow('nozzles', (this._noz + n) * 2);
      return 0;
    }
    for (let i = 0; i < n; i++) this._writeNozzle(v, this._noz++, list[i], kind);
    this.stats.nozzles += n;
    return n;
  }

  _packNozzleOne(v, t, kind) {
    if (this._noz + 1 > this.layout.cap.nozzles) {
      this._requestGrow('nozzles', (this._noz + 1) * 2);
      return 0;
    }
    this._writeNozzle(v, this._noz++, t, kind);
    this.stats.nozzles++;
    return 1;
  }

  _writeNozzle(v, o, t, kind) {
    const f64 = v.nozF64, i32 = v.nozI32;
    const b = o * NOZZLE.stride.f64, bi = o * NOZZLE.stride.i32;
    i32[bi + NI.KIND] = kind;
    if (!t) {
      for (let j = 0; j < NOZZLE.stride.f64; j++) f64[b + j] = NaN;
      i32[bi + NI.FLAGS] = 2;
      return;
    }
    f64[b + NF.THROTTLE] = raw(t.__throttle);
    f64[b + NF.VFX_SCALE] = raw(t.vfxScale);
    f64[b + NF.NOZZLE_DEG] = raw(t.nozzleDeg);
    f64[b + NF.BASE_DEG] = raw(t.baseDeg);
    f64[b + NF.GIMBAL_MIN] = raw(t.gimbalMinDeg);
    f64[b + NF.GIMBAL_MAX] = raw(t.gimbalMaxDeg);
    i32[bi + NI.FLAGS] = t.__destroyed ? 1 : 0;
  }

  _requestGrow(key, n) {
    if (!this._growNext) this._growNext = {};
    if (!(this._growNext[key] >= n)) this._growNext[key] = n;
  }

  _packBody(v, body, hull, bs, es, k, f, ex, ey, wantHp) {
    const f64 = v.bodyF64, i32 = v.bodyI32;
    const b = bs * BODY.stride.f64, bi = bs * BODY.stride.i32;
    const st = this.stats;
    st.bodies++;
    const store = body.nodeStore;
    const beams = body.beamStore;
    let changed = false;
    // Nowy właściciel slotu (generacja): ciało, którego przez klatkę nie było w listach (okręt zginął, wrak z tym samym
    // ciałem powstaje krok później — detonacja rdzenia w następnym kroku), wraca z nową generacją i u czytelnika
    // dostaje NOWE lustro, bez topologii. Pamięć slotu od zera: topologia, węzły, spoczynek i HP jak dla nowego
    // magazynu. Dawniej ten sam magazyn = brak topologii dla nowej generacji: lustro bez węzłów (wrak niewidoczny),
    // a mostki 3D w workerze rzucały wyjątek co klatkę i obraz stawał (audyt 2026-10-17).
    const gen = this.ids.bodies.gen(bs);
    if (this._bodyGenSeen[bs] !== gen) {
      this._bodyGenSeen[bs] = gen;
      this._bodyStore[bs] = null;
      this._bodyBeams[bs] = null;
    }
    if (this._bodyStore[bs] !== store || this._bodyBeams[bs] !== beams) {
      this._bodyStore[bs] = store;
      this._bodyBeams[bs] = beams;
      this._dirtySentK[bs] = 0; this._dirtySentN[bs] = 0; this._allEventK[bs] = 0; this._meshEventK[bs] = 0;
      this._bodyStoreVer[bs]++;
      changed = true;
      this._bodyRestK[bs] = k;
      this._bodyShapeVer[bs] = store ? store.shapeVersion | 0 : 0;
      this._bodyHpSum[bs * 2] = NaN;   // nowa replika — HP do wysłania
      if (this.describe && store) {
        this.topologies[bs] = { gen: this.ids.bodies.gen(bs), storeVer: this._bodyStoreVer[bs], topo: describeBodyTopology(body) };
        this.topoQueue.push(bs);
        this.stats.topologies++;
      }
    } else if (store && (store.shapeVersion | 0) !== this._bodyShapeVer[bs]) {
      // przesunięcie początku ciała (shiftBodyOrigin) albo zapis przez widok węzła — pozycje spoczynkowe do wysłania
      this._bodyShapeVer[bs] = store.shapeVersion | 0;
      this._bodyRestK[bs] = k;
      changed = true;
    }
    const lmb = body.latticeMin;
    if (lmb) {
      const L = this._bodyLatMin, o3 = bs * 3;
      const lx = +lmb.x || 0, ly = +lmb.y || 0, lz = +lmb.z || 0;   // pole nieobecne = 0 (porównanie bez NaN)
      if (L[o3] !== lx || L[o3 + 1] !== ly || L[o3 + 2] !== lz) {
        // pierwsza strona ciała (NaN) albo przesunięty początek układu — pozycje spoczynkowe do wysłania
        if (L[o3] === L[o3]) { this._bodyRestK[bs] = k; changed = true; }
        L[o3] = lx; L[o3 + 1] = ly; L[o3 + 2] = lz;
      }
    }
    const active = body.activeNodes | 0;
    if (this._bodyActive[bs] !== active) { this._bodyActive[bs] = active; changed = true; }
    const region = body._region;
    const ownRegion = !!region && region.store === store;
    // Worker (strony bywają pominięte — worker bierze najnowszą): brud skóry zdejmowany po stronie gry dopiero, gdy
    // render ODEBRAŁ stronę, która go niosła; do tego czasu każda strona niesie całą narosłą listę i flagi. Dawniej lista
    // wychodziła raz — pominięta strona = węzły bez numerów na liście, czworokąty skóry nieprzepisane (audyt 2026-10-17).
    const confirm = f.consumeDirty === 'odbior';
    let meshDirty = body.meshDirty, dirtyAll = ownRegion && region.dirtyAll;
    if (confirm && ownRegion) {
      const lc = f.lastConsumed;
      const allDone = this._allEventK[bs] > 0 && lc >= this._allEventK[bs];
      if (allDone) this._allEventK[bs] = 0;
      if (this._dirtySentK[bs] > 0 && lc >= this._dirtySentK[bs]) {
        retireBodyDirty(store, region, this._dirtySentN[bs], allDone);
        this._dirtySentK[bs] = 0; this._dirtySentN[bs] = 0;
      }
      if (this._meshEventK[bs] > 0 && lc >= this._meshEventK[bs]) this._meshEventK[bs] = 0;
      // nowe zdarzenia gry → oczekujące (flagi gry zdjęte — gra ich nie czyta, render ma swoją replikę)
      if (region.dirtyAll) { this._allEventK[bs] = k; region.dirtyAll = false; }
      if (body.meshDirty) { this._meshEventK[bs] = k; body.meshDirty = false; }
      meshDirty = this._meshEventK[bs] > 0;
      dirtyAll = this._allEventK[bs] > 0;
    }
    let flags = 0;
    if (meshDirty) { flags |= BODY_FLAG.MESH_DIRTY; changed = true; }
    if (ownRegion && (dirtyAll || region.dirtyCount > 0)) {
      if (dirtyAll) flags |= BODY_FLAG.DIRTY_ALL;
      changed = true;
    }
    if (changed) this._bodyChangedK[bs] = k;
    if (body.isSleeping) flags |= BODY_FLAG.SLEEPING;
    const planar = body.planar !== false;
    if (planar) flags |= BODY_FLAG.PLANAR;
    if (body.dead) flags |= BODY_FLAG.DEAD;
    if (hull.isFragment) flags |= BODY_FLAG.FRAGMENT;
    if (hull.anchorMode === 'com') flags |= BODY_FLAG.ANCHOR_COM;
    if (hull.solid3D) flags |= BODY_FLAG.SOLID3D;
    if (hull.world) flags |= BODY_FLAG.WORLD;
    if (hull.disableSolidArmorLod) flags |= BODY_FLAG.NO_SOLID_LOD;
    f64[b + BF.ANCHOR_DX] = raw(hull.anchorDX);
    f64[b + BF.ANCHOR_DY] = raw(hull.anchorDY);
    f64[b + BF.SCALE] = raw(hull.scale);
    f64[b + BF.SRC_W] = raw(hull.srcWidth);
    f64[b + BF.SRC_H] = raw(hull.srcHeight);
    const pv = hull.pivot;
    f64[b + BF.PIVOT_X] = pv ? raw(pv.x) : NaN;
    f64[b + BF.PIVOT_Y] = pv ? raw(pv.y) : NaN;
    f64[b + BF.CELL] = raw(body.cellSize);
    const lm = body.latticeMin;
    f64[b + BF.LAT_MIN_X] = lm ? raw(lm.x) : NaN;
    f64[b + BF.LAT_MIN_Y] = lm ? raw(lm.y) : NaN;
    f64[b + BF.LAT_MIN_Z] = lm ? raw(lm.z) : NaN;
    const bmm = body._boundsMinMax;   // [minX, minY, minZ, maxX, maxY, maxZ]
    f64[b + BF.MIN_X] = bmm ? bmm[0] : NaN;
    f64[b + BF.MIN_Y] = bmm ? bmm[1] : NaN;
    f64[b + BF.MIN_Z] = bmm ? bmm[2] : NaN;
    f64[b + BF.MAX_X] = bmm ? bmm[3] : NaN;
    f64[b + BF.MAX_Y] = bmm ? bmm[4] : NaN;
    f64[b + BF.MAX_Z] = bmm ? bmm[5] : NaN;
    f64[b + BF.MAX_DISP] = raw(body._maxDisp);
    const bp = body.pos, bq = body.quat;
    f64[b + BF.POS_X] = bp ? raw(bp.x) : NaN; f64[b + BF.POS_Y] = bp ? raw(bp.y) : NaN; f64[b + BF.POS_Z] = bp ? raw(bp.z) : NaN;
    f64[b + BF.QUAT_X] = bq ? raw(bq.x) : NaN; f64[b + BF.QUAT_Y] = bq ? raw(bq.y) : NaN;
    f64[b + BF.QUAT_Z] = bq ? raw(bq.z) : NaN; f64[b + BF.QUAT_W] = bq ? raw(bq.w) : NaN;
    i32[bi + BI.SLOT] = bs;
    i32[bi + BI.GEN] = this.ids.bodies.gen(bs);
    i32[bi + BI.ENT_SLOT] = es;
    i32[bi + BI.FLAGS] = flags;
    const count = store ? store.count | 0 : 0;
    const beamCount = beams ? beams.count | 0 : 0;
    i32[bi + BI.NODE_COUNT] = count;
    i32[bi + BI.BEAM_COUNT] = beamCount;
    i32[bi + BI.ACTIVE_NODES] = active;
    i32[bi + BI.STORE_VER] = this._bodyStoreVer[bs];
    i32[bi + BI.SHAPE_VER] = store ? (store.shapeVersion | 0) : 0;
    i32[bi + BI.DMG_KEY] = this.dict.code(hull.dmgKey);
    i32[bi + BI.REVISION] = num(hull.revision) | 0;
    i32[bi + BI.CHANGED_K] = this._bodyChangedK[bs];
    i32[bi + BI.REST_K] = this._bodyRestK[bs];
    // NODES: zmienione po ostatniej klatce odebranej, w pudle rozgrzania
    i32[bi + BI.NODE_F64_OFF] = -1; i32[bi + BI.NODE_U8_OFF] = -1; i32[bi + BI.NODE_N] = 0;
    i32[bi + BI.BEAM_F64_OFF] = -1; i32[bi + BI.BEAM_U8_OFF] = -1; i32[bi + BI.BEAM_N] = 0;
    i32[bi + BI.REST_F64_OFF] = -1; i32[bi + BI.DIRTY_OFF] = -1; i32[bi + BI.DIRTY_N] = 0;
    i32[bi + BI.HP_F64_OFF] = -1;
    const inBox = inCullBox(f.cull, ex, ey, hull);
    if (wantHp && store && count > 0 && inBox) {
      // HP (mostki 3D): suma kontrolna — trafienia zmieniają HP bez flag brudu skóry
      // samo hp: render czyta stosunek hp / maxHp, a maxHp zmienia się proporcjonalnie z hp (pancerz mostka,
      // odrost — nowa replika i tak wysyła oba)
      const hp = store.hp, mh = store.maxHp;
      let sh = 0;
      for (let i = 0; i < count; i++) sh += hp[i];
      const o = bs * 2, S = this._bodyHpSum;
      if (S[o] !== sh) { S[o] = sh; this._bodyHpK[bs] = k; }
      i32[bi + BI.HP_K] = this._bodyHpK[bs];
      if (this._bodyHpK[bs] > f.lastConsumed || this._bodyHpK[bs] > this._bodyHpW[bs]) {
        const p = this._nodeF64;
        if (p + 2 * count > this.layout.cap.nodeF64) this._requestGrow('nodeF64', (p + 2 * count) * 2);
        else {
          v.nodeF64.set(hp.subarray(0, count), p);
          v.nodeF64.set(mh.subarray(0, count), p + count);
          i32[bi + BI.HP_F64_OFF] = p;
          this._bodyHpW[bs] = k;
          this._nodeF64 = p + 2 * count;
        }
      }
    }
    const changedK = this._bodyChangedK[bs];
    if (store && count > 0 && (changedK > f.lastConsumed || changedK > this._bodyNodesW[bs]) && inBox) {
      const restK = this._bodyRestK[bs];
      const rest = restK > f.lastConsumed || restK > this._bodyRestW[bs];
      const dirtyN = ownRegion && !dirtyAll ? region.dirtyCount | 0 : 0;
      if (this._packNodes(v, store, beams, count, beamCount, planar, bi, rest, dirtyN ? region.dirty : null, dirtyN)) {
        st.bodiesPacked++;
        this._bodyNodesW[bs] = k;
        if (rest) this._bodyRestW[bs] = k;
        st.nodesPacked += count;
        st.beamsPacked += beamCount;
        if (confirm) {
          // lista do potwierdzenia: odbiór tej (albo późniejszej) strony zdejmie pierwsze `dirtyCount` wpisów
          if (ownRegion) { this._dirtySentK[bs] = k; this._dirtySentN[bs] = region.dirtyCount | 0; }
        } else if (f.consumeDirty) {
          // Lustro (RW-11a, inline — render odbiera każdą stronę): flagi brudu gry zerowane tu, a nie w renderze
          // (render czyści REPLIKĘ).
          consumeBodyDirty(body, store, region);
        }
      }
    }
  }

  _packNodes(v, s, e, n, m, planar, bi, rest, dirty, dirtyN) {
    const restWords = rest ? n * (planar ? 2 : 3) : 0;
    const words = bodyNodeF64Words(n, planar) + m + restWords;
    const bytes = bodyNodeU8Bytes(n) + m;
    const cap = this.layout.cap;
    if (this._nodeF64 + words > cap.nodeF64 || this._nodeU8 + bytes > cap.nodeU8 || this._nodeI32 + dirtyN > cap.nodeI32) {
      this._requestGrow('nodeF64', (this._nodeF64 + words) * 2);
      this._requestGrow('nodeU8', (this._nodeU8 + bytes) * 2);
      this._requestGrow('nodeI32', (this._nodeI32 + dirtyN) * 2);
      return false;
    }
    const o = this._nodeF64, u = this._nodeU8;
    const F = v.nodeF64, U = v.nodeU8;
    F.set(s.x.subarray(0, n), o);
    F.set(s.y.subarray(0, n), o + n);
    let p = o + 2 * n;
    if (!planar) { F.set(s.z.subarray(0, n), p); p += n; }
    F.set(s.heat.subarray(0, n), p); p += n;
    F.set(s.heatStamp.subarray(0, n), p); p += n;
    U.set(s.active.subarray(0, n), u);
    U.set(s.patch.subarray(0, n), u + n);
    let q = u + 2 * n;
    const i32 = v.bodyI32;
    i32[bi + BI.NODE_F64_OFF] = o;
    i32[bi + BI.NODE_U8_OFF] = u;
    i32[bi + BI.NODE_N] = n;
    if (e && m > 0) {
      F.set(e.rest.subarray(0, m), p);
      U.set(e.broken.subarray(0, m), q);
      i32[bi + BI.BEAM_F64_OFF] = p;
      i32[bi + BI.BEAM_U8_OFF] = q;
      i32[bi + BI.BEAM_N] = m;
      p += m; q += m;
    }
    if (rest) {
      i32[bi + BI.REST_F64_OFF] = p;
      F.set(s.ox.subarray(0, n), p); p += n;
      F.set(s.oy.subarray(0, n), p); p += n;
      if (!planar) { F.set(s.oz.subarray(0, n), p); p += n; }
    }
    if (dirtyN > 0) {
      const d = this._nodeI32;
      v.nodeI32.set(dirty.subarray(0, dirtyN), d);
      i32[bi + BI.DIRTY_OFF] = d;
      i32[bi + BI.DIRTY_N] = dirtyN;
      this._nodeI32 = d + dirtyN;
    }
    this._nodeF64 = p;
    this._nodeU8 = q;
    return true;
  }

  // ── SHOTS ────────────────────────────────────────────────────────────────────────────────────────────────
  _packShots(v, f) {
    const list = f.bullets || EMPTY;
    const shots = this.ids.shots;
    const ents = this.ids.entities;
    const dict = this.dict;
    const cap = this.layout.cap.shots;
    const n = Math.min(list.length, cap);
    const f64 = v.shotF64, i32 = v.shotI32;
    const ship = f.ship;
    for (let i = 0; i < n; i++) {
      const bl = list[i];
      const b = i * SHOT.stride.f64, bi = i * SHOT.stride.i32;
      if (!bl) { i32[bi + SI.SLOT] = -1; continue; }
      const s = shots.slotOf(bl);
      f64[b + SF.X] = raw(bl.x);
      f64[b + SF.Y] = raw(bl.y);
      f64[b + SF.VX] = raw(bl.vx);
      f64[b + SF.VY] = raw(bl.vy);
      f64[b + SF.VZ] = raw(bl.vz);
      f64[b + SF.Z] = raw(bl.z);
      f64[b + SF.IVX] = raw(bl.ivx);
      f64[b + SF.IVY] = raw(bl.ivy);
      f64[b + SF.IVZ] = raw(bl.ivz);
      f64[b + SF.LIFE] = raw(bl.life);
      f64[b + SF.AGE] = raw(bl.age);
      f64[b + SF.BORN_SIM] = raw(bl.bornSim);
      i32[bi + SI.SLOT] = s;
      i32[bi + SI.GEN] = shots.gen(s);
      i32[bi + SI.VFX_KEY] = dict.code(bl.vfxKey);
      i32[bi + SI.TYPE] = dict.code(bl.type);
      i32[bi + SI.WEAPON_SIZE] = dict.code(bl.weaponSize);
      let fl = 0;
      if (bl.forceCanvas) fl |= SHOT_FLAG.FORCE_CANVAS;
      const src = bl.source;
      if (src && src === ship) fl |= SHOT_FLAG.PLAYER;
      i32[bi + SI.FLAGS] = fl;
      const ss = src ? ents.peek(src) : -1;
      i32[bi + SI.SOURCE_SLOT] = ss;
      i32[bi + SI.SOURCE_GEN] = ss >= 0 ? ents.gen(ss) : 0;
      i32[bi + SI.CLOCK] = dict.code(bl.clock);
    }
    v.head[HEAD.N_SHOTS] = n;
    this.stats.shots = n;
    if (list.length > cap) this._requestGrow('shots', list.length * 2);
  }

  // ── STATIONS, CORES, WORLD, TURRETS ─────────────────────────────────────────────────────────────────────
  _packStations(v, f) {
    const list = this._lists[LIST.STATIONS];
    const ents = this.ids.entities;
    const hides = f.fog ? f.hides : null;
    const n = Math.min(list.length, this.layout.cap.stations);
    const f64 = v.staF64, i32 = v.staI32;
    for (let i = 0; i < n; i++) {
      const st = list[i];
      const b = i * STATION.stride.f64, bi = i * STATION.stride.i32;
      if (!st) { i32[bi + STI.SLOT] = -1; continue; }
      const s = ents.slotOf(st);
      if (this.describe) {
        const d = this.stationDescs[s];
        const gen = ents.gen(s);
        if (!d || d.gen !== gen) { this.stationDescs[s] = { gen, desc: describeStation(st) }; this.stationQueue.push(s); }
      }
      f64[b + STF.X] = raw(st.x);
      f64[b + STF.Y] = raw(st.y);
      f64[b + STF.ANGLE] = raw(st.angle);
      f64[b + STF.R] = raw(st.r);
      f64[b + STF.BASE_R] = raw(st.baseR);
      let fl = 0;
      if (st._destroyed3D) fl |= 1;
      if (hides && hides(st)) fl |= 2;
      if (st.ringPort) fl |= 4;
      if (st.isPirate) fl |= 8;
      i32[bi + STI.SLOT] = s;
      i32[bi + STI.GEN] = ents.gen(s);
      i32[bi + STI.FLAGS] = fl;
    }
    v.head[HEAD.N_STATIONS] = n;
    this.stats.stations = n;
  }

  _packCores(v, f) {
    const list = f.reactorCores || EMPTY;
    const ents = this.ids.entities;
    const dict = this.dict;
    const n = Math.min(list.length, this.layout.cap.cores);
    const f64 = v.coreF64, i32 = v.coreI32, U = v.coreU8, ucap = this.layout.cap.coreCells;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      const b = i * CORE.stride.f64, bi = i * CORE.stride.i32;
      const uid = c ? num(c.uid) | 0 : 0;
      i32[bi + CI.UID] = uid;
      if (c && this.describe && !this.coreDescs.has(uid)) {
        this.coreDescs.set(uid, describeCore(c));
        this.coreQueue.push(uid);
      }
      const host = c ? c.host : null;
      const hs = host ? ents.peek(host) : -1;
      i32[bi + CI.HOST_SLOT] = hs;
      i32[bi + CI.HOST_GEN] = hs >= 0 ? ents.gen(hs) : 0;
      const hc = host ? host.reactorCores : null;
      i32[bi + CI.INDEX] = Array.isArray(hc) ? hc.indexOf(c) : -1;
      i32[bi + CI.STATE] = c ? dict.code(c.state) : -1;
      i32[bi + CI.INVALID] = c ? dict.code(c.invalid) : -1;
      const dead = c ? num(c.deadCount) | 0 : 0, els = c ? num(c.elsewhereCount) | 0 : 0;
      i32[bi + CI.DEAD_COUNT] = dead;
      i32[bi + CI.ELSEWHERE] = els;
      i32[bi + CI.ALIVE_COUNT] = c ? num(c.aliveCount) | 0 : 0;
      f64[b + CF.INTEGRITY] = c ? raw(c.integrity) : NaN;
      f64[b + CF.MELT_REMAIN] = c ? raw(c.meltdownRemaining) : NaN;
      f64[b + CF.MELT_DUR] = c ? raw(c.meltdownDuration) : NaN;
      f64[b + CF.LAST_X] = c ? raw(c.lastX) : NaN;
      f64[b + CF.LAST_Y] = c ? raw(c.lastY) : NaN;
      const cs = c ? c.cellState : null;
      const cn = cs ? cs.length : 0;
      if (cn > 0 && dead + els > 0) {
        if (u + cn > ucap) { this._requestGrow('coreCells', (u + cn) * 2); i32[bi + CI.CELL_OFF] = -1; i32[bi + CI.CELL_N] = 0; }
        else { U.set(cs, u); i32[bi + CI.CELL_OFF] = u; i32[bi + CI.CELL_N] = cn; u += cn; }
      } else { i32[bi + CI.CELL_OFF] = -1; i32[bi + CI.CELL_N] = cn; }
    }
    v.head[HEAD.N_CORES] = n;
    this.stats.cores = n;
    if (list.length > this.layout.cap.cores) this._requestGrow('cores', list.length * 2);
  }

  _packWorld(v, f) {
    const w = v.world;
    const sun = f.sun;
    w[WORLD.SUN_X] = sun ? raw(sun.x) : NaN;
    w[WORLD.SUN_Y] = sun ? raw(sun.y) : NaN;
    w[WORLD.SUN_R] = sun ? raw(sun.r) : NaN;
    w[WORLD.SKY_ZONE] = this.dict.code(f.skyZone);
    const wp = f.warp;
    w[WORLD.WARP_STATE] = wp ? this.dict.code(wp.state) : -1;
    w[WORLD.WARP_CHARGE] = wp ? raw(wp.charge) : NaN;
    w[WORLD.WARP_CHARGE_TIME] = wp ? raw(wp.chargeTime) : NaN;
    w[WORLD.WARP_GEAR] = wp ? raw(wp.gear) : NaN;
    w[WORLD.WARP_DIR] = wp ? raw(wp.dir) : NaN;
    w[WORLD.WARP_FLYBY] = wp ? raw(wp.flybyFactor) : NaN;
    w[WORLD.WARP_CRUISE] = wp ? raw(wp.cruise) : NaN;
    w[WORLD.WARP_SPEED] = wp ? raw(wp.speed) : NaN;
    const ramp = wp ? wp.exitRamp : null;
    w[WORLD.WARP_EXIT_ACTIVE] = ramp ? (ramp.active ? 1 : 0) : -1;
    w[WORLD.WARP_EXIT_AGE] = ramp ? raw(ramp.age) : NaN;
    w[WORLD.WARP_EXIT_TBRAKE] = ramp ? raw(ramp.tBrake) : NaN;
    w[WORLD.WARP_TARGET_BODY] = -1;   // AGENT: RW-11c — indeks planety warp.targetBody na liście planet
    const bo = f.boost;
    w[WORLD.BOOST_STATE] = bo ? this.dict.code(bo.state) : -1;
  }

  _packTurrets(v, f) {
    const of = f.turretsOf;
    const list = this._lists[LIST.SEEN_COLD];
    const ents = this.ids.entities;
    const cap = this.layout.cap.turrets;
    let n = 0, need = 0;
    if (of) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const recs = e ? of(e) : null;
        if (!recs || !recs.length) continue;
        const s = ents.peek(e);
        const gen = s >= 0 ? ents.gen(s) : 0;
        for (let j = 0; j < recs.length; j++) {
          need++;
          if (n < cap) this._writeTurret(v, n++, recs[j], s, gen);
        }
      }
    }
    this._endTurrets(v, n, need, cap);
  }

  /** RW-26: rekordy wież klatki (Turret2D.syncFrame przed updateHexShips3D), w kolejności klatki. */
  _packTurretFrame(v, tf) {
    const ents = this.ids.entities;
    const cap = this.layout.cap.turrets;
    const count = tf.frameCount | 0;
    let n = 0, need = 0;
    for (let i = 0; i < count; i++) {
      const r = tf.recordAt(i);
      const e = r ? r.entity : null;
      const s = e ? ents.peek(e) : -1;
      if (s < 0) continue;            // encja spoza list migawki — render jej nie zna
      need++;
      if (n < cap) this._writeTurret(v, n++, r, s, ents.gen(s));
    }
    this._endTurrets(v, n, need, cap);
  }

  _endTurrets(v, n, need, cap) {
    v.head[HEAD.N_TURRETS] = n;
    this.stats.turrets = n;
    if (need > cap) this._requestGrow('turrets', need * 2);
  }

  _writeTurret(v, n, r, s, gen) {
    const f64 = v.turF64, i32 = v.turI32;
    const tc = this._turCodes, tcb = n * 4;
    const b = n * TURRET.stride.f64, bi = n * TURRET.stride.i32;
    i32[bi + TI.ENT_SLOT] = s;
    i32[bi + TI.ENT_GEN] = gen;
    i32[bi + TI.KEY] = tc.code(tcb, r.key);
    i32[bi + TI.UID] = tc.code(tcb + 1, r.uid);
    i32[bi + TI.WEAPON] = tc.code(tcb + 2, r.weaponId);
    i32[bi + TI.FX_KEY] = tc.code(tcb + 3, r.fxKey);
    f64[b + TF.WX] = raw(r.wx);
    f64[b + TF.WY] = raw(r.wy);
    f64[b + TF.ANG] = raw(r.ang);
    f64[b + TF.SCALE] = raw(r.scale);
    f64[b + TF.RECOIL] = raw(r.recoil);
    f64[b + TF.SHAKE] = raw(r.shake);
    const spec = r.spec;
    f64[b + TF.R] = spec ? raw(spec.r) : NaN;
    const rs = r.state;
    f64[b + TF.HOUSING] = rs ? raw(rs.housing) : NaN;
    f64[b + TF.BARREL] = rs ? raw(rs.barrel) : NaN;
    f64[b + TF.FLASH] = rs ? raw(rs.flash) : NaN;
  }
}

const sameNum = (a, b) => a === b || (a !== a && b !== b);

function sameVers(a, ver, vb) {
  for (let q = 0; q < 6; q++) if (a[q] !== ver[vb + q]) return false;
  return true;
}

function grow32(a, n) {
  const b = new Int32Array(n);
  b.set(a);
  return b;
}

function copyInto(src, out) {
  for (let i = 0; i < src.length; i++) out.push(src[i]);
}

// Jak fogInto, ale żywe encje (w RENDER od indeksu r0, w tej samej kolejności) biorą wynik z fogR.
function fogIntoCached(src, out, hides, fogR, r0) {
  if (!hides) { copyInto(src, out); return; }
  let ri = r0;
  for (let i = 0; i < src.length; i++) {
    const e = src[i];
    if (!e) continue;
    const h = !e.dead ? fogR[ri++] === 1 : hides(e);
    if (!h) out.push(e);
  }
}

/**
 * Zerowanie flag brudu skóry ciała gry (jak `clearHullSkinDirty` + `body.meshDirty = false` w renderze) — po
 * przekazaniu zmian do strony, gdy lustro renderu prowadzi własną replikę.
 */
function consumeBodyDirty(body, store, region) {
  if (region && region.store === store) {
    const sd = store.skinDirty;
    if (region.dirtyAll) {
      if (sd) sd.fill(0);
      region.dirtyAll = false;
    } else if (sd) {
      const d = region.dirty;
      for (let k = 0; k < region.dirtyCount; k++) sd[d[k]] = 0;
    }
    region.dirtyCount = 0;
  }
  body.meshDirty = false;
}

/**
 * Worker potwierdził stronę z listą brudu ciała (pierwsze `n` wpisów `region.dirty`): wpisy zdjęte z listy, ich
 * znaczniki `skinDirty` wolne; reszta (dopisana po tej stronie) zostaje na początku listy. `all` — potwierdzona strona
 * niosła pełne przepisanie skóry (dirtyAll): znaczniki od nowa tylko z pozostałych wpisów (węzły bez wpisu na liście
 * po resecie obszaru nie mogą zostać zaznaczone na zawsze — markSkinDirty by ich już nie dopisał).
 */
function retireBodyDirty(store, region, n, all) {
  const sd = store.skinDirty, d = region.dirty, c = region.dirtyCount | 0;
  if (n > c) n = c;
  let w = 0;
  if (all) {
    if (sd) sd.fill(0);
    for (let i = n; i < c; i++) { const j = d[i]; if (sd && sd[j]) continue; if (sd) sd[j] = 1; d[w++] = j; }
  } else {
    if (sd) for (let i = 0; i < n; i++) sd[d[i]] = 0;
    for (let i = n; i < c; i++) d[w++] = d[i];
  }
  region.dirtyCount = w;
}

function writeCull(h, c) {
  h[HEAD.CULL_X] = c.x; h[HEAD.CULL_Y] = c.y;
  h[HEAD.CULL_HALF_W] = c.halfW; h[HEAD.CULL_HALF_H] = c.halfH;
  h[HEAD.CULL_DRAW_HALF_W] = c.drawHalfW; h[HEAD.CULL_DRAW_HALF_H] = c.drawHalfH;
  h[HEAD.FLAGS] = h[HEAD.FLAGS] | HEAD_FLAG.CULL_SET;
}

/** Ciało w pudle rozgrzania (pudło + zasięg sprite'a kadłuba). Bez pudła — zawsze. */
function inCullBox(cull, x, y, hull) {
  if (!cull) return true;
  const sw = num(hull.srcWidth), sh = num(hull.srcHeight);
  const ext = (sw > sh ? sw : sh) * Math.max(1, num(hull.scale));
  return Math.abs(x - cull.x) <= cull.halfW + ext && Math.abs(y - cull.y) <= cull.halfH + ext;
}
