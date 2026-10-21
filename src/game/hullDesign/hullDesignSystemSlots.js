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
// Gdzie gra liczy automatem (`autoFuelTankMarker`, `autoReactorMarker`), miejsce wybrane ręcznie: zbiornik w rufowej
// części, głęboko w kadłubie, poza komorą reaktora (szczegóły przy kadłubach). Wymiary dysz SIDE: 14 × 10 jd
// (pół-wymiary), zbiorników ~26–42 × 10–22 jd.

import { HD_SYSTEM_TYPES } from './hullDesignSystems.js';

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
    add: [tank(-61, 0, 3.2, 1.3, { rot: TO_BOW }), side(29.8, -22.1, 1.3, 0.9), cargo(22, 0, 11, 6)]
  },
  // Hasta: zbiornik (automat gry) w maszynowni za mostkiem; ładownia (gra: grzbiet 3,2 ± 27 j. — kratka i gniazdo)
  // między gniazdem dziobowym a klinami dziobu
  hasta: {
    add: [tank(-98.5, 0, 5, 2.2, { rot: TO_BOW }), side(-77.4, -66.6, 2, 1.4), side(55.1, -33.4, 2, 1.4), cargo(31, 0, 10, 6.5)]
  },
  // Bellator: rdzeń z REACTOR_CORE_MARKERS (−17, r 26; preset −80), zbiornik z FUEL_TANK_MARKERS (−161, r 23 —
  // walec w poprzek między mostkiem a gniazdem rufowym, króćcem ku burcie: ku dziobowi kanał wchodziłby w gniazdo);
  // SIDE — tabela gry pusta (gra: automat z obrysu): para przy rufie i przy dziobie; ładownia — przednia część rynny
  // grzbietowej (gra: 75,7 ± 151 j. — nakryłaby gniazdo 40)
  bellator: {
    reactor: { x: -17, y: 0, r: 26 },
    add: [tank(-162, 0, 14, 8, { rot: TO_PORT }), side(-221.3, -157, 5.1, 3.7), side(184.1, -130.7, 5.1, 3.7), cargo(95, 0, 42, 14)]
  },
  // Citadella: para zbiorników w maszynowni obok komory reaktora; ładowni nie ma osobno — pokłady ładowni gry
  // (lewy / prawy, x 25 ± 191 j.) to rząd wrót hangarów presetu. Mostek presetu (−300) stoi tuż przed strefą gry
  // (−387…−325: środek kasztelu z kratą i kapsułami wież) — zostaje (przesunięcie nakryłoby kratę i kapsuły)
  citadella: {
    add: [tank(-228, -75, 18, 8, { rot: TO_AXIS }), side(-167.5, -193.5, 8.8, 6.3), side(191.1, -191, 8.8, 6.3)]
  },
  // Colossus: mostek w strefie gry (centralna nadbudówka −238…85 j.; −160 — przed napisem TERRA NOVA; preset −560),
  // para zbiorników w maszynowni przy nadbudówce; SIDE z tabeli gry (bez dziobowej na skosie i 278 — gniazda wież);
  // ładownia rufowa (gra: −493 ± 235 j.) między kratami osi kasztelu
  colossus: {
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

/**
 * Sloty systemów presetu `key` w surowym projekcie (przed normalizacją): rdzeń / mostek przeniesione w miejsce z tabel
 * gry, moduły systemów dołożone, wszystkie moduły systemów zablokowane (`lock`). Projekt od zera (`empty`) — bez zmian.
 */
export function applySystemSlots(key, design) {
  if (key === 'empty' || !design) return design;
  const slot = HD_SYSTEM_SLOTS[key] || {};
  const modules = (design.modules || []).map((m) => ({ ...m }));
  for (const type of ['reactor', 'bridge']) {
    if (!slot[type]) continue;
    const m = modules.find((q) => q.type === type);
    if (m) Object.assign(m, slot[type]);
    else modules.push({ type, ...slot[type] });
  }
  for (const m of slot.add || []) modules.push({ ...m });
  for (const m of modules) if (HD_SYSTEM_TYPES.includes(m.type)) m.lock = true;
  return { ...design, modules };
}
