// Liczby mapy gwiezdnej (src/game/sector/): sektor z ziarna, odległości, czasy lotu, paliwo, koszt kroku flot.
//
//   node scripts/mapa-gwiezdna-liczby.mjs [--seed 1] [--ziarna 1,2,3,7,42] [--sekundy 600]
//
// Koszt kroku flot mierzy czas ściany w Node (informacyjnie — testy go nie mierzą): mediana z 5 przebiegów
// po rozbiegu JIT.
import {
  generateSector, sectorSummary, lanePath, createFleets, advanceFleets, SECTOR_FLIGHT, FLEET_TICK, ZONE
} from '../src/game/sector/index.js';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const seed = Number(arg('seed', 1));
const seeds = String(arg('ziarna', '1,2,3,7,42')).split(',').map(Number);
const seconds = Number(arg('sekundy', 600));

const t0 = performance.now();
const sector = generateSector({ seed });
const genMs = performance.now() - t0;
const sum = sectorSummary(sector);
const F = SECTOR_FLIGHT;
const S = sector.systems;
const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const sol = sector.byId.get('sol');
const coreSpan = Math.max(...sector.core.map((i) => S[i].distSol));
const far = S.reduce((m, s) => Math.max(m, s.distSol), 0);
const pirates = sector.pirateBases.map((i) => S[i].distSol).sort((a, b) => a - b);
// Trasy konwojów po szlakach: długość i liczba przeskoków (wszystkie pary rdzenia).
let maxHops = 0;
let maxLen = 0;
for (const a of sector.core) {
  for (const b of sector.core) {
    if (a === b) continue;
    const p = lanePath(sector, a, b);
    let len = 0;
    for (let k = 1; k < p.length; k++) len += dist(S[p[k - 1]], S[p[k]]);
    maxHops = Math.max(maxHops, p.length - 1);
    maxLen = Math.max(maxLen, len);
  }
}
const time = (ly) => ly / F.cruise;
console.log(`Sektor ${seed}: generacja ${genMs.toFixed(1)} ms`);
console.log(JSON.stringify(sum));
console.log(`Rdzeń: promień ${coreSpan.toFixed(1)} ly (najdalszy nazwany / proceduralny), szlaki ${sector.lanes.length}, najdłuższa trasa konwoju ${maxLen.toFixed(1)} ly / ${maxHops} przeskoków`);
console.log(`Najdalszy układ od Słońca: ${far.toFixed(1)} ly; kryjówki piratów ${pirates.map((d) => d.toFixed(0)).join(', ')} ly od Słońca`);
console.log(`Lot (przelot ${F.cruise} ly/s, nurt ×${F.burnMul}): sąsiad mediana ${sum.nnMedian} ly = ${time(sum.nnMedian).toFixed(0)} s, p90 ${sum.nnP90} ly = ${time(sum.nnP90).toFixed(0)} s;`
  + ` Słońce → Alfa Centauri ${dist(sol, sector.byId.get('alfa-centauri')).toFixed(2)} ly = ${time(4.37).toFixed(0)} s; przez rdzeń (2 × ${coreSpan.toFixed(0)} ly) ${(time(2 * coreSpan) / 60).toFixed(1)} min;`
  + ` cały sektor (${sector.bounds.x1 - sector.bounds.x0} ly) ${(time(sector.bounds.x1 - sector.bounds.x0) / 60).toFixed(1)} min`);
console.log(`Paliwo: bak ${F.fuelMax}, ${F.fuelPerLy}/ly → zasięg ${(F.fuelMax / F.fuelPerLy).toFixed(0)} ly (nurt ${(F.fuelMax / F.fuelPerLy / F.burnFuelMul).toFixed(0)} ly); studnia układu ${ZONE.jumpRadius} ly`);

// Floty: rozbieg JIT, potem 5 przebiegów po `seconds`.
const runs = [];
let st = null;
for (let r = 0; r < 6; r++) {
  st = createFleets(sector);
  const a = performance.now();
  const ticks = advanceFleets(st, sector, seconds);
  const ms = performance.now() - a;
  if (r > 0) runs.push(ms / ticks * 1000);
}
runs.sort((a, b) => a - b);
const kinds = {};
for (const f of st.fleets) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
const types = {};
for (const e of st.events) types[e.type] = (types[e.type] || 0) + 1;
console.log(`Floty: ${st.fleets.length} (${JSON.stringify(kinds)}), krok ${FLEET_TICK} s: mediana ${runs[2].toFixed(1)} µs/krok`
  + ` (${(runs[2] / FLEET_TICK / 1000).toFixed(3)} ms na sekundę gry); zdarzenia w ostatnich ${st.opts.eventCap}: ${JSON.stringify(types)}`);

console.log('\nZiarna:');
for (const s of seeds) {
  const q = sectorSummary(generateSector({ seed: s }));
  console.log(`  ${String(s).padStart(3)}: rdzeń ${q.core}, pogranicze ${q.frontier}, planety ${q.planets}, podwójne ${q.binaries}, mgławice ${q.nebulae}, burze ${q.storms}, szlaki ${q.lanes}, sąsiad mediana ${q.nnMedian} ly, p90 ${q.nnP90}, max ${q.nnMax}`);
}
