/**
 * ANALIZA RUCHU — ile transportu naprawdę potrzebuje ekonomia i jak daleko ma lecieć.
 *
 * Brief `docs/BRIEF-ruch-v2.md` stawia dwa pytania wprost jako „do rozstrzygnięcia
 * pomiarem, nie dyskusją": ile statków oraz jaka jest realna geometria świata.
 * Ten skrypt odpowiada na oba, licząc z tych samych modułów, z których korzysta gra —
 * dzięki temu odpowiedź nie starzeje się razem z przepisaną stałą.
 *
 *   node scripts/analiza-ruchu.mjs
 *
 * Wynik: bilans stacji, kierunki ruchu, podział masówka/drobnica, skala świata
 * i czasy przelotu na trzech napędach.
 */

import { RESOURCES, RECIPES, PLANET_YIELD, getResourceMass } from '../src/data/resources.js';
import { STATION_INDUSTRY, STATION_UPKEEP, ECONOMY_CYCLE_SECONDS, lineWeight, upkeepScale } from '../src/game/stationEconomy.js';
import { VAN_CLASSES } from '../src/game/cargoFleet.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { buildSystemMap, SYSTEM_MAP_CONSTANTS } from '../src/data/systemMap.js';

const H = 3600;
const fmt = (n, d = 2) => (Math.abs(n) < 0.0005 ? '0' : n.toFixed(d));

// ============================================================
// 1. BILANS — ile czego brakuje i gdzie
// ============================================================

/** Wydobycie: `EXTRACTION_PER_CYCLE * rate * cycles`, rozdzielone wg udziałów. */
const EXTRACTION_PER_CYCLE = 9;

/** Neptun pominięty celowo: bez frakcji, `isDerelict` → zakłady nie chodzą. */
// Czytane z konfiguracji, nie wpisane z ręki — inaczej dołożenie stacji
// jest niewidoczne dla pomiaru i bilans mierzy nie ten układ, co działa.
const STATIONS = Object.keys(STATION_INDUSTRY).filter(id => STATION_INDUSTRY[id].capacity > 0);

/**
 * Przepływ netto stacji w sztukach na sekundę. Dodatnie = zostaje na eksport.
 * Liczone przy zakładach chodzących na pełnej przepustowości — czyli to jest
 * zapotrzebowanie na transport przy założeniu, że nic nie stoi z braku wsadu.
 */
function stationNetFlow(id) {
  const industry = STATION_INDUSTRY[id];
  const net = {};
  const add = (res, rate) => { net[res] = (net[res] || 0) + rate; };

  const yieldDef = PLANET_YIELD[id];
  if (yieldDef && yieldDef.rate > 0) {
    const total = EXTRACTION_PER_CYCLE * yieldDef.rate / ECONOMY_CYCLE_SECONDS;
    const sum = Object.values(yieldDef.yields).reduce((a, b) => a + b, 0) || 1;
    for (const [res, share] of Object.entries(yieldDef.yields)) add(res, total * share / sum);
  }

  for (const recipeId of industry.recipes) {
    const recipe = RECIPES[recipeId];
    const batchesPerSecond = lineWeight(industry, recipeId) / recipe.seconds;
    for (const [res, need] of Object.entries(recipe.in)) add(res, -need * batchesPerSecond);
    for (const [res, out] of Object.entries(recipe.out)) add(res, out * batchesPerSecond);
  }

  const scale = upkeepScale(industry) / ECONOMY_CYCLE_SECONDS;
  for (const [res, perCycle] of Object.entries(STATION_UPKEEP)) add(res, -perCycle * scale);

  return net;
}

const flows = new Map(STATIONS.map(id => [id, stationNetFlow(id)]));

console.log('\n=== BILANS STACJI (szt/h, dodatnie = na eksport) ===\n');
let importMassPerHour = 0;
let exportMassPerHour = 0;
const systemNet = {};

for (const id of STATIONS) {
  const surplus = [];
  const deficit = [];
  for (const [res, rate] of Object.entries(flows.get(id))) {
    if (Math.abs(rate) * H < 0.05) continue;
    systemNet[res] = (systemNet[res] || 0) + rate;
    const row = `${RESOURCES[res].label} ${fmt(rate * H)}`;
    if (rate > 0) { surplus.push(row); exportMassPerHour += getResourceMass(res, rate * H); }
    else { deficit.push(row); importMassPerHour += getResourceMass(res, -rate * H); }
  }
  console.log(`${id.toUpperCase().padEnd(8)} moc ${STATION_INDUSTRY[id].capacity} — ${(STATION_INDUSTRY[id].roles || []).join(', ') || 'brak'}`);
  console.log(`  oddaje:     ${surplus.join(' | ') || '—'}`);
  console.log(`  potrzebuje: ${deficit.join(' | ') || '—'}\n`);
}

// ============================================================
// 2. KIERUNKI — dopasowanie nadwyżka → niedobór
// ============================================================

// Greedy, od największego niedoboru. Nie jest to przydział optymalny, ale pokazuje,
// gdzie geometrycznie leży ruch — a to jest pytanie, o które chodzi.
const pairFlow = new Map();
const routeRows = [];

for (const res of new Set(STATIONS.flatMap(id => Object.keys(flows.get(id))))) {
  const sellers = [];
  const buyers = [];
  for (const id of STATIONS) {
    const rate = (flows.get(id)[res] || 0) * H;
    if (rate > 0.05) sellers.push({ id, left: rate });
    else if (rate < -0.05) buyers.push({ id, need: -rate });
  }
  buyers.sort((a, b) => b.need - a.need);
  sellers.sort((a, b) => b.left - a.left);
  for (const buyer of buyers) {
    for (const seller of sellers) {
      if (buyer.need <= 0.05) break;
      if (seller.left <= 0.05) continue;
      const units = Math.min(buyer.need, seller.left);
      buyer.need -= units;
      seller.left -= units;
      const key = `${seller.id} → ${buyer.id}`;
      const mass = getResourceMass(res, units);
      pairFlow.set(key, (pairFlow.get(key) || 0) + mass);
      routeRows.push({ key, res, units, mass });
    }
  }
}

console.log('=== GDZIE LEŻY RUCH (t/h na kierunku) ===\n');
const ranked = [...pairFlow.entries()].sort((a, b) => b[1] - a[1]);
const totalPaired = ranked.reduce((sum, [, mass]) => sum + mass, 0);
let cumulative = 0;
for (const [key, mass] of ranked.slice(0, 12)) {
  cumulative += mass;
  const top = routeRows.filter(r => r.key === key).sort((a, b) => b.mass - a.mass)
    .slice(0, 3).map(r => RESOURCES[r.res].label).join(', ');
  console.log(`  ${key.padEnd(20)} ${mass.toFixed(0).padStart(5)} t/h  `
    + `${(mass / totalPaired * 100).toFixed(1).padStart(5)}%  `
    + `narast. ${(cumulative / totalPaired * 100).toFixed(0).padStart(3)}%   ${top}`);
}
console.log(`  ${''.padEnd(20)} ${totalPaired.toFixed(0).padStart(5)} t/h razem, ${ranked.length} kierunków\n`);

// ============================================================
// 3. CO JEST ŁUPEM — masówka vs drobnica
// ============================================================

// Próg 40 CR/t rozdziela to, co opłaca się wieźć warpem, od tego, co poleci
// konwencjonalnie i jest bezbronne. Patrz model podróży w SPEC-ekonomia.
const CHEAP_PER_TON = 40;
let bulkMass = 0, bulkValue = 0, fineMass = 0, fineValue = 0;
for (const { res, units, mass } of routeRows) {
  const value = RESOURCES[res].value * units;
  if (value / Math.max(mass, 1e-9) < CHEAP_PER_TON) { bulkMass += mass; bulkValue += value; }
  else { fineMass += mass; fineValue += value; }
}
console.log(`=== MASÓWKA vs DROBNICA (próg ${CHEAP_PER_TON} CR/t) ===\n`);
console.log(`  masówka:  ${bulkMass.toFixed(0).padStart(5)} t/h  ${bulkValue.toFixed(0).padStart(7)} CR/h`
  + `  = ${(bulkValue / bulkMass).toFixed(0).padStart(3)} CR/t   → konwencjonalnie, łup piratów`);
console.log(`  drobnica: ${fineMass.toFixed(0).padStart(5)} t/h  ${fineValue.toFixed(0).padStart(7)} CR/h`
  + `  = ${(fineValue / fineMass).toFixed(0).padStart(3)} CR/t   → stać ją na warp, nietykalna`);
console.log(`  masówka to ${(bulkMass / (bulkMass + fineMass) * 100).toFixed(0)}% tonażu, `
  + `ale ${(bulkValue / (bulkValue + fineValue) * 100).toFixed(0)}% wartości\n`);

console.log('=== SUROWCE BEZ PRODUCENTA (spoza przemysłu stacji) ===\n');
for (const [res, rate] of Object.entries(systemNet)) {
  if (rate * H >= -0.05) continue;
  const madeSomewhere = Object.values(RECIPES).some(r => r.out[res] > 0)
    || Object.values(PLANET_YIELD).some(p => p.rate > 0 && p.yields[res] > 0);
  if (madeSomewhere) continue;
  console.log(`  ${RESOURCES[res].label.padEnd(12)} deficyt ${fmt(-rate * H)} szt/h `
    + `(${getResourceMass(res, -rate * H).toFixed(0)} t/h) — żadna stacja tego nie robi`);
}

// ============================================================
// 4. SKALA ŚWIATA — odtworzenie makeSolarPlanets()
// ============================================================

// Geometria pochodzi z tego samego modułu, z którego korzysta gra — dzięki temu
// przestawienie orbit albo pasów od razu przelicza cały poniższy raport.
const beltEdgeAu = getOutermostBeltEdgeAu(BELT_DEFINITIONS);
const { auInWorldUnits: AU, planets: orbits } = buildSystemMap(beltEdgeAu, { angleFor: () => 0 });
const orbitById = Object.fromEntries(orbits.map(o => [o.id, o.orbitRadius]));
const outerRadiusAU = Math.max(...orbits.map(o => o.orbitAU), beltEdgeAu)
  + SYSTEM_MAP_CONSTANTS.safetyMarginAu;

console.log('\n=== SKALA ŚWIATA (src/data/systemMap.js) ===\n');
console.log(`  krawędź pasa Kuipera:  ${beltEdgeAu} AU mapy`);
console.log(`  AU OBOWIĄZUJĄCE:       ${AU.toFixed(2)} j./AU\n`);
for (const o of orbits) {
  console.log(`  ${o.id.padEnd(9)} ${(o.orbitRadius / 1000).toFixed(0).padStart(5)} tys. j.`
    + `   (${o.orbitAU} AU mapy)`);
}
const belt = BELT_DEFINITIONS.find(b => b.id === 'main');
console.log(`  ${'pas główny'.padEnd(9)} ${(belt.innerAU * AU / 1000).toFixed(0)}–`
  + `${(belt.outerAU * AU / 1000).toFixed(0)} tys. j.   (${belt.innerAU}–${belt.outerAU} AU mapy)`);
console.log(`\n  średnica świata: ${(outerRadiusAU * AU * 2 / 1e6).toFixed(1)} mln j.`);

// ============================================================
// 5. ILE STATKÓW I JAK DŁUGO LECĄ
// ============================================================

const movablePerHour = Math.min(importMassPerHour, exportMassPerHour);
console.log('\n=== POPYT TRANSPORTOWY ===\n');
console.log(`  import ${importMassPerHour.toFixed(0)} t/h, eksport ${exportMassPerHour.toFixed(0)} t/h`
  + ` → do przewiezienia ${movablePerHour.toFixed(0)} t/h\n`);
for (const cls of VAN_CLASSES) {
  console.log(`  ${cls.id.padEnd(7)} ${String(cls.capacity).padStart(3)} t → `
    + `${(movablePerHour / cls.capacity).toFixed(1).padStart(5)} kursów/h`);
}

// Kąty orbitalne gra losuje przy każdym starcie, więc dystans pary jest zmienną
// losową. Kąt prosty to przypadek typowy: hipotenuza promieni orbit.
const typical = (a, b) => Math.hypot(orbitById[a], orbitById[b]);
const DRIVES = [
  { name: 'konwencjonalny', speed: 800 },
  { name: 'warp', speed: 20000 }
];

console.log('\n=== CZASY PRZELOTU (kąt prosty = przypadek typowy) ===\n');
const kuiper = BELT_DEFINITIONS.find(b => b.id === 'kuiper');
const kuiperMidAu = (kuiper.innerAU + kuiper.outerAU) / 2;
const LEGS = [
  ['Merkury→Ziemia (36% tonażu)', typical('mercury', 'earth')],
  ['Wenus→Ziemia (22%)', typical('venus', 'earth')],
  ['Ziemia→Mars (12%)', typical('earth', 'mars')],
  ['Ziemia→pas główny', Math.abs((belt.innerAU + belt.outerAU) / 2 * AU - orbitById.earth)],
  ['Ziemia→Jowisz', typical('earth', 'jupiter')],
  ['Uran→Kuiper (ruda uranu)', Math.abs(kuiperMidAu * AU - orbitById.uranus)]
];
for (const [label, dist] of LEGS) {
  const parts = DRIVES.map(d => `${d.name} ${(dist / d.speed / 60).toFixed(1)} min`);
  console.log(`  ${label.padEnd(28)} ${(dist / 1e6).toFixed(2).padStart(5)} mln j.   ${parts.join('   ')}`);
}

console.log('\n=== ILE REKORDÓW JEDNOCZEŚNIE W LOCIE ===\n');
const hauler = VAN_CLASSES.find(c => c.id === 'hauler');
const coursesPerHour = movablePerHour / hauler.capacity;
for (const [label, dist] of LEGS.slice(0, 3)) {
  for (const drive of DRIVES) {
    const inFlight = coursesPerHour * (dist / drive.speed) / H;
    console.log(`  ${label.padEnd(28)} ${drive.name.padEnd(15)} ${inFlight.toFixed(1).padStart(5)} haulerów`);
  }
}
console.log(`\n  (przy ${coursesPerHour.toFixed(1)} kursach/h haulerem — całość ruchu, nie jedna trasa)\n`);
