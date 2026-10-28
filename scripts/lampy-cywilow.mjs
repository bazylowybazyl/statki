// Lampy pozycyjne cywilnych kadłubów ruchu v2 (E17) — pozycje ze sprite'ów: z alfy (> 0,5) obrysu kadłuba
// w px PNG od środka płótna (+x dziób, +y prawa burta = dół obrazka, jak markery edytora). Wypisuje tabelę do
// `src/data/trafficHullLights.js` (TRAFFIC_HULL_LIGHT_POINTS) — tablica stała, ten skrypt tylko ją liczy na nowo
// (nowy cywil / nowy sprite). Lampa leży na kadłubie (wcięta od krawędzi), więc wiąże się z komórką siatki belek
// (hullMounts.js) i gaśnie z nią.
//
//   node scripts/lampy-cywilow.mjs [--hull container_ship] [--json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePng } from './webgpu/png.mjs';
import { TRAFFIC_HULLS } from '../src/data/trafficHulls.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';

const args = process.argv.slice(2);
const only = args.includes('--hull') ? args[args.indexOf('--hull') + 1] : null;

// Kadłuby robocze (górnicy, holowniki, złomiarz, ratownik…) — pomarańczowe sygnalizatory na burtach rufowej ćwiartki.
const WORK = new Set(['heavy_harvester', 'belter', 'surveyor', 'refinery_tender', 'salvage_hauler', 'construction_tug',
  'repair_drone', 'distress_beacon_ship', 'rescue_ship', 'tanker']);

function civilHulls() {
  return Object.keys(TRAFFIC_HULLS).filter((id) => {
    const h = TRAFFIC_HULLS[id];
    const cfg = SHIP_EDITOR_DEFAULTS.ships[h.editorKey || id];
    return cfg && cfg.sideOnly === true && (!only || id === only);
  });
}

function mask(id) {
  const file = fileURLToPath(TRAFFIC_HULLS[id].sprite);
  const png = decodePng(readFileSync(file));
  const { width: W, height: H, data } = png;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return { W, H, a };
}

// Kolumna x: zakres y kadłuba (pierwszy i ostatni piksel alfy) albo null.
function columnSpan(m, x) {
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < m.H; y++) {
    if (!m.a[y * m.W + x]) continue;
    if (y0 < 0) y0 = y;
    y1 = y;
  }
  return y0 < 0 ? null : { y0, y1 };
}

const solid = (m, x, y) => x >= 0 && y >= 0 && x < m.W && y < m.H && m.a[y * m.W + x] === 1;
// Krzyż ±r px na kadłubie — lampa nie leży na cienkim pręcie ani przy krawędzi (test: ±4 px).
const crossSolid = (m, x, y, r) => solid(m, x, y) && solid(m, x + r, y) && solid(m, x - r, y) && solid(m, x, y + r) && solid(m, x, y - r);

// Najbliższy piksel kadłuba w głąb od (x, y) wzdłuż (dx, dy), o `inset` px dalej (lampa na blasze, nie na krawędzi),
// dalej w głąb, aż krzyż ±6 px leży na kadłubie.
function inwards(m, x, y, dx, dy, inset) {
  let px = Math.round(x);
  let py = Math.round(y);
  for (let k = 0; k < m.W; k++) {
    if (solid(m, px, py)) break;
    px += dx; py += dy;
  }
  px += dx * inset;
  py += dy * inset;
  for (let k = 0; k < 400 && !crossSolid(m, px, py, 6); k++) { px += dx; py += dy; }
  return { x: px, y: py };
}

function lightsFor(id) {
  const m = mask(id);
  // Długość kadłuba: kolumny z alfą.
  let xMin = m.W;
  let xMax = -1;
  for (let x = 0; x < m.W; x++) if (columnSpan(m, x)) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
  const L = xMax - xMin;
  const cx = m.W / 2;
  const cy = m.H / 2;
  // Środek wysokości kadłuba (linia osi) — z kolumny w połowie długości.
  const mid = columnSpan(m, Math.round((xMin + xMax) / 2));
  const axisY = mid ? (mid.y0 + mid.y1) / 2 : cy;
  const inset = Math.max(10, Math.round(L * 0.025));
  const out = [];
  const add = (key, p, color, power = 0.8, radius = 6) => out.push([key, Math.round(p.x - cx), Math.round(p.y - cy), color, power, radius]);
  // Dziób i rufa na osi.
  add('bow', inwards(m, xMax + 2, axisY, -1, 0, inset), 'w');
  add('stern', inwards(m, xMin - 2, axisY, 1, 0, inset), 'w');
  // Burty przy 60% długości (od rufy): czerwona lewa (−y), zielona prawa (+y).
  const xs = Math.round(xMin + L * 0.6);
  const span = columnSpan(m, xs);
  if (span) {
    add('port', inwards(m, xs, span.y0 - 2, 0, 1, inset), 'r');
    add('stbd', inwards(m, xs, span.y1 + 2, 0, -1, inset), 'g');
  }
  // Długie kadłuby — druga para burtowa przy 20% długości (sekwencja „pasa startowego” biegnie wzdłuż kadłuba).
  const xr = Math.round(xMin + L * 0.2);
  const spanR = columnSpan(m, xr);
  if (spanR && !WORK.has(id)) {
    add('port_aft', inwards(m, xr, spanR.y0 - 2, 0, 1, inset), 'r');
    add('stbd_aft', inwards(m, xr, spanR.y1 + 2, 0, -1, inset), 'g');
  }
  // Robocze — sygnalizatory pomarańczowe.
  if (spanR && WORK.has(id)) {
    add('beacon_l', inwards(m, xr, spanR.y0 - 2, 0, 1, inset * 2), 'a', 1.1, 7);
    add('beacon_r', inwards(m, xr, spanR.y1 + 2, 0, -1, inset * 2), 'a', 1.1, 7);
  }
  return out;
}

const table = {};
for (const id of civilHulls()) table[id] = lightsFor(id);
if (args.includes('--json')) {
  console.log(JSON.stringify(table, null, 1));
} else {
  for (const [id, list] of Object.entries(table)) {
    console.log(`  ${id}: [${list.map((l) => `[${JSON.stringify(l[0])}, ${l[1]}, ${l[2]}, '${l[3]}'${l[4] !== 0.8 || l[5] !== 6 ? `, ${l[4]}, ${l[5]}` : ''}]`).join(', ')}],`);
  }
}
