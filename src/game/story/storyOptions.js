// ============================================================
// Opcje nowej gry dla fabuły (menu „Nowa gra”, 2026-09-30): Kampania (start w doku K-7, misja 1) albo
// Swobodna gra (dawny start przy Ziemi), Samouczek wł./wył. Zapamiętane w localStorage (sc_story_campaign,
// sc_story_tutorial); domyślnie kampania z samouczkiem. Skok dev do fazy misji: ?story=<faza>.
// ============================================================

const KEYS = Object.freeze({ campaign: 'sc_story_campaign', tutorial: 'sc_story_tutorial' });

function readFlag(key, fallback) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key, on) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, on ? '1' : '0');
  } catch { /* tryb prywatny — wybór do przeładowania */ }
}

export const StoryOptions = {
  campaign: true,
  tutorial: true,

  load() {
    this.campaign = readFlag(KEYS.campaign, true);
    this.tutorial = readFlag(KEYS.tutorial, true);
    return this;
  },

  /** kind: 'campaign' | 'tutorial'. */
  set(kind, on) {
    const field = kind === 'tutorial' ? 'tutorial' : 'campaign';
    this[field] = !!on;
    writeFlag(KEYS[field], this[field]);
    return this;
  },

  /** Faza startu z adresu (?story=approach) — tylko do testów. */
  devStartPhase(search) {
    try {
      const q = new URLSearchParams(search ?? (typeof location !== 'undefined' ? location.search : ''));
      const v = q.get('story');
      return v ? String(v).trim().toLowerCase() : null;
    } catch {
      return null;
    }
  }
};
