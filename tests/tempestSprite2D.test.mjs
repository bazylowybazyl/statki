import test from 'node:test';
import assert from 'node:assert/strict';
import { Turret2D } from '../src/vfx/turret2D.js';
import { TempestSprite2D } from '../src/vfx/tempestSprite2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { getMountedWeaponAim } from '../src/game/weaponAim.js';

test('Tempest sprites retain all variant scales, mounted aim, muzzles and fallbacks', () => {
  const previous = { window: globalThis.window, Image: globalThis.Image, Path2D: globalThis.Path2D };
  const images = [], draws = [];
  globalThis.Image = class {
    constructor() { images.push(this); }
    naturalWidth = 1254;
    naturalHeight = 1254;
  };
  globalThis.Path2D = class {
    roundRect() {} rect() {} moveTo() {} arc() {} lineTo() {} closePath() {}
  };
  globalThis.window = { worldToScreen: (x, y, cam) => ({ x: 400 + x * cam.zoom, y: 400 + y * cam.zoom }) };
  let matrix, fills = 0;
  const ctx = {
    canvas: { width: 800, height: 800 }, save() {}, restore() {},
    setTransform(...args) { matrix = args; },
    fill() { fills++; },
    drawImage(...args) { draws.push({ args, matrix }); }
  };
  const entity = { isPlayer: true, shipFrame: 'atlas', angle: 0.2, weapons: {} };
  let loadout;
  function equip(id) {
    const def = MASTER_WEAPONS[id] || { ...MASTER_WEAPONS[id.endsWith('mk2') ? 'railgun_mk2' : 'railgun_mk1'], id };
    loadout = { weapon: def, hp: { x: 12, y: -7 } };
    entity.weapons = { main: [loadout] };
    const aim = getMountedWeaponAim(entity, loadout);
    aim.angle = aim.previousAngle = Math.PI / 3;
  }
  function draw(zoom = 1) {
    draws.length = 0;
    fills = 0;
    Turret2D.beginFrame();
    Turret2D.sync(entity, 10, 20, entity.angle, 1);
    return Turret2D.draw(ctx, { zoom });
  }
  function tip({ args, matrix: [a, b, c, d, e, f] }) {
    const [, , , , , x, y, w, h] = args;
    return { x: a * (x + w) + c * (y + h / 2) + e - 400, y: b * (x + w) + d * (y + h / 2) + f - 400 };
  }
  try {
    equip('railgun_mk1');
    assert.equal(draw(), 1);
    assert.ok(fills > 0, 'loading keeps the procedural weapon visible');
    assert.equal(draws.length, 0);
    assert.equal(images.length, 1);
    images[0].onload();
    equip('railgun_mk2');
    draw();
    assert.equal(images.length, 2);
    images[1].onload();

    for (const [id, barrels, scale] of [
      ['tempest_ion_s', 1, .52], ['railgun_mk1', 1, .76],
      ['railgun_mk2', 2, .76], ['tempest_ion_l', 1, 1.02],
      ['tempest_ion_mk1', 1, .76], ['tempest_ion_mk2', 2, .76]
    ]) {
      equip(id);
      assert.equal(draw(), 1, id);
      assert.equal(fills, 0, `${id}: no double-drawn procedural gun`);
      assert.equal(draws.length, barrels + 1, `${id}: correct barrel count`);
      const [a, b] = draws[0].matrix;
      assert.ok(Math.abs(Math.hypot(a, b) - scale) < 1e-9, `${id}: size preserved`);
      assert.ok(Math.abs(Math.atan2(b, a) - Math.PI / 3) < 1e-9, `${id}: uses mounted aim`);
      for (const barrel of draws.slice(1)) {
        const p = tip(barrel);
        const muzzle = Turret2D.resolveMuzzle(Turret2D.findTurretKey(p.x, p.y, 'tempest'));
        assert.ok(Math.hypot(muzzle.x - p.x, muzzle.y - p.y) < 1e-6, `${id}: barrel and VFX agree`);
        const [, x, y, w, h] = barrel.args;
        assert.ok(x >= 0 && y >= 0 && x + w <= 1254 && y + h <= 1254, `${id}: valid atlas crop`);
      }
    }
    assert.equal(images.length, 2, 'all sizes reuse the two atlases');

    equip('railgun_mk2');
    draw();
    const restingTip = tip(draws[1]);
    Turret2D.triggerShot('tempest', restingTip.x, restingTip.y);
    draw();
    const recoiledTip = tip(draws[1]);
    const travel = Math.hypot(restingTip.x - recoiledTip.x, restingTip.y - recoiledTip.y);
    assert.ok(travel > 0 && travel <= 6 * .76, 'barrels recoil within the slide length');
    assert.equal(draw(.1), 1);
    assert.equal(draws.length, 0);
    assert.equal(fills, 1, 'distant LOD stays procedural');
    assert.equal(draw(.01), 0);

    equip('special_valkyrie_railgun');
    draw();
    assert.equal(draws.length, 0, 'Valkyrie retains its own appearance despite sharing a silhouette');
    assert.ok(fills > 0);
    images[0].onerror();
    equip('railgun_mk1');
    draw();
    assert.ok(fills > 0, 'failed single atlas falls back');
    equip('railgun_mk2');
    draw();
    assert.equal(draws.length, 3, 'failed single atlas does not disable twin sprite');
  } finally {
    Turret2D.clear();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
