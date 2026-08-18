/**
 * MAPA UKŁADU — jedyne źródło prawdy dla geometrii rozgrywki.
 *
 * Orbity gameplayowe są CELOWO rozciągnięte i nie mają nic wspólnego z prawdziwymi
 * jednostkami astronomicznymi z `solarSystem.js` — tamte służą wyłącznie do opisu
 * i tempa obiegu. Tutaj mieszka to, co decyduje o dystansach, czasach lotu
 * i o tym, gdzie fizycznie leży pas asteroid.
 *
 * Moduł powstał dlatego, że ta tabela żyła wpisana w `index.html`, a wszystko
 * poza grą (dokumenty, prototypy, skrypty pomiarowe) przepisywało jej liczby
 * ręcznie. Przy pierwszej zmianie skali cała dokumentacja stała się nieprawdziwa,
 * nie dając żadnego sygnału. Teraz liczy się to raz i importuje.
 *
 * Brak importów poza `solarSystem.js` (metadane opisowe) — moduł ma być
 * bezpieczny do zaciągnięcia z Node w skryptach pomiarowych i z testów.
 */

import { SOLAR_PLANET_BY_ID } from './solarSystem.js';

/** Stałe świata. Te same wartości, które obowiązywały w `makeSolarPlanets()`. */
export const SYSTEM_MAP_CONSTANTS = Object.freeze({
  /** Docelowa średnica świata w jednostkach. To ona zwykle wyznacza skalę AU. */
  worldTargetDiameter: 12_000_000,
  /** Margines poza najdalszym obiektem, w AU mapy. */
  safetyMarginAu: 2,
  /** Mnożnik rozmiaru planet w widoku 3D — wchodzi w rachunek odstępów. */
  planet3dSizeMultiplier: 4.5,
  /** Podłoga skali. W praktyce nigdy nie wygrywa — patrz `computeWorldUnitsPerAu`. */
  baseAu: 3000,
  minSunGap: 600,
  minPlanetGap: 800,
  sunRadius: 823
});

/**
 * Orbity rozgrywkowe. `orbitAU` to jednostka MAPY, nie astronomiczna:
 * Merkury siedzi na 8, a nie 0,387, bo inaczej wewnętrzny układ byłby ciasny
 * jak łebek szpilki wobec pasa Kuipera na 140.
 */
export const SYSTEM_MAP_PLANETS = Object.freeze([
  { id: 'mercury', name: 'mercury', baseR: 2000, orbitAU: 8.0, type: 'rocky' },
  { id: 'venus', name: 'venus', baseR: 2800, orbitAU: 15.0, type: 'rocky' },
  {
    id: 'earth',
    name: 'earth',
    baseR: 2800,
    ringWorldRadius: 37800,
    orbitAU: 25.0,
    type: 'terran',
    orbitZone: Object.freeze({ inner: 8500, outer: 12000, gravity: 15000 })
  },
  { id: 'mars', name: 'mars', baseR: 3000, ringWorldRadius: 30000, orbitAU: 33.0, type: 'rocky' },
  { id: 'jupiter', name: 'jupiter', baseR: 3800, orbitAU: 50.20, type: 'gas' },
  { id: 'saturn', name: 'saturn', baseR: 3700, orbitAU: 80.58, type: 'gas' },
  { id: 'uranus', name: 'uranus', baseR: 2000, orbitAU: 100.20, type: 'gas' },
  { id: 'neptune', name: 'neptune', baseR: 2000, orbitAU: 120.00, type: 'gas' }
].map(planet => Object.freeze(planet)));

export const SYSTEM_MAP_PLANET_BY_ID = Object.freeze(Object.fromEntries(
  SYSTEM_MAP_PLANETS.map(planet => [planet.id, planet])
));

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** Najdalsza orbita planetarna w AU mapy. */
export function getOutermostPlanetOrbitAu(planets = SYSTEM_MAP_PLANETS) {
  return planets.reduce(
    (max, def) => (Number.isFinite(def?.orbitAU) ? Math.max(max, def.orbitAU) : max),
    0
  );
}

/**
 * Najmniejsza skala, przy której Ziemia i Mars się nie zazębiają. Ta para jest
 * wiążąca, bo ma najciaśniejszy odstęp orbit wobec swoich rozmiarów — reszta
 * ma zapas. Liczone z tabeli, nie z przepisanych stałych, żeby zmiana `baseR`
 * albo `orbitAU` od razu przeliczała próg.
 */
export function computeMinAuForNoOverlap(planets = SYSTEM_MAP_PLANETS, planetScale = 1) {
  const earth = planets.find(planet => planet.id === 'earth');
  const mars = planets.find(planet => planet.id === 'mars');
  if (!earth || !mars) return 0;
  const orbitGapAu = mars.orbitAU - earth.orbitAU;
  if (!(orbitGapAu > 0)) return 0;
  const minGap = (earth.baseR + mars.baseR)
    * positive(planetScale, 1)
    * SYSTEM_MAP_CONSTANTS.planet3dSizeMultiplier;
  return minGap / orbitGapAu;
}

/**
 * Ile jednostek świata przypada na 1 AU mapy.
 *
 * `beltEdgeAu` to zewnętrzna krawędź najdalszego pasa — bierze się ją
 * z `getOutermostBeltEdgeAu(BELT_DEFINITIONS)`. Przekazujemy ją argumentem,
 * żeby ten moduł nie ciągnął za sobą całej definicji asteroid.
 */
export function computeWorldUnitsPerAu(beltEdgeAu = 0, options = {}) {
  const planets = options.planets || SYSTEM_MAP_PLANETS;
  const planetScale = positive(options.planetScale, 1);
  const outerRadiusAu = Math.max(getOutermostPlanetOrbitAu(planets), Number(beltEdgeAu) || 0)
    + SYSTEM_MAP_CONSTANTS.safetyMarginAu;
  const minAuForWorldTarget = SYSTEM_MAP_CONSTANTS.worldTargetDiameter / Math.max(1, outerRadiusAu * 2);
  return Math.max(
    SYSTEM_MAP_CONSTANTS.baseAu,
    computeMinAuForNoOverlap(planets, planetScale),
    minAuForWorldTarget
  );
}

/** Promień świata w jednostkach, razem z marginesem bezpieczeństwa. */
export function computeWorldRadius(beltEdgeAu = 0, options = {}) {
  const planets = options.planets || SYSTEM_MAP_PLANETS;
  const au = positive(options.auInWorldUnits, computeWorldUnitsPerAu(beltEdgeAu, options));
  const outerRadiusAu = Math.max(getOutermostPlanetOrbitAu(planets), Number(beltEdgeAu) || 0)
    + SYSTEM_MAP_CONSTANTS.safetyMarginAu;
  return outerRadiusAu * au;
}

/**
 * Buduje pełny układ planet z promieniami orbit w jednostkach świata.
 *
 * Promień orbity to nie samo `orbitAU * AU` — planeta jest odpychana, jeśli
 * wpadałaby na Słońce albo na sąsiadkę. Ten łańcuch odstępów jest tym, co
 * potrafi rozjechać deklarowane orbity z rzeczywistymi, więc liczy się go tutaj
 * raz, zamiast szacować gdziekolwiek indziej.
 *
 * `angleFor(def, index)` pozwala wstrzyknąć deterministyczne kąty w testach
 * i w skryptach pomiarowych; gra losuje je przy każdym starcie.
 */
export function buildSystemMap(beltEdgeAu = 0, options = {}) {
  const planets = options.planets || SYSTEM_MAP_PLANETS;
  const planetScale = positive(options.planetScale, 1);
  const sunRadius = positive(options.sunRadius, SYSTEM_MAP_CONSTANTS.sunRadius);
  const auInWorldUnits = positive(options.auInWorldUnits, computeWorldUnitsPerAu(beltEdgeAu, {
    planets,
    planetScale
  }));
  const angleFor = typeof options.angleFor === 'function'
    ? options.angleFor
    : () => Math.random() * Math.PI * 2;

  let minOrbitEdge = sunRadius;
  const layout = planets.map((def, index) => {
    const physical = SOLAR_PLANET_BY_ID[def.id];
    const effectiveR = def.baseR * planetScale;
    const orbitRadius = Math.max(
      def.orbitAU * auInWorldUnits,
      sunRadius + effectiveR + SYSTEM_MAP_CONSTANTS.minSunGap,
      minOrbitEdge + effectiveR + SYSTEM_MAP_CONSTANTS.minPlanetGap
    );
    minOrbitEdge = orbitRadius + effectiveR;

    return {
      id: def.id,
      name: def.name,
      type: def.type,
      baseR: def.baseR,
      r: effectiveR,
      ringWorldRadius: def.ringWorldRadius,
      orbitAU: def.orbitAU,
      physicalOrbitAU: physical?.semiMajorAxisAu,
      orbitalPeriodDays: physical?.orbitalPeriodDays,
      meanOrbitalSpeedKmS: physical?.meanOrbitalSpeedKmS,
      orbitZone: def.orbitZone,
      orbitRadius,
      angle: angleFor(def, index),
      speed: 0
    };
  });

  return { auInWorldUnits, planets: layout };
}

/**
 * Odległość między orbitami dwóch planet przy zadanych kątach. Gra losuje kąty
 * na starcie, więc dystans pary jest zmienną losową — bez podania kątów zwracamy
 * przypadek typowy (kąt prosty), a nie optymistyczne minimum.
 */
export function orbitDistance(a, b, angleA = null, angleB = null) {
  const ra = Number(a?.orbitRadius) || 0;
  const rb = Number(b?.orbitRadius) || 0;
  if (!Number.isFinite(Number(angleA)) || !Number.isFinite(Number(angleB))) {
    return Math.hypot(ra, rb);
  }
  const ax = Math.cos(angleA) * ra;
  const ay = Math.sin(angleA) * ra;
  const bx = Math.cos(angleB) * rb;
  const by = Math.sin(angleB) * rb;
  return Math.hypot(bx - ax, by - ay);
}
