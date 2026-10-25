import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIP_RANGE_PROFILES, shipRangeClassOf, shipMinZoom } from '../src/data/shipRanges.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { weaponRangeFor, setModifierSource, setModifierSourceWithClasses } from '../src/game/shipModifiers.js';
import { weaponRangeWithModule, fitStats } from '../src/game/fitStats.js';
import { moduleModifierSource } from '../src/data/shipModules.js';
import { visionRangeOf, createFogState, collectFogSources, stepFogEntities, fogHides } from '../src/game/fogOfWar.js';
import { syncCameraZoomLimits, stepCameraZoom } from '../src/game/cameraZoom.js';
import { resolveMainBatteryRange } from '../src/ai/capitalAiTuning.js';
import { readIndexHtml, loadIndexFunction } from './helpers/indexSource.mjs';

const HULLS = ['terran_frigate', 'terran_destroyer', 'terran_battleship', 'terran_carrier', 'atlas'];
const GUN = MASTER_WEAPONS.railgun_mk2;

test('ta sama broń M: krótka baza, rosnący bonus kadłuba, gracz i NPC mają równe zasięgi', () => {
  assert.equal(GUN.baseRange, 2250);
  assert.equal(GUN.size, 'M');
  const ranges = HULLS.map((hull) => {
    const player = { isPlayer: true, activeHullId: hull, type: 'atlas' };
    const npc = { isCapitalShip: true, shipFrame: hull, type: 'capital' };
    const r = weaponRangeFor(player, GUN, GUN.baseRange);
    assert.equal(weaponRangeFor(npc, GUN, GUN.baseRange), r);
    return r;
  });
  assert.deepEqual(ranges, [2250, 2812.5, 3375, 3937.5, 4500]);
  assert.equal(weaponRangeFor({ type: 'pirate_supercapital' }, GUN, GUN.baseRange), 4500);
  assert.equal(weaponRangeFor({ shipFrame: 'pirate_frigate' }, GUN, GUN.baseRange), 2250);
  assert.equal(shipRangeClassOf({ activeHullId: 'corvus', shipFrame: 'atlas', isPlayer: true }), 'frigate');
  assert.equal(shipRangeClassOf({ type: 'battleship', isCapitalShip: true }), 'battleship');
});

test('rakiety, torpedy i superbroń korzystają z premii; obrona punktowa i myśliwce zachowują własne pasma', () => {
  for (const id of ['missile_rack', 'siege_torpedo', 'hexlance_siege', 'death_ray', 'supernova_missile']) {
    const d = MASTER_WEAPONS[id];
    assert.equal(weaponRangeFor({ activeHullId: 'atlas' }, d, d.baseRange), 2 * d.baseRange, id);
  }
  for (const d of Object.values(MASTER_WEAPONS)) {
    if (d.mountType !== 'aux' && d.mountType !== 'fighter') continue;
    assert.equal(weaponRangeFor({ activeHullId: 'atlas' }, d, d.baseRange), d.baseRange, d.id);
  }
});

test('karty wyposażenia i rzeczywisty zasięg uwzględniają ten sam kadłub, moduł i jego sufit', () => {
  const d = MASTER_WEAPONS.lance_rail_l;
  for (const hull of HULLS) {
    const e = { activeHullId: hull };
    setModifierSourceWithClasses(e, 'fit', moduleModifierSource('ballistic_computer'));
    const r = weaponRangeFor(e, d, d.baseRange);
    assert.equal(weaponRangeWithModule(d, 'ballistic_computer', hull), r);
    const stats = fitStats({ hullId: hull, hardpoints: [{ id: 'm', type: 'main', mount: d.id }],
      weapons: MASTER_WEAPONS, module: 'ballistic_computer' });
    assert.equal(stats.maxGun, r);
  }
  const e = { activeHullId: 'atlas' };
  setModifierSource(e, 'system', { range: 1.1 });
  setModifierSourceWithClasses(e, 'fit', { classRange: { sniper: 3 }, rangeCap: 18000 });
  assert.equal(weaponRangeFor(e, d, d.baseRange), 18000);
  assert.equal(weaponRangeFor(e, MASTER_WEAPONS.siege_railgun, MASTER_WEAPONS.siege_railgun.baseRange), 22000);
});

test('zmiana kadłuba gracza: wzrok i rzeczywista widoczność kontaktu od razu maleją', () => {
  const player = { isPlayer: true, type: 'atlas', activeHullId: 'atlas', pos: { x: 0, y: 0 } };
  const target = { type: 'frigate', x: 6000, y: 0, isPirate: true };
  const fog = createFogState();
  const check = () => {
    collectFogSources(fog, { player, npcs: [target] });
    stepFogEntities(fog, { player, npcs: [target] });
    return fogHides(fog, target, player);
  };
  assert.equal(check(), false);
  player.activeHullId = 'terran_frigate';
  assert.equal(check(), true);
  assert.deepEqual(HULLS.map((activeHullId) => visionRangeOf({ isPlayer: true, activeHullId })), [5000, 8000, 11000, 14000, 18000]);
  assert.equal(visionRangeOf({ type: 'supercapital', isCapitalShip: true }), 18000);
  assert.equal(visionRangeOf({ activeHullId: 'terran_frigate', sensors: { visionRange: 6500 } }), 6500);
});

test('kamera: Atlas zachowuje limit, mniejsze klasy mają ciaśniejszy kadr także z impulsem i w RTS', () => {
  assert.equal(shipMinZoom('atlas'), 0.035);
  const limits = HULLS.map(shipMinZoom);
  for (let i = 1; i < limits.length; i++) assert.ok(limits[i - 1] > limits[i]);
  assert.ok(shipMinZoom('terran_frigate') > shipMinZoom('atlas') * 3.5);
  const player = { activeHullId: 'atlas' };
  const camera = { mode: 'ship', zoom: 0.035, targetZoom: 0.035, minZoom: 0.035, maxZoom: 3.2 };
  const update = loadIndexFunction(readIndexHtml(), 'function updateCameraZoom(dt) {', 'updateCameraZoom', {
    camera, ship: player, syncCameraZoomLimits, stepCameraZoom, prevCameraState: { x: 0, y: 0 }
  });
  camera.zoomAnchor = { active: false };
  player.activeHullId = 'terran_frigate';
  update(1 / 60);
  assert.equal(camera.zoom, shipMinZoom(player));
  for (const mode of ['ship', 'rts']) {
    camera.mode = mode;
    camera.targetZoom = 0.001;
    camera.zoomImpulseLog = Math.log(0.1);
    update(1 / 60);
    assert.equal(camera.zoom, shipMinZoom(player));
    assert.equal(camera.targetZoom, shipMinZoom(player));
  }
  player.activeHullId = 'atlas';
  camera.zoomImpulseLog = 0;
  camera.targetZoom = 0.035;
  for (let i = 0; i < 120; i++) update(1 / 60);
  assert.equal(camera.zoom, 0.035);
});

test('AI dobiera dystans do efektywnego zasięgu i odświeża pamięć po zmianie kadłuba lub modułu', () => {
  const d = MASTER_WEAPONS.lance_rail_m;
  const npc = { shipFrame: 'terran_frigate', weapons: { main: [{ weapon: d }] } };
  assert.equal(resolveMainBatteryRange(npc), d.baseRange);
  npc.shipFrame = 'terran_battleship';
  assert.equal(resolveMainBatteryRange(npc), d.baseRange * SHIP_RANGE_PROFILES.battleship.weaponRange);
  setModifierSourceWithClasses(npc, 'fit', moduleModifierSource('ballistic_computer'));
  assert.equal(resolveMainBatteryRange(npc), d.baseRange * 1.5 * 1.5);
});

test('rzeczywiste rakiety salwy mają zasięg kadłuba, także poniżej dawnej podłogi 3 km', async () => {
  globalThis.window = globalThis.window || {};
  const { initRocketSystem3D } = await import('../src/game/rockets/rocketSim.js');
  const system = initRocketSystem3D(null);
  try {
    const def = MASTER_WEAPONS.osa_micro_missile;
    for (const hull of HULLS) {
      const shooter = { activeHullId: hull, x: 0, y: 0, angle: 0 };
      const target = { x: 1000, y: 0, radius: 50 };
      assert.equal(system.fireSalvo(shooter, 0, 0, target, 1, def), 1);
      const rocket = system.rockets.findLast((r) => r.active);
      assert.equal(rocket.maxRange, weaponRangeFor(shooter, def, def.baseRange));
    }
    assert.ok(system.rockets[0].maxRange < 3000, 'krótka rakieta fregaty bez sztucznego wydłużenia');
  } finally {
    system.dispose();
  }
});

test('wieże NPC: ta sama broń nie sięga celu z fregaty, ale strzela do niego z większego kadłuba', async () => {
  globalThis.window = globalThis.window || {};
  const { processAutonomousWeapons } = await import('../src/ai/capitalAI.js');
  const target = { x: 3100, y: 0, radius: 30, type: 'battleship', isPirate: true, friendly: false };
  let shots = 0;
  Object.assign(window, {
    ship: null, npcs: [target], bullets: [], __npcRocketThreats: [], __playerRocketThreats: [],
    getUnitKind: () => 'battleship', wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    getAIPirateCandidates: () => [target], hasShipChip: () => false,
    isLineOfFireBlocked: () => false, spawnBulletAdapter: () => { shots++; }
  });
  for (const [hull, canHit] of [['terran_frigate', false], ['terran_battleship', true], ['atlas', true]]) {
    shots = 0;
    const npc = { shipFrame: hull, friendly: true, x: 0, y: 0, angle: 0,
      weapons: { main: [{ hp: { id: 'm', type: 'main', x: 0, y: 0, mount: GUN.id }, weapon: GUN }], aux: [], missile: [] } };
    processAutonomousWeapons(npc, 0);
    npc.autoWeapons[0].cd = 0;
    for (let i = 0; i < 30; i++) processAutonomousWeapons(npc, 0.05);
    assert.equal(shots > 0, canHit, hull);
  }
});
