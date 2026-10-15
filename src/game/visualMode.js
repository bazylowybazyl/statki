// ============================================================
// Wygląd nowej gry (menu „Nowa gra”, 2026-09-30): statki 2D (sprite'y — gra jak dotąd) albo 3D (modele
// z src/3d/ships3d/ — shipModels3DGame.js). Rozgrywka ta sama w każdym wariancie, różni się tylko obraz.
// Wybór zapamiętany w localStorage (sc_ships3d), czytany przy starcie gry.
// Bronie są ZAWSZE 3D (decyzja użytkownika 2026-10-15, docs/PLAN-render-worker.md § 7.1 — B3D): wieże rysuje
// partia wież 3D (turretBatch3D.js) także na sprite'ach; dawny klucz `sc_weapons3d` jest ignorowany.
// ============================================================

const KEYS = Object.freeze({ ships3D: 'sc_ships3d' });

function readFlag(key) {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key, on) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, on ? '1' : '0');
  } catch { /* bez zapisu (tryb prywatny) — wybór działa do przeładowania */ }
}

export const VisualMode = {
  ships3D: false,
  /** Zawsze prawda (B3D) — pole zostaje dla czytelników (raporty, harness). */
  weapons3D: true,

  /** Wczytuje zapamiętany wybór (domyślnie statki 2D). */
  load() {
    this.ships3D = readFlag(KEYS.ships3D);
    this.weapons3D = true;
    return this;
  },

  /** kind: 'ships' (on — 3D); zapamiętuje wybór. 'weapons' — bez skutku (bronie zawsze 3D). */
  set(kind, on) {
    if (kind !== 'ships') return this;
    this.ships3D = !!on;
    writeFlag(KEYS.ships3D, this.ships3D);
    return this;
  },

  /** Krótki opis wariantu (komunikat startu, raporty harnessu). */
  label() {
    return `statki ${this.ships3D ? '3D' : '2D'}, bronie 3D`;
  }
};
