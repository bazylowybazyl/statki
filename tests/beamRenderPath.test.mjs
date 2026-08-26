import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MASTER_WEAPONS } from '../src/data/weapons.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const weapon3d = readFileSync(new URL('../src/3d/weapon3DSystem.js', import.meta.url), 'utf8');

// Każdy strzał wiązką z fireWeaponCore dostaje wizual 3D (_triggerBeamFx reaguje
// na `isBeam && detail.beam`). Wcześniej 2D było gaszone TYLKO dla wiązek
// ciągłych, więc beam_pulse rysował się dwa razy: smuga na kanwie + płaszczyzna
// w scenie. Ten test pilnuje, żeby warunek nie wrócił do wersji po beamMode.
test('beams that render in 3D do not also spawn a canvas beam', () => {
  assert.match(html, /const shouldRenderBeam2D = !weapon\.render3dOnly;/);
  assert.doesNotMatch(html, /shouldRenderBeam2D\s*=\s*!\(weapon\.render3dOnly && weapon\.beamMode/);
  // Strona 3D nie filtruje po trybie — łapie każdą wiązkę z eventu.
  assert.match(weapon3d, /if \(isBeam && detail\?\.beam\) this\._triggerBeamFx\(detail\);/);
});

// Bronie wiązkowe idące przez fireWeaponCore muszą mieć render3dOnly, inaczej
// znowu polecą podwójnie.
test('main-mount beam weapons are flagged render3dOnly', () => {
  let checked = 0;
  for (const [id, def] of Object.entries(MASTER_WEAPONS)) {
    if (def.category !== 'beam') continue;
    const mountType = String(def.mountType || '').toLowerCase();
    // laser_pd_mk1 (aux) strzela przez ciwsStep — nie dotyka fireWeaponCore
    // i nie emituje game_weapon_fired, więc jego wiązka 2D nie ma duplikatu.
    if (mountType === 'aux') continue;
    assert.equal(def.render3dOnly, true, `${id}: wiązka bez render3dOnly poleci 2D i 3D naraz`);
    checked++;
  }
  assert.ok(checked >= 2, `spodziewano się co najmniej 2 wiązek głównych, sprawdzono ${checked}`);
});

// Point-defence ma własną, czysto 2D ścieżkę — to NIE jest pozostałość.
test('point-defence laser keeps its canvas-only beam path', () => {
  assert.match(html, /function firePointDefenseLaser\(/);
  assert.match(html, /spawnLaserBeam\(muzzle, beamEnd, LASER_PD_BEAM_WIDTH/);
  assert.equal(MASTER_WEAPONS.laser_pd_mk1?.render3dOnly, undefined);
});

// Trafienia pocisków obsługuje overlay 3D; gałąź 2D była za flagą zabitą na
// sztywno na false, więc nie wykonywała się nigdy.
test('dead canvas impact branch is gone', () => {
  assert.doesNotMatch(html, /CANVAS_IMPACT_VFX_ENABLED/);
  // Trafienia wiązek nadal idą przez kanwę — ta ścieżka ma zostać.
  assert.match(html, /window\.spawnWeaponImpactFromPreset = /);
});
