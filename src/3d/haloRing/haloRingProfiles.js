// Profile ringów „Halo” per planeta (Z6, 2026-09-26). Decyzja użytkownika:
// Ziemia, Mars i Jowisz mają ring, a ringi Marsa i Jowisza ORAZ ICH DOKI
// wyglądają inaczej niż ring Ziemi. Profil to same dane (bez Three i DOM):
// plan sektorów i rzeźba terenu, palety terenu, konstrukcji, megastruktury
// i doków, powietrze, niebo, chmury, światła, burze, reguły dachu i
// przemysłu, zestawy megabudowli i kopuł, styl hal K-7 i zatok.
//
// Zasada: wszystko, czym planety różnią się w shaderach, idzie przez WARTOŚCI
// uniformów, nie przez źródła GLSL. Trzy ringi dzielą te same programy, więc
// rozgrzewka shaderów w tle menu (kompilowana na ringu Ziemi,
// menuBackdrop3D.js) obsługuje też Marsa i Jowisza, a pierwsze podejście do
// nich nie zamraża klatki kompilacją. Profil Ziemi = liczby sprzed profili 1:1
// (ring Ziemi i tło menu bez zmian).
//
// Geometria stanowisk, bram, ścian i kolizji jest wspólna (standard K-7):
// styl doku zmienia tylko wygląd (dachy, kratownice, kolory, światła, napisy).
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
// Nazwy palety w GLSL: #define TP_GRASS_LUSH uTerPal[0] … (stałe indeksy,
// kolejność = klucze palety; ta sama tablica wartości wypełnia uniform).
export function haloPaletteDefines(prefix, uniformName, keys) {
  return keys.map((k, i) => `#define ${prefix}_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()} ${uniformName}[${i}]`).join('\n');
}
// Paleta megastruktury, miasta i megabudowli: indeks = kod palety materiału
// (HALO_MAT w haloRingRoofPlan.js, IND_MAT w haloRingIndustryKit.js).
// 29 = panel radiatora (Jowisz), 30 = dach-ogród z góry, 31 = dachówka z góry.
export const HALO_MEGA_PALETTE_SIZE = 32;

// ---------------------------------------------------------------------------
// ZIEMIA — liczby sprzed profili (każda wartość = literał z shadera / configu)
const EARTH = {
  key: 'earth',
  label: 'Ziemia',
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
// MARS — rdzawe pustynie i kaniony, kratery, szron na szczytach, kopuły
// ciśnieniowe z miastami, pył w powietrzu; konstrukcja w czerwieni i kremie,
// bursztynowe światła; hale K-7 ze sklepieniem łukowym i nasypami z regolitu.
// Układ: kompleksy portu leżą w sektorach 0/4/8/12 (z zatokami zajmują też
// większość sąsiednich), tranzyty w środkach 2/6/10/14 — miasta szklane
// (megabudowle) w 2/6/10/14 obok tranzytów, kopuły-miasta na końcach sektorów
// krajobrazu przy nich, ogrody wokół portów (strefa domów przy dokach).
const MARS_SECTORS = [
  { type: 'landscape', name: 'THARSIS', biome: 'port', port: true, climate: { sea: 0.04, mount: 0.75, temp: 0.46, moist: 0.2 }, feat: { crater: 0.35 } },
  { type: 'landscape', name: 'VALLES MARINERIS', biome: 'canyon', climate: { sea: 0.05, mount: 0.45, temp: 0.62, moist: 0.2 }, feat: { canyon: 1.0, mesa: 0.6 } },
  { type: 'glass', name: 'ELYSIUM', climate: { sea: 0.05, mount: 0.2, temp: 0.5, moist: 0.3 } },
  { type: 'landscape', name: 'OLYMPUS', biome: 'alpine', climate: { sea: 0.02, mount: 1.0, temp: 0.3, moist: 0.22 }, feat: { crater: 0.25 } },
  { type: 'garden', name: 'ARCADIA', climate: { sea: 0.22, mount: 0.25, temp: 0.5, moist: 0.55 } },
  { type: 'landscape', name: 'HELLAS', biome: 'crater', climate: { sea: 0.1, mount: 0.35, temp: 0.55, moist: 0.28 }, feat: { crater: 1.0 } },
  { type: 'glass', name: 'NOCTIS', climate: { sea: 0.05, mount: 0.2, temp: 0.52, moist: 0.3 } },
  { type: 'landscape', name: 'UTOPIA', biome: 'desert', climate: { sea: 0.03, mount: 0.4, temp: 0.8, moist: 0.06 }, feat: { dune: 1.0, crater: 0.4 } },
  { type: 'garden', name: 'CHRYSE', climate: { sea: 0.18, mount: 0.2, temp: 0.52, moist: 0.5 } },
  { type: 'landscape', name: 'ARGYRE', biome: 'glacier', climate: { sea: 0.12, mount: 0.7, temp: 0.08, moist: 0.4 }, feat: { crater: 0.8 } },
  { type: 'glass', name: 'SYRTIS', climate: { sea: 0.05, mount: 0.15, temp: 0.55, moist: 0.3 } },
  { type: 'landscape', name: 'AMAZONIS', biome: 'desert', climate: { sea: 0.02, mount: 0.55, temp: 0.85, moist: 0.05 }, feat: { mesa: 1.0, dune: 0.6 } },
  { type: 'garden', name: 'CYDONIA', climate: { sea: 0.12, mount: 0.35, temp: 0.5, moist: 0.45 }, feat: { mesa: 0.5 } },
  { type: 'landscape', name: 'BOREALIS', biome: 'sea', climate: { sea: 0.5, mount: 0.3, temp: 0.28, moist: 0.6 }, feat: { crater: 0.3 } },
  { type: 'glass', name: 'PROMETHEI', climate: { sea: 0.05, mount: 0.2, temp: 0.45, moist: 0.3 } },
  { type: 'landscape', name: 'MERIDIANI', biome: 'canyon', climate: { sea: 0.05, mount: 0.5, temp: 0.6, moist: 0.18 }, feat: { canyon: 0.8, crater: 0.3 } }
];

const MARS = {
  ...EARTH,
  key: 'mars',
  label: 'Mars',
  sectorPlan: MARS_SECTORS,
  sectorMix: { landscape: 9, garden: 3, industrial: 0, glass: 4 },
  landscapeBiomes: ['canyon', 'crater', 'desert', 'alpine', 'glacier', 'sea'],
  biomeClimate: {
    port: { sea: 0.04, mount: 0.75, temp: 0.46, moist: 0.2 },
    canyon: { sea: 0.05, mount: 0.45, temp: 0.62, moist: 0.2 },
    crater: { sea: 0.1, mount: 0.35, temp: 0.55, moist: 0.28 },
    desert: { sea: 0.03, mount: 0.4, temp: 0.8, moist: 0.06 },
    alpine: { sea: 0.02, mount: 1.0, temp: 0.3, moist: 0.22 },
    glacier: { sea: 0.12, mount: 0.7, temp: 0.08, moist: 0.4 },
    sea: { sea: 0.5, mount: 0.3, temp: 0.28, moist: 0.6 },
    forest: { sea: 0.15, mount: 0.3, temp: 0.45, moist: 0.5 }
  },
  typeClimate: {
    garden: { sea: 0.16, mount: 0.25, temp: 0.5, moist: 0.5 },
    industrial: { sea: 0.04, mount: 0.12, temp: 0.55, moist: 0.2 },
    glass: { sea: 0.05, mount: 0.18, temp: 0.5, moist: 0.3 }
  },
  terrain: { plateau: 60, rivers: 0.35, seaDepth: 90 },
  canyons: [
    { center: 0.44, halfWidth: 560, depth: 270 },
    { center: 0.72, halfWidth: 360, depth: 190 }
  ],
  frag: { sulfur: 0, lineae: 0 },
  terrainPalette: {
    ...EARTH.terrainPalette,
    grassLush: [0.052, 0.046, 0.022],     // porosty i mech (ciemna oliwka z brązem)
    grassDry: [0.25, 0.105, 0.048],       // regolit z rzadką roślinnością
    forestDark: [0.017, 0.021, 0.012],    // lasy szklarniowe (ciemne iglaste)
    forestLight: [0.034, 0.038, 0.018],
    forestCold: [0.024, 0.024, 0.019],
    rockA: [0.155, 0.070, 0.042],         // rdzawa skała
    rockB: [0.070, 0.036, 0.027],         // ciemny bazalt
    rockDesert: [0.30, 0.115, 0.055],
    sandA: [0.40, 0.165, 0.068],          // rdzawy piasek
    sandB: [0.115, 0.062, 0.043],         // ciemne bazaltowe wydmy
    beach: [0.34, 0.18, 0.11],
    snow: [0.60, 0.56, 0.54],             // szron (lekko różowy)
    ice: [0.44, 0.47, 0.52],
    waterDeep: [0.006, 0.013, 0.022],     // zimne, ciemne jeziora
    waterShallow: [0.028, 0.055, 0.066],
    cityRoof: [0.13, 0.082, 0.066],       // beton z regolitu, terakota
    street: [0.050, 0.034, 0.029],
    cityAvg: [0.12, 0.080, 0.064],
    metalA: [0.10, 0.068, 0.056],
    metalB: [0.165, 0.11, 0.088],
    skyHorizon: [0.40, 0.27, 0.19],       // odbicie nieba (maślany pył)
    skyZenith: [0.16, 0.10, 0.08],
    planetLit: [0.30, 0.16, 0.10]
  },
  structurePalette: {
    ...EARTH.structurePalette,
    hull: [0.040, 0.024, 0.020],
    roof: [0.082, 0.046, 0.036],
    wall: [0.086, 0.056, 0.045],
    facadeA: [0.105, 0.068, 0.052],
    facadeB: [0.070, 0.050, 0.040],
    windowGlass: [0.028, 0.020, 0.016],
    deck: [0.17, 0.13, 0.11],
    greenA: [0.040, 0.046, 0.020],
    greenB: [0.022, 0.028, 0.014],
    envSkyHorizon: [0.30, 0.20, 0.14],
    envSkyZenith: [0.12, 0.075, 0.06],
    envGround: [0.05, 0.028, 0.02],
    planetLit: [0.22, 0.12, 0.08],
    roofTint: [1.35, 0.80, 0.66]
  },
  megaPalette: [
    [0.170, 0.100, 0.075], [0.100, 0.058, 0.045], [0.034, 0.022, 0.018], [0.300, 0.262, 0.215],
    [0.150, 0.065, 0.035], [0.070, 0.042, 0.034], [0.330, 0.060, 0.035], [0.070, 0.045, 0.025],
    [0.085, 0.058, 0.048], [0.220, 0.150, 0.120], [0.190, 0.060, 0.035], [0.030, 0.080, 0.150],
    [0.160, 0.120, 0.050], [0.260, 0.210, 0.170], [0.250, 0.170, 0.130], [0.240, 0.150, 0.100],
    [0.160, 0.100, 0.075], [0.270, 0.190, 0.150], [0.140, 0.080, 0.060], [0.045, 0.030, 0.026],
    [0.280, 0.240, 0.200], [0.240, 0.170, 0.130], [0.160, 0.120, 0.080], [0.130, 0.090, 0.075],
    [0.300, 0.160, 0.100], [0.300, 0.130, 0.070], [0.300, 0.240, 0.180], [0.270, 0.150, 0.100],
    [0.200, 0.150, 0.130], [0.180, 0.110, 0.070], [0.050, 0.058, 0.035], [0.180, 0.080, 0.055]
  ],
  domeTint: [1.45, 1.0, 0.62],            // bursztynowe szkło ciśnieniowe
  leafTint: [0.82, 0.92, 1.05],
  indTopTint: [1.3, 0.78, 0.62],
  megaSky: [[0.36, 0.24, 0.17], [0.14, 0.09, 0.07]],
  air: {
    scaleHeight: 700,
    // pył: rozprasza czerwień mocniej niż błękit (maślane niebo), Mie
    // mocny i do przodu, zabarwiony na błękit wokół słońca (błękitny zachód)
    rayleigh: [1.9e-4, 1.25e-4, 0.8e-4],
    mie: 3.2e-5,
    mieG: 0.82,
    multiScatter: 1.4,
    mieTint: [0.72, 0.88, 1.2],
    skyBoost: 2.0,
    cloudCoverBias: { inward: -0.1, outward: -0.22 }
  },
  sky: { tint: [0.74, 0.50, 0.33], cloudTint: [0.86, 0.68, 0.52] },
  light: {
    ...EARTH.light,
    sunIntensity: 0.98,
    sunColor: [1.0, 0.95, 0.88],
    planetAlbedo: 0.25,
    planetshineColor: [0.85, 0.55, 0.38],
    planetAtmosphereHeight: 250,
    planetNight: [0.0005, 0.0003, 0.00015]
  },
  hdr: {
    windowWarm: [1.3, 0.66, 0.32],
    windowSodium: [1.3, 0.55, 0.16],
    windowCool: [0.95, 0.88, 1.05],
    strip: [1.3, 0.52, 0.17]
  },
  roofRules: { occupancy: [0.5, 0.6, 0.85, 0.8], kinds: [0.18, 0.62, 0.7, 0.78], plotEmpty: [0.75, 0.55, 0.32, 0.3] },
  industryKit: { cdf: [0.34, 0.44, 0.58, 0.72, 0.76, 0.86, 1.01, 1.01] },
  landmarks: { set: 'mars', sectorTypes: ['garden', 'glass'] },
  domes: { set: 'mars' },
  port: {
    ...EARTH.port,
    name: 'PORT THARSIS',
    terminal: 'K-7 / TERMINAL HABITATU',
    k7Palette: [0x8a6e62, 0x3b2723, 0xd8c6ad, 0xb33b2b, 0xc4692e, 0x8a4a38, 0x9a8174, 0x907c72,
      0x1e1512, 0x3e3431, 0xa4683a, 0x4d2c16, 0xe2caa0, 0xeaa35e],
    k7Emit: [[1.30, 0.56, 0.18], [1.30, 0.72, 0.34], [1.40, 1.30, 1.10], [1.30, 0.14, 0.07], [1.10, 0.95, 0.40]],
    k7Glow: [[0.110 * 0.35, 0.060 * 0.35, 0.025 * 0.35], [0.12, 0.07, 0.035]],
    labels: {
      gate: '#e6b88e', hub: '#8c6b5c', clear: '#c9ab92', bank: '#d4bb9e', control: '#d8b89c',
      logistics: '#ac8c7a', capital: '#ccab92', berthLead: '#f2c394', berth: '#e2c9a2', stop: '#9c8276',
      terminal: '#ecd0b2', bayLane: '#ccab92', bayBank: '#d4bb9e', bayId: '#8c6b5c'
    },
    roof: 'vault',
    walls: 'berm',
    bays: 'berm'
  }
};

// ---------------------------------------------------------------------------
// JOWISZ — przemysł przerobu gazów (rafinerie, farmy zbiorników, radiatory,
// kanały chłodzące), lód jak na Europie (linie), siarka jak na Io, arkologie
// robotników; ciężkie chmury z błyskami burz; konstrukcja grafitowa z żółtym
// oznakowaniem, sodowe i turkusowe światła; hale K-7 z radiatorami i rurami.
// Kompleksy portu w sektorach przemysłowych 0/4/8/12, tranzyty w środkach
// 2/6/10/14; megabudowle przemysłowe w 1/5/11 (poza zatokami), arkologie
// w 2/6/10/15, kopuły hydroponiczne przy arkologiach.
const JUPITER_SECTORS = [
  { type: 'industrial', name: 'GALILEO', biome: 'port', port: true, climate: { sea: 0.06, mount: 0.2, temp: 0.42, moist: 0.3 } },
  { type: 'industrial', name: 'AMALTHEA', climate: { sea: 0.08, mount: 0.15, temp: 0.45, moist: 0.3 } },
  { type: 'glass', name: 'THEBE', climate: { sea: 0.14, mount: 0.12, temp: 0.5, moist: 0.45 } },
  { type: 'landscape', name: 'ADRASTEA', biome: 'glacier', climate: { sea: 0.12, mount: 0.35, temp: 0.04, moist: 0.4 }, feat: { crater: 0.15 } },
  { type: 'industrial', name: 'METIS', climate: { sea: 0.08, mount: 0.15, temp: 0.45, moist: 0.3 } },
  { type: 'industrial', name: 'HIMALIA', climate: { sea: 0.08, mount: 0.15, temp: 0.45, moist: 0.3 } },
  { type: 'glass', name: 'ELARA', climate: { sea: 0.14, mount: 0.12, temp: 0.5, moist: 0.45 } },
  { type: 'landscape', name: 'LYSITHEA', biome: 'desert', climate: { sea: 0.03, mount: 0.5, temp: 0.9, moist: 0.05 }, feat: { crater: 0.8, mesa: 0.4 } },
  { type: 'industrial', name: 'LEDA', climate: { sea: 0.08, mount: 0.15, temp: 0.45, moist: 0.3 } },
  { type: 'landscape', name: 'CARME', biome: 'glacier', climate: { sea: 0.16, mount: 0.4, temp: 0.05, moist: 0.4 }, feat: { crater: 0.3 } },
  { type: 'glass', name: 'ANANKE', climate: { sea: 0.14, mount: 0.12, temp: 0.5, moist: 0.45 } },
  { type: 'industrial', name: 'PASIPHAE', climate: { sea: 0.08, mount: 0.15, temp: 0.45, moist: 0.3 } },
  { type: 'industrial', name: 'THEMISTO', climate: { sea: 0.08, mount: 0.15, temp: 0.45, moist: 0.3 } },
  { type: 'garden', name: 'CALLIRRHOE', climate: { sea: 0.24, mount: 0.2, temp: 0.55, moist: 0.65 } },
  { type: 'landscape', name: 'SINOPE', biome: 'desert', climate: { sea: 0.02, mount: 0.6, temp: 0.92, moist: 0.04 }, feat: { crater: 1.0 } },
  { type: 'glass', name: 'KALE', climate: { sea: 0.14, mount: 0.12, temp: 0.5, moist: 0.45 } }
];

const JUPITER = {
  ...EARTH,
  key: 'jupiter',
  label: 'Jowisz',
  sectorPlan: JUPITER_SECTORS,
  sectorMix: { landscape: 4, garden: 1, industrial: 7, glass: 4 },
  landscapeBiomes: ['glacier', 'desert'],
  biomeClimate: {
    port: { sea: 0.06, mount: 0.2, temp: 0.42, moist: 0.3 },
    glacier: { sea: 0.12, mount: 0.35, temp: 0.04, moist: 0.4 },
    desert: { sea: 0.03, mount: 0.5, temp: 0.9, moist: 0.05 },
    sea: { sea: 0.5, mount: 0.2, temp: 0.3, moist: 0.6 },
    alpine: { sea: 0.1, mount: 0.9, temp: 0.2, moist: 0.4 },
    forest: { sea: 0.2, mount: 0.3, temp: 0.5, moist: 0.7 }
  },
  typeClimate: {
    garden: { sea: 0.24, mount: 0.2, temp: 0.55, moist: 0.65 },
    industrial: { sea: 0.08, mount: 0.15, temp: 0.45, moist: 0.3 },
    glass: { sea: 0.14, mount: 0.12, temp: 0.5, moist: 0.45 }
  },
  terrain: { plateau: 0, rivers: 0.25, seaDepth: 100 },
  canyons: [],
  frag: { sulfur: 1, lineae: 1 },
  terrainPalette: {
    ...EARTH.terrainPalette,
    grassLush: [0.040, 0.058, 0.032],     // hydroponika (szarozielona)
    grassDry: [0.16, 0.14, 0.055],
    forestDark: [0.012, 0.024, 0.018],
    forestLight: [0.022, 0.044, 0.032],
    forestCold: [0.020, 0.030, 0.030],
    rockA: [0.068, 0.064, 0.058],         // bazalt
    rockB: [0.034, 0.031, 0.029],         // zastygła lawa
    rockDesert: [0.36, 0.26, 0.05],       // osady siarki
    sandA: [0.50, 0.40, 0.075],           // siarka (żółta)
    sandB: [0.29, 0.13, 0.038],           // siarka (pomarańczowa)
    beach: [0.36, 0.33, 0.20],
    snow: [0.64, 0.60, 0.54],             // lód jak Europa (beżowobiały)
    ice: [0.42, 0.50, 0.55],
    waterDeep: [0.004, 0.017, 0.013],     // chłodziwo (ciemna zieleń)
    waterShallow: [0.018, 0.075, 0.048],
    cityRoof: [0.092, 0.092, 0.086],
    street: [0.035, 0.036, 0.035],
    cityAvg: [0.095, 0.094, 0.088],
    metalA: [0.070, 0.074, 0.070],
    metalB: [0.125, 0.125, 0.115],
    skyHorizon: [0.18, 0.24, 0.24],
    skyZenith: [0.05, 0.08, 0.09],
    planetLit: [0.30, 0.24, 0.16],
    lineae: [0.20, 0.085, 0.045],         // linie na lodzie (Europa)
    sulfurWhite: [0.56, 0.54, 0.44],
    lava: [0.018, 0.016, 0.014]
  },
  structurePalette: {
    ...EARTH.structurePalette,
    hull: [0.026, 0.026, 0.025],
    roof: [0.058, 0.056, 0.050],
    wall: [0.052, 0.054, 0.052],
    facadeA: [0.078, 0.077, 0.072],
    facadeB: [0.036, 0.058, 0.056],
    windowGlass: [0.016, 0.026, 0.026],
    deck: [0.15, 0.145, 0.12],
    greenA: [0.030, 0.046, 0.030],
    greenB: [0.018, 0.030, 0.020],
    envSkyHorizon: [0.14, 0.18, 0.18],
    envSkyZenith: [0.04, 0.06, 0.07],
    envGround: [0.03, 0.03, 0.026],
    planetLit: [0.22, 0.17, 0.11],
    roofTint: [1.0, 0.97, 0.84]
  },
  megaPalette: [
    [0.130, 0.128, 0.115], [0.078, 0.076, 0.070], [0.026, 0.026, 0.025], [0.270, 0.260, 0.230],
    [0.130, 0.080, 0.040], [0.050, 0.050, 0.046], [0.400, 0.300, 0.020], [0.025, 0.060, 0.055],
    [0.070, 0.070, 0.066], [0.190, 0.190, 0.180], [0.190, 0.060, 0.035], [0.030, 0.080, 0.150],
    [0.160, 0.120, 0.050], [0.220, 0.210, 0.190], [0.200, 0.200, 0.190], [0.220, 0.200, 0.160],
    [0.130, 0.130, 0.120], [0.240, 0.240, 0.220], [0.110, 0.100, 0.080], [0.035, 0.034, 0.033],
    [0.300, 0.290, 0.260], [0.220, 0.210, 0.180], [0.160, 0.120, 0.080], [0.160, 0.120, 0.080],
    [0.200, 0.190, 0.170], [0.320, 0.200, 0.070], [0.300, 0.280, 0.240], [0.220, 0.190, 0.150],
    [0.120, 0.170, 0.170], [0.210, 0.130, 0.075], [0.030, 0.050, 0.030], [0.120, 0.100, 0.080]
  ],
  domeTint: [0.8, 1.1, 1.0],
  leafTint: [0.8, 1.0, 0.9],
  indTopTint: [1.0, 0.98, 0.9],
  megaSky: [[0.17, 0.22, 0.22], [0.05, 0.08, 0.09]],
  air: {
    scaleHeight: 620,
    // smog przemysłowy: szarozielone niebo, mgła gęstsza niż na Ziemi
    rayleigh: [6.0e-5, 1.0e-4, 1.2e-4],
    mie: 2.4e-5,
    mieG: 0.7,
    multiScatter: 1.5,
    mieTint: [1.0, 0.96, 0.86],
    skyBoost: 2.2,
    cloudCoverBias: { inward: 0.12, outward: 0.1 }
  },
  sky: { tint: [0.40, 0.54, 0.54], cloudTint: [0.48, 0.50, 0.51] },
  light: {
    ...EARTH.light,
    sunIntensity: 0.94,
    sunColor: [0.98, 0.97, 0.93],
    planetAlbedo: 0.52,
    planetshineColor: [0.86, 0.72, 0.52],
    planetshineGain: 1.1,
    planetAtmosphereHeight: 1800,
    planetNight: [0.0008, 0.0009, 0.0012]
  },
  hdr: {
    windowWarm: [1.28, 0.74, 0.36],
    windowSodium: [1.3, 0.58, 0.16],
    windowCool: [0.42, 1.05, 0.95],
    strip: [0.24, 1.15, 0.86]
  },
  storm: { strength: 1, rate: 0.08, cell: 1800, brightness: 3.2 },
  roofRules: { occupancy: [0.62, 0.68, 0.95, 0.9], kinds: [0.42, 0.52, 0.86, 0.94], plotEmpty: [0.7, 0.55, 0.26, 0.25] },
  industryKit: { cdf: [0.10, 0.36, 0.40, 0.48, 0.58, 0.76, 0.80, 1.01] },
  landmarks: { set: 'jupiter', sectorTypes: ['industrial', 'glass'] },
  domes: { set: 'jupiter' },
  port: {
    ...EARTH.port,
    name: 'PORT GALILEO',
    terminal: 'K-7 / TERMINAL RAFINERII',
    k7Palette: [0x6f7470, 0x23272a, 0xb8b09a, 0xe0b020, 0xd06a18, 0x2f8a78, 0x7a807c, 0x8a8f86,
      0x0e1012, 0x303534, 0xb07a40, 0x12403a, 0xe0c040, 0x60d0b0],
    k7Emit: [[0.24, 1.15, 0.86], [1.30, 0.62, 0.20], [1.40, 1.36, 1.14], [1.30, 0.14, 0.06], [0.40, 1.15, 0.50]],
    k7Glow: [[0.020 * 0.35, 0.140 * 0.35, 0.120 * 0.35], [0.05, 0.11, 0.09]],
    labels: {
      gate: '#e8c848', hub: '#6f7a70', clear: '#bab892', bank: '#cac292', control: '#b2cab9',
      logistics: '#8c9c8a', capital: '#d2c272', berthLead: '#eed462', berth: '#e2cc64', stop: '#8c8c7a',
      terminal: '#dcd4a2', bayLane: '#d2c272', bayBank: '#cac292', bayId: '#6f7a70'
    },
    roof: 'radiator',
    walls: 'pipes',
    bays: 'industrial'
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
