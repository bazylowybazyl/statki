// src/render/tripleBuffer.js — potrójny bufor stron migawki renderu (docs/PLAN-render-worker.md § 3.2).
//
// Jeden pisarz (gra), jeden czytelnik (render: worker albo ta sama strona w trybie `inline`), bez blokad. Trzy strony
// i trzy indeksy: `back` (prywatny pisarza), `front` (prywatny czytelnika) i `mid` — wspólny Int32 w nagłówku z bitem
// NOWA:
//   publikacja: pisarz zapisał stronę `back` → prev = Atomics.exchange(H, MID, back | NOWA), back = prev & 3;
//   odbiór:     gdy Atomics.load(H, MID) & NOWA → prev = Atomics.exchange(H, MID, front), front = prev & 3.
// Pisarz nigdy nie dostaje strony, którą czyta czytelnik, a `Atomics.exchange` jest sekwencyjnie spójny — zapisy strony
// sprzed publikacji są widoczne po odbiorze. Czytelnik bierze zawsze NAJNOWSZĄ opublikowaną stronę (starsze przepadają
// — pisarz liczy je w `overwritten`). `TripleFloat32Buffer` z `src/physics/sharedBuffers.js` się do tego nie nadaje:
// czytelnik nie rezerwuje tam strony, którą czyta.
//
// Czysty moduł (bez three, DOM i `window`) — importują go obie strony. Bez `SharedArrayBuffer` (strona bez izolacji
// COOP / COEP, testy) działa na zwykłym `ArrayBuffer` w jednym wątku: `Atomics` działa na nim tak samo.

/** Słowa Int32 nagłówka (64 B — strony zaczynają się od pełnej linii pamięci podręcznej). */
export const TRIPLE = Object.freeze({
  MID: 0,          // indeks strony wspólnej | NOWA
  PUBLISHED: 1,    // liczba publikacji (licznik pisarza)
  CONSUMED: 2,     // liczba odbiorów (licznik czytelnika)
  OVERWRITTEN: 3,  // publikacje nadpisane, zanim czytelnik je odebrał (pominięte strony)
  PAGE_BYTES: 4,   // rozmiar strony (kontrola zgodności obu stron)
  LAYOUT_GEN: 5,   // generacja układu (zmienia się z nowym zestawem SAB — § 3.2 „pojemności rosną przez nowy zestaw”)
  HEADER_WORDS: 16,
  HEADER_BYTES: 64,
  NEW: 4,          // bit NOWA w MID (indeksy stron 0–2 mieszczą się w dwóch bitach)
  INDEX_MASK: 3
});

const PAGE_ALIGN = 64;

function alignUp(n, a) {
  return Math.ceil(n / a) * a;
}

/** Odstęp między początkami stron (rozmiar strony wyrównany do 64 B). */
export function triplePageStride(pageBytes) {
  return alignUp(Math.max(8, Number(pageBytes) || 0), PAGE_ALIGN);
}

/** Bajty całego bufora: nagłówek + 3 strony. */
export function tripleByteLength(pageBytes) {
  return TRIPLE.HEADER_BYTES + 3 * triplePageStride(pageBytes);
}

/** Przesunięcie (bajty) strony `index` od początku bufora. */
export function triplePageOffset(pageBytes, index) {
  return TRIPLE.HEADER_BYTES + (index & 3) * triplePageStride(pageBytes);
}

export function canShareMemory() {
  return typeof SharedArrayBuffer === 'function' &&
    (typeof globalThis.crossOriginIsolated !== 'boolean' || globalThis.crossOriginIsolated === true);
}

/**
 * Nowy bufor potrójny (SAB, gdy dostępny i `shared !== false`). Nagłówek zainicjowany: `back` pisarza = 0,
 * `mid` = 1 (bez NOWA), `front` czytelnika = 2.
 */
export function createTripleBuffer(pageBytes, { shared = true, layoutGen = 0 } = {}) {
  const bytes = tripleByteLength(pageBytes);
  const buffer = shared && canShareMemory() ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
  const H = new Int32Array(buffer, 0, TRIPLE.HEADER_WORDS);
  H[TRIPLE.PAGE_BYTES] = pageBytes | 0;
  H[TRIPLE.LAYOUT_GEN] = layoutGen | 0;
  Atomics.store(H, TRIPLE.MID, 1);
  return buffer;
}

function readPageBytes(buffer, pageBytes) {
  const H = new Int32Array(buffer, 0, TRIPLE.HEADER_WORDS);
  const stored = H[TRIPLE.PAGE_BYTES];
  if (pageBytes != null && stored !== (pageBytes | 0)) {
    throw new Error(`tripleBuffer: strona ${pageBytes} B, bufor ma ${stored} B`);
  }
  return stored;
}

/**
 * Widoki stron tworzone RAZ (bez alokacji w klatce): `views(buffer, byteOffset, pageBytes, index)` zwraca dowolny
 * obiekt (np. zestaw Float64Array / Int32Array bloków migawki). Domyślnie — Float64Array całej strony.
 */
function makePages(buffer, pageBytes, views) {
  const pages = new Array(3);
  for (let i = 0; i < 3; i++) {
    const off = triplePageOffset(pageBytes, i);
    pages[i] = views ? views(buffer, off, pageBytes, i) : new Float64Array(buffer, off, pageBytes >> 3);
  }
  return pages;
}

/** Strona pisarza. Pisze tylko do `page` (= pages[back]), potem `publish()`. */
export class TripleBufferWriter {
  constructor(buffer, { pageBytes = null, views = null } = {}) {
    this.buffer = buffer;
    this.pageBytes = readPageBytes(buffer, pageBytes);
    this.header = new Int32Array(buffer, 0, TRIPLE.HEADER_WORDS);
    this.pages = makePages(buffer, this.pageBytes, views);
    this.back = 0;
    this.page = this.pages[0];
    this.published = 0;
    this.overwritten = 0;
  }

  /** Publikuje stronę `back`; zwraca indeks nowej strony do pisania. */
  publish() {
    const prev = Atomics.exchange(this.header, TRIPLE.MID, this.back | TRIPLE.NEW);
    if (prev & TRIPLE.NEW) {
      this.overwritten++;
      Atomics.add(this.header, TRIPLE.OVERWRITTEN, 1);
    }
    this.published++;
    Atomics.add(this.header, TRIPLE.PUBLISHED, 1);
    this.back = prev & TRIPLE.INDEX_MASK;
    this.page = this.pages[this.back];
    return this.back;
  }
}

/** Strona czytelnika. `acquire()` → true, gdy wzięta nowa strona (`page` = pages[front]). */
export class TripleBufferReader {
  constructor(buffer, { pageBytes = null, views = null } = {}) {
    this.buffer = buffer;
    this.pageBytes = readPageBytes(buffer, pageBytes);
    this.header = new Int32Array(buffer, 0, TRIPLE.HEADER_WORDS);
    this.pages = makePages(buffer, this.pageBytes, views);
    this.front = 2;
    this.page = this.pages[2];
    this.consumed = 0;
  }

  /** Czy czeka nowa strona (bez odbioru). */
  get hasNew() {
    return (Atomics.load(this.header, TRIPLE.MID) & TRIPLE.NEW) !== 0;
  }

  /** Bierze najnowszą opublikowaną stronę; false — nic nowego (`page` bez zmian). */
  acquire() {
    if (!(Atomics.load(this.header, TRIPLE.MID) & TRIPLE.NEW)) return false;
    const prev = Atomics.exchange(this.header, TRIPLE.MID, this.front);
    this.front = prev & TRIPLE.INDEX_MASK;
    this.page = this.pages[this.front];
    this.consumed++;
    Atomics.add(this.header, TRIPLE.CONSUMED, 1);
    return true;
  }

  /** Publikacje nadpisane przed odbiorem (pominięte strony) — licznik pisarza. */
  get overwritten() {
    return Atomics.load(this.header, TRIPLE.OVERWRITTEN);
  }
}
