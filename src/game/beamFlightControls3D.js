// Osie znormalizowanego modelu: +X dziób, +Y góra, +Z prawa burta.
// Sterowanie zmienia tylko prędkości ciała; kolizje i obrót liczy zwykła fizyka.
const clamp = value => Math.max(-1, Math.min(1, value));
const approach = (value, target, step) => value + Math.max(-step, Math.min(step, target - value));

export function readFlightInput(keys, mouseYaw, mousePitch, out) {
  out.throttle = Number(!!keys.KeyW) - Number(!!keys.KeyS);
  out.yaw = clamp(Number(!!(keys.KeyA || keys.ArrowLeft)) - Number(!!(keys.KeyD || keys.ArrowRight)) + mouseYaw);
  out.pitch = clamp(Number(!!keys.ArrowUp) - Number(!!keys.ArrowDown) + mousePitch);
  out.roll = Number(!!keys.KeyE) - Number(!!keys.KeyQ);
  out.strafe = Number(!!keys.KeyC) - Number(!!keys.KeyZ);
  out.lift = Number(!!keys.Space) - Number(!!(keys.ControlLeft || keys.ControlRight));
  out.boost = !!(keys.ShiftLeft || keys.ShiftRight);
  out.brake = !!keys.KeyX;
  return out;
}

export function applyFlightControls(body, input, dt, thrust = 70, assist = true) {
  if (!body || body.dead || body.static || dt <= 0) return;
  const q = body.quat, v = body.vel, w = body.angVel;
  // Kolumny macierzy obrotu: lokalne osie w przestrzeni świata.
  const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const fy = 2 * (q.x * q.y + q.z * q.w);
  const fz = 2 * (q.x * q.z - q.y * q.w);
  const ux = 2 * (q.x * q.y - q.z * q.w);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.x * q.w);
  const rx = 2 * (q.x * q.z + q.y * q.w);
  const ry = 2 * (q.y * q.z - q.x * q.w);
  const rz = 1 - 2 * (q.x * q.x + q.y * q.y);
  let forward = v.x * fx + v.y * fy + v.z * fz;
  let up = v.x * ux + v.y * uy + v.z * uz;
  let right = v.x * rx + v.y * ry + v.z * rz;
  const accel = Math.max(0, thrust) * dt;

  if (input.brake) {
    // Jeden hamulec dla całego wektora, bez przeskoku przez zero.
    const speed = Math.sqrt(forward * forward + up * up + right * right);
    const scale = speed > 0 ? Math.max(0, 1 - accel * 2.5 / speed) : 0;
    forward *= scale; up *= scale; right *= scale;
  } else {
    if (input.throttle) forward = approach(forward,
      input.throttle * (input.throttle > 0 ? (input.boost ? 360 : 180) : 60), accel * (input.boost ? 2 : 1));
    if (input.lift) up = approach(up, input.lift * 70, accel);
    else if (assist) up = approach(up, up * Math.exp(-3 * dt), accel);
    if (input.strafe) right = approach(right, input.strafe * 70, accel);
    else if (assist) right = approach(right, right * Math.exp(-3 * dt), accel);
  }
  v.x = fx * forward + ux * up + rx * right;
  v.y = fy * forward + uy * up + ry * right;
  v.z = fz * forward + uz * up + rz * right;

  // Ograniczone przyspieszenie kątowe zachowuje reakcję na zderzenie.
  // Puszczenie steru stopniowo zatrzymuje obrót, także przy wyłączonym wspomaganiu dryfu.
  const turnStep = 3 * dt;
  const roll = approach(w.x * fx + w.y * fy + w.z * fz, input.roll * 1.2, turnStep);
  const yaw = approach(w.x * ux + w.y * uy + w.z * uz, input.yaw * 0.9, turnStep);
  const pitch = approach(w.x * rx + w.y * ry + w.z * rz, input.pitch * 0.8, turnStep);
  w.x = fx * roll + ux * yaw + rx * pitch;
  w.y = fy * roll + uy * yaw + ry * pitch;
  w.z = fz * roll + uz * yaw + rz * pitch;
  // Ruch sztywnego kadłuba nie wymaga wybudzania solvera jego deformacji.
}
