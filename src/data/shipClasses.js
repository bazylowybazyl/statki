// src/data/shipClasses.js
//
// KLASY OKRĘTÓW Z MOSTKA I RDZENIA (etap 2 stoczni z klocków — docs/PROPOZYCJA-KLASY-MOSTEK-RDZEN.md, przyjęta przez
// użytkownika 2026-10-21; plan docs/PLAN-KREATOR-STOCZNIA.md). Czyste dane i rachunek: bez three, DOM i stanu gry.
// Dziś czyta je kreator kadłubów (src/game/hullDesign/hullDesignClass.js, demo dema/kreator-kadluba-webgpu.html);
// gra przyjdzie w etapie 3 (bilans mocy na okręcie, napęd z zapasu mocy).
//
// ZASADY (decyzje użytkownika 2026-10-21):
//   • KLASA = POZIOM MOSTKA (I–VI). Mostek daje TWARDE limity: powierzchnia kadłuba, liczba gniazd (w tym ciężkich)
//     i największy rozmiar broni. Edytor nie pozwala ich przekroczyć.
//   • RDZEŃ = MOC [MW], limit MIĘKKI: moc pokrywa utrzymanie kadłuba (rośnie z powierzchnią — tak rdzeń wpływa na
//     kadłub), tarczę, broń i hangary. Urządzenia ponad moc są wyłączone według priorytetu (gracz go zmienia), zapas
//     mocy idzie w napęd: przyspieszenie × 0,7 (bez zapasu) … × 1,2 (zapas ≥ 40% mocy).
//   • Rdzeń najwyżej o poziom ponad mostek (komora rdzenia musi się zmieścić). Atlas jest poza drabiną (unikat
//     fabularny klasy VI) — tu go nie ma.
//
// GNIAZDA: typ jak w grze (SHIP_EDITOR_DEFAULTS / npcHardpointRuntime): main, aux, missile, special, hangar, builtin;
// rozmiar S / M / L / Capital (WEAPON_SIZES). „Ciężkie” = główne, specjalne, hangary i wbudowane; „lekkie” = pomocnicze
// i rakietowe.
//
// POBÓR GNIAZDA [MW]: przypisana broń → jej `energyCost` (src/data/weapons.js — pole dotąd niczym nie egzekwowane),
// gniazdo bez przypisanej broni → TYPOWA broń: mediana `energyCost` broni jego typu i rozmiaru (bez broni tylko-NPC
// i myśliwców; rozmiar bez broni → najbliższy mniejszy, potem większy), gniazdo puste (weapon '') → 0. Rakiety nie
// mają `energyCost` (zasila je amunicja) — wyrzutnia bierze MISSILE_MOUNT_MW (podajnik, naprowadzanie); hangar —
// mediana broni hangarowych (5).
//
// TARCZA (rozstrzygnięcie etapu 2): generator tarczy jest urządzeniem okrętu, nie modułem kreatora — pole obejmuje cały
// obrys, więc pobór rośnie z powierzchnią jak utrzymanie: SHIELD_UPKEEP_SHARE · utrzymanie. Stoi w kolejce priorytetów
// jak broń (domyślnie pierwszy), więc przy niedoborze da się go wyłączyć na rzecz broni.
//
// KALIBRACJA RDZENI (2026-10-21): moc poziomu = pobór wzoru / 0,8 (wzór na swoim rdzeniu ma ~20% zapasu), pobór wzoru
// = utrzymanie + tarcza + PRAWDZIWE domyślne uzbrojenie NPC (equipNpcWeapons w index.html: gniazda z edytora gry,
// najwyżej SHIPS[rama].spec na typ, broń frakcji; hangary NPC lotniskowca latają wszystkie). Tabela i obie wersje
// (propozycja / kalibracja) — docs/KREATOR-KADLUBA.md § „Klasy okrętów”; liczby pilnuje tests/shipClasses.test.mjs.

import { MASTER_WEAPONS, WEAPON_SIZES, WEAPON_SIZE_RANK } from './weapons.js';

/** Typy gniazd (kolejność = kolejność w panelu). */
export const MOUNT_SLOTS = Object.freeze(['main', 'aux', 'missile', 'special', 'hangar', 'builtin']);
/** Gniazda ciężkie (limit `heavyMax` klasy). */
export const HEAVY_SLOTS = Object.freeze(['main', 'special', 'hangar', 'builtin']);
export const MOUNT_SLOT_LABELS = Object.freeze({
  main: 'główne', aux: 'pomocnicze', missile: 'rakietowe', special: 'specjalne', hangar: 'hangar', builtin: 'wbudowane'
});
/** Rozmiary gniazd (= rozmiary broni). */
export const MOUNT_SIZES = WEAPON_SIZES;

/**
 * KLASY (mostek I–VI): limit powierzchni [j.²], gniazd (ciężkich), największy rozmiar broni i gniazda. Liczby z tabel
 * propozycji (wzór TN mieści się w limicie z zapasem na rozbudowę).
 */
export const SHIP_CLASSES = Object.freeze([
  Object.freeze({ level: 1, roman: 'I', id: 'frigate', label: 'Fregata', areaMax: 10000, mountsMax: 12, heavyMax: 7, weaponSize: 'S', example: 'Custos' }),
  Object.freeze({ level: 2, roman: 'II', id: 'destroyer', label: 'Niszczyciel', areaMax: 32000, mountsMax: 22, heavyMax: 13, weaponSize: 'M', example: 'Hasta' }),
  Object.freeze({ level: 3, roman: 'III', id: 'cruiser', label: 'Krążownik', areaMax: 90000, mountsMax: 26, heavyMax: 15, weaponSize: 'M', example: '' }),
  Object.freeze({ level: 4, roman: 'IV', id: 'battleship', label: 'Pancernik', areaMax: 200000, mountsMax: 38, heavyMax: 22, weaponSize: 'L', example: 'Bellator' }),
  Object.freeze({ level: 5, roman: 'V', id: 'capital', label: 'Kapitał', areaMax: 420000, mountsMax: 44, heavyMax: 26, weaponSize: 'L', example: 'Citadella' }),
  Object.freeze({ level: 6, roman: 'VI', id: 'supercapital', label: 'Superkapitał', areaMax: 900000, mountsMax: 60, heavyMax: 32, weaponSize: 'Capital', example: 'Colossus' })
]);
export const SHIP_CLASS_MAX = SHIP_CLASSES.length;

/**
 * POZIOMY RDZENIA (R1–R6): moc [MW] po kalibracji na domyślnych uzbrojeniach NPC (wzór — preset TN klasy, ~20% zapasu).
 * `proposal` — moc z propozycji (typowe uzbrojenie klasy z median, bez tarczy) — do porównania w dokumentacji.
 */
export const CORE_LEVELS = Object.freeze([
  Object.freeze({ level: 1, mw: 45, proposal: 65, example: 'Custos' }),
  Object.freeze({ level: 2, mw: 100, proposal: 180, example: 'Hasta' }),
  // krążownik bez kadłuba TN: średnia geometryczna R2 i R4
  Object.freeze({ level: 3, mw: 185, proposal: 280, example: '' }),
  Object.freeze({ level: 4, mw: 330, proposal: 450, example: 'Bellator' }),
  Object.freeze({ level: 5, mw: 450, proposal: 700, example: 'Citadella' }),
  // Colossus z promieniem śmierci (400 MW); bez niego wzór zajmuje ~44% mocy
  Object.freeze({ level: 6, mw: 1150, proposal: 1500, example: 'Colossus' })
]);

/** Utrzymanie kadłuba [MW] = k · powierzchnia^exp (Custos ~13, Bellator ~95, Colossus ~229). */
export const HULL_UPKEEP = Object.freeze({ k: 0.07, exp: 0.6 });
/** Tarcza: pobór = share · utrzymanie (pole obejmuje cały obrys). */
export const SHIELD_UPKEEP_SHARE = 0.5;
/** Wyrzutnia rakiet bez `energyCost` (amunicja) — podajnik i naprowadzanie [MW]. */
export const MISSILE_MOUNT_MW = 2;
/** Napęd z zapasu mocy: mnożnik przyspieszenia lo (zapas 0) … hi (zapas ≥ fullSpare mocy), liniowo. */
export const DRIVE_FROM_SPARE = Object.freeze({ lo: 0.7, hi: 1.2, fullSpare: 0.4 });
/** Zapas mocy wzoru na swoim rdzeniu (kalibracja: moc = pobór / (1 − share)). */
export const CORE_CALIBRATION_SPARE = 0.2;

/** Kategorie urządzeń w kolejce mocy (tarcza + typy gniazd) i kolejność domyślna (gracz ją zmienia). */
export const POWER_CATEGORIES = Object.freeze(['shield', ...MOUNT_SLOTS]);
export const POWER_PRIORITY_DEFAULT = Object.freeze(['shield', 'aux', 'main', 'special', 'builtin', 'missile', 'hangar']);
export const POWER_CATEGORY_LABELS = Object.freeze({ shield: 'tarcza', ...MOUNT_SLOT_LABELS });

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const clampLevel = (v) => clamp(Math.round(Number(v) || 1), 1, SHIP_CLASS_MAX);

export function shipClass(level) { return SHIP_CLASSES[clampLevel(level) - 1]; }
export function coreLevel(level) { return CORE_LEVELS[clampLevel(level) - 1]; }
/** Najwyższy poziom rdzenia dla mostka (komora rdzenia: najwyżej poziom ponad mostek). */
export function coreLevelMax(bridgeLevel) { return Math.min(SHIP_CLASS_MAX, clampLevel(bridgeLevel) + 1); }
export function isHeavySlot(slot) { return HEAVY_SLOTS.includes(slot); }
export function sizeRank(size) { return WEAPON_SIZE_RANK[size] || WEAPON_SIZE_RANK.M; }

export function hullUpkeepMW(area) { return HULL_UPKEEP.k * Math.pow(Math.max(0, Number(area) || 0), HULL_UPKEEP.exp); }
export function shieldMW(area) { return SHIELD_UPKEEP_SHARE * hullUpkeepMW(area); }

/** Mnożnik przyspieszenia z ułamka zapasu mocy (zapas / moc rdzenia). */
export function driveMultiplier(spareFrac) {
  const t = clamp((Number(spareFrac) || 0) / DRIVE_FROM_SPARE.fullSpare, 0, 1);
  return DRIVE_FROM_SPARE.lo + (DRIVE_FROM_SPARE.hi - DRIVE_FROM_SPARE.lo) * t;
}

/** Pobór broni [MW]: `energyCost`, rakieta bez niego — MISSILE_MOUNT_MW, nieznana — 0. */
export function weaponPowerMW(weaponId) {
  const w = MASTER_WEAPONS[weaponId];
  if (!w) return 0;
  const e = Number(w.energyCost);
  if (Number.isFinite(e) && e > 0) return e;
  return w.mountType === 'missile' || w.mountType === 'special_missile' ? MISSILE_MOUNT_MW : 0;
}

/** Typ gniazda, w którym broń się montuje (special_missile → special). */
export function weaponSlot(weaponId) {
  const t = MASTER_WEAPONS[weaponId]?.mountType;
  return t === 'special_missile' ? 'special' : t;
}

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) * 0.5;
};

/**
 * Typowy pobór gniazda [MW] na typ i rozmiar: mediana `energyCost` broni (bez tylko-NPC i myśliwców); rozmiar bez
 * broni → najbliższy mniejszy z bronią, potem większy; rakietowe — MISSILE_MOUNT_MW.
 */
export const TYPICAL_MOUNT_MW = (() => {
  const by = {};
  for (const w of Object.values(MASTER_WEAPONS)) {
    if (w.npcOnly || w.mountType === 'fighter') continue;
    const slot = w.mountType === 'special_missile' ? 'special' : w.mountType;
    const e = weaponPowerMW(w.id);
    if (!MOUNT_SLOTS.includes(slot) || !(e > 0) || !WEAPON_SIZE_RANK[w.size]) continue;
    ((by[slot] ||= {})[w.size] ||= []).push(e);
  }
  const out = {};
  for (const slot of MOUNT_SLOTS) {
    out[slot] = {};
    for (const size of MOUNT_SIZES) {
      if (slot === 'missile') { out[slot][size] = MISSILE_MOUNT_MW; continue; }
      const r = sizeRank(size);
      const order = [...MOUNT_SIZES].sort((a, b) => {
        const da = sizeRank(a) - r, db = sizeRank(b) - r;
        // najpierw ten sam, potem mniejsze (od najbliższego), potem większe
        const ka = da === 0 ? 0 : (da < 0 ? 1 - da * 0.01 : 2 + da), kb = db === 0 ? 0 : (db < 0 ? 1 - db * 0.01 : 2 + db);
        return ka - kb;
      });
      const hit = order.find((s) => by[slot]?.[s]?.length);
      out[slot][size] = hit ? median(by[slot][hit]) : 0;
    }
    Object.freeze(out[slot]);
  }
  return Object.freeze(out);
})();

/** Pobór gniazda [MW]: broń przypisana → jej pobór, '' → 0 (puste), brak pola → typowa broń typu i rozmiaru. */
export function mountPowerMW(slot, size, weapon) {
  if (weapon === '' || weapon === null) return 0;
  if (typeof weapon === 'string' && MASTER_WEAPONS[weapon]) return weaponPowerMW(weapon);
  return TYPICAL_MOUNT_MW[slot]?.[size] ?? 0;
}

/**
 * Czy broń wolno przypisać do gniazda: ten sam typ, rozmiar broni ≤ rozmiar gniazda (weaponFitsHardpointSize), bez broni
 * tylko-NPC (gracz jej nie dostanie — chyba że `npc`). Zwraca null albo powód (tekst).
 */
export function weaponMountIssue(weaponId, slot, size, { npc = false } = {}) {
  const w = MASTER_WEAPONS[weaponId];
  if (!w) return 'nieznana broń';
  if (weaponSlot(weaponId) !== slot) return `broń do gniazda ${MOUNT_SLOT_LABELS[weaponSlot(weaponId)] || w.mountType}, nie ${MOUNT_SLOT_LABELS[slot] || slot}`;
  if (sizeRank(w.size) > sizeRank(size)) return `broń ${w.size} za duża na gniazdo ${size}`;
  if (w.npcOnly && !npc) return 'broń tylko dla NPC';
  return null;
}

/** Bronie do gniazda (typ, rozmiar ≤ gniazdo, bez tylko-NPC) — lista id, od największego poboru. */
export function weaponsForMount(slot, size, { npc = false } = {}) {
  return Object.values(MASTER_WEAPONS)
    .filter((w) => !weaponMountIssue(w.id, slot, size, { npc }))
    .sort((a, b) => weaponPowerMW(b.id) - weaponPowerMW(a.id) || a.id.localeCompare(b.id))
    .map((w) => w.id);
}

/**
 * Kontrola limitów mostka (twardych) i rdzenia. `mounts` — [{ slot, size, weapon }]. Zwraca { cls, core, area, counts:
 * { mounts, heavy, bySlot, oversize (gniazda ponad rozmiar klasy), badWeapon (broń ponad rozmiar klasy) }, issues:
 * [{ code: 'area' | 'mounts' | 'heavy' | 'size' | 'weapon' | 'core', text }] }.
 */
export function shipClassCheck({ bridgeLevel, coreLevel: coreLv, area, mounts = [] }) {
  const cls = shipClass(bridgeLevel);
  const core = coreLevel(coreLv);
  const bySlot = {};
  let heavy = 0, oversize = 0, badWeapon = 0;
  for (const m of mounts) {
    bySlot[m.slot] = (bySlot[m.slot] || 0) + 1;
    if (isHeavySlot(m.slot)) heavy++;
    if (sizeRank(m.size) > sizeRank(cls.weaponSize)) oversize++;
    if (typeof m.weapon === 'string' && m.weapon && MASTER_WEAPONS[m.weapon] && sizeRank(MASTER_WEAPONS[m.weapon].size) > sizeRank(cls.weaponSize)) badWeapon++;
  }
  const issues = [];
  const fmt = (v) => Math.round(v).toLocaleString('pl-PL');
  if (area > cls.areaMax) issues.push({ code: 'area', text: `Powierzchnia ${fmt(area)} j² ponad limit mostka ${cls.roman} (${fmt(cls.areaMax)} j²).` });
  if (mounts.length > cls.mountsMax) issues.push({ code: 'mounts', text: `Gniazd ${mounts.length} ponad limit mostka ${cls.roman} (${cls.mountsMax}).` });
  if (heavy > cls.heavyMax) issues.push({ code: 'heavy', text: `Gniazd ciężkich ${heavy} ponad limit mostka ${cls.roman} (${cls.heavyMax}).` });
  if (oversize) issues.push({ code: 'size', text: `${oversize} gniazd większych niż ${cls.weaponSize} (mostek ${cls.roman}).` });
  if (badWeapon) issues.push({ code: 'weapon', text: `${badWeapon} broni większych niż ${cls.weaponSize} (mostek ${cls.roman}).` });
  if (core.level > coreLevelMax(cls.level)) issues.push({ code: 'core', text: `Rdzeń R${core.level} nie mieści się w kadłubie z mostkiem ${cls.roman} (najwyżej R${coreLevelMax(cls.level)}).` });
  return { cls, core, area, counts: { mounts: mounts.length, heavy, bySlot, oversize, badWeapon }, issues };
}

/** Najniższa klasa, w której mieści się powierzchnia, gniazda i ich rozmiar (poza drabiną → SHIP_CLASS_MAX). */
export function classForHull(area, mounts = []) {
  for (const c of SHIP_CLASSES) {
    if (!shipClassCheck({ bridgeLevel: c.level, coreLevel: c.level, area, mounts }).issues.length) return c.level;
  }
  return SHIP_CLASS_MAX;
}

/**
 * BILANS MOCY. `area` [j.²], `coreLevel`, `mounts` — [{ slot, size, weapon }] (kolejność = numer urządzenia), `shield`
 * (domyślnie true), `priority` — kolejność kategorii (POWER_PRIORITY_DEFAULT; brakujące na końcu). Utrzymanie zawsze
 * pierwsze; urządzenia w kolejce priorytetu (w kategorii — w kolejności gniazd) dostają moc, póki jej starcza —
 * urządzenie, które się nie mieści, jest wyłączone, mniejsze dalej w kolejce mogą się jeszcze zmieścić.
 * Zwraca { capacity, upkeep, shield, demand (urządzenia razem), used, spare, spareFrac, drive, deficit (popyt − moc po
 * utrzymaniu, ≥ 0), upkeepOver (utrzymanie > moc — wszystko wyłączone), devices: [{ i (−1 — tarcza), cat, mw, on }],
 * on: Uint8Array (gniazda z mocą, po numerach) }.
 */
export function shipPowerBalance({ area, coreLevel: coreLv, mounts = [], shield = true, priority = POWER_PRIORITY_DEFAULT }) {
  const capacity = coreLevel(coreLv).mw;
  const upkeep = hullUpkeepMW(area);
  const sh = shield ? shieldMW(area) : 0;
  const order = [...priority.filter((c) => POWER_CATEGORIES.includes(c))];
  for (const c of POWER_CATEGORIES) if (!order.includes(c)) order.push(c);
  const rank = Object.fromEntries(order.map((c, i) => [c, i]));
  const devices = [];
  if (shield) devices.push({ i: -1, cat: 'shield', mw: sh, on: false });
  mounts.forEach((m, i) => devices.push({ i, cat: m.slot, mw: mountPowerMW(m.slot, m.size, m.weapon), on: false }));
  const queue = devices.map((d, k) => k).sort((a, b) => (rank[devices[a].cat] - rank[devices[b].cat]) || (a - b));
  let avail = capacity - upkeep;
  const upkeepOver = avail < 0;
  let demand = 0, usedDev = 0;
  for (const k of queue) {
    const d = devices[k];
    demand += d.mw;
    if (!upkeepOver && d.mw <= avail + 1e-9) { d.on = true; avail -= d.mw; usedDev += d.mw; }
  }
  const on = new Uint8Array(mounts.length);
  for (const d of devices) if (d.i >= 0 && d.on) on[d.i] = 1;
  const used = upkeep + usedDev;
  const spare = Math.max(0, capacity - used);
  const spareFrac = capacity > 0 ? spare / capacity : 0;
  return {
    capacity, upkeep, shield: sh, demand, used, spare, spareFrac, drive: driveMultiplier(spareFrac),
    deficit: Math.max(0, demand - Math.max(0, capacity - upkeep)), upkeepOver, devices, on
  };
}
