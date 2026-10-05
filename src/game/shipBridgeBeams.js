// src/game/shipBridgeBeams.js
//
// MOSTKI NA KADŁUBIE BELKOWYM — mechanika „zniszczenie mostka = utrata dowodzenia” (shipBridge.js)
// dla silnika belek gry (src/game/hullBodies.js). Wersja heksowa (shipBridge.js: attachShipBridges,
// evaluateShipBridges…) stoi na heksach destruktora, których gra od zadania 21 nie tworzy — na
// kadłubach belkowych mostki były nieaktywne (etap 4 w docs/PORT-silnik-belek.md). Ten moduł daje
// ten sam stan `entity.bridgeState` (te same pola, które czytają shipBridgeRuntime, bridge3D,
// bridgeFx3D i HUD) z backendem `BEAM_BRIDGE_BACKEND`; ogólne funkcje shipBridge.js (bridgePngToWorld,
// updateShipBridges, getBridgeAimPoint, stepCommandLossDrift…) oddają mu pracę, gdy stan go niesie.
// Bez DOM i bez three. Opis: docs/PORT-mostki.md § 9.
//
// Model jak u rdzenia (reactorCore.js):
//   • strefa mostka = obrócony prostokąt w PNG sprite'a (BRIDGE_LAYOUT_PROPOSALS) → KOMÓRKI siatki
//     belek (ix, iy), których środek spoczynkowy leży w strefie; liczone RAZ przy montażu. Komórka
//     jest tożsamością odporną na rozpad: indeksy węzłów zmieniają się przy podziale ciała, a (ix, iy)
//     i wymiary siatki są wspólne dla kadłuba, jego wraków i odłamów (jeden ród — `hull.dmgKey`);
//   • pancerz: hp i maxHp węzłów strefy × armorMul (czyta go krater z budżetu HP; ciężka broń
//     z kraterem na miarę rany, rzazy, zgniot i rozpad zabijają bez patrzenia na HP — koszt mostka
//     to TUNEL do niego, wniosek z benchmarku wersji heksowej);
//   • integralność = żywe komórki strefy w BIEŻĄCYM ciele gospodarza ÷ komórki na starcie — mostek
//     odcięty z odłamem (komórki żyją na innym ciele rodu) liczy się jako zniszczony;
//   • kill, oś czasu, dryf hulka, okna i wyrwa — jak w wersji heksowej (te same liczby).
//
// UKŁADY: świat gry (y w dół); siatka belek = ciało − latticeMin (j. świata, Y w GÓRĘ, komórka
// cs = body.cellSize; środek komórki (ix, iy) = (ix + ½, iy + ½) · cs); obraz kadłuba („siatka”
// w API heksowym: piksele obrazu fizyki/renderu od lewego górnego rogu, y w dół); PNG (edytor:
// (0, 0) = środek sprite'a, +X dziób, y w dół). Kotwica encji jak w HullBodies: statek = środek
// sprite'a, wrak = środek masy — przekształcenia biorą `HullBodies.anchorLocalX/Y`.

import { HullBodies, hullSpriteRotation } from './hullBodies.js';
import {
  BRIDGE_DEFAULTS,
  BRIDGE_EVENT,
  bridgeHash01,
  bridgeZoneContains,
  bridgeZoneDistance,
  normalizeBridgeList
} from './shipBridge.js';

const D = HullBodies.engine;
const DEG = Math.PI / 180;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function parseHexColor(hex, fallback) {
  const raw = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) return fallback;
  return [parseInt(raw.slice(0, 2), 16) / 255, parseInt(raw.slice(2, 4), 16) / 255, parseInt(raw.slice(4, 6), 16) / 255];
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function entityPosX(e) { return (e?.pos && typeof e.pos.x === 'number') ? e.pos.x : finite(e?.x); }
function entityPosY(e) { return (e?.pos && typeof e.pos.y === 'number') ? e.pos.y : finite(e?.y); }

// ============================ KADŁUB I KOMÓRKI ============================

/** Kadłub belkowy encji (żywy i należący do niej) albo null. */
export function bridgeBeamHull(entity) {
  const h = entity?.beamHull;
  return h && h.entity === entity && h.body && !h.body.dead ? h : null;
}

/** Indeks żywego węzła komórki (ix, iy) w ciele kadłuba albo −1. */
export function bridgeCellNode(hull, ix, iy) {
  if (!hull) return -1;
  const b = hull.body, d = b.dims;
  if (ix < 0 || iy < 0 || ix >= d.x || iy >= d.y) return -1;
  const i = D._latticeIndex(b).cells[ix + iy * d.x];
  return i >= 0 && b.nodeStore.active[i] ? i : -1;
}

/** Czy stan mostków jest na belkach (backend BEAM_BRIDGE_BACKEND). */
export function isBeamBridgeState(st) {
  return !!st && st.backend === BEAM_BRIDGE_BACKEND;
}

/** Czy encja ma kadłub rodu mostków (ten sam dmgKey: kadłub, wrak, odłam). */
export function beamBridgeOwns(entity, st) {
  const h = bridgeBeamHull(entity);
  return !!h && !!st && h.dmgKey === st.lineage;
}

// ============================ PRZEKSZTAŁCENIA ============================

const _pose = { x: 0, y: 0, c: 1, s: 0 };

// Poza encji (albo poza renderu {x, y, angle} — gracz jest rysowany z interpolacją).
function poseOf(hull, pose, out) {
  const e = hull.entity;
  const angle = pose ? pose.angle : finite(e?.angle);
  const theta = -(angle + hullSpriteRotation(e));
  out.x = pose ? pose.x : entityPosX(e);
  out.y = pose ? pose.y : entityPosY(e);
  out.c = Math.cos(theta);
  out.s = Math.sin(theta);
  return out;
}

/** Punkt siatki belek (względem latticeMin, j. świata, Y w górę) → świat gry. */
export function beamLatticeToWorld(hull, lx, ly, out = { x: 0, y: 0 }, pose = null) {
  const b = hull.body, lm = b.latticeMin;
  const p = poseOf(hull, pose, _pose);
  const dx = lm.x + lx - HullBodies.anchorLocalX(hull);
  const dy = lm.y + ly - HullBodies.anchorLocalY(hull);
  out.x = p.x + p.c * dx - p.s * dy;
  out.y = p.y - (p.s * dx + p.c * dy);
  return out;
}

/** Świat gry → siatka belek (względem latticeMin). */
export function beamWorldToLattice(hull, wx, wy, out = { x: 0, y: 0 }) {
  const b = hull.body, lm = b.latticeMin;
  const p = poseOf(hull, null, _pose);
  const dx = wx - p.x, dy = -(wy - p.y);
  out.x = p.c * dx + p.s * dy + HullBodies.anchorLocalX(hull) - lm.x;
  out.y = -p.s * dx + p.c * dy + HullBodies.anchorLocalY(hull) - lm.y;
  return out;
}

/** PNG → siatka belek (stan mostków niesie skale i kotwicę rodu). */
export function beamPngToLattice(st, px, py, out = { x: 0, y: 0 }) {
  out.x = st.anchorDX + px * st.scaleX * st.spriteScale;
  out.y = st.anchorDY - py * st.scaleY * st.spriteScale;
  return out;
}

/** Siatka belek → PNG. */
export function beamLatticeToPng(st, lx, ly, out = { x: 0, y: 0 }) {
  out.x = (lx - st.anchorDX) / (st.scaleX * st.spriteScale);
  out.y = (st.anchorDY - ly) / (st.scaleY * st.spriteScale);
  return out;
}

/** Piksel obrazu kadłuba (od lewego górnego rogu, y w dół) → siatka belek. */
export function beamImageToLattice(st, gx, gy, out = { x: 0, y: 0 }) {
  out.x = st.anchorDX + (gx - st.srcW * 0.5) * st.spriteScale;
  out.y = st.anchorDY - (gy - st.srcH * 0.5) * st.spriteScale;
  return out;
}

const _l = { x: 0, y: 0 };

function hostHull(entity) {
  return entity?.beamHull && entity.beamHull.body ? entity.beamHull : null;
}

// ============================ MONTAŻ ============================

/**
 * Montuje mostki na kadłubie belkowym (po HullBodies.createHull). `list` — strefy w PNG
 * (BRIDGE_LAYOUT_PROPOSALS albo edytor). opts: { scaleX?, scaleY? (render/PNG; domyślnie z obrazów
 * kadłuba), pngWidth?, rule?, windowColor?, hullKey?, windows? }. Ponowne wołanie na tym samym
 * kadłubie nie mnoży pancerza (bazowe HP komórek zapamiętane).
 */
export function attachBeamBridges(entity, list, opts = {}) {
  if (!entity) return null;
  const hull = bridgeBeamHull(entity);
  const prev = entity.bridgeState;
  if (prev && isBeamBridgeState(prev) && hull && prev.lineage === hull.dmgKey) restoreBeamArmor(entity, prev);
  const defs = normalizeBridgeList(list, opts.overrides || null);
  if (!hull || !defs.length) {
    entity.bridgeState = null;
    return null;
  }
  const body = hull.body, s = body.nodeStore, lm = body.latticeMin, cs = body.cellSize, dims = body.dims;
  const img = hull.visualImage;
  const pngW = positive(opts.pngWidth, positive(img?.naturalWidth ?? img?.width, 0));
  const pngH = positive(opts.pngHeight, positive(img?.naturalHeight ?? img?.height, 0));
  const scaleX = positive(opts.scaleX, pngW > 0 ? hull.srcWidth / pngW : positive(entity.__hardpointScaleX, 1));
  const scaleY = positive(opts.scaleY, pngH > 0 ? hull.srcHeight / pngH : positive(entity.__hardpointScaleY, scaleX));
  const st = {
    version: 1,
    backend: BEAM_BRIDGE_BACKEND,
    grid: null,
    lineage: hull.dmgKey,
    srcW: hull.srcWidth,
    srcH: hull.srcHeight,
    spriteScale: hull.scale,
    anchorDX: hull.anchorDX,
    anchorDY: hull.anchorDY,
    cellSize: cs,
    dimsX: dims.x | 0,
    dimsY: dims.y | 0,
    scaleX,
    scaleY,
    bridges: null,
    rule: opts.rule === 'any' ? 'any' : BRIDGE_DEFAULTS.rule,
    probeEverySec: positive(opts.probeEverySec, BRIDGE_DEFAULTS.probeEverySec),
    probeTimer: 0,
    lastBody: null,
    lastActive: -1,
    aliveBridges: 0,
    commandLost: false,
    commandLostAt: -1,
    cause: null,
    hullKey: typeof opts.hullKey === 'string' ? opts.hullKey : null,
    // Promień „heksa” w API heksowym (bridge3D, szczeliny) — tu pół komórki w pikselach obrazu.
    hexRadius: cs / Math.max(1e-6, hull.scale) * 0.5,
    silhouette: null,
    windowColorSrgb: parseHexColor(opts.windowColor, [0.9, 0.95, 1.0]),
    lastHit: { x: 0, y: 0, vx: 0, vy: 0, t: -Infinity },
    vent: null,
    windows: null
  };
  st.bridges = defs.map((def, index) => ({
    def, id: def.id, index,
    cellX: null, cellY: null, cellBaseHp: null,
    pos: null,          // Float32Array [px, py, …] w PNG — środki komórek
    aliveFlags: null,   // Uint8Array — stan z poprzedniego sprawdzenia
    total: 0, alive: 0, integrity: 1, dead: false, deadAt: -1,
    lossX: def.x, lossY: def.y, lastLossAt: -1
  }));

  // Komórki stref: środek spoczynkowy węzła w strefie (pierwsza pasująca strefa).
  const tmpX = st.bridges.map(() => []);
  const tmpY = st.bridges.map(() => []);
  const sil = new Uint8Array(Math.max(1, st.dimsX * st.dimsY));
  const p = { x: 0, y: 0 };
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const ix = s.ix[i], iy = s.iy[i];
    if (ix >= 0 && iy >= 0 && ix < st.dimsX && iy < st.dimsY) sil[ix + iy * st.dimsX] = 1;
    beamLatticeToPng(st, s.ox[i] - lm.x, s.oy[i] - lm.y, p);
    for (let b = 0; b < st.bridges.length; b++) {
      if (!bridgeZoneContains(st.bridges[b].def, p.x, p.y)) continue;
      tmpX[b].push(ix); tmpY[b].push(iy);
      break;
    }
  }
  st.silhouette = sil;
  // Strefa węższa niż komórka (fregaty: mostek ~2 × 1 komórki) bez trafionego środka — komórka
  // najbliższa środkowi strefy, jeśli leży na kadłubie (inaczej mostek „nie istnieje”).
  for (let b = 0; b < st.bridges.length; b++) {
    if (tmpX[b].length) continue;
    const def = st.bridges[b].def;
    beamPngToLattice(st, def.x, def.y, p);
    const ix = Math.floor(p.x / cs), iy = Math.floor(p.y / cs);
    if (bridgeCellNode(hull, ix, iy) >= 0) { tmpX[b].push(ix); tmpY[b].push(iy); }
  }

  for (let b = 0; b < st.bridges.length; b++) {
    const bridge = st.bridges[b];
    const n = tmpX[b].length;
    bridge.cellX = Int16Array.from(tmpX[b]);
    bridge.cellY = Int16Array.from(tmpY[b]);
    bridge.cellBaseHp = new Float64Array(n);
    bridge.pos = new Float32Array(n * 2);
    bridge.aliveFlags = new Uint8Array(n).fill(1);
    bridge.total = n;
    bridge.alive = n;
    const mul = bridge.def.armorMul;
    for (let k = 0; k < n; k++) {
      const ix = bridge.cellX[k], iy = bridge.cellY[k];
      beamLatticeToPng(st, (ix + 0.5) * cs, (iy + 0.5) * cs, p);
      bridge.pos[k * 2] = p.x;
      bridge.pos[k * 2 + 1] = p.y;
      const i = bridgeCellNode(hull, ix, iy);
      if (i < 0) continue;
      const base = s.maxHp[i];
      const frac = base > 0 ? clamp(s.hp[i] / base, 0, 1) : 1;
      bridge.cellBaseHp[k] = base;
      s.maxHp[i] = base * mul;
      s.hp[i] = s.maxHp[i] * frac;
    }
    // Mostek bez ani jednej komórki (strefa poza obrysem) nie zabija od startu — „nieistniejący”.
    if (n === 0) { bridge.integrity = 0; bridge.missing = true; }
  }
  st.aliveBridges = st.bridges.filter((b) => b.total > 0).length;
  st.lastBody = body;
  st.lastActive = body.activeNodes;
  entity.bridgeState = st;
  if (opts.windows !== false) buildBeamBridgeWindows(entity, opts.windowsOpts || {});
  return st;
}

/** Przywraca bazowe HP komórek mostków (tylko u bieżącego gospodarza rodu). */
export function restoreBeamArmor(entity, st = entity?.bridgeState) {
  const hull = bridgeBeamHull(entity);
  if (!hull || !isBeamBridgeState(st) || hull.dmgKey !== st.lineage) return;
  const s = hull.body.nodeStore;
  for (const b of st.bridges) {
    for (let k = 0; k < b.total; k++) {
      const base = b.cellBaseHp[k];
      if (!(base > 0)) continue;
      const i = bridgeCellNode(hull, b.cellX[k], b.cellY[k]);
      if (i < 0) continue;
      const m = s.maxHp[i];
      const frac = m > 0 ? clamp(s.hp[i] / m, 0, 1) : 1;
      s.maxHp[i] = base;
      s.hp[i] = base * frac;
    }
  }
}

// ============================ INTEGRALNOŚĆ ============================

/** Kadencyjne sprawdzenie (jak updateShipBridges). */
export function updateBeamBridges(entity, dt = 0, nowSec = 0) {
  const st = entity?.bridgeState;
  if (!st || st.commandLost) return BRIDGE_EVENT.NONE;
  st.probeTimer -= dt;
  if (st.probeTimer > 0) return BRIDGE_EVENT.NONE;
  st.probeTimer = st.probeEverySec;
  return evaluateBeamBridges(entity, nowSec);
}

/**
 * Natychmiastowe sprawdzenie. O(1), gdy ciało gospodarza i liczba jego żywych węzłów się nie
 * zmieniły (HP nie wpływa na integralność); inaczej O(komórki mostków).
 */
export function evaluateBeamBridges(entity, nowSec = 0) {
  const st = entity?.bridgeState;
  if (!st || st.commandLost) return BRIDGE_EVENT.NONE;
  const hull = bridgeBeamHull(entity);
  if (!hull || hull.dmgKey !== st.lineage) return BRIDGE_EVENT.NONE;
  const body = hull.body;
  if (body === st.lastBody && body.activeNodes === st.lastActive) return BRIDGE_EVENT.NONE;
  st.lastBody = body;
  st.lastActive = body.activeNodes;
  const ns = body.nodeStore, dx = body.dims.x, dy = body.dims.y;
  const cells = D._latticeIndex(body).cells;

  let flags = BRIDGE_EVENT.NONE;
  let aliveBridges = 0;
  for (let b = 0; b < st.bridges.length; b++) {
    const bridge = st.bridges[b];
    if (bridge.dead || bridge.missing) continue;
    const cx = bridge.cellX, cy = bridge.cellY, flagsArr = bridge.aliveFlags, pos = bridge.pos;
    let alive = 0, lostX = 0, lostY = 0, lostN = 0;
    for (let k = 0; k < bridge.total; k++) {
      const ix = cx[k], iy = cy[k];
      const i = ix < dx && iy < dy ? cells[ix + iy * dx] : -1;
      if (i >= 0 && ns.active[i]) {
        alive++;
      } else if (flagsArr[k] === 1) {
        flagsArr[k] = 0;
        lostX += pos[k * 2];
        lostY += pos[k * 2 + 1];
        lostN++;
      }
    }
    bridge.alive = alive;
    bridge.integrity = bridge.total > 0 ? alive / bridge.total : 0;
    if (lostN > 0) {
      bridge.lossX = lostX / lostN;
      bridge.lossY = lostY / lostN;
      bridge.lastLossAt = nowSec;
    }
    if (alive <= bridge.total * (1 - bridge.def.killFrac)) {
      bridge.dead = true;
      bridge.deadAt = nowSec;
      bridge.vent = computeBeamVent(st, nowSec, bridge);
      flags |= BRIDGE_EVENT.BRIDGE_LOST;
    } else {
      aliveBridges++;
    }
  }
  st.aliveBridges = aliveBridges;
  if (flags & BRIDGE_EVENT.BRIDGE_LOST) {
    const anyDead = st.bridges.some((b) => b.dead);
    const lost = st.rule === 'any' ? anyDead : aliveBridges === 0;
    if (lost) {
      st.commandLost = true;
      st.commandLostAt = nowSec;
      st.cause = 'bridge';
      let last = null;
      for (const b of st.bridges) if (b.dead && (!last || b.deadAt >= last.deadAt)) last = b;
      st.vent = last?.vent || computeBeamVent(st, nowSec, null);
      flags |= BRIDGE_EVENT.COMMAND_LOST;
    }
  }
  return flags;
}

/** Ile żywych komórek mostka `bridgeIndex` należy dziś do encji (HUD, testy, demo). */
export function beamBridgeAliveCells(entity, bridgeIndex = 0) {
  const st = entity?.bridgeState;
  const bridge = st?.bridges?.[bridgeIndex];
  const hull = bridgeBeamHull(entity);
  if (!bridge || !hull) return 0;
  let n = 0;
  for (let k = 0; k < bridge.total; k++) if (bridgeCellNode(hull, bridge.cellX[k], bridge.cellY[k]) >= 0) n++;
  return n;
}

// ============================ WYRWA I STRUMIEŃ ============================

// Wyrwa i kierunek strumienia (PNG) — kolejność źródeł jak w wersji heksowej: świeże trafienie
// (tunel ostrzału), centroid komórek straconych w ostatnim sprawdzeniu, „w górę obrazka”.
function computeBeamVent(st, nowSec, bridge) {
  if (!bridge) for (const b of st.bridges) if (b.dead && (!bridge || b.deadAt >= bridge.deadAt)) bridge = b;
  const def = bridge ? bridge.def : st.bridges[0].def;
  const vent = { x: bridge ? bridge.lossX : def.x, y: bridge ? bridge.lossY : def.y, dirX: 0, dirY: -1, bridgeId: def.id };
  const hit = st.lastHit;
  const hitFresh = nowSec - hit.t <= 1.5;
  let dx, dy;
  if (hitFresh && Math.hypot(hit.vx, hit.vy) > 1e-6) {
    dx = -hit.vx; dy = -hit.vy;
    if (bridgeZoneDistance(def, hit.x, hit.y) < Math.max(def.w, def.h)) { vent.x = hit.x; vent.y = hit.y; }
  } else {
    dx = vent.x - def.x; dy = vent.y - def.y;
  }
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) { vent.dirX = dx / len; vent.dirY = dy / len; }
  if (!bridgeZoneContains(def, vent.x, vent.y) && !def.poly) {
    const r = def.rot * DEG, c = Math.cos(r), s = Math.sin(r);
    const ex = vent.x - def.x, ey = vent.y - def.y;
    const u = clamp(ex * c + ey * s, -def.w * 0.5, def.w * 0.5);
    const v = clamp(-ex * s + ey * c, -def.h * 0.5, def.h * 0.5);
    vent.x = def.x + u * c - v * s;
    vent.y = def.y + u * s + v * c;
  }
  const exit = beamVentExitDistance(st, vent.x, vent.y, vent.dirX, vent.dirY);
  vent.exitDist = exit;
  vent.exitX = vent.x + vent.dirX * exit;
  vent.exitY = vent.y + vent.dirY * exit;
  return vent;
}

/** Odległość (PNG) od wyrwy do obrysu kadłuba wzdłuż strumienia — po obrysie z chwili montażu. */
export function beamVentExitDistance(st, px, py, dx, dy) {
  const mask = st.silhouette;
  if (!mask) return 0;
  const cs = st.cellSize;
  const pxPerPng = Math.max(1e-6, Math.min(st.scaleX, st.scaleY) * st.spriteScale);
  const step = (cs * 0.3) / pxPerPng;
  const maxDist = Math.hypot(st.srcW / st.scaleX, st.srcH / st.scaleY);
  let lastInside = 0;
  let outsideRun = 0;
  for (let d = 0; d <= maxDist; d += step) {
    beamPngToLattice(st, px + dx * d, py + dy * d, _l);
    const ix = Math.floor(_l.x / cs), iy = Math.floor(_l.y / cs);
    const inside = ix >= 0 && iy >= 0 && ix < st.dimsX && iy < st.dimsY && mask[ix + iy * st.dimsX] === 1;
    if (inside) { lastInside = d; outsideRun = 0; } else if (++outsideRun >= 5) break;
  }
  return lastInside;
}

// ============================ CELOWANIE ============================

/**
 * Żywe komórki kadłuba na odcinku (siatka belek, względem latticeMin) — marsz co ½ komórki,
 * komórka liczona raz. `skipIx/skipIy` — komórka celu (nie zasłania samej siebie).
 */
export function beamLineBlockers(hull, l0x, l0y, l1x, l1y, skipIx = -1, skipIy = -1, limit = 64) {
  const cs = hull.body.cellSize;
  const dx = l1x - l0x, dy = l1y - l0y;
  const len = Math.hypot(dx, dy);
  const n = Math.max(1, Math.ceil(len / (cs * 0.5)));
  let count = 0, lastIx = -99999, lastIy = -99999;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const ix = Math.floor((l0x + dx * t) / cs), iy = Math.floor((l0y + dy * t) / cs);
    if (ix === lastIx && iy === lastIy) continue;
    lastIx = ix; lastIy = iy;
    if (ix === skipIx && iy === skipIy) continue;
    if (bridgeCellNode(hull, ix, iy) < 0) continue;
    if (++count >= limit) return count;
  }
  return count;
}

const _a = { x: 0, y: 0 };
const _b = { x: 0, y: 0 };

/**
 * Punkt celowania „lock na mostek” (świat). Tryby jak getBridgeAimPoint (shipBridge.js):
 *   'breach' (domyślny) — środek żywych komórek mostka, dopóki linia ognia coś trafia; gdy linia
 *                         do środka jest pusta (dziura na wylot) — najmniej zasłonięta komórka
 *                         mostka przy wyrwie, cel trzymany między strzałami (opts.memory),
 *   'exposed' — żywa komórka mostka najbliższa strzelcowi, 'centroid', 'center'.
 * null — encja nie ma żywego mostka.
 */
export function getBeamBridgeAimPoint(entity, out = { x: 0, y: 0 }, opts = {}) {
  const st = entity?.bridgeState;
  const hull = bridgeBeamHull(entity);
  if (!isBeamBridgeState(st) || !hull) return null;
  const mode = opts.mode || 'breach';
  let bridge = null;
  if (opts.bridgeId) bridge = st.bridges.find((b) => b.id === opts.bridgeId) || null;
  if (!bridge) bridge = st.bridges.find((b) => !b.dead && !b.missing) || null;
  if (!bridge) return null;
  const cs = st.cellSize;
  if (mode === 'center') {
    beamPngToLattice(st, bridge.def.x, bridge.def.y, _a);
    return beamLatticeToWorld(hull, _a.x, _a.y, out);
  }
  let sx = 0, sy = 0, n = 0;
  for (let k = 0; k < bridge.total; k++) {
    if (bridgeCellNode(hull, bridge.cellX[k], bridge.cellY[k]) < 0) continue;
    sx += (bridge.cellX[k] + 0.5) * cs;
    sy += (bridge.cellY[k] + 0.5) * cs;
    n++;
  }
  if (!n) {
    beamPngToLattice(st, bridge.def.x, bridge.def.y, _a);
    return beamLatticeToWorld(hull, _a.x, _a.y, out);
  }
  const cgx = sx / n, cgy = sy / n;
  if (mode === 'centroid') return beamLatticeToWorld(hull, cgx, cgy, out);
  const fromX = Number(opts.fromX), fromY = Number(opts.fromY);
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) return beamLatticeToWorld(hull, cgx, cgy, out);
  const g0 = beamWorldToLattice(hull, fromX, fromY, _b);
  const g0x = g0.x, g0y = g0.y;

  if (mode === 'exposed') {
    let best = -1, bestD2 = Infinity;
    for (let k = 0; k < bridge.total; k++) {
      if (bridgeCellNode(hull, bridge.cellX[k], bridge.cellY[k]) < 0) continue;
      const ex = (bridge.cellX[k] + 0.5) * cs - g0x, ey = (bridge.cellY[k] + 0.5) * cs - g0y;
      const d2 = ex * ex + ey * ey;
      if (d2 < bestD2) { bestD2 = d2; best = k; }
    }
    if (best < 0) return beamLatticeToWorld(hull, cgx, cgy, out);
    return beamLatticeToWorld(hull, (bridge.cellX[best] + 0.5) * cs, (bridge.cellY[best] + 0.5) * cs, out);
  }

  // 'breach' — faza 1: środek, dopóki linia ognia (przedłużona ×2) trafia w kadłub.
  if (beamLineBlockers(hull, g0x, g0y, g0x + (cgx - g0x) * 2, g0y + (cgy - g0y) * 2, -1, -1, 1) > 0) {
    if (opts.memory) opts.memory.cell = -1;
    return beamLatticeToWorld(hull, cgx, cgy, out);
  }
  // Faza 2 — poszerzanie wyrwy: K żywych komórek najbliższych wyrwie, najmniej zasłonięta.
  const K = Math.max(1, opts.candidates | 0 || 14);
  if (!bridge.aimDist || bridge.aimDist.length < bridge.total) bridge.aimDist = new Float64Array(Math.max(1, bridge.total));
  if (!bridge.aimPick || bridge.aimPick.length < K) bridge.aimPick = new Int32Array(K);
  const dist = bridge.aimDist, pick = bridge.aimPick;
  const ax = bridge.lossX, ay = bridge.lossY;
  let picked = 0;
  for (let k = 0; k < bridge.total; k++) {
    if (bridgeCellNode(hull, bridge.cellX[k], bridge.cellY[k]) < 0) { dist[k] = Infinity; continue; }
    const ex = bridge.pos[k * 2] - ax, ey = bridge.pos[k * 2 + 1] - ay;
    dist[k] = ex * ex + ey * ey;
    if (picked < K || dist[k] < dist[pick[picked - 1]]) {
      let j = Math.min(picked, K - 1);
      while (j > 0 && dist[pick[j - 1]] > dist[k]) { pick[j] = pick[j - 1]; j--; }
      pick[j] = k;
      if (picked < K) picked++;
    }
  }
  if (!picked) return beamLatticeToWorld(hull, cgx, cgy, out);
  let best = pick[0], bestBlock = Infinity;
  for (let q = 0; q < picked; q++) {
    const k = pick[q];
    const blockers = beamLineBlockers(hull, g0x, g0y, (bridge.cellX[k] + 0.5) * cs, (bridge.cellY[k] + 0.5) * cs,
      bridge.cellX[k], bridge.cellY[k], Number.isFinite(bestBlock) ? bestBlock : 64);
    if (blockers < bestBlock) { bestBlock = blockers; best = k; }
    if (bestBlock === 0) break;
  }
  const mem = opts.memory;
  if (mem) {
    const prev = Number.isInteger(mem.cell) ? mem.cell : -1;
    if (prev >= 0 && prev !== best && prev < bridge.total && mem.bridgeId === bridge.id
      && bridgeCellNode(hull, bridge.cellX[prev], bridge.cellY[prev]) >= 0) {
      const prevBlock = beamLineBlockers(hull, g0x, g0y, (bridge.cellX[prev] + 0.5) * cs, (bridge.cellY[prev] + 0.5) * cs,
        bridge.cellX[prev], bridge.cellY[prev], bestBlock + 1);
      if (prevBlock <= bestBlock) return beamLatticeToWorld(hull, (bridge.cellX[prev] + 0.5) * cs, (bridge.cellY[prev] + 0.5) * cs, out);
    }
    mem.cell = best;
    mem.bridgeId = bridge.id;
    mem.blockers = bestBlock;
  }
  return beamLatticeToWorld(hull, (bridge.cellX[best] + 0.5) * cs, (bridge.cellY[best] + 0.5) * cs, out);
}

// ============================ OKNA (dane szczelin) ============================

/**
 * Okna nadbudówki jak buildBridgeWindows (2–3 rzędy wzdłuż dłuższej osi strefy, serie oświetlonych
 * pomieszczeń) — okno przypięte do komórki pod sobą (gaśnie z nią). Szczeliny bridgeFx3D rysują je
 * tylko dla kadłubów bez modelu 3D (bridge3D.js); model bierze stąd barwę okien.
 */
export function buildBeamBridgeWindows(entity, opts = {}) {
  const st = entity?.bridgeState;
  if (!isBeamBridgeState(st)) return null;
  const pitch = positive(opts.pitch, 7.2);
  const rowGap = positive(opts.rowGap, 8.5);
  const slitLen = positive(opts.length, 2.1);
  const slitWid = positive(opts.width, 1.0);
  const cs = st.cellSize;
  const px = [], py = [], cellX = [], cellY = [], offX = [], offY = [], bridgeIdx = [], seed = [], level = [], ang = [];
  const colors = [];
  const p = { x: 0, y: 0 };
  for (let b = 0; b < st.bridges.length; b++) {
    const bridge = st.bridges[b];
    const def = bridge.def;
    colors[b] = parseHexColor(def.windowColor, st.windowColorSrgb).map(srgbToLinear);
    if (!bridge.total) continue;
    const wR = def.w * st.scaleX;
    const hR = def.h * st.scaleY;
    const alongW = wR >= hR;
    const lenR = alongW ? wR : hR;
    const crossR = alongW ? hR : wR;
    const rows = crossR > rowGap * 1.3 ? 2 : 1;
    const perRow = Math.max(1, Math.floor((lenR * 0.84) / pitch));
    const rot = def.rot * DEG + (alongW ? 0 : Math.PI * 0.5);
    const c = Math.cos(rot), s = Math.sin(rot);
    const seedBase = bridge.id.length * 131 + b * 977;
    for (let row = 0; row < rows; row++) {
      const vOff = rows === 1 ? 0 : (row - (rows - 1) * 0.5) * rowGap;
      let run = 2 + Math.floor(bridgeHash01(seedBase + row * 31, 1) * 4);
      let lit = true;
      for (let i = 0; i < perRow; i++) {
        if (run <= 0) {
          lit = !lit;
          run = lit ? 2 + Math.floor(bridgeHash01(seedBase + row * 31 + i, 2) * 4) : 1 + Math.floor(bridgeHash01(seedBase + row * 31 + i, 3) * 3);
        }
        run--;
        if (!lit) continue;
        const uOff = (i - (perRow - 1) * 0.5) * pitch + (bridgeHash01(seedBase + i, row + 5) - 0.5) * pitch * 0.18;
        const lxR = def.x * st.scaleX + uOff * c - vOff * s;  // px renderu od środka sprite'a
        const lyR = def.y * st.scaleY + uOff * s + vOff * c;
        const pX = lxR / st.scaleX, pY = lyR / st.scaleY;
        if (!bridgeZoneContains(def, pX, pY)) continue;
        beamPngToLattice(st, pX, pY, p);
        // Komórka pod oknem: najbliższa komórka mostka (w granicach komórki).
        let best = -1, bestD2 = (cs * 0.9) * (cs * 0.9);
        for (let k = 0; k < bridge.total; k++) {
          const ex = (bridge.cellX[k] + 0.5) * cs - p.x, ey = (bridge.cellY[k] + 0.5) * cs - p.y;
          const d2 = ex * ex + ey * ey;
          if (d2 < bestD2) { bestD2 = d2; best = k; }
        }
        if (best < 0) continue;
        px.push(pX); py.push(pY);
        cellX.push(bridge.cellX[best]); cellY.push(bridge.cellY[best]);
        offX.push(p.x - (bridge.cellX[best] + 0.5) * cs);
        offY.push(p.y - (bridge.cellY[best] + 0.5) * cs);
        bridgeIdx.push(b);
        seed.push(bridgeHash01(seedBase + i * 7 + row * 101, 11));
        const lvl = bridgeHash01(seedBase + i * 13 + row * 57, 23);
        level.push(lvl < 0.22 ? 0.35 + lvl : 0.72 + 0.28 * lvl);
        ang.push(rot);
      }
    }
  }
  const n = px.length;
  st.windows = {
    count: n,
    px: Float32Array.from(px),
    py: Float32Array.from(py),
    cellX: Int16Array.from(cellX),
    cellY: Int16Array.from(cellY),
    // przesunięcie okna względem środka komórki (siatka belek, j. świata)
    offX: Float32Array.from(offX),
    offY: Float32Array.from(offY),
    angle: Float32Array.from(ang),
    seed: Float32Array.from(seed),
    level: Float32Array.from(level),
    bridge: Uint8Array.from(bridgeIdx),
    shard: null,
    delay: new Float32Array(n),
    colorsLinear: colors,
    length: slitLen,
    width: slitWid
  };
  return st.windows;
}

/** Węzeł pod oknem `i` (−1 = okno wybite albo komórka na innym ciele). */
export function beamWindowNode(entity, win, i) {
  return bridgeCellNode(bridgeBeamHull(entity), win.cellX[i], win.cellY[i]);
}

/** Pozycja okna `i` w świecie gry (komórka spoczynkowa + przesunięcie). */
export function beamWindowWorld(entity, win, i, out, pose = null) {
  const hull = hostHull(entity);
  if (!hull) return null;
  const cs = hull.body.cellSize;
  return beamLatticeToWorld(hull, (win.cellX[i] + 0.5) * cs + win.offX[i], (win.cellY[i] + 0.5) * cs + win.offY[i], out, pose);
}

// ============================ BACKEND DLA shipBridge.js ============================

/**
 * Backend stanu mostków na belkach: funkcje ogólne shipBridge.js (bridgePngToWorld,
 * bridgeGridToWorld, updateShipBridges, getBridgeAimPoint…) wołają go, gdy stan go niesie
 * (`st.backend`). „Siatka” w API heksowym = piksele obrazu kadłuba.
 */
export const BEAM_BRIDGE_BACKEND = Object.freeze({
  kind: 'beam',
  update: updateBeamBridges,
  evaluate: evaluateBeamBridges,
  aimPoint: getBeamBridgeAimPoint,
  detach: (entity) => restoreBeamArmor(entity),
  owns: beamBridgeOwns,
  gridToWorld(entity, gx, gy, out, pose) {
    const st = entity.bridgeState;
    const hull = hostHull(entity);
    if (!hull || !st) { out.x = entityPosX(entity); out.y = entityPosY(entity); return out; }
    beamImageToLattice(st, gx, gy, _l);
    return beamLatticeToWorld(hull, _l.x, _l.y, out, pose);
  },
  worldToGrid(entity, wx, wy, out) {
    const st = entity.bridgeState;
    const hull = hostHull(entity);
    if (!hull || !st) { out.x = st ? st.srcW * 0.5 : 0; out.y = st ? st.srcH * 0.5 : 0; return out; }
    beamWorldToLattice(hull, wx, wy, _l);
    out.x = (_l.x - st.anchorDX) / st.spriteScale + st.srcW * 0.5;
    out.y = (st.anchorDY - _l.y) / st.spriteScale + st.srcH * 0.5;
    return out;
  },
  pngToWorld(entity, px, py, out, pose) {
    const st = entity.bridgeState;
    const hull = hostHull(entity);
    if (!hull || !st) { out.x = entityPosX(entity); out.y = entityPosY(entity); return out; }
    beamPngToLattice(st, px, py, _l);
    return beamLatticeToWorld(hull, _l.x, _l.y, out, pose);
  },
  worldToPng(entity, wx, wy, out) {
    const st = entity.bridgeState;
    const hull = hostHull(entity);
    if (!hull || !st) { out.x = 0; out.y = 0; return out; }
    beamWorldToLattice(hull, wx, wy, _l);
    return beamLatticeToPng(st, _l.x, _l.y, out);
  }
});
