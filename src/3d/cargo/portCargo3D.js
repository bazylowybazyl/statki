// src/3d/cargo/portCargo3D.js
//
// PRZEŁADUNEK W PORTACH — OBRAZ (E12, docs/E12-przeladunek.md): przy zadokowanym statku ruchu (bańka E6) ładownia
// otwiera się na postoju, rój dronów Z DEMA, liczony na żywo na GPU (swarmSim.js: lot, ORCA, zamki kolumn — pula
// stanowisk src/3d/swarm/swarmBerthPool.js, wieża portu na slot), przenosi warstwy kontenerów między ładownią a stołami
// przy burcie, a taśmociąg wiezie je w głąb portu (portal w grzbiecie zatoki); luk Atlasa pokazuje ładunek gracza przy
// postoju i handlu. Wszystko to OBRAZ: ładunek i czas postoju liczy świat ruchu, gra pakuje tylko ramkę (blok migawki
// `cargoOps`, src/render/blocks/cargoOpsBlock.js), a ten moduł — w workerze renderu albo w trybie `off` na stronie —
// liczy resztę.
//
// NA ŻYWO tylko N stanowisk najbliżej środka kadru (`SWARM_POOL_TUNE.slots`): slot puli dostaje stan startowy z zegara
// postoju (warstwy przeniesione = postęp postoju), wieża prowadzi drony, przy końcu okna obraz domyka się zgodnie
// z ekonomią. Pozostałe stanowiska w kadrze pokazują ładownię w stanie z zegara (kontenery bez dronów).
//
// PARTIE (jeden rysunek na rodzaj — bez rysunku na statek): ładownie (CargoBayBatch — wnętrze i wrota na kadłub),
// kontenery stanu z zegara i luku gracza (CargoContainers), rój (pula: drony na klasę, światła, kontenery symulacji),
// taśmy, stoły i portale (PortConveyors). Proxy kadłubów dostają dziurę w otworze luku (ShipProxyBatch3D).
//
// PRECYZJA: wszystko względem początku przy kamerze (sceneOriginNearCamera; mesh.position = początek), tablica
// ładowni (światło kontenerów i dronów) — te same współrzędne. Rekord 0 tablicy należy do luku Atlasa
// (scoutBay3D) — tu nadpisujemy tylko jego środek względem początku, gdy w luku stoi ładunek gracza; rekordy
// 1…N — sloty puli (stałe: światło kontenerów symulacji czyta indeks z bufora GPU), dalej — stanowiska z zegara.
//
// Szew: bez `window`, DOM i stanu gry — wejście to ramka bloku (`applyCargoOpsBlock`) i kamera klatki.
import * as THREE from 'three/webgpu';
import { Core3D as CoreRef } from '../core3d.js';
import { WARIANT_INSTANCJI } from '../rozgrzewka.js';
import { sceneOriginNearCamera } from '../sceneOrigin.js';
import { ShipProxyBatch3D } from '../shipProxyBatch3D.js';
import { CargoBayBatch } from './bayBatch.tsl.js';
import { CargoContainers, containerLookLinear } from './containers.tsl.js';
import { CONVEYOR_KIND, PortConveyors } from './conveyor.tsl.js';
import { CARGO_LIGHT, CargoBayTable, setCargoSun } from './cargoLight.tsl.js';
import { CARGO_LIGHT_VIEW } from './drones.tsl.js';
import { SWARM_LOOK } from '../swarm/swarmDrones.tsl.js';
import { SWARM_POOL_TUNE, createSwarmBerthPool } from '../swarm/swarmBerthPool.js';
import { BERTH_TRANSFER_TUNE, berthDoorAt, berthTransferTiming, berthYardGeometry, shipInBerth } from '../../game/swarm/berthTransfer.js';
import {
  CARGO_CONTAINER, TRAFFIC_CARGO_BAY_HULLS, cargoBayHull, cargoBaySlots, cargoHullBays, cargoModuleContainer, cargoShipToWorld
} from '../../data/cargoBays.js';

export const PORT_CARGO_TUNE = {
  containers: 8192,
  /** Nowych slotów roju na klatkę (dołączenie ciężkiego frachtowca ~3–5 ms CPU) — reszta czeka klatkę. */
  activatePerFrame: 1,
  /** Zapas kadru [j.] przy obcinaniu stanowisk (taśma za portalem, drony nad placem). */
  cullPad: 400,
  /** Slot roju trzyma stanowisko, dopóki jego środek jest w kadrze powiększonym o tyle [ułamek pół kadru]. */
  keepMargin: 0.6,
  /** Najdłuższy krok czasu gry na klatkę dla roju [s] (skok zegara — np. po pauzie). */
  maxGameDt: 0.25
};

const C = CARGO_CONTAINER;

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

/**
 * Warstwy ładowni w stanie z zegara (bez roju): ile warstw stoi w ładowni przy postępie postoju p (0…1) —
 * UNLOAD ubywa od końca kolejności załadunku, LOAD przybywa od początku. Warstwa = piętro modułu slotu.
 */
export function bayLayersAt(geo, fill, mode, progress) {
  const per = geo.module.nx * geo.module.ny;
  const containers = fill > 0 ? Math.min(geo.containers, Math.max(1, Math.ceil(geo.containers * fill - 1e-9))) : 0;
  const layers = Math.ceil(containers / per);
  const moved = Math.round(layers * Math.max(0, Math.min(1, progress)));
  return mode === 'unload' ? layers - moved : moved;
}

export function createPortCargo3D(Core3D) {
  const T = PORT_CARGO_TUNE;
  let ready = false;
  let bays = null;
  let containers = null;
  let conveyors = null;
  let pool = null;
  const origin = { x: 0, y: 0 };
  const cuts = new Map();           // numer kursu → Vector4 (uv otworu) — dla proxy w tej klatce
  const cutCache = new Map();       // kadłub → Vector4
  const timings = new Map();        // numer kursu → { key…, tm } (czasy postoju)
  const stats = { ops: 0, live: 0, clock: 0, containers: 0, yards: 0, ms: 0, draws: 0, poolMs: 0, planMs: 0 };
  let frameNo = 0;
  let resolverSet = false;
  let lastTime = NaN;
  const _w = { x: 0, y: 0, yaw: 0 };
  const _mc = {};
  const _shipLocal = { u: 0, v: 0, angle: 0 };
  const _berth = { x: 0, y: 0, angle: 0 };
  const _bt = { x: 0, y: 0, angle: 0 };
  const _camG = { x: 0, y: 0 };
  const _yardPhase = [];
  const _byKey = new Map();          // numer kursu → op tej klatki (sloty puli)
  const _cand = [];
  const _seen = new Set();
  const _live = new Set();           // numery kursów ze slotem roju (ta klatka)
  const _slotOf = new Map();         // numer kursu → slot

  function ensure() {
    if (ready || !Core3D.scene) return ready;
    const scene = Core3D.scene;
    bays = new CargoBayBatch(scene, 40);
    containers = new CargoContainers(scene, T.containers);
    conveyors = new PortConveyors(scene, 2048);
    pool = createSwarmBerthPool(Core3D);
    pool.ensure();
    ready = true;
    return ready;
  }

  /** Zamiana układu stanowiska (u, v) → scena względem początku. */
  function toScene(b, u, v, out) {
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    out.x = b.x + u * c - v * s - origin.x;
    out.y = -(b.y + u * s + v * c) - origin.y;
    return out;
  }

  function timingFor(op) {
    let e = timings.get(op.seed);
    if (e && e.hull === op.hull && e.dwell === op.dwell && e.move === op.move) { e.seen = frameNo; return e; }
    const tm = berthTransferTiming({ hull: op.hull, dwell: op.dwell, moveSeconds: op.move });
    e = { hull: op.hull, dwell: op.dwell, move: op.move, tm, seen: frameNo, liveClose: Infinity };
    timings.set(op.seed, e);
    return e;
  }

  function cutFor(hullKey) {
    let v = cutCache.get(hullKey);
    if (v === undefined) { v = bayCutRect(hullKey) || null; cutCache.set(hullKey, v); }
    return v;
  }

  function yardGeoOf(yard) {
    let g = yard._yardGeo;
    if (!g || g._size !== yard.size || g.padLength !== yard.padLength || g.padBeam !== yard.padBeam
      || g._portal !== yard.portalGap || g._half !== yard.halfBeam) {
      g = berthYardGeometry(yard);
      g._size = yard.size; g._portal = yard.portalGap; g._half = yard.halfBeam;
      yard._yardGeo = g;
    }
    return g;
  }

  /** Infrastruktura pola: stoły, taśmy (z fazą pasa) i portale. */
  function pushYard(yard, beltPhase, seed) {
    const g = yardGeoOf(yard);
    const D = BERTH_TRANSFER_TUNE;
    const yaw = -yard.angle;
    const bt = _bt;
    bt.x = yard.x; bt.y = yard.y; bt.angle = yard.angle;
    const L = g.foot.L;
    const W = g.foot.W;
    for (const S of g.sides) {
      for (const tu of S.tables) {
        toScene(bt, tu, S.vTable, _w);
        conveyors.push(_w.x, _w.y, yaw, L + 1.2, W + 1.2, D.tableH, D.tableZ - D.tableH, CONVEYOR_KIND.TABLE, 0, seed);
      }
      const bl = S.belt;
      const uMid = (bl.u0 + g.uPortal) / 2;
      toScene(bt, uMid, bl.v, _w);
      conveyors.push(_w.x, _w.y, yaw, g.uPortal - bl.u0, bl.width, D.beltH, D.deckZ, CONVEYOR_KIND.BELT, beltPhase, seed);
      toScene(bt, g.uPortal + 6, bl.v, _w);
      conveyors.push(_w.x, _w.y, yaw, 12, bl.width + 6, D.beltH + C.H + 4, D.deckZ, CONVEYOR_KIND.PORTAL, 0, seed + S.side);
    }
  }

  // Ładownia w stanie z zegara (stanowiska poza roju na żywo): warstwy od początku kolejności załadunku.
  function pushBayClock(op, geo, layers, table) {
    if (!(layers > 0)) return;
    const slots = cargoBaySlots(geo);
    const mod = geo.module;
    const per = mod.nx * mod.ny;
    cargoShipToWorld(op, geo.cx, geo.cy, _w);
    const bx = _w.x - origin.x;
    const by = _w.y - origin.y;
    const yaw = -op.angle;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let left = layers;
    for (let i = 0; i < slots.length && left > 0; i++) {
      const sl = slots[i];
      for (let tier = 0; tier < mod.nz && left > 0; tier++, left--) {
        for (let q = 0; q < per; q++) {
          cargoModuleContainer(mod, tier * per + q, _mc);
          const a = sl.a + _mc.a;
          const b = sl.b + _mc.b;
          const look = containerLookLinear(op.resourceId || 'steel', 4242, ((op.seed | 0) + i * 7 + q) & 15);
          if (containers.push(bx + a * c - b * s, by + a * s + b * c, -geo.depth + _mc.z, yaw, C.L, C.W, C.H, table, look)) stats.containers++;
        }
      }
    }
  }

  function inView(x, y, r, cam, halfW, halfH) {
    return Math.abs(x - cam.x) <= halfW + r && Math.abs(y - cam.y) <= halfH + r;
  }

  // Stan slotu roju w tej klatce (dla puli): stanowisko i zegar postoju albo null (statek odleciał, poza kadrem).
  const slotState = { berth: null, dockTime: 0, swarmStart: 0, doorClose: 0, workEnd: 0 };
  function stateOf(slot) {
    const op = _byKey.get(slot.key);
    if (!op) { stats.noState = (stats.noState || 0) + 1; stats.noStateWhy = _seen.has(slot.key) ? 'poza kadrem' : 'brak przeładunku w ramce'; return null; }
    const e = timings.get(op.seed);
    if (!e || !e.tm) return null;
    slotState.berth = op._berth;
    slotState.dockTime = op.dockTime;
    slotState.swarmStart = e.tm.swarmStart;
    slotState.doorClose = e.tm.doorClose;
    slotState.workEnd = e.tm.workEnd;
    return slotState;
  }

  const api = {
    stats,
    get pool() { return pool; },
    /** Prostokąt otworu luku dla rekordu proxy (resolver ShipProxyBatch3D) — tylko statki z otwartymi wrotami. */
    cutForRef(ref) {
      if (!ref) return null;
      return cuts.get(ref.courseId) || null;
    },
    /**
     * Klatka: frame — ramka bloku (`applyCargoOpsBlock`), cam — kamera gry { x, y, zoom } (świat gry), sun — Słońce
     * gry { x, y } albo null, time — zegar efektów (lampy, listwy), viewW / viewH — rozmiar kadru [px].
     * Woła się PRZED rysunkiem proxy (dziury w lukach) i przed Core3D.render (krok roju w Core3D.fx).
     */
    update(frame, cam, sun, time, viewW = 1920, viewH = 1080) {
      try { return this._update(frame, cam, sun, time, viewW, viewH); } catch (e) { stats.err = String(e && e.stack || e).slice(0, 800); throw e; }
    },
    _update(frame, cam, sun, time, viewW = 1920, viewH = 1080) {
      const t0 = performance.now();
      frameNo++;
      cuts.clear();
      stats.ops = 0; stats.live = 0; stats.clock = 0; stats.containers = 0; stats.yards = 0;
      // Czas gry tej klatki (zegar roju × 4 w puli): przyrost czasu mostu z ramki, pauza = 0.
      const gt = Number(frame?.time) || 0;
      const gameDt = Number.isFinite(lastTime) ? Math.max(0, Math.min(T.maxGameDt, gt - lastTime)) : 0;
      lastTime = gt;
      const hasWork = frame && ((frame.yardCount | 0) > 0 || (frame.opCount | 0) > 0 || frame.player);
      const poolBusy = pool && pool.stats.slots > 0;
      if (!hasWork && !poolBusy) {
        if (ready) idle();
        stats.ms = performance.now() - t0;
        return;
      }
      if (!ensure()) return;
      if (!resolverSet) { ShipProxyBatch3D.setBayCutResolver((ref) => api.cutForRef(ref)); resolverSet = true; }
      sceneOriginNearCamera(origin, Core3D.activeCam1);
      const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
      const halfW = viewW * 0.5 / zoom;
      const halfH = viewH * 0.5 / zoom;
      const camG = _camG;
      camG.x = Number(cam?.x) || 0; camG.y = Number(cam?.y) || 0;
      bays.begin(origin);
      containers.begin();
      conveyors.begin(origin);
      CARGO_LIGHT.time.value = time || 0;
      SWARM_LOOK.time.value = time || 0;
      if (sun) setCargoSun(Math.atan2(-(sun.y - camG.y), sun.x - camG.x));
      CARGO_LIGHT_VIEW.right.value.set(1, 0, 0);
      CARGO_LIGHT_VIEW.up.value.set(0, 1, 0);
      const pxPerUnit = Core3D.viewZoom ? Core3D.viewZoom(Core3D.activeCam1) : zoom;
      CARGO_LIGHT_VIEW.pxPerUnit.value = pxPerUnit;
      const yardPhase = _yardPhase;
      const nYard = frame ? frame.yardCount : 0;
      yardPhase.length = nYard;
      for (let i = 0; i < nYard; i++) yardPhase[i] = 0;
      // 1) Przeładunki tej klatki: czasy postoju, kandydaci do roju na żywo (w kadrze, wg odległości od środka).
      _byKey.clear();
      _seen.clear();
      _cand.length = 0;
      const nOp = frame ? frame.opCount : 0;
      for (let i = 0; i < nOp; i++) {
        const op = frame.ops[i];
        const yard = op.yard >= 0 ? frame.yards[op.yard] : null;
        if (!yard || !op.mode) continue;
        stats.ops++;
        const e = timingFor(op);
        if (!e.tm) continue;
        op._yard = yard;
        op._e = e;
        op._berth = op._berth || { x: 0, y: 0, angle: 0 };
        op._berth.x = yard.x; op._berth.y = yard.y; op._berth.angle = yard.angle;
        const r = Math.max(yard.padLength, yard.padBeam) * 0.6;
        op._dist = Math.abs(yard.x - camG.x) / halfW + Math.abs(yard.y - camG.y) / halfH;
        op._inView = inView(yard.x, yard.y, r + T.cullPad, camG, halfW, halfH);
        op._keep = inView(yard.x, yard.y, r, camG, halfW * (1 + T.keepMargin), halfH * (1 + T.keepMargin));
        _seen.add(op.seed);
        // Slot roju trzyma przeładunek, dopóki ten jest w ramce (gra wysyła pola z zapasem większym niż kadr) —
        // zoom w tę i z powrotem nie zakłada slotu od nowa; poza kadrem slot ustępuje bliższym (wywłaszczenie niżej).
        _byKey.set(op.seed, op);
        if (op._inView) _cand.push(op);
      }
      // 2) Pula: istniejące sloty (stan z zegara, wieża, krok w Core3D.fx); nowe sloty dla najbliższych bez slotu.
      const tp = performance.now();
      pool.update(gameDt, origin, stateOf, pxPerUnit);
      // Stanowiska z rojem na żywo z presetu grafiki (Niska 0 — sam stan z zegara); po obniżeniu presetu nadmiar slotów
      // się zwalnia — najpierw te poza kadrem.
      const cap = Math.max(0, Math.min(SWARM_POOL_TUNE.slots, Number.isFinite(frame?.liveSlots) ? frame.liveSlots : SWARM_POOL_TUNE.slots));
      const live = _live;
      live.clear();
      for (const s of pool.slots) if (s.active) live.add(s.key);
      while (live.size > cap) {
        let victim = null;
        for (const s of pool.slots) {
          if (!s.active) continue;
          const o2 = _byKey.get(s.key);
          if (!victim || !o2 || !o2._keep) victim = s;
          if (!o2 || !o2._keep) break;
        }
        live.delete(victim.key);
        pool.release(victim, 'preset grafiki');
      }
      _cand.sort((a, b) => a._dist - b._dist);
      let budget = cap > 0 ? T.activatePerFrame : 0;
      for (let i = 0; i < _cand.length && budget > 0; i++) {
        const op = _cand[i];
        if (live.has(op.seed)) continue;
        if (live.size >= cap) {
          // Wywłaszczenie: slot przeładunku poza kadrem (albo już bez ramki) ustępuje stanowisku w kadrze.
          let victim = null;
          for (const s of pool.slots) {
            if (!s.active) continue;
            const o2 = _byKey.get(s.key);
            if (!o2 || !o2._keep) { victim = s; break; }
          }
          if (!victim) break;
          live.delete(victim.key);
          pool.release(victim, 'wywłaszczenie');
        }
        const tm = op._e.tm;
        // Statek pod koniec okna (wrota się zamykają) — bez roju; stan z zegara.
        if (op.dockTime >= tm.doorClose - 1) continue;
        _berth.x = op._yard.x; _berth.y = op._yard.y; _berth.angle = op._yard.angle;
        shipInBerth(_berth, op, _shipLocal);
        const span = Math.max(1e-3, tm.workEnd - tm.swarmStart);
        const progress = Math.max(0, Math.min(1, (op.dockTime - tm.swarmStart) / span));
        const slot = pool.activate({
          key: op.seed, seed: op.seed, hull: op.hull, mode: op.mode, fill: op.fill, resourceId: op.resourceId, progress,
          remainingSec: Math.max(1, tm.workEnd - Math.max(op.dockTime, tm.swarmStart)),
          ship: { u: _shipLocal.u, v: _shipLocal.v, angle: _shipLocal.angle }, yard: yardGeoOf(op._yard),
          berth: { x: op._yard.x, y: op._yard.y, angle: op._yard.angle }
        });
        if (!slot) break;
        live.add(op.seed);
        budget--;
      }
      // Indeks tablicy ładowni slotu = 1 + slot (stały — światło kontenerów symulacji czyta go z bufora GPU).
      const slotOf = _slotOf;
      slotOf.clear();
      for (const s of pool.slots) if (s.active) slotOf.set(s.key, s);
      stats.poolMs = performance.now() - tp;
      stats.planMs = pool.stats.planMs;
      pool.stats.planMs = 0;
      // 3) Ładownie, dziury w proxy, ładownia z zegara (poza rojem), faza taśm.
      let table = 1 + SWARM_POOL_TUNE.slots;
      for (let i = 0; i < _cand.length; i++) {
        const op = _cand[i];
        const e = op._e;
        const tm = e.tm;
        const slot = slotOf.get(op.seed);
        // Rój skończył — wrota zamykają się wcześniej (nie czekają do końca okna).
        if (slot && slot.finished && !Number.isFinite(e.liveClose)) e.liveClose = Math.max(tm.doorOpen + tm.doorTotal, op.dockTime + 0.6);
        const door = berthDoorAt(tm, op.dockTime, Math.min(tm.doorClose, e.liveClose));
        const geo = tm.geo;
        if (door > 1e-3) {
          const tbl = slot ? 1 + slot.k : (table < 40 ? table++ : -1);
          if (tbl >= 0) {
            cargoShipToWorld(op, geo.cx, geo.cy, _w);
            if (bays.push(op.hull, _w.x - origin.x, _w.y - origin.y, -op.angle, door, tbl, (op.seed % 97) / 97)) {
              const cut = cutFor(op.hull);
              if (cut) cuts.set(op.seed, cut);
            }
            if (!slot) {
              const span = Math.max(1e-3, tm.workEnd - tm.swarmStart);
              const p = Math.max(0, Math.min(1, (op.dockTime - tm.swarmStart) / span));
              pushBayClock(op, geo, bayLayersAt(geo, op.fill, op.mode, p), tbl);
              stats.clock++;
            }
          }
        }
        if (slot) {
          stats.live++;
          // Taśma jedzie, gdy przywozi (LOAD przed startem) albo wywozi (UNLOAD po końcu) ładunek slotu.
          const belt = (!slot.started && op.mode === 'load') || (slot.finished && op.mode === 'unload');
          if (belt) yardPhase[op.yard] = (time || 0) * BERTH_TRANSFER_TUNE.beltSpeed;
        }
      }
      for (let i = 0; i < nYard; i++) {
        const y = frame.yards[i];
        const r = Math.max(y.padLength, y.padBeam) * 0.6 + T.cullPad;
        if (!inView(y.x, y.y, r, camG, halfW, halfH)) continue;
        pushYard(y, yardPhase[i], y.seed || i);
        stats.yards++;
      }
      // Gracz: luk Atlasa z ładunkiem (rekord 0 tablicy — luk rysuje scoutBay3D, tu kontenery).
      if (frame && frame.player && frame.player.door > 1e-3) pushPlayer(frame.player);
      let draws = bays.end();
      containers.commit();
      containers.mesh.position.set(origin.x, origin.y, 0);
      if (containers.count) draws++;
      draws += conveyors.end();
      stats.draws = draws;
      if ((frameNo & 63) === 0) for (const [id, e] of timings) if (frameNo - e.seen > 600) timings.delete(id);
      stats.ms = performance.now() - t0;
    },

    /** Rozgrzewka (Core3D.warmup, faza 'loading'): partie ładowni rodzajów ruchu i Atlasa, kontenery, rój, taśmy. */
    warmupMeshes() {
      if (!ensure()) return [];
      const hulls = [...new Set(Object.values(TRAFFIC_CARGO_BAY_HULLS))];
      return [...bays.warmupMeshes(hulls), containers.mesh, conveyors.mesh, ...pool.warmupMeshes()];
    },

    dispose() { cuts.clear(); timings.clear(); }
  };

  function idle() {
    if (bays) { bays.begin(origin); bays.end(); }
    if (containers) { containers.begin(); containers.commit(); }
    if (conveyors) { conveyors.begin(origin); conveyors.end(); }
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
    const n = Math.min(total, Math.ceil(total * Math.max(0, Math.min(1, p.fill)) - 1e-9));
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
    const res = p.res && p.res.length ? p.res : DEFAULT_RES;
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
        const look = looks[k & 15] || (looks[k & 15] = containerLookLinear(key, 4242, k & 15));
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
    // Pole myśliwców przy rufowej ścianie luku, stanowisko fregaty pośrodku.
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

const DEFAULT_RES = Object.freeze([Object.freeze(['steel', 1])]);

// Jeden obraz przeładunku na Core3D (strona w trybie off albo worker renderu) + rozgrzewka przy imporcie (wzór
// proxy statków ruchu): partie ładowni rodzajów ruchu, kontenery, rój (drony, światła, kontenery symulacji), taśmy.
let _shared = null;
export function sharedPortCargo3D() {
  return _shared || (_shared = createPortCargo3D(CoreRef));
}
CoreRef.warmup?.add?.({
  name: 'przeładunek w portach (ładownie, kontenery, rój, taśmy)',
  objects: () => sharedPortCargo3D().warmupMeshes(),
  phase: 'loading',
  variant: WARIANT_INSTANCJI
});
