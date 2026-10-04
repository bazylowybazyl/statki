// ============================================================
// Dialogi fabuły (2026-09-30) — kolejka kwestii z portretem mówiącego. Bez DOM (UI czyta `current`).
//
// Dwa tryby:
//   'scene' — rozmowa w scenie (dok, odprawa): kwestia czeka na gracza (Spacja / Enter / klik),
//             pierwsze naciśnięcie odsłania resztę tekstu, drugie przechodzi dalej;
//   'radio' — łączność w locie: kwestie same przechodzą po czasie czytania, gra biegnie dalej,
//             gracz może je przewinąć.
// Kwestia: { who: 'admiral', text: '…', portrait?: 'ścieżka', mood?: 'angry', hold?: s }.
// `who` wskazuje obsadę (src/data/story/cast.js); pole `portrait` kwestii nadpisuje portret obsady.
// Maszyna pisania: `shown` rośnie z czasem (znaki / s), UI wycina tekst do `shown`.
// ============================================================

export const DIALOGUE_TUNE = Object.freeze({
  typeCps: 55,          // pisanie: znaki na sekundę
  readCps: 17,          // czytanie (tryb radio): znaki na sekundę po wypisaniu
  radioMinSec: 2.4,     // radio: najkrótszy czas kwestii po wypisaniu
  radioMaxSec: 9,
  radioGapSec: 0.35     // przerwa między kwestiami radia
});

export function createDialogueQueue(tune = DIALOGUE_TUNE) {
  const q = {
    tune: { ...DIALOGUE_TUNE, ...tune },
    lines: [],
    index: -1,
    mode: 'scene',
    current: null,        // { who, text, portrait, mood, shown, typed, index, count, mode }
    active: false,
    _t: 0,                // czas bieżącej kwestii
    _gap: 0,
    _resolve: null,
    _seq: 0,
    listeners: new Set(),

    /**
     * Odtwarza sekwencję kwestii. Zwraca Promise, który spełnia się po ostatniej kwestii albo
     * pominięciu (wartość: 'done' | 'skipped' | 'replaced'). Nowa sekwencja zastępuje bieżącą.
     */
    play(lines, opts = {}) {
      const list = (Array.isArray(lines) ? lines : [lines]).filter((l) => l && typeof l.text === 'string');
      if (this._resolve) this._finish('replaced');
      this.lines = list;
      this.mode = opts.mode === 'radio' ? 'radio' : 'scene';
      this.index = -1;
      this.active = list.length > 0;
      this._seq++;
      const p = new Promise((resolve) => { this._resolve = resolve; });
      if (!this.active) { this._finish('done'); return p; }
      this._next();
      return p;
    },

    /** Klatka (czas rzeczywisty UI — pisanie idzie też w pauzie). */
    tick(dt) {
      if (!this.active || !this.current) return;
      const d = Math.max(0, Number(dt) || 0);
      const cur = this.current;
      if (this._gap > 0) {
        this._gap -= d;
        if (this._gap <= 0) this._next();
        return;
      }
      this._t += d;
      if (!cur.typed) {
        cur.shown = Math.min(cur.text.length, Math.floor(this._t * this.tune.typeCps));
        if (cur.shown >= cur.text.length) { cur.typed = true; cur.typedAt = this._t; }
        this._notify();
      }
      if (this.mode === 'radio' && cur.typed) {
        const hold = Number.isFinite(cur.hold) ? cur.hold
          : Math.min(this.tune.radioMaxSec, Math.max(this.tune.radioMinSec, cur.text.length / this.tune.readCps));
        if (this._t - cur.typedAt >= hold) this._advanceLine();
      }
    },

    /** Gracz: odsłoń tekst albo następna kwestia. Zwraca true, gdy coś zrobił. */
    advance() {
      if (!this.active || !this.current) return false;
      const cur = this.current;
      if (!cur.typed) {
        cur.shown = cur.text.length;
        cur.typed = true;
        cur.typedAt = this._t;
        this._notify();
        return true;
      }
      this._advanceLine();
      return true;
    },

    /** Gracz: pomiń całą sekwencję. */
    skip() {
      if (!this.active) return false;
      this._finish('skipped');
      return true;
    },

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },

    _advanceLine() {
      if (this.mode === 'radio' && this.index < this.lines.length - 1 && this.tune.radioGapSec > 0) {
        this._gap = this.tune.radioGapSec;
        this.current = { ...this.current, gap: true };
        this._notify();
        return;
      }
      this._next();
    },

    _next() {
      this._gap = 0;
      this.index++;
      if (this.index >= this.lines.length) { this._finish('done'); return; }
      const l = this.lines[this.index];
      this._t = 0;
      this.current = {
        who: l.who || 'unknown',
        text: String(l.text),
        portrait: l.portrait || null,
        mood: l.mood || null,
        hold: Number.isFinite(l.hold) ? l.hold : undefined,
        shown: 0,
        typed: false,
        typedAt: 0,
        index: this.index,
        count: this.lines.length,
        mode: this.mode,
        gap: false
      };
      this._notify();
    },

    _finish(result) {
      this.active = false;
      this.current = null;
      this.lines = [];
      this.index = -1;
      this._gap = 0;
      const r = this._resolve;
      this._resolve = null;
      this._notify();
      if (r) r(result);
    },

    _notify() {
      for (const fn of this.listeners) {
        try { fn(this.current, this); } catch (err) { if (typeof console !== 'undefined') console.warn('[Dialogi]', err); }
      }
    }
  };
  return q;
}
