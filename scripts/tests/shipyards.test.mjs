/**
 * Testy stoczni i zapasu okrętów.
 *
 * Sens tego modułu jest ekonomiczny, nie militarny: komponenty T2 nie miały
 * w gospodarce ŻADNEGO odbiorcy (nadmiar 52 silników i 44 rdzeni reaktorów
 * na godzinę). Stocznia jest pierwszą rzeczą, która je zużywa — a że ma ją
 * każda frakcja, a podzespoły produkują tylko dwie, zbrojenie tworzy popyt
 * płynący przez cały układ.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCE_KEYS, RESOURCES, RECIPES } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import {
  WARSHIP_CLASSES, WARSHIP_ORDER, SHIPYARD_MODEL, FLEET_DOCTRINE, pickWarshipClass,
  createShipyardRegistry, registerShipyard, tickShipyards,
  readyShips, fleetPower, addShips, takeShips, returnShips,
  canAfford, summarizeShipyards, reservedForMarket, WARSHIP_COMPONENTS, WARSHIP_BUILD_PORTION
} from '../../src/game/traffic/shipyards.js';
import { snapshotMarket, restockTarget } from '../../src/game/traffic/tradeMarket.js';

/** Magazyn z zadanym zapasem podzespołów. */
function makeEcon(fill = 0) {
  const econ = { resources: {}, capacity: {} };
  for (const key of RESOURCE_KEYS) {
    econ.capacity[key] = 200;
    econ.resources[key] = fill;
  }
  return econ;
}

export function run() {
  const t = createSuite('shipyards');

  // ----------------------------------------------------------
  t.section('Klasy okrętów');

  t.check('najsilniejszy jest pierwszy w kolejności', WARSHIP_ORDER[0].power >= WARSHIP_ORDER[1].power);
  t.check('fregata jest najtańsza',
    Object.keys(WARSHIP_CLASSES.frigate.build).length < Object.keys(WARSHIP_CLASSES.carrier.build).length);
  // Siła ma rosnąć WOLNIEJ niż koszt, żeby masa tanich jednostek miała sens.
  const kosztFregaty = Object.values(WARSHIP_CLASSES.frigate.build).reduce((a, b) => a + b, 0);
  const kosztNosiciela = Object.values(WARSHIP_CLASSES.carrier.build).reduce((a, b) => a + b, 0);
  t.check('nosiciel jest wielokrotnie droższy', kosztNosiciela > kosztFregaty * 5);
  t.check('ale nie wielokrotnie silniejszy',
    WARSHIP_CLASSES.carrier.power < WARSHIP_CLASSES.frigate.power * 12);
  for (const cls of WARSHIP_ORDER) {
    t.check(`${cls.id} zużywa podzespoły T2`, Object.keys(cls.build).length > 0);
    t.check(`${cls.id} ma kadłub z gry`, typeof cls.hull === 'string' && cls.hull.length > 0);
  }

  // ----------------------------------------------------------
  t.section('Stocznia zjada komponenty');

  const registry = createShipyardRegistry();
  const econ = makeEcon(150);
  registerShipyard(registry, { stationId: 'mars', factionId: FACTION.MARS, weight: 1, slots: 1 });

  const przedPlyt = econ.resources.hull_plate;
  const laid = tickShipyards(registry, 1, { getEconomy: () => econ });
  t.check('stocznia założyła stępkę', laid.some(e => e.type === 'laid'));
  t.check('podzespoły ubyły z magazynu', econ.resources.hull_plate < przedPlyt);
  // Bogata stocznia NIE bierze największego okrętu, choć ją na niego stać.
  // Zaczyna od klasy o największym udziale w doktrynie, bo pusta flota jest
  // poniżej udziału we wszystkim naraz.
  t.equal('pierwszy kadłub zgodny z doktryną', registry.yards[0].building[0].classId, 'frigate');
  t.check('koszt zapisany', registry.stats.spent > 0);

  // ----------------------------------------------------------
  t.section('Doktryna floty');

  t.check('udziały doktryny sumują się do jedności',
    Math.abs(Object.values(FLEET_DOCTRINE).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  t.check('doktryna zna wyłącznie istniejące klasy',
    Object.keys(FLEET_DOCTRINE).every(id => WARSHIP_CLASSES[id]));
  t.check('mały kadłub ma największy udział',
    FLEET_DOCTRINE.frigate > FLEET_DOCTRINE.destroyer
    && FLEET_DOCTRINE.destroyer > FLEET_DOCTRINE.cruiser
    && FLEET_DOCTRINE.cruiser > FLEET_DOCTRINE.carrier);

  // Flota przepełniona fregatami sięga po następną klasę — to jest różnica
  // między doktryną a stałą regułą „buduj najmniejszy".
  const bogaty = makeEcon(4000);
  const zFregatami = createShipyardRegistry();
  registerShipyard(zFregatami, { stationId: 'mars', factionId: FACTION.MARS, slots: 1 });
  addShips(zFregatami, FACTION.MARS, 'frigate', 100);
  t.equal('nadmiar fregat przestawia stocznię na inną klasę',
    pickWarshipClass(zFregatami, FACTION.MARS, bogaty).id !== 'frigate', true);

  // Okręty JUŻ BUDOWANE też się liczą, inaczej kilka stoczni kładzie naraz
  // ten sam brakujący kadłub.
  const dwieStocznie = createShipyardRegistry();
  registerShipyard(dwieStocznie, { stationId: 'a', factionId: FACTION.MARS, slots: 1 });
  registerShipyard(dwieStocznie, { stationId: 'b', factionId: FACTION.MARS, slots: 1 });
  dwieStocznie.yards[0].building.push({ classId: 'frigate', remaining: 10 });
  const przedDrugim = pickWarshipClass(dwieStocznie, FACTION.MARS, bogaty);
  dwieStocznie.yards[0].building.push({ classId: 'frigate', remaining: 10 });
  dwieStocznie.yards[0].building.push({ classId: 'frigate', remaining: 10 });
  t.check('pochylnie innych stoczni wchodzą do rachunku',
    pickWarshipClass(dwieStocznie, FACTION.MARS, bogaty).power >= przedDrugim.power);

  // Biedna stocznia nie ma z czego położyć większego kadłuba, więc jej flota
  // sama spłaszcza się do fregat — bez osobnej reguły dla biednych.
  const biednaEcon = makeEcon(60);
  const biedna = createShipyardRegistry();
  registerShipyard(biedna, { stationId: 'venus', factionId: FACTION.INNER_CONSORTIUM, slots: 1 });
  addShips(biedna, FACTION.INNER_CONSORTIUM, 'frigate', 50);
  t.check('uboga stacja i tak bierze mały kadłub',
    ['frigate', 'destroyer'].includes(pickWarshipClass(biedna, FACTION.INNER_CONSORTIUM, biednaEcon)?.id
      || 'frigate'));

  // ----------------------------------------------------------
  t.section('Koszt rośnie szybciej niż siła');

  // To jest liczba, przez którą „buduj największy" była poprawną strategią:
  // przy poprzednim cenniku nosiciel kosztował 6,5 fregaty, a dawał 9 siły.
  const naSile = WARSHIP_ORDER.slice().reverse().map(cls => ({
    id: cls.id,
    krPerSila: Object.entries(cls.build)
      .reduce((sum, [res, qty]) => sum + (RESOURCES[res]?.value || 0) * qty, 0) / cls.power,
    sPerSila: cls.seconds / cls.power
  }));
  for (let i = 1; i < naSile.length; i++) {
    t.check(`${naSile[i].id} kosztuje więcej na punkt siły niż ${naSile[i - 1].id}`,
      naSile[i].krPerSila > naSile[i - 1].krPerSila,
      `(${naSile[i - 1].krPerSila.toFixed(0)} → ${naSile[i].krPerSila.toFixed(0)} CR)`);
    t.check(`${naSile[i].id} zajmuje pochylnię dłużej na punkt siły`,
      naSile[i].sPerSila > naSile[i - 1].sPerSila);
  }

  // ----------------------------------------------------------
  t.section('Silniki hipercruise — towary z kontraktu E5 ↔ E8');

  // Id i vmax to kontrakt z tabelą napędów (PLAN-ekonomia-rynki § 3.4): E5 stroi
  // vmax w 20–40 tys. j./s, ale id się nie zmieniają. Cena ma rosnąć szybciej niż
  // prędkość, inaczej Mk3 byłby oczywistym wyborem dla każdego kadłuba.
  const KONTRAKT = { hypercruise_mk1: 20000, hypercruise_mk2: 30000, hypercruise_mk3: 40000 };
  let poprzedni = 0;
  for (const [id, vmax] of Object.entries(KONTRAKT)) {
    t.check(`${id} jest towarem z recepturą`,
      !!RESOURCES[id] && Object.values(RECIPES).some(r => r.out[id] > 0));
    t.check(`${id} buduje jakaś klasa okrętu`,
      Object.values(WARSHIP_CLASSES).some(cls => cls.build[id] > 0));
    const zaTysiac = (RESOURCES[id]?.value || 0) / (vmax / 1000);
    t.check(`${id} kosztuje więcej za tysiąc j./s niż słabszy`, zaTysiac > poprzedni,
      `(${poprzedni.toFixed(1)} → ${zaTysiac.toFixed(1)} CR)`);
    poprzedni = zaTysiac;
  }
  // Napęd warp Mk I–III (2026-10-22): vmax w 100–250 tys. j./s stroi E5. Cena na
  // tysiąc j./s ma rosnąć dla Mk II w 150–200 tys. — szerszego okna nie spełni
  // żaden cennik, w którym Mk III nie jest absurdalnie drogi.
  const WARP = { warp_mk1: [100000, 100000], warp_mk2: [150000, 200000], warp_mk3: [250000, 250000] };
  let warpPoprzedniMax = 0;
  for (const [id, [vMin, vMax]] of Object.entries(WARP)) {
    t.check(`${id} jest towarem z recepturą`,
      !!RESOURCES[id] && Object.values(RECIPES).some(r => r.out[id] > 0));
    t.check(`${id} buduje jakaś klasa okrętu`,
      Object.values(WARSHIP_CLASSES).some(cls => cls.build[id] > 0));
    const zaTysiacMin = (RESOURCES[id]?.value || 0) / (vMax / 1000);
    t.check(`${id} kosztuje więcej za tysiąc j./s niż słabszy`, zaTysiacMin > warpPoprzedniMax,
      `(${warpPoprzedniMax.toFixed(1)} → ${zaTysiacMin.toFixed(1)} CR)`);
    warpPoprzedniMax = (RESOURCES[id]?.value || 0) / (vMin / 1000);
  }

  t.check('każdy okręt ma napęd przelotowy i moduł hipercruise',
    Object.values(WARSHIP_CLASSES).every(cls =>
      (cls.build.drive_light || cls.build.drive_heavy)
      && Object.keys(KONTRAKT).some(id => cls.build[id] > 0)));

  // ----------------------------------------------------------
  t.section('Zapas roboczy portu jest nietykalny');

  // Bez tego stocznia ogałaca magazyn i reszta przemysłu staje.
  const naStyk = makeEcon(200 * SHIPYARD_MODEL.reserveFill + 2);
  t.check('nie tknie zapasu poniżej progu', !canAfford(naStyk, WARSHIP_CLASSES.carrier));
  const pusty = createShipyardRegistry();
  registerShipyard(pusty, { stationId: 'x', factionId: 'y', slots: 1 });
  tickShipyards(pusty, 1, { getEconomy: () => makeEcon(0) });
  t.equal('bez podzespołów nic nie powstaje', pusty.yards[0].building.length, 0);
  t.check('i jest to odnotowane', pusty.stats.blocked > 0);

  // ----------------------------------------------------------
  t.section('Licytacja: stocznia producenta ustępuje głodniejszej');

  // Producent ma podzespoły na 40% magazynu, druga stocznia stoi na zerze od
  // godziny (przyduszenie). Własna stocznia nie ma bezwzględnego pierwszeństwa:
  // odkłada dla rynku tyle, ile brakuje tamtej, a z reszty buduje.
  const prodSt = { id: 'prod', factionId: FACTION.MARS, extraDemand: [...WARSHIP_COMPONENTS] };
  const glodSt = { id: 'glod', factionId: FACTION.MARS, extraDemand: [...WARSHIP_COMPONENTS] };
  const prodEcon = makeEcon(80);
  const glodEcon = makeEcon(0);
  glodEcon.duress = Object.fromEntries(WARSHIP_COMPONENTS.map(id => [id, 3600]));
  const notowania = snapshotMarket([prodSt, glodSt], id => (id === 'prod' ? prodEcon : glodEcon),
    { demandRate: id => (id === 'glod' ? 0.005 : 0) });
  const rezerwa = reservedForMarket(notowania, 'prod', prodEcon);
  t.check('producent odkłada podzespoły dla głodnej stoczni', rezerwa.get('hull_plate') > 0);
  t.check('nie więcej, niż tamta potrzebuje', rezerwa.get('hull_plate') <= 200);
  t.check('rezerwa blokuje budowę z odłożonego zapasu',
    canAfford(prodEcon, WARSHIP_CLASSES.frigate)
    && !canAfford(prodEcon, WARSHIP_CLASSES.frigate, {
      reserved: new Map([...rezerwa].map(([id]) => [id, 80]))
    }));
  // Gdy głodna stocznia ma już to, czego chce, licytacja się kończy.
  for (const id of WARSHIP_COMPONENTS) glodEcon.resources[id] = 60;
  glodEcon.duress = {};
  const syte = snapshotMarket([prodSt, glodSt], id => (id === 'prod' ? prodEcon : glodEcon),
    { demandRate: id => (id === 'glod' ? 0.005 : 0) });
  t.equal('syta stocznia niczego nie rezerwuje', reservedForMarket(syte, 'prod', prodEcon).size, 0);

  // Stocznia bez własnych podzespołów nie startuje z zerem: zapas na kilka
  // godzin planowego zużycia, nie 45% magazynu.
  const startSt = { id: 'mercury', factionId: FACTION.INNER_CONSORTIUM };
  const startEcon = makeEcon(0);
  registerShipyard(createShipyardRegistry(),
    { station: startSt, econ: startEcon, stationId: 'mercury', economyScale: 1 });
  t.check('zapas startowy podzespołów', startEcon.resources.hull_plate > 0);
  t.check('nie ponad magazyn', startEcon.resources.hull_plate <= startEcon.capacity.hull_plate);
  // Stocznia zużywa podzespół porcjami, więc skupuje nie mniej niż kilka porcji —
  // nawet gdy planowe zużycie rzadkiego napędu daje na dwie godziny mniej niż jedną.
  t.equal('dolny próg skupu = porcje na kilka budów', startSt.restockFloor.drive_heavy,
    WARSHIP_BUILD_PORTION.drive_heavy * SHIPYARD_MODEL.restockBuilds);
  t.check('porcja to największe zużycie jednej klasy', WARSHIP_BUILD_PORTION.hull_plate === 60);
  t.equal('skup bez planowego zużycia sięga dolnego progu',
    restockTarget({ capacity: 100, demandRate: 0, restockFloor: 12 }), 12);
  t.check('i nie przekracza magazynu',
    restockTarget({ capacity: 10, demandRate: 0, restockFloor: 12 }) === 10);

  // ----------------------------------------------------------
  t.section('Okręt trafia do zapasu frakcji');

  const gotowe = createShipyardRegistry();
  const magazyn = makeEcon(200);
  registerShipyard(gotowe, { stationId: 'mars', factionId: FACTION.MARS, weight: 1, slots: 1 });
  tickShipyards(gotowe, 1, { getEconomy: () => magazyn });
  const budowany = gotowe.yards[0].building[0];
  t.equal('nic jeszcze nie gotowe', readyShips(gotowe, FACTION.MARS), 0);

  const zdarzenia = tickShipyards(gotowe, budowany.remaining + 1, { getEconomy: () => magazyn });
  t.check('okręt zwodowany', zdarzenia.some(e => e.type === 'built'));
  t.equal('zapas frakcji urósł', readyShips(gotowe, FACTION.MARS), 1);
  t.check('siła bojowa policzona', fleetPower(gotowe, FACTION.MARS) > 0);
  t.equal('inna frakcja nic nie dostała', readyShips(gotowe, FACTION.TERRA_NOVA), 0);

  // ----------------------------------------------------------
  t.section('Wydawanie floty na wyprawę');

  const arsenal = createShipyardRegistry();
  addShips(arsenal, FACTION.MARS, 'frigate', 10);
  addShips(arsenal, FACTION.MARS, 'cruiser', 2);
  const pelnaSila = fleetPower(arsenal, FACTION.MARS);
  t.close('siła to suma po klasach', pelnaSila,
    10 * WARSHIP_CLASSES.frigate.power + 2 * WARSHIP_CLASSES.cruiser.power);

  const wyprawa = takeShips(arsenal, FACTION.MARS, 11);
  t.check('coś wyruszyło', wyprawa.power > 0);
  t.check('bierze od najsilniejszych', (wyprawa.ships.cruiser || 0) > 0);
  t.check('zapas zmalał', fleetPower(arsenal, FACTION.MARS) < pelnaSila);
  t.close('rozchód zgadza się z pobraniem',
    fleetPower(arsenal, FACTION.MARS) + wyprawa.power, pelnaSila, 1e-9);

  // Frakcja bez floty nie wyśle nic — to jest cały sens „ile gotowych".
  const bezFloty = takeShips(arsenal, FACTION.TERRA_NOVA, 50);
  t.equal('brak floty = brak wyprawy', bezFloty.power, 0);
  t.equal('i pusty skład', Object.keys(bezFloty.ships).length, 0);

  // Żądanie większe niż zapas zabiera tyle, ile jest.
  const wszystko = takeShips(arsenal, FACTION.MARS, 9999);
  t.check('zabrało resztę', wszystko.power > 0);
  t.equal('zapas na zero', fleetPower(arsenal, FACTION.MARS), 0);

  returnShips(arsenal, FACTION.MARS, wszystko.ships);
  t.check('ocalali wracają do zapasu', fleetPower(arsenal, FACTION.MARS) > 0);

  // ----------------------------------------------------------
  t.section('Podsumowanie');

  const raport = summarizeShipyards(arsenal);
  t.check('raport zna frakcje', raport.factions.length >= 1);
  t.check('sortuje po sile', raport.factions[0].power >= (raport.factions[1]?.power ?? 0));
  t.equal('liczy stocznie', summarizeShipyards(gotowe).yards, 1);

  return t.results;
}

runIfMain(import.meta.url, run);
