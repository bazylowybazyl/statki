// Jawne czujniki jednostek bez własnego profilu `sensors` (audyt zasięgów 2026-11-11,
// docs/AUDYT-zasiegi-jednostek-2026-11-11.md, reguła zasieg-czujnikow).
//
// Okręty z SHIPS / SUPPORT_SHIP_TEMPLATES / CAPITAL_SHIP_TEMPLATES niosą `sensors` (SHIP_SENSOR_PROFILES). Tu reszta:
// myśliwce z hangarów i misji (bez kopii profilu), piraci `spawnPirate`, holownik serwisowy, kadłuby ruchu v2 (awans do
// NPC, kadłuby dev), okręty z awansu ruchu. Klucz: `type` bytu, potem `shipFrame` (id kadłuba).
//
// WARTOŚCI = dzisiejsze wyniki gałęzi awaryjnych (rozgrywka bez zmian — test „stan neutralny” i
// tests/zasiegiJednostek.test.mjs): moc z `fallbackSensorProfile` (fleetAwareness.js, z typu), sygnatura z kubełków
// promienia `getEntitySizeModifier` w stanie ustalonym (promień kotwicy kadłuba na belkach; przed zbudowaniem kadłuba —
// pierwsze klatki po spawnie — kubełek promienia szablonu bywał inny; dotyczy kadłubów cywilnych, które nie należą do
// stron obrazu sytuacji AI, więc rozgrywki nie zmienia). Wartości, które wyglądają na
// niezgodne z klasą (holownik 1,0, megafrachtowiec z awansu 18 km, kadłuby cywilne w klasie fregaty), czekają na decyzję
// użytkownika — lista w audycie, § „Decyzje”.

/** Profil SHIP_SENSOR_PROFILES (klucz) dla bytu bez `sensors`. */
export const SENSOR_PROFILE_BY_UNIT = Object.freeze({
  // typy z miejsc tworzenia (spawnCarrierFighter, myśliwce gracza, drony bazy piratów, spawnPirate, awans ruchu)
  fighter: 'fighter_combat',
  interceptor: 'fighter_combat',
  frigate: 'frigate_combat',
  frigate_pd: 'frigate_combat',
  frigate_laser: 'frigate_combat',
  destroyer: 'destroyer_combat',
  battleship: 'battleship_combat',
  carrier: 'capital_combat',
  // kadłuby (shipFrame) bez profilu
  service_tug: 'frigate_combat',
  inter_station_shuttle: 'frigate_combat',
  container_ship: 'frigate_combat',
  long_haul_freighter: 'frigate_combat',
  heavy_freighter: 'frigate_combat',
  megafreighter: 'frigate_combat',       // tylko awans ruchu (wezwanie ma capital_combat w szablonie) — decyzja
  heavy_harvester: 'frigate_combat',
  belter: 'frigate_combat',
  surveyor: 'frigate_combat',
  refinery_tender: 'frigate_combat',
  tanker: 'frigate_combat',
  salvage_hauler: 'frigate_combat',
  construction_tug: 'frigate_combat',
  pirate_raider: 'frigate_combat',
  smuggler: 'frigate_combat',
  repair_drone: 'fighter_combat',
  distress_beacon_ship: 'frigate_combat',
  bounty_hunter: 'frigate_combat',
  police_cutter: 'frigate_combat',
  rescue_ship: 'frigate_combat'
});

/**
 * Wykrywalność klasy (mnożnik zasięgu czujnika) bytu, którego `type` nie ma w `SENSOR_CONFIG.sizeModifiers`
 * i który nie ma `isCapitalShip`. Liczby, nie nazwy klas: część to wartości ze stanu ustalonego kubełków promienia.
 */
export const SENSOR_SIGNATURE_BY_UNIT = Object.freeze({
  interceptor: 0.5,           // = fighter
  // frigate_pd / frigate_laser — CELOWO BRAK (wyjątek SIGNATURE_PENDING_DECISION niżej).
  carrier: 1.0,               // lotniskowiec z awansu ruchu (bez isCapitalShip) — wezwanie ma 1,3: decyzja
  service_tug: 1.0,
  inter_station_shuttle: 0.85,
  container_ship: 1.0,
  long_haul_freighter: 1.0,
  heavy_freighter: 1.0,
  megafreighter: 1.0,
  heavy_harvester: 1.0,
  belter: 0.7,
  surveyor: 0.7,
  refinery_tender: 1.0,
  tanker: 1.0,
  salvage_hauler: 1.0,
  construction_tug: 1.0,
  pirate_raider: 1.0,
  smuggler: 1.0,
  repair_drone: 0.7,
  distress_beacon_ship: 0.7,
  bounty_hunter: 1.0,
  police_cutter: 1.0,
  rescue_ship: 1.0
});

/**
 * Jednostki, których wykrywalność ZOSTAJE na kubełkach promienia do decyzji użytkownika (D1 w audycie): fregata z wezwań
 * (`frigate_pd`, `frigate_laser`) ma 0,7 przy promieniu szablonu (45 j., zaraz po spawnie; tak liczy test AI
 * tests/fleetAwareness.test.mjs), a 1,0, gdy kadłub na belkach nadpisze promień kotwicą (≥ 100 j.) — w grze prawie
 * zawsze 1,0. Jawna liczba zmieniłaby jedną z tych faz: 0,7 (tabela klas, zamiar) albo 1,0 (stan gry). Pilnuje
 * tests/zasiegiJednostek.test.mjs (wyjątek musi dalej trafiać w kubełki; nowy — nie przejdzie).
 */
export const SIGNATURE_PENDING_DECISION = Object.freeze(['frigate_pd', 'frigate_laser']);

function key(table, e) {
  const type = String(e?.type || '').toLowerCase();
  if (type && Object.prototype.hasOwnProperty.call(table, type)) return type;
  const frame = e?.shipFrame || e?.activeHullId;
  if (frame && Object.prototype.hasOwnProperty.call(table, frame)) return frame;
  return null;
}

/** Klucz SENSOR_PROFILE_BY_UNIT bytu (typ, potem kadłub) albo null. */
export function unitSensorProfileKey(e) { return key(SENSOR_PROFILE_BY_UNIT, e); }

/** Klucz SENSOR_SIGNATURE_BY_UNIT bytu (typ, potem kadłub) albo null. */
export function unitSignatureKey(e) { return key(SENSOR_SIGNATURE_BY_UNIT, e); }
