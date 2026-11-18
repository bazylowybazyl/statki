// src/data/cargoStandard.js
//
// STANDARD ŁADUNKU — dane (czyste: bez three i DOM). MATERIAŁ WSTĘPNY, niewpięty w grę: plansza
// `dema/standard-ladunku.html`, opis `docs/PROPOZYCJA-standard-ladunku.md`, reguła `transport-ladunku`.
//
// AGENT: LICZBY SĄ ROBOCZE (decyzja użytkownika 2026-11-16: „standaryzacja musi pójść później — to w trakcie budowy
// fabryk i stoczni wyjdą rozmiary transportowanych surowców, a nie na odwrót”). Nie importuj tego modułu do gry ani
// do innych dem i nie zmieniaj pod niego istniejących danych; wymiary i tony zostaną przeliczone, gdy zakłady dadzą
// rozmiary prawdziwych wyrobów (pierwszy: krąg stali z huty).
//
// Jedna drabina dla całego transportu: KONTENER gry 16 × 8 j. → MODUŁ 2 × 2 kontenery (ładunek naczepy ciągnika) →
// SEKCJA 2 × 2 moduły (duża standardowa naczepa / ładownia). Każdy stopień to 2 × 2 poprzedniego: dwa razy dłuższy,
// dwa razy szerszy, cztery razy cięższy (7,5 → 30 → 120 t).
//
// Skąd liczby (nic nie jest zmienione w istniejących modułach — test pilnuje zgodności):
//   - kontener 16 × 8 × 8 j.: `CARGO_CONTAINER` (src/data/cargoBays.js, decyzja użytkownika 2026-10-06);
//   - moduł 2 × 2 = chwyt płaski drona L, 30 t: `TRUCK_MODULE` / `TRUCK_TRAILER_TONNES` (src/data/spaceTrucks.js);
//   - 7,5 t na kontener: naczepa 30 t / 4 kontenery; tyle samo daje prom klasy `van` (60 t / 8 slotów pokładu);
//   - sekcja 4 × 4 kontenery: obrys modułu wagonu megafrachtowca (cargoBays.js) = dwa chwyty drona Capital (4 × 2);
//   - 120 t: jedna wyprawa górnicza ruchu v2 (`miningYieldUnits`), 4 naczepy ciągnika szosowego; 3 sekcje = 360 t =
//     statek z dema rudy huty; 20 sekcji = 2400 t = klasa `mega`; 7 sekcji + 2 moduły = 900 t = klasa `heavy`.
//
// Tona jest liczbą rachunku ruchu v2, kontener — jej widokiem (jak w cargoContainers.js): nośnik zmienia wygląd
// i sposób przeładunku, nie tony.
import { CARGO_CONTAINER, cargoModuleSize } from './cargoBays.js';
import { containerFamilyOf, isHazmatCargo } from './cargoContainers.js';
import { RESOURCES, CATEGORY } from './resources.js';

/** Tony na kontener w rachunku transportu (propozycja; `CARGO_TONNES_DEFAULT` dema ładowni to dziś 2 t). */
export const CARGO_TONNES_PER_CONTAINER = 7.5;

const size = (nx, ny) => {
  const m = cargoModuleSize({ nx, ny, nz: 1 }, {});
  return { nx, ny, containers: m.count, L: m.L, W: m.W, H: m.H, tonnes: m.count * CARGO_TONNES_PER_CONTAINER };
};

/**
 * Stopnie ładunku. `L`, `W`, `H` — sam ładunek [j.] (kontenery ze szczeliną 0,25 j.), `tonnes` — pełny stopień,
 * `grip` — klasa drona roju, która niesie stopień jednym chwytem (`grips` — ile chwytów na warstwę), `of` — z czego
 * się składa (2 × 2 niższego stopnia).
 */
export const CARGO_LEVELS = Object.freeze({
  container: Object.freeze({ id: 'container', label: 'Kontener', ...size(1, 1), grip: 'S', grips: 1, of: null }),
  module: Object.freeze({ id: 'module', label: 'Moduł', ...size(2, 2), grip: 'L', grips: 1, of: 'container' }),
  section: Object.freeze({ id: 'section', label: 'Sekcja', ...size(4, 4), grip: 'C', grips: 2, of: 'module' })
});
export const CARGO_LEVEL_IDS = Object.freeze(Object.keys(CARGO_LEVELS));

/**
 * NACZEPA ciągnika: rama z dyszlem na jeden moduł. `body` — bryła [j.], `pitch` — rozstaw przegubów w zestawie
 * (oko dyszla → zaczep tylny). Lustro `TRUCK_TRAILER` (src/data/spaceTrucks.js) — test pilnuje zgodności.
 */
export const CARGO_TRAILER = Object.freeze({
  level: 'module',
  body: Object.freeze({ L: 36, W: 18.2 }),
  pitch: 46,
  tonnes: CARGO_LEVELS.module.tonnes
});

/**
 * SEKCJA w ramie: `load` — ładunek 4 × 4 kontenery, `frame` — grubość ramy wokół ładunku, `outer` — obrys zewnętrzny
 * (to on wchodzi w gniazdo kadłuba i na stanowisko), `H` — wysokość z ramą. Sprzęgi na osi na obu końcach.
 */
export const CARGO_SECTION = Object.freeze({
  level: 'section',
  load: Object.freeze({ L: CARGO_LEVELS.section.L, W: CARGO_LEVELS.section.W }),
  frame: 1.625,
  outer: Object.freeze({ L: 68, W: 36 }),
  H: 10,
  containers: CARGO_LEVELS.section.containers,
  modules: 4,
  tonnes: CARGO_LEVELS.section.tonnes
});

/**
 * SPRZĘG sekcji: ucho na osi, `reach` j. poza ramę z każdego końca. `rigidPitch` — rozstaw sekcji spiętych na sztywno
 * (zestaw statku: jedna bryła w fizyce), `towPitch` — rozstaw sekcji na dyszlu z przegubem (zestaw ciągnika
 * sekcyjnego na ringu: przegub jest tylko obrazem, jak naczepy), `maxBend` — ogranicznik przegubu.
 */
export const CARGO_COUPLER = Object.freeze({
  reach: 2,
  rigidPitch: CARGO_SECTION.outer.L + 2 * 2,
  towPitch: CARGO_SECTION.outer.L + 12,
  maxBend: 35 * Math.PI / 180
});

/**
 * GNIAZDO sekcji w kadłubie: otwór `L` × `W` (sekcja + luz `clear` z każdej strony), głębokość `depth`; kadłub musi
 * mieć co najmniej `minBeam` szerokości (burty po `wall` j. z każdej strony gniazda) i `minLength` długości.
 */
export const CARGO_SOCKET = Object.freeze({
  clear: 2,
  L: CARGO_SECTION.outer.L + 4,
  W: CARGO_SECTION.outer.W + 4,
  depth: CARGO_SECTION.H,
  wall: 8,
  minBeam: CARGO_SECTION.outer.W + 4 + 16,
  minLength: CARGO_SECTION.outer.L + 4 + 60
});

/**
 * ODMIANY NOŚNIKA — te same cztery rodziny na każdym stopniu (kontener, moduł, sekcja). `family` — rodzina kontenera
 * gry (`CONTAINER_FAMILY`), `existing` — czy rodzina już jest w grze; platforma jest NOWA (kręgi blachy, belki, płyty).
 */
export const CARGO_CARRIERS = Object.freeze({
  box: Object.freeze({ id: 'box', label: 'Skrzynia', family: 'standard', existing: true, goods: 'sztuki i towar cenny: podzespoły, układy, amunicja (pasy hazmat)' }),
  tank: Object.freeze({ id: 'tank', label: 'Zbiornik', family: 'tank', existing: true, goods: 'gazy i ciecze: tlen, wodór, paliwo, chłodziwo' }),
  hopper: Object.freeze({ id: 'hopper', label: 'Zasobnik', family: 'hopper', existing: true, goods: 'sypkie: ruda, urobek, złom, lód, granulat' }),
  flat: Object.freeze({ id: 'flat', label: 'Platforma', family: null, existing: false, goods: 'kręgi blachy, belki, płyty kadłuba, duże sztuki' })
});
export const CARGO_CARRIER_IDS = Object.freeze(Object.keys(CARGO_CARRIERS));

/**
 * Towary, które jadą na platformie: wyrób huty w postaci materiału (metale w kręgach i belkach, przewód w kręgach)
 * i płyty kadłuba. Dziś `containerFamilyOf` wkłada stal i przewód do zsypu (wzór „sztaby” / „kręgi”), stopy — do
 * kontenera standardowego; to jedyna zmiana przydziału względem cargoContainers.js.
 */
export const CARGO_FLAT_GOODS = Object.freeze(['steel', 'copper_wire', 'titan_alloy', 'aluminum', 'nickel_superalloy', 'hull_plate']);

const FAMILY_CARRIER = Object.freeze({ standard: 'box', tank: 'tank', hopper: 'hopper' });

/** Odmiana nośnika dla towaru (`null` — ludzie: lecą promem, nie ładunkiem). */
export function cargoCarrierFor(resourceId) {
  const id = String(resourceId || '');
  const def = RESOURCES[id];
  if (def && def.category === CATEGORY.CREW) return null;
  if (CARGO_FLAT_GOODS.includes(id)) return 'flat';
  return FAMILY_CARRIER[containerFamilyOf(id)] || 'box';
}

/** Czy towar jedzie w skrzyni z pasami hazmat (pręty paliwowe, amunicja). */
export function cargoIsHazmat(resourceId) {
  return isHazmatCargo(String(resourceId || ''));
}

/**
 * Największa pojedyncza sztuka na platformie danego stopnia [j.] (ładunek minus 1 j. zapasu na kłonice): krąg albo
 * wiązka belek z huty musi się w tym mieścić. Stopień: 'container' | 'module' | 'section'.
 */
export function cargoMaxPiece(levelId) {
  const lv = CARGO_LEVELS[levelId] || CARGO_LEVELS.container;
  return { L: Math.floor(lv.L - 1), W: Math.floor(lv.W - 1) };
}

/**
 * SEKCJE NARZĘDZIOWE: ten sam obrys, sprzęg i gniazdo co sekcja ładunkowa, zamiast ładunku — maszyna. Kruszarka
 * stoi przed sekcją-zasobnikiem (urobek idzie w osi zestawu do tyłu). `rate` — t/s (propozycja: sekcja 120 t
 * w 2 minuty; do uzgodnienia z wydobyciem gry).
 */
export const CARGO_TOOL_SECTIONS = Object.freeze({
  crusher: Object.freeze({ id: 'crusher', label: 'Kruszarka', outer: CARGO_SECTION.outer, tonnes: 0, feeds: 'hopper', rate: 1 })
});

/**
 * CIĄGNIK SEKCYJNY („większy truck” — propozycja, nie ma go w demie ciągników): ciągnie 1–3 sekcje na dyszlach.
 * Trzy sekcje = 360 t, czyli ładunek frachtowca klasy `bulk`.
 */
export const CARGO_SECTION_TRACTOR = Object.freeze({
  id: 'section', label: 'Sekcyjny', body: Object.freeze({ L: 52, W: 34 }), sectionsMax: 3
});

/** Długość zestawu ciągnika sekcyjnego [j.] od dzioba do końca ostatniej sekcji. */
export function cargoSectionRigLength(sections) {
  // każda sekcja: dyszel (towPitch − długość ramy) + rama
  return CARGO_SECTION_TRACTOR.body.L + Math.max(0, sections | 0) * CARGO_COUPLER.towPitch;
}

/** Ładowność [t] zestawu: `trailers` naczep-modułów albo `sections` sekcji. */
export function cargoRigTonnes({ trailers = 0, sections = 0 } = {}) {
  return Math.max(0, trailers | 0) * CARGO_LEVELS.module.tonnes + Math.max(0, sections | 0) * CARGO_LEVELS.section.tonnes;
}

/**
 * Rozkład masy na stopnie standardu: ile pełnych sekcji, modułów i kontenerów oraz reszta ton (ładunek niepełnego
 * kontenera). `cargoBreakdown(900)` → 7 sekcji + 2 moduły; `cargoBreakdown(160)` → 1 sekcja + 1 moduł + 1 kontener + 2,5 t.
 */
export function cargoBreakdown(tonnes) {
  let t = Math.max(0, Number(tonnes) || 0);
  const out = { sections: 0, modules: 0, containers: 0, rest: 0 };
  out.sections = Math.floor((t + 1e-9) / CARGO_LEVELS.section.tonnes);
  t -= out.sections * CARGO_LEVELS.section.tonnes;
  out.modules = Math.floor((t + 1e-9) / CARGO_LEVELS.module.tonnes);
  t -= out.modules * CARGO_LEVELS.module.tonnes;
  out.containers = Math.floor((t + 1e-9) / CARGO_LEVELS.container.tonnes);
  t -= out.containers * CARGO_LEVELS.container.tonnes;
  out.rest = Math.abs(t) < 1e-9 ? 0 : +t.toFixed(3);
  return out;
}

/** Ile kontenerów zajmuje masa (ostatni może być niepełny). */
export function cargoContainersFor(tonnes) {
  const t = Math.max(0, Number(tonnes) || 0);
  return t > 1e-9 ? Math.ceil(t / CARGO_TONNES_PER_CONTAINER - 1e-9) : 0;
}

/** Ile sekcji w jednej warstwie mieści prostokąt `L` × `W` [j.] (ładownia, luk, plac) — sekcje wzdłuż `L`. */
export function cargoSectionsInArea(L, W) {
  const nx = Math.max(0, Math.floor(((Number(L) || 0) + 1e-9) / CARGO_SOCKET.L));
  const ny = Math.max(0, Math.floor(((Number(W) || 0) + 1e-9) / CARGO_SOCKET.W));
  return { nx, ny, count: nx * ny };
}

/** Czy kadłub o sylwetce `length` × `beam` [j.] pomieści gniazdo sekcji w osi. */
export function cargoHullFitsSocket(length, beam) {
  return (Number(length) || 0) >= CARGO_SOCKET.minLength && (Number(beam) || 0) >= CARGO_SOCKET.minBeam;
}
