import test from 'node:test';
import assert from 'node:assert/strict';

import { MASTER_WEAPONS } from '../src/data/weapons.js';
import {
  WEAPON_FX, WEAPON_FX_IDS, WEAPON_FX_EXCLUDED_CATEGORIES, weaponFxFor, projectileFamilyFor, hexHdr, SIZE_POWER
} from '../src/3d/weapons/weaponFxTable.js';

// Zadanie 17 (PROJEKT-BRONI §4, 17-A): efekty z dema `bronie-webgpu` obejmują 27 broni —
// działa Capital / L / M / S, wiązki i obronę punktową. Nowa broń w MASTER_WEAPONS bez
// wpisu w tabeli strzelałaby bez efektu (fallback po `type` jest tylko dla pocisków
// spoza tabeli) — test pilnuje, żeby nikt jej nie przeoczył.

const FAMILIES = new Set(['tempest', 'vulcan', 'autocannon', 'helios', 'armata', 'goliath', 'yamato', 'plasmaGatling',
  'hexlance', 'mjolnir', 'valkyrie', 'beamC', 'beamP', 'laserPD', 'ciws', 'flak']);

test('27 broni z dema + 3 warianty rozmiarowe broni specjalnej + Lanca M / L mają wpis w tabeli efektów, rodziny z listy receptur', () => {
  assert.equal(WEAPON_FX_IDS.length, 32);
  for (const id of WEAPON_FX_IDS) {
    assert.ok(MASTER_WEAPONS[id], `${id}: brak w MASTER_WEAPONS`);
    assert.ok(FAMILIES.has(WEAPON_FX[id].fx), `${id}: nieznana rodzina ${WEAPON_FX[id].fx}`);
  }
  // Każda rodzina z dema ma co najmniej jedną broń.
  const used = new Set(WEAPON_FX_IDS.map((id) => WEAPON_FX[id].fx));
  assert.deepEqual([...FAMILIES].filter((f) => !used.has(f)), []);
});

test('każda broń MASTER_WEAPONS poza rakietami, torpedami i hangarami ma efekt z tabeli', () => {
  const missing = [];
  for (const [id, def] of Object.entries(MASTER_WEAPONS)) {
    if (WEAPON_FX_EXCLUDED_CATEGORIES.has(def.category)) continue;
    if (String(def.mountType || '').toLowerCase() === 'hangar') continue;
    if (!weaponFxFor(id)) missing.push(id);
  }
  assert.deepEqual(missing, []);
});

test('ładowanie w tabeli = chargeTime z danych (Mjolnir, Valkyrie, Hexlance)', () => {
  for (const id of ['siege_railgun', 'special_valkyrie_railgun', 'special_valkyrie_m', 'special_valkyrie_s', 'hexlance_siege']) {
    assert.equal(WEAPON_FX[id].charge, MASTER_WEAPONS[id].chargeTime, id);
  }
  assert.ok(WEAPON_FX.laser_pd_mk1.pd && WEAPON_FX.flak_capital.pd && WEAPON_FX.ciws_mk2.pd);
});

// Broń specjalna mniejszych klas (BRIEF-kierowanie-ogniem § 6): gniazdo special fregaty (S), niszczyciela (M)
// i pancernika / lotniskowca (L) ma co zamontować; efekty z rodzin rodziców — bez nowych receptur.
test('warianty rozmiarowe broni specjalnej: S / M / L na rodzinach Valkyrie i Yamato', () => {
  for (const [id, size, fx, parent] of [
    ['special_valkyrie_s', 'S', 'valkyrie', 'special_valkyrie_railgun'],
    ['special_valkyrie_m', 'M', 'valkyrie', 'special_valkyrie_railgun'],
    ['special_yamato_l', 'L', 'yamato', 'special_yamato_cannon']
  ]) {
    const def = MASTER_WEAPONS[id];
    assert.ok(def, id);
    assert.equal(def.id, id);
    assert.equal(def.mountType, 'special', id);
    assert.equal(def.size, size, id);
    assert.equal(def.category, MASTER_WEAPONS[parent].category, id);
    assert.equal(WEAPON_FX[id].fx, fx, id);
    assert.equal(WEAPON_FX[id].fx, WEAPON_FX[parent].fx, `${id}: rodzina rodzica`);
    assert.equal(projectileFamilyFor({ vfxKey: id, type: def.category }), fx, id);
    assert.equal(def.vfxColor, MASTER_WEAPONS[parent].vfxColor, `${id}: barwa rodzica`);
    assert.ok(def.baseDamage < MASTER_WEAPONS[parent].baseDamage, `${id}: słabsza od rodzica`);
  }
  assert.equal(MASTER_WEAPONS.special_yamato_l.barrelsPerShot, 2);
  // W każdej klasie rozmiaru jest co najmniej jedna broń special.
  const sizes = new Set(Object.values(MASTER_WEAPONS).filter((d) => d.mountType === 'special').map((d) => d.size));
  assert.deepEqual(['S', 'M', 'L', 'Capital'].filter((s) => !sizes.has(s)), []);
});

// Klasa dział snajperskich (2026-10-08, docs/PLAN-fitowanie.md § 4.3.1): działa main Lanca M / L — kategoria rail
// (ekonomia, kratery), obraz z receptury Valkyrie, bez ładowania.
test('Lanca M / L: działa main klasy snajperskiej na recepturze Valkyrie, bez ładowania', () => {
  for (const [id, size] of [['lance_rail_m', 'M'], ['lance_rail_l', 'L']]) {
    const def = MASTER_WEAPONS[id];
    assert.ok(def, id);
    assert.equal(def.mountType, 'main', id);
    assert.equal(def.category, 'rail', `${id}: kategoria rail (nie nowa)`);
    assert.equal(def.size, size, id);
    assert.equal(def.weaponClass, 'sniper', id);
    assert.equal(WEAPON_FX[id].fx, 'valkyrie', id);
    assert.equal(WEAPON_FX[id].charge, 0, `${id}: bez ładowania`);
    assert.equal(def.chargeTime, undefined, `${id}: bez ładowania w danych`);
    assert.equal(projectileFamilyFor({ vfxKey: id, type: def.category }), 'valkyrie', id);
  }
});

test('pocisk spoza tabeli: rodzina po type (PROJEKT-BRONI §1.2 F)', () => {
  assert.equal(projectileFamilyFor({ vfxKey: 'special_valkyrie_railgun', type: 'rail' }), 'valkyrie');
  assert.equal(projectileFamilyFor({ type: 'rail' }), 'tempest');
  assert.equal(projectileFamilyFor({ type: 'ciws' }), 'ciws');
  assert.equal(projectileFamilyFor({ type: 'flak' }), 'flak');
  assert.equal(projectileFamilyFor({ type: 'autocannon' }), 'autocannon');
  assert.equal(projectileFamilyFor({ type: 'plasma' }), 'helios');
  assert.equal(projectileFamilyFor({ type: 'armata' }), 'armata');
  assert.equal(projectileFamilyFor({}), 'vulcan');
  assert.equal(projectileFamilyFor({ type: 'rocket' }), null);
  assert.equal(projectileFamilyFor({ type: 'torpedo', vfxKey: 'siege_torpedo' }), null);
});

test('hexHdr: #rgb, #rrggbb i rgba() z danych broni, liniowo, bez alokacji z out', () => {
  const out = [0, 0, 0];
  assert.equal(hexHdr('#ff00ff', 2, out), out);
  assert.deepEqual(out.map((v) => +v.toFixed(4)), [2, 0, 2]);
  hexHdr('#0cf', 1, out);
  assert.equal(out[0], 0);
  assert.ok(out[1] > 0.6 && out[1] < 0.61 && out[2] === 1);
  // laser_pd_mk1: vfxColor 'rgba(110,200,255,0.9)'
  hexHdr(MASTER_WEAPONS.laser_pd_mk1.vfxColor, 1, out);
  assert.ok(out[0] > 0.15 && out[0] < 0.16 && out[1] > 0.57 && out[1] < 0.59 && out[2] === 1);
  hexHdr('bzdura', 1, out);
  assert.deepEqual(out, [1, 1, 1]);
  assert.equal(SIZE_POWER.Capital, 1.6);
});
