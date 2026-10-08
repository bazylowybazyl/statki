// src/data/shipModules.js
//
// MODUŁY OKRĘTU — nowe gniazdo kadłuba (docs/PLAN-fitowanie.md § 4.3, decyzje 2026-10-08). Jeden moduł naraz, stałe
// premie. Moduł jest CZĘŚCIĄ: leży w hangarze gracza (`partStock` w zapisie) albo w gnieździe modułu kadłuba
// (`hullModules`); zdjęty wraca do hangaru. Cena stała na start (potem z gospodarki — plan § 4.10).
//
// Efekty (czyste dane, stosuje je index.html):
//   shield      — mnożniki tarczy kadłuba (max, regeneracja, opóźnienie regeneracji, twardość na przebicie)
//   classMods   — mnożniki broni danej KLASY (`weaponClass` w weapons.js) przez źródło 'fit' modyfikatorów okrętu
//                 (src/game/shipModifiers.js: range, projectileSpeed); `rangeCap` — sufit zasięgu po premii [j.]
//   typeMap     — zamiana typów gniazd kadłuba (Komory rakietowe: special → missile, te same pozycje)
//   missileAmmo — mnożnik magazynków broni w gniazdach `missile`

export const SHIP_MODULES = Object.freeze({
  shield_booster: Object.freeze({
    id: 'shield_booster',
    label: 'WZMACNIACZ TARCZ',
    short: 'TARCZE',
    desc: 'tarcza ×1,4 · regeneracja ×1,5 · szybszy powrót · twardość ×1,5',
    price: 12000,
    shield: Object.freeze({ max: 1.4, regen: 1.5, delay: 0.7, hardness: 1.5 })
  }),
  ballistic_computer: Object.freeze({
    id: 'ballistic_computer',
    label: 'KOMPUTER BALISTYCZNY',
    short: 'ZASIĘG',
    desc: 'działa snajperskie: zasięg ×1,5 · pocisk ×1,4 (do 18 km)',
    price: 14000,
    classMods: Object.freeze({ sniper: Object.freeze({ range: 1.5, projectileSpeed: 1.4 }) }),
    // Wzrok Atlasa (fogOfWar.js) — dalej broń i tak nie ma celu; broń dłuższa z natury (Mjolnir 20 km) nie rośnie.
    rangeCap: 18000
  }),
  missile_cells: Object.freeze({
    id: 'missile_cells',
    label: 'KOMORY RAKIETOWE',
    short: 'KOMORY',
    desc: 'gniazda baterii → wyrzutnie rakiet · magazynki ×1,5',
    price: 16000,
    typeMap: Object.freeze({ special: 'missile' }),
    missileAmmo: 1.5
  })
});

export const SHIP_MODULE_IDS = Object.freeze(Object.keys(SHIP_MODULES));

// Systemy F, które są CZĘŚCIĄ do kupienia (nie siedzą w kadłubie): silniki manewrowe Atlasa. Szarża i systemy
// domyślne kadłubów są wbudowane (cena 0).
export const SHIP_SYSTEM_PART_PRICES = Object.freeze({ maneuver: 10000 });

// Gniazda modułów (D5 — propozycja): fregaty 0, reszta kadłubów gracza 1.
const NO_MODULE_HULLS = new Set(['frigate', 'corvus', 'pirate_frigate']);

export function shipModuleById(id) {
  return SHIP_MODULES[String(id || '')] || null;
}

export function moduleSlotsForHull(hullId) {
  return NO_MODULE_HULLS.has(String(hullId || '')) ? 0 : 1;
}

/** Zamiana typów gniazd przez moduł (`special` → `missile` …) albo null. */
export function moduleTypeMap(moduleId) {
  return shipModuleById(moduleId)?.typeMap || null;
}

/** Typ gniazda po zamianie przez moduł. */
export function moduleSlotType(baseType, moduleId) {
  const map = moduleTypeMap(moduleId);
  return (map && map[baseType]) || baseType;
}

const SHIELD_NONE = Object.freeze({ max: 1, regen: 1, delay: 1, hardness: 1 });
/** Mnożniki tarczy kadłuba z modułu (bez modułu — jedynki). */
export function moduleShieldMul(moduleId) {
  return shipModuleById(moduleId)?.shield || SHIELD_NONE;
}

/** Mnożnik magazynków w gniazdach `missile`. */
export function moduleMissileAmmoMul(moduleId) {
  return Number(shipModuleById(moduleId)?.missileAmmo) || 1;
}

/**
 * Pola źródła 'fit' modyfikatorów okrętu (setModifierSource) dla modułu albo null (moduł bez wpływu na broń).
 * Kształt zgodny z src/game/shipModifiers.js: { classRange: { klasa: mul }, classProjectileSpeed: {…}, rangeCap }.
 */
export function moduleModifierSource(moduleId) {
  const mod = shipModuleById(moduleId);
  if (!mod?.classMods) return null;
  const classRange = {};
  const classProjectileSpeed = {};
  for (const [cls, m] of Object.entries(mod.classMods)) {
    if (m.range) classRange[cls] = m.range;
    if (m.projectileSpeed) classProjectileSpeed[cls] = m.projectileSpeed;
  }
  return { classRange, classProjectileSpeed, rangeCap: Number(mod.rangeCap) || 0 };
}
