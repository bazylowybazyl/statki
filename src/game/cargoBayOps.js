/**
 * PRZEŁADUNEK DRONAMI: ładownia ↔ plac (stacja, dok, drugi statek) — zadanie 26.
 *
 * Czysta logika, bez three i bez stanu (jak cargoPortOps.js z Z5): plan liczy tory dronów
 * raz z kontekstu, a `bayTransferState(plan, t)` odtwarza WPROST z czasu, gdzie są drony,
 * które moduły stoją w slotach ładowni, które na placu, a które wiszą pod dronami.
 * Materializacja w połowie przeładunku (bańka ruchu, Z14) od razu daje właściwy obraz.
 *
 * UKŁAD: świat 3D sceny (x, y = −y gry, z w górę; płaszczyzna gry z = 0). Slot ładowni
 * i komórka placu = środek PODSTAWY modułu (x, y, z) i kurs yaw. Dron niesie moduł na
 * haku: punkt odniesienia drona to hak (spód ramy chwytaka = wierzch modułu), podstawa
 * niesionego modułu = hak − H.
 *
 * TOR DRONA: wynurzenie z gniazda (włazu w polu startowym, płaszczyzna cięcia = pokład),
 * wznoszenie na wysokość przelotu, potem dla każdego zadania: nad źródło → w dół → chwyt →
 * w górę → nad cel (obrót do kursu celu w przelocie) → w dół (do ładowni: przez otwarty
 * otwór) → odłożenie → w górę; na końcu powrót do gniazda. Ruch poziomy tylko na wysokości
 * przelotu (nad kadłubami i stosami skrzydeł wrót), drony parzyste i nieparzyste na dwóch
 * warstwach. Podział: zadania posortowane wzdłuż osi ładowni i pocięte na ciągłe odcinki —
 * dron ma swój kawałek ładowni i placu, tory się nie krzyżują.
 *
 * KOLEJNOŚĆ: sloty podaje wołający w kolejności załadunku (cargoBaySlots: od rufy); przy
 * rozładunku drony biorą je od końca. Komórki placu — od najbliższej.
 */

import {
  cargoBaySlots, cargoBayToShip, cargoShipToWorld, cargoBayWorldYaw
} from '../data/cargoBays.js';

export const BAY_MODE = Object.freeze({ LOAD: 'load', UNLOAD: 'unload' });

export const BAY_TRANSFER = Object.freeze({
  lockSeconds: 0.6,
  releaseSeconds: 0.45,
  emergeSeconds: 0.9,
  launchInterval: 0.8,
  minSegment: 0.25,
  hoverMax: 0.2,        // krótkie zawiśnięcie nad źródłem (z ziarna)
  cruiseClear: 6,       // zapas nad najwyższą przeszkodą [j.]
  layer: 6,             // różnica wysokości przelotu dronów parzystych i nieparzystych
  speedBase: 90,        // prędkość pozioma = speedBase + speedPerUnit · L modułu (w granicach)
  speedPerUnit: 3.5,
  speedMin: 110,
  speedMax: 280,
  vRatio: 0.35,
  vMin: 40
});

export const BAY_PHASE = Object.freeze({ HIDDEN: 0, LAUNCH: 1, TRANSIT: 2, WORK: 3, RETURN: 4 });

// Pola wyników (Float32Array, krok = STRIDE).
export const BAY_DRONE_STRIDE = 16;
export const BAY_DRONE = Object.freeze({
  X: 0, Y: 1, Z: 2, YAW: 3,
  /** Niesiony moduł: numer zadania albo −1. */
  CARRY: 4,
  /** Ciąg manewrowy 0…1 i kierunek przyspieszenia (x, y, z) — błyski RCS. */
  THRUST: 5, AX: 6, AY: 7, AZ: 8,
  /** Płaszczyzna cięcia (wyłaz gniazda): część drona poniżej jest schowana; −1e9 = brak. */
  CLIP: 9,
  /** Indeks ładowni, w której dron teraz jest (światło lamp), albo −1. */
  BAY: 10,
  INDEX: 11, SEED: 12, PHASE: 13, SPARE: 14, SPARE2: 15
});
export const BAY_CARRIED_STRIDE = 8;
export const BAY_CARRIED = Object.freeze({ X: 0, Y: 1, Z: 2, YAW: 3, JOB: 4, BAY: 5, SPARE: 6, SPARE2: 7 });

const NO_CLIP = -1e9;
const KF = 8;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => t * t * (3 - 2 * t);

/** Hash 32-bit → [0, 1) (ziarno planu, dron, zadanie). */
export function bayHash01(a, b = 0, c = 0) {
  let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15) ^ ((c | 0) * 0x27d4eb2d), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ============================================================
// Sloty ładowni w świecie
// ============================================================

/**
 * Sloty modułów ładowni w świecie 3D w kolejności załadunku: [{ x, y, z, yaw, bay, slot }].
 * geo — cargoBayGeometry, pose — poza GRY statku { x, y, angle }, bayIndex — numer ładowni
 * w tablicy świateł (materiały), z = dno ładowni.
 */
export function bayWorldSlots(geo, pose, bayIndex = 0) {
  const out = [];
  const yaw = cargoBayWorldYaw(pose);
  const p = {};
  const w = {};
  for (const s of cargoBaySlots(geo)) {
    cargoBayToShip(geo, s.a, s.b, p);
    cargoShipToWorld(pose, p.x, p.y, w);
    out.push({ x: w.x, y: w.y, z: -geo.depth, yaw, bay: bayIndex, slot: s.index });
  }
  return out;
}

// ============================================================
// Plan
// ============================================================

function moveDur(dx, dy, dz, vh, vv, minSeg) {
  return Math.max(minSeg, Math.sqrt(dx * dx + dy * dy) / vh + Math.abs(dz) / vv);
}

/**
 * Plan przeładunku. ctx:
 *   seed, mode ('load' | 'unload'),
 *   unit       — { L, W, H } modułu,
 *   slots      — sloty ładowni w kolejności załadunku (bayWorldSlots; może być kilka ładowni),
 *   cells      — komórki placu [{ x, y, z, yaw }] od najbliższej,
 *   count      — ile modułów przenieść (≤ slotów i komórek),
 *   nests      — gniazda dronów [{ x, y, z }] (z = pokład pola startowego),
 *   drones     — liczba dronów,
 *   start      — początek okna [s] (wrota muszą być już otwarte, gdy dron dotrze do ładowni),
 *   obstacleTop — najwyższa przeszkoda na trasie [z] (stosy skrzydeł wrót, nadbudówki),
 *   axis       — { x, y } oś ładowni do podziału zadań (domyślnie z rozrzutu slotów).
 */
export function planBayTransfer(ctx) {
  const P = BAY_TRANSFER;
  const mode = ctx.mode === BAY_MODE.UNLOAD ? BAY_MODE.UNLOAD : BAY_MODE.LOAD;
  const unit = { L: Number(ctx.unit?.L) || 16, W: Number(ctx.unit?.W) || 8, H: Number(ctx.unit?.H) || 8 };
  const slots = Array.isArray(ctx.slots) ? ctx.slots : [];
  const cells = Array.isArray(ctx.cells) ? ctx.cells : [];
  const N = Math.max(0, Math.min(ctx.count | 0, slots.length, cells.length));
  const D = N > 0 ? Math.max(1, Math.min((ctx.drones | 0) || 1, N)) : 0;
  const seed = ctx.seed | 0;
  const nests = Array.isArray(ctx.nests) && ctx.nests.length ? ctx.nests : [{ x: 0, y: 0, z: 0 }];
  const start = Number(ctx.start) || 0;
  const vh = clamp(P.speedBase + P.speedPerUnit * unit.L, P.speedMin, P.speedMax);
  const vv = Math.max(P.vMin, vh * P.vRatio);
  const droneH = 0.42 * Math.min(unit.L, unit.W) + 1;

  // Wysokość przelotu: nad wszystkim, z modułem pod hakiem.
  let top = Number.isFinite(ctx.obstacleTop) ? ctx.obstacleTop : 0;
  for (let i = 0; i < N; i++) top = Math.max(top, slots[i].z + unit.H, cells[i].z + unit.H);
  for (const n of nests) top = Math.max(top, n.z + droneH);
  const cruiseBase = top + unit.H + P.cruiseClear;

  // Oś ładowni do podziału (rozrzut slotów; bez rozrzutu — oś x).
  let ax = Number(ctx.axis?.x);
  let ay = Number(ctx.axis?.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || Math.hypot(ax, ay) < 1e-6) {
    ax = 1; ay = 0;
    if (N > 1) {
      let mx = 0; let my = 0;
      for (let i = 0; i < N; i++) { mx += slots[i].x; my += slots[i].y; }
      mx /= N; my /= N;
      let xx = 0; let xy = 0; let yy = 0;
      for (let i = 0; i < N; i++) {
        const dx = slots[i].x - mx; const dy = slots[i].y - my;
        xx += dx * dx; xy += dx * dy; yy += dy * dy;
      }
      const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
      ax = Math.cos(ang); ay = Math.sin(ang);
    }
  }
  const al = Math.hypot(ax, ay);
  ax /= al; ay /= al;

  // Zadania: moduł j = slot j (kolejność załadunku) ↔ komórka. Podział na drony: odcinki
  // wzdłuż osi; komórki przydzielone w tej samej kolejności rzutu — tory równoległe.
  const proj = (o) => o.x * ax + o.y * ay;
  const jobsByAxis = [];
  for (let j = 0; j < N; j++) jobsByAxis.push(j);
  jobsByAxis.sort((p, q) => proj(slots[p]) - proj(slots[q]) || p - q);
  const cellsByAxis = [];
  for (let c = 0; c < N; c++) cellsByAxis.push(c);
  cellsByAxis.sort((p, q) => proj(cells[p]) - proj(cells[q]) || p - q);
  const jobCell = new Int32Array(N);
  for (let k = 0; k < N; k++) jobCell[jobsByAxis[k]] = cellsByAxis[k];

  const groups = [];
  for (let d = 0; d < D; d++) {
    const g = jobsByAxis.slice(Math.floor(d * N / D), Math.floor((d + 1) * N / D));
    // Załadunek: kolejność zapełniania (od rufy); rozładunek: od końca.
    g.sort((p, q) => (mode === BAY_MODE.LOAD ? p - q : q - p));
    groups.push(g);
  }

  const tLock = new Float64Array(N).fill(Infinity);
  const tRelease = new Float64Array(N).fill(Infinity);
  const jobDrone = new Int16Array(N).fill(-1);
  const tracks = [];
  let end = start;
  let bayFirstEntry = Infinity;
  let bayClearAt = start;

  for (let d = 0; d < D; d++) {
    const nest = nests[d % nests.length];
    const cruise = cruiseBase + (d % 2) * P.layer;
    const list = [];
    const push = (t, x, y, z, yaw, carry, clip, phase, bay) => list.push([t, x, y, z, yaw, carry, clip, phase, bay]);
    let t = start + d * P.launchInterval;
    let x = nest.x; let y = nest.y; let z = nest.z - droneH - 0.5; let yaw = 0;
    // Klatka niesie stan odcinka, który się w niej ZACZYNA.
    push(t, x, y, z, yaw, -1, nest.z, BAY_PHASE.LAUNCH, -1);
    t += P.emergeSeconds; z = nest.z + 0.5;
    push(t, x, y, z, yaw, -1, NO_CLIP, BAY_PHASE.LAUNCH, -1);
    t += moveDur(0, 0, cruise - z, vh, vv, P.minSegment); z = cruise;
    const g = groups[d];
    for (let k = 0; k < g.length; k++) {
      const j = g[k];
      jobDrone[j] = d;
      const slot = slots[j];
      const cell = cells[jobCell[j]];
      const src = mode === BAY_MODE.LOAD ? cell : slot;
      const dst = mode === BAY_MODE.LOAD ? slot : cell;
      const srcBay = mode === BAY_MODE.LOAD ? -1 : (slot.bay ?? 0);
      const dstBay = mode === BAY_MODE.LOAD ? (slot.bay ?? 0) : -1;
      const hover = P.hoverMax * bayHash01(seed, j, 7);
      // nad źródło (obrót do kursu źródła), w dół, chwyt, w górę
      push(t, x, y, z, yaw, -1, NO_CLIP, BAY_PHASE.TRANSIT, -1);
      t += moveDur(src.x - x, src.y - y, 0, vh, vv, P.minSegment) + hover;
      x = src.x; y = src.y; yaw = src.yaw;
      push(t, x, y, z, yaw, -1, NO_CLIP, BAY_PHASE.WORK, srcBay);
      if (srcBay >= 0) bayFirstEntry = Math.min(bayFirstEntry, t);
      t += moveDur(0, 0, cruise - (src.z + unit.H), vh, vv, P.minSegment); z = src.z + unit.H;
      push(t, x, y, z, yaw, -1, NO_CLIP, BAY_PHASE.WORK, srcBay);
      t += P.lockSeconds;
      tLock[j] = t;
      push(t, x, y, z, yaw, j, NO_CLIP, BAY_PHASE.WORK, srcBay);
      t += moveDur(0, 0, cruise - z, vh, vv, P.minSegment); z = cruise;
      if (srcBay >= 0) bayClearAt = Math.max(bayClearAt, t);
      // przelot z modułem (obrót do kursu celu), w dół, odłożenie, w górę
      push(t, x, y, z, yaw, j, NO_CLIP, BAY_PHASE.TRANSIT, -1);
      t += moveDur(dst.x - x, dst.y - y, 0, vh, vv, P.minSegment);
      x = dst.x; y = dst.y; yaw = dst.yaw;
      push(t, x, y, z, yaw, j, NO_CLIP, BAY_PHASE.WORK, dstBay);
      if (dstBay >= 0) bayFirstEntry = Math.min(bayFirstEntry, t);
      t += moveDur(0, 0, cruise - (dst.z + unit.H), vh, vv, P.minSegment); z = dst.z + unit.H;
      push(t, x, y, z, yaw, j, NO_CLIP, BAY_PHASE.WORK, dstBay);
      t += P.releaseSeconds;
      tRelease[j] = t;
      push(t, x, y, z, yaw, -1, NO_CLIP, BAY_PHASE.WORK, dstBay);
      t += moveDur(0, 0, cruise - z, vh, vv, P.minSegment); z = cruise;
      if (dstBay >= 0) bayClearAt = Math.max(bayClearAt, t);
    }
    // Powrót: nad gniazdo, w dół, schowanie we włazie.
    push(t, x, y, z, yaw, -1, NO_CLIP, BAY_PHASE.RETURN, -1);
    t += moveDur(nest.x - x, nest.y - y, 0, vh, vv, P.minSegment);
    x = nest.x; y = nest.y;
    push(t, x, y, z, yaw, -1, NO_CLIP, BAY_PHASE.RETURN, -1);
    t += moveDur(0, 0, cruise - nest.z, vh, vv, P.minSegment); z = nest.z + 0.5;
    push(t, x, y, z, yaw, -1, nest.z, BAY_PHASE.RETURN, -1);
    t += P.emergeSeconds; z = nest.z - droneH - 0.5;
    push(t, x, y, z, yaw, -1, nest.z, BAY_PHASE.HIDDEN, -1);
    const kf = new Float64Array(list.length * (KF + 1));
    for (let i = 0; i < list.length; i++) for (let f = 0; f <= KF; f++) kf[i * (KF + 1) + f] = list[i][f];
    tracks.push({ drone: d, nest, cruise, kf, count: list.length, jobs: g });
    end = Math.max(end, t);
  }

  // Moduł j: gdzie stoi na starcie i na końcu (sloty i komórki w indeksach tablic ctx).
  const slotJob = new Int32Array(slots.length).fill(-1);
  const cellJob = new Int32Array(cells.length).fill(-1);
  for (let j = 0; j < N; j++) { slotJob[j] = j; cellJob[jobCell[j]] = j; }

  return {
    ctx, mode, seed, unit, N, D, vh, vv, droneH, cruiseBase,
    slots, cells, jobCell, slotJob, cellJob, jobDrone,
    tLock, tRelease, tracks,
    start, end,
    bayFirstEntry: Number.isFinite(bayFirstEntry) ? bayFirstEntry : start,
    bayClearAt
  };
}

// ============================================================
// Odczyt toru
// ============================================================

const STRIDE_KF = KF + 1;

function locate(kf, count, t) {
  let lo = 0;
  let hi = count - 1;
  if (t < kf[0]) return -1;
  if (t >= kf[hi * STRIDE_KF]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kf[mid * STRIDE_KF] <= t) lo = mid; else hi = mid;
  }
  return lo;
}

const _pose = { x: 0, y: 0, z: 0, yaw: 0, carry: -1, clip: NO_CLIP, phase: 0, bay: -1, thrust: 0, ax: 0, ay: 0, az: 0, visible: false };

/** Poza drona na torze w chwili t → out (bez alokacji). */
export function bayTrackPose(track, t, out = _pose) {
  const kf = track.kf;
  const i = locate(kf, track.count, t);
  if (i < 0 || i >= track.count - 1) { out.visible = false; out.phase = BAY_PHASE.HIDDEN; return out; }
  const o = i * STRIDE_KF;
  const o2 = o + STRIDE_KF;
  const t0 = kf[o];
  const d = kf[o2] - t0;
  const x = d > 1e-9 ? clamp((t - t0) / d, 0, 1) : 1;
  const e = smooth(x);
  const dx = kf[o2 + 1] - kf[o + 1];
  const dy = kf[o2 + 2] - kf[o + 2];
  const dz = kf[o2 + 3] - kf[o + 3];
  out.x = kf[o + 1] + dx * e;
  out.y = kf[o + 2] + dy * e;
  out.z = kf[o + 3] + dz * e;
  let dyaw = kf[o2 + 4] - kf[o + 4];
  dyaw -= Math.PI * 2 * Math.round(dyaw / (Math.PI * 2));
  out.yaw = kf[o + 4] + dyaw * e;
  out.carry = kf[o + 5];
  out.clip = kf[o + 6];
  out.phase = kf[o + 7];
  out.bay = kf[o + 8];
  // smoothstep: a ∝ 6 − 12x (dodatnie = rozpędzanie, ujemne = hamowanie).
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const acc = 6 - 12 * x;
  out.thrust = len > 1e-6 ? clamp(Math.abs(acc) / 6, 0, 1) : 0.12;
  const sg = acc >= 0 ? 1 : -1;
  out.ax = len > 1e-6 ? dx / len * sg : 0;
  out.ay = len > 1e-6 ? dy / len * sg : 0;
  out.az = len > 1e-6 ? dz / len * sg : 1;
  out.visible = true;
  return out;
}

// ============================================================
// Stan w chwili t
// ============================================================

/** Bufor wyników dla planu (tablice na zapas, bez alokacji przy odczycie). */
export function createBayTransferState(plan) {
  return {
    time: 0,
    slotHas: new Uint8Array(Math.max(1, plan?.slots?.length || 1)),
    cellHas: new Uint8Array(Math.max(1, plan?.cells?.length || 1)),
    inBay: 0, onYard: 0, carriedCount: 0, droneCount: 0,
    drones: new Float32Array(Math.max(1, plan?.D || 1) * BAY_DRONE_STRIDE),
    carried: new Float32Array(Math.max(1, plan?.D || 1) * BAY_CARRIED_STRIDE),
    busy: false,
    done: false
  };
}

/**
 * Stan przeładunku w chwili t → out (createBayTransferState). Zależy tylko od planu i t.
 * slotHas[i] / cellHas[c] — moduł stoi w slocie / komórce; drony i niesione moduły w tablicach.
 */
export function bayTransferState(plan, t, out = null) {
  const o = out || createBayTransferState(plan);
  const load = plan.mode === BAY_MODE.LOAD;
  o.time = t;
  o.slotHas.fill(0);
  o.cellHas.fill(0);
  let inBay = 0;
  let onYard = 0;
  for (let j = 0; j < plan.N; j++) {
    const locked = t >= plan.tLock[j];
    const released = t >= plan.tRelease[j];
    const atSrc = !locked;
    const atDst = released;
    const c = plan.jobCell[j];
    if (load) {
      if (atSrc) { o.cellHas[c] = 1; onYard++; }
      if (atDst) { o.slotHas[j] = 1; inBay++; }
    } else {
      if (atSrc) { o.slotHas[j] = 1; inBay++; }
      if (atDst) { o.cellHas[c] = 1; onYard++; }
    }
  }
  o.inBay = inBay;
  o.onYard = onYard;
  let nd = 0;
  let nc = 0;
  let busy = false;
  const D = o.drones;
  const C = o.carried;
  const H = plan.unit.H;
  for (let k = 0; k < plan.tracks.length; k++) {
    const tr = plan.tracks[k];
    const p = bayTrackPose(tr, t, _pose);
    if (!p.visible) continue;
    busy = true;
    const q = nd * BAY_DRONE_STRIDE;
    D[q + BAY_DRONE.X] = p.x;
    D[q + BAY_DRONE.Y] = p.y;
    D[q + BAY_DRONE.Z] = p.z;
    D[q + BAY_DRONE.YAW] = p.yaw;
    D[q + BAY_DRONE.CARRY] = p.carry;
    D[q + BAY_DRONE.THRUST] = p.thrust;
    D[q + BAY_DRONE.AX] = p.ax;
    D[q + BAY_DRONE.AY] = p.ay;
    D[q + BAY_DRONE.AZ] = p.az;
    D[q + BAY_DRONE.CLIP] = p.clip;
    D[q + BAY_DRONE.BAY] = p.bay;
    D[q + BAY_DRONE.INDEX] = tr.drone;
    D[q + BAY_DRONE.SEED] = bayHash01(plan.seed, tr.drone, 3);
    D[q + BAY_DRONE.PHASE] = p.phase;
    D[q + BAY_DRONE.SPARE] = 0;
    D[q + BAY_DRONE.SPARE2] = 0;
    nd++;
    if (p.carry >= 0) {
      const r = nc * BAY_CARRIED_STRIDE;
      C[r + BAY_CARRIED.X] = p.x;
      C[r + BAY_CARRIED.Y] = p.y;
      C[r + BAY_CARRIED.Z] = p.z - H;
      C[r + BAY_CARRIED.YAW] = p.yaw;
      C[r + BAY_CARRIED.JOB] = p.carry;
      C[r + BAY_CARRIED.BAY] = p.bay;
      C[r + BAY_CARRIED.SPARE] = 0;
      C[r + BAY_CARRIED.SPARE2] = 0;
      nc++;
    }
  }
  o.droneCount = nd;
  o.carriedCount = nc;
  o.busy = busy;
  o.done = t >= plan.end;
  return o;
}

/** Siatka komórek placu: rzędy × kolumny modułów wokół środka (x, y) z kursem yaw. */
export function bayYardCells(cx, cy, z, yaw, cols, rows, unit, gap = 6) {
  const out = [];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pa = unit.L + gap;
  const pb = unit.W + gap;
  const a0 = -((cols - 1) * pa) / 2;
  const b0 = -((rows - 1) * pb) / 2;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = a0 + i * pa;
      const b = b0 + j * pb;
      out.push({ x: cx + c * a - s * b, y: cy + s * a + c * b, z, yaw, col: i, row: j });
    }
  }
  return out;
}

/** Komórki od najbliższej punktowi (x, y) — kolejność zapełniania placu. */
export function bayOrderCellsNear(cells, x, y) {
  return cells.slice().sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y));
}
