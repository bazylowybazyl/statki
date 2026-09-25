import test from 'node:test';
import assert from 'node:assert/strict';
import { Turret2D, normalizeWeaponFxKey } from '../src/vfx/turret2D.js';
import { MainWeaponSprite2D } from '../src/vfx/mainWeaponSprite2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { getMountedWeaponAim } from '../src/game/weaponAim.js';

test('every main weapon has a main or existing Tempest sprite', () => {
  const tempests = new Set(['railgun_mk1', 'railgun_mk2', 'tempest_ion_s', 'tempest_ion_l']);
  for (const def of Object.values(MASTER_WEAPONS)) {
    if (def.mountType === 'main') assert.ok(MainWeaponSprite2D.supports(def.id) || tempests.has(def.id), def.id);
    else assert.equal(MainWeaponSprite2D.supports(def.id), false, `${def.id}: keep auxiliary and special artwork`);
  }
});

test('all main sizes preserve player/NPC muzzles, recoil, shared loading and LOD', () => {
  const previous = { window: globalThis.window, Image: globalThis.Image, Path2D: globalThis.Path2D };
  const images = [], draws = [];
  globalThis.Image = class {
    constructor() { images.push(this); }
    naturalWidth = 1254; naturalHeight = 1254;
  };
  globalThis.Path2D = class { roundRect() {} rect() {} moveTo() {} arc() {} lineTo() {} closePath() {} };
  globalThis.window = { worldToScreen: (x, y, cam) => ({ x: 400 + x * cam.zoom, y: 400 + y * cam.zoom }) };
  let matrix, fills = 0, entity;
  const ctx = {
    canvas: { width: 800, height: 800 }, save() {}, restore() {},
    setTransform(...args) { matrix = args; }, fill() { fills++; },
    drawImage(...args) { draws.push({ args, matrix }); }
  };
  function equip(id, npc = false) {
    Turret2D.clear();
    const weapon = MASTER_WEAPONS[id];
    entity = { isPlayer: !npc, shipFrame: 'atlas' };
    if (npc) entity.autoWeapons = [{ def: weapon, hpOffset: { x: 0, y: 0 }, visualAngle: Math.PI / 3 }];
    else {
      const loadout = { weapon, hp: { x: 0, y: 0 } };
      entity.weapons = { main: [loadout] };
      const aim = getMountedWeaponAim(entity, loadout);
      aim.angle = aim.previousAngle = Math.PI / 3;
    }
  }
  function draw(zoom = 1) {
    draws.length = 0; fills = 0;
    Turret2D.beginFrame(); Turret2D.sync(entity, 10, 20, .2, 1);
    return Turret2D.draw(ctx, { zoom });
  }
  function tip({ args, matrix: [a, b, c, d, e, f] }) {
    const [, , , , , x, y, w, h] = args;
    return { x: a * (x + w) + c * (y + h / 2) + e - 400, y: b * (x + w) + d * (y + h / 2) + f - 400 };
  }
  try {
    for (const [id, count, size, radius] of [
      ['vulcan_minigun', 1, .76, 45], ['gatling_s', 1, .52, 45],
      ['helios_laser', 2, .76, 47], ['helios_laser_s', 2, .52, 47], ['helios_lance_l', 2, 1.02, 47],
      ['heavy_autocannon', 1, .76, 42], ['heavy_autocannon_l', 1, 1.02, 42],
      ['armata_mk1', 1, 1.02, 55], ['beam_continuous', 1, .76 * .94, 48], ['beam_pulse', 2, .76 * .94, 40]
    ]) {
      equip(id);
      const loaded = MainWeaponSprite2D.isReady(id);
      assert.equal(draw(), 1);
      if (!loaded) {
        assert.ok(fills > 0, 'procedural fallback until load');
        images.at(-1).onload();
      }
      for (const npc of [false, true]) {
        equip(id, npc); draw();
        assert.equal(draws.length, count + 1, id);
        assert.equal(fills, 0);
        const [a, b] = draws[0].matrix;
        const scale = Math.hypot(a, b);
        if (!npc) assert.ok(Math.abs(scale - size) < 1e-9, `${id}: size preserved`);
        assert.ok(Math.abs(Math.atan2(b, a) - Math.PI / 3) < 1e-9);
        const fxKey = normalizeWeaponFxKey(id);
        for (const barrel of draws.slice(1)) {
          const p = tip(barrel);
          const muzzle = Turret2D.resolveMuzzle(Turret2D.findTurretKey(p.x, p.y, fxKey, entity));
          assert.ok(Math.hypot(muzzle.x - p.x, muzzle.y - p.y) < 1e-6, `${id}: projectile/beam origin matches sprite`);
        }
        for (const part of draws) {
          const [, x, y, w, h] = part.args;
          assert.ok(x >= 0 && y >= 0 && x + w <= 1254 && y + h <= 1254);
        }
        const rest = tip(draws[1]);
        for (let i = 0; i < 40; i++) {
          Turret2D.triggerShot(fxKey, rest.x, rest.y, entity); draw();
          const moved = tip(draws[1]);
          const distance = Math.hypot(rest.x - moved.x, rest.y - moved.y);
          assert.ok(distance > 0 && distance <= 4.4 * scale + 1e-6);
        }
        assert.equal(draw(3 / (radius * scale)), 1);
        assert.equal(draws.length, 0); assert.equal(fills, 1);
        assert.equal(draw(.001), 0);
      }
    }
    assert.equal(images.length, 6, '10 variants share six atlases across ships and repeated shots');
    images[0].onerror();
    equip('gatling_s'); draw(); assert.ok(fills > 0, 'failed family falls back for every size');
    equip('helios_laser'); draw(); assert.equal(draws.length, 3, 'other families unaffected');
    MainWeaponSprite2D.enabled = false;
    draw(); assert.equal(draws.length, 0); assert.ok(fills > 0);
  } finally {
    MainWeaponSprite2D.enabled = true;
    Turret2D.clear();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
