// src/data/shipSystems.js
//
// Systemy okrętu pod klawiszem F (jak system okrętu w Starsectorze) — mają je tylko niektóre kadłuby.
// Dziś jeden rodzaj: SZARŻA (`ram_burn`) — krótki zryw na wprost do prędkości taranu kosztem całego
// ładunku reaktora (decyzja użytkownika 2026-10-01: „pełna prędkość zżerająca reaktor za krótki boost”,
// zryw 3000 j/s). Logika: src/game/flight/ramBurn.js, fizyka gracza: physicsStep w index.html.
//
// Pola szarży:
//   speed     — prędkość zrywu [j/s] (limit napędu na czas zrywu); pomiar taranu na silniku belek:
//               ~500 j/s miażdży fregaty, ~2000 niszczyciele, ~3000 pancerniki
//   accel     — przyspieszenie wzdłuż dziobu w trakcie zrywu [j/s²]
//   duration  — czas zrywu [s] (ładunek reaktora schodzi w tym czasie z 1 do 0)
//   recharge  — odbudowa ładunku od zera do pełna [s]; zryw rusza tylko z pełnego
//   turnScale — ułamek zwrotności w trakcie zrywu (okręt leci tam, gdzie patrzy dziób)
//   brake     — hamowanie napędu po zrywie, z powrotem do limitu bojowego [j/s²]

export const SHIP_SYSTEMS = Object.freeze({
  atlas: Object.freeze({
    id: 'ram_burn', label: 'SZARŻA',
    speed: 3000, accel: 1100, duration: 5, recharge: 28, turnScale: 0.22, brake: 650
  }),
  // Iron Skull — ciężki taran piratów.
  pirate_battleship: Object.freeze({
    id: 'ram_burn', label: 'SZARŻA',
    speed: 2600, accel: 1200, duration: 4, recharge: 24, turnScale: 0.3, brake: 700
  }),
  // Colossus.
  supercapital: Object.freeze({
    id: 'ram_burn', label: 'SZARŻA',
    speed: 2600, accel: 950, duration: 5, recharge: 30, turnScale: 0.22, brake: 600
  })
});

/** System okrętu dla kadłuba gracza (PLAYER.activeHullId) albo null. */
export function shipSystemFor(hullId) {
  return SHIP_SYSTEMS[String(hullId || '').trim().toLowerCase()] || null;
}
