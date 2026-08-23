/**
 * JEDNO ŹRÓDŁO PRAWDY DLA WSZYSTKICH SUROWCÓW W GRZE.
 *
 * Zastępuje trzy niespójne modele, które żyły obok siebie:
 *   1. ECONOMY_RESOURCES (gas/fuel/rawMetal/refinedMetal) — infrastructureUI.js
 *   2. MARKET (ruda/paliwo/zywnosc)                       — index.html
 *   3. ASTEROID_RESOURCE (7 łańcuchów)                    — asteroidTypes.js
 *
 * Model ma 3 poziomy:
 *   T0 SUROWIEC  — wydobywany wprost (asteroidy, kolektory planetarne, wraki)
 *   T1 RAFINAT   — rafineria przetwarza surowce
 *   T2 KOMPONENT — fabryka składa rafinaty; stocznia buduje z komponentów
 *
 * Ten moduł NIE MA IMPORTÓW — żeby każdy inny mógł go bezpiecznie zaciągnąć
 * (asteroidTypes.js, infrastructureUI.js, index.html, przyszłe mining/salvage).
 */

// ============================================================
// Poziomy i kategorie
// ============================================================

export const TIER = Object.freeze({
  RAW: 0,
  REFINED: 1,
  COMPONENT: 2
});

export const TIER_LABEL_PL = Object.freeze({
  0: 'Surowiec',
  1: 'Rafinat',
  2: 'Komponent'
});

/** Kategoria steruje ikoną i grupowaniem w UI, nie mechaniką. */
export const CATEGORY = Object.freeze({
  ORE: 'ore',              // ruda z asteroid i planet skalistych
  GAS: 'gas',              // gaz z olbrzymów gazowych
  VOLATILE: 'volatile',    // lód, woda, gazy techniczne
  METAL: 'metal',          // stal, stopy
  ELECTRONIC: 'electronic',// chipy, soczewki, przewody
  FUEL: 'fuel',            // pręty paliwowe, paliwo fuzyjne
  CHEMICAL: 'chemical',    // polimery, chłodziwo
  COMPONENT: 'component',  // gotowe podzespoły okrętowe
  WEAPON: 'weapon',        // lufy i emitery — to, co siada na podstawie
  ORDNANCE: 'ordnance',    // amunicja, rakiety, torpedy — zużywa się przy każdym starciu
  SALVAGE: 'salvage'       // złom z wraków
});

// ============================================================
// Rejestr surowców
// ============================================================
//
// Pola:
//   tier     — TIER.*
//   category — CATEGORY.*
//   label    — nazwa PL do UI
//   short    — skrót na ciasne pola (magazyny, ikony ładowni)
//   unit     — 't' (tony, materiały sypkie/płynne) | 'szt' (sztuki, podzespoły)
//   mass     — ile jednostek cargoCap zajmuje 1 sztuka.
//              Kadłuby mają cargoCap 12–600, więc: ruda 1.0, chipy 0.4,
//              komponent 4.0 → fregata (16) uniesie 16 rudy albo 4 płyty.
//   value    — bazowa cena skupu w CR za 1 sztukę. Marża rafinacji ~1.6x,
//              montażu ~1.5x, więc przetwarzanie zawsze się opłaca.
//   color    — kolor wiodący w UI (paski magazynów, ikony, CIC)
//   capacityFactor — ile razy większy magazyn niż domyślny dla tego poziomu.
//              Domyślnie 1. Istnieje, bo „sztuka" znaczy różne rzeczy: skrzynia
//              naboi i torpeda są obie komponentem T2, ale port trzyma dziesiątki
//              tysięcy skrzyń i kilkaset torped. Bez tego pola port celował
//              w ten sam zapas jednych i drugich, czyli w setki tysięcy CR
//              zamrożone w torpedach — i amunicja rozłaziła się po całym
//              układzie zamiast trafiać tam, gdzie toczy się wojna.
//              UWAGA: współczynnik działa w OBIE strony. Za duży magazyn
//              sprawia, że producent nigdy nie przekracza progu nadwyżki
//              (70% zapełnienia) i w ogóle nie wystawia towaru na sprzedaż —
//              zmierzone przy ×6 dla amunicji kinetycznej: Wenus 57 tys. sztuk
//              w magazynie i ZERO na rynku, a porty wojenne na zerze.
//
// value jest bazą — stacje mogą mieć własne mnożniki podaży/popytu.

export const RESOURCES = Object.freeze({

  // ---------- T0: SUROWCE Z ASTEROID ----------
  iron_ore: {
    tier: TIER.RAW, category: CATEGORY.ORE,
    label: 'Ruda żelaza', short: 'Fe', unit: 't',
    mass: 1.0, value: 6, color: '#a8845c'
  },
  copper_ore: {
    tier: TIER.RAW, category: CATEGORY.ORE,
    label: 'Ruda miedzi', short: 'Cu', unit: 't',
    mass: 1.0, value: 8, color: '#c87137'
  },
  silicon_ore: {
    tier: TIER.RAW, category: CATEGORY.ORE,
    label: 'Ruda krzemu', short: 'Si', unit: 't',
    mass: 1.0, value: 9, color: '#8b98a8'
  },
  titanium_ore: {
    tier: TIER.RAW, category: CATEGORY.ORE,
    label: 'Ruda tytanu', short: 'Ti', unit: 't',
    mass: 1.0, value: 14, color: '#7d8a99'
  },
  raw_crystal: {
    tier: TIER.RAW, category: CATEGORY.ORE,
    label: 'Surowy kryształ', short: 'Kr', unit: 't',
    mass: 0.8, value: 18, color: '#b06cf0'
  },
  ice: {
    tier: TIER.RAW, category: CATEGORY.VOLATILE,
    label: 'Lód', short: 'H₂O', unit: 't',
    mass: 1.0, value: 4, color: '#7fd4f5'
  },
  uranium_ore: {
    tier: TIER.RAW, category: CATEGORY.ORE,
    label: 'Ruda uranu', short: 'U', unit: 't',
    mass: 1.2, value: 22, color: '#6ee06e'
  },

  // ---------- T0: GAZY Z OLBRZYMÓW GAZOWYCH ----------
  helium3: {
    tier: TIER.RAW, category: CATEGORY.GAS,
    label: 'Hel-3', short: 'He3', unit: 't',
    mass: 0.5, value: 26, color: '#ffd166'
  },
  methane: {
    tier: TIER.RAW, category: CATEGORY.GAS,
    label: 'Metan', short: 'CH₄', unit: 't',
    mass: 0.6, value: 7, color: '#4fd1c5'
  },
  ammonia: {
    tier: TIER.RAW, category: CATEGORY.GAS,
    label: 'Amoniak', short: 'NH₃', unit: 't',
    mass: 0.7, value: 9, color: '#9fe870'
  },

  // ---------- T0: Z WRAKÓW ----------
  scrap: {
    tier: TIER.RAW, category: CATEGORY.SALVAGE,
    label: 'Złom', short: 'Zł', unit: 't',
    mass: 1.0, value: 3, color: '#8a8f96'
  },

  // ---------- T1: RAFINATY ----------
  steel: {
    tier: TIER.REFINED, category: CATEGORY.METAL,
    label: 'Stal', short: 'St', unit: 't',
    mass: 1.0, value: 16, color: '#cbd5e1'
  },
  copper_wire: {
    tier: TIER.REFINED, category: CATEGORY.ELECTRONIC,
    label: 'Przewód miedziany', short: 'Prz', unit: 't',
    mass: 0.8, value: 21, color: '#e08a4c'
  },
  chips: {
    tier: TIER.REFINED, category: CATEGORY.ELECTRONIC,
    label: 'Układy scalone', short: 'IC', unit: 'szt',
    mass: 0.4, value: 62, color: '#38bdf8'
  },
  titan_alloy: {
    tier: TIER.REFINED, category: CATEGORY.METAL,
    label: 'Stop tytanu', short: 'TiA', unit: 't',
    mass: 1.0, value: 62, color: '#94a3b8'
  },
  optic_lens: {
    tier: TIER.REFINED, category: CATEGORY.ELECTRONIC,
    label: 'Soczewka optyczna', short: 'Opt', unit: 'szt',
    mass: 0.4, value: 92, color: '#c084fc'
  },
  hydrogen: {
    tier: TIER.REFINED, category: CATEGORY.VOLATILE,
    label: 'Wodór', short: 'H₂', unit: 't',
    mass: 0.5, value: 7, color: '#60a5fa'
  },
  oxygen: {
    tier: TIER.REFINED, category: CATEGORY.VOLATILE,
    label: 'Tlen', short: 'O₂', unit: 't',
    mass: 0.6, value: 5, color: '#93c5fd'
  },
  fuel_rods: {
    tier: TIER.REFINED, category: CATEGORY.FUEL,
    label: 'Pręty paliwowe', short: 'Prt', unit: 'szt',
    mass: 1.5, value: 175, color: '#4ade80'
  },
  polymer: {
    tier: TIER.REFINED, category: CATEGORY.CHEMICAL,
    label: 'Polimer', short: 'Pol', unit: 't',
    mass: 0.6, value: 18, color: '#a855f7'
  },
  coolant: {
    tier: TIER.REFINED, category: CATEGORY.CHEMICAL,
    label: 'Chłodziwo', short: 'Chł', unit: 't',
    mass: 0.8, value: 19, color: '#2dd4bf'
  },
  fusion_fuel: {
    tier: TIER.REFINED, category: CATEGORY.FUEL,
    label: 'Paliwo fuzyjne', short: 'Fuz', unit: 't',
    mass: 0.5, value: 100, color: '#fbbf24'
  },

  // ---------- T2: KOMPONENTY OKRĘTOWE ----------
  hull_plate: {
    tier: TIER.COMPONENT, category: CATEGORY.COMPONENT,
    label: 'Płyta kadłuba', short: 'Płt', unit: 'szt',
    mass: 4.0, value: 190, color: '#9ca3af'
  },
  avionics: {
    tier: TIER.COMPONENT, category: CATEGORY.COMPONENT,
    label: 'Awionika', short: 'Awi', unit: 'szt',
    mass: 2.0, value: 390, color: '#22d3ee'
  },
  reactor_core: {
    tier: TIER.COMPONENT, category: CATEGORY.COMPONENT,
    label: 'Rdzeń reaktora', short: 'Rdz', unit: 'szt',
    mass: 6.0, value: 740, color: '#34d399'
  },
  thruster: {
    tier: TIER.COMPONENT, category: CATEGORY.COMPONENT,
    label: 'Silnik manewrowy', short: 'Sil', unit: 'szt',
    mass: 5.0, value: 660, color: '#fb923c'
  },
  weapon_mount: {
    tier: TIER.COMPONENT, category: CATEGORY.COMPONENT,
    label: 'Podstawa uzbrojenia', short: 'Uzb', unit: 'szt',
    mass: 5.0, value: 1250, color: '#f87171'
  },
  life_support: {
    tier: TIER.COMPONENT, category: CATEGORY.COMPONENT,
    label: 'Podtrzymywanie życia', short: 'LSS', unit: 'szt',
    mass: 3.0, value: 620, color: '#a3e635'
  },

  // ---------- T2: UZBROJENIE ----------
  //
  // Gospodarka handluje KLASAMI uzbrojenia, nie 38 modelami z `weapons.js`.
  // Konkretna lufa (Tempest Ion Mk II, Grad Flak) to kwestia tego, co gracz
  // kupi w doku — `weaponEconomy.js` przelicza model na te cztery pozycje.
  //
  // `weapon_mount` zostaje PODSTAWĄ: działo siada na niej, a nie zastępuje jej.
  // Dlatego uzbrojony okręt potrzebuje obu rzeczy naraz.
  gun_ballistic: {
    tier: TIER.COMPONENT, category: CATEGORY.WEAPON,
    label: 'Działo kinetyczne', short: 'Kin', unit: 'szt',
    mass: 6.0, value: 440, color: '#fca5a5'
  },
  // Droższe w budowie od balistyki i tańsze w użyciu — nie je amunicji, tylko
  // moc reaktora. To jest cała różnica między tymi dwiema szkołami.
  gun_energy: {
    tier: TIER.COMPONENT, category: CATEGORY.WEAPON,
    label: 'Emiter energetyczny', short: 'Emi', unit: 'szt',
    mass: 5.0, value: 720, color: '#67e8f9'
  },
  launcher_ordnance: {
    tier: TIER.COMPONENT, category: CATEGORY.WEAPON,
    label: 'Wyrzutnia', short: 'Wyr', unit: 'szt',
    mass: 7.0, value: 500, color: '#fdba74'
  },
  pd_turret: {
    tier: TIER.COMPONENT, category: CATEGORY.WEAPON,
    label: 'Wieżyczka OP', short: 'OP', unit: 'szt',
    mass: 4.0, value: 450, color: '#a5b4fc'
  },
  /**
   * Myśliwiec — jedna maszyna, nie eskadra. Eskadra to `squadSize` sztuk
   * (dziewięć, patrz `fighterSquadrons.js`), więc magazyn liczy pojedyncze
   * kadłuby i dopiero hangar składa z nich klucz.
   *
   * Działka są INTEGRALNE: myśliwiec nie dźwiga wieżyczki OP z okrętu, tylko
   * ma swoje własne, wliczone w cenę płatowca. Osobno kupuje się wyłącznie
   * rakiety, bo te schodzą przy każdym wylocie.
   */
  fighter_craft: {
    tier: TIER.COMPONENT, category: CATEGORY.WEAPON,
    label: 'Myśliwiec', short: 'Myś', unit: 'szt',
    mass: 3.0, value: 595, color: '#7cff91', capacityFactor: 1.5
  },

  // ---------- T2: AMUNICJA ----------
  //
  // Jedyny towar w grze zużywany PRZEZ SAMO STRZELANIE. Kadłuby i podzespoły
  // kupuje się raz; amunicja musi płynąć bez przerwy, dopóki trwa wojna —
  // i to ona zamienia wojnę z jednorazowego wydatku w stały strumień frachtu.
  //
  // Sztuką jest SKRZYNIA/ZASOBNIK, nie pojedynczy nabój: gatling wypuszcza
  // 16 pocisków na sekundę i przy liczeniu po naboju magazyn portu znikałby
  // w kilka minut. Ile strzałów daje sztuka — patrz `shotsPerAmmo` w weapons.js.
  ammo_kinetic: {
    tier: TIER.COMPONENT, category: CATEGORY.ORDNANCE,
    label: 'Amunicja kinetyczna', short: 'Amk', unit: 'szt',
    mass: 0.8, value: 12, color: '#d4d4d8', capacityFactor: 2
  },
  flak_shell: {
    tier: TIER.COMPONENT, category: CATEGORY.ORDNANCE,
    label: 'Pociski flak', short: 'Flk', unit: 'szt',
    mass: 1.0, value: 36, color: '#fbbf24', capacityFactor: 1.5
  },
  missile_round: {
    tier: TIER.COMPONENT, category: CATEGORY.ORDNANCE,
    label: 'Rakieta', short: 'Rak', unit: 'szt',
    mass: 2.0, value: 205, color: '#f472b6', capacityFactor: 0.8
  },
  torpedo_round: {
    tier: TIER.COMPONENT, category: CATEGORY.ORDNANCE,
    label: 'Torpeda', short: 'Trp', unit: 'szt',
    mass: 6.0, value: 725, color: '#fb7185', capacityFactor: 0.25
  }
});

export const RESOURCE_KEYS = Object.freeze(Object.keys(RESOURCES));

export const RESOURCE_KEYS_BY_TIER = Object.freeze({
  0: Object.freeze(RESOURCE_KEYS.filter(k => RESOURCES[k].tier === TIER.RAW)),
  1: Object.freeze(RESOURCE_KEYS.filter(k => RESOURCES[k].tier === TIER.REFINED)),
  2: Object.freeze(RESOURCE_KEYS.filter(k => RESOURCES[k].tier === TIER.COMPONENT))
});

// ============================================================
// Skąd się bierze T0 — wydobycie
// ============================================================

/**
 * Typ asteroidy → surowiec. Zgodne 1:1 z ASTEROID_TYPES w asteroidTypes.js,
 * który re-eksportuje tę mapę jako ASTEROID_RESOURCE (zgodność wsteczna).
 */
export const ASTEROID_YIELD = Object.freeze({
  iron:    'iron_ore',
  copper:  'copper_ore',
  silicon: 'silicon_ore',
  titan:   'titanium_ore',
  crystal: 'raw_crystal',
  ice:     'ice',
  uran:    'uranium_ore'
});

/**
 * Planeta → co da się z niej wyciągnąć kolektorem, z wagami rozkładu.
 *
 * Rola planet w ekonomii jest CELOWO inna niż asteroid:
 *   planety  — niski, stały wychód, bezpiecznie, blisko stacji
 *   asteroidy— wysoki wychód, ale trzeba lecieć w pas i wrócić z ładunkiem
 *
 * `rate` to mnożnik wydajności kolektora (olbrzymy gazowe są hojniejsze,
 * bo lot do nich jest daleki — Neptun siedzi na 120 AU).
 * Ziemia nie wydobywa nic: to hub przemysłowo-handlowy.
 */
export const PLANET_YIELD = Object.freeze({
  // Udziały i `rate` planet wewnętrznych są SKALIBROWANE pod zapotrzebowanie
  // hut Ziemi i stoczni Marsa — patrz sekcja bilansu w teście stationEconomy.
  // Zmiana którejkolwiek liczby tutaj może zagłodzić łańcuch produkcji.
  mercury: { rate: 2.45, yields: { iron_ore: 0.40, titanium_ore: 0.36, silicon_ore: 0.12, copper_ore: 0.12 } },
  venus:   { rate: 1.40, yields: { copper_ore: 0.45, silicon_ore: 0.25, raw_crystal: 0.22, iron_ore: 0.08 } },
  earth:   { rate: 0.00, yields: {} },
  mars:    { rate: 1.05, yields: { iron_ore: 0.40, silicon_ore: 0.24, ice: 0.21, raw_crystal: 0.15 } },
  // Olbrzymy gazowe dają też lód — z księżyców (Europa, Enceladus, Tytan).
  // Bez tego cały łańcuch tlen/wodór/paliwo fuzyjne stoi na jednym dostawcy
  // z Marsa i układ zewnętrzny dusi się na podtrzymywaniu życia.
  jupiter: { rate: 1.60, yields: { helium3: 0.38, ammonia: 0.27, methane: 0.15, ice: 0.20 } },
  saturn:  { rate: 1.50, yields: { helium3: 0.32, ammonia: 0.22, methane: 0.24, ice: 0.22 } },
  uranus:  { rate: 1.35, yields: { methane: 0.40, ammonia: 0.26, helium3: 0.12, ice: 0.22 } },
  neptune: { rate: 1.30, yields: { methane: 0.40, ammonia: 0.24, helium3: 0.16, ice: 0.20 } },

  // LIGA PASA mieszka WEWNĄTRZ dużych planetoid, więc wydobywa u siebie —
  // to nie są przyczółki żyjące z dowozu, tylko pełnoprawne ośrodki. Bez
  // własnego złoża frakcja nie miałaby z czego utrzymać stoczni, a o to
  // w dołożeniu jej właśnie chodzi.
  //
  // Ceres jest lodowa i wodna, Westa zróżnicowana i bogata w metal — stąd
  // różne udziały. Razem dają Lidze stal i tytan bez oglądania się na rdzeń.
  ceres: { rate: 1.25, yields: { iron_ore: 0.30, silicon_ore: 0.22, ice: 0.28, raw_crystal: 0.20 } },
  vesta: { rate: 1.05, yields: { iron_ore: 0.42, titanium_ore: 0.33, silicon_ore: 0.25 } }
});

/** Typ planety → jaki kolektor w ogóle wolno na niej postawić. */
export const PLANET_COLLECTOR_KIND = Object.freeze({
  rocky:  'mine',      // kopalnia odkrywkowa / orbitalny wyciąg
  terran: null,        // Ziemia — brak wydobycia
  gas:    'scoop'      // zbieracz atmosferyczny
});

// ============================================================
// Receptury
// ============================================================
//
// Każda receptura:
//   id       — klucz
//   label    — nazwa PL
//   building — jaki budynek ją wykonuje ('refinery' | 'factory')
//   seconds  — czas jednego cyklu przy wydajności 1.0
//   in       — { resourceId: ile }
//   out      — { resourceId: ile }
//
// Bilans: wartość `out` ≈ wartość `in` × 1.6 (rafinacja) lub × 1.5 (montaż).
// Dzięki temu przetwarzanie zawsze bije sprzedaż surowca, ale nie tak mocno,
// żeby sprzedaż nadwyżek przestała mieć sens.

export const RECIPES = Object.freeze({

  // ---------- RAFINERIA: T0 → T1 ----------
  smelt_steel: {
    label: 'Wytop stali', building: 'refinery', seconds: 30,
    in: { iron_ore: 3 }, out: { steel: 2 }
  },
  draw_copper_wire: {
    label: 'Ciągnienie miedzi', building: 'refinery', seconds: 30,
    in: { copper_ore: 3 }, out: { copper_wire: 2 }
  },
  etch_chips: {
    label: 'Trawienie układów', building: 'refinery', seconds: 55,
    in: { silicon_ore: 4 }, out: { chips: 1 }
  },
  alloy_titanium: {
    label: 'Stapianie tytanu', building: 'refinery', seconds: 60,
    in: { titanium_ore: 4, steel: 1 }, out: { titan_alloy: 2 }
  },
  grind_optics: {
    label: 'Szlifowanie optyki', building: 'refinery', seconds: 50,
    in: { raw_crystal: 3 }, out: { optic_lens: 1 }
  },
  electrolyse_ice: {
    label: 'Elektroliza lodu', building: 'refinery', seconds: 25,
    in: { ice: 2 }, out: { hydrogen: 1, oxygen: 1 }
  },
  enrich_uranium: {
    label: 'Wzbogacanie uranu', building: 'refinery', seconds: 80,
    in: { uranium_ore: 4, steel: 1 }, out: { fuel_rods: 1 }
  },
  crack_methane: {
    label: 'Kraking metanu', building: 'refinery', seconds: 35,
    in: { methane: 3 }, out: { polymer: 2 }
  },
  synth_coolant: {
    label: 'Synteza chłodziwa', building: 'refinery', seconds: 35,
    in: { ammonia: 2, ice: 1 }, out: { coolant: 2 }
  },
  compress_fusion_fuel: {
    label: 'Sprężanie paliwa fuzyjnego', building: 'refinery', seconds: 70,
    in: { helium3: 2, hydrogen: 1 }, out: { fusion_fuel: 1 }
  },

  // Recykling — to jest wejście wraków do ekonomii (Krok 1).
  // Celowo gorszy kurs niż ruda z asteroid: złom to uzupełnienie, nie skrót.
  recycle_scrap: {
    label: 'Przetop złomu', building: 'refinery', seconds: 40,
    in: { scrap: 4 }, out: { steel: 1 }
  },

  // ---------- FABRYKA: T1 → T2 ----------
  assemble_hull_plate: {
    label: 'Montaż płyt kadłuba', building: 'factory', seconds: 70,
    in: { steel: 4, titan_alloy: 1 }, out: { hull_plate: 1 }
  },
  assemble_avionics: {
    label: 'Montaż awioniki', building: 'factory', seconds: 90,
    in: { chips: 2, copper_wire: 2, optic_lens: 1 }, out: { avionics: 1 }
  },
  assemble_reactor_core: {
    label: 'Montaż rdzenia reaktora', building: 'factory', seconds: 130,
    in: { fuel_rods: 2, titan_alloy: 2, coolant: 1 }, out: { reactor_core: 1 }
  },
  assemble_thruster: {
    label: 'Montaż silnika', building: 'factory', seconds: 110,
    in: { hull_plate: 2, coolant: 1, copper_wire: 2 }, out: { thruster: 1 }
  },
  assemble_weapon_mount: {
    label: 'Montaż podstawy uzbrojenia', building: 'factory', seconds: 140,
    in: { hull_plate: 2, avionics: 1, titan_alloy: 1 }, out: { weapon_mount: 1 }
  },
  assemble_life_support: {
    label: 'Montaż podtrzymywania życia', building: 'factory', seconds: 95,
    in: { polymer: 1, oxygen: 1, avionics: 1 }, out: { life_support: 1 }
  },

  // ---------- ZBROJOWNIA: T1 → uzbrojenie ----------
  assemble_gun_ballistic: {
    label: 'Montaż działa kinetycznego', building: 'factory', seconds: 150,
    in: { titan_alloy: 3, steel: 4, copper_wire: 2 }, out: { gun_ballistic: 1 }
  },
  // Układ scalony kosztuje 4 rudy krzemu, a krzem jest najciaśniejszym
  // surowcem układu — dlatego elektronika wchodzi tu tylko tam, gdzie jest
  // istotą wyrobu (celownik, zapalnik, głowica naprowadzająca). Reszta stoi
  // na przewodzie i stali. Pierwsza wersja tych receptur zbiła pokrycie
  // krzemu do 79%, czyli zagłodziłaby CAŁY układ, nie tylko zbrojownie.
  assemble_gun_energy: {
    label: 'Montaż emitera', building: 'factory', seconds: 190,
    in: { optic_lens: 3, chips: 1, coolant: 2, copper_wire: 5 }, out: { gun_energy: 1 }
  },
  assemble_launcher: {
    label: 'Montaż wyrzutni', building: 'factory', seconds: 160,
    in: { hull_plate: 1, chips: 1, steel: 5 }, out: { launcher_ordnance: 1 }
  },
  assemble_pd_turret: {
    label: 'Montaż wieżyczki OP', building: 'factory', seconds: 130,
    in: { optic_lens: 2, copper_wire: 4, steel: 2 }, out: { pd_turret: 1 }
  },
  // Płatowiec jest LEKKI: tytan i elektronika, bez płyt pancernych i bez
  // wielkiego silnika manewrowego. Myśliwiec za 660 CR wobec fregaty za 3950
  // to właściwa proporcja — dziewięć maszyn kosztuje tyle co półtorej fregaty
  // i ginie równie łatwo.
  assemble_fighter_craft: {
    label: 'Montaż myśliwca', building: 'factory', seconds: 170,
    // BEZ płyty kadłuba: płatowiec jest lekki, stoi na stopie tytanu
    // i tworzywie, nie na pancerzu. Wersja z płytą zjadała ~7,5 rudy żelaza
    // na maszynę i zbiła pokrycie żelaza w całym układzie do 98%.
    // Połowa elektroniki na optyce, nie na układach: krzem jest najciaśniejszym
    // surowcem układu (przy dwóch chipach pokrycie spadało do 100,0%, czyli na
    // styk), a surowy kryształ ma nadwyżkę u Wenus i Ceres.
    in: { titan_alloy: 2, chips: 1, optic_lens: 1, copper_wire: 4, polymer: 2 },
    out: { fighter_craft: 1 }
  },

  // ---------- AMUNICJOWNIA: T1 → amunicja ----------
  //
  // CELOWO tylko z rafinatów, bez ani jednego komponentu T2. Amunicja nie może
  // konkurować o płyty i awionikę z budową okrętów — inaczej każda wojna
  // zatrzymywałaby stocznie, zamiast je nakręcać.
  assemble_ammo_kinetic: {
    label: 'Elaboracja amunicji', building: 'factory', seconds: 60,
    in: { steel: 2, polymer: 1 }, out: { ammo_kinetic: 6 }
  },
  assemble_flak_shell: {
    label: 'Elaboracja pocisków flak', building: 'factory', seconds: 85,
    in: { steel: 1, chips: 1, polymer: 1 }, out: { flak_shell: 4 }
  },
  assemble_missile_round: {
    label: 'Montaż rakiet', building: 'factory', seconds: 120,
    in: { chips: 1, copper_wire: 2, polymer: 2, steel: 2, fusion_fuel: 1 },
    out: { missile_round: 2 }
  },
  assemble_torpedo_round: {
    label: 'Montaż torped', building: 'factory', seconds: 210,
    in: { chips: 2, copper_wire: 2, polymer: 3, steel: 4, fusion_fuel: 2 },
    out: { torpedo_round: 1 }
  }
});

export const RECIPE_KEYS = Object.freeze(Object.keys(RECIPES));

// ============================================================
// Migracja starych modeli
// ============================================================

/**
 * Stary klucz → nowy. Używane przy wczytywaniu zapisów sprzed ujednolicenia
 * oraz przez kod, który jeszcze nie został przepisany.
 *
 * 'zywnosc' ze starego MARKET nie ma odpowiednika — model nie obsługuje
 * zaopatrzenia ludności. Mapuje się na null i jest po cichu odrzucane.
 */
export const LEGACY_RESOURCE_ALIASES = Object.freeze({
  // ECONOMY_RESOURCES (infrastructureUI.js)
  gas: 'helium3',
  fuel: 'fusion_fuel',
  rawMetal: 'iron_ore',
  refinedMetal: 'steel',
  // MARKET (index.html)
  ruda: 'iron_ore',
  paliwo: 'fusion_fuel',
  zywnosc: null
});

/** Tłumaczy stary klucz na nowy. Zwraca null dla porzuconych zasobów. */
export function migrateResourceKey(key) {
  const id = String(key || '');
  if (RESOURCES[id]) return id;
  if (Object.prototype.hasOwnProperty.call(LEGACY_RESOURCE_ALIASES, id)) {
    return LEGACY_RESOURCE_ALIASES[id];
  }
  return null;
}

/** Przepisuje cały worek { klucz: ilość } na nowe klucze, sumując kolizje. */
export function migrateResourceBag(bag) {
  const out = {};
  for (const [key, amount] of Object.entries(bag || {})) {
    const id = migrateResourceKey(key);
    if (!id) continue;
    const value = Number(amount) || 0;
    if (value === 0) continue;
    out[id] = (out[id] || 0) + value;
  }
  return out;
}

// ============================================================
// Helpery
// ============================================================

export function isResource(id) {
  return Object.prototype.hasOwnProperty.call(RESOURCES, String(id || ''));
}

export function getResource(id) {
  return RESOURCES[String(id || '')] || null;
}

export function getResourceLabel(id) {
  return RESOURCES[String(id || '')]?.label || String(id || '');
}

export function getResourceShort(id) {
  return RESOURCES[String(id || '')]?.short || String(id || '').slice(0, 3);
}

export function getResourceColor(id) {
  return RESOURCES[String(id || '')]?.color || '#94a3b8';
}

export function getResourceTier(id) {
  const def = RESOURCES[String(id || '')];
  return def ? def.tier : -1;
}

/** Bazowa cena skupu w CR za `amount` sztuk. */
export function getResourceValue(id, amount = 1) {
  const def = RESOURCES[String(id || '')];
  if (!def) return 0;
  return def.value * (Number(amount) || 0);
}

/** Ile jednostek cargoCap zajmie `amount` sztuk danego surowca. */
/**
 * Ile razy większy magazyn niż domyślny dla poziomu. Patrz `capacityFactor`.
 */
export function getResourceCapacityFactor(id) {
  const factor = Number(RESOURCES[id]?.capacityFactor);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function getResourceMass(id, amount = 1) {
  const def = RESOURCES[String(id || '')];
  if (!def) return 0;
  return def.mass * (Number(amount) || 0);
}

/** Łączne obciążenie ładowni dla worka { klucz: ilość }. */
export function getBagMass(bag) {
  let total = 0;
  for (const [id, amount] of Object.entries(bag || {})) {
    total += getResourceMass(id, amount);
  }
  return total;
}

/** Łączna wartość worka w CR. */
export function getBagValue(bag) {
  let total = 0;
  for (const [id, amount] of Object.entries(bag || {})) {
    total += getResourceValue(id, amount);
  }
  return total;
}

/** Wszystkie receptury wykonywane przez dany typ budynku. */
export function getRecipesForBuilding(building) {
  const kind = String(building || '');
  return RECIPE_KEYS.filter(key => RECIPES[key].building === kind);
}

/** Receptury, które produkują dany surowiec (do podpowiedzi „skąd to wziąć"). */
export function getRecipesProducing(resourceId) {
  const id = String(resourceId || '');
  return RECIPE_KEYS.filter(key => RECIPES[key].out[id] > 0);
}

/** Czy worek `stock` pokrywa zapotrzebowanie `cost`. */
export function canAfford(stock, cost) {
  for (const [id, amount] of Object.entries(cost || {})) {
    if ((Number(stock?.[id]) || 0) < (Number(amount) || 0)) return false;
  }
  return true;
}

/**
 * Losuje surowiec z rozkładu wag planety.
 * @param {string} planetId np. 'jupiter'
 * @param {() => number} rng generator [0..1)
 */
export function rollPlanetYield(planetId, rng = Math.random) {
  const entry = PLANET_YIELD[String(planetId || '').toLowerCase()];
  if (!entry || entry.rate <= 0) return null;
  const keys = Object.keys(entry.yields);
  if (!keys.length) return null;
  let total = 0;
  for (const k of keys) total += entry.yields[k];
  let r = rng() * total;
  for (const k of keys) {
    r -= entry.yields[k];
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}
