// Klasy okrętów z mostka i rdzenia (src/data/shipClasses.js — etap 2 stoczni z klocków, docs/PROPOZYCJA-KLASY-MOSTEK-RDZEN.md):
// tabele klas i rdzeni, utrzymanie z powierzchni, tarcza, typowy pobór gniazd (mediany energyCost), napęd z zapasu mocy,
// kolejka priorytetów przy niedoborze, kontrola limitów mostka.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIP_CLASSES, CORE_LEVELS, TYPICAL_MOUNT_MW, MISSILE_MOUNT_MW, POWER_PRIORITY_DEFAULT, POWER_CATEGORIES,
  hullUpkeepMW, shieldMW, driveMultiplier, mountPowerMW, weaponPowerMW, weaponMountIssue, weaponsForMount,
  shipClassCheck, shipPowerBalance, classForHull, coreLevelMax, sizeRank
} from '../src/data/shipClasses.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b} ± ${eps}`);

test('klasy I–VI i rdzenie R1–R6: tabele rosnące, liczby z propozycji, rdzeń najwyżej poziom ponad mostek', () => {
  assert.equal(SHIP_CLASSES.length, 6);
  assert.deepEqual(SHIP_CLASSES.map((c) => c.label), ['Fregata', 'Niszczyciel', 'Krążownik', 'Pancernik', 'Kapitał', 'Superkapitał']);
  assert.deepEqual(SHIP_CLASSES.map((c) => c.areaMax), [10000, 32000, 90000, 200000, 420000, 900000]);
  assert.deepEqual(SHIP_CLASSES.map((c) => [c.mountsMax, c.heavyMax]), [[12, 7], [22, 13], [26, 15], [38, 22], [44, 26], [60, 32]]);
  assert.deepEqual(SHIP_CLASSES.map((c) => c.weaponSize), ['S', 'M', 'M', 'L', 'L', 'Capital']);
  for (let i = 1; i < 6; i++) {
    assert.ok(CORE_LEVELS[i].mw > CORE_LEVELS[i - 1].mw, `R${i + 1} > R${i}`);
    assert.ok(CORE_LEVELS[i].proposal > CORE_LEVELS[i - 1].proposal);
  }
  assert.deepEqual(CORE_LEVELS.map((c) => c.proposal), [65, 180, 280, 450, 700, 1500]);
  assert.equal(coreLevelMax(1), 2);
  assert.equal(coreLevelMax(6), 6);
});

test('utrzymanie 0,07 · powierzchnia^0,6 (Custos ~13, Bellator ~95, Colossus ~229), tarcza = pół utrzymania', () => {
  near(hullUpkeepMW(6400), 13.4, 0.2, 'Custos');
  near(hullUpkeepMW(165300), 94.6, 0.5, 'Bellator');
  near(hullUpkeepMW(721600), 229.1, 0.5, 'Colossus');
  near(shieldMW(165300), hullUpkeepMW(165300) * 0.5, 1e-9, 'tarcza');
  assert.equal(hullUpkeepMW(0), 0);
});

test('typowy pobór gniazda: mediany energyCost typu i rozmiaru (bez broni tylko-NPC), rakiety i hangary', () => {
  assert.deepEqual([TYPICAL_MOUNT_MW.main.S, TYPICAL_MOUNT_MW.main.M, TYPICAL_MOUNT_MW.main.L], [4, 7.5, 14]);
  assert.equal(TYPICAL_MOUNT_MW.main.Capital, 14, 'główna Capital — brak broni, najbliższy mniejszy rozmiar (L)');
  assert.deepEqual([TYPICAL_MOUNT_MW.aux.S, TYPICAL_MOUNT_MW.aux.M, TYPICAL_MOUNT_MW.aux.L], [3, 4, 8]);
  assert.deepEqual([TYPICAL_MOUNT_MW.special.S, TYPICAL_MOUNT_MW.special.M, TYPICAL_MOUNT_MW.special.L], [12, 22, 40]);
  assert.equal(TYPICAL_MOUNT_MW.hangar.S, 5);
  assert.equal(TYPICAL_MOUNT_MW.builtin.Capital, 200, 'Hexlance — promień śmierci jest tylko dla NPC');
  for (const s of ['S', 'M', 'L', 'Capital']) assert.equal(TYPICAL_MOUNT_MW.missile[s], MISSILE_MOUNT_MW);
  // pobór gniazda: broń przypisana, puste, typowa
  assert.equal(mountPowerMW('main', 'M', 'railgun_mk2'), MASTER_WEAPONS.railgun_mk2.energyCost);
  assert.equal(mountPowerMW('main', 'M', ''), 0);
  assert.equal(mountPowerMW('main', 'M', undefined), 7.5);
  assert.equal(weaponPowerMW('death_ray'), 400);
  assert.equal(weaponPowerMW('grad_launcher'), MISSILE_MOUNT_MW, 'rakieta bez energyCost');
});

test('broń w gnieździe: typ, rozmiar ≤ gniazdo, bez broni tylko-NPC (chyba że NPC)', () => {
  assert.equal(weaponMountIssue('tempest_ion_s', 'main', 'S'), null);
  assert.match(weaponMountIssue('railgun_mk2', 'main', 'S'), /za duża/);
  assert.match(weaponMountIssue('laser_pd_mk1', 'main', 'M'), /pomocnicze/);
  assert.match(weaponMountIssue('death_ray', 'builtin', 'Capital'), /NPC/);
  assert.equal(weaponMountIssue('death_ray', 'builtin', 'Capital', { npc: true }), null);
  const list = weaponsForMount('main', 'M');
  assert.ok(list.includes('railgun_mk2') && list.includes('tempest_ion_s') && !list.includes('tempest_ion_l'));
  assert.ok(list.every((id) => sizeRank(MASTER_WEAPONS[id].size) <= sizeRank('M')));
});

test('napęd z zapasu mocy: × 0,7 bez zapasu … × 1,2 przy zapasie ≥ 40%, liniowo', () => {
  near(driveMultiplier(0), 0.7, 1e-9, '0%');
  near(driveMultiplier(0.2), 0.95, 1e-9, '20%');
  near(driveMultiplier(0.4), 1.2, 1e-9, '40%');
  near(driveMultiplier(0.9), 1.2, 1e-9, '90%');
  near(driveMultiplier(-1), 0.7, 1e-9, 'ujemny');
});

test('bilans mocy: utrzymanie pierwsze, kolejka priorytetów, urządzenie za duże wyłączone, mniejsze dalej się mieszczą', () => {
  // R1 = 45 MW; pow. 6400 → utrzymanie 13,4 + tarcza 6,7
  const mounts = [
    { slot: 'main', size: 'S', weapon: 'tempest_ion_s' },   // 4
    { slot: 'special', size: 'S', weapon: 'special_valkyrie_s' },   // 12
    { slot: 'main', size: 'S', weapon: 'tempest_ion_s' },   // 4
    { slot: 'aux', size: 'S', weapon: 'laser_pd_mk1' }      // 3
  ];
  const b = shipPowerBalance({ area: 6400, coreLevel: 1, mounts });
  assert.equal(b.capacity, 45);
  near(b.upkeep + b.shield + 23, b.used, 1e-6, 'wszystko z prądem');
  assert.deepEqual([...b.on], [1, 1, 1, 1]);
  near(b.spareFrac, (45 - b.used) / 45, 1e-9, 'zapas');
  // niedobór: specjalna (12) się nie mieści po tarczy, PD i głównych — mniejsze dalej tak
  const small = shipPowerBalance({ area: 14000, coreLevel: 1, mounts });     // utrzymanie ~21,4, tarcza ~10,7
  assert.equal(small.on[1], 0, 'specjalna wyłączona');
  assert.deepEqual([small.on[0], small.on[2], small.on[3]], [1, 1, 1]);
  assert.ok(small.deficit > 0 && small.spareFrac < 0.15);
  // priorytet gracza: specjalna przed tarczą (po utrzymaniu 23,5 MW: specjalna 12, tarcza 10,8, na resztę braknie)
  const pr = shipPowerBalance({ area: 14000, coreLevel: 1, mounts, priority: ['special', 'shield', 'main', 'aux'] });
  assert.deepEqual([...pr.on], [0, 1, 0, 0], 'specjalna z prądem, główne i PD wyłączone');
  assert.ok(pr.devices.find((d) => d.cat === 'shield').on, 'tarcza z prądem');
  // utrzymanie ponad moc — wszystko wyłączone, napęd minimalny
  const over = shipPowerBalance({ area: 80000, coreLevel: 1, mounts });
  assert.ok(over.upkeepOver);
  assert.deepEqual([...over.on], [0, 0, 0, 0]);
  near(over.drive, 0.7, 1e-9, 'napęd');
  // kolejność domyślna obejmuje wszystkie kategorie
  assert.deepEqual([...POWER_PRIORITY_DEFAULT].sort(), [...POWER_CATEGORIES].sort());
});

test('limity mostka: powierzchnia, gniazda, ciężkie, rozmiar gniazda i broni, rdzeń; najniższa klasa z kadłuba', () => {
  const m = (slot, size = 'S', weapon) => ({ slot, size, weapon });
  assert.deepEqual(shipClassCheck({ bridgeLevel: 1, coreLevel: 1, area: 9000, mounts: [m('main'), m('aux')] }).issues, []);
  const codes = (c) => c.issues.map((i) => i.code).sort();
  assert.deepEqual(codes(shipClassCheck({ bridgeLevel: 1, coreLevel: 3, area: 12000, mounts: [m('main', 'M')] })), ['area', 'core', 'size']);
  const heavy = Array.from({ length: 8 }, () => m('main'));
  assert.deepEqual(codes(shipClassCheck({ bridgeLevel: 1, coreLevel: 1, area: 100, mounts: heavy })), ['heavy']);
  assert.deepEqual(codes(shipClassCheck({ bridgeLevel: 1, coreLevel: 1, area: 100, mounts: [...heavy.slice(0, 6), ...Array.from({ length: 7 }, () => m('aux'))] })), ['mounts']);
  assert.deepEqual(codes(shipClassCheck({ bridgeLevel: 1, coreLevel: 1, area: 100, mounts: [m('main', 'S', 'railgun_mk2')] })), ['weapon']);
  assert.equal(classForHull(9000, [m('main')]), 1);
  assert.equal(classForHull(9000, [m('main', 'M')]), 2);
  assert.equal(classForHull(150000, []), 4);
  assert.equal(classForHull(5e6, []), 6, 'poza drabiną — najwyższa');
});
