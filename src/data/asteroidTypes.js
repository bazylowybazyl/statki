/**
 * Asteroid type definitions, size classes, texture mappings, and belt layouts.
 *
 * 7 surowych typów asteroid odpowiadających łańcuchom produkcji w grze:
 *   iron    -> iron_ore    -> steel
 *   copper  -> copper_ore  -> copper_wire
 *   silicon -> silicon_ore -> chips
 *   titan   -> titanium_ore-> titan_alloy
 *   crystal -> raw_crystal -> optic_lens
 *   ice     -> ice         -> hydrogen / oxygen
 *   uran    -> uranium_ore -> fuel_rods
 *
 * Każdy typ ma 10 wariantów wizualnych (assetów PNG):
 *   3x small, 3x medium, 3x large, 1x BIG.
 */

export const ASTEROID_TYPES = ['iron', 'copper', 'silicon', 'titan', 'crystal', 'ice', 'uran'];

export const ASTEROID_RESOURCE = {
  iron:    'iron_ore',
  copper:  'copper_ore',
  silicon: 'silicon_ore',
  titan:   'titanium_ore',
  crystal: 'raw_crystal',
  ice:     'ice',
  uran:    'uranium_ore',
};

// Tint mnożnikowy dla MeshBasicMaterial (PNG-i już są kolorowe, więc tint blisko bieli).
export const ASTEROID_TINT = {
  iron:    0xffffff,
  copper:  0xffffff,
  silicon: 0xffffff,
  titan:   0xffffff,
  crystal: 0xffffff,
  ice:     0xffffff,
  uran:    0xffffff,
};

// Etykietki PL do UI / sensorów.
export const ASTEROID_LABEL_PL = {
  iron:    'Asteroida żelaza',
  copper:  'Asteroida miedzi',
  silicon: 'Asteroida krzemu',
  titan:   'Asteroida tytanu',
  crystal: 'Asteroida krystaliczna',
  ice:     'Asteroida lodowa',
  uran:    'Asteroida uranu',
};

export const ASTEROID_SIZES = ['S', 'M', 'L', 'BIG'];

/**
 * Klasy rozmiarów. `scale` to średnica sprite w world units.
 * `splitInto` definiuje czym rozpada się asteroida po zniszczeniu
 * (BIG -> 2x L, L -> 2x M, M -> 2x S, S -> brak / tylko loot).
 */
export const SIZE_CLASS = {
  S:   { hp: 60,    scale: 140,  yield: 1,  variants: 3, splitInto: null },
  M:   { hp: 260,   scale: 320,  yield: 4,  variants: 3, splitInto: { size: 'S', count: 2 } },
  L:   { hp: 1000,  scale: 680,  yield: 16, variants: 3, splitInto: { size: 'M', count: 2 } },
  BIG: { hp: 4500,  scale: 1500, yield: 64, variants: 1, splitInto: { size: 'L', count: 2 } },
};

/**
 * Mapowanie type+size+variantIndex -> bazowa nazwa pliku PNG (bez ścieżki i rozszerzenia).
 * Ręcznie naprawione literówki w nazwach plików assetów:
 *   - 'coperm2'    (zamiast copperm2)
 *   - 'cyrystals2' (zamiast crystals2)
 *   - 'crystallm3' (zamiast crystalm3)
 */
export const ASTEROID_TEXTURE_FILES = {
  iron: {
    S:   ['irons1', 'irons2', 'irons3'],
    M:   ['ironm1', 'ironm2', 'ironm3'],
    L:   ['ironl1', 'ironl2', 'ironl3'],
    BIG: ['ironbig1'],
  },
  copper: {
    S:   ['coppers1', 'coppers2', 'coppers3'],
    M:   ['copperm1', 'coperm2', 'copperm3'],         // 'coperm2' - typo w assetach
    L:   ['copperl1', 'copperl2', 'copperl3'],
    BIG: ['copperbig1'],
  },
  silicon: {
    S:   ['silicons1', 'silicons2', 'silicons3'],
    M:   ['siliconm1', 'siliconm2', 'siliconm3'],
    L:   ['siliconl1', 'siliconl2', 'siliconl3'],
    BIG: ['siliconbig1'],
  },
  titan: {
    S:   ['titans1', 'titans2', 'titans3'],
    M:   ['titanm1', 'titanm2', 'titanm3'],
    L:   ['titanl1', 'titanl2', 'titanl3'],
    BIG: ['titanbig1'],
  },
  crystal: {
    S:   ['crystals1', 'cyrystals2', 'crystals3'],    // 'cyrystals2' - typo
    M:   ['crystalm1', 'crystalm2', 'crystallm3'],    // 'crystallm3' - typo
    L:   ['crystall1', 'crystall2', 'crystall3'],
    BIG: ['crystalbig1'],
  },
  ice: {
    S:   ['ices1', 'ices2', 'ices3'],
    M:   ['icem1', 'icem2', 'icem3'],
    L:   ['icel1', 'icel2', 'icel3'],
    BIG: ['icebig1'],
  },
  uran: {
    S:   ['urans1', 'urans2', 'urans3'],
    M:   ['uranm1', 'uranm2', 'uranm3'],
    L:   ['uranl1', 'uranl2', 'uranl3'],
    BIG: ['uranbig1'],
  },
};

export const ASTEROID_TEXTURE_BASE_PATH = 'src/assets/asteroids/';

/**
 * Limit liczby wariantów wizualnych per (typ, rozmiar). Mamy 3 warianty PNG na S/M/L
 * (i 1 na BIG), ale każdy wariant = osobna InstancedMesh + osobna tekstura w VRAM
 * + osobny draw call. Przy 500k asteroid 70 draw calli x ~100µs WebGL overhead =
 * ~7ms/klatkę. Z MAX_VARIANTS=1: 28 pul → 28 draw calli → ~3ms.
 *
 * Wariant 0 zawsze ładowany, kolejne tylko gdy MAX_VARIANTS_PER_SIZE >= 2/3.
 * Bumpnij do 3 jeśli wydajność pozwoli.
 */
export const MAX_VARIANTS_PER_SIZE = 1;

/**
 * Strefy (pasy) asteroid w układzie. Wzorowane na realnym rozmieszczeniu:
 *   - Main Belt (Mars↔Jupiter)
 *   - Greeks   (L4, 60° przed Jowiszem)
 *   - Trojans  (L5, 60° za Jowiszem)
 *   - Hildas   (rezonans 3:2 z Jowiszem - 3 klastry trójkątne)
 *   - Kuiper   (za Neptunem)
 *
 * W skali gry: Mars=33 AU, Jupiter=50.2 AU, Neptune=120 AU.
 * 1 AU ~ 3000 world units (getAuToWorldUnits()).
 *
 * `count` to docelowa liczba asteroid w pasie. `types` i `sizes` to
 * rozkłady prawdopodobieństwa (powinny sumować się do ~1.0).
 * `thicknessAU` to rozproszenie wokół płaszczyzny ekliptyki (Z).
 */
export const BELT_DEFINITIONS = [
  {
    id: 'main',
    shape: 'ring',
    innerAU: 36,
    outerAU: 47,
    thicknessAU: 1.5,
    count: 225000,
    types: { iron: 0.30, silicon: 0.28, copper: 0.20, titan: 0.15, crystal: 0.07 },
    sizes: { S: 0.62, M: 0.26, L: 0.10, BIG: 0.02 },
  },
  {
    id: 'greeks',
    shape: 'lagrange',
    lagrange: 'L4',
    anchorPlanet: 'jupiter',
    spreadAU: 6,
    arcSpread: 0.35,
    count: 60000,
    types: { iron: 0.32, silicon: 0.36, copper: 0.20, titan: 0.10, crystal: 0.02 },
    sizes: { S: 0.65, M: 0.25, L: 0.09, BIG: 0.01 },
  },
  {
    id: 'trojans',
    shape: 'lagrange',
    lagrange: 'L5',
    anchorPlanet: 'jupiter',
    spreadAU: 6,
    arcSpread: 0.35,
    count: 60000,
    types: { iron: 0.32, silicon: 0.36, copper: 0.20, titan: 0.10, crystal: 0.02 },
    sizes: { S: 0.65, M: 0.25, L: 0.09, BIG: 0.01 },
  },
  {
    id: 'hildas',
    shape: 'triangle',
    anchorPlanet: 'jupiter',
    radiusAU: 42,
    spreadAU: 3,
    count: 45000,
    types: { silicon: 0.42, iron: 0.30, copper: 0.20, crystal: 0.08 },
    sizes: { S: 0.70, M: 0.22, L: 0.07, BIG: 0.01 },
  },
  {
    id: 'kuiper',
    shape: 'ring',
    innerAU: 125,
    outerAU: 140,
    thicknessAU: 3.0,
    count: 110000,
    types: { ice: 0.42, crystal: 0.26, silicon: 0.14, uran: 0.12, titan: 0.06 },
    sizes: { S: 0.58, M: 0.27, L: 0.12, BIG: 0.03 },
  },
];

/**
 * Capacity InstancedMesh per (type, size) - z marginesem na split'y i ewentualny respawn.
 * Liczba wariantów per size: S=3, M=3, L=3, BIG=1. Każdy wariant ma własny mesh.
 *
 * Realnie z BELT_DEFINITIONS wynika sumarycznie ~1680 asteroid - rozłożone na
 * 7 typów * 4 size = 28 (type,size) buckets. Każdy variant trzyma ~1/3 (lub całość dla BIG).
 * Capacity dobrane konserwatywnie z dużym marginem.
 */
export const POOL_CAPACITY_PER_VARIANT = {
  S:   35000,
  M:   19000,
  L:   9000,
  BIG: 3500,
};

// === Helpery ===

/**
 * Wybiera klucz z rozkładu prawdopodobieństwa.
 * @param {Object<string, number>} distribution mapa key->weight (sumująca się ~do 1.0)
 * @param {() => number} rng deterministyczny generator [0..1)
 */
export function pickWeighted(distribution, rng) {
  const keys = Object.keys(distribution);
  let total = 0;
  for (const k of keys) total += distribution[k];
  let r = rng() * total;
  for (const k of keys) {
    r -= distribution[k];
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

export function texturePath(type, size, variantIndex) {
  const variants = ASTEROID_TEXTURE_FILES[type]?.[size];
  if (!variants || variants.length === 0) return null;
  const v = variants[variantIndex % variants.length];
  return `${ASTEROID_TEXTURE_BASE_PATH}${v}.png`;
}

/**
 * Wszystkie nazwy plików asteroid (do ewentualnego preloadu).
 */
export function getAllTextureFilenames() {
  const out = [];
  for (const type of ASTEROID_TYPES) {
    for (const size of ASTEROID_SIZES) {
      for (const v of ASTEROID_TEXTURE_FILES[type][size]) {
        out.push(`${ASTEROID_TEXTURE_BASE_PATH}${v}.png`);
      }
    }
  }
  return out;
}
