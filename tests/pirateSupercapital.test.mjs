import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHIPS, CAPITAL_SHIP_TEMPLATES, getHullRenderSize, resolveEntityHullProfileId } from '../src/data/ships.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { migratePirateSpriteLayout } from '../src/data/pirateSpriteMigration.js';
import { createNpcHardpointRuntime } from '../src/game/npcHardpointRuntime.js';
import { resolveNpcSpecFrameId, selectSpecSlots } from '../src/game/npcWeaponSpec.js';
import { getCallInHullFrame, getCallInSpawnPolicy, normalizeCallInSpawnMode } from '../src/game/callInSpawnPolicy.js';
import { resolveBridgeHullKey } from '../src/game/shipBridgeRuntime.js';
import { resolveShipFlightHullId } from '../src/game/flight/shipFlightModel.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { isPointDefenseWeapon } from '../src/ai/pointDefenseTargeting.js';
import { mountFireArc } from '../src/game/weaponAim.js';
import { readIndexHtml, loadIndexFunction } from './helpers/indexSource.mjs';

const id = 'pirate_supercapital';
const layout = SHIP_EDITOR_DEFAULTS.ships[id];
const spawnSource = readIndexHtml().replace('function spawnCallInShip(templateKey, opts = {}) {', 'function spawnCallInShip(templateKey, opts) {');
const spawn = loadIndexFunction(spawnSource, 'function spawnCallInShip(templateKey, opts) {', 'spawnCallInShip', {
  normalizeCallInSpawnMode, getSupportSpawnMode: () => 'friendly',
  spawnCapitalCallIn: (templateKey, options) => ({ templateKey, ...options })
});

test('spawn z menu dev domyślnie tworzy wroga, jawna zmiana strony pozostaje dostępna', () => {
  assert.equal(spawn(id, {}).mode, 'pirate');
  assert.equal(spawn(id, { mode: 'friendly' }).mode, 'friendly');
  assert.equal(spawn(id, { mode: 'dummy' }).mode, 'dummy');
});
const equip = loadIndexFunction(readIndexHtml(), 'function equipNpcWeapons(npc, faction) {', 'equipNpcWeapons', {
  SHIPS, MASTER_WEAPONS, resolveNpcSpecFrameId, selectSpecSlots
});
const aiSource = readFileSync(new URL('../src/ai/capitalAI.js', import.meta.url), 'utf8');
const initWeapons = loadIndexFunction(aiSource, 'function initAutonomousWeapons(npc) {', 'initAutonomousWeapons', {
  resolveMountShape: (npc) => ({ halfLen: 600, halfWid: 338 }), _mountShape: {},
  mountFireArc, MAIN_ARC_TOLERANCE: 0.12, getNextWeaponScanInterval: () => 0.2, isPointDefenseWeapon
});

test('piracki supercapital: ten sam kadłub dla spawnu, lotu, renderu, hardpointów i mostka', () => {
  const template = CAPITAL_SHIP_TEMPLATES[id];
  const policy = getCallInSpawnPolicy('pirate', template);
  assert.equal(policy.isPirate, true);
  assert.equal(policy.friendly, false);
  assert.equal(policy.registerFleet, false);
  assert.equal(getCallInHullFrame(id, policy, template), id);
  for (const npc of [{ type: id }, { type: 'supercapital', shipFrame: id }]) {
    assert.equal(resolveEntityHullProfileId(npc), id);
    assert.equal(resolveNpcSpecFrameId(npc, SHIPS), id);
    assert.equal(resolveBridgeHullKey(npc), id);
    assert.equal(resolveShipFlightHullId(npc), id);
  }
  assert.equal(getHullRenderSize(id, 1671, 941).w, 1200);
});

test('układ użytkownika: 6 MAIN, 9 SPECIAL, 4 AUX i po 4 dysze MAIN/SIDE', () => {
  const counts = layout.hardpoints.reduce((out, p) => { out[p.type] = (out[p.type] || 0) + 1; return out; }, {});
  assert.deepEqual(counts, { main: 6, special: 9, aux: 4 });
  assert.equal(layout.engines.main.length, 4);
  assert.equal(layout.engines.side.length, 4);
  assert.ok(layout.hardpoints.some((p) => p.id === 'm_kn6ptwj'));
  assert.ok(!layout.hardpoints.some((p) => p.id === 'm_elbzlpw'));
});

test('9 Goliathów jest uzbrojonych i przechodzi do aktywnych dział AI', () => {
  const npc = { type: id, shipFrame: id, isPirate: true };
  const runtime = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS.ships });
  assert.equal(runtime.applyLayoutToNpc(npc), true);
  equip(npc, 'pirate');
  assert.equal(npc.weapons.main.length, 6);
  assert.equal(npc.weapons.aux.length, 4);
  assert.equal(npc.weapons.special.length, 9);
  for (const w of npc.weapons.special) assert.equal(w.hp.mount, 'special_goliath_autocannon');
  initWeapons(npc);
  assert.equal(npc.autoWeapons.filter((w) => w.group === 'special' && w.id === 'special_goliath_autocannon').length, 9);
  assert.equal(npc.autoWeapons.length, 19);
});

test('stary zapis edytora usuwa tylko zatwierdzony duplikat, również przy odczycie NPC', () => {
  const original = structuredClone(layout);
  original.hardpoints.push({ id: 'm_elbzlpw', type: 'special', x: 177.55, y: 137.08 });
  const migrated = migratePirateSpriteLayout(id, original);
  assert.equal(original.hardpoints.length, 20);
  assert.equal(migrated.hardpoints.length, 19);
  assert.equal(migratePirateSpriteLayout(id, migrated), migrated);
  const nineSlots = { ...original, hardpoints: original.hardpoints.filter(p => p.id !== 'm_z3wjp20') };
  assert.equal(migratePirateSpriteLayout(id, nineSlots), nineSlots, '9 SPECIAL ma pozostać nawet z bliską parą');
  original.hardpoints.at(-1).x = 250;
  assert.equal(migratePirateSpriteLayout(id, original), original, 'przesunięte gniazdo ma pozostać');

  original.hardpoints.at(-1).x = 177.55;
  const savedStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify({ ships: { [id]: original } }) };
  try {
    const runtime = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS.ships });
    runtime.refreshCache(true);
    const npc = { type: id, isPirate: true };
    assert.equal(runtime.applyLayoutToNpc(npc), true);
    assert.equal(npc.editorHardpoints.length, 19);
    equip(npc, 'pirate');
    assert.equal(npc.weapons.special.length, 9);
  } finally {
    if (savedStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedStorage;
  }
});
