// Broń maszyn eskadr (2026-10-14): bomba lotnicza, torpeda lotnicza, działko kanonierki — pola w
// MASTER_WEAPONS, ekonomia (kategoria 'bomb', przezbrojenie eskadr), wykluczenie mountType 'fighter'
// z katalogów okrętowych, krater na miarę rany, efekty, hangary nowych ról.
// node --test tests/fighterWeapons.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MASTER_WEAPONS, FIGHTER_MOUNT_TYPE, isFighterWeapon, shieldImpactClass, weaponDamageType, weaponAmmoType,
  weaponTradeGood, weaponAmmoPerShot, weaponAmmoPerMissile, DAMAGE_TYPE, AMMO_TYPE, WEAPON_GOOD
} from '../src/data/weapons.js';
import { FIGHTER_SQUADRON_DEFS, getHangarModuleIdForSquadron } from '../src/data/fighterSquadrons.js';
import {
  weaponBuildCost, weaponCatalog, weaponPriceAt, squadronRearmCost, squadronCatalog
} from '../src/game/weaponEconomy.js';
import { WeaponInventory, fillWeaponInventory } from '../src/game/weaponInventory.js';
import { WEAPON_FX, WEAPON_FX_EXCLUDED_CATEGORIES, weaponFxFor, projectileFamilyFor } from '../src/3d/weapons/weaponFxTable.js';
import { RECIPES } from '../src/3d/weapons/recipes.js';
import {
  stampFamilyFor, stampFamilyForType, craterRadiusFor, lejRadius, stampEntry
} from '../src/3d/hullDamageStamps.js';
import { isTorpedoWeapon } from '../src/game/torpedoAim.js';
import { projectilePassesAlly } from '../src/game/friendlyFire.js';
import { readFileSync } from 'node:fs';

const W = MASTER_WEAPONS;
const FIGHTER_IDS = ['fighter_bomb', 'aerial_torpedo', 'gunship_autocannon'];

test('pola nowych broni: zaczep fighter, rozmiar S, odrzut i wstrząs, opis PL', () => {
  for (const id of FIGHTER_IDS) {
    const d = W[id];
    assert.ok(d, id);
    assert.equal(d.id, id);
    assert.equal(d.mountType, FIGHTER_MOUNT_TYPE, id);
    assert.equal(d.size, 'S', id);
    assert.ok(Number.isFinite(d.recoil) && d.recoil >= 0, `${id}: recoil`);
    assert.ok(Number.isFinite(d.shake) && d.shake >= 0, `${id}: shake`);
    assert.ok(typeof d.description === 'string' && d.description.length > 20, `${id}: opis`);
    assert.ok(isFighterWeapon(d) && isFighterWeapon(id), id);
  }
  assert.equal(isFighterWeapon('railgun_mk1'), false);
  assert.equal(isFighterWeapon(null), false);
  // Tylko te trzy bronie mają zaczep 'fighter'.
  assert.deepEqual(Object.values(W).filter((d) => d.mountType === 'fighter').map((d) => d.id).sort(), [...FIGHTER_IDS].sort());

  const bomb = W.fighter_bomb;
  assert.equal(bomb.category, 'bomb');
  assert.equal(bomb.baseRange, 0);
  assert.ok(bomb.baseDamage >= 350 && bomb.baseDamage <= 500, 'obrażenia bomby ~420');
  assert.ok(bomb.cooldown > 0 && bomb.cooldown <= 0.4, 'odstęp bomb w serii');
  assert.ok(bomb.fallTime > 0.3 && bomb.fallTime < 1, 'czas spadania');

  const torp = W.aerial_torpedo;
  assert.equal(torp.category, 'torpedo');
  assert.ok(isTorpedoWeapon(torp));
  assert.equal(torp.burstCount, 1);
  assert.ok(torp.baseDamage >= 900 && torp.baseDamage <= 1300);
  assert.ok(torp.baseRange >= 3500 && torp.baseRange <= 5500, 'zasięg z ~3 km startu z zapasem');
  assert.ok(torp.baseSpeed < 1500, 'wolniejsza od torped salwowych okrętów i myśliwców');
  assert.ok(torp.turnRate > 0 && torp.turnRate <= 40, 'lekkie naprowadzanie [°/s]');
  assert.ok(torp.homingDelay > 0);
  assert.ok(torp.bulletRadius >= 6 && torp.bulletRadius <= 12);
  const t = torp.baseRange / torp.baseSpeed;
  assert.ok(t >= 2.5 && t <= 6, `dolot na pełny zasięg ${t.toFixed(1)} s`);

  const gun = W.gunship_autocannon;
  assert.equal(gun.category, 'autocannon', 'nie ciws — ciws zadaje okrętom 20%');
  assert.ok(gun.baseRange >= 1800 && gun.baseRange <= 2600);
  assert.ok(gun.baseSpeed >= 2800);
  assert.ok(gun.cooldown >= 0.15 && gun.cooldown <= 0.3);
  // Działko kanonierki (~118 DPS) słabsze niż Goliath (special Capital, ~140 DPS); bez krateru na miarę rany.
  assert.ok(gun.baseDamage / gun.cooldown < W.special_goliath_autocannon.baseDamage / W.special_goliath_autocannon.cooldown);
});

test('klasa trafienia w tarczę: wszystkie trzy main', () => {
  for (const id of FIGHTER_IDS) assert.equal(shieldImpactClass(id), 'main', id);
});

test('ekonomia: kategoria bomb (balistyczna, missile_round, sztuka na bombę, launcher_ordnance)', () => {
  const b = W.fighter_bomb;
  assert.equal(weaponDamageType(b), DAMAGE_TYPE.BALLISTIC);
  assert.equal(weaponAmmoType(b), AMMO_TYPE.MISSILE);
  assert.equal(weaponTradeGood(b), WEAPON_GOOD.ORDNANCE);
  assert.ok(weaponAmmoPerShot(b) > 0 && weaponAmmoPerShot(b) <= 1);
  assert.equal(weaponAmmoType(W.aerial_torpedo), AMMO_TYPE.TORPEDO);
  assert.equal(weaponAmmoPerMissile(W.aerial_torpedo), W.aerial_torpedo.ordnancePerMissile);
  assert.equal(weaponAmmoType(W.gunship_autocannon), AMMO_TYPE.KINETIC);
});

test('przezbrojenie eskadr nowych ról: bomby i torpedy kosztują amunicję, kanonierka — rakiety Osa', () => {
  const bomber = FIGHTER_SQUADRON_DEFS.bomber;
  const rb = squadronRearmCost('bomber');
  assert.ok(rb[AMMO_TYPE.MISSILE] > 0, 'bomby z magazynu pocisków');
  assert.ok(Math.abs(rb[AMMO_TYPE.MISSILE] - bomber.missileAmmo * bomber.squadSize * weaponAmmoPerMissile('fighter_bomb')) < 1e-9);
  const rt = squadronRearmCost('torpedo');
  assert.ok(rt[AMMO_TYPE.TORPEDO] > 0, 'torpedy z magazynu torped');
  assert.ok(squadronRearmCost('gunship')[AMMO_TYPE.MISSILE] > 0);
  const ids = squadronCatalog().map((r) => r.id);
  for (const id of ['bomber', 'torpedo', 'gunship']) assert.ok(ids.includes(id), id);
});

test('mountType fighter poza katalogami: bez ceny, bez katalogu, bez magazynu okrętu', () => {
  for (const id of FIGHTER_IDS) {
    assert.equal(weaponBuildCost(id), null, id);
    const econ = { resources: { gun_ballistic: 99, launcher_ordnance: 99, weapon_mount: 99 } };
    assert.equal(weaponPriceAt(null, econ, id), null, `${id}: port jej nie składa`);
  }
  const kat = weaponCatalog().map((r) => r.id);
  for (const id of FIGHTER_IDS) assert.ok(!kat.includes(id), `${id}: poza katalogiem`);
  const inv = new WeaponInventory();
  fillWeaponInventory(inv, Object.values(W), 5);
  for (const id of FIGHTER_IDS) assert.equal(inv.count(id), 0, `${id}: poza magazynem`);
  assert.equal(inv.count('railgun_mk1'), 5);
});

test('hangary nowych ról: kształt jak fighter_squad_strike, w katalogu, etykiety WYPOSAŻENIA', () => {
  const ref = W.fighter_squad_strike;
  const panel = readFileSync(new URL('../src/ui/station/fittingPanel.js', import.meta.url), 'utf8');
  for (const [role, label] of [['bomber', 'Eskadra bombowców'], ['torpedo', 'Eskadra torpedowców'], ['gunship', 'Eskadra kanonierek']]) {
    const id = getHangarModuleIdForSquadron(role);
    const d = W[id];
    assert.ok(d, id);
    assert.equal(d.squadronId, role);
    assert.equal(d.name, FIGHTER_SQUADRON_DEFS[role].name);
    for (const k of ['mountType', 'category', 'size', 'baseDamage', 'baseRange', 'baseSpeed', 'cooldown', 'energyCost']) {
      assert.equal(d[k], ref[k], `${id}.${k}`);
    }
    assert.ok(weaponBuildCost(id)?.fighter_craft > 0, `${id}: kupuje się z maszynami`);
    assert.ok(panel.includes(`${id}: '${label}'`), `${id}: etykieta ${label}`);
  }
});

test('krater na miarę rany: bomba i torpeda — rodzina rocket, działko — autocannon', () => {
  assert.equal(stampFamilyFor('fighter_bomb'), 'rocket');
  assert.equal(stampFamilyFor('aerial_torpedo'), 'rocket');
  assert.equal(stampFamilyFor('gunship_autocannon'), 'autocannon');
  assert.equal(stampFamilyFor(W.fighter_bomb), 'rocket');
  assert.equal(stampFamilyForType('bomb'), 'rocket');
  // pocisk torpedy lotniczej w `bullets` (vfxKey, type)
  assert.equal(stampFamilyFor({ vfxKey: 'aerial_torpedo', type: 'torpedo' }), 'rocket');
  const lej = lejRadius(stampEntry('rocket', 'impact'));
  const rb = craterRadiusFor('fighter_bomb', 'impact', W.fighter_bomb.baseDamage);
  const rt = craterRadiusFor({ vfxKey: 'aerial_torpedo', type: 'torpedo' }, 'impact', W.aerial_torpedo.baseDamage);
  assert.ok(rb > 8 && rb < lej, `krater bomby ${rb.toFixed(1)} j. (lej rakiety ${lej.toFixed(1)})`);
  assert.ok(rt > rb, `torpeda ${rt.toFixed(1)} j. > bomba`);
  assert.equal(craterRadiusFor('gunship_autocannon', 'impact', W.gunship_autocannon.baseDamage), 0, 'działko bez krateru na miarę rany');
});

test('efekty: działko kanonierki z rodziny autokanonu, bomby i torpedy poza tabelą', () => {
  assert.equal(WEAPON_FX.gunship_autocannon.fx, 'autocannon');
  assert.ok(RECIPES.autocannon.impact && RECIPES.autocannon.muzzle);
  assert.ok(WEAPON_FX_EXCLUDED_CATEGORIES.has('bomb'));
  assert.ok(WEAPON_FX_EXCLUDED_CATEGORIES.has('torpedo'));
  assert.equal(weaponFxFor('fighter_bomb'), null);
  assert.equal(projectileFamilyFor({ vfxKey: 'aerial_torpedo', type: 'torpedo' }), null, 'torpeda: _torpedoConf, wybuch armatni');
});

test('torpeda lotnicza myśliwca: IFF — przelatuje przez własnych, trafia wrogów', () => {
  const fighter = { fighter: true, friendly: true };
  const b = { type: 'torpedo', owner: 'player', source: fighter };
  assert.equal(projectilePassesAlly(b, { friendly: true }), true);
  assert.equal(projectilePassesAlly(b, { friendly: false }), false);
});
