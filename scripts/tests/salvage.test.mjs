/**
 * Łup z wraków: podział przy rozpadzie, przypisanie broni do fragmentów,
 * cięcie w polu kontra rozbiórka w doku.
 *
 * Najważniejsze, czego pilnuje: materiał nie może się gubić ani mnożyć przy
 * rozpadzie, a działo musi odlecieć z TYM fragmentem, do którego było
 * przykręcone — na tym stoi cały gameplay „odstrzel sekcję, przyholuj ją".
 */

import {
  ensureSalvageManifest,
  transferSalvageToWreck,
  takeFieldCut,
  takeDockSalvage,
  describeSalvage,
  hasSalvage
} from '../../src/game/salvage.js';
import { createSuite, sumBag, runIfMain } from './harness.mjs';

const COLS = 30;
const ROWS = 30;
const CELL = 10;

/** Sztuczny kadłub 30×30 komórek z czterema działami w rogach. */
function makeShip() {
  const shards = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      shards.push({ c, r, gridX: c * CELL, gridY: r * CELL, active: true });
    }
  }
  return {
    hexGrid: {
      shards,
      srcWidth: COLS * CELL,
      srcHeight: ROWS * CELL,
      baseStructuralCount: shards.length
    },
    __hardpointScaleX: 1,
    __hardpointScaleY: 1,
    displayName: 'Testowa fregata',
    // hp.x/y liczone od środka sprite'a — te cztery siedzą w rogach kadłuba
    editorHardpoints: [
      { id: 'a', type: 'main', mount: 'railgun_mk2', x: -140, y: -140 },
      { id: 'b', type: 'main', mount: 'railgun_mk2', x: 140, y: -140 },
      { id: 'c', type: 'aux', mount: 'ciws_mk1', x: -140, y: 140 },
      { id: 'd', type: 'aux', mount: 'ciws_mk1', x: 140, y: 140 }
    ]
  };
}

/** Dzieli kadłub na pionowe pasy kolumn — razem pokrywają całość. */
function splitIntoBands(parent, bands) {
  return bands.map(([lo, hi]) => {
    const cells = new Set();
    for (let r = 0; r < ROWS; r++) {
      for (let c = lo; c < hi; c++) cells.add(`${c},${r}`);
    }
    const wreck = {};
    transferSalvageToWreck(parent, wreck, key => cells.has(key), cells.size);
    return wreck;
  });
}

export function run() {
  const t = createSuite('salvage');

  t.section('1. Manifest łupu');
  const ship = makeShip();
  const manifest = ensureSalvageManifest(ship);
  t.equal('wykryto 4 działa', manifest.weapons.length, 4);
  t.check('każde działo ma przypisaną komórkę kadłuba', manifest.weapons.every(w => !!w.cell));
  t.equal('działa siedzą w różnych komórkach', new Set(manifest.weapons.map(w => w.cell)).size, 4);
  t.check('złom policzony', manifest.materials.scrap > 0);
  t.check('900 komórek daje płyty kadłuba', manifest.materials.hull_plate >= 4, `(${manifest.materials.hull_plate})`);
  t.note(`materiały: ${JSON.stringify(manifest.materials)}`);

  t.section('1b. NPC z mapą liczebności hardpointów');
  const npc = makeShip();
  // Jednostki flotowe używają `hardpoints` jako metadanych kadłuba, podczas
  // gdy zamontowane działa są obiektami w `editorHardpoints`.
  npc.hardpoints = { large: 4, medium: 4 };
  const npcManifest = ensureSalvageManifest(npc);
  t.equal('mapa liczebności nie blokuje budowy manifestu', npcManifest.weapons.length, 4);

  t.section('2. Rozpad na 3 fragmenty');
  const parent = makeShip();
  ensureSalvageManifest(parent);
  const totalBefore = sumBag(parent._salvage.materials);
  const weaponsBefore = parent._salvage.weapons.length;
  const wrecks = splitIntoBands(parent, [[0, 10], [10, 20], [20, 30]]);

  const totalAfter = wrecks.reduce((acc, w) => acc + sumBag(w._salvage.materials), 0)
    + sumBag(parent._salvage.materials);
  t.equal('materiał się nie gubi ani nie mnoży', totalAfter, totalBefore);

  const weaponsAfter = wrecks.reduce((acc, w) => acc + w._salvage.weapons.length, 0);
  t.equal('wszystkie działa trafiły do fragmentów', weaponsAfter, weaponsBefore);
  t.equal('rodzic nie trzyma już dział', parent._salvage.weapons.length, 0);
  t.check(
    'działa odleciały ze SWOIMI pasami, nie losowo',
    wrecks[0]._salvage.weapons.length === 2 && wrecks[2]._salvage.weapons.length === 2,
    `(${wrecks.map(w => w._salvage.weapons.length).join('/')})`
  );
  t.equal('środkowy pas bez dział', wrecks[1]._salvage.weapons.length, 0);
  t.note(`podział materiału: ${wrecks.map(w => sumBag(w._salvage.materials)).join(' / ')}`);

  t.section('3. Cięcie w polu');
  const cut = wrecks[0];
  const cutWeapons = cut._salvage.weapons.length;
  const harvested = {};
  // 40 porcji po 5% = 200% wraku, czyli z zapasem na pełne przecięcie.
  for (let i = 0; i < 40; i++) {
    for (const [id, amount] of Object.entries(takeFieldCut(cut, 0.05))) {
      harvested[id] = (harvested[id] || 0) + amount;
    }
  }
  t.check('cięcie coś dało', sumBag(harvested) > 0, `(${JSON.stringify(harvested)})`);
  t.equal('cięcie NIE zabiera broni', cut._salvage.weapons.length, cutWeapons);
  t.check('złom wychodzi w całości', (cut._salvage.materials.scrap || 0) < 1, `(zostało ${cut._salvage.materials.scrap})`);
  t.check('komponenty częściowo zostają w konstrukcji', sumBag(cut._salvage.materials) > 0, '(wycięto wszystko?)');
  t.note(`wycięte: ${JSON.stringify(harvested)}`);

  t.section('4. Rozbiórka w doku');
  const docked = wrecks[2];
  const expectWeapons = docked._salvage.weapons.length;
  const expectMaterials = sumBag(docked._salvage.materials);
  const result = takeDockSalvage(docked);
  t.equal('broń odzyskana w całości', result.weapons.length, expectWeapons);
  t.check(
    'materiały odzyskane',
    Math.abs(sumBag(result.materials) - expectMaterials) <= expectWeapons + 2,
    `(${sumBag(result.materials)} vs ${expectMaterials})`
  );
  t.check('manifest opróżniony', docked._salvage.weapons.length === 0 && sumBag(docked._salvage.materials) === 0);
  t.equal('druga rozbiórka nic nie daje', sumBag(takeDockSalvage(docked).materials), 0);
  t.check('rozebrany wrak przestaje być celem odzysku', !hasSalvage(docked));
  t.note(`odzyskana broń: ${result.weapons.join(', ')}`);

  t.section('4b. Cięcie w polu, a potem dok — materiał nie może się namnożyć');
  // Po cięciu zapas wraku jest UŁAMKOWY. Rozbiórka w doku zaokrąglała go
  // do najbliższej sztuki, więc wrak z 0.6 stali oddawał 1 — czyli tworzył
  // materiał z niczego. Suma obu ścieżek nie może przekroczyć stanu wyjściowego.
  const mixed = makeShip();
  ensureSalvageManifest(mixed);
  const mixedWreck = {};
  const allCells = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) allCells.add(`${c},${r}`);
  transferSalvageToWreck(mixed, mixedWreck, key => allCells.has(key), allCells.size);
  const startTotal = sumBag(mixedWreck._salvage.materials);

  const fieldTotal = {};
  // Jedno małe cięcie zostawia ułamki w każdej pozycji — to jest warunek błędu.
  for (const [id, amount] of Object.entries(takeFieldCut(mixedWreck, 0.07))) {
    fieldTotal[id] = (fieldTotal[id] || 0) + amount;
  }
  const dockTotal = sumBag(takeDockSalvage(mixedWreck).materials);
  t.check('łączny odzysk nie przekracza zawartości wraku',
    sumBag(fieldTotal) + dockTotal <= startTotal + 1e-9,
    `(wycięto ${sumBag(fieldTotal)} + dok ${dockTotal} > ${startTotal})`);

  t.section('5. Wrak asteroidy daje rudę, nie złom po statku');
  const rock = makeShip();
  rock.isAsteroidHex = true;
  rock.asteroidRef = { resource: 'iron_ore' };
  rock.editorHardpoints = [];
  const rockManifest = ensureSalvageManifest(rock);
  t.check('ruda żelaza w manifeście', rockManifest.materials.iron_ore > 0, `(${JSON.stringify(rockManifest.materials)})`);
  t.check('brak złomu po statku', !rockManifest.materials.scrap);
  t.check('brak komponentów okrętowych', !rockManifest.materials.hull_plate);

  t.section('6. Opis do UI');
  const desc = describeSalvage(wrecks[1]);
  t.equal('opis niesie etykietę źródła', desc.label, 'Testowa fregata');
  t.check('opis wylicza materiały', desc.materials.length > 0);
  t.check('opis podaje liczbę dział', Number.isFinite(desc.weaponCount));

  return t.results;
}

runIfMain(import.meta.url, run);
