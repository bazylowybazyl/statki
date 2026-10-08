// Odrzut, wstrząs i skala trafienia — jedno źródło: dane broni (zadanie 18-D, decyzje
// docs/webgpu/PROJEKT-BRONI.md §2.6, §5 p. 5–6; src/game/weaponFeel.js). Turret2D bierze odrzut
// lufy i wstrząs strzału z `recoil` / `shake` broni (FX_PROFILE zostaje tylko kluczem wieżyczki),
// Hexlance (bez wieżyczki) — wstrząs z danych, `impactScale` mnoży rozmiar w bramce LOD trafienia
// i wstrząs przy trafieniu (obrazu receptur nie).
// node --test tests/weaponRecoilSource.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { weaponRecoil, weaponShake, weaponImpactScale, WEAPON_RECOIL_FALLBACK, WEAPON_SHAKE_FALLBACK } from '../src/game/weaponFeel.js';
import { Turret2D } from '../src/vfx/turret2D.js';
import { WEAPON_FX_IDS } from '../src/3d/weapons/weaponFxTable.js';
import { Core3D } from '../src/3d/core3d.js';
import { FxFrame } from '../src/3d/fx/fxFrame.js';
import { WeaponFx, WEAPON_SHAKE_CAP } from '../src/3d/weapons/weaponFx.js';
import { readIndexHtml, loadIndexFunction } from './helpers/indexSource.mjs';

const turretSrc = readFileSync(new URL('../src/vfx/turret2D.js', import.meta.url), 'utf8');
const html = readIndexHtml();

test('dane: każda broń z efektem ma recoil i shake (wartości FX_PROFILE sprzed 18-D, warianty S/L z dema)', () => {
  for (const id of WEAPON_FX_IDS) {
    const def = MASTER_WEAPONS[id];
    assert.ok(Number.isFinite(def.recoil) && def.recoil >= 0, `${id}: recoil`);
    assert.ok(Number.isFinite(def.shake) && def.shake >= 0, `${id}: shake`);
  }
  // Dawne liczby FX_PROFILE (odrzut, wstrząs) — dziś w danych.
  const fxProfile = {
    vulcan_minigun: [3, 2], helios_laser: [6, 3], railgun_mk1: [4, 2.5], railgun_mk2: [4, 2.5], armata_mk1: [12, 6.5],
    beam_continuous: [1, 1.5], beam_pulse: [6, 3.5], special_goliath_autocannon: [20, 10], special_plasma_gatling: [15, 8],
    special_valkyrie_railgun: [20, 12], special_yamato_cannon: [60, 20], heavy_autocannon: [8, 4], ciws_mk1: [1.5, 1],
    laser_pd_mk1: [0.5, 0.3], flak_s: [3.5, 1.8], flak_m: [5, 2.6], flak_l: [8, 4.2], flak_capital: [14, 7.5],
    siege_railgun: [120, 80], hexlance_siege: [0, 14]
  };
  for (const [id, [r, s]] of Object.entries(fxProfile)) {
    assert.equal(weaponRecoil(MASTER_WEAPONS[id]), r, `${id}: odrzut`);
    assert.equal(weaponShake(MASTER_WEAPONS[id]), s, `${id}: wstrząs`);
  }
  // Warianty rozmiarowe broni specjalnej (2026-10-01): odrzut, wstrząs i skala trafienia z danych, mniejsze niż u rodzica.
  for (const [id, r, s, k, parent] of [
    ['special_valkyrie_s', 8, 4, 1.2, 'special_valkyrie_railgun'], ['special_valkyrie_m', 12, 7, 2.0, 'special_valkyrie_railgun'],
    ['special_yamato_l', 34, 12, 2.8, 'special_yamato_cannon']
  ]) {
    assert.equal(weaponRecoil(MASTER_WEAPONS[id]), r, `${id}: odrzut`);
    assert.equal(weaponShake(MASTER_WEAPONS[id]), s, `${id}: wstrząs`);
    assert.equal(weaponImpactScale(MASTER_WEAPONS[id]), k, `${id}: skala trafienia`);
    assert.ok(k < weaponImpactScale(MASTER_WEAPONS[parent]) && r < weaponRecoil(MASTER_WEAPONS[parent]), `${id}: lżej niż rodzic`);
  }
  // Lanca (klasa snajperska, 2026-10-08): odrzut i wstrząs jak Oszczep (Valkyrie M), wersja L mocniej.
  assert.equal(weaponRecoil(MASTER_WEAPONS.lance_rail_m), weaponRecoil(MASTER_WEAPONS.special_valkyrie_m));
  assert.equal(weaponShake(MASTER_WEAPONS.lance_rail_m), weaponShake(MASTER_WEAPONS.special_valkyrie_m));
  assert.ok(weaponRecoil(MASTER_WEAPONS.lance_rail_l) > weaponRecoil(MASTER_WEAPONS.lance_rail_m));
  assert.ok(weaponShake(MASTER_WEAPONS.lance_rail_l) > weaponShake(MASTER_WEAPONS.lance_rail_m));
  assert.equal(weaponRecoil({}), WEAPON_RECOIL_FALLBACK);
  assert.equal(weaponShake({}), WEAPON_SHAKE_FALLBACK);
  assert.equal(weaponImpactScale(MASTER_WEAPONS.siege_railgun), 5);
  assert.equal(weaponImpactScale(MASTER_WEAPONS.special_yamato_cannon), 4.5);
  assert.equal(weaponImpactScale(MASTER_WEAPONS.vulcan_minigun), 1, 'bez pola — 1');
});

test('Turret2D: FX_PROFILE bez liczb (tylko klucz), odrzut i wstrząs strzału z danych broni', () => {
  const block = turretSrc.slice(turretSrc.indexOf('const FX_PROFILE = {'), turretSrc.indexOf('};', turretSrc.indexOf('const FX_PROFILE = {')));
  assert.doesNotMatch(block, /recoil|shake/, 'FX_PROFILE nie trzyma już odrzutu ani wstrząsu');
  assert.match(turretSrc, /recoil: weaponRecoil\(def\)/);
  assert.match(turretSrc, /shake: weaponShake\(def\)/);

  const def = { ...MASTER_WEAPONS.armata_mk1 };
  const shooter = { autoWeapons: [{ def, hpOffset: { x: 10, y: 0 } }] };
  try {
    Turret2D.enabled = true;
    const shoot = () => {
      Turret2D.beginFrame();
      Turret2D.sync(shooter, 0, 0, 0, 1);
      const shot = Turret2D.triggerShot('armata', 20, 0, shooter);
      assert.ok(shot, 'strzał z wieżyczki');
      return { recoil: shot.recoil, shake: shot.shake };
    };
    assert.deepEqual(shoot(), { recoil: 12, shake: 6.5 });
    // Zmiana danych = zmiana odrzutu i wstrząsu (cache opisu broni śledzi pola).
    def.recoil = 33; def.shake = 9.25;
    assert.deepEqual(shoot(), { recoil: 33, shake: 9.25 });
    // Wariant S bez wpisu FX_PROFILE (dawniej fallback 3 / 1,8) — wartości rodziny z danych.
    const gat = { autoWeapons: [{ def: MASTER_WEAPONS.gatling_s, hpOffset: { x: 10, y: 0 } }] };
    Turret2D.beginFrame();
    Turret2D.sync(gat, 0, 0, 0, 1);
    const s = Turret2D.triggerShot('gatling_s', 20, 0, gat);
    assert.deepEqual({ recoil: s.recoil, shake: s.shake }, { recoil: 3, shake: 2 });
  } finally {
    Turret2D.clear();
  }
});

// WeaponFx na scenie bez urządzenia (Node) — jak tests/pulseBeamPoolLimit.test.mjs.
Core3D.isInitialized = true;
Core3D.scene = Core3D.scene || new THREE.Scene();
Core3D.fx = Core3D.fx || new FxFrame();
assert.ok(WeaponFx.ensure());

function withCamera(fn) {
  const calls = [];
  const saved = globalThis.window;
  globalThis.window = Object.assign(globalThis.window || {}, {
    camera: { shakeMag: 0, shakeTime: 0, shakeDur: 0, zoom: 1, addShake(m, d) { calls.push([m, d]); } },
    ship: null, player2Ship: null
  });
  try { fn(calls); } finally { if (saved) globalThis.window = saved; }
}

test('WeaponFx: wstrząs strzału z danych broni (kanał strzałów), sufit WEAPON_SHAKE_CAP', () => {
  WeaponFx.weaponShake = 0;
  const shooter = { autoWeapons: [{ def: MASTER_WEAPONS.armata_mk1, hpOffset: { x: 10, y: 0 } }] };
  try {
    Turret2D.enabled = true;
    Turret2D.beginFrame();
    Turret2D.sync(shooter, 0, 0, 0, 1);
    withCamera(() => {
      WeaponFx._muzzle({ id: 'armata_mk1', fx: 'armata', def: MASTER_WEAPONS.armata_mk1, size: 'L' }, 20, 0, shooter, 1, 0);
    });
    assert.equal(WeaponFx.weaponShake, 6.5, 'armata: shake 6,5 z danych');
    for (let k = 0; k < 10; k++) {
      Turret2D.sync(shooter, 0, 0, 0, 1);
      withCamera(() => WeaponFx._muzzle({ id: 'armata_mk1', fx: 'armata', def: MASTER_WEAPONS.armata_mk1, size: 'L' }, 20, 0, shooter, 1, 0));
    }
    assert.equal(WeaponFx.weaponShake, WEAPON_SHAKE_CAP);
  } finally {
    Turret2D.clear();
    WeaponFx.reset();
  }
});

test('WeaponFx.impact: wstrząs trafienia × impactScale broni (receptura bez zmian), tylko gdy strzelał gracz', () => {
  const hit = { x: 0, y: 0, nx: -1, ny: 0, entity: null, relVx: 25000, relVy: 0, kind: 'hull', through: false, ric: false };
  const mag = (b) => {
    let out = null;
    withCamera((calls) => { WeaponFx.impact(b, 0, 0, 1, hit); out = calls.map((c) => c[0]); });
    WeaponFx.reset();
    return out;
  };
  // Mjolnir: receptura trząsa 10 przy trafieniu — × impactScale 5 = 50 (sufit px robi kamera).
  assert.deepEqual(mag({ owner: 'player', vfxKey: 'siege_railgun', type: 'rail', weaponSize: 'Capital', vx: 25000, vy: 0 }), [50]);
  // Valkyrie: 5 × 3,5.
  assert.deepEqual(mag({ owner: 'player', vfxKey: 'special_valkyrie_railgun', type: 'rail', weaponSize: 'Capital', vx: 15000, vy: 0 }), [17.5]);
  // Armata: impactScale 1 — jak dotąd (4).
  assert.deepEqual(mag({ owner: 'player', vfxKey: 'armata_mk1', type: 'armata', weaponSize: 'L', vx: 2500, vy: 0 }), [4]);
  // Bitwa NPC nie trzęsie kamerą.
  assert.deepEqual(mag({ owner: 'npc', vfxKey: 'siege_railgun', type: 'rail', weaponSize: 'Capital', vx: 25000, vy: 0 }), []);
  assert.equal(WeaponFx._shakeScale, 1, 'poza trafieniem mnożnik 1');
});

test('bramka efektu trafienia: rozmiar × impactScale broni (index.html spawnBulletImpactEffect)', () => {
  const sizes = [];
  const scope = {
    WeaponFx: { available: true, impact() {} },
    impactFxKindOf: () => 2,
    IMPACT_FX_SIZE: [2.4, 1.5, 1.2, 1.0], IMPACT_FX_COOLDOWN_MS: [0, 28, 8, 42], IMPACT_FX_MIN_PX: 3,
    impactFxScreenPx: (x, y, size) => { sizes.push(size); return 100; },
    impactFxCooldownReady: () => true,
    weaponImpactScale, WEAPONS: MASTER_WEAPONS
  };
  const spawn = loadIndexFunction(html, 'function spawnBulletImpactEffect(b, x, y, scale = 1.0, hit = null) {', 'spawnBulletImpactEffect', scope);
  spawn({ vfxKey: 'siege_railgun' }, 0, 0, 1);
  spawn({ vfxKey: 'railgun_mk2' }, 0, 0, 1);
  spawn({}, 0, 0, 0.9);
  assert.deepEqual(sizes, [40 * 1.2 * 5, 40 * 1.2, 40 * 0.9 * 1.2]);
});

test('Hexlance: wstrząs strzału z danych (shake 14), odrzut z danych (0)', async () => {
  const src = readFileSync(new URL('../src/game/superweapon.js', import.meta.url), 'utf8');
  assert.match(src, /addShake\(weaponShake\(HEXLANCE_DEF\)/);
  assert.match(src, /recoilOffset \+ weaponRecoil\(HEXLANCE_DEF\)/);
});
