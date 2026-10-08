// src/game/hallDustInput.js
//
// PYŁ W HALACH K-7 — WEJŚCIE KLATKI po stronie gry (czyste funkcje: bez three, DOM i Core3D; testy node).
// Wybór hali przy kamerze (hale K-7 ringów Ziemi, Marsa i Jowisza z HaloRingCollider), przekształcenie
// hala → świat gry w double (sztywne: ramka hali → układ ringu → gra) i okręty w domenie — wszystko do
// Float64Array o STAŁYM układzie (HALL_DUST_IN). Krok efektów Core3D (src/3d/gasField/hallDust.js) czyta
// tylko tę tablicę i dysze z EngineFrame: szew gra ↔ render to jedna tablica (uzgodnione z sesją
// „Rendering w workerze” 2026-10-07 — przeniesienie renderu do workera = przekazanie tablicy, bez
// referencji do encji).
import {
  HALL_DUST_IN, HALL_DUST_MASK, HALL_DUST_MAX_SHIPS, HALL_DUST_SERVICE, HALL_DUST_SERVICE_BERTHS, HALL_DUST_SHIP,
  hallDustDomain, hallDomainDistance
} from '../3d/gasField/hallDustLayout.js';
import { createK7Layout } from '../3d/haloRing/haloPortK7Layout.js';
import { hullFootprint } from './hullFootprint.js';

// Układ tablicy wejścia mieszka we wspólnym, czystym module (czyta go też krok efektów).
export { HALL_DUST_IN, HALL_DUST_MASK, HALL_DUST_MAX_SHIPS, HALL_DUST_SHIP };

/** Kamera dalej od domeny hali niż pół przekątnej kadru + ten zapas [j.] — hala nieaktywna. */
export const HALL_DUST_REACH = 2500;

export function createHallDustInput() {
  return new Float64Array(HALL_DUST_IN.size);
}

const LAYOUT = createK7Layout();
const DOMAIN = hallDustDomain(LAYOUT);
const CAPITAL_IDS = LAYOUT.berths.filter((b) => b.size === 'CAPITAL').map((b) => b.id).slice(0, HALL_DUST_SERVICE_BERTHS);
const HALL_MID_Z = (LAYOUT.backZ + LAYOUT.frontZ) * 0.5;

/**
 * Przekształcenie hala (x, z) → świat gry: p0 + x·(ax, ay) + z·(bx, by). Złożenie liniowe policzone
 * analitycznie (ramka hali k7Frame: hub → układ ringu, `place` kolidera: układ ringu → gra), bez
 * odejmowania dużych liczb — dokładne w double także przy 5–10 mln j.
 */
export function hallToGameAffine(place, frame, out) {
  const c = place.cos;
  const s = place.sin;
  // haloLocalToGame: gra = place + (lx·c − ly·s, −(lx·s + ly·c)); k7HubToWorld: lokal = origin + x·t + z·r
  out.p0x = place.x + frame.origin.x * c - frame.origin.y * s;
  out.p0y = place.y - (frame.origin.x * s + frame.origin.y * c);
  out.ax = frame.tx * c - frame.ty * s;
  out.ay = -(frame.tx * s + frame.ty * c);
  out.bx = frame.rx * c - frame.ry * s;
  out.by = -(frame.rx * s + frame.ry * c);
  return out;
}

/** Punkt świata gry → hala (odwrotność `hallToGameAffine`). */
export function gameToHall(aff, gx, gy, out) {
  const dx = gx - aff.p0x;
  const dy = gy - aff.p0y;
  const det = aff.ax * aff.by - aff.bx * aff.ay;
  out.x = (aff.by * dx - aff.bx * dy) / det;
  out.z = (aff.ax * dy - aff.ay * dx) / det;
  return out;
}

/** Wektor świata gry → hala. */
export function gameVecToHall(aff, vx, vy, out) {
  const det = aff.ax * aff.by - aff.bx * aff.ay;
  out.x = (aff.by * vx - aff.bx * vy) / det;
  out.z = (aff.ax * vy - aff.ay * vx) / det;
  return out;
}

const _aff = { p0x: 0, p0y: 0, ax: 1, ay: 0, bx: 0, by: 1 };
const _best = { p0x: 0, p0y: 0, ax: 1, ay: 0, bx: 0, by: 1 };
const _h = { x: 0, z: 0 };
const _v = { x: 0, z: 0 };
const _w = { x: 0, z: 0 };

function num(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/** Blok obsługi stanowisk capital (HALL_DUST_SERVICE) z mapy póz hali (berthId → poza K-7) albo zera. */
export function packHallService(out, poses) {
  const S = HALL_DUST_SERVICE;
  for (let i = 0; i < HALL_DUST_SERVICE_BERTHS; i++) {
    const o = HALL_DUST_IN.service + i * S.stride;
    const p = poses && typeof poses.get === 'function' ? poses.get(CAPITAL_IDS[i]) : null;
    out[o + S.lock] = p ? num(p.lock) : 0;
    out[o + S.extension] = p ? num(p.extension) : 0;
    out[o + S.flow] = p ? num(p.flow) : 0;
    out[o + S.vent] = p ? num(p.vent) : 0;
    out[o + S.occupied] = p && (num(p.clamp) > 0.5 || num(p.lock) > 0.5) ? 1 : 0;
    out[o + S.seat] = p ? num(p.seat) : 0;
  }
  return out;
}

// Okręt → rekord HALL_DUST_SHIP: kotwica, osie kadłuba i prędkości w układzie hali, maska OBRYSU (z żywych
// węzłów siatki belek — hullFootprint.js; gaz rozcina kształt okrętu, nie pudło).
function putShip(out, n, e) {
  const I = HALL_DUST_IN;
  const S = HALL_DUST_SHIP;
  if (!e || e.dead || e.destroyed || n >= HALL_DUST_MAX_SHIPS) return n;
  const px = num(e.pos ? e.pos.x : e.x, NaN);
  const py = num(e.pos ? e.pos.y : e.y, NaN);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return n;
  const fp = hullFootprint(e, HALL_DUST_MASK.w, HALL_DUST_MASK.h);
  if (!fp || !fp.cells) return n;
  gameToHall(_best, px, py, _h);
  if (hallDomainDistance(DOMAIN, _h.x, _h.z) > fp.reach) return n;
  // układ kadłuba → gra (jak HullBodies.nodeWorld): θ = −(angle + rot), oś X → (c, −s), oś Y → (−s, −c)
  const th = -(num(e.angle) + fp.rot);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const o = I.header + n * I.stride;
  out[o + S.cx] = _h.x;
  out[o + S.cz] = _h.z;
  gameVecToHall(_best, c, -s, _v);
  out[o + S.ex] = _v.x;
  out[o + S.ez] = _v.z;
  gameVecToHall(_best, -s, -c, _v);
  out[o + S.fx] = _v.x;
  out[o + S.fz] = _v.z;
  out[o + S.x0] = fp.x0;
  out[o + S.y0] = fp.y0;
  out[o + S.tx] = fp.tx;
  out[o + S.ty] = fp.ty;
  const vx = num(e.vel ? e.vel.x : e.vx);
  const vy = num(e.vel ? e.vel.y : e.vy);
  gameVecToHall(_best, vx, vy, _w);
  out[o + S.vx] = _w.x;
  out[o + S.vz] = _w.z;
  // ω w grze (y w dół) → w hali: × znak wyznacznika (przekształcenie sztywne, może odbijać)
  const det = _best.ax * _best.by - _best.bx * _best.ay;
  out[o + S.w] = num(e.angVel) * (det < 0 ? -1 : 1);
  out[o + S.reach] = fp.reach;
  out[o + 14] = 0;
  out[o + 15] = 0;
  const words = fp.words;
  for (let k = 0; k < HALL_DUST_MASK.words; k++) out[o + S.mask + k] = words[k];
  return n + 1;
}

/**
 * Wejście klatki. `o`: dt [s] (0 w pauzie), camX / camY (środek kadru, świat gry), viewHalf (pół przekątnej
 * kadru [j.]), rings — lista z polem `collider` (HaloRingGame.entries), ship / ship2 / npcs (okręty gry —
 * do tablicy trafiają tylko liczby), sun ({ x, y } — Słońce gry), clock — zegar migania świateł hal
 * (HaloRingGame.clock). Z rejestru kolidera (hala `registry.halls[k]`): pozy obsługi stanowisk (`poses` —
 * przewody paliwowe: źródła gazu) i poziom lamp (`lampLevel`, dzień / noc — pisze HaloRingGame).
 */
export function packHallDustFrame(out, o = {}) {
  const I = HALL_DUST_IN;
  out[I.serial] = (out[I.serial] + 1) % 1e9;
  out[I.dt] = Math.max(0, num(o.dt));
  out[I.active] = 0;
  out[I.hall] = 0;
  out[I.ships] = 0;
  out[I.viewHalf] = Math.max(0, num(o.viewHalf));
  out[I.clock] = num(o.clock);
  const camX = num(o.camX, NaN);
  const camY = num(o.camY, NaN);
  const rings = o.rings;
  if (!rings || !Number.isFinite(camX) || !Number.isFinite(camY)) return out;
  let bestD = Infinity;
  let key = 0;
  let bestOwner = null;
  for (let ri = 0; ri < rings.length; ri++) {
    const col = rings[ri] && rings[ri].collider;
    const halls = col && col.registry && col.registry.halls;
    if (!halls || !col.place) continue;
    for (let k = 0; k < halls.length; k++) {
      const owner = halls[k];
      if (!owner || !owner.frame) continue;
      hallToGameAffine(col.place, owner.frame, _aff);
      gameToHall(_aff, camX, camY, _h);
      const d = hallDomainDistance(DOMAIN, _h.x, _h.z);
      if (d < bestD) {
        bestD = d;
        key = (ri + 1) * 16 + (num(owner.index, k) + 1);
        bestOwner = owner;
        _best.p0x = _aff.p0x; _best.p0y = _aff.p0y;
        _best.ax = _aff.ax; _best.ay = _aff.ay;
        _best.bx = _aff.bx; _best.by = _aff.by;
      }
    }
  }
  if (!key || bestD > out[I.viewHalf] + HALL_DUST_REACH) return out;
  out[I.active] = 1;
  out[I.hall] = key;
  out[I.lamps] = num(bestOwner.lampLevel, 0.22);
  packHallService(out, bestOwner.poses);
  out[I.p0x] = _best.p0x; out[I.p0y] = _best.p0y;
  out[I.ax] = _best.ax; out[I.ay] = _best.ay;
  out[I.bx] = _best.bx; out[I.by] = _best.by;
  out[I.sunX] = 0;
  out[I.sunY] = 0;
  const sun = o.sun;
  if (sun && Number.isFinite(sun.x) && Number.isFinite(sun.y)) {
    const cx = _best.p0x + HALL_MID_Z * _best.bx;
    const cy = _best.p0y + HALL_MID_Z * _best.by;
    gameVecToHall(_best, sun.x - cx, sun.y - cy, _v);
    const l = Math.sqrt(_v.x * _v.x + _v.z * _v.z);
    if (l > 1e-9) { out[I.sunX] = _v.x / l; out[I.sunY] = _v.z / l; }
  }
  let n = 0;
  n = putShip(out, n, o.ship);
  n = putShip(out, n, o.ship2);
  const npcs = o.npcs;
  if (npcs) for (let i = 0; i < npcs.length && n < HALL_DUST_MAX_SHIPS; i++) n = putShip(out, n, npcs[i]);
  out[I.ships] = n;
  return out;
}
