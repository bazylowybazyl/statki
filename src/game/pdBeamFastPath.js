// Szybka ścieżka strzału lasera PD (NPC).
//
// AI (processAutonomousWeapons) zna cel i już sprawdziło linię ognia na
// sojuszników, więc strzał PD nie skanuje świata — testuje tylko swój cel:
//   1. tarczę: promień blokujący w kierunku lufy (0, gdy pole nie blokuje),
//   2. kadłub: sweep po heksach na odcinku wiązki przyciętym do okręgu kadłuba,
//      a bez siatki heksów (myśliwce) — sam okrąg, jak ogólna ścieżka.
// Dawniej każda wiązka PD przechodziła przez wszystkie NPC, stacje, platformy,
// wraki i segmenty ringu, sortowała kandydatów i robiła raymarch po heksach —
// tysiące razy na sekundę w bitwie (docs/AUDYT-wydajnosc-bitwa-2026-09-24.md, 2.2).
//
// Pudło = wiązka do pełnego zasięgu bez trafienia. Wynik ląduje w `out`
// (obiekt wielokrotnego użytku), bez alokacji.

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
 * @param deps    { shieldBlockingRadiusTowards(e, x, y), sweepImpact(e, x0, y0, x1, y1, r),
 *                  hullRadius(e), playerShip }
 */
export function resolvePdBeamHit(out, x0, y0, dirX, dirY, range, target, deps) {
  clearHit(out, range);
  if (!target || !(range > 0)) return out;
  // Rakieta/torpeda to pocisk, nie okręt: wiązka NPC nigdy ich nie niszczyła
  // (robi to CIWS i laser gracza w ciwsStep) — zostaje pudło, jak dotąd.
  if (target.type === 'rocket' || target.type === 'torpedo') return out;
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

  // 1. Tarcza. Wejście w bańkę jak w ogólnej ścieżce: max(0, t − głębokość).
  const shieldR = deps.shieldBlockingRadiusTowards ? deps.shieldBlockingRadiusTowards(entity, x0, y0) : 0;
  if (shieldR > 0 && perpSq <= shieldR * shieldR) {
    const half = Math.sqrt(shieldR * shieldR - perpSq);
    const tEnter = Math.max(0, along - half);
    if (along + half >= 0 && tEnter <= range) return finishHit(out, entity, tEnter, true, null, playerShip);
  }

  // 2. Kadłub. Okrąg kadłuba przycina wiązkę do odcinka nad siatką — sweep po
  //    heksach dostaje małe pudło komórek zamiast całej wiązki.
  const hullR = deps.hullRadius(entity);
  if (!(hullR > 0) || perpSq > hullR * hullR) return out;
  const half = Math.sqrt(hullR * hullR - perpSq);
  const tEnter = Math.max(0, along - half);
  const tExit = Math.min(range, along + half);
  if (tEnter > tExit) return out;

  if (entity.hexGrid && deps.sweepImpact) {
    const sx0 = x0 + dirX * tEnter;
    const sy0 = y0 + dirY * tEnter;
    const sx1 = x0 + dirX * tExit;
    const sy1 = y0 + dirY * tExit;
    const sweep = deps.sweepImpact(entity, sx0, sy0, sx1, sy1, 0);
    if (!sweep || !(sweep.t >= 0)) return out;
    const dist = tEnter + (tExit - tEnter) * sweep.t;
    return finishHit(out, entity, dist, false, sweep.hitShard || null, playerShip);
  }

  // 3. Bez siatki heksów (myśliwce): okrąg kadłuba.
  return finishHit(out, entity, tEnter, false, null, playerShip);
}
