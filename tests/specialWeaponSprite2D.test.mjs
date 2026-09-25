import test from 'node:test';
import assert from 'node:assert/strict';
import { Turret2D, normalizeWeaponFxKey } from '../src/vfx/turret2D.js';
import { SpecialWeaponSprite2D } from '../src/vfx/specialWeaponSprite2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { getMountedWeaponAim } from '../src/game/weaponAim.js';

test('special sprites preserve player/NPC aim, every muzzle, recoil and distant fallback', () => {
  const previous = { window: globalThis.window, Image: globalThis.Image, Path2D: globalThis.Path2D };
  const images = [], draws = [];
  globalThis.Image = class {
    constructor() { images.push(this); }
    naturalWidth = 1254; naturalHeight = 1254;
  };
  globalThis.Path2D = class { roundRect() {} rect() {} moveTo() {} arc() {} lineTo() {} closePath() {} };
  globalThis.window = { worldToScreen: (x, y, cam) => ({ x: 400 + x * cam.zoom, y: 400 + y * cam.zoom }) };
  let matrix, fills = 0;
  const ctx = {
    canvas: { width: 800, height: 800 }, save() {}, restore() {},
    setTransform(...args) { matrix = args; }, fill() { fills++; },
    drawImage(...args) { draws.push({ args, matrix }); }
  };
  let entity;
  function equip(id, npc = false) {
    Turret2D.clear();
    const weapon = MASTER_WEAPONS[id];
    entity = { isPlayer: !npc, shipFrame: 'atlas' };
    if (npc) entity.autoWeapons = [{ def: weapon, hpOffset: { x: 0, y: 0 }, visualAngle: Math.PI / 3 }];
    else {
      const loadout = { weapon, hp: { x: 0, y: 0 } };
      entity.weapons = { special: [loadout] };
      const aim = getMountedWeaponAim(entity, loadout);
      aim.angle = aim.previousAngle = Math.PI / 3;
    }
  }
  function draw(zoom = 1) {
    draws.length = 0; fills = 0;
    Turret2D.beginFrame();
    Turret2D.sync(entity, 10, 20, .2, 1);
    return Turret2D.draw(ctx, { zoom });
  }
  function tip({ args, matrix: [a, b, c, d, e, f] }) {
    const [, , , , , x, y, w, h] = args;
    return { x: a * (x + w) + c * (y + h / 2) + e - 400, y: b * (x + w) + d * (y + h / 2) + f - 400 };
  }
  try {
    for (const [id, count, radius] of [
      ['special_goliath_autocannon', 2, 58], ['special_plasma_gatling', 1, 42],
      ['special_valkyrie_railgun', 2, 40], ['siege_railgun', 1, 80]
    ]) {
      equip(id);
      assert.equal(draw(), 1);
      assert.ok(fills > 0, 'weapon remains visible before atlas load');
      images.at(-1).onload();
      assert.ok(SpecialWeaponSprite2D.isReady(id));
      for (const npc of [false, true]) {
        equip(id, npc); draw();
        assert.equal(draws.length, count + 1, id);
        assert.equal(fills, 0, 'procedural artwork is not double drawn');
        const [a, b] = draws[0].matrix;
        const scale = Math.hypot(a, b);
        if (!npc) assert.ok(Math.abs(scale - 1.75) < 1e-9);
        assert.ok(Math.abs(Math.atan2(b, a) - Math.PI / 3) < 1e-9);
        const fxKey = normalizeWeaponFxKey(id);
        for (const barrel of draws.slice(1)) {
          const p = tip(barrel);
          const muzzle = Turret2D.resolveMuzzle(Turret2D.findTurretKey(p.x, p.y, fxKey, entity));
          assert.ok(Math.hypot(muzzle.x - p.x, muzzle.y - p.y) < 1e-6, `${id}: sprite muzzle matches gameplay`);
        }
        for (const part of draws) {
          const [, x, y, w, h] = part.args;
          assert.ok(x >= 0 && y >= 0 && x + w <= 1254 && y + h <= 1254);
        }
        const rest = tip(draws[1]);
        for (let i = 0; i < 40; i++) {
          Turret2D.triggerShot(fxKey, rest.x, rest.y, entity);
          draw();
          const moved = tip(draws[1]);
          const distance = Math.hypot(rest.x - moved.x, rest.y - moved.y);
          assert.ok(distance > 0 && distance <= 7 * scale + 1e-6, 'sustained fire stays inside slide travel');
        }
        assert.equal(draw(3 / (radius * scale)), 1);
        assert.equal(draws.length, 0);
        assert.equal(fills, 1, 'distant blob LOD retained');
        assert.equal(draw(.001), 0);
      }
    }
    assert.equal(images.length, 4, 'atlases shared across ships and shots');
    images[0].onerror();
    equip('special_goliath_autocannon'); draw(); assert.ok(fills > 0);
    equip('special_plasma_gatling'); draw(); assert.equal(draws.length, 2);
    assert.equal(SpecialWeaponSprite2D.supports('railgun_mk2'), false, 'ordinary Tempest keeps separate art');
    SpecialWeaponSprite2D.enabled = false;
    draw(); assert.equal(draws.length, 0); assert.ok(fills > 0, 'A/B preview toggle works');
  } finally {
    SpecialWeaponSprite2D.enabled = true;
    Turret2D.clear();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
