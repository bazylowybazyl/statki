// Wspólna skala zasięgów kadłuba: broń, wzrok i maksymalne oddalenie kamery.
// Rozmiary gniazd S/M/L/Capital nadal określają zgodność montażu i odmianę broni.
import { SHIP_FLIGHT_SPECS } from './shipFlightSpecs.js';

export const SHIP_RANGE_PROFILES = Object.freeze({
  frigate: Object.freeze({ weaponRange: 1, visionRange: 5000 }),
  destroyer: Object.freeze({ weaponRange: 1.25, visionRange: 8000 }),
  battleship: Object.freeze({ weaponRange: 1.5, visionRange: 11000 }),
  capital: Object.freeze({ weaponRange: 1.75, visionRange: 14000 }),
  supercapital: Object.freeze({ weaponRange: 2, visionRange: 18000 })
});

export const SHIP_WEAPON_BASE_RANGE_SCALE = 0.5;
export const SUPERCAPITAL_MIN_ZOOM = 0.035;

const HULL_CLASSES = Object.assign(Object.create(null), {
  atlas: 'supercapital', supercapital: 'supercapital',
  frigate: 'frigate', frigate_pd: 'frigate', frigate_laser: 'frigate', corvus: 'frigate',
  destroyer: 'destroyer', battleship: 'battleship',
  carrier: 'capital', capital: 'capital', capital_carrier: 'capital',
  megafreighter: 'capital'
});
for (const id in SHIP_FLIGHT_SPECS) {
  const cls = SHIP_FLIGHT_SPECS[id].flightClass;
  HULL_CLASSES[id] = cls === 'carrier' ? 'capital' : cls;
}
Object.freeze(HULL_CLASSES);

/** Kadłub jest ważniejszy niż ogólny typ „player” / „capital” i flaga isCapitalShip. */
export function shipRangeClassOf(entityOrHull) {
  if (typeof entityOrHull === 'string') return HULL_CLASSES[entityOrHull] || null;
  const e = entityOrHull;
  if (!e || e.fighter) return null;
  return HULL_CLASSES[e.activeHullId] || HULL_CLASSES[e.shipFrame] || HULL_CLASSES[e.type]
    || (e.isPlayer ? 'supercapital' : (e.isCapitalShip ? 'capital' : null));
}

/** Premia kadłuba dotyczy uzbrojenia okrętu; obrona punktowa i broń myśliwców mają własne pasma. */
export function usesShipWeaponRange(def) {
  const mount = def?.mountType;
  return mount === 'main' || mount === 'special' || mount === 'missile'
    || mount === 'special_missile' || mount === 'builtin';
}

export function hullWeaponRangeMul(entityOrHull, def) {
  if (!usesShipWeaponRange(def)) return 1;
  return SHIP_RANGE_PROFILES[shipRangeClassOf(entityOrHull)]?.weaponRange || 1;
}

/** Atlas zachowuje 0,035; szerokość najdalszego kadru rośnie proporcjonalnie do wzroku klasy. */
export function shipMinZoom(entityOrHull) {
  const profile = SHIP_RANGE_PROFILES[shipRangeClassOf(entityOrHull)];
  return profile ? SUPERCAPITAL_MIN_ZOOM * (SHIP_RANGE_PROFILES.supercapital.visionRange / profile.visionRange)
    : SUPERCAPITAL_MIN_ZOOM;
}
