// Simulation-owned aim, one persistent state per physical hardpoint.
// Loadout wrappers are rebuilt when equipment changes, so key by hp instead.
const aims = new WeakMap();
const TAU = Math.PI * 2;
const wrap = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export function getMountedWeaponAim(ship, loadout) {
  const hp = loadout.hp;
  let state = aims.get(hp);
  if (!state) {
    const angle = Number(ship.angle) || 0;
    state = { angle, previousAngle: angle, angVel: 0, target: null, nextBarrel: 0 };
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

export function stepMountedWeaponAim(state, base, aimPoint, dt, drive) {
  state.previousAngle = state.angle;
  if (!(dt > 0)) return;
  const dx = aimPoint.x - base.x;
  const dy = aimPoint.y - base.y;
  const desired = dx * dx + dy * dy > 1e-12 ? Math.atan2(dy, dx) : state.angle;
  const maxSpeed = drive?.maxSpeed ?? 2.2;
  const maxAccel = drive?.maxAccel ?? 12;
  const damping = drive?.damping ?? 3;
  const diff = wrap(desired - state.angle);
  const desiredVel = clamp(diff * 6.5, -maxSpeed, maxSpeed);
  state.angVel += clamp(desiredVel - state.angVel, -maxAccel * dt, maxAccel * dt);
  state.angVel = clamp(state.angVel * Math.exp(-damping * dt), -maxSpeed, maxSpeed);
  state.angle = wrap(state.angle + state.angVel * dt);
}

export function mountedWeaponRenderAngle(ship, loadout, alpha = 1) {
  const state = getMountedWeaponAim(ship, loadout);
  return state.previousAngle + wrap(state.angle - state.previousAngle) * clamp(alpha, 0, 1);
}
