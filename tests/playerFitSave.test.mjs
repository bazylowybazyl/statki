// Fit gracza w grze: WYPOSAŻENIE, zapis i F5 (docs/PLAN-fitowanie.md § 2.2, § 4.5–4.7).
//
// Prawdziwe funkcje z index.html (wycięte helperem indexSource) na sztucznym starcie strony w tej samej kolejności
// co gra: zapas startowy → applyPlayerHullProfile (start) → rebuildHardpointsForFrame → loadLoadout → (wczytany
// sprite) migawka → przebudowa → tryPreserveMounts → saveLoadout. „F5” = beforeunload → saveLoadout i nowa strona
// na tym samym localStorage. Pilnowane: magazyn + zamontowane = const przy save → load, migracja zapisu bez
// `weaponStock` i bez kompletów, gniazda po `id`, brak sztuki bez zmian w gnieździe, remont przywraca gniazda,
// uzupełnienie amunicji, kampania (karta startowa), karty WYPOSAŻENIA (z magazynu i z zakupem w porcie, moduły, system
// F, Komory rakietowe zmieniają typ gniazd), refit ręczny (montaż z zakupem brakujących sztuk), własne konfiguracje.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readIndexHtml, loadIndexFunction, sliceFunction } from './helpers/indexSource.mjs';
import { MASTER_WEAPONS, weaponFitsHardpointSize } from '../src/data/weapons.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import {
  addHangarSquadronMount,
  getHangarSquadronCapacity,
  getSquadronIdForHangarModule,
  normalizeHangarSquadronMounts
} from '../src/data/fighterSquadrons.js';
import { WeaponInventory } from '../src/game/weaponInventory.js';
import { normalizeHullChips, serializeHullChips } from '../src/game/shipChips.js';
import { assignHardpointEntries, restoreWeaponStock, serializeWeaponStock } from '../src/game/loadoutSave.js';
import * as HardpointService from '../src/game/hardpointService.js';
import { FIT_PRESETS, FIT_PRESET_IDS, FIT_KIT_STOCK, FIT_KIT_PARTS, FIT_START_PRESET } from '../src/data/fitPresets.js';
import * as ShipModules from '../src/data/shipModules.js';
import { shipSystemFor, shipSystemDefFor } from '../src/data/shipSystems.js';
import { planFit, presetFromHardpoints } from '../src/game/fitPlanner.js';
import { setModifierSourceWithClasses, clearModifierSource, weaponRangeFor } from '../src/game/shipModifiers.js';
import { weaponPriceAt, weaponBuildCost } from '../src/game/weaponEconomy.js';

const html = readIndexHtml();

function parseHpEnum() {
  const block = html.match(/const HP = \{([\s\S]*?)\n    \};/);
  assert.ok(block, 'nie znaleziono mapy HP w index.html');
  const out = {};
  for (const m of block[1].matchAll(/([A-Z_]+):\s*'([a-z_]+)'/g)) out[m[1]] = m[2];
  return out;
}

function parseDefaultStock() {
  const block = html.match(/const DEFAULT_INVENTORY_STOCK = \{([\s\S]*?)\n    \};/);
  assert.ok(block, 'nie znaleziono DEFAULT_INVENTORY_STOCK w index.html');
  const out = {};
  for (const m of block[1].matchAll(/([a-z0-9_]+):\s*(\d+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

const HP = parseHpEnum();
const DEFAULT_STOCK = parseDefaultStock();
const CAMPAIGN_MISSILE_AMMO_MUL = Number(html.match(/const CAMPAIGN_MISSILE_AMMO_MUL = ([\d.]+);/)[1]);
const FIT_MAX_CUSTOMS_PER_HULL = Number(html.match(/const FIT_MAX_CUSTOMS_PER_HULL = (\d+);/)[1]);
// Zapas po czystym starcie: DEFAULT_INVENTORY_STOCK + komplety kart (misja startowa, D2).
const START_WITH_KITS = (() => {
  const out = { ...DEFAULT_STOCK };
  for (const [id, n] of Object.entries(FIT_KIT_STOCK)) out[id] = (out[id] || 0) + n;
  return out;
})();
// Kadłub Atlasa z katalogu (tarcza do modułu „Wzmacniacz tarcz”).
const ATLAS_SHIELD = { max: 18000, regenRate: 300, regenDelay: 3, hardness: 2.5 };

// Układ gniazd Atlasa jak buildPlayerDefaultEditorHardpoints: stałe id markerów edytora, rozmiar Capital.
function atlasHardpoints() {
  return SHIP_EDITOR_DEFAULTS.ships.atlas.hardpoints.map(m => ({
    id: m.id,
    type: String(m.type).toLowerCase(),
    size: 'Capital',
    pos: { x: Number(m.x) || 0, y: Number(m.y) || 0, rot: 0 },
    mount: null,
    ammo: null,
    maxAmmo: null
  }));
}

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }
  };
}

// Port z magazynem na setki sztuk każdej broni (ceny i zdejmowanie składników — prawdziwe weaponEconomy.js).
function richStation() {
  const resources = {};
  for (const id of Object.keys(MASTER_WEAPONS)) {
    for (const [res, qty] of Object.entries(weaponBuildCost(id) || {})) resources[res] = (resources[res] || 0) + qty * 200;
  }
  return { id: 'port-test', factionId: null, econ: { resources } };
}

const INDEX_FUNCTIONS = [
  ['function getHardpointSize(hp, ship = Game.player) {', 'getHardpointSize'],
  ['function canMountWeaponOnHardpoint(weapon, hp, ship = Game.player) {', 'canMountWeaponOnHardpoint'],
  ['function isHangarSquadronWeapon(weapon) {', 'isHangarSquadronWeapon'],
  ['function getHardpointHangarCapacity(hp, shipRef = Game.player) {', 'getHardpointHangarCapacity'],
  ['function getHardpointHangarSquadrons(hp, shipRef = Game.player) {', 'getHardpointHangarSquadrons'],
  ['function setHardpointHangarSquadrons(hp, moduleIds) {', 'setHardpointHangarSquadrons'],
  ['function setHardpointMount(hp, weaponId, opts = {}) {', 'setHardpointMount'],
  ['function reclaimMountedWeaponsToInventory() {', 'reclaimMountedWeaponsToInventory'],
  ['function rebuildHardpointsForFrame() {', 'rebuildHardpointsForFrame'],
  ['function autoMountDefaults() {', 'autoMountDefaults'],
  ['function mountFirstFree(type, weaponId, howMany, fitOnly = false) {', 'mountFirstFree'],
  ['function equipCampaignLoadout() {', 'equipCampaignLoadout'],
  ['function restoreHardpointMountEntry(hp, entry, opts = {}) {', 'restoreHardpointMountEntry'],
  ['function snapshotPlayerHardpoints() {', 'snapshotPlayerHardpoints'],
  ['function savedHardpointBucket(saved) {', 'savedHardpointBucket'],
  ['function hardpointEntryToMount(saved) {', 'hardpointEntryToMount'],
  ['function tryPreserveMounts(previous) {', 'tryPreserveMounts'],
  ['function saveLoadout() {', 'saveLoadout'],
  ['function loadLoadout() {', 'loadLoadout'],
  ['function addHangarSquadronToHardpoint(hp, weaponId) {', 'addHangarSquadronToHardpoint'],
  ['function applyWeaponToHardpoint(hp, weaponId, options = null) {', 'applyWeaponToHardpoint'],
  ['function playerWeaponAmmo(weaponId) {', 'playerWeaponAmmo'],
  ['function refillPlayerAmmo() {', 'refillPlayerAmmo'],
  ['function markHardpointDestroyed(entity, hp, hardpointCount) {', 'markHardpointDestroyed'],
  ['function playerDockRepairQuote() {', 'playerDockRepairQuote'],
  ['function handleRepair() {', 'handleRepair'],
  ['function dockRemontShip(target) {', 'dockRemontShip'],
  ['function setPlayerShipSystem(id, hullId = PLAYER.activeHullId) {', 'setPlayerShipSystem'],
  // Blok „WYPOSAŻENIE” (karty, automat, moduły, części, refit ręczny).
  ['function playerFitModule(hullId = PLAYER.activeHullId) {', 'playerFitModule'],
  ['function safePlayerFitModule() {', 'safePlayerFitModule'],
  ['function playerSlotBaseType(hp) {', 'playerSlotBaseType'],
  ['function applyPlayerModuleSlotTypes(hardpoints, moduleId) {', 'applyPlayerModuleSlotTypes'],
  ['function applyPlayerShieldStats(hull, shieldRatio, hullId = PLAYER.activeHullId) {', 'applyPlayerShieldStats'],
  ['function applyPlayerModuleWeaponMods() {', 'applyPlayerModuleWeaponMods'],
  ['function applyPlayerModuleEffects() {', 'applyPlayerModuleEffects'],
  ['function setPlayerFitModule(moduleId) {', 'setPlayerFitModule'],
  ['function playerSystemIsBuiltin(id, hullId = PLAYER.activeHullId) {', 'playerSystemIsBuiltin'],
  ['function playerHasFitPart(id) {', 'playerHasFitPart'],
  ['function setPlayerFitSystem(id) {', 'setPlayerFitSystem'],
  ['function fitWeaponPrice(id, station = stationUI.station) {', 'fitWeaponPrice'],
  ['function fitPartPrice(id) {', 'fitPartPrice'],
  ['function fitStationCanSupply(econ, buyMap) {', 'fitStationCanSupply'],
  ['function fitBuyWeaponPiece(station, econ, id) {', 'fitBuyWeaponPiece'],
  ['function adjustStationStock(station, econ, key, delta) {', 'adjustStationStock'],
  ['function playerFitCurrentMount(hp) {', 'playerFitCurrentMount'],
  ['function playerFitSlots() {', 'playerFitSlots'],
  ['function playerFitFits(def, slot) {', 'playerFitFits'],
  ['function buildPlayerFitPlan(preset, mode, station = stationUI.station, opts = {}) {', 'buildPlayerFitPlan'],
  ['function applyPlayerFitPlan(plan, { station = stationUI.station, free = false, quiet = false, save = true } = {}) {', 'applyPlayerFitPlan'],
  ['function grantFitKits() {', 'grantFitKits'],
  ['function serializePlayerFitState() {', 'serializePlayerFitState'],
  ['function restorePlayerFitState(data) {', 'restorePlayerFitState'],
  ["function finishPlayerFitChange(presetId = 'custom') {", 'finishPlayerFitChange'],
  ['function fitUiMountSlots(ids, weaponId) {', 'fitUiMountSlots'],
  ['function fitUiSetModule(id) {', 'fitUiSetModule'],
  ['function fitUiSetSystem(id) {', 'fitUiSetSystem'],
  ['function fitUiCustoms() {', 'fitUiCustoms'],
  ['function fitUiSaveCustom() {', 'fitUiSaveCustom']
];

// Nowa strona: zapas startowy w ładowni, Atlas, gra w tej samej kolejności co index.html.
function bootPage(storage, { credits = 0 } = {}) {
  const toasts = [];
  const player = {
    inventory: new WeaponInventory(DEFAULT_STOCK),
    hardpoints: [],
    shipFrame: 'atlas',
    activeHullId: 'atlas',
    hull: { val: 12000, max: 12000 },
    shield: { val: ATLAS_SHIELD.max, max: ATLAS_SHIELD.max }
  };
  const scope = {
    HP, WEAPONS: MASTER_WEAPONS, Game: { player }, ship: player, console,
    window: { __SAVE_LOCKED: false },
    localStorage: storage,
    PLAYER: {
      activeHullId: 'atlas', hullChips: {}, credits,
      hullModules: {}, partStock: {}, hullPresets: {}, fitCustoms: [], kitsGranted: false, hullSystems: {}
    },
    DEFAULT_PLAYER_HULL_ID: 'atlas',
    SHIPS: { atlas: { id: 'atlas' } },
    PLAYER_HULL_CATALOG: { atlas: { id: 'atlas' } },
    CAMPAIGN_MISSILE_AMMO_MUL, FIT_MAX_CUSTOMS_PER_HULL,
    FIT_PRESETS, FIT_PRESET_IDS, FIT_KIT_STOCK, FIT_KIT_PARTS, FIT_START_PRESET,
    ...ShipModules,
    shipSystemFor, shipSystemDefFor,
    planFit, presetFromHardpoints,
    setModifierSourceWithClasses, clearModifierSource,
    weaponPriceAt, weaponBuildCost,
    trafficV2: null,
    getTradeEconomy: (station) => station?.econ || null,
    BASE_PLAYER_PROFILE: { shieldMax: 1000, shieldRegen: 20, shieldDelay: 3 },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    normalizePlayerHullId: (id) => String(id || 'atlas').toLowerCase(),
    getPlayerHullDef: () => ({ id: 'atlas', shipFrame: 'atlas', shield: ATLAS_SHIELD }),
    getPlayerOwnedHullIds: () => new Set(['atlas']),
    ensurePlayerOwnsHull: () => {},
    syncPlayerHullSnapshot: () => {},
    syncWeaponSystems: () => {},
    renderMechanic: () => {},
    updateMechanicCards: () => {},
    updateStationOverlay: () => {},
    stationUI: { tab: 'mechanic', station: null },
    toast: (m) => toasts.push(m),
    getPlayerHardpointBoundsForFrame: () => ({ w: 1, h: 1 }),
    generatePlayerHardpointsForFrame: () => atlasHardpoints(),
    buildPlayerDefaultEditorCores: () => [],
    buildPlayerDefaultEditorLights: () => [],
    getDefaultHardpointSize: () => 'Capital',
    weaponFitsHardpointSize, normalizeHangarSquadronMounts, addHangarSquadronMount,
    getHangarSquadronCapacity, getSquadronIdForHangarModule,
    normalizeHullChips, serializeHullChips,
    assignHardpointEntries, restoreWeaponStock, serializeWeaponStock,
    ...HardpointService,
    // Remont w doku: kadłub i dysze tu nieistotne (tests/hullRegrowth.test.mjs), gniazda — tak.
    HullBodies: { patchedCount: () => 0, restoreHull: () => {} },
    mainEngineCounts: (e, out) => { out.live = 4; out.total = 4; return out; },
    _engineCountsScratch: { live: 0, total: 0 },
    repairEngines: () => {},
    repairPatchCost: () => 0,
    ENGINE_REPAIR: { dockCostPerNozzle: 60 },
    computeHardpointHullDamage: () => 0,
    applyDamageToPlayer: () => {},
    applyDamageToNPC: () => {}
  };
  // System F kadłuba (w grze playerShipSystem z pamięcią i stanem zrywu — tu sam wybór).
  scope.playerShipSystem = () => {
    const hull = scope.PLAYER.activeHullId;
    return shipSystemDefFor(hull, scope.PLAYER.hullSystems[hull] || '') || shipSystemFor(hull);
  };
  // Kadłub gracza przy starcie i w loadLoadout: część o gniazdach (migawka → przebudowa → poprzedni fit).
  scope.applyPlayerHullProfile = () => {
    const previous = scope.snapshotPlayerHardpoints();
    scope.rebuildHardpointsForFrame();
    if (previous.length) scope.tryPreserveMounts(previous);
    return true;
  };
  for (const [header, name] of INDEX_FUNCTIONS) scope[name] = loadIndexFunction(html, header, name, scope);

  scope.applyPlayerHullProfile();      // start skryptu (persist: false)
  scope.rebuildHardpointsForFrame();   // koniec skryptu
  scope.loadLoadout();
  // Wczytany sprite (shipSprite.onload, już po loadLoadout): przebudowa tablicy z poprzednim fitem i zapis.
  const previous = scope.snapshotPlayerHardpoints();
  scope.rebuildHardpointsForFrame();
  scope.tryPreserveMounts(previous);
  scope.saveLoadout();
  return { scope, player, toasts };
}

// F5: beforeunload → saveLoadout, potem nowa strona na tym samym localStorage.
function reloadPage(page, storage, opts) {
  page.scope.saveLoadout();
  return bootPage(storage, opts);
}

const mounted = (player) => Object.fromEntries(player.hardpoints.map(hp => [hp.id, hp.mount || null]));
const slotsOf = (player, type) => player.hardpoints.filter(hp => hp.type === type);
// Gniazda po typie BAZOWYM (Komory rakietowe zmieniają typ gniazd special na missile).
const baseSlotsOf = (player, type) => player.hardpoints.filter(hp => (hp.baseType || hp.type) === type);
const countBy = (slots) => {
  const out = {};
  for (const hp of slots) if (hp.mount) out[hp.mount] = (out[hp.mount] || 0) + 1;
  return out;
};

// Sztuki broni liczone przez magazyn (bez eskadr hangarów — mają własny tor): magazyn + zamontowane.
function totals(player) {
  const out = { ...player.inventory.toObject() };
  for (const hp of player.hardpoints) {
    if (hp.type === HP.HANGAR || !hp.mount) continue;
    out[hp.mount] = (out[hp.mount] || 0) + 1;
  }
  for (const id of Object.keys(out)) if (MASTER_WEAPONS[id]?.mountType === HP.HANGAR) delete out[id];
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)));
}

// Części (moduły, silniki manewrowe): w hangarze + założone (system wbudowany kadłuba nie jest częścią).
function partTotals(scope) {
  const out = { ...scope.PLAYER.partStock };
  const mod = scope.PLAYER.hullModules.atlas;
  if (mod) out[mod] = (out[mod] || 0) + 1;
  const sys = scope.PLAYER.hullSystems.atlas;
  if (sys && !scope.playerSystemIsBuiltin(sys)) out[sys] = (out[sys] || 0) + 1;
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)));
}

function savedLoadout(storage) {
  return JSON.parse(storage.getItem('loadout'));
}

// ---------------------------------------------------------------------------

test('czysty start: karta UNIWERSALNA z kompletów, magazyn + zamontowane = zapas startowy + komplety, stan w zapisie', () => {
  const storage = memoryStorage();
  let page = bootPage(storage);
  const { player } = page;
  const startTotals = totals({ inventory: new WeaponInventory(START_WITH_KITS), hardpoints: [] });
  assert.deepEqual(totals(player), startTotals);
  assert.equal(slotsOf(player, HP.MAIN).length, 15);
  assert.equal(slotsOf(player, HP.MAIN).every(hp => hp.mount === 'tempest_ion_l'), true);
  assert.equal(slotsOf(player, HP.SPECIAL).every(hp => hp.mount === 'special_yamato_cannon'), true);
  assert.deepEqual(slotsOf(player, HP.MISSILE).map(hp => hp.mount), ['missile_rack', 'missile_rack']);
  assert.deepEqual(countBy(slotsOf(player, HP.AUX)), { ciws_mk1: 6, flak_capital: 4, laser_pd_mk1: 2, ciws_mk2: 2 });
  assert.equal(slotsOf(player, HP.BUILTIN)[0].mount, 'hexlance_siege');
  assert.equal(slotsOf(player, HP.SPECIAL_MISSILE)[0].mount, 'supernova_missile');
  const save = savedLoadout(storage);
  assert.deepEqual(save.weaponStock, player.inventory.toObject());
  assert.equal(save.weaponStock.railgun_mk2, DEFAULT_STOCK.railgun_mk2, 'działa fabryczne zdjęte do magazynu');
  assert.equal(save.kitsGranted, true);
  assert.deepEqual(save.partStock, FIT_KIT_PARTS);
  assert.deepEqual(save.hullPresets, { atlas: 'universal' });
  assert.deepEqual(save.hullModules, {});

  const fit = mounted(player);
  page = reloadPage(page, storage);
  assert.deepEqual(mounted(page.player), fit);
  assert.deepEqual(totals(page.player), startTotals, 'komplety wydane raz');
  assert.deepEqual(page.scope.PLAYER.partStock, FIT_KIT_PARTS);
});

test('F5: broń dołożona do magazynu i fit z dziurą przeżywają przeładowanie (magazyn + zamontowane = zapis)', () => {
  const storage = memoryStorage();
  let page = bootPage(storage);
  const inv = page.player.inventory;
  // Łup z wraków: nowa broń i dodatkowe sztuki już znanej.
  inv.give('special_valkyrie_railgun', 4);
  inv.give('siege_railgun', 2);
  inv.give('armata_mk1', 3);
  inv.give('tempest_ion_l', 1);
  // Mechanik: mieszany rodzaj na baterii (Valkyrie / Mjolnir na przemian), pusty środek na działach, gniazdo bez rakiet.
  const special = slotsOf(page.player, HP.SPECIAL);
  const pattern = ['special_valkyrie_railgun', 'siege_railgun', 'special_valkyrie_railgun', 'siege_railgun',
    'special_valkyrie_railgun', 'special_valkyrie_railgun'];
  special.forEach((hp, i) => assert.equal(page.scope.applyWeaponToHardpoint(hp, pattern[i]), true));
  const main = slotsOf(page.player, HP.MAIN);
  assert.equal(page.scope.applyWeaponToHardpoint(main[3], null), true, 'zdjęcie działa');
  assert.equal(page.scope.applyWeaponToHardpoint(main[5], 'armata_mk1'), true);
  assert.equal(page.scope.applyWeaponToHardpoint(main[9], 'railgun_mk2'), true);
  const missile = slotsOf(page.player, HP.MISSILE);
  missile[0].ammo = 3;   // salwy wystrzelone przed F5
  const before = { fit: mounted(page.player), stock: inv.toObject(), totals: totals(page.player), ammo: missile[0].ammo };

  page = reloadPage(page, storage);
  assert.deepEqual(page.player.inventory.toObject(), before.stock, 'magazyn z zapisu, bez zapasu startowego');
  assert.deepEqual(mounted(page.player), before.fit, 'każda broń w swoim gnieździe (po id)');
  assert.deepEqual(totals(page.player), before.totals);
  assert.equal(slotsOf(page.player, HP.MISSILE)[0].ammo, before.ammo, 'amunicja gniazda z zapisu');
  assert.equal(slotsOf(page.player, HP.MAIN)[3].mount, null, 'pusty środek zostaje pusty');

  // Drugie F5 — stan stały.
  page = reloadPage(page, storage);
  assert.deepEqual(page.player.inventory.toObject(), before.stock);
  assert.deepEqual(mounted(page.player), before.fit);
});

test('F5: zniszczone gniazdo w środku nie przesuwa reszty broni (dawniej kolejność w rodzaju)', () => {
  const storage = memoryStorage();
  let page = bootPage(storage);
  page.player.inventory.give('special_valkyrie_railgun', 3);
  const special = slotsOf(page.player, HP.SPECIAL);
  page.scope.applyWeaponToHardpoint(special[2], 'special_valkyrie_railgun');
  page.scope.applyWeaponToHardpoint(special[4], 'special_valkyrie_railgun');
  // Gniazdo zginęło z kadłubem pod sobą (broń przepada) — zapis ma w nim pustkę.
  page.scope.markHardpointDestroyed(page.player, special[1], page.player.hardpoints.length);
  const fit = mounted(page.player);
  assert.equal(fit[special[1].id], null);
  const totalsAfterLoss = totals(page.player);

  page = reloadPage(page, storage);
  assert.deepEqual(mounted(page.player), fit);
  assert.deepEqual(totals(page.player), totalsAfterLoss);
});

test('migracja: zapis bez weaponStock = dawny start (zapas startowy − zamontowane) + komplety kart raz, potem magazyn w zapisie', () => {
  const storage = memoryStorage();
  // Zapis sprzed 2026-10-08: same gniazda, w tym broń spoza zapasu startowego (łup sprzed F5).
  const legacy = atlasHardpoints().map(hp => ({ id: hp.id, type: hp.type, mount: null, ammo: null, maxAmmo: null }));
  const legacyMain = legacy.filter(hp => hp.type === HP.MAIN);
  legacyMain.forEach((hp, i) => { hp.mount = i < 2 ? 'tempest_ion_l' : 'railgun_mk2'; });
  legacy.find(hp => hp.type === HP.BUILTIN).mount = 'hexlance_siege';
  const legacyMissile = legacy.find(hp => hp.type === HP.MISSILE);
  Object.assign(legacyMissile, { mount: 'missile_rack', ammo: 5, maxAmmo: 8 });
  storage.setItem('loadout', JSON.stringify({ activeHullId: 'atlas', ownedHullIds: ['atlas'], shipFrame: 'atlas', hardpoints: legacy }));

  let page = bootPage(storage);
  const inv = page.player.inventory;
  assert.equal(inv.count('railgun_mk2'), DEFAULT_STOCK.railgun_mk2 - 13, 'zapas startowy minus zamontowane');
  assert.equal(inv.count('tempest_ion_l'), FIT_KIT_STOCK.tempest_ion_l,
    'broń z gniazd zapisu wraca na kadłub (dawny tor), magazyn dostaje tylko komplety kart');
  assert.equal(inv.count('missile_rack'), DEFAULT_STOCK.missile_rack - 1);
  assert.equal(inv.count('special_yamato_cannon'), DEFAULT_STOCK.special_yamato_cannon, 'puste gniazda zapisu zostają puste');
  assert.deepEqual(legacyMain.map(hp => hp.mount), slotsOf(page.player, HP.MAIN).map(hp => hp.mount), 'fit zapisu bez zmian');
  assert.equal(slotsOf(page.player, HP.MISSILE)[0].ammo, 5);
  const save = savedLoadout(storage);
  assert.deepEqual(save.weaponStock, inv.toObject(), 'pierwszy zapis po migracji ma już magazyn');
  assert.equal(save.kitsGranted, true);
  assert.deepEqual(save.partStock, FIT_KIT_PARTS);
  const migrated = { fit: mounted(page.player), stock: inv.toObject() };

  page = reloadPage(page, storage);
  assert.deepEqual(page.player.inventory.toObject(), migrated.stock, 'komplety tylko raz');
  assert.deepEqual(mounted(page.player), migrated.fit);
});

test('zapis z pustym magazynem nie dostaje zapasu startowego; broń bez gniazda wraca do magazynu', () => {
  const storage = memoryStorage();
  const hardpoints = atlasHardpoints().map(hp => ({ id: hp.id, type: hp.type, mount: null, ammo: null, maxAmmo: null }));
  hardpoints.find(hp => hp.type === HP.SPECIAL).mount = 'special_yamato_cannon';
  // Gniazdo, którego nie ma w układzie (edytor je usunął) — broń nie może przepaść.
  hardpoints.push({ id: 'usuniete', type: HP.SPECIAL, mount: 'siege_railgun', ammo: null, maxAmmo: null });
  hardpoints.push({ id: 'usuniete2', type: HP.SPECIAL, mount: 'siege_railgun', ammo: null, maxAmmo: null });
  for (const hp of hardpoints.filter(h => h.type === HP.SPECIAL && !h.mount)) hp.mount = 'special_valkyrie_m';
  storage.setItem('loadout', JSON.stringify({
    activeHullId: 'atlas', ownedHullIds: ['atlas'], shipFrame: 'atlas', weaponStock: {}, kitsGranted: true, hardpoints
  }));
  const page = bootPage(storage);
  assert.deepEqual(page.player.inventory.toObject(), { siege_railgun: 2 }, 'tylko broń bez gniazda');
  assert.equal(slotsOf(page.player, HP.MAIN).every(hp => !hp.mount), true, 'bez automountu z zapasu startowego');
  assert.deepEqual(totals(page.player), { siege_railgun: 2, special_valkyrie_m: 5, special_yamato_cannon: 1 });
});

test('zapis zamknięty na klucz (__SAVE_LOCKED) nie pisze — także magazynu', () => {
  const storage = memoryStorage();
  const page = bootPage(storage);
  const before = storage.getItem('loadout');
  page.scope.window.__SAVE_LOCKED = true;
  page.player.inventory.give('siege_railgun', 5);
  page.scope.saveLoadout();
  assert.equal(storage.getItem('loadout'), before);
});

test('karty z magazynu (komplety): każda bez zakupów i zastępstw, moduł i system F, A → B → A wraca do tego samego fitu', () => {
  const storage = memoryStorage();
  const { scope, player } = bootPage(storage);
  const start = { fit: mounted(player), totals: totals(player), parts: partTotals(scope) };
  const lance = MASTER_WEAPONS.lance_rail_l;
  for (const id of FIT_PRESET_IDS) {
    const preset = FIT_PRESETS[id];
    const own = scope.buildPlayerFitPlan(preset, 'own', null);
    assert.equal(own.subs.length + own.empties.length, 0, `${id}: komplety pokrywają kartę`);
    assert.equal(scope.buildPlayerFitPlan(preset, 'buy', null).toBuyCount, 0, `${id}: nic do kupienia`);
    assert.equal(scope.applyPlayerFitPlan(own), true);
    assert.equal(scope.PLAYER.hullPresets.atlas, id);
    assert.equal(scope.playerFitModule(), preset.module);
    assert.equal(scope.playerShipSystem().id, preset.system);
    assert.deepEqual(totals(player), start.totals, `${id}: magazyn + zamontowane = const`);
    assert.deepEqual(partTotals(scope), start.parts, `${id}: części w obiegu`);
    // Plan „z magazynu” po zastosowaniu: nic do zmiany.
    assert.equal(scope.buildPlayerFitPlan(preset, 'own', null).changed, 0, `${id}: założona`);
    if (id === 'tank') {
      assert.equal(slotsOf(player, HP.MAIN).every(hp => hp.mount === 'heavy_autocannon_l'), true);
      assert.equal(player.shield.max, Math.round(ATLAS_SHIELD.max * 1.4), 'Wzmacniacz tarcz');
      assert.equal(player.shield.baseHardness, ATLAS_SHIELD.hardness * 1.5);
    } else {
      assert.equal(player.shield.max, ATLAS_SHIELD.max, `${id}: tarcza kadłuba`);
    }
    if (id === 'sniper') {
      assert.equal(weaponRangeFor(player, lance, lance.baseRange), Math.min(18000, lance.baseRange * 1.5), 'Komputer balistyczny');
    } else {
      assert.equal(weaponRangeFor(player, lance, lance.baseRange), lance.baseRange, `${id}: zasięg bez modułu`);
    }
    if (id === 'missile') {
      const conv = baseSlotsOf(player, HP.SPECIAL);
      assert.equal(conv.length, 6);
      assert.equal(conv.every(hp => hp.type === HP.MISSILE), true, 'Komory rakietowe: bateria → wyrzutnie');
      assert.deepEqual(countBy(conv), { missile_rack: 4, grad_launcher: 2 });
      assert.deepEqual(countBy(baseSlotsOf(player, HP.MISSILE)), { hydra_mirv: 2 });
      for (const hp of slotsOf(player, HP.MISSILE)) {
        assert.equal(hp.maxAmmo, Math.round(MASTER_WEAPONS[hp.mount].ammo * 1.5), `magazynek ×1,5: ${hp.mount}`);
      }
    }
  }
  assert.equal(scope.applyPlayerFitPlan(scope.buildPlayerFitPlan(FIT_PRESETS.universal, 'own', null)), true);
  assert.deepEqual(mounted(player), start.fit, 'z powrotem UNIWERSALNA — ten sam fit');
  assert.equal(baseSlotsOf(player, HP.SPECIAL).every(hp => hp.type === HP.SPECIAL), true);
  assert.deepEqual(scope.PLAYER.partStock, FIT_KIT_PARTS);
  assert.equal(scope.playerShipSystem().id, 'ram_burn');
});

test('F5: moduł, system F, typy gniazd i magazynki z Komór rakietowych przeżywają przeładowanie', () => {
  const storage = memoryStorage();
  let page = bootPage(storage);
  page.scope.applyPlayerFitPlan(page.scope.buildPlayerFitPlan(FIT_PRESETS.missile, 'own', null));
  const conv = baseSlotsOf(page.player, HP.SPECIAL);
  conv[0].ammo = 5;
  const before = {
    fit: mounted(page.player), totals: totals(page.player), parts: partTotals(page.scope),
    ammo: conv.map(hp => [hp.ammo, hp.maxAmmo])
  };
  page = reloadPage(page, storage);
  const conv2 = baseSlotsOf(page.player, HP.SPECIAL);
  assert.equal(conv2.every(hp => hp.type === HP.MISSILE), true);
  assert.deepEqual(mounted(page.player), before.fit);
  assert.deepEqual(totals(page.player), before.totals);
  assert.deepEqual(partTotals(page.scope), before.parts);
  assert.deepEqual(conv2.map(hp => [hp.ammo, hp.maxAmmo]), before.ammo);
  assert.equal(page.scope.playerFitModule(), 'missile_cells');
  assert.equal(page.scope.playerShipSystem().id, 'maneuver');
  assert.equal(page.scope.PLAYER.hullPresets.atlas, 'missile');
  // Z powrotem UNIWERSALNA: wyrzutnie z baterii wracają do magazynu, gniazda znów bateria.
  page.scope.applyPlayerFitPlan(page.scope.buildPlayerFitPlan(FIT_PRESETS.universal, 'own', null));
  assert.equal(baseSlotsOf(page.player, HP.SPECIAL).every(hp => hp.type === HP.SPECIAL && hp.mount === 'special_yamato_cannon'), true);
  assert.deepEqual(totals(page.player), before.totals);
});

test('moduł zmienia magazynki wyrzutni, które zostają w gniazdach (proporcjonalnie — podwójny zapas kampanii też)', () => {
  const storage = memoryStorage();
  const { scope, player } = bootPage(storage);
  const launchers = slotsOf(player, HP.MISSILE);
  launchers[0].maxAmmo = 16;   // kampania: × 2
  launchers[0].ammo = 16;
  launchers[1].ammo = 3;
  assert.equal(scope.setPlayerFitModule('missile_cells'), true);
  assert.deepEqual(launchers.map(hp => hp.maxAmmo), [24, 12]);
  assert.deepEqual(launchers.map(hp => hp.ammo), [16, 3], 'amunicja bez zmian — dopełnia ją usługa doku');
  assert.equal(scope.setPlayerFitModule(null), true);
  assert.deepEqual(launchers.map(hp => hp.maxAmmo), [16, 8]);
  assert.deepEqual(launchers.map(hp => hp.ammo), [16, 3]);
  assert.deepEqual(scope.PLAYER.partStock, FIT_KIT_PARTS, 'moduł wrócił do hangaru');
});

test('karta z zakupem w porcie: brakujące sztuki po cenie portu, kredyty i składniki portu maleją, moduł kupiony', () => {
  const storage = memoryStorage();
  const { scope, player, toasts } = bootPage(storage);
  // Później w grze: kompletów BLISKIEGO TANKA już nie ma w hangarze.
  player.inventory.set('heavy_autocannon_l', 0);
  player.inventory.set('special_plasma_gatling', 0);
  delete scope.PLAYER.partStock.shield_booster;
  const station = richStation();
  scope.stationUI.station = station;

  const own = scope.buildPlayerFitPlan(FIT_PRESETS.tank, 'own');
  assert.ok(own.subs.length > 0, 'z magazynu — zastępstwa');
  assert.equal(own.module, null, 'z magazynu — bez modułu, którego nie ma');
  const plan = scope.buildPlayerFitPlan(FIT_PRESETS.tank, 'buy');
  assert.deepEqual(Object.fromEntries(plan.buy), { heavy_autocannon_l: 15, special_plasma_gatling: 6 });
  assert.deepEqual(plan.partsToBuy, ['shield_booster']);
  assert.equal(plan.blocked, false);
  const unit = (id) => scope.fitWeaponPrice(id, station);
  const price = Math.round(15 * unit('heavy_autocannon_l') + 6 * unit('special_plasma_gatling') + ShipModules.SHIP_MODULES.shield_booster.price);
  assert.equal(plan.price, price);

  // Za mało kredytów: nic się nie zmienia.
  scope.PLAYER.credits = plan.price - 1;
  const fit = mounted(player);
  const totalsBefore = totals(player);
  assert.equal(scope.applyPlayerFitPlan(plan), false);
  assert.equal(toasts.at(-1), 'Za mało kredytów');
  assert.deepEqual(mounted(player), fit);
  assert.deepEqual(totals(player), totalsBefore);

  scope.PLAYER.credits = plan.price + 500;
  const resBefore = { ...station.econ.resources };
  assert.equal(scope.applyPlayerFitPlan(plan), true);
  assert.equal(scope.PLAYER.credits, 500);
  assert.equal(slotsOf(player, HP.MAIN).every(hp => hp.mount === 'heavy_autocannon_l'), true);
  assert.equal(slotsOf(player, HP.SPECIAL).every(hp => hp.mount === 'special_plasma_gatling'), true);
  assert.equal(scope.playerFitModule(), 'shield_booster');
  assert.equal(scope.PLAYER.hullPresets.atlas, 'tank');
  const expected = { ...totalsBefore, heavy_autocannon_l: 15, special_plasma_gatling: 6 };
  assert.deepEqual(totals(player), Object.fromEntries(Object.entries(expected).sort(([a], [b]) => a.localeCompare(b))), 'kupione sztuki doszły');
  for (const [res, qty] of Object.entries(weaponBuildCost('heavy_autocannon_l'))) {
    const extra = (weaponBuildCost('special_plasma_gatling')[res] || 0) * 6;
    assert.equal(station.econ.resources[res], resBefore[res] - qty * 15 - extra, `składnik portu: ${res}`);
  }

  // Port bez gospodarki nie sprzeda — karta zablokowana, nic nie znika.
  scope.stationUI.station = { id: 'pusty' };
  player.inventory.set('lance_rail_l', 0);
  const blocked = scope.buildPlayerFitPlan(FIT_PRESETS.sniper, 'buy');
  assert.equal(blocked.blocked, true);
  assert.equal(scope.applyPlayerFitPlan(blocked), false);
  assert.equal(toasts.at(-1), 'W porcie brak części do tej konfiguracji');
});

test('refit ręczny: montaż na zaznaczonych gniazdach z magazynu, brakujące sztuki kupione w porcie, zdjęcie do magazynu', () => {
  const storage = memoryStorage();
  const { scope, player } = bootPage(storage, { credits: 0 });
  const main = slotsOf(player, HP.MAIN);
  const totalsBefore = totals(player);
  // Z magazynu (2 armaty startowe) na dwa gniazda.
  let res = scope.fitUiMountSlots([main[4].id, main[5].id], 'armata_mk1');
  assert.match(res.message, /^Zamontowano 2×/);
  assert.deepEqual([main[4].mount, main[5].mount], ['armata_mk1', 'armata_mk1']);
  assert.deepEqual(totals(player), totalsBefore, 'magazyn + zamontowane = const');
  assert.equal(scope.PLAYER.hullPresets.atlas, 'custom');
  // Brak sztuk i bez portu: gniazda bez zmian, komunikat.
  res = scope.fitUiMountSlots([main[0].id, main[1].id], 'railgun_mk1');
  assert.match(res.message, /w porcie brak tej broni/);
  assert.deepEqual([main[0].mount, main[1].mount], ['tempest_ion_l', 'tempest_ion_l']);
  // W porcie: kupuje tyle, na ile starczy kredytów.
  const station = richStation();
  scope.stationUI.station = station;
  const unit = scope.fitWeaponPrice('railgun_mk1');
  assert.ok(unit > 0);
  scope.PLAYER.credits = unit * 3 + 10;
  res = scope.fitUiMountSlots([main[0].id, main[1].id, main[2].id, main[3].id], 'railgun_mk1');
  assert.match(res.message, /kupiono 3/);
  assert.match(res.message, /za mało kredytów/);
  assert.equal(scope.PLAYER.credits, 10);
  assert.equal(main.slice(0, 4).filter(hp => hp.mount === 'railgun_mk1').length, 3);
  // Zdjęcie: broń wraca do magazynu.
  const before = player.inventory.count('armata_mk1');
  res = scope.fitUiMountSlots([main[4].id], null);
  assert.equal(main[4].mount, null);
  assert.equal(player.inventory.count('armata_mk1'), before + 1);
  // Rozmiar i typ: broń z innego rodzaju gniazda — nic do zmiany.
  res = scope.fitUiMountSlots([main[6].id], 'missile_rack');
  assert.equal(res.message, 'Nic do zmiany');
});

test('refit ręczny: moduł i system F — z hangaru za darmo, brakująca część za kredyty, stara wraca do hangaru', () => {
  const storage = memoryStorage();
  const { scope, player } = bootPage(storage, { credits: 0 });
  let res = scope.fitUiSetModule('ballistic_computer');
  assert.match(res.message, /Moduł: KOMPUTER BALISTYCZNY/);
  assert.equal(scope.PLAYER.partStock.ballistic_computer, 0, 'z hangaru');
  assert.equal(scope.playerFitModule(), 'ballistic_computer');
  // Drugi moduł z hangaru: poprzedni wraca.
  res = scope.fitUiSetModule('shield_booster');
  assert.equal(scope.PLAYER.partStock.ballistic_computer, 1);
  assert.equal(player.shield.max, Math.round(ATLAS_SHIELD.max * 1.4));
  // Moduł, którego nie ma w hangarze, bez kredytów — odmowa.
  delete scope.PLAYER.partStock.missile_cells;
  res = scope.fitUiSetModule('missile_cells');
  assert.equal(res.message, 'Za mało kredytów');
  assert.equal(scope.playerFitModule(), 'shield_booster');
  scope.PLAYER.credits = ShipModules.SHIP_MODULES.missile_cells.price;
  res = scope.fitUiSetModule('missile_cells');
  assert.match(res.message, /^Kupiono: KOMORY RAKIETOWE/);
  assert.equal(scope.PLAYER.credits, 0);
  assert.equal(baseSlotsOf(player, HP.SPECIAL).every(hp => hp.type === HP.MISSILE && !hp.mount), true, 'bateria zdjęta do magazynu');
  assert.match(res.message, /6 szt\. broni wróciło do hangaru/);
  // System F: silniki manewrowe z hangaru, szarża wbudowana.
  res = scope.fitUiSetSystem('maneuver');
  assert.equal(scope.playerShipSystem().id, 'maneuver');
  assert.equal(scope.PLAYER.partStock.maneuver || 0, 0);
  res = scope.fitUiSetSystem('ram_burn');
  assert.equal(scope.playerShipSystem().id, 'ram_burn');
  assert.equal(scope.PLAYER.partStock.maneuver, 1, 'silniki manewrowe wróciły do hangaru');
});

test('własna konfiguracja: zapis z bieżących gniazd, odtworzenie po zmianie karty i F5, najwyżej dwie na kadłub', () => {
  const storage = memoryStorage();
  let page = bootPage(storage);
  const main = slotsOf(page.player, HP.MAIN);
  page.scope.fitUiMountSlots([main[4].id, main[5].id], 'armata_mk1');
  page.scope.fitUiMountSlots([main[0].id], null);
  const res = page.scope.fitUiSaveCustom();
  assert.match(res.message, /^Zapisano jako WŁASNA 1/);
  const custom = page.scope.fitUiCustoms()[0];
  const fit = mounted(page.player);
  page.scope.applyPlayerFitPlan(page.scope.buildPlayerFitPlan(FIT_PRESETS.sniper, 'own', null));
  assert.notDeepEqual(mounted(page.player), fit);
  page = reloadPage(page, storage);
  const restored = page.scope.fitUiCustoms();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, custom.id);
  page.scope.applyPlayerFitPlan(page.scope.buildPlayerFitPlan(restored[0], 'own', null));
  assert.deepEqual(mounted(page.player), fit, 'własna karta odtwarza fit — także puste gniazdo');
  page.scope.fitUiSaveCustom();
  const third = page.scope.fitUiSaveCustom();
  assert.match(third.message, /^Nadpisano WŁASNA 1/);
  assert.equal(page.scope.fitUiCustoms().length, FIT_MAX_CUSTOMS_PER_HULL);
});

test('brak sztuki w magazynie: gniazdo bez zmian (stara broń i jej amunicja), false, komunikat, bez zapisu', () => {
  const storage = memoryStorage();
  const { scope, player, toasts } = bootPage(storage);
  const slot = slotsOf(player, HP.MISSILE)[1];
  assert.equal(slot.mount, 'missile_rack');
  slot.ammo = 3;
  const saved = storage.getItem('loadout');
  const stock = player.inventory.toObject();
  assert.equal(player.inventory.count('siege_torpedo_mk2'), 0);
  assert.equal(scope.applyWeaponToHardpoint(slot, 'siege_torpedo_mk2'), false);
  assert.deepEqual([slot.mount, slot.ammo, slot.maxAmmo], ['missile_rack', 3, 8]);
  assert.deepEqual(player.inventory.toObject(), stock);
  assert.equal(storage.getItem('loadout'), saved);
  assert.equal(toasts.at(-1), `Brak w magazynie: ${MASTER_WEAPONS.siege_torpedo_mk2.name}`);
  // Ta sama broń jeszcze raz — dalej uzupełnia magazynek (dawna ukryta funkcja zostaje).
  assert.equal(scope.applyWeaponToHardpoint(slot, 'missile_rack'), true);
  assert.equal(slot.ammo, 8);
  // Broń innego rodzaju gniazda nie rozbraja gniazda.
  assert.equal(scope.applyWeaponToHardpoint(slot, 'railgun_mk2', { force: true }), false);
  assert.equal(slot.mount, 'missile_rack');
});

test('remont w doku przywraca zniszczone gniazda — puste, koszt za gniazdo w cenie remontu', () => {
  const storage = memoryStorage();
  const { scope, player, toasts } = bootPage(storage, { credits: 1000 });
  const special = slotsOf(player, HP.SPECIAL);
  const aux = slotsOf(player, HP.AUX);
  scope.markHardpointDestroyed(player, special[0], player.hardpoints.length);
  scope.markHardpointDestroyed(player, aux[3], player.hardpoints.length);
  const stock = player.inventory.toObject();
  assert.equal(HardpointService.countDestroyedHardpoints(player.hardpoints), 2);
  const quote = scope.playerDockRepairQuote();
  assert.deepEqual([quote.needed, quote.deadSockets, quote.cost], [true, 2, 2 * HardpointService.HARDPOINT_SERVICE.dockCostPerSocket]);
  scope.handleRepair();
  assert.equal(scope.PLAYER.credits, 1000 - 2 * HardpointService.HARDPOINT_SERVICE.dockCostPerSocket);
  assert.equal(HardpointService.countDestroyedHardpoints(player.hardpoints), 0);
  assert.deepEqual([special[0].destroyed, special[0].mount, aux[3].mount], [false, null, null]);
  assert.deepEqual(player.inventory.toObject(), stock, 'broń przepadła z gniazdem — magazyn bez zmian');
  assert.equal(toasts.at(-1), 'Naprawiono kadłub i gniazda broni (2, puste).');
  // Gniazdo przywrócone: WYPOSAŻENIE obsadza je z magazynu.
  assert.equal(scope.applyWeaponToHardpoint(special[0], 'special_valkyrie_m'), true);
  scope.handleRepair();
  assert.equal(toasts.at(-1), 'Kadłub jest w pełni sprawny');
  // Bez kredytów gniazda zostają zniszczone.
  scope.markHardpointDestroyed(player, aux[0], player.hardpoints.length);
  scope.PLAYER.credits = 0;
  scope.handleRepair();
  assert.equal(aux[0].destroyed, true);
  assert.equal(toasts.at(-1), 'Za mało kredytów');
});

test('uzupełnij amunicję: magazynki gniazd gracza do maxAmmo, zapis; pełne — komunikat', () => {
  const storage = memoryStorage();
  const { scope, player, toasts } = bootPage(storage);
  const missile = slotsOf(player, HP.MISSILE);
  const nova = slotsOf(player, HP.SPECIAL_MISSILE)[0];
  missile[0].ammo = 1;
  missile[1].ammo = 0;
  nova.ammo = 0;
  assert.equal(scope.refillPlayerAmmo(), 3);
  assert.deepEqual(missile.map(hp => hp.ammo), missile.map(hp => hp.maxAmmo));
  assert.equal(nova.ammo, MASTER_WEAPONS.supernova_missile.ammo);
  assert.equal(savedLoadout(storage).hardpoints.find(h => h.id === nova.id).ammo, nova.ammo, 'zapis po usłudze');
  assert.equal(scope.refillPlayerAmmo(), 0);
  assert.equal(toasts.at(-1), 'Amunicja pełna');
});

test('kampania: karta UNIWERSALNA z magazynu, zdjęta broń wraca do magazynu, drugi start (po F5) nie dokłada nic', () => {
  const storage = memoryStorage();
  let page = bootPage(storage);
  // Gracz przed startem kampanii założył BLISKIEGO TANKA (moduł, szarża) — kampania wraca do karty startowej.
  page.scope.applyPlayerFitPlan(page.scope.buildPlayerFitPlan(FIT_PRESETS.tank, 'own', null));
  page.scope.equipCampaignLoadout();
  const main = slotsOf(page.player, HP.MAIN);
  assert.equal(main.every(hp => hp.mount === 'tempest_ion_l'), true);
  assert.equal(page.player.inventory.count('heavy_autocannon_l'), FIT_KIT_STOCK.heavy_autocannon_l, 'zdjęte działa wróciły do magazynu');
  assert.equal(page.scope.playerFitModule(), null);
  assert.deepEqual(page.scope.PLAYER.partStock, FIT_KIT_PARTS, 'moduł wrócił do hangaru');
  assert.equal(page.scope.PLAYER.hullPresets.atlas, FIT_START_PRESET);
  assert.equal(slotsOf(page.player, HP.MISSILE)[0].maxAmmo, MASTER_WEAPONS.missile_rack.ammo * CAMPAIGN_MISSILE_AMMO_MUL);
  const afterGrant = totals(page.player);
  assert.deepEqual(afterGrant, totals({ inventory: new WeaponInventory(START_WITH_KITS), hardpoints: [] }));
  page = reloadPage(page, storage);
  page.scope.equipCampaignLoadout();
  assert.deepEqual(totals(page.player), afterGrant, 'zapisany magazyn — kampania nie tworzy sztuk drugi raz');
  // Gracz przezbroił działa z magazynu — kampania bierze swoją broń z magazynu, nie z powietrza.
  page.scope.fitUiMountSlots(slotsOf(page.player, HP.MAIN).map(hp => hp.id), 'railgun_mk2');
  assert.equal(page.player.inventory.count('tempest_ion_l'), 15);
  page.scope.equipCampaignLoadout();
  assert.deepEqual(totals(page.player), afterGrant);
  // Sztuk karty startowej brak (sprzedane / zniszczone): kampania DAJE brakujące (jedyny wyjątek od niezmiennika).
  page.scope.fitUiMountSlots(slotsOf(page.player, HP.MAIN).map(hp => hp.id), 'railgun_mk2');
  page.player.inventory.set('tempest_ion_l', 0);
  page.scope.equipCampaignLoadout();
  assert.equal(slotsOf(page.player, HP.MAIN).every(hp => hp.mount === 'tempest_ion_l'), true);
});

test('loadLoadout: gniazda z zapisu po id i rodzaj po aktualnym mountType, stan wyposażenia (strażnik źródła)', () => {
  const load = sliceFunction(html, 'function loadLoadout() {');
  assert.match(load, /assignHardpointEntries\(fresh, savedEntries, \{ bucketOf: savedHardpointBucket \}\)/);
  // Odczyt magazynu i reguła migracji w jednej funkcji (loadoutSave.js).
  assert.match(load, /const stockRestored = restoreWeaponStock\(Game\.player\.inventory, data\?\.weaponStock,/);
  assert.match(load, /createMissing: !stockRestored/);
  // Wyposażenie PRZED profilem kadłuba (moduł zmienia tarczę i typy gniazd), typy gniazd przed przydziałem zapisu.
  assert.ok(load.indexOf('restorePlayerFitState(data);') < load.indexOf('applyPlayerHullProfile(requestedHull'));
  assert.ok(load.indexOf('applyPlayerModuleSlotTypes(fresh,') < load.indexOf('assignHardpointEntries(fresh'));
  const preserve = sliceFunction(html, 'function tryPreserveMounts(previous) {');
  assert.match(preserve, /assignHardpointEntries\(Game\.player\.hardpoints, previous, \{ bucketOf: savedHardpointBucket \}\)/);
  const save = sliceFunction(html, 'function saveLoadout() {');
  assert.match(save, /if \(window\.__SAVE_LOCKED\) return;/);
  assert.match(save, /weaponStock: Game\.player\.inventory \? serializeWeaponStock\(Game\.player\.inventory\)/);
  assert.match(save, /\.\.\.serializePlayerFitState\(\),/);
  // Migawki przebudowy tablicy gniazd niosą id (zmiana kadłuba, sprite, edytor) — jedna funkcja.
  assert.equal((html.match(/hangarSquadrons: h\.type === HP\.HANGAR \? getHardpointHangarSquadrons\(h\) : undefined/g) || []).length, 1);
  // Tablica gniazd gracza powstaje w dwóch miejscach — oba nakładają typy gniazd modułu.
  const rebuild = sliceFunction(html, 'function rebuildHardpointsForFrame() {');
  assert.match(rebuild, /applyPlayerModuleSlotTypes\(Game\.player\.hardpoints, safePlayerFitModule\(\)\);/);
  assert.equal((html.match(/Game\.player\.hardpoints = /g) || []).length, 2);
});
