// Obrona punktowa kontra rakiety (2026-10-12): czy pocisk CIWS trafił rakietę w tym kroku fizyki.
//
// Pocisk (~2000 j/s) i rakieta (~2500 j/s) przy 60 Hz mijają się o ~75 j. na krok, a promień trafienia
// to kilka jednostek — sam punkt końcowy kroku trafiał przypadkiem. Test idzie po ODCINKU kroku w układzie
// rakiety (ruch względny): pocisk od (bx0, by0) do (b.x, b.y), rakieta od (rb.x − rb.vx·span) do rb.x.
// Rakieta: pocisk z `bullets` (rakieta / torpeda kanwy) albo zastępnik rakiety 3D (rocketSystem3D.syncThreats).
// Czyste, bez alokacji — woła je pętla pocisków (index.html, „CIWS INTERCEPT RAKIET”).

/**
 * @param {{ x: number, y: number, r?: number }} b pocisk CIWS po kroku
 * @param {number} bx0 @param {number} by0 pozycja pocisku na początku kroku (b.px / b.py)
 * @param {{ x: number, y: number, vx?: number, vy?: number, r?: number }} rb rakieta po kroku
 * @param {number} span czas lotu pocisku w tym kroku [s] (projectileStepSpan)
 * @param {number} reach wstępne odrzucenie [j.] — rakieta dalej w x albo y od końca pocisku to pudło
 */
export function ciwsShotHitsRocket(b, bx0, by0, rb, span, reach) {
  const ex = b.x - rb.x;
  const ey = b.y - rb.y;
  if (ex > reach || ex < -reach || ey > reach || ey < -reach) return false;
  const hitR = (b.r || 2) + (rb.r || 5);
  // Odcinek pocisku w układzie rakiety: początek − (rakieta − v·span), koniec − rakieta.
  const sx = bx0 - rb.x + (Number(rb.vx) || 0) * span;
  const sy = by0 - rb.y + (Number(rb.vy) || 0) * span;
  const segX = ex - sx;
  const segY = ey - sy;
  const segL2 = segX * segX + segY * segY;
  let u = segL2 > 1e-9 ? -(sx * segX + sy * segY) / segL2 : 1;
  u = u < 0 ? 0 : (u > 1 ? 1 : u);
  const cx = sx + segX * u;
  const cy = sy + segY * u;
  return cx * cx + cy * cy <= hitR * hitR;
}

/** Wstępne odrzucenie dla pocisku: droga względna w kroku (pocisk + najszybsza rakieta ~6000 j/s) + zapas. */
export function ciwsRocketReach(b, span) {
  return (Math.abs(b.vx) + Math.abs(b.vy) + 6000) * span + 24;
}
