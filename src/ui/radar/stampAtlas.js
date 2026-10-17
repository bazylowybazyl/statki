// src/ui/radar/stampAtlas.js — przydział miejsc w atlasie stempli (2026-10-17, proces GPU przy 5120 × 1440 —
// docs/AUDYT-render-worker-2026-10-17.md § 7.3).
//
// Po co: znaczniki krawędzi ekranu rysowały napisy ze stempli — każdy napis na WŁASNYM małym płótnie (dwa na kontakt).
// W Chrome każde osobne płótno-źródło drawImage na kanwie gry to osobny obraz w rastrze procesu GPU (wejście
// w pamięć obrazów, osobny rysunek bez łączenia): ~47 płócien na klatkę w bitwie = ~0,4 ms CrGpuMain na klatkę.
// Atlas: wszystkie stemple w kilku stronach (płótnach) — w rastrze kilka obrazów, a rysunki z jednej strony się
// łączą. Piksele stempla te same (napis rysowany w tym samym miejscu względem jego prostokąta, przycięty do niego).
//
// Czysty moduł (bez DOM): strony tworzy wołający (`makePage(w, h)` → obiekt z polem `canvas` albo cokolwiek).
// Miejsca w klasach rozmiaru (półki o jednej klasie), wolne miejsca klasy wracają do jej listy; brak miejsca —
// nowa strona (do `maxPages`), potem wyparcie najdawniej użytego miejsca tej klasy (właściciel dostaje `slot = null`
// i piecze się od nowa przy następnym użyciu). Bez alokacji przy samym użyciu (`touch`).

export const STAMP_ATLAS_WIDTHS = Object.freeze([24, 32, 48, 64, 96, 128, 192, 256]);
export const STAMP_ATLAS_HEIGHTS = Object.freeze([12, 16, 20, 24, 32, 40, 48, 64]);
/** Margines wokół miejsca [px] — przezroczysty pas (rysunek z obrotem / skalą nie łapie sąsiada). */
export const STAMP_ATLAS_GUTTER = 1;

function classIndex(list, v) {
  for (let i = 0; i < list.length; i++) if (v <= list[i]) return i;
  return -1;
}

export class StampAtlas {
  constructor({ pageW = 512, pageH = 512, maxPages = 6, makePage = null } = {}) {
    this.pageW = pageW;
    this.pageH = pageH;
    this.maxPages = maxPages;
    this.makePage = makePage;
    this.pages = [];          // { canvas?, nextY, index }
    this.shelves = [];        // { page, y, cls, cw, ch, nextX }
    this.free = new Map();    // klasa → wolne miejsca
    this.slotsOf = new Map(); // klasa → wszystkie miejsca (wyparcie)
    this.seq = 0;
    this.stats = { allocs: 0, reused: 0, evictions: 0, overflow: 0, pages: 0 };
  }

  /** Klasa rozmiaru (w × h) albo −1 (za duży — stempel poza atlasem). */
  classOf(w, h) {
    const wi = classIndex(STAMP_ATLAS_WIDTHS, w);
    const hi = classIndex(STAMP_ATLAS_HEIGHTS, h);
    return wi < 0 || hi < 0 ? -1 : wi * STAMP_ATLAS_HEIGHTS.length + hi;
  }

  /**
   * Miejsce na stempel w × h (bez marginesu) dla właściciela `owner` albo null (za duży / atlas pełny bez miejsc tej
   * klasy). Miejsce: { page, x, y (lewy górny róg obszaru stempla), cw, ch (pojemność), cls, owner, used }.
   */
  alloc(w, h, owner = null) {
    const cls = this.classOf(w, h);
    if (cls < 0) { this.stats.overflow++; return null; }
    const g = STAMP_ATLAS_GUTTER;
    const cw = STAMP_ATLAS_WIDTHS[Math.floor(cls / STAMP_ATLAS_HEIGHTS.length)];
    const ch = STAMP_ATLAS_HEIGHTS[cls % STAMP_ATLAS_HEIGHTS.length];
    const ow = cw + 2 * g, oh = ch + 2 * g;
    let slot = null;
    const fl = this.free.get(cls);
    if (fl && fl.length) { slot = fl.pop(); this.stats.reused++; }
    if (!slot) {
      for (let i = 0; i < this.shelves.length && !slot; i++) {
        const s = this.shelves[i];
        if (s.cls === cls && s.nextX + ow <= this.pageW) { slot = this._newSlot(s.page, s.nextX + g, s.y + g, cw, ch, cls); s.nextX += ow; }
      }
    }
    if (!slot) {
      let page = null;
      for (let i = 0; i < this.pages.length; i++) if (this.pages[i].nextY + oh <= this.pageH) { page = this.pages[i]; break; }
      if (!page && this.pages.length < this.maxPages && oh <= this.pageH && ow <= this.pageW) page = this._newPage();
      if (page) {
        const s = { page, y: page.nextY, cls, cw, ch, nextX: ow };
        page.nextY += oh;
        this.shelves.push(s);
        slot = this._newSlot(page, g, s.y + g, cw, ch, cls);
      }
    }
    if (!slot) {
      // wyparcie najdawniej użytego miejsca tej klasy
      const all = this.slotsOf.get(cls);
      if (!all || !all.length) { this.stats.overflow++; return null; }
      let best = all[0];
      for (let i = 1; i < all.length; i++) if (all[i].used < best.used) best = all[i];
      if (best.owner) best.owner.slot = null;
      slot = best;
      this.stats.evictions++;
    }
    slot.owner = owner;
    slot.used = ++this.seq;
    this.stats.allocs++;
    return slot;
  }

  /** Miejsce wraca do wolnych swojej klasy (właściciel go już nie używa). */
  release(slot) {
    if (!slot) return;
    slot.owner = null;
    let fl = this.free.get(slot.cls);
    if (!fl) this.free.set(slot.cls, fl = []);
    if (!fl.includes(slot)) fl.push(slot);
  }

  touch(slot) { slot.used = ++this.seq; }

  _newPage() {
    const page = { canvas: null, nextY: 0, index: this.pages.length };
    if (this.makePage) page.canvas = this.makePage(this.pageW, this.pageH);
    this.pages.push(page);
    this.stats.pages = this.pages.length;
    return page;
  }

  _newSlot(page, x, y, cw, ch, cls) {
    const slot = { page, x, y, cw, ch, cls, owner: null, used: 0 };
    let all = this.slotsOf.get(cls);
    if (!all) this.slotsOf.set(cls, all = []);
    all.push(slot);
    return slot;
  }
}
