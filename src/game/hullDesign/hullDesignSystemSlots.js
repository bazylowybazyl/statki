// src/game/hullDesign/hullDesignSystemSlots.js
//
// KREATOR KADŁUBÓW — SLOTY SYSTEMÓW presetów (czyste dane; dokłada je hullDesignPreset() w hullDesignPresets.js).
// Rdzeń, mostek, silniki, zbiorniki paliwa, dysze SIDE i ładownie mają STAŁE miejsca dla klasy i kadłuba (decyzja
// użytkownika 2026-10-20); wolne są tylko w projekcie od zera. Preset dostaje tu zbiorniki, dysze SIDE i ładownie,
// a rdzeń i mostek — tylko tam, gdzie tabele gry mówią co innego niż preset. Wszystkie moduły systemów presetu
// (HD_SYSTEM_TYPES) dostają `lock` — edytor ich nie przesuwa ani nie usuwa.
//
// ŹRÓDŁA (flota TN): markery gry w px PNG sprite'a ((0, 0) = środek płótna, +x dziób, y w dół) przeliczone na układ
// projektu tak jak obrys TN (scripts/kreator-obrys-tn.mjs): x = (px + W/2 − środek pudła alfy) · s, y = (py + H/2 − oś
// symetrii) · s, s = długość profilu · HULL_RENDER_WORLD_SCALE / dłuższy bok płótna:
//   custos     PNG 2400 × 1792, s 0,0800, przesunięcie (−35,5, −6,0)
//   hasta      PNG  768 ×  573, s 0,3750, (12,5, 0,5)
//   bellator   PNG 1158 ×  714, s 0,5389, (0,5, 1,0)
//   citadella  PNG 1672 ×  941, s 0,6459, (1,5, 12,0)
//   colossus   PNG 1672 ×  941, s 0,9330, (−0,5, 2,0)
// — dysze SIDE: SHIP_EDITOR_DEFAULTS (`engines.side`, src/data/hardpointEditorDefaults.js; burta y < 0, lustro dopisuje
//   drugą) dosunięte do krawędzi kadłuba projektu (zewnętrzny koniec gniazda 1 jd za krawędzią, gniazdo na prostej
//   krawędzi, ≥ 3 jd od modułów presetu — inaczej najbliższe x w ±60 jd),
// — rdzeń Bellatora: REACTOR_CORE_MARKERS (src/data/reactorCores.js), zbiornik Bellatora: FUEL_TANK_MARKERS
//   (src/data/fuelTanks.js), mostek Colossusa: strefa BRIDGE_LAYOUT_PROPOSALS (src/game/shipBridge.js),
// — ładownie: CARGO_BAY_HULLS (src/data/cargoBays.js) przesunięte / zmniejszone tak, by nie nakrywały modułów presetu.
// Gdzie gra liczy automatem (`autoFuelTankMarker`), miejsce wybrane ręcznie: zbiornik w rufowej
// części, głęboko w kadłubie, poza komorą reaktora (szczegóły przy kadłubach). Wymiary dysz SIDE: 14 × 10 jd
// (pół-wymiary), zbiorników ~26–42 × 10–22 jd.
// RDZEŃ floty TN: jedno źródło miejsc z grą — rdzeń presetu (x, y = 0) w wariancie z obudową (v 2: gniazdo, w którym
// gra rysuje obudowę 3D reaktora) = REACTOR_CORE_MARKERS (src/data/reactorCores.js) przeliczone ramą HD_TN_SPRITE_FRAMES
// (x, y, hr = r / s); pilnuje tests/reactorCoreMarkers.test.mjs.
//
// GNIAZDA BRONI (etap 2, `mounts`): pełne zestawy gniazd gry — SHIP_EDITOR_DEFAULTS.ships (frigate, destroyer,
// battleship, terran_carrier, terran_supercapital; gniazda NPC i gracza bierze gra z tych wpisów, npcHardpointRuntime.js)
// przeliczone tym samym przekształceniem co sloty wyżej. Liczy je narzędzie scripts/kreator-gniazda-tn.mjs (wynik
// wklejony niżej — dane, nie rachunek przy wczytaniu):
//   • duplikaty edytora (dwa markery jednego typu ≤ 3 px od siebie — podwójne kliknięcie) → jedno gniazdo,
//   • pary burt (ten sam typ, |Δx|, |Δ|y|| małe) → para w lustrze w średnim położeniu (sprite'y z AI są niesymetryczne,
//     projekt jest), gniazdo przy osi → na osi,
//   • gniazdo kolidujące z modułem presetu albo za płytko w kadłubie → dosunięte do najbliższego wolnego miejsca
//     (przesunięcie w tabeli narzędzia i w docs/KREATOR-KADLUBA.md),
//   • rozmiar = rozmiar broni kadłuba w grze (WEAPON_TIER_BY_HULL), broń = DOMYŚLNE UZBROJENIE NPC (equipNpcWeapons
//     w index.html: najwyżej spec ramy na typ, wybór po kącie; broń za duża na gniazdo → ta sama rodzina w rozmiarze
//     gniazda — NPC Custos nosi railgun_mk2 M w gniazdach S), gniazdo bez broni NPC → puste (weapon '').
// Gniazda hangarowe gry to wrota hangarów presetu (moduł `hangar`) — nie dokłada się ich. Preset z `mounts` traci WSZYSTKIE
// swoje wieże (turret_*) i ośmiokątne ramy (`well` v 2) w miejscu gniazda: kapsuły i ramy sprite'ów to te same gniazda.
//
// KLASA presetu (etap 2, src/data/shipClasses.js): `bridgeLevel` / `coreLevel` — TN wg decyzji użytkownika (Custos I/R1,
// Hasta II/R2, Bellator IV/R4, Citadella V/R5, Colossus VI/R6, fregata z klocków I/R1), pozostałe — najniższa klasa,
// w której mieszczą się powierzchnia i gniazda (classForHull; test pilnuje, że każdy preset mieści się w swojej klasie).

import { HD_SYSTEM_TYPES } from './hullDesignSystems.js';
import { HD_MOUNT_RADIUS_DU, hullDesignMountOf } from './hullDesignSchema.js';
import { shipClass, sizeRank } from '../../data/shipClasses.js';

/**
 * Rama sprite'a floty TN w układzie projektu (tabela z nagłówka): profil renderu gry, wymiary PNG, s [j. / px PNG]
 * i przesunięcie [px PNG] — x = (px + dx) · s, y = (py + dy) · s.
 */
export const HD_TN_SPRITE_FRAMES = Object.freeze({
  custos: Object.freeze({ hull: 'terran_frigate', png: [2400, 1792], s: 0.08, dx: -35.5, dy: -6.0 }),
  hasta: Object.freeze({ hull: 'terran_destroyer', png: [768, 573], s: 0.375, dx: 12.5, dy: 0.5 }),
  bellator: Object.freeze({ hull: 'terran_battleship', png: [1158, 714], s: 0.5389, dx: 0.5, dy: 1.0 }),
  citadella: Object.freeze({ hull: 'terran_carrier', png: [1672, 941], s: 0.6459, dx: 1.5, dy: 12.0 }),
  colossus: Object.freeze({ hull: 'terran_supercapital', png: [1672, 941], s: 0.9330, dx: -0.5, dy: 2.0 })
});
// rdzeń w gnieździe obudowy (miejsce i promień z presetu)
const HOUSED = Object.freeze({ v: 2 });

const SIDE_PORT = -Math.PI / 2;     // dysza SIDE burty y < 0: wydech w −y (lustro: +y)
const tank = (x, y, w, h, o = {}) => ({ type: 'fuel_tank', x, y, w, h, rot: 0, v: 0, ...o });
// zbiornik obrócony króćcem (lokalne −x, kanał serwisowy) do rdzenia: π — rdzeń ku dziobowi, −π/2 — ku osi (burta y < 0)
// π/2 — zbiornik na osi w poprzek okrętu, króćcem ku burcie y < 0 (sieć liczy się na tej burcie)
const TO_BOW = Math.PI, TO_AXIS = -Math.PI / 2, TO_PORT = Math.PI / 2;
const side = (x, y, w, h) => ({ type: 'thruster_side', x, y, w, h, rot: SIDE_PORT });
const cargo = (x, y, w, h, o = {}) => ({ type: 'cargo', x, y, w, h, rot: 0, v: 0, ...o });

/**
 * Sloty na preset: `reactor` / `bridge` — pola nadpisujące moduł presetu (miejsce z tabel gry), `add` — moduły
 * systemów dokładane do presetu.
 */
export const HD_SYSTEM_SLOTS = Object.freeze({
  // Custos: zbiornik (automat gry) na osi między mostkiem a gondolami; ładownia (gra: grzbiet 3,7 ± 27 j. — nakryłaby
  // gniazdo i kratkę) na płycie przed gniazdem dziobowym
  custos: {
    reactor: HOUSED,
    add: [tank(-61, 0, 3.2, 1.3, { rot: TO_BOW }), side(29.8, -22.1, 1.3, 0.9), cargo(22, 0, 11, 6)]
  },
  // Hasta: zbiornik (automat gry) w maszynowni za mostkiem; ładownia (gra: grzbiet 3,2 ± 27 j. — kratka i gniazdo)
  // między gniazdem dziobowym a klinami dziobu
  hasta: {
    reactor: HOUSED,
    add: [tank(-98.5, 0, 5, 2.2, { rot: TO_BOW }), side(-77.4, -66.6, 2, 1.4), side(55.1, -33.4, 2, 1.4), cargo(31, 0, 10, 6.5)]
  },
  // Bellator: rdzeń z REACTOR_CORE_MARKERS (−17, r 26; preset −80), zbiornik z FUEL_TANK_MARKERS (−161, r 23 —
  // walec w poprzek między mostkiem a gniazdem rufowym, króćcem ku burcie: ku dziobowi kanał wchodziłby w gniazdo);
  // SIDE — tabela gry pusta (gra: automat z obrysu): para przy rufie i przy dziobie; ładownia — przednia część rynny
  // grzbietowej (gra: 75,7 ± 151 j. — nakryłaby gniazdo 40)
  bellator: {
    reactor: { x: -17, y: 0, r: 26, v: 2 },
    add: [tank(-162, 0, 14, 8, { rot: TO_PORT }), side(-221.3, -157, 5.1, 3.7), side(184.1, -130.7, 5.1, 3.7), cargo(95, 0, 42, 14)]
  },
  // Citadella: para zbiorników w maszynowni obok komory reaktora; ładowni nie ma osobno — pokłady ładowni gry
  // (lewy / prawy, x 25 ± 191 j.) to rząd wrót hangarów presetu. Mostek presetu (−300) stoi tuż przed strefą gry
  // (−387…−325: środek kasztelu z kratą i kapsułami wież) — zostaje (przesunięcie nakryłoby kratę i kapsuły)
  citadella: {
    reactor: HOUSED,
    add: [tank(-228, -75, 18, 8, { rot: TO_AXIS }), side(-167.5, -193.5, 8.8, 6.3), side(191.1, -191, 8.8, 6.3)]
  },
  // Colossus: mostek w strefie gry (centralna nadbudówka −238…85 j.; −160 — przed napisem TERRA NOVA; preset −560),
  // para zbiorników w maszynowni przy nadbudówce; SIDE z tabeli gry (bez dziobowej na skosie i 278 — gniazda wież);
  // ładownia rufowa (gra: −493 ± 235 j.) między kratami osi kasztelu
  colossus: {
    reactor: HOUSED,
    bridge: { x: -160, y: 0, w: 30, h: 22 },
    add: [
      tank(-160, -128, 22, 9),
      side(416.4, -164, 12.7, 9.1), side(1.6, -292.7, 12.7, 9.1), side(-334.7, -260, 12.7, 9.1), side(-557.5, -290.8, 12.7, 9.1),
      cargo(-441, 0, 40, 20)
    ]
  },
  // fregata z klocków (preset `klocki`, gałąź klocków — blocksFrigate: rdzeń −22, mostek −40, gondola −69 / −12): jak
  // Custos — zbiornik na osi rufowej nadbudówki króćcem ku dziobowi, para SIDE na prostej krawędzi klina dziobu
  klocki: {
    add: [tank(-58, 0, 3.2, 2, { rot: TO_BOW }), side(30, -22.1, 2, 2)]
  },
  // pozostałe presety: zbiornik paliwa (komplet systemów — walidacja), bez tabel gry
  orbis: { add: [tank(-300, -30, 26, 11)] },
  atlas2: { add: [tank(-780, -90, 40, 16)] },
  destroyer: { add: [tank(-125, -35, 20, 9)] },
  pirate: { add: [tank(-200, -90, 26, 10)] },
  tnparts: { add: [tank(-120, 0, 18, 7)] },
  tnparts2: { add: [tank(-200, -40, 20, 8)] }
});

// ── GNIAZDA BRONI floty TN (wynik scripts/kreator-gniazda-tn.mjs — nie edytować ręcznie, przeliczyć narzędziem) ──
// g(typ, x, y, broń burty y ≤ 0, broń burty y > 0): y < 0 — para w lustrze, y = 0 — gniazdo na osi; broń '' — puste;
// g1 — gniazdo bez pary na swojej burcie (gra ma po burtach nierówną liczbę gniazd tego typu)
const g = (slot, x, y, w, w2) => (w2 === undefined || w2 === w ? { slot, x, y, w } : { slot, x, y, w, w2 });
const g1 = (slot, x, y, w) => ({ slot, x, y, w, one: true });
/** Gniazda presetów: { size — rozmiar gniazd (broń kadłuba w grze), list, drop — pierścienie / ramy presetu pod gniazdami }. */
export const HD_PRESET_MOUNTS = Object.freeze({
  // @gniazda-start
  // custos: 5 markerów edytora (1 duplikatów, 4 gniazd), w tym 0 hangarów = wrota presetu
  custos: Object.freeze({ size: 'S', drop: Object.freeze([[-33.5, -16]]), list: Object.freeze([
    g('main', -33.5, -16, 'tempest_ion_s'), g('aux', 50.1, -13.5, 'laser_pd_mk1')
  ])}),
  // hasta: 8 markerów edytora (8 gniazd), w tym 0 hangarów = wrota presetu
  hasta: Object.freeze({ size: 'M', drop: Object.freeze([[-40, -25.2]]), list: Object.freeze([
    g('main', 74.8, -16, 'railgun_mk2'), g('main', -40, -25.2, 'railgun_mk2'), g('aux', 103.2, -11.7, 'laser_pd_mk1'), g('aux', -76.4, -50.8, 'laser_pd_mk1')
  ])}),
  // bellator: 31 markerów edytora (31 gniazd), w tym 0 hangarów = wrota presetu
  bellator: Object.freeze({ size: 'L', drop: Object.freeze([[-100.5, -64]]), list: Object.freeze([
    g('main', 257.2, -59.1, 'railgun_mk2'), g('main', 234.6, -68.8, 'railgun_mk2'), g('main', 207.3, -80.5, 'railgun_mk2'), g('main', 193.7, -38.8, '', 'railgun_mk2'),
    g('main', 12.1, -127.2, 'railgun_mk2'), g1('main', -34.1, -137.8, 'railgun_mk2'), g('main', -68.9, -127.7, 'railgun_mk2'), g('aux', 288.4, -41.5, 'laser_pd_mk1', ''),
    g('aux', 217.8, -34.3, ''), g('aux', 129, -135.4, 'laser_pd_mk1', ''), g1('aux', 121.2, 44.2, 'laser_pd_mk1'), g('aux', 13.9, -171.4, '', 'laser_pd_mk1'),
    g('aux', -104.4, -164.3, 'laser_pd_mk1', ''), g('aux', -173, -113.8, '', 'laser_pd_mk1'), g('aux', -271.9, 0, ''), g('missile', 32.8, -55.1, 'grad_launcher'),
    g('missile', -100.5, -64, 'missile_rack')
  ])}),
  // citadella: 40 markerów edytora (5 duplikatów, 35 gniazd), w tym 10 hangarów = wrota presetu
  citadella: Object.freeze({ size: 'L', drop: Object.freeze([[-132, 0], [121, 0], [237, 0]]), list: Object.freeze([
    g('main', 365.4, -81.6, 'railgun_mk2'), g('main', 231.1, -150.2, 'railgun_mk2'), g('main', -6.6, -167.8, 'railgun_mk2'), g('main', -310.3, -63, 'railgun_mk2'),
    g('special', 112.6, 0, ''), g('special', -136.7, 0, ''), g('aux', 439.2, -44.9, '', 'laser_pd_mk1'), g('aux', 425, -66.7, 'laser_pd_mk1'),
    g('aux', 395.1, -58.2, 'laser_pd_mk1', ''), g('aux', 293.6, -116.3, ''), g('aux', 237, 0, ''), g('aux', -203.2, -171.1, 'laser_pd_mk1'),
    g('aux', -372.6, -141.2, ''), g('aux', -410.4, -24.2, 'laser_pd_mk1')
  ])}),
  // colossus: 56 markerów edytora (56 gniazd), w tym 0 hangarów = wrota presetu
  colossus: Object.freeze({ size: 'Capital', drop: Object.freeze([[702, 0], [-14, -176], [227, 0], [-216.6, -86], [231.7, -71], [-468, -105.4], [-375, -178.5], [451, -147]]), list: Object.freeze([
    g('main', 615.4, -64.3, 'railgun_mk2'), g('main', 558.7, -52.7, 'railgun_mk2'), g('main', 546, -108, 'railgun_mk2'), g('main', 465.5, -60, 'railgun_mk2'),
    g('main', 395, -89.4, 'railgun_mk2'), g('main', 375.6, -166, 'railgun_mk2'), g('main', 124, -239.5, 'railgun_mk2'), g('special', 227, 0, ''),
    g('special', 110, -110, ''), g('special', -14, -176, ''), g('special', -35.8, -255.6, ''), g('special', -195, -249, ''),
    g('builtin', 702, 0, 'death_ray'), g('aux', 742.7, -40.5, ''), g('aux', 691.7, -67.3, 'laser_pd_mk1'), g('aux', 659.4, -69.5, ''),
    g('aux', 641.9, -92.8, 'laser_pd_mk1'), g('aux', 451, -147, ''), g('aux', 321.1, -168.5, 'laser_pd_mk1', ''), g('aux', 185.2, -229.9, '', 'laser_pd_mk1'),
    g('aux', 40.8, -248.4, ''), g('aux', -61, -291.2, 'laser_pd_mk1'), g('aux', -258.9, -289.8, ''), g('aux', -395.2, -274.6, 'laser_pd_mk1'),
    g('aux', -511.9, -279.9, ''), g('missile', 231.7, -71, 'missile_rack'), g('missile', -216.6, -86, 'grad_launcher'), g('missile', -375, -178.5, 'missile_rack'),
    g('missile', -468, -105.4, 'missile_rack')
  ])})
  // @gniazda-end
});

/**
 * Klasa presetu: [poziom mostka, poziom rdzenia]. TN i fregata z klocków — decyzja użytkownika; reszta — najniższa klasa
 * z powierzchni i gniazd (classForHull, 2026-10-21: Hasta-D 63 tys. j² → III, fregata / krążownik z części 149 / 124 tys.
 * → IV, Orbis 231 tys. i Szakal 256 tys. → V). `empty` — gracz wybiera (0 — z powierzchni).
 */
export const HD_PRESET_CLASS = Object.freeze({
  custos: [1, 1], hasta: [2, 2], bellator: [4, 4], citadella: [5, 5], colossus: [6, 6], klocki: [1, 1],
  destroyer: [3, 3], tnparts: [4, 4], tnparts2: [4, 4], orbis: [5, 5], pirate: [5, 5], atlas2: [6, 6]
});
/** Presety poza drabiną klas (jak Atlas — unikat fabularny): Atlas II ma 1,05 mln j², więcej niż limit klasy VI. */
export const HD_PRESET_OUTSIDE_LADDER = Object.freeze(['atlas2']);

/**
 * Gniazda presetu `key` jako moduły `mount` (r z HD_MOUNT_RADIUS_DU × detal `D`): para — dwa moduły w lustrze (każdy
 * `mirror: false`, własna broń burty; sieć systemów widzi je jako bliźniaki), na osi — jeden.
 */
export function presetMountModules(key, D) {
  const out = [];
  for (const g of HD_PRESET_MOUNTS[key]?.list || []) {
    const r = Math.round(HD_MOUNT_RADIUS_DU[g.slot] * D * 100) / 100;
    const base = { type: 'mount', slot: g.slot, size: HD_PRESET_MOUNTS[key].size, r, rot: 0, mirror: false };
    out.push({ ...base, x: g.x, y: g.y, weapon: g.w });
    if (g.y < 0 && !g.one) out.push({ ...base, x: g.x, y: -g.y, weapon: g.w2 ?? g.w });
  }
  return out;
}

const MOUNT_REPLACE = (m) => m.type.startsWith('turret_');
/** Pierścień / rama presetu (`well`) w miejscu gniazda — z listy `drop` (x, |y|). */
const dropped = (key, m) => m.type === 'well' && (HD_PRESET_MOUNTS[key]?.drop || []).some(([x, y]) => Math.abs(x - m.x) < 0.5 && Math.abs(Math.abs(y) - Math.abs(m.y)) < 0.5);

/**
 * Sloty systemów presetu `key` w surowym projekcie (przed normalizacją): rdzeń / mostek przeniesione w miejsce z tabel
 * gry, moduły systemów dołożone, wszystkie moduły systemów zablokowane (`lock`), gniazda broni z gry (`mounts` —
 * wieże presetu i ramy w miejscu gniazd znikają), klasa (`bridgeLevel` / `coreLevel`). Projekt od zera (`empty`) —
 * bez zmian. `opts.mounts === false` — bez gniazd (narzędzie scripts/kreator-gniazda-tn.mjs liczy je na tym projekcie).
 */
export function applySystemSlots(key, design, opts = {}) {
  if (key === 'empty' || !design) return design;
  const slot = HD_SYSTEM_SLOTS[key] || {};
  let modules = (design.modules || []).map((m) => ({ ...m }));
  for (const type of ['reactor', 'bridge']) {
    if (!slot[type]) continue;
    const m = modules.find((q) => q.type === type);
    if (m) Object.assign(m, slot[type]);
    else modules.push({ type, ...slot[type] });
  }
  for (const m of slot.add || []) modules.push({ ...m });
  for (const m of modules) if (HD_SYSTEM_TYPES.includes(m.type)) m.lock = true;
  if (HD_PRESET_MOUNTS[key] && opts.mounts !== false) {
    modules = modules.filter((m) => !MOUNT_REPLACE(m) && !dropped(key, m));
    modules.push(...presetMountModules(key, design.detail));
  }
  const cls = HD_PRESET_CLASS[key];
  if (!cls) return { ...design, modules };
  // gniazda presetu nie większe niż broń klasy (fregata z klocków: wieża M w klasie I → gniazdo S)
  const maxSize = shipClass(cls[0]).weaponSize;
  for (const m of modules) {
    const gm = hullDesignMountOf(m);
    if (gm && sizeRank(gm.size) > sizeRank(maxSize)) m.size = maxSize;
  }
  return { ...design, modules, bridgeLevel: cls[0], coreLevel: cls[1] };
}
