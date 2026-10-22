// src/3d/cargo/portCargo3D.js
//
// PRZEŁADUNEK W PORTACH — OBRAZ (E12, docs/E12-przeladunek.md): przy zadokowanym statku ruchu (bańka E6) ładownia
// otwiera się na postoju, rój dronów (model, chwyty płaskie i ramiona teleskopowe z dema roju) przenosi warstwy
// kontenerów między ładownią a stołami przy burcie, a taśmociąg wiezie je w głąb portu (portal w grzbiecie zatoki);
// luk Atlasa pokazuje ładunek gracza przy postoju i handlu. Wszystko to OBRAZ: ładunek i czas postoju liczy świat
// ruchu, gra pakuje tylko ramkę (blok migawki `cargoOps`, src/render/blocks/cargoOpsBlock.js), a ten moduł — w workerze
// renderu albo w trybie `off` na stronie — liczy resztę: plan na stanowisko (src/game/swarm/berthTransfer.js, w
// pamięci po numerze kursu), stan w chwili klatki i partie rysunków.
//
// PARTIE (jeden rysunek na rodzaj — bez rysunku na statek): ładownie (CargoBayBatch — wnętrze i wrota na kadłub),
// kontenery (CargoContainers — wszystkie: w ładowniach, w chwytach, na stołach i taśmach), drony (SwarmDroneMeshes —
// LOD na klasę, rekordy w buforze storage pisanym z CPU, regiony klas), światła dronów (SwarmDroneLights), taśmy,
// stoły i portale (PortConveyors). Proxy kadłubów dostają dziurę w otworze luku (ShipProxyBatch3D.setBayCutResolver).
//
// PRECYZJA: wszystko względem początku przy kamerze (sceneOriginNearCamera; mesh.position = początek), tablica
// ładowni (światło kontenerów i dronów) — te same współrzędne. Rekord 0 tablicy należy do luku Atlasa
// (scoutBay3D) — tu nadpisujemy tylko jego środek względem początku, gdy w luku stoi ładunek gracza.
//
// Szew: bez `window`, DOM i stanu gry — wejście to ramka bloku (`applyCargoOpsBlock`) i kamera klatki.
import * as THREE from 'three/webgpu';
import { instancedArray } from 'three/tsl';
import { Core3D as CoreRef } from '../core3d.js';
import { WARIANT_INSTANCJI } from '../rozgrzewka.js';
import { sceneOriginNearCamera } from '../sceneOrigin.js';
import { ShipProxyBatch3D } from '../shipProxyBatch3D.js';
import { CargoBayBatch } from './bayBatch.tsl.js';
import { CargoContainers, containerLookLinear } from './containers.tsl.js';
import { CONVEYOR_KIND, PortConveyors } from './conveyor.tsl.js';
import { CARGO_LIGHT, CargoBayTable, setCargoSun } from './cargoLight.tsl.js';
import { CARGO_LIGHT_VIEW } from './drones.tsl.js';
import { SWARM_LOOK, SwarmDroneLights, SwarmDroneMeshes } from '../swarm/swarmDrones.tsl.js';
import { buildSwarmDroneGeometries } from '../swarm/swarmDroneModel.js';
import { SWARM_DRONE, SWARM_DRONE_VEC4 } from '../../game/swarm/swarmPort.js';
import {
  BERTH_TRANSFER_TUNE, berthTransferDoor, berthTransferState, berthYardGeometry, planBerthTransfer, shipInBerth
} from '../../game/swarm/berthTransfer.js';
import { SWARM_DRONE_CLASS_LIST, swarmPackSlotOffset } from '../../data/swarmDrones.js';
import {
  CARGO_CONTAINER, TRAFFIC_CARGO_BAY_HULLS, cargoBayHull, cargoBaySlots, cargoHullBays, cargoModuleContainer, cargoShipToWorld
} from '../../data/cargoBays.js';

export const PORT_CARGO_TUNE = {
  /** Drony na klasę (regiony bufora storage). */
  dronesPerClass: 160,
  containers: 8192,
  /** Nowych planów na klatkę (plan ciężkiego frachtowca ~3–5 ms CPU) — reszta czeka klatkę. */
  plansPerFrame: 1,
  /** Plan bez odczytu przez tyle klatek wypada z pamięci. */
  planIdleFrames: 600,
  /** Zapas kadru [j.] przy obcinaniu stanowisk (taśma za portalem, drony nad placem). */
  cullPad: 400
};

const DV = SWARM_DRONE_VEC4;
const DR = SWARM_DRONE;
const C = CARGO_CONTAINER;
const CLASS_N = SWARM_DRONE_CLASS_LIST.length;

/** Kadłub proxy ruchu → kadłub z ładownią (CARGO_BAY_HULLS) albo null. */
export function trafficBayHull(proxyHullId) {
  return TRAFFIC_CARGO_BAY_HULLS[String(proxyHullId || '')] || null;
}

/** Prostokąt otworu (pierwsza ładownia kadłuba) w uv sprite'a — jak luk Atlasa (scoutBay3D). */
export function bayCutRect(hullKey, out = new THREE.Vector4()) {
  const H = cargoBayHull(hullKey);
  const B = H?.bays?.[0];
  if (!B) return null;
  return out.set((B.x - B.w / 2) / H.png.w + 0.5, (B.y - B.h / 2) / H.png.h + 0.5,
    (B.x + B.w / 2) / H.png.w + 0.5, (B.y + B.h / 2) / H.png.h + 0.5);
}

export function createPortCargo3D(Core3D) {
  const T = PORT_CARGO_TUNE;
  let ready = false;
  let bays = null;
  let containers = null;
  let conveyors = null;
  let droneMeshes = null;
  let droneLights = null;
  let dronesNode = null;
  const origin = { x: 0, y: 0 };
  const plans = new Map();          // numer kursu → { key, plan, seen, looks }
  const cuts = new Map();           // numer kursu → Vector4 (uv otworu) — dla proxy w tej klatce
  const cutCache = new Map();       // kadłub → Vector4
  const classCount = new Int32Array(CLASS_N);
  const ranges = SWARM_DRONE_CLASS_LIST.map((cls) => ({ classIndex: cls.index, base: cls.index * T.dronesPerClass, count: 0 }));
  const stats = { ops: 0, drawnOps: 0, drones: 0, containers: 0, yards: 0, plans: 0, planMs: 0, ms: 0, draws: 0 };
  let frameNo = 0;
  let resolverSet = false;
  const _w = { x: 0, y: 0, yaw: 0 };
  const _off = { a: 0, b: 0 };
  const _mc = {};
  const _shipLocal = { u: 0, v: 0, angle: 0 };
  const _berth = { x: 0, y: 0, angle: 0 };

  function ensure() {
    if (ready || !Core3D.scene) return ready;
    const scene = Core3D.scene;
    bays = new CargoBayBatch(scene, 40);
    containers = new CargoContainers(scene, T.containers);
    conveyors = new PortConveyors(scene, 2048);
    dronesNode = instancedArray(CLASS_N * T.dronesPerClass * DV, 'vec4').setName('portCargoDrones');
    const geos = buildSwarmDroneGeometries(THREE);
    droneMeshes = new SwarmDroneMeshes(scene, dronesNode, geos);
    droneLights = new SwarmDroneLights(scene, dronesNode);
    ready = true;
    return ready;
  }

  /** Zamiana układu stanowiska (u, v, z) → scena względem początku. */
  function toScene(b, u, v, out) {
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    out.x = b.x + u * c - v * s - origin.x;
    out.y = -(b.y + u * s + v * c) - origin.y;
    return out;
  }

  function lookFor(entry, ly, k) {
    const idx = ly.id * 8 + k;
    let v = entry.looks[idx];
    if (!v) v = entry.looks[idx] = containerLookLinear(entry.plan.resourceId || 'steel', entry.plan.seed, idx);
    return v;
  }

  // Ujście (sink) planu → partie: dron, warstwa, wrota.
  const sink = {
    entry: null, berth: null, table: -1, yawScene: 0, beltPhase: 0, door: 0,
    door(p) { this.door = p; },
    belt(phase) { this.beltPhase = phase; },
    drone(i, d, rec) {
      const ci = d.classIndex;
      const n = classCount[ci];
      if (n >= T.dronesPerClass) return;
      classCount[ci] = n + 1;
      const D = dronesNode.value.array;
      const o = (ci * T.dronesPerClass + n) * DV * 4;
      toScene(this.berth, rec.x, rec.y, _w);
      const yaw = -(this.berth.angle + rec.yaw);
      // Przyspieszenie w scenie (błyski RCS): obrót kursem stanowiska, oś y odbita.
      const c = Math.cos(this.berth.angle);
      const s = Math.sin(this.berth.angle);
      const axG = rec.ax * c - rec.ay * s;
      const ayG = rec.ax * s + rec.ay * c;
      const p = o + DR.POSE * 4;
      D[p] = _w.x; D[p + 1] = _w.y; D[p + 2] = rec.z; D[p + 3] = yaw;
      const l = o + DR.LOOK * 4;
      D[l] = rec.e; D[l + 1] = rec.g; D[l + 2] = rec.thrust; D[l + 3] = rec.code;
      const m = o + DR.MOTION * 4;
      D[m] = axG; D[m + 1] = -ayG; D[m + 2] = rec.az; D[m + 3] = 0;
      const f = o + DR.INFO * 4;
      D[f] = ci; D[f + 1] = d.seed; D[f + 2] = rec.bay ? this.table : -1; D[f + 3] = 1;
      const a = o + DR.AUX * 4;
      D[a] = rec.carry >= 0 ? this.entry.plan.layers[rec.carry].count : -1; D[a + 1] = -1; D[a + 2] = yaw; D[a + 3] = -1;
      stats.drones++;
    },
    layer(ly, u, v, z, yawLocal, where) {
      const b = this.berth;
      const pl = this.entry.plan;
      const pnx = pl.cls.pack.nx;
      const pny = pl.cls.pack.ny;
      const yawG = b.angle + yawLocal;
      const cg = Math.cos(yawLocal);
      const sg = Math.sin(yawLocal);
      const yawS = -yawG;
      if (where === 0 && this.table < 0) return;   // ładownia zamknięta — ładunku nie widać
      const bay = where === 0 || (where === 1 && z < 0.5) ? this.table : -1;
      for (let j = 0; j < ly.ks.length; j++) {
        const k = ly.ks[j];
        swarmPackSlotOffset(pnx, pny, k, _off);
        // b chwytu = −v (oś y statku 3D przeciwna do +y obrazka) — miejsca jak w ładowni (cargoModuleContainer).
        const cu = u + _off.a * cg + _off.b * sg;
        const cv = v + _off.a * sg - _off.b * cg;
        toScene(b, cu, cv, _w);
        if (containers.push(_w.x, _w.y, z, yawS, C.L, C.W, C.H, bay, lookFor(this.entry, ly, k))) stats.containers++;
      }
    }
  };

  function planFor(op, yard, budget) {
    const key = `${op.hull}|${op.mode}|${op.fill.toFixed(3)}|${op.resourceId}|${op.dwell.toFixed(1)}|${op.move.toFixed(1)}|${yard.size}|${Math.round(yard.x)}|${Math.round(yard.y)}`;
    let e = plans.get(op.seed);
    if (e && e.key === key) { e.seen = frameNo; return e; }
    if (budget.n <= 0) return null;
    budget.n--;
    const t0 = performance.now();
    _berth.x = yard.x; _berth.y = yard.y; _berth.angle = yard.angle;
    shipInBerth(_berth, op, _shipLocal);
    const plan = planBerthTransfer({
      seed: op.seed, hull: op.hull, mode: op.mode, fill: op.fill, resourceId: op.resourceId,
      dwell: op.dwell, moveSeconds: op.move,
      // Plac pola (stoły, taśmy) zależy od pola, nie od statku — ten sam, który rysuje pushYard.
      berth: { size: yard.size, padLength: yard.padLength, padBeam: yard.padBeam, portalGap: yard.portalGap, halfBeam: yard.halfBeam },
      ship: _shipLocal
    });
    stats.planMs = performance.now() - t0;
    stats.plans++;
    e = { key, plan, seen: frameNo, looks: [], yard: { x: yard.x, y: yard.y, angle: yard.angle } };
    plans.set(op.seed, e);
    return e;
  }

  function cutFor(hullKey) {
    let v = cutCache.get(hullKey);
    if (v === undefined) { v = bayCutRect(hullKey) || null; cutCache.set(hullKey, v); }
    return v;
  }

  const _yardGeo = new Map();
  const _bt = { x: 0, y: 0, angle: 0 };
  /** Infrastruktura pola: stoły, taśmy (z fazą pasa) i portale. */
  function pushYard(yard, beltPhase, seed) {
    const gk = `${yard.size}|${yard.padLength}|${yard.padBeam}|${yard.portalGap}|${yard.halfBeam}`;
    let g = _yardGeo.get(gk);
    if (!g) { g = berthYardGeometry(yard); _yardGeo.set(gk, g); }
    const D = BERTH_TRANSFER_TUNE;
    const yaw = -yard.angle;
    const bt = _bt;
    bt.x = yard.x; bt.y = yard.y; bt.angle = yard.angle;
    const L = g.foot.L;
    const W = g.foot.W;
    for (const S of g.sides) {
      for (const tu of S.tables) {
        toScene(bt, tu, S.vTable, _w);
        conveyors.push(_w.x, _w.y, yaw, L + 1.2, W + 1.2, D.tableH, D.deckZ, CONVEYOR_KIND.TABLE, 0, seed);
      }
      const bl = S.belt;
      const uMid = (bl.u0 + g.uPortal) / 2;
      toScene(bt, uMid, bl.v, _w);
      conveyors.push(_w.x, _w.y, yaw, g.uPortal - bl.u0, bl.width, D.beltH, D.deckZ, CONVEYOR_KIND.BELT, beltPhase, seed);
      // Portal: wlot w grzbiecie (pudło nad końcem taśmy, wyższe od kontenera na pasie).
      toScene(bt, g.uPortal + 6, bl.v, _w);
      conveyors.push(_w.x, _w.y, yaw, 12, bl.width + 6, D.beltH + C.H + 4, D.deckZ, CONVEYOR_KIND.PORTAL, 0, seed + S.side);
    }
  }

  function inView(x, y, r, cam, halfW, halfH) {
    return Math.abs(x - cam.x) <= halfW + r && Math.abs(y - cam.y) <= halfH + r;
  }

  const api = {
    stats,
    /** Prostokąt otworu luku dla rekordu proxy (resolver ShipProxyBatch3D) — tylko statki z otwartymi wrotami. */
    cutForRef(ref) {
      if (!ref) return null;
      return cuts.get(ref.courseId) || null;
    },
    /**
     * Klatka: frame — ramka bloku (`applyCargoOpsBlock`), cam — kamera gry { x, y, zoom } (świat gry), sun — Słońce
     * gry { x, y } albo null, time — zegar efektów (lampy, listwy), viewW / viewH — rozmiar kadru [px].
     * Woła się PRZED rysunkiem proxy (dziury w lukach) i przed Core3D.render.
     */
    update(frame, cam, sun, time, viewW = 1920, viewH = 1080) {
      const t0 = performance.now();
      frameNo++;
      cuts.clear();
      stats.ops = 0; stats.drawnOps = 0; stats.drones = 0; stats.containers = 0; stats.yards = 0; stats.planMs = 0;
      const hasWork = frame && ((frame.yardCount | 0) > 0 || (frame.opCount | 0) > 0);
      if (!hasWork) {
        if (ready) idle();
        stats.ms = performance.now() - t0;
        return;
      }
      if (!ensure()) return;
      // Dziury w lukach proxy (otwarte ładownie tej klatki) — resolver raz, przy pierwszej pracy.
      if (!resolverSet) { ShipProxyBatch3D.setBayCutResolver((ref) => api.cutForRef(ref)); resolverSet = true; }
      sceneOriginNearCamera(origin, Core3D.activeCam1);
      const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
      const halfW = viewW * 0.5 / zoom;
      const halfH = viewH * 0.5 / zoom;
      const cx = Number(cam?.x) || 0;
      const cy = Number(cam?.y) || 0;
      const camG = _camG;
      camG.x = cx; camG.y = cy;
      bays.begin(origin);
      containers.begin();
      conveyors.begin(origin);
      classCount.fill(0);
      CARGO_LIGHT.time.value = time || 0;
      SWARM_LOOK.time.value = time || 0;
      if (sun) setCargoSun(Math.atan2(-(sun.y - cy), sun.x - cx));
      // Billboardy świateł dronów (kamera z góry): osie sceny, piksele na jednostkę.
      CARGO_LIGHT_VIEW.right.value.set(1, 0, 0);
      CARGO_LIGHT_VIEW.up.value.set(0, 1, 0);
      CARGO_LIGHT_VIEW.pxPerUnit.value = Core3D.viewZoom ? Core3D.viewZoom(Core3D.activeCam1) : zoom;
      // Pola zatok w kadrze: stoły, taśmy, portale. Faza taśmy z zegara roju przeładunku tego pola (bez — stoi).
      const yardPhase = _yardPhase;
      yardPhase.length = frame.yardCount;
      for (let i = 0; i < frame.yardCount; i++) yardPhase[i] = 0;
      // Przeładunki: plan (w pamięci), stan w chwili klatki.
      const budget = _budget;
      budget.n = T.plansPerFrame;
      let table = 1;
      for (let i = 0; i < frame.opCount; i++) {
        const op = frame.ops[i];
        const yard = op.yard >= 0 ? frame.yards[op.yard] : null;
        if (!yard || !op.mode) continue;
        stats.ops++;
        const r = Math.max(yard.padLength, yard.padBeam) * 0.6 + T.cullPad;
        if (!inView(yard.x, yard.y, r, camG, halfW, halfH)) continue;
        const e = planFor(op, yard, budget);
        if (!e || !e.plan) continue;
        // Ładownia: otwarta (postęp wrót > 0) → partia wnętrza i skrzydeł (rekord tablicy = światło ładunku),
        // dziura w proxy. Zamknięta — ładunku w ładowni nie widać (sink.layer pomija `where` 0).
        const door = berthTransferDoor(e.plan, op.dockTime);
        let bayTable = -1;
        if (door > 1e-3 && table < 40) {
          const geo = cargoHullBays(op.hull)[0];
          cargoShipToWorld(op, geo.cx, geo.cy, _w);
          if (bays.push(op.hull, _w.x - origin.x, _w.y - origin.y, -op.angle, door, table, (op.seed % 97) / 97)) {
            const cut = cutFor(op.hull);
            if (cut) cuts.set(op.seed, cut);
            bayTable = table++;
          }
        }
        sink.entry = e;
        sink.berth = e.yard;
        sink.table = bayTable;
        sink.beltPhase = 0;
        berthTransferState(e.plan, op.dockTime, sink);
        yardPhase[op.yard] = sink.beltPhase;
        stats.drawnOps++;
      }
      for (let i = 0; i < frame.yardCount; i++) {
        const y = frame.yards[i];
        const r = Math.max(y.padLength, y.padBeam) * 0.6 + T.cullPad;
        if (!inView(y.x, y.y, r, camG, halfW, halfH)) continue;
        pushYard(y, yardPhase[i], y.seed || i);
        stats.yards++;
      }
      // Gracz: luk Atlasa z ładunkiem (rekord 0 tablicy — luk rysuje scoutBay3D, tu kontenery).
      if (frame.player && frame.player.door > 1e-3) pushPlayer(frame.player);
      // Partie.
      let draws = bays.end();
      containers.commit();
      containers.mesh.position.set(origin.x, origin.y, 0);
      if (containers.count) draws++;
      draws += conveyors.end();
      for (let k = 0; k < CLASS_N; k++) ranges[k].count = classCount[k];
      droneMeshes.setRanges(ranges);
      droneLights.setRanges(ranges);
      droneMeshes.setLod(CARGO_LIGHT_VIEW.pxPerUnit.value);
      for (const m of droneMeshes.meshes) for (const lod of ['hi', 'lo']) m.meshes[lod].position.set(origin.x, origin.y, 0);
      for (const m of droneLights.meshes) m.mesh.position.set(origin.x, origin.y, 0);
      const attr = dronesNode.value;
      attr.updateRanges.length = 0;
      for (let k = 0; k < CLASS_N; k++) {
        if (classCount[k] > 0) { attr.addUpdateRange(k * T.dronesPerClass * DV * 4, classCount[k] * DV * 4); draws += 2; }
      }
      if (attr.updateRanges.length) attr.needsUpdate = true;
      stats.draws = draws;
      // Plany bez odczytu — z pamięci.
      if ((frameNo & 63) === 0) for (const [id, e] of plans) if (frameNo - e.seen > T.planIdleFrames) plans.delete(id);
      stats.ms = performance.now() - t0;
    },

    /** Rozgrzewka (Core3D.warmup, faza 'loading'): partie ładowni rodzajów ruchu i Atlasa, kontenery, drony, taśmy. */
    warmupMeshes() {
      if (!ensure()) return [];
      const hulls = [...new Set(Object.values(TRAFFIC_CARGO_BAY_HULLS))];
      return [
        ...bays.warmupMeshes(hulls), containers.mesh, conveyors.mesh,
        ...droneMeshes.warmupMeshes(), ...droneLights.warmupMeshes()
      ];
    },

    dispose() { plans.clear(); cuts.clear(); }
  };

  const _yardPhase = [];
  const _budget = { n: 0 };
  const _camG = { x: 0, y: 0 };

  function idle() {
    if (bays) { bays.begin(origin); bays.end(); }
    if (containers) { containers.begin(); containers.commit(); }
    if (conveyors) { conveyors.begin(origin); conveyors.end(); }
    if (droneMeshes) { for (const r of ranges) r.count = 0; droneMeshes.setRanges(ranges); droneLights.setRanges(ranges); }
  }

  // Ładunek gracza w luku Atlasa: moduły od rufy (cargoBaySlots), wypełnienie z masy / ładowności, surowce wg udziałów.
  // Pole myśliwców i stanowisko fregaty zwiadu (gdy w luku) zostają wolne — „okręty zabierają miejsce ładunkowi”.
  const _playerLooks = new Map();
  function pushPlayer(p) {
    const geo = cargoHullBays(p.hull)[0];
    if (!geo) return;
    const slots = cargoBaySlots(geo);
    const mod = geo.module;
    const free = playerFreeSlots(geo, slots, p.frigate);
    const total = free.length * mod.count;
    let n = Math.min(total, Math.ceil(total * Math.max(0, Math.min(1, p.fill)) - 1e-9));
    if (!(n > 0)) return;
    cargoShipToWorld(p, geo.cx, geo.cy, _w);
    const bx = _w.x - origin.x;
    const by = _w.y - origin.y;
    const yaw = -p.angle;
    // Rekord 0 tablicy (luk Atlasa — scoutBay3D) ze środkiem względem początku: światło kontenerów w luku.
    const r0 = CargoBayTable.rows[0];
    r0.x = bx; r0.y = by;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Surowce: skumulowane udziały → kolejne kontenery.
    const res = p.res && p.res.length ? p.res : [['steel', 1]];
    let ri = 0;
    let acc = res[0][1] * n;
    for (let i = 0, k = 0; i < free.length && k < n; i++) {
      const sl = free[i];
      for (let q = 0; q < mod.count && k < n; q++, k++) {
        while (k >= acc && ri < res.length - 1) { ri++; acc += res[ri][1] * n; }
        cargoModuleContainer(mod, q, _mc);
        const a = sl.a + _mc.a;
        const b = sl.b + _mc.b;
        const x = bx + a * c - b * s;
        const y = by + a * s + b * c;
        const key = res[ri][0];
        let looks = _playerLooks.get(key);
        if (!looks) { looks = []; _playerLooks.set(key, looks); }
        const look = looks[k] || (looks[k] = containerLookLinear(key, 4242, k));
        if (containers.push(x, y, -geo.depth + _mc.z, yaw, C.L, C.W, C.H, 0, look)) stats.containers++;
      }
    }
  }

  const _freeCache = new Map();
  function playerFreeSlots(geo, slots, frigate) {
    const key = frigate ? 1 : 0;
    let list = _freeCache.get(key);
    if (list) return list;
    const B = geo.bay;
    const ff = B.fighterField;
    // Pole myśliwców przy rufowej ścianie luku (dziób fregaty ku dziobowi Atlasa), stanowisko fregaty pośrodku.
    const fighters = ff ? { a0: -geo.halfA, a1: -geo.halfA + ff.a + 4, b0: -ff.b / 2 - 2, b1: ff.b / 2 + 2 } : null;
    const scout = frigate ? { a0: -geo.halfA * 0.25 - 100, a1: -geo.halfA * 0.25 + 100, b0: -45, b1: 45 } : null;
    const hit = (r, sl) => r && Math.abs(sl.a - (r.a0 + r.a1) / 2) < (r.a1 - r.a0) / 2 + geo.module.L / 2
      && Math.abs(sl.b - (r.b0 + r.b1) / 2) < (r.b1 - r.b0) / 2 + geo.module.W / 2;
    list = slots.filter((sl) => !hit(fighters, sl) && !hit(scout, sl));
    _freeCache.set(key, list);
    return list;
  }

  return api;
}

// Jeden obraz przeładunku na Core3D (strona w trybie off albo worker renderu) + rozgrzewka przy imporcie (wzór
// proxy statków ruchu): partie ładowni rodzajów ruchu, kontenery, drony (LOD na klasę), światła dronów, taśmy.
let _shared = null;
export function sharedPortCargo3D() {
  return _shared || (_shared = createPortCargo3D(CoreRef));
}
CoreRef.warmup?.add?.({
  name: 'przeładunek w portach (ładownie, kontenery, drony, taśmy)',
  objects: () => sharedPortCargo3D().warmupMeshes(),
  phase: 'loading',
  variant: WARIANT_INSTANCJI
});
