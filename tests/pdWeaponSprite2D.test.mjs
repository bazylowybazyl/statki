import test from 'node:test';
import assert from 'node:assert/strict';
import { Turret2D, normalizeWeaponFxKey } from '../src/vfx/turret2D.js';
import { PdWeaponSprite2D } from '../src/vfx/pdWeaponSprite2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

test('every auxiliary weapon has PD or existing CIWS artwork', () => {
  for (const def of Object.values(MASTER_WEAPONS)) {
    if (def.mountType === 'aux') {
      assert.ok(PdWeaponSprite2D.supports(def.id) || def.id === 'ciws_mk1' || def.id === 'ciws_mk2', def.id);
    } else assert.equal(PdWeaponSprite2D.supports(def.id), false, `${def.id}: other artwork retained`);
  }
});

test('PD sizes preserve player/NPC aim and muzzles, bounded recoil, shared loading and LOD', () => {
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
    if (npc) entity.autoWeapons = [{ def: weapon, hpOffset: { x: 12, y: -7 }, visualAngle: Math.PI / 3 }];
    else {
      entity.weapons = { aux: [{ weapon, hp: { x: 12, y: -7 } }] };
      entity.ciws = [{ angle: Math.PI / 3 }];
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
      ['laser_pd_mk1', 1, .52 * .94, 19],
      ['flak_s', 2, .52 * .92, 30], ['flak_m', 2, .76 * .92, 30],
      ['flak_l', 2, 1.02 * .92, 30], ['flak_capital', 2, 1.75 * .92, 30]
    ]) {
      equip(id);
      const loaded = PdWeaponSprite2D.isReady(id);
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
        if (!npc) assert.ok(Math.abs(scale - size) < 1e-9, `${id}: size retained`);
        assert.ok(Math.abs(Math.atan2(b, a) - Math.PI / 3) < 1e-9, 'auxiliary aim retained');
        const fxKey = normalizeWeaponFxKey(id);
        for (const barrel of draws.slice(1)) {
          const p = tip(barrel);
          const muzzle = Turret2D.resolveMuzzle(Turret2D.findTurretKey(p.x, p.y, fxKey, entity));
          assert.ok(Math.hypot(muzzle.x - p.x, muzzle.y - p.y) < 1e-6, `${id}: sprite matches projectile origin`);
        }
        for (const part of draws) {
          const [, x, y, w, h] = part.args;
          assert.ok(x >= 0 && y >= 0 && x + w <= 1254 && y + h <= 1254);
        }
        const rest = tip(draws[1]);
        for (let i = 0; i < 80; i++) {
          Turret2D.triggerShot(fxKey, rest.x, rest.y, entity); draw();
          const moved = tip(draws[1]);
          const distance = Math.hypot(rest.x - moved.x, rest.y - moved.y);
          assert.ok(distance > 0 && distance <= 3 * scale + 1e-6, `${id}: recoil stays in receiver`);
        }
        assert.equal(draw(3 / (radius * scale)), 1);
        assert.equal(draws.length, 0); assert.equal(fills, 1, 'distant blob LOD retained');
        assert.equal(draw(.001), 0);
      }
    }
    assert.equal(images.length, 3, 'five PD variants share three images across ships and shots');
    images[1].onerror();
    equip('flak_m'); draw(); assert.ok(fills > 0, 'failed family falls back at each size');
    equip('flak_capital'); draw(); assert.equal(draws.length, 3, 'other families unaffected');
    PdWeaponSprite2D.enabled = false;
    draw(); assert.equal(draws.length, 0); assert.ok(fills > 0);
  } finally {
    PdWeaponSprite2D.enabled = true;
    Turret2D.clear();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
