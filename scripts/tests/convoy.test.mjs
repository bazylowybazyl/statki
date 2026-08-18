/**
 * Testy konwojów i eskort.
 *
 * Najważniejsze są dwie własności, bez których konwój jest tylko ozdobą:
 * przechwyt NIGDY nie zabiera całego składu, a decyzja o konwojowaniu wynika
 * z rachunku, nie z reguły — więc tania masówka na krótkiej trasie ma zostać
 * samotna, a cenny fracht na długiej ma sam kupić sobie osłonę.
 */

import { createSuite, runIfMain } from './harness.mjs';
import {
  ESCORT_MODEL, createConvoyRegistry, formConvoy, convoyOf, detachCourse,
  disbandConvoy, convoyInterceptChance, resolveConvoyInterception,
  escortCost, shouldConvoy, summarizeConvoys
} from '../../src/game/traffic/convoy.js';

function makeCourses(n, from = 'mercury', to = 'earth') {
  return Array.from({ length: n }, (_, i) => ({
    id: `kurs-${i}`, originId: from, destinationId: to
  }));
}

/** Deterministyczny generator, żeby rozstrzygnięcia dało się porównywać. */
function rng(seed = 1) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

export function run() {
  const t = createSuite('convoy');

  // ----------------------------------------------------------
  t.section('Wiązanie kursów');

  const registry = createConvoyRegistry();
  const kursy = makeCourses(5);
  const konwoj = formConvoy(registry, kursy, { escortPower: 2, now: 100 });

  t.check('konwój powstaje', !!konwoj);
  t.equal('ma wszystkie kursy', konwoj.courseIds.length, 5);
  t.equal('zna trasę', `${konwoj.fromId}>${konwoj.toId}`, 'mercury>earth');
  t.equal('kurs wie, w jakiej jest grupie', kursy[0].convoyId, konwoj.id);
  t.equal('odwzorowanie w obie strony', convoyOf(registry, 'kurs-3')?.id, konwoj.id);

  // Dwa statki lecące przypadkiem tą samą trasą to jeszcze nie konwój.
  t.equal('grupa poniżej progu nie powstaje',
    formConvoy(createConvoyRegistry(), makeCourses(1), {}), null);
  // Kurs już w konwoju nie może trafić do drugiego.
  t.equal('nie da się być w dwóch grupach naraz',
    formConvoy(registry, kursy, { escortPower: 1 }), null);

  // ----------------------------------------------------------
  t.section('Ryzyko grupy');

  const solo = 0.2;
  const bezOslony = { courseIds: new Array(5).fill('x'), escortPower: 0 };
  const zOslona = { courseIds: new Array(5).fill('x'), escortPower: 3 };

  const ryzykoGrupy = convoyInterceptChance(bezOslony, solo);
  const ryzykoZOslona = convoyInterceptChance(zOslona, solo);
  t.note(`solo ${(solo * 100).toFixed(0)}% · grupa bez osłony ${(ryzykoGrupy * 100).toFixed(0)}%`
    + ` · grupa z osłoną ${(ryzykoZOslona * 100).toFixed(0)}%`);

  t.check('grupa jest lepiej widoczna niż pojedynczy statek', ryzykoGrupy > solo);
  // ...ale nie pięć razy bardziej — to jeden rzut zamiast pięciu.
  t.check('widoczność rośnie wolniej niż liczebność', ryzykoGrupy < solo * 5);
  t.check('osłona zbija ryzyko', ryzykoZOslona < ryzykoGrupy);
  t.check('silniejsza osłona zbija mocniej',
    convoyInterceptChance({ courseIds: ['a'], escortPower: 6 }, solo)
    < convoyInterceptChance({ courseIds: ['a'], escortPower: 2 }, solo));
  t.check('ryzyko nigdy nie przekracza 1', convoyInterceptChance(bezOslony, 1) <= 1);

  // ----------------------------------------------------------
  t.section('Przechwyt NIE zabiera całości');

  const bitwa = createConvoyRegistry();
  const duzy = formConvoy(bitwa, makeCourses(8), { escortPower: 0 });
  const wynik = resolveConvoyInterception(bitwa, duzy, { rng: rng(7) });
  t.note(`bez osłony: przepadło ${wynik.lost.length} z 8, `
    + `udział strat ${(wynik.lossFraction * 100).toFixed(0)}%`);

  t.check('coś przepada', wynik.lost.length > 0);
  t.check('ale nie wszystko — reszta ucieka', wynik.survived.length > 0);
  t.equal('nikt nie ginie dwa razy', wynik.lost.length + wynik.survived.length, 8);
  t.check('bez osłony straty są dotkliwe', wynik.lost.length >= 4);

  const strzezony = createConvoyRegistry();
  const chroniony = formConvoy(strzezony, makeCourses(8), { escortPower: 3 });
  const wynik2 = resolveConvoyInterception(strzezony, chroniony, { rng: rng(7) });
  t.note(`z osłoną ×3: przepadło ${wynik2.lost.length} z 8`);
  t.check('osłona ratuje skład', wynik2.lost.length < wynik.lost.length);
  t.check('ale coś zawsze przepada', wynik2.lost.length >= 1);

  const licznik = summarizeConvoys(strzezony);
  t.equal('statystyka liczy przechwyty', licznik.stats.intercepted, 1);
  t.equal('i uratowane jednostki', licznik.stats.shipsSaved, wynik2.survived.length);

  // ----------------------------------------------------------
  t.section('Decyzja jest rachunkiem, nie regułą');

  // Ta sama trasa, ta sama grupa — różni się WYŁĄCZNIE wartość ładunku.
  const trasa = { size: 6, soloChance: 0.25, seconds: 1800, escortPower: 3 };
  const tanie = shouldConvoy({ ...trasa, cargoValue: 900 });
  const cenne = shouldConvoy({ ...trasa, cargoValue: 40_000 });
  t.note(`masówka: ${tanie.go ? 'konwój' : 'solo'} (${tanie.reason})`);
  t.note(`drobnica: ${cenne.go ? 'konwój' : 'solo'} (${cenne.reason})`);
  t.check('taniego ładunku nie warto strzec', !tanie.go);
  t.check('cenny sam kupuje sobie osłonę', cenne.go);

  // Bezpieczna trasa nie potrzebuje eskorty niezależnie od ładunku.
  t.check('na spokojnym szlaku osłona się nie zwraca',
    !shouldConvoy({ ...trasa, soloChance: 0.001, cargoValue: 40_000 }).go);
  // Pod ostrzałem opłaca się nawet przy skromniejszym ładunku.
  t.check('pod presją piratów opłaca się szybciej',
    shouldConvoy({ ...trasa, soloChance: 0.6, cargoValue: 9_000 }).go);
  t.check('pojedynczy statek to nie konwój',
    !shouldConvoy({ ...trasa, size: 1, cargoValue: 40_000 }).go);

  t.check('koszt osłony rośnie z czasem lotu', escortCost(3, 3600) > escortCost(3, 600));
  t.equal('brak osłony nic nie kosztuje', escortCost(0, 3600), 0);

  // ----------------------------------------------------------
  t.section('Rozwiązywanie grupy');

  t.check('kurs wypisuje się po dolocie', detachCourse(registry, 'kurs-0'));
  t.equal('grupa się kurczy', konwoj.courseIds.length, 4);
  t.equal('wypisany nie ma już grupy', convoyOf(registry, 'kurs-0'), null);
  t.check('lider przechodzi na kolejnego', konwoj.leaderId === 'kurs-1');

  for (const id of ['kurs-1', 'kurs-2', 'kurs-3']) detachCourse(registry, id);
  t.equal('ostatni wypisany rozwiązuje grupę', detachCourse(registry, 'kurs-4'), true);
  t.equal('grupa znika z rejestru', registry.convoys.size, 0);

  const doRozwiazania = createConvoyRegistry();
  const grupa = formConvoy(doRozwiazania, makeCourses(3), {});
  t.check('rozwiązanie działa wprost', disbandConvoy(doRozwiazania, grupa));
  t.equal('nikt nie zostaje przypisany', doRozwiazania.byCourse.size, 0);
  t.check('drugie rozwiązanie nic nie robi', !disbandConvoy(doRozwiazania, grupa));

  t.equal('próg wielkości grupy', ESCORT_MODEL.minSize, 2);

  return t.results;
}

runIfMain(import.meta.url, run);
