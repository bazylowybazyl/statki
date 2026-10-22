/**
 * KONTRAKT PRZEŁADUNKU BAŃKI (E12 ↔ E6, 2026-10-22): co obraz przeładunku w porcie (src/3d/cargo/portCargo3D.js)
 * dostaje o statku stojącym przy stanowisku. Worker ruchu dopisuje do wiadomości `actors` tablicę `cargo`
 * (Float32Array, krok ACTOR_CARGO_STRIDE) — jeden rekord na encję przy stanowisku (fazy capture / docked / undock,
 * bez zapasu floty STOCK) — przez `writeBubbleCargo`. Gra czyta ją w `syncPortCargoContract`
 * (src/game/portCargoFrame.js). Osobna tablica, żeby nie ruszać ACTOR_STRIDE (bufor aktorów, trafienia, taran).
 *
 * Rekord: numer kursu, tryb bieżącego postoju (LOAD / UNLOAD; inne postoje — REFUEL, SERVICE, HOLD — bez
 * przeładunku), czas postoju i jego część zjedzona dojściem w porcie (okno: `cargoTransferWindow`), surowiec
 * (indeks w tabeli `resources` z `ready`), wypełnienie ładowni = masa ładunku / ładowność klasy kursu, sztuki
 * (jednostki świata — podpis). To ODCZYT rekordu kursu: nic z obrazu nie wraca do świata.
 *
 * Czysty moduł (bez `self`, `postMessage`, DOM) — działa w workerze ruchu i w trybie awaryjnym.
 */

import { DWELL_REASON, STAGE_KIND, currentStage } from './courseRegistry.js';
import { VAN_CLASSES } from './shipmentOrders.js';

export const ACTOR_CARGO_STRIDE = 8;
export const ACTOR_CARGO_FIELD = Object.freeze({ ID: 0, MODE: 1, DWELL: 2, MOVE: 3, RES: 4, FILL: 5, UNITS: 6, FLAGS: 7 });
export const ACTOR_CARGO_MODE = Object.freeze({ NONE: 0, LOAD: 1, UNLOAD: 2 });

// Klasa ładowni kursu z kadłuba przewoźnika albo klasy kursu bez statku (lustro VAN_CLASS_OF_UNIT
// z materializedFlight.js — tam nieeksportowane).
const VAN_CLASS_OF_UNIT = Object.freeze({
  inter_station_shuttle: 'van', 'freighter-small': 'van',
  container_ship: 'hauler', 'freighter-medium': 'hauler',
  long_haul_freighter: 'bulk', 'freighter-large': 'bulk',
  heavy_freighter: 'heavy', 'freighter-capital': 'heavy',
  megafreighter: 'mega'
});
const CAPACITY = new Map(VAN_CLASSES.map((c) => [c.id, c.capacity]));

/** Ładowność klasy kursu [t] (0 — nieznana: kurs bez ładowni, np. okręt). */
export function courseCargoCapacity(course) {
  const cls = course?.payload?.vanClassId || VAN_CLASS_OF_UNIT[course?.unitClass] || null;
  return cls ? CAPACITY.get(cls) || 0 : 0;
}

/**
 * Rekord kursu → `out` od rekordu `k` (Float32Array albo zwykła tablica). courseNumber — numer kursu (= `ACTOR_FIELD.ID`),
 * resourceIndex(id) → indeks w tabeli `resources` (−1, gdy brak). Zwraca 1, gdy zapisał, 0 — gdy kurs nie stoi
 * na postoju z ładunkiem (wtedy nie ma czego przeładowywać).
 */
export function writeBubbleCargo(out, k, courseNumber, course, resourceIndex) {
  const stage = currentStage(course);
  if (!stage || stage.kind !== STAGE_KIND.DWELL) return 0;
  const mode = stage.reason === DWELL_REASON.LOAD ? ACTOR_CARGO_MODE.LOAD
    : stage.reason === DWELL_REASON.UNLOAD ? ACTOR_CARGO_MODE.UNLOAD : ACTOR_CARGO_MODE.NONE;
  const p = course.payload || {};
  if (!mode || p.deadhead || !(Number(p.mass) > 0)) return 0;
  const cap = courseCargoCapacity(course);
  const F = ACTOR_CARGO_FIELD;
  const o = k * ACTOR_CARGO_STRIDE;
  out[o + F.ID] = courseNumber;
  out[o + F.MODE] = mode;
  out[o + F.DWELL] = Number(stage.seconds) || 0;
  out[o + F.MOVE] = Number(stage.moveSeconds) || 0;
  out[o + F.RES] = p.resourceId != null ? resourceIndex(p.resourceId) : -1;
  out[o + F.FILL] = cap > 0 ? Math.max(0, Math.min(1, Number(p.mass) / cap)) : 1;
  out[o + F.UNITS] = Number(p.units) || 0;
  out[o + F.FLAGS] = 0;
  return 1;
}
