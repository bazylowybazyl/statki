// Automat refitu, karty konfiguracji, moduły i profil ognia (docs/PLAN-fitowanie.md § 4.2–4.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { FIT_PRESETS, FIT_PRESET_IDS, FIT_KIT_STOCK, FIT_KIT_PARTS, FIT_START_PRESET } from '../src/data/fitPresets.js';
import {
  SHIP_MODULES, moduleSlotType, moduleShieldMul, moduleModifierSource, moduleMissileAmmoMul, moduleSlotsForHull,
  SHIP_SYSTEM_PART_PRICES
} from '../src/data/shipModules.js';
import { planFit, orderFitSlots, presetFromHardpoints } from '../src/game/fitPlanner.js';
import { fitStats, weaponDps, weaponRangeWithModule } from '../src/game/fitStats.js';
import {
  setModifierSource, setModifierSourceWithClasses, clearModifierSource, weaponRangeFor, weaponRangeMul, weaponSpeedMul
} from '../src/game/shipModifiers.js';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function parseDefaultStock() {
  const block = indexSource.match(/const DEFAULT_INVENTORY_STOCK = \{([\s\S]*?)\n    \};/);
  assert.ok(block, 'nie znaleziono DEFAULT_INVENTORY_STOCK w index.html');
  const out = {};
  const entry = /([a-z0-9_]+):\s*(\d+)/g;
  let m;
  while ((m = entry.exec(block[1]))) out[m[1]] = Number(m[2]);
  return out;
}

const atlasSlots = () => ATLAS_EDITOR_DEFAULTS.hardpoints.map((h) => ({
  id: h.id, type: h.type, pos: { x: h.x, y: h.y }, mount: null, destroyed: false, size: 'Capital'
}));
const isFree = (id) => MASTER_WEAPONS[id]?.mountType === 'hangar';
const SIZE_RANK = { S: 1, M: 2, L: 3, Capital: 4 };
const fits = (def, hp) => (SIZE_RANK[def.size] || 1) <= (SIZE_RANK[hp.size || 'Capital'] || 4);
const merge = (...objs) => {
  const out = new Map();
  for (const o of objs) for (const [id, n] of Object.entries(o)) out.set(id, (out.get(id) || 0) + n);
  return out;
};
const startStock = () => merge(parseDefaultStock(), FIT_KIT_STOCK);

function plan(preset, hardpoints, stock, mode = 'own', extra = {}) {
  return planFit({
    hardpoints, preset, stock, mode, weapons: MASTER_WEAPONS,
    currentOf: (hp) => hp.mount || null,
    slotType: (hp, mod) => moduleSlotType(hp.type, mod),
    fits, isFree,
    hasPart: (id) => !id || id === 'ram_burn' || !!FIT_KIT_PARTS[id],
    weaponPrice: () => 1000,
    partPrice: (id) => SHIP_MODULES[id]?.price ?? SHIP_SYSTEM_PART_PRICES[id] ?? 0,
    ...extra
  });
}

function apply(hardpoints, stock, p) {
  for (const hp of hardpoints) if (p.mounts.has(hp.id)) hp.mount = p.mounts.get(hp.id);
  for (const [id, n] of p.buy) p.stockAfter.set(id, (p.stockAfter.get(id) || 0)); // kupione od razu zamontowane
  stock.clear();
  for (const [id, n] of p.stockAfter) stock.set(id, n);
}

const countMounted = (hardpoints) => {
  const out = new Map();
  for (const hp of hardpoints) if (hp.mount && !isFree(hp.mount)) out.set(hp.mount, (out.get(hp.mount) || 0) + 1);
  return out;
};
const sumMap = (a, b) => {
  const out = new Map(a);
  for (const [id, n] of b) out.set(id, (out.get(id) || 0) + n);
  for (const [id, n] of out) if (!n) out.delete(id);
  return out;
};

test('karty: każda broń z przepisu istnieje i pasuje typem do swojego gniazda (z modułem karty)', () => {
  assert.deepEqual([...FIT_PRESET_IDS], ['universal', 'tank', 'sniper', 'missile']);
  assert.equal(FIT_START_PRESET, 'universal');
  for (const id of FIT_PRESET_IDS) {
    const p = FIT_PRESETS[id];
    if (p.module) assert.ok(SHIP_MODULES[p.module], `${id}: nieznany moduł ${p.module}`);
    for (const [slotType, spec] of Object.entries(p.slots)) {
      const eff = moduleSlotType(slotType, p.module);
      for (const wid of [...spec.want.map(([w]) => w), ...(spec.alt || [])]) {
        const def = MASTER_WEAPONS[wid];
        assert.ok(def, `${id}.${slotType}: brak broni ${wid}`);
        assert.equal(def.mountType, eff, `${id}.${slotType}: ${wid} ma mountType ${def.mountType}, gniazdo ${eff}`);
      }
    }
  }
});

test('komplety misji startowej pokrywają każdą kartę na Atlasie bez zakupów', () => {
  for (const id of FIT_PRESET_IDS) {
    const hardpoints = atlasSlots();
    const p = plan(FIT_PRESETS[id], hardpoints, startStock(), 'buy');
    assert.equal(p.toBuyCount, 0, `${id}: do kupienia ${[...p.buy].map(([w, n]) => `${n}× ${w}`).join(', ')}`);
    assert.equal(p.price, 0);
    assert.equal(p.empties.length, 0);
    assert.equal(p.mounts.size, hardpoints.length, `${id}: każde gniazdo ma plan`);
    for (const hp of hardpoints) assert.ok(p.mounts.get(hp.id), `${id}: gniazdo ${hp.id} (${hp.type}) puste`);
  }
});

test('niezmiennik: hangar + zamontowane = const w trybie „z magazynu”, karta A → B → A wraca bit w bit', () => {
  const hardpoints = atlasSlots();
  const stock = startStock();
  apply(hardpoints, stock, plan(FIT_PRESETS.universal, hardpoints, stock));
  const total0 = sumMap(stock, countMounted(hardpoints));
  const snapshot = hardpoints.map((h) => h.mount).join(',');
  for (const id of ['tank', 'sniper', 'missile', 'universal', 'missile', 'tank', 'universal']) {
    const p = plan(FIT_PRESETS[id], hardpoints, stock);
    // Komory rakietowe zmieniają typ gniazd baterii — jak w grze: gniazda dostają typ po module.
    apply(hardpoints, stock, p);
    assert.deepEqual(sumMap(stock, countMounted(hardpoints)), total0, `po ${id} zmienił się bilans`);
  }
  assert.equal(hardpoints.map((h) => h.mount).join(','), snapshot);
});

test('symetria: przy braku sztuk para lustrzanych gniazd dostaje tę samą broń', () => {
  const hardpoints = atlasSlots();
  const stock = new Map([['heavy_autocannon_l', 3], ['railgun_mk2', 15]]);
  const p = plan(FIT_PRESETS.tank, hardpoints, stock);
  let heavyOnPairs = 0;
  for (const group of orderFitSlots(hardpoints, 'main')) {
    if (group.length !== 2) continue;
    assert.equal(p.mounts.get(group[0].id), p.mounts.get(group[1].id), 'para z różną bronią');
    if (p.mounts.get(group[0].id) === 'heavy_autocannon_l') heavyOnPairs += 2;
  }
  assert.equal(heavyOnPairs, 2, 'trzy sztuki: jedna para HA, trzecia nie rozbija kolejnej pary');
});

test('tryb „kup”: braki na liście zakupów bez zastępstw, cena = suma, moduł i silniki manewrowe jako części', () => {
  const hardpoints = atlasSlots();
  const stock = new Map(Object.entries(parseDefaultStock()));
  const p = plan(FIT_PRESETS.sniper, hardpoints, stock, 'buy', { hasPart: (id) => !id || id === 'ram_burn' });
  assert.equal(p.buy.get('lance_rail_l'), 15);
  assert.equal(p.buy.get('special_valkyrie_railgun'), 4);
  assert.equal(p.buy.get('siege_railgun'), 2);
  assert.deepEqual(p.partsToBuy.sort(), ['ballistic_computer', 'maneuver']);
  const weaponCost = [...p.buy.values()].reduce((s, n) => s + n * 1000, 0);
  assert.equal(p.price, weaponCost + SHIP_MODULES.ballistic_computer.price + SHIP_SYSTEM_PART_PRICES.maneuver);
  assert.equal(p.subs.length, 0);
  for (const hp of hardpoints.filter((h) => h.type === 'main')) assert.equal(p.mounts.get(hp.id), 'lance_rail_l');
});

test('tryb „z magazynu” bez kompletów: zastępstwa zamiast zakupów, moduł nieposiadany zostaje wolny', () => {
  const hardpoints = atlasSlots();
  const stock = new Map(Object.entries(parseDefaultStock()));
  const p = plan(FIT_PRESETS.tank, hardpoints, stock, 'own', { hasPart: (id) => !id || id === 'ram_burn' });
  assert.equal(p.module, null);
  assert.equal(p.buy.size, 0);
  assert.ok(p.subs.length > 0);
  assert.equal(p.price, 0);
});

test('port bez części: pozycja „niedostępna”, plan zablokowany', () => {
  const hardpoints = atlasSlots();
  const p = plan(FIT_PRESETS.tank, hardpoints, new Map(), 'buy', {
    weaponPrice: (id) => (id === 'special_plasma_gatling' ? null : 500)
  });
  assert.ok(p.blocked);
  assert.equal(p.unavailable.get('special_plasma_gatling'), 6);
});

test('komory rakietowe: gniazda baterii stają się wyrzutniami (8 wyrzutni na Atlasie)', () => {
  const hardpoints = atlasSlots();
  const p = plan(FIT_PRESETS.missile, hardpoints, startStock(), 'own');
  assert.equal(p.module, 'missile_cells');
  const launchers = hardpoints.filter((h) => h.type === 'special' || h.type === 'missile')
    .map((h) => p.mounts.get(h.id));
  assert.equal(launchers.length, 8);
  for (const w of launchers) assert.equal(MASTER_WEAPONS[w].mountType, 'missile');
  assert.equal(moduleMissileAmmoMul('missile_cells'), 1.5);
});

test('własna konfiguracja z gniazd odtwarza ten sam fit (puste gniazdo zostaje puste)', () => {
  const hardpoints = atlasSlots();
  const stock = startStock();
  apply(hardpoints, stock, plan(FIT_PRESETS.sniper, hardpoints, stock));
  const someMain = hardpoints.find((h) => h.type === 'main');
  stock.set(someMain.mount, (stock.get(someMain.mount) || 0) + 1);
  someMain.mount = null;
  const own = presetFromHardpoints(hardpoints, { id: 'own1', name: 'WŁASNA 1', module: 'ballistic_computer', system: 'maneuver' });
  const before = hardpoints.map((h) => h.mount).join(',');
  apply(hardpoints, stock, plan(FIT_PRESETS.universal, hardpoints, stock));
  apply(hardpoints, stock, plan(own, hardpoints, stock));
  assert.equal(hardpoints.map((h) => h.mount).join(','), before);
});

test('moduły: tarcze, sufit zasięgu, zamiana typów, gniazda modułów kadłubów', () => {
  assert.deepEqual({ ...moduleShieldMul('shield_booster') }, { max: 1.4, regen: 1.5, delay: 0.7, hardness: 1.5 });
  assert.deepEqual({ ...moduleShieldMul(null) }, { max: 1, regen: 1, delay: 1, hardness: 1 });
  assert.equal(moduleSlotType('special', 'missile_cells'), 'missile');
  assert.equal(moduleSlotType('main', 'missile_cells'), 'main');
  const src = moduleModifierSource('ballistic_computer');
  assert.deepEqual({ ...src.classRange }, { sniper: 1.5 });
  assert.equal(src.rangeCap, 18000);
  assert.equal(moduleModifierSource('shield_booster'), null);
  assert.equal(moduleSlotsForHull('atlas'), 1);
  assert.equal(moduleSlotsForHull('frigate'), 0);
});

test('profil ognia: UNIWERSALNA, TANK (D4), SNAJPER z komputerem balistycznym — liczby z planu § 4.2', () => {
  const run = (id) => {
    const hardpoints = atlasSlots();
    const p = plan(FIT_PRESETS[id], hardpoints, startStock());
    return fitStats({ hardpoints, mounts: p.mounts, weapons: MASTER_WEAPONS, module: p.module, shieldBase: { max: 18000 } });
  };
  const uni = run('universal');
  assert.equal(Math.round(uni.gunsAt(3)), 3600);
  assert.equal(Math.round(uni.gunsAt(7)), 3060);
  assert.equal(uni.maxGun, 7000);
  assert.equal(uni.pd, 14);
  const tank = run('tank');
  assert.equal(Math.round(tank.gunsAt(3)), 5126);
  assert.equal(tank.shieldMax, 25200);
  const sniper = run('sniper');
  assert.equal(Math.round(sniper.gunsAt(12)), 1667);
  assert.equal(Math.round(sniper.gunsAt(15)), 1000);
  assert.equal(sniper.maxGun, 20000);
  assert.equal(weaponRangeWithModule(MASTER_WEAPONS.lance_rail_l, 'ballistic_computer'), 15000);
  assert.equal(weaponRangeWithModule(MASTER_WEAPONS.siege_railgun, 'ballistic_computer'), 20000);
  assert.equal(weaponRangeWithModule(MASTER_WEAPONS.special_yamato_cannon, 'ballistic_computer'), 7000);
  assert.equal(Math.round(weaponDps(MASTER_WEAPONS.special_yamato_cannon)), 510);
});

test('modyfikatory okrętu: mnożnik klasy broni z sufitem, źródła się składają, zdjęcie wraca do 1', () => {
  const e = {};
  setModifierSource(e, 'system', { fireRate: 0.5, range: 1.1 });
  setModifierSourceWithClasses(e, 'fit', moduleModifierSource('ballistic_computer'));
  const lance = MASTER_WEAPONS.lance_rail_l;
  const yamato = MASTER_WEAPONS.special_yamato_cannon;
  assert.equal(weaponRangeMul(e, lance), 1.1 * 1.5);
  assert.equal(weaponRangeFor(e, lance, 10000), 16500);
  assert.equal(weaponRangeFor(e, MASTER_WEAPONS.siege_railgun, 20000), 22000); // ogólne ×1,1 bez sufitu klasy
  assert.equal(Math.round(weaponRangeFor(e, yamato, 7000)), 7700);
  assert.equal(weaponSpeedMul(e, lance), 1.4);
  assert.equal(e.modifiers.fireRate, 0.5);
  clearModifierSource(e, 'fit');
  assert.equal(Math.round(weaponRangeFor(e, lance, 10000)), 11000);
  assert.equal(weaponSpeedMul(e, lance), 1);
  clearModifierSource(e, 'system');
  assert.equal(weaponRangeFor(e, lance, 10000), 10000);
});
