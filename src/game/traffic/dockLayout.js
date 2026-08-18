/**
 * DOKI — fizyczna twarz stacji.
 *
 * Dok to prostokątny pomost z rzędem stanowisk po obu stronach, jak palec
 * terminalu na lotnisku. Statek podchodzi z zewnątrz, staje dziobem do pomostu
 * i tam jest obsługiwany. JEDEN DOK MIEŚCI WIELE STATKÓW — o przepustowości
 * stacji decyduje liczba i klasa stanowisk, nie liczba doków.
 *
 * Gdzie stoją:
 *   - stacja z pierścieniem (Ziemia, Mars) — doki są PRZYCZEPIONE DO RINGU,
 *     rozstawione po jego obwodzie i ustawione stycznie
 *   - stacja bez pierścienia — doki na okręgu wokół samej stacji
 *
 * Poza dokami jest jeszcze WOLUMEN PARKINGOWY: statek bez zlecenia nie znika,
 * tylko czeka na orbicie postojowej. To on tworzy obraz żywego portu i to z niego
 * firmy transportowe biorą jednostki pod nowy kurs.
 *
 * Wymiary stanowisk wynikają z prawdziwych kadłubów z `ships.js`
 * (`length × HULL_RENDER_WORLD_SCALE`), a nie z okrągłych liczb — inaczej
 * megafrachtowiec nie mieści się w niczym, co wygląda na dok.
 */

import { HULL_RENDER_PROFILES, HULL_RENDER_WORLD_SCALE } from '../../data/ships.js';

// ============================================================
// Klasy stanowisk
// ============================================================

/**
 * Klasy dobrane tak, żeby każdy cywilny kadłub z gry miał gdzie stanąć.
 * `rank` steruje dopasowaniem: statek wchodzi na najmniejsze stanowisko,
 * w które się mieści, żeby nie blokował większego bez potrzeby.
 *
 * Klasa `capital` jest wymagana od początku — Atlas ma 1800×600 j. i nie mieści
 * się w największym stanowisku handlowym.
 */
export const BERTH_CLASSES = Object.freeze({
  s: { id: 's', rank: 0, length: 170, width: 140, label: 'S' },
  m: { id: 'm', rank: 1, length: 380, width: 280, label: 'M' },
  l: { id: 'l', rank: 2, length: 660, width: 400, label: 'L' },
  capital: { id: 'capital', rank: 3, length: 2000, width: 720, label: 'CAP' },
  // Megafrachtowiec (2760 j.) nie mieści się w całości nigdzie — cumuje przodem
  // składu, reszta zostaje w próżni. Osobna, rzadka klasa.
  mega: { id: 'mega', rank: 4, length: 3000, width: 1000, label: 'MEGA' }
});

export const BERTH_CLASS_ORDER = Object.freeze(
  Object.values(BERTH_CLASSES).sort((a, b) => a.rank - b.rank)
);

/**
 * Ile razy powielić skład stanowisk, żeby port uniósł swój ruch.
 *
 * Wielkość portu wynika z PRZEŁADUNKU (`stationHaulTonnage`), a nie z wielkości
 * osady. To jest różnica, która długo psuła symulację po cichu: Merkury to mała
 * kolonia z ogromną kopalnią, więc licząc od mieszkańców dostawał najmniejszy
 * port w układzie, mając największy przeładunek. Zmierzone przed poprawką:
 *
 *   mercury  2952 t/h przez mnożnik 1   ← największy ruch, najmniejszy port
 *   jupiter   917 t/h przez mnożnik 2   ← trzy razy mniej ruchu, port dwa razy większy
 *
 * Skutek było widać na mapie: megafrachtowce z pomarańczową obwódką stały
 * wieńcem wokół Merkurego i Wenus czekając na stanowisko, Ziemia nie dostawała
 * rudy i zerowała magazyny, a Jowisz i Mars prosperowały na pustych nabrzeżach.
 *
 * `tonsPerHour` bierze się z `stationHaulTonnage(STATION_INDUSTRY)[id]` — liczy
 * wyłącznie towar, który ma po drugiej stronie odbiorcę, bo nadwyżka bez kupca
 * nigdzie nie jedzie i nabrzeża nie obciąża.
 */
export function suggestBerthMultiplier(tonsPerHour = 0, economyScale = 1) {
  const tons = Math.max(0, Number(tonsPerHour) || 0);
  const scale = Math.max(1, Number(economyScale) || 1);
  return Math.max(1, Math.min(6, Math.ceil((tons * scale) / TONS_PER_BERTH_BLOCK)));
}

/**
 * Ile ton na godzinę obsługuje jeden komplet stanowisk.
 *
 * Skalibrowane tak, żeby przy gospodarce ×60 Ziemia i Merkury — dwa największe
 * węzły przeładunkowe — dostały porty odpowiednio 5 i 4 razy większe od
 * bazowego, a stacje końcowe zostały przy jednym komplecie.
 */
export const TONS_PER_BERTH_BLOCK = 50000;

/** Gabaryty kadłuba w jednostkach świata. */
export function hullFootprint(hullId) {
  const profile = HULL_RENDER_PROFILES[hullId] || HULL_RENDER_PROFILES.container_ship;
  return {
    length: profile.length * HULL_RENDER_WORLD_SCALE,
    width: profile.radius * 2 * HULL_RENDER_WORLD_SCALE
  };
}

/** Najmniejsze stanowisko, w które kadłub się mieści. `null`, gdy żadne. */
export function berthClassForHull(hullId) {
  const size = hullFootprint(hullId);
  for (const cls of BERTH_CLASS_ORDER) {
    if (size.length <= cls.length && size.width <= cls.width) return cls;
  }
  return null;
}

/** Czy kadłub zmieści się na stanowisku danej klasy. */
export function berthFits(berthClassId, hullId) {
  const cls = BERTH_CLASSES[berthClassId];
  if (!cls) return false;
  const size = hullFootprint(hullId);
  return size.length <= cls.length && size.width <= cls.width;
}

// ============================================================
// Układ doku
// ============================================================

/**
 * Skład stanowisk w jednym doku. Przewaga klasy M, bo to jej odpowiada
 * `container_ship` — najczęstsza jednostka w ruchu towarowym.
 */
const DEFAULT_BERTH_MIX = Object.freeze([
  's', 's', 'm', 'm', 'm', 'm', 'm', 'm', 'l', 'l', 'l', 'capital', 'mega'
]);

/** Odstęp między stanowiskami wzdłuż pomostu. */
const BERTH_PITCH = 1.25;
/** Szerokość samego pomostu — statki stoją po obu jego stronach. */
const PIER_WIDTH = 260;

/**
 * Buduje jeden dok-pomost. Stanowiska idą naprzemiennie po obu stronach,
 * co skraca pomost o połowę przy tej samej liczbie miejsc.
 *
 * Układ lokalny: pomost wzdłuż osi X, stanowiska odchodzą w ±Y.
 */
function buildPier(dockId, mix) {
  const berths = [];
  let cursorA = 0;
  let cursorB = 0;

  mix.forEach((classId, index) => {
    const cls = BERTH_CLASSES[classId] || BERTH_CLASSES.m;
    const side = index % 2 === 0 ? 1 : -1;
    const slot = cls.width * BERTH_PITCH;
    const along = side > 0 ? (cursorA += slot) - slot / 2 : (cursorB += slot) - slot / 2;

    berths.push({
      id: `${dockId}:b${index}`,
      dockId,
      cls: cls.id,
      rank: cls.rank,
      // Pozycja lokalna środka stanowiska.
      lx: along,
      ly: side * (PIER_WIDTH / 2 + cls.length / 2),
      // Dziób skierowany do pomostu — statek podchodzi z zewnątrz.
      heading: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      side,
      length: cls.length,
      width: cls.width,
      /** Czas symulacji, od którego stanowisko jest wolne. Wejście dla slotów. */
      freeAt: 0,
      occupantId: null
    });
  });

  const pierLength = Math.max(cursorA, cursorB);
  // Wyśrodkowanie pomostu na jego własnym punkcie zaczepienia.
  for (const berth of berths) berth.lx -= pierLength / 2;

  return { berths, length: pierLength, width: PIER_WIDTH };
}

/** Obrót punktu lokalnego doku do współrzędnych świata. */
function toWorld(dock, lx, ly) {
  const cos = Math.cos(dock.angle);
  const sin = Math.sin(dock.angle);
  return { x: dock.x + lx * cos - ly * sin, y: dock.y + lx * sin + ly * cos };
}

/**
 * Buduje doki dla jednej stacji.
 *
 * `station` musi mieć `x`, `y` oraz opcjonalnie `ringWorldRadius`. Doki przy
 * pierścieniu siedzą NA jego promieniu i są ustawione stycznie — wyglądają jak
 * pomosty wyrastające z obręczy, a nie jak przypadkowe prostokąty obok.
 */
export function buildStationDocks(station, options = {}) {
  if (!station) return null;
  const ringRadius = Number(station.ringWorldRadius) || 0;
  const hasRing = ringRadius > 0;
  const count = Math.max(1, Math.floor(options.dockCount ?? (hasRing ? 4 : 2)));
  // Duży hub ma DŁUŻSZE pomosty, nie więcej pomostów — inaczej wokół stacji
  // robi się las kikutów. Mnożnik powiela skład stanowisk wzdłuż tego samego doku.
  const repeats = Math.max(1, Math.floor(options.berthMultiplier || 1));
  const baseMix = options.berthMix || DEFAULT_BERTH_MIX;
  const mix = repeats > 1
    ? Array.from({ length: repeats }, () => baseMix).flat()
    : baseMix;

  // Bez pierścienia doki wiszą na orbicie postojowej wokół stacji. Promień musi
  // być wyraźnie większy od samej stacji, żeby podejście miało gdzie się odbyć.
  const dockRadius = hasRing
    ? ringRadius
    : Math.max(Number(station.r) || 0, 1000) * 4;

  const docks = [];
  for (let index = 0; index < count; index++) {
    const angle = (Math.PI * 2 * index) / count + (options.angleOffset || 0);
    const dockId = `${station.id}:dok${index + 1}`;
    const pier = buildPier(dockId, mix);
    const dock = {
      id: dockId,
      stationId: station.id,
      // Punkt zaczepienia na obręczy pierścienia albo na orbicie doków.
      x: station.x + Math.cos(angle) * dockRadius,
      y: station.y + Math.sin(angle) * dockRadius,
      // Pomost stycznie do obręczy.
      angle: angle + Math.PI / 2,
      ringAngle: angle,
      length: pier.length,
      width: pier.width,
      attachedToRing: hasRing,
      berths: pier.berths
    };
    for (const berth of dock.berths) {
      const world = toWorld(dock, berth.lx, berth.ly);
      berth.x = world.x;
      berth.y = world.y;
      berth.angle = dock.angle + berth.heading;
      // Punkt, z którego statek wchodzi na stanowisko prosto. Bez niego
      // podejście trzeba by liczyć w locie, a to jest stała geometria.
      const approach = toWorld(dock, berth.lx, berth.ly + berth.side * berth.length * 0.9);
      berth.approachX = approach.x;
      berth.approachY = approach.y;
    }
    docks.push(dock);
  }

  return {
    stationId: station.id,
    hasRing,
    ringRadius,
    dockRadius,
    docks,
    berths: docks.flatMap(dock => dock.berths),
    /**
     * Orbita postojowa — tu czekają jednostki bez zlecenia. Leży ZA dokami,
     * żeby postój nie zasłaniał podejścia do stanowisk.
     */
    parkingRadius: dockRadius * 1.45,
    parkingSlots: Math.max(8, Math.floor(options.parkingSlots ?? 24))
  };
}

/** Ile pasm postojowych — dalej parking przestaje wyglądać jak parking. */
const PARKING_BANDS = 4;
/** Złoty kąt: rozkłada punkty równomiernie bez tworzenia szprych i pierścieni. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Pozycja miejsca postojowego o zadanym numerze.
 *
 * Rozkład musi być OGRANICZONY: przy tysiącach jednostek prosty podział na
 * kolejne pierścienie rozpychał flotę na kilkanaście obwodów i wokół stacji
 * robiło się konfetti sięgające dalej niż sam port. Złoty kąt daje równomierne
 * wypełnienie, a liczba pasm trzyma wszystko w wąskiej wstędze nad dokami.
 */
export function parkingSlotPosition(layout, station, slotIndex) {
  if (!layout || !station) return null;
  const slots = Math.max(1, layout.parkingSlots);
  const index = Math.max(0, Math.floor(Number(slotIndex) || 0));
  const angle = index * GOLDEN_ANGLE;
  const band = Math.floor(index / slots) % PARKING_BANDS;
  const radius = layout.parkingRadius * (1 + band * 0.08);
  return {
    x: station.x + Math.cos(angle) * radius,
    y: station.y + Math.sin(angle) * radius,
    angle: angle + Math.PI / 2
  };
}

// ============================================================
// Przydział stanowisk
// ============================================================

/**
 * Najlepsze wolne stanowisko dla kadłuba.
 *
 * Dobór jest best-fit: bierzemy najmniejsze, w które statek wchodzi. Bez tego
 * pierwszy lepszy szuter zajmuje stanowisko klasy capital i blokuje je na czas
 * obsługi, a frachtowiec czeka mimo pustego portu.
 *
 * `now` pozwala wybrać stanowisko, które ZWOLNI SIĘ najwcześniej, nawet jeśli
 * jeszcze jest zajęte — to jest wejście do kolejkowania slotowego.
 */
export function findBerth(layout, hullId, now = 0, options = {}) {
  if (!layout) return null;
  const readyBy = Number(options.readyBy) || now;
  let best = null;

  for (const berth of layout.berths) {
    if (!berthFits(berth.cls, hullId)) continue;
    if (options.freeOnly && berth.freeAt > now) continue;
    if (berth.occupantId && options.freeOnly) continue;
    const availableAt = Math.max(berth.freeAt, readyBy);
    // Kara za marnowanie klasy: przy równym czasie wygrywa ciaśniejsze stanowisko.
    const waste = berth.rank * (options.classWasteSeconds ?? 30);
    const cost = availableAt + waste;
    if (!best || cost < best.cost) best = { berth, availableAt, cost };
  }

  return best;
}

/** Rezerwuje stanowisko do zadanego czasu. Zwraca `false`, gdy już zajęte. */
export function reserveBerth(berth, occupantId, freeAt) {
  if (!berth || (berth.occupantId && berth.occupantId !== occupantId)) return false;
  berth.occupantId = String(occupantId);
  berth.freeAt = Math.max(Number(berth.freeAt) || 0, Number(freeAt) || 0);
  return true;
}

export function releaseBerth(berth, now = 0) {
  if (!berth) return false;
  berth.occupantId = null;
  berth.freeAt = Math.max(0, Number(now) || 0);
  return true;
}

/** Ile stanowisk jest w tej chwili zajętych — do panelu i do wyceny slotów. */
export function berthOccupancy(layout) {
  if (!layout) return { total: 0, taken: 0, byClass: {} };
  const byClass = {};
  let taken = 0;
  for (const berth of layout.berths) {
    const entry = byClass[berth.cls] || (byClass[berth.cls] = { total: 0, taken: 0 });
    entry.total++;
    if (berth.occupantId) { entry.taken++; taken++; }
  }
  return { total: layout.berths.length, taken, byClass };
}
