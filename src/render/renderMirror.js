// src/render/renderMirror.js — lustra encji po stronie renderu (docs/PLAN-render-worker.md § 3.6, RW-11a).
//
// Render (moduły 3D) dostaje zamiast obiektów gry LUSTRA: obiekt na slot encji (renderIds) o STAŁEJ klasie ukrytej,
// aktualizowany W MIEJSCU ze strony migawki (blok ENT, NOZZLES, BODY / NODES) — moduły trzymają stan po tożsamości
// obiektu (`state.entityMeshes`, `EngineVfxSystem.entityEffects`, getter-y uniformów łapiące encję, `slot.source`
// dysz), więc lustro żyje, dopóki slot ma tę samą generację; nowa generacja = nowe lustro (stare odpada z list).
// Konfiguracja statyczna (visual z układem dysz, profil, lampy edytora, kadłub: obrazy i parametry, topologia
// magazynu) przychodzi OPISEM encji (`describeEntity` po stronie gry — przy nowym slocie i przy zmianie wersji;
// w workerze `postMessage`, w `inline` kopia `structuredClone`, obrazy przez tabelę zasobów).
//
// Pola, które moduły renderu piszą na encjach (`__warpHullU`, `__warpNurtMode` — WarpNurt, mosty: mirrorBridge.js;
// `__hiddenFromView`, `__inDrawBox`, `_shadowGrid`, `__engineFxFallback`, `_lattice`), lądują w lustrach.
//
// Czysty moduł (bez three, DOM i `window`).

import { LIST, ENT, ENT_FLAG, ENT_FLAG2, IMPACT, VENT, BRIDGE_HEAD, BRIDGE_REC, NOZZLE, BODY, BODY_FLAG, HEAD, CORE, STATION } from './snapshotLayout.js';
import { MirrorBody, applyBodyPage } from './mirrorBody.js';

const EF = ENT.F64, EI = ENT.I32;
const NF = NOZZLE.F64, NI = NOZZLE.I32;

/** NaN ze strony → undefined na lustrze (pole nieobecne na obiekcie gry). */
const und = (v) => (v === v ? v : undefined);

/**
 * Encja-lustro. Pola poza i stanu z ENT (co klatkę), konfiguracja z opisu, pola pisane przez render (inicjowane tu —
 * stała klasa ukryta).
 */
export class MirrorEntity {
  constructor(slot, gen) {
    this.__mirror = true;
    this.slot = slot;
    this.gen = gen;
    this.descVer = new Int32Array(6).fill(-1);   // wersje konfiguracji z ostatniego opisu (EI.V_VISUAL … V_SHIELD)
    // poza i ruch
    this.x = 0; this.y = 0; this.pos = null; this.angle = 0;
    this.vx = undefined; this.vy = undefined; this.vel = null;
    this.angVel = undefined; this.angularVelocity = undefined; this.z = undefined;
    this.radius = undefined; this.r = undefined; this.w = undefined; this.h = undefined;
    this.__skinZ = undefined; this.__renderScale = undefined;
    this.__hardpointScale = undefined; this.__hardpointScaleX = undefined; this.__hardpointScaleY = undefined;
    // flagi
    this.dead = false; this.isWreck = false; this.isFragment = false; this.isPlayer = false; this.isCold = false;
    this.isPirate = false; this.friendly = false; this.hideHexVisual = false;
    this.isRingSegment = false; this.isCapitalShip = false; this.isBridgeHulk = false;
    this.lightsOff = false; this.roadLightsOff = false;
    this.__lightsHidden = false; this.__enginesHidden = false; this.__turretsHidden = false;
    this.__editorBoost = false; this.__fSysBoost = false; this.__warpPreview = false;
    this.fogHidden = false;
    this.state = undefined; this.phase = undefined;
    this.id = undefined; this.uid = undefined; this.name = undefined;
    this.type = undefined; this.shipFrame = undefined; this.activeHullId = undefined;
    this.model3DProfileId = undefined; this.fighter = false; this.weaponTier = undefined;
    this.faction = undefined; this.factionId = undefined; this.__hullId = undefined; this.shipId = undefined;
    this.spriteW = undefined; this.spriteH = undefined; this.renderSpriteImage = null;
    this._shieldForcedOff = false; this._coldSnapshot = null;
    // napęd
    this.thrusterInput = { main: 0, leftSide: 0, rightSide: 0, torque: 0 };
    this.input = { main: 0, thrustY: 0 };
    this.engineIgn = null;
    // tarcza, maskowanie (stan gry)
    this.shield = null;
    this.cloak = null;
    // konfiguracja statyczna (opis)
    this.visual = null; this.capitalProfile = undefined; this.profile = undefined; this.editorLights = undefined;
    this.engines = undefined;
    this.beamHull = null;
    this.bridgeState = null;
    this._bridgeOid = 0;          // numer obiektu gry stanu mostków (wspólny wpis RenderMirror._bridgeShared)
    this._oidPool = new Map();
    // pisane przez render
    this.__cloakLook = undefined; this.__warpHullU = undefined; this.__warpNurtMode = undefined; this.__bayCut = undefined;
    this.worldRef = null;   // kawałek ciała świata (opis — worldBodiesBlock / worldBodies3D w workerze)
    this.__hiddenFromView = false; this.__inDrawBox = false; this.__engineFxFallback = undefined;
    this._coldSkinFrame = undefined; this._coldDrawFrame = undefined; this._shadowGrid = undefined; this.__lightOcclude = undefined; this.__lightMate = undefined;
    // przejściowe (do RW-26 / RW-28 / RW-31): obiekt gry dla kroków jeszcze nieprzeniesionych
    this.__game = null;
  }
}

const CLOAK_BREAK_NONE = null;

/**
 * Lustra całej strony: sloty → lustra, listy, ciała. `describe(slot, gen, i32, off)` → opis encji (konfiguracja
 * statyczna; wersje V_* w `i32[off … off + 5]`) albo null; `topologyOf(bodySlot, storeVer)` → topologia magazynu albo null; `dict` — słownik napisów pakującego.
 */
export class RenderMirror {
  constructor({ dict, describe = null, topologyOf = null, resourceOf = null, bridgeBackends = null } = {}) {
    this.bridgeBackends = bridgeBackends;
    this._vents = new Map();     // numer obiektu wyrzutu → obiekt (tożsamość jak vent gry)
    this.dict = dict;
    this.describe = describe;
    this.topologyOf = topologyOf;
    this.resourceOf = resourceOf || (() => null);
    this.entities = [];          // slot → MirrorEntity | null
    this.bodies = [];            // slot ciała → MirrorBody | null
    this.lists = new Array(LIST.COUNT);
    for (let i = 0; i < LIST.COUNT; i++) this.lists[i] = [];
    this.player = null;
    this.player2 = null;
    this.cores = [];             // rdzenie reaktorów (kolejność ReactorGame.cores — lustra po uid)
    this._coreMirrors = new Map();
    this.coreOf = null;          // (uid) → opis rdzenia albo null
    this.stations = [];          // stacje (kolejność listy gry) — lustra po slocie i generacji
    this._stationMirrors = [];
    this.stationOf = null;       // (slot, gen) → opis stacji albo null
    this._breaks = new Map();    // numer zerwania maskowania → obiekt (tożsamość jak cloak.lastBreak gry)
    // stany mostków WSPÓLNE dla luster (numer obiektu gry → { pool, st, k }): w grze okręt i jego wrak niosą TEN SAM
    // obiekt `bridgeState` (stan efektów agonii BridgeFx3D / rekordy Bridge3D idą za nim) — lustra też
    this._bridgeShared = new Map();
    this.stats = { created: 0, dropped: 0, waitingDescriptor: 0, waitingTopology: 0, waitingHp: 0 };
    this._seen = new Int32Array(0);
    this._k = 0;
  }

  /** Lustro slotu dla generacji (nowe przy zmianie generacji). */
  _mirror(slot, gen) {
    let m = this.entities[slot];
    if (m && m.gen === gen) return m;
    if (m) this.stats.dropped++;
    m = new MirrorEntity(slot, gen);
    this.entities[slot] = m;
    this.stats.created++;
    return m;
  }

  /** Aktualizacja ze strony `v` (widoki createSnapshotViews). */
  apply(v) {
    const k = v.head[HEAD.K];
    this._k = k;
    const nEnt = v.head[HEAD.N_ENT] | 0;
    if (this._seen.length < nEnt) { const a = new Int32Array(Math.max(nEnt, this._seen.length * 2)); a.set(this._seen); this._seen = a; }
    const stride = v.listStride;
    for (let l = 0; l < LIST.COUNT; l++) {
      const out = this.lists[l];
      out.length = 0;
      if (l === LIST.STATIONS) continue;
      const n = v.listCount[l];
      const base = l * stride;
      for (let i = 0; i < n; i++) {
        const s = v.listData[base + i];
        if (s < 0) continue;
        const m = this._entity(v, s, k);
        if (m) out.push(m);
      }
    }
    applyCores(this, v);
    applyStations(this, v);
    if ((k & 511) === 0) for (const [id, ent] of this._bridgeShared) if (k - ent.k > 1024) this._bridgeShared.delete(id);
    const ps = v.head[HEAD.PLAYER_SLOT];
    this.player = ps >= 0 ? (this.entities[ps] || null) : null;
    const p2 = v.head[HEAD.P2_SLOT];
    this.player2 = p2 >= 0 ? (this.entities[p2] || null) : null;
    // lustra slotów, których nie ma w żadnej liście tej strony, odpadają (slot zwolniony po stronie gry)
    for (let s = 0; s < this.entities.length; s++) {
      if (this.entities[s] && (s >= nEnt || this._seen[s] !== k)) { this.entities[s] = null; this.stats.dropped++; }
    }
  }

  _entity(v, s, k) {
    const bi = s * ENT.stride.i32;
    const gen = v.entI32[bi + EI.GEN] >>> 0;
    const m = this._mirror(s, gen);
    if (this._seen[s] === k) return m;
    this._seen[s] = k;
    applyEntityPage(this, m, v, s);
    return m;
  }
}

/** Pola ENT strony → lustro (każde pole raz; obiekty zagnieżdżone aktualizowane w miejscu). */
export function applyEntityPage(rm, m, v, s) {
  const f64 = v.entF64, i32 = v.entI32;
  const b = s * ENT.stride.f64, bi = s * ENT.stride.i32;
  const flags = i32[bi + EI.FLAGS], flags2 = i32[bi + EI.FLAGS2];
  m.x = und(f64[b + EF.X]); m.y = und(f64[b + EF.Y]);
  if (flags & ENT_FLAG.HAS_POS) {
    if (!m.pos) m.pos = { x: 0, y: 0 };
    m.pos.x = f64[b + EF.POS_X]; m.pos.y = f64[b + EF.POS_Y];
  } else m.pos = null;
  m.angle = und(f64[b + EF.ANGLE]);
  m.vx = und(f64[b + EF.VX]); m.vy = und(f64[b + EF.VY]);
  if (flags & ENT_FLAG.HAS_VEL) {
    if (!m.vel) m.vel = { x: 0, y: 0 };
    m.vel.x = f64[b + EF.VEL_X]; m.vel.y = f64[b + EF.VEL_Y];
  } else m.vel = null;
  m.angVel = und(f64[b + EF.ANG_VEL]);
  m.angularVelocity = und(f64[b + EF.ANGULAR_VELOCITY]);
  m.z = und(f64[b + EF.Z]);
  m.radius = und(f64[b + EF.RADIUS]);
  m.r = und(f64[b + EF.R]);
  m.w = und(f64[b + EF.W]); m.h = und(f64[b + EF.H]);
  m.__skinZ = und(f64[b + EF.SKIN_Z]);
  m.__renderScale = und(f64[b + EF.RENDER_SCALE]);
  m.__hardpointScale = und(f64[b + EF.HP_SCALE]);
  m.__hardpointScaleX = und(f64[b + EF.HP_SCALE_X]);
  m.__hardpointScaleY = und(f64[b + EF.HP_SCALE_Y]);
  m.dead = (flags & ENT_FLAG.DEAD) !== 0;
  m.isWreck = (flags & ENT_FLAG.WRECK) !== 0;
  m.isFragment = (flags & ENT_FLAG.FRAGMENT) !== 0;
  m.isPlayer = (flags2 & ENT_FLAG2.IS_PLAYER_FIELD) !== 0;
  m.isCold = (flags & ENT_FLAG.COLD) !== 0;
  m.isPirate = (flags & ENT_FLAG.PIRATE) !== 0;
  m.friendly = (flags & ENT_FLAG.FRIENDLY) !== 0;
  m.hideHexVisual = (flags & ENT_FLAG.HIDE_HEX) !== 0;
  m.isRingSegment = (flags & ENT_FLAG.RING_SEGMENT) !== 0;
  m.isCapitalShip = (flags2 & ENT_FLAG2.CAPITAL) !== 0;
  m.isBridgeHulk = (flags & ENT_FLAG.BRIDGE_HULK) !== 0;
  m.lightsOff = (flags & ENT_FLAG.LIGHTS_OFF) !== 0;
  m.roadLightsOff = (flags & ENT_FLAG.ROAD_LIGHTS_OFF) !== 0;
  m.__lightsHidden = (flags & ENT_FLAG.LIGHTS_HIDDEN) !== 0;
  m.__enginesHidden = (flags & ENT_FLAG.ENGINES_HIDDEN) !== 0;
  m.__turretsHidden = (flags & ENT_FLAG.TURRETS_HIDDEN) !== 0;
  m.__editorBoost = (flags & ENT_FLAG.EDITOR_BOOST) !== 0;
  m.__fSysBoost = (flags & ENT_FLAG.FSYS_BOOST) !== 0;
  m.__warpPreview = (flags & ENT_FLAG.WARP_PREVIEW) !== 0;
  m.fogHidden = (flags & ENT_FLAG.FOG_HIDDEN) !== 0;
  const dict = rm.dict;
  m.state = dict.value(i32[bi + EI.STATE]);
  m.phase = dict.value(i32[bi + EI.PHASE]);
  m.model3DProfileId = dict.value(i32[bi + EI.MODEL3D]);
  m.fighter = (flags2 & ENT_FLAG2.FIGHTER) !== 0;
  m.weaponTier = dict.value(i32[bi + EI.WEAPON_TIER]);
  m.faction = dict.value(i32[bi + EI.FACTION]);
  m.factionId = dict.value(i32[bi + EI.FACTION_ID]);
  m.__hullId = dict.value(i32[bi + EI.HULL_ID]);
  m.shipId = dict.value(i32[bi + EI.SHIP_ID]);
  m.spriteW = und(f64[b + EF.SPRITE_W]);
  m.spriteH = und(f64[b + EF.SPRITE_H]);
  if (flags2 & ENT_FLAG2.HAS_RS) {
    if (!m.renderSpriteImage) m.renderSpriteImage = { width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 };
    const rsi = m.renderSpriteImage;
    rsi.width = und(f64[b + EF.RS_W]); rsi.height = und(f64[b + EF.RS_H]);
    rsi.naturalWidth = und(f64[b + EF.RS_NW]); rsi.naturalHeight = und(f64[b + EF.RS_NH]);
  } else m.renderSpriteImage = null;
  m._shieldForcedOff = (flags2 & ENT_FLAG2.SH_FORCED_OFF) !== 0;
  if (flags2 & ENT_FLAG2.HAS_COLD_SNAP) {
    if (!m._coldSnapshot) m._coldSnapshot = { kind: undefined, hull: { dmgKey: undefined }, impostor: null };
    const cs = m._coldSnapshot;
    cs.kind = dict.value(i32[bi + EI.COLD_KIND]);
    cs.hull.dmgKey = dict.value(i32[bi + EI.COLD_DMG_KEY]);
    const cx = f64[b + EF.CI_X];
    if (cx === cx) {
      if (!cs.impostor) cs.impostor = { x: 0, y: 0, rot: 0, halfW: 0, halfH: 0, r: 0, g: 0, b: 0, wx: 0, wy: 0, reach: 0, opacity: 0 };
      const im = cs.impostor;
      im.x = cx; im.y = f64[b + EF.CI_Y]; im.rot = f64[b + EF.CI_ROT];
      im.halfW = f64[b + EF.CI_HALF_W]; im.halfH = f64[b + EF.CI_HALF_H];
      im.r = f64[b + EF.CI_R]; im.g = f64[b + EF.CI_G]; im.b = f64[b + EF.CI_B];
      im.wx = f64[b + EF.CI_WX]; im.wy = f64[b + EF.CI_WY]; im.reach = f64[b + EF.CI_REACH];
      im.opacity = und(f64[b + EF.CI_OPACITY]);
    } else cs.impostor = null;
  } else m._coldSnapshot = null;
  // napęd (obiekty stałe)
  const ti = m.thrusterInput;
  ti.main = und(f64[b + EF.TI_MAIN]); ti.leftSide = und(f64[b + EF.TI_LEFT]);
  ti.rightSide = und(f64[b + EF.TI_RIGHT]); ti.torque = und(f64[b + EF.TI_TORQUE]);
  const inp = m.input;
  inp.main = und(f64[b + EF.IN_MAIN]); inp.thrustY = und(f64[b + EF.IN_THRUST_Y]);
  const ign = i32[bi + EI.IGN_STATE];
  if (ign >= 0) {
    if (!m.engineIgn) m.engineIgn = { state: 0, t: 0, hot: false };
    m.engineIgn.state = ign;
    m.engineIgn.t = und(f64[b + EF.IGN_T]);
    m.engineIgn.hot = (flags & ENT_FLAG.IGN_HOT) !== 0;
  } else m.engineIgn = null;
  // tarcza
  if (flags & ENT_FLAG.HAS_SHIELD) {
    if (!m.shield) m.shield = { max: 0, val: 0, state: undefined, activationProgress: 0, hardness: undefined, show: undefined, forceOff: false, impacts: [], impactId: 0, _impPool: [] };
    const sh = m.shield;
    sh.max = und(f64[b + EF.SH_MAX]); sh.val = und(f64[b + EF.SH_VAL]);
    sh.activationProgress = und(f64[b + EF.SH_ACT]); sh.hardness = und(f64[b + EF.SH_HARD]);
    sh.show = und(f64[b + EF.SH_SHOW]);
    sh.state = dict.value(i32[bi + EI.SH_STATE]);
    sh.impactId = i32[bi + EI.SH_IMPACT_ID];
    sh.forceOff = (flags2 & ENT_FLAG2.SH_FORCE_OFF) !== 0;
    applyImpacts(sh, v, i32[bi + EI.IMP_OFF], i32[bi + EI.IMP_N], dict);
  } else m.shield = null;
  // maskowanie (stan gry; `lastBreak` — obiekt o tożsamości stałej dla numeru zerwania)
  if (flags & ENT_FLAG.HAS_CLOAK) {
    if (!m.cloak) m.cloak = { state: undefined, level: 0, energy: 0, lastBreak: CLOAK_BREAK_NONE };
    const ck = m.cloak;
    ck.state = dict.value(i32[bi + EI.CLOAK_STATE]);
    ck.level = und(f64[b + EF.CLOAK_LEVEL]);
    ck.energy = und(f64[b + EF.CLOAK_ENERGY]);
    const brk = i32[bi + EI.CLOAK_BREAK];
    if (brk > 0) {
      let o = rm._breaks.get(brk);
      if (!o) { o = { serial: brk, forced: (flags2 & ENT_FLAG2.CLOAK_FORCED) !== 0 }; rm._breaks.set(brk, o); }
      ck.lastBreak = o;
    } else ck.lastBreak = CLOAK_BREAK_NONE;
  } else m.cloak = null;
  // opis (konfiguracja statyczna) — przy nowej wersji (bez alokacji, gdy wersje bez zmian)
  const dv = m.descVer;
  let stale = false;
  for (let q = 0; q < 6; q++) if (dv[q] !== i32[bi + EI.V_VISUAL + q]) { stale = true; break; }
  if (stale) {
    let desc = rm.describe ? rm.describe(s, m.gen, i32, bi + EI.V_VISUAL) : null;
    // mostki: Bridge3D liczy przy adopcji obecność komórek z HP węzłów — opis z mostkiem czeka na stronę z HP ciała
    // (HP mogło nie wejść na stronę: brak miejsca, ciało poza pudłem); bez tego model mostka zostałby bez komórek
    if (desc && desc.bridge && !bodyHpReady(rm, v, i32[bi + EI.BODY_SLOT], i32[bi + EI.BODY_GEN] >>> 0)) {
      desc = null;
      rm.stats.waitingHp++;
    }
    if (desc) {
      applyDescriptor(m, desc, rm.resourceOf, rm.bridgeBackends, rm._bridgeShared, rm._k);
      for (let q = 0; q < 6; q++) dv[q] = i32[bi + EI.V_VISUAL + q];
    } else rm.stats.waitingDescriptor++;
  }
  // wspólny stan mostków w użyciu (sprzątanie wpisów nieużywanych od 1024 stron — RenderMirror.apply)
  if (m._bridgeOid && m.bridgeState) { const ent = rm._bridgeShared.get(m._bridgeOid); if (ent) ent.k = rm._k; }
  // mostki (stan dynamiczny)
  const brOff = i32[bi + EI.BR_OFF];
  if (brOff >= 0 && m.bridgeState) applyBridgePage(rm, m.bridgeState, v, brOff, i32[bi + EI.BR_N]);
  // dysze
  applyNozzles(m, v, i32[bi + EI.NOZ_OFF], i32[bi + EI.NOZ_N]);
  // ciało
  const bs = i32[bi + EI.BODY_SLOT];
  const hull = m.beamHull;
  if (bs >= 0 && hull) {
    const bgen = i32[bi + EI.BODY_GEN] >>> 0;
    let mb = rm.bodies[bs];
    if (!mb || mb.gen !== bgen) { mb = new MirrorBody(bs, bgen); rm.bodies[bs] = mb; }
    const storeVer = v.bodyI32[bs * BODY.stride.i32 + BODY.I32.STORE_VER];
    if (mb.storeVer !== storeVer) {
      const topo = rm.topologyOf ? rm.topologyOf(bs, bgen, storeVer) : null;
      if (topo) mb.setTopology(topo, storeVer);
      else rm.stats.waitingTopology++;
    }
    applyBodyPage(mb, v, bs);
    applyHullPage(hull, v, bs, rm.dict);
    mb.entity = m;
    mb.spriteSkin = hull.spriteSkin;
    mb.dims = hull.dims;
    mb.anchored = hull.anchored;
    hull.body = mb;
  }
}

/** Czy HP węzłów ciała jest w replice albo na tej stronie (slot ciała < 0 — bez ciała: tak). */
function bodyHpReady(rm, v, bs, bgen) {
  if (bs < 0) return true;
  if (v.bodyI32[bs * BODY.stride.i32 + BODY.I32.HP_F64_OFF] >= 0) return true;
  const mb = rm.bodies[bs];
  return !!(mb && mb.gen === bgen && mb.hpReceived);
}

/** Trafienia tarczy (najnowsze pierwsze, jak shield.impacts): obiekty z puli lustra, aktualizowane w miejscu. */
function applyImpacts(sh, v, off, n, dict) {
  const out = sh.impacts, pool = sh._impPool;
  out.length = 0;
  if (n <= 0) return;
  const F = v.impF64;
  for (let j = 0; j < n; j++) {
    let t = pool[j];
    if (!t) { t = { id: 0, gridAngle: 0, damage: 0, intensity: 0, fxClass: undefined }; pool[j] = t; }
    const o = (off + j) * IMPACT.STRIDE;
    t.id = F[o + IMPACT.ID];
    t.gridAngle = F[o + IMPACT.GRID_ANGLE];
    t.damage = und(F[o + IMPACT.DAMAGE]);
    t.intensity = und(F[o + IMPACT.INTENSITY]);
    t.fxClass = dict.value(F[o + IMPACT.FX_CLASS]);
    out.push(t);
  }
}

/** Pola rekordu kadłuba zmienne w czasie (BODY): kotwica, skala, pivot (odłamy 'com'), flagi, ród. */
function applyHullPage(hull, v, bs, dict) {
  const f64 = v.bodyF64, i32 = v.bodyI32;
  const b = bs * BODY.stride.f64, bi = bs * BODY.stride.i32;
  const BF = BODY.F64, BI = BODY.I32;
  hull.anchorDX = und(f64[b + BF.ANCHOR_DX]);
  hull.anchorDY = und(f64[b + BF.ANCHOR_DY]);
  hull.scale = und(f64[b + BF.SCALE]);
  hull.srcWidth = und(f64[b + BF.SRC_W]);
  hull.srcHeight = und(f64[b + BF.SRC_H]);
  const px = f64[b + BF.PIVOT_X];
  if (px === px) {
    if (!hull.pivot) hull.pivot = { x: 0, y: 0 };
    hull.pivot.x = px; hull.pivot.y = f64[b + BF.PIVOT_Y];
  }
  const fl = i32[bi + BI.FLAGS];
  hull.isFragment = (fl & BODY_FLAG.FRAGMENT) !== 0;
  hull.anchorMode = (fl & BODY_FLAG.ANCHOR_COM) !== 0 ? 'com' : hull.anchorMode;
  hull.solid3D = (fl & BODY_FLAG.SOLID3D) !== 0 ? (hull.solid3D || true) : null;
  hull.world = (fl & BODY_FLAG.WORLD) !== 0 ? (hull.world || true) : null;
  hull.disableSolidArmorLod = (fl & BODY_FLAG.NO_SOLID_LOD) !== 0;
  hull.dmgKey = dict.value(i32[bi + BI.DMG_KEY]);
  hull.revision = i32[bi + BI.REVISION];
}

/** Dysze ze strony: obiekty dysz luster aktualizowane w miejscu (EngineVfxSystem trzyma je jako `slot.source`). */
function applyNozzles(m, v, off, n) {
  const vis = m.visual;
  if (!vis || n <= 0) return;
  const main = vis.mainThrusters, side = vis.torqueThrusters, eng = m.engines;
  let iMain = 0, iSide = 0;
  for (let j = 0; j < n; j++) {
    const o = off + j;
    const kind = v.nozI32[o * NOZZLE.stride.i32 + NI.KIND];
    let t = null;
    if (kind === 0) t = main ? main[iMain++] : null;
    else if (kind === 1) t = side ? side[iSide++] : null;
    else t = eng ? eng.main : null;
    if (!t) continue;
    const b = o * NOZZLE.stride.f64;
    const f = v.nozF64;
    t.__throttle = und(f[b + NF.THROTTLE]);
    t.vfxScale = und(f[b + NF.VFX_SCALE]);
    t.nozzleDeg = und(f[b + NF.NOZZLE_DEG]);
    t.baseDeg = und(f[b + NF.BASE_DEG]);
    t.gimbalMinDeg = und(f[b + NF.GIMBAL_MIN]);
    t.gimbalMaxDeg = und(f[b + NF.GIMBAL_MAX]);
    const fl = v.nozI32[o * NOZZLE.stride.i32 + NI.FLAGS];
    t.__destroyed = (fl & 1) !== 0 ? true : undefined;
  }
}

/**
 * Uzgodnienie drzewa opisu z obiektami lustra: węzeł z `__oid` widzianym wcześniej → TEN SAM obiekt lustra, pola
 * nadpisane w miejscu (klucze spoza opisu — np. pisane przez render: `model3D`, `fxBurst`, `lit` — zostają); nowy
 * `__oid` → nowy obiekt. `used` zbiera obiekty tego opisu (pula na następny raz). Tablice typowane — jak są.
 */
export function reconcileDescriptor(node, pool, used) {
  if (node === null || typeof node !== 'object' || ArrayBuffer.isView(node)) return node;
  const id = node.__oid || 0;
  if (Array.isArray(node)) {
    let arr = id ? pool.get(id) : undefined;
    if (!Array.isArray(arr)) arr = [];
    arr.length = node.length;
    for (let i = 0; i < node.length; i++) arr[i] = reconcileDescriptor(node[i], pool, used);
    if (id) used.set(id, arr);
    return arr;
  }
  let obj = id ? pool.get(id) : undefined;
  if (!obj || Array.isArray(obj)) obj = {};
  for (const k in node) {
    if (k === '__oid') continue;
    obj[k] = reconcileDescriptor(node[k], pool, used);
  }
  if (id) used.set(id, obj);
  return obj;
}

/**
 * Opis encji (`describeEntity`) → lustro: konfiguracja uzgodniona po `__oid` (tożsamość podobiektów jak w grze —
 * dysze to `slot.source` EngineVfxSystem), kadłub-lustro po tożsamości rekordu kadłuba gry (render porównuje
 * `data.hull !== hull`), obrazy ze slotów zasobów, `bridgeState` z backendem realmu renderu.
 */
export function applyDescriptor(m, desc, resourceOf, bridgeBackends = null, bridgeShared = null, k = 0) {
  const pool = m._oidPool, used = new Map();
  m.visual = reconcileDescriptor(desc.visual, pool, used);
  m.capitalProfile = reconcileDescriptor(desc.capitalProfile, pool, used);
  m.profile = reconcileDescriptor(desc.profile, pool, used);
  m.editorLights = reconcileDescriptor(desc.editorLights, pool, used);
  m.engines = reconcileDescriptor(desc.engines, pool, used);
  m.id = desc.id; m.uid = desc.uid; m.name = desc.name;
  m.type = desc.type; m.shipFrame = desc.shipFrame; m.activeHullId = desc.activeHullId;
  m.worldRef = desc.worldRef || null;
  const db = desc.bridge;
  if (db) {
    let st;
    const bid = db.__oid || 0;
    if (bridgeShared && bid) {
      let ent = bridgeShared.get(bid);
      if (!ent) { ent = { pool: new Map(), st: null, k }; bridgeShared.set(bid, ent); }
      const usedB = new Map();
      st = reconcileDescriptor(db, ent.pool, usedB);
      ent.pool = usedB; ent.st = st; ent.k = k;
      m._bridgeOid = bid;
    } else st = reconcileDescriptor(db, pool, used);
    st.backend = bridgeBackends ? (bridgeBackends[db.backendKind] || null) : null;
    m.bridgeState = st;
  } else { m.bridgeState = null; m._bridgeOid = 0; }
  const dh = desc.hull;
  if (dh) {
    const prev = dh.__oid ? pool.get(dh.__oid) : undefined;
    const hull = prev || {
      entity: m, body: null, image: null, visualImage: null, normalMapImage: null,
      cellSize: undefined, pixelPitch: undefined, nx: undefined, ny: undefined, cellPx: undefined,
      anchorMode: undefined, hexPerNode: undefined, anchorDZ: undefined,
      srcWidth: undefined, srcHeight: undefined, scale: undefined, pivot: null, anchorDX: undefined, anchorDY: undefined,
      isFragment: false, solid3D: null, world: null, disableSolidArmorLod: false, dmgKey: undefined, revision: 0,
      _shadowGrid: null, spriteSkin: null, dims: null, anchored: false
    };
    hull.entity = m;
    hull.image = dh.image >= 0 ? resourceOf(dh.image) : null;
    hull.visualImage = dh.visualImage >= 0 ? resourceOf(dh.visualImage) : null;
    hull.normalMapImage = dh.normalMapImage >= 0 ? resourceOf(dh.normalMapImage) : null;
    hull.cellSize = dh.cellSize; hull.pixelPitch = dh.pixelPitch; hull.nx = dh.nx; hull.ny = dh.ny; hull.cellPx = dh.cellPx;
    hull.anchorMode = dh.anchorMode; hull.hexPerNode = dh.hexPerNode; hull.anchorDZ = dh.anchorDZ;
    hull.spriteSkin = reconcileDescriptor(dh.spriteSkin, pool, used);
    hull.dims = reconcileDescriptor(dh.dims, pool, used);
    hull.anchored = dh.anchored;
    if (dh.__oid) used.set(dh.__oid, hull);
    m.beamHull = hull;
  } else m.beamHull = null;
  m._oidPool = used;
}

/** Rdzenie reaktorów ze strony: lustra po uid (stała tożsamość — mapy renderu po rdzeniu), gospodarz = lustro. */
function applyCores(rm, v) {
  const out = rm.cores;
  out.length = 0;
  const n = v.head[HEAD.N_CORES] | 0;
  const f64 = v.coreF64, i32 = v.coreI32, U = v.coreU8, dict = rm.dict;
  for (let i = 0; i < n; i++) {
    const b = i * CORE.stride.f64, bi = i * CORE.stride.i32;
    const uid = i32[bi + CORE.I32.UID];
    let c = rm._coreMirrors.get(uid);
    if (!c) {
      const d = rm.coreOf ? rm.coreOf(uid) : null;
      if (!d) continue;
      c = {
        uid: d.uid, id: d.id, lineage: d.lineage, gx: d.gx, gy: d.gy, gridR: d.gridR, classId: d.classId, color: d.color,
        kind: d.kind, armorMul: d.armorMul, meltdownSec: d.meltdownSec, chamberMaxHpSum: d.chamberMaxHpSum,
        cellX: d.cellX, cellY: d.cellY, cellBaseHp: d.cellBaseHp, cellMaxHp: d.cellMaxHp, model: d.model || null,
        cellState: new Uint8Array(d.cellX ? d.cellX.length : 0),
        host: null, state: undefined, invalid: null, integrity: 0, meltdownRemaining: 0, meltdownDuration: 0,
        deadCount: 0, elsewhereCount: 0, aliveCount: 0, lastX: 0, lastY: 0
      };
      rm._coreMirrors.set(uid, c);
    }
    const hs = i32[bi + CORE.I32.HOST_SLOT];
    const hm = hs >= 0 ? rm.entities[hs] : null;
    c.host = hm && hm.gen === (i32[bi + CORE.I32.HOST_GEN] >>> 0) ? hm : null;
    c.state = dict.value(i32[bi + CORE.I32.STATE]);
    const inv = dict.value(i32[bi + CORE.I32.INVALID]);
    c.invalid = inv === undefined ? null : inv;
    c.deadCount = i32[bi + CORE.I32.DEAD_COUNT];
    c.elsewhereCount = i32[bi + CORE.I32.ELSEWHERE];
    c.aliveCount = i32[bi + CORE.I32.ALIVE_COUNT];
    c.integrity = und(f64[b + CORE.F64.INTEGRITY]);
    c.meltdownRemaining = und(f64[b + CORE.F64.MELT_REMAIN]);
    c.meltdownDuration = und(f64[b + CORE.F64.MELT_DUR]);
    c.lastX = und(f64[b + CORE.F64.LAST_X]);
    c.lastY = und(f64[b + CORE.F64.LAST_Y]);
    const co = i32[bi + CORE.I32.CELL_OFF];
    if (co >= 0) c.cellState.set(U.subarray(co, co + i32[bi + CORE.I32.CELL_N]));
    else c.cellState.fill(0);
    out.push(c);
  }
}

/** Stacje ze strony (blok STATIONS + opis): lustro na slot i generację; `_mesh3d` pisze render (stations3D). */
function applyStations(rm, v) {
  const out = rm.stations;
  out.length = 0;
  const n = v.head[HEAD.N_STATIONS] | 0;
  const f64 = v.staF64, i32 = v.staI32;
  for (let i = 0; i < n; i++) {
    const b = i * STATION.stride.f64, bi = i * STATION.stride.i32;
    const s = i32[bi + STATION.I32.SLOT];
    if (s < 0) continue;
    const gen = i32[bi + STATION.I32.GEN] >>> 0;
    let st = rm._stationMirrors[s];
    if (!st || st.gen !== gen) {
      const d = rm.stationOf ? rm.stationOf(s, gen) : null;
      if (!d) continue;
      st = {
        __mirror: true, slot: s, gen, id: d.id, name: d.name, style: d.style, type: d.type, isPirate: d.isPirate,
        planet: d.planet, orbit: d.orbit, host: d.host, home: d.home, ringPort: d.ringPort, faction: d.faction,
        world3dPirate: d.world3dPirate === true,
        x: 0, y: 0, angle: 0, r: undefined, baseR: undefined, _destroyed3D: false, fogHidden: false, _mesh3d: undefined, __bridgedMesh: undefined,
        __game: null
      };
      rm._stationMirrors[s] = st;
    }
    st.x = f64[b + STATION.F64.X]; st.y = f64[b + STATION.F64.Y];
    st.angle = und(f64[b + STATION.F64.ANGLE]);
    st.r = und(f64[b + STATION.F64.R]); st.baseR = und(f64[b + STATION.F64.BASE_R]);
    const fl = i32[bi + STATION.I32.FLAGS];
    st._destroyed3D = (fl & 1) !== 0;
    st.fogHidden = (fl & 2) !== 0;
    out.push(st);
  }
}

/** Stan mostków ze strony (blok brF64) na `bridgeState` lustra — wyrzuty atmosfery o tożsamości stałej per obiekt gry. */
function applyBridgePage(rm, st, v, off, n) {
  const F = v.brF64;
  st.commandLost = F[off + BRIDGE_HEAD.CMD_LOST] === 1;
  st.commandLostAt = und(F[off + BRIDGE_HEAD.CMD_LOST_AT]);
  st.vent = ventOf(rm, F, off + BRIDGE_HEAD.VENT);
  const list = st.bridges;
  if (!list) return;
  let p = off + BRIDGE_HEAD.STRIDE;
  const m = n < list.length ? n : list.length;
  for (let j = 0; j < m; j++, p += BRIDGE_REC.STRIDE) {
    const b = list[j];
    if (!b) continue;
    b.dead = F[p + BRIDGE_REC.DEAD] === 1;
    b.deadAt = und(F[p + BRIDGE_REC.DEAD_AT]);
    b.missing = F[p + BRIDGE_REC.MISSING] === 1;
    b.vent = ventOf(rm, F, p + BRIDGE_REC.VENT);
  }
}

function ventOf(rm, F, o) {
  const id = F[o + VENT.ID];
  if (!(id > 0)) return null;
  let vent = rm._vents.get(id);
  if (!vent) {
    vent = { x: 0, y: 0, dirX: 0, dirY: 0, bridgeId: undefined, exitX: 0, exitY: 0 };
    rm._vents.set(id, vent);
  }
  vent.x = F[o + VENT.X]; vent.y = F[o + VENT.Y];
  vent.dirX = F[o + VENT.DIRX]; vent.dirY = F[o + VENT.DIRY];
  vent.exitX = und(F[o + VENT.EXITX]); vent.exitY = und(F[o + VENT.EXITY]);
  vent.bridgeId = rm.dict.value(F[o + VENT.BID]);
  return vent;
}
