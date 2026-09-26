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
 *   SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60   gospodarka ×60, powtarzalnie
 */

import { RESOURCES, RESOURCE_KEYS, RECIPES, PLANET_YIELD } from '../src/data/resources.js';
import { getStationDeficits, resourcePrice } from '../src/game/stationEconomy.js';
import { directorSnapshot } from '../src/game/traffic/trafficDirector.js';
import { summarizeWar } from '../src/game/traffic/warDispatcher.js';
import { summarizeScrappers } from '../src/game/traffic/scrapperFleets.js';
import { summarizePiracy } from '../src/game/traffic/piracy.js';
import { berthOccupancy } from '../src/game/traffic/dockLayout.js';
import { summarizeCompanies } from '../src/game/traffic/transportCompanies.js';
import { summarizeShipyards } from '../src/game/traffic/shipyards.js';
import { summarizeAgents } from '../src/game/traffic/agentFleets.js';
import { buildTrafficWorld, stepTrafficWorld, TRAFFIC_STEP_SECONDS } from '../src/game/traffic/trafficWorld.js';

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
/**
 * Ziarno losowania (`SEED=7 node scripts/symulacja-ruchu.mjs …`). Bez niego
 * przebieg jest za każdym razem inny; z nim — ten sam, więc da się porównać
 * dwie wersje kodu albo dwa scenariusze liczba w liczbę.
 */
const SEED = process.env.SEED !== undefined && process.env.SEED !== '' ? Number(process.env.SEED) : undefined;
const STEP = TRAFFIC_STEP_SECONDS;   // sekund gry na krok — dość drobno, żeby postoje nie ginęły

// ---------- świat ----------
// Cała budowa — sieć, stacje, doki, przewoźnicy, kupcy, stocznie, wojna,
// złomiarze, piractwo i dyspozytor — żyje w `trafficWorld.js`. Ten sam moduł
// buduje świat dema i workera gry, więc konsola, ekran i gra liczą jedno.
const world = buildTrafficWorld({
  economyScale: ECONOMY_SCALE,
  capacityMultiplier: CAPACITY_MUL,
  piracyPressure: PRESSURE,
  piracyEnabled: PRESSURE > 0,
  seed: SEED
});
const {
  network, stations, economies, docks, companies, agents,
  shipyards, war, scrappers, piracy, registry, fleet, director
} = world;
const companyList = world.carriers;
const totalShips = world.carrierShips;

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
  // Dyspozytor, stocznie, wojna, piractwo, złomiarze — w tej kolejności.
  stepTrafficWorld(world, STEP);
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
