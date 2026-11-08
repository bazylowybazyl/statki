// Mapa gwiezdna (src/game/sector/): sektor z ziarna — determinizm, unikalne id, odstępy, rozkład gwiazd
// (skupiska i pustki), rdzeń i pogranicze, szlaki, ciała układów, strefa (mgławice, burze, punkty skoku),
// lot, mgła eksploracji, floty (determinizm, trasy po szlakach, życie na mapie).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSector, sectorSummary, lanePath, starDensityAt, SECTOR_DEFAULTS, NAMED_CORE,
  PLANET_TYPES, MAX_ORBIT_AU,
  zoneAt, createZoneSample, stormPosition, jumpPointsOf, jumpPointAt, nearestSystem, worldEntryFromJump,
  zoneExitFromWorld, ZONE, nebulaDensityAt,
  createShip, stepShip, SECTOR_FLIGHT,
  createExploration, updateExploration, serializeExploration, restoreExploration, EXPLORE,
  createFleets, stepFleets, advanceFleets, fleetSnapshot, restoreFleets, FLEET_MODE, fleetVisibleToPlayer,
  fleetComposition, FLEET_HULL_CLASSES, hashU32, SectorRng
} from '../src/game/sector/index.js';

const sector = generateSector({ seed: 1 });
const S = sector.systems;
const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** Odcisk sektora (bez map i indeksów). */
function fingerprint(sec) {
  return JSON.stringify({ systems: sec.systems, nebulae: sec.nebulae, storms: sec.storms, lanes: sec.lanes, gates: sec.gates, pirates: sec.pirateBases });
}

test('determinizm: to samo ziarno = ten sam sektor, inne ziarno = inny', () => {
  assert.equal(fingerprint(generateSector({ seed: 1 })), fingerprint(sector));
  assert.notEqual(fingerprint(generateSector({ seed: 2 })), fingerprint(sector));
  // Strumienie celów niezależne: hasz z części (nie sumy napisów).
  assert.notEqual(hashU32('ab', 'c'), hashU32('a', 'bc'));
  const r1 = new SectorRng(7);
  const r2 = new SectorRng(7);
  for (let i = 0; i < 20; i++) assert.equal(r1.next(), r2.next());
});

test('liczba układów, Słońce w (0, 0), nazwani sąsiedzi w rdzeniu', () => {
  assert.equal(S.length, SECTOR_DEFAULTS.count);
  const sol = sector.byId.get('sol');
  assert.ok(sol);
  assert.equal(sol.x, 0);
  assert.equal(sol.y, 0);
  assert.equal(sol.zone, 'core');
  for (const n of NAMED_CORE) {
    const s = sector.byId.get(n.id);
    assert.ok(s, n.id);
    assert.equal(s.zone, 'core', n.id);
    assert.ok(Math.abs(s.distSol - n.d) < 1e-2, `${n.id}: ${s.distSol} vs ${n.d}`);
  }
});

test('id unikalne w całym sektorze (układy, planety, pasy, mgławice, burze, bramy)', () => {
  for (const seed of [1, 2, 3, 99]) {
    const sec = generateSector({ seed });
    const ids = new Set();
    const add = (id) => {
      assert.equal(typeof id, 'string');
      assert.ok(!ids.has(id), `powtórzone id ${id} (ziarno ${seed})`);
      ids.add(id);
    };
    for (const s of sec.systems) {
      add(s.id);
      for (const p of s.planets) {
        add(p.id);
        assert.ok(p.id.startsWith(`${s.id}:`), p.id);
      }
      for (const b of s.belts) add(b.id);
    }
    for (const n of sec.nebulae) add(n.id);
    for (const st of sec.storms) add(st.id);
    for (const g of sec.gates) add(g.id);
    // Nazwy układów też bez powtórzeń.
    assert.equal(new Set(sec.systems.map((s) => s.name)).size, sec.systems.length);
  }
});

test('odstępy i granice: najmniejszy odstęp ≥ minSpacing, wszystko w pudle sektora', () => {
  const B = sector.bounds;
  let minD = Infinity;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    assert.ok(s.x >= B.x0 && s.x <= B.x1 && s.y >= B.y0 && s.y <= B.y1, s.id);
    for (let j = i + 1; j < S.length; j++) minD = Math.min(minD, dist(s, S[j]));
  }
  assert.ok(minD >= SECTOR_DEFAULTS.minSpacing - 1e-3, `min ${minD}`);
  const sum = sectorSummary(sector);
  // Sąsiad ~minuty lotu, nie godziny: mediana 3–7 ly.
  assert.ok(sum.nnMedian > 3 && sum.nnMedian < 7, JSON.stringify(sum));
});

test('rozkład nie jest równy: skupiska i pustki (wskaźnik rozproszenia komórek 10 ly > 1,3)', () => {
  const B = sector.bounds;
  const cell = 10;
  const nx = Math.ceil((B.x1 - B.x0) / cell);
  const ny = Math.ceil((B.y1 - B.y0) / cell);
  const counts = new Array(nx * ny).fill(0);
  for (const s of S) counts[Math.min(ny - 1, Math.floor((s.y - B.y0) / cell)) * nx + Math.min(nx - 1, Math.floor((s.x - B.x0) / cell))]++;
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length;
  assert.ok(variance / mean > 1.3, `rozproszenie ${variance / mean}`);
  assert.ok(counts.filter((c) => c === 0).length >= 4, 'puste komórki 10 × 10 ly');
  // Gęstość: pustka rzadsza niż ramię przez rdzeń.
  const v = sector.layout.voids[0];
  assert.ok(starDensityAt(sector.layout, v.x, v.y) < starDensityAt(sector.layout, 0, 0));
});

test('rdzeń i pogranicze: rdzeń blisko Słońca, piraci na pograniczu, szlaki spójne', () => {
  const core = S.filter((s) => s.zone === 'core');
  const frontier = S.filter((s) => s.zone === 'frontier');
  assert.ok(core.length >= 18 && core.length <= 45, `rdzeń ${core.length}`);
  assert.ok(frontier.length > core.length * 2);
  for (const s of core) {
    assert.ok(s.named || s.distSol <= SECTOR_DEFAULTS.coreRadius, s.id);
    assert.ok(s.faction && s.faction !== 'pirates', s.id);
    assert.ok(s.inhabited);
  }
  for (const i of sector.pirateBases) {
    assert.equal(S[i].zone, 'frontier');
    assert.equal(S[i].faction, 'pirates');
  }
  assert.ok(sector.pirateBases.length >= 4);
  // Szlaki tylko w rdzeniu; z Sol da się dojechać do każdego układu rdzenia.
  for (const [a, b, len] of sector.lanes) {
    assert.equal(S[a].zone, 'core');
    assert.equal(S[b].zone, 'core');
    assert.ok(Math.abs(len - dist(S[a], S[b])) < 1e-2);
  }
  const sol = sector.indexOf.get('sol');
  const laneSet = new Set(sector.lanes.map(([a, b]) => `${a}-${b}`));
  for (const c of sector.core) {
    const path = lanePath(sector, sol, c);
    assert.ok(path, `trasa sol → ${S[c].id}`);
    for (let k = 1; k < path.length; k++) {
      const a = Math.min(path[k - 1], path[k]);
      const b = Math.max(path[k - 1], path[k]);
      assert.ok(laneSet.has(`${a}-${b}`), `odcinek ${a}-${b} nie jest szlakiem`);
    }
  }
  // Bramy w rdzeniu.
  assert.ok(sector.gates.length >= 5);
  for (const g of sector.gates) assert.equal(sector.byId.get(g.system).zone, 'core');
});

test('ciała układów: rodzaje z listy generatora, orbity rosną i mieszczą się w świecie, Słońce stałe', () => {
  const types = new Set(PLANET_TYPES);
  const seen = new Set();
  for (const s of S) {
    let prev = 0;
    for (const p of s.planets) {
      assert.ok(types.has(p.type), `${p.id}: ${p.type}`);
      seen.add(p.type);
      assert.ok(p.orbitAU > prev, `${p.id} orbita rośnie`);
      assert.ok(p.orbitAU <= MAX_ORBIT_AU + 1e-6, p.id);
      assert.ok(p.r > 1000 && p.r < 5000, p.id);
      assert.equal(p.seed >>> 0, p.seed);
      prev = p.orbitAU;
    }
    for (const b of s.belts) {
      assert.ok(b.innerAU < b.outerAU && b.outerAU <= 140, b.id);
      assert.ok(b.kind === 'asteroid' || b.kind === 'ice');
    }
  }
  assert.equal(seen.size, PLANET_TYPES.length, `wszystkie rodzaje występują: ${[...seen]}`);
  const sol = sector.byId.get('sol');
  const earth = sol.planets.find((p) => p.id === 'sol:earth');
  assert.equal(earth.type, 'terran');
  assert.equal(earth.orbitAU, 25);
  assert.equal(sol.planets.length, 8);
  assert.deepEqual(sol.belts.map((b) => b.id), ['sol:main', 'sol:kuiper']);
  // Zawartość układu nie zależy od liczby układów (ziarno ciał = sektor + id).
  const small = generateSector({ seed: 1, count: 60 });
  assert.deepEqual(small.byId.get('tau-ceti').planets, sector.byId.get('tau-ceti').planets);
});

test('strefa: mgławica spowalnia i zasłania, burza krąży okresowo, poza mgławicą czysto', () => {
  const z = createZoneSample();
  const n = sector.nebulae[0];
  zoneAt(sector, n.x, n.y, 0, z);
  assert.ok(z.nebula > 0.3, `gęstość w środku ${z.nebula}`);
  assert.ok(z.speedMul < 0.9 && z.sensorMul < 0.8);
  assert.equal(nebulaDensityAt(n, n.x + n.rx * 3, n.y), 0);
  zoneAt(sector, 0, 0, 0, z);
  assert.equal(z.nebula, 0);
  assert.equal(z.speedMul, 1);
  assert.ok(sector.storms.length > 0);
  const st = sector.storms[0];
  const a = stormPosition(sector, st, 10, { x: 0, y: 0 });
  const b = stormPosition(sector, st, 10 + st.period, { x: 0, y: 0 });
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);
  zoneAt(sector, a.x, a.y, 10, z);
  // W oku burzy: wiatru prawie nie ma, ale burza działa (gdy mgławica gęsta w tym miejscu).
  if (z.nebula > 0.2) assert.ok(z.storm > 0, `burza ${z.storm} przy mgławicy ${z.nebula}`);
});

test('punkty skoku: cztery na okręgu studni, róg świata ↔ punkt strefy w tym samym kierunku', () => {
  const sys = sector.byId.get('alfa-centauri');
  const jps = jumpPointsOf(sys);
  assert.equal(jps.length, 4);
  for (const jp of jps) assert.ok(Math.abs(dist(jp, sys) - ZONE.jumpRadius) < 1e-9);
  const ne = jps[0];
  assert.equal(ne.key, 'NE');
  assert.ok(ne.x > sys.x && ne.y < sys.y, 'NE: x w prawo, y w górę (osie gry)');
  const hit = jumpPointAt(sector, ne.x + 0.02, ne.y, { index: -1, corner: -1, dist: 0 }, nearestSystem(sector, ne.x, ne.y, { index: -1, dist: 0 }));
  assert.ok(hit);
  assert.equal(S[hit.index].id, 'alfa-centauri');
  assert.equal(hit.corner, 0);
  const w = worldEntryFromJump(0);
  assert.ok(w.x > 0 && w.y < 0, 'wejście NE = róg NE świata');
  // Kurs do środka świata.
  assert.ok(Math.cos(w.heading) * -w.x + Math.sin(w.heading) * -w.y > 0);
  const out = zoneExitFromWorld(sector, 'alfa-centauri', -5.9e6, 5.9e6);
  assert.equal(out.key, 'SW');
  assert.ok(dist(out, sys) > ZONE.jumpRadius, 'wyjście poza studnią');
  assert.equal(jumpPointAt(sector, out.x, out.y, { index: -1, corner: -1, dist: 0 }, nearestSystem(sector, out.x, out.y, { index: -1, dist: 0 })), null, 'wyjście nie wpada od razu w punkt skoku');
});

test('lot: rozpęd do prędkości przelotowej, paliwo za drogę, nurt szybszy, pusty bak = dryf', () => {
  const ship = createShip(-30, 30, 0);
  const input = { thrust: 1, turn: 0, burn: false };
  for (let i = 0; i < 60 * 20; i++) stepShip(ship, input, 1 / 60, sector, i / 60);
  const z = ship.zone;
  assert.ok(Math.abs(ship.speed - SECTOR_FLIGHT.cruise * z.speedMul) < 0.01, `prędkość ${ship.speed}`);
  const used = SECTOR_FLIGHT.fuelMax - ship.fuel;
  assert.ok(Math.abs(used - ship.traveled * SECTOR_FLIGHT.fuelPerLy * z.fuelMul) < 0.5, `paliwo ${used} za ${ship.traveled} ly`);
  const burn = createShip(-30, 30, 0);
  for (let i = 0; i < 60 * 20; i++) stepShip(burn, { thrust: 1, turn: 0, burn: true }, 1 / 60, sector, i / 60);
  assert.ok(burn.speed > ship.speed * 1.4);
  const dry = createShip(-30, 30, 0, 0);
  for (let i = 0; i < 60 * 20; i++) stepShip(dry, input, 1 / 60, sector, i / 60);
  assert.ok(dry.speed <= SECTOR_FLIGHT.dryMaxSpeed + 1e-6);
  // Sąsiad w ~minutę: mediana odległości / przelot.
  const sum = sectorSummary(sector);
  const t = sum.nnMedian / SECTOR_FLIGHT.cruise;
  assert.ok(t > 10 && t < 60, `przelot do sąsiada ${t} s`);
});

test('mgła eksploracji: rdzeń znany, skan po czasie w zasięgu, wizyta w studni, zapis i odczyt', () => {
  const exp = createExploration(sector);
  for (const i of sector.core) assert.equal(exp.level[i], EXPLORE.VISITED);
  const fi = S.findIndex((s) => s.zone === 'frontier' && s.nebulaDensity < 0.1);
  assert.equal(exp.level[fi], EXPLORE.SEEN);
  const s = S[fi];
  const ev = [];
  // Statek 2 ly od gwiazdy (w zasięgu skanu), 3 s.
  for (let k = 0; k < 30; k++) updateExploration(exp, sector, s.x + 2, s.y, 1, 0.1, ev);
  assert.equal(exp.level[fi], EXPLORE.SCANNED);
  updateExploration(exp, sector, s.x + 0.1, s.y, 1, 0.1, ev);
  assert.equal(exp.level[fi], EXPLORE.VISITED);
  assert.ok(ev.some((e) => e.index === fi && e.level === EXPLORE.VISITED));
  const data = JSON.parse(JSON.stringify(serializeExploration(exp)));
  const back = restoreExploration(sector, data);
  assert.deepEqual(Array.from(back.level), Array.from(exp.level));
  // Zapis z innego sektora nie wchodzi.
  const other = restoreExploration(generateSector({ seed: 5 }), data);
  assert.notDeepEqual(Array.from(other.level), Array.from(exp.level));
  // Ukryte układy istnieją (w gęstych mgławicach) i odsłania je przelot obok.
  const hidden = S.findIndex((x, i) => createExploration(sector).level[i] === EXPLORE.HIDDEN);
  if (hidden >= 0) {
    const e2 = createExploration(sector);
    updateExploration(e2, sector, S[hidden].x + 1, S[hidden].y, 1, 0.1);
    assert.ok(e2.level[hidden] >= EXPLORE.SEEN);
  }
});

test('floty: determinizm, migawka, konwoje po szlakach rdzenia, piraci z kryjówek, życie na mapie', () => {
  const a = createFleets(sector);
  const b = createFleets(sector);
  advanceFleets(a, sector, 300);
  for (let i = 0; i < 3000; i++) stepFleets(b, sector, 0.1);
  assert.deepEqual(fleetSnapshot(a), fleetSnapshot(b));
  // Migawka → nowy stan → te same kroki dalej.
  const c = createFleets(sector);
  assert.ok(restoreFleets(c, JSON.parse(JSON.stringify(fleetSnapshot(a)))));
  advanceFleets(a, sector, 60);
  advanceFleets(c, sector, 60);
  assert.deepEqual(fleetSnapshot(a).fleets, fleetSnapshot(c).fleets);

  const st = createFleets(sector);
  const kinds = {};
  for (const f of st.fleets) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
  assert.ok(kinds.trade >= 10 && kinds.patrol >= 5 && kinds.pirate >= 5, JSON.stringify(kinds));
  const laneSet = new Set(sector.lanes.map(([x, y]) => `${x}-${y}`));
  const lastHop = st.fleets.map((f) => f.hop);
  const moving = new Set();
  const x0 = st.fleets.map((f) => [f.x, f.y]);
  for (let i = 0; i < 6000; i++) {
    stepFleets(st, sector, 0.1);
    st.fleets.forEach((f, k) => {
      if (f.kind === 'trade') {
        if (f.dest >= 0) assert.equal(S[f.dest].zone, 'core', `${f.id} cel w rdzeniu`);
        if (f.hop >= 0 && f.mode === FLEET_MODE.TRANSIT && lastHop[k] >= 0 && f.hop !== lastHop[k]) {
          const p = Math.min(f.hop, lastHop[k]);
          const q = Math.max(f.hop, lastHop[k]);
          assert.ok(laneSet.has(`${p}-${q}`), `${f.id}: przeskok ${S[lastHop[k]].id} → ${S[f.hop].id} poza szlakiem`);
        }
      }
      if (f.kind === 'pirate') assert.ok(sector.pirateBases.includes(f.home));
      if (f.kind === 'patrol') assert.equal(S[f.home].faction, f.faction);
      if (f.mode !== FLEET_MODE.DOCKED) lastHop[k] = f.hop;
      if (Math.abs(f.x - x0[k][0]) + Math.abs(f.y - x0[k][1]) > 1) moving.add(f.id);
      assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), f.id);
    });
  }
  assert.ok(moving.size >= st.fleets.length * 0.9, `ruszyło ${moving.size} / ${st.fleets.length}`);
  const types = new Set(st.events.map((e) => e.type));
  assert.ok(types.has('poscig'), `zdarzenia: ${[...types]}`);
  // Widoczność: w rdzeniu (przekaźniki) widać flotę w drodze, w porcie nie.
  const f = st.fleets.find((x) => x.kind === 'trade' && x.mode === FLEET_MODE.TRANSIT && x.x * x.x + x.y * x.y < 100);
  if (f) assert.equal(fleetVisibleToPlayer(f, sector, { x: 80, y: 40 }, 1), true);
  const docked = st.fleets.find((x) => x.mode === FLEET_MODE.DOCKED);
  if (docked) assert.equal(fleetVisibleToPlayer(docked, sector, { x: docked.x, y: docked.y }, 1), false);
});

test('piraci ścigają gracza na pograniczu i odpuszczają po przechwyceniu', () => {
  const st = createFleets(sector);
  const base = S[sector.pirateBases[0]];
  const player = { x: base.x + 1.5, y: base.y, sensorMul: 1, active: true };
  let hunted = false;
  let caught = false;
  for (let i = 0; i < 3000 && !caught; i++) {
    stepFleets(st, sector, 0.1, player);
    for (const f of st.fleets) if (f.kind === 'pirate' && f.mode === FLEET_MODE.HUNT && f.target === -2) hunted = true;
    caught = st.events.some((e) => e.type === 'przechwycenie');
  }
  assert.ok(hunted, 'banda wyrusza za graczem');
  assert.ok(caught, 'banda dogania stojącego gracza');
});

test('skład floty: deterministyczny z id, liczba okrętów z siły, prowadzący na czele, klasy ze znanej listy', () => {
  const st = createFleets(sector);
  const counts = { trade: 0, patrol: 0, pirate: 0 };
  for (const f of st.fleets) {
    const c = fleetComposition(f);
    assert.deepEqual(fleetComposition({ ...f, rng: 12345 }), c, `${f.id}: skład nie zależy od stanu rng`);
    for (const h of c) assert.ok(FLEET_HULL_CLASSES[h], `${f.id}: klasa ${h}`);
    const n = f.kind === 'trade' ? 1 + f.strength + (f.strength >= 2 ? 1 : 0) : f.kind === 'patrol' ? f.strength : f.strength + 1;
    assert.equal(c.length, n, `${f.id}: ${c.join(', ')}`);
    if (f.kind === 'trade') assert.ok(c.filter((h) => !FLEET_HULL_CLASSES[h].warship).length === 1 + f.strength);
    else assert.ok(['niszczyciel', 'pancernik'].includes(c[0]), `${f.id}: prowadzi okręt liniowy`);
    counts[f.kind] += c.length;
  }
  assert.ok(counts.trade > 40 && counts.patrol > 20 && counts.pirate > 20, JSON.stringify(counts));
});
