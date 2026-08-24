/**
 * DYSPOZYTOR PORTU — kontrola ruchu przy stacji.
 *
 * Odpowiednik kontroli ruchu lotniczego, i tak samo jak ona **niczym nie
 * steruje**. Odpowiada wyłącznie na dwa pytania zadawane per statek:
 *
 *   DOKĄD    — punkt, do którego masz lecieć: miejsce na orbicie oczekiwania
 *              albo punkt podejścia do przydzielonego stanowiska
 *   KIEDY    — czy wolno ci już ruszyć do następnego punktu
 *
 * Model ciągu, bezwładność i hamowanie zostają nietknięte. Sterowanie fizyczne
 * — `materializedFlight.steer` w bańce, pełny pipeline lotu w grze — dostaje
 * punkt i leci; nie obchodzi go, czy ten punkt wziął się z kolejki, czy z prostej
 * trasy. Dlatego ten moduł da się wpiąć pod oba, nie ruszając żadnego z nich.
 *
 * CO BYŁO ZŁE. Do 2026-08-24 ostatni etap trasy celował w ŚRODEK PLANETY, a po
 * dolocie `syncBerths` podmieniało pozycję postoju na stanowisko albo na redę.
 * Skutek widoczny na mapie: wszystko zlatywało się do jednego punktu, było
 * odbijane na pierścień wokół planety i teleportowało do doku, gdy ten się
 * zwolnił.
 *
 * KOLEJKA MUSI ISTNIEĆ W REKORDACH, nie w bańce. Zatłoczony port ma dziesiątki
 * czekających, a większość z nich jest poza promieniem materializacji — gdyby
 * ustawienie liczyła bańka, podlot gracza przestawiałby statki na jego oczach.
 * Dlatego miejsca przydziela się tutaj, na rekordach, a bańka tylko pokazuje
 * to, co już zostało ustalone.
 */

import { findBerth, reserveBerth, releaseBerth } from './dockLayout.js';
import { STAGE_KIND, DWELL_REASON } from './courseRegistry.js';

export const PORT_CONTROL_DEFAULTS = Object.freeze({
  /**
   * Ile opóźnienia statek pochłania ZWALNIAJĄC W DRODZE, zanim dotrze do portu.
   *
   * To jest decyzja projektowa, nie optymalizacja — patrz SPEC-kolejkowanie:
   *   1,0 — port chodzi jak zegarek, kolejki nie widać wcale
   *   0,0 — wszyscy przylatują na pełnej i piętrzą się fizycznie
   *   0,6 — większość pochłonięta daleko, przy porcie zostaje widoczna,
   *         powolna kolejka: i ładna, i będąca celem dla piratów
   */
  absorbFraction: 0.6,
  /** Jak długo przed dolotem przydzielamy stanowisko. Krótko — patrz niżej. */
  assignHorizonSeconds: 240,
  /** Ile statków mieści jeden pierścień oczekiwania, zanim otworzy się kolejny. */
  slotsPerRing: 8,
  /** Odstęp między sąsiednimi miejscami w kolejce, w jednostkach świata. */
  slotSpacing: 9_000,
  /** Odstęp między pierścieniami oczekiwania. */
  ringSpacing: 14_000,
  /** Promień pierwszego pierścienia jako ułamek promienia parkingu. */
  innerRingRatio: 1.12,
  /** Ile trwa przejście z orbity oczekiwania na stanowisko. */
  approachSeconds: 45
});

/**
 * Rezerwacja z daleka marnuje przepustowość — to zmierzona pułapka z prototypu
 * pasowego: stanowisko zajęte 14 tys. j. przed dokiem stało puste przez cały
 * dolot i przepustowość spadała kilkukrotnie. Stąd krótki horyzont zgłoszenia
 * i przydział dopiero na podejściu.
 */

export function createPortControl(options = {}) {
  return {
    config: { ...PORT_CONTROL_DEFAULTS, ...options },
    /** `stationId` → stan portu. */
    ports: new Map(),
    /** `courseId` → `stationId`, żeby zwolnienie nie przemiatało wszystkich portów. */
    byCourse: new Map(),
    stats: { assigned: 0, queued: 0, granted: 0, absorbed: 0, absorbedSeconds: 0 }
  };
}

/**
 * Rejestruje port. `node` daje pozycję i kąt odniesienia, `layout` — stanowiska
 * i promień parkingu, z którego wyprowadza się orbity oczekiwania.
 */
export function registerPort(control, stationId, layout, node) {
  if (!control || !layout || !node) return null;
  const port = {
    stationId: String(stationId),
    layout,
    node,
    /** Kąt, wokół którego rozpina się łuk oczekiwania. Stały, żeby kolejka
     *  nie wędrowała po orbicie między klatkami. */
    baseAngle: Number(node.angle) || 0,
    /** `courseId` → { berth, berthId, slot, heldSince } */
    assigned: new Map(),
    /** Zajęte numery miejsc w kolejce. */
    slots: new Set(),
    /** Ilu czeka. Licznik, nie przeliczanie — `grantWaiting` chodzi co tick
     *  po wszystkich portach, a budowanie i sortowanie pustej listy dla
     *  trzydziestu czterech stacji kosztowało więcej niż cała reszta warstwy. */
    waiting: 0
  };
  control.ports.set(port.stationId, port);
  return port;
}

export function getPort(control, stationId) {
  return control?.ports?.get(String(stationId)) || null;
}

// ============================================================
// Geometria oczekiwania
// ============================================================

/**
 * Gdzie fizycznie stoi statek o danym numerze w kolejce.
 *
 * Kolejka układa się w ŁUK, nie w rząd: rząd w próżni wygląda sztucznie, a łuk
 * czyta się od razu jako orbita oczekiwania. Numer 0 stoi najbliżej doków —
 * czyli na czele — a kolejne odchodzą wzdłuż łuku. Po zapełnieniu pierścienia
 * otwiera się następny, dalej od stacji.
 */
export function holdingSlotPosition(control, port, slotIndex) {
  if (!port) return null;
  const config = control?.config || PORT_CONTROL_DEFAULTS;
  const index = Math.max(0, Math.floor(Number(slotIndex) || 0));
  const bazowy = (port.layout.parkingRadius || 40_000) * config.innerRingRatio;

  // Ile miejsc NAPRAWDĘ mieści pierścień. Stała liczba nie działa, bo port
  // księżyca ma parking o promieniu 5,8 tys. j., czyli obwód 40 tys. — osiem
  // miejsc po 9 tys. j. zawijało się wokół całej stacji i czekający nachodzili
  // na siebie (zmierzone: najbliższa para 3962 j. przy wymaganych 9000).
  const naRingu = (promien) => Math.max(3,
    Math.min(config.slotsPerRing, Math.floor((2 * Math.PI * promien * 0.55) / config.slotSpacing)));

  let ring = 0;
  let zostalo = index;
  let promien = bazowy;
  let pojemnosc = naRingu(promien);
  while (zostalo >= pojemnosc) {
    zostalo -= pojemnosc;
    ring++;
    promien = bazowy + ring * config.ringSpacing;
    pojemnosc = naRingu(promien);
  }

  // Odstęp kątowy wynika z odstępu LINIOWEGO — dalszy pierścień jest dłuższy,
  // więc mieści więcej statków przy tym samym rozstawie w metrach.
  const krok = config.slotSpacing / Math.max(1, promien);
  const kat = port.baseAngle + (zostalo - (pojemnosc - 1) / 2) * krok
    + ring * krok * 0.5;

  return {
    x: port.node.x + Math.cos(kat) * promien,
    y: port.node.y + Math.sin(kat) * promien,
    angle: kat,
    ring
  };
}

function najnizszyWolnySlot(port) {
  let i = 0;
  while (port.slots.has(i)) i++;
  return i;
}

// ============================================================
// Przydział
// ============================================================

/**
 * Prosi o obsługę w porcie. Zwraca przydział: albo stanowisko, albo miejsce
 * w kolejce.
 *
 * Dobór stanowiska jest best-fit po klasie kadłuba — bez tego szutla zajmuje
 * gniazdo klasy capital i blokuje je na czas obsługi.
 */
export function requestService(control, stationId, course, now = 0, serviceSeconds = 0) {
  const port = getPort(control, stationId);
  if (!port) return null;

  const istniejacy = port.assigned.get(course.id);
  if (istniejacy) return istniejacy;

  const pick = findBerth(port.layout, course.unitClass, now, { freeOnly: true });
  if (pick) {
    reserveBerth(pick.berth, course.id, now + Math.max(0, serviceSeconds));
    const przydzial = {
      courseId: course.id,
      unitClass: course.unitClass,
      berth: pick.berth,
      berthId: pick.berth.id,
      slot: null,
      heldSince: null,
      grantedAt: now
    };
    port.assigned.set(course.id, przydzial);
    control.byCourse.set(course.id, port.stationId);
    control.stats.assigned++;
    return przydzial;
  }

  // Port pełny — statek dostaje własne miejsce w kolejce. WŁASNE jest tu
  // istotne: wcześniej pozycja brała się z hasha identyfikatora na pięciu
  // pasmach, więc przy kilkudziesięciu czekających nakładali się na siebie.
  const slot = najnizszyWolnySlot(port);
  port.slots.add(slot);
  port.waiting++;
  const przydzial = {
    courseId: course.id,
    // Klasa kadłuba MUSI zostać na przydziale: gdy zwolni się stanowisko,
    // `grantWaiting` dobiera je best-fit i bez tej informacji wpuściłoby
    // szutlę na gniazdo klasy capital albo odwrotnie.
    unitClass: course.unitClass,
    berth: null,
    berthId: null,
    slot,
    heldSince: now,
    grantedAt: null
  };
  port.assigned.set(course.id, przydzial);
  control.byCourse.set(course.id, port.stationId);
  control.stats.queued++;
  return przydzial;
}

/** Zwalnia stanowisko albo miejsce w kolejce. */
export function releaseService(control, courseId, now = 0) {
  const stationId = control?.byCourse?.get(String(courseId));
  if (!stationId) return false;
  const port = getPort(control, stationId);
  control.byCourse.delete(String(courseId));
  if (!port) return false;

  const przydzial = port.assigned.get(String(courseId));
  if (!przydzial) return false;
  if (przydzial.berth) releaseBerth(przydzial.berth, now);
  if (przydzial.slot !== null) {
    port.slots.delete(przydzial.slot);
    port.waiting = Math.max(0, port.waiting - 1);
  }
  port.assigned.delete(String(courseId));
  return true;
}

/**
 * Rozdziela zwolnione stanowiska czekającym.
 *
 * Kolejność jest FIFO po czasie oczekiwania, a nie po wielkości ładunku ani
 * odległości. To jest warunek braku zagłodzenia: przy sortowaniu po czymkolwiek
 * innym duży, wolny frachtowiec nigdy nie wchodzi, bo zawsze opłaca się wpuścić
 * kogoś szybszego.
 */
export function grantWaiting(control, stationId, now = 0) {
  const port = getPort(control, stationId);
  if (!port || port.waiting <= 0) return 0;

  const czekajacy = [...port.assigned.values()]
    .filter(entry => !entry.berth)
    .sort((a, b) => (a.heldSince ?? 0) - (b.heldSince ?? 0));
  if (!czekajacy.length) return 0;

  let wpuszczonych = 0;
  for (const entry of czekajacy) {
    const pick = findBerth(port.layout, entry.unitClass || '', now, { freeOnly: true });
    if (!pick) break;
    reserveBerth(pick.berth, entry.courseId, now);
    entry.berth = pick.berth;
    entry.berthId = pick.berth.id;
    entry.grantedAt = now;
    // Miejsce w kolejce wraca do puli dopiero teraz — dopóki statek do niego
    // wraca w razie odmowy, nie wolno go oddać komuś innemu.
    if (entry.slot !== null) {
      port.slots.delete(entry.slot);
      port.waiting = Math.max(0, port.waiting - 1);
      entry.slot = null;
    }
    wpuszczonych++;
    control.stats.granted++;
  }
  return wpuszczonych;
}

/**
 * Ile statek musiałby czekać, gdyby przyleciał teraz.
 *
 * Wejście do pochłaniania opóźnienia: zamiast lecieć na pełnej i stać pod
 * bramą, statek zwalnia w drodze — tam, gdzie postój nic nie kosztuje.
 */
export function estimateWait(control, stationId, unitClass, now = 0) {
  const port = getPort(control, stationId);
  if (!port) return 0;
  const pick = findBerth(port.layout, unitClass, now, { freeOnly: false });
  if (!pick) return 0;
  return Math.max(0, pick.availableAt - now);
}

/**
 * Ile z tego czekania wolno pochłonąć zwalnianiem w drodze.
 * Reszta zostaje jako widoczny postój na orbicie oczekiwania.
 */
export function absorbableDelay(control, waitSeconds) {
  const ratio = Math.max(0, Math.min(1, control?.config?.absorbFraction ?? 0));
  return Math.max(0, Number(waitSeconds) || 0) * ratio;
}

// ============================================================
// Migawka
// ============================================================

export function summarizePorts(control) {
  const rows = [];
  let kolejka = 0;
  let przyStanowisku = 0;
  for (const port of control.ports.values()) {
    let czeka = 0;
    let stoi = 0;
    for (const entry of port.assigned.values()) {
      if (entry.berth) stoi++; else czeka++;
    }
    kolejka += czeka;
    przyStanowisku += stoi;
    if (czeka || stoi) {
      rows.push({ stationId: port.stationId, waiting: czeka, berthed: stoi,
        rings: Math.ceil(czeka / (control.config.slotsPerRing || 8)) });
    }
  }
  rows.sort((a, b) => b.waiting - a.waiting);
  return { ports: rows, waiting: kolejka, berthed: przyStanowisku, stats: { ...control.stats } };
}

/** Czy etap kursu to postój wymagający obsługi w porcie. */
export function needsService(stage, docks) {
  return stage?.kind === STAGE_KIND.DWELL
    && stage.reason !== DWELL_REASON.EXTRACT
    && stage.reason !== DWELL_REASON.HOLD
    && !!docks?.has?.(stage.nodeId);
}
