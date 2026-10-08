// Klasa dział snajperskich (2026-10-08, decyzja D3, docs/PLAN-fitowanie.md § 4.3.1; src/data/weapons.js
// § KLASA DZIAŁ SNAJPERSKICH): pole `weaponClass: 'sniper'` — broń, której jedyną zaletą jest zasięg.
// Strażnik reguł klasy: zasięg ≥ 6,5 km, pocisk do końca zasięgu ≤ 1,4 s, a DPS niższy (przy dłuższym
// zasięgu) niż u najdalej sięgającej broni zwykłej tego samego gniazda i rozmiaru — „dłuższy zasięg = mniej DPS”.
// node --test tests/weaponSniperClass.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_WEAPONS, getWeaponSizeRank } from '../src/data/weapons.js';

const SNIPER_RANGE_MIN = 6500;
const SNIPER_FLIGHT_MAX = 1.4;

// DPS jak w planie fitowania (§ 3.4): obrażenia × lufy × salwa / przeładowanie.
const dps = (d) => (Number(d.baseDamage) || 0) * Math.max(1, Number(d.barrelsPerShot) || 1)
  * Math.max(1, Number(d.burstCount) || 1) / Math.max(1e-6, Number(d.cooldown) || 1);
const all = Object.values(MASTER_WEAPONS);
const snipers = all.filter((d) => d.weaponClass === 'sniper');
// Broń zwykła do porównań: działa gniazd main i special (bez obrony punktowej, rakiet, hangarów i broni wbudowanej).
const ordinaryGuns = all.filter((d) => !d.weaponClass && (d.mountType === 'main' || d.mountType === 'special'));

test('klasa: pole weaponClass tylko „sniper”, skład klasy, kategoria bez zmian (Lanca to rail)', () => {
  for (const d of all) if (d.weaponClass !== undefined) assert.equal(d.weaponClass, 'sniper', `${d.id}: nieznana klasa ${d.weaponClass}`);
  assert.deepEqual(snipers.map((d) => d.id).sort(), [
    'lance_rail_l', 'lance_rail_m', 'siege_railgun', 'special_valkyrie_m', 'special_valkyrie_railgun', 'special_valkyrie_s'
  ]);
  for (const d of snipers) assert.equal(d.category, 'rail', `${d.id}: klasa to nie kategoria`);
  assert.equal(MASTER_WEAPONS.special_valkyrie_s.baseRange, 6500, 'Kolec 5 → 6,5 km (D10)');
});

test('zasięg ≥ 6,5 km i pocisk do końca zasięgu ≤ 1,4 s', () => {
  for (const d of snipers) {
    assert.ok(d.baseRange >= SNIPER_RANGE_MIN, `${d.id}: zasięg ${d.baseRange}`);
    const t = d.baseRange / d.baseSpeed;
    assert.ok(t <= SNIPER_FLIGHT_MAX, `${d.id}: lot do końca zasięgu ${t.toFixed(2)} s`);
  }
});

// Gniazdo special S / M nie ma dziś zwykłej broni (plan § 4.9: broń specjalna S / M krótkiego zasięgu — etap 7):
// wtedy porównanie z najbliższym większym rozmiarem tego gniazda, który ją ma (Kolec i Oszczep ↔ Yamato L).
function comparatorFor(d) {
  const rank = getWeaponSizeRank(d.size);
  const sameMount = ordinaryGuns.filter((o) => o.mountType === d.mountType && getWeaponSizeRank(o.size) >= rank);
  if (!sameMount.length) return null;
  const nearest = Math.min(...sameMount.map((o) => getWeaponSizeRank(o.size)));
  const pool = sameMount.filter((o) => getWeaponSizeRank(o.size) === nearest);
  const far = Math.max(...pool.map((o) => o.baseRange));
  return pool.filter((o) => o.baseRange === far);
}

test('dłuższy zasięg = mniej DPS: snajper wobec najdalej sięgającej broni zwykłej tego gniazda i rozmiaru', () => {
  for (const d of snipers) {
    const list = comparatorFor(d);
    assert.ok(list && list.length, `${d.id}: brak broni zwykłej w gnieździe ${d.mountType}`);
    for (const o of list) {
      assert.ok(d.baseRange > o.baseRange, `${d.id} (${d.baseRange} j.) nie sięga dalej niż ${o.id} (${o.baseRange} j.)`);
      assert.ok(dps(d) < dps(o), `${d.id}: DPS ${dps(d).toFixed(1)} ≥ ${o.id} ${dps(o).toFixed(1)}`);
    }
  }
  // Liczby z planu (D10): Lanca 20 DPS < Tempest Mk II 25 (4,5 km), Lanca Ciężka 25 < Tempest Ciężki 36 / Helios Lance 37,5 (6 km).
  assert.ok(Math.abs(dps(MASTER_WEAPONS.lance_rail_m) - 20) < 1e-9);
  assert.ok(Math.abs(dps(MASTER_WEAPONS.lance_rail_l) - 25) < 1e-9);
  assert.deepEqual(comparatorFor(MASTER_WEAPONS.lance_rail_m).map((o) => o.id), ['railgun_mk2']);
  assert.deepEqual(comparatorFor(MASTER_WEAPONS.lance_rail_l).map((o) => o.id).sort(), ['helios_lance_l', 'tempest_ion_l']);
  assert.deepEqual(comparatorFor(MASTER_WEAPONS.special_valkyrie_s).map((o) => o.id), ['special_yamato_l']);
  assert.deepEqual(comparatorFor(MASTER_WEAPONS.siege_railgun).map((o) => o.id), ['special_yamato_cannon']);
});

// D4: Ion Plasma Gatling 240 → 640 DPS (bliski tank; broń tylko gracza) — obrażenia na strzał, nie szybkostrzelność
// (rodzina bez krateru na miarę rany, src/3d/hullDamageStamps.js; uzasadnienie przy danych broni).
test('Plasma Gatling (D4): 640 DPS przy dawnym przeładowaniu 0,25 s', () => {
  const g = MASTER_WEAPONS.special_plasma_gatling;
  assert.equal(g.cooldown, 0.25);
  assert.ok(Math.abs(dps(g) - 640) < 1e-9, `DPS ${dps(g)}`);
});
