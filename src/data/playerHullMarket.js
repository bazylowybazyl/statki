export const PLAYER_HULL_MARKET = Object.freeze({
  atlas: Object.freeze({ shipFrame: 'atlas', cost: 0, tier: 'starter' }),
  frigate: Object.freeze({ shipFrame: 'terran_frigate', cost: 4200, tier: 'frigate' }),
  corvus: Object.freeze({ shipFrame: 'corvus', cost: 5600, tier: 'frigate' }),
  pirate_frigate: Object.freeze({ shipFrame: 'pirate_frigate', cost: 3600, tier: 'frigate' }),
  destroyer: Object.freeze({ shipFrame: 'terran_destroyer', cost: 8200, tier: 'destroyer' }),
  pirate_destroyer: Object.freeze({ shipFrame: 'pirate_destroyer', cost: 6800, tier: 'destroyer' }),
  battleship: Object.freeze({ shipFrame: 'terran_battleship', cost: 14500, tier: 'battleship' }),
  pirate_battleship: Object.freeze({ shipFrame: 'pirate_battleship', cost: 11800, tier: 'battleship' }),
  carrier: Object.freeze({ shipFrame: 'terran_carrier', cost: 26000, tier: 'capital' }),
  megafreighter: Object.freeze({ shipFrame: 'megafreighter', cost: 36000, tier: 'industrial-capital' }),
  supercapital: Object.freeze({ shipFrame: 'terran_supercapital', cost: 48000, tier: 'supercapital' })
});

export const PLAYER_HULL_MARKET_ORDER = Object.freeze([
  'atlas',
  'frigate', 'corvus', 'pirate_frigate',
  'destroyer', 'pirate_destroyer',
  'battleship', 'pirate_battleship',
  'carrier', 'megafreighter', 'supercapital'
]);

export function getPlayerHullMarketEntry(hullId) {
  return PLAYER_HULL_MARKET[String(hullId || '').trim().toLowerCase()] || null;
}
