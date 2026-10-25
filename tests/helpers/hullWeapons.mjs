import { MASTER_WEAPONS } from '../../src/data/weapons.js';
import { weaponRangeFor } from '../../src/game/shipModifiers.js';

// Testy lotu bez fireWeaponCore: gotowe zasięgi danego kadłuba, jak w profilu rzeczywistej salwy.
export function weaponsForHull(hullId) {
  return Object.fromEntries(Object.entries(MASTER_WEAPONS).map(([id, def]) => [id, {
    ...def, baseRange: weaponRangeFor({ activeHullId: hullId }, def, def.baseRange)
  }]));
}
