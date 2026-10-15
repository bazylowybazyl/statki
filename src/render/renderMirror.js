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
// Pola, które dziś piszą moduły renderu na obiektach gry (`__cloakLook`, `__warpHullU`, `__warpNurtMode`, `__bayCut`,
// `__hiddenFromView`, `__inDrawBox`, `_shadowGrid`, `__engineFxFallback`, `_lattice`), lądują w lustrach.
//
// Czysty moduł (bez three, DOM i `window`).

import { LIST, ENT, ENT_FLAG, ENT_FLAG2, NOZZLE, BODY, BODY_FLAG, HEAD } from './snapshotLayout.js';
import { MirrorBody, applyBodyPage } from './mirrorBody.js';

const EF = ENT.F64, EI = ENT.I32;
const NF = NOZZLE.F64, NI = NOZZLE.I32;

/** NaN ze strony → undefined na lustrze (pole nieobecne na obiekcie gry). */
const und = (v) => (v === v ? v : undefined);

/** Dysza-lustro: pola czytane przez EngineVfxSystem i lakier (statyczne z opisu, dynamiczne z NOZZLES). */
export class MirrorNozzle {
  constructor(src) {
    // statyczne (opis): offset, forward, mount, side
    this.offset = src && src.offset ? { x: src.offset.x, y: src.offset.y } : undefined;
    this.forward = src && src.forward ? { x: src.forward.x, y: src.forward.y } : undefined;
    this.mount = src ? src.mount : undefined;
    this.side = src ? src.side : undefined;
    // dynamiczne (NOZZLES)
    this.baseDeg = src ? src.baseDeg : undefined;
    this.gimbalMinDeg = src ? src.gimbalMinDeg : undefined;
    this.gimbalMaxDeg = src ? src.gimbalMaxDeg : undefined;
    this.nozzleDeg = src ? src.nozzleDeg : undefined;
    this.__throttle = src ? src.__throttle : undefined;
    this.vfxScale = src ? src.vfxScale : undefined;
    this.__destroyed = src ? src.__destroyed : undefined;
  }
}

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
    this.isPirate = false; this.friendly = false; this.hideHexVisual = false; this.hexGrid = null;
    this.isRingSegment = false; this.isAsteroidHex = false; this.isCapitalShip = false; this.isBridgeHulk = false;
    this.lightsOff = false; this.roadLightsOff = false;
    this.__lightsHidden = false; this.__enginesHidden = false; this.__turretsHidden = false;
    this.__editorBoost = false; this.__fSysBoost = false; this.__warpPreview = false;
    this.fogHidden = false;
    this.state = undefined; this.phase = undefined;
    this.id = undefined; this.uid = undefined; this.name = undefined;
    this.type = undefined; this.shipFrame = undefined; this.activeHullId = undefined;
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
    // pisane przez render
    this.__cloakLook = undefined; this.__warpHullU = undefined; this.__warpNurtMode = undefined; this.__bayCut = undefined;
    this.__hiddenFromView = false; this.__inDrawBox = false; this.__engineFxFallback = undefined;
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
  constructor({ dict, describe = null, topologyOf = null, resourceOf = null } = {}) {
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
    this._breaks = new Map();    // numer zerwania maskowania → obiekt (tożsamość jak cloak.lastBreak gry)
    this.stats = { created: 0, dropped: 0, waitingDescriptor: 0, waitingTopology: 0 };
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
  m.isAsteroidHex = (flags & ENT_FLAG.ASTEROID_HEX) !== 0;
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
    if (!m.shield) m.shield = { max: 0, val: 0, state: undefined, activationProgress: 0, hardness: undefined, show: undefined, impacts: null, impactId: 0 };
    const sh = m.shield;
    sh.max = und(f64[b + EF.SH_MAX]); sh.val = und(f64[b + EF.SH_VAL]);
    sh.activationProgress = und(f64[b + EF.SH_ACT]); sh.hardness = und(f64[b + EF.SH_HARD]);
    sh.show = und(f64[b + EF.SH_SHOW]);
    sh.state = dict.value(i32[bi + EI.SH_STATE]);
    sh.impactId = i32[bi + EI.SH_IMPACT_ID];
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
    const desc = rm.describe ? rm.describe(s, m.gen, i32, bi + EI.V_VISUAL) : null;
    if (desc) {
      applyDescriptor(m, desc, rm.resourceOf);
      for (let q = 0; q < 6; q++) dv[q] = i32[bi + EI.V_VISUAL + q];
    } else rm.stats.waitingDescriptor++;
  }
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
 * Opis encji (`describeEntity`) → lustro: kopie konfiguracji (dysze → MirrorNozzle — EngineVfxSystem trzyma je jako
 * `slot.source`, pola klatki z NOZZLES), kadłub-lustro (obrazy ze slotów zasobów; pola zmienne — z BODY co klatkę).
 */
export function applyDescriptor(m, desc, resourceOf) {
  const vis = desc.visual ? { ...desc.visual } : desc.visual;
  if (vis) {
    if (Array.isArray(vis.mainThrusters)) vis.mainThrusters = vis.mainThrusters.map((t) => (t ? new MirrorNozzle(t) : t));
    if (Array.isArray(vis.torqueThrusters)) vis.torqueThrusters = vis.torqueThrusters.map((t) => (t ? new MirrorNozzle(t) : t));
  }
  m.visual = vis;
  m.capitalProfile = desc.capitalProfile;
  m.profile = desc.profile;
  m.editorLights = desc.editorLights;
  const en = desc.engines;
  m.engines = en ? { main: en.main ? Object.assign(new MirrorNozzle(en.main), {
    visualOffset: en.main.visualOffset, vfxOffset: en.main.vfxOffset, vfxForward: en.main.vfxForward,
    vfxYNudge: en.main.vfxYNudge, maxThrust: en.main.maxThrust
  }) : en.main } : en;
  m.id = desc.id; m.uid = desc.uid; m.name = desc.name;
  m.type = desc.type; m.shipFrame = desc.shipFrame; m.activeHullId = desc.activeHullId;
  const dh = desc.hull;
  if (dh) {
    // kadłub-lustro: nowy obiekt przy nowym opisie kadłuba (render porównuje `data.hull !== hull` → nowa skóra,
    // jak przy podmianie rekordu kadłuba w grze); obrazy — te same obiekty zasobów (tożsamość = klucz tekstury)
    const prev = m.beamHull;
    const hull = {
      entity: m, body: prev ? prev.body : null,
      image: dh.image >= 0 ? resourceOf(dh.image) : null,
      visualImage: dh.visualImage >= 0 ? resourceOf(dh.visualImage) : null,
      normalMapImage: dh.normalMapImage >= 0 ? resourceOf(dh.normalMapImage) : null,
      cellSize: dh.cellSize, pixelPitch: dh.pixelPitch, nx: dh.nx, ny: dh.ny, cellPx: dh.cellPx,
      anchorMode: dh.anchorMode, hexPerNode: dh.hexPerNode, anchorDZ: dh.anchorDZ,
      srcWidth: undefined, srcHeight: undefined, scale: undefined, pivot: null, anchorDX: undefined, anchorDY: undefined,
      isFragment: false, solid3D: null, world: null, disableSolidArmorLod: false, dmgKey: undefined,
      _shadowGrid: null, spriteSkin: dh.spriteSkin, dims: dh.dims, anchored: dh.anchored
    };
    m.beamHull = hull;
  } else m.beamHull = null;
}
