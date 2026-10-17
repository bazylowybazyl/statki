// src/render/overlayRing.js — pierścień kanw nakładek 2D w kompozycji B2cr (docs/PLAN-render-worker.md § 7.1, D1;
// docs/webgpu/RW-02-PROTOTYP.md § 4, § 7).
//
// Nakładki klatki k rysuje wątek główny zaraz po migawce k do jednej z N zwykłych kanw 2D w DOM (ukrytych); gdy z workera
// przyjdzie bitmapa 3D klatki k, w JEDNYM zadaniu: `transferFromImageBitmap` obrazu 3D i przełączenie widoczności
// dwóch kanw nakładek (pokazana dotąd → ukryta, kanwa klatki k → widoczna). Para „3D i 2D z jednej klatki” zostaje.
//
// Reguła ochrony (B2cr — jedyna z trzech prób RW-02 bez zgubionych par): przy przydziale kanwy nietykalne są
//   1. kanwa pokazana,
//   2. kanwy klatek ODEBRANYCH przez worker (4 ostatnie z RET — `retRecentConsumed`), a jeszcze nie złożonych
//      (bitmapa może czekać w kolejce wiadomości wątku głównego),
//   3. kanwa ostatnio opublikowanej migawki (worker może ją właśnie brać).
// Nowa nakładka idzie do najstarszej z pozostałych. 5 kanw na widok — w całej siatce RW-02 najwięcej 4 chronione naraz.
// Przeciwciśnienie (B2cp): `canPublish(lastConsumed)` — nowa migawka i nakładka dopiero, gdy worker odebrał poprzednią
// (harness bez limitu klatek i GPU zajęte przy 4K — bez tego nakładek jest więcej niż klatek 3D i proces GPU się zapycha).
//
// Czysty moduł: kanwy to indeksy 0…N−1; DOM (widoczność, konteksty) trzyma wołający. Bez alokacji w klatce.

export const OVERLAY_RING_DEFAULT = 5;

export class OverlayRing {
  constructor(count = OVERLAY_RING_DEFAULT) {
    if (!(count >= 3)) throw new Error('OverlayRing: co najmniej 3 kanwy');
    this.count = count | 0;
    this.frameOf = new Float64Array(this.count).fill(-1); // k nakładki w kanwie (−1 — pusta)
    this.shown = -1;          // kanwa pokazana
    this.lastComposed = -1;   // k ostatniej złożonej klatki
    this.lastPublished = -1;  // k ostatniej opublikowanej migawki (z nakładką)
    this.prevPublished = -1;  // k publikacji przed ostatnią (reguła 3 przy przydziale)
    this.hidePrev = -1;       // po compose(): kanwa do ukrycia
    // liczniki diagnostyczne
    this.full = 0;            // przydziały bez wolnej kanwy (pierścień za mały — nadpisanie, para zgubiona)
    this.guardMax = 0;        // najwięcej kanw chronionych przy jednym przydziale
    this.misses = 0;          // złożenia bez nakładki tej klatki
    this.composed = 0;
  }

  reset() {
    this.frameOf.fill(-1);
    this.shown = -1;
    this.lastComposed = -1;
    this.lastPublished = -1;
    this.prevPublished = -1;
  }

  /** B2cp: czy wolno opublikować nową migawkę (worker odebrał poprzednią). */
  canPublish(lastConsumed) {
    return this.lastPublished < 0 || lastConsumed >= this.lastPublished;
  }

  /**
   * Kanwa dla nakładki klatki k. `recent` — ostatnio odebrane klatki (z RET, od najnowszej), `recentCount` — ile.
   * `queued` / `queuedCount` — klatki, których bitmapy czekają na złożenie po stronie gry (stały wiek obrazu,
   * src/render/framePacer.js: więcej niż 4 odebrane z RET bywa w drodze). Zwraca indeks kanwy (zawsze poprawny; przy
   * pełnym pierścieniu — kanwa za pokazaną, licznik `full`).
   */
  acquire(k, recent, recentCount, queued = null, queuedCount = 0) {
    this.prevPublished = this.lastPublished;
    this.lastPublished = k;
    const frameOf = this.frameOf;
    const last = this.lastComposed;
    const prev = this.prevPublished;
    let slot = -1;
    let oldest = Infinity;
    let guarded = 0;
    for (let i = 0; i < this.count; i++) {
      const kk = frameOf[i];
      let inFlight = false;
      if (kk > last) {
        for (let j = 0; j < recentCount; j++) if (recent[j] === kk) { inFlight = true; break; }
        if (!inFlight) for (let j = 0; j < queuedCount; j++) if (queued[j] === kk) { inFlight = true; break; }
      }
      if (i === this.shown || inFlight || (kk >= 0 && kk === prev)) { guarded++; continue; }
      if (kk < oldest) { oldest = kk; slot = i; }
    }
    if (guarded > this.guardMax) this.guardMax = guarded;
    if (slot < 0) {
      this.full++;
      slot = (this.shown + 1) % this.count;
    }
    frameOf[slot] = k;
    return slot;
  }

  /**
   * Bitmapa 3D klatki k przyszła: kanwa do pokazania albo −1 (brak nakładki tej klatki — zostaje pokazana dotąd,
   * licznik `misses`). `hidePrev` po wywołaniu — kanwa do ukrycia (−1 — żadna).
   */
  compose(k) {
    this.composed++;
    this.hidePrev = -1;
    let slot = -1;
    const frameOf = this.frameOf;
    for (let i = 0; i < this.count; i++) if (frameOf[i] === k) { slot = i; break; }
    if (k > this.lastComposed) this.lastComposed = k;
    if (slot < 0) { this.misses++; return -1; }
    if (this.shown >= 0 && this.shown !== slot) this.hidePrev = this.shown;
    this.shown = slot;
    return slot;
  }
}
