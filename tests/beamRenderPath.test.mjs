import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { WEAPON_FX } from '../src/3d/weapons/weaponFxTable.js';
import { RECIPES } from '../src/3d/weapons/recipes.js';
import { sliceFunction } from './helpers/indexSource.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const weaponFx = readFileSync(new URL('../src/3d/weapons/weaponFx.js', import.meta.url), 'utf8');

// Wiązki rysuje tylko 3D (WeaponFx, src/3d/weapons/weaponFx.js — zadanie 17). Każdy strzał
// wiązką z fireWeaponCore wysyła jedno zdarzenie szyny z danymi wiązki; kanwa nie rysuje
// żadnej wiązki. Dawniej beam_pulse rysował się dwa razy (smuga na kanwie + płaszczyzna
// w scenie), a laser PD tylko na kanwie — decyzja 2026-09-27: PD z kanwy 2D do 3D (efekty
// z dema bronie-webgpu).
test('wiązki bez ścieżki kanwy — każdy strzał wiązką idzie do WeaponFx', () => {
  const fire = sliceFunction(html, 'window.fireWeaponCore = function (shooter, target, weaponId, muzzleData) {');
  assert.ok(fire.length > 0);
  assert.doesNotMatch(fire, /spawnLaserBeam\(/, 'smuga wiązki na kanwie wróciła');
  assert.doesNotMatch(html, /shouldRenderBeam2D/);
  assert.doesNotMatch(html, /function spawnLaserBeam\(/, 'martwy pomocnik smugi kanwy');
  // Dane wiązki dla każdej wiązki, rodzaj efektu z klasy broni.
  assert.match(fire, /const eventBeam = _beamEventScratch;/);
  assert.match(fire, /eventBeam\.kind = pdBeam \? 'pd' : eventBeam\.mode;/);
  // Strona 3D łapie każdą wiązkę ze zdarzenia: ciągła (stan na emitterUid), impuls, laser PD.
  assert.match(weaponFx, /if \(detail\.isBeam && detail\.beam\) \{/);
  assert.match(weaponFx, /kind === 'pd' \? BEAM\.PD : BEAM\.PULSE/);
});

// Każda broń wiązkowa (także laser PD na gnieździe aux) ma recepturę z konfiguracją wiązki.
test('każda broń wiązkowa ma recepturę wiązki w tabeli efektów', () => {
  let checked = 0;
  for (const [id, def] of Object.entries(MASTER_WEAPONS)) {
    if (def.category !== 'beam') continue;
    const entry = WEAPON_FX[id];
    assert.ok(entry, `${id}: brak wpisu w WEAPON_FX`);
    assert.ok(RECIPES[entry.fx]?.beam, `${id}: receptura ${entry.fx} bez wiązki`);
    checked++;
  }
  assert.ok(checked >= 3, `spodziewano się co najmniej 3 wiązek (ciągła, impuls, PD), sprawdzono ${checked}`);
});

// Laser PD gracza (ciwsStep, poza szyną strzałów): ten sam efekt 3D co PD NPC.
test('laser PD gracza (ciwsStep) rysuje się w 3D, bez smugi kanwy', () => {
  const fn = sliceFunction(html, 'function firePointDefenseLaser(');
  assert.ok(fn.length > 0);
  assert.match(fn, /WeaponFx\.pdLaser\(weaponId, muzzle\.x, muzzle\.y, beamEnd\.x, beamEnd\.y, ship, target\);/);
  assert.doesNotMatch(fn, /spawnLaserBeam|spawnPointDefenseLaser/);
  assert.doesNotMatch(html, /LASER_PD_BEAM_WIDTH/);
});

// Trafienia pocisków obsługuje 3D; gałąź 2D była za flagą zabitą na sztywno na false,
// więc nie wykonywała się nigdy. Od zadania 17 także trafienia wiązek nie idą przez kanwę.
test('dead canvas impact branch is gone', () => {
  assert.doesNotMatch(html, /CANVAS_IMPACT_VFX_ENABLED/);
  assert.doesNotMatch(html, /impactFx\('beam'/);
  assert.doesNotMatch(html, /window\.spawnWeaponImpactFromPreset = /);
});
