// Profile ringów per planeta (Z6, 2026-09-26/27). Decyzje użytkownika:
// Ziemia, Mars i Jowisz mają ring; ringi Marsa i Jowisza ORAZ ICH DOKI
// wyglądają inaczej niż ring Ziemi — i to są INNE RINGI, nie skórka
// (2026-09-27): Ziemia = silnik Halo (ten katalog), Mars = ECUMENE, Jowisz =
// ring Fable (src/3d/haloRing/arch/, dema/orbital_ring_demo*.html). Profil to
// same dane (bez Three i DOM): archetyp i geometria przekroju (ten sam układ
// dostają render, kolizje, ruch v2 i stacja-port), plan dzielnic, światło
// i styl hal K-7 z zatokami (czyta go też Z7: portBuildingStyle.js).
//
// Pola silnika Halo (palety terenu, powietrze, burze…) liczą się tylko dla
// Ziemi; różnice w shaderach idą przez WARTOŚCI uniformów, nie źródła GLSL
// (rozgrzewka w tle menu, menuBackdrop3D.js). Profil Ziemi = liczby sprzed
// profili 1:1 (ring Ziemi i tło menu bez zmian).
//
// Geometria stanowisk, bram, ścian i kolizji doków jest wspólna (standard
// K-7): styl doku zmienia tylko wygląd (dachy, kratownice, kolory, światła).
import {
  HALO_BIOME_CLIMATE,
  HALO_LANDSCAPE_BIOMES,
  HALO_SECTOR_MIX,
  HALO_SECTOR_PLAN_16,
  HALO_TYPE_CLIMATE
} from './haloRingConfig.js';

const freezeDeep = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) freezeDeep(v);
  }
  return o;
};
// sRGB hex → liniowe [r, g, b] (jak linearColor w haloRingUniforms.js)
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function haloHexLinear(hex) {
  return [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
}

// Cechy sektora dla rzeźby terenu (bake map): kaniony, kratery, wydmy i mesy
// (mnożniki 0–1). Ziemia ich nie używa (wszystko 0).
export const HALO_SECTOR_FEAT_KEYS = Object.freeze(['canyon', 'crater', 'dune', 'mesa']);

// Paleta terenu (albedo liniowe, zieleń ciemniej — waga luminancji 0,7152).
// Kolejność = indeksy uTerPal w shaderze terenu (haloRingTerrain.js).
export const HALO_TERRAIN_PALETTE_KEYS = Object.freeze([
  'grassLush', 'grassDry', 'forestDark', 'forestLight', 'forestCold',
  'rockA', 'rockB', 'rockDesert', 'sandA', 'sandB', 'beach', 'snow', 'ice',
  'waterDeep', 'waterShallow', 'cityRoof', 'street', 'cityAvg', 'metalA', 'metalB',
  'skyHorizon', 'skyZenith', 'planetLit', 'lineae', 'sulfurWhite', 'lava'
]);
// Paleta konstrukcji (ściany, dach, kadłub; haloRingStructure.js).
export const HALO_STRUCTURE_PALETTE_KEYS = Object.freeze([
  'hull', 'roof', 'wall', 'facadeA', 'facadeB', 'windowGlass', 'deck', 'greenA', 'greenB',
  'envSkyHorizon', 'envSkyZenith', 'envGround', 'planetLit', 'roofTint'
]);
// Palety terenu i konstrukcji czytają materiały TSL po kluczu: element(i) tablicy
// uTerPal / uStructPal (stałe indeksy, kolejność = klucze palety; ta sama tablica
// wartości wypełnia uniform — applyProfileUniforms w haloRingUniforms.js).
// Paleta megastruktury, miasta i megabudowli: indeks = kod palety materiału
// (HALO_MAT w haloRingRoofPlan.js, IND_MAT w haloRingIndustryKit.js).
// 29 = panel radiatora (Jowisz), 30 = dach-ogród z góry, 31 = dachówka z góry.
export const HALO_MEGA_PALETTE_SIZE = 32;

// ---------------------------------------------------------------------------
// ZIEMIA — liczby sprzed profili (każda wartość = literał z shadera / configu)
const EARTH = {
  key: 'earth',
  label: 'Ziemia',
  // silnik ringu: 'halo' (ten moduł), 'ecumene' / 'fable' (arch/, Mars i Jowisz)
  archetype: 'halo',
  // geometria przekroju (null = HALO_GEOMETRY_DEFAULTS)
  geometry: null,
  sectorPlan: HALO_SECTOR_PLAN_16,
  sectorMix: HALO_SECTOR_MIX,
  landscapeBiomes: HALO_LANDSCAPE_BIOMES,
  biomeClimate: HALO_BIOME_CLIMATE,
  typeClimate: HALO_TYPE_CLIMATE,
  // rzeźba (bake): płaskowyż nad morzem [j.], mnożnik rzek, głębokość mórz
  terrain: { plateau: 0, rivers: 1, seaDepth: 120 },
  // kaniony: meandry wokół ringu (środek w poprzek, pół-szerokość, głębokość);
  // działają tylko w sektorach z cechą `canyon`
  canyons: [],
  // cechy we fragmencie: siarka (Io), linie na lodzie (Europa)
  frag: { sulfur: 0, lineae: 0 },
  terrainPalette: {
    grassLush: [0.060, 0.112, 0.024],
    grassDry: [0.190, 0.170, 0.070],
    forestDark: [0.013, 0.028, 0.010],
    forestLight: [0.030, 0.062, 0.019],
    forestCold: [0.022, 0.034, 0.020],
    rockA: [0.125, 0.112, 0.098],
    rockB: [0.085, 0.078, 0.070],
    rockDesert: [0.30, 0.18, 0.10],
    sandA: [0.44, 0.31, 0.15],
    sandB: [0.34, 0.23, 0.11],
    beach: [0.52, 0.45, 0.31],
    snow: [0.68, 0.72, 0.76],
    ice: [0.40, 0.54, 0.64],
    waterDeep: [0.004, 0.020, 0.034],
    waterShallow: [0.020, 0.110, 0.115],
    cityRoof: [0.105, 0.108, 0.112],
    street: [0.048, 0.050, 0.054],
    cityAvg: [0.105, 0.108, 0.11],
    metalA: [0.085, 0.10, 0.12],
    metalB: [0.14, 0.16, 0.18],
    skyHorizon: [0.20, 0.30, 0.45],
    skyZenith: [0.05, 0.10, 0.22],
    planetLit: [0.16, 0.24, 0.36],
    lineae: [0.20, 0.10, 0.06],
    sulfurWhite: [0.55, 0.52, 0.42],
    lava: [0.02, 0.018, 0.016]
  },
  structurePalette: {
    hull: [0.030, 0.034, 0.040],
    roof: [0.056, 0.060, 0.066],
    wall: [0.060, 0.064, 0.070],
    facadeA: [0.085, 0.088, 0.094],
    facadeB: [0.05, 0.062, 0.075],
    windowGlass: [0.02, 0.026, 0.034],
    deck: [0.16, 0.16, 0.155],
    greenA: [0.030, 0.058, 0.022],
    greenB: [0.016, 0.036, 0.015],
    envSkyHorizon: [0.15, 0.22, 0.33],
    envSkyZenith: [0.04, 0.08, 0.16],
    envGround: [0.025, 0.04, 0.028],
    planetLit: [0.11, 0.17, 0.26],
    roofTint: [1, 1, 1]
  },
  megaPalette: [
    [0.150, 0.152, 0.156], [0.090, 0.092, 0.097], [0.030, 0.032, 0.036], [0.300, 0.302, 0.300],
    [0.120, 0.082, 0.060], [0.055, 0.058, 0.064], [0.330, 0.230, 0.040], [0.040, 0.055, 0.070],
    [0.070, 0.072, 0.076], [0.200, 0.205, 0.210], [0.190, 0.060, 0.035], [0.030, 0.080, 0.150],
    [0.160, 0.120, 0.050], [0.230, 0.235, 0.245], [0.280, 0.282, 0.275], [0.260, 0.235, 0.200],
    [0.160, 0.160, 0.150], [0.280, 0.280, 0.260], [0.130, 0.110, 0.095], [0.040, 0.040, 0.042],
    [0.290, 0.292, 0.290], [0.230, 0.230, 0.220], [0.160, 0.120, 0.080], [0.120, 0.130, 0.140],
    [0.310, 0.290, 0.255], [0.300, 0.220, 0.105], [0.300, 0.280, 0.240], [0.270, 0.235, 0.190],
    [0.170, 0.200, 0.235], [0.120, 0.130, 0.140], [0.040, 0.070, 0.028], [0.160, 0.105, 0.080]
  ],
  // mnożniki: szkło kopuł, liście drzew, odcisk zakładów przemysłowych z daleka
  domeTint: [1, 1, 1],
  leafTint: [1, 1, 1],
  indTopTint: [1, 1, 1],
  // odbicie nieba w szkle i metalu megastruktury (horyzont, zenit)
  megaSky: [[0.18, 0.25, 0.36], [0.05, 0.10, 0.21]],
  air: {
    scaleHeight: 560,
    rayleigh: [4.2e-5, 1.0e-4, 2.25e-4],
    mie: 1.3e-5,
    mieG: 0.76,
    multiScatter: 1.6,
    mieTint: [1, 1, 1],
    skyBoost: 2.6,
    cloudCoverBias: { inward: 0.05, outward: -0.09 }
  },
  sky: { tint: [0.34, 0.55, 1.0], cloudTint: [0.8, 0.8, 0.8] },
  light: {
    sunIntensity: 1.02,
    sunColor: [1.0, 0.965, 0.915],
    planetAlbedo: 0.30,
    planetshineColor: [0.58, 0.70, 0.92],
    planetshineGain: 0.85,
    planetAtmosphereHeight: 650,
    skyAmbient: 0.26,
    nightAmbient: 0.004,
    // nocna strona planety (światła miast Ziemi) w świetle planety
    planetNight: [0.9 * 0.004, 0.55 * 0.004, 0.25 * 0.004]
  },
  // pasma HDR (brief §9): barwne 0,9–1,3; strip = pasy świateł konstrukcji
  hdr: {
    windowWarm: [1.25, 0.78, 0.42],
    windowSodium: [1.3, 0.62, 0.2],
    windowCool: [0.55, 0.82, 1.25],
    strip: [0.35, 0.72, 1.3]
  },
  // błyski burz w chmurach habitatu (x siła, y błysków na komórkę na s,
  // z komórka [j.], w jasność HDR) — Ziemia bez burz
  storm: { strength: 0, rate: 0.08, cell: 1800, brightness: 3.2 },
  // reguły dachu (lustro GLSL): zajętość komórek przemysłowych na klasę
  // sektora (krajobraz, miasto, przemysł, port), progi rodzajów (zbiornik,
  // blok, radiator, komin, reszta kopuła), puste działki na klasę
  roofRules: { occupancy: [0.55, 0.62, 0.9, 0.85], kinds: [0.34, 0.62, 0.8, 0.9], plotEmpty: [0.8, 0.6, 0.32, 0.3] },
  // zestaw zakładów działki przemysłowej: progi rodzajów (hala, zbiorniki,
  // silosy, kotłownia, chłodnia, rafineria, kontenery, radiatory)
  industryKit: { cdf: [0.30, 0.46, 0.56, 0.68, 0.74, 0.86, 1.01, 1.01] },
  landmarks: { set: 'ecumene', sectorTypes: ['garden', 'glass'] },
  domes: { set: 'ecumene' },
  port: {
    name: 'PORT KEPLER',
    terminal: 'K-7 / TERMINAL HABITATU',
    // hala K-7 i zatoki: paleta materiałów K-7 (sRGB hex, jak DockMaterials
    // z dema K-7) i emisja (cyjan, ciepła, biel, czerwień, zieleń)
    k7Palette: [0x81909a, 0x27323c, 0xd1d0bf, 0xd4a44f, 0xaf693b, 0x38777d, 0x8c9ba3, 0x879797,
      0x101920, 0x343b3d, 0x987955, 0x153d4a, 0xc9b587, 0x84c1c6],
    k7Emit: [[0.30, 1.12, 1.28], [1.28, 0.78, 0.30], [1.40, 1.36, 1.14], [1.28, 0.16, 0.08], [0.40, 1.15, 0.66]],
    // poświata szkła K-7 (stała i nocna)
    k7Glow: [[0.0423 * 0.35, 0.1470 * 0.35, 0.1651 * 0.35], [0.06, 0.10, 0.11]],
    labels: {
      gate: '#94cdd1', hub: '#687d83', clear: '#99a6a2', bank: '#aab7ad', control: '#a6bbb6',
      logistics: '#80999e', capital: '#9caaa7', berthLead: '#9ecdd0', berth: '#cbb992', stop: '#778685',
      terminal: '#b8cdc6', bayLane: '#9caaa7', bayBank: '#aab7ad', bayId: '#687d83'
    },
    // styl hali (dach, ściany) i zatok: 'k7' = hala z dema ECUMENE
    roof: 'k7',
    walls: 'k7',
    bays: 'k7'
  }
};

// ---------------------------------------------------------------------------
// Mars i Jowisz: INNE RINGI, nie skórka ringu Ziemi (decyzja użytkownika
// 2026-09-27: „kompletnie inne ringi — sprawdź ECUMENE i ring od Fable z dem”).
// Mars = ECUMENE (dema/orbital_ring_demo.html), Jowisz = ring Fable
// (dema/orbital_ring_demo_2.html) — własne moduły renderu (src/3d/haloRing/arch/),
// habitat na zewnątrz jak Ziemia, ląd 1:1 z dem, skala ×3. Z silnika Halo
// zostają: układ (geometria archetypu poniżej — ten sam układ dostają kolizje,
// ruch v2 i stacja-port), model światła, wycięcia FG i hala K-7 z zatokami
// (stanowiska standardu K-7) w stylu dema. Pola Halo profilu (palety terenu,
// powietrze…) dziedziczą po Ziemi: nowe ringi ich nie czytają, hala K-7 bierze
// z nich tylko światło.
//
// geometry: szerokość wstęgi z ścianami, wysokość ścian (krawędź nad podłogą),
// kadłub (podłoga → spód płyty w płaszczyźnie gry, z żebrami), grubość ścian,
// detale dachu, liczba dzielnic. port.buildings: rodzina budowli Z7
// (portBuildingStyle.js) — do czasu jego przestrojenia jak dotąd.

// ECUMENE: 12 dzielnic dema (id = indeks w demie), nazwy z toponimii Marsa.
// Kolejność wzdłuż ringu jak w demie, obrócona tak, żeby 4 kompleksy portu
// (co 3 dzielnice) trafiły na dzielnice portowe: THARSIS (KEPLER, wolny port
// — kompleks gracza), DAEDALIA (stocznie), ELYSIUM (park), UTOPIA (rolnictwo);
// EDEN ↔ DEMETER zamienione, żeby kopuły nie stały pod dokiem.
const ECUMENE_SECTORS = [
  { type: 'industrial', name: 'THARSIS', district: 7, port: true },
  { type: 'glass', name: 'CYDONIA', district: 8 },
  { type: 'landscape', name: 'BOREALIS', district: 9 },
  { type: 'industrial', name: 'DAEDALIA', district: 10 },
  { type: 'garden', name: 'AURORAE', district: 11 },
  { type: 'glass', name: 'OLYMPIA', district: 0 },
  { type: 'garden', name: 'ELYSIUM', district: 1 },
  { type: 'landscape', name: 'ACIDALIA', district: 2 },
  { type: 'garden', name: 'MERIDIANI', district: 3 },
  { type: 'landscape', name: 'UTOPIA', district: 5 },
  { type: 'glass', name: 'HELLAS', district: 4 },
  { type: 'industrial', name: 'ARSIA', district: 6 }
];

const MARS = {
  ...EARTH,
  key: 'mars',
  label: 'Mars',
  archetype: 'ecumene',
  // dem ×3: podłoga 6 300, krawędzie 162 nad podłogą, ściany 210, kadłub
  // z żebrami 1 600 pod podłogą
  geometry: { width: 6720, wallHeight: 162, hullThickness: 1600, wallThickness: 210, roofDetailMax: 0, sectorCount: 12 },
  sectorPlan: ECUMENE_SECTORS,
  // niebieska godzina dema (klucz ffead0, niebo cadce7, otoczenie b7c7ce)
  sky: { tint: [0.52, 0.66, 0.78], cloudTint: [0.8, 0.8, 0.8] },
  light: {
    ...EARTH.light,
    sunColor: [1.0, 0.93, 0.83],
    skyAmbient: 0.34,
    planetAlbedo: 0.25,
    planetshineColor: [0.85, 0.55, 0.38],
    planetAtmosphereHeight: 250,
    planetNight: [0.0005, 0.0003, 0.00015]
  },
  hdr: {
    windowWarm: [1.3, 0.8, 0.38],
    windowSodium: [1.3, 0.62, 0.2],
    windowCool: [0.52, 0.86, 1.28],
    strip: [0.3, 1.0, 1.35]
  },
  port: {
    ...EARTH.port,
    name: 'PORT THARSIS',
    terminal: 'K-7 / TERMINAL HABITATU',
    // wolny port KEPLER z dema: stalowy błękit (8296a0), ciemny grafit
    // (536a75, 1e303c), jasne listwy (c1c5b9), złoto (b19a70), ciepłe i zimne
    // pasy świateł, czerwone znaczniki
    k7Palette: [0x8296a0, 0x2e4957, 0xc1c5b9, 0xb19a70, 0x9f845f, 0x638693, 0x7e949c, 0x9caead,
      0x1e303c, 0x536a75, 0xb2a27d, 0x6b9298, 0xa6b0ae, 0x9caaa7],
    k7Emit: [[0.24, 1.05, 1.38], [1.38, 0.88, 0.34], [1.40, 1.36, 1.14], [1.38, 0.05, 0.02], [0.40, 1.15, 0.66]],
    k7Glow: [[0.030 * 0.35, 0.140 * 0.35, 0.200 * 0.35], [0.05, 0.10, 0.13]],
    labels: {
      gate: '#d9b77e', hub: '#91a4ab', clear: '#c1c5b9', bank: '#b8c3c0', control: '#cfd6d2',
      logistics: '#8a9ea4', capital: '#d9b77e', berthLead: '#e5d3a8', berth: '#d6d9cf', stop: '#7f8f94',
      terminal: '#e5e9e7', bayLane: '#d9b77e', bayBank: '#b8c3c0', bayId: '#91a4ab'
    },
    roof: 'ecumene',
    walls: 'ecumene',
    bays: 'ecumene',
    buildings: { family: 'vault', walls: 'berm' }
  }
};

// Fable: 12 układów sektorów dema, ×2 wokół ringu (24 sektory — ring Jowisza
// jest 2,25 × dłuższy od dema ×3; sektor ma długość jak w demie). Kompleksy
// portu co 6 sektorów trafiają na ORBITAL PORT (gracz) i SHIPYARDS, tranzyty
// (środki sektorów 3 i 9 cyklu) na las i rolnictwo; drugi cykl z innym ziarnem.
const FABLE_CYCLE = [
  ['port', 'GALILEO'], ['tech', 'AMALTHEA'], ['reservoir', 'THEBE'], ['forest', 'ADRASTEA'],
  ['metropolis', 'METIS'], ['parkcity', 'HIMALIA'], ['shipyard', 'ELARA'], ['luxury', 'LYSITHEA'],
  ['residential', 'LEDA'], ['farms', 'CARME'], ['biodomes', 'ANANKE'], ['industry', 'PASIPHAE']
];
const FABLE_NAMES_B = ['KALLISTO', 'THEMISTO', 'CALLIRRHOE', 'SINOPE', 'KALE', 'EUPORIE', 'IOCASTE',
  'HARPALYKE', 'PRAXIDIKE', 'TAYGETE', 'CHALDENE', 'AITNE'];
const FABLE_SECTORS = [0, 1].flatMap((cycle) => FABLE_CYCLE.map(([layout, name], i) => ({
  type: layout === 'port' || layout === 'shipyard' || layout === 'industry' ? 'industrial' : layout === 'metropolis' || layout === 'tech' ? 'glass' : 'garden',
  name: cycle ? FABLE_NAMES_B[i] : name,
  layout,
  cycle,
  ...(cycle === 0 && i === 0 ? { port: true } : {})
})));

const JUPITER = {
  ...EARTH,
  key: 'jupiter',
  label: 'Jowisz',
  archetype: 'fable',
  // dema ×3: podłoga 5 400, ściany 780 (zamieszkane), grubość 270, kadłub
  // 1 380 + żebra pod spodem (do 1 900)
  geometry: { width: 5940, wallHeight: 780, hullThickness: 1900, wallThickness: 270, roofDetailMax: 0, sectorCount: 24 },
  sectorPlan: FABLE_SECTORS,
  sky: { tint: [0.30, 0.42, 0.60], cloudTint: [0.8, 0.8, 0.8] },
  light: {
    ...EARTH.light,
    sunColor: [1.0, 0.93, 0.82],
    skyAmbient: 0.22,
    planetAlbedo: 0.52,
    planetshineColor: [0.86, 0.72, 0.52],
    planetshineGain: 1.1,
    planetAtmosphereHeight: 1800,
    planetNight: [0.0008, 0.0009, 0.0012]
  },
  hdr: {
    windowWarm: [1.3, 0.8, 0.52],
    windowSodium: [1.3, 0.62, 0.2],
    windowCool: [0.62, 1.0, 1.35],
    strip: [0.45, 1.0, 1.38]
  },
  port: {
    ...EARTH.port,
    name: 'PORT GALILEO',
    terminal: 'K-7 / TERMINAL ORBITALNY',
    // porty dema Fable: płyty konstrukcji (aeb4bc), ciemny metal (585c66),
    // radiatory (2c2e33 z czerwonym żarem), bursztynowe bramy hangarów,
    // cyjan, czerwone i zielone światła nawigacyjne
    k7Palette: [0xaeb4bc, 0x2c2e33, 0xc8ccd2, 0xd98a2a, 0xc05a1e, 0x3a8fb0, 0x5c6068, 0x9ea4ad,
      0x151619, 0x585c66, 0x7a7e88, 0x2e4a5c, 0x8a8f96, 0x6f8ba0],
    k7Emit: [[0.45, 0.95, 1.38], [1.38, 0.83, 0.21], [1.40, 1.33, 1.19], [1.38, 0.17, 0.07], [0.14, 1.38, 0.41]],
    k7Glow: [[0.035 * 0.35, 0.090 * 0.35, 0.150 * 0.35], [0.06, 0.09, 0.13]],
    labels: {
      gate: '#ffb35c', hub: '#6f8fb0', clear: '#9fb4c8', bank: '#aebccb', control: '#cfe6ff',
      logistics: '#7f98b3', capital: '#ffb35c', berthLead: '#6fd3ff', berth: '#cfe6ff', stop: '#6f8fb0',
      terminal: '#cfe6ff', bayLane: '#ffb35c', bayBank: '#aebccb', bayId: '#6f8fb0'
    },
    roof: 'fable',
    walls: 'fable',
    bays: 'fable',
    buildings: { family: 'radiator', walls: 'pipes' }
  }
};

export const HALO_RING_PROFILES = freezeDeep({ earth: EARTH, mars: MARS, jupiter: JUPITER });
export const HALO_PROFILE_KEYS = Object.freeze(Object.keys(HALO_RING_PROFILES));
export const HALO_PROFILE_DEFAULT = 'earth';

// Profil z klucza albo obiektu (nieznany → Ziemia).
export function resolveHaloProfile(value) {
  if (value && typeof value === 'object' && value.key && HALO_RING_PROFILES[value.key] === value) return value;
  const key = String(value?.key ?? value ?? HALO_PROFILE_DEFAULT).trim().toLowerCase();
  return HALO_RING_PROFILES[key] || HALO_RING_PROFILES[HALO_PROFILE_DEFAULT];
}

// Cechy sektora w kolejności HALO_SECTOR_FEAT_KEYS (brak = 0).
export function haloSectorFeatures(sector) {
  const f = sector?.feat || {};
  return HALO_SECTOR_FEAT_KEYS.map((k) => Math.max(0, Math.min(1, Number(f[k]) || 0)));
}
