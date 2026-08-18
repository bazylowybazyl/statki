/**
 * PRZEWOŹNICY — kto obsługuje ruch w układzie.
 *
 * Rynek transportowy nie składa się z jednej firmy państwowej ani z tysiąca
 * równych sobie: jest kilku dużych operatorów, garść średnich i długi ogon
 * drobnych. Ten rozkład ma znaczenie mechaniczne, nie dekoracyjne — to on
 * decyduje, ile jednostek stać na pusty powrót, a ile musi czekać na ładunek.
 *
 * Flota skaluje się z gospodarką. Przy `economyScale = 1` układ potrzebuje
 * kilkudziesięciu statków; przy stukrotnie większym przepływie potrzebuje ich
 * tysiące, bo ładownia się nie zmienia, a kurs nadal trwa 20–50 minut.
 */

import { createCompany, addShip, registerCompany, COMPANY_POLICY } from './transportCompanies.js';

const NAMES = [
  'Kolos Logistyka', 'Wenus Frachty', 'Bracia Kowal', 'Konsorcjum Zewnętrzne',
  'Marsjańska Spedycja', 'Merkury Transit', 'Orbita Handlowa', 'Zefir Cargo',
  'Dalekobieżni', 'Perseusz Line', 'Stalowy Szlak', 'Hermes Frachty',
  'Kuiper Haul', 'Południk Zero', 'Tytan Przewozy', 'Nocna Zmiana',
  'Kruk Logistyka', 'Srebrna Trasa', 'Wilga Cargo', 'Ostatnia Mila',
  'Terra Ekspres', 'Grawitacja S.A.', 'Cichy Fracht', 'Żelazna Linia'
];

/**
 * Trzy szczeble rynku. Udziały dobrane tak, żeby większość TONAŻU wozili duzi
 * (bo mają duże jednostki i nie stoją), ale większość FIRM była mała — inaczej
 * pusty powrót przestaje być wyborem, bo wszystkich na niego stać.
 */
const TIERS = Object.freeze([
  // Tylko duzi operatorzy mają jednostki ciężkie: megafrachtowiec to kapitał,
  // na który mała firma nigdy nie uzbiera. Stąd bierze się to, że największe
  // stanowiska w dokach należą de facto do kilku przewoźników.
  {
    policy: COMPANY_POLICY.AGGRESSIVE, share: 0.18, capitalPerShip: 26_000,
    classes: ['bulk', 'heavy', 'hauler', 'bulk', 'mega']
  },
  {
    policy: COMPANY_POLICY.BALANCED, share: 0.46, capitalPerShip: 6_000,
    classes: ['hauler', 'hauler', 'van', 'bulk']
  },
  {
    policy: COMPANY_POLICY.FRUGAL, share: 0.36, capitalPerShip: 1_800,
    classes: ['van', 'van', 'hauler']
  }
]);

/** Ile jednostek trzeba na jednostkę skali gospodarki. Zmierzone symulacją. */
export const SHIPS_PER_SCALE = 60;

/**
 * Ile ton na godzinę obsługuje jedna jednostka floty.
 *
 * Skalibrowane na aktualnej gospodarce z czasem załadunku, manewrami i pustymi
 * powrotami. Stare 117.5 t/h liczyło niemal samą nominalną ładownię; pomiar
 * 3-godzinny dawał przez to Ziemi tylko 58.9 tys. Fe/h przy popycie 79.6 tys.
 * Po kalibracji do 78 t/h dostawy Fe/Si pozostają dodatnie, a aktywne kursy
 * zachowują zapas do limitu i nie tworzą kolejki przy Ziemi.
 *
 * Istnieje po to, żeby flota rosła RAZEM z gospodarką. Stała liczba statków
 * oznaczała, że dołożenie stacji cicho zapycha transport: ruch rósł o 24%,
 * flota o 0%, a skuteczność spadała do 42% przy 1476 odmowach z braku
 * jednostki — i wyglądało to na błąd przemysłu, którym nie było.
 */
export const TONS_PER_SHIP_HOUR = 70;

/** Ilu jednostek potrzebuje układ, który musi przewieźć `tonsPerHour` ton. */
export function fleetSizeForDemand(tonsPerHour, economyScale = 1) {
  const scale = Math.max(0.1, Number(economyScale) || 1);
  return Math.max(8, Math.round((Number(tonsPerHour) || 0) / TONS_PER_SHIP_HOUR * scale));
}

/**
 * Buduje cały rynek przewoźników i wstawia go do rejestru.
 *
 * `ports` to lista czynnych stacji — floty rozstawiamy po całym układzie,
 * a nie w portach macierzystych, bo inaczej pierwsze pół godziny symulacji
 * to wyłącznie puste przeloty do miejsc, gdzie faktycznie jest ładunek.
 */
export function buildCarriers(registry, ports, economyScale = 1, options = {}) {
  const activePorts = Array.isArray(ports) && ports.length ? ports : ['earth'];
  // Przewoźnik należy do frakcji swojego portu macierzystego. Bez tego kursy
  // mają `factionId: null`, a wtedy opłata od handlu nie ma komu wpłynąć —
  // i patrole nigdy nie powstają mimo setek przechwytów.
  const factionOf = typeof options.factionOf === 'function' ? options.factionOf : () => null;
  const scale = Math.max(0.1, Number(economyScale) || 1);
  const totalShips = Math.max(8, Math.round((options.shipsPerScale ?? SHIPS_PER_SCALE) * scale));
  // Więcej gospodarki to więcej graczy na rynku, ale nie liniowo — duzi rosną
  // szybciej, niż przybywa nowych firm.
  const companyCount = Math.min(NAMES.length, Math.max(4, Math.round(4 + Math.sqrt(scale) * 3)));

  const companies = [];
  let shipsLeft = totalShips;
  let nameIndex = 0;
  let portIndex = 0;

  for (let tierIndex = 0; tierIndex < TIERS.length; tierIndex++) {
    const tier = TIERS[tierIndex];
    const tierCompanies = Math.max(1, Math.round(companyCount * tier.share));
    const tierShips = tierIndex === TIERS.length - 1
      ? shipsLeft
      : Math.round(totalShips * tier.share);
    const perCompany = Math.max(1, Math.floor(tierShips / tierCompanies));

    for (let i = 0; i < tierCompanies && shipsLeft > 0; i++) {
      const fleetSize = Math.min(shipsLeft, i === tierCompanies - 1 ? Math.max(perCompany, 1) : perCompany);
      const home = activePorts[nameIndex % activePorts.length];
      const company = createCompany({
        name: NAMES[nameIndex % NAMES.length],
        policy: tier.policy,
        factionId: factionOf(home),
        // Kapitał proporcjonalny do floty: duży operator ma z czego opłacić
        // pusty powrót, mały nie — i to jest cała różnica między nimi.
        capital: fleetSize * tier.capitalPerShip,
        homeStationId: home
      });
      nameIndex++;

      for (let s = 0; s < fleetSize; s++) {
        addShip(company, {
          vanClassId: tier.classes[s % tier.classes.length],
          stationId: s < 2 ? home : activePorts[portIndex++ % activePorts.length],
          parkingSlot: s
        });
      }
      registerCompany(registry, company);
      companies.push(company);
      shipsLeft -= fleetSize;
    }
  }

  return { companies, ships: totalShips - Math.max(0, shipsLeft) };
}
