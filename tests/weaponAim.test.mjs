import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { WeaponController } from '../src/game/weaponController.js';
import { getMountedWeaponAim, mountedWeaponBase, mountedWeaponRenderAngle, stepMountedWeaponAim } from '../src/game/weaponAim.js';
import { Turret2D } from '../src/vfx/turret2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { createPdBeamHit, resolvePdBeamHit } from '../src/game/pdBeamFastPath.js';
import { isPointDefenseWeapon } from '../src/ai/pointDefenseTargeting.js';
import { spatialCellKey } from '../src/game/spatialCellKey.js';

globalThis.window = {};
const { getLeadAim } = await import('../src/ai/aiUtils.js');
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// fireWeaponCore razem z pomocnikami trafień wiązek, które stoją tuż przed nim.
const coreStart = source.indexOf('    // --- Trafienia wiązek: pomocniki modułowe');
const coreEnd = source.indexOf('\n    function updateSpecialWeaponCooldowns', coreStart);
assert.ok(coreStart >= 0 && coreEnd > coreStart);

function fixture(group = 'special', weaponId = 'special_yamato_cannon', owner = 'player') {
  window.getLeadAim = getLeadAim;
  const loadouts = [-120, 120].map((y, i) => ({
    hp: { id: `${owner}-${i}`, pos: { x: 30, y }, mount: weaponId, ammo: 10 },
    weapon: MASTER_WEAPONS[weaponId]
  }));
  const ship = {
    isPlayer: true, angle: 0, pos: { x: 100, y: 200 }, vel: { x: 0, y: 0 },
    visual: { spriteScale: 3 }, weapons: { [group]: loadouts },
    turret: { angle: 1.7, offset: { x: 0, y: 0 }, maxSpeed: 2.2, maxAccel: 12, damping: 3 }
  };
  const mouse = { x: 500, y: 200 };
  const targets = [];
  const controller = new WeaponController({
    ship, owner, getMouseRef: () => mouse, getLockedTarget: () => targets[0] || null,
    getLockedTargets: () => targets, setLockedTarget: () => {}, screenToWorldFn: (x, y) => ({ x, y })
  });
  return { ship, loadouts, mouse, targets, controller };
}

function settle(controller) { for (let i = 0; i < 600; i++) controller.updateAim(1 / 60); }

test('each Yamato aims at the cursor from its own hardpoint, even on a scaled, rotated hull', () => {
  const { ship, loadouts, mouse, controller } = fixture();
  ship.angle = 0.8;
  settle(controller);
  for (const loadout of loadouts) {
    const base = mountedWeaponBase(ship, loadout.hp, {});
    const aim = getMountedWeaponAim(ship, loadout);
    close(aim.angle, Math.atan2(mouse.y - base.y, mouse.x - base.x));
    assert.notEqual(aim.angle, ship.turret.angle);
    assert.equal(getMountedWeaponAim(ship, { ...loadout }), aim, 'equipment refresh preserves the physical mount state');
  }
  assert.notEqual(getMountedWeaponAim(ship, loadouts[0]).angle, getMountedWeaponAim(ship, loadouts[1]).angle);
});

test('rotation keeps its speed limit, interpolates across +/-pi, and freezes during warp', () => {
  const state = { angle: Math.PI - 0.01, previousAngle: 0, angVel: 0 };
  const base = { x: 0, y: 0 };
  stepMountedWeaponAim(state, base, { x: -100, y: -5 }, 1 / 60);
  assert.ok(state.angVel > 0, 'turn through the short arc');
  assert.ok(Math.abs(state.angVel) <= 2.2);
  const angle = state.angle;
  stepMountedWeaponAim(state, base, { x: 100, y: 100 }, 0);
  assert.equal(state.angle, angle);
  assert.equal(state.previousAngle, angle);
  const f = fixture();
  const aim = getMountedWeaponAim(f.ship, f.loadouts[0]);
  aim.previousAngle = Math.PI - 0.1;
  aim.angle = -Math.PI + 0.1;
  close(mountedWeaponRenderAngle(f.ship, f.loadouts[0], 0.5), Math.PI);
});

test('rendered muzzles and simulated shots agree for every Yamato barrel, independent of visibility', () => {
  const { ship, loadouts, controller } = fixture();
  ship.angle = 0.6;
  settle(controller);
  Turret2D.enabled = true;
  Turret2D.beginFrame();
  Turret2D.sync(ship, ship.pos.x, ship.pos.y, ship.angle, ship.visual.spriteScale);
  for (const loadout of loadouts) {
    for (let barrel = 0; barrel < 3; barrel++) {
      const shot = controller.computeMountedMuzzle(loadout, barrel);
      const key = Turret2D.findTurretKey(shot.pos.x, shot.pos.y, 'yamato');
      const rendered = Turret2D.resolveMuzzle(key);
      close(rendered.x, shot.pos.x);
      close(rendered.y, shot.pos.y);
      close(Math.atan2(shot.dir.y, shot.dir.x), getMountedWeaponAim(ship, loadout).angle);
    }
  }
  const before = structuredClone(controller.computeMountedMuzzle(loadouts[0], 2));
  Turret2D.clear();
  Turret2D.enabled = false;
  assert.deepEqual(controller.computeMountedMuzzle(loadouts[0], 2), before);
  Turret2D.enabled = true;
});

test('main and special firing retain the assigned lock and current barrel angle during a cursor jump, for both players', () => {
  for (const owner of ['player', 'player2']) {
    for (const group of ['main', 'special', 'missile', 'special_missile']) {
      const f = fixture(group, group.includes('missile') ? 'missile_rack' : 'special_yamato_cannon', owner);
      f.targets.push({ x: 1000, y: 100 }, { x: 1000, y: 900 });
      settle(f.controller);
      const shots = [];
      window.fireWeaponCore = (ship, target, id, muzzle) => { shots.push({ target, muzzle: structuredClone(muzzle) }); return 1; };
      f.mouse.x = -9000;
      f.mouse.y = -9000;
      if (group === 'main') f.controller.fireRailBarrel(0);
      else if (group === 'missile') { f.controller.fireRocket('left'); f.controller.fireRocket('right'); }
      else f.controller.tryFireSpecialWeapons();
      assert.equal(shots.length, 2);
      shots.forEach((shot, i) => {
        const aim = getMountedWeaponAim(f.ship, f.loadouts[i]);
        assert.equal(shot.target, aim.target);
        close(Math.atan2(shot.muzzle.dir.y, shot.muzzle.dir.x), aim.angle);
      });
    }
  }
});

test('lead uses each weapon speed, locks are stable, dead/out-of-range main targets fall back to cursor', () => {
  const f = fixture('main', 'railgun_mk1');
  f.loadouts[1].weapon = MASTER_WEAPONS.special_yamato_cannon;
  const target = { x: 1000, y: 200, vx: 0, vy: 200 };
  f.targets.push(target);
  settle(f.controller);
  for (const loadout of f.loadouts) {
    const base = mountedWeaponBase(f.ship, loadout.hp, {});
    const lead = getLeadAim(base, target, loadout.weapon.baseSpeed);
    close(getMountedWeaponAim(f.ship, loadout).angle, Math.atan2(lead.y - base.y, lead.x - base.x));
  }
  target.x = 1e9;
  f.controller.updateAim(1 / 60);
  assert.equal(getMountedWeaponAim(f.ship, f.loadouts[0]).target, null);
  target.x = 1000;
  target.dead = true;
  settle(f.controller);
  const base = mountedWeaponBase(f.ship, f.loadouts[0].hp, {});
  close(getMountedWeaponAim(f.ship, f.loadouts[0]).angle, Math.atan2(f.mouse.y - base.y, f.mouse.x - base.x));
});

test('P1 index firing paths use the same simulated mount state as the shared controller', () => {
  for (const group of ['main', 'special']) {
    const f = fixture(group);
    settle(f.controller);
    const shots = [];
    const ctx = {
      ship: f.ship, p1WeaponCtrl: f.controller, getMountedWeaponAim,
      Game: { player: { weapons: f.ship.weapons } }, HP: { MAIN: 'main' },
      mainAutoFire: false, lockedTargets: [], rail: { cd: [0, 0], cdMax: 0.15 },
      CanvasVFX: { spawnArmataMuzzle() {} }, isTargetAlive: target => !!target && !target.dead,
      window: { fireWeaponCore: (ship, target, id, muzzle) => { shots.push(structuredClone(muzzle)); return 1; } }
    };
    const start = source.indexOf(group === 'main' ? '    function fireRailBarrel(' : '    function _fireSpecialGroup(');
    const end = source.indexOf('\n    function ', start + 1);
    vm.runInNewContext(source.slice(start, end), ctx);
    if (group === 'main') ctx.fireRailBarrel(0);
    else assert.equal(ctx._fireSpecialGroup(f.loadouts), true);
    assert.equal(shots.length, 2);
    shots.forEach((shot, i) => {
      close(Math.atan2(shot.dir.y, shot.dir.x), getMountedWeaponAim(f.ship, f.loadouts[i]).angle);
      const expected = f.controller.computeMountedMuzzle(f.loadouts[i], 0);
      close(shot.pos.x, expected.pos.x);
      close(shot.pos.y, expected.pos.y);
    });
  }
});

test('two players retain independent cursor and turn state', () => {
  const p1 = fixture();
  const p2 = fixture('special', 'special_yamato_cannon', 'player2');
  p2.mouse.x = -1000;
  p2.mouse.y = 600;
  settle(p1.controller);
  const before = getMountedWeaponAim(p1.ship, p1.loadouts[0]).angle;
  settle(p2.controller);
  assert.equal(getMountedWeaponAim(p1.ship, p1.loadouts[0]).angle, before);
  assert.notEqual(getMountedWeaponAim(p2.ship, p2.loadouts[0]).angle, before);
});

function firingCore(ship, owner = 'player') {
  const events = [];
  const context = {
    window: {
      ship: owner === 'player' ? ship : null, player2Ship: owner === 'player2' ? ship : null,
      bullets: [], mouse2: { x: -500, y: 900 }, screenToWorld: (x, y) => ({ x, y }),
      getLeadAim, dispatchEvent: event => events.push(event)
    },
    MASTER_WEAPONS, mouse: { x: -500, y: 900 }, targetingMode: { wheelOpen: false },
    isTargetAlive: target => !!target && !target.dead, scannerTargetPoint: target => target,
    isFlakWeapon: () => false, getPotentialPlanetaryRingTargets: null, DESTRUCTOR_CONFIG: {},
    createPdBeamHit, resolvePdBeamHit, isPointDefenseWeapon, spatialCellKey,
    getEntityShieldBlockingRadiusTowards: () => 0, findBeamHexShard: () => null, DestructorSystem: {},
    CustomEvent: class { constructor(type, data) { Object.assign(this, data); } },
    Math: Object.assign(Object.create(Math), { random: () => 0.5 })
  };
  vm.runInNewContext(source.slice(coreStart, coreEnd), context);
  return { ...context, events };
}

test('actual fireWeaponCore fires player bullets and beams along the muzzle, never snapping to cursor or lock', () => {
  for (const owner of ['player', 'player2']) {
    for (const target of [null, { x: -1000, y: -1000 }]) {
      const f = fixture('special', 'special_yamato_cannon', owner);
      f.controller.updateAim(1 / 60);
      const muzzle = structuredClone(f.controller.computeMountedMuzzle(f.loadouts[0]));
      const core = firingCore(f.ship, owner);
      core.window.fireWeaponCore(f.ship, target, 'special_yamato_cannon', muzzle);
      const bullet = core.window.bullets[0];
      close(bullet.vx, muzzle.dir.x * MASTER_WEAPONS.special_yamato_cannon.baseSpeed);
      close(bullet.vy, muzzle.dir.y * MASTER_WEAPONS.special_yamato_cannon.baseSpeed);
      assert.equal(bullet.x, muzzle.pos.x);
      const beamDef = Object.values(MASTER_WEAPONS).find(w => w.category === 'beam' && w.render3dOnly);
      core.window.fireWeaponCore(f.ship, target, beamDef.id, muzzle);
      const beam = core.events.at(-1).detail.beam;
      close(beam.endX - beam.startX, muzzle.dir.x * beamDef.baseRange);
      close(beam.endY - beam.startY, muzzle.dir.y * beamDef.baseRange);
    }
  }
});

test('NPC fireWeaponCore keeps its existing target-based aim', () => {
  const npc = { pos: { x: 0, y: 0 } };
  const core = firingCore(null);
  const muzzle = { pos: { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
  core.window.fireWeaponCore(npc, { x: 0, y: 1000 }, 'special_yamato_cannon', muzzle);
  close(core.window.bullets[0].vx, 0);
  close(core.window.bullets[0].vy, MASTER_WEAPONS.special_yamato_cannon.baseSpeed);
});
