// src/game/hullDesign/hullDesignRegularize.js
//
// KREATOR KADŁUBÓW — STANDARYZACJA OBRYSÓW (czysta: bez three i DOM; testy tests/hullDesign.test.mjs). Sprite'y
// z AI są zaszumione: obrys płyt odrysowany z nich ma krawędzie pod przypadkowymi kątami, drobne schodki, wcięcia
// i ząbki, więc rowy między płytami mają zmienną szerokość, a rury, linie paneli i fazy idą za każdym ząbkiem.
// Język Terra Novy (czysty sprite Bellatora) to krawędzie 0 / 45 / 90°, długie proste, rowy stałej szerokości.
//
// regularizeLoop(łamana, { step, minLen, jog, maxDev, longLen, stairLen, stairDev }) → łamana:
//   1. każda krawędź → LINIA w najbliższym z 8 kierunków (co 45°) przez środek krawędzi; krawędź DŁUGA (≥ longLen —
//      zamierzona linia sylwetki, np. płaski skos dziobu Citadelli ~26°) — w najbliższym z 16 (co 22,5°),
//   2. kolejne linie tego samego kierunku → jedna (położenie ważone długością),
//   3. położenie linii na WSPÓLNEJ SIATCE: proste osiowe co `step`, ukośne x ± y = k · step — krawędzie sąsiednich
//      płyt trafiają na te same linie, rów ma szerokość = wielokrotność kroku na całej długości,
//   4. rogi = przecięcia kolejnych linii; krawędź krótsza niż `minLen` (albo odwrócona po przyciągnięciu) znika —
//      między liniami nierównoległymi róg idzie w przecięcie sąsiadów, między równoległymi (ząbek, wcięcie) linie
//      łączą się, gdy przesunięcie ≤ `jog`; SCHODKI i PIŁA na skosie (ciąg krawędzi ≤ `stairLen` w kierunkach ±45° od
//      cięciwy, rogi po obu jej stronach ≤ `stairDev`) → jedna prosta; róg dalej niż `maxDev` od oryginału dostaje
//      fazę 45° przez dawny róg,
//   5. kontrola: wielokąt prosty, ten sam obieg, pole ±25% — inaczej null (wołający bierze oryginał).
// Siatka linii jest symetryczna względem osi y = 0, ale porządki (kolejność usuwania krawędzi) zależą od obiegu,
// więc burty lustrzanego obrysu potrafią wyjść różne o kilka kroków — regularizeLoopSym pilnuje lustra (burta y > 0
// liczona jako odbicie, obrys na osi — połowa y ≤ 0 odbita). standardizeLoop = mocne porządki (HD_REG_STRONG),
// a gdy się nie da — łagodne; kreator woła go dla brył z `reg` (hullDesignGeometry.js: treatLoop; okruchy z `regDrop`
// znikają).

const S = Math.SQRT1_2;
/** Kierunki co 22,5° (x w prawo, y w dół obrazu), k = 0…15; parzyste = rodzina 0 / 45 / 90°. */
const NK = 16;
const DIRS = Array.from({ length: NK }, (_, k) => {
  if (k % 4 === 0) return [[1, 0], [0, 1], [-1, 0], [0, -1]][k / 4];
  if (k % 4 === 2) return [[S, S], [-S, S], [-S, -S], [S, -S]][(k - 2) / 4];
  return [Math.cos(k * Math.PI / 8), Math.sin(k * Math.PI / 8)];
});

/** Najbliższy kierunek: krawędź długa — z 16, krótka — z 8 (parzyste k). */
const dirIndex = (dx, dy, long) => {
  const a = Math.atan2(dy, dx);
  const k = long ? Math.round(a / (Math.PI / 8)) : 2 * Math.round(a / (Math.PI / 4));
  return ((k % NK) + NK) % NK;
};
/** Normalna kierunku k (w lewo od kierunku): położenie linii c = n · p. */
const nrm = (k) => [-DIRS[k][1], DIRS[k][0]];
/** Krok siatki położeń: osiowe co step, ukośne 45° co step·√½ (x ± y = n·step), 22,5° — pół kroku. */
const snapUnit = (k, step) => (k % 4 === 0 ? step : (k % 4 === 2 ? step * S : step * 0.5));
const turnOf = (a, b) => (b - a + NK) % NK;

function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}

/** Przecięcie linii (k1, c1) i (k2, c2); null dla równoległych. */
function meet(l1, l2) {
  const [a1, b1] = nrm(l1.k), [a2, b2] = nrm(l2.k);
  const det = a1 * b2 - b1 * a2;
  if (Math.abs(det) < 1e-9) return null;
  return [(l1.c * b2 - b1 * l2.c) / det, (a1 * l2.c - l1.c * a2) / det];
}

/** Odcinki pq i rs przecinają się wewnętrznie (bez wspólnych końców). */
function segCross(p, q, r, s) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p, q, r), d2 = d(p, q, s), d3 = d(r, s, p), d4 = d(r, s, q);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

function isSimple(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segCross(a, b, pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** Kolejne linie tego samego kierunku (cyklicznie) → jedna, położenie ważone długością. */
function mergeRuns(lines) {
  if (lines.length < 2) return lines;
  let start = 0;
  // start na granicy grup (inaczej grupa przez koniec tablicy rozpadłaby się na dwie)
  while (start < lines.length && lines[start].k === lines[(start - 1 + lines.length) % lines.length].k) start++;
  if (start >= lines.length) return [lines[0]];
  const out = [];
  for (let q = 0; q < lines.length; q++) {
    const l = lines[(start + q) % lines.length];
    const last = out[out.length - 1];
    if (last && last.k === l.k) {
      const w = last.w + l.w;
      last.c = (last.c * last.w + l.c * l.w) / w;
      last.w = w;
      last.end = l.end;
    } else out.push({ ...l });
  }
  return out;
}

/** Rogi: v[i] = przecięcie linii i oraz i + 1 (null — równoległe). */
function corners(lines) {
  const n = lines.length;
  const v = new Array(n);
  for (let i = 0; i < n; i++) v[i] = meet(lines[i], lines[(i + 1) % n]);
  return v;
}

function snapLine(l, step) {
  const u = snapUnit(l.k, step);
  l.c = Math.round(l.c / u) * u;
}

/**
 * Schodki / piła → prosta (jeden ciąg na wywołanie): najdłuższy cykliczny ciąg ≥ 3 kolejnych linii nie dłuższych niż
 * `stairLen`, których kierunki mieszczą się w ±45° od kierunku cięciwy ciągu (z rodziny 0 / 45 / 90°, a dla cięciwy
 * ≥ longLen / 2 — co 22,5°; co najmniej dwa różne), a rogi leżą po OBU stronach cięciwy najwyżej `stairDev` od niej —
 * skos odrysowany schodkami albo piłą (zęby 10–30 jd z zaszumionego obrysu) — zastąpiony jedną linią w kierunku cięciwy
 * przez średnie położenie rogów. Ząbki w poprzek prostej (±90° od cięciwy) zostają dla porządków, schody projektu
 * (stopnie większe niż ~3 · stairDev, rogi daleko od cięciwy) — też. Null — brak schodków.
 */
function stairsToDiagonal(ls, stairLen, stairDev, step, longLen) {
  const n = ls.length;
  if (n < 5) return null;
  const v = corners(ls);
  const len = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = v[(i - 1 + n) % n], q = v[i];
    if (!p || !q) return null;
    const d = DIRS[ls[i].k];
    len[i] = d[0] * (q[0] - p[0]) + d[1] * (q[1] - p[1]);
  }
  const okAt = (i) => len[i] > 0 && len[i] <= stairLen;
  /** Ciąg a … a + m − 1 jako schodki: kierunek cięciwy albo −1. */
  const stairDir = (a, m) => {
    const p0 = v[(a - 1 + n) % n], p1 = v[(a + m - 1) % n];
    const cx = p1[0] - p0[0], cy = p1[1] - p0[1], cl = Math.hypot(cx, cy);
    if (cl < 1e-9) return -1;
    const kD = dirIndex(cx, cy, cl >= longLen * 0.5);
    let mixed = false;
    for (let q = 0; q < m; q++) {
      const t = turnOf(kD, ls[(a + q) % n].k);
      if (t > 2 && t < NK - 2) return -1;
      if (t !== 0) mixed = true;
    }
    if (!mixed) return -1;
    // rogi przy cięciwie i po obu jej stronach (piła / schodki, nie garb ani pojedynczy stopień)
    const ux = cx / cl, uy = cy / cl;
    let pos = 0, neg = 0;
    for (let q = 0; q < m - 1; q++) {
      const p = v[(a + q) % n];
      const dv = (p[0] - p0[0]) * uy - (p[1] - p0[1]) * ux;
      if (Math.abs(dv) > stairDev) return -1;
      if (dv > step * 0.25) pos++; else if (dv < -step * 0.25) neg++;
    }
    return pos && neg ? kD : -1;
  };
  // ciąg od a (ciąg liczony od środka jest krótszy niż od swojego początku — wygrywa początek)
  let bestA = -1, bestM = 0, bestK = -1, bestW = 0;
  for (let a = 0; a < n; a++) {
    if (!okAt(a)) continue;
    let m = 1;
    while (m < n - 2 && okAt((a + m) % n)) m++;
    for (; m >= 3; m--) {
      const k = stairDir(a, m);
      if (k < 0) continue;
      let w = 0;
      for (let q = 0; q < m; q++) w += len[(a + q) % n];
      if (w > bestW) { bestW = w; bestM = m; bestA = a; bestK = k; }
      break;
    }
  }
  if (bestA < 0) return null;
  const [nx, ny] = nrm(bestK);
  let c = 0;
  for (let q = -1; q < bestM; q++) { const p = v[(bestA + q + n) % n]; c += nx * p[0] + ny * p[1]; }
  c /= bestM + 1;
  const last = ls[(bestA + bestM - 1) % n];
  const diag = { k: bestK, c, w: bestW, end: last.end ? [last.end[0], last.end[1]] : null };
  snapLine(diag, step);
  const out = [diag];
  for (let q = bestM; q < n; q++) out.push(ls[(bestA + q) % n]);
  return out;
}

/**
 * Standaryzacja łamanej zamkniętej (opis na górze pliku). `step` [j.] — krok siatki linii, `minLen` — najkrótsza
 * krawędź (domyślnie 2 kroki), `jog` — największy ząbek / wcięcie zalewane (1,5 kroku), `maxDev` — najdalej przesunięty
 * róg (3 kroki). Zwraca nową łamaną albo null (kształt się nie dał — zostaje oryginał).
 */
export function regularizeLoop(loop, opts = {}) {
  const step = opts.step;
  const fail = (why, pts) => { if (opts.diag) { opts.diag.why = why; opts.diag.pts = pts || null; } return null; };
  if (!(step > 0) || !Array.isArray(loop) || loop.length < 3) return fail('wejście');
  const minLen = opts.minLen ?? 2 * step;
  const jog = opts.jog ?? 1.5 * step;
  const maxDev = opts.maxDev ?? 3 * step;
  const longLen = opts.longLen ?? 24 * step;
  const stairLen = opts.stairLen ?? 16 * step;
  const stairDev = opts.stairDev ?? 5 * step;
  const pts = [];
  for (const p of loop) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) pts.push([p[0], p[1]]);
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-6) pts.pop();
  if (pts.length < 3) return fail('za mało punktów');
  const area0 = signedArea(pts);
  if (Math.abs(area0) < step * step) return fail('za małe pole');
  // 1. krawędzie → linie
  let lines = [];
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;
    const k = dirIndex(b[0] - a[0], b[1] - a[1], L >= longLen);
    const [nx, ny] = nrm(k);
    lines.push({ k, c: nx * (a[0] + b[0]) * 0.5 + ny * (a[1] + b[1]) * 0.5, w: L, end: [b[0], b[1]] });
  }
  // 2. scalenie tych samych kierunków (po każdym scaleniu położenie znów na siatce)
  const tidy = (ls) => { const out = mergeRuns(ls); for (const l of out) snapLine(l, step); return out; };
  // 3. porządki: krawędzie krótkie / odwrócone / równoległe sąsiedztwo — najkrótsza (najbardziej odwrócona) najpierw,
  //    bez zależności od punktu startu
  const cleanup = (ls) => {
    ls = tidy(ls);
    for (let guard = 0; guard < 8 * ls.length + 40; guard++) {
      const n = ls.length;
      if (n < 3) return null;
      let changed = false;
      for (let i = 0; i < n && !changed; i++) {
        const a = ls[i], b = ls[(i + 1) % n];
        if (turnOf(a.k, b.k) === NK / 2) {          // zawrócenie: krótsza z pary znika
          ls.splice(a.w < b.w ? i : (i + 1) % n, 1);
          ls = tidy(ls);
          changed = true;
        } else if (a.k === b.k) {
          ls = tidy(ls);
          changed = true;
        }
      }
      if (changed) continue;
      const v = corners(ls);
      let worst = -1, worstLen = Infinity;
      for (let i = 0; i < n; i++) {
        const p = v[(i - 1 + n) % n], q = v[i];
        if (!p || !q) { worst = i; worstLen = -Infinity; break; }
        const d = DIRS[ls[i].k];
        const sLen = d[0] * (q[0] - p[0]) + d[1] * (q[1] - p[1]);
        // stopień zostawiony (keep) wraca do gry tylko odwrócony
        const lim = ls[i].keep ? 0 : minLen;
        if (sLen < lim && sLen < worstLen) { worstLen = sLen; worst = i; }
      }
      if (worst < 0) return ls;
      const i = worst;
      const pi = (i - 1 + n) % n, ni = (i + 1) % n;
      const prev = ls[pi], next = ls[ni];
      if (prev.k === next.k && !(worstLen < 0 && ls[i].keep)) {
        // ząbek / wcięcie między równoległymi: płytkie — zalane (jedna linia, położenie ważone długością); głębokie
        // to prawdziwy stopień — zostaje
        if (Math.abs(prev.c - next.c) <= jog) {
          const w = prev.w + next.w;
          prev.c = (prev.c * prev.w + next.c * next.w) / w;
          prev.w = w;
          prev.end = next.end;
          prev.keep = prev.keep || next.keep;
          snapLine(prev, step);
          ls = ls.filter((_, q) => q !== i && q !== ni);
        } else if (worstLen < 0) {
          ls.splice(i, 1);
        } else {
          ls[i].keep = true;
        }
      } else {
        ls.splice(i, 1);
      }
      ls = tidy(ls);
    }
    return ls.length >= 3 ? ls : null;
  };
  lines = cleanup(lines);
  if (!lines) return fail('zostały < 3 linie');
  // 3b. SCHODKI / PIŁA: ciąg ≥ 3 krawędzi ≤ stairLen w kierunkach ±45° od cięciwy, z rogami po obu stronach cięciwy
  //     najwyżej stairDev — skos odrysowany schodkami — → jedna linia przez środek schodków (stairsToDiagonal)
  for (let pass = 0; pass < 4; pass++) {
    const st = stairsToDiagonal(lines, stairLen, stairDev, step, longLen);
    if (!st) break;
    const again = cleanup(st);
    if (!again) break;
    lines = again;
  }
  // 4. rogi daleko od dawnych rogów → faza 45° przez dawny róg (potem znów porządki — faza odwrócona albo za krótka
  //    znika)
  {
    const v = corners(lines);
    const out = [];
    for (let i = 0, n = lines.length; i < n; i++) {
      out.push(lines[i]);
      const a = lines[i], b = lines[(i + 1) % n];
      const p = v[i];
      if (!p || !a.end) continue;
      if (Math.hypot(p[0] - a.end[0], p[1] - a.end[1]) <= maxDev) continue;
      const t = turnOf(a.k, b.k);
      if (t === 0 || t === NK / 2) continue;
      // kierunek fazy: środkowy między a i b, w rodzinie 0 / 45 / 90° (parzyste k)
      const half = t < NK / 2 ? t / 2 : -(NK - t) / 2;
      const kc = ((2 * Math.round((a.k + half) / 2)) % NK + NK) % NK;
      if (kc === a.k || kc === b.k) continue;
      const [nx, ny] = nrm(kc);
      const l = { k: kc, c: nx * a.end[0] + ny * a.end[1], w: step, end: a.end };
      snapLine(l, step);
      out.push(l);
    }
    if (out.length !== lines.length) {
      const again = cleanup(out);
      if (again) lines = again;
    }
  }
  const v = corners(lines);
  if (v.some((p) => !p)) return fail('linie równoległe obok siebie');
  // łamana: róg przed linią i to v[i − 1]
  const res = [];
  for (let i = 0, n = lines.length; i < n; i++) res.push(v[(i - 1 + n) % n]);
  // bez punktów prawie pokrywających się
  const clean = [];
  for (const p of res) {
    const q = clean[clean.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) clean.push(p);
  }
  if (clean.length > 1 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 1e-6) clean.pop();
  if (clean.length < 3) return fail('zostały < 3 rogi');
  const area1 = signedArea(clean);
  if (Math.sign(area1) !== Math.sign(area0)) return fail('odwrócony obieg', clean);
  const ratio = Math.abs(area1) / Math.abs(area0);
  if (ratio < 0.75 || ratio > 1.33) return fail(`pole ×${ratio.toFixed(2)}`, clean);
  if (!isSimple(clean)) return fail('samoprzecięcie', clean);
  return clean;
}

const flipY = (L) => L.map(([x, y]) => [x, -y]);

/** Łamana dokładnie lustrzana względem osi y = 0 (zbiór wierzchołków — np. z symPolyPoints). */
function isMirrorExact(loop) {
  const key = (x, y) => `${x.toFixed(6)},${(y === 0 ? 0 : y).toFixed(6)}`;
  const set = new Set(loop.map(([x, y]) => key(x, y)));
  return loop.every(([x, y]) => set.has(key(x, -y)));
}

/** Łamana zamknięta bez punktów pośrednich na prostej (np. przecięcie osi na prostej rufie). */
function dropStraight(loop) {
  const n = loop.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n], p = loop[i], b = loop[(i + 1) % n];
    const ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6) continue;
    if (lv > 1e-6 && Math.abs(ux * vy - uy * vx) <= 1e-9 * lu * lv && ux * vx + uy * vy > 0) continue;
    out.push(p);
  }
  return out;
}

/**
 * Część y ≤ 0 łamanej zamkniętej, która przecina oś y = 0 dokładnie dwa razy: od osi do osi (końce na osi, y = 0),
 * w obiegu łamanej; inaczej null.
 */
export function axisHalfChain(loop) {
  const n = loop.length;
  const neg = (p) => p[1] < 0;
  const cr = [];
  for (let i = 0; i < n; i++) if (neg(loop[i]) !== neg(loop[(i + 1) % n])) cr.push(i);
  if (cr.length !== 2) return null;
  const into = neg(loop[cr[0]]) ? cr[1] : cr[0];        // krawędź wchodząca w y < 0
  const out = into === cr[0] ? cr[1] : cr[0];
  const X = (i) => {
    const a = loop[i], b = loop[(i + 1) % n];
    const t = a[1] / (a[1] - b[1]);
    return [a[0] + (b[0] - a[0]) * t, 0];
  };
  const chain = [X(into)];
  for (let k = (into + 1) % n; ; k = (k + 1) % n) {
    const p = loop[k], q = chain[chain.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) chain.push([p[0], p[1]]);
    if (k === out) break;
  }
  const e = X(out), q = chain[chain.length - 1];
  if (Math.hypot(e[0] - q[0], e[1] - q[1]) > 1e-6) chain.push(e);
  else chain[chain.length - 1] = e;
  return chain.length >= 3 ? chain : null;
}

/**
 * Standaryzacja z zachowaniem lustra względem osi y = 0: łamana z burty y ≥ 0 liczona jako odbicie swojej pary (para
 * burt wychodzi lustrzana bit w bit), łamana dokładnie lustrzana przecinająca oś — wynik przycięty do połowy y ≤ 0
 * i odbity. Reszta — regularizeLoop. Null, gdy się nie da (wołający bierze oryginał — lustrzany oryginał zostaje
 * lustrzany).
 */
export function regularizeLoopSym(loop, opts = {}) {
  let lo = Infinity, hi = -Infinity;
  for (const p of loop) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  if (lo >= 0 && hi > 0) { const r = regularizeLoop(flipY(loop), opts); return r ? flipY(r) : null; }
  const r = regularizeLoop(loop, opts);
  if (!r || !(lo < 0 && hi > 0) || !isMirrorExact(loop)) return r;
  const half = axisHalfChain(r);
  if (!half) { if (opts.diag) opts.diag.why = 'lustro: oś przecięta nie 2 razy'; return null; }
  const full = half.map(([x, y]) => [x, y]);
  for (let i = half.length - 2; i >= 1; i--) full.push([half[i][0], -half[i][1]]);
  const sym = dropStraight(full);
  const ratio = sym.length >= 3 ? Math.abs(signedArea(sym) / signedArea(r)) : 0;
  if (sym.length < 3 || ratio < 0.9 || ratio > 1.1 || !isSimple(sym)) { if (opts.diag) opts.diag.why = 'lustro: połowa'; return null; }
  return sym;
}

/**
 * Mocna standaryzacja (styl Terra Novy z czystego sprite'a Bellatora: długie proste, ząbki i wcięcia do 3 kroków zalane,
 * krawędzie krótsze niż 4 kroki znikają) — w krokach siatki linii.
 */
export const HD_REG_STRONG = Object.freeze({ minLen: 4, jog: 3, maxDev: 4 });

/**
 * Standaryzacja obrysu bryły (kreator): najpierw mocna (HD_REG_STRONG), gdy kształt się nie da — łagodna (domyślne
 * regularizeLoop), z lustrem burt (regularizeLoopSym). Null — kształt cieńszy / mniejszy niż najmniejszy element
 * standaryzacji (okruch z obrysu sprite'a; bryła z `regDrop` wtedy znika).
 */
export function standardizeLoop(loop, step) {
  const S2 = HD_REG_STRONG;
  return regularizeLoopSym(loop, { step, minLen: S2.minLen * step, jog: S2.jog * step, maxDev: S2.maxDev * step })
    || regularizeLoopSym(loop, { step });
}

/** Najmniejsza odległość punktu od łamanej zamkniętej (do testów i diagnostyki). */
export function loopDeviation(loopA, loopB) {
  const segD = (p, a, b) => {
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    let t = L2 > 0 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
  };
  let worst = 0;
  for (const p of loopA) {
    let d = Infinity;
    for (let i = 0; i < loopB.length; i++) d = Math.min(d, segD(p, loopB[i], loopB[(i + 1) % loopB.length]));
    worst = Math.max(worst, d);
  }
  return worst;
}

export const HD_REG_DIRS = DIRS;
