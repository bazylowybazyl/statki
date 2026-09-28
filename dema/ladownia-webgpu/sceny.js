// ============================================================
// Sceny dema ładowni. Każda scena to czysta funkcja czasu sceny t (setTime daje każdą
// klatkę od razu — zrzuty i przewijanie): postęp wrót z cargoBayDoorProgress, przeładunek
// z bayTransferState (cargoBayOps.js — bez stanu), kontenery jako widok liczby.
//   galeria     — wszystkie kadłuby z otwartymi ładowniami, ładunek różnych rodzin;
//   otwieranie  — pętla: zamknięte → wrota „à la Venator” → lampy falą → zamknięcie;
//   zaladunek   — drony stacji przenoszą moduły z placu do ładowni, potem wrota się zamykają;
//   rozladunek  — odwrotnie.
// ============================================================
import {
  CARGO_BAY_HULLS, CARGO_CONTAINER, cargoBayDoorProgress, cargoBayDoorTimeline, cargoBaySlots, cargoBayWorldYaw,
  cargoHullBays, cargoModuleContainer, cargoShipToWorld
} from '../../src/data/cargoBays.js';
import {
  BAY_CARRIED, BAY_CARRIED_STRIDE, BAY_DRONE, BAY_DRONE_STRIDE, BAY_MODE, bayHash01, bayOrderCellsNear,
  bayTransferState, bayWorldSlots, createBayTransferState, planBayTransfer
} from '../../src/game/cargoBayOps.js';
import { CargoBayRig } from '../../src/3d/cargo/bay.tsl.js';
import { containerLookLinear } from '../../src/3d/cargo/containers.tsl.js';
import { pushBeacon, pushDroneLights } from '../../src/3d/cargo/drones.tsl.js';
import { createHullShip } from './kadlub.js';
import { createStation } from './stacja.js';

// Ładunki (surowce gry) — rodziny kontenerów z src/data/cargoContainers.js.
export const CARGO_MIXES = Object.freeze({
  mieszany: ['copper_ore', 'helium3', 'chips', 'iron_ore', 'steel', 'ammo_kinetic', 'ice', 'coolant', 'avionics'],
  ruda_miedzi: ['copper_ore'],
  lod_i_gazy: ['ice', 'helium3', 'hydrogen', 'methane'],
  przemysl: ['steel', 'copper_wire', 'titan_alloy', 'polymer'],
  elektronika: ['chips', 'avionics', 'optic_lens'],
  amunicja: ['ammo_kinetic', 'missile_round', 'flak_shell', 'fuel_rods']
});

// Galeria: rzędy (kolejność = rozmiar i rodzina).
const GALLERY_ROWS = [
  ['atlas', 'terran_supercapital', 'terran_carrier'],
  ['heavy_freighter', 'megafreighter_wagon'],
  ['terran_battleship', 'pirate_battleship', 'long_haul_freighter', 'pirate_destroyer', 'container_ship', 'terran_destroyer', 'terran_frigate', 'pirate_frigate', 'inter_station_shuttle']
];
const GALLERY_FILL = {
  atlas: 0.72, terran_supercapital: 0.6, terran_carrier: 0.8, heavy_freighter: 0.45, megafreighter_wagon: 0.3,
  terran_battleship: 0.7, pirate_battleship: 0.6, long_haul_freighter: 0.75, pirate_destroyer: 0.62, container_ship: 0.8,
  terran_destroyer: 0.7, terran_frigate: 0.7, pirate_frigate: 1, inter_station_shuttle: 1
};
const GALLERY_MIX = {
  atlas: 'mieszany', terran_supercapital: 'amunicja', terran_carrier: 'elektronika', heavy_freighter: 'ruda_miedzi',
  megafreighter_wagon: 'przemysl', terran_battleship: 'amunicja', pirate_battleship: 'mieszany', long_haul_freighter: 'lod_i_gazy',
  pirate_destroyer: 'mieszany', container_ship: 'mieszany', terran_destroyer: 'elektronika', terran_frigate: 'mieszany',
  pirate_frigate: 'amunicja', inter_station_shuttle: 'elektronika'
};

const _w = {};
const _p = {};

/** Surowiec modułu: z mieszanki po haszu (moduł = jeden ładunek). */
function moduleResource(mix, seed, j) {
  const list = CARGO_MIXES[mix] || CARGO_MIXES.mieszany;
  return list[Math.floor(bayHash01(seed, j, 19) * list.length) % list.length];
}

/**
 * Wspólne zasoby sceny: statki (kadłub + ładownie), kontenery, drony, światła, cienie.
 * ctx: { scene, pools: { containers, drones, lights, shadows }, textures: Map(id → tex) }.
 */
class SceneBase {
  constructor(ctx) {
    this.ctx = ctx;
    this.ships = [];
    this.nextBay = 0;
    this.corners = [{}, {}, {}, {}];
    this.looks = new Map();
  }

  addShip(id, x, y, angle = 0) {
    const hull = CARGO_BAY_HULLS[id];
    const ship = createHullShip(hull, this.ctx.textures.get(id));
    ship.place(x, y, angle);
    ship.rigs = cargoHullBays(hull).map((geo) => new CargoBayRig({
      shipGroup: ship.group, geo, spriteTex: this.ctx.textures.get(id),
      spriteSize: { w: ship.width, h: ship.height }, tableIndex: this.nextBay++, seed: this.nextBay * 3 + 1
    }));
    ship.id = id;
    this.ctx.scene.add(ship.group);
    this.ships.push(ship);
    return ship;
  }

  /** Wrota wszystkich ładowni statku dla postępu (albo funkcji geo → postęp). */
  doors(ship, progressOf, time) {
    const P = this.ctx.pools;
    for (const rig of ship.rigs) {
      const p = typeof progressOf === 'function' ? progressOf(rig.geo) : progressOf;
      const pose = rig.update(p, ship.pose);
      if (pose.warn) {
        rig.corners(ship.pose, this.corners);
        for (let i = 0; i < 4; i++) pushBeacon(P.lights, this.corners[i].x, this.corners[i].y, 1.6, Math.max(1.2, rig.geo.halfB * 0.05), time, i * 0.25 + rig.tableIndex * 0.13, 1);
      }
      // Cień skrzydeł „over” uniesionych nad poszycie.
      if (rig.geo.door === 'over') {
        const yaw = cargoBayWorldYaw(ship.pose);
        for (let k = 0; k < rig.leaves.length; k++) {
          const q = pose.leaves[k];
          if (q.z0 <= 0.02) continue;
          const L = rig.leaves[k].def;
          rig.leafWorld(k, ship.pose, _w);
          P.shadows.pushHull(_w.x, _w.y, yaw, L.a1 - L.a0, Math.abs(L.b1 - L.b0), q.z0, q.z1, 0.75);
        }
      }
    }
  }

  /**
   * Wygląd kontenerów modułu (liniowe kolory z containerLook) — liczony raz na moduł
   * sceny (klucz: surowiec, ziarno), klatka tylko kopiuje liczby.
   */
  moduleLooks(resource, seed, count) {
    const key = `${resource}|${seed}|${count}`;
    let arr = this.looks.get(key);
    if (!arr) {
      arr = [];
      for (let k = 0; k < count; k++) arr.push(containerLookLinear(resource, seed, k));
      this.looks.set(key, arr);
    }
    return arr;
  }

  /** Moduł (n pierwszych kontenerów modułu) w slocie ładowni; looks — moduleLooks. */
  pushModuleInBay(rig, slot, n, looks) {
    const P = this.ctx.pools;
    const g = rig.geo;
    const C = CARGO_CONTAINER;
    const w = rig.world;
    const c = Math.cos(w.yaw);
    const s = Math.sin(w.yaw);
    for (let k = 0; k < n; k++) {
      cargoModuleContainer(g.module, k, _p);
      const la = slot.a + _p.a;
      const lb = slot.b + _p.b;
      P.containers.push(w.x + c * la - s * lb, w.y + s * la + c * lb, -g.depth + _p.z, w.yaw, C.L, C.W, C.H, rig.tableIndex, looks[k]);
    }
    P.shadows.pushContact(w.x + c * slot.a - s * slot.b, w.y + s * slot.a + c * slot.b, -g.depth, w.yaw, g.module.L, g.module.W, 1.8, 0.6);
  }

  /** Moduł w dowolnej pozie świata (niesiony, na placu). */
  pushModuleAt(mod, x, y, z, yaw, n, looks, bay) {
    const P = this.ctx.pools;
    const C = CARGO_CONTAINER;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let k = 0; k < n; k++) {
      cargoModuleContainer(mod, k, _p);
      P.containers.push(x + c * _p.a - s * _p.b, y + s * _p.a + c * _p.b, z + _p.z, yaw, C.L, C.W, C.H, bay, looks[k]);
    }
  }

  /** Kadr ładowni kadłuba id (scena 3D): pierwsza ładownia z pasami skrzydeł; kilka — cały kadłub. */
  bayFocus(id) {
    const ship = this.ships.find((s) => s.id === id) || this.ships[0];
    const g = ship.rigs[0].geo;
    const multi = ship.rigs.length > 1;
    const c = cargoShipToWorld(ship.pose, multi ? 0 : g.cx, multi ? 0 : g.cy, {});
    if (multi) return { x: c.x, y: c.y, w: ship.width * 0.95, h: ship.height * 1.15 };
    return { x: c.x, y: c.y, w: Math.max(g.halfA * 2 * 1.55, ship.width * 0.28), h: Math.max((g.halfB + g.parking) * 2 * 1.5, ship.height * 0.5) };
  }

  dispose() {
    for (const ship of this.ships) {
      for (const rig of ship.rigs) rig.dispose();
      ship.group.removeFromParent();
      ship.mesh.geometry.dispose();
      ship.material.dispose();
    }
    this.ships.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Galeria
// ---------------------------------------------------------------------------

export class GalleryScene extends SceneBase {
  constructor(ctx) {
    super(ctx);
    this.name = 'galeria';
    this.manual = null;
    this.anchors = {};
    const gap = 260;
    let y = 0;
    for (const row of GALLERY_ROWS) {
      const sizes = row.map((id) => {
        const H = CARGO_BAY_HULLS[id];
        const s = H.renderLength / Math.max(H.png.w, H.png.h);
        return { id, w: H.png.w * s, h: H.png.h * s };
      });
      const rowH = Math.max(...sizes.map((z) => z.h));
      const total = sizes.reduce((a, z) => a + z.w, 0) + gap * (sizes.length - 1);
      let x = -total / 2;
      for (const z of sizes) {
        const cx = x + z.w / 2;
        const ship = this.addShip(z.id, cx, y + rowH / 2);
        this.anchors[z.id] = { x: cx, y: y + rowH / 2, w: z.w, h: z.h, ship };
        x += z.w + gap;
      }
      y += rowH + gap;
    }
    this.extent = y;
    // Ładunek galerii raz (widok liczby: wypełnienie × pojemność, moduł = jeden surowiec).
    for (const ship of this.ships) {
      const fill = GALLERY_FILL[ship.id] ?? 0.6;
      const mix = GALLERY_MIX[ship.id] || 'mieszany';
      for (const rig of ship.rigs) {
        const slots = cargoBaySlots(rig.geo);
        let left = Math.round(slots.length * rig.geo.module.count * fill);
        rig.cargo = [];
        for (let i = 0; i < slots.length && left > 0; i++) {
          const n = Math.min(rig.geo.module.count, left);
          rig.cargo.push({ slot: slots[i], n, looks: this.moduleLooks(moduleResource(mix, rig.tableIndex, i), rig.tableIndex * 1000 + i, rig.geo.module.count) });
          left -= n;
        }
      }
    }
  }

  /** Postęp wrót: domyślnie otwarte; O zamyka / otwiera wszystkie naraz (manual). */
  progressAt(geo, t) {
    const T = cargoBayDoorTimeline(geo).total;
    const m = this.manual;
    if (!m) return T;
    const p = m.fromFrac * T + (m.dir > 0 ? 1 : -1) * Math.max(0, t - m.at);
    return Math.max(0, Math.min(T, p));
  }

  toggle(t) {
    const geo = this.ships[0].rigs[0].geo;
    const frac = this.progressAt(geo, t) / cargoBayDoorTimeline(geo).total;
    const dir = this.manual ? -this.manual.dir : -1;
    this.manual = { dir, at: t, fromFrac: frac };
    return dir > 0 ? 'otwieranie' : 'zamykanie';
  }

  update(t) {
    const P = this.ctx.pools;
    for (const ship of this.ships) {
      this.doors(ship, (geo) => this.progressAt(geo, t), t);
      for (const rig of ship.rigs) {
        for (const m of rig.cargo) this.pushModuleInBay(rig, m.slot, m.n, m.looks);
      }
    }
    return { containers: P.containers.count, drones: 0 };
  }

  /** Kadr kadłuba w układzie sceny 3D: środek i obszar do zmieszczenia (w × h). */
  frameOf(id) {
    const a = this.anchors[id];
    if (!a) return null;
    return { x: a.x, y: -a.y, w: a.w * 1.12, h: a.h * 1.25 };
  }

  /** Cała galeria. */
  frame() {
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const a of Object.values(this.anchors)) {
      x0 = Math.min(x0, a.x - a.w / 2); x1 = Math.max(x1, a.x + a.w / 2);
      y0 = Math.min(y0, -a.y - a.h / 2); y1 = Math.max(y1, -a.y + a.h / 2);
    }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: (x1 - x0) * 1.06, h: (y1 - y0) * 1.1 };
  }
}

// ---------------------------------------------------------------------------
// Otwieranie (pętla)
// ---------------------------------------------------------------------------

export class DoorScene extends SceneBase {
  constructor(ctx, hullId) {
    super(ctx);
    this.name = 'otwieranie';
    this.hullId = hullId;
    this.ship = this.addShip(hullId, 0, 0);
    const T = Math.max(...this.ship.rigs.map((r) => cargoBayDoorTimeline(r.geo).total));
    this.T = T;
    this.tOpen = 1.2;
    this.tClose = this.tOpen + T + 6.0;
    this.period = this.tClose + T + 2.0;
    this.manual = null;
    // Ładownia wypełniona w ~58% (widać dno ze znakami slotów i ładunek).
    for (const rig of this.ship.rigs) {
      const slots = cargoBaySlots(rig.geo);
      const n = Math.ceil(slots.length * 0.58);
      rig.cargo = [];
      for (let i = 0; i < n; i++) {
        rig.cargo.push({ slot: slots[i], n: rig.geo.module.count, looks: this.moduleLooks(moduleResource('mieszany', rig.tableIndex + 7, i), rig.tableIndex * 1000 + i, rig.geo.module.count) });
      }
    }
  }

  /** Postęp wrót w chwili t (pętla albo ręcznie: manual = { dir, at, from }). */
  progressAt(geo, t) {
    const T = cargoBayDoorTimeline(geo).total;
    if (this.manual) {
      const m = this.manual;
      const p = m.from + (m.dir > 0 ? 1 : -1) * Math.max(0, t - m.at);
      return Math.max(0, Math.min(T, p));
    }
    const tl = t % this.period;
    return cargoBayDoorProgress(geo, tl, this.tOpen, this.tClose);
  }

  toggle(t) {
    const geo = this.ship.rigs[0].geo;
    const cur = this.progressAt(geo, t);
    const T = cargoBayDoorTimeline(geo).total;
    const dir = this.manual ? -this.manual.dir : (cur > T * 0.5 ? -1 : 1);
    this.manual = { dir, at: t, from: cur };
    return dir > 0 ? 'otwieranie' : 'zamykanie';
  }

  update(t) {
    const P = this.ctx.pools;
    const ship = this.ship;
    this.doors(ship, (geo) => this.progressAt(geo, t), t);
    for (const rig of ship.rigs) {
      for (const m of rig.cargo) this.pushModuleInBay(rig, m.slot, m.n, m.looks);
    }
    const p = this.progressAt(ship.rigs[0].geo, t);
    return { containers: P.containers.count, drones: 0, door: p / cargoBayDoorTimeline(ship.rigs[0].geo).total };
  }

  /** Kadr: ładownia z pasami parkowania i kawałkiem kadłuba (twin — cały kadłub). */
  frame() {
    const g = this.ship.rigs[0].geo;
    if (this.ship.rigs.length > 1) return { x: 0, y: 0, w: this.ship.width * 1.05, h: this.ship.height * 1.15 };
    return { x: g.cx, y: g.cy, w: Math.max(g.halfA * 2 * 1.45, this.ship.width * 0.3), h: Math.max((g.halfB + g.parking) * 2 * 1.6, g.halfB * 5) };
  }
}

// ---------------------------------------------------------------------------
// Załadunek / rozładunek (drony stacji)
// ---------------------------------------------------------------------------

export class TransferScene extends SceneBase {
  constructor(ctx, hullId, mode, opts = {}) {
    super(ctx);
    this.mode = mode;
    this.name = mode === BAY_MODE.LOAD ? 'zaladunek' : 'rozladunek';
    this.hullId = hullId;
    this.mix = opts.mix || 'mieszany';
    this.ship = this.addShip(hullId, 0, 0);
    // Sloty wszystkich ładowni statku (kolejność: ładownia po ładowni).
    const slots = [];
    const rigOfSlot = [];
    for (const rig of this.ship.rigs) {
      for (const s of bayWorldSlots(rig.geo, this.ship.pose, rig.tableIndex)) { slots.push(s); rigOfSlot.push(rig); }
    }
    const geo0 = this.ship.rigs[0].geo;
    const unit = { L: geo0.module.L, W: geo0.module.W, H: geo0.module.H };
    this.unit = unit;
    this.mod = geo0.module;
    const maxCount = Math.max(1, Math.min(slots.length, opts.count || 48));
    // Plac stacji pod statkiem (−y sceny = +y gry), dłuższy bok wzdłuż statku.
    const cols = Math.max(2, Math.min(14, Math.ceil(Math.sqrt(maxCount * 2.2))));
    const rows = Math.max(1, Math.ceil(maxCount / cols));
    // Górna krawędź platformy ~80 j. pod burtą (kadłub = obwiednia sprite'a).
    const shipHalf = this.ship.height / 2;
    const nestCount = Math.max(2, Math.min(8, opts.drones || Math.ceil(maxCount / 6)));
    this.station = createStation({ x: geo0.cx + this.ship.pose.x, top: -(shipHalf + 80), unit, cols, rows, nestCount });
    ctx.scene.add(this.station.group);
    const cells = bayOrderCellsNear(this.station.cells, geo0.cx, geo0.cy);
    this.count = Math.min(maxCount, cells.length);
    this.rigOfSlot = rigOfSlot;
    this.localSlots = slots.map((s, j) => cargoBaySlots(rigOfSlot[j].geo).find((l) => l.index === s.slot));
    const T = Math.max(...this.ship.rigs.map((r) => cargoBayDoorTimeline(r.geo).total));
    this.T = T;
    this.tOpen = 1.0;
    // Przelot nad stosami skrzydeł wrót „over” (+ zapas).
    const doorTop = Math.max(...this.ship.rigs.map((r) => (r.geo.door === 'over' ? r.geo.leafT * (r.geo.leafCount + 1) + 1 : 1)));
    this.plan = planBayTransfer({
      seed: 11, mode, unit, slots, cells, count: this.count, nests: this.station.nests, drones: nestCount,
      start: this.tOpen + T + 0.4, obstacleTop: doorTop
    });
    this.tClose = Math.max(this.plan.bayClearAt, this.tOpen + T) + 1.2;
    this.period = Math.max(this.plan.end, this.tClose + T) + 4.0;
    this.state = createBayTransferState(this.plan);
    this.activeNests = new Uint8Array(this.station.nests.length);
    // Wygląd modułu j (ładunek kursu) raz na scenę.
    this.jobLooks = [];
    for (let j = 0; j < this.plan.N; j++) this.jobLooks.push(this.moduleLooks(moduleResource(this.mix, 5, j), 700 + j, this.mod.count));
  }

  dispose() {
    this.station.group.removeFromParent();
    super.dispose();
  }

  update(t) {
    const P = this.ctx.pools;
    const ship = this.ship;
    const tl = t % this.period;
    this.doors(ship, (geo) => cargoBayDoorProgress(geo, tl, this.tOpen, this.tClose), tl);
    const st = bayTransferState(this.plan, tl, this.state);
    const plan = this.plan;
    const mod = this.mod;
    // Moduły w ładowni.
    for (let j = 0; j < plan.N; j++) {
      if (!st.slotHas[j]) continue;
      this.pushModuleInBay(this.rigOfSlot[j], this.localSlots[j], mod.count, this.jobLooks[j]);
    }
    // Na placu.
    for (let c = 0; c < plan.cells.length; c++) {
      if (!st.cellHas[c]) continue;
      const cell = plan.cells[c];
      const j = plan.cellJob[c];
      this.pushModuleAt(mod, cell.x, cell.y, cell.z, cell.yaw, mod.count, this.jobLooks[j], -1);
      P.shadows.pushContact(cell.x, cell.y, cell.z, cell.yaw, mod.L, mod.W, 2.2, 0.5);
    }
    // Niesione.
    for (let k = 0; k < st.carriedCount; k++) {
      const o = k * BAY_CARRIED_STRIDE;
      const C = st.carried;
      const j = C[o + BAY_CARRIED.JOB];
      const x = C[o + BAY_CARRIED.X];
      const y = C[o + BAY_CARRIED.Y];
      const z = C[o + BAY_CARRIED.Z];
      const yaw = C[o + BAY_CARRIED.YAW];
      this.pushModuleAt(mod, x, y, z, yaw, mod.count, this.jobLooks[j], C[o + BAY_CARRIED.BAY]);
      P.shadows.pushHull(x, y, yaw, mod.L, mod.W, z, z + mod.H, 0.5);
    }
    // Drony.
    this.activeNests.fill(0);
    const D = st.drones;
    const L = mod.L + 0.6;
    const W = mod.W + 0.6;
    const H = plan.droneH;
    const dl = { x: 0, y: 0, z: 0, yaw: 0, L, W, H, seed: 0, thrust: 0, ax: 0, ay: 0, az: 0 };
    for (let k = 0; k < st.droneCount; k++) {
      const o = k * BAY_DRONE_STRIDE;
      const clip = D[o + BAY_DRONE.CLIP];
      dl.x = D[o + BAY_DRONE.X]; dl.y = D[o + BAY_DRONE.Y]; dl.z = D[o + BAY_DRONE.Z]; dl.yaw = D[o + BAY_DRONE.YAW];
      dl.seed = D[o + BAY_DRONE.SEED]; dl.thrust = D[o + BAY_DRONE.THRUST];
      dl.ax = D[o + BAY_DRONE.AX]; dl.ay = D[o + BAY_DRONE.AY]; dl.az = D[o + BAY_DRONE.AZ];
      P.drones.push(dl.x, dl.y, dl.z, dl.yaw, L, W, H, clip, D[o + BAY_DRONE.BAY], dl.seed, dl.thrust);
      if (dl.z + 0.5 * H > clip) pushDroneLights(P.lights, dl, t, 1);
      if (dl.z > 0.3) P.shadows.pushHull(dl.x, dl.y, dl.yaw, L * 1.25, W * 1.25, dl.z, dl.z + H, 0.42);
      const idx = D[o + BAY_DRONE.INDEX] | 0;
      if (idx < this.activeNests.length) this.activeNests[idx % this.activeNests.length] = 1;
    }
    this.station.pushLights(P.lights, t, this.activeNests);
    return {
      containers: P.containers.count, drones: st.droneCount, inBay: st.inBay, onYard: st.onYard,
      carried: st.carriedCount, N: plan.N, D: plan.D, phase: tl, period: this.period,
      transfer: [plan.start, plan.end], door: [this.tOpen, this.tClose]
    };
  }

  /** Kadr: ładownia(-e) i platforma stacji w układzie sceny 3D. */
  frame() {
    const g = this.ship.rigs[0].geo;
    const multi = this.ship.rigs.length > 1;
    const topY = multi ? this.ship.height / 2 : g.cy + g.halfB + g.parking + 10;
    const botY = this.station.group.position.y - this.station.size.Ly / 2;
    const w = Math.max(multi ? this.ship.width : g.halfA * 2, this.station.size.Lx) * 1.15;
    return { x: multi ? 0 : g.cx, y: (topY + botY) / 2, w, h: (topY - botY) * 1.18 };
  }
}
