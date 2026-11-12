// Światła nawigacyjne kadłubów — pozycje ze sprite'ów. Na każdy kadłub z SHIP_EDITOR_DEFAULTS sześć punktów na blasze:
// para dziobowa, para na najszerszym elemencie, para rufowa; lewa burta (−y) pierwsza, potem prawa (+y). Układ jak
// markery edytora: px PNG od środka płótna, +x dziób, +y prawa burta (dół obrazka). Promień lampy z długości kadłuba
// w świecie (px PNG, ten sam rozmiar lampy na ekranie niezależnie od rozdzielczości sprite'a).
//
// Tabela jest stała: `src/data/shipNavLights.js` (NAV_LIGHT_POINTS). Nowy kadłub albo nowy sprite → przeliczyć:
//
//   node scripts/lampy-nawigacyjne.mjs [--hull atlas] [--zapisz] [--podglad .tmp/lampy/podglad]
//
// --zapisz wpisuje tabelę do pliku danych (między znacznikami), --podglad zapisuje PNG sprite'ów z lampami.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { decodePng, encodePng } from './webgpu/png.mjs';
import { TRAFFIC_HULLS } from '../src/data/trafficHulls.js';
import { getHullRenderSize } from '../src/data/ships.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'src/data/shipNavLights.js');
const args = process.argv.slice(2);
const argOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const only = argOf('--hull');
const previewDir = argOf('--podglad');

// Kadłuby spoza rejestru ruchu: klucz edytora → sprite i profil renderu (rozmiar w świecie).
const EXTRA = {
  atlas: ['assets/capital_ship_rect_v1.png', 'atlas'],
  terran_supercapital: ['src/assets/ships/terransupercapital.png', 'terran_supercapital'],
  pirate_supercapital: ['src/assets/ships/piratecapital.png', 'pirate_supercapital'],
  capital_carrier: ['assets/carrier.png', 'capital_carrier'],
  megafreighter_front: ['assets/megafreighterfront.png', 'megafreighter']
};

function hullList() {
  const out = new Map();
  for (const [key, [file, profile]] of Object.entries(EXTRA)) out.set(key, { file: join(ROOT, file), profile });
  for (const [id, h] of Object.entries(TRAFFIC_HULLS)) {
    const key = h.editorKey || id;
    if (!out.has(key)) out.set(key, { file: fileURLToPath(h.sprite), profile: id });
  }
  return out;
}

function maskOf(file) {
  const png = decodePng(readFileSync(file));
  const { width: W, height: H, data } = png;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return { W, H, a, png };
}

// Zakres y kolumny bez wysepek: pierwszy i ostatni piksel odcinka co najmniej `minRun` px (antena, rysa alfy się nie liczą).
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

const solid = (m, x, y) => x >= 0 && y >= 0 && x < m.W && y < m.H && m.a[y * m.W + x] === 1;
const crossSolid = (m, x, y, r) => solid(m, x, y) && solid(m, x + r, y) && solid(m, x - r, y) && solid(m, x, y + r) && solid(m, x, y - r);

// Od krawędzi w kolumnie w głąb (dy = ±1): pierwszy piksel kadłuba + `inset`, dalej w głąb, aż krzyż ±r leży na kadłubie.
function inwards(m, x, y, dy, inset, r) {
  let py = Math.round(y);
  for (let k = 0; k < m.H && !solid(m, x, py); k++) py += dy;
  py += dy * inset;
  for (let k = 0; k < m.H && !crossSolid(m, x, py, r); k++) py += dy;
  return py;
}

function pointsFor(key, info) {
  const m = maskOf(info.file);
  const size = getHullRenderSize(info.profile, m.W, m.H);
  const worldPerPx = size.w / m.W;
  // Grubość: wysepki i anteny węższe niż ~1,5 komórki siatki belek (15 j.·skala) nie niosą lampy.
  const minRun = Math.max(6, Math.round(Math.min(m.H * 0.02, 12)));
  const spans = new Array(m.W);
  let xMin = m.W;
  let xMax = -1;
  for (let x = 0; x < m.W; x++) {
    spans[x] = columnSpan(m, x, minRun);
    if (spans[x]) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
  }
  const L = xMax - xMin;
  const widthAt = (x) => (spans[x] ? spans[x].y1 - spans[x].y0 : 0);

  // Najszerszy element: kolumna o największym rozpiętym obrysie w środkowych 70% długości (poza parami dziobu i rufy);
  // remis — bliżej środka.
  let wideX = -1;
  let wideW = -1;
  const mid = (xMin + xMax) / 2;
  for (let x = Math.ceil(xMin + L * 0.15); x <= xMax - L * 0.15; x++) {
    const w = widthAt(x);
    if (w > wideW + 2 || (w >= wideW && Math.abs(x - mid) < Math.abs(wideX - mid))) { wideW = w; wideX = x; }
  }

  // Para dziobowa i rufowa: blisko końca kadłuba, ale nie na iglicy — kolumna, gdzie kadłub ma już ~1/8 szerokości
  // najszerszego miejsca (lampy pary nie zlewają się w jedną).
  const station = (from, dir, frac, maxFrac) => {
    const limit = L * maxFrac;
    let best = Math.round(from);
    let bestW = -1;
    for (let d = 0; d <= limit; d++) {
      const x = Math.round(from + dir * d);
      const w = widthAt(x);
      if (w > bestW) { bestW = w; best = x; }
      if (w >= wideW * frac) return x;
    }
    return best;
  };
  const bowX = station(xMax - L * 0.035, -1, 0.14, 0.3);
  const sternX = station(xMin + L * 0.03, 1, 0.3, 0.3);

  const crossR = Math.max(5, Math.min(8, Math.round(m.W * 0.004)));
  const inset = Math.max(6, Math.round(L * 0.012));
  const cx = m.W / 2;
  const cy = m.H / 2;
  const points = [];
  for (const x of [bowX, wideX, sternX]) {
    const s = spans[x];
    points.push([Math.round(x - cx), Math.round(inwards(m, x, s.y0, 1, inset, crossR) - cy)]);
    points.push([Math.round(x - cx), Math.round(inwards(m, x, s.y1, -1, inset, crossR) - cy)]);
  }
  // Promień lampy w px PNG: 1 j. + 0,12% długości w świecie; edytor przyjmuje lampy pozycyjne do 12 px.
  const radiusWorld = 1 + size.w * 0.0012;
  const radius = Math.max(2, Math.min(12, Math.round((radiusWorld / worldPerPx) * 2) / 2));
  return { key, points, radius, m };
}

function formatTable(rows) {
  const lines = rows.map(({ key, points, radius }) => `  ${key}: { r: ${radius}, p: [${points.map((p) => `[${p[0]}, ${p[1]}]`).join(', ')}] },`);
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
  return lines.join('\n');
}

const COLORS = [[255, 43, 43], [43, 255, 106]];

function writePreview(dir, { key, points, m }) {
  mkdirSync(dir, { recursive: true });
  const step = Math.max(1, Math.ceil(m.W / 1200));
  const W = Math.floor(m.W / step);
  const H = Math.floor(m.H / step);
  const out = new Uint8Array(W * H * 4);
  const src = m.png.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * step * m.W + x * step) * 4;
      const a = src[i + 3] / 255;
      const o = (y * W + x) * 4;
      out[o] = src[i] * a + 24 * (1 - a);
      out[o + 1] = src[i + 1] * a + 24 * (1 - a);
      out[o + 2] = src[i + 2] * a + 34 * (1 - a);
      out[o + 3] = 255;
    }
  }
  const R = 9;
  points.forEach((p, n) => {
    const c = COLORS[n % 2];
    const px = Math.round((p[0] + m.W / 2) / step);
    const py = Math.round((p[1] + m.H / 2) / step);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = (y * W + x) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      }
    }
  });
  writeFileSync(join(dir, `${key}.png`), encodePng({ width: W, height: H, data: out }));
}

const rows = [];
for (const [key, info] of hullList()) {
  if (only && key !== only) continue;
  const row = pointsFor(key, info);
  rows.push(row);
  if (previewDir) writePreview(previewDir, row);
}
const table = formatTable(rows);
if (args.includes('--zapisz')) {
  if (only) throw new Error('--zapisz tylko dla całej tabeli (bez --hull)');
  const text = readFileSync(DATA_FILE, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (!/\/\/ <tabela>[\s\S]*?\/\/ <\/tabela>/.test(text)) throw new Error('brak znaczników tabeli w pliku danych');
  const next = text.replace(/(\/\/ <tabela>)[\s\S]*?(\/\/ <\/tabela>)/, (_, a, b) => `${a}${eol}${table.split('\n').join(eol)}${eol}  ${b}`);
  writeFileSync(DATA_FILE, next);
  console.log(`zapisano ${rows.length} kadłubów do src/data/shipNavLights.js`);
} else {
  console.log(table);
}
