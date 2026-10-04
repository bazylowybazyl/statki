// Simulation-owned aim, one persistent state per physical hardpoint.
// Loadout wrappers are rebuilt when equipment changes, so key by hp instead.
const aims = new WeakMap();
const arcs = new WeakMap();
const TAU = Math.PI * 2;
const wrap = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Obrót wieży zależy od ROZMIARU broni (2026-10-01, docs/BRIEF-kierowanie-ogniem.md): lekkie działa
// nadążają za fregatą z bliska, ciężka bateria — za niszczycielem i pancernikiem, ale nie za fregatą
// tuż przy burcie (przy walce na 1,6 km cel w poprzek to: pancernik ~25°/s, niszczyciel ~37°/s,
// fregata ~50°/s). Dawniej każda wieża, od CIWS po Yamato, miała 126°/s (`ship.turret`).
export const TURRET_TRAVERSE = Object.freeze({
  S: Object.freeze({ maxSpeed: 2.2, maxAccel: 12, damping: 3 }),       // 126°/s
  M: Object.freeze({ maxSpeed: 1.57, maxAccel: 9, damping: 3 }),       //  90°/s
  L: Object.freeze({ maxSpeed: 1.05, maxAccel: 6.5, damping: 3 }),     //  60°/s
  Capital: Object.freeze({ maxSpeed: 0.75, maxAccel: 4.5, damping: 3 }) // 43°/s
});

// ŁUKI OSTRZAŁU (2026-10-01, decyzja użytkownika): wieża nie obraca się przez własny kadłub.
//   • działa (main) — 180°, środek łuku w stronę, w którą gniazdo patrzy z kadłuba: burta, dziób, rufa,
//     a gniazdo na rogu kadłuba — po ukosie (8 kierunków co 45°);
//   • broń specjalna — 270°, środek w burtę / dziób / rufę (4 kierunki co 90°): bateria prawej burty
//     nie strzela w lewo przez pokład i odwrotnie (martwy klin 90° w stronę przeciwnej burty).
// Kierunek gniazda = normalna obrysu kadłuba (elipsa o półosiach połowa długości × połowa szerokości)
// w miejscu gniazda, zaokrąglona do kroku. Łuk jest w układzie KADŁUBA (kąt 0 = dziób, oś y = burty).
// Dotyczy trybu „Dowodzenie” (src/game/fireControl.js) i dział NPC (capitalAI.js); klasyczne sterowanie — bez łuków.
export const MOUNT_ARCS = Object.freeze({
  main: Object.freeze({ half: Math.PI / 2, step: Math.PI / 4 }),
  special: Object.freeze({ half: Math.PI * 0.75, step: Math.PI / 2 })
});

/**
 * Łuk ostrzału gniazda: `{ center, half }` [rad, układ kadłuba] albo null (grupa bez łuku — 360°).
 * `halfLen` / `halfWid` — połowa długości (oś x kadłuba) i szerokości (oś y). Wynik zapamiętany na gnieździe.
 */
export function mountFireArc(hp, group, halfLen, halfWid) {
  const def = MOUNT_ARCS[group];
  if (!def || !hp) return null;
  const p = hp.pos || hp;
  const x = Number(p.x) || 0;
  const y = Number(p.y) || 0;
  const a = Math.max(1, Number(halfLen) || 1);
  const b = Math.max(1, Number(halfWid) || 1);
  // Pamięć w WeakMap, nie na gnieździe — gniazda gracza idą do zapisu (localStorage).
  const cached = arcs.get(hp);
  if (cached && cached.group === group && cached.x === x && cached.y === y && cached.a === a && cached.b === b) return cached;
  const nx = x / (a * a);
  const ny = y / (b * b);
  const raw = nx === 0 && ny === 0 ? 0 : Math.atan2(ny, nx);
  const center = wrap(Math.round(raw / def.step) * def.step);
  const arc = { group, x, y, a, b, center, half: def.half };
  arcs.set(hp, arc);
  return arc;
}

/** Czy kierunek `bearing` [rad, świat] mieści się w łuku gniazda okrętu o kursie `shipAngle`. */
export function bearingInArc(arc, shipAngle, bearing) {
  if (!arc || arc.half >= Math.PI) return true;
  return Math.abs(wrap(bearing - (shipAngle + arc.center))) <= arc.half + 1e-9;
}

/** Napęd wieży dla broni (po rozmiarze); `fallback` — gdy broń nie ma znanego rozmiaru. */
export function turretDriveFor(weapon, fallback = null) {
  return TURRET_TRAVERSE[weapon?.size] || fallback || TURRET_TRAVERSE.M;
}

export function getMountedWeaponAim(ship, loadout) {
  const hp = loadout.hp;
  let state = aims.get(hp);
  if (!state) {
    const angle = Number(ship.angle) || 0;
    // aimErr — błąd celowania po ostatnim kroku [rad] (ładowanie Mjolnira / Valkyrie,
    // src/game/weaponCharge.js; bramka strzału baterii — src/game/fireControl.js);
    // charge — stan ładowania zaczepu (tworzy go weaponCharge); prevDesired — kąt zadany
    // z poprzedniego kroku (człon prędkości wieży).
    state = { angle, previousAngle: angle, angVel: 0, target: null, nextBarrel: 0, aimErr: Math.PI, charge: null, prevDesired: null };
    aims.set(hp, state);
  }
  return state;
}

export function mountedWeaponBase(ship, hp, out) {
  // Player hp.pos is already in world-sized hull units, as in hull collision.
  const offset = hp.pos || hp;
  const x = Number(offset.x) || 0;
  const y = Number(offset.y) || 0;
  const c = Math.cos(ship.angle || 0);
  const s = Math.sin(ship.angle || 0);
  out.x = ship.pos.x + x * c - y * s;
  out.y = ship.pos.y + x * s + y * c;
  return out;
}

// Regulator wieży: zadana prędkość = wzmocnienie × uchyb + PRĘDKOŚĆ KĄTOWA PUNKTU CELOWANIA.
// Sam uchyb (dawniej) dawał stałe opóźnienie ω / 6,3 rad za celem w ruchu — a pocisk gracza leci
// wzdłuż lufy, więc każdy strzał do celu lecącego w poprzek lądował za nim o v / 6,3 j. niezależnie
// od zasięgu (fregata 1400 j/s: 220 j. przy połowie kadłuba 96 j.). Człon prędkości zeruje to pudło.
// Skok punktu celowania (zmiana celu, kursor) nie jest prędkością — odrzucany powyżej 4 × maxSpeed.
//
// Łuk ostrzału (`arc` z mountFireArc, `shipAngle` — kurs kadłuba): kąt zadany przycięty do łuku, wieża
// jedzie do niego drogą PRZEZ łuk (nigdy przez martwy sektor nad kadłubem), a obrót kadłuba, który
// wypycha lufę poza łuk, dociska ją do krawędzi. Błąd celowania liczony do PRAWDZIWEGO kierunku celu —
// cel poza łukiem = duży błąd = brak strzału (bramka strzału w fireControl.js).
export function stepMountedWeaponAim(state, base, aimPoint, dt, drive, arc = null, shipAngle = 0) {
  state.previousAngle = state.angle;
  if (!(dt > 0)) {
    state.prevDesired = null;
    return;
  }
  const dx = aimPoint.x - base.x;
  const dy = aimPoint.y - base.y;
  const desired = dx * dx + dy * dy > 1e-12 ? Math.atan2(dy, dx) : state.angle;
  const maxSpeed = drive?.maxSpeed ?? 2.2;
  const maxAccel = drive?.maxAccel ?? 12;
  const damping = drive?.damping ?? 3;
  const limited = !!arc && arc.half < Math.PI;
  let goal = desired;
  let center = 0;
  let clipped = false;
  if (limited) {
    center = shipAngle + arc.center;
    const rel = wrap(desired - center);
    if (rel > arc.half || rel < -arc.half) {
      goal = center + (rel > 0 ? arc.half : -arc.half);
      clipped = true;
    }
    // Obrót kadłuba wypchnął lufę poza łuk: dociśnij do krawędzi i wytrać prędkość w tę stronę.
    const cur = wrap(state.angle - center);
    if (cur > arc.half || cur < -arc.half) {
      state.angle = wrap(center + (cur > 0 ? arc.half : -arc.half));
      if ((cur > 0 && state.angVel > 0) || (cur < 0 && state.angVel < 0)) state.angVel = 0;
    }
  }
  let rate = 0;
  if (state.prevDesired != null && !clipped) {
    rate = wrap(desired - state.prevDesired) / dt;
    if (Math.abs(rate) > maxSpeed * 4) rate = 0;
  }
  state.prevDesired = clipped ? null : desired;
  // W łuku uchyb liczony liniowo względem środka łuku — droga zawsze przez łuk, nie najkrótsza przez kadłub.
  const diff = limited ? wrap(goal - center) - wrap(state.angle - center) : wrap(desired - state.angle);
  // exp(damping·dt) znosi tłumienie z kolejnej linii dla prędkości zadanej (inaczej wieża stale
  // jechałaby ~2,5% wolniej, niż trzeba).
  const desiredVel = clamp((diff * 6.5 + rate) * Math.exp(damping * dt), -maxSpeed, maxSpeed);
  state.angVel += clamp(desiredVel - state.angVel, -maxAccel * dt, maxAccel * dt);
  state.angVel = clamp(state.angVel * Math.exp(-damping * dt), -maxSpeed, maxSpeed);
  state.angle = wrap(state.angle + state.angVel * dt);
  if (limited) {
    const cur = wrap(state.angle - center);
    if (cur > arc.half || cur < -arc.half) {
      state.angle = wrap(center + (cur > 0 ? arc.half : -arc.half));
      state.angVel = 0;
    }
  }
  // Błąd celowania po kroku — bramka ładowania i strzału broni z `chargeTime` (18-B).
  state.aimErr = Math.abs(wrap(desired - state.angle));
}

export function mountedWeaponRenderAngle(ship, loadout, alpha = 1) {
  const state = getMountedWeaponAim(ship, loadout);
  return state.previousAngle + wrap(state.angle - state.previousAngle) * clamp(alpha, 0, 1);
}
