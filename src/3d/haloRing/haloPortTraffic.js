// Port Ziemi dla ruchu v2 (src/game/traffic/): hale K-7 i zatoki transportowe
// ringu „Halo” jako układ doków w formacie `buildStationDocks` z
// dockLayout.js — dyspozytor portu (portControl), findBerth / reserveBerth /
// berthOccupancy i widok ruch-v2.html biorą go bez zmian. K-7 zastępuje
// „teoretyczny” dok ruchu v2 (decyzja użytkownika 2026-09-23).
//
// Skład (4 kompleksy co 90°): w każdej hali 4 capital, 4 L, 8 M, 12 S; przy
// każdej hali 2 otwarte zatoki (po jednej z każdej strony) ze stanowiskami
// w standardzie K-7 (haloPortBays.js): 2 pasy MEGA (megafrachtowiec 2760 ×
// 912 j. dziobem do podłogi; wolny pas biorą też mniejsze kadłuby) i podwójny
// grzebień 4 L, 4 M, 4 S. Razem 224 stanowiska: 16 capital, 16 mega, 48 L,
// 64 M, 80 S (teoretyczny port ruchu v2 ma 260; wynik symulacji:
// docs/PORT-halo-ring.md).
//
// Współrzędne: układ lokalny ringu (scena XY) → gra: (x, y) → (stacja.x + x,
// stacja.y − y), kąty z przeciwnym znakiem (Three odwraca oś y gry).
// Czysta matematyka, bez Three.
import { BERTH_CLASSES } from '../../game/traffic/dockLayout.js';
import { HALO_PORT, haloPortComplexAngles } from './haloRingConfig.js';
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

/**
 * Układ portu Ziemi w formacie ruchu v2.
 * `station` — węzeł stacji w układzie gry ({ id, x, y }).
 * `options.k7Layouts` — opcjonalnie żywe układy hal (stan zajętości z gry).
 */
export function buildHaloPortTrafficLayout(ringLayout, station = { id: 'earth', x: 0, y: 0 }, options = {}) {
  const sid = String(station.id || 'earth');
  const sx = Number(station.x) || 0;
  const sy = Number(station.y) || 0;
  const toGame = (x, y) => ({ x: sx + x, y: sy - y });
  const tmp = {};
  const docks = [];

  haloPortComplexAngles().forEach((angle, c) => {
    const l = options.k7Layouts?.[c] || createK7Layout();
    const f = k7Frame(ringLayout, angle);
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
        id: `${dockId}:${b.id}`, dockId, cls: cls.id, rank: cls.rank,
        length: cls.length, width: cls.width,
        lx: b.x, ly: b.z, heading: b.angle, side: b.side ?? 0,
        x: pos.x, y: pos.y, angle: -k7HeadingToWorld(f, b.angle),
        approachX: app.x, approachY: app.y,
        freeAt: 0, occupantId: null,
        complex: c, hall: 'K-7', k7BerthId: b.id, external: false
      };
    });
    docks.push({
      id: dockId, stationId: sid, kind: 'k7', complex: c,
      x: origin.x, y: origin.y, angle: dockAngle, ringAngle: -angle,
      length: 2 * l.halfWidth, width: l.frontZ - l.backZ, attachedToRing: true, berths
    });
  });

  // Otwarte zatoki: stanowiska w standardzie K-7 (pas MEGA + grzebień L/M/S);
  // podejście z przestrzeni nad wylotem pasa / alei.
  for (const bay of options.bayLayouts || haloBayLayouts(ringLayout)) {
    const f = bay.frame;
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
        id: `${dockId}:${b.id}`, dockId, cls: cls.id, rank: cls.rank,
        length: cls.length, width: cls.width,
        lx: b.x, ly: b.z, heading: b.angle, side: b.side ?? 0,
        x: pos.x, y: pos.y, angle: -k7HeadingToWorld(f, b.angle),
        approachX: app.x, approachY: app.y,
        freeAt: 0, occupantId: null,
        complex: bay.complex, hall: 'ZATOKA', bayId: bay.id, k7BerthId: b.id, external: false
      };
    });
    docks.push({
      id: dockId, stationId: sid, kind: 'bay', complex: bay.complex,
      x: origin.x, y: origin.y, angle: Math.atan2(-f.ty, f.tx), ringAngle: -bay.theta,
      length: HALO_PORT.dockLength, width: bay.depth, attachedToRing: true, berths
    });
  }

  const dockRadius = ringLayout.radii.rim + 2000;
  return {
    stationId: sid,
    hasRing: true,
    ringRadius: ringLayout.radii.floorMid,
    dockRadius,
    docks,
    berths: docks.flatMap((d) => d.berths),
    // Orbita postojowa i łuki oczekiwania za kompleksami (port K-7 sięga do r ≈ 51 tys.)
    parkingRadius: dockRadius * 1.25,
    parkingSlots: Math.max(8, Math.floor(options.parkingSlots ?? 24))
  };
}
