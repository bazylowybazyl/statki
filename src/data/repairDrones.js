// src/data/repairDrones.js
//
// RÓJ DRONÓW NAPRAWCZYCH — dane i strojenie (decyzje użytkownika 2026-10-08):
//   • każdy okręt NOSI własne drony (liczba wg kadłuba niżej); gracz wypuszcza je i odwołuje klawiszem R, nic się nie
//     dzieje z automatu (bez wycofania pod ostrzałem); drony giną od ostrzału, uzupełnia się je w doku (HANGAR);
//   • drony prostują wgniecenia (lokalnie — HullBodies.straightenAt), odbudowują zniszczone komórki kadłuba — dziury
//     i odcięte sekcje (HullBodies.regrowCell) — z MATERIAŁU Z ŁADOWNI nosiciela (złom → stal → płyty kadłubowe) i oddają
//     punkty kadłuba tyle, ile naprawiły;
//   • odbudowana komórka to ŁATA: niewiele słabsza (sufit HP węzła × patchHpMul), niepomalowana (podkład ze spawami) —
//     do remontu w doku; gniazdo broni na łacie wraca, broń tylko z ładowni / inwentarza (drony ją montują);
//   • dysze MAIN w polu nie wracają (zatrzask uszkodzenia silników — holownik serwisowy), reaktor to osobny system.
// Logika: src/game/repairRig.js (czysta), rejestr i trafienia: src/game/repairSwarm.js, obraz: src/3d/repair/.
// Strojenie na żywo: window.RepairTune (ten sam obiekt co REPAIR_TUNE — rig czyta go co krok).

/** Liczba dronów na kadłub gracza (PLAYER.activeHullId) — Atlas 8, pancernik 6, niszczyciel 4, fregata 2. */
export const REPAIR_DRONE_COUNTS = Object.freeze({
  atlas: 8,
  supercapital: 8,
  carrier: 6,
  battleship: 6,
  pirate_battleship: 6,
  megafreighter: 6,
  destroyer: 4,
  pirate_destroyer: 4,
  corvus: 4,
  frigate: 2,
  pirate_frigate: 2
});

/**
 * Drony kadłuba (id katalogu gracza albo profil renderu NPC); bez wpisu — z długości kadłuba [j.]: ≥ 1500 → 8,
 * ≥ 550 → 6, ≥ 300 → 4, mniejsze → 2 (myśliwce i drony bez roju: 0 przy długości < 120).
 */
export function repairDroneCountFor(hullId, hullLength = 0) {
  const n = REPAIR_DRONE_COUNTS[String(hullId || '')];
  if (Number.isFinite(n)) return n;
  const L = Number(hullLength) || 0;
  if (L <= 0) return 0;
  if (L < 120) return 0;
  if (L >= 1500) return 8;
  if (L >= 550) return 6;
  if (L >= 300) return 4;
  return 2;
}

/** Materiał naprawy w kolejności zużycia i ile komórek kadłuba daje jednostka (tona złomu / stali, płyta). */
export const REPAIR_MATERIALS = Object.freeze(['scrap', 'steel', 'hull_plate']);

/**
 * Strojenie roju (mutowalne — window.RepairTune). Jednostki: j. świata gry, sekundy czasu gry.
 * Atlas ma ~3100 komórek (węzłów) kadłuba i ładowność 20: pełna ładownia stali = 800 komórek ≈ ¼ kadłuba.
 */
export const REPAIR_TUNE = {
  // --- dron ---
  droneLength: 26,          // [j.] długość bryły (~1,7 komórki Atlasa 15 j. — czytelny przy zwykłym zoomie)
  droneHp: 80,              // CIWS 12 / szyna 10 → kilka trafień; działko 28 → 3; flak, rakiety — od razu
  hitRadius: 11,            // [j.] koło trafienia pocisków, wiązek i wybuchów
  shieldProtects: true,     // dron w obrysie DZIAŁAJĄCEJ tarczy celu / nosiciela (poza przebiciem pola) — bez trafień
  // --- lot (w układzie celu: kadłub stoi, dron dopasowuje ruch i obrót sam) ---
  maxSpeed: 900,            // [j/s] względem kadłuba
  accel: 2400,              // [j/s²]
  turnRate: 7,              // [rad/s] obrót bryły ku kursowi
  cruiseZ: 34,              // [j.] wysokość przelotu nad poszyciem (nad wieżami)
  workZ: 7,                 // [j.] wysokość przy pracy (płyta tuż nad blachą)
  arriveDist: 5,            // [j.] dron „przykleja się” do komórki bliżej niż tyle
  launchInterval: 0.16,     // [s] odstęp startów z doku
  dockAlong: -0.16,         // dok na grzbiecie nosiciela: wzdłuż kadłuba × długość (od środka sprite'a)
  dockSide: 0,              // w poprzek [× szerokość]
  dockZ: 10,
  plateForward: 10,         // [j.] środek niesionej płyty przed środkiem drona (pod dziobem)
  // --- praca ---
  weldTime: 1.0,            // [s] spawanie jednej komórki (łaty)
  socketTime: 2.6,          // [s] gniazdo broni (i montaż broni z ładowni)
  straightenRadius: 2,      // [komórki] kwadrat ±r prostowany przez jednego drona
  straightenRate: 4,        // [1/s] kształt i długości belek (stała czasowa 0,25 s)
  straightenHpRate: 0.8,    // [maks. HP / s] HP węzłów w obszarze
  straightenTimeout: 4,     // [s] najdłużej jedno zadanie prostowania
  patchHpMul: 0.85,         // sufit HP łaty (× maks. HP węzła) do remontu w doku; też cel punktów (repairRig.js)
  // --- materiał ---
  cellsPerUnit: { scrap: 15, steel: 40, hull_plate: 200 },
  // --- plan ---
  planInterval: 0.25,       // [s] skan kadłuba (repairNeeds, front odrostu, gniazda)
  spacingCells: 3,          // [komórki] drony pracują co najmniej tyle komórek od siebie (gdy się da)
  cellCooldown: 1.5,        // [s] komórka po zakończonym prostowaniu nie wraca od razu do planu
  blockedCooldown: 4,       // [s] komórka zajęta przez inne ciało (wrak odciętej sekcji) — pauza
  // --- dok ---
  refillPrice: 450          // [CR] nowy dron w doku (HANGAR)
};

/** Komórek kadłuba z worka materiału (złom, stal, płyty) przy strojeniu `tune` (domyślnie REPAIR_TUNE). */
export function repairMaterialCells(bag, tune = REPAIR_TUNE) {
  let cells = 0;
  for (const key of REPAIR_MATERIALS) cells += Math.max(0, Math.floor(Number(bag?.[key]) || 0)) * (Number(tune.cellsPerUnit?.[key]) || 0);
  return cells;
}

/**
 * Start kampanii: zapas naprawczy Atlasa w ładowni (jak startowe ładunki górnicze) — 10 t stali + 1 płyta = 600 komórek
 * (~19% kadłuba), 14 z 20 t ładowni: naprawa w polu w misji 2 działa, zanim przyleci holownik serwisowy.
 */
export const REPAIR_START_CARGO = Object.freeze({ steel: 10, hull_plate: 1 });
