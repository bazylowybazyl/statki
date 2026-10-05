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
  })
});

export const BRIDGE_DEMO_ORDER = Object.freeze([
  'atlas', 'battleship', 'pirate_battleship', 'frigate', 'destroyer', 'terran_carrier', 'terran_supercapital',
  'pirate_frigate', 'pirate_destroyer', 'pirate_supercapital', 'megafreighter'
]);
