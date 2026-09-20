import test from 'node:test';
import assert from 'node:assert/strict';
import { Turret2D, normalizeWeaponFxKey } from '../src/vfx/turret2D.js';
import { CiwsSprite2D } from '../src/vfx/ciwsSprite2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

test('CIWS sprites retain auxiliary aim, sizes, muzzle alignment and fallback under sustained fire', () => {
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
  const entity = { isPlayer: true, shipFrame: 'atlas', weapons: {}, ciws: [{ angle: Math.PI / 3 }] };
  function equip(id) {
    Turret2D.clear();
    entity.weapons = { aux: [{ weapon: MASTER_WEAPONS[id], hp: { x: 12, y: -7 } }] };
  }
  function draw(zoom = 1) {
    draws.length = 0; fills = 0;
    Turret2D.beginFrame();
    Turret2D.sync(entity, 10, 20, 0, 1);
    return Turret2D.draw(ctx, { zoom });
  }
  function tip({ args, matrix: [a, b, c, d, e, f] }) {
    const [, , , , , x, y, w, h] = args;
    return { x: a * (x + w) + c * (y + h / 2) + e - 400, y: b * (x + w) + d * (y + h / 2) + f - 400 };
  }
  try {
    for (const [id, size] of [['ciws_mk1', .52], ['ciws_mk2', .76]]) {
      equip(id);
      assert.equal(draw(), 1);
      assert.ok(fills > 0, 'loading preserves procedural fallback');
      images.at(-1).onload();
      assert.ok(CiwsSprite2D.isReady(id));
      draw();
      assert.equal(draws.length, 2, 'one housing and one rotary barrel cluster');
      assert.equal(fills, 0);
      const [a, b] = draws[0].matrix;
      assert.ok(Math.abs(Math.hypot(a, b) - size * .88) < 1e-9);
      assert.ok(Math.abs(Math.atan2(b, a) - Math.PI / 3) < 1e-9, 'auxiliary aiming retained');
      const rest = tip(draws[1]);
      const fxKey = normalizeWeaponFxKey(id);
      const muzzle = Turret2D.resolveMuzzle(Turret2D.findTurretKey(rest.x, rest.y, fxKey));
      assert.ok(Math.hypot(muzzle.x - rest.x, muzzle.y - rest.y) < 1e-6);
      for (let i = 0; i < 100; i++) {
        Turret2D.triggerShot(fxKey, rest.x, rest.y);
        Turret2D.update(.05);
        draw();
        const recoil = tip(draws[1]);
        assert.ok(Math.hypot(rest.x - recoil.x, rest.y - recoil.y) <= 2.6 * size * .88 + 1e-6);
      }
      assert.equal(draw(.2), 1);
      assert.equal(draws.length, 0);
      assert.equal(fills, 1, 'distant blob LOD retained');
      assert.equal(draw(.01), 0);
    }
    assert.equal(images.length, 2, 'images reused throughout rapid fire');
    images[0].onerror();
    equip('ciws_mk1'); draw();
    assert.ok(fills > 0);
    equip('ciws_mk2'); draw();
    assert.equal(draws.length, 2, 'failure isolated per model');
  } finally {
    Turret2D.clear();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
