// Utrata gniazda NPC (markHardpointDestroyed z index.html) przebudowuje wieże okrętu (capitalAI.initAutonomousWeapons).
// Działa, które zostały, wracają TYM SAMYM wpisem: przeładowanie, amunicja, ładowanie, cel i kąt lufy bez zmian.
// Dawniej każde stracone gniazdo dawało wszystkim wieżom przeładowanie 0–2 s i pełną amunicję — promień śmierci
// Colossusa był znów gotowy po 0–2 s zamiast 45 s, a wyrzutnie dostawały rakiety (brief docs/BRIEF-drednot.md § 5.1).
// node --test tests/npcWeaponRebuild.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const { getLeadAim } = await import('../src/ai/aiUtils.js');
const { processAutonomousWeapons } = await import('../src/ai/capitalAI.js');
const { readIndexHtml, loadIndexFunction } = await import('./helpers/indexSource.mjs');

const DT = 0.05;

// Prawdziwa funkcja gry; obrażenia kadłuba za stracone gniazdo poza testem.
const markHardpointDestroyed = loadIndexFunction(readIndexHtml(),
  'function markHardpointDestroyed(entity, hp, hardpointCount) {', 'markHardpointDestroyed', {
    ship: {}, computeHardpointHullDamage: () => 0, applyDamageToPlayer() {}, applyDamageToNPC() {}
  });

// Pusta scena: bez wrogów wieże tylko odliczają przeładowanie i wracają lufą do spoczynku.
function setWorld() {
  Object.assign(globalThis.window, {
    npcs: [], bullets: [], __npcRocketThreats: [], __playerRocketThreats: [], ship: null,
    wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    getUnitKind: () => 'other',
    hasShipChip: () => false,
    getLeadAim,
    isLineOfFireBlocked: () => false,
    spawnBulletAdapter() {},
    spawnWeaponChargeFx() {}
  });
}

// Okręt z wieżami kilku grup: trzy działa main, wyrzutnia z magazynkiem, wieża promienia śmierci (jak Colossus).
function warship() {
  const hp = (id, type, x, y, mount, extra = {}) => ({ id, type, x, y, mount, ...extra });
  const hps = [
    hp('m1', 'main', 200, -120, 'railgun_mk2'),
    hp('m2', 'main', 200, 120, 'railgun_mk2'),
    hp('m3', 'main', -150, -120, 'railgun_mk2'),
    hp('r1', 'missile', 0, -60, 'missile_rack', { maxAmmo: 12 }),
    hp('b1', 'builtin', 700, 0, 'death_ray', { rot: 90 })
  ];
  const npc = {
    id: 'colossus', type: 'supercapital', x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0,
    friendly: true, radius: 500, editorHardpoints: hps,
    weapons: { main: [], aux: [], missile: [], hangar: [], special: [], special_missile: [], builtin: [] }
  };
  for (const h of hps) npc.weapons[h.type].push({ hp: h, weapon: MASTER_WEAPONS[h.mount] });
  return npc;
}

const byHp = (npc, id) => npc.autoWeapons.find((w) => w.hpOffset?.id === id);
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('utrata gniazda NPC nie zeruje przeładowań ani amunicji pozostałych wież', () => {
  setWorld();
  const npc = warship();
  processAutonomousWeapons(npc, DT);
  assert.equal(npc.autoWeapons.length, 5);

  // Stan w walce: promień tuż po strzale (przeładowanie 45 s), wyrzutnia z resztką rakiet, działa w różnych fazach.
  const ray = byHp(npc, 'b1');
  ray.cd = 40;
  ray.visualAngle = 0.3;
  const rack = byHp(npc, 'r1');
  rack.ammo = 2;
  rack.cd = 5;
  byHp(npc, 'm2').cd = 0.7;
  byHp(npc, 'm3').cd = 0.4;

  assert.equal(markHardpointDestroyed(npc, npc.editorHardpoints[0], npc.editorHardpoints.length), true);
  assert.equal(npc._weaponsInit, false, 'gra przebudowuje wieże po utracie gniazda');
  processAutonomousWeapons(npc, DT);

  assert.equal(npc.autoWeapons.length, 4);
  assert.equal(byHp(npc, 'm1'), undefined, 'stracone gniazdo znika z wież');
  const rayNow = byHp(npc, 'b1');
  const rackNow = byHp(npc, 'r1');
  assert.ok(near(rayNow.cd, 40 - DT), `promień: przeładowanie ${rayNow.cd}, oczekiwane ${40 - DT}`);
  assert.ok(near(rackNow.cd, 5 - DT), `wyrzutnia: przeładowanie ${rackNow.cd}`);
  assert.equal(rackNow.ammo, 2, 'wyrzutnia nie dostaje nowych rakiet');
  assert.ok(near(byHp(npc, 'm2').cd, 0.7 - DT));
  assert.ok(near(byHp(npc, 'm3').cd, 0.4 - DT));
  assert.equal(rayNow, ray, 'wieża, która została, to ten sam wpis (ładowanie i cel jadą z nim)');
  assert.equal(rackNow, rack);
  // Bez celu lufa wraca do spoczynku płynnie (3 · dt na krok), a nie skokiem z nowego wpisu.
  assert.ok(near(ray.visualAngle, 0.3 - 0.3 * 3 * DT), `kąt lufy promienia ${ray.visualAngle}`);
});

test('nowa broń w tym samym gnieździe dostaje nowy wpis z własnym magazynkiem', () => {
  setWorld();
  const npc = warship();
  processAutonomousWeapons(npc, DT);
  const rack = byHp(npc, 'r1');
  rack.ammo = 0;

  const hp = npc.editorHardpoints[3];
  hp.mount = 'fast_missile_rack';
  npc.weapons.missile = [{ hp, weapon: MASTER_WEAPONS.fast_missile_rack }];
  npc._weaponsInit = false;
  processAutonomousWeapons(npc, DT);

  const fresh = byHp(npc, 'r1');
  assert.notEqual(fresh, rack);
  assert.equal(fresh.id, 'fast_missile_rack');
  assert.equal(fresh.ammo, 12, 'magazynek z gniazda (maxAmmo)');
  assert.ok(fresh.cd < 2, `nowa broń startuje z przeładowaniem 0–2 s, jest ${fresh.cd}`);
  assert.equal(npc.autoWeapons.length, 5);
});
