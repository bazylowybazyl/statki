// src/game/shipModifiers.js
//
// Modyfikatory okrętu `entity.modifiers` składane ze ŹRÓDEŁ (iloczyn pól): system F ('system' — szybki ogień,
// src/game/shipSystem.js), fitowanie ('fit' — moduły), … Gra czyta `entity.modifiers` w wielu miejscach
// (fireWeaponCore — każdy strzelec, zasięg broni gracza, kierowanie ogniem, torpedy, wiązka ciągła, przeładowanie
// dział NPC w capitalAI). NIE przypisuj `entity.modifiers` wprost — tylko przez setModifierSource /
// clearModifierSource, inaczej źródła nadpisują się nawzajem. Czysty moduł (bez DOM i gry).
//
// Pola (mnożniki, 1 = bez zmian):
//   range           — zasięg broni
//   damage          — obrażenia
//   projectileSpeed — prędkość pocisków
//   fireRate        — PRZEŁADOWANIE: mnoży cooldown (< 1 = szybciej; fireWeaponCore: cd = cooldown × fireRate).
//                     Szybkostrzelność ×k (k > 1 — szybciej) zapisuj jako fireRate = fireRateModifier(k) = 1 / k.
// Przeliczenie tylko przy zmianie źródła (rekordy źródeł i obiekt `modifiers` pamiętane na encji — bez alokacji
// w krokach gry).

export const MODIFIER_FIELDS = Object.freeze(['range', 'damage', 'projectileSpeed', 'fireRate']);

/** Mnożnik przeładowania (pole fireRate) dla szybkostrzelności ×rateMul (rateMul > 1 — szybciej). */
export function fireRateModifier(rateMul) {
  const k = Number(rateMul);
  return k > 0 ? 1 / k : 1;
}

/** Mnożnik przeładowania encji (1 — bez modyfikatorów). */
export function modifierFireRate(entity) {
  const f = Number(entity?.modifiers?.fireRate);
  return f > 0 ? f : 1;
}

/**
 * Źródło modyfikatorów `source` encji = pola `mods` (brakujące = 1). Zwraca true, gdy `entity.modifiers` się zmieniło.
 */
export function setModifierSource(entity, source, mods) {
  if (!entity || !source) return false;
  const all = entity.__modSources || (entity.__modSources = Object.create(null));
  let rec = all[source];
  if (!rec) rec = all[source] = { on: false, range: 1, damage: 1, projectileSpeed: 1, fireRate: 1 };
  let changed = !rec.on;
  for (let i = 0; i < MODIFIER_FIELDS.length; i++) {
    const f = MODIFIER_FIELDS[i];
    const raw = mods ? Number(mods[f]) : NaN;
    const v = raw > 0 ? raw : 1;
    if (rec[f] !== v) {
      rec[f] = v;
      changed = true;
    }
  }
  rec.on = true;
  if (changed) recompute(entity);
  return changed;
}

/** Zdejmuje źródło `source`. Zwraca true, gdy było założone. */
export function clearModifierSource(entity, source) {
  const rec = entity?.__modSources?.[source];
  if (!rec || !rec.on) return false;
  rec.on = false;
  recompute(entity);
  return true;
}

/** Pola źródła `source` (rekord tylko do odczytu) albo null, gdy nie założone. */
export function modifierSource(entity, source) {
  const rec = entity?.__modSources?.[source];
  return rec && rec.on ? rec : null;
}

function recompute(entity) {
  const out = entity.modifiers && typeof entity.modifiers === 'object'
    ? entity.modifiers
    : (entity.modifiers = { range: 1, damage: 1, projectileSpeed: 1, fireRate: 1 });
  for (let i = 0; i < MODIFIER_FIELDS.length; i++) out[MODIFIER_FIELDS[i]] = 1;
  let classRange = null;
  let classSpeed = null;
  let cap = 0;
  const all = entity.__modSources;
  for (const key in all) {
    const rec = all[key];
    if (!rec.on) continue;
    for (let i = 0; i < MODIFIER_FIELDS.length; i++) {
      const f = MODIFIER_FIELDS[i];
      out[f] *= rec[f];
    }
    if (rec.classRange) classRange = mergeClassMul(classRange, rec.classRange);
    if (rec.classProjectileSpeed) classSpeed = mergeClassMul(classSpeed, rec.classProjectileSpeed);
    if (rec.rangeCap > 0) cap = cap > 0 ? Math.min(cap, rec.rangeCap) : rec.rangeCap;
  }
  // Mnożniki klas trzymane obok `modifiers` (kształt `modifiers` = same pola skalarne — kontrakt z systemem F).
  if (classRange || classSpeed || cap > 0 || entity.__modClasses) {
    const cls = entity.__modClasses || (entity.__modClasses = { range: null, projectileSpeed: null, rangeCap: 0 });
    cls.range = classRange;
    cls.projectileSpeed = classSpeed;
    cls.rangeCap = cap;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Mnożniki per KLASA broni (fitowanie, docs/PLAN-fitowanie.md § 4.3–4.4): źródło może dodać
//   classRange           — { klasa: mnożnik zasięgu } dla broni z `weaponClass` (weapons.js), np. { sniper: 1,5 }
//   classProjectileSpeed — { klasa: mnożnik prędkości pocisku }
//   rangeCap             — sufit zasięgu po premii klasy [j.] (broń dłuższa z natury nie rośnie i nie maleje)
// Złożone ze źródeł trafiają do `entity.__modClasses` ({ range, projectileSpeed, rangeCap }); czyta je weaponRangeFor /
// weaponSpeedMul (fireWeaponCore, zasięg gracza, okręgi zasięgu) — bez alokacji.
// ---------------------------------------------------------------------------------------------------------------

function mergeClassMul(acc, add) {
  const out = acc || Object.create(null);
  for (const cls in add) {
    const v = Number(add[cls]);
    if (!(v > 0)) continue;
    out[cls] = (out[cls] || 1) * v;
  }
  return out;
}

function sameClassMul(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  for (const k in a) if (a[k] !== b[k]) return false;
  for (const k in b) if (a[k] !== b[k]) return false;
  return true;
}

function cleanClassMul(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let out = null;
  for (const cls in raw) {
    const v = Number(raw[cls]);
    if (v > 0 && v !== 1) (out || (out = Object.create(null)))[cls] = v;
  }
  return out;
}

/**
 * Jak setModifierSource, ale z polami per klasa broni (classRange, classProjectileSpeed, rangeCap) — źródło 'fit'
 * modułu okrętu. Pola skalarne (range, damage, …) jak w setModifierSource. Zwraca true, gdy coś się zmieniło.
 */
export function setModifierSourceWithClasses(entity, source, mods) {
  if (!entity || !source) return false;
  let changed = setModifierSource(entity, source, mods);
  const rec = entity.__modSources[source];
  const cr = cleanClassMul(mods?.classRange);
  const cs = cleanClassMul(mods?.classProjectileSpeed);
  const cap = Number(mods?.rangeCap) > 0 ? Number(mods.rangeCap) : 0;
  if (!sameClassMul(rec.classRange, cr) || !sameClassMul(rec.classProjectileSpeed, cs) || (rec.rangeCap || 0) !== cap) {
    rec.classRange = cr;
    rec.classProjectileSpeed = cs;
    rec.rangeCap = cap;
    recompute(entity);
    changed = true;
  }
  return changed;
}

/** Mnożnik zasięgu broni `def` dla encji: pole ogólne × pole klasy broni. */
export function weaponRangeMul(entity, def) {
  const m = entity?.modifiers;
  if (!m) return 1;
  const base = Number(m.range) > 0 ? m.range : 1;
  const cls = def?.weaponClass;
  const k = entity.__modClasses;
  const c = cls && k?.range ? (k.range[cls] || 1) : 1;
  return base * c;
}

/**
 * Zasięg broni `def` na encji: `baseRange` × mnożniki; premia klasy przycięta sufitem `rangeCap` (nigdy poniżej
 * zasięgu bez premii klasy — Mjolnir 20 km zostaje 20 km przy suficie 18 km).
 */
export function weaponRangeFor(entity, def, baseRange) {
  const r0 = Number(baseRange) || 0;
  const m = entity?.modifiers;
  if (!m) return r0;
  const general = r0 * (Number(m.range) > 0 ? m.range : 1);
  const cls = def?.weaponClass;
  const k = entity.__modClasses;
  const c = cls && k?.range ? (k.range[cls] || 1) : 1;
  if (c === 1) return general;
  const boosted = general * c;
  return k.rangeCap > 0 ? Math.max(general, Math.min(k.rangeCap, boosted)) : boosted;
}

/** Mnożnik prędkości pocisku broni `def`: pole ogólne × pole klasy. */
export function weaponSpeedMul(entity, def) {
  const m = entity?.modifiers;
  if (!m) return 1;
  const base = Number(m.projectileSpeed) > 0 ? m.projectileSpeed : 1;
  const cls = def?.weaponClass;
  const k = entity.__modClasses;
  const c = cls && k?.projectileSpeed ? (k.projectileSpeed[cls] || 1) : 1;
  return base * c;
}
