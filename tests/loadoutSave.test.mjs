// Zapis fitu gracza — czyste pomocniki (src/game/loadoutSave.js, src/game/hardpointService.js).
// Etap 0 planu fitowania (docs/PLAN-fitowanie.md § 2.2, § 4.7). Ścieżki gry (save → F5 → load, mechanik, remont)
// sprawdza tests/playerFitSave.test.mjs na funkcjach wyciętych z index.html.

import test from 'node:test';
import assert from 'node:assert/strict';

import { WeaponInventory } from '../src/game/weaponInventory.js';
import {
  assignHardpointEntries,
  readSavedWeaponStock,
  restoreWeaponStock,
  serializeWeaponStock
} from '../src/game/loadoutSave.js';
import {
  HARDPOINT_SERVICE,
  countDestroyedHardpoints,
  hardpointAmmoState,
  refillHardpointAmmo,
  restoreDestroyedHardpoints
} from '../src/game/hardpointService.js';

// ---------------------------------------------------------------------------
// Magazyn broni w zapisie

test('serializeWeaponStock: { id: n } bez zer, klucze po kolei (stabilny JSON)', () => {
  const inv = new WeaponInventory({ yamato: 2, armata: 3, zero: 0 });
  inv.take('armata', 3);
  assert.deepEqual(serializeWeaponStock(inv), { yamato: 2 });
  inv.give('alfa', 1);
  assert.equal(JSON.stringify(serializeWeaponStock(inv)), '{"alfa":1,"yamato":2}');
  assert.deepEqual(serializeWeaponStock(new WeaponInventory()), {});
  assert.deepEqual(serializeWeaponStock(null), {});
});

test('readSavedWeaponStock: brak pola = null (migracja), pusty obiekt = pusty magazyn', () => {
  assert.equal(readSavedWeaponStock(undefined), null);
  assert.equal(readSavedWeaponStock(null), null);
  assert.equal(readSavedWeaponStock([['a', 1]]), null, 'tablica to nie magazyn');
  assert.equal(readSavedWeaponStock('a'), null);
  assert.deepEqual(readSavedWeaponStock({}), {}, 'pusty magazyn to NIE zapis bez magazynu');
  const known = new Set(['a', 'b', 'c']);
  assert.deepEqual(
    readSavedWeaponStock({ a: 2, b: '3', c: 0, d: 5, e: -1 }, (id) => known.has(id)),
    { a: 2, b: 3 },
    'liczby całkowite > 0, broń spoza katalogu odpada'
  );
  assert.deepEqual(readSavedWeaponStock({ a: 2.9 }), { a: 2 });
});

test('restoreWeaponStock: magazyn = zapis + broń zapisanych gniazd; zapis bez pola — magazyn bez zmian (migracja)', () => {
  const known = new Set(['a', 'b', 'c']);
  const isKnown = (id) => known.has(id);
  // Start strony: zapas startowy po zwrocie automountu.
  const inv = new WeaponInventory({ a: 24, c: 6 });
  assert.equal(restoreWeaponStock(inv, { a: 2, b: 1, x: 9 }, { isKnown, mounts: ['a', 'a', null, 'c', 'x'] }), true);
  assert.deepEqual(inv.toObject(), { a: 4, b: 1, c: 1 }, 'bez zapasu startowego, broń gniazd do zdjęcia przez montaż');
  // Pusty magazyn w zapisie to prawdziwy, pusty magazyn.
  assert.equal(restoreWeaponStock(inv, {}, { isKnown, mounts: ['b'] }), true);
  assert.deepEqual(inv.toObject(), { b: 1 });
  // Zapis sprzed 2026-10-08: nic nie rusza — montaż sam dokłada brakujące sztuki (createMissing).
  const legacy = new WeaponInventory({ a: 24 });
  assert.equal(restoreWeaponStock(legacy, undefined, { isKnown, mounts: ['a'] }), false);
  assert.deepEqual(legacy.toObject(), { a: 24 });
  assert.equal(restoreWeaponStock(null, { a: 1 }), false);
  // Para z serializeWeaponStock: zapis → odczyt bez gniazd = ten sam magazyn.
  const back = new WeaponInventory();
  restoreWeaponStock(back, JSON.parse(JSON.stringify(serializeWeaponStock(new WeaponInventory({ c: 3, a: 1 })))));
  assert.deepEqual(back.toObject(), { a: 1, c: 3 });
});

// ---------------------------------------------------------------------------
// Gniazda po id

const slot = (id, type) => ({ id, type, mount: null });
const entry = (id, type, mount) => ({ id, type, mount });
const bucket = (e) => (e.mount ? (e.mount.startsWith('hex') ? 'builtin' : e.type) : null);

test('assignHardpointEntries: wpis wraca do gniazda o tym samym id, puste gniazdo zostaje puste', () => {
  const slots = [slot('s1', 'special'), slot('s2', 'special'), slot('s3', 'special'), slot('s4', 'special')];
  // Mieszany rodzaj z dziurą w środku: dawna kolejność w rodzaju przesuwała M i V o jedno gniazdo w lewo.
  const saved = [entry('s1', 'special', 'V'), entry('s2', 'special', null), entry('s3', 'special', 'M'), entry('s4', 'special', 'V')];
  const plan = assignHardpointEntries(slots, saved, { bucketOf: bucket });
  assert.deepEqual(plan.pairs.map(p => [p.hp.id, p.entry.mount]), [['s1', 'V'], ['s3', 'M'], ['s4', 'V']]);
  assert.deepEqual(plan.reserved.map(h => h.id), ['s2']);
  assert.deepEqual(plan.unplaced, []);
});

test('assignHardpointEntries: bez pary po id — kolejność w rodzaju jak dawniej, nadmiar w unplaced', () => {
  const slots = [slot('n1', 'main'), slot('n2', 'main'), slot('n3', 'aux')];
  const saved = [
    entry('x1', 'main', 'A'), entry('x2', 'main', null), entry('x3', 'main', 'B'), entry('x4', 'main', 'C'),
    entry('x5', 'aux', 'P'), entry(undefined, 'aux', 'Q')
  ];
  const plan = assignHardpointEntries(slots, saved, { bucketOf: bucket });
  assert.deepEqual(plan.pairs.map(p => [p.hp.id, p.entry.mount]), [['n1', 'A'], ['n2', 'B'], ['n3', 'P']]);
  assert.deepEqual(plan.reserved, [], 'pusty wpis bez pary po id nikogo nie rezerwuje');
  assert.deepEqual(plan.unplaced.map(e => e.mount).sort(), ['C', 'Q']);
});

test('assignHardpointEntries: rodzaj po AKTUALNYM mountType (hexlance: special → builtin), id innego rodzaju nie wiąże', () => {
  const slots = [slot('sp1', 'special'), slot('bi1', 'builtin')];
  const saved = [entry('sp1', 'special', 'hexlance'), entry('sp9', 'special', 'Y')];
  const plan = assignHardpointEntries(slots, saved, { bucketOf: bucket });
  assert.deepEqual(plan.pairs.map(p => [p.hp.id, p.entry.mount]), [['sp1', 'Y'], ['bi1', 'hexlance']]);
  assert.deepEqual(plan.unplaced, []);
});

test('assignHardpointEntries: zdublowane id — drugi wpis idzie kolejką, wynik w kolejności gniazd', () => {
  const slots = [slot('a', 'main'), slot('b', 'main'), slot('c', 'main')];
  const saved = [entry('c', 'main', 'C'), entry('a', 'main', 'A'), entry('a', 'main', 'A2')];
  const plan = assignHardpointEntries(slots, saved, { bucketOf: bucket });
  assert.deepEqual(plan.pairs.map(p => [p.hp.id, p.entry.mount]), [['a', 'A'], ['b', 'A2'], ['c', 'C']]);
  assert.deepEqual(assignHardpointEntries(null, saved, { bucketOf: bucket }).pairs, []);
  assert.deepEqual(assignHardpointEntries(slots, null).pairs, []);
});

// ---------------------------------------------------------------------------
// Usługi doku: gniazda zniszczone, amunicja

test('restoreDestroyedHardpoints: gniazdo wraca PUSTE (broń przepadła), zdrowe bez zmian', () => {
  const hps = [
    { id: 'a', type: 'main', mount: 'railgun_mk2', ammo: null, maxAmmo: null },
    { id: 'b', type: 'missile', mount: null, ammo: null, maxAmmo: null, destroyed: true, __lostMount: 'missile_rack', __supportMisses: 3, missileCd: 2 },
    { id: 'c', type: 'hangar', mount: null, hangarSquadrons: ['x'], destroyed: true }
  ];
  assert.equal(countDestroyedHardpoints(hps), 2);
  assert.equal(restoreDestroyedHardpoints(hps), 2);
  assert.equal(countDestroyedHardpoints(hps), 0);
  assert.deepEqual(
    { ...hps[1] },
    { id: 'b', type: 'missile', mount: null, ammo: null, maxAmmo: null, destroyed: false, __lostMount: null, __supportMisses: 0, missileCd: 0 }
  );
  assert.deepEqual(hps[2].hangarSquadrons, []);
  assert.equal(hps[0].mount, 'railgun_mk2');
  assert.equal(restoreDestroyedHardpoints(hps), 0);
  assert.equal(countDestroyedHardpoints(undefined), 0);
  assert.equal(restoreDestroyedHardpoints(undefined), 0);
  assert.ok(HARDPOINT_SERVICE.dockCostPerSocket > 0);
});

test('refillHardpointAmmo: magazynki do maxAmmo gniazda (kampania ×2), z karty broni, gdy gniazdo go nie zna', () => {
  const ammoOf = (id) => ({ missile_rack: 8, supernova_missile: 2 })[id] ?? null;
  const hps = [
    { type: 'missile', mount: 'missile_rack', ammo: 3, maxAmmo: 16 },          // kampania: podwójny zapas
    { type: 'special_missile', mount: 'supernova_missile', ammo: 0, maxAmmo: 2 },
    { type: 'missile', mount: 'missile_rack', ammo: null, maxAmmo: null },      // zapis bez maxAmmo
    { type: 'main', mount: 'railgun_mk2', ammo: null, maxAmmo: null },          // bez magazynka
    { type: 'missile', mount: 'missile_rack', ammo: 8, maxAmmo: 8 },            // pełny
    { type: 'missile', mount: null, ammo: null, maxAmmo: null },                // puste
    { type: 'missile', mount: null, ammo: null, maxAmmo: null, destroyed: true }
  ];
  const before = hardpointAmmoState(hps, ammoOf);
  assert.deepEqual(before, { have: 3 + 0 + 0 + 8, max: 16 + 2 + 8 + 8, slots: 4, missing: 3 });
  assert.equal(refillHardpointAmmo(hps, ammoOf), 3);
  assert.deepEqual([hps[0].ammo, hps[0].maxAmmo], [16, 16]);
  assert.deepEqual([hps[1].ammo, hps[1].maxAmmo], [2, 2]);
  assert.deepEqual([hps[2].ammo, hps[2].maxAmmo], [8, 8]);
  assert.equal(hps[3].ammo, null);
  assert.deepEqual(hardpointAmmoState(hps, ammoOf), { have: 34, max: 34, slots: 4, missing: 0 });
  assert.equal(refillHardpointAmmo(hps, ammoOf), 0, 'drugi raz nic do zrobienia');
});
