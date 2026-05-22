/**
 * Konfiguracja fizyki asteroid - masa, twardość, HP, kolizje.
 *
 * Wszystkie wartości tutaj są LIVE-tweakable - zmień i odśwież grę. Tutaj też
 * konfigurujesz wielkość siatki heksów per rozmiar oraz parametry destructora.
 *
 * Filozofia: asteroidy są KRUCHE (brittle). To NIE jest plastyczna stal.
 *   - Hit przekraczający próg → cell pęka NATYCHMIAST (brak stress build-up)
 *   - Pęknięcia propagują się radialnie z krótkim falloffem
 *   - Po impulsie destruktor "śpi" - nie kosztuje per-frame
 *   - Zero GPU softbody, zero elasticity, zero spring-mass
 */

// =============================================================================
// MATERIAŁY - mass × hardness per typ
// =============================================================================

/**
 * Realne gęstości materiałów (g/cm³) skalowane do skali gry.
 * Hardness: 0.0 (jak puch) - 1.0 (jak diament).
 */
export const ASTEROID_MATERIAL = {
  ice:     { mass: 0.9,  hardness: 0.10 },  // Kuiper - łatwy łup, kruchy
  silicon: { mass: 2.3,  hardness: 0.35 },  // Lekki, kruchy
  crystal: { mass: 2.7,  hardness: 0.20 },  // Jak szkło - bardzo kruchy
  titan:   { mass: 4.5,  hardness: 0.95 },  // Najtwardszy
  iron:    { mass: 7.8,  hardness: 0.70 },  // Twardy
  copper:  { mass: 8.9,  hardness: 0.55 },  // Średnio
  uran:    { mass: 19.0, hardness: 0.60 },  // Bardzo gęste, średnia twardość
};

/**
 * Legacy mass for mining/fallback damage curves. Full contact physics uses
 * SIZE_COLLISION_MASS_MULTIPLIER below.
 */
export const SIZE_MASS_MULTIPLIER = {
  S:   1,
  M:   8,
  L:   80,
  BIG: 800,
};

/**
 * Masa do pelnych kolizji heksowych. `getMass()` zostaje lekka/legacy dla ekonomii
 * i istniejacego fallbacku, a aktywne asteroidy heksowe dostaja mase porownywalna
 * ze statkami kapitalnymi.
 */
export const SIZE_COLLISION_MASS_MULTIPLIER = {
  S:   300,
  M:   2600,
  L:   17000,
  BIG: 115000,
};

/**
 * Extra contact authority for asteroid ramming. Inertial collision mass stays
 * material-based, but large rocks should behave more like a wall in ship-hex
 * contacts. Small rocks keep normal mass so they do not overrun capital ships.
 */
export const SIZE_RAMMING_MASS_MULTIPLIER = {
  S:   0.35,
  M:   0.85,
  L:   2.25,
  BIG: 7.5,
};

export const SIZE_HP_MULTIPLIER = {
  S:   1,
  M:   4,
  L:   16,
  BIG: 64,
};

/** Bazowe HP dla hardness=1.0, size=S. Tweak żeby skalować całą krzywą. */
export const SIZE_HP_BASE = 400;

// =============================================================================
// HEX GRID - wielkość siatki destruktora per rozmiar asteroidy
// =============================================================================

/**
 * Wielkość siatki heksów (NxN). Większa siatka = wolniejsze niszczenie + więcej detali.
 * S=5×5=25 cells (S asteroidy szybko się rozsypują), BIG=11×11=121 (BIG długo kruszysz).
 *
 * UWAGA: HP per cell = asteroid.hpMax / (gridSize * gridSize).
 * Czyli S i BIG mają TĘ SAMĄ proporcję HP do cell - tylko BIG ma więcej cells.
 */
export const HEX_GRID_SIZE = {
  S:   5,    // 25 cells
  M:   7,    // 49 cells
  L:   9,    // 81 cells
  BIG: 11,   // 121 cells
};

// =============================================================================
// BRITTLE DESTRUCTOR - parametry kruchości
// =============================================================================

export const HEX_BRITTLE_CONFIG = {
  /** Promień rażenia per hit (w cells). 2 = 5x5 cluster pęka jednym strzałem. */
  impactRadius: 1,

  /** Ile damage przenoszone na sąsiednie cells (0..1). 0 = punktowo, 1 = full propagation. */
  propagationFactor: 0.5,

  /** Próg HP cell, poniżej którego cell się odłamuje. */
  cellEjectThreshold: 0,

  /** Promień rdzeniowych cells (od centrum). Pełna destrukcja gdy core > coreEjectFraction. */
  coreRadius: 1,
  coreEjectFraction: 0.5,

  /** Klatki "burst sim" po hicie - destruktor liczy efekt kaskadowego pękania. */
  burstSimFrames: 6,

  /** Pula pre-alokowanych hex bodies. Max ile asteroid może być uszkodzonych naraz. */
  hexPoolSize: 200,

  /** Per cell ejected: ile fragmentów drop na świat (do późniejszego mininga / debris). */
  fragmentsPerCell: 1,
};

// =============================================================================
// KOLIZJE statek ↔ asteroida
// =============================================================================

export const COLLISION_CONFIG = {
  /** Min relative velocity (u/s) dla zarejestrowanej kolizji. */
  minImpactVelocity: 30,

  /** Mass ratio = asteroid.mass / ship.mass.
   *  - ratio < lightRatio: asteroida rozsypuje się o statek, minimalne damage statku
   *  - lightRatio ≤ ratio ≤ heavyRatio: wzajemne damage proporcjonalne, odbicie
   *  - ratio > heavyRatio: ship gnieciony, asteroida ledwo dostaje  */
  lightRatio: 0.5,
  heavyRatio: 5.0,

  /** Damage = ke * scale * (hardness mod). Skala dobrana dla PLAYER_MASS=800k.
   *  Cel: BIG iron @ v=200 ramming → ~1500 ship damage (ship 12k hp = 8 hits),
   *       ~500 asteroid damage (BIG iron 17.9k hp = 35 hits).
   *  S iron @ v=200 → ~1 ship damage / 0.5 ast damage (pebble - mining laser job). */
  shipDamageScale: 1.2e-5,
  asteroidDamageScale: 4e-6,

  /** Coefficient of restitution (0 = lepkie, 1 = idealnie elastyczne).
   *  0.4-0.5 = realistyczne dla skała+metal. */
  bounceCoeff: 0.45,

  /** Damage dla bardzo ciężkich asteroid (crush) - mnożnik na top damageu. */
  crushDamageMultiplier: 3.0,

  /** Min bezpieczna odległość = (ship.radius + asteroid.scale*0.5) × tej liczby.
   *  Po odbiciu statek jest wypychany żeby nie reentrował kolizji. */
  separationPadding: 1.05,

  /** Promień kolizji asteroidy jako frakcja jej scale (rozmiaru sprite).
   *  PNG ma ~20% transparent padding wokół kamienia, więc rzeczywiste piksele
   *  zajmują ~80% diameter = 0.40-0.42 radius factor. 0.42 = lekko hojnie
   *  (lepiej trafiać krawędzie niż mieć false misses). */
  collisionRadiusFactor: 0.42,

  /** Tightening factor dla ellipse statku. Sprite ma "puste" obszary (cockpit
   *  detale, wings overlays itp.) - realne body to ~60% rozmiaru sprite. */
  shipCollisionTighten: 0.6,

  // === RUCH ASTEROID po popchnięciu ===

  /** Drag per klatkę (60 fps). 1.0 = brak (idealna próżnia), 0.99 = szybki spadek.
   *  Default 0.998 ≈ 11% spadek po sekundzie. Pchnięta asteroida dryfuje minuty
   *  zanim się zatrzyma. */
  asteroidDrag: 1.0,

  /** Poniżej tej prędkości (u/s) asteroida snapuje do v=0 - wychodzi z movingAsteroids. */
  asteroidSleepVelocity: 0.01,

  /** Cap na prędkość asteroidy żeby BIG bumpnięta szybkim Atlasem nie poleciała
   *  w kosmos jak rakieta. */
  asteroidMaxVelocity: 800,
};

// =============================================================================
// HELPERS
// =============================================================================

export function getMass(type, size) {
  const mat = ASTEROID_MATERIAL[type];
  if (!mat) return 100;
  return mat.mass * (SIZE_MASS_MULTIPLIER[size] || 1);
}

export function getCollisionMass(type, size) {
  const mat = ASTEROID_MATERIAL[type];
  if (!mat) return 10000;
  return mat.mass * (SIZE_COLLISION_MASS_MULTIPLIER[size] || SIZE_COLLISION_MASS_MULTIPLIER.M);
}

export function getAsteroidRammingMass(type, size) {
  const mass = getCollisionMass(type, size);
  return mass * (SIZE_RAMMING_MASS_MULTIPLIER[size] || 1);
}

export function getHardness(type) {
  return ASTEROID_MATERIAL[type]?.hardness ?? 0.5;
}

export function getMaxHp(type, size) {
  const mat = ASTEROID_MATERIAL[type];
  const sizeMult = SIZE_HP_MULTIPLIER[size] || 1;
  const hardness = mat?.hardness ?? 0.5;
  return Math.round(SIZE_HP_BASE * hardness * sizeMult);
}

export function getHexGridSize(size) {
  return HEX_GRID_SIZE[size] || 9;
}
