// ============================================================
// Ukryta stocznia piratów (misja 1) — układ miejsca. Czysta geometria (świat gry, y w dół).
//
// Budynek = SUCHY DOK PIRATÓW (szkic użytkownika 2026-10-05, src/3d/portBuildings/pirateDryDockLayout.js):
// trzon wzdłuż osi `axis` (od gracza ku stoczni), po jednej stronie PARKING — zamknięty prostokąt (trzon,
// ogrodzenie z bramami stanowisk, cienkie bramy taranowe na końcach) z 10 okrętami burta w burtę, dziobem ku
// trzonowi; po drugiej hala jak K-7 wpięta w trzon, brama G-01 od kosmosu. RZĄD = okręty na parkingu: Atlas
// wpada torem taranu (środek parkingu, oś bram końcowych), rozbija bramę G-W i miażdży kadłuby po kolei.
// Eskorta czeka na polach hali i na alarm wylatuje bramami (trasy `launch`), wieżyczki stoją w punktach obrony
// doku. Punkt zbiórki (wyjście z warpa) leży na przedłużeniu toru taranu, poza zasięgiem czujników piratów.
//
// Układ doku (x wzdłuż trzonu, z w poprzek, +z — stanowiska) → gra: punkt = O + U·x + N·z, gdzie U = oś,
// N = U obrócone o +90° (w grze y w dół: w prawo od kierunku lotu). Render: ramka portModuleFrame(O.x, −O.y,
// −axis − π/2) w scenie Core3D (dock.frameAngle).
// ============================================================
import { createPirateDryDockLayout, dryDockShipPose, pointInPoly } from '../../3d/portBuildings/pirateDryDockLayout.js';

export const SHIPYARD_TUNE = Object.freeze({
  // Okręty na parkingu suchego doku D-01 … D-10 (od strony wjazdu G-W): klucze wezwań SUPPORT_SHIP_TEMPLATES.
  // Klasy w tej kolejności = stanowiska układu (DRYDOCK_DEFAULT_BAYS — bryła 3D powstaje na ekranie ładowania).
  parked: Object.freeze(['frigate_pd', 'frigate_laser', 'destroyer', 'frigate_pd', 'destroyer', 'battleship', 'destroyer', 'frigate_laser', 'destroyer', 'battleship']),
  // Wieżyczki obronne usunięte (decyzja użytkownika 2026-10-05) — obrona stoczni to okręty z hali.
  turrets: 0,
  // eskorta na polach hali (H-M1 … H-M5) — na alarm wylatuje bramami
  defenders: Object.freeze(['frigate_pd', 'frigate_laser', 'frigate_pd', 'destroyer', 'frigate_laser']),
  // Okręt flagowy stoczni (2026-10-05): piracki supercapital w hali na osi bramy G-01, między polami H-M3 / H-M4
  // (w grze ~1200 × 600 j., brama ~2400 j.); na alarm wylatuje PIERWSZY, H-M1 (za nim) — po nim.
  flagship: 'pirate_supercapital',
  flagshipBackOffset: 2050,   // [j.] środek kadłuba od tyłu hali (pole H-M1 kończy się ~1070, ściana przodu ~2850)
  flagshipLaunchDelay: 0.3,   // [s] start po alarmie
  padM1ClearDelay: 14,        // [s] H-M1 stoi na osi za supercapitalem — czeka, aż ten wyjdzie z hali
  // Pochylnie hali (H-P1, H-P2): pancerniki w budowie — w misji 1 wodują się na zegar po alarmie (2026-10-07).
  slips: Object.freeze(['battleship', 'battleship']),
  // Wyjazd z parkingu (zegar wodowania): okręt cofa się dziobem do trzonu przez bramę stanowiska w ogrodzeniu
  // z tą prędkością [j/s] (poniżej pasma, w którym pilot obraca dziób w kierunek lotu), potem odlatuje.
  parkedReverseSpeed: 160,
  parkedClearance: 350,       // [j.] rufa za ogrodzeniem, zanim okręt się obróci
  parkedRunOut: 2200,         // [j.] odlot od ogrodzenia po obrocie (tam mózg bojowy)
  // rozbieg przed bramą taranową G-W (i wybieg za G-E) na torze taranu
  ramRunUp: 600,
  // Punkt zbiórki od początku rzędu. Atlas leci bojowo 500 j/s (tabela lotu, 2026-10-01), więc 24 km
  // oznaczało 48 s lotu po prostej; wykrycie niezamaskowanego okrętu jest z 9 km (storyGame._detected),
  // a wieże Atlasa na czas podejścia trzyma misja (api.fire.hold) — 15 km wystarcza.
  rallyDistance: 15000,
  // Wyjście z warpa (mgła wojny, 2026-10-04): „kawałek dalej” niż zbiórka — poza zasięgiem wzroku Atlasa
  // (24 km, src/game/fogOfWar.js), na tej samej osi. Czujniki grawitacyjne widzą stąd tylko dużą masę;
  // najpierw rozpoznanie (dron zwiadu albo ostrożne podejście), potem podejście w maskowaniu.
  warpInDistance: 60000,
  // Front odwetu piratów od gracza: piraci formują szyk 2–5 km bliżej (pomiar: 6–9 km od gracza) — poza
  // zasięgiem swoich armat (3,5 km), w zasięgu rakiet i baterii Atlasa (Tempest L 6 km, Yamato 7 km).
  // 2026-10-07: 18 → 11 km po skróceniu zasięgów broni — przy 18 km piraci stali ~13 km od gracza przez
  // ~25 s ciszy (scripts/webgpu/zasiegi-gra.mjs).
  counterDistance: 11000,
  supportDistance: 5000    // wsparcie z Ziemi za graczem
});

/** Szerokość kadłuba (j. świata) z klucza — rozmiary HULL_RENDER_PROFILES × 0,6 (bez importu danych gry). */
export function parkedBeamOf(key) {
  const k = String(key || '');
  if (k.includes('battleship')) return 2 * 220 * 0.6;
  if (k.includes('destroyer')) return 2 * 170 * 0.6;
  return 2 * 120 * 0.6;
}
export function parkedLengthOf(key) {
  const k = String(key || '');
  if (k.includes('battleship')) return 1200 * 0.6;
  if (k.includes('destroyer')) return 600 * 0.6;
  return 320 * 0.6;
}

/**
 * Dok w układzie gry: przejścia układ doku ↔ gra, bryły trafień w grze, obwiednia.
 * center — środek obwiedni doku w grze, axis — kierunek trzonu (+x układu).
 */
export function placeDryDock(center, axis, layout = createPirateDryDockLayout()) {
  const l = layout;
  const ux = Math.cos(axis);
  const uy = Math.sin(axis);
  const nx = -uy;
  const ny = ux;
  const cz = (l.bounds.z0 + l.bounds.z1) / 2;
  const O = { x: center.x - nx * cz, y: center.y - ny * cz };
  const toGame = (x, z, out = {}) => {
    out.x = O.x + ux * x + nx * z;
    out.y = O.y + uy * x + ny * z;
    return out;
  };
  const toHub = (gx, gy, out = {}) => {
    const dx = gx - O.x;
    const dy = gy - O.y;
    out.x = dx * ux + dy * uy;
    out.z = dx * nx + dy * ny;
    return out;
  };
  const headingToGame = (h) => Math.atan2(uy * Math.cos(h) + ny * Math.sin(h), ux * Math.cos(h) + nx * Math.sin(h));
  const polyToGame = (poly) => {
    const pts = poly.map((p) => toGame(p.x, p.z));
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    return { pts, x0, x1, y0, y1 };
  };
  const hitShapes = l.hitSolids.map((h) => ({ id: h.id, chunk: h.chunk, ...polyToGame(h.poly) }));
  const hallArea = { id: l.hallArea.id, chunk: l.hallArea.chunk, ...polyToGame(l.hallArea.poly) };
  // lekkie kawałki parkingu, które kadłub rozbija taranem (bramy, ogrodzenie, pylony ram końcowych)
  const ramShapes = hitShapes.filter((h) => RAMMABLE.has(l.chunkById.get(h.chunk)?.kind));
  return {
    layout: l, origin: O, axis, frameAngle: -axis - Math.PI / 2,
    u: { x: ux, y: uy }, n: { x: nx, y: ny },
    toGame, toHub, headingToGame,
    hitShapes, hallArea, ramShapes,
    /** Kierunek gry → kierunek w układzie doku (bez przesunięcia). */
    dirToHub(dx, dy, out = {}) {
      out.x = dx * ux + dy * uy;
      out.z = dx * nx + dy * ny;
      return out;
    },
    radius: Math.hypot(l.width, l.depth) / 2,
    /** Czy punkt gry leży w hali (pod dachem). */
    inHall(gx, gy) {
      const h = toHub(gx, gy, _hub);
      return pointInPoly(l.hallArea.poly, h.x, h.z);
    },
    /** Odległość punktu gry od obwiedni doku (0 w środku). */
    distance(gx, gy) {
      const h = toHub(gx, gy, _hub);
      const dx = Math.max(0, l.bounds.x0 - h.x, h.x - l.bounds.x1);
      const dz = Math.max(0, l.bounds.z0 - h.z, h.z - l.bounds.z1);
      return Math.hypot(dx, dz);
    }
  };
}
const _hub = { x: 0, z: 0 };
const RAMMABLE = new Set(['gate', 'fence', 'frame']);

function pointInPts(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Pierwsze wejście odcinka (x0, y0) → (x1, y1) w bryły doku (placeDryDock().hitShapes / [hallArea]):
 * { t (0..1), x, y, chunk } albo null. Początek w bryle = trafienie w t = 0. Bez alokacji (out).
 * skip — zbiór kawałków, których już nie ma (odpadły, staranowane; `has(id)`) — pocisk przelatuje.
 */
export function dryDockSegmentHit(shapes, x0, y0, x1, y1, out = {}, skip = null) {
  const minX = x0 < x1 ? x0 : x1;
  const maxX = x0 < x1 ? x1 : x0;
  const minY = y0 < y1 ? y0 : y1;
  const maxY = y0 < y1 ? y1 : y0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let bestT = Infinity;
  let best = null;
  for (let s = 0; s < shapes.length; s++) {
    const sh = shapes[s];
    if (maxX < sh.x0 || minX > sh.x1 || maxY < sh.y0 || minY > sh.y1) continue;
    if (skip && skip.size && skip.has(sh.chunk)) continue;
    const pts = sh.pts;
    if (pointInPts(pts, x0, y0)) {
      if (0 < bestT) { bestT = 0; best = sh; }
      continue;
    }
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const ax = pts[j].x;
      const ay = pts[j].y;
      const ex = pts[i].x - ax;
      const ey = pts[i].y - ay;
      const den = dx * ey - dy * ex;
      if (den === 0) continue;
      const qx = ax - x0;
      const qy = ay - y0;
      const t = (qx * ey - qy * ex) / den;
      const u = (qx * dy - qy * dx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) { bestT = t; best = sh; }
    }
  }
  if (!best) return null;
  out.t = bestT;
  out.x = x0 + dx * bestT;
  out.y = y0 + dy * bestT;
  out.chunk = best.chunk;
  return out;
}

// Rzut wielokąta na oś (ax, ay) zachodzi na przedział [c − half, c + half].
function axisOverlap(pts, c, half, ax, ay) {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = pts[i].x * ax + pts[i].y * ay;
    if (d < mn) mn = d;
    if (d > mx) mx = d;
  }
  return !(mx < c - half || mn > c + half);
}

/**
 * Kawałki doku, w które wchodzi kadłub (prostokąt: środek (cx, cy), kurs `angle`, pół-długość hl, pół-szerokość
 * hw) — test osi rozdzielających (SAT) z wielokątami `shapes` (placeDryDock().ramShapes). Wynik w `out`
 * (identyfikatory kawałków, bez powtórzeń i bez `skip`), zwraca ich liczbę. Bez alokacji.
 */
export function dryDockRamOverlap(shapes, cx, cy, angle, hl, hw, skip = null, out = []) {
  out.length = 0;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;
  const R = hl + hw;
  for (let s = 0; s < shapes.length; s++) {
    const sh = shapes[s];
    if (cx + R < sh.x0 || cx - R > sh.x1 || cy + R < sh.y0 || cy - R > sh.y1) continue;
    if ((skip && skip.size && skip.has(sh.chunk)) || out.includes(sh.chunk)) continue;
    const pts = sh.pts;
    if (!axisOverlap(pts, cx * ux + cy * uy, hl, ux, uy)) continue;
    if (!axisOverlap(pts, cx * vx + cy * vy, hw, vx, vy)) continue;
    let sep = false;
    for (let i = 0, j = pts.length - 1; i < pts.length && !sep; j = i++) {
      const ex = pts[i].x - pts[j].x;
      const ey = pts[i].y - pts[j].y;
      const len = Math.sqrt(ex * ex + ey * ey) || 1;
      const nx = -ey / len;
      const ny = ex / len;
      const r = hl * Math.abs(ux * nx + uy * ny) + hw * Math.abs(vx * nx + vy * ny);
      sep = !axisOverlap(pts, cx * nx + cy * ny, r, nx, ny);
    }
    if (!sep) out.push(sh.chunk);
  }
  return out.length;
}

/**
 * Układ stoczni. center — środek zakładu (środek obwiedni doku), approachFrom — punkt, od którego gracz
 * nadlatuje (np. Ziemia): trzon i tor taranu ustawiają się wzdłuż kierunku podejścia.
 * Zwraca { center, axis, building, buildingRadius, dock (placeDryDock),
 *          parked: [{ key, berth, x, y, angle, launch: { gate, fightFrom, path: [{ x, y, face?, speed? }] } }],
 *          turrets: [{ x, y, angle }], defenders: [{ key, pad, x, y, angle, launch: [{ x, y }] }],
 *          slips: [{ key, slip, x, y, angle, gate, launch: { gate, fightFrom, path } }],
 *          rowStart, rowEnd, rowLength, rally: { x, y, angle }, warpIn: { x, y, angle } }.
 */
export function planShipyard(center, approachFrom, tune = SHIPYARD_TUNE) {
  const T = { ...SHIPYARD_TUNE, ...tune };
  const axis = Math.atan2(center.y - approachFrom.y, center.x - approachFrom.x);
  const dock = placeDryDock(center, axis);
  const l = dock.layout;
  const ux = Math.cos(axis);
  const uy = Math.sin(axis);
  const parked = [];
  const fenceZ = l.parking.z1;
  for (let i = 0; i < Math.min(T.parked.length, l.berths.length); i++) {
    const key = T.parked[i];
    const b = l.berths[i];
    const len = parkedLengthOf(key);
    const pose = dryDockShipPose(b, len);
    const g = dock.toGame(pose.x, pose.z);
    const angle = dock.headingToGame(pose.angle);
    // Wyjazd (zegar wodowania): rufą przez bramę stanowiska — dziób zostaje ku trzonowi (face, wolno), za
    // ogrodzeniem obrót i odlot; od pierwszego punktu (za bramą) okręt walczy.
    const out = fenceZ + len / 2 + T.parkedClearance;
    const p0 = dock.toGame(b.x, out);
    const p1 = dock.toGame(b.x, out + T.parkedRunOut);
    const launch = {
      gate: b.gate, fightFrom: 1,
      path: [{ x: p0.x, y: p0.y, face: angle, speed: T.parkedReverseSpeed }, { x: p1.x, y: p1.y }]
    };
    parked.push({ key, berth: b.id, x: g.x, y: g.y, angle, launch });
  }
  // tor taranu: środkiem parkingu (oś bram końcowych), od rozbiegu przed G-W do wybiegu za G-E
  const laneZ = l.parking.laneZ;
  const start = dock.toGame(l.parking.x0 - T.ramRunUp, laneZ);
  const end = dock.toGame(l.parking.x1 + T.ramRunUp, laneZ);
  const turrets = l.defensePoints.slice(0, T.turrets).map((p) => {
    const g = dock.toGame(p.x, p.z);
    return { x: g.x, y: g.y, angle: dock.headingToGame(p.angle) };
  });
  const pads = l.hall.pads;
  const defenders = T.defenders.slice(0, pads.length).map((key, i) => {
    const p = pads[i];
    const g = dock.toGame(p.x, p.z);
    const delay = (T.flagship && p.id === 'H-M1' ? T.padM1ClearDelay : 0) + 0.8 + i * 1.3;
    return { key, pad: p.id, x: g.x, y: g.y, angle: dock.headingToGame(p.angle), gate: p.launch.gate, delay, launch: p.launch.path.map((q) => dock.toGame(q.x, q.z)) };
  });
  // supercapital: na osi hali dziobem do bramy G-01, wylot prosto przez bramę i płytę przed nią
  if (T.flagship) {
    const h = l.hall;
    const fz = h.backZ - T.flagshipBackOffset;
    const g = dock.toGame(h.x, fz);
    const apron = h.apron ? h.apron.z1 - h.apron.z0 : 900;
    const path = [
      { x: h.x, z: h.bodyEndZ - 200 },
      { x: h.x, z: h.frontZ - apron * 0.6 },
      { x: h.x, z: h.frontZ - apron - 2600 }
    ].map((q) => dock.toGame(q.x, q.z));
    defenders.unshift({ key: T.flagship, pad: 'H-S1', flagship: true, x: g.x, y: g.y, angle: dock.headingToGame(-Math.PI / 2),
      gate: 'G-01', delay: T.flagshipLaunchDelay, launch: path });
  }
  // Pochylnie (H-P1, H-P2): pancerniki w budowie, dziobem ku ścianie tylnej; wodowanie = obrót w hali i wylot
  // bramą G-01 (pole przed bramą jak u eskorty).
  const slips = [];
  {
    const h = l.hall;
    const apron = h.apron ? h.apron.z1 - h.apron.z0 : 900;
    const n = Math.min(T.slips ? T.slips.length : 0, h.slips.length);
    for (let i = 0; i < n; i++) {
      const s = h.slips[i];
      const g = dock.toGame(s.x, s.z);
      const dx = s.x - h.x;
      const path = [
        { x: s.x, z: s.z - 1300 },
        { x: h.x + dx * 0.35, z: h.bodyEndZ - 120 },
        { x: h.x + dx * 0.3, z: h.frontZ - apron * 0.6 },
        { x: h.x + dx * 0.3, z: h.frontZ - apron - 1700 }
      ].map((q) => dock.toGame(q.x, q.z));
      slips.push({ key: T.slips[i], slip: s.id, x: g.x, y: g.y, angle: dock.headingToGame(s.angle), gate: 'G-01', launch: { gate: 'G-01', fightFrom: 2, path } });
    }
  }
  const rowLength = Math.hypot(end.x - start.x, end.y - start.y);
  // Punkt zbiórki: na przedłużeniu toru taranu, przed jego początkiem, dziobem wzdłuż osi.
  const rally = { x: start.x - ux * T.rallyDistance, y: start.y - uy * T.rallyDistance, angle: axis };
  // Wyjście z warpa: dalej na tej samej osi (rozpoznanie przez mgłę wojny przed podejściem).
  const warpIn = { x: start.x - ux * T.warpInDistance, y: start.y - uy * T.warpInDistance, angle: axis };
  return {
    center: { x: center.x, y: center.y }, axis, building: { x: center.x, y: center.y }, buildingRadius: dock.radius,
    dock, parked, turrets, defenders, slips, rowStart: start, rowEnd: end, rowLength, rally, warpIn
  };
}

/**
 * Szyk floty przylatującej tunelem: `counts` { battleship, destroyer, frigate }, front prostopadły do `facing`
 * (kurs floty), środek frontu w `center`. Okręty flagowe w pierwszym rzędzie, niszczyciele za nimi, fregaty
 * po skrzydłach i z tyłu. Zwraca [{ key, x, y, angle }] (kolejność: od najmniejszych — ostatni przylatuje flagowiec).
 */
export function planFleetWave(center, facing, counts, opts = {}) {
  const ux = Math.cos(facing), uy = Math.sin(facing);
  const nx = -uy, ny = ux;
  const out = [];
  const row = (keys, depth, spacing) => {
    const n = keys.length;
    for (let i = 0; i < n; i++) {
      const lat = (i - (n - 1) / 2) * spacing;
      out.push({ key: keys[i], x: center.x - ux * depth + nx * lat, y: center.y - uy * depth + ny * lat, angle: facing });
    }
  };
  const bs = Array(Math.max(0, counts.battleship | 0)).fill(opts.battleshipKey || 'battleship');
  const dd = Array(Math.max(0, counts.destroyer | 0)).fill(opts.destroyerKey || 'destroyer');
  const ffKeys = opts.frigateKeys || ['frigate_pd', 'frigate_laser'];
  const ff = Array.from({ length: Math.max(0, counts.frigate | 0) }, (_, i) => ffKeys[i % ffKeys.length]);
  // Kolejność przylotu: fregaty, niszczyciele, pancerniki (flagowce na końcu — jak planFleetArrival).
  row(ff, 2600, 700);
  row(dd, 1400, 1100);
  row(bs, 0, 1700);
  return out;
}
