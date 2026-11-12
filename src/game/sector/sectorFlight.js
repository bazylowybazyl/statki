// src/game/sector/sectorFlight.js
//
// LOT W STREFIE MIĘDZYGWIEZDNEJ — statek gracza na mapie gwiezdnej (jak flota gracza w nadprzestrzeni
// Starsectora): ciąg W / S, obrót A / D, „nurt” (Shift: szybciej, dwa razy więcej paliwa), paliwo za
// przebyty rok świetlny, warunki strefy (mgławica spowalnia, burza pcha i pali paliwo).
//
// CIĘŻKI LOT (uwaga użytkownika 2026-11-08: „za mocno skręca, nie czuć, że statki lecą w nadprzestrzeni”):
//   • NAPĘD rozkręca się (`drive` 0 → 1, nurt → 1,6) w ~1,7 s i gaśnie w ~0,8 s — ciąg i limit prędkości idą za nim;
//   • OBRÓT z bezwładnością: prędkość kątowa `omega` rośnie z `turnAccel`, hamuje z `turnBrake`, a jej limit
//     maleje z prędkością (`turnRateAt`: turn / (1 + turnSpeedK · v / przelot)) — promień zakrętu przy przelocie
//     ~0,36 ly, w nurcie ~0,8 ly;
//   • POŚLIZG: składowa prędkości poprzeczna do kursu gaśnie powoli (`slip`) — w zakręcie statek znosi na
//     zewnątrz, zanim ciąg go wyprostuje; bez ciągu ośrodek strefy hamuje (`drag`).
// Liczby (`SECTOR_FLIGHT`): przelot 0,2 ly/s — sąsiad (mediana 4,0 ly) ~20 s, rdzeń (średnica ~40 ly)
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
  /** Przyspieszenie / hamowanie [ly/s²] (przyspieszenie rośnie z poziomem napędu). */
  accel: 0.08,
  brake: 0.12,
  /** Napęd: rozkręcanie / gaśnięcie poziomu [1/s] (0 → 1 w ~1,7 s). */
  spoolUp: 0.6,
  spoolDown: 1.25,
  /** Opór ośrodka bez ciągu [1/s] — statek sam wytraca prędkość (flota stoi, gdy nic nie robi). */
  drag: 0.3,
  /** Zbijanie nadmiaru prędkości ponad limit [1/s] (wejście w mgławicę, koniec nurtu). */
  overspeedDecay: 1.2,
  /** Obrót: najwyższa prędkość kątowa w miejscu [rad/s], spadek z prędkością (× 1 / (1 + k · v / przelot)). */
  turn: 1.1,
  turnSpeedK: 1.0,
  /** Przyspieszenie / hamowanie obrotu [rad/s²]. */
  turnAccel: 1.4,
  turnBrake: 2.2,
  /** Gaśnięcie poślizgu (prędkości poprzecznej do kursu) [1/s]. */
  slip: 1.8,
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

/** Nowy statek w strefie (`omega` — prędkość kątowa [rad/s], `drive` — poziom napędu 0…nurt, `slide` — poślizg [ly/s]). */
export function createShip(x = 0, y = 0, heading = 0, fuel = SECTOR_FLIGHT.fuelMax) {
  return {
    x, y, vx: 0, vy: 0, heading, omega: 0, drive: 0, slide: 0, fuel, burn: false, speed: 0,
    maxSpeed: SECTOR_FLIGHT.cruise, traveled: 0, zone: createZoneSample()
  };
}

/** Najwyższa prędkość kątowa przy prędkości `speed` [rad/s]. */
export function turnRateAt(speed) {
  const F = SECTOR_FLIGHT;
  return F.turn / (1 + F.turnSpeedK * speed / F.cruise);
}

/**
 * Krok lotu. `input` { thrust ∈ [−1, 1] (W = 1, S = −1), turn ∈ [−1, 1] (D = 1), burn (bool) }, `t` — zegar
 * strefy [s] (burze). Paliwo liczy się od drogi (bez wiatru — wiatr burzy jest za darmo). Zwraca statek.
 */
export function stepShip(ship, input, dt, sector, t) {
  const F = SECTOR_FLIGHT;
  const z = zoneAt(sector, ship.x, ship.y, t, ship.zone);
  const thrust = input.thrust || 0;
  // Obrót z bezwładnością: do zadanej prędkości kątowej z ograniczonym przyspieszeniem.
  const want = Math.max(-1, Math.min(1, input.turn || 0)) * turnRateAt(ship.speed);
  const speeding = want !== 0 && (ship.omega === 0 || Math.sign(want) === Math.sign(ship.omega)) && Math.abs(want) > Math.abs(ship.omega);
  const dwMax = (speeding ? F.turnAccel : F.turnBrake) * dt;
  ship.omega += Math.max(-dwMax, Math.min(dwMax, want - ship.omega));
  ship.heading += ship.omega * dt;
  // Napęd: poziom idzie powoli za ciągiem (nurt — wyżej), bez paliwa najwyżej do dryfu.
  const burn = !!input.burn && ship.fuel > 0 && thrust > 0;
  ship.burn = burn;
  let target = thrust > 0 ? thrust * (burn ? F.burnMul : 1) : 0;
  if (ship.fuel <= 0) target = Math.min(target, F.dryMaxSpeed / F.cruise);
  const rate = (target > ship.drive ? F.spoolUp : F.spoolDown) * dt;
  ship.drive += Math.max(-rate, Math.min(rate, target - ship.drive));
  const vmax = F.cruise * Math.max(ship.drive, 0) * z.speedMul;
  // Sufit prędkości: przelot (nurt — z poziomem napędu), bez paliwa — dryf.
  const cap = ship.fuel > 0 ? F.cruise * Math.max(1, ship.drive) * z.speedMul : F.dryMaxSpeed;
  ship.maxSpeed = cap;
  const hx = Math.cos(ship.heading);
  const hy = Math.sin(ship.heading);
  if (thrust > 0) {
    // Ciąg dokłada prędkość wzdłuż kursu do limitu napędu (nadmiar — np. po wejściu w mgławicę — zbija niżej).
    const along0 = ship.vx * hx + ship.vy * hy;
    if (along0 < vmax) {
      const add = Math.min(F.accel * (0.35 + 0.65 * Math.min(1, ship.drive)) * (burn ? F.burnMul : 1) * dt, vmax - along0);
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
  // Poślizg: składowa prędkości poprzeczna do kursu gaśnie powoli (w zakręcie statek znosi na zewnątrz).
  const along = ship.vx * hx + ship.vy * hy;
  const side = (-ship.vx * hy + ship.vy * hx) * Math.exp(-F.slip * dt);
  ship.vx = hx * along - hy * side;
  ship.vy = hy * along + hx * side;
  ship.slide = side;
  let sp = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
  if (sp > cap) {
    const tgt = cap + (sp - cap) * Math.exp(-F.overspeedDecay * dt);
    ship.vx *= tgt / sp;
    ship.vy *= tgt / sp;
    sp = tgt;
  }
  const dx = ship.vx * dt;
  const dy = ship.vy * dt;
  ship.x += dx + z.windX * dt;
  ship.y += dy + z.windY * dt;
  const dist = sp * dt;
  ship.traveled += dist;
  // Paliwo: nurt liczy się z poziomu napędu ponad przelot (płynnie przy rozkręcaniu i gaśnięciu).
  const burnK = Math.max(0, Math.min(1, (ship.drive - 1) / (F.burnMul - 1)));
  if (ship.fuel > 0) ship.fuel = Math.max(0, ship.fuel - dist * F.fuelPerLy * (1 + (F.burnFuelMul - 1) * burnK) * z.fuelMul);
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
