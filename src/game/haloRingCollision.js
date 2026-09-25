// Ring „Halo” jako przeszkoda w płaszczyźnie gry (port do gry 2026-09-25) —
// czysta matematyka, bez Three. Źródło: dema/halo_ring_k7_flight.js
// (_groundConstraint) i haloPortDocking.js (buildPortCollision).
//
// Płaszczyzna gry (z = 0) przecina podłogę habitatu w połowie szerokości
// wstęgi (decyzja użytkownika 2026-09-23), więc płyta [kadłub ringu, podłoga +
// teren] jest ścianą — góry na z = 0 też. Przez ring prowadzą tylko 4 tranzyty
// (tunele w płycie: korytarz bez płyty, ściany i portale w świecie portu).
//
//  - płyta: każdy statek przy ringu (gracz, NPC); wierzchołki obwiedni kadłuba
//    nie wchodzą w płytę — wypchnięcie promieniowe na stronę środka statku
//    (habitat albo planeta), prędkość w głąb płyty zerowana (bez odbicia);
//  - ściany portu (hale K-7, zatoki, tunele tranzytów): wypychanie wektorem
//    najmniejszej penetracji (SAT) — tylko statki graczy (NPC do hal nie
//    wlatują; ruch v2 dołoży je osobno).
//
// Zero alokacji na krok: bufory wielokątów i wyniki w obiekcie kolidera.
import { HALO_TRANSIT, haloPortComplexAngles, haloTransitAngles } from '../3d/haloRing/haloRingConfig.js';
import { K7_HEIGHTS, createK7Layout, k7Frame } from '../3d/haloRing/haloPortK7Layout.js';
import { haloBayLayouts } from '../3d/haloRing/haloPortBays.js';
import { buildPortCollision, createPortRegistry } from '../3d/haloRing/haloPortDocking.js';
import {
  createHaloRingPlacement,
  haloGameToLocal,
  haloLocalToGameVec,
  haloRingLayoutFor
} from './haloRingPlanets.js';

export const HALO_COLLISION = Object.freeze({
  clearance: 14,        // odstęp kadłuba od płyty (jak w demie lotu)
  padHeight: 7,         // płyty portu nad podłogą; teren niżej (woda) = płasko
  terrainReach: 1400,   // nad podłogą dalej niż to teren już nie sięga (góry ≤ ~900)
  hullReach: 400,       // pod kadłubem ringu (strona planety) margines testu
  wallSlop: 1.0,        // wypchnięcie z płyty i ścian odrobinę dalej niż penetracja
  wallIterations: 3,
  shipPoints: 8         // obwiednia statku: prostokąt z fazami albo ośmiokąt
});

const TAU = Math.PI * 2;

function makePoints(n) {
  return Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
}

// Obwiednia statku w świecie gry: prostokąt długość × szerokość (fazowane
// narożniki, 8 punktów) albo ośmiokąt z promienia. `angle` — kurs w grze.
export function haloShipOutline(ship, out) {
  const px = ship.pos.x;
  const py = ship.pos.y;
  const w = Number(ship.w);
  const h = Number(ship.h);
  const n = out.length;
  if (w > 0 && h > 0) {
    const a = Number(ship.angle) || 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const hw = w * 0.5;
    const hh = h * 0.45;
    const cw = hw * 0.82;
    const ch = hh * 0.62;
    // dziób, burty, rufa — fazowany prostokąt (kadłuby są węższe na końcach)
    const pts = [[hw, ch], [cw, hh], [-cw, hh], [-hw, ch], [-hw, -ch], [-cw, -hh], [cw, -hh], [hw, -ch]];
    for (let i = 0; i < n; i++) {
      const [u, v] = pts[i % pts.length];
      out[i].x = px + u * c - v * s;
      out[i].y = py + u * s + v * c;
    }
    return Math.hypot(hw, hh);
  }
  const r = Math.max(20, Number(ship.radius) || 60);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    out[i].x = px + Math.cos(t) * r;
    out[i].y = py + Math.sin(t) * r;
  }
  return r;
}

// Minimalne rozsunięcie wielokątów wypukłych (SAT). Zwraca głębokość > 0 i
// kierunek (out.x, out.z) przesunięcia `a`, który je rozdziela; 0 = rozłączne.
export function haloSatPenetration(a, b, out) {
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (let k = 0; k < 2; k++) {
    const poly = k === 0 ? a : b;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      let nx = p.z - q.z;
      let nz = q.x - p.x;
      const len = Math.hypot(nx, nz);
      if (len < 1e-9) continue;
      nx /= len;
      nz /= len;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (let j = 0; j < a.length; j++) {
        const d = a[j].x * nx + a[j].z * nz;
        if (d < a0) a0 = d;
        if (d > a1) a1 = d;
      }
      for (let j = 0; j < b.length; j++) {
        const d = b[j].x * nx + b[j].z * nz;
        if (d < b0) b0 = d;
        if (d > b1) b1 = d;
      }
      if (a1 <= b0 || b1 <= a0) return 0;
      // dwie drogi rozsunięcia wzdłuż osi: w stronę −n albo +n
      const down = a1 - b0;
      const up = b1 - a0;
      if (down < up) {
        if (down < best) { best = down; bx = -nx; bz = -nz; }
      } else if (up < best) { best = up; bx = nx; bz = nz; }
    }
  }
  if (!Number.isFinite(best)) return 0;
  out.x = bx;
  out.z = bz;
  return best;
}

export class HaloRingCollider {
  // planet: obiekt planety gry (x, y, id); terrainHeightAt(lx, ly) — wysokość
  // terenu nad podłogą na z = 0 (układ lokalny ringu), null = płasko.
  constructor(planet, { terrainHeightAt = null } = {}) {
    this.place = createHaloRingPlacement(planet);
    if (!this.place) throw new Error('HaloRingCollider: planeta bez ringu');
    this.key = this.place.key;
    this.layout = haloRingLayoutFor(planet);
    this.terrainHeightAt = typeof terrainHeightAt === 'function' ? terrainHeightAt : null;
    const L = this.layout;
    this.back = L.radii.back;
    this.floorMid = L.radii.floorMid;
    // tranzyty: korytarz bez płyty (środek ściany tunelu włącznie)
    this.transitAngles = haloTransitAngles();
    this.transitHalf = (HALO_TRANSIT.halfWidth + HALO_TRANSIT.wall) / this.floorMid;
    // świat ścian portu w układzie huba hali gracza (kompleks 0)
    this.frame = k7Frame(L);
    const halls = haloPortComplexAngles().map((angle, index) => ({ index, frame: k7Frame(L, angle), layout: createK7Layout() }));
    const registry = createPortRegistry({ halls, bays: haloBayLayouts(L), frame: this.frame });
    // rejestr hal i zatok (obrysy w układzie huba) — też dla zaniku dachów w renderze
    this.registry = registry;
    this.walls = buildPortCollision({ registry, frame: this.frame, ringLayout: L });
    this.wallItems = this.walls.items.filter((it) => !(it.y1 < K7_HEIGHTS.hullBottom || it.y0 > K7_HEIGHTS.hullTop));
    // promieniowy zasięg ścian (hale sięgają najdalej: płyta przed bramą G-01)
    const hall = createK7Layout();
    this.wallsOuter = this.frame.radius + hall.frontZ + 600;
    this.wallsInner = this.back - 1200;
    // bufory
    this._outline = makePoints(HALO_COLLISION.shipPoints);
    this._local = makePoints(HALO_COLLISION.shipPoints);
    this._hub = makePoints(HALO_COLLISION.shipPoints);
    this._c = { x: 0, y: 0 };
    this._v = { x: 0, y: 0 };
    this._mtv = { x: 0, z: 0 };
    this._bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    this.result = { hit: false, floor: 0, walls: 0, impactSpeed: 0, lastWall: '' };
  }

  setPlanet(planet) {
    this.place.x = Number(planet?.x) || 0;
    this.place.y = Number(planet?.y) || 0;
  }

  setTerrain(fn) {
    this.terrainHeightAt = typeof fn === 'function' ? fn : null;
  }

  // Obwiednia statku w układzie huba hali gracza (bufor kolidera) — zanik
  // dachów hal i wycięcia górnej ściany w renderze.
  hubOutline(ship) {
    if (!ship?.pos) return null;
    haloShipOutline(ship, this._outline);
    const f = this.frame;
    for (let i = 0; i < this._outline.length; i++) {
      const p = haloGameToLocal(this.place, this._outline[i].x, this._outline[i].y, this._local[i]);
      const dx = p.x - f.origin.x;
      const dy = p.y - f.origin.y;
      this._hub[i].x = dx * f.tx + dy * f.ty;
      this._hub[i].z = dx * f.rx + dy * f.ry;
    }
    return this._hub;
  }

  _inTransit(lx, ly) {
    let th = Math.atan2(ly, lx);
    for (let i = 0; i < this.transitAngles.length; i++) {
      let d = th - this.transitAngles[i];
      d -= TAU * Math.round(d / TAU);
      if (Math.abs(d) < this.transitHalf) return true;
    }
    return false;
  }

  // Punkt świata gry w płycie ringu [kadłub, podłoga + teren] poza tranzytami
  // (pociski). Daleko od ringu: dwa mnożenia.
  pointInSlab(x, y) {
    const dx = x - this.place.x;
    const dy = y - this.place.y;
    const d2 = dx * dx + dy * dy;
    const outer = this.floorMid + HALO_COLLISION.terrainReach;
    if (d2 < this.back * this.back || d2 > outer * outer) return false;
    const p = haloGameToLocal(this.place, x, y, this._c);
    if (this._inTransit(p.x, p.y)) return false;
    const h = this.terrainHeightAt ? Number(this.terrainHeightAt(p.x, p.y)) || 0 : 0;
    return Math.sqrt(d2) <= this.floorMid + Math.max(HALO_COLLISION.padHeight, h);
  }

  // Wypchnięcie statku z płyty ringu i (walls = true) ze ścian portu.
  // Modyfikuje ship.pos i ship.vel; wynik w this.result (bez alokacji).
  constrainShip(ship, walls = false) {
    const res = this.result;
    res.hit = false;
    res.floor = 0;
    res.walls = 0;
    res.impactSpeed = 0;
    if (!ship?.pos) return res;
    const place = this.place;
    const c = haloGameToLocal(place, ship.pos.x, ship.pos.y, this._c);
    const rc = Math.hypot(c.x, c.y);
    const C = HALO_COLLISION;
    const reach = Math.max(Number(ship.radius) || 0, Math.hypot(Number(ship.w) || 0, Number(ship.h) || 0) * 0.5, 60);
    const nearFloor = rc < this.floorMid + C.terrainReach + reach && rc > this.back - C.hullReach - reach;
    const nearWalls = walls && rc < this.wallsOuter + reach && rc > this.wallsInner - reach;
    if (!nearFloor && !nearWalls) return res;
    haloShipOutline(ship, this._outline);
    if (nearFloor) this._floor(ship, rc, c);
    if (nearWalls) this._walls(ship);
    return res;
  }

  _floor(ship, rc, c) {
    const C = HALO_COLLISION;
    const back = this.back;
    const fm = this.floorMid;
    const place = this.place;
    const habitat = rc > (back + fm) * 0.5;
    const outline = this._outline;
    const local = this._local;
    let push = 0;
    for (let i = 0; i < outline.length; i++) {
      const p = haloGameToLocal(place, outline[i].x, outline[i].y, local[i]);
      const r = Math.hypot(p.x, p.y);
      if (r > fm + C.terrainReach || r < back - C.hullReach) continue;
      if (this._inTransit(p.x, p.y)) continue;
      if (habitat) {
        const h = this.terrainHeightAt ? Number(this.terrainHeightAt(p.x, p.y)) || 0 : 0;
        const g = fm + Math.max(C.padHeight, h) + C.clearance;
        if (r < g && g - r > push) push = g - r;
      } else {
        const g = back - C.clearance;
        if (r > g && g - r < push) push = g - r;
      }
    }
    if (push === 0 || rc < 1) return;
    // zapas: wierzchołki daleko kątowo od środka statku idą promieniowo odrobinę mniej
    push += Math.sign(push) * C.wallSlop;
    const ux = c.x / rc;
    const uy = c.y / rc;
    const d = haloLocalToGameVec(place, ux * push, uy * push, this._v);
    ship.pos.x += d.x;
    ship.pos.y += d.y;
    // prędkość w głąb płyty zerowana (kierunek wypchnięcia w grze)
    const n = haloLocalToGameVec(place, ux * Math.sign(push), uy * Math.sign(push), this._v);
    this._cancelInto(ship, n.x, n.y);
    this.result.hit = true;
    this.result.floor = Math.abs(push);
  }

  _walls(ship) {
    const C = HALO_COLLISION;
    const f = this.frame;
    const place = this.place;
    const outline = this._outline;
    const hub = this._hub;
    const mtv = this._mtv;
    const b = this._bounds;
    for (let iter = 0; iter < C.wallIterations; iter++) {
      // obwiednia w układzie huba (po poprzednim wypchnięciu przeliczana)
      b.minX = Infinity; b.maxX = -Infinity; b.minZ = Infinity; b.maxZ = -Infinity;
      for (let i = 0; i < outline.length; i++) {
        const p = haloGameToLocal(place, outline[i].x, outline[i].y, this._local[i]);
        const dx = p.x - f.origin.x;
        const dy = p.y - f.origin.y;
        const h = hub[i];
        h.x = dx * f.tx + dy * f.ty;
        h.z = dx * f.rx + dy * f.ry;
        if (h.x < b.minX) b.minX = h.x;
        if (h.x > b.maxX) b.maxX = h.x;
        if (h.z < b.minZ) b.minZ = h.z;
        if (h.z > b.maxZ) b.maxZ = h.z;
      }
      let depth = 0;
      let dirX = 0;
      let dirZ = 0;
      let hitId = '';
      const items = this.wallItems;
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        const ib = it.bounds;
        if (b.maxX < ib.minX || b.minX > ib.maxX || b.maxZ < ib.minZ || b.minZ > ib.maxZ) continue;
        const d = haloSatPenetration(hub, it.polygon, mtv);
        if (d > depth) { depth = d; dirX = mtv.x; dirZ = mtv.z; hitId = it.id; }
      }
      if (depth <= 0) break;
      const move = depth + C.wallSlop;
      // hub → lokalny ringu → świat gry
      const lx = (dirX * f.tx + dirZ * f.rx) * move;
      const ly = (dirX * f.ty + dirZ * f.ry) * move;
      const d = haloLocalToGameVec(place, lx, ly, this._v);
      ship.pos.x += d.x;
      ship.pos.y += d.y;
      for (let i = 0; i < outline.length; i++) { outline[i].x += d.x; outline[i].y += d.y; }
      const n = haloLocalToGameVec(place, dirX * f.tx + dirZ * f.rx, dirX * f.ty + dirZ * f.ry, this._v);
      this._cancelInto(ship, n.x, n.y);
      this.result.hit = true;
      this.result.walls = Math.max(this.result.walls, depth);
      this.result.lastWall = hitId;
    }
  }

  // Zeruje składową prędkości skierowaną przeciw normalnej (nx, ny) — w głąb przeszkody.
  _cancelInto(ship, nx, ny) {
    const v = ship.vel;
    if (!v) return;
    const len = Math.hypot(nx, ny) || 1;
    const ux = nx / len;
    const uy = ny / len;
    const vn = v.x * ux + v.y * uy;
    if (vn < 0) {
      v.x -= vn * ux;
      v.y -= vn * uy;
      if (-vn > this.result.impactSpeed) this.result.impactSpeed = -vn;
    }
  }
}
