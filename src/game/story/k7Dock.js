// ============================================================
// Hala K-7 w układzie GRY (2026-09-30, fabuła: start w doku, odcumowanie, powrót). Czysta geometria.
//
// Hub hali: x wzdłuż ringu, z promieniowo na zewnątrz (tylna ściana z = 250, brama G-01 z = 7 400).
// Stanowiska capital C-01..C-04 na z = 1 900, dziób ku tylnej ścianie (kurs huba −π/2) — rufa do bramy.
// Przeliczenie jak w ruchu v2 (haloPortTraffic.js): rama k7Frame z obrotem grupy ringu, punkt gry
// = planeta + (x, −y) ringu, kurs gry = −kurs świata ringu.
// ============================================================
import { createK7Layout, k7Frame, k7HeadingToWorld, k7HubToWorld, k7WorldToHub } from '../../3d/haloRing/haloPortK7Layout.js';
import { haloPortComplexAngles } from '../../3d/haloRing/haloRingConfig.js';
import { haloRingKey, haloRingLayoutFor, haloRingRotation } from '../haloRingPlanets.js';

const _layout = createK7Layout();

export function k7LayoutTemplate() { return _layout; }

/** Rama hali `complex` (0 = hala gracza) w układzie ringu z obrotem grupy — albo null (planeta bez ringu). */
export function k7FrameFor(planet, complex = 0) {
  const key = haloRingKey(planet);
  if (!key) return null;
  const ring = haloRingLayoutFor(planet);
  const rot = haloRingRotation(key);
  const angles = haloPortComplexAngles();
  const a = angles[complex] ?? angles[0];
  return k7Frame(ring, a + rot);
}

/** Punkt huba (x, z) → punkt gry. */
export function k7HubToGame(planet, frame, hx, hz, out = {}) {
  const w = k7HubToWorld(frame, hx, hz, out);
  const x = (Number(planet.x) || 0) + w.x;
  const y = (Number(planet.y) || 0) - w.y;
  out.x = x; out.y = y;
  return out;
}

/** Punkt gry → hub (x, z). */
export function k7GameToHub(planet, frame, gx, gy, out = {}) {
  const wx = gx - (Number(planet.x) || 0);
  const wy = (Number(planet.y) || 0) - gy;
  return k7WorldToHub(frame, wx, wy, out);
}

/** Kurs w hubie → kurs gry. */
export function k7HubHeadingToGame(frame, hubAngle) {
  return -k7HeadingToWorld(frame, hubAngle);
}

/** Wersory hali w układzie gry: ax (oś x huba, wzdłuż ringu), out (oś z huba — na zewnątrz, ku bramie). */
export function k7AxesGame(frame) {
  return {
    ax: { x: frame.tx, y: -frame.ty },
    out: { x: frame.rx, y: -frame.ry }
  };
}

/** Poza stanowiska w grze: { x, y, angle, hub: { x, z, angle }, berth }. */
export function k7BerthPose(planet, berthId = 'C-01', complex = 0) {
  const frame = k7FrameFor(planet, complex);
  if (!frame) return null;
  const berth = _layout.berths.find((b) => b.id === berthId) || _layout.berths[0];
  const p = k7HubToGame(planet, frame, berth.x, berth.z, {});
  return { x: p.x, y: p.y, angle: k7HubHeadingToGame(frame, berth.angle), hub: { x: berth.x, z: berth.z, angle: berth.angle }, berth, frame };
}

/** Środek hali (gra) i jej zasięg: { x, y, hub: { x: 0, z }, halfLength (wzdłuż z), halfWidth }. */
export function k7HallCenter(planet, complex = 0) {
  const frame = k7FrameFor(planet, complex);
  if (!frame) return null;
  const hz = (_layout.backZ + _layout.frontZ) * 0.5;
  const p = k7HubToGame(planet, frame, 0, hz, {});
  return { x: p.x, y: p.y, hub: { x: 0, z: hz }, halfLength: (_layout.frontZ - _layout.backZ) * 0.5, halfWidth: _layout.halfWidth, frame };
}

/**
 * Czy punkt gry leży poza halą i jej płytą przed bramą (odcumowanie skończone). margin — zapas za płytą.
 */
export function k7IsOutsideHall(planet, frame, gx, gy, margin = 400) {
  const h = k7GameToHub(planet, frame, gx, gy, {});
  if (h.z > _layout.frontZ + _layout.apronDepth + margin) return true;
  if (Math.abs(h.x) > _layout.halfWidth + 2600 + margin) return true;
  if (h.z < _layout.backZ - 2000) return true;
  return false;
}
