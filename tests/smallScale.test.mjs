import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMALL_SCALE, smallScaleFromSearch, smallScaleZoom, smallScaleMaxZoom, smallScaleGunModifiers,
  turnToward, angleGap, turretHitRadius, turretMaxHp, damageTurret, turretHpLeft
} from '../src/game/smallScale.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { CARGO_CONTAINER } from '../src/data/cargoBays.js';
import { setModifierSource, weaponRangeFor, weaponSpeedMul } from '../src/game/shipModifiers.js';
import { createScoutBay, SCOUT_TUNE, SCOUT_PHASE } from '../src/game/scoutBay.js';

test('flaga ?malaSkala=1', () => {
  assert.equal(smallScaleFromSearch('?malaSkala=1'), true);
  assert.equal(smallScaleFromSearch('?dev=1&malaSkala=1&zwiad'), true);
  assert.equal(smallScaleFromSearch('?malaSkala=0'), false);
  assert.equal(smallScaleFromSearch('?malaSkala=10'), false);
  assert.equal(smallScaleFromSearch(''), false);
});

test('kadr 650 j.: kontener 16 j. ~47 px przy 1920 px; najbliższy kadr 320 j. ponad limitem gry 3,2', () => {
  const z = smallScaleZoom(1920, SMALL_SCALE.frameW);
  assert.ok(Math.abs(1920 / z - 650) < 1e-9);
  assert.ok(Math.abs(CARGO_CONTAINER.L * z - 47.3) < 0.1, `kontener ${CARGO_CONTAINER.L * z} px`);
  assert.equal(smallScaleMaxZoom(1920, 3.2), 6);
  assert.equal(smallScaleMaxZoom(2560, 3.2), 8);
  assert.equal(smallScaleMaxZoom(800, 3.2), 3.2, 'wąskie okno: limit gry zostaje');
});

test('działa fregaty (Tempest Mk II): zasięg ~300 j. i pocisk ~1800 j/s przez źródło modyfikatorów', () => {
  const frigate = { type: 'frigate_pd' };
  const def = MASTER_WEAPONS.railgun_mk2;
  assert.ok(Math.abs(weaponRangeFor(frigate, def, def.baseRange) - 2250) < 1e-6, 'bez źródła — zasięg fregaty z gry');
  setModifierSource(frigate, 'malaSkala', smallScaleGunModifiers(frigate, def));
  assert.ok(Math.abs(weaponRangeFor(frigate, def, def.baseRange) - SMALL_SCALE.gunRange) < 1e-6);
  assert.ok(Math.abs(def.baseSpeed * weaponSpeedMul(frigate, def) - SMALL_SCALE.shotSpeed) < 1e-6);
});

test('wieża fregaty obraca się za kursorem najkrótszą drogą, z limitem obrotu', () => {
  assert.ok(Math.abs(turnToward(0, Math.PI / 2, 4, 0.1) - 0.4) < 1e-12);
  // przez ±π: z 3 rad do −3 rad to 0,28 rad, nie 6 rad wstecz
  assert.ok(Math.abs(turnToward(3, -3, 4, 0.1) - (-3)) < 1e-12);
  assert.ok(Math.abs(angleGap(-3, 3) - (2 * Math.PI - 6)) < 1e-12);
});

test('wieża NPC: strefa trafienia z klasy kadłuba i punkty życia po rozmiarze broni', () => {
  const pirateBattleship = { type: 'battleship', isPirate: true };   // klasa L — wieże ×0,88
  const def = MASTER_WEAPONS.armata_mk1;   // działo główne piratów (gniazdo L)
  const r = turretHitRadius(def, pirateBattleship);
  assert.ok(Math.abs(r - (SMALL_SCALE.turretBody[def.size] * 0.88 + SMALL_SCALE.turretHitPad)) < 1e-9, `promień ${r}`);
  const hp = { id: 'hp-test' };
  const max = turretMaxHp(def);
  assert.equal(max, SMALL_SCALE.turretHp[def.size]);
  let down = false;
  let hits = 0;
  while (!down && hits < 1000) { down = damageTurret(hp, def, 10); hits++; }
  assert.equal(hits, Math.ceil(max / 10), 'wieża pada po tylu trafieniach po 10');
  assert.equal(turretHpLeft(hp, def), 0);
  assert.equal(turretHpLeft({ id: 'nowe' }, def), max, 'nietrafiona — pełne punkty');
});

test('SCOUT_TUNE.ctlSpeed: sufit prędkości sterów fregaty (0 — prędkość maks. fregaty)', () => {
  const atlas = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, w: 1800, h: 800 };
  let npc = null;
  const env = {
    bayLocal: { x: 34, y: 0 },
    carrier: () => atlas,
    spawn(p) { npc = { x: p.x, y: p.y, vx: 0, vy: 0, angle: p.angle, maxSpeed: 1412 }; return npc; },
    remove(n) { n.dead = true; npc = null; },
    ghost() {},
    fly(n, x, y, vx, vy, face) { n.vx = vx; n.vy = vy; n.angle = face; },
    place(n, x, y, a) { n.x = x; n.y = y; n.angle = a; },
    contacts(out) { out.length = 0; return out; },
    visible: () => true,
    radius: () => 60,
    label: () => ''
  };
  const run = (ctlSpeed) => {
    const bay = createScoutBay(env, { ...SCOUT_TUNE, ctlSpeed });
    bay.grant();
    bay.launch();
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 30 && bay.phase !== SCOUT_PHASE.FLIGHT; i++) {
      bay.step(dt);
      if (npc) { npc.x += npc.vx * dt; npc.y += npc.vy * dt; }
      bay.afterNpc();
    }
    assert.equal(bay.phase, SCOUT_PHASE.FLIGHT);
    bay.setControl(1, 0, 0);
    for (let i = 0; i < 60 * 15; i++) { bay.step(dt); bay.afterNpc(); }
    return bay.cmdSpeed;
  };
  assert.equal(run(600), 600);
  assert.equal(run(0), 1412, 'bez sufitu — prędkość maks. fregaty');
});
