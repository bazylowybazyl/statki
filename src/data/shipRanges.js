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
  megafreighter: 'capital',
  // Kadłuby cywilne ruchu v2 (awans do NPC, kadłuby dev; audyt zasięgów 2026-11-11): jawnie klasa fregaty = dzisiejszy
  // wzrok awaryjny 5 km i mnożnik broni 1. Klasy wg rozmiaru (np. heavy_freighter — capital) czekają na decyzję
  // użytkownika (docs/AUDYT-zasiegi-jednostek-2026-11-11.md). Dron naprawczy widzi jak myśliwiec (fogOfWar.js).
  inter_station_shuttle: 'frigate', container_ship: 'frigate', long_haul_freighter: 'frigate', heavy_freighter: 'frigate',
  heavy_harvester: 'frigate', belter: 'frigate', surveyor: 'frigate', refinery_tender: 'frigate', tanker: 'frigate',
  salvage_hauler: 'frigate', construction_tug: 'frigate', distress_beacon_ship: 'frigate', rescue_ship: 'frigate',
  repair_drone: 'frigate',
  // promy z ludźmi (workforce W7, kopie frachtowców bazowych): jak ich frachtowce bazowe
  crew_shuttle: 'frigate', crew_liner: 'frigate', colony_liner: 'frigate',
  // kadłuby robocze NPC w bańce (E24, src/data/workHulls.js): dzisiejszy wzrok awaryjny (klasa fregaty)
  work_zlomiarz: 'frigate', work_paszcza: 'frigate', work_mlyn: 'frigate', work_rafineria: 'frigate',
  work_rampowiec: 'frigate', work_dzwig: 'frigate'
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
