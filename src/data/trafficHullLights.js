// src/data/trafficHullLights.js
//
// Lampy pozycyjne CYWILNYCH kadłubów ruchu v2 (E17, decyzja orkiestratora 2026-10-28 po zgłoszeniu użytkownika
// „statki w doku jakby nieżywe”): biała dziobowa i rufowa na osi, czerwona na lewej burcie (−y), zielona na prawej
// (+y) przy 60% długości od rufy; frachtowce — druga para burtowa przy 20%, kadłuby robocze (górnicy, holowniki,
// złomiarz, tankowiec, ratownik, dron) — pomarańczowe sygnalizatory zamiast niej. Bez reflektorów otoczenia
// (`autoFlood: false` — oświetlają przestrzeń, cywil tylko świeci).
//
// Pozycje w px PNG od środka płótna (+x dziób, +y prawa burta = dół obrazka — jak markery edytora), wcięte od
// krawędzi alfy sprite'a, więc lampa leży na kadłubie: wiąże się z komórką siatki belek (hullMounts.js) i gaśnie
// z nią, a w obrazie gaśnie z maskowaniem (shipLightRuntime.js). Policzone ze sprite'ów: `node scripts/lampy-cywilow.mjs`
// (nowy cywil albo nowy sprite — wynik wklejony tutaj). Czytają: wpisy edytora `sideOnly` (hardpointEditorDefaults.js
// → NPC po awansie, applySideOnlyLayout) i proxy statków ruchu (shipProxyBatch3D.js). Pilnuje tests/trafficHullLights.test.mjs.

const COLOR = Object.freeze({ w: '#ffffff', r: '#ff2b2b', g: '#2bff6a', a: '#ffa21f' });

/** [klucz, x, y, barwa (w / r / g / a), moc?, promień?] — moc 0,8 i promień 6 px PNG, gdy nie podane. */
export const TRAFFIC_HULL_LIGHT_POINTS = Object.freeze({
  inter_station_shuttle: [['bow', 443, -5, 'w'], ['stern', -394, -5, 'w'], ['port', 92, -136, 'r'], ['stbd', 92, 126, 'g'], ['port_aft', -283, -198, 'r'], ['stbd_aft', -283, 186, 'g']],
  container_ship: [['bow', 811, -14, 'w'], ['stern', -800, -14, 'w'], ['port', 176, -171, 'r'], ['stbd', 176, 143, 'g'], ['port_aft', -503, -222, 'r'], ['stbd_aft', -503, 196, 'g']],
  long_haul_freighter: [['bow', 790, -16, 'w'], ['stern', -792, -16, 'w'], ['port', 168, -165, 'r'], ['stbd', 168, 133, 'g'], ['port_aft', -500, -204, 'r'], ['stbd_aft', -500, 171, 'g']],
  heavy_freighter: [['bow', 816, 8, 'w'], ['stern', -797, 8, 'w'], ['port', 179, -230, 'r'], ['stbd', 179, 245, 'g'], ['port_aft', -504, -247, 'r'], ['stbd_aft', -504, 215, 'g']],
  heavy_harvester: [['bow', 787, -23, 'w'], ['stern', -799, -23, 'w'], ['port', 168, -224, 'r'], ['stbd', 168, 177, 'g'], ['beacon_l', -513, -226, 'a', 1.1, 7], ['beacon_r', -513, 179, 'a', 1.1, 7]],
  belter: [['bow', 519, -23, 'w'], ['stern', -584, -23, 'w'], ['port', 92, -188, 'r'], ['stbd', 92, 145, 'g'], ['beacon_l', -383, -154, 'a', 1.1, 7], ['beacon_r', -383, 114, 'a', 1.1, 7]],
  surveyor: [['bow', 716, -9, 'w'], ['stern', -713, -9, 'w'], ['port', 148, -99, 'r'], ['stbd', 148, 81, 'g'], ['beacon_l', -457, -183, 'a', 1.1, 7], ['beacon_r', -457, 166, 'a', 1.1, 7]],
  refinery_tender: [['bow', 785, -17, 'w'], ['stern', -753, -17, 'w'], ['port', 178, -186, 'r'], ['stbd', 178, 151, 'g'], ['beacon_l', -470, -232, 'a', 1.1, 7], ['beacon_r', -470, 197, 'a', 1.1, 7]],
  tanker: [['bow', 796, -16, 'w'], ['stern', -794, -16, 'w'], ['port', 170, -183, 'r'], ['stbd', 170, 150, 'g'], ['beacon_l', -501, -169, 'a', 1.1, 7], ['beacon_r', -501, 134, 'a', 1.1, 7]],
  salvage_hauler: [['bow', 792, -15, 'w'], ['stern', -795, -15, 'w'], ['port', 166, -247, 'r'], ['stbd', 166, 218, 'g'], ['beacon_l', -503, -199, 'a', 1.1, 7], ['beacon_r', -503, 169, 'a', 1.1, 7]],
  construction_tug: [['bow', 713, -18, 'w'], ['stern', -710, -18, 'w'], ['port', 151, -221, 'r'], ['stbd', 151, 185, 'g'], ['beacon_l', -450, -173, 'a', 1.1, 7], ['beacon_r', -450, 138, 'a', 1.1, 7]],
  repair_drone: [['bow', 356, -36, 'w'], ['stern', -274, -36, 'w'], ['port', 84, -236, 'r'], ['stbd', 84, 157, 'g'], ['beacon_l', -227, -157, 'a', 1.1, 7], ['beacon_r', -227, 85, 'a', 1.1, 7]],
  distress_beacon_ship: [['bow', 368, -96, 'w'], ['stern', -555, -96, 'w'], ['port', 121, -153, 'r'], ['stbd', 121, 163, 'g'], ['beacon_l', -349, -128, 'a', 1.1, 7], ['beacon_r', -349, 156, 'a', 1.1, 7]],
  rescue_ship: [['bow', 758, -1, 'w'], ['stern', -643, -1, 'w'], ['port', 159, -237, 'r'], ['stbd', 159, 232, 'g'], ['beacon_l', -480, -217, 'a', 1.1, 7], ['beacon_r', -480, 213, 'a', 1.1, 7]]
});

const _blocks = new Map();

/**
 * Blok lamp wpisu edytora kadłuba cywilnego `{ position, road, flood, autoFlood: false }` (markery jak z edytora:
 * id, x, y, color, power, radius, sequenceGroup) albo null — kadłub bez tabeli. Jeden zamrożony obiekt na kadłub.
 */
export function trafficCivilLights(hullId) {
  if (_blocks.has(hullId)) return _blocks.get(hullId);
  const points = TRAFFIC_HULL_LIGHT_POINTS[hullId];
  const block = points ? Object.freeze({
    position: Object.freeze(points.map(([key, x, y, c, power = 0.8, radius = 6]) => Object.freeze({
      id: `civ_${key}`, x, y, color: COLOR[c], power, radius, sequenceGroup: 'edge'
    }))),
    road: Object.freeze([]),
    flood: Object.freeze([]),
    autoFlood: false
  }) : null;
  _blocks.set(hullId, block);
  return block;
}
