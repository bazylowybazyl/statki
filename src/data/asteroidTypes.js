/**
 * Asteroid type definitions, size classes, texture mappings, and belt layouts.
 *
 * 7 surowych typów asteroid. Pełne łańcuchy produkcji (surowiec -> rafinat ->
 * komponent) definiuje src/data/resources.js — to jest jedyne źródło prawdy
 * dla surowców. Ten plik odpowiada wyłącznie za asteroidy: wizualia, rozmiary
 * i rozmieszczenie w pasach.
 *
 * Każdy typ ma 10 wariantów wizualnych (assetów PNG):
 *   3x small, 3x medium, 3x large, 1x BIG.
 */

import { ASTEROID_YIELD } from './resources.js';

export const ASTEROID_TYPES = ['iron', 'copper', 'silicon', 'titan', 'crystal', 'ice', 'uran'];

/**
 * Typy z widm prawdziwych planetoid (2026-10-12, docs/PLAN-pas-realizm.md § Typy) — rudy pola
 * nowego pasa (src/game/asteroidRockKinds.js: indeksy 9–13 ROCK_TYPES, po 'rock' i 'energy').
 * Osobna lista, bo ASTEROID_TYPES ma tekstury PNG dawnego pola (ASTEROID_TEXTURE_FILES):
 *   carbon    — C, chondryt węglisty (Bennu, Ryugu): ciemna, porowata; węgiel, organika, woda związana;
 *   metal     — M, żelazo-nikiel (Psyche): nikiel z kobaltem;
 *   basalt    — V, bazalt Westy (HED): piroksen, plagioklaz, ilmenit — tytan;
 *   primitive — D / P (Hildy, Trojańczycy, Kuiper): czerwonobrązowe toliny, lód pod skorupą;
 *   platinum  — M bogata w platynowce — najwyższy szczebel rud, tylko w rdzeniach pól metalicznych.
 */
export const SPECTRAL_ORE_TYPES = ['carbon', 'metal', 'basalt', 'primitive', 'platinum'];

/** @deprecated Zgodność wsteczna — importuj ASTEROID_YIELD z resources.js. */
export const ASTEROID_RESOURCE = ASTEROID_YIELD;

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
 *   - Hildas   (rezonans 3:2 z Jowiszem - skupiska w wierzchołkach trójkąta L3 / L4 / L5)
 *   - Kuiper   (za Neptunem)
 *
 * Współrzędne poniżej opisują rozciągnięty układ mapy, nie fizyczne AU.
 * Zachowują duże odstępy gameplayowe: Mars=33, Jupiter=50.2, Neptune=120.
 * Prawdziwe odległości przeliczone liniowo między Marsem i Jowiszem:
 *   AU mapy = 33 + (a − 1,524) · 17,2 / 3,680  (Hildy: a = 3,97 AU → 44,4 AU mapy).
 *
 * `priority` (domyślnie 0): region o wyższym priorytecie wygrywa wybór regionu
 * (skład) wszędzie, gdzie leży — Hildy leżą wewnątrz pasa głównego, a zwykłe
 * pierwszeństwo (najgłębsze wniknięcie) zawsze oddawało ten punkt pierścieniowi.
 * Gęstość i obwiednia pasa liczą się po staremu (najgłębsze wniknięcie).
 *
 * `types` — skład rud regionu (src/game/asteroidBeltField.js: `_pickType`; udział rud wobec
 * wypełniacza i szczeble rud liczy głębokość w polu — asteroidRockKinds.js). Dwie postaci:
 *   { typ: waga, … }                 — stały skład (wypełniacz kamienny);
 *   [{ au, dark, ore: { typ: waga } }, …] — PRZYSTANKI po odległości od Słońca [AU mapy]: skład
 *     między przystankami liniowo, poza skrajnymi — skrajny; `dark` (0 … 1) = udział wypełniacza
 *     w odmianie WĘGLOWEJ (rock_c — ciemny) zamiast kamiennej (rock) — wypełniacz idzie za
 *     gradientem pasa tylko wyglądem (decyzja użytkownika 2026-10-12).
 * Gradient pasa głównego (prawdziwe położenia przeliczone jak wyżej): wewnątrz S (krzem) z rodziną
 * Westy (V, bazalt, ~36,9 AU mapy), w środku S + C z M (szczyt M ~2,7 AU = 38,6), na zewnątrz
 * C (z lodem przy Themis ~40,5); Hildy i Trojańczycy — D; Kuiper — lód, D, kryształ, uran.
 */
export const BELT_DEFINITIONS = [
  {
    id: 'main',
    shape: 'ring',
    // Wewnętrzna krawędź = rezonans 4:1 / ν6 (prawdziwe 2,06 AU) — ostra (edgeInAU), za nią rzadki przesmyk
    // od Hungarii (34,2–35,1). Zewnętrzna 41,5 — BELT_FIELD_CONFIG.mainOuterAu; 47 zostaje dla strefy HUD.
    innerAU: 35.5,
    edgeInAU: 0.35,
    outerAU: 47,
    types: [
      { au: 35.5, dark: 0, ore: { silicon: 0.42, iron: 0.22, copper: 0.12, titan: 0.10, basalt: 0.06, crystal: 0.05, carbon: 0.03 } },
      { au: 36.9, dark: 0, ore: { silicon: 0.32, iron: 0.17, basalt: 0.22, copper: 0.10, titan: 0.08, crystal: 0.05, carbon: 0.06 } },
      { au: 37.6, dark: 0.15, ore: { silicon: 0.30, iron: 0.16, carbon: 0.14, metal: 0.09, copper: 0.10, titan: 0.08, basalt: 0.06, crystal: 0.05, platinum: 0.02 } },
      { au: 38.6, dark: 0.4, ore: { carbon: 0.28, silicon: 0.22, metal: 0.18, iron: 0.09, copper: 0.07, titan: 0.06, crystal: 0.05, platinum: 0.04, ice: 0.01 } },
      // Odsłonięty lód (`ice`) w pasie głównym najwyżej śladowo (≤ 3%): woda siedzi w minerałach C
      // i pod skorupą D (urobek D = lód); biały lód zostaje dla Kuipera i komet. Za linią śniegu
      // (~2,7 AU prawdziwe = 38,5 AU mapy) część C ma lód w rdzeniach (carbon_ice — aktywne planetoidy
      // pasa: 133P, 176P, 238P), najwięcej w rodzinie Themis (asteroidFamilies.js).
      { au: 39.1, dark: 0.65, ore: { carbon: 0.39, carbon_ice: 0.02, silicon: 0.17, metal: 0.12, iron: 0.07, copper: 0.06, titan: 0.06, crystal: 0.05, ice: 0.02, platinum: 0.03 } },
      { au: 40.5, dark: 0.9, ore: { carbon: 0.50, carbon_ice: 0.06, primitive: 0.1, silicon: 0.09, metal: 0.06, copper: 0.04, titan: 0.04, crystal: 0.05, ice: 0.03, platinum: 0.01 } },
      { au: 41.5, dark: 0.95, ore: { carbon: 0.47, carbon_ice: 0.08, primitive: 0.17, silicon: 0.08, metal: 0.04, titan: 0.04, copper: 0.03, crystal: 0.05, ice: 0.03, platinum: 0.01 } }
    ],
  },
  {
    id: 'greeks',
    shape: 'lagrange',
    lagrange: 'L4',
    anchorPlanet: 'jupiter',
    // Rój = kijanka wokół L4: 25°–105° od Jowisza (ku Jowiszowi 35°, od Jowisza 45° — orbity z dużą
    // amplitudą libracji odchodzą dalej od Jowisza), rdzeń ±15°, końce rzadsze i węższe (bananaK);
    // r = a(1 ± e) ≈ 50,2 ± 2,2 AU mapy (a 5,05–5,35 AU, e < 0,1). L4 : L5 ≈ 1,64 : 1 (znane: ~9 tys. / ~5,5 tys.).
    spreadAU: 4.4,
    arcSpread: 0.35,
    angLeadDeg: 35,
    angTrailDeg: 45,
    angCoreDeg: 15,
    angEnd: 0.35,
    bananaK: 0.5,
    // Trojańczycy to D / P (ciemni, czerwoni, lód pod skorupą — urobek D to lód) — nie metal. Czysty lód
    // poniżej progu prowincji rud (provinceMinWeight), żeby okolice nie wychodziły lodowe zamiast D.
    types: [{ au: 0, dark: 1, ore: { primitive: 0.62, carbon: 0.20, ice: 0.07, silicon: 0.04, crystal: 0.07 } }],
  },
  {
    id: 'trojans',
    shape: 'lagrange',
    lagrange: 'L5',
    anchorPlanet: 'jupiter',
    // Lustro L4, rzadszy rój (L4 : L5 ≈ 1,64 : 1).
    spreadAU: 4.4,
    arcSpread: 0.35,
    angLeadDeg: 35,
    angTrailDeg: 45,
    angCoreDeg: 15,
    angEnd: 0.35,
    bananaK: 0.5,
    densityMul: 0.61,
    types: [{ au: 0, dark: 1, ore: { primitive: 0.62, carbon: 0.20, ice: 0.07, silicon: 0.04, crystal: 0.07 } }],
  },
  {
    id: 'hildas',
    shape: 'triangle',
    anchorPlanet: 'jupiter',
    // Rezonans 3:2: w układzie obracającym się z Jowiszem Hildy krążą po trójkącie i zwalniają
    // w wierzchołkach — L3 (naprzeciw Jowisza), L4 (+60°) i L5 (−60°); przy samym Jowiszu ich nie ma.
    radiusAU: 44.4,
    spreadAU: 3,
    anglesDeg: [180, 60, -60],
    arcSpread: 0.34,
    priority: 1,
    // Hildy: D (z domieszką P / C) — ciemne, czerwonawe.
    types: [{ au: 0, dark: 1, ore: { primitive: 0.58, carbon: 0.22, ice: 0.07, silicon: 0.05, metal: 0.02, crystal: 0.06 } }],
  },
  {
    id: 'kuiper',
    shape: 'ring',
    // KRAWĘDŹ 140 WYZNACZA SKALĘ ŚWIATA (systemMap.computeWorldUnitsPerAu: 12 mln / (2 · (140 + 2))) — nie
    // zmieniać innerAU / outerAU (czyta je też ruch v2: trafficFields). Budowa pasa w profilu gęstości:
    // plutonki 3:2 (125,5–128,5, nakładka `plutinos`), przerwa ν8 (prawdziwe 40–42 AU), pas klasyczny 130–137
    // z zimnym rdzeniem 132–135 (nakładka `kuiper_cold`), urwisko ~137,5 (2:1), dysk rozproszony rzadko do 140.
    innerAU: 125,
    outerAU: 140,
    profile: [[125.3, 0], [126, 0.55], [128, 0.55], [128.8, 0.15], [129.8, 0.15], [130.5, 0.8], [132, 1], [135, 1],
      [137.3, 0.85], [137.8, 0.1], [140, 0.06]],
    // Kuiper: lód, czerwona organika (D), kryształ i uran (uran tylko tu — decyzja użytkownika).
    types: [{ au: 0, dark: 1, ore: { ice: 0.40, primitive: 0.28, crystal: 0.18, uran: 0.14 } }],
  },
  // ── Populacje małych ciał (strumień E, 2026-10-12 — docs/PLAN-pas-realizm.md § „E: projekt”). Geometria i skład
  // tych definicji — E; skład istniejących wyżej — A. Pola gęstości / wycięć: asteroidBeltField.js (regionShapeFields).
  {
    // NEA (bliskie Ziemi; prawdziwe: 42,7 tys. znanych, 874 > 1 km — Atiry, Ateny, Apollo, Amory): rzadkie pojedyncze
    // skały wokół orbity Ziemi (25), Ateny i Atiry wewnątrz, Amory do q 1,3 AU (29,6). BEZ gęstych pól i bez strefy
    // HUD (każdy wylot z Ziemi przecina pasmo). Wycięcie wokół Ziemi: hale K-7 (~50 tys. j.), studnia (~56 tys.),
    // Luna (96 tys.), start kampanii — pas się tam nie budzi (rectTouchesBelt).
    id: 'nea',
    shape: 'ring',
    innerAU: 21,
    outerAU: 31,
    edgeAU: 0.8,
    profile: [[21, 0], [23, 0.5], [24.5, 1], [28, 1], [29.6, 0.5], [31, 0]],
    densityMul: 0.25,
    fieldMul: 0,
    // Mars (33) stoi 2 AU za zewnętrzną krawędzią — bez wycięcia pas budziłby się w jego porcie.
    holes: [{ planet: 'earth', r: 200000 }, { planet: 'mars', r: 200000 }],
    // S (krzem) i C (węgiel) z odrobiną M — jak prawdziwe NEA (~2/3 S i Q, reszta C, X).
    types: [{ au: 0, dark: 0.3, ore: { silicon: 0.45, carbon: 0.30, metal: 0.10, iron: 0.10, crystal: 0.05 } }],
  },
  {
    // Hungarie (1,78–2,0 AU → 34,2–35,1 AU mapy): za Marsem, odcięte od pasa rzadkim przesmykiem (4:1 / ν6 przy
    // 35,5). Nachylenia 16–34° — w przekroju płaszczyzny gry rzadziej; jasne typu E (bez typu E — bazalt i krzem,
    // E = enstatyt — najbliżej jasny bazalt V i krzem S, skład wg A1). Wycięcie wokół Marsa (port, studnia, Dejmos).
    id: 'hungarias',
    shape: 'ring',
    innerAU: 34.2,
    outerAU: 35.1,
    edgeAU: 0.25,
    densityMul: 0.35,
    fieldMul: 0.35,
    holes: [{ planet: 'mars', r: 180000 }],
    types: [{ au: 0, dark: 0, ore: { basalt: 0.40, silicon: 0.35, iron: 0.15, titan: 0.05, crystal: 0.05 } }],
  },
  {
    // Plutonki (rezonans 3:2 z Neptunem, prawdziwe a ≈ 39,4 AU): nakładka składu i gęstości w paśmie 125,5–128,5
    // pasa Kuipera; rezonans trzyma je z dala od Neptuna — przerzedzenie ±60° od jego długości (tam też księżyce
    // Neptuna). Pluton (strumień C, src/data/smallBodies.js) leży w tym paśmie ~127, poza ±60° od Neptuna.
    id: 'plutinos',
    shape: 'ring',
    innerAU: 125.5,
    outerAU: 128.5,
    edgeAU: 0.4,
    overlay: true,
    priority: 1,
    ice: 1,
    avoid: { planet: 'neptune', halfDeg: 60, softDeg: 15, depth: 0.2 },
    types: [{ au: 0, dark: 1, ore: { ice: 0.42, primitive: 0.24, crystal: 0.18, uran: 0.16 } }],
  },
  {
    // Zimny pas klasyczny (prawdziwe ~42–47 AU, małe nachylenia): wąski, gęstszy rdzeń bardzo czerwonych (D, toliny)
    // ciał z lodem w 132–135 AU mapy.
    id: 'kuiper_cold',
    shape: 'ring',
    innerAU: 132,
    outerAU: 135,
    edgeAU: 0.5,
    overlay: true,
    priority: 1,
    ice: 1,
    densityMul: 1.3,
    types: [{ au: 0, dark: 1, ore: { primitive: 0.55, ice: 0.35, crystal: 0.06, uran: 0.04 } }],
  },
];

export function getOutermostBeltEdgeAu(belts = BELT_DEFINITIONS, anchorOrbitAuById = {}) {
  return (belts || []).reduce((maxEdge, belt) => {
    if (belt?.shape === 'ring' && Number.isFinite(Number(belt.outerAU))) {
      return Math.max(maxEdge, Number(belt.outerAU));
    }
    if (belt?.shape === 'triangle' && Number.isFinite(Number(belt.radiusAU))) {
      return Math.max(maxEdge, Number(belt.radiusAU) + Math.max(0, Number(belt.spreadAU) || 0) * 0.5);
    }
    if (belt?.shape === 'lagrange') {
      const anchorAu = Number(anchorOrbitAuById?.[belt.anchorPlanet]);
      if (Number.isFinite(anchorAu)) {
        return Math.max(maxEdge, anchorAu + Math.max(0, Number(belt.spreadAU) || 0) * 0.5);
      }
    }
    return maxEdge;
  }, 0);
}

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
