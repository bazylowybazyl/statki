// src/game/reactorCore.js
//
// RDZEŃ STATKU (reaktor) NA KADŁUBIE BELKOWYM — nowa wersja mechaniki z dema rdzenia
// (dema/rdzen-demo.html stoi na kadłubach heksowych, src/game/shipCore.js) dla silnika belek gry
// (src/game/hullBodies.js). Logika bez DOM i bez three; obraz: src/3d/reactorBlast/ (wybuch
// WebGPU) i src/3d/reactor3D.js (model reaktora w wyrwie). Demo: dema/rdzen-webgpu.html.
//
// Model (stany, profile klas, warianty, liczby — coreModel.js, wspólne z wersją heksową):
//   • rdzeń = marker `cores[]` edytora (PNG sprite'a: (0,0) = środek, +X dziób, y w dół) + komora
//     o promieniu `r` (PNG) i pancerzu `armorMul`;
//   • komora = KOMÓRKI siatki belek (ix, iy) w promieniu r od punktu, liczone RAZ z pozycji
//     spoczynkowych. Komórka jest tożsamością odporną na rozpad: indeksy węzłów zmieniają się
//     przy podziale ciała (wrak przenumerowuje magazyn, gospodarz się kompaktuje), a (ix, iy)
//     i wymiary siatki są wspólne dla kadłuba, jego wraków i odłamów (jeden ród — `hull.dmgKey`);
//   • pancerz: hp i maxHp węzłów komory × armorMul. Czyta go tylko krater z budżetu HP (lekka
//     i średnia broń) — ciężka broń z kraterem na miarę rany, rzazy, zgniot i rozpad zabijają
//     węzły bez patrzenia na HP (koszt dojścia do komory = grubość kadłuba nad nią);
//   • osłona = Σ HP żywych węzłów komory u gospodarza / Σ pancerza komory;
//   • stany: NOMINALNY → ODSŁONIĘTY (padła komórka komory) → KRYTYCZNY (osłona < 60%, także od
//     fali sąsiada bez dziury) → STOPIENIE (osłona ≤ 30% albo sonda punktu, odliczanie klasy,
//     nieodwracalne) → DETONACJA (zawsze);
//   • odcięcie: większość żywych komórek komory na innym ciele rodu → rdzeń przechodzi na ten
//     wrak (odliczanie × 0,5), stary gospodarz traci zasilanie (`reactorLost`).
//
// Detonacja (applyReactorDetonation): kadłub → wrak, krater wokół RDZENIA (nie środka kadłuba),
// pęknięcia albo kanał wg wariantu (rozprysk, przełamanie, rozerwanie na trzy, wyrwa, wyrzut
// strumienia, kula plazmy), rozpad od razu (processSplits) i pchnięcie odłamów. Fala na sąsiadów
// (applyReactorBlast): krater od strony wybuchu, fala na komory (napęd łańcucha), znacznik
// łańcucha, pula HP przez hak. Zagrożenia po detonacji: strumień plazmy (stepReactorJet — rzaz
// z pędem w pierwszym kadłubie na promieniu, odrzut obraca wrak i wodzi strumieniem) i kula
// plazmy (stepReactorOrbs — topi wszystko w promieniu, także własny kadłub, którym wychodzi).
// Wybuchy wtórne: komórki odłamów (planReactorSecondaries / locateReactorCell).
//
// Układy: świat gry (x, y w dół); ciało silnika: X = x, Y = −y, θ = −(kąt + obrót sprite'a);
// siatka = ciało − latticeMin (stała przy rozpadzie, ta sama w odłamach). Rdzeń i komórki —
// pozycje SPOCZYNKOWE (rdzeń to punkt w konstrukcji, nie w wgniecionej blasze).
//
// Losowość rozgrywki: tylko generatory z ziarnem (makeCoreRng) — bez Math.random, więc wariant,
// kierunek wyrzutu i rozpad są powtarzalne przy tym samym ziarnie.

import { HullBodies, hullImpactResult } from './hullBodies.js';
import { activateNode } from './beamActiveRegion3D.js';
import {
  CORE_STATE, CORE_STATE_RANK, CORE_STATE_LABEL, coreStateRank, CORE_KILL_MODE, CORE_PROBE_CONFIG,
  CORE_DEFAULTS, resolveCoreClassId, getCoreClassProfile, normalizeCoreMarker, computeCoreBlast,
  coreBlastFalloff, makeCoreRng, CORE_DETONATION_VARIANTS, CORE_JET_PROFILES, JET_MIN_LENGTH,
  CORE_ORB_PROFILES, ORB_TRAPPED_SEC, CORE_SECONDARY_PROFILES, coreSmoothNoise1,
  chooseCoreDetonationVariant, applyVariantToBlast, coreJetEnvelope, rollSecondaryBlasts
} from './coreModel.js';

export {
  CORE_STATE, CORE_STATE_LABEL, coreStateRank, CORE_KILL_MODE, CORE_DEFAULTS, CORE_DETONATION_VARIANTS,
  CORE_JET_PROFILES, CORE_ORB_PROFILES, computeCoreBlast, applyVariantToBlast, chooseCoreDetonationVariant,
  coreJetEnvelope, rollSecondaryBlasts
};

const D = HullBodies.engine;
const TAU = Math.PI * 2;
const STATE_RANK = CORE_STATE_RANK;

// Rzaz strumienia w trafionym kadłubie: tempo drążenia [j./s] i półszerokość (× szerokość strumienia).
// Wersja heksowa robiła krater applyImpact co takt; na belkach strumień tnie jak Hexlance — rzaz
// z pędem (odłamki lecą wzdłuż strumienia, kadłub dostaje impuls).
export const REACTOR_JET_CUT = Object.freeze({
  escort: Object.freeze({ cutPerSec: 170, halfWidthMul: 0.3 }),
  cruiser: Object.freeze({ cutPerSec: 230, halfWidthMul: 0.32 }),
  capital: Object.freeze({ cutPerSec: 290, halfWidthMul: 0.34 })
});

// Parametry rozpadu przy detonacji: prędkość odłamków (wyparowany metal) i pchnięcie odłamów.
export const REACTOR_BREAKUP = Object.freeze({
  kickSpeed: 240,         // [j/s] pchnięcie odłamów (radialnie, × 0,75–1,35)
  vaporSpeedMin: 380,     // [j/s] odłamki krateru (od rdzenia)
  vaporSpeedMax: 900,
  // Półszerokość pęknięcia × komórka (× 1–1,6 szumem). Pas węższy niż ~0,75 komórki przepuszcza
  // węzły siatki pod ukosem — belki łączą brzegi szczeliny i kadłub nie pęka (jak cutLocalBand
  // w HullBodies.shatter: 0,75 komórki).
  crackCells: 0.8,
  jetChannelMul: 0.55,    // półszerokość kanału strumienia × promień komory
  recoilSpin: 0.0025,     // obrót od odrzutu: moment × to (rad/s na j. ramienia), sufit ±0,5
  edgeSamples: 64,        // punkty brzegu rany dla efektów (żar, iskry)
  neighborPush: 70        // [j/s] pchnięcie sąsiada w AoE przy spadku 1 (× promień źródła / promień celu)
});

// Fala na komory sąsiadów na belkach (napęd łańcucha). Liczby profili klas są „na heks” (wersja
// heksowa): węzeł belek to hexPerNode (~4) heksów, więc obrażenia fali × hexPerNode (zasada
// AGENTS.md: wartości „na komórkę” przez hexPerNode). Promień: kadłuby belkowe mają mniejszy
// promień niż heksowe (Bellator 330 zamiast 540 — AoE = 6 × promień), więc fala sięga 0,65 AoE
// (dawniej 0,4 AoE heksów ≈ 1300 j.) — formacja ~700 j. łańcuchuje jak w demie heksowym.
export const REACTOR_BEAM_TUNE = Object.freeze({
  shockRadiusMul: 0.65
});

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function entityPosX(e) { return (e?.pos && typeof e.pos.x === 'number') ? e.pos.x : finite(e?.x); }
function entityPosY(e) { return (e?.pos && typeof e.pos.y === 'number') ? e.pos.y : finite(e?.y); }
function entityVelX(e) { return (e?.vel && typeof e.vel.x === 'number') ? e.vel.x : finite(e?.vx); }
function entityVelY(e) { return (e?.vel && typeof e.vel.y === 'number') ? e.vel.y : finite(e?.vy); }

// NPC całkują x/vx (pos/vel = lustro), gracz pos/vel — piszemy obie formy, jeśli są.
function addEntityVel(e, dvx, dvy) {
  if (!e) return;
  e.vx = finite(e.vx) + dvx;
  e.vy = finite(e.vy) + dvy;
  if (e.vel && typeof e.vel === 'object') { e.vel.x = finite(e.vel.x) + dvx; e.vel.y = finite(e.vel.y) + dvy; }
  if (e.isWreck) { e._wreckSleeping = false; e._wreckSleepTimer = 0; }
}

let _uidSeq = 0;

// ============================ UKŁADY ============================

const _pose = { x: 0, y: 0, theta: 0, c: 1, s: 0 };
const _p = { x: 0, y: 0 };
const _q = { x: 0, y: 0 };

/** Kadłub belkowy encji (żywy i należący do niej) albo null. */
export function reactorHull(entity) {
  const h = entity?.beamHull;
  return h && h.entity === entity && h.body && !h.body.dead ? h : null;
}

function localToWorld(hull, lx, ly, out) {
  const pose = HullBodies.entityPose(hull, _pose);
  const dx = lx - HullBodies.anchorLocalX(hull), dy = ly - HullBodies.anchorLocalY(hull);
  out.x = pose.x + pose.c * dx - pose.s * dy;
  out.y = pose.y - (pose.s * dx + pose.c * dy);
  return out;
}

function worldToLocal(hull, wx, wy, out) {
  const pose = HullBodies.entityPose(hull, _pose);
  const dx = wx - pose.x, dy = -(wy - pose.y);
  out.x = pose.c * dx + pose.s * dy + HullBodies.anchorLocalX(hull);
  out.y = -pose.s * dx + pose.c * dy + HullBodies.anchorLocalY(hull);
  return out;
}

/** Kierunek w układzie ciała → świat gry (jednostkowy wektor zostaje jednostkowy). */
export function reactorLocalDirToWorld(hull, dx, dy, out = {}) {
  const pose = HullBodies.entityPose(hull, _pose);
  out.x = pose.c * dx - pose.s * dy;
  out.y = -(pose.s * dx + pose.c * dy);
  return out;
}

/** Kierunek w świecie gry → układ ciała. */
export function reactorWorldDirToLocal(hull, ux, uy, out = {}) {
  const pose = HullBodies.entityPose(hull, _pose);
  out.x = pose.c * ux - pose.s * uy;
  out.y = -pose.s * ux - pose.c * uy;
  return out;
}

/** Środek rdzenia w świecie gry (pozycja spoczynkowa u bieżącego gospodarza). */
export function reactorCoreWorld(core, out = {}) {
  const hull = reactorHull(core?.host);
  if (!hull) { out.x = finite(core?.lastX); out.y = finite(core?.lastY); return out; }
  const lm = hull.body.latticeMin;
  localToWorld(hull, lm.x + core.gx, lm.y + core.gy, out);
  core.lastX = out.x;
  core.lastY = out.y;
  return out;
}

/**
 * Rama rdzenia dla modelu reaktora (reactor3D): środek w świecie i dwa wektory długości promienia
 * komory — X wzdłuż +x sprite'a (dziób), Y w dół obrazka (jak siatka heksów wersji heksowej).
 * Wynik: { x, y, axX, axY, ayX, ayY, R }.
 */
export function reactorCoreFrame(core, out = {}) {
  reactorCoreWorld(core, out);
  const hull = reactorHull(core?.host);
  const R = finite(core?.gridR, 1);
  out.R = R;
  if (!hull) { out.axX = R; out.axY = 0; out.ayX = 0; out.ayY = R; return out; }
  reactorLocalDirToWorld(hull, 1, 0, _q);
  out.axX = _q.x * R; out.axY = _q.y * R;
  // obraz w dół = −Y ciała
  reactorLocalDirToWorld(hull, 0, -1, _q);
  out.ayX = _q.x * R; out.ayY = _q.y * R;
  return out;
}

/** Pozycja spoczynkowa komórki komory k w świecie gry (u bieżącego gospodarza). */
export function reactorCellWorld(core, k, out = {}) {
  const hull = reactorHull(core?.host);
  if (!hull) { out.x = finite(core?.lastX); out.y = finite(core?.lastY); return out; }
  const b = hull.body, cs = b.cellSize, lm = b.latticeMin;
  return localToWorld(hull, lm.x + (core.cellX[k] + 0.5) * cs, lm.y + (core.cellY[k] + 0.5) * cs, out);
}

/** Indeks żywego węzła komórki (ix, iy) w ciele kadłuba albo −1. */
export function reactorCellNode(hull, ix, iy) {
  if (!hull) return -1;
  const b = hull.body, d = b.dims;
  if (ix < 0 || iy < 0 || ix >= d.x || iy >= d.y) return -1;
  const i = D._latticeIndex(b).cells[ix + iy * d.x];
  return i >= 0 && b.nodeStore.active[i] ? i : -1;
}

// ============================ MONTAŻ ============================

/**
 * Montuje rdzenie na kadłubie belkowym (po HullBodies.createHull).
 * @param {object} entity  encja z beamHull
 * @param {Array} markers  markery `cores[]` w przestrzeni PNG
 * @param {object} options { pngWidth, pngHeight, classId?, killMode?, config?, color?, kind? }
 * @returns {Array} rdzenie (także w entity.reactorCores)
 */
export function attachReactorCores(entity, markers, options = {}) {
  const hull = reactorHull(entity);
  if (!hull) return [];
  detachReactorCores(entity);
  const img = hull.visualImage;
  const pngW = positive(options.pngWidth, positive(img?.naturalWidth ?? img?.width, hull.srcWidth));
  const pngH = positive(options.pngHeight, positive(img?.naturalHeight ?? img?.height, hull.srcHeight));
  const layout = { x: hull.srcWidth / pngW, y: hull.srcHeight / pngH, uniform: 1, pngWidth: pngW, pngHeight: pngH };
  layout.uniform = (layout.x + layout.y) * 0.5;
  const opts = {
    layout,
    classId: options.classId || null,
    killMode: options.killMode || CORE_DEFAULTS.killMode,
    config: { ...CORE_DEFAULTS, ...(options.config || {}) },
    color: options.color || null,
    kind: options.kind || null
  };
  const claimed = new Set();
  const cores = [];
  const list = Array.isArray(markers) ? markers : [];
  for (let i = 0; i < list.length; i++) {
    const marker = normalizeCoreMarker(list[i], i);
    if (!marker) continue;
    cores.push(buildCore(entity, hull, marker, i, opts, claimed));
  }
  entity.reactorCores = cores;
  entity.__reactorLayout = layout;
  return cores;
}

function buildCore(entity, hull, marker, index, opts, claimed) {
  const body = hull.body, s = body.nodeStore, lm = body.latticeMin, dx = body.dims.x;
  const layout = opts.layout;
  const classId = marker.profile || opts.classId || resolveCoreClassId(entity);
  const profile = getCoreClassProfile(classId);
  const rPng = positive(marker.r, profile.chamberR / layout.uniform);
  const armorMul = positive(marker.armorMul, profile.armorMul);
  // PNG → obraz fizyki (środek) → układ ciała.
  const sx = finite(marker.x) * layout.x, sy = finite(marker.y) * layout.y;
  const lx = lm.x + hull.anchorDX + sx * hull.scale;
  const ly = lm.y + hull.anchorDY - sy * hull.scale;
  const R = rPng * layout.uniform * hull.scale;
  const R2 = R * R;
  const ixs = [], iys = [], base = [], maxs = [];
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const ex = s.ox[i] - lx, ey = s.oy[i] - ly;
    if (ex * ex + ey * ey > R2) continue;
    const key = s.ix[i] + s.iy[i] * dx;
    if (claimed.has(key)) continue; // komory się nie nakładają
    claimed.add(key);
    // Pancerz: maxHp × armorMul, ten sam ułamek zdrowia.
    const b0 = s.maxHp[i];
    const frac = b0 > 0 ? Math.max(0, s.hp[i]) / b0 : 1;
    s.maxHp[i] = b0 * armorMul;
    s.hp[i] = frac * s.maxHp[i];
    ixs.push(s.ix[i]); iys.push(s.iy[i]); base.push(b0); maxs.push(s.maxHp[i]);
  }
  const n = ixs.length;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += maxs[k];
  const core = {
    id: marker.id || `core_${index}`,
    uid: ++_uidSeq,
    marker: { ...marker, r: rPng, armorMul },
    classId,
    profile,
    killMode: opts.killMode,
    config: opts.config,
    host: entity,
    origin: entity,
    lineage: hull.dmgKey,
    // środek w siatce (ciało − latticeMin) i promień komory [j. świata]
    gx: lx - lm.x,
    gy: ly - lm.y,
    gridR: R,
    armorMul,
    meltdownSec: positive(marker.meltdownSec, profile.meltdownSec),
    color: marker.color || opts.color || null,
    kind: opts.kind,
    cellX: Int16Array.from(ixs),
    cellY: Int16Array.from(iys),
    cellBaseHp: Float32Array.from(base),
    cellMaxHp: Float32Array.from(maxs),
    // 0 — żywa u gospodarza, 1 — martwa (albo poza gospodarzem), 2 — żywa na innym ciele rodu
    cellState: new Uint8Array(n),
    chamberMaxHpSum: sum,
    aliveCount: n,
    deadCount: 0,
    elsewhereCount: 0,
    integrity: 1,
    invalid: n === 0 ? 'poza-kadłubem' : null,
    state: CORE_STATE.NOMINAL,
    stateTime: 0,
    stateEnteredAt: 0,
    exposedAt: -1,
    criticalAt: -1,
    meltdownAt: -1,
    meltdownDuration: 0,
    meltdownRemaining: 0,
    detonatedAt: -1,
    cause: null,
    chainDepth: 0,
    severed: false,
    probeTimer: 0,
    probeMisses: 0,
    probeSupported: true,
    pendingVariant: null,
    lastX: 0,
    lastY: 0
  };
  reactorCoreWorld(core, _p);
  return core;
}

/** Zdejmuje rdzenie z encji i przywraca pancerz komór (tylko u bieżącego gospodarza). */
export function detachReactorCores(entity) {
  const cores = entity?.reactorCores;
  if (!Array.isArray(cores)) return;
  const hull = reactorHull(entity);
  for (const core of cores) {
    if (!hull || core.host !== entity) continue;
    const s = hull.body.nodeStore;
    for (let k = 0; k < core.cellX.length; k++) {
      const i = reactorCellNode(hull, core.cellX[k], core.cellY[k]);
      if (i < 0) continue;
      const m = s.maxHp[i];
      const frac = m > 0 ? Math.max(0, s.hp[i]) / m : 1;
      s.maxHp[i] = core.cellBaseHp[k];
      s.hp[i] = frac * core.cellBaseHp[k];
    }
  }
  entity.reactorCores = [];
}

// ============================ OCENA KOMORY ============================

function sampleChamber(core) {
  const hull = reactorHull(core.host);
  const n = core.cellX.length;
  const st = core.cellState;
  let alive = 0;
  let hp = 0;
  if (hull) {
    const b = hull.body, s = b.nodeStore, d = b.dims, cells = D._latticeIndex(b).cells;
    for (let k = 0; k < n; k++) {
      const ix = core.cellX[k], iy = core.cellY[k];
      const i = ix < d.x && iy < d.y ? cells[ix + iy * d.x] : -1;
      if (i >= 0 && s.active[i]) {
        st[k] = 0;
        alive++;
        const h = s.hp[i], m = s.maxHp[i];
        hp += h < 0 ? 0 : (h > m ? m : h);
      } else {
        st[k] = 1;
      }
    }
  } else {
    for (let k = 0; k < n; k++) st[k] = 1;
  }
  core.aliveCount = alive;
  core.integrity = core.chamberMaxHpSum > 0 ? Math.max(0, Math.min(1, hp / core.chamberMaxHpSum)) : 0;
}

const _owners = [];
const _counts = [];

// Komórki nieżywe u gospodarza, a żywe na innym ciele rodu (odłam po rozpadzie): liczy je i zwraca
// ciało z największą ich liczbą (encję) w core._bestOwner.
function sampleElsewhere(core, candidates) {
  core.elsewhereCount = 0;
  core._bestOwner = null;
  core._bestCount = 0;
  if (core.aliveCount >= core.cellX.length || !Array.isArray(candidates)) {
    core.deadCount = core.cellX.length - core.aliveCount;
    return;
  }
  _owners.length = 0;
  _counts.length = 0;
  for (let c = 0; c < candidates.length; c++) {
    const e = candidates[c];
    if (!e || e === core.host) continue;
    const h = reactorHull(e);
    if (!h || h.dmgKey !== core.lineage) continue;
    _owners.push(h);
    _counts.push(0);
  }
  if (_owners.length) {
    const st = core.cellState;
    for (let k = 0; k < st.length; k++) {
      if (st[k] === 0) continue;
      for (let o = 0; o < _owners.length; o++) {
        if (reactorCellNode(_owners[o], core.cellX[k], core.cellY[k]) >= 0) {
          st[k] = 2;
          _counts[o]++;
          core.elsewhereCount++;
          break;
        }
      }
    }
    for (let o = 0; o < _owners.length; o++) {
      if (_counts[o] > core._bestCount) { core._bestCount = _counts[o]; core._bestOwner = _owners[o].entity; }
    }
  }
  core.deadCount = core.cellX.length - core.aliveCount - core.elsewhereCount;
  _owners.length = 0;
}

// Sonda punktu jak w grze (isCoreHexSupported): środek i 4 punkty na promieniu coreProbeRadius.
export function probeReactorSupport(core) {
  const host = core.host;
  const hull = reactorHull(host);
  if (!hull) return false;
  const w = reactorCoreWorld(core, _p);
  const layout = host.__reactorLayout || { uniform: 1 };
  const r = CORE_PROBE_CONFIG.coreProbeRadius * layout.uniform * hull.scale;
  const x = w.x, y = w.y;
  return HullBodies.probe(host, x, y) || HullBodies.probe(host, x + r, y) || HullBodies.probe(host, x - r, y)
    || HullBodies.probe(host, x, y + r) || HullBodies.probe(host, x, y - r);
}

// ============================ MASZYNA STANÓW ============================

function setState(core, next, time, events, extra = null) {
  const prev = core.state;
  if (prev === next) return;
  core.state = next;
  core.stateTime = 0;
  core.stateEnteredAt = time;
  if (next === CORE_STATE.EXPOSED && core.exposedAt < 0) core.exposedAt = time;
  if (next === CORE_STATE.CRITICAL && core.criticalAt < 0) core.criticalAt = time;
  if (events) events.push({ type: 'state', core, host: core.host, from: prev, to: next, time, ...(extra || {}) });
}

function beginMeltdown(core, time, cause, events, durationMul = 1) {
  if (coreStateRank(core.state) >= STATE_RANK.meltdown) return false;
  if (core.exposedAt < 0) core.exposedAt = time;
  const host = core.host;
  const chain = host?.__coreChain;
  if (chain && time <= chain.until && (cause === 'containment' || cause === 'probe' || cause === 'attrition')) {
    core.chainDepth = chain.depth;
    core.cause = 'chain';
  } else {
    core.cause = cause;
  }
  core.meltdownAt = time;
  // Wariant znany od początku stopienia: obraz zapowiada wybuch (implozja, kierunek wyrzutu).
  core.pendingVariant = chooseCoreDetonationVariant(core, { time });
  core.meltdownDuration = Math.max(0.05, core.meltdownSec * durationMul);
  core.meltdownRemaining = core.meltdownDuration;
  setState(core, CORE_STATE.MELTDOWN, time, events, { cause: core.cause, duration: core.meltdownDuration, chainDepth: core.chainDepth });
  if (host) host.__coreDoomed = true;
  return true;
}

function detonate(core, time, events, reason) {
  if (core.state === CORE_STATE.DETONATED) return false;
  core.meltdownRemaining = 0;
  core.detonatedAt = time;
  const w = reactorCoreWorld(core, {});
  const from = core.state;
  core.state = CORE_STATE.DETONATED;
  core.stateTime = 0;
  core.stateEnteredAt = time;
  if (events) {
    events.push({ type: 'state', core, host: core.host, from, to: CORE_STATE.DETONATED, time, reason });
    const variant = core.pendingVariant || chooseCoreDetonationVariant(core, { time });
    events.push({
      type: 'detonate', core, host: core.host, x: w.x, y: w.y, time, reason, variant,
      blast: applyVariantToBlast(computeCoreBlast(core), variant)
    });
  }
  return true;
}

function handleSevering(core, time, events) {
  if (core.elsewhereCount <= core.aliveCount) return false;
  const best = core._bestOwner;
  if (!best || core._bestCount <= core.aliveCount) return false;
  const from = core.host;
  const idx = Array.isArray(from?.reactorCores) ? from.reactorCores.indexOf(core) : -1;
  if (idx >= 0) from.reactorCores.splice(idx, 1);
  core.host = best;
  core.severed = true;
  if (!Array.isArray(best.reactorCores)) best.reactorCores = [];
  best.reactorCores.push(core);
  if (!best.__reactorLayout) best.__reactorLayout = from?.__reactorLayout;
  events.push({ type: 'severed', core, from, to: best, time });
  sampleChamber(core);
  beginMeltdown(core, time, 'severed', events, core.config?.severMeltdownMul ?? CORE_DEFAULTS.severMeltdownMul);
  const remaining = Array.isArray(from?.reactorCores)
    ? from.reactorCores.filter((c) => c.state !== CORE_STATE.DETONATED && !c.invalid)
    : [];
  if (from && remaining.length === 0 && !from.__coreReactorLost) {
    from.__coreReactorLost = true;
    events.push({ type: 'reactorLost', host: from, core, time });
  }
  return true;
}

function evaluateCore(core, time, ctx, events) {
  if (core.invalid) return;
  sampleChamber(core);
  if (coreStateRank(core.state) >= STATE_RANK.meltdown) return;
  sampleElsewhere(core, ctx?.entities);
  if (handleSevering(core, time, events)) return;
  const cfg = core.config || CORE_DEFAULTS;
  const profile = core.profile;
  const exposeMin = Math.max(1, cfg.exposeMinHexes | 0);
  if (core.state === CORE_STATE.NOMINAL && core.deadCount + core.elsewhereCount >= exposeMin) {
    setState(core, CORE_STATE.EXPOSED, time, events);
  }
  if (core.state !== CORE_STATE.CRITICAL && core.integrity < profile.criticalFrac) {
    setState(core, CORE_STATE.CRITICAL, time, events);
  }
  let kill = false;
  let cause = null;
  if (core.killMode === CORE_KILL_MODE.PROBE) {
    const supported = probeReactorSupport(core);
    core.probeSupported = supported;
    if (supported) core.probeMisses = 0;
    else core.probeMisses++;
    if (core.probeMisses >= CORE_PROBE_CONFIG.coreLostChecksToDestroy) { kill = true; cause = 'probe'; }
  } else if (core.integrity <= profile.killFrac) {
    kill = true;
    cause = 'containment';
  }
  if (kill) beginMeltdown(core, time, cause, events);
}

/**
 * Krok rdzeni encji (pętla fizyki; ocena komory w kadencji CORE_PROBE_CONFIG.probeEverySec,
 * odliczanie stopienia co wywołanie).
 * @param {object} entity
 * @param {number} dt
 * @param {object} ctx { time, entities (ród: kandydaci na odciętą komorę), events? }
 * @returns {Array} zdarzenia (state / severed / reactorLost / detonate)
 */
export function updateReactorCores(entity, dt, ctx = {}) {
  const events = ctx.events || [];
  const cores = entity?.reactorCores;
  if (!Array.isArray(cores) || cores.length === 0) return events;
  const time = finite(ctx.time, 0);
  const step = Math.max(0, finite(dt, 0));
  for (let c = cores.length - 1; c >= 0; c--) {
    const core = cores[c];
    if (!core || core.host !== entity || core.state === CORE_STATE.DETONATED) continue;
    core.stateTime += step;
    if (core.state === CORE_STATE.MELTDOWN) {
      core.meltdownRemaining -= step;
      if (core.meltdownRemaining <= 0) {
        detonate(core, time, events, 'meltdown');
        continue;
      }
    }
    core.probeTimer -= step;
    if (core.probeTimer > 0) continue;
    core.probeTimer = CORE_PROBE_CONFIG.probeEverySec;
    evaluateCore(core, time, ctx, events);
  }
  return events;
}

/**
 * Gospodarz zginął z innej przyczyny (pula HP, sufit, AoE, mostek). Rdzeń w STOPIENIU albo
 * KRYTYCZNY (attritionDetonatesFrom) detonuje od razu — jeden wybuch na statek. Puste
 * zdarzenia = czysta śmierć (wrak bez wybuchu).
 */
export function notifyReactorHostKilled(entity, time = 0, reason = 'attrition', events = []) {
  const cores = entity?.reactorCores;
  if (!Array.isArray(cores)) return events;
  let fired = false;
  for (const core of cores) {
    if (fired || core.invalid || core.state === CORE_STATE.DETONATED || core.host !== entity) continue;
    const from = core.config?.attritionDetonatesFrom ?? CORE_DEFAULTS.attritionDetonatesFrom;
    const threshold = from ? coreStateRank(from) : STATE_RANK.meltdown;
    if (coreStateRank(core.state) < threshold) continue;
    if (core.state !== CORE_STATE.MELTDOWN) beginMeltdown(core, time, reason, events);
    detonate(core, time, events, reason);
    fired = true;
  }
  if (fired) consumeReactorCores(entity, time);
  return events;
}

/** Po detonacji jednego rdzenia pozostałe rdzenie gospodarza znikają razem z nim. */
export function consumeReactorCores(entity, time = 0) {
  const cores = entity?.reactorCores;
  if (!Array.isArray(cores)) return;
  for (const core of cores) {
    if (core.host !== entity || core.state === CORE_STATE.DETONATED) continue;
    core.state = CORE_STATE.DETONATED;
    core.detonatedAt = time;
    core.cause = core.cause || 'consumed';
  }
}

/**
 * Wymuszone stopienie (demo, skrypty misji). `opts.remaining` — ile sekund zostało (demo:
 * galerie), `opts.variant` — wariant wymuszony.
 */
export function forceReactorMeltdown(core, time = 0, cause = 'forced', events = [], opts = null) {
  if (!core || core.invalid || core.state === CORE_STATE.DETONATED) return events;
  sampleChamber(core);
  beginMeltdown(core, time, cause, events);
  if (opts?.variant && CORE_DETONATION_VARIANTS[opts.variant]) core.pendingVariant = opts.variant;
  if (core.state === CORE_STATE.MELTDOWN && opts && Number.isFinite(opts.remaining)) {
    core.meltdownRemaining = Math.max(0.01, Math.min(core.meltdownDuration, opts.remaining));
  }
  return events;
}

/** Detonacja natychmiast (demo): stopienie pominięte. */
export function detonateReactorNow(core, time = 0, events = [], variant = null) {
  if (!core || core.invalid || core.state === CORE_STATE.DETONATED) return events;
  sampleChamber(core);
  if (core.state !== CORE_STATE.MELTDOWN) beginMeltdown(core, time, 'forced', events);
  if (variant && CORE_DETONATION_VARIANTS[variant]) core.pendingVariant = variant;
  detonate(core, time, events, 'forced');
  if (core.host) consumeReactorCores(core.host, time);
  return events;
}

/** Trafienie falą detonacji: stopienie w oknie chainWindowSec liczy się jako ogniwo łańcucha. */
export function markReactorChainExposure(entity, depth, time, windowSec = CORE_DEFAULTS.chainWindowSec) {
  if (!entity) return;
  const prev = entity.__coreChain;
  const until = time + Math.max(0, windowSec);
  if (prev && prev.until >= time && prev.depth <= depth) {
    prev.until = Math.max(prev.until, until);
    return;
  }
  entity.__coreChain = { depth, until };
}

// ============================ DETONACJA: ROZPAD KADŁUBA ============================

const _rw = { x: 0, y: 0 };

// Pęknięcie przecina też belki, których oba końce przeżyły pas: wręgi idą od burty do burty
// i spinały brzegi promienistej szczeliny (rozprysk i rozerwanie zostawały jednym kawałkiem).
// Test przecięcia odcinków w układzie ciała (pozycje bieżące), jak rozerwanie belek w processSplits:
// broken = 1, liveBeams − 1, końce do solvera lokalnego.
function breakBeamsAcross(body, ax, ay, bx, by) {
  const e = body.beamStore, s = body.nodeStore, x = s.x, y = s.y, active = s.active;
  const dx = bx - ax, dy = by - ay;
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(ay, by), maxY = Math.max(ay, by);
  let broken = 0;
  for (let bi = 0; bi < e.count; bi++) {
    if (e.broken[bi]) continue;
    const a = e.a[bi], b = e.b[bi];
    if (!active[a] || !active[b]) continue;
    const px = x[a], py = y[a], qx = x[b], qy = y[b];
    if ((px < minX && qx < minX) || (px > maxX && qx > maxX) || (py < minY && qy < minY) || (py > maxY && qy > maxY)) continue;
    const ex = qx - px, ey = qy - py;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((px - ax) * ey - (py - ay) * ex) / den;
    const u = ((px - ax) * dy - (py - ay) * dx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    e.broken[bi] = 1;
    broken++;
    activateNode(body, a);
    activateNode(body, b);
  }
  if (broken) {
    body.liveBeams = Math.max(0, body.liveBeams - broken);
    body.meshDirty = true;
    body.structureDirty = true;
    D.wake(body, D.config.wakeHoldFrames);
  }
  return broken;
}

function makeResult() {
  return {
    variant: 'shatter', host: null, wreck: null, keepHost: false,
    fragments: [],
    x: 0, y: 0,
    // kierunek strumienia / kuli: świat i siatka (obraz w dół = +y — jak dawna siatka heksów)
    dirX: 0, dirY: 0, dirLocalX: 0, dirLocalY: 0, dirGridX: 0, dirGridY: 0,
    craterR: 0, vaporized: 0,
    // pęknięcia i kanał (świat): x0, y0, x1, y1 na odcinek
    cuts: [],
    // punkty brzegu rany (świat) i encja, na której leżą: x, y, e
    edges: [],
    recoil: null
  };
}

function resolveExitDir(core, hull, rng, opts, outLocal) {
  const f = opts?.exitDir;
  if (f && (finite(f.x) || finite(f.y))) {
    const l = Math.hypot(finite(f.x), finite(f.y));
    reactorWorldDirToLocal(hull, finite(f.x) / l, finite(f.y) / l, outLocal);
    return;
  }
  if (opts?.exit === 'wound') {
    // Przez wyrwę komory (średnia martwych komórek) ±25°; bez wyrwy — w bok kadłuba.
    let sx = 0, sy = 0, n = 0;
    const cs = hull.body.cellSize;
    for (let k = 0; k < core.cellX.length; k++) {
      if (core.cellState[k] === 0) continue;
      sx += (core.cellX[k] + 0.5) * cs - core.gx;
      sy += (core.cellY[k] + 0.5) * cs - core.gy;
      n++;
    }
    let a;
    if (n > 0 && Math.hypot(sx, sy) > 1e-3) a = Math.atan2(sy, sx) + (rng() - 0.5) * 0.87;
    else a = (rng() < 0.5 ? 1 : -1) * Math.PI * 0.5 + (rng() - 0.5) * 0.9;
    outLocal.x = Math.cos(a); outLocal.y = Math.sin(a);
    return;
  }
  const a = rng() * TAU;
  outLocal.x = Math.cos(a);
  outLocal.y = Math.sin(a);
}

/**
 * Wykonanie detonacji na kadłubie belkowym. Kadłub przechodzi we wrak (convertToWreck — encja
 * gospodarza traci beamHull), krater wokół rdzenia i pęknięcia / kanał wg wariantu wyparowują
 * (odłamki przez window.spawnHullDebris, lecą od rdzenia albo od szczeliny), rozpad od razu,
 * pchnięcie odłamów, odrzut wraku przy strumieniu i kuli.
 * @param {object} core    rdzeń (DETONATED — z zdarzenia `detonate`)
 * @param {string} variantId
 * @param {object} blast   parametry wybuchu (zdarzenie)
 * @param {object} ctx     { wrecks (window.wrecks), seed, exitDir {x,y} świata, exit 'random'|'wound',
 *                           convert (domyślnie true) }
 * @returns {object} wynik (makeResult) — dla efektów, zagrożeń i wybuchów wtórnych
 */
export function applyReactorDetonation(core, variantId, blast, ctx = {}) {
  const res = makeResult();
  const v = CORE_DETONATION_VARIANTS[variantId] || CORE_DETONATION_VARIANTS.shatter;
  res.variant = v.id;
  res.keepHost = v.keepHost;
  const host = core?.host;
  res.host = host;
  const hull0 = reactorHull(host);
  if (!hull0) return res;
  const rng = makeCoreRng(ctx.seed ?? (((core.uid | 0) * 2654435761) ^ Math.round(finite(core.detonatedAt) * 1000)) >>> 0);
  const noiseSeed = rng() * 1000;
  reactorCoreWorld(core, _rw);
  res.x = _rw.x; res.y = _rw.y;
  const wrecks = Array.isArray(ctx.wrecks) ? ctx.wrecks
    : (typeof window !== 'undefined' && Array.isArray(window.wrecks) ? window.wrecks : null);

  // 1) Wrak z całego kadłuba (encja gospodarza traci kadłub).
  let wreck = host;
  if (ctx.convert !== false && !host.isWreck) {
    const w = HullBodies.convertToWreck(host);
    if (w) wreck = w;
  }
  res.wreck = wreck;
  if (wreck !== host) {
    const idx = Array.isArray(host.reactorCores) ? host.reactorCores.indexOf(core) : -1;
    if (idx >= 0) host.reactorCores.splice(idx, 1);
    if (!Array.isArray(wreck.reactorCores)) wreck.reactorCores = [];
    wreck.reactorCores.push(core);
    wreck.__reactorLayout = host.__reactorLayout;
    core.host = wreck;
  }
  const after = wrecks ? wrecks.length : 0;
  const hull = reactorHull(wreck);
  if (!hull) return res;
  const body = hull.body, s = body.nodeStore, cs = body.cellSize;
  const lx = body.latticeMin.x + core.gx, ly = body.latticeMin.y + core.gy;
  const hvx = entityVelX(wreck), hvy = entityVelY(wreck);

  // Kierunek strumienia / kuli (układ ciała).
  if (v.id === 'jet' || v.id === 'orb') {
    resolveExitDir(core, hull, rng, ctx, _q);
    res.dirLocalX = _q.x; res.dirLocalY = _q.y;
    res.dirGridX = _q.x; res.dirGridY = -_q.y;
    reactorLocalDirToWorld(hull, _q.x, _q.y, _p);
    res.dirX = _p.x; res.dirY = _p.y;
  }

  // 2) Krater: okrągły, w wyrwie poszarpany.
  let craterR = finite(ctx.craterRadius, core.gridR * core.profile.craterMul) * v.craterMul;
  if (v.id === 'hole') craterR *= 0.9 + rng() * 0.2;
  res.craterR = craterR;
  const ph0 = rng() * TAU, ph1 = rng() * TAU, ph2 = rng() * TAU;
  const B = REACTOR_BREAKUP;
  const vMin = finite(ctx.vaporSpeedMin, B.vaporSpeedMin), vMax = finite(ctx.vaporSpeedMax, B.vaporSpeedMax);

  // Odłamek: prędkość węzła w układzie ciała (destroyNode obraca ją i dodaje ruch ciała).
  let vaporized = 0;
  const vaporize = (i, ux, uy, speedMul) => {
    const j = (rng() - 0.5) * 0.7;
    const cj = Math.cos(j), sj = Math.sin(j);
    const sp = (vMin + rng() * (vMax - vMin)) * speedMul;
    s.vx[i] = (ux * cj - uy * sj) * sp;
    s.vy[i] = (ux * sj + uy * cj) * sp;
    D.destroyNode(body, i);
    vaporized++;
  };

  const cuts = res.cuts;
  const pushCut = (ux, uy, len0, len1) => {
    // odcinek pęknięcia w świecie (efekty: szew plazmy, iskry)
    localToWorld(hull, lx + ux * len0, ly + uy * len0, _p);
    localToWorld(hull, lx + ux * len1, ly + uy * len1, _q);
    cuts.push(_p.x, _p.y, _q.x, _q.y);
  };
  const span = body.radius * 2 + cs * 4;
  const crackHalf = (t) => cs * B.crackCells * (1 + 0.6 * coreSmoothNoise1(t / (cs * 2.5), noiseSeed));
  // Pas wokół półprostej (both = prosta) od rdzenia: węzły lecą na boki od szczeliny (albo wzdłuż kanału).
  const carve = (ux, uy, both, halfWidth, speedMul, along) => {
    pushCut(ux, uy, both ? -span : 0, span);
    const t0 = both ? -span : 0;
    breakBeamsAcross(body, lx + ux * t0, ly + uy * t0, lx + ux * span, ly + uy * span);
    for (let i = 0; i < s.count && !body.dead; i++) {
      if (!s.active[i]) continue;
      const dx = s.x[i] - lx, dy = s.y[i] - ly;
      const t = dx * ux + dy * uy;
      if (!both && t < 0) continue;
      const d = -dx * uy + dy * ux;
      if (Math.abs(d) >= halfWidth(Math.abs(t))) continue;
      if (along) vaporize(i, ux, uy, speedMul);
      else {
        const side = d >= 0 ? 1 : -1;
        vaporize(i, -uy * side, ux * side, speedMul);
      }
    }
  };

  // Rozrzut kawałków: kierunki grup (przełamanie, rozerwanie) w układzie ciała.
  let groupDirs = null;
  HullBodies._weaponDepth++;   // bez stempli rozdarć na każdym węźle — ranę maluje efekt wybuchu
  try {
    for (let i = 0; i < s.count && !body.dead; i++) {
      if (!s.active[i]) continue;
      const dx = s.x[i] - lx, dy = s.y[i] - ly;
      let R = craterR;
      if (v.id === 'hole') {
        const a = Math.atan2(dy, dx);
        R *= 1 + 0.2 * Math.sin(3 * a + ph0) + 0.1 * Math.sin(7 * a + ph1) + 0.06 * Math.sin(13 * a + ph2);
      }
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-6) vaporize(i, dx / d, dy / d, 1);
      else { const a = rng() * TAU; vaporize(i, Math.cos(a), Math.sin(a), 1); }
    }
    if (v.id === 'shatter' && !body.dead) {
      // Rozprysk: promieniste pęknięcia od rdzenia (2–5 odłamów zależnie od wielkości kadłuba) —
      // sam krater w środku kadłuba zostawiłby pierścień w jednym kawałku.
      const remaining = body.activeNodes;
      let frags = 2;
      if (remaining >= 400) frags++;
      if (remaining >= 1600) frags++;
      if (remaining >= 3200 && core.classId === 'capital') frags++;
      const phase = rng() * TAU;
      for (let k = 0; k < frags && !body.dead; k++) {
        const a = phase + (k / frags) * TAU + (rng() - 0.5) * 0.5;
        carve(Math.cos(a), Math.sin(a), false, crackHalf, 0.9, false);
      }
    } else if (v.id === 'halves' && !body.dead) {
      // Zwykle w poprzek osi dziób–rufa (±26°), czasem pod dowolnym kątem.
      const phi = rng() < 0.7 ? Math.PI * 0.5 + (rng() - 0.5) * 0.9 : rng() * Math.PI;
      const ux = Math.cos(phi), uy = Math.sin(phi);
      carve(ux, uy, true, crackHalf, 0.8, false);
      const spin = (0.12 + rng() * 0.2) * (rng() < 0.5 ? 1 : -1);
      groupDirs = [{ x: -uy, y: ux, spin, speedMul: 0.7 }, { x: uy, y: -ux, spin: -spin, speedMul: 0.7 }];
    } else if (v.id === 'thirds' && !body.dead) {
      const a0 = rng() * TAU;
      const angles = [a0, a0 + 2.0944 + (rng() - 0.5) * 0.6, a0 + 4.1888 + (rng() - 0.5) * 0.6];
      for (const a of angles) carve(Math.cos(a), Math.sin(a), false, crackHalf, 0.8, false);
      const sorted = angles.map((a) => ((a % TAU) + TAU) % TAU).sort((p, q) => p - q);
      groupDirs = [0, 1, 2].map((k) => {
        const a = k < 2 ? (sorted[k] + sorted[k + 1]) * 0.5 : (sorted[2] + sorted[0] + TAU) * 0.5;
        return { x: Math.cos(a), y: Math.sin(a), spin: (rng() - 0.5) * 0.5, speedMul: 0.85 };
      });
    } else if (v.id === 'jet' && !body.dead) {
      const width = core.gridR * B.jetChannelMul;
      carve(res.dirLocalX, res.dirLocalY, false, (t) => width * (0.8 + 0.4 * coreSmoothNoise1(t / (cs * 3), noiseSeed)), 1.6, true);
    }
  } finally {
    HullBodies._weaponDepth--;
  }
  res.vaporized = vaporized;

  // 3) Rozpad od razu (encje wraków powstają w haku onWreck → window.wrecks).
  if (!body.dead && body.activeNodes > 0) {
    const queued = D.splitQueue;
    D.splitQueue = [body];
    body.structureDirty = true;
    D.processSplits([body]);
    for (const b of queued) if (b !== body && D.splitQueue.indexOf(b) === -1) D.splitQueue.push(b);
  }
  const frags = res.fragments;
  if (reactorHull(wreck)) frags.push(wreck);
  if (wrecks) for (let i = after; i < wrecks.length; i++) if (wrecks[i] && !wrecks[i].dead) frags.push(wrecks[i]);

  // 4) Pchnięcie odłamów (świat): promieniście od rdzenia albo kierunkiem grupy.
  const kick = finite(ctx.kickSpeed, B.kickSpeed);
  const cx = res.x, cy = res.y;
  const keepMain = v.keepHost;
  for (const f of frags) {
    if (keepMain && f === wreck) continue;
    let dx = entityPosX(f) - cx, dy = entityPosY(f) - cy;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    let speedMul = 1, spin = (rng() - 0.5) * 0.35, tangK = 0.6;
    if (groupDirs) {
      // grupa, której kierunek najbliżej kierunku odłamu od rdzenia (układ ciała → świat)
      let best = null, bestDot = -2;
      for (const g of groupDirs) {
        reactorLocalDirToWorld(hull.body.dead ? hull0 : hull, g.x, g.y, _p);
        const dot = _p.x * dx + _p.y * dy;
        if (dot > bestDot) { bestDot = dot; best = g; _q.x = _p.x; _q.y = _p.y; }
      }
      if (best) { dx = _q.x; dy = _q.y; speedMul = best.speedMul; spin = best.spin; tangK = 0.25; }
    }
    if (keepMain) { speedMul *= 0.6; }
    const radial = kick * (0.75 + rng() * 0.6) * speedMul;
    const tangential = (rng() - 0.5) * kick * tangK;
    addEntityVel(f, dx * radial - dy * tangential, dy * radial + dx * tangential);
    f.angVel = finite(f.angVel) + spin;
  }

  // 5) Odrzut wraku przy strumieniu i kuli: przeciwnie do wyrzutu, moment z ramienia rdzenia.
  if ((v.id === 'jet' || v.id === 'orb') && reactorHull(wreck) && (res.dirX || res.dirY)) {
    const prof = v.id === 'jet'
      ? (CORE_JET_PROFILES[core.classId] || CORE_JET_PROFILES.capital)
      : (CORE_ORB_PROFILES[core.classId] || CORE_ORB_PROFILES.capital);
    const recoil = finite(ctx.recoilSpeed, prof.recoil);
    const rvx = -res.dirX * recoil, rvy = -res.dirY * recoil;
    addEntityVel(wreck, rvx, rvy);
    // Ramię: rdzeń względem kotwicy wraku (środek masy) w świecie; moment wokół osi z (y w dół → minus).
    const ax = cx - entityPosX(wreck), ay = cy - entityPosY(wreck);
    const torque = ax * rvy - ay * rvx;
    const spin = Math.max(-0.5, Math.min(0.5, torque * finite(ctx.recoilSpin, B.recoilSpin) / Math.max(1, recoil)));
    wreck.angVel = finite(wreck.angVel) + spin;
    res.recoil = { x: rvx, y: rvy, spin };
  }

  // 6) Brzeg rany dla efektów: żywe węzły tuż za kraterem i przy szczelinach (świat + encja).
  collectEdges(res, frags, core, craterR, hvx, hvy, rng);
  return res;
}

const _edgeCand = [];

function collectEdges(res, frags, core, craterR, hvx, hvy, rng) {
  const edges = res.edges;
  edges.length = 0;
  _edgeCand.length = 0;
  const cuts = res.cuts;
  for (const f of frags) {
    const hull = reactorHull(f);
    if (!hull) continue;
    const b = hull.body, s = b.nodeStore, cs = b.cellSize;
    const lx = b.latticeMin.x + core.gx, ly = b.latticeMin.y + core.gy;
    const r0 = craterR, r1 = craterR + cs * 2.5;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const dx = s.ox[i] - lx, dy = s.oy[i] - ly;
      const d = Math.sqrt(dx * dx + dy * dy);
      let near = d >= r0 * 0.85 && d <= r1;
      if (!near && cuts.length) {
        localToWorld(hull, s.ox[i], s.oy[i], _p);
        for (let c = 0; c < cuts.length && !near; c += 4) {
          const ax = cuts[c], ay = cuts[c + 1], bx = cuts[c + 2], by = cuts[c + 3];
          const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
          let t = l2 > 1e-9 ? ((_p.x - ax) * ex + (_p.y - ay) * ey) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + ex * t - _p.x, qy = ay + ey * t - _p.y;
          near = qx * qx + qy * qy < (cs * 2.2) * (cs * 2.2);
        }
      }
      if (!near) continue;
      _edgeCand.push(f, i);
    }
  }
  const nC = _edgeCand.length / 2;
  const want = Math.min(REACTOR_BREAKUP.edgeSamples, nC);
  for (let k = 0; k < want; k++) {
    const j = Math.min(nC - 1, Math.floor((k + rng()) * nC / want));
    const f = _edgeCand[j * 2], i = _edgeCand[j * 2 + 1];
    const hull = reactorHull(f);
    if (!hull) continue;
    const s = hull.body.nodeStore;
    localToWorld(hull, s.ox[i], s.oy[i], _p);
    edges.push(_p.x, _p.y, f);
  }
  _edgeCand.length = 0;
}

// ============================ FALA NA SĄSIADÓW ============================

const _hits = [];

function shockChambers(e, blast, bx, by) {
  const cores = e?.reactorCores;
  const hull = reactorHull(e);
  if (!Array.isArray(cores) || !hull) return 0;
  let touched = 0;
  const s = hull.body.nodeStore;
  for (const core of cores) {
    if (core.invalid || core.host !== e || coreStateRank(core.state) >= STATE_RANK.meltdown) continue;
    reactorCoreWorld(core, _p);
    const d = Math.hypot(_p.x - bx, _p.y - by);
    const R = Math.max(finite(blast.shockRadius), finite(blast.aoeRadius) * REACTOR_BEAM_TUNE.shockRadiusMul);
    if (d >= R) continue;
    const dmg = blast.shockDamage * (1 - d / R) * (hull.hexPerNode > 0 ? hull.hexPerNode : 1);
    let killed = 0;
    for (let k = 0; k < core.cellX.length; k++) {
      const i = reactorCellNode(hull, core.cellX[k], core.cellY[k]);
      if (i < 0) continue;
      s.hp[i] -= dmg;
      if (s.hp[i] <= 0) { D.destroyNode(hull.body, i); killed++; }
    }
    if (killed > 0 && !hull.body.noSplit && D.splitQueue.indexOf(hull.body) === -1) D.splitQueue.push(hull.body);
    core.probeTimer = 0; // ocena w najbliższym kroku
    touched++;
  }
  return touched;
}

/**
 * Fala wybuchu na otoczenie. Dla każdej encji w zasięgu (poza rodem źródła): znacznik łańcucha,
 * fala na komory rdzeni (osłabia, dziury tylko przy HP ≤ 0), krater od strony wybuchu
 * (HullBodies.impact z budżetem HP), pchnięcie i obrażenia puli przez hak.
 * @param {object} blast  parametry (zdarzenie detonate / orbDetonate)
 * @param {number} bx, by punkt wybuchu (świat)
 * @param {Array} entities
 * @param {object} source ród źródła (encja lub wrak) — pomijany
 * @param {object} ctx    { time, hooks: { hullDamage(e, dmg, cause) }, push (bool, domyślnie true),
 *                          sourceKey (dmgKey rodu źródła, gdy encja już bez kadłuba) }
 * @returns {Array} trafienia (współdzielona tablica): { entity, x, y, nx, ny, t } — dla efektów
 */
export function applyReactorBlast(blast, bx, by, entities, source = null, ctx = {}) {
  _hits.length = 0;
  if (!blast || !Array.isArray(entities)) return _hits;
  const time = finite(ctx.time, 0);
  const cfg = CORE_DEFAULTS;
  const depth = blast.chainDepth | 0;
  const srcKey = ctx.sourceKey ?? source?.beamHull?.dmgKey ?? null;
  const hooks = ctx.hooks || null;
  const push = ctx.push !== false;
  const srcR = Math.max(40, finite(ctx.sourceRadius, finite(source?.radius, 200)));
  for (let n = 0; n < entities.length; n++) {
    const e = entities[n];
    if (!e || e === source || (e.dead && !e.isWreck)) continue;
    const hull = reactorHull(e);
    if (srcKey !== null && hull && hull.dmgKey === srcKey) continue;
    const ex = entityPosX(e), ey = entityPosY(e);
    const er = Math.max(40, finite(e.radius, 40));
    const dist = Math.hypot(ex - bx, ey - by);
    if (dist > blast.aoeRadius + er) continue;
    markReactorChainExposure(e, depth + 1, time, cfg.chainWindowSec);
    if (blast.shockDamage > 0) shockChambers(e, blast, bx, by);
    let hx = ex, hy = ey, t = coreBlastFalloff(Math.max(0, dist - er), blast.aoeRadius);
    let nx = ex - bx, ny = ey - by;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    if (hull && blast.hexDamage > 0) {
      const hit = HullBodies.sweep(e, bx, by, ex, ey, 0);
      if (hit) {
        hx = hit.worldX; hy = hit.worldY;
        const d = Math.hypot(hx - bx, hy - by);
        t = coreBlastFalloff(d, blast.aoeRadius);
        if (t > 0) {
          const speed = finite(blast.hexSpeed, 3000) * t;
          HullBodies.impact(e, hx, hy, blast.hexDamage * t, { x: nx * speed, y: ny * speed },
            { radius: Math.max(24, finite(blast.hexRadius, 60) * (0.5 + 0.5 * t)) });
        }
      }
    }
    if (!(t > 0)) continue;
    if (push) {
      const k = REACTOR_BREAKUP.neighborPush * t * Math.min(2, srcR / er);
      addEntityVel(e, nx * k, ny * k);
      e.angVel = finite(e.angVel) + ((n & 1) ? 1 : -1) * 0.06 * t;
    }
    if (blast.aoeDamage > 0) hooks?.hullDamage?.(e, blast.aoeDamage * t, 'core_blast');
    _hits.push({ entity: e, x: hx, y: hy, nx, ny, t });
  }
  return _hits;
}

// ============================ STRUMIEŃ PLAZMY ============================

/**
 * Strumień z wyrwy (wariant `jet`): źródło i kierunek w układzie ciała wraku — odrzut i obrót
 * wodzą strumieniem po okolicy. Wynik detonacji (res) daje kierunek i wrak.
 */
export function createReactorJet(core, res, blast) {
  const prof = CORE_JET_PROFILES[core.classId] || CORE_JET_PROFILES.capital;
  const cut = REACTOR_JET_CUT[core.classId] || REACTOR_JET_CUT.capital;
  const baseAoe = finite(blast?.baseAoeDamage, finite(blast?.aoeDamage));
  const baseRadius = finite(blast?.baseAoeRadius, finite(blast?.aoeRadius, 700));
  const width = Math.max(8, core.gridR * 2 * prof.widthMul);
  return {
    host: res.wreck || core.host,
    lineage: core.lineage,
    core,
    classId: core.classId,
    color: core.color || null,
    gx: core.gx, gy: core.gy,
    ldx: res.dirLocalX, ldy: res.dirLocalY,
    length: Math.max(JET_MIN_LENGTH, baseRadius * prof.lengthMul),
    width,
    duration: prof.duration,
    dps: prof.duration > 0 ? baseAoe * prof.energyMul / prof.duration : 0,
    cutPerSec: finite(blast?.hexDamage) > 0 ? cut.cutPerSec : 0,
    cutHalf: width * cut.halfWidthMul,
    tick: prof.tick,
    tickAcc: 0,
    chainDepth: blast?.chainDepth | 0,
    age: 0,
    done: false,
    hits: 0,
    env: 0,
    originX: res.x, originY: res.y, endX: res.x, endY: res.y,
    dirWX: res.dirX, dirWY: res.dirY,
    hitEntity: null, hitX: 0, hitY: 0,
    hostVx: 0, hostVy: 0
  };
}

/**
 * Krok strumienia: pierwszy kadłub na promieniu (poza własnym rodem — wrak i odłamy) dostaje rzaz z pędem co
 * takt (cutSegment push — odłamki lecą wzdłuż strumienia), pulę przez hak i znacznik łańcucha;
 * tarcza (hooks.blocksHexes) trzyma plazmę. Zwraca false po wygaśnięciu.
 */
export function stepReactorJet(jet, dt, entities, ctx = {}) {
  if (!jet || jet.done) return false;
  const step = Math.max(0, finite(dt, 0));
  jet.age += step;
  const hull = reactorHull(jet.host);
  if (jet.age >= jet.duration || !hull) { jet.done = true; jet.env = 0; return false; }
  const lm = hull.body.latticeMin;
  localToWorld(hull, lm.x + jet.gx, lm.y + jet.gy, _p);
  reactorLocalDirToWorld(hull, jet.ldx, jet.ldy, _q);
  const ox = _p.x, oy = _p.y, dx = _q.x, dy = _q.y;
  const ex0 = ox + dx * jet.length, ey0 = oy + dy * jet.length;
  let bestD = jet.length;
  let best = null;
  let bx = 0, by = 0;
  const list = Array.isArray(entities) ? entities : [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || e === jet.host || (e.dead && !e.isWreck)) continue;
    const h = reactorHull(e);
    // Własny ród (wrak i odłamy) pomijany: kanał wybiła detonacja, a odłam na linii strumienia
    // chowałby go w kadłubie przez pierwsze ~0,3 s (strumień ciąłby własną blachę 60–150 j.).
    if (!h || h.dmgKey === jet.lineage) continue;
    const rx = entityPosX(e) - ox, ry = entityPosY(e) - oy;
    const t = rx * dx + ry * dy;
    const rad = Math.max(40, finite(e.radius, 40)) + jet.width;
    if (t < -rad || t > bestD + rad) continue;
    const px = rx - dx * t, py = ry - dy * t;
    if (px * px + py * py > rad * rad) continue;
    const hit = HullBodies.sweep(e, ox, oy, ex0, ey0, jet.width * 0.25);
    if (!hit) continue;
    const hd = Math.hypot(hit.worldX - ox, hit.worldY - oy);
    if (hd < bestD) { bestD = hd; best = e; bx = hit.worldX; by = hit.worldY; }
  }
  jet.originX = ox; jet.originY = oy;
  jet.dirWX = dx; jet.dirWY = dy;
  jet.endX = ox + dx * bestD; jet.endY = oy + dy * bestD;
  jet.hitEntity = best;
  jet.hitX = bx; jet.hitY = by;
  jet.hostVx = entityVelX(jet.host); jet.hostVy = entityVelY(jet.host);
  const env = coreJetEnvelope(jet);
  jet.env = env;
  jet.tickAcc += step;
  if (!best) { jet.tickAcc = Math.min(jet.tickAcc, jet.tick); return true; }
  if (jet.tickAcc < jet.tick) return true;
  const n = Math.floor(jet.tickAcc / jet.tick);
  jet.tickAcc -= n * jet.tick;
  const shielded = ctx.hooks?.blocksHexes?.(best) === true;
  if (!shielded && jet.cutPerSec > 0 && env > 0) {
    const depth = jet.cutPerSec * jet.tick * n * env;
    HullBodies.cutSegment(best, bx - dx * 4, by - dy * 4, bx + dx * depth, by + dy * depth, jet.cutHalf, { push: true });
    ctx.hooks?.jetCut?.(best, bx, by, dx, dy, depth, jet);
  }
  if (env > 0) ctx.hooks?.hullDamage?.(best, jet.dps * jet.tick * n * env, 'core_jet');
  markReactorChainExposure(best, (jet.chainDepth | 0) + 1, finite(ctx.time, 0));
  jet.hits += n;
  return true;
}

// ============================ KULA PLAZMY ============================

/** Kula plazmy (wariant `orb`): torus wypada z komory i topi wszystko na drodze. */
export function createReactorOrb(core, res, blast, options = {}) {
  const prof = CORE_ORB_PROFILES[core.classId] || CORE_ORB_PROFILES.capital;
  const rng = makeCoreRng(options.seed ?? (((core.uid | 0) * 40503) >>> 0));
  const host = res.wreck || core.host;
  const speed = prof.speedMin + rng() * (prof.speedMax - prof.speedMin);
  const hvx = entityVelX(host), hvy = entityVelY(host);
  const baseRadius = finite(blast?.baseAoeRadius, finite(blast?.aoeRadius, 700));
  const baseAoe = finite(blast?.baseAoeDamage, finite(blast?.aoeDamage));
  const baseHex = finite(blast?.baseHexDamage, finite(blast?.hexDamage));
  const baseShock = finite(blast?.baseShockDamage, finite(blast?.shockDamage));
  const aoeRadius = baseRadius * prof.aoeRadiusMul;
  return {
    x: res.x, y: res.y, px: res.x, py: res.y,
    vx: hvx + res.dirX * speed,
    vy: hvy + res.dirY * speed,
    radius: Math.max(6, core.gridR * prof.radiusMul),
    fuse: prof.fuseMin + rng() * (prof.fuseMax - prof.fuseMin),
    age: 0,
    host,
    lineage: core.lineage,
    core,
    left: false,
    classId: core.classId,
    color: core.color || null,
    spin: (rng() < 0.5 ? -1 : 1) * (5 + rng() * 4),
    detonated: false,
    flight: 0,
    chainDepth: blast?.chainDepth | 0,
    meltDps: prof.meltDps,
    meltDrag: prof.meltDrag,
    meltRimHeat: prof.meltRimHeat,
    meltCount: 0,
    meltTotal: 0,
    meltEntity: null,
    meltX: 0,
    meltY: 0,
    blast: {
      ...(blast || {}),
      variant: 'orb-burst',
      reactorProfile: prof.profile,
      aoeRadius,
      aoeDamage: baseAoe * prof.aoeDamageMul,
      hexDamage: baseHex * prof.hexMul,
      shockRadius: aoeRadius * (core.profile?.shockRadiusMul ?? 0.4),
      shockDamage: baseShock * prof.aoeDamageMul,
      visualSize: finite(blast?.baseVisualSize, finite(blast?.visualSize)) * 0.55
    }
  };
}

/**
 * Krok kul: ruch, topienie wszystkiego w promieniu kuli (krater wymuszony — wszystkie węzły
 * w promieniu giną; także własny wrak, którym kula wychodzi), grzęźnięcie w cudzym kadłubie,
 * zapalnik od wyjścia z kadłuba, tarcza trzyma plazmę (kula na niej wybucha).
 * ctx: { time, events, hooks: { hullDamage, blocksHexes, melt(e, orb, killed) } }.
 * Zwraca zdarzenia { type: 'orbDetonate', orb, hit, x, y, blast, time }.
 */
export function stepReactorOrbs(orbs, dt, entities, ctx = {}) {
  const events = ctx.events || [];
  const step = Math.max(0, finite(dt, 0));
  const list = Array.isArray(entities) ? entities : [];
  const time = finite(ctx.time, 0);
  const hooks = ctx.hooks || null;
  for (const orb of orbs || []) {
    if (!orb || orb.detonated) continue;
    orb.age += step;
    orb.px = orb.x; orb.py = orb.y;
    orb.x += orb.vx * step;
    orb.y += orb.vy * step;
    const host = orb.host;
    if (!orb.left) {
      const r = Math.max(40, finite(host?.radius, 40)) + orb.radius;
      if (!reactorHull(host) || Math.hypot(orb.x - entityPosX(host), orb.y - entityPosY(host)) > r) orb.left = true;
    }
    if (orb.left) orb.flight += step;
    let blocked = null;
    let bx = 0, by = 0;
    let dragFrom = null;
    const travel = Math.hypot(orb.x - orb.px, orb.y - orb.py);
    for (let i = 0; i < list.length && !blocked; i++) {
      const e = list[i];
      if (!e || (e.dead && !e.isWreck)) continue;
      const hull = reactorHull(e);
      if (!hull) continue;
      const rad = Math.max(40, finite(e.radius, 40)) + orb.radius + travel;
      const ex = entityPosX(e) - orb.x, ey = entityPosY(e) - orb.y;
      if (ex * ex + ey * ey > rad * rad) continue;
      const own = hull.dmgKey === orb.lineage;
      if (!own && hooks?.blocksHexes?.(e) === true) {
        const hit = HullBodies.sweep(e, orb.px, orb.py, orb.x, orb.y, orb.radius);
        if (hit) { blocked = e; bx = hit.worldX; by = hit.worldY; }
        continue;
      }
      if (!HullBodies.probe(e, orb.x, orb.y, orb.radius + hull.body.cellSize)) continue;
      HullBodies.impact(e, orb.x, orb.y, 1, null, { craterRadius: orb.radius });
      const killed = hullImpactResult.hit ? hullImpactResult.killed : 0;
      if (killed <= 0) continue;
      orb.meltCount += killed;
      orb.meltTotal += killed;
      orb.meltEntity = e;
      orb.meltX = orb.x; orb.meltY = orb.y;
      hooks?.melt?.(e, orb, killed);
      if (!own) {
        dragFrom = e;
        hooks?.hullDamage?.(e, orb.meltDps * step, 'core_orb');
        markReactorChainExposure(e, (orb.chainDepth | 0) + 1, time);
      }
    }
    if (dragFrom && orb.meltDrag > 0) {
      const k = Math.exp(-orb.meltDrag * step);
      const evx = entityVelX(dragFrom), evy = entityVelY(dragFrom);
      orb.vx = evx + (orb.vx - evx) * k;
      orb.vy = evy + (orb.vy - evy) * k;
    }
    if (blocked || orb.flight >= orb.fuse || orb.age >= orb.fuse + ORB_TRAPPED_SEC) {
      orb.detonated = true;
      events.push({
        type: 'orbDetonate', orb, hit: blocked,
        x: blocked ? bx : orb.x, y: blocked ? by : orb.y,
        blast: orb.blast, time
      });
    }
  }
  return events;
}

// ============================ WYBUCHY WTÓRNE ============================

/**
 * Wybuchy wtórne (amunicja, paliwo) w tym, co zostało: komórki odłamów, chętniej przy brzegu rany.
 * Zwraca posortowaną listę { lineage, ix, iy, delay, damage, radius, size } — pozycję w chwili
 * odpalenia daje locateReactorCell (komórka mogła przejść do innego odłamu).
 */
export function planReactorSecondaries(core, res, options = {}) {
  const rng = makeCoreRng(options.seed ?? (((core.uid | 0) * 1103515245) >>> 0));
  const classId = core.classId;
  const count = Number.isFinite(options.count) ? Math.max(0, options.count | 0) : rollSecondaryBlasts(res.variant, classId, rng);
  const prof = CORE_SECONDARY_PROFILES[classId] || CORE_SECONDARY_PROFILES.capital;
  const out = [];
  const frags = (res.fragments || []).filter((f) => reactorHull(f));
  if (!frags.length || count <= 0) return out;
  const edges = res.edges || [];
  for (let k = 0; k < count; k++) {
    let hull = null, i = -1;
    if (edges.length >= 3 && rng() < 0.6) {
      const j = Math.floor(rng() * (edges.length / 3)) * 3;
      const e = edges[j + 2];
      hull = reactorHull(e);
      if (hull) {
        worldToLocal(hull, edges[j], edges[j + 1], _p);
        i = D.probeLocal2D ? D.probeLocal2D(hull.body, _p.x, _p.y, hull.body.cellSize * 2) : -1;
      }
    }
    if (i < 0) {
      const f = frags[Math.floor(rng() * frags.length)];
      hull = reactorHull(f);
      const s = hull.body.nodeStore;
      for (let t = 0; t < 24 && i < 0; t++) {
        const c = Math.floor(rng() * s.count);
        if (s.active[c]) i = c;
      }
    }
    if (!hull || i < 0) continue;
    const s = hull.body.nodeStore;
    out.push({
      lineage: hull.dmgKey, ix: s.ix[i], iy: s.iy[i],
      delay: prof.delayMin + rng() * (prof.delayMax - prof.delayMin),
      damage: prof.hexDamage, radius: prof.hexRadius, size: prof.size * (0.75 + rng() * 0.5)
    });
  }
  out.sort((a, b) => a.delay - b.delay);
  return out;
}

/** Pozycja komórki rodu w świecie u jej obecnego właściciela: { entity, x, y, node } albo null. */
export function locateReactorCell(lineage, ix, iy, candidates, out = {}) {
  if (!Array.isArray(candidates)) return null;
  for (let c = 0; c < candidates.length; c++) {
    const e = candidates[c];
    const hull = reactorHull(e);
    if (!hull || hull.dmgKey !== lineage) continue;
    const i = reactorCellNode(hull, ix, iy);
    if (i < 0) continue;
    HullBodies.nodeWorld(hull, i, out);
    out.entity = e;
    out.node = i;
    return out;
  }
  return null;
}

// ============================ LOCK, PODSUMOWANIE ============================

/**
 * Punkt locka „rdzeń”: najbardziej zagrożony żywy rdzeń (najwyższy stan, potem najniższa
 * osłona). Z `rng` — losowa komórka komory (ostrzał z locka celuje w komorę, nie w piksel:
 * w jeden punkt drąży się tunel na komórkę, który nie zbija osłony). null = brak celu.
 */
export function getReactorLockPoint(entity, out = {}, rng = null) {
  const cores = entity?.reactorCores;
  if (!Array.isArray(cores)) return null;
  let best = null;
  for (const core of cores) {
    if (core.invalid || core.state === CORE_STATE.DETONATED || core.host !== entity) continue;
    if (!best) { best = core; continue; }
    const rb = coreStateRank(best.state), rc = coreStateRank(core.state);
    if (rc > rb || (rc === rb && core.integrity < best.integrity)) best = core;
  }
  if (!best) return null;
  if (typeof rng === 'function' && best.cellX.length > 0) {
    reactorCellWorld(best, Math.floor(rng() * best.cellX.length), out);
  } else {
    reactorCoreWorld(best, out);
  }
  out.core = best;
  return out;
}

export function summarizeReactorCore(core) {
  return {
    id: core.id,
    state: core.state,
    label: CORE_STATE_LABEL[core.state] || core.state,
    classId: core.classId,
    integrity: core.integrity,
    chamber: core.cellX.length,
    alive: core.aliveCount,
    dead: core.deadCount,
    elsewhere: core.elsewhereCount,
    meltdownRemaining: core.state === CORE_STATE.MELTDOWN ? Math.max(0, core.meltdownRemaining) : 0,
    meltdownDuration: core.meltdownDuration,
    cause: core.cause,
    chainDepth: core.chainDepth,
    severed: core.severed,
    invalid: core.invalid,
    variant: core.pendingVariant
  };
}

/** Postęp stopienia 0–1 (0 poza STOPIENIEM). */
export function reactorMeltdownProgress(core) {
  if (!core || core.state !== CORE_STATE.MELTDOWN || !(core.meltdownDuration > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - core.meltdownRemaining / core.meltdownDuration));
}
