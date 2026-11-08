/**
 * KAPSUŁY RATUNKOWE BEZ OBRAZU w świecie ruchu (E22, reguła `kapsuly-ratunkowe`, kroki K3 i K4).
 *
 * Statek zniszczony POZA bańką gracza (przechwyt piratów, zniszczona stacja — rekord w `director.wrecks`) ma te same
 * kapsuły co w grze, tylko bez obrazu: po wyrzucie lecą do najbliższej stacji swojej frakcji (bez takiej —
 * najbliższej niepirackiej; ta sama funkcja co w grze, `pickEscapePodStation`), dolot po czasie z odległości
 * (`POD_TUNE.cruise`, zapas na objazdy `routeFactor`). Wraki od gracza (`reason: 'player'`) pomija — tam kapsuły
 * lecą w obrazie gry i dolot zgłasza gra. Statki pirackie (frakcja `pirates`) kapsuł nie mają.
 *
 * PROMY (K4, zastępuje natychmiastowy powrót z W6): prom z ludźmi zniszczony poza porwaniem → `holdFerryPassengers`
 * (w `destroyCourse`) — ludzie z kontraktu czekają w `director.podPassengers` na dolot kapsuł. Kapsuły promu lecą do
 * portu nadania (`describeWreckPods` — bez obrazu; w grze cel podaje świat wiadomością `pods-target`), a ludzie
 * wchodzą do magazynu STACJI DOLOTU w chwili dolotu (`landFerryPassengers` — z kroku świata albo z wiadomości gry
 * `pods-landed`). Porwanie (przechwyt piratów) bez zmian — zakładnicy (W4). Bez promów symulacja jest identyczna
 * z kapsułami i bez nich (dolot innych statków tylko liczy).
 *
 * Czysty moduł (bez DOM, three i `self`); bez losowania (determinizm świata nietknięty).
 */

import { POD_TUNE } from '../escapePods.js';
import { pickEscapePodStation } from '../escapePodRoutes.js';
import { putStock } from './marketStock.js';

export const POD_TRANSIT_TUNE = Object.freeze({
  // Zapas na objazdy (ring, doki) względem prostej do stacji.
  routeFactor: 1.15,
  // Od zniszczenia do lotu: opóźnienie wyrzutu + dryf (jak w grze).
  launch: (POD_TUNE.delayMin + POD_TUNE.delayMax) * 0.5 + POD_TUNE.coast,
  cruise: POD_TUNE.cruise,
  // Powody wraków z kapsułami w obrazie gry (dolot zgłasza gra).
  gameReasons: Object.freeze(['player']),
  // Ludzie promu czekający na dolot kapsuł, o których nikt nie zgłosił dolotu (gra przeładowana, kapsuły bez celu),
  // przepadają po tym czasie [s świata].
  passengerHold: 2 * 3600
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
    const load = typeof describe === 'function' ? describe(w) : null;
    // Cel: stacja z opisu (prom — port nadania), gdy zdatna; inaczej najbliższa stacja frakcji.
    const k = pickEscapePodStation(stations, w.x, w.y, w.factionId || null, load?.stationId ?? null);
    if (k < 0) { transit.stats.noStation++; continue; }
    const st = stations[k];
    const d = Math.hypot(st.x - w.x, st.y - w.y);
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

// ============================================================
// Promy z ludźmi (K4)
// ============================================================

/**
 * Prom z ludźmi z kontraktu zniszczony poza porwaniem (`destroyCourse`): ludzie czekają na dolot kapsuł zamiast wracać
 * od razu (W6). Zwraca liczbę ludzi w kapsułach (0 — kurs bez ludzi z kontraktu: powrót po kontrakcie nie zmienia
 * magazynu, rotacja już zeszła).
 */
export function holdFerryPassengers(director, course) {
  const p = course?.payload;
  if (!director || !p?.passengers || !p.orderId || !(p.units > 0)) return 0;
  const map = director.podPassengers || (director.podPassengers = new Map());
  map.set(String(course.id), {
    units: p.units, left: p.units, originId: String(course.originId), since: Number(director.registry?.clock) || 0
  });
  return p.units;
}

/** Ludzie promu `courseId` w kapsułach: `{ units, left, originId, since }` albo null. */
export function ferryPodPassengers(director, courseId) {
  return director?.podPassengers?.get(String(courseId)) || null;
}

/**
 * Dolot kapsuły z ludźmi promu `courseId` do stacji `stationId`: najwyżej tylu, ilu zostało z kursu, do magazynu
 * stacji dolotu (do pojemności — `putStock`; nadmiar przepada jak w W6). Zwraca, ilu weszło do magazynu.
 */
export function landFerryPassengers(director, courseId, stationId, people) {
  const rec = ferryPodPassengers(director, courseId);
  if (!rec) return 0;
  const n = Math.min(rec.left, Math.max(0, Math.floor(Number(people) || 0)));
  rec.left -= n;
  if (rec.left <= 0) director.podPassengers.delete(String(courseId));
  if (!(n > 0)) return 0;
  const back = putStock(director.getEconomy?.(String(stationId)), 'workforce', n);
  if (director.stats) director.stats.passengersRescued = (director.stats.passengersRescued || 0) + back;
  return back;
}

/** Opis kapsuł wraku dla przeglądu bez obrazu: prom z ludźmi → port nadania i ludzie; inny statek → null. */
export function describeWreckPods(director, wreck) {
  const rec = wreck ? ferryPodPassengers(director, wreck.courseId) : null;
  return rec ? { people: rec.left, kind: 'ferry', stationId: rec.originId } : null;
}

/** Ludzie promu bez zgłoszonego dolotu dłużej niż `passengerHold` — przepadają (pamięć nie rośnie bez końca). */
export function purgeFerryPassengers(director, now, tune = POD_TRANSIT_TUNE) {
  const map = director?.podPassengers;
  if (!map || !map.size) return 0;
  let n = 0;
  for (const [id, rec] of map) {
    if (now - rec.since <= tune.passengerHold) continue;
    map.delete(id);
    n++;
  }
  return n;
}
