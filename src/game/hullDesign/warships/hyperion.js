// src/game/hullDesign/warships/hyperion.js — preset kreatora kadłubów (zestaw klocków: ../freighters/freighterKit.js).
//
// SUPERKAPITAŁ HYPERION — LINIA ATLASA (klasa VI, wojskowy, Terra Nova), smukły, ok. 5 : 1 (2428 × 488 j.), paleta
// „Atlas — czerń”. Układ sekcji ze szkicu Atlasa użytkownika (scripts/blender/atlas/szkic-uzytkownika-v2.jpg), nie jego
// proporcje: szkic to „bardziej battleship — za krótki na superkapitała” (użytkownik, 2026-10-27), więc dodatkowa
// długość idzie w dłuższą szyję i dłuższą sekcję dziobową z widłami (więcej par wież), a okrągłe rzeczy zostają okrągłe.
// Od rufy: 5 gondol MAIN za rufą (środkowa większa), wąska rufa silnikowa z maszynownią, szeroki blok rufowy
// z nadbudówką (mostek VI na osi między kasztelami, 4 gniazda specjalne 2 × 2), 6 głównych na płytach-szewronach
// pokładu, rdzeń we wnęce tuż przed nadbudówką, szyja z wcięciami w burtach (wrota hangarów i pola siłowe — drony
// i myśliwce wylatują bokiem), sekcja dziobowa z „bagażnikiem” (luk na fregatę zwiadu ≥ 346 × 275 j.) między
// szewronami z wieżami, sponsony wyrzutni, rozwidlony dziób z zaokrąglonymi końcami.
// Korytarze sieci (rowy nad klockami ramy): maszynownia rufy → rów wokół nadbudówki → wnęka rdzenia → rowy szyi wzdłuż
// grzbietu → rów wokół luku → rowy wideł przy szczelinie.
// Sprawdzenie (z podkładem szkicu rozciągniętym do proporcji okrętu — IoU ~0,83):
//   node scripts/kreator-sprawdz-preset.mjs --plik src/game/hullDesign/warships/hyperion.js --png .tmp/kreator/plan
//        --maska scripts/blender/atlas/szkic-maska.png --skala 1.580,0.790 --x0 946.5 --y0 493

import {
  blk, blkAt, frameBlk, cutBlk, engine, reactor, bridge, fuelTank, side, hold, vent, grate, port, hatch, castle, TO_BOW
} from '../freighters/freighterKit.js';
import { HD_MOUNT_RADIUS_DU } from '../hullDesignSchema.js';

const D = 1.35;                      // detal [j./jd] (długość / 1800 — wieże przy luku mieszczą się w smukłej sekcji dziobowej)
const INK = '#b3b8bd';               // napisy i orły — jasna szarość na grafitowych płytach (paleta „Atlas — czerń”)
const FIELD = '#9ad8ee';             // pola siłowe hangarów (czerwony ≥ 0,25 liniowo — nie świeci w masce gry)

/** Gniazdo broni (rozmiar Capital, promień z HD_MOUNT_RADIUS_DU × detal); para — obie burty jawnie. */
const mount = (slot, x, y, weapon) => ({
  type: 'mount', slot, size: 'Capital', r: Math.round(HD_MOUNT_RADIUS_DU[slot] * D * 100) / 100, rot: 0, mirror: false, x, y, weapon
});
const pair = (slot, x, y, weapon) => [mount(slot, x, y, weapon), mount(slot, x, -y, weapon)];
/** Dysza SIDE burty y < 0 na prostej krawędzi `edge` (14 × 10 jd, zewnętrzny koniec 1 jd za krawędzią). */
const sideAt = (x, edge) => side(x, Math.round((edge - D + 14 * D) * 100) / 100, 14 * D, 10 * D);

/** Brzeg zewnętrzny widły (burta y < 0) — liniowo od nasady do początku zaokrąglenia. */
const PRONG = { x0: 560, y0: -226, x1: 1160, y1: -118 };
const prongEdge = (x) => PRONG.y0 + (x - PRONG.x0) * (PRONG.y1 - PRONG.y0) / (PRONG.x1 - PRONG.x0);
const in2 = (y) => Math.ceil(y / 2) * 2;             // na siatce 2 j., w głąb kadłuba (ku osi)
/** Płyta widły [xa, xb] od rowu przy szczelinie (yIn) do brzegu — trapez obrócony o 90° (skos brzegu wzdłuż zwężenia). */
function prongPlate(xa, xb, yIn, level = 1, o = {}) {
  const ya = in2(prongEdge(xa)), yb = in2(prongEdge(xb));
  return blkAt('trap', (xa + xb) / 2, (ya + yIn) / 2, yIn - ya, xb - xa, 2, level, { a: yb - ya, ...o });
}
const TN = (text, x, y, w, h, rot = 0) => ({ kind: 'text', text, x, y, w, h, rot, color: INK, opacity: 0.85, weight: 500 });
const eagle = (x, y, w, h) => ({ kind: 'emblem', id: 'eagle', x, y, w, h, rot: 0, color: INK, opacity: 0.9 });

function make() {
  const shapes = [];
  const modules = [];
  const decals = [];
  const castles = [];

  // ── RAMA (poziom 0): sylwetka i maszynownia pod rowami ──────────────────────────────────────────────────────
  shapes.push(
    frameBlk(-1128, -168, -976, 168),                                   // rufa silnikowa (maszynownia, mocowania gondol)
    frameBlk(-976, -242, -484, 242, { c: [74, 114, 114, 74] }),         // blok rufowy: skosy 45° do rufy i do szyi
    frameBlk(-484, -128, -84, 128),                                     // szyja
    frameBlk(-84, -226, 442, 226, { c: [98, 0, 0, 98] }),               // sekcja dziobowa (skos 45° od szyi)
    frameBlk(442, -226, 560, -10),                                      // nasada widły
    { kind: 'block', shape: 'trap', x: 860, y: -118, w: 216, h: 600, rot: Math.PI / 2, level: 0, a: 108, b: 0 }  // widła: zwężenie
  );
  // wcięcia szyi (wnęki wrót hangarowych z polem siłowym)
  shapes.push(cutBlk('rect', -432, -128, -348, -112, 0), cutBlk('rect', -272, -128, -188, -112, 0));

  // ── RUFA SILNIKOWA ──────────────────────────────────────────────────────────────────────────────────────────
  shapes.push(blk('rect', -1084, -168, -990, -112, 1, { c: [12, 0, 0, 0] }));       // róg rufy (dysza SIDE, obrona punktowa)

  // ── BLOK RUFOWY: pokład z płyt-szewronów (rowy ukośne od burty ku dziobowi), nadbudówka, wnęka rdzenia ─────────────
  shapes.push(
    blk('trap', -984, -242, -806, -160, 1, { a: 82, b: 82 }),         // szewron rufowy (skos rufy, wieża)
    blk('trap', -790, -242, -640, -160, 1, { a: -82, b: 82 }),        // szewron (wieża)
    blk('trap', -624, -242, -516, -160, 1, { a: -82, b: 82 }),        // szewron dziobowy = skos ku szyi (wieża)
    blk('rect', -944, -142, -640, 142, 2, { c: [0, 44, 44, 0] }),     // NADBUDÓWKA (mostek, gniazda specjalne)
    blkAt('tri', -955, -129, 26, 26, 4, 2),                           // róg rufowy nadbudówki
    blk('rect', -612, -44, -524, 44, 1, { c: [26, 26, 26, 26] }),     // platforma rdzenia (ośmiokąt)
    blk('rect', -626, -142, -530, -62, 1, { c: [0, 0, 16, 0] })       // bark przy rdzeniu
  );

  // ── SZYJA ───────────────────────────────────────────────────────────────────────────────────────────────────
  shapes.push(
    blk('rect', -506, -34, -366, 34), blk('rect', -366, -34, -226, 34), blk('rect', -226, -34, 32, 34),   // grzbiet
    blk('rect', -500, -128, -440, -50),                               // burta szyi (obrona punktowa)
    blk('rect', -440, -128, -340, -50),                               // burta: wrota hangaru we wcięciu
    blk('rect', -340, -128, -280, -50),
    blk('rect', -280, -128, -180, -50),                               // burta: wrota hangaru we wcięciu
    blk('rect', -180, -128, -84, -50)
  );

  // ── SEKCJA DZIOBOWA: bark od szyi, szewrony z wieżami wokół luku ─────────────────────────────────────────────
  shapes.push(
    blk('trap', -84, -226, 44, -128, 1, { a: 98 }),                   // bark dziobu: skos od szyi
    blk('rect', -84, -130, 44, -54),
    blk('trap', 58, -226, 190, -156, 1, { b: 70 }),                   // szewrony przy luku (wieże)
    blk('trap', 206, -226, 336, -156, 1, { a: -70, b: 70 }),
    blk('trap', 352, -226, 426, -156, 1, { a: -70 })
  );

  // ── WIDŁY DZIOBU ────────────────────────────────────────────────────────────────────────────────────────────
  shapes.push(
    blk('rect', 446, -226, 554, -44),                                 // nasada widły: sponson wyrzutni, dysza SIDE
    blk('rect', 452, -242, 512, -198, 2, { c: [8, 8, 0, 0] }),        // sponson wyrzutni
    blk('rect', 446, -28, 700, -10), blk('rect', 700, -28, 950, -10), blk('rect', 950, -28, 1160, -10),  // listwa przy szczelinie
    prongPlate(566, 700, -44), prongPlate(700, 840, -44), prongPlate(840, 990, -44), prongPlate(990, 1160, -44),
    blkAt('arc', 1187, -64, 108, 54, 2, 1, { arc: 180 })              // zaokrąglony koniec widły
  );

  // ── KASZTELE na nadbudówce: przed i za mostkiem (mostek z kasztelami czyta się jak długi grzbiet Atlasa) ────
  castles.push(
    castle(-910, 0, 24, 38, { level: 3, tiers: 1, clip: 2, taper: 0.5 }),
    castle(-672, 0, 26, 30, { level: 3, tiers: 1, clip: 2, taper: 0.5 })
  );

  // ── SYSTEMY ─────────────────────────────────────────────────────────────────────────────────────────────────
  modules.push(
    engine(-1158, 0, 52, 30), engine(-1162, -66, 48, 24), engine(-1162, -128, 48, 24),
    reactor(-568, 36),
    bridge(-792),
    fuelTank(-1036, -84, 34, 15, TO_BOW),
    sideAt(-1060, -168), sideAt(536, -226),
    hold(242, 0, 176, 138, 0),
    // wrota hangarowe w szyi (gniazda hangarowe; drugą burtę dopisuje lustro projektu)
    { type: 'hangar', x: -390, y: -80, w: 46, h: 24, doors: 2 }, { type: 'hangar', x: -230, y: -80, w: 46, h: 24, doors: 2 }
  );

  // ── GNIAZDA BRONI ───────────────────────────────────────────────────────────────────────────────────────────
  const MAIN = 'railgun_mk2', PD = 'laser_pd_mk1';
  modules.push(
    // główne: pokład bloku rufowego (3 / burta), szewrony przy luku (3), widły (4)
    ...pair('main', -896, -196, MAIN), ...pair('main', -756, -200, MAIN), ...pair('main', -610, -200, MAIN),
    ...pair('main', 100, -191, MAIN), ...pair('main', 236, -191, MAIN), ...pair('main', 376, -191, MAIN),
    ...pair('main', 634, -172, MAIN), ...pair('main', 770, -148, MAIN), ...pair('main', 915, -122, MAIN), ...pair('main', 1075, -94, MAIN),
    // specjalne 2 × 2 wokół mostka
    ...pair('special', -852, -96, ''), ...pair('special', -732, -96, ''),
    // wyrzutnie rakiet na sponsonach
    ...pair('missile', 482, -219, 'missile_rack'),
    // obrona punktowa (na przemian uzbrojona i pusta)
    ...pair('aux', -1012, -140, PD), ...pair('aux', -914, -110, ''), ...pair('aux', -578, -112, PD),
    ...pair('aux', -470, -92, ''), ...pair('aux', -310, -92, PD), ...pair('aux', -4, -150, ''),
    ...pair('aux', 640, -96, PD), ...pair('aux', 870, -68, ''), ...pair('aux', 1186, -64, PD)
  );

  // ── DETALE: kratki, radiatory, klapy, iluminatory ────────────────────────────────────────────────────────────
  modules.push(
    vent(-910, 0, 7, 22), vent(-672, 0, 9, 16),                       // kasztele
    vent(-436, 0, 22, 9), grate(-296, 22, 30, 5), vent(-120, 0, 26, 9), // grzbiet szyi
    vent(-14, -96, 8, 18), hatch(-50, -76, 10, 5),                    // bark dziobu
    grate(-470, -64, 12, 4), grate(-310, -64, 12, 4), hatch(-132, -96, 12, 6),
    vent(482, -96, 10, 22), hatch(520, -60, 8, 4),                    // nasada widły
    grate(770, -64, 16, 5), grate(1010, -56, 12, 5),
    port(-694, -126, 7), port(-822, -128, 7)
  );

  // ── NAPISY, ORŁY, POLA SIŁOWE ───────────────────────────────────────────────────────────────────────────────
  decals.push(
    TN('TERRA NOVA', -296, 0, 96, 13), TN('HYPERION', 825, -19, 96, 10),
    eagle(-20, -190, 34, 28), eagle(-1046, 0, 30, 26),
    { kind: 'stripe', x0: -430, y0: -110, x1: -350, y1: -110, w: 3, color: FIELD, opacity: 0.9 },
    { kind: 'stripe', x0: -270, y0: -110, x1: -190, y1: -110, w: 3, color: FIELD, opacity: 0.9 }
  );

  return {
    v: 2, name: 'Superkapitał Hyperion (linia Atlasa)', role: 'military', style: 'chamfer', mirror: true, palette: 'atlasDark',
    seed: 83, detail: D, grid: 2, windows: 0, bevel: 1.9, round: 1, panels: 1, pipeNet: { density: 1, seed: 0 },
    blocks: [], shapes, modules, decals, castles, parts: []
  };
}

export default { key: 'hyperion', label: 'TN · superkapitał Hyperion (linia Atlasa)', cls: [6, 6], make };
