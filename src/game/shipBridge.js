// src/game/shipBridge.js
//
// MOSTEK — centrum dowodzenia na kadłubie heksowym. Zniszczenie mostka zabija
// statek, ale inaczej niż rdzeń: to „czysty kill”. Okręt traci dowodzenie,
// gaśnie, dryfuje i zostaje prawie całym wrakiem (więcej łupu przy holowaniu).
// Rdzeń (src/game/shipCore.js, osobna instancja) to „brudny kill” z wybuchem.
//
// Moduł jest czystą logiką: bez DOM i bez three. Operuje na heksach
// destruktora (src/game/destructor.js) i na danych z edytora hardpointów.
// Wygląd (okna, wyrzut atmosfery) robi src/3d/bridgeFx3D.js.
//
// PRZESTRZENIE WSPÓŁRZĘDNYCH
//   PNG     — edytor hardpointów: piksele sprite'a źródłowego, (0,0) = środek,
//             +X = dziób, +Y = w dół obrazka. W niej zapisujemy strefy mostków
//             (tak jak hardpointy, silniki i rdzenie w hardpointEditorDefaults).
//   siatka  — shard.gridX/Y: piksele obrazu RENDERU, z którego initHexBody
//             zbudowało heksy (0..srcWidth, 0..srcHeight).
//   lokalna — siatka minus środek obrazu (i pivot fragmentu) = PNG × __hardpointScale.
//   świat   — lokalna × skala sprite'a, obrót kadłuba i pozycja encji; ten sam
//             wzór co getEntityHexAngle / localDeltaToWorld* w destruktorze.
//
// ZASADA ZNAKOWANIA: heks należy do mostka, gdy środek jego komórki (c, r)
// leży w strefie. Liczymy go z (c, r) — niezmiennej tożsamości heksa — a nie
// z ruchomego gridX, więc znakowanie nie zależy od wgnieceń ani zgniotu.
//
// INTEGRALNOŚĆ = żywe heksy strefy należące do BIEŻĄCEJ siatki encji ÷ heksy
// strefy na starcie. Heks odcięty razem z fragmentem przestaje należeć do
// siatki (rozpad przenosi go do wraku), więc mostek odstrzelony w kawałku
// kadłuba liczy się jako zniszczony. Przynależność sprawdzamy tym samym
// testem co _heatWoundRim w destruktorze: grid.shards[s.__meshIndex] === s.

// armorMul/killFrac z benchmarku dema (dema/mostki-bench-node.js, 2026-09-24,
// docs/PORT-mostki.md): koszt zabicia mostka to głównie TUNEL do niego, nie
// pancerz strefy. Bellator + Iron Skull: 3/0,6 → mediana 2,6× pocisków puli HP
// (mostek pierwszy 4/72), 1,5/0,35 → 1,7× (17/72); z pulą ×0,5 → 0,85× (40/72).
// Niżej (0,25) pojedyncza torpeda/Yamato w strefie potrafi zdecydować.
export const BRIDGE_DEFAULTS = Object.freeze({
  armorMul: 1.5,        // mnożnik HP heksów mostka (pancerz nadbudówki)
  killFrac: 0.35,       // ułamek heksów strefy, którego utrata niszczy mostek
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
export const BRIDGE_LAYOUT_PROPOSALS = Object.freeze({
  battleship: Object.freeze({
    label: 'Bellator',
    windowColor: '#e4f3ff',
    variants: Object.freeze({
      standard: Object.freeze([
        // Blok z kwadratową wieżą i kopułą w osi, rufowa połowa kadłuba.
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -282, y: 0, w: 236, h: 92, rot: 0 })
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
        // Rufowy blok dowodzenia: kwadratowa wieża i okrągły właz, między
        // działami burtowymi a dyszami (PNG 2400 × 1792, render 192 × 143).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -552, y: -5, w: 430, h: 220, rot: 0 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  destroyer: Object.freeze({
    label: 'Hasta',
    windowColor: '#e4f3ff',
    variants: Object.freeze({
      standard: Object.freeze([
        // Ten sam układ co Custos: wieża i właz w osi, rufowa część (768 × 573).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -193, y: 0, w: 150, h: 76, rot: 0 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  terran_carrier: Object.freeze({
    label: 'Citadella',
    windowColor: '#e4f3ff',
    variants: Object.freeze({
      standard: Object.freeze([
        // Cytadela na rufowym bloku: poprzeczna płyta z dwoma okrągłymi
        // kopułami i mechanizmem w osi (1672 × 941).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -552.5, y: -14.5, w: 95, h: 161, rot: 0 })
      ])
    }),
    defaultVariant: 'standard'
  }),
  terran_supercapital: Object.freeze({
    label: 'Colossus',
    windowColor: '#e4f3ff',
    variants: Object.freeze({
      standard: Object.freeze([
        // Centralna nadbudówka: ośmiokątna wieża z kratą, długi blok z napisem
        // TERRA NOVA i kapsuła czujników przed nim (1672 × 941).
        Object.freeze({ id: 'mostek', label: 'Mostek', role: 'primary', x: -81.5, y: 0, w: 347, h: 124, rot: 0 })
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

function parseHexColor(hex, fallback) {
  const raw = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) return fallback;
  return [
    parseInt(raw.slice(0, 2), 16) / 255,
    parseInt(raw.slice(2, 4), 16) / 255,
    parseInt(raw.slice(4, 6), 16) / 255
  ];
}

// sRGB → liniowo (pasma HDR liczymy liniowo — memory hdr-band-plan).
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
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
    windowColor: typeof src.windowColor === 'string' ? src.windowColor : null
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
  // Mostki nie mogą się nakładać: heks należy do jednej strefy, a mostek
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
// Geometria siatki heksów
// ---------------------------------------------------------------------------

// Promień heksa czytamy z samej siatki (HexShard.radius = gridDivisions),
// żeby moduł nie zależał od stałych destruktora.
function hexRadiusOf(grid) {
  const shards = grid?.shards;
  for (let i = 0; shards && i < shards.length; i++) {
    const r = Number(shards[i]?.radius);
    if (r > 0) return r;
  }
  return 5;
}

/** Środek komórki (c, r) w przestrzeni siatki — ten sam wzór co getHexBodyTemplate. */
export function hexCellCenter(c, r, radius, out = { x: 0, y: 0 }) {
  const hexH = Math.sqrt(3) * radius;
  out.x = c * radius * 1.5;
  out.y = r * hexH + ((c & 1) ? hexH * 0.5 : 0);
  return out;
}

/** Czy heks żyje i należy do bieżącej siatki encji (po rozpadzie może nie). */
export function bridgeShardIsAlive(grid, shard) {
  return !!shard && shard.active === true && shard.isDebris !== true && shard.hp > 0 &&
    grid.shards[shard.__meshIndex] === shard;
}

export function isBridgeShard(shard) {
  return shard?.__bridgeId != null;
}

// ---------------------------------------------------------------------------
// Transformacje (lustro getEntityHexAngle + localDeltaToWorld* z destruktora)
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

/** Punkt w przestrzeni SIATKI (gridX/Y) → świat gry. */
export function bridgeGridToWorld(entity, gx, gy, out = { x: 0, y: 0 }, pose = null) {
  const grid = entity.hexGrid;
  const lx = gx - grid.srcWidth * 0.5 - (grid.pivot ? grid.pivot.x : 0);
  const ly = gy - grid.srcHeight * 0.5 - (grid.pivot ? grid.pivot.y : 0);
  // `pose` {x, y, angle} — poza renderu zamiast fizycznej (gracz jest
  // rysowany z interpolacją między krokami fizyki).
  const a = (pose ? pose.angle : (Number(entity.angle) || 0)) + entitySpriteRotation(entity);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const sx = lx * spriteScaleX(entity);
  const sy = ly * spriteScaleY(entity);
  out.x = (pose ? pose.x : entityPosX(entity)) + sx * c - sy * s;
  out.y = (pose ? pose.y : entityPosY(entity)) + sx * s + sy * c;
  return out;
}

/** Punkt w przestrzeni PNG → świat gry (skala hardpointów ze stanu mostków). */
export function bridgePngToWorld(entity, px, py, out = { x: 0, y: 0 }, pose = null) {
  const st = entity?.bridgeState;
  const grid = entity.hexGrid;
  const kx = st ? st.scaleX : positive(entity.__hardpointScaleX, 1);
  const ky = st ? st.scaleY : positive(entity.__hardpointScaleY, 1);
  return bridgeGridToWorld(entity, grid.srcWidth * 0.5 + px * kx, grid.srcHeight * 0.5 + py * ky, out, pose);
}

/** Świat gry → przestrzeń PNG (bez pivota: dla kadłuba, nie fragmentu). */
export function bridgeWorldToPng(entity, wx, wy, out = { x: 0, y: 0 }) {
  const st = entity?.bridgeState;
  const kx = st ? st.scaleX : positive(entity.__hardpointScaleX, 1);
  const ky = st ? st.scaleY : positive(entity.__hardpointScaleY, 1);
  const a = (Number(entity.angle) || 0) + entitySpriteRotation(entity);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = wx - entityPosX(entity);
  const dy = wy - entityPosY(entity);
  const lx = (dx * c + dy * s) / spriteScaleX(entity);
  const ly = (-dx * s + dy * c) / spriteScaleY(entity);
  out.x = lx / kx;
  out.y = ly / ky;
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
// Podpięcie do kadłuba
// ---------------------------------------------------------------------------

/**
 * Znakuje heksy mostków i nakłada pancerz. Wołać ZARAZ po initHexBody (gracz:
 * po każdym initHexBody przy zmianie kadłuba; NPC: w drawNPCPretty po
 * initHexBody). Ponowne wołanie na tej samej siatce nie mnoży pancerza —
 * bazowe HP heksa jest zapamiętane, więc edytor może przestawiać strefy na żywo.
 *
 * opts.scaleX/scaleY — PNG → render (npc.__hardpointScaleX/Y; gracz: ship.__hardpointScaleX/Y).
 * opts.rule          — 'all' (domyślnie) albo 'any'.
 * opts.windowColor   — barwa okien, gdy definicja jej nie podaje.
 * opts.hullKey       — klucz kadłuba (atlas, battleship, pirate_battleship):
 *                      po nim src/3d/bridge3D.js wybiera model 3D mostka.
 */
export function attachShipBridges(entity, list, opts = {}) {
  if (!entity) return null;
  const grid = entity.hexGrid;
  const defs = normalizeBridgeList(list, opts.overrides || null);
  // Stan z poprzedniej siatki (odrodzenie, przebudowa kadłuba): oddaj dysze i
  // lampy; pancerza nie ruszamy — tamte heksy już nie należą do encji.
  if (entity.bridgeState && entity.bridgeState.grid !== grid) releaseShipBridges(entity);
  const previous = entity.bridgeState && entity.bridgeState.grid === grid ? entity.bridgeState : null;
  if (!grid || !Array.isArray(grid.shards) || !grid.shards.length || !defs.length) {
    if (previous) restoreArmor(previous);
    entity.bridgeState = null;
    return null;
  }

  const scaleX = positive(opts.scaleX, positive(entity.__hardpointScaleX, positive(entity.__hardpointScale, 1)));
  const scaleY = positive(opts.scaleY, positive(entity.__hardpointScaleY, positive(entity.__hardpointScale, 1)));
  const radius = hexRadiusOf(grid);
  const cx = grid.srcWidth * 0.5;
  const cy = grid.srcHeight * 0.5;
  const shards = grid.shards;

  // Zdejmujemy stare znaczniki (edytor przestawił strefy na tej samej siatce).
  if (previous) restoreArmor(previous);

  const bridges = defs.map((def, index) => ({
    def,
    id: def.id,
    index,
    shards: [],
    pos: null,          // Float32Array [px, py, ...] w PNG — środki komórek
    aliveFlags: null,   // Uint8Array — stan z poprzedniego sprawdzenia
    total: 0,
    alive: 0,
    integrity: 1,
    dead: false,
    deadAt: -1,
    lossX: def.x,
    lossY: def.y,
    lastLossAt: -1
  }));

  const cell = { x: 0, y: 0 };
  const tmpPos = bridges.map(() => []);
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    if (!s || !s.active || s.isDebris) continue;
    hexCellCenter(s.c | 0, s.r | 0, radius, cell);
    const px = (cell.x - cx) / scaleX;
    const py = (cell.y - cy) / scaleY;
    for (let b = 0; b < bridges.length; b++) {
      if (!bridgeZoneContains(bridges[b].def, px, py)) continue;
      bridges[b].shards.push(s);
      tmpPos[b].push(px, py);
      break;
    }
  }

  for (let b = 0; b < bridges.length; b++) {
    const bridge = bridges[b];
    bridge.total = bridge.shards.length;
    bridge.alive = bridge.total;
    bridge.pos = Float32Array.from(tmpPos[b]);
    bridge.aliveFlags = new Uint8Array(bridge.total).fill(1);
    const mul = bridge.def.armorMul;
    for (const s of bridge.shards) {
      if (s.__bridgeBaseMaxHp === undefined) s.__bridgeBaseMaxHp = s.maxHp;
      const base = s.__bridgeBaseMaxHp;
      const frac = s.maxHp > 0 ? clamp(s.hp / s.maxHp, 0, 1) : 1;
      s.maxHp = base * mul;
      s.hp = s.maxHp * frac;
      s.__bridgeId = bridge.id;
    }
  }

  const windowColor = parseHexColor(opts.windowColor, [0.9, 0.95, 1.0]);
  // Obrys kadłuba z chwili podpięcia (komórki, które istniały): po nim
  // liczymy wylot tunelu — miejsce, gdzie gaz z mostka trafia w próżnię.
  const silhouette = new Uint8Array(Math.max(1, (grid.cols | 0) * (grid.rows | 0)));
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    if (!s || !s.active || s.isDebris) continue;
    const c = s.c | 0;
    const r = s.r | 0;
    if (c >= 0 && r >= 0 && c < grid.cols && r < grid.rows) silhouette[c + r * grid.cols] = 1;
  }
  const state = {
    version: 1,
    grid,
    bridges,
    rule: opts.rule === 'any' ? 'any' : BRIDGE_DEFAULTS.rule,
    probeEverySec: positive(opts.probeEverySec, BRIDGE_DEFAULTS.probeEverySec),
    probeTimer: 0,
    lastShardsRef: shards,
    lastActive: grid.activeStructuralCount,
    aliveBridges: bridges.filter((b) => b.total > 0).length,
    commandLost: false,
    commandLostAt: -1,
    cause: null,
    hullKey: typeof opts.hullKey === 'string' ? opts.hullKey : null,
    scaleX,
    scaleY,
    hexRadius: radius,
    silhouette,
    silCols: grid.cols | 0,
    silRows: grid.rows | 0,
    windowColorSrgb: windowColor,
    lastHit: { x: 0, y: 0, vx: 0, vy: 0, t: -Infinity },
    vent: null,
    windows: null
  };
  // Mostek bez ani jednego heksa (strefa poza obrysem sprite'a) nie może
  // zabijać od startu — oznaczamy go jako nieistniejący, nie martwy.
  for (const b of bridges) if (b.total === 0) { b.integrity = 0; b.missing = true; }
  entity.bridgeState = state;
  if (opts.windows !== false) buildBridgeWindows(entity, opts.windowsOpts || {});
  return state;
}

function restoreArmor(state) {
  for (const b of state.bridges || []) {
    for (const s of b.shards) {
      if (s.__bridgeBaseMaxHp !== undefined) {
        const frac = s.maxHp > 0 ? clamp(s.hp / s.maxHp, 0, 1) : 1;
        s.maxHp = s.__bridgeBaseMaxHp;
        s.hp = s.maxHp * frac;
      }
      s.__bridgeId = undefined;
    }
  }
}

/** Zdejmuje mostki z encji i przywraca bazowe HP heksów. */
export function detachShipBridges(entity) {
  const st = entity?.bridgeState;
  if (!st) return false;
  if (st.grid === entity.hexGrid) restoreArmor(st);
  return releaseShipBridges(entity);
}

/**
 * Encja przestaje mieć mostki BEZ zdejmowania pancerza (np. hulk zamieniony we
 * wrak — heksy należą już do wraku): oddaje dysze i lampy zgaszone przez
 * applyCommandLossVisuals i zeruje stan. Obiekt NPC bywa używany ponownie
 * (odrodzenie) — bez tego wstałby z niewidocznymi dyszami.
 */
export function releaseShipBridges(entity) {
  const st = entity?.bridgeState;
  if (!st) return false;
  restoreThrusters(entity.visual?.mainThrusters);
  restoreThrusters(entity.visual?.torqueThrusters);
  if (st.navOriginal) entity.editorLights = st.navOriginal;
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
 * zginął żaden heks i siatka nie była przebudowana; inaczej O(heksy mostków).
 */
export function updateShipBridges(entity, dt = 0, nowSec = 0) {
  const st = entity?.bridgeState;
  if (!st || st.commandLost) return BRIDGE_EVENT.NONE;
  if (entity.hexGrid !== st.grid) return BRIDGE_EVENT.NONE;
  st.probeTimer -= dt;
  if (st.probeTimer > 0) return BRIDGE_EVENT.NONE;
  st.probeTimer = st.probeEverySec;
  return evaluateShipBridges(entity, nowSec);
}

/** Natychmiastowe sprawdzenie (benchmark, testy, HUD). Ten sam wynik co kadencja. */
export function evaluateShipBridges(entity, nowSec = 0) {
  const st = entity?.bridgeState;
  if (!st || st.commandLost) return BRIDGE_EVENT.NONE;
  const grid = entity.hexGrid;
  if (!grid || grid !== st.grid) return BRIDGE_EVENT.NONE;
  const shards = grid.shards;
  const active = grid.activeStructuralCount;
  // Brudne sprawdzenie: bez nowej śmierci heksa i bez przebudowy siatki stan
  // mostków nie mógł się zmienić (HP heksów nie wpływa na integralność).
  if (shards === st.lastShardsRef && active === st.lastActive) return BRIDGE_EVENT.NONE;
  st.lastShardsRef = shards;
  st.lastActive = active;

  let flags = BRIDGE_EVENT.NONE;
  let aliveBridges = 0;
  for (let b = 0; b < st.bridges.length; b++) {
    const bridge = st.bridges[b];
    if (bridge.dead || bridge.missing) continue;
    const list = bridge.shards;
    const flagsArr = bridge.aliveFlags;
    const pos = bridge.pos;
    let alive = 0;
    let lostX = 0;
    let lostY = 0;
    let lostN = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.active === true && s.isDebris !== true && s.hp > 0 && shards[s.__meshIndex] === s) {
        alive++;
      } else if (flagsArr[i] === 1) {
        flagsArr[i] = 0;
        lostX += pos[i * 2];
        lostY += pos[i * 2 + 1];
        lostN++;
      }
    }
    bridge.alive = alive;
    bridge.integrity = bridge.total > 0 ? alive / bridge.total : 0;
    if (lostN > 0) {
      bridge.lossX = lostX / lostN;
      bridge.lossY = lostY / lostN;
      bridge.lastLossAt = nowSec;
    }
    if (alive <= bridge.total * (1 - bridge.def.killFrac)) {
      bridge.dead = true;
      bridge.deadAt = nowSec;
      // Wyrwa i strumień atmosfery tego mostka (także zapasowego, gdy dowodzenie
      // przechodzi dalej — pierwszy mostek też „wieje”).
      bridge.vent = computeVent(entity, st, nowSec, bridge);
      flags |= BRIDGE_EVENT.BRIDGE_LOST;
    } else {
      aliveBridges++;
    }
  }
  st.aliveBridges = aliveBridges;

  if (flags & BRIDGE_EVENT.BRIDGE_LOST) {
    const anyDead = st.bridges.some((b) => b.dead);
    const lost = st.rule === 'any' ? anyDead : aliveBridges === 0;
    if (lost) {
      st.commandLost = true;
      st.commandLostAt = nowSec;
      st.cause = 'bridge';
      let last = null;
      for (const b of st.bridges) if (b.dead && (!last || b.deadAt >= last.deadAt)) last = b;
      st.vent = last?.vent || computeVent(entity, st, nowSec);
      flags |= BRIDGE_EVENT.COMMAND_LOST;
    }
  }
  return flags;
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

// Wyrwa i kierunek strumienia (PNG). Kolejność źródeł: świeże trafienie
// (tunel ostrzału), centroid heksów straconych w ostatnim sprawdzeniu
// względem środka strefy, na końcu „w górę obrazka”.
function computeVent(entity, st, nowSec, bridge = null) {
  if (!bridge) for (const b of st.bridges) if (b.dead && (!bridge || b.deadAt >= bridge.deadAt)) bridge = b;
  const def = bridge ? bridge.def : st.bridges[0].def;
  const vent = { x: bridge ? bridge.lossX : def.x, y: bridge ? bridge.lossY : def.y, dirX: 0, dirY: -1, bridgeId: def.id };
  const hit = st.lastHit;
  const hitFresh = nowSec - hit.t <= 1.5;
  let dx = 0;
  let dy = 0;
  if (hitFresh && Math.hypot(hit.vx, hit.vy) > 1e-6) {
    dx = -hit.vx; dy = -hit.vy;
    // Wyrwa na brzegu strefy od strony ostrzału, nie w środku straconych heksów.
    if (bridgeZoneDistance(def, hit.x, hit.y) < Math.max(def.w, def.h)) { vent.x = hit.x; vent.y = hit.y; }
  } else {
    dx = vent.x - def.x; dy = vent.y - def.y;
  }
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) { vent.dirX = dx / len; vent.dirY = dy / len; }
  // Wyrwa musi leżeć na mostku: trzymamy ją w strefie (lub na jej brzegu).
  if (!bridgeZoneContains(def, vent.x, vent.y) && !def.poly) {
    zoneLocal(def, vent.x, vent.y, _zl);
    const u = clamp(_zl.u, -def.w * 0.5, def.w * 0.5);
    const v = clamp(_zl.v, -def.h * 0.5, def.h * 0.5);
    const r = def.rot * DEG;
    vent.x = def.x + u * Math.cos(r) - v * Math.sin(r);
    vent.y = def.y + u * Math.sin(r) + v * Math.cos(r);
  }
  const exit = ventExitDistance(entity, st, vent.x, vent.y, vent.dirX, vent.dirY);
  vent.exitDist = exit;
  vent.exitX = vent.x + vent.dirX * exit;
  vent.exitY = vent.y + vent.dirY * exit;
  return vent;
}

// Odległość (PNG) od wyrwy do obrysu kadłuba wzdłuż kierunku strumienia —
// po obrysie z chwili podpięcia, więc wykopany tunel jej nie skraca.
function ventExitDistance(entity, st, px, py, dx, dy) {
  const mask = st.silhouette;
  const grid = entity.hexGrid;
  if (!mask || !grid) return 0;
  const R = st.hexRadius;
  const spacing = R * 1.5;
  const hexH = Math.sqrt(3) * R;
  const cx = grid.srcWidth * 0.5;
  const cy = grid.srcHeight * 0.5;
  // Krok w PNG odpowiadający ~⅓ heksa w siatce.
  const step = (R * 0.6) / Math.max(1e-6, Math.min(st.scaleX, st.scaleY));
  const maxDist = Math.hypot(grid.srcWidth / st.scaleX, grid.srcHeight / st.scaleY);
  let lastInside = 0;
  let outsideRun = 0;
  for (let d = 0; d <= maxDist; d += step) {
    const gx = cx + (px + dx * d) * st.scaleX;
    const gy = cy + (py + dy * d) * st.scaleY;
    const c = Math.round(gx / spacing);
    let inside = false;
    for (let dc = -1; dc <= 1 && !inside; dc++) {
      const cc = c + dc;
      if (cc < 0 || cc >= st.silCols) continue;
      const r = Math.round((gy - ((cc & 1) ? hexH * 0.5 : 0)) / hexH);
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= st.silRows || !mask[cc + rr * st.silCols]) continue;
        const ex = cc * spacing - gx;
        const ey = rr * hexH + ((cc & 1) ? hexH * 0.5 : 0) - gy;
        if (ex * ex + ey * ey <= R * R * 1.1) { inside = true; break; }
      }
    }
    if (inside) { lastInside = d; outsideRun = 0; } else if (++outsideRun >= 4) break;
  }
  return lastInside;
}

/** Wyrwa i kierunek strumienia w PNG (null przed utratą dowodzenia). */
export function getBridgeVent(entity) {
  return entity?.bridgeState?.vent || null;
}

/**
 * Ile żywych heksów (poza `ignore`) leży na odcinku (przestrzeń SIATKI).
 * Marsz po kratownicy co ¾ promienia heksa, test po pozycji kolizyjnej
 * heksa i jego hitRadius — ta sama geometria, którą widzi sweepImpact.
 * Kończy liczenie po `limit` (koszt: O(długość odcinka w kadłubie)).
 */
export function countLineBlockers(grid, gx0, gy0, gx1, gy1, ignore = null, limit = 64) {
  return marchLine(grid, gx0, gy0, gx1, gy1, ignore, limit, false);
}

/** Pierwszy żywy heks na odcinku (przestrzeń SIATKI) albo null. */
export function firstHexOnLine(grid, gx0, gy0, gx1, gy1, ignore = null) {
  return marchLine(grid, gx0, gy0, gx1, gy1, ignore, 1, true);
}

function marchLine(grid, gx0, gy0, gx1, gy1, ignore, limit, wantFirst) {
  const R = hexRadiusOf(grid);
  const spacing = R * 1.5;
  const hexH = Math.sqrt(3) * R;
  const cols = grid.cols | 0;
  const rows = grid.rows | 0;
  const cells = grid.grid;
  if (!cells || cols <= 0 || rows <= 0) return wantFirst ? null : 0;
  // Przycinamy odcinek do prostokąta siatki (z zapasem jednego heksa).
  let t0 = 0;
  let t1 = 1;
  const dx = gx1 - gx0;
  const dy = gy1 - gy0;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  const pad = R * 2;
  if (!clip(-dx, gx0 + pad) || !clip(dx, grid.srcWidth + pad - gx0) ||
      !clip(-dy, gy0 + pad) || !clip(dy, grid.srcHeight + pad - gy0)) return wantFirst ? null : 0;
  const len = Math.hypot(dx, dy) * (t1 - t0);
  const step = R * 0.75;
  const n = Math.max(1, Math.ceil(len / step));
  let count = 0;
  let last = null;
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n);
    const px = gx0 + dx * t;
    const py = gy0 + dy * t;
    const ac = Math.round(px / spacing);
    for (let dc = -1; dc <= 1; dc++) {
      const c = ac + dc;
      if (c < 0 || c >= cols) continue;
      const ar = Math.round((py - ((c & 1) ? hexH * 0.5 : 0)) / hexH);
      for (let dr = -1; dr <= 1; dr++) {
        const r = ar + dr;
        if (r < 0 || r >= rows) continue;
        const s = cells[c + r * cols];
        if (!s || s === ignore || s === last || s === prev || !s.active || s.isDebris) continue;
        const sx = s.gridX + s.deformation.x - px;
        const sy = s.gridY + s.deformation.y - py;
        const hr = Number(s.hitRadius) > 0 ? s.hitRadius : R * 1.3;
        if (sx * sx + sy * sy > hr * hr) continue;
        if (wantFirst) return s;
        prev = last;
        last = s;
        count++;
        if (count >= limit) return count;
      }
    }
  }
  return wantFirst ? null : count;
}

/**
 * Punkt celowania „lock na mostek” (świat). Tryby:
 *   'breach'   — (domyślny) środek ŻYWYCH heksów mostka: tunel idzie prosto
 *                w środek nadbudówki, a gdy heksy giną, środek przesuwa się
 *                w stronę ocalałych i ogień sam zamiata strefę. Gdy linia do
 *                środka jest już pusta (dziura na wylot — ważne dla wiązek),
 *                najmniej zasłonięty heks mostka przy wyrwie, cel trzymany
 *                między strzałami (opts.memory). Zmierzone w benchmarku:
 *                najtańszy tryb dla pocisków i jedyny odporny dla wiązek.
 *   'exposed'  — żywy heks mostka najbliższy strzelcowi,
 *   'centroid' — środek żywych heksów mostka,
 *   'center'   — środek strefy (jak lock na hardpoint).
 * Zwraca null, gdy encja nie ma żywego mostka.
 */
export function getBridgeAimPoint(entity, out = { x: 0, y: 0 }, opts = {}) {
  const st = entity?.bridgeState;
  if (!st || !entity.hexGrid) return null;
  const grid = entity.hexGrid;
  const mode = opts.mode || 'breach';
  let bridge = null;
  if (opts.bridgeId) bridge = st.bridges.find((b) => b.id === opts.bridgeId) || null;
  if (!bridge) bridge = st.bridges.find((b) => !b.dead && !b.missing) || null;
  if (!bridge) return null;

  if (mode === 'center') return bridgePngToWorld(entity, bridge.def.x, bridge.def.y, out);

  const shards = bridge.shards;
  if (mode === 'centroid') {
    let sx = 0; let sy = 0; let n = 0;
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      if (!bridgeShardIsAlive(grid, s)) continue;
      sx += s.gridX + s.deformation.x;
      sy += s.gridY + s.deformation.y;
      n++;
    }
    if (!n) return bridgePngToWorld(entity, bridge.def.x, bridge.def.y, out);
    return bridgeGridToWorld(entity, sx / n, sy / n, out);
  }

  const fromX = Number(opts.fromX);
  const fromY = Number(opts.fromY);
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) return bridgePngToWorld(entity, bridge.def.x, bridge.def.y, out);
  const from = bridgeWorldToPng(entity, fromX, fromY, _tmpA);
  const pos = bridge.pos;

  if (mode === 'breach') {
    // Faza 1 — środek żywych heksów mostka, dopóki linia ognia coś trafia
    // (opts.strictCentre: tylko mostek albo kadłub PRZED środkiem — w
    // benchmarku gorsze od prostego wariantu, bo rozprysk trafień za mostkiem
    // też go podgryza). Gdy linia jest pusta (dziura na wylot) — faza 2.
    let sx = 0; let sy = 0; let n = 0;
    for (let i = 0; i < shards.length; i++) {
      const sh = shards[i];
      if (!bridgeShardIsAlive(grid, sh)) continue;
      sx += sh.gridX + sh.deformation.x;
      sy += sh.gridY + sh.deformation.y;
      n++;
    }
    if (!n) return bridgePngToWorld(entity, bridge.def.x, bridge.def.y, out);
    const cgx = sx / n;
    const cgy = sy / n;
    const gs = bridgeWorldToGrid(entity, fromX, fromY, _tmpB);
    const gsx = gs.x;
    const gsy = gs.y;
    const first = firstHexOnLine(grid, gsx, gsy, gsx + (cgx - gsx) * 2, gsy + (cgy - gsy) * 2, null);
    if (first) {
      const toCentre = (cgx - gsx) * (cgx - gsx) + (cgy - gsy) * (cgy - gsy);
      const fx = first.gridX + first.deformation.x - gsx;
      const fy = first.gridY + first.deformation.y - gsy;
      if (opts.strictCentre !== true || first.__bridgeId === bridge.id || fx * fx + fy * fy < toCentre) {
        if (opts.memory) opts.memory.shard = null;
        return bridgeGridToWorld(entity, cgx, cgy, out);
      }
    }
    // Faza 2 — poszerzanie wyrwy: spośród K żywych heksów mostka najbliższych
    // wyrwie (środek heksów straconych ostatnio) bierzemy najmniej zasłonięty
    // od strzelca; przy remisie bliższy wyrwie. Poprzedni cel trzymamy, dopóki
    // żyje i nie jest gorzej zasłonięty (opts.memory) — ogień się nie rozłazi.
    const K = Math.max(1, opts.candidates | 0 || 14);
    if (!bridge.aimDist || bridge.aimDist.length < bridge.total) bridge.aimDist = new Float64Array(bridge.total);
    if (!bridge.aimPick || bridge.aimPick.length < K) bridge.aimPick = new Int32Array(K);
    const dist = bridge.aimDist;
    const pick = bridge.aimPick;
    const ax = bridge.lossX;
    const ay = bridge.lossY;
    let picked = 0;
    for (let i = 0; i < shards.length; i++) {
      if (!bridgeShardIsAlive(grid, shards[i])) { dist[i] = Infinity; continue; }
      const dx = pos[i * 2] - ax;
      const dy = pos[i * 2 + 1] - ay;
      dist[i] = dx * dx + dy * dy;
      // K najbliższych: wstawianie do krótkiej posortowanej listy.
      if (picked < K || dist[i] < dist[pick[picked - 1]]) {
        let j = Math.min(picked, K - 1);
        while (j > 0 && dist[pick[j - 1]] > dist[i]) { pick[j] = pick[j - 1]; j--; }
        pick[j] = i;
        if (picked < K) picked++;
      }
    }
    if (!picked) return bridgePngToWorld(entity, bridge.def.x, bridge.def.y, out);
    const g0 = bridgeWorldToGrid(entity, fromX, fromY, _tmpB);
    const g0x = g0.x;
    const g0y = g0.y;
    let best = pick[0];
    let bestBlock = Infinity;
    for (let k = 0; k < picked; k++) {
      const s = shards[pick[k]];
      const blockers = countLineBlockers(grid, g0x, g0y, s.gridX + s.deformation.x, s.gridY + s.deformation.y, s,
        Number.isFinite(bestBlock) ? bestBlock : 64);
      if (blockers < bestBlock) { bestBlock = blockers; best = pick[k]; }
      if (bestBlock === 0) break;
    }
    const mem = opts.memory;
    if (mem) {
      const prev = mem.shard;
      if (prev && prev !== shards[best] && prev.__bridgeId === bridge.id && bridgeShardIsAlive(grid, prev)) {
        const prevBlock = countLineBlockers(grid, g0x, g0y, prev.gridX + prev.deformation.x, prev.gridY + prev.deformation.y, prev, bestBlock + 1);
        if (prevBlock <= bestBlock) {
          return bridgeGridToWorld(entity, prev.gridX + prev.deformation.x, prev.gridY + prev.deformation.y, out);
        }
      }
      mem.shard = shards[best];
      mem.blockers = bestBlock;
    }
    const s = shards[best];
    return bridgeGridToWorld(entity, s.gridX + s.deformation.x, s.gridY + s.deformation.y, out);
  }

  // 'exposed'
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < shards.length; i++) {
    if (!bridgeShardIsAlive(grid, shards[i])) continue;
    const dx = pos[i * 2] - from.x;
    const dy = pos[i * 2 + 1] - from.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  if (best < 0) return bridgePngToWorld(entity, bridge.def.x, bridge.def.y, out);
  const s = shards[best];
  return bridgeGridToWorld(entity, s.gridX + s.deformation.x, s.gridY + s.deformation.y, out);
}

/** Świat gry → przestrzeń SIATKI (z pivotem fragmentu). */
export function bridgeWorldToGrid(entity, wx, wy, out = { x: 0, y: 0 }) {
  const grid = entity.hexGrid;
  const a = (Number(entity.angle) || 0) + entitySpriteRotation(entity);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = wx - entityPosX(entity);
  const dy = wy - entityPosY(entity);
  out.x = (dx * c + dy * s) / spriteScaleX(entity) + grid.srcWidth * 0.5 + (grid.pivot ? grid.pivot.x : 0);
  out.y = (-dx * s + dy * c) / spriteScaleY(entity) + grid.srcHeight * 0.5 + (grid.pivot ? grid.pivot.y : 0);
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
  if (!st || !st.commandLost || !entity.hexGrid) return;
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
  const grid = entity.hexGrid;
  const sx = spriteScaleX(entity);
  const sy = spriteScaleY(entity);
  const L = grid.srcWidth * sx;
  const W = grid.srcHeight * sy;
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
    st.navOriginal = src ? { position: Array.isArray(src.position) ? src.position.slice() : [], road: Array.isArray(src.road) ? src.road.slice() : [] } : null;
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
  entity.editorLights = { position: lit, road: roadOn ? orig.road : [] };
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
// Okna nadbudówki (dane; rysuje src/3d/bridgeFx3D.js)
// ---------------------------------------------------------------------------

/**
 * Rozmieszcza okna na heksach mostka: 2–3 rzędy wzdłuż dłuższej osi strefy,
 * oświetlone „pomieszczenia” (serie 2–5 okien) przedzielone ciemnymi.
 * Każde okno jest przypięte do heksa pod sobą — gaśnie, gdy heks zginie.
 * Rozmiary w jednostkach RENDERU (świat gry przy spriteScale 1), więc okna
 * mają ten sam rozmiar fizyczny na każdym kadłubie.
 */
export function buildBridgeWindows(entity, opts = {}) {
  const st = entity?.bridgeState;
  if (!st) return null;
  const grid = entity.hexGrid;
  const pitch = positive(opts.pitch, 7.2);          // odstęp okien w rzędzie (j. renderu)
  const rowGap = positive(opts.rowGap, 8.5);        // odstęp rzędów
  const slitLen = positive(opts.length, 2.1);
  const slitWid = positive(opts.width, 1.0);
  const R = st.hexRadius;
  const cx = grid.srcWidth * 0.5;
  const cy = grid.srcHeight * 0.5;

  const px = [];
  const py = [];
  const shardRef = [];
  const offX = [];
  const offY = [];
  const bridgeIdx = [];
  const seed = [];
  const level = [];
  const ang = [];
  const colors = [];
  const cell = { x: 0, y: 0 };

  for (let b = 0; b < st.bridges.length; b++) {
    const bridge = st.bridges[b];
    const def = bridge.def;
    // Barwa per mostek (indeks = indeks mostka, także dla stref bez heksów).
    colors[b] = parseHexColor(def.windowColor, st.windowColorSrgb).map(srgbToLinear);
    if (!bridge.total) continue;
    // Oś rzędów: dłuższy bok strefy (w przestrzeni renderu).
    const wR = def.w * st.scaleX;
    const hR = def.h * st.scaleY;
    const alongW = wR >= hR;
    const lenR = alongW ? wR : hR;
    const crossR = alongW ? hR : wR;
    const rows = crossR > rowGap * 1.3 ? 2 : 1;
    const perRow = Math.max(1, Math.floor((lenR * 0.84) / pitch));
    const rot = def.rot * DEG + (alongW ? 0 : Math.PI * 0.5);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const seedBase = bridge.id.length * 131 + b * 977;
    for (let row = 0; row < rows; row++) {
      const vOff = rows === 1 ? 0 : (row - (rows - 1) * 0.5) * rowGap;
      // Serie oświetlonych pomieszczeń: długość 2–5, przerwa 1–3.
      let run = 2 + Math.floor(bridgeHash01(seedBase + row * 31, 1) * 4);
      let lit = true;
      for (let i = 0; i < perRow; i++) {
        if (run <= 0) {
          lit = !lit;
          run = lit
            ? 2 + Math.floor(bridgeHash01(seedBase + row * 31 + i, 2) * 4)
            : 1 + Math.floor(bridgeHash01(seedBase + row * 31 + i, 3) * 3);
        }
        run--;
        if (!lit) continue;
        const uOff = (i - (perRow - 1) * 0.5) * pitch + (bridgeHash01(seedBase + i, row + 5) - 0.5) * pitch * 0.18;
        // Punkt w przestrzeni renderu (lokalnej), potem siatka i PNG.
        const lx = def.x * st.scaleX + uOff * c - vOff * s;
        const ly = def.y * st.scaleY + uOff * s + vOff * c;
        const gx = lx + cx;
        const gy = ly + cy;
        const pX = lx / st.scaleX;
        const pY = ly / st.scaleY;
        if (!bridgeZoneContains(def, pX, pY)) continue;
        // Heks pod oknem: najbliższy heks mostka (w granicach jednego heksa).
        let best = null;
        let bestD2 = (R * 1.35) * (R * 1.35);
        let bestCx = 0;
        let bestCy = 0;
        for (let j = 0; j < bridge.shards.length; j++) {
          const sh = bridge.shards[j];
          hexCellCenter(sh.c | 0, sh.r | 0, R, cell);
          const dx = cell.x - gx;
          const dy = cell.y - gy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; best = sh; bestCx = cell.x; bestCy = cell.y; }
        }
        if (!best) continue;
        px.push(pX); py.push(pY);
        shardRef.push(best);
        offX.push(gx - bestCx); offY.push(gy - bestCy);
        bridgeIdx.push(b);
        seed.push(bridgeHash01(seedBase + i * 7 + row * 101, 11));
        // Jasność pomieszczenia: część okien przygaszona (0,35–1).
        const lvl = bridgeHash01(seedBase + i * 13 + row * 57, 23);
        level.push(lvl < 0.22 ? 0.35 + lvl : 0.72 + 0.28 * lvl);
        ang.push(rot);
      }
    }
  }

  const n = px.length;
  st.windows = {
    count: n,
    px: Float32Array.from(px),
    py: Float32Array.from(py),
    offX: Float32Array.from(offX),
    offY: Float32Array.from(offY),
    angle: Float32Array.from(ang),
    seed: Float32Array.from(seed),
    level: Float32Array.from(level),
    bridge: Uint8Array.from(bridgeIdx),
    shard: shardRef,
    delay: new Float32Array(n),        // wypełniane przy utracie dowodzenia
    colorsLinear: colors,              // [r, g, b] liniowo, per mostek
    length: slitLen,
    width: slitWid
  };
  return st.windows;
}

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
