const DEFAULT_BATTLESHIP_IDEAL_RANGE = 1200;
const CAPITAL_CLEARANCE_MARGIN = 520;

// Czas lotu pocisku, przy którym manewrujący cel jeszcze nie zdąży uciec z toru.
// Nominalny zasięg broni jest dalej fikcją: armata 2500 u/s na 7000 u leci
// 2,8 s, a fregata robi w tym czasie kilka kilometrów. Starsectorowe AI
// trzyma się dystansu, z którego TRAFIA, nie z którego pocisk w ogóle doleci.
export const AI_EFFECTIVE_TIME_OF_FLIGHT = 1.0;

// Osobowości w duchu Starsectora. `rangeMul` skaluje skuteczny zasięg baterii
// głównej. `holdFrac` to pasmo trzymania: okręt podchodzi, gdy wróg jest dalej
// niż dystans bojowy, ale cofa się dopiero, gdy wróg wejdzie bliżej niż
// holdFrac × dystans — bez pasma snajper (railgun, 5,6 km) cofał się przed
// każdym brawlerem (armata, 1,6 km) i bitwa dryfowała przez pół mapy
// (zmierzone: ~40 km w 90 s). `backoff*` to progi „presji" (odpowiednik
// fluxu): poniżej nich okręt odchodzi na `backoffRangeMul` × dystans i wraca
// dopiero, gdy tarcza odbuduje się do `recoverShield` (histereza).
export const AI_PERSONALITIES = Object.freeze({
  timid: Object.freeze({ rangeMul: 1.0, holdFrac: 0.8, backoffShield: 0.6, recoverShield: 0.95, backoffHull: 0.6, backoffRangeMul: 1.5 }),
  cautious: Object.freeze({ rangeMul: 0.9, holdFrac: 0.6, backoffShield: 0.45, recoverShield: 0.85, backoffHull: 0.45, backoffRangeMul: 1.4 }),
  steady: Object.freeze({ rangeMul: 0.7, holdFrac: 0.25, backoffShield: 0.3, recoverShield: 0.7, backoffHull: 0.3, backoffRangeMul: 1.3 }),
  aggressive: Object.freeze({ rangeMul: 0.65, holdFrac: 0.2, backoffShield: 0.15, recoverShield: 0.5, backoffHull: 0.2, backoffRangeMul: 1.2 }),
  reckless: Object.freeze({ rangeMul: 0.5, holdFrac: 0.1, backoffShield: 0, recoverShield: 0, backoffHull: 0, backoffRangeMul: 1.0 })
});

// Pasmo trzymania w walce. Zwraca { range, holding }:
//  - wróg dalej niż dystans bojowy → range = dystans bojowy (podejdź),
//  - wróg w paśmie [holdFrac × dystans, dystans] → range = obecny dystans,
//    holding = true: STÓJ (prędkość odniesienia 0) i pozwól mu podejść —
//    dopasowanie prędkości goniącego to też ucieczka,
//  - bliżej → range = dolna granica pasma (cofnij się, powoli, dziobem do wroga).
// Pod presją (odwrót) pasmo nie działa: pełny dystans odwrotu. `minRange` —
// podłoga na kadłuby (żeby „trzymanie" nie skończyło się taranem).
export function resolveHoldRange(currentDist, idealRange, personality, pressureMul = 1, minRange = 0) {
  const ideal = finitePositive(idealRange) || DEFAULT_BATTLESHIP_IDEAL_RANGE;
  if (pressureMul > 1) return { range: ideal * pressureMul, holding: false };
  const lo = Math.min(ideal, Math.max(ideal * (Number(personality?.holdFrac) || 0.25), finitePositive(minRange)));
  const d = Number(currentDist);
  if (!Number.isFinite(d) || d > ideal) return { range: ideal, holding: false };
  if (d < lo) return { range: lo, holding: false };
  return { range: d, holding: true };
}

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return n < 0 ? 0 : (n > 1 ? 1 : n);
}

// Jawne `npc.aiPersonality` wygrywa; domyślnie piraci są agresywni,
// lotniskowce ostrożne (trzymają się za linią), reszta pewna siebie.
export function resolveAiPersonalityId(npc) {
  const explicit = String(npc?.aiPersonality || '').toLowerCase();
  if (AI_PERSONALITIES[explicit]) return explicit;
  if (npc?.isPirate) return 'aggressive';
  if (String(npc?.type || '').toLowerCase().includes('carrier')) return 'cautious';
  return 'steady';
}

export function resolveAiPersonality(npc) {
  return AI_PERSONALITIES[resolveAiPersonalityId(npc)];
}

// Skuteczny zasięg jednej broni: nominalny, ale nie dalej, niż pocisk doleci
// w AI_EFFECTIVE_TIME_OF_FLIGHT. Wiązki (prędkość Infinity) — pełny zasięg.
export function effectiveWeaponRange(def, timeOfFlight = AI_EFFECTIVE_TIME_OF_FLIGHT) {
  const range = finitePositive(def?.baseRange ?? def?.range);
  if (!range) return 0;
  const speed = Number(def?.baseSpeed ?? def?.speed);
  if (!Number.isFinite(speed) || speed <= 0) return range;
  return Math.min(range, speed * timeOfFlight);
}

// Zasięg baterii głównej: mediana skutecznych zasięgów broni `main` — jedna
// odstająca lufa nie przestawia całego okrętu. Cache na npc (lista broni zmienia
// się tylko przy przezbrojeniu).
export function resolveMainBatteryRange(npc) {
  const main = npc?.weapons?.main;
  if (!Array.isArray(main) || main.length === 0) return 0;
  if (npc.__mainRangeSrc === main && npc.__mainRangeN === main.length) return npc.__mainRangeVal;
  const ranges = [];
  for (let i = 0; i < main.length; i++) {
    const entry = main[i];
    if (!entry || entry.hp?.destroyed) continue;
    const r = effectiveWeaponRange(entry.weapon);
    if (r > 0) ranges.push(r);
  }
  ranges.sort((a, b) => a - b);
  const value = ranges.length ? ranges[(ranges.length - 1) >> 1] : 0;
  npc.__mainRangeSrc = main;
  npc.__mainRangeN = main.length;
  npc.__mainRangeVal = value;
  return value;
}

// Dystans bojowy. Kolejność: jawne `engageRange` > bateria główna × osobowość >
// stare pola (broadsideRange / preferredRange / weaponRange) dla bytów bez listy
// broni > domyślne 1200. Zawsze z podłogą na promienie obu kadłubów.
export function resolveCapitalIdealRange(npc, target = null) {
  let configured = finitePositive(npc?.engageRange);
  if (!configured) {
    const battery = resolveMainBatteryRange(npc);
    if (battery > 0) configured = battery * resolveAiPersonality(npc).rangeMul;
  }
  if (!configured) {
    configured =
      finitePositive(npc?.broadsideRange) ||
      finitePositive(npc?.preferredRange) ||
      finitePositive(npc?.weaponRange) ||
      DEFAULT_BATTLESHIP_IDEAL_RANGE;
  }

  const selfRadius = finitePositive(npc?.radius);
  const targetRadius = finitePositive(target?.radius ?? target?.r);
  const clearanceFloor = selfRadius + targetRadius + CAPITAL_CLEARANCE_MARGIN;

  return Math.max(configured, clearanceFloor || DEFAULT_BATTLESHIP_IDEAL_RANGE);
}

// Presja bojowa (flux w Starsectorze): zwraca mnożnik dystansu. Osłabiona
// tarcza albo kadłub każą odejść, powrót dopiero po odbudowie tarczy.
export function updateCombatPressure(npc, personality = resolveAiPersonality(npc)) {
  if (!npc) return 1;
  const shield = npc.shield;
  const shieldFrac = shield && Number(shield.max) > 0 ? clamp01(shield.val / shield.max) : 1;
  const hullFrac = Number(npc.maxHp) > 0 ? clamp01(npc.hp / npc.maxHp) : 1;
  const hullLow = personality.backoffHull > 0 && hullFrac < personality.backoffHull;
  let backing = npc.__aiBackingOff === true;
  if (!backing) {
    backing = hullLow || (personality.backoffShield > 0 && shieldFrac < personality.backoffShield);
  } else if (!hullLow && shieldFrac >= personality.recoverShield) {
    backing = false;
  }
  npc.__aiBackingOff = backing;
  return backing ? personality.backoffRangeMul : 1;
}

export function resolveCapitalOrbitStrafe({ distance, idealRange, orbitDir }) {
  const d = finitePositive(distance);
  const range = finitePositive(idealRange) || DEFAULT_BATTLESHIP_IDEAL_RANGE;
  const dir = Number(orbitDir) >= 0 ? 1 : -1;

  if (d < range * 0.85) return 0.4 * dir;
  if (d > range * 1.15) return -0.4 * dir;
  return 0;
}
