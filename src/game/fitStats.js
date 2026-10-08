// src/game/fitStats.js
//
// PROFIL OGNIA i sumy konfiguracji (docs/PLAN-fitowanie.md § 4.6) — te same liczby na kartach WYPOSAŻENIA, w refit
// ręcznym i przy porównaniu „przed / po”. Czysty moduł (bez gry): dostaje gniazda, broń w nich i moduł.
//
// DPS broni = obrażenia × lufy × salwa (× głowice MIRV) / przeładowanie. Profil: DPS w funkcji odległości 0–18 km
// co 0,25 km, osobno działa (main + special + builtin bez superbroni) i rakiety (gniazda missile — salwy, póki jest
// amunicja). Supernova (special_missile) i Hexlance (superbroń) są w każdej karcie — nie wchodzą do profilu.

import { moduleModifierSource, moduleSlotType, moduleShieldMul } from '../data/shipModules.js';

export const FIT_PROFILE_STEP_KM = 0.25;
export const FIT_PROFILE_MAX_KM = 18;
export const FIT_PROFILE_POINTS = Math.round(FIT_PROFILE_MAX_KM / FIT_PROFILE_STEP_KM) + 1;

/** DPS broni z karty (obrażenia × lufy × salwa × głowice / przeładowanie). */
export function weaponDps(def) {
  if (!def || !(Number(def.cooldown) > 0) || !Number(def.baseDamage)) return 0;
  const n = (Number(def.barrelsPerShot) || 1) * (Number(def.burstCount) || 1) * (Number(def.submunition?.count) || 1);
  return (Number(def.baseDamage) * n) / Number(def.cooldown);
}

/** Zasięg broni z modułem (premia klasy z sufitem — jak weaponRangeFor w shipModifiers.js). */
export function weaponRangeWithModule(def, moduleId) {
  const r0 = Number(def?.baseRange) || 0;
  const src = moduleModifierSource(moduleId);
  const cls = def?.weaponClass;
  const mul = cls && src?.classRange ? (src.classRange[cls] || 1) : 1;
  if (mul === 1) return r0;
  const boosted = r0 * mul;
  return src.rangeCap > 0 ? Math.max(r0, Math.min(src.rangeCap, boosted)) : boosted;
}

/**
 * Profil i sumy konfiguracji.
 * @param {object} o
 * @param {object[]} o.hardpoints               gniazda kadłuba ({ id, type — bazowy, destroyed })
 * @param {Map<string,string|null>|null} [o.mounts]  broń wg id gniazda (plan); brak — `currentOf`
 * @param {(hp:object)=>string|null} [o.currentOf]
 * @param {object} o.weapons                    MASTER_WEAPONS
 * @param {string|null} [o.module]
 * @param {{max:number}} [o.shieldBase]         tarcza kadłuba bez modułu
 */
export function fitStats(o) {
  const W = o.weapons || {};
  const guns = new Float32Array(FIT_PROFILE_POINTS);
  const miss = new Float32Array(FIT_PROFILE_POINTS);
  let maxGun = 0;
  let maxMiss = 0;
  let pd = 0;
  let pdRange = 0;
  let salvo = 0;
  const hangars = new Map();
  const currentOf = o.currentOf || ((hp) => hp.mount || null);
  for (const hp of o.hardpoints || []) {
    if (!hp || hp.destroyed) continue;
    const id = o.mounts ? (o.mounts.get(hp.id) ?? null) : currentOf(hp);
    if (!id) continue;
    const def = W[id];
    if (!def) continue;
    const eff = moduleSlotType(hp.type, o.module || null);
    if (eff === 'aux') {
      pd++;
      pdRange = Math.max(pdRange, Number(def.baseRange) || 0);
      continue;
    }
    if (eff === 'hangar') {
      hangars.set(id, (hangars.get(id) || 0) + 1);
      continue;
    }
    if (eff === 'special_missile' || def.category === 'superweapon') continue;
    const r = weaponRangeWithModule(def, o.module || null);
    const d = weaponDps(def);
    const isMissile = eff === 'missile';
    const arr = isMissile ? miss : guns;
    if (isMissile) {
      maxMiss = Math.max(maxMiss, r);
      salvo += (Number(def.baseDamage) || 0) * (Number(def.burstCount) || 1) * (Number(def.submunition?.count) || 1);
    } else {
      maxGun = Math.max(maxGun, r);
    }
    const last = Math.min(FIT_PROFILE_POINTS - 1, Math.floor(r / 1000 / FIT_PROFILE_STEP_KM + 1e-6));
    for (let k = 0; k <= last; k++) arr[k] += d;
  }
  const at = (km) => {
    const k = Math.max(0, Math.min(FIT_PROFILE_POINTS - 1, Math.round(km / FIT_PROFILE_STEP_KM)));
    return guns[k] + miss[k];
  };
  const gunsAt = (km) => guns[Math.max(0, Math.min(FIT_PROFILE_POINTS - 1, Math.round(km / FIT_PROFILE_STEP_KM)))];
  const shieldMax = Math.round((Number(o.shieldBase?.max) || 0) * moduleShieldMul(o.module || null).max);
  return { guns, miss, maxGun, maxMiss, pd, pdRange, salvo, hangars, at, gunsAt, shieldMax };
}
