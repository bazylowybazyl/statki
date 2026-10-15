// ============================================================
// Rozdzielczość dynamiczna (2026-10-15; opcja „Rozdzielczość dynamiczna”, domyślnie wyłączona): gdy czas GPU
// klatki (Core3D.gpuFrameMs + compute) przekracza budżet docelowego FPS, skala renderu schodzi stopniami poniżej
// skali z opcji (1 → 0,85 → 0,75 → 0,67 — najwyżej `maxSteps` stopni drabiny), a wraca, gdy jest zapas.
//
// Histereza, żeby nie migało: w dół dopiero po `downHold` s ciągłego przekroczenia (`downAt` × budżet), w górę
// po `upHold` s, gdy czas PRZEWIDZIANY po stopniu wyżej (× (s↑ / s)² — koszt jak liczba pikseli; zawyżony, bo część
// pracy nie zależy od rozdzielczości: gaz, kernele, cienie) mieści się w `upAt` × budżet; zmiana skali (resize celów)
// najwyżej co `minInterval` s, w górę najwcześniej `upInterval` s po poprzedniej zmianie; próbki z `settle` s po
// zmianie pomijane (wyniki znaczników czasu przychodzą z opóźnieniem — liczyły jeszcze starą skalę).
//
// Moduł czysty (bez DOM, three i window): stan + krok; klej — blok „OPCJE GRAFIKI” w index.html
// (stepDynamicResolution w pętli gry → Core3D.setRenderScale tylko przy zmianie — bez nowych pipeline'ów).
// ============================================================

// Drabina skal (te same wartości co opcja „Rozdzielczość renderu 3D”).
export const DYN_RES_LADDER = Object.freeze([1.5, 1.25, 1, 0.85, 0.75, 0.67, 0.5]);

// Strojenie (konsola: window.DynamicResTune). Czasy w sekundach zegara klatek gry.
export const DYN_RES_TUNE = {
  maxSteps: 3,        // stopni drabiny poniżej skali z opcji
  minScale: 0.5,      // nigdy niżej
  downAt: 0.9,        // EMA czasu GPU > downAt × budżet …
  downHold: 1,        // … przez tyle s → stopień niżej (krótki skok — wybuch 0,3 s — nie wystarcza)
  upAt: 0.72,         // przewidywany czas po stopniu wyżej < upAt × budżet …
  upHold: 3,          // … przez tyle s → stopień wyżej
  minInterval: 1.2,   // s między zmianami skali (resize celów)
  upInterval: 4,      // s od ostatniej zmiany do kroku w górę
  settle: 0.5,        // s po zmianie — próbki pomijane (liczyły starą skalę)
  ema: 0.2,           // waga nowej próbki w średniej (próbka co ~4 klatki)
  maxSampleAge: 1,    // s bez nowej próbki — wstrzymanie (brak znaczników czasu GPU, karta w tle)
  maxDt: 0.25,        // najdłuższy krok zegara (karta w tle, przestój)
  targetFps: 0        // > 0 — nadpisuje docelowe FPS z opcji (narzędzia, próby)
};

/** Skale sterownika dla skali z opcji `base`: [base, …do maxSteps stopni drabiny niżej, nie mniej niż minScale]. */
export function dynResLevels(base, tune = DYN_RES_TUNE) {
  const b = Number(base) > 0 ? Number(base) : 1;
  const out = [b];
  for (const s of DYN_RES_LADDER) {
    if (out.length > tune.maxSteps) break;
    if (s < b - 1e-6 && s >= tune.minScale - 1e-6) out.push(s);
  }
  return out;
}

export function createDynResState() {
  return {
    base: 0, target: 0, levels: [1], level: 0, scale: 0,
    ema: -1, lastT: -1, lastSample: -1e9, lastChange: -1e9,
    overT: 0, underT: 0, changed: false, changes: 0
  };
}

function reset(st, base, target, tune) {
  st.base = base;
  st.target = target;
  st.levels = dynResLevels(base, tune);
  st.level = 0;
  st.ema = -1;
  st.overT = 0;
  st.underT = 0;
}

/**
 * Krok sterownika. `t` — zegar klatek [s] (rosnący), `base` — skala renderu z opcji, `targetFps` — docelowe FPS
 * (0 = wyłączona: skala = base), `sampleMs` — NOWA próbka czasu GPU klatki [ms] albo null / NaN (brak nowej).
 * Zwraca skalę renderu; `st.changed` = skala inna niż po poprzednim kroku (wtedy zastosować).
 */
export function stepDynRes(st, t, base, targetFps, sampleMs, tune = DYN_RES_TUNE) {
  const prev = st.scale;
  const b = Number(base) > 0 ? Number(base) : 1;
  const over = Number(tune.targetFps) > 0 ? Number(tune.targetFps) : (Number(targetFps) > 0 ? Number(targetFps) : 0);
  const dt = st.lastT < 0 ? 0 : Math.max(0, Math.min(tune.maxDt, t - st.lastT));
  st.lastT = t;
  if (b !== st.base) {
    // Nowa skala z opcji: sterownik od nowa, od niej. To już zmiana rozmiaru celów (próbki w drodze liczyły starą —
    // `settle`, następna zmiana najwcześniej za minInterval); pierwszy krok — pomiar od razu.
    const resized = st.base > 0;
    reset(st, b, over, tune);
    st.lastChange = resized ? t : t - tune.minInterval;
  } else if (over !== st.target) {
    // Inne docelowe FPS (60 ↔ 120): stopień zostaje, średnia i czasy od nowa (inny budżet); włączenie i wyłączenie —
    // od skali z opcji.
    const keep = st.target > 0 && over > 0;
    const level = st.level;
    reset(st, b, over, tune);
    if (keep) st.level = level;
    else st.lastChange = t - tune.minInterval;
  }
  if (over <= 0 || st.levels.length < 2) {
    st.scale = b;
    st.changed = st.scale !== prev;
    return st.scale;
  }
  if (Number.isFinite(sampleMs) && sampleMs > 0 && t - st.lastChange >= tune.settle) {
    st.ema = st.ema < 0 ? sampleMs : st.ema + (sampleMs - st.ema) * tune.ema;
    st.lastSample = t;
  }
  if (st.ema < 0 || t - st.lastSample > tune.maxSampleAge) {
    st.overT = 0;
    st.underT = 0;
  } else {
    const budget = 1000 / over;
    const cur = st.levels[st.level];
    const isOver = st.ema > tune.downAt * budget && st.level < st.levels.length - 1;
    const up = st.level > 0 ? st.levels[st.level - 1] : 0;
    const isUnder = up > 0 && st.ema * (up / cur) * (up / cur) < tune.upAt * budget;
    st.overT = isOver ? st.overT + dt : 0;
    st.underT = isUnder ? st.underT + dt : 0;
    const since = t - st.lastChange;
    let next = st.level;
    if (isOver && st.overT >= tune.downHold && since >= tune.minInterval) next = st.level + 1;
    else if (isUnder && st.underT >= tune.upHold && since >= Math.max(tune.minInterval, tune.upInterval)) next = st.level - 1;
    if (next !== st.level) {
      st.level = next;
      st.lastChange = t;
      st.overT = 0;
      st.underT = 0;
      st.ema = -1;    // nowa średnia z próbek nowej skali (po `settle`)
      st.changes++;
    }
  }
  st.scale = st.levels[st.level];
  st.changed = st.scale !== prev;
  return st.scale;
}
