import test from 'node:test';
import assert from 'node:assert/strict';

// Wpięcie ładowania broni w sterowanie ogniem (zadanie 18-B, src/game/weaponCharge.js):
// gracz (PRAWDZIWE _fireSpecialGroup / updateSpecialWeaponCooldowns / stepSpecialCharge i HUD
// z index.html), P2 (WeaponController) i AI (capitalAI.processAutonomousWeapons). Mjolnir:
// 3 s ładowania tylko na postoju (|v| ≤ 30 j/s, |ω| ≤ 0,05 rad/s), Valkyrie 0,28 s; naciśnięcie
// klawisza tylko zgłasza strzał, ładowanie i strzał idą w kroku fizyki; efekt ładowania z
// receptury broni (WeaponFx.charge).
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { WeaponController, barrelsPerShotOf, queueSalvoBarrels, drainSalvoQueue } from '../src/game/weaponController.js';
import { getMountedWeaponAim } from '../src/game/weaponAim.js';
import * as C from '../src/game/weaponCharge.js';
import { createCarrier, writeCarrier } from '../src/game/carrierVelocity.js';
import { readIndexHtml, loadIndexFunction } from './helpers/indexSource.mjs';

globalThis.window = globalThis.window || {};
const { getLeadAim } = await import('../src/ai/aiUtils.js');
const html = readIndexHtml();
const DT = 1 / 120;

function fixture(weaponId, owner = 'player') {
  window.getLeadAim = getLeadAim;
  const loadouts = [-120, 120].map((y, i) => ({
    hp: { id: `${owner}-${weaponId}-${i}`, pos: { x: 30, y }, mount: weaponId, specialCd: 0 },
    weapon: MASTER_WEAPONS[weaponId]
  }));
  const ship = {
    isPlayer: true, angle: 0, angVel: 0, pos: { x: 100, y: 200 }, vel: { x: 0, y: 0 },
    visual: { spriteScale: 3 }, weapons: { special: loadouts },
    turret: { angle: 0, offset: { x: 0, y: 0 }, maxSpeed: 2.2, maxAccel: 12, damping: 3 }
  };
  const mouse = { x: 5000, y: 200 };
  const controller = new WeaponController({
    ship, owner, getMouseRef: () => mouse, getLockedTarget: () => null,
    getLockedTargets: () => [], setLockedTarget: () => {}, screenToWorldFn: (x, y) => ({ x, y })
  });
  for (let i = 0; i < 240; i++) controller.updateAim(DT);   // wieżyczki wycelowane
  return { ship, loadouts, mouse, controller };
}

// Gracz P1: funkcje z index.html w jednej piaskownicy.
function p1Game(f) {
  const shots = [];
  const messages = [];
  const fx = { charges: 0, available: true };
  const scope = {
    Game: { player: { weapons: f.ship.weapons } }, HP: { SPECIAL: 'special', SPECIAL_MISSILE: 'special_missile' },
    ship: f.ship, p1WeaponCtrl: f.controller, getMountedWeaponAim,
    getCombinedSpecialLoadouts: () => f.ship.weapons.special,
    barrelsPerShotOf, queueSalvoBarrels, drainSalvoQueue,
    chargeTimeOf: C.chargeTimeOf, mountChargeState: C.mountChargeState, requestMountCharge: C.requestMountCharge,
    stepMountCharge: C.stepMountCharge, cancelMountCharge: C.cancelMountCharge,
    CHARGE_FIRE: C.CHARGE_FIRE, CHARGE_CHARGING: C.CHARGE_CHARGING,
    WeaponFx: {
      get available() { return fx.available; },
      createChargeState: () => ({ arcT: 0 }),
      charge(id, x, y, a, s, u, dt, st) { fx.charges++; assert.ok(st && typeof st.arcT === 'number'); assert.ok(u >= 0 && u <= 1); }
    },
    writeCarrier, _chargeCarrier: createCarrier(),
    warp: { busy: false, isBusy() { return this.busy; } },
    pushZoneMessage: (text) => messages.push(text),
    isTargetAlive: (t) => !!t && !t.dead,
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    window: { fireWeaponCore: (ship, target, id) => { shots.push({ id, t: scope.t }); return MASTER_WEAPONS[id].cooldown; } },
    t: 0
  };
  const load = (header, name) => { scope[name] = loadIndexFunction(html, header, name, scope); };
  load('function fireSpecialBarrel(loadout, hp, slot, barrelIndex, multiBarrel) {', 'fireSpecialBarrel');
  load('function fireSpecialLoadout(loadout, hp, slot) {', 'fireSpecialLoadout');
  load('function pushSpecialChargeMessage(weapon, event) {', 'pushSpecialChargeMessage');
  load('function stepSpecialCharge(loadout, hp, slot, dt) {', 'stepSpecialCharge');
  load('function updateSpecialWeaponCooldowns(dt) {', 'updateSpecialWeaponCooldowns');
  load('function _fireSpecialGroup(loadouts, manual = false) {', '_fireSpecialGroup');
  load('function tryFireMountedSpecialWeapons(manual = false) {', 'tryFireMountedSpecialWeapons');
  load('function _specialHudFromEntries(entries) {', '_specialHudFromEntries');
  // Krok fizyki: celowanie (p1WeaponCtrl.updateAim), potem przeładowanie i ładowanie.
  const step = (n = 1, each = null) => {
    for (let k = 0; k < n; k++) {
      scope.t += DT;
      if (each) each(scope.t);
      f.controller.updateAim(DT);
      scope.updateSpecialWeaponCooldowns(DT);
    }
  };
  return { scope, shots, messages, fx, step };
}

test('gracz: Mjolnir na postoju — naciśnięcie, 3 s ładowania (efekt z receptury, pasek HUD), strzał z obu zaczepów', () => {
  const f = fixture('siege_railgun');
  const g = p1Game(f);
  assert.equal(g.scope.tryFireMountedSpecialWeapons(true), true, 'naciśnięcie przyjęte (bez strzału)');
  assert.equal(g.shots.length, 0, 'bez strzału od razu');
  g.step(180);
  const hudMid = g.scope._specialHudFromEntries(f.ship.weapons.special);
  assert.equal(g.shots.length, 0, 'po 1,5 s nadal ładuje');
  assert.equal(hudMid.charging, true);
  assert.ok(Math.abs(hudMid.charge - 0.5) < 0.02, `pasek HUD = postęp ładowania: ${hudMid.charge}`);
  g.step(190);
  assert.equal(g.shots.length, 2, 'strzał z obu zaczepów');
  const tShot = g.shots[0].t;
  assert.ok(tShot >= 3.0 && tShot <= 3.0 + 2 * DT + 1e-9, `strzał po 3 s: ${tShot}`);
  assert.ok(g.fx.charges > 600, `efekt ładowania co krok na zaczep: ${g.fx.charges}`);
  assert.deepEqual(g.messages, ['MJOLNIR: ŁADOWANIE — OKRĘT MUSI STAĆ']);
  // Przeładowanie 8 s: naciśnięcie w trakcie nic nie robi, po nim — nowe ładowanie 3 s.
  g.scope.tryFireMountedSpecialWeapons(true);
  g.step(120);
  assert.equal(g.shots.length, 2);
  g.step(Math.ceil((8 - 1) / DT) + 4);
  g.scope.tryFireMountedSpecialWeapons(true);
  const t1 = g.scope.t;
  g.step(Math.ceil(3.1 / DT));
  assert.equal(g.shots.length, 4);
  assert.ok(g.shots[2].t - t1 >= 3.0 - 1e-9 && g.shots[2].t - t1 <= 3.0 + 2 * DT + 1e-9, 'cykl: 3 s ładowania po 8 s przeładowania');
});

test('gracz: Mjolnir w ruchu nie ładuje (komunikat), ruch w trakcie przerywa ładowanie', () => {
  const f = fixture('siege_railgun');
  const g = p1Game(f);
  f.ship.vel.x = 120;
  g.scope.tryFireMountedSpecialWeapons(true);
  g.step(600);
  assert.equal(g.shots.length, 0);
  assert.deepEqual(g.messages, ['MJOLNIR: WYMAGA POSTOJU OKRĘTU']);
  // Postój — ładuje; obrót 0,2 rad/s w połowie — przerwane.
  f.ship.vel.x = 0;
  g.messages.length = 0;
  g.scope.tryFireMountedSpecialWeapons(true);
  g.step(180);
  assert.equal(g.scope._specialHudFromEntries(f.ship.weapons.special).charging, true);
  f.ship.angVel = 0.2;
  g.step(1);
  f.ship.angVel = 0;
  g.step(600);
  assert.equal(g.shots.length, 0, 'przerwane ładowanie nie strzela');
  // Jeden komunikat na krok dla grupy (dwa zaczepy tej samej broni).
  assert.deepEqual(g.messages, ['MJOLNIR: ŁADOWANIE — OKRĘT MUSI STAĆ', 'MJOLNIR: WYMAGA POSTOJU OKRĘTU']);
  assert.equal(g.scope._specialHudFromEntries(f.ship.weapons.special).charging, undefined, 'HUD wraca do paska przeładowania');
});

test('gracz: Valkyrie 0,28 s także w ruchu; auto-fire co krok bez komunikatów; skok przerywa', () => {
  const f = fixture('special_valkyrie_railgun');
  const g = p1Game(f);
  f.ship.vel.x = 400;
  // Ładowanie rusza w pierwszym kroku po zgłoszeniu (czas liczony od początku tego kroku).
  const t0 = g.scope.t;
  for (let k = 0; k < 60 && g.shots.length === 0; k++) g.step(1, () => g.scope.tryFireMountedSpecialWeapons(false));
  assert.equal(g.shots.length, 2);
  assert.ok(g.shots[0].t - t0 >= 0.28 - 1e-9 && g.shots[0].t - t0 <= 0.28 + 2 * DT + 1e-9, `Valkyrie po 0,28 s: ${g.shots[0].t - t0}`);
  assert.deepEqual(g.messages, [], 'auto-fire bez komunikatów, Valkyrie < 1 s bez komunikatu startu');
  // Skok w trakcie ładowania: przerwane, bez strzału.
  g.step(Math.ceil(3.2 / DT));
  g.scope.tryFireMountedSpecialWeapons(true);
  g.step(10);
  g.scope.warp.busy = true;
  g.step(60);
  g.scope.warp.busy = false;
  g.step(60);
  assert.equal(g.shots.length, 2, 'skok przerwał ładowanie');
});

test('źródło: klawisze 2 i 5 to naciśnięcia (komunikaty), auto-fire bez; broń bez chargeTime strzela od razu', () => {
  assert.match(html, /tryFireMountedSpecialWeapons\(true\);/);
  assert.match(html, /tryFireSpecialMissiles\(true\);/);
  const f = fixture('special_yamato_cannon');
  const g = p1Game(f);
  g.scope.tryFireMountedSpecialWeapons(true);
  assert.equal(g.shots.length, 2, 'Yamato bez ładowania — jak dotąd');
  assert.equal(g.fx.charges, 0);
});

test('P2 (WeaponController): Mjolnir ładuje 3 s w update(), strzela z obu zaczepów', () => {
  const f = fixture('siege_railgun', 'player2');
  const shots = [];
  window.fireWeaponCore = (ship, target, id) => { shots.push(id); return MASTER_WEAPONS[id].cooldown; };
  window.warp = { state: 'idle', isBusy: () => false };
  window.stationUI = { open: false };
  let charges = 0;
  window.WeaponFx = { available: true, createChargeState: () => ({ arcT: 0 }), charge: () => { charges++; } };
  try {
    assert.equal(f.controller.tryFireSpecialWeapons(), true);
    let steps = 0;
    for (; steps < 800 && shots.length === 0; steps++) f.controller.update(DT);
    assert.equal(shots.length, 2);
    assert.ok(Math.abs(steps * DT - 3.0) <= 2 * DT, `P2 strzał po 3 s: ${steps * DT}`);
    assert.ok(charges > 600);
    f.ship.vel.x = 100;
    f.controller.tryFireSpecialWeapons();
    for (let k = 0; k < 2000; k++) f.controller.update(DT);
    assert.equal(shots.length, 2, 'w ruchu Mjolnir P2 nie strzela');
  } finally {
    delete window.fireWeaponCore; delete window.WeaponFx; delete window.warp; delete window.stationUI;
  }
});

test('AI: działo z chargeTime ładuje przed strzałem (Valkyrie 0,28 s), Mjolnir tylko na postoju', async () => {
  const { processAutonomousWeapons } = await import('../src/ai/capitalAI.js');
  const run = async (weaponId, npcVx, seconds) => {
    const shots = [];
    const charges = [];
    const frigate = { type: 'frigate', x: 3000, y: 0, isPirate: true, friendly: false };
    globalThis.window = Object.assign(globalThis.window, {
      npcs: [frigate], bullets: [], __npcRocketThreats: [], __playerRocketThreats: [],
      wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
      getUnitKind: (t) => (t.type === 'frigate' ? 'frigate' : 'other'),
      hasShipChip: () => false, isLineOfFireBlocked: () => false,
      // Czas od początku pętli do KOŃCA kroku, w którym padł strzał.
      spawnBulletAdapter: (owner, target, def) => { shots.push({ t: clock + 0.05, id: def.id }); },
      spawnWeaponChargeFx: (owner, weapon, u) => { charges.push(u); }
    });
    const npc = {
      id: 'ai', x: 0, y: 0, vx: npcVx, vy: 0, angle: 0, angVel: 0, friendly: true,
      weapons: { main: [{ hp: { id: 'm0', type: 'main', x: 0, y: 0, mount: weaponId }, weapon: MASTER_WEAPONS[weaponId] }], aux: [], missile: [] }
    };
    let clock = 0;
    processAutonomousWeapons(npc, 0.05);
    npc.autoWeapons[0].cd = 0;
    for (; clock < seconds; clock += 0.05) processAutonomousWeapons(npc, 0.05);
    return { shots, charges, weapon: npc.autoWeapons[0] };
  };
  const vk = await run('special_valkyrie_railgun', 0, 1.0);
  assert.ok(vk.shots.length >= 1, 'Valkyrie NPC strzela');
  assert.ok(vk.shots[0].t >= 0.28 - 1e-9, `po ładowaniu: ${vk.shots[0].t}`);
  assert.ok(vk.charges.length >= 5 && vk.charges.every((u) => u >= 0 && u <= 1), 'efekt ładowania przez hak gry');
  const mjStill = await run('siege_railgun', 0, 4.0);
  assert.equal(mjStill.shots.length, 1);
  assert.ok(mjStill.shots[0].t >= 3.0 - 1e-9, `Mjolnir NPC po 3 s: ${mjStill.shots[0].t}`);
  const mjMoving = await run('siege_railgun', 200, 6.0);
  assert.equal(mjMoving.shots.length, 0, 'Mjolnir NPC w ruchu nie strzela');
  // Broń bez chargeTime — bez zmian (strzał bez ładowania, bez haka efektu).
  const rail = await run('railgun_mk2', 200, 0.2);
  assert.ok(rail.shots.length >= 1 && rail.charges.length === 0);
});
