/**
 * EKONOMIA UZBROJENIA — most między 38 modelami broni a czterema pozycjami,
 * którymi handluje gospodarka.
 *
 * `weapons.js` opisuje, JAK broń strzela. `resources.js` wie, co da się
 * wyprodukować i przewieźć. Tego drugiego nie wolno rozdmuchać do 38 pozycji
 * magazynowych — port musiałby prowadzić osobny słupek dla każdego wariantu
 * Tempest Iona, a transport woziłby paczki po jednej sztuce.
 *
 * Dlatego gospodarka zna cztery klasy uzbrojenia (`gun_ballistic`, `gun_energy`,
 * `launcher_ordnance`, `pd_turret`) plus `weapon_mount` jako podstawę, a KONKRETNY
 * model powstaje dopiero przy zakupie: railgun Mk II to dwie sztuki działa
 * kinetycznego na jednej podstawie. Tu mieszka to przeliczenie.
 *
 * Druga rzecz, która tu mieszka: **amunicja jako koszt bieżący.** Działo
 * balistyczne kupuje się raz, ale strzela dopóki ktoś dowozi skrzynie — i to
 * jest jedyny towar w grze, który znika przez samo używanie.
 */

import {
  MASTER_WEAPONS, weaponTradeGood, weaponAmmoType, weaponAmmoPerShot,
  weaponDamageType, DAMAGE_TYPE
} from '../data/weapons.js';
import {
  FIGHTER_SQUADRON_DEFS, getFighterSquadronDef, getHangarSquadronCapacity,
  getSquadronIdForHangarModule
} from '../data/fighterSquadrons.js';
import { RESOURCES } from '../data/resources.js';
import { resourcePrice } from './stationEconomy.js';

/**
 * Ile sztuk klasy handlowej zjada lufa danego rozmiaru.
 *
 * Rozmiar jest tu jedyną osią ceny i tak ma być: różnice W OBRĘBIE rozmiaru
 * (Vulcan kontra Heavy Autocannon) są kwestią doboru pod zadanie, nie tego,
 * że jedno jest „lepsze" — inaczej katalog zwinąłby się do jednej pozycji
 * na klasę hardpointu, dokładnie tak jak flota stoczni zwinęła się do samych
 * nosicieli, zanim doszła doktryna.
 */
export const WEAPON_SIZE_UNITS = Object.freeze({ S: 1, M: 2, L: 4, Capital: 8 });

/** Ile podstaw trzeba pod lufę tego rozmiaru. */
const MOUNTS_PER_SIZE = Object.freeze({ S: 1, M: 1, L: 2, Capital: 3 });

/**
 * Dopłata za gniazdo montażowe. Broń „special" i „builtin" to nie jest większa
 * armata — to konstrukcja robiona pod jeden okręt, więc kosztuje wielokrotność
 * seryjnej. Bez tego Bateria Yamato wychodziła tyle samo co osiem zwykłych luf.
 */
const MOUNT_PREMIUM = Object.freeze({
  main: 1, aux: 1, missile: 1, hangar: 1,
  special: 2.5, special_missile: 2.5, builtin: 4
});

/** Standardowy zapas amunicji sprzedawany razem z działem, w strzałach. */
export const STANDARD_AMMO_LOAD = 200;

function def(weaponOrId) {
  if (weaponOrId && typeof weaponOrId === 'object') return weaponOrId;
  return MASTER_WEAPONS[String(weaponOrId || '')] || null;
}

// ============================================================
// Eskadry myśliwskie
// ============================================================

/**
 * Ile maszyn kosztuje jedna eskadra. Liczone z `squadSize`, nie wpisane —
 * zmiana liczebności klucza w `fighterSquadrons.js` ma od razu przeliczać cenę.
 */
export function squadronBuildCost(squadronId) {
  const squadron = getFighterSquadronDef(squadronId);
  return { fighter_craft: Math.max(1, Number(squadron.squadSize) || 1) };
}

/**
 * Ile amunicji zjada UZBROJENIE eskadry przed wylotem.
 *
 * Działka myśliwców są integralne i siedzą w cenie płatowca, ale rakiety to
 * osobne pociski — dokładnie te same, którymi strzelają okręty. Dlatego
 * uzupełnienie klucza po locie jest realnym wydatkiem, a nie darmowym resetem:
 * eskadra uderzeniowa wraca pusta i trzeba ją przezbroić.
 *
 * `missileAmmo` to zapas NA MASZYNĘ, więc mnożymy przez liczebność klucza.
 */
export function squadronRearmCost(squadronId) {
  const squadron = getFighterSquadronDef(squadronId);
  const ammoId = weaponAmmoType(squadron.missileId);
  if (!ammoId) return {};
  const perShot = weaponAmmoPerShot(squadron.missileId);
  const units = (Number(squadron.missileAmmo) || 0) * perShot
    * (Number(squadron.squadSize) || 1);
  return units > 0 ? { [ammoId]: units } : {};
}

/** Pełny koszt wystawienia eskadry w pole: maszyny plus pierwszy zapas rakiet. */
export function squadronTotalCost(squadronId) {
  const cost = { ...squadronBuildCost(squadronId) };
  for (const [id, qty] of Object.entries(squadronRearmCost(squadronId))) {
    cost[id] = (cost[id] || 0) + qty;
  }
  return cost;
}

/** Katalog eskadr — do UI hangaru i do bilansu. */
export function squadronCatalog() {
  return Object.values(FIGHTER_SQUADRON_DEFS).map(squadron => {
    const build = squadronBuildCost(squadron.id);
    const rearm = squadronRearmCost(squadron.id);
    const wartosc = bagValue(build);
    return {
      id: squadron.id,
      name: squadron.name,
      role: squadron.role,
      squadSize: squadron.squadSize,
      build,
      rearm,
      value: wartosc,
      rearmValue: bagValue(rearm),
      mass: bagMass(build)
    };
  }).sort((a, b) => a.value - b.value);
}

function bagValue(bag) {
  let value = 0;
  for (const [id, qty] of Object.entries(bag || {})) {
    value += (RESOURCES[id]?.value || 0) * qty;
  }
  return value;
}

function bagMass(bag) {
  let mass = 0;
  for (const [id, qty] of Object.entries(bag || {})) {
    mass += (RESOURCES[id]?.mass || 0) * qty;
  }
  return mass;
}

/**
 * Z czego składa się dana broń — w pozycjach magazynowych.
 *
 * Hangar jest tu pełnoprawną pozycją, choć niczym nie strzela: kupuje się go
 * razem z maszynami, które w nim stoją. Do 2026-08-20 zwracał `null` i eskadry
 * wypadały z gospodarki w całości — nosiciel schodził z pochylni z pustymi
 * pokładami, a jedyny sposób na myśliwce był taki, że po prostu były.
 */
export function weaponBuildCost(weaponOrId) {
  const weapon = def(weaponOrId);
  if (!weapon) return null;
  const good = weaponTradeGood(weapon);
  if (!good) return null;

  const premium = MOUNT_PREMIUM[weapon.mountType] ?? 1;
  const mounts = Math.max(1, Math.round((MOUNTS_PER_SIZE[weapon.size] ?? 1) * premium));

  if (weaponDamageType(weapon) === DAMAGE_TYPE.CARRIER) {
    // Ile KLUCZY mieści to gniazdo — L i Capital biorą po dwa.
    const klucze = getHangarSquadronCapacity(weapon.size);
    const squadronId = getSquadronIdForHangarModule(weapon.id);
    const maszyny = (getFighterSquadronDef(squadronId).squadSize || 9) * klucze;
    return { fighter_craft: maszyny, weapon_mount: mounts };
  }

  const units = Math.max(1, Math.round((WEAPON_SIZE_UNITS[weapon.size] ?? 2) * premium));
  return { [good]: units, weapon_mount: mounts };
}

/** Wartość materiałowa broni w CR — suma pozycji po cenach bazowych. */
export function weaponMaterialValue(weaponOrId) {
  const cost = weaponBuildCost(weaponOrId);
  if (!cost) return 0;
  let value = 0;
  for (const [id, qty] of Object.entries(cost)) {
    value += (RESOURCES[id]?.value || 0) * qty;
  }
  return value;
}

/** Masa broni w jednostkach ładowni — ile miejsca zajmie w drodze do gracza. */
export function weaponMass(weaponOrId) {
  const cost = weaponBuildCost(weaponOrId);
  if (!cost) return 0;
  let mass = 0;
  for (const [id, qty] of Object.entries(cost)) {
    mass += (RESOURCES[id]?.mass || 0) * qty;
  }
  return mass;
}

/**
 * Cena broni w konkretnym porcie.
 *
 * Liczona z LOKALNYCH cen jej składników, nie ze stałej — port, do którego
 * nikt nie dowiózł dział, sprzedaje je drogo, a stocznia z pełnym magazynem
 * tanio. Dzięki temu uzbrojenie podlega tym samym prawom co reszta towaru
 * i opłaca się je wozić.
 *
 * Zwraca `null`, gdy portu nie stać na skompletowanie broni — to jest realna
 * odpowiedź „nie ma na stanie", a nie zero.
 */
export function weaponPriceAt(station, econ, weaponOrId, options = {}) {
  const cost = weaponBuildCost(weaponOrId);
  if (!cost || !econ?.resources) return null;

  let sell = 0;
  let buy = 0;
  let missing = 0;
  for (const [id, qty] of Object.entries(cost)) {
    const price = resourcePrice(station, econ, id);
    const stan = Math.max(0, Number(econ.resources[id]) || 0);
    if (stan < qty) missing += qty - stan;
    if (price) {
      sell += price.ask * qty;
      buy += price.bid * qty;
    } else {
      sell += (RESOURCES[id]?.value || 0) * qty;
      buy += (RESOURCES[id]?.value || 0) * qty * 0.82;
    }
  }

  // Marża warsztatu: składanie działa z części to robota, nie sama zamiana
  // pozycji magazynowych.
  const fee = Number(options.assemblyFee ?? 1.12);
  return {
    /** Ile gracz zapłaci za gotową broń. */
    sell: sell * fee,
    /** Ile port da graczowi za jego broń. */
    buy: buy / fee,
    /** Ilu sztuk składników brakuje, żeby ją tu złożyć. */
    missing,
    inStock: missing <= 0,
    cost
  };
}

/** Czy port ma z czego złożyć tę broń. */
export function stationCanBuildWeapon(econ, weaponOrId) {
  const cost = weaponBuildCost(weaponOrId);
  if (!cost || !econ?.resources) return false;
  return Object.entries(cost).every(([id, qty]) => (Number(econ.resources[id]) || 0) >= qty);
}

/**
 * Sprzedaje broń graczowi: zdejmuje składniki z magazynu portu i zwraca cenę.
 *
 * Zwraca `null`, gdy portu nie stać — transakcja jest ATOMOWA, więc nie
 * zostawia rozgrzebanego magazynu.
 */
export function buyWeaponFrom(station, econ, weaponOrId, options = {}) {
  const wycena = weaponPriceAt(station, econ, weaponOrId, options);
  if (!wycena || !wycena.inStock) return null;
  for (const [id, qty] of Object.entries(wycena.cost)) {
    econ.resources[id] = (Number(econ.resources[id]) || 0) - qty;
  }
  return { price: wycena.sell, cost: wycena.cost };
}

/** Odkup broni od gracza — składniki wracają na stan portu. */
export function sellWeaponTo(station, econ, weaponOrId, options = {}) {
  const wycena = weaponPriceAt(station, econ, weaponOrId, options);
  if (!wycena) return null;
  for (const [id, qty] of Object.entries(wycena.cost)) {
    const cap = Number(econ.capacity?.[id]);
    const next = (Number(econ.resources[id]) || 0) + qty;
    econ.resources[id] = Number.isFinite(cap) ? Math.min(cap, next) : next;
  }
  return { price: wycena.buy, cost: wycena.cost };
}

// ============================================================
// Amunicja
// ============================================================

/**
 * Ile amunicji zjada zadana liczba strzałów. Zwraca `null` dla broni
 * energetycznej — ta nie ma czego zużywać poza mocą reaktora.
 */
export function ammoForShots(weaponOrId, shots = STANDARD_AMMO_LOAD) {
  const ammoId = weaponAmmoType(weaponOrId);
  if (!ammoId) return null;
  return { id: ammoId, units: weaponAmmoPerShot(weaponOrId) * Math.max(0, shots) };
}

/** Koszt takiego zapasu w CR po cenach bazowych. */
export function ammoValue(weaponOrId, shots = STANDARD_AMMO_LOAD) {
  const zapas = ammoForShots(weaponOrId, shots);
  if (!zapas) return 0;
  return (RESOURCES[zapas.id]?.value || 0) * zapas.units;
}

/**
 * Ile kosztuje UTRZYMANIE broni w ogniu przez minutę — miara, która rozdziela
 * obie szkoły ostrzej niż cena zakupu.
 *
 * Działo balistyczne jest tanie na półce i drogie w użyciu; emiter odwrotnie.
 * Dopiero zestawienie tych dwóch liczb mówi, co się opłaca przy długiej
 * kampanii, a co przy jednej krótkiej bitwie.
 */
export function sustainCostPerMinute(weaponOrId) {
  const weapon = def(weaponOrId);
  if (!weapon) return 0;
  const ammoId = weaponAmmoType(weapon);
  if (!ammoId) return 0;
  const cooldown = Math.max(0.02, Number(weapon.cooldown) || 1);
  const perMinute = weaponAmmoPerShot(weapon) * (60 / cooldown);
  return perMinute * (RESOURCES[ammoId]?.value || 0);
}

/** Katalog broni na sprzedaż — do UI doku i do testów. */
export function weaponCatalog(options = {}) {
  const rows = [];
  for (const weapon of Object.values(MASTER_WEAPONS)) {
    const cost = weaponBuildCost(weapon);
    if (!cost) continue;
    if (options.size && weapon.size !== options.size) continue;
    if (options.excludeCarriers && weaponDamageType(weapon) === DAMAGE_TYPE.CARRIER) continue;
    if (options.damageType && weaponDamageType(weapon) !== options.damageType) continue;
    rows.push({
      id: weapon.id,
      name: weapon.name,
      size: weapon.size,
      mountType: weapon.mountType,
      damageType: weaponDamageType(weapon),
      ammoId: weaponAmmoType(weapon),
      cost,
      value: weaponMaterialValue(weapon),
      mass: weaponMass(weapon),
      sustainPerMinute: sustainCostPerMinute(weapon)
    });
  }
  return rows.sort((a, b) => a.value - b.value);
}
