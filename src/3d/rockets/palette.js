// src/3d/rockets/palette.js
//
// Profile WIZUALNE rakiet (port WebGPU, zadanie 19 — z dema dema/rakiety-webgpu/palette.js,
// stan 174b271 + f06b2c6). Nie gameplay: lot, zasięg, obrażenia i bodyScale idą z
// src/data/weapons.js (rocketSystem3D.js). Barwy liniowe; jasności według planu pasm HDR gry
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

// Palety dymu (indeks w tablicy materiału dymu, smoke.js). Każda: albedo, opór ruchu
// własnego [1/s], barwy żaru (gorący → chłodny) i czas stygnięcia, turbulencja [j./s],
// skala pola wirowego, czas zaniku gęstości, wydłużenie świeżego kłębu. Emisja w paśmie
// ciała — świeci tylko świeży gaz przy dyszy.
export const SMOKE_KIND = Object.freeze({ EXHAUST: 0, FAST: 1, CHEM: 2, SOOT: 3, VAPOR: 4, DEBRIS: 5, MICRO: 6 });

export const SMOKE_PALETTES = Object.freeze([
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
  { albedo: lin('#8a827a', 0.9), drag: 1.2, hot: [3.0, 1.5, 0.5], warm: [1.0, 0.28, 0.06], tempTau: 0.1, turb: 50, turbScale: 200, fadeTau: 1.8, stretch: 0.5 },
  // 6 — mikrorakiety (Grad, Rój, głowice Hydry): cienka, jasna nitka spalin, szybko rzednie —
  // salwa zostawia gęstą siatkę krętych smug, która nie zamienia się w jedną chmurę.
  { albedo: lin('#e0dfdb', 0.95), drag: 3.8, hot: [3.4, 2.3, 1.1], warm: [1.1, 0.42, 0.1], tempTau: 0.06, turb: 42, turbScale: 150, fadeTau: 1.1, stretch: 1.7 }
].map((p) => Object.freeze(p)));

/** Opór ruchu własnego palet (CPU: przesunięcie porcji o wiek początkowy). */
export const SMOKE_DRAG = Object.freeze(SMOKE_PALETTES.map((p) => p.drag));

const scaled = (arr, k) => Object.freeze(arr.map((v) => v * k));

/**
 * Profile rakiet gry (klucz z `rocketVfxKey`). Wymiary efektów w j. świata; skala ciała
 * rakiety (weaponDef.bodyScale) mnoży płomień i smugę. Barwa pasa na kadłubku = strona
 * (sojusznik / wróg — jak dawny kolor kadłubka rakiety w grze), poza Supernową.
 */
export const MISSILE_VFX = Object.freeze({
  cruise: Object.freeze({
    label: 'Rakieta manewrująca',
    body: Object.freeze({ hull: Object.freeze(lin('#c8ccd2')), band: Object.freeze(lin('#3d7dff')) }),
    plume: Object.freeze({ kind: 0, len: 5.2, width: 0.95, core: Object.freeze([9, 7.6, 5.2]), hot: Object.freeze(lin('#ffd9a3', 1.0)), mid: Object.freeze(lin('#ff8a2e', 0.9)) }),
    light: Object.freeze({ color: Object.freeze([1.0, 0.56, 0.24]), intensity: 0.9, range: 460 }),
    trail: Object.freeze({ kind: SMOKE_KIND.EXHAUST, spacing: 4.0, size0: 3.4, growth: 38, lives: Object.freeze([0.32, 2.2, 6.5]), opacity: 0.34, temp: 1.0, exhaust: 1.04 }),
    blast: Object.freeze({ radius: 125, sparks: 150, fragments: 7, smoke: 30, flash: 1.0, shock: 1.0 })
  }),
  fast: Object.freeze({
    label: 'Szybka rakieta',
    body: Object.freeze({ hull: Object.freeze(lin('#d6d9dd')), band: Object.freeze(lin('#ffb53a')) }),
    plume: Object.freeze({ kind: 1, len: 5.8, width: 0.8, core: Object.freeze([9.5, 8.6, 6.2]), hot: Object.freeze(lin('#fff0c0', 1.0)), mid: Object.freeze(lin('#ffb347', 0.85)) }),
    light: Object.freeze({ color: Object.freeze([1.0, 0.72, 0.36]), intensity: 0.7, range: 360 }),
    trail: Object.freeze({ kind: SMOKE_KIND.FAST, spacing: 4.5, size0: 2.4, growth: 28, lives: Object.freeze([0.24, 1.5, 4.0]), opacity: 0.3, temp: 1.0, exhaust: 1.03 }),
    blast: Object.freeze({ radius: 90, sparks: 100, fragments: 5, smoke: 20, flash: 0.75, shock: 0.75 })
  }),
  supernova: Object.freeze({
    label: 'Supernowa (special)',
    body: Object.freeze({ hull: Object.freeze(lin('#e6b8da')), band: Object.freeze(lin('#ff4fd8')) }),
    // Napęd plazmowy: biały rdzeń → magenta → fiolet (paleta WARP „Magenta”).
    plume: Object.freeze({ kind: 2, len: 7.5, width: 0.7, core: Object.freeze([10, 8.2, 11]), hot: Object.freeze(lin('#ffb3f2', 1.0)), mid: Object.freeze(lin('#e03cff', 0.9)) }),
    light: Object.freeze({ color: Object.freeze([1.0, 0.3, 0.95]), intensity: 0.6, range: 560 }),
    trail: Object.freeze({ kind: SMOKE_KIND.CHEM, spacing: 5.5, size0: 4.2, growth: 40, lives: Object.freeze([0.36, 2.6, 7.0]), opacity: 0.36, temp: 1.0, exhaust: 1.03 }),
    blast: Object.freeze({ radius: 420, sparks: 1400, fragments: 0, smoke: 0, flash: 3.0, shock: 3.0 })
  }),
  // Mikrorakiety salw (Grad, Rój) i głowice potomne Hydry: mały jasny płomień, cienka smuga,
  // mały wybuch — liczy się grad trafień, nie pojedynczy błysk.
  micro: Object.freeze({
    label: 'Mikrorakieta',
    body: Object.freeze({ hull: Object.freeze(lin('#cfd3d8')), band: Object.freeze(lin('#3d7dff')) }),
    plume: Object.freeze({ kind: 1, len: 6.4, width: 0.95, core: Object.freeze([9.5, 8.4, 6.4]), hot: Object.freeze(lin('#fff1c8', 1.0)), mid: Object.freeze(lin('#ffa94a', 0.85)) }),
    light: Object.freeze({ color: Object.freeze([1.0, 0.7, 0.38]), intensity: 0.32, range: 200 }),
    trail: Object.freeze({ kind: SMOKE_KIND.MICRO, spacing: 5.5, size0: 2.8, growth: 19, lives: Object.freeze([0.3, 1.05, 2.5]), opacity: 0.32, temp: 0.95, exhaust: 1.02 }),
    blast: Object.freeze({ radius: 62, sparks: 34, fragments: 1, smoke: 7, flash: 0.42, shock: 0.32 })
  }),
  // Nosiciel głowicy kasetowej (Hydra): ciężki kadłubek, pomarańczowo-biały płomień, gęsta smuga.
  hydra: Object.freeze({
    label: 'Rakieta kasetowa',
    body: Object.freeze({ hull: Object.freeze(lin('#b9bec6')), band: Object.freeze(lin('#ff9a3c')) }),
    plume: Object.freeze({ kind: 0, len: 5.0, width: 1.0, core: Object.freeze([9, 7.2, 4.8]), hot: Object.freeze(lin('#ffd49a', 1.0)), mid: Object.freeze(lin('#ff7a24', 0.9)) }),
    light: Object.freeze({ color: Object.freeze([1.0, 0.52, 0.2]), intensity: 0.85, range: 440 }),
    trail: Object.freeze({ kind: SMOKE_KIND.EXHAUST, spacing: 4.2, size0: 3.2, growth: 36, lives: Object.freeze([0.3, 2.0, 6.0]), opacity: 0.34, temp: 1.0, exhaust: 1.04 }),
    blast: Object.freeze({ radius: 110, sparks: 120, fragments: 5, smoke: 24, flash: 0.9, shock: 0.9 })
  })
});

/** Kolejność rodzajów w tablicach per rakieta (effects.js). */
export const VFX_KEYS = Object.freeze(['cruise', 'fast', 'supernova', 'micro', 'hydra']);
export const VFX_CRUISE = 0;
export const VFX_FAST = 1;
export const VFX_NOVA = 2;
export const VFX_MICRO = 3;
export const VFX_HYDRA = 4;

// Barwy pasa kadłubka według strony (colorTheme gry): sojusznik — niebieski dema, wróg —
// czerwień (dawny kadłubek rakiety wroga był czerwony). Supernowa zostaje różowa.
export const BAND_FRIENDLY = Object.freeze(lin('#3d7dff'));
export const BAND_HOSTILE = Object.freeze(lin('#ff3a2e'));

/**
 * Rodzaj efektów rakiety z definicji broni gry: jawnie z `rocketVfx` (cruise | fast | supernova |
 * micro | hydra), a bez niego jak dawniej — Supernowa (rocketExplosionVfx 'supernova'), szybka
 * (fast_missile_rack / mały kadłubek) albo manewrująca.
 */
export function rocketVfxIndex(def) {
  const id = String(def?.id || '');
  if (id === 'supernova_missile' || String(def?.rocketExplosionVfx || '').toLowerCase() === 'supernova') return VFX_NOVA;
  const key = String(def?.rocketVfx || '').toLowerCase();
  if (key) {
    const k = VFX_KEYS.indexOf(key);
    if (k >= 0) return k;
  }
  if (id === 'fast_missile_rack' || (Number(def?.bodyScale) || 1) < 0.8) return VFX_FAST;
  return VFX_CRUISE;
}

// Stałe pochodne (bez alokacji w recepturach): rdzeń i gorąca barwa błysku zapłonu.
export const IGNITE_CORE = Object.freeze(VFX_KEYS.map((k) => scaled(MISSILE_VFX[k].plume.core, 0.7)));
export const IGNITE_HALO = Object.freeze(VFX_KEYS.map((k) => scaled(MISSILE_VFX[k].plume.hot, 0.25)));

// Mgławica po supernowej: składniki barwne jak w pozostałościach supernowych
// (Hα — róż/czerwień, [O III] — turkus, [S II] — głęboka czerwień), gorące
// wnętrze błękitno-białe. Pasmo ciała 0,4–1,2 (barwy mają przetrwać ACES).
export const NEBULA_COLORS = Object.freeze({
  halpha: Object.freeze(lin('#ff2f6a', 1.0)),
  oiii: Object.freeze(lin('#2ef2d0', 0.9)),
  sii: Object.freeze(lin('#c01848', 1.0)),
  hot: Object.freeze(lin('#b8d6ff', 1.2)),
  // Dżety pulsara (wiatr relatywistyczny): biało-błękitne, stygną w turkus [O III].
  jet: Object.freeze(lin('#a9c4ff', 1.15))
});

// Snopy światła pulsara (reżyser, duszki smug z jądra) — barwa HDR rdzenia snopu.
export const PULSAR_BEAM = Object.freeze([1.1, 1.5, 2.6]);

// Iskry (wygląd dawnego SparkSystem3D gry: biel → barwa → stygnięcie, migotanie).
export const SPARK_COLORS = Object.freeze({
  warm: Object.freeze(lin('#ff6a1a')),
  gold: Object.freeze(lin('#ffb347')),
  nova: Object.freeze(lin('#ff5ae6')),
  ion: Object.freeze(lin('#7fe8ff')),
  // Barwa dawnej globalnej iskry gry (DEFAULT_COLOR 0xff4d00) — domyślna iskra API.
  game: Object.freeze([1.0, 0.07421, 0.0])
});
