/**
 * Testy firm transportowych.
 *
 * Najważniejsze jest tu jedno: czy bogata firma i biedna firma podejmują RÓŻNE
 * decyzje przy tych samych danych. Jeśli nie, pusty powrót jest tylko kosztem,
 * a nie mechaniką — i cała różnica między przewoźnikami znika.
 */

import { createSuite, runIfMain } from './harness.mjs';
import {
  SHIP_STATE, COMPANY_POLICY, SHIP_PRICE,
  createCompany, addShip, createFleetRegistry, registerCompany,
  findParkedShip, findDeadheadCandidates, shouldDeadhead, expectedIdleSeconds,
  assignShipToCourse, releaseShipAt, loseShip, maintainFleet,
  billFreight, billCost, billDeadhead, summarizeCompanies, hullForVanClass
} from '../../src/game/traffic/transportCompanies.js';

function makeRegistry() {
  const registry = createFleetRegistry();
  const kolos = createCompany({
    id: 'kolos', name: 'Kolos', policy: COMPANY_POLICY.AGGRESSIVE,
    capital: 250_000, homeStationId: 'earth'
  });
  addShip(kolos, { id: 'k1', vanClassId: 'hauler', stationId: 'earth' });
  addShip(kolos, { id: 'k2', vanClassId: 'bulk', stationId: 'mars' });
  registerCompany(registry, kolos);

  const kowal = createCompany({
    id: 'kowal', name: 'Kowal', policy: COMPANY_POLICY.FRUGAL,
    capital: 9_000, homeStationId: 'mercury'
  });
  addShip(kowal, { id: 'w1', vanClassId: 'van', stationId: 'mercury' });
  registerCompany(registry, kowal);

  return { registry, kolos, kowal };
}

export function run() {
  const t = createSuite('transportCompanies');

  // ----------------------------------------------------------
  t.section('Floty i sylwetki');

  const { registry, kolos, kowal } = makeRegistry();
  t.equal('dwie firmy', registry.companies.length, 2);
  t.equal('jednostki w indeksie', registry.shipsById.size, 3);
  t.equal('mały van to szutla', hullForVanClass('van'), 'inter_station_shuttle');
  t.equal('bulk to frachtowiec dalekiego zasięgu', hullForVanClass('bulk'), 'long_haul_freighter');
  t.equal('domyślnie kontenerowiec', hullForVanClass('hauler'), 'container_ship');
  t.equal('heavy to ciężki frachtowiec', hullForVanClass('heavy'), 'heavy_freighter');
  t.equal('mega to megafrachtowiec z gry', hullForVanClass('mega'), 'megafreighter');

  // ----------------------------------------------------------
  t.section('Dobór jednostki u nadawcy');

  const naZiemi = findParkedShip(registry, 'earth', 100);
  t.equal('znajduje statek stojący na Ziemi', naZiemi?.ship.id, 'k1');
  t.equal('brak jednostki w porcie bez floty', findParkedShip(registry, 'venus', 10), null);
  t.equal('za mała ładownia odpada', findParkedShip(registry, 'mercury', 300), null);
  t.equal('mniejszy ładunek zmieści szutla', findParkedShip(registry, 'mercury', 40)?.ship.id, 'w1');

  // Best-fit: duży frachtowiec ma zostać na duży ładunek.
  addShip(kolos, { id: 'k3', vanClassId: 'van', stationId: 'mars' });
  registry.shipsById.set('k3', kolos.ships.at(-1));
  t.equal('mały ładunek dostaje mniejszą jednostkę', findParkedShip(registry, 'mars', 30)?.ship.id, 'k3');
  t.equal('duży ładunek dostaje frachtowiec', findParkedShip(registry, 'mars', 300)?.ship.id, 'k2');

  // ----------------------------------------------------------
  t.section('Cykl życia jednostki');

  const statek = naZiemi.ship;
  t.check('przypisanie do kursu', assignShipToCourse(statek, 'kurs-1'));
  t.equal('jednostka jest zajęta', statek.state, SHIP_STATE.BUSY);
  t.check('zajętej nie przypiszemy drugi raz', !assignShipToCourse(statek, 'kurs-2'));
  t.equal('zajęta nie wchodzi do puli', findParkedShip(registry, 'earth', 10), null);

  releaseShipAt(statek, 'mars', 1200, { completedTrip: true });
  t.equal('po dolocie stoi w NOWYM porcie', statek.stationId, 'mars');
  t.equal('i jest znów wolna', statek.state, SHIP_STATE.PARKED);
  t.equal('kurs zaliczony', statek.trips, 1);
  t.equal('zapamiętany moment postoju', statek.idleSince, 1200);

  // ----------------------------------------------------------
  t.section('Pusty powrót — TU siedzi różnica między firmami');

  // Te same dane wejściowe dla obu firm. Różni je wyłącznie polityka.
  const sytuacja = { cost: 300, expectedIdleSeconds: 1800 };
  const bogaty = shouldDeadhead(kolos, sytuacja);
  const biedny = shouldDeadhead(kowal, sytuacja);
  t.note(`Kolos: ${bogaty.go ? 'leci pusty' : 'czeka'} (${bogaty.reason})`);
  t.note(`Kowal: ${biedny.go ? 'leci pusty' : 'czeka'} (${biedny.reason})`);
  t.check('bogata firma woli jechać pusto', bogaty.go);
  t.check('biedna woli poczekać na ładunek', !biedny.go);

  // Przestój ponad wytrzymałość firmy przełamuje nawet skąpstwo.
  t.check('bardzo długi przestój wypycha nawet biedną',
    shouldDeadhead(kowal, { cost: 300, expectedIdleSeconds: 99_999 }).go);

  // Bezpiecznik kapitałowy: nie wolno wydać ostatniego grosza na pusty kurs.
  const naKrawedzi = createCompany({ policy: COMPANY_POLICY.AGGRESSIVE, capital: 100 });
  const werdykt = shouldDeadhead(naKrawedzi, { cost: 300, expectedIdleSeconds: 99_999 });
  t.check('bankrut nie leci nigdzie', !werdykt.go);
  t.equal('i wie dlaczego', werdykt.reason, 'za mały kapitał');

  // ----------------------------------------------------------
  t.section('Wycena przestoju');

  const pustyPort = expectedIdleSeconds(registry, 'venus', 10);
  const zatlocony = expectedIdleSeconds(registry, 'mars', 10);
  t.check('port pełen stojących statków = dłuższe czekanie', zatlocony > pustyPort);
  t.check('port, z którego nic nie wyjeżdża, to pułapka',
    expectedIdleSeconds(registry, 'mars', 0.1) > expectedIdleSeconds(registry, 'mars', 50));

  // ----------------------------------------------------------
  t.section('Kandydaci na pusty przelot');

  const siec = {
    nodes: new Map([
      ['earth', { x: 0, y: 0 }],
      ['mars', { x: 100_000, y: 0 }],
      ['mercury', { x: 900_000, y: 0 }]
    ])
  };
  const kandydaci = findDeadheadCandidates(registry, siec, 'earth', 30);
  t.check('są kandydaci spoza portu docelowego', kandydaci.length > 0);
  t.check('żaden nie stoi już na miejscu', kandydaci.every(entry => entry.ship.stationId !== 'earth'));
  t.check('posortowani od najbliższego',
    kandydaci[0].distance <= kandydaci[kandydaci.length - 1].distance);
  t.equal('najbliższy jest z Marsa', kandydaci[0].ship.stationId, 'mars');

  // ----------------------------------------------------------
  t.section('Księgowość i odtwarzanie floty');

  const kasaPrzed = kolos.capital;
  billFreight(kolos, 5_000);
  t.equal('fracht powiększa kapitał', kolos.capital, kasaPrzed + 5_000);
  t.equal('i licznik kursów', kolos.ledger.jobs, 1);
  billCost(kolos, 800);
  billDeadhead(kolos, 200);
  t.equal('koszty schodzą z kapitału', kolos.capital, kasaPrzed + 5_000 - 1_000);
  t.equal('pusty przelot jest liczony osobno', kolos.ledger.deadheads, 1);

  // Bez odkupu piractwo jest jednokierunkowe: każdy przechwyt trwale zmniejsza
  // liczbę statków w układzie i po godzinie nie ma czym wozić.
  const przed = kolos.ships.length;
  loseShip(registry, kolos, kolos.ships[0], 4_000);
  t.equal('utrata zmniejsza flotę', kolos.ships.length, przed - 1);
  t.equal('i znika z indeksu', registry.shipsById.size, 3);
  t.equal('strata zapisana', kolos.ledger.losses, 4_000);

  const kupiony = maintainFleet(kolos, { targetShips: 10, stationId: 'earth' });
  t.check('bogata firma odkupuje jednostkę', !!kupiony);
  t.equal('nowa jednostka stoi w porcie macierzystym', kupiony.stationId, 'earth');
  t.check('zakup zdjął pieniądze', kolos.capital < kasaPrzed + 5_000 - 1_000);

  const biedna = createCompany({ policy: COMPANY_POLICY.FRUGAL, capital: SHIP_PRICE.van });
  t.equal('firma bez zapasu na paliwo nie kupuje',
    maintainFleet(biedna, { targetShips: 5, stationId: 'mercury' }), null);
  t.equal('pełna flota nie dokupuje', maintainFleet(kolos, { targetShips: 1 }), null);

  // ----------------------------------------------------------
  t.section('Podsumowanie');

  const raport = summarizeCompanies(registry);
  t.equal('obie firmy w raporcie', raport.length, 2);
  t.check('sortowanie po kapitale', raport[0].capital >= raport[1].capital);
  t.check('raport rozdziela stojące od jadących',
    raport[0].parked + raport[0].busy === raport[0].ships);

  return t.results;
}

runIfMain(import.meta.url, run);
