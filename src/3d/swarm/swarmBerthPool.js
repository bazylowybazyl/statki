// src/3d/swarm/swarmBerthPool.js
//
// ROJ Z DEMA W GRZE — PULA STANOWISK (E12, decyzja użytkownika 2026-10-22: „spróbujmy na żywo liczone na GPU”).
// Jedna symulacja GPU (swarmSim.js: lot, ORCA, zamki kolumn, kontenery) liczy rój przy WIELU stanowiskach naraz; każde
// stanowisko to SLOT puli: stałe zakresy dronów, zadań, kontenerów i kolumn oraz własny prostokąt przestrzeni symulacji
// (oś statku wzdłuż x, bez obrotu — float32 bez drżenia; sloty daleko od siebie, więc ORCA nie łączy stanowisk). Wieża
// portu (swarmPlanner.js — księga kontenerów, chwyty, sztauowanie) to obiekt na slot: czyta stan swoich dronów z
// odczytu GPU (MAP_READ, asynchronicznie, 1–3 klatki spóźnienia — bez czekania w klatce) i pisze zadania przez adapter
// (indeksy kolumn, kontenerów i dronów slotu → globalne). Dołączenie i zwolnienie slotu to wpisy zakresów buforów —
// bez przebudowy pipeline'ów. Obraz: materiały roju z ramą slotów (swarmSlotFrame.js: slot → świat względem początku
// przy kamerze), drony klas przez mapę indeksów (klasy różnych slotów nie leżą ciągiem), światła jednym rysunkiem.
//
// Zegar: rój = czas gry × 4 (decyzja użytkownika 2026-10-06), krok stały 1/60 s czasu roju jak w demie; pauza = 0.
// Krok compute: Core3D.addFxStep (raz na klatkę, przed passami), rozgrzewka kerneli w `warm`. Krok i odczyt liczą się
// TYLKO, gdy któryś slot pracuje (rój ruszył i nie skończył) — sloty istnieją tylko dla stanowisk w ramce gry (kadr
// z zapasem), więc poza portem i przy samych taśmach / stanie z zegara koszt GPU i poleceń kolejki = 0.
//
// Szew: bez `window`, DOM i stanu gry — stanowiska, statki i zegar postoju podaje portCargo3D.js (blok `cargoOps`).
import * as THREE from 'three/webgpu';
import { instancedArray } from 'three/tsl';
import { SwarmSim } from './swarmSim.js';
import { SwarmDroneLights, SwarmDroneMeshes } from './swarmDrones.tsl.js';
import { SwarmShadows, SwarmUnits } from './swarmUnits.tsl.js';
import { buildSwarmDroneGeometries } from './swarmDroneModel.js';
import { createSwarmSlotFrames } from './swarmSlotFrame.js';
import { containerLookLinear } from '../cargo/containers.tsl.js';
import {
  SWARM_DRONE, SWARM_DRONE_VEC4, SWARM_PHASE, SWARM_STATUS_CODE, SWARM_TASK, SWARM_TASK_FLOATS, SWARM_TASK_RING,
  SWARM_TASK_VEC4, SWARM_UNIT_VEC4, buildSwarmHeightfield, buildSwarmPort, swarmHash01, swarmResourceCategory,
  swarmUnitRestPose
} from '../../game/swarm/swarmPort.js';
import { createSwarmPlanner } from '../../game/swarm/swarmPlanner.js';
import { BERTH_TRANSFER_TUNE } from '../../game/swarm/berthTransfer.js';
import { SWARM_DRONE_CLASS_LIST, swarmContainerMass, swarmDroneClass } from '../../data/swarmDrones.js';
import { CARGO_CONTAINER, cargoHullBays } from '../../data/cargoBays.js';

export const SWARM_POOL_TUNE = {
  /** Stanowisk liczonych na żywo (N) — reszta pokazuje stan z zegara postoju bez dronów (portCargo3D). */
  slots: 8,
  dronesPerSlot: 48,
  unitsPerSlot: 1536,
  colsPerSlot: 640,
  /** Odstęp slotów w przestrzeni symulacji (oś y) i pół szerokości prostokąta slotu (oś x) [j.]. */
  slotPitch: 1800,
  slotHalfX: 2000,
  /** Komórka mapy przeszkód [j.]. */
  hfCell: 12,
  /** Zegar roju = czas gry × clock; najwyżej tyle kroków 1/60 s na klatkę (przy niskim FPS rój zwalnia). */
  clock: 4,
  maxSteps: 8,
  /** Poziomy stosów stołu przeładunkowego (plac przy burcie). */
  yardLevels: 4,
  /** Gęstość roju jak w demie (wymiana frachtowca: 96 L na 760 kursów): dron na tyle warstw, w granicach. */
  layersPerDrone: 8,
  /** Czas roju na kurs jednej warstwy z czekaniem przy kolumnach (pomiar w grze: plac ~115 j. pod statkiem) [s]. */
  swarmSecPerLayer: 60,
  minDronesPerSide: 1,
  /** Przyjazd ładunku taśmą (LOAD) przed startem roju i odjazd (UNLOAD) po końcu pracy [s gry]. */
  beltLead: 6,
  beltDrain: 10,
  /** Slot bez stanu (statek znikł z ramki) czeka tyle czasu gry, zanim zacznie się zwalniać [s]. */
  missingGrace: 1.5
};

const T = SWARM_POOL_TUNE;
const DV = SWARM_DRONE_VEC4;
const DR = SWARM_DRONE;
const TV = SWARM_TASK_VEC4;
const TK = SWARM_TASK;
const UV = SWARM_UNIT_VEC4;
const CLASS_N = SWARM_DRONE_CLASS_LIST.length;
const C = CARGO_CONTAINER;
const FAR_Z = -6000;
/** Kolejka przezroczysta cieni dronów (po proxy kadłubów 10 i skrzydłach wrót 11, przed taśmami 11,5). */
const SWARM_SHADOW_ORDER = 11.2;

/** Słoty kolejnych klas: drony klasy c w mapie indeksów od c × maxDrones. */
export function createSwarmBerthPool(Core3D) {
  const maxDrones = T.slots * T.dronesPerSlot;
  const maxUnits = T.slots * T.unitsPerSlot;
  const maxCols = T.slots * T.colsPerSlot;
  const hfW = Math.ceil((2 * T.slotHalfX) / T.hfCell);
  const hfRowsPerSlot = Math.ceil(T.slotPitch / T.hfCell);
  const hfH = hfRowsPerSlot * T.slots;
  // Sloty wzdłuż osi y przestrzeni symulacji, środek puli w 0 (liczby małe); wiersze mapy przeszkód slotu — ciąg.
  const HF_Y0 = -(T.slots * T.slotPitch) / 2;
  const slotCenterY = (k) => HF_Y0 + (k + 0.5) * T.slotPitch;
  let sim = null;
  let frame = null;
  let remap = null;
  let droneMeshes = null;
  let droneLights = null;
  let units = null;
  let shadows = null;
  let stepRegistered = false;
  let ready = false;
  let pendingDt = 0;
  let readbackTick = 0;
  let nDrones = 0;
  /** Sloty, przy których rój pracuje w tej klatce (started && !finished) — bez nich krok i odczyt stoją. */
  let working = 0;
  const slots = Array.from({ length: T.slots }, (_, k) => ({ k, active: false, key: null }));
  const classLists = Array.from({ length: CLASS_N }, () => []);
  const ranges = SWARM_DRONE_CLASS_LIST.map((cls) => ({ classIndex: cls.index, base: cls.index * maxDrones, count: 0 }));
  const lightRange = [{ classIndex: 0, base: 0, count: 0 }];
  const taskTmp = new Float32Array(SWARM_TASK_FLOATS);
  const stats = { slots: 0, drones: 0, units: 0, steps: 0, planMs: 0, activateMs: 0, done: 0, total: 0 };
  let hfLayers = null;

  function ensure() {
    if (ready || !Core3D.scene) return ready;
    sim = new SwarmSim({ maxDrones, maxUnits, maxColumns: maxCols, hfCells: hfW * hfH });
    frame = createSwarmSlotFrames(T.slots, T.dronesPerSlot, T.unitsPerSlot);
    remap = instancedArray(CLASS_N * maxDrones, 'uint').setName('swarmDroneRemap');
    frame.remap = remap;
    const geos = buildSwarmDroneGeometries(THREE);
    droneMeshes = new SwarmDroneMeshes(Core3D.scene, sim.drones, geos, frame);
    droneLights = new SwarmDroneLights(Core3D.scene, sim.drones, frame);
    units = new SwarmUnits(Core3D.scene, sim.units, maxUnits, frame);
    // Cienie dronów na kadłubie jak w demie (GREATER na głębi proxy — po proxy, 10, i skrzydłach wrót, 11; przed
    // taśmami, kontenerami i dronami). Cieni kontaktu kontenerów nie ma: w grze kontenery stoją pod płaszczyzną
    // cieni (ładownia, stoły), gdzie GREATER i tak ich nie położy.
    shadows = new SwarmShadows(Core3D.scene, sim.drones, sim.units, frame, SWARM_SHADOW_ORDER);
    // Stan startowy puli (pełna wysyłka raz): bez dronów i kontenerów, mapa przeszkód pusta na całą przestrzeń
    // slotów. Dalej tylko zakresy (dołączenie / zwolnienie slotu) — pełna wysyłka nadpisałaby stan z GPU.
    hfLayers = referenceLayers();
    sim.init({ drones: [], units: [], heights: new Int32Array(0), hf: { data: new Float32Array(hfW * hfH).fill(-1e4), W: hfW, H: hfH, x0: -T.slotHalfX, y0: HF_Y0, cell: T.hfCell }, layers: hfLayers });
    const D = sim.drones.value.array;
    for (let i = 0; i < maxDrones; i++) parkDrone(D, i, 0, slotCenterY(Math.floor(i / T.dronesPerSlot)));
    sim.drones.value.needsUpdate = true;
    // Instancja kontenera = jednostka bufora (indeks stały); bez wymiarów, dopóki slot nie dostanie wyglądu.
    for (let i = 0; i < maxUnits; i++) units.data[i * 20] = i;
    units.range.start = 0;
    units.range.count = maxUnits * 20;
    units.buffer.needsUpdate = true;
    units.geometry.instanceCount = 0;
    if (!stepRegistered) {
      stepRegistered = true;
      Core3D.addFxStep({ name: 'rój przeładunkowy (E12)', update: stepUpdate, warm: stepWarm });
    }
    ready = true;
    return ready;
  }

  // Warstwy przelotu wspólne dla puli (jeden uniform symulacji): wzorzec — największa klasa (L) nad ładownią
  // przy płaszczyźnie lotu i placem na płycie pola.
  function referenceLayers() {
    const port = buildSwarmPort({
      ships: [{ id: 'wzor', hull: 'heavy_freighter_proxy', x: 0, y: 0 }],
      yards: [{ id: 'plac', classId: 'L', x: 0, y: -400, cols: 2, rows: 1, levels: T.yardLevels, z: BERTH_TRANSFER_TUNE.tableZ }],
      pads: [{ id: 'gn', classId: 'L', x: 300, y: -450, cols: 1, rows: 1, z: -114.5 }]
    });
    return port.layers;
  }

  function parkDrone(D, i, x, y) {
    const o = i * DV * 4;
    D.fill(0, o, o + DV * 4);
    const set = (k, a, b, c, e) => { const q = o + k * 4; D[q] = a; D[q + 1] = b; D[q + 2] = c; D[q + 3] = e; };
    set(DR.POSE, x, y, FAR_Z, 0);
    set(DR.CTL, SWARM_PHASE.PARKED, 0, 0, 0);
    set(DR.LOOK, 0, 0, 0, SWARM_STATUS_CODE.PARKED);
    set(DR.INFO, 0, 0.5, -1, 0);
    set(DR.NBR, 1, 1, 0, 1);
    set(DR.NEST, x, y, FAR_Z, FAR_Z + 10);
    set(DR.LEG, x, y, FAR_Z, FAR_Z + 10);
    set(DR.AUX, -1, -1, 0, -1);
  }

  // Krok efektów (Core3D.fx, raz na klatkę przed passami): kroki roju za czas gry tej klatki × 4 i odczyt stanu.
  function stepUpdate(ctx) {
    const dt = pendingDt;
    pendingDt = 0;
    stats.steps = 0;
    if (!ready || !nDrones || !working || !(dt > 0)) return;
    const n = sim.step(ctx.renderer, dt, 1, T.maxSteps);
    stats.steps = n;
    // Odczyt stanu dla wieży co drugą klatkę (wieża i tak znosi 1–3 klatki spóźnienia), bez statystyk symulacji —
    // mniej poleceń kolejki i mapAsync.
    if (n && (++readbackTick & 1)) sim.requestReadback(ctx.renderer, false);
  }

  // Rozgrzewka (ekran ładowania): kernele symulacji z zerową liczbą dronów — pipeline compute three r183 powstaje
  // synchronicznie przy pierwszym dispatchu, więc tutaj, a nie w klatce gry.
  function stepWarm(ctx) {
    if (!ensure()) return;
    const keep = sim.U.nDrones.value;
    sim.U.nDrones.value = 0;
    for (const k of [sim.kBin, sim.kSteer, sim.kIntegrate]) ctx.renderer.compute(k);
    sim.U.nDrones.value = keep;
  }

  // ---------------------------------------------------------------------------------------------
  // Slot: dołączenie (stan startowy z zegara postoju), wieża, zwolnienie
  // ---------------------------------------------------------------------------------------------

  /**
   * Stanowisko na żywo. o: { key, seed, hull (CARGO_BAY_HULLS), mode ('load'|'unload'), fill, resourceId, progress
   * (0…1 — postęp postoju z zegara kursu: tyle warstw jest już przeniesionych), ship { u, v, angle } (układ stanowiska),
   * yard (berthYardGeometry — stoły i taśmy pola), table (rekord tablicy ładowni — światło) }. Zwraca slot albo null.
   */
  function activate(o) {
    if (!ensure()) return null;
    const slot = slots.find((s) => !s.active);
    if (!slot) return null;
    const t0 = performance.now();
    const k = slot.k;
    const geo = cargoHullBays(o.hull)[0];
    if (!geo) return null;
    const S = { x: 0, y: slotCenterY(k) };
    const cls = swarmDroneClass(swarmClassFromModule(geo.module));
    const yard = o.yard;
    // Stoły w obrysie chwytu klasy drona slotu: warstwa ładowni = warstwa stołu (ta sama liczba komórek).
    const yardCls = cls.id;
    const deckZ = BERTH_TRANSFER_TUNE.deckZ;
    const tableZ = BERTH_TRANSFER_TUNE.tableZ;
    // Port slotu w przestrzeni symulacji: statek (kurs względem osi stanowiska), stoły po burtach (plac), gniazda.
    const sides = yard.sides;
    const spec = {
      ships: [{ id: 'statek', hull: o.hull, x: S.x + o.ship.u, y: -S.y + o.ship.v, angle: o.ship.angle }],
      yards: [],
      pads: [],
      // Rekord tablicy ładowni slotu (światło kontenerów i dronów w ładowni): stały 1 + slot, chyba że podany.
      bayIndexOf: () => (Number.isFinite(o.table) && o.table > 0 ? o.table : 1 + k)
    };
    const ycls = SWARM_DRONE_CLASS_LIST.find((c) => c.id === yardCls);
    const yardGapPitch = ycls.payload.L + ({ S: 2.5, M: 2.5, L: 3.5, C: 5 })[yardCls];
    // Stoły = kolumny placu: liczba i odstęp jak berthYardGeometry (ten sam obraz stołów co bez roju).
    const cols = yard.sides[0].tables.length;
    void yardGapPitch;
    const totalLayers = Math.ceil(Math.max(0, Math.min(geo.containers, Math.ceil(geo.containers * Math.max(0, Math.min(1, o.fill)) - 1e-9))) / (geo.module.nx * geo.module.ny));
    // Drony: gęstość jak w demie (dron na layersPerDrone warstw), a gdy okno jest ciasne — tyle, żeby pozostałe warstwy
    // zdążyły (swarmSecPerLayer — zmierzony czas kursu warstwy z czekaniem, czas roju) w pozostałym oknie × 4.
    const remainLayers = Math.max(0, totalLayers - Math.round(totalLayers * Math.max(0, Math.min(1, o.progress))));
    const remainSwarm = Math.max(20, (Number(o.remainingSec) || 60) * T.clock * 0.85);
    const byTime = Math.ceil(remainLayers * T.swarmSecPerLayer / remainSwarm);
    const dronesTotal = Math.min(T.dronesPerSlot, Math.max(2 * T.minDronesPerSide, Math.ceil(totalLayers / T.layersPerDrone), byTime));
    const perSide = Math.ceil(dronesTotal / 2);
    const padPitch = 2 * cls.padRadius + 3;
    const padCols = Math.max(1, Math.ceil(perSide / 2));
    for (const sd of sides) {
      // Stoły pola (plac) w rzędzie przy burcie; gniazda za taśmą, przy dziobie.
      spec.yards.push({ id: `plac${sd.side}`, classId: yardCls, x: S.x, y: S.y - sd.vTable, yaw: 0, cols, rows: 1, levels: T.yardLevels, z: tableZ });
      const vPad = Math.abs(sd.vBelt) + sd.belt.width / 2 + padPitch;
      spec.pads.push({ id: `gn${sd.side}`, classId: cls.id, x: S.x + yard.padLength / 2 - 40 - padCols * padPitch / 2, y: S.y - Math.sign(sd.vTable) * (vPad + padPitch / 2), yaw: 0, cols: padCols, rows: 2, z: deckZ });
    }
    const port = buildSwarmPort(spec);
    // Kontenery: warstwy w kolejności załadunku (slot po slocie, piętro po piętrze) — widok liczby; przeniesione
    // (postęp z zegara) stoją już u celu: UNLOAD — na stołach, LOAD — w ładowni.
    const hold = port.columns.filter((c) => c.kind === 'hold');
    const yards = port.columns.filter((c) => c.kind === 'yard');
    const unload = o.mode === 'unload';
    const moved = Math.round(totalLayers * Math.max(0, Math.min(1, o.progress)));
    const unitsList = [];
    const seedBase = o.seed | 0;
    const res = o.resourceId || 'steel';
    const category = swarmResourceCategory(res);
    const mass = swarmContainerMass(category);
    const pushLayer = (col, level, dest) => {
      for (let cell = 0; cell < col.cells; cell++) {
        unitsList.push({ id: unitsList.length, resource: res, category, mass, col: col.index, level, cell, dest, seed: Math.floor(swarmHash01(seedBase, unitsList.length, 3) * 1e6) });
      }
    };
    // Warstwy ładowni w kolejności załadunku.
    const holdLayers = [];
    for (const c of hold) for (let lv = 0; lv < c.levels; lv++) holdLayers.push([c, lv]);
    // Stoły: na zmianę burtami, od rufy, stos po stosie (yardSlots — miejsca warstw na placu).
    const yardSlots = [];
    const bySide = [yards.filter((c) => c.y > S.y), yards.filter((c) => c.y <= S.y)];
    for (let lv = 0; lv < T.yardLevels; lv++) {
      for (let i = 0; i < cols; i++) for (const list of bySide) if (list[i]) yardSlots.push([list[i], lv]);
    }
    const yardH = new Int32Array(port.columns.length);
    const takeYard = () => {
      // Najniższy wolny poziom stołu (stosy rosną równo; warstwa nie wisi nad pustym stołem).
      for (const [c] of yardSlots) {
        if (yardH[c.index] < T.yardLevels) { const lv = yardH[c.index]++; return [c, lv]; }
      }
      return null;
    };
    const n = Math.min(totalLayers, holdLayers.length);
    if (unload) {
      // W ładowni: pierwsze (n − moved) warstw (rozładunek bierze od końca); reszta już na stołach.
      for (let i = 0; i < n - moved; i++) pushLayer(holdLayers[i][0], holdLayers[i][1], { kind: 'yard' });
      for (let i = 0; i < moved; i++) { const y = takeYard(); if (y) pushLayer(y[0], y[1], null); }
    } else {
      for (let i = 0; i < moved; i++) pushLayer(holdLayers[i][0], holdLayers[i][1], null);
      for (let i = moved; i < n; i++) { const y = takeYard(); if (y) pushLayer(y[0], y[1], { kind: 'ship', ship: 'statek' }); }
    }
    port.units = unitsList.slice(0, T.unitsPerSlot);
    // Drony: gniazda po burtach.
    const padCols0 = port.columns.filter((c) => c.kind === 'pad');
    const droneDefs = [];
    for (let i = 0; i < dronesTotal && i < padCols0.length; i++) droneDefs.push({ index: i, classId: cls.id, pad: padCols0[i].index });
    // --- zapis do buforów symulacji (zakresy slotu) ---
    const dBase = k * T.dronesPerSlot;
    const uBase = k * T.unitsPerSlot;
    const cBase = k * T.colsPerSlot;
    const D = sim.drones.value.array;
    for (let i = 0; i < T.dronesPerSlot; i++) {
      const gi = dBase + i;
      const d = droneDefs[i];
      if (!d) { parkDrone(D, gi, S.x, S.y); continue; }
      const pad = port.columns[d.pad];
      const z = pad.zBase - cls.extents.empty.zLo + 0.3;
      const o4 = gi * DV * 4;
      D.fill(0, o4, o4 + DV * 4);
      const set = (r, a, b, c, e) => { const q = o4 + r * 4; D[q] = a; D[q + 1] = b; D[q + 2] = c; D[q + 3] = e; };
      set(DR.POSE, pad.x, pad.y, z, pad.yaw);
      set(DR.CTL, SWARM_PHASE.PARKED, 0, 0, 0);
      set(DR.LOOK, 0, 0, 0, SWARM_STATUS_CODE.PARKED);
      set(DR.INFO, cls.index, swarmHash01(seedBase, i, 7), -1, 1);
      set(DR.NBR, 1, 1, 0, 1);
      set(DR.NEST, pad.x, pad.y, z, pad.entryZ);
      set(DR.LEG, pad.x, pad.y, z, pad.entryZ);
      set(DR.AUX, -1, -1, pad.yaw, -1);
    }
    addRange(sim.drones.value, dBase * DV * 4, T.dronesPerSlot * DV * 4);
    const Tk = sim.tasks.value.array;
    for (let i = 0; i < T.dronesPerSlot * SWARM_TASK_RING; i++) {
      const o4 = ((dBase * SWARM_TASK_RING) + i) * TV * 4;
      Tk.fill(0, o4, o4 + TV * 4);
      Tk[o4 + TK.IDS * 4 + 1] = -1;
    }
    addRange(sim.tasks.value, dBase * SWARM_TASK_RING * TV * 4, T.dronesPerSlot * SWARM_TASK_RING * TV * 4);
    const U = sim.units.value.array;
    U.fill(0, uBase * UV * 4, (uBase + T.unitsPerSlot) * UV * 4);
    const rest = {};
    for (const u of port.units) {
      swarmUnitRestPose(port, u, rest);
      const o4 = (uBase + u.id) * UV * 4;
      U[o4] = rest.x; U[o4 + 1] = rest.y; U[o4 + 2] = rest.z; U[o4 + 3] = rest.yaw;
      U[o4 + 4] = port.columns[u.col].bay; U[o4 + 5] = 1; U[o4 + 6] = -1; U[o4 + 7] = 0;
    }
    addRange(sim.units.value, uBase * UV * 4, T.unitsPerSlot * UV * 4);
    const Cl = sim.cols.value.array;
    Cl.fill(0, cBase * 2, (cBase + T.colsPerSlot) * 2);
    for (const u of port.units) Cl[(cBase + u.col) * 2]++;
    addRange(sim.cols.value, cBase * 2, T.colsPerSlot * 2);
    // Mapa przeszkód slotu → wiersze slotu w mapie puli (próbkowanie mapy portu w komórkach puli).
    const hf = buildSwarmHeightfield(port, { cell: T.hfCell, shipMask: null, maxCells: 1 << 20 });
    const H = sim.height.value.array;
    const row0 = k * hfRowsPerSlot;
    const x0 = -T.slotHalfX;
    const y0 = HF_Y0;
    for (let j = 0; j < hfRowsPerSlot; j++) {
      const y = y0 + (row0 + j + 0.5) * T.hfCell;
      for (let i = 0; i < hfW; i++) {
        const x = x0 + (i + 0.5) * T.hfCell;
        const ii = Math.floor((x - hf.x0) / hf.cell);
        const jj = Math.floor((y - hf.y0) / hf.cell);
        H[(row0 + j) * hfW + i] = ii >= 0 && jj >= 0 && ii < hf.W && jj < hf.H ? hf.data[jj * hf.W + ii] : -1e4;
      }
    }
    addRange(sim.height.value, row0 * hfW, hfRowsPerSlot * hfW);
    // Wygląd kontenerów (instancja = jednostka bufora symulacji).
    const ud = units.data;
    for (let i = 0; i < T.unitsPerSlot; i++) {
      const gi = uBase + i;
      const o4 = gi * 20;
      ud[o4] = gi; ud[o4 + 1] = 0; ud[o4 + 2] = 0; ud[o4 + 3] = 0;
      ud[o4 + 4] = C.L; ud[o4 + 5] = C.W; ud[o4 + 6] = C.H; ud[o4 + 7] = 0;
      const u = port.units[i];
      // 16 wariantów wyglądu na towar (pamięć containerLookLinear) — bez napisu-klucza na każdy kontener.
      if (u) ud.set(containerLookLinear(u.resource, 4242, (seedBase + u.id) & 15), o4 + 8);
    }
    unitsRange(uBase, T.unitsPerSlot);
    // Wieża slotu: zadania przez adapter (indeksy slotu → globalne).
    const planner = createSwarmPlanner(port, droneDefs, { mode: 'smart' });
    const writer = (d, serial, rec) => {
      taskTmp.set(rec);
      const ids = TK.IDS * 4;
      if (taskTmp[ids + 2] >= 0) taskTmp[ids + 2] += cBase;
      if (taskTmp[ids + 3] >= 0) taskTmp[ids + 3] += cBase;
      for (let q = TK.UNITS_A * 4; q < TK.UNITS_A * 4 + 8; q++) if (taskTmp[q] >= 0) taskTmp[q] += uBase;
      sim.writeTask(dBase + d, serial, taskTmp);
    };
    Object.assign(slot, {
      active: true, key: o.key, seed: seedBase, hull: o.hull, mode: o.mode, port, planner, writer, cls,
      drones: droneDefs.length, dBase, uBase, cBase, S, started: false, finished: false, snapped: false,
      statusView: null, zero: new Float32Array(T.dronesPerSlot * 4), units: port.units.length, moved, totalLayers: n,
      yard, berth: o.berth || null, lastSeen: 0, beltPhase: 0, drainT: 0, missing: 0
    });
    if (slot.berth) setSlotRow(slot, slot.berth, lastOrigin);
    for (const d of droneDefs) classLists[cls.index].push(dBase + d.index);
    rebuildRemap();
    nDrones = Math.max(nDrones, (k + 1) * T.dronesPerSlot);
    sim.count = nDrones;
    sim.U.nDrones.value = nDrones;
    units.geometry.instanceCount = Math.max(units.geometry.instanceCount, (k + 1) * T.unitsPerSlot);
    units.mesh.visible = true;
    stats.activateMs = performance.now() - t0;
    stats.activations = (stats.activations || 0) + 1;
    return slot;
  }

  function release(slot, why = '?') {
    if (!slot || !slot.active) return;
    stats.releases = (stats.releases || 0) + 1;
    stats.lastRelease = `${slot.key}:${why}`;
    const k = slot.k;
    const D = sim.drones.value.array;
    for (let i = 0; i < T.dronesPerSlot; i++) parkDrone(D, slot.dBase + i, slot.S.x, slot.S.y);
    addRange(sim.drones.value, slot.dBase * DV * 4, T.dronesPerSlot * DV * 4);
    const Tk = sim.tasks.value.array;
    for (let i = 0; i < T.dronesPerSlot * SWARM_TASK_RING; i++) {
      const o4 = ((slot.dBase * SWARM_TASK_RING) + i) * TV * 4;
      Tk.fill(0, o4, o4 + TV * 4);
      Tk[o4 + TK.IDS * 4 + 1] = -1;
    }
    addRange(sim.tasks.value, slot.dBase * SWARM_TASK_RING * TV * 4, T.dronesPerSlot * SWARM_TASK_RING * TV * 4);
    const U = sim.units.value.array;
    U.fill(0, slot.uBase * UV * 4, (slot.uBase + T.unitsPerSlot) * UV * 4);
    addRange(sim.units.value, slot.uBase * UV * 4, T.unitsPerSlot * UV * 4);
    const Cl = sim.cols.value.array;
    Cl.fill(0, slot.cBase * 2, (slot.cBase + T.colsPerSlot) * 2);
    addRange(sim.cols.value, slot.cBase * 2, T.colsPerSlot * 2);
    for (const list of classLists) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i] >= slot.dBase && list[i] < slot.dBase + T.dronesPerSlot) list.splice(i, 1);
    }
    rebuildRemap();
    slot.active = false;
    slot.key = null;
    slot.planner = null;
    slot.port = null;
    void k;
  }

  function addRange(attr, start, count) {
    attr.addUpdateRange(start, count);
    attr.needsUpdate = true;
  }

  let uLo = Infinity;
  let uHi = -Infinity;
  function unitsRange(base, count) {
    uLo = Math.min(uLo, base);
    uHi = Math.max(uHi, base + count);
    units.range.start = uLo * 20;
    units.range.count = (uHi - uLo) * 20;
    units.buffer.needsUpdate = true;
  }

  function rebuildRemap() {
    const R = remap.value.array;
    for (let c = 0; c < CLASS_N; c++) {
      const list = classLists[c];
      for (let i = 0; i < list.length; i++) R[c * maxDrones + i] = list[i];
      ranges[c].count = list.length;
    }
    remap.value.needsUpdate = true;
    droneMeshes.setRanges(ranges);
  }

  // Wolny przelot taśmą (LOAD przed startem roju, UNLOAD po końcu): kontenery stołów jadą wzdłuż taśmy z portalu
  // albo do niego — poza z CPU (symulacja ich nie rusza: nikt ich nie niesie). t — 0…1 przebiegu taśmy.
  function writeBeltUnits(slot, t, arriving) {
    const port = slot.port;
    const U = sim.units.value.array;
    const yard = slot.yard;
    const uPortal = yard.uPortal + 40;
    const rest = {};
    let lo = Infinity;
    let hi = -Infinity;
    for (const u of port.units) {
      const col = port.columns[u.col];
      if (col.kind !== 'yard') continue;
      swarmUnitRestPose(port, u, rest);
      const side = col.y > slot.S.y ? 0 : 1;
      const sd = yard.sides[side];
      const vBeltScene = slot.S.y - sd.vBelt;
      // Kolejność na taśmie: dalsze od portalu jadą pierwsze (przyjazd) / ostatnie (odjazd).
      const uCol = col.x - slot.S.x;
      const d = uPortal - uCol;
      // Przyjazd: dalsze stoły i niższe poziomy pierwsze; odjazd: bliższe portalu i górne poziomy pierwsze.
      const dN = Math.max(0, Math.min(1, d / (yard.padLength + 80)));
      const lag = arriving ? Math.min(0.6, u.level * 0.1 + (1 - dN) * 0.4)
        : Math.min(0.6, (T.yardLevels - 1 - u.level) * 0.1 + dN * 0.4);
      const k = Math.max(0, Math.min(1, (t - lag) / 0.4));
      const o4 = (slot.uBase + u.id) * UV * 4;
      let x, y, z;
      if (arriving) {
        // portal → wzdłuż taśmy do stołu (0…0,8), zsuw na stół (0,8…1)
        if (k < 0.8) { const q = k / 0.8; x = slot.S.x + uPortal - d * q; y = vBeltScene; z = -112.1; }
        else { const q = (k - 0.8) / 0.2; x = rest.x; y = vBeltScene + (rest.y - vBeltScene) * q; z = -112.1 + (rest.z + 0 - -112.1) * q; }
        U[o4 + 5] = k > 0 ? 1 : 0;
      } else {
        if (k < 0.2) { const q = k / 0.2; x = rest.x; y = rest.y + (vBeltScene - rest.y) * q; z = rest.z + (-112.1 - rest.z) * q; }
        else { const q = (k - 0.2) / 0.8; x = slot.S.x + uCol + d * q; y = vBeltScene; z = -112.1; }
        U[o4 + 5] = k < 1 ? 1 : 0;
      }
      U[o4] = x; U[o4 + 1] = y; U[o4 + 2] = z;
      lo = Math.min(lo, o4);
      hi = Math.max(hi, o4 + 8);
    }
    if (hi > lo) addRange(sim.units.value, lo, hi - lo);
  }

  // Ukrycie jednostek (koniec postoju, a symulacja nie zdążyła): UNLOAD — w ładowni, LOAD — na stołach; drony slotu
  // znikają (ładownia zamyka się, obraz domyka się zgodnie z ekonomią).
  function snap(slot) {
    const port = slot.port;
    const U = sim.units.value.array;
    const unload = slot.mode === 'unload';
    const state = slot.planner.unitState;
    void unload;
    for (const u of port.units) {
      // Czekający u źródła i niesiony (drony slotu znikają) — znika: przeładowany, gdy wrota się zamykały.
      if (state[u.id] === 2) continue;
      U[(slot.uBase + u.id) * UV * 4 + 5] = 0;
    }
    addRange(sim.units.value, slot.uBase * UV * 4, port.units.length * UV * 4);
    const D = sim.drones.value.array;
    for (let i = 0; i < slot.drones; i++) parkDrone(D, slot.dBase + i, slot.S.x, slot.S.y);
    addRange(sim.drones.value, slot.dBase * DV * 4, T.dronesPerSlot * DV * 4);
    slot.snapped = true;
    slot.finished = true;
  }

  let lastOrigin = { x: 0, y: 0 };
  // Rama slotu → świat (względem początku): p ↦ R(φ)(p − S) + (bx − ox, −by − oy), φ = −kąt stanowiska.
  function setSlotRow(slot, b, origin) {
    const phi = -b.angle;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const tx = b.x - origin.x - (c * slot.S.x - s * slot.S.y);
    const ty = -b.y - origin.y - (s * slot.S.x + c * slot.S.y);
    frame.rows[slot.k].set(tx, ty, phi, 0);
  }

  return {
    stats,
    tune: T,
    get ready() { return ready; },
    get frame() { return frame; },
    /** Cienie dronów (narzędzia: `shadows.strength.value` — A/B siły cienia). */
    get shadows() { return shadows; },
    slots,
    ensure,
    activate,
    release,
    /**
     * Klatka (przed Core3D.render): czas gry tej klatki (pauza = 0), początek przy kamerze (rama slotów), a dla
     * każdego aktywnego slotu jego stan postoju: fn(slot) → { berth { x, y, angle }, dockTime, swarmStart, doorClose,
     * workEnd } albo null (stanowisko poza kadrem / statek odleciał — slot dokańcza taśmę i się zwalnia).
     */
    update(gameDt, origin, stateOf, pxPerUnit = 1) {
      if (!ready) return;
      const t0 = performance.now();
      lastOrigin = origin;
      uLo = Infinity;
      uHi = -Infinity;
      pendingDt = Math.max(0, Number(gameDt) || 0) * T.clock;
      let active = 0;
      let busy = 0;
      let dronesN = 0;
      let done = 0;
      let total = 0;
      // Pula stała (żaden slot nie pracował): odczyty stoją, więc ostatni odczyt jest stary (drony slotów sprzed przerwy).
      // Wszystkie drony stoją teraz w gniazdach — odczyt zerowy (faza PARKED, zadanie 0) to ich prawdziwy stan dla wieży
      // slotu, który ruszy w tej klatce; reset odrzuca też odczyty jeszcze w locie.
      if (!working && sim.readback && sim.readback.frame >= 0) sim.readback.reset();
      const status = sim.statusData;
      for (const slot of slots) {
        if (!slot.active) continue;
        const st = stateOf(slot);
        if (st && st.berth) slot.berth = st.berth;
        const b = slot.berth;
        if (!b) { release(slot, 'bez stanowiska'); continue; }
        setSlotRow(slot, b, origin);
        active++;
        dronesN += slot.drones;
        if (!st) {
          // Brak stanu przez chwilę (ramka bez przeładunku, kadr) — slot czeka; dłużej: statek odleciał / poza kadrem —
          // taśma wywozi plac (UNLOAD), potem zwolnienie.
          slot.missing += Math.max(0, Number(gameDt) || 0);
          if (slot.missing < T.missingGrace) continue;
          slot.drainT += Math.max(0, Number(gameDt) || 0);
          if (slot.mode === 'unload' && slot.drainT < T.beltDrain) writeBeltUnits(slot, slot.drainT / T.beltDrain, false);
          else release(slot, 'brak stanu');
          continue;
        }
        slot.lastSeen = st.dockTime;
        slot.missing = 0;
        const unload = slot.mode === 'unload';
        if (!slot.started) {
          if (!unload && st.dockTime < st.swarmStart && slot.moved === 0) {
            // LOAD: ładunek przyjeżdża taśmą na stoły przed startem roju.
            const tb = (st.dockTime - Math.max(0, st.swarmStart - T.beltLead)) / T.beltLead;
            writeBeltUnits(slot, Math.max(0, Math.min(1, tb)), true);
          }
          if (st.dockTime >= st.swarmStart) {
            if (!unload && slot.moved === 0) writeBeltUnits(slot, 1, true);
            slot.started = true;
          }
        }
        if (slot.started && !slot.finished) {
          if (st.dockTime >= st.doorClose) snap(slot);
          else {
            if (!slot.statusView || slot.statusView.buffer !== status?.buffer) {
              slot.statusView = status ? status.subarray(slot.dBase * 4, (slot.dBase + T.dronesPerSlot) * 4) : null;
            }
            const tp = performance.now();
            slot.planner.update(sim.time, slot.statusView || slot.zero, slot.writer);
            stats.planMs += performance.now() - tp;
            const ps = slot.planner.stats;
            if (ps.done >= ps.total) {
              let parked = 0;
              const sv = slot.statusView;
              if (sv) for (let i = 0; i < slot.drones; i++) if ((sv[i * 4] | 0) === SWARM_PHASE.PARKED) parked++;
              if (parked >= slot.drones) { slot.finished = true; slot.drainT = 0; }
            }
          }
        }
        if (slot.started && !slot.finished) busy++;
        if (slot.finished && unload && !slot.snapped) {
          // Rozładunek skończony: taśma wywozi plac do portalu.
          slot.drainT += Math.max(0, Number(gameDt) || 0);
          if (slot.drainT < T.beltDrain) writeBeltUnits(slot, slot.drainT / T.beltDrain, false);
        }
        const ps = slot.planner ? slot.planner.stats : null;
        if (ps) { done += ps.done; total += ps.total; }
      }
      stats.slots = active;
      stats.working = busy;
      working = busy;
      stats.drones = dronesN;
      stats.done = done;
      stats.total = total;
      // Obraz: drony, światła (jeden rysunek na wszystkie klasy — zakres do końca puli), kontenery.
      lightRange[0].count = nDrones;
      droneLights.setRanges(active ? lightRange : [{ classIndex: 0, base: 0, count: 0 }]);
      droneMeshes.setLod(pxPerUnit);
      for (const m of droneMeshes.meshes) for (const lod of ['hi', 'lo']) m.meshes[lod].position.set(origin.x, origin.y, 0);
      for (const m of droneLights.meshes) m.mesh.position.set(origin.x, origin.y, 0);
      units.mesh.position.set(origin.x, origin.y, 0);
      units.mesh.visible = active > 0;
      // Cienie: tylko gdy rój pracuje (poza tym drony stoją w gniazdach — siła cienia 0).
      shadows.setCounts(busy ? nDrones : 0, 0);
      shadows.drones.position.set(origin.x, origin.y, 0);
      if (!active) { for (const r of ranges) r.count = 0; droneMeshes.setRanges(ranges); }
      stats.ms = performance.now() - t0;
    },
    warmupMeshes() {
      if (!ensure()) return [];
      return [...droneMeshes.warmupMeshes(), ...droneLights.warmupMeshes(), units.mesh, shadows.drones];
    }
  };
}


/** Klasa drona z obrysu modułu ładowni (moduł = wielokrotność chwytu klasy). */
function swarmClassFromModule(mod) {
  if (mod.nx >= 2 && mod.ny >= 2) return 'L';
  if (mod.ny >= 2) return 'M';
  return 'S';
}

