// Sterowanie kadłubem 2D w płaszczyźnie gry (XY, obrót wokół Z).
// Osie kadłuba ze sprite'a: +X dziób, +Y lewa burta. Klawisze jak w grze:
// W/S ciąg, A/D obrót, Q/E w bok, Shift dopalacz, X hamulec.
// Sterowanie zmienia tylko prędkości ciała; kolizje i zgniot liczy fizyka.

export const PLANAR_FLIGHT_DEFAULTS = Object.freeze({
  cruiseSpeed: 600,      // j./s z wciśniętym W
  boostSpeed: 1600,      // j./s z Shiftem
  reverseSpeed: 220,
  strafeSpeed: 260,
  accel: 420,            // j./s²
  boostAccel: 900,
  turnRate: 0.55,        // rad/s
  turnAccel: 1.4         // rad/s²
});

const approach = (value, target, step) => value + Math.max(-step, Math.min(step, target - value));

export function readPlanarFlightInput(keys, out) {
  out.throttle = Number(!!(keys.KeyW || keys.ArrowUp)) - Number(!!(keys.KeyS || keys.ArrowDown));
  out.turn = Number(!!(keys.KeyA || keys.ArrowLeft)) - Number(!!(keys.KeyD || keys.ArrowRight));
  out.strafe = Number(!!keys.KeyQ) - Number(!!keys.KeyE);   // + = w lewo (+Y kadłuba)
  out.boost = !!(keys.ShiftLeft || keys.ShiftRight);
  out.brake = !!keys.KeyX;
  return out;
}

/** Kurs kadłuba w płaszczyźnie (kąt dziobu od +X, przeciwnie do wskazówek zegara). */
export function planarHeading(q) {
  return 2 * Math.atan2(q.z, q.w);
}

export function setPlanarHeading(body, angle) {
  body.quat.x = 0;
  body.quat.y = 0;
  body.quat.z = Math.sin(angle * 0.5);
  body.quat.w = Math.cos(angle * 0.5);
  body._rotTick = -1;
}

export function applyPlanarFlightControls(body, input, dt, params = PLANAR_FLIGHT_DEFAULTS, assist = true) {
  if (!body || body.dead || body.static || dt <= 0) return;
  const heading = planarHeading(body.quat);
  const fx = Math.cos(heading), fy = Math.sin(heading);   // dziób
  const lx = -fy, ly = fx;                                // lewa burta
  const v = body.vel;
  let forward = v.x * fx + v.y * fy;
  let side = v.x * lx + v.y * ly;
  const accel = (input.boost ? params.boostAccel : params.accel) * dt;

  if (input.brake) {
    // Jeden hamulec dla całego wektora, bez przeskoku przez zero.
    const speed = Math.hypot(forward, side);
    const scale = speed > 0 ? Math.max(0, 1 - accel * 2 / speed) : 0;
    forward *= scale; side *= scale;
  } else {
    if (input.throttle > 0) forward = approach(forward, input.boost ? params.boostSpeed : params.cruiseSpeed, accel);
    else if (input.throttle < 0) forward = approach(forward, -params.reverseSpeed, accel);
    if (input.strafe) side = approach(side, input.strafe * params.strafeSpeed, accel);
    else if (assist) side = approach(side, 0, accel * 0.6);
  }
  v.x = fx * forward + lx * side;
  v.y = fy * forward + ly * side;

  // Ster obrotu ma ograniczone przyspieszenie, więc obrót od zderzenia zostaje;
  // puszczony ster wygasza go tylko ze stabilizacją.
  const w = body.angVel;
  if (input.turn || assist) w.z = approach(w.z, input.turn * params.turnRate, params.turnAccel * dt);
}
