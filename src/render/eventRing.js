// src/render/eventRing.js — pierścień rozkazów renderu (docs/PLAN-render-worker.md § 3.3).
//
// SPSC na `Float64Array` (SAB albo zwykły ArrayBuffer w trybie `inline` i w testach): jeden pisarz (gra), jeden
// czytelnik (render). Rekordy ZMIENNEJ długości, pisane wprost do widoku, bez obiektu rekordu:
//   [typ · 2^16 + słowa, klatka, …ładunek]   (słowa = długość ładunku; liczby całkowite < 2^53 są dokładne)
// Typ 0 jest zarezerwowany: znacznik końca miejsca (PAD) — czytelnik przeskakuje na początek danych, więc ładunek
// rekordu zawsze leży w jednym kawałku widoku.
//
// Protokół indeksów jak `SpscFloat64Ring` (src/physics/sharedBuffers.js): dane, potem `Atomics.store` indeksu.
// Indeksy WRITE / READ to liczniki słów zawijane w Int32 (pojemność = potęga dwójki, pozycja = licznik & maska) —
// bez niejednoznaczności pełny / pusty, cała pojemność do użytku.
//
// Brak miejsca: pisarz zakłada WIĘKSZY pierścień (generacja + 1), zamyka stary (CLOSED po ostatnim WRITE) i oddaje
// nowy bufor przez `onGrow` (w trybie `worker` — `postMessage`, w `inline` — wprost do czytelnika). Czytelnik dopija
// stary do końca i dopiero wtedy przechodzi na nowy — rekordy nie giną i nie zmieniają kolejności. Pisarz nigdy nie
// czeka na czytelnika.
//
// Czysty moduł (bez three, DOM i `window`).

export const EVENT_RING = Object.freeze({
  WRITE: 0,        // licznik zapisanych słów (pisarz)
  READ: 1,         // licznik zwolnionych słów (czytelnik)
  CLOSED: 2,       // 1 — pisarz przeszedł na następny pierścień; WRITE jest ostateczny
  GEN: 3,          // generacja pierścienia (następny = GEN + 1)
  CAPACITY: 4,     // słowa danych (potęga dwójki)
  RECORDS: 5,      // liczba zapisanych rekordów (statystyka pisarza)
  HEADER_WORDS: 16,
  HEADER_BYTES: 64,
  PAD: 0,          // typ znacznika końca miejsca
  TYPE_SHIFT: 65536,
  MAX_WORDS: 65535 // największy ładunek rekordu; większe dane — postMessage / SAB, w rekordzie klucz
});

const H = EVENT_RING;

function nextPow2(n) {
  let p = 16;
  while (p < n) p *= 2;
  return p;
}

export function eventRingByteLength(capacity) {
  return H.HEADER_BYTES + nextPow2(capacity) * 8;
}

function canShareMemory() {
  return typeof SharedArrayBuffer === 'function' &&
    (typeof globalThis.crossOriginIsolated !== 'boolean' || globalThis.crossOriginIsolated === true);
}

/** Nowy pierścień: `capacity` słów (zaokrąglone w górę do potęgi dwójki), generacja `gen`. */
export function createEventRingBuffer(capacity, { shared = true, gen = 0 } = {}) {
  const cap = nextPow2(Math.max(16, capacity | 0));
  const bytes = H.HEADER_BYTES + cap * 8;
  const buffer = shared && canShareMemory() ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
  const hdr = new Int32Array(buffer, 0, H.HEADER_WORDS);
  hdr[H.CAPACITY] = cap;
  hdr[H.GEN] = gen | 0;
  return buffer;
}

function viewsOf(buffer) {
  const header = new Int32Array(buffer, 0, H.HEADER_WORDS);
  const cap = header[H.CAPACITY];
  return { header, data: new Float64Array(buffer, H.HEADER_BYTES, cap), cap };
}

/**
 * Pisarz. Zapis rekordu: `const o = w.begin(typ, klatka, słowa)` → `w.data[o + i] = …` (i < słowa) → `w.commit()`.
 * `begin` może przełączyć pisarza na większy pierścień — po nim zawsze bierz `w.data` od nowa.
 */
export class EventRingWriter {
  constructor(buffer, { onGrow = null, shared = null } = {}) {
    this.onGrow = onGrow;
    this.shared = shared == null ? (typeof SharedArrayBuffer === 'function' && buffer instanceof SharedArrayBuffer) : !!shared;
    this.grows = 0;
    this.records = 0;
    this._attach(buffer);
  }

  _attach(buffer) {
    const v = viewsOf(buffer);
    this.buffer = buffer;
    this.header = v.header;
    this.data = v.data;
    this.capacity = v.cap;
    this.mask = v.cap - 1;
    this.gen = v.header[H.GEN];
    this._w = Atomics.load(v.header, H.WRITE);
    this._end = this._w;
    this._open = false;
  }

  /** Słowa wolne w bieżącym pierścieniu (bez uwzględnienia zawinięcia). */
  get free() {
    return this.capacity - ((this._w - Atomics.load(this.header, H.READ)) | 0);
  }

  /** Rezerwuje rekord; zwraca przesunięcie ładunku w `this.data`. */
  begin(type, frame, words) {
    if (this._open) throw new Error('eventRing: begin() bez commit()');
    if (!(type > 0 && type < H.TYPE_SHIFT)) throw new Error(`eventRing: zły typ ${type}`);
    words |= 0;
    if (words < 0 || words > H.MAX_WORDS) throw new Error(`eventRing: rekord ${words} słów (max ${H.MAX_WORDS})`);
    const need = 2 + words;
    let p = this._w & this.mask;
    let room = this.capacity - p;
    let used = (this._w - Atomics.load(this.header, H.READ)) | 0;
    let pad = need > room ? room : 0;
    if (need + pad > this.capacity - used) {
      this._grow(need);
      p = this._w & this.mask;
      room = this.capacity - p;
      used = (this._w - Atomics.load(this.header, H.READ)) | 0;
      pad = need > room ? room : 0;
      if (need + pad > this.capacity - used) throw new Error('eventRing: nowy pierścień za mały');
    }
    if (pad) {
      this.data[p] = H.PAD;
      this._w = (this._w + pad) | 0;
      p = 0;
    }
    this.data[p] = type * H.TYPE_SHIFT + words;
    this.data[p + 1] = frame;
    this._end = (this._w + need) | 0;
    this._open = true;
    return p + 2;
  }

  /** Publikuje rekord z `begin` (czytelnik zobaczy go po tym zapisie). */
  commit() {
    if (!this._open) return;
    this._open = false;
    this._w = this._end;
    this.records++;
    Atomics.store(this.header, H.WRITE, this._w);
    this.header[H.RECORDS] = this.records | 0;
  }

  /** Rekord z gotowej tablicy (wygoda testów i rzadkich rozkazów). */
  push(type, frame, payload, n = payload ? payload.length : 0) {
    const o = this.begin(type, frame, n);
    const d = this.data;
    for (let i = 0; i < n; i++) d[o + i] = payload[i];
    this.commit();
  }

  _grow(need) {
    const cap = nextPow2(Math.max(this.capacity * 2, need * 4));
    const next = createEventRingBuffer(cap, { shared: this.shared, gen: this.gen + 1 });
    // WRITE starego jest już ostateczny (rekordy zatwierdzone) — dopiero teraz CLOSED.
    Atomics.store(this.header, H.CLOSED, 1);
    this.grows++;
    this._attach(next);
    if (this.onGrow) this.onGrow(next);
  }
}

/**
 * Czytelnik. Pętla: `for (let o; (o = r.next(k)) >= 0;) { r.type, r.frame, r.words, r.data[o + i] }`.
 * `next(maxFrame)` zwalnia poprzedni rekord i oddaje następny o klatce ≤ maxFrame (wyższej — zostawia go w pierścieniu).
 * Po przejściu na nowy pierścień zmienia się `data` — bierz `r.data` po każdym `next`.
 */
export class EventRingReader {
  constructor(buffer) {
    this._queue = [];
    this.switches = 0;
    this.type = 0;
    this.frame = 0;
    this.words = 0;
    this._attach(buffer);
  }

  _attach(buffer) {
    const v = viewsOf(buffer);
    this.buffer = buffer;
    this.header = v.header;
    this.data = v.data;
    this.capacity = v.cap;
    this.mask = v.cap - 1;
    this.gen = v.header[H.GEN];
    this._r = Atomics.load(v.header, H.READ);
    this._after = this._r;
  }

  /** Następny pierścień od pisarza (`onGrow`); czytelnik przejdzie na niego po dopiciu bieżącego. */
  adopt(buffer) {
    this._queue.push(buffer);
  }

  /** Słowa czekające w bieżącym pierścieniu. */
  get pending() {
    return (Atomics.load(this.header, H.WRITE) - this._r) | 0;
  }

  next(maxFrame = Infinity) {
    let r = this._after;
    for (;;) {
      let w = Atomics.load(this.header, H.WRITE);
      if (r === w) {
        if (!Atomics.load(this.header, H.CLOSED)) break;
        w = Atomics.load(this.header, H.WRITE);
        if (r !== w) continue;
        if (!this._switch()) break;
        r = this._r;
        continue;
      }
      const p = r & this.mask;
      const h = this.data[p];
      const type = Math.floor(h / H.TYPE_SHIFT);
      if (type === H.PAD) {
        r = (r + this.capacity - p) | 0;
        continue;
      }
      const frame = this.data[p + 1];
      if (frame > maxFrame) break;
      const words = h - type * H.TYPE_SHIFT;
      this.type = type;
      this.frame = frame;
      this.words = words;
      this._r = r;
      this._after = (r + 2 + words) | 0;
      Atomics.store(this.header, H.READ, r);
      return p + 2;
    }
    this._r = r;
    this._after = r;
    Atomics.store(this.header, H.READ, r);
    return -1;
  }

  _switch() {
    const want = this.gen + 1;
    for (let i = 0; i < this._queue.length; i++) {
      const buf = this._queue[i];
      if (new Int32Array(buf, 0, H.HEADER_WORDS)[H.GEN] !== want) continue;
      this._queue.splice(i, 1);
      this._attach(buf);
      this.switches++;
      return true;
    }
    return false;
  }
}
