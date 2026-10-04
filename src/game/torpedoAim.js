// src/game/torpedoAim.js
//
// CELOWANIE TORPED jak w World of Warships (2026-09-30): torpedy nie mają naprowadzania —
// wyrzutnia odpala WACHLARZ niekierowanych torped (`burstCount` rur), a gracz sam prowadzi
// cel. Logika bez DOM i three (testy w Node): geometria wachlarza (wąski / szeroki), gotowość
// wyrzutni (przeładowanie, obrót wieżyczki), rozwiązanie przechwycenia dla wskaźnika
// wyprzedzenia („duch” celu tam, gdzie trzeba wycelować, żeby torpeda i cel spotkały się).
// Tryb, wejście i rysunek — index.html (blok „TORPEDY: TRYB CELOWANIA”).
//
// Układ torpedy (src/game/carrierVelocity.js): torpeda dziedziczy prędkość wyrzutni, więc
// w jej układzie cel porusza się z prędkością WZGLĘDNĄ (v_celu − v_wyrzutni). Punkt celowania
// = cel + (v_celu − v_wyrzutni)·t, gdzie t — czas dolotu z |r + u·t| = v_torpedy·t.

/** Rozrzut domyślny (cały kąt wachlarza) [°]: wąski i szeroki — gdy broń nie ma `torpedoSpread`. */
export const TORPEDO_SPREAD_DEFAULT = Object.freeze([4, 14]);
/** Wyrzutnia strzela, gdy wieżyczka jest bliżej niż tyle od kursu wachlarza [rad] (~3,5°). */
export const TORPEDO_ALIGN_RAD = 0.06;
/** Najwięcej rur w jednym wachlarzu (bufory bez alokacji). */
export const TORPEDO_TUBES_MAX = 12;

const DEG = Math.PI / 180;

/** Czy broń jest torpedą (kategoria `torpedo` — wachlarz niekierowany z trybu celowania). */
export function isTorpedoWeapon(def) {
  return !!def && def.category === 'torpedo';
}

/** Liczba rur wyrzutni = torped w jednym wachlarzu (burstCount, 1..TORPEDO_TUBES_MAX). */
export function torpedoTubesOf(def) {
  const n = Math.round(Number(def?.burstCount) || 1);
  return n < 1 ? 1 : (n > TORPEDO_TUBES_MAX ? TORPEDO_TUBES_MAX : n);
}

/** Cały kąt wachlarza [rad] dla trybu wąskiego / szerokiego (`torpedoSpread: [wąski°, szeroki°]`). */
export function torpedoSpreadRad(def, wide) {
  const s = Array.isArray(def?.torpedoSpread) ? def.torpedoSpread : TORPEDO_SPREAD_DEFAULT;
  const deg = Number(wide ? s[1] : s[0]);
  return (Number.isFinite(deg) && deg >= 0 ? deg : (wide ? TORPEDO_SPREAD_DEFAULT[1] : TORPEDO_SPREAD_DEFAULT[0])) * DEG;
}

/**
 * Kursy torped wachlarza (świat, rad) do `out`: rury rozłożone RÓWNO na całym kącie `spreadRad`
 * wokół `baseAngle` (jedna rura — sam kurs). Zwraca liczbę kursów.
 */
export function writeTorpedoFan(baseAngle, tubes, spreadRad, out) {
  const n = tubes > 0 ? Math.min(tubes | 0, out.length) : 0;
  if (n === 1) { out[0] = baseAngle; return 1; }
  for (let k = 0; k < n; k++) out[k] = baseAngle + (k / (n - 1) - 0.5) * spreadRad;
  return n;
}

/**
 * Przechwycenie torpedy (prędkość własna `speed` w układzie wyrzutni o prędkości (svx, svy))
 * z celem w (tx, ty) o prędkości (tvx, tvy), wyrzutnia w (sx, sy). Wynik w `out`:
 *   ok — czy torpeda w ogóle dogoni cel, t — czas dolotu [s],
 *   ax, ay — punkt celowania (świat, TERAZ): tam trzeba skierować wachlarz,
 *   gx, gy — gdzie w świecie cel będzie w chwili trafienia (duch na mapie).
 */
export function solveTorpedoLead(sx, sy, svx, svy, tx, ty, tvx, tvy, speed, out) {
  const rx = tx - sx;
  const ry = ty - sy;
  const ux = tvx - svx;
  const uy = tvy - svy;
  const v = speed > 1 ? speed : 1;
  const a = ux * ux + uy * uy - v * v;
  const b = 2 * (rx * ux + ry * uy);
  const c = rx * rx + ry * ry;
  let t = -1;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      t = Math.min(t1, t2);
      if (t < 0) t = Math.max(t1, t2);
    }
  }
  out.ok = Number.isFinite(t) && t >= 0;
  if (!out.ok) t = 0;
  out.t = t;
  out.ax = tx + ux * t;
  out.ay = ty + uy * t;
  out.gx = tx + tvx * t;
  out.gy = ty + tvy * t;
  return out;
}

/**
 * Stan wyrzutni w trybie celowania: 'reload' (przeładowanie albo brak amunicji), 'turn'
 * (wieżyczka obraca się ku kursorowi), 'ready'. `aimErr` — |kąt kursora − kąt wieżyczki| [rad].
 */
export function torpedoLauncherState(cooldownLeft, ammo, aimErr) {
  if ((typeof ammo === 'number' && ammo <= 0) || cooldownLeft > 0) return 'reload';
  if (!(Math.abs(aimErr) <= TORPEDO_ALIGN_RAD)) return 'turn';
  return 'ready';
}

/** Kąt w (−π, π]. */
export function wrapAnglePi(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
