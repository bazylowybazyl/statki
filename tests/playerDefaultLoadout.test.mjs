import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Hexlance zniknął z Atlasa na pół roku, bo `autoMountDefaults()` i układ
// hardpointów rozjechały się po cichu: broń przeszła z gniazda `special` na
// `builtin`, a nikt tego nie zauważył, bo montaż nieudany NIC nie mówi.
// Te testy pilnują, żeby każda broń z domyślnego fitu miała gdzie usiąść.

function parseAutoMountDefaults() {
  const body = indexSource.match(/function autoMountDefaults\(\) \{([\s\S]*?)\n    \}/);
  assert.ok(body, 'nie znaleziono autoMountDefaults() w index.html');
  const out = [];
  const call = /mountFirstFree\(HP\.([A-Z_]+),\s*'([^']+)',\s*(\d+)\)/g;
  let m;
  while ((m = call.exec(body[1]))) {
    out.push({ hpConst: m[1], weaponId: m[2], count: Number(m[3]) });
  }
  assert.ok(out.length >= 5, `spodziewano się kilku wpisów, znaleziono ${out.length}`);
  return out;
}

function parseHpEnum() {
  const block = indexSource.match(/const HP = Object\.freeze\(\{([\s\S]*?)\}\)/)
    || indexSource.match(/HP = \{([\s\S]*?)\n    \}/);
  assert.ok(block, 'nie znaleziono mapy HP w index.html');
  const out = {};
  const entry = /([A-Z_]+):\s*'([a-z_]+)'/g;
  let m;
  while ((m = entry.exec(block[1]))) out[m[1]] = m[2];
  return out;
}

function parseDefaultStock() {
  const block = indexSource.match(/const DEFAULT_INVENTORY_STOCK = \{([\s\S]*?)\n    \};/);
  assert.ok(block, 'nie znaleziono DEFAULT_INVENTORY_STOCK w index.html');
  const out = {};
  const entry = /([a-z0-9_]+):\s*(\d+)/g;
  let m;
  while ((m = entry.exec(block[1]))) out[m[1]] = Number(m[2]);
  return out;
}

test('każda broń z domyślnego fitu pasuje do swojego gniazda i ma gdzie usiąść na Atlasie', () => {
  const HP = parseHpEnum();
  const atlas = SHIP_EDITOR_DEFAULTS.ships.atlas;
  const slotsByType = {};
  for (const marker of atlas.hardpoints) {
    const type = String(marker?.type || '').toLowerCase();
    slotsByType[type] = (slotsByType[type] || 0) + 1;
  }

  for (const { hpConst, weaponId, count } of parseAutoMountDefaults()) {
    const hpType = HP[hpConst];
    assert.ok(hpType, `HP.${hpConst} nie istnieje`);

    const weapon = MASTER_WEAPONS[weaponId];
    assert.ok(weapon, `${weaponId}: broń nie istnieje w katalogu`);

    // setHardpointMount odrzuca montaż przy niezgodności i NIC nie zgłasza.
    assert.equal(
      weapon.mountType, hpType,
      `${weaponId}: mountType '${weapon.mountType}', a automount wkłada go w '${hpType}'`
    );

    // Liczba sztuk jest CELOWO zawyżona („obsadź wszystko, co jest"), więc
    // nadmiar nad liczbą gniazd jest w porządku — zostaje w ładowni. Zero gniazd
    // nie jest: wtedy broń przepada i nikt się nie dowie.
    assert.ok(
      (slotsByType[hpType] || 0) >= 1,
      `${weaponId}: Atlas nie ma ani jednego hardpointu '${hpType}' (automount chce ${count} szt.)`
    );
  }
});

test('ładownia startowa pokrywa domyślny fit', () => {
  const stock = parseDefaultStock();
  for (const { weaponId, count } of parseAutoMountDefaults()) {
    assert.ok(
      (stock[weaponId] || 0) >= count,
      `${weaponId}: automount chce ${count} szt., a DEFAULT_INVENTORY_STOCK daje ${stock[weaponId] || 0}`
    );
  }
});

// Sedno buga „ani na kadłubie, ani w magazynie": automount zdejmuje fit z ładowni,
// a loadLoadout podmienia całą tablicę hardpointów na świeżą. Bez zwrotu do ładowni
// te sztuki znikają z gry na amen.
test('loadLoadout zwraca automountowany fit do ładowni, zanim podmieni hardpointy', () => {
  const body = indexSource.match(/function loadLoadout\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(body, 'nie znaleziono loadLoadout() w index.html');
  const reclaim = body[1].indexOf('reclaimMountedWeaponsToInventory()');
  const swap = body[1].indexOf('Game.player.hardpoints = fresh');
  assert.ok(reclaim >= 0, 'loadLoadout nie zwraca broni do ładowni przed podmianą tablicy');
  assert.ok(swap >= 0, 'nie znaleziono podmiany tablicy hardpointów');
  assert.ok(reclaim < swap, 'zwrot do ładowni musi poprzedzać podmianę tablicy');
});

// Broń, która zmieniła rodzaj gniazda (hexlance: special → builtin), musi trafić
// tam, gdzie pasuje DZIŚ — inaczej zapis z localStorage cicho ją gubi.
test('zapisany fit trafia do kubełka po aktualnym mountType, nie po typie z zapisu', () => {
  const body = indexSource.match(/function loadLoadout\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(body);
  assert.match(
    body[1],
    /const bucket = WEAPONS\[saved\.mount\]\?\.mountType \|\| saved\.type;/,
    'loadLoadout kubełkuje zapisane wpisy po `saved.type` zamiast po aktualnym mountType'
  );
});

test('hexlance siedzi na gnieździe builtin, a Atlas takie gniazdo ma', () => {
  assert.equal(MASTER_WEAPONS.hexlance_siege.mountType, 'builtin');
  const builtins = SHIP_EDITOR_DEFAULTS.ships.atlas.hardpoints
    .filter(hp => String(hp?.type || '').toLowerCase() === 'builtin');
  assert.equal(builtins.length, 1, 'Atlas ma mieć dokładnie jedno gniazdo built-in');
});
