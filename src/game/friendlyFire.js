// src/game/friendlyFire.js
//
// Rozpoznanie swój–obcy (IFF) dla lekkiej broni. Gra ma friendly fire (filtr drużynowy pocisków
// usunięty 2026-03-15) i zostaje on dla ciężkich dział okrętów. Lekka broń go nie ma:
//   • wszystko, co wystrzelił MYŚLIWIEC (działko, laser PD, mikrorakieta) — myśliwce walczą w kotle
//     tuż przy własnych okrętach, a pociski dziedziczą ich prędkość (~2800 j/s), więc chybienia lecą
//     kilka km dalej, w Atlasa i własną eskadrę (zgłoszenie 2026-10-11: „moje myśliwce mnie biły”);
//   • pociski CIWS — strumień z omiataniem łuku wokół celu przechodził przez własne myśliwce
//     ścigające ten sam cel („mój CIWS atakował moje myśliwce”).
// Flak ma własną regułę (FLAK_TUNING.FRIENDLY_FACTOR), wiązki okrętów — jak dotąd.
//
// Moduł czysty: strona pocisku z `owner` / `source`, strona celu z `friendly`.

const FIGHTER_KINDS = new Set(['fighter', 'interceptor', 'drone', 'bomber']);

export function isFighterUnit(e) {
  return !!(e && (e.fighter || FIGHTER_KINDS.has(e.type)));
}

/** Strona pocisku: true — gracz i sojusznicy, false — reszta. */
export function projectileIsFriendly(b) {
  return b.owner === 'player' || b.owner === 'player2' || b.source?.friendly === true;
}

/** Czy pocisk ma IFF (lekka broń: myśliwiec albo CIWS). */
export function projectileHasIff(b) {
  return !!b && (b.type === 'ciws' || isFighterUnit(b.source));
}

/**
 * Czy pocisk `b` przelatuje przez `entity` bez trafienia (ta sama strona, lekka broń).
 * `entity` może być proxy gracza w siatce pocisków (friendly = true).
 */
export function projectilePassesAlly(b, entity) {
  if (!entity || !projectileHasIff(b)) return false;
  if (entity.isWreck) return false;
  return (entity.friendly === true) === projectileIsFriendly(b);
}

/**
 * Broń myśliwca bez pocisku w siatce kolizji — wiązka (laser PD eskadry przechwytującej) i rakieta 3D
 * (wybuch i trafienie głowicy, rocketSystem3D.js) — nie rani jednostek własnej strony.
 */
export function fighterSparesAlly(shooter, entity, player) {
  if (!entity || !isFighterUnit(shooter) || entity.isWreck) return false;
  const shooterFriendly = shooter === player || shooter.friendly === true;
  const targetFriendly = entity === player || entity.friendly === true;
  return shooterFriendly === targetFriendly;
}

/** Wiązka myśliwca: to samo co fighterSparesAlly (nazwa w resolveBeamWorldHit). */
export const beamPassesAlly = fighterSparesAlly;

/**
 * Strona myśliwca zapamiętana w broni, która żyje dłużej niż wskaźnik na strzelca (rakieta 3D zeruje
 * `shooter` zaraz po wyrzucie): −1 — nie myśliwiec, 1 — myśliwiec strony gracza, 0 — wrogi myśliwiec.
 */
export function fighterSideOf(shooter, player) {
  if (!isFighterUnit(shooter)) return -1;
  return (shooter === player || shooter.friendly === true) ? 1 : 0;
}

/** Jak fighterSparesAlly, ze stroną z fighterSideOf. */
export function fighterSideSparesAlly(side, entity, player) {
  if (side < 0 || !entity || entity.isWreck) return false;
  const targetFriendly = entity === player || entity._isPlayerShip === true || entity.friendly === true;
  return (side === 1) === targetFriendly;
}
