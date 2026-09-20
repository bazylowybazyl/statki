import test from 'node:test';
import assert from 'node:assert/strict';
import { Turret2D, normalizeWeaponFxKey } from '../src/vfx/turret2D.js';
import { LauncherSprite2D } from '../src/vfx/launcherSprite2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { getMountedWeaponAim } from '../src/game/weaponAim.js';

test('launcher atlases preserve every port, scale, aim, LOD and loading fallback', () => {
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
  const entity = { isPlayer: true, shipFrame: 'atlas', weapons: {} };
  function equip(id) {
    Turret2D.clear();
    const weapon = MASTER_WEAPONS[id];
    const loadout = { weapon, hp: { x: 12, y: -7 } };
    entity.weapons = { [weapon.mountType]: [loadout] };
    const aim = getMountedWeaponAim(entity, loadout);
    aim.angle = aim.previousAngle = Math.PI / 3;
  }
  function draw(zoom = 2) {
    draws.length = 0; fills = 0;
    Turret2D.beginFrame();
    Turret2D.sync(entity, 10, 20, .2, 1);
    return Turret2D.draw(ctx, { zoom });
  }
  function tip({ args, matrix: [a, b, c, d, e, f] }) {
    const [, , , , , x, y, w, h] = args;
    return { x: (a * (x + w) + c * (y + h / 2) + e - 400) / 2, y: (b * (x + w) + d * (y + h / 2) + f - 400) / 2 };
  }
  try {
    for (const [id, ports, size, radius] of [
      ['missile_rack', 3, .76, 23], ['fast_missile_rack', 3, .52, 23],
      ['osa_micro_missile', 1, .52, 12], ['supernova_missile', 2, 1.75, 32]
    ]) {
      equip(id);
      assert.equal(draw(), 1);
      assert.ok(fills > 0, 'procedural fallback while loading');
      images.at(-1).onload();
      assert.ok(LauncherSprite2D.isReady(id));
      draw();
      assert.equal(draws.length, ports + 1, id);
      assert.equal(fills, 0);
      const [a, b] = draws[0].matrix;
      assert.ok(Math.abs(Math.hypot(a, b) - size * .82 * 2) < 1e-9);
      assert.ok(Math.abs(Math.atan2(b, a) - Math.PI / 3) < 1e-9);
      const fxKey = normalizeWeaponFxKey(id);
      for (const pod of draws.slice(1)) {
        const p = tip(pod);
        const muzzle = Turret2D.resolveMuzzle(Turret2D.findTurretKey(p.x, p.y, fxKey));
        assert.ok(Math.hypot(muzzle.x - p.x, muzzle.y - p.y) < 1e-6, `${id}: port aligns with existing muzzle`);
        const [, x, y, w, h] = pod.args;
        assert.ok(x >= 0 && y >= 0 && x + w <= 1254 && y + h <= 1254);
      }
      const rest = tip(draws[1]);
      for (let i = 0; i < 20; i++) Turret2D.triggerShot(fxKey, rest.x, rest.y);
      draw();
      const moved = tip(draws[1]);
      const distance = Math.hypot(rest.x - moved.x, rest.y - moved.y);
      assert.ok(distance > 0 && distance <= 1.6 * size * .82 + 1e-6);
      assert.equal(draw(3 / (radius * size * .82)), 1);
      assert.equal(draws.length, 0);
      assert.equal(fills, 1);
      assert.equal(draw(.01), 0);
    }
    assert.equal(images.length, 4);
    images[0].onerror();
    equip('missile_rack'); draw(); assert.ok(fills > 0);
    equip('fast_missile_rack'); draw(); assert.equal(draws.length, 4);
    for (const id of ['siege_torpedo', 'siege_torpedo_mk2', 'torpedo_salvo']) {
      equip(id); draw();
      assert.equal(draws.length, 0, 'torpedo variants retain separate appearance');
      assert.ok(fills > 0);
    }
  } finally {
    Turret2D.clear();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

