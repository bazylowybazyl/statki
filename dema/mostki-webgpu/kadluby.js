// Katalog kadłubów z mostkami — dema/mostki-webgpu.html i testy (tests/shipBridgeBeams.test.mjs).
// Bez DOM: ścieżki sprite'ów względem korzenia repozytorium (przeglądarka składa z nich URL-e,
// Node czyta PNG z dysku). Encja NPC jak w grze: typ, frakcja i profil renderu wybierają klucz
// mostka (resolveBridgeHullKey) i profil kadłuba (getNpcHullRenderProfileId w index.html).

export const BRIDGE_DEMO_HULLS = Object.freeze({
  atlas: Object.freeze({
    key: 'atlas', label: 'Atlas', faction: 'atlas', sprite: 'assets/capital_ship_rect_v1.png', profile: 'atlas',
    npc: Object.freeze({ type: 'atlas', isPirate: false, shipFrame: 'atlas', mass: 800000 })
  }),
  battleship: Object.freeze({
    key: 'battleship', label: 'Bellator', faction: 'terran', sprite: 'src/assets/ships/terranbattleship.png', profile: 'terran_battleship',
    npc: Object.freeze({ type: 'battleship', isPirate: false, shipFrame: 'terran_battleship', mass: 50000 })
  }),
  pirate_battleship: Object.freeze({
    key: 'pirate_battleship', label: 'Iron Skull', faction: 'pirate', sprite: 'src/assets/ships/piratebattleship.png', profile: 'pirate_battleship',
    npc: Object.freeze({ type: 'battleship', isPirate: true, shipFrame: 'pirate_battleship', mass: 50000 })
  }),
  frigate: Object.freeze({
    key: 'frigate', label: 'Custos', faction: 'terran', sprite: 'src/assets/ships/terranfrigate.png', profile: 'terran_frigate',
    npc: Object.freeze({ type: 'frigate', isPirate: false, shipFrame: 'terran_frigate', mass: 10000 })
  }),
  destroyer: Object.freeze({
    key: 'destroyer', label: 'Hasta', faction: 'terran', sprite: 'src/assets/ships/terrandestroyer.png', profile: 'terran_destroyer',
    npc: Object.freeze({ type: 'destroyer', isPirate: false, shipFrame: 'terran_destroyer', mass: 25000 })
  }),
  terran_carrier: Object.freeze({
    key: 'terran_carrier', label: 'Citadella', faction: 'terran', sprite: 'src/assets/ships/terrancarrier.png', profile: 'terran_carrier',
    npc: Object.freeze({ type: 'carrier', isPirate: false, shipFrame: 'terran_carrier', mass: 200000 })
  }),
  terran_supercapital: Object.freeze({
    key: 'terran_supercapital', label: 'Colossus', faction: 'terran', sprite: 'src/assets/ships/terransupercapital.png', profile: 'terran_supercapital',
    npc: Object.freeze({ type: 'supercapital', isPirate: false, shipFrame: 'terran_supercapital', mass: 400000 })
  }),
  pirate_frigate: Object.freeze({
    key: 'pirate_frigate', label: 'Fregata piratów', faction: 'pirate', sprite: 'src/assets/ships/piratefrigate.png', profile: 'pirate_frigate',
    npc: Object.freeze({ type: 'frigate', isPirate: true, shipFrame: 'pirate_frigate', mass: 10000 })
  }),
  pirate_destroyer: Object.freeze({
    key: 'pirate_destroyer', label: 'Niszczyciel piratów', faction: 'pirate', sprite: 'src/assets/ships/piratedestroyer.png', profile: 'pirate_destroyer',
    npc: Object.freeze({ type: 'destroyer', isPirate: true, shipFrame: 'pirate_destroyer', mass: 25000 })
  }),
  pirate_supercapital: Object.freeze({
    key: 'pirate_supercapital', label: 'Supercapital piratów', faction: 'pirate', sprite: 'src/assets/ships/piratecapital.png', profile: 'pirate_supercapital',
    npc: Object.freeze({ type: 'pirate_supercapital', isPirate: true, shipFrame: 'pirate_supercapital', mass: 400000 })
  }),
  megafreighter: Object.freeze({
    key: 'megafreighter', label: 'Megafrachtowiec (lokomotywa)', faction: 'civil', sprite: 'assets/megafreighterfront.png', profile: 'megafreighter',
    npc: Object.freeze({ type: 'megafreighter_front', isPirate: false, shipFrame: 'megafreighter', mass: 900000 })
  }),
  // Kadłuby ruchu v2 (E13, 2026-10-22): mostek poziomu z pola kadłuba (model `tn_<poziom>`), awans statku bańki do NPC.
  inter_station_shuttle: Object.freeze({
    key: 'inter_station_shuttle', label: 'Wahadłowiec międzystacyjny', faction: 'civil', sprite: 'assets/inter_station_shuttle.png', profile: 'inter_station_shuttle',
    npc: Object.freeze({ type: 'freighter-small', isPirate: false, shipFrame: 'inter_station_shuttle', mass: 3000 })
  }),
  container_ship: Object.freeze({
    key: 'container_ship', label: 'Kontenerowiec', faction: 'civil', sprite: 'assets/container_ship.png', profile: 'container_ship',
    npc: Object.freeze({ type: 'freighter-medium', isPirate: false, shipFrame: 'container_ship', mass: 9000 })
  }),
  long_haul_freighter: Object.freeze({
    key: 'long_haul_freighter', label: 'Frachtowiec dalekiego zasięgu', faction: 'civil', sprite: 'assets/long_haul_freighter.png', profile: 'long_haul_freighter',
    npc: Object.freeze({ type: 'freighter-large', isPirate: false, shipFrame: 'long_haul_freighter', mass: 20000 })
  }),
  heavy_freighter: Object.freeze({
    key: 'heavy_freighter', label: 'Ciężki frachtowiec', faction: 'civil', sprite: 'assets/long_haul_freighter.png', profile: 'heavy_freighter',
    npc: Object.freeze({ type: 'freighter-capital', isPirate: false, shipFrame: 'heavy_freighter', mass: 150000 })
  }),
  heavy_harvester: Object.freeze({
    key: 'heavy_harvester', label: 'Ciężki kombajn górniczy', faction: 'civil', sprite: 'assets/heavy_harvester.png', profile: 'heavy_harvester',
    npc: Object.freeze({ type: 'heavy_harvester', isPirate: false, shipFrame: 'heavy_harvester', mass: 15000 })
  }),
  belter: Object.freeze({
    key: 'belter', label: 'Belter', faction: 'civil', sprite: 'assets/belter.png', profile: 'belter',
    npc: Object.freeze({ type: 'belter', isPirate: false, shipFrame: 'belter', mass: 5000 })
  }),
  surveyor: Object.freeze({
    key: 'surveyor', label: 'Zwiadowca złóż', faction: 'civil', sprite: 'assets/surveyor.png', profile: 'surveyor',
    npc: Object.freeze({ type: 'surveyor', isPirate: false, shipFrame: 'surveyor', mass: 5000 })
  }),
  refinery_tender: Object.freeze({
    key: 'refinery_tender', label: 'Mobilna rafineria', faction: 'civil', sprite: 'assets/refinery_tender.png', profile: 'refinery_tender',
    npc: Object.freeze({ type: 'refinery_tender', isPirate: false, shipFrame: 'refinery_tender', mass: 20000 })
  }),
  tanker: Object.freeze({
    key: 'tanker', label: 'Tankowiec', faction: 'civil', sprite: 'assets/tanker.png', profile: 'tanker',
    npc: Object.freeze({ type: 'tanker', isPirate: false, shipFrame: 'tanker', mass: 20000 })
  }),
  salvage_hauler: Object.freeze({
    key: 'salvage_hauler', label: 'Złomiarz', faction: 'civil', sprite: 'assets/salvage_hauler.png', profile: 'salvage_hauler',
    npc: Object.freeze({ type: 'salvage_hauler', isPirate: false, shipFrame: 'salvage_hauler', mass: 15000 })
  }),
  construction_tug: Object.freeze({
    key: 'construction_tug', label: 'Holownik budowlany', faction: 'civil', sprite: 'assets/construction_tug.png', profile: 'construction_tug',
    npc: Object.freeze({ type: 'construction_tug', isPirate: false, shipFrame: 'construction_tug', mass: 7000 })
  }),
  smuggler: Object.freeze({
    key: 'smuggler', label: 'Przemytnik', faction: 'pirate', sprite: 'assets/smuggler.png', profile: 'smuggler',
    npc: Object.freeze({ type: 'frigate', isPirate: true, shipFrame: 'smuggler', mass: 7000 })
  }),
  pirate_raider: Object.freeze({
    key: 'pirate_raider', label: 'Rajder piratów', faction: 'pirate', sprite: 'assets/pirate_raider.png', profile: 'pirate_raider',
    npc: Object.freeze({ type: 'frigate', isPirate: true, shipFrame: 'pirate_raider', mass: 12000 })
  }),
  distress_beacon_ship: Object.freeze({
    key: 'distress_beacon_ship', label: 'Statek z boją alarmową', faction: 'civil', sprite: 'assets/distress_beacon_ship.png', profile: 'distress_beacon_ship',
    npc: Object.freeze({ type: 'distress_beacon_ship', isPirate: false, shipFrame: 'distress_beacon_ship', mass: 6000 })
  }),
  repair_drone: Object.freeze({
    key: 'repair_drone', label: 'Dron naprawczy', faction: 'civil', sprite: 'assets/repair_drone.png', profile: 'repair_drone',
    npc: Object.freeze({ type: 'repair_drone', isPirate: false, shipFrame: 'repair_drone', mass: 2000 })
  }),
  bounty_hunter: Object.freeze({
    key: 'bounty_hunter', label: 'Łowca nagród', faction: 'civil', sprite: 'assets/ships/bounty_hunter.png', profile: 'bounty_hunter',
    npc: Object.freeze({ type: 'frigate', isPirate: false, shipFrame: 'bounty_hunter', mass: 10000 })
  }),
  police_cutter: Object.freeze({
    key: 'police_cutter', label: 'Kuter policji', faction: 'civil', sprite: 'assets/ships/police_cutter.png', profile: 'police_cutter',
    npc: Object.freeze({ type: 'frigate', isPirate: false, shipFrame: 'police_cutter', mass: 8000 })
  }),
  rescue_ship: Object.freeze({
    key: 'rescue_ship', label: 'Statek ratunkowy', faction: 'civil', sprite: 'assets/ships/rescue_ship.png', profile: 'rescue_ship',
    npc: Object.freeze({ type: 'rescue_ship', isPirate: false, shipFrame: 'rescue_ship', mass: 8000 })
  })
});

export const BRIDGE_DEMO_ORDER = Object.freeze([
  'atlas', 'battleship', 'pirate_battleship', 'frigate', 'destroyer', 'terran_carrier', 'terran_supercapital',
  'pirate_frigate', 'pirate_destroyer', 'pirate_supercapital', 'megafreighter',
  'inter_station_shuttle', 'container_ship', 'long_haul_freighter', 'heavy_freighter', 'heavy_harvester', 'belter',
  'surveyor', 'refinery_tender', 'tanker', 'salvage_hauler', 'construction_tug', 'smuggler',
  'pirate_raider', 'distress_beacon_ship', 'repair_drone', 'bounty_hunter', 'police_cutter', 'rescue_ship'
]);
