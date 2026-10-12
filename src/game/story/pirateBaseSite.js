// ============================================================
// Baza piratów (misja 1) — miejsce w grze: przejścia układ bazy ↔ gra, bryły trafień w grze (osobno na budowlę:
// habitat, paliwo, magazyn, pomosty) i plan misji (okręty w stanowiskach z załogą i w remoncie, herszt, tor taranu,
// zbiórka, wyjście z warpa). Czysta geometria (świat gry, y w dół).
//
// Układ bazy (src/3d/portBuildings/pirateBaseLayout.js): x wzdłuż osi podejścia (gracz od −x), z w poprzek → gra:
// punkt = O + U·x + N·z, gdzie U = oś (od gracza ku bazie), N = U obrócone o +90° (w grze y w dół: w prawo od
// kierunku lotu). Render: ramka portModuleFrame(O.x, −O.y, −axis − π/2) w scenie Core3D (place.frameAngle).
// ============================================================
import { createPirateBaseLayout, pointInPoly } from '../../3d/portBuildings/pirateBaseLayout.js';

export const PIRATE_BASE_TUNE = Object.freeze({
  // klucze wezwań (SUPPORT_SHIP_TEMPLATES) dla klas stanowisk; fregaty na zmianę PD / laser
  keys: Object.freeze({ frigate: Object.freeze(['frigate_pd', 'frigate_laser']), destroyer: 'destroyer', battleship: 'battleship', supercapital: 'pirate_supercapital' }),
  // okręt w remoncie: ułamek punktów (rozebrane panele, brak części)
  repairHp: 0.75,
  // Wyjazd ze stanowiska (zegar wodowania): rufą od pomostu z tą prędkością [j/s], potem odlot; od drugiego punktu walka.
  reverseSpeed: 160,
  clearance: 350,
  runOut: 2200,
  // herszt: rufą z zatoki, potem wzdłuż zatoki (ku otwartemu końcowi) i na przedpole
  bossClear: 320, bossBay: 1700,
  bossLaunchDelay: 0.3,
  // Drony piratów (hangary w bębnie habitatu) — start przy wykryciu gracza albo alarmie: eskadry po `droneSquad`
  // z każdego hangaru, kolejna fala po `droneWaveGap` s (decyzja użytkownika 2026-10-11: „gracz wykryty — lecą drony”).
  // Eskadry na przemian 'strike' (szybkie rakiety z dystansu, więcej punktów) i 'multirole' — 2026-10-11 pomiar: 12 dron
  // 'multirole' ginęło od obrony punktowej Atlasa w ~2 s (−17% tarczy, kadłub nietknięty), myśliwce gracza (Z) nie
  // miały nic do roboty.
  droneBays: 4, droneSquad: 4, droneWaves: 3, droneWaveGap: 35, droneRoles: ['strike', 'multirole'],
  // Punkty budowli (habitat = finał misji; pozostałe — cele dodatkowe): punkty, osłona, progi rozpadu kawałków.
  hp: Object.freeze({
    habitat: Object.freeze({ hp: 36000, shield: 4000, steps: 8 }),
    fuel: Object.freeze({ hp: 7000, shield: 0, steps: 3 }),
    warehouse: Object.freeze({ hp: 9000, shield: 0, steps: 4 }),
    piers: Object.freeze({ hp: 60000, shield: 0, steps: 14 })
  }),
  // Punkt zbiórki i wyjście z warpa: na osi bazy przed wylotem lejka (poza zasięgiem wzroku Atlasa — mgła wojny).
  // Fregata zwiadu (etap rozpoznania): obrona wykrywa ją bliżej niż `scoutDetect` od obwiedni bazy albo od okrętu
  // z załogą; od `scoutWarn` cel misji ostrzega (wzrok fregaty 10 km — oblot bazy w pasie 3–10 km odsłania wszystko).
  scoutDetect: 3000,
  scoutWarn: 4500,
  // powrót fregaty do ładowni omija koło: promień bazy + `scoutDetect` + ten zapas (pomiar 2026-10-11 przy zapasie 800:
  // najbliżej 3,6 km od obwiedni — narożniki prostokąta bazy leżą bliżej koła)
  scoutAvoidMargin: 1500,
  rallyDistance: 15000,
  warpInDistance: 60000,
  counterDistance: 11000,
  supportDistance: 5000
});

const STRUCTURES = Object.freeze(['habitat', 'fuel', 'warehouse', 'piers']);

/**
 * Baza w układzie gry. center — środek obwiedni bazy w grze, axis — kierunek osi bazy (+x układu: od gracza ku bazie).
 */
export function placePirateBase(center, axis, layout = createPirateBaseLayout()) {
  const l = layout;
  const ux = Math.cos(axis);
  const uy = Math.sin(axis);
  const nx = -uy;
  const ny = ux;
  const O = { x: center.x - ux * l.center.x - nx * l.center.z, y: center.y - uy * l.center.x - ny * l.center.z };
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
  const hitShapes = l.hitSolids.map((h) => ({ id: h.id, chunk: h.chunk, structure: l.chunkById.get(h.chunk)?.structure || 'piers', ...polyToGame(h.poly) }));
  const shapesOf = {};
  for (const s of STRUCTURES) shapesOf[s] = hitShapes.filter((h) => h.structure === s);
  const habitat = toGame(0, 0);
  return {
    layout: l, origin: O, axis, frameAngle: -axis - Math.PI / 2,
    u: { x: ux, y: uy }, n: { x: nx, y: ny },
    toGame, toHub, headingToGame,
    hitShapes, shapesOf,
    // zgodność z suchym dokiem: taran statyczny i hala (bazy to ciała świata w bańce gracza — taran zwykłym zderzeniem)
    ramShapes: [], hallArea: null,
    habitat,
    dirToHub(dx, dy, out = {}) {
      out.x = dx * ux + dy * uy;
      out.z = dx * nx + dy * ny;
      return out;
    },
    radius: Math.hypot(l.width, l.depth) / 2,
    inHall: () => false,
    /** Odległość punktu gry od obwiedni bazy (0 w środku). */
    distance(gx, gy) {
      const h = toHub(gx, gy, _hub);
      const dx = Math.max(0, l.bounds.x0 - h.x, h.x - l.bounds.x1);
      const dz = Math.max(0, l.bounds.z0 - h.z, h.z - l.bounds.z1);
      return Math.hypot(dx, dz);
    },
    /** Kawałek budowli pod punktem gry (bryły trafień) albo null. */
    chunkAt(gx, gy, structure = null) {
      const h = toHub(gx, gy, _hub);
      for (const s of l.hitSolids) {
        const c = l.chunkById.get(s.chunk);
        if (structure && c?.structure !== structure) continue;
        if (pointInPoly(s.poly, h.x, h.z)) return s.chunk;
      }
      return null;
    }
  };
}
const _hub = { x: 0, z: 0 };

/**
 * Plan bazy dla misji. center — środek bazy w grze, approachFrom — punkt, od którego gracz nadlatuje (Ziemia): oś
 * bazy wzdłuż kierunku podejścia (rozwidlenie Y ku graczowi). Zwraca { center, axis, building (habitat w grze),
 * buildingRadius, dock (placePirateBase), parked: [{ key, berth, cls, x, y, angle, crew, boss, launch }], bays
 * [{ x, y, angle }], rowStart, rowEnd, rowLength, ramBerths, rally, warpIn }.
 */
export function planPirateBase(center, approachFrom, tune = PIRATE_BASE_TUNE) {
  const T = { ...PIRATE_BASE_TUNE, ...tune };
  const axis = Math.atan2(center.y - approachFrom.y, center.x - approachFrom.x);
  const dock = placePirateBase(center, axis);
  const l = dock.layout;
  const ux = Math.cos(axis);
  const uy = Math.sin(axis);
  let fi = 0;
  const parked = l.berths.map((b) => {
    const k = T.keys[b.cls];
    const key = Array.isArray(k) ? k[fi++ % k.length] : k;
    const g = dock.toGame(b.x, b.z);
    const angle = dock.headingToGame(b.angle);
    let path;
    if (b.boss) {
      // herszt: rufą z zatoki (kurs bez zmian), wzdłuż zatoki ku otwartemu końcowi (−z), potem na przedpole
      const p1 = l.nodes.P1;
      const q0 = { x: b.x + b.out.x * T.bossClear, z: b.z + b.out.z * T.bossClear };
      const q1 = { x: q0.x, z: p1.z - T.bossBay * 0.6 };
      const q2 = { x: q0.x - 2600, z: p1.z - T.bossBay };
      path = [{ ...dock.toGame(q0.x, q0.z), face: angle, speed: T.reverseSpeed }, dock.toGame(q1.x, q1.z), dock.toGame(q2.x, q2.z)];
    } else {
      const d0 = b.length * 0.6 + T.clearance;
      const p0 = dock.toGame(b.x + b.out.x * d0, b.z + b.out.z * d0);
      const p1 = dock.toGame(b.x + b.out.x * (d0 + T.runOut), b.z + b.out.z * (d0 + T.runOut));
      path = [{ x: p0.x, y: p0.y, face: angle, speed: T.reverseSpeed }, { x: p1.x, y: p1.y }];
    }
    return { key, berth: b.id, index: b.index, cls: b.cls, x: g.x, y: g.y, angle, crew: b.crew, boss: b.boss, repair: b.repair,
      launch: { fightFrom: b.boss ? 2 : 1, path } };
  });
  const bays = l.habitat.bays.map((b) => {
    const g = dock.toGame(Math.cos(b.angle) * (l.habitat.drumR + 260), Math.sin(b.angle) * (l.habitat.drumR + 260));
    return { x: g.x, y: g.y, angle: dock.headingToGame(b.angle) };
  });
  const rowStart = dock.toGame(l.ram.start.x, l.ram.start.z);
  const rowEnd = dock.toGame(l.ram.end.x, l.ram.end.z);
  const mouth = dock.toGame(l.mouth.x, l.mouth.z);
  const rally = { x: mouth.x - ux * T.rallyDistance, y: mouth.y - uy * T.rallyDistance, angle: axis };
  const warpIn = { x: mouth.x - ux * T.warpInDistance, y: mouth.y - uy * T.warpInDistance, angle: axis };
  return {
    center: { x: center.x, y: center.y }, axis, building: dock.habitat, buildingRadius: l.habitat.drumR,
    dock, parked, bays, defenders: [], slips: [], turrets: [],
    rowStart, rowEnd, rowLength: Math.hypot(rowEnd.x - rowStart.x, rowEnd.y - rowStart.y), ramAngle: dock.headingToGame(l.ram.dir),
    ramBerths: l.ram.berths, mouth, rally, warpIn
  };
}

export { STRUCTURES as PIRATE_BASE_STRUCTURES };
