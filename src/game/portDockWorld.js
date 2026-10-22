// Budowle doków portów bez ringu w grze (E14) — rozgrywka 2D: kolizje kadłubów (gracz, NPC, statki awansowane
// z bańki), pociski, tunelowanie w hipercruise, przeszkody autopilota i lista budowli dla obrazu.
//
// Dane przychodzą z workera ruchu (`TrafficV2.tables.bubbleDocks`: rodzaj, skład, środek, kąt, dysk zapasu) — gra
// liczy z nich TĘ SAMĄ geometrię co bańka i obraz (`src/3d/portDocks/portDockLayout.js`). Budowle są statyczne
// i niezniszczalne (jak płyta ringu): wypchnięcie kadłuba wektorem najmniejszej penetracji (SAT z obwiednią statku
// `haloShipOutline`), prędkość w głąb bryły zerowana, bez odbicia. Statki bańki ruchu nie potrzebują kolizji —
// ich ścieżki omijają bryły (`materializedFlight.js`, test `tests/portDocks.test.mjs`).
//
// Zero alokacji na krok: obwiednie i wyniki w buforach obiektu, bryły z prostokątem ograniczającym liczone raz.
import { buildPortDockGeometry, portDockSolidsInGame } from '../3d/portDocks/portDockLayout.js';
import { haloShipOutline, haloSatPenetration } from './haloRingCollision.js';
import { PORT_DOCK_KIND_IDS, BERTH_MIX_IDS, PORT_DOCK_STYLE_IDS } from '../data/portDocks.js';

export const PORT_DOCK_COLLISION = Object.freeze({
  slop: 1.0,          // wypchnięcie odrobinę dalej niż penetracja
  iterations: 3,
  shipPoints: 8
});

function makePoints(n, key = 'y') {
  return Array.from({ length: n }, () => (key === 'z' ? { x: 0, z: 0 } : { x: 0, y: 0 }));
}

/** Punkt w wielokącie wypukłym (punkty {x, z}, dowolny obieg). */
function pointInConvex(poly, x, y) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const c = (q.x - p.x) * (y - p.z) - (q.z - p.z) * (x - p.x);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Odcinek AB przecina wielokąt wypukły (koniec w środku albo przecięcie krawędzi). */
function segmentHitsConvex(poly, ax, ay, bx, by) {
  if (pointInConvex(poly, bx, by) || pointInConvex(poly, ax, ay)) return true;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const d1 = (bx - ax) * (p.z - ay) - (by - ay) * (p.x - ax);
    const d2 = (bx - ax) * (q.z - ay) - (by - ay) * (q.x - ax);
    if ((d1 > 0) === (d2 > 0)) continue;
    const d3 = (q.x - p.x) * (ay - p.z) - (q.z - p.z) * (ax - p.x);
    const d4 = (q.x - p.x) * (by - p.z) - (q.z - p.z) * (bx - p.x);
    if ((d3 > 0) !== (d4 > 0)) return true;
  }
  return false;
}

export class PortDockWorld {
  constructor() {
    /** Budowle: `{ stationId, kind, spec, x, y, angle, keepR, style, solids: [{ tag, poly: [{x, z}], minX… }] }`. */
    this.docks = [];
    this.version = -1;
    this._outline = makePoints(PORT_DOCK_COLLISION.shipPoints);
    this._poly = makePoints(PORT_DOCK_COLLISION.shipPoints, 'z');
    this._mtv = { x: 0, z: 0 };
    this.result = { hit: false, depth: 0, impactSpeed: 0, stationId: '' };
  }

  get count() { return this.docks.length; }

  /** Tabela z workera ruchu (`bubbleDocks`) → budowle; przebudowa tylko przy nowej wersji. */
  sync(table, version) {
    if (version === this.version) return false;
    this.version = version;
    this.docks.length = 0;
    if (!table) return true;
    for (const [stationId, d] of Object.entries(table)) {
      if (!d || !PORT_DOCK_KIND_IDS.includes(d.kind)) continue;
      const spec = { kind: d.kind, mix: d.mix, repeats: d.repeats, dockCount: d.dockCount };
      const geometry = buildPortDockGeometry(spec);
      const frame = { x: Number(d.x) || 0, y: Number(d.y) || 0, angle: Number(d.angle) || 0 };
      const solids = portDockSolidsInGame(geometry, frame).map((s) => ({
        tag: s.tag, poly: s.points.map((p) => ({ x: p.x, z: p.y })),
        minX: s.minX, maxX: s.maxX, minY: s.minY, maxY: s.maxY
      }));
      const style = PORT_DOCK_STYLE_IDS.includes(d.style) ? d.style : 'earth';
      this.docks.push({
        stationId, kind: d.kind, spec, ...frame, keepR: geometry.keepR, style, geometry, solids,
        // Indeksy dla bloku migawki (stała kolejność tabel po obu stronach szwu).
        kindIndex: PORT_DOCK_KIND_IDS.indexOf(d.kind),
        mixIndex: Math.max(0, BERTH_MIX_IDS.indexOf(typeof d.mix === 'string' ? d.mix : 'default')),
        styleIndex: PORT_DOCK_STYLE_IDS.indexOf(style)
      });
    }
    return true;
  }

  /** Budowla, w której dysku zapasu (+ zapas) leży punkt; `null` — żadna. */
  dockAt(x, y, pad = 0) {
    for (const d of this.docks) {
      const r = d.keepR + pad;
      const dx = x - d.x;
      const dy = y - d.y;
      if (dx * dx + dy * dy < r * r) return d;
    }
    return null;
  }

  /** Pocisk: punkt w bryle doku. Daleko od budowli — jedno porównanie na dok. */
  pointInSolid(x, y) {
    for (const d of this.docks) {
      const dx = x - d.x;
      const dy = y - d.y;
      if (dx * dx + dy * dy > d.keepR * d.keepR) continue;
      for (const s of d.solids) {
        if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
        if (pointInConvex(s.poly, x, y)) return true;
      }
    }
    return false;
  }

  /** Odcinek (ax, ay) → (bx, by) przecina bryłę doku (bezpiecznik hipercruise'u i teleportu). */
  segmentHitsSolid(ax, ay, bx, by) {
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    for (const d of this.docks) {
      if (maxX < d.x - d.keepR || minX > d.x + d.keepR || maxY < d.y - d.keepR || minY > d.y + d.keepR) continue;
      for (const s of d.solids) {
        if (maxX < s.minX || minX > s.maxX || maxY < s.minY || minY > s.maxY) continue;
        if (segmentHitsConvex(s.poly, ax, ay, bx, by)) return true;
      }
    }
    return false;
  }

  /**
   * Wypchnięcie kadłuba z brył doków (`ship`: `pos`, `vel`, `angle`, `w` × `h` albo `radius` — jak kolider ringu).
   * Zmienia `ship.pos` i `ship.vel`; wynik w `this.result` (bez alokacji). Daleko od budowli: porównanie na dok.
   */
  constrainShip(ship) {
    const res = this.result;
    res.hit = false;
    res.depth = 0;
    res.impactSpeed = 0;
    res.stationId = '';
    if (!ship?.pos || !this.docks.length) return res;
    const reach = Math.max(Number(ship.radius) || 0, Math.hypot(Number(ship.w) || 0, Number(ship.h) || 0) * 0.5, 60);
    for (const d of this.docks) {
      const dx = ship.pos.x - d.x;
      const dy = ship.pos.y - d.y;
      const r = d.keepR + reach;
      if (dx * dx + dy * dy > r * r) continue;
      this._constrainIn(ship, d, reach);
    }
    return res;
  }

  /** Najgłębsza penetracja obwiedni kadłuba w bryłę budowli `d` (kierunek wyjścia w `_mtv`); 0 — wolny. */
  _deepest(ship, d) {
    const outline = this._outline;
    const poly = this._poly;
    const mtv = this._mtv;
    haloShipOutline(ship, outline);
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i];
      poly[i].x = p.x;
      poly[i].z = p.y;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    let depth = 0;
    let dirX = 0;
    let dirY = 0;
    for (const s of d.solids) {
      if (maxX < s.minX || minX > s.maxX || maxY < s.minY || minY > s.maxY) continue;
      const pen = haloSatPenetration(poly, s.poly, mtv);
      if (pen > depth) { depth = pen; dirX = mtv.x; dirY = mtv.z; }
    }
    mtv.x = dirX;
    mtv.z = dirY;
    return depth;
  }

  _constrainIn(ship, d, reach) {
    const C = PORT_DOCK_COLLISION;
    const mtv = this._mtv;
    let depth = 0;
    for (let iter = 0; iter < C.iterations; iter++) {
      depth = this._deepest(ship, d);
      if (depth <= 0) break;
      const move = depth + C.slop;
      const dirX = mtv.x;
      const dirY = mtv.z;
      ship.pos.x += dirX * move;
      ship.pos.y += dirY * move;
      this._cancelInto(ship, dirX, dirY);
      this.result.hit = true;
      this.result.depth = Math.max(this.result.depth, depth);
      this.result.stationId = d.stationId;
    }
    // Głęboko w budowli (teleport, spawn — w kącie piasty i ramienia dwie bryły wypychają kadłub na zmianę):
    // promieniowo od środka budowli do pierwszego wolnego miejsca.
    if (depth > 0 && this._deepest(ship, d) > C.slop * 2) {
      let ux = ship.pos.x - d.x;
      let uy = ship.pos.y - d.y;
      const len = Math.hypot(ux, uy);
      ux = len > 1e-6 ? ux / len : Math.cos(d.angle);
      uy = len > 1e-6 ? uy / len : Math.sin(d.angle);
      const x0 = ship.pos.x;
      const y0 = ship.pos.y;
      for (let t = 100; t < d.keepR + reach; t += 100) {
        ship.pos.x = x0 + ux * t;
        ship.pos.y = y0 + uy * t;
        if (this._deepest(ship, d) <= 0) break;
      }
      this._cancelInto(ship, ux, uy);
    }
  }

  /**
   * Ostatnia linia przeciw przebiciu bryły (hipercruise, teleport): środek kadłuba przeszedł w tym kroku przez bryłę
   * doku (z (prevX, prevY) do pozy bieżącej) — statek wraca do pozy sprzed kroku, prędkość w kierunku ruchu zerowana.
   */
  blockTunnel(ship, prevX, prevY) {
    const res = this.result;
    res.hit = false;
    res.impactSpeed = 0;
    if (!ship?.pos || !this.docks.length || !Number.isFinite(prevX) || !Number.isFinite(prevY)) return res;
    if (!this.segmentHitsSolid(prevX, prevY, ship.pos.x, ship.pos.y)) return res;
    const mx = ship.pos.x - prevX;
    const my = ship.pos.y - prevY;
    ship.pos.x = prevX;
    ship.pos.y = prevY;
    this._cancelInto(ship, -mx, -my);
    res.hit = true;
    return res;
  }

  /** Zeruje składową prędkości skierowaną przeciw normalnej (nx, ny) — w głąb bryły. */
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

  /**
   * Punkt poza bryłami i polami stanowisk dla spawnu / teleportu: punkt w dysku zapasu budowli (+ `pad`) przesuwa się
   * promieniowo za dysk. Zwraca `out` (x, y) i czy przesunął.
   */
  freeSpot(x, y, pad, out) {
    out.x = x;
    out.y = y;
    const d = this.dockAt(x, y, pad);
    if (!d) return false;
    const dx = x - d.x;
    const dy = y - d.y;
    const len = Math.hypot(dx, dy);
    const ux = len > 1e-6 ? dx / len : Math.cos(d.angle);
    const uy = len > 1e-6 ? dy / len : Math.sin(d.angle);
    out.x = d.x + ux * (d.keepR + pad + 200);
    out.y = d.y + uy * (d.keepR + pad + 200);
    return true;
  }

  /** Przeszkody autopilota (`planCruiseRoute`): dysk zapasu budowli, których nie zawiera start ani cel. */
  pushCruiseObstacles(out, start, target, margin = 600) {
    for (const d of this.docks) {
      const r = d.keepR + margin;
      if (start && (start.x - d.x) ** 2 + (start.y - d.y) ** 2 <= r * r) continue;
      if (target && (target.x - d.x) ** 2 + (target.y - d.y) ** 2 <= r * r) continue;
      out.push({ x: d.x, y: d.y, r });
    }
    return out;
  }

  /**
   * Budowle w zasięgu (`range` od punktu kamery) do obrazu (rekordy budowli: `kindIndex`, `mixIndex`, `styleIndex`,
   * `spec.repeats`, `spec.dockCount`, `x`, `y`, `angle`, `stationId`).
   */
  renderList(cx, cy, range, out) {
    out.length = 0;
    for (const d of this.docks) {
      const r = d.keepR + range;
      if ((cx - d.x) ** 2 + (cy - d.y) ** 2 > r * r) continue;
      out.push(d);
    }
    return out;
  }
}
