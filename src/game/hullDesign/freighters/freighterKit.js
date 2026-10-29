// src/game/hullDesign/freighters/freighterKit.js
//
// KREATOR KADŁUBÓW — ZESTAW DO PRESETÓW FRACHTOWCÓW (statki cywilne, `role: 'civil'`; czysty: bez three i DOM).
// Każdy frachtowiec to osobny plik w tym katalogu: `export default { key, label, cls: [mostek, rdzeń], make }`, rejestr
// w ./index.js (HD_PRESETS dokłada go sam, klasa idzie do applySystemSlots). Decyzje użytkownika (2026-10-27): rola cywilna na progach
// powierzchni I–VI (nazwy cywilne), RÓŻNE KSZTAŁTY (nie kopie sprite'ów ruchu — tych nie odwzorowujemy), paleta
// „Frachtowiec”, ładunek jako warianty ładowni (stelaż kontenerów, zasobniki) i zbiorniki ładunku (walce, kule).
//
// Zasady presetu (pilnują testy na wszystkich HD_PRESET_KEYS — sprawdzanie jednego: node scripts/kreator-sprawdz-preset.mjs
// <klucz> [--png katalog]): tylko narzędzia gracza (klocki na siatce `grid`, obrót co 45°, kasztele, moduły, naklejki —
// isPlayerBuildable), rama w jednej bryle bez szpar (hullFrameIntegrity), komplet systemów (reaktor, zbiornik paliwa,
// mostek, gondola MAIN z dyszą wystającą za rufę), sieć bez wolnych końców i wiązek poza obrysem (korytarz rowów nad
// klockami ramy łączy rdzeń, zbiornik, gondole, mostek i ładownie; dysze SIDE na prostym odcinku burty), klasa = najniższa
// z powierzchni (`cls[0]` = classForHull), najwyżej 160 modułów po lustrze (limit kompozytora), ≤ 240 brył.
//
// Układ jak w całym kreatorze: j. świata, x ku dziobowi, y w dół obrazu; połowa okrętu y ≤ 0 (lustro dopisuje drugą
// burtę), klocek / moduł na osi (y = 0) — symetryczny, bez kopii.

/** Szew płyt [jd] (styk klocków-płyt); rowy maszynowni to odstęp między płytami nad klockami ramy (poziom 0). */
export const FREIGHT_SEAM = 4;

/**
 * Frachtowiec bazowy: rola cywilna, paleta „Frachtowiec”, wygląd cywilny (okna nadbudówek, mniej paneli niż TN), sieć
 * systemów włączona. `o`: shapes, modules, castles, decals, grid, palette, style, windows, bevel, round, panels,
 * cargoLoad, pipes (gęstość sieci), pipeSeed, mirror.
 */
export function freighter(name, seed, detail, o = {}) {
  return {
    v: 2, name, role: 'civil', style: o.style || 'chamfer', mirror: o.mirror !== false, palette: o.palette || 'freight',
    seed, detail, grid: o.grid, windows: o.windows ?? 0.7, bevel: o.bevel ?? 1.5, round: o.round ?? 1, panels: o.panels ?? 0.7,
    cargoLoad: o.cargoLoad ?? 1, pipeNet: { density: o.pipes ?? 1, seed: o.pipeSeed ?? 0 },
    blocks: [], shapes: o.shapes || [], modules: o.modules || [], decals: o.decals || [], castles: o.castles || [], parts: []
  };
}

// ── KLOCKI (src/game/hullDesign/hullDesignBlocks.js: rect | trap | tri | arc; w, h — PEŁNE wymiary) ─────────────────
/** Klocek z pudła [x0, x1] × [y0, y1] (obrót 0); level 1 — płyta, 2 — nadbudówka, 3 — mostek. */
export const blk = (shape, x0, y0, x1, y1, level = 1, o = {}) => ({
  kind: 'block', shape, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0, level, gap: FREIGHT_SEAM, ...o
});
/** Klocek ramy (poziom 0 — maszynownia, rowy sieci) z pudła. */
export const frameBlk = (x0, y0, x1, y1, o = {}) => ({
  kind: 'block', shape: 'rect', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0, level: 0, ...o
});
/** Klocek ze środka, wymiarów (układ klocka) i obrotu w krokach 45°. */
export const blkAt = (shape, x, y, w, h, rot45 = 0, level = 1, o = {}) => ({
  kind: 'block', shape, x, y, w, h, rot: rot45 * Math.PI / 4, level, gap: FREIGHT_SEAM, ...o
});
/** Wycięcie (klocek op 'cut') z pudła — level L usuwa poziomy ≥ L (np. 1 — płyty, rama zostaje). */
export const cutBlk = (shape, x0, y0, x1, y1, level = 1, o = {}) => ({
  kind: 'block', shape, op: 'cut', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0, level, ...o
});

// ── SYSTEMY (stałe miejsca — preset dostaje `lock` sam: applySystemSlots) ─────────────────────────────────────────
/** Gondola MAIN: pół-wymiary, n dysz; rufowy koniec (x − w) musi wystawać za kadłub (inaczej „dysze zasłonięte”). */
export const engine = (x, y, w, h, n = 1, v = 0) => ({ type: 'engine', x, y, w, h, n, v });
/** Reaktor na osi: v 2 — gniazdo obudowy TN (model 3D gry), v 1 — wewnątrz kadłuba. Promień obudowy jak gra: R1 5, R2 8, R3 14, R6 30 j. */
export const reactor = (x, r, v = 2) => ({ type: 'reactor', x, y: 0, r, v });
/** Mostek na osi: v 2 — gniazdo poziomu klasy (obrys z src/data/bridgeLevels.js — I 28 × 16 … VI 150 × 76 j.). */
export const bridge = (x, v = 2) => ({ type: 'bridge', x, y: 0, v });
/** Zbiornik paliwa własnego (rury do reaktora); króciec i kanał serwisowy po lokalnym −x — rot obraca go ku rdzeniowi. */
export const fuelTank = (x, y, w, h, rot = 0, v = 0) => ({ type: 'fuel_tank', x, y, w, h, rot, v });
/** Kierunki króćca zbiornika: π — rdzeń ku dziobowi, −π/2 — ku osi (burta y < 0), π/2 — ku burcie y < 0. */
export const TO_BOW = Math.PI, TO_AXIS = -Math.PI / 2, TO_PORT = Math.PI / 2;
/** Dysza SIDE burty y < 0: wydech w −y (lustro: +y). */
export const SIDE_PORT = -Math.PI / 2;
export const side = (x, y, w, h, rot = SIDE_PORT) => ({ type: 'thruster_side', x, y, w, h, rot });

// ── ŁADUNEK (src/game/hullDesign/hullDesignCargo.js: kontener gry 16 × 8 j.) ──────────────────────────────────────
/** Stelaż kontenerów (otwarty pokład): pół-wymiary; mieści floor((2w − ramy + 1) / 17) × floor((2h − ramy + 1) / 9) kontenerów. */
export const rack = (x, y, w, h, o = {}) => ({ type: 'cargo', x, y, w, h, rot: 0, v: 2, ...o });
/** Zasobniki: pudła n × n kontenerów (n = 2 — 32,25 × 16,25 j., odstęp 1 j.). */
export const pods = (x, y, w, h, n = 2, o = {}) => ({ type: 'cargo', x, y, w, h, rot: 0, v: 3, n, ...o });
/** Ładownia zamknięta: v 0 — wrota rozsuwane, v 1 — klapa. */
export const hold = (x, y, w, h, v = 0, o = {}) => ({ type: 'cargo', x, y, w, h, rot: 0, v, ...o });
/** Zbiornik ładunku (tankowce): walce wzdłuż osi modułu w n rzędach. */
export const tanks = (x, y, w, h, n = 1, o = {}) => ({ type: 'cargo_tank', x, y, w, h, rot: 0, v: 0, n, ...o });
/** Zbiornik ładunku: kule w n rzędach (wzdłuż — ile się zmieści). */
export const spheres = (x, y, w, h, n = 1, o = {}) => ({ type: 'cargo_tank', x, y, w, h, rot: 0, v: 1, n, ...o });

// ── DETALE ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const vent = (x, y, w, h, rot = 0, v = 1) => ({ type: 'vent', x, y, w, h, rot, v });
export const grate = (x, y, w, h, rot = 0) => vent(x, y, w, h, rot, 2);
export const port = (x, y, r, v = 1) => ({ type: 'well', x, y, r, v });
export const hatch = (x, y, w, h, rot = 0, v = 1) => ({ type: 'hatch', x, y, w, h, rot, v });
/** Kasztel (nadbudówka schodkowa) na płytach. */
export const castle = (x, y, w, h, o = {}) => ({ x, y, w, h, tiers: 2, high: 'out', taper: 0.4, vent: 'none', port: false, hatches: 0, clip: 1, ...o });

// ── NAPISY I PASY ARMATORA (warstwa barw — bez przebudowy kadłuba) ─────────────────────────────────────────────────
export const FREIGHT_INK = '#d8902a';
export const label = (text, x, y, w, h, o = {}) => ({ kind: 'text', text, x, y, w, h, rot: 0, color: FREIGHT_INK, opacity: 0.9, weight: 600, ...o });
export const stripe = (x0, y0, x1, y1, w, o = {}) => ({ kind: 'stripe', x0, y0, x1, y1, w, color: FREIGHT_INK, opacity: 0.85, ...o });
