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

test('27 broni z dema ma wpis w tabeli efektów, rodziny z listy receptur', () => {
  assert.equal(WEAPON_FX_IDS.length, 27);
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
  for (const id of ['siege_railgun', 'special_valkyrie_railgun', 'hexlance_siege']) {
    assert.equal(WEAPON_FX[id].charge, MASTER_WEAPONS[id].chargeTime, id);
  }
  assert.ok(WEAPON_FX.laser_pd_mk1.pd && WEAPON_FX.flak_capital.pd && WEAPON_FX.ciws_mk2.pd);
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
