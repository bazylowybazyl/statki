// src/render/returnLayout.js — układ kanału zwrotnego RET (docs/PLAN-render-worker.md § 3.4, RW-02 § 4 / § 7).
//
// Jeden `SharedArrayBuffer` (w trybie `inline` i w testach — zwykły ArrayBuffer), który PISZE RENDER (worker), a czyta
// gra. Trzy części:
//   1. nagłówek Int32 (`RET_I32`): numery migawek (ostatnio ODEBRANA, NARYSOWANA, klatka ostatniego rozkazu), pierścień
//      4 ostatnio odebranych klatek (reguła pierścienia kanw B2cr — nietykalne są kanwy klatek odebranych, a jeszcze
//      nie złożonych), flagi (`RET_FLAG`), postęp rozgrzewki, liczniki;
//   2. statystyki Float64 (`RET_F64`) pod seqlockiem `RET_I32.SEQ_STATS` (nieparzysty = zapis w toku);
//   3. przebicia tarcz (`RET_BREACH`): rekord na slot puli tarcz — slot i generacja encji (renderIds), klucz profilu,
//      epoka odczytu, flaga „cokolwiek przebite” i słowa bitów płytek (dziś `getArrayBufferAsync` co 0,1 s w
//      `shield3D.js`) — każdy rekord pod własnym seqlockiem.
// Gra nigdy nie pyta renderu synchronicznie — czyta to, co render ostatnio zapisał (§ 3.4).
//
// Czysty moduł (bez three, DOM i `window`). Wymiary puli tarcz są parametrem (domyślne = `SHIELD_SLOTS` 12 ×
// `SHIELD_SLOT_CAP` 4096 płytek → 128 słów z `src/3d/shield/shieldPool.js`; pilnuje test).

export const RET_LAYOUT_VERSION = 1;

export const RET_I32 = Object.freeze({
  VERSION: 0,          // RET_LAYOUT_VERSION (zgodność obu stron)
  SEQ_STATS: 1,        // seqlock statystyk Float64
  LAST_CONSUMED: 2,    // k ostatnio ODEBRANEJ migawki (strona wzięta z potrójnego bufora)
  LAST_RENDERED: 3,    // k ostatnio NARYSOWANEJ migawki (render skończony, bitmapa wysłana)
  LAST_EVENT_FRAME: 4, // klatka ostatniego odtworzonego rozkazu
  CONS_N: 5,           // liczba zapisów do pierścienia odebranych
  CONS0: 6,            // CONS0 … CONS0 + 3 — 4 ostatnio odebrane k (B2cr)
  FLAGS: 10,           // RET_FLAG
  WARM_DONE: 11,       // rozgrzewka: wpisy zrobione
  WARM_TOTAL: 12,      // rozgrzewka: wpisy razem
  SKIPPED: 13,         // migawki opublikowane, których render nie odebrał (wziął nowszą)
  RING_SWITCHES: 14,   // przejścia czytelnika na większy pierścień rozkazów
  SYNC_PIPELINES: 15,  // pipeline'y utworzone synchronicznie (rozgrzewka czegoś nie objęła)
  DRAW_CALLS: 16,      // draw calle ostatniej klatki
  BREACH_EPOCH: 17,    // epoka ostatniego odczytu przebić (rośnie co odczyt)
  ERRORS: 18,          // błędy renderu (szczegóły — postMessage)
  HEADER_WORDS: 32,
  CONS_RING: 4
});

export const RET_FLAG = Object.freeze({
  GPU_READY: 1,        // urządzenie GPU gotowe (Core3D.gpuReady)
  READY: 2,            // Core3D.ready (render, kompilacja, wgrywanie tekstur)
  GPU_UNSUPPORTED: 4,  // brak adaptera WebGPU — menu pokazuje komunikat
  DEVICE_LOST: 8,      // utrata urządzenia
  FX_READY: 16,        // kroki efektów rozgrzane
  WARM_FLUSHED: 32,    // Core3D.warmup.flush() skończony (ekran ładowania może zejść)
  GPU_TIMER: 64        // znaczniki czasu GPU dostępne (Core3D.gpuTimerSupported — rozdzielczość dynamiczna)
});

export const RET_F64 = Object.freeze({
  GPU_FRAME_MS: 0,        // Core3D.gpuFrameMs
  GPU_COMPUTE_MS: 1,
  GPU_FRAME_SAMPLES: 2,   // licznik wyników znaczników czasu (render) — nowa próbka = zmiana licznika
  GPU_COMPUTE_SAMPLES: 3,
  CPU_UPDATE_MS: 4,       // aktualizacje modułów 3D w klatce renderu
  CPU_RENDER_MS: 5,       // Core3D.render
  CPU_FRAME_MS: 6,        // cała klatka renderu
  WALL_CONSUMED: 7,       // timeOrigin + now() odbioru ostatniej migawki (porównania między wątkami — § 3.5)
  WALL_RENDERED: 8,       // j.w. — koniec renderu
  TRIANGLES: 9,
  FX_STEPS: 10,           // kroki Core3D.fx w klatce
  FX_MS: 11,
  PIXEL_RATIO: 12,        // skala renderu w użyciu (rozdzielczość dynamiczna)
  // uzgadnianie strona ↔ worker (RW-45b) — liczniki narastające: takty rAF workera, takty bez renderu (strona odebrana
  // czeka na swoją wiadomość), strony odebrane i porzucone przed renderem (tryb `rwRender=raf`), rendery, rendery
  // zrobione wprost z odbioru wiadomości `frame` (tryb `msg`)
  W_TICKS: 13,
  W_WAITS: 14,
  W_ABANDONED: 15,
  W_RENDERED: 16,
  W_MSG_RENDERS: 17,
  W_MSG_LAG_SUM: 18,      // suma opóźnień wiadomości `frame` (wysyłka strony → odbiór w workerze, ms epoki) i ich liczba
  W_MSG_N: 19,
  COUNT: 32
});

/** Słowa nagłówka rekordu przebić (Int32), potem słowa bitów (Uint32). */
export const RET_BREACH = Object.freeze({
  SEQ: 0,          // seqlock rekordu
  ENT_SLOT: 1,     // slot encji (renderIds) albo −1 — slot puli wolny
  ENT_GEN: 2,      // generacja slotu encji
  PROFILE: 3,      // klucz profilu tarczy (zmiana obrysu = inne płytki)
  EPOCH: 4,        // RET_I32.BREACH_EPOCH odczytu
  ANY: 5,          // 1 — choć jedna płytka przebita (dziś `__shieldBreach`)
  HEADER_WORDS: 8,
  SLOTS: 12,       // domyślnie SHIELD_SLOTS
  WORDS: 128       // domyślnie SHIELD_SLOT_CAP / 32
});

/**
 * Układ bufora: przesunięcia bajtów części i długość. Wynik jest stały dla parametrów — obie strony liczą go same.
 */
export function createReturnLayout({ breachSlots = RET_BREACH.SLOTS, breachWords = RET_BREACH.WORDS } = {}) {
  const i32Bytes = RET_I32.HEADER_WORDS * 4;
  const f64Offset = i32Bytes;
  const f64Bytes = RET_F64.COUNT * 8;
  const breachOffset = f64Offset + f64Bytes;
  const breachStride = RET_BREACH.HEADER_WORDS + breachWords;
  const breachBytes = breachSlots * breachStride * 4;
  return Object.freeze({
    version: RET_LAYOUT_VERSION,
    i32Offset: 0,
    f64Offset,
    breachOffset,
    breachSlots,
    breachWords,
    breachStride,
    byteLength: breachOffset + breachBytes
  });
}

export const RET_DEFAULT_LAYOUT = createReturnLayout();

function canShareMemory() {
  return typeof SharedArrayBuffer === 'function' &&
    (typeof globalThis.crossOriginIsolated !== 'boolean' || globalThis.crossOriginIsolated === true);
}

/** Nowy bufor RET (wyzerowany, wersja wpisana, sloty przebić wolne). */
export function createReturnBuffer(layout = RET_DEFAULT_LAYOUT, { shared = true } = {}) {
  const buffer = shared && canShareMemory() ? new SharedArrayBuffer(layout.byteLength) : new ArrayBuffer(layout.byteLength);
  const v = createReturnViews(buffer, layout);
  v.i32[RET_I32.VERSION] = layout.version;
  v.i32[RET_I32.LAST_CONSUMED] = -1;
  v.i32[RET_I32.LAST_RENDERED] = -1;
  v.i32[RET_I32.LAST_EVENT_FRAME] = -1;
  for (let s = 0; s < layout.breachSlots; s++) v.breach[s * layout.breachStride + RET_BREACH.ENT_SLOT] = -1;
  return buffer;
}

/** Widoki tworzone RAZ: `i32` (nagłówek), `f64` (statystyki), `breach` (Int32) i `breachBits` (Uint32, ten sam obszar). */
export function createReturnViews(buffer, layout = RET_DEFAULT_LAYOUT) {
  const n = layout.breachSlots * layout.breachStride;
  return {
    layout,
    buffer,
    i32: new Int32Array(buffer, layout.i32Offset, RET_I32.HEADER_WORDS),
    f64: new Float64Array(buffer, layout.f64Offset, RET_F64.COUNT),
    breach: new Int32Array(buffer, layout.breachOffset, n),
    breachBits: new Uint32Array(buffer, layout.breachOffset, n)
  };
}

// ── Numery migawek i reguła pierścienia kanw (B2cr) ──────────────────────────────────────────────────────────

/** Render odebrał migawkę k (pisze render). */
export function retNoteConsumed(v, k) {
  const i32 = v.i32;
  const n = Atomics.load(i32, RET_I32.CONS_N);
  Atomics.store(i32, RET_I32.CONS0 + (n & 3), k | 0);
  Atomics.store(i32, RET_I32.CONS_N, (n + 1) | 0);
  Atomics.store(i32, RET_I32.LAST_CONSUMED, k | 0);
}

/** Render skończył migawkę k (pisze render). */
export function retNoteRendered(v, k) {
  Atomics.store(v.i32, RET_I32.LAST_RENDERED, k | 0);
}

/**
 * Ostatnio odebrane klatki (najwyżej 4, od najnowszej) do `out`; zwraca liczbę. Gra (B2cr): kanwy tych klatek, jeszcze
 * nie złożone, są nietykalne.
 */
export function retRecentConsumed(v, out) {
  const i32 = v.i32;
  const n = Atomics.load(i32, RET_I32.CONS_N);
  const m = n < RET_I32.CONS_RING ? n : RET_I32.CONS_RING;
  for (let i = 0; i < m; i++) out[i] = Atomics.load(i32, RET_I32.CONS0 + ((n - 1 - i) & 3));
  return m;
}

// ── Flagi ────────────────────────────────────────────────────────────────────────────────────────────────────

export function retSetFlag(v, bit) {
  Atomics.or(v.i32, RET_I32.FLAGS, bit);
}

export function retClearFlag(v, bit) {
  Atomics.and(v.i32, RET_I32.FLAGS, ~bit);
}

export function retHasFlag(v, bit) {
  return (Atomics.load(v.i32, RET_I32.FLAGS) & bit) !== 0;
}

// ── Statystyki (seqlock) ─────────────────────────────────────────────────────────────────────────────────────

/** Początek zapisu statystyk (render): licznik nieparzysty. */
export function retBeginStats(v) {
  Atomics.add(v.i32, RET_I32.SEQ_STATS, 1);
}

/** Koniec zapisu statystyk (render): licznik parzysty. */
export function retEndStats(v) {
  Atomics.add(v.i32, RET_I32.SEQ_STATS, 1);
}

/**
 * Spójna kopia statystyk do `out` (Float64Array ≥ RET_F64.COUNT). False — render pisał przez wszystkie próby (gra
 * zostaje przy poprzedniej kopii).
 */
export function retReadStats(v, out, tries = 4) {
  const i32 = v.i32;
  const f = v.f64;
  for (let t = 0; t < tries; t++) {
    const s1 = Atomics.load(i32, RET_I32.SEQ_STATS);
    if (s1 & 1) continue;
    for (let i = 0; i < RET_F64.COUNT; i++) out[i] = f[i];
    if (Atomics.load(i32, RET_I32.SEQ_STATS) === s1) return true;
  }
  return false;
}

// ── Przebicia tarcz (rekord na slot puli, seqlock na rekord) ─────────────────────────────────────────────────

/**
 * Zapis rekordu slotu puli tarcz (render). `bits` — słowa bitów płytek slotu (Uint32Array albo null = zera);
 * `entSlot` = −1 zwalnia slot.
 */
export function retWriteBreach(v, poolSlot, entSlot, entGen, profile, epoch, bits, bitsOffset = 0) {
  const L = v.layout;
  const b = v.breach;
  const base = poolSlot * L.breachStride;
  Atomics.add(b, base + RET_BREACH.SEQ, 1);
  b[base + RET_BREACH.ENT_SLOT] = entSlot | 0;
  b[base + RET_BREACH.ENT_GEN] = entGen | 0;
  b[base + RET_BREACH.PROFILE] = profile | 0;
  b[base + RET_BREACH.EPOCH] = epoch | 0;
  const w0 = base + RET_BREACH.HEADER_WORDS;
  const words = v.breachBits;
  let any = 0;
  if (bits) {
    for (let i = 0; i < L.breachWords; i++) {
      const x = bits[bitsOffset + i] >>> 0;
      words[w0 + i] = x;
      any |= x;
    }
  } else {
    words.fill(0, w0, w0 + L.breachWords);
  }
  b[base + RET_BREACH.ANY] = any !== 0 ? 1 : 0;
  Atomics.add(b, base + RET_BREACH.SEQ, 1);
}

/**
 * Spójny odczyt rekordu slotu puli (gra): nagłówek do `head` (Int32Array ≥ HEADER_WORDS), bity do `outBits`
 * (Uint32Array ≥ breachWords, może być null — sam nagłówek). False — zapis w toku przez wszystkie próby.
 */
export function retReadBreach(v, poolSlot, head, outBits, tries = 4) {
  const L = v.layout;
  const b = v.breach;
  const base = poolSlot * L.breachStride;
  const w0 = base + RET_BREACH.HEADER_WORDS;
  for (let t = 0; t < tries; t++) {
    const s1 = Atomics.load(b, base + RET_BREACH.SEQ);
    if (s1 & 1) continue;
    for (let i = 1; i < RET_BREACH.HEADER_WORDS; i++) head[i] = b[base + i];
    if (outBits) {
      const words = v.breachBits;
      for (let i = 0; i < L.breachWords; i++) outBits[i] = words[w0 + i];
    }
    if (Atomics.load(b, base + RET_BREACH.SEQ) === s1) {
      head[RET_BREACH.SEQ] = s1;
      return true;
    }
  }
  return false;
}
