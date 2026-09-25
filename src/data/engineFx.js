// src/data/engineFx.js
//
// Silniki MAIN i WARP — dane bez Three.js: palety, rozmiary per statek,
// rozwiązywanie konfiguracji. Czytają je edytor hardpointów, runtime układu
// NPC, układ gracza w index.html i moduły renderu (mainExhaust3D, warpPlume3D).
//
// MAIN = port `dema/silniki/silnik-wydech.html` (struga + iskry),
// WARP = port `dema/silniki/plasma_engine_demo.html` (PlasmaEngineFX). Warp
// leci z tych samych dysz co MAIN; dysze boczne zostają na starym batchu.
//
// ROZMIAR PER STATEK. Wcześniej szerokość i długość płomienia MAIN była jednym
// globalnym mnożnikiem (`engineVfxTune.v1`: mainW/mainL) dla całej floty —
// dopasowanie jednego kadłuba rozjeżdżało wszystkie inne. Teraz każdy kadłub
// ma własny blok `engineFx` w danych edytora (`hpEditor.v1` → ships[id]):
//
//   mainNozzle   średnica wylotu dyszy w PIKSELACH SPRITE'A (PNG), tych samych
//                co pozycje markerów; w grze × hpScale × spriteScale, więc
//                kółko narysowane w edytorze = rozmiar w grze
//   mainLength   mnożnik długości strugi MAIN
//   mainWidth    mnożnik szerokości strugi MAIN
//   mainPalette  paleta strugi (MAIN_EXHAUST_PALETTES[].id)
//   warpLength   mnożnik długości plazmy warpa
//   warpPalette  paleta plazmy (WARP_PLASMA_PALETTES[].id)
//
// Zapisane pola nadpisują ENGINE_FX_DEFAULTS pole po polu — stary zapis bez
// `engineFx` dostaje wartości dopasowane w kodzie.

/* ============================================================================
   PALETY MAIN — 1:1 z dema wydechu. Wartości liniowe HDR: >1 świeci w bloomie.
   ramp:  cztery progi temperatury strugi (0 = chłodny brzeg, 1 = rdzeń)
   ramps: (gradient) kilka takich ramp od dyszy do końca strugi; at: pozycje
   spark: głowa iskry; cool: mnożnik RGB, do którego iskra stygnie, albo
          sparkEnd: barwa, do której stygnie
   light: barwa światła dyszy
   ========================================================================== */
function hueRamp(r, g, b) {
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const fit = (c, L) => { const k = L / Math.max(lum(c), 1e-3); return c.map((v) => v * k); };
  const toWhite = (c, k) => c.map((v) => v + (1 - v) * k);
  const h = [r, g, b];
  return [fit(h, 0.1), fit(h, 0.75), fit(toWhite(h, 0.1), 1.9), fit(toWhite(h, 0.5), 3.8)];
}

export const MAIN_EXHAUST_PALETTES = Object.freeze([
  { id: 'rakieta', name: 'Rakieta',
    ramp: [[0.32, 0.025, 0.0], [1.7, 0.42, 0.04], [3.0, 1.65, 0.32], [4.3, 3.7, 2.7]],
    spark: [2.3, 1.75, 1.15], cool: [1, 0.32, 0.06], light: [1.0, 0.42, 0.15] },
  { id: 'plazma', name: 'Plazma',
    ramp: [[0.0, 0.06, 0.30], [0.10, 0.62, 2.0], [0.7, 2.1, 3.6], [3.2, 4.0, 4.6]],
    spark: [1.3, 2.1, 2.9], cool: [0.15, 0.45, 1], light: [0.15, 0.45, 1.0] },
  { id: 'ksenon', name: 'Ksenon',
    ramp: [[0.10, 0.02, 0.34], [0.55, 0.32, 2.2], [1.5, 1.35, 3.8], [3.6, 3.6, 4.6]],
    spark: [1.8, 1.6, 2.9], cool: [0.5, 0.25, 1], light: [0.3, 0.25, 1.0] },
  { id: 'bor', name: 'Bor',
    ramp: [[0.02, 0.14, 0.02], [0.2, 1.0, 0.07], [0.95, 2.15, 0.38], [3.2, 3.9, 2.4]],
    spark: [1.3, 2.1, 0.85], cool: [0.25, 1, 0.12], light: [0.24, 0.72, 0.14] },
  { id: 'antymateria', name: 'Antymateria',
    ramp: [[0.28, 0.0, 0.14], [1.9, 0.18, 0.9], [3.4, 1.1, 2.6], [4.4, 3.4, 4.3]],
    spark: [2.6, 1.4, 2.3], cool: [1, 0.12, 0.6], light: [1.0, 0.15, 0.62] },
  { id: 'wodor', name: 'Wodór',
    ramp: [[0.04, 0.05, 0.16], [0.45, 0.62, 1.5], [1.7, 2.2, 3.2], [3.9, 4.1, 4.5]],
    spark: [1.85, 2.0, 2.4], cool: [0.35, 0.55, 1], light: [0.45, 0.58, 1.0] },
  { id: 'ogien-lod', name: 'Ogień i lód', group: 'gradient',
    ramps: [hueRamp(0.15, 0.45, 1), hueRamp(0.6, 0.45, 1), hueRamp(1, 0.45, 0.05)], at: [0, 0.35, 1],
    spark: [1.3, 2.1, 2.9], sparkEnd: [2.2, 0.9, 0.15], light: [0.35, 0.5, 1.0] },
  { id: 'zorza', name: 'Zorza', group: 'gradient',
    ramps: [hueRamp(0.3, 1, 0.45), hueRamp(0.2, 0.8, 1), hueRamp(0.75, 0.3, 1)],
    spark: [1.3, 2.3, 1.5], sparkEnd: [1.2, 0.5, 2.0], light: [0.25, 0.85, 0.5] },
  { id: 'zachod', name: 'Zachód', group: 'gradient',
    ramps: [hueRamp(1, 0.7, 0.2), hueRamp(1, 0.28, 0.08), hueRamp(0.95, 0.2, 0.75)],
    spark: [2.4, 1.9, 1.0], sparkEnd: [1.9, 0.4, 1.2], light: [1.0, 0.55, 0.2] },
  { id: 'mglawica', name: 'Mgławica', group: 'gradient',
    ramps: [
      [[0.25, 0.0, 0.2], [1.7, 0.2, 1.3], [0.8, 2.2, 3.2], [3.4, 4.2, 4.6]],
      [[0.12, 0.0, 0.3], [0.95, 0.2, 2.4], [1.8, 1.35, 4.0], [3.8, 3.5, 4.7]]
    ],
    spark: [1.3, 2.2, 2.8], sparkEnd: [1.8, 0.3, 1.6], light: [0.6, 0.35, 1.0] },
  { id: 'neon', name: 'Neon', group: 'gradient',
    ramps: [hueRamp(1, 0.2, 0.7), hueRamp(0.6, 0.25, 1), hueRamp(0.2, 0.85, 1)],
    spark: [2.5, 1.4, 2.4], sparkEnd: [0.6, 1.8, 2.4], light: [1.0, 0.2, 0.7] },
  { id: 'tecza', name: 'Tęcza', group: 'gradient',
    ramps: [hueRamp(1, 0.85, 0.3), hueRamp(0.4, 1, 0.3), hueRamp(0.2, 0.85, 1),
      hueRamp(0.3, 0.4, 1), hueRamp(0.75, 0.3, 1), hueRamp(1, 0.25, 0.35)],
    spark: [2.3, 2.1, 1.3], sparkEnd: [1.6, 0.5, 1.4], light: [1.0, 0.8, 0.4] }
].map((pal) => Object.freeze(pal)));

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Rampy palety (jednolita = jedna rampa, gradient = kilka wzdłuż strugi). */
export function paletteRamps(pal) {
  return pal.ramps ?? [pal.ramp];
}

/**
 * Barwa palety w punkcie strugi — ta sama funkcja wypełnia atlas tekstury
 * w grze i rysuje podgląd w edytorze.
 * @param {object} pal paleta z MAIN_EXHAUST_PALETTES
 * @param {number} t   temperatura 0 (chłodny brzeg) .. 1 (rdzeń)
 * @param {number} g   0 przy dyszy .. 1 na końcu gradientu
 * @param {number[]} out [r, g, b]
 */
export function paletteColor(pal, t, g, out) {
  const R = paletteRamps(pal);
  const n = R.length;
  let j = 0;
  let u = 0;
  if (n > 1) {
    const at = pal.at;
    if (at) {
      while (j < n - 2 && g > at[j + 1]) j++;
      u = clamp01((g - at[j]) / Math.max(at[j + 1] - at[j], 1e-6));
    } else {
      const x = clamp01(g) * (n - 1);
      j = Math.min(n - 2, Math.floor(x));
      u = x - j;
    }
  }
  const A = R[j];
  const B = R[Math.min(j + 1, n - 1)];
  let sg;
  let v;
  if (t < 0.33) { sg = 0; v = t / 0.33; } else if (t < 0.66) { sg = 1; v = (t - 0.33) / 0.33; } else { sg = 2; v = (t - 0.66) / 0.34; }
  for (let c = 0; c < 3; c++) {
    const a = A[sg][c] + (A[sg + 1][c] - A[sg][c]) * v;
    const b = B[sg][c] + (B[sg + 1][c] - B[sg][c]) * v;
    out[c] = a + (b - a) * u;
  }
  return out;
}

/** Barwa, do której stygnie iskra palety — jako mnożnik RGB głowy. */
export function paletteSparkCool(pal) {
  if (pal.sparkEnd) return pal.spark.map((v, j) => pal.sparkEnd[j] / Math.max(v, 1e-3));
  return pal.cool ?? [1, 0.32, 0.06];
}

/* ============================================================================
   STROJENIE STRUGI MAIN — liczby z dema wydechu (EXHAUST_TUNE). Wymiary strug
   są w jednostkach dema, gdzie wylot dyszy ma promień DEMO_NOZZLE_RADIUS; gra
   skaluje je przez S = promień dyszy / DEMO_NOZZLE_RADIUS.
   ========================================================================== */
export const DEMO_NOZZLE_RADIUS = 6.4;

export const MAIN_EXHAUST_TUNE = Object.freeze({
  power: 0.95,      // p przy ciągu 100%
  boost: 1.5,       // dopalacz: ciąg co najmniej 150%
  jetRate: 60,      // strug rdzenia na sekundę (stała liczba — jasność nie zależy od Hz ekranu)
  jetAlpha: 0.6,
  tailRate: 22,     // długich strug ogona na sekundę
  tailAlpha: 0.22,
  sparkRate: 45,    // iskry na sekundę przy 100%
  inherit: 1.0,     // ile prędkości dyszy dziedziczą iskry
  gradLen: 72,      // jednostki dema od dyszy, na których gradient palety dochodzi do końca
  flowSpeed: 6.0,   // tempo płynięcia szumu strugi (faza całkowana na CPU)
  rough: 1.0,       // 0 = równy płomień, 1 = migotanie jak w demie
  flatten: 0.2      // spłaszczenie rozrzutu iskier w Z (w ortho z góry Z jest niewidoczne)
});

/**
 * Zasięg strugi MAIN w promieniach dyszy — do podglądu w edytorze i testów.
 * @param {number} power ciąg względny (1 = 100%)
 * @param {number} lengthMul mnożnik długości statku
 * @returns {{ core: number, tail: number, coreWidth: number }}
 */
export function mainExhaustExtentR(power, lengthMul = 1, widthMul = 1) {
  const p = Math.max(0, Number(power) || 0) * MAIN_EXHAUST_TUNE.power;
  const L = Math.max(0, Number(lengthMul) || 0);
  const W = Math.max(0, Number(widthMul) || 0);
  return {
    core: (18 + 55 * p) * L / DEMO_NOZZLE_RADIUS,
    tail: (40 + 75 * p) * L / DEMO_NOZZLE_RADIUS,
    coreWidth: (9 + 14 * p) * W / DEMO_NOZZLE_RADIUS
  };
}

/* ============================================================================
   PALETY WARP — 1:1 z dema plazmy (sRGB hex; THREE.Color robi z nich liniowe).
   Plan pasm HDR wspólny dla wszystkich palet: rdzeń 8–12, ciało 0,4–1,3,
   otoczka 0,2–0,7 (patrz notatki o pasmach HDR).
   ========================================================================== */
export const WARP_PLASMA_PALETTES = Object.freeze([
  { id: 'magenta', name: 'Magenta',
    core: [0xFFF0E0, 0xFFF4FF], body: [0xFFB5FF, 0xFF72ED, 0xF34BFF, 0xC936FF],
    outer: [0x7C58FF, 0x42A5FF], glow: [0xFFF0E2, 0xFF4FE4, 0x4F8CFF], part: [0xFFF2FF, 0xFF4DF2, 0x5A8CFF] },
  { id: 'ion_blue', name: 'Ion Blue',
    core: [0xEAF6FF, 0xFFFFFF], body: [0xBFF0FF, 0x6ED8FF, 0x35B4FF, 0x1E7BFF],
    outer: [0x2A46FF, 0x7E3BFF], glow: [0xEAF7FF, 0x4FB8FF, 0x4258FF], part: [0xFFFFFF, 0x6FD4FF, 0x4060FF] },
  { id: 'fusion_gold', name: 'Fusion Gold',
    core: [0xFFF3D6, 0xFFFFFF], body: [0xFFE3A8, 0xFFB347, 0xFF7A18, 0xE03A0A],
    outer: [0xC81E00, 0xFF7A20], glow: [0xFFF0D0, 0xFF8A2A, 0xFF4A18], part: [0xFFF8E0, 0xFFA030, 0xFF4010] },
  { id: 'antimatter', name: 'Antimatter',
    core: [0xEAFFEE, 0xFFFFFF], body: [0xAFFFA8, 0x44E85A, 0x0FBF3C, 0x079060],
    outer: [0x0A7A78, 0x17BCD8], glow: [0xE8FFEA, 0x2ED45E, 0x11A090], part: [0xEAFFEE, 0x3CE070, 0x14A894] },
  { id: 'crimson', name: 'Crimson',
    core: [0xFFEDE8, 0xFFF0F4], body: [0xFFC2C8, 0xFF5D6E, 0xFF1F3D, 0xC2103F],
    outer: [0x8E0A28, 0xFF3355], glow: [0xFFEAE6, 0xFF3A5C, 0xC01F40], part: [0xFFF0F0, 0xFF4060, 0xC02040] },
  { id: 'arctic', name: 'Arctic',
    core: [0xFFFFFF, 0xFFFFFF], body: [0xFFFFFF, 0xDCEBFF, 0xA8C8FF, 0x6E9AE6],
    outer: [0x4C74C8, 0x8FD4FF], glow: [0xFFFFFF, 0xBFD8FF, 0x8FB8FF], part: [0xFFFFFF, 0xD0E4FF, 0x8FB0E0] }
].map((pal) => Object.freeze(pal)));

/** Długość „ciała” plazmy przy pełnej mocy, w promieniach dyszy (BASE_LEN dema). */
export const WARP_PLUME_BASE_LEN = 10.0;
/** Dopalacz plazmy (aktywny skok) wydłuża strumień o tyle × boostAmount. */
export const WARP_PLUME_BOOST_LEN = 0.55;

/* ============================================================================
   ROZMIARY PER STATEK — dopasowane do sprite'ów (2026-09-25): średnica wylotu
   dyszy zmierzona na PNG kadłuba w miejscu markerów MAIN. Atlas nie ma
   narysowanych dysz — struga wychodzi spod rufowych bloków (~140 px).
   Klucze = id statków edytora (SHIP_DEFS w hardpointEditor.js).
   ========================================================================== */
export const ENGINE_FX_FIELDS = Object.freeze(['mainNozzle', 'mainLength', 'mainWidth', 'mainPalette', 'warpLength', 'warpPalette']);

export const ENGINE_FX_LIMITS = Object.freeze({
  mainNozzle: Object.freeze([2, 800]),
  mainLength: Object.freeze([0.1, 5]),
  mainWidth: Object.freeze([0.1, 5]),
  warpLength: Object.freeze([0.1, 5])
});

const TERRAN = Object.freeze({ mainPalette: 'wodor', warpPalette: 'magenta' });
const PIRATE = Object.freeze({ mainPalette: 'rakieta', warpPalette: 'crimson' });

export const ENGINE_FX_DEFAULTS = Object.freeze({
  atlas: Object.freeze({ mainNozzle: 140, mainLength: 1.0, mainWidth: 1.0, mainPalette: 'plazma', warpLength: 1.4, warpPalette: 'magenta' }),
  terran_carrier: Object.freeze({ mainNozzle: 66, mainLength: 1.0, mainWidth: 1.0, warpLength: 1.4, ...TERRAN }),
  terran_supercapital: Object.freeze({ mainNozzle: 58, mainLength: 1.0, mainWidth: 1.0, warpLength: 1.4, ...TERRAN }),
  capital_carrier: Object.freeze({ mainNozzle: 90, mainLength: 1.0, mainWidth: 1.0, warpLength: 1.4, ...TERRAN }),
  battleship: Object.freeze({ mainNozzle: 58, mainLength: 1.0, mainWidth: 1.0, warpLength: 1.4, ...TERRAN }),
  destroyer: Object.freeze({ mainNozzle: 32, mainLength: 1.0, mainWidth: 1.0, warpLength: 1.4, ...TERRAN }),
  frigate: Object.freeze({ mainNozzle: 110, mainLength: 1.0, mainWidth: 1.0, warpLength: 1.4, ...TERRAN }),
  pirate_battleship: Object.freeze({ mainNozzle: 105, mainLength: 1.0, mainWidth: 1.0, warpLength: 1.4, ...PIRATE }),
  pirate_destroyer: Object.freeze({ mainNozzle: 115, mainLength: 1.0, mainWidth: 1.0, warpLength: 1.4, ...PIRATE }),
  pirate_frigate: Object.freeze({ mainNozzle: 120, mainLength: 1.0, mainWidth: 1.0, warpLength: 1.4, ...PIRATE })
});

// Kadłub bez wpisu (frachtowce, legacy): dysza liczona od długości renderu.
export const ENGINE_FX_FALLBACK = Object.freeze({
  mainLength: 1.0, mainWidth: 1.0, mainPalette: 'wodor', warpLength: 1.4, warpPalette: 'magenta',
  // promień dyszy = ułamek długości kadłuba w świecie (Atlas: 1800 j. → ~34 j.)
  nozzleRadiusPerHullLength: 0.0188
});

// Aliasy kluczy: gra woła kadłuby po id profilu renderu albo po aliasie
// edytora z index.html (`toEditorHullAlias` obcina „terran_”).
const SHIP_KEY_ALIASES = Object.freeze({
  player: 'atlas',
  carrier: 'terran_carrier',
  supercapital: 'terran_supercapital',
  terran_battleship: 'battleship',
  terran_destroyer: 'destroyer',
  terran_frigate: 'frigate'
});

/** Id statku edytora dla dowolnego klucza kadłuba (albo '' gdy brak). */
export function normalizeEngineFxShipKey(key) {
  const raw = String(key || '').trim().toLowerCase();
  if (!raw) return '';
  return SHIP_KEY_ALIASES[raw] || raw;
}

function clampNum(value, [min, max]) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

export function mainExhaustPaletteIndex(id) {
  const k = MAIN_EXHAUST_PALETTES.findIndex((pal) => pal.id === id);
  return k < 0 ? -1 : k;
}

export function warpPlasmaPaletteIndex(id) {
  const k = WARP_PLASMA_PALETTES.findIndex((pal) => pal.id === id);
  return k < 0 ? -1 : k;
}

/**
 * Czyści zapisany blok `engineFx`: zostają tylko znane, poprawne pola.
 * Zwraca null, gdy nic się nie ostało (brak bloku w eksporcie).
 */
export function sanitizeEngineFx(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const key of ['mainNozzle', 'mainLength', 'mainWidth', 'warpLength']) {
    const v = clampNum(raw[key], ENGINE_FX_LIMITS[key]);
    if (v !== null) out[key] = round2(v);
  }
  if (mainExhaustPaletteIndex(raw.mainPalette) >= 0) out.mainPalette = raw.mainPalette;
  if (warpPlasmaPaletteIndex(raw.warpPalette) >= 0) out.warpPalette = raw.warpPalette;
  return Object.keys(out).length ? out : null;
}

/** Domyślny blok dla statku (kopia) albo null, gdy kadłub nie ma wpisu. */
export function getEngineFxDefaults(shipKey) {
  const def = ENGINE_FX_DEFAULTS[normalizeEngineFxShipKey(shipKey)];
  return def ? { ...def } : null;
}

/**
 * Pełna konfiguracja silników statku: domyślne ⊕ zapisane (pole po polu).
 * Dla kadłuba bez wpisu `mainNozzle` zostaje null — gra liczy wtedy dyszę
 * od długości kadłuba (ENGINE_FX_FALLBACK).
 */
export function resolveEngineFx(shipKey, stored = null) {
  const base = getEngineFxDefaults(shipKey) || {
    mainNozzle: null,
    mainLength: ENGINE_FX_FALLBACK.mainLength,
    mainWidth: ENGINE_FX_FALLBACK.mainWidth,
    mainPalette: ENGINE_FX_FALLBACK.mainPalette,
    warpLength: ENGINE_FX_FALLBACK.warpLength,
    warpPalette: ENGINE_FX_FALLBACK.warpPalette
  };
  const clean = sanitizeEngineFx(stored);
  return clean ? { ...base, ...clean } : base;
}

/**
 * Konfiguracja gotowa dla renderu: promień dyszy w jednostkach lokalnych
 * kadłuba (przed spriteScale) i indeksy palet. Liczone raz przy układaniu
 * statku (runtime NPC / układ gracza), nie co klatkę.
 * @param {string} shipKey  id statku edytora (albo alias)
 * @param {object|null} stored zapisany blok engineFx
 * @param {number} hpScale  skala edytor → lokalne kadłuba (render / PNG)
 */
export function buildEntityEngineFx(shipKey, stored = null, hpScale = 1) {
  const cfg = resolveEngineFx(shipKey, stored);
  const scale = Number.isFinite(Number(hpScale)) && Number(hpScale) > 0 ? Number(hpScale) : 1;
  const mainPal = mainExhaustPaletteIndex(cfg.mainPalette);
  const warpPal = warpPlasmaPaletteIndex(cfg.warpPalette);
  return {
    shipKey: normalizeEngineFxShipKey(shipKey),
    nozzleRadius: Number.isFinite(cfg.mainNozzle) ? cfg.mainNozzle * 0.5 * scale : null,
    mainLength: cfg.mainLength,
    mainWidth: cfg.mainWidth,
    mainPalette: cfg.mainPalette,
    mainPaletteIndex: mainPal < 0 ? 0 : mainPal,
    warpLength: cfg.warpLength,
    warpPalette: cfg.warpPalette,
    warpPaletteIndex: warpPal < 0 ? 0 : warpPal
  };
}

/**
 * Promień dyszy kadłuba bez wpisu w edytorze, w jednostkach świata
 * (długość renderu kadłuba = profil × HULL_RENDER_WORLD_SCALE).
 */
export function fallbackNozzleRadius(hullRenderLength) {
  const len = Math.max(1, Number(hullRenderLength) || 0);
  return len * ENGINE_FX_FALLBACK.nozzleRadiusPerHullLength;
}
