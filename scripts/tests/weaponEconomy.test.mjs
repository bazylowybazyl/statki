/**
 * Testy ekonomii uzbrojenia.
 *
 * Pilnują trzech rzeczy, których złamanie widać dopiero po godzinie biegu:
 * że podział na balistykę i energię naprawdę coś kosztuje, że broń da się
 * kupić za kredyty z magazynu portu, i że amunicja jest wydatkiem BIEŻĄCYM,
 * a nie jednorazowym.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCES, RESOURCE_KEYS, RECIPES } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import {
  MASTER_WEAPONS, DAMAGE_TYPE, AMMO_TYPE, WEAPON_GOOD,
  weaponDamageType, weaponAmmoType, weaponAmmoPerShot, weaponTradeGood,
  isBallistic, isEnergy, listWeaponsByDamageType
} from '../../src/data/weapons.js';
import {
  weaponBuildCost, weaponMaterialValue, weaponPriceAt, stationCanBuildWeapon,
  buyWeaponFrom, sellWeaponTo, ammoForShots, sustainCostPerMinute, weaponCatalog,
  squadronBuildCost, squadronRearmCost, squadronTotalCost, squadronCatalog
} from '../../src/game/weaponEconomy.js';
import {
  FIGHTER_SQUADRON_DEFS, getHangarSquadronCapacity
} from '../../src/data/fighterSquadrons.js';
import {
  WAR_MODEL, ammoForPower, drawAmmo, declareAmmoDemand
} from '../../src/game/traffic/warDispatcher.js';
import { WARSHIP_CLASSES } from '../../src/game/traffic/shipyards.js';
import { stationWantsResource } from '../../src/game/stationEconomy.js';

function makeEcon(fill = 500) {
  return {
    resources: Object.fromEntries(RESOURCE_KEYS.map(k => [k, fill])),
    capacity: Object.fromEntries(RESOURCE_KEYS.map(k => [k, 1000]))
  };
}

export function run() {
  const t = createSuite('weaponEconomy');

  // ----------------------------------------------------------
  t.section('Każda broń ma typ rażenia, a balistyczna ma amunicję');

  let bezTypu = 0;
  let balistyczneBezAmunicji = 0;
  let energetyczneZAmunicja = 0;
  for (const weapon of Object.values(MASTER_WEAPONS)) {
    const typ = weaponDamageType(weapon);
    if (!typ) bezTypu++;
    if (typ === DAMAGE_TYPE.BALLISTIC && !weaponAmmoType(weapon)) balistyczneBezAmunicji++;
    if (typ === DAMAGE_TYPE.ENERGY && weaponAmmoType(weapon)) energetyczneZAmunicja++;
  }
  t.equal('każda broń ma typ rażenia', bezTypu, 0);
  t.equal('żadna balistyczna nie lata bez amunicji', balistyczneBezAmunicji, 0);
  t.equal('żadna energetyczna nie wozi skrzyń', energetyczneZAmunicja, 0);

  const balistyczne = listWeaponsByDamageType(DAMAGE_TYPE.BALLISTIC);
  const energetyczne = listWeaponsByDamageType(DAMAGE_TYPE.ENERGY);
  t.check('są obie szkoły', balistyczne.length > 0 && energetyczne.length > 0);
  t.note(`balistyka ${balistyczne.length}, energia ${energetyczne.length}, `
    + `hangary ${listWeaponsByDamageType(DAMAGE_TYPE.CARRIER).length}`);

  t.check('railgun to balistyka', isBallistic('railgun_mk2'));
  t.check('laser wiązkowy to energia', isEnergy('beam_pulse'));
  t.equal('flak ma własny pocisk', weaponAmmoType('flak_l'), AMMO_TYPE.FLAK);
  t.equal('torpeda ma własny pocisk', weaponAmmoType('siege_torpedo'), AMMO_TYPE.TORPEDO);
  t.equal('działo kinetyczne to towar balistyczny',
    weaponTradeGood('railgun_mk2'), WEAPON_GOOD.BALLISTIC);
  t.equal('CIWS liczy się jako obrona punktowa',
    weaponTradeGood('ciws_mk1'), WEAPON_GOOD.POINT_DEFENCE);

  // Każdy identyfikator amunicji MUSI być prawdziwym surowcem, inaczej
  // zapotrzebowanie trafia w pustkę i nikt tego nie zauważy.
  for (const id of Object.values(AMMO_TYPE)) {
    t.check(`${id} istnieje jako surowiec`, !!RESOURCES[id]);
    t.check(`${id} da się wyprodukować`,
      Object.values(RECIPES).some(r => r.out[id] > 0));
  }
  for (const id of Object.values(WEAPON_GOOD)) {
    t.check(`${id} istnieje jako surowiec`, !!RESOURCES[id]);
    t.check(`${id} da się wyprodukować`,
      Object.values(RECIPES).some(r => r.out[id] > 0));
  }

  // ----------------------------------------------------------
  t.section('Większa lufa zjada więcej — i to jest cała cena rozmiaru');

  t.check('ciężki kartacz zjada więcej niż lekki',
    weaponAmmoPerShot('flak_l') > weaponAmmoPerShot('flak_s'));
  t.check('salwa torped kosztuje sześć pocisków',
    weaponAmmoPerShot('torpedo_salvo') > weaponAmmoPerShot('siege_torpedo'));
  t.equal('emiter nie zjada nic', weaponAmmoPerShot('helios_laser'), 0);

  // ----------------------------------------------------------
  t.section('Broń składa się z pozycji, którymi handluje gospodarka');

  const katalog = weaponCatalog();
  t.check('katalog obejmuje cały arsenał', katalog.length > 30);
  t.check('hangary też są w katalogu — kupuje się je z maszynami',
    katalog.some(row => row.damageType === DAMAGE_TYPE.CARRIER));
  t.check('katalog da się zawęzić do samych luf',
    weaponCatalog({ excludeCarriers: true })
      .every(row => row.damageType !== DAMAGE_TYPE.CARRIER));

  const kosztRail = weaponBuildCost('railgun_mk2');
  t.check('działo siada na PODSTAWIE, a nie zamiast niej',
    kosztRail.weapon_mount > 0 && kosztRail.gun_ballistic > 0);
  t.check('Capital kosztuje więcej niż S',
    weaponMaterialValue('tempest_ion_l') > weaponMaterialValue('tempest_ion_s'));
  t.check('superbroń jest wielokrotnie droższa od seryjnej',
    weaponMaterialValue('special_yamato_cannon') > weaponMaterialValue('helios_lance_l') * 3);

  // Ta nierówność jest sednem podziału: energia droga w budowie, tania w użyciu.
  t.check('emiter kosztuje więcej niż działo tej samej klasy',
    weaponMaterialValue('helios_laser') > weaponMaterialValue('railgun_mk2'));
  t.equal('emiter nic nie kosztuje w utrzymaniu', sustainCostPerMinute('helios_laser'), 0);
  t.check('działo kinetyczne kosztuje w utrzymaniu',
    sustainCostPerMinute('vulcan_minigun') > 0);
  t.check('wyrzutnia torped jest najdroższa w utrzymaniu',
    sustainCostPerMinute('torpedo_salvo') > sustainCostPerMinute('vulcan_minigun') * 10);

  // ----------------------------------------------------------
  t.section('Broń da się kupić za kredyty — z magazynu portu');

  const port = { id: 'earth', factionId: FACTION.TERRA_NOVA };
  const econ = makeEcon(500);
  const wycena = weaponPriceAt(port, econ, 'railgun_mk2');
  t.check('port wycenia broń', !!wycena && wycena.sell > 0);
  t.check('sprzedaje drożej, niż odkupuje', wycena.sell > wycena.buy);
  t.check('pełny magazyn ma z czego złożyć', stationCanBuildWeapon(econ, 'railgun_mk2'));

  const przedKupnem = econ.resources.gun_ballistic;
  const zakup = buyWeaponFrom(port, econ, 'railgun_mk2');
  t.check('zakup dochodzi do skutku', !!zakup && zakup.price > 0);
  t.equal('działa ubyły z magazynu portu',
    econ.resources.gun_ballistic, przedKupnem - kosztRail.gun_ballistic);

  const odsprzedaz = sellWeaponTo(port, econ, 'railgun_mk2');
  t.check('odkup zwraca składniki', !!odsprzedaz);
  t.equal('magazyn wrócił do stanu sprzed zakupu',
    econ.resources.gun_ballistic, przedKupnem);
  t.check('gracz traci na obrocie', odsprzedaz.price < zakup.price);

  // Pusty port nie sprzedaje niczego — to jest realna odpowiedź „nie ma na stanie".
  const pusty = makeEcon(0);
  t.check('pusty port nie ma z czego złożyć', !stationCanBuildWeapon(pusty, 'railgun_mk2'));
  t.equal('i nie sprzedaje', buyWeaponFrom(port, pusty, 'railgun_mk2'), null);
  t.check('ale nadal podaje cenę i brakującą ilość',
    weaponPriceAt(port, pusty, 'railgun_mk2')?.missing > 0);

  // Cena jest LOKALNA: port głodny płaci więcej niż syty.
  const glodny = makeEcon(20);
  const syty = makeEcon(900);
  t.check('port bez dział wycenia je drożej',
    weaponPriceAt(port, glodny, 'railgun_mk2').sell
    > weaponPriceAt(port, syty, 'railgun_mk2').sell);

  // ----------------------------------------------------------
  t.section('Amunicja jest wydatkiem bieżącym, nie jednorazowym');

  const zapas = ammoForShots('vulcan_minigun', 1000);
  t.equal('zapas jest w amunicji kinetycznej', zapas.id, AMMO_TYPE.KINETIC);
  t.check('tysiąc strzałów to realna liczba skrzyń', zapas.units > 0);
  t.equal('emiter nie potrzebuje zapasu', ammoForShots('beam_pulse'), null);

  const potrzeba = ammoForPower(100);
  t.check('flota o sile 100 potrzebuje amunicji', Object.keys(potrzeba).length > 0);
  t.check('najwięcej idzie kinetycznej',
    potrzeba.ammo_kinetic > potrzeba.missile_round);

  const magazyn = { resources: { ammo_kinetic: 800, flak_shell: 200, missile_round: 50, torpedo_round: 10 } };
  const pobor = drawAmmo(magazyn, 100);
  t.check('pełne pokrycie zdejmuje zapas', pobor.ratio === 1);
  t.equal('skrzynie ubyły', magazyn.resources.ammo_kinetic, 800 - potrzeba.ammo_kinetic);

  // Brak JEDNEJ pozycji nie może zerować całej gotowości — to była realna
  // usterka: 71 wypraw odwołanych z rzędu, bo torpedy rozeszły się gdzie indziej.
  const bezTorped = { resources: { ammo_kinetic: 9999, flak_shell: 9999, missile_round: 9999, torpedo_round: 0 } };
  const czesciowe = drawAmmo(bezTorped, 100);
  t.check('brak torped osłabia, ale nie zeruje', czesciowe.ratio > 0.5 && czesciowe.ratio < 1,
    `(${czesciowe.ratio.toFixed(2)})`);
  t.check('reszta amunicji i tak schodzi', bezTorped.resources.ammo_kinetic < 9999);

  const pustyMagazyn = { resources: {} };
  t.equal('pusty magazyn daje zerowe pokrycie', drawAmmo(pustyMagazyn, 100).ratio, 0);
  t.check('zero jest poniżej progu wyprawy', 0 < WAR_MODEL.minAmmoRatio);

  // ----------------------------------------------------------
  t.section('Okręt ma działa, a port wie, że trzeba mu wozić skrzynie');

  for (const cls of Object.values(WARSHIP_CLASSES)) {
    const dziala = ['gun_ballistic', 'gun_energy', 'launcher_ordnance', 'pd_turret']
      .reduce((sum, id) => sum + (cls.build[id] || 0), 0);
    t.check(`${cls.id} schodzi z pochylni uzbrojony`, dziala > 0);
    t.check(`${cls.id} ma podstawy pod to uzbrojenie`, (cls.build.weapon_mount || 0) > 0);
  }

  // Koszt na punkt siły musi rosnąć z klasą — inaczej doktryna zwija się
  // do jednej klasy, tak jak przed dodaniem cennika.
  const naSile = Object.values(WARSHIP_CLASSES).map(cls => ({
    id: cls.id,
    krPerSila: Object.entries(cls.build)
      .reduce((sum, [id, qty]) => sum + (RESOURCES[id]?.value || 0) * qty, 0) / cls.power
  })).sort((a, b) => a.krPerSila - b.krPerSila);
  t.equal('najtańsza na punkt siły zostaje fregata', naSile[0].id, 'frigate');
  t.equal('najdroższy zostaje nosiciel', naSile[naSile.length - 1].id, 'carrier');

  // ----------------------------------------------------------
  t.section('Eskadry myśliwskie są towarem, nie tłem');

  t.check('myśliwiec istnieje jako surowiec', !!RESOURCES.fighter_craft);
  t.check('da się go wyprodukować',
    Object.values(RECIPES).some(r => r.out.fighter_craft > 0));

  const eskadry = squadronCatalog();
  t.equal('katalog obejmuje wszystkie typy eskadr',
    eskadry.length, Object.keys(FIGHTER_SQUADRON_DEFS).length);

  for (const eskadra of eskadry) {
    const def = FIGHTER_SQUADRON_DEFS[eskadra.id];
    t.equal(`${eskadra.id}: koszt to tyle maszyn, ile liczy klucz`,
      eskadra.build.fighter_craft, def.squadSize);
    t.check(`${eskadra.id}: przezbrojenie kosztuje rakiety`,
      eskadra.rearmValue > 0);
    // Gdyby uzupełnienie było droższe od maszyn, taniej byłoby stracić eskadrę
    // niż ją dozbroić — a to znaczy, że model zachęca do wyrzucania ludzi.
    t.check(`${eskadra.id}: przezbrojenie tańsze niż nowe maszyny`,
      eskadra.rearmValue < eskadra.value,
      `(${Math.round(eskadra.rearmValue)} wobec ${Math.round(eskadra.value)} CR)`);
  }

  // Uderzeniowa nosi mniej rakiet od wielozadaniowej (4 wobec 8 na maszynę),
  // więc jej przezbrojenie MUSI być tańsze — inaczej dane eskadr i cennik
  // rozjechały się bez ostrzeżenia.
  const wgTypu = Object.fromEntries(eskadry.map(row => [row.id, row]));
  t.check('uderzeniowa jest tańsza w przezbrojeniu niż wielozadaniowa',
    wgTypu.strike.rearmValue < wgTypu.multirole.rearmValue);

  t.check('pełny koszt wystawienia to maszyny plus pierwszy zapas',
    Object.keys(squadronTotalCost('multirole')).length
    > Object.keys(squadronBuildCost('multirole')).length);
  t.check('nieznana eskadra schodzi do domyślnej',
    squadronBuildCost('kosmiczne-ufo').fighter_craft > 0);

  // Hangar kupuje się RAZEM z maszynami — inaczej nosiciel schodzi z pochylni
  // z pustymi pokładami, a myśliwce biorą się znikąd.
  const kosztHangaru = weaponBuildCost('fighter_squad_strike');
  t.check('gniazdo eskadry ma koszt', !!kosztHangaru);
  t.equal('mieści dokładnie jeden klucz', kosztHangaru.fighter_craft,
    FIGHTER_SQUADRON_DEFS.strike.squadSize * getHangarSquadronCapacity('S'));
  t.check('i podstawę pod gniazdo', kosztHangaru.weapon_mount > 0);
  t.check('duży hangar bierze dwa klucze',
    weaponBuildCost('fighter_bay').fighter_craft
    > weaponBuildCost('fighter_squad_strike').fighter_craft);

  // Nosiciel bez grupy lotniczej to najdroższy okręt w grze, który nie ma
  // czym walczyć — dział ma mniej niż krążownik.
  t.check('nosiciel schodzi z pochylni z maszynami',
    (WARSHIP_CLASSES.carrier.build.fighter_craft || 0) > 0);
  t.check('i jest jedyną klasą, która je nosi',
    ['frigate', 'destroyer', 'cruiser']
      .every(id => !WARSHIP_CLASSES[id].build.fighter_craft));

  const portLotniczy = { id: 'earth', factionId: FACTION.TERRA_NOVA };
  const econLotniczy = makeEcon(500);
  const zakupEskadry = buyWeaponFrom(portLotniczy, econLotniczy, 'fighter_squad_multirole');
  t.check('eskadrę da się kupić za kredyty', !!zakupEskadry && zakupEskadry.price > 0);
  t.equal('maszyny ubyły z magazynu portu', econLotniczy.resources.fighter_craft,
    500 - FIGHTER_SQUADRON_DEFS.multirole.squadSize);

  // ----------------------------------------------------------
  t.section('Zapotrzebowanie trafia na listę zakupów portu');

  const stacje = [{ id: 'earth', factionId: FACTION.TERRA_NOVA }, { id: 'pusta', factionId: null }];
  const objete = declareAmmoDemand(stacje);
  t.equal('zapotrzebowanie zgłaszają tylko stacje z frakcją', objete, 1);
  t.check('port chce amunicji', stationWantsResource(stacje[0], 'ammo_kinetic'));
  t.check('i uzupełnienia myśliwców', stationWantsResource(stacje[0], 'fighter_craft'));
  t.check('stacja bez frakcji nie dostała listy', !stacje[1].extraDemand);

  return t.results;
}

runIfMain(import.meta.url, run);
