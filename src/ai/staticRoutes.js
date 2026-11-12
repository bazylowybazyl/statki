// src/ai/staticRoutes.js
//
// TRASY WOKÓŁ BUDOWLI (2026-10-28, zgłoszenie użytkownika: „supercapital wbija się w habitat … zamiast okrążyć budowlę
// stara się przez nie przejść, nie działa zbyt dobrze pathfinding”). Omijanie lokalne pilota (capitalAI.js: ogranicznik
// przed przeszkodą, objazd po stycznej NAJBLIŻSZEJ kapsuły) utyka w zespole budowli: pomosty bazy piratów to
// kilkukilometrowe ściany (poprzeczka T 8,4 km, trzon ~9 km przez habitat), a objazd jednej kapsuły prowadzi w następną.
// Pomiar na prawdziwej geometrii bazy (2026-10-28): z samymi kapsułami herszt, pancernik i fregata Terra Novy stawali
// przed bazą (v = 0, 180 s bez dolotu), bez nich przelatywali przez budowle.
//
// GRAF WIDOCZNOŚCI nad przeszkodami STATYCZNYMI indeksu AI (aiWreckIndex.js — kapsuły budowli; wraki i okręty zostają
// omijaniu lokalnemu): kapsuła poszerzona o luz okrętu (pół-szerokość korytarza + `pad`), węzły na jej obrysie (końce co
// 45°, koło — 8), krawędź = odcinek, który nie wchodzi w żadną poszerzoną kapsułę. Cel za budowlą (odcinek okręt → cel
// przecina poszerzoną kapsułę) → najkrótsza droga (Dijkstra); pilot leci do NAJDALSZEGO punktu trasy widocznego z okrętu
// (bez zygzaka po węzłach), a ogranicznik, objazd okrętów i wraków i separacja działają jak dotąd. Kapsuły, w których
// okręt albo cel już są, nie zasłaniają (wyjście spod pomostu, cel przy budowli, taran budowli). Graf raz na zestaw
// budowli (index.staticsVer) i kubełek luzu (klasa okrętu); trasa okrętu od nowa co `replanCalls` wywołań, po ruchu celu
// o `goalMove` albo gdy żaden jej punkt nie jest widoczny. W stanie ustalonym bez alokacji (tablice typowane).

import { getWreckIndex } from './aiWreckIndex.js';

export const STATIC_ROUTE_TUNE = {
  enabled: true,
  pad: 200,         // [j.] luz trasy ponad pół-szerokość korytarza okrętu (ogranicznik lokalny bierze +90 — trasa leży poza nim)
  nodeK: 1.09,      // węzły na obrysie: promień poszerzonej kapsuły × nodeK + nodeExtra (cięciwa między węzłami łuku
  nodeExtra: 40,    //   co 45° leży 0,924 promienia od jego środka — musi zostać poza kapsułą)
  bucket: 40,       // [j.] kubełek luzu — jeden graf na klasę okrętu
  replanCalls: 40,  // trasa od nowa co tyle wywołań pilota (mózg: takt 20 Hz → 2 s)
  goalMove: 400,    // … albo po ruchu celu o tyle [j.]
  maxPts: 48        // najwięcej punktów trasy okrętu
};

const EPS = 1e-9;

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// Kwadrat odległości odcinków P1Q1 i P2Q2 (Ericson, „Real-Time Collision Detection”, 5.1.9).
function segSegDist2(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s = 0;
  let t = 0;
  if (a > EPS || e > EPS) {
    if (a <= EPS) {
      t = clamp01(f / e);
    } else {
      const c = d1x * rx + d1y * ry;
      if (e <= EPS) {
        s = clamp01(-c / a);
      } else {
        const b = d1x * d2x + d1y * d2y;
        const den = a * e - b * b;
        s = den > EPS ? clamp01((b * f - c * e) / den) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
      }
    }
  }
  const cx = p1x + d1x * s - p2x - d2x * t;
  const cy = p1y + d1y * s - p2y - d2y * t;
  return cx * cx + cy * cy;
}

function newGraph() {
  return {
    ver: -1, clr: 0, m: 0, n: 0,
    // poszerzone kapsuły: środek, oś, pół-długość, promień (pół-szerokość + luz)
    cx: new Float64Array(0), cy: new Float64Array(0), ux: new Float64Array(0), uy: new Float64Array(0),
    h: new Float64Array(0), R: new Float64Array(0), owner: [],
    // obwiednia wszystkich kapsuł (szybkie odrzucenie odcinka)
    x0: 0, y0: 0, x1: 0, y1: 0,
    // węzły i krawędzie (CSR)
    x: new Float64Array(0), y: new Float64Array(0),
    start: new Int32Array(1), adj: new Int32Array(0), cost: new Float64Array(0),
    // robocze: kapsuły z końcem odcinka w środku, Dijkstra
    skipA: new Uint8Array(0), skipB: new Uint8Array(0),
    dist: new Float64Array(0), prev: new Int32Array(0), done: new Uint8Array(0), gvis: new Float64Array(0)
  };
}

function capHit(g, k, ax, ay, bx, by) {
  const cx = g.cx[k];
  const cy = g.cy[k];
  const R = g.R[k];
  const h = g.h[k];
  // szybkie odrzucenie: środek kapsuły dalej od odcinka niż pół-długość + promień
  const ex = bx - ax;
  const ey = by - ay;
  const L2 = ex * ex + ey * ey;
  let t = L2 > EPS ? ((cx - ax) * ex + (cy - ay) * ey) / L2 : 0;
  t = clamp01(t);
  const qx = ax + ex * t - cx;
  const qy = ay + ey * t - cy;
  const reach = h + R;
  if (qx * qx + qy * qy >= reach * reach) return false;
  const ux = g.ux[k];
  const uy = g.uy[k];
  return segSegDist2(ax, ay, bx, by, cx - ux * h, cy - uy * h, cx + ux * h, cy + uy * h) < R * R;
}

// Odcinek AB nie wchodzi w żadną poszerzoną kapsułę (poza oznaczonymi w skipA / skipB).
function segClear(g, ax, ay, bx, by, skipA, skipB) {
  if ((ax < g.x0 && bx < g.x0) || (ax > g.x1 && bx > g.x1) || (ay < g.y0 && by < g.y0) || (ay > g.y1 && by > g.y1)) return true;
  for (let k = 0; k < g.m; k++) {
    if ((skipA !== null && skipA[k] === 1) || (skipB !== null && skipB[k] === 1)) continue;
    if (capHit(g, k, ax, ay, bx, by)) return false;
  }
  return true;
}

function pointInCap(g, k, px, py) {
  const h = g.h[k];
  let s = (px - g.cx[k]) * g.ux[k] + (py - g.cy[k]) * g.uy[k];
  if (s < -h) s = -h; else if (s > h) s = h;
  const qx = px - g.cx[k] - g.ux[k] * s;
  const qy = py - g.cy[k] - g.uy[k] * s;
  return qx * qx + qy * qy < g.R[k] * g.R[k];
}

// skip[k] = 1: kapsuła k zawiera punkt albo należy do budowli `ignore` (cel rozkazu — taran, podejście).
function markContaining(g, px, py, skip, ignore) {
  for (let k = 0; k < g.m; k++) skip[k] = (ignore !== null && g.owner[k] === ignore) || pointInCap(g, k, px, py) ? 1 : 0;
}

function buildGraph(g, statics, clr, ver) {
  const T = STATIC_ROUTE_TUNE;
  const m = statics.length;
  g.ver = ver;
  g.clr = clr;
  g.m = m;
  g.owner.length = m;
  if (g.cx.length < m) {
    g.cx = new Float64Array(m); g.cy = new Float64Array(m); g.ux = new Float64Array(m); g.uy = new Float64Array(m);
    g.h = new Float64Array(m); g.R = new Float64Array(m); g.skipA = new Uint8Array(m); g.skipB = new Uint8Array(m);
  }
  g.x0 = Infinity; g.y0 = Infinity; g.x1 = -Infinity; g.y1 = -Infinity;
  for (let k = 0; k < m; k++) {
    const o = statics[k];
    const h = o.h > 0 ? o.h : 0;
    const L = Math.sqrt(o.ux * o.ux + o.uy * o.uy) || 1;
    g.cx[k] = o.x; g.cy[k] = o.y; g.ux[k] = o.ux / L; g.uy[k] = o.uy / L; g.h[k] = h; g.R[k] = o.w + clr;
    g.owner[k] = o.obstacleOwner || null;
    const ext = h + o.w + clr;
    if (o.x - ext < g.x0) g.x0 = o.x - ext;
    if (o.x + ext > g.x1) g.x1 = o.x + ext;
    if (o.y - ext < g.y0) g.y0 = o.y - ext;
    if (o.y + ext > g.y1) g.y1 = o.y + ext;
  }
  // węzły na obrysach (poza każdą poszerzoną kapsułą)
  const cap = m * 10;
  if (g.x.length < cap) { g.x = new Float64Array(cap); g.y = new Float64Array(cap); }
  let n = 0;
  const push = (px, py) => {
    for (let k = 0; k < m; k++) if (pointInCap(g, k, px, py)) return;
    g.x[n] = px; g.y[n] = py; n++;
  };
  const step = Math.PI / 4;
  for (let k = 0; k < m; k++) {
    const Rn = g.R[k] * T.nodeK + T.nodeExtra;
    const h = g.h[k];
    if (h < 1) {
      for (let i = 0; i < 8; i++) push(g.cx[k] + Math.cos(i * step) * Rn, g.cy[k] + Math.sin(i * step) * Rn);
      continue;
    }
    for (let e = -1; e <= 1; e += 2) {
      const ax = g.ux[k] * e;
      const ay = g.uy[k] * e;
      const bx = g.cx[k] + ax * h;
      const by = g.cy[k] + ay * h;
      for (let i = -2; i <= 2; i++) {
        const c = Math.cos(i * step);
        const s = Math.sin(i * step);
        push(bx + (ax * c - ay * s) * Rn, by + (ax * s + ay * c) * Rn);
      }
    }
  }
  g.n = n;
  // krawędzie widoczności (CSR)
  const pairs = new Int32Array(Math.max(1, n * n));
  const deg = new Int32Array(n);
  let np = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!segClear(g, g.x[i], g.y[i], g.x[j], g.y[j], null, null)) continue;
      pairs[np++] = i * n + j;
      deg[i]++; deg[j]++;
    }
  }
  g.start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) g.start[i + 1] = g.start[i] + deg[i];
  g.adj = new Int32Array(2 * np);
  g.cost = new Float64Array(2 * np);
  const fill = deg.fill(0);
  for (let p = 0; p < np; p++) {
    const i = (pairs[p] / n) | 0;
    const j = pairs[p] - i * n;
    const c = Math.hypot(g.x[j] - g.x[i], g.y[j] - g.y[i]);
    let q = g.start[i] + fill[i]++;
    g.adj[q] = j; g.cost[q] = c;
    q = g.start[j] + fill[j]++;
    g.adj[q] = i; g.cost[q] = c;
  }
  if (g.dist.length < n) {
    g.dist = new Float64Array(n); g.prev = new Int32Array(n); g.done = new Uint8Array(n); g.gvis = new Float64Array(n);
  }
  return g;
}

const _graphs = new Map();   // kubełek luzu → graf
let _builds = 0;

function graphFor(W, bucket) {
  let g = _graphs.get(bucket);
  if (g && g.ver === W.staticsVer) return g;
  if (!g) { g = newGraph(); _graphs.set(bucket, g); }
  _builds++;
  return buildGraph(g, W.statics, bucket * STATIC_ROUTE_TUNE.bucket, W.staticsVer);
}

function routeState(npc) {
  let r = npc.__sroute;
  if (!r) {
    const n = STATIC_ROUTE_TUNE.maxPts;
    r = npc.__sroute = { ver: -1, bucket: -1, calls: 0, gx: 0.5, gy: 0.5, n: 0, x: new Float64Array(n), y: new Float64Array(n) };
  }
  return r;
}

// Najkrótsza droga S → G po grafie (skipA / skipB — kapsuły z S / G w środku, oznaczone przed wywołaniem).
// Zapis do r: punkty trasy bez S, ostatni = G. false — celu nie da się osiągnąć grafem.
function plan(g, r, sx, sy, gx, gy, bucket) {
  const T = STATIC_ROUTE_TUNE;
  r.ver = g.ver;
  r.bucket = bucket;
  r.calls = 0;
  r.gx = gx;
  r.gy = gy;
  r.n = 0;
  const n = g.n;
  const dist = g.dist;
  const prev = g.prev;
  const done = g.done;
  const gvis = g.gvis;
  for (let i = 0; i < n; i++) {
    done[i] = 0;
    prev[i] = -1;
    dist[i] = segClear(g, sx, sy, g.x[i], g.y[i], g.skipA, null) ? Math.hypot(g.x[i] - sx, g.y[i] - sy) : Infinity;
    gvis[i] = segClear(g, g.x[i], g.y[i], gx, gy, null, g.skipB) ? Math.hypot(gx - g.x[i], gy - g.y[i]) : -1;
  }
  let best = Infinity;
  let bestU = -1;
  for (;;) {
    let u = -1;
    let du = Infinity;
    for (let i = 0; i < n; i++) if (done[i] === 0 && dist[i] < du) { du = dist[i]; u = i; }
    if (u < 0 || du >= best) break;
    done[u] = 1;
    if (gvis[u] >= 0 && du + gvis[u] < best) { best = du + gvis[u]; bestU = u; }
    for (let e = g.start[u]; e < g.start[u + 1]; e++) {
      const v = g.adj[e];
      if (done[v] === 1) continue;
      const nd = du + g.cost[e];
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
    }
  }
  if (bestU < 0) return false;
  let count = 0;
  for (let u = bestU; u >= 0; u = prev[u]) count++;
  const keep = Math.min(count, T.maxPts - 1);
  // węzły od S: przy trasie dłuższej niż maxPts zostają pierwsze (następne doliczy kolejne planowanie)
  let k = count - 1;
  for (let u = bestU; u >= 0; u = prev[u], k--) {
    if (k < keep) { r.x[k] = g.x[u]; r.y[k] = g.y[u]; }
  }
  r.x[keep] = gx;
  r.y[keep] = gy;
  r.n = keep + 1;
  return true;
}

// Najdalszy punkt trasy (bez celu — tego nie widać wprost) widoczny z okrętu albo −1.
function farthestVisible(g, r, sx, sy) {
  for (let k = r.n - 2; k >= 0; k--) {
    if (segClear(g, sx, sy, r.x[k], r.y[k], g.skipA, null)) return k;
  }
  return -1;
}

/**
 * Punkt, do którego okręt `npc` ma lecieć, żeby w drodze do (tx, ty) ominąć budowle (przeszkody statyczne indeksu AI).
 * `corridor` — pół-szerokość korytarza okrętu (jak w omijaniu wraków); `ignore` — byt budowli, który jest celem rozkazu
 * (jej kapsuły nie zasłaniają okrętu ani celu). Zwraca false, gdy budowli nie ma albo cel widać wprost (pilot leci do
 * celu jak dotąd); inaczej true i `out` { x, y, len } — punkt trasy i długość drogi przez niego do celu.
 */
export function staticRouteAim(npc, tx, ty, corridor, out, ignore = null) {
  const T = STATIC_ROUTE_TUNE;
  const W = getWreckIndex();
  const r0 = npc.__sroute;
  if (!T.enabled || W.statics.length === 0) {
    if (r0) r0.n = 0;
    return false;
  }
  const bucket = Math.max(1, Math.ceil((corridor + T.pad) / T.bucket));
  const g = graphFor(W, bucket);
  const sx = npc.x;
  const sy = npc.y;
  if ((sx < g.x0 && tx < g.x0) || (sx > g.x1 && tx > g.x1) || (sy < g.y0 && ty < g.y0) || (sy > g.y1 && ty > g.y1)) {
    if (r0) r0.n = 0;
    return false;
  }
  markContaining(g, sx, sy, g.skipA, ignore || null);
  markContaining(g, tx, ty, g.skipB, ignore || null);
  if (segClear(g, sx, sy, tx, ty, g.skipA, g.skipB)) {
    if (r0) r0.n = 0;
    return false;
  }
  const r = routeState(npc);
  r.calls++;
  const gdx = tx - r.gx;
  const gdy = ty - r.gy;
  let fresh = false;
  if (r.n === 0 || r.ver !== g.ver || r.bucket !== bucket || r.calls >= T.replanCalls || gdx * gdx + gdy * gdy > T.goalMove * T.goalMove) {
    if (!plan(g, r, sx, sy, tx, ty, bucket)) return false;
    fresh = true;
  }
  let k = farthestVisible(g, r, sx, sy);
  if (k < 0 && !fresh) {
    if (!plan(g, r, sx, sy, tx, ty, bucket)) return false;
    k = farthestVisible(g, r, sx, sy);
  }
  if (k < 0) return false;
  out.x = r.x[k];
  out.y = r.y[k];
  let len = Math.hypot(out.x - sx, out.y - sy);
  for (let j = k; j < r.n - 2; j++) len += Math.hypot(r.x[j + 1] - r.x[j], r.y[j + 1] - r.y[j]);
  out.len = len + Math.hypot(tx - r.x[r.n - 2], ty - r.y[r.n - 2]);
  return true;
}

/** Diagnostyka: liczba budów grafu, grafy (kubełek → węzły, krawędzie, kapsuły). */
export function staticRouteStats() {
  const graphs = {};
  for (const [b, g] of _graphs) graphs[b * STATIC_ROUTE_TUNE.bucket] = { nodes: g.n, edges: g.adj.length / 2, caps: g.m, ver: g.ver };
  return { builds: _builds, graphs };
}

if (typeof window !== 'undefined') {
  window.StaticRouteTune = STATIC_ROUTE_TUNE;
  window.staticRouteStats = staticRouteStats;
}
