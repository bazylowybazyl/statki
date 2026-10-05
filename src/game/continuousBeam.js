// Cykl wiązki z dema bronie-webgpu: 2,6 s cięcia, 1,1 s chłodzenia.
// Stan per strzelec i emiter; zegar gry zatrzymuje cykl w pauzie.
const emitters = new WeakMap();

export function continuousBeamState(shooter, uid, weapon, time) {
  let slots = emitters.get(shooter);
  if (!slots) { slots = new Map(); emitters.set(shooter, slots); }
  let state = slots.get(uid);
  if (!state) {
    let hash = 2166136261;
    const key = String(uid);
    for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
    const phase = hash / 0x100000000 * Math.PI * 2;
    state = { start: time, last: time, weaponId: weapon.id, phase, firing: true };
    slots.set(uid, state);
  }
  // Puszczenie spustu / utrata celu zaczyna kolejny strzał od narastania.
  const cadence = weapon.cooldown * (shooter.modifiers?.fireRate || 1);
  if (time < state.last || time - state.last > Math.max(0.18, cadence * 3)
      || state.weaponId !== weapon.id) state.start = time;
  state.last = time;
  state.weaponId = weapon.id;
  const on = weapon.beamOnTime || 2.6;
  const off = weapon.beamOffTime || 1.1;
  state.firing = (time - state.start) % (on + off) < on;
  return state;
}

/** Powolne przeciągnięcie po burcie; kursor bez namierzonej encji zachowuje swój kierunek. */
export function continuousBeamAngle(state, angle, time, x, y, target, tx, ty) {
  if (!target) return angle;
  const dx = tx - x, dy = ty - y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return angle;
  const radius = Number(target.radius) || 20;
  const length = Number(target.w || target.length) || radius * 2;
  const amplitude = Math.min(length * 0.32, radius * 0.65, dist * 0.03);
  // Bez skoku punktu przy włączeniu. Różne emitery tną w różnych fazach.
  const sweep = (Math.sin((time - state.start) * 0.55 + state.phase) - Math.sin(state.phase)) * amplitude * 0.5;
  let a = Number(target.angle) || 0;
  // Patrząc wzdłuż kadłuba, ruch po jego osi nie przesuwa trafienia w obrazie.
  // Wtedy tniemy w poprzek widocznego końca burty.
  if (Math.abs(Math.sin(a - angle)) < 0.25) a = angle + Math.PI * 0.5;
  const sx = Math.cos(a) * sweep, sy = Math.sin(a) * sweep;
  return angle + Math.atan2(dx * sy - dy * sx, dist * dist + dx * sx + dy * sy);
}
