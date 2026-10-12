// src/game/asteroidMaterials.js
//
// Materiały skał do FIZYKI WYDOBYCIA (asteroidMining.js): jak skała się kopie,
// tnie i pęka pod ładunkiem, oraz co ma w środku (skład warstw).
//
// Skała to nie stal: nie gnie się, tylko kruszy i pęka. Różni ją
//   • twardość (hardness)    — opór narzędzia: ile objętości zdejmuje laser
//                              drona w sekundzie (lód szybko, tytan wolno);
//   • odporność na pękanie   — ile energii ładunku trzeba, żeby pęknięcia
//     (toughness)              doszły daleko (zasięg strefy spękań);
//   • kruchość (brittleness) — jak daleko pęknięcia uciekają poza strefę i jak
//                              drobne są odłamki (lód i kryształ sypią się na
//                              drobnicę, tytan i żelazo pękają na kilka brył);
//   • łupliwość (cleavage)   — płaskie ściany odłamów (kryształ);
//   • drobnica (fines)       — ułamek zmiażdżonej masy, który ginie jako pył.
// Gęstość i twardość biorą się z danych gry (src/data/asteroidPhysics.js),
// resztę dopisuje ten moduł. Skała neutralna i energetyczna nie są rudami gry,
// więc mają wpisy tutaj.
//
// Skład (ROCK_COMPOSITION): udział rudy w skorupie, płaszczu i rdzeniu. Skała
// miedzi ma z wierzchu ~10% miedzi (skała pospolita z domieszką i żyłami),
// a RDZEŃ to lita, czysta miedź — gracz musi dokopać się do środka albo
// wysadzić rdzeń i wyłapać jego kawałki.
//
// RDZEŃ (prośba użytkownika 2026-09-28: „każda asteroida ma rdzeń, mniejszy lub
// większy; skorupa daje ~10% surowca, rdzeń 100%; wybuchniesz asteroidę —
// kawałki rdzenia niech latają”): bryła z INNEGO materiału niż skała dookoła
// (CORE_MATERIAL) — miedź, żelazo i tytan to bryłki metalu (ciągliwe: nie
// sypią się na drobnicę, wylatują w całości albo w kilku bryłach), kryształ
// to zbite kryształy (kruche, łupliwe — odłamki), lód to czysty lód, krzem —
// kryształ krzemu, uran — bryła smółki uranowej, a skała energetyczna ma
// w krystalicznej geodzie PIORUN KULISTY (plazma): odsłonięty ucieka, trudno go
// złapać i bez pułapki magnetycznej wybucha (asteroidMining.js: balls).
//
// Moduł bez three i DOM-u (czyta go logika wydobycia i testy).

import { ASTEROID_MATERIAL } from '../data/asteroidPhysics.js';
import { ASTEROID_YIELD } from '../data/resources.js';
import { ROCK_TYPES } from './asteroidRockKinds.js';

/**
 * Parametry pękania per typ skały (toughness: tytan = 1; brittleness 0 … 1).
 * blast = ułamek energii ładunku, który idzie w ruch odłamów (kruche więcej).
 * volatile = mnożnik energii ładunku (skała energetyczna wyładowuje się sama).
 */
export const ROCK_FRACTURE = Object.freeze({
  iron: Object.freeze({ toughness: 0.80, brittleness: 0.22, cleavage: 0.0, fines: 0.10, blast: 0.8 }),
  copper: Object.freeze({ toughness: 0.62, brittleness: 0.30, cleavage: 0.1, fines: 0.12, blast: 0.85 }),
  silicon: Object.freeze({ toughness: 0.38, brittleness: 0.68, cleavage: 0.2, fines: 0.20, blast: 1.0 }),
  titan: Object.freeze({ toughness: 1.00, brittleness: 0.12, cleavage: 0.05, fines: 0.06, blast: 0.7 }),
  crystal: Object.freeze({ toughness: 0.30, brittleness: 0.92, cleavage: 0.8, fines: 0.30, blast: 1.1 }),
  ice: Object.freeze({ toughness: 0.16, brittleness: 0.88, cleavage: 0.3, fines: 0.35, blast: 1.15 }),
  uran: Object.freeze({ toughness: 0.55, brittleness: 0.40, cleavage: 0.1, fines: 0.12, blast: 0.8 }),
  rock: Object.freeze({ toughness: 0.45, brittleness: 0.55, cleavage: 0.15, fines: 0.18, blast: 1.0 }),
  energy: Object.freeze({ toughness: 0.34, brittleness: 0.85, cleavage: 0.4, fines: 0.25, blast: 1.2, volatile: 1.6 }),
  // Typy z widm: węglowa — porowata, krucha, sypie się drobnym regolitem; metaliczna
  // i platynowce — ciągliwe jak żelazo; bazalt — skała magmowa, kanciaste bloki;
  // prymitywna — najsłabsza (lód i organika), dużo drobnicy.
  carbon: Object.freeze({ toughness: 0.2, brittleness: 0.8, cleavage: 0.08, fines: 0.38, blast: 1.12 }),
  metal: Object.freeze({ toughness: 0.85, brittleness: 0.18, cleavage: 0.0, fines: 0.08, blast: 0.75 }),
  basalt: Object.freeze({ toughness: 0.55, brittleness: 0.45, cleavage: 0.22, fines: 0.14, blast: 0.92 }),
  primitive: Object.freeze({ toughness: 0.14, brittleness: 0.86, cleavage: 0.15, fines: 0.4, blast: 1.18 }),
  platinum: Object.freeze({ toughness: 0.9, brittleness: 0.15, cleavage: 0.0, fines: 0.06, blast: 0.72 }),
  rock_c: Object.freeze({ toughness: 0.26, brittleness: 0.74, cleavage: 0.1, fines: 0.3, blast: 1.06 }),
  // C z lodem w rdzeniach (Themis): krucha skorupa jak węglowa, lód w środku.
  carbon_ice: Object.freeze({ toughness: 0.18, brittleness: 0.82, cleavage: 0.1, fines: 0.36, blast: 1.14 })
});

// Gęstość [g/cm³] i twardość typów spoza ASTEROID_MATERIAL (rudy gry mają tam swoje).
const EXTRA_BULK = Object.freeze({
  rock: Object.freeze({ mass: 2.7, hardness: 0.45 }),
  energy: Object.freeze({ mass: 3.0, hardness: 0.5 }),
  // Wypełniacz węglowy: porowaty jak skały typu C.
  rock_c: Object.freeze({ mass: 1.6, hardness: 0.3 })
});

/**
 * Typy, które dla wydobycia SĄ skałą neutralną (bez rudy, ewentualny ukryty rdzeń):
 * rockMaterial(...).id = 'rock' — asteroidMining.js rozpoznaje wypełniacz po id materiału.
 * Wygląd i nazwę daje body.typeId (ROCK_TYPES).
 */
const NEUTRAL_MATERIAL_OF = Object.freeze({ rock_c: 'rock' });

/**
 * Skład: udział rudy (0 … 1) w skorupie, płaszczu (wzbogacenie wokół rdzenia)
 * i rdzeniu, siła żył (dopisek w wąskich pasmach), promień rdzenia jako ułamek
 * promienia skały (losowany z przedziału — rdzenie mniejsze i większe) i jego
 * garby (coreLump: 0 = kula). coreType — ruda, jeśli inna niż typ skały;
 * hiddenCore — szansa, że skała neutralna kryje rdzeń pospolitej rudy; plasma —
 * rdzeń to piorun kulisty (gdy system wydobycia ma go włączonego, inaczej
 * rdzeń z rudy coreType).
 */
const ORE_PROFILE = Object.freeze({ crust: 0.085, mantle: 0.25, core: 1, veins: 0.3, coreRadius: [0.16, 0.4], coreLump: 0.22 });
export const ROCK_COMPOSITION = Object.freeze({
  iron: Object.freeze({ ...ORE_PROFILE, coreRadius: [0.18, 0.4] }),
  copper: Object.freeze({ ...ORE_PROFILE, coreRadius: [0.16, 0.38] }),
  silicon: Object.freeze({ ...ORE_PROFILE, crust: 0.09, mantle: 0.28, coreRadius: [0.18, 0.4], coreLump: 0.18 }),
  titan: Object.freeze({ ...ORE_PROFILE, crust: 0.08, mantle: 0.22, coreRadius: [0.14, 0.32] }),
  crystal: Object.freeze({ ...ORE_PROFILE, crust: 0.06, mantle: 0.3, veins: 0.5, coreRadius: [0.2, 0.44], coreLump: 0.28 }),
  // Kometa: brudny lód na wierzchu, czysty w środku.
  ice: Object.freeze({ crust: 0.45, mantle: 0.7, core: 1, veins: 0.15, coreRadius: [0.26, 0.48], coreLump: 0.12 }),
  uran: Object.freeze({ ...ORE_PROFILE, crust: 0.06, mantle: 0.2, coreRadius: [0.12, 0.28], coreLump: 0.2 }),
  rock: Object.freeze({ crust: 0, mantle: 0, core: 0, veins: 0, coreRadius: [0.14, 0.3], coreLump: 0.2, hiddenCore: 0.22 }),
  // Naładowana skała: żyły i geoda z surowego kryształu, w środku piorun kulisty.
  energy: Object.freeze({ ...ORE_PROFILE, crust: 0.03, mantle: 0.55, veins: 0.4, coreType: 'crystal', coreRadius: [0.18, 0.34], coreLump: 0.05, plasma: true }),
  // Węglowa: materia węglista rozproszona w całej skale (skorupa bogatsza niż w rudach metali),
  // rdzeń — zbita bryła węglista, żyły węglanów.
  carbon: Object.freeze({ ...ORE_PROFILE, crust: 0.14, mantle: 0.32, veins: 0.35, coreRadius: [0.14, 0.34], coreLump: 0.3 }),
  // Metaliczna (Psyche ~82% metalu): metal już w skorupie, rdzeń lity.
  metal: Object.freeze({ ...ORE_PROFILE, crust: 0.3, mantle: 0.55, veins: 0.2, coreRadius: [0.22, 0.44], coreLump: 0.18 }),
  basalt: Object.freeze({ ...ORE_PROFILE, crust: 0.08, mantle: 0.24, veins: 0.25, coreRadius: [0.14, 0.32], coreLump: 0.22 }),
  // Prymitywna: ciemna skorupa tolinów, pod nią lód — czysty w środku.
  primitive: Object.freeze({ crust: 0.22, mantle: 0.62, core: 1, veins: 0.12, coreRadius: [0.26, 0.5], coreLump: 0.14 }),
  // Platynowce: skorupa uboga, mały, cenny rdzeń.
  platinum: Object.freeze({ ...ORE_PROFILE, crust: 0.04, mantle: 0.16, veins: 0.15, coreRadius: [0.1, 0.24], coreLump: 0.16 }),
  // C z lodem (Themis): w skorupie mało lodu (minerały uwodnione), duży lodowy rdzeń, szron w szczelinach.
  carbon_ice: Object.freeze({ ...ORE_PROFILE, crust: 0.1, mantle: 0.42, veins: 0.2, coreRadius: [0.24, 0.46], coreLump: 0.16 })
});

/** Rudy pospolite, które może kryć rdzeń skały neutralnej. */
export const HIDDEN_CORE_TYPES = Object.freeze(['iron', 'silicon', 'copper', 'ice']);

/**
 * Materiał RDZENIA (po rudzie rdzenia): rodzaj (kind) i parametry pękania jak
 * w ROCK_FRACTURE. Gęstość rdzenia = gęstość skały (jedna na ciało — metal
 * rudy i tak ma gęstość swojej skały w ASTEROID_MATERIAL). Twardość: metal
 * trudniej ciąć laserem niż skałę dookoła (skała schodzi szybciej i bryłka
 * „wychodzi” z otworu), lód i kryształ łatwo.
 *   metal   — ciągliwy: ładunek nie sypie go na drobnicę; bryła odpada od skały
 *             i pęka najwyżej na coreMaxChunks części (ze zmiażdżenia — śrut);
 *   crystal — zbite kryształy / kryształ krzemu: kruche, łupliwe — odłamki;
 *   ice     — czysty lód: kruchy, sypie się na bryłki;
 *   mineral — smółka uranowa: średnio krucha;
 *   plasma  — piorun kulisty (skała energetyczna): nie da się go kopać ani
 *             rozbić — odsłonięty ucieka (asteroidMining: balls).
 */
export const CORE_MATERIAL = Object.freeze({
  iron: Object.freeze({ kind: 'metal', hardness: 0.95, toughness: 2.4, brittleness: 0.03, cleavage: 0, fines: 0.02, blast: 0.6 }),
  copper: Object.freeze({ kind: 'metal', hardness: 0.8, toughness: 2.0, brittleness: 0.03, cleavage: 0, fines: 0.02, blast: 0.65 }),
  titan: Object.freeze({ kind: 'metal', hardness: 1.25, toughness: 3.0, brittleness: 0.02, cleavage: 0, fines: 0.02, blast: 0.55 }),
  silicon: Object.freeze({ kind: 'crystal', hardness: 0.6, toughness: 0.3, brittleness: 0.88, cleavage: 0.7, fines: 0.15, blast: 1.0 }),
  crystal: Object.freeze({ kind: 'crystal', hardness: 0.45, toughness: 0.28, brittleness: 0.95, cleavage: 0.9, fines: 0.2, blast: 1.1 }),
  ice: Object.freeze({ kind: 'ice', hardness: 0.08, toughness: 0.18, brittleness: 0.9, cleavage: 0.2, fines: 0.3, blast: 1.15 }),
  uran: Object.freeze({ kind: 'mineral', hardness: 0.7, toughness: 0.5, brittleness: 0.45, cleavage: 0.1, fines: 0.1, blast: 0.8 }),
  // Typy z widm: zbita bryła węglista (krucha), lity żelazo-nikiel, ilmenit w bazalcie,
  // czysty lód pod skorupą prymitywnej, bryłka platynowców (najtwardszy metal).
  carbon: Object.freeze({ kind: 'mineral', hardness: 0.3, toughness: 0.3, brittleness: 0.7, cleavage: 0.05, fines: 0.25, blast: 1.05 }),
  metal: Object.freeze({ kind: 'metal', hardness: 1.0, toughness: 2.6, brittleness: 0.03, cleavage: 0, fines: 0.02, blast: 0.6 }),
  basalt: Object.freeze({ kind: 'mineral', hardness: 0.8, toughness: 0.6, brittleness: 0.4, cleavage: 0.15, fines: 0.1, blast: 0.8 }),
  primitive: Object.freeze({ kind: 'ice', hardness: 0.08, toughness: 0.18, brittleness: 0.9, cleavage: 0.2, fines: 0.3, blast: 1.15 }),
  platinum: Object.freeze({ kind: 'metal', hardness: 1.2, toughness: 3.2, brittleness: 0.02, cleavage: 0, fines: 0.02, blast: 0.55 }),
  carbon_ice: Object.freeze({ kind: 'ice', hardness: 0.08, toughness: 0.18, brittleness: 0.9, cleavage: 0.2, fines: 0.3, blast: 1.15 }),
  plasma: Object.freeze({ kind: 'plasma', hardness: 0, toughness: 0, brittleness: 1, cleavage: 0, fines: 1, blast: 1 })
});

/** Nazwy rodzajów rdzenia do HUD-u. */
export const CORE_KIND_LABELS_PL = Object.freeze({
  metal: 'bryła metalu', crystal: 'zbite kryształy', ice: 'czysty lód', mineral: 'zbita bryła minerału', plasma: 'piorun kulisty'
});

/**
 * Materiał rdzenia rudy `oreTypeId` ('plasma' = piorun kulisty) w skale
 * o gęstości `density`: pola jak rockMaterial (bez składu) + kind.
 */
export function coreMaterial(oreTypeId, density = 2.7) {
  const c = CORE_MATERIAL[oreTypeId] || CORE_MATERIAL.uran;
  return {
    id: oreTypeId,
    kind: c.kind,
    density,
    hardness: c.hardness,
    toughness: c.toughness,
    brittleness: c.brittleness,
    cleavage: c.cleavage,
    fines: c.fines,
    blast: c.blast,
    volatile: 1
  };
}

/**
 * Wspólne stałe wydobycia (jednostki świata gry, tony, sekundy).
 */
export const MINING_CONFIG = Object.freeze({
  // Siatka komórek skały: tyle komórek na najdłuższy wymiar (bez marginesu).
  cellsAcross: 44,
  maxCellsPerAxis: 60,
  minCellSize: 6,
  // [t / (j.³ · g/cm³)] — skała r = 300 j. żelaza ≈ 60 t, r = 1000 j. ≈ 2 tys. t
  // (ruda ~12%, z tego rdzeń ~20% — skupiona).
  tonnesPerVolume: 1.1e-7,
  // Laser drona: [j.³/s] przy mocy 1 i twardości 0, dzielone przez (0,2 + twardość).
  digVolumeRate: 4.0e5,
  // Ładunek: strefa zmiażdżenia rc = crushK · ∛(E / (0,2 + twardość)),
  // strefa spękań rf = fractureK · ∛(E / (0,15 + odporność)) · (0,6 + 1,2 · kruchość).
  crushK: 70,
  fractureK: 260,
  // Ładunek na powierzchni (nie w otworze) oddaje skale tylko część energii.
  surfaceCoupling: 0.35,
  embedCells: 1.2,
  // Ładunek za słaby (strefa spękań nie sięga powierzchni): skała pęka w środku
  // i słabnie — kolejny ładunek sięga dalej (× (1 + uszkodzenie)^⅓).
  containedDamage: 1.2,
  // Odłamy: poniżej tylu pełnych komórek → okruch (rysowany jak zwykła skała),
  // poniżej dustFill (suma zapełnienia) → pył (przepada). Nowych brył (z siatką,
  // do dalszego kopania) najwyżej maxNewBodies na rozpad — mniejsze też idą
  // w okruchy; wszystkich ciał najwyżej maxBodies.
  pebbleMaxCells: 12,
  dustFill: 1.5,
  maxNewBodies: 14,
  maxBodies: 40,
  maxPebbles: 500,
  // Bryły Voronoi: odstęp ziaren s0 = rf · (a − b · kruchość), przy ładunku
  // × near, na brzegu strefy × 1; nigdy drobniej niż minSeedCells komórek.
  // (0,9 / 0,45 dawało 3–5 brył na strefę: wszystkie dotykały jej brzegu i w twardej
  // skale zostawały przyczepione — z ładunku przy wierzchu wylatywał sam żwir.)
  seedSpacing: [0.5, 0.25],
  seedNear: 0.4,
  minSeedCells: 3,
  // Najwyżej tyle brył na wybuch (kruchy lód dawał ~500 okruchów, pula przepełniona → pył).
  maxSeeds: 80,
  // Zmiażdżona skała: (1 − drobnica) wraca jako żwir (okruchy) z rudą strefy.
  gravelMax: 12,
  // Rozrzut: prędkość przy ładunku ~blastSpeed · E^0,45 · blast, malejąca z odległością.
  blastSpeed: 60,
  blastSpeedMax: 520,
  blastSpin: 0.8,
  // Ruch w próżni (lekkie tłumienie dla grywalności).
  linearDamping: 0.03,
  angularDamping: 0.06,
  // Skała zakotwiczona przez platformę wydobywczą: obrót i dryf gasną (1/s),
  // żeby wiązka lasera nie rysowała łuków po obracającej się bryle.
  anchorDamping: 1.2,
  // Skały leżą pod płaszczyzną gry: wierzch odłamu nie wyjdzie ponad layerTop.
  layerTop: 0,
  layerFloor: -6000,
  // Odłamy zaraz po wybuchu nie zderzają się ze sobą (wychodzą z jednej bryły).
  graceTime: 0.4,
  restitution: 0.3,
  // Promień wiązki lasera drona [j.] i wnikanie punktu kopania pod powierzchnię.
  laserRadius: 70,
  laserBite: 0.35,
  // Co ile zdjętej objętości (w komórkach) sprawdzać, czy skała się rozpadła.
  splitCheckCells: 4,
  // …i najczęściej co tyle sekund na ciało: sprawdzenie to etykietowanie całej siatki
  // (~1 ms przy 48³); trzy lasery zdejmują kilkadziesiąt komórek na sekundę, więc bez
  // odstępu sprawdzenie szło prawie co krok (0,7 ms na krok fizyki gry, 120 Hz).
  splitCheckInterval: 0.2,
  // Uśpienie: ciało / okruch wolniejsze niż sleepSpeed [j./s] i sleepSpin [rad/s] przez
  // sleepTime [s] stoi (bez ruchu i bez zderzeń między śpiącymi); budzi je kopanie,
  // wybuch, wiązka albo uderzenie (względna prędkość > 2 · sleepSpeed). Odłamy po wybuchu
  // klinują się o siebie — bez tego zderzenia kosztowały ~0,3 ms na krok bez końca.
  sleepSpeed: 3,
  sleepSpin: 0.003,
  sleepTime: 0.6,
  // Tarcie w styku (1/s): obrót ciał i okruchów, które się dotykają, gaśnie — zderzenia
  // nie mają momentu, więc zaklinowane odłamy kręciły się w miejscu ~10 s (i nie zasypiały).
  contactSpin: 3,
  // Masa, środek masy i bezwładność ciała po kopaniu najczęściej co tyle sekund (pełny
  // przegląd siatki ~0,6 ms przy 48³; laser zmienia siatkę w każdym kroku fizyki).
  massRecomputeInterval: 0.25,
  // Rdzeń: skorupa nad nim ≥ coreShell promienia skały (i ≥ 2,5 komórki). Rdzeń
  // w strefie spękań odpada od skały (wiązania ze spękaną skałą pękają zawsze, z
  // nienaruszoną — z szansą coreEdgeBreak). Ciągliwy rdzeń (metal) pęka na
  // 1 + log2(1 + E_rdzenia / E_pęknięcia) brył (≤ coreMaxChunks), kruchy — na
  // odłamki (≤ coreMaxShards; drobne lecą jako okruchy rdzenia).
  coreShell: 0.14,
  coreEdgeBreak: 0.15,
  coreMaxChunks: 4,
  coreMaxShards: 24,
  // Metal się nie kruszy, tylko odkształca: strefa zmiażdżenia w bryle metalu × tyle
  // (reszta bryły wylatuje w kawałkach, zmiażdżona część — śrutem).
  coreMetalCrush: 0.45,
  // PIORUN KULISTY (rdzeń skały energetycznej). false = rdzeń z kryształu (gra, dopóki
  // nie ma obrazu i pułapki; demo włącza). Odsłonięty (laser, piła, ładunek) ucieka
  // z geody: energia wyładowania = objętość rdzenia × ballEnergyPerVolume (jednostki
  // ładunku), bezpiecznik [s] zależy od sposobu uwolnienia (wiercenie — długi, wybuch —
  // krótki, zmiażdżenie — prawie od razu). Błądzi (ballDrift) z uskokami (ballDart co
  // ballDartEvery s) — trudno go złapać; unosi się nad skały pod płaszczyznę gry.
  ballLightning: false,
  ballEnergyPerVolume: 2.6e-7,
  ballRadiusK: 0.5,
  ballRadiusMin: 40,
  ballRadiusMax: 170,
  ballFuseDig: [12, 18],
  ballFuseBlast: [1.2, 3.0],
  ballFuseCrush: [0.15, 0.35],
  ballDrift: 150,
  ballDart: [280, 540],
  ballDartEvery: [0.5, 1.6],
  ballHome: 0.35,
  // Wiązka BEZ pułapki: plazmy nie trzyma — bezpiecznik płynie ballBeamDrain razy
  // szybciej, piorun szarpie się, a doprowadzony do statku wybucha. Z pułapką
  // magnetyczną chwyt rośnie ballTrapLock na sekundę (pełny ~1,4 s), bezpiecznik
  // płynie × ballTrapDrain; złapany przy pełnym chwycie w zasięgu `capture`.
  ballBeamDrain: 5,
  ballTrapLock: 0.7,
  ballTrapDrain: 0.3,
  // Wyładowanie rozsadza najbliższą skałę w zasięgu (jak ładunek o energii pioruna
  // na jej powierzchni) i skraca bezpieczniki innych piorunów w pobliżu.
  ballDischargeBlast: true,
  maxBalls: 8
});

// ---------------------------------------------------------------------------
// RUMOWISKA (strumień D planu docs/PLAN-pas-realizm.md, 2026-10-12; decyzja
// użytkownika: „rumowiska w wydobyciu — inna taktyka niż przy monolicie”).
//
// Prawda: ciała ≳ 200 m to zwykle luźne kupy gruzu — porowatość 20–60%, bariera
// obrotu ~2,2 h, głazy do ~1/5 średnicy (Ryugu: Otohime 160 m na 900 m; Bennu:
// próbnik OSIRIS-REx zapadł się na 0,5 m jak w basenie z piłkami); mniejsze to
// monolity. W grze: skała powyżej progu (zależnego od materiału — mocna
// i gęsta, np. metaliczna, częściej monolit, krucha i lekka, np. lód, częściej
// rumowisko) jest zbiorem GŁAZÓW (lita skała typu, mocne wiązania w głazie)
// w REGOLICIE (luźny żwir i pył między nimi — laser kopie go szybko); wiązania
// między głazami i w regolicie są SŁABE. Ruda nie siedzi w jednym rdzeniu:
// ciało macierzyste rozbito i posklejało z kawałków, więc jego rdzeń leży
// w kilku GŁAZACH RDZENIOWYCH (lita ruda, materiał rdzenia), płaszcz w głazach
// wzbogaconych, reszta to skorupa. Ładunek ROZRZUCA głazy (zrywa słabe
// wiązania w strefie rozrzutu; łupie tylko głazy tuż przy sobie), wiązka
// ściągająca wyrywa odsłonięte głazy z kupy. Logika: asteroidMining.js.
//
// Ten blok jest wspólny dla wszystkich typów — próg liczy się z odporności
// i gęstości materiału. Typ może go przesunąć polem `rubble` w ROCK_FRACTURE
// (mnożnik progu średnicy; 0 = nigdy rumowisko) — dopisuje je właściciel tabel
// typów (strumień A), kod czyta je opcjonalnie.

export const RUBBLE_CONFIG = Object.freeze({
  enabled: true,
  // Próg średnicy [j.] dla skały o odporności 0,45 i gęstości 2,7 (skała
  // neutralna); materiał przesuwa go × (0,55 + toughness) · (0,75 + 0,1 · min(gęstość, 8)).
  // Skały PLAY mają 80–2600 j. (rozkład potęgowy) — rumowiskiem jest ~co dziesiąta.
  minDiameter: 360,
  // Pasmo przejścia: szansa rośnie od band[0] do band[1] × próg (wspólny hash id skały).
  band: Object.freeze([0.8, 1.3]),
  // Mnożnik progu per typ skały (id ROCK_TYPES, nie id materiału — 'rock_c' liczy się jako
  // wypełniacz węglowy): typy C / D (Bennu, Ryugu) to zwykle rumowiska, M i platynowce
  // (lite żelazo-nikiel, Psyche) — monolity. Pole `rubble` w ROCK_FRACTURE bierze górę.
  // carbon_ice — C z lodem w rdzeniach (rodzina Themis, A2 planu pasa): jak carbon.
  typeBias: Object.freeze({ carbon: 0.8, carbon_ice: 0.8, primitive: 0.8, rock_c: 0.85, metal: 1.5, platinum: 1.5 }),
  // Porowatość makro (pustki między głazami) — gęstość ciała × (1 − porowatość).
  porosity: Object.freeze([0.25, 0.5]),
  // Głazy: promień ≤ boulderMax średniego promienia skały, ≥ max(boulderMinCells
  // komórek, boulderMinFrac promienia); rozkład potęgowy N(> r) ∝ r^−sizeSlope;
  // upakowanie do packing objętości, nachodzenie ≤ (1 − overlap) sumy promieni.
  boulderMax: 0.26,
  boulderMinCells: 2.2,
  boulderMinFrac: 0.08,
  sizeSlope: 2.3,
  packing: 0.62,
  overlap: 0.82,
  maxBoulders: 200,
  placeTries: 24,
  boulderLump: 0.3,
  // Ruda: objętość głazów rdzeniowych = objętość rdzenia monolitu tego typu (ta
  // sama ekonomia), w coreBoulders[0..1] głazach; głazy płaszcza = mantleShare ×
  // tyle; regolit ma regolithOre rudy skorupy (zwietrzały, przesiany).
  coreBoulders: Object.freeze([2, 8]),
  mantleShare: 2.5,
  regolithOre: 0.6,
  // Laser: regolit (luźny) schodzi regolithDig razy szybciej niż głaz.
  regolithDig: 3.5,
  // Ładunek: strefa rozrzutu = reach × strefa spękań monolitu (porowata kupa
  // tłumi falę, ale prawie nic jej nie trzyma); głazy pękają tylko w
  // boulderFracture × strefa spękań; regolit w regolithBlow × strefa rozrzutu
  // wylatuje (regolithFines przepada jako pył, reszta żwirem); głaz odpada, gdy
  // ≥ detachShare jego komórek (albo środek) leży w strefie rozrzutu. Prędkość
  // odłamów × blast (energia idzie w zgniatanie porów — kupa rozsypuje się wolno).
  reach: 1.2,
  boulderFracture: 0.35,
  regolithBlow: 0.9,
  regolithFines: 0.55,
  detachShare: 0.5,
  blast: 0.7,
  // Kierunek wyrzutu spłaszczony do płaszczyzny gry (0 = jak monolit, 1 = poziomo od ładunku):
  // skały leżą pod stropem warstwy — ruch ku kamerze zjada odbicie od stropu.
  blastFlatten: 0.7,
  // Wiązka ściągająca wyrywa z rumowiska najwyżej jeden ODSŁONIĘTY głaz (≥
  // pluckExposure jego komórek na powierzchni, ≥ pluckMinCells komórek, lżejszy
  // niż udźwig) co pluckInterval s — głaz rdzeniowy ma pierwszeństwo.
  pluckInterval: 1.2,
  pluckExposure: 0.3,
  pluckMinCells: 8,
  pluckSpeed: 25
});

/**
 * Próg średnicy rumowiska [j.] dla materiału m (Infinity — nigdy; skała energetyczna z geodą).
 * typeId — id typu z ROCK_TYPES (domyślnie id materiału; wypełniacz 'rock_c' ma materiał 'rock').
 */
export function rubbleThreshold(m, cfg = RUBBLE_CONFIG, typeId = m?.id) {
  if (!m || m.composition?.plasma) return Infinity;
  const k = ROCK_FRACTURE[typeId]?.rubble;
  if (k === 0) return Infinity;
  const base = cfg.minDiameter * (0.55 + m.toughness) * (0.75 + 0.1 * Math.min(m.density, 8));
  return base * (k > 0 ? k : (cfg.typeBias?.[typeId] ?? 1));
}

/** Szansa (0 … 1), że skała materiału m (typu typeId) o średnicy `diameter` jest rumowiskiem. */
export function rubbleChance(m, diameter, cfg = RUBBLE_CONFIG, typeId = m?.id) {
  const d0 = rubbleThreshold(m, cfg, typeId);
  if (!Number.isFinite(d0)) return 0;
  const a = cfg.band[0] * d0, b = cfg.band[1] * d0;
  const t = Math.min(1, Math.max(0, (diameter - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Materiał typu (indeks ROCK_TYPES albo nazwa): gęstość, twardość, pękanie, skład. */
export function rockMaterial(type) {
  const id = typeof type === 'number' ? (ROCK_TYPES[type] || 'rock') : (type || 'rock');
  const bulk = ASTEROID_MATERIAL[id] || EXTRA_BULK[id] || EXTRA_BULK.rock;
  const fr = ROCK_FRACTURE[id] || ROCK_FRACTURE.rock;
  const comp = ROCK_COMPOSITION[id] || ROCK_COMPOSITION.rock;
  return {
    id: NEUTRAL_MATERIAL_OF[id] || id,
    density: bulk.mass,
    hardness: bulk.hardness,
    toughness: fr.toughness,
    brittleness: fr.brittleness,
    cleavage: fr.cleavage,
    fines: fr.fines,
    blast: fr.blast,
    volatile: fr.volatile || 1,
    composition: comp
  };
}

/**
 * Energia wyładowania pioruna kulistego z rdzenia o objętości `volume` [j.³]
 * (jednostki ładunku: S 0,5 · M 2 · L 8 · XL 32).
 */
export function ballEnergyForVolume(volume, cfg = MINING_CONFIG) {
  return Math.max(0, volume) * cfg.ballEnergyPerVolume;
}

/** Surowiec gry (resources.js) z typu rudy; null = skała bez wartości. */
export function oreResourceOf(typeId) {
  if (!typeId || typeId === 'rock' || typeId === 'rock_c') return null;
  if (typeId === 'energy') return ASTEROID_YIELD.crystal;
  return ASTEROID_YIELD[typeId] || null;
}

/**
 * Zasięgi ładunku energii E w materiale m (bez sprzężenia i uszkodzeń):
 * { crush, fracture } [j.]. Do HUD-u i testów („jaki ładunek na tę skałę”).
 */
export function chargeReach(m, energy, cfg = MINING_CONFIG) {
  const E = Math.max(0, energy) * (m.volatile || 1);
  return {
    crush: cfg.crushK * Math.cbrt(E / (0.2 + m.hardness)),
    fracture: cfg.fractureK * Math.cbrt(E / (0.15 + m.toughness)) * (0.6 + 1.2 * m.brittleness)
  };
}

/** Najmniejsza energia ładunku, którego strefa spękań sięga `depth` [j.] w materiale m. */
export function chargeForDepth(m, depth, cfg = MINING_CONFIG) {
  const k = cfg.fractureK * (0.6 + 1.2 * m.brittleness);
  const ratio = Math.max(0, depth) / k;
  return (ratio * ratio * ratio) * (0.15 + m.toughness) / (m.volatile || 1);
}
