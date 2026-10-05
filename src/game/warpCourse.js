// src/game/warpCourse.js
//
// QOL warpa (2026-10-04): RĘCZNY skok z kursem na cel. Kurs (cel TRAVEL TO, znacznik misji) zostaje
// po przejęciu sterów — ręczny lot i klawisz warpa przerywają automat podróży, ale nie kasują celu.
// Skok ładowany z dziobem w tolerancji ±5° od namiaru punktu skoku (odcinek planisty: cel albo
// objazd / brzeg studni grawitacji) dostaje DOKŁADNY namiar i wychodzi sam, tak że rampa wyjścia
// (warpDrive.js: WARP_EXIT) staje w punkcie. Poza tolerancją — zwykły skok w dziób, bez wyjścia
// przy celu; HUD (index.html: drawWarpCourseOverlay) pokazuje namiar, odchyłkę i przewidywane minięcie.
//
// Czysta logika (bez DOM, three, gry).

/** Strojenie kursu ręcznego skoku. */
export const WARP_COURSE_TUNE = Object.freeze({
  tolerance: 5 * Math.PI / 180,   // dziób w tej odchyłce od namiaru — skok z wyjściem przy celu
  clearRadius: 6000,              // [j.] cel osiągnięty (poza automatem podróży) — kurs znika
  refresh: 0.25                   // [s] odświeżanie punktu skoku (planista trasy) poza skokiem
});

function wrapPi(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/**
 * Namiar z `pos` na punkt `aim` względem kursu `heading` [rad].
 * out.bearing — namiar, out.err — odchyłka ze znakiem (namiar − kurs, w (−π, π]), out.dist.
 */
export function warpCourseBearing(pos, heading, aim, out = {}) {
  const dx = aim.x - pos.x;
  const dy = aim.y - pos.y;
  out.dist = Math.sqrt(dx * dx + dy * dy);
  out.bearing = Math.atan2(dy, dx);
  out.err = wrapPi(out.bearing - heading);
  return out;
}

/** Dziób w tolerancji — skok dostanie namiar punktu i wyjście przy nim. */
export function warpCourseAligned(err, tune = WARP_COURSE_TUNE) {
  return Math.abs(err) <= tune.tolerance + 1e-12;
}

/**
 * WARP kończy wskazania przy przejściu na DOLOT napędem (ostatni odcinek). Zamrożony punkt żyje do końca
 * skoku/rampy. Odcinek napędem, który nie jest ostatni (objazd studni grawitacji tuż przy okręcie),
 * zostaje na HUD-zie — inaczej znacznik kursu znikał na czas objazdu planety (2026-10-05).
 */
export function warpCourseHudVisible(leg, lockedAim, busy) {
  return !!(busy && lockedAim) || leg?.kind === 'warp' || (leg?.kind === 'drive' && leg.final === false);
}

/**
 * Tor skoku po prostej z `pos` w kierunku (dirX, dirY) względem punktu `aim`:
 * out.along — odległość do najbliższego podejścia (≤ 0: punkt już za statkiem),
 * out.miss — odległość od punktu w najbliższym podejściu (minięcie).
 */
export function warpCoursePass(pos, dirX, dirY, aim, out = {}) {
  const dx = aim.x - pos.x;
  const dy = aim.y - pos.y;
  out.along = dx * dirX + dy * dirY;
  const cross = dx * dirY - dy * dirX;
  out.miss = out.along > 0 ? Math.abs(cross) : Math.sqrt(dx * dx + dy * dy);
  return out;
}

/** Czas wyjść z warpa: rampa (droga `rampDist`) kończy się w najbliższym podejściu do punktu. */
export function warpCourseExitDue(pos, dirX, dirY, aim, rampDist) {
  const along = (aim.x - pos.x) * dirX + (aim.y - pos.y) * dirY;
  return along <= rampDist;
}
