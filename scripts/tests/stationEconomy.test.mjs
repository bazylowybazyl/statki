/**
 * Ekonomia stacji: wydobycie, receptury, konsumpcja bytowa i to, czy z tego
 * wszystkiego POWSTAJE PRESJA HANDLOWA.
 *
 * Najważniejsze, czego pilnuje: żadna stacja nie może być samowystarczalna.
 * Jeśli każda bilansuje się sama, vany nie mają po co latać i cała ekonomia
 * jest martwa — a to widać dopiero po przesymulowaniu wielu cykli, nie
 * z samego czytania tabel.
 */

import {
  runStationEconomy,
  getStationDeficits,
  getStationSurpluses,
  stationWantsResource,
  getStationOutputs,
  describeStationRole,
  seedStationStock,
  stationNetRates,
  STATION_INDUSTRY,
  STATION_UPKEEP,
  ECONOMY_CYCLE_SECONDS, lineWeight, upkeepScale,
  INDUSTRY_ARCHETYPES, composeIndustry, buildIndustryMap, SYSTEM_INDUSTRY_SPEC } from '../../src/game/stationEconomy.js';
import { RESOURCES, RESOURCE_KEYS, TIER, RECIPES, PLANET_YIELD } from '../../src/data/resources.js';
import { getDefaultStationFaction } from '../../src/data/factions.js';
import { createSuite, runIfMain } from './harness.mjs';

// Odzwierciedla ECONOMY_BASE_CAPACITY_BY_TIER z infrastructureUI.js.
const CAPACITY_BY_TIER = { [TIER.RAW]: 250, [TIER.REFINED]: 150, [TIER.COMPONENT]: 60 };

/**
 * Surowce, których ŻADNA stacja nie wytwarza — przychodzą ze świata:
 *   uranium_ore — wyłącznie z pasa Kuipera (flota wydobywcza)
 *   scrap       — wyłącznie z wraków przywiezionych przez gracza
 * Ich niedobór jest treścią gry, nie usterką bilansu.
 */
const WORLD_SOURCED = new Set(['uranium_ore', 'scrap']);

function makeEcon() {
  const resources = {};
  const capacity = {};
  for (const id of RESOURCE_KEYS) {
    resources[id] = 0;
    capacity[id] = CAPACITY_BY_TIER[RESOURCES[id].tier] ?? 100;
  }
  return { resources, capacity };
}

function makeStation(id) {
  return { id, planet: { id }, factionId: getDefaultStationFaction(id) };
}

/** Deterministyczny generator — symulacja musi być powtarzalna. */
function seededRng(seed = 12345) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function run() {
  const t = createSuite('stationEconomy');

  t.section('1. Wydobycie zasila magazyn');
  const mercury = makeStation('mercury');
  const mercuryEcon = makeEcon();
  runStationEconomy(mercury, mercuryEcon, 10, seededRng(1));
  const mercuryOres = ['iron_ore', 'titanium_ore', 'silicon_ore'].reduce((a, id) => a + mercuryEcon.resources[id], 0);
  t.check('Merkury wydobywa rudy', mercuryOres > 0, `(${mercuryOres.toFixed(1)})`);
  t.check('Merkury wytapia stal z własnej rudy', mercuryEcon.resources.steel > 0, `(${mercuryEcon.resources.steel.toFixed(1)})`);

  t.section('2. Ziemia nie wydobywa, tylko przerabia');
  const earth = makeStation('earth');
  const earthEcon = makeEcon();
  // Dostawa rudy z zewnątrz — bez niej zakłady Ziemi stoją.
  earthEcon.resources.iron_ore = 200;
  earthEcon.resources.copper_ore = 150;
  earthEcon.resources.silicon_ore = 200;
  earthEcon.resources.titanium_ore = 150;
  earthEcon.resources.raw_crystal = 120;
  runStationEconomy(earth, earthEcon, 20, seededRng(2));
  t.check('Ziemia zużyła dostarczoną rudę', earthEcon.resources.iron_ore < 200, `(${earthEcon.resources.iron_ore.toFixed(1)})`);
  t.check('Ziemia wyprodukowała płyty kadłuba', earthEcon.resources.hull_plate > 0, `(${earthEcon.resources.hull_plate.toFixed(1)})`);
  t.check('Ziemia wyprodukowała awionikę', earthEcon.resources.avionics > 0, `(${earthEcon.resources.avionics.toFixed(1)})`);

  t.section('2a. Planowane saldo jest niezależne od bieżącego niedoboru');
  const earthNet = stationNetRates(earth);
  const mercuryNet = stationNetRates(mercury);
  // Migawka kalibracji. Te liczby zmieniają się przy KAŻDEJ zmianie przemysłu
  // — ostatnio 2026-08-20, gdy Ziemia i Mars dostały zbrojownie, a Wenus
  // i Saturn amunicjownie. Rosnący apetyt Ziemi na rudę jest tu skutkiem
  // zamierzonym: uzbrojenie to nowy, stały odbiorca metalu.
  t.close('plan Ziemi wymaga 1374,920 rudy żelaza/h', earthNet.iron_ore * 3600, -1374.9201143235828, 1e-6);
  t.close('plan Ziemi wymaga 751,742 rudy krzemu/h', earthNet.silicon_ore * 3600, -751.7420265995411, 1e-6);
  t.close('plan Merkurego eksportuje 1335,342 rudy żelaza/h', mercuryNet.iron_ore * 3600, 1335.3424474153, 1e-6);
  t.close('plan Merkurego eksportuje 476,280 rudy krzemu/h', mercuryNet.silicon_ore * 3600, 476.28, 1e-6);

  const habitatNet = stationNetRates({ id: 'test-habitat', factionId: earth.factionId });
  t.close('plan bez przemysłu nadal obejmuje byt', habitatNet.oxygen, -STATION_UPKEEP.oxygen / ECONOMY_CYCLE_SECONDS);
  t.close('plan bez przemysłu obejmuje też SYSTEM_DEMAND floty', habitatNet.hull_plate, -0.070 / ECONOMY_CYCLE_SECONDS);

  t.section('3. Bez dostaw Ziemia staje');
  const starved = makeStation('earth');
  const starvedEcon = makeEcon();
  runStationEconomy(starved, starvedEcon, 30, seededRng(3));
  const starvedTotal = RESOURCE_KEYS.reduce((a, id) => a + starvedEcon.resources[id], 0);
  t.check('bez rudy Ziemia nic nie wyprodukuje', starvedTotal === 0, `(${starvedTotal.toFixed(1)})`);

  t.section('4. Nienaruszalne niezmienniki');
  const sim = new Map();
  const ids = Object.keys(STATION_INDUSTRY);
  for (const id of ids) sim.set(id, { station: makeStation(id), econ: makeEcon() });
  const rng = seededRng(99);
  // 400 cykli ≈ 2.2 godziny gry — dość, żeby ujawniły się dryfy.
  for (let cycle = 0; cycle < 400; cycle++) {
    for (const { station, econ } of sim.values()) runStationEconomy(station, econ, 1, rng);
  }

  let negatives = [];
  let overflows = [];
  for (const [id, { econ }] of sim) {
    for (const key of RESOURCE_KEYS) {
      const amount = econ.resources[key];
      if (amount < -1e-6) negatives.push(`${id}.${key}=${amount.toFixed(2)}`);
      if (amount > econ.capacity[key] + 1e-6) overflows.push(`${id}.${key}=${amount.toFixed(2)}/${econ.capacity[key]}`);
    }
  }
  t.check('żaden zapas nie schodzi poniżej zera', negatives.length === 0, `(${negatives.slice(0, 3).join(', ')})`);
  t.check('żaden zapas nie przekracza pojemności', overflows.length === 0, `(${overflows.slice(0, 3).join(', ')})`);

  t.section('5. Presja handlowa — nikt nie może być samowystarczalny');
  const selfSufficient = [];
  for (const [id, { station, econ }] of sim) {
    if (!STATION_INDUSTRY[id].capacity) continue; // Neptun jest opuszczony
    const deficits = getStationDeficits(station, econ);
    if (deficits.length === 0) selfSufficient.push(id);
    t.note(`${id.padEnd(8)} braki: ${deficits.slice(0, 3).map(d => `${d.id}(${(d.fill * 100).toFixed(0)}%)`).join(' ') || '—'}`);
  }
  t.check('każda czynna stacja czegoś potrzebuje', selfSufficient.length === 0, `(samowystarczalne: ${selfSufficient.join(', ')})`);

  t.section('6. Nadwyżki — jest co wozić');
  let stationsWithSurplus = 0;
  for (const [id, { station, econ }] of sim) {
    const surpluses = getStationSurpluses(station, econ);
    if (surpluses.length) stationsWithSurplus++;
    if (surpluses.length) t.note(`${id.padEnd(8)} oddaje: ${surpluses.slice(0, 3).map(s => `${s.id}×${s.spare}`).join(' ')}`);
  }
  t.check('co najmniej jedna stacja ma nadwyżkę do oddania', stationsWithSurplus > 0, `(${stationsWithSurplus})`);

  t.section('7. Dopasowanie popytu — istnieje trasa dla każdego braku');
  const unroutable = [];
  for (const [id, { station, econ }] of sim) {
    for (const deficit of getStationDeficits(station, econ, 3)) {
      // Uran i złom przychodzą ze świata (pas Kuipera, wraki), nie od stacji —
      // brak producenta wśród stacji jest dla nich poprawny.
      if (WORLD_SOURCED.has(deficit.id)) continue;
      const source = [...sim.entries()].find(([otherId, other]) =>
        otherId !== id && getStationOutputs(other.station).includes(deficit.id));
      if (!source) unroutable.push(`${id} ← ${deficit.id}`);
    }
  }
  t.check('każdy brak ma gdzieś producenta', unroutable.length === 0, `(${[...new Set(unroutable)].slice(0, 4).join(', ')})`);

  t.section('8. Filtr zapotrzebowania');
  t.check('Ziemia chce rudę żelaza', stationWantsResource(makeStation('earth'), 'iron_ore'));
  t.check('Ziemia NIE chce metanu (nic z niego nie robi)', !stationWantsResource(makeStation('earth'), 'methane'));
  t.check('Jowisz chce metan', stationWantsResource(makeStation('jupiter'), 'methane'));
  t.check('każdy chce tlen (byt)', stationWantsResource(makeStation('mars'), 'oxygen'));
  t.check('opuszczona stacja nie ma przemysłu', !stationWantsResource(makeStation('neptune'), 'iron_ore'));

  t.section('9. Stacja opuszczona nic nie robi');
  const derelict = { id: 'neptune', planet: { id: 'neptune' }, factionId: null };
  const derelictEcon = makeEcon();
  derelictEcon.resources.steel = 100;
  const ran = runStationEconomy(derelict, derelictEcon, 50, seededRng(4));
  t.check('silnik odmawia obsługi opuszczonej stacji', ran === false);
  t.equal('zapas zostaje nietknięty', derelictEcon.resources.steel, 100);

  t.section('11. Z idealną logistyką ekonomia się stabilizuje, a nie zakleszcza');
  // Bez vanów każda stacja siedzi na skrajnościach: pełna tego, co sama robi,
  // pusta na resztę. To POPRAWNE — ta różnica jest właśnie paliwem dla
  // logistyki. Ale trzeba sprawdzić, czy przy działającym transporcie liczby
  // się domykają, zanim zbudujemy vany. Jeśli produkcja jest źle wyskalowana,
  // żaden transport tego nie uratuje.
  const linked = new Map();
  for (const id of ids) {
    const entry = { station: makeStation(id), econ: makeEcon() };
    seedStationStock(entry.station, entry.econ);
    linked.set(id, entry);
  }
  const rng2 = seededRng(7);

  // Rozdzielnik oddaje towar NAJBARDZIEJ POTRZEBUJĄCEMU, porcjami — tak jak
  // będzie działać routing vanów (getStationDeficits sortuje rosnąco po zapasie).
  // Pierwsza wersja rozdawała po kolei i pierwsza stacja w iteracji zjadała
  // całą pulę, przez co reszta głodowała mimo wystarczającej produkcji.
  // Co faktycznie dojechało. Bez tego test myli DWA różne stany: stację, do
  // której towar nie dociera, i stację, która zużywa go w tym samym cyklu,
  // w którym go dostaje. Uran po przebudowie przemysłu jest tym drugim —
  // wzbogaca uran z dostarczanej stali i zostaje z zerem na stanie, choć
  // pełny symulator ruchu nie zgłasza tam żadnego braku.
  const delivered = new Set();
  const transfer = () => {
    const pools = {};
    for (const [fromId, from] of linked) {
      for (const surplus of getStationSurpluses(from.station, from.econ, 20)) {
        if (surplus.spare <= 0) continue;
        from.econ.resources[surplus.id] -= surplus.spare;
        pools[surplus.id] = (pools[surplus.id] || 0) + surplus.spare;
      }
    }
    for (const [id, total] of Object.entries(pools)) {
      let pool = total;
      const takers = [...linked.values()].filter(s => stationWantsResource(s.station, id));
      while (pool > 0.01 && takers.length) {
        takers.sort((a, b) =>
          (a.econ.resources[id] / a.econ.capacity[id]) - (b.econ.resources[id] / b.econ.capacity[id]));
        const target = takers[0];
        const cap = target.econ.capacity[id] || 0;
        const room = Math.max(0, cap * 0.85 - target.econ.resources[id]);
        if (room <= 0.01) break; // najbardziej potrzebujący jest już pełny
        const move = Math.min(pool, room, Math.max(1, cap * 0.1));
        target.econ.resources[id] += move;
        delivered.add(`${[...linked.entries()].find(([, v]) => v === target)[0]}:${id}`);
        pool -= move;
      }
    }
  };

  // Symulacja floty wydobywczej: ruda uranu z pasa Kuipera trafia do rafinerii
  // na Uranie i Saturnie. Bez tego cały łańcuch pręty paliwowe → rdzenie
  // reaktorów stoi — i tak ma być, dopóki nikt nie kopie w pasach.
  // Złomu NIE dosypujemy: jego jedynym źródłem jest gracz, a świat musi
  // działać bez niego.
  const uraniumRefineries = ['uranus', 'saturn'].map(id => linked.get(id)).filter(Boolean);
  for (let cycle = 0; cycle < 400; cycle++) {
    for (const refinery of uraniumRefineries) {
      const cap = refinery.econ.capacity.uranium_ore || 0;
      refinery.econ.resources.uranium_ore = Math.min(cap, refinery.econ.resources.uranium_ore + 1.6);
    }
    for (const { station, econ } of linked.values()) runStationEconomy(station, econ, 1, rng2);
    transfer();
  }

  // Marsjańska stocznia to najgłębszy odbiorca łańcucha — jeśli cokolwiek
  // dojdzie tam do końca, znaczy że cały łańcuch T0→T1→T2 się domyka.
  const mars = linked.get('mars');
  const marsComponents = ['hull_plate', 'thruster', 'reactor_core', 'weapon_mount']
    .reduce((a, id) => a + mars.econ.resources[id], 0);
  t.check('stocznia na Marsie produkuje komponenty', marsComponents > 0, `(${marsComponents.toFixed(1)})`);
  t.note(`Mars: ${['hull_plate', 'thruster', 'reactor_core', 'weapon_mount']
    .map(id => `${id} ${mars.econ.resources[id].toFixed(0)}`).join('  ')}`);

  let starving = [];
  for (const [id, { station, econ }] of linked) {
    if (!STATION_INDUSTRY[id].capacity) continue;
    // Zagłodzona = zero na czymś, co produkuje ktokolwiek inny w układzie.
    const dead = getStationDeficits(station, econ, 12)
      .filter(d => d.fill <= 0.001)
      .filter(d => !WORLD_SOURCED.has(d.id))
      .filter(d => [...linked.entries()].some(([o, other]) => o !== id && getStationOutputs(other.station).includes(d.id)))
      .filter(d => !delivered.has(`${id}:${d.id}`));
    if (dead.length) starving.push(`${id}: ${dead.map(d => d.id).join(',')}`);
  }
  t.check('przy działającym transporcie nikt nie głoduje na dostępnym towarze',
    starving.length === 0, `(${starving.join(' | ')})`);

  t.section('12. Bilans podaży i popytu — analitycznie, nie symulacyjnie');
  // Symulacja mówi CZY coś się sypie, ta analiza mówi DLACZEGO i o ile.
  // Liczone na cykl ekonomiczny, dla całego układu naraz.
  const supply = {};
  const demand = {};
  const add = (map, id, amount) => { map[id] = (map[id] || 0) + amount; };

  for (const [id, industry] of Object.entries(STATION_INDUSTRY)) {
    if (!industry.capacity) continue;
    const planet = PLANET_YIELD[id];
    if (planet?.rate > 0) {
      const total = 9 * planet.rate; // EXTRACTION_PER_CYCLE × rate
      for (const [res, share] of Object.entries(planet.yields)) add(supply, res, total * share);
    }
    for (const recipeId of industry.recipes) {
      const recipe = RECIPES[recipeId];
      const batches = lineWeight(industry, recipeId) * (ECONOMY_CYCLE_SECONDS / recipe.seconds);
      for (const [res, need] of Object.entries(recipe.in)) add(demand, res, need * batches);
      for (const [res, out] of Object.entries(recipe.out)) add(supply, res, out * batches);
    }
    for (const [res, perCycle] of Object.entries(STATION_UPKEEP)) {
      add(demand, res, perCycle * upkeepScale(industry));
    }
  }

  const shortages = [];
  for (const [id, needed] of Object.entries(demand)) {
    if (needed <= 0) continue;
    const available = supply[id] || 0;
    const ratio = available / needed;
    if (ratio < 1) shortages.push({ id, ratio, available, needed });
  }
  shortages.sort((a, b) => a.ratio - b.ratio);
  for (const s of shortages) {
    t.note(`${s.id.padEnd(14)} podaż ${s.available.toFixed(2)} / popyt ${s.needed.toFixed(2)}  = ${(s.ratio * 100).toFixed(0)}%`);
  }
  // Surowce, których ŻADNA stacja nie wytwarza — przychodzą ze świata, nie
  // z przemysłu: ruda uranu z pasa Kuipera, złom z wraków przywieziony przez
  // gracza. Ich deficyt jest celowy i stanowi treść, nie usterkę.
  
  const realShortages = shortages.filter(s => !WORLD_SOURCED.has(s.id) && (supply[s.id] || 0) > 0);
  t.check('każdy surowiec z produkcją planetarną ma pokryty popyt',
    realShortages.length === 0,
    `(${realShortages.map(s => `${s.id} ${(s.ratio * 100).toFixed(0)}%`).join(', ')})`);
  t.check('uran pozostaje wąskim gardłem wymagającym wydobycia w pasach',
    (supply.uranium_ore || 0) === 0);

  // OGÓLNA POSTAĆ BŁĘDU, który to przegapił: receptura istnieje w resources.js,
  // ale żaden profil przemysłowy jej nie wykonuje. Tak zniknęła rafinacja uranu —
  // `fuel_rods` były nieosiągalne NA ZAWSZE, a poprzednia wersja tego testu
  // wykluczała je jako "celowo deficytowe" i sama zamaskowała lukę.
  const executedRecipes = new Set();
  for (const industry of Object.values(STATION_INDUSTRY)) {
    if (!industry.capacity) continue;
    for (const id of industry.recipes) executedRecipes.add(id);
  }
  const orphanRecipes = Object.keys(RECIPES).filter(id => !executedRecipes.has(id));
  t.check('każda receptura jest przez kogoś wykonywana', orphanRecipes.length === 0,
    `(nikt nie robi: ${orphanRecipes.join(', ')})`);

  // I odwrotnie: każdy surowiec, którego ktokolwiek POTRZEBUJE, musi mieć
  // producenta — albo planetarnego, albo w postaci receptury.
  const unmakeable = Object.keys(demand).filter(id =>
    (supply[id] || 0) <= 0 && !WORLD_SOURCED.has(id));
  t.check('wszystko, czego ktoś potrzebuje, da się wytworzyć', unmakeable.length === 0,
    `(bez producenta: ${unmakeable.join(', ')})`);

  t.section('10. Spójność konfiguracji');
  const badRecipes = [];
  for (const [id, industry] of Object.entries(STATION_INDUSTRY)) {
    for (const recipeId of industry.recipes) {
      if (!RECIPES[recipeId]) badRecipes.push(`${id}: ${recipeId}`);
    }
  }
  t.check('profile przemysłowe używają istniejących receptur', badRecipes.length === 0, `(${badRecipes.join(', ')})`);
  const badLifeSupport = Object.keys(STATION_UPKEEP).filter(id => !RESOURCES[id]);
  t.check('zużycie bytowe używa istniejących surowców', badLifeSupport.length === 0, `(${badLifeSupport.join(', ')})`);
  t.check('cykl ekonomiczny ma sensowną długość', ECONOMY_CYCLE_SECONDS > 0 && ECONOMY_CYCLE_SECONDS <= 120);
  t.equal('opis roli opuszczonej stacji', describeStationRole(derelict), 'Opuszczona — brak produkcji');

  t.section('13. Archetypy — czy da się dołożyć stację, nie psując bilansu');
  // To jest pytanie, dla którego przemysł w ogóle przeszedł na role: czy nowa
  // stacja albo nowa frakcja utrzyma się w tej gospodarce, czy trzeba pod nią
  // ręcznie przestawiać liczby. Dokładamy siedlisko Unii Pasa i kopalnię
  // przyczółkową — i sprawdzamy, czy układ nadal się domyka.
  const rozszerzony = buildIndustryMap({
    ...SYSTEM_INDUSTRY_SPEC,
    psyche:  { capacity: 3.0, roles: ['foundry', 'electronics'], size: 0.7 },
    hygiea:  { capacity: 1.4, roles: ['foundry'], size: 0.4 },
    tytan:   { capacity: 2.2, roles: ['gasworks', 'volatiles'], size: 0.6 }
  });

  t.check('nowa stacja dostaje działający profil bez ręcznego strojenia',
    rozszerzony.psyche.recipes.length === 5 && rozszerzony.psyche.capacity === 3.0);
  t.check('moc rozkłada się na linie i sumuje do zadeklarowanej',
    Math.abs(Object.values(rozszerzony.psyche.lines).reduce((a, b) => a + b, 0) - 3.0) < 1e-6);
  t.check('role dzielące recepturę nie dublują linii',
    new Set(rozszerzony.psyche.recipes).size === rozszerzony.psyche.recipes.length);

  // Linia karmiąca inne dostaje więcej mocy niż ta, która karmi tylko magazyn.
  // Bez tego archetypy byłyby tylko inną formą ręcznej listy receptur.
  t.check('solver daje więcej mocy linii, od której zależą pozostałe',
    rozszerzony.hygiea.lines.smelt_steel > rozszerzony.hygiea.lines.draw_copper_wire);

  const brakiPoRozszerzeniu = [];
  {
    const podaz = {}; const popyt = {};
    const dodaj = (map, id, amount) => { map[id] = (map[id] || 0) + amount; };
    for (const [id, industry] of Object.entries(rozszerzony)) {
      if (!industry.capacity) continue;
      const planet = PLANET_YIELD[id];
      if (planet?.rate > 0) {
        const total = 9 * planet.rate;
        for (const [res, share] of Object.entries(planet.yields)) dodaj(podaz, res, total * share);
      }
      for (const recipeId of industry.recipes) {
        const recipe = RECIPES[recipeId];
        const batches = lineWeight(industry, recipeId) * (ECONOMY_CYCLE_SECONDS / recipe.seconds);
        for (const [res, need] of Object.entries(recipe.in)) dodaj(popyt, res, need * batches);
        for (const [res, out] of Object.entries(recipe.out)) dodaj(podaz, res, out * batches);
      }
      for (const [res, perCycle] of Object.entries(STATION_UPKEEP)) {
        dodaj(popyt, res, perCycle * upkeepScale(industry));
      }
    }
    for (const [id, needed] of Object.entries(popyt)) {
      if (needed <= 0 || WORLD_SOURCED.has(id)) continue;
      const available = podaz[id] || 0;
      // Nowe stacje nie mają własnych złóż, więc rudę muszą sprowadzić z pasa —
      // tak jak w grze robią to floty górnicze. Liczy się to, czy PRZEROBIONE
      // dobra się domykają.
      if (RESOURCES[id]?.tier === TIER.RAW) continue;
      if (available > 0 && available / needed < 0.9) {
        brakiPoRozszerzeniu.push(`${id} ${((available / needed) * 100).toFixed(0)}%`);
      }
    }
  }
  t.check('bilans domyka się po dołożeniu trzech stacji spoza konfiguracji',
    brakiPoRozszerzeniu.length === 0, `(${brakiPoRozszerzeniu.join(', ')})`);

  const nieznaneRole = Object.values(STATION_INDUSTRY)
    .flatMap(i => i.roles || [])
    .filter(rola => !INDUSTRY_ARCHETYPES[rola]);
  t.check('wszystkie role stacji istnieją jako archetypy', nieznaneRole.length === 0, `(${nieznaneRole.join(', ')})`);

  const bezRoli = Object.keys(RECIPES).filter(id =>
    !Object.values(INDUSTRY_ARCHETYPES).some(a => a.recipes.includes(id)));
  t.check('każda receptura należy do jakiegoś archetypu', bezRoli.length === 0, `(${bezRoli.join(', ')})`);

  t.check('archetyp sam w sobie jest spójny', Object.values(INDUSTRY_ARCHETYPES)
    .every(a => a.recipes.length > 0 && a.recipes.every(id => RECIPES[id])));

  return t.results;
}

runIfMain(import.meta.url, run);
