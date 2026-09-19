import test from 'node:test';
import assert from 'node:assert/strict';
import { Turret2D } from '../src/vfx/turret2D.js';
import { YamatoSprite2D } from '../src/vfx/yamatoSprite2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

test('Yamato atlas preserves muzzle placement, fallback, and distant LOD', () => {
  const previous = { window: globalThis.window, Image: globalThis.Image, Path2D: globalThis.Path2D };
  const images = [];
  globalThis.Image = class {
    constructor() { images.push(this); }
    naturalWidth = 1254;
    naturalHeight = 1254;
  };
  globalThis.Path2D = class {
    roundRect() {} rect() {} moveTo() {} arc() {} lineTo() {} closePath() {}
  };
  globalThis.window = {
    worldToScreen: (x, y, cam) => ({ x: 400 + x * cam.zoom, y: 400 + y * cam.zoom })
  };
  let matrix, fills = 0;
  const draws = [];
  const ctx = {
    canvas: { width: 800, height: 800 }, save() {}, restore() {},
    setTransform(...args) { matrix = args; },
    fill() { fills++; },
    drawImage(...args) { draws.push({ args, matrix }); }
  };
  const entity = {
    shipFrame: 'atlas',
    autoWeapons: [{ def: MASTER_WEAPONS.special_yamato_cannon, hpOffset: { x: 0, y: 0 }, visualAngle: Math.PI / 3 }]
  };
  function draw(zoom = 1) {
    fills = 0;
    draws.length = 0;
    Turret2D.beginFrame();
    Turret2D.sync(entity, 0, 0, 0, 1);
    return Turret2D.draw(ctx, { zoom });
  }

  try {
    assert.equal(draw(), 1);
    assert.ok(fills > 0, 'procedural gun remains visible while the atlas loads');
    assert.equal(draws.length, 0);
    assert.equal(images.length, 1);
    images[0].onload();
    assert.equal(draw(), 1);
    assert.equal(fills, 0, 'loaded sprite replaces, rather than covers, procedural geometry');
    assert.equal(draws.length, 4);

    // All three barrel tips must meet the existing gameplay/VFX muzzle positions,
    // including the weapon size multiplier and a nonzero turret rotation.
    for (const { args, matrix: [a, b, c, d, e, f] } of draws.slice(1)) {
      const [, , , , , x, y, width, height] = args;
      const tipX = a * (x + width) + c * (y + height / 2) + e - 400;
      const tipY = b * (x + width) + d * (y + height / 2) + f - 400;
      const key = Turret2D.findTurretKey(tipX, tipY, 'yamato');
      const muzzle = Turret2D.resolveMuzzle(key);
      assert.ok(Math.hypot(muzzle.x - tipX, muzzle.y - tipY) < 1e-6);
    }
    Turret2D.triggerShot('yamato', 0, 0);
    draw();
    assert.ok(draws.length > 0, 'sprite remains drawable during recoil');

    assert.equal(draw(0.04), 1);
    assert.equal(draws.length, 0, 'distant guns use the cheap silhouette');
    assert.equal(fills, 1);
    assert.equal(draw(0.01), 0);
    assert.equal(draws.length, 0);
    assert.equal(fills, 0);
    assert.equal(images.length, 1, 'atlas is shared across frames and zoom levels');

    images[0].onerror();
    assert.equal(draw(), 1);
    assert.ok(fills > 0, 'failed atlas keeps the procedural gun visible');
    assert.equal(draws.length, 0);
  } finally {
    Turret2D.clear();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
