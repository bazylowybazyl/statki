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
// miedzi ma z wierzchu ~6% miedzi, a rdzeń to prawie czysta miedź — gracz
// musi dokopać się do środka albo wysadzić rdzeń i wyłapać odłamki.
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
  energy: Object.freeze({ toughness: 0.34, brittleness: 0.85, cleavage: 0.4, fines: 0.25, blast: 1.2, volatile: 1.6 })
});

// Gęstość [g/cm³] i twardość typów spoza ASTEROID_MATERIAL (rudy gry mają tam swoje).
const EXTRA_BULK = Object.freeze({
  rock: Object.freeze({ mass: 2.7, hardness: 0.45 }),
  energy: Object.freeze({ mass: 3.0, hardness: 0.5 })
});

/**
 * Skład: udział rudy (0 … 1) w skorupie, płaszczu i rdzeniu, siła żył
 * (dopisek w wąskich pasmach) i promień rdzenia jako ułamek promienia skały.
 * coreType — ruda rdzenia, jeśli inna niż typ skały; hiddenCore — szansa, że
 * skała neutralna kryje rdzeń pospolitej rudy (resztę rdzeni ma pustą skałę).
 */
const ORE_PROFILE = Object.freeze({ crust: 0.06, mantle: 0.3, core: 0.93, veins: 0.35, coreRadius: [0.24, 0.34] });
export const ROCK_COMPOSITION = Object.freeze({
  iron: ORE_PROFILE,
  copper: ORE_PROFILE,
  silicon: Object.freeze({ ...ORE_PROFILE, crust: 0.1, mantle: 0.35 }),
  titan: Object.freeze({ ...ORE_PROFILE, crust: 0.05, mantle: 0.28, core: 0.9 }),
  crystal: Object.freeze({ ...ORE_PROFILE, crust: 0.04, mantle: 0.25, core: 0.95, veins: 0.5 }),
  // Kometa: brudny lód na wierzchu, czysty w środku.
  ice: Object.freeze({ crust: 0.45, mantle: 0.72, core: 0.96, veins: 0.15, coreRadius: [0.3, 0.42] }),
  uran: Object.freeze({ ...ORE_PROFILE, crust: 0.03, mantle: 0.22, core: 0.88, coreRadius: [0.2, 0.3] }),
  rock: Object.freeze({ crust: 0, mantle: 0, core: 0, veins: 0, coreRadius: [0.22, 0.32], hiddenCore: 0.22 }),
  // Naładowana skała: rdzeń z surowego kryształu.
  energy: Object.freeze({ ...ORE_PROFILE, crust: 0.03, mantle: 0.2, core: 0.9, coreType: 'crystal' })
});

/** Rudy pospolite, które może kryć rdzeń skały neutralnej. */
export const HIDDEN_CORE_TYPES = Object.freeze(['iron', 'silicon', 'copper', 'ice']);

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
  splitCheckCells: 4
});

/** Materiał typu (indeks ROCK_TYPES albo nazwa): gęstość, twardość, pękanie, skład. */
export function rockMaterial(type) {
  const id = typeof type === 'number' ? (ROCK_TYPES[type] || 'rock') : (type || 'rock');
  const bulk = ASTEROID_MATERIAL[id] || EXTRA_BULK[id] || EXTRA_BULK.rock;
  const fr = ROCK_FRACTURE[id] || ROCK_FRACTURE.rock;
  const comp = ROCK_COMPOSITION[id] || ROCK_COMPOSITION.rock;
  return {
    id,
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

/** Surowiec gry (resources.js) z typu rudy; null = skała bez wartości. */
export function oreResourceOf(typeId) {
  if (!typeId || typeId === 'rock') return null;
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
