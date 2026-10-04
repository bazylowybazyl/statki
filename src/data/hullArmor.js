// Pancerz mechaniczny kadłuba: 1 = poszycie fregaty. Niezależny od masy,
// tarcz i HP; steruje oporem i podziałem zgniotu w zderzeniu metal-metal.
// Wspólne progi belek opisują materiał, a ten mnożnik — grubość poszycia.
export const HULL_COLLISION_ARMOR = Object.freeze({
  atlas: 16,
  supercapital: 10,
  terran_supercapital: 10,
  terran_carrier: 4,
  capital_carrier: 4,
  terran_battleship: 3,
  pirate_battleship: 3,
  terran_destroyer: 1.5,
  pirate_destroyer: 1.5,
  terran_frigate: 1,
  pirate_frigate: 1,
  corvus: 1,
  megafreighter: 2,
  heavy_freighter: 1,
  inter_station_shuttle: 0.5,
  container_ship: 0.6,
  long_haul_freighter: 0.75,
  heavy_harvester: 0.8,
  belter: 0.6,
  surveyor: 0.5,
  refinery_tender: 0.8,
  tanker: 0.6,
  salvage_hauler: 0.8,
  construction_tug: 0.8,
  pirate_raider: 1.5,
  smuggler: 0.8,
  repair_drone: 0.35,
  distress_beacon_ship: 0.5,
  fighter: 0.35,
  interceptor: 0.35
});

const ALIASES = Object.freeze({
  player: 'atlas',
  frigate: 'terran_frigate',
  frigate_pd: 'terran_frigate',
  frigate_laser: 'terran_frigate',
  destroyer: 'terran_destroyer',
  battleship: 'terran_battleship',
  carrier: 'terran_carrier'
});

export function getHullCollisionArmor(hullId) {
  const raw = String(hullId || '').trim().toLowerCase();
  const id = raw.startsWith('megafreighter_') ? 'megafreighter' : (ALIASES[raw] || raw);
  // Nieznany/ręczny kadłub zachowuje dawne strojenie; nie dostaje pancerza Atlasa.
  return HULL_COLLISION_ARMOR[id] || 1;
}
