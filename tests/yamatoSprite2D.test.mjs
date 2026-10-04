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

    // Yamato L (special_yamato_l, 2 lufy na salwę): wieża rodzica z DWIEMA SKRAJNYMI lufami — środkowa
    // kołyska pusta. Lufy salwy 0 / 1 wychodzą symetrycznie, każda narysowana lufa ma punkt wylotowy.
    const twinDef = MASTER_WEAPONS.special_yamato_l;
    const parentWeapons = entity.autoWeapons;
    Turret2D.clear();
    entity.autoWeapons = [{ def: twinDef, hpOffset: { x: 0, y: 0 }, visualAngle: Math.PI / 3 }];
    try {
      assert.equal(draw(), 1);
      assert.equal(fills, 0, 'twin uses the parent sprite, not procedural geometry');
      assert.equal(draws.length, 3, 'housing + two outer barrels');
      assert.equal(images.length, 1, 'twin shares the parent atlas');
      const spec = Turret2D.resolveSpec(twinDef.id, twinDef.category);
      assert.notEqual(spec, Turret2D.resolveSpec('special_yamato_cannon', 'plasma'));
      assert.deepEqual(spec.m, [[56, 6.75], [56, -6.75]]);
      const tips = [];
      for (const { args, matrix: [a, b, c, d, e, f] } of draws.slice(1)) {
        const [, , , , , x, y, width, height] = args;
        const tipX = a * (x + width) + c * (y + height / 2) + e - 400;
        const tipY = b * (x + width) + d * (y + height / 2) + f - 400;
        const muzzle = Turret2D.resolveMuzzle(Turret2D.findTurretKey(tipX, tipY, 'yamato'));
        assert.ok(Math.hypot(muzzle.x - tipX, muzzle.y - tipY) < 1e-6, 'twin barrel tip = gameplay muzzle');
        tips.push([tipX, tipY]);
      }
      assert.ok(Math.hypot(tips[0][0] - tips[1][0], tips[0][1] - tips[1][1]) > 1, 'two distinct barrels');
      // Symulacja: lufy salwy 0..barrelsPerShot−1 = skrajne lufy (symetrycznie), w skali broni L × klasa kadłuba.
      assert.equal(twinDef.barrelsPerShot, 2);
      const k = 1.02; // SCALE_BY_SIZE.L × Capital (atlas)
      const o0 = Turret2D.writeMuzzleOffset(entity, twinDef, 0, { x: 0, y: 0 });
      const o1 = Turret2D.writeMuzzleOffset(entity, twinDef, 1, { x: 0, y: 0 });
      assert.ok(Math.abs(o0.x - 56 * k) < 1e-9 && Math.abs(o1.x - 56 * k) < 1e-9);
      assert.ok(Math.abs(o0.y - 6.75 * k) < 1e-9 && Math.abs(o1.y + 6.75 * k) < 1e-9);
      // Rodzic bez zmian: trzy lufy, środkowa pod indeksem 1.
      const p1 = Turret2D.writeMuzzleOffset(entity, MASTER_WEAPONS.special_yamato_cannon, 1, { x: 0, y: 0 });
      assert.ok(Math.abs(p1.x - 58 * 1.75) < 1e-9 && Math.abs(p1.y) < 1e-9);
      const shot = Turret2D.triggerShot('yamato', 0, 0, entity);
      assert.ok(shot && shot.recoil === twinDef.recoil && shot.shake === twinDef.shake, 'odrzut i wstrząs z danych wariantu');
    } finally {
      Turret2D.clear();
      entity.autoWeapons = parentWeapons;
    }

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
