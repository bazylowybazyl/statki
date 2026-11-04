/**
 * beamPlateField3D — POLE PŁYTY w silniku belek (docs/PLAN-zawalenia-budowli-3d.md § 3.5 p. 5, § 4.2 p. 3, etap E2;
 * zastąpi belki dysku mieszkalnego w E6 — decyzja D1: „tarcza” = dysk).
 *
 * Płyta to STATYCZNY obiekt silnika (jak teren), nie ciało: prostokątna siatka komórek (bok `cell`, nu × nv) w układzie
 * (początek o, osie u, v w płaszczyźnie, n — normalna górnej ściany), w każdej komórce GRUBOŚĆ u8 (płyta od n = 0 do
 * n = grubość · unit; 0 = otwór). Rów to ubytek grubości, otwór — 0 (D7: płytki rów w kształcie boku wieży).
 *
 * Styk: węzeł swobodnej BRYŁY BELEK (wieża H-T) albo punkt KLASTRA w warstwie płyty (od góry). Na ciało i krok:
 *  - impuls potrzebny do zatrzymania zbliżania w punkcie styku jReq, ciśnienie P = jReq / (A · dt), A = liczba komórek
 *    w styku · cell²; NOŚNOŚĆ σ [siła / j²] = capacityFree + hold · (capacityHeld − capacityFree) — ten sam wzór co
 *    prototyp progu E1 (structureGraph.js: plateCellCap, PLATE_TUNE.sigmaHeld / sigmaFree): opór komórki σ · cell²
 *    niezależny od pozostałej grubości, próg zależny od UTRZYMANIA habitatu (D8: szyja — hold 1, upadek — 0);
 *  - P ≤ nośność albo zbliżanie wolniejsze niż restSpeed (statyczny ciężar nie gniecie — jak crushRestSpeed3D):
 *    styk SPRĘŻYSTY (restytucja, tarcie, korekta przenikania), siła do haka onContact (graf nośny E1);
 *  - P > nośność: płyta stawia opór = nośność · A · dt, a materiał pod węzłami ZNIKA: grubość komórki spada do spodu
 *    najgłębszego węzła (co najmniej o krok u8), przy 0 komórka ginie (onCellLost). Zjedzona masa przejmuje prędkość
 *    ciała w punkcie styku (zderzenie niesprężyste wzdłuż n i w poprzek) — wieża traci pęd i „energię zerwania”;
 *  - REAKCJA NA CAŁE CIAŁO (prędkość i obrót ciała, dźwignia 5): węzły bryły belek NIE są przesuwane ani budzone —
 *    reakcja na węzłach budziłaby solver lokalny na przekroju wieży (+3–7 ms w grze — sceptyk wydajności K5).
 *
 * Bilans pędu w każdym kroku (test): Δp ciała = stats.j (impuls podpory płyty na ciało: opór, styk sprężysty, tarcie)
 * − stats.p (pęd nadany zjedzonej masie). Hak grafu (D.onRigidContact) dostaje impuls TEGO ciała (sprężysty, opór,
 * tarcie i niesprężysty zjedzonej masy), nie liczniki pola. Bez losowań, stałe w jednostkach fizycznych; ruchliwość
 * i impulsy w miejscu (bez pomocników z liczbami — tests/beamRigid3DAlokacje.test.mjs; AGENT: zostaje ~1 liczba na
 * wywołanie przy korekcie przenikania, źródła nie znaleziono). Klaster na jawie zapisuje komórki styku jako podporę
 * (beamRigid3D.noteRigidPlateSupport) — śpiący budzi się, gdy zgubią grubość.
 *
 * PRÓG = prototyp E1 (scripts/struktura-sym.mjs --tryb prog): jeden σ NIE rozdziela szyi od upadku (upadek przechodzi
 * przy σ ≤ 6, szyja trzyma od σ ≥ 160 — luka ×27), stąd σ zależne od utrzymania. Jednostki: E1 liczy masę w „węzłach
 * komórki 45” (objętość / 45³), silnik — masę zderzeń (massPerArea · komórka² na węzeł, dla wieży ~1,2–1,6 · 45²):
 * σ silnika ≈ σ E1 × (masa węzła 45 w silniku) — np. σ_free 4 → ~1·10⁴, σ_held 200 → ~5·10⁵ (strojenie w E6).
 */

import { noteRigidPlateSupport } from './beamRigid3D.js';

/** Liczniki ostatniego kroku (D.platePerf); czas (ms) tylko przy timing = true (narzędzia). */
export const PLATE_PERF = { timing: false, ms: 0, bodies: 0, points: 0, contacts: 0, cells: 0, eroded: 0, lost: 0 };

const nowMs = () => ((typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now());

function unit3(v, fx, fy, fz) {
  const x = Number(v?.x) || fx, y = Number(v?.y) || fy, z = Number(v?.z) || fz;
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

let NEXT_FIELD_ID = 1;

/**
 * Pole płyty. opts: origin {x, y, z} (narożnik komórki (0, 0) na dolnej ścianie, świat silnika), u, v (osie siatki;
 * n = u × v — normalna górnej ściany, chyba że opts.n), cell [j.] (45), nu, nv, thickness [j.] (grubość początkowa
 * komórek w masce), maxThickness [j.] (grubość u8 = 255; domyślnie thickness), mask(iu, iv) → bool (komórka istnieje;
 * brak — wszystkie) albo thick (Uint8Array nu·nv — gotowe grubości), capacity [masa / (j · s²) — siła na pole] albo para
 * capacityHeld / capacityFree z utrzymaniem hold (0..1, domyślnie 1; gra zmienia pole hold w czasie — D8), massPerCell (masa komórki o grubości początkowej — zjadana proporcjonalnie do ubytku), friction,
 * restitution (null — silnik), restSpeed [j/s] (null — crushRestSpeed3D silnika), onCellLost(pole, komórka, x, y, z
 * (środek komórki na dolnej ścianie), vx, vy, vz (prędkość zjedzonej masy w tym kroku), masa komórki),
 * onContact(pole, ciało, info — wspólny obiekt: count, cells, x, y, z, n, approach, impulse, force, crushing, eaten,
 * lost, pressure, capacity, doDamage).
 */
export function createPlateField(opts = {}) {
  const u = unit3(opts.u, 1, 0, 0);
  // v ortogonalne do u (Gram–Schmidt), n = u × v
  let v = unit3(opts.v, 0, 1, 0);
  const uv = u.x * v.x + u.y * v.y + u.z * v.z;
  v = unit3({ x: v.x - uv * u.x, y: v.y - uv * u.y, z: v.z - uv * u.z }, 0, 1, 0);
  const n = opts.n ? unit3(opts.n, 0, 0, 1) : { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  const cell = Number(opts.cell) > 0 ? Number(opts.cell) : 45;
  const nu = Math.max(1, Number(opts.nu) | 0), nv = Math.max(1, Number(opts.nv) | 0);
  const thickness = Number(opts.thickness) > 0 ? Number(opts.thickness) : cell;
  const maxThickness = Number(opts.maxThickness) > 0 ? Number(opts.maxThickness) : thickness;
  const unit = maxThickness / 255;
  const N = nu * nv;
  let thick;
  if (opts.thick instanceof Uint8Array && opts.thick.length === N) thick = Uint8Array.from(opts.thick);
  else {
    thick = new Uint8Array(N);
    const t0 = Math.max(0, Math.min(255, Math.round(thickness / unit)));
    const mask = typeof opts.mask === 'function' ? opts.mask : null;
    for (let iv = 0; iv < nv; iv++) for (let iu = 0; iu < nu; iu++) if (!mask || mask(iu, iv)) thick[iu + iv * nu] = t0;
  }
  let alive = 0;
  for (let c = 0; c < N; c++) if (thick[c] > 0) alive++;
  const o = opts.origin || { x: 0, y: 0, z: 0 };
  return {
    id: NEXT_FIELD_ID++,
    name: opts.name || 'płyta',
    ox: Number(o.x) || 0, oy: Number(o.y) || 0, oz: Number(o.z) || 0,
    ux: u.x, uy: u.y, uz: u.z, vx: v.x, vy: v.y, vz: v.z, nx: n.x, ny: n.y, nz: n.z,
    cell, nu, nv, unit,
    thick,
    thick0: Uint8Array.from(thick),     // grubość początkowa (obraz, test „otwór = suma przekrojów”)
    capacity: Number(opts.capacity) > 0 ? Number(opts.capacity) : 1e6,
    capacityHeld: Number(opts.capacityHeld) > 0 ? Number(opts.capacityHeld) : (Number(opts.capacity) > 0 ? Number(opts.capacity) : 1e6),
    capacityFree: Number(opts.capacityFree) > 0 ? Number(opts.capacityFree) : (Number(opts.capacity) > 0 ? Number(opts.capacity) : 1e6),
    hold: Number.isFinite(opts.hold) ? Math.max(0, Math.min(1, opts.hold)) : 1,
    massPerCell: Number(opts.massPerCell) > 0 ? Number(opts.massPerCell) : 1,
    friction: Number.isFinite(opts.friction) ? opts.friction : 0.5,
    restitution: Number.isFinite(opts.restitution) ? opts.restitution : null,
    restSpeed: Number.isFinite(opts.restSpeed) ? opts.restSpeed : null,
    onCellLost: typeof opts.onCellLost === 'function' ? opts.onCellLost : null,
    onContact: typeof opts.onContact === 'function' ? opts.onContact : null,
    alive,
    version: 0,                          // rośnie przy każdej zmianie grubości (obraz: wysyłka zakresu)
    // liczniki kroku (zerowane w pierwszej iteracji): impuls podpory na ciała (wektor), pęd zjedzonej masy, masa
    stats: { jx: 0, jy: 0, jz: 0, px: 0, py: 0, pz: 0, eaten: 0, lost: 0, contacts: 0, crushing: 0 },
    _stamp: new Int32Array(N), _gen: 0,
    _minB: new Float64Array(N),
    _cells: new Int32Array(64), _nCells: 0,
    _lost: new Int32Array(16), _nLost: 0
  };
}

// --- scratch (bez alokacji) ---
const _m = new Float64Array(9);
const _r3 = new Float64Array(3);
const _s = { x: 0, y: 0, z: 0 };
const _info = { count: 0, cells: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, approach: 0, impulse: 0, force: 0,
  crushing: false, eaten: 0, lost: 0, pressure: 0, capacity: 0, doDamage: false };

function quatMat(q, m) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - w * z); m[2] = 2 * (x * z + w * y);
  m[3] = 2 * (x * y + w * z); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - w * x);
  m[6] = 2 * (x * z - w * y); m[7] = 2 * (y * z + w * x); m[8] = 1 - 2 * (x * x + y * y);
  return m;
}

// I⁻¹ ciała w świecie (R · I⁻¹ · Rᵀ / taran — jak applyInvInertia silnika) raz na wywołanie plateBody. Ruchliwości
// i impulsy liczone W MIEJSCU na zmiennych lokalnych prędkości (zapis raz na końcu): funkcja pomocnicza z liczbami
// zmiennoprzecinkowymi w argumentach albo wyniku pakowała je w V8 (~300 B / krok — recenzja E2, zgł. 13).
const _iw = new Float64Array(9);
function worldInvInertia(b, out) {
  const m = b._rot, I = b.invInertiaLocal, sc = 1 / Math.max(1e-6, b.rammingMassMult);
  for (let i = 0; i < 3; i++) {
    const r0 = m[i * 3], r1 = m[i * 3 + 1], r2 = m[i * 3 + 2];
    const t0 = r0 * I[0] + r1 * I[3] + r2 * I[6], t1 = r0 * I[1] + r1 * I[4] + r2 * I[7], t2 = r0 * I[2] + r1 * I[5] + r2 * I[8];
    for (let j = 0; j < 3; j++) out[i * 3 + j] = (t0 * m[j * 3] + t1 * m[j * 3 + 1] + t2 * m[j * 3 + 2]) * sc;
  }
}

/**
 * Pola płyt w iteracji kolizji (update silnika, po terenie): każde swobodne ciało 3D (bryła belek nie płaska
 * i nie zakotwiczona, klaster nie śpiący i nie zamrożony) kontra każde pole. Pierwsza iteracja zeruje liczniki i jako
 * jedyna zjada grubość (doDamage — jak zgniot silnika).
 */
export function plateFieldPass(D, bodies, dt, doDamage) {
  const timing = PLATE_PERF.timing === true;
  const t0 = timing ? nowMs() : 0;
  const fields = D.plateFields;
  if (doDamage) {
    if (timing) PLATE_PERF.ms = 0;
    PLATE_PERF.bodies = 0; PLATE_PERF.points = 0; PLATE_PERF.contacts = 0;
    PLATE_PERF.cells = 0; PLATE_PERF.eroded = 0; PLATE_PERF.lost = 0;
    for (let f = 0; f < fields.length; f++) {
      const st = fields[f].stats;
      st.jx = 0; st.jy = 0; st.jz = 0; st.px = 0; st.py = 0; st.pz = 0; st.eaten = 0; st.lost = 0; st.contacts = 0; st.crushing = 0;
    }
  }
  STEP[0] = dt;
  if (doDamage) {
    // pierwsza iteracja: wszystkie swobodne ciała 3D; styki zapamiętane — druga iteracja liczy tylko je (wieża 13 tys.
    // węzłów nad płytą nie przechodzi pętli węzłów dwa razy)
    let nt = 0;
    for (let k = 0; k < bodies.length; k++) {
      const b = bodies[k];
      if (!b || b.dead || b.planar || b.static || b.anchored || b.activeNodes <= 0) continue;
      if (b.rigid === true && b.isSleeping) continue;
      for (let f = 0; f < fields.length; f++) {
        // przebicie w pierwszej iteracji: druga nie ma czego liczyć (impuls oporu tylko raz, bez korekty) — pomijamy
        if (plateBody(D, fields[f], b, true) > 0 && STEP[1] === 0) {
          if (nt === TOUCH_B.length) { TOUCH_B.push(b); TOUCH_F.push(fields[f]); } else { TOUCH_B[nt] = b; TOUCH_F[nt] = fields[f]; }
          nt++;
        }
      }
    }
    for (let k = nt; k < TOUCH_N[0]; k++) { TOUCH_B[k] = null; TOUCH_F[k] = null; }
    TOUCH_N[0] = nt;
  } else {
    for (let k = 0; k < TOUCH_N[0]; k++) {
      const b = TOUCH_B[k];
      if (b.dead) continue;
      plateBody(D, TOUCH_F[k], b, false);
    }
  }
  if (timing) PLATE_PERF.ms += nowMs() - t0;
}

// styki pierwszej iteracji (ciało, pole) i krok — bez alokacji i bez liczb zmiennoprzecinkowych w argumentach
const TOUCH_B = [], TOUCH_F = [], TOUCH_N = new Int32Array(1), STEP = new Float64Array(2);   // [dt, przebicie w ostatnim styku]

function plateBody(D, F, b, doDamage) {
  const cfg = D.config;
  const dt = STEP[0];
  const nx = F.nx, ny = F.ny, nz = F.nz, ux = F.ux, uy = F.uy, uz = F.uz, vx = F.vx, vy = F.vy, vz = F.vz;
  const cell = F.cell, nu = F.nu, nv = F.nv, unit = F.unit, thick = F.thick;
  const Tmax = 255 * unit;
  const relX = b.pos.x - F.ox, relY = b.pos.y - F.oy, relZ = b.pos.z - F.oz;
  const hc = relX * nx + relY * ny + relZ * nz;
  const vnB = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
  const swept = Math.abs(vnB) * dt;
  const R = b.radius;
  // kula ciała (z drogą w kroku) kontra warstwa płyty i prostokąt siatki
  if (hc - R > Tmax + swept || hc + R + swept < 0) return 0;
  const ac = relX * ux + relY * uy + relZ * uz, bc = relX * vx + relY * vy + relZ * vz;
  if (ac + R < 0 || ac - R > nu * cell || bc + R < 0 || bc - R > nv * cell) return 0;
  const rigid = b.rigid === true;
  // osie płyty w układzie ciała (węzeł lokalny → a, b, h jednym iloczynem): nL = Rᵀ n itd.
  const m = rigid ? null : quatMat(b.quat, _m);
  let nLx = 0, nLy = 0, nLz = 0, uLx = 0, uLy = 0, uLz = 0, vLx = 0, vLy = 0, vLz = 0;
  if (!rigid) {
    nLx = m[0] * nx + m[3] * ny + m[6] * nz; nLy = m[1] * nx + m[4] * ny + m[7] * nz; nLz = m[2] * nx + m[5] * ny + m[8] * nz;
    uLx = m[0] * ux + m[3] * uy + m[6] * uz; uLy = m[1] * ux + m[4] * uy + m[7] * uz; uLz = m[2] * ux + m[5] * uy + m[8] * uz;
    vLx = m[0] * vx + m[3] * vy + m[6] * vz; vLy = m[1] * vx + m[4] * vy + m[7] * vz; vLz = m[2] * vx + m[5] * vy + m[8] * vz;
  }
  let gen = (F._gen + 1) | 0; if (gen <= 0) { F._stamp.fill(0); gen = 1; }
  F._gen = gen;
  const stamp = F._stamp, minB = F._minB;
  F._nCells = 0;
  let count = 0, hx = 0, hy = 0, hz = 0, penMax = 0, deepK = -1;
  let npts = 0, X = null, Y = null, Z = null, active = null, RR = null, nodeR = 0;
  if (rigid) { const g = b.rg; npts = g.n; X = g.ox; Y = g.oy; Z = g.oz; RR = g.r; }
  else {
    const s = b.nodeStore; npts = s.count; X = s.x; Y = s.y; Z = s.z; active = s.active;
    nodeR = b.cellSize * (cfg.nodeRadius / cfg.cellSize);
  }
  PLATE_PERF.bodies++;
  PLATE_PERF.points += npts;
  for (let i = 0; i < npts; i++) {
    let h = 0, a = 0, bb = 0, r = 0;
    if (rigid) {
      const px = X[i] + relX, py = Y[i] + relY, pz = Z[i] + relZ;
      h = px * nx + py * ny + pz * nz; r = RR[i];
      if (h - r > Tmax) continue;
      a = px * ux + py * uy + pz * uz; bb = px * vx + py * vy + pz * vz;
    } else {
      if (!active[i]) continue;
      const lx = X[i], ly = Y[i], lz = Z[i];
      h = hc + nLx * lx + nLy * ly + nLz * lz; r = nodeR;
      if (h - r > Tmax) continue;
      a = ac + uLx * lx + uLy * ly + uLz * lz; bb = bc + vLx * lx + vLy * ly + vLz * lz;
    }
    // pod dnem przez cały krok — bez styku; pod dnem teraz, a nad nim na początku kroku — przelot w kroku (CCD)
    if (h + r < 0 && h - vnB * dt + r < 0) continue;
    if (a < 0 || bb < 0) continue;
    const iu = Math.floor(a / cell), iv = Math.floor(bb / cell);
    if (iu >= nu || iv >= nv) continue;
    const c = iu + iv * nu;
    const T = thick[c] * unit;
    if (T <= 0) continue;
    let pen = T + r - h;
    if (pen <= 0) continue;
    // głębokość korekty: najwyżej dwa promienie (węzeł głęboko w płycie — zjada ją, nie katapultuje ciała)
    if (pen > 2 * r) pen = 2 * r;
    if (stamp[c] !== gen) {
      stamp[c] = gen; minB[c] = h - r;
      if (F._nCells === F._cells.length) { const g2 = new Int32Array(F._cells.length * 2); g2.set(F._cells); F._cells = g2; }
      F._cells[F._nCells++] = c;
    } else if (h - r < minB[c]) minB[c] = h - r;
    // punkt styku: rzut punktu na górną ścianę komórki (świat)
    const up = T - h;
    if (rigid) { hx += X[i] + b.pos.x + nx * up; hy += Y[i] + b.pos.y + ny * up; hz += Z[i] + b.pos.z + nz * up; }
    else {
      const lx = X[i], ly = Y[i], lz = Z[i];
      hx += b.pos.x + m[0] * lx + m[1] * ly + m[2] * lz + nx * up;
      hy += b.pos.y + m[3] * lx + m[4] * ly + m[5] * lz + ny * up;
      hz += b.pos.z + m[6] * lx + m[7] * ly + m[8] * lz + nz * up;
    }
    if (pen > penMax) { penMax = pen; deepK = i; }
    count++;
  }
  if (count === 0) return 0;
  hx /= count; hy /= count; hz /= count;
  PLATE_PERF.contacts += count;
  PLATE_PERF.cells += F._nCells;
  F.stats.contacts += count;
  D._refreshRot(b);
  const IW = _iw;
  worldInvInertia(b, IW);
  const i0 = IW[0], i1 = IW[1], i2 = IW[2], i3 = IW[3], i4 = IW[4], i5 = IW[5], i6 = IW[6], i7 = IW[7], i8 = IW[8];
  const rx = hx - b.pos.x, ry = hy - b.pos.y, rz = hz - b.pos.z;
  // prędkości ciała w zmiennych lokalnych (zapis raz na końcu)
  let bvx = b.vel.x, bvy = b.vel.y, bvz = b.vel.z, bwx = b.angVel.x, bwy = b.angVel.y, bwz = b.angVel.z;
  const pvx = bvx + (bwy * rz - bwz * ry);
  const pvy = bvy + (bwz * rx - bwx * rz);
  const pvz = bvz + (bwx * ry - bwy * rx);
  const vn = pvx * nx + pvy * ny + pvz * nz;
  const approach = vn < 0 ? -vn : 0;
  const invMass = 1 / Math.max(1e-9, b.mass * b.rammingMassMult);
  // ruchliwość wzdłuż n: 1/m + (r × n) · I⁻¹ (r × n); człon obrotowy impulsu normalnego wn = I⁻¹ (r × n)
  const cnx = ry * nz - rz * ny, cny = rz * nx - rx * nz, cnz = rx * ny - ry * nx;
  const wnx = i0 * cnx + i1 * cny + i2 * cnz, wny = i3 * cnx + i4 * cny + i5 * cnz, wnz = i6 * cnx + i7 * cny + i8 * cnz;
  const denom = invMass + cnx * wnx + cny * wny + cnz * wnz;
  // nośność styku: σ (utrzymanie — D8, wzór E1 — plateCapacity) × pole komórek w styku
  const sigma = F.capacityFree + F.hold * (F.capacityHeld - F.capacityFree);
  const area = F._nCells * cell * cell;
  const jCap = sigma * area * dt;
  const e = F.restitution === null ? cfg.restitution : F.restitution;
  const restSpeed = F.restSpeed === null ? cfg.crushRestSpeed3D : F.restSpeed;
  let j = 0, jt = 0, tx = 0, ty = 0, tz = 0, crushing = false, pressure = 0;
  // impuls podpory na TO ciało w tym wywołaniu (hak grafu — nie liczniki pola, które sumują wszystkie ciała)
  let hJx = 0, hJy = 0, hJz = 0;
  if (vn < 0 && denom > 1e-12 && Number.isFinite(denom)) {
    const jReq = (-(1 + e) * vn) / denom;
    pressure = jReq / Math.max(1e-9, area * dt);
    crushing = approach >= restSpeed && jReq > jCap;
    j = crushing ? (doDamage ? jCap : 0) : jReq;
    if (j > 0) {
      bvx += nx * j * invMass; bvy += ny * j * invMass; bvz += nz * j * invMass;
      bwx += wnx * j; bwy += wny * j; bwz += wnz * j;
      tx = pvx - nx * vn; ty = pvy - ny * vn; tz = pvz - nz * vn;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 1e-6) {
        tx /= tl; ty /= tl; tz /= tl;
        jt = -tl / invMass;
        const fb = typeof b.friction === 'number' ? b.friction : cfg.friction;
        const maxF = j * (fb > F.friction ? fb : F.friction);
        if (jt < -maxF) jt = -maxF;
        const ctx = ry * tz - rz * ty, cty = rz * tx - rx * tz, ctz = rx * ty - ry * tx;
        bvx += tx * jt * invMass; bvy += ty * jt * invMass; bvz += tz * jt * invMass;
        bwx += (i0 * ctx + i1 * cty + i2 * ctz) * jt; bwy += (i3 * ctx + i4 * cty + i5 * ctz) * jt; bwz += (i6 * ctx + i7 * cty + i8 * ctz) * jt;
      }
      hJx = nx * j + tx * jt; hJy = ny * j + ty * jt; hJz = nz * j + tz * jt;
      F.stats.jx += hJx; F.stats.jy += hJy; F.stats.jz += hJz;
    }
  }
  let eaten = 0;
  F._nLost = 0;
  STEP[1] = crushing ? 1 : 0;
  if (doDamage && crushing) {
    F.stats.crushing++;
    // grubość pod węzłami spada do spodu najgłębszego węzła (co najmniej o krok u8); 0 — komórka ginie
    for (let q = 0; q < F._nCells; q++) {
      const c = F._cells[q];
      const T = thick[c];
      let nu8 = Math.floor(Math.max(0, minB[c]) / unit);
      if (nu8 >= T) nu8 = T - 1;
      if (nu8 < 0) nu8 = 0;
      const t0c = F.thick0[c] > 0 ? F.thick0[c] : 255;
      eaten += F.massPerCell * (T - nu8) / t0c;
      thick[c] = nu8;
      PLATE_PERF.eroded++;
      if (nu8 === 0) {
        F.alive--;
        if (F._nLost === F._lost.length) { const g2 = new Int32Array(F._lost.length * 2); g2.set(F._lost); F._lost = g2; }
        F._lost[F._nLost++] = c;
      }
    }
    F.version++;
    // zjedzona masa przejmuje prędkość ciała w punkcie styku (niesprężyście): wzdłuż n przez ruchliwość ciała,
    // w poprzek — przez masę (jak tarcie silnika); pęd masy = −impuls na ciało (bilans)
    let Jn = 0, Jt = 0, sx = 0, sy = 0, sz = 0;
    if (eaten > 0) {
      const qvx = bvx + (bwy * rz - bwz * ry);
      const qvy = bvy + (bwz * rx - bwx * rz);
      const qvz = bvz + (bwx * ry - bwy * rx);
      const vn2 = qvx * nx + qvy * ny + qvz * nz;
      if (vn2 < 0) {
        Jn = -vn2 / (denom + 1 / eaten);
        bvx += nx * Jn * invMass; bvy += ny * Jn * invMass; bvz += nz * Jn * invMass;
        bwx += wnx * Jn; bwy += wny * Jn; bwz += wnz * Jn;
      }
      sx = qvx - nx * vn2; sy = qvy - ny * vn2; sz = qvz - nz * vn2;
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (sl > 1e-9) {
        sx /= sl; sy /= sl; sz /= sl;
        Jt = -sl / (invMass + 1 / eaten);
        const csx = ry * sz - rz * sy, csy = rz * sx - rx * sz, csz = rx * sy - ry * sx;
        bvx += sx * Jt * invMass; bvy += sy * Jt * invMass; bvz += sz * Jt * invMass;
        bwx += (i0 * csx + i1 * csy + i2 * csz) * Jt; bwy += (i3 * csx + i4 * csy + i5 * csz) * Jt; bwz += (i6 * csx + i7 * csy + i8 * csz) * Jt;
      }
    }
    hJx += nx * Jn + sx * Jt; hJy += ny * Jn + sy * Jt; hJz += nz * Jn + sz * Jt;
    const dpx = -(nx * Jn + sx * Jt), dpy = -(ny * Jn + sy * Jt), dpz = -(nz * Jn + sz * Jt);
    F.stats.px += dpx; F.stats.py += dpy; F.stats.pz += dpz;
    F.stats.eaten += eaten;
    PLATE_PERF.lost += F._nLost;
    F.stats.lost += F._nLost;
    if (F.onCellLost !== null && F._nLost > 0) {
      const inv = eaten > 0 ? 1 / eaten : 0;
      const dvx = dpx * inv, dvy = dpy * inv, dvz = dpz * inv;
      for (let q = 0; q < F._nLost; q++) {
        const c = F._lost[q], iu = c % nu, iv = (c - iu) / nu;
        const a = (iu + 0.5) * cell, bb = (iv + 0.5) * cell;
        const t0c = F.thick0[c] > 0 ? F.thick0[c] : 255;
        F.onCellLost(F, c, F.ox + ux * a + vx * bb, F.oy + uy * a + vy * bb, F.oz + uz * a + vz * bb, dvx, dvy, dvz, F.massPerCell);
      }
    }
  } else if (penMax > cfg.separationSlop && vn < cfg.contactRestSpeed) {
    // styk sprężysty: korekta przenikania (ciało wychodzi wzdłuż normalnej płyty)
    const separation = 1 - Math.pow(1 - cfg.separationPercent, dt * 60);
    const corr = (penMax - cfg.separationSlop) * separation;
    b.pos.x += nx * corr; b.pos.y += ny * corr; b.pos.z += nz * corr;
  }
  // prędkości raz na końcu — tylko gdy był impuls (pola ruchu ciał belek to ogólne pola obiektu: zapis = alokacja)
  if (j > 0 || eaten > 0) {
    b.vel.x = bvx; b.vel.y = bvy; b.vel.z = bvz; b.angVel.x = bwx; b.angVel.y = bwy; b.angVel.z = bwz;
  }
  D._touchGeometry(b);
  if (rigid) {
    b.rg.touch = 1;
    // komórki pod klastrem na jawie = jego podpora (śpiący budzi się, gdy zgubi grubość — beamRigid3D.supportLost)
    if (!b.isSleeping && !b.anchored) noteRigidPlateSupport(b, F);
  }
  if (doDamage) {
    // hak grafu E1: impuls podpory na TO ciało (sprężysty, opór, tarcie i niesprężysty zjedzonej masy) w bloku
    // najgłębszego punktu — numer bloku w grafie (desc.blockId), nie indeks w opisie (recenzja E2, zgł. 6/8/11)
    if (rigid && D.onRigidContact !== null && (j > 0 || eaten > 0)) {
      const g = b.rg;
      D.onRigidContact(b, deepK >= 0 ? g.blockId[g.blk[deepK]] : -1, hJx, hJy, hJz, hx, hy, hz);
    }
    if (F.onContact !== null) {
      const info = _info;
      info.count = count; info.cells = F._nCells; info.x = hx; info.y = hy; info.z = hz; info.nx = nx; info.ny = ny; info.nz = nz;
      info.approach = approach; info.impulse = j; info.force = j / dt; info.crushing = crushing; info.eaten = eaten;
      info.lost = F._nLost; info.pressure = pressure; info.capacity = sigma; info.doDamage = doDamage;
      F.onContact(F, b, info);
    }
  }
  return count;
}

/**
 * Nośność σ pola [siła / j²] przy bieżącym utrzymaniu: capacityFree + hold · (capacityHeld − capacityFree) (wzór E1,
 * structureGraph.plateCellCap — tam σ · cell² na komórkę).
 */
export function plateCapacity(F) {
  return F.capacityFree + F.hold * (F.capacityHeld - F.capacityFree);
}

/** Grubość komórki [j.] (0 — otwór) w punkcie świata (x, y, z) rzutowanym na płytę; −1 poza siatką. */
export function plateThicknessAt(F, x, y, z) {
  const rx = x - F.ox, ry = y - F.oy, rz = z - F.oz;
  const a = rx * F.ux + ry * F.uy + rz * F.uz, b = rx * F.vx + ry * F.vy + rz * F.vz;
  if (a < 0 || b < 0) return -1;
  const iu = Math.floor(a / F.cell), iv = Math.floor(b / F.cell);
  if (iu >= F.nu || iv >= F.nv) return -1;
  return F.thick[iu + iv * F.nu] * F.unit;
}
