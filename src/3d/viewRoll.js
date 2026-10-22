// src/3d/viewRoll.js
//
// OBRÓT KADRU kamery z góry (roll; 2026-10-19, user: „obracajmy kamerę na czas warpu w kierunku lotu — lepiej bawić
// się tym, co jest przed nami”; demo „Pęd”: dema/warp-ped.html). Kamera gry niesie kąt w `cam.roll` [rad]; brak albo 0
// = kadr osiami świata i wszystko liczy się dokładnie jak przed obrotem.
//
// Konwencja (osie gry, y w dół), R(φ) = [[cos φ, −sin φ], [sin φ, cos φ]]:
//   ekran = R(−roll)·(świat − kamera)·zoom      świat = kamera + R(roll)·ekran / zoom
// Kurs `θ` w górę ekranu: roll = θ + π/2; kurs w prawo: roll = θ. Kamera three: rotation.z = −roll (Core3D.syncCamera).
// Moduły, które same rzutują świat na piksele (źródła zniekształceń, maska słońca, ośrodek, gwiazdy i soczewki warpa,
// soczewka świata, culling CPU), obracają przesunięcia tym kątem, a pudła osi świata wokół kadru powiększają do pudła
// obróconego kadru (`rolledHalfExtents`). Czysty moduł (bez three i DOM).

/** Kąt obrotu kadru kamery gry [rad] (0 — kadr osiami świata). */
export function cameraRoll(cam) {
  const r = Number(cam?.roll);
  return Number.isFinite(r) ? r : 0;
}

/** Przesunięcie w świecie (dx, dy) → osie ekranu (y w dół, bez zoomu): out = R(−roll)·(dx, dy). */
export function rollToScreen(dx, dy, roll, out = { x: 0, y: 0 }) {
  if (!roll) { out.x = dx; out.y = dy; return out; }
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  out.x = c * dx + s * dy;
  out.y = -s * dx + c * dy;
  return out;
}

/** Przesunięcie w osiach ekranu (y w dół, bez zoomu) → świat: out = R(roll)·(sx, sy). */
export function rollToWorld(sx, sy, roll, out = { x: 0, y: 0 }) {
  if (!roll) { out.x = sx; out.y = sy; return out; }
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  out.x = c * sx - s * sy;
  out.y = s * sx + c * sy;
  return out;
}

/** Pół pudła osi świata (j. albo px) obejmującego kadr hw × hh obrócony o `roll`. */
export function rolledHalfExtents(hw, hh, roll, out = { hw: 0, hh: 0 }) {
  if (!roll) { out.hw = hw; out.hh = hh; return out; }
  const c = Math.abs(Math.cos(roll));
  const s = Math.abs(Math.sin(roll));
  out.hw = c * hw + s * hh;
  out.hh = s * hw + c * hh;
  return out;
}
