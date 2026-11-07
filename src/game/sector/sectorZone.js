// src/game/sector/sectorZone.js
//
// STREFA MIĘDZYGWIEZDNA — warunki w punkcie (mgławice, burze), punkty skoku układów i przejście
// strefa ↔ układ. Moduł czysty; gorące funkcje (`zoneAt`, `nebulaDensityAt`) bez alokacji — wynik do
// podanego `out`.
//
// MGŁAWICA (rozgrywka): elipsa z miękkim brzegiem × szum fraktalny z ziarna mgławicy (gęstość d ∈ [0, 1]).
// Spowalnia (prędkość × (1 − 0,5 d)) i zasłania (zasięg czujników × (1 − 0,7 d) — patrzącego i celu).
// BURZA: komórka krążąca w mgławicy (okres 70–190 s); w burzy wiatr pcha statek po okręgu burzy
// (do 0,12 ly/s), paliwo × (1 + 0,8 s), czujniki dodatkowo × (1 − 0,5 s), `hazard` = s (w grze: zużycie
// gotowości bojowej / uszkodzenia — do decyzji). Obraz mgławic (demo) to wypieki stylu „mgławica”
// w tej samej elipsie — kształt w detalu nie musi się zgadzać z szumem rozgrywki.
//
// PUNKTY SKOKU: każdy układ ma cztery na okręgu `ZONE.jumpRadius` wokół gwiazdy, pod kątem 45° —
// NE / NW / SW / SE, tak jak rogi kwadratu świata układu (12 mln j., rogi ~201 AU mapy od gwiazdy, za
// pasem Kuipera 125–140). Wejście do układu przez punkt NE = pojawienie się w rogu NE świata, lot do
// wnętrza; wyjście z układu rogiem SW = punkt SW w strefie, lot na zewnątrz. Kierunek zostaje ten sam.

import { fbm2 } from './sectorRandom.js';

export const ZONE = Object.freeze({
  /** Promień „studni” układu w strefie [ly] — na nim leżą punkty skoku; flota w nim = flota w układzie. */
  jumpRadius: 0.6,
  /** Zasięg wejścia w punkt skoku [ly]. */
  jumpCapture: 0.14,
  /** Wyjście z układu: odsunięcie od punktu skoku na zewnątrz [ly] (żeby nie wpaść od razu z powrotem). */
  exitOffset: 0.2,
  nebulaSpeed: 0.5,
  nebulaSensor: 0.7,
  stormWind: 0.12,
  stormFuel: 0.8,
  stormSensor: 0.5,
  /** Skala szumu kształtu mgławicy [1/ly]. */
  nebulaNoiseScale: 0.22
});

/** Rogi świata układu ↔ punkty skoku (osie gry: x w prawo, y w dół). */
export const JUMP_CORNERS = Object.freeze([
  Object.freeze({ key: 'NE', dx: 1, dy: -1 }),
  Object.freeze({ key: 'NW', dx: -1, dy: -1 }),
  Object.freeze({ key: 'SW', dx: -1, dy: 1 }),
  Object.freeze({ key: 'SE', dx: 1, dy: 1 })
]);

const INV_SQRT2 = Math.SQRT1_2;

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Gęstość mgławicy w punkcie [0, 1] (rozgrywka). */
export function nebulaDensityAt(n, x, y) {
  const dx = x - n.x;
  const dy = y - n.y;
  // Szybkie odrzucenie: poza okręgiem opisanym na elipsie × 1,3.
  const rMax = n.rx * 1.3;
  if (dx * dx + dy * dy > rMax * rMax) return 0;
  const c = Math.cos(n.angle);
  const s = Math.sin(n.angle);
  const u = (dx * c + dy * s) / n.rx;
  const v = (-dx * s + dy * c) / n.ry;
  const r = Math.sqrt(u * u + v * v);
  if (r > 1.3) return 0;
  const k = ZONE.nebulaNoiseScale;
  const nz = fbm2(x * k + 17.3, y * k - 5.1, n.seed, 3);
  const edge = 1 - smooth(0.5, 1.15, r + (nz - 0.5) * 0.55);
  const d = n.density * edge * (0.7 + 0.6 * nz);
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/** Położenie burzy w chwili t [s] → out { x, y } (krąży wokół swojego środka w mgławicy). */
export function stormPosition(sector, storm, t, out) {
  const n = sector.nebulaById.get(storm.nebula);
  const c = Math.cos(n.angle);
  const s = Math.sin(n.angle);
  const lu = storm.u * n.rx;
  const lv = storm.v * n.ry;
  const a = storm.phase + storm.spin * (2 * Math.PI) * (t / storm.period);
  const ou = lu + Math.cos(a) * storm.orbit;
  const ov = lv + Math.sin(a) * storm.orbit;
  out.x = n.x + ou * c - ov * s;
  out.y = n.y + ou * s + ov * c;
  return out;
}

const _sp = { x: 0, y: 0 };

/** Pusty wynik `zoneAt` (do wielokrotnego użycia). */
export function createZoneSample() {
  return { nebula: 0, nebulaId: null, storm: 0, stormId: null, speedMul: 1, sensorMul: 1, fuelMul: 1, windX: 0, windY: 0, hazard: 0 };
}

/**
 * Warunki strefy w punkcie (x, y) w chwili t → `out` (bez alokacji). Mgławice nie sumują się — liczy się
 * najgęstsza; burza — najsilniejsza w zasięgu.
 */
export function zoneAt(sector, x, y, t, out) {
  let nd = 0;
  let nid = null;
  for (const n of sector.nebulae) {
    const d = nebulaDensityAt(n, x, y);
    if (d > nd) { nd = d; nid = n.id; }
  }
  let ss = 0;
  let sid = null;
  let wx = 0;
  let wy = 0;
  if (nd > 0.05) {
    for (const st of sector.storms) {
      if (st.nebula !== nid) continue;
      stormPosition(sector, st, t, _sp);
      const dx = x - _sp.x;
      const dy = y - _sp.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= st.r) continue;
      const k = (1 - smooth(st.r * 0.35, st.r, dist)) * Math.min(1, nd * 1.6);
      if (k > ss) {
        ss = k;
        sid = st.id;
        // Wiatr po okręgu burzy (styczny, kierunek z `spin`), słabszy w samym oku.
        const inv = dist > 1e-6 ? 1 / dist : 0;
        const eye = smooth(0, st.r * 0.25, dist);
        wx = -dy * inv * st.spin * ZONE.stormWind * k * eye;
        wy = dx * inv * st.spin * ZONE.stormWind * k * eye;
      }
    }
  }
  out.nebula = nd;
  out.nebulaId = nid;
  out.storm = ss;
  out.stormId = sid;
  out.speedMul = 1 - ZONE.nebulaSpeed * nd;
  out.sensorMul = (1 - ZONE.nebulaSensor * nd) * (1 - ZONE.stormSensor * ss);
  out.fuelMul = 1 + ZONE.stormFuel * ss;
  out.windX = wx;
  out.windY = wy;
  out.hazard = ss;
  return out;
}

/** Punkt skoku `corner` (0–3, `JUMP_CORNERS`) układu → out { x, y }. */
export function jumpPointPosition(sys, corner, out) {
  const c = JUMP_CORNERS[corner];
  out.x = sys.x + c.dx * ZONE.jumpRadius * INV_SQRT2;
  out.y = sys.y + c.dy * ZONE.jumpRadius * INV_SQRT2;
  return out;
}

/** Cztery punkty skoku układu (UI). */
export function jumpPointsOf(sys) {
  return JUMP_CORNERS.map((c, i) => ({ system: sys.id, corner: i, key: c.key, ...jumpPointPosition(sys, i, { x: 0, y: 0 }) }));
}

/**
 * Najbliższy układ do punktu (liniowo — 160 układów; wołane raz na klatkę dla gracza). `out` { index, dist }.
 */
export function nearestSystem(sector, x, y, out) {
  let best = -1;
  let bd = Infinity;
  const S = sector.systems;
  for (let i = 0; i < S.length; i++) {
    const dx = S[i].x - x;
    const dy = S[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  out.index = best;
  out.dist = Math.sqrt(bd);
  return out;
}

const _jp = { x: 0, y: 0 };

/**
 * Punkt skoku w zasięgu wejścia (x, y) → out { index, corner, dist } albo null. Szuka przy najbliższym układzie.
 */
export function jumpPointAt(sector, x, y, out, near = nearestSystem(sector, x, y, { index: -1, dist: 0 })) {
  if (near.index < 0 || near.dist > ZONE.jumpRadius + ZONE.jumpCapture) return null;
  const sys = sector.systems[near.index];
  let bc = -1;
  let bd = Infinity;
  for (let c = 0; c < 4; c++) {
    jumpPointPosition(sys, c, _jp);
    const d = Math.sqrt((x - _jp.x) ** 2 + (y - _jp.y) ** 2);
    if (d < bd) { bd = d; bc = c; }
  }
  if (bd > ZONE.jumpCapture) return null;
  out.index = near.index;
  out.corner = bc;
  out.dist = bd;
  return out;
}

/**
 * Wejście do układu przez punkt skoku → miejsce w świecie układu (osie gry, środek = gwiazda): róg
 * `corner` kwadratu świata o połowie boku `worldHalf` [j.] (gra: 6 mln) minus `margin`, kurs do środka.
 */
export function worldEntryFromJump(corner, worldHalf = 6_000_000, margin = 250_000) {
  const c = JUMP_CORNERS[corner];
  const h = worldHalf - margin;
  return { x: c.dx * h, y: c.dy * h, heading: Math.atan2(-c.dy, -c.dx), corner: c.key };
}

/**
 * Wyjście z układu rogiem świata → miejsce w strefie: punkt skoku tego rogu + odsunięcie na zewnątrz,
 * kurs od gwiazdy. `worldX`, `worldY` — położenie statku w świecie układu (róg wybiera ćwiartka).
 */
export function zoneExitFromWorld(sector, systemId, worldX, worldY) {
  const sys = sector.byId.get(systemId);
  if (!sys) return null;
  const corner = worldY < 0 ? (worldX >= 0 ? 0 : 1) : (worldX < 0 ? 2 : 3);
  const c = JUMP_CORNERS[corner];
  const p = jumpPointPosition(sys, corner, { x: 0, y: 0 });
  const k = ZONE.exitOffset * INV_SQRT2;
  return { system: sys.id, corner, key: c.key, x: p.x + c.dx * k, y: p.y + c.dy * k, heading: Math.atan2(c.dy, c.dx) };
}
