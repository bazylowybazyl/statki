// src/game/crushSmoke.js
//
// DYM ZGNIOTU (2026-10-15, prośba użytkownika: „mniejszy dym przy ciężkim zgniocie kadłuba (taran bez trafienia
// w zbiornik), żeby szarża prawie zawsze dymiła”): okręt, który W STYKU z innym kadłubem traci w krótkim oknie dużo węzłów
// (zgniot — straty spoza broni z haka HullBodies.onNodeLost), dostaje w miejscu zgniotu mniejszy, dymny wybuch z gazu.
// Uzupełnia pęknięcie zbiornika paliwa (src/game/fuelTank.js — stepFuelTankRupture): taran, który mija zbiornik,
// też dymi, ale mniej i z mało ognia.
//
// Reguła: straty węzłów okrętu sumowane w oknie `window` s od pierwszej straty; ≥ progu (`crushMinNodes`: część węzłów
// kadłuba, z granicami) w oknie i styk kadłubów
// (CollisionFX: grind / impact) nie dawniej niż `contactGrace` s → dym w środku zgniecionych węzłów, rozmiar ∝ √węzłów;
// potem okno od nowa, najwyżej jeden dym na `cooldown` s na okręt. Okno bez progu — od nowa (otarcie i lekkie
// zderzenie nie dymią). Sam obraz — o tym, co dymi (okręty, nie wraki ani budowle), i o wybuchu decyduje wołający (`emit`).
// Moduł bez DOM i three; bez alokacji w kroku (stan per encja w WeakMap, lista żywych stanów).

export const CRUSH_SMOKE_TUNE = {
  enabled: true,
  window: 0.25,          // s — okno sumowania utraconych węzłów (od pierwszej straty)
  // „Ciężki zgniot” = węzłów w oknie ≥ minFrac × węzły kadłuba (hull.baseNodes) w [minFloor, minNodes]: fregata ~40
  // węzłów → 12, niszczyciel ~100–150 i większe → 24. Pomiar (scripts/zbiornik-taran-sym.mjs, Atlas): szczyt w oknie —
  // lekkie zderzenie 300 j/s fregaty ≤ 10, pancernika 8–18; muśnięcie burtą 0–26; W + Shift 15–134; szarża 12–274.
  minNodes: 24,
  minFrac: 0.3,
  minFloor: 8,
  contactGrace: 0.2,     // s — styk kadłubów nie dawniej niż
  cooldown: 0.9,         // s — odstęp dymów jednego okrętu
  afterRupture: 0.6,     // s — po pęknięciu zbiornika okrętu (większy wybuch) zgniot nie dymi osobno (decyduje wołający)
  sizePerSqrtNode: 16,   // size wybuchu = k · √węzłów (j. świata), w [minSize, maxSize] (zbiornik: fregata ~100, pancernik ~230)
  minSize: 80,           // kula ≥ ~100 j. — gaz, nie cząstki, już przy zoomie gry ~0,14 (GAS_MIN_PX 14 px)
  maxSize: 190,
  // Środek dymu przesunięty od środka zgniecionych węzłów ku środkowi okrętu o inward × size (najwyżej do środka):
  // zgnieciony obszar zajmuje dziób taranującego, a jego kadłub jest przeszkodą gazu — dym ma bić z rozdartej ofiary.
  inward: 0.6,
  profile: 'crush'       // profil EXPLOSION_PROFILES (src/3d/explosions/explosionRecipes.js)
};

/** Próg „ciężkiego zgniotu” [węzły w oknie] dla encji (z liczby węzłów kadłuba; bez kadłuba — minNodes). */
export function crushMinNodes(entity, T = CRUSH_SMOKE_TUNE) {
  const base = Number(entity?.beamHull?.baseNodes) || 0;
  if (!(base > 0)) return T.minNodes;
  const n = Math.round(T.minFrac * base);
  return n < T.minFloor ? T.minFloor : (n > T.minNodes ? T.minNodes : n);
}

/** Rozmiar wybuchu dymu zgniotu dla liczby zgniecionych węzłów. */
export function crushSmokeSize(nodes, T = CRUSH_SMOKE_TUNE) {
  const s = T.sizePerSqrtNode * Math.sqrt(Math.max(0, Number(nodes) || 0));
  return s < T.minSize ? T.minSize : (s > T.maxSize ? T.maxSize : s);
}

/**
 * Środek dymu: środek zgniecionych węzłów (x, y) przesunięty ku środkowi okrętu `entity` (x / y albo pos) o inward × size,
 * najwyżej do środka. Wynik w `out` { x, y }.
 */
export function crushSmokeCenter(entity, x, y, size, out = {}, T = CRUSH_SMOKE_TUNE) {
  const cx = Number(entity?.x ?? entity?.pos?.x), cy = Number(entity?.y ?? entity?.pos?.y);
  out.x = x; out.y = y;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return out;
  const dx = cx - x, dy = cy - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!(d > 1e-6)) return out;
  const k = Math.min(d, T.inward * size) / d;
  out.x = x + dx * k; out.y = y + dy * k;
  return out;
}

/**
 * Licznik zgniotu: `contact(encja, t)` (styk kadłubów), `lost(encja, x, y, t)` (węzeł stracony poza bronią, świat gry),
 * `step(t, emit)` po kroku fizyki — `emit(encja, x, y, węzły)` dla każdego ciężkiego zgniotu (false = dym nie poszedł,
 * odstęp nie liczy się od niego). `stats`: dymy, okna bez progu, okna w odstępie.
 */
export function createCrushSmoke(tune = CRUSH_SMOKE_TUNE) {
  const states = new WeakMap();
  const live = [];
  const stats = { puffs: 0, windows: 0, cooled: 0 };
  function stateOf(e) {
    let s = states.get(e);
    if (!s) { s = { e: null, n: 0, min: 0, sx: 0, sy: 0, t0: 0, contactT: -Infinity, puffT: -Infinity, live: false }; states.set(e, s); }
    return s;
  }
  function clear(s) { s.n = 0; s.sx = 0; s.sy = 0; }
  return {
    tune,
    stats,
    contact(e, t) {
      if (!e) return;
      stateOf(e).contactT = t;
    },
    lost(e, x, y, t) {
      if (!tune.enabled || !e) return;
      const s = stateOf(e);
      if (s.n > 0 && t - s.t0 > tune.window) clear(s);
      if (s.n === 0) {
        s.t0 = t;
        s.min = crushMinNodes(e, tune);
        if (!s.live) { s.live = true; s.e = e; live.push(s); }
      }
      s.n++; s.sx += x; s.sy += y;
    },
    step(t, emit) {
      for (let i = live.length - 1; i >= 0; i--) {
        const s = live[i];
        if (s.n >= s.min && t - s.contactT <= tune.contactGrace) {
          if (t - s.puffT >= tune.cooldown) {
            const ok = emit(s.e, s.sx / s.n, s.sy / s.n, s.n);
            if (ok !== false) { s.puffT = t; stats.puffs++; }
          } else stats.cooled++;
          clear(s);
        } else if (s.n > 0 && t - s.t0 > tune.window) {
          stats.windows++;
          clear(s);
        }
        if (s.n === 0) {
          s.live = false; s.e = null;
          const last = live.pop();
          if (last !== s) live[i] = last;
        }
      }
    },
    /** Liczba okien w toku (diagnostyka). */
    get live() { return live.length; },
    reset() {
      for (const s of live) { clear(s); s.live = false; s.e = null; }
      live.length = 0;
    }
  };
}
