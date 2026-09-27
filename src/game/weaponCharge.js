/**
 * weaponCharge — ładowanie dział przed strzałem i kolejka serii (zadanie 18, docs/webgpu/PROJEKT-BRONI.md
 * §2.4–2.5, §5 p. 3, 4, 7). Czysty moduł: bez Math.random, bez alokacji w kroku; stan w
 * obiekcie wołającego (jeden na działo — w demie stan był globalny, `ctx._chargeT`).
 *
 * Ładowanie jak w demie (dema/bronie-webgpu/gunnery.js `_chargeStep`): naciśnięcie przy
 * błędzie celowania ≤ 0,08 rad zaczyna ładowanie `chargeTime` (Mjolnir 3,0 s, Valkyrie
 * 0,28 s); ładowanie trwa bez trzymania spustu (gracz naciska raz — klawisz 2 — a auto-fire
 * woła co klatkę); strzał po naładowaniu, gdy błąd celowania ≤ 0,03 rad. `requiresStationary`
 * (Mjolnir): statek stoi, gdy |v| ≤ 30 j/s i |ω| ≤ 0,05 rad/s — ruch nie pozwala zacząć i
 * przerywa ładowanie. Naładowane działo, które nie może wycelować przez `holdMax`, gaśnie
 * (w demie czekało bez końca).
 *
 * Seria (Hexlance): `burstCount` strzałów z każdego gniazda co `burstDelay`, kolejno
 * gniazdo po gnieździe; kolejka w tej samej postaci co `superweaponState.queue`
 * (src/game/superweapon.js), opóźnienia WZGLĘDNE (od poprzedniego strzału) — tak je
 * odczytuje pętla opróżniania (stepBurstQueue = jej kopia). Wpięcie — 18-B.
 */

export const CHARGE_IDLE = 'idle';
export const CHARGE_CHARGING = 'charging';
export const CHARGE_FIRE = 'fire';
export const CHARGE_CANCEL = 'cancel';

export const CHARGE_CONFIG = {
  startAimErr: 0.08,        // [rad] demo: ładowanie zaczyna się przy błędzie celowania < 0,08
  fireAimErr: 0.03,         // [rad] demo: strzał po naładowaniu przy błędzie < 0,03
  stationarySpeed: 30,      // [j/s] decyzja §5 p. 7: postój = |v| ≤ 30 j/s …
  stationaryAngVel: 0.05,   // [rad/s] … i |ω| ≤ 0,05 rad/s
  holdMax: 2.0              // [s] naładowane działo bez celu gaśnie po tym czasie
};

const CC = CHARGE_CONFIG;

/** Stan ładowania jednego działa. charge < 0 — bezczynne; u — postęp 0..1 (efekt ładowania). */
export function createChargeState() {
  return { charge: -1, u: 0, hold: 0, reason: '' };
}

/** Czas ładowania broni [s] (`chargeTime`; 0 = strzela bez ładowania). */
export function chargeTimeOf(def) {
  const t = Number(def?.chargeTime);
  return t > 0 ? t : 0;
}

/** Czy statek stoi w sensie `requiresStationary`. */
export function isStationary(speed, angVel) {
  return Math.abs(Number(speed) || 0) <= CC.stationarySpeed &&
    Math.abs(Number(angVel) || 0) <= CC.stationaryAngVel;
}

/** Przerwanie z zewnątrz (zmiana broni, skok, śmierć). */
export function cancelCharge(state) {
  state.charge = -1;
  state.u = 0;
  state.hold = 0;
  return state;
}

/**
 * Krok ładowania działa. input: { wantFire, aimErr, speed, angVel, ready } — naciśnięcie /
 * auto-fire, błąd celowania wieżyczki [rad], |v| i ω statku, `ready` = przeładowanie
 * skończone (domyślnie true). Zwraca:
 *  - CHARGE_IDLE — nic się nie dzieje (state.reason: 'cooldown' | 'moving' | 'aim', gdy
 *    naciśnięcie odrzucono — dla komunikatu HUD);
 *  - CHARGE_CHARGING — ładuje (state.u = postęp; pełne i czeka na cel: reason 'aim');
 *  - CHARGE_FIRE — strzał teraz (wołający strzela i ustawia przeładowanie);
 *  - CHARGE_CANCEL — ładowanie przerwane (ruch przy `requiresStationary`, brak celu przez holdMax).
 * Broń bez `chargeTime` strzela od razu na naciśnięcie (te same bramki).
 */
export function stepCharge(state, dt, input, def) {
  const T = chargeTimeOf(def);
  const wantFire = !!input?.wantFire;
  const aimErr = Math.abs(Number(input?.aimErr) || 0);
  const ready = input?.ready !== false;
  const still = def?.requiresStationary !== true || isStationary(input?.speed, input?.angVel);
  state.reason = '';
  if (!(state.charge >= 0)) {
    state.u = 0;
    if (!wantFire) return CHARGE_IDLE;
    if (!ready) { state.reason = 'cooldown'; return CHARGE_IDLE; }
    if (!still) { state.reason = 'moving'; return CHARGE_IDLE; }
    if (aimErr > CC.startAimErr) { state.reason = 'aim'; return CHARGE_IDLE; }
    if (T <= 0) { state.u = 1; return CHARGE_FIRE; }
    state.charge = 0;
    state.hold = 0;
  } else if (!still) {
    cancelCharge(state);
    state.reason = 'moving';
    return CHARGE_CANCEL;
  }
  const step = Math.max(0, Number(dt) || 0);
  state.charge += step;
  state.u = T > 0 ? Math.min(1, state.charge / T) : 1;
  if (state.charge >= T) {
    if (aimErr <= CC.fireAimErr) {
      state.charge = -1;
      state.hold = 0;
      state.u = 1;
      return CHARGE_FIRE;
    }
    state.hold += step;
    if (state.hold > CC.holdMax) {
      cancelCharge(state);
      state.reason = 'aim';
      return CHARGE_CANCEL;
    }
    state.reason = 'aim';
  }
  return CHARGE_CHARGING;
}

// ============================ SERIE (HEXLANCE) ============================

/** Strzałów na gniazdo w serii (`burstCount`, min. 1). */
export function burstCountOf(def) {
  const n = Math.round(Number(def?.burstCount));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Odstęp strzałów serii [s] (`burstDelay`); jak getHexlanceStat — wartość ≤ 0 = fallback. */
export function burstDelayOf(def, fallback = 0.12) {
  const d = Number(def?.burstDelay);
  return Number.isFinite(d) && d > 0 ? d : fallback;
}

/**
 * Kolejka serii: `burstCount` × `mountCount` strzałów gniazdo po gnieździe (0, 1, …, 0, 1, …),
 * pierwszy od razu (delay 0), każdy następny `burstDelay` po poprzednim (opóźnienia względne,
 * jak czyta je stepBurstQueue i pętla w updateSuperweapon). Wpisy { cannonIndex, delay } —
 * obiekty z `out` użyte ponownie.
 */
export function buildBurstQueue(mountCount, burstCount, burstDelay, out = []) {
  const mounts = Math.max(0, Math.floor(Number(mountCount) || 0));
  const bursts = Math.max(1, Math.floor(Number(burstCount) || 1));
  const delay = Math.max(0, Number(burstDelay) || 0);
  const n = mounts * bursts;
  for (let k = 0; k < n; k++) {
    let entry = out[k];
    if (!entry || typeof entry !== 'object') entry = out[k] = { cannonIndex: 0, delay: 0 };
    entry.cannonIndex = k % mounts;
    entry.delay = k === 0 ? 0 : delay;
  }
  out.length = n;
  return out;
}

/** Kolejka serii Hexlance'a z danych broni (burstCount 4, burstDelay 0,25 s). */
export function buildHexlanceBurst(def, mountCount, out = []) {
  return buildBurstQueue(mountCount, burstCountOf(def), burstDelayOf(def, 0.12), out);
}

/**
 * Krok kolejki serii — ta sama pętla co w updateSuperweapon: czas schodzi z głowy kolejki,
 * strzał, gdy dojdzie do zera, nadwyżka przechodzi na następny wpis (bez dryfu rytmu).
 * `fire(cannonIndex, k)` oddaje strzał; zwraca liczbę strzałów w tym kroku.
 */
export function stepBurstQueue(queue, dt, fire) {
  if (!queue || queue.length === 0) return 0;
  queue[0].delay -= Math.max(0, Number(dt) || 0);
  let fired = 0;
  while (queue.length > 0 && queue[0].delay <= 0) {
    const shot = queue.shift();
    if (typeof fire === 'function') fire(shot.cannonIndex, fired);
    fired++;
    if (queue.length > 0) queue[0].delay += shot.delay;
  }
  return fired;
}
