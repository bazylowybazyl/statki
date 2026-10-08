// src/game/skyRegion.js
//
// Jasność tła kosmosu wg strefy gry (prośba użytkownika 2026-10-06: „w pasie asteroid ciemniejsza, pusta
// przestrzeń może być jaśniejsza”). Mnożnik OBRAZU WYŚWIETLANEGO, nie tekstury: tekstura tła jest zapisana
// po odwróceniu ACES gry (src/3d/skybake/skyGameColor.js), więc materiał mgławicy skaluje jasność po stronie
// ekranu i wraca do tekstury (createNebulaMaterial). 1 = tło tak, jak je wypieczono (wypiekacz nieba,
// nastawa „gra”). Strefy jak w detectZones (index.html); przejście płynne (stała czasowa easeSec).
export const SKY_REGION_TUNE = Object.freeze({
  brightness: Object.freeze({
    interplanetary: 1.3,   // pusta przestrzeń — jaśniej
    asteroid_belt: 0.55,   // pas asteroid — ciemniej (skały i zasłona pola na ciemnym niebie)
    sun: 0.9
  }),
  other: 1.0,              // orbity i studnie planet, stacja piratów
  easeSec: 1.5             // stała czasowa przejścia między strefami [s]
});

/** Docelowa jasność tła w strefie `zoneId` (id z detectZones; brak — 1). */
export function skyRegionBrightness(zoneId, tune = SKY_REGION_TUNE) {
  const v = zoneId ? tune.brightness[zoneId] : undefined;
  return Number.isFinite(v) ? v : tune.other;
}

/** Krok wygładzania niezależny od klatki: bieżąca → cel ze stałą czasową tau [s]; dt ≤ 0 — bez zmian. */
export function stepSkyRegion(current, target, dt, tau = SKY_REGION_TUNE.easeSec) {
  if (!(dt > 0)) return current;
  return target + (current - target) * Math.exp(-dt / Math.max(1e-3, tau));
}
