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

/**
 * Czy kadłub zmieści się na TYM stanowisku.
 *
 * Stanowisko z własnymi limitami pola (`maxLength` / `maxBeam` — pady hal K-7
 * i zatok ringu) mierzy się nimi, reszta — gabarytami klasy. Różnica ma
 * znaczenie dla okrętów: fregata (192 × 144 j.) nie wchodzi w klasę S ruchu
 * (170 × 140), ale pad S hali K-7 (300 × 180) mieści ją bez trudu. Kadłubom
 * cywilnym klasy to nie zmienia (sprawdzone testem na wszystkich profilach).
 */
export function hullFitsBerth(berth, hullId) {
  return !!berth && fitsSize(berth, hullFootprint(hullId));
}

function fitsSize(berth, size) {
  const cls = BERTH_CLASSES[berth.cls];
  const maxLength = Number(berth.maxLength) || (cls ? cls.length : 0);
  const maxBeam = Number(berth.maxBeam) || (cls ? cls.width : 0);
  return size.length <= maxLength && size.width <= maxBeam;
}

// ============================================================
// Role stanowisk
// ============================================================

/**
 * Do kogo należy stanowisko. Decyzja użytkownika 2026-09-26: hale K-7 to
 * wojsko (flota frakcji), zatoki i pomosty to terminale przeładunkowe — kursy
 * cywilne stają tylko na `civil`, flota frakcji tylko na `military`.
 */
export const BERTH_ROLE = Object.freeze({
  CIVIL: 'civil',
  MILITARY: 'military'
});

/** Rola stanowiska; brak pola = cywilne (stare układy i pomosty). */
export function berthRole(berth) {
  return berth?.role || BERTH_ROLE.CIVIL;
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
function buildPier(dockId, mix, role) {
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
      role,
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
  // Pomosty to terminale przeładunkowe — cywilne, chyba że wołający każe inaczej.
  const role = options.role || BERTH_ROLE.CIVIL;

  const docks = [];
  for (let index = 0; index < count; index++) {
    const angle = (Math.PI * 2 * index) / count + (options.angleOffset || 0);
    const dockId = `${station.id}:dok${index + 1}`;
    const pier = buildPier(dockId, mix, role);
    const dock = {
      id: dockId,
      stationId: station.id,
      role,
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
 *
 * RÓWNY ROZKŁAD (decyzja użytkownika 2026-09-26: „chcę widzieć żywość w całym
 * porcie”). Do tej pory remis kosztu wygrywało PIERWSZE stanowisko z listy, więc
 * hala K-7 nr 1 miała śr. 18/28 zajętych i bywała pełna, a zatoki kompleksu
 * po drugiej stronie ringu stały puste (0,1/28). Teraz remis rozstrzyga dok
 * najmniej obłożony (ułamek zajętych), a przy równym obłożeniu — dok wskazany
 * rotacją po liczbie zajętych w porcie, żeby żaden nie był wiecznie „pierwszy”.
 * Best-fit zostaje nietknięty: obłożenie decyduje dopiero przy RÓWNYM koszcie,
 * więc kara `rank × classWasteSeconds` nadal trzyma szutle z dala od capital.
 *
 * Opcje: `role` — tylko stanowiska tej roli (`BERTH_ROLE`; brak = wszystkie),
 * `spread: false` — stary dobór „pierwsze z listy”, `freeOnly`, `readyBy`,
 * `classWasteSeconds`.
 */
export function findBerth(layout, hullId, now = 0, options = {}) {
  if (!layout) return null;
  const readyBy = Number(options.readyBy) || now;
  const role = options.role || null;
  const wastePerRank = options.classWasteSeconds ?? 30;
  const size = hullFootprint(hullId);
  const load = options.spread === false ? null : dockLoads(layout);
  let best = null;

  for (const berth of layout.berths) {
    if (role && berthRole(berth) !== role) continue;
    if (!fitsSize(berth, size)) continue;
    if (options.freeOnly && berth.freeAt > now) continue;
    if (berth.occupantId && options.freeOnly) continue;
    const availableAt = Math.max(berth.freeAt, readyBy);
    // Kara za marnowanie klasy: przy równym czasie wygrywa ciaśniejsze stanowisko.
    const cost = availableAt + berth.rank * wastePerRank;
    if (best) {
      if (cost > best.cost + COST_EPSILON) continue;
      if (cost >= best.cost - COST_EPSILON
        && (!load || !lighterDock(load, berth.dockId, best.berth.dockId))) continue;
    }
    best = { berth, availableAt, cost };
  }

  return best;
}

const COST_EPSILON = 1e-6;

/**
 * Obłożenie doków liczone od nowa przy każdym doborze — 224 stanowiska portu
 * K-7 to kilka mikrosekund, a licznik prowadzony w `reserveBerth` musiałby znać
 * dok, którego stanowisko nie zna. Bufor żyje w WeakMap, nie w samym układzie:
 * układ ma zostać czystymi danymi (worker ruchu, zrzuty JSON).
 */
const dockLoadScratch = new WeakMap();

function dockLoads(layout) {
  let scratch = dockLoadScratch.get(layout);
  if (!scratch) {
    scratch = { byDock: new Map(), taken: 0 };
    dockLoadScratch.set(layout, scratch);
  }
  for (const entry of scratch.byDock.values()) { entry.taken = 0; entry.total = 0; }
  let taken = 0;
  for (const berth of layout.berths) {
    let entry = scratch.byDock.get(berth.dockId);
    if (!entry) {
      entry = { taken: 0, total: 0, order: scratch.byDock.size };
      scratch.byDock.set(berth.dockId, entry);
    }
    entry.total++;
    if (berth.occupantId) { entry.taken++; taken++; }
  }
  scratch.taken = taken;
  return scratch;
}

/** Czy dok `a` jest lepszym wyborem od `b` przy równym koszcie stanowiska. */
function lighterDock(load, dockA, dockB) {
  if (dockA === dockB) return false;
  const a = load.byDock.get(dockA);
  const b = load.byDock.get(dockB);
  if (!a || !b) return false;
  // Porównanie ułamków bez dzielenia: a.taken / a.total < b.taken / b.total.
  const lhs = a.taken * b.total;
  const rhs = b.taken * a.total;
  if (lhs !== rhs) return lhs < rhs;
  const n = load.byDock.size;
  const shift = load.taken % n;
  return ((a.order - shift + n) % n) < ((b.order - shift + n) % n);
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

/**
 * Ile stanowisk jest w tej chwili zajętych — do panelu i do wyceny slotów.
 * `byRole` i `byDock` pokazują, czy rozkład jest równy (pomiar portu).
 */
export function berthOccupancy(layout) {
  if (!layout) return { total: 0, taken: 0, byClass: {}, byRole: {}, byDock: {} };
  const byClass = {};
  const byRole = {};
  const byDock = {};
  let taken = 0;
  for (const berth of layout.berths) {
    const entry = byClass[berth.cls] || (byClass[berth.cls] = { total: 0, taken: 0 });
    const roleEntry = byRole[berthRole(berth)] || (byRole[berthRole(berth)] = { total: 0, taken: 0 });
    const dockEntry = byDock[berth.dockId] || (byDock[berth.dockId] = { total: 0, taken: 0 });
    entry.total++;
    roleEntry.total++;
    dockEntry.total++;
    if (berth.occupantId) { entry.taken++; roleEntry.taken++; dockEntry.taken++; taken++; }
  }
  return { total: layout.berths.length, taken, byClass, byRole, byDock };
}
