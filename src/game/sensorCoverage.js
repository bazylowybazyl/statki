// ============================================================
// Pokrycie czujników dla UI (2026-11-03, podwaliny zasięgu radarów — src/game/sensorDetection.js).
// Czysta geometria (bez three / DOM): SUMA KÓŁ zasięgu wykrycia. Wiele radarów jednej strony daje JEDEN obrys
// zamiast stosu okręgów — flota 40 okrętów to zwykle 1–3 łuki, bo koła mniejszych czujników leżą w kole okrętu
// flagowego. Wynik:
//  - ŁUKI brzegu sumy (`arcs`: koło, kąt od, kąt do — kąty jak w canvas `arc`, (x + r·cos a, y + r·sin a)),
//  - SKUPISKA (`clusters`: koła, które na siebie zachodzą — jeden podpis na skupisko, punkt podpisu na szczycie),
//  - zapytania: krawędź najbliżej punktu (`nearestCoverageEdge`), głębia / liczba kół w punkcie.
// Wypełnienie sumy rysuje wołający jedną ścieżką ze wszystkich żywych kół (reguła „nonzero” = suma).
// Bufory rosną skokowo i zostają (bez alokacji przy stałej liczbie kół); O(n log n + par zachodzących).
// ============================================================

const TAU = Math.PI * 2;

export function createCoverage(cap = 32) {
  const cov = {
    n: 0,
    maxR: 0,
    x: null, y: null, r: null, tag: null,
    alive: null,       // 1 — koło wnosi coś do sumy; 0 — zawarte w innym (liczy się do skupiska, bez łuków)
    parent: null,      // union-find skupisk
    cluster: null,     // numer skupiska koła
    order: null,       // indeksy po x
    pos: null,         // miejsce koła w `order`
    arcN: 0,
    arcCircle: null, arcA0: null, arcA1: null,
    clusterN: 0,
    clusterCount: null,                          // wszystkie koła skupiska (z zawartymi)
    clusterTopX: null, clusterTopY: null,        // najwyżej położony punkt sumy (najmniejsze y) — miejsce podpisu
    clusterMinX: null, clusterMinY: null, clusterMaxX: null, clusterMaxY: null,
    clusterMaxR: null,
    // przedziały zakryte na jednym kole (zapas)
    _s: new Float64Array(64), _e: new Float64Array(64)
  };
  growCircles(cov, cap);
  growArcs(cov, cap);
  return cov;
}

function growCircles(cov, n) {
  const cur = cov.x ? cov.x.length : 0;
  if (cur >= n) return;
  let cap = cur || 16;
  while (cap < n) cap *= 2;
  const copyF = (a) => { const b = new Float64Array(cap); if (a) b.set(a.subarray(0, cov.n)); return b; };
  const copyI = (a) => { const b = new Int32Array(cap); if (a) b.set(a.subarray(0, cov.n)); return b; };
  cov.x = copyF(cov.x); cov.y = copyF(cov.y); cov.r = copyF(cov.r); cov.tag = copyI(cov.tag);
  cov.alive = new Uint8Array(cap);
  cov.parent = new Int32Array(cap);
  cov.cluster = new Int32Array(cap);
  cov.order = new Int32Array(cap);
  cov.pos = new Int32Array(cap);
  cov.clusterCount = new Int32Array(cap);
  cov.clusterTopX = new Float64Array(cap); cov.clusterTopY = new Float64Array(cap);
  cov.clusterMinX = new Float64Array(cap); cov.clusterMinY = new Float64Array(cap);
  cov.clusterMaxX = new Float64Array(cap); cov.clusterMaxY = new Float64Array(cap);
  cov.clusterMaxR = new Float64Array(cap);
}

function growArcs(cov, n) {
  const cur = cov.arcCircle ? cov.arcCircle.length : 0;
  if (cur >= n) return;
  let cap = cur || 16;
  while (cap < n) cap *= 2;
  const c = new Int32Array(cap), a0 = new Float64Array(cap), a1 = new Float64Array(cap);
  if (cov.arcCircle) { c.set(cov.arcCircle.subarray(0, cov.arcN)); a0.set(cov.arcA0.subarray(0, cov.arcN)); a1.set(cov.arcA1.subarray(0, cov.arcN)); }
  cov.arcCircle = c; cov.arcA0 = a0; cov.arcA1 = a1;
}

function growScratch(cov, n) {
  if (cov._s.length >= n) return;
  let cap = cov._s.length;
  while (cap < n) cap *= 2;
  cov._s = new Float64Array(cap);
  cov._e = new Float64Array(cap);
}

/** Nowy zestaw kół. */
export function beginCoverage(cov) {
  cov.n = 0;
  cov.maxR = 0;
  cov.arcN = 0;
  cov.clusterN = 0;
}

/** Koło zasięgu (x, y, r) z dowolnym znacznikiem liczbowym (np. indeks źródła — styl łuku u wołającego). */
export function addCoverageCircle(cov, x, y, r, tag = 0) {
  if (!(r > 0) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) return -1;
  growCircles(cov, cov.n + 1);
  const i = cov.n++;
  cov.x[i] = x; cov.y[i] = y; cov.r[i] = r; cov.tag[i] = tag | 0;
  if (r > cov.maxR) cov.maxR = r;
  return i;
}

function find(parent, i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function union(parent, a, b) {
  const ra = find(parent, a), rb = find(parent, b);
  if (ra !== rb) parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
}

// Sortowanie indeksów po x w miejscu (Shell, odstępy Ciury) — bez alokacji: suma liczy się też co klatkę (czoła fal).
const SHELL_GAPS = [701, 301, 132, 57, 23, 10, 4, 1];
function sortIndicesByKey(idx, n, key) {
  for (let g = 0; g < SHELL_GAPS.length; g++) {
    const gap = SHELL_GAPS[g];
    if (gap >= n) continue;
    for (let i = gap; i < n; i++) {
      const v = idx[i], kv = key[v];
      let j = i;
      while (j >= gap && key[idx[j - gap]] > kv) { idx[j] = idx[j - gap]; j -= gap; }
      idx[j] = v;
    }
  }
}

/** Liczy sumę: koła zawarte, skupiska, łuki brzegu. */
export function buildCoverage(cov) {
  const n = cov.n;
  const X = cov.x, Y = cov.y, R = cov.r;
  const alive = cov.alive, parent = cov.parent, order = cov.order, pos = cov.pos;
  for (let i = 0; i < n; i++) { alive[i] = 1; parent[i] = i; order[i] = i; }
  sortIndicesByKey(order, n, X);
  for (let k = 0; k < n; k++) pos[order[k]] = k;
  const maxR = cov.maxR;
  const eps = 1e-9 * (maxR > 1 ? maxR : 1);

  // 1) pary zachodzące: skupiska i koła zawarte w innych
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const xi = X[i], yi = Y[i], ri = R[i];
    const reach = ri + maxR;
    for (let m = k + 1; m < n; m++) {
      const j = order[m];
      const dx = X[j] - xi;
      if (dx > reach) break;
      const dy = Y[j] - yi;
      const rs = ri + R[j];
      const d2 = dx * dx + dy * dy;
      if (d2 >= rs * rs) continue;
      union(parent, i, j);
      const d = Math.sqrt(d2);
      const iInJ = d + ri <= R[j] + eps;
      const jInI = d + R[j] <= ri + eps;
      if (iInJ && jInI) alive[i > j ? i : j] = 0;   // to samo koło — zostaje pierwsze
      else if (iInJ) alive[i] = 0;
      else if (jInI) alive[j] = 0;
    }
  }

  // 2) skupiska: numery, liczności, obwiednie, szczyt (najmniejsze y sumy leży na szczycie któregoś żywego koła)
  let cn = 0;
  const cluster = cov.cluster;
  for (let i = 0; i < n; i++) {
    const root = find(parent, i);
    if (root === i) cluster[i] = cn++;
  }
  cov.clusterN = cn;
  for (let c = 0; c < cn; c++) {
    cov.clusterCount[c] = 0;
    cov.clusterMinX[c] = Infinity; cov.clusterMinY[c] = Infinity;
    cov.clusterMaxX[c] = -Infinity; cov.clusterMaxY[c] = -Infinity;
    cov.clusterTopY[c] = Infinity; cov.clusterTopX[c] = 0;
    cov.clusterMaxR[c] = 0;
  }
  for (let i = 0; i < n; i++) {
    const c = cluster[i] = cluster[find(parent, i)];
    cov.clusterCount[c]++;
    if (!alive[i]) continue;
    const x = X[i], y = Y[i], r = R[i];
    if (x - r < cov.clusterMinX[c]) cov.clusterMinX[c] = x - r;
    if (y - r < cov.clusterMinY[c]) cov.clusterMinY[c] = y - r;
    if (x + r > cov.clusterMaxX[c]) cov.clusterMaxX[c] = x + r;
    if (y + r > cov.clusterMaxY[c]) cov.clusterMaxY[c] = y + r;
    if (y - r < cov.clusterTopY[c]) { cov.clusterTopY[c] = y - r; cov.clusterTopX[c] = x; }
    if (r > cov.clusterMaxR[c]) cov.clusterMaxR[c] = r;
  }

  // 3) łuki brzegu: na każdym żywym kole przedziały zakryte przez żywych sąsiadów → dopełnienie
  cov.arcN = 0;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const xi = X[i], yi = Y[i], ri = R[i];
    const reach = ri + maxR;
    let cnt = 0;
    let covered = false;
    for (let side = -1; side <= 1 && !covered; side += 2) {
      for (let m = pos[i] + side; m >= 0 && m < n; m += side) {
        const j = order[m];
        const dx = X[j] - xi;
        if ((side > 0 ? dx : -dx) > reach) break;
        if (!alive[j]) continue;
        const dy = Y[j] - yi;
        const rj = R[j];
        const d2 = dx * dx + dy * dy;
        const rs = ri + rj;
        if (d2 >= rs * rs) continue;
        const d = Math.sqrt(d2);
        if (d + ri <= rj + eps) { covered = true; break; } // nie powinno zajść (zawarte odpadły) — na wszelki wypadek
        if (d + rj <= ri + eps) continue;                  // j w środku i — brzegu i nie dotyka
        let c = (ri * ri + d2 - rj * rj) / (2 * ri * d);
        c = c < -1 ? -1 : (c > 1 ? 1 : c);
        const h = Math.acos(c);
        let s = Math.atan2(dy, dx) - h;
        s -= Math.floor(s / TAU) * TAU;
        const e = s + 2 * h;
        growScratch(cov, cnt + 2);
        if (e > TAU) {
          cov._s[cnt] = s; cov._e[cnt] = TAU; cnt++;
          cov._s[cnt] = 0; cov._e[cnt] = e - TAU; cnt++;
        } else {
          cov._s[cnt] = s; cov._e[cnt] = e; cnt++;
        }
      }
    }
    if (covered) continue;
    if (cnt === 0) { pushArc(cov, i, 0, TAU); continue; }
    const S = cov._s, E = cov._e;
    // sortowanie przez wstawianie po początku (przedziałów na kole jest kilka–kilkadziesiąt)
    for (let a = 1; a < cnt; a++) {
      const s = S[a], e = E[a];
      let b = a - 1;
      while (b >= 0 && S[b] > s) { S[b + 1] = S[b]; E[b + 1] = E[b]; b--; }
      S[b + 1] = s; E[b + 1] = e;
    }
    // dopełnienie sumy przedziałów w [0, 2π)
    const firstArc = cov.arcN;
    let cursor = 0;
    for (let a = 0; a < cnt; a++) {
      if (S[a] > cursor) pushArc(cov, i, cursor, S[a]);
      if (E[a] > cursor) cursor = E[a];
    }
    if (cursor < TAU) pushArc(cov, i, cursor, TAU);
    // łuk kończący się na 2π i łuk od 0 to jeden łuk przez kąt 0
    const last = cov.arcN - 1;
    if (last > firstArc && cov.arcA0[firstArc] === 0 && cov.arcA1[last] === TAU) {
      cov.arcA1[last] = TAU + cov.arcA1[firstArc];
      // przesuń resztę o jeden w lewo (pierwszy łuk wchłonięty)
      for (let a = firstArc; a < last; a++) {
        cov.arcCircle[a] = cov.arcCircle[a + 1];
        cov.arcA0[a] = cov.arcA0[a + 1];
        cov.arcA1[a] = cov.arcA1[a + 1];
      }
      cov.arcN--;
    }
  }
  return cov;
}

/**
 * Suma tych samych kół z promieniami × k (czoło fali radaru w ułamku zasięgu). Znaczniki kół zostają; koła zawarte
 * w źródle też idą (przy k < 1 koło zawarte potrafi wystawać ze skurczonego sąsiada).
 */
export function scaleCoverageInto(dst, src, k) {
  beginCoverage(dst);
  if (!(k > 0)) return dst;
  for (let i = 0; i < src.n; i++) addCoverageCircle(dst, src.x[i], src.y[i], src.r[i] * k, src.tag[i]);
  return buildCoverage(dst);
}

function pushArc(cov, circle, a0, a1) {
  if (a1 - a0 <= 1e-12) return;
  growArcs(cov, cov.arcN + 1);
  const k = cov.arcN++;
  cov.arcCircle[k] = circle;
  cov.arcA0[k] = a0;
  cov.arcA1[k] = a1;
}

/** Skupisko łuku (numer z `clusters`). */
export function coverageArcCluster(cov, k) {
  return cov.cluster[cov.arcCircle[k]];
}

/** Ile kół (także zawartych) obejmuje punkt — „ile radarów cię widzi” przy tej samej sygnaturze. */
export function coverageCountAt(cov, x, y) {
  let c = 0;
  for (let i = 0; i < cov.n; i++) {
    const dx = x - cov.x[i], dy = y - cov.y[i], r = cov.r[i];
    if (dx * dx + dy * dy <= r * r) c++;
  }
  return c;
}

/** Czy punkt leży w sumie. */
export function coverageContains(cov, x, y) {
  for (let i = 0; i < cov.n; i++) {
    if (!cov.alive[i]) continue;
    const dx = x - cov.x[i], dy = y - cov.y[i], r = cov.r[i];
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/**
 * Najbliższy punkt BRZEGU sumy (po łukach — dokładnie, także w środku sumy).
 * out: { x, y, dist, inside, arc, circle } (arc −1 — brak kół).
 */
export function nearestCoverageEdge(cov, px, py, out) {
  let best = Infinity, bx = 0, by = 0, barc = -1;
  for (let k = 0; k < cov.arcN; k++) {
    const i = cov.arcCircle[k];
    const cx = cov.x[i], cy = cov.y[i], r = cov.r[i];
    const a0 = cov.arcA0[k], a1 = cov.arcA1[k];
    let a = Math.atan2(py - cy, px - cx);
    // kąt punktu w [a0, a0 + 2π)
    a -= Math.floor((a - a0) / TAU) * TAU;
    let qx, qy;
    if (a <= a1) {
      qx = cx + Math.cos(a) * r; qy = cy + Math.sin(a) * r;
    } else {
      // poza łukiem — bliższy koniec (po kącie od końca a1 i od początku a0 + 2π)
      const ang = (a - a1) < (a0 + TAU - a) ? a1 : a0;
      qx = cx + Math.cos(ang) * r; qy = cy + Math.sin(ang) * r;
    }
    const dx = qx - px, dy = qy - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) { best = d2; bx = qx; by = qy; barc = k; }
  }
  out.x = bx; out.y = by;
  out.dist = barc >= 0 ? Math.sqrt(best) : Infinity;
  out.arc = barc;
  out.circle = barc >= 0 ? cov.arcCircle[barc] : -1;
  out.inside = coverageContains(cov, px, py);
  return out;
}

// ---------------------------------------------------------------- grupy znaczników
// Wiele kontaktów blisko siebie (na ekranie) → jeden znacznik grupy „×12”. Zachłannie w kolejności wejścia (kto
// pierwszy, ten środek grupy — podaj najważniejsze pierwsze), środek = średnia członków. O(n · grupy).

export function createPointGroups(cap = 32) {
  return { n: 0, groupOf: new Int32Array(cap), count: new Int32Array(cap), cx: new Float64Array(cap), cy: new Float64Array(cap), ax: new Float64Array(cap), ay: new Float64Array(cap) };
}

/** xs, ys — współrzędne (np. px ekranu), radius — promień łączenia w tych samych jednostkach. */
export function groupPoints(g, xs, ys, n, radius) {
  if (g.groupOf.length < n) {
    let cap = g.groupOf.length || 16;
    while (cap < n) cap *= 2;
    g.groupOf = new Int32Array(cap); g.count = new Int32Array(cap);
    g.cx = new Float64Array(cap); g.cy = new Float64Array(cap);
    g.ax = new Float64Array(cap); g.ay = new Float64Array(cap);
  }
  const r2 = radius * radius;
  let gn = 0;
  for (let p = 0; p < n; p++) {
    const x = xs[p], y = ys[p];
    let hit = -1;
    for (let q = 0; q < gn; q++) {
      const dx = x - g.ax[q], dy = y - g.ay[q];
      if (dx * dx + dy * dy <= r2) { hit = q; break; }
    }
    if (hit < 0) {
      hit = gn++;
      g.ax[hit] = x; g.ay[hit] = y;   // kotwica grupy (pierwszy członek) — stała, żeby grupy nie pełzały
      g.cx[hit] = 0; g.cy[hit] = 0; g.count[hit] = 0;
    }
    g.groupOf[p] = hit;
    g.count[hit]++;
    g.cx[hit] += x; g.cy[hit] += y;
  }
  for (let q = 0; q < gn; q++) { g.cx[q] /= g.count[q]; g.cy[q] /= g.count[q]; }
  g.n = gn;
  return g;
}
