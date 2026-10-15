// src/render/fxRandomCore.js
//
// Generator losowy efektów (mulberry32 z ziarnem) — klasa wspólna dla DWÓCH strumieni (RW-20,
// docs/PLAN-render-worker.md § 4):
//   • strumień RENDERU `fxRandom` (src/3d/fx/fxRandom.js) — moduły renderu (w trybie worker: wątek renderu),
//   • strumień GRY `fxRandomGame` (src/game/fxRandomGame.js) — wizualia i drobna losowość liczone na wątku głównym
//     (dźwięk, cząstki kanwy, Hexlance kanwy, iskry zderzeń, wyrzut dronów).
// Oba nie zużywają `Math.random` gry. Bez three, DOM i `window`; bez alokacji.

/** Domyślne ziarno strumienia renderu (stałe — start gry zawsze z tym samym ciągiem). */
export const FX_RANDOM_SEED = 0x6a09e667;
/** Domyślne ziarno strumienia gry (RW-20). */
export const FX_RANDOM_GAME_SEED = 0xbb67ae85;

const TWO_32 = 4294967296;

export class FxRandom {
  /** @param {number} [seed] ziarno (uint32) */
  constructor(seed = FX_RANDOM_SEED) {
    this._s = seed >>> 0;
  }

  /** Ustawia ziarno (jak `H.reseed` harnessu: `s = v >>> 0`). Zwraca this. */
  seed(seed = FX_RANDOM_SEED) {
    this._s = seed >>> 0;
    return this;
  }

  /** Stan generatora (do zapamiętania i odtworzenia ciągu). */
  get state() { return this._s >>> 0; }
  set state(v) { this._s = v >>> 0; }

  /** Liczba z [0, 1) — mulberry32, bit w bit jak harness. */
  next() {
    const s = (this._s = (this._s + 0x6D2B79F5) | 0);
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / TWO_32;
  }

  /** Liczba z [a, b). */
  range(a, b) {
    return a + (b - a) * this.next();
  }

  /** Liczba całkowita z [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /** Całkowita uint32 — ziarno paczki / klatki dla hasza w kernelu GPU. */
  uint32() {
    return Math.floor(this.next() * TWO_32) >>> 0;
  }

  /** true z prawdopodobieństwem p. */
  chance(p) {
    return this.next() < p;
  }

  /** −1 albo +1. */
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  /**
   * Zaokrąglenie losowe (emitery ciągłe `tempo · dt`): floor(n) + 1 z prawdopodobieństwem
   * części ułamkowej. Przy 144+ FPS zwykłe zaokrąglenie gubiło emisję < 1 na klatkę
   * (demo broni, `E()` w recipes.js). Zwraca 0 dla n ≤ 0 i NaN.
   */
  round(n) {
    if (!(n > 0)) return 0;
    const f = Math.floor(n);
    return f + (this.next() < n - f ? 1 : 0);
  }
}
