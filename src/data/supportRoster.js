// Karty zakładki Rezerwa kokpitu (src/ui/cockpitUI.js) i lista spawnu panelu F12 (src/ui/devTools.js) — jedno źródło.
// Klucz karty = klucz wezwania: window.callInSupport (kokpit, przylot tunelem) i spawnCallInShip (F12, od razu) w index.html.
//
// Rezerwa: Terra Nova to na razie zastępstwo docelowej rezerwy gracza (jednostki
// zbudowane we własnej bazie). Piraci, Niezależni i tryb LINIE to spawner testowy — tylko z ?dev.
export const SUPPORT_FACTIONS = Object.freeze({
  terran: {
    label: 'Terra Nova', dataFaction: 'terra-nova', mode: 'friendly',
    roster: [
      { key: 'frigate_pd', name: 'Custos', role: 'Fregata PD', count: '×50', icon: 'frigate' },
      { key: 'destroyer', name: 'Hasta', role: 'Niszczyciel', count: '×5', icon: 'destroyer' },
      { key: 'battleship', name: 'Bellator', role: 'Pancernik', count: '×5', icon: 'battleship' },
      { key: 'carrier', name: 'Citadella', role: 'Lotniskowiec', count: '×1', icon: 'carrier' },
      { key: 'supercapital', name: 'Colossus', role: 'Supercapital', count: '×1', icon: 'supercapital' },
      { key: 'fighter', name: 'Fighter Wing', role: 'Skrzydło myśliwców', count: '×200', icon: 'fighter', click: true },
      // Holownik serwisowy (src/game/serviceTug.js): przylatuje do Atlasa, naprawia rojem dronów z własnej ładowni,
      // a statek bez napędu głównego bierze na pokład i wiezie do K-7. Kliknięcie — do Atlasa (index.html: callServiceTug).
      { key: 'service_tug', name: 'Holownik', role: 'Serwis — naprawa, transport do K-7', count: '×1', icon: 'carrier', click: true, hull: 'service_tug' },
      // `dev: true` — karta tylko z ?dev (spawner testowy), nie w rezerwie gracza.
      { key: 'frigate_laser', name: 'Custos-L', role: 'Fregata laserowa', count: '×50', icon: 'frigate', dev: true },
      { key: 'interceptor', name: 'Interceptor Wing', role: 'Skrzydło przechwytujące', count: '×200', icon: 'fighter', click: true, dev: true },
      // Role eskadr (2026-10-14, src/data/fighterSquadrons.js) — spawner testowy.
      { key: 'bomber', name: 'Bomber Wing', role: 'Bombowce — bomby na kadłub', count: '×6', icon: 'fighter', click: true, dev: true },
      { key: 'torpedo_bomber', name: 'Torpedo Wing', role: 'Torpedowce — torpedy z burty', count: '×6', icon: 'fighter', click: true, dev: true },
      { key: 'gunship', name: 'Gunship Wing', role: 'Kanonierki — orbita i wieżyczka', count: '×4', icon: 'fighter', click: true, dev: true }
    ]
  },
  pirate: {
    label: 'Piraci', dataFaction: 'pirates', mode: 'pirate', devOnly: true,
    roster: [
      { key: 'frigate_pd', name: 'Pirate Frigate', role: 'Fregata rajderska', count: '×50', icon: 'frigate' },
      { key: 'destroyer', name: 'Pirate Destroyer', role: 'Niszczyciel rajderski', count: '×5', icon: 'destroyer' },
      { key: 'pirate_battleship', name: 'Pirate Battleship', role: 'Pancernik rajderski', count: '×1', icon: 'battleship' },
      { key: 'pirate_supercapital', name: 'Iron Skull — Supercapital', role: 'Supercapital piratów', count: '×1', icon: 'supercapital' },
      // Pirackie eskadry (2026-10-14): myśliwce i role uderzeniowe na Atlasa.
      { key: 'interceptor', name: 'Pirate Interceptors', role: 'Myśliwce przechwytujące', count: '×9', icon: 'fighter', click: true },
      { key: 'bomber', name: 'Pirate Bombers', role: 'Bombowce — bomby na kadłub', count: '×6', icon: 'fighter', click: true },
      { key: 'torpedo_bomber', name: 'Pirate Torpedo Wing', role: 'Torpedowce', count: '×6', icon: 'fighter', click: true },
      { key: 'gunship', name: 'Pirate Gunships', role: 'Kanonierki na orbicie', count: '×4', icon: 'fighter', click: true },
      // Kadłuby ruchu v2 bez AI i broni (spawnDevHull w index.html).
      { key: 'smuggler', name: 'Przemytnik', role: 'Bez broni i AI', count: '×1', icon: 'frigate', hull: 'smuggler', hp: 600, speed: 240 },
      { key: 'pirate_raider', name: 'Rajder', role: 'Bez broni i AI', count: '×1', icon: 'destroyer', hull: 'pirate_raider', hp: 1400, speed: 220 }
    ]
  },
  independent: {
    label: 'Niezależni', dataFaction: 'independent', mode: 'dummy', devOnly: true,
    roster: [
      { key: 'atlas', name: 'Atlas', role: 'Niezależny supercapital', count: '×1', icon: 'supercapital' },
      { key: 'megafreighter', name: 'Megafreighter', role: 'Jednostka użytkowa', count: '×1', icon: 'carrier' },
      // Frachtowce i kadłuby cywilne bez AI i broni (spawnDevHull w index.html).
      { key: 'freighter-small', name: 'Wahadłowiec', role: 'Frachtowiec mały', count: '×1', icon: 'frigate', hull: 'inter_station_shuttle', hp: 400, speed: 210 },
      { key: 'freighter-medium', name: 'Kontenerowiec', role: 'Frachtowiec średni', count: '×1', icon: 'frigate', hull: 'container_ship', hp: 900, speed: 175 },
      { key: 'freighter-large', name: 'Frachtowiec DZ', role: 'Dalekiego zasięgu', count: '×1', icon: 'destroyer', hull: 'long_haul_freighter', hp: 1600, speed: 140 },
      { key: 'freighter-capital', name: 'Ciężki frachtowiec', role: 'Frachtowiec kapitałowy', count: '×1', icon: 'battleship', hull: 'heavy_freighter', hp: 4000, speed: 115 },
      { key: 'tanker', name: 'Tankowiec', role: 'Cywilny', count: '×1', icon: 'destroyer', hull: 'tanker', hp: 1600, speed: 140 },
      { key: 'heavy_harvester', name: 'Ciężki zbieracz', role: 'Górnik', count: '×1', icon: 'destroyer', hull: 'heavy_harvester', hp: 1500, speed: 120 },
      { key: 'belter', name: 'Belter', role: 'Górnik', count: '×1', icon: 'frigate', hull: 'belter', hp: 500, speed: 180 },
      { key: 'refinery_tender', name: 'Rafineria', role: 'Przemysł', count: '×1', icon: 'battleship', hull: 'refinery_tender', hp: 1800, speed: 120 },
      { key: 'surveyor', name: 'Zwiadowca', role: 'Geologia', count: '×1', icon: 'frigate', hull: 'surveyor', hp: 500, speed: 220 },
      { key: 'salvage_hauler', name: 'Złomiarz', role: 'Holownik wraków', count: '×1', icon: 'destroyer', hull: 'salvage_hauler', hp: 1400, speed: 150 },
      { key: 'construction_tug', name: 'Holownik', role: 'Budowlany', count: '×1', icon: 'frigate', hull: 'construction_tug', hp: 700, speed: 170 },
      { key: 'repair_drone', name: 'Dron naprawczy', role: 'Serwis', count: '×1', icon: 'fighter', hull: 'repair_drone', hp: 200, speed: 260 },
      { key: 'distress_beacon_ship', name: 'Statek ratunkowy', role: 'Ratownictwo', count: '×1', icon: 'frigate', hull: 'distress_beacon_ship', hp: 600, speed: 200 }
    ]
  }
});
