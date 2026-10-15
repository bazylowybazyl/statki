// src/render/renderIds.js — sloty renderu: slot + generacja dla obiektów gry (docs/PLAN-render-worker.md § 3.2).
//
// Encje gry nie mają wspólnego stałego id (NPC rozpoznaje się po tożsamości obiektu, moduły 3D trzymają stan
// w `WeakMap` po encji), a migawka w SAB nie może nieść referencji. Przestrzeń slotów daje obiektowi parę
// (slot, generacja): slot = najmniejszy wolny (tablice migawki zostają zwarte), generacja slotu rośnie przy zwolnieniu
// (wzór: `PhysicsKernel.bodyGeneration`, src/physics/physicsKernel.js — generacja 0 nie występuje). Render przy zmianie
// generacji slotu tworzy NOWE lustro i zwalnia stare (jak dziś `invalidateHexShipEntity3D`).
//
// Zwalnianie — mark & sweep na klatkę migawki: `begin()` → `slotOf(obj)` z KAŻDEJ listy migawki (obiekt w kilku
// listach dostaje jeden slot) → `end()` zwalnia sloty obiektów, których nie widziano przez `retain` kolejnych klatek
// (encje, ciała, pociski: 1 — znika ze wszystkich list = zwolniony; zasoby — dłużej, bo nie każdą klatkę ktoś
// rysuje dany obraz). Opcjonalny `stamp` (np. numer pocisku z puli) — obiekt użyty ponownie dostaje nową generację
// w tym samym slocie.
//
// Osobne przestrzenie (`createRenderIds`): encje, ciała belek (wrak dziedziczy ciało rodzica — slot ciała zostaje,
// slot encji nie; odłamy dostają nowe ciała), pociski (nie wszystkie mają `serial`), zasoby (obrazy). Bez stempli na
// obiektach gry (klasy ukryte encji bez zmian) — tożsamość w `Map`. Bez alokacji w klatce poza wzrostem tablic
// i wpisem `Map` dla nowego obiektu.
//
// Czysty moduł (bez three, DOM i `window`).

function nextGeneration(value) {
  const next = (value + 1) >>> 0;
  return next || 1;
}

export class RenderIdSpace {
  /**
   * @param {string} name
   * @param {{ capacity?: number, retain?: number }} [opts] — retain: klatki bez odwołania, po których slot wraca
   */
  constructor(name, { capacity = 64, retain = 1 } = {}) {
    this.name = name;
    this.retain = Math.max(1, retain | 0);
    this.capacity = 0;
    this.count = 0;          // sloty zajęte
    this.highWater = 0;      // największy zajęty slot + 1 (zakres pętli po slotach)
    this.epoch = 0;          // numer klatki migawki (begin)
    this.released = 0;       // zwolnienia od startu (statystyka)
    this.allocated = 0;
    this._map = new Map();
    this.objects = [];       // slot → obiekt (null — wolny)
    this.generation = new Uint32Array(0);
    this.seen = new Int32Array(0);       // epoka ostatniego odwołania
    this.stamp = new Float64Array(0);
    this._heap = new Int32Array(0);      // kopiec minimalny wolnych slotów poniżej highWater
    this._heapN = 0;
    this._grow(Math.max(4, capacity | 0));
  }

  _grow(min) {
    let cap = this.capacity || 4;
    while (cap < min) cap *= 2;
    if (cap === this.capacity) return;
    const gen = new Uint32Array(cap);
    gen.set(this.generation);
    gen.fill(1, this.capacity);
    const seen = new Int32Array(cap);
    seen.set(this.seen);
    const stamp = new Float64Array(cap);
    stamp.set(this.stamp);
    const heap = new Int32Array(cap);
    heap.set(this._heap.subarray(0, this._heapN));
    for (let i = this.objects.length; i < cap; i++) this.objects.push(null);
    this.generation = gen;
    this.seen = seen;
    this.stamp = stamp;
    this._heap = heap;
    this.capacity = cap;
  }

  /** Początek klatki migawki. */
  begin() {
    this.epoch++;
  }

  /** Slot obiektu (przydziela, gdy nowy) i odwołanie w tej klatce. `stamp` ≠ zapamiętany → nowa generacja. */
  slotOf(obj, stamp = 0) {
    let s = this._map.get(obj);
    if (s === undefined) {
      s = this._alloc();
      this._map.set(obj, s);
      this.objects[s] = obj;
      this.stamp[s] = stamp;
    } else if (this.stamp[s] !== stamp) {
      this.generation[s] = nextGeneration(this.generation[s]);
      this.stamp[s] = stamp;
    }
    this.seen[s] = this.epoch;
    return s;
  }

  /** Slot obiektu bez przydziału i bez odwołania (−1 — obiekt bez slotu). */
  peek(obj) {
    const s = this._map.get(obj);
    return s === undefined ? -1 : s;
  }

  /** Generacja slotu (stała, dopóki slot ma tego samego właściciela). */
  gen(slot) {
    return this.generation[slot];
  }

  /** Czy para (slot, generacja) wskazuje żywy obiekt. */
  isLive(slot, gen) {
    return slot >= 0 && slot < this.highWater && this.objects[slot] !== null && this.generation[slot] === (gen >>> 0);
  }

  /** Obiekt slotu (null — wolny). */
  objectAt(slot) {
    return slot >= 0 && slot < this.capacity ? this.objects[slot] : null;
  }

  /** Koniec klatki: zwalnia sloty bez odwołania od `retain` klatek. Zwraca liczbę zwolnionych. */
  end() {
    const limit = this.epoch - this.retain;
    let freed = 0;
    for (let s = 0; s < this.highWater; s++) {
      const obj = this.objects[s];
      if (obj === null || this.seen[s] > limit) continue;
      this._release(s, obj);
      freed++;
    }
    if (freed) this._shrinkHighWater();
    return freed;
  }

  /** Zwolnienie od razu (np. obiekt zniszczony poza listami). */
  release(obj) {
    const s = this._map.get(obj);
    if (s === undefined) return false;
    this._release(s, obj);
    this._shrinkHighWater();
    return true;
  }

  _release(s, obj) {
    this._map.delete(obj);
    this.objects[s] = null;
    this.generation[s] = nextGeneration(this.generation[s]);
    this.stamp[s] = 0;
    this.count--;
    this.released++;
    this._heapPush(s);
  }

  _shrinkHighWater() {
    // Wolne sloty na końcu zakresu wypadają z kopca (zakres pętli po slotach maleje).
    let hw = this.highWater;
    while (hw > 0 && this.objects[hw - 1] === null) hw--;
    if (hw === this.highWater) return;
    this.highWater = hw;
    let n = 0;
    const h = this._heap;
    for (let i = 0; i < this._heapN; i++) if (h[i] < hw) h[n++] = h[i];
    this._heapN = n;
    for (let i = (n >> 1) - 1; i >= 0; i--) this._siftDown(i);
  }

  _alloc() {
    let s;
    if (this._heapN > 0) s = this._heapPop();
    else {
      s = this.highWater;
      if (s >= this.capacity) this._grow(s + 1);
      this.highWater = s + 1;
    }
    this.count++;
    this.allocated++;
    return s;
  }

  _heapPush(v) {
    const h = this._heap;
    let i = this._heapN++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p] <= v) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = v;
  }

  _heapPop() {
    const h = this._heap;
    const top = h[0];
    const last = h[--this._heapN];
    if (this._heapN > 0) {
      h[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  _siftDown(i) {
    const h = this._heap;
    const n = this._heapN;
    const v = h[i];
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && h[c + 1] < h[c]) c++;
      if (h[c] >= v) break;
      h[i] = h[c];
      i = c;
    }
    h[i] = v;
  }
}

/** Przestrzenie slotów migawki renderu. `begin()` / `end()` wszystkich naraz. */
export function createRenderIds({ entities = 256, bodies = 256, shots = 1024, resources = 64, resourceRetain = 600 } = {}) {
  const spaces = {
    entities: new RenderIdSpace('entities', { capacity: entities }),
    bodies: new RenderIdSpace('bodies', { capacity: bodies }),
    shots: new RenderIdSpace('shots', { capacity: shots }),
    resources: new RenderIdSpace('resources', { capacity: resources, retain: resourceRetain })
  };
  const list = [spaces.entities, spaces.bodies, spaces.shots, spaces.resources];
  spaces.begin = () => { for (let i = 0; i < list.length; i++) list[i].begin(); };
  spaces.end = () => {
    let freed = 0;
    for (let i = 0; i < list.length; i++) freed += list[i].end();
    return freed;
  };
  return spaces;
}
