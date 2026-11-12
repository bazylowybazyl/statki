// Lampy pokładowe kadłubów — miejsca ze sprite'ów i danych kadłubów. Małe stałe lampy, które świecą na blachę własnego
// kadłuba (prośba użytkownika 2026-11-11: „mini lampy oświetlające kadłub, np. z mostka i innych elementów”). Wzór:
// scripts/lampy-nawigacyjne.mjs — ta sama lista kadłubów (EXTRA + TRAFFIC_HULLS, klucz edytora), ten sam układ: px PNG
// od środka płótna, +x dziób, +y prawa burta (dół obrazka); piksel lampy = floor(W/2 + x), floor(H/2 + y).
//
// Tabela jest stała: `src/data/shipDeckLights.js` (SHIP_DECK_LIGHTS). Nowy kadłub, nowy sprite, przesunięte gniazdo,
// mostek albo rdzeń → przeliczyć:
//
//   node scripts/lampy-pokladowe.mjs [--hull atlas] [--zapisz] [--podglad .tmp/lampy-pokladowe/podglad]
//
// --zapisz wpisuje tabelę do pliku danych (między znacznikami), --podglad zapisuje PNG sprite'ów z lampami (barwa wg
// rodzaju: mostek błękitny, reaktor fiolet, broń pomarańcz, hangar żółty, kadłub biały; obrysy: strefy mostków
// turkus, obudowa rdzenia fiolet, wieże biały krzyżyk, hangary żółty krzyżyk, dysze niebieskie koła, lampy
// nawigacyjne czerwone / zielone kropki).
//
// REGUŁY (kolejność = pierwszeństwo; razem 6–16 lamp, kadłub krótszy niż DECK_RULES.smallHullWorld j. może mieć mniej).
// „Długość” niżej = długość kadłuba w px PNG (kolumny z alfą), „L” w kodzie `Lpx`.
//   1. MOSTEK (kind 0): para przy bocznych krawędziach strefy mostka (na zewnątrz strefy o mały margines, na środku jej
//      długości; potem bliżej rufowego / dziobowego końca strefy, potem coraz dalej od krawędzi; na końcu pojedyncza
//      lampa przed albo za strefą), do 2 stref — 2–4 lampy. Strefy: BRIDGE_LAYOUT_PROPOSALS (klucz edytora, wariant jak
//      resolveBridgeVariant: `sklad` dla składu megafrachtowca, lokomotywa `megafreighter_front` — strefa `megafreighter`).
//   2. REAKTOR (kind 1): para obok obudowy rdzenia (burty, potem skosy, potem rufa i dziób; odstęp rośnie, gdy miejsce
//      zajęte). Rdzeń: REACTOR_CORE_MARKERS[profil renderu] (kadłuby ruchu — trafficCoreMarker, też rdzenie z automatu),
//      promień obudowy `hr`; bez niego komora `r` (w takiej skali stawia model reactorModelParams), najwyżej 3,5% długości;
//      kadłub bez markera (pirate_supercapital, capital_carrier, megafreighter_front) — ŚRODEK MASY ALFY sprite'a
//      przesunięty na najbliższy piksel ≥ 3% długości od próżni, obudowa 3% długości (gra stawia tam komorę z automatu:
//      autoReactorMarker — najgłębsza komórka przy środku masy). Rdzeń POD strefą mostka (Atlas, fregata piratów) — bez
//      pary: lampy mostka już tam świecą.
//   3. HANGAR (kind 3): jedna lampa na skupisko gniazd `hangar` (promień skupiska 12% długości), obok gniazda najbliższego
//      środkowi skupiska (ku osi, potem rufa / dziób / skosy), do 6 lamp.
//   4. BROŃ (kind 2): jedna lampa na skupisko gniazd `main` / `special` / `special_missile` (promień 7% długości) — obok
//      gniazda najbliższego środkowi skupiska, poza obrysem wieży (ku osi kadłuba, potem rufa / dziób / skosy), do 6
//      lamp; najpierw skupiska najdalsze od lamp już postawionych (z wagą liczby gniazd), żadne bliżej niż 15% długości
//      od innej lampy broni tej samej strony (lewa burta / oś / prawa; między stronami połowa) — dziób pełen wież nie
//      zbiera wszystkich, a lampa wieży w osi nie gasi skupisk na szerokich burtach. Gniazdo „w osi” = |y| < 1,2% długości.
//   5. KADŁUB (kind 4): dopełnienie do 6 lamp wzdłuż grzbietu (środek przekroju kolumny sprite'a, środkowe 80% długości —
//      bez iglicy dziobu i bloku dysz), w osi albo parą po obu stronach osi (pół półszerokości przekroju), zawsze w miejscu
//      najdalszym od lamp już postawionych (równo); potem dalej, dopóki luka przekracza max(10% długości, 40 j. świata).
//   Pary burtowe (mostek, reaktor, skupiska lustrzane, pary grzbietu) wchodzą razem albo wcale — symetria tam, gdzie
//   kadłub i jego gniazda są symetryczne (drugi punkt pary przesuwa się lustrzanie).
//
// ODSTĘPY (każda lampa): piksel na alfie > 127 i co najmniej `edgeMin` px od próżni (max(6 px, r + 3, 0,4% długości) —
// lampa świeci na blachę, nie na krawędź); poza strefami mostków (+ r + 1), poza obudową rdzenia (+ r + 1), poza obrysem
// wież i hangarów (TURRET_WORLD wg klasy uzbrojenia kadłuba × rodzaj gniazda, + r), z dala od lamp nawigacyjnych
// (max(4 r_nav, 4% długości) + r), dysz MAIN (1,5 średnicy wylotu + r — lampa nie siada na bloku silnika) i SIDE (promień
// dzwonu SIDE_NOZZLE_RADIUS × skala klasy × 1,5 + r), a lampy między sobą co najmniej max(6 r, 5% długości).
// Punkt, który nie spełnia warunków, przesuwa się na najbliższe miejsce, które spełnia, nie dalej niż `snapR` px
// (kilka px — 0,6% długości sprite'a, co najmniej 6 px); inaczej idzie następny kandydat.
//
// PROMIEŃ `r` = 0,8 promienia lamp nawigacyjnych tego kadłuba (NAV_LIGHT_POINTS.r — ten sam rozmiar lampy na ekranie
// niezależnie od rozdzielczości sprite'a), zaokrąglony do 0,5 px, co najmniej 2 px.
// `d` = odległość lampy od reaktora (od krawędzi obudowy rdzenia — `coreDistance`) / największa taka odległość na
// kadłubie (fala światła przy rozruchu okrętu); co najmniej jedna lampa ma d ≤ 0,2 (gdy reaktor i mostek nie dały
// takiej — dodatkowa lampa reaktora najbliżej rdzenia).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { decodePng, encodePng } from './webgpu/png.mjs';
import { TRAFFIC_HULLS } from '../src/data/trafficHulls.js';
import { HULL_RENDER_PROFILES, WEAPON_TIER_BY_HULL, getHullRenderSize } from '../src/data/ships.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { ENGINE_FX_DEFAULTS } from '../src/data/engineFx.js';
import { REACTOR_CORE_MARKERS, trafficCoreMarker } from '../src/data/reactorCores.js';
import { BRIDGE_LAYOUT_PROPOSALS } from '../src/game/shipBridge.js';
import { NAV_LIGHT_POINTS } from '../src/data/shipNavLights.js';
import { DECK_LIGHT_KIND as KIND } from '../src/data/shipDeckLights.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'src/data/shipDeckLights.js');

// Kadłuby spoza rejestru ruchu: klucz edytora → sprite i profil renderu (jak scripts/lampy-nawigacyjne.mjs).
export const DECK_HULL_EXTRA = Object.freeze({
  atlas: ['assets/capital_ship_rect_v1.png', 'atlas'],
  terran_supercapital: ['src/assets/ships/terransupercapital.png', 'terran_supercapital'],
  pirate_supercapital: ['src/assets/ships/piratecapital.png', 'pirate_supercapital'],
  capital_carrier: ['assets/carrier.png', 'capital_carrier'],
  megafreighter_front: ['assets/megafreighterfront.png', 'megafreighter']
});

/** Lista kadłubów generatora: klucz edytora → { file, profile, trafficId } (ta sama co lamp nawigacyjnych). */
export function deckHullList() {
  const out = new Map();
  for (const [key, [file, profile]] of Object.entries(DECK_HULL_EXTRA)) out.set(key, { file: join(ROOT, file), profile, trafficId: null });
  for (const [id, h] of Object.entries(TRAFFIC_HULLS)) {
    const key = h.editorKey || id;
    if (!out.has(key)) out.set(key, { file: fileURLToPath(h.sprite), profile: id, trafficId: id });
  }
  return out;
}

/** Stałe reguł (opis w nagłówku pliku). */
export const DECK_RULES = Object.freeze({
  minLamps: 6,
  maxLamps: 16,
  // Kadłub krótszy w świecie (j.) — mniej lamp dopuszczalne (wahadłowiec 120 j., dron naprawczy 96 j.: obrys mostka,
  // obudowa rdzenia, dysze SIDE i lampy nawigacyjne zajmują prawie cały pokład).
  smallHullWorld: 125,
  rFromNav: 0.8,
  hangarCluster: 0.12,
  weaponCluster: 0.07,
  // Lampa broni nie bliżej niż 15% długości od innej lampy broni (dziób pełen wież nie zbiera wszystkich).
  weaponGap: 0.15,
  hangarMax: 6,
  weaponMax: 6,
  // Dopełnienie kadłuba po 6 lampach: dopóki luka na grzbiecie > max(10% długości, gapMinWorld j.) — małe kadłuby
  // nie dostają gęstej siatki lamp.
  gapMax: 0.1,
  gapMinWorld: 40
});

// Promień obrysu wieży [j. świata] wg klasy uzbrojenia kadłuba (WEAPON_TIER_BY_HULL; bez wpisu — Capital): obudowa
// wieży 3D to ~8–22 j. lokalnych × skala działa (weapons3D.js: weapon3DScale), lufy obracają się nad pokładem.
export const TURRET_WORLD = Object.freeze({ S: 11, M: 16, L: 22, Capital: 28 });
const TURRET_TYPE_MUL = Object.freeze({ main: 1, special: 1.3, special_missile: 1.3, hangar: 1, builtin: 1, missile: 0.8, aux: 0.8 });
const SIDE_NOZZLE_RADIUS = 15; // src/3d/sideNozzleFrame.js — promień wylotu dzwonu SIDE przy skali klasy 1
const WEAPON_TYPES = new Set(['main', 'special', 'special_missile']);
const DEG = Math.PI / 180;

function maskOf(file) {
  const png = decodePng(readFileSync(file));
  const { width: W, height: H, data } = png;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return { W, H, a, png, edge: null };
}

// Zakres y kolumny bez wysepek (jak w lampy-nawigacyjne.mjs): pierwszy i ostatni piksel odcinka ≥ `minRun` px.
function columnSpan(m, x, minRun) {
  let y0 = -1;
  let y1 = -1;
  let run = 0;
  for (let y = 0; y < m.H; y++) {
    if (m.a[y * m.W + x]) {
      run++;
      if (run >= minRun) {
        if (y0 < 0) y0 = y - run + 1;
        y1 = y;
      }
    } else run = 0;
  }
  return y0 < 0 ? null : { y0, y1 };
}

// Odległość euklidesowa [px] każdego piksela od najbliższej próżni (alfa ≤ 127 albo poza płótnem) — Felzenszwalb.
function dt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

function edgeDistance(m) {
  if (m.edge) return m.edge;
  const Wp = m.W + 2;
  const Hp = m.H + 2;
  const INF = 1e20;
  const g = new Float64Array(Wp * Hp);
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) g[(y + 1) * Wp + x + 1] = m.a[y * m.W + x] ? INF : 0;
  const n = Math.max(Wp, Hp);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < Wp; x++) {
    for (let y = 0; y < Hp; y++) f[y] = g[y * Wp + x];
    dt1d(f, Hp, d, v, z);
    for (let y = 0; y < Hp; y++) g[y * Wp + x] = d[y];
  }
  const edge = new Float32Array(m.W * m.H);
  for (let y = 0; y < Hp; y++) {
    for (let x = 0; x < Wp; x++) f[x] = g[y * Wp + x];
    dt1d(f, Wp, d, v, z);
    if (y >= 1 && y <= m.H) for (let x = 1; x <= m.W; x++) edge[(y - 1) * m.W + x - 1] = Math.sqrt(d[x]);
  }
  m.edge = edge;
  return edge;
}

/** Strefy mostków kadłuba (px PNG) — klucz edytora jak BRIDGE_LAYOUT_PROPOSALS, wariant jak resolveBridgeVariant. */
function bridgeZonesFor(key) {
  const bridgeKey = key === 'megafreighter_front' ? 'megafreighter' : key;
  const variant = key === 'megafreighter' ? 'sklad' : null;
  const entry = BRIDGE_LAYOUT_PROPOSALS[bridgeKey];
  if (!entry) return [];
  const list = entry.variants[variant || entry.defaultVariant] || [];
  return list.map((z) => ({ x: +z.x, y: +z.y, hw: z.w / 2, hh: z.h / 2, rot: (+z.rot || 0) * DEG, role: z.role || 'primary' }));
}

/**
 * Dane kadłuba potrzebne lampom pokładowym (bez rozstawiania): maska sprite'a, rozmiar w świecie, promienie, gniazda,
 * dysze, strefy mostków, rdzeń, lampy nawigacyjne. Czyta to też test (tests/shipDeckLights.test.mjs).
 */
export function deckHullFeatures(key, info) {
  const m = maskOf(info.file);
  const size = getHullRenderSize(info.profile, m.W, m.H);
  const worldPerPx = size.w / m.W;
  const lengthWorld = Math.max(size.w, size.h);
  const minRun = Math.max(6, Math.round(Math.min(m.H * 0.02, 12)));
  const spans = new Array(m.W);
  let xMin = m.W;
  let xMax = -1;
  for (let x = 0; x < m.W; x++) {
    spans[x] = columnSpan(m, x, minRun);
    if (spans[x]) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
  }
  const Lpx = Math.max(1, xMax - xMin);
  const nav = NAV_LIGHT_POINTS[key] || null;
  const navR = nav ? nav.r : Math.max(2, Math.min(12, Math.round(((1 + size.w * 0.0012) / worldPerPx) * 2) / 2));
  const r = Math.max(2, Math.round(navR * DECK_RULES.rFromNav * 2) / 2);
  const ed = SHIP_EDITOR_DEFAULTS.ships[key] || {};
  const tier = WEAPON_TIER_BY_HULL[info.profile] || 'Capital';
  const turretBasePx = TURRET_WORLD[tier] / worldPerPx;
  const turretPx = (type) => Math.max(14, turretBasePx * (TURRET_TYPE_MUL[type] ?? 1));
  const hardpoints = (ed.hardpoints || []).map((h) => ({ type: String(h.type || 'main'), x: +h.x, y: +h.y }))
    .filter((h) => Number.isFinite(h.x) && Number.isFinite(h.y));
  const traffic = info.trafficId ? TRAFFIC_HULLS[info.trafficId] : null;
  const fxNozzle = ENGINE_FX_DEFAULTS[key]?.mainNozzle || 60;
  const mainNozzles = Array.isArray(traffic?.main) && traffic.main.length
    ? traffic.main.map(([x, y, d]) => ({ x, y, d }))
    : (ed.engines?.main || []).map((e) => ({ x: +e.x, y: +e.y, d: fxNozzle }));
  const sideNozzles = (ed.engines?.side || []).map((e) => ({ x: +e.x, y: +e.y }));
  const atlasLen = Math.max(1, Number(HULL_RENDER_PROFILES.atlas?.length) || 3000);
  const classScale = Math.max(0.3, Math.min(1.25, Math.sqrt((Number(HULL_RENDER_PROFILES[info.profile]?.length) || atlasLen) / atlasLen)));
  const sideR = (SIDE_NOZZLE_RADIUS * classScale * 1.5) / worldPerPx;
  const bridges = bridgeZonesFor(key);
  const core = coreFor(info, m, Lpx);
  return {
    key, info, m, W: m.W, H: m.H, size, worldPerPx, lengthWorld, Lpx, xMin, xMax, spans,
    nav: nav ? nav.p.map(([x, y]) => ({ x, y })) : [], navR, r, tier, turretPx,
    hardpoints, mainNozzles, sideNozzles, sideR, bridges, core
  };
}

function coreFor(info, m, Lpx) {
  const marker = info.trafficId ? trafficCoreMarker(info.trafficId) : REACTOR_CORE_MARKERS[info.profile]?.[0] || null;
  if (marker) {
    // Bez `hr` obudowa idzie w skali komory; komora z automatu bywa ogromna (fregata piratów 246 px — kilka komórek
    // siatki), więc do odstępu lamp najwyżej 3,5% długości.
    const housing = marker.hr > 0 ? marker.hr : Math.min(marker.r > 0 ? marker.r : Infinity, Lpx * 0.035);
    return { x: +marker.x, y: +marker.y, housing, source: marker.hr > 0 ? 'marker' : 'komora' };
  }
  // Środek masy alfy, przesunięty na najbliższy piksel co najmniej 3% długości od próżni (komora z automatu w grze
  // stoi w najgłębszej komórce przy środku masy).
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) if (m.a[y * m.W + x]) { sx += x; sy += y; n++; }
  const cx = sx / Math.max(1, n);
  const cy = sy / Math.max(1, n);
  const edge = edgeDistance(m);
  const want = Lpx * 0.03;
  let best = null;
  let bestD = Infinity;
  for (let y = 0; y < m.H; y += 2) {
    for (let x = 0; x < m.W; x += 2) {
      if (edge[y * m.W + x] < want) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
  }
  const [bx, by] = best || [cx, cy];
  return { x: Math.round(bx - m.W / 2), y: Math.round(by - m.H / 2), housing: Lpx * 0.03, source: 'masa' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rozstawianie
// ---------------------------------------------------------------------------------------------------------------------

function offsetsWithin(R) {
  const out = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) out.push([dx, dy]);
  // Najbliższe najpierw; remis — najpierw −dy (lewa burta; dla drugiej lampy pary snapTo odwraca znak), potem −dx (rufa).
  out.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
  return out;
}

function insideZone(z, x, y, margin) {
  const dx = x - z.x;
  const dy = y - z.y;
  const c = Math.cos(z.rot);
  const s = Math.sin(z.rot);
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  return Math.abs(u) <= z.hw + margin && Math.abs(v) <= z.hh + margin;
}

function zonePoint(z, u, v) {
  const c = Math.cos(z.rot);
  const s = Math.sin(z.rot);
  return [z.x + u * c - v * s, z.y + u * s + v * c];
}

function makeContext(f) {
  const { m, r, Lpx, navR } = f;
  const edge = edgeDistance(m);
  const discs = [];
  const addDisc = (x, y, R) => discs.push({ x, y, R2: R * R });
  addDisc(f.core.x, f.core.y, f.core.housing + r + 1);
  for (const h of f.hardpoints) addDisc(h.x, h.y, f.turretPx(h.type) + r);
  const navClear = Math.max(4 * navR, 0.04 * Lpx) + r;
  for (const p of f.nav) addDisc(p.x, p.y, navClear);
  for (const e of f.mainNozzles) addDisc(e.x, e.y, 1.5 * e.d + r);
  for (const e of f.sideNozzles) addDisc(e.x, e.y, f.sideR + r);
  return {
    f, m, edge, discs,
    edgeMin: Math.max(6, r + 3, 0.004 * Lpx),
    zoneMargin: r + 1,
    spacing: Math.max(6 * r, 0.05 * Lpx),
    snap: offsetsWithin(Math.max(6, Math.round(0.006 * Lpx))),
    lamps: []
  };
}

function clearAt(ctx, x, y) {
  const { m } = ctx;
  const px = Math.floor(m.W / 2 + x);
  const py = Math.floor(m.H / 2 + y);
  if (px < 0 || py < 0 || px >= m.W || py >= m.H) return false;
  if (ctx.edge[py * m.W + px] < ctx.edgeMin) return false;
  for (const z of ctx.f.bridges) if (insideZone(z, x, y, ctx.zoneMargin)) return false;
  for (const d of ctx.discs) if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.R2) return false;
  const s2 = ctx.spacing * ctx.spacing;
  for (const l of ctx.lamps) if ((x - l.x) ** 2 + (y - l.y) ** 2 < s2) return false;
  return true;
}

// Najbliższe miejsce spełniające warunki w promieniu snapR (lustro: dy z przeciwnym znakiem — para burtowa symetryczna).
function snapTo(ctx, x0, y0, mirror = false) {
  const x = Math.round(x0);
  const y = Math.round(y0);
  for (const [dx, dy] of ctx.snap) {
    const px = x + dx;
    const py = y + (mirror ? -dy : dy);
    if (clearAt(ctx, px, py)) return [px, py];
  }
  return null;
}

function place(ctx, xy, kind) {
  const lamp = { x: xy[0], y: xy[1], kind };
  ctx.lamps.push(lamp);
  return lamp;
}

/** Pierwsza para z listy, której oba punkty da się postawić (drugi z lustrem). */
function tryPairs(ctx, pairs, kind) {
  for (const [a, b] of pairs) {
    const pa = snapTo(ctx, a[0], a[1]);
    if (!pa) continue;
    const la = place(ctx, pa, kind);
    const pb = snapTo(ctx, b[0], b[1], true);
    if (pb) return [la, place(ctx, pb, kind)];
    ctx.lamps.pop();
  }
  return null;
}

function trySingles(ctx, points, kind) {
  for (const p of points) {
    const q = snapTo(ctx, p[0], p[1]);
    if (q) return place(ctx, q, kind);
  }
  return null;
}

const room = (ctx) => DECK_RULES.maxLamps - ctx.lamps.length;

function placeBridges(ctx) {
  const { f } = ctx;
  const zones = f.bridges.slice().sort((a, b) => (a.role === 'primary' ? 0 : 1) - (b.role === 'primary' ? 0 : 1)).slice(0, 2);
  const gap = Math.max(3, 0.004 * f.Lpx);
  for (const z of zones) {
    const offX = z.hw + ctx.zoneMargin + gap;
    // Boki strefy: najpierw tuż przy krawędzi, potem dalej od niej (szczeliny alfy wzdłuż nadbudówki, wieże obok).
    const pairs = [];
    for (const extra of [0, 0.012, 0.025, 0.04]) {
      const off = z.hh + ctx.zoneMargin + gap + extra * f.Lpx;
      for (const u of [0, -0.35, 0.35, -0.7, 0.7]) pairs.push([zonePoint(z, u * z.hw, -off), zonePoint(z, u * z.hw, off)]);
    }
    if (tryPairs(ctx, pairs, KIND.BRIDGE)) continue;
    trySingles(ctx, [zonePoint(z, -offX, 0), zonePoint(z, offX, 0), ...pairs.flat()], KIND.BRIDGE);
  }
}

function placeReactor(ctx) {
  const { f } = ctx;
  const c = f.core;
  if (f.bridges.some((z) => insideZone(z, c.x, c.y, 0))) return; // rdzeń pod mostkiem — świecą lampy mostka
  const base = c.housing + ctx.f.r + 1 + Math.max(3, 0.004 * f.Lpx);
  for (const k of [1, 1.35, 1.8, 2.4]) {
    const D = Math.min(base * k, base + 0.08 * f.Lpx);
    const q = D * Math.SQRT1_2;
    const pairs = [
      [[c.x, c.y - D], [c.x, c.y + D]],
      [[c.x - q, c.y - q], [c.x - q, c.y + q]],
      [[c.x + q, c.y - q], [c.x + q, c.y + q]]
    ];
    if (tryPairs(ctx, pairs, KIND.REACTOR)) return;
    // Dziób i rufa obudowy — para nie lustrzana w y (snap bez lustra).
    const pa = snapTo(ctx, c.x - D, c.y);
    if (pa) {
      place(ctx, pa, KIND.REACTOR);
      const pb = snapTo(ctx, c.x + D, c.y);
      if (pb) { place(ctx, pb, KIND.REACTOR); return; }
      ctx.lamps.pop();
    }
  }
}

// Skupiska gniazd: osobno lewa burta, prawa i oś (pary lustrzane wychodzą z tych samych reguł); przydział zachłanny do
// skupiska, którego środek jest bliżej niż R, od dziobu.
function clusters(points, R, axisTol) {
  const groups = [[], [], []];
  for (const p of points) groups[p.y < -axisTol ? 0 : (p.y > axisTol ? 2 : 1)].push(p);
  const out = [];
  groups.forEach((g, gi) => {
    const list = [];
    g.slice().sort((a, b) => b.x - a.x || Math.abs(a.y) - Math.abs(b.y)).forEach((p) => {
      let best = null;
      let bestD = R * R;
      for (const c of list) {
        const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (d <= bestD) { bestD = d; best = c; }
      }
      if (!best) { list.push({ x: p.x, y: p.y, members: [p], side: gi - 1 }); return; }
      best.members.push(p);
      best.x = best.members.reduce((s, q) => s + q.x, 0) / best.members.length;
      best.y = best.members.reduce((s, q) => s + q.y, 0) / best.members.length;
    });
    out.push(...list);
  });
  return out;
}

// Skupiska lewej i prawej burty łączą się w pary lustrzane (ten sam x, y z przeciwnym znakiem, ta sama liczba gniazd).
function pairClusters(list, tol) {
  const port = list.filter((c) => c.side < 0);
  const star = list.filter((c) => c.side > 0);
  const used = new Set();
  const features = [];
  for (const a of port) {
    let best = null;
    let bestD = Infinity;
    for (const b of star) {
      if (used.has(b)) continue;
      const d = Math.abs(a.x - b.x) + Math.abs(a.y + b.y);
      if (d < bestD && Math.abs(a.x - b.x) <= tol && Math.abs(a.y + b.y) <= tol * 1.5) { bestD = d; best = b; }
    }
    if (best) { used.add(best); features.push({ parts: [a, best] }); } else features.push({ parts: [a] });
  }
  for (const b of star) if (!used.has(b)) features.push({ parts: [b] });
  for (const c of list) if (c.side === 0) features.push({ parts: [c] });
  return features;
}

// Kandydaci lampy przy skupisku: obok gniazda najbliższego środkowi, poza obrysem wieży — ku osi, rufa, dziób, skosy.
function clusterCandidates(ctx, c) {
  const anchor = c.members.reduce((best, p) => ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 < (best.x - c.x) ** 2 + (best.y - c.y) ** 2 ? p : best));
  const s = c.side === 0 ? 0 : c.side;
  const R0 = ctx.f.turretPx(anchor.type) + ctx.f.r + Math.max(3, ctx.f.r);
  const dirs = s !== 0
    ? [[0, -s], [-1, 0], [1, 0], [-Math.SQRT1_2, -s * Math.SQRT1_2], [Math.SQRT1_2, -s * Math.SQRT1_2], [0, s]]
    : [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const out = [];
  for (const k of [1, 1.4]) for (const [dx, dy] of dirs) out.push([anchor.x + dx * R0 * k, anchor.y + dy * R0 * k]);
  return out;
}

function placeFeature(ctx, feat, kind) {
  let got = null;
  if (feat.parts.length === 2) {
    const ca = clusterCandidates(ctx, feat.parts[0]);
    const cb = clusterCandidates(ctx, feat.parts[1]);
    got = tryPairs(ctx, ca.map((a, i) => [a, cb[i]]), kind);
  } else {
    const one = trySingles(ctx, clusterCandidates(ctx, feat.parts[0]), kind);
    got = one ? [one] : null;
  }
  if (got) got.forEach((l, i) => { l.side = feat.parts[i].side; });
  return got;
}

function minDistToLamps(ctx, x, y) {
  let best = Infinity;
  for (const l of ctx.lamps) best = Math.min(best, Math.sqrt((x - l.x) ** 2 + (y - l.y) ** 2));
  return best;
}

// Skupiska po kolei: najdalsze od lamp już postawionych (× waga liczby gniazd), do budżetu. Skupisko bliżej niż
// `sameGap` od lampy tego samego rodzaju odpada (lampy broni nie zbijają się na dziobie pełnym wież).
function placeClusters(ctx, points, R, budgetMax, kind, weightPerMember, sameGap) {
  if (!points.length) return;
  const f = ctx.f;
  const feats = pairClusters(clusters(points, R, 0.012 * f.Lpx), 0.05 * f.Lpx);
  let budget = Math.min(budgetMax, room(ctx) - 2);
  // Odstęp pełny w obrębie tej samej strony (lewa burta / oś / prawa), połowa między stronami: lampa wieży w osi nie
  // gasi skupisk na szerokich burtach (Atlas), ale też nie staje tuż obok lampy burtowej.
  const nearSame = (c) => ctx.lamps.some((l) => {
    if (l.kind !== kind) return false;
    const g = l.side === c.side ? sameGap : sameGap * 0.5;
    return (l.x - c.x) ** 2 + (l.y - c.y) ** 2 < g * g;
  });
  while (feats.length && budget > 0) {
    let bi = -1;
    let bs = -Infinity;
    feats.forEach((ft, i) => {
      if (ft.parts.length > budget || ft.parts.some(nearSame)) return;
      const n = ft.parts.reduce((s, c) => s + c.members.length, 0) / ft.parts.length;
      const dist = Math.min(...ft.parts.map((c) => minDistToLamps(ctx, c.x, c.y)));
      const score = (Number.isFinite(dist) ? dist : 1e9) * (1 + weightPerMember * (n - 1));
      if (score > bs) { bs = score; bi = i; }
    });
    if (bi < 0) break;
    const [ft] = feats.splice(bi, 1);
    const got = placeFeature(ctx, ft, kind);
    if (got) budget -= got.length;
  }
}

// Grzbiet: środek przekroju kolumny sprite'a w środkowych 80% długości (bez iglicy dziobu i bloku dysz rufy).
function spineCandidates(ctx) {
  const f = ctx.f;
  const step = Math.max(4, Math.round(0.008 * f.Lpx));
  const out = [];
  for (let x = Math.ceil(f.xMin + 0.1 * f.Lpx); x <= f.xMax - 0.1 * f.Lpx; x += step) {
    const s = f.spans[x];
    if (!s) continue;
    out.push({ x: x - f.W / 2, y: (s.y0 + s.y1) / 2 - f.H / 2, half: (s.y1 - s.y0) / 2 });
  }
  return out;
}

// Dopełnienie: lampa w osi albo para po obu stronach osi (połowa półszerokości przekroju — szerokie kadłuby mają pokład
// z dala od grzbietu); wygrywa miejsce najdalsze od lamp już postawionych, oś z premią ×1,2 (pojedyncza lampa w osi
// zamiast pary). Do 6 lamp zawsze, potem tylko, gdy luka przekracza gapMax długości.
function placeHull(ctx) {
  const f = ctx.f;
  const cands = spineCandidates(ctx);
  const gapMax = Math.max(DECK_RULES.gapMax * f.Lpx, DECK_RULES.gapMinWorld / f.worldPerPx);
  while (room(ctx) > 0) {
    const need = ctx.lamps.length < DECK_RULES.minLamps;
    let best = null;
    let bestD = -1;
    let bestScore = -1;
    for (const c of cands) {
      const p = snapTo(ctx, c.x, c.y);
      if (!p) continue;
      const d = minDistToLamps(ctx, p[0], p[1]);
      const dd = Number.isFinite(d) ? d : 1e9;
      if (dd * 1.2 > bestScore) { bestScore = dd * 1.2; bestD = dd; best = [p]; }
    }
    if (room(ctx) >= 2) {
      for (const c of cands) {
        const pa = snapTo(ctx, c.x, c.y - 0.5 * c.half);
        if (!pa) continue;
        place(ctx, pa, KIND.HULL);
        const pb = snapTo(ctx, c.x, c.y + 0.5 * c.half, true);
        ctx.lamps.pop();
        if (!pb) continue;
        const d = Math.min(minDistToLamps(ctx, pa[0], pa[1]), minDistToLamps(ctx, pb[0], pb[1]));
        const dd = Number.isFinite(d) ? d : 1e9;
        if (dd > bestScore) { bestScore = dd; bestD = dd; best = [pa, pb]; }
      }
    }
    if (!best || (!need && bestD < gapMax)) break;
    for (const p of best) place(ctx, p, KIND.HULL);
  }
}

/**
 * Odległość punktu od reaktora do `d` [px PNG]: od KRAWĘDZI obudowy rdzenia (od środka minus promień obudowy, nie mniej
 * niż 0) — fala rozruchu wychodzi z obudowy; przy dużej obudowie na małym kadłubie (dron naprawczy: obudowa 80 px przy
 * lampie najdalszej ~280 px od środka) odległość od środka nie dałaby żadnej lampy blisko zera.
 */
export function coreDistance(core, x, y) {
  return Math.max(0, Math.sqrt((x - core.x) ** 2 + (y - core.y) ** 2) - core.housing);
}

// Co najmniej jedna lampa z d ≤ 0,2: inaczej lampa reaktora w najbliższym wolnym miejscu przy rdzeniu (na pierścieniach
// od obudowy w górę), w razie braku miejsca w budżecie — za ostatnią lampę kadłuba / broni.
function ensureNearCore(ctx) {
  const c = ctx.f.core;
  const dist = (l) => coreDistance(c, l.x, l.y);
  const ok = () => {
    const ds = ctx.lamps.map(dist);
    const max = Math.max(...ds);
    return ds.some((d) => d <= 0.2 * max - 1);
  };
  if (!ctx.lamps.length || ok()) return;
  if (room(ctx) <= 0) {
    const idx = ctx.lamps.map((l, i) => [l, i]).filter(([l]) => l.kind === KIND.HULL || l.kind === KIND.WEAPON).pop();
    if (idx) ctx.lamps.splice(idx[1], 1);
  }
  const R0 = c.housing + ctx.f.r + 1;
  for (let R = R0; R < 0.15 * ctx.f.Lpx + R0; R += Math.max(4, ctx.f.r)) {
    for (let a = 0; a < 360; a += 10) {
      const x = Math.round(c.x + R * Math.cos((a + 90) * DEG));
      const y = Math.round(c.y + R * Math.sin((a + 90) * DEG));
      if (clearAt(ctx, x, y)) { place(ctx, [x, y], KIND.REACTOR); if (ok()) return; ctx.lamps.pop(); }
    }
  }
}

/** Lampy pokładowe kadłuba: { key, r, points: [[x, y, d, kind]], f }. */
export function deckLightsFor(key, info) {
  const f = deckHullFeatures(key, info);
  const ctx = makeContext(f);
  placeBridges(ctx);
  placeReactor(ctx);
  placeClusters(ctx, f.hardpoints.filter((h) => h.type === 'hangar'), DECK_RULES.hangarCluster * f.Lpx, DECK_RULES.hangarMax, KIND.HANGAR, 0, 0);
  placeClusters(ctx, f.hardpoints.filter((h) => WEAPON_TYPES.has(h.type)), DECK_RULES.weaponCluster * f.Lpx, DECK_RULES.weaponMax, KIND.WEAPON, 0.3, DECK_RULES.weaponGap * f.Lpx);
  placeHull(ctx);
  ensureNearCore(ctx);
  const dists = ctx.lamps.map((l) => coreDistance(f.core, l.x, l.y));
  const max = Math.max(1e-6, ...dists);
  const points = ctx.lamps.map((l, i) => [l.x, l.y, Math.round((dists[i] / max) * 100) / 100, l.kind])
    .sort((a, b) => a[3] - b[3] || b[0] - a[0] || a[1] - b[1]);
  return { key, r: f.r, points, f };
}

function formatTable(rows) {
  const lines = rows.map(({ key, r, points }) => `  ${key}: { r: ${r}, p: [${points.map((p) => `[${p[0]}, ${p[1]}, ${p[2]}, ${p[3]}]`).join(', ')}] },`);
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Podgląd
// ---------------------------------------------------------------------------------------------------------------------

const KIND_COLORS = [[110, 210, 255], [200, 120, 255], [255, 150, 50], [255, 230, 60], [255, 255, 255]];

function writePreview(dir, { key, points, f }) {
  mkdirSync(dir, { recursive: true });
  const m = f.m;
  const step = Math.max(1, Math.ceil(m.W / 1400));
  const W = Math.floor(m.W / step);
  const H = Math.floor(m.H / step);
  const out = new Uint8Array(W * H * 4);
  const src = m.png.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * step * m.W + x * step) * 4;
      const a = src[i + 3] / 255;
      const o = (y * W + x) * 4;
      // Sprite przyciemniony, żeby lampy i obrysy było widać na jasnych kadłubach.
      out[o] = src[i] * a * 0.55 + 24 * (1 - a);
      out[o + 1] = src[i + 1] * a * 0.55 + 24 * (1 - a);
      out[o + 2] = src[i + 2] * a * 0.55 + 34 * (1 - a);
      out[o + 3] = 255;
    }
  }
  const toPx = (x, y) => [(x + m.W / 2) / step, (y + m.H / 2) / step];
  const put = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
  };
  const disc = (x, y, R, c) => { for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) put(x + dx, y + dy, c); };
  const ring = (x, y, R, c) => { const n = Math.max(24, Math.ceil(R * 7)); for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; put(x + Math.cos(a) * R, y + Math.sin(a) * R, c); } };
  const cross = (x, y, R, c) => { for (let k = -R; k <= R; k++) { put(x + k, y, c); put(x, y + k, c); } };
  for (const z of f.bridges) {
    const corners = [[-z.hw, -z.hh], [z.hw, -z.hh], [z.hw, z.hh], [-z.hw, z.hh]].map(([u, v]) => toPx(...zonePoint(z, u, v)));
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 4];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay));
      for (let t = 0; t <= n; t++) put(ax + ((bx - ax) * t) / n, ay + ((by - ay) * t) / n, [60, 230, 210]);
    }
  }
  { const [x, y] = toPx(f.core.x, f.core.y); ring(x, y, f.core.housing / step, [200, 120, 255]); cross(x, y, 4, [200, 120, 255]); }
  for (const h of f.hardpoints) { const [x, y] = toPx(h.x, h.y); cross(x, y, 5, h.type === 'hangar' ? [255, 230, 60] : [235, 235, 235]); ring(x, y, f.turretPx(h.type) / step, [120, 120, 120]); }
  for (const e of f.mainNozzles) { const [x, y] = toPx(e.x, e.y); ring(x, y, e.d / 2 / step, [80, 140, 255]); }
  for (const e of f.sideNozzles) { const [x, y] = toPx(e.x, e.y); ring(x, y, f.sideR / step, [80, 140, 255]); }
  f.nav.forEach((p, i) => { const [x, y] = toPx(p.x, p.y); disc(x, y, 3, i % 2 ? [43, 255, 106] : [255, 43, 43]); });
  for (const [px, py, , kind] of points) {
    const [x, y] = toPx(px, py);
    const R = Math.max(6, Math.round(f.r / step) + 3);
    disc(x, y, R + 2, [0, 0, 0]);
    disc(x, y, R, KIND_COLORS[kind]);
  }
  writeFileSync(join(dir, `${key}.png`), encodePng({ width: W, height: H, data: out }));
}

// ---------------------------------------------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const argOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const only = argOf('--hull');
  const previewDir = argOf('--podglad');
  const rows = [];
  for (const [key, info] of deckHullList()) {
    if (only && key !== only) continue;
    const row = deckLightsFor(key, info);
    rows.push(row);
    if (previewDir) writePreview(resolve(previewDir), row);
    const kinds = [0, 0, 0, 0, 0];
    for (const p of row.points) kinds[p[3]]++;
    console.error(`${key.padEnd(24)} ${String(row.points.length).padStart(2)} lamp  (mostek ${kinds[0]}, reaktor ${kinds[1]}, broń ${kinds[2]}, hangar ${kinds[3]}, kadłub ${kinds[4]})  r ${row.r}  rdzeń: ${row.f.core.source}  ${Math.round(row.f.lengthWorld)} j.`);
  }
  const table = formatTable(rows);
  if (args.includes('--zapisz')) {
    if (only) throw new Error('--zapisz tylko dla całej tabeli (bez --hull)');
    const text = readFileSync(DATA_FILE, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    if (!/\/\/ <tabela>[\s\S]*?\/\/ <\/tabela>/.test(text)) throw new Error('brak znaczników tabeli w pliku danych');
    const next = text.replace(/(\/\/ <tabela>)[\s\S]*?(\/\/ <\/tabela>)/, (_, a, b) => `${a}${eol}${table.split('\n').join(eol)}${eol}  ${b}`);
    writeFileSync(DATA_FILE, next);
    console.log(`zapisano ${rows.length} kadłubów do src/data/shipDeckLights.js`);
  } else {
    console.log(table);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
