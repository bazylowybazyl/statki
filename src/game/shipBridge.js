// src/game/shipBridge.js
//
// MOSTEK — centrum dowodzenia okrętu. Zniszczenie mostka zabija statek, ale
// inaczej niż rdzeń reaktora: to „czysty kill”. Okręt traci dowodzenie, gaśnie,
// dryfuje i zostaje prawie całym wrakiem (więcej łupu przy holowaniu). Rdzeń
// (src/game/reactorCore.js) to „brudny kill” z wybuchem.
//
// Moduł jest czystą logiką: bez DOM i bez three. Tu leżą dane i część ogólna:
// strefy (BRIDGE_LAYOUT_PROPOSALS, normalizacja, walidacja, eksport), oś czasu
// utraty dowodzenia (BRIDGE_KILL_TIMELINE, sample*), dryf i wygląd hulka (dysze,
// światła pozycyjne) oraz API mostków encji (updateShipBridges, getBridgeAimPoint,
// bridgePngToWorld…). Stan `entity.bridgeState` buduje silnik belek
// (src/game/shipBridgeBeams.js: attachBeamBridges — komórki siatki belek, pancerz,
// integralność, wyrwa, okna) i niesie w nim backend `BEAM_BRIDGE_BACKEND`, któremu
// funkcje ogólne oddają pracę; stan bez backendu = brak mostków (wartość pusta).
// Dawna wersja na heksach destruktora usunięta 2026-10-19 razem z silnikiem heksów.
// Wygląd (okna, wyrzut atmosfery) robi src/3d/bridgeFx3D.js, model 3D — src/3d/bridge3D.js.
//
// PRZESTRZENIE WSPÓŁRZĘDNYCH
//   PNG     — edytor hardpointów: piksele sprite'a źródłowego, (0,0) = środek,
//             +X = dziób, +Y = w dół obrazka. W niej zapisujemy strefy mostków
//             (tak jak hardpointy, silniki i rdzenie w hardpointEditorDefaults).
//   siatka  — w API „siatka” = piksele obrazu kadłuba (render), od lewego górnego
//             rogu, y w dół (0..srcW, 0..srcH); PNG × skala render / PNG + środek obrazu.
//   świat   — świat gry (y w dół); przekształcenia przez siatkę belek rodu kadłuba
//             (kotwica: statek — środek sprite'a, wrak — środek masy), shipBridgeBeams.js.

// armorMul/killFrac z benchmarku dawnego dema heksowego (2026-09-24,
// docs/PORT-mostki.md): koszt zabicia mostka to głównie TUNEL do niego, nie
// pancerz strefy. Bellator + Iron Skull: 3/0,6 → mediana 2,6× pocisków puli HP
// (mostek pierwszy 4/72), 1,5/0,35 → 1,7× (17/72); z pulą ×0,5 → 0,85× (40/72).
// Niżej (0,25) pojedyncza torpeda/Yamato w strefie potrafi zdecydować.
export const BRIDGE_DEFAULTS = Object.freeze({
  armorMul: 1.5,        // mnożnik HP komórek mostka (pancerz nadbudówki)
  killFrac: 0.35,       // ułamek komórek strefy, którego utrata niszczy mostek
  probeEverySec: 0.08,  // kadencja jak sondy hardpointów i rdzeni
  rule: 'all'           // 'all' = dowodzenie pada po utracie WSZYSTKICH mostków
});

// Flagi bitowe zwracane przez updateShipBridges / evaluateShipBridges.
export const BRIDGE_EVENT = Object.freeze({
  NONE: 0,
  BRIDGE_LOST: 1,       // w tym sprawdzeniu padł co najmniej jeden mostek
  COMMAND_LOST: 2       // statek stracił dowodzenie (kill)
});

// Przebieg „czystej śmierci” w sekundach od utraty dowodzenia. Jedno źródło
// prawdy dla gry, dema i efektów: wszystko, co gaśnie, pyta o swój stan tutaj.
export const BRIDGE_KILL_TIMELINE = Object.freeze({
  weaponsOffAt: 0.0,        // broń milknie od razu (brak dowodzenia ogniem)
  windowFlickerEnd: 0.5,    // okna migają nierówno, zanim zacznie się fala
  windowWaveSpeed: 420,     // px PNG/s — fala gaśnięcia okien od wyrwy
  windowFade: 0.14,         // s — okno dogasa po przejściu fali
  ventRise: 0.06,           // s — narastanie wyrzutu atmosfery
  ventHalfLife: 0.5,        // s — ciśnienie spada wykładniczo
  ventEnd: 2.8,             // s — po tym czasie strumień wygasa całkiem
  navDelay: 0.8,            // s — światła pozycyjne gasną po oknach...
  navWaveSpeed: 1500,       // px PNG/s — ...falą od mostka w stronę burt i dziobu
  engineChokeStart: 0.25,   // s — dysze zaczynają się dławić
  engineChokeEnd: 2.4,      // s — ostatni kaszel, potem cisza
  engineCoolDown: 0.7,      // s — po ostatnim kaszlu gaśnie płomyk postojowy dyszy
  // s — koniec agonii: gra zamienia hulk we wrak (index.html finishBridgeKill).
  // Wszystko wyżej gaśnie do ~3,5 s; reszta to już tylko cichy dryf.
  sequenceEnd: 4.0
});

// Zapas strefy od hardpointów i silników [px renderu] wg klasy uzbrojenia
// kadłuba (WEAPON_TIER_BY_HULL w src/data/ships.js). Sonda hardpointu ma
// tylko 14 px PNG (HARDPOINT_INTEGRITY_CONFIG.probeRadius × skala), ale nad
// modelem mostka rysuje się wieżyczka 2D: korpus ~20 j. × skala rozmiaru
// działa × skala klasy (turret2D SCALE_BY_SIZE, WEAPON_TIER_SCALE) — S ~6,
// M ~10 px; L i Capital 14 px jak przy pierwszych strefach.
export const BRIDGE_TURRET_CLEARANCE_PX = Object.freeze({ S: 6, M: 10, L: 14, Capital: 14 });

/** Minimalny zapas strefy od hardpointu/silnika w px PNG (renderPerPng = render/PNG). */
export function bridgeZoneMargin(renderPerPng, tier = 'L') {
  const k = Number(renderPerPng) > 0 ? Number(renderPerPng) : 1;
  const px = BRIDGE_TURRET_CLEARANCE_PX[tier] ?? BRIDGE_TURRET_CLEARANCE_PX.L;
  return Math.max(14, px / k);
}

// PROPOZYCJE STREF (przestrzeń PNG). Do przeniesienia przy integracji do
// src/data/hardpointEditorDefaults.js jako `bridges: [...]` obok `cores`.
// Klucze = klucze edytora hardpointów (ten sam sprite); gracz i NPC trafiają
// tu przez normalizeBridgeHullKey / resolveBridgeHullKey (shipBridgeRuntime.js).
// Strefa leży na namalowanej nadbudówce (model 3D ją zastępuje), poza
// zapasem bridgeZoneMargin od hardpointów i silników (pilnuje tego
// tests/shipBridge.test.mjs). Nowy kadłub: docs/BRIEF-mostek-nowego-kadluba.md.
// FLOTA TERRA NOVY: mostek na POZIOM klasy (`level`, src/data/bridgeLevels.js — Custos I, Hasta II, Bellator IV,
// Citadella V, Colossus VI). Jedno źródło z kreatorem kadłubów: środek = moduł `bridge` presetu TN (x, y = 0)
// przeliczony ramą sprite'a HD_TN_SPRITE_FRAMES (px = x / s − dx, py = −dy), wymiary = obrys modelu poziomu / s
// — strefa zabicia to dokładnie obrys modelu 3D (tests/bridgeLevels.test.mjs). Przesuwasz mostek presetu TN albo
// zmieniasz obrys poziomu → ten sam ruch tutaj. Zmiany stref z 2026-10-21: docs/PORT-mostki.md § 10.
export const BRIDGE_LAYOUT_PROPOSALS = Object.freeze({
  battleship: Object.freeze({
    label: 'Bellator',
    windowColor: '#e4f3ff',
    variants: Object.freeze({
      standard: Object.freeze([
        // Mostek IV na rufowym bloku (kreator −217 j.: między gniazdem PD rufy a zbiornikiem paliwa).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -403.2, y: -1, w: 144.7, h: 74.2, rot: 0, level: 4 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  pirate_battleship: Object.freeze({
    label: 'Iron Skull',
    windowColor: '#ff9a4a',
    variants: Object.freeze({
      standard: Object.freeze([
        // Rufowa nadbudówka nowego sprite'a Iron Skull (1727 × 911 px).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -312.5, y: 0.5, w: 254, h: 150, rot: 0 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  atlas: Object.freeze({
    label: 'Atlas',
    windowColor: '#d6ecff',
    // Atlas nie ma czytelnej nadbudówki — trzy kandydatury na kręgosłupie
    // (między wieżami, poza hardpointami) i wariant z mostkiem zapasowym.
    variants: Object.freeze({
      rufowy: Object.freeze([
        Object.freeze({ id: 'mostek_rufowy', label: 'Mostek rufowy', role: 'primary', x: -735, y: -13, w: 520, h: 80, rot: 0 })
      ]),
      srodokrecie: Object.freeze([
        Object.freeze({ id: 'mostek_srodkowy', label: 'Mostek śródokręcia', role: 'primary', x: 80, y: -8, w: 520, h: 84, rot: 0 })
      ]),
      dziobowy: Object.freeze([
        Object.freeze({ id: 'mostek_dziobowy', label: 'Mostek dziobowy', role: 'primary', x: 632, y: -8, w: 244, h: 66, rot: 0 })
      ]),
      rufowy_z_zapasowym: Object.freeze([
        Object.freeze({ id: 'mostek_rufowy', label: 'Mostek rufowy', role: 'primary', x: -735, y: -13, w: 520, h: 80, rot: 0 }),
        Object.freeze({ id: 'mostek_zapasowy', label: 'Mostek zapasowy (dziób)', role: 'backup', x: 632, y: -8, w: 244, h: 66, rot: 0 })
      ])
    }),
    defaultVariant: 'rufowy_z_zapasowym'
  }),
  // --- Terra Nova ---
  frigate: Object.freeze({
    label: 'Custos',
    windowColor: '#e4f3ff',
    variants: Object.freeze({
      standard: Object.freeze([
        // Mostek I za zbiornikiem paliwa, przed komorą reaktora (kreator −42 j.; PNG 2400 × 1792, render 192 × 143).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -489.5, y: 6, w: 350, h: 200, rot: 0, level: 1 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  destroyer: Object.freeze({
    label: 'Hasta',
    windowColor: '#e4f3ff',
    variants: Object.freeze({
      standard: Object.freeze([
        // Mostek II w osi rufowej części, przed komorą reaktora (kreator −64 j.; 768 × 573).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -183.2, y: -0.5, w: 112, h: 58.7, rot: 0, level: 2 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  terran_carrier: Object.freeze({
    label: 'Citadella',
    windowColor: '#e4f3ff',
    variants: Object.freeze({
      standard: Object.freeze([
        // Mostek V na środku rufowego kasztelu (cytadela: kopuły i mechanizm sprite'a; kreator −339 j.; 1672 × 941).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -526.3, y: -12, w: 167.2, h: 83.6, rot: 0, level: 5 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  terran_supercapital: Object.freeze({
    label: 'Colossus',
    windowColor: '#e4f3ff',
    variants: Object.freeze({
      standard: Object.freeze([
        // Mostek VI na centralnej nadbudówce (wieża z kratą i rufowa część bloku TERRA NOVA; kreator −150 j.; 1672 × 941).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -160.3, y: -2, w: 160.8, h: 81.5, rot: 0, level: 6 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  // --- Piraci (rodzina Iron Skull) ---
  pirate_frigate: Object.freeze({
    label: 'Iron Skull — fregata',
    windowColor: '#ff9a4a',
    variants: Object.freeze({
      standard: Object.freeze([
        // Najeżona kopuła i krata za nią, między dyszami a działami (1942 × 809).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -439, y: 2.5, w: 232, h: 195, rot: 0 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  pirate_destroyer: Object.freeze({
    label: 'Iron Skull — niszczyciel',
    windowColor: '#ff9a4a',
    variants: Object.freeze({
      standard: Object.freeze([
        // Bunkier z czaszką i krata chłodnic na rufie (1840 × 854).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -406, y: -7.5, w: 268, h: 175, rot: 0 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  // --- Supercapital piratów ---
  pirate_supercapital: Object.freeze({
    label: 'Iron Skull — Supercapital',
    windowColor: '#ff9a4a',
    variants: Object.freeze({
      standard: Object.freeze([
        // Rufowy bunkier i krata obok niego, między silnikami a SPECIAL (1671 × 941).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -335.5, y: 9.5, w: 176, h: 246, rot: 0 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  // --- Megafrachtowiec: mostek ma tylko lokomotywa (wagony to ładunek) ---
  megafreighter: Object.freeze({
    label: 'Megafrachtowiec — lokomotywa',
    windowColor: '#ffe0b0',
    variants: Object.freeze({
      standard: Object.freeze([
        // Blok „C” z włazem za dziobem, sterówka przed nim i kapsuły po bokach
        // (1672 × 941, render 2760 × 1553 — sprite powiększony ×1,65).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: 456, y: -6, w: 222, h: 212, rot: 0 })
      ])
    }),
    defaultVariant: 'standard'
  })
});

// ---------------------------------------------------------------------------
// Narzędzia
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / ((e1 - e0) || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeDeg(deg) {
  let d = finite(deg, 0) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Deterministyczny szum 0..1 (bez Math.random: sekwencja śmierci ma wyglądać
// tak samo przy każdym odtworzeniu i w testach).
export function bridgeHash01(a, b = 0) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Definicje stref
// ---------------------------------------------------------------------------

/**
 * Znormalizowana definicja mostka (przestrzeń PNG). Prostokąt obrócony
 * o `rot` stopni (zgodnie z ruchem wskazówek na obrazku, bo +Y idzie w dół);
 * opcjonalny `poly` (wielokąt [[x, y], ...]) zastępuje prostokąt, gdy sprite
 * tego wymaga.
 */
export function normalizeBridgeDef(raw, index = 0) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const id = String(src.id || `mostek_${index}`);
  let poly = null;
  if (Array.isArray(src.poly) && src.poly.length >= 3) {
    poly = [];
    for (const p of src.poly) {
      const x = Number(Array.isArray(p) ? p[0] : p?.x);
      const y = Number(Array.isArray(p) ? p[1] : p?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) poly.push([x, y]);
    }
    if (poly.length < 3) poly = null;
  }
  const def = {
    id,
    label: String(src.label || id),
    role: src.role === 'backup' ? 'backup' : 'primary',
    x: finite(src.x, 0),
    y: finite(src.y, 0),
    w: Math.max(1, finite(src.w, 120)),
    h: Math.max(1, finite(src.h, 60)),
    rot: normalizeDeg(src.rot),
    armorMul: clamp(positive(src.armorMul, BRIDGE_DEFAULTS.armorMul), 0.1, 50),
    killFrac: clamp(finite(src.killFrac, BRIDGE_DEFAULTS.killFrac), 0.05, 1),
    poly,
    windowColor: typeof src.windowColor === 'string' ? src.windowColor : null,
    // poziom mostka I–VI (src/data/bridgeLevels.js): model 3D poziomu, obrys modelu = strefa; 0 — model kadłuba
    level: Number.isFinite(Number(src.level)) && Number(src.level) >= 1 ? Math.min(6, Math.round(Number(src.level))) : 0
  };
  if (poly) {
    // Prostokąt opisujący wielokąt: środek i rozmiar do HUD-u i celowania.
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of poly) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    def.x = (x0 + x1) * 0.5; def.y = (y0 + y1) * 0.5;
    def.w = Math.max(1, x1 - x0); def.h = Math.max(1, y1 - y0); def.rot = 0;
  }
  return def;
}

export function normalizeBridgeList(list, overrides = null) {
  const out = [];
  if (!Array.isArray(list)) return out;
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const raw = overrides ? { ...list[i], ...overrides } : list[i];
    const def = normalizeBridgeDef(raw, i);
    if (seen.has(def.id)) def.id = `${def.id}_${i}`;
    seen.add(def.id);
    out.push(def);
  }
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/** Zwięzły zapis do defaultów (edytor/eksport): tylko pola, które coś znaczą. */
export function compactBridgeDef(raw) {
  const def = normalizeBridgeDef(raw);
  const out = { id: def.id, label: def.label, role: def.role };
  if (def.poly) {
    out.poly = def.poly.map(([x, y]) => [round1(x), round1(y)]);
  } else {
    out.x = round1(def.x); out.y = round1(def.y);
    out.w = round1(def.w); out.h = round1(def.h);
    out.rot = round1(def.rot);
  }
  out.armorMul = round2(def.armorMul);
  out.killFrac = round2(def.killFrac);
  if (def.level) out.level = def.level;
  return out;
}

/** JSON gotowy do wklejenia jako `bridges: [...]` w hardpointEditorDefaults. */
export function formatBridgesJson(list) {
  const compact = (Array.isArray(list) ? list : []).map(compactBridgeDef);
  return JSON.stringify(compact, null, 2);
}

// Punkt (PNG) → układ strefy: u wzdłuż szerokości, v wzdłuż wysokości.
function zoneLocal(def, px, py, out) {
  const r = def.rot * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = px - def.x;
  const dy = py - def.y;
  out.u = dx * c + dy * s;
  out.v = -dx * s + dy * c;
  return out;
}

const _zl = { u: 0, v: 0 };

function polyContains(poly, px, py) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const yi = poly[i][1];
    const xj = poly[j][0]; const yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

/** Czy punkt (PNG) leży w strefie mostka. */
export function bridgeZoneContains(def, px, py) {
  if (def.poly) return polyContains(def.poly, px, py);
  zoneLocal(def, px, py, _zl);
  return Math.abs(_zl.u) <= def.w * 0.5 && Math.abs(_zl.v) <= def.h * 0.5;
}

/** Odległość ze znakiem (PNG): ujemna w środku strefy, dodatnia na zewnątrz. */
export function bridgeZoneDistance(def, px, py) {
  if (def.poly) {
    let best = Infinity;
    const poly = def.poly;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0]; const ay = poly[j][1];
      const bx = poly[i][0]; const by = poly[i][1];
      const ex = bx - ax; const ey = by - ay;
      const t = clamp(((px - ax) * ex + (py - ay) * ey) / ((ex * ex + ey * ey) || 1e-12), 0, 1);
      const d = Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
      if (d < best) best = d;
    }
    return polyContains(poly, px, py) ? -best : best;
  }
  zoneLocal(def, px, py, _zl);
  const qx = Math.abs(_zl.u) - def.w * 0.5;
  const qy = Math.abs(_zl.v) - def.h * 0.5;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0);
}

/** Narożniki strefy (PNG) — do HUD-u i edytora. out: [x0,y0, x1,y1, ...]. */
export function bridgeZoneCorners(def, out = []) {
  out.length = 0;
  if (def.poly) {
    for (const [x, y] of def.poly) out.push(x, y);
    return out;
  }
  const r = def.rot * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const hw = def.w * 0.5;
  const hh = def.h * 0.5;
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  for (const [u, v] of pts) out.push(def.x + u * c - v * s, def.y + u * s + v * c);
  return out;
}

/**
 * Konflikty strefy z hardpointami, silnikami, rdzeniami i innymi mostkami
 * (dane edytora w przestrzeni PNG). Pusta lista = układ poprawny.
 * `margin` — zapas w px PNG (sonda hardpointu ma 14 px renderu, czyli
 * ~26 px PNG na Bellatorze i ~29 na Atlasie).
 */
export function validateBridgeLayout(list, hullCfg = {}, opts = {}) {
  const margin = Math.max(0, finite(opts.margin, 24));
  const defs = normalizeBridgeList(list);
  const issues = [];
  const check = (def, kind, marker) => {
    const x = Number(marker?.x);
    const y = Number(marker?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const d = bridgeZoneDistance(def, x, y);
    if (d < margin) issues.push({ bridgeId: def.id, kind, id: marker.id || null, type: marker.type || null, x, y, distance: round1(d) });
  };
  for (const def of defs) {
    for (const hp of (hullCfg.hardpoints || [])) check(def, 'hardpoint', hp);
    for (const e of (hullCfg.engines?.main || [])) check(def, 'engine', e);
    for (const e of (hullCfg.engines?.side || [])) check(def, 'engine', e);
    for (const core of (hullCfg.cores || [])) check(def, 'core', core);
  }
  // Mostki nie mogą się nakładać: komórka należy do jednej strefy, a mostek
  // zapasowy ma sens tylko wtedy, gdy jedna wyrwa nie zabiera obu.
  for (let i = 0; i < defs.length; i++) {
    for (let j = i + 1; j < defs.length; j++) {
      const a = defs[i]; const b = defs[j];
      const corners = bridgeZoneCorners(b, []);
      let overlap = bridgeZoneContains(a, b.x, b.y) || bridgeZoneContains(b, a.x, a.y);
      for (let k = 0; k < corners.length && !overlap; k += 2) overlap = bridgeZoneContains(a, corners[k], corners[k + 1]);
      if (overlap) issues.push({ bridgeId: a.id, kind: 'bridge', id: b.id, type: null, x: b.x, y: b.y, distance: 0 });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Transformacje (punkty: backend mostków — siatka belek rodu; kierunki: poza encji)
// ---------------------------------------------------------------------------

function entitySpriteRotation(entity) {
  if (entity?.isPlayer) return 0;
  const r = (entity?.visual && typeof entity.visual.spriteRotation === 'number') ? entity.visual.spriteRotation
    : (entity?.capitalProfile && typeof entity.capitalProfile.spriteRotation === 'number') ? entity.capitalProfile.spriteRotation
      : (entity?.profile && typeof entity.profile.spriteRotation === 'number') ? entity.profile.spriteRotation
        : 0;
  return Number.isFinite(r) ? r : 0;
}

function entityPosX(entity) {
  return (entity?.pos && typeof entity.pos.x === 'number') ? entity.pos.x : (Number(entity?.x) || 0);
}

function entityPosY(entity) {
  return (entity?.pos && typeof entity.pos.y === 'number') ? entity.pos.y : (Number(entity?.y) || 0);
}

function spriteScaleX(entity) {
  const v = entity?.visual;
  if (v && typeof v.spriteScaleX === 'number') return v.spriteScaleX;
  if (v && typeof v.spriteScale === 'number') return v.spriteScale;
  return 1;
}

function spriteScaleY(entity) {
  const v = entity?.visual;
  if (v && typeof v.spriteScaleY === 'number') return v.spriteScaleY;
  if (v && typeof v.spriteScale === 'number') return v.spriteScale;
  return 1;
}

// Encja bez stanu mostków (albo ze stanem bez backendu): punkt w pozycji encji / pozy.
function entityPoint(entity, out, pose) {
  out.x = pose ? pose.x : entityPosX(entity);
  out.y = pose ? pose.y : entityPosY(entity);
  return out;
}

/**
 * Punkt w przestrzeni SIATKI (piksele obrazu kadłuba) → świat gry. `pose` {x, y, angle} — poza
 * renderu zamiast fizycznej (gracz jest rysowany z interpolacją między krokami fizyki).
 */
export function bridgeGridToWorld(entity, gx, gy, out = { x: 0, y: 0 }, pose = null) {
  const be = entity?.bridgeState?.backend;
  return be ? be.gridToWorld(entity, gx, gy, out, pose) : entityPoint(entity, out, pose);
}

/** Punkt w przestrzeni PNG → świat gry (skala render / PNG ze stanu mostków). */
export function bridgePngToWorld(entity, px, py, out = { x: 0, y: 0 }, pose = null) {
  const be = entity?.bridgeState?.backend;
  return be ? be.pngToWorld(entity, px, py, out, pose) : entityPoint(entity, out, pose);
}

/** Świat gry → przestrzeń PNG ((0, 0) bez stanu mostków). */
export function bridgeWorldToPng(entity, wx, wy, out = { x: 0, y: 0 }) {
  const be = entity?.bridgeState?.backend;
  if (be) return be.worldToPng(entity, wx, wy, out);
  out.x = 0;
  out.y = 0;
  return out;
}

/** Wektor świata → wektor w przestrzeni PNG (kierunki, prędkości). */
export function bridgeWorldDirToPng(entity, vx, vy, out = { x: 0, y: 0 }) {
  const a = (Number(entity.angle) || 0) + entitySpriteRotation(entity);
  const c = Math.cos(a);
  const s = Math.sin(a);
  out.x = vx * c + vy * s;
  out.y = -vx * s + vy * c;
  return out;
}

// ---------------------------------------------------------------------------
// Podpięcie do kadłuba: shipBridgeBeams.js (attachBeamBridges, przez attachEntityBridges
// w shipBridgeRuntime.js); tu zdjęcie stanu
// ---------------------------------------------------------------------------

/** Zdejmuje mostki z encji i przywraca bazowe HP komórek (backend stanu). */
export function detachShipBridges(entity) {
  const st = entity?.bridgeState;
  if (!st) return false;
  if (st.backend) st.backend.detach(entity);
  return releaseShipBridges(entity);
}

/**
 * Encja przestaje mieć mostki BEZ zdejmowania pancerza (np. hulk zamieniony we
 * wrak — kadłub należy już do wraku): oddaje dysze i lampy zgaszone przez
 * applyCommandLossVisuals i zeruje stan. Obiekt NPC bywa używany ponownie
 * (odrodzenie) — bez tego wstałby z niewidocznymi dyszami.
 */
export function releaseShipBridges(entity) {
  const st = entity?.bridgeState;
  if (!st) return false;
  restoreThrusters(entity.visual?.mainThrusters);
  restoreThrusters(entity.visual?.torqueThrusters);
  if (st.navOriginal) entity.editorLights = st.navOriginal;
  if (entity.isBridgeHulk) entity.isBridgeHulk = false;
  entity.bridgeState = null;
  return true;
}

// ---------------------------------------------------------------------------
// Integralność
// ---------------------------------------------------------------------------

/**
 * Kadencyjne sprawdzenie (co probeEverySec). Wołać z tej samej pętli co
 * sondy hardpointów (updateHardpointIntegrity: co 3. podkrok z akumulowanym dt).
 * Zwraca flagi BRIDGE_EVENT. Koszt: O(1), gdy od ostatniego sprawdzenia nie
 * zginął żaden węzeł kadłuba; inaczej O(komórki mostków) — backend stanu.
 */
export function updateShipBridges(entity, dt = 0, nowSec = 0) {
  const st = entity?.bridgeState;
  if (!st || st.commandLost || !st.backend) return BRIDGE_EVENT.NONE;
  return st.backend.update(entity, dt, nowSec);
}

/** Natychmiastowe sprawdzenie (benchmark, testy, HUD). Ten sam wynik co kadencja. */
export function evaluateShipBridges(entity, nowSec = 0) {
  const st = entity?.bridgeState;
  if (!st || st.commandLost || !st.backend) return BRIDGE_EVENT.NONE;
  return st.backend.evaluate(entity, nowSec);
}

/**
 * Zapamiętuje ostatnie trafienie w kadłub (punkt i prędkość pocisku) — z niego
 * bierze się kierunek wyrzutu atmosfery: gaz ucieka tunelem wybitym przez ostrzał.
 * Tanie (kilka mnożeń), wołać z każdej ścieżki trafienia w kadłub.
 */
export function noteBridgeHit(entity, worldX, worldY, vx, vy, nowSec = 0) {
  const st = entity?.bridgeState;
  if (!st || st.commandLost) return;
  const p = bridgeWorldToPng(entity, worldX, worldY, _tmpA);
  const d = bridgeWorldDirToPng(entity, vx, vy, _tmpB);
  const hit = st.lastHit;
  hit.x = p.x; hit.y = p.y; hit.vx = d.x; hit.vy = d.y; hit.t = nowSec;
}

const _tmpA = { x: 0, y: 0 };
const _tmpB = { x: 0, y: 0 };

/** Wyrwa i kierunek strumienia w PNG (null przed utratą dowodzenia). */
export function getBridgeVent(entity) {
  return entity?.bridgeState?.vent || null;
}

/**
 * Punkt celowania „lock na mostek” (świat). Tryby (shipBridgeBeams.js: getBeamBridgeAimPoint):
 *   'breach'   — (domyślny) środek ŻYWYCH komórek mostka: tunel idzie prosto
 *                w środek nadbudówki, a gdy komórki giną, środek przesuwa się
 *                w stronę ocalałych i ogień sam zamiata strefę. Gdy linia do
 *                środka jest już pusta (dziura na wylot — ważne dla wiązek),
 *                najmniej zasłonięta komórka mostka przy wyrwie, cel trzymany
 *                między strzałami (opts.memory). Zmierzone w benchmarku:
 *                najtańszy tryb dla pocisków i jedyny odporny dla wiązek.
 *   'exposed'  — żywa komórka mostka najbliższa strzelcowi,
 *   'centroid' — środek żywych komórek mostka,
 *   'center'   — środek strefy (jak lock na hardpoint).
 * Zwraca null, gdy encja nie ma żywego mostka.
 */
export function getBridgeAimPoint(entity, out = { x: 0, y: 0 }, opts = {}) {
  const be = entity?.bridgeState?.backend;
  return be ? be.aimPoint(entity, out, opts) : null;
}

/** Świat gry → przestrzeń SIATKI (piksele obrazu kadłuba; (0, 0) bez stanu mostków). */
export function bridgeWorldToGrid(entity, wx, wy, out = { x: 0, y: 0 }) {
  const be = entity?.bridgeState?.backend;
  if (be) return be.worldToGrid(entity, wx, wy, out);
  out.x = 0;
  out.y = 0;
  return out;
}

/** Podsumowanie do HUD-u (bez alokacji, gdy podasz `out`). */
export function getShipBridgeSummary(entity, out = []) {
  out.length = 0;
  const st = entity?.bridgeState;
  if (!st) return out;
  for (const b of st.bridges) {
    out.push({
      id: b.id,
      label: b.def.label,
      role: b.def.role,
      alive: b.alive,
      total: b.total,
      integrity: b.integrity,
      threshold: 1 - b.def.killFrac,
      dead: b.dead,
      missing: b.missing === true,
      armorMul: b.def.armorMul,
      killFrac: b.def.killFrac
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sekwencja utraty dowodzenia (czysty kill)
// ---------------------------------------------------------------------------

/** Sekundy od utraty dowodzenia; -1 przed nią. */
export function commandLossAge(entity, nowSec) {
  const st = entity?.bridgeState;
  if (!st || !st.commandLost) return -1;
  return Math.max(0, nowSec - st.commandLostAt);
}

/** Czy broń może jeszcze strzelać (milknie w chwili utraty dowodzenia). */
export function bridgeWeaponsOnline(entity, nowSec) {
  const age = commandLossAge(entity, nowSec);
  return age < 0 || age < BRIDGE_KILL_TIMELINE.weaponsOffAt;
}

/**
 * Jasność okna (0..1) w sekundzie `t` po utracie dowodzenia.
 * `delay` — opóźnienie fali (odległość od wyrwy / prędkość fali), `seed` 0..1.
 * Najpierw nierówne miganie (przepięcia), potem gaśnięcie falą od wyrwy.
 */
export function sampleWindowLight(t, delay, seed = 0) {
  const T = BRIDGE_KILL_TIMELINE;
  if (t < 0) return 1;
  const off = T.windowFlickerEnd * (0.55 + 0.45 * seed) + Math.max(0, delay);
  if (t >= off + T.windowFade) return 0;
  // ~16 Hz przełączania, wypełnienie spada w miarę zbliżania się fali.
  const slot = Math.floor(t * 16);
  const r = bridgeHash01(slot, Math.floor(seed * 65536));
  const duty = 0.75 - 0.45 * clamp(t / Math.max(0.001, off), 0, 1);
  let v = r < duty ? 1 : 0.12;
  // Pierwsze 60 ms: rozbłysk przeciążenia.
  if (t < 0.06) v = 1;
  if (t > off) v *= 1 - (t - off) / T.windowFade;
  return v;
}

/** Światło pozycyjne (0..1): świeci, zająknie się i gaśnie, gdy dojdzie fala. */
export function sampleNavLight(t, delay, seed = 0) {
  const T = BRIDGE_KILL_TIMELINE;
  if (t < 0) return 1;
  const off = T.navDelay + Math.max(0, delay);
  if (t >= off) return 0;
  if (t > off - 0.25) {
    const slot = Math.floor(t * 22);
    return bridgeHash01(slot, Math.floor(seed * 65536) + 7) < 0.5 ? 1 : 0.2;
  }
  return 1;
}

/**
 * Mnożnik ciągu dyszy (0..1): dysza dławi się (nierówne pchnięcia, coraz
 * rzadsze), ostatni kaszel i cisza po engineChokeEnd.
 */
export function sampleEngineThrottle(t, seed = 0) {
  const T = BRIDGE_KILL_TIMELINE;
  if (t < T.engineChokeStart) return 1;
  const end = T.engineChokeEnd * (0.85 + 0.3 * seed);
  if (t >= end) return 0;
  const k = (t - T.engineChokeStart) / Math.max(0.001, end - T.engineChokeStart);
  const envelope = Math.pow(1 - k, 1.4);
  const slot = Math.floor(t * 11);
  const r = bridgeHash01(slot, Math.floor(seed * 65536) + 13);
  // Coraz rzadsze pchnięcia: próg rośnie, kaszel ma pełną amplitudę obwiedni.
  const cough = r > 0.25 + 0.6 * k ? 1 : 0.08;
  return clamp(envelope * cough, 0, 1);
}

/**
 * Wielkość płomyka postojowego dyszy (0..1). EngineExhaustBatch rysuje przy
 * ciągu 0 jasny rdzeń w wylocie (glowAlpha nie zależy od ciągu) — martwa dysza
 * musi zgasnąć także z nim. Maleje od początku dławienia do ostatniego kaszlu
 * tej dyszy plus engineCoolDown; to samo ziarno co sampleEngineThrottle.
 */
export function sampleEngineGlow(t, seed = 0) {
  const T = BRIDGE_KILL_TIMELINE;
  const end = T.engineChokeEnd * (0.85 + 0.3 * seed) + T.engineCoolDown;
  return 1 - smoothstep(T.engineChokeStart, end, t);
}

/** Siła wyrzutu atmosfery (0..1): szybkie narastanie, wykładniczy spadek ciśnienia. */
export function sampleVentStrength(t) {
  const T = BRIDGE_KILL_TIMELINE;
  if (t < 0 || t >= T.ventEnd) return 0;
  const rise = smoothstep(0, T.ventRise, t);
  const decay = Math.pow(0.5, t / T.ventHalfLife);
  const tail = 1 - smoothstep(T.ventEnd * 0.7, T.ventEnd, t);
  return rise * decay * tail;
}

/**
 * Dryf hulka po utracie dowodzenia — woła się co krok fizyki ZAMIAST
 * sterowania napędem. Strumień atmosfery z wyrwy działa jak mała dysza:
 * siła przeciwna do strumienia, przyłożona w wyrwie, więc kadłub dostaje
 * lekkie pchnięcie i powolny obrót. Poza tym bardzo słabe tłumienie — statek
 * zachowuje resztkowy ruch (w próżni nic go nie hamuje).
 *
 * opts.ventAccel — szczytowe przyspieszenie jako ułamek długości kadłuba
 * na s² (0,028: Bellator ~17 j./s², Δv ~13 j./s, ~2°/s obrotu).
 */
export function stepCommandLossDrift(entity, dt, nowSec, opts = {}) {
  const st = entity?.bridgeState;
  if (!st || !st.commandLost || !st.backend) return;
  const steps = dt * 120;
  const damp = Math.pow(finite(opts.damping, 0.99985), steps);
  const angDamp = Math.pow(finite(opts.angDamping, 0.99992), steps);
  entity.vx = (Number(entity.vx) || 0) * damp;
  entity.vy = (Number(entity.vy) || 0) * damp;
  entity.angVel = (Number(entity.angVel) || 0) * angDamp;
  const vent = st.vent;
  if (!vent) return;
  const strength = sampleVentStrength(nowSec - st.commandLostAt);
  if (strength <= 0) return;
  // Wymiary obrazu kadłuba ze stanu mostków (wrak liczy od środka masy, ale dryfuje tylko hulk,
  // a ten ma kotwicę w środku sprite'a).
  const srcW = st.srcW;
  const srcH = st.srcH;
  const sx = spriteScaleX(entity);
  const sy = spriteScaleY(entity);
  const L = srcW * sx;
  const W = srcH * sy;
  const accel = finite(opts.ventAccel, 0.028) * Math.max(L, W) * strength;
  const a = (Number(entity.angle) || 0) + entitySpriteRotation(entity);
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Kierunek strumienia (PNG → lokalna → świat); siła działa przeciwnie.
  let dx = vent.dirX * st.scaleX * sx;
  let dy = vent.dirY * st.scaleY * sy;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;
  const fx = -(dx * c - dy * s);
  const fy = -(dx * s + dy * c);
  const lx = vent.x * st.scaleX * sx;
  const ly = vent.y * st.scaleY * sy;
  const rx = lx * c - ly * s;
  const ry = lx * s + ly * c;
  entity.vx += fx * accel * dt;
  entity.vy += fy * accel * dt;
  // Płyta prostokątna: I/m = (L² + W²) / 12.
  entity.angVel += (rx * fy - ry * fx) * accel * dt / Math.max(1, (L * L + W * W) / 12);
}

/**
 * Stan wizualny hulka wg osi czasu (dane, bez rysowania): dławienie dysz
 * (`thruster.__throttle` — czyta go EngineVfxSystem), gaśnięcie płomyka
 * postojowego (`thruster.vfxScale` → 0; pierwotna skala zapamiętana w
 * `__bridgeBaseVfxScale`, detachShipBridges ją przywraca) i gaśnięcie świateł
 * pozycyjnych falą od mostka (podmiana `entity.editorLights`; lista zmienia
 * się tylko przy zmianie zestawu zapalonych lamp). `baseThrottle` — ciąg,
 * z którym dysze pracowały przed utratą dowodzenia.
 * W grze lepszy będzie mnożnik mocy lampy zamiast podmiany listy
 * (docs/PORT-mostki.md) — to wersja bez zmian w plikach gry.
 */
export function applyCommandLossVisuals(entity, nowSec, opts = {}) {
  const st = entity?.bridgeState;
  if (!st || !st.commandLost) return;
  const age = Math.max(0, nowSec - st.commandLostAt);
  const base = clamp(finite(opts.baseThrottle, 0.6), 0, 1);
  const main = entity.visual?.mainThrusters;
  const side = entity.visual?.torqueThrusters;
  if (Array.isArray(main)) {
    for (let i = 0; i < main.length; i++) {
      const seed = bridgeHash01(i, 31);
      main[i].__throttle = base * sampleEngineThrottle(age, seed);
      fadeThrusterGlow(main[i], sampleEngineGlow(age, seed));
    }
  }
  if (Array.isArray(side)) {
    for (let i = 0; i < side.length; i++) {
      const seed = bridgeHash01(i, 57);
      side[i].__throttle = 0.35 * sampleEngineThrottle(age * 1.25, seed);
      fadeThrusterGlow(side[i], sampleEngineGlow(age * 1.25, seed));
    }
  }
  // Światła pozycyjne: pierwotna lista zapamiętana raz.
  if (!st.navOriginal) {
    const src = entity.editorLights;
    st.navOriginal = src ? {
      position: Array.isArray(src.position) ? src.position.slice() : [],
      road: Array.isArray(src.road) ? src.road.slice() : [],
      ...(Array.isArray(src.flood) ? { flood: src.flood.slice() } : {})
    } : null;
    st.navMask = '';
  }
  const orig = st.navOriginal;
  if (!orig || (!orig.position.length && !orig.road.length)) return;
  const def = st.bridges[0].def;
  const T = BRIDGE_KILL_TIMELINE;
  let mask = '';
  const lit = [];
  for (let i = 0; i < orig.position.length; i++) {
    const m = orig.position[i];
    const delay = bridgeWaveDelay(def.x, def.y, Number(m.x) || 0, Number(m.y) || 0, T.navWaveSpeed);
    const on = sampleNavLight(age, delay, bridgeHash01(i, 77)) > 0.5;
    mask += on ? '1' : '0';
    if (on) lit.push(m);
  }
  const roadOn = age < T.navDelay;
  mask += roadOn ? 'R' : 'r';
  if (mask === st.navMask) return;
  st.navMask = mask;
  // Reflektory otoczenia gasną z drogowymi; `autoFlood: false`, bo lista bez
  // reflektorów dostałaby w shipLightRuntime automatyczne z obrysu lamp.
  entity.editorLights = {
    position: lit,
    road: roadOn ? orig.road : [],
    flood: roadOn && orig.flood ? orig.flood : [],
    autoFlood: roadOn
  };
}

// vfxScale musi zostać > 0 (EngineVfxSystem traktuje 0 jak brak wpisu = 1).
const MIN_THRUSTER_VFX_SCALE = 1e-3;

function fadeThrusterGlow(thruster, k) {
  if (!thruster) return;
  if (thruster.__bridgeBaseVfxScale === undefined) {
    const raw = Number(thruster.vfxScale);
    thruster.__bridgeBaseVfxScale = Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const baseScale = thruster.__bridgeBaseVfxScale ?? 1;
  thruster.vfxScale = Math.max(MIN_THRUSTER_VFX_SCALE, baseScale * clamp(k, 0, 1));
}

function restoreThrusters(list) {
  if (!Array.isArray(list)) return;
  for (const t of list) {
    if (!t || t.__bridgeBaseVfxScale === undefined) continue;
    if (t.__bridgeBaseVfxScale === null) delete t.vfxScale;
    else t.vfxScale = t.__bridgeBaseVfxScale;
    delete t.__bridgeBaseVfxScale;
    delete t.__throttle;
  }
}

/**
 * Opóźnienie fali dla punktu (PNG) — okna liczą je od wyrwy, światła
 * pozycyjne od środka mostka.
 */
export function bridgeWaveDelay(fromX, fromY, px, py, speed) {
  return Math.hypot(px - fromX, py - fromY) / Math.max(1, speed);
}

// ---------------------------------------------------------------------------
// Okna nadbudówki (dane buduje shipBridgeBeams.js: buildBeamBridgeWindows;
// rysuje src/3d/bridgeFx3D.js)
// ---------------------------------------------------------------------------

/** Opóźnienia fali gaśnięcia okien liczone od wyrwy (wołać raz, po utracie). */
export function prepareWindowWave(entity) {
  const st = entity?.bridgeState;
  const win = st?.windows;
  if (!win || !st.vent) return;
  const speed = BRIDGE_KILL_TIMELINE.windowWaveSpeed;
  for (let i = 0; i < win.count; i++) {
    win.delay[i] = bridgeWaveDelay(st.vent.x, st.vent.y, win.px[i], win.py[i], speed);
  }
}
