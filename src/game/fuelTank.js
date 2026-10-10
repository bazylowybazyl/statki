// src/game/fuelTank.js
//
// ZBIORNIK PALIWA kadłuba belkowego (F14 audytu wybuchów, decyzja użytkownika 2026-10-08): MIEJSCE i SKALA wybuchu
// okrętu, który ginie bez detonacji rdzenia reaktora (śmierć z puli HP, śmierć gracza bez rdzenia). Bez stanów, bez
// pancerza i bez obrażeń — sam obraz (wybuch z gazu przez `window.makeReactorBlow`, src/3d/explosions/).
//
// Wzór: komora rdzenia (src/game/reactorCore.js) — montaż na świeżym kadłubie (`attachFuelTank` obok
// `attachEntityReactorCores`), zbiornik = komórki siatki belek w kole markera (tożsamość komórek ix, iy) i ród kadłuba
// (`hull.dmgKey`). Zbiornik IDZIE Z KADŁUBEM: w chwili śmierci (`fuelTankBlast`) leży tam, gdzie są jego żywe komórki —
// u gospodarza, a gdy odcięty odłam zabrał wszystkie, na wraku tego rodu (wtedy wybuch leci z wrakiem odłamu);
// komórki zniszczone — miejsce zbiornika w kadłubie gospodarza. Pozycja w świecie z pozy encji (HullBodies.entityPose —
// ta sama, którą rysuje skóra kadłuba).
// Moduł bez DOM i three.

import { HullBodies } from './hullBodies.js';
import { reactorHull, reactorCellNode, reactorCoreWorld, reactorLocalDirToWorld } from './reactorCore.js';
import {
  FUEL_TANK_MARKERS, FUEL_TANK_PROFILE_BY_CLASS, fuelTankBlastSize, fuelTankCapacityForArea, fuelTankClassForLength
} from '../data/fuelTanks.js';

const finite = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const positive = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/** Myśliwce, drony, przechwytywacze — bez zbiornika (śmierć: WeaponFx.droneBlast). */
export function isFighterLikeEntity(e) {
  if (!e) return true;
  if (e.fighter) return true;
  const t = String(e.type || '').toLowerCase();
  return t === 'fighter' || t === 'interceptor' || t === 'drone' || t === 'ally_fighter' || t === 'carrier_fighter';
}

/** Długość kadłuba wzdłuż osi dziobu [j.] z żywych węzłów siatki belek. */
export function fuelTankHullLength(hull) {
  const b = hull?.body;
  if (!b) return 0;
  const s = b.nodeStore;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    if (s.ox[i] < lo) lo = s.ox[i];
    if (s.ox[i] > hi) hi = s.ox[i];
  }
  return hi > lo ? hi - lo + (Number(b.cellSize) || 0) : 0;
}

/** Powierzchnia kadłuba [j.²] z żywych węzłów siatki belek. */
export function fuelTankHullArea(hull) {
  const b = hull?.body;
  if (!b) return 0;
  const cs = Number(b.cellSize) || 0;
  return Math.max(0, b.activeNodes | 0) * cs * cs;
}

// Głębokość komórek siatki pod powierzchnią kadłuba (BFS od pustych komórek i brzegu) — jak autoReactorMarker.
function depthField(body) {
  const s = body.nodeStore;
  const dx = body.dims.x | 0, dy = body.dims.y | 0;
  const n = dx * dy;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const ix = s.ix[i], iy = s.iy[i];
    if (ix < 0 || iy < 0 || ix >= dx || iy >= dy) continue;
    dist[ix + iy * dx] = 0x3fffffff;
  }
  let head = 0, tail = 0;
  for (let y = 0; y < dy; y++) {
    for (let x = 0; x < dx; x++) {
      const k = x + y * dx;
      if (dist[k] < 0) continue;
      const edge = x === 0 || y === 0 || x === dx - 1 || y === dy - 1
        || dist[k - 1] < 0 || dist[k + 1] < 0 || dist[k - dx] < 0 || dist[k + dx] < 0;
      if (edge) { dist[k] = 1; queue[tail++] = k; }
    }
  }
  while (head < tail) {
    const k = queue[head++];
    const d = dist[k] + 1;
    const x = k % dx, y = (k / dx) | 0;
    if (x > 0 && dist[k - 1] > d) { dist[k - 1] = d; queue[tail++] = k - 1; }
    if (x < dx - 1 && dist[k + 1] > d) { dist[k + 1] = d; queue[tail++] = k + 1; }
    if (y > 0 && dist[k - dx] > d) { dist[k - dx] = d; queue[tail++] = k - dx; }
    if (y < dy - 1 && dist[k + dx] > d) { dist[k + dx] = d; queue[tail++] = k + dx; }
  }
  return dist;
}

/**
 * Zbiornik z automatu dla kadłuba bez markera: komórka głęboko pod powierzchnią, w części RUFOWEJ (rufa = −x sprite'a),
 * blisko osi kadłuba, poza kołem komory reaktora (`avoid` — rdzenie encji: gx, gy, gridR w układzie siatki) z zapasem
 * promienia zbiornika i pół komórki (komory się nie nakładają). Wynik w przestrzeni PNG sprite'a (jak marker): { id, x, y, r, capacity }; null —
 * kadłub za mały.
 */
export function autoFuelTankMarker(entity, pngWidth, pngHeight, { avoid = null } = {}) {
  const hull = reactorHull(entity);
  if (!hull) return null;
  const body = hull.body, s = body.nodeStore, cs = body.cellSize, lm = body.latticeMin;
  const dx = body.dims.x | 0, dy = body.dims.y | 0;
  if (dx <= 0 || dy <= 0 || body.activeNodes < 12) return null;
  let comX = 0, comY = 0, cnt = 0, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    comX += s.ox[i]; comY += s.oy[i]; cnt++;
    if (s.ox[i] < minX) minX = s.ox[i];
    if (s.ox[i] > maxX) maxX = s.ox[i];
  }
  if (cnt < 12) return null;
  comX /= cnt; comY /= cnt;
  const halfLen = Math.max(cs, (maxX - minX) * 0.5);
  const dist = depthField(body);
  const cores = Array.isArray(avoid) ? avoid : [];
  let best = -1, bestScore = -Infinity, bestDepth = 0;
  for (let pass = 0; pass < 2 && best < 0; pass++) {
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const ix = s.ix[i], iy = s.iy[i];
      if (ix < 0 || iy < 0 || ix >= dx || iy >= dy) continue;
      const depth = dist[ix + iy * dx] * cs;
      const R = Math.max(0.75 * cs, Math.min(3 * cs, depth * 0.5));
      // Poza komorą reaktora (drugi przebieg — bez warunku, gdy kadłub za mały na rozdzielenie).
      let blocked = false;
      if (pass === 0) {
        for (let c = 0; c < cores.length; c++) {
          const k = cores[c];
          if (!k || k.invalid) continue;
          const ex = (s.ox[i] - lm.x) - k.gx, ey = (s.oy[i] - lm.y) - k.gy;
          const need = (Number(k.gridR) || 0) + R + 0.5 * cs;
          if (ex * ex + ey * ey < need * need) { blocked = true; break; }
        }
      }
      if (blocked) continue;
      // Głęboko, przy osi, w części rufowej: aft = (środek − x) / pół długości (rufa 1, dziób −1). Premia za rufę
      // MNOŻY głębokość — komórka przy brzegu (dysze, krawędź rufy) nie wygrywa samą premią.
      const aft = (comX - s.ox[i]) / halfLen;
      const aftK = aft < -1 ? -1 : (aft > 0.6 ? 0.6 : aft);
      const score = depth * (1 + 0.55 * aftK) - 0.3 * Math.abs(s.oy[i] - comY);
      if (score > bestScore) { bestScore = score; best = i; bestDepth = depth; }
    }
  }
  if (best < 0) return null;
  const lx = s.ox[best], ly = s.oy[best];
  const sxScale = hull.srcWidth / pngWidth, syScale = hull.srcHeight / pngHeight;
  const uniform = (sxScale + syScale) * 0.5;
  const R = Math.max(0.75 * cs, Math.min(3 * cs, bestDepth * 0.5));
  return {
    id: 'auto_fuel',
    x: (lx - lm.x - hull.anchorDX) / hull.scale / sxScale,
    y: -(ly - lm.y - hull.anchorDY) / hull.scale / syScale,
    r: R / (uniform * hull.scale),
    capacity: fuelTankCapacityForArea(fuelTankHullArea(hull))
  };
}

function editorTankMarker(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const m = list[0];
  if (!Number.isFinite(Number(m?.x)) || !Number.isFinite(Number(m?.y)) || !(Number(m?.r) > 0)) return null;
  return m;
}

// Zbiornik z markera PNG: komórki siatki w kole r (min. komórka pod środkiem). null = poza kadłubem.
function buildTank(entity, hull, marker, pngW, pngH, hullId, auto) {
  const body = hull.body, s = body.nodeStore, lm = body.latticeMin, cs = body.cellSize;
  const sxL = hull.srcWidth / pngW, syL = hull.srcHeight / pngH;
  const uniform = (sxL + syL) * 0.5;
  const lx = lm.x + hull.anchorDX + finite(marker.x) * sxL * hull.scale;
  const ly = lm.y + hull.anchorDY - finite(marker.y) * syL * hull.scale;
  const R = Math.max(0.75 * cs, positive(marker.r, 2 * cs / (uniform * hull.scale)) * uniform * hull.scale);
  const ixs = [], iys = [];
  let nearest = -1, nearestD = Infinity;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const ex = s.ox[i] - lx, ey = s.oy[i] - ly;
    const d = ex * ex + ey * ey;
    if (d <= R * R) { ixs.push(s.ix[i]); iys.push(s.iy[i]); }
    if (d < nearestD) { nearestD = d; nearest = i; }
  }
  if (ixs.length === 0) {
    if (nearest < 0 || nearestD > (R + cs) * (R + cs)) return null;
    ixs.push(s.ix[nearest]); iys.push(s.iy[nearest]);
  }
  const classId = fuelTankClassForLength(fuelTankHullLength(hull));
  const capacity = positive(marker.capacity, fuelTankCapacityForArea(fuelTankHullArea(hull)));
  return {
    id: marker.id || 'fuel',
    hullId: hullId || null,
    auto: !!auto,
    host: entity,
    lineage: hull.dmgKey,
    marker: { id: marker.id || 'fuel', x: finite(marker.x), y: finite(marker.y), r: R / (uniform * hull.scale), capacity },
    // środek i promień w układzie siatki (ciało − latticeMin) [j. świata] — pola jak w rdzeniu (reactorCoreWorld)
    gx: lx - lm.x,
    gy: ly - lm.y,
    gridR: R,
    capacity,
    classId,
    profile: FUEL_TANK_PROFILE_BY_CLASS[classId] || 'capital',
    size: fuelTankBlastSize(capacity),
    cellX: Int16Array.from(ixs),
    cellY: Int16Array.from(iys),
    lastX: 0,
    lastY: 0
  };
}

/**
 * Zbiornik paliwa na świeżym kadłubie belkowym (po HullBodies.createHull i po rdzeniach — zbiornik omija komorę
 * reaktora). Marker: edytor (`editorTanks`, gdy niesie `r`) → tabela (FUEL_TANK_MARKERS[hullId]) → automat. Marker
 * poza kadłubem (z innego sprite'a) — zastępczo automat. Myśliwce bez zbiornika. Wynik też w `entity.fuelTank`.
 */
export function attachFuelTank(entity, hullId = null, { editorTanks = null } = {}) {
  if (!entity || isFighterLikeEntity(entity)) return null;
  const hull = reactorHull(entity);
  if (!hull) return null;
  const img = hull.visualImage;
  const pngW = Number(img?.naturalWidth || img?.width) || hull.srcWidth;
  const pngH = Number(img?.naturalHeight || img?.height) || hull.srcHeight;
  const avoid = Array.isArray(entity.reactorCores) ? entity.reactorCores : null;
  let marker = editorTankMarker(editorTanks) || (hullId && FUEL_TANK_MARKERS[hullId]?.[0]) || null;
  let auto = false;
  let tank = marker ? buildTank(entity, hull, marker, pngW, pngH, hullId, false) : null;
  if (!tank) {
    marker = autoFuelTankMarker(entity, pngW, pngH, { avoid });
    auto = true;
    tank = marker ? buildTank(entity, hull, marker, pngW, pngH, hullId, auto) : null;
  }
  entity.fuelTank = tank;
  return tank;
}

export function detachFuelTank(entity) {
  if (entity) entity.fuelTank = null;
}

// Pierwsza encja rodu zbiornika, na której żyje któraś komórka zbiornika (gospodarz pierwszy). Zwraca liczbę żywych
// komórek; `out.entity`, środek ciężkości komórek w świecie (out.x, out.y).
const _q = { x: 0, y: 0 };
function locateTank(tank, host, candidates, out) {
  const tryEntity = (e) => {
    const hull = reactorHull(e);
    if (!hull || hull.dmgKey !== tank.lineage) return 0;
    let n = 0, sx = 0, sy = 0;
    for (let k = 0; k < tank.cellX.length; k++) {
      const i = reactorCellNode(hull, tank.cellX[k], tank.cellY[k]);
      if (i < 0) continue;
      HullBodies.nodeWorld(hull, i, _q);
      sx += _q.x; sy += _q.y; n++;
    }
    if (n > 0) { out.entity = e; out.x = sx / n; out.y = sy / n; }
    return n;
  };
  if (tryEntity(host) > 0) return out;
  if (Array.isArray(candidates)) {
    for (let c = 0; c < candidates.length; c++) {
      const e = candidates[c];
      if (e && e !== host && tryEntity(e) > 0) return out;
    }
  }
  return null;
}

function entityVel(e, out) {
  if (e?.vel && typeof e.vel.x === 'number') { out.vx = e.vel.x; out.vy = e.vel.y; }
  else { out.vx = finite(e?.vx); out.vy = finite(e?.vy); }
}

/**
 * Wybuch zbiornika przy śmierci gospodarza: { x, y, size, profile, vx, vy, axisX, axisY, onHost } (świat gry) albo
 * null (brak zbiornika / kadłuba). Miejsce: żywe komórki zbiornika u gospodarza; odcięte z odłamem — na wraku rodu z
 * `candidates` (window.wrecks), z jego prędkością; zniszczone — miejsce zbiornika w kadłubie gospodarza. Oś = oś kadłuba
 * (dziób) w świecie. Wołać PRZED zamianą kadłuba we wrak (createWreckage przenosi ciało).
 */
export function fuelTankBlast(entity, out = {}, { candidates = null } = {}) {
  const tank = entity?.fuelTank;
  const hull = reactorHull(entity);
  if (!tank || !hull) return null;
  const loc = locateTank(tank, entity, candidates, out);
  const owner = loc ? out.entity : entity;
  if (!loc) {
    reactorCoreWorld(tank, out);
  }
  const ownerHull = reactorHull(owner) || hull;
  reactorLocalDirToWorld(ownerHull, 1, 0, _q);
  out.axisX = _q.x; out.axisY = _q.y;
  entityVel(owner, out);
  out.onHost = owner === entity;
  out.size = tank.size;
  out.profile = tank.profile;
  out.entity = owner;
  tank.lastX = out.x; tank.lastY = out.y;
  return out;
}
