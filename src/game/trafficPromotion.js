/**
 * AWANS STATKU RUCHU DO PEŁNEGO NPC (E6, docs/E6-banka-w-grze.md § „Awans do pełnego NPC”).
 *
 * Encja bańki (lekki statek z workera ruchu) to obraz i prosty obrys. Gdy gracz wchodzi z nią w walkę
 * (trafienie, taran), staje się pełnym NPC gry: kadłub na belkach ze sprite'a (kratery, rozpad, wrak), lot
 * i rozkazy jak inne NPC. Ten moduł trzyma tylko DECYZJE (czysty, bez DOM i gry):
 *   - kolejka awansów — najwyżej `maxPerFrame` na klatkę (budowa kadłuba kosztuje), najwyżej `maxAlive` NPC
 *     z ruchu naraz (reszta zostaje encjami i ginie na obrysie);
 *   - werdykt dla awansowanego NPC: żyje, zginął (kurs → `destroyed` do workera), albo wraca do bańki —
 *     po `calmSeconds` bez trafienia gracza i dalej niż `releaseRadius` (zasięg życia NPC gry,
 *     `NPC_DESPAWN_RADIUS`) — `detach` z pozą, bańka materializuje kurs tam, gdzie był NPC;
 *   - punkt ucieczki cywila (od napastnika).
 * Klej (tworzenie NPC, `attach` / `detach`, usuwanie) — blok „BAŃKA RUCHU v2 W GRZE” w index.html.
 */

import { ACTOR_FLAG } from './traffic/trafficProtocol.js';

export const TRAFFIC_PROMOTION_TUNE = {
  /** Awansów na klatkę — budowa kadłuba na belkach ze sprite'a to kilka ms. */
  maxPerFrame: 1,
  /** NPC z ruchu naraz; kolejne encje w walce zostają na obrysie bańki. */
  maxAlive: 8,
  /** Tyle s bez trafienia gracza — koniec walki. */
  calmSeconds: 20,
  /** Dalej od gracza — NPC może wrócić do bańki (zasięg życia NPC gry). */
  releaseRadius: 20000,
  /** Cywil ucieka tak daleko od napastnika [j.]. */
  fleeDistance: 18000,
  /** Szybciej [j./s] (hipercruise) — encja nie awansuje: ucieka, trafienia zostają na obrysie bańki. */
  maxSpeed: 2500
};

/**
 * Kadłuby bez pełnego NPC: megafrachtowiec to w grze pociąg modułów (`megafreighterTrain.js`), a proxy rysuje cały
 * skład jednym sprite'em; holownik serwisowy (8300 j.) nie jest klasą ruchu. Giną na obrysie bańki.
 */
export const TRAFFIC_PROMOTION_SKIP_HULLS = new Set(['megafreighter', 'service_tug']);

/** Faz przy stanowisku (i postoju w miejscu) — NPC stoi, a nie ucieka. */
const PHASES_HOLD = new Set(['capture', 'docked', 'undock', 'hold', 'station']);

/** Czy encję bańki gry (`trafficBubble.js`) wolno awansować: kurs (nie zapas floty), bez warpa i hipercruise. */
export function trafficActorPromotable(a, tune = TRAFFIC_PROMOTION_TUNE) {
  if (!a?.alive || !(a.id >= 0)) return false;
  if (a.flags & (ACTOR_FLAG.STOCK | ACTOR_FLAG.WARP | ACTOR_FLAG.DEPARTED)) return false;
  if (a.vx * a.vx + a.vy * a.vy > tune.maxSpeed * tune.maxSpeed) return false;
  return !TRAFFIC_PROMOTION_SKIP_HULLS.has(a.hullId);
}

/** Rozkaz świeżego NPC: 'hold' (stoi przy stanowisku albo w kolejce) albo 'flee' (ucieka od napastnika). */
export function trafficPromotionOrder(phase) {
  return PHASES_HOLD.has(phase) ? 'hold' : 'flee';
}

export function createTrafficPromotion(tune = {}) {
  return {
    tune: { ...TRAFFIC_PROMOTION_TUNE, ...tune },
    /** Numery kursów czekające na awans (kolejność trafień). */
    queue: [],
    queued: new Set(),
    /** numer kursu → NPC gry. */
    alive: new Map(),
    stats: { requested: 0, promoted: 0, demoted: 0, destroyed: 0, refused: 0 }
  };
}

/** Prośba o awans encji `id` (trafienie, taran). Zwraca true, gdy weszła do kolejki. */
export function requestTrafficPromotion(st, id) {
  if (!st || !Number.isFinite(id) || st.alive.has(id) || st.queued.has(id)) return false;
  if (st.alive.size + st.queue.length >= st.tune.maxAlive) {
    st.stats.refused++;
    return false;
  }
  st.queue.push(id);
  st.queued.add(id);
  st.stats.requested++;
  return true;
}

/** Następny awans w tej klatce albo null (najwyżej `maxPerFrame` — licznik klatki trzyma wołający). */
export function takeTrafficPromotion(st) {
  if (!st?.queue.length) return null;
  const id = st.queue.shift();
  st.queued.delete(id);
  return id;
}

/**
 * Los awansowanego NPC w tej klatce: 'dead' (zginął albo zniknął — kurs do workera jako zniszczony),
 * 'demote' (koniec walki i poza zasięgiem — wraca do bańki), 'keep'.
 */
export function trafficPromotionVerdict(st, npc, now, px, py) {
  if (!npc || npc.dead || npc.isWreck || npc.removed || npc.destroyed) return 'dead';
  const t = st.tune;
  const lastHit = Math.max(Number(npc._lastPlayerHit) || -Infinity, Number(npc.__trafficPromotedAt) || -Infinity);
  if (!(now - lastHit >= t.calmSeconds)) return 'keep';
  const dx = (Number(npc.x) || 0) - px;
  const dy = (Number(npc.y) || 0) - py;
  return dx * dx + dy * dy > t.releaseRadius * t.releaseRadius ? 'demote' : 'keep';
}

/** Punkt ucieczki od napastnika (fx, fy): wzdłuż linii napastnik → statek, `distance` dalej. */
export function trafficFleePoint(npc, fx, fy, distance, out = {}) {
  let dx = (Number(npc.x) || 0) - fx;
  let dy = (Number(npc.y) || 0) - fy;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (!(d > 1e-6)) {
    // Napastnik w środku — uciekaj dziobem.
    dx = Math.cos(Number(npc.angle) || 0);
    dy = Math.sin(Number(npc.angle) || 0);
    d = 1;
  }
  out.x = (Number(npc.x) || 0) + dx / d * distance;
  out.y = (Number(npc.y) || 0) + dy / d * distance;
  return out;
}
