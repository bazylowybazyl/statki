// ============================================================
// Konteksty wejścia (docs/PLAN-pad.md § 3.1 p. 4, § 4, etap 1) — kto dostaje przyciski pada. Moduł czysty: flagi
// stanu gry podaje klej (index.html, blok „WEJŚCIE / PAD”) raz na klatkę.
//
//   const ctx = createInputContext();
//   ctx.update({ menu, split, started, story, paused, station, cic }, dev);   // po dev.update
//   ctx.top                      // wierzchni kontekst: 'menu' | 'split' | 'story' | 'pause' | 'station' | 'cic' | 'game' | 'none'
//   ctx.isEaten(slot, b)         // przycisk „zjedzony” — trzymany w chwili zmiany kontekstu, do puszczenia
//
// Stos od góry (pierwszy spełniony wygrywa): menu główne → nakładki podzielonego ekranu (przypisanie padów, wybór
// statku) → fabuła blokująca (scena, podsumowanie, dok, kino) → pauza → panel stacji → CIC → gra. Przed startem gry
// bez menu (ekran ładowania, lot intro) — 'none'. Panel akcji fabuły (ODDOKUJ) bez blokady to nakładka w grze, nie
// kontekst (zabiera tylko A — klej).
// Zjadanie: przy KAŻDEJ zmianie wierzchniego kontekstu wszystkie trzymane przyciski padów są zjedzone do puszczenia —
// B, które zamknęło menu, nie odpali w grze rakiety; RT trzymany przy wejściu w scenę nie strzela po niej, dopóki
// gracz nie puści i nie wciśnie go znowu. Gałki nie są zjadane (lot przechodzi przez nakładki, które go nie biorą).
// ============================================================
import { PAD_SLOTS, PAD_BUTTONS } from './padDevice.js';

export const INPUT_CTX = Object.freeze({
  NONE: 'none', MENU: 'menu', SPLIT: 'split', STORY: 'story', PAUSE: 'pause', STATION: 'station', CIC: 'cic', GAME: 'game'
});

/** Kolejność stosu od góry (dokumentacja i testy; rozstrzyga resolveInputContext). */
export const INPUT_CTX_ORDER = Object.freeze(['menu', 'split', 'story', 'pause', 'station', 'cic', 'game']);

/** Wierzchni kontekst z flag gry. */
export function resolveInputContext(f) {
  if (!f) return INPUT_CTX.NONE;
  if (f.menu) return INPUT_CTX.MENU;
  if (f.split) return INPUT_CTX.SPLIT;
  if (!f.started) return INPUT_CTX.NONE;
  if (f.story) return INPUT_CTX.STORY;
  if (f.paused) return INPUT_CTX.PAUSE;
  if (f.station) return INPUT_CTX.STATION;
  if (f.cic) return INPUT_CTX.CIC;
  return INPUT_CTX.GAME;
}

export function createInputContext(opts = {}) {
  const slots = opts.slots || PAD_SLOTS;
  const buttons = opts.buttons || PAD_BUTTONS;
  const n = slots * buttons;
  const ctx = {
    top: INPUT_CTX.NONE,
    prev: INPUT_CTX.NONE,
    changed: false,
    changes: 0,
    eaten: new Uint8Array(n),

    /** Raz na klatkę po odczycie padów. Zwraca wierzchni kontekst. */
    update(flags, dev) {
      const next = resolveInputContext(flags);
      ctx.changed = next !== ctx.top;
      if (ctx.changed) {
        ctx.prev = ctx.top;
        ctx.top = next;
        ctx.changes++;
        if (dev) ctx.eatHeld(dev);
      }
      if (dev) {
        const down = dev.down;
        const eaten = ctx.eaten;
        for (let i = 0; i < n; i++) if (eaten[i] && !down[i]) eaten[i] = 0;
      }
      return ctx.top;
    },

    /** Zjada wszystko, co trzymane (zmiana kontekstu w środku klatki — np. akcja otworzyła menu). */
    eatHeld(dev) {
      const down = dev.down;
      const eaten = ctx.eaten;
      for (let i = 0; i < n; i++) if (down[i]) eaten[i] = 1;
    },

    /** Zjada jeden trzymany przycisk (np. A, które zamknęło nakładkę bez zmiany kontekstu). */
    eat(slot, b) {
      if (slot >= 0) ctx.eaten[slot * buttons + b] = 1;
    },

    isEaten(slot, b) {
      return slot >= 0 && ctx.eaten[slot * buttons + b] === 1;
    },

    clear() {
      ctx.eaten.fill(0);
    }
  };
  return ctx;
}
