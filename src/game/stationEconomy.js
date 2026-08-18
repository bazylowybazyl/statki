/**
 * PRODUKCJA STACJI — silnik, który sprawia, że surowiec ma dokąd trafić.
 *
 * Do tej pory magazyny stacji tylko stały: ceny reagowały na zapas, ale nic go
 * nie zużywało ani nie wytwarzało. Ten moduł domyka pętlę — każda stacja
 * wydobywa (jeśli jej planeta ma co dać), przetwarza wg receptur z resources.js
 * i konsumuje na potrzeby bytowe.
 *
 * Z tego samo wynika, czego stacji BRAKUJE i czego ma NADMIAR — a to jest
 * wejście dla vanów towarowych i tras handlowych. Nie ma osobnej „tabeli
 * handlu": trasy są konsekwencją tego, co się tu nie bilansuje.
 *
 * Moduł jest czystą logiką — operuje na obiektach stanu, nie dotyka DOM-u
 * ani Three.js.
 */

import { RECIPES, RESOURCES, PLANET_YIELD, rollPlanetYield, getResourceMass } from '../data/resources.js';
import { normalizeFaction, isDerelict, getFaction, getFactionPriceMultiplier } from '../data/factions.js';

// ============================================================
// Profile przemysłowe
// ============================================================

/** Długość cyklu ekonomicznego w sekundach gry. */
export const ECONOMY_CYCLE_SECONDS = 20;

/**
 * Zużycie bytowe — załoga i mieszkańcy potrzebują tego stale, niezależnie od
 * produkcji. To jest ta część popytu, która NIE znika, gdy zakłady stoją,
 * więc stacja odcięta od dostaw powoli się dusi.
 */
export const STATION_UPKEEP = Object.freeze({
  // Skalibrowane symulacją: łączne zużycie ośmiu stacji musi mieścić się
  // wyraźnie poniżej mocy wytwórczej, inaczej układ dusi się bez względu na to,
  // jak sprawny jest transport. Pierwsza wersja (0.6/0.25/0.35) dawała popyt
  // ~1.5x większy od produkcji i cała ekonomia zamierała.
  oxygen: 0.2,
  polymer: 0.12,
  fusion_fuel: 0.05,
  // Stal na remonty konstrukcji. To jest ta pozycja, która wiąże olbrzymy
  // gazowe z rdzeniem przemysłowym: same jej nie wytapiają, bo nie mają rudy.
  // Bez niej Saturn stawał się samowystarczalny i wypadał z gospodarki.
  steel: 0.15
});

/**
 * Pobór podzespołów przez stocznie — popyt, którego NIE MA w grafie receptur.
 *
 * Bez tej pozycji solver widzi tylko wewnętrzne zużycie stacji i wychodzi mu,
 * że płyty kadłuba warto w całości przerobić na silniki i uzbrojenie. Zmierzone:
 * eksport netto płyt spadał wtedy do 19 szt./h na cały układ, a stocznie pięciu
 * frakcji, które płyt nie robią, stały na zerze — czyli dokładnie ta zależność
 * od jednego producenta, którą archetypy miały usunąć.
 *
 * Proporcje wzięte z kosztu okrętu (płyt idzie najwięcej), skala celowo mała:
 * to stały pobór na utrzymanie floty, nie kampania zbrojeniowa.
 */
export const FLEET_DEMAND = Object.freeze({
  hull_plate: 0.070,
  avionics: 0.028,
  thruster: 0.021,
  weapon_mount: 0.021,
  reactor_core: 0.014,
  life_support: 0.014
});

/** Popyt, który każda stacja generuje samym istnieniem: byt + utrzymanie floty. */
const SYSTEM_DEMAND = Object.freeze({ ...STATION_UPKEEP, ...FLEET_DEMAND });

/** Ile jednostek surowca daje jeden cykl wydobywczy przy `rate` = 1.0. */
const EXTRACTION_PER_CYCLE = 9;

/**
 * ARCHETYPY PRZEMYSŁOWE — role, nie listy receptur.
 *
 * Wcześniej każda stacja miała ręcznie wypisany zestaw receptur. Działało dla
 * siedmiu planet i nie działało dla niczego więcej: nowa stacja albo nowa
 * frakcja wymagała dopisania profilu z palca, a rozkład receptur był
 * przypadkowy. Pomiar pokazał tego skutek — **trzy z czterech podzespołów
 * każdego okrętu robił wyłącznie Mars**, więc tylko on mógł budować flotę,
 * a jego utrata kończyłaby budowę okrętów w całym układzie na zawsze.
 *
 * Archetyp to spójna rola przemysłowa: huta topi metale, elektronika robi
 * układy i optykę, stocznia składa kadłuby i napędy. Stacja wybiera role,
 * a nie pojedyncze receptury — dzięki temu **nowa stacja od razu działa**,
 * a jej zdolności są czytelne bez zaglądania do tabeli receptur.
 *
 * Wąskie gardła, które ZOSTAJĄ jednoźródłowe, bo są treścią: ruda uranu
 * (tylko pas Kuipera) i złom (tylko wraki). Reszta ma mieć zapas.
 */
export const INDUSTRY_ARCHETYPES = Object.freeze({
  /** Huta: ruda → metal. Podstawa każdego okręgu przemysłowego. */
  foundry: { label: 'Huta', recipes: ['smelt_steel', 'alloy_titanium', 'draw_copper_wire'],
    capacity: 0.9, cost: { steel: 60, hull_plate: 14 } },
  /** Elektronika: krzem i kryształ → układy i optyka. */
  electronics: { label: 'Elektronika', recipes: ['etch_chips', 'grind_optics'],
    capacity: 0.7, cost: { steel: 40, hull_plate: 10, chips: 8 } },
  /** Lotne: lód → tlen i wodór, amoniak → chłodziwo. Byt i chłodzenie. */
  volatiles: { label: 'Zakłady lotne', recipes: ['electrolyse_ice', 'synth_coolant'],
    capacity: 0.7, cost: { steel: 35, hull_plate: 8 } },
  /** Gazownia: metan → polimer, hel-3 → paliwo fuzyjne. Domena olbrzymów. */
  gasworks: { label: 'Gazownia', recipes: ['crack_methane', 'compress_fusion_fuel'],
    capacity: 0.7, cost: { steel: 45, hull_plate: 10 } },
  /** Wzbogacalnia: ruda uranu → pręty paliwowe. */
  enrichment: { label: 'Wzbogacalnia', recipes: ['enrich_uranium'],
    capacity: 0.5, cost: { steel: 55, hull_plate: 16, reactor_core: 2 } },
  /** Stocznia: płyty, napędy, uzbrojenie — twarda część okrętu. */
  shipworks: { label: 'Stocznia', recipes: ['assemble_hull_plate', 'assemble_thruster', 'assemble_weapon_mount'],
    capacity: 1.1, cost: { steel: 120, hull_plate: 40, avionics: 10, thruster: 4 } },
  /** Systemy: awionika, reaktory, podtrzymywanie życia — miękka część okrętu. */
  systems: { label: 'Zakłady systemowe', recipes: ['assemble_avionics', 'assemble_reactor_core', 'assemble_life_support'],
    capacity: 1.0, cost: { steel: 90, hull_plate: 28, chips: 20, optic_lens: 8 } },
  /** Przetop złomu. Jedyna receptura o wsadzie w 100% z wraków. */
  recycling: { label: 'Przetop złomu', recipes: ['recycle_scrap'],
    capacity: 0.4, cost: { steel: 30, hull_plate: 6 } }
});

/**
 * Rozkłada moc stacji na linie tak, żeby wsad się domykał WEWNĄTRZ stacji.
 *
 * Równy podział mocy nie działa, bo receptury mają różną stechiometrię i różny
 * czas cyklu. Zmierzone: `shipworks` zjada 4 płyty kadłuba na jeden silnik
 * i jedno stanowisko uzbrojenia, a produkuje jedną — przy równym podziale
 * pokrycie popytu na płyty spadało do 44%, a na awionikę do 63%, bo montaż
 * uzbrojenia i podtrzymywania życia biją się o ten sam element.
 *
 * Graf receptur jest acykliczny (T0 → T1 → T2), więc wystarczy przepchnąć
 * popyt wstecz: linia produkująca półprodukt dostaje tyle mocy, ile trzeba,
 * żeby nakarmić linie, które z niego korzystają. Kilka przebiegów wystarcza
 * na całą głębokość łańcucha.
 *
 * Dzięki temu **archetypy da się dowolnie łączyć** — nowa kombinacja ról sama
 * ustawia sobie proporcje i nikt nie musi ich dostrajać z palca.
 */
export function balanceLines(recipeIds, externalDemand = null, baseline = null) {
  const ids = recipeIds.filter(id => RECIPES[id]);
  if (!ids.length) return new Map();

  // Ile partii na cykl robi każda linia. Bez podpowiedzi — wszystkie po równo.
  const batches = new Map(ids.map(id => [id, Math.max(1e-6, baseline?.get(id) ?? 1)]));
  // Ile linii w tym zestawie umie zrobić dany surowiec — popyt dzieli się
  // między nie, więc dublowanie receptury nie zawyża mocy dwukrotnie.
  const producers = new Map();
  for (const id of ids) {
    for (const [res, qty] of Object.entries(RECIPES[id].out)) {
      if (qty > 0) producers.set(res, (producers.get(res) || 0) + 1);
    }
  }

  for (let pass = 0; pass < 6; pass++) {
    // Popyt spoza stacji wchodzi na tych samych prawach co wewnętrzny.
    // Bez niego solver widzi tylko własne linie i głodzi to, czego stacja
    // sama nie zużywa: zmierzone — tlen spadał do 61%, a stal do 83%, bo
    // elektroliza i wytop przegrywały moc z liniami karmiącymi montaż.
    const demand = externalDemand ? new Map(externalDemand) : new Map();
    for (const id of ids) {
      const rate = batches.get(id);
      for (const [res, qty] of Object.entries(RECIPES[id].in)) {
        if (qty > 0) demand.set(res, (demand.get(res) || 0) + rate * qty);
      }
    }
    for (const id of ids) {
      let needed = batches.get(id);
      for (const [res, qty] of Object.entries(RECIPES[id].out)) {
        const wanted = demand.get(res) || 0;
        if (qty <= 0 || wanted <= 0) continue;
        needed = Math.max(needed, wanted / producers.get(res) / qty);
      }
      batches.set(id, needed);
    }
  }

  // Silnik liczy `batches = weight × (CYKL / seconds)`, więc żeby uzyskać
  // wyliczone tempo, moc linii musi być wprost proporcjonalna do jej długości.
  const weights = new Map();
  for (const id of ids) weights.set(id, batches.get(id) * RECIPES[id].seconds);
  return weights;
}

/**
 * Moc pojedynczej linii. JEDYNE poprawne źródło tej liczby — silnik produkcji,
 * test bilansu i skrypt pomiarowy muszą pytać tak samo, inaczej mierzą co
 * innego, niż działa.
 */
export function lineWeight(industry, recipeId) {
  if (!industry) return 0;
  if (industry.lines) return Math.max(0, industry.lines[recipeId] || 0);
  return Math.max(0, industry.weight || 0);
}

/** Wielkość osady — od niej zależy byt, nie od liczby linii produkcyjnych. */
export function upkeepScale(industry) {
  return Math.max(0.3, industry?.size ?? industry?.weight ?? 1);
}

/**
 * Składa profil przemysłowy z ról.
 *
 * `capacity` to CAŁKOWITA moc przerobowa stacji, nie moc jednej linii. To
 * różnica zasadnicza i to ona dopiero czyni archetypy używalnymi.
 *
 * Wcześniej `weight` mnożył każdą recepturę osobno, więc dopisanie stacji
 * kolejnej receptury nie zmieniało profilu — po prostu ją powiększało.
 * Zmierzone przy pierwszym podejściu do archetypów: rozdanie ról podniosło
 * produkcję na tyle, że wsad przestał nadążać i pokrycie popytu spadło do 35%
 * przy prętach paliwowych i 44% przy płytach kadłuba.
 *
 * Teraz stacja ma stałą moc i dzieli ją między linie. Rola decyduje **na co**
 * idzie moc, a nie **ile** jej jest. Dzięki temu dodanie roli nigdy nie psuje
 * bilansu układu — przesuwa produkcję, zamiast ją drukować.
 */
export function composeIndustry(capacity, archetypeIds, size = 1, externalDemand = null) {
  const recipes = [];
  const roles = [];
  for (const id of archetypeIds) {
    const archetype = INDUSTRY_ARCHETYPES[id];
    if (!archetype) continue;
    roles.push(id);
    for (const recipeId of archetype.recipes) {
      if (!recipes.includes(recipeId)) recipes.push(recipeId);
    }
  }
  // Moc rozkłada się według stechiometrii, a nie po równo, i sumuje się
  // do `capacity` — całkowita moc stacji nie zależy od liczby ról.
  // Solver porównuje popyt wewnętrzny z bytowym, a ten drugi jest podany
  // w sztukach na cykl — bezwzględnie. Skala linii wychodzi dopiero
  // z normalizacji do `capacity`, więc pierwszy przebieg zestawia ze sobą
  // liczby w różnych jednostkach i popyt bytowy ginie jako za mały.
  // Dlatego iterujemy: wynik normalizacji wraca jako punkt startowy, aż skala
  // przestaje się ruszać. Bez tego pokrycie popytu na tlen stało na 61%.
  const lines = {};
  let baseline = null;
  for (let iter = 0; iter < 5; iter++) {
    const solved = balanceLines(recipes, externalDemand, baseline);
    let total = 0;
    for (const value of solved.values()) total += value;
    for (const [id, value] of solved) lines[id] = total > 0 ? (capacity * value) / total : 0;
    baseline = new Map(recipes.map(id =>
      [id, (lines[id] * ECONOMY_CYCLE_SECONDS) / RECIPES[id].seconds]));
  }

  const weight = recipes.length ? capacity / recipes.length : 0;
  return Object.freeze({
    capacity,
    /** Moc każdej linii z osobna — tego używa silnik produkcji. */
    lines: Object.freeze(lines),
    // Załoga i kubatura — osobno od mocy przerobowej, bo to niezależne wymiary.
    // Merkury ma małą fabrykę i małą osadę, Ziemia ogromną fabrykę i osadę
    // tylko średnią. Byt liczy się od TEGO, nie od liczby linii produkcyjnych.
    size,
    weight,
    roles: Object.freeze(roles),
    recipes: Object.freeze(recipes)
  });
}


/**
 * Przemysł stacji — złożony z ról, nie wypisany recepturą po recepturze.
 *
 * `weight` skaluje przepustowość zakładu i ZOSTAJE bez zmian względem wersji
 * ręcznej, bo to on był kalibrowany. Zmienia się rozkład zdolności: każdy
 * kluczowy podzespół ma teraz co najmniej dwa źródła.
 *
 * Ziemia i Konsorcjum Zewnętrzne dostają role okrętowe świadomie — bez tego
 * zniszczenie Marsa kończyłoby budowę floty w całym układzie, a wojna, o którą
 * chodzi, byłaby rozstrzygnięta pierwszym uderzeniem w jedną stację.
 */

/**
 * Buduje mapę przemysłu z deklaracji ról — DWUPRZEBIEGOWO.
 *
 * Przebieg pierwszy składa stacje, żeby wiedzieć, ile ich jest i która co umie.
 * Dopiero wtedy da się policzyć popyt bytowy CAŁEGO układu i rozdzielić go
 * między stacje, które potrafią go pokryć. Przebieg drugi składa je ponownie,
 * już z tą wiedzą.
 *
 * To jest wejście dla wszystkiego, co dojdzie później: nowa stacja, nowa
 * frakcja, przyczółek w pasie. Deklarujesz `{ capacity, roles, size }`,
 * a proporcje linii i udział w utrzymaniu układu wyliczają się same.
 */
export function buildIndustryMap(spec) {
  const entries = Object.entries(spec);
  // Popyt zewnętrzny NARASTA między przebiegami. Liczony od zera znika, gdy
  // tylko stacja zareaguje, więc solver oscylował zamiast zbiegać: pokrycie
  // tlenu skakało między 74% a 99%. Kumulacja działa jak relaksacja — dokłada
  // tyle, ile jeszcze brakuje, i zatrzymuje się, gdy nie brakuje nic.
  const external = new Map();
  let map = entries.map(([id, def]) => [id, composeIndustry(def.capacity, def.roles, def.size)]);

  // Kolejne przebiegi domykają bilans MIĘDZY stacjami. Solver pojedynczej
  // stacji widzi tylko własne linie, więc Saturn nie ma skąd wiedzieć, że
  // Ziemia czeka na jego pręty paliwowe, a olbrzymy gazowe — że cały układ
  // oddycha ich tlenem. Deficyt policzony globalnie wraca do producentów
  // jako popyt zewnętrzny i podnosi im właściwe linie.
  for (let pass = 0; pass < 12; pass++) {
    const supply = new Map();
    const demand = new Map();
    const producers = new Map();
    const bump = (target, res, amount) => target.set(res, (target.get(res) || 0) + amount);

    for (const [id, industry] of map) {
      if (!industry.capacity) continue;
      const planet = PLANET_YIELD[id];
      if (planet?.rate > 0) {
        const total = EXTRACTION_PER_CYCLE * planet.rate;
        for (const [res, share] of Object.entries(planet.yields)) bump(supply, res, total * share);
      }
      for (const recipeId of industry.recipes) {
        const recipe = RECIPES[recipeId];
        const batches = lineWeight(industry, recipeId) * (ECONOMY_CYCLE_SECONDS / recipe.seconds);
        for (const [res, need] of Object.entries(recipe.in)) bump(demand, res, need * batches);
        for (const [res, out] of Object.entries(recipe.out)) {
          bump(supply, res, out * batches);
          if (out > 0) bump(producers, res, 1);
        }
      }
      for (const [res, perCycle] of Object.entries(SYSTEM_DEMAND)) {
        bump(demand, res, perCycle * upkeepScale(industry));
      }
    }

    // Ile każdemu producentowi dołożyć, żeby domknąć niedobór. Zapas 8% na
    // straty w transporcie — towar, który nie dojechał, i tak jest zużyty.
    const shortfall = new Map();
    for (const [res, needed] of demand) {
      const count = producers.get(res) || 0;
      if (!count) continue; // ruda uranu i złom przychodzą ze świata, nie z linii
      const missing = needed * 1.08 - (supply.get(res) || 0);
      if (missing > 0) shortfall.set(res, missing / count);
    }
    if (!shortfall.size) break;

    for (const [res, missing] of shortfall) {
      external.set(res, (external.get(res) || 0) + missing);
    }
    map = entries.map(([id, def]) =>
      [id, composeIndustry(def.capacity, def.roles, def.size, external)]);
  }

  return Object.freeze(Object.fromEntries(map));
}



/**
 * Deklaracja przemysłu układu — jedyne miejsce, gdzie stacja mówi, KIM jest.
 * `capacity` to moc przerobowa, `roles` to archetypy, `size` to wielkość osady.
 * Proporcje linii i udział w utrzymaniu układu wylicza `buildIndustryMap`.
 */
export const SYSTEM_INDUSTRY_SPEC = Object.freeze({
  // Kopalnia z hutą. Najbogatsze złoża tytanu, więc przerabia je u siebie.
  mercury: { capacity: 1.1, roles: ['foundry'], size: 0.8 },
  // Krzem i kryształ — stąd elektronika dla obu ośrodków montażowych.
  venus: { capacity: 5.0, roles: ['foundry', 'electronics'], size: 1.1 },
  // Rdzeń przemysłowy. Nic nie wydobywa, żyje z przerobu i montażu.
  // Role okrętowe dają mu redundancję wobec Marsa.
  earth: { capacity: 17.6, roles: ['foundry', 'electronics', 'shipworks', 'systems'], size: 2.2 },
  // Druga stocznia układu. Jedyne miejsce przetopu złomu — tam trafiają wraki.
  mars: { capacity: 14.4, roles: ['foundry', 'electronics', 'shipworks', 'systems', 'recycling'], size: 1.6 },
  // Olbrzymy gazowe: paliwo, chłodziwo i byt dla całego układu zewnętrznego.
  // Stocznia Konsorcjum Zewnętrznego. Jowisz nie ma ani grama metalu, więc
  // stal, stop tytanu, układy, przewód i optykę musi ŚCIĄGNĄĆ z rdzenia —
  // i to jest sedno: zbrojenie olbrzymów gazowych tworzy najdłuższą trasę
  // towarową w układzie, dokładnie tam, gdzie warto stawiać piratów.
  jupiter: { capacity: 9.5, roles: ['gasworks', 'volatiles', 'shipworks', 'systems'], size: 1.3 },
  // Saturn i Uran wzbogacają uran — dwa osrodki zamiast jednego, bo pręty
  // paliwowe są wąskim gardłem stoczni.
  saturn: { capacity: 6.4, roles: ['gasworks', 'volatiles', 'enrichment'], size: 1.1 },
  uranus: { capacity: 3.4, roles: ['gasworks', 'volatiles', 'enrichment'], size: 0.9 },
  // Opuszczony — brak załogi, brak produkcji.
  neptune: { capacity: 0, roles: [], size: 0 },

  // LIGA PASA. Nie przyczółki — ośrodki wykute w planetoidach, z własnym
  // złożem (patrz PLANET_YIELD). Ceres składa okręty, Westa jest jej hutą.
  // Jako jedyna frakcja ma metal i stocznię w tym samym miejscu, więc jest
  // najodporniejsza na blokadę, ale brakuje jej lotnych i paliwa.
  ceres: { capacity: 7.0, roles: ['foundry', 'electronics', 'shipworks', 'systems'], size: 1.0 },
  vesta: { capacity: 2.0, roles: ['foundry'], size: 0.4 }
});

export const STATION_INDUSTRY = buildIndustryMap(SYSTEM_INDUSTRY_SPEC);

/**
 * Ile ton na godzinę MUSI się przemieścić, żeby ten układ działał.
 *
 * Liczone z deklaracji przemysłu: dla każdej stacji sumujemy niedobory, bo
 * dokładnie tyle trzeba jej przywieźć. Nadwyżki pomijamy — to ta sama masa
 * widziana z drugiej strony.
 *
 * Istnieje po to, żeby wielkość floty transportowej BRAŁA SIĘ z gospodarki,
 * a nie ze stałej. Zmierzone: dołożenie stoczni Jowisza i Ligi Pasa podniosło
 * wymagany tonaż o 39%, flota została ta sama i skuteczność dostaw spadła
 * z 58% do 42% przy 1476 odmowach z braku jednostki.
 */
/**
 * Przemysł stacji złożony z POSTAWIONYCH BUDYNKÓW — dla stacji gracza.
 *
 * `SYSTEM_INDUSTRY_SPEC` opisuje świat, który istnieje od początku: deklarujesz
 * docelową moc i role, a solver rozdziela je globalnie. Stacja gracza rośnie
 * inaczej — jeden budynek naraz, bez z góry znanego celu i bez prawa do tego,
 * żeby cały układ przestawiał się pod nią po każdej hucie.
 *
 * Dlatego bilansuje się TYLKO wewnętrznie (`externalDemand` domyślnie pusty).
 * Nowy przyczółek nie jest powodem, żeby Saturn zmieniał plan produkcji.
 *
 * `buildings` to lista archetypów — powtórzenia są dozwolone i tak właśnie
 * rośnie moc: druga huta to dwa razy więcej wytopu, nie nowa rola.
 *
 *   composeFromBuildings(['foundry', 'foundry', 'shipworks'], 0.5)
 */
export function composeFromBuildings(buildings, size = 0.2, externalDemand = null) {
  const roles = [];
  let capacity = 0;
  for (const entry of buildings || []) {
    const roleId = typeof entry === 'string' ? entry : entry?.role;
    const archetype = INDUSTRY_ARCHETYPES[roleId];
    if (!archetype) continue;
    roles.push(roleId);
    capacity += Number(entry?.capacity) || archetype.capacity || 0.5;
  }
  const industry = composeIndustry(capacity, roles, size, externalDemand);
  // Zapamiętujemy, co faktycznie stoi — inaczej nie da się nic rozebrać ani
  // pokazać graczowi, z czego jego zakład się składa. `roles` gubi powtórzenia.
  return Object.freeze({ ...industry, buildings: Object.freeze([...roles]) });
}

/**
 * Dokłada budynek do istniejącej stacji i przelicza jej linie.
 *
 * Zwraca nowy profil — stary zostaje nietknięty, bo `composeIndustry` mrozi
 * wynik. Wywołujący podmienia `station.industry`, którego `getStationIndustry`
 * używa przed tabelą świata.
 */
export function addStationBuilding(station, roleId, size = null) {
  if (!INDUSTRY_ARCHETYPES[roleId]) return null;
  const current = station?.industry;
  const buildings = [...(current?.buildings || []), roleId];
  return composeFromBuildings(buildings, size ?? current?.size ?? 0.2);
}

/** Czy stację stać na postawienie budynku i ile to kosztuje. */
export function buildingCost(roleId) {
  return INDUSTRY_ARCHETYPES[roleId]?.cost || null;
}

/**
 * Ile ton na godzinę przechodzi przez KAŻDĄ stację — i w tę, i we w tę.
 *
 * Port obsługuje jedno i drugie tym samym stanowiskiem, więc o jego wielkości
 * decyduje suma, nie samo zapotrzebowanie. Istnieje, bo stanowiska liczyły się
 * wcześniej od `size`, czyli od WIELKOŚCI OSADY — a to zupełnie inny wymiar:
 * Merkury to mała kolonia z ogromną kopalnią. Zmierzone przed poprawką:
 *
 *   mercury  2952 t/h przez mnożnik 1   ← największy przeładunek, najmniejszy port
 *   jupiter   917 t/h przez mnożnik 2   ← trzy razy mniej ruchu, port dwa razy większy
 *
 * Skutkiem był korek u eksporterów: megafrachtowce stały na redzie Merkurego
 * i Wenus czekając na stanowisko, Ziemia nie dostawała rudy i zerowała się,
 * a Jowisz i Mars prosperowały na pustych nabrzeżach.
 */
export function stationHaulTonnage(industryMap = STATION_INDUSTRY) {
  const cyclesPerHour = 3600 / ECONOMY_CYCLE_SECONDS;
  const netto = {};

  for (const [id, industry] of Object.entries(industryMap)) {
    if (!industry.capacity) continue;
    const local = {};
    const add = (res, amount) => { local[res] = (local[res] || 0) + amount; };

    const planet = PLANET_YIELD[id];
    if (planet?.rate > 0) {
      const total = EXTRACTION_PER_CYCLE * planet.rate;
      for (const [res, share] of Object.entries(planet.yields)) add(res, total * share);
    }
    for (const recipeId of industry.recipes) {
      const recipe = RECIPES[recipeId];
      const batches = lineWeight(industry, recipeId) * (ECONOMY_CYCLE_SECONDS / recipe.seconds);
      for (const [res, need] of Object.entries(recipe.in)) add(res, -need * batches);
      for (const [res, produced] of Object.entries(recipe.out)) add(res, produced * batches);
    }
    for (const [res, perCycle] of Object.entries(SYSTEM_DEMAND)) {
      add(res, -perCycle * upkeepScale(industry));
    }
    netto[id] = local;
  }

  // Przejeżdża tylko tyle, ile da się DOPASOWAĆ: nadwyżka bez odbiorcy nigdzie
  // nie jedzie i nie obciąża nabrzeża. Bez tego kroku Mars — który produkuje
  // dużo na własny użytek i eksportuje mało — wychodził niemal równy Merkuremu,
  // choć jego realny przeładunek jest sześć razy mniejszy.
  const podaz = {};
  const popyt = {};
  for (const local of Object.values(netto)) {
    for (const [res, net] of Object.entries(local)) {
      if (net > 0) podaz[res] = (podaz[res] || 0) + net;
      else popyt[res] = (popyt[res] || 0) - net;
    }
  }

  const out = {};
  for (const id of Object.keys(industryMap)) out[id] = 0;
  for (const [id, local] of Object.entries(netto)) {
    let tons = 0;
    for (const [res, net] of Object.entries(local)) {
      const s = podaz[res] || 0;
      const d = popyt[res] || 0;
      const handel = Math.min(s, d);
      if (handel <= 0) continue;
      const udzial = net > 0 ? (net / s) * handel : (-net / d) * handel;
      tons += getResourceMass(res, udzial * cyclesPerHour);
    }
    out[id] = tons;
  }
  return out;
}

export function systemHaulTonnage(industryMap = STATION_INDUSTRY) {
  const perCycle = {};
  const bump = (id, amount) => { perCycle[id] = (perCycle[id] || 0) + amount; };

  for (const [id, industry] of Object.entries(industryMap)) {
    if (!industry.capacity) continue;
    const local = {};
    const add = (res, amount) => { local[res] = (local[res] || 0) + amount; };

    const planet = PLANET_YIELD[id];
    if (planet?.rate > 0) {
      const total = EXTRACTION_PER_CYCLE * planet.rate;
      for (const [res, share] of Object.entries(planet.yields)) add(res, total * share);
    }
    for (const recipeId of industry.recipes) {
      const recipe = RECIPES[recipeId];
      const batches = lineWeight(industry, recipeId) * (ECONOMY_CYCLE_SECONDS / recipe.seconds);
      for (const [res, need] of Object.entries(recipe.in)) add(res, -need * batches);
      for (const [res, out] of Object.entries(recipe.out)) add(res, out * batches);
    }
    for (const [res, perCycleUse] of Object.entries(SYSTEM_DEMAND)) {
      add(res, -perCycleUse * upkeepScale(industry));
    }
    for (const [res, net] of Object.entries(local)) {
      if (net < 0) bump(res, -net);
    }
  }

  const cyclesPerHour = 3600 / ECONOMY_CYCLE_SECONDS;
  let tons = 0;
  for (const [res, amount] of Object.entries(perCycle)) {
    tons += getResourceMass(res, amount * cyclesPerHour);
  }
  return tons;
}





/**
 * Zapas, poniżej którego stacja zgłasza niedobór, i powyżej którego oddaje
 * nadwyżkę. Rozstęp między progami jest celowy — bez niego stacja
 * oscylowałaby między „chcę" a „oddaję" przy każdym cyklu.
 */
const DEFICIT_FILL = 0.25;
const SURPLUS_FILL = 0.7;

// ============================================================
// Stan
// ============================================================

function stationKey(station) {
  return String(station?.id || station?.name || '').toLowerCase();
}

/**
 * Profil przemysłowy stacji.
 *
 * Stacja może NIEŚĆ WŁASNY profil w polu `industry` — wtedy on wygrywa. Dzięki
 * temu bazy spoza tabeli planet (osady w asteroidach, przyczółki pirackie,
 * stocznie frakcyjne) opisują się same, a `STATION_INDUSTRY` — skalibrowane
 * symulacją i wrażliwe na każdą zmianę udziału — zostaje nietknięte.
 */
export function getStationIndustry(station) {
  if (station?.industry?.recipes) return station.industry;
  return STATION_INDUSTRY[stationKey(station)] || null;
}

/**
 * Planowane saldo zasobów stacji przy skali ekonomii 1, w jednostkach/s.
 *
 * To jest plan nominalny, a nie pomiar bieżącej produkcji: zakłada pełne
 * wykorzystanie wszystkich linii niezależnie od stanu magazynu i dostępności
 * wsadu. Wartość dodatnia oznacza nadwyżkę, ujemna — stały popyt, który
 * logistyka musi pokryć. `SYSTEM_DEMAND` obejmuje zarówno byt stacji, jak i
 * utrzymanie floty.
 *
 * @param {object} station stacja z `id`/`planet.id` i opcjonalnym profilem `industry`
 * @returns {Record<string, number>} saldo zasobu na sekundę przy economy scale = 1
 */
export function stationNetRates(station) {
  const industry = getStationIndustry(station);
  const net = {};
  const add = (id, amount) => { net[id] = (net[id] || 0) + amount; };

  const planetId = String(station?.planet?.id || stationKey(station)).toLowerCase();
  const planet = PLANET_YIELD[planetId];
  if (planet?.rate > 0) {
    const totalPerSecond = (EXTRACTION_PER_CYCLE * planet.rate) / ECONOMY_CYCLE_SECONDS;
    for (const [id, share] of Object.entries(planet.yields)) {
      add(id, totalPerSecond * share);
    }
  }

  for (const recipeId of industry?.recipes || []) {
    const recipe = RECIPES[recipeId];
    if (!recipe) continue;
    const batchesPerSecond = lineWeight(industry, recipeId) / recipe.seconds;
    for (const [id, need] of Object.entries(recipe.in)) add(id, -need * batchesPerSecond);
    for (const [id, produced] of Object.entries(recipe.out)) add(id, produced * batchesPerSecond);
  }

  const demandScale = upkeepScale(industry) / ECONOMY_CYCLE_SECONDS;
  for (const [id, perCycle] of Object.entries(SYSTEM_DEMAND)) {
    add(id, -perCycle * demandScale);
  }

  return net;
}

function amountOf(econ, id) {
  return Number(econ?.resources?.[id]) || 0;
}

function capacityOf(econ, id) {
  const cap = Number(econ?.capacity?.[id]);
  return Number.isFinite(cap) && cap > 0 ? cap : 0;
}

function addResource(econ, id, amount) {
  if (!RESOURCES[id] || !(amount > 0)) return 0;
  const cap = capacityOf(econ, id);
  const current = amountOf(econ, id);
  const next = cap > 0 ? Math.min(cap, current + amount) : current + amount;
  econ.resources[id] = next;
  return next - current;
}

function takeResource(econ, id, amount) {
  const current = amountOf(econ, id);
  const taken = Math.min(current, Math.max(0, amount));
  econ.resources[id] = current - taken;
  return taken;
}

// ============================================================
// Kroki cyklu
// ============================================================

/** Wydobycie z planety, na której orbicie stoi stacja. */
function runExtraction(station, econ, cycles, rng) {
  const planetId = String(station?.planet?.id || station?.id || '').toLowerCase();
  const entry = PLANET_YIELD[planetId];
  if (!entry || !(entry.rate > 0)) return;

  const total = EXTRACTION_PER_CYCLE * entry.rate * cycles;
  // Losujemy typ na każdy cykl osobno, żeby rozkład wag miał znaczenie —
  // jeden los na całą porcję dawałby skokowe, nierealistyczne dostawy.
  const draws = Math.max(1, Math.round(cycles));
  const perDraw = total / draws;
  for (let i = 0; i < draws; i++) {
    const id = rollPlanetYield(planetId, rng);
    if (id) addResource(econ, id, perDraw);
  }
}

/**
 * Uruchamia receptury zakładu. Każda idzie tylko wtedy, gdy starcza wejść
 * I jest miejsce na wyjście — inaczej zakład zjadałby surowiec w próżnię.
 */
function runRecipes(station, econ, cycles) {
  const industry = getStationIndustry(station);
  if (!industry || !industry.recipes.length) return;

  // Profil z archetypów zna moc każdej linii osobno. Profil dopisany ręcznie
  // (np. przez mod albo test) podaje samo `weight` — wtedy wszystkie linie
  // dostają tyle samo, tak jak działało to wcześniej.
  for (const recipeId of industry.recipes) {
    const recipe = RECIPES[recipeId];
    if (!recipe) continue;

    const throughput = lineWeight(industry, recipeId) * cycles;
    if (throughput <= 0) continue;

    // Ile pełnych partii da się odpalić w tym oknie czasu.
    const batchesByTime = throughput * (ECONOMY_CYCLE_SECONDS / recipe.seconds);
    let batches = batchesByTime;

    for (const [id, need] of Object.entries(recipe.in)) {
      if (need <= 0) continue;
      batches = Math.min(batches, amountOf(econ, id) / need);
    }

    // Zakład staje dopiero wtedy, gdy WSZYSTKIE wyjścia są pełne. Nadmiar
    // pojedynczego produktu jest upuszczany (addResource i tak tnie do
    // pojemności), bo instalacja odpuszcza nadwyżkę zamiast się wyłączać.
    //
    // Bez tego elektroliza lodu zatrzymywała się, gdy zapełnił się zbiornik
    // wodoru — a razem z nią znikała produkcja TLENU, od którego zależy byt
    // całego układu. Jedno wspólne wyjście blokowało drugie.
    let anyRoom = false;
    for (const [id, produced] of Object.entries(recipe.out)) {
      if (produced <= 0) continue;
      const cap = capacityOf(econ, id);
      if (cap <= 0 || amountOf(econ, id) < cap - 1e-6) { anyRoom = true; break; }
    }
    if (!anyRoom) continue;
    if (!(batches > 0.001)) continue;

    for (const [id, need] of Object.entries(recipe.in)) takeResource(econ, id, need * batches);
    for (const [id, produced] of Object.entries(recipe.out)) addResource(econ, id, produced * batches);
  }
}

/** Zużycie bytowe — niezależne od produkcji. */
function runLifeSupport(station, econ, cycles) {
  const industry = getStationIndustry(station);
  // Byt zależy od WIELKOŚCI OSADY, nie od mocy fabryki ani liczby linii.
  // `size` jest osobnym wymiarem właśnie po to: stacja może dostać kolejną
  // rolę przemysłową i nie zacząć nagle oddychać dwa razy szybciej.
  const scale = upkeepScale(industry) * cycles;
  for (const [id, perCycle] of Object.entries(STATION_UPKEEP)) {
    takeResource(econ, id, perCycle * scale);
  }
}

// ============================================================
// API
// ============================================================

/**
 * Jeden przebieg ekonomii stacji. `econ` to obiekt magazynu
 * ({ resources, capacity }), ten sam, którym karmi się handel i ceny.
 *
 * Opuszczone stacje pomija — nie mają kto obsługiwać zakładów. Zostaje im
 * tylko to, co zostało w magazynach.
 */
export function runStationEconomy(station, econ, cycles = 1, rng = Math.random) {
  if (!station || !econ || !econ.resources || isDerelict(station)) return false;
  const runs = Math.max(0, Number(cycles) || 0);
  if (runs <= 0) return false;

  runExtraction(station, econ, runs, rng);
  runRecipes(station, econ, runs);
  runLifeSupport(station, econ, runs);
  return true;
}

/**
 * Zapas początkowy. Stacja, która działa od lat, nie ma pustych magazynów —
 * a start od zera tworzy sztuczny kryzys: producent wypuszcza nadwyżkę dopiero
 * po przekroczeniu progu zapełnienia, więc przez pierwsze setki cykli nikt nic
 * nie dostaje i cały układ głoduje mimo wystarczającej mocy wytwórczej.
 *
 * Napełniamy tylko to, co stacja realnie obraca — nie ma powodu, żeby kopalnia
 * na Merkurym trzymała rdzenie reaktorów.
 */
export function seedStationStock(station, econ, fill = 0.45) {
  if (!station || !econ?.resources || isDerelict(station)) return;
  const relevant = new Set(getStationOutputs(station));
  for (const id of Object.keys(RESOURCES)) {
    if (!relevant.has(id) && !stationWantsResource(station, id)) continue;
    const cap = capacityOf(econ, id);
    if (cap <= 0) continue;
    econ.resources[id] = Math.max(amountOf(econ, id), cap * fill);
  }
}

/**
 * Czego stacji brakuje — posortowane od najpilniejszego.
 * To jest wejście dla tras vanów: van leci tam, gdzie zapas jest najniżej.
 */
export function getStationDeficits(station, econ, limit = 6) {
  if (!econ?.resources) return [];
  const out = [];
  for (const [id, def] of Object.entries(RESOURCES)) {
    const cap = capacityOf(econ, id);
    if (cap <= 0) continue;
    if (!stationWantsResource(station, id)) continue;
    const fill = amountOf(econ, id) / cap;
    if (fill >= DEFICIT_FILL) continue;
    out.push({ id, fill, missing: Math.round(cap * DEFICIT_FILL - amountOf(econ, id)), value: def.value });
  }
  out.sort((a, b) => a.fill - b.fill);
  return out.slice(0, limit);
}

/** Co stacja może oddać bez szkody dla własnej produkcji. */
export function getStationSurpluses(station, econ, limit = 6) {
  if (!econ?.resources) return [];
  const out = [];
  for (const [id, def] of Object.entries(RESOURCES)) {
    const cap = capacityOf(econ, id);
    if (cap <= 0) continue;
    const amount = amountOf(econ, id);
    const fill = amount / cap;
    if (fill <= SURPLUS_FILL) continue;
    // Oddajemy tylko to, co ponad progiem — reszta to zapas roboczy.
    out.push({ id, fill, spare: Math.round(amount - cap * SURPLUS_FILL), value: def.value });
  }
  out.sort((a, b) => b.fill - a.fill);
  return out.slice(0, limit);
}

/**
 * Czy stacja w ogóle chce dany surowiec. Bez tego filtra vany woziłyby
 * na Ziemię metan, którego nikt tam nie przerabia — magazyn ma pojemność
 * na wszystko, ale zapotrzebowanie mają tylko wejścia receptur i byt.
 */
export function stationWantsResource(station, resourceId) {
  const id = String(resourceId || '');
  if (STATION_UPKEEP[id]) return true;
  // Popyt spoza receptur — dziś stocznia, jutro remonty i budowa.
  //
  // Bez tego konsument, który nie jest recepturą, jest dla warstwy transportu
  // NIEWIDZIALNY: stocznia zjada podzespoły, ale dyspozytor nie ma skąd wiedzieć,
  // że trzeba je dowieźć. Zmierzone: przy siedmiu stoczniach budował tylko Mars,
  // bo tylko on produkował komponenty na miejscu.
  if (station?.extraDemand?.includes(id)) return true;
  const industry = getStationIndustry(station);
  if (!industry) return false;
  for (const recipeId of industry.recipes) {
    if (RECIPES[recipeId]?.in?.[id] > 0) return true;
  }
  return false;
}

/** Co stacja wytwarza — do opisu w UI i doboru ładunku powrotnego. */
export function getStationOutputs(station) {
  const industry = getStationIndustry(station);
  if (!industry) return [];
  const out = new Set();
  for (const recipeId of industry.recipes) {
    for (const id of Object.keys(RECIPES[recipeId]?.out || {})) out.add(id);
  }
  const planetId = String(station?.planet?.id || station?.id || '').toLowerCase();
  for (const id of Object.keys(PLANET_YIELD[planetId]?.yields || {})) out.add(id);
  return [...out];
}

// ============================================================
// Ceny lokalne
// ============================================================

/**
 * Model ceny miejscowej. To on tworzy trasy handlowe — nie ma osobnej „tabeli
 * handlu", cena wynika z tego, czego komu brakuje.
 *
 * Do tej pory ten model istniał wyłącznie w specyfikacji: wszystkie stacje
 * wyceniały towar identycznie, więc nie było czego arbitrażować i handel mógł
 * być tylko planowaniem niedoborów, nigdy pogonią za marżą.
 */
export const PRICE_MODEL = Object.freeze({
  /** Mnożnik przy magazynie pełnym — tanio, bo stacja chce się tego pozbyć. */
  fullMultiplier: 0.6,
  /** Mnożnik przy magazynie pustym — drogo, bo stacja tego potrzebuje. */
  emptyMultiplier: 1.8,
  /** Rozstęp kupna i sprzedaży stacji. To z niego żyje port, nie handlarz. */
  spread: 0.12,
  /** Frakcja dopłaca za to, czego chce, i obniża cenę tego, czego ma w bród. */
  demandBonus: 0.15,
  supplyDiscount: 0.15
});

/** Mnożnik niedoboru: 1.8 przy pustym magazynie, 0.6 przy pełnym. */
export function scarcityMultiplier(fill) {
  const clamped = Math.max(0, Math.min(1, Number(fill) || 0));
  const { emptyMultiplier, fullMultiplier } = PRICE_MODEL;
  return emptyMultiplier + (fullMultiplier - emptyMultiplier) * clamped;
}

/**
 * Profil frakcji: czego chce, a czego ma w nadmiarze. Bierze się z `demands`
 * i `supplies` w `factions.js` — te tablice istniały od początku z komentarzem
 * „używane przy generowaniu tras handlowych", ale nic ich nie czytało.
 */
export function factionPriceProfile(factionId, resourceId) {
  const faction = getFaction(factionId);
  if (!faction) return 1;
  const id = String(resourceId || '');
  let profile = 1;
  if (faction.demands?.includes(id)) profile += PRICE_MODEL.demandBonus;
  if (faction.supplies?.includes(id)) profile -= PRICE_MODEL.supplyDiscount;
  return Math.max(0.1, profile);
}

/**
 * Cena surowca na konkretnej stacji.
 *
 * `market` to wartość odniesienia; `ask` to ile stacja żąda za sprzedaż,
 * `bid` ile płaci za skup. Handlarz zarabia na różnicy między `bid` u jednego
 * a `ask` u drugiego — i to jest jedyne źródło marży w całej gospodarce.
 *
 * `reputation` stosuje się WYŁĄCZNIE do transakcji gracza; przewoźnicy NPC
 * handlują po cenie frakcyjnej.
 */
export function resourcePrice(station, econ, resourceId, options = {}) {
  const def = RESOURCES[String(resourceId || '')];
  if (!def) return null;

  const cap = capacityOf(econ, resourceId);
  const stored = amountOf(econ, resourceId);
  const fill = cap > 0 ? Math.max(0, Math.min(1, stored / cap)) : 0.5;

  const scarcity = scarcityMultiplier(fill);
  const profile = factionPriceProfile(station?.factionId, resourceId);
  const market = def.value * scarcity * profile;

  const half = PRICE_MODEL.spread / 2;
  const reputationMul = options.reputation
    ? getFactionPriceMultiplier(station?.factionId, options.reputation)
    : 1;

  return {
    resourceId: String(resourceId),
    fill,
    scarcity,
    profile,
    market,
    /** Ile trzeba zapłacić, żeby kupić od stacji. */
    ask: market * (1 + half) * reputationMul,
    /** Ile stacja zapłaci przy skupie. */
    bid: market * (1 - half) / Math.max(0.1, reputationMul),
    /** Ile jest do wzięcia bez naruszania zapasu roboczego stacji. */
    available: Math.max(0, stored - cap * SURPLUS_FILL),
    /** Ile stacja jeszcze zmieści. */
    room: cap > 0 ? Math.max(0, cap - stored) : Infinity
  };
}

/** Krótki opis roli stacji do nagłówka terminala. */
export function describeStationRole(station) {
  if (isDerelict(station)) return 'Opuszczona — brak produkcji';
  const industry = getStationIndustry(station);
  if (!industry || !industry.recipes.length) return 'Punkt przeładunkowy';
  const planetId = String(station?.planet?.id || station?.id || '').toLowerCase();
  const extracts = (PLANET_YIELD[planetId]?.rate || 0) > 0;
  const assembles = industry.recipes.some(id => RECIPES[id]?.building === 'factory');
  if (assembles && extracts) return 'Kopalnia i fabryka';
  if (assembles) return 'Zakłady montażowe';
  if (extracts) return 'Kopalnia i rafineria';
  return 'Rafineria';
}
