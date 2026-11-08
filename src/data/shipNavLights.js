// src/data/shipNavLights.js
//
// ŚWIATŁA NAWIGACYJNE okrętów (decyzja użytkownika 2026-11-06: „blink blink czerwono-zielone tak jak mają samoloty,
// znacznie mniej: dwa z tyłu, dwa z przodu, dwa na najszerszym elemencie — i tak na każdy statek; jak mryga, oświetla
// zielono / czerwono, bez mrygania nie oświetla; różne opcje — żółte ostrzegawcze dla statków konstrukcyjnych”).
//
// KAŻDY kadłub ma sześć lamp (NAV_LIGHT_POINTS, policzone ze sprite'a: node scripts/lampy-nawigacyjne.mjs): lewa burta
// (−y obrazka) i prawa (+y) w trzech miejscach. Barwy i rytm daje STYL (NAV_LIGHT_STYLES), jeden wiersz na odmianę;
// kadłub spoza domyślnego stylu — wiersz w NAV_LIGHT_HULL_STYLE. Lampa niesie numer wzoru migania (`blink`) i przesunięcie
// w cyklu (`lag`); okręt dokłada swoją fazę z id (flota nie miga równo — navPhaseFromId).
//
// Moduł czysty (bez three i DOM): czytają go dane edytora, migracja zapisu, runtime lamp i węzeł TSL src/3d/tsl/navBlink.js.

/**
 * Wzory migania. Czasy w ułamkach cyklu `period` [s]: narastanie `attack`, pełny błysk `flash`, gaśnięcie `release`;
 * `second` — początek drugiego błysku (> 1 — jeden błysk). Indeks na liście = numer wzoru w danych lampy i w shaderze;
 * nowy wzór dopisuj na końcu (`attack`, `release` > 0).
 */
export const NAV_BLINK_PATTERNS = Object.freeze([
  // Samolotowe „blink blink”: dwa krótkie błyski, potem długa przerwa.
  Object.freeze({ name: 'double', period: 1.6, attack: 0.008, flash: 0.035, release: 0.03, second: 0.13 }),
  // Sygnalizator ostrzegawczy: jeden dłuższy, miękki puls.
  Object.freeze({ name: 'beacon', period: 1.25, attack: 0.06, flash: 0.12, release: 0.2, second: 2 })
]);

/**
 * Style lamp: barwa lewej i prawej burty, wzór migania, przesunięcie prawej burty w cyklu (0 — burty razem, 0,5 — na
 * przemian), moc lampy. Nowa odmiana = nowy wiersz; statek konstrukcyjny = `warning`.
 */
export const NAV_LIGHT_STYLES = Object.freeze({
  aviation: Object.freeze({ port: '#ff2b2b', starboard: '#2bff6a', pattern: 0, sideLag: 0, power: 1.5 }),
  warning: Object.freeze({ port: '#ffb01f', starboard: '#ffb01f', pattern: 1, sideLag: 0.5, power: 1.7 })
});

export const NAV_LIGHT_DEFAULT_STYLE = 'aviation';

/** Kadłuby poza stylem domyślnym. */
export const NAV_LIGHT_HULL_STYLE = Object.freeze({
  construction_tug: 'warning',
  service_tug: 'warning'
});

/** Wygląd wspólny: `idle` — lampa bez błysku (sam mały punkt, bez halo i bez oświetlania), `hullGain` — moc na własnej blasze. */
export const NAV_LIGHT_LOOK = Object.freeze({ idle: 0.16, hullGain: 1.35 });

/** Wersja układu lamp w zapisie edytora (hpEditor.v1): zapis bez niej ma dawne lampy obrysu — migrateSavedNavLights. */
export const NAV_LIGHT_LAYOUT = 1;

const LAMP_NAMES = ['bow_l', 'bow_r', 'wide_l', 'wide_r', 'stern_l', 'stern_r'];

/**
 * Klucz edytora → promień lampy `r` [px PNG] i sześć punktów `p` [px PNG od środka płótna, +x dziób, +y prawa burta]:
 * dziób lewa, dziób prawa, najszersze miejsce lewa, prawa, rufa lewa, prawa. Generowane — nie poprawiać ręcznie;
 * nowy kadłub albo nowy sprite: node scripts/lampy-nawigacyjne.mjs --zapisz (strażnik tests/shipNavLights.test.mjs).
 */
export const NAV_LIGHT_POINTS = Object.freeze({
  // <tabela>
  atlas: { r: 6.5, p: [[1659, -162], [1659, 157], [-579, -578], [-579, 574], [-1645, -281], [-1645, 276]] },
  terran_supercapital: { r: 3, p: [[767, -70], [767, 67], [-313, -318], [-313, 313], [-775, -211], [-775, 210]] },
  pirate_supercapital: { r: 3.5, p: [[761, -75], [761, 33], [10, -365], [10, 373], [-756, -208], [-756, 224]] },
  capital_carrier: { r: 3.5, p: [[609, -143], [609, 141], [210, -411], [210, 412], [-608, -231], [-608, 230]] },
  megafreighter_front: { r: 2.5, p: [[769, -68], [769, 59], [-411, -322], [-411, 307], [-736, -300], [-736, 284]] },
  inter_station_shuttle: { r: 12, p: [[433, -51], [433, 43], [-217, -210], [-217, 198], [-442, -148], [-442, 138]] },
  container_ship: { r: 8, p: [[794, -74], [794, 51], [-404, -244], [-404, 218], [-791, -177], [-791, 154]] },
  long_haul_freighter: { r: 5.5, p: [[776, -55], [776, 23], [-544, -230], [-544, 197], [-784, -168], [-784, 136]] },
  heavy_freighter: { r: 3, p: [[801, -61], [801, 28], [8, -253], [8, 269], [-794, -212], [-794, 179]] },
  megafreighter: { r: 3, p: [[809, -91], [809, 52], [-607, -285], [-607, 245], [-817, -211], [-817, 172]] },
  heavy_harvester: { r: 7, p: [[780, -59], [780, 13], [-422, -293], [-422, 246], [-802, -218], [-802, 171]] },
  belter: { r: 12, p: [[517, -183], [517, 138], [-292, -210], [-292, 171], [-586, -203], [-586, 160]] },
  surveyor: { r: 11.5, p: [[701, -44], [701, 27], [-432, -259], [-432, 243], [-715, -70], [-715, 57]] },
  refinery_tender: { r: 6, p: [[769, -44], [769, 9], [-508, -296], [-508, 260], [-745, -217], [-745, 182]] },
  tanker: { r: 5.5, p: [[781, -66], [781, 34], [-441, -233], [-441, 198], [-786, -175], [-786, 143]] },
  salvage_hauler: { r: 6.5, p: [[776, -60], [776, 33], [-174, -316], [-174, 288], [-787, -168], [-787, 137]] },
  construction_tug: { r: 10.5, p: [[698, -66], [698, 33], [0, -311], [0, 274], [-705, -162], [-705, 127]] },
  service_tug: { r: 2.5, p: [[801, -61], [801, 28], [8, -253], [8, 269], [-794, -212], [-794, 179]] },
  pirate_raider: { r: 8.5, p: [[745, -36], [745, 35], [-372, -195], [-372, 193], [-757, -146], [-757, 143]] },
  smuggler: { r: 10.5, p: [[691, -42], [691, 19], [-468, -214], [-468, 193], [-711, -142], [-711, 121]] },
  repair_drone: { r: 12, p: [[326, -52], [326, -22], [222, -315], [222, 232], [-359, -175], [-359, 102]] },
  distress_beacon_ship: { r: 9.5, p: [[550, -33], [550, 61], [5, -356], [5, 190], [-549, -108], [-549, 136]] },
  frigate: { r: 12, p: [[918, -98], [918, 99], [-574, -323], [-574, 454], [-856, -131], [-856, 128]] },
  destroyer: { r: 3.5, p: [[286, -33], [286, 34], [-184, -175], [-184, 175], [-320, -31], [-320, 31]] },
  battleship: { r: 3, p: [[537, -158], [537, 149], [0, -342], [0, 341], [-541, -132], [-541, 129]] },
  terran_carrier: { r: 3.5, p: [[768, -45], [768, 6], [-493, -328], [-493, 302], [-780, -163], [-780, 139]] },
  pirate_frigate: { r: 12, p: [[825, -40], [825, 94], [-452, -262], [-452, 296], [-824, -176], [-824, 218]] },
  pirate_destroyer: { r: 7.5, p: [[796, -71], [796, 86], [-460, -350], [-460, 330], [-821, -79], [-821, 74]] },
  pirate_battleship: { r: 4.5, p: [[764, -109], [764, 119], [-313, -415], [-313, 415], [-737, -268], [-737, 269]] },
  bounty_hunter: { r: 9, p: [[795, -30], [795, 21], [-516, -212], [-516, 202], [-799, -172], [-799, 163]] },
  police_cutter: { r: 12, p: [[732, -64], [732, 66], [-366, -307], [-366, 307], [-736, -230], [-736, 230]] },
  rescue_ship: { r: 9.5, p: [[742, -101], [742, 98], [-359, -289], [-359, 286], [-751, -230], [-751, 227]] }
  // </tabela>
});

// Reflektory otoczenia kadłubów, które miały je z dawnego obrysu lamp (rufa i burty — wybrane progami długości kadłuba
// w świecie). Obrys lamp zniknął razem z dawnymi lampami, więc miejsca są tu na stałe, reflektory świecą jak dotąd.
const flood = (id, x, y, deg, range) => Object.freeze({ id, x, y, deg, color: '#e8f0ff', power: 1.5, radius: 6, range, coneDeg: 110 });
export const SHIP_FLOOD_LIGHTS = Object.freeze({
  atlas: Object.freeze([
    flood('auto_flood_rear', -1578.17, 0, -90, 2037),
    flood('auto_flood_pair0_l', -627.74, -516.33, 0, 2037),
    flood('auto_flood_pair0_r', -627.74, 516.33, 180, 2037),
    flood('auto_flood_pair1_l', 662.14, -336.22, 0, 2037),
    flood('auto_flood_pair1_r', 662.14, 336.22, 180, 2037)
  ]),
  terran_carrier: Object.freeze([
    flood('auto_flood_rear', -645.21, 24.79, -90, 848),
    flood('auto_flood_pair0_l', -249.67, -213.21, 0, 848),
    flood('auto_flood_pair0_r', -249.67, 193.34, 180, 848),
    flood('auto_flood_pair1_l', 287.13, -252.06, 0, 848),
    flood('auto_flood_pair1_r', 287.13, 232.18, 180, 848)
  ]),
  terran_supercapital: Object.freeze([
    flood('auto_flood_rear', -654.62, -0.57, -90, 863),
    flood('auto_flood_pair0_l', -251.71, -268.94, 0, 863),
    flood('auto_flood_pair0_r', -251.71, 261, 180, 863),
    flood('auto_flood_pair1_l', 295.11, -203.44, 0, 863),
    flood('auto_flood_pair1_r', 295.11, 207.42, 180, 863)
  ]),
  destroyer: Object.freeze([flood('auto_flood_rear', -294.29, 0, -90, 337)])
});

const _markers = new Map();

/** Sześć lamp kadłuba w stylu (domyślnie: styl kadłuba) — markery jak z edytora, jeden zamrożony zestaw; brak w tabeli — []. */
export function shipNavLightMarkers(hullKey, styleName = NAV_LIGHT_HULL_STYLE[hullKey] || NAV_LIGHT_DEFAULT_STYLE) {
  const cacheKey = `${hullKey}|${styleName}`;
  let list = _markers.get(cacheKey);
  if (list) return list;
  const row = NAV_LIGHT_POINTS[hullKey];
  const style = NAV_LIGHT_STYLES[styleName] || NAV_LIGHT_STYLES[NAV_LIGHT_DEFAULT_STYLE];
  list = Object.freeze(row ? row.p.map(([x, y], i) => navMarker(`nav_${LAMP_NAMES[i]}`, x, y, row.r, style, i % 2 === 1)) : []);
  _markers.set(cacheKey, list);
  return list;
}

function navMarker(id, x, y, radius, style, starboard) {
  return Object.freeze({
    id, x, y, radius,
    color: starboard ? style.starboard : style.port,
    power: style.power,
    sequenceGroup: 'edge',
    blink: style.pattern,
    lag: starboard ? style.sideLag : 0
  });
}

/**
 * Blok lamp wpisu edytora: sześć lamp z tabeli, reflektory otoczenia z SHIP_FLOOD_LIGHTS (własne wpisu mają pierwszeństwo),
 * reflektory dalekie wpisu. Kadłub spoza tabeli — blok bez zmian.
 */
export function withShipNavLights(hullKey, lights = null) {
  if (!NAV_LIGHT_POINTS[hullKey]) return lights;
  const own = lights && Array.isArray(lights.flood) && lights.flood.length ? lights.flood : null;
  return {
    position: shipNavLightMarkers(hullKey),
    road: Array.isArray(lights?.road) ? lights.road : [],
    flood: own || SHIP_FLOOD_LIGHTS[hullKey] || [],
    navLayout: NAV_LIGHT_LAYOUT
  };
}

/**
 * Migracja zapisu edytora (hpEditor.v1, czysta i idempotentna): układ sprzed świateł nawigacyjnych miał w `position`
 * dawne lampy obrysu — zastępują je lampy z tabeli, reflektory (własne albo domyślne kadłuba) zostają. Układ zapisany
 * już w nowej wersji (`navLayout`) to decyzja użytkownika — bez zmian.
 */
export function migrateSavedNavLights(id, layout) {
  const lights = layout?.lights;
  if (!lights || typeof lights !== 'object' || lights.navLayout === NAV_LIGHT_LAYOUT) return layout;
  const key = id === 'player' ? 'atlas' : id;
  if (!NAV_LIGHT_POINTS[key]) return layout;
  return { ...layout, lights: withShipNavLights(key, lights) };
}

/**
 * Ten sam blok lamp w innym stylu (statek konstrukcyjny, podgląd z konsoli): barwy, moc i rytm wg burty lampy, pozycje
 * bez zmian. Nowy obiekt — pamięć normalizacji lamp idzie po źródle.
 */
export function restyleNavLights(lights, styleName) {
  const style = NAV_LIGHT_STYLES[styleName];
  if (!style || !lights || !Array.isArray(lights.position)) return lights;
  return {
    ...lights,
    position: lights.position.map((m) => {
      const id = String(m?.id ?? '');
      const starboard = id.endsWith('_r') || (!id.endsWith('_l') && Number(m?.y) > 0);
      return { ...m, color: starboard ? style.starboard : style.port, power: style.power, blink: style.pattern, lag: starboard ? style.sideLag : 0 };
    })
  };
}

/**
 * Faza okrętu w cyklu migania [0, 1) z id encji — flota nie miga równo, a obraz nie zależy od Math.random. Liczba bez
 * alokacji napisu (kurs statku ruchu liczony co klatkę).
 */
export function navPhaseFromId(id) {
  if (typeof id === 'number') {
    const f = id * 0.6180339887;
    return f - Math.floor(f);
  }
  if (id === undefined || id === null || id === '') return 0;
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1024) / 1024;
}

// Faza okrętu raz na encję. Tożsamość: id, uid, ród kadłuba (`beamHull.dmgKey` — większość NPC nie ma id; to samo pole ma
// lustro w workerze), nazwa (wspólna dla typu — na końcu). Bez żadnej — 0, bez pamięci (kadłub może dojść później).
// Widok z własnym polem `navPhase` (proxy statków ruchu: pula widoków, faza z kursu) ma pierwszeństwo.
const _navPhases = new WeakMap();
export function navPhaseOf(entity) {
  if (entity === null || typeof entity !== 'object') return 0;
  const own = entity.navPhase;
  if (typeof own === 'number') return own;
  let phase = _navPhases.get(entity);
  if (phase === undefined) {
    const key = entity.id ?? entity.uid ?? entity.beamHull?.dmgKey ?? entity.name;
    if (key === undefined || key === null) return 0;
    phase = navPhaseFromId(key);
    _navPhases.set(entity, phase);
  }
  return phase;
}

/**
 * Kod migania lampy = numer wzoru + faza w cyklu [0, 1) (jedna liczba: billboard, slot lampy w kadłubie, instancja modelu).
 * Ułamek ściśnięty, żeby przy float32 nie doszedł do następnego wzoru. Kod ujemny — światło stałe (np. błyski burzy).
 */
export function navBlinkCode(pattern, phase) {
  const f = phase - Math.floor(phase);
  return (pattern | 0) + f * 0.999;
}

function smooth01(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Jasność lampy o kodzie `code` w chwili `t` [s]: 0 między błyskami, 1 w błysku. To samo liczy węzeł navBlinkNode
 * (src/3d/tsl/navBlink.js) — lustro CPU dla świateł w siatce (skały, gaz) i testów.
 */
export function navBlinkValue(t, code) {
  if (code < 0) return 1;
  const id = Math.floor(code);
  const p = NAV_BLINK_PATTERNS[id] || NAV_BLINK_PATTERNS[NAV_BLINK_PATTERNS.length - 1];
  const x = t / p.period + (code - id);
  const u = x - Math.floor(x);
  const env = (s) => smooth01(s, s + p.attack, u) * (1 - smooth01(s + p.attack + p.flash, s + p.attack + p.flash + p.release, u));
  return Math.max(env(0), env(p.second));
}
