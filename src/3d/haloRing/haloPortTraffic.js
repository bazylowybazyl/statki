// Port ringu „Halo” (Ziemia, Mars; w przyszłości Jowisz) dla ruchu v2
// (src/game/traffic/): hale K-7 i zatoki transportowe jako układ doków w formacie
// `buildStationDocks` z dockLayout.js — dyspozytor portu (portControl), findBerth /
// reserveBerth / berthOccupancy, reda (portParking.js) i widok ruch-v2.html biorą
// go bez zmian. K-7 zastępuje „teoretyczny” dok ruchu v2 (decyzja użytkownika
// 2026-09-23).
//
// Skład (4 kompleksy co 90°): w każdej hali 4 capital, 4 L, 8 M, 12 S; przy
// każdej hali 2 otwarte zatoki (po jednej z każdej strony) ze stanowiskami
// w standardzie K-7 (haloPortBays.js): 2 pasy MEGA (megafrachtowiec 2760 ×
// 912 j. dziobem do podłogi; wolny pas biorą też mniejsze kadłuby) i podwójny
// grzebień 4 L, 4 M, 4 S. Razem 224 stanowiska: 16 capital, 16 mega, 48 L,
// 64 M, 80 S (teoretyczny port ruchu v2 ma 260; wynik symulacji:
// docs/PORT-halo-ring.md).
//
// Role (decyzja użytkownika 2026-09-26): hale K-7 = wojsko (`military`, flota
// frakcji), zatoki = terminale przeładunkowe (`civil`, cały ruch cywilny).
// Zmierzone przy ×60: same zatoki (112 stanowisk) dają kolejkę śr. 0,15, max 27.
// Stanowiska niosą limity swoich pól (`maxLength` / `maxBeam`), więc fregata
// (192 × 144 j.) staje na padzie S hali (300 × 180), choć w klasę S ruchu
// (170 × 140) się nie mieści.
//
// Współrzędne: układ lokalny ringu (scena XY) → obrót grupy ringu wokół +Z
// (`rotation`, jak haloRingRotation: Ziemia 0, Mars −π) → gra: (x, y) →
// (stacja.x + x, stacja.y − y), kąty z przeciwnym znakiem (Three odwraca oś y
// gry). Czysta matematyka, bez Three.
import { BERTH_CLASSES, BERTH_ROLE } from '../../game/traffic/dockLayout.js';
import { haloRingKey, haloRingRotation } from '../../game/haloRingPlanets.js';
import { HALO_PORT, haloPortComplexAngles, haloPortTemplate, haloTransitAngles } from './haloRingConfig.js';
import { createK7Layout, k7Frame, k7HeadingToWorld, k7HubToWorld } from './haloPortK7Layout.js';
import { bayLaneOf, haloBayLayouts } from './haloPortBays.js';

const K7_TO_CLASS = Object.freeze({ CAPITAL: 'capital', L: 'l', M: 'm', S: 's', MEGA: 'mega' });

// Punkt podejścia do stanowiska hali: przed bramą, którą statek wchodzi
// (capital — koniec własnego pasa za G-01, grzebienie — przed bramą boczną
// swojej strony). Dalej trasa hali: brama → aleja → stanowisko.
function k7ApproachHub(l, b) {
  if (b.size === 'CAPITAL') return { x: b.x, z: l.frontZ + l.apronDepth + 600 };
  const gate = l.gates.find((g) => g.id === (b.side < 0 ? 'G-03' : 'G-02'));
  return { x: gate.x + gate.nx * 900, z: gate.z + gate.nz * 900 };
}
// Zatoka: pas MEGA — nad wylotem pasa; grzebień — nad wylotem alei.
function bayApproach(l, b) {
  if (b.size === 'MEGA') return { x: bayLaneOf(l, b).x, z: l.openZ + 1500 };
  return { x: l.aisle.x, z: l.openZ + 700 };
}

// Kąt do przedziału (−π, π].
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Obrót grupy ringu dla stacji (Three, wokół +Z) — ten sam, którego używa render
 * i kolizje (`haloRingRotation`). Stacja bez ringu „Halo” → 0.
 */
export function haloPortRotationFor(station) {
  const key = haloRingKey(station);
  return key ? haloRingRotation(key) : 0;
}

/**
 * Układ portu w formacie ruchu v2.
 * `station` — węzeł stacji w układzie gry ({ id, x, y }) = środek planety.
 * `options.rotation` — obrót grupy ringu (Three, wokół +Z; domyślnie z klucza
 *   stacji: Ziemia 0, Mars −π — bez niego stanowiska Marsa wychodziły o 180° obok).
 * `options.roles` — role doków: { k7: 'military', bay: 'civil' }.
 * `options.k7Layouts` — opcjonalnie żywe układy hal (stan zajętości z gry).
 */
export function buildHaloPortTrafficLayout(ringLayout, station = { id: 'earth', x: 0, y: 0 }, options = {}) {
  const sid = String(station.id || 'earth');
  const sx = Number(station.x) || 0;
  const sy = Number(station.y) || 0;
  const rot = Number.isFinite(options.rotation) ? options.rotation : haloPortRotationFor(station);
  const roleK7 = options.roles?.k7 || BERTH_ROLE.MILITARY;
  const roleBay = options.roles?.bay || BERTH_ROLE.CIVIL;
  const toGame = (x, y) => ({ x: sx + x, y: sy - y });
  // Kąt sceny (ring bez obrotu) → kąt w grze (po obrocie grupy, y w dół).
  const gameAngle = (a) => wrapPi(-(a + rot));
  const tmp = {};
  const docks = [];

  haloPortComplexAngles().forEach((angle, c) => {
    const l = options.k7Layouts?.[c] || createK7Layout();
    const f = k7Frame(ringLayout, angle + rot);
    const dockId = `${sid}:K7-${c + 1}`;
    const origin = toGame(f.origin.x, f.origin.y);
    // oś x huba w układzie gry; oś „ly” (obrót o +90°) = oś z huba (na zewnątrz)
    const dockAngle = Math.atan2(-f.ty, f.tx);
    const berths = l.berths.map((b) => {
      const cls = BERTH_CLASSES[K7_TO_CLASS[b.size]];
      const w = k7HubToWorld(f, b.x, b.z, tmp);
      const pos = toGame(w.x, w.y);
      const ap = k7ApproachHub(l, b);
      const aw = k7HubToWorld(f, ap.x, ap.z, tmp);
      const app = toGame(aw.x, aw.y);
      return {
        id: `${dockId}:${b.id}`, dockId, cls: cls.id, rank: cls.rank, role: roleK7,
        length: cls.length, width: cls.width, maxLength: b.maxLength, maxBeam: b.maxBeam,
        lx: b.x, ly: b.z, heading: b.angle, side: b.side ?? 0,
        x: pos.x, y: pos.y, angle: -k7HeadingToWorld(f, b.angle),
        approachX: app.x, approachY: app.y,
        freeAt: 0, occupantId: null,
        complex: c, hall: 'K-7', k7BerthId: b.id, external: false
      };
    });
    docks.push({
      id: dockId, stationId: sid, kind: 'k7', complex: c, role: roleK7,
      x: origin.x, y: origin.y, angle: dockAngle, ringAngle: gameAngle(angle),
      length: 2 * l.halfWidth, width: l.frontZ - l.backZ, attachedToRing: true, berths
    });
  });

  // Otwarte zatoki: stanowiska w standardzie K-7 (pas MEGA + grzebień L/M/S);
  // podejście z przestrzeni nad wylotem pasa / alei.
  for (const bay of options.bayLayouts || haloBayLayouts(ringLayout)) {
    const f = rot ? k7Frame(ringLayout, bay.theta + rot) : bay.frame;
    const dockId = `${sid}:${bay.id}`;
    const origin = toGame(f.origin.x, f.origin.y);
    const berths = bay.berths.map((b) => {
      const cls = BERTH_CLASSES[K7_TO_CLASS[b.size]];
      const w = k7HubToWorld(f, b.x, b.z, tmp);
      const pos = toGame(w.x, w.y);
      const ap = bayApproach(bay, b);
      const aw = k7HubToWorld(f, ap.x, ap.z, tmp);
      const app = toGame(aw.x, aw.y);
      return {
        id: `${dockId}:${b.id}`, dockId, cls: cls.id, rank: cls.rank, role: roleBay,
        length: cls.length, width: cls.width, maxLength: b.maxLength, maxBeam: b.maxBeam,
        lx: b.x, ly: b.z, heading: b.angle, side: b.side ?? 0,
        x: pos.x, y: pos.y, angle: -k7HeadingToWorld(f, b.angle),
        approachX: app.x, approachY: app.y,
        freeAt: 0, occupantId: null,
        complex: bay.complex, hall: 'ZATOKA', bayId: bay.id, k7BerthId: b.id, external: false
      };
    });
    docks.push({
      id: dockId, stationId: sid, kind: 'bay', complex: bay.complex, role: roleBay,
      x: origin.x, y: origin.y, angle: Math.atan2(-f.ty, f.tx), ringAngle: gameAngle(bay.theta),
      length: HALO_PORT.dockLength, width: bay.depth, attachedToRing: true, berths
    });
  }

  // Geometria ringu dla redy (portParking.js): gdzie kończą się płyty
  // kompleksu (K-7 + zatoki) i gdzie leżą tranzyty — wszystko w układzie gry.
  const tpl = haloPortTemplate(ringLayout.radii.floorMid);
  const transit = tpl.rects.find((r) => r.kind === 'transit');
  const complexHalfArc = Math.max(...tpl.rects
    .filter((r) => r.kind !== 'transit')
    .map((r) => Math.abs(r.ds) + r.halfS));

  // doki stoją HALO_PORT.dockGap za krawędzią ringu (od 2026-10-05)
  const dockRadius = ringLayout.radii.rim + HALO_PORT.dockGap + 2000;
  return {
    stationId: sid,
    hasRing: true,
    ringRadius: ringLayout.radii.floorMid,
    dockRadius,
    docks,
    berths: docks.flatMap((d) => d.berths),
    // Orbita postojowa i łuki oczekiwania za kompleksami (port K-7 sięga do r ≈ 54,6 tys.)
    parkingRadius: dockRadius * 1.25,
    parkingSlots: Math.max(8, Math.floor(options.parkingSlots ?? 24)),
    ring: {
      x: sx,
      y: sy,
      rotation: rot,
      floorMid: ringLayout.radii.floorMid,
      rim: ringLayout.radii.rim,
      // środki kompleksów (hala K-7) i osie tranzytów — kąty w grze (y w dół)
      complexAngles: haloPortComplexAngles().map(gameAngle),
      transitAngles: haloTransitAngles().map(gameAngle),
      // pół-rozpiętość płyt kompleksu i tranzytu wzdłuż łuku [j. na floorMid]
      complexHalfArc,
      transitHalfArc: transit ? transit.halfS : 0
    }
  };
}
