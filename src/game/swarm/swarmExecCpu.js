/**
 * WYKONAWCA CPU ROJU — uproszczone lustro maszyny stanów drona z GPU (src/3d/swarm/swarmSim.js):
 * te same fazy, zadania z pierścienia 2 wpisów, liczniki kontenerów i zamki kolumn, czasy chwytu
 * i odłożenia — ale lot po prostej ze stałą prędkością i bez unikania. Do testów planisty
 * w Node (kompletność, kolejność stosów, jedna operacja na kolumnę) i do porównań bez GPU.
 *
 * NIEZALEŻNA KONTROLA GEOMETRII CHWYTU: wykonawca trzyma własne komórki kolumn; przy chwycie
 * sprawdza, że kontenery z zadania leżą na wierzchu swoich komórek na poziomie chwytu, a przy
 * odłożeniu liczy komórkę celu Z POZY (punkt odłożenia + obrót kursem drona × miejsce w chwycie —
 * ten sam wzór co RELEASE w kernelu) i sprawdza, że jest wolna i równa poziomowi odłożenia.
 * Czysta logika: bez three, bez DOM.
 */

import { SWARM_PHASE, SWARM_TASK, SWARM_TASK_FLOATS } from './swarmPort.js';
import { SWARM_CELL_PITCH, swarmDroneClass, swarmPackSlotOffset, SWARM_LOADED_SPEED } from '../../data/swarmDrones.js';
import { CARGO_CONTAINER } from '../../data/cargoBays.js';

/** Czasy operacji [s] — te same co na GPU (swarmSim.js, SWARM_SIM_TUNE). */
export const SWARM_OP_TIMES = Object.freeze({ grip: 0.55, release: 0.45, alignMin: 0.2, launch: 0 });

const P = SWARM_PHASE;

/**
 * Wykonawca: port (buildSwarmPort + kontenery), drony [{ index, classId, pad }].
 * Zwraca { status (Float32Array 4 × n), writeTask(drone, serial, rekord), step(dt), stats, check() }.
 */
export function createSwarmExecCpu(port, drones) {
  const cols = port.columns;
  const n = drones.length;
  const H = CARGO_CONTAINER.H;
  const count = new Int32Array(cols.length);
  const lock = new Int32Array(cols.length).fill(-1);
  // Komórki: wysokość stosu i kontener na każdym poziomie (własna księga wykonawcy).
  const cellH = cols.map((c) => new Int32Array(Math.max(1, c.cells)));
  const cellU = cols.map((c) => new Int32Array(Math.max(1, c.cells * Math.max(1, c.levels))).fill(-1));
  const pos = new Map();
  for (const u of port.units || []) {
    const c = cols[u.col];
    cellU[u.col][u.level * c.cells + u.cell] = u.id;
    cellH[u.col][u.cell] = Math.max(cellH[u.col][u.cell], u.level + 1);
    count[u.col]++;
    pos.set(u.id, { col: u.col, level: u.level, cell: u.cell });
  }
  const ring = new Float32Array(n * 2 * SWARM_TASK_FLOATS).fill(-1);
  const status = new Float32Array(n * 4);
  const st = drones.map((d) => {
    const pad = cols[d.pad];
    const cls = swarmDroneClass(d.classId);
    return {
      d, cls, x: pad.x, y: pad.y, z: pad.zBase, phase: P.PARKED, timer: 0, serial: 0, carried: [],
      pending: -1, wait: 0, pad, padEntry: pad.entryZ
    };
  });
  const stats = { contention: 0, stackErrors: 0, levelErrors: 0, cellErrors: 0, ops: 0, moved: 0, time: 0, inColumn: 0, overlapErrors: 0 };

  const rec = (i, s) => (i * 2 + (s % 2)) * SWARM_TASK_FLOATS;
  const field = (o, v, k) => ring[o + v * 4 + k];
  function hasTask(i, s) {
    return field(rec(i, s), SWARM_TASK.IDS, 1) === s;
  }

  function writeTask(i, serial, r) {
    ring.set(r, rec(i, serial));
  }

  function moveTo(s, tx, ty, tz, v, dt) {
    const dx = tx - s.x;
    const dy = ty - s.y;
    const dz = tz - s.z;
    const d = Math.hypot(dx, dy, dz);
    const step = v * dt;
    if (d <= step) { s.x = tx; s.y = ty; s.z = tz; return true; }
    s.x += dx / d * step; s.y += dy / d * step; s.z += dz / d * step;
    return false;
  }

  const _so = {};
  /** Komórka kolumny pod punktem (x, y) — środek komórki w 0,05 j. albo −1. */
  function cellAt(ci, x, y) {
    const c = cols[ci];
    const dx = x - c.x;
    const dy = y - c.y;
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    const a = cs * dx + sn * dy;
    const b = -sn * dx + cs * dy;
    const fx = a / SWARM_CELL_PITCH.a + (c.cnx - 1) / 2;
    const fy = b / SWARM_CELL_PITCH.b + (c.cny - 1) / 2;
    const ix = Math.round(fx);
    const iy = Math.round(fy);
    if (ix < 0 || iy < 0 || ix >= c.cnx || iy >= c.cny) return -1;
    if (Math.abs(fx - ix) * SWARM_CELL_PITCH.a > 0.05 || Math.abs(fy - iy) * SWARM_CELL_PITCH.b > 0.05) return -1;
    return iy * c.cnx + ix;
  }

  function stepDrone(i, dt) {
    const s = st[i];
    const cls = s.cls;
    const F = cls.flight;
    const o = rec(i, s.serial);
    const v = s.carried.length ? F.vMax * SWARM_LOADED_SPEED : F.vMax;
    const vv = F.vVert;
    // Zwolnienie zamka po wyjściu z obrysu kolumny (jak na GPU).
    const unlock = () => { if (s.pending >= 0 && lock[s.pending] === i) lock[s.pending] = -1; s.pending = -1; };
    if (s.pending >= 0) {
      const c = cols[s.pending];
      if (Math.hypot(s.x - c.x, s.y - c.y) > cls.extents.loaded.rh * 1.2 + 1) unlock();
    }
    switch (s.phase) {
      case P.PARKED:
        if (hasTask(i, s.serial)) { s.phase = P.LAUNCH; s.timer = 0; }
        break;
      case P.LAUNCH:
        if (moveTo(s, s.pad.x, s.pad.y, s.padEntry, vv, dt)) s.phase = P.TO_PICK;
        break;
      case P.TO_PICK:
      case P.TO_DROP: {
        const pick = s.phase === P.TO_PICK;
        const k = pick ? SWARM_TASK.PICK : SWARM_TASK.DROP;
        const tz = field(o, SWARM_TASK.ALT, pick ? 0 : 1);
        if (moveTo(s, field(o, k, 0), field(o, k, 1), tz, v, dt)) { s.phase = pick ? P.ALIGN_PICK : P.ALIGN_DROP; s.timer = 0; }
        break;
      }
      case P.ALIGN_PICK:
      case P.ALIGN_DROP: {
        const pick = s.phase === P.ALIGN_PICK;
        s.timer += dt;
        const col = field(o, SWARM_TASK.IDS, pick ? 2 : 3) | 0;
        // Licznik kolumny = kontenery przed tym zadaniem (poprzednie operacje na kolumnie skończone).
        const need = field(o, SWARM_TASK.LEVELS, pick ? 0 : 1) | 0;
        if (s.timer < SWARM_OP_TIMES.alignMin) break;
        if (count[col] !== need) { s.wait += dt; break; }
        if (lock[col] >= 0 && lock[col] !== i) { s.wait += dt; stats.contention++; break; }
        // Zejście do innej kolumny: poprzednia (obok) jest już poza obrysem toru — zwolnij ją.
        unlock();
        lock[col] = i;
        s.phase = pick ? P.DESC_PICK : P.DESC_DROP;
        break;
      }
      case P.DESC_PICK:
      case P.DESC_DROP: {
        const pick = s.phase === P.DESC_PICK;
        const k = pick ? SWARM_TASK.PICK : SWARM_TASK.DROP;
        if (moveTo(s, field(o, k, 0), field(o, k, 1), field(o, k, 2), vv, dt)) { s.phase = pick ? P.GRIP : P.RELEASE; s.timer = 0; }
        break;
      }
      case P.GRIP: {
        s.timer += dt;
        if (s.timer < SWARM_OP_TIMES.grip) break;
        const col = field(o, SWARM_TASK.IDS, 2) | 0;
        const c = cols[col];
        const L = Math.round((field(o, SWARM_TASK.PICK, 2) - c.zBase) / H) - 1;
        if (count[col] !== (field(o, SWARM_TASK.LEVELS, 0) | 0)) stats.levelErrors++;
        s.carried = [];
        for (let k = 0; k < 8; k++) {
          const u = ring[o + (k < 4 ? SWARM_TASK.UNITS_A * 4 + k : SWARM_TASK.UNITS_B * 4 + k - 4)];
          if (!(u >= 0)) continue;
          const p = pos.get(u);
          // Kontener na wierzchu swojej komórki, na poziomie chwytu, w kolumnie źródła.
          if (!p || p.col !== col || p.level !== L || cellH[col][p.cell] !== L + 1) { stats.stackErrors++; continue; }
          // Miejsce w chwycie zgodne z pozą: środek kontenera = punkt chwytu + obrót × miejsce k.
          swarmPackSlotOffset(cls.pack.nx, cls.pack.ny, k, _so);
          const yaw = field(o, SWARM_TASK.PICK, 3);
          const wx = field(o, SWARM_TASK.PICK, 0) + Math.cos(yaw) * _so.a - Math.sin(yaw) * _so.b;
          const wy = field(o, SWARM_TASK.PICK, 1) + Math.sin(yaw) * _so.a + Math.cos(yaw) * _so.b;
          if (cellAt(col, wx, wy) !== p.cell) stats.cellErrors++;
          cellU[col][L * c.cells + p.cell] = -1;
          cellH[col][p.cell]--;
          pos.delete(u);
          s.carried.push({ u, k });
        }
        if (s.carried.length !== (field(o, SWARM_TASK.IDS, 0) | 0)) stats.stackErrors++;
        count[col] -= s.carried.length;
        s.phase = P.ASC_PICK;
        break;
      }
      case P.ASC_PICK:
        if (moveTo(s, s.x, s.y, field(o, SWARM_TASK.ALT, 0), vv, dt)) {
          unlock();
          s.pending = field(o, SWARM_TASK.IDS, 2) | 0;
          s.phase = P.TO_DROP;
        }
        break;
      case P.RELEASE: {
        s.timer += dt;
        if (s.timer < SWARM_OP_TIMES.release) break;
        const col = field(o, SWARM_TASK.IDS, 3) | 0;
        const c = cols[col];
        if (count[col] !== (field(o, SWARM_TASK.LEVELS, 1) | 0)) stats.levelErrors++;
        const L = Math.round((field(o, SWARM_TASK.DROP, 2) - c.zBase) / H) - 1;
        const yaw = field(o, SWARM_TASK.DROP, 3);
        for (const { u, k } of s.carried) {
          // Komórka celu z pozy (lustro RELEASE w kernelu): punkt odłożenia + obrót × miejsce k.
          swarmPackSlotOffset(cls.pack.nx, cls.pack.ny, k, _so);
          const wx = field(o, SWARM_TASK.DROP, 0) + Math.cos(yaw) * _so.a - Math.sin(yaw) * _so.b;
          const wy = field(o, SWARM_TASK.DROP, 1) + Math.sin(yaw) * _so.a + Math.cos(yaw) * _so.b;
          const cell = cellAt(col, wx, wy);
          if (cell < 0) { stats.cellErrors++; continue; }
          if (cellH[col][cell] !== L || cellU[col][L * c.cells + cell] >= 0) stats.levelErrors++;
          cellU[col][L * c.cells + cell] = u;
          cellH[col][cell] = L + 1;
          pos.set(u, { col, level: L, cell });
          stats.moved++;
        }
        count[col] += s.carried.length;
        s.carried = [];
        s.phase = P.ASC_DROP;
        stats.ops++;
        break;
      }
      case P.ASC_DROP:
        if (moveTo(s, s.x, s.y, field(o, SWARM_TASK.ALT, 1), vv, dt)) {
          unlock();
          s.pending = field(o, SWARM_TASK.IDS, 3) | 0;
          s.serial++;
          s.phase = hasTask(i, s.serial) ? P.TO_PICK : P.RETURN;
        }
        break;
      case P.RETURN:
        if (hasTask(i, s.serial)) { s.phase = P.TO_PICK; break; }
        if (moveTo(s, s.pad.x, s.pad.y, s.padEntry, v, dt)) s.phase = P.LAND;
        break;
      case P.LAND:
        if (moveTo(s, s.pad.x, s.pad.y, s.pad.zBase, vv, dt)) s.phase = P.PARKED;
        break;
      default:
        break;
    }
    const so = i * 4;
    status[so] = s.phase;
    status[so + 1] = s.serial;
    status[so + 2] = s.carried.length ? s.carried.length : -1;
    status[so + 3] = s.wait;
  }

  function step(dt) {
    for (let i = 0; i < n; i++) stepDrone(i, dt);
    stats.time += dt;
    // Niezmiennik: w torze pionowym jednej kolumny najwyżej jeden dron.
    const seen = new Map();
    for (let i = 0; i < n; i++) {
      const s = st[i];
      let col = -1;
      const o = rec(i, s.serial);
      if (s.phase >= P.DESC_PICK && s.phase <= P.ASC_PICK) col = field(o, SWARM_TASK.IDS, 2) | 0;
      if (s.phase >= P.DESC_DROP && s.phase <= P.ASC_DROP) col = field(o, SWARM_TASK.IDS, 3) | 0;
      if (col < 0) continue;
      stats.inColumn++;
      if (seen.has(col)) stats.overlapErrors++;
      seen.set(col, i);
    }
  }

  function check() {
    const parked = st.filter((s) => s.phase === P.PARKED).length;
    return { ...stats, parked, counts: count, positions: pos };
  }

  return { status, writeTask, step, stats, check, drones: st };
}
