/**
 * PORT ROJU — model miejsca pracy dronów przeładunkowych (demo dema/roj-webgpu.html, opis
 * docs/webgpu/DEMO-ROJ.md). Czysta logika: bez three, bez DOM. Wspólne stałe rekordów CPU ↔ GPU
 * (fazy lotu, zadanie, stan drona, jednostka) — symulacja GPU: src/3d/swarm/swarmSim.js,
 * planista: swarmPlanner.js, wykonawca CPU (testy): swarmExecCpu.js.
 *
 * UKŁAD: świat sceny (x, y = −y gry, z w górę; płaszczyzna gry z = 0) — jak Core3D.
 *
 * JEDNOSTKA = JEDEN KONTENER STANDARDOWY (16 × 8 × 8, decyzja użytkownika 2026-10-06). Dron niesie
 * płaską warstwę (chwyt klasy: S 1, M 2, L 4, Capital 8 kontenerów — swarmDrones.js).
 *
 * KOLUMNA = miejsce stosu: slot ładowni (obrys modułu cargoBays.js × warstwy, dno ładowni) albo
 * pole placu (obrys chwytu klasy bloku × poziomy). Obrys to cnx × cny KOMÓREK (kontenerów w
 * warstwie, dłuższym bokiem wzdłuż kursu kolumny); komórka k = iy · cnx + ix, jej środek względem
 * środka kolumny: ((ix − (cnx − 1) / 2) · 16,25; (iy − (cny − 1) / 2) · 8,25) — jak swarmPackSlotOffset.
 * W kolumnie pracuje każda klasa, której chwyt dzieli obrys bez reszty (swarmPackTiles): bierze
 * PODBLOK (ox, oy) — warstwę swojego chwytu; zamek kolumny jest jeden (jeden dron w szybie).
 * Kolumny należą do SIATEK (ładownia, blok placu, pole gniazd) — sąsiedztwo (i ± 1, j ± 1)
 * liczy się w siatce; klasa siatki = największa klasa, która ją obsługuje (wysokości wejść).
 *
 * WYSOKOŚCI LOTU (rozdział ruchu w pionie zamiast walki o miejsce w poziomie):
 *   • WEJŚCIE kolumny (punkt nad nią, gdzie dron kończy lot swobodny i schodzi pionowo) — jedna
 *     wysokość na siatkę; nad nim pasmo PODEJŚCIA (wejście + wysokość drona z kontenerem), w którym
 *     drony poruszają się w bok nad siatką; zejście, chwyt i wznoszenie to tor PIONOWY w obrysie
 *     kolumny (obrysy sąsiadów są rozłączne — szczelina modułów ≥ 1 j.), a wyjście z kolumny to
 *     pionowe wzniesienie do pasma podejścia (src/3d/swarm/swarmSim.js — profil wolnego lotu);
 *   • WARSTWY PRZELOTU nad wszystkimi wejściami: kurs drona wybiera warstwę (4 ćwiartki kursu —
 *     „reguła półokręgu” jak w lotnictwie), więc strumienie przeciwne i krzyżujące się lecą na
 *     różnych wysokościach.
 */

import { CARGO_BAY_HULLS, CARGO_CONTAINER, cargoHullBays, cargoBaySlots, cargoBayToShip, cargoShipToWorld, cargoBayWorldYaw } from '../../data/cargoBays.js';
import {
  SWARM_CELL_PITCH, SWARM_DRONE_CLASSES, SWARM_MAX_PACK, swarmClassForFootprint, swarmContainerMass, swarmDroneClass
} from '../../data/swarmDrones.js';
import { RESOURCES } from '../../data/resources.js';

// ============================================================
// Rekordy wspólne CPU ↔ GPU
// ============================================================

/** Fazy drona (stan na GPU, odczyt planisty). */
export const SWARM_PHASE = Object.freeze({
  PARKED: 0,      // w gnieździe na pokładzie
  LAUNCH: 1,      // pionowo z gniazda do wejścia gniazda
  TO_PICK: 2,     // lot swobodny do wejścia kolumny źródła
  ALIGN_PICK: 3,  // zawis nad kolumną: pozycja i kurs (prowadzony)
  DESC_PICK: 4,   // zejście pionowe do wierzchu kontenera, ramiona się rozkładają
  GRIP: 5,        // szczęki się zamykają
  ASC_PICK: 6,    // wznoszenie z kontenerem do wejścia
  TO_DROP: 7,     // lot swobodny z ładunkiem do wejścia kolumny celu
  ALIGN_DROP: 8,
  DESC_DROP: 9,
  RELEASE: 10,    // szczęki się otwierają, kontener stoi
  ASC_DROP: 11,   // wznoszenie, ramiona się składają
  RETURN: 12,     // lot swobodny do wejścia gniazda (bez zadań)
  LAND: 13        // pionowo do gniazda
});
export const SWARM_PHASE_NAMES = Object.freeze(Object.keys(SWARM_PHASE));
/** Fazy prowadzone (tor pionowy, bez unikania — tor zapewnia planista i siatka kolumn). */
export function swarmPhaseGuided(phase) {
  return phase === SWARM_PHASE.LAUNCH || phase === SWARM_PHASE.LAND || phase === SWARM_PHASE.PARKED ||
    (phase >= SWARM_PHASE.ALIGN_PICK && phase <= SWARM_PHASE.ASC_PICK) ||
    (phase >= SWARM_PHASE.ALIGN_DROP && phase <= SWARM_PHASE.ASC_DROP);
}

/** Zadanie: 8 × vec4 (pierścień 2 zadań na drona — pisze tylko CPU). */
export const SWARM_TASK_VEC4 = 8;
export const SWARM_TASK_FLOATS = SWARM_TASK_VEC4 * 4;
export const SWARM_TASK_RING = 2;
export const SWARM_TASK = Object.freeze({
  PICK: 0,     // x, y, zChwytu (hak = wierzch warstwy), kurs drona w chwycie (planista wybiera kurs kolumny albo +π)
  DROP: 1,     // x, y, zOdłożenia (hak = wierzch warstwy w celu), kurs drona przy odłożeniu
  ALT: 2,      // wejście źródła z, wejście celu z, ładownia źródła (światło), ładownia celu
  IDS: 3,      // liczba kontenerów w chwycie, numer zadania, kolumna źródła, kolumna celu
  LEVELS: 4,   // kontenery w kolumnie źródła PRZED chwytem, w kolumnie celu PRZED odłożeniem, wysokość H, flagi
  CEIL: 5,     // pasmo podejścia nad siatką źródła, nad siatką celu (ruch w bok tylko tam), —, —
  UNITS_A: 6,  // kontenery chwytu w miejscach 0…3 (k = py · nx + px w układzie drona) / −1
  UNITS_B: 7   // kontenery chwytu w miejscach 4…7 / −1
});

/** Rekord drona na GPU: 11 × vec4. */
export const SWARM_DRONE_VEC4 = 11;
export const SWARM_DRONE = Object.freeze({
  POSE: 0,     // x, y, z (hak), kurs
  VEL: 1,      // vx, vy, vz, prędkość kątowa
  VNEW: 2,     // nowa prędkość (krok sterowania → całkowanie), nowa prędkość kątowa
  CTL: 3,      // faza, zegar fazy, wykonane zadania (numer bieżącego), warstwa
  LOOK: 4,     // rozłożenie ramion e, zacisk g, ciąg 0…1, kod stanu (barwa listwy)
  MOTION: 5,   // przyspieszenie (x, y, z) — RCS, czas czekania (statystyka)
  INFO: 6,     // klasa, ziarno, ładownia (światło) / −1, widoczny 0/1
  NBR: 7,      // dla sąsiadów: waga pierwszeństwa, promień poziomy, dół, góra (względem haka)
  NEST: 8,     // gniazdo: x, y, z haka w gnieździe, z wejścia gniazda
  LEG: 9,      // początek odcinka lotu: x, y, z, wysokość przelotu odcinka
  AUX: 10      // niesione kontenery (liczba) / −1, kolumna do zwolnienia / −1, kurs docelowy, kolumna zajęta / −1
});
/** Stan drona do odczytu na CPU (vec4): faza, wykonane zadania, niesione kontenery, czas czekania. */
export const SWARM_STATUS_FLOATS = 4;

/** Jednostka (kontener standardowy): 2 × vec4. */
export const SWARM_UNIT_VEC4 = 2;
export const SWARM_UNIT = Object.freeze({
  POSE: 0,     // x, y, z podstawy, kurs
  INFO: 1      // ładownia (światło) / −1, widoczna 0/1, przewoźnik / −1, miejsce w chwycie (0…7)
});

/** Środek komórki k kolumny o obrysie cnx × cny względem środka kolumny (oś a wzdłuż kursu). */
export function swarmCellOffset(cnx, cny, k, out = {}) {
  const ix = k % cnx;
  const iy = Math.floor(k / cnx);
  out.a = (ix - (cnx - 1) / 2) * SWARM_CELL_PITCH.a;
  out.b = (iy - (cny - 1) / 2) * SWARM_CELL_PITCH.b;
  return out;
}

/** Środek podbloku (ox, oy) chwytu pnx × pny w kolumnie cnx × cny względem środka kolumny. */
export function swarmSubBlockOffset(cnx, cny, ox, oy, pnx, pny, out = {}) {
  out.a = (ox + (pnx - 1) / 2 - (cnx - 1) / 2) * SWARM_CELL_PITCH.a;
  out.b = (oy + (pny - 1) / 2 - (cny - 1) / 2) * SWARM_CELL_PITCH.b;
  return out;
}

/** Punkt w układzie kolumny (a, b) → świat sceny (x, y). */
export function swarmColumnToWorld(col, a, b, out = {}) {
  const c = Math.cos(col.yaw);
  const s = Math.sin(col.yaw);
  out.x = col.x + c * a - s * b;
  out.y = col.y + s * a + c * b;
  return out;
}

export { SWARM_MAX_PACK };

/** Kody stanu (barwa listwy i światła stanu). */
export const SWARM_STATUS_CODE = Object.freeze({ PARKED: 0, EMPTY: 1, LOADED: 2, DOCKING: 3, WAITING: 4, GRIP: 5 });

// ============================================================
// Parametry portu
// ============================================================

export const SWARM_PORT_PARAMS = Object.freeze({
  hullTop: 5,           // wierzch kadłuba (wieżyczki, skrzydła wrót odstawione na poszyciu) [z]
  entryClear: 4,        // zapas pod ładunkiem w punkcie wejścia nad przeszkodą
  levelClear: 2.5,      // zapas pionowy między poziomami wejść sąsiednich kolumn
  layerClear: 5,        // zapas między warstwami przelotu
  layerCount: 4,        // warstwy przelotu (ćwiartki kursu)
  yardGap: { S: 2.5, M: 2.5, L: 3.5, C: 5 },
  padGap: 3,
  deckZ: 0              // wierzch pokładu placu i gniazd
});

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Hash 32-bit → [0, 1) (ziarna scen). */
export function swarmHash01(a, b = 0, c = 0) {
  let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15) ^ ((c | 0) * 0x27d4eb2d), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Poziom wejścia kolumny w siatce: szachownica (i + j) mod 2 — dolatujące drony nad sąsiednimi
 * (w osiach) kolumnami kończą na różnych wysokościach. Ruch w bok nad siatką tylko w paśmie
 * PODEJŚCIA nad obydwoma poziomami (ceilZ); zejście z pasma do wejścia i wyjście w górę —
 * pionowo, dokładnie nad własną kolumną (swarmSim.js) — szyby sąsiadów nigdy nie są przecinane.
 */
export function swarmEntryLevel(i, j) {
  return (i + j) & 1;
}
export const SWARM_ENTRY_LEVELS = 2;

/** Pionowy zasięg drona z ładunkiem (dół … góra względem haka) — rozdział poziomów wejść. */
function loadedSpan(classId) {
  const c = swarmDroneClass(classId);
  return c.extents.loaded.zHi - c.extents.loaded.zLo;
}

// ============================================================
// Budowa portu
// ============================================================

/**
 * Port z opisu sceny:
 *   ships: [{ id, hull, x, y, angle }] — poza GRY (x, y w dół, kąt gry, jak cargoShipToWorld);
 *   yards: [{ id, classId, x, y, yaw, cols, rows, levels }] — bloki placu (świat sceny);
 *   pads:  [{ id, classId, x, y, yaw, cols, rows }] — pola gniazd dronów (świat sceny);
 *   obstacles: [{ x, y, yaw, L, W, top }] — inne przeszkody (wieża, maszty) — prostokąty;
 *   bayIndexOf(shipId, bayIdx) → indeks w tablicy ładowni renderu (światło) — opcjonalnie.
 * Zwraca { grids, columns, ships, pads, obstacles, layers, bounds }.
 */
export function buildSwarmPort(spec) {
  const P = SWARM_PORT_PARAMS;
  const grids = [];
  const columns = [];
  const ships = [];
  const addGrid = (g) => {
    g.index = grids.length;
    g.columns = [];
    g.cellMap = new Int32Array(Math.max(1, g.cols * g.rows)).fill(-1);
    grids.push(g);
    return g;
  };
  const addColumn = (g, i, j, x, y, yaw, zBase, levels) => {
    const c = {
      index: columns.length, grid: g.index, i, j, x, y, yaw, zBase, levels,
      cnx: g.cnx, cny: g.cny, cells: g.cnx * g.cny,
      classId: g.classId, kind: g.kind, owner: g.owner, bay: g.bay,
      entryZ: 0, ceilZ: 0
    };
    columns.push(c);
    g.columns.push(c.index);
    if (i >= 0 && j >= 0 && i < g.cols && j < g.rows) g.cellMap[j * g.cols + i] = c.index;
    return c;
  };

  // --- statki: ładownie → siatki kolumn (slot = obrys modułu × nz warstw, dno ładowni) ---
  for (const s of spec.ships || []) {
    const hull = CARGO_BAY_HULLS[s.hull];
    if (!hull) throw new Error(`swarmPort: nieznany kadłub ${s.hull}`);
    const pose = { x: s.x || 0, y: s.y || 0, angle: s.angle || 0 };
    const yaw = cargoBayWorldYaw(pose);
    const ship = { id: s.id || s.hull, hull: s.hull, pose, yaw, grids: [], bays: [] };
    const bays = cargoHullBays(hull);
    bays.forEach((geo, bi) => {
      const cnx = geo.module.nx;
      const cny = geo.module.ny;
      const classId = swarmClassForFootprint(cnx, cny);
      const center = cargoShipToWorld(pose, geo.cx, geo.cy, {});
      const g = addGrid({
        kind: 'hold', owner: ship.id, classId, bay: spec.bayIndexOf ? spec.bayIndexOf(ship.id, bi) : -1,
        x: center.x, y: center.y, yaw, cols: geo.cols, rows: geo.rows, pitchA: geo.pitchA, pitchB: geo.pitchB,
        a0: geo.a0, b0: geo.b0, levels: geo.module.nz, cnx, cny, zBase: -geo.depth, obstacleTop: P.hullTop, geo, ship: ship.id
      });
      for (const sl of cargoBaySlots(geo)) {
        const p = cargoBayToShip(geo, sl.a, sl.b, {});
        const w = cargoShipToWorld(pose, p.x, p.y, {});
        addColumn(g, sl.col, sl.row, w.x, w.y, yaw, -geo.depth, geo.module.nz);
      }
      ship.grids.push(g.index);
      ship.bays.push({ geo, grid: g.index, center, classId });
    });
    // Środek masy docelowy = środek kadłuba (układ statku 0, 0); oś a = kurs statku.
    ship.center = cargoShipToWorld(pose, 0, 0, {});
    ships.push(ship);
  }

  // --- bloki placu: siatki kolumn (obrys chwytu klasy bloku, kilka poziomów, pokład z = deckZ) ---
  for (const y of spec.yards || []) {
    const cls = SWARM_DRONE_CLASSES[y.classId];
    const gap = P.yardGap[y.classId] ?? 3;
    const pitchA = cls.payload.L + gap;
    const pitchB = cls.payload.W + gap;
    const levels = Math.max(1, y.levels | 0);
    const g = addGrid({
      kind: 'yard', owner: y.id || 'plac', classId: y.classId, bay: -1,
      x: y.x || 0, y: y.y || 0, yaw: y.yaw || 0, cols: y.cols, rows: y.rows, pitchA, pitchB,
      a0: -((y.cols - 1) * pitchA) / 2, b0: -((y.rows - 1) * pitchB) / 2, cnx: cls.pack.nx, cny: cls.pack.ny,
      levels, zBase: P.deckZ, obstacleTop: P.deckZ + levels * CARGO_CONTAINER.H, label: y.label || null
    });
    const c = Math.cos(g.yaw);
    const s = Math.sin(g.yaw);
    for (let j = 0; j < y.rows; j++) {
      for (let i = 0; i < y.cols; i++) {
        const a = g.a0 + i * pitchA;
        const b = g.b0 + j * pitchB;
        addColumn(g, i, j, g.x + c * a - s * b, g.y + s * a + c * b, g.yaw, P.deckZ, levels);
      }
    }
  }

  // --- pola gniazd: kolumny bez poziomów (dron siedzi na pokładzie) ---
  const pads = [];
  for (const p of spec.pads || []) {
    const cls = SWARM_DRONE_CLASSES[p.classId];
    const pitch = 2 * cls.padRadius + P.padGap;
    const g = addGrid({
      kind: 'pad', owner: p.id || 'gniazda', classId: p.classId, bay: -1,
      x: p.x || 0, y: p.y || 0, yaw: p.yaw || 0, cols: p.cols, rows: p.rows, pitchA: pitch, pitchB: pitch,
      a0: -((p.cols - 1) * pitch) / 2, b0: -((p.rows - 1) * pitch) / 2, cnx: 1, cny: 1,
      levels: 0, zBase: P.deckZ, obstacleTop: P.deckZ + 2
    });
    const c = Math.cos(g.yaw);
    const s = Math.sin(g.yaw);
    for (let j = 0; j < p.rows; j++) {
      for (let i = 0; i < p.cols; i++) {
        const a = g.a0 + i * pitch;
        const b = g.b0 + j * pitch;
        const col = addColumn(g, i, j, g.x + c * a - s * b, g.y + s * a + c * b, g.yaw, P.deckZ, 0);
        pads.push(col.index);
      }
    }
  }

  // --- wysokości wejść (szachownica 2 × 2 poziomów w każdej siatce) ---
  let entryTop = 0;
  let maxSpan = 0;
  for (const g of grids) {
    const cls = SWARM_DRONE_CLASSES[g.classId];
    const span = loadedSpan(g.classId);
    maxSpan = Math.max(maxSpan, span);
    // Wejście 0: warstwa pod hakiem (H) nad przeszkodą siatki + zapas; gniazda — pusty dron.
    const base = g.kind === 'pad'
      ? g.obstacleTop + P.entryClear - cls.extents.empty.zLo + 6
      : g.obstacleTop + cls.payload.H + P.entryClear + 0.3;
    g.entry0 = base;
    g.dEntry = span + P.levelClear;
    g.ceilZ = base + SWARM_ENTRY_LEVELS * g.dEntry;
    for (const ci of g.columns) {
      const col = columns[ci];
      col.entryZ = base + swarmEntryLevel(col.i, col.j) * g.dEntry;
      col.ceilZ = g.ceilZ;
    }
    entryTop = Math.max(entryTop, g.ceilZ);
  }

  // --- warstwy przelotu nad wszystkimi wejściami ---
  const obstacles = (spec.obstacles || []).map((o) => ({ ...o }));
  for (const o of obstacles) entryTop = Math.max(entryTop, Math.min(o.top, entryTop + 30));
  const layerDZ = maxSpan + P.layerClear;
  const layers = { z0: entryTop + 0.5 * layerDZ, dz: layerDZ, count: P.layerCount };

  // --- granice (mapa przeszkód) ---
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const grow = (x, y, r) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  for (const s of ships) {
    const H = CARGO_BAY_HULLS[s.hull];
    const sc = H.renderLength / Math.max(H.png.w, H.png.h);
    grow(s.center.x, s.center.y, 0.55 * Math.hypot(H.png.w * sc, H.png.h * sc));
  }
  for (const c of columns) grow(c.x, c.y, 80);
  for (const o of obstacles) grow(o.x, o.y, Math.hypot(o.L, o.W));
  const pad = 300;
  const bounds = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };

  return { grids, columns, ships, pads, obstacles, layers, bounds, spec };
}

/** Sąsiedzi kolumny w jej siatce (8 kierunków). */
export function swarmColumnNeighbors(port, colIndex) {
  const c = port.columns[colIndex];
  const g = port.grids[c.grid];
  const out = [];
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = c.i + di;
      const j = c.j + dj;
      if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) continue;
      const ci = g.cellMap[j * g.cols + i];
      if (ci >= 0) out.push(ci);
    }
  }
  return out;
}

// ============================================================
// Ładunek początkowy
// ============================================================

/** Kategoria surowca (gęstość ładunku). */
export function swarmResourceCategory(resourceId) {
  return RESOURCES[String(resourceId || '')]?.category || 'component';
}

/**
 * Kontenery w kolumnach, warstwa po warstwie: fill(col, poziom) → null (koniec stosu) albo
 * { resource, dest, n } — warstwa jednego towaru i jednego celu w n pierwszych komórkach (domyślnie
 * cały obrys; niepełna warstwa kończy stos — nic nie stoi nad pustą komórką). Zwraca listę
 * [{ id, resource, category, mass, col, level, cell, dest, seed }] (dest: { kind: 'yard', grid? } |
 * { kind: 'ship', ship } | null = zostaje).
 */
export function swarmFillColumns(port, filter, fill, seed = 1) {
  const units = port.units || (port.units = []);
  for (const c of port.columns) {
    if (!filter(c)) continue;
    for (let k = 0; k < c.levels; k++) {
      const r = fill(c, k);
      if (!r) break;
      const category = swarmResourceCategory(r.resource);
      const n = Math.max(0, Math.min(c.cells, r.n ?? c.cells));
      for (let cell = 0; cell < n; cell++) {
        units.push({
          id: units.length, resource: r.resource, category,
          mass: swarmContainerMass(category), col: c.index, level: k, cell,
          dest: r.dest || null, seed: Math.floor(swarmHash01(seed, units.length, 3) * 1e6)
        });
      }
      if (n < c.cells) break;
    }
  }
  return units;
}

/** Kontenery w kolumnach (liczba na kolumnę) — stan początkowy liczników kolumn GPU. */
export function swarmColumnCounts(port) {
  const out = new Int32Array(port.columns.length);
  for (const u of port.units || []) out[u.col]++;
  return out;
}

/** Poza kontenera w komórce (świat sceny): środek podstawy i kurs kolumny. */
export function swarmUnitRestPose(port, u, out = {}) {
  const c = port.columns[u.col];
  const o = swarmCellOffset(c.cnx, c.cny, u.cell, {});
  swarmColumnToWorld(c, o.a, o.b, out);
  out.z = c.zBase + u.level * CARGO_CONTAINER.H;
  out.yaw = c.yaw;
  return out;
}

// ============================================================
// Mapa przeszkód (wysokość wierzchu przeszkód na siatce xy)
// ============================================================

/**
 * Mapa wysokości przeszkód: Float32Array W × H (wiersz j = y), wartość = najwyższy wierzch
 * przeszkody w komórce (−1e4 = pusto). Kadłuby: maska z obrazu (shipMask(ship, x, y) → bool,
 * świat sceny) albo prostokąt sprite'a × 0,92; bloki placu — pełne stosy (zachowawczo), pola
 * gniazd i wieże — prostokąty. Ładownie: pokrywa kadłuba (wolny lot nie schodzi do ładowni —
 * tylko tor pionowy w kolumnie).
 */
export function buildSwarmHeightfield(port, { cell = 6, shipMask = null, maxCells = 1 << 21 } = {}) {
  const b = port.bounds;
  let cs = cell;
  let W = Math.ceil((b.x1 - b.x0) / cs);
  let H = Math.ceil((b.y1 - b.y0) / cs);
  while (W * H > maxCells) { cs *= 1.25; W = Math.ceil((b.x1 - b.x0) / cs); H = Math.ceil((b.y1 - b.y0) / cs); }
  const data = new Float32Array(W * H).fill(-1e4);
  const P = SWARM_PORT_PARAMS;
  const stampRect = (cx, cy, yaw, L, Wd, top) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hx = L / 2;
    const hy = Wd / 2;
    const r = Math.hypot(hx, hy);
    const i0 = clamp(Math.floor((cx - r - b.x0) / cs), 0, W - 1);
    const i1 = clamp(Math.floor((cx + r - b.x0) / cs), 0, W - 1);
    const j0 = clamp(Math.floor((cy - r - b.y0) / cs), 0, H - 1);
    const j1 = clamp(Math.floor((cy + r - b.y0) / cs), 0, H - 1);
    for (let j = j0; j <= j1; j++) {
      const y = b.y0 + (j + 0.5) * cs - cy;
      for (let i = i0; i <= i1; i++) {
        const x = b.x0 + (i + 0.5) * cs - cx;
        const lx = c * x + s * y;
        const ly = -s * x + c * y;
        if (Math.abs(lx) <= hx + cs * 0.5 && Math.abs(ly) <= hy + cs * 0.5) {
          const k = j * W + i;
          if (data[k] < top) data[k] = top;
        }
      }
    }
  };
  for (const s of port.ships) {
    const Hh = CARGO_BAY_HULLS[s.hull];
    const sc = Hh.renderLength / Math.max(Hh.png.w, Hh.png.h);
    const w = Hh.png.w * sc;
    const h = Hh.png.h * sc;
    if (shipMask) {
      const r = 0.5 * Math.hypot(w, h);
      const i0 = clamp(Math.floor((s.center.x - r - b.x0) / cs), 0, W - 1);
      const i1 = clamp(Math.floor((s.center.x + r - b.x0) / cs), 0, W - 1);
      const j0 = clamp(Math.floor((s.center.y - r - b.y0) / cs), 0, H - 1);
      const j1 = clamp(Math.floor((s.center.y + r - b.y0) / cs), 0, H - 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = b.x0 + (i + 0.5) * cs;
          const y = b.y0 + (j + 0.5) * cs;
          if (shipMask(s, x, y)) {
            const k = j * W + i;
            if (data[k] < P.hullTop) data[k] = P.hullTop;
          }
        }
      }
    } else {
      stampRect(s.center.x, s.center.y, s.yaw, w * 0.92, h * 0.92, P.hullTop);
    }
  }
  for (const g of port.grids) {
    if (g.kind === 'hold') continue;
    const L = g.cols * g.pitchA + 8;
    const Wd = g.rows * g.pitchB + 8;
    stampRect(g.x, g.y, g.yaw, L, Wd, g.obstacleTop);
  }
  for (const o of port.obstacles) stampRect(o.x, o.y, o.yaw || 0, o.L, o.W, o.top);
  return { data, W, H, x0: b.x0, y0: b.y0, cell: cs };
}

/** Wysokość przeszkód w punkcie (próbka komórki — lustro shadera). */
export function swarmHeightAt(hf, x, y) {
  const i = Math.floor((x - hf.x0) / hf.cell);
  const j = Math.floor((y - hf.y0) / hf.cell);
  if (i < 0 || j < 0 || i >= hf.W || j >= hf.H) return -1e4;
  return hf.data[j * hf.W + i];
}

/** Warstwa przelotu dla kursu (ćwiartki: 0 = wschód ±45°, 1 = północ, 2 = zachód, 3 = południe). */
export function swarmLayerForHeading(dx, dy, count = SWARM_PORT_PARAMS.layerCount) {
  const a = Math.atan2(dy, dx);
  const q = Math.floor(((a + Math.PI / 4) / (Math.PI / 2)) + 4) % 4;
  return q % count;
}
