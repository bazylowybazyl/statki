/**
 * SYMULACJA RUCHU — sprawdzian, czy gospodarka domyka się przy realnym transporcie.
 *
 * Analiza (`analiza-ruchu.mjs`) mówi, ILE trzeba przewieźć. Ta symulacja sprawdza,
 * czy zbudowana warstwa ruchu faktycznie tyle przewozi — i co się dzieje, gdy
 * piraci zaczynają zbierać żniwo. Wszystko w gołym Node, bez przeglądarki.
 *
 *   node scripts/symulacja-ruchu.mjs                 60 minut gry, piraci bazowo
 *   node scripts/symulacja-ruchu.mjs 180 0           3 godziny, bez piratów
 *   node scripts/symulacja-ruchu.mjs 60 4            presja piratów ×4
 *   node scripts/symulacja-ruchu.mjs 120 1 4         magazyny ×4 (stacje z halami)
 */

import {
  RESOURCES, RESOURCE_KEYS, RECIPES, PLANET_YIELD, TIER, getResourceCapacityFactor
} from '../src/data/resources.js';
import { FACTION, getDefaultStationFaction } from '../src/data/factions.js';
import {
  seedStationStock, getStationDeficits, STATION_INDUSTRY, systemHaulTonnage,
  resourcePrice, stationHaulTonnage, getStationIndustry, militaryScale
} from '../src/game/stationEconomy.js';
import { createFleetState } from '../src/game/cargoFleet.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { buildTravelNetwork } from '../src/game/traffic/travelNetwork.js';
import { createCourseRegistry } from '../src/game/traffic/courseRegistry.js';
import { createDirector, tickDirector, directorSnapshot } from '../src/game/traffic/trafficDirector.js';
import { patrolMultiplier } from '../src/game/traffic/patrols.js';
import {
  createWarState, tickWar, summarizeWar, declareAmmoDemand
} from '../src/game/traffic/warDispatcher.js';
import { createScrapperState, tickScrappers, summarizeScrappers } from '../src/game/traffic/scrapperFleets.js';
import { createPiracyState, registerNest, tickPiracy, summarizePiracy } from '../src/game/traffic/piracy.js';
import {
  buildStationDocks, berthOccupancy, suggestBerthMultiplier
} from '../src/game/traffic/dockLayout.js';
import { createFleetRegistry, summarizeCompanies } from '../src/game/traffic/transportCompanies.js';
import { buildCarriers, TONS_PER_SHIP_HOUR } from '../src/game/traffic/carrierRoster.js';
import {
  createShipyardRegistry, registerShipyard, tickShipyards, summarizeShipyards
} from '../src/game/traffic/shipyards.js';
import {
  createAgentRegistry, buildMerchants, summarizeAgents
} from '../src/game/traffic/agentFleets.js';

const MINUTES = Number(process.argv[2]) || 60;
const PRESSURE = process.argv[3] !== undefined ? Number(process.argv[3]) : 1;
/**
 * Mnożnik pojemności magazynów. Bazowe 250/150/60 to stacja BEZ hal — w grze
 * magazyny dokładają po +180…+320 za budynek. Ma znaczenie, bo Ziemia zużywa
 * 792 rudy żelaza na godzinę: przy magazynie na 250 obraca całym składem trzy
 * razy na godzinę, więc żaden transport nie zdąży jej wykarmić.
 */
const CAPACITY_MUL = process.argv[4] !== undefined ? Number(process.argv[4]) : 1;
/**
 * Mnożnik przepustowości gospodarki. Skaluje produkcję, zużycie i magazyny tym
 * samym czynnikiem, więc bilans zostaje, a rośnie sam tonaż. Przy niezmienionej
 * ładowni N× większy przepływ to N× więcej kursów — tak robi się gęste niebo
 * bez dorysowywania ruchu bez powodu.
 */
const ECONOMY_SCALE = process.argv[5] !== undefined ? Number(process.argv[5]) : 1;
const STEP = 5;   // sekund gry na krok — dość drobno, żeby postoje nie ginęły

// ---------- świat ----------
const beltEdgeAu = getOutermostBeltEdgeAu(BELT_DEFINITIONS);
const mainBelt = BELT_DEFINITIONS.find(belt => belt.id === 'main');
const kuiper = BELT_DEFINITIONS.find(belt => belt.id === 'kuiper');

const network = buildTravelNetwork({
  beltEdgeAu,
  angleFor: (_def, index) => index * 0.7,
  outposts: [
    // LIGA PASA w pasie głównym (36–47 AU mapy). Kąty rozstawione tak, żeby
    // nie leżały na jednej prostej z rdzeniem — inaczej cały ruch do nich
    // szedłby jedną trasą i piractwo miałoby jedno wąskie gardło.
    { id: 'ceres', label: 'Ceres', orbitAU: 39.5, angle: 2.6, berths: 6 },
    { id: 'vesta', label: 'Westa', orbitAU: 44.0, angle: 5.1, berths: 4 },
    // KRYJOWKI PIRACKIE. Leza przy trasach, nie przy zlozach: Hildy tuz za
    // pasem glownym, zlomowisko na dlugim odcinku do olbrzymow gazowych.
    // Malo stanowisk - to nie porty, tylko miejsca, gdzie sie uplynnia lup.
    { id: 'gniazdo-hildy', label: 'Gniazdo Hildy', orbitAU: 52.0, angle: 0.9, berths: 3 },
    { id: 'zlomowisko', label: 'Zlomowisko', orbitAU: 68.0, angle: 3.8, berths: 3 }
  ],
  fields: [
    {
      id: 'belt-main', label: 'Pas Główny',
      orbitAU: (mainBelt.innerAU + mainBelt.outerAU) / 2, angle: 1.9,
      innerAU: mainBelt.innerAU, outerAU: mainBelt.outerAU, arcSpread: 0.85,
      yields: { iron_ore: 1, silicon_ore: 1, copper_ore: 1, titanium_ore: 1, raw_crystal: 1 },
      extractionSeconds: 600
    },
    {
      id: 'belt-kuiper', label: 'Pas Kuipera',
      orbitAU: (kuiper.innerAU + kuiper.outerAU) / 2, angle: 4.2,
      innerAU: kuiper.innerAU, outerAU: kuiper.outerAU, arcSpread: 0.7,
      // Jedyne źródło rudy uranu w całym układzie — patrz analiza-ruchu.mjs.
      yields: { uranium_ore: 1, ice: 1, raw_crystal: 1 },
      extractionSeconds: 900
    }
  ]
});

// ---------- stacje ----------
const CAPACITY_BY_TIER = { [TIER.RAW]: 250, [TIER.REFINED]: 150, [TIER.COMPONENT]: 60 };
// Magazyn musi rosnąć razem z przepływem, inaczej większa gospodarka oznacza
// tylko szybsze przelewanie się tego samego wiadra.
const baseCapacity = Object.fromEntries(
  RESOURCE_KEYS.map(key =>
    [key, (CAPACITY_BY_TIER[RESOURCES[key].tier] ?? 100)
      * getResourceCapacityFactor(key) * CAPACITY_MUL * ECONOMY_SCALE])
);

// Przeładunek każdej stacji w t/h — od tego, a nie od liczby mieszkańców,
// zależy wielkość portu.
const PRZEŁADUNEK = stationHaulTonnage();

const economies = new Map();
const stations = network.stations.map(node => {
  // Pozycja MUSI iść ze stacją, nie tylko z węzłem sieci. Bez niej każdy
  // rachunek odległości wychodzi zerowy i wszystko wygląda na opłacalne —
  // złomiarze holowali wtedy 112 wraków na 112, nie tnąc ani jednego.
  const station = {
    id: node.id, name: node.label, factionId: getDefaultStationFaction(node.id),
    x: node.x, y: node.y
  };
  const econ = {
    resources: Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0])),
    capacity: { ...baseCapacity }
  };
  // Księżyc startuje CHUDO. Przy 45% zapełnienia jego skromny byt (0,3 skali)
  // schodziłby do progu zamówień jedenaście godzin gry — przez cały ten czas
  // kopalnia tylko eksportowałaby, nie będąc niczyim klientem.
  seedStationStock(station, econ, node.moon ? 0.18 : 0.45);
  economies.set(station.id, econ);
  return station;
});

// ---------- doki ----------
// Ziemia i Mars mają pierścienie, więc ich doki wyrastają z obręczy. Reszta
// dostaje doki na orbicie wokół stacji.
const RING_RADIUS = { earth: 37800, mars: 30000 };
const docks = new Map();
for (const node of network.stations) {
  if (node.derelict) continue;
  docks.set(node.id, buildStationDocks(
    { id: node.id, x: node.x, y: node.y, r: 120, ringWorldRadius: RING_RADIUS[node.id] || 0 },
    { berthMultiplier: suggestBerthMultiplier(PRZEŁADUNEK[node.id], ECONOMY_SCALE) }
  ));
}

// ---------- firmy transportowe ----------
// Trzy profile: duża firma stać na pusty powrót, mała musi czekać na ładunek.
// To jedyna różnica w zachowaniu — reszta modelu jest dla wszystkich taka sama.
const companies = createFleetRegistry();
const homePorts = stations
  .filter(station => station.factionId && station.factionId !== FACTION.PIRATES)
  .map(station => station.id);
// Flota wielkości wynikającej z gospodarki, nie ze stałej — dołożenie stacji
// samo dokłada przewoźników zamiast cicho zapychać transport.
const { companies: companyList, ships: totalShips } = buildCarriers(companies, homePorts, ECONOMY_SCALE,
  { factionOf: getDefaultStationFaction, shipsPerScale: systemHaulTonnage() / TONS_PER_SHIP_HOUR });

// ---------- niezależni kupcy ----------
// Domy handlowe (karawana kilku frachtowców z ochroną) plus samotne wilki.
// Ta sama funkcja co w demie, żeby konsola i ekran pokazywały ten sam rynek.
const agents = createAgentRegistry();
const merchants = buildMerchants(agents, homePorts, ECONOMY_SCALE);

// ---------- stocznie ----------
// KAŻDA frakcja ma stocznię, a od 2026-08-17 CZTERY potrafią też zrobić
// podzespoły: Terra Nova, Mars, Konsorcjum Zewnętrzne (Jowisz) i Liga Pasa
// (Ceres). Konsorcjum Wewnętrzne nadal musi je sprowadzać — i dobrze, bo bez
// takiej asymetrii zbrojenie nie generowałoby ruchu.
const shipyards = createShipyardRegistry();
const YARD_WEIGHT = {
  mars: 2.0, earth: 1.2, jupiter: 1.1, ceres: 1.0, venus: 0.8,
  mercury: 0.6, saturn: 0.6, uranus: 0.5, vesta: 0.4
};
for (const station of stations) {
  if (!station.factionId) continue;
  // Stocznię ma ośrodek przemysłowy, nie każda skała z wiertłem. Bez tego
  // warunku 22 księżyce dostawały pochylnie i układ miał 27 stoczni zamiast 9.
  if (militaryScale(getStationIndustry(station)) <= 0) continue;
  registerShipyard(shipyards, {
    station,
    stationId: station.id, factionId: station.factionId,
    weight: (YARD_WEIGHT[station.id] || 0.6) * Math.sqrt(ECONOMY_SCALE)
  });
}

// ---------- wojna ----------
// Odbiorca dla gotowych okrętów i jedyne źródło złomu w układzie.
const war = createWarState();
// Bez tego transport NIE WIE, że do portu wojennego trzeba wozić skrzynie —
// `stationWantsResource` widzi tylko wsad receptur i zużycie bytowe.
declareAmmoDemand(stations);
// Zbieranie wraków NIE wymaga przemysłu — każda stacja z flotą to robi.
const scrappers = createScrapperState();

// ---------- piractwo jako gospodarka ----------
// Łup z przechwytów ląduje w kryjówkach, przemytnicy zamieniają go w kredyty,
// kredyty finansują kolejne rejdy. Łowcy nagród przecinają tę pętlę.
const piracy = createPiracyState();
for (const station of stations) {
  if (station.factionId === 'pirates') registerNest(piracy, station);
}

// ---------- warstwa ruchu ----------
const registry = createCourseRegistry({ keepHistory: false });
const fleet = createFleetState();
const director = createDirector(network, registry, {
  fleet,
  companies,
  docks,
  agents,
  getEconomy: stationId => economies.get(String(stationId)) || null,
  piracyPressure: PRESSURE,
  piracyEnabled: PRESSURE > 0,
  economyScale: ECONOMY_SCALE,
  piracy,
  targetFleetPerCompany: Math.max(4, Math.round(totalShips / Math.max(1, companyList.length)))
});

console.log(`\n  świat: AU ${network.auInWorldUnits.toFixed(0)} j., `
  + `${network.stations.length} stacji, ${network.gates.length} bramy, ${network.fields.length} pola`);
console.log(`  rynek: ${companyList.length} firm, ${totalShips} jednostek`);
console.log(`  bieg: ${MINUTES} min gry, krok ${STEP} s, presja piratów ×${PRESSURE}, `
  + `magazyny ×${CAPACITY_MUL}, gospodarka ×${ECONOMY_SCALE}\n`);

// ---------- bieg ----------
const totalSeconds = MINUTES * 60;
const marks = [0.25, 0.5, 0.75, 1.0];
let markIndex = 0;

console.log('  czas   aktywne  dostawy  stracone  bez pal.  wraki   utracona wartość');
let tickNanos = 0;
let tickCount = 0;
let peakActive = 0;
for (let elapsed = 0; elapsed < totalSeconds; elapsed += STEP) {
  const t0 = process.hrtime.bigint();
  tickDirector(director, STEP, stations);
  tickShipyards(shipyards, STEP, { getEconomy: id => economies.get(String(id)) || null });
  tickWar(war, STEP, {
    shipyards, stations, network, registry,
    getEconomy: id => economies.get(String(id)) || null
  });
  tickPiracy(piracy, STEP, {
    stations, registry,
    getEconomy: id => economies.get(String(id)) || null,
    // Siła kontroli na szlaku = to, o ile patrol zbija tam ryzyko. Ta sama
    // danina frakcji chroni własne konwoje I dusi przemyt.
    patrolStrength: (fromId, toId) =>
      Math.max(0, (1 / Math.max(0.05, patrolMultiplier(director.patrols, fromId, toId))) - 1),
    priceAt: (station, resourceId) => {
      const econ = economies.get(String(station.id));
      return econ ? (resourcePrice(station, econ, resourceId)?.bid || 0) : 0;
    }
  });
  tickScrappers(scrappers, STEP, {
    war, stations, registry, getEconomy: id => economies.get(String(id)) || null
  });
  tickNanos += Number(process.hrtime.bigint() - t0);
  tickCount++;
  peakActive = Math.max(peakActive, registry.active.length);
  if (markIndex < marks.length && elapsed >= totalSeconds * marks[markIndex] - STEP) {
    const snap = directorSnapshot(director);
    console.log(`  ${String(Math.round(elapsed / 60)).padStart(4)}m  `
      + `${String(snap.active).padStart(7)}  ${String(snap.stats.delivered).padStart(7)}  `
      + `${String(snap.stats.lost).padStart(8)}  ${String(snap.stats.stranded).padStart(8)}  `
      + `${String(snap.wrecks).padStart(5)}  ${snap.stats.lostValue.toFixed(0).padStart(12)} CR`);
    markIndex++;
  }
}

const snap = directorSnapshot(director);

console.log('\n=== KURSY ===\n');
console.log(`  wystawione przewozy: ${snap.stats.hauls}, wyprawy górnicze: ${snap.stats.mining}`);
console.log(`  dostarczone: ${snap.stats.delivered}, przechwycone: ${snap.stats.lost}, `
  + `bez paliwa: ${snap.stats.stranded}`);
const attempted = snap.stats.hauls + snap.stats.mining;
if (attempted > 0) {
  console.log(`  skuteczność dostaw: ${(snap.stats.delivered / attempted * 100).toFixed(1)}%`);
}
console.log(`  w powietrzu na koniec: ${snap.active}, szczyt: ${peakActive}`);
console.log(`  przy stanowiskach: ${snap.berthed}, W KOLEJCE NA REDZIE: ${snap.queued}`);
const sy = summarizeShipyards(shipyards);
console.log(`  stocznie: ${sy.yards}, w budowie ${sy.building}, zwodowane ${sy.stats.built} `
  + `(${JSON.stringify(sy.stats.byClass)}), zużyto komponentów za ${Math.round(sy.stats.spent)} CR`);
for (const f of sy.factions.slice(0, 5)) {
  console.log(`    ${f.factionId.padEnd(18)} gotowych ${String(f.ready).padStart(4)}  siła ${String(f.power).padStart(7)}  ${JSON.stringify(f.byClass)}`);
}
const ag = summarizeAgents(agents);
const wojna = summarizeWar(war);
console.log(`  amunicja: odwołane z braku ${wojna.stats.abortedNoAmmo}, obrona bez zapasu `
  + `${wojna.stats.defenderNoAmmo}, spalone za ${Math.round(wojna.stats.ammoSpent).toLocaleString('pl')} CR`);
for (const id of ['mars', 'earth', 'venus', 'saturn', 'jupiter']) {
  const e = economies.get(id);
  if (!e) continue;
  console.log(`    ${id.padEnd(8)} kin ${Math.round(e.resources.ammo_kinetic || 0).toString().padStart(6)}  `
    + `flak ${Math.round(e.resources.flak_shell || 0).toString().padStart(5)}  `
    + `rak ${Math.round(e.resources.missile_round || 0).toString().padStart(5)}  `
    + `torp ${Math.round(e.resources.torpedo_round || 0).toString().padStart(5)}  `
    + `| działa kin ${Math.round(e.resources.gun_ballistic || 0)}  ener ${Math.round(e.resources.gun_energy || 0)}`
    + `  myśliwce ${Math.round(e.resources.fighter_craft || 0)}`);
}
console.log(`  wojna: ${wojna.stats.launched} wypraw, ${wojna.stats.battles} bitew `
  + `(atakujący wygrał ${wojna.stats.attackerWins}×), stracono ${wojna.stats.shipsLost} okrętów`);
console.log(`    wraki: ${wojna.wrecks} sztuk, ${Math.round(wojna.stats.scrapCreated)} złomu `
  + `= ${(wojna.stats.scrapCreated / (MINUTES / 60)).toFixed(0)} szt/h`);
const pir = summarizePiracy(piracy);
console.log(`  piractwo: ${pir.stats.raidsLaunched} rejdów (${pir.raids} w polu), `
  + `zrabowano ${Math.round(pir.stats.lootValue).toLocaleString('pl')} CR`);
console.log(`    przemyt: ${pir.stats.smugglesRun} kursów, ${pir.stats.smugglesCaught} wpadło, `
  + `utarg kryjówek ${Math.round(pir.stats.fencedValue).toLocaleString('pl')} CR`);
console.log(`    łowcy: ${pir.stats.huntsLaunched} polowań, ubito ${pir.stats.raidsKilled} rejderów, `
  + `pula nagród ${pir.bounties.toLocaleString('pl')} CR`);
for (const n of pir.nests) {
  console.log(`    ${n.id.padEnd(16)} kasa ${String(n.credits).padStart(8)} CR, `
    + `łup ${String(n.lootValue).padStart(8)} CR w ${n.items} pozycjach`);
}

const zlom = summarizeScrappers(scrappers);
console.log(`  złomiarze: ${zlom.stats.dispatched} wypraw, odzyskano ${zlom.stats.recovered} wraków `
  + `(${zlom.stats.towed} holem, ${zlom.stats.cut} cięciem), stracono ${zlom.stats.lost}`);
console.log(`    łup: ${Math.round(zlom.stats.scrap)} złomu = ${(zlom.stats.scrap / (MINUTES / 60)).toFixed(0)} szt/h`
  + `, wartość ${Math.round(zlom.stats.value).toLocaleString('pl')} CR`);
if (Object.keys(zlom.stats.components).length) {
  console.log(`    odzyskane podzespoły: ${JSON.stringify(zlom.stats.components)}`);
}
console.log(`    nietknięte wraki na mapie: ${wojna.wrecks}`);
if (wojna.stats.shipsLost) {
  console.log(`    zatopione wg klas: ${JSON.stringify(wojna.stats.byClass)}`);
}
console.log(`  agenci: ${ag.count} (${ag.caravans} karawan / ${ag.hulls} kadłubów / osłona ${ag.escorts}, `
  + `${ag.busy} w drodze), kapitał ${ag.capital.toLocaleString('pl')} CR, `
  + `kursy ${ag.stats.hauls}, straty ${ag.stats.losses}, bez okazji ${ag.stats.idle}`);
for (const row of ag.rows.slice(0, 6)) {
  console.log(`    ${row.name.padEnd(24)} ${row.profile.padEnd(9)} ${String(row.capital).padStart(8)} CR  `
    + `${row.ships > 1 ? `karawana ${row.ships}×/osł.${row.escorts}` : 'solo         '}  `
    + `kursy ${row.trades}  zysk ${row.zysk >= 0 ? '+' : ''}${row.zysk}`);
}
const pat = snap.patrols;
console.log(`  patrole: ${pat.count} szlaków, łączna siła ${pat.totalStrength}, `
  + `ufundowane ${pat.stats.funded}, rozwiązane ${pat.stats.disbanded}`);
for (const lane of pat.lanes.slice(0, 4)) {
  console.log(`    ${(lane.fromId + ' ↔ ' + lane.toId).padEnd(24)} siła ${lane.strength}  (${lane.factionId})`);
}
console.log(`  konwoje: ${snap.convoys.count} grup / ${snap.convoys.ships} jednostek, `
  + `największa ${snap.convoys.largest}, z osłoną ${snap.convoys.escorted}`);
console.log(`  przechwyty konwojów: ${snap.convoys.stats.intercepted}, `
  + `stracone ${snap.convoys.stats.shipsLost}, URATOWANE ${snap.convoys.stats.shipsSaved}`);

// Brief każe pilnować budżetu klatki: gra siedzi na ~20 ms jednordzeniowo,
// więc realny budżet dla ruchu to 2–4 ms. Ta liczba mówi, czy się mieścimy.
const msPerTick = tickNanos / 1e6 / Math.max(1, tickCount);
const usPerCourse = peakActive > 0 ? (tickNanos / 1e3 / tickCount) / peakActive : 0;
console.log(`\n  KOSZT: ${msPerTick.toFixed(3)} ms na tick symulacji `
  + `(${usPerCourse.toFixed(3)} µs na kurs przy szczycie ${peakActive})`);
console.log(`  tick = ${STEP} s gry, więc przy tempie ×20 to ${(msPerTick * 20 / STEP).toFixed(2)} ms `
  + 'na sekundę czasu rzeczywistego');
console.log(`  wg rodzaju: ${JSON.stringify(snap.byKind)}`);
console.log(`  wg napędu:  ${JSON.stringify(snap.byMode)}`);

// Surowce, których w tym układzie NIKT nie wytwarza ani nie wykopie. Ich brak to
// treść, nie usterka: złom bierze się wyłącznie z wraków przywiezionych przez
// gracza. Liczenie ich jako głodu kazałoby ścigać bilans, którego z założenia
// nie da się domknąć samą logistyką NPC.
const obtainable = new Set();
for (const recipe of Object.values(RECIPES)) for (const id of Object.keys(recipe.out)) obtainable.add(id);
for (const entry of Object.values(PLANET_YIELD)) {
  if (entry.rate > 0) for (const id of Object.keys(entry.yields)) obtainable.add(id);
}
for (const field of network.fields) for (const id of Object.keys(field.yields || {})) obtainable.add(id);
const unsourced = RESOURCE_KEYS.filter(id => !obtainable.has(id));

console.log('\n=== FIRMY TRANSPORTOWE ===\n');
console.log('  firma                polityka      kapitał   flota  stoi  kursy  puste  utarg');
for (const row of summarizeCompanies(companies)) {
  console.log(`  ${row.name.padEnd(20)} ${row.policy.padEnd(12)} `
    + `${String(row.capital).padStart(8)}  ${String(row.ships).padStart(5)} `
    + `${String(row.parked).padStart(5)} ${String(row.trips).padStart(6)} `
    + `${String(row.deadheads).padStart(6)} ${String(row.revenue).padStart(7)}`);
}
console.log(`\n  puste przeloty razem: ${snap.stats.deadheads}, `
  + `odmowy z braku jednostki: ${snap.stats.noShip}`);

console.log('\n=== PRZYDUSZENIE (dlugi glod = wyzsza cena) ===\n');
{
  const rows = [];
  for (const st of stations) {
    const econ = economies.get(st.id);
    if (!econ?.duress) continue;
    for (const [id, sek] of Object.entries(econ.duress)) {
      if (sek < 60) continue;
      const cena = resourcePrice(st, econ, id);
      if (!cena) continue;
      rows.push({ stacja: st.id, surowiec: RESOURCES[id].short, minut: Math.round(sek / 60),
        mnoznik: cena.duress, cena: cena.bid, baza: RESOURCES[id].value });
    }
  }
  rows.sort((a, b) => b.minut - a.minut);
  console.log(`  pozycji przyduszonych: ${rows.length}`);
  for (const r of rows.slice(0, 8)) {
    console.log(`  ${r.stacja.padEnd(11)} ${r.surowiec.padEnd(5)} glod ${String(r.minut).padStart(4)} min  `
      + `x${r.mnoznik.toFixed(2)} przyduszenia  skup ${r.cena.toFixed(1)} CR (baza ${r.baza})`);
  }
}

console.log('\n=== KSIEZYCE ===\n');
{
  // Ile kursów w ogóle DOTKNĘŁO księżyców — bez tego nie wiadomo, czy są
  // częścią gospodarki, czy tylko dekoracją z magazynem.
  const idKsiezycow = new Set(network.stations.filter(n => n.moon).map(n => n.id));
  let zNich = 0, doNich = 0;
  for (const order of fleet.orders) {
    if (idKsiezycow.has(order.sourceStationId)) zNich++;
    if (idKsiezycow.has(order.targetStationId)) doNich++;
  }
  console.log(`  zlecen Z ksiezycow: ${zNich}, DO ksiezycow: ${doNich}, `
    + `wszystkich zlecen: ${fleet.orders.length}`);
}
{
  const ksiezyce = network.stations.filter(n => n.moon);
  for (const node of ksiezyce) {
    const econ = economies.get(node.id);
    const st = stations.find(s => s.id === node.id);
    if (!econ) { console.log(`  ${node.id.padEnd(11)} - brak gospodarki`); continue; }
    const top = Object.entries(econ.resources)
      .filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${RESOURCES[k].short} ${Math.round(v)}`).join(' ');
    console.log(`  ${node.id.padEnd(11)} ${String(node.role).padEnd(6)} `
      + `${String(st?.factionId || 'niczyj').padEnd(18)} ${top || '(pusto)'}`);
  }
}

console.log('\n=== OBŁOŻENIE DOKÓW ===\n');
for (const [stationId, layout] of docks) {
  const occupancy = berthOccupancy(layout);
  const queued = director.portQueue.get(String(stationId)) || 0;
  const detail = Object.entries(occupancy.byClass)
    .map(([cls, entry]) => `${cls}:${entry.taken}/${entry.total}`).join(' ');
  console.log(`  ${stationId.padEnd(9)} ${layout.docks.length} doki, `
    + `${String(occupancy.taken).padStart(2)}/${occupancy.total} zajętych, `
    + `kolejka ${String(queued).padStart(3)}   ${detail}`
    + `${layout.hasRing ? '   (przy pierścieniu)' : ''}`);
}

console.log('\n=== CZY KTOŚ GŁODUJE ===\n');
let starving = 0;
for (const station of stations) {
  const econ = economies.get(station.id);
  if (!econ || !station.factionId) continue;
  const deficits = getStationDeficits(station, econ, 4);
  const critical = deficits.filter(d => d.fill < 0.05 && obtainable.has(d.id));
  if (critical.length) starving++;
  const text = deficits.length
    ? deficits.map(d => `${RESOURCES[d.id].short} ${(d.fill * 100).toFixed(0)}%`
      + (obtainable.has(d.id) ? '' : '*')).join('  ')
    : '— pełne magazyny';
  console.log(`  ${station.id.padEnd(9)} ${critical.length ? 'GŁÓD  ' : '      '} ${text}`);
}

const active = stations.filter(s => s.factionId).length;
console.log(`\n  * = surowiec spoza przemysłu (${unsourced.map(id => RESOURCES[id].label).join(', ')}) `
  + '— brak z założenia, dostarcza go gracz');
console.log(`  stacji na skraju: ${starving} z ${active}`);
console.log(`  ${starving === 0
  ? 'BILANS SIĘ DOMYKA'
  : 'BILANS NIE DOMYKA SIĘ — brakuje przepustowości albo trasy'}\n`);

// Najczęstszy przypadek diagnostyczny: surowce z Merkurego zasilające Ziemię.
// Sam stan końcowy potrafi akurat wypaść tuż przed dostawą, więc obok zapasu
// pokazujemy również rzeczywisty dowóz z ostatniej godziny i towar w drodze.
console.log('=== ZIEMIA ↔ MERKURY ===\n');
const earthEcon = economies.get('earth');
const mercuryEcon = economies.get('mercury');
for (const resourceId of ['iron_ore', 'silicon_ore']) {
  const deliveredLastHour = fleet.orders
    .filter(order => order.targetStationId === 'earth'
      && order.deliveredAt >= registry.clock - 3600)
    .reduce((sum, order) => sum + (Number(order.plannedManifest?.[resourceId]) || 0), 0);
  const inbound = registry.active
    .filter(course => course.destinationId === 'earth'
      && course.payload?.resourceId === resourceId)
    .reduce((sum, course) => sum + (Number(course.payload?.units) || 0), 0);
  const earthStock = Number(earthEcon?.resources?.[resourceId]) || 0;
  const earthCap = Number(earthEcon?.capacity?.[resourceId]) || 0;
  const mercuryStock = Number(mercuryEcon?.resources?.[resourceId]) || 0;
  const mercuryCap = Number(mercuryEcon?.capacity?.[resourceId]) || 0;
  console.log(`  ${RESOURCES[resourceId].short.padEnd(3)} Ziemia `
    + `${Math.round(earthStock).toLocaleString('pl')}/${Math.round(earthCap).toLocaleString('pl')} `
    + `(${(earthStock / Math.max(1, earthCap) * 100).toFixed(1)}%), `
    + `dowóz 60m ${Math.round(deliveredLastHour).toLocaleString('pl')}, `
    + `w drodze ${Math.round(inbound).toLocaleString('pl')} · Merkury `
    + `${Math.round(mercuryStock).toLocaleString('pl')}/${Math.round(mercuryCap).toLocaleString('pl')} `
    + `(${(mercuryStock / Math.max(1, mercuryCap) * 100).toFixed(1)}%)`);
}
console.log('');

if (director.log.length) {
  console.log('=== OSTATNIE ZDARZENIA ===\n');
  for (const entry of director.log.slice(-12)) {
    console.log(`  ${String(Math.round(entry.at / 60)).padStart(4)}m  ${entry.text}`);
  }
  console.log('');
}
