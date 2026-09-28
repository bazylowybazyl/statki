// src/game/asteroidRockKinds.js
//
// Rodzaje skał nowego pola asteroid: typy (7 rud + skała NEUTRALNA, czyli
// wypełniacz bez surowca), rodziny kształtów banku (src/3d/asteroids/rockBank.js) i reguły,
// które je łączą — kształt zależy od typu i rozmiaru, skład od głębokości
// w polu (obrzeża prawie same skały neutralne, rudy głębiej, rzadkie w rdzeniu).
//
// Moduł bez three i DOM-u: czyta go generator pola (asteroidBeltField.js),
// bank kształtów i materiał skał. Testy: tests/asteroidBeltField.test.mjs.

import { ASTEROID_TYPES } from '../data/asteroidTypes.js';

/**
 * Typy skał pola: indeksy 0–6 = ASTEROID_TYPES (rudy gry), 7 = skała neutralna.
 * Dane gry (asteroidTypes.js) znają tylko rudy — neutralna żyje wyłącznie tu.
 */
// 8 = skała ENERGETYCZNA: naładowana, wywołuje burze (asteroidStorms.js) —
// powstaje tylko w komórkach burz gęstych pól, nie ze składu pasa.
export const ROCK_TYPES = Object.freeze([...ASTEROID_TYPES, 'rock', 'energy']);
export const ROCK_TYPE_INDEX = Object.freeze(Object.fromEntries(ROCK_TYPES.map((t, i) => [t, i])));
// Jawnie po nazwie: nowe typy dopisuje się NA KOŃCU ROCK_TYPES (indeksy
// istniejących, w tym wypełniacza = 7, się nie zmieniają).
export const NEUTRAL_TYPE = ROCK_TYPE_INDEX.rock;
export const ENERGY_TYPE = ROCK_TYPE_INDEX.energy;

export const ROCK_TYPE_LABELS_PL = Object.freeze({
  iron: 'żelazo', copper: 'miedź', silicon: 'krzem', titan: 'tytan',
  crystal: 'kryształ', ice: 'lód', uran: 'uran', rock: 'skała neutralna',
  energy: 'energetyczna'
});

/**
 * Wartość rudy (0 pospolita … 2 rzadka): rzadkie typy pojawiają się dopiero
 * w głębi pola. Lód jest pospolity (Kuiper to lód), uran i kryształ rzadkie.
 */
export const ORE_TIER = Object.freeze({ iron: 0, silicon: 0, ice: 0, copper: 1, titan: 1, crystal: 2, uran: 2, energy: 2 });

/**
 * Rodziny kształtów banku. Bank ma SHAPE_VARIANTS wariantów na rodzinę,
 * indeks kształtu = rodzina · SHAPE_VARIANTS + wariant.
 */
export const ROCK_FAMILIES = Object.freeze([
  Object.freeze({ id: 'potato', label: 'bryła' }),
  Object.freeze({ id: 'angular', label: 'kanciasta' }),
  Object.freeze({ id: 'cratered', label: 'kraterowana' }),
  Object.freeze({ id: 'ridged', label: 'z grzbietem' }),
  Object.freeze({ id: 'oval', label: 'owalna' }),
  Object.freeze({ id: 'binary', label: 'podwójna' }),
  Object.freeze({ id: 'disc', label: 'dysk' }),
  Object.freeze({ id: 'shard', label: 'odłam' }),
  Object.freeze({ id: 'rubble', label: 'gruzowisko' }),
  Object.freeze({ id: 'bowl', label: 'wielki krater' })
]);
export const FAMILY = Object.freeze(Object.fromEntries(ROCK_FAMILIES.map((f, i) => [f.id, i])));
export const SHAPE_VARIANTS = 4;
export const SHAPE_COUNT = ROCK_FAMILIES.length * SHAPE_VARIANTS;

// Wagi rodzin per typ (kolejność = ROCK_FAMILIES). Żelazo: gładkie, „stopione”
// bryły i owale; tytan i kryształ: bloki i odłamy (warstwy, łupliwość); lód:
// komety — podwójne i owalne; krzem: kraterowane gruzowiska (typ S).
const W = (potato, angular, cratered, ridged, oval, binary, disc, shard, rubble, bowl) =>
  Object.freeze([potato, angular, cratered, ridged, oval, binary, disc, shard, rubble, bowl]);
export const FAMILY_WEIGHTS_BY_TYPE = Object.freeze({
  iron: W(3, 0.5, 0.6, 1, 2.5, 1.2, 0.3, 0.8, 0.2, 0.4),
  copper: W(1.5, 2.5, 1, 1, 1, 0.6, 0.3, 2, 0.6, 0.6),
  silicon: W(2, 1, 3, 1, 1, 1, 0.5, 1, 2.5, 1.5),
  titan: W(1, 3, 0.8, 1.5, 1, 0.5, 0.8, 3, 0.5, 0.5),
  crystal: W(1, 2.5, 0.5, 1, 0.7, 0.5, 0.3, 3, 0.3, 0.8),
  ice: W(2.5, 0.8, 1, 1, 2, 2.5, 1.2, 0.6, 0.8, 0.8),
  uran: W(2.5, 1, 1, 0.5, 1, 1, 0.3, 1, 2, 0.8),
  rock: W(3, 2, 3, 1, 1.5, 1, 0.6, 2, 1.5, 1),
  // Energetyczna: popękane bloki i odłamy z grzbietami (sieć pęknięć ładunku).
  energy: W(1, 2.5, 0.5, 2, 0.7, 0.6, 0.4, 2.5, 0.6, 0.5)
});

// Rozmiar: drobnica to głównie odłamy i kanciaste okruchy, duże skały częściej
// są gruzowiskami, podwójne i mają wielkie kratery.
const SMALL_BIAS = W(1, 1.5, 0.8, 1, 1, 0.5, 0.8, 2.2, 0.2, 0.3);
const LARGE_BIAS = W(1, 0.8, 1.2, 1, 1, 1.5, 1, 0.4, 2.2, 1.6);

function smooth01(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Rodzina kształtu dla typu i średnicy; u ∈ [0, 1). Deterministyczne.
 */
export function pickFamily(typeIndex, diameter, u) {
  const weights = FAMILY_WEIGHTS_BY_TYPE[ROCK_TYPES[typeIndex]] || FAMILY_WEIGHTS_BY_TYPE.rock;
  const small = 1 - smooth01(120, 320, diameter);
  const large = smooth01(700, 1800, diameter);
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    total += weights[i] * (1 + (SMALL_BIAS[i] - 1) * small) * (1 + (LARGE_BIAS[i] - 1) * large);
  }
  let t = u * total;
  for (let i = 0; i < weights.length; i++) {
    t -= weights[i] * (1 + (SMALL_BIAS[i] - 1) * small) * (1 + (LARGE_BIAS[i] - 1) * large);
    if (t <= 0) return i;
  }
  return weights.length - 1;
}

/** Indeks kształtu w banku: rodzina · warianty + wariant z u ∈ [0, 1). */
export function pickShape(typeIndex, diameter, uFamily, uVariant) {
  const family = pickFamily(typeIndex, diameter, uFamily);
  return family * SHAPE_VARIANTS + Math.min(SHAPE_VARIANTS - 1, Math.floor(uVariant * SHAPE_VARIANTS));
}

export function familyOfShape(shape) {
  return Math.floor(shape / SHAPE_VARIANTS);
}

/**
 * Skład wg głębokości w polu. depth ∈ [0, 1]: 0 = rzadki pas i obrzeże pola,
 * 1 = rdzeń. Obrzeża to wypełniacz (skały neutralne) z odrobiną pospolitej
 * rudy — gracz musi wlecieć głębiej po surowce, a rzadkie rudy są w rdzeniu.
 */
export const ORE_DEPTH_CONFIG = Object.freeze({
  oreOutside: 0.14,   // udział rud poza polami i na samym obrzeżu
  oreCore: 0.86,      // udział rud w rdzeniu pola
  depth0: 0.2,        // głębokość, od której rud przybywa
  depth1: 0.92,       // pełny udział
  // Rudy średnie (miedź, tytan) i rzadkie (kryształ, uran): mnożnik wagi.
  midFloor: 0.25, midDepth: [0.15, 0.55],
  rareFloor: 0.04, rareDepth: [0.5, 0.95]
});

export function oreShareAtDepth(depth, cfg = ORE_DEPTH_CONFIG) {
  return cfg.oreOutside + (cfg.oreCore - cfg.oreOutside) * smooth01(cfg.depth0, cfg.depth1, depth);
}

/** Mnożnik wagi typu rudy na głębokości (pospolite 1, rzadkie dopiero w rdzeniu). */
export function oreTierFactor(typeIndex, depth, cfg = ORE_DEPTH_CONFIG) {
  const tier = ORE_TIER[ROCK_TYPES[typeIndex]] ?? 0;
  if (tier === 0) return 1;
  if (tier === 1) return cfg.midFloor + (1 - cfg.midFloor) * smooth01(cfg.midDepth[0], cfg.midDepth[1], depth);
  return cfg.rareFloor + (1 - cfg.rareFloor) * smooth01(cfg.rareDepth[0], cfg.rareDepth[1], depth);
}
