// src/game/escapePodRoutes.js
//
// KAPSUŁY RATUNKOWE — cel i trasa (E22, reguła `kapsuly-ratunkowe`). Czysta matematyka (bez DOM, three i stanu gry).
//
// CEL: najbliższa stacja frakcji statku (`pickEscapePodStation`); bez takiej — najbliższa niepiracka. Prom — port
// nadania (krok K4). Stacje opuszczone, zniszczone i pirackie odpadają.
// MIEJSCE DOLOTU (`podDockTarget`):
//   • port z budowlą doku bez ringu (krzyż, okrąg, koło — `PortDockWorld.docks`): stanowisko o najbliższym lejku,
//     trasa do lejka (za dyskiem zapasu), dalej ścieżką wejścia stanowiska (`inbound`, płaska [u, v, rola] × n) do pola — przez korytarz,
//     nie przez bryły;
//   • port ringu (Ziemia, Mars, Jowisz — `ready.bubblePorts`): najbliższe stanowisko ZATOKI (otwarta na przestrzeń;
//     hala K-7 ma dach i bramy z boku), bez zatok — najbliższe stanowisko; router ringu wchodzi w strefę portu lejkiem
//     i promieniowo, płytę przelatuje tylko tranzytami i przerwami ringu w budowie;
//   • reszta: punkt stacji.
// TRASA: `routeAroundDiscs` (src/game/traffic/dockDetour.js — ten sam objazd dysków doków i router ringu co bańka
// ruchu v2), więc kapsuła omija bryły doków i płytę ringu tak jak statki ruchu.

import { createRingObstacle } from './traffic/ringRouter.js';
import { createPath, pathReset, pathPush, PATH_STRIDE } from './traffic/portPaths.js';
import { routeAroundDiscs, pushDockDisc } from './traffic/dockDetour.js';
import { haloRingKey } from './haloRingPlanets.js';
import { dockLocalToGame } from '../3d/portDocks/portDockLayout.js';

export const POD_ROUTE_TUNE = Object.freeze({
  // Sufit prędkości na ścieżce wejścia stanowiska doku [j./s] (korytarz między brył).
  dockLaneSpeed: 220,
  // Sufit prędkości ostatniego odcinka do stanowiska ringu (lejek → pole) [j./s].
  ringPortSpeed: 320
});

/** Router kapsuł: ringi, dyski doków, budowle po stacji, stanowiska portów bańki. */
export function createEscapePodRouter() {
  return {
    rings: [],
    ringKeys: '',
    discs: new Float64Array(0),
    docksVersion: -2,
    dockByStation: new Map(),
    ports: null,
    portsRef: null,
    portByStation: new Map(),
    path: createPath(192),
    _p: { x: 0, y: 0 }
  };
}

/**
 * Świat routera. `planets` — ciała z ringiem „Halo” (`{ id, x, y }`; inne pomijane), `docks` — `PortDockWorld.docks`
 * z wersją `docksVersion`, `ports` — tabela `ready.bubblePorts` ({ stacja: [stanowiska] }). Przebudowa tylko przy
 * zmianie (ringi z listy kluczy, doki z wersji, porty z referencji tabeli).
 */
export function syncEscapePodRouter(router, { planets = null, docks = null, docksVersion = -1, ports = null } = {}) {
  if (planets) {
    let keys = '';
    for (const p of planets) if (haloRingKey(p)) keys += `${p.id}:${Math.round(p.x)}:${Math.round(p.y)};`;
    if (keys !== router.ringKeys) {
      router.ringKeys = keys;
      router.rings = [];
      for (const p of planets) {
        const key = haloRingKey(p);
        if (!key) continue;
        const ring = createRingObstacle({ key, x: Number(p.x) || 0, y: Number(p.y) || 0 });
        if (ring) router.rings.push(ring);
      }
    }
  }
  if (docks && docksVersion !== router.docksVersion) {
    router.docksVersion = docksVersion;
    router.dockByStation.clear();
    const list = [];
    for (const d of docks) {
      if (!d || !(d.keepR > 0)) continue;
      pushDockDisc(list, d.x, d.y, d.keepR);
      router.dockByStation.set(String(d.stationId), d);
    }
    router.discs = Float64Array.from(list);
  }
  if (ports && ports !== router.portsRef) {
    router.portsRef = ports;
    router.portByStation.clear();
    for (const id of Object.keys(ports)) {
      const berths = ports[id];
      if (Array.isArray(berths) && berths.length) router.portByStation.set(String(id), berths);
    }
  }
  return router;
}

function stationUsable(st) {
  if (!st) return false;
  if (st.destroyed || st._destroyed3D) return false;
  if (Number.isFinite(st.hp) && st.hp <= 0) return false;
  if (st.isPirate || st.factionId === 'pirates') return false;
  if (st.abandoned || !st.factionId) return false;
  return Number.isFinite(st.x) && Number.isFinite(st.y);
}

/**
 * Indeks stacji docelowej kapsuły z (x, y): najbliższa stacja frakcji `factionId`, bez takiej — najbliższa niepiracka
 * zamieszkana; `stationId` — konkretna stacja (prom: port nadania), gdy zdatna. −1 — żadnej.
 */
export function pickEscapePodStation(stations, x, y, factionId = null, stationId = null) {
  if (!Array.isArray(stations)) return -1;
  if (stationId != null) {
    const want = String(stationId);
    for (let i = 0; i < stations.length; i++) {
      if (String(stations[i]?.id) === want && stationUsable(stations[i])) return i;
    }
  }
  let own = -1;
  let ownD2 = Infinity;
  let any = -1;
  let anyD2 = Infinity;
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    if (!stationUsable(st)) continue;
    const dx = st.x - x;
    const dy = st.y - y;
    const d2 = dx * dx + dy * dy;
    if (factionId && st.factionId === factionId && d2 < ownD2) { ownD2 = d2; own = i; }
    if (d2 < anyD2) { anyD2 = d2; any = i; }
  }
  return own >= 0 ? own : any;
}

/** Stanowisko budowli doku o lejku (albo punkcie czekania) najbliższym (x, y). */
function nearestDockBerth(dock, x, y, out) {
  const berths = dock.geometry?.berths || [];
  let best = null;
  let bestD2 = Infinity;
  for (const b of berths) {
    // `inbound` — płaska tablica [u, v, rola] × n (od punktu czekania do pola).
    const inb = b.inbound;
    if (!inb || inb.length < 3) continue;
    const u = b.funnel ? b.funnel[0] : inb[0];
    const v = b.funnel ? b.funnel[1] : inb[1];
    dockLocalToGame(dock, u, v, out);
    const dx = out.x - x;
    const dy = out.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = b; }
  }
  // `out` = lejek (albo punkt czekania) WYBRANEGO stanowiska — pętla zostawiła w nim ostatnie sprawdzane.
  if (best) {
    const inb = best.inbound;
    dockLocalToGame(dock, best.funnel ? best.funnel[0] : inb[0], best.funnel ? best.funnel[1] : inb[1], out);
  }
  return best;
}

/** Stanowisko portu bańki najbliższe (x, y): zatoki przed halami K-7. */
function nearestPortBerth(berths, x, y) {
  let best = null;
  let bestD2 = Infinity;
  let bay = null;
  let bayD2 = Infinity;
  for (const b of berths) {
    if (!Number.isFinite(b?.x) || !Number.isFinite(b?.y)) continue;
    const dx = b.x - x;
    const dy = b.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = b; }
    if (b.hall !== 'K-7' && d2 < bayD2) { bayD2 = d2; bay = b; }
  }
  return bay || best;
}

/**
 * Trasa kapsuły z (ax, ay) do stacji `station` w `path` (bufor `portPaths`: punkt 0 = start). Zwraca true, gdy jest
 * trasa (co najmniej jeden punkt po starcie).
 */
export function routeEscapePod(router, path, ax, ay, station, tune = POD_ROUTE_TUNE) {
  pathReset(path, ax, ay);
  if (!station || !Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
  const id = String(station.id);
  const rings = router.rings;
  const discs = router.discs;
  const dock = router.dockByStation.get(id);
  if (dock) {
    const q = router._p;
    const b = nearestDockBerth(dock, ax, ay, q);
    if (b) {
      // Do lejka (za dyskiem zapasu) objazdem, potem korytarzem stanowiska do pola.
      routeAroundDiscs(path, rings, discs, ax, ay, q.x, q.y, Infinity, 0);
      const inb = b.inbound;
      for (let k = 0; k + 2 < inb.length; k += 3) {
        dockLocalToGame(dock, inb[k], inb[k + 1], q);
        pathPush(path, q.x, q.y, tune.dockLaneSpeed, 0);
      }
      return path.count > 1;
    }
  }
  const berths = router.portByStation.get(id);
  if (berths) {
    const b = nearestPortBerth(berths, ax, ay);
    if (b) {
      routeAroundDiscs(path, rings, discs, ax, ay, b.x, b.y, tune.ringPortSpeed, 0);
      return path.count > 1;
    }
  }
  routeAroundDiscs(path, rings, discs, ax, ay, station.x, station.y, Infinity, 0);
  return path.count > 1;
}

export { PATH_STRIDE as POD_PATH_STRIDE };
