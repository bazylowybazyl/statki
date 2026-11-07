// src/game/sector/sectorFlight.js
//
// LOT W STREFIE MIĘDZYGWIEZDNEJ — statek gracza na mapie gwiezdnej (jak flota gracza w nadprzestrzeni
// Starsectora): ciąg W / S, obrót A / D, „nurt” (Shift: szybciej, dwa razy więcej paliwa), paliwo za
// przebyty rok świetlny, warunki strefy (mgławica spowalnia, burza pcha i pali paliwo).
//
// Liczby (`SECTOR_FLIGHT`): przelot 0,2 ly/s — sąsiad (mediana 4,7 ly) ~25 s, rdzeń (średnica ~40 ly)
// ~3,5 min, cały sektor (160 ly) ~13 min; nurt 0,32 ly/s. Bak Atlasa 100, 2 jedn./ly → zasięg ~50 ly
// (bez nurtu): pogranicze wymaga planowania powrotu jak w Starsectorze. Pusty bak — dryf 0,03 ly/s.
// Krok bez alokacji (`out` warunków strefy podaje wołający). Moduł czysty.

import { zoneAt, createZoneSample } from './sectorZone.js';

export const SECTOR_FLIGHT = Object.freeze({
  /** Prędkość przelotowa [ly/s]. */
  cruise: 0.2,
  /** Nurt (Shift): mnożnik prędkości i paliwa. */
  burnMul: 1.6,
  burnFuelMul: 2.0,
  /** Przyspieszenie / hamowanie [ly/s²]. */
  accel: 0.09,
  brake: 0.16,
  /** Opór bez ciągu [1/s] — statek na mapie sam wytraca prędkość (flota stoi, gdy nic nie robi). */
  drag: 0.45,
  /** Zbijanie nadmiaru prędkości ponad limit [1/s] (wejście w mgławicę, koniec nurtu). */
  overspeedDecay: 1.6,
  /** Obrót [rad/s]. */
  turn: 2.4,
  fuelMax: 100,
  fuelPerLy: 2.0,
  /** Bez paliwa: najwyższa prędkość [ly/s]. */
  dryMaxSpeed: 0.03,
  /** Zasięg czujników [ly] (floty w strefie; × mnożnik strefy patrzącego i celu). */
  sensorRange: 6,
  /** Skan układu: zasięg [ly] i czas [s] przebywania w nim. */
  scanRange: 3.5,
  scanTime: 2.5,
  /** Tankowanie w układzie zamieszkanym [jedn./s] (demo; w grze — w porcie układu). */
  refuelRate: 25
});

/** Nowy statek w strefie. */
export function createShip(x = 0, y = 0, heading = 0, fuel = SECTOR_FLIGHT.fuelMax) {
  return { x, y, vx: 0, vy: 0, heading, fuel, burn: false, speed: 0, maxSpeed: SECTOR_FLIGHT.cruise, traveled: 0, zone: createZoneSample() };
}

/**
 * Krok lotu. `input` { thrust ∈ [−1, 1] (W = 1, S = −1), turn ∈ [−1, 1] (D = 1), burn (bool) }, `t` — zegar
 * strefy [s] (burze). Paliwo liczy się od drogi (bez wiatru — wiatr burzy jest za darmo). Zwraca statek.
 */
export function stepShip(ship, input, dt, sector, t) {
  const F = SECTOR_FLIGHT;
  const z = zoneAt(sector, ship.x, ship.y, t, ship.zone);
  ship.heading += (input.turn || 0) * F.turn * dt;
  const burn = !!input.burn && ship.fuel > 0 && (input.thrust || 0) > 0;
  ship.burn = burn;
  let vmax = F.cruise * (burn ? F.burnMul : 1) * z.speedMul;
  if (ship.fuel <= 0) vmax = Math.min(vmax, F.dryMaxSpeed);
  ship.maxSpeed = vmax;
  const hx = Math.cos(ship.heading);
  const hy = Math.sin(ship.heading);
  const thrust = input.thrust || 0;
  if (thrust > 0) {
    // Ciąg dokłada prędkość wzdłuż kursu tylko do limitu (nadmiar — np. po wejściu w mgławicę — zbija niżej).
    const along0 = ship.vx * hx + ship.vy * hy;
    if (along0 < vmax) {
      const add = Math.min(F.accel * thrust * (burn ? F.burnMul : 1) * dt, vmax - along0);
      ship.vx += hx * add;
      ship.vy += hy * add;
    }
  } else if (thrust < 0) {
    // S = hamowanie do zera (nie cofanie — mapa, nie walka).
    const sp = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
    const dv = Math.min(sp, F.brake * -thrust * dt);
    if (sp > 1e-9) {
      ship.vx -= ship.vx / sp * dv;
      ship.vy -= ship.vy / sp * dv;
    }
  } else {
    const k = Math.exp(-F.drag * dt);
    ship.vx *= k;
    ship.vy *= k;
  }
  // Ster: składowa prędkości poprzeczna do kursu gaśnie (lot „po szynach” jak na mapie Starsectora).
  const along = ship.vx * hx + ship.vy * hy;
  const side = -ship.vx * hy + ship.vy * hx;
  const sideK = Math.exp(-3.0 * dt);
  ship.vx = hx * along - hy * side * sideK;
  ship.vy = hy * along + hx * side * sideK;
  let sp = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
  if (sp > vmax) {
    const target = vmax + (sp - vmax) * Math.exp(-F.overspeedDecay * dt);
    ship.vx *= target / sp;
    ship.vy *= target / sp;
    sp = target;
  }
  const dx = ship.vx * dt;
  const dy = ship.vy * dt;
  ship.x += dx + z.windX * dt;
  ship.y += dy + z.windY * dt;
  const dist = sp * dt;
  ship.traveled += dist;
  if (ship.fuel > 0) ship.fuel = Math.max(0, ship.fuel - dist * F.fuelPerLy * (burn ? F.burnFuelMul : 1) * z.fuelMul);
  ship.speed = sp;
  // Brzeg sektora: miękka ściana.
  const B = sector.bounds;
  if (ship.x < B.x0) { ship.x = B.x0; ship.vx = Math.max(0, ship.vx); }
  if (ship.x > B.x1) { ship.x = B.x1; ship.vx = Math.min(0, ship.vx); }
  if (ship.y < B.y0) { ship.y = B.y0; ship.vy = Math.max(0, ship.vy); }
  if (ship.y > B.y1) { ship.y = B.y1; ship.vy = Math.min(0, ship.vy); }
  return ship;
}

/** Paliwo na odcinek [jedn.] (UI trasy: ile spali lot do układu) — bez mgławic i burz. */
export function fuelForDistance(ly, burn = false) {
  return ly * SECTOR_FLIGHT.fuelPerLy * (burn ? SECTOR_FLIGHT.burnFuelMul : 1);
}

/** Czas lotu na odcinek [s] przy prędkości przelotowej (UI) — bez rozpędzania i mgławic. */
export function timeForDistance(ly, burn = false) {
  return ly / (SECTOR_FLIGHT.cruise * (burn ? SECTOR_FLIGHT.burnMul : 1));
}
