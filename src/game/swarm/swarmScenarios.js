/**
 * SCENARIUSZE ROJU — opisy portów i ładunku dla dema dema/roj-webgpu.html i testów
 * (tests/swarmPlanner.test.mjs). Czysta logika: bez three, bez DOM.
 *
 * Scenariusz = { id, label, note, spec (buildSwarmPort), fill(port) — kontenery z celami,
 * drones: { S, M, L, C } (liczby dronów klas; gniazda z pól `pads`), focus — kadr startowy }.
 * Statki stoją kursem 0 (dziób +x); y gry w dół (spec.ships), reszta w świecie sceny (y w górę).
 * Ładunek: kontenery standardowe (16 × 8 × 8) — warstwa kolumny = jeden towar i jeden cel
 * (swarmFillColumns), drony biorą chwyt swojej klasy (S 1, M 2, L 4, Capital 8).
 */

import { buildSwarmPort, swarmFillColumns, swarmHash01 } from './swarmPort.js';

/** Mieszanki ładunku (surowce gry — rodziny kontenerów z cargoContainers.js). */
export const SWARM_MIXES = Object.freeze({
  import: ['copper_ore', 'iron_ore', 'ice', 'helium3', 'steel', 'titanium_ore', 'methane', 'scrap'],
  export: ['chips', 'avionics', 'ammo_kinetic', 'missile_round', 'coolant', 'hull_plate', 'thruster', 'fuel_rods', 'polymer'],
  mixed: ['copper_ore', 'helium3', 'chips', 'iron_ore', 'steel', 'ammo_kinetic', 'ice', 'coolant', 'avionics'],
  stress: ['copper_ore', 'ice', 'chips', 'steel', 'helium3', 'avionics', 'polymer', 'fuel_rods', 'coolant', 'titanium_ore']
});

function pick(mix, seed, k) {
  const list = SWARM_MIXES[mix] || SWARM_MIXES.mixed;
  // Ładunek w partiach (kilka kolejnych warstw jednego towaru — jak manifest).
  const batch = Math.floor(k / 3);
  return list[Math.floor(swarmHash01(seed, batch, 11) * list.length) % list.length];
}

const L = 'L';

// ---------------------------------------------------------------------------

function atlasLoad() {
  // Atlas: ładownia 9 × 7 slotów 2 × 2 kontenery × 2 warstwy = 504 kontenery = 126 chwytów L.
  const spec = {
    ships: [{ id: 'atlas', hull: 'atlas', x: 0, y: -560 }],
    yards: [{ id: 'plac', classId: L, x: 40, y: 40, cols: 16, rows: 4, levels: 2, label: 'Plac L' }],
    pads: [{ id: 'gniazda', classId: L, x: 40, y: -110, cols: 14, rows: 2 }],
    obstacles: [{ x: 330, y: -40, L: 46, W: 34, top: 42 }]
  };
  const fill = (port) => {
    // Eksport na placu: 126 warstw (tyle, ile miejsc w Atlasie), stosy po 2 od strony statku.
    let n = 0;
    return swarmFillColumns(port, (c) => c.kind === 'yard', () => {
      if (n >= 126) return null;
      n++;
      return { resource: pick('export', 7, n), dest: { kind: 'ship', ship: 'atlas' } };
    }, 3);
  };
  return {
    id: 'atlas', label: 'Załadunek Atlasa', drones: { L: 28 }, spec, fill,
    note: 'Dron L chwyta 4 kontenery naraz (2 × 2). Plan sztauowania: najcięższe do środka kadłuba, burty na zmianę — środek masy zostaje w osi.',
    focus: { x: 20, y: 260, w: 980, h: 900 }
  };
}

function freighterSwap() {
  // Jeden blok placu PRZEPLATANY: rzędy parzyste — eksport, nieparzyste — wolne na import. Dron
  // odkłada import i bierze eksport ze stosu obok (podwójny cykl na placu i w ładowni).
  const spec = {
    ships: [{ id: 'frachtowiec', hull: 'heavy_freighter', x: 0, y: -720 }],
    yards: [{ id: 'plac', classId: L, x: 0, y: 40, cols: 19, rows: 20, levels: 2, label: 'Plac L' }],
    pads: [{ id: 'gniazda', classId: L, x: 0, y: -260, cols: 24, rows: 4 }],
    obstacles: [{ x: 420, y: -60, L: 50, W: 40, top: 44 }]
  };
  const fill = (port) => {
    // Ładownia: jedna warstwa importu w każdym slocie (380 chwytów L = 1520 kontenerów).
    swarmFillColumns(port, (c) => c.kind === 'hold', (c, k) => (k === 0 ? { resource: pick('import', 21, c.index), dest: { kind: 'yard' } } : null), 5);
    let n = 0;
    swarmFillColumns(port, (c) => c.kind === 'yard' && (c.j & 1) === 0, () => {
      if (n >= 380) return null;
      n++;
      return { resource: pick('export', 9, n), dest: { kind: 'ship', ship: 'frachtowiec' } };
    }, 6);
    return port.units;
  };
  return {
    id: 'wymiana', label: 'Wymiana: ciężki frachtowiec', drones: { L: 96 }, spec, fill,
    note: 'Podwójny cykl: dron odkłada import obok stosu eksportu i od razu bierze eksport; w ładowni odwrotnie — prawie bez pustych przelotów.',
    focus: { x: 0, y: 260, w: 2100, h: 1500 }
  };
}

function transship() {
  const spec = {
    ships: [
      { id: 'frachtowiec', hull: 'heavy_freighter', x: -980, y: -620 },
      { id: 'atlas', hull: 'atlas', x: 980, y: -620 }
    ],
    yards: [{ id: 'plac', classId: L, x: 0, y: 20, cols: 20, rows: 10, levels: 2, label: 'Plac L' }],
    pads: [{ id: 'gniazda', classId: L, x: 0, y: -220, cols: 16, rows: 4 }],
    obstacles: []
  };
  const fill = (port) => {
    // Frachtowiec pełny (jedna warstwa w slocie): 63 warstwy dla Atlasa (przeładunek bezpośredni), reszta na plac.
    const hold = port.columns.filter((c) => c.kind === 'hold' && c.owner === 'frachtowiec');
    // 63 sloty rozrzucone po ładowni (kolejność z haszu — bez pętli dobierającej).
    const order = hold.map((c) => [swarmHash01(31, c.index, 2), c.index]).sort((a, b) => a[0] - b[0]);
    const toAtlas = new Set(order.slice(0, 63).map((e) => e[1]));
    return swarmFillColumns(port, (c) => c.kind === 'hold' && c.owner === 'frachtowiec', (c, k) => {
      if (k > 0) return null;
      return toAtlas.has(c.index)
        ? { resource: pick('export', 13, c.index), dest: { kind: 'ship', ship: 'atlas' } }
        : { resource: pick('import', 17, c.index), dest: { kind: 'yard' } };
    }, 8);
  };
  return {
    id: 'przeladunek', label: 'Przeładunek statek–statek', drones: { L: 64 }, spec, fill,
    note: 'Kontenery dla Atlasa lecą z frachtowca prosto do jego ładowni; reszta na plac, posortowana wg towaru.',
    focus: { x: 0, y: 260, w: 3600, h: 1700 }
  };
}

function megafreighter() {
  const spec = {
    ships: [
      { id: 'wagon-a', hull: 'megafreighter_wagon', x: 0, y: -1020 },
      { id: 'wagon-b', hull: 'megafreighter_wagon', x: 0, y: 1020 }
    ],
    yards: [{ id: 'plac', classId: 'C', x: 0, y: 0, cols: 24, rows: 10, levels: 2, label: 'Plac Capital' }],
    pads: [
      { id: 'gniazda-w', classId: 'C', x: -1080, y: 0, cols: 4, rows: 8 },
      { id: 'gniazda-e', classId: 'C', x: 1080, y: 0, cols: 4, rows: 8 }
    ],
    obstacles: []
  };
  const fill = (port) => {
    // Wagon A (północ): ładownia bliżej placu — jedna warstwa w slocie (4 × 4 = 2 chwyty Capital) na
    // plac; plac ma eksport dla wagonu B (południe).
    const near = port.grids.filter((g) => g.kind === 'hold' && g.owner === 'wagon-a').sort((a, b) => Math.abs(a.y) - Math.abs(b.y))[0];
    swarmFillColumns(port, (c) => c.kind === 'hold' && c.grid === near.index, (c, k) => (k === 0 ? { resource: pick('import', 41, c.index), dest: { kind: 'yard' } } : null), 9);
    let n = 0;
    swarmFillColumns(port, (c) => c.kind === 'yard' && c.i < 6, () => {
      if (n >= 80) return null;
      n++;
      return { resource: pick('export', 43, n), dest: { kind: 'ship', ship: 'wagon-b' } };
    }, 10);
    return port.units;
  };
  return {
    id: 'mega', label: 'Megafrachtowiec — drony Capital', drones: { C: 64 }, spec, fill,
    note: 'Dron Capital chwyta 8 kontenerów naraz (4 × 2) wysuwanymi ramionami; slot wagonu 4 × 4 to dwa chwyty na warstwę.',
    focus: { x: 0, y: 0, w: 3400, h: 3900 }
  };
}

function wholePort() {
  // WSPÓLNY PLAC C (obrys chwytu Capital 4 × 2): wagon rozładowuje Capital, a z tego samego placu
  // biorą L (połowy warstwy → Atlas), M (ćwiartki → frachtowiec dalekiego zasięgu) i S (pojedyncze
  // kontenery → Custos, Hasta) — jeden standard kontenera, chwyty różnej wielkości.
  const spec = {
    ships: [
      { id: 'frachtowiec', hull: 'heavy_freighter', x: -1300, y: -900 },
      { id: 'atlas', hull: 'atlas', x: 1300, y: -900 },
      { id: 'wagon', hull: 'megafreighter_wagon', x: 0, y: 1250 },
      { id: 'kontenerowiec', hull: 'container_ship', x: -1900, y: 120 },
      { id: 'dalekobieżny', hull: 'long_haul_freighter', x: 1900, y: 120 },
      { id: 'custos', hull: 'terran_frigate', x: -650, y: -1500 },
      { id: 'hasta', hull: 'terran_destroyer', x: 650, y: -1500 }
    ],
    yards: [
      { id: 'plac-C', classId: 'C', x: 0, y: -40, cols: 16, rows: 8, levels: 2, label: 'Plac C (wspólny)' },
      { id: 'plac-L', classId: L, x: -420, y: 400, cols: 14, rows: 6, levels: 2, label: 'Plac L' },
      { id: 'plac-M', classId: 'M', x: -1150, y: 40, cols: 12, rows: 6, levels: 2, label: 'Plac M' }
    ],
    pads: [
      { id: 'gniazda-L', classId: L, x: -700, y: 180, cols: 14, rows: 6 },
      { id: 'gniazda-M', classId: 'M', x: 700, y: 180, cols: 12, rows: 4 },
      { id: 'gniazda-C', classId: 'C', x: 0, y: -330, cols: 12, rows: 4 },
      { id: 'gniazda-S', classId: 'S', x: 0, y: 760, cols: 12, rows: 2 }
    ],
    obstacles: [{ x: 0, y: 190, L: 60, W: 50, top: 52 }]
  };
  const fill = (port) => {
    const plC = port.grids.find((g) => g.owner === 'plac-C').index;
    const plM = port.grids.find((g) => g.owner === 'plac-M').index;
    const plL = port.grids.find((g) => g.owner === 'plac-L').index;
    // Wagon: co czwarty slot — jedna warstwa (2 chwyty Capital) na plac C.
    swarmFillColumns(port, (c) => c.kind === 'hold' && c.owner === 'wagon' && (c.index & 3) === 0,
      (c, k) => (k === 0 ? { resource: pick('import', 53, c.index), dest: { kind: 'yard', grid: plC } } : null), 12);
    // Frachtowiec: część ładowni z importem (na plac L).
    swarmFillColumns(port, (c) => c.kind === 'hold' && c.owner === 'frachtowiec' && swarmHash01(c.index, 3, 5) < 0.37,
      (c, k) => (k === 0 ? { resource: pick('import', 51, c.index), dest: { kind: 'yard', grid: plL } } : null), 11);
    // Kontenerowiec (M): rozładunek na plac M.
    swarmFillColumns(port, (c) => c.kind === 'hold' && c.owner === 'kontenerowiec',
      (c, k) => (k === 0 ? { resource: pick('mixed', 55, c.index), dest: { kind: 'yard', grid: plM } } : null), 13);
    // Plac C (wspólny), wiersze od strony statków (północ): warstwy 8 kontenerów — dla Atlasa (L bierze
    // połowy), dla frachtowca dalekiego zasięgu (M bierze ćwiartki), dla Custosa i Hasty (S).
    const rows = port.columns.filter((c) => c.grid === plC && c.j >= 5).sort((a, b) => b.j - a.j || a.i - b.i);
    let atlas = 0; let haul = 0;
    const want = new Map();
    const used = new Set();
    for (const c of rows) {
      for (let k = 0; k < c.levels; k++) {
        if (atlas < 32) { atlas++; used.add(c.index); want.set(`${c.index}:${k}`, { resource: pick('export', 59, atlas), dest: { kind: 'ship', ship: 'atlas' } }); continue; }
        if (haul < 13) { haul++; used.add(c.index); want.set(`${c.index}:${k}`, { resource: pick('export', 57, haul), dest: { kind: 'ship', ship: 'dalekobieżny' } }); }
      }
    }
    // Fregaty: po jednej niepełnej warstwie w osobnych stosach (S bierze po jednym kontenerze).
    const free = rows.filter((c) => !used.has(c.index));
    want.set(`${free[0].index}:0`, { resource: 'ammo_kinetic', dest: { kind: 'ship', ship: 'custos' }, n: 6 });
    want.set(`${free[1].index}:0`, { resource: 'coolant', dest: { kind: 'ship', ship: 'hasta' }, n: 8 });
    swarmFillColumns(port, (c) => c.grid === plC, (c, k) => want.get(`${c.index}:${k}`) || null, 15);
    return port.units;
  };
  return {
    id: 'port', label: 'Port — wspólny plac C', drones: { S: 16, M: 40, L: 84, C: 40 }, spec, fill,
    note: 'Jeden kontener, chwyty różnej wielkości: Capital zdejmuje z wagonu po 8, a z tego samego placu L bierze po 4 do Atlasa, M po 2 do frachtowca, S po 1 do fregat.',
    focus: { x: 0, y: 0, w: 5600, h: 4200 }
  };
}

function swarmStress(count = 2048) {
  const R = 1000;
  const yards = [
    { id: 'N', classId: 'S', x: 0, y: R, cols: 40, rows: 26, levels: 3, label: 'Blok N' },
    { id: 'S', classId: 'S', x: 0, y: -R, cols: 40, rows: 26, levels: 3, label: 'Blok S' },
    { id: 'E', classId: 'S', x: R + 200, y: 0, yaw: Math.PI / 2, cols: 40, rows: 26, levels: 3, label: 'Blok E' },
    { id: 'W', classId: 'S', x: -R - 200, y: 0, yaw: Math.PI / 2, cols: 40, rows: 26, levels: 3, label: 'Blok W' }
  ];
  const per = Math.ceil(count / 4);
  const side = Math.ceil(Math.sqrt(per * 2));
  const pads = [
    { id: 'p-NE', classId: 'S', x: 560, y: 560, cols: side, rows: Math.ceil(per / side) },
    { id: 'p-NW', classId: 'S', x: -560, y: 560, cols: side, rows: Math.ceil(per / side) },
    { id: 'p-SE', classId: 'S', x: 560, y: -560, cols: side, rows: Math.ceil(per / side) },
    { id: 'p-SW', classId: 'S', x: -560, y: -560, cols: side, rows: Math.ceil(per / side) }
  ];
  const spec = { ships: [], yards, pads, obstacles: [] };
  const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const fill = (port) => {
    const gridOf = Object.fromEntries(port.grids.filter((g) => g.kind === 'yard').map((g) => [g.owner, g.index]));
    // Każdy blok: 1500 kontenerów w pierwszych stosach (od strony bloku), cel — blok naprzeciw.
    for (const y of yards) {
      let n = 0;
      swarmFillColumns(port, (c) => c.kind === 'yard' && c.owner === y.id, (c) => {
        if (n >= 1500 || c.j >= 20) return null;
        n++;
        return { resource: pick('stress', y.id.charCodeAt(0), c.index), dest: { kind: 'yard', grid: gridOf[opposite[y.id]] } };
      }, y.id.charCodeAt(0) * 7);
    }
    return port.units;
  };
  return {
    id: 'roj', label: `Rój ${count} dronów S`, drones: { S: count }, spec, fill,
    note: 'Cztery bloki wymieniają się kontenerami na krzyż: N ↔ S i E ↔ W. Warstwy przelotu wg kursu rozdzielają strumienie w pionie.',
    focus: { x: 0, y: 0, w: 3600, h: 3000 }
  };
}

export const SWARM_SCENARIOS = Object.freeze({
  atlas: atlasLoad,
  wymiana: freighterSwap,
  przeladunek: transship,
  mega: megafreighter,
  port: wholePort,
  roj: swarmStress
});
export const SWARM_SCENARIO_ORDER = Object.freeze(['atlas', 'wymiana', 'przeladunek', 'mega', 'port', 'roj']);

/**
 * Buduje scenariusz: port z kontenerami i listę dronów (klasa + gniazdo). opts.bayIndexOf —
 * indeksy ładowni renderu; opts.droneScale — mnożnik liczby dronów (testy).
 */
export function buildSwarmScenario(id, opts = {}) {
  const make = SWARM_SCENARIOS[id] || SWARM_SCENARIOS.atlas;
  const sc = make(opts.count);
  const spec = { ...sc.spec, bayIndexOf: opts.bayIndexOf || null };
  const port = buildSwarmPort(spec);
  sc.fill(port);
  if (!port.units) port.units = [];
  // Drony: gniazda klasy po kolei.
  const drones = [];
  const padsByClass = new Map();
  for (const ci of port.pads) {
    const k = port.columns[ci].classId;
    if (!padsByClass.has(k)) padsByClass.set(k, []);
    padsByClass.get(k).push(ci);
  }
  const scale = opts.droneScale ?? 1;
  for (const [classId, count] of Object.entries(sc.drones)) {
    const pads = padsByClass.get(classId) || [];
    const n = Math.min(pads.length, Math.max(1, Math.round(count * scale)));
    for (let k = 0; k < n; k++) drones.push({ index: drones.length, classId, pad: pads[k] });
  }
  return { ...sc, port, drones };
}
