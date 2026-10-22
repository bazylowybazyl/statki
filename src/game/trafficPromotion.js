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
 *   - punkt ucieczki cywila (od napastnika);
 *   - okręty (E13): kadłub wojenny (garnizon K-7, łowca, policja, rajder, przemytnik) dostaje broń i mózg swojej
 *     klasy (`TRAFFIC_COMBAT_HULLS` → szablon wezwania w index.html) i odpowiada graczowi ogniem — wrogość „za
 *     zaczepkę” (`playerGrudge`) wobec samego gracza, cel tylko gdy gracz widoczny (maskowanie) i blisko.
 * Klej (tworzenie NPC, broń, `attach` / `detach`, usuwanie) — blok „BAŃKA RUCHU v2 W GRZE” w index.html.
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

/**
 * Okręty ruchu, które po awansie WALCZĄ (E13): `type` — typ NPC (mózg runCallInCombatAI, spec broni ramy
 * resolveNpcSpecFrameId, czujniki), `template` — szablon wezwania z liczbami klasy (SUPPORT_SHIP_TEMPLATES, przy
 * `capital` — CAPITAL_SHIP_TEMPLATES: punkty życia, tarcza, masa). Broń z gniazd edytora kadłuba (equipNpcWeapons).
 * Reszta kadłubów ruchu to cywile: uciekają albo stoją.
 */
export const TRAFFIC_COMBAT_HULLS = Object.freeze({
  terran_frigate: Object.freeze({ type: 'frigate', template: 'frigate_pd' }),
  terran_destroyer: Object.freeze({ type: 'destroyer', template: 'destroyer' }),
  terran_battleship: Object.freeze({ type: 'battleship', template: 'battleship' }),
  terran_carrier: Object.freeze({ type: 'carrier', template: 'carrier', capital: true }),
  pirate_frigate: Object.freeze({ type: 'frigate', template: 'frigate_pd' }),
  pirate_destroyer: Object.freeze({ type: 'destroyer', template: 'destroyer' }),
  pirate_battleship: Object.freeze({ type: 'battleship', template: 'pirate_battleship' }),
  pirate_raider: Object.freeze({ type: 'frigate', template: 'frigate_pd' }),
  smuggler: Object.freeze({ type: 'frigate', template: 'frigate_pd' }),
  bounty_hunter: Object.freeze({ type: 'frigate', template: 'frigate_pd' }),
  police_cutter: Object.freeze({ type: 'frigate', template: 'frigate_pd' })
});

/** Rola bojowa kadłuba ruchu albo null (cywil). */
export function trafficCombatRole(hullId) {
  return TRAFFIC_COMBAT_HULLS[hullId] || null;
}

/** Zestaw broni NPC (equipNpcWeapons: 'pirate' | 'terran') z frakcji encji bańki. */
export function trafficWeaponFaction(factionId, isPirate = false) {
  return (isPirate || factionId === 'pirates') ? 'pirate' : 'terran';
}

/**
 * Cel okrętu z urazą do gracza (`playerGrudge`): gracz, gdy żyje, nie jest ukryty maskowaniem (`hidden(player)` —
 * isCloakHidden) i jest bliżej niż `range` (zasięg życia NPC z ruchu). Inaczej null — mózg klasy stoi / wraca.
 */
export function trafficGrudgeTarget(npc, player, hidden, range = TRAFFIC_PROMOTION_TUNE.releaseRadius) {
  if (!npc || !player || player.dead || player.destroyed) return null;
  if (hidden && hidden(player)) return null;
  const dx = (Number(player.pos?.x ?? player.x) || 0) - (Number(npc.x) || 0);
  const dy = (Number(player.pos?.y ?? player.y) || 0) - (Number(npc.y) || 0);
  return dx * dx + dy * dy <= range * range ? player : null;
}

/** Faz przy stanowisku (i postoju w miejscu) — NPC stoi, a nie ucieka. */
const PHASES_HOLD = new Set(['capture', 'docked', 'undock', 'hold', 'station']);

/** Czy encję bańki gry (`trafficBubble.js`) wolno awansować: kurs (nie zapas floty), bez warpa i hipercruise. */
export function trafficActorPromotable(a, tune = TRAFFIC_PROMOTION_TUNE) {
  if (!a?.alive || !(a.id >= 0)) return false;
  if (a.flags & (ACTOR_FLAG.STOCK | ACTOR_FLAG.WARP)) return false;
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
  // Hulk mostka (utrata dowodzenia) dryfuje do wraku — nie wraca do bańki jako cały statek.
  if (npc.isBridgeHulk || npc.bridgeState?.commandLost) return 'keep';
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
