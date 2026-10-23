/**
 * WORKFORCE — ludzie, bez których budynek nie pracuje (E16).
 *
 * Projekt i liczby: docs/PROPOZYCJA-workforce.md (decyzje użytkownika D1–D14
 * z 2026-10-23). Model: obsada jako zapas, rotacja jako zużycie — towar
 * `workforce` w magazynie rynku to ludzie na miejscu, a co sekundę `obsada / T`
 * z nich kończy kontrakt. Ośrodki ludności (ringi Halo, strefy zielone Marsa,
 * w przyszłości bazy w asteroidach) wysyłają nowych.
 *
 * Wszystkie liczby są w SKALI 1, jak receptury i `STATION_UPKEEP` — świat ruchu
 * mnoży je przez skalę gospodarki (×60), więc w grze huta to 40 × 60 = 2400 osób.
 *
 * Moduł jest czystymi danymi: bez logiki świata, bez DOM.
 */

/**
 * Obsada jednego budynku roli przemysłu (budynek = moc archetypu,
 * `INDUSTRY_ARCHETYPES[rola].capacity`). Wzór: 45 osób × moc × pracochłonność
 * (PROPOZYCJA § 1.2) — skala zakładu i to, ile z niej robi automat.
 */
export const WORKFORCE_PER_BUILDING = Object.freeze({
  foundry: 40,       // piece i walcownia, ciężka praca przy wsadzie
  electronics: 30,   // cleanroomy: automat, ale kwalifikacje i kontrola jakości
  volatiles: 15,     // elektroliza i synteza — instalacja ciągła
  gasworks: 18,      // czerpaki, kraking, materiał wybuchowy
  enrichment: 20,    // wirówki, ochrona materiału rozszczepialnego
  shipworks: 80,     // największy zakład: montaż ręczny w doku
  systems: 50,       // awionika, reaktory, tarcze — precyzyjny montaż i testy
  recycling: 25,     // cięcie wraków ręcznie
  armory: 40,        // lufy, wyrzutnie, wieże, próby ogniowe
  beltworks: 27,     // nadstop, kompozyt, katalizator
  munitions: 33,     // elaboracja amunicji
  aerospace: 40      // płatowce: małe serie, dużo ręcznej roboty
});

/** Kopalnia planety albo księżyca na 1,0 `PLANET_YIELD.rate` (9 jedn. na cykl). */
export const WORKFORCE_PER_MINE_RATE = 20;
/** Port na stanowisko cywilne. Hale wojskowe K-7 obsadza garnizon frakcji, nie workforce. */
export const WORKFORCE_PER_CIVIL_BERTH = 0.2;
/** Magazyn: skład bazowy portu ×N (mnożnik hal) = N magazynów. */
export const WORKFORCE_PER_STORE = 3;
/** Pochylnie stoczni na 1,0 wagi stoczni (`SHIPYARD_WEIGHT`). */
export const WORKFORCE_PER_YARD_WEIGHT = 42;

/** Długość kontraktu rotacyjnego w sekundach gry (D2: 45 min). */
export const WORKFORCE_CONTRACT_SECONDS = 2700;
/** Kwatery: pojemność magazynu workforce rynku pracy = tyle × N. */
export const WORKFORCE_QUARTERS = 2;
/** Podłoga skupu (`declareDemand` floor) = tyle × N. */
export const WORKFORCE_RESTOCK_FLOOR = 1.3;
/** Magazyn źródła mieści tyle godzin jego podaży (gdy to więcej niż kwatery). */
export const WORKFORCE_SOURCE_HOURS = 1;
/** Zapas startowy źródła (ułamek magazynu) — ponad progiem nadwyżki planisty (70%). */
export const WORKFORCE_SOURCE_SEED_FILL = 0.75;
/**
 * Najmniejsza partia ludzi w jednym kursie planisty (osoby, świat): 80% promu klasy van
 * albo 5% obsady odbiorcy (~2 min rotacji), co większe. Planista dolewa zapas do progu
 * co tick, więc bez podłogi rotacja szła w kursach po ~96 osób (~2000 kursów/h, pomiar W1).
 * Poniżej `WORKFORCE_URGENT_RATIO` obsady leci każda partia.
 */
export const WORKFORCE_MIN_SHIPMENT = 192;
export const WORKFORCE_MIN_SHIPMENT_SHARE = 0.05;
export const WORKFORCE_URGENT_RATIO = 0.9;
/** Poniżej tej obsady (zapas / N) zakład stoi (D3) — skutek wchodzi w kroku W3. */
export const WORKFORCE_MIN_RATIO = 0.2;

/**
 * OŚRODKI LUDNOŚCI — podaż kontraktów na cykl (20 s) w skali 1, po źródłach.
 * Mars ma DWA źródła w jednym rynku: ring ECUMENE i strefy zielone na powierzchni.
 * Ludność (ring Ziemi ~2 mld) to opis; gra liczy samą podaż. PROPOZYCJA § 2.2:
 * razem 521 tys. osób/h w świecie wobec 407 tys./h rotacji (zapas 28%).
 */
export const POPULATION_CENTERS = Object.freeze({
  earth: Object.freeze({ ring: 15.6 }),
  mars: Object.freeze({ ring: 11.2, green: 7.5 }),
  jupiter: Object.freeze({ ring: 14.0 })
});

/**
 * PROMY (W2): kurs z ludźmi leci klasą `crew-*` dobraną do ładowni statku przewoźnika
 * (`TRAFFIC_UNIT_HULLS` w src/data/trafficHulls.js daje kadłub — do czasu własnych sprite'ów
 * W7 obecne frachtowce). Ludzi nie wozi się w megafrachtowcach: ciężkie klasy lecą
 * jako liniowiec dalekiego zasięgu.
 */
export const CREW_CLASS_BY_VAN = Object.freeze({
  van: 'crew-small', hauler: 'crew-medium', bulk: 'crew-large', heavy: 'crew-large', mega: 'crew-large'
});
/** Zaokrętowanie i wyokrętowanie rękawem (s) — towar: 90 / 120 s z dronami. */
export const PASSENGER_BOARD_SECONDS = 60;
export const PASSENGER_DISEMBARK_SECONDS = 60;

/** Etykiety źródeł do UI. */
export const POPULATION_SOURCE_LABEL = Object.freeze({
  ring: 'Ring Halo',
  green: 'Strefy zielone',
  habitat: 'Habitat'
});
