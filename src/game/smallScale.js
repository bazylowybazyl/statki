// src/game/smallScale.js
//
// MAŁA SKALA — prototyp pod flagą `?malaSkala=1` (2026-10-27, prośba użytkownika: „grywalny prototyp skali 650 j. na
// fregacie zwiadu — kamera 650 j., broń ~300 j., ~600 j./s”). Fregata zwiadu przy sterach gracza dostaje kadr, w którym
// kontener gry 16 × 8 j. jest czytelny (~47 px przy 1080p), działa główne na kursor z zasięgiem ~300 j. i prędkość
// ~600 j./s. Jej pociski zestrzeliwują WIEŻE NPC: wieża ma tu własne punkty życia — dziś ginie dopiero, gdy pod gniazdem
// zniknie kadłub (komórki belek 15 j.), a mała broń żadnej komórki nie wybije. Liczby i uzasadnienie:
// docs/PROTOTYP-mala-skala.md. Czysty moduł (bez DOM i three); klej — blok „MAŁA SKALA” w index.html.

import { getEntityWeaponTier, WEAPON_TIER_SCALE } from '../data/ships.js';
import { hullWeaponRangeMul } from '../data/shipRanges.js';

// Strojenie z konsoli: window.MalaSkala.tune (zmiany kadru działają od następnego przejęcia sterów).
export const SMALL_SCALE = {
  frameW: 650,          // kadr po przejęciu sterów fregaty [j. szerokości ekranu]
  frameMinW: 320,       // najbliższy kadr kółkiem [j.] (kontener ~96 px przy 1080p)
  speed: 600,           // prędkość, do której W / S zadają ruch fregaty [j/s]
  accel: 700,           // zadawanie prędkości W / S [j/s²]
  turnRate: 1.6,        // A / D [rad/s]
  gunRange: 300,        // zasięg dział głównych fregaty [j.]
  shotSpeed: 1800,      // prędkość pocisku dział głównych [j/s] (~0,17 s do końca zasięgu)
  turretTurn: 4,        // obrót wież fregaty za kursorem [rad/s]
  aimTol: 0.12,         // strzał, gdy lufa jest najwyżej tyle od kierunku na kursor [rad]
  // Wieże NPC trafiane przez fregatę: punkty życia po rozmiarze broni i promień korpusu przy kadłubie klasy Capital
  // (mnożony skalą wież klasy kadłuba — WEAPON_TIER_SCALE) + zapas: pocisk z zewnątrz trafia burtę OBOK wieży.
  turretHp: { S: 100, M: 200, L: 400, Capital: 800 },
  turretBody: { S: 9, M: 14, L: 20, Capital: 35 },
  turretHitPad: 20,
  // Strzał nad pokładem: kursor najwyżej tyle poza korpusem wieży w chwili strzału, żeby pocisk leciał do niej nad
  // kadłubem jej okrętu (w 2D zatrzymałaby go pierwsza burta) [j.].
  deckAimPad: 12,
  targetDist: 1600      // cel ćwiczebny (MalaSkala.cel) tyle przed fregatą [j.]
};

/** Flaga prototypu z adresu strony (`?malaSkala=1`). */
export function smallScaleFromSearch(search) {
  return /[?&]malaSkala=1(?:&|$)/.test(String(search || ''));
}

/** Zoom (px ekranu na j. świata), przy którym kadr ma `frameW` j. szerokości. */
export function smallScaleZoom(viewW, frameW) {
  const w = Number(viewW) > 0 ? Number(viewW) : 1;
  const f = Number(frameW) > 0 ? Number(frameW) : SMALL_SCALE.frameW;
  return w / f;
}

/** Limit przybliżenia przy sterach fregaty: najbliższy kadr `frameMinW` (nie mniej niż limit gry `baseMax`). */
export function smallScaleMaxZoom(viewW, baseMax, tune = SMALL_SCALE) {
  return Math.max(Number(baseMax) || 0, smallScaleZoom(viewW, tune.frameMinW));
}

/**
 * Modyfikatory okrętu (źródło 'malaSkala', setModifierSource) dla broni `def` na `entity`: zasięg do `gunRange`
 * i prędkość pocisku do `shotSpeed` — liczone od zasięgu po premii klasy kadłuba (weaponRangeFor).
 */
export function smallScaleGunModifiers(entity, def, tune = SMALL_SCALE, out = {}) {
  const base = (Number(def?.baseRange) || 1000) * (hullWeaponRangeMul(entity, def) || 1);
  const speed = Number(def?.baseSpeed);
  out.range = tune.gunRange / base;
  out.projectileSpeed = Number.isFinite(speed) && speed > 0 ? tune.shotSpeed / speed : 1;
  return out;
}

function wrapPi(a) {
  a %= 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  else if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Kąt lufy obrócony ku `want` najwyżej o rate · dt (najkrótszą drogą). */
export function turnToward(angle, want, rate, dt) {
  const d = wrapPi(want - angle);
  const step = Math.max(0, rate * dt);
  return wrapPi(angle + (d > step ? step : d < -step ? -step : d));
}

/** Różnica kątów (−π…π]. */
export function angleGap(a, b) { return wrapPi(a - b); }

function sizeKey(def) {
  const s = String(def?.size || 'M');
  return s === 'S' || s === 'L' || s === 'Capital' ? s : 'M';
}

/** Promień strefy trafienia wieży broni `def` na kadłubie `entity` [j.]. */
export function turretHitRadius(def, entity, tune = SMALL_SCALE) {
  const tier = getEntityWeaponTier(entity);
  const k = (WEAPON_TIER_SCALE[tier] || WEAPON_TIER_SCALE.Capital).turret;
  return tune.turretBody[sizeKey(def)] * k + tune.turretHitPad;
}

/** Punkty życia wieży broni `def`. */
export function turretMaxHp(def, tune = SMALL_SCALE) {
  return tune.turretHp[sizeKey(def)];
}

// Punkty życia wież po gnieździe (obiekt hardpointu) — WeakMap: gniazda nie dostają pól (gniazda gracza idą do zapisu).
const _turretHp = new WeakMap();

/** Odejmuje `dmg` od wieży w gnieździe `hp`; true, gdy wieża padła. */
export function damageTurret(hp, def, dmg, tune = SMALL_SCALE) {
  if (!hp || !(dmg > 0)) return false;
  const left = (_turretHp.has(hp) ? _turretHp.get(hp) : turretMaxHp(def, tune)) - dmg;
  _turretHp.set(hp, left);
  return left <= 0;
}

/** Pozostałe punkty życia wieży (pełne, gdy jeszcze nietrafiona). */
export function turretHpLeft(hp, def, tune = SMALL_SCALE) {
  return _turretHp.has(hp) ? Math.max(0, _turretHp.get(hp)) : turretMaxHp(def, tune);
}
