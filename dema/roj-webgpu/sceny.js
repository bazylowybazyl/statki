// ============================================================
// Sceny dema roju (dema/roj-webgpu.html):
//   GalleryScene — drony S / M / L / Capital przy swoich chwytach (1 / 2 / 4 / 8 kontenerów
//                  standardowych płasko), cykl chwytu w kółko (zawis → zejście, ramiona się
//                  rozkładają i wysuwają → zacisk → podniesienie → odłożenie); stan pisze CPU wprost
//                  do bufora symulacji (bez kroków compute);
//   SwarmScene   — scenariusz portu (src/game/swarm/swarmScenarios.js): statki z otwartymi
//                  ładowniami, platforma, rój na GPU (swarmSim.js) i wieża — planista (CPU).
// ============================================================
import * as THREE from 'three/webgpu';
import { CARGO_BAY_HULLS, cargoBayDoorTimeline, cargoHullBays, cargoShipToWorld } from '../../src/data/cargoBays.js';
import { SWARM_DRONE_CLASS_LIST, swarmDroneClass, swarmPackSlotOffset } from '../../src/data/swarmDrones.js';
import {
  SWARM_DRONE, SWARM_DRONE_VEC4, SWARM_PHASE, SWARM_STATUS_CODE, SWARM_UNIT_VEC4, buildSwarmHeightfield,
  buildSwarmPort, swarmColumnCounts, swarmHash01, swarmUnitRestPose
} from '../../src/game/swarm/swarmPort.js';
import { buildSwarmScenario } from '../../src/game/swarm/swarmScenarios.js';
import { createSwarmPlanner } from '../../src/game/swarm/swarmPlanner.js';
import { CargoBayRig } from '../../src/3d/cargo/bay.tsl.js';
import { CargoBayTable } from '../../src/3d/cargo/cargoLight.tsl.js';
import { pushBeacon } from '../../src/3d/cargo/drones.tsl.js';
import { createHullShip } from '../ladownia-webgpu/kadlub.js';
import { createPlatform } from './platforma.js';

const DV = SWARM_DRONE_VEC4;
const DR = SWARM_DRONE;
const UV = SWARM_UNIT_VEC4;

/** Zakresy klas w buforze dronów (drony klasami po kolei). */
function classRanges(list) {
  const out = [];
  let k = 0;
  while (k < list.length) {
    const ci = list[k].classIndex;
    let n = 0;
    while (k + n < list.length && list[k + n].classIndex === ci) n++;
    out.push({ classIndex: ci, base: k, count: n });
    k += n;
  }
  return out;
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ---------------------------------------------------------------------------
// Galeria
// ---------------------------------------------------------------------------

export class GalleryScene {
  constructor(ctx) {
    this.ctx = ctx;
    this.name = 'galeria';
    const { sim } = ctx;
    // Kolejno S, M, L, Capital — odstępy rosną z klasą.
    this.items = [];
    let x = 0;
    for (const cls of SWARM_DRONE_CLASS_LIST) {
      const w = cls.payload.L;
      const cx = x + w / 2;
      this.items.push({ cls, x: cx, y: 0, phase: this.items.length * 1.3 });
      x += w + Math.max(26, cls.payload.L * 0.9);
    }
    const shift = x / 2;
    for (const it of this.items) it.x -= shift;
    // Platforma z gniazdami pod chwytami (pokład w z = 0).
    const spec = { ships: [], yards: [], pads: this.items.map((it, i) => ({ id: `g${i}`, classId: it.cls.id, x: it.x, y: 0, cols: 1, rows: 1 })), obstacles: [] };
    this.port = buildSwarmPort(spec);
    this.platform = createPlatform(this.port);
    ctx.scene.add(this.platform.group);
    // Bufory: drony i kontenery ich chwytów (kontenery drona i po kolei, miejsca k = 0 … n − 1).
    const drones = this.items.map((it, i) => ({ classIndex: it.cls.index, x: it.x, y: it.y, z: 30, entryZ: 30, seed: i * 0.37 + 0.11 }));
    const units = [];
    const looks = [];
    const res = ['chips', 'helium3', 'copper_ore', 'steel'];
    this.items.forEach((it, i) => {
      it.unit0 = units.length;
      it.n = it.cls.pack.nx * it.cls.pack.ny;
      for (let k = 0; k < it.n; k++) {
        units.push({ x: it.x, y: it.y, z: 0, yaw: 0, bay: -1 });
        looks.push({ resource: res[(i + (k >> 1)) % res.length], seed: 40 + i * 8 + k });
      }
    });
    this.unitCount = units.length;
    sim.init({ drones, units, heights: new Int32Array(1), hf: null, layers: null });
    this.ranges = classRanges(drones);
    ctx.render.drones.setRanges(this.ranges);
    ctx.render.lights.setRanges(this.ranges);
    ctx.render.units.build(looks);
    ctx.render.shadows.setCounts(drones.length, units.length);
    this.period = 9.5;
    this.info = {};
  }

  /** Pozycja drona w cyklu chwytu (CPU — lustro faz roju). */
  pose(it, t) {
    const cls = it.cls;
    const H = cls.payload.H;
    const hover = H + 4 + cls.body.H * 2.2;
    const lift = H + 3 + cls.body.H * 1.4;
    const p = ((t + it.phase) % this.period + this.period) % this.period;
    const top = H; // wierzch kontenera na pokładzie
    let z = hover; let e = 0; let g = 0; let carry = false; let code = SWARM_STATUS_CODE.EMPTY; let thrust = 0.15;
    if (p < 1.4) { z = hover; e = 0; code = SWARM_STATUS_CODE.EMPTY; }
    else if (p < 3.0) { const k = smooth((p - 1.4) / 1.6); z = hover + (top - hover) * k; e = smooth((p - 1.6) / 1.2); code = SWARM_STATUS_CODE.DOCKING; thrust = 0.45; }
    else if (p < 3.6) { z = top; e = 1; g = smooth((p - 3.0) / 0.55); code = SWARM_STATUS_CODE.GRIP; }
    else if (p < 5.0) { const k = smooth((p - 3.6) / 1.4); z = top + (top + lift - top) * k; e = 1; g = 1; carry = true; code = SWARM_STATUS_CODE.LOADED; thrust = 0.8; }
    else if (p < 6.6) { z = top + lift + Math.sin((p - 5) * 2.2) * 0.4; e = 1; g = 1; carry = true; code = SWARM_STATUS_CODE.LOADED; thrust = 0.35; }
    else if (p < 8.0) { const k = smooth((p - 6.6) / 1.4); z = top + lift + (top - (top + lift)) * k; e = 1; g = 1; carry = true; code = SWARM_STATUS_CODE.DOCKING; thrust = 0.6; }
    else if (p < 8.45) { z = top; e = 1; g = 1 - smooth((p - 8.0) / 0.45); code = SWARM_STATUS_CODE.GRIP; }
    else { const k = smooth((p - 8.45) / 1.05); z = top + (hover - top) * k; e = 1 - smooth((p - 8.5) / 0.9); code = SWARM_STATUS_CODE.EMPTY; thrust = 0.5; }
    const yaw = Math.sin((t + it.phase) * 0.3) * 0.12;
    return { z, e, g, carry, code, thrust, yaw };
  }

  update(t) {
    const { sim } = this.ctx;
    const D = sim.drones.value.array;
    const U = sim.units.value.array;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const q = this.pose(it, t);
      const o = i * DV * 4;
      const set = (k, a, b, c, d) => { const r = o + k * 4; D[r] = a; D[r + 1] = b; D[r + 2] = c; D[r + 3] = d; };
      set(DR.POSE, it.x, it.y, q.z, q.yaw);
      set(DR.LOOK, q.e, q.g, q.thrust, q.code);
      set(DR.MOTION, Math.sin(t * 1.7 + i) * 30, 0, 0, 0);
      set(DR.INFO, it.cls.index, i * 0.37 + 0.11, -1, 1);
      set(DR.AUX, q.carry ? it.n : -1, -1, 0, -1);
      // Kontenery chwytu: na pokładzie albo pod hakiem (hak + obrót × miejsce k w chwycie).
      const c = Math.cos(q.yaw);
      const sn = Math.sin(q.yaw);
      for (let k = 0; k < it.n; k++) {
        swarmPackSlotOffset(it.cls.pack.nx, it.cls.pack.ny, k, _off);
        const u = (it.unit0 + k) * UV * 4;
        if (q.carry) {
          U[u] = it.x + c * _off.a - sn * _off.b; U[u + 1] = it.y + sn * _off.a + c * _off.b; U[u + 2] = q.z - it.cls.payload.H; U[u + 3] = q.yaw; U[u + 6] = i;
        } else {
          U[u] = it.x + _off.a; U[u + 1] = it.y + _off.b; U[u + 2] = 0; U[u + 3] = 0; U[u + 6] = -1;
        }
        U[u + 4] = -1; U[u + 5] = 1; U[u + 7] = k;
      }
    }
    sim.drones.value.addUpdateRange(0, this.items.length * DV * 4);
    sim.drones.value.needsUpdate = true;
    sim.units.value.addUpdateRange(0, this.unitCount * UV * 4);
    sim.units.value.needsUpdate = true;
    this.platform.pushLights(this.ctx.cargoLights, t);
    this.info = { drones: this.items.length, phase: ((t % this.period) + this.period) % this.period };
    return this.info;
  }

  /** Etykiety klas (HTML nad dronami): [{ x, y, z, text }]. */
  labels() {
    return this.items.map((it) => ({
      x: it.x, y: it.y - it.cls.payload.W * 0.5 - 6, z: 0,
      title: `${it.cls.label} · ${fmtCount(it.cls.pack.nx * it.cls.pack.ny)} ${it.cls.pack.nx} × ${it.cls.pack.ny} (${fmtDim(it.cls.payload)})`,
      text: `${fmtArms(it.cls.armCount, it.cls.tele)} · ${it.cls.engineCount} silniki jonowe · ${Math.round(it.cls.flight.vMax)} j/s`
    }));
  }

  frame() {
    const a = this.items[0];
    const b = this.items[this.items.length - 1];
    const x0 = a.x - a.cls.payload.L;
    const x1 = b.x + b.cls.payload.L;
    return { x: (x0 + x1) / 2, y: 0, w: (x1 - x0) * 1.1, h: (x1 - x0) * 0.42 };
  }

  focusItem(k) {
    const it = this.items[Math.max(0, Math.min(this.items.length - 1, k))];
    const s = Math.max(it.cls.payload.L, 24);
    return { x: it.x, y: 0, w: s * 2.6, h: s * 1.6 };
  }

  dispose() { this.platform.dispose(); }
}

const fmtDim = (p) => `${+p.L.toFixed(2)} × ${+p.W.toFixed(2)} j.`;
const fmtCount = (n) => (n === 1 ? '1 kontener' : n < 5 ? `${n} kontenery` : `${n} kontenerów`);
// Liczebnik: 2–4 (poza 12–14) — „ramiona wysuwane”, reszta — „ramion wysuwanych”.
const fmtArms = (n, tele) => {
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  return `${n} ${few ? 'ramiona' : 'ramion'}${tele ? (few ? ' wysuwane' : ' wysuwanych') : ''}`;
};
const _off = { a: 0, b: 0 };

// ---------------------------------------------------------------------------
// Rój w porcie
// ---------------------------------------------------------------------------

export class SwarmScene {
  /** ctx: { scene, renderer, sim, render, textures, masks, cargoLights }; opts: { mode, count } */
  constructor(ctx, scenarioId, opts = {}) {
    this.ctx = ctx;
    this.name = scenarioId;
    this.mode = opts.mode || 'smart';
    const bayIndex = new Map();
    let nextBay = 0;
    const bayIndexOf = (shipId, bi) => {
      const key = `${shipId}:${bi}`;
      if (!bayIndex.has(key)) bayIndex.set(key, nextBay++);
      return bayIndex.get(key);
    };
    const sc = buildSwarmScenario(scenarioId, { bayIndexOf, count: opts.count });
    this.sc = sc;
    this.port = sc.port;
    const port = sc.port;
    // Statki: kwad sprite'a z dziurami ładowni + wnętrza i wrota (otwarte).
    this.ships = [];
    CargoBayTable.count = 0;
    for (const s of port.ships) {
      const hull = CARGO_BAY_HULLS[s.hull];
      const tex = ctx.textures.get(s.hull);
      const ship = createHullShip(hull, tex);
      ship.place(s.pose.x, s.pose.y, s.pose.angle);
      ship.rigs = cargoHullBays(hull).map((geo, bi) => new CargoBayRig({
        shipGroup: ship.group, geo, spriteTex: tex, spriteSize: { w: ship.width, h: ship.height },
        tableIndex: bayIndexOf(s.id, bi), seed: bi * 3 + 1
      }));
      ship.id = s.id;
      ctx.scene.add(ship.group);
      this.ships.push(ship);
    }
    this.platform = createPlatform(port);
    ctx.scene.add(this.platform.group);
    // Mapa przeszkód (maska kadłubów z alfy sprite'ów).
    const masks = ctx.masks;
    const shipMask = (s, x, y) => {
      const m = masks.get(s.hull);
      if (!m) return false;
      const H = CARGO_BAY_HULLS[s.hull];
      const sc2 = H.renderLength / Math.max(H.png.w, H.png.h);
      // Świat sceny → układ statku 3D → piksel PNG.
      const dx = x - s.center.x;
      const dy = y - s.center.y;
      const c = Math.cos(s.yaw);
      const si = Math.sin(s.yaw);
      const lx = c * dx + si * dy;
      const ly = -si * dx + c * dy;
      const px = lx / sc2 + H.png.w / 2;
      const py = -ly / sc2 + H.png.h / 2;
      const ix = Math.floor(px / H.png.w * m.w);
      const iy = Math.floor(py / H.png.h * m.h);
      if (ix < 0 || iy < 0 || ix >= m.w || iy >= m.h) return false;
      return m.a[iy * m.w + ix] > 110;
    };
    this.hf = buildSwarmHeightfield(port, { cell: 6, shipMask, maxCells: ctx.sim.hfCells });
    // Drony: gniazda klas (hak w gnieździe tak, by złożone szczęki dotykały pokładu).
    const drones = sc.drones.map((d, i) => {
      const pad = port.columns[d.pad];
      const cls = swarmDroneClass(d.classId);
      return { classIndex: cls.index, x: pad.x, y: pad.y, z: pad.zBase - cls.extents.empty.zLo + 0.3, entryZ: pad.entryZ, yaw: pad.yaw, seed: swarmHash01(i, 7, 1) };
    });
    this.droneList = drones;
    // Kontenery standardowe w komórkach kolumn (środek podstawy i kurs kolumny).
    const units = (port.units || []).map((u) => {
      const p = swarmUnitRestPose(port, u, {});
      return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, bay: port.columns[u.col].bay };
    });
    ctx.sim.init({ drones, units, heights: swarmColumnCounts(port), hf: this.hf, layers: port.layers });
    this.planner = createSwarmPlanner(port, sc.drones, { mode: this.mode });
    this.ranges = classRanges(drones);
    ctx.render.drones.setRanges(this.ranges);
    ctx.render.lights.setRanges(this.ranges);
    ctx.render.units.build(port.units || []);
    ctx.render.shadows.setCounts(drones.length, units.length);
    this.zeroStatus = new Float32Array(drones.length * 4);
    this.doneAt = null;
    this.info = {};
    this.trimHistory = [];
    this._writer = (d, s, rec) => ctx.sim.writeTask(d, s, rec);
  }

  update(t, frameDt, speed) {
    const ctx = this.ctx;
    const sim = ctx.sim;
    // Wrota otwarte (port dokuje statki z otwartymi ładowniami), rekordy ładowni do tablicy świateł.
    for (const ship of this.ships) {
      for (const rig of ship.rigs) {
        const pose = rig.update(cargoBayDoorTimeline(rig.geo).total, ship.pose);
        if (pose.warn) {
          const corners = rig.corners(ship.pose);
          for (let i = 0; i < 4; i++) pushBeacon(ctx.cargoLights, corners[i].x, corners[i].y, 1.6, 2, t, i * 0.25, 1);
        }
      }
    }
    const status = sim.statusData || this.zeroStatus;
    this.planner.update(sim.time, status, this._writer);
    const steps = sim.step(ctx.renderer, frameDt, speed, 8);
    if (steps) sim.requestReadback(ctx.renderer);
    this.platform.pushLights(ctx.cargoLights, t);
    const st = this.planner.stats;
    // Koniec: wszystko przeniesione i drony w gniazdach.
    let parked = 0;
    for (let i = 0; i < this.droneList.length; i++) if ((status[i * 4] | 0) === SWARM_PHASE.PARKED) parked++;
    if (st.done >= st.total && parked === this.droneList.length && this.doneAt === null && sim.time > 2) this.doneAt = sim.time;
    const trims = this.planner.shipTrims();
    this.info = {
      drones: this.droneList.length, parked, done: st.done, total: st.total, assigned: st.assigned,
      emptyShare: st.emptyDist + st.loadedDist > 0 ? st.emptyDist / (st.emptyDist + st.loadedDist) : 0,
      direct: st.direct, viaYard: st.viaYard, maxTrim: st.maxTrim, trims,
      simTime: sim.time, startTime: st.startTime, endTime: st.endTime, doneAt: this.doneAt,
      free: sim.stats[5], guided: sim.stats[3], waiting: sim.stats[4], near: sim.stats[2], minSep: sim.stats[0] / 1000,
      overflow: sim.stats[7], deep: sim.stats[10], minPair: sim.stats[8], minPairKind: sim.stats[9],
      collisions: sim.stats[1], minGap: sim.stats[11] < 0xffffffff ? sim.stats[11] / 100 - 100 : null, dense: sim.stats[12], orcaLines: sim.stats[13], steps, mode: this.mode
    };
    return this.info;
  }

  frame() { return this.sc.focus; }

  dispose() {
    for (const ship of this.ships) {
      for (const rig of ship.rigs) rig.dispose();
      ship.group.removeFromParent();
      ship.mesh.geometry.dispose();
      ship.material.dispose();
    }
    this.ships.length = 0;
    this.platform.dispose();
  }
}
