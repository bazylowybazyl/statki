// src/game/hullDesign/warships/dreadnought.js — preset kreatora kadłubów (zestaw klocków: ../freighters/freighterKit.js).
//
// DREDNOT TERRA NOVY (klasa VII, tylko NPC — docs/BRIEF-drednot.md), 8 000 × 3 816 j. Sylwetka ze wzoru użytkownika
// (2026-11-12: grot z „zębami” — długie ostrze, skrzydła z kolanem, dwa zęby wygięte ku rufie, kolec rufy, silniki
// w wycięciach między nimi, długi rów maszynowni wzdłuż osi) w skali 8 km (decyzja użytkownika 2026-11-13; kanon
// wzoru — 17 km — to 45% promienia Ziemi gry i 8× limit klasy VII). Styl TN: białe płyty nad ciemną maszynownią.
//
// Od dziobu: szpic z wyrzutniami torped i emiterem superlasera na osi, ostrze (burta 1 : 4) z pasem burtowym płyt
// (6 ciężkich baterii na burtę) i pasem wewnętrznym schodkowym nad rowem (6 średnich), w rowie grzbiet z rakietami,
// generator tarczy dziobu i projektor studni, dalej pokład-klin (drugi projektor, oba rdzenie R7), za nim grzbiet
// rufowy z mostkiem głównym (poziom VI) i kolec rufy. Skrzydła: zasobnik z bateriami jonowymi i mostkiem pomocniczym
// (V), nasada z generatorem tarczy burty i promieniem ściągającym; tył: wrota hangarów w burtach, zbiorniki przy
// wycięciach, 4 gondole MAIN w każdym wycięciu, zęby z bateriami w rufę.
// Korytarze sieci: rów osi (od grzbietu dziobu do kolca rufy), rowy poprzeczne ostrza, rów nasady skrzydła, rowy tyłu.
// DETAL 1,5 j./jd: obraz kompozytora 8 192 px (1,02 teksela/j.) daje ~1,5 teksela/jd jak Colossus; długość / 1700
// (4,7) to „powiększony Colossus” (płyty, nity, rury 3×).

import { blk, frameBlk, engine, fuelTank, side, vent, grate, port, hatch, castle, TO_BOW } from '../freighters/freighterKit.js';
import { HD_MOUNT_RADIUS_DU } from '../hullDesignSchema.js';

const D = 1.5;
const R90 = Math.PI / 2;
const SEAM = 4;
const TN_TEXT = '#3b3a37';
const TN_EMBLEM = '#34332f';
const g4 = (v) => Math.round(v / 4) * 4;

/**
 * Trapez obrócony o ±90° z pudła: x0..x1 wzdłuż osi, yo (zewnętrzna) … yi (wewnętrzna) — krawędź PODSTAWY klocka
 * (rot +90° — podstawa od rufy, a / b przesuwają róg zewnętrzny / wewnętrzny od strony dziobu; rot −90° — podstawa od
 * dziobu, a / b — róg wewnętrzny / zewnętrzny od strony rufy).
 */
const trapX = (x0, x1, yo, yi, rot, a, b, level = 1, o = {}) => ({
  kind: 'block', shape: 'trap', x: (x0 + x1) / 2, y: (yo + yi) / 2, w: yi - yo, h: x1 - x0, rot, a, b, level, gap: SEAM, ...o
});
/** Płyta między dwiema krawędziami (funkcje y(x)), podstawa od rufy (rot +90°): zewnętrzna `out`, wewnętrzna `inn`. */
const plateAft = (x0, x1, out, inn, level = 1, o = {}) => {
  const yo = g4(out(x0)), yi = g4(inn(x0));
  return trapX(x0, x1, yo, yi, R90, g4(out(x1)) - yo, yi - g4(inn(x1)), level, o);
};
/** … podstawa od dziobu (rot −90°): zwęża się ku rufie (zęby, kolec rufy). */
const plateFwd = (x0, x1, out, inn, level = 1, o = {}) => {
  const yo = g4(out(x1)), yi = g4(inn(x1));
  return trapX(x0, x1, yo, yi, -R90, yi - g4(inn(x0)), g4(out(x0)) - yo, level, o);
};

// ── KRAWĘDZIE (burta y < 0) ─────────────────────────────────────────────────────────────────────────────────────
/** Burta ostrza 1 : 4: szpic x 4 000, nasada skrzydła (−656, −1 164); x ≡ 4 000 (mod 16) → na siatce 4 j. */
const E = (x) => -(4000 - x) / 4;
/** Burta za skrzydłem (−1 796, −1 436) → (−2 432, −1 596) i zewnętrzna krawędź zęba → szpic (−3 384, −1 876). */
const aftEdge = (x) => (x >= -2432 ? -1436 - (-1796 - x) * 160 / 636 : -1596 - (-2432 - x) * 280 / 952);
/** Wewnętrzna krawędź zęba (wycięcie): (−2 432, −484) → (−2 536, −840) → (−3 276, −1 476) → szpic. */
const prongIn = (x) => (x >= -2536 ? -484 - (-2432 - x) * 356 / 104 : -840 - (-2536 - x) * 636 / 740);
/** Kolec rufy: ±484 przy wycięciu → ±396 (−2 536) → ±188 (−3 796) → szpic −4 000. */
const tailEdge = (x) => (x >= -2536 ? -484 + (-2432 - x) * 88 / 104 : -396 + (-2536 - x) * 208 / 1260);

// ── GNIAZDA ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Promień podstawy gniazda (HD_MOUNT_RADIUS_DU × detal; ≤ 40 j. — głębokość pola ramy mierzy się do 48 j.). */
const RAD = (slot) => Math.min(40, Math.round(HD_MOUNT_RADIUS_DU[slot] * D * 100) / 100);
const mount = (slot, size, x, y, weapon) => ({
  type: 'mount', slot, size, r: RAD(slot), rot: 0, mirror: false, x, y, ...(weapon === undefined ? {} : { weapon })
});
const pair = (slot, size, x, y, weapon) => [mount(slot, size, x, y, weapon), mount(slot, size, x, -y, weapon)];
const hangarPair = (x, y, w, h) => [-1, 1].map((s) => ({ type: 'hangar', x, y: y * s, w, h, doors: 2, rot: 0, mirror: false }));
/**
 * Dysza SIDE burty y < 0 na prostej krawędzi o nachyleniu `k` (dy / dx) w punkcie (x, y): wydech wzdłuż normalnej
 * zewnętrznej, wylot 1 jd za burtą (14 × 10 jd).
 */
function sideOn(x, y, k) {
  const n = Math.hypot(k, 1), nx = k / n, ny = -1 / n;
  const w = 14 * D, h = 10 * D, inset = w - D;
  return side(Math.round((x - nx * inset) * 100) / 100, Math.round((y - ny * inset) * 100) / 100, w, h, Math.atan2(ny, nx));
}
const text = (x, y, w, h, rot = 0) => ({ kind: 'text', text: 'TERRA NOVA', x, y, w, h, rot, color: TN_TEXT, opacity: 0.88, weight: 500 });
const eagle = (x, y, w, h) => ({ kind: 'emblem', id: 'eagle', x, y, w, h, rot: 0, color: TN_EMBLEM, opacity: 0.9 });

function make() {
  const shapes = [];
  const modules = [];
  const castles = [];
  const decals = [];

  // ── RAMA (poziom 0) ─────────────────────────────────────────────────────────────────────────────────────────
  shapes.push(
    { kind: 'block', shape: 'tri', x: 1672, y: 0, w: 2328, h: 4656, rot: R90, a: 1164, level: 0 },          // ostrze
    frameBlk(-2432, -1164, -656, 1164),                                                                      // śródokręcie i tył
    blk('trap', -1796, -1436, -656, -1164, 0, { a: 0, b: 172 }),                                              // nasada skrzydła
    blk('trap', -1796, -1636, -828, -1436, 0, { a: 132, b: 128 }),                                           // skrzydło
    blk('tri', -1664, -1908, -956, -1636, 0, { a: 180 }),                                                    // koniec skrzydła
    trapX(-2432, -1796, -1596, -1164, R90, 160, 0, 0),                                                       // tył za skrzydłem
    trapX(-2536, -2432, -1596, -484, -R90, 356, -32, 0),                                                     // ząb: nasada
    trapX(-3276, -2536, -1628, -840, -R90, 636, -216, 0),                                                    // ząb
    trapX(-3384, -3276, -1844, -1476, -R90, 400, -32, 0),                                                    // ząb: szpic
    trapX(-2536, -2432, -484, 484, -R90, 88, 88, 0),                                                         // kolec rufy
    trapX(-3796, -2536, -396, 396, -R90, 208, 208, 0),
    { kind: 'block', shape: 'tri', x: -3898, y: 0, w: 376, h: 204, rot: -R90, a: 188, level: 0 }
  );

  // ── SZPIC I DZIÓB (płyty od burty do burty) ─────────────────────────────────────────────────────────────────
  shapes.push(
    { kind: 'block', shape: 'tri', x: 3696, y: 0, w: 304, h: 608, rot: R90, a: 152, level: 1, gap: SEAM },
    trapX(2944, 3360, -264, 264, R90, 104, 104),
    trapX(2496, 2912, -376, 376, R90, 104, 104),
    trapX(2560, 2848, -176, 176, R90, 72, 72, 2)                                                             // nadbudówka emitera
  );

  // ── OSTRZE: pas burtowy (0…288 od burty, równoległoboki 1 : 4) i pas wewnętrzny schodkowy nad rowem ──────────
  const bandO = (x0, x1) => trapX(x0, x1, E(x0), E(x0) + 288, R90, (x1 - x0) / 4, -(x1 - x0) / 4);
  const bandI = (x0, x1, yIn, level = 1) => trapX(x0, x1, E(x0) + 320, yIn, R90, (x1 - x0) / 4, 0, level);
  shapes.push(
    bandO(2048, 2464), bandO(1600, 2016), bandO(1152, 1568), bandO(704, 1120), bandO(256, 672), bandO(-192, 224), bandO(-656, -224),
    bandI(1824, 2240, -100), bandI(1376, 1792, -140, 2), bandI(928, 1344, -180), bandI(480, 896, -320, 2), bandI(32, 448, -380),
    bandI(-416, 0, -480, 2), bandI(-656, -448, -540)
  );

  // ── RÓW OSI: grzbiet dziobu, pokład-klin (rdzenie, projektor), grzbiet rufowy (mostek główny) ─────────────────
  shapes.push(
    blk('rect', 1856, -56, 2400, 56),
    blk('rect', 1264, -64, 1824, 64), blk('rect', 1336, -36, 1752, 36, 2, { c: [8, 8, 8, 8] }),
    blk('rect', 720, -96, 1232, 96), blk('rect', 784, -56, 1168, 56, 2, { c: [12, 12, 12, 12] }),
    blk('rect', 256, -128, 688, 128),
    trapX(-1480, -48, -560, 560, R90, 440, 440),                                                             // pokład-klin
    trapX(-1400, -248, -420, 420, R90, 316, 316, 2),                                                          // nadbudówka pokładu
    trapX(-2660, -1512, -220, 220, -R90, 140, 140),                                                           // grzbiet rufowy
    blk('rect', -2100, -112, -1700, 112, 2, { c: [16, 0, 0, 16] }),                                          // wieża mostka głównego
    plateFwd(-3764, -2692, tailEdge, (x) => -tailEdge(x), 1, {}),                                             // kolec rufy
    { kind: 'block', shape: 'tri', x: -3890, y: 0, w: 344, h: 188, rot: -R90, a: 172, level: 1, gap: SEAM }
  );

  // ── SKRZYDŁA: nasada (W1), zasobnik (W2 + W3) z nadbudówką ──────────────────────────────────────────────────
  shapes.push(
    blk('trap', -1764, -1404, -688, -1196, 1, { a: 0, b: 132 }),
    blk('trap', -1780, -1636, -844, -1436, 1, { a: 116, b: 112 }),
    blk('tri', -1664, -1908, -956, -1636, 1, { a: 180 }),
    blk('rect', -1660, -1612, -1000, -1468, 2, { c: [24, 24, 24, 24] })
  );

  // ── TYŁ: płyty między rowem osi a burtą, pas za skrzydłem, zęby ─────────────────────────────────────────────
  shapes.push(
    blk('rect', -1232, -1132, -688, -680),
    blk('rect', -1764, -1132, -1264, -604),
    blk('rect', -2400, -1132, -1796, -436),
    // pas za skrzydłem i ząb — z poprzecznym rowem przy dyszy SIDE (rura paliwa dochodzi rowem, widać ją)
    plateAft(-2404, -2132, aftEdge, () => -1196), plateAft(-2068, -1828, aftEdge, () => -1196),
    plateFwd(-2536, -2464, (x) => aftEdge(x) + 8, (x) => prongIn(x) - 8),
    plateFwd(-3244, -2996, (x) => aftEdge(x) + 8, (x) => prongIn(x) - 8), plateFwd(-2932, -2568, (x) => aftEdge(x) + 8, (x) => prongIn(x) - 8),
    plateFwd(-3196, -3028, (x) => aftEdge(x) + 92, (x) => prongIn(x) - 92, 2), plateFwd(-2900, -2640, (x) => aftEdge(x) + 92, (x) => prongIn(x) - 92, 2),
    plateFwd(-3360, -3276, (x) => aftEdge(x) + 8, (x) => prongIn(x) - 8)
  );

  // ── KASZTEL za wieżą mostka głównego ───────────────────────────────────────────────────────────────────────
  castles.push(
    castle(-2290, 0, 120, 90, { taper: 0.35, vent: 'slats' })
  );

  // ── SYSTEMY (stałe miejsca; preset dostaje `lock` w applySystemSlots) ───────────────────────────────────────
  for (const y of [-452, -560, -668, -776]) modules.push(engine(-2470, y, 80, 46));                       // 8 MAIN w wycięciach
  modules.push(
    { type: 'reactor', x: -1250, y: -300, r: 64, v: 2 },                                                     // 2 rdzenie R7
    { type: 'bridge', x: -1900, y: 0, v: 2, lv: 6 },                                                         // mostek główny
    { type: 'bridge', x: -1330, y: -1540, v: 2, lv: 5 },                                                     // 2 pomocnicze (skrzydła)
    fuelTank(-2250, -700, 64, 28, TO_BOW), fuelTank(-2250, -960, 64, 28, TO_BOW),                            // 4 zbiorniki
    { type: 'shield_gen', x: 2150, y: 0, r: 50 }, { type: 'shield_gen', x: -3300, y: 0, r: 50 },              // generatory tarczy
    { type: 'shield_gen', x: -1180, y: -1300, r: 50 },
    { type: 'grav_proj', x: 472, y: 0, r: 80 }, { type: 'grav_proj', x: -760, y: 0, r: 80 },                  // projektory studni
    // 12 dysz SIDE: burta ostrza ×3, krawędź natarcia skrzydła, burta za skrzydłem, ząb
    sideOn(3000, E(3000), 0.25), sideOn(2032, E(2032), 0.25), sideOn(1136, E(1136), 0.25),
    sideOn(-1220, -1636 - (1220 - 956) * 272 / 528, 272 / 528),
    sideOn(-2100, aftEdge(-2100), 160 / 636), sideOn(-2960, aftEdge(-2960), 280 / 952)
  );

  // ── GNIAZDA (brief § 4.2: 67, ciężkich 47) ─────────────────────────────────────────────────────────────────
  modules.push(
    mount('builtin', 'Capital', 2704, 0),                                                                     // emiter superlasera
    ...[2256, 1808, 1360, 912, 464, 16].flatMap((x) => pair('special', 'Capital', x, E(x) + 144, 'special_yamato_cannon')),
    ...pair('main', 'L', 1584, -212, 'helios_lance_l'), ...pair('main', 'L', 1136, -288, 'helios_lance_l'),          // rząd wewnętrzny
    ...pair('main', 'L', 688, -416, 'helios_lance_l'), ...pair('main', 'L', 240, -500, 'helios_lance_l'),
    ...pair('main', 'L', -208, -604, 'heavy_autocannon_l'), ...pair('main', 'L', -552, -680, 'heavy_autocannon_l'),
    ...pair('main', 'L', -2750, -1360, 'heavy_autocannon_l'), ...pair('main', 'L', -3100, -1560, 'heavy_autocannon_l'),
    ...[-1600, -1080].flatMap((x) => pair('special', 'L', x, -1540)), ...pair('special', 'L', -1460, -1780),   // baterie jonowe
    ...pair('special', 'L', -1560, -1300), ...pair('special', 'L', -1950, -1340),                             // promienie ściągające
    ...pair('aux', 'L', 3100, -150, 'ciws_mk2'), ...pair('aux', 'L', 2620, -280, 'ciws_mk2'),
    ...pair('aux', 'L', -1452, -1860, 'flak_l'), ...pair('aux', 'L', -820, -1250, 'flak_l'), ...pair('aux', 'L', -2000, -1420, 'flak_l'),
    ...pair('aux', 'L', -3250, -1650, 'ciws_mk2'), ...pair('aux', 'L', -3500, -160, 'ciws_mk2'),
    ...pair('missile', 'L', 3300, -96, 'siege_torpedo'), ...pair('missile', 'L', 3550, -56, 'siege_torpedo'),
    ...pair('missile', 'L', 1700, -40, 'missile_rack'),
    ...hangarPair(-960, -906, 90, 56), ...hangarPair(-1514, -906, 90, 56), ...hangarPair(-1960, -906, 90, 56), ...hangarPair(-2290, -1380, 90, 56)
  );

  // ── DETALE: radiatory i kraty w rowach, iluminatory grzbietu, napisy, orły ──────────────────────────────────
  modules.push(
    grate(2160, -240, 48, 30), vent(1590, -380, 70, 16), vent(690, -600, 70, 16), vent(-200, -840, 70, 16),
    vent(-1100, -740, 60, 16), port(820, 0, 30, 2), port(-2500, 0, 30, 2), hatch(3200, 0, 30, 18)
  );
  decals.push(
    text(1040, 0, 250, 32), text(-860, 0, 320, 42), text(-1370, -1300, 150, 20),
    eagle(-1080, 0, 110, 92), eagle(2200, 0, 70, 58), eagle(-3000, 0, 90, 75)
  );

  return {
    v: 2, name: 'Drednot Terra Novy (klasa VII)', role: 'military', npc: true, style: 'chamfer', mirror: true, palette: 'terra',
    seed: 83, detail: D, grid: 4, windows: 0, bevel: 1.9, round: 1, panels: 1, pipeNet: { density: 1, seed: 0 },
    blocks: [], shapes, modules, decals, castles, parts: []
  };
}

export default { key: 'dreadnought', label: 'TN · drednot (klasa VII, NPC)', cls: [7, 7], make };
