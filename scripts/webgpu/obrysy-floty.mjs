// Generator obrysów kadłubów do modeli 3D: flota (src/3d/ships3d/ships/fleetOutlines3D.js) i kadłuby
// z automatu (autoOutlines3D.js — lotniskowce, superkapitały, myśliwiec, megafrachtowiec, ruch v2).
//
// Z kanału alfa sprite'a gry: kontur płyty kadłuba (zewnętrzny + dziury), gondole silników
// wycięte z płyty (model stawia na ich miejscu walce z tym samym rysunkiem) i — u piratów —
// kolce oddzielone otwarciem morfologicznym (model stawia na ich miejscu ostrosłupy).
// Wynik w PIKSELACH sprite'a, układ modelu: środek płótna = 0, X w prawo (ku dziobowi),
// Y = −y obrazka (w górę). Kontury zewnętrzne CCW, dziury CW.
//
// Użycie: node scripts/webgpu/obrysy-floty.mjs [--podglad] — --podglad zapisuje nakładki
// konturów na sprite'ach do .tmp/obrysy-floty/*.png (kontrola oka).
import { readPng, writePng } from './png.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLEET3D_SPECS, fleetClipKey as clipKey } from '../../src/3d/ships3d/ships/fleetHulls3D.js';
import { AUTO3D_TABLE, autoHullNozzles } from '../../src/3d/ships3d/ships/autoHulls3D.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PREVIEW = process.argv.includes('--podglad');

// Konfiguracja: pods — gondole silników [y środka, x sondy, (x cięcia)] w px OBRAZKA (środek = 0,
// y w dół; sonda leży w gondoli, tuż za rufą kadłuba; bez x cięcia — tam, gdzie zaczyna się
// kadłub), spikes — kolce (promień otwarcia, min. pole).
const SHIPS = {
  terran_battleship: {
    png: 'src/assets/ships/terranbattleship.png', eps: 1.4,
    pods: [[-110, -548], [110, -548], [-215, -505], [213, -505], [0, -546]]
  },
  terran_destroyer: {
    png: 'src/assets/ships/terrandestroyer.png', eps: 1.1,
    pods: [[-132, -312], [132, -312], [-70, -314], [70, -314], [0, -334]]
  },
  terran_frigate: {
    png: 'src/assets/ships/terranfrigate.png', eps: 2.2,
    pods: [[-88, -880], [84, -880]]
  },
  pirate_battleship: {
    png: 'src/assets/ships/piratebattleship.png', eps: 1.8,
    pods: [[-235, -740, -548], [-95, -740, -548], [105, -740, -548], [245, -740, -548]],
    spikes: { r: 18, minArea: 120, minLen: 24 }
  },
  pirate_destroyer: {
    png: 'src/assets/ships/piratedestroyer.png', eps: 1.8,
    pods: [[-187, -770, -578], [0, -830, -578], [190, -770, -578]],
    spikes: { r: 18, minArea: 120, minLen: 24 }
  },
  pirate_frigate: {
    png: 'src/assets/ships/piratefrigate.png', eps: 1.8,
    pods: [[-136, -800, -606], [178, -800, -606]],
    spikes: { r: 17, minArea: 110, minLen: 22 }
  }
};

// ---------------------------------------------------------------------------
// Maska, odległości, składowe
// ---------------------------------------------------------------------------

function alphaMask(img, thr = 128) {
  const { width: W, height: H, data } = img;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = data[i * 4 + 3] > thr ? 1 : 0;
  return m;
}

/** Odległość (chamfer 3-4, /3 ≈ px) do najbliższego piksela z `target(i)` = true. */
function distanceTo(W, H, isTarget) {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = isTarget(i) ? 0 : INF;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - W] + 3);
        if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 3);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < W * H; i++) d[i] /= 3;
  return d;
}

/** Składowe 4-spójne pikseli m[i] === val. */
function components(W, H, m, val = 1) {
  const lab = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (m[s] !== val || lab[s] >= 0) continue;
    const id = comps.length;
    const c = { id, pixels: [], x0: W, y0: H, x1: 0, y1: 0, border: false };
    lab[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      c.pixels.push(i);
      const x = i % W; const y = (i / W) | 0;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.border = true;
      if (x > 0 && m[i - 1] === val && lab[i - 1] < 0) { lab[i - 1] = id; stack.push(i - 1); }
      if (x < W - 1 && m[i + 1] === val && lab[i + 1] < 0) { lab[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && m[i - W] === val && lab[i - W] < 0) { lab[i - W] = id; stack.push(i - W); }
      if (y < H - 1 && m[i + W] === val && lab[i + W] < 0) { lab[i + W] = id; stack.push(i + W); }
    }
    comps.push(c);
  }
  return { lab, comps };
}

/** Porządki: wyspy < minIsland px usunięte, dziury < minHole px zalane. */
function clean(W, H, m, minIsland, minHole) {
  for (const c of components(W, H, m, 1).comps) if (c.pixels.length < minIsland) for (const i of c.pixels) m[i] = 0;
  for (const c of components(W, H, m, 0).comps) if (!c.border && c.pixels.length < minHole) for (const i of c.pixels) m[i] = 1;
}

// ---------------------------------------------------------------------------
// Gondole silników
// ---------------------------------------------------------------------------

function fitPod(W, H, m, yImg, xProbe, xCutImg = null) {
  const cx = Math.round(xProbe + W / 2);
  const cy = Math.round(yImg + H / 2);
  if (!m[cy * W + cx]) throw new Error(`sonda gondoli (${xProbe}, ${yImg}) poza maską`);
  const run = (x, y) => {
    let a = y; let b = y;
    while (a > 0 && m[(a - 1) * W + x]) a--;
    while (b < H - 1 && m[(b + 1) * W + x]) b++;
    return [a, b];
  };
  const [ya, yb] = run(cx, cy);
  const r = (yb - ya + 1) / 2;
  const yc = (ya + yb + 1) / 2;
  const row = Math.round(yc);
  let x0 = cx;
  while (x0 > 0 && m[row * W + x0 - 1]) x0--;
  // Kadłub zaczyna się tam, gdzie kolumna maski wychodzi poza pas gondoli.
  let xCut = cx;
  const lo = yc - r * 1.25; const hi = yc + r * 1.25;
  if (xCutImg != null) xCut = Math.round(xCutImg + W / 2); // cięcie wymuszone (bęben + obudowa do kadłuba)
  else {
    while (xCut < W - 1) {
      const [a, b] = run(xCut, row);
      if (a < lo || b > hi) break;
      xCut++;
    }
  }
  // Wycięcie gondoli z płyty (pas z zapasem 1 px).
  for (let y = Math.max(0, Math.floor(yc - r - 1)); y <= Math.min(H - 1, Math.ceil(yc + r + 1)); y++) {
    for (let x = Math.max(0, x0 - 2); x < xCut; x++) m[y * W + x] = 0;
  }
  return { x0: x0 - W / 2, xCut: xCut - W / 2, y: -(yc - H / 2), r };
}

// ---------------------------------------------------------------------------
// Kolce (otwarcie morfologiczne: płyta = otwarcie ∪ krótkie resztki, kolce = długie resztki)
// ---------------------------------------------------------------------------

function splitSpikes(W, H, m, o) {
  const dBg = distanceTo(W, H, (i) => !m[i]);
  const eroded = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) eroded[i] = dBg[i] > o.r ? 1 : 0;
  const dEr = distanceTo(W, H, (i) => eroded[i] === 1);
  const open = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) open[i] = m[i] && dEr[i] <= o.r + 0.5 ? 1 : 0;
  const rest = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) rest[i] = m[i] && !open[i] ? 1 : 0;
  const dOpen = distanceTo(W, H, (i) => open[i] === 1);
  const spikes = [];
  for (const c of components(W, H, rest, 1).comps) {
    let far = 0; let tip = -1;
    for (const i of c.pixels) if (dOpen[i] > far) { far = dOpen[i]; tip = i; }
    if (c.pixels.length < o.minArea || far < o.minLen) continue; // róg płyty — zostaje w płycie
    let sx = 0; let sy = 0; let n = 0;
    for (const i of c.pixels) if (dOpen[i] <= 2.5) { sx += i % W; sy += (i / W) | 0; n++; }
    if (!n) continue;
    const spikeMask = new Uint8Array(W * H);
    for (const i of c.pixels) { spikeMask[i] = 1; m[i] = 0; }
    const loops = traceLoops(W, H, spikeMask).filter((l) => l.area > 0);
    if (!loops.length) continue;
    loops.sort((a, b) => b.area - a.area);
    spikes.push({
      poly: simplifyLoop(loops[0].pts, 1.2),
      a: [sx / n + 0.5 - W / 2, -(sy / n + 0.5 - H / 2)],
      t: [(tip % W) + 0.5 - W / 2, -(((tip / W) | 0) + 0.5 - H / 2)]
    });
  }
  return spikes;
}

// ---------------------------------------------------------------------------
// Kontury (krawędzie pikseli, CCW w układzie modelu) i upraszczanie
// ---------------------------------------------------------------------------

function traceLoops(W, H, m) {
  const W1 = W + 1;
  const next = new Map(); // start → [końce]
  const add = (x0, y0, x1, y1) => {
    const k = y0 * W1 + x0;
    const v = y1 * W1 + x1;
    const l = next.get(k);
    if (l) l.push(v); else next.set(k, [v]);
  };
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? m[y * W + x] : 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (!at(x, y - 1)) add(x + 1, y, x, y);         // góra: na zachód
      if (!at(x, y + 1)) add(x, y + 1, x + 1, y + 1); // dół: na wschód
      if (!at(x - 1, y)) add(x, y, x, y + 1);         // lewo: na południe (obrazka)
      if (!at(x + 1, y)) add(x + 1, y + 1, x + 1, y); // prawo: na północ
    }
  }
  const loops = [];
  for (const [start] of next) {
    while (next.get(start)?.length) {
      const pts = [];
      let k = start;
      let prevDir = null;
      for (let guard = 0; guard < 10000000; guard++) {
        const x = k % W1; const y = (k / W1) | 0;
        pts.push([x, y]);
        const outs = next.get(k);
        if (!outs || !outs.length) break;
        let pick = 0;
        if (outs.length > 1 && prevDir) {
          // Wierzchołek szachownicy: skręt w prawo (w układzie obrazka) — piksele stykające się
          // rogiem trafiają do osobnych pętli.
          let best = -Infinity;
          outs.forEach((v, i) => {
            const dx = (v % W1) - x; const dy = ((v / W1) | 0) - y;
            const cross = prevDir[0] * dy - prevDir[1] * dx;
            if (cross > best) { best = cross; pick = i; }
          });
        }
        const v = outs.splice(pick, 1)[0];
        prevDir = [(v % W1) - x, ((v / W1) | 0) - y];
        k = v;
        if (k === start) break;
      }
      // Układ modelu: środek = 0, Y w górę.
      const P = pts.map(([x, y]) => [x - W / 2, -(y - H / 2)]);
      loops.push({ pts: P, area: polyArea(P) });
    }
  }
  return loops;
}

function polyArea(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i]; const b = P[(i + 1) % P.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function dp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a]; const [bx, by] = pts[b];
    const dx = bx - ax; const dy = by - ay;
    const L = Math.hypot(dx, dy) || 1;
    let best = -1; let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Pętla zamknięta: schodki pikseli → wielokąt (Douglas–Peucker od dwóch odległych punktów). */
function simplifyLoop(pts, eps) {
  // Środki krawędzi schodków zamiast narożników — gładszy wynik.
  const mid = pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; });
  let far = 0; let fi = 0;
  for (let i = 1; i < mid.length; i++) {
    const d = Math.hypot(mid[i][0] - mid[0][0], mid[i][1] - mid[0][1]);
    if (d > far) { far = d; fi = i; }
  }
  const a = dp(mid.slice(0, fi + 1), eps);
  const b = dp(mid.slice(fi).concat([mid[0]]), eps);
  const out = a.concat(b.slice(1, -1));
  return out.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

function pointIn(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Bryły przycinane do obrysu (spec.blocks z clip: true): wielokąt (px obrazka) ∩ maska płyty
// → kontury zewnętrzne z dziurami. Klucz = sygnatura wielokąta (builder sprawdza zgodność).
// ---------------------------------------------------------------------------

function clipBlock(W, H, m, polyImg, eps) {
  const xs = polyImg.map((p) => p[0] + W / 2);
  const ys = polyImg.map((p) => p[1] + H / 2);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))); const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))); const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  const PP = polyImg.map(([x, y]) => [x + W / 2, y + H / 2]);
  const bm = new Uint8Array(W * H);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (m[i] && pointIn(x + 0.5, y + 0.5, PP)) bm[i] = 1;
    }
  }
  clean(W, H, bm, 120, 60);
  const loops = traceLoops(W, H, bm);
  const outers = loops.filter((l) => l.area > 0);
  const holes = loops.filter((l) => l.area < 0);
  const res = outers.map((o) => ({ outer: simplifyLoop(o.pts, eps), holes: [], _raw: o.pts }));
  for (const h of holes) {
    const hp = simplifyLoop(h.pts, eps);
    if (hp.length < 3) continue;
    const [hx, hy] = h.pts[0];
    const owner = res.find((p) => pointIn(hx + 0.25, hy - 0.25, p._raw));
    if (owner) owner.holes.push(hp);
  }
  return res.map((r) => ({ outer: r.outer, holes: r.holes }));
}

// ---------------------------------------------------------------------------
// Podgląd (nakładka konturów na sprite)
// ---------------------------------------------------------------------------

function drawPreview(img, out, file) {
  const { width: W, height: H } = img;
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = img.data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(img.data[i * 4 + c] * a * 0.55 + 30 * (1 - a));
    data[i * 4 + 3] = 255;
  }
  const put = (x, y, r, g, b) => {
    const px = Math.round(x + W / 2); const py = Math.round(-y + H / 2);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const X = px + ox; const Y = py + oy;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const o = (Y * W + X) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b;
    }
  };
  const line = (p, q, col) => {
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])));
    for (let i = 0; i <= n; i++) put(p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n, ...col);
  };
  const loop = (P, col) => P.forEach((p, i) => line(p, P[(i + 1) % P.length], col));
  for (const pl of out.plates) { loop(pl.outer, [60, 255, 120]); for (const h of pl.holes) loop(h, [255, 220, 60]); }
  for (const p of out.pods) loop([[p.x0, p.y - p.r], [p.xCut, p.y - p.r], [p.xCut, p.y + p.r], [p.x0, p.y + p.r]], [80, 200, 255]);
  for (const s of out.spikes) { loop(s.poly, [255, 80, 200]); line(s.a, s.t, [255, 255, 255]); }
  for (const bl of out.blocks || []) for (const pt of bl.parts) { loop(pt.outer, [255, 150, 40]); for (const h of pt.holes) loop(h, [255, 150, 40]); }
  writePng(file, { width: W, height: H, data });
}

// ---------------------------------------------------------------------------

const result = {};
for (const [id, cfg] of Object.entries(SHIPS)) {
  const img = readPng(resolve(repo, cfg.png));
  const { width: W, height: H } = img;
  const m = alphaMask(img);
  clean(W, H, m, 60, 150);
  const pods = (cfg.pods || []).map(([y, x, cut]) => fitPod(W, H, m, y, x, cut ?? null));
  const spikes = cfg.spikes ? splitSpikes(W, H, m, cfg.spikes) : [];
  clean(W, H, m, 200, 150);
  const loops = traceLoops(W, H, m);
  const outers = loops.filter((l) => l.area > 0).sort((a, b) => b.area - a.area);
  const holes = loops.filter((l) => l.area < 0);
  const plates = outers.map((o) => ({ outer: simplifyLoop(o.pts, cfg.eps), holes: [], _raw: o.pts, area: o.area }));
  for (const h of holes) {
    const hp = simplifyLoop(h.pts, cfg.eps);
    if (hp.length < 3) continue;
    const [x, y] = h.pts[0];
    const owner = plates.find((p) => pointIn(x + 0.25, y - 0.25, p._raw) || pointIn(x, y, p.outer));
    if (owner) owner.holes.push(hp);
  }
  for (const p of plates) delete p._raw;
  // Bryły przycinane do obrysu (i ich odbicia względem osi).
  const blocks = [];
  const spec = FLEET3D_SPECS[id];
  const ax = spec?.axisY || 0;
  for (const b of spec?.blocks || []) {
    if (!b.clip) continue;
    const list = b.mirror ? [b.poly, b.poly.map(([x, y]) => [x, 2 * ax - y]).reverse()] : [b.poly];
    for (const poly of list) blocks.push({ key: clipKey(poly), name: b.name, parts: clipBlock(W, H, m, poly, cfg.eps) });
  }
  result[id] = {
    sprite: [W, H],
    plates: plates.map((p) => ({ outer: p.outer, holes: p.holes })),
    pods: pods.map((p) => ({ x0: +p.x0.toFixed(1), xCut: +p.xCut.toFixed(1), y: +p.y.toFixed(1), r: +p.r.toFixed(1) })),
    spikes,
    blocks
  };
  const nv = plates.reduce((s, p) => s + p.outer.length + p.holes.reduce((q, h) => q + h.length, 0), 0);
  console.log(`${id}: płyty ${plates.length} (${plates.map((p) => Math.round(p.area)).join(', ')} px²), dziury ${plates.reduce((s, p) => s + p.holes.length, 0)}, wierzchołki ${nv}, gondole ${pods.length}, kolce ${spikes.length}`);
  if (PREVIEW) {
    mkdirSync(resolve(repo, '.tmp/obrysy-floty'), { recursive: true });
    drawPreview(img, result[id], resolve(repo, `.tmp/obrysy-floty/${id}.png`));
  }
}

const fmt = (P) => `[${P.map(([x, y]) => `[${x}, ${y}]`).join(', ')}]`;
let src = `// src/3d/ships3d/ships/fleetOutlines3D.js — WYGENEROWANE przez scripts/webgpu/obrysy-floty.mjs (nie edytować ręcznie).
//
// Obrysy kadłubów floty z kanału alfa sprite'ów gry (px sprite'a, środek płótna = 0, Y = −y
// obrazka): płyty (kontur zewnętrzny CCW + dziury CW), gondole silników wycięte z płyty
// (x0 — rufa gondoli, xCut — początek kadłuba, y, r), kolce (wielokąt, podstawa a, czubek t)
// i bryły nadbudówek przycięte do obrysu (spec.blocks z clip: true; key = wielokąt źródłowy
// w px obrazka — builder sprawdza, czy obrysy są aktualne). Model 3D: src/3d/ships3d/ships/fleetHull3D.js.

export const FLEET3D_OUTLINES = {\n`;
for (const [id, d] of Object.entries(result)) {
  src += `  ${id}: {\n    sprite: [${d.sprite[0]}, ${d.sprite[1]}],\n    plates: [\n`;
  for (const p of d.plates) {
    src += `      {\n        outer: ${fmt(p.outer)},\n        holes: [${p.holes.map(fmt).join(',\n          ')}]\n      },\n`;
  }
  src += `    ],\n    pods: [${d.pods.map((p) => `{ x0: ${p.x0}, xCut: ${p.xCut}, y: ${p.y}, r: ${p.r} }`).join(', ')}],\n`;
  src += `    spikes: [${d.spikes.map((s) => `\n      { a: [${s.a.map((v) => +v.toFixed(1)).join(', ')}], t: [${s.t.map((v) => +v.toFixed(1)).join(', ')}], poly: ${fmt(s.poly)} }`).join(',')}${d.spikes.length ? '\n    ' : ''}],\n`;
  src += `    blocks: [${d.blocks.map((bl) => `\n      { name: ${JSON.stringify(bl.name)}, key: ${JSON.stringify(bl.key)}, parts: [${bl.parts.map((pt) => `{ outer: ${fmt(pt.outer)}, holes: [${pt.holes.map(fmt).join(', ')}] }`).join(', ')}] }`).join(',')}${d.blocks.length ? '\n    ' : ''}]\n  },\n`;
}
src += '};\n';
writeFileSync(resolve(repo, 'src/3d/ships3d/ships/fleetOutlines3D.js'), src);
console.log('zapisano src/3d/ships3d/ships/fleetOutlines3D.js');

// ===========================================================================
// KADŁUBY Z AUTOMATU (src/3d/ships3d/ships/autoHulls3D.js → autoOutlines3D.js): płyta z alfy,
// gondole w miejscu dysz MAIN, tarasy nadbudówek z mapy odległości od krawędzi, oś i kil.
// ===========================================================================

const AUTO_TIERS = [{ f: 0.28, z: 6.5, bevel: 0.7 }, { f: 0.6, z: 10, bevel: 0.9 }];

// Gondole z dysz: dysze grupowane w pionie (stykające się gondole — jeden pas), rufa gondoli =
// pierwszy piksel alfy w wierszu dyszy, początek kadłuba = kolumna, w której alfa wychodzi poza
// pas grupy. Za krótka gondola (< 0,9 r) — sama dysza na ścianie rufy (bell).
function autoPods(W, H, m, nozzles) {
  const pods = []; const bells = [];
  const sorted = nozzles.slice().sort((a, b) => a.y - b.y);
  const groups = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    const last = g && g[g.length - 1];
    if (last && Math.abs(n.y - last.y) < (n.d + last.d) * 0.5 * 1.35) g.push(n); else groups.push([n]);
  }
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? m[y * W + x] : 0);
  for (const g of groups) {
    const items = g.map((n) => {
      const row = Math.round(n.y + H / 2);
      let x0 = 0;
      while (x0 < W && !at(x0, row)) x0++;
      return { n, x0, row, r: n.d * 0.55 };
    }).filter((it) => it.x0 < W);
    if (!items.length) continue;
    const rMax = Math.max(...items.map((it) => it.r));
    const lo = Math.min(...items.map((it) => it.row - it.r));
    const hi = Math.max(...items.map((it) => it.row + it.r));
    const xs = Math.max(...items.map((it) => it.x0)) + Math.round(rMax * 0.6);
    let xCut = xs;
    const frac = (x, ya, yb) => {
      let n = 0; let k = 0;
      for (let y = Math.max(0, Math.round(ya)); y <= Math.min(H - 1, Math.round(yb)); y++) { k++; if (at(x, y)) n++; }
      return k ? n / k : 0;
    };
    for (; xCut < Math.min(W - 1, xs + rMax * 8); xCut++) {
      if (frac(xCut, lo - 1.1 * rMax, lo - 0.3 * rMax) > 0.35 || frac(xCut, hi + 0.3 * rMax, hi + 1.1 * rMax) > 0.35) break;
    }
    const x0g = Math.min(...items.map((it) => it.x0));
    if (xCut - x0g < rMax * 0.9) {
      for (const it of items) bells.push({ x: it.x0 - W / 2, y: -(it.row - H / 2), r: it.r * 0.82 });
      continue;
    }
    for (let y = Math.max(0, Math.floor(lo - 1)); y <= Math.min(H - 1, Math.ceil(hi + 1)); y++) {
      for (let x = Math.max(0, x0g - 2); x < xCut; x++) m[y * W + x] = 0;
    }
    for (const it of items) pods.push({ x0: +(it.x0 - W / 2).toFixed(1), xCut: +(xCut - W / 2).toFixed(1), y: +(-(it.row - H / 2)).toFixed(1), r: +it.r.toFixed(1) });
  }
  return { pods, bells };
}

/** Kontury maski (zewnętrzne z dziurami) w układzie modelu. */
function maskParts(W, H, mask, eps) {
  const loops = traceLoops(W, H, mask);
  const outers = loops.filter((l) => l.area > 0).sort((a, b) => b.area - a.area);
  const holes = loops.filter((l) => l.area < 0);
  const res = outers.map((o) => ({ outer: simplifyLoop(o.pts, eps), holes: [], _raw: o.pts, area: o.area }));
  for (const h of holes) {
    const hp = simplifyLoop(h.pts, eps);
    if (hp.length < 3) continue;
    const [hx, hy] = h.pts[0];
    const owner = res.find((p) => pointIn(hx + 0.25, hy - 0.25, p._raw) || pointIn(hx, hy, p.outer));
    if (owner) owner.holes.push(hp);
  }
  return res.filter((r) => r.outer.length >= 3).map((r) => ({ outer: r.outer, holes: r.holes, area: r.area }));
}

const AUTO = {};
for (const [id, t] of Object.entries(AUTO3D_TABLE)) {
  if (t.outlineOf) continue;
  const img = readPng(resolve(repo, t.sprite));
  const { width: W, height: H } = img;
  const m = alphaMask(img);
  clean(W, H, m, 60, 150);
  let x0 = W; let x1 = 0; let y0 = H; let y1 = 0;
  for (let i = 0; i < W * H; i++) {
    if (!m[i]) continue;
    const x = i % W; const y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const beam = y1 - y0 + 1;
  const eps = Math.max(1.2, beam / 260);
  const { pods, bells } = autoPods(W, H, m, autoHullNozzles(id));
  clean(W, H, m, Math.max(200, beam * beam * 0.002), 150);
  // Oś kadłuba: środek masy maski (y) — kil ściska się ku niej.
  let sy = 0; let n = 0;
  for (let i = 0; i < W * H; i++) if (m[i]) { sy += (i / W) | 0; n++; }
  const axisY = -((sy / n + 0.5) - H / 2);
  const plates = maskParts(W, H, m, eps);
  // Tarasy: odległość od krawędzi płyty ≥ f · max; drobne wyspy (< 0,3% płyty) odpadają.
  const dist = distanceTo(W, H, (i) => !m[i]);
  let maxD = 0;
  for (let i = 0; i < W * H; i++) if (dist[i] > maxD) maxD = dist[i];
  const plateArea = plates.reduce((s, p) => s + p.area, 0);
  const tiers = (t.tiers || AUTO_TIERS).map((tier) => {
    const tm = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) tm[i] = dist[i] >= tier.f * maxD ? 1 : 0;
    clean(W, H, tm, plateArea * 0.003, 60);
    return { z: tier.z, bevel: tier.bevel ?? 0.7, parts: maskParts(W, H, tm, eps * 1.4).map((p) => ({ outer: p.outer, holes: p.holes })) };
  });
  AUTO[id] = {
    sprite: [W, H],
    bbox: [x0 - W / 2, -(y1 + 1 - H / 2), x1 + 1 - W / 2, -(y0 - H / 2)],
    axisY: +axisY.toFixed(1),
    plates: plates.map((p) => ({ outer: p.outer, holes: p.holes })),
    pods,
    bells: bells.map((b) => ({ x: +b.x.toFixed(1), y: +b.y.toFixed(1), r: +b.r.toFixed(1) })),
    tiers
  };
  const nh = plates.reduce((s, p) => s + p.holes.length, 0);
  console.log(`[auto] ${id}: płyty ${plates.length}, dziury ${nh}, gondole ${pods.length}, dysze na ścianie ${bells.length}, tarasy ${tiers.map((q) => q.parts.length).join('/')}`);
  if (PREVIEW) {
    mkdirSync(resolve(repo, '.tmp/obrysy-floty'), { recursive: true });
    drawPreview(img, { plates: AUTO[id].plates, pods, spikes: [], blocks: tiers.map((q) => ({ parts: q.parts })) }, resolve(repo, `.tmp/obrysy-floty/auto_${id}.png`));
  }
}

let asrc = `// src/3d/ships3d/ships/autoOutlines3D.js — WYGENEROWANE przez scripts/webgpu/obrysy-floty.mjs (nie edytować ręcznie).
//
// Obrysy kadłubów z automatu (autoHulls3D.js) z kanału alfa sprite'ów gry, px sprite'a, środek
// płótna = 0, Y = −y obrazka: płyty (kontur CCW + dziury CW), gondole (x0 — rufa, xCut — początek
// kadłuba, y, r), dysze na ścianie rufy bez gondoli (bells), tarasy nadbudówek (z w hu, części z
// dziurami), oś kadłuba (axisY) i obrys alfy (bbox: x0, y0, x1, y1). Model 3D: autoHull3D.js.

export const AUTO3D_OUTLINES = {\n`;
const part = (p) => `{ outer: ${fmt(p.outer)}, holes: [${p.holes.map(fmt).join(', ')}] }`;
for (const [id, d] of Object.entries(AUTO)) {
  asrc += `  ${id}: {\n    sprite: [${d.sprite.join(', ')}], bbox: [${d.bbox.join(', ')}], axisY: ${d.axisY},\n`;
  asrc += `    plates: [\n      ${d.plates.map(part).join(',\n      ')}\n    ],\n`;
  asrc += `    pods: [${d.pods.map((p) => `{ x0: ${p.x0}, xCut: ${p.xCut}, y: ${p.y}, r: ${p.r} }`).join(', ')}],\n`;
  asrc += `    bells: [${d.bells.map((b) => `{ x: ${b.x}, y: ${b.y}, r: ${b.r} }`).join(', ')}],\n`;
  asrc += `    tiers: [\n${d.tiers.map((q) => `      { z: ${q.z}, bevel: ${q.bevel}, parts: [${q.parts.map(part).join(', ')}] }`).join(',\n')}\n    ]\n  },\n`;
}
asrc += '};\n';
writeFileSync(resolve(repo, 'src/3d/ships3d/ships/autoOutlines3D.js'), asrc);
console.log('zapisano src/3d/ships3d/ships/autoOutlines3D.js');
