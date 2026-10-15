export const DEFAULT_FIGHTER_SQUADRON_ID = 'multirole';

// Ile ESKADR mieści JEDEN hangar danego rozmiaru. Eskadra = squadSize maszyn
// (9 myśliwców, 6 bombowców / torpedowców, 4 kanonierki), więc pojemność 9 dawała
// absurdalne ~81 myśliwców na hangar. Zredukowane: hangar to zwykle 1 eskadra,
// duże/capital 2. (Tuning tutaj.)
export const HANGAR_SQUADRON_CAPACITY = Object.freeze({
  S: 1,
  M: 1,
  L: 2,
  Capital: 2
});

// ROLE (doktryny, 2026-10-14 — audyt docs/AUDYT-mysliwce-2026-10-14.md, prośba użytkownika: „rozdzielić
// bombowce i myśliwce; bombowiec przelatuje nad statkiem i zrzuca bomby NA statek, torpedowiec wypuszcza
// torpedy dolatujące w statek, kanonierki latające po orbicie”). Doktryna mówi mózgowi (src/ai/fighterAI.js),
// JAK maszyna walczy:
//   interceptor — myśliwiec przechwytujący: poluje na myśliwce, bombowce i torpedowce,
//   fighter     — myśliwiec wielozadaniowy: kocioł z myśliwcami, przeloty z działek nad okrętami,
//   strike      — myśliwiec szturmowy: przelot z salwą rakiet z dystansu,
//   bomber      — bombowiec: nalot NAD kadłubem celu, bomby spadają na pancerz pod maszyną,
//   torpedo     — torpedowiec: podejście z burty celu, torpeda z ~3 km, odwrót, przezbrojenie,
//   gunship     — kanonierka: orbita wokół celu, wieżyczka bije bez przerwy.
//
// LOT (src/game/flight/fighterFlight.js — pilot w każdym kroku fizyki): `flight.latAccel` = przeciążenie
// boczne [j/s²] (promień skrętu v² / latAccel), `flight.maxTurnDeg` = sufit tempa skrętu przy małej
// prędkości [°/s], `flight.rollAccel` = przyspieszenie kątowe [rad/s²] (jak szybko narasta skręt),
// `flight.decel` = hamowanie [j/s²]. Dawniej mózg obracał wektor prędkości o 280–450°/s przy 2400–3400 j/s
// (przeciążenie boczne do 22 tys. j/s² przy przyspieszeniu 2000) — zawrotka co ~1,3 s („szał”).
//
// SKALA PRĘDKOŚCI: Atlas walczy przy 500 j/s (dopalacz 1500, src/data/shipFlightSpecs.js), fregaty do
// 1400–1500. Myśliwiec ~1,6–2× fregata, bombowiec i kanonierka szybsze od dopalacza Atlasa (nadążają
// w eskorcie), wolniejsze od myśliwców (przechwytujący je dogania). `turn` [rad/s] — obrót kadłuba dla
// ścieżek spoza pilota (komendy RTS); pilot liczy go z `flight.maxTurnDeg`.
export const FIGHTER_SQUADRON_DEFS = Object.freeze({
  interceptor: Object.freeze({
    id: 'interceptor',
    name: 'Interceptor Squadron',
    role: 'Anti-fighter screen',
    doctrine: 'interceptor',
    squadSize: 9,
    hp: 80,
    accel: 2400,
    maxSpeed: 3000,
    turn: 5.2,
    radius: 12,
    mass: 0.8,
    separationRange: 30,
    weaponId: 'laser_pd_mk1',
    missileId: 'osa_micro_missile',
    missileAmmo: 6,
    color: '#8fdcff',
    flight: Object.freeze({ decel: 3200, latAccel: 7200, maxTurnDeg: 175, rollAccel: 11 })
  }),
  multirole: Object.freeze({
    id: 'multirole',
    name: 'Multirole Fighter Squadron',
    role: 'Balanced escort',
    doctrine: 'fighter',
    squadSize: 9,
    hp: 120,
    accel: 1900,
    maxSpeed: 2600,
    turn: 4.75,
    radius: 12,
    mass: 0.8,
    separationRange: 30,
    weaponId: 'ciws_mk1',
    missileId: 'osa_micro_missile',
    missileAmmo: 8,
    color: '#7cff91',
    flight: Object.freeze({ decel: 2600, latAccel: 6000, maxTurnDeg: 160, rollAccel: 9 })
  }),
  strike: Object.freeze({
    id: 'strike',
    name: 'Strike Fighter Squadron',
    role: 'Heavy attack wing',
    doctrine: 'strike',
    squadSize: 9,
    hp: 150,
    accel: 1600,
    maxSpeed: 2300,
    turn: 4.15,
    radius: 13,
    mass: 0.95,
    separationRange: 34,
    weaponId: 'ciws_mk2',
    missileId: 'fast_missile_rack',
    missileAmmo: 4,
    color: '#ffb86b',
    flight: Object.freeze({ decel: 2200, latAccel: 4800, maxTurnDeg: 140, rollAccel: 7.5 })
  }),
  bomber: Object.freeze({
    id: 'bomber',
    name: 'Bomber Squadron',
    role: 'Hull bombing runs',
    doctrine: 'bomber',
    squadSize: 6,
    hp: 320,
    accel: 1100,
    maxSpeed: 1800,
    turn: 2.8,
    radius: 16,
    mass: 1.6,
    separationRange: 46,
    // Działko w wieżyczce grzbietowej — tylko samoobrona przed myśliwcami (bez polowania).
    weaponId: 'ciws_mk1',
    // Bomby: zrzut, gdy maszyna jest NAD kadłubem celu (src/game/fighterBombs.js).
    missileId: 'fighter_bomb',
    missileAmmo: 6,
    color: '#ffd27a',
    flight: Object.freeze({ decel: 1600, latAccel: 2600, maxTurnDeg: 95, rollAccel: 4 })
  }),
  torpedo: Object.freeze({
    id: 'torpedo',
    name: 'Torpedo Bomber Squadron',
    role: 'Stand-off torpedo strikes',
    doctrine: 'torpedo',
    squadSize: 6,
    hp: 240,
    accel: 1400,
    maxSpeed: 2100,
    turn: 3.4,
    radius: 15,
    mass: 1.3,
    separationRange: 42,
    weaponId: 'ciws_mk1',
    missileId: 'aerial_torpedo',
    missileAmmo: 2,
    color: '#9effd8',
    flight: Object.freeze({ decel: 1900, latAccel: 3600, maxTurnDeg: 115, rollAccel: 5.5 })
  }),
  gunship: Object.freeze({
    id: 'gunship',
    name: 'Gunship Squadron',
    role: 'Orbiting fire support',
    doctrine: 'gunship',
    squadSize: 4,
    hp: 520,
    accel: 1100,
    maxSpeed: 1650,
    turn: 3.3,
    radius: 20,
    mass: 1.9,
    separationRange: 56,
    // Wieżyczka obrotowa (360°) — bije w cel orbity; rakiety Osa na myśliwce, które ją atakują.
    weaponId: 'gunship_autocannon',
    missileId: 'osa_micro_missile',
    missileAmmo: 4,
    color: '#ff9f7a',
    flight: Object.freeze({ decel: 1700, latAccel: 3200, maxTurnDeg: 110, rollAccel: 5 })
  })
});

/** Doktryny bez polowania na myśliwce (bombowiec, torpedowiec, kanonierka): cel = okręt. */
export const STRIKE_CRAFT_DOCTRINES = Object.freeze(new Set(['bomber', 'torpedo', 'gunship']));

export function getDefaultFighterSquadronId() {
  return DEFAULT_FIGHTER_SQUADRON_ID;
}

export function getFighterSquadronDef(id = DEFAULT_FIGHTER_SQUADRON_ID) {
  return FIGHTER_SQUADRON_DEFS[id] || FIGHTER_SQUADRON_DEFS[DEFAULT_FIGHTER_SQUADRON_ID];
}

/** Doktryna eskadry (`fighter` dla nieznanej). */
export function getFighterDoctrine(id) {
  return getFighterSquadronDef(id).doctrine || 'fighter';
}

export function getHangarSquadronCapacity(size) {
  return HANGAR_SQUADRON_CAPACITY[String(size || '').trim()] || HANGAR_SQUADRON_CAPACITY.S;
}

export function getHangarModuleIdForSquadron(squadronId = DEFAULT_FIGHTER_SQUADRON_ID) {
  const def = getFighterSquadronDef(squadronId);
  return `fighter_squad_${def.id}`;
}

export function getSquadronIdForHangarModule(moduleId) {
  const id = String(moduleId || '').trim();
  if (id === 'fighter_bay') return DEFAULT_FIGHTER_SQUADRON_ID;
  const prefix = 'fighter_squad_';
  if (!id.startsWith(prefix)) return null;
  const squadronId = id.slice(prefix.length);
  return FIGHTER_SQUADRON_DEFS[squadronId] ? squadronId : null;
}

export function normalizeHangarSquadronMounts(moduleIds, capacity = 1) {
  const cap = Math.max(0, Number(capacity) || 0);
  if (!Array.isArray(moduleIds) || cap <= 0) return [];

  const out = [];
  for (const moduleId of moduleIds) {
    const squadronId = getSquadronIdForHangarModule(moduleId);
    if (!squadronId) continue;
    out.push(getHangarModuleIdForSquadron(squadronId));
    if (out.length >= cap) break;
  }
  return out;
}

export function addHangarSquadronMount(moduleIds, moduleId, capacity = 1) {
  const current = normalizeHangarSquadronMounts(moduleIds, capacity);
  if (current.length >= Math.max(0, Number(capacity) || 0)) return current;

  const squadronId = getSquadronIdForHangarModule(moduleId);
  if (!squadronId) return current;

  current.push(getHangarModuleIdForSquadron(squadronId));
  return normalizeHangarSquadronMounts(current, capacity);
}
