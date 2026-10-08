// src/3d/ships3d/ships/autoHulls3D.js
//
// KADŁUBY Z AUTOMATU — modele 3D pozostałych profili (lotniskowce, superkapitały, myśliwiec,
// megafrachtowiec, kadłuby ruchu v2) bez ręcznie rysowanych brył. Wejście generatora obrysów
// (scripts/webgpu/obrysy-floty.mjs → autoOutlines3D.js) i budowniczego (autoHull3D.js).
//
// Z automatu: płyta z obrysu alfy sprite'a (z dziurami), gondole silników wycięte z płyty
// w miejscu dysz MAIN (dysze z edytora / ruchu v2 / tabeli), TARASY nadbudówek z mapy
// odległości od krawędzi (pierwszy taras = sylwetka odsunięta do środka, drugi — grzbiet), kil
// ściśnięty ku osi kadłuba. Z góry model = sprite (dachy mają jego rysunek), tak jak Atlas i flota.
// Ręcznie dopracowane kadłuby (Atlas, flota Terra Nova i piratów) — atlasHull3D.js, fleetHull3D.js.
//
// Wpis: { label, short, faction ('terran'|'pirate'|'civil'), profile (HULL_RENDER_PROFILES —
// skala jak w grze), sprite (ścieżka PNG w repo), editor (klucz SHIP_EDITOR_DEFAULTS — gniazda,
// dysze, światła), bridge (rodzaj z bridge3DShapes), nozzles: 'editor' | 'traffic' | [[x, y, d]]
// (px obrazka: środek = 0, y w dół, d = średnica wylotu), outlineOf (ten sam sprite co inny
// wpis — inna skala), worldWidth (skala bez profilu: szerokość płótna w j. świata), tiers }.

import { TRAFFIC_HULLS } from '../../../data/trafficHulls.js';
import { SHIP_EDITOR_DEFAULTS } from '../../../data/hardpointEditorDefaults.js';
import { ENGINE_FX_DEFAULTS } from '../../../data/engineFx.js';

const TRAFFIC_LABELS = {
  inter_station_shuttle: ['Wahadłowiec międzystacyjny', 'Wahadłowiec'],
  container_ship: ['Kontenerowiec', 'Kontenerowiec'],
  long_haul_freighter: ['Frachtowiec dalekiego zasięgu', 'Frachtowiec DZ'],
  heavy_freighter: ['Ciężki frachtowiec', 'Ciężki frachtowiec'],
  megafreighter: ['Megafrachtowiec (cały skład)', 'Megafrachtowiec'],
  heavy_harvester: ['Ciężki kombajn górniczy', 'Kombajn'],
  belter: ['Belter (Unia Pasa)', 'Belter'],
  surveyor: ['Zwiadowca złóż', 'Zwiadowca'],
  refinery_tender: ['Mobilna rafineria', 'Rafineria'],
  tanker: ['Tankowiec', 'Tankowiec'],
  salvage_hauler: ['Złomiarz', 'Złomiarz'],
  construction_tug: ['Holownik budowlany', 'Holownik'],
  pirate_raider: ['Rajder piratów', 'Rajder'],
  smuggler: ['Przemytnik', 'Przemytnik'],
  repair_drone: ['Dron naprawczy', 'Dron naprawczy'],
  distress_beacon_ship: ['Statek z boją alarmową', 'Boja alarmowa'],
  service_tug: ['Holownik serwisowy', 'Holownik serwisowy']
};

// Ścieżki PNG w repo (TRAFFIC_HULLS ma URL-e modułu — tu ścieżki do testów, dema i generatora).
const TRAFFIC_SPRITES = {
  inter_station_shuttle: 'assets/inter_station_shuttle.png',
  container_ship: 'assets/container_ship.png',
  long_haul_freighter: 'assets/long_haul_freighter.png',
  heavy_freighter: 'assets/long_haul_freighter.png',
  megafreighter: 'assets/megafreighter.png',
  heavy_harvester: 'assets/heavy_harvester.png',
  belter: 'assets/belter.png',
  surveyor: 'assets/surveyor.png',
  refinery_tender: 'assets/refinery_tender.png',
  tanker: 'assets/tanker.png',
  salvage_hauler: 'assets/salvage_hauler.png',
  construction_tug: 'assets/construction_tug.png',
  pirate_raider: 'assets/pirate_raider.png',
  smuggler: 'assets/smuggler.png',
  repair_drone: 'assets/repair_drone.png',
  distress_beacon_ship: 'assets/distress_beacon_ship.png',
  service_tug: 'assets/ships/service_tug.png'
};

const PIRATE_TRAFFIC = new Set(['pirate_raider', 'smuggler']);

export const AUTO3D_TABLE = {
  // --- okręty bojowe ---------------------------------------------------------
  terran_carrier: {
    label: 'Citadella — lotniskowiec Terra Nova', short: 'Citadella', faction: 'terran', profile: 'terran_carrier',
    sprite: 'src/assets/ships/terrancarrier.png', editor: 'terran_carrier', bridge: 'citadella', nozzles: 'editor'
  },
  terran_supercapital: {
    label: 'Colossus — superkapitał Terra Nova', short: 'Colossus', faction: 'terran', profile: 'terran_supercapital',
    sprite: 'src/assets/ships/terransupercapital.png', editor: 'terran_supercapital', bridge: 'colossus', nozzles: 'editor'
  },
  // Supercapital piratów z własnym układem użytkownika.
  pirate_supercapital: {
    label: 'Iron Skull — Supercapital piratów', short: 'Iron Skull SC', faction: 'pirate', profile: 'pirate_supercapital',
    sprite: 'src/assets/ships/piratecapital.png', editor: 'pirate_supercapital', bridge: 'pirate_supercapital', nozzles: 'editor'
  },
  // Profil `supercapital` (2000 × 0,6) — ten sam sprite Colossusa, mniejsza skala.
  supercapital: {
    label: 'Superkapitał (profil supercapital)', short: 'Superkapitał', faction: 'terran', profile: 'supercapital',
    sprite: 'src/assets/ships/terransupercapital.png', outlineOf: 'terran_supercapital', editor: 'terran_supercapital', bridge: 'colossus', nozzles: 'editor'
  },
  capital_carrier: {
    label: 'Lotniskowiec (Legacy Capital Carrier)', short: 'Lotniskowiec L', faction: 'terran', profile: 'capital_carrier',
    sprite: 'assets/carrier.png', editor: 'capital_carrier',
    nozzles: [[-646, -178, 112], [-644, -2, 108], [-646, 182, 112]]
  },
  // Myśliwiec: bez profilu kadłuba — gra rysuje sprite o szerokości 2,4 × promień (12 j.).
  fighter: {
    label: 'Myśliwiec (eskadra)', short: 'Myśliwiec', faction: 'terran', tier: 'S',
    sprite: 'assets/fighter-combat-v1.png', worldWidth: 2.4 * 12,
    nozzles: [[-543, -127, 76], [-543, 133, 76]],
    tiers: [{ f: 0.3, z: 5, bevel: 0.6 }, { f: 0.62, z: 8.5, bevel: 0.8 }],
    keel: { s: 0.45, depth: 6 }
  },
  // --- megafrachtowiec: moduły pociągu (megafreighterTrain.js) i cały skład (ruch v2) ---
  megafreighter_front: {
    label: 'Megafrachtowiec — lokomotywa', short: 'Lokomotywa', faction: 'civil', profile: 'megafreighter',
    sprite: 'assets/megafreighterfront.png', editor: 'megafreighter', bridge: 'megafreighter',
    nozzles: [[-784, -283, 46], [-784, -207, 46], [-784, 197, 46], [-784, 272, 46]]
  },
  megafreighter_wagon: {
    label: 'Megafrachtowiec — wagon', short: 'Wagon', faction: 'civil', profile: 'megafreighter',
    sprite: 'assets/megafreighterwagon.png', nozzles: []
  },
  megafreighter_back: {
    label: 'Megafrachtowiec — ogon', short: 'Ogon', faction: 'civil', profile: 'megafreighter',
    sprite: 'assets/megafrieghterback.png', nozzles: []
  },
  // --- kadłuby ruchu v2 (trafficHulls.js) ---------------------------------------
  ...Object.fromEntries(Object.keys(TRAFFIC_LABELS).map((id) => [id, {
    label: TRAFFIC_LABELS[id][0], short: TRAFFIC_LABELS[id][1],
    faction: PIRATE_TRAFFIC.has(id) ? 'pirate' : 'civil', profile: id,
    sprite: TRAFFIC_SPRITES[id], nozzles: 'traffic',
    ...(id === 'heavy_freighter' ? { outlineOf: 'long_haul_freighter' } : {})
  }]))
};

/** Dysze MAIN wpisu: [{ x, y, d }] w px obrazka (y w dół), bez duplikatów. */
export function autoHullNozzles(id) {
  const t = AUTO3D_TABLE[id];
  if (!t) return [];
  let list = [];
  if (Array.isArray(t.nozzles)) list = t.nozzles.map(([x, y, d]) => ({ x, y, d }));
  else if (t.nozzles === 'traffic') list = (TRAFFIC_HULLS[id]?.main || []).map(([x, y, d]) => ({ x, y, d }));
  else if (t.nozzles === 'editor') {
    const d = Number(ENGINE_FX_DEFAULTS[t.editor]?.mainNozzle) || 60;
    list = (SHIP_EDITOR_DEFAULTS.ships[t.editor]?.engines?.main || []).map((e) => ({ x: e.x, y: e.y, d }));
  }
  const out = [];
  for (const n of list) if (!out.some((q) => Math.hypot(q.x - n.x, q.y - n.y) < 6)) out.push(n);
  return out;
}
