/**
 * AWANS STATKU RUCHU DO PEŁNEGO NPC (E6, docs/E6-banka-w-grze.md § „Awans do pełnego NPC”).
 *
 * Encja bańki (lekki statek z workera ruchu) to obraz i prosty obrys. Gdy gracz wchodzi z nią w walkę
 * (trafienie) albo leci na nią kadłubem (taran — PRZED kontaktem, z czasu do zderzenia), staje się pełnym NPC
 * gry: kadłub na belkach ze sprite'a (cięcie, zgniot, kratery, rozpad, wrak), lot i rozkazy jak inne NPC. Także
 * encje bez kursu — zapas floty (STOCK), postój (PARKED), odlot po końcu kursu (DEPARTED): nietykalnych nie ma.
 * Ten moduł trzyma tylko DECYZJE (czysty, bez DOM i gry):
 *   - kolejka awansów — najwyżej `maxPerFrame` na klatkę (budowa kadłuba kosztuje), najwyżej `maxAlive` NPC
 *     z ruchu naraz (reszta zostaje encjami i ginie na obrysie); taran wchodzi na początek kolejki i ma własny
 *     zapas `ramReserve` ponad limitem — statek, na który gracz wlatuje, nie czeka za ostrzelanymi;
 *   - czas do kontaktu kadłuba gracza z obrysem encji (`trafficContactTime`) — próg `ramLead` (budowa kadłuba
 *     z zapasem);
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
  maxSpeed: 2500,
  /**
   * Taran: awans, gdy kontakt kadłuba gracza z obrysem encji za mniej niż tyle [s]. Kolejka (1 awans na klatkę)
   * + budowa kadłuba na belkach ze sprite'a w `drawNPCPretty` (sprite wczytany zawczasu, budżet budowy kadłubów
   * na klatkę) to kilka klatek — 0,75 s to kilkanaście klatek zapasu także przy 60 Hz.
   */
  ramLead: 0.75,
  /** Zapas limitu `maxAlive` tylko dla taranu. */
  ramReserve: 4,
  /** Zapas obrysu w teście kontaktu [j.] (obrysy gracza i encji — prostokąty). */
  ramPad: 60,
  /**
   * Awans „na taran”, do którego zderzenie nie doszło (gracz minął statek albo skręcił — w ciasnym porcie częste):
   * po tylu s, bez ubytku punktów i bez trafienia gracza, dalej niż `ramReleaseRadius` od gracza — NPC wraca do
   * bańki, nie trzyma miejsca w limicie przez pełne `calmSeconds`.
   */
  ramCalmSeconds: 4,
  ramReleaseRadius: 5000
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

/**
 * Czy encję bańki gry (`trafficBubble.js`) wolno awansować: kurs, zapas floty, postój, odlot — bez warpa
 * i hipercruise (> `maxSpeed`), kadłub z pełnym NPC.
 */
export function trafficActorPromotable(a, tune = TRAFFIC_PROMOTION_TUNE) {
  if (!a?.alive || !Number.isFinite(a.id)) return false;
  if (a.flags & ACTOR_FLAG.WARP) return false;
  if (a.vx * a.vx + a.vy * a.vy > tune.maxSpeed * tune.maxSpeed) return false;
  return !TRAFFIC_PROMOTION_SKIP_HULLS.has(a.hullId);
}

/**
 * Czy encja niesie kurs (numer ≥ 0, bez DEPARTED): awans przez `attach` / `detach`, strata przez `destroyed`.
 * Inaczej (STOCK, PARKED — id ujemny; DEPARTED — kurs zamknięty) — `entity-hold` / `entity-lost`.
 */
export function trafficActorHasCourse(a) {
  return !!a && a.id >= 0 && !(a.flags & ACTOR_FLAG.DEPARTED);
}

/** Rozkaz świeżego NPC: 'hold' (stoi przy stanowisku albo w kolejce) albo 'flee' (ucieka od napastnika). */
export function trafficPromotionOrder(phase) {
  return PHASES_HOLD.has(phase) ? 'hold' : 'flee';
}

export function createTrafficPromotion(tune = {}) {
  return {
    tune: { ...TRAFFIC_PROMOTION_TUNE, ...tune },
    /** Numery encji czekające na awans (taran na początku, potem kolejność trafień). */
    queue: [],
    queued: new Set(),
    /** Taran w kolejce (pierwszeństwo, zapas limitu). */
    rams: new Set(),
    /** numer kursu → NPC gry. */
    alive: new Map(),
    stats: { requested: 0, promoted: 0, demoted: 0, destroyed: 0, refused: 0, rams: 0 }
  };
}

/**
 * Prośba o awans encji `id` (trafienie; `ram` — taran: na początek kolejki, limit `maxAlive + ramReserve`;
 * encja już w kolejce po trafieniu przechodzi na początek). Zwraca true, gdy weszła do kolejki albo przeszła
 * na jej początek.
 */
export function requestTrafficPromotion(st, id, ram = false) {
  if (!st || !Number.isFinite(id) || st.alive.has(id)) return false;
  if (st.queued.has(id)) {
    if (!ram || st.rams.has(id)) return false;
    st.queue.splice(st.queue.indexOf(id), 1);
    st.queue.splice(st.rams.size, 0, id);
    st.rams.add(id);
    st.stats.rams++;
    return true;
  }
  const cap = st.tune.maxAlive + (ram ? st.tune.ramReserve : 0);
  if (st.alive.size + st.queue.length >= cap) {
    st.stats.refused++;
    return false;
  }
  if (ram) {
    // Za wcześniejszymi taranami, przed trafieniami.
    st.queue.splice(st.rams.size, 0, id);
    st.rams.add(id);
    st.stats.rams++;
  } else st.queue.push(id);
  st.queued.add(id);
  st.stats.requested++;
  return true;
}

/** Następny awans w tej klatce albo null (najwyżej `maxPerFrame` — licznik klatki trzyma wołający). */
export function takeTrafficPromotion(st) {
  if (!st?.queue.length) return null;
  const id = st.queue.shift();
  st.queued.delete(id);
  st.rams.delete(id);
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
  const dx = (Number(npc.x) || 0) - px;
  const dy = (Number(npc.y) || 0) - py;
  const d2 = dx * dx + dy * dy;
  const promotedAt = Number(npc.__trafficPromotedAt) || -Infinity;
  // Awans na taran bez zderzenia: nietknięty (punkty, trafienie gracza), gracz odleciał — wraca szybko.
  if (npc.__trafficRamOnly && !(Number(npc._lastPlayerHit) > promotedAt)
    && !(Number(npc.hp) < Number(npc.__trafficHp0)) && now - promotedAt >= t.ramCalmSeconds
    && d2 > t.ramReleaseRadius * t.ramReleaseRadius) return 'demote';
  const lastHit = Math.max(Number(npc._lastPlayerHit) || -Infinity, promotedAt);
  if (!(now - lastHit >= t.calmSeconds)) return 'keep';
  return d2 > t.releaseRadius * t.releaseRadius ? 'demote' : 'keep';
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
