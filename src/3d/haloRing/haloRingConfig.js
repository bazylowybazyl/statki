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

// Geometria przekroju. Promienie liczone od obwiedni dawnego ringu gry
// (computeHaloEnvelope, te same strefy orbit): kadłub = outerRadius, podłoga o hullThickness
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

// Typ 'industrial' zostaje jako kanał map terenu (pas fabryczny wokół doków),
// ale żaden sektor nie jest już przemysłowy (poprawka użytkownika 2026-09-23:
// strefy przemysłowe TYLKO wokół doków).
export const HALO_SECTOR_TYPES = Object.freeze(['landscape', 'garden', 'industrial', 'glass']);

// Plan 16 sektorów (7 krajobraz, 5 miasto-ogród, 4 szkło). Sektor 0 leży pod
// kątem stacji Ziemi i niesie port (kompleks gracza): krajobraz z górami przy
// brzegach wstęgi (mogą stać obok pasa fabrycznego doków). `climate` steruje
// generatorem: sea = udział morza, mount = góry, temp/moist = biom.
export const HALO_SECTOR_PLAN_16 = Object.freeze([
  { type: 'landscape', name: 'PORT KEPLER', biome: 'port', port: true, climate: { sea: 0.14, mount: 0.7, temp: 0.52, moist: 0.62 } },
  { type: 'garden', name: 'VESPER', climate: { sea: 0.28, mount: 0.25, temp: 0.62, moist: 0.7 } },
  { type: 'landscape', name: 'PELAGIC', biome: 'sea', climate: { sea: 0.62, mount: 0.35, temp: 0.66, moist: 0.8 } },
  { type: 'landscape', name: 'ALPINE', biome: 'alpine', climate: { sea: 0.2, mount: 1.0, temp: 0.35, moist: 0.65 } },
  { type: 'glass', name: 'EDEN', climate: { sea: 0.2, mount: 0.15, temp: 0.6, moist: 0.6 } },
  { type: 'garden', name: 'MERIDIAN', climate: { sea: 0.24, mount: 0.3, temp: 0.58, moist: 0.62 } },
  { type: 'landscape', name: 'DUNE', biome: 'desert', climate: { sea: 0.1, mount: 0.55, temp: 0.92, moist: 0.08 } },
  { type: 'landscape', name: 'HEPHAESTUS', biome: 'alpine', climate: { sea: 0.08, mount: 0.9, temp: 0.62, moist: 0.3 } },
  { type: 'garden', name: 'AURELIA', climate: { sea: 0.3, mount: 0.2, temp: 0.64, moist: 0.72 } },
  { type: 'landscape', name: 'BOREAS', biome: 'glacier', climate: { sea: 0.25, mount: 0.8, temp: 0.05, moist: 0.55 } },
  { type: 'glass', name: 'HALCYON', climate: { sea: 0.26, mount: 0.1, temp: 0.55, moist: 0.6 } },
  { type: 'garden', name: 'SYLVA', climate: { sea: 0.22, mount: 0.35, temp: 0.5, moist: 0.8 } },
  { type: 'landscape', name: 'TAIGA', biome: 'forest', climate: { sea: 0.3, mount: 0.45, temp: 0.4, moist: 0.9 } },
  { type: 'glass', name: 'DAEDALUS', climate: { sea: 0.14, mount: 0.35, temp: 0.56, moist: 0.5 } },
  { type: 'garden', name: 'HELIX', climate: { sea: 0.2, mount: 0.2, temp: 0.6, moist: 0.66 } },
  { type: 'glass', name: 'AXIOM', climate: { sea: 0.18, mount: 0.12, temp: 0.62, moist: 0.55 } }
]);

// Proporcje typów przy innej liczbie sektorów (suwak „sektory”).
export const HALO_SECTOR_MIX = Object.freeze({ landscape: 7, garden: 5, industrial: 0, glass: 4 });
export const HALO_LANDSCAPE_BIOMES = Object.freeze(['sea', 'alpine', 'desert', 'glacier', 'forest']);
export const HALO_BIOME_CLIMATE = Object.freeze({
  // sektor portu: krajobraz z górami przy brzegach wstęgi (pas fabryczny tylko przy dokach)
  port: { sea: 0.14, mount: 0.7, temp: 0.52, moist: 0.62 },
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

// LOD zabudowy, drzew, megastruktury i portu per jakość. Tryb „ultra” (prośba
// użytkownika 2026-09-25: „w ultra z daleka okna budynków i więcej
// szczegółów”) przesuwa wszystkie progi dalej; low / medium / high zostają przy
// progach strojonych w demie.
const HALO_LOD_BASE = Object.freeze({
  detailScale: 1,                              // progi wygaszania okien i wzorów (uDetailScale)
  cityFade: Object.freeze([17000, 30000]),     // wspólne opadanie miasta (kamera ↔ podłoga) [j.]
  cityMinPixels: 1.0,                          // kawałek miasta, gdy jego najwyższa bryła ma ≥ N px
  buildingPixels: Object.freeze([0.6, 1.6]),   // budynek opada płynnie między N a M px
  cityChunks: Object.freeze([96, 128]),        // kawałki ogrodu / przemysłu naraz
  treeGrid: 128,                               // sloty drzew na bok siatki (co 16 j.)
  treeAltitude: 2500,                          // drzewa, gdy kamera bliżej podłogi [j.]
  treePixels: 1.5,                             // drzewo, gdy ma ≥ N px
  geomFade: Object.freeze([14000, 20000]),     // detal megastruktury: pełny → brak [j.]
  k7Pixels: 3                                  // kompleks portu obcinany poniżej N px
});
export const HALO_LOD_ULTRA = Object.freeze({
  detailScale: 1.8,
  cityFade: Object.freeze([36000, 64000]),
  cityMinPixels: 0.55,
  buildingPixels: Object.freeze([0.3, 0.9]),
  cityChunks: Object.freeze([192, 256]),
  treeGrid: 192,
  treeAltitude: 4200,
  treePixels: 0.9,
  geomFade: Object.freeze([26000, 38000]),
  k7Pixels: 1.5
});

// Mapy habitatu (bake na GPU). Rozdzielczość rośnie z jakością; v skaluje się
// z szerokością wstęgi, żeby teksel w poprzek został ~11–16 j.
export const HALO_QUALITY = Object.freeze({
  low: {
    label: 'Niska', pixelRatio: 0.75, msaa: 0, mapU: 4096, mapVPer6000: 192,
    lodFactor: 1.8, gridDiv: 16, airSteps: 4, cloudOctaves: 3, bloomScale: 0.5, maxNodes: 320,
    lod: Object.freeze({ ...HALO_LOD_BASE, treeGrid: 88 })
  },
  medium: {
    label: 'Średnia', pixelRatio: 1.0, msaa: 2, mapU: 8192, mapVPer6000: 320,
    lodFactor: 2.2, gridDiv: 32, airSteps: 6, cloudOctaves: 4, bloomScale: 0.75, maxNodes: 480,
    lod: HALO_LOD_BASE
  },
  high: {
    label: 'Wysoka', pixelRatio: 1.0, msaa: 4, mapU: 12288, mapVPer6000: 448,
    lodFactor: 2.6, gridDiv: 32, airSteps: 8, cloudOctaves: 5, bloomScale: 1.0, maxNodes: 640,
    lod: HALO_LOD_BASE
  },
  ultra: {
    label: 'Ultra', pixelRatio: 1.5, msaa: 4, mapU: 16384, mapVPer6000: 512,
    lodFactor: 3.2, gridDiv: 64, airSteps: 12, cloudOctaves: 6, bloomScale: 1.0, maxNodes: 900,
    lod: HALO_LOD_ULTRA
  }
});

// LOD jakości (brak bloku = progi bazowe).
export function haloQualityLod(quality) {
  return quality?.lod || HALO_LOD_BASE;
}

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
// Zatoki mają stanowiska w standardzie K-7 (haloPortBays.js) — gracz lata
// frachtowcami jak NPC i dokuje także poza halą (poprawka użytkownika
// 2026-09-23). Kompleks = K-7 pośrodku i po jednej zatoce z każdej strony
// (poprawka graficzna 2026-09-24: 3 doki zamiast 4); zatoki powiększone, żeby
// nie stracić stanowisk: 2 pasy MEGA przy ścianach + podwójny grzebień
// 2 L / 2 M / 2 S z każdej strony alei = 14 stanowisk (dawniej 3 × 7).
export const HALO_PORT = Object.freeze({
  // Port Ziemi = 4 KOMPLEKSY co 90° (decyzja użytkownika 2026-09-23, jak
  // 4 doki stacji z ringiem w ruchu v2): w każdym hala K-7 (4 stanowiska
  // capital) i 2 otwarte zatoki po bokach (w każdej 2 pasy MEGA + 12 stanowisk
  // grzebienia). Pojemność sprawdzana symulacją ruchu v2 (kolejka na redzie).
  complexes: 4,
  docks: 2,               // zatok w kompleksie (po jednej z każdej strony K-7)
  // zatoki po bokach K-7: przesunięcia od środka kompleksu wzdłuż PODŁOGI [j. łuku na floorMid]
  dockOffsets: Object.freeze([-9700, 9700]),
  k7HalfWidth: 5220,      // pół szerokości hali K-7 (createK7Layout().halfWidth, 4 × capital)
  // wzdłuż ringu: wnętrze 5800 (pas MEGA 1300 + grzbiet 150 + stanowiska 1000 +
  // aleja 900 + stanowiska 1000 + grzbiet 150 + pas MEGA 1300) + ściany
  dockLength: 6160,
  bayDepth: 3400,         // od podłogi do wylotu (pas MEGA: megafrachtowiec 2760 j. dziobem do podłogi)
  backWall: 160,
  sideWall: 180,
  deckTop: -116,          // wierzch pokładu zatoki = pokład K-7 (z świata; statki na z = 0)
  wallTop: 140,           // górna krawędź ścian zatoki
  collar: 320,            // kołnierz na podłodze wokół doku (każda strona)
  collarDepth: 240,       // wysunięcie kołnierza z podłogi
  plugZMin: -1250,        // spód podstawy doku (klin + terminal) — z świata
  plugZMax: 420,          // wierzch kołnierza
  gantryProfile: 60,      // ≤ 1/20 rozpiętości mostu (hangar-dock-demo)
  // strefy wokół doku na podłodze (poprawki użytkownika 2026-09-23: dok wbity
  // w ziemię generuje wokół siebie przemysł — TYLKO wokół doków — dalej domy;
  // góry sektora przy brzegach wstęgi mogą zostać obok doków, nie muszą):
  // odległość od płyty doku [j.] — do zoneInd pas fabryczny, do zoneRes
  // osady (tylko tam, gdzie teren sektora nie ma gór), dalej sektor jak był.
  // W poprzek wstęgi strefy są węższe (×0,6), żeby przy ścianach było
  // miejsce na góry.
  zoneInd: 1000,
  zoneRes: 2800
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
  // bez stref: przemysł tylko wokół doków (poprawka użytkownika 2026-09-23),
  // wokół portalu teren sektora
  zoneInd: 0,
  zoneRes: 0
});

// Osie tranzytów przez ring (kąty w płaszczyźnie XY sceny).
export function haloTransitAngles() {
  const T = HALO_TRANSIT;
  const wrap = (a) => ((a % HALO_TAU) + HALO_TAU) % HALO_TAU;
  return Array.from({ length: T.count }, (_, i) => wrap(HALO_STATION_ANGLE + T.phase + i * HALO_TAU / T.count));
}

// Kąty środków kompleksów portowych (hala K-7 w środku; pierwszy przy kącie stacji).
export function haloPortComplexAngles() {
  const wrap = (a) => ((a % HALO_TAU) + HALO_TAU) % HALO_TAU;
  return Array.from({ length: HALO_PORT.complexes }, (_, i) => wrap(HALO_STATION_ANGLE + i * HALO_TAU / HALO_PORT.complexes));
}

// Szablon jednego kompleksu i tranzytu (powtarza się co 2π / liczba): prostokąty
// płyt względem środka kompleksu — z tego samego szablonu biorą się miejsca
// (CPU) i uniformy GLSL (4 prostokąty zamiast 16 miejsc na piksel).
export function haloPortTemplate(floorMid) {
  const P = HALO_PORT;
  const T = HALO_TRANSIT;
  const R = Math.max(1, Number(floorMid) || 42252);
  const zone = { zoneInd: P.zoneInd, zoneRes: P.zoneRes };
  const period = HALO_TAU * R / P.complexes;
  const rects = [{ kind: 'k7', index: 0, ds: 0, halfS: P.k7HalfWidth + P.collar + 120, zMin: P.plugZMin, zMax: P.plugZMax, ...zone }];
  for (let k = 0; k < P.docks; k++) {
    rects.push({ kind: 'dock', index: k, ds: P.dockOffsets[k], halfS: P.dockLength * 0.5 + P.collar, zMin: P.plugZMin, zMax: P.plugZMax, ...zone });
  }
  // tranzyty w połowie między kompleksami (ta sama liczba co kompleksów)
  const transitDs = (T.phase / (HALO_TAU / P.complexes)) * period;
  rects.push({ kind: 'transit', index: 0, ds: transitDs, halfS: T.halfWidth + T.wall + T.frame + T.apron,
    zMin: T.portalZ[0] - 200, zMax: T.portalZ[1] + 200, zoneInd: T.zoneInd, zoneRes: T.zoneRes });
  return { period, count: P.complexes, theta0: haloPortComplexAngles()[0], rects };
}

// Miejsca na podłodze: 4 kompleksy (hala K-7 + 2 zatoki) i 4 portale
// tranzytów. Z tego samego opisu biorą się: płaska płyta bez zabudowy
// i strefy wokół niej (mapy terenu: pas fabryczny → domy), przejaśnienie
// w chmurach, kawałki miasta i bryły doków.
// theta — kąt środka, halfS — pół-rozpiętość płyty wzdłuż łuku na floorMid,
// zMin/zMax — zakres z świata płyty, zoneInd/zoneRes — zasięg stref od płyty,
// complex — numer kompleksu (0 = przy kącie stacji, hala gracza).
export function haloPortSites(floorMid) {
  const R = Math.max(1, Number(floorMid) || 42252);
  const wrap = (a) => ((a % HALO_TAU) + HALO_TAU) % HALO_TAU;
  const tpl = haloPortTemplate(R);
  const sites = [];
  const complexes = haloPortComplexAngles();
  complexes.forEach((center, c) => {
    for (const r of tpl.rects) {
      if (r.kind === 'transit') continue;
      sites.push({ ...r, complex: c, index: r.kind === 'dock' ? c * HALO_PORT.docks + r.index : c, theta: wrap(center + r.ds / R) });
    }
  });
  haloTransitAngles().forEach((theta, i) => {
    const r = tpl.rects[tpl.rects.length - 1];
    sites.push({ ...r, index: i, complex: -1, theta });
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

// Obwiednia promieniowa dawnego ringu gry (planetaryRing3D.computePlanetaryRingLayout,
// usunięty przy porcie 2026-09-25) — z tych samych stałych ringScale.js.
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
