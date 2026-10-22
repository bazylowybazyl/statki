/**
 * BAŃKA RUCHU v2 PO STRONIE GRY (E6, docs/PLAN-ekonomia-rynki.md § 3.5).
 *
 * Lot lekkich statków liczy worker ruchu (`traffic/workerBubble.js`); gra dostaje
 * po każdym `advance` bufor póz (`ACTOR_FIELD`, `TrafficBridge.actors`) i robi
 * z nim to, co jest rozgrywką (zasada 1 — trafienia i zderzenia w 2D, w grze):
 *   - pozy w CZASIE GRY: bufor jest ważny w chwili `actors.time` (klatkę za
 *     grą), więc pozycję ekstrapolujemy prędkością do kroku fizyki i do klatki
 *     renderu;
 *   - trafienia pociskami (odcinek w ruchu względnym kontra obrys kadłuba —
 *     prostokąt `LENGTH` × `WIDTH`) i taran statku gracza;
 *   - punkty życia (w grze — świat ruchu ich nie zna); zniszczenie idzie do
 *     workera (`destroyCourse` → kurs zniszczony, wrak z ładunkiem), encja
 *     znika z obrazu od razu;
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
    unitClass: '', hullId: '', x: 0, y: 0, angle: 0, vx: 0, vy: 0, angVel: 0,
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
    seq: -1,
    frame: 0,
    /** Czas gry, w którym policzone są `cx`, `cy`, `ca` (`setTime`). */
    time: 0,
    hooks: {
      onDestroyed: typeof options.onDestroyed === 'function' ? options.onDestroyed : null
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
  for (const [id, until] of tb.dead) if (until <= gameTime) tb.dead.delete(id);
  const list = tb.list;
  list.length = 0;
  for (let k = 0; k < actors.count; k++) {
    const o = k * ACTOR_STRIDE;
    const id = data[o + F.ID];
    if (!(id >= 0) || tb.dead.has(id)) continue;
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
    a.length = data[o + F.LENGTH];
    a.width = data[o + F.WIDTH];
    a.phase = ACTOR_PHASES[data[o + F.PHASE]] || 'fly';
    a.flags = data[o + F.FLAGS];
    a.mode = (a.flags & ACTOR_FLAG.WARP) ? 'warp' : null;
    a.throttle = data[o + F.THROTTLE];
    a.dockTime = data[o + F.DOCK_TIME];
    a.speed = data[o + F.SPEED];
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
    const dt = Math.max(0, Math.min(0.5, time - a.time));
    a.cx = a.x + a.vx * dt;
    a.cy = a.y + a.vy * dt;
    a.ca = a.angle + a.angVel * dt;
  }
}

/** Poza encji w czasie gry `time` (bez zapisu) — render z `alpha`. */
export function trafficActorPoseAt(a, time, out) {
  const dt = Math.max(0, Math.min(0.5, time - a.time));
  out.x = a.x + a.vx * dt;
  out.y = a.y + a.vy * dt;
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
 * Obrażenia encji. Zwraca true, gdy encja zginęła (kurs zgłoszony workerowi:
 * `destroyCourse` — kurs zniszczony, wrak z ładunkiem w świecie ruchu).
 */
export function damageTrafficActor(tb, a, amount, x, y, cause = 'player') {
  if (!a?.alive || !(amount > 0)) return false;
  a.hp -= amount;
  a.hitAt = tb.time;
  tb.stats.hits++;
  if (a.hp > 0) return false;
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
  tb.bridge?.destroyCourse?.(a.id, { x, y, reason: cause, byPirates: false });
  tb.hooks.onDestroyed?.(a, x, y, cause);
}

const _ram = { actor: null, nx: 0, ny: 0, depth: 0, speed: 0 };

/**
 * Taran: kadłub gracza (prostokąt `length` × `width` w (x, y), kurs `angle`,
 * prędkość (vx, vy)) kontra obrysy encji — SAT dwóch prostokątów. Zwraca
 * najgłębszy kontakt `{ actor, nx, ny, depth, speed }` (normalna od encji do
 * gracza, prędkość zbliżenia ≥ 0) albo null. Bez zmian stanu.
 */
export function trafficRamContact(tb, x, y, angle, length, width, vx, vy) {
  const list = tb.list;
  if (!list.length) return null;
  const r2 = tb.tune.hitRadius * tb.tune.hitRadius;
  const pr = Math.sqrt(length * length + width * width) * 0.5;
  const pc = Math.cos(angle);
  const ps = Math.sin(angle);
  let best = null;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive) continue;
    const dx = x - a.cx;
    const dy = y - a.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    const ar = Math.sqrt(a.length * a.length + a.width * a.width) * 0.5;
    if (d2 > (pr + ar) * (pr + ar)) continue;
    const ac = Math.cos(a.ca);
    const as = Math.sin(a.ca);
    // Osie SAT: dwie osie gracza i dwie encji.
    let minDepth = Infinity;
    let nx = 0;
    let ny = 0;
    for (let k = 0; k < 4; k++) {
      const axX = k === 0 ? pc : k === 1 ? -ps : k === 2 ? ac : -as;
      const axY = k === 0 ? ps : k === 1 ? pc : k === 2 ? as : ac;
      const projP = Math.abs(pc * axX + ps * axY) * length * 0.5 + Math.abs(-ps * axX + pc * axY) * width * 0.5;
      const projA = Math.abs(ac * axX + as * axY) * a.length * 0.5 + Math.abs(-as * axX + ac * axY) * a.width * 0.5;
      const dist = dx * axX + dy * axY;
      const depth = projP + projA - Math.abs(dist);
      if (depth <= 0) { minDepth = -1; break; }
      if (depth < minDepth) {
        minDepth = depth;
        const sign = dist >= 0 ? 1 : -1;
        nx = axX * sign;
        ny = axY * sign;
      }
    }
    if (minDepth <= 0) continue;
    if (!best || minDepth > best.depth) {
      const closing = -((vx - a.vx) * nx + (vy - a.vy) * ny);
      _ram.actor = a;
      _ram.nx = nx;
      _ram.ny = ny;
      _ram.depth = minDepth;
      _ram.speed = closing > 0 ? closing : 0;
      best = _ram;
    }
  }
  return best;
}

/** Obrażenia taranu dla prędkości zbliżenia `speed` (0 poniżej progu). */
export function trafficRamDamage(tb, speed) {
  const t = tb.tune;
  return speed > t.ramMinSpeed ? t.ramK * speed * speed : 0;
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
