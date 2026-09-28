// src/3d/hullDamageStamps.js
//
// STEMPLE MAPY RAN (zadanie 18-C, docs/webgpu/PROJEKT-BRONI.md §3.4) — parametry z wywołań
// `ctx.stamp(hull, x, y, r, heat, scorch, hole, ion, dx, dy, elong)` w recepturach dema broni
// (dema/bronie-webgpu/recipes.js, stan 3a0c5b2), zebrane w tabelę rodzin. Moduł bez three:
// dane + rozstrzygnięcie „rodzina broni → stempel” (czysty JS, testy w Node).
//
// Wpis stempla: [promień j. świata, żar (1 = pomarańcz, 3 = biel), osmalenie 0..1,
// przestrzelina 0..1 (kształt brzegu rany; > 0,52 z szumem = otwór), jony 0..1, wydłużenie
// wzdłuż kierunku (1 = koło), mnożyć promień przez moc rozmiaru broni (`20 * I` w recepturze)].
// Warianty: `impact` (trafienie), `kerf` (rzaz przebicia, co ~22 j. drogi w materiale),
// `exit` (krater wylotu przestrzeliny — demo go nie stempluje, 18-A robi prawdziwy krater:
// brzeg jak trafienie, mniejszy), `stuck` (zakleszczenie — Valkyrie).
//
// Tabela dotyczy KRATERÓW i RZAZÓW z haka trafienia kadłuba (HullBodies.onImpact → HullDamageMap),
// które nie przechodzą przez bramkę LOD efektu. Stemple bez krateru (wtórne wybuchy Yamato, znaki
// rzazu przebić, wiązka między taktami, żar płonącej wyrwy) biorą parametry wprost z receptur 17
// (`ctx.stamp` → HullDamageMap.stampRecipe).

/** Skala efektu z rozmiaru broni (dema/bronie-webgpu/arsenal.js: SIZE_POWER). */
export const STAMP_SIZE_POWER = Object.freeze({ S: 0.8, M: 1.0, L: 1.25, Capital: 1.6 });

/** Indeksy pól wpisu stempla. */
export const S_R = 0, S_HEAT = 1, S_SCORCH = 2, S_HOLE = 3, S_ION = 4, S_ELONG = 5, S_POW = 6;

const st = (r, heat, scorch, hole, ion, elong = 1, pow = 0) => Object.freeze([r, heat, scorch, hole, ion, elong, pow]);

/**
 * Tabela rodzin (klucze = rodziny receptur dema / WEAPON_FX[id].fx z zadania 17).
 * `rocket` i `generic` — tylko gra: rakiety do czasu receptur z zadania 19, trafienie bez źródła.
 */
export const STAMP = Object.freeze({
  tempest: Object.freeze({ impact: st(20, 2.6, 0.5, 0.62, 1.0, 1, 1) }),
  vulcan: Object.freeze({ impact: st(7, 1.5, 0.35, 0.3, 0) }),
  autocannon: Object.freeze({ impact: st(24, 2.4, 0.8, 0.64, 0, 1, 1) }),
  helios: Object.freeze({ impact: st(18, 2.9, 0.6, 0.5, 0, 1, 1) }),
  armata: Object.freeze({ impact: st(62, 3.2, 0.95, 0.76, 0) }),
  goliath: Object.freeze({ impact: st(48, 3.0, 0.9, 0.72, 0) }),
  yamato: Object.freeze({ impact: st(130, 3.6, 1.0, 0.9, 0.4) }),
  plasmaGatling: Object.freeze({ impact: st(34, 2.2, 0.55, 0.56, 0.8) }),
  hexlance: Object.freeze({ impact: st(70, 3.4, 1.0, 0.85, 0.2), kerf: st(34, 3.2, 0.9, 0.85, 0, 2.2) }),
  mjolnir: Object.freeze({ impact: st(80, 3.8, 1.0, 0.9, 0.5), kerf: st(38, 3.6, 1.0, 0.9, 0.2, 2.2), exit: st(56, 3.6, 1.0, 0.9, 0.3) }),
  valkyrie: Object.freeze({
    impact: st(40, 3.4, 0.9, 0.8, 0), kerf: st(18, 3.2, 0.8, 0.78, 0, 2.4),
    exit: st(28, 3.2, 0.85, 0.78, 0), stuck: st(40, 3.2, 0.9, 0.7, 0)
  }),
  // Wiązka ciągła: w demie stempel co klatkę × moc wiązki (0..1); w grze co trafienie (20 Hz).
  beamC: Object.freeze({ impact: st(11, 3.2, 0.12, 0.6, 0) }),
  beamP: Object.freeze({ impact: st(14, 3.0, 0.4, 0.6, 0) }),
  laserPD: Object.freeze({ impact: st(6, 2.2, 0.2, 0.3, 0) }),
  ciws: Object.freeze({ impact: st(4, 1.2, 0.25, 0.2, 0) }),
  // Promień: 0,2 × flakBurstRadius (recipes.js: `(p.flakR || 150) * 0.2`) — liczony w resolveStamp.
  flak: Object.freeze({ impact: st(30, 2.2, 0.8, 0.5, 0) }),
  rocket: Object.freeze({ impact: st(36, 3.0, 0.95, 0.7, 0.0) }),
  generic: Object.freeze({ impact: st(16, 2.4, 0.7, 0.55, 0) })
});

/** Broń gry → rodzina stempla (27 broni dema — kolumna `fx` tabeli WEAPON_FX zadania 17). */
export const WEAPON_STAMP_FAMILY = Object.freeze({
  special_yamato_cannon: 'yamato',
  hexlance_siege: 'hexlance',
  siege_railgun: 'mjolnir',
  special_valkyrie_railgun: 'valkyrie',
  special_goliath_autocannon: 'goliath',
  special_plasma_gatling: 'plasmaGatling',
  armata_mk1: 'armata',
  tempest_ion_l: 'tempest',
  helios_lance_l: 'helios',
  heavy_autocannon_l: 'autocannon',
  railgun_mk1: 'tempest',
  railgun_mk2: 'tempest',
  helios_laser: 'helios',
  vulcan_minigun: 'vulcan',
  heavy_autocannon: 'autocannon',
  beam_continuous: 'beamC',
  beam_pulse: 'beamP',
  tempest_ion_s: 'tempest',
  helios_laser_s: 'helios',
  gatling_s: 'vulcan',
  ciws_mk1: 'ciws',
  ciws_mk2: 'ciws',
  laser_pd_mk1: 'laserPD',
  flak_s: 'flak',
  flak_m: 'flak',
  flak_l: 'flak',
  flak_capital: 'flak'
});

/**
 * Rodzina z kategorii pocisku / broni (pociski spoza fireWeaponCore — CIWS, flak — nie mają
 * vfxKey). Jak `projectileFamilyFor` zadania 17; rakiety i torpedy → `rocket`, nieznane → `generic`.
 */
export function stampFamilyForType(type, beamMode = null) {
  switch (type) {
    case 'rail': return 'tempest';
    case 'ciws': return 'ciws';
    case 'flak': return 'flak';
    case 'autocannon': return 'autocannon';
    case 'plasma': return 'helios';
    case 'armata': return 'armata';
    case 'rocket':
    case 'torpedo': return 'rocket';
    case 'beam': return beamMode === 'continuous' ? 'beamC' : 'beamP';
    case 'superweapon': return 'hexlance';
    default: return 'generic';
  }
}

/**
 * Rodzina stempla ze źródła trafienia: id broni (string), pocisk gry (`vfxKey`, `type`) albo opis
 * broni z MASTER_WEAPONS (`id`, `category`, `beamMode`). Bez alokacji.
 */
export function stampFamilyFor(src) {
  if (!src) return 'generic';
  if (typeof src === 'string') return WEAPON_STAMP_FAMILY[src] || (STAMP[src] ? src : 'generic');
  const key = src.vfxKey || src.id || src.weaponId || null;
  if (key && WEAPON_STAMP_FAMILY[key]) return WEAPON_STAMP_FAMILY[key];
  return stampFamilyForType(src.type || src.category || null, src.beamMode || null);
}

/** Moc rozmiaru broni (S 0,8 … Capital 1,6) ze źródła; string / brak → 1. */
export function stampPowerFor(src) {
  if (!src || typeof src !== 'object') return 1;
  return STAMP_SIZE_POWER[src.weaponSize || src.size] || 1;
}

/** Promień rażenia flaku ze źródła (pocisk: flakBurstRadius; broń: flakBurstRadius) albo 0. */
export function stampFlakRadiusFor(src) {
  if (!src || typeof src !== 'object') return 0;
  return Number(src.flakBurstRadius) || 0;
}

/** Wpis stempla rodziny w wariancie (brak wariantu → impact; brak rodziny → generic). */
export function stampEntry(family, variant = 'impact') {
  const f = STAMP[family] || STAMP.generic;
  return f[variant] || f.impact;
}
