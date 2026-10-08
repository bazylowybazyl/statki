// src/game/hardpointService.js
//
// Usługi doku dla gniazd broni gracza (etap 0 planu fitowania, docs/PLAN-fitowanie.md § 2.2):
//  - REMONT w doku (handleRepair / dockRemontShip w index.html) przywraca gniazda ZNISZCZONE. Gniazdo ginie
//    razem z kadłubem pod sobą (markHardpointDestroyed: `hp.destroyed`, broń przepada) i do 2026-10-08 nic go
//    nie przywracało. Wraca PUSTE — broń obsadza się u mechanika z magazynu; cena: osobna pozycja remontu;
//  - UZUPEŁNIENIE AMUNICJI (MECHANIK): magazynki gniazd (rakiety, torpedy, Supernova) do pełna. Dawniej tylko
//    przez ponowne upuszczenie tej samej broni na gniazdo. Na razie bez opłaty.
// Bez DOM i three (testy node).

export const HARDPOINT_SERVICE = Object.freeze({
  // Remont w doku: kredyty za każde zniszczone gniazdo broni (wzorem ENGINE_REPAIR.dockCostPerNozzle).
  dockCostPerSocket: 50
});

/** Ile gniazd z listy jest zniszczonych. */
export function countDestroyedHardpoints(hardpoints) {
  if (!Array.isArray(hardpoints)) return 0;
  let n = 0;
  for (const hp of hardpoints) if (hp?.destroyed) n++;
  return n;
}

/**
 * Przywraca zniszczone gniazda — puste (broń przepadła razem z gniazdem; pamięć roju dronów `__lostMount`
 * też, bo remont w doku nie montuje). Zwraca liczbę przywróconych gniazd.
 */
export function restoreDestroyedHardpoints(hardpoints) {
  if (!Array.isArray(hardpoints)) return 0;
  let n = 0;
  for (const hp of hardpoints) {
    if (!hp?.destroyed) continue;
    hp.destroyed = false;
    hp.__supportMisses = 0;
    hp.__lostMount = null;
    hp.mount = null;
    hp.ammo = null;
    hp.maxAmmo = null;
    hp.missileCd = 0;
    if (Array.isArray(hp.hangarSquadrons)) hp.hangarSquadrons = [];
    n++;
  }
  return n;
}

// Pojemność magazynka gniazda: zapisana w gnieździe (kampania daje rakietom ×2) albo z karty broni.
function magazineOf(hp, ammoOf) {
  if (!hp || hp.destroyed || !hp.mount) return 0;
  const own = Number(hp.maxAmmo);
  if (typeof hp.maxAmmo === 'number' && Number.isFinite(own) && own > 0) return own;
  const base = Number(typeof ammoOf === 'function' ? ammoOf(hp.mount) : null);
  return Number.isFinite(base) && base > 0 ? base : 0;
}

/**
 * Stan magazynków gniazd: { have, max, slots, missing } — sztuki amunicji teraz i do pełna, gniazda
 * z magazynkiem i gniazda do uzupełnienia. `ammoOf(id)` → amunicja z karty broni (null = bez magazynka).
 */
export function hardpointAmmoState(hardpoints, ammoOf, out = { have: 0, max: 0, slots: 0, missing: 0 }) {
  out.have = 0; out.max = 0; out.slots = 0; out.missing = 0;
  if (!Array.isArray(hardpoints)) return out;
  for (const hp of hardpoints) {
    const cap = magazineOf(hp, ammoOf);
    if (cap <= 0) continue;
    const have = Math.max(0, Math.min(cap, Number(hp.ammo) || 0));
    out.have += have;
    out.max += cap;
    out.slots++;
    if (have < cap) out.missing++;
  }
  return out;
}

/** Magazynki gniazd do pełna (`hp.ammo = hp.maxAmmo`). Zwraca liczbę uzupełnionych gniazd. */
export function refillHardpointAmmo(hardpoints, ammoOf) {
  if (!Array.isArray(hardpoints)) return 0;
  let n = 0;
  for (const hp of hardpoints) {
    const cap = magazineOf(hp, ammoOf);
    if (cap <= 0) continue;
    if (typeof hp.maxAmmo !== 'number' || !(hp.maxAmmo > 0)) hp.maxAmmo = cap;
    if ((Number(hp.ammo) || 0) >= cap) continue;
    hp.ammo = cap;
    n++;
  }
  return n;
}
