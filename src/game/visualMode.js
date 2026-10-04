// ============================================================
// Wygląd nowej gry (menu „Nowa gra”, 2026-09-30): statki i bronie 2D (sprite'y, wieżyczki kanwy — gra
// jak dotąd) albo 3D (modele z src/3d/ships3d/ — shipModels3DGame.js). Rozgrywka ta sama w każdym
// wariancie, różni się tylko obraz. Wybór zapamiętany w localStorage (sc_ships3d, sc_weapons3d),
// czytany przy starcie gry.
// ============================================================

const KEYS = Object.freeze({ ships3D: 'sc_ships3d', weapons3D: 'sc_weapons3d' });

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
  weapons3D: false,

  /** Wczytuje zapamiętany wybór (domyślnie 2D / 2D). */
  load() {
    this.ships3D = readFlag(KEYS.ships3D);
    this.weapons3D = readFlag(KEYS.weapons3D);
    return this;
  },

  /** kind: 'ships' | 'weapons'; on — 3D. Zapamiętuje wybór. */
  set(kind, on) {
    const field = kind === 'weapons' ? 'weapons3D' : 'ships3D';
    this[field] = !!on;
    writeFlag(KEYS[field], this[field]);
    return this;
  },

  /** Krótki opis wariantu (komunikat startu, raporty harnessu). */
  label() {
    return `statki ${this.ships3D ? '3D' : '2D'}, bronie ${this.weapons3D ? '3D' : '2D'}`;
  }
};
