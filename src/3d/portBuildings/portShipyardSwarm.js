// Stocznia (Z7): rój dronów budujący kadłuby, taśma kontenerów, stacje odbioru
// i jeden dźwig na pochylnię — szkic użytkownika 2026-09-27 („budować statki musi
// rój dronów, tak jak drony budowały Gwiazdę Śmierci”; dźwig jeden, tylko do
// przenoszenia).
//
// Czysta matematyka bez Three: pozy liczone z czasu, zapis do buforów w formacie
// Z5 — drony w rekordach CARGO_DRONE (cargoPortOps.js), kontenery jako skrzynie
// (CRATE_*). Rysują je CargoDrones3D i CargoContainers3D (Z5) — pushShipyardSwarm
// na końcu pliku.
//
// Układ: współrzędne huba stoczni (x wzdłuż ringu, z w kosmos; portShipyardLayout.js),
// wysokość = z świata (płaszczyzna gry 0, pokład stoczni −116). Rekordy dronów
// w „układzie stanowiska” Z5: u = x huba, v = z huba, kurs od +x ku +z —
// pose stanowiska = początek huba w grze i kąt atan2(−ty, tx) ramki.
//
// Cykl drona (okres stały na drona, fazy rozłożone po miejscach odbioru):
// przelot nad stację taśmy, zejście, chwyt modułu, wzlot, przelot nad czoło
// budowy, zejście, odłożenie (moduł wtapia się w poszycie), praca przy czole
// (reszta okresu), wzlot. Spawacze wiszą nad czołem budowy i co okres przenoszą
// się w nowe miejsce. Refit: te same cykle między składem przy rdzeniu piasty
// a statkiem na placu. Wejście do roju: od początku NASTĘPNEGO cyklu drona,
// pierwszy przelot ze stojaka; zejście: dron kończy bieżący cykl i wraca na
// stojak (bez przeskoków — jedyny stan to numery cykli wejścia i zejścia).
import { CARGO_DRONE, CARGO_DRONE_STRIDE, CARGO_PHASE } from '../../game/cargoPortOps.js';
import { cargoHash01 } from '../../data/cargoContainers.js';
import { RESOURCE_KEYS } from '../../data/resources.js';
import { WARSHIP_CLASSES } from '../../game/traffic/shipyards.js';
import { trafficHullRenderSize } from '../../data/trafficHulls.js';
import { K7_ABOVE_SCALE, K7_HEIGHTS, k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { SHIPYARD_HULL_Y, hullBuildFront, hullBuildStage, shipyardPathPoint } from './portShipyardLayout.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (t) => t * t * (3 - 2 * t);
const HALF_PI = Math.PI / 2;
const NO_CLIP = -1e9;
const NEVER = 1e9;

/** Wysokość K-7 (y) dla z świata — odwrotność k7HeightToZ. */
export function k7ZToHeight(z) {
  return z > 0 ? K7_HEIGHTS.hullTop + z / K7_ABOVE_SCALE : K7_HEIGHTS.hullTop + z;
}

// Wysokości (z świata): pokład, wierzch taśmy, płyty stacji, stojak dronów,
// skład refitu, wierzch kadłuba w budowie (czworokąt portHullBuild3D), przelot.
export const SWARM_Z = Object.freeze({
  deck: k7HeightToZ(0),
  belt: k7HeightToZ(36),
  station: k7HeightToZ(26),
  rack: k7HeightToZ(34),
  depot: k7HeightToZ(22),
  hull: k7HeightToZ(SHIPYARD_HULL_Y),
  cruise: 14,
  ship: 0.5,
  refitCruise: 36
});

// Kontener modułu (taśma, hak drona) i blok dźwigu. Dron: rama chwytaka o obrysie
// kontenera + zapas, korpus nad nią (jak planCargoTransfer w cargoPortOps.js).
export const SWARM_UNIT = Object.freeze({ L: 54, W: 22, H: 18 });
export const SWARM_HEAVY = Object.freeze({ L: 130, W: 72, H: 46 });
export const SWARM_DRONE = Object.freeze({
  L: SWARM_UNIT.L * 1.08 + 1.5,
  W: SWARM_UNIT.W * 1.08 + 1.5,
  H: 0.42 * Math.min(SWARM_UNIT.L, SWARM_UNIT.W) + 1
});
// Podsiatka kontenera dla shadera Z5 (nx + 8 ny + 64 tiers): jedna jednostka.
export const SWARM_GRID = 1 + 8 + 64;

export const SWARM_TUNE = {
  perSlip: 20,                 // dronów transportowych na pochylnię (stojak = + spawacze)
  welders: 4,
  active: { keel: 8, frames: 14, plating: 20, outfit: 12 },
  welding: { keel: 2, frames: 4, plating: 4, outfit: 3 },
  speed: 150,                  // przelot [j./s]
  vSpeed: 60,                  // pion [j./s]
  lock: 0.8,                   // chwyt [s]
  release: 0.7,                // odłożenie [s]
  sink: 1.6,                   // moduł wtapia się w poszycie [s]
  period: 38,                  // okres cyklu drona [s] (± periodJitter)
  periodJitter: 0.12,
  welderPeriod: 17,
  beltSpeed: 55,               // taśma [j./s]
  beltSpacing: 190,            // odstęp kontenerów na podajniku [j.] (w trzonie co połowę)
  refitDrones: 18,
  refitPeriod: 64,
  refitSpeed: 320,
  cranePeriod: 48
};

// Skrzynie (kontenery do CargoContainers3D): u, v, z podstawy, kurs, surowiec,
// ziarno wyglądu, płaszczyzna cięcia (wyłaz), rodzaj (0 moduł, 1 blok dźwigu),
// wysokość podłoża pod skrzynią (cień na pokładzie / taśmie / kadłubie).
export const CRATE_STRIDE = 9;
export const CRATE = Object.freeze({ U: 0, V: 1, Z: 2, YAW: 3, RES: 4, SEED: 5, CLIP: 6, KIND: 7, DECK: 8 });

const resIndex = (key) => Math.max(0, RESOURCE_KEYS.indexOf(key));
// Mieszanka taśmy: podzespoły z list budowy WARSHIP_CLASSES (płyty najczęściej).
const BELT_MIX = (() => {
  const w = new Map();
  for (const cls of Object.values(WARSHIP_CLASSES)) {
    for (const [k, n] of Object.entries(cls.build)) w.set(k, (w.get(k) || 0) + Math.sqrt(n));
  }
  const out = [];
  for (const [k, n] of w) for (let i = 0; i < Math.max(1, Math.round(n)); i++) out.push(resIndex(k));
  return Object.freeze(out);
})();
const HEAVY_MIX = Object.freeze(['reactor_core', 'weapon_mount', 'thruster', 'life_support'].map(resIndex));
const REFIT_MIX = Object.freeze(HEAVY_MIX.concat(BELT_MIX.slice(0, 6)));
// Mieszanka pochylni wg klasy i etapu (pamięć podręczna — bez alokacji w klatce):
// stępka i wręgi — płyty, poszycie — płyty + awionika, wyposażenie — reszta listy budowy.
const MIX_CACHE = {};
function classMix(classId, stage) {
  const cls = WARSHIP_CLASSES[classId];
  if (!cls) return BELT_MIX;
  const byClass = MIX_CACHE[classId] || (MIX_CACHE[classId] = {});
  let mix = byClass[stage];
  if (!mix) {
    const keys = Object.keys(cls.build);
    const pick = stage === 'outfit' ? keys.filter((k) => k !== 'hull_plate') : stage === 'plating' ? ['hull_plate', 'hull_plate', 'avionics', 'hull_plate'] : ['hull_plate'];
    mix = byClass[stage] = Object.freeze(pick.map(resIndex));
  }
  return mix;
}

// ---------------------------------------------------------------------------

function makeJob(kind, seed, count, welders, rackSlots, spots, period) {
  const n = count + welders;
  return {
    kind, seed, count, welders, rackSlots, spots, period,
    init: false,
    target: new Uint8Array(n),
    // numery cykli: pierwszy aktywny, ostatni aktywny, cykl powrotu na stojak
    startC: new Float64Array(n).fill(NEVER),
    endC: new Float64Array(n).fill(-NEVER),
    returnC: new Float64Array(n).fill(-NEVER),
    // geometria pracy (ustawiana co klatkę): środek, oś, długość, szerokość, czoło
    cx: 0, cz: 0, ax: 0, az: 1, len: 0, beam: 0, front: 0, z0: 0, z1: 0,
    workHook: 0, cruise: 0, yaw: HALF_PI, mix: BELT_MIX, active: 0, welding: 0,
    spotAge: new Float64Array(spots.length)
  };
}

/**
 * Stan roju dla układu stoczni (createShipyardLayout). Bufory na wszystkie
 * drony, skrzynie i ładunki na hakach — bez alokacji w stepShipyardSwarm.
 */
export function createShipyardSwarm(layout, opts = {}) {
  const T = SWARM_TUNE;
  const seed0 = Math.floor(Number(opts.seed) || 0) + 7919;
  const slips = layout.slips.map((s) => {
    const job = makeJob(0, seed0 + 101 * (s.index + 1), T.perSlip, T.welders, s.rack.slots, s.station.spots, T.period);
    job.slip = s;
    job.hullId = null;
    job.stage = 'idle';
    job.len = s.padLength * 0.6;
    job.beam = s.padBeam * 0.5;
    job.front = s.z;
    return job;
  });
  // składy refitu (przy rdzeniu piasty / terminalu U): 3 miejsca odbioru, stojak 3 × 6
  const depots = (layout.depots || []).map((d, i) => {
    const spots = [-100, 0, 100].map((dz) => ({ x: d.x - 70, z: d.z + dz }));
    const rack = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) rack.push({ x: d.x + 26 + c * 52, z: d.z - 190 + r * 76 });
    const job = makeJob(1, seed0 + 7001 * (i + 1), T.refitDrones, 0, rack, spots, T.refitPeriod);
    job.depot = d;
    job.pad = null;
    job.cx = d.x;
    job.cz = d.z;
    return job;
  });
  const maxDrones = slips.reduce((a, j) => a + j.count + j.welders, 0) + depots.reduce((a, j) => a + j.count, 0);
  // taśma: dwa podajniki × (długość / odstęp + 1)
  const feedLen = feedLength(layout);
  const perFeed = Math.ceil(feedLen / T.beltSpacing) + 1;
  const maxCrates = 2 * perFeed + slips.length * (3 + 3) + maxDrones + depots.length * (3 + 8);
  return {
    layout,
    slips,
    depots,
    feedLen,
    perFeed,
    drones: new Float32Array(maxDrones * CARGO_DRONE_STRIDE),
    droneCount: 0,
    // 1 = dron nad kadłubem (cień na kadłubie / statku, nie na pokładzie)
    droneOverHull: new Uint8Array(maxDrones),
    carried: new Float32Array(maxDrones * CRATE_STRIDE),
    carriedCount: 0,
    crates: new Float32Array(maxCrates * CRATE_STRIDE),
    crateCount: 0,
    cranes: layout.slips.map((s) => ({ z: s.crane.homeZ, x: s.x, hookY: s.crane.legTop - 60, carrying: false, res: HEAVY_MIX[0], seed: 0 })),
    stats: { drones: 0, crates: 0, carried: 0, active: 0 },
    time: 0
  };
}

function feedLength(l) {
  const p = l.belt.path;
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return s;
}

// ---------------------------------------------------------------------------
// Zapis rekordów

function pushCrate(sw, u, v, z, yaw, res, seed, clip, kind, deck) {
  const o = sw.crateCount * CRATE_STRIDE;
  if (o + CRATE_STRIDE > sw.crates.length) return;
  const C = sw.crates;
  C[o] = u; C[o + 1] = v; C[o + 2] = z; C[o + 3] = yaw; C[o + 4] = res; C[o + 5] = seed; C[o + 6] = clip; C[o + 7] = kind; C[o + 8] = deck;
  sw.crateCount++;
}
function pushCarried(sw, u, v, z, yaw, res, seed, deck) {
  const o = sw.carriedCount * CRATE_STRIDE;
  if (o + CRATE_STRIDE > sw.carried.length) return;
  const C = sw.carried;
  C[o] = u; C[o + 1] = v; C[o + 2] = z; C[o + 3] = yaw; C[o + 4] = res; C[o + 5] = seed; C[o + 6] = NO_CLIP; C[o + 7] = 0; C[o + 8] = deck;
  sw.carriedCount++;
}

// Poza drona (scratch — wypełniana przez funkcje cyklu, zapisywana raz).
const POSE = { x: 0, z: 0, h: 0, yaw: HALF_PI, carry: 0, res: 0, unit: 0, thrust: 0, au: 0, av: 0, az: 0, drop: 0, phase: 0, overHull: 0 };
const CYC = { P: 1, c: 0, tau: 0 };
const W0 = { x: 0, z: 0 };
const W1 = { x: 0, z: 0 };

function writeDrone(sw, p, k, seed) {
  const o = sw.droneCount * CARGO_DRONE_STRIDE;
  if (o + CARGO_DRONE_STRIDE > sw.drones.length) return;
  const D = sw.drones;
  D[o + CARGO_DRONE.U] = p.x;
  D[o + CARGO_DRONE.V] = p.z;
  D[o + CARGO_DRONE.Z] = p.h;
  D[o + CARGO_DRONE.YAW] = p.yaw;
  D[o + CARGO_DRONE.CARRY] = p.carry;
  D[o + CARGO_DRONE.RES] = p.carry ? p.res : -1;
  D[o + CARGO_DRONE.UNIT] = p.carry ? p.unit : -1;
  D[o + CARGO_DRONE.THRUST] = p.thrust;
  D[o + CARGO_DRONE.AU] = p.au;
  D[o + CARGO_DRONE.AV] = p.av;
  D[o + CARGO_DRONE.AZ] = p.az;
  D[o + CARGO_DRONE.CLIP] = NO_CLIP;
  D[o + CARGO_DRONE.DROP] = p.drop;
  D[o + CARGO_DRONE.INDEX] = k;
  D[o + CARGO_DRONE.SEED] = seed;
  D[o + CARGO_DRONE.PHASE] = p.phase;
  sw.droneOverHull[sw.droneCount] = p.overHull;
  sw.droneCount++;
}

const rackZ = (job) => (job.kind === 0 ? SWARM_Z.rack : SWARM_Z.depot);
const rackSlot = (job, k) => job.rackSlots[Math.min(k, job.rackSlots.length - 1)];

function restPose(job, k, p) {
  const slot = rackSlot(job, k);
  p.x = slot.x;
  p.z = slot.z;
  p.h = rackZ(job);
  p.yaw = HALF_PI;
  p.carry = 0;
  p.thrust = 0;
  p.au = p.av = p.az = 0;
  p.drop = 0;
  p.phase = CARGO_PHASE.HIDDEN;
  p.overHull = 0;
}

// Punkt pracy cyklu c: na czole budowy (pochylnia) albo na kadłubie statku (refit).
function workPoint(job, c, k, out) {
  const h1 = cargoHash01(job.seed, k * 131 + 7, c * 2 + 1);
  const h2 = cargoHash01(job.seed, k * 131 + 7, c * 2 + 2);
  if (job.kind === 0) {
    // wzdłuż czoła budowy, w poprzek kadłuba (zwęża się ku dziobowi)
    const zf = clamp(job.front + (h2 - 0.5) * 150, job.z0, job.z1);
    const bow = clamp01((zf - job.z0) / Math.max(1, job.z1 - job.z0));
    out.x = job.cx + (h1 - 0.5) * job.beam * (0.66 - 0.3 * bow * bow);
    out.z = zf;
  } else {
    const a = (h1 - 0.5) * job.len * 0.76;
    const b = (h2 - 0.5) * job.beam * 0.5;
    out.x = job.cx + job.ax * a - job.az * b;
    out.z = job.cz + job.az * a + job.ax * b;
  }
}

// Numer cyklu i czas w cyklu drona k (okres z rozrzutem, fazy rozłożone równo
// w obrębie miejsca odbioru — mniej tłoku na stacji).
function cycleOf(job, k, t, welder, out) {
  const T = SWARM_TUNE;
  const base = welder ? T.welderPeriod : job.period;
  const P = base * (1 - T.periodJitter + 2 * T.periodJitter * cargoHash01(job.seed, k, 91));
  let phase;
  if (welder) {
    phase = cargoHash01(job.seed, k, 93) * P;
  } else {
    const nSpots = job.spots.length;
    const si = k % nSpots;
    const perSpot = Math.ceil(job.count / nSpots);
    phase = ((Math.floor(k / nSpots) + 0.37 * si) / perSpot + 0.08 * cargoHash01(job.seed, k, 92)) * P;
  }
  const u = t + phase;
  out.P = P;
  out.c = Math.floor(u / P);
  out.tau = u - out.c * P;
  return out;
}

// Odcinek z wygładzeniem (smoothstep): położenie, ciąg i kierunek przyspieszenia.
function leg(p, ax, az, ah, bx, bz, bh, u) {
  const uu = clamp01(u);
  const s = smooth(uu);
  p.x = ax + (bx - ax) * s;
  p.z = az + (bz - az) * s;
  p.h = ah + (bh - ah) * s;
  const acc = 1 - 2 * uu;      // + rozpędzanie ku B, − hamowanie
  const dx = bx - ax;
  const dz = bz - az;
  const dh = bh - ah;
  const len = Math.hypot(dx, dz, dh) || 1;
  p.au = dx / len * acc;
  p.av = dz / len * acc;
  p.az = dh / len * acc;
  p.thrust = 0.35 + 0.6 * Math.abs(acc);
}

/**
 * Cykl transportowy drona k (pochylnia albo refit). fromRack — pierwszy cykl
 * po wejściu do roju: przelot startuje ze stojaka. Zwraca wiek chwytu z miejsca
 * odbioru (do chowania skrzyni na stacji) albo −1.
 */
function cyclePose(sw, job, k, cyc, p, fromRack) {
  const T = SWARM_TUNE;
  const P = cyc.P;
  const c = cyc.c;
  const tau = cyc.tau;
  const si = k % job.spots.length;
  const spot = job.spots[si];
  const cruise = job.cruise;
  let h0 = cruise;
  if (fromRack) {
    const slot = rackSlot(job, k);
    W0.x = slot.x;
    W0.z = slot.z;
    h0 = rackZ(job);
  } else {
    workPoint(job, c - 1, k, W0);
  }
  workPoint(job, c, k, W1);
  const hookS = (job.kind === 0 ? SWARM_Z.station : SWARM_Z.depot) + SWARM_UNIT.H + 0.5;
  const hookW = job.workHook;
  const speed = job.kind === 0 ? T.speed : T.refitSpeed;
  let T1 = Math.hypot(spot.x - W0.x, spot.z - W0.z) / speed;
  let T2 = Math.hypot(W1.x - spot.x, W1.z - spot.z) / speed;
  const Td = Math.max(0.3, (cruise - hookS) / T.vSpeed);
  const Tw = Math.max(0.3, (cruise - hookW) / T.vSpeed);
  const fixed = 2 * Td + 2 * Tw + T.lock + T.release;
  let slack = P - (T1 + T2 + fixed);
  if (slack < 1.5) {
    const s = Math.max(0.2, (P - fixed - 1.5) / Math.max(1e-3, T1 + T2));
    T1 *= s;
    T2 *= s;
    slack = P - (T1 + T2 + fixed);
  }
  const res = job.mix[(c * 7 + k * 3) % job.mix.length];
  p.res = res;
  p.unit = Math.floor(cargoHash01(job.seed, k, c) * 4096);
  p.yaw = job.yaw;
  p.drop = 0;
  p.carry = 0;
  p.overHull = 0;
  let t0 = 0;
  // 1. przelot nad stację (pierwszy cykl: wzlot ze stojaka)
  if (tau < (t0 += T1)) {
    leg(p, W0.x, W0.z, h0, spot.x, spot.z, cruise, (tau - (t0 - T1)) / T1);
    p.phase = CARGO_PHASE.RETURN;
    return -1;
  }
  // 2. zejście nad moduł
  if (tau < (t0 += Td)) {
    leg(p, spot.x, spot.z, cruise, spot.x, spot.z, hookS, (tau - (t0 - Td)) / Td);
    p.phase = CARGO_PHASE.WORK;
    return -1;
  }
  // 3. chwyt (rama opada, zamki, ładunek od połowy)
  const grabAt = t0 + T.lock * 0.5;
  if (tau < (t0 += T.lock)) {
    const u = (tau - (t0 - T.lock)) / T.lock;
    p.x = spot.x; p.z = spot.z; p.h = hookS;
    p.drop = 3.5 * Math.sin(Math.PI * u);
    p.carry = tau >= grabAt ? 1 : 0;
    p.thrust = 0.3; p.au = p.av = 0; p.az = 0.3;
    p.phase = CARGO_PHASE.WORK;
    return tau - grabAt;
  }
  // 4. wzlot z ładunkiem
  if (tau < (t0 += Td)) {
    leg(p, spot.x, spot.z, hookS, spot.x, spot.z, cruise, (tau - (t0 - Td)) / Td);
    p.carry = 1;
    p.phase = CARGO_PHASE.LAUNCH;
    return tau - grabAt;
  }
  // 5. przelot nad czoło budowy / statek
  if (tau < (t0 += T2)) {
    leg(p, spot.x, spot.z, cruise, W1.x, W1.z, cruise, (tau - (t0 - T2)) / T2);
    p.carry = 1;
    p.phase = CARGO_PHASE.TRANSIT;
    return tau - grabAt;
  }
  // 6. zejście na poszycie
  if (tau < (t0 += Tw)) {
    leg(p, W1.x, W1.z, cruise, W1.x, W1.z, hookW, (tau - (t0 - Tw)) / Tw);
    p.carry = 1;
    p.overHull = 1;
    p.phase = CARGO_PHASE.WORK;
    return tau - grabAt;
  }
  // 7. odłożenie (ładunek zostaje na poszyciu od połowy)
  const dropAt = t0 + T.release * 0.5;
  if (tau < (t0 += T.release)) {
    const u = (tau - (t0 - T.release)) / T.release;
    p.x = W1.x; p.z = W1.z; p.h = hookW;
    p.drop = 3 * Math.sin(Math.PI * u);
    p.carry = tau < dropAt ? 1 : 0;
    p.thrust = 0.3; p.au = p.av = 0; p.az = -0.3;
    p.overHull = 1;
    p.phase = CARGO_PHASE.WORK;
    if (tau >= dropAt) sinkModule(sw, job, W1, tau - dropAt, res, p.unit);
    return tau - grabAt;
  }
  // 8. praca przy czole (spawanie), kołysanie narasta i gaśnie (bez skoków)
  if (tau < (t0 += slack)) {
    const w = tau - (t0 - slack);
    const e = smooth(clamp01(Math.min(w, slack - w) / 0.9));
    p.x = W1.x + 6 * e * Math.sin(w * 1.7 + k);
    p.z = W1.z + 5 * e * Math.sin(w * 1.3 + 2 * k);
    p.h = hookW + e * (4 + 2 * Math.sin(w * 2.1 + k));
    p.thrust = 0.28 + 0.22 * Math.abs(Math.sin(w * 3.3 + k));
    p.au = Math.cos(w * 1.7 + k) * 0.4 * e; p.av = Math.cos(w * 1.3 + 2 * k) * 0.4 * e; p.az = 0.2;
    p.overHull = 1;
    p.phase = CARGO_PHASE.WORK;
    sinkModule(sw, job, W1, tau - dropAt, res, p.unit);
    return tau - grabAt;
  }
  // 9. wzlot na przelot
  leg(p, W1.x, W1.z, hookW, W1.x, W1.z, cruise, (tau - t0) / Tw);
  p.overHull = 1;
  p.phase = CARGO_PHASE.LAUNCH;
  return tau - grabAt;
}

// Spawacz: co okres przenosi się w nowe miejsce czoła, potem wisi i omiata spoinę.
function welderCycle(job, k, cyc, p, fromRack) {
  const T = SWARM_TUNE;
  const tau = cyc.tau;
  let h0 = SWARM_Z.hull + 11;
  if (fromRack) {
    const slot = rackSlot(job, k);
    W0.x = slot.x;
    W0.z = slot.z;
    h0 = rackZ(job);
  } else {
    workPoint(job, cyc.c - 1 + 5000, k, W0);
  }
  workPoint(job, cyc.c + 5000, k, W1);
  const hov = SWARM_Z.hull + 11;
  const Tm = Math.max(1.2, Math.hypot(W1.x - W0.x, W1.z - W0.z) / (T.speed * 0.7));
  p.yaw = job.yaw;
  p.carry = 0;
  p.drop = 0;
  p.overHull = 1;
  p.phase = CARGO_PHASE.WORK;
  if (tau < Tm) {
    leg(p, W0.x, W0.z, h0, W1.x, W1.z, hov, tau / Tm);
    return;
  }
  const w = tau - Tm;
  const e = smooth(clamp01(Math.min(w, cyc.P - tau) / 1.2));
  const sweep = Math.sin(w * 0.9 + k);
  p.x = W1.x + sweep * 22 * e;
  p.z = W1.z + 8 * e * Math.sin(w * 1.7 + 2 * k);
  p.h = hov + e * 2 * Math.sin(w * 1.3 + k);
  p.yaw = job.yaw + 0.2 * e * Math.sin(w * 0.4 + k);
  p.thrust = 0.3 + 0.35 * Math.abs(Math.sin(w * 3.1 + k * 0.7));
  p.au = Math.cos(w * 0.9 + k) * 0.6 * e;
  p.av = Math.cos(w * 1.7 + 2 * k) * 0.4 * e;
  p.az = 0.15;
}

// Powrót na stojak: z ostatniego punktu pracy, zejście, spoczynek.
function returnPose(job, k, cyc, p, welder) {
  const T = SWARM_TUNE;
  if (welder) workPoint(job, cyc.c - 1 + 5000, k, W0);
  else workPoint(job, cyc.c - 1, k, W0);
  const slot = rackSlot(job, k);
  const h0 = welder ? SWARM_Z.hull + 11 : job.cruise;
  const cruise = Math.max(h0, job.cruise);
  const speed = job.kind === 0 ? T.speed : T.refitSpeed;
  const T1 = Math.max(0.8, Math.hypot(slot.x - W0.x, slot.z - W0.z) / speed);
  const Tr = Math.max(0.4, (cruise - rackZ(job)) / T.vSpeed);
  const tau = cyc.tau;
  if (tau < T1) {
    leg(p, W0.x, W0.z, h0, slot.x, slot.z, cruise, tau / T1);
  } else if (tau < T1 + Tr) {
    leg(p, slot.x, slot.z, cruise, slot.x, slot.z, rackZ(job), (tau - T1) / Tr);
  } else {
    restPose(job, k, p);
    return;
  }
  p.yaw = job.yaw;
  p.carry = 0;
  p.drop = 0;
  p.overHull = 0;
  p.phase = CARGO_PHASE.RETURN;
}

// Odłożony moduł: stoi na poszyciu, potem wtapia się w nie (wyłaz = wierzch kadłuba).
function sinkModule(sw, job, at, age, res, unit) {
  const T = SWARM_TUNE;
  if (age < 0 || age > T.sink + 0.4) return;
  const top = job.kind === 0 ? SWARM_Z.hull : SWARM_Z.ship;
  const s = clamp01((age - 0.4) / T.sink);
  pushCrate(sw, at.x, at.z, top - SWARM_UNIT.H * s, job.yaw, res, unit / 4096, top, 0, top);
}

// Wejście / zejście z roju w numerach cykli (patrz nagłówek).
function updateMembership(job, k, want, c) {
  if (!job.init) {
    job.target[k] = want;
    job.startC[k] = want ? -NEVER : NEVER;
    job.endC[k] = want ? NEVER : -NEVER;
    job.returnC[k] = -NEVER;
    return;
  }
  if (want === job.target[k]) return;
  job.target[k] = want;
  const active = c >= job.startC[k] && c <= job.endC[k];
  if (want) {
    if (active) {
      job.endC[k] = NEVER;            // jeszcze w ostatnim cyklu — leci dalej
      job.returnC[k] = -NEVER;
    } else {
      job.startC[k] = c + 1;          // start ze stojaka od następnego cyklu
      job.endC[k] = NEVER;
      if (job.returnC[k] !== c) job.returnC[k] = -NEVER;
    }
  } else if (active) {
    job.endC[k] = c;                  // kończy bieżący cykl, potem wraca
    job.returnC[k] = c + 1;
  } else {
    job.startC[k] = NEVER;            // czekał na stojaku — zostaje
    job.endC[k] = -NEVER;
    if (job.returnC[k] !== c) job.returnC[k] = -NEVER;
  }
}

// Jedno zadanie (pochylnia albo refit): drony w roju, na stojaku, w drodze.
function stepJob(sw, job, t) {
  const n = job.count + job.welders;
  for (let s = 0; s < job.spotAge.length; s++) job.spotAge[s] = Infinity;
  let active = 0;
  for (let k = 0; k < n; k++) {
    const welder = k >= job.count;
    const want = welder ? (k - job.count < job.welding ? 1 : 0) : (k < job.active ? 1 : 0);
    cycleOf(job, k, t, welder, CYC);
    const c = CYC.c;
    updateMembership(job, k, want, c);
    const seed = cargoHash01(job.seed, k, 5);
    let age = -1;
    if (c >= job.startC[k] && c <= job.endC[k]) {
      active++;
      if (welder) welderCycle(job, k, CYC, POSE, c === job.startC[k]);
      else age = cyclePose(sw, job, k, CYC, POSE, c === job.startC[k]);
    } else if (c === job.returnC[k]) {
      returnPose(job, k, CYC, POSE, welder);
    } else {
      restPose(job, k, POSE);
    }
    if (!welder && age >= 0) {
      const si = k % job.spots.length;
      if (age < job.spotAge[si]) job.spotAge[si] = age;
    }
    writeDrone(sw, POSE, k, seed);
    if (POSE.carry) {
      const floor = POSE.overHull ? (job.kind === 0 ? SWARM_Z.hull : SWARM_Z.ship) : SWARM_Z.deck;
      pushCarried(sw, POSE.x, POSE.z, POSE.h - SWARM_UNIT.H - 0.5, POSE.yaw, POSE.res, POSE.unit / 4096, floor);
    }
  }
  job.init = true;
  sw.stats.active += active;
  // skrzynie na miejscach odbioru: znika z chwytem, po chwili wyjeżdża windą z taśmy
  const zTop = job.kind === 0 ? SWARM_Z.station : SWARM_Z.depot;
  for (let s = 0; s < job.spots.length; s++) {
    const sp = job.spots[s];
    const age = job.spotAge[s];
    const res = job.mix[(s * 5 + 3) % job.mix.length];
    if (age < 1.4) continue;
    const rise = clamp01((age - 1.4) / 1.4);
    if (age < 2.8) pushCrate(sw, sp.x, sp.z, zTop - SWARM_UNIT.H * (1 - rise), HALF_PI, res, (s + 1) * 0.173, zTop, 0, zTop);
    else pushCrate(sw, sp.x, sp.z, zTop, HALF_PI, res, (s + 1) * 0.173, NO_CLIP, 0, zTop);
  }
}

// ---------------------------------------------------------------------------
// Dźwig pochylni: jeden, kursuje między stacją taśmy (wysięgnik nad trzonem)
// a czołem budowy z blokiem (reaktor, łoże uzbrojenia, silnik).

const CRANE_TL = Object.freeze({ lower: 4, grab: 5.5, raise: 9, go: 21, place: 24, drop: 25.5, lift: 28, back: 40, refill: 31, refilled: 34 });

function craneStep(sw, i, t, building) {
  const s = sw.layout.slips[i];
  const cr = sw.cranes[i];
  const C = s.crane;
  const job = sw.slips[i];
  const up = C.legTop - 60;
  const heavyZ = s.station.heavy.z;
  const pickY = k7ZToHeight(SWARM_Z.station + SWARM_HEAVY.H);
  const placeY = k7ZToHeight(SWARM_Z.hull + SWARM_HEAVY.H);
  const P = SWARM_TUNE.cranePeriod;
  const u = t + i * 17.3;
  const cyc = Math.floor(u / P);
  const tau = u - cyc * P;
  const res = HEAVY_MIX[(cyc + i) % HEAVY_MIX.length];
  cr.res = res;
  cr.seed = cargoHash01(job.seed, cyc, 77);
  const zWork = clamp(job.front, C.z0, C.z1);
  const zHome = clamp(heavyZ, C.z0, C.z1);
  const L = CRANE_TL;
  let heavyVisible = true;
  let heavyRise = 1;
  if (!building) {
    cr.z = C.homeZ;
    cr.x = job.cx;
    cr.hookY = up;
    cr.carrying = false;
  } else if (tau < L.lower) {
    cr.z = zHome; cr.x = C.tipX;
    cr.hookY = up + (pickY - up) * smooth(tau / L.lower);
    cr.carrying = false;
  } else if (tau < L.grab) {
    cr.z = zHome; cr.x = C.tipX; cr.hookY = pickY;
    cr.carrying = tau > L.lower + 0.8;
  } else if (tau < L.raise) {
    cr.z = zHome; cr.x = C.tipX;
    cr.hookY = pickY + (up - pickY) * smooth((tau - L.grab) / (L.raise - L.grab));
    cr.carrying = true;
  } else if (tau < L.go) {
    const v = smooth((tau - L.raise) / (L.go - L.raise));
    cr.z = zHome + (zWork - zHome) * v;
    cr.x = C.tipX + (job.cx - C.tipX) * smooth(clamp01((tau - L.raise - 1) / (L.go - L.raise - 3)));
    cr.hookY = up;
    cr.carrying = true;
  } else if (tau < L.place) {
    cr.z = zWork; cr.x = job.cx;
    cr.hookY = up + (placeY - up) * smooth((tau - L.go) / (L.place - L.go));
    cr.carrying = true;
  } else if (tau < L.drop) {
    cr.z = zWork; cr.x = job.cx; cr.hookY = placeY;
    cr.carrying = tau < L.place + 0.8;
    if (!cr.carrying) pushCrate(sw, job.cx, zWork, SWARM_Z.hull, HALF_PI, res, cr.seed, NO_CLIP, 1, SWARM_Z.hull);
  } else if (tau < L.lift) {
    cr.z = zWork; cr.x = job.cx;
    cr.hookY = placeY + (up - placeY) * smooth((tau - L.drop) / (L.lift - L.drop));
    cr.carrying = false;
    // blok wtapia się w kadłub
    const sAge = clamp01((tau - L.drop) / (L.lift - L.drop));
    pushCrate(sw, job.cx, zWork, SWARM_Z.hull - SWARM_HEAVY.H * sAge, HALF_PI, res, cr.seed, SWARM_Z.hull, 1, SWARM_Z.hull);
  } else if (tau < L.back) {
    const v = smooth((tau - L.lift) / (L.back - L.lift));
    cr.z = zWork + (zHome - zWork) * v;
    cr.x = job.cx + (C.tipX - job.cx) * smooth(clamp01((tau - L.lift - 1) / (L.back - L.lift - 3)));
    cr.hookY = up;
    cr.carrying = false;
  } else {
    cr.z = zHome; cr.x = C.tipX; cr.hookY = up; cr.carrying = false;
  }
  // blok na stacji: zabrany przy chwycie, nowy wyjeżdża windą przed powrotem dźwigu
  if (building) {
    if (tau >= L.lower + 0.8 && tau < L.refill) heavyVisible = false;
    else if (tau >= L.refill && tau < L.refilled) heavyRise = (tau - L.refill) / (L.refilled - L.refill);
  }
  const next = tau >= L.refill ? cyc + 1 : cyc;
  if (heavyVisible) {
    pushCrate(sw, C.tipX, heavyZ, SWARM_Z.station - SWARM_HEAVY.H * (1 - heavyRise), HALF_PI, HEAVY_MIX[(next + i) % HEAVY_MIX.length], cargoHash01(job.seed, next, 77),
      heavyRise < 1 ? SWARM_Z.station : NO_CLIP, 1, SWARM_Z.station);
  }
  if (cr.carrying) {
    const hookZ = k7HeightToZ(cr.hookY);
    const overHull = Math.abs(cr.x - job.cx) < job.beam * 0.5 + 20;
    pushCrate(sw, cr.x, cr.z, hookZ - SWARM_HEAVY.H, HALF_PI, res, cr.seed, NO_CLIP, 1, overHull ? SWARM_Z.hull : SWARM_Z.station);
  }
}

// ---------------------------------------------------------------------------
// Taśma: dwa podajniki z galerii ringu schodzą się w trzonie i kończą w terminalu.
// Kontener wyjeżdża windą na początku podajnika i zjeżdża windą przed terminalem.

const _pt = { x: 0, z: 0, angle: 0 };
const _pa = { x: 0, z: 0, angle: 0 };
const _pb = { x: 0, z: 0, angle: 0 };

function beltStep(sw, t) {
  const T = SWARM_TUNE;
  const l = sw.layout;
  const L = sw.feedLen;
  const M = sw.perFeed * T.beltSpacing;
  const ramp = 60;
  for (let f = 0; f < 2; f++) {
    const path = l.belt.feeds[f];
    const shift = T.beltSpeed * t + f * T.beltSpacing * 0.5;
    for (let k = 0; k < sw.perFeed; k++) {
      const raw = k * T.beltSpacing + shift;
      const lap = Math.floor(raw / M);
      const s = raw - lap * M;
      if (s > L) continue;
      shipyardPathPoint(path, s, _pt);
      // kurs z różnicy (płynny obrót na zakręcie)
      shipyardPathPoint(path, Math.max(0, s - 24), _pa);
      shipyardPathPoint(path, Math.min(L, s + 24), _pb);
      const yaw = Math.atan2(_pb.z - _pa.z, _pb.x - _pa.x);
      const id = lap * sw.perFeed + k;
      const res = BELT_MIX[Math.floor(cargoHash01(id, f, 31) * BELT_MIX.length)];
      let z = SWARM_Z.belt;
      let clip = NO_CLIP;
      if (s < ramp) { z -= SWARM_UNIT.H * (1 - s / ramp); clip = SWARM_Z.belt; }
      else if (s > L - ramp) { z -= SWARM_UNIT.H * (1 - (L - s) / ramp); clip = SWARM_Z.belt; }
      pushCrate(sw, _pt.x, _pt.z, z, yaw, res, cargoHash01(id, f, 32), clip, 0, SWARM_Z.belt);
    }
  }
}

// Składy refitu: zapas kontenerów przy tylnej krawędzi (stos na dwie warstwy).
function depotStacks(sw, d) {
  for (let r = 0; r < 4; r++) {
    for (let tier = 0; tier < 2; tier++) {
      if (tier === 1 && r % 2) continue;
      const res = REFIT_MIX[(r * 3 + tier) % REFIT_MIX.length];
      pushCrate(sw, d.x - 128, d.z + (r - 1.5) * 80, SWARM_Z.depot + tier * SWARM_UNIT.H, HALF_PI, res, 0.31 + 0.07 * r + tier * 0.3, NO_CLIP, 0, SWARM_Z.depot);
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Krok roju na chwilę t [s] (czas gry — ten sam, co postęp budowy).
 * state.slips  — [{ hullId, classId, progress } | null] (slipStatesFromYard),
 * state.refit  — [{ pad, length, beam, work }] (plac piasty z okrętem w reficie;
 *                drony wysyła najbliższy wolny skład),
 * state.belt   — false: taśma stoi (bez kontenerów).
 * Wynik w buforach swarm: drones/droneCount, carried/carriedCount, crates/crateCount,
 * cranes[i] = { z, x, hookY (wysokość K-7), carrying, res }.
 */
export function stepShipyardSwarm(sw, t, state = {}) {
  const T = SWARM_TUNE;
  sw.time = t;
  sw.droneCount = 0;
  sw.carriedCount = 0;
  sw.crateCount = 0;
  sw.stats.active = 0;
  const states = state.slips || [];
  for (let i = 0; i < sw.slips.length; i++) {
    const job = sw.slips[i];
    const s = job.slip;
    const st = states[i] || null;
    const building = !!st && Number(st.progress) < 0.999;
    const stage = building ? hullBuildStage(st.progress) : 'idle';
    if (building && st.hullId !== job.hullId) {
      const size = trafficHullRenderSize(st.hullId);
      job.hullId = st.hullId;
      job.len = size ? size.w : s.padLength * 0.6;
      job.beam = size ? size.h : s.padBeam * 0.5;
    }
    // pochylnia bez kadłuba: geometria i czoło zostają (drony wracają z miejsc pracy)
    job.cx = s.x;
    job.cz = s.z;
    job.ax = 0;
    job.az = 1;
    job.z0 = s.z - job.len / 2 + 10;
    job.z1 = s.z + job.len / 2 - 10;
    if (building) job.front = job.z0 + hullBuildFront(st.progress) * (job.z1 - job.z0);
    job.cruise = SWARM_Z.cruise;
    job.workHook = SWARM_Z.hull + SWARM_UNIT.H + 1;
    job.yaw = HALF_PI;
    job.stage = stage;
    if (building) job.mix = classMix(st.classId, stage);
    job.active = building ? Math.min(job.count, T.active[stage] ?? job.count) : 0;
    job.welding = building ? Math.min(job.welders, T.welding[stage] ?? job.welders) : 0;
    stepJob(sw, job, t);
    craneStep(sw, i, t, building);
  }
  // refit: zadanie przypisane do najbliższego wolnego składu
  for (const d of sw.depots) d.pad = null;
  const refit = state.refit || [];
  for (let r = 0; r < refit.length; r++) {
    const pad = refit[r]?.pad;
    const job = nearestDepot(sw, pad);
    if (!job) continue;
    job.pad = pad;
    job.cx = pad.x;
    job.cz = pad.z;
    job.ax = Math.cos(pad.angle);
    job.az = Math.sin(pad.angle);
    job.len = Number(refit[r].length) || pad.maxLength;
    job.beam = Number(refit[r].beam) || pad.maxBeam;
    job.yaw = pad.angle;
    job.mix = REFIT_MIX;
    job.active = Math.round(clamp01(Number(refit[r].work ?? 1)) * job.count);
  }
  for (const job of sw.depots) {
    if (!job.pad) job.active = 0;
    job.cruise = SWARM_Z.refitCruise;
    job.workHook = SWARM_Z.ship + SWARM_UNIT.H + 1;
    stepJob(sw, job, t);
    depotStacks(sw, job.depot);
  }
  if (state.belt !== false) beltStep(sw, t);
  sw.stats.drones = sw.droneCount;
  sw.stats.crates = sw.crateCount;
  sw.stats.carried = sw.carriedCount;
  return sw;
}

function nearestDepot(sw, pad) {
  if (!pad) return null;
  let best = null;
  let bd = Infinity;
  for (const job of sw.depots) {
    if (job.pad) continue;
    const d = Math.hypot(job.depot.x - pad.x, job.depot.z - pad.z);
    if (d < bd) { bd = d; best = job; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rysowanie przez Z5 (CargoContainers3D, CargoDrones3D — podane przez gospodarza,
// po ich begin(), przed end()). pose — { x, y, angle } początku huba w grze:
// portHubToGame(ramka ruchu, stacja, 0, 0) i angle = atan2(−ty, tx) ramki.

/**
 * Wypycha rój stoczni do renderów Z5. Zwraca liczbę dronów w kadrze.
 */
export function pushShipyardSwarm(sw, containers, drones, pose, time = 0) {
  const C = containers;
  const D = drones;
  if (!sw || !pose) return 0;
  if (C?.ready) {
    const K = sw.crates;
    for (let i = 0; i < sw.crateCount; i++) {
      const o = i * CRATE_STRIDE;
      const heavy = K[o + CRATE.KIND] > 0.5;
      C.setDeckZ(K[o + CRATE.DECK]);
      pushBerthCrate(C, pose, K[o], K[o + 1], K[o + CRATE.Z], K[o + CRATE.YAW], heavy ? SWARM_HEAVY : SWARM_UNIT, K[o + CRATE.RES], K[o + CRATE.SEED], K[o + CRATE.CLIP], 'yard');
    }
    const L = sw.carried;
    for (let i = 0; i < sw.carriedCount; i++) {
      const o = i * CRATE_STRIDE;
      C.setDeckZ(L[o + CRATE.DECK]);
      pushBerthCrate(C, pose, L[o], L[o + 1], L[o + 2], L[o + 3], SWARM_UNIT, L[o + 4], L[o + 5], NO_CLIP, 'loose');
    }
  }
  let n = 0;
  if (D?.ready) {
    const R = sw.drones;
    for (let i = 0; i < sw.droneCount; i++) {
      if (C?.ready) C.setDeckZ(sw.droneOverHull[i] ? SWARM_Z.hull : SWARM_Z.deck);
      if (D.pushDrone(pose, R, i * CARGO_DRONE_STRIDE, SWARM_DRONE, time)) n++;
    }
  }
  C?.setDeckZ?.(SWARM_Z.deck);
  return n;
}

function pushBerthCrate(C, pose, u, v, z, yaw, unit, res, seed, clip, kind) {
  return C.pushBerthContainer(pose, u, v, z, yaw, unit, SWARM_GRID, res, seed, clip > -1e8 ? clip : undefined, 1, kind);
}
