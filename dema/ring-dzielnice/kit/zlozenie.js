// DZIELNICE RINGU — ZŁOŻENIE na jednym łuku ringu (czysta matematyka, bez three i DOM).
//
// Każda dzielnica ma własny układ łuku ze środkiem w s = 0. Złożenie stawia je obok siebie: dzielnica `i` dostaje
// przesunięcie `S` (długość łuku na promieniu R0) = obrót wokół środka ringu o kąt S / R0. Punkty, kursy, bryły kolizji,
// stanowiska, zatoki i przystanki przechodzą do WSPÓLNEGO układu lokalnego (x, z), którego początek leży na krawędzi
// ścian ringu w s = 0 złożenia. Ścianę ringu i drogę z kratownicą buduje się raz, dla całego łuku (`merged`).
import { YARD_RING } from '../../stocznia-ringu/layout.js';
import { YARD_R0, districtLocate, sector, yardPoint, yardToArc } from './uklad.js';

const R0 = YARD_R0;

/** Kolejność dzielnic na ringu Ziemi: port ze stocznią w środku, fabryki przy stoczni, zbrojownia przy suchym doku floty. */
export const RING_ORDER = Object.freeze({
  center: 'port',
  left: Object.freeze(['fabryki', 'huta', 'elektronika']),       // od portu ku −s (za stocznią)
  right: Object.freeze(['zbrojownia', 'sklady', 'dworzec'])     // od portu ku +s (za dokami i suchym dokiem floty)
});

/** Przesunięcia S dzielnic ustawionych bez przerw: `center` w S = 0, `left` kolejno ku −s, `right` ku +s. */
export function chainOffsets(layouts, { center, left = [], right = [] }) {
  const S = {};
  S[center] = 0;
  let edge = layouts[center].sMin;
  for (const id of left) { S[id] = edge - layouts[id].sMax; edge = S[id] + layouts[id].sMin; }
  edge = layouts[center].sMax;
  for (const id of right) { S[id] = edge - layouts[id].sMin; edge = S[id] + layouts[id].sMax; }
  return S;
}

/**
 * Składa dzielnice. `items`: [{ id, name, layout, S }]. Zwraca `parts` (dzielnica z przekształceniem), `solids` i `berths`
 * we wspólnym układzie, `merged` — układ ściany ringu i drogi całego łuku, `locate(x, z, out)` — opis miejsca.
 */
export function composeRing(items, { margin = 7000 } = {}) {
  const parts = items.map((it) => {
    const th = it.S / R0;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const part = {
      id: it.id, name: it.name, layout: it.layout, S: it.S, theta: th,
      sMin: it.S + it.layout.sMin, sMax: it.S + it.layout.sMax,
      /** Ramka budowli w scenie gospodarza (portModuleFrame(x, y, angle)). */
      frame: { x: R0 * s, y: -(R0 * c - R0), angle: th - Math.PI / 2 },
      toWorld(x, z, out = [0, 0]) { const zz = z + R0; out[0] = x * c + zz * s; out[1] = -x * s + zz * c - R0; return out; },
      toLocal(x, z, out = [0, 0]) { const zz = z + R0; out[0] = x * c - zz * s; out[1] = x * s + zz * c - R0; return out; },
      heading: (h) => h - th
    };
    return part;
  });
  parts.sort((a, b) => a.sMin - b.sMin);

  const solids = [];
  const berths = [];
  const truckBays = [];
  const railStops = [];
  const openings = [];
  for (const p of parts) {
    const L = p.layout;
    for (const q of L.solids) {
      if (q.zone === 'RING') continue;
      solids.push({ id: `${p.id}: ${q.id}`, tag: q.tag, zone: q.zone, part: p.id, points: q.points.map(([x, z]) => p.toWorld(x, z)) });
    }
    for (const b of L.berths) {
      const [x, z] = p.toWorld(b.x, b.z);
      berths.push({ ...b, x, z, heading: p.heading(b.heading), s: b.s + p.S, part: p.id, local: b });
    }
    for (const bay of L.truckBays || []) {
      const [x, z] = yardPoint(bay.s + p.S, bay.v);
      truckBays.push({ ...bay, s: bay.s + p.S, x, z, heading: p.heading(bay.heading), part: p.id });
    }
    for (const st of L.railStops || []) railStops.push({ ...st, s: st.s + p.S, part: p.id });
    for (const o of L.openings || []) openings.push({ s0: o.s0 + p.S, s1: o.s1 + p.S, label: o.label, part: p.id });
    for (const [a, b] of L.lintelSkip || []) openings.push({ s0: a + p.S + 500, s1: b + p.S - 500, label: 'bez bramownic', part: p.id });
  }
  const sMin = parts[0].sMin;
  const sMax = parts[parts.length - 1].sMax;
  const roadMin = sMin - margin;
  const roadMax = sMax + margin;
  const Y = YARD_RING;
  const band = [];
  const n = Math.ceil((roadMax - roadMin) / Y.maxPiece);
  for (let k = 0; k < n; k++) {
    const s0 = roadMin + ((roadMax - roadMin) * k) / n;
    const s1 = roadMin + ((roadMax - roadMin) * (k + 1)) / n;
    band.push({ s0, s1, v0: -Y.bandDepth, v1: 0 });
    solids.push({ id: 'ŚCIANA RINGU', tag: 'ring', zone: 'RING', part: null, points: sector(s0, s1, -Y.bandDepth, 0) });
  }
  const V = parts[0].layout.v;
  const merged = {
    id: 'ring', R0, sMin, sMax, roadMin, roadMax, extent: Math.max(-roadMin, roadMax), band, truckBays, railStops, openings,
    v: { inner0: V.inner0, inner1: V.inner1, outer0: V.outer0, outer1: V.outer1, road: V.road }
  };

  const ARC = {};
  const LOC = [0, 0];
  /** Opis miejsca we wspólnym układzie: wybiera dzielnicę po łuku i pyta jej układ. `out.part` — dzielnica albo null. */
  function locate(x, z, out = {}) {
    yardToArc(x, z, ARC);
    out.part = null;
    out.pit = null;
    out.inside = 0;
    out.place = ARC.v < 0 ? 'ring' : 'space';
    for (const p of parts) {
      if (ARC.s < p.sMin || ARC.s > p.sMax) continue;
      p.toLocal(x, z, LOC);
      districtLocate(p.layout, LOC[0], LOC[1], out);
      out.part = p;
      return out;
    }
    if (ARC.v >= V.inner1 && ARC.v <= V.outer0) { out.place = 'road'; out.inside = 0.35; }
    return out;
  }
  return { parts, solids, berths, merged, locate };
}
