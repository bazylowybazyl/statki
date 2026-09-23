// Ring „Halo” — JEDYNE źródło liczb (skala, sektory, jakość, pasma HDR).
// Moduł bez Three.js i bez DOM: importują go i shadery, i testy node.
//
// Układ gry: płaszczyzna XY, +Z ku kamerze, oś ringu = Z. Jednostki gry
// (Atlas = 1800 × 806 j.). Wstęga leży od z = −W do z = 0, żeby nic z ringu
// nie wystawało nad płaszczyznę rozgrywki (kamera persp gry przy zoomie 3,2
// wisi tylko ≈535 j. nad z = 0). Szczegóły: docs/BRIEF-ring-halo.md §4–§5.
import {
  RING_PLANET_WORLD_RADII,
  RING_INFRASTRUCTURE_SIZE,
  computeRingAtmosphereGap
} from '../ringScale.js';

export const HALO_TAU = Math.PI * 2;

// Geometria przekroju. Promienie liczone od obwiedni obecnego ringu
// (computePlanetaryRingLayout): kadłub = outerRadius, podłoga o hullThickness
// niżej, krawędź ścian o wallHeight nad podłogą (ku osi).
export const HALO_GEOMETRY_DEFAULTS = Object.freeze({
  planetRadius: RING_PLANET_WORLD_RADII.earth,
  width: 6000,            // W: szerokość wstęgi wzdłuż Z (suwak 3000–12000)
  wallHeight: 1500,       // podłoga → krawędź ścian (suwak 800–2100)
  hullThickness: 452,     // podłoga → zewnętrzna powierzchnia kadłuba
  wallThickness: 250,     // grubość ścian brzegowych w Z
  roofDetailMax: 100,     // detale dachu ponad płytą dachu (najwyżej do z.top)
  floorTiltDeg: 0,        // 0° = podłoga prosto; >0 = podłoga odchylona ku kamerze gry (+Z)
  // Kierunek habitatu (decyzja użytkownika po M2, 2026-09-23): 'outward' =
  // habitat na zewnętrznej stronie wstęgi, w stronę kosmosu; „dół” = ku
  // planecie (grawitacja Ziemi, ring nie musi się obracać). 'inward' =
  // klasyczne Halo z M1–M2, zostawione do porównań.
  habitatFacing: 'outward',
  minHullAtTilt: 250,     // minimalny kadłub pod górną krawędzią pochylonej podłogi
  sectorCount: 16,
  // Gdzie płaszczyzna gry (z = 0) przecina podłogę habitatu: 0 = przy górnej
  // ścianie, 0,5 = w połowie szerokości wstęgi (decyzja użytkownika 2026-09-23:
  // doki wpięte w podłogę NA ŚRODKU, rozgrywka „na środku ringu”), 'roof' =
  // cała wstęga pod płaszczyzną (M1–M5; domyślnie dla wariantu Halo).
  flightLevel: 0.5
});

export const HALO_LIMITS = Object.freeze({
  width: [3000, 12000],
  wallHeight: [800, 2100],
  floorTiltDeg: [0, 20],
  flightLevel: [0, 1],
  sectorCount: [8, 32]
});

// Kąt stacji Ziemi: index.html liczy x = cos(π/4), y = sin(π/4) w układzie
// gry, a Three odwraca y → w płaszczyźnie XY sceny to −45°.
export const HALO_STATION_ANGLE = -Math.PI * 0.25;

export const HALO_SECTOR_TYPES = Object.freeze(['landscape', 'garden', 'industrial', 'glass']);

// Plan 16 sektorów (5 krajobraz, 5 miasto-ogród, 3 przemysł, 3 szkło).
// Sektor 0 leży pod kątem stacji Ziemi i niesie port. `climate` steruje
// generatorem: sea = udział morza, mount = góry, temp/moist = biom.
export const HALO_SECTOR_PLAN_16 = Object.freeze([
  { type: 'industrial', name: 'PORT KEPLER', port: true, climate: { sea: 0.08, mount: 0.1, temp: 0.55, moist: 0.4 } },
  { type: 'garden', name: 'VESPER', climate: { sea: 0.28, mount: 0.25, temp: 0.62, moist: 0.7 } },
  { type: 'landscape', name: 'PELAGIC', biome: 'sea', climate: { sea: 0.62, mount: 0.35, temp: 0.66, moist: 0.8 } },
  { type: 'landscape', name: 'ALPINE', biome: 'alpine', climate: { sea: 0.2, mount: 1.0, temp: 0.35, moist: 0.65 } },
  { type: 'glass', name: 'EDEN', climate: { sea: 0.2, mount: 0.15, temp: 0.6, moist: 0.6 } },
  { type: 'garden', name: 'MERIDIAN', climate: { sea: 0.24, mount: 0.3, temp: 0.58, moist: 0.62 } },
  { type: 'landscape', name: 'DUNE', biome: 'desert', climate: { sea: 0.1, mount: 0.55, temp: 0.92, moist: 0.08 } },
  { type: 'industrial', name: 'HEPHAESTUS', climate: { sea: 0.06, mount: 0.2, temp: 0.6, moist: 0.3 } },
  { type: 'garden', name: 'AURELIA', climate: { sea: 0.3, mount: 0.2, temp: 0.64, moist: 0.72 } },
  { type: 'landscape', name: 'BOREAS', biome: 'glacier', climate: { sea: 0.25, mount: 0.8, temp: 0.05, moist: 0.55 } },
  { type: 'glass', name: 'HALCYON', climate: { sea: 0.26, mount: 0.1, temp: 0.55, moist: 0.6 } },
  { type: 'garden', name: 'SYLVA', climate: { sea: 0.22, mount: 0.35, temp: 0.5, moist: 0.8 } },
  { type: 'landscape', name: 'TAIGA', biome: 'forest', climate: { sea: 0.3, mount: 0.45, temp: 0.4, moist: 0.9 } },
  { type: 'industrial', name: 'DAEDALUS', climate: { sea: 0.1, mount: 0.1, temp: 0.55, moist: 0.35 } },
  { type: 'garden', name: 'HELIX', climate: { sea: 0.2, mount: 0.2, temp: 0.6, moist: 0.66 } },
  { type: 'glass', name: 'AXIOM', climate: { sea: 0.18, mount: 0.12, temp: 0.62, moist: 0.55 } }
]);

// Proporcje typów przy innej liczbie sektorów (suwak „sektory”).
export const HALO_SECTOR_MIX = Object.freeze({ landscape: 5, garden: 5, industrial: 3, glass: 3 });
export const HALO_LANDSCAPE_BIOMES = Object.freeze(['sea', 'alpine', 'desert', 'glacier', 'forest']);
export const HALO_BIOME_CLIMATE = Object.freeze({
  sea: { sea: 0.62, mount: 0.35, temp: 0.66, moist: 0.8 },
  alpine: { sea: 0.2, mount: 1.0, temp: 0.35, moist: 0.65 },
  desert: { sea: 0.1, mount: 0.55, temp: 0.92, moist: 0.08 },
  glacier: { sea: 0.25, mount: 0.8, temp: 0.05, moist: 0.55 },
  forest: { sea: 0.3, mount: 0.45, temp: 0.4, moist: 0.9 }
});
export const HALO_TYPE_CLIMATE = Object.freeze({
  garden: { sea: 0.25, mount: 0.25, temp: 0.6, moist: 0.68 },
  industrial: { sea: 0.08, mount: 0.12, temp: 0.58, moist: 0.35 },
  glass: { sea: 0.22, mount: 0.12, temp: 0.6, moist: 0.58 }
});

// Mapy habitatu (bake na GPU). Rozdzielczość rośnie z jakością; v skaluje się
// z szerokością wstęgi, żeby teksel w poprzek został ~11–16 j.
export const HALO_QUALITY = Object.freeze({
  low: {
    label: 'Niska', pixelRatio: 0.75, msaa: 0, mapU: 4096, mapVPer6000: 192,
    lodFactor: 1.8, gridDiv: 16, airSteps: 4, cloudOctaves: 3, bloomScale: 0.5, maxNodes: 320
  },
  medium: {
    label: 'Średnia', pixelRatio: 1.0, msaa: 2, mapU: 8192, mapVPer6000: 320,
    lodFactor: 2.2, gridDiv: 32, airSteps: 6, cloudOctaves: 4, bloomScale: 0.75, maxNodes: 480
  },
  high: {
    label: 'Wysoka', pixelRatio: 1.0, msaa: 4, mapU: 12288, mapVPer6000: 448,
    lodFactor: 2.6, gridDiv: 32, airSteps: 8, cloudOctaves: 5, bloomScale: 1.0, maxNodes: 640
  },
  ultra: {
    label: 'Ultra', pixelRatio: 1.5, msaa: 4, mapU: 16384, mapVPer6000: 512,
    lodFactor: 3.2, gridDiv: 64, airSteps: 12, cloudOctaves: 6, bloomScale: 1.0, maxNodes: 900
  }
});

// Teren: CDLOD. Najdrobniejszy węzeł ≈ 40 j. (siatka co ~1,3 j. przy 32 podziałach).
export const HALO_TERRAIN = Object.freeze({
  maxLod: 7,
  morphStart: 0.72,
  heightMin: -140,
  mountainFraction: 0.6,   // góry do 60% wysokości ścian (brief §7)
  seaDepth: 120
});

// Atmosfera habitatu (współczynniki w 1/j. gry). Warstwa powietrza trzymana
// przez ściany: gęstość spada wykładniczo od podłogi ku osi. Pionowa głębia
// optyczna przy podłodze ≈ (0,04; 0,09; 0,21) jak ziemskie niebo, więc łuk
// wstęgi nisko nad horyzontem tonie w błękicie, a wysoko jest czytelny.
export const HALO_ATMOSPHERE = Object.freeze({
  scaleHeight: 560,
  rayleigh: [4.2e-5, 1.0e-4, 2.25e-4],
  mie: 1.3e-5,
  mieG: 0.76,
  multiScatter: 1.6,
  // cienka warstwa (ściany 1,5 tys. j.) nie da jednocześnie błękitnego nieba
  // i czytelnego terenu 5 tys. j. dalej — niebo (krótka droga optyczna)
  // dostaje wzmocnienie, horyzont (droga nasycona) już nie
  skyBoost: 2.6,
  // przesunięcie progu pokrycia chmur (+ = więcej chmur). Habitat w stronę
  // kosmosu ogląda się głównie z góry — chmury zasłaniają to, po co go
  // obrócono, więc pokrycie ~30% zamiast ~55% (Halo ogląda je od spodu)
  cloudCoverBias: Object.freeze({ inward: 0.05, outward: -0.09 })
});

// Światło. Kierunek słońca ringu = azymut do Słońca + wysokość (jak
// DirectionalLight gry, ≈49°). Oświetlona powierzchnia o albedo 1 przy
// normalnej na wprost daje ~0,9 → śnieg/chmury zostają < 0,85 (brief §9).
export const HALO_LIGHT = Object.freeze({
  sunElevationDeg: 49,
  sunIntensity: 1.02,
  sunColor: [1.0, 0.965, 0.915],
  sunAngularRadius: 0.0046,  // rad (~0,27°, jak Słońce z Ziemi)
  planetAlbedo: 0.30,
  planetshineColor: [0.58, 0.70, 0.92],
  planetshineGain: 0.85,
  // grubość atmosfery planety dla czerwonego brzegu cienia (Ziemia ~1,6% R)
  planetAtmosphereHeight: 650,
  skyAmbient: 0.26,
  nightAmbient: 0.004
});

// Pasma HDR (brief §9, zmierzone w dema/plasma_engine_demo): barwne światła
// 0,9–1,3 (bloomują i zostają barwne), białe rdzenie 8–12.
export const HALO_HDR = Object.freeze({
  windowWarm: [1.25, 0.78, 0.42],
  windowSodium: [1.3, 0.62, 0.2],
  windowCool: [0.55, 0.82, 1.25],
  stripBlue: [0.35, 0.72, 1.3],
  navWhite: 10.0,
  sunDisk: 11.0
});

// Dach (M3): pasy w poprzek dachu liczone od krawędzi habitatu (d = 0 przy
// krawędzi ścian, d = szerokość dachu od strony kadłuba). Te same reguły
// komórek liczy shader (odcisk z daleka) i haloRingRoofPlan.js (geometria
// z bliska), więc bryła wyrasta dokładnie z plamy widocznej z daleka.
export const HALO_ROOF = Object.freeze({
  cellsPerSegment: 12,    // drobna komórka wzdłuż ≈ 56 j. (segment ≈ 676 j.)
  lotsPerSegment: 2,      // działka wzdłuż ≈ 338 j.
  crossCell: 56,          // komórka w poprzek pasa przemysłowego
  rimBand: 140,           // kratownica przy krawędzi habitatu
  road: 30,               // droga serwisowa między działkami
  plotDepth: 490,         // rząd działek pod przyszłe budynki gracza (brief §5.3)
  maglev: 120,            // korytarz kolei magnetycznej (dwa tory)
  minIndustrial: 112,     // najwęższy pas przemysłowy, przy którym zostaje drugi rząd działek
  hullBand: 110,          // kratownica od strony planety
  trussHeight: 88,
  geomNear: 14000,        // do tej odległości pełna geometria detalu
  geomFar: 20000,         // dalej już tylko odcisk w shaderze dachu
  trainsPerTrack: 24,
  trainCars: 4,
  trainSpeed: 260         // j./s
});

// Port pod kątem stacji Ziemi (decyzja 2026-09-23: port ringu zastąpi stację).
// Doki WPIĘTE W PODŁOGĘ habitatu na środku wstęgi, w płaszczyźnie gry
// (poprawka użytkownika 2026-09-23: nie na dachu, bez wsporników-balkonów).
// Każdy dok siedzi w kołnierzu na podłodze (terminal z oknami), pod pokładem
// ma klin nośny do podłogi; zatoka wychodzi przez otwarty bok habitatu poza
// krawędź ścian, żeby stanowisko było widać z kamery gry spod górnej ściany.
export const HALO_PORT = Object.freeze({
  docks: 3,
  // doki transportowe po bokach K-7 (dok gameplayowy przy kącie stacji,
  // haloPortK7Layout.js): przesunięcia wzdłuż PODŁOGI [j. łuku na floorMid]
  dockOffsets: Object.freeze([-6800, 6800, 11000]),
  k7HalfWidth: 3600,      // pół szerokości hali K-7 (createK7Layout().halfWidth)
  dockLength: 3200,       // wzdłuż ringu (Atlas 1800 × 806 j. + manewr)
  reach: 1500,            // zatoka poza krawędzią ścian (głębokość = ściana + reach)
  berthStart: 1350,       // od podłogi: dalej stanowisko okrętu, bliżej zaplecze
  backWall: 160,
  sideWall: 180,
  deckTop: -130,          // wierzch pokładu zatoki (z świata; statki na z = 0)
  wallTop: 140,           // górna krawędź ścian zatoki
  collar: 320,            // kołnierz na podłodze wokół doku (każda strona)
  collarDepth: 240,       // wysunięcie kołnierza z podłogi
  plugZMin: -1250,        // spód podstawy doku (klin + terminal) — z świata
  plugZMax: 420,          // wierzch kołnierza
  gantryProfile: 60,      // ≤ 1/20 rozpiętości mostu (hangar-dock-demo)
  // strefy wokół doku na podłodze (poprawka użytkownika 2026-09-23: dok wbity
  // w ziemię generuje wokół siebie przemysł, który dalej przechodzi w domy):
  // odległość od płyty doku [j.] — do zoneInd pas fabryczny, do zoneRes zabudowa
  // mieszkalna, dalej sektor jak był
  zoneInd: 1300,
  zoneRes: 3300
});

// Tranzyty przez ring (jak w K-7 z ECUMENE: 4 osie co 90°, K-7 w połowie
// między parą): płaszczyzna gry przecina podłogę i kadłub, więc statki
// przelatują przez ring tunelami w płycie podłogi (wylot na habitat i na
// planetę). Wycięcie w terenie i kadłubie = prześwit + ściany tunelu.
export const HALO_TRANSIT = Object.freeze({
  count: 4,
  phase: Math.PI / 4,       // pierwsza oś: kąt stacji + 45°
  halfWidth: 570,           // pół prześwitu wzdłuż ringu (Atlas 806 j. szerokości przechodzi dziobem)
  wall: 60,                 // grubość ściany tunelu
  frame: 280,               // słupy portalu po bokach
  cutZ: Object.freeze([-200, 320]),   // wycięcie w podłodze i kadłubie (z świata)
  deckTop: -120,            // wierzch podłogi tunelu (statki na z = 0)
  ceiling: 250,             // spód stropu tunelu
  portalZ: Object.freeze([-700, 420]),   // nadproże ≤ 420: kamera gry przy zoomie 3,2 wisi 535 j. nad z = 0
  apron: 450,               // płyta bez zabudowy wokół portalu
  zoneInd: 550,             // wąski pas techniczny wokół płyty
  zoneRes: 0
});

// Osie tranzytów przez ring (kąty w płaszczyźnie XY sceny).
export function haloTransitAngles() {
  const T = HALO_TRANSIT;
  const wrap = (a) => ((a % HALO_TAU) + HALO_TAU) % HALO_TAU;
  return Array.from({ length: T.count }, (_, i) => wrap(HALO_STATION_ANGLE + T.phase + i * HALO_TAU / T.count));
}

// Miejsca na podłodze: K-7 przy kącie stacji, doki transportowe i portale
// tranzytów. Z tego samego opisu biorą się: płaska płyta bez zabudowy i strefy
// wokół niej (mapy terenu: pas fabryczny → domy), przejaśnienie w chmurach,
// kawałki miasta, bryły doków i ruch okrętów liniowych.
// theta — kąt środka, halfS — pół-rozpiętość płyty wzdłuż łuku na floorMid,
// zMin/zMax — zakres z świata płyty, zoneInd/zoneRes — zasięg stref od płyty.
export function haloPortSites(floorMid) {
  const P = HALO_PORT;
  const T = HALO_TRANSIT;
  const wrap = (a) => ((a % HALO_TAU) + HALO_TAU) % HALO_TAU;
  const R = Math.max(1, Number(floorMid) || 42252);
  const zone = { zoneInd: P.zoneInd, zoneRes: P.zoneRes };
  const sites = [{ kind: 'k7', index: 0, theta: wrap(HALO_STATION_ANGLE), halfS: P.k7HalfWidth + P.collar + 120, zMin: P.plugZMin, zMax: P.plugZMax, ...zone }];
  for (let k = 0; k < P.docks; k++) {
    sites.push({ kind: 'dock', index: k, theta: wrap(HALO_STATION_ANGLE + P.dockOffsets[k] / R), halfS: P.dockLength * 0.5 + P.collar, zMin: P.plugZMin, zMax: P.plugZMax, ...zone });
  }
  haloTransitAngles().forEach((theta, i) => {
    sites.push({ kind: 'transit', index: i, theta, halfS: T.halfWidth + T.wall + T.frame + T.apron,
      zMin: T.portalZ[0] - 200, zMax: T.portalZ[1] + 200, zoneInd: T.zoneInd, zoneRes: T.zoneRes });
  });
  return sites;
}

// Górna połowa wstęgi nad płaszczyzną gry (flightLevel liczbowy): górna
// ściana z dachem rysuje się w FG (nad statkami, jak w grze). W kamerze gry:
//  - „ściany w dół”: część dachu nad wąwozem habitatu (od podłogi do krawędzi
//    ścian) znika przy zoomie rozgrywki — widać dok na środku habitatu, górną
//    i dolną połowę podłogi; pas nad kadłubem zostaje jako pokrywa. Pełny dach
//    wraca przy dalekim zoomie (widok strategiczny: ring jako bryła);
//  - cały dach znika, gdy kamera schodzi nisko nad nim (powiększenie rośnie);
//  - wycięcia nad graczem pod dachem (hala K-7, statek) przy dalekim zoomie.
// Progi to powiększenie dachu m = h/(h − z.top) (1080p: 1,14 ≈ zoom 0,07,
// 1,3 ≈ zoom 0,125).
export const HALO_FG = Object.freeze({
  troughMag: Object.freeze([1.12, 1.32]), // dach nad wąwozem: pełny → schowany (od krawędzi ścian ku podłodze)
  fadeMag: Object.freeze([2.1, 3.3]),     // cały dach: pełny → niewidoczny (kamera tuż nad nim)
  cutSoft: 90                             // miękka krawędź wycięcia [j. płaszczyzny gry]
});

// Warstwy obiektów ringu — ustawia host (setLayers). Domyślnie BG (layer 1),
// czyli pod statkami (brief §5.2).
export const HALO_DEFAULT_LAYER = 1;

export function resolveHabitatFacing(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'inward' || key === 'in' || key === 'halo') return 'inward';
  return 'outward';
}

export function resolveHaloQuality(value) {
  const key = String(value || 'high').trim().toLowerCase();
  if (HALO_QUALITY[key]) return key;
  if (key === 'med') return 'medium';
  return 'high';
}

// Obwiednia promieniowa zgodna z computePlanetaryRingLayout (planetaryRing3D.js)
// — liczona z tych samych stałych ringScale.js, bez importu modułu z Core3D.
export function computeHaloEnvelope(planetRadius = RING_PLANET_WORLD_RADII.earth) {
  const R = Math.max(2000, Number(planetRadius) || RING_PLANET_WORLD_RADII.earth);
  const gap = computeRingAtmosphereGap(R);
  const innerStart = R + gap;
  const innerEnd = innerStart + RING_INFRASTRUCTURE_SIZE.residentialDepth;
  const industrialEnd = innerEnd + RING_INFRASTRUCTURE_SIZE.industrialDepth;
  const parkingEnd = industrialEnd + RING_INFRASTRUCTURE_SIZE.parkingDepth;
  const defenseEnd = parkingEnd + RING_INFRASTRUCTURE_SIZE.defenseDepth;
  const band = (innerR, outerR) => ({ innerR, outerR });
  return {
    planetR: R,
    station: band(0, R),
    inner: band(innerStart, innerEnd),
    industrial: band(innerEnd, industrialEnd),
    parking: band(industrialEnd, parkingEnd),
    military: band(parkingEnd, defenseEnd),
    innerRadius: innerStart,
    outerRadius: defenseEnd,
    innerCenter: (innerStart + innerEnd) * 0.5,
    industrialCenter: (innerEnd + industrialEnd) * 0.5,
    parkingCenter: (industrialEnd + parkingEnd) * 0.5,
    militaryCenter: (parkingEnd + defenseEnd) * 0.5
  };
}
