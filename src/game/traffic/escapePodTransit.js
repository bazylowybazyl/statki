/**
 * KAPSUŁY RATUNKOWE BEZ OBRAZU w świecie ruchu (E22, reguła `kapsuly-ratunkowe`, krok K3).
 *
 * Statek zniszczony POZA bańką gracza (przechwyt piratów, zniszczona stacja — rekord w `director.wrecks`) ma te same
 * kapsuły co w grze, tylko bez obrazu: po wyrzucie lecą do najbliższej stacji swojej frakcji (bez takiej —
 * najbliższej niepirackiej; ta sama funkcja co w grze, `pickEscapePodStation`), dolot po czasie z odległości
 * (`POD_TUNE.cruise`, zapas na objazdy `routeFactor`). Wraki od gracza (`reason: 'player'`) pomija — tam kapsuły
 * lecą w obrazie gry i dolot zgłasza gra. Statki pirackie (frakcja `pirates`) kapsuł nie mają.
 *
 * Dziś dolot tylko liczy (statystyki) — symulacja jest identyczna z kapsułami i bez nich. Ludzie z promów (K4, po W6)
 * wracają do magazynu stacji dolotu w chwili dolotu (`onArrive`).
 *
 * Czysty moduł (bez DOM, three i `self`); bez losowania (determinizm świata nietknięty).
 */

import { POD_TUNE } from '../escapePods.js';
import { pickEscapePodStation } from '../escapePodRoutes.js';

export const POD_TRANSIT_TUNE = Object.freeze({
  // Zapas na objazdy (ring, doki) względem prostej do stacji.
  routeFactor: 1.15,
  // Od zniszczenia do lotu: opóźnienie wyrzutu + dryf (jak w grze).
  launch: (POD_TUNE.delayMin + POD_TUNE.delayMax) * 0.5 + POD_TUNE.coast,
  cruise: POD_TUNE.cruise,
  // Powody wraków z kapsułami w obrazie gry (dolot zgłasza gra).
  gameReasons: Object.freeze(['player'])
});

export function createPodTransit() {
  return {
    scanned: 0,
    // { courseId, stationId, eta, people, kind } — kolejność wstawiania, rozliczane po `eta`.
    pending: [],
    stats: { ships: 0, arrived: 0, arrivedPeople: 0, game: 0, pirates: 0, noStation: 0, noSpot: 0 }
  };
}

/**
 * Nowe wraki (od ostatniego przeglądu) → kapsuły w drodze. `wrecks` — `director.wrecks` (tylko dopisywane),
 * `stations` — stacje świata (`{ id, x, y, factionId, destroyed }`), `now` — zegar rejestru kursów. `describe(wreck)` —
 * opcjonalnie ładunek kapsuł `{ people, kind }` (K4: pasażerowie promu). Zwraca liczbę statków z kapsułami.
 */
export function scanWrecksForPods(transit, wrecks, stations, now, describe = null, tune = POD_TRANSIT_TUNE) {
  if (!Array.isArray(wrecks)) return 0;
  if (transit.scanned > wrecks.length) transit.scanned = wrecks.length;
  let added = 0;
  for (let i = transit.scanned; i < wrecks.length; i++) {
    const w = wrecks[i];
    if (!w) continue;
    if (tune.gameReasons.includes(w.reason)) { transit.stats.game++; continue; }
    if (w.factionId === 'pirates') { transit.stats.pirates++; continue; }
    if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) { transit.stats.noSpot++; continue; }
    const k = pickEscapePodStation(stations, w.x, w.y, w.factionId || null);
    if (k < 0) { transit.stats.noStation++; continue; }
    const st = stations[k];
    const d = Math.hypot(st.x - w.x, st.y - w.y);
    const load = typeof describe === 'function' ? describe(w) : null;
    transit.pending.push({
      courseId: w.courseId ?? null,
      stationId: String(st.id),
      eta: now + tune.launch + d * tune.routeFactor / tune.cruise,
      people: Math.max(0, Number(load?.people) || 0),
      kind: load?.kind || 'crew'
    });
    transit.stats.ships++;
    added++;
  }
  transit.scanned = wrecks.length;
  return added;
}

/** Dolot kapsuł z `eta` ≤ `now`: `onArrive(entry)` (K4 — ludzie do magazynu stacji). Zwraca liczbę dolotów. */
export function settlePodTransit(transit, now, onArrive = null) {
  const list = transit.pending;
  let n = 0;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.eta > now) { list[w++] = e; continue; }
    n++;
    transit.stats.arrived++;
    transit.stats.arrivedPeople += e.people;
    if (typeof onArrive === 'function') onArrive(e);
  }
  list.length = w;
  return n;
}
