// Szybka ścieżka strzału lasera PD (NPC).
//
// AI (processAutonomousWeapons) zna cel i już sprawdziło linię ognia na
// sojuszników, więc strzał PD nie skanuje świata — testuje tylko swój cel:
//   1. tarczę: wejście wiązki w obrys blokującej tarczy (shieldSystem),
//   2. kadłub: sweep po heksach na odcinku wiązki przyciętym do okręgu kadłuba,
//      a bez siatki heksów (myśliwce) — sam okrąg, jak ogólna ścieżka.
// Dawniej każda wiązka PD przechodziła przez wszystkie NPC, stacje, platformy,
// wraki i segmenty ringu, sortowała kandydatów i robiła raymarch po heksach —
// tysiące razy na sekundę w bitwie (docs/AUDYT-wydajnosc-bitwa-2026-09-24.md, 2.2).
//
// Pudło = wiązka do pełnego zasięgu bez trafienia. Wynik ląduje w `out`
// (obiekt wielokrotnego użytku), bez alokacji.

// Tolerancja kierunku wiązki lasera PD do rakiety [rad, ~tan] — jak `aimTolerance` lasera gracza w ciwsStep.
export const PD_LASER_ROCKET_AIM_TOL = 0.1;

export function createPdBeamHit() {
  return { dist: 0, entity: null, kind: null, shard: null, shield: false };
}

function clearHit(out, range) {
  out.dist = range;
  out.entity = null;
  out.kind = null;
  out.shard = null;
  out.shield = false;
  return out;
}

function finishHit(out, entity, dist, shield, shard, playerShip) {
  out.dist = dist;
  out.entity = entity;
  out.shield = shield;
  out.shard = shard;
  // Te same klasy co ogólna ścieżka (classifyBeamHitEntity w index.html) —
  // cel PD z AI to okręt, myśliwiec albo gracz, nigdy stacja ani wrak.
  if (entity === playerShip) out.kind = 'player';
  else if (entity.isRingSegment) out.kind = 'ring';
  else if (entity.hp !== undefined && entity.maxHp !== undefined) out.kind = 'npc';
  else out.kind = 'world';
  return out;
}

/**
 * @param out     wynik z createPdBeamHit()
 * @param x0,y0   wylot lufy
 * @param dirX,dirY kierunek wiązki (jednostkowy)
 * @param range   zasięg wiązki
 * @param target  cel wybrany przez AI
 * @param deps    { shieldRayEnter(e, x0, y0, dirX, dirY, maxT) → t | −1, sweepImpact(e, x0, y0, x1, y1, r),
 *                  hullRadius(e), playerShip }
 */
export function resolvePdBeamHit(out, x0, y0, dirX, dirY, range, target, deps) {
  clearHit(out, range);
  if (!target || !(range > 0)) return out;
  // Rakieta/torpeda (pocisk z `bullets` albo zastępnik rakiety 3D — rocketSystem3D.syncThreats): wiązka
  // przechodzi przez nią, gdy kierunek lufy mija ją o najwyżej PD_LASER_ROCKET_AIM_TOL (jak laser PD gracza
  // w ciwsStep) — trafienie `kind: 'rocket'`, zestrzelenie robi wołający (fireWeaponCore → killRocketThreat).
  if (target.type === 'rocket' || target.type === 'torpedo') {
    if (!(target.life > 0) || target.dead) return out;
    const rx = target.x - x0;
    const ry = target.y - y0;
    const along = rx * dirX + ry * dirY;
    if (!(along > 0) || along > range) return out;
    const perp = Math.abs(rx * dirY - ry * dirX);
    if (perp > along * PD_LASER_ROCKET_AIM_TOL + (Number(target.r) || 0)) return out;
    out.dist = Math.sqrt(rx * rx + ry * ry);
    out.entity = target;
    out.kind = 'rocket';
    return out;
  }
  const entity = target._realEntity || target;
  if (entity.dead || entity.destroyed || entity.removed) return out;
  const tx = entity.pos ? entity.pos.x : entity.x;
  const ty = entity.pos ? entity.pos.y : entity.y;
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return out;

  const fx = tx - x0;
  const fy = ty - y0;
  const along = fx * dirX + fy * dirY;
  const perpSq = fx * fx + fy * fy - along * along;
  const playerShip = deps.playerShip;

  // 1. Tarcza. Wejście w obrys jak w ogólnej ścieżce (dawniej okrąg o promieniu
  //    tarczy w stronę lufy — przy długim kadłubie wiązka kończyła się w powietrzu
  //    albo przechodziła przez tarczę przy dziobie).
  const shieldT = deps.shieldRayEnter ? deps.shieldRayEnter(entity, x0, y0, dirX, dirY, range) : -1;
  if (shieldT >= 0) return finishHit(out, entity, shieldT, true, null, playerShip);

  // 2. Kadłub. Okrąg kadłuba przycina wiązkę do odcinka nad siatką — sweep po
  //    węzłach dostaje małe pudło komórek zamiast całej wiązki.
  const hullR = deps.hullRadius(entity);
  if (!(hullR > 0) || perpSq > hullR * hullR) return out;
  const half = Math.sqrt(hullR * hullR - perpSq);
  const tEnter = Math.max(0, along - half);
  const tExit = Math.min(range, along + half);
  if (tEnter > tExit) return out;

  // Kadłub na belkach (hullBodies.js) — sweep daje pierwszy węzeł na drodze.
  if (entity.beamHull && deps.sweepImpact) {
    const sx0 = x0 + dirX * tEnter;
    const sy0 = y0 + dirY * tEnter;
    const sx1 = x0 + dirX * tExit;
    const sy1 = y0 + dirY * tExit;
    const sweep = deps.sweepImpact(entity, sx0, sy0, sx1, sy1, 0);
    if (!sweep || !(sweep.t >= 0)) return out;
    const dist = tEnter + (tExit - tEnter) * sweep.t;
    return finishHit(out, entity, dist, false, sweep.hitShard || null, playerShip);
  }

  // 3. Bez kadłuba na belkach (myśliwce): okrąg kadłuba.
  return finishHit(out, entity, tEnter, false, null, playerShip);
}
