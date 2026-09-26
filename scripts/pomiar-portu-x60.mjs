// Pomiar portów K-7 (Ziemia, Mars) przy gospodarce ×N — zajętość stanowisk,
// kolejka, parking (jednostki bez zlecenia), ruch w promieniu planety.
// Na bazie scripts/symulacja-ruchu.mjs (ten sam świat) + próbkowanie portów.
//
//   node scripts/pomiar-portu-x60.mjs MINUTES PRESSURE CAPACITY_MUL SCALE   (np. 360 1 4 60)
//   env: WATCH="earth,mars"  — obserwowane porty (np. mercury,venus,saturn,uranus,ceres,vesta)
//        DROP="earth:K7-1,earth:Z-01"  — zabiera doki (stocznia/wojsko w ich miejscu)
//        SPREAD=1   — stanowiska na przemian z doków (bez tego hala K7-1 zbiera wszystko)
//        FIXIDS=1   — (zbędne od naprawy addShip 2026-09-26) symulacja poprawki kolizji id
//        FLEET_MUL=0.7, SEED=7 (powtarzalny Math.random), NOSAMPLE=1 (czysty koszt ticku)
//        WARM=30 (min rozruchu), JSON=plik (zrzut wyników)
// Wyniki 2026-09-26: docs/PLAN-ruch-v2-w-grze.md § 2.
const R = new URL('../', import.meta.url).href;   // korzeń repo (skrypt leży w scripts/)
// SEED: powtarzalny Math.random (mulberry32) — scenariusze porównywalne między sobą
if (process.env.SEED) {
  let s = Number(process.env.SEED) >>> 0;
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const { RESOURCES, RESOURCE_KEYS, TIER, getResourceCapacityFactor } = await import(R + 'src/data/resources.js');
const { FACTION, getDefaultStationFaction } = await import(R + 'src/data/factions.js');
const { seedStationStock, systemHaulTonnage, resourcePrice, stationHaulTonnage, getStationIndustry, militaryScale } = await import(R + 'src/game/stationEconomy.js');
const { createFleetState } = await import(R + 'src/game/cargoFleet.js');
const { BELT_DEFINITIONS, getOutermostBeltEdgeAu } = await import(R + 'src/data/asteroidTypes.js');
const { buildTravelNetwork } = await import(R + 'src/game/traffic/travelNetwork.js');
const { createCourseRegistry, currentStage, STAGE_KIND, DWELL_REASON } = await import(R + 'src/game/traffic/courseRegistry.js');
const { createDirector, tickDirector, directorSnapshot, courseWorldPosition } = await import(R + 'src/game/traffic/trafficDirector.js');
const { patrolMultiplier } = await import(R + 'src/game/traffic/patrols.js');
const { createWarState, tickWar, declareAmmoDemand, summarizeWar } = await import(R + 'src/game/traffic/warDispatcher.js');
const { createScrapperState, tickScrappers } = await import(R + 'src/game/traffic/scrapperFleets.js');
const { createPiracyState, registerNest, tickPiracy } = await import(R + 'src/game/traffic/piracy.js');
const { buildStationDocks, suggestBerthMultiplier, berthFits } = await import(R + 'src/game/traffic/dockLayout.js');
const { createFleetRegistry, SHIP_STATE } = await import(R + 'src/game/traffic/transportCompanies.js');
const { buildCarriers, TONS_PER_SHIP_HOUR } = await import(R + 'src/game/traffic/carrierRoster.js');
const { createShipyardRegistry, registerShipyard, tickShipyards, summarizeShipyards, WARSHIP_CLASSES } = await import(R + 'src/game/traffic/shipyards.js');
const { createAgentRegistry, buildMerchants } = await import(R + 'src/game/traffic/agentFleets.js');
const { buildHaloPortTrafficLayout } = await import(R + 'src/3d/haloRing/haloPortTraffic.js');
const { createHaloRingLayout } = await import(R + 'src/3d/haloRing/haloRingLayout.js');

const MINUTES = Number(process.argv[2]) || 240;
const PRESSURE = process.argv[3] !== undefined ? Number(process.argv[3]) : 1;
const CAPACITY_MUL = process.argv[4] !== undefined ? Number(process.argv[4]) : 4;
const ECONOMY_SCALE = process.argv[5] !== undefined ? Number(process.argv[5]) : 60;
const WARM = (Number(process.env.WARM) || 30) * 60;
const STEP = 5;
const DROP = (process.env.DROP || '').split(',').map(s => s.trim()).filter(Boolean);

const beltEdgeAu = getOutermostBeltEdgeAu(BELT_DEFINITIONS);
const mainBelt = BELT_DEFINITIONS.find(b => b.id === 'main');
const kuiper = BELT_DEFINITIONS.find(b => b.id === 'kuiper');
const network = buildTravelNetwork({
  beltEdgeAu,
  angleFor: (_def, index) => index * 0.7,
  outposts: [
    { id: 'ceres', label: 'Ceres', orbitAU: 39.5, angle: 2.6, berths: 6 },
    { id: 'vesta', label: 'Westa', orbitAU: 44.0, angle: 5.1, berths: 4 },
    { id: 'gniazdo-hildy', label: 'Gniazdo Hildy', orbitAU: 52.0, angle: 0.9, berths: 3 },
    { id: 'zlomowisko', label: 'Zlomowisko', orbitAU: 68.0, angle: 3.8, berths: 3 }
  ],
  fields: [
    { id: 'belt-main', label: 'Pas Główny', orbitAU: (mainBelt.innerAU + mainBelt.outerAU) / 2, angle: 1.9,
      innerAU: mainBelt.innerAU, outerAU: mainBelt.outerAU, arcSpread: 0.85,
      yields: { iron_ore: 1, silicon_ore: 1, copper_ore: 1, titanium_ore: 1, raw_crystal: 1 }, extractionSeconds: 600 },
    { id: 'belt-kuiper', label: 'Pas Kuipera', orbitAU: (kuiper.innerAU + kuiper.outerAU) / 2, angle: 4.2,
      innerAU: kuiper.innerAU, outerAU: kuiper.outerAU, arcSpread: 0.7,
      yields: { uranium_ore: 1, ice: 1, raw_crystal: 1 }, extractionSeconds: 900 }
  ]
});

const CAPACITY_BY_TIER = { [TIER.RAW]: 250, [TIER.REFINED]: 150, [TIER.COMPONENT]: 60 };
const baseCapacity = Object.fromEntries(RESOURCE_KEYS.map(key =>
  [key, (CAPACITY_BY_TIER[RESOURCES[key].tier] ?? 100) * getResourceCapacityFactor(key) * CAPACITY_MUL * ECONOMY_SCALE]));
const PRZ = stationHaulTonnage();
const economies = new Map();
const stations = network.stations.map(node => {
  const station = { id: node.id, name: node.label, factionId: getDefaultStationFaction(node.id), x: node.x, y: node.y };
  const econ = { resources: Object.fromEntries(RESOURCE_KEYS.map(k => [k, 0])), capacity: { ...baseCapacity } };
  seedStationStock(station, econ, node.moon ? 0.18 : 0.45);
  economies.set(station.id, econ);
  return station;
});

// ---------- doki: Ziemia i Mars = port K-7 ringu Halo ----------
const K7 = { earth: 37800, mars: 30000 };
const RING_RADIUS = { earth: 37800, mars: 30000 };
const docks = new Map();
const dropped = {};
for (const node of network.stations) {
  if (node.derelict) continue;
  if (K7[node.id]) {
    const layout = buildHaloPortTrafficLayout(createHaloRingLayout({ planetRadius: K7[node.id] }), { id: node.id, x: node.x, y: node.y });
    const drops = DROP.filter(d => d.startsWith(node.id + ':')).map(d => d.slice(node.id.length + 1));
    if (drops.length) {
      const keep = layout.docks.filter(d => !drops.some(s => d.id.endsWith(':' + s)));
      dropped[node.id] = layout.docks.filter(d => !keep.includes(d)).map(d => d.id);
      layout.docks = keep;
      layout.berths = keep.flatMap(d => d.berths);
    }
    // SPREAD=1: kolejność stanowisk na przemian z doków (findBerth bierze
    // pierwsze z najniższym kosztem → bez tego pierwsza hala zbiera wszystko)
    if (process.env.SPREAD) {
      const per = layout.docks.map(d => d.berths.slice());
      const order = [];
      for (let i = 0; per.some(p => p.length); i++) for (const p of per) if (p.length) order.push(p.shift());
      layout.berths = order;
    }
    docks.set(node.id, layout);
    continue;
  }
  docks.set(node.id, buildStationDocks(
    { id: node.id, x: node.x, y: node.y, r: 120, ringWorldRadius: RING_RADIUS[node.id] || 0 },
    { berthMultiplier: suggestBerthMultiplier(PRZ[node.id], ECONOMY_SCALE) }));
}

const companies = createFleetRegistry();
const homePorts = stations.filter(s => s.factionId && s.factionId !== FACTION.PIRATES).map(s => s.id);
const { companies: companyList, ships: totalShips } = buildCarriers(companies, homePorts, ECONOMY_SCALE,
  { factionOf: getDefaultStationFaction, shipsPerScale: systemHaulTonnage() / TONS_PER_SHIP_HOUR * (Number(process.env.FLEET_MUL) || 1) });
// FIXIDS=1: symulacja poprawki kolizji id w addShip (odkup po stracie dostawał
// id istniejącego statku → nadpisanie w shipsById → stary statek BUSY na zawsze)
if (process.env.FIXIDS) {
  let seq = 0;
  for (const company of companies.companies) {
    const arr = company.ships;
    arr.push = function (...items) {
      for (const ship of items) {
        if (ship && this.some(s => s.id === ship.id)) ship.id = `${company.id}-r${++seq}`;
      }
      return Array.prototype.push.apply(this, items);
    };
  }
}
const agents = createAgentRegistry();
buildMerchants(agents, homePorts, ECONOMY_SCALE);
const shipyards = createShipyardRegistry();
const YARD_WEIGHT = { mars: 2.0, earth: 1.2, jupiter: 1.1, ceres: 1.0, venus: 0.8, mercury: 0.6, saturn: 0.6, uranus: 0.5, vesta: 0.4 };
for (const station of stations) {
  if (!station.factionId) continue;
  if (militaryScale(getStationIndustry(station)) <= 0) continue;
  registerShipyard(shipyards, { station, stationId: station.id, factionId: station.factionId,
    weight: (YARD_WEIGHT[station.id] || 0.6) * Math.sqrt(ECONOMY_SCALE) });
}
const war = createWarState();
declareAmmoDemand(stations);
const scrappers = createScrapperState();
const piracy = createPiracyState();
for (const s of stations) if (s.factionId === 'pirates') registerNest(piracy, s);
const registry = createCourseRegistry({ keepHistory: false });
const fleet = createFleetState();
const director = createDirector(network, registry, {
  fleet, companies, docks, agents,
  getEconomy: id => economies.get(String(id)) || null,
  piracyPressure: PRESSURE, piracyEnabled: PRESSURE > 0, economyScale: ECONOMY_SCALE, piracy,
  targetFleetPerCompany: Math.max(4, Math.round(totalShips / Math.max(1, companyList.length)))
});

// ---------- próbkowanie ----------
const CLS = ['s', 'm', 'l', 'capital', 'mega'];
const PROBE_HULLS = { atlas: 'atlas', heavy_freighter: 'heavy_freighter', long_haul_freighter: 'long_haul_freighter',
  container_ship: 'container_ship', inter_station_shuttle: 'inter_station_shuttle', megafreighter: 'megafreighter' };
const RADII = [60000, 100000, 150000, 260000];
// porty bez doków (np. opuszczony Neptun) pomijamy — nie mają czego mierzyć
const WATCH = (process.env.WATCH || 'earth,mars').split(',').map(s => s.trim()).filter(id => id && docks.has(id));
const acc = {};
for (const id of WATCH) {
  acc[id] = {
    occ: Object.fromEntries(CLS.map(k => [k, []])), total: [], queue: [], parked: [], parkedBy: {},
    complex: {}, fitFree: Object.fromEntries(Object.keys(PROBE_HULLS).map(h => [h, []])),
    near: Object.fromEntries(RADII.map(r => [r, { moving: [], berthed: [], queued: [] }])),
    arrivals: Object.fromEntries(CLS.map(k => [k, 0])), arrivalsHull: {}, dwell: [], berthState: new Map()
  };
}
const pct = (arr, p) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
let nSamples = 0;
function sample(now) {
  nSamples++;
  // parking: jednostki PARKED wg stacji
  const parkedAt = {};
  const parkedByAt = {};
  for (const c of companies.companies) for (const ship of c.ships) {
    if (ship.state !== SHIP_STATE.PARKED) continue;
    parkedAt[ship.stationId] = (parkedAt[ship.stationId] || 0) + 1;
    const b = parkedByAt[ship.stationId] || (parkedByAt[ship.stationId] = {});
    b[ship.vanClassId] = (b[ship.vanClassId] || 0) + 1;
  }
  for (const id of WATCH) {
    const a = acc[id];
    const layout = docks.get(id);
    const node = network.nodes.get(id);
    const occ = Object.fromEntries(CLS.map(k => [k, 0]));
    const byComplex = {};
    let total = 0;
    for (const b of layout.berths) {
      const key = `${b.complex}:${b.hall}`;
      byComplex[key] = byComplex[key] || { taken: 0, total: 0 };
      byComplex[key].total++;
      // czas postoju + przyjazdy
      const prev = a.berthState.get(b.id);
      if (!prev || prev.occ !== b.occupantId) {
        if (prev && prev.occ) a.dwell.push(now - prev.since);
        if (b.occupantId) {
          a.arrivals[b.cls]++;
          const c = registry.byId.get(b.occupantId);
          const h = c?.unitClass || '?';
          a.arrivalsHull[h] = (a.arrivalsHull[h] || 0) + 1;
          // kierunek wejścia do portu (punkt manewrowy etapu postoju) → najbliższy kompleks K-7
          const st = c ? currentStage(c) : null;
          const ep = st?.entryPos;
          if (ep) {
            const ang = Math.atan2(ep.y - node.y, ep.x - node.x);
            let best = -1, bestD = Infinity;
            for (const d of layout.docks) {
              if (!d.id.includes(':K7-')) continue;
              const da = Math.abs(Math.atan2(Math.sin(Math.atan2(d.y - node.y, d.x - node.x) - ang), Math.cos(Math.atan2(d.y - node.y, d.x - node.x) - ang)));
              if (da < bestD) { bestD = da; best = d.complex; }
            }
            a.entryComplex ||= {};
            a.entryComplex[best] = (a.entryComplex[best] || 0) + 1;
          }
        }
        a.berthState.set(b.id, { occ: b.occupantId, since: now });
      }
      if (!b.occupantId) continue;
      occ[b.cls]++; total++; byComplex[key].taken++;
    }
    for (const k of CLS) a.occ[k].push(occ[k]);
    a.total.push(total);
    for (const [key, v] of Object.entries(byComplex)) {
      a.complex[key] = a.complex[key] || { sum: 0, total: v.total, peak: 0 };
      a.complex[key].sum += v.taken; a.complex[key].peak = Math.max(a.complex[key].peak, v.taken);
    }
    for (const [h, hull] of Object.entries(PROBE_HULLS)) {
      let free = 0;
      for (const b of layout.berths) if (!b.occupantId && berthFits(b.cls, hull)) free++;
      a.fitFree[h].push(free);
    }
    a.queue.push(director.portQueue.get(id) || 0);
    a.parked.push(parkedAt[id] || 0);
    for (const [cls, n] of Object.entries(parkedByAt[id] || {})) {
      a.parkedBy[cls] = a.parkedBy[cls] || []; a.parkedBy[cls].push(n);
    }
    // ruch w promieniu
    const cnt = Object.fromEntries(RADII.map(r => [r, { moving: 0, berthed: 0, queued: 0 }]));
    for (const course of registry.active) {
      const p = courseWorldPosition(network, course);
      if (!p) continue;
      const d = Math.hypot(p.x - node.x, p.y - node.y);
      for (const r of RADII) {
        if (d > r) continue;
        if (course.blocked) cnt[r].queued++;
        else if (course.berthId && !p.moving) cnt[r].berthed++;
        else cnt[r].moving++;
      }
    }
    for (const r of RADII) for (const k of ['moving', 'berthed', 'queued']) a.near[r][k].push(cnt[r][k]);
    // wokół hali gracza (K-7 nr 1, kompleks 0): ile kursów w promieniu 15/30 tys.
    const hall = layout.docks.find(d => d.id.endsWith(':K7-1')) || layout.docks[0];
    let h15 = 0, h30 = 0;
    for (const course of registry.active) {
      const p = courseWorldPosition(network, course);
      if (!p) continue;
      const d = Math.hypot(p.x - hall.x, p.y - hall.y);
      if (d <= 30000) h30++;
      if (d <= 15000) h15++;
    }
    (a.hall15 ||= []).push(h15); (a.hall30 ||= []).push(h30);
    // szereg czasowy co 30 min
    if (now % 1800 === 0) {
      (a.series ||= []).push({ min: now / 60, occ: total, parked: parkedAt[id] || 0, near60: cnt[60000].moving, queue: director.portQueue.get(id) || 0,
        sysParked: Object.values(parkedAt).reduce((x, y) => x + y, 0), active: registry.active.length, delivered: director.stats.delivered });
    }
  }
}

// ---------- bieg ----------
const t0 = Date.now();
const totalSeconds = MINUTES * 60;
let yardBuilt = {};
const T = { director: [], yards: 0, war: 0, piracy: 0, scrap: 0, n: 0, peakActive: 0 };
const hr = () => Number(process.hrtime.bigint()) / 1e6;
for (let elapsed = 0; elapsed < totalSeconds; elapsed += STEP) {
  let t = hr();
  tickDirector(director, STEP, stations);
  let t2 = hr(); if (elapsed >= WARM) T.director.push(t2 - t); t = t2;
  const ev = tickShipyards(shipyards, STEP, { getEconomy: id => economies.get(String(id)) || null });
  t2 = hr(); if (elapsed >= WARM) T.yards += t2 - t; t = t2;
  T.peakActive = Math.max(T.peakActive, registry.active.length);
  for (const e of ev) if (e.type === 'built' && elapsed >= WARM) {
    const y = shipyards.yards.find(yy => yy.id === e.yardId);
    const k = y?.stationId || '?';
    yardBuilt[k] = yardBuilt[k] || {}; yardBuilt[k][e.classId] = (yardBuilt[k][e.classId] || 0) + 1;
  }
  tickWar(war, STEP, { shipyards, stations, network, registry, getEconomy: id => economies.get(String(id)) || null });
  t2 = hr(); if (elapsed >= WARM) T.war += t2 - t; t = t2;
  tickPiracy(piracy, STEP, {
    stations, registry, getEconomy: id => economies.get(String(id)) || null,
    patrolStrength: (f, t) => Math.max(0, (1 / Math.max(0.05, patrolMultiplier(director.patrols, f, t))) - 1),
    priceAt: (station, rid) => { const e = economies.get(String(station.id)); return e ? (resourcePrice(station, e, rid)?.bid || 0) : 0; }
  });
  t2 = hr(); if (elapsed >= WARM) T.piracy += t2 - t; t = t2;
  tickScrappers(scrappers, STEP, { war, stations, registry, getEconomy: id => economies.get(String(id)) || null });
  t2 = hr(); if (elapsed >= WARM) { T.scrap += t2 - t; T.n++; }
  if (elapsed >= WARM && !process.env.NOSAMPLE) sample(elapsed);
}
{
  const d = T.director.slice().sort((a, b) => a - b);
  const n = Math.max(1, T.n);
  console.log(`KOSZT TICKU (5 s gry) po rozruchu: dyspozytor śr ${(d.reduce((a, b) => a + b, 0) / n).toFixed(2)} ms, p50 ${d[Math.floor(d.length * 0.5)]?.toFixed(2)}, p95 ${d[Math.floor(d.length * 0.95)]?.toFixed(2)}, max ${d[d.length - 1]?.toFixed(2)}; `
    + `stocznie ${(T.yards / n).toFixed(3)}, wojna ${(T.war / n).toFixed(3)}, piractwo ${(T.piracy / n).toFixed(3)}, złomiarze ${(T.scrap / n).toFixed(3)} ms; szczyt kursów ${T.peakActive}`);
}
const snap = directorSnapshot(director);
const hours = (totalSeconds - WARM) / 3600;

// ---------- wynik ----------
const out = { args: { MINUTES, PRESSURE, CAPACITY_MUL, ECONOMY_SCALE, WARM: WARM / 60, DROP }, dropped, ports: {} };
console.log(`\n=== ×${ECONOMY_SCALE}, ${MINUTES} min (rozruch ${WARM / 60}), presja ${PRESSURE}, magazyny ×${CAPACITY_MUL}, drop: ${DROP.join(' ') || '—'} ===`);
console.log(`flota: ${totalShips} jednostek, ${companyList.length} firm; dostarczone ${snap.stats.delivered}, `
  + `przewozy ${snap.stats.hauls}, górnicze ${snap.stats.mining}, aktywne na koniec ${snap.active}, czas ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const id of WATCH) {
  const a = acc[id];
  const layout = docks.get(id);
  const tot = {}; for (const b of layout.berths) tot[b.cls] = (tot[b.cls] || 0) + 1;
  const P = { berths: layout.berths.length, byClass: {}, total: {}, queue: {}, parked: {}, parkedBy: {}, fitFree: {}, near: {}, arrivalsPerHour: {}, dwell: {}, complex: {} };
  console.log(`\n--- ${id.toUpperCase()}: ${layout.docks.length} doków, ${layout.berths.length} stanowisk ${JSON.stringify(tot)}${dropped[id] ? '  (zabrane: ' + dropped[id].join(', ') + ')' : ''}`);
  for (const k of CLS) {
    if (!tot[k]) continue;
    const arr = a.occ[k];
    P.byClass[k] = { total: tot[k], mean: +mean(arr).toFixed(1), p50: pct(arr, 0.5), p95: pct(arr, 0.95), max: Math.max(...arr),
      full: +(arr.filter(v => v >= tot[k]).length / arr.length * 100).toFixed(1) };
    console.log(`  ${k.padEnd(8)} ${String(tot[k]).padStart(3)} stan.: śr ${mean(arr).toFixed(1).padStart(5)}  p50 ${String(pct(arr, 0.5)).padStart(3)}  p95 ${String(pct(arr, 0.95)).padStart(3)}  max ${String(Math.max(...arr)).padStart(3)}   (${(mean(arr) / tot[k] * 100).toFixed(0)}% śr., pełne ${P.byClass[k].full}% czasu)`);
  }
  P.total = { mean: +mean(a.total).toFixed(1), p95: pct(a.total, 0.95), max: Math.max(...a.total) };
  console.log(`  RAZEM zajętych: śr ${mean(a.total).toFixed(1)} / ${layout.berths.length} (${(mean(a.total) / layout.berths.length * 100).toFixed(0)}%), p95 ${pct(a.total, 0.95)}, max ${Math.max(...a.total)}`);
  P.queue = { mean: +mean(a.queue).toFixed(2), p95: pct(a.queue, 0.95), max: Math.max(...a.queue) };
  console.log(`  kolejka na redzie: śr ${mean(a.queue).toFixed(2)}, p95 ${pct(a.queue, 0.95)}, max ${Math.max(...a.queue)}`);
  console.log(`  wolne stanowiska, na które WEJDZIE kadłub (min / p5 / śr; % czasu z zerem):`);
  for (const h of Object.keys(PROBE_HULLS)) {
    const arr = a.fitFree[h];
    P.fitFree[h] = { min: Math.min(...arr), p5: pct(arr, 0.05), mean: +mean(arr).toFixed(1), zero: +(arr.filter(v => v === 0).length / arr.length * 100).toFixed(1) };
    console.log(`    ${h.padEnd(22)} ${String(Math.min(...arr)).padStart(4)} / ${String(pct(arr, 0.05)).padStart(4)} / ${mean(arr).toFixed(1).padStart(6)}   zero: ${P.fitFree[h].zero}%`);
  }
  P.parked = { mean: +mean(a.parked).toFixed(0), p95: pct(a.parked, 0.95), max: Math.max(...a.parked), last: a.parked[a.parked.length - 1] };
  console.log(`  PARKING (jednostki bez zlecenia w porcie): śr ${mean(a.parked).toFixed(0)}, p95 ${pct(a.parked, 0.95)}, max ${Math.max(...a.parked)}, na koniec ${a.parked[a.parked.length - 1]}`);
  const pb = Object.entries(a.parkedBy).map(([k, arr]) => { P.parkedBy[k] = { mean: +(arr.reduce((x, y) => x + y, 0) / nSamples).toFixed(0), max: Math.max(...arr) }; return `${k} śr ${P.parkedBy[k].mean} max ${P.parkedBy[k].max}`; }).join(', ');
  console.log(`    wg klasy: ${pb}`);
  console.log(`  KURSY w promieniu (średnio / max): w ruchu | przy stanowisku | kolejka`);
  for (const r of RADII) {
    const n = a.near[r];
    P.near[r] = { moving: +mean(n.moving).toFixed(1), movingMax: Math.max(...n.moving), berthed: +mean(n.berthed).toFixed(1), queued: +mean(n.queued).toFixed(1), queuedMax: Math.max(...n.queued) };
    console.log(`    ≤${(r / 1000).toFixed(0).padStart(3)} tys.: ${mean(n.moving).toFixed(1).padStart(6)} / ${String(Math.max(...n.moving)).padStart(4)} | ${mean(n.berthed).toFixed(1).padStart(6)} | ${mean(n.queued).toFixed(1).padStart(5)} / ${Math.max(...n.queued)}`);
  }
  const arrH = Object.fromEntries(CLS.map(k => [k, +(a.arrivals[k] / hours).toFixed(1)]));
  P.arrivalsPerHour = arrH;
  const sumArr = CLS.reduce((s, k) => s + a.arrivals[k], 0);
  console.log(`  cumowań/h: ${(sumArr / hours).toFixed(0)}  ${JSON.stringify(arrH)}`);
  console.log(`    kadłuby: ${Object.entries(a.arrivalsHull).sort((x, y) => y[1] - x[1]).map(([h, v]) => `${h} ${(v / hours).toFixed(0)}/h`).join(', ')}`);
  P.dwell = { mean: +mean(a.dwell).toFixed(0), p50: pct(a.dwell, 0.5), p95: pct(a.dwell, 0.95) };
  console.log(`  czas zajęcia stanowiska [s]: śr ${mean(a.dwell).toFixed(0)}, p50 ${pct(a.dwell, 0.5)}, p95 ${pct(a.dwell, 0.95)}`);
  const cx = Object.entries(a.complex).sort().map(([k, v]) => { P.complex[k] = { mean: +(v.sum / nSamples).toFixed(1), total: v.total, peak: v.peak }; return `${k} ${(v.sum / nSamples).toFixed(1)}/${v.total} (max ${v.peak})`; }).join('  ');
  console.log(`  wg doku (kompleks:hala): ${cx}`);
  a.hall15 ||= []; a.hall30 ||= [];
  P.hall15 = { mean: +mean(a.hall15).toFixed(1), p95: pct(a.hall15, 0.95), max: Math.max(...a.hall15) };
  P.hall30 = { mean: +mean(a.hall30).toFixed(1), p95: pct(a.hall30, 0.95), max: Math.max(...a.hall30) };
  console.log(`  kursy wokół hali K-7 nr 1 (gracza): ≤15 tys. śr ${P.hall15.mean} p95 ${P.hall15.p95} max ${P.hall15.max}; ≤30 tys. śr ${P.hall30.mean} p95 ${P.hall30.p95} max ${P.hall30.max}`);
  P.series = a.series || [];
  if (a.entryComplex) {
    const tot = Object.values(a.entryComplex).reduce((x, y) => x + y, 0);
    P.entryComplex = Object.fromEntries(Object.entries(a.entryComplex).map(([k, v]) => [k, +(v / tot * 100).toFixed(1)]));
    console.log(`  wejścia do portu wg najbliższego kompleksu (kierunek podejścia): ${JSON.stringify(P.entryComplex)} %`);
  }
  console.log(`  co 30 min [min: zajęte / parking / w ruchu ≤60k / kolejka]: ${(a.series || []).map(s => `${s.min}: ${s.occ}/${s.parked}/${s.near60}/${s.queue}`).join('  ')}`);
  out.ports[id] = P;
}
// parking w całym układzie
{
  const parkedAt = {};
  for (const c of companies.companies) for (const s of c.ships) if (s.state === SHIP_STATE.PARKED) parkedAt[s.stationId] = (parkedAt[s.stationId] || 0) + 1;
  let fleetN = 0; for (const c of companies.companies) fleetN += c.ships.length;
  const top = Object.entries(parkedAt).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`\nflota przewoźników na koniec: ${fleetN}; zaparkowane wg portu: ${top.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  // stany jednostek: czy BUSY ma żywy kurs?
  const activeIds = new Set(registry.active.map(c => c.id));
  const st = {}; let busyNoCourse = 0, busyWithCourse = 0; const stageOf = {};
  for (const c of companies.companies) for (const s of c.ships) {
    st[s.state] = (st[s.state] || 0) + 1;
    if (s.state !== SHIP_STATE.PARKED) {
      if (s.courseId && activeIds.has(s.courseId)) {
        busyWithCourse++;
        const course = registry.byId.get(s.courseId);
        const stg = currentStage(course);
        const key = `${course.kind}:${stg?.kind}:${stg?.reason || stg?.mode || ''}${course.blocked ? ':blocked' : ''}`;
        stageOf[key] = (stageOf[key] || 0) + 1;
      } else busyNoCourse++;
    }
  }
  const kinds = {}; for (const c of registry.active) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  console.log(`stany jednostek: ${JSON.stringify(st)}; zajęte z żywym kursem ${busyWithCourse}, BEZ kursu ${busyNoCourse}; aktywne kursy wg rodzaju ${JSON.stringify(kinds)}`);
  console.log(`kursy zamknięte: ${JSON.stringify(registry.tally)}; stats: stranded ${director.stats.stranded}, lost ${director.stats.lost}, deadheads ${director.stats.deadheads}, noShip ${director.stats.noShip}`);
  // hipoteza: kolizja id przy odkupie (addShip: `${company.id}-s${ships.length + 1}`)
  const idCount = new Map();
  for (const c of companies.companies) for (const s of c.ships) idCount.set(s.id, (idCount.get(s.id) || 0) + 1);
  let dupIds = 0, zombiesDup = 0, zombiesUnique = 0, zombiesNotIndexed = 0;
  for (const [, n] of idCount) if (n > 1) dupIds++;
  for (const c of companies.companies) for (const s of c.ships) {
    if (s.state === SHIP_STATE.PARKED || (s.courseId && activeIds.has(s.courseId))) continue;
    if (idCount.get(s.id) > 1) zombiesDup++; else zombiesUnique++;
    if (companies.shipsById.get(s.id) !== s) zombiesNotIndexed++;
  }
  console.log(`id zdublowane: ${dupIds}; zawieszone z dublem id ${zombiesDup}, z unikalnym ${zombiesUnique}; zawieszone NIEOBECNE w shipsById (indeks wskazuje inny obiekt): ${zombiesNotIndexed}`);
  console.log(`etapy kursów jednostek przewoźników: ${Object.entries(stageOf).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  out.parkedEnd = parkedAt; out.fleetEnd = fleetN;
}
console.log(`stocznie (zwodowane po rozruchu, na ${hours.toFixed(1)} h): ${JSON.stringify(yardBuilt)}`);
out.yardBuilt = yardBuilt; out.hours = hours;
{
  const sy = summarizeShipyards(shipyards);
  out.warStock = sy.factions.map(f => ({ factionId: f.factionId, ready: f.ready, byClass: f.byClass }));
  console.log(`gotowe okręty w zapasie frakcji: ${sy.factions.map(f => `${f.factionId} ${f.ready} ${JSON.stringify(f.byClass)}`).join(' | ')}`);
  const w = summarizeWar(war);
  console.log(`wojna: ${w.stats.launched} wypraw, ${w.stats.battles} bitew, stracono ${w.stats.shipsLost} okrętów`);
}
if (process.env.JSON) { const fs = await import('node:fs'); fs.writeFileSync(process.env.JSON, JSON.stringify(out, null, 1)); }
