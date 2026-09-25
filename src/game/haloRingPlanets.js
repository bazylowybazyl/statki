// Ringi „Halo” w świecie gry (port do gry 2026-09-25) — czysta matematyka,
// bez Three. Wspólne dla renderu (src/3d/haloRing/haloRingGame.js), kolizji
// (haloRingCollision.js) i stacji w index.html.
//
// Świat gry: płaszczyzna (x, y), y w dół; Three: (x, −y, z). Grupa ringu stoi
// w środku planety i jest obrócona wokół Z tak, żeby port (kompleks 0: hala
// K-7 gracza i jej zatoki) leżał pod kątem dawnej stacji planety — moduł ringu
// buduje port pod HALO_STATION_ANGLE (kąt stacji Ziemi w układzie Three).
//
// Port ringu zastępuje stację orbitalną (decyzja użytkownika 2026-09-23): stacja
// planety z ringiem zostaje obiektem logicznym (handel, terminal, frakcja,
// ruch frachtowców), ale jej punkt to środek hali K-7 gracza — bez bryły 3D
// stacji i bez trafień pociskami. Brama warp i porty frachtowców leżą na płycie
// przed bramą główną G-01 (poza halą — frachtowce nie przelatują przez ściany).
import { HALO_STATION_ANGLE } from '../3d/haloRing/haloRingConfig.js';
import { createHaloRingLayout } from '../3d/haloRing/haloRingLayout.js';
import { createK7Layout, k7Frame } from '../3d/haloRing/haloPortK7Layout.js';
import { normalizeRingPlanetKey, resolveRingPlanetWorldRadius } from '../3d/ringScale.js';

// Kąt stacji w świecie gry (y w dół) — jak dawne stacje orbitalne: Ziemia π/4,
// Mars 5π/4. Ziarno: ten sam ring przy każdym uruchomieniu, różny dla planet.
export const HALO_RING_PLANETS = Object.freeze({
  earth: Object.freeze({ key: 'earth', seed: 1337, stationAngle: Math.PI * 0.25 }),
  mars: Object.freeze({ key: 'mars', seed: 4099, stationAngle: Math.PI * 1.25 })
});

// Stacja-port w hali K-7 (układ huba: x wzdłuż ringu, z promieniowo na
// zewnątrz od płyty podłogi; hala z 250…7400, x ±5220, płyta przed G-01 1180).
export const HALO_PORT_STATION = Object.freeze({
  terminalRange: 5600,                       // terminal stacji w całej hali i tuż przed bramą
  portZ: 8100,                               // porty frachtowców: płyta przed G-01
  portX: Object.freeze([-2600, -900, 900, 2600]),
  gateZ: 10200                               // brama warp: za płytą
});

export function haloRingKey(planet) {
  const key = normalizeRingPlanetKey(planet);
  return HALO_RING_PLANETS[key] ? key : '';
}

// Obrót grupy ringu (Three, wokół +Z): port pod kątem stacji planety.
export function haloRingRotation(key) {
  const spec = HALO_RING_PLANETS[key];
  return spec ? -spec.stationAngle - HALO_STATION_ANGLE : 0;
}

const _layouts = new Map();
// Układ ringu planety (ten sam, który buduje render: promień planety + ziarno).
export function haloRingLayoutFor(planet) {
  const key = haloRingKey(planet);
  if (!key) return null;
  const planetRadius = resolveRingPlanetWorldRadius(planet);
  const id = `${key}:${planetRadius}`;
  let layout = _layouts.get(id);
  if (!layout) {
    layout = createHaloRingLayout({ planetRadius, seed: HALO_RING_PLANETS[key].seed });
    _layouts.set(id, layout);
  }
  return layout;
}

// Ring w świecie gry: środek planety (x, y gry), obrót grupy (cos, sin).
export function createHaloRingPlacement(planet) {
  const key = haloRingKey(planet);
  if (!key) return null;
  const rot = haloRingRotation(key);
  return {
    key,
    rot,
    cos: Math.cos(rot),
    sin: Math.sin(rot),
    x: Number(planet?.x) || 0,
    y: Number(planet?.y) || 0
  };
}

// Świat gry (x, y) → układ lokalny ringu (Three bez obrotu grupy, planeta w 0).
export function haloGameToLocal(place, x, y, out = {}) {
  const X = x - place.x;
  const Y = place.y - y;
  out.x = X * place.cos + Y * place.sin;
  out.y = -X * place.sin + Y * place.cos;
  return out;
}

// Układ lokalny ringu → świat gry (punkt).
export function haloLocalToGame(place, lx, ly, out = {}) {
  out.x = place.x + lx * place.cos - ly * place.sin;
  out.y = place.y - (lx * place.sin + ly * place.cos);
  return out;
}

// Wektor lokalny ringu → wektor świata gry.
export function haloLocalToGameVec(place, lx, ly, out = {}) {
  out.x = lx * place.cos - ly * place.sin;
  out.y = -(lx * place.sin + ly * place.cos);
  return out;
}

// Stacja planety z ringiem jako port: promień „orbity” = środek hali K-7 na
// osi kąta stacji (stacje gry liczą pozycję z planety, kąta i promienia co
// krok), porty frachtowców i brama warp jako przesunięcia od stacji.
export function computeHaloPortStation(planet) {
  const key = haloRingKey(planet);
  if (!key) return null;
  const layout = haloRingLayoutFor(planet);
  const hall = createK7Layout();
  const frame = k7Frame(layout);
  const hubZ = (hall.backZ + hall.frontZ) * 0.5;
  const angle = HALO_RING_PLANETS[key].stationAngle;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const P = HALO_PORT_STATION;
  const radial = P.portZ - hubZ;
  return {
    key,
    angle,
    orbitRadius: frame.radius + hubZ,
    hubZ,
    terminalRange: P.terminalRange,
    ports: P.portX.map((x) => ({ x: ux * radial - uy * x, y: uy * radial + ux * x })),
    gateOffset: { x: ux * (P.gateZ - hubZ), y: uy * (P.gateZ - hubZ) }
  };
}
