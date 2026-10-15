// src/game/cameraShakes.js — wstrząsy kamery po stronie GRY (RW-30, docs/PLAN-render-worker.md § 4).
//
// Kamerą rządzi gra. Moduły renderu nie piszą `window.camera` ani globalnych stanów wstrząsu:
//   • wstrząs STRZAŁÓW (dane broni — `shake` z src/game/weaponFeel.js, rekord wieżyczki Turret2D) gra dokłada przy
//     zapisie rekordu SHOT (src/render/renderCommands.js — hak `onShotFeel`) do akumulatora `WeaponShotShake`, który
//     gaśnie raz na klatkę renderu; dawniej robił to WeaponFx (`_weaponShake` → `window.__weapon3dCameraShake`);
//   • kopnięcie kadru za strzał gracza — tamże (index.html: cameraRig.addCameraKick);
//   • wstrząsy z receptur efektów (trafienia, wyloty), Supernowej, wybuchu reaktora i warpa „Nurt” przychodzą
//     z renderu ŻĄDANIEM `requestCameraShake(kamera, siła, czas)` (haki `onShake` modułów renderu; w trybie worker —
//     kanał zwrotny), z jedną regułą: nie słabszy od tego, co zostało z bieżącego wstrząsu.
// Czysty moduł (bez three i DOM).

/** Sufit wstrząsu strzałów (dawny WEAPON_SHAKE_CAP efektów broni). */
export const WEAPON_SHAKE_CAP = 18;

/** Akumulator wstrząsu strzałów (mag — siła, lastMs — czas ostatniego wygaszania). */
export function createWeaponShotShake() {
  return { mag: 0, lastMs: 0 };
}

/** Strzał: + siła (wstrząs broni × ułamek wstrząsu strzału), z sufitem. */
export function addWeaponShotShake(s, mag) {
  s.mag = Math.min(WEAPON_SHAKE_CAP, s.mag + (Number(mag) || 0));
}

/**
 * Raz na klatkę renderu (po próbkowaniu kamery — tam, gdzie dawniej WeaponFx.sync): wygaszanie e^(−8·dt), dt z zegara
 * strony (jak dawniej: 1/60 przy pierwszym kroku, potem [0,001; 0,05] s).
 */
export function stepWeaponShotShake(s, nowMs) {
  const dt = s.lastMs > 0 ? Math.max(0.001, Math.min(0.05, (nowMs - s.lastMs) * 0.001)) : 1 / 60;
  s.lastMs = nowMs;
  s.mag *= Math.exp(-8.0 * dt);
  if (s.mag < 0.01) s.mag = 0;
  return s.mag;
}

/** Żądanie wstrząsu: camera.addShake, gdy silniejszy niż to, co zostało z bieżącego (addShake nadpisuje). */
export function requestCameraShake(camera, mag, dur) {
  if (!(mag > 0) || !camera || typeof camera.addShake !== 'function') return false;
  const left = camera.shakeDur > 0 ? camera.shakeMag * Math.max(0, camera.shakeTime / camera.shakeDur) : 0;
  if (!(mag > left)) return false;
  camera.addShake(mag, dur);
  return true;
}

/**
 * Żądanie wstrząsu z regułą Supernowej (src/3d/rockets/effects.js — dawniej porównanie z pełną siłą bieżącego wstrząsu,
 * bez wygaszania w czasie): camera.addShake, gdy silniejszy niż siła bieżącego wstrząsu.
 */
export function requestCameraShakePeak(camera, mag, dur) {
  if (!camera || typeof camera.addShake !== 'function') return false;
  const left = (Number(camera.shakeMag) || 0) * ((Number(camera.shakeDur) || 0) > 0 ? 1 : 0);
  if (!(mag > left)) return false;
  camera.addShake(mag, dur);
  return true;
}

/** Strzał gracza bez wieżyczki (Hexlance — superweapon.js): hak gry na kopnięcie kadru (index.html). */
export const ShotFeel = {
  /** (kierunek x, y, wstrząs, przeładowanie [s]) → kopnięcie kadru; null — bez. */
  onPlayerShot: null
};
