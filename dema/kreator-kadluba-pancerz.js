// dema/kreator-kadluba-pancerz.js — wspólne operacje dema (Stocznia i Warsztat) na polach projektu `shell` (pancerz
// z obrysu, src/game/hullDesign/hullDesignShell.js) i `board` (układ maszynowni, src/game/hullDesign/hullDesignBoard.js).
// Czyste funkcje na obiekcie projektu: interfejs po zmianie woła requestBuild (w trakcie suwaka — fast, na koniec
// pełna budowa / commit).

import { HD_SHELL_LIMITS, HD_SHELL_RHYTHMS, HD_SHELL_RHYTHM_KEYS, axisTrench, normalizeHullShell } from '../src/game/hullDesign/hullDesignShell.js';
import { HD_BOARD_VARIANT_KEYS } from '../src/game/hullDesign/hullDesignSchema.js';

export { HD_SHELL_RHYTHMS, HD_SHELL_RHYTHM_KEYS, HD_SHELL_LIMITS, HD_BOARD_VARIANT_KEYS };

/** Etykiety rytmów i wariantów układu w interfejsie. */
export const SHELL_RHYTHM_LABELS = Object.freeze({ wzor: 'A · obwódka i wpusty', pasy: 'B · pasy wzdłuż burt', zebra: 'C · pasy i żebra' });
export const BOARD_VARIANT_LABELS = Object.freeze({ A: 'A · hierarchia', B: 'B · magistrale', C: 'C · płaska siatka', off: 'wył. (komórki)' });

/** Suwaki skorupy: klucz, etykieta, zakres, krok, odczyt i zapis (wartości w jd). */
export const SHELL_SLIDERS = Object.freeze([
  { k: 'rim', label: 'Obwódka', min: HD_SHELL_LIMITS.rim[0], max: 120, step: 1, get: (s) => s.rim, set: (s, v) => { s.rim = v; } },
  { k: 'bands', label: 'Pasy', min: 0, max: HD_SHELL_LIMITS.bands[1], step: 1, get: (s) => s.bands, set: (s, v) => { s.bands = Math.round(v); } },
  { k: 'ribStep', label: 'Żebra (krok)', min: 0, max: 300, step: 5, get: (s) => s.ribStep, set: (s, v) => { s.ribStep = v; } },
  { k: 'inset', label: 'Wpusty (krok)', min: 0, max: 900, step: 10, get: (s) => (s.inset ? s.inset.step : 0),
    set: (s, v) => { if (v <= 0) s.inset = null; else s.inset = { ...(s.inset || HD_SHELL_RHYTHMS.wzor.inset), step: v }; } }
]);

/** Pełne ustawienia skorupy projektu (po normalizacji) albo null. */
export function shellOf(d) { return normalizeHullShell(d?.shell); }

/** Włącz / wyłącz skorupę. Wyłączona skorupa zostaje w projekcie z `on: false` (ustawienia nie giną). */
export function shellToggle(d) {
  const cur = d.shell && d.shell.on !== false;
  d.shell = { ...(normalizeHullShell({ ...(d.shell || {}), on: true }) || {}), on: !cur };
  // siatka paneli wzdłuż osi to element łaty — na skorupie wyłączona, bez skorupy pełna (jak domyślnie)
  d.panels = cur ? 1 : 0;
  return !cur;
}

/** Rytm A / B / C: ustawienia rytmu od nowa (suwaki wracają do wartości rytmu). */
export function shellSetRhythm(d, rhythm) {
  const on = !(d.shell && d.shell.on === false);
  d.shell = { ...normalizeHullShell({ rhythm }), on };
}

/** Suwak skorupy `k` na wartość `v` (włącza skorupę). */
export function shellSetSlider(d, k, v) {
  const s = normalizeHullShell({ ...(d.shell || {}), on: true });
  const sl = SHELL_SLIDERS.find((q) => q.k === k);
  if (!sl) return;
  sl.set(s, Number(v));
  d.shell = { ...s, on: true };
}

/**
 * Rów wzdłuż osi dopasowany do kadłuba (pudło `bounds` pola ostatniej budowy): od ~15% długości od rufy do ~70%,
 * najszerszy w ~40% (pół-szerokość ~12% szerokości), stacje na siatce 2 × `grid`. Dokłada klocki-wycięcia poziomu 1
 * i włącza skorupę. Zwraca liczbę klocków.
 */
export function addAxisTrench(d, bounds) {
  if (!bounds) return 0;
  const g2 = 2 * (d.grid || 4);
  const q = (v) => Math.round(v / g2) * g2;
  const L = bounds.maxX - bounds.minX, B = bounds.maxY - bounds.minY;
  const x0 = bounds.minX + 0.15 * L, x1 = bounds.minX + 0.7 * L, hw = 0.12 * B;
  const st = [[q(x0), 0], [q(x0 + 0.08 * L), q(0.6 * hw)], [q(bounds.minX + 0.4 * L), q(hw)], [q(x1 - 0.12 * L), q(0.6 * hw)], [q(x1), 0]];
  const blocks = axisTrench(st);
  d.shapes = [...(d.shapes || []), ...blocks];
  if (!(d.shell && d.shell.on !== false)) shellToggle(d);
  return blocks.length;
}

/** Usuwa klocki-wycięcia poziomu 1 na osi (rów z `addAxisTrench`). */
export function removeAxisTrench(d) {
  const n = (d.shapes || []).length;
  d.shapes = (d.shapes || []).filter((s) => !(s.kind === 'block' && s.op === 'cut' && (s.level ?? 1) === 1 && s.y === 0));
  return n - d.shapes.length;
}

/** Układ maszynowni: wariant i świecenie (0–1). */
export function boardSet(d, patch) {
  const b = { variant: 'A', seed: 0, glow: d.npc ? 0.35 : 0, ...(d.board || {}) };
  if (patch.variant !== undefined && HD_BOARD_VARIANT_KEYS.includes(patch.variant)) b.variant = patch.variant;
  if (patch.glow !== undefined) b.glow = Math.max(0, Math.min(1, Number(patch.glow)));
  d.board = b;
}
export function boardOf(d) {
  const b = d?.board || {};
  return { variant: HD_BOARD_VARIANT_KEYS.includes(b.variant) ? b.variant : 'A', glow: Number.isFinite(b.glow) ? b.glow : (d?.npc ? 0.35 : 0) };
}
