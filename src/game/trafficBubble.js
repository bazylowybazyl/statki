/**
 * BAŃKA RUCHU v2 PO STRONIE GRY (E6, docs/PLAN-ekonomia-rynki.md § 3.5).
 *
 * Lot lekkich statków liczy worker ruchu (`traffic/workerBubble.js`); gra dostaje
 * po każdym `advance` bufor póz (`ACTOR_FIELD`, `TrafficBridge.actors`) i robi
 * z nim to, co jest rozgrywką (zasada 1 — trafienia i zderzenia w 2D, w grze):
 *   - pozy w CZASIE GRY: bufor jest ważny w chwili `actors.time` (klatkę za
 *     grą), więc pozycję ekstrapolujemy do kroku fizyki i do klatki renderu —
 *     drugim rzędem (ruch faktyczny kroku + przyspieszenie z workera): nowy
 *     bufor zmienia pozę o ułamek jednostki, przy 240 Hz obraz nie drga;
 *   - trafienia pociskami (odcinek w ruchu względnym kontra obrys kadłuba —
 *     prostokąt `LENGTH` × `WIDTH`) i taran statku gracza;
 *   - punkty życia (w grze — świat ruchu ich nie zna); zniszczenie idzie do
 *     workera (`destroyCourse` → kurs zniszczony, wrak z ładunkiem), encja
 *     znika z obrazu od razu; okręty zapasu floty na padach K-7 (`STOCK`, bez
 *     kursu) zatrzymują pociski i taran, ale obrażeń jeszcze nie przyjmują;
 *   - stanowiska: które zajmuje ruch (rejestr lampek i postoju gracza) i które
 *     zajmuje gracz (`berth-hold` do workera).
 *
 * Czysty moduł: bez three, DOM i `window` — index.html podaje most, rejestr
 * stanowisk i haki (wybuch, notatki).
 */

import {
  ACTOR_STRIDE, ACTOR_FIELD, ACTOR_PHASES, ACTOR_FLAG
} from './traffic/trafficProtocol.js';
import { resolveTrafficHullId } from '../data/trafficHulls.js';

const F = ACTOR_FIELD;

export const TRAFFIC_BUBBLE_TUNE = {
  /**
   * Trafienia i taran tylko w tym promieniu od gracza — zasięg życia NPC gry
   * (`NPC_DESPAWN_RADIUS` 20 tys. j.). Dalej encje są obrazem (bańka 60 tys.).
   */
  hitRadius: 20000,
  /** Punkty życia z pola obrysu: dł. × szer. / `hpPerArea`, w granicach. */
  hpPerArea: 60,
  hpMin: 300,
  hpMax: 9000,
  /** Taran: obrażenia = `ramK` · v² (v — prędkość zbliżenia w osi kontaktu). */
  ramK: 0.02,
  /** Taran poniżej tej prędkości zbliżenia — tylko rozepchnięcie. */
  ramMinSpeed: 40,
  /**
   * Taran AWARYJNY (encja bez awansu — kadłub bez pełnego NPC, limit awansów pełny): najwyżej taki ułamek maks.
   * punktów na kontakt i kontakt nie częściej niż co `ramCooldown` s na encję — obrażenia rozkładają się w czasie,
   * nic nie ginie w pierwszej klatce (2026-10-26, „wybuchł od razu, jak go dotknąłem”).
   */
  ramMaxFrac: 0.15,
  ramCooldown: 0.5,
  /** Encja w warpie albo szybsza (hipercruise encji) — taran jej nie dotyka (duch). */
  ramGhostSpeed: 2500,
  /** Zniszczona encja znika z obrazu na tyle sekund (worker usuwa ją krok później). */
  deadHold: 6,
  /** Postój gracza na stanowisku: prędkość poniżej i zapas pola [j.]. */
  holdSpeed: 160,
  holdMargin: 120,
  /** Jak często liczyć stanowiska gracza [s czasu gry]. */
  holdInterval: 0.25
};

const PHASE_AT_BERTH = new Set(['capture', 'docked', 'undock']);

function makeActor(id) {
  return {
    id, alive: false, seen: 0,
    unitClass: '', hullId: '', factionId: null, x: 0, y: 0, angle: 0, vx: 0, vy: 0, angVel: 0, ax: 0, ay: 0,
    length: 0, width: 0, phase: 'fly', flags: 0, throttle: 0, speed: 0, dockTime: 0,
    berthId: null, port: -1, berth: -1, time: 0,
    // poza w czasie gry (krok fizyki / klatka renderu)
    cx: 0, cy: 0, ca: 0, prevX: NaN, prevY: NaN, prevA: NaN,
    hp: 0, maxHp: 0, hitAt: -Infinity, mode: null
  };
}

/** Stan bańki gry. `bridge` — `TrafficBridge` (albo obiekt z `actors`, `hulls`, `tables`, `destroyCourse`). */
export function createTrafficBubble(bridge, options = {}) {
  return {
    bridge,
    tune: { ...TRAFFIC_BUBBLE_TUNE, ...(options.tune || {}) },
    /** numer kursu → encja (żyje, dopóki worker ją przysyła). */
    byId: new Map(),
    /** Żywe encje — gęsta lista, kolejność z ostatniego bufora. */
    list: [],
    /** numer kursu → czas gry, do którego zniszczona encja nie wraca na obraz. */
    dead: new Map(),
    /** Numery kursów awansowanych do pełnego NPC gry (`trafficPromotion.js`) — nie wracają jako encje. */
    promoted: new Set(),
    /** numer kursu → czas gry ostatnich obrażeń taranu awaryjnego (`trafficRamFallbackDamage`). */
    ramAt: new Map(),
    seq: -1,
    frame: 0,
    /** Czas gry, w którym policzone są `cx`, `cy`, `ca` (`setTime`). */
    time: 0,
    hooks: {
      onDestroyed: typeof options.onDestroyed === 'function' ? options.onDestroyed : null,
      /** (encja, obrażenia, przyczyna) — encja z kursem trafiona i żywa (awans do NPC, `trafficPromotion.js`). */
      onHit: typeof options.onHit === 'function' ? options.onHit : null
    },
    /** Narzędzia (A/B kosztu obrazu): true = bez proxy na ekranie, rozgrywka bez zmian. */
    hideRender: false,
    held: [],
    heldKey: '',
    holdTimer: 0,
    /** `gameMs` — średni koszt bańki na wątku gry w klatce (pisze index.html). */
    stats: { actors: 0, hits: 0, rams: 0, destroyed: 0, held: 0, gameMs: 0 }
  };
}

function maxHpFor(tune, length, width) {
  const hp = (length * width) / tune.hpPerArea;
  return Math.round(Math.min(tune.hpMax, Math.max(tune.hpMin, hp)));
}

/**
 * Nowy bufor z mostu → encje (raz na wiadomość). Encje, których worker już nie
 * przysyła, znikają; zniszczone lokalnie nie wracają przez `deadHold`.
 */
export function syncTrafficBubble(tb, gameTime = tb.time) {
  const actors = tb.bridge?.actors;
  if (!actors || actors.seq === tb.seq) return false;
  tb.seq = actors.seq;
  const frame = ++tb.frame;
  const data = actors.data;
  const hulls = tb.bridge.hulls || [];
  const berthTable = tb.bridge.tables?.berths || null;
  const stations = tb.bridge.tables?.stations || null;
  const factions = tb.bridge.tables?.factions || null;
  for (const [id, until] of tb.dead) if (until <= gameTime) tb.dead.delete(id);
  const list = tb.list;
  list.length = 0;
  for (let k = 0; k < actors.count; k++) {
    const o = k * ACTOR_STRIDE;
    const id = data[o + F.ID];
    // Kurs: numer ≥ 0; zapas floty (STOCK): id ujemny — oba stałe przez życie encji.
    if (!Number.isFinite(id) || tb.dead.has(id) || tb.promoted.has(id)) continue;
    let a = tb.byId.get(id);
    if (!a) {
      a = makeActor(id);
      tb.byId.set(id, a);
    }
    const unitClass = hulls[data[o + F.HULL]] || '';
    if (a.unitClass !== unitClass) {
      a.unitClass = unitClass;
      a.hullId = resolveTrafficHullId(unitClass);
    }
    a.x = data[o + F.X];
    a.y = data[o + F.Y];
    a.angle = data[o + F.ANGLE];
    a.vx = data[o + F.VX];
    a.vy = data[o + F.VY];
    a.angVel = data[o + F.ANG_VEL];
    a.ax = data[o + F.AX];
    a.ay = data[o + F.AY];
    a.length = data[o + F.LENGTH];
    a.width = data[o + F.WIDTH];
    a.phase = ACTOR_PHASES[data[o + F.PHASE]] || 'fly';
    a.flags = data[o + F.FLAGS];
    a.mode = (a.flags & ACTOR_FLAG.WARP) ? 'warp' : null;
    a.throttle = data[o + F.THROTTLE];
    a.dockTime = data[o + F.DOCK_TIME];
    a.speed = data[o + F.SPEED];
    const fi = data[o + F.FACTION];
    a.factionId = fi >= 0 && factions ? (factions[fi] || null) : null;
    a.port = data[o + F.PORT];
    a.berth = data[o + F.BERTH];
    const stationId = a.port >= 0 && stations ? stations[a.port]?.id : null;
    a.berthId = stationId && a.berth >= 0 && berthTable ? (berthTable[stationId]?.[a.berth] || null) : null;
    a.time = actors.time;
    if (!a.alive) {
      a.alive = true;
      a.maxHp = maxHpFor(tb.tune, a.length, a.width);
      a.hp = a.maxHp;
      a.prevX = NaN;
    }
    a.seen = frame;
    list.push(a);
  }
  for (const [id, a] of tb.byId) {
    if (a.seen !== frame) {
      a.alive = false;
      tb.byId.delete(id);
    }
  }
  tb.stats.actors = list.length;
  return true;
}

/**
 * Pozy encji w czasie gry `time` (czas mostu: suma `advance`) — ekstrapolacja
 * z bufora prędkością. Woła się przed testami kroku fizyki i przed renderem.
 * `keepPrev` — poprzednia poza zostaje w `prevX/Y/A` (interpolacja renderu).
 */
export function setTrafficBubbleTime(tb, time) {
  tb.time = time;
  const list = tb.list;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const dt = Math.max(0, Math.min(EXTRAPOLATE_MAX, time - a.time));
    const k = accelTerm(dt);
    a.cx = a.x + a.vx * dt + a.ax * k;
    a.cy = a.y + a.vy * dt + a.ay * k;
    a.ca = a.angle + a.angVel * dt;
  }
}

/** Ekstrapolacja najwyżej tyle [s] — dłuższa przerwa bufora (zatkany worker) nie wynosi statku w pustkę. */
const EXTRAPOLATE_MAX = 0.5;
/** Przyspieszenie działa najwyżej tyle [s] — potem prędkość stała (rozpęd kończy się na vmax). */
const ACCEL_HORIZON = 0.05;

/** Człon przyspieszenia ekstrapolacji: ½·τ² do `ACCEL_HORIZON`, dalej liniowo (ciągły z pochodną). */
function accelTerm(tau) {
  if (tau <= ACCEL_HORIZON) return 0.5 * tau * tau;
  return ACCEL_HORIZON * (tau - 0.5 * ACCEL_HORIZON);
}

/** Poza encji w czasie gry `time` (bez zapisu) — render z `alpha`. */
export function trafficActorPoseAt(a, time, out) {
  const dt = Math.max(0, Math.min(EXTRAPOLATE_MAX, time - a.time));
  const k = accelTerm(dt);
  out.x = a.x + a.vx * dt + a.ax * k;
  out.y = a.y + a.vy * dt + a.ay * k;
  out.angle = a.angle + a.angVel * dt;
  return out;
}

/**
 * Odcinek (x0, y0) → (x1, y1) z promieniem `pad` kontra obrys encji (prostokąt
 * wzdłuż dziobu). Zwraca ułamek odcinka w chwili wejścia (0…1) albo −1.
 * Odcinek ma być już w ruchu względnym encji (pocisk minus jej przesunięcie).
 */
export function segmentHitsActor(a, x0, y0, x1, y1, pad = 0) {
  const c = Math.cos(a.ca);
  const s = Math.sin(a.ca);
  const hx = a.length * 0.5 + pad;
  const hy = a.width * 0.5 + pad;
  const ax = x0 - a.cx;
  const ay = y0 - a.cy;
  const bx = x1 - a.cx;
  const by = y1 - a.cy;
  // Do osi kadłuba: u wzdłuż dziobu, v w poprzek.
  const u0 = ax * c + ay * s;
  const v0 = -ax * s + ay * c;
  const du = (bx * c + by * s) - u0;
  const dv = (-bx * s + by * c) - v0;
  let t0 = 0;
  let t1 = 1;
  // Slab po u.
  if (Math.abs(du) < 1e-9) {
    if (u0 < -hx || u0 > hx) return -1;
  } else {
    let ta = (-hx - u0) / du;
    let tb = (hx - u0) / du;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  if (Math.abs(dv) < 1e-9) {
    if (v0 < -hy || v0 > hy) return -1;
  } else {
    let ta = (-hy - v0) / dv;
    let tb = (hy - v0) / dv;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  return t0;
}

const _hit = { actor: null, t: 0, x: 0, y: 0 };

/**
 * Pierwsza encja na drodze pocisku w tym kroku: pocisk w (x, y) z prędkością
 * (vx, vy) przeleciał `dt` — odcinek liczony w ruchu względnym każdej encji.
 * `fromX/Y` — punkt, od którego liczyć (gracz) dla odcięcia `hitRadius`.
 * Zwraca wspólny obiekt `{ actor, t, x, y }` albo null.
 */
export function trafficBulletHit(tb, x, y, vx, vy, dt, pad, fromX, fromY) {
  const list = tb.list;
  if (!list.length) return null;
  const r2 = tb.tune.hitRadius * tb.tune.hitRadius;
  let best = null;
  let bestT = Infinity;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive) continue;
    const ox = a.cx - fromX;
    const oy = a.cy - fromY;
    if (ox * ox + oy * oy > r2) continue;
    // Szybkie odrzucenie: odległość od środka większa niż promień kadłuba + droga pocisku.
    const reach = a.length * 0.5 + pad + Math.abs(vx - a.vx) * dt + Math.abs(vy - a.vy) * dt;
    const dx = x - a.cx;
    const dy = y - a.cy;
    if (dx * dx + dy * dy > reach * reach) continue;
    const x0 = x - (vx - a.vx) * dt;
    const y0 = y - (vy - a.vy) * dt;
    const t = segmentHitsActor(a, x0, y0, x, y, pad);
    if (t >= 0 && t < bestT) { bestT = t; best = a; }
  }
  if (!best) return null;
  _hit.actor = best;
  _hit.t = bestT;
  _hit.x = x - (vx - best.vx) * dt * (1 - bestT);
  _hit.y = y - (vy - best.vy) * dt * (1 - bestT);
  return _hit;
}

/**
 * Obrażenia encji. Zwraca true, gdy encja zginęła (strata zgłoszona workerowi: kurs — `destroyCourse`, wrak
 * z ładunkiem w świecie ruchu; zapas floty, postój, odlot — `entityLost`, ubytek zapasu frakcji / statku firmy).
 * Nietykalnych nie ma (2026-10-23): STOCK, PARKED i DEPARTED biorą obrażenia i awansują jak kursy.
 */
export function damageTrafficActor(tb, a, amount, x, y, cause = 'player') {
  if (!a?.alive || !(amount > 0)) return false;
  a.hp -= amount;
  a.hitAt = tb.time;
  tb.stats.hits++;
  if (a.hp > 0) {
    tb.hooks.onHit?.(a, amount, cause);
    return false;
  }
  destroyTrafficActor(tb, a, x, y, cause);
  return true;
}

export function destroyTrafficActor(tb, a, x = a.cx, y = a.cy, cause = 'player') {
  if (!a?.alive) return;
  a.alive = false;
  a.hp = 0;
  tb.dead.set(a.id, tb.time + tb.tune.deadHold);
  tb.byId.delete(a.id);
  const at = tb.list.indexOf(a);
  if (at >= 0) tb.list.splice(at, 1);
  tb.stats.destroyed++;
  // Kurs (numer ≥ 0, bez DEPARTED) — kurs zniszczony; encja bez kursu — strata statku po stronie świata.
  if (a.id >= 0 && !(a.flags & ACTOR_FLAG.DEPARTED)) tb.bridge?.destroyCourse?.(a.id, { x, y, reason: cause, byPirates: false });
  else tb.bridge?.entityLost?.(a.id, { x, y, reason: cause });
  tb.hooks.onDestroyed?.(a, x, y, cause);
}

/**
 * Czas do kontaktu kadłuba gracza z obrysem encji [s] — awans przed taranem (`trafficPromotion.js`). Gracz:
 * prostokąt `length × width` w (x, y) pod kątem `angle`, ruch (vx, vy); encja — prostokąt obrysu w pozie kroku
 * (`cx`, `cy`, `ca`). W układzie encji obrys gracza to jego rzut na osie encji (dokładny przy równoległych osiach,
 * dla ukosu — pudło opisane), dodany do obrysu encji z zapasem `pad`; ruch względny prostoliniowy (test płyt).
 * 0 — obrysy już zachodzą, Infinity — miną się albo rozjeżdżają.
 */
export function trafficContactTime(a, x, y, vx, vy, angle, length, width, pad = 0) {
  const c = Math.cos(a.ca);
  const s = Math.sin(a.ca);
  const dc = Math.cos(angle - a.ca);
  const ds = Math.sin(angle - a.ca);
  const rx = x - a.cx;
  const ry = y - a.cy;
  const px = rx * c + ry * s;
  const py = -rx * s + ry * c;
  const wx = vx - a.vx;
  const wy = vy - a.vy;
  const qx = wx * c + wy * s;
  const qy = -wx * s + wy * c;
  const pl = length * 0.5;
  const pw = width * 0.5;
  const hx = a.length * 0.5 + (dc < 0 ? -dc : dc) * pl + (ds < 0 ? -ds : ds) * pw + pad;
  const hy = a.width * 0.5 + (ds < 0 ? -ds : ds) * pl + (dc < 0 ? -dc : dc) * pw + pad;
  if (px <= hx && px >= -hx && py <= hy && py >= -hy) return 0;
  let t0 = 0;
  let t1 = Infinity;
  if (qx > -1e-9 && qx < 1e-9) {
    if (px > hx || px < -hx) return Infinity;
  } else {
    let ta = (-hx - px) / qx;
    let tb2 = (hx - px) / qx;
    if (ta > tb2) { const t = ta; ta = tb2; tb2 = t; }
    if (ta > t0) t0 = ta;
    if (tb2 < t1) t1 = tb2;
  }
  if (qy > -1e-9 && qy < 1e-9) {
    if (py > hy || py < -hy) return Infinity;
  } else {
    let ta = (-hy - py) / qy;
    let tb2 = (hy - py) / qy;
    if (ta > tb2) { const t = ta; ta = tb2; tb2 = t; }
    if (ta > t0) t0 = ta;
    if (tb2 < t1) t1 = tb2;
  }
  return t0 <= t1 ? t0 : Infinity;
}

/**
 * Encja awansowana do pełnego NPC (`trafficPromotion.js`): znika z obrazu i trafień bańki od razu (worker
 * zwolni ją po `attach`), nie wraca, dopóki NPC żyje.
 */
export function markTrafficActorPromoted(tb, a) {
  if (!a) return;
  tb.promoted.add(a.id);
  a.alive = false;
  tb.byId.delete(a.id);
  const at = tb.list.indexOf(a);
  if (at >= 0) tb.list.splice(at, 1);
}

/** NPC wrócił do bańki (`detach`) albo zginął — numer kursu znów może być encją (zniszczony — w `dead`). */
export function releaseTrafficPromotion(tb, id, destroyed = false) {
  tb.promoted.delete(id);
  if (destroyed) tb.dead.set(id, tb.time + tb.tune.deadHold);
}

const _ram = { actor: null, nx: 0, ny: 0, depth: 0, speed: 0 };
const _sat = { nx: 0, ny: 0 };

/**
 * SAT dwóch prostokątów: P (środek w odstępie (dx, dy) od A, osie cos/sin `pc`, `ps`, wymiary `pl` × `pw`) kontra
 * A (`ac`, `as`, `al` × `aw`). Głębokość wnikania (≤ 0 — bez kontaktu), normalna od A do P w `_sat`.
 */
function rectDepth(dx, dy, pc, ps, pl, pw, ac, as, al, aw) {
  let minDepth = Infinity;
  for (let k = 0; k < 4; k++) {
    const axX = k === 0 ? pc : k === 1 ? -ps : k === 2 ? ac : -as;
    const axY = k === 0 ? ps : k === 1 ? pc : k === 2 ? as : ac;
    const projP = Math.abs(pc * axX + ps * axY) * pl * 0.5 + Math.abs(-ps * axX + pc * axY) * pw * 0.5;
    const projA = Math.abs(ac * axX + as * axY) * al * 0.5 + Math.abs(-as * axX + ac * axY) * aw * 0.5;
    const dist = dx * axX + dy * axY;
    const depth = projP + projA - Math.abs(dist);
    if (depth <= 0) return -1;
    if (depth < minDepth) {
      minDepth = depth;
      const sign = dist >= 0 ? 1 : -1;
      _sat.nx = axX * sign;
      _sat.ny = axY * sign;
    }
  }
  return minDepth;
}

/**
 * Taran: kadłub gracza (prostokąt `length` × `width` w (x, y), kurs `angle`,
 * prędkość (vx, vy)) kontra obrysy encji — SAT dwóch prostokątów. Zwraca
 * najgłębszy kontakt `{ actor, nx, ny, depth, speed }` (normalna od encji do
 * gracza, prędkość zbliżenia ≥ 0) albo null. Bez zmian stanu. Encja w warpie
 * albo szybsza niż `tune.ramGhostSpeed` (hipercruise) to duch — bez kontaktu.
 */
export function trafficRamContact(tb, x, y, angle, length, width, vx, vy) {
  const list = tb.list;
  if (!list.length) return null;
  const r2 = tb.tune.hitRadius * tb.tune.hitRadius;
  const g2 = tb.tune.ramGhostSpeed * tb.tune.ramGhostSpeed;
  const pr = Math.sqrt(length * length + width * width) * 0.5;
  const pc = Math.cos(angle);
  const ps = Math.sin(angle);
  let best = null;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive || (a.flags & ACTOR_FLAG.WARP) || a.vx * a.vx + a.vy * a.vy > g2) continue;
    const dx = x - a.cx;
    const dy = y - a.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    const ar = Math.sqrt(a.length * a.length + a.width * a.width) * 0.5;
    if (d2 > (pr + ar) * (pr + ar)) continue;
    const depth = rectDepth(dx, dy, pc, ps, length, width, Math.cos(a.ca), Math.sin(a.ca), a.length, a.width);
    if (depth <= 0) continue;
    if (!best || depth > best.depth) {
      const closing = -((vx - a.vx) * _sat.nx + (vy - a.vy) * _sat.ny);
      _ram.actor = a;
      _ram.nx = _sat.nx;
      _ram.ny = _sat.ny;
      _ram.depth = depth;
      _ram.speed = closing > 0 ? closing : 0;
      best = _ram;
    }
  }
  return best;
}

const _soft = { actor: null, nx: 0, ny: 0, depth: 0, speed: 0 };

/**
 * Kontakt kadłuba gracza z prostokątem `bl` × `bw` w (bx, by), kurs `ba`, prędkość (bvx, bvy) — awansowany NPC,
 * którego kadłub na belkach jeszcze się nie zbudował (kontakt miękki: gra odpycha gracza bez obrażeń). Wynik jak
 * `trafficRamContact` (`actor` = null) albo null.
 */
export function trafficRectContact(x, y, angle, length, width, vx, vy, bx, by, ba, bl, bw, bvx, bvy) {
  const dx = x - bx;
  const dy = y - by;
  const r = (Math.sqrt(length * length + width * width) + Math.sqrt(bl * bl + bw * bw)) * 0.5;
  if (dx * dx + dy * dy > r * r) return null;
  const depth = rectDepth(dx, dy, Math.cos(angle), Math.sin(angle), length, width, Math.cos(ba), Math.sin(ba), bl, bw);
  if (depth <= 0) return null;
  const closing = -((vx - bvx) * _sat.nx + (vy - bvy) * _sat.ny);
  _soft.nx = _sat.nx;
  _soft.ny = _sat.ny;
  _soft.depth = depth;
  _soft.speed = closing > 0 ? closing : 0;
  return _soft;
}

/** Obrażenia taranu dla prędkości zbliżenia `speed` (0 poniżej progu). */
export function trafficRamDamage(tb, speed) {
  const t = tb.tune;
  return speed > t.ramMinSpeed ? t.ramK * speed * speed : 0;
}

/**
 * Obrażenia taranu AWARYJNEGO dla encji `a` (bez awansu): `ramK · v²`, najwyżej `ramMaxFrac` maks. punktów na
 * kontakt, kontakt liczy się najwyżej co `ramCooldown` s na encję (0 między) — encja nie ginie w pierwszej klatce,
 * przy dłuższym tarciu po kilku sekundach. Zapisuje czas kontaktu (`tb.ramAt`).
 */
export function trafficRamFallbackDamage(tb, a, speed) {
  const raw = trafficRamDamage(tb, speed);
  if (!(raw > 0) || !a) return 0;
  const t = tb.tune;
  const last = tb.ramAt.get(a.id);
  if (last !== undefined && tb.time - last < t.ramCooldown) return 0;
  if (tb.ramAt.size > 32) for (const [id, at] of tb.ramAt) if (tb.time - at >= t.ramCooldown) tb.ramAt.delete(id);
  tb.ramAt.set(a.id, tb.time);
  const cap = (a.maxHp > 0 ? a.maxHp : t.hpMin) * t.ramMaxFrac;
  return raw < cap ? raw : cap;
}

// ============================================================
// Stanowiska: ruch ↔ gracz
// ============================================================

/**
 * Stanowiska zajęte przez ruch: `berthId` → 'occupied' (przechwyt, postój,
 * odłączanie, wyjście z pola) albo 'reserved' (podejście). Pisze do `out` (Map).
 */
export function trafficBerthStates(tb, out) {
  out.clear();
  const list = tb.list;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive || !a.berthId) continue;
    const state = PHASE_AT_BERTH.has(a.phase) || (a.flags & ACTOR_FLAG.LEAVING) ? 'occupied' : 'reserved';
    if (state === 'occupied' || !out.has(a.berthId)) out.set(a.berthId, state);
  }
  return out;
}

/**
 * Indeks stanowisk portu do wyznaczania postoju gracza: układ portu ruchu
 * w układzie gry (`buildHaloPortTrafficLayout` — te same id i miejsca co
 * w workerze).
 */
export function createPortBerthIndex(layout) {
  const list = [];
  for (const berth of layout?.berths || []) {
    list.push({
      id: berth.id,
      stationId: berth.stationId || null,
      x: berth.x,
      y: berth.y,
      c: Math.cos(berth.angle),
      s: Math.sin(berth.angle),
      // pole stanowiska: dł. × szer. padu (limity hali), nie klasy ruchu
      halfL: (Number(berth.maxLength) || Number(berth.length) || 300) * 0.5,
      halfW: (Number(berth.maxBeam) || Number(berth.width) || 200) * 0.5,
      complex: berth.complex,
      hall: berth.hall,
      bayId: berth.bayId || null,
      k7BerthId: berth.k7BerthId || null
    });
  }
  return { list, byId: new Map(list.map((b) => [b.id, b])) };
}

/**
 * Stanowiska, na których stoi gracz (środek kadłuba na polu stanowiska + zapas,
 * prędkość poniżej `holdSpeed`) — do `out` (tablica id). Zwraca liczbę.
 */
export function playerBerthHolds(tb, index, x, y, speed, out) {
  out.length = 0;
  if (!index || !(speed <= tb.tune.holdSpeed)) return 0;
  const m = tb.tune.holdMargin;
  for (const b of index.list) {
    const dx = x - b.x;
    const dy = y - b.y;
    const reach = b.halfL + b.halfW + m;
    if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
    const u = dx * b.c + dy * b.s;
    const v = -dx * b.s + dy * b.c;
    if (Math.abs(u) <= b.halfL + m && Math.abs(v) <= b.halfW + m) out.push(b.id);
  }
  return out.length;
}

/**
 * Krok rejestru gracza (co `holdInterval`): stanowiska pod graczem → worker
 * (`setBerthHolds`), tylko przy zmianie zbioru.
 */
export function stepPlayerBerthHolds(tb, index, x, y, speed, dt) {
  tb.holdTimer -= dt;
  if (tb.holdTimer > 0) return false;
  tb.holdTimer = tb.tune.holdInterval;
  playerBerthHolds(tb, index, x, y, speed, tb.held);
  const key = tb.held.join('|');
  tb.stats.held = tb.held.length;
  if (key === tb.heldKey) return false;
  tb.heldKey = key;
  tb.bridge?.setBerthHolds?.(tb.held);
  return true;
}
