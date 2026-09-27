// dema/rakiety-webgpu/palette.js
//
// Profile WIZUALNE rakiet dema (nie gameplay — parametry lotu idą z
// src/data/weapons.js). Barwy liniowe; jasności według planu pasm HDR gry
// (próg bloomu 0,9 bramkuje pełną wartością, ACES odbarwia > ~1,5):
//   • nad progiem tylko cienkie rdzenie dysz, błyski, iskry, łuki (8–30),
//   • ciała efektów i oświetlony dym 0,4–0,85 (bez bloomu, barwa zostaje),
//   • otoczki 0,2–0,6.
// Jednostki: j. świata gry (zoom 1 = 1 px), sekundy.

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** '#rrggbb' → [r, g, b] liniowe (× mnożnik). */
export function lin(hex, k = 1) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return [
    srgbToLinear(((v >> 16) & 255) / 255) * k,
    srgbToLinear(((v >> 8) & 255) / 255) * k,
    srgbToLinear((v & 255) / 255) * k
  ];
}

// Palety dymu (indeks w tablicy materiału dymu, smoke.js). Każda: albedo,
// opór ruchu własnego [1/s], barwy żaru (gorący → chłodny) i czas stygnięcia,
// turbulencja [j./s], wykładnik zaniku gęstości. Emisja w paśmie ciała —
// świeci tylko świeży gaz przy dyszy.
export const SMOKE_KIND = Object.freeze({ EXHAUST: 0, FAST: 1, CHEM: 2, SOOT: 3, VAPOR: 4, DEBRIS: 5 });

export const SMOKE_PALETTES = [
  // 0 — spaliny rakiety manewrującej: jasnoszary dym, pomarańczowy żar.
  { albedo: lin('#c9c7c4', 0.95), drag: 2.6, hot: [3.2, 1.9, 0.9], warm: [1.1, 0.34, 0.08], tempTau: 0.11, turb: 58, turbScale: 230, fadeTau: 2.4, stretch: 1.3 },
  // 1 — szybka rakieta: jaśniejszy, rzadszy dym, żółtawy żar, szybciej znika.
  { albedo: lin('#d8d8d6', 0.95), drag: 3.2, hot: [3.4, 2.5, 1.3], warm: [1.2, 0.5, 0.12], tempTau: 0.08, turb: 46, turbScale: 180, fadeTau: 2.0, stretch: 1.5 },
  // 2 — „chemiczny” dym supernowej: róż → fiolet → magenta, sam lekko świeci.
  { albedo: lin('#c98ab8', 0.85), drag: 2.2, hot: [1.2, 0.35, 1.35], warm: [0.42, 0.06, 0.38], tempTau: 0.08, turb: 64, turbScale: 260, fadeTau: 3.2, stretch: 1.2 },
  // 3 — sadza wybuchu: ciemny, brązowawy, ciężki kłąb.
  { albedo: lin('#5a5048', 0.9), drag: 1.7, hot: [3.0, 1.4, 0.45], warm: [0.9, 0.22, 0.05], tempTau: 0.16, turb: 70, turbScale: 300, fadeTau: 3.8, stretch: 0 },
  // 4 — zimny gaz wyrzutu (VLS): biała para, szybko rzednie.
  { albedo: lin('#e4ecf2', 0.95), drag: 4.0, hot: [0, 0, 0], warm: [0, 0, 0], tempTau: 0.1, turb: 36, turbScale: 140, fadeTau: 0.9, stretch: 0.2 },
  // 5 — dym płonących odłamków: szary z ciepłym żarem, cienki.
  { albedo: lin('#8a827a', 0.9), drag: 1.2, hot: [3.0, 1.5, 0.5], warm: [1.0, 0.28, 0.06], tempTau: 0.1, turb: 50, turbScale: 200, fadeTau: 1.8, stretch: 0.5 }
];

/**
 * Profile rakiet. `weaponId` wskazuje wpis w src/data/weapons.js (lot, zasięg,
 * bodyScale itp.). Wymiary efektów w j. świata; skala ciała rakiety mnoży plumę.
 */
export const MISSILE_VFX = Object.freeze({
  cruise: Object.freeze({
    weaponId: 'missile_rack',
    label: 'Rakieta manewrująca',
    body: { hull: lin('#c8ccd2'), band: lin('#3d7dff'), glow: [2.2, 1.2, 0.5] },
    plume: { kind: 0, len: 5.2, width: 0.95, core: [9, 7.6, 5.2], hot: lin('#ffd9a3', 1.0), mid: lin('#ff8a2e', 0.9), tail: lin('#b8380e', 0.55) },
    light: { color: [1.0, 0.56, 0.24], intensity: 0.9, range: 460 },
    trail: { kind: SMOKE_KIND.EXHAUST, spacing: 4.0, size0: 3.4, growth: 38, lives: [0.32, 2.2, 6.5], opacity: 0.34, temp: 1.0, exhaust: 1.04 },
    blast: { style: 'standard', radius: 125, sparks: 150, fragments: 7, smoke: 30, flash: 1.0, shock: 1.0 }
  }),
  fast: Object.freeze({
    weaponId: 'fast_missile_rack',
    label: 'Szybka rakieta',
    body: { hull: lin('#d6d9dd'), band: lin('#ffb53a'), glow: [2.4, 1.6, 0.7] },
    plume: { kind: 1, len: 5.8, width: 0.8, core: [9.5, 8.6, 6.2], hot: lin('#fff0c0', 1.0), mid: lin('#ffb347', 0.85), tail: lin('#d0561a', 0.5) },
    light: { color: [1.0, 0.72, 0.36], intensity: 0.7, range: 360 },
    trail: { kind: SMOKE_KIND.FAST, spacing: 4.5, size0: 2.4, growth: 28, lives: [0.24, 1.5, 4.0], opacity: 0.3, temp: 1.0, exhaust: 1.03 },
    blast: { style: 'standard', radius: 90, sparks: 100, fragments: 5, smoke: 20, flash: 0.75, shock: 0.75 }
  }),
  supernova: Object.freeze({
    weaponId: 'supernova_missile',
    label: 'Supernowa (special)',
    body: { hull: lin('#e6b8da'), band: lin('#ff4fd8'), glow: [3.2, 1.0, 3.4] },
    // Napęd plazmowy: biały rdzeń → magenta → fiolet (paleta WARP „Magenta”).
    plume: { kind: 2, len: 7.5, width: 0.7, core: [10, 8.2, 11], hot: lin('#ffb3f2', 1.0), mid: lin('#e03cff', 0.9), tail: lin('#5a2cff', 0.55) },
    light: { color: [1.0, 0.3, 0.95], intensity: 0.6, range: 560 },
    trail: { kind: SMOKE_KIND.CHEM, spacing: 5.5, size0: 4.2, growth: 40, lives: [0.36, 2.6, 7.0], opacity: 0.36, temp: 1.0, exhaust: 1.03 },
    blast: { style: 'supernova', radius: 420, sparks: 1400, fragments: 0, smoke: 0, flash: 3.0, shock: 3.0 }
  })
});

// Mgławica po supernowej: składniki barwne jak w pozostałościach supernowych
// (Hα — róż/czerwień, [O III] — turkus, [S II] — głęboka czerwień), gorące
// wnętrze błękitno-białe. Pasmo ciała 0,4–1,2 (barwy mają przetrwać ACES).
export const NEBULA_COLORS = Object.freeze({
  halpha: lin('#ff2f6a', 1.0),
  oiii: lin('#2ef2d0', 0.9),
  sii: lin('#c01848', 1.0),
  hot: lin('#b8d6ff', 1.2)
});

// Iskry (wygląd SparkSystem3D gry: biel → barwa → stygnięcie, migotanie).
export const SPARK_COLORS = Object.freeze({
  warm: lin('#ff6a1a'),
  gold: lin('#ffb347'),
  nova: lin('#ff5ae6'),
  ion: lin('#7fe8ff')
});
