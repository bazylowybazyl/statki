// src/game/sharedTyped.js
//
// Tablice typowane w SharedArrayBuffer, gdy strona ma izolację (COOP / COEP — gra i Vite ją
// mają; w Node SharedArrayBuffer jest zawsze), inaczej zwykłe. Dane czytane i przez grę, i przez
// render w workerze (SDF olbrzymów pasa, cień pól — RW-25, docs/PLAN-render-worker.md § 3.9):
// worker dostaje ten sam bufor bez kopii.

export function sharedMemoryAvailable() {
  return typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated !== false;
}

/** Nowa tablica `Ctor` o `length` elementach (zera) — na SharedArrayBuffer, gdy się da. */
export function sharedTypedArray(Ctor, length) {
  if (sharedMemoryAvailable()) {
    try {
      return new Ctor(new SharedArrayBuffer(length * Ctor.BYTES_PER_ELEMENT));
    } catch {
      // brak pamięci dzielonej (np. limit) — zwykła tablica
    }
  }
  return new Ctor(length);
}
