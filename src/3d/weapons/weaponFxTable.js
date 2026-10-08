// src/3d/weapons/weaponFxTable.js
//
// Tabela efektów broni (port katalogu dema `dema/bronie-webgpu/arsenal.js`, zadanie 17):
// która RODZINA receptur (src/3d/weapons/recipes.js) obsługuje daną broń z MASTER_WEAPONS
// i jakim wzorcem strzela. Statystyki (prędkość, kadencja, rozrzut, zasięg, salwy) gra
// czyta z MASTER_WEAPONS jak dotąd — tabela opisuje wyłącznie obraz.
//
// Pola wpisu:
//   fx      — rodzina receptury (klucz RECIPES)
//   pattern — sposób strzału w demie: single | twin | alt | yamato | salvo | beam | charge |
//             pdbeam (w grze strzał, lufy i kadencję prowadzi logika gry; pole zostaje dla
//             galerii harnessu i opisu)
//   charge  — czas ładowania efektu [s] (Hexlance 1,2 s, Mjolnir 3 s, Valkyrie 0,28 s —
//             mechanikę ładowania wpina 18-B)
//   pd      — broń obrony punktowej
//   short   — krótka nazwa (galeria harnessu)
//
// Pocisk bez broni w tabeli (rakiety w ścieżce 2D, stare klucze) dostaje rodzinę po `type`
// (`projectileFamilyFor`) — fallback z PROJEKT-BRONI §1.2 F.

import { MASTER_WEAPONS } from '../../data/weapons.js';

const W = (fx, pattern, extra = null) => Object.freeze({ fx, pattern, charge: 0, pd: false, short: '', ...(extra || {}) });

/**
 * 27 broni z dema (działa Capital / L / M / S, wiązki, obrona punktowa) + 3 warianty rozmiarowe
 * broni specjalnej (Kolec S, Oszczep M, Yamato L — rodziny rodziców) + 2 działa main klasy
 * snajperskiej (Lanca M / L, 2026-10-08 — receptura Valkyrie, bez ładowania).
 */
export const WEAPON_FX = Object.freeze({
  // Capital / specjalne
  special_yamato_cannon: W('yamato', 'yamato', { short: 'Yamato' }),
  hexlance_siege: W('hexlance', 'charge', { charge: 1.2, short: 'Hexlance' }),
  siege_railgun: W('mjolnir', 'charge', { charge: 3.0, short: 'Mjolnir' }),
  special_valkyrie_railgun: W('valkyrie', 'charge', { charge: 0.28, short: 'Valkyrie' }),
  special_goliath_autocannon: W('goliath', 'alt', { short: 'Goliath' }),
  special_plasma_gatling: W('plasmaGatling', 'single', { short: 'Plasma Gatling' }),
  // warianty rozmiarowe broni specjalnej (S / M / L) — receptury rodziców, bez nowych rodzin
  special_yamato_l: W('yamato', 'twin', { short: 'Yamato L' }),
  special_valkyrie_m: W('valkyrie', 'charge', { charge: 0.25, short: 'Oszczep' }),
  special_valkyrie_s: W('valkyrie', 'charge', { charge: 0.2, short: 'Kolec' }),
  // L
  armata_mk1: W('armata', 'single', { short: 'Armata' }),
  tempest_ion_l: W('tempest', 'single', { short: 'Tempest L' }),
  helios_lance_l: W('helios', 'alt', { short: 'Helios Lance' }),
  heavy_autocannon_l: W('autocannon', 'single', { short: 'Autokanon L' }),
  lance_rail_l: W('valkyrie', 'single', { short: 'Lanca L' }),
  // M
  lance_rail_m: W('valkyrie', 'single', { short: 'Lanca' }),
  railgun_mk1: W('tempest', 'single', { short: 'Tempest Mk I' }),
  railgun_mk2: W('tempest', 'twin', { short: 'Tempest Mk II' }),
  helios_laser: W('helios', 'alt', { short: 'Helios' }),
  vulcan_minigun: W('vulcan', 'single', { short: 'Vulcan' }),
  heavy_autocannon: W('autocannon', 'single', { short: 'Autokanon' }),
  beam_continuous: W('beamC', 'beam', { short: 'Wiązka ciągła' }),
  beam_pulse: W('beamP', 'alt', { short: 'Wiązka puls' }),
  // S
  tempest_ion_s: W('tempest', 'single', { short: 'Tempest S' }),
  helios_laser_s: W('helios', 'alt', { short: 'Helios S' }),
  gatling_s: W('vulcan', 'single', { short: 'Gatling S' }),
  // obrona punktowa
  ciws_mk1: W('ciws', 'single', { pd: true, short: 'CIWS Mk I' }),
  ciws_mk2: W('ciws', 'single', { pd: true, short: 'CIWS Mk II' }),
  laser_pd_mk1: W('laserPD', 'pdbeam', { pd: true, short: 'Helios PD' }),
  flak_s: W('flak', 'salvo', { pd: true, short: 'Flak S' }),
  flak_m: W('flak', 'salvo', { pd: true, short: 'Flak M' }),
  flak_l: W('flak', 'salvo', { pd: true, short: 'Flak L' }),
  flak_capital: W('flak', 'salvo', { pd: true, short: 'Flak Perun' })
});

/** Kategorie MASTER_WEAPONS poza zakresem efektów broni (rakiety — zadanie 19, hangary). */
export const WEAPON_FX_EXCLUDED_CATEGORIES = Object.freeze(new Set(['rocket', 'torpedo', 'hangar']));

/**
 * Rodziny, których pociski zostawiają smugę gazu (TrailSystem, trails.js). Decyzja użytkownika
 * 2026-10-04: zwykłe pociski NIE zostawiają śladu. Receptury z dema (zadanie 17) dawały smugę 10
 * rodzinom (Tempest, Helios, autokanony, Armata, Goliath, Yamato, Plasma Gatling, Valkyrie…) —
 * przed portem miały ją tylko Yamato i Hexlance. Zostają pojedyncze, ładowane strzały superbroni:
 * Hexlance (smuga z gry od zawsze) i Mjolnir (kanał plazmy po 3 s ładowania).
 */
export const TRAIL_FAMILIES = Object.freeze(new Set(['hexlance', 'mjolnir']));

/** Skala efektu z rozmiaru broni (poza skalą wieżyczki) — S lżej, Capital ciężej (demo). */
export const SIZE_POWER = Object.freeze({ S: 0.8, M: 1.0, L: 1.25, Capital: 1.6 });

/** Wpis tabeli dla id broni (null — broń spoza tabeli). */
export function weaponFxFor(weaponId) {
  if (!weaponId) return null;
  return WEAPON_FX[weaponId] || null;
}

/** Definicja broni (MASTER_WEAPONS) — tabela jej nie kopiuje. */
export function weaponDefFor(weaponId) {
  return (weaponId && MASTER_WEAPONS[weaponId]) || null;
}

/**
 * Rodzina efektu pocisku: po broni (`vfxKey`), a bez niej po `type` pocisku
 * (PROJEKT-BRONI §1.2 F: rail → tempest, ciws, flak, autocannon, plasma → helios,
 * armata, brak → vulcan). Rakiety i torpedy w tablicy `bullets` (ścieżka 2D, Osa,
 * torpedy) nie mają receptury — null.
 */
export function projectileFamilyFor(bullet) {
  const entry = WEAPON_FX[bullet?.vfxKey];
  if (entry) return entry.fx;
  switch (bullet?.type) {
    case 'rail': return 'tempest';
    case 'ciws': return 'ciws';
    case 'flak': return 'flak';
    case 'autocannon': return 'autocannon';
    case 'plasma': return 'helios';
    case 'armata': return 'armata';
    case 'rocket':
    case 'torpedo': return null;
    default: return 'vulcan';
  }
}

/**
 * Barwa HDR z CSS (`#rgb`, `#rrggbb`, `rgb(…)`, `rgba(…)`) → liniowo × k, do `out`
 * (bez alokacji, gdy `out` podany). Parser `rgba(...)` dla `laser_pd_mk1` (vfxColor
 * `rgba(110,200,255,0.9)` — PROJEKT-BRONI §1.1). Nierozpoznana → biel.
 */
export function hexHdr(css, k = 1, out = [1, 1, 1]) {
  const s = String(css || '').trim();
  let r = 255, g = 255, b = 255;
  if (s.charCodeAt(0) === 35) { // '#'
    const h = s.slice(1);
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16);
    } else if (h.length >= 6) {
      const v = parseInt(h.slice(0, 6), 16);
      r = (v >> 16) & 255; g = (v >> 8) & 255; b = v & 255;
    }
  } else {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
    if (m) { r = Number(m[1]); g = Number(m[2]); b = Number(m[3]); }
  }
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) { r = 255; g = 255; b = 255; }
  const lin = (c) => { c = Math.max(0, Math.min(255, c)) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  out[0] = lin(r) * k;
  out[1] = lin(g) * k;
  out[2] = lin(b) * k;
  return out;
}

/** Wszystkie id broni z efektami z dema (kolejność galerii jak w demie). */
export const WEAPON_FX_IDS = Object.freeze(Object.keys(WEAPON_FX));
