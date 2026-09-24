// Port K-7 („Central Hub K-7” z dema ECUMENE, dema/orbital_ring_gameplay_hub_v3.html)
// przeniesiony na ring „Halo” jako dok GAMEPLAYOWY portu Kepler (decyzja
// użytkownika 2026-09-23: port ringu zastępuje stację; K-7 ma zostać — wygląd
// i rozgrywka). Czysta matematyka, bez Three: układ hali, stanowiska, bramy,
// pasy, kolizje (wielokąty wypukłe, SAT), automat dokowania i referencyjny
// model lotu z dema K-7 (NIE thrusterModel.js gry — przy porcie podpiąć napęd gry).
//
// Układ lokalny huba jak w K-7: x wzdłuż ringu, z promieniowo NA ZEWNĄTRZ
// (tył hali na podłodze habitatu, brama główna daleko od niej), y = wysokość
// nad pokładem. Płaszczyzna lotu gry (z = 0 świata) = szczyt kadłuba K-7
// (y = 116) = środek szerokości wstęgi (flightLevel 0,5): hala jest WPIĘTA
// W PODŁOGĘ na środku habitatu (poprawka użytkownika 2026-09-23 — wcześniej
// wisiała na moście przy dachu).
import { HALO_PORT, HALO_STATION_ANGLE } from './haloRingConfig.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
export const k7Phase = (time, a, b) => smooth(clamp((time - a) / (b - a), 0, 1));
export const k7AngleDelta = (a, b) => ((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const approach = (v, target, rate, dt) => mix(v, target, 1 - Math.exp(-rate * dt));

// Wysokości K-7 (y nad pokładem): kadłub 48–116, lot na 76.
export const K7_HEIGHTS = Object.freeze({ hullBottom: 48, hullTop: 116, flightY: 76 });
// Nad płaszczyzną lotu wysokości ściśnięte: kamera gry przy zoomie 3,2 wisi
// 535 j. nad z = 0 (near 100), a K-7 ma sufit na 711–793 j. — bez ścisku
// dach i suwnice wchodziłyby w kamerę. Pod płaszczyzną skala 1:1.
export const K7_ABOVE_SCALE = 0.42;
export function k7HeightToZ(y) {
  const d = y - K7_HEIGHTS.hullTop;
  return d > 0 ? d * K7_ABOVE_SCALE : d;
}

// Atlas: getHullRenderSize('atlas', 3747, 1677) = 1800 × 806 (index.html ≈ :5563).
export const K7_ATLAS = Object.freeze({ w: 1800, h: 806 });
// Wypukła obwiednia kolizji prawdziwego Atlasa (ułamki w, h; +x = dziób) — z K-7.
export const K7_ATLAS_COLLISION = Object.freeze([
  [-0.467773, -0.028384], [-0.436523, -0.208515], [-0.405273, -0.282751], [-0.306152, -0.370087],
  [-0.154297, -0.370087], [0.142578, -0.322052], [0.442383, -0.122271], [0.464355, -0.073144],
  [0.476562, -0.031659], [0.476562, 0.027293], [0.463867, 0.073144], [0.44043, 0.121179],
  [0.141602, 0.318777], [-0.15625, 0.367904], [-0.306152, 0.366812], [-0.404785, 0.278384],
  [-0.436523, 0.20524], [-0.467773, 0.034934]
].map((p) => Object.freeze(p)));
// Wlewy paliwa na rufie (tankowanie od rufy — pomysł K-7).
export const K7_ATLAS_FUEL_PORTS = Object.freeze([-1, 1].map((side) => Object.freeze({
  side, x: -K7_ATLAS.w * 0.395, z: side * K7_ATLAS.h * 0.185, couplerY: K7_HEIGHTS.hullTop + 44
})));

export function k7FuelPortInBerth(berth, port) {
  const c = Math.cos(berth.angle);
  const s = Math.sin(berth.angle);
  return { x: berth.x + port.x * c - port.z * s, y: port.couplerY, z: berth.z + port.x * s + port.z * c };
}

// ---------------------------------------------------------------------------
// Układ hali (DockLayout z K-7). Od 2026-09-23 CZTERY stanowiska capital
// (decyzja użytkownika: port K-7 zastępuje dok ruchu v2 — stacja z ringiem ma
// tam 4 capital): hala szersza o dwa stanowiska (3600 → 5220), brama główna
// szersza (1500 → 3200), żeby każde stanowisko miało własny pas z bramy G-01.
// Grzebienie boczne, bramy logistyczne, pasy i obsługa — jak w K-7.
export const K7_CAPITAL_X = Object.freeze([-810, 810, -2430, 2430]);   // C-01..C-04
// Stanowiska grzebieni bocznych K-7 (pole, rozstaw, największy kadłub) — ten
// sam standard mają otwarte zatoki portu (haloPortBays.js).
export const K7_BANK_SLOTS = Object.freeze({
  L: Object.freeze({ size: 'L', padLength: 1000, padBeam: 660, pitch: 760, maxLength: 850, maxBeam: 500 }),
  M: Object.freeze({ size: 'M', padLength: 620, padBeam: 380, pitch: 440, maxLength: 500, maxBeam: 260 }),
  S: Object.freeze({ size: 'S', padLength: 400, padBeam: 250, pitch: 300, maxLength: 300, maxBeam: 180 })
});
export function createK7Layout() {
  const l = {
    id: 'K-7', height: 720, wallHeight: 620, wallThickness: 88,
    halfWidth: 5220, frontHalfWidth: 3200, backZ: 250, bodyEndZ: 6000, frontZ: 7400, apronDepth: 1180
  };
  l.footprint = [[-l.frontHalfWidth, l.frontZ], [l.frontHalfWidth, l.frontZ], [l.halfWidth, l.bodyEndZ],
    [l.halfWidth, l.backZ], [-l.halfWidth, l.backZ], [-l.halfWidth, l.bodyEndZ]];
  const center = { x: 0, z: (l.frontZ + l.backZ) / 2 };
  l.edges = l.footprint.map((a, i) => {
    const b = l.footprint[(i + 1) % l.footprint.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const ux = dx / length;
    const uz = dz / length;
    let nx = -uz;
    let nz = ux;
    const x = (a[0] + b[0]) / 2;
    const z = (a[1] + b[1]) / 2;
    if ((x - center.x) * nx + (z - center.z) * nz < 0) { nx = -nx; nz = -nz; }
    return { i, a, b, x, z, ux, uz, nx, nz, length, angle: Math.atan2(dz, dx) };
  });
  l.gates = [0, 1, 5].map((edge, i) => {
    const e = l.edges[edge];
    const jamb = i === 0 ? 110 : 135;
    return { ...e, id: ['G-01', 'G-02', 'G-03'][i], name: ['GLOWNY / CAPITAL', 'WSCHOD / LOGISTYKA', 'ZACHOD / LOGISTYKA'][i], jamb, clearWidth: e.length - 2 * jamb, edge };
  });
  l.berths = K7_CAPITAL_X.map((x, i) => ({
    id: 'C-0' + (i + 1), size: 'CAPITAL', x, z: 1900, width: 1330, length: 2380, padLength: 2380, padBeam: 1330,
    angle: -Math.PI / 2, maxLength: 2050, maxBeam: 1030, occupied: i === 0 ? 'player' : null
  }));
  // Grzebień jednej głębokości: każde boczne stanowisko cofa się z własnej alei.
  // Stanowiska wolne — zaparkowanych NPC z dema ECUMENE nie ma (2026-09-24:
  // statki i ruch z osobnego systemu, zajętość przyjdzie z ruchu v2).
  l.sideBankSpec = [
    { ...K7_BANK_SLOTS.L, count: 2 },
    { ...K7_BANK_SLOTS.M, count: 4 },
    { ...K7_BANK_SLOTS.S, count: 6 }
  ];
  l.sideBanks = [];
  for (const side of [-1, 1]) {
    const bankId = side < 0 ? 'W' : 'E';
    const bank = { id: bankId, side, aisleX: side * (l.halfWidth - 1500), aisleWidth: 720, z0: 650, z1: l.bodyEndZ - 130, berthIds: [] };
    let cursor = 650;
    for (const spec of l.sideBankSpec) {
      for (let i = 0; i < spec.count; i++) {
        const id = bankId + '-' + spec.size + String(i + 1).padStart(2, '0');
        const x = side * (l.halfWidth - 200 - spec.padLength / 2);
        const z = cursor + spec.padBeam / 2;
        const b = {
          id, size: spec.size, bankId, side, x, z, width: spec.padLength, length: spec.padBeam,
          padLength: spec.padLength, padBeam: spec.padBeam, angle: side < 0 ? Math.PI : 0,
          maxLength: spec.maxLength, maxBeam: spec.maxBeam, occupied: null,
          approach: { heading: side < 0 ? Math.PI : 0, from: { x: bank.aisleX, z }, to: { x, z }, width: spec.padBeam - 35 },
          servicePoint: { x: side * (l.halfWidth - 93), z: z - spec.padBeam * 0.28 }
        };
        l.berths.push(b);
        bank.berthIds.push(id);
        cursor += spec.pitch;
      }
    }
    l.sideBanks.push(bank);
  }
  for (const b of l.berths) {
    b.capture = { halfWidth: b.size === 'CAPITAL' ? 145 : 70, halfLength: b.size === 'CAPITAL' ? 180 : 55, maxSpeed: 30, maxAngle: 7 * Math.PI / 180 };
    b.reserved = b.occupied === 'player' ? 'player' : null;
    b.stopPoint = { x: b.x, z: b.z };
    b.serviceAnchors = b.size === 'CAPITAL' ? K7_ATLAS_FUEL_PORTS.map((port) => ({
      x: b.x + port.side * 615, z: b.z + 860, y: 224, side: port.side, port, target: k7FuelPortInBerth(b, port)
    })) : [];
  }
  l.lanes = l.berths.filter((b) => b.size === 'CAPITAL').map((b) => ({
    id: 'LANE-' + b.id, berthId: b.id, x: b.x, z0: b.z - 1200, z1: l.frontZ + l.apronDepth + 120, width: 1260,
    reserved: b.occupied === 'player' ? 'player' : null
  }));
  l.spawnPoint = { x: l.berths[0].x, z: l.berths[0].z, angle: l.berths[0].angle, berthId: 'C-01' };
  l.capacity = { CAPITAL: K7_CAPITAL_X.length, L: 4, M: 8, S: 12, total: l.berths.length };
  l.halfWidthAt = (z) => (z <= l.bodyEndZ ? l.halfWidth : mix(l.halfWidth, l.frontHalfWidth, clamp((z - l.bodyEndZ) / (l.frontZ - l.bodyEndZ), 0, 1)));
  return l;
}

// ---------------------------------------------------------------------------
// Osadzenie na ringu: hub przy kącie stacji Ziemi, ściana tylna hali (z huba
// = backZ) na płycie portu na podłodze habitatu, oś z promieniowo na zewnątrz.
// Hala przechodzi przez wąwóz habitatu (pod górną ścianą) i wychodzi poza
// krawędź ścian; stacja orbitalna znika (decyzja użytkownika), więc K-7 może
// sięgać przez jej orbitę.
export const K7_PLACEMENT = Object.freeze({
  angle: HALO_STATION_ANGLE,
  backZ: 250,           // createK7Layout().backZ — ta głębokość huba leży na podłodze
  padH: 7               // płyta portu nad podłogą bazową (haloRingWorldGen)
});

export function k7Frame(ringLayout, angle = K7_PLACEMENT.angle) {
  const floorR = ringLayout.radii.floorMid + K7_PLACEMENT.padH;
  const R0 = floorR - K7_PLACEMENT.backZ;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    angle,
    radius: R0,
    origin: { x: c * R0, y: s * R0 },
    tx: -s, ty: c,      // lokalne +x (wzdłuż ringu)
    rx: c, ry: s,       // lokalne +z (promieniowo na zewnątrz)
    floorZ: floorR - R0,                        // z huba powierzchni podłogi
    rimZ: ringLayout.radii.rim - R0,            // z huba krawędzi ścian habitatu
    floorR
  };
}

// Kołnierz K-7 na podłodze (słupy po bokach hali) — bryły w płaszczyźnie lotu,
// wspólne dla renderu i kolizji.
export function k7CollarPosts(l, floorZ = K7_PLACEMENT.backZ) {
  const w = HALO_PORT.collar + 100;
  const x0 = l.halfWidth + 50;
  return [-1, 1].map((side) => ({ side, x: side * (x0 + w * 0.5), z: floorZ + 90, w, d: 340 }));
}
export function k7HubToWorld(frame, x, z, out = {}) {
  out.x = frame.origin.x + x * frame.tx + z * frame.rx;
  out.y = frame.origin.y + x * frame.ty + z * frame.ry;
  return out;
}
export function k7WorldToHub(frame, wx, wy, out = {}) {
  const dx = wx - frame.origin.x;
  const dy = wy - frame.origin.y;
  out.x = dx * frame.tx + dy * frame.ty;
  out.z = dx * frame.rx + dy * frame.ry;
  return out;
}
// Kąt kursu w hubie (od +x ku +z) → kąt w płaszczyźnie XY świata.
export function k7HeadingToWorld(frame, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Math.atan2(c * frame.ty + s * frame.ry, c * frame.tx + s * frame.rx);
}

// ---------------------------------------------------------------------------
// Geometria płaska (bez alokacji w pętli fizyki: bufory wielokątów wielokrotnego użytku).
export function k7BoxPoly(x, z, w, d, angle = 0) {
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => ({ x: x + a * cs - b * sn, z: z + a * sn + b * cs }));
}
function polyBounds(p, out = {}) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < p.length; i++) {
    const q = p[i];
    if (q.x < minX) minX = q.x;
    if (q.z < minZ) minZ = q.z;
    if (q.x > maxX) maxX = q.x;
    if (q.z > maxZ) maxZ = q.z;
  }
  out.minX = minX; out.minZ = minZ; out.maxX = maxX; out.maxZ = maxZ;
  return out;
}
const boxesOverlap = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
export function k7ConvexOverlap(a, b) {
  for (let k = 0; k < 2; k++) {
    const poly = k === 0 ? a : b;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = p.z - q.z;
      const nz = q.x - p.x;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (let j = 0; j < a.length; j++) { const n = a[j].x * nx + a[j].z * nz; if (n < a0) a0 = n; if (n > a1) a1 = n; }
      for (let j = 0; j < b.length; j++) { const n = b[j].x * nx + b[j].z * nz; if (n < b0) b0 = n; if (n > b1) b1 = n; }
      if (a1 < b0 - 0.0001 || b1 < a0 - 0.0001) return false;
    }
  }
  return true;
}
function pointSegmentDistance(p, a, b) {
  const x = b.x - a.x;
  const z = b.z - a.z;
  const t = clamp(((p.x - a.x) * x + (p.z - a.z) * z) / (x * x + z * z || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * x, p.z - a.z - t * z);
}
export function k7PolygonDistance(a, b) {
  if (k7ConvexOverlap(a, b)) return 0;
  let d = Infinity;
  for (let k = 0; k < 2; k++) {
    const p = k === 0 ? a : b;
    const q = k === 0 ? b : a;
    for (let i = 0; i < p.length; i++) {
      for (let j = 0; j < q.length; j++) d = Math.min(d, pointSegmentDistance(p[i], q[j], q[(j + 1) % q.length]));
    }
  }
  return d;
}
// Kadłub (obwiednia × wymiary) w miejscu (x, z, kąt) — do bufora `out` (tablica punktów).
export function k7TransformHull(outline, w, h, x, z, angle, out) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i < outline.length; i++) {
    const u = outline[i][0] * w;
    const v = outline[i][1] * h;
    const o = out[i];
    o.x = x + u * c - v * s;
    o.z = z + u * s + v * c;
  }
  return out;
}
export function k7MakeHullBuffer(n = K7_ATLAS_COLLISION.length) {
  return Array.from({ length: n }, () => ({ x: 0, z: 0 }));
}

// Świat kolizji K-7 (w układzie huba). Zakres wysokości przedmiotu y0..y1
// (wysokości K-7) — mosty suwnic i dach nie należą do warstwy kolizji kadłuba.
export class K7CollisionWorld {
  constructor() {
    this.items = [];
    this.hits = 0;
    this.lastHit = '';
    this._bounds = {};
  }
  addBox(id, x, z, w, d, angle = 0, y0 = 0, y1 = 620) {
    const polygon = k7BoxPoly(x, z, w, d, angle);
    const item = { id, polygon, bounds: polyBounds(polygon), y0, y1 };
    this.items.push(item);
    return item;
  }
  addPolygon(id, polygon, y0 = 0, y1 = 150) {
    const item = { id, polygon, bounds: polyBounds(polygon), y0, y1 };
    this.items.push(item);
    return item;
  }
  // przedmiot ruchomy: po zmianie punktów wielokąta przeliczyć obwiednię;
  // off = true wyłącza przedmiot (np. statek systemu ruchu poza kadrem rozgrywki)
  refresh(item, off = false) {
    polyBounds(item.polygon, item.bounds);
    item.off = off;
  }
  test(poly, record = false) {
    const bounds = polyBounds(poly, this._bounds);
    for (let i = 0; i < this.items.length; i++) {
      const c = this.items[i];
      if (c.off || c.y1 < K7_HEIGHTS.hullBottom || c.y0 > K7_HEIGHTS.hullTop) continue;
      if (boxesOverlap(bounds, c.bounds) && k7ConvexOverlap(poly, c.polygon)) {
        if (record) { this.hits++; this.lastHit = c.id; }
        return c.id;
      }
    }
    return null;
  }
}

// Kolizje hali — te same bryły, które rysuje haloPortK7.js (addSolid w K-7).
// Wspólne źródło: k7SolidList() wylicza listę; render i kolizje biorą z niej.
export function k7SolidList(l) {
  const out = [];
  const add = (id, x, y, z, w, h, d, mat, angle = 0) => out.push({ id, x, y, z, w, h, d, mat, angle });
  // ściany z otworami bram + przypory
  for (const e of l.edges) {
    const gate = l.gates.find((g) => g.edge === e.i);
    const segments = gate ? [[0, gate.jamb], [e.length - gate.jamb, e.length]] : [[0, e.length]];
    for (const [s0, s1] of segments) {
      const x = e.a[0] + e.ux * (s0 + s1) / 2;
      const z = e.a[1] + e.uz * (s0 + s1) / 2;
      const len = s1 - s0;
      add('WALL-' + e.i, x, 290, z, len, 580, l.wallThickness, 'dark', e.angle);
      const count = Math.max(1, Math.floor(len / 390));
      for (let k = 0; k < count; k++) {
        const a = s0 + (k + 0.5) * (len / count);
        const px = e.a[0] + e.ux * a;
        const pz = e.a[1] + e.uz * a;
        if (len > 250) add('BUTTRESS-' + e.i + '-' + k, px + e.nx * 59, 215, pz + e.nz * 59, 40, 430, 150, 'dark', e.angle);
      }
    }
  }
  add('OPERATIONS CORE', 0, 159, 583, 309, 318, 370, 'dark');
  for (const bank of l.sideBanks) {
    const side = bank.side;
    for (let k = 0; k < 4; k++) add('CARGO ' + bank.id + '/' + k, side * (l.halfWidth - 1300 + k * 290), 61, 420, 222, 122, 200, k % 3 ? 'orange' : 'teal');
    for (const id of bank.berthIds) {
      const b = l.berths.find((v) => v.id === id);
      add('SERVICE ' + id, b.servicePoint.x, 79, b.servicePoint.z, 60, 158, 78, 'dark');
    }
  }
  for (const side of [-1, 1]) add('APPROACH BEACON ' + side, side * (l.frontHalfWidth + 160), 132, l.frontZ - 90, 87, 264, 96, 'dark');
  // słupy kołnierza na podłodze habitatu (poza halą, w płaszczyźnie lotu)
  for (const p of k7CollarPosts(l)) add('COLLAR ' + (p.side < 0 ? 'W' : 'E'), p.x, 300, p.z, p.w, 600, p.d, 'dark');
  return out;
}

export function buildK7Collision(l) {
  const col = new K7CollisionWorld();
  for (const s of k7SolidList(l)) col.addBox(s.id, s.x, s.z, s.w, s.d, s.angle, s.y - s.h / 2, s.y + s.h / 2);
  for (const b of l.berths) {
    if (b.size === 'CAPITAL') {
      // nogi suwnic i piedestały paliwowe
      for (const side of [-1, 1]) for (const z of [b.z - 1110, b.z + 1110]) col.addBox('CRANE LEG ' + b.id, b.x + side * 615, z, 92, 98, 0, 0, 468);
      for (const a of b.serviceAnchors) col.addBox('FUEL PEDESTAL ' + b.id + '/' + a.side, a.x, a.z, 120, 140, 0, 0, 278);
    }
  }
  return col;
}

// ---------------------------------------------------------------------------
// Referencyjny model lotu z dema K-7 (120 Hz). Interfejs: pos, vel, angle,
// angVel, input — przy porcie do gry zastąpić napędem gry. Kadłub dowolny
// (outline = obwiednia jak K7_ATLAS_COLLISION, tune = przyspieszenie,
// prędkości poza / w porcie, obrót); domyślnie Atlas z liczbami K-7.
export const K7_FLIGHT_TUNE = Object.freeze({ acc: 150, speed: 660, speedIn: 210, turn: 0.46, turnIn: 0.28, torque: 0.98 });
export class K7FlightModel {
  constructor(collision, spawn, size = K7_ATLAS, outline = K7_ATLAS_COLLISION, tune = K7_FLIGHT_TUNE) {
    this.collision = collision;
    this.size = size;
    this.outline = outline;
    this.tune = { ...K7_FLIGHT_TUNE, ...(tune || {}) };
    this.x = spawn.x;
    this.z = spawn.z;
    this.vx = 0;
    this.vz = 0;
    this.angle = spawn.angle;
    this.angVel = 0;
    this.fuel = 78;
    this.locked = true;
    this.thrust = 0;
    this.time = 0;
    this.lastCollisionAt = -99;
    this.input = { main: 0, retro: 0, torque: 0, brake: 0, boost: 0 };
    this._hull = k7MakeHullBuffer(outline.length);
    this.onNotice = null;
  }
  polygon(x = this.x, z = this.z, angle = this.angle) {
    return k7TransformHull(this.outline, this.size.w, this.size.h, x, z, angle, this._hull);
  }
  // inside ∈ [0,1]: 1 = w hali (niższe limity, większy opór)
  step(dt, inside) {
    this.time += dt;
    const input = this.input;
    if (this.locked) {
      this.vx = this.vz = this.angVel = 0;
      this.thrust = 0;
      return;
    }
    const T = this.tune;
    const drive = (input.main - input.retro * 0.78) * (this.fuel > 0 ? 1 : 0);
    const boost = input.boost && inside < 0.2 ? 2.35 : 1;
    this.thrust = approach(this.thrust, Math.max(0, drive) * boost, 7, dt);
    const acc = T.acc * boost;
    this.vx += Math.cos(this.angle) * drive * acc * dt;
    this.vz += Math.sin(this.angle) * drive * acc * dt;
    const drag = mix(0.18, 0.48, inside) + input.brake * 3.3;
    this.vx *= Math.exp(-drag * dt);
    this.vz *= Math.exp(-drag * dt);
    const speed = Math.hypot(this.vx, this.vz);
    const limit = mix(T.speed * boost, T.speedIn, inside);
    if (speed > limit) { this.vx *= limit / speed; this.vz *= limit / speed; }
    this.angVel += input.torque * T.torque * dt;
    this.angVel *= Math.exp(-(2.6 + input.brake * 3) * dt);
    const maxTurn = mix(T.turn, T.turnIn, inside);
    this.angVel = clamp(this.angVel, -maxTurn, maxTurn);
    const a = this.angle + this.angVel * dt;
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const col = this.collision;
    if (!col.test(this.polygon(nx, nz, a), true)) {
      this.x = nx; this.z = nz; this.angle = a;
    } else {
      if (!col.test(this.polygon(this.x, this.z, a))) this.angle = a; else this.angVel = 0;
      if (!col.test(this.polygon(nx, this.z, this.angle))) this.x = nx; else this.vx = 0;
      if (!col.test(this.polygon(this.x, nz, this.angle))) this.z = nz; else this.vz = 0;
      if (this.time - this.lastCollisionAt > 2.3) {
        this.onNotice?.('OGRANICZENIE KADLUBA / ' + col.lastHit);
        this.lastCollisionAt = this.time;
      }
    }
    this.angle = k7AngleDelta(this.angle, 0);
    this.fuel = Math.max(0, this.fuel - Math.abs(drive) * boost * 0.045 * dt);
  }
}

// Zanik dachu (RoofOcclusion z K-7): 1 = statek w hali / tuż przy niej.
export class K7RoofFade {
  constructor(footprintPoly) {
    this.footprint = footprintPoly;
    this.fade = 0;
    this.wasInside = false;
    this.distance = Infinity;
  }
  update(hull, dt, instant = false) {
    const d = k7PolygonDistance(hull, this.footprint);
    this.distance = d;
    if (d < 1) this.wasInside = true;
    if (this.wasInside && d > 380) this.wasInside = false;
    let target = this.wasInside ? 1 : 1 - smooth(clamp((d - 270) / 850, 0, 1));
    if (d === 0) target = 1;
    this.fade = instant ? target : approach(this.fade, target, 5.5, dt);
    if (Math.abs(this.fade - target) < 0.0004) this.fade = target;
    return this.fade;
  }
}

// ---------------------------------------------------------------------------
// Automat dokowania (K-7): FREE → DOCKING (9,3 s) → DOCKED → UNDOCKING (9,5 s) → FREE.
// Kolejność mechaniki wynika z faz czasu, nie z dociągania (hangar-dock-demo).
export const K7_CONNECTED_POSE = Object.freeze({ bridge: 1, trolley: 1, lower: 1, clamp: 1, extension: 1, lock: 1, flow: 1, vent: 0 });
export const K7_STOWED_POSE = Object.freeze({ bridge: 0, trolley: 0, lower: 0, clamp: 0, extension: 0, lock: 0, flow: 0, vent: 0 });

export class K7Docking {
  constructor(layout, player) {
    this.layout = layout;
    this.player = player;
    this.state = 'DOCKED';
    this.time = 0;
    this.berth = layout.berths[0];
    this.releasedBerth = null;
    this.startPose = { x: 0, z: 0, angle: 0 };
    this.detail = 'PALIWO / ZASILANIE / MOCOWANIA';
    this.progress = 1;
    this.sequence = 0;
    this.poses = new Map(layout.berths.filter((b) => b.size === 'CAPITAL').map((b) => [b.id, { ...K7_STOWED_POSE }]));
    Object.assign(this.poses.get(this.berth.id), K7_CONNECTED_POSE);
    player.locked = true;
    this.onNotice = null;
    this.onState = null;
    this._lanePoly = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
  }
  notice(text) { this.onNotice?.(text); }
  eligibility(b) {
    const p = this.player;
    const s = p.size;
    if (b.size !== 'CAPITAL' || b.maxLength < s.w || b.maxBeam < s.h) return { ok: false, reason: 'STANOWISKO ZA MALE' };
    if (b.occupied && b.occupied !== 'player') return { ok: false, reason: 'STANOWISKO ZAJETE' };
    if (b.reserved && b.reserved !== 'player') return { ok: false, reason: 'PAS ZAREZERWOWANY' };
    const c = b.capture;
    const dx = Math.abs(p.x - b.x);
    const dz = Math.abs(p.z - b.z);
    const angle = Math.abs(k7AngleDelta(p.angle, b.angle));
    const speed = Math.hypot(p.vx, p.vz);
    if (dx > c.halfWidth || dz > c.halfLength) return { ok: false, reason: 'USTAW SIE NA POLU STOP', dx, dz };
    if (angle > c.maxAngle) return { ok: false, reason: 'WYROWNAJ DZIOB DO WNETRZA', angle };
    if (speed > c.maxSpeed || Math.abs(p.angVel) > 0.07) return { ok: false, reason: 'WYHAMUJ / SPACJA', speed };
    return { ok: true, reason: 'DOKUJ ' + b.id };
  }
  candidate() {
    let best = null;
    let d = Infinity;
    for (const b of this.layout.berths) {
      if (b.size !== 'CAPITAL' || (b.occupied && b.occupied !== 'player')) continue;
      const distance = Math.hypot(this.player.x - b.x, this.player.z - b.z);
      if (distance < d) { d = distance; best = b; }
    }
    return best ? { berth: best, distance: d, ...this.eligibility(best) } : null;
  }
  requestDock() {
    if (this.state !== 'FREE') return false;
    const c = this.candidate();
    if (!c?.ok) { this.notice(c?.reason || 'BRAK WOLNEGO STANOWISKA'); return false; }
    this.berth = c.berth;
    this.berth.occupied = 'player';
    this.berth.reserved = 'player';
    const lane = this.layout.lanes.find((v) => v.berthId === this.berth.id);
    if (lane) lane.reserved = 'player';
    const p = this.player;
    p.locked = true;
    p.vx = p.vz = p.angVel = 0;
    this.startPose.x = p.x; this.startPose.z = p.z; this.startPose.angle = p.angle;
    this.setState('DOCKING');
    this.notice('PRZECHWYCENIE LOKALNE / ' + this.berth.id);
    return true;
  }
  requestUndock() {
    if (this.state !== 'DOCKED') return false;
    this.setState('UNDOCKING');
    this.notice('ODLACZANIE OBSLUGI. NAPED POZOSTAJE ZABLOKOWANY.');
    return true;
  }
  action() {
    return this.state === 'DOCKED' ? this.requestUndock() : this.state === 'FREE' ? this.requestDock() : false;
  }
  setState(state) {
    this.state = state;
    this.time = 0;
    this.progress = 0;
    this.onState?.(state, this.berth?.id ?? null);
  }
  _setPose(id, pose) {
    const target = this.poses.get(id);
    if (target) Object.assign(target, pose);
  }
  update(dt) {
    this.time += dt;
    const t = this.time;
    const p = this.player;
    const P = k7Phase;
    if (this.state === 'DOCKED') {
      p.locked = true;
      this.detail = p.fuel < 99.99 ? 'TANKOWANIE / LINIE PODLACZONE' : 'GOTOWY / LINIE PODLACZONE';
      p.fuel = Math.min(100, p.fuel + 3.5 * dt);
      this.progress = 1;
      this._setPose(this.berth.id, K7_CONNECTED_POSE);
      this.poses.get(this.berth.id).flow = p.fuel < 100 ? 1 : 0;
    } else if (this.state === 'DOCKING') {
      this.progress = clamp(t / 9.3, 0, 1);
      const f = P(t, 0, 1.1);
      p.x = mix(this.startPose.x, this.berth.x, f);
      p.z = mix(this.startPose.z, this.berth.z, f);
      p.angle = this.startPose.angle + k7AngleDelta(this.berth.angle, this.startPose.angle) * f;
      const pose = this.poses.get(this.berth.id);
      pose.bridge = P(t, 1.1, 3.4); pose.trolley = P(t, 3.4, 4.4); pose.lower = P(t, 4.4, 6.4); pose.clamp = P(t, 6.4, 7);
      pose.extension = P(t, 7, 8.7); pose.lock = P(t, 8.7, 9.3); pose.flow = 0; pose.vent = 0;
      this.detail = t < 1.1 ? 'PRECYZYJNE USTAWIENIE' : t < 3.4 ? 'PODJAZD MOSTU SUWNICY' : t < 4.4 ? 'POZYCJONOWANIE WOZKA'
        : t < 6.4 ? 'OPUSZCZANIE CHWYTAKOW' : t < 7 ? 'MOCOWANIE KADLUBA' : t < 8.7 ? 'ROZWIJANIE PRZEWODOW' : 'RYGLOWANIE ZLACZY';
      if (t >= 9.3) {
        this.sequence++;
        this.setState('DOCKED');
        this._setPose(this.berth.id, K7_CONNECTED_POSE);
        this.progress = 1;
        this.notice('ZADOKOWANO / ' + this.berth.id + ' / OBSLUGA AKTYWNA');
      }
    } else if (this.state === 'UNDOCKING') {
      this.progress = clamp(t / 9.5, 0, 1);
      const pose = this.poses.get(this.berth.id);
      pose.bridge = 1 - P(t, 8.2, 9.5); pose.trolley = 1 - P(t, 6.7, 8.2); pose.lower = 1 - P(t, 5, 6.7); pose.clamp = 1 - P(t, 4.4, 5);
      pose.extension = 1 - P(t, 2.2, 4.4); pose.lock = 1 - P(t, 1.4, 2.2); pose.flow = 0;
      pose.vent = t > 0.6 && t < 1.4 ? Math.sin((t - 0.6) / 0.8 * Math.PI) : 0;
      this.detail = t < 0.6 ? 'ODCIECIE PRZEPLYWU' : t < 1.4 ? 'KONTROLOWANY UPUST' : t < 2.2 ? 'ODRYGLOWANIE ZLACZY' : t < 4.4 ? 'ZWIJANIE PRZEWODOW'
        : t < 5 ? 'ZWALNIANIE MOCOWAN' : t < 6.7 ? 'PODNOSZENIE CHWYTAKOW' : t < 8.2 ? 'PARKOWANIE WOZKA' : 'ODSUNIECIE SUWNICY';
      if (t >= 9.5) {
        this._setPose(this.berth.id, K7_STOWED_POSE);
        this.berth.occupied = null;
        this.releasedBerth = this.berth;
        this.berth = null;
        p.locked = false;
        this.setState('FREE');
        this.detail = 'S / WYCOFAJ PO WLASNYM PASIE';
        this.notice('NAPED ODBLOKOWANY. S: WYCOFAJ W STRONE GLOWNEJ BRAMY.');
      }
    } else {
      this.progress = 0;
      this.detail = 'NAPED RECZNY';
      const b = this.releasedBerth;
      if (b) {
        const lane = this.layout.lanes.find((v) => v.berthId === b.id);
        if (p.z - p.size.w * 0.5 > lane.z1 || Math.abs(p.x - b.x) > b.width + p.size.w * 0.5) {
          b.reserved = null;
          lane.reserved = null;
          this.releasedBerth = null;
        }
      }
    }
    // rezerwacja pasa zwalnia się, gdy statek go opuści
    for (const lane of this.layout.lanes) {
      if (lane.reserved !== 'player' || lane.berthId === this.berth?.id) continue;
      const poly = this._lanePoly;
      const hw = lane.width / 2;
      const hz = (lane.z1 - lane.z0) / 2;
      const cz = (lane.z0 + lane.z1) / 2;
      poly[0].x = lane.x - hw; poly[0].z = cz - hz;
      poly[1].x = lane.x + hw; poly[1].z = cz - hz;
      poly[2].x = lane.x + hw; poly[2].z = cz + hz;
      poly[3].x = lane.x - hw; poly[3].z = cz + hz;
      if (!k7ConvexOverlap(p.polygon(), poly)) {
        lane.reserved = null;
        const b = this.layout.berths.find((v) => v.id === lane.berthId);
        b.reserved = null;
        if (this.releasedBerth === b) this.releasedBerth = null;
      }
    }
  }
  berthLampState(b) {
    return b.occupied ? 'occupied' : b.reserved ? 'reserved' : 'free';
  }
}

export const K7_TAU = TAU;
