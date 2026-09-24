// Stan chipów okrętu (katalog: src/data/chips.js).
//
// Gracz trzyma chipy per kadłub: `PLAYER.hullChips = { [hullId]: string[] }`
// (zapis w localStorage 'loadout'). NPC może mieć `entity.chips` (Set albo
// tablica) — domyślnie brak. Zapytania `chipListHas`/`hullHasChip` lecą z pętli
// broni (AI PD przy każdej decyzji, ciwsStep co krok fizyki), więc nie alokują.

import { CHIPS, CHIP_REMOVE_REFUND } from '../data/chips.js';

export function chipListHas(list, chipId) {
  if (!list || !chipId) return false;
  if (Array.isArray(list)) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] === chipId) return true;
    }
    return false;
  }
  if (typeof list.has === 'function') return list.has(chipId) === true;
  return false;
}

export function hullHasChip(hullChips, hullId, chipId) {
  if (!hullChips || !hullId) return false;
  return chipListHas(hullChips[hullId], chipId);
}

// Odczyt zapisu: tylko znane chipy, bez duplikatów, puste kadłuby wypadają.
// `isValidHull` odrzuca klucze kadłubów, których gra już nie zna — bez tego
// chip z usuniętego kadłuba wisiałby w zapisie na zawsze.
export function normalizeHullChips(raw, { catalog = CHIPS, isValidHull = null } = {}) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const hullId of Object.keys(raw)) {
    if (typeof isValidHull === 'function' && !isValidHull(hullId)) continue;
    const list = raw[hullId];
    if (!Array.isArray(list)) continue;
    const clean = [];
    for (let i = 0; i < list.length; i++) {
      const chipId = list[i];
      if (typeof chipId !== 'string' || !catalog[chipId]) continue;
      if (!clean.includes(chipId)) clean.push(chipId);
    }
    if (clean.length) out[hullId] = clean;
  }
  return out;
}

// Zapis: kopia bez pustych list (to samo co odczyt — format jest jeden).
export function serializeHullChips(hullChips, opts) {
  return normalizeHullChips(hullChips, opts);
}

export function installHullChip(hullChips, hullId, chipId) {
  if (!hullChips || !hullId || !CHIPS[chipId]) return false;
  const list = hullChips[hullId] || (hullChips[hullId] = []);
  if (list.includes(chipId)) return false;
  list.push(chipId);
  return true;
}

export function removeHullChip(hullChips, hullId, chipId) {
  const list = hullChips?.[hullId];
  if (!Array.isArray(list)) return false;
  const idx = list.indexOf(chipId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  if (list.length === 0) delete hullChips[hullId];
  return true;
}

// Zwrot za zdjęcie chipa. Chip postawiony za darmo (tryb ?dev) nie oddaje
// kredytów — inaczej instaluj/zdejmij drukowałoby pieniądze.
export function chipRemovalRefund(chipDef, { freeInstall = false } = {}) {
  if (!chipDef || freeInstall) return 0;
  return Math.floor((Number(chipDef.cost) || 0) * CHIP_REMOVE_REFUND);
}
