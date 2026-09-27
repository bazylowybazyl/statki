// Budowle portowe (Z7) w świecie: ramka układu, przejście do układu gry,
// adapter do ruchu v2 (format `buildStationDocks` z dockLayout.js — ten sam, co
// haloPortTraffic.js dla hal K-7 i zatok) i świat kolizji. Czysta matematyka.
//
// Ramka = kształt k7Frame (haloPortK7Layout.js): { origin, tx, ty (oś x układu),
// rx, ry (oś z układu) } w układzie SCENY gospodarza (x, −y gry). Na ringu:
// k7Frame(ringLayout, kąt) — z układu = promieniowo na zewnątrz, tył na płycie
// portu na podłodze; gospodarz = grupa ringu (środek planety). Na megadoku (Z8):
// portModuleFrame(x, y, kąt) wokół stacji; gospodarz = środek stacji.
// Do układu gry: (stacja.x + X, stacja.y − Y), kąty z przeciwnym znakiem
// (Three odwraca oś y gry) — dokładnie jak haloPortTraffic.js. Ring obrócony
// (Mars −π): ramka ruchu z kątem + obrót grupy (haloRingRotation), ramka renderu
// bez niego (render siedzi w obróconej grupie).
import {
  K7CollisionWorld,
  k7BoxPoly,
  k7Frame,
  k7HeadingToWorld,
  k7HubToWorld,
  k7WorldToHub
} from '../haloRing/haloPortK7Layout.js';
import { BERTH_CLASSES, BERTH_ROLE } from '../../game/traffic/dockLayout.js';
import { shipyardSolidList } from './portShipyardLayout.js';
import { hangarSolidList } from './portHangarLayout.js';

/**
 * Rola stanowisk suchego doku: ani terminal (`civil`), ani postój floty
 * (`military`) — findBerth z rolą ich nie wybiera, placeFleetStock też nie.
 * Remont / przezbrojenie przydziela gracz albo przyszły dyspozytor napraw.
 */
export const PORT_SERVICE_ROLE = 'service';

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const SIZE_TO_CLASS = Object.freeze({ CAPITAL: 'capital', L: 'l', M: 'm', S: 's', MEGA: 'mega', SLIP: 'l' });

/**
 * Ramka budowli w wolnym miejscu (megadok, stacja bez ringu, demo): początek
 * (x, y) w układzie sceny gospodarza, `angle` — kierunek osi z układu (przód
 * budowli, w kosmos) w scenie. Kształt jak k7Frame (floorR = 0: bez krzywizny).
 */
export function portModuleFrame(x = 0, y = 0, angle = Math.PI / 2) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { angle, radius: 0, origin: { x: Number(x) || 0, y: Number(y) || 0 }, tx: -s, ty: c, rx: c, ry: s, floorZ: 0, rimZ: 0, floorR: 0 };
}

/**
 * Ramka budowli na ringu pod kątem `theta` (układ lokalny ringu, jak hale K-7):
 * tył układu (z = K7_PLACEMENT.backZ) na płycie portu na podłodze habitatu.
 * `rotation` — obrót grupy ringu (tylko dla ramki ruchu/kolizji w układzie gry).
 */
export function portRingModuleFrame(ringLayout, theta, rotation = 0) {
  return k7Frame(ringLayout, theta + (Number(rotation) || 0));
}

/** Macierz układ → scena gospodarza (kolumnami, jak Matrix4.elements): hub huba K-7. */
export function portHubMatrixElements(frame) {
  return [frame.tx, frame.ty, 0, 0, 0, 0, 1, 0, frame.rx, frame.ry, 0, 0, frame.origin.x, frame.origin.y, 0, 1];
}

export function portHubToScene(frame, x, z, out = {}) {
  return k7HubToWorld(frame, x, z, out);
}

/** Punkt układu → układ gry (y w dół) względem stacji-gospodarza. */
export function portHubToGame(frame, station, x, z, out = {}) {
  const X = frame.origin.x + x * frame.tx + z * frame.rx;
  const Y = frame.origin.y + x * frame.ty + z * frame.ry;
  out.x = (Number(station?.x) || 0) + X;
  out.y = (Number(station?.y) || 0) - Y;
  return out;
}
/** Punkt gry → układ budowli. */
export function portGameToHub(frame, station, gx, gy, out = {}) {
  return k7WorldToHub(frame, gx - (Number(station?.x) || 0), (Number(station?.y) || 0) - gy, out);
}
/** Kurs w układzie (od +x ku +z) → kąt w grze. */
export function portHeadingToGame(frame, heading) {
  return wrapPi(-k7HeadingToWorld(frame, heading));
}

function trafficBerth(b, dockId, role, frame, station, extra) {
  const cls = BERTH_CLASSES[SIZE_TO_CLASS[b.size] || 'capital'];
  const pos = portHubToGame(frame, station, b.x, b.z);
  const ap = b.approach?.from || b.launch?.to || { x: b.x, z: b.z };
  const app = portHubToGame(frame, station, ap.x, ap.z);
  return {
    id: `${dockId}:${b.id}`, dockId, cls: cls.id, rank: cls.rank, role,
    length: cls.length, width: cls.width, maxLength: b.maxLength, maxBeam: b.maxBeam,
    lx: b.x, ly: b.z, heading: b.angle, side: b.side ?? 0,
    x: pos.x, y: pos.y, angle: portHeadingToGame(frame, b.angle),
    approachX: app.x, approachY: app.y,
    freeAt: 0, occupantId: null,
    external: false, moduleBerthId: b.id,
    ...extra
  };
}

/**
 * Budowla w formacie ruchu v2. `layout` — createShipyardLayout / createHangarLayout,
 * opcje: frame (ramka w układzie gry — patrz portRingModuleFrame z obrotem),
 * station ({ x, y } gry — środek gospodarza), stationId, role (suchy dok,
 * domyślnie PORT_SERVICE_ROLE).
 * Wynik: {
 *   docks:   [dok z berths] — tylko to, na czym się cumuje (suchy dok);
 *            findBerth / reserveBerth / berthOccupancy biorą go bez zmian,
 *   yards:   [pochylnia: pozycja kadłuba, kurs zejścia, punkt zejścia] — stocznia,
 *   hangars: [{ id, capacity, entry, exit, queue }] — hangar (wejście = punkt
 *            przechwytu pod dachem: `buildPortParking(…, { hangar: { x, y, capacity } })`),
 *   solids:  [{ id, points: [{x, y}] (gra), y0, y1, door? }] — kolizje
 * }
 */
export function portModuleTraffic(layout, options = {}) {
  const frame = options.frame;
  if (!layout || !frame) return null;
  const station = options.station || { x: 0, y: 0 };
  const sid = String(options.stationId || station.id || 'port');
  const out = { stationId: sid, moduleId: layout.id, kind: layout.kind, docks: [], yards: [], hangars: [], solids: [] };
  const origin = portHubToGame(frame, station, 0, layout.backZ || 0);
  const axis = Math.atan2(-frame.ty, frame.tx);
  if (layout.kind === 'shipyard') {
    const role = options.role || PORT_SERVICE_ROLE;
    const dockBerth = layout.berths.find((b) => b.kind === 'drydock');
    if (dockBerth) {
      const dockId = `${sid}:${dockBerth.id}`;
      const d = layout.drydock;
      const c = portHubToGame(frame, station, d.x, (d.z0 + d.z1) / 2);
      out.docks.push({
        id: dockId, stationId: sid, kind: 'drydock', role, module: layout.id,
        x: c.x, y: c.y, angle: axis, length: 2 * d.halfWidth, width: d.z1 - d.z0,
        attachedToRing: frame.floorR > 0,
        berths: [trafficBerth(dockBerth, dockId, role, frame, station, { service: 'drydock', hall: 'SUCHY DOK' })]
      });
    }
    for (const b of layout.berths) {
      if (b.kind !== 'slip') continue;
      const p = portHubToGame(frame, station, b.x, b.z);
      const to = portHubToGame(frame, station, b.launch.to.x, b.launch.to.z);
      out.yards.push({
        id: `${sid}:${b.id}`, stationId: sid, module: layout.id, slipIndex: b.slipIndex,
        x: p.x, y: p.y, angle: portHeadingToGame(frame, b.angle),
        length: b.padLength, beam: b.padBeam, maxLength: b.maxLength, maxBeam: b.maxBeam,
        launchX: to.x, launchY: to.y
      });
    }
  } else if (layout.kind === 'hangar') {
    const bin = layout.berths.find((b) => b.kind === 'hangar-in');
    const bout = layout.berths.find((b) => b.kind === 'hangar-out');
    const e = portHubToGame(frame, station, bin.x, bin.z);
    const ef = portHubToGame(frame, station, bin.approach.from.x, bin.approach.from.z);
    const x = portHubToGame(frame, station, bout.x, bout.z);
    const xt = portHubToGame(frame, station, bout.launch.to.x, bout.launch.to.z);
    out.hangars.push({
      id: `${sid}:${layout.id}`, stationId: sid, module: layout.id,
      x: e.x, y: e.y, origin,
      capacity: layout.capacity.total, capacityByClass: { ...layout.capacity },
      entry: { x: e.x, y: e.y, angle: portHeadingToGame(frame, bin.angle), fromX: ef.x, fromY: ef.y, maxLength: bin.maxLength, maxBeam: bin.maxBeam, capture: { ...bin.capture } },
      exit: { x: x.x, y: x.y, angle: portHeadingToGame(frame, bout.angle), toX: xt.x, toY: xt.y },
      queue: layout.queue.slots.map((s) => {
        const p = portHubToGame(frame, station, s.x, s.z);
        return { index: s.index, x: p.x, y: p.y, angle: portHeadingToGame(frame, s.angle) };
      })
    });
  }
  for (const s of portModuleSolids(layout)) {
    const poly = k7BoxPoly(s.x, s.z, s.w, s.d, s.angle || 0);
    out.solids.push({
      id: `${layout.id} ${s.id}`,
      points: poly.map((p) => portHubToGame(frame, station, p.x, p.z)),
      y0: s.y - s.h / 2, y1: s.y + s.h / 2,
      ...(s.door ? { door: true, side: s.side } : {})
    });
  }
  return out;
}

/** Bryły budowli (układ lokalny, wysokości K-7) — wspólne źródło renderu i kolizji. */
export function portModuleSolids(layout) {
  if (layout?.kind === 'shipyard') return shipyardSolidList(layout);
  if (layout?.kind === 'hangar') return hangarSolidList(layout);
  return [];
}

/**
 * Świat kolizji budowli w jej układzie (K7CollisionWorld — SAT jak w hali K-7).
 * Skrzydła drzwi suchego doku to przedmioty ruchome: `setDoorsOpen(col, true)`
 * wyłącza je (refresh z off), statek wlatuje.
 */
export function buildPortModuleCollision(layout) {
  const col = new K7CollisionWorld();
  col.doors = [];
  for (const s of portModuleSolids(layout)) {
    const item = col.addBox(s.id, s.x, s.z, s.w, s.d, s.angle || 0, s.y - s.h / 2, s.y + s.h / 2);
    if (s.door) col.doors.push(item);
  }
  return col;
}
export function setPortModuleDoorsOpen(col, open) {
  for (const item of col?.doors || []) col.refresh(item, !!open);
}

/** Obrys budowli (układ gry) — np. do czynnika „w porcie” modelu lotu i kamery. */
export function portModuleFootprintGame(layout, frame, station) {
  return (layout.footprint || []).map(([x, z]) => portHubToGame(frame, station, x, z));
}

export { BERTH_ROLE };
