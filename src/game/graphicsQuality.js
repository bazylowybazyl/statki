// ============================================================
// Opcje grafiki: preset jakości (Niska / Średnia / Wysoka / Ultra) i pojedyncze ustawienia, które
// preset ustawia (2026-10-15, prośba użytkownika: „prawdziwe ustawienia grafiki low/med/high, może ultra”).
// Moduł czysty (bez DOM, three i window): tabele, normalizacja, zapis, dopasowanie presetu. Stosowanie
// na żywo — blok „OPCJE GRAFIKI” w index.html (applyGraphicsSettings), MSAA i skala renderu przy starcie
// — Core3D.configureQuality (pierwszy moduł index.html, przed Core3D.init).
//
// Zapis: localStorage 'sc_gfx' (JSON wszystkich ustawień + preset). Pięć dawnych opcji ma też swoje klucze
// (sc_planet_quality, sc_shadow_shafts, sc_hull_lacquer, sc_hull_light, sc_space_dust) — piszemy je dalej
// (ring czyta sc_planet_quality przy budowie, reset zapisu zna te klucze), a przy braku 'sc_gfx' z nich
// bierzemy wybór gracza sprzed presetów.
// ============================================================

export const GFX_STORAGE_KEY = 'sc_gfx';
export const GFX_PRESET_IDS = Object.freeze(['low', 'medium', 'high', 'ultra']);
export const GFX_LEVELS = Object.freeze(['low', 'medium', 'high', 'ultra']);

// Ustawienia: dozwolone wartości (pierwsza pozycja listy nie ma znaczenia — domyślna w `def`), dawny klucz
// zapisu, `preset: false` — preferencja poza presetami (pył kosmiczny: ~2 rysunki, to „wrażenie lotu”, nie koszt),
// `restart: true` — działa od następnego uruchomienia gry.
export const GFX_SETTINGS = Object.freeze({
  // Skala rozdzielczości renderu 3D względem kanwy gry (px CSS): < 1 — render mniejszy i rozciągnięty,
  // > 1 — nadpróbkowanie (wygładza też to, czego nie łapie MSAA: okna ringu, odblaski, cienkie linie).
  renderScale: { values: [0.5, 0.67, 0.85, 1, 1.25, 1.5], def: 1 },
  // Próbki MSAA celu sceny (WebGPU: 1 albo 4). Zmiana = nowy klucz każdego pipeline'u — tylko przy starcie.
  msaa: { values: [0, 4], def: 4, restart: true },
  // Poświata: wyłączona / liczona w połowie rozdzielczości / pełna.
  bloom: { values: ['off', 'half', 'full'], def: 'full' },
  // Gorące powietrze za dyszami, nad wybuchami i tarczami (zniekształcenia w „uber”).
  heatHaze: { values: ['on', 'off'], def: 'on' },
  shadowShafts: { values: ['off', 'low', 'medium', 'high'], def: 'high', legacyKey: 'sc_shadow_shafts' },
  planetQuality: { values: ['low', 'medium', 'high', 'ultra'], def: 'high', legacyKey: 'sc_planet_quality' },
  // Gaz 3D wybuchów, wystrzałów i zapłonów (GFX_EXPLOSIONS).
  explosions: { values: GFX_LEVELS, def: 'high' },
  // Budżety efektów: światła dysz SIDE, pełne wyloty i trafienia broni, reflektory w pasie asteroid,
  // drobiny ośrodka warpa (GFX_EFFECTS).
  effects: { values: GFX_LEVELS, def: 'high' },
  // Pył i para w halach K-7 (pole gazu 2D na GPU).
  hallDust: { values: ['on', 'off'], def: 'on' },
  // Gaz w otwartej przestrzeni (pas asteroid: pole gazu z transportem na GPU — src/3d/spaceGas/).
  spaceGas: { values: ['on', 'off'], def: 'on' },
  lacquer: { values: ['on', 'off'], def: 'on', legacyKey: 'sc_hull_lacquer' },
  hullLight: { values: ['pbr', 'classic'], def: 'pbr', legacyKey: 'sc_hull_light' },
  spaceDust: { values: ['on', 'off'], def: 'on', legacyKey: 'sc_space_dust', preset: false },
  // Rozdzielczość dynamiczna (src/game/dynamicResolution.js): docelowe FPS — gdy czas GPU klatki przekracza
  // budżet, skala renderu schodzi stopniami poniżej renderScale; 'off' — stała skala. Preferencja poza presetami.
  dynamicRes: { values: ['off', '60', '120'], def: 'off', preset: false },
  // VSync: 'on' — klatki w takcie odświeżania ekranu, 'off' — bez limitu klatek. Tylko gra w Electronie (flagi
  // Chromium przy starcie procesu — electron/main.js, plik Dokumenty\HULLFALL\uruchomienie.json przez preload;
  // tam też źródło wyboru); w przeglądarce VSync ustawia przeglądarka. Preferencja poza presetami.
  vsync: { values: ['on', 'off'], def: 'on', preset: false, restart: true }
});

/**
 * Ustawienia z `restart: true`, których wybór różni się od działającego w tym uruchomieniu — do informacji
 * „zmieni się po ponownym uruchomieniu”. `running`: { msaa — próbki celu sceny tej strony, vsync — VSync tego
 * uruchomienia (true / false; inna wartość — nieznany, np. przeglądarka: pomijany) }.
 */
export function gfxRestartPending(settings, running) {
  const s = normalizeGfx(settings);
  const out = [];
  if (!running) return out;
  if (Number.isFinite(Number(running.msaa)) && (s.msaa > 0) !== (Number(running.msaa) > 0)) out.push('msaa');
  if (typeof running.vsync === 'boolean' && (s.vsync !== 'off') !== running.vsync) out.push('vsync');
  return out;
}

// Docelowe FPS rozdzielczości dynamicznej (0 = wyłączona).
export function gfxDynamicTargetFps(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Dobór presetu przy pierwszym uruchomieniu (src/game/graphicsAutoPreset.js): co wybrano i dlaczego — informacja
// w opcjach („dobrane automatycznie”), dopóki gracz czegoś nie zmieni.
export const GFX_AUTO_KEY = 'sc_gfx_auto';

export const GFX_KEYS = Object.freeze(Object.keys(GFX_SETTINGS));
export const GFX_PRESET_KEYS = Object.freeze(GFX_KEYS.filter((k) => GFX_SETTINGS[k].preset !== false));

// Presety. Wysoka = pełna jakość przy natywnej rozdzielczości (domyślna); Ultra — nadpróbkowanie 1,25,
// ring z mapami 16K, większe budżety gazu i efektów; Średnia i Niska — oszczędności od najdroższych
// na GPU (rozdzielczość, MSAA, bloom, smugi, gaz).
export const GFX_PRESETS = Object.freeze({
  low: Object.freeze({
    renderScale: 0.67, msaa: 0, bloom: 'half', heatHaze: 'off', shadowShafts: 'off', planetQuality: 'low',
    explosions: 'low', effects: 'low', hallDust: 'off', spaceGas: 'off', lacquer: 'off', hullLight: 'classic'
  }),
  medium: Object.freeze({
    renderScale: 0.85, msaa: 4, bloom: 'full', heatHaze: 'on', shadowShafts: 'low', planetQuality: 'medium',
    explosions: 'medium', effects: 'medium', hallDust: 'on', spaceGas: 'on', lacquer: 'on', hullLight: 'pbr'
  }),
  high: Object.freeze({
    renderScale: 1, msaa: 4, bloom: 'full', heatHaze: 'on', shadowShafts: 'high', planetQuality: 'high',
    explosions: 'high', effects: 'high', hallDust: 'on', spaceGas: 'on', lacquer: 'on', hullLight: 'pbr'
  }),
  ultra: Object.freeze({
    renderScale: 1.25, msaa: 4, bloom: 'full', heatHaze: 'on', shadowShafts: 'high', planetQuality: 'ultra',
    explosions: 'ultra', effects: 'ultra', hallDust: 'on', spaceGas: 'on', lacquer: 'on', hullLight: 'pbr'
  })
});

// Gaz wybuchów (EXPLOSION_TUNE, src/3d/explosions/explosionFx.js — na żywo). „Wysoka” = strojenie gry
// sprzed opcji. fineGas — atlas 128² dla dużych kul (bez niego duże kule biorą siatkę 96²), gasMinPx — kula
// mniejsza na ekranie bez gazu (same cząstki), marchBudget [mln próbek marszu] i marchStepMax — ponad budżetem
// krok marszu rośnie (taniej, mniej detalu), muzzleGas — dym wystrzałów armat i Yamato.
export const GFX_EXPLOSIONS = Object.freeze({
  low: Object.freeze({ fineGas: false, fineMinPx: 60, gasMinPx: 20, marchBudget: 12, marchStepMax: 3, muzzleGas: false }),
  medium: Object.freeze({ fineGas: false, fineMinPx: 60, gasMinPx: 14, marchBudget: 24, marchStepMax: 2.5, muzzleGas: true }),
  high: Object.freeze({ fineGas: true, fineMinPx: 60, gasMinPx: 14, marchBudget: 40, marchStepMax: 2.5, muzzleGas: true }),
  ultra: Object.freeze({ fineGas: true, fineMinPx: 45, gasMinPx: 12, marchBudget: 80, marchStepMax: 1.6, muzzleGas: true })
});

// Budżety efektów (na żywo). „Wysoka” = wartości gry sprzed opcji: SIDE_JET_TUNE.maxLights 48 / minGasPx 1,1
// (sideJets3D.js), MUZZLE_PER_FRAME / IMPACT_PER_FRAME 48 (weaponFx.js), ASTEROID_BELT_CONFIG.maxLitShips 6 /
// maxShadowShips 2 (asteroidBelt.js — każda mapa cienia to render atlasu), MEDIUM_COUNT_DEFAULT 1 mln (warp/medium.js;
// najwyżej pojemność z init, więc Ultra nie dokłada drobin). cargoSwarmSlots — stanowiska przeładunku z rojem dronów
// liczonym na żywo na GPU (E12, src/3d/swarm/swarmBerthPool.js; decyzja 2026-10-22: Niska 0 — sam stan z zegara
// postoju, Średnia 4, Wysoka i Ultra 8 = pojemność puli).
export const GFX_EFFECTS = Object.freeze({
  low: Object.freeze({ sideJetLights: 12, sideJetGasPx: 2.2, weaponMuzzles: 16, weaponImpacts: 16, beltLitShips: 3, beltShadowShips: 1, warpParticles: 400000, cargoSwarmSlots: 0 }),
  medium: Object.freeze({ sideJetLights: 24, sideJetGasPx: 1.5, weaponMuzzles: 32, weaponImpacts: 32, beltLitShips: 4, beltShadowShips: 1, warpParticles: 700000, cargoSwarmSlots: 4 }),
  high: Object.freeze({ sideJetLights: 48, sideJetGasPx: 1.1, weaponMuzzles: 48, weaponImpacts: 48, beltLitShips: 6, beltShadowShips: 2, warpParticles: 1000000, cargoSwarmSlots: 8 }),
  ultra: Object.freeze({ sideJetLights: 64, sideJetGasPx: 0.9, weaponMuzzles: 64, weaponImpacts: 64, beltLitShips: 8, beltShadowShips: 3, warpParticles: 1000000, cargoSwarmSlots: 8 })
});

// Skala bloomu (Core3D.bloomResolutionScale) i włącznik (perfToggles.bloom).
export function gfxBloomScale(level) { return level === 'half' ? 0.5 : 1; }

/** Wartość dozwolona dla ustawienia `key` (liczby — najbliższa z listy), inaczej domyślna. */
export function normalizeGfxValue(key, value) {
  const spec = GFX_SETTINGS[key];
  if (!spec) return undefined;
  if (typeof spec.def === 'number') {
    const v = Number(value);
    if (!Number.isFinite(v)) return spec.def;
    let best = spec.values[0];
    for (const c of spec.values) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
    return best;
  }
  const s = String(value ?? '').toLowerCase();
  const alias = s === 'med' ? 'medium' : s;
  return spec.values.includes(alias) ? alias : spec.def;
}

/** Pełny zestaw ustawień z dowolnego obiektu (brakujące — domyślne). */
export function normalizeGfx(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of GFX_KEYS) out[k] = k in src ? normalizeGfxValue(k, src[k]) : GFX_SETTINGS[k].def;
  return out;
}

export function defaultGfx() { return normalizeGfx(null); }

/** Ustawienia po wyborze presetu: wartości presetu, preferencje spoza presetów bez zmian. */
export function gfxWithPreset(current, presetId) {
  const p = GFX_PRESETS[presetId];
  const base = normalizeGfx(current);
  if (!p) return base;
  return normalizeGfx({ ...base, ...p });
}

/** Preset, któremu odpowiadają ustawienia ('low' … 'ultra'), albo 'custom'. */
export function matchGfxPreset(settings) {
  const s = normalizeGfx(settings);
  for (const id of GFX_PRESET_IDS) {
    const p = GFX_PRESETS[id];
    if (GFX_PRESET_KEYS.every((k) => s[k] === p[k])) return id;
  }
  return 'custom';
}

function readKey(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}

/**
 * Ustawienia z zapisu: 'sc_gfx', przy braku pola — dawny klucz opcji (wybór sprzed presetów), potem domyślne
 * (= preset Wysoka). `storage` — localStorage albo atrapa z getItem.
 */
export function loadGfxSettings(storage) {
  let saved = null;
  const raw = readKey(storage, GFX_STORAGE_KEY);
  if (raw) {
    try { saved = JSON.parse(raw); } catch { saved = null; }
  }
  const src = {};
  for (const k of GFX_KEYS) {
    if (saved && typeof saved === 'object' && k in saved) { src[k] = saved[k]; continue; }
    const legacy = GFX_SETTINGS[k].legacyKey;
    const v = legacy ? readKey(storage, legacy) : null;
    if (v != null && v !== '') src[k] = v;
  }
  return normalizeGfx(src);
}

/**
 * Czy gracz ma już jakiekolwiek ustawienia grafiki ('sc_gfx' albo dawny klucz którejś opcji). Bez nich —
 * pierwsze uruchomienie: preset dobiera graphicsAutoPreset.js.
 */
export function hasSavedGfx(storage) {
  const v = readKey(storage, GFX_STORAGE_KEY);
  if (v != null && v !== '') return true;
  for (const k of GFX_KEYS) {
    const legacy = GFX_SETTINGS[k].legacyKey;
    const lv = legacy ? readKey(storage, legacy) : null;
    if (lv != null && lv !== '') return true;
  }
  return false;
}

/** Zapis: 'sc_gfx' (wszystko) + dawne klucze pięciu opcji. Zwraca znormalizowane ustawienia. */
export function saveGfxSettings(storage, settings) {
  const s = normalizeGfx(settings);
  if (!storage) return s;
  try {
    storage.setItem(GFX_STORAGE_KEY, JSON.stringify(s));
    for (const k of GFX_KEYS) {
      const legacy = GFX_SETTINGS[k].legacyKey;
      if (legacy) storage.setItem(legacy, String(s[k]));
    }
  } catch { /* bez zapisu (tryb prywatny) — ustawienia działają do przeładowania */ }
  return s;
}

/** Nadpisanie z adresu (?grafika=niska|srednia|wysoka|ultra albo low|medium|high|ultra) — bez zapisu. */
export function gfxPresetFromQuery(search) {
  let q = '';
  try { q = new URLSearchParams(String(search || '')).get('grafika') || ''; } catch { q = ''; }
  const k = q.toLowerCase();
  const map = { niska: 'low', low: 'low', srednia: 'medium', średnia: 'medium', medium: 'medium', med: 'medium', wysoka: 'high', high: 'high', ultra: 'ultra' };
  return map[k] || null;
}
