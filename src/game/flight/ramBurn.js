// src/game/flight/ramBurn.js
//
// SZARŻA — system okrętu pod F (src/data/shipSystems.js): krótki zryw na wprost do prędkości taranu
// kosztem całego ładunku reaktora. Czysta logika stanu (bez DOM / three); fizykę zrywu (ciąg wzdłuż dziobu,
// limit napędu, przycięty obrót) nakłada physicsStep gracza w index.html z pól tego stanu.
//
// Stan: charge 0..1 (ładunek reaktora), active (zryw trwa), t (czas zrywu). Zryw rusza tylko z pełnego
// ładunku, zużywa go liniowo przez `duration`, potem ładunek odbudowuje się przez `recharge` sekund.
// Przerwanie (hamulec, skok, zniszczenie) kończy zryw i NIE zwraca zużytego ładunku.

export const RAM_BURN_START = 'start';
export const RAM_BURN_END = 'end';
export const RAM_BURN_READY = 'ready';

export function createRamBurn() {
  return { charge: 1, active: false, t: 0, serial: 0 };
}

export function canStartRamBurn(state, def) {
  return !!def && !!state && !state.active && state.charge >= 1;
}

export function startRamBurn(state, def) {
  if (!canStartRamBurn(state, def)) return false;
  state.active = true;
  state.t = 0;
  state.serial++;
  return true;
}

/** Kończy zryw (koniec czasu albo przerwanie). Zwraca true, gdy zryw trwał. */
export function stopRamBurn(state) {
  if (!state || !state.active) return false;
  state.active = false;
  return true;
}

/**
 * Krok stanu. Zwraca RAM_BURN_END, gdy zryw właśnie się skończył, RAM_BURN_READY, gdy ładunek
 * właśnie wrócił do pełna, inaczej ''.
 */
export function stepRamBurn(state, def, dt) {
  if (!state || !def || !(dt > 0)) return '';
  if (state.active) {
    state.t += dt;
    const duration = Math.max(0.1, Number(def.duration) || 1);
    state.charge = Math.max(0, 1 - state.t / duration);
    if (state.t >= duration) {
      state.active = false;
      state.charge = 0;
      return RAM_BURN_END;
    }
    return '';
  }
  if (state.charge < 1) {
    const recharge = Math.max(0.1, Number(def.recharge) || 1);
    state.charge = Math.min(1, state.charge + dt / recharge);
    if (state.charge >= 1) return RAM_BURN_READY;
  }
  return '';
}
